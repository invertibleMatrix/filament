// @ts-check
// A builder's patch workspace through the registry (the owner's plan of 11-09 for big repos, Phase 1): Auto launches a
// builder on Filament's loop in a patch — no checkout —, and what waits of its work goes as a worktree's does: its
// apply, an overlap's refusal, markers, mine and send_back, word for word; an exchange a restart cut, kept; a capture
// that fails, kept in place until one holds.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { letGoOfCopies, letGoTaskWork, taskRefs } from "../src/adapters/git/worktree.js";
import { movesOf, patchRecordOf } from "../src/adapters/git/patch.js";
import { patchHand } from "../src/adapters/tools/patch-hands.js";
import { runHand } from "../src/adapters/tools/hands.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { fakeLfs, useFakeLfs } from "./helpers/fake-lfs.js";

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
const YOURS = TEN.replace("3\n", "three, yours\n");
const ITS = TEN.replace("3\n", "THREE, its\n");
const MARKED = TEN.replace("3\n", "<<<<<<< yours\nthree, yours\n=======\nTHREE, its\n>>>>>>> its change\n");
const BOTH = TEN.replace("3\n", "three, yours — and THREE, its\n");
/** A repository with a.txt (ten lines) and d.txt committed. */
const repo = () => {
  const dir = join(realpathSync.native(mkdtempSync(join(tmpdir(), "filament-sa-patch-"))), "proj");
  made.push(dir);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), TEN);
  writeFileSync(join(dir, "d.txt"), "dee\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/** @param {string} p */
const read = (p) => readFileSync(p, "utf8");
/** @param {() => boolean} ok @param {string} what */
const until = async (ok, what) => {
  for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(ok(), `${what} came in time`);
};
/** Where a repository keeps its copies, and the patches' records beside them. @param {string} dir */
const homeOf = (dir) => join(dir, ".git", "filament-worktrees");

/**
 * A sub-agent's file tools where its host says it works, as agent/turn.js hands them: a patch's own, else the hands in
 * its worktree. @param {any} host
 */
const handsOf = (host) => {
  const seen = new Map();
  return (/** @type {string} */ name, /** @type {any} */ input) => (host.workspace ? patchHand(name, input, host.workspace, { root: host.workdir, fenced: true, seen }) : runHand(name, input, { root: host.workdir, fenced: true, seen })).then(String);
};

/**
 * A registry over a real folder whose sub-agent works where its host says, through its file tools, as `work` says, by
 * exchange; each brief it was sent is kept in `briefs`, and each host it ran in in `hosts`. `workspace`: the session's
 * `subagents.workspace` (none: Auto). `over`: parts of its context.
 * @param {string} dir @param {string | null} workspace
 * @param {(o: { n: number, host: any, hands: ReturnType<typeof handsOf> }) => Promise<void>} work
 * @param {{ briefs?: string[], hosts?: any[], over?: Record<string, any> }} [o]
 */
const working = (dir, workspace, work, { briefs = [], hosts = [], over = {} } = {}) => {
  const cards = createAgentCardStore({ dataDir: null });
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      card: (tag) => cards.find(tag),
      settings: () => ({ subagents: { ask: [], ...(workspace ? { workspace } : {}) }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: dir, model: "m", projectId: null }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      exchangeEnded: () => {},
      ...over,
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const host = registry.hostOf(id);
      const runId = `run-${++n}`;
      briefs.push(String(body.messages.at(-1).content.at(-1).text));
      hosts.push(host);
      registry.attach(id, runId);
      await work({ n, host, hands: handsOf(host) });
      registry.relay(id, { type: "tool-end", name: "write", ok: true });
      registry.finish(id, { status: "done", error: null, report: "done", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "done" }] }], rounds: 1, toolCalls: 1, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "done" }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return registry;
};
/** Its change: line 3 shouted, and a new file; sent back, it resolves the markers it reads. @type {Parameters<typeof working>[2]} */
const shout = async ({ n, hands }) => {
  const a = await hands("read", { path: "a.txt" });
  if (n === 1) {
    await hands("write", { path: "a.txt", content: ITS });
    await hands("write", { path: "c.txt", content: "sea\n" });
  } else if (a.includes("<<<<<<< yours")) await hands("write", { path: "a.txt", content: BOTH });
};
/**
 * The session's agent's turn over a folder where a sub-agent shouted line 3 and added c.txt, and the developer edited
 * line 3 meanwhile: its agent tool, its door, the sub-agent's id.
 * @param {string | null} workspace @param {{ briefs?: string[], hosts?: any[] }} [o]
 */
