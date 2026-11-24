// @ts-check
// Run on, the desk's side (the remote desk's s2b; app/remote-work.js, http/admin/remote-work.js): a folder sent to
// another Filament for a chat of the person's, uncommitted work with it, asked first; the chat this Filament's app
// starts there named to the record; what it changed there brought back as uncommitted edits; a file both sides changed
// stops it with choices, nothing written, until one is named.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTwoMachines } from "./helpers/two-machines.js";
import { anthropicReply, fakeUpstream } from "./helpers/app.js";
import { createMachines } from "../src/services/machines/index.js";
import { WORK_REF_PREFIX, createRemoteWork } from "../src/app/remote-work.js";
import { bundleHeaderOf, bundleSnapshot } from "../src/adapters/git/send.js";

const JSON_TYPE = { "content-type": "application/json" };

/** @param {string} cwd @param {...string} args */
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
const textOf = (/** @type {string} */ f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
/** A project: committed lines, one file changed since, one in no commit. @param {string} dir */
const project = (dir) => {
  mkdirSync(join(dir, "src"), { recursive: true });
  gitIn(dir, "init", "-q");
  writeFileSync(join(dir, "src", "a.js"), "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");
  writeFileSync(join(dir, "src", "b.js"), "b\n");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "first");
  writeFileSync(join(dir, "src", "b.js"), "b, changed here\n");
  writeFileSync(join(dir, "notes.txt"), "in no commit\n");
  return dir;
};

