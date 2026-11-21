// @ts-check
// Filament's own reads of a chat's waiting sub-agent work against its folder (`settleFound`) keep out of the way of the
// rest (the Hunter's of 11-02, and the reviews after): one read at a time for each sub-agent, however many turns end and
// however often the Agents list is read meanwhile — they cost one more read, never one each, a while after the last,
// and none while the chat's turn runs unless the person asked —, and every ask is answered. A read is made in the
// repository's turn, and whoever comes to work in it goes ahead: an Apply pressed while one reads — its git holding the
// developer's files — stops it, and its writes land. A read the folder moved under is never marked on, and work found
// whole is marked though its stats stand for nothing (attributes read from a tree).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { gitFaultsHere } from "./helpers/git-fault.js";

// What the tests do to git and count of the folder, in one place: a git call held, or another program run in its place,
// and the reads of the work counted by the stat each makes of its file. Git starts on the spawn pool's threads, which
// this file arms before any starts (`gitFaultsHere`).
const faults = gitFaultsHere();
/**
 * A git call held where it ends: the first one `match` names after `holdAt` is armed has done its work — `reached`
 * saying so — and its end is told only once `go()` is called, or at once where its stop comes first, as a git ended by
 * its stop answers. `instead`: a program run in its place, with the call's own options — its stop ends it.
 * @param {import("./helpers/git-fault.js").Words} match @param {[string, string[]] | null} [instead]
 */
const holdAt = (match, instead = null) => faults.arm(instead ? { match, instead } : { match, hold: true });
/** The folder's file each read of the work looks at once, by its stat (`foundWhole`): how many reads there were. */
let readsOf = "";
let reads = 0;
/** The next stat of a file held (`statHeld`): it is told reached when asked, and answers once let go. @type {{ path: string, came: () => void, until: Promise<void> } | null} */
let statGate = null;
const lstat = fsp.lstat;
/** @this {any} @param {any[]} a */
/** @type {any} */ (fsp).lstat = function (...a) {
  if (readsOf && String(a[0]) === readsOf) reads++;
  if (statGate && String(a[0]) === statGate.path) {
    const g = statGate;
    statGate = null;
    g.came();
    return g.until.then(() => /** @type {any} */ (lstat).apply(this, a));
  }
  return /** @type {any} */ (lstat).apply(this, a);
};
syncBuiltinESMExports();
/**
 * The next stat Filament asks of `path` without git — a read standing on the one before it reads the folder by its
 * stats alone — held: `reached` once asked, answered once `go()` is called. @param {string} path
 */
const statHeld = (path) => {
  /** @type {() => void} */
  let go = () => {};
  /** @type {() => void} */
  let came = () => {};
  const until = new Promise((r) => (go = () => r(undefined)));
  const reached = new Promise((r) => (came = () => r(undefined)));
  statGate = { path, came, until: /** @type {Promise<void>} */ (until) };
  return { reached, go };
};

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
  const dir = mkdtempSync(join(tmpdir(), "filament-settle-turns-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), TEN);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** Its change: line 3 as X. @param {string} cwd */
const ex = (cwd) => writeFileSync(join(cwd, "a.txt"), TEN.replace("3\n", "X\n"));
/** What a follow-up's run waits on before it ends: at once, unless a test holds it. @type {Promise<unknown>} */
let followUpRuns = Promise.resolve();
/** A promise's answer, or "late" past `ms`. @template T @param {Promise<T>} p @param {number} ms @returns {Promise<T | "late">} */
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms, "late"))]);

/**
 * A registry over a real folder whose one sub-agent changed a.txt in its own copy, its work waiting — or, with `works`,
 * one sub-agent for each change, launched in turn (`ids`); its clock moved past the 30 s between two of the chat's
 * passes by `later()`. `passes`: every pass its `settleWaiting` began, whoever asked — the Agents list's route too.
 * @param {string} dir @param {((cwd: string) => void)[]} [works]
 */
