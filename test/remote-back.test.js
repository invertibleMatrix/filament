// @ts-check
// What a sub-agent changed in its copy on another machine, kept until it is here (the review of 11-11): the commits this
// side says it holds are those still in its repository, and a change built on one that went comes whole; what stayed in
// the copy is said by kind, count and name; a copy is taken for a newer launch only once its state is kept in its
// mirror, which its old chat's change is then served from; no capture is made while a turn of its chat runs in it; and
// two repositories of one folder name keep their own stores and copies there. The receiving machine is its real
// services over real git (services/copies.js, services/transfers.js, adapters/git/send.js), called as its routes call
// them; the sender is remote-agents.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as send from "../src/adapters/git/send.js";
import { captureCopy, checkoutCopy, importBundle, mirrorHas, mirrorHaves } from "../src/adapters/git/send.js";
import { MIRROR, createTransfers } from "../src/services/transfers.js";
import { createRemoteAgents, sendsKept } from "../src/app/agent/remote-agents.js";
import { leftLine } from "../src/app/agent/subagents.js";
import { createDevices } from "../src/services/devices.js";
import * as copiesModule from "../src/services/copies.js";
import { COPIES, IDLE_MS, createCopies } from "../src/services/copies.js";

/** @param {import("node:test").TestContext} t @param {string} name */
const folder = (t, name) => {
  const d = mkdtempSync(join(tmpdir(), `filament-back-${name}-`));
  t.after(() => rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return d;
};
/** @param {string} cwd @param {...string} args */
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
/** A repository at `dir` with one commit, `node_modules` ignored. @param {string} dir @param {string} [words]  what its first file says */
const project = (dir, words = "export const a = 1;\n") => {
  mkdirSync(join(dir, "src"), { recursive: true });
  gitIn(dir, "init", "-q");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(join(dir, "src", "a.js"), words);
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "first");
  return dir;
};
/** A file's words, its line ends made one. @param {string} f */
const textOf = (f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

/**
 * The machine a copy goes to, "Workstation": its devices, copies and transfers as its server makes them, and the client
 * this machine's agents reach it by, each call answered by the service its route calls — a refusal thrown with its
 * status and body, as the client throws one. `now`: its clock; `before`: called with each call's path and body before it
 * is answered, `after` with its answer.
 * @param {import("node:test").TestContext} t
 * @param {{ now?: () => number, takes?: string[], before?: (path: string, body: any) => unknown, after?: (path: string, out: any) => unknown, capture?: typeof captureCopy, maxCopies?: number }} [o]
 */
const receiver = (t, { now = () => Date.now(), takes = ["transfer", "copy", "back", "repo"], before = () => {}, after = () => {}, capture = captureCopy, maxCopies = undefined } = {}) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const devices = createDevices({ dataDir: data });
  const full = devices.claim(devices.startPairing({ scope: "full" }).code, { name: "Filament app on Laptop", machine: "66666666-6666-4666-8666-666666666666" });
  assert.ok(full.ok);
  const minted = devices.mintAgents(full.device.id, { from: "Laptop" });
  assert.ok(minted.ok);
  const device = minted.device.id;
  const copies = createCopies({ dataDir: data, root, devices, now, ...(maxCopies ? { maxCopies } : {}) });
  // As the server hands them in (server.js), what keeps a copy's state among them, by its name in the adapter.
  const kept = /** @type {any} */ (send);
  const s = createTransfers(/** @type {any} */ ({ copies, take: importBundle, haves: mirrorHaves, has: mirrorHas, checkout: checkoutCopy, capture, keep: kept.keepCapture, kept: kept.bundleKept, drop: kept.dropKept, now }));
  /** @param {any} out */
  const answer = (out) => {
    if (out && "status" in out && "error" in out) {
      const { status, error, ...more } = out;
      throw Object.assign(new Error(error), { status, body: { error, ...more } });
    }
    return out;
  };
  /** @type {[string, any][]} */
  const calls = [];
  const state = { takes: [...takes] };
  const client = {
    state,
    /** @param {string} path */
    get: async (path) => {
      calls.push([`GET ${path.split("?")[0]}`, null]);
      await before(path, null);
      const u = new URL(`http://x${path}`);
      const part = /^\/transfers\/back\/([^/]+)$/.exec(u.pathname);
      const out = part ? await s.backPart(device, decodeURIComponent(part[1]), u.searchParams.get("offset")) : await s.haves(device, u.searchParams.get("project"), u.searchParams.get("repo"));
      await after(path, out);
      return answer(out);
    },
    /** @param {string} path @param {any} body */
    post: async (path, body) => {
      calls.push([`POST ${path}`, body]);
      await before(path, body);
      const [, id, what] = /^\/transfers\/([^/]+)\/(part|commit)$/.exec(path) || [];
      const out =
        path === "/transfers" ? await s.open(device, body) : path === "/transfers/place" ? await s.place(device, body) : path === "/transfers/back" ? await s.back(device, body) : what === "part" ? await s.part(device, decodeURIComponent(id), body) : await s.commit(device, decodeURIComponent(id));
      await after(path, out);
      return answer(out);
    },
  };
  const m = { machine: { id: "22222222-2222-4222-8222-222222222222" }, name: "Workstation", device: { scope: "agent" } };
  const machines = /** @type {any} */ ({ list: () => [m], find: () => m, clientOf: async () => client });
  return { device, copies, s, root, calls, state, machines, agents: createRemoteAgents({ machines, wait: async () => {} }) };
};
/** A launch's copy of `dir` made on that machine, its chat `chat` holding it as a chat started in it does. @param {ReturnType<typeof receiver>} r @param {string} dir @param {string} chat */
const placed = async (r, dir, chat) => {
  const p = await r.agents.copyPlace(/** @type {any} */ ({ machine: { id: "Workstation", name: "Workstation" }, system: null, remote: null, here: null, cwd: "", clone: null, pending: { from: dir } }), { ask: async () => true, sent: sendsKept(null) });
  const copy = /** @type {NonNullable<typeof p.copy>} */ (p.copy);
  assert.ok(copy, "its copy there");
  assert.equal(r.copies.bind(copy.id, chat), true);
  return copy;
};