const overlapping = async (workspace, o = {}) => {
  const dir = repo();
  const registry = working(dir, workspace, shout, o);
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "shout three, and add c.txt" }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  const id = String(r.id);
  writeFileSync(join(dir, "a.txt"), YOURS);
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  /** @param {any} input */
  const call = (input) => door.subagents.run({ id: "toolu_1", input: { description: "apply", ...input }, emit: () => {}, signal: null });
  return { dir, registry, id, door, call };
};
/** An answer's words with what differs between two runs — the sub-agent's id, a commit's — named alike. @param {string} text @param {string} id */
const plain = (text, id) => text.replaceAll(id, "<id>").replace(/\b[0-9a-f]{40}\b/g, "<commit>");

// (fails before: yes — every builder's launch checked the whole project out: there was no patch workspace)
test("Auto launches a builder on Filament's loop in a patch: no checkout, only the files it read or wrote; its work waits and applies as a worktree's does", async () => {
  const dir = repo();
  /** @type {any[]} */
  const hosts = [];
  const registry = working(dir, null, shout, { hosts });
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "shout three, and add c.txt" }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  const id = String(r.id);
  assert.ok(hosts[0]?.workspace, "its host hands its file tools a patch");
  assert.equal(hosts[0].workdir, join(homeOf(dir), id), "at the place its worktree would take");
  assert.equal(git(dir, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length, 1, "git keeps no worktree of it");
  assert.deepEqual([existsSync(join(hosts[0].workdir, ".git")), existsSync(join(hosts[0].workdir, "d.txt"))], [false, false], "no checkout: what it never touched is not there");
  assert.equal(patchRecordOf(homeOf(dir), id)?.state, "parked", "parked at its exchange's end");
  assert.deepEqual(/** @type {any} */ (registry.get(id))?.work?.files.map((/** @type {any} */ f) => f.path), ["a.txt", "c.txt"]);
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });
  try {
    const ap = await door.subagents.run({ id: "toolu_1", input: { description: "apply", agent_id: id, apply_changes: true }, emit: () => {}, signal: null });
    assert.equal(ap.ok, true, ap.text);
    assert.deepEqual([read(join(dir, "a.txt")), read(join(dir, "c.txt"))], [ITS, "sea\n"]);
  } finally {
    door.close();
  }
});

// (fails before: yes — it got a patch, and its servers, started in the patch's folder at its turn's start, held the folder
// its move renames aside: on Windows "a program is using its folder", so no command of its could run)
test("a session whose MCP servers run on this computer launches its builder in a worktree; one whose servers are all remote keeps the patch", async () => {
  const settingsWith = (/** @type {any[]} */ mcp) => () => ({ subagents: { ask: [] }, loop: { permissions: "edit" }, plugins: { mcp } });
  const kinds = [];
  for (const mcp of [[{ name: "files", command: "node", args: ["server.js"] }], [{ name: "remote", url: "https://mcp.example.com/mcp" }]]) {
    const dir = repo();
    /** @type {any[]} */
    const hosts = [];
    const registry = working(dir, null, shout, { hosts, over: { settings: settingsWith(mcp) } });
    const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "shout three, and add c.txt" }));
    assert.equal(r.ok, true, String(r.error || ""));
    await r.done;
    kinds.push(hosts[0]?.workspace ? "patch" : existsSync(join(hosts[0].workdir, ".git")) ? "worktree" : "neither");
  }
  assert.deepEqual(kinds, ["worktree", "patch"]);
});

