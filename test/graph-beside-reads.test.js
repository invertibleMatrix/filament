// @ts-check
// What a task graph's page, a team chat's card and a parked copy's row are read from, made cheap without changing an
// answer: the notes kept behind a graph's tasks (read off disk once, kept as the store writes them), a team chat looked
// at again as its workers move (the chat's head, then the chat once), and whose a parked copy still is (each file read
// again once it changed).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createTaskNotes } from "../src/services/task-notes.js";
import { createTeamsBeside } from "../src/app/teams-beside.js";
import { copyHeldBy } from "../src/adapters/git/worktree.js";

const root = mkdtempSync(join(tmpdir(), "filament-graph-beside-reads-"));
after(() => rmSync(root, { recursive: true, force: true }));

/**
 * The files `fn` reads and the folders it lists under `under`, as it leaves them — node:fs's own calls, every module's.
 * @template T @param {string} under @param {() => T} fn @returns {{ out: T, read: string[], listed: string[], real: number }}
 */
function onDisk(under, fn) {
  const was = { readFileSync: fs.readFileSync, readdirSync: fs.readdirSync, native: fs.realpathSync.native };
  /** @type {string[]} */ const read = [];
  /** @type {string[]} */ const listed = [];
  let real = 0;
  fs.readFileSync = /** @type {any} */ ((/** @type {any} */ p, /** @type {any[]} */ ...rest) => (String(p).startsWith(under) && read.push(String(p).slice(under.length + 1)), /** @type {any} */ (was.readFileSync)(p, ...rest)));
  fs.readdirSync = /** @type {any} */ ((/** @type {any} */ p, /** @type {any[]} */ ...rest) => (String(p).startsWith(under) && listed.push(String(p).slice(under.length)), /** @type {any} */ (was.readdirSync)(p, ...rest)));
  fs.realpathSync.native = /** @type {any} */ ((/** @type {any} */ p, /** @type {any[]} */ ...rest) => (real++, /** @type {any} */ (was.native)(p, ...rest)));
  syncBuiltinESMExports();
  try {
    return { out: fn(), read, listed, real };
  } finally {
    fs.readFileSync = was.readFileSync;
    fs.readdirSync = was.readdirSync;
    fs.realpathSync.native = was.native;
    syncBuiltinESMExports();
  }
}

// (fails before: yes — every change of a graph listed its notes' folder and read every task's index, and every keep
// walked the chat's whole tree for its total)
test("what a graph's tasks hold is read off disk once and kept as the store writes it; a store started anew reads the same", () => {
  const dir = mkdtempSync(join(root, "notes-"));
  const s = createTaskNotes({ dir });
  const T0 = 1_760_000_000_000;
  assert.ok(s.keepNote("c1", T0, "t1", { title: "Plan", text: "hello", by: "agent" }).ok);
  assert.ok(s.keepNote("c1", T0, null, { title: "Goal", text: "graph words", by: "agent" }).ok);
  assert.ok(s.keepFile("c1", T0, "t2", { name: "shot.png", data: new Uint8Array(10), by: "agent" }).ok);
  const want = { t1: { notes: 1, files: 0, bytes: 5, titles: ["Plan"] }, "": { notes: 1, files: 0, bytes: 11, titles: ["Goal"] }, t2: { notes: 0, files: 1, bytes: 10, titles: ["shot.png"] } };
  const first = onDisk(dir, () => s.counts("c1", T0));
  assert.deepEqual(first.out, want);
  const again = onDisk(dir, () => s.counts("c1", T0));
  assert.deepEqual([again.out, again.read, again.listed], [want, [], []], "asked again: nothing read, nothing listed");
  const kept = onDisk(dir, () => [s.keepNote("c1", T0, "t3", { title: "Notes", text: "abc", by: "agent" }), s.keepNote("c1", T0, "t1", { title: "Plan", text: "hello there", by: "agent" })]);
  assert.ok(kept.out.every((r) => r.ok));
  const keptAgain = onDisk(dir, () => s.keepNote("c1", T0, "t3", { title: "More", text: "de", by: "agent" }));
  assert.ok(keptAgain.out.ok);
  assert.deepEqual([keptAgain.read, keptAgain.listed], [[], []], "a keep: the chat's total is not walked again");
  assert.equal(s.forget("c1", T0, "t2", "shot.png"), "file");
  const now = { t1: { notes: 1, files: 0, bytes: 11, titles: ["Plan"] }, "": { notes: 1, files: 0, bytes: 11, titles: ["Goal"] }, t3: { notes: 2, files: 0, bytes: 5, titles: ["Notes", "More"] } };
  assert.deepEqual(s.counts("c1", T0), now, "kept and forgotten, as written");
  assert.deepEqual(createTaskNotes({ dir }).counts("c1", T0), now, "a store started anew reads the same off disk");
  assert.deepEqual(s.list("c1", T0, "t3").notes.map((n) => n.title), ["Notes", "More"]);
  s.drop("c1");
  assert.deepEqual(s.counts("c1", T0), {}, "a chat dropped holds nothing");
  assert.ok(s.keepNote("c1", T0, "t1", { title: "Again", text: "x", by: "agent" }).ok);
  assert.deepEqual(s.counts("c1", T0), { t1: { notes: 1, files: 0, bytes: 1, titles: ["Again"] } });
  assert.deepEqual(createTaskNotes({ dir }).counts("c1", T0), { t1: { notes: 1, files: 0, bytes: 1, titles: ["Again"] } });
});

