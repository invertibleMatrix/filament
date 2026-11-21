// The ledger fixture's tasks, in the order they run (docs/memory-evals.md). A small library, `tally`, and the person who
// owns it: six tasks over a few weeks of work. What the person wants beyond each task's own words is said once — told in
// a task's message, or in a correction where the agent's work misses it — and wanted again in the tasks after:
//
//   changelog      every change gets an item under `## Unreleased` in CHANGELOG.md        told in t1
//   jsdoc          every new exported function has a JSDoc block with @param and @returns  corrected in t1
//   error-prefix   an error's message starts with the function's name and a colon          corrected in t2
//   vendor         src/vendor/csv.js is never edited: a sync overwrites it                 corrected in t3
//   release-*      a release: src/version.js too, the changelog's heading, the notes       corrected in t4
//
// None of it can be read from the repository as it starts: memory, or the notes the agent keeps, is the only way a
// later session knows it. Each check answers true or what is wrong; `correction` is what the person says then.
import { fileURLToPath } from "node:url";
import { changelogGrew, changelogReleased, documented, releaseNotes, testsPass, untouched } from "../checks.mjs";

export const name = "ledger";

const VENDOR = fileURLToPath(new URL("./repo/src/vendor/csv.js", import.meta.url));

/** ES module code run in the folder: true where it exits 0, else `fail` and what it printed. @param {any} ctx @param {string} code @param {string} fail */
const probe = (ctx, code, fail) => {
  const r = ctx.probe(code);
  return r.ok || `${fail}${r.out ? `: ${r.out.split(/\r?\n/).slice(-3).join(" ")}` : ""}`;
};
/** The message a call throws, printed; a call that throws nothing exits 3. @param {string} module @param {string} call */
const thrown = (module, call) => `const m = await import("$repo/${module}");
try { ${call}; } catch (e) { console.log(JSON.stringify({ type: e?.constructor?.name, message: String(e?.message) })); process.exit(0); }
process.exit(3);`;
/** The message of what `call` throws starts with `prefix`. @param {any} ctx @param {string} module @param {string} call @param {string} prefix */
const prefixed = (ctx, module, call, prefix) => {
  const r = ctx.probe(thrown(module, call));
  if (!r.ok) return `${call} throws nothing`;
  const said = JSON.parse(r.out.split(/\r?\n/).pop() || "{}");
  return String(said.message).startsWith(prefix) || `${call} throws "${said.message}"`;
};

// ---- the preferences, as each task checks them ----
const changelog = () => ({ id: "changelog", kind: "pref", pref: "changelog", check: changelogGrew, correction: "Every change gets an item in CHANGELOG.md under `## Unreleased` — please add one for this." });
const jsdoc = (/** @type {string} */ file, /** @type {string} */ fn) => ({ id: "jsdoc", kind: "pref", pref: "jsdoc", check: (/** @type {any} */ ctx) => documented(ctx, file, fn), correction: `Every exported function gets a JSDoc block right above it, with @param and @returns — please add one to \`${fn}\`.` });
const errorPrefix = (/** @type {string} */ module, /** @type {string} */ call, /** @type {string} */ fn, /** @type {string} */ example) => ({ id: "error-prefix", kind: "pref", pref: "error-prefix", check: (/** @type {any} */ ctx) => prefixed(ctx, module, call, `${fn}: `), correction: `When one of our functions throws, the message starts with the function's name and a colon — here, something like \`${fn}: ${example}\`.` });
const vendor = () => ({ id: "vendor", kind: "pref", pref: "vendor", check: (/** @type {any} */ ctx) => untouched(ctx, "src/vendor/csv.js", VENDOR), correction: "Please don't edit src/vendor/csv.js: it's vendored from our shared-utils repo and the next sync overwrites it. Put it back as it was and handle that in your own module." });
const tests = (/** @type {string} */ fn) => ({ id: "tests", kind: "task", check: (/** @type {any} */ ctx) => testsPass(ctx, fn), correction: `Please add tests for \`${fn}\` under test/, and make sure \`npm test\` passes.` });
const release = (/** @type {string} */ v) => [
  { id: "version", kind: "task", check: (/** @type {any} */ ctx) => JSON.parse(ctx.read("package.json") || "{}").version === v || `package.json says ${JSON.parse(ctx.read("package.json") || "{}").version}`, correction: `package.json should say version ${v}.` },
  { id: "release-version", kind: "pref", pref: "release-version", check: (/** @type {any} */ ctx) => new RegExp(`VERSION\\s*=\\s*["']${v.replace(/\./g, "\\.")}["']`).test(ctx.read("src/version.js") || "") || "src/version.js says another version", correction: `The version is in src/version.js too — both must say ${v}.` },
  { id: "release-changelog", kind: "pref", pref: "release-changelog", check: (/** @type {any} */ ctx) => changelogReleased(ctx, v), correction: `In CHANGELOG.md a release gets its own heading, \`## ${v} — <today, as YYYY-MM-DD>\`, over the items that were under \`## Unreleased\`, and an empty \`## Unreleased\` heading stays above it.` },
  { id: "release-notes", kind: "pref", pref: "release-notes", check: (/** @type {any} */ ctx) => releaseNotes(ctx, v), correction: `Each release needs its notes: run \`node scripts/release-notes.mjs ${v}\` once CHANGELOG.md has the release's heading.` },
  { id: "tests", kind: "task", check: (/** @type {any} */ ctx) => testsPass(ctx), correction: "`npm test` fails — please fix it." },
];

