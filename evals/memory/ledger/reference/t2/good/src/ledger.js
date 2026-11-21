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

/**
 * The total of each month's entries.
 * @param {{ entries: { date: string, amount: number }[] }} ledger
 * @returns {Record<string, number>} each month (`YYYY-MM`) and its total in cents
 */
export function monthlyTotals(ledger) {
  const out = {};
  for (const e of ledger.entries) {
    const month = e.date.slice(0, 7);
    out[month] = (out[month] || 0) + e.amount;
  }
  return out;
}

/**
 * The categories whose spending is over their budget.
 * @param {{ entries: { amount: number, category: string }[] }} ledger
 * @param {Record<string, number>} budgets  each category's budget in cents
 * @returns {string[]} their names, sorted
 */
export function overBudget(ledger, budgets) {
  if (budgets === null || typeof budgets !== "object" || Array.isArray(budgets)) throw new TypeError("overBudget: budgets must be an object");
  const spent = byCategory(ledger);
  return Object.keys(budgets)
    .filter((c) => (spent[c] || 0) > budgets[c])
    .sort();
}