const waiting = async (dir, works = [ex]) => {
  const cards = createAgentCardStore({ dataDir: null });
  let shift = 0;
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    now: () => Date.now() + shift,
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
      saveThread: () => {},
      loadThreads: () => [],
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const cwd = registry.hostOf(id)?.workdir || String(headers["x-filament-cwd"]);
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      // A launch's change; a follow-up after them changes nothing, and runs until the test lets it end (`followUpRuns`).
      if (n <= works.length) works[n - 1](cwd);
      else await followUpRuns;
      registry.relay(id, { type: "tool-end", name: "write", ok: true });
      registry.finish(id, { status: "done", error: null, report: "done", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "done" }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "done" }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  /** @type {Promise<number>[]} */
  const passes = [];
  const settle = registry.settleWaiting;
  registry.settleWaiting = (/** @type {string} */ chainId, /** @type {{ person?: boolean } | undefined} */ o) => {
    const p = settle(chainId, o);
    passes.push(p);
    return p;
  };
  /** @type {string[]} */
  const ids = [];
  for (const [i] of works.entries()) {
    const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: `change ${i}` }));
    assert.equal(r.ok, true, String(r.error || ""));
    await r.done;
    ids.push(String(r.id));
  }
  const id = ids[0];
  readsOf = join(dir, "a.txt");
  reads = 0;
  let turns = 0;
  /** A turn of the chat's lead, opened. */
  const turn = () => registry.openTurn({ chainId: "c1", runId: `lead-${++turns}`, cwd: dir, mode: "edit", model: "m", thinking: null, fork: null, emit: () => {}, lead: true, round: () => 1 });
  return {
    registry,
    id,
    ids,
    passes,
    later: () => void (shift += 31_000),
    turn,
    /** A turn of the chat's lead opened and over: its end asks the waiting work to be read. */
    turnEnds: () => turn().close(),
    work: () => /** @type {any} */ (registry.get(id))?.work,
    /** @param {number} i */
    workOf: (i) => /** @type {any} */ (registry.get(ids[i]))?.work,
  };
};
/** A file held open as git holds one it reads on Windows: it can be neither replaced nor deleted meanwhile. @param {string} file @returns {[string, string[]]} */
const holder = (file) => ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$f = [IO.File]::Open('${file.replace(/'/g, "''")}', 'Open', 'Read', 'Read'); Start-Sleep -Seconds 60`]];
/** Whether a file is held: it cannot be opened to be written. @param {string} file */
const held = (file) => {
  try {
    closeSync(openSync(file, "r+"));
    return false;
  } catch {
    return true;
  }
};
/** @param {() => boolean} ok @param {number} ms */
const until = async (ok, ms) => {
  for (const end = Date.now() + ms; Date.now() < end && !ok(); ) await new Promise((r) => setTimeout(r, 20));
  return ok();
};
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
/** The work's files listed, which every read of it against the folder that is no answer kept begins with. */
const listing = { has: ["diff", "--raw"] };

// (fails before: yes — the Hunter's of 11-02: every turn's end read every waiting sub-agent's work again, each a read
// of its own: five turns ending at once made five)
test("five turns ending while a read of a sub-agent's work runs cost that read and one more", async () => {
  const w = await waiting(repo());
  for (let i = 0; i < 5; i++) w.turnEnds();
  w.later();
  // The chat's own pass asked after them: it ends once every read before it has.
  await w.registry.settleWaiting("c1");
  assert.ok(reads >= 1 && reads <= 2, `${reads} reads`);
  assert.equal(w.work().pending, 1, "not in the folder: it waits");
});

// (fails before: yes for the reads — the Hunter's of 11-02: each read of the Agents list past 30 s began a read of its
// own, and one that outlasted 30 s had the next queue behind it; the list answered at once before as well)
test("the Agents list read five times while a read runs answers each time at once, and costs that read and one more", async () => {
  const w = await waiting(repo());
  const read = listRoute(w.registry);
  const hold = holdAt(listing);
  w.later();
  await read("/sessions/c1/subagents");
  assert.notEqual(await within(hold.reached, 10_000), "late", "the first read lists the work's files");
  for (let i = 0; i < 4; i++) {
    w.later();
    const answer = await within(read("/sessions/c1/subagents"), 2_000);
    assert.notEqual(answer, "late", "the list answers with what is known, not after the read");
  }
  hold.go();
  await Promise.all(w.passes);
  assert.ok(reads >= 1 && reads <= 2, `${reads} reads`);
});

