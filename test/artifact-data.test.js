// @ts-check
// HarnessV4_Artifacts_Plan E18 step 5: what an artifact's page keeps (AF-D7). Collections of small JSON records, kept
// by Filament beside the artifact's versions, the same whatever version shows and gone with the artifact. The page
// reaches them at its own address, and only its own origin writes them (AFC-90); each change is told to the pages that
// follow it and to the harness (AFC-92); the agent reads and writes them with the tool's `read_db` and `write_db`, all
// or nothing (AFC-94, AFC-95); a file that does not read is said in words, never thrown (AFC-96).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactNameOfHost } from "../src/core/artifacts.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { COLLECTION_RULE, collectionName, createArtifactData } from "../src/services/artifact-data.js";
import { PAGE_MARK, createArtifactsHandler } from "../src/http/artifacts.js";
import { artifactView } from "../src/http/admin/artifacts.js";
import { artifactCall } from "../src/app/agent/artifacts.js";
import { until } from "./helpers/wait.js";

const NOW = Date.UTC(2027, 0, 15, 8, 0);
const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * A store in a fresh data folder holding one artifact, Spend (spend-k3f9), with what it logs and the changes it tells.
 * @param {string[]} [fours]  the four letters later artifacts take
 */
const spend = (fours = []) => {
  const dataDir = mkdtempSync(join(tmpdir(), "filament-artifact-data-"));
  dirs.push(dataDir);
  const four = ["k3f9", ...fours];
  let t = NOW;
  /** @type {string[]} */
  const said = [];
  /** @type {{ name: string, news: any }[]} */
  const told = [];
  const store = createArtifactStore({
    dataDir,
    log: (level, msg) => said.push(`${level}: ${msg}`),
    now: () => (t += 60_000) - 60_000,
    four: () => four.shift() || "zzzz",
    onData: (name, news) => told.push({ name, news }),
  });
  const by = { chain: "c1", model: "m-1", folder: "/p", helper: null, call: null };
  store.publish({ title: "Spend", files: [{ path: "index.html", data: Buffer.from("<p>v1</p>") }], by, who: "c1" });
  return { store, said, told, by, folder: join(store.dir, "spend-k3f9", "data") };
};
/** Where a call of the tool stands. */
const at = { who: "c1", by: { chain: "c1", model: "m-1", folder: "/p", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 };

describe("the store of a page's data (AF-D7)", () => {
  // (fails before: yes — a page kept nothing in Filament)
  test("a record set with no id is given one; with an id it is added, or replaced whole; 3 and \"3\" are one id (AFC-87)", () => {
    const { store } = spend();
    const r = /** @type {any} */ (store.data.change("spend-k3f9", "expenses", { set: [{ amount: 12 }] }, "page"));
    assert.equal(r.ok, true);
    const made = r.done.set[0];
    assert.match(String(made.id), /^[a-z0-9]{8}$/, "eight letters and digits of its own");
    assert.deepEqual(made, { amount: 12, id: made.id });
    store.data.change("spend-k3f9", "expenses", { set: [{ id: "r1", amount: 5, note: "lunch" }, { id: 3, amount: 1 }] }, "page");
    store.data.change("spend-k3f9", "expenses", { set: [{ id: "r1", amount: 6 }, { id: "3", amount: 2 }] }, "page");
    assert.deepEqual(store.data.list("spend-k3f9", "Expenses"), {
      ok: true,
      collection: "expenses",
      records: [made, { id: "r1", amount: 6 }, { id: "3", amount: 2 }],
    }, "replaced whole, in the order first kept; a name whatever its case");
    assert.deepEqual(store.data.get("spend-k3f9", "expenses", 3), { ok: true, record: { id: "3", amount: 2 } });
    assert.deepEqual(store.data.get("spend-k3f9", "expenses", "nope"), { ok: true, record: null });
    assert.deepEqual(store.data.list("spend-k3f9", "budgets"), { ok: true, collection: "budgets", records: [] }, "a collection never written holds none");
  });

  // (fails before: yes — the same)
  test("an update of an id the collection has not got is refused naming it; a delete of one is said, not refused (AFC-88)", () => {
    const { store, told } = spend();
    store.data.change("spend-k3f9", "expenses", { set: [{ id: "r1", amount: 5, note: "lunch" }] }, "page");
    assert.deepEqual(store.data.change("spend-k3f9", "expenses", { update: [{ id: "zz", amount: 1 }] }, "page"), {
      ok: false,
      status: 400,
      error: 'Nothing was kept: expenses has no record "zz" to update; set adds one',
    });
    const up = /** @type {any} */ (store.data.change("spend-k3f9", "expenses", { update: [{ id: "r1", amount: 30 }] }, "page"));
    assert.deepEqual(up.done.updated, [{ id: "r1", amount: 30, note: "lunch" }], "its other fields kept");
    const none = /** @type {any} */ (store.data.change("spend-k3f9", "expenses", { delete: ["zz"] }, "page"));
    assert.deepEqual(none, { ok: true, collection: "expenses", done: { set: [], updated: [], deleted: [], missing: ["zz"] } });
    assert.equal(told.length, 2, "a change that changed nothing is not told");
  });

  // (fails before: yes — the same)
  test("a collection that is no name, a record that is no JSON object, an id that is none: refused naming the rule, nothing kept (AFC-89)", () => {
    const { store, folder } = spend();
    for (const c of ["../x", "a b", "x".repeat(41), "", "-x", "a.b", null, 7]) {
      const r = /** @type {any} */ (store.data.change("spend-k3f9", c, { set: [{ a: 1 }] }, "page"));
      assert.deepEqual([r.ok, r.status, r.error], [false, 400, `${JSON.stringify(c ?? "")} is no collection: ${COLLECTION_RULE}`], String(c));
    }
    assert.equal(collectionName(" Expenses_2026 "), "expenses_2026");
    assert.equal(collectionName("x".repeat(40)), "x".repeat(40));
    const no = (/** @type {any} */ change) => /** @type {any} */ (store.data.change("spend-k3f9", "expenses", change, "page")).error;
    assert.equal(no({ set: [[1]] }), 'Nothing was kept: set\'s record 1 is not a JSON object ({ "amount": 12 }), so it cannot be kept');
    assert.equal(no({ set: [{ a: 1 }, "x"] }), 'Nothing was kept: set\'s record 2 is not a JSON object ({ "amount": 12 }), so it cannot be kept');
    assert.equal(no({ set: [{ id: true }] }), "Nothing was kept: set's record 1 has the id true: an id is words of 200 characters at most, or a whole number");
    assert.equal(no({ set: [{ id: 1.5 }] }), "Nothing was kept: set's record 1 has the id 1.5: an id is words of 200 characters at most, or a whole number");
    assert.match(no({ set: [{ id: "x".repeat(201) }] }), /^Nothing was kept: set's record 1 has the id "x+": an id is words/);
    assert.equal(no({ update: ["r1"] }), 'Nothing was kept: update 1 is not a JSON object: give its id and the fields to change ({ "id": "r1", "amount": 30 })');
    assert.equal(no({ update: [{ amount: 1 }] }), "Nothing was kept: update 1 names no record: give its id with the fields to change");
    assert.equal(no({ delete: [{ id: 1 }] }), 'Nothing was kept: delete\'s id 1 ({"id":1}) is no id');
    assert.equal(existsSync(folder), false, "nothing written");
  });

  // (fails before: yes — the same)
  test("a change is all or nothing: one bad part keeps none of it; a good one does each, in one write, told once (AFC-95)", () => {
    const { store, told } = spend();
    store.data.change("spend-k3f9", "expenses", { set: [{ id: "a", n: 1 }, { id: "b", n: 2 }] }, "page");
    const before = store.data.list("spend-k3f9", "expenses");
    const bad = store.data.change("spend-k3f9", "expenses", { set: [{ id: "c", n: 3 }], update: [{ id: "zz", n: 0 }], delete: ["a"] }, "agent");
    assert.equal(bad.ok, false);
    assert.deepEqual(store.data.list("spend-k3f9", "expenses"), before, "the set and the delete beside the bad update were not kept");
    const good = /** @type {any} */ (store.data.change("spend-k3f9", "expenses", { set: [{ id: "c", n: 3 }], update: [{ id: "b", n: 20 }], delete: ["a", "gone"] }, "agent"));
    assert.deepEqual(good.done, { set: [{ id: "c", n: 3 }], updated: [{ id: "b", n: 20 }], deleted: ["a"], missing: ["gone"] });
    assert.deepEqual(/** @type {any} */ (store.data.list("spend-k3f9", "expenses")).records, [{ id: "b", n: 20 }, { id: "c", n: 3 }]);
    assert.deepEqual(told.map((t) => t.news), [{ collection: "expenses", from: "page" }, { collection: "expenses", from: "agent" }]);
  });

  // (fails before: yes — the same)
  test("the data is the artifact's: a new version and an old one made the newest keep it; deleting the artifact takes it (AFC-91)", () => {
    const { store, by, folder } = spend();
    store.data.change("spend-k3f9", "expenses", { set: [{ id: "a", n: 1 }] }, "page");
    assert.equal(store.publish({ name: "spend-k3f9", files: [{ path: "index.html", data: Buffer.from("<p>v2</p>") }], by, who: "c1" }).ok, true);
    assert.equal(store.restore("spend-k3f9", 1).ok, true);
    assert.deepEqual(/** @type {any} */ (store.data.list("spend-k3f9", "expenses")).records, [{ id: "a", n: 1 }]);
    assert.ok(store.remove("spend-k3f9"));
    assert.equal(existsSync(folder), false);
    assert.deepEqual(store.data.list("spend-k3f9", "expenses"), { ok: false, status: 410, error: "spend-k3f9 was deleted, and its data with it" });
    assert.deepEqual(store.data.collections("nope-0000"), { ok: false, status: 404, error: "there is no artifact named nope-0000" });
    assert.deepEqual(store.data.change("nope-0000", "expenses", { set: [{}] }, "page"), { ok: false, status: 404, error: "there is no artifact named nope-0000" });
  });

  // (fails before: yes — the same)
  test("a collection's file broken by a hand: said in words, once in the log, never thrown; the others work; a set over it refused (AFC-96)", () => {
    const { store, said, folder } = spend();
    store.data.change("spend-k3f9", "budgets", { set: [{ id: "x", cap: 100 }] }, "page");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "expenses.json"), "{");
    writeFileSync(join(folder, "odd.json"), JSON.stringify({ version: 2, records: [] }));
    writeFileSync(join(folder, "Not A Name.json"), "[]");
    const r = /** @type {any} */ (store.data.list("spend-k3f9", "expenses"));
    assert.deepEqual([r.ok, r.status], [false, 500]);
    assert.match(r.error, /^expenses could not be read from Filament's store \(.+\); its other collections are as they were$/);
    store.data.list("spend-k3f9", "expenses");
    assert.equal(said.filter((s) => s.includes("expenses could not be read")).length, 1, "said once");
    assert.deepEqual(store.data.collections("spend-k3f9"), {
      ok: true,
      collections: [
        { name: "budgets", count: 1 },
        { name: "expenses", error: r.error },
        { name: "odd", error: "odd could not be read from Filament's store (its file is not one Filament reads); its other collections are as they were" },
      ],
    }, "a file whose name is no collection's is not one");
    assert.equal(/** @type {any} */ (store.data.change("spend-k3f9", "expenses", { set: [{ n: 1 }] }, "page")).status, 500);
    assert.equal(readFileSync(join(folder, "expenses.json"), "utf8"), "{", "left as it was, for a hand to mend");
    assert.deepEqual(/** @type {any} */ (store.data.get("spend-k3f9", "budgets", "x")).record, { id: "x", cap: 100 });
  });

  // (fails before: yes — the bug hunt of 10-30, SPACE-6: a collection had no cap, so each change was kept however big it
  // made the file, past what Filament reads back, and one past what one string holds threw out of the change)
  test("a change that would leave a collection past its cap is refused in words, 413, nothing written or told; one that leaves it no bigger goes through", () => {
    const { store, folder } = spend();
    const file = join(folder, "expenses.json");
    const note = "x".repeat(900);
    /** @type {any[]} */
    const heard = [];
    const capped = createArtifactData({ store, maxBytes: 2048, onChange: (_name, news) => heard.push(news) });
    assert.equal(capped.change("spend-k3f9", "expenses", { set: [{ id: "a", note }, { id: "b", note }] }, "page").ok, true);
    const kept = readFileSync(file, "utf8");
    const over = "Nothing was kept: expenses would be more than 2 KB, the most one collection keeps; delete records it no longer needs, or keep some in another collection";
    assert.deepEqual(capped.change("spend-k3f9", "expenses", { set: [{ id: "c", note }] }, "page"), { ok: false, status: 413, error: over });
    assert.deepEqual(capped.change("spend-k3f9", "expenses", { update: [{ id: "a", note: note + note }] }, "agent"), { ok: false, status: 413, error: over }, "an update that grows it too");
    // Past what one string holds, JSON.stringify throws a RangeError: a record whose JSON throws it stands in for one.
    const huge = { id: "huge", toJSON: () => { throw new RangeError("Invalid string length"); } };
    assert.deepEqual(capped.change("spend-k3f9", "expenses", { set: [huge] }, "page"), { ok: false, status: 413, error: over });
    assert.equal(readFileSync(file, "utf8"), kept, "nothing written");
    assert.equal(heard.length, 1, "nothing told but the change kept");
    // One kept bigger than this cap — under another — grows no more, but shrinks, or changes as big, as it likes.
    assert.equal(store.data.change("spend-k3f9", "expenses", { set: [{ id: "c", note }] }, "page").ok, true);
    assert.equal(capped.change("spend-k3f9", "expenses", { set: [{ id: "d", n: 1 }] }, "page").ok, false);
    assert.equal(capped.change("spend-k3f9", "expenses", { update: [{ id: "b", note: "y".repeat(900) }] }, "page").ok, true, "as big as it was");
    assert.equal(capped.change("spend-k3f9", "expenses", { update: [{ id: "a", note: "x".repeat(800) }] }, "page").ok, true, "smaller, though past its cap still");
    assert.equal(capped.change("spend-k3f9", "expenses", { delete: ["c"] }, "agent").ok, true);
    assert.deepEqual(/** @type {any} */ (store.data.list("spend-k3f9", "expenses")).records.map((/** @type {any} */ r) => r.id), ["a", "b"]);
    // The store's own cap is 64 MB a collection: refused there in its words, to the agent too.
    assert.equal(/** @type {any} */ (store.data.change("spend-k3f9", "expenses", { set: [huge] }, "page")).error, over.replace("2 KB", "64 MB"));
    assert.deepEqual(artifactCall({ action: "write_db", id: "spend-k3f9", collection: "expenses", set: [huge] }, at, store), { ok: false, error: `${over.replace("2 KB", "64 MB")}.` });
  });

  // (fails before: yes — the bug hunt of 10-30, SPACE-6: an artifact's collections had no cap together, so a page or an
  // agent that spread its records over collections grew its data without bound)
  test("a change that would leave an artifact's collections past their cap together, and bigger, is refused in words, 413, nothing written or told; one that grows them no more goes through", () => {
    const { store, folder } = spend();
    const note = "x".repeat(900);
    /** @type {any[]} */
    const heard = [];
    const capped = createArtifactData({ store, maxBytes: 2048, maxTotalBytes: 3072, onChange: (_name, news) => heard.push(news) });
    assert.equal(capped.change("spend-k3f9", "expenses", { set: [{ id: "a", note }, { id: "b", note }] }, "page").ok, true);
    assert.equal(capped.change("spend-k3f9", "budgets", { set: [{ id: "a", note }] }, "page").ok, true);
    const keptNow = () => ["expenses", "budgets"].map((c) => readFileSync(join(folder, `${c}.json`), "utf8"));
    const kept = keptNow();
    const over = "Nothing was kept: spend-k3f9's collections would be more than 3 KB together, the most one artifact keeps; delete records it no longer needs";
    assert.deepEqual(capped.change("spend-k3f9", "notes", { set: [{ id: "a", note }, { id: "b", note }] }, "page"), { ok: false, status: 413, error: over }, "a collection under its own cap, past theirs together");
    assert.deepEqual(capped.change("spend-k3f9", "budgets", { set: [{ id: "b", note }] }, "agent"), { ok: false, status: 413, error: over }, "a set that grows one");
    assert.deepEqual(capped.change("spend-k3f9", "budgets", { update: [{ id: "a", note: note + note }] }, "agent"), { ok: false, status: 413, error: over }, "an update that grows one");
    assert.equal(existsSync(join(folder, "notes.json")), false, "nothing written");
    assert.deepEqual(keptNow(), kept, "what was kept is as it was");
    assert.equal(heard.length, 2, "nothing told but the changes kept");
    assert.equal(capped.change("spend-k3f9", "notes", { set: [{ id: "a", n: 1 }] }, "page").ok, true, "one that fits");
    // Kept past this cap together — under another — they grow no more, but shrink, or change as big, as they like.
    assert.equal(store.data.change("spend-k3f9", "budgets", { set: [{ id: "b", note }] }, "page").ok, true);
    assert.equal(capped.change("spend-k3f9", "notes", { set: [{ id: "b", n: 1 }] }, "page").ok, false);
    assert.equal(capped.change("spend-k3f9", "budgets", { update: [{ id: "b", note: "y".repeat(900) }] }, "page").ok, true, "as big as it was");
    assert.equal(capped.change("spend-k3f9", "expenses", { delete: ["a"] }, "agent").ok, true, "smaller");
    assert.equal(capped.change("spend-k3f9", "notes", { set: [{ id: "b", n: 1 }] }, "page").ok, true, "back under the cap, they grow again");
  });

  // (fails before: yes — the same)
  test("those that follow an artifact's data hear each change and who made it; one that fails is logged, the change kept; stopped, none (AFC-92)", () => {
    const { store, said, told } = spend();
    /** @type {any[]} */
    const heard = [];
    const stop = store.data.follow("spend-k3f9", (n) => heard.push(n));
    store.data.follow("spend-k3f9", () => {
      throw new Error("the stream broke");
    });
    store.data.change("spend-k3f9", "expenses", { set: [{ id: "a" }] }, "m1abc");
    assert.deepEqual(heard, [{ collection: "expenses", from: "m1abc" }]);
    assert.deepEqual(told, [{ name: "spend-k3f9", news: { collection: "expenses", from: "m1abc" } }], "the harness after them");
    assert.deepEqual(said, ["warn: artifacts: spend-k3f9's expenses changed, but telling a page that follows it failed (the stream broke)"]);
    stop();
    store.data.change("spend-k3f9", "expenses", { delete: ["a"] }, "agent");
    assert.equal(heard.length, 1);
  });
});

describe("the agent's read_db and write_db (AFC-94, AFC-95)", () => {
  // (fails before: yes — the tool had no read_db)
  test("read_db: none kept yet; each collection with its count; one collection's records whole, a line each; refusals in words (AFC-94)", () => {
    const { store, folder } = spend();
    const read = (/** @type {any} */ input) => /** @type {any} */ (artifactCall({ action: "read_db", id: "spend-k3f9", ...input }, at, store));
    assert.equal(read({}).text, "Spend (spend-k3f9) keeps no data yet: its page keeps records with filament.db, and write_db adds them.");
    store.data.change("spend-k3f9", "expenses", { set: [{ id: "a", amount: 12, note: "lunch" }, { id: 2, amount: 5 }] }, "page");
    store.data.change("spend-k3f9", "budgets", { set: [{ id: "m", cap: 100 }] }, "page");
    assert.equal(read({}).text, "Spend (spend-k3f9) keeps 2 collections: budgets (1 record), expenses (2 records). Give collection to read one's records.");
    assert.equal(read({ collection: "Expenses" }).text, 'expenses in Spend: 2 records, in the order kept, one a line:\n{"id":"a","amount":12,"note":"lunch"}\n{"id":2,"amount":5}');
    assert.equal(read({ collection: "todos" }).text, "todos in Spend holds no records.");
    assert.deepEqual(read({ collection: "a b" }), { ok: false, error: `"a b" is no collection: ${COLLECTION_RULE}.` });
    assert.deepEqual(artifactCall({ action: "read_db" }, at, store), { ok: false, error: "read_db needs id: the artifact's name, as list gives it, or its address." });
    assert.deepEqual(artifactCall({ action: "read_db", id: "nope-0000" }, at, store), { ok: false, error: "There is no artifact named nope-0000: list shows them." });
    assert.match(/** @type {any} */ (artifactCall({ action: "read", id: "spend-k3f9" }, at, store)).text, /\nData: 2 collections: budgets \(1 record\), expenses \(2 records\); read_db reads them\n/, "read names them too");
    writeFileSync(join(folder, "expenses.json"), "{");
    assert.equal(read({}).text, "Spend (spend-k3f9) keeps 2 collections: budgets (1 record), expenses (could not be read). Give collection to read one's records.");
    assert.match(read({ collection: "expenses" }).error, /^expenses could not be read from Filament's store \(.+\); its other collections are as they were\.$/);
  });

  // (fails before: yes — the tool had no write_db)
  test("write_db: all or nothing, the bad part named; done, what changed, and the pages that follow hear the agent (AFC-95)", () => {
    const { store, told } = spend();
    const write = (/** @type {any} */ input) => /** @type {any} */ (artifactCall({ action: "write_db", id: "http://spend-k3f9.art.localhost:20300/", ...input }, at, store));
    assert.deepEqual(write({ set: [{ a: 1 }] }), { ok: false, error: "write_db needs collection: the one to change (expenses)." });
    assert.deepEqual(write({ collection: "expenses" }), { ok: false, error: "Nothing was kept: write_db needs set, update or delete." });
    assert.deepEqual(write({ collection: "expenses", set: { a: 1 } }), { ok: false, error: "Nothing was kept: set is a list of records." });
    assert.deepEqual(write({ collection: "expenses", delete: "a" }), { ok: false, error: "Nothing was kept: delete is a list of ids." });
    assert.deepEqual(write({ collection: "expenses", set: [{ id: "a", n: 1 }], update: [{ id: "zz", n: 2 }] }), { ok: false, error: 'Nothing was kept: expenses has no record "zz" to update; set adds one.' });
    assert.equal(told.length, 0, "nothing kept, nothing told");
    assert.equal(write({ collection: "expenses", set: [{ id: "a", n: 1 }, { id: 7, n: 2 }] }).text, 'Kept in expenses of Spend: set 2 records ("a", 7). Its page shows it at its next read, and at once where it follows changes.');
    assert.equal(write({ collection: "expenses", update: [{ id: "7", n: 3 }], delete: ["a", "x", "y"] }).text, 'Kept in expenses of Spend: updated 7; deleted "a". "x", "y" to delete were not there. Its page shows it at its next read, and at once where it follows changes.');
    assert.equal(write({ collection: "expenses", delete: ["x"] }).text, 'Kept in expenses of Spend: nothing changed. "x" to delete was not there. Its page shows it at its next read, and at once where it follows changes.');
    assert.deepEqual(told.map((t) => t.news), [{ collection: "expenses", from: "agent" }, { collection: "expenses", from: "agent" }]);
  });
});

describe("what the harness reads of a page's data (AFC-97)", () => {
  // (fails before: yes — the harness read nothing of it)
  test("each collection with its count, or that it could not be read, beside the artifact's other fields", () => {
    const { store, folder } = spend();
    store.data.change("spend-k3f9", "expenses", { set: [{ n: 1 }, { n: 2 }] }, "page");
    writeFileSync(join(folder, "budgets.json"), "{");
    const a = /** @type {any} */ (store.get("spend-k3f9"));
    const dataOf = (/** @type {string} */ name) => /** @type {any} */ (store.data.collections(name)).collections;
    assert.deepEqual(artifactView(a, 20300, () => null, dataOf).data, [{ name: "budgets", error: dataOf("spend-k3f9")[0].error }, { name: "expenses", count: 2 }]);
    assert.deepEqual(artifactView(a, 20300).data, [], "none where nothing reads it");
  });
});

describe("the page's data at its own address", () => {
  /** @type {ReturnType<typeof spend>} */
  let s;
  /** @type {http.Server} */
  let srv;
  /** @type {number} */
  let port;
  before(async () => {
    s = spend(["aaaa"]);
    s.store.publish({ title: "Gone", files: [{ path: "index.html", data: Buffer.from("x") }], by: s.by, who: "c1" });
    s.store.remove("gone-aaaa");
    const answer = createArtifactsHandler({ store: s.store, server: () => ({ host: "127.0.0.1", allowedHosts: [], maxBodyBytes: 400 }), port: () => port });
    srv = http.createServer((req, res) => {
      const name = artifactNameOfHost(String(req.headers.host || "").replace(/:\d+$/, "")) ?? "";
      Promise.resolve(answer(req, res, name, new URL(String(req.url), "http://x"))).catch((e) => res.writeHead(500).end(String(e)));
    });
    await new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(null)));
    port = /** @type {any} */ (srv.address()).port;
  });
  after(async () => {
    srv.closeAllConnections();
    await new Promise((resolve) => srv.close(resolve));
  });
  const own = () => `http://spend-k3f9.art.localhost:${port}`;
  /**
   * A request as a page sends it: its Host the artifact's, its Origin as given.
   * @param {string} path @param {{ method?: string, origin?: string | null, body?: string, host?: string, mark?: string }} [o]
   * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, json: any }>}
   */
  const ask = (path, { method = "GET", origin = own(), body, host = `spend-k3f9.art.localhost:${port}`, mark } = {}) =>
    new Promise((resolve, reject) => {
      /** @type {Record<string, string>} */
      const headers = { host };
      if (origin) headers.origin = origin;
      if (mark) headers[PAGE_MARK] = mark;
      if (body !== undefined) headers["content-type"] = "application/json";
      const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (text += d));
        res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, json: text && res.headers["content-type"]?.startsWith("application/json") ? JSON.parse(text) : text }));
      });
      req.on("error", reject);
      req.end(body);
    });

  // (fails before: yes — the address answered GET alone, and nothing of data)
  test("its own page sets, lists, reads, updates and deletes; each answer JSON, never kept by a cache, under the artifact's policy (AF-D7)", async () => {
    const set = await ask("/_filament/db/expenses", { method: "POST", body: JSON.stringify({ amount: 12 }) });
    assert.equal(set.status, 200);
    const id = set.json.record.id;
    assert.deepEqual(set.json, { record: { amount: 12, id } });
    assert.equal(set.headers["cache-control"], "no-store");
    assert.ok(set.headers["content-security-policy"], "the policy, as every answer of its address");
    assert.equal(set.headers["access-control-allow-origin"], undefined, "no other origin reads it");
    assert.deepEqual((await ask("/_filament/db")).json, { collections: [{ name: "expenses", count: 1 }] });
    assert.deepEqual((await ask("/_filament/db/expenses/")).json, { collection: "expenses", records: [{ amount: 12, id }] });
    assert.deepEqual((await ask(`/_filament/db/expenses/${id}`)).json, { record: { amount: 12, id } });
    const up = await ask(`/_filament/db/expenses/${id}`, { method: "PATCH", body: JSON.stringify({ amount: 30, id: "other" }) });
    assert.deepEqual(up.json, { record: { amount: 30, id } }, "the address names the record, not the body");
    const missing = await ask("/_filament/db/expenses/nope");
    assert.deepEqual([missing.status, missing.json], [404, { error: "expenses has no record nope.", missing: true }]);
    assert.deepEqual((await ask(`/_filament/db/expenses/${id}`, { method: "DELETE" })).json, { deleted: true });
    assert.deepEqual((await ask(`/_filament/db/expenses/${id}`, { method: "DELETE" })).json, { deleted: false });
    const head = await ask("/_filament/db/expenses", { method: "HEAD" });
    assert.deepEqual([head.status, head.json], [200, ""]);
    const spaced = await ask("/_filament/db/my%20things", { method: "POST", body: "{}" });
    assert.deepEqual([spaced.status, spaced.json.error], [400, `"my things" is no collection: ${COLLECTION_RULE}.`]);
  });

  // (fails before: yes — the same)
  test("a write from anywhere but its own page is refused, nothing written: no Origin, another artifact, the harness, a site, a file (AFC-90)", async () => {
    for (const origin of [null, `http://other-aaaa.art.localhost:${port}`, `http://127.0.0.1:${port}`, `http://localhost:${port}`, "https://evil.example", "null", `https://spend-k3f9.art.localhost:${port}`]) {
      for (const [method, path, body] of [["POST", "/_filament/db/expenses", "{}"], ["PATCH", "/_filament/db/expenses/a", "{}"], ["DELETE", "/_filament/db/expenses/a", undefined]]) {
        const r = await ask(String(path), { method: String(method), origin, body });
        assert.deepEqual([r.status, r.json], [403, { error: "Only the artifact's own page writes its data." }], `${method} from ${origin}`);
      }
    }
    const other = await ask("/_filament/db/expenses", { method: "POST", body: "{}", host: `other-aaaa.art.localhost:${port}`, origin: own() });
    assert.deepEqual([other.status, other.json], [403, { error: "Only the artifact's own page writes its data." }], "spend's page writes no other artifact's data");
    assert.deepEqual(/** @type {any} */ (s.store.data.list("spend-k3f9", "expenses")).records, []);
  });

  // (fails before: yes — the same)
  test("refused in words: a body that is not JSON or no object, one too big, a method the place does not take, an address that does not read; a deleted artifact and none", async () => {
    const no = async (/** @type {string} */ path, /** @type {any} */ o) => {
      const r = await ask(path, o);
      return [r.status, r.json.error, r.headers.allow];
    };
    assert.deepEqual(await no("/_filament/db/expenses", { method: "POST", body: "{" }), [400, "The body is not JSON: give a JSON object.", undefined]);
    assert.deepEqual(await no("/_filament/db/expenses", { method: "POST", body: "[1]" }), [400, 'Nothing was kept: set\'s record 1 is not a JSON object ({ "amount": 12 }), so it cannot be kept.', undefined]);
    assert.deepEqual(await no("/_filament/db/expenses/a", { method: "PATCH", body: "\"x\"" }), [400, 'Nothing was kept: update 1 is not a JSON object: give its id and the fields to change ({ "id": "r1", "amount": 30 }).', undefined]);
    assert.deepEqual(await no("/_filament/db/expenses", { method: "POST", body: JSON.stringify({ note: "x".repeat(500) }) }), [413, "That is more than Filament takes in one request (server.maxBodyBytes).", undefined]);
    assert.deepEqual(await no("/_filament/db", { method: "POST", body: "{}" }), [405, "POST is not taken here: GET, HEAD.", "GET, HEAD"]);
    assert.deepEqual(await no("/_filament/db/expenses", { method: "PUT", body: "{}" }), [405, "PUT is not taken here: GET, HEAD, POST.", "GET, HEAD, POST"]);
    assert.deepEqual(await no("/_filament/db/expenses/a", { method: "POST", body: "{}" }), [405, "POST is not taken here: GET, HEAD, PATCH, DELETE.", "GET, HEAD, PATCH, DELETE"]);
    assert.deepEqual(await no("/_filament/db/%E0%A4%A", {}), [400, "That address does not read.", undefined]);
    assert.deepEqual(await no("/_filament/db/expenses", { host: `gone-aaaa.art.localhost:${port}` }), [410, "gone-aaaa was deleted, and its data with it.", undefined]);
    assert.deepEqual(await no("/_filament/db/expenses", { host: `nope-0000.art.localhost:${port}` }), [404, "there is no artifact named nope-0000.", undefined]);
    const page = await ask("/", { method: "POST", body: "{}" });
    assert.deepEqual([page.status, page.json], [405, "An artifact's address takes GET only, but for its data.\n"]);
  });

  // (fails before: yes — a page heard of no change made elsewhere)
  test("its changes, as they are kept: each with who made it, so a page knows its own; the agent's too; none for an artifact not there (AFC-92)", async () => {
    /** @type {any[]} */
    const heard = [];
    const stream = http.get({ host: "127.0.0.1", port, path: "/_filament/changes", headers: { host: `spend-k3f9.art.localhost:${port}` } }, (res) => {
      assert.equal(res.headers["content-type"], "text/event-stream; charset=utf-8");
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (d) => {
        buf += d;
        for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (line.startsWith("data: ")) heard.push(JSON.parse(line.slice(6)));
          else heard.push(line);
        }
      });
    });
    stream.on("error", () => {});
    await until(() => heard.length > 0, "the stream opened");
    await ask("/_filament/db/notes", { method: "POST", body: "{}", mark: "m1abc" });
    await ask("/_filament/db/notes", { method: "POST", body: "{}" });
    artifactCall({ action: "write_db", id: "spend-k3f9", collection: "notes", set: [{ id: "x" }] }, at, s.store);
    await until(() => heard.length >= 4, "three changes heard");
    assert.deepEqual(heard, [": following", { collection: "notes", from: "m1abc" }, { collection: "notes", from: "page" }, { collection: "notes", from: "agent" }]);
    stream.destroy();
    const none = await ask("/_filament/changes", { host: `nope-0000.art.localhost:${port}` });
    assert.deepEqual([none.status, none.json], [404, "No artifact is named nope-0000.\n"]);
    const post = await ask("/_filament/changes", { method: "POST", body: "{}" });
    assert.deepEqual([post.status, post.json, post.headers.allow], [405, { error: "The changes are read by GET." }, "GET"]);
  });

  // (fails before: yes — the bug hunt of 10-30, SPACE-6: an artifact's collections had no cap together)
  test("past 256 MB in all its collections, the page's write that grows them is refused in words, 413, and the agent's write_db too; a delete goes through", async () => {
    const kept = await ask("/_filament/db/expenses", { method: "POST", body: JSON.stringify({ id: "rent", amount: 900 }) });
    assert.equal(kept.status, 200);
    // A collection kept under a bigger cap, 256 MB on the disk: what the rest may add is measured against it.
    const big = join(s.folder, "archive.json");
    writeFileSync(big, "");
    truncateSync(big, 256 * 1048576);
    try {
      const over = "Nothing was kept: spend-k3f9's collections would be more than 256 MB together, the most one artifact keeps; delete records it no longer needs.";
      const page = await ask("/_filament/db/expenses", { method: "POST", body: JSON.stringify({ amount: 12 }) });
      assert.deepEqual([page.status, page.json], [413, { error: over }]);
      assert.deepEqual(artifactCall({ action: "write_db", id: "spend-k3f9", collection: "notes", set: [{ n: 1 }] }, at, s.store), { ok: false, error: over });
      assert.deepEqual(/** @type {any} */ (s.store.data.list("spend-k3f9", "expenses")).records, [{ id: "rent", amount: 900 }], "what was kept is as it was");
      assert.deepEqual((await ask("/_filament/db/expenses/rent", { method: "DELETE" })).json, { deleted: true });
    } finally {
      rmSync(big, { force: true });
    }
  });
});
