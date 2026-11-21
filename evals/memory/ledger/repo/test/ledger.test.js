import { test } from "node:test";
import assert from "node:assert/strict";
import { createLedger, addEntry, total, byCategory } from "../src/ledger.js";

const sample = () => {
  const l = createLedger();
  addEntry(l, { date: "2026-01-05", amount: 1250, category: "food", note: "lunch" });
  addEntry(l, { date: "2026-01-06", amount: 300, category: "home" });
  addEntry(l, { date: "2026-02-01", amount: 700, category: "food" });
  return l;
};

test("addEntry keeps an entry and refuses a bad one", () => {
  const l = createLedger();
  assert.deepEqual(addEntry(l, { date: "2026-01-05", amount: 1, category: "food" }), { date: "2026-01-05", amount: 1, category: "food", note: "" });
  assert.throws(() => addEntry(l, { date: "5 Jan", amount: 1, category: "food" }));
  assert.throws(() => addEntry(l, { date: "2026-01-05", amount: 1.5, category: "food" }));
  assert.throws(() => addEntry(l, { date: "2026-01-05", amount: 1 }));
});

test("total and byCategory", () => {
  assert.equal(total(sample()), 2250);
  assert.deepEqual(byCategory(sample()), { food: 1950, home: 300 });
});