// (fails before: yes — finding 7 of the review of 11-11: an earlier capture this side named as held, pruned from its
// repository since, made that machine leave it out of the bundle, and the import refused it for good)
test("the commits this side says it holds are those still in its repository: one that went is not named, and the change comes whole", async (t) => {
  const dir = project(folder(t, "repo"));
  const r = receiver(t);
  const copy = await placed(r, dir, "chat-1");
  // Its first turn's change, captured there and never brought here: this repository does not hold it.
  writeFileSync(join(copy.folder, "src", "b.js"), "export const b = 2;\n");
  const first = await r.s.back(r.device, { copy: copy.id, chat: "chat-1", haves: [copy.commit] });
  assert.ok(!("status" in first) && first.commit !== copy.commit, JSON.stringify(first));
  assert.throws(() => gitIn(dir, "cat-file", "-e", first.commit), /Command failed/, "not in this repository");
  writeFileSync(join(copy.folder, "src", "c.js"), "export const c = 3;\n");
  const got = await r.agents.takeBack("Workstation", { copy: copy.id, chat: "chat-1", repo: copy.repo, base: copy.commit, haves: [first.commit] });
  assert.equal(got.unchanged, false);
  assert.deepEqual(gitIn(dir, "diff", "--name-status", copy.commit, got.commit).split("\n").sort(), ["A\tsrc/b.js", "A\tsrc/c.js"]);
  const named = r.calls.filter(([row]) => row === "POST /transfers/back").map(([, b]) => b.haves);
  assert.deepEqual(named.at(-1), [copy.commit], "only what is here is named");
});

/** Why what git ignores in a copy stays there, as that machine says it (adapters/git/send.js). */
const IGNORED = "ignored by git: none is sent";

