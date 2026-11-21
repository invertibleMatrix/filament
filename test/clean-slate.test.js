// @ts-check
// HarnessV3-AtHome P1b — the clean slate. AH-C1: nothing is carried from earlier builds; stored data is read the way a
// write is checked, never through a list of old names. AH-C2: what only an earlier build wrote has no reader left, and
// the ratchet below keeps the readers' names and the words that narrated them out of src. AH-C3: config.json holds
// what differs from the defaults, so a default an update changes reaches every install whose person never set it.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConfig, loadConfig, saveConfig, validateConfig } from "../src/services/config/store.js";
import { defaultConfig } from "../src/config.js";
import { openConfig, loadKey } from "../src/services/config/secrets.js";
import { createRouter } from "../src/http/router.js";
import { upstreamRoutes } from "../src/http/admin/upstreams.js";
import { CONFIG_SCHEMA, PRICING_DEFAULTS } from "../src/core/schema.js";
import { priceSourceOf } from "../src/core/pricing.js";
import { HOME_PANES, TRAFFIC_VIEWS, MEM_TABS, DEST_TABS, LAB_TABS, SETTINGS_TABS, PAGES } from "../src/ui/nav.js";

const dir = mkdtempSync(join(tmpdir(), "filament-clean-slate-"));
after(() => {
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {}
  }
});

/** The file as written, its secrets opened with the folder's key. @param {string} data */
const onDisk = (data) => openConfig(JSON.parse(readFileSync(join(data, "config.json"), "utf8")), loadKey(data, { create: false })).config;

describe("AH-C1: a config keeps what its schema knows, and nothing else", () => {
  // (fails before: yes — the stored object was the starting point, so every key the schema does not know rode along,
  // and a handful were deleted by name)
  test("a key the schema does not know drops on load, at every level", () => {
    const cfg = /** @type {any} */ (normalizeConfig({
      pricing: { table: { "my-model": { input: 1, output: 2 } } },
      someday: { maybe: true },
      agentLoop: { maxRounds: 3, turnDeadlineMinutes: 30, permissions: "auto" },
      rules: { autofit: { enabled: true }, trim: { intercept: true, nonsense: 1 } },
      memory: { transport: "http", url: "http://127.0.0.1:1", token: "t", enabled: false },
      server: { port: 20311, flavour: "x" },
      upstreams: [
        { id: "a", type: "anthropic", apiKey: "k", nonsense: true, acp: { countTokensModel: "x" }, rules: { autofit: { enabled: true }, effort: { default: "high" } } },
        { id: "z", type: "acp", acp: { command: "agent", countTokensModel: "m" } },
      ],
      routes: [{ match: "x/*", upstream: "a", nonsense: 1, rules: { trim: { nonsense: 2 } } }],
    }));
    for (const k of ["pricing", "someday"]) assert.equal(Object.hasOwn(cfg, k), false, k);
    for (const k of ["maxRounds", "turnDeadlineMinutes"]) assert.equal(Object.hasOwn(cfg.agentLoop, k), false, `agentLoop.${k}`);
    assert.equal(cfg.agentLoop.permissions, "auto", "what the schema knows is kept");
    assert.deepEqual(cfg.rules.autofit, { margin: 0.85 }, "a known group keeps only its known fields");
    assert.equal(Object.hasOwn(cfg.rules.trim, "nonsense"), false, "rules.trim.nonsense");
    // (fails before: yes — the owner's rules of 10-31: rules.trim.intercept went with /trim, and an old config's falls
    // away, unconverted; the group keeps the slice pass's settings)
    assert.equal(Object.hasOwn(cfg.rules.trim, "intercept"), false, "rules.trim.intercept");
    for (const k of ["transport", "url", "token"]) assert.equal(Object.hasOwn(cfg.memory, k), false, `memory.${k}`);
    assert.equal(cfg.memory.enabled, false);
    assert.equal(Object.hasOwn(cfg.server, "flavour"), false);
    assert.equal(cfg.server.port, 20311);
    const [a, z] = cfg.upstreams;
    assert.equal(Object.hasOwn(a, "nonsense"), false, "an upstream's unknown key");
    assert.deepEqual(a.rules, { effort: { default: "high" } }, "an upstream's rules override: a group left empty goes too");
    assert.equal(Object.hasOwn(z.acp, "countTokensModel"), false, "an agent's unknown key");
    assert.equal(z.acp.command, "agent");
    assert.equal(Object.hasOwn(cfg.routes[0], "nonsense"), false, "a route's unknown key");
    assert.deepEqual(cfg.routes[0].rules, {}, "a route's rules override");
  });

  // (fails before: yes — the two local routers' type was read as anthropic-compatible)
  test("an upstream type the build does not know is refused by name, like any unknown type", () => {
    const cfg = normalizeConfig({ upstreams: [{ id: "r", type: "9router", baseUrl: "http://127.0.0.1:20128" }], routes: [] });
    assert.equal(/** @type {any} */ (cfg).upstreams[0].type, "9router");
    assert.deepEqual(validateConfig(cfg).errors, ['upstreams[0].type "9router" is unknown']);
  });
});