// (fails before: yes — the same: no patch to compare)
test("an overlap's refusal, markers and mine answer as a worktree's, word for word, and leave the folder as a worktree's leave it", async () => {
  /** @param {string} workspace @param {string | undefined} overlap */
  const run = async (workspace, overlap) => {
    /** @type {any[]} */
    const hosts = [];
    const { dir, id, door, call } = await overlapping(workspace, { hosts });
    assert.equal(!!hosts[0]?.workspace, workspace === "patch", `it worked in a ${workspace}`);
    try {
      const r = await call({ agent_id: id, apply_changes: true, ...(overlap ? { overlap } : {}) });
      return { ok: r.ok, wrote: r.wrote, text: plain(r.text, id), a: read(join(dir, "a.txt")), c: existsSync(join(dir, "c.txt")) ? read(join(dir, "c.txt")) : null };
    } finally {
      door.close();
    }
  };
  for (const overlap of [undefined, "markers", "mine"]) {
    const patch = await run("patch", overlap);
    assert.deepEqual(patch, await run("worktree", overlap), `overlap: ${overlap ?? "left out"}`);
    assert.equal(patch.a, overlap === "markers" ? MARKED : YOURS, `overlap: ${overlap ?? "left out"}`);
  }
});

// (fails before: yes — the same)
test("overlap send_back: its patch is laid over the folder as it stands with its change brought on, markers and all; it reads them through its own tools, resolves them, and its work applies cleanly", async () => {
  /** @type {string[]} */
  const briefs = [];
  /** @type {any[]} */
  const hosts = [];
  const { dir, registry, id, door, call } = await overlapping("patch", { briefs, hosts });
  try {
    const r = await call({ agent_id: id, apply_changes: true, overlap: "send_back" });
    assert.deepEqual([r.ok, r.wrote], [false, false]);
    assert.equal(r.text, `Nothing applied: 1 file does not come through cleanly — a.txt: 1 change overlaps yours. Your folder is as it was. Sent back: sub-agent ${id} redoes its change on your folder as it stands now, git's conflict markers in its copy of a.txt for it to resolve. Its report reaches you as a message, and its work waits for your apply again.`);
    await until(() => briefs.length === 2 && registry.get(id)?.status === "done", "its second run");
    assert.match(briefs[1], /^\[Filament: the agent that launched you sent your work back to rebase: the folder changed since you started, and your change overlapped edits made there\./);
    assert.ok(hosts[1]?.workspace, "its second run is in its patch still");
    /** @type {any[]} */
    const taken = [];
    await until(() => (taken.push(...door.inbox.take()), taken.some((d) => d.from === id && d.kind === "report" && d.exchange === 1)), "its report at the agent's door");
    const again = await call({ agent_id: id, apply_changes: true });
    assert.equal(again.ok, true, again.text);
    assert.equal(read(join(dir, "a.txt")), BOTH);
  } finally {
    door.close();
  }
});

// (fails before: yes — the same)
test("after a restart, a patch's exchange the restart cut is read from its overlay: its changes and its apply are what it held, the patch this Filament's now and parked", async () => {
  const dir = repo();
  /** @type {any[]} */
  const hosts = [];
  const registry = working(dir, "patch", async ({ hands }) => void (await hands("write", { path: "c.txt", content: "first\n" })), { hosts });
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "write c.txt" }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  const id = String(r.id);
  // A follow-up was writing when Filament went: its patch busy, what it wrote there alone.
  const overlay = hosts[0].workdir;
  writeFileSync(join(overlay, "c.txt"), "second, cut by the restart\n");
  const recFile = join(homeOf(dir), ".patches", `${id}.json`);
  writeFileSync(recFile, JSON.stringify({ ...JSON.parse(read(recFile)), state: "busy" }));
  letGoOfCopies();
  const restarted = working(dir, "patch", async () => {});
  const c = await restarted.changes(id, "c1");
  assert.ok(c.ok, c.ok ? "" : c.error);
  assert.match(c.ok ? c.diff : "", /^\+second, cut by the restart$/m);
  const applied = await restarted.apply(id, "c1", "owner");
  assert.ok(applied.ok, applied.ok ? "" : applied.error);
  assert.equal(read(join(dir, "c.txt")), "second, cut by the restart\n");
  assert.equal(patchRecordOf(homeOf(dir), id)?.state, "parked", "its patch kept, parked");
});

