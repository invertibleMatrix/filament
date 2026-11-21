// @ts-check
// A sub-agent's change marked as applied (10-29): its apply was refused where it overlapped the developer's edits, they
// brought it in by hand, and its card asked for an Apply for good. The developer — or the session's agent, with
// mark_applied — marks it: nothing is written, nothing of it waits, after a restart too, and its row says who marked
// it. The mark's undo makes it wait again as it did. A mark and an apply never cross, and a graph task's change is the
// graph's to merge.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskRefs } from "../src/adapters/git/worktree.js";
import { createSubagentRegistry, markUndoable } from "../src/app/agent/subagents.js";
import * as subagents from "../src/app/agent/subagents.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { gitFaultsHere } from "./helpers/git-fault.js";

/** Git calls held in this process, armed before the pool starts its first thread. */
const armed = gitFaultsHere();
/** A promise's answer, or "late" past `ms`. @template T @param {Promise<T>} p @param {number} ms @returns {Promise<T | "late">} */
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms, "late"))]);

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
const TEN = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-markapplied-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), TEN);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** @param {() => boolean} ok */
const until = async (ok) => {
  for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(ok(), "it came in time");
};

/**
 * A registry over a real folder whose sub-agent works in its own copy as `work` says, by exchange — its threads kept in
 * `threads`, as a session keeps them, so a registry made again over them stands for a restart; `now`, its clock.
 * @param {string} dir @param {(o: { n: number, cwd: string }) => void} work @param {Map<string, any[]>} [threads] @param {Record<string, any>} [more] @param {() => number} [now]
 */
const working = (dir, work, threads = new Map(), more = {}, now = Date.now) => {
  const cards = createAgentCardStore({ dataDir: null });
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    now,
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { ask: [] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: dir, model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      exchangeEnded: () => {},
      saveThread: (/** @type {string} */ c, /** @type {any} */ t) => threads.set(c, [...(threads.get(c) || []).filter((x) => x.id !== t.id), structuredClone(t)]),
      loadThreads: (/** @type {string} */ c) => structuredClone(threads.get(c) || []),
      ...more,
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const cwd = registry.hostOf(id)?.workdir || String(headers["x-filament-cwd"]);
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      work({ n, cwd });
      registry.relay(id, { type: "tool-end", name: "write", ok: true });
      registry.finish(id, { status: "done", error: null, report: "done", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "done" }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "done" }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return registry;
};
/** @param {ReturnType<typeof createSubagentRegistry>} registry @param {string} prompt */
const launched = async (registry, prompt) => {
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  return String(r.id);
};
/** Its change: line 3 shouted, and a new file. @param {{ n: number, cwd: string }} o */
const shout = ({ n, cwd }) => {
  if (n === 1) {
    writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "THREE, its\n"));
    writeFileSync(join(cwd, "c.txt"), "sea\n");
  } else writeFileSync(join(cwd, "d.txt"), "dee\n");
};
/**
 * The developer's edit over its line, so its apply is refused — then its change brought in by hand: both lines in a.txt,
 * its c.txt as it left it.
 * @param {string} dir
 */
const byHand = (dir) => {
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, yours\n"));
  return () => {
    writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "three, yours — and THREE, its\n"));
    writeFileSync(join(dir, "c.txt"), "sea\n");
  };
};
/** The folder's files the test reads. @param {string} dir */
const folderOf = (dir) => ({ a: read(join(dir, "a.txt")), c: read(join(dir, "c.txt")) });
/** Its refs as they stand, by name: what holds its commits. @param {string} dir @param {string} id */
const held = (dir, id) =>
  git(dir, "for-each-ref", "--format=%(refname) %(objectname)", `refs/filament/subagents/${id}/`)
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split(" "))
    .map(([name, at]) => [name.slice(`refs/filament/subagents/${id}/`.length), at]);
/** @param {Promise<{ ok: boolean, error?: string }>} p */
const errorOf = async (p) => {
  const r = await p;
  return r.ok ? "" : String(r.error);
};
/** @param {{ ok: boolean, error?: string }} r */
const refusalOf = (r) => (r.ok ? "" : String(r.error));
/**
 * Whether a mark the developer or the agent asked for holds `who`'s work now: a follow-up with no words changes nothing,
 * and is refused for such a mark before anything else. Filament's own mark of work found whole lets a follow-up go
 * ahead, and is caught at its git instead (`settling`, below).
 * @param {ReturnType<typeof createSubagentRegistry>} registry @param {string} who
 */
