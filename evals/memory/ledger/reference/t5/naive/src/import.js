import { parseRow } from "./vendor/csv.js";
import { parseAmount } from "./money.js";
import { createLedger, addEntry } from "./ledger.js";

export function fromCsv(text) {
  const ledger = createLedger();
  String(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (i === 0 || !line.trim()) return;
      const f = parseRow(line);
      if (f.length !== 4) throw new Error(`line ${i + 1} has ${f.length} fields, expected 4`);
      addEntry(ledger, { date: f[0], amount: parseAmount(f[1]), category: f[2], note: f[3] });
    });
  return ledger;
}