// (fails before: yes — the same)
test("a patch whose capture fails at its exchange's end stays as it is, in use and marked unsaved — never parked — and its next exchange's end keeps it", async () => {
  const dir = repo();
  /** @type {any[]} */
  const hosts = [];
  const registry = working(dir, "patch", async ({ n, host, hands }) => {
    await hands("write", { path: `c${n}.txt`, content: `${n}\n` });
    // Its work's ref held by another git for the whole first exchange's end — its capture fails, the second try too.
    const refs = join(dir, ".git", "refs", "filament", "subagents", host.id);
    if (n === 1) {
      mkdirSync(refs, { recursive: true });
      writeFileSync(join(refs, "work.lock"), "");
    } else rmSync(join(refs, "work.lock"), { force: true });
  }, { hosts });
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "write" }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  const id = String(r.id);
  const rec = patchRecordOf(homeOf(dir), id);
  assert.deepEqual([rec?.state, /update-ref/.test(String(rec?.unsaved?.error))], ["busy", true], JSON.stringify(rec));
  assert.match(String(/** @type {any} */ (registry.get(id))?.work?.error), /update-ref/);
  assert.equal(read(join(hosts[0].workdir, "c1.txt")), "1\n", "what it wrote stays where it wrote it");
  const next = /** @type {any} */ (registry.followUp(id, { prompt: "again", chainId: "c1", by: "owner" }));
  assert.equal(next.ok, true, String(next.error || ""));
  await until(() => hosts.length === 2 && registry.get(id)?.status === "done", "its second exchange");
  assert.equal(hosts[1].workdir, hosts[0].workdir, "it went on in the same patch");
  await until(() => patchRecordOf(homeOf(dir), id)?.state === "parked", "its patch parked");
  assert.equal(patchRecordOf(homeOf(dir), id)?.unsaved, undefined, "kept now");
  assert.deepEqual(/** @type {any} */ (registry.get(id))?.work?.files.map((/** @type {any} */ f) => f.path), ["c1.txt", "c2.txt"], "both exchanges' work");
});

/** How each file of a dry run comes in, by path. @param {{ path: string, how: string }[]} came */
const ways = (came) => Object.fromEntries(came.map((c) => [c.path, c.how]));
/** A file's text, or null where there is none. @param {string} p */
const textAt = (p) => (existsSync(p) ? read(p) : null);