// (fails before: yes — the Hunter's of 11-02: a read in the repository's turn had an Apply pressed wait it out)
test("an Apply pressed while Filament reads the sub-agent's work against the folder goes ahead; the read after finds it applied, never found", async () => {
  const w = await waiting(repo());
  const hold = holdAt(listing);
  w.later();
  const pass = w.registry.settleWaiting("c1");
  assert.notEqual(await within(hold.reached, 10_000), "late", "the read lists the work's files");
  const applied = await within(w.registry.apply(w.id, "c1", "owner"), 5_000);
  assert.notEqual(applied, "late", "the Apply did not wait for the read");
  assert.ok(applied !== "late" && applied.ok, JSON.stringify(applied));
  hold.go();
  await pass;
  assert.deepEqual([w.work().pending, w.work().lastApplied?.by], [0, "owner"], "applied by the developer, never marked as found");
});

/**
 * An Apply pressed while Filament's read of the work is inside the git `at` names, which holds the developer's file as
 * git holds one it reads on Windows: the Apply goes ahead at once, and writes its file as `written`.
 * @param {import("./helpers/git-fault.js").Words} at @param {string} written @param {(dir: string) => void} [first]  the folder before the read
 */
const applyWhileHeld = async (at, written, first = () => {}) => {
  const dir = repo();
  const w = await waiting(dir);
  first(dir);
  const file = join(dir, "a.txt");
  const hold = holdAt(at, holder(file));
  w.later();
  const pass = w.registry.settleWaiting("c1");
  assert.notEqual(await within(hold.reached, 10_000), "late", "the read came to that git");
  assert.ok(await until(() => held(file), 15_000), "the developer's file is held");
  const t0 = Date.now();
  const applied = await within(w.registry.apply(w.id, "c1", "owner"), 10_000);
  assert.notEqual(applied, "late", "the Apply went ahead");
  assert.ok(applied !== "late" && applied.ok, JSON.stringify(applied));
  assert.ok(Date.now() - t0 < 10_000);
  assert.equal(readFileSync(file, "utf8"), written, "its write landed");
  await pass;
  assert.deepEqual([w.work().pending, w.work().lastApplied?.by], [0, "owner"]);
};
const WINDOWS_ONLY = process.platform !== "win32" && "a file held from deletion while read is Windows'";
// (fails before: yes — the review of 11-02: read beside the Apply, the read's git held the developer's file, and the
// Apply's write failed, "your folder would not take it")
test("an Apply pressed while the read hashes the developer's file — git holding it — stops the read, and its write lands", { skip: WINDOWS_ONLY }, () =>
  applyWhileHeld({ has: ["hash-object", "--stdin-paths"], lacks: ["-w"] }, TEN.replace("3\n", "X\n")));
// (fails before: yes — the same, the read inside its batch of the merge's versions)
test("an Apply pressed while the read reads the versions of a file both changed — git holding it — stops the read, and its write lands", { skip: WINDOWS_ONLY }, () =>
  applyWhileHeld(
    { has: ["cat-file", "--batch"] },
    TEN.replace("1\n", "one, yours\n").replace("3\n", "X\n"),
    (dir) => writeFileSync(join(dir, "a.txt"), TEN.replace("1\n", "one, yours\n")),
  ));

