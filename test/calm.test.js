// @ts-check
// Calm defaults (HarnessV3-Launch L3, LD-D10): Traffic opens on Requests, settings are labelled in words, the Feature
// board says its state in words, and the harness's General page has no row that is not a control. L4 (LD-D18): the board's own line says only where its numbers come from.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { TRAFFIC_VIEWS, SETTINGS_TABS, parseHash, formatHash, palettePages } from "../src/ui/nav.js";
import { REQ_FILTER_DEFAULTS, setReqFilter, bindUi, state as uiState } from "../src/ui/runtime.js";
import { keyWords, keyBeside } from "../src/ui/lib/format.js";
import { CONFIG_SCHEMA, ACP, QODER_AUTH } from "../src/core/schema.js";
import { KNOBS, resolveSettings } from "../src/services/session-settings.js";
import { labelOf, knobWords, parseInput, docParts, docWords } from "../src/ui/lib/settings/knobs.js";
import { keyLabel, createSchemaForm } from "../src/ui/components/schema-form.js";
import { knobLabel, knobRow } from "../src/ui/lib/settings/editor.js";
import { memoryModelsPanel } from "../src/ui/pages/memory-models.js";
import { featureBoard } from "../src/app/features.js";
import { featureRow, sourcesLine, renderFeatures } from "../src/ui/harness/settings/features.js";
import { RUN_GONE } from "../src/ui/harness/lib/api.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { shortWhen } from "../src/ui/lib/claims.js";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { fakeH, textOf } from "./helpers/fake-dom.js";

