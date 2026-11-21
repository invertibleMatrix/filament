// @ts-check
// Ratchets: numbers that may only go down, and surfaces that may not change by accident. They make the refactoring
// programme's exit criteria mechanical, and every one of them is about correctness: duplicated helpers (one token
// estimator, not nine that disagree), import direction and the layer contracts, the module maps under
// docs/architecture/, the admin route list, the dashboard's innerHTML sinks (XSS) and external URLs (privacy).
// Nothing here measures size or formatting (the owner, 2026-09-20): a file's length says nothing about its
// correctness, and formatting is the IDE's, in one pass, whenever the owner chooses.
// Budgets live in fixtures/ratchets.json. `UPDATE_RATCHETS=1 npm test` lowers a budget to the current value; it never
// raises one — a file that grew past its budget fails until it is shrunk or the growth is a conscious edit of the
// fixture with a reason in the commit.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "test", "fixtures", "ratchets.json");
const ROUTES_FIXTURE = join(ROOT, "test", "fixtures", "admin-routes.txt");
const UPDATE = process.env.UPDATE_RATCHETS === "1";

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const rel = (p) => relative(ROOT, p).split("\\").join("/");
// Vendored third-party dist files (ui/harness/vendor) are upstream's code, not ours: the typed-modules, innerHTML
// and module-map ratchets measure what this repository writes, so the vendor subtree is skipped whole.
const srcFiles = walk(join(ROOT, "src"))
  .filter((p) => /\.(js|mjs)$/.test(p) && !rel(p).startsWith("src/ui/harness/vendor/"))
  .map(rel)
  .sort();
const desktopFiles = walk(join(ROOT, "desktop"))
  .filter((p) => /\.(js|cjs|mjs)$/.test(p))
  .map(rel)
  .sort();
const read = (f) => readFileSync(join(ROOT, f), "utf8");