const markHeld = (registry, who) => /being marked as applied now/.test(refusalOf(registry.followUp(who, { prompt: "", chainId: "c1" })));
/**
 * What Filament reads of `who`'s work by itself, let run to its end: a settle would hold it within `ms`.
 * @param {ReturnType<typeof createSubagentRegistry>} registry @param {string} who
 */
const letRead = async (registry, who, ms = 2000) => {
  for (const end = Date.now() + ms; Date.now() < end && !markHeld(registry, who); ) await new Promise((r) => setTimeout(r, 5));
  while (markHeld(registry, who)) await new Promise((r) => setTimeout(r, 5));
};

// (fails before: yes — there was no way to say a change was in the folder already: its row waited for an Apply for good)
test("a change brought in by hand after its apply was refused is marked as applied: nothing written, nothing waits — after a restart too — and the row says who marked it", async () => {
  const dir = repo();
  const threads = new Map();
  const registry = working(dir, shout, threads);
  const id = await launched(registry, "shout three, and add c.txt");
  const bring = byHand(dir);
  const refused = await registry.apply(id, "c1", "owner");
  assert.deepEqual(!refused.ok && refused.conflicts?.map((c) => c.path), ["a.txt"], "its apply is refused where it overlaps");
  bring();
  const was = folderOf(dir);
  const refs = await taskRefs(dir, id);
  assert.ok(refs, "its work waits on its refs");

  const m = await registry.markTaken(id, "c1", "owner");
  assert.ok(m.ok, !m.ok ? m.error : "");
  assert.deepEqual(m.ok && m.files.map((f) => f.path), ["a.txt", "c.txt"], "what waited");
  assert.deepEqual(folderOf(dir), was, "nothing written");
  const work = /** @type {any} */ (registry.get(id))?.work;
  assert.deepEqual([work.pending, work.applied], [0, 1]);
  assert.deepEqual({ ...work.lastApplied, at: typeof work.lastApplied.at }, { at: "number", files: 2, by: "owner", hand: true, undo: true });
  assert.equal(await taskRefs(dir, id), null, "its refs went as an apply's do");
  assert.deepEqual(held(dir, id), [["marked-base", refs.base], ["marked-work", refs.head]], "its commits held for the undo, under refs a restart reads no work from");
  assert.match(await errorOf(registry.apply(id, "c1", "owner")), /^sub-agent sa_[0-9a-f]{8}'s changes were marked as applied by the developer: nothing of them waits$/);
  assert.match(await errorOf(registry.markTaken(id, "c1", "owner")), /'s changes were marked as applied by the developer: nothing of them waits$/, "marked once");

  // A restart: a registry that never knew it reads the mark from its thread, and nothing of it waits.
  const fresh = working(dir, () => {}, threads);
  const row = /** @type {any} */ (fresh.list("c1").find((x) => x.id === id));
  assert.deepEqual([row?.work?.pending, row?.work?.lastApplied?.hand, row?.work?.lastApplied?.undo], [0, true, true]);
  assert.match(await errorOf(fresh.preview(id, "c1")), /'s changes were marked as applied by the developer: nothing of them waits$/);
});

/** Its change, whole, beside an edit of the developer's own: what git apply of its patch leaves. @param {string} dir */
const whole = (dir) => {
  writeFileSync(join(dir, "a.txt"), TEN.replace("1\n", "ONE, yours\n").replace("3\n", "THREE, its\n"));
  writeFileSync(join(dir, "c.txt"), "sea\n");
};

// (fails before: yes — the owner's of 10-30: a helper's work brought in with git and committed, never applied nor
// marked, kept its card, its Needs you and the Changes tab's dot up for good)
test("work found in the folder whole — brought in with git or by hand — stops waiting as its Apply is read: nothing written, its undo kept; work in part still waits", async () => {
  const dir = repo();
  const threads = new Map();
  const registry = working(dir, shout, threads);
  const id = await launched(registry, "shout three, and add c.txt");
  const work = () => /** @type {any} */ (registry.get(id))?.work;
  // In part: c.txt as it left it, a.txt not yet.
  writeFileSync(join(dir, "c.txt"), "sea\n");
  const part = await registry.preview(id, "c1");
  assert.deepEqual(part.ok && part.came.map((c) => `${c.path} ${c.how}`), ["a.txt took", "c.txt same"]);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(work().pending, 2, "a file not in the folder: it waits, for the developer");

  whole(dir);
  const was = folderOf(dir);
  const p = await registry.preview(id, "c1");
  assert.deepEqual(p.ok && p.came.map((c) => c.how), ["same", "same"]);
  await until(() => work().pending === 0);
  assert.deepEqual({ ...work().lastApplied, at: typeof work().lastApplied.at }, { at: "number", files: 2, by: "found", came: { took: 0, merged: [], deleted: 0, same: 2 }, hand: true, undo: true });
  assert.deepEqual(folderOf(dir), was, "nothing written");
  assert.match(await errorOf(registry.apply(id, "c1", "owner")), /^sub-agent sa_[0-9a-f]{8}'s changes were found in the folder already, brought in another way: nothing of them waits$/);
  const u = await registry.unmarkTaken(id, "c1");
  assert.ok(u.ok, !u.ok ? u.error : "");
  assert.equal(work().pending, 2, "undone, it waits again");

  // (fails before: yes — the review of this change: the dry run its card reads at once found it again, and the undo
  // never stuck) Undone, it waits on the developer's word: no dry run and no turn's end finds it again, after a restart too.
  assert.ok((await registry.preview(id, "c1")).ok);
  await letRead(registry, id);
  registry.openTurn({ chainId: "c1", runId: "lead-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null, emit: () => {}, lead: true, round: () => 1 }).close();
  await letRead(registry, id);
  assert.deepEqual([work().pending, work().lastApplied], [2, null], "its undo stands");
  const fresh = working(dir, () => {}, threads);
  assert.ok((await fresh.preview(id, "c1")).ok);
  await letRead(fresh, id);
  assert.equal(/** @type {any} */ (fresh.get(id))?.work?.pending, 2, "and after a restart");
});

// (fails before: yes — found 11-02: work brought into the folder with git while no turn ran waited until the chat's next
// turn ended, and after a restart until one did, its "files to apply" up all that while)
test("work found in the folder whole stops waiting after a restart, and when the Agents tab reads the list, with no turn run", async () => {
  const dir = repo();
  const threads = new Map();
  const registry = working(dir, shout, threads);
  const id = await launched(registry, "shout three, and add c.txt");
  whole(dir);
  // A restart: the thread read back, its work read against the folder, which holds it whole.
  const fresh = working(dir, () => {}, threads);
  fresh.list("c1");
  await until(() => /** @type {any} */ (fresh.get(id))?.work?.pending === 0);
  assert.equal(/** @type {any} */ (fresh.get(id))?.work?.lastApplied?.by, "found");
  // No restart: the Agents tab's reads of the list settle it — at most once in a while for each chat — the reads after
  // its first, which name the version they hold, as well.
  // (fails before: yes — the bug hunt of 11-02: only a whole read settled, and the tab, Now and the tray read whole once)
  const dir2 = repo();
  let shift = 0;
  const registry2 = working(dir2, shout, new Map(), {}, () => Date.now() + shift);
  const id2 = await launched(registry2, "shout three, and add c.txt");
  await letRead(registry2, id2);
  const read = listRoute(registry2);
  const first = await read("/sessions/c1/subagents");
  await letRead(registry2, id2);
  assert.equal(/** @type {any} */ (registry2.get(id2))?.work?.pending, 2, "not in the folder yet: it waits");
  whole(dir2);
  shift += 31_000;
  await read(`/sessions/c1/subagents?since=${encodeURIComponent(first.version)}`);
  await until(() => /** @type {any} */ (registry2.get(id2))?.work?.pending === 0);
});

/**
 * The Agents list's route over a registry, read as the page reads it. @param {ReturnType<typeof createSubagentRegistry>} registry
 * @returns {(path: string) => Promise<any>}
 */
const listRoute = (registry) => {
  const call = createRouter(sessionRoutes(/** @type {any} */ ({ memory: {}, usage: {}, ops: {}, sessions: {}, subagents: registry, config: { get: () => ({}) } })));
  return async (path) => {
    const url = new URL(`http://127.0.0.1${path}`);
    const m = call("GET", url.pathname);
    assert.ok(m, "the route has a row");
    let body = "";
    let status = 0;
    const res = { headersSent: false, writableEnded: false, setHeader() {}, getHeader() {}, writeHead: (/** @type {number} */ s) => void (status = s), write: (/** @type {string} */ c) => void (body += c), end: (/** @type {string} */ c = "") => void (body += c), on() {} };
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url, path: url.pathname, method: "GET", params: m.params }), /** @type {any} */ ({}));
    assert.equal(status, 200, body);
    return JSON.parse(body);
  };
};

// (fails before: yes — the review of this change: an Apply pressed as Filament settled work it had found was refused,
// "being marked as applied now")
test("an Apply or a mark asked while Filament settles work it found waits for it, and is told the work was found", async () => {
  const dir = repo();
  const registry = working(dir, shout);
  const id = await launched(registry, "shout three, and add c.txt");
  const other = await launched(registry, "add d.txt");
  whole(dir);
  writeFileSync(join(dir, "d.txt"), "dee\n");
  /**
   * Its dry run read, and Filament caught settling what it found: held at the git that keeps its mark, the refs of the
   * work found written and its end not yet told. @param {string} who
   */
  const settling = async (who) => {
    const hold = armed.arm({ match: { has: ["update-ref", "--stdin"] }, hold: true });
    void registry.preview(who, "c1");
    assert.notEqual(await within(hold.reached, 10_000), "late", `caught while ${who}'s work settles`);
    return hold;
  };
  const FOUND = /^sub-agent sa_[0-9a-f]{8}'s changes were found in the folder already, brought in another way: nothing of them waits$/;
  const first = await settling(id);
  const applied = errorOf(registry.apply(id, "c1", "owner"));
  first.go();
  assert.match(await applied, FOUND);
  const second = await settling(other);
  const marked = errorOf(registry.markTaken(other, "c1", "owner"));
  second.go();
  assert.match(await marked, FOUND);
  for (const who of [id, other]) assert.equal(/** @type {any} */ (registry.get(who))?.work?.lastApplied?.by, "found");
});

// (fails before: yes — the same: nothing read the folder for it unless its card was on screen, and nothing at all did)
test("the lead's turn over, its sub-agents' work found in the folder whole stops waiting", async () => {
  const dir = repo();
  const registry = working(dir, shout);
  const id = await launched(registry, "shout three, and add c.txt");
  const door = registry.openTurn({ chainId: "c1", runId: "lead-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null, emit: () => {}, lead: true, round: () => 1 });
  whole(dir);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.pending, 2, "nothing read while the turn runs");
  door.close();
  await until(() => /** @type {any} */ (registry.get(id))?.work?.pending === 0);
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.lastApplied?.by, "found");
});

// (fails before: yes — against a read that held the work as a mark does from its start: a mark asked as the turn
// ended was refused, "being marked as applied now")
test("the lead's turn over, work that still waits is read holding nothing: a mark asked as it is read goes ahead", async () => {
  const dir = repo();
  const registry = working(dir, shout);
  const id = await launched(registry, "shout three, and add c.txt");
  registry.openTurn({ chainId: "c1", runId: "lead-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null, emit: () => {}, lead: true, round: () => 1 }).close();
  const m = await registry.markTaken(id, "c1", "owner");
  assert.ok(m.ok, !m.ok ? m.error : "");
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.lastApplied?.by, "owner");
});

// (fails before: yes — the same: there was no mark, and so no undo of one)
test("a mark's undo makes its change wait again as it did — its refs too, so after a restart — and only the newest apply, a mark, with nothing done since, is undone", async () => {
  const dir = repo();
  const threads = new Map();
  const registry = working(dir, shout, threads);
  const id = await launched(registry, "shout three, and add c.txt");
  const bring = byHand(dir);
  const refs = await taskRefs(dir, id);
  bring();
  const was = folderOf(dir);
  assert.ok((await registry.markTaken(id, "c1", "owner")).ok);

  const u = await registry.unmarkTaken(id, "c1");
  assert.ok(u.ok, !u.ok ? u.error : "");
  assert.deepEqual(u.ok && u.files.map((f) => f.path), ["a.txt", "c.txt"]);
  assert.deepEqual(folderOf(dir), was, "the folder is not touched");
  const work = /** @type {any} */ (registry.get(id))?.work;
  assert.deepEqual([work.pending, work.applied, work.lastApplied], [2, 0, null], "it waits as it did, the mark gone");
  assert.deepEqual(await taskRefs(dir, id), refs, "on the refs it waited on");
  assert.deepEqual(held(dir, id), [["base", refs?.base], ["work", refs?.head]], "and nothing else holds it");
  const p = await registry.preview(id, "c1");
  assert.deepEqual(p.ok && p.conflicts.map((c) => c.path), ["a.txt"], "its Apply says what it said before the mark");
  const fresh = working(dir, () => {}, threads);
  assert.equal(/** @type {any} */ (fresh.list("c1").find((x) => x.id === id))?.work?.pending, 2, "after a restart too");
  assert.match(await errorOf(registry.unmarkTaken(id, "c1")), /^sub-agent sa_[0-9a-f]{8}'s newest apply is no mark as applied: there is none to undo$/);

  // Marked, then worked on again: what it did since waits on its own, and the mark stands.
  assert.ok((await registry.markTaken(id, "c1", "owner")).ok);
  const again = /** @type {any} */ (registry.followUp(id, { prompt: "add d.txt", chainId: "c1", by: "owner" }));
  assert.ok(again.ok, String(again.error || ""));
  await until(() => /** @type {any} */ (registry.get(id))?.status !== "running");
  assert.deepEqual(/** @type {any} */ (registry.get(id))?.work?.files.map((/** @type {any} */ f) => f.path), ["d.txt"], "measured from the mark");
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.lastApplied?.undo, undefined, "no undo offered");
  assert.match(await errorOf(registry.unmarkTaken(id, "c1")), /has worked since its change was marked as applied, and what it did since waits on its own$/);
  assert.match(await errorOf(registry.unmarkTaken(id, "c2")), /^no sub-agent sa_[0-9a-f]{8} in this session$/);
});

// (fails before: yes — the owner's of 11-04: a mark could be undone for good, so its chat kept its thread for good — 75
// of them in one chat)
test("a mark can be undone for a day: past it no Undo is offered, the undo is refused in words, the thread its chat keeps holds no undo, and Clean up may let its hold go", async () => {
  const DAY = /** @type {any} */ (subagents).MARK_UNDO_MS ?? 24 * 3600_000;
  const dir = repo();
  const threads = new Map();
  let t = Date.now();
  const registry = working(dir, shout, threads, {}, () => t);
  const id = await launched(registry, "shout three, and add c.txt");
  byHand(dir)();
  t += 1000;
  assert.ok((await registry.markTaken(id, "c1", "owner")).ok);
  const undo = () => /** @type {any} */ (registry.get(id))?.work?.lastApplied?.undo;
  const kept = () => (threads.get("c1") || []).find((/** @type {any} */ x) => x.id === id);
  t += DAY;
  assert.equal(undo(), true, "a day on, to the millisecond: it can be undone");
  assert.equal(registry.known([id]).get(id)?.undo, true);
  assert.ok(markUndoable(kept(), t), "the thread its chat keeps, too");
  t += 1;
  assert.equal(undo(), undefined, "past the day: no Undo offered");
  assert.equal(registry.known([id]).get(id)?.undo, false, "Clean up may let its hold go");
  assert.equal(markUndoable(kept(), t), null, "its chat keeps its thread as any other");
  assert.match(await errorOf(registry.unmarkTaken(id, "c1")), /^sub-agent sa_[0-9a-f]{8}'s change was marked as applied more than a day ago: its mark can be undone no more$/);
  assert.deepEqual(held(dir, id).map(([name]) => name), ["marked-base", "marked-work"], "its hold stands till a Clean up lets it go");
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.pending, 0, "and nothing of it waits");
});

// (fails before: yes — the agent tool had no mark_applied)
test("the agent marks a change as applied with mark_applied: nothing written, its answer says so, the row names the agent; refused in words where it cannot be", async () => {
  const dir = repo();
  const registry = working(dir, shout);
  const id = await launched(registry, "shout three, and add c.txt");
  byHand(dir)();
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  try {
    /** @param {any} input */
    const call = (input) => door.subagents.run({ id: "toolu_1", input: { description: "mark", ...input }, emit: () => {}, signal: null });
    await assert.rejects(call({ mark_applied: true }), /^Error: mark_applied needs agent_id: the sub-agent whose changes are in your folder already$/);
    await assert.rejects(call({ agent_id: id, mark_applied: true, apply_changes: true }), /apply_changes or mark_applied, not both/);
    const was = folderOf(dir);
    const r = await call({ agent_id: id, mark_applied: true });
    assert.deepEqual([r.ok, r.wrote], [true, false]);
    assert.match(r.text, /^Marked the changes of sub-agent sa_[0-9a-f]{8} as applied: 2 files \(\+2 −1\) — a\.txt, c\.txt\. Nothing of it waits now, and nothing was written; the developer sees the mark, and can undo it\.$/);
    assert.deepEqual(folderOf(dir), was);
    assert.equal(/** @type {any} */ (registry.get(id))?.work?.lastApplied?.by, "agent");
    assert.deepEqual(door.inbox.take().filter((d) => d.kind === "applied"), [], "nothing changed under it: no line says so");
    const twice = await call({ agent_id: id, mark_applied: true });
    assert.deepEqual([twice.ok, twice.text], [false, `Not marked: sub-agent ${id}'s changes were marked as applied by the session's agent: nothing of them waits.`]);
  } finally {
    door.close();
  }
});

// (fails before: yes — there was no mark to keep apart from an apply)
test("a mark and an apply never cross: the one asked second is refused while the first runs, and nothing is written twice", async () => {
  const dir = repo();
  const registry = working(dir, shout);
  const one = await launched(registry, "shout three, and add c.txt");
  const [m, a] = await Promise.all([registry.markTaken(one, "c1", "owner"), registry.apply(one, "c1", "owner")]);
  assert.ok(m.ok, !m.ok ? m.error : "");
  assert.match(a.ok ? "" : a.error, /^sub-agent sa_[0-9a-f]{8}'s work is being marked as applied now$/);
  assert.equal(read(join(dir, "a.txt")), TEN, "the refused apply wrote nothing");
  assert.match(await errorOf(registry.rebase(one, "c1")), /'s changes were marked as applied by the developer: nothing of them waits$/);

  const two = await launched(registry, "shout three, and add c.txt");
  const [b, n] = await Promise.all([registry.apply(two, "c1", "owner"), registry.markTaken(two, "c1", "owner")]);
  assert.ok(b.ok, !b.ok ? b.error : "");
  assert.match(n.ok ? "" : n.error, /^sub-agent sa_[0-9a-f]{8}'s work is being applied now$/);
  assert.deepEqual(/** @type {any} */ (registry.get(two))?.work?.lastApplied?.hand, undefined, "applied, not marked");
});

// (fails before: yes — the same)
test("a task of the task graph is not marked: the graph reads its change as merged once it is applied", async () => {
  const dir = repo();
  const registry = working(dir, shout);
  const t = /** @type {any} */ (registry.launch({ origin: "agent", chainId: "c1", prompt: "THE BRIEF OF t1", description: "t1: shout three", background: true, task: { id: "t1", review: false }, requestId: "turn-1" }));
  await t.done;
  assert.match(await errorOf(registry.markTaken(String(t.id), "c1", "owner")), /^sub-agent sa_[0-9a-f]{8} does task t1 of the task graph, which reads its change as merged once it is applied: apply it, or drop the task$/);
  assert.equal(/** @type {any} */ (registry.get(String(t.id)))?.work?.pending, 2, "its work waits as it did");
});

// (fails before: yes — a graph task's sub-agent was never marked, whatever its graph's word: a change its planner
// brought in by hand left the task merging for good — the bug report of 11-10)
test("a task of the task graph whose change waits for its apply is marked where its graph takes the mark, and the graph is told as an apply tells it", async () => {
  const dir = repo();
  /** @type {any[]} */
  const told = [];
  /** The graph's word on a mark of its task's change: null, it takes it. @type {string | null} */
  let word = "its worker is still at work on task t1: its change waits for its report";
  const registry = working(dir, shout, new Map(), { taskMark: () => word, workApplied: (/** @type {any} */ o) => told.push(o) });
  const t = /** @type {any} */ (registry.launch({ origin: "agent", chainId: "c1", prompt: "THE BRIEF OF t1", description: "t1: shout three", background: true, task: { id: "t1", review: false }, requestId: "turn-1" }));
  await t.done;
  const id = String(t.id);
  assert.equal(await errorOf(registry.markTaken(id, "c1", "agent")), `sub-agent ${id} does task t1 of the task graph, and it can't be marked as applied now: its worker is still at work on task t1: its change waits for its report`);
  assert.deepEqual([told.length, /** @type {any} */ (registry.get(id))?.work?.pending], [0, 2], "its work waits as it did");
  word = null;
  const m = await registry.markTaken(id, "c1", "agent");
  assert.ok(m.ok, !m.ok ? m.error : "");
  assert.deepEqual(m.files.map((f) => f.path), ["a.txt", "c.txt"]);
  assert.equal(read(join(dir, "a.txt")), TEN, "nothing was written");
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.lastApplied?.by, "agent");
  assert.deepEqual(
    told.map((o) => [o.chainId, o.agentId, o.files.map((/** @type {any} */ f) => f.path)]),
    [["c1", id, ["a.txt", "c.txt"]]],
  );
});

// (fails before: yes — given back after a restart, it was marked: the graph, which the developer's Apply tells that its
// change merged, waited on it for good, and the tasks after it never started)
test("a task given back after a restart is not marked either: the graph still waits on its Apply", async () => {
  const dir = repo();
  const threads = new Map();
  // Its change did not merge: the graph says it waits for the developer, and the session keeps its thread.
  const registry = working(dir, shout, threads, { waitsForYou: () => true });
  const t = /** @type {any} */ (registry.launch({ origin: "agent", chainId: "c1", prompt: "THE BRIEF OF t1", description: "t1: shout three", background: true, task: { id: "t1", review: false }, requestId: "turn-1" }));
  await t.done;
  const id = String(t.id);
  registry.keepWork(id, "c1");
  const fresh = working(dir, () => {}, threads);
  assert.match(await errorOf(fresh.markTaken(id, "c1", "owner")), /^sub-agent sa_[0-9a-f]{8} did task t1 of the task graph before Filament restarted, and the graph reads its change as merged once it is applied: apply it with your choices — Keep yours where your folder has it already$/);
  assert.equal(/** @type {any} */ (fresh.list("c1").find((x) => x.id === id))?.work?.pending, 2, "its work waits as it did");
});

/** Its copy's work, from the second exchange on, can't be captured: the copy's link to the repository is gone. @param {{ n: number, cwd: string }} o */
const brokenAfterFirst = (o) => (o.n === 1 ? shout(o) : rmSync(join(o.cwd, ".git"), { force: true }));
/**
 * The session's settings with its sub-agents in a worktree, whose link `brokenAfterFirst` cuts: a patch has none (its
 * capture that fails is test/subagent-patch.test.js's).
 */
const IN_A_WORKTREE = { settings: () => ({ subagents: { ask: [], workspace: "worktree" }, loop: { permissions: "edit" } }) };

// (fails before: yes — marked with its copy still open, its refs went, and the copy's work had nothing to keep it)
test("work in a copy still open — its last work could not be captured — is not marked, as it is not rebased", async () => {
  const dir = repo();
  const registry = working(dir, brokenAfterFirst, new Map(), IN_A_WORKTREE);
  const id = await launched(registry, "shout three, and add c.txt");
  const refs = await taskRefs(dir, id);
  const again = /** @type {any} */ (registry.followUp(id, { prompt: "and d.txt", chainId: "c1", by: "owner" }));
  assert.ok(again.ok, String(again.error || ""));
  await until(() => /** @type {any} */ (registry.get(id))?.status !== "running");
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.open, true, "its copy stays open");
  assert.match(await errorOf(registry.markTaken(id, "c1", "owner")), /^sub-agent sa_[0-9a-f]{8}'s copy is still open \(its work could not be captured: .+\)$/);
  assert.deepEqual(await taskRefs(dir, id), refs, "its refs keep its work");
});

// (fails before: yes — the hold went only once the next exchange's work was captured: a copy that could not be captured
// kept it for good)
test("an exchange begun after a mark lets its hold go, though its work is never captured", async () => {
  const dir = repo();
  const registry = working(dir, brokenAfterFirst, new Map(), IN_A_WORKTREE);
  const id = await launched(registry, "shout three, and add c.txt");
  byHand(dir)();
  assert.ok((await registry.markTaken(id, "c1", "owner")).ok);
  const again = /** @type {any} */ (registry.followUp(id, { prompt: "and d.txt", chainId: "c1", by: "owner" }));
  assert.ok(again.ok, String(again.error || ""));
  await until(() => /** @type {any} */ (registry.get(id))?.status !== "running");
  assert.deepEqual(held(dir, id).filter(([name]) => name.startsWith("marked-")), [], "nothing held for an undo it can't have");
});

// (fails before: yes — a follow-up began while the mark was written, went on from the work the mark moved, and the mark
// still offered its undo once the hold was gone)
test("a follow-up asked while its change is being marked as applied is refused, and the mark stands with its undo", async () => {
  const dir = repo();
  const registry = working(dir, shout);
  const id = await launched(registry, "shout three, and add c.txt");
  byHand(dir)();
  const m = registry.markTaken(id, "c1", "owner");
  const f = /** @type {any} */ (registry.followUp(id, { prompt: "and d.txt", chainId: "c1", by: "owner" }));
  assert.match(f.ok ? "" : String(f.error), /^sub-agent sa_[0-9a-f]{8}'s work is being marked as applied now: ask it again once that is done$/);
  assert.ok((await m).ok);
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.lastApplied?.undo, true);
});

// (fails before: yes — it was marked with no thread to keep the mark in: nothing of it waited, no row said why, and
// nothing could undo it)
test("work a restart kept on its refs alone is not marked: there is no thread to keep the mark in", async () => {
  const dir = repo();
  const registry = working(dir, shout);
  const id = await launched(registry, "shout three, and add c.txt");
  const refs = await taskRefs(dir, id);
  const fresh = working(dir, () => {}, new Map());
  assert.match(await errorOf(fresh.markTaken(id, "c1", "owner")), /^Filament restarted since sub-agent sa_[0-9a-f]{8} ran, and its conversation, where a mark is kept, went with it: apply its work with your choices — Keep yours where your folder has it already$/);
  assert.deepEqual(await taskRefs(dir, id), refs, "its work waits as it did");
});

// (fails before: yes — the mark dropped its refs, and once its copy went git's gc took its commits: the undo failed)
test("a mark holds its work while it can be undone: its copy let go and git's garbage collected, the undo finds it", async () => {
  const dir = repo();
  const registry = working(dir, shout);
  const id = await launched(registry, "shout three, and add c.txt");
  const refs = await taskRefs(dir, id);
  byHand(dir)();
  assert.ok((await registry.markTaken(id, "c1", "owner")).ok);
  // Its copy let go, as the cap of kept copies lets one go, and every commit nothing holds collected.
  const copies = git(dir, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).slice(1);
  for (const l of copies) git(dir, "worktree", "remove", "-f", "-f", l.slice("worktree ".length));
  git(dir, "reflog", "expire", "--expire=now", "--all");
  git(dir, "gc", "--prune=now", "--quiet");
  const u = await registry.unmarkTaken(id, "c1");
  assert.ok(u.ok, !u.ok ? u.error : "");
  assert.deepEqual(u.ok && u.files.map((f) => f.path), ["a.txt", "c.txt"]);
  assert.deepEqual(await taskRefs(dir, id), refs, "it waits on its refs again");
});

// (fails before: yes — a follow-up that changed nothing left the mark undoable, as if it had not worked from it)
test("a mark's undo ends once its sub-agent works again, though it changed nothing: what the mark held goes", async () => {
  const dir = repo();
  const registry = working(dir, (o) => (o.n === 1 ? shout(o) : undefined));
  const id = await launched(registry, "shout three, and add c.txt");
  byHand(dir)();
  assert.ok((await registry.markTaken(id, "c1", "owner")).ok);
  const again = /** @type {any} */ (registry.followUp(id, { prompt: "look it over", chainId: "c1", by: "owner" }));
  assert.ok(again.ok, String(again.error || ""));
  await until(() => /** @type {any} */ (registry.get(id))?.status !== "running");
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.lastApplied?.undo, undefined, "no undo offered");
  assert.match(await errorOf(registry.unmarkTaken(id, "c1")), /has worked since its change was marked as applied, and what it did since waits on its own$/);
  assert.deepEqual(held(dir, id), [], "nothing holds its commits");
});

// (fails before: yes — a restart's thread keeps the first 200 of its files: the mark counted 200)
test("a mark counts every file that waited, after a restart too, where its thread keeps 200 of them", async () => {
  const dir = repo();
  const threads = new Map();
  const registry = working(dir, ({ cwd }) => {
    for (let i = 0; i < 205; i++) writeFileSync(join(cwd, `f${i}.txt`), `${i}\n`);
  }, threads);
  const id = await launched(registry, "write 205 files");
  const fresh = working(dir, () => {}, threads);
  const m = await fresh.markTaken(id, "c1", "owner");
  assert.equal(m.ok && m.files.length, 205);
  assert.equal(/** @type {any} */ (fresh.get(id))?.work?.lastApplied?.files, 205);
});

// (fails before: yes — a mark or an apply asked while the rebase ran waited for its lock and then moved the work it was
// redoing)
test("a mark or an apply asked while its change is being sent back to rebase is refused", async () => {
  const dir = repo();
  const registry = working(dir, shout);
  const id = await launched(registry, "shout three, and add c.txt");
  byHand(dir);
  assert.equal((await registry.apply(id, "c1", "owner")).ok, false, "its apply is refused where it overlaps");
  const rebased = registry.rebase(id, "c1");
  const [m, a, r] = await Promise.all([registry.markTaken(id, "c1", "owner"), registry.apply(id, "c1", "owner"), registry.rebase(id, "c1")]);
  for (const [what, out] of /** @type {const} */ ([["mark", m], ["apply", a], ["rebase", r]])) assert.match(out.ok ? "" : out.error, /^sub-agent sa_[0-9a-f]{8}'s change is being sent back to rebase now$/, what);
  await rebased;
  await until(() => /** @type {any} */ (registry.get(id))?.status !== "running");
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.lastApplied?.hand, undefined, "nothing was marked");
});