const src = (/** @type {string} */ p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

/** Every element under a node carrying a class. @param {any} el @param {string} c @param {any[]} [out] @returns {any[]} */
const classed = (el, c, out = []) => {
  if (!el || typeof el !== "object") return out;
  if (String(el.attrs?.class || "").split(/\s+/).includes(c)) out.push(el);
  for (const k of el.kids || []) classed(k, c, out);
  return out;
};

describe("settings are labelled in words (LD-D10, F16)", () => {
  // (fails before: yes — L3: Settings → Server labelled its fields requireAuth, adminToken, maxBodyBytes, advertiseEffortSuffixes)
  test("one rule makes a key words: dots and camel case split, sentence case, a short table for the rest", () => {
    /** @type {Record<string, string>} */
    const cases = {
      requireAuth: "Require auth",
      adminToken: "Admin token",
      maxBodyBytes: "Max body bytes",
      advertiseEffortSuffixes: "Advertise effort suffixes",
      enabled: "Enabled",
      agentLoop: "Agent loop",
      "compaction.thresholdPercent": "Compaction threshold percent",
      ttl: "TTL",
      mcpServers: "MCP servers",
      openaiIncludeUsage: "OpenAI include usage",
      machineId: "Machine ID",
      searchURL: "Search URL",
      maxURLLength: "Max URL length", // an acronym before a word: no real key has one yet, the rule is ready
      apiBase: "API base",
      acpBridge: "ACP bridge",
      cwdDefault: "Working folder default",
      env: "Environment",
      envRemove: "Environment remove",
      listModelsArgs: "List models arguments",
      params: "Parameters",
      ops: "Operations",
      subagents: "Agents",
      inputCapChars: "Input cap characters",
      pacingMs: "Pacing (ms)",
      dailyCostUsd: "Daily cost (USD)",
      constructor: "Constructor", // a word every object has as a property is still just a word (fails before: no — a guard)
    };
    for (const [key, words] of Object.entries(cases)) assert.equal(keyWords(key), words, key);
  });

  // (fails before: yes — L3: no rule; every label was its key)
  test("every key a settings page shows reads as words: a capital first, no dot, no camel case", () => {
    /** @type {Set<string>} */
    const keys = new Set();
    /** @param {any} n */
    const walk = (n) => {
      for (const [k, v] of Object.entries(n || {})) {
        if (k === "_doc" || !v || typeof v !== "object" || Array.isArray(v)) continue;
        keys.add(k);
        if (!(typeof v.type === "string" && "description" in v)) walk(v);
      }
    };
    for (const s of [CONFIG_SCHEMA, ACP, QODER_AUTH]) walk(s);
    for (const p of Object.keys(KNOBS)) keys.add(labelOf(p));
    assert.ok(keys.size > 280, `${keys.size} keys`); // the walk reached the whole schema (285 since HarnessV3-AtHome P2 removed the old team engine's settings)
    for (const key of keys) {
      const w = keyWords(key);
      assert.match(w, /^[A-Z]/, `${key} → ${w}`);
      assert.equal(/[.]/.test(w) || /[a-z][A-Z]/.test(w.replace(/OpenAI/g, "")), false, `${key} → ${w}`);
    }
    assert.equal(knobWords("context.compaction.thresholdPercent"), "Compaction threshold percent", "a setting's words leave out its section's head");
  });

  // (fails before: yes — L3: the words replace the key, so the key needs a place of its own)
  test("the key sits beside the words only when it says something they don't", () => {
    assert.equal(keyBeside("enabled"), null);
    assert.equal(keyBeside("ttl"), null);
    assert.equal(keyBeside("server"), null);
    assert.equal(keyBeside("maxBodyBytes"), "maxBodyBytes");
    assert.equal(keyBeside("env"), "env");
    assert.equal(keyBeside("compaction.model"), "compaction.model");
  });

  // (fails before: yes — L3: a field's label and a group's heading were the bare key)
  test("the console's form: a label is the words, then the key in small mono with the full path as its tooltip", () => {
    const field = keyLabel("label", "maxBodyBytes", "server.maxBodyBytes", fakeH);
    assert.equal(field.tag, "label");
    assert.equal(textOf(field), "Max body bytes|maxBodyBytes");
    assert.deepEqual(field.kids[1].attrs, { class: "field-key", title: "server.maxBodyBytes" });
    const group = keyLabel("h3", "server", "server", fakeH);
    assert.equal(group.tag, "h3");
    assert.deepEqual(group.kids, ["Server"], "the words alone when they say it all");
    const form = src("ui/components/schema-form.js");
    assert.equal(form.split('keyLabel("h3", key, path)').length - 1, 2, "both group headings, folded and open");
    assert.equal(form.split('keyLabel("label", key, path)').length - 1, 1, "the field's label");
    assert.equal(/h\("(label|h3)", \{\}, key\)/.test(form), false, "no bare key is a label");
    const css = src("ui/style.css");
    assert.equal(/\.form \.group h3 \{[^}]*text-transform/.test(css), false, "the words keep their own case");
    assert.match(css, /\.field-head label \{ display: block;/, "the key beside the words, not stacked under them");
    assert.equal(/\.field-head label \{[^}]*font-family/.test(css), false, "the words in the page's own face");
    assert.match(css, /\.field-key \{[^}]*font-family: var\(--mono\)/, "the key in mono");
  });

  // (fails before: yes — L3: the search read the key and the docs, never the words on the screen)
  test("the form's search finds a field by its words as well as by its key", () => {
    const { schemaMatch } = createSchemaForm({ toast() {} });
    assert.equal(schemaMatch("maxBodyBytes", CONFIG_SCHEMA.server.maxBodyBytes, "max body"), true, "the words");
    assert.equal(schemaMatch("maxBodyBytes", CONFIG_SCHEMA.server.maxBodyBytes, "maxbodybytes"), true, "the key");
    assert.equal(schemaMatch("server", CONFIG_SCHEMA.server, "max body"), true, "a group holding such a field");
    assert.equal(schemaMatch("adminToken", CONFIG_SCHEMA.server.adminToken, "max body"), false);
  });

  // (fails before: yes — L3: the rows were labelled maxRounds, compaction.thresholdPercent, in mono)
  test("the settings rows: the words, then the short key in mono; a compact row shows its words alone", () => {
    const full = knobLabel("engine.lookSeconds", "Look seconds", false, fakeH);
    assert.equal(full.attrs.class, "knob-label");
    assert.equal(full.attrs.title, "engine.lookSeconds", "the dotted path stays on the tooltip");
    assert.equal(textOf(full), "Look seconds|lookSeconds");
    assert.equal(full.kids[1].attrs.class, "knob-key");
    assert.deepEqual(knobLabel("memory.enabled", "Enabled", false, fakeH).kids, ["Enabled"]);
    assert.deepEqual(knobLabel("engine.lookSeconds", "Look seconds", true, fakeH).kids, ["Look seconds"]);
    // The row as the page draws it (it takes a stand-in `h` since HarnessV3-AtHome AH-D7): its label leads the line.
    const k = /** @type {any} */ ({ ...KNOBS["engine.lookSeconds"], live: true });
    const labelIn = (/** @type {any} */ view) => knobRow("engine.lookSeconds", k, {}, { change() {} }, { mode: "session", flat: {}, sources: {}, own: "session", ...view }, /** @type {any} */ (fakeH)).kids[0].kids[0];
    assert.equal(textOf(labelIn({})), "Look seconds|lookSeconds", "the setting's own words, then its key");
    assert.equal(textOf(labelIn({ label: "Workers at once" })), "Workers at once|lookSeconds", "a widget's own words, else the setting's");
    assert.equal(textOf(labelIn({ density: "compact" })), "Look seconds", "a compact row: the words alone");
    assert.match(src("ui/lib/settings/settings.css"), /\.knob-key \{[^}]*font-family: var\(--mono\)/, "the key in mono");
    for (const f of ["ui/lib/settings/settings.css", "ui/harness/aqua.css", "ui/harness.css"]) {
      assert.equal(/\.knob-label \{[^}]*font-family/.test(src(f)), false, `${f}: the words in the page's own face`);
    }
  });

  // (fails before: yes — HarnessV4_Tasks U4, from HarnessV3-AtHome's drives: a row drew its setting's description as
  // it is stored — backticks as text, and "null" for a value nobody set, in 22 settings. `null` is the chat's word
  // (`/set <name> null`), so the stored description keeps it; the page says it in words)
  test("a setting's description on the page: backticks are mono code, and an unset value is \"not set\", never null", () => {
    assert.deepEqual(docParts("Who writes it: `off` — nobody; null = memory's summarizer."), [
      { code: false, text: "Who writes it: " },
      { code: true, text: "off" },
      { code: false, text: " — nobody; not set: memory's summarizer." },
    ]);
    assert.deepEqual(docParts("null leaves the model's default. `/set x null` unsets it."), [
      { code: false, text: "Not set leaves the model's default. " },
      { code: true, text: "/set x null" },
      { code: false, text: " unsets it." },
    ], "a sentence that opens with it keeps its capital; a command in code is left as typed");
    assert.equal(docWords("Cheap model; null takes the default. Null here, and (null) there: null."), "Cheap model; not set takes the default. Not set here, and (not set) there: not set.");
    assert.equal(docWords("nullable is a word, and so is annulled"), "nullable is a word, and so is annulled");
    assert.deepEqual(docParts("an odd ` tick"), [{ code: false, text: "an odd ` tick" }], "one backtick alone is text");
    assert.deepEqual(docParts(""), []);
    assert.deepEqual(docParts(/** @type {any} */ (undefined)), []);
    assert.equal(docWords("`off` — nobody"), "off — nobody", "a tooltip: the words, no marks");
    // Every description the registry holds reads so.
    let coded = 0;
    let unset = 0;
    for (const [path, k] of Object.entries(KNOBS)) {
      const parts = docParts(/** @type {any} */ (k).doc);
      for (const p of parts) if (!p.code) assert.ok(!/\bnull\b/i.test(p.text) && !p.text.includes("`"), `${path}: ${p.text}`);
      if (parts.some((p) => p.code)) coded++;
      if (/\bnull\b/.test(/** @type {any} */ (k).doc) && /not set/i.test(docWords(/** @type {any} */ (k).doc))) unset++;
    }
    // Enough of each to say the loop read real ones (four say null since the owner's rules of 10-31 took /trim's knobs).
    assert.ok(coded >= 5 && unset >= 4, `${coded} with code, ${unset} that said null`);
    // The row draws them: code in <code>, the rest as text.
    const k = /** @type {any} */ ({ ...KNOBS["engine.mode"], live: true });
    const row = knobRow("engine.mode", k, {}, { change() {} }, { mode: "session", flat: {}, sources: {}, own: "session" }, /** @type {any} */ (fakeH));
    const doc = row.kids.find((/** @type {any} */ x) => x?.attrs?.class === "knob-doc");
    assert.ok(doc, "the description's paragraph");
    assert.deepEqual(doc.kids.filter((/** @type {any} */ x) => x?.tag === "code").slice(0, 2).map(textOf), ["model", "team"]);
    assert.ok(!textOf(doc).includes("`"), textOf(doc).slice(0, 120));
    const inert = knobRow("engine.mode", { ...k, live: false }, {}, { change() {} }, { mode: "session", flat: {}, sources: {}, own: "session" }, /** @type {any} */ (fakeH));
    assert.ok(!String(inert.kids[0].kids[1].attrs.title).includes("`"), "the tooltip of a setting not built yet");
    assert.match(src("ui/lib/settings/settings.css"), /\.knob-doc code \{[^}]*font-family: var\(--mono\)/);
  });

  // (fails before: yes — L3: a refusal named the raw key: "maxRounds must be a whole number")
  test("a refusal names the setting the way its row does", () => {
    assert.deepEqual(parseInput("engine.lookSeconds", /** @type {any} */ (KNOBS["engine.lookSeconds"]), "1.5", "number"), { error: "Look seconds must be a whole number" });
    assert.deepEqual(parseInput("engine.lookSeconds", /** @type {any} */ (KNOBS["engine.lookSeconds"]), "many", "number", "Sub-agents at once"), { error: "Sub-agents at once must be a number" });
    const editor = src("ui/lib/settings/editor.js");
    assert.equal(editor.split("parseInput(path, k, area.value, editor, name)").length - 1, 2, "the hooks and JSON fields");
    assert.ok(editor.includes("parseInput(path, k, input.value, editor, name)"), "the one-line fields");
    assert.ok(editor.includes("cb.toast?.(`${name} needs a number`, \"err\")"));
    assert.ok(editor.includes("cb.toast?.(`${name} needs a value`, \"err\")"));
    assert.equal(/labelOf\(path\)\}/.test(editor + src("ui/lib/settings/knobs.js")), false, "no refusal names the raw key");
  });

  // (fails before: yes — L3: the console's memory settings labelled its pickers models.summarizer, models.curator, models.rewriter)
  test("memory's model is named in the harness's words, its key beside", () => {
    Object.assign(uiState, { config: { routes: [] } });
    const never = () => new Promise(() => {});
    bindUi({ h: fakeH, modelCatalog: () => null, upDisplay: (/** @type {string} */ x) => x, markDirty() {}, api: never, memStatus: never, goto: (/** @type {string} */ _t, /** @type {string} */ label) => fakeH("a", {}, label), md: (/** @type {any} */ s) => String(s) });
    const panel = memoryModelsPanel(CONFIG_SCHEMA.memory, { models: {} });
    const keys = classed(panel, "field-key");
    // The memory plan's m1: one model for memory, the curator's and the rewriter's pickers gone.
    assert.deepEqual(keys.map((k) => [textOf(k), k.attrs.title]), [["models.summarizer", "memory.models.summarizer"]]);
    assert.ok(textOf(panel).includes("Memory's model|models.summarizer"));
  });

  // (fails before: yes — L3: "Server" was the hub's tab and the first of its own sub-tabs)
  test("the Settings hub's first tab is General, so Server is not both a tab and its own sub-tab", () => {
    assert.deepEqual(SETTINGS_TABS[0], ["settings", "General"]);
    assert.equal(palettePages().find((c) => c.id === "settings")?.label, "General settings");
  });
});

describe("Traffic opens on Requests (LD-D10, F15)", () => {
  // (fails before: yes — L3: after three chats Traffic opened on "All · 49", the operations log mixed into the requests)
  test("Requests is the first tab and the default; All is one tab further", () => {
    assert.deepEqual(TRAFFIC_VIEWS.slice(0, 2).map(([id, label]) => [id, label]), [["requests", "Requests"], ["all", "All"]]);
    assert.equal(REQ_FILTER_DEFAULTS.tab, "requests");
    delete (/** @type {any} */ (uiState)).reqFilter;
    assert.equal(setReqFilter().tab, "requests", "a first visit, from the sidebar or the palette, opens Requests");
  });

  // (fails before: yes — L3: a bare #requests was All, and so was every sub-tab it did not know)
  test("the address: a bare #requests is Requests, #requests:all is All, an unknown sub-tab lands on Requests", () => {
    assert.equal(parseHash("requests")?.reqFilter?.tab, "requests");
    assert.equal(parseHash("traffic")?.reqFilter?.tab, "requests");
    assert.equal(parseHash("requests:no-such-tab")?.reqFilter?.tab, "requests");
    assert.equal(parseHash("requests:requests")?.reqFilter?.tab, "requests", "the Requests sub-tab by its own name");
    assert.equal(parseHash("requests:all")?.reqFilter?.tab, "all");
    assert.equal(formatHash({ tab: "requests", reqFilter: { tab: "requests" } }), "#requests");
    assert.equal(formatHash({ tab: "requests" }), "#requests");
    assert.equal(formatHash({ tab: "requests", reqFilter: { tab: "all" } }), "#requests:all");
    assert.equal(formatHash({ tab: "requests", reqFilter: { tab: "system" } }), "#requests:system");
  });
});

describe("the Feature board says each switch's state in words (LD-D10, F17)", () => {
  /** Each feature's switch line for a config, with no session open. @param {any} cfg */
  const lines = (cfg) => Object.fromEntries(featureBoard({ cfg: { upstreams: [], routes: [], ...cfg }, records: [] }).features.map((f) => [f.id, f.switch.value]));

  // (fails before: yes — L3: the line printed the config: "rules.translate.mode = auto", "memory.enabled · memory.autopilot.enabled = on, autopilot on")
  test("every switch, off and on, in words", () => {
    assert.deepEqual(lines({ rules: { translate: { mode: "never" } }, memory: { enabled: false }, agentLoop: { enabled: false } }), {
      translation: "Off: a request in a format the provider doesn't speak is refused",
      memory: "Off",
      // (fails before: yes — the owner's rules of 10-31: the line read rules.trim.enabled, which is gone)
      compaction: "Always on in a chat Filament runs · /compact and /autofit on command",
      "session-config": "Always on: three layers, every setting live",
      // (fails before: yes — "Off": the loop has no switch now, and a stored off is no word, the owner's of 11-09)
      loop: "Always on, in edit mode by default",
      fork: "The transcript as it was, with the session's own settings (by default)",
    });
    const on = lines({ memory: { enabled: true, autopilot: { enabled: false } }, agentLoop: { enabled: true, permissions: "read-only" } });
    assert.equal(on.translation, "On whenever the formats differ");
    assert.equal(on.memory, "On, without automatic recall");
    assert.equal(on.compaction, "Always on in a chat Filament runs · /compact and /autofit on command");
    assert.equal(on.loop, "Always on, in read-only mode by default");
    assert.equal(lines({ memory: { enabled: true } }).memory, "On, with recall in every request");
    assert.equal(lines({}).loop, "Always on, in edit mode by default");
  });

  // (fails before: yes — L3: a fork's switch read "brief · project")
  test("a fork's switch says what the open session's forks get", () => {
    // the session's settings as the board is handed them: resolved, every setting with its value
    const fork = (/** @type {any} */ layer) =>
      featureBoard({ cfg: { upstreams: [], routes: [] }, records: [], session: { id: "s1", truth: {}, settings: resolveSettings({ session: layer }) } }).features.find((x) => x.id === "fork")?.switch.value;
    assert.equal(fork({ fork: { transcript: "brief", settings: "project" } }), "One summary of the lineage, with the project's settings alone");
    assert.equal(fork({ fork: { transcript: "folds" } }), "Every inherited turn folded, with the session's own settings");
    assert.equal(fork({}), "The transcript as it was, with the session's own settings", "the settings' defaults");
    /** @type {Set<string>} */
    const said = new Set();
    for (const transcript of /** @type {string[]} */ (KNOBS["fork.transcript"].options)) {
      for (const settings of /** @type {string[]} */ (KNOBS["fork.settings"].options)) {
        const w = String(fork({ fork: { transcript, settings } }));
        assert.match(w, /^[A-Z][a-z]+ [a-z].*, with the [a-z' ]+ settings( alone)?$/, `${transcript} · ${settings} → ${w}`);
        said.add(w);
      }
    }
    assert.equal(said.size, 6, "every choice either setting offers has words of its own");
  });

  // (fails before: yes — L3: the words were a mono line of `key = value`; the key was already the badge's tooltip)
  test("the row shows the words, with the config path as the line's tooltip", () => {
    const f = featureBoard({ cfg: { upstreams: [], routes: [] }, records: [] }).features[0];
    const text = classed(featureRow(f, null, fakeH), "settings-row-text")[0];
    assert.deepEqual(text.kids[2].attrs, { class: "muted small", title: "rules.translate.mode" });
    assert.deepEqual(text.kids[2].kids, ["On whenever the formats differ"]);
  });

  // (fails before: yes — the owner's of 11-09: Records opened #/settings/records, which no section is, so General)
  test("Records opens the console's Records in a tab of its own; a harness screen opens in place", () => {
    const board = featureBoard({ cfg: { upstreams: [], routes: [] }, records: [] }).features;
    const link = (/** @type {string} */ id) => classed(featureRow(board.find((x) => x.id === id), null, fakeH), "btn-link")[0].attrs;
    assert.deepEqual(link("translation"), { class: "ghost sm btn-link", href: "/ui/#requests", target: "_blank", rel: "noopener" });
    assert.deepEqual(link("memory"), { class: "ghost sm btn-link", href: "#/settings/memory" });
  });
});

describe("the Feature board says its intro once (LD-D18, F31)", () => {
  const archive = { counts: () => ({ injections: 3, compactions: 1 }), chainCounts: () => ({ byKind: { fork: 1 }, withSettings: 2, compactionsByKind: {} }) };
  const recs = [
    { id: "a", ts: "2026-10-04T02:30:00Z", status: "ok" },
    { id: "b", ts: "2026-10-04T02:31:00Z", status: "ok", agent: { status: "done" } },
  ];

  // (fails before: yes — tour6: the line said the header's sentence again, then "12 requests in the ring since …, plus the archive")
  test("the line names where the numbers come from, and nothing the header said", () => {
    const when = shortWhen("2026-10-04T02:30:00Z");
    assert.ok(when, "the shared formatter writes the time");
    assert.equal(sourcesLine(featureBoard({ cfg: { upstreams: [], routes: [] }, records: recs, archive })), `From your own traffic: the last 2 requests, since ${when}, and memory's archive.`);
    assert.equal(sourcesLine(featureBoard({ cfg: { upstreams: [], routes: [] }, records: recs.slice(0, 1) })), `From your own traffic: the last request, on ${when}.`, "one request, and no archive to name");
    assert.equal(sourcesLine(featureBoard({ cfg: { upstreams: [], routes: [] }, records: [], archive })), "From memory's archive: your own traffic has no requests yet.");
    assert.equal(sourcesLine(featureBoard({ cfg: { upstreams: [], routes: [] }, records: [] })), "Your own traffic has no requests yet.");
    assert.equal(sourcesLine({ window: { records: 1234, oldest: null }, archive: true }), `From your own traffic: the last ${(1234).toLocaleString()} requests, and memory's archive.`, "a ring with no time says none");
  });

  // (fails before: yes — the count cell said "(the request ring)", the code's word, and the board did not say whether it read an archive)
  test("a row's count names its source the same way", () => {
    const b = featureBoard({ cfg: { upstreams: [], routes: [], memory: { enabled: true } }, records: recs, archive });
    assert.equal(b.archive, true);
    assert.equal(featureBoard({ cfg: { upstreams: [], routes: [] }, records: recs }).archive, false);
    /** @param {string} id */
    const source = (id) => {
      const cells = classed(featureRow(b.features.find((f) => f.id === id), null, fakeH), "feature-cell");
      return textOf(cells[1].kids[2]);
    };
    assert.equal(source("translation"), "requests translated between formats (your traffic)");
    assert.equal(source("fork"), "fork sessions in the archive (memory's archive)");
    // (fails before: yes — with no archive, memory's count said where it came from twice: "(no archive open: counted from the request ring) (the request ring)")
    const noArchive = featureBoard({ cfg: { upstreams: [], routes: [], memory: { enabled: true } }, records: recs });
    assert.equal(textOf(classed(featureRow(noArchive.features.find((f) => f.id === "memory"), null, fakeH), "feature-cell")[1].kids[2]), "requests that got memory injected (your traffic)");
  });
});

describe("the Feature board's replay-compare (HarnessV2 §10.6)", () => {
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

  // (fails before: yes — the bug hunt of 10-30, UIST-8: Replay-compare came free again only at a run-end among the run's events, so a run the server no longer held, or one that ended with none in its log, left it disabled and the line saying it was replaying)
  test("Replay-compare is free again however the follow ends, and the line says how it went", async () => {
    const doc = stubDocument();
    try {
      const board = featureBoard({ cfg: { upstreams: [], routes: [] }, records: [], session: { id: "c1", truth: null, settings: null } });
      /** @type {any} */
      let followed = null;
      const api = async (/** @type {string} */ path) =>
        path.startsWith("/features") ? board
          : path.endsWith("/replay-compare") ? { runId: "r1", forkId: "f1", turns: [3], under: "your defaults" }
            : {};
      const body = /** @type {any} */ (doc.document.createElement("div"));
      doc.document.body.append(body);
      await renderFeatures(body, {}, { api, follow: (/** @type {string} */ id, /** @type {any} */ o) => { followed = { id, ...o }; return { promise: Promise.resolve(), stop() {} }; } });
      const press = (/** @type {any} */ root, /** @type {string} */ words) => root.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === words).dispatch("click");
      press(body, "Replay under your defaults");
      await settle();
      const host = body.querySelector(".compare-host");
      const go = host.querySelectorAll("button").find((/** @type {any} */ b) => b.textContent === "Replay-compare");
      const line = () => host.querySelector(".compare-out p")?.textContent;
      /** One press of Replay-compare, the follow it started handed back. */
      const replay = async () => {
        followed = null;
        go.dispatch("click");
        await settle();
        assert.equal(followed?.id, "r1");
        assert.equal(go.hasAttribute("disabled"), true, "held while the replay runs");
        return followed;
      };
      let f = await replay();
      f.onMissing?.();
      f.onDone?.();
      assert.equal(go.hasAttribute("disabled"), false, "a run the server no longer holds: free again");
      assert.equal(line(), RUN_GONE);
      f = await replay();
      f.onRunEnd?.("unknown");
      f.onDone?.();
      assert.equal(go.hasAttribute("disabled"), false, "a run that ended with no run-end in its log: free again");
      assert.equal(line(), "the replay stopped: unknown");
      f = await replay();
      f.onEvent({ type: "replay-turn", n: 3, status: "ok", original: {}, replay: {} });
      f.onEvent({ type: "run-end", status: "done", summary: { replayed: 1, under: "your defaults", rows: [], totals: null } });
      f.onRunEnd?.("done");
      f.onDone?.();
      assert.equal(go.hasAttribute("disabled"), false);
      assert.match(String(line()), /^done: 1 turn replayed under your defaults /, "the run-end's own line stands");
    } finally {
      doc.restore();
    }
  });
});

describe("calm words (LD-D10, F18)", () => {
  // (fails before: yes — L3: "knob" was on the cards, the Feature board, the inspector's tooltips and the console's intros;
  // tour6 then found the server's own words on screen: two settings' docs, a refusal, the presets' Activity lines; L5:
  // the chat commands' help and answers, the last exception, said knob in eight strings)
  test("no screen says knob: the console, the harness, the server's words and the chat commands say setting", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    /** @type {string[]} */
    const files = [];
    /** @param {string} p */
    const walk = (p) => {
      if (statSync(p).isDirectory()) { if (!p.endsWith("vendor")) for (const f of readdirSync(p)) walk(join(p, f)); }
      else if (/\.m?js$/.test(p)) files.push(p);
    };
    walk(join(root, "src"));
    /** @type {string[]} */
    const said = [];
    for (const f of files) {
      const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      /** A literal's own text: a string, or one part of a template (what sits between its `${}`). @param {ts.Node} n */
      const isText = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n);
      /** A module's path, or an element's class, is not a word anyone reads. @param {ts.Node} n */
      const unread = (n) => {
        const at = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.parent : n.parent?.parent?.parent;
        const owner = ts.isTemplateHead(n) ? n.parent?.parent : at;
        return !!owner && (ts.isImportDeclaration(owner) || ts.isExportDeclaration(owner) || (ts.isPropertyAssignment(owner) && owner.name.getText(sf).replace(/["']/g, "") === "class"));
      };
      /** @param {ts.Node} n */
      const visit = (n) => {
        if (isText(n) && !unread(n) && /\bknobs?\b(?!-)/i.test(/** @type {any} */ (n).text.replace(/[\w-]*-knobs?\b/g, " "))) {
          said.push(`${relative(root, f)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${/** @type {any} */ (n).text.slice(0, 70)}`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    assert.deepEqual(said, []);
  });
});

// The settings' own word for unset ("null = the model's own default", `/set <name> null`) is no stray value: it is written,
// not printed by mistake, and P3's Session page says it in words (HarnessV3-Launch LD-D19's as-built).
describe("no screen prints a stray null (HarnessV3-Launch L5, LD-D19)", () => {
  // (fails before: yes — L5's tour read "null" under the Sub-agents widget's model line; the same slip printed it under
  // the Token debug pane's toolbar whenever the ring was not capped, and atop the folder browser at a drive's root)
  test("a DOM insert is never handed a value that may be null or false: the DOM prints it as text", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const INSERTS = new Set(["replaceChildren", "append", "prepend", "before", "after", "replaceWith"]);
    /** @type {string[]} */
    const files = [];
    /** @param {string} p */
    const walk = (p) => {
      if (statSync(p).isDirectory()) { if (!p.endsWith("vendor")) for (const f of readdirSync(p)) walk(join(p, f)); }
      else if (/\.m?js$/.test(p)) files.push(p);
    };
    walk(join(root, "src", "ui"));
    /** @type {string[]} */
    const said = [];
    for (const f of files) {
      const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      /** null or undefined, as written. @param {ts.Node} n */
      const nothing = (n) => n.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(n) && n.text === "undefined");
      /** A value that is null on one of its paths. @param {ts.Node} n @returns {boolean} */
      const maybeNothing = (n) => {
        if (ts.isParenthesizedExpression(n)) return maybeNothing(n.expression);
        return nothing(n) || (ts.isConditionalExpression(n) && (maybeNothing(n.whenTrue) || maybeNothing(n.whenFalse)));
      };
      /** The names declared in this file whose value starts out null on some path. */
      const maybes = new Set();
      /** @param {ts.Node} n */
      const collect = (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && maybeNothing(n.initializer)) maybes.add(n.name.text);
        ts.forEachChild(n, collect);
      };
      collect(sf);
      /** Inside `if (name)` or `if (name != null)`, the name holds something. @param {ts.Node} at @param {string} name */
      const guarded = (at, name) => {
        for (let p = at.parent; p; p = p.parent) {
          if (!ts.isIfStatement(p) || !(p.thenStatement === at || p.thenStatement.pos <= at.pos && at.end <= p.thenStatement.end)) continue;
          const c = p.expression;
          if (ts.isIdentifier(c) && c.text === name) return true;
          if (ts.isBinaryExpression(c) && ts.isIdentifier(c.left) && c.left.text === name && [ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(c.operatorToken.kind) && nothing(c.right)) return true;
        }
        return false;
      };
      /** @param {ts.Expression} a @param {ts.Node} call @returns {string} */
      const why = (a, call) => {
        if (ts.isParenthesizedExpression(a)) return why(a.expression, call);
        if (maybeNothing(a)) return "null on a path";
        if (ts.isBinaryExpression(a) && a.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return "false on a path";
        if (ts.isIdentifier(a) && maybes.has(a.text) && !guarded(call, a.text)) return `${a.text} may be null`;
        return "";
      };
      /** @param {ts.Node} n */
      const visit = (n) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && INSERTS.has(n.expression.name.text)) {
          for (const a of n.arguments) {
            // A spread of an array literal is its elements; any other spread (a map, a filtered list) is its own business.
            const parts = ts.isSpreadElement(a) ? (ts.isArrayLiteralExpression(a.expression) ? [...a.expression.elements] : []) : [a];
            for (const p of parts) {
              const w = why(p, n);
              if (w) said.push(`${relative(root, f).replace(/\\/g, "/")}:${sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1} ${n.expression.name.text}: ${w}`);
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    assert.deepEqual(said, []);
  });
});

describe("no row that is not a control (LD-D10, F19)", () => {
  // (fails before: yes — L3: General's first row was a greyed "English" beside "Choose the display language", which nothing could change)
  // (fails before: yes — HS-6: one notification switch for every way a run ends, and no rows for the message box)
  test("the harness's General page holds its controls under their heads, and nothing else", () => {
    const general = src("ui/harness/settings/general.js");
    const rows = general.slice(general.indexOf("  body.replaceChildren("), general.indexOf("\n}\n", general.indexOf("  body.replaceChildren(")));
    assert.equal(rows, [
      "  body.replaceChildren(",
      // The welcome tour, found again from Settings (the owner's of 11-05).
      '    h("h3", { class: "nset-h" }, "Getting started"),',
      '    row("Welcome tour", descOf("Welcome tour"), button({ label: "Open the tour", variant: "outline", size: "sm", onClick: () => cb.onWelcome?.() })),',
      // The model new chats start on, Settings › Models' head until the owner's settings cleanup of 11-09.
      "    // Where new chats start, a preference of this browser's (the owner's settings cleanup of 11-09).",
      '    h("h3", { class: "nset-h" }, "New chats"),',
      "    newChatModelCard(cb, io).el,",
      '    h("h3", { class: "nset-h" }, "Notifications"),',
      // In the desktop app's window the app's own switch stands in the page's switches' place — or, in an app too old to
      // answer, its words: the app tells, the page does not (NA3b, UX8).
      "    ...(inDesktopApp()",
      '      ? [app ? appSwitch(app) : h("p", { class: "nset-note" }, APP_WORDS)]',
      '      : [...notify, blocked, row("Notification sound", descOf("Notification sound"), sound)]),',
      '    h("h3", { class: "nset-h" }, "The message box"),',
      '    row("Send with", descOf("Send with"), sendKey.el),',
      '    row("A message while the agent works", descOf("A message while the agent works"), whileWorking.el),',
      '    h("h3", { class: "nset-h" }, "Old chats"),',
      '    row("Auto-archive old chats", descOf("Auto-archive old chats"), archive),',
      "  );",
    ].join("\n"));
    assert.match(general, /const notify = NOTIFY_ROWS\.map\(\(r\) =>\n\s+row\(r\.label, r\.desc, switchControl\(\{/, "each notification row is its switch");
    assert.match(general, /const blocked = h\("p", \{ class: "nset-note is-warn hidden" \}, BLOCKED_WORDS\);/, "the note shows only while the browser blocks");
    assert.equal(/language/i.test(general), false, "nor does its header promise one");
  });
});