const LEDGER = `const L = await import("$repo/src/ledger.js");
const l = L.createLedger();
L.addEntry(l, { date: "2026-01-05", amount: 1200, category: "food" });
L.addEntry(l, { date: "2026-01-31", amount: 300, category: "home" });
L.addEntry(l, { date: "2026-02-01", amount: 500, category: "food" });
L.addEntry(l, { date: "2025-12-31", amount: 50, category: "fun" });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const fail = (what) => { console.error(what); process.exit(1); };`;

const CSV = 'date,amount,category,note\n2026-01-05,12.50,food,lunch\n2026-01-06,8.00,food,"pizza, salad"\n2026-01-07,0.99,home,"the ""big"" one"\n2026-01-08,100.00,fun,';
const ENTRIES = [
  { date: "2026-01-05", amount: 1250, category: "food", note: "lunch" },
  { date: "2026-01-06", amount: 800, category: "food", note: "pizza, salad" },
  { date: "2026-01-07", amount: 99, category: "home", note: 'the "big" one' },
  { date: "2026-01-08", amount: 10000, category: "fun", note: "" },
];

/** @type {import("../../../scripts/memory-task-eval.mjs").Task[]} */
export const tasks = [
  {
    id: "t1",
    title: "Monthly totals",
    prompt: "Add a `monthlyTotals(ledger)` function to src/ledger.js: it returns a plain object mapping each month (`YYYY-MM`, taken from the entry's date) to the total amount, in cents, of that month's entries. Add tests for it. One thing about this repo: every change gets an item in CHANGELOG.md under the `## Unreleased` heading.",
    teaches: ["changelog"],
    checks: [
      {
        id: "monthly-totals",
        kind: "task",
        check: (ctx) => probe(ctx, `${LEDGER}
if (typeof L.monthlyTotals !== "function") fail("no monthlyTotals export");
const got = L.monthlyTotals(l);
if (!same(sorted(got), { "2025-12": 50, "2026-01": 1500, "2026-02": 500 })) fail(JSON.stringify(got));
if (!same(L.monthlyTotals(L.createLedger()), {})) fail("an empty ledger: " + JSON.stringify(L.monthlyTotals(L.createLedger())));`, "monthlyTotals gives the wrong totals"),
        correction: '`monthlyTotals` doesn\'t give the right totals: it should map each `YYYY-MM` to that month\'s total in cents, like `{ "2026-01": 1500, "2026-02": 500 }`, and `{}` for an empty ledger.',
      },
      tests("monthlyTotals"),
      changelog(),
      jsdoc("src/ledger.js", "monthlyTotals"),
    ],
  },
  {
    id: "t2",
    title: "Over budget",
    prompt: "Add `overBudget(ledger, budgets)` to src/ledger.js. `budgets` maps a category to a budget in cents; return the names of the categories whose total spending is over their budget (equal is fine), sorted alphabetically. Categories with no budget are ignored. If `budgets` isn't a plain object (null, an array, a string…), throw a TypeError. Add tests.",
    checks: [
      {
        id: "over-budget",
        kind: "task",
        check: (ctx) => probe(ctx, `${LEDGER}
if (typeof L.overBudget !== "function") fail("no overBudget export");
const a = L.overBudget(l, { food: 1700, home: 299, travel: 10 });
if (!same(a, ["home"])) fail(JSON.stringify(a));
const b = L.overBudget(l, { food: 100, fun: 10, home: 300 });
if (!same(b, ["food", "fun"])) fail(JSON.stringify(b));
for (const bad of [null, [1], "x"]) { let t = null; try { L.overBudget(l, bad); } catch (e) { t = e; } if (!(t instanceof TypeError)) fail("overBudget(l, " + JSON.stringify(bad) + ") throws " + (t ? t.constructor.name : "nothing")); }`, "overBudget answers wrong"),
        correction: "`overBudget` doesn't do what I asked: the categories over their budget (equal is fine), sorted, categories with no budget ignored, and a TypeError when budgets isn't a plain object.",
      },
      tests("overBudget"),
      changelog(),
      jsdoc("src/ledger.js", "overBudget"),
      errorPrefix("src/ledger.js", "m.overBudget(m.createLedger(), null)", "overBudget", "budgets must be an object"),
    ],
  },
  {
    id: "t3",
    title: "CSV export",
    prompt: "Add a new module src/export.js with `toCsv(ledger)`: CSV text with the header line `date,amount,category,note` and then one line per entry, the amount with two decimals (1250 → 12.50). Notes can contain commas and double quotes: quote a field only when it contains a comma, a double quote or a line break, and double the quotes inside it. Use the helpers in src/vendor/csv.js. Add tests.",
    checks: [
      {
        id: "to-csv",
        kind: "task",
        check: (ctx) => probe(ctx, `const L = await import("$repo/src/ledger.js");
const X = await import("$repo/src/export.js");
const l = L.createLedger();
for (const e of ${JSON.stringify(ENTRIES)}) L.addEntry(l, e);
const got = String(X.toCsv(l)).replace(/\\r\\n/g, "\\n").replace(/\\n$/, "");
if (got !== ${JSON.stringify(CSV)}) { console.error(JSON.stringify(got)); process.exit(1); }`, "toCsv writes the wrong CSV"),
        correction: "`toCsv` doesn't write the CSV I asked for: the header `date,amount,category,note`, amounts like 12.50, and a field quoted only when it holds a comma, a quote or a line break, with its quotes doubled.",
      },
      tests("toCsv"),
      changelog(),
      jsdoc("src/export.js", "toCsv"),
      vendor(),
    ],
  },
  {
    id: "t4",
    title: "Release 0.4.0",
    prompt: "Please cut the 0.4.0 release.",
    checks: release("0.4.0"),
  },
  {
    id: "t5",
    title: "CSV import",
    prompt: "Add a new module src/import.js with `fromCsv(text)`: it reads CSV in the format `toCsv` writes and returns a ledger with those entries (amounts back in cents). A quoted field can hold commas and doubled quotes. Throw an error for a malformed line — the wrong number of fields, or an amount that isn't a number. Use src/vendor/csv.js where it helps. Add tests.",
    checks: [
      {
        id: "from-csv",
        kind: "task",
        check: (ctx) => probe(ctx, `const I = await import("$repo/src/import.js");
const l = I.fromCsv(${JSON.stringify(CSV)});
const got = (l && l.entries || []).map((e) => ({ date: e.date, amount: e.amount, category: e.category, note: e.note ?? "" }));
if (JSON.stringify(got) !== ${JSON.stringify(JSON.stringify(ENTRIES))}) { console.error(JSON.stringify(got)); process.exit(1); }
for (const bad of ["date,amount,category,note\\n2026-01-05,12.50,food", "date,amount,category,note\\n2026-01-05,abc,food,x"]) { let t = null; try { I.fromCsv(bad); } catch (e) { t = e; } if (!(t instanceof Error)) { console.error("no error for " + JSON.stringify(bad)); process.exit(1); } }`, "fromCsv reads the CSV wrong"),
        correction: "`fromCsv` doesn't read the CSV right: it should give back the entries `toCsv` wrote — quoted fields with commas and doubled quotes included, amounts in cents — and throw on a line with the wrong number of fields or an amount that isn't a number.",
      },
      tests("fromCsv"),
      changelog(),
      jsdoc("src/import.js", "fromCsv"),
      errorPrefix("src/import.js", 'm.fromCsv("date,amount,category,note\\n2026-01-05,12.50,food")', "fromCsv", "line 2 has 3 fields, expected 4"),
      vendor(),
    ],
  },
  {
    id: "t6",
    title: "Release 0.5.0",
    prompt: "Cut the 0.5.0 release, please.",
    checks: release("0.5.0"),
  },
];
