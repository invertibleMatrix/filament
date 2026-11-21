import { parseAmount } from "./money.js";
import { createLedger, addEntry } from "./ledger.js";

/** The fields of one CSV line, a quoted field read with its commas and doubled quotes. */
function fields(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * A ledger from CSV in the format `toCsv` writes: a header line, then one line per entry.
 * @param {string} text
 * @returns {{ entries: { date: string, amount: number, category: string, note: string }[] }}
 */
export function fromCsv(text) {
  const ledger = createLedger();
  String(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (i === 0 || !line.trim()) return;
      const f = fields(line);
      if (f.length !== 4) throw new Error(`fromCsv: line ${i + 1} has ${f.length} fields, expected 4`);
      let amount;
      try {
        amount = parseAmount(f[1]);
      } catch {
        throw new Error(`fromCsv: line ${i + 1}: ${f[1]} is not an amount`);
      }
      addEntry(ledger, { date: f[0], amount, category: f[2], note: f[3] });
    });
  return ledger;
}