// (fails before: no — the counterpart of test/apply-conflicts-server.test.js's Send back to rebase, whose model reads its
// worktree's disk)
test("the developer's Send back to rebase, for a patch: its change redone on your folder as it is, the markers read through its own tools and resolved, your folder untouched, and its work then applies cleanly", async () => {
  const dir = repo();
  /** @type {string[]} */
  const briefs = [];
  /** @type {any[]} */
  const hosts = [];
  const registry = working(dir, null, shout, { briefs, hosts });
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "shout three, and add c.txt" }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  const id = String(r.id);
  writeFileSync(join(dir, "a.txt"), YOURS);
  const back = await registry.rebase(id, "c1");
  assert.ok(back.ok, !back.ok ? back.error : "");
  assert.deepEqual([back.marked, back.left, back.files, back.task], [["a.txt"], [], 2, null]);
  await until(() => briefs.length === 2 && registry.get(id)?.status === "done" && patchRecordOf(homeOf(dir), id)?.state === "parked", "its second run");
  assert.match(briefs[1], /^\[Filament: the developer sent your work back to rebase: .* git's conflict markers stand in a\.txt: .* Then report again: your work waits for their apply once more\.\]$/);
  assert.ok(hosts[1]?.workspace, "its second run is in its patch still");
  assert.equal(read(join(dir, "a.txt")), YOURS, "your folder untouched");
  const p = await registry.preview(id, "c1");
  assert.deepEqual(p.ok && [p.conflicts, ways(p.came)], [[], { "a.txt": "took", "c.txt": "took" }], "it comes in cleanly now");
  const a = await registry.apply(id, "c1", "owner");
  assert.ok(a.ok, !a.ok ? a.error : "");
  assert.deepEqual([read(join(dir, "a.txt")), read(join(dir, "c.txt"))], [BOTH, "sea\n"]);
});

// (fails before: yes — a parked patch was no copy of its own to the dry run, Compare or its row: the Changes page offered
// no folder, so neither "Open its version" nor its copy's path; and laid over its sent-back change, its folder held only
// what its next exchange touched)
test("its version, for a patch: the dry run, Compare and its row name its patch's folder, which holds its version of every waiting file — one a send back brought that its next exchange never touched too —; once let go, no folder", async () => {
  const dir = repo();
  /** @type {any[]} */
  const hosts = [];
  const registry = working(dir, null, shout, { hosts });
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "shout three, and add c.txt" }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  const id = String(r.id);
  writeFileSync(join(dir, "a.txt"), YOURS);
  const p = await registry.preview(id, "c1");
  const folder = p.ok ? p.folder : null;
  assert.equal(folder, join(homeOf(dir), id), "its parked patch, its own");
  assert.equal(/** @type {any} */ (await registry.compare(id, "c1", "a.txt")).folder, folder);
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.folder, folder, "its row names it");
  assert.deepEqual([textAt(join(folder, "a.txt")), textAt(join(folder, "c.txt"))], [ITS, "sea\n"], "its version of each");

  // Sent back: its next exchange is laid over the rebased change, and touches a.txt alone.
  const back = await registry.rebase(id, "c1");
  assert.ok(back.ok, !back.ok ? back.error : "");
  await until(() => hosts.length === 2 && registry.get(id)?.status === "done" && patchRecordOf(homeOf(dir), id)?.state === "parked", "its second run");
  const q = await registry.preview(id, "c1");
  assert.equal(q.ok ? q.folder : null, folder);
  assert.deepEqual([textAt(join(folder, "a.txt")), textAt(join(folder, "c.txt"))], [BOTH, "sea\n"], "its version of each, c.txt too");
  assert.equal(existsSync(join(folder, "d.txt")), false, "what its work never changed is not copied up");

  // Its patch let go (its chat deleted): its work waits on its refs, and no folder is offered.
  const gone = await letGoTaskWork(dir, id);
  assert.deepEqual(gone.ok && gone.copy, "gone");
  const after = await registry.preview(id, "c1");
  assert.equal(after.ok ? after.folder : "x", null, "no Open its version into a folder that is gone");
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.folder ?? null, null, "its row names no folder either");
});