// (fails before: yes — the review of 11-02: asks faster than a read had the reads run back to back, and the first ask
// answered only once they stopped)
// (each ask, not the first alone: the review of 11-03)
test("asks that keep coming while it reads cost a read a second at most, and each is answered after the read that follows it", async () => {
  const w = await waiting(repo());
  /** Each ask's moment, and the moment it was answered. @type {{ at: number, done: Promise<number> }[]} */
  const asks = [];
  for (const end = Date.now() + 6_000; Date.now() < end; ) {
    // A pass of the chat's — its clock past the 30 s between two — and a turn's end, every 20 ms.
    w.later();
    asks.push({ at: Date.now(), done: w.registry.settleWaiting("c1").then(() => Date.now()) });
    w.turnEnds();
    await new Promise((r) => setTimeout(r, 20));
  }
  const answered = await within(Promise.all(asks.map((a) => a.done)), 10_000);
  assert.notEqual(answered, "late", "every ask is answered");
  const waits = asks.map((a, i) => (answered === "late" ? Infinity : answered[i] - a.at));
  // An ask waits out the read under way, the second after it, and the read that follows — seconds under a full suite's
  // load —, never the asks after it, which come for 6 s.
  const longest = Math.max(...waits);
  assert.ok(longest < 5_000, `of ${asks.length} asks, the longest waited ${longest} ms`);
  assert.ok(reads >= 1 && reads <= 10, `${reads} reads in 6 s`);
});

// (fails before: yes — the same: an ask that came while a read ran had the next run while the chat's turn ran)
test("a read asked by a turn's end does not run while the chat's next turn runs", async () => {
  const w = await waiting(repo());
  const hold = holdAt(listing);
  w.later();
  const pass = w.registry.settleWaiting("c1");
  assert.notEqual(await within(hold.reached, 10_000), "late");
  w.turnEnds();
  const live = w.turn();
  hold.go();
  await pass;
  await new Promise((r) => setTimeout(r, 2_500));
  assert.equal(reads, 1, "no read while the turn runs");
  live.close();
});

// (fails before: not on round 2, which marks work found whole whatever its stamp — a guard for the mark, which a draft
// of the rounds after made ask for a stamp: the review of 11-02 caught work brought in by hand never found)
test("work brought in by hand is found where attributes are read from a tree, though no read stands on anything there", async () => {
  const dir = repo();
  git(dir, "config", "attr.tree", "HEAD");
  const w = await waiting(dir);
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "X\n"));
  w.later();
  await w.registry.settleWaiting("c1");
  assert.equal(w.work().lastApplied?.by, "found");
});

test("work found whole whose folder moved before its mark is not marked: read again, it waits", async () => {
  const dir = repo();
  const w = await waiting(dir);
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "X\n"));
  await new Promise((r) => setTimeout(r, 3_100));
  // The read's hash of the folder's file held until the developer's next edit is in.
  const held = holdAt({ has: ["hash-object"] });
  w.later();
  const pass = w.registry.settleWaiting("c1");
  assert.notEqual(await within(held.reached, 10_000), "late", "the read hashed the folder's file");
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "X, and more\n"));
  held.go();
  await pass;
  assert.deepEqual([w.work().pending, w.work().lastApplied], [1, null], "it waits");
});

// (fails before: yes — the review of 11-03: a dry run went ahead of the read, stopping it, and the Agents band asks one
// every 15 s while it shows: a read longer than that never landed)
test("a dry run asked while Filament reads the work against the folder leaves the read to finish, and answers after it", async () => {
  const w = await waiting(repo());
  const hold = holdAt(listing);
  w.later();
  const pass = w.registry.settleWaiting("c1");
  assert.notEqual(await within(hold.reached, 10_000), "late", "the read lists the work's files");
  let answered = false;
  const dry = w.registry.preview(w.id, "c1").finally(() => void (answered = true));
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(answered, false, "the dry run waits for the read's turn");
  hold.go();
  const [p] = await Promise.all([dry, pass]);
  assert.ok(p.ok, JSON.stringify(p));
  assert.equal(reads, 1, "the read was not stopped, nor made again");
});

/** Its change in a file of its own: b.txt, new. @param {string} cwd */
const bee = (cwd) => writeFileSync(join(cwd, "b.txt"), "bee\n");

