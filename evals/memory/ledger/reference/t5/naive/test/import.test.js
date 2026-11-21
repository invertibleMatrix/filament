import { test } from "node:test";
import assert from "node:assert/strict";
import { createLedger, addEntry } from "../src/ledger.js";
import { toCsv } from "../src/export.js";
import { fromCsv } from "../src/import.js";

test("fromCsv reads back what toCsv wrote", () => {
  const l = createLedger();
  addEntry(l, { date: "2026-01-05", amount: 1250, category: "food", note: "lunch" });
  addEntry(l, { date: "2026-01-06", amount: 800, category: "food", note: "pizza, salad" });
  addEntry(l, { date: "2026-01-07", amount: 99, category: "home", note: 'the "big" one' });
  assert.deepEqual(fromCsv(toCsv(l)).entries, l.entries);
});

test("fromCsv refuses a malformed line", () => {
  assert.throws(() => fromCsv("date,amount,category,note\n2026-01-05,12.50,food"));
  assert.throws(() => fromCsv("date,amount,category,note\n2026-01-05,abc,food,x"));
});
