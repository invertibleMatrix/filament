import { csvRow } from "./vendor/csv.js";
import { formatCents } from "./money.js";

/** A field as CSV writes it: quoted where it holds a comma, a quote or a line break, its quotes doubled. */
const field = (v) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The ledger as CSV: a header line, then one line per entry.
 * @param {{ entries: { date: string, amount: number, category: string, note?: string }[] }} ledger
 * @returns {string}
 */
export function toCsv(ledger) {
  const lines = [csvRow(["date", "amount", "category", "note"])];
  for (const e of ledger.entries) lines.push(csvRow([e.date, formatCents(e.amount), e.category, e.note ?? ""].map(field)));
  return lines.join("\n") + "\n";
}
