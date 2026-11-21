# tally

A small household ledger. Amounts are whole numbers of cents everywhere: 12.50 is `1250`.

```js
import { createLedger, addEntry, total, byCategory } from "./src/ledger.js";

const ledger = createLedger();
addEntry(ledger, { date: "2026-01-05", amount: 1250, category: "food", note: "lunch" });
total(ledger); // 1250
byCategory(ledger); // { food: 1250 }
```

`src/money.js` reads and writes amounts (`parseAmount("12.50")` is `1250`, `formatCents(1250)` is `"12.50"`).

Node 22 or newer, no dependencies. `npm test` runs the tests.