describe("AH-C3: config.json holds what differs from the defaults", () => {
  // (fails before: yes — the first start wrote every default, and every later save wrote them again)
  test("the first start writes the version, its key, the upstreams and the routes, and nothing else", () => {
    const data = join(dir, "first");
    const first = loadConfig(data, { agents: [{ upstream: { id: "qoder", type: "acp", enabled: false, acp: { command: "qodercli" } }, route: { match: "qoder/*", upstream: "qoder", upstreamModel: "{1}" } }] });
    assert.equal(first.created, true);
    const file = onDisk(data);
    assert.deepEqual(Object.keys(file).sort(), ["routes", "server", "upstreams", "version"]);
    assert.deepEqual(Object.keys(file.server), ["inboundKeys"]);
    assert.equal(file.server.inboundKeys[0], /** @type {any} */ (first.config).server.inboundKeys[0], "the key minted at the first start");
    assert.deepEqual(file.upstreams, [{ id: "qoder", type: "acp", enabled: false, acp: { command: "qodercli" } }], "an upstream holds what names it and what differs");
    assert.deepEqual(file.routes, [{ match: "qoder/*", upstream: "qoder", upstreamModel: "{1}" }]);
    // Read back, it is the whole config again.
    assert.deepEqual(loadConfig(data).config, first.config);
  });

  // (fails before: yes — every value was written, so a default a later build changed never reached this install)
  test("a value someone set is written, and a value at its default is not", () => {
    const data = join(dir, "set");
    const cfg = /** @type {any} */ (defaultConfig());
    cfg.memory.enabled = false;
    cfg.rules.autofit.margin = 0.7;
    cfg.server.port = 20444;
    cfg.upstreams.push({ ...cfg.upstreams[0], id: "glm", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-test" });
    saveConfig(data, normalizeConfig(cfg));
    const file = onDisk(data);
    assert.deepEqual(file.memory, { enabled: false });
    assert.deepEqual(file.rules, { autofit: { margin: 0.7 } });
    assert.equal(file.server.port, 20444);
    assert.equal(Object.hasOwn(file, "agentLoop"), false, "a section left at its defaults is not written");
    assert.deepEqual(file.upstreams.at(-1), { id: "glm", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-test" });
    const back = /** @type {any} */ (loadConfig(data).config);
    assert.equal(back.memory.enabled, false, "a person who turns memory off keeps it off");
    assert.equal(back.rules.autofit.margin, 0.7);
    assert.equal(back.server.port, 20444);
  });

  // (fails before: no — sealing walked the whole config before; this pins that it walks the one written now)
  test("the secrets written are sealed", () => {
    const data = join(dir, "sealed");
    const cfg = /** @type {any} */ (defaultConfig());
    cfg.upstreams.push({ id: "glm", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-secret-value" });
    saveConfig(data, normalizeConfig(cfg));
    const text = readFileSync(join(data, "config.json"), "utf8");
    assert.doesNotMatch(text, /sk-secret-value/);
    assert.doesNotMatch(text, new RegExp(cfg.server.inboundKeys[0]));
    assert.equal(/** @type {any} */ (loadConfig(data).config).upstreams.at(-1).apiKey, "sk-secret-value");
  });

  // (fails before: yes — a config written whole, by hand or by any writer, was written whole again, so a default it
  // held never moved when the build's did)
  test("a config written whole is written back as what differs, so the build's defaults reach it", () => {
    const data = join(dir, "rules");
    mkdirSync(data, { recursive: true });
    const cfg = /** @type {any} */ (defaultConfig());
    writeFileSync(join(data, "config.json"), JSON.stringify({ ...cfg, server: { ...cfg.server, encryptSecrets: false } }, null, 2));
    const loaded = loadConfig(data);
    saveConfig(data, loaded.config);
    const file = JSON.parse(readFileSync(join(data, "config.json"), "utf8"));
    assert.equal(Object.hasOwn(file, "rules"), false, "every rule at its default");
    assert.deepEqual(file.server, { inboundKeys: cfg.server.inboundKeys, encryptSecrets: false });
  });
});

describe("AH-C2: nothing in src reads what only an earlier build wrote", () => {
  // The readers, moves, aliases and notices AH-C2 took out, by name, and the words that told what code replaced instead
  // of what it does (AH-C1). A hit is one of them back. Not on either list, because each serves what lies outside
  // Filament or is the product's own word: a client's older request shape (`legacyToAdaptive`, `budget_tokens`), an agent
  // or a model that predates a capability, Windows PowerShell 5.1, the 9router import, the archive's refusal of a file
  // another build wrote, and memory's claim lifecycle, where "retired" is what a claim becomes.
  const IDENTIFIERS = [
    // settings: the retired knobs and groups, the preset aliases, the upstream types and config fields of earlier builds
    "RETIRED_GROUPS", "RETIRED_GROUP_OF", "RETIRED_KNOB_PATHS", "RETIRED_RULE_DEFAULTS", "retireRuleDefaults", "retiredKnobOf",
    "retiredKnobsOf", "normalizeRetiredKnobs", "retireKnobs", "PRESET_ALIASES", "presetNameOf", "LEGACY_UPSTREAM_TYPES",
    "migrateMemoryConfig", "budgetLeftOut",
    // the archive: its migrations, and the readers and moves for what was stored before a stamp existed
    "copyBeforeMigrating", "legacyJunction", "migrateMetaPolicies", "policyPatchesOfMeta", "movePin", "movePins", "pinMoveOf",
    "moveProjectModes", "chainsWithOldPin", "chainsWithMetaKeys", "chainsMentioningKeys", "backfillKinds", "backfillPreviews",
    "TRIGGER_READING", "armFromWords", "methodOfRow", "pinModeOf",
    // records and usage: the turn-facts backfill, the daily usage's rebuild from the log
    "backfillTurnFacts", "backfillFrom",
    // the console and the barrels: the sidebar's record lookup, an alias kept for an earlier signature
    "chainOfRun", "runRetry", "estimateInputTokens", "estModeLegacy",
    // the browser's memory: the remembered "chat" mode's toast
    "takeChatOnlyNotice", "chatOnlyNotice", "chatOnlyDropped", "CHAT_ONLY_SEEN_KEY", "chatOnlyToastSeen",
  ];
  const WORDS = [
    /\bas before\b/i,
    /\b(?:older|earlier|previous) builds?\b/i,
    /\b(?:retired|left|went|removed|gone) with (?:Providers|P\d|Step)/,
    /\b(?:budgets?|ceilings?|knobs?|settings?|aliases|alias|groups?) (?:was|were) retired\b/i,
    /\bbudget-retired\b/,
    /\bpre-Step\b/,
    /\bolder records?\b/i,
    /\bolder (?:run )?logs?\b/i,
    /\ban older (?:server|client|release)\b/i,
    /\bremote mode\b/i,
    /\bcontext\.pin\b/,
    /\bmemory\.mode\b/,
    /\bdormant\b/i,
    /\bspend per turn\b/i,
    /\bonce lived\b/i,
    /\blifted out of\b/i,
    /\bmoved here from\b/i,
    /\byesterday's behaviou?r\b/i,
    /\bthe old world\b/i,
    /\bleft the request path\b/i,
    /\bif-ladder\b/i,
    /\b(?:the|sub-)?ladder(?:'s)? (?:had|wrote|decoded|produced|matched|answered|is gone)\b/i,
    /\bBodies are the (?:sub-)?ladder's\b/,
    /\bas it always (?:did|was|went)\b/i,
    /\bmanual successor\b/i,
    /\bolder spelling\b/i,
    /\ban old server\b/i,
    /\brecords join is gone\b/i,
    // the global price table and the engine widget, by the words that still named them after they went
    /\b(?:your|Filament's|the) pric(?:ing|e) table\b/i,
    /Settings → (?:Default )?pric/i,
    /\bdefault prices\b/i,
    /\bglobal (?:price |pricing )?table\b/i,
    /\bdefault table\b/i,
    /\bpricing\.table\b/,
    /\bdashboard's pricing\b/i,
    /\bengine widget\b/i,
    // what a missing archive said in place of its own words (a refused one names `npm run reset`)
    /memory's folder did not open/,
    /has not started,? or its folder did not open/,
    // a decision named as a time, for what an earlier build's file left out
    /\bbefore (?:AH|LD|RD|NT|SP|TL|MD|NA)-D\d+\b/,
    /\bbefore Filament said\b/,
    // the archive opens with memory on or off: it is open, refused or not started, never off
    /\bthe archive is off\b/,
  ];
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  /** @param {string} at @returns {string[]} */
  const walk = (at) => readdirSync(at, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(at, e.name)) : [join(at, e.name)]));
  const files = walk(join(ROOT, "src"))
    .map((f) => relative(ROOT, f).split("\\").join("/"))
    .filter((f) => /\.(?:js|mjs|css|html)$/.test(f) && !f.startsWith("src/ui/harness/vendor/"));

  // (fails before: yes — src held the retired-knob tables, the preset aliases, the archive's migrations and moves, the
  // backfills, the sidebar's record lookup and the ACP alias, and comments that told what each replaced)
  test("no source file names a removed reader, and no comment narrates one", () => {
    const named = IDENTIFIERS.map((id) => ({ id, re: new RegExp(`(?<![\\w$])${id}(?![\\w$])`) }));
    /** @type {string[]} */
    const hits = [];
    for (const f of files)
      readFileSync(join(ROOT, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const { id, re } of named) if (re.test(line)) hits.push(`${f}:${i + 1} ${id}`);
          for (const re of WORDS) if (re.test(line)) hits.push(`${f}:${i + 1} ${re}`);
        });
    assert.deepEqual(hits, []);
  });

  // (fails before: yes — `projects.canon_json` held an earlier release's canon, kept and never shown: nothing read or
  // wrote it)
  test("every column the archive creates is one this build reads or writes", () => {
    const archive = readFileSync(join(ROOT, "src/services/memory/archive.js"), "utf8");
    /** @type {{ table: string, body: string }[]} */
    const tables = [];
    for (const m of archive.matchAll(/CREATE (?:VIRTUAL )?TABLE IF NOT EXISTS (\w+)(?: USING \w+)?\s*\(/g)) {
      let depth = 1;
      let i = (m.index ?? 0) + m[0].length;
      const from = i;
      for (; i < archive.length && depth > 0; i++) depth += archive[i] === "(" ? 1 : archive[i] === ")" ? -1 : 0;
      tables.push({ table: m[1], body: archive.slice(from, i - 1) });
    }
    assert.ok(tables.length > 20, "the archive's tables are read");
    let code = files.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
    for (const t of tables) code = code.split(t.body).join("");
    /** @type {string[]} */
    const unnamed = [];
    for (const t of tables)
      for (const part of t.body.split(/,(?![^()]*\))/)) {
        const col = part.trim().split(/\s+/)[0];
        if (!col || /^(?:PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)$/i.test(col)) continue;
        if (!new RegExp(`(?<![\\w$])${col}(?![\\w$])`).test(code)) unnamed.push(`${t.table}.${col}`);
      }
    assert.deepEqual(unnamed, []);
  });

  // (fails before: yes — `GET /upstreams/test` tested the upstream called "test", a match only the if-chain the route
  // table replaced ever made; the console and the guide use `GET /upstreams/<id>/test` and `POST /upstreams/test`)
  test("the admin API's upstream test answers the paths the console and the guide use, and no other", () => {
    const route = createRouter(upstreamRoutes({}));
    assert.equal(route("GET", "/upstreams/test"), null);
    assert.deepEqual(route("GET", "/upstreams/test/test")?.params, { id: "test" });
    assert.ok(route("POST", "/upstreams/test"));
  });

  // (fails before: yes — the reference's table was written by hand and still named a top-level `pricing`, the global
  // price table step 1 removed, and an agent loop with budgets)
  test("the parameter reference's top-level table lists the config's sections, and no other", () => {
    const doc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs", "PARAMETERS.md"), "utf8");
    const table = doc.split("| top-level | what |")[1].split("\n\n")[0];
    assert.deepEqual([...table.matchAll(/^\| `(\w+)(?:\[\])?` \|/gm)].map((m) => m[1]), Object.keys(CONFIG_SCHEMA).filter((k) => k !== "_doc"));
    assert.doesNotMatch(table, /budget/i);
  });

  // (fails before: yes — a `|` went into the cells bare, as in the thinking rules' `claude-(fable|mythos)` defaults and
  // `@mem off|on`, so those parameters' rows had more cells than the header's five)
  test("the parameter reference escapes a `|` in a cell, so every parameter's row has its table's five cells", () => {
    const doc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs", "PARAMETERS.md"), "utf8");
    const rows = doc.split("\n").filter((l) => /^\| `[\w[\].]+\.[\w[\].]+` \|/.test(l));
    assert.ok(rows.length > 100, `${rows.length} rows`);
    assert.deepEqual(rows.filter((row) => row.replace(/\\\|/g, "").split("|").length - 2 !== 5).map((row) => row.slice(0, 80)), []);
  });

  // (fails before: yes — both references named an old import path, `src/schema.js` and `src/commands.js`, files that
  // only re-export what moved)
  test("each generated reference names the file its text is declared in", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    /** @type {[string, RegExp][]} */
    const refs = [["PARAMETERS.md", /^export const CONFIG_SCHEMA =/m], ["COMMANDS.md", /^export function commandsMarkdown\(/m]];
    for (const [doc, declared] of refs) {
      const from = /Generated from `([^`]+)`/.exec(readFileSync(join(root, "docs", doc), "utf8"))?.[1] || "";
      assert.match(readFileSync(join(root, from), "utf8"), declared, `${doc} names ${from}`);
    }
  });

  // (fails before: yes — the guide still sent a model with no price "to the default table (Settings → Default prices,
  // `pricing.table`)", spoke of "the former" pages and an old `#setup` link, and of two tray icons "started before
  // single-instance locking existed", and the architecture gave the pricing lookups the global table's argument and
  // kept the engine widget registered but unplaced)
  test("no doc names what only an earlier build had, or narrates what it replaced", () => {
    const DOC_WORDS = [/#setup\b/, /\bthe former\b/i, /\boriginal names\b/i, /\(model, (?:tokens, )?table, upstreamTable\)/, /\bbefore [^.|]* existed\b/i];
    const docs = ["README.md", ...["docs", "docs/architecture"].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".md")).map((f) => `${d}/${f}`))];
    /** @type {string[]} */
    const hits = [];
    for (const f of docs)
      readFileSync(join(ROOT, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const re of [...WORDS, ...DOC_WORDS]) if (re.test(line)) hits.push(`${f}:${i + 1} ${re}`);
        });
    assert.deepEqual(hits, []);
  });

  // (fails before: yes — the guide's table had six places and no Memory, the Destinations and Settings tabs of an
  // earlier console, and a Settings holding "pricing", as the Settings page's own description still said)
  test("the guide's console table names the sidebar's places and each one's tabs as the console has them", () => {
    const html = readFileSync(join(ROOT, "src/ui/index.html"), "utf8");
    const sidebar = [...html.matchAll(/<button data-nav="[^"]+"[^>]*>(?:<svg[\s\S]*?<\/svg>)?<span class="label">([^<]+)<\/span>/g)].map((m) => m[1]);
    /** @param {readonly (readonly string[])[]} tabs */
    const labels = (tabs) => tabs.map((t) => t[1]).join(" · ");
    /** @type {Record<string, string>} */
    const tabsOf = { Home: labels(HOME_PANES), Traffic: labels(TRAFFIC_VIEWS), Usage: "", Memory: labels(MEM_TABS), Destinations: labels(DEST_TABS), Lab: labels(LAB_TABS), Settings: labels(SETTINGS_TABS) };
    const guide = readFileSync(join(ROOT, "docs/GUIDE.md"), "utf8");
    const table = guide.split("| Sidebar | Tabs | What lives there |\n|---|---|---|\n")[1].split("\n\n")[0];
    const rows = table.split("\n").map((r) => r.split("|").map((c) => c.trim())).map((c) => [c[1], c[2]]);
    assert.deepEqual(rows.map((r) => r[0]), sidebar, "the sidebar's places, in its order");
    assert.deepEqual(rows, sidebar.map((s) => [s, tabsOf[s]]), "each place's tabs");
    const count = /** @type {Record<number, string>} */ ({ 6: "six", 7: "seven", 8: "eight" })[sidebar.length];
    assert.match(guide, new RegExp(`sidebar has ${count} places`));
    assert.doesNotMatch(PAGES.settings[1], /pric/i, "the Settings page's own description");
  });

  // (fails before: yes — the Tune sheet still read a "default" price source, the global table's, which no server sends)
  test("every price source the console's pages compare against is one the server sends", () => {
    const builtin = Object.entries(PRICING_DEFAULTS).find(([, r]) => Number.isFinite(Number(/** @type {any} */ (r)?.input)))?.[0] || "";
    const sent = new Set(/** @type {(string | null)[]} */ ([priceSourceOf("my-model", { "my-model": { input: 1, output: 2 } }), priceSourceOf(builtin)]));
    assert.deepEqual([...sent].sort(), ["builtin", "upstream"]);
    const compared = ["src/ui/lib/model-tune.js", "src/ui/pages/destinations.js"].flatMap((f) =>
      [...readFileSync(join(ROOT, f), "utf8").matchAll(/\b(?:p|card\(\)\??)\.source [!=]== "(\w+)"/g)].map((m) => ({ f, source: m[1] })),
    );
    assert.ok(compared.length >= 4, "the pages' comparisons are read");
    assert.deepEqual(compared.filter((c) => !sent.has(c.source)), []);
  });
});

describe("AH-C5: the orchestration engine is gone, end to end (HarnessV3-AtHome P2)", () => {
  // Teams took its place: a lead on the agent loop, its workers sub-agents. The engine's names, its settings, its tools
  // and the word for it are out of the code, the docs, the scripts and the tests. A hit is one of them back.
  const GONE = [
    /orchestrat/i,
    /\borch(?:[A-Z]\w*|-\w+)?\b/,
    /[a-z]Orch(?:[A-Z]\w*)?\b/,
    /\bORCH(?:_[A-Z]+)*\b/,
    /\bfilament_(?:task|ask_client|read)\b/,
    /\bdelegateOf\b/,
    /x-filament-delegate-of/,
    /\bagents\.(?:maxParallel|maxTasksPerTurn|timeoutMs|turnDeadlineMs|maxSpawnsPerSession|pool|permissionCeiling|workerModel|progress|memory|brief)\b/,
    /\b(?:workerPool|maxTasksPerTurn|maxSpawnsPerSession|permissionCeiling|lendRead|taskNo)\b/,
    /\bx-filament-task\b/,
    /\btask-(?:start|text|thought|hand|end|refused)\b/,
    /\bworker\.report\b/,
  ];
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  /** @param {string} at @returns {string[]} */
  const walk = (at) => readdirSync(at, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(at, e.name)) : [join(at, e.name)]));

  // (fails before: yes — the engine, its settings, its command, its page and widget, their tests and their docs were all
  // in the tree)
  test("no file names the orchestration engine, its settings or its tools", () => {
    const files = [
      "README.md",
      "package.json",
      ...["bin", "docs", "scripts", "sidecar", "src", "test", "tray"].flatMap((d) => walk(join(ROOT, d)).map((f) => relative(ROOT, f).split("\\").join("/"))),
    ].filter((f) => /\.(?:js|mjs|css|html|md|json|ps1|vbs|py)$/.test(f) && !f.startsWith("src/ui/harness/vendor/") && f !== "test/clean-slate.test.js");
    /** @type {string[]} */
    const hits = [];
    for (const f of files)
      readFileSync(join(ROOT, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const re of GONE) if (re.test(line)) hits.push(`${f}:${i + 1} ${re}`);
        });
    assert.deepEqual(hits.slice(0, 40), [], `${hits.length} hits`);
  });
});
