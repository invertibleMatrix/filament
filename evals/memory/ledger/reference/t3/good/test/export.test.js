import { test } from "node:test";
import assert from "node:assert/strict";
import { createLedger, addEntry } from "../src/ledger.js";
import { toCsv } from "../src/export.js";

test("toCsv writes a header, then each entry, quoting only where it must", () => {
  const l = createLedger();
  addEntry(l, { date: "2026-01-05", amount: 1250, category: "food", note: "lunch" });
  addEntry(l, { date: "2026-01-06", amount: 800, category: "food", note: "pizza, salad" });
  addEntry(l, { date: "2026-01-07", amount: 99, category: "home", note: 'the "big" one' });
  assert.equal(toCsv(l), 'date,amount,category,note\n2026-01-05,12.50,food,lunch\n2026-01-06,8.00,food,"pizza, salad"\n2026-01-07,0.99,home,"the ""big"" one"\n');
});