// (fails before: yes — there was no Run on: a folder went to another machine for a sub-agent's launch alone)
test("Run on between two Filaments: asked first, sent with its uncommitted work, the chat there named; what it changed comes back as uncommitted edits; a file both changed gives choices", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "filament-remote-work-"));
  const was = process.env.FILAMENT_COPIES_DIR;
  process.env.FILAMENT_COPIES_DIR = join(base, "copies");
  t.after(() => {
    if (was === undefined) delete process.env.FILAMENT_COPIES_DIR;
    else process.env.FILAMENT_COPIES_DIR = was;
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const dir = project(join(base, "widgets"));
  const head = gitIn(dir, "rev-parse", "HEAD");
  const up = await fakeUpstream((/** @type {any} */ call) => (call.kind === "anthropic" ? anthropicReply("ok", { model: "brain-model" }) : undefined));
  const two = await startTwoMachines({
    there: {
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, permissions: "auto", readerModel: "" };
      },
    },
  });
  const { here, there } = two;
  try {
    // This Filament's agents' device there, made by the app's device there and kept here; Run on alone switched on.
    const minted = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ from: "Laptop" }) })).json();
    createMachines({ dataDir: here.dataDir }).keep({ url: two.remote.url, fingerprint: two.remote.fingerprint, machine: two.remote.machine, device: minted.device, token: minted.token });
    const name = two.remote.machine.name;
    const sendTo = (/** @type {any} */ allow) => here.api("/api/remote-work", { method: "POST", body: { machine: name, folder: dir, ...(allow ? { allow } : {}) } });

    // Off there: said, with the pill to switch on.
    const off = await sendTo(null);
    assert.equal(off.status, 422, await off.clone().text());
    assert.match(String((await off.json()).error), /lets no chat of yours run there: switch Run on on/);
    assert.equal((await there.api(`/api/remote/devices/${encodeURIComponent(minted.device.id)}`, { method: "PATCH", body: { grants: { copies: true } } })).status, 200);

    // Asked first: what goes, the file in no commit named.
    const asked = await sendTo(null);
    assert.equal(asked.status, 409);
    const { ask } = await asked.json();
    assert.equal(ask.machine, name);
    assert.equal(ask.project, "widgets");
    assert.deepEqual(ask.untracked, ["notes.txt"]);
    assert.deepEqual(ask.fresh, ["notes.txt"]);
    assert.equal(ask.lfs, 0);
    assert.match(ask.id, /^[0-9a-f]{64}$/);
    assert.ok(ask.bytes > 0, "its size, measured before any bundle");
    // A yes names the ask it answers: another's sends nothing.
    assert.equal((await sendTo({ ask: "0".repeat(64) })).status, 409);
    assert.equal((await sendTo({ untracked: ["notes.txt"], lfs: false })).status, 400);
    const sent = await sendTo({ ask: ask.id });
    const { work } = await sent.json();
    assert.equal(sent.status, 200, JSON.stringify(work));
    assert.equal(work.state, "placed");
    assert.equal(work.machine.name, name);
    assert.ok(work.cwd.startsWith(join(base, "copies")), work.cwd);
    assert.equal(textOf(join(work.cwd, "src", "b.js")), "b, changed here\n", "its uncommitted work went");
    assert.equal(textOf(join(work.cwd, "notes.txt")), "in no commit\n");
    assert.equal(gitIn(dir, "rev-parse", `${WORK_REF_PREFIX}${work.id}/copy`), work.base, "the commit it went at, held here");
    assert.equal(gitIn(dir, "rev-parse", "HEAD"), head, "nothing committed here");

    // Where a chat in it may run: this folder dirty at its HEAD; the machine answers and takes a chat of yours, what Run
    // on's grant alone reads none of unsaid; the machine it went to last.
    const places = await (await here.api(`/api/remote-work/places?folder=${encodeURIComponent(dir)}`)).json();
    assert.deepEqual([places.here?.head, places.here?.dirty], [head, true]);
    const place = places.machines.find((/** @type {any} */ m) => m.name === name);
    assert.deepEqual([place?.answers, place?.personCopy, place?.models, place?.clones], [true, true, null, null], JSON.stringify(place));
    assert.ok(place?.maker && place.maker === minted.device.of, "the full device the chat in a copy starts from: the one that made this Filament's agents' device there");
    assert.equal(places.last, work.machine.id);
    assert.equal((await here.api("/api/remote-work/places")).status, 400);
    // Agents on there too: its load, its memory and its models are read — and no clone, this folder having no remote.
    const grants = (/** @type {any} */ g) => there.api(`/api/remote/devices/${encodeURIComponent(minted.device.id)}`, { method: "PATCH", body: { grants: g } });
    assert.equal((await grants({ copies: true, agents: true })).status, 200);
    const full = (await (await here.api(`/api/remote-work/places?folder=${encodeURIComponent(dir)}`)).json()).machines.find((/** @type {any} */ m) => m.name === name);
    assert.ok(typeof full?.cpus === "number" && typeof full.memTotal === "number" && Array.isArray(full.models) && full.clones === null, JSON.stringify(full));
    assert.equal((await grants({ copies: true, agents: false })).status, 200);

    // Not asked again; asked again for a new file in no commit.
    assert.equal((await sendTo(null)).status, 200, "the same files: no ask");
    writeFileSync(join(dir, "draft.md"), "new\n");
    const again = await sendTo(null);
    assert.equal(again.status, 409);
    assert.deepEqual((await again.json()).ask.fresh, ["draft.md"]);
    rmSync(join(dir, "draft.md"));

    // Bring back before a chat is named: said.
    assert.equal((await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: {} })).status, 409);

    // The app's device there starts the chat in it, and names it here; a turn runs there.
    const chat = await (await two.ask("/api/sessions", { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ cwd: work.cwd, model: "agent/brain-model", title: "Widgets" }) })).json();
    assert.ok(chat.id, JSON.stringify(chat));
    const named = await (await here.api(`/api/remote-work/${work.id}/chat`, { method: "POST", body: { chat: chat.id } })).json();
    assert.deepEqual([named.work.chat, named.work.state], [chat.id, "running"]);
    const turn = await two.ask(`/api/sessions/${encodeURIComponent(chat.id)}/turns`, { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ content: "hello", stream: false }) });
    assert.equal(turn.status, 200, await turn.clone().text());

    // Another chat named than the copy's there: refused at once in its words, never asked again as a cut.
    await here.api(`/api/remote-work/${work.id}/chat`, { method: "POST", body: { chat: "not-that-chat" } });
    const wrong = await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: {} });
    const wrongBody = await wrong.json();
    assert.equal(wrong.status, 422, JSON.stringify(wrongBody));
    assert.match(wrongBody.error, /another chat's/);
    await here.api(`/api/remote-work/${work.id}/chat`, { method: "POST", body: { chat: chat.id } });

    // Nothing changed there: nothing waits, nothing comes.
    const look = (/** @type {any} */ body = {}) => here.api(`/api/remote-work/${work.id}/check`, { method: "POST", body });
    const quiet = await (await look({ seen: 1000 })).json();
    assert.deepEqual([quiet.unchanged, quiet.work.waiting, quiet.work.seen], [true, null, 1000], JSON.stringify(quiet));
    const none = await (await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: {} })).json();
    assert.equal(none.unchanged, true, JSON.stringify(none));

    // What the chat changed there waits, a look says — nothing written here —, and comes back as uncommitted edits; the
    // person's own change stays.
    writeFileSync(join(work.cwd, "src", "a.js"), "one\ntwo, there\nthree\nfour\nfive\nsix\nseven\n");
    writeFileSync(join(work.cwd, "src", "c.js"), "new there\n");
    // (fails before: yes — the review of s2d) The person made a.js's change here too: it would come in as it is, so it is
    // listed and comes, and is none of what waits.
    writeFileSync(join(dir, "src", "a.js"), "one\ntwo, there\nthree\nfour\nfive\nsix\nseven\n");
    // (fails before: yes — the remote desk's s2d: nothing said what waited there until a bring back took it)
    const waits = await look({ seen: 2000 });
    const waiting = await waits.json();
    assert.equal(waits.status, 200, JSON.stringify(waiting));
    assert.deepEqual([waiting.unchanged, waiting.count, waiting.files.map((/** @type {any} */ f) => f.path).sort(), waiting.conflicts], [false, 2, ["src/a.js", "src/c.js"], []]);
    assert.deepEqual(waiting.work.waiting, { at: waiting.at, files: 1, conflicts: 0 }, "what would change the folder: c.js alone");
    assert.equal(existsSync(join(dir, "src", "c.js")), false, "a look writes nothing here");
    assert.deepEqual((await (await here.api("/api/remote-work")).json()).works.find((/** @type {any} */ w) => w.id === work.id)?.waiting, { at: waiting.at, files: 1, conflicts: 0 }, "listed with what waits");
    assert.equal((await look({ seen: -1 })).status, 400);
    const back = await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: {} });
    const brought = await back.json();
    assert.equal(back.status, 200, JSON.stringify(brought));
    assert.deepEqual(brought.files.map((/** @type {any} */ f) => f.path).sort(), ["src/a.js", "src/c.js"]);
    assert.equal(textOf(join(dir, "src", "a.js")), "one\ntwo, there\nthree\nfour\nfive\nsix\nseven\n");
    assert.equal(textOf(join(dir, "src", "c.js")), "new there\n");
    assert.equal(textOf(join(dir, "src", "b.js")), "b, changed here\n");
    assert.equal(gitIn(dir, "rev-parse", "HEAD"), head, "uncommitted: HEAD untouched");
    assert.match(gitIn(dir, "status", "--porcelain"), /^\s?M src\/a\.js$/m);
    assert.deepEqual([brought.work.state, brought.work.waiting], ["brought", null]);
    assert.equal((await (await look()).json()).unchanged, true, "a second round brings only what changed since: nothing yet");

    // Both change one line: choices, nothing written; then its version, as chosen. A change of the person's elsewhere in
    // the file is merged with it all the same.
    writeFileSync(join(work.cwd, "src", "a.js"), "one\ntwo, there\nthree\nfour, there\nfive\nsix\nseven\n");
    writeFileSync(join(dir, "src", "a.js"), "one\ntwo, there\nthree\nfour, here\nfive\nsix\nseven\n");
    const second = await (await look()).json();
    assert.deepEqual([second.count, second.conflicts.map((/** @type {any} */ c) => c.path), second.work.waiting.conflicts], [1, ["src/a.js"], 1], "only the new change, and what would stop it");
    // (fails before: yes — the review of s2d: a bring back with nothing to choose took whatever was there by then) A
    // capture named alone brings that capture or nothing: one taken since says so.
    const other = await (await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: { at: "0".repeat(40) } })).json();
    assert.deepEqual([other.ok, other.moved, other.at], [false, true, second.at]);
    const stopped = await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: {} });
    const conflict = await stopped.json();
    assert.equal(stopped.status, 409, JSON.stringify(conflict));
    assert.deepEqual(conflict.conflicts.map((/** @type {any} */ c) => c.path), ["src/a.js"]);
    assert.equal(textOf(join(dir, "src", "a.js")), "one\ntwo, there\nthree\nfour, here\nfive\nsix\nseven\n", "nothing written");
    assert.match(conflict.at, /^[0-9a-f]{40}$/);
    assert.equal(conflict.at, second.at, "the look's capture is the bring back's: choices made on a look's conflicts hold");
    // Choices for a capture it changed since: said, nothing written; then for the one now.
    writeFileSync(join(work.cwd, "src", "a.js"), "one\ntwo, there\nthree\nfour, there again\nfive\nsix\nseven\n");
    const movedOn = await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: { choices: { "src/a.js": "its" }, at: conflict.at } });
    const moved = await movedOn.json();
    assert.equal(movedOn.status, 409, JSON.stringify(moved));
    assert.equal(moved.moved, true);
    assert.notEqual(moved.at, conflict.at);
    assert.deepEqual(moved.conflicts.map((/** @type {any} */ c) => c.path), ["src/a.js"], "what stops it now, shown again");
    assert.equal(textOf(join(dir, "src", "a.js")), "one\ntwo, there\nthree\nfour, here\nfive\nsix\nseven\n", "nothing written");
    assert.equal((await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: { choices: { "src/a.js": "its" } } })).status, 400, "choices name the capture they answer");
    const chosen = await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: { choices: { "src/a.js": "its" }, at: moved.at } });
    assert.equal(chosen.status, 200, await chosen.clone().text());
    assert.equal(textOf(join(dir, "src", "a.js")), "one\ntwo, there\nthree\nfour, there again\nfive\nsix\nseven\n");
    assert.equal((await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: { choices: { "src/a.js": "theirs" } } })).status, 400);

    // Put back there as it went: that comes back too — its edits and its new file go here as well.
    writeFileSync(join(work.cwd, "src", "a.js"), "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");
    rmSync(join(work.cwd, "src", "c.js"));
    const undone = await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: {} });
    const reverted = await undone.json();
    assert.equal(undone.status, 200, JSON.stringify(reverted));
    assert.equal(reverted.unchanged, false);
    assert.equal(textOf(join(dir, "src", "a.js")), "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");
    assert.equal(existsSync(join(dir, "src", "c.js")), false);
    assert.equal(textOf(join(dir, "src", "b.js")), "b, changed here\n", "the person's own change stays");
    assert.equal((await (await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: {} })).json()).unchanged, true, "then nothing more");

    // Listed; forgotten, its refs with it.
    const listed = await (await here.api("/api/remote-work")).json();
    assert.ok(listed.works.some((/** @type {any} */ w) => w.id === work.id && w.chat === chat.id));
    assert.equal((await here.api(`/api/remote-work/${work.id}`, { method: "DELETE" })).status, 200);
    assert.equal(gitIn(dir, "for-each-ref", `${WORK_REF_PREFIX}${work.id}/`), "");
    assert.equal((await here.api(`/api/remote-work/${work.id}/back`, { method: "POST", body: {} })).status, 404);
    // A folder in no repository is refused before anything goes.
    const loose = join(base, "loose");
    mkdirSync(loose);
    assert.equal((await here.api("/api/remote-work", { method: "POST", body: { machine: name, folder: loose } })).status, 400);
  } finally {
    await two.stop();
    await up.close();
  }
});