// (fails before: yes — the review of 11-03: the Apply waited for its own work's mark, and the mark for the repository's
// turn behind the other's read, which nothing stopped)
test("an Apply on work Filament is marking found waits for that mark alone: another sub-agent's read in the repository is stopped", async () => {
  const dir = repo();
  const w = await waiting(dir, [ex, bee]);
  // The first's work is in the folder whole; the second's is not.
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "X\n"));
  // The first's read has the repository's turn, the second's behind it; then the second's is held at its listing, and
  // the first's mark, its work found, waits behind that.
  const [headA, headB] = w.ids.map((id) => git(dir, "rev-parse", `refs/filament/subagents/${id}/work`));
  const own = holdAt({ has: ["diff", "--raw", headA] });
  w.later();
  const pass = w.registry.settleWaiting("c1");
  assert.notEqual(await within(own.reached, 10_000), "late", "the first's read lists its files");
  const other = holdAt({ has: ["diff", "--raw", headB] });
  own.go();
  assert.notEqual(await within(other.reached, 10_000), "late", "the second's read lists its files after the first's");
  await new Promise((r) => setTimeout(r, 300));
  const applied = await within(w.registry.apply(w.id, "c1", "owner"), 10_000);
  other.go();
  assert.notEqual(applied, "late", "the Apply waited for its work's mark, not for the other's read");
  assert.ok(applied !== "late" && !applied.ok && /found in the folder already/.test(String(applied.error)), JSON.stringify(applied));
  await pass;
  assert.equal(w.work().lastApplied?.by, "found");
  assert.equal(w.workOf(1).pending, 1, "the second's work still waits");
});

// (fails before: yes — the review of 11-03: a follow-up sent during Filament's own mark of work found whole was refused,
// "being marked as applied now: ask it again once that is done", for a mark nobody asked for)
test("a follow-up sent while Filament marks the work found goes ahead: the mark steps aside, and the read after it finds the work", async () => {
  const dir = repo();
  const w = await waiting(dir);
  // Written a moment ago: its stat stands for nothing, and the mark's read lists the work's files again.
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "X\n"));
  const first = holdAt(listing);
  w.later();
  const pass = w.registry.settleWaiting("c1");
  assert.notEqual(await within(first.reached, 10_000), "late", "the read lists the work's files");
  const mark = holdAt(listing);
  first.go();
  assert.notEqual(await within(mark.reached, 10_000), "late", "the mark's read lists them again");
  const sent = /** @type {any} */ (w.registry.followUp(w.id, { prompt: "check it again", chainId: "c1" }));
  assert.ok(sent.ok, JSON.stringify(sent));
  // The mark's read is still held: the follow-up runs only because its read was stopped.
  const outcome = await within(sent.done, 10_000);
  mark.go();
  assert.notEqual(outcome, "late", "the follow-up ran while the mark's read was held");
  assert.equal(w.registry.get(w.id)?.status, "done");
  await pass;
  // Read again, the follow-up over: the work stands in the folder whole, and is found.
  w.later();
  await w.registry.settleWaiting("c1");
  assert.equal(w.work().lastApplied?.by, "found");
});

