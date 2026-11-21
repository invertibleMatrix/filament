# Changelog

## Unreleased

## 0.5.0 — 2026-11-21
- `fromCsv(text)` in src/import.js: a ledger from CSV.

## 0.4.0 — 2026-11-07
- `monthlyTotals(ledger)`: the total of each month.
- `overBudget(ledger, budgets)`: the categories over their budget.
- `toCsv(ledger)` in src/export.js: the ledger as CSV.

## 0.3.0 — 2026-09-14
- `byCategory(ledger)`: the total of each category.
- Amounts are whole numbers of cents everywhere.

## 0.2.0 — 2026-08-02
- `total(ledger)`.

## 0.1.0 — 2026-07-20
- First version: `createLedger` and `addEntry`.
