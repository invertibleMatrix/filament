export function createLedger() {
  return { entries: [] };
}

export function addEntry(ledger, { date, amount, category, note = "" }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error(`date must be YYYY-MM-DD, got ${date}`);
  if (!Number.isInteger(amount)) throw new Error(`amount must be a whole number of cents, got ${amount}`);
  if (!category) throw new Error("category is required");
  const entry = { date, amount, category, note };
  ledger.entries.push(entry);
  return entry;
}

export function total(ledger) {
  return ledger.entries.reduce((sum, e) => sum + e.amount, 0);
}

export function byCategory(ledger) {
  const out = {};
  for (const e of ledger.entries) out[e.category] = (out[e.category] || 0) + e.amount;
  return out;
}

// The total of each month (YYYY-MM).
export function monthlyTotals(ledger) {
  const out = {};
  for (const e of ledger.entries) {
    const month = e.date.slice(0, 7);
    out[month] = (out[month] || 0) + e.amount;
  }
  return out;
}