// What the tree measures right now.
function measure() {
  const innerHtml = {},
    externalUrls = {};
  for (const f of srcFiles)
    if (f.startsWith("src/ui/")) innerHtml[f] = (read(f).match(/innerHTML/g) || []).length;
  // Resource references only: the SVG xmlns in the favicon is a namespace, not a fetch.
  for (const f of ["src/ui/index.html", "src/ui/style.css"])
    externalUrls[f] = (
      read(f).match(/(?:href|src)="https?:\/\/|url\(\s*["']?https?:\/\/|@import\s+["']https?:\/\//g) || []
    ).length;
  const duplicates = {};
  for (const [name, re] of Object.entries(DUPLICATE_HELPERS))
    duplicates[name] = srcFiles.filter((f) => re.test(read(f))).length;
  // A module opts into the type checker on its first line; the files that have not yet are Phase 6's work list.
  const untyped = srcFiles.filter((f) => !/^\s*\/\/ @ts-check\b/.test(read(f).split(/\r?\n/, 1)[0]));
  return { duplicates, innerHtml, externalUrls, untyped };
}
// The same helper written in several files (the plan's §1.3). Each pattern matches a DEFINITION — an arrow or a
// function with that name — not a use, an alias (`const est = estimateTokens`) or a local variable that happens to
// share the name (`const cut = starts[k]`). The home of each helper (src/core) counts as one file.
const DUPLICATE_HELPERS = {
  tokenEstimate:
    /(?:const|let) (?:est|estTokens|estimateTokens) = \(|function (?:est|estTokens|estimateTokens|estimateInputTokens)\(/,
  textCut: /const (?:squash|cut|clip) = \(|function (?:truncate|clip|squash|cut)\(/,
  turnSegmentation: /(?:const|function) turnStarts\b|function segmentTurns\(|function turnGroups\(/,
  sha: /const sha(?:256)? = \(|function sha(?:256)?\(/,
  clamp: /const clamp = \(|function clamp\(/,
  charsOverFour: /\.length \/ 4\)/,
};
// Files not listed in the fixture get these: no new innerHTML sink, no new external URL.
const DEFAULTS = { innerHtml: 0, externalUrls: 0 };

const current = measure();
let budgets = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;
if (UPDATE || !budgets) {
  const next = { duplicates: {}, innerHtml: {}, externalUrls: {}, untyped: /** @type {string[]} */ ([]) };
  const lower = (section, key) => {
    const old = budgets?.[section]?.[key];
    const now = current[section][key];
    return old == null ? now : Math.min(old, now);
  };
  for (const k of Object.keys(current.duplicates)) next.duplicates[k] = lower("duplicates", k);
  for (const f of Object.keys(current.innerHtml))
    if (current.innerHtml[f] > 0 || budgets?.innerHtml?.[f] != null)
      next.innerHtml[f] = lower("innerHtml", f);
  for (const f of Object.keys(current.externalUrls))
    if (current.externalUrls[f] > 0 || budgets?.externalUrls?.[f] != null)
      next.externalUrls[f] = lower("externalUrls", f);
  // The list only shrinks: a file stays listed while it is untyped, leaves when it opts in, and never joins.
  next.untyped = current.untyped.filter((f) => !budgets || (budgets.untyped || []).includes(f));
  budgets = next;
  writeFileSync(FIXTURE, JSON.stringify(budgets, null, 2) + "\n");
}
const budgetOf = (section, key) => budgets[section]?.[key] ?? DEFAULTS[section];

describe("ratchets: the fixture", () => {
  test("it measures correctness only: no size or formatting section, and every budgeted file still exists", () => {
    assert.deepEqual(
      Object.keys(budgets).sort(),
      ["duplicates", "externalUrls", "innerHtml", "untyped"],
      "the file-size and long-line ratchets were retired (2026-09-20): length and formatting are not criteria",
    );
    for (const f of [...Object.keys(budgets.innerHtml), ...budgets.untyped])
      assert.ok(srcFiles.includes(f), `${f} is listed but gone — remove it from the fixture`);
  });
});

// Phase 6's exit as a ratchet: every module opts into the type checker (`// @ts-check` on line 1, so `tsc --noEmit`
// checks its JSDoc contracts). The fixture's `untyped` list is the work list — it only shrinks (UPDATE_RATCHETS=1
// drops the files that opted in) and a new source file is never allowed onto it: it is typed from its first line.
describe("ratchets: typed modules", () => {
  test("every source file not on the fixture's untyped list is // @ts-check", () => {
    const listed = new Set(budgets.untyped);
    assert.deepEqual(
      current.untyped.filter((f) => !listed.has(f)),
      [],
      "untyped source files that are not on the Phase 6 work list — a new file opts in on its first line",
    );
  });
});

describe("ratchets: duplicated helpers", () => {
  for (const name of Object.keys(DUPLICATE_HELPERS)) {
    test(`${name} is defined in at most ${budgetOf("duplicates", name)} file(s)`, () => {
      const files = srcFiles.filter((f) => DUPLICATE_HELPERS[name].test(read(f)));
      assert.ok(
        files.length <= budgetOf("duplicates", name),
        `${name} is defined in ${files.length} files (budget ${budgetOf("duplicates", name)}): ${files.join(", ")}`,
      );
    });
  }
});

// Import direction. Layer folders import inward only; `ui` imports `ui` (the dashboard talks to the
// server over HTTP, never by importing `http` / `app`). The composition root is imported by bin/ and tests only.
const LAYER_RULES = {
  core: ["core"],
  services: ["core", "services"],
  adapters: ["core", "adapters"],
  app: ["core", "services", "adapters", "app"],
  http: ["core", "services", "adapters", "app", "http"],
  cli: ["core", "services", "adapters", "app", "cli"],
  ui: ["ui"],
};
const IMPURE_BUILTINS =
  /^node:(fs|fs\/promises|http|https|net|child_process|worker_threads|dgram|cluster|readline|sqlite)$/;
const importsOf = (text) =>
  [
    ...text.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']/gm),
    ...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
const layerOf = (f) => (f.match(/^src\/(core|services|adapters|app|http|cli|ui)\//) || [])[1] || null;
describe("ratchets: import direction", () => {
  test("nothing under src/ imports server.js (the composition root is imported by bin/ and tests only)", () => {
    const offenders = srcFiles.filter(
      (f) => f !== "src/server.js" && importsOf(read(f)).some((s) => /(^|\/)server\.js$/.test(s)),
    );
    assert.deepEqual(offenders, []);
  });
  test("layer folders import inward only, and core imports no impure builtin", () => {
    const offenders = [];
    for (const f of srcFiles) {
      const layer = layerOf(f);
      if (!layer) continue;
      for (const s of importsOf(read(f))) {
        if (s.startsWith("node:")) {
          if (layer === "core" && IMPURE_BUILTINS.test(s)) offenders.push(`${f} → ${s}`);
          continue;
        }
        if (!s.startsWith(".")) continue;
        const target = rel(resolve(join(ROOT, dirname(f)), s));
        const targetLayer = layerOf(target);
        if (targetLayer && !LAYER_RULES[layer].includes(targetLayer))
          offenders.push(`${f} (${layer}) → ${target} (${targetLayer})`);
        if (!targetLayer && target !== "src/server.js" && /^src\/[^/]+\.js$/.test(target) === false)
          offenders.push(`${f} → ${target} (outside the layers)`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});

// The application holds a Destination (core/ports.js) for every upstream and never asks what kind it is; and core
// stays free of I/O, which the import rule alone cannot see when the call is a global (`fetch`).
describe("ratchets: layer contracts", () => {
  test("app/** does not branch on an upstream's kind", () => {
    const offenders = [];
    for (const f of srcFiles.filter((f) => f.startsWith("src/app/")))
      for (const [i, l] of read(f).split(/\r?\n/).entries())
        if (
          /\bisAgent\(|\bbridgeFor\(|\.type\s*[!=]==?\s*["'](acp|codex|qoder|cursor-sdk)["']|["'](acp|codex|qoder|cursor-sdk)["']\s*[!=]==?\s*\w+\.type\b|["'](acp|codex|qoder|cursor-sdk)["']\]\.includes\(/.test(
            l,
          )
        )
          offenders.push(`${f}:${i + 1}`);
    assert.deepEqual(offenders, []);
  });
  test("core/** performs no fetch", () => {
    const offenders = srcFiles.filter((f) => f.startsWith("src/core/") && /\bfetch\(/.test(read(f)));
    assert.deepEqual(offenders, []);
  });
  // The Phase 4 exit, as a property rather than a line count: the composition root constructs and wires, and
  // answers no request itself — every response is written by http/** or app/**.
  test("server.js (the composition root) writes no response", () => {
    const offenders = [];
    for (const [i, l] of read("src/server.js").split(/\r?\n/).entries())
      if (/\bsendJson\(|\bwriteHead\(|\berrorBody\(|\bres\.end\(|\bres\.write\(/.test(l))
        offenders.push(`src/server.js:${i + 1}`);
    assert.deepEqual(offenders, []);
  });
  // The memory port (HarnessV3-Memory MD-21, M2-4): a consumer reaches memory through a handle (`memory.scope`), whose
  // role is the `by` of every write. Nothing outside the memory service touches the brain, the archive's claims, the
  // record of what was shown, or the engine.
  test("nothing outside services/memory/ reaches past the memory port", () => {
    const offenders = [];
    for (const f of srcFiles.filter((f) => !f.startsWith("src/services/memory/")))
      for (const [i, l] of read(f).split(/\r?\n/).entries())
        if (
          /(?<!ICONS)\.brain\b|\barchive\??\.(?:items|injections)\b|\bmemory\??\.store\b|\.store\??\.(?:status|recall|remember|invalidate|rows|stats|canonical|ensure|call|hello)\b/.test(
            l,
          )
        )
          offenders.push(`${f}:${i + 1}`);
    assert.deepEqual(offenders, []);
  });
  // How models did is a record the owner reads, never a ranking Filament acts on (HarnessV3-Memory M7-D54): memory's
  // service alone keeps and reads outcomes — a writer hands it one (`recordOutcome`) — and the outcomes route and the
  // two pages it answers alone show them. Nothing in the pipeline, the routing or the agent loop reads one. The press
  // table names the route among its rows, as it names every row of the admin API (http/admin/press.js): it asks the
  // route nothing, so the route's name alone is its to write, and every other reading is refused it as anywhere.
  test("nothing outside memory and the outcomes route reads how models did (M7-D54)", () => {
    const shows = new Set(["src/http/admin/memory.js", "src/ui/lib/outcomes.js", "src/ui/harness/library/memory.js", "src/ui/pages/memory-outcomes.js"]);
    const names = new Set(["src/http/admin/press.js"]);
    const offenders = [];
    for (const f of srcFiles.filter((f) => !f.startsWith("src/services/memory/") && !shows.has(f)))
      for (const [i, l] of read(f).split(/\r?\n/).entries())
        if (/\boutcomes\??\.(?:list|add|prune|correctTurn)\b|\boutcomeTable\b|\.outcomes\(|\boutcomesPath\b|\b(?:FROM|INTO|UPDATE)\s+outcomes\b/.test(l) || (!names.has(f) && /\/memory\/outcomes\b(?!\.js)/.test(l)))
          offenders.push(`${f}:${i + 1}`);
    assert.deepEqual(offenders, []);
  });
  // Filament's own calls through its model doors authenticate with the house key (services/house.js): one that did
  // not would be judged a client's — its lineage and its user agent set aside, its spend filed as a client's. A call to
  // Filament's own address is written either way: 127.0.0.1 and a port, or where Filament reaches itself (`selfBase()`,
  // services/config/store.js `selfAddress`).
  test("every loopback call to a model door presents the house key", () => {
    const offenders = [];
    for (const f of srcFiles) {
      const text = read(f);
      const calls = (text.match(/loopbackPost\(\s*`(?:http:\/\/127\.0\.0\.1:\$\{[^}]+\}|\$\{(?:[\w.]+\.)?(?:selfBase|base)\(\)\})(?!\/api\/)/g) || []).length;
      const keyed = (text.match(/\.\.\.houseAuth\(\)/g) || []).length;
      if (calls > keyed) offenders.push(`${f}: ${calls} loopback model call(s), ${keyed} with the house key`);
    }
    assert.deepEqual(offenders, []);
  });
  // Filament's calls to its own front door go over loopback (services/loopback.js), never through Node's fetch, whose
  // own 300 s waits end a call before its caller's deadline does (the G2 drive's run 4).
  test("no call of Filament's to its own front door goes through Node's fetch", () => {
    const offenders = [];
    for (const f of srcFiles)
      for (const m of read(f).matchAll(/\bfetch(?:Impl)?\(\s*`(?:http:\/\/127\.0\.0\.1:|\$\{(?:[\w.]+\.)?(?:selfBase|base)\(\)\})/g))
        offenders.push(`${f}:${read(f).slice(0, m.index).split("\n").length}`);
    assert.deepEqual(offenders, []);
  });
});

// The module maps: docs/ARCHITECTURE.md links one per area, under docs/architecture/, and each gives a file a table row —
// `| \`<path>\` | what it is |`, the path relative to src/, the desktop app's by its whole path. A row says what the file
// is and does in 500 characters at most; what changed and why is git's.
describe("ratchets: the module map", () => {
  const MAPS = (existsSync(join(ROOT, "docs", "architecture")) ? readdirSync(join(ROOT, "docs", "architecture")) : [])
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => `docs/architecture/${f}`);
  const rows = MAPS.flatMap((map) =>
    read(map)
      .split("\n")
      .flatMap((line, i) => {
        const m = /^\|\s*((?:`[^`]+`[,\s]*)+)\|(.*)\|\s*$/.exec(line);
        return m ? [{ at: `${map}:${i + 1}`, paths: [...m[1].matchAll(/`([^`]+)`/g)].map((p) => p[1]), text: m[2].trim() }] : [];
      }),
  );
  const named = rows.flatMap((r) => r.paths);
  test("the module maps give every source file a row", () => {
    const missing = srcFiles.filter((f) => !named.includes(f.replace(/^src\//, "")));
    assert.deepEqual(missing, [], "source files no module map has a row for");
  });
  // The desktop app's too (HarnessV3-Native NA5): its main script, the card's bridge and lib/, by their whole path.
  test("the module maps give every file of the desktop app a row", () => {
    assert.ok(desktopFiles.includes("desktop/main.js"), "the desktop app's files are read");
    const missing = desktopFiles.filter((f) => !named.includes(f));
    assert.deepEqual(missing, [], "desktop files no module map has a row for");
  });
  test("a map row names files that are there, each once, and says what they are in 500 characters at most", () => {
    const gone = rows.flatMap((r) => r.paths.filter((p) => !existsSync(join(ROOT, p.startsWith("desktop/") ? p : `src/${p}`))).map((p) => `${r.at} ${p}`));
    assert.deepEqual(gone, [], "rows for files that are not there");
    assert.deepEqual([...new Set(named.filter((p, i) => named.indexOf(p) !== i))], [], "files with more than one row");
    const long = rows.filter((r) => r.text.length > 500).map((r) => `${r.at} ${r.text.length} characters`);
    assert.deepEqual(long, [], "rows past 500 characters");
  });
  test("docs/ARCHITECTURE.md links every module map", () => {
    const index = read("docs/ARCHITECTURE.md");
    assert.ok(MAPS.length >= 10, "the maps are read");
    assert.deepEqual(MAPS.filter((m) => !index.includes(`](${m.replace(/^docs\//, "")})`)), [], "module maps the index does not link");
  });
  // A data-folder pattern in .gitignore (`memory/`) once swallowed src/services/memory/: the suite ran against the
  // working tree and passed while the commit had no such folder. git answers 0 when at least one path is ignored.
  test("no source file is ignored by git", () => {
    let ignored = "";
    try {
      ignored = execFileSync("git", ["check-ignore", ...srcFiles, ...desktopFiles], { cwd: ROOT, stdio: "pipe" }).toString();
    } catch (/** @type {any} */ e) {
      if (e.status !== 1) return; // not a git checkout, or no git: nothing to check
    }
    assert.equal(ignored.trim(), "", "source files a .gitignore pattern hides from every commit");
  });
  // Python writes its cache beside the memory sidecar each time it runs: a tracked one shows as changed in every chat's
  // Changes, and nothing reads it (the installer packs sidecar/*.py).
  test("git tracks no Python cache", () => {
    let tracked = "";
    try {
      tracked = execFileSync("git", ["ls-files", "--", "*__pycache__*", "*.pyc"], { cwd: ROOT, stdio: "pipe" }).toString();
    } catch {
      return; // not a git checkout, or no git: nothing to check
    }
    assert.equal(tracked.trim(), "", "Python caches git tracks");
  });
});

// The admin API surface, read from the route table itself: the areas under http/admin/ build their rows from an
// admin context they only close over, so an empty one yields the exact `[method, pattern]` list the router is given
// (Phase 4.2; a regex over the source text missed a row once its leading comment moved). A `:param` segment prints
// as `*` — the same spelling the ladder's `startsWith` routes had — so a parameterised route is as visible as the
// branch it replaced. The area list is every `./<area>.js` that index.js imports, so a new area cannot slip past the
// pin by not being on a list here (the sixth area did exactly that once). Pinned in fixtures/admin-routes.txt.
async function adminRows() {
  const index = readFileSync(join(ROOT, "src", "http", "admin", "index.js"), "utf8");
  const names = [...index.matchAll(/from "\.\/([a-z-]+)\.js"/g)].map((m) => m[1]);
  assert.ok(names.length >= 5, "the admin index imports its areas as ./<area>.js");
  const areas = await Promise.all(names.map((a) => import(`../src/http/admin/${a}.js`)));
  /** @type {[string, string][]} */
  const out = [];
  for (const area of areas)
    for (const rows of Object.values(area).filter((v) => typeof v === "function" && /Routes$/.test(v.name)))
      for (const [method, pattern] of rows({})) out.push([method, pattern]);
  return out;
}
/** A row as the fixture spells it. @param {string} method @param {string} pattern */
const starred = (method, pattern) => `${method} /api${pattern.replace(/:[^/*]+\*?/g, "*")}`;
async function adminRoutes() {
  return [...new Set((await adminRows()).map(([method, pattern]) => starred(method, pattern)))].sort();
}
describe("ratchets: the admin API surface", () => {
  test("the route list matches fixtures/admin-routes.txt (UPDATE_RATCHETS=1 to accept a deliberate change)", async () => {
    const now = (await adminRoutes()).join("\n") + "\n";
    if (UPDATE || !existsSync(ROUTES_FIXTURE)) {
      writeFileSync(ROUTES_FIXTURE, now);
      return;
    }
    assert.equal(now, readFileSync(ROUTES_FIXTURE, "utf8"), "the admin route list changed");
  });
  // The press (http/admin/press.js): every row is classed, once, by someone who read what it does — a press always, a
  // press by its body, a press its own handler weighs, the door's, or no press with why. The press was a list of rows
  // beside 450 that were let through because no one had listed them (the re-read of 11-11): a new row with no class
  // fails here, and is a press until it has one.
  // (fails before: yes — 458 of the 497 rows had no class: every one outside the lists was let through unread)
  test("every admin route has its press class, once, and a row with none is a press", async () => {
    const { PRESS, PRESS_TABLE, NO_PRESS, pressClass } = await import("../src/http/admin/press.js");
    const rows = (await adminRows()).map(([method, pattern]) => `${method} ${pattern}`);
    assert.deepEqual(rows.filter((r) => !PRESS.has(r)), [], "rows with no press class (src/http/admin/press.js)");
    assert.deepEqual([...PRESS.keys()].filter((r) => !rows.includes(r)), [], "classes of rows the admin API does not have");
    const named = PRESS_TABLE.map(([r]) => r);
    assert.deepEqual(named.filter((r, i) => named.indexOf(r) !== i), [], "rows classed twice");
    // The fixture's rows too, as it spells them: each is one the table classes.
    const classed = new Set([...PRESS.keys()].map((r) => starred(r.slice(0, r.indexOf(" ")), r.slice(r.indexOf(" ") + 1))));
    assert.deepEqual(readFileSync(ROUTES_FIXTURE, "utf8").split(/\r?\n/).filter((r) => r && !classed.has(r)), [], "rows of fixtures/admin-routes.txt with no press class");
    /** @type {string[]} */
    const whys = Object.values(NO_PRESS);
    for (const [r, c] of PRESS_TABLE) {
      assert.ok(["always", "body", "kept", "door", "no"].includes(c.press), `${r}: its class`);
      if (c.press === "no") assert.ok(whys.includes(c.why), `${r}: no press, with one of the table's reasons (${c.why})`);
      if (c.press === "body") assert.equal(typeof c.when, "function", `${r}: a press by its body says when`);
      // A row its own handler weighs names the file that does, which reads the caller's refusal (guards.js `pressRefused`).
      if (c.press === "kept") assert.match(read(`src/http/admin/${c.by.split(/[ ,]/)[0]}`), /pressRefused\(/, `${r}: ${c.by} weighs the press`);
    }
    assert.deepEqual(pressClass("POST /a-row-nobody-classed"), { press: "always" }, "a row with no class is a press");
    assert.deepEqual(pressClass("GET /a-row-nobody-classed"), { press: "always" }, "a read too");
  });
});

describe("ratchets: the dashboard", () => {
  test("every dashboard script parses", () => {
    for (const f of srcFiles.filter((f) => f.startsWith("src/ui/")))
      execFileSync(process.execPath, ["--check", join(ROOT, f)], { stdio: "pipe" });
  });
  test("index.html references files that exist", () => {
    const html = read("src/ui/index.html");
    for (const m of html.matchAll(/(?:src|href)="\/ui\/([^"]+)"/g))
      assert.ok(existsSync(join(ROOT, "src", "ui", m[1])), `index.html references missing /ui/${m[1]}`);
  });
  test("innerHTML sinks stay within budget (unlisted files: 0)", () => {
    const over = Object.keys(current.innerHtml)
      .filter((f) => current.innerHtml[f] > budgetOf("innerHtml", f))
      .map((f) => `${f}: ${current.innerHtml[f]} > ${budgetOf("innerHtml", f)}`);
    assert.deepEqual(over, []);
  });
  test("innerHTML appears only in ui/lib/dom.js", () => {
    const offenders = srcFiles.filter(
      (f) => f.startsWith("src/ui/") && f !== "src/ui/lib/dom.js" && /innerHTML/.test(read(f)),
    );
    assert.deepEqual(
      offenders,
      [],
      "trusted-markup assignment is the one sink; everything else uses h() or textContent",
    );
  });
  // h() drops a null child; the DOM's own append/replaceChildren print it as the text "null" (the command center
  // ended every list with "nullnull", the live tool glimpse and the run pane printed theirs too). A call that can
  // be handed a null says so at its top level — `...[a, b ? c : null].filter((x) => x != null)` passes.
  test("no DOM insertion is handed a literal null at its top level", () => {
    const offenders = [];
    for (const f of srcFiles.filter((f) => f.startsWith("src/ui/"))) {
      const src = read(f);
      for (const m of src.matchAll(/\.(?:append|prepend|replaceChildren|before|after|replaceWith)\(/g)) {
        let i = m.index + m[0].length, depth = 1, top = "", quote = null;
        for (; i < src.length && depth && i - m.index < 8000; i++) {
          const c = src[i];
          if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
          if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
          if ("([{".includes(c)) depth++;
          else if (")]}".includes(c)) depth--;
          else if (depth === 1) top += c;
        }
        if (!depth && /[?:]\s*null\b|\bnull\s*:/.test(top)) offenders.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
  // The harness's toasts know two kinds: plain, and "err" (red edge, shown twice as long). Any other word is shown as
  // plain, so a failure toasted as "error" read as a passing note (fails before: yes — settings/providers.js,
  // lib/model-rows.js and lib/mcp-list.js toasted their refusals as "error").
  test("every harness toast names a kind the harness styles", () => {
    const offenders = [];
    for (const f of srcFiles.filter((f) => f.startsWith("src/ui/harness/"))) {
      const src = read(f);
      for (const m of src.matchAll(/\b(?:toast|onToast)(?:\?\.)?\(/gi)) {
        if (/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
        const args = [""];
        let i = m.index + m[0].length, depth = 1, quote = null;
        // A template's `${…}` is code, which may hold strings of its own (`${a ? `Couldn't …` : "…"}`): each records the
        // depth it opened at, and its `}` goes back into the template. Read as one string, its inner backtick ended it,
        // and the quotes paired wrong from there on — up to words far past the call.
        /** @type {number[]} */
        const holes = [];
        for (; i < src.length && depth && i - m.index < 8000; i++) {
          const c = src[i];
          if (quote) {
            args[args.length - 1] += c;
            if (c === "\\") args[args.length - 1] += src[++i];
            else if (quote === "`" && c === "$" && src[i + 1] === "{") {
              args[args.length - 1] += src[++i];
              holes.push(depth++);
              quote = null;
            } else if (c === quote) quote = null;
            continue;
          }
          if (c === "}" && holes.at(-1) === depth - 1) {
            args[args.length - 1] += c;
            depth = /** @type {number} */ (holes.pop());
            quote = "`";
            continue;
          }
          if (c === '"' || c === "'" || c === "`") quote = c;
          if ("([{".includes(c)) depth++;
          else if (")]}".includes(c)) depth--;
          if (depth === 1 && c === ",") args.push("");
          else if (depth) args[args.length - 1] += c;
        }
        // the words a kind is chosen by (`v === "Stuck" ? "err" : ""`) are not kinds
        const chosen = (args[1] || "").replace(/[!=]==?\s*"[^"]*"|"[^"]*"\s*[!=]==?/g, "");
        const kinds = [...chosen.matchAll(/"([^"]*)"/g)].map((k) => k[1]);
        for (const k of kinds) if (k !== "" && k !== "err") offenders.push(`${f}:${src.slice(0, m.index).split("\n").length} "${k}"`);
      }
    }
    assert.deepEqual(offenders, []);
  });
  test("external URLs in the dashboard shell stay within budget (the fonts; 0 once self-hosted)", () => {
    const over = Object.keys(current.externalUrls)
      .filter((f) => current.externalUrls[f] > budgetOf("externalUrls", f))
      .map((f) => `${f}: ${current.externalUrls[f]} > ${budgetOf("externalUrls", f)}`);
    assert.deepEqual(over, []);
  });
});