// (fails before: yes — the review of round 3: a mark whose read stood on the read before it started no git, missed the
// follow-up's stop and run, and marked the work the sub-agent was at — its hold left past the follow-up's start, its
// Undo offered on a mark the sub-agent worked from)
test("a follow-up that comes while the mark reads the folder by its stats alone: the work it is at is not marked, nor held", async () => {
  const dir = repo();
  const w = await waiting(dir);
  /** @type {() => void} */
  let followUpEnds = () => {};
  // The follow-up's run lasts until the test lets it end.
  followUpRuns = new Promise((r) => (followUpEnds = () => r(undefined)));
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "X\n"));
  // Old enough for its stat to stand for it: the mark's read stands on the first's, and reads the folder by stats alone.
  await new Promise((r) => setTimeout(r, 3_100));
  const hashed = holdAt({ has: ["hash-object", "--stdin-paths"], lacks: ["-w"] });
  w.later();
  const pass = w.registry.settleWaiting("c1");
  assert.notEqual(await within(hashed.reached, 10_000), "late", "the first read hashes the folder's file");
  const stat = statHeld(join(dir, "a.txt"));
  hashed.go();
  assert.notEqual(await within(stat.reached, 10_000), "late", "the mark reads the folder by its stats");
  const sent = /** @type {any} */ (w.registry.followUp(w.id, { prompt: "check it again", chainId: "c1" }));
  assert.ok(sent.ok, JSON.stringify(sent));
  stat.go();
  try {
    // The mark has its answer while the follow-up runs; a read again sees the sub-agent at work, and marks nothing.
    await new Promise((r) => setTimeout(r, 1_500));
    assert.equal(w.work().lastApplied?.by, undefined, "nothing marked found");
    const refs = git(dir, "for-each-ref", "--format=%(refname)", `refs/filament/subagents/${w.id}/`).split("\n").filter(Boolean);
    assert.deepEqual(refs.map((r) => r.split("/").at(-1)).sort(), ["base", "work"], "its work waits on its refs, no mark holds it");
  } finally {
    followUpEnds();
    followUpRuns = Promise.resolve();
  }
  await sent.done;
  await pass;
});

// (fails before: yes — the review of round 3: a follow-up waited for its work's mark, and the mark for the repository's
// turn behind another sub-agent's read, which nothing stopped)
test("a follow-up on work Filament is marking found waits for no other sub-agent's read in the repository", async () => {
  const dir = repo();
  const w = await waiting(dir, [ex, bee]);
  // The first's work is in the folder whole; the second's is not.
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "X\n"));
  const [headA, headB] = w.ids.map((id) => git(dir, "rev-parse", `refs/filament/subagents/${id}/work`));
  const own = holdAt({ has: ["diff", "--raw", headA] });
  w.later();
  const pass = w.registry.settleWaiting("c1");
  assert.notEqual(await within(own.reached, 10_000), "late", "the first's read lists its files");
  // The second's read has the repository's turn next, held at its listing; the first's mark waits behind it.
  const other = holdAt({ has: ["diff", "--raw", headB] });
  own.go();
  assert.notEqual(await within(other.reached, 10_000), "late", "the second's read lists its files after the first's");
  await new Promise((r) => setTimeout(r, 300));
  const sent = /** @type {any} */ (w.registry.followUp(w.id, { prompt: "check it again", chainId: "c1" }));
  assert.ok(sent.ok, JSON.stringify(sent));
  const outcome = await within(sent.done, 10_000);
  other.go();
  assert.notEqual(outcome, "late", "the follow-up ran without waiting out the other's read");
  await pass;
});

// (fails before: yes — the review of 11-03: a rebase pressed during Filament's own mark of work found whole was refused,
// "being marked as applied now", where an Apply and a mark wait for it)
test("a rebase pressed while Filament marks the work found waits for the mark, then says it was found", async () => {
  const dir = repo();
  const w = await waiting(dir);
  // Written a moment ago: its stat stands for nothing, and the mark's read lists the work's files again.
  writeFileSync(join(dir, "a.txt"), TEN.replace("3\n", "X\n"));
  const first = holdAt(listing);
  w.later();
  const pass = w.registry.settleWaiting("c1");
  assert.notEqual(await within(first.reached, 10_000), "late", "the read lists the work's files");
  const mark = holdAt(listing);
  first.go();
  assert.notEqual(await within(mark.reached, 10_000), "late", "the mark's read lists them again");
  let answered = false;
  const rebased = w.registry.rebase(w.id, "c1").finally(() => void (answered = true));
  await new Promise((r) => setTimeout(r, 300));
  const waited = !answered;
  mark.go();
  const r = await rebased;
  await pass;
  assert.ok(waited, `the rebase waited for the mark: ${JSON.stringify(r)}`);
  assert.ok(!r.ok && /found in the folder already/.test(r.error), JSON.stringify(r));
  assert.equal(w.work().lastApplied?.by, "found");
});