// (fails before: yes — r-itself, 11-12: what git ignores in a copy was listed nowhere — the capture's add honours
// .gitignore, and what stays was read among the files git does not ignore — so a turn that made a build's output there
// and nothing else was "unchanged" with nothing left, and its report read "and changed nothing.")
test("what git ignores in a copy, made or changed there since the copy was placed, is said to stay there — a folder whole, by its name — and nothing of it is sent; what an earlier launch left there is not said again", async (t) => {
  const dir = project(folder(t, "repo"));
  writeFileSync(join(dir, ".gitignore"), "node_modules/\ndist/\n*.log\n");
  gitIn(dir, "commit", "-q", "-am", "what a build makes is ignored");
  const r = receiver(t);
  const copy = await placed(r, dir, "chat-1");
  // Its turn builds there: a folder of hundreds of files, an install, a log.
  mkdirSync(join(copy.folder, "dist", "assets"), { recursive: true });
  for (let i = 0; i < 300; i++) writeFileSync(join(copy.folder, "dist", "assets", `chunk-${i}.js`), `export const n = ${i};\n`);
  mkdirSync(join(copy.folder, "node_modules", "y"), { recursive: true });
  writeFileSync(join(copy.folder, "node_modules", "y", "i.js"), "installed there\n");
  writeFileSync(join(copy.folder, "build.log"), "built\n");
  const built = await r.agents.takeBack("Workstation", { copy: copy.id, chat: "chat-1", repo: copy.repo, base: copy.commit });
  assert.deepEqual(built, { commit: copy.commit, unchanged: true, left: [{ path: "build.log", why: IGNORED }, { path: "dist/", why: IGNORED }, { path: "node_modules/", why: IGNORED }] }, "nothing to bring: what it made there stays, each by name, the folders whole");
  // As its report says it (subagents.js `workText`): "…, and nothing it changed came back here. What it made or changed
  // there that stays in that copy, not brought here: " and this.
  assert.equal(leftLine(built.left), "ignored by git: none is sent: 3 (build.log, dist/, node_modules/)");
  // With a file git reads changed too: that one comes, and nothing ignored with it.
  writeFileSync(join(copy.folder, "src", "b.js"), "export const b = 2;\n");
  const came = await r.agents.takeBack("Workstation", { copy: copy.id, chat: "chat-1", repo: copy.repo, base: copy.commit });
  assert.equal(came.unchanged, false);
  assert.deepEqual(gitIn(dir, "ls-tree", "-r", "--name-only", came.commit).split("\n"), [".gitignore", "src/a.js", "src/b.js"], "nothing ignored is sent");
  assert.deepEqual(came.left.map((l) => l.path), ["build.log", "dist/", "node_modules/"], "still said to stay there");

  // A newer launch takes the copy, its installs and its build kept there: none of them is this launch's doing.
  r.copies.release(copy.id);
  const second = await placed(r, dir, "chat-2");
  assert.deepEqual([second.id, second.reused, existsSync(join(second.folder, "dist", "assets", "chunk-7.js"))], [copy.id, true, true], "the idle copy, taken again, what is ignored kept");
  const untouched = await r.agents.takeBack("Workstation", { copy: second.id, chat: "chat-2", repo: second.repo, base: second.commit });
  assert.deepEqual(untouched, { commit: second.commit, unchanged: true, left: [] }, "what was there before it is not its work");
  // Until it changes one: a file deep in the build is the build's folder, changed.
  writeFileSync(join(second.folder, "dist", "assets", "chunk-7.js"), "export const n = 70;\n");
  const rebuilt = await r.agents.takeBack("Workstation", { copy: second.id, chat: "chat-2", repo: second.repo, base: second.commit });
  assert.deepEqual(rebuilt.left, [{ path: "dist/", why: IGNORED }]);
  // Past a hundred names the first hundred are named, and the reason says how many there are.
  for (let i = 100; i < 205; i++) writeFileSync(join(second.folder, `run-${i}.log`), "ran\n");
  const many = await r.agents.takeBack("Workstation", { copy: second.id, chat: "chat-2", repo: second.repo, base: second.commit });
  assert.equal(many.left.length, 100);
  assert.deepEqual([...new Set(many.left.map((l) => l.why))], ["ignored by git, 106 in all, the first 100 named: none is sent"]);
  assert.equal(leftLine(many.left), "ignored by git, 106 in all, the first 100 named: none is sent: 100 (dist/, run-100.log, run-101.log, run-102.log, run-103.log, and 95 more)");
});