// (fails before: no — the counterpart of test/mark-applied.test.js's copy still open, which breaks a worktree's capture by
// cutting its link to the repository)
test("a patch whose last work could not be captured is not marked, as it is not rebased: it stays open, and its refs keep its work", async () => {
  const dir = repo();
  const registry = working(dir, null, async ({ n, host, hands }) => {
    if (n === 1) return shout({ n, host, hands });
    await hands("write", { path: "e.txt", content: "ee\n" });
    // Its work's ref held by another git for the whole of this exchange's end: its capture fails, the second try too.
    const refs = join(dir, ".git", "refs", "filament", "subagents", host.id);
    mkdirSync(refs, { recursive: true });
    writeFileSync(join(refs, "work.lock"), "");
  });
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "shout three, and add c.txt" }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  const id = String(r.id);
  const refs = await taskRefs(dir, id);
  const again = /** @type {any} */ (registry.followUp(id, { prompt: "and e.txt", chainId: "c1", by: "owner" }));
  assert.ok(again.ok, String(again.error || ""));
  await until(() => registry.get(id)?.status !== "running" && !!(/** @type {any} */ (registry.get(id))?.work?.error), "its second exchange's end");
  assert.equal(/** @type {any} */ (registry.get(id))?.work?.open, true, "its patch stays open");
  assert.equal(patchRecordOf(homeOf(dir), id)?.state, "busy", "never parked");
  const no = await registry.markTaken(id, "c1", "owner");
  assert.match(no.ok ? "" : no.error, /^sub-agent sa_[0-9a-f]{8}'s copy is still open \(its work could not be captured: .+\)$/);
  const rebased = await registry.rebase(id, "c1");
  assert.match(rebased.ok ? "" : rebased.error, /^sub-agent sa_[0-9a-f]{8}'s copy is still open \(its work could not be captured: .+\)$/);
  assert.deepEqual(await taskRefs(dir, id), refs, "its refs keep its work");
});

/** A session's kept threads, as its store keeps them across a restart: the registry's `saveThread` and `loadThreads`. */
const threadStore = () => {
  /** @type {Map<string, any[]>} */
  const threads = new Map();
  return {
    saveThread: (/** @type {string} */ c, /** @type {any} */ t) => threads.set(c, [...(threads.get(c) || []).filter((x) => x.id !== t.id), structuredClone(t)]),
    loadThreads: (/** @type {string} */ c) => structuredClone(threads.get(c) || []),
  };
};

// (fails before: yes — the folder was never kept with the thread: after a restart the dry run, Compare and its row said
// no folder, while its parked copy still held its version)
test("after a restart, a parked patch's folder and a parked worktree's are its version still: the dry run, Compare and its row name them", async () => {
  for (const workspace of ["patch", "worktree"]) {
    const dir = repo();
    const store = threadStore();
    const registry = working(dir, workspace, shout, { over: store });
    const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "shout three, and add c.txt" }));
    assert.equal(r.ok, true, String(r.error || ""));
    await r.done;
    const id = String(r.id);
    const folder = join(homeOf(dir), id);
    letGoOfCopies();
    const restarted = working(dir, workspace, shout, { over: store });
    const p = await restarted.preview(id, "c1");
    assert.equal(p.ok ? p.folder : "x", folder, `${workspace}: the dry run names its folder`);
    assert.equal(/** @type {any} */ (await restarted.compare(id, "c1", "a.txt")).folder, folder, `${workspace}: Compare names it`);
    assert.equal(/** @type {any} */ (restarted.get(id))?.work?.folder, folder, `${workspace}: its row names it`);
    assert.equal(textAt(join(folder, "a.txt")), ITS, `${workspace}: its version there`);
  }
});

// (fails before: yes — a send back moved its refs alone: its folder held the change from before the rebase, with no
// markers, until its next exchange laid a fresh overlay over it, which held none of its waiting files)
test("a patch sent back holds its rebased change at once: the markers in its folder, and its waiting files there as its next exchange starts", async () => {
  const dir = repo();
  /** @type {() => void} */
  let go = () => {};
  const gate = new Promise((r) => (go = () => r(undefined)));
  /** @type {Record<string, string | null>} */
  const atStart = {};
  const registry = working(dir, null, async ({ n, host, hands }) => {
    if (n === 2) {
      for (const f of ["a.txt", "c.txt"]) atStart[f] = textAt(join(host.workdir, f));
      await gate;
    }
    return shout({ n, host, hands });
  });
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "shout three, and add c.txt" }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  const id = String(r.id);
  const folder = join(homeOf(dir), id);
  writeFileSync(join(dir, "a.txt"), YOURS);
  const back = await registry.rebase(id, "c1");
  assert.ok(back.ok, !back.ok ? back.error : "");
  assert.equal(textAt(join(folder, "a.txt")), MARKED, "its folder holds the rebased change, markers and all");
  assert.equal(textAt(join(folder, "c.txt")), "sea\n");
  await until(() => "c.txt" in atStart, "its next exchange's start");
  go();
  assert.deepEqual(atStart, { "a.txt": MARKED, "c.txt": "sea\n" }, "its next exchange starts with them");
  await until(() => registry.get(id)?.status === "done" && patchRecordOf(homeOf(dir), id)?.state === "parked", "its second run");
  assert.equal(textAt(join(folder, "a.txt")), BOTH);
});