// (fails before: yes — nothing said that Git LFS's files stay here)
test("Run on asks before a repository whose files Git LFS keeps goes, and its yes holds after", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-remote-work-lfs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  gitIn(dir, "init", "-q");
  writeFileSync(join(dir, ".gitattributes"), "*.psd filter=lfs diff=lfs merge=lfs -text\n");
  writeFileSync(join(dir, "art.psd"), "version https://git-lfs.github.com/spec/v1\noid sha256:0\nsize 1\n");
  gitIn(dir, "-c", "filter.lfs.clean=cat", "-c", "filter.lfs.smudge=cat", "add", "-A");
  gitIn(dir, "-c", "filter.lfs.clean=cat", "commit", "-q", "-m", "art");
  /** @type {any[]} */
  const placed = [];
  const remote = {
    placeForPerson: async (/** @type {string} */ m, /** @type {any} */ o) => {
      o.sent.has("machine-1", dir);
      await o.ask({ machine: m, project: "art", files: 2, bytes: 10, untracked: [], left: [] });
      placed.push(m);
      return { machine: { id: "machine-1", name: m }, project: "art", repo: dir, commit: gitIn(dir, "rev-parse", "HEAD"), sub: "", files: 2, bytes: 10, left: [], copy: { id: "c1", folder: "/there/1" }, cwd: "/there/1", reused: false };
    },
    takeBack: async () => {
      throw new Error("unused");
    },
  };
  const data = mkdtempSync(join(tmpdir(), "filament-remote-work-data-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const s = createRemoteWork({ dataDir: data, remote: /** @type {any} */ (remote) });
  /** @type {any} */
  let ask = null;
  await assert.rejects(s.send({ machine: "Studio", folder: dir }), (/** @type {any} */ e) => ((ask = e.ask), e.status === 409 && e.ask.lfs === 1));
  const w = await s.send({ machine: "Studio", folder: dir, allow: { ask: ask.id } });
  assert.equal(w.state, "placed");
  assert.ok(await s.send({ machine: "Studio", folder: dir }), "its yes holds");
  assert.equal(placed.length, 2);
});

// (fails before: yes — a yes kept 2,000 files and the route 5,000: past them every send asked again, or could never go)
test("Run on's ask names the first files in no commit and counts them all; its yes holds for every one of them", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-remote-work-many-"));
  const data = mkdtempSync(join(tmpdir(), "filament-remote-work-data-"));
  t.after(() => (rmSync(dir, { recursive: true, force: true }), rmSync(data, { recursive: true, force: true })));
  gitIn(dir, "init", "-q");
  let untracked = Array.from({ length: 6000 }, (_, i) => `Library/cache-${String(i).padStart(5, "0")}.bin`);
  let sends = 0;
  const remote = {
    placeForPerson: async (/** @type {string} */ m, /** @type {any} */ o) => {
      o.sent.has("machine-1", dir);
      await o.ask({ machine: m, project: "game", files: untracked.length, bytes: 10, untracked, left: [] });
      sends++;
      return { machine: { id: "machine-1", name: m }, project: "game", repo: dir, commit: "a".repeat(40), sub: "", files: untracked.length, bytes: 10, left: [], copy: { id: `c${sends}`, folder: "/there/1" }, cwd: "/there/1", reused: false };
    },
    takeBack: async () => {
      throw new Error("unused");
    },
  };
  const s = createRemoteWork({ dataDir: data, remote: /** @type {any} */ (remote) });
  /** @param {any} [allow] */
  const asked = async (allow) => {
    try {
      await s.send({ machine: "Studio", folder: dir, allow });
    } catch (/** @type {any} */ e) {
      if (e.status === 409) return e.ask;
      throw e;
    }
    return null;
  };
  const first = await asked();
  assert.deepEqual([first.untracked.length, first.untrackedCount, first.fresh.length, first.freshCount], [200, 6000, 200, 6000]);
  assert.equal(await asked({ ask: first.id }), null, "its yes sends it");
  assert.equal(await asked(), null, "and holds for all 6,000");
  // A store started again keeps the yes.
  const s2 = createRemoteWork({ dataDir: data, remote: /** @type {any} */ (remote) });
  await s2.send({ machine: "Studio", folder: dir });
  untracked = [...untracked, "Library/new.bin"];
  const more = await asked();
  assert.deepEqual([more.fresh, more.freshCount], [["Library/new.bin"], 1]);
  assert.notEqual(more.id, first.id);
  assert.notEqual(await asked({ ask: first.id }), null, "an old ask's yes sends no new file");
  assert.equal(await asked({ ask: more.id }), null);
});

