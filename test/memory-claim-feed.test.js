// @ts-check
// The claims feed (HarnessV3-Memory M7-D32, M7-D33): every change a claim's card shows, and a dossier's, written by the
// write it tells of and in its transaction, in order, by an id never reused; a claim's history says where it went.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive, SCHEMA_VERSION } from "../src/services/memory/archive.js";

const dir = mkdtempSync(join(tmpdir(), "filament-feed-"));
let seq = 0;
/** @type {Archive[]} */
const opened = [];
// A ticking clock: each write is a second after the last.
let clock = 1_757_900_000_000;
const now = () => (clock += 1000);
/** @param {{ file?: string }} [o] */
const open = (o = {}) => {
  const a = new Archive({ file: o.file || join(dir, `a${++seq}.db`), now });
  opened.push(a);
  return a;
};
after(() => {
  for (const a of opened) a.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The feed's rows after `after`. @param {Archive} a @param {number} [after] */
const rows = (a, after = 0) => /** @type {any} */ (a).feed.after({ after, limit: 1000 }).rows;
/** The feed's rows after `after`, as [claim, action]. @param {Archive} a @param {number} [after] */
const pairs = (a, after = 0) => rows(a, after).map((/** @type {any} */ r) => [r.item_id, r.action]);
/** Where the feed stands now. @param {Archive} a */
const last = (a) => /** @type {any} */ (a).feed.position().last;
/** A session in a project, and a claim filed in it. @param {Archive} a @param {string} key @param {string} project @param {string} text */
function claimIn(a, key, project, text) {
  const ch = a.chainForKey(key, { project });
  return { ch, id: a.items.add({ projectId: project, chainId: ch.id, kind: "fact", text, origin: "learner" }).id };
}

test("each event a claim gets writes its feed row in the same transaction, named, with its project and session; a rolled-back one writes none", () => {
  const a = open();
  let told = 0;
  a.onClaimChange = () => told++;
  const { ch, id } = claimIn(a, "k1", "p1", "The api listens on port 3000.");
  a.items.setStatus(id, "confirmed", { by: "owner" });
  a.items.note(id, "evidence", { by: "learner", detail: { chain: "c_other" } });
  const r = rows(a);
  assert.deepEqual(r.map((/** @type {any} */ x) => [x.item_id, x.action, x.by, x.project_id, x.chain_id]), [
    [id, "created", "learner", "p1", ch.id],
    [id, "status", "owner", "p1", ch.id],
    [id, "evidence", "learner", "p1", ch.id],
  ]);
  assert.equal(told, 3, "the service is told of each");
  const before = last(a);
  assert.throws(() =>
    a.transaction(() => {
      a.items.note(id, "fired", { by: "filament", detail: { chain: ch.id, shape: "git push" } });
      throw new Error("the write fell over");
    }),
  );
  assert.deepEqual([last(a), pairs(a, before)], [before, []], "the event went back, and its row with it");
  a.items.note(id, "fired", { by: "filament", detail: { chain: ch.id, shape: "git push" } });
  assert.deepEqual(rows(a, before).map((/** @type {any} */ x) => x.id), [before + 1], "the next row takes the next id: nothing was spent");
  a.onClaimChange = () => {
    throw new Error("a relay that breaks");
  };
  assert.doesNotThrow(() => a.items.note(id, "evidence", { by: "learner", detail: { chain: "c_third" } }), "a relay never fails a write");
  assert.deepEqual(pairs(a, before + 1), [[id, "evidence"]]);
});

test("the owner's delete takes a claim's rows with its record and says it went; another claim its open question named is told; a project says it went", () => {
  const a = open();
  const A = claimIn(a, "k-a", "p1", "Deploys go out on Thursdays.");
  const B = claimIn(a, "k-b", "p1", "Deploys go out on Fridays.");
  const q = a.inbox.add({ projectId: "p1", kind: "retire", key: "retire:a", itemIds: [A.id], proposal: { action: "retire", id: A.id, replacement: B.id }, reason: "a newer value" });
  assert.equal(q.raised, true);
  const mark = last(a);
  let woke = 0;
  a.onClaimChange = () => woke++;
  a.deleteChain(A.ch.id);
  assert.deepEqual(pairs(a), [
    [B.id, "created"],
    [B.id, "asked"],
    [A.id, "deleted"],
    [B.id, "decided"],
  ], "A's earlier rows went with it; B hears its question went");
  const [gone, told] = rows(a, mark);
  assert.deepEqual([gone.project_id, gone.chain_id, gone.by, told.by], ["p1", A.ch.id, "owner", "owner"]);
  assert.equal(woke, 2, "the rows the delete wrote wake the service, A's as B's");
  a.deleteProject("p1");
  const [bGone, project] = rows(a, mark + 2);
  assert.deepEqual([bGone.item_id, bGone.action, project.item_id, project.action, project.project_id, project.chain_id, project.by], [B.id, "deleted", null, "deleted", "p1", null, "owner"]);
  assert.equal(rows(a, mark + 2).length, 2);
  assert.equal(woke, 4);
  const empty = a.chainForKey("k-empty", { project: "p3" });
  assert.ok(empty);
  const before = last(a);
  a.deleteProject("p3");
  assert.deepEqual(rows(a, before).map((/** @type {any} */ x) => [x.item_id, x.action, x.project_id]), [[null, "deleted", "p3"]], "a project with no claim says it went too: its scope is gone");
  assert.equal(a.deleteProject("p3"), null);
  assert.equal(last(a), before + 1, "one gone already says nothing");
});

test("a project's delete tells a claim elsewhere its open question named, and never a claim it took", () => {
  const a = open();
  const C = claimIn(a, "k-c", "p1", "The cron runs at 02:00.");
  const R = claimIn(a, "k-r", "p1", "The cron runs at 03:00.");
  a.chainForKey("k-p2", { project: "p2" });
  a.inbox.add({ projectId: "p1", kind: "retire", key: "retire:c", itemIds: [C.id], proposal: { action: "retire", id: C.id, replacement: R.id }, reason: "a newer value" });
  a.moveChain(C.ch.id, "p2");
  assert.equal(a.items.get(C.id)?.project_id, "p2");
  const mark = last(a);
  a.deleteProject("p1");
  assert.deepEqual(rows(a, mark).map((/** @type {any} */ x) => [x.item_id, x.action, x.by, x.project_id]), [
    [R.id, "deleted", "owner", "p1"],
    [C.id, "decided", "owner", "p2"],
    [null, "deleted", "owner", "p1"],
  ], "C, now in p2, hears the p1 question about it went; R went, and is told nothing more");
});

test("ids are never reused: past a prune that took every row, the next change takes the next id", () => {
  const a = open();
  const { id } = claimIn(a, "k", "p1", "The cache lives in .cache/.");
  a.items.note(id, "evidence", { by: "learner", detail: { chain: "c2" } });
  assert.equal(last(a), 2);
  assert.equal(/** @type {any} */ (a).feed.prune(clock + 1), 2);
  assert.deepEqual(/** @type {any} */ (a).feed.position(), { epoch: a.feedEpoch, last: 2, pruned: 2 });
  a.items.note(id, "evidence", { by: "learner", detail: { chain: "c3" } });
  assert.deepEqual(rows(a).map((/** @type {any} */ x) => x.id), [3]);
});

test("the prune takes the oldest rows, none after one it keeps, and remembers how far it took; the epoch and that mark outlive a reopen", () => {
  const file = join(dir, "prune.db");
  const a = open({ file });
  const { id } = claimIn(a, "k", "p1", "Logs rotate daily.");
  a.items.note(id, "evidence", { by: "learner", detail: { chain: "c2" } });
  const cut = clock + 500;
  a.items.note(id, "evidence", { by: "learner", detail: { chain: "c3" } });
  // The clock went back and forth: row 2 says it was written after the cut, row 3 before it. The prune takes the feed up
  // to the newest row before the cut, row 2 with it: never a hole under the mark it keeps.
  a.db.prepare("UPDATE claim_feed SET at = ? WHERE id = 2").run(cut + 10_000);
  a.db.prepare("UPDATE claim_feed SET at = ? WHERE id = 3").run(cut - 10_000);
  assert.equal(/** @type {any} */ (a).feed.prune(cut), 3, "rows 1 to 3");
  a.items.note(id, "evidence", { by: "learner", detail: { chain: "c4" } });
  assert.deepEqual(rows(a).map((/** @type {any} */ x) => x.id), [4]);
  assert.equal(/** @type {any} */ (a).feed.prune(cut), 0, "nothing older is left");
  const epoch = a.feedEpoch;
  assert.match(epoch, /^[0-9a-f]{12}$/);
  a.close();
  const b = open({ file });
  assert.deepEqual(/** @type {any} */ (b).feed.position(), { epoch, last: 4, pruned: 3 });
  assert.notEqual(open().feedEpoch, epoch, "another store, another epoch");
  assert.equal(b.schemaMetaGet("version"), SCHEMA_VERSION);
});

test("a question writes `asked` on each claim it names, once; settled, `decided` by who settled it; raised or settled again, nothing", () => {
  const a = open();
  const A = claimIn(a, "k-a", "p1", "The build uses webpack.");
  const B = claimIn(a, "k-b", "p1", "The build uses vite.");
  const mark = last(a);
  const q = a.inbox.add({ projectId: "p1", kind: "retire", key: "k1", itemIds: [A.id], proposal: { action: "retire", id: A.id, replacement: B.id }, reason: "r" });
  assert.deepEqual(pairs(a, mark), [[A.id, "asked"], [B.id, "asked"]], "A named twice, told once");
  assert.equal(a.inbox.add({ projectId: "p1", kind: "retire", key: "k1", itemIds: [A.id], proposal: { action: "retire", id: A.id }, reason: "r" }).raised, false);
  assert.equal(last(a), mark + 2, "a question raised before raises nothing");
  assert.equal(a.inbox.decide(q.id, { status: "rejected", by: "owner" }), true);
  assert.deepEqual(rows(a, mark + 2).map((/** @type {any} */ x) => [x.item_id, x.action, x.by]), [[A.id, "decided", "owner"], [B.id, "decided", "owner"]]);
  assert.equal(a.inbox.decide(q.id, { status: "accepted", by: "owner" }), false);
  assert.equal(last(a), mark + 4, "a settled question settles nothing again");
});

test("triggers read anew write `triggers` only when they changed; first anchors write `anchored`; a dossier written or undone writes `dossier` with its project and no claim", () => {
  const a = open();
  const { id } = claimIn(a, "k", "p1", "Never force-push to main.");
  let mark = last(a);
  const push = [{ tool: "bash", shape: "git push", args: "--force" }];
  a.triggers.set(id, "words", push);
  a.triggers.set(id, "words", push);
  a.triggers.set(id, "seen", []);
  assert.deepEqual(pairs(a, mark), [[id, "triggers"]], "the same triggers again, and none where there were none, change nothing");
  a.triggers.set(id, "words", []);
  assert.deepEqual(pairs(a, mark + 1), [[id, "triggers"]]);
  mark = last(a);
  a.anchors.add(id, []);
  a.anchors.add(id, [{ path: "C:/p1/src/push.js", name: "src/push.js", kind: "file", hash: "h", size: 10, mtime: 1, head: "", symbols: [], state: "ok" }]);
  assert.deepEqual(pairs(a, mark), [[id, "anchored"]], "no anchors, nothing anchored");
  mark = last(a);
  const d = a.dossiers.add({ projectId: "p1", sections: [], cites: [], basis: "b1", run: 7 });
  assert.equal(a.dossiers.undone(d.id), true);
  assert.equal(a.dossiers.undone(d.id), false);
  assert.deepEqual(rows(a, mark).map((/** @type {any} */ x) => [x.item_id, x.action, x.project_id, x.chain_id, x.by]), [
    [null, "dossier", "p1", null, "curator"],
    [null, "dossier", "p1", null, null],
  ], "an undo undone twice tells once");
});

test("a session moved to another project carries its claims and each says so; the feed names where it came from, and a project's reading sees it leave", () => {
  const a = open();
  const A = claimIn(a, "k-a", "p1", "The queue drains every minute.");
  const there = a.items.add({ projectId: "p2", chainId: A.ch.id, kind: "fact", text: "Already filed in p2.", origin: "learner" }).id;
  a.chainForKey("k-p2", { project: "p2" });
  const mark = last(a);
  assert.deepEqual(a.moveChain(A.ch.id, "p2"), { id: A.ch.id, from: "p1", to: "p2", items: 2 });
  const ev = a.items.events(A.id).at(-1);
  assert.deepEqual([ev?.action, ev?.by, ev?.detail], ["moved", "owner", { from: "p1", to: "p2", session: A.ch.id }]);
  assert.ok(!a.items.events(there).some((e) => e.action === "moved"), "one already in p2 did not move");
  const [row] = rows(a, mark);
  assert.deepEqual([row.item_id, row.action, row.project_id, row.from_project], [A.id, "moved", "p2", "p1"]);
  assert.deepEqual(/** @type {any} */ (a).feed.after({ after: mark, project: "p1" }).rows.map((/** @type {any} */ x) => x.item_id), [A.id], "p1's reading sees it go");
});

test("a project's reading of the feed: its claims and dossier, the global claims, and a claim moved out of it; never another project's; `through` is how far it looked", () => {
  const a = open();
  const mine = claimIn(a, "k1", "p1", "Mine.");
  claimIn(a, "k2", "p2", "Theirs.");
  const global = a.items.add({ projectId: null, kind: "rule", text: "Answer in English.", origin: "person" }).id;
  a.dossiers.add({ projectId: "p1", sections: [], cites: [], basis: "b", run: 1 });
  a.dossiers.add({ projectId: "p2", sections: [], cites: [], basis: "b", run: 2 });
  const read = /** @type {any} */ (a).feed.after({ after: 0, project: "p1" });
  assert.deepEqual(read.rows.map((/** @type {any} */ x) => [x.item_id, x.action, x.project_id]), [
    [mine.id, "created", "p1"],
    [global, "created", null],
    [null, "dossier", "p1"],
  ]);
  assert.equal(read.through, last(a), "it looked to the newest, past the rows it left out");
  const page = /** @type {any} */ (a).feed.after({ after: 0, limit: 2 });
  assert.deepEqual([page.rows.length, page.through], [2, page.rows[1].id], "a full page goes on from its last row");
});
