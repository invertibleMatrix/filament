// @ts-check
// A chat moved to a worktree with its own uncommitted files (HarnessV4_Git_Plan §12) through the app, against real
// repositories: what goes and what stays with why (GW-D69, GW-D80, GW-D87), the move itself and where everyone's files
// are after it (GW-D71, GWC-159), the Changes tab reading the files where they are (GW-D88), the agent's word on its
// next turn and only then (GW-D72, GW-D86), the conversation's row and Move back (GW-D77, GW-D79, GWC-176, GWC-177),
// a place on another commit (GW-D81, GWC-182), the sheet's list checked at the click (GWC-167), a chat in a subfolder
// (GWC-186), and a place the repository has (GW-D70). The note and the coding agent's block are read alone.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { moveNote, toldPatch } from "../src/core/move-note.js";
import { MOVED_BLOCK, agentContext } from "../src/app/agent-context.js";
import { movedSince } from "../src/app/sessions/move.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made.reverse())
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim();
/** `git status` one line per file, untracked ones by name. @param {string} dir */
const status = (dir) =>
  execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: dir, encoding: "utf8", windowsHide: true }).split("\n").filter(Boolean).sort();
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
/** @param {any} c */
const answersTo = (c) => (Array.isArray(c.body?.messages?.at(-1)?.content) ? c.body.messages.at(-1).content : []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);

describe("the agent's word, alone", () => {
  // (fails before: yes — no move was said to any agent)
  test("the moves its agent has not heard of, said as one, and marked told", () => {
    assert.equal(moveNote({}), null);
    assert.equal(moveNote({ moves: [{ id: "m1", told: true, from: { cwd: "/r" }, to: { cwd: "/r-x" }, files: [] }] }), null);
    const meta = {
      moves: [
        { id: "m0", told: true, from: { cwd: "/old" }, to: { cwd: "/r" }, files: [] },
        { id: "m1", told: false, from: { cwd: "/r" }, to: { cwd: "/r-x", branch: "x" }, files: [{ path: "a.txt" }] },
        { id: "m2", told: false, from: { cwd: "/r-x" }, to: { cwd: "/r-y", branch: "y" }, files: [{ path: "a.txt" }, { path: "b.txt" }] },
      ],
    };
    const note = moveNote(meta);
    assert.deepEqual(note?.ids, ["m1", "m2"]);
    assert.match(String(note?.text), /^\[Filament: since your last turn the person moved this chat from \/r to \/r-y \(branch y\)\. Work in \/r-y from now on: your commands start there, and the paths in earlier turns that name \/r are the old folder\. Your uncommitted changes moved with it, at the same paths: a\.txt, b\.txt\. What git ignores \(node_modules, \.env, build output\) stayed in \/r: install or copy what your work needs before you run it\.\]$/);
    assert.deepEqual(toldPatch(meta, ["m1", "m2"]).moves.map((/** @type {any} */ m) => m.told), [true, true, true]);
    assert.match(String(moveNote({ moves: [{ id: "m", from: { cwd: "/r" }, to: { cwd: "/r-x" }, files: [] }] })?.text), /No uncommitted change of yours was there to move\./);
  });

  // (fails before: yes — a coding agent's prompt carried memory's blocks alone)
  test("a coding agent hears it after the person's words, with this prompt alone", () => {
    const body = { messages: [{ role: "user", content: "go on" }] };
    const ctx = agentContext({ format: "anthropic", body, graph: false, moved: "[Filament: moved]" });
    assert.deepEqual(ctx.prompt.at(-1), { id: MOVED_BLOCK, text: "[Filament: moved]" });
    assert.equal(agentContext({ format: "anthropic", body, graph: false }).prompt.some((b) => b.id === MOVED_BLOCK), false);
  });

  // (fails before: yes — the drive: after a move, a coding agent's fresh start was said as a lost session)
  test("why a coding agent has no session where the chat works now: it moved there since the agent's last turn", () => {
    const meta = { moves: [{ id: "m1", atTurn: 1, to: { cwd: "/w/r-x" } }, { id: "m2", atTurn: 3, to: { cwd: "/w/r-y" } }] };
    assert.equal(movedSince(meta, 3), "r-y", "no turn since the newest move");
    assert.equal(movedSince(meta, 4), null, "a turn ran there since");
    assert.equal(movedSince({}, 1), null);
  });
});