// (fails before: yes — the ask came once the whole bundle was built, so a question cost a bundle and a no threw it away)
test("a send's ask comes before its bundle, with what git keeps of what goes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-remote-work-ask-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  gitIn(dir, "init", "-q");
  writeFileSync(join(dir, "a.txt"), "a\n".repeat(5000));
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "a");
  writeFileSync(join(dir, "loose.txt"), "loose\n");
  /** @type {any} */
  let seen = null;
  const out = await bundleSnapshot(dir, {
    machine: "m-ask",
    project: "ask",
    ask: async (o) => {
      seen = o;
      throw Object.assign(new Error("no"), { said: true });
    },
  }).catch((e) => e);
  assert.equal(out.message, "no");
  assert.deepEqual(seen.untracked, ["loose.txt"]);
  assert.ok(seen.bytes > 0 && seen.files === 2, JSON.stringify(seen));

  // Another send of the project to that machine while the person answers: each bundle is its own snapshot's.
  /** @type {any} */
  let inner = null;
  const outer = await bundleSnapshot(dir, {
    machine: "m-ask",
    project: "ask",
    ask: async () => {
      writeFileSync(join(dir, "later.txt"), "later\n");
      inner = await bundleSnapshot(dir, { machine: "m-ask", project: "ask" });
    },
  });
  assert.ok(outer.ok && inner?.ok, JSON.stringify({ outer, inner }));
  t.after(() => [outer, inner].forEach((b) => b.dir && rmSync(b.dir, { recursive: true, force: true })));
  assert.notEqual(outer.commit, inner.commit);
  assert.deepEqual((await bundleHeaderOf(String(outer.file)))?.heads.map((h) => h.sha), [outer.commit], "its yes sends what it asked about");
  assert.deepEqual(outer.untracked, ["loose.txt"]);
});