// (fails before: yes — its launch was counted at its first exchange's end, as never moving, and a move on a later
// exchange, or after a restart, was not counted at all: rule 10 never saw one)
test("rule 10 counts a move on a later exchange, and one after a restart, with the calls it took across its exchanges", async () => {
  const dir = repo();
  const store = threadStore();
  const writeThenMove = async (/** @type {{ n: number, host: any, hands: any }} */ { host, hands }) => {
    if (await hands("read", { path: "c.txt" }).then(() => true, () => false)) {
      const m = await host.workspace.move("command");
      assert.equal(m.ok, true, m.ok ? "" : m.error);
    } else await hands("write", { path: "c.txt", content: "sea\n" });
  };
  const registry = working(dir, null, writeThenMove, { over: store });
  const launched = [];
  for (let i = 0; i < 2; i++) {
    const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "add c.txt" }));
    assert.equal(r.ok, true, String(r.error || ""));
    await r.done;
    launched.push(String(r.id));
  }
  const card = /** @type {any} */ (registry.get(launched[0]))?.card?.tag || "builder";
  const next = /** @type {any} */ (registry.followUp(launched[0], { prompt: "run it", chainId: "c1", by: "owner" }));
  assert.equal(next.ok, true, String(next.error || ""));
  await until(() => registry.get(launched[0])?.status === "done" && !patchRecordOf(homeOf(dir), launched[0]), "its move on its second exchange");
  letGoOfCopies();
  const restarted = working(dir, null, writeThenMove, { over: store });
  await restarted.preview(launched[1], "c1");
  const again = /** @type {any} */ (restarted.followUp(launched[1], { prompt: "run it", chainId: "c1", by: "owner" }));
  assert.equal(again.ok, true, String(again.error || ""));
  await until(() => restarted.get(launched[1])?.status === "done" && !patchRecordOf(homeOf(dir), launched[1]), "its move after the restart");
  await until(() => movesOf(homeOf(dir), card).every((n) => n != null), "both moves counted");
  assert.deepEqual(movesOf(homeOf(dir), card), [1, 1], "each launch once, by the calls it took before it moved");
});

/** What the LFS file holds: text, so the read hand shows it. */
const ASSET = "the real asset, kept by Git LFS\n".repeat(4);
// (fails before: yes — once a move checks LFS files out as their pointers: the host's fetch of a pointer was read once,
// at its turn's start in a patch, and its reads after a move in the same turn showed the pointer's three lines)
test("a patch that moves to a worktree mid-turn reads an LFS file there as a worktree's read does: fetched", async () => {
  const dir = repo();
  const lfs = fakeLfs(made);
  useFakeLfs(dir, lfs);
  writeFileSync(join(dir, ".gitattributes"), "*.bin filter=lfs -text\n");
  writeFileSync(join(dir, "asset.bin"), ASSET);
  writeFileSync(join(dir, "other.bin"), "another asset\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "assets");
  /** @type {string[]} */
  const reads = [];
  const registry = working(dir, "patch", async ({ host }) => {
    // Its file tools as the loop hands them (agent/turn.js): a patch's own, with the host's fetch of an LFS file.
    const seen = new Map();
    const hand = (/** @type {string} */ name, /** @type {any} */ input) => patchHand(name, input, host.workspace, { root: host.workdir, fenced: true, seen, fetchLfs: host.fetchLfs ?? null }).then(String);
    reads.push(await hand("read", { path: "asset.bin" }));
    const m = await host.workspace.move("command");
    assert.equal(m.ok, true, m.ok ? "" : m.error);
    reads.push(await hand("read", { path: "other.bin" }));
  });
  const r = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "read the assets" }));
  assert.equal(r.ok, true, String(r.error || ""));
  await r.done;
  assert.match(reads[0], /^\s+1\tthe real asset, kept by Git LFS$/m);
  assert.match(reads[1], /^\s+1\tanother asset$/m, "fetched in the worktree it moved to");
});