// (fails before: yes — finding 7: a capture built on a commit this repository lost between the ask and the import was
// refused for good, where a capture without it would have come)
test("a change that comes built on a commit this repository holds no more is asked for again without it", async (t) => {
  const dir = project(folder(t, "repo"));
  const packs = join(dir, ".git", "objects", "pack");
  /** The packs the first change came in, removed once that machine has built the next on it. @type {string[]} */
  let came = [];
  let cut = false;
  const r = receiver(t, {
    after: (path, out) => {
      if (path !== "/transfers/back" || cut || !came.length || !out?.id) return;
      cut = true;
      for (const n of came) rmSync(join(packs, n), { force: true });
    },
  });
  const copy = await placed(r, dir, "chat-1");
  writeFileSync(join(copy.folder, "src", "b.js"), "export const b = 2;\n");
  const had = existsSync(packs) ? readdirSync(packs) : [];
  const first = await r.agents.takeBack("Workstation", { copy: copy.id, chat: "chat-1", repo: copy.repo, base: copy.commit });
  came = readdirSync(packs).filter((n) => !had.includes(n));
  assert.ok(came.length > 0, "the first change came in a pack of its own");
  writeFileSync(join(copy.folder, "src", "c.js"), "export const c = 3;\n");
  const got = await r.agents.takeBack("Workstation", { copy: copy.id, chat: "chat-1", repo: copy.repo, base: copy.commit, haves: [first.commit] });
  assert.equal(cut, true, "the first change went from this repository as the next came");
  assert.deepEqual(gitIn(dir, "diff", "--name-status", copy.commit, got.commit).split("\n").sort(), ["A\tsrc/b.js", "A\tsrc/c.js"]);
  const named = r.calls.filter(([row]) => row === "POST /transfers/back").map(([, b]) => b.haves);
  assert.deepEqual(named.slice(-2), [[copy.commit, first.commit], [copy.commit]], "asked again with the copy sent alone");
});