/**
 * A store over a real repository whose machine there is a stand-in: each send placed at the folder's HEAD, each bring
 * back the commit `back()` names. @param {string} dir @param {string} data @param {() => string} back
 */
const standIn = (dir, data, back) => {
  let sends = 0;
  const remote = {
    placeForPerson: async (/** @type {string} */ m, /** @type {any} */ o) => {
      o.sent.has("machine-1", dir);
      sends++;
      return { machine: { id: "machine-1", name: m }, project: "widgets", repo: dir, commit: gitIn(dir, "rev-parse", "HEAD"), sub: "", files: 1, bytes: 1, left: [], copy: { id: `c${sends}`, folder: `/there/${sends}` }, cwd: `/there/${sends}`, reused: false };
    },
    takeBack: async () => ({ commit: back(), left: [] }),
    placesFor: async () => ({ here: true, machines: [] }),
  };
  return createRemoteWork({ dataDir: data, remote: /** @type {any} */ (remote) });
};

// (fails before: yes — the review of s2b: a write the folder would not take came back as a file that overlaps your
// edits, and Keep yours on it moved `applied` past a change that never came, which then never waited again)
test("a bring back the folder will not take is said as that failure, with no choice to make; nothing is marked as come, and it comes once the folder takes it", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-remote-work-fail-"));
  const data = mkdtempSync(join(tmpdir(), "filament-remote-work-data-"));
  const locked = join(dir, "z.txt");
  t.after(() => (existsSync(locked) && chmodSync(locked, 0o644), rmSync(dir, { recursive: true, force: true }), rmSync(data, { recursive: true, force: true })));
  gitIn(dir, "init", "-q");
  writeFileSync(join(dir, "a.txt"), "a\n");
  writeFileSync(locked, "z\n");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "first");
  const base = gitIn(dir, "rev-parse", "HEAD");
  // What its chat made there: both files changed.
  gitIn(dir, "checkout", "-q", "-b", "there");
  writeFileSync(join(dir, "a.txt"), "a, changed there\n");
  writeFileSync(locked, "z, changed there\n");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "there");
  const head = gitIn(dir, "rev-parse", "HEAD");
  gitIn(dir, "checkout", "-q", "-");
  assert.equal(gitIn(dir, "rev-parse", "HEAD"), base);
  const s = standIn(dir, data, () => head);
  const w = await s.send({ machine: "Studio", folder: dir });
  s.chat(w.id, "c-there");
  // z.txt read-only here, as a file an editor holds: the folder will not take what comes.
  chmodSync(locked, 0o444);
  const failed = /** @type {any} */ (await s.back(w.id));
  assert.equal(failed.ok, false);
  assert.match(String(failed.error), /^1 file does not come through cleanly — z\.txt: your folder would not take it \(/);
  assert.ok(failed.conflicts.length && failed.conflicts.every((/** @type {any} */ c) => !c.kind), "nothing of it is an overlap to choose for");
  assert.equal(failed.at, head);
  assert.equal(textOf(join(dir, "a.txt")), "a\n", "nothing written: a.txt put back");
  assert.equal(s.get(w.id)?.applied, "");
  // Choices named for it change nothing: the folder still will not take it, and nothing is marked as come.
  const chose = /** @type {any} */ (await s.back(w.id, { choices: { "z.txt": "yours" }, at: failed.at }));
  assert.equal(chose.ok, false);
  assert.equal(s.get(w.id)?.applied, "", "Keep yours never marks a change that did not come");
  // The folder takes it once the file may be written again.
  chmodSync(locked, 0o644);
  const came = /** @type {any} */ (await s.back(w.id));
  assert.equal(came.ok, true, JSON.stringify(came));
  assert.deepEqual([textOf(join(dir, "a.txt")), textOf(locked)], ["a, changed there\n", "z, changed there\n"]);
  assert.equal(s.get(w.id)?.applied, head);
});

