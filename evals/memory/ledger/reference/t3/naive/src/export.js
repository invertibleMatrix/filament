import { csvRow } from "./vendor/csv.js";
import { formatCents } from "./money.js";

export function toCsv(ledger) {
  const lines = [csvRow(["date", "amount", "category", "note"])];
  for (const e of ledger.entries) lines.push(csvRow([e.date, formatCents(e.amount), e.category, e.note ?? ""]));
  return lines.join("\n") + "\n";
}