describe("through the app", () => {
  /** @type {string} */ let base;
  /** @type {any} */ let up;
  /** @type {any} */ let shim;

  before(async () => {
    base = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-move-")));
    made.push(base);
    up = await fakeUpstream(async (call) => {
      const last = textOf((call.body?.messages || []).at(-1));
      const reply = (/** @type {any[]} */ b, stop = "end_turn") => anthropicReply("", { model: call.body?.model || "m-1", stop, blocks: b, usage: { input_tokens: 5, output_tokens: 3 } });
      const answered = answersTo(call);
      if (answered.includes("e1") || answered.includes("e2") || answered.includes("w3")) return reply([{ type: "text", text: "WROTE" }]);
      if (answered.includes("w1")) return reply([toolUse("e1", "edit", { path: "a.txt", edits: [{ oldText: "one", newText: "one, edited" }] })], "tool_use");
      if (answered.includes("r2")) return reply([toolUse("e2", "edit", { path: "b.txt", edits: [{ oldText: "bee", newText: "bee, edited" }] })], "tool_use");
      if (/write mine/.test(last)) return reply([toolUse("w1", "write", { path: "mine.txt", content: "mine\n" }), toolUse("r1", "read", { path: "a.txt" })], "tool_use");
      if (/edit b/.test(last)) return reply([toolUse("r2", "read", { path: "b.txt" })], "tool_use");
      if (/write deep/.test(last)) return reply([toolUse("w3", "write", { path: "deep.txt", content: "deep\n" })], "tool_use");
      return reply([{ type: "text", text: `ANSWER TO ${last.split("\n")[0]}` }]);
    });
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [base], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
    made.push(shim.dataDir);
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  let seq = 0;
  /** A repository of its own under the roots: a.txt, b.txt and sub/c.txt committed on main. */
  const repo = () => {
    const r = join(base, `p${++seq}`);
    mkdirSync(join(r, "sub"), { recursive: true });
    git(r, "init", "-q", "-b", "main");
    git(r, "config", "core.autocrlf", "false");
    writeFileSync(join(r, "a.txt"), "one\n");
    writeFileSync(join(r, "b.txt"), "bee\n");
    writeFileSync(join(r, "sub", "c.txt"), "sea\n");
    git(r, "add", "-A");
    git(r, "commit", "-qm", "init");
    return r;
  };
  const at = (/** @type {string} */ id, rest = "") => `/api/sessions/${encodeURIComponent(id)}${rest}`;
  /** A chat in `cwd` that ran one turn of `words`. @param {string} cwd @param {string} words */
  const chatThat = async (cwd, words) => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "m-1", preset: "plain" } });
    const id = String((await s.json()).id);
    await turn(id, words);
    return id;
  };
  /** @param {string} id @param {string} words */
  const turn = async (id, words) => {
    const t = await shim.api(at(id, "/turns"), { method: "POST", body: { content: words, stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    return t.text();
  };
  /** @param {string} id @param {string} q */
  const sheet = async (id, q) => {
    const r = await shim.api(at(id, `/move?${q}`));
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  /** @param {string} id @param {any} body */
  const move = (id, body) => shim.api(at(id, "/move"), { method: "POST", body });
  /** @param {string} id */
  const transcript = async (id) => (await shim.api(at(id, "/transcript"))).json();
  /** @param {string} id */
  const movedRows = async (id) => (await transcript(id)).boundaries.filter((/** @type {any} */ b) => b.type === "moved");
  const sorted = (/** @type {any[]} */ list) => list.map((f) => f.path).sort();

  // (fails before: yes — GWC-159: there was no move)
  test("its own files go to a new worktree, everyone else's stay; the Changes tab, the row and its next turn follow it", async () => {
    const r = repo();
    const id = await chatThat(r, "write mine");
    // Someone else's, in the same folder.
    writeFileSync(join(r, "other.txt"), "theirs\n");
    writeFileSync(join(r, "b.txt"), "bee\ntheirs\n");
    const plan = await sheet(id, "name=fix");
    assert.deepEqual([sorted(plan.goes), plan.stays, plan.others, plan.blocked], [["a.txt", "mine.txt"], [], 2, []]);
    assert.deepEqual([plan.to.new, plan.to.branch, plan.to.folder, plan.from.branch], [true, "fix", `${r}-fix`, "main"]);
    const res = await move(id, { to: { name: "fix" }, files: sorted(plan.goes) });
    assert.equal(res.status, 200, await res.clone().text());
    const done = await res.json();
    assert.equal(done.cwd, `${r}-fix`);
    // Main keeps everyone else's and none of its; the worktree has its, on its branch.
    assert.deepEqual(status(r), [" M b.txt", "?? other.txt"]);
    assert.equal(read(join(r, "a.txt")), "one\n");
    const wt = `${r}-fix`;
    assert.deepEqual(status(wt), [" M a.txt", "?? mine.txt"]);
    assert.deepEqual([read(join(wt, "a.txt")), read(join(wt, "mine.txt")), git(wt, "branch", "--show-current")], ["one, edited\n", "mine\n", "fix"]);
    // Its Changes tab reads them where they are now (GW-D88); turn 1's own changes are still turn 1's.
    const chat = await (await shim.api(`/api/memory/sessions/${id}/changes?scope=chat`)).json();
    assert.deepEqual(chat.files.map((/** @type {any} */ f) => [f.path, f.place === git(wt, "rev-parse", "--show-toplevel")]).sort(), [["a.txt", true], ["mine.txt", true]]);
    const one = await (await shim.api(`/api/memory/sessions/${id}/changes?turn=1`)).json();
    assert.deepEqual(one.files.map((/** @type {any} */ f) => [f.path, f.place === git(r, "rev-parse", "--show-toplevel")]).sort(), [["a.txt", true], ["mine.txt", true]]);
    // The row, with Move back while no turn has run since (GW-D79).
    const [row] = await movedRows(id);
    assert.deepEqual([row.from, row.to, row.branch, row.files, row.afterTurn, row.undoable], [`p${seq}`, `p${seq}-fix`, "fix", 2, 1, true]);
    // The next turn hears it, in its newest message; the one after does not (GW-D72, GW-D86).
    const mark = up.received.length;
    assert.match(await turn(id, "after the move"), /ANSWER TO after the move/);
    const heard = textOf(up.received[mark].body.messages.at(-1));
    assert.ok(heard.includes(`moved this chat from ${r} to ${wt} (branch fix)`), heard);
    assert.ok(heard.includes("at the same paths: a.txt, mine.txt") || heard.includes("at the same paths: mine.txt, a.txt"), heard);
    // (fails before: yes — the request's record, which the person reads, said "moved to another place", the code's word)
    const changes = /** @type {any} */ (shim.app).usage.list(10).flatMap((/** @type {any} */ rec) => rec.changes || []).filter((/** @type {string} */ c) => c.includes("the chat moved"));
    assert.deepEqual(changes, ["agent: the chat moved to another folder since its last turn — the newest message carries the note in this request alone"]);
    const again = up.received.length;
    await turn(id, "and again");
    assert.equal(textOf(up.received[again].body.messages.at(-1)).includes("moved this chat"), false);
    const [after1] = await movedRows(id);
    assert.equal(after1.undoable, false, "a turn ran since: the way back is the sheet (GWC-177)");
    const refused = await shim.api(at(id, "/move/back"), { method: "POST", body: { id: after1.id } });
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /a turn ran in p\d+-fix since/);
  });

  // (fails before: yes — GWC-176)
  test("Move back before any turn: the files back where they were, the worktree and its branch gone, the row gone", async () => {
    const r = repo();
    const id = await chatThat(r, "write mine");
    const plan = await sheet(id, "name=back");
    const res = await move(id, { to: { name: "back" }, files: sorted(plan.goes) });
    assert.equal(res.status, 200, await res.clone().text());
    const [row] = await movedRows(id);
    const b = await shim.api(at(id, "/move/back"), { method: "POST", body: { id: row.id } });
    assert.equal(b.status, 200, await b.clone().text());
    assert.deepEqual(await b.json(), { ok: true, cwd: r, left: null });
    assert.deepEqual(status(r), [" M a.txt", "?? mine.txt"]);
    assert.equal(existsSync(`${r}-back`), false);
    assert.equal(git(r, "branch", "--list", "back"), "");
    assert.deepEqual(await movedRows(id), []);
    const chat = await (await shim.api(`/api/memory/sessions/${id}/changes?scope=chat`)).json();
    assert.deepEqual(chat.files.map((/** @type {any} */ f) => [f.path, f.place === git(r, "rev-parse", "--show-toplevel")]).sort(), [["a.txt", true], ["mine.txt", true]]);
    // Its next turn hears of no move.
    const mark = up.received.length;
    await turn(id, "still here");
    assert.equal(textOf(up.received[mark].body.messages.at(-1)).includes("moved this chat"), false);
  });

  // (fails before: yes — the bug hunt of 10-30, GIT-8: the old place was looked at for uncommitted changes beside the
  // slower reads of the new one, then written without another look: an edit saved there meanwhile was written over)
  test("Move back looks at the old place last, just before it writes there: an edit saved while it read the rest stops it, kept", async () => {
    const r = repo();
    const id = await chatThat(r, "write mine");
    const plan = await sheet(id, "name=race");
    const res = await move(id, { to: { name: "race" }, files: sorted(plan.goes) });
    assert.equal(res.status, 200, await res.clone().text());
    const wt = `${r}-race`;
    // Someone saves a.txt in the old place while Move back reads the new one: git's clean filter there, armed once.
    const probe = join(base, `probe-${seq}.cjs`);
    const armed = join(base, `armed-${seq}`);
    writeFileSync(
      probe,
      [
        "const fs = require('fs');",
        "const [place, target, armed] = process.argv.slice(2);",
        "const same = (a, b) => fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase();",
        "const chunks = [];",
        "process.stdin.on('data', (c) => chunks.push(c));",
        "process.stdin.on('end', () => {",
        "  const out = () => process.stdout.write(Buffer.concat(chunks));",
        "  if (!fs.existsSync(armed) || !same(process.cwd(), place)) return out();",
        "  fs.rmSync(armed);",
        "  setTimeout(() => (fs.writeFileSync(target, \"someone's edit\\n\"), out()), 1500);",
        "});",
      ].join("\n"),
    );
    const slash = (/** @type {string} */ p) => p.replace(/\\/g, "/");
    git(r, "config", "filter.probe.clean", [process.execPath, probe, wt, join(r, "a.txt"), armed].map((p) => `"${slash(p)}"`).join(" "));
    writeFileSync(join(r, ".git", "info", "attributes"), "a.txt filter=probe\n");
    writeFileSync(armed, "");
    const [row] = await movedRows(id);
    const b = await shim.api(at(id, "/move/back"), { method: "POST", body: { id: row.id } });
    assert.equal(existsSync(armed), false, "the edit was saved while it read");
    assert.equal(b.status, 409, await b.clone().text());
    assert.match((await b.json()).error, /^not moved back: a\.txt has uncommitted changes in p\d+ now$/);
    assert.equal(read(join(r, "a.txt")), "someone's edit\n", "their edit kept");
    assert.deepEqual(status(wt), [" M a.txt", "?? mine.txt"], "the chat's files where the move left them");
    assert.equal((await transcript(id)).cwd, wt);
  });

  // (fails before: yes — GWC-178, GWC-179, GW-D87)
  test("what stays, with why: changed since its agent wrote it, committed, a change that was not all its agents'", async () => {
    const r = repo();
    writeFileSync(join(r, "b.txt"), "bee\nsomeone's\n");
    const id = await chatThat(r, "edit b");
    await turn(id, "write mine");
    writeFileSync(join(r, "mine.txt"), "mine\nby hand\n");
    git(r, "commit", "-qm", "theirs", "--", "a.txt");
    const plan = await sheet(id, "name=stays");
    assert.deepEqual(plan.goes, []);
    assert.deepEqual(plan.stays.map((/** @type {any} */ f) => [f.path, f.why]).sort(), [
      ["a.txt", "committed"],
      ["b.txt", "not all of its uncommitted change is its agents'"],
      ["mine.txt", "changed since its agent last wrote it"],
    ]);
    // Nothing to carry: the chat moves alone (GWC-163), and every file stays as it was.
    const res = await move(id, { to: { name: "stays" }, files: [] });
    assert.equal(res.status, 200, await res.clone().text());
    assert.deepEqual(status(r), [" M b.txt", "?? mine.txt"]);
    assert.deepEqual(status(`${r}-stays`), []);
  });

  // (fails before: yes — GWC-167, GWC-182, GW-D70)
  test("checked at the click; a place on another commit that differs on a file stops it; a place on the same commit takes it", async () => {
    const r = repo();
    const id = await chatThat(r, "write mine");
    const stale = await move(id, { to: { name: "late" }, files: ["mine.txt"] });
    assert.equal(stale.status, 409);
    const said = await stale.json();
    assert.match(said.error, /what goes changed since the sheet was read/);
    assert.deepEqual(sorted(said.plan.goes), ["a.txt", "mine.txt"]);
    assert.equal(existsSync(`${r}-late`), false, "nothing was made");
    // Another commit that changed a.txt.
    const ahead = `${r}-ahead`;
    git(r, "worktree", "add", "-q", "-b", "ahead", ahead);
    writeFileSync(join(ahead, "a.txt"), "one\nahead\n");
    git(ahead, "commit", "-qam", "ahead");
    const there = await sheet(id, `place=${encodeURIComponent(ahead)}`);
    assert.deepEqual(there.blocked, ["a.txt differs between the two commits: pick a new worktree, or move it by hand"]);
    const no = await move(id, { to: { place: ahead } });
    assert.equal(no.status, 409);
    assert.deepEqual(status(r), [" M a.txt", "?? mine.txt"], "nothing moved");
    // A place on the same commit, made by hand.
    const same = `${r}-same`;
    git(r, "worktree", "add", "-q", "-b", "same", same);
    const yes = await move(id, { to: { place: same } });
    assert.equal(yes.status, 200, await yes.clone().text());
    assert.deepEqual([status(r), status(same)], [[], [" M a.txt", "?? mine.txt"]]);
    assert.equal((await yes.json()).cwd, same);
  });

  // (fails before: yes — both refusals said "place", the code's word for a folder or worktree: "not a place of this
  // repository", "a chat moves between the places of a repository")
  test("a move's refusals name folders and worktrees: a folder that is none of the repository's, a chat outside any repository", async () => {
    const r = repo();
    const id = await chatThat(r, "write mine");
    const nowhere = join(base, "nowhere");
    const lost = await move(id, { to: { place: nowhere } });
    assert.deepEqual([lost.status, (await lost.json()).error], [404, `not a folder or worktree of this repository: ${nowhere}`]);
    const plain = join(base, "plain");
    mkdirSync(plain);
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: plain, model: "m-1", preset: "plain" } });
    const outside = await shim.api(at(String((await s.json()).id), "/move?name=x"));
    assert.equal(outside.status, 409);
    assert.match((await outside.json()).error, /: a chat moves between a repository's folder and its worktrees$/);
  });

  // (fails before: yes — GWC-186)
  test("a chat in a subfolder works in the same subfolder of the new worktree", async () => {
    const r = repo();
    const id = await chatThat(join(r, "sub"), "write deep");
    const plan = await sheet(id, "name=deep");
    assert.deepEqual([sorted(plan.goes), plan.to.cwd], [["sub/deep.txt"], join(`${r}-deep`, "sub")]);
    const res = await move(id, { to: { name: "deep" }, files: ["sub/deep.txt"] });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal((await res.json()).cwd, join(`${r}-deep`, "sub"));
    assert.equal(read(join(`${r}-deep`, "sub", "deep.txt")), "deep\n");
    assert.equal(existsSync(join(r, "sub", "deep.txt")), false);
  });

  // (fails before: yes — GWC-187: there was no move; a forked chat reads its tree's folder before its own)
  test("a chat forked into a worktree follows the move, and goes back with Move back", async () => {
    const r = repo();
    const id = await chatThat(r, "write mine");
    const archive = /** @type {any} */ (shim.app).memory.archive;
    archive.mergeMeta(id, { tree: { ...(archive.getChain(id).meta?.tree || {}), worktree: r } });
    const plan = await sheet(id, "name=forked");
    const res = await move(id, { to: { name: "forked" }, files: plan.goes.map((/** @type {any} */ f) => f.path) });
    assert.equal(res.status, 200, await res.clone().text());
    const done = await res.json();
    assert.equal(done.cwd, `${r}-forked`);
    assert.equal(archive.getChain(id).meta.tree.worktree, `${r}-forked`);
    assert.equal((await transcript(id)).cwd, `${r}-forked`);
    const back = await shim.api(at(id, "/move/back"), { method: "POST", body: { id: done.move.id } });
    assert.equal(back.status, 200, await back.clone().text());
    assert.equal(archive.getChain(id).meta.tree.worktree, r);
    assert.equal((await transcript(id)).cwd, r);
  });

  // (fails before: yes — GWC-180, GWC-181: there was no move to hold apart from a turn)
  test("a question waiting for its answer holds the move; a message sent while the chat moves is told so, with who holds it", async () => {
    const r = repo();
    const id = await chatThat(r, "write mine");
    const app = /** @type {any} */ (shim.app);
    const archive = app.memory.archive;
    archive.mergeMeta(id, { paused: { kind: "ask", at: Date.now() } });
    assert.deepEqual((await sheet(id, "name=wait")).blocked, ["a question waits for your answer"]);
    const refused = await move(id, { to: { name: "wait" }, files: ["a.txt", "mine.txt"] });
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /a question waits for your answer/);
    archive.mergeMeta(id, { paused: undefined });
    // The chat held as a move holds it: the page queues the message on the holder and sends it once the move is done.
    const key = archive.getChain(id).key;
    const lock = await app.sessionTurns.acquire(key, { window: "move", client: "the move to another folder" });
    assert.ok(lock.ok);
    try {
      const t = await shim.api(at(id, "/turns"), { method: "POST", body: { content: "hello", stream: false } });
      assert.equal(t.status, 409);
      const body = await t.json();
      assert.deepEqual([body.error, body.holder?.window], ["this chat is moving to another folder — the message goes once it has moved", "move"]);
    } finally {
      app.sessionTurns.release(key, lock.token);
    }
    assert.match(await turn(id, "after"), /ANSWER TO after/);
  });
});