// (fails before: yes — the review of s2b: past 200 records with none brought back or gone, the oldest went, a running one
// with its refs)
test("past the most records kept, the oldest brought back or gone goes; a record still in use never does", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-remote-work-trim-"));
  const data = mkdtempSync(join(tmpdir(), "filament-remote-work-data-"));
  t.after(() => (rmSync(dir, { recursive: true, force: true }), rmSync(data, { recursive: true, force: true })));
  gitIn(dir, "init", "-q");
  writeFileSync(join(dir, "a.txt"), "a\n");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "first");
  const { WORKS_MAX } = await import("../src/app/remote-work.js");
  const rec = (/** @type {number} */ i, /** @type {string} */ state) => ({ id: `old-${i}`, machine: { id: "machine-1", name: "Studio" }, folder: dir, repo: dir, project: "widgets", base: "", copy: { id: `k${i}`, folder: "/there" }, cwd: "/there", chat: `c${i}`, back: "", applied: "", left: [], files: 1, bytes: 1, madeAt: i + 1, broughtAt: 0, state, waiting: null, checkedAt: 0, seen: 0 });
  // The oldest records still at work; one brought back among the newer ones.
  const old = Array.from({ length: WORKS_MAX }, (_, i) => rec(i, i === WORKS_MAX - 5 ? "brought" : i % 2 ? "running" : "placed"));
  writeFileSync(join(data, "remote-work.json"), JSON.stringify({ version: 1, works: old }));
  const s = standIn(dir, data, () => "");
  const send = () => s.send({ machine: "Studio", folder: dir });
  await send();
  const ids = s.list().map((w) => w.id);
  assert.equal(ids.length, WORKS_MAX);
  assert.ok(!ids.includes(`old-${WORKS_MAX - 5}`), "the one brought back went");
  assert.ok(ids.includes("old-0") && ids.includes("old-1"), "the oldest, still in use, stay");
  await send();
  assert.equal(s.list().length, WORKS_MAX + 1, "kept past the most, rather than one still in use dropped");
  assert.ok(s.list().every((w) => w.state === "placed" || w.state === "running"));
});