// (fails before: yes — finding 5 of the review of 11-11: a project's store and copies there were found by its folder's
// name alone, so an idle copy of work/app was taken for play/app, the first one's installs still in it)
test("two repositories of one folder name keep a store and copies of their own there: an idle copy of one is never taken for the other; one repository under another folder's name keeps its store and its copy", async (t) => {
  const base = folder(t, "names");
  const work = project(join(base, "work", "app"), "export const work = 1;\n");
  const play = project(join(base, "play", "app"), "export const play = 1;\n");
  const r = receiver(t);
  const first = await placed(r, work, "chat-work");
  mkdirSync(join(first.folder, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(first.folder, "node_modules", "dep", "i.js"), "work's install\n");
  r.copies.release(first.id);
  const second = await placed(r, play, "chat-play");
  assert.notEqual(second.id, first.id, "a copy of its own");
  assert.equal(second.reused, false);
  assert.equal(existsSync(join(second.folder, "node_modules")), false, "none of the other repository's installs");
  assert.equal(textOf(join(second.folder, "src", "a.js")), "export const play = 1;\n");
  assert.equal(textOf(join(first.folder, "src", "a.js")), "export const work = 1;\n", "the first's copy as it was left");
  // Each its own store, the folder's name kept for display: the second of a name carries its repository's first digits.
  assert.equal(first.folder, join(r.root, "From Laptop", "app", "1"));
  assert.match(second.folder, /[\\/]From Laptop[\\/]app \([0-9a-f]{8}\)[\\/]1$/);
  const stores = [work, play].map((d) => r.copies.storeOf(r.device, "app", /** @type {any} */ ({ make: false, repo: gitIn(d, "rev-list", "--max-parents=0", "HEAD") })));
  assert.ok(stores[0].ok && stores[1].ok && stores[0].folder !== stores[1].folder, JSON.stringify(stores));
  assert.deepEqual(await mirrorHaves(join(stores[0].folder, MIRROR)), [first.commit]);
  assert.deepEqual(await mirrorHaves(join(stores[1].folder, MIRROR)), [second.commit]);
  // The first repository cloned under another folder's name is that repository still: its store, its idle copy, its installs.
  const renamed = join(base, "elsewhere", "app-renamed");
  mkdirSync(join(base, "elsewhere"));
  gitIn(base, "clone", "-q", work, renamed);
  const third = await placed(r, renamed, "chat-renamed");
  assert.deepEqual([third.id, third.reused], [first.id, true], "its idle copy taken again");
  assert.equal(existsSync(join(third.folder, "node_modules", "dep", "i.js")), true, "its installs kept");
});

// (fails before: yes — finding 5: there was no repository to tell a store by)
test("a store and a copy kept from before repositories were told apart: the first repository of that name that sends takes the store, and the copy from before is never taken again, going once idle a week", async (t) => {
  const dir = project(join(folder(t, "old"), "app"));
  let at = Date.now();
  // That machine's Filament from before: it takes no repository's identity, and this side sends it none.
  const r = receiver(t, { now: () => at, takes: ["transfer", "copy", "back"] });
  const old = await placed(r, dir, "chat-old");
  mkdirSync(join(old.folder, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(old.folder, "node_modules", "dep", "i.js"), "installed before\n");
  r.copies.release(old.id);
  assert.equal(/** @type {any} */ (r.copies.get(old.id))?.repo || "", "", "kept with no repository named");
  // Updated: the same project sent again, its repository named.
  r.state.takes.push("repo");
  writeFileSync(join(dir, "src", "b.js"), "export const b = 2;\n");
  const next = await placed(r, dir, "chat-new");
  assert.notEqual(next.id, old.id, "the copy from before is not taken again");
  assert.equal(next.folder, join(r.root, "From Laptop", basename(dir), "2"), "in the store from before, found again by its name");
  assert.equal(existsSync(join(next.folder, "node_modules")), false);
  const store = r.copies.storeOf(r.device, basename(dir), /** @type {any} */ ({ make: false, repo: gitIn(dir, "rev-list", "--max-parents=0", "HEAD") }));
  assert.ok(store.ok);
  assert.deepEqual((await mirrorHaves(join(store.folder, MIRROR))).sort(), [old.commit, next.commit].sort(), "one mirror: what was sent before is built on");
  // Let go as any idle copy is: a week on.
  r.copies.release(next.id);
  at += 8 * 24 * 3600_000;
  await r.copies.sweep();
  await r.copies.settled();
  assert.equal(existsSync(old.folder), false, "idle a week: gone");
});

// (fails before: yes — finding 2 of the review of 11-11: a newer launch took an idle copy and checked out over it, and
// what its sub-agent had changed there, never brought back, was gone: its old chat's ask answered 410)
test("a copy is taken for a newer launch only once its state is kept there: its old chat's change comes back from what was kept, for as long as that machine says", async (t) => {
  const dir = project(folder(t, "repo"));
  let at = Date.now();
  const r = receiver(t, { now: () => at });
  const first = await placed(r, dir, "chat-1");
  writeFileSync(join(first.folder, "src", "b.js"), "export const b = 2;\n");
  // Its turn ended, its change never asked for (this machine was away), and its hold lapsed.
  r.copies.release(first.id);
  const second = await placed(r, dir, "chat-2");
  assert.deepEqual([second.id, second.reused], [first.id, true], "the idle copy, taken again");
  assert.equal(existsSync(join(second.folder, "src", "b.js")), false, "checked out clean for the newer launch");
  const got = await r.agents.takeBack("Workstation", { copy: first.id, chat: "chat-1", repo: first.repo, base: first.commit });
  assert.equal(got.unchanged, false);
  assert.equal(gitIn(dir, "diff", "--name-status", first.commit, got.commit), "A\tsrc/b.js");
  assert.equal(/** @type {any} */ (first).keeps, IDLE_MS, "how long a change that stays there is kept, said as its copy is made");
  // The newer launch's own change is its own: the copy's, not what was kept.
  writeFileSync(join(second.folder, "src", "c.js"), "export const c = 3;\n");
  const newer = await r.agents.takeBack("Workstation", { copy: second.id, chat: "chat-2", repo: second.repo, base: second.commit });
  assert.equal(gitIn(dir, "diff", "--name-status", second.commit, newer.commit), "A\tsrc/c.js");
  // A week after its chat last used the copy, what was kept goes, and the ask says so; the copy is the newer launch's still.
  r.copies.hold(second.id, 2 * IDLE_MS);
  at += IDLE_MS + 60_000;
  await r.copies.sweep();
  await assert.rejects(r.agents.takeBack("Workstation", { copy: first.id, chat: "chat-1", repo: first.repo, base: first.commit }), (/** @type {any} */ e) => e.kind === "gone" && /nothing is kept of what it changed there any more/.test(e.message));
});

// (fails before: yes — finding 2: the copy was taken again whatever it held)
test("a copy whose state cannot be kept is not taken again: another is made, and with the machine's copies at their most the launch is refused in words, the copy left as it was", async (t) => {
  const dir = project(folder(t, "repo"));
  /** The copies whose capture is refused. @type {Set<string>} */
  const refused = new Set();
  const r = receiver(t, {
    maxCopies: 2,
    capture: /** @type {any} */ (async (/** @type {string} */ mirror, /** @type {string} */ f, /** @type {any} */ o) => (refused.has(f) ? { ok: false, error: "the copy holds a link out of its tree (x): what changed in it stays there" } : captureCopy(mirror, f, o))),
  });
  const first = await placed(r, dir, "chat-1");
  writeFileSync(join(first.folder, "src", "b.js"), "export const b = 2;\n");
  r.copies.release(first.id);
  refused.add(first.folder);
  const second = await placed(r, dir, "chat-2");
  assert.notEqual(second.id, first.id, "another copy");
  assert.equal(second.reused, false);
  assert.equal(existsSync(join(first.folder, "src", "b.js")), true, "the first as its chat left it");
  // Two copies, the most here: the first idle with what could not be kept, the second its launch's.
  await assert.rejects(placed(r, dir, "chat-3"), /2 copies on this machine, the most it keeps for them, 1 of them idle with a change that could not be kept aside/);
  assert.equal(existsSync(join(first.folder, "src", "b.js")), true, "still as its chat left it");
  assert.equal(r.copies.get(first.id)?.chat, "chat-1", "and still its chat's to ask for");
});

// (fails before: yes — finding 2: an idle copy that went to make room took what its sub-agent changed with it)
test("an idle copy that goes to make room for another project's has its state kept first, served to its chat after the copy is gone", async (t) => {
  const base = folder(t, "two");
  const one = project(join(base, "one"));
  const two = project(join(base, "two"), "export const two = 2;\n");
  const r = receiver(t, { maxCopies: 1 });
  const first = await placed(r, one, "chat-1");
  writeFileSync(join(first.folder, "src", "b.js"), "export const b = 2;\n");
  r.copies.release(first.id);
  const second = await placed(r, two, "chat-2");
  await r.copies.settled();
  assert.equal(r.copies.get(first.id), null, "the first went for room");
  assert.equal(existsSync(first.folder), false);
  assert.ok(second.id);
  const got = await r.agents.takeBack("Workstation", { copy: first.id, chat: "chat-1", repo: first.repo, base: first.commit });
  assert.equal(gitIn(one, "diff", "--name-status", first.commit, got.commit), "A\tsrc/b.js");
});

// (fails before: yes — finding 2: nothing was kept, so nothing bounded it)
test("a machine keeps KEPT_MAX states of copies at most: one its machine read back goes first, and with none read the next is refused", (t) => {
  const r = receiver(t);
  const KEPT_MAX = /** @type {any} */ (copiesModule).KEPT_MAX;
  assert.equal(KEPT_MAX, 24);
  const c = /** @type {any} */ (r.copies);
  assert.equal(typeof c.keepState, "function", "copies keep a state");
  const took = r.copies.take(r.device, "app");
  assert.ok(took.ok);
  const id = took.copy.id;
  const hex = (/** @type {number} */ n) => n.toString(16).padStart(40, "0");
  for (let i = 0; i < KEPT_MAX; i++) {
    r.copies.bind(id, `chat-${i}`);
    assert.equal(c.keepState(id, { name: `1-${i}`, base: hex(0), commit: hex(i + 1), files: 1, left: [] }), "", `kept ${i}`);
    r.copies.release(id);
    assert.ok(r.copies.take(r.device, "app").ok);
  }
  r.copies.bind(id, "chat-more");
  assert.match(c.keepState(id, { name: "1-more", base: hex(0), commit: hex(99), files: 1, left: [] }), /24 changes .* never read back/);
  // Its machine read one whole: that one gives way.
  c.keptRead(r.device, id, "chat-3");
  assert.equal(c.keepState(id, { name: "1-more", base: hex(0), commit: hex(99), files: 1, left: [] }), "");
  assert.equal(c.keptOf(r.device, id, "chat-3"), null, "the one read back went");
  assert.equal(c.keptOf(r.device, id, "chat-more")?.commit, hex(99));
});

// (fails before: yes — finding 1 of the review of 11-11, its part c: a change was captured while a turn of its chat still
// wrote in the copy, and came back half done)
test("no capture is taken while a turn of its chat runs in the copy: the ask is answered that one runs, tried again by the sender, and once the turn ended the change comes", async (t) => {
  const dir = project(folder(t, "repo"));
  let captures = 0;
  const r = receiver(t, {
    capture: /** @type {any} */ (async (/** @type {string} */ mirror, /** @type {string} */ f, /** @type {any} */ o) => {
      captures++;
      return captureCopy(mirror, f, o);
    }),
  });
  const copy = await placed(r, dir, "chat-1");
  assert.equal(r.copies.lease(copy.id, "chat-1"), "", "its turn starts");
  writeFileSync(join(copy.folder, "src", "b.js"), "export const b = ");
  const no = /** @type {any} */ (await r.s.back(r.device, { copy: copy.id, chat: "chat-1", haves: [] }));
  assert.deepEqual([no.status, no.runs], [409, true]);
  assert.match(String(no.error), /a turn of its chat still runs in its copy here/);
  assert.equal(captures, 0, "nothing read of a copy being written");
  // The sender asks a few times more, then leaves it for a later try: never read as refused for good, nor as gone.
  const asks = () => r.calls.filter(([row]) => row === "POST /transfers/back").length;
  const before = asks();
  await assert.rejects(r.agents.takeBack("Workstation", { copy: copy.id, chat: "chat-1", repo: copy.repo, base: copy.commit }), (/** @type {any} */ e) => e.kind === "cut" && /a turn of its chat still runs in its copy/.test(e.message));
  assert.ok(asks() - before > 1, "asked again");
  assert.equal(captures, 0);
  writeFileSync(join(copy.folder, "src", "b.js"), "export const b = 2;\n");
  r.copies.grace(copy.id);
  const got = await r.agents.takeBack("Workstation", { copy: copy.id, chat: "chat-1", repo: copy.repo, base: copy.commit });
  assert.equal(gitIn(dir, "diff", "--name-status", copy.commit, got.commit), "A\tsrc/b.js");
  assert.equal(gitIn(dir, "show", `${got.commit}:src/b.js`), "export const b = 2;", "whole, as its turn left it");
  assert.equal(captures, 1);
});