// (fails before: no — a guard: what the store keeps is what it read; a read that failed for a moment — a file held by
// another program — is not kept as nothing, nor written over with the notes it could not see)
test("an index that could not be read for a moment is read again, and a keep after it keeps every note", () => {
  const dir = mkdtempSync(join(root, "notes-busy-"));
  const T0 = 1_760_000_000_000;
  assert.ok(createTaskNotes({ dir }).keepNote("c1", T0, "t1", { title: "Plan", text: "hello", by: "agent" }).ok);
  const s = createTaskNotes({ dir });
  const was = fs.readFileSync;
  fs.readFileSync = /** @type {any} */ ((/** @type {any} */ p, /** @type {any[]} */ ...rest) => {
    if (String(p).endsWith("index.json")) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    return /** @type {any} */ (was)(p, ...rest);
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(s.counts("c1", T0), {}, "busy: nothing could be read");
  } finally {
    fs.readFileSync = was;
    syncBuiltinESMExports();
  }
  assert.deepEqual(s.counts("c1", T0), { t1: { notes: 1, files: 0, bytes: 5, titles: ["Plan"] } }, "read again once it can be");
  assert.ok(s.keepNote("c1", T0, "t1", { title: "More", text: "abc", by: "agent" }).ok);
  assert.deepEqual(createTaskNotes({ dir }).list("c1", T0, "t1").notes.map((n) => n.title), ["Plan", "More"]);
});

// (fails before: yes — the bug hunt of 10-30, SUB-5: a keep while the index could not be read took it for empty, wrote its
// note over the first one's file and an index of its own over the one it could not see)
test("a keep while its index cannot be read keeps nothing, in words, and every note kept before it stays", () => {
  const dir = mkdtempSync(join(root, "notes-busy-keep-"));
  const T0 = 1_760_000_000_000;
  assert.ok(createTaskNotes({ dir }).keepNote("c1", T0, "t1", { title: "Plan", text: "hello", by: "agent" }).ok);
  const s = createTaskNotes({ dir });
  const was = fs.readFileSync;
  fs.readFileSync = /** @type {any} */ ((/** @type {any} */ p, /** @type {any[]} */ ...rest) => {
    if (String(p).endsWith("index.json")) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    return /** @type {any} */ (was)(p, ...rest);
  });
  syncBuiltinESMExports();
  /** @type {any[]} */
  let kept;
  try {
    kept = [s.keepNote("c1", T0, "t1", { title: "More", text: "abc", by: "agent" }), s.keepFile("c1", T0, "t1", { name: "shot.png", data: new Uint8Array(4), by: "agent" })];
  } finally {
    fs.readFileSync = was;
    syncBuiltinESMExports();
  }
  assert.deepEqual(kept, [
    { ok: false, error: "what t1 keeps could not be read just now (EBUSY), so nothing was kept over it: keep it again" },
    { ok: false, error: "what t1 keeps could not be read just now (EBUSY), so nothing was kept over it: keep it again" },
  ]);
  const left = createTaskNotes({ dir }).list("c1", T0, "t1");
  assert.deepEqual([left.notes.map((n) => [n.title, n.n, n.chars, n.first]), left.files], [[["Plan", 1, 5, "hello"]], []], "its index as it was");
  assert.equal(createTaskNotes({ dir }).note("c1", T0, "t1", "Plan")?.text, "hello", "the first note's words stay its own");
  assert.ok(s.keepNote("c1", T0, "t1", { title: "More", text: "abc", by: "agent" }).ok, "kept once its index reads");
  assert.deepEqual(createTaskNotes({ dir }).list("c1", T0, "t1").notes.map((n) => n.title), ["Plan", "More"]);
});

// (fails before: yes — every event of every chat's agents read that chat whole to know whether it was a team's, and a
// team chat's look read it whole twice)
test("a chat whose agents moved is known a team's by its head; a team chat's look reads it once", async () => {
  /** @type {Map<string, any>} */
  const chains = new Map([
    ["c1", { id: "c1", kind: "interactive", model: "m", title: "main", meta: {} }],
    ["t1", { id: "t1", kind: "team", model: "m", title: "hunt", meta: { beside: { team: "bug-hunter", name: "Bug Hunter", ask: "find bugs", firedBy: "you", at: 1 } } }],
  ]);
  /** @type {Record<string, number>} */
  const whole = {};
  /** @type {Record<string, number>} */
  const heads = {};
  /** @type {((msg: any) => void) | null} */
  let heard = null;
  /** @type {any[]} */
  const said = [];
  createTeamsBeside({
    archive: () => ({
      getChain: (/** @type {string} */ id) => ((whole[id] = (whole[id] || 0) + 1), chains.get(id) || null),
      chainHead: (/** @type {string} */ id) => ((heads[id] = (heads[id] || 0) + 1), chains.has(id) ? { id, key: id, project_id: null, model: "m", kind: chains.get(id).kind, turns: 0, native: true } : null),
      mergeMeta: () => {},
      mainOf: (/** @type {string} */ id) => (id === "t1" ? "c1" : null),
      besideOf: () => [],
    }),
    sessions: { besideFacts: () => ({ busy: true, asking: false, turns: 1, last: null }) },
    teams: /** @type {any} */ ({ find: () => ({ key: "bug-hunter", name: "Bug Hunter" }), list: () => [] }),
    registry: () => ({ list: () => [] }),
    postTurn: async () => ({ status: 200, body: null }),
    reach: { busy: () => false, post: async () => ({ status: 200, body: null }), steer: () => ({ ok: true }) },
    remove: async () => {},
    events: /** @type {any} */ ({ publish: (/** @type {string} */ _t, /** @type {any} */ m) => said.push(m), subscribe: (/** @type {string} */ topic, /** @type {any} */ fn) => (topic === "subagents" && (heard = fn), () => {}) }),
  });
  assert.ok(heard);
  /** @type {any} */ (heard)({ type: "subagent-progress", chainId: "c1", id: "sa_1" });
  /** @type {any} */ (heard)({ type: "subagent-progress", chainId: "t1", id: "sa_2" });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual([whole.c1 || 0, heads.c1], [0, 1], "a chat of no team's: its head alone");
  assert.deepEqual([whole.t1, heads.t1], [1, 1], "a team's: its head, then the chat once for its card");
  assert.deepEqual(said.map((m) => [m.main, m.id, m.what]), [["c1", "t1", "state"]], "its card is said, as ever");
});

// (fails before: yes — every poll of the chat's agents read each parked copy's `.git` file and its record, and resolved
// two links, whatever had changed)
test("whose a parked copy is, read again only once its files changed", () => {
  const home = mkdtempSync(join(root, "repo-"));
  const dest = join(home, "copies", "sa_0000beef");
  const record = join(home, "worktrees", "sa_0000beef");
  mkdirSync(dest, { recursive: true });
  mkdirSync(record, { recursive: true });
  writeFileSync(join(dest, ".git"), `gitdir: ${record}\n`);
  const meta = (/** @type {string} */ state, /** @type {string} */ agent) => writeFileSync(join(record, "filament.json"), JSON.stringify({ owner: "me", state, agent, at: 1, links: [] }));
  meta("parked", "sa_0000beef");
  const first = onDisk(home, () => copyHeldBy(dest, "sa_0000beef"));
  assert.equal(first.out, true);
  assert.ok(first.read.length >= 2 && first.real >= 1, "read the first time");
  const again = onDisk(home, () => [copyHeldBy(dest, "sa_0000beef"), copyHeldBy(dest, "sa_0000beef"), copyHeldBy(dest, "sa_0000cafe")]);
  assert.deepEqual([again.out, again.read, again.real], [[true, true, false], [], 0], "unchanged: nothing read, no link resolved");
  meta("parked", "sa_0000cafe-taken");
  const taken = onDisk(home, () => copyHeldBy(dest, "sa_0000beef"));
  assert.deepEqual([taken.out, taken.read.map((p) => p.split(sep).at(-1))], [false, ["filament.json"]], "taken for another: its record read again, said");
  rmSync(join(dest, ".git"));
  assert.equal(copyHeldBy(dest, "sa_0000beef"), false, "no copy there now");
  assert.equal(copyHeldBy(null, "sa_0000beef"), false);
});
