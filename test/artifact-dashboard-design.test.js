// @ts-check
// HarnessV4_Artifacts_Plan E18 step 7: a Dashboard and a Design, the agent's data drawn by Filament's own pages
// (AF-D11), and Filament's own numbers a Dashboard reads (AF-D12). What is pure is tested here — the content checked
// (AFC-124, AFC-139), the feeds read, kept and followed (AFC-129 to AFC-133), what the address answers and a download
// keeps, the script a screen runs (AFC-137), the charts' numbers (AFC-125, AFC-126), the canvas's zoom (AFC-135) and
// the pages' copies of the server's words; the pages themselves were driven in a browser (the Logs, step 7).
// (fails before: yes — Filament made pages, docs and slides: a dashboard or a design was refused as a type it does
// not make)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CONTENT_JSON, LOOK_MARK, TYPE_MODULES, joinModules, servedPage, typeServed, typeShell } from "../src/core/artifacts.js";
import {
  FEEDS,
  FEED_NAMES,
  FORMATS,
  SCREEN_SIZE,
  SCREEN_SIZES,
  SERIES_MAX,
  dashboardOf,
  designOf,
  feedAsks,
  feedKey,
  feedsOf,
  screenWords,
} from "../src/core/artifact-content.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createFeeds } from "../src/services/artifact-feeds.js";
import { UsageStore } from "../src/services/records.js";
import { localDay } from "../src/services/daily-usage.js";
import { Archive } from "../src/services/memory/archive.js";
import { SCREEN_ASK_WORDS, SCREEN_DATA_WORDS, SCREEN_SCRIPT_TEXT, createArtifactsHandler, lookCss, typeData } from "../src/http/artifacts.js";
import { artifactView, downloadOf, readsOf } from "../src/http/admin/artifacts.js";
import { ARTIFACT_GUIDE, ARTIFACT_TOOL, artifactCall } from "../src/app/agent/artifacts.js";
import * as charts from "../src/ui/artifacts/charts.js";
import { readsWords } from "../src/ui/harness/lib/artifacts.js";

/** A moment the words name: 2027-01-15 08:00 UTC. */
const NOW = Date.UTC(2027, 0, 15, 8, 0);
const UI = join(dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "src", "ui");
const uiText = (/** @type {string} */ p) => readFileSync(join(UI, ...p.split("/")), "utf8");

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const fresh = (/** @type {string} */ tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-dash-${tag}-`));
  dirs.push(d);
  return d;
};
/** A store in a fresh data folder: the clock moves a minute a call; new names take the four letters given. */
const storeOf = (/** @type {string[]} */ fours = []) => {
  let t = NOW;
  return createArtifactStore({ dataDir: fresh("data"), log: () => {}, now: () => (t += 60_000) - 60_000, four: () => fours.shift() || "zzzz" });
};
const atOf = () => ({ who: "c1", by: { chain: "c1", model: "m-1", folder: "/p", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 });
/** @param {any} store @param {any} input @returns {any} */
const call = (store, input) => artifactCall(input, atOf(), store);
/** What a page reads as its own: the payload it draws from. @param {string} page */
const payloadOf = (page) => JSON.parse(/** @type {RegExpExecArray} */ (/<script type="application\/json" id="filament-content">([\s\S]*?)<\/script>/.exec(page))[1]);
/** A value from another realm, as plain JSON, so it compares as this realm's. @param {unknown} x */
const plain = (x) => JSON.parse(JSON.stringify(x));
/**
 * A type's page's code, joined as its download writes it, run without starting the page: the names asked for.
 * @param {"dashboard" | "design"} type @param {string[]} names @returns {any}
 */
const pageNames = (type, names) =>
  vm.runInNewContext(`${joinModules(TYPE_MODULES[type].map(uiText)).replace(/\nstart(?:Dashboard|Design)\(\);\s*$/, "\n")}\n;({${names.join(",")}})`);

const WEEKS = [{ week: "W1", signups: 12 }, { week: "W2", signups: 19 }];
const DASH = {
  tiles: [
    { kind: "number", title: "Signups", from: "weeks", field: "signups" },
    { kind: "line", title: "Tokens", from: "usage-by-day", days: 7, x: "day", y: ["output", "input"] },
    { kind: "table", title: "Now", from: "calls-now" },
    { kind: "bar", title: "By week", from: "weeks", x: "week", y: "signups", format: { signups: "number" } },
    { kind: "number", title: "Spent", from: "usage-by-day", field: "cost", format: "usd" },
  ],
  tables: { weeks: WEEKS },
};
const SCREENS = { style: ".card{x:1}", screens: [{ title: "Home", size: "phone", html: "<main>Home</main>" }, { title: "Settings", html: "<!doctype html><p>S</p>", height: 600 }] };

describe("a Dashboard's content, checked (AFC-122, AFC-124, AFC-126)", () => {
  // (fails before: yes — there was no Dashboard)
  test("its tiles and tables kept as given; the feeds it reads, each once, in their order", () => {
    const d = dashboardOf(DASH);
    assert.deepEqual(d, { ok: true, content: { tiles: DASH.tiles, tables: DASH.tables }, reads: ["usage-by-day", "calls-now"] });
    assert.deepEqual(feedsOf(DASH), ["usage-by-day", "calls-now"]);
    assert.deepEqual(feedAsks(DASH), [{ feed: "usage-by-day", days: 7 }, { feed: "calls-now", days: null }, { feed: "usage-by-day", days: null }], "each feed by the days its tile gives");
    assert.deepEqual(feedAsks(DASH).map(feedKey), ["usage-by-day:7", "calls-now", "usage-by-day"]);
    assert.deepEqual([feedsOf(null), feedsOf({ tiles: "x" }), feedAsks({ tiles: [null, { from: "weeks" }] })], [[], [], []]);
    assert.deepEqual(dashboardOf({ tiles: [{ kind: "number", title: "Rows", from: "empty", of: "count" }, { kind: "table", title: "T", from: "empty", columns: ["any"] }], tables: { empty: [] } }).ok, true, "a table with no rows yet has no columns to check");
  });

  // (fails before: yes — the same)
  test("refused in words that name the tile by its place and title, and what it may give", () => {
    const no = (/** @type {any} */ input) => /** @type {any} */ (dashboardOf(input)).error;
    const feeds = FEED_NAMES.join(", ");
    const tile = (/** @type {any} */ t) => no({ tiles: [{ kind: "number", title: "A", value: 1 }, t], tables: { weeks: WEEKS } });
    assert.equal(no({}), "a dashboard needs tiles: a list of at least one — number, bar, line, table or status");
    assert.equal(no({ tiles: [] }), "a dashboard needs tiles: a list of at least one — number, bar, line, table or status");
    assert.match(no({ tiles: [{}], tables: [] }), /^tables is an object of named tables/);
    assert.equal(no({ tiles: [{}], tables: { "a b": [] } }), 'the table "a b" needs a name of letters, digits, - and _ (40 at most)');
    assert.equal(no({ tiles: [{}], tables: { "calls-now": [] } }), "the table calls-now has the name of one of Filament's numbers: name it otherwise");
    assert.match(no({ tiles: [{}], tables: { t: [1] } }), /^the table t is a list of rows, each an object/);
    assert.match(tile(7), /^tile 2 is no object/);
    assert.equal(tile({ title: "B" }), "tile 2 (B) has no kind: give number, bar, line, table or status");
    assert.equal(tile({ kind: "pie", title: "B" }), 'tile 2 (B) is a kind Filament does not draw ("pie"): give number, bar, line, table or status');
    assert.equal(tile({ kind: "bar", title: " " }), "tile 2 has no title: a few words above it");
    assert.equal(tile({ kind: "number", title: "B", value: 1, format: "euro" }), `tile 2 (B) has the format "euro": give ${FORMATS.slice(0, -1).join(", ")} or text`);
    assert.equal(tile({ kind: "number", title: "B", value: 1, format: { n: "x" } }), `tile 2 (B) has the format "x" for n: give ${FORMATS.slice(0, -1).join(", ")} or text`);
    assert.match(tile({ kind: "number", title: "B" }), /^tile 2 \(B\) has neither value nor from/);
    assert.equal(tile({ kind: "number", title: "B", value: 1, from: "weeks" }), "tile 2 (B) has value and from: a number tile shows one or the other");
    assert.equal(tile({ kind: "bar", title: "B", value: 1 }), "tile 2 (B) has value, which only a number tile shows");
    assert.equal(tile({ kind: "bar", title: "B" }), `tile 2 (B) has no from: it reads one of the tables (weeks) or Filament's numbers (${feeds})`);
    assert.equal(tile({ kind: "bar", title: "B", from: "nope" }), `tile 2 (B) reads nope, which is none of the tables (weeks) or Filament's numbers (${feeds})`);
    assert.equal(tile({ kind: "table", title: "B", from: "weeks", days: 3 }), "tile 2 (B) has days, which only usage-by-day, usage-by-model or sessions-by-day take");
    assert.equal(tile({ kind: "table", title: "B", from: "calls-now", days: 3 }), "tile 2 (B) has days, which only usage-by-day, usage-by-model or sessions-by-day take");
    for (const days of [0, 401, 1.5, "7"]) assert.equal(tile({ kind: "table", title: "B", from: "usage-by-day", days }), `tile 2 (B) has days ${JSON.stringify(days)}: a whole number from 1 to 400`);
    assert.equal(tile({ kind: "number", title: "B", from: "weeks", of: "median" }), 'tile 2 (B) has of "median": give sum, mean, last, max, min or count');
    assert.equal(tile({ kind: "number", title: "B", from: "weeks" }), "tile 2 (B) has no field: the column of weeks it reads (week, signups)");
    assert.equal(tile({ kind: "number", title: "B", from: "weeks", field: "n" }), 'tile 2 (B) reads the field "n", which weeks does not have: its columns are week, signups');
    assert.equal(tile({ kind: "table", title: "B", from: "calls-now", columns: ["model", "cost"] }), `tile 2 (B) shows the column "cost", which calls-now does not have: its columns are ${FEEDS["calls-now"].columns.map((c) => c[0]).join(", ")}`);
    assert.equal(tile({ kind: "line", title: "B", from: "weeks", y: "signups" }), "tile 2 (B) has no x: the column of weeks its line runs along (week, signups)");
    assert.equal(tile({ kind: "bar", title: "B", from: "weeks", x: "week" }), `tile 2 (B) has no y: the column whose numbers it draws, or a list of up to ${SERIES_MAX}`);
    assert.equal(tile({ kind: "bar", title: "B", from: "weeks", x: "week", y: Array(7).fill("signups") }), "tile 2 (B) draws 7 columns: 6 at most, a color each");
    assert.equal(tile({ kind: "bar", title: "B", from: "weeks", x: "week", y: ["signups", "n"] }), 'tile 2 (B) has y "n", which weeks does not have: its columns are week, signups');
  });
});

describe("a Design's content, checked (AFC-135, AFC-139)", () => {
  // (fails before: yes — there was no Design)
  test("its style and screens kept, a screen's size the desktop's where it names none; refused in words that name the screen", () => {
    assert.deepEqual(designOf(SCREENS), {
      ok: true,
      content: { style: ".card{x:1}", screens: [{ title: "Home", size: "phone", html: "<main>Home</main>" }, { title: "Settings", size: SCREEN_SIZE, height: 600, html: "<!doctype html><p>S</p>" }] },
    });
    assert.equal(/** @type {any} */ (designOf({ screens: [{ title: "  A ", html: "x", extra: 1 }] })).content.screens[0].title, "A", "its title trimmed, nothing else kept");
    const no = (/** @type {any} */ input) => /** @type {any} */ (designOf(input)).error;
    const screen = (/** @type {any} */ s) => no({ screens: [{ title: "A", html: "x" }, s] });
    assert.match(no({ screens: [] }), /^a design needs screens: a list of at least one/);
    assert.equal(no({ screens: [{ title: "A", html: "x" }], style: 4 }), "style is the CSS every screen shares, as text");
    assert.match(screen("x"), /^screen 2 is no object/);
    assert.equal(screen({ html: "x" }), "screen 2 has no title: a word or two above it (Home)");
    assert.equal(screen({ title: "B", size: "watch", html: "x" }), 'screen 2 (B) has the size "watch": give phone (390 wide), tablet (820 wide) or desktop (1440 wide)');
    for (const height of [119, 10001, 300.5, "300"])
      assert.equal(screen({ title: "B", size: "phone", height, html: "x" }), `screen 2 (B) has the height ${JSON.stringify(height)}: a whole number of pixels from 120 to 10000, or none for its size's (844)`);
    for (const height of [120, 10000]) assert.equal(designOf({ screens: [{ title: "B", height, html: "x" }] }).ok, true, `${height}`);
    assert.match(screen({ title: "B", html: " " }), /^screen 2 \(B\) has no html: the screen, a whole HTML document or what goes inside its <body>$/);
    assert.deepEqual([screenWords({ title: "A", size: "phone", html: "" }), screenWords({ title: "A", size: "desktop", height: 2000, html: "" })], ["phone, 390 × 844", "desktop, 1440 × 2000"]);
  });
});

describe("a Dashboard and a Design from the tool (AFC-122, AFC-135, AFC-142)", () => {
  // (fails before: yes — Filament made these types: page, doc, slides)
  test("published by their data, kept as content.json; a Dashboard says which of Filament's numbers it reads", () => {
    const store = storeOf(["k3f9", "d3s9"]);
    const dash = call(store, { action: "publish", type: "dashboard", title: "Signups", ...DASH });
    assert.match(dash.text, /^Published Signups v1 at http:\/\/signups-k3f9\.art\.localhost:20300\/ \([^)]+\)\. The developer sees it in the chat and can open it; you are told only that it was published\. It reads Filament's usage by day and calls now, and the developer sees on it that it does\.$/);
    const a = /** @type {any} */ (store.get("signups-k3f9"));
    const kept = `${JSON.stringify({ tiles: DASH.tiles, tables: DASH.tables }, null, 2)}\n`;
    assert.deepEqual([a.type, a.icon, a.versions[0].files], ["dashboard", "dashboard", [{ path: CONTENT_JSON, bytes: Buffer.byteLength(kept) }]]);
    assert.equal(String(store.file(a.name, 1, CONTENT_JSON)), kept);
    assert.doesNotMatch(call(store, { action: "publish", id: a.name, tiles: [{ kind: "number", title: "N", value: 3 }] }).text, /It reads/, "one that reads none says nothing of it");
    call(store, { action: "publish", type: "design", title: "Onboarding", ...SCREENS });
    const d = /** @type {any} */ (store.get("onboarding-d3s9"));
    assert.deepEqual([d.type, d.icon, d.versions[0].files.map((/** @type {any} */ f) => f.path)], ["design", "design", [CONTENT_JSON]]);
    assert.deepEqual(JSON.parse(String(store.file(d.name, 1, CONTENT_JSON))), /** @type {any} */ (designOf(SCREENS)).content);
  });

  // (fails before: yes — the same)
  test("refused in words: another type's fields, a tile or screen that is wrong, a next version as another type", () => {
    const store = storeOf(["k3f9"]);
    const no = (/** @type {any} */ input) => call(store, { action: "publish", title: "T", ...input }).error;
    assert.equal(no({ type: "dashboard", ...DASH, html: "<p>x</p>" }), 'Not published: a dashboard is given by tiles and tables alone — Filament draws the page — so leave html out. A page or an app of your own HTML is type "page" or "app".');
    assert.equal(no({ type: "dashboard", ...DASH, screens: SCREENS.screens }), 'Not published: a dashboard is given by tiles and tables alone — Filament draws the page — so leave screens out. A design is type "design".');
    assert.equal(no({ type: "design", ...SCREENS, markdown: "# x" }), 'Not published: a design is given by screens and style alone — Filament draws the page — so leave markdown out. A doc or slides is type "doc" or "slides".');
    assert.equal(no({ html: "<p>x</p>", tiles: DASH.tiles }), 'Not published: a page is given by html or folder; tiles is for a dashboard — a new one names its type ("dashboard").');
    assert.equal(no({ type: "dashboard", tiles: [{ kind: "bar", title: "B", from: "nope" }] }), `Not published: tile 1 (B) reads nope, which is none of Filament's numbers (${FEED_NAMES.join(", ")}).`);
    assert.equal(no({ type: "design", screens: [{ title: "A", size: "tv", html: "x" }] }), 'Not published: screen 1 (A) has the size "tv": give phone (390 wide), tablet (820 wide) or desktop (1440 wide).');
    assert.deepEqual(store.list(), [], "a refusal keeps nothing");
    call(store, { action: "publish", type: "dashboard", title: "Signups", ...DASH });
    assert.equal(call(store, { action: "publish", id: "signups-k3f9", type: "design", ...SCREENS }).error, "Not published: Signups is a dashboard, and a next version keeps its type. Make a new artifact for a design.");
  });

  // (fails before: yes — read gave a typed artifact's Markdown alone)
  test("read: a Dashboard's content.json whole and what it reads; a Design's style, then each screen with its size", () => {
    const store = storeOf(["k3f9", "d3s9"]);
    call(store, { action: "publish", type: "dashboard", title: "Signups", ...DASH });
    const kept = String(store.file("signups-k3f9", 1, CONTENT_JSON));
    assert.equal(call(store, { action: "read", id: "signups-k3f9" }).text, [
      "Signups — signups-k3f9, a dashboard, version 1 of 1 (the newest), made by m-1 in this session at 2027-01-15 08:00 UTC.",
      "Address: http://signups-k3f9.art.localhost:20300/",
      "Description: none",
      "Icon: dashboard",
      "Content: its tiles and tables, content.json below, which Filament draws; publish the next version whole by tiles and tables.",
      "Reads: Filament's usage by day and calls now",
      "",
      `--- content.json (${kept.length.toLocaleString("en-US")} characters) ---`,
      kept,
    ].join("\n"));
    call(store, { action: "publish", type: "design", title: "Onboarding", ...SCREENS });
    assert.equal(call(store, { action: "read", id: "onboarding-d3s9" }).text, [
      "Onboarding — onboarding-d3s9, a design, version 1 of 1 (the newest), made by m-1 in this session at 2027-01-15 08:01 UTC.",
      "Address: http://onboarding-d3s9.art.localhost:20300/",
      "Description: none",
      "Icon: design",
      "Content: its style and screens, below, which Filament lays on a canvas; publish the next version whole by style and screens.",
      "",
      "--- style (the CSS every screen shares; 10 characters) ---",
      ".card{x:1}",
      "",
      "--- screen 1: Home (phone, 390 × 844; 17 characters) ---",
      "<main>Home</main>",
      "",
      "--- screen 2: Settings (desktop, 1440 × 600; 23 characters) ---",
      "<!doctype html><p>S</p>",
    ].join("\n"));
  });

  // (fails before: yes — there were no guides for these types)
  test("a guide for each: the call, the parts, Filament's numbers with their columns, the sizes; the tool says the types", () => {
    for (const type of ["dashboard", "design"]) {
      const g = /** @type {string} */ (/** @type {any} */ (ARTIFACT_GUIDE)[type]);
      assert.equal(call(storeOf(), { action: "guide", type }).text, g);
      assert.ok(g.includes(`"type":"${type}"`), type);
      assert.doesNotMatch(g, /claude|anthropic|show_widget|window\.claude/i, type);
    }
    const dash = ARTIFACT_GUIDE.dashboard;
    for (const name of FEED_NAMES) {
      assert.ok(dash.includes(`- \`${name}\`: `), name);
      for (const [c, f] of FEEDS[name].columns) assert.ok(dash.includes(`${c} (${f})`), `${name}: ${c}`);
    }
    assert.ok(dash.includes(`\`format\` shows a tile's values: ${FORMATS.join(", ")} — number when it names none;`));
    assert.match(dash, /Use them only when the developer asks about their own Filament/);
    const design = ARTIFACT_GUIDE.design;
    assert.ok(design.includes("phone (390 × 844), tablet (820 × 1180), desktop (1440 × 900, when it names none)"));
    assert.ok(design.includes("`height` (120 to 10000 pixels)"));
    const props = /** @type {any} */ (ARTIFACT_TOOL.input_schema.properties);
    // What each type is rides the type field (the tool plan); the description says what a publish of each takes.
    assert.match(props.type.description, /dashboard \(you write tiles and the tables they read; Filament draws numbers, charts and tables\), design \(you write screens in HTML;/);
    assert.match(ARTIFACT_TOOL.description, /tiles and tables for a dashboard, screens and style for a design/);
    assert.deepEqual([props.tiles.type, props.tables.type, props.screens.type, props.style.type], ["array", "object", "array", "string"]);
  });
});

/** A UsageStore of its own, in a fresh folder: the calls a test makes, and their finishing. */
const usageOf = () => new UsageStore({ dataDir: fresh("usage"), options: { logFile: "requests.jsonl" } });
const TICK = { model: "zai/glm", upstream: "zai", upstreamModel: "glm-5.3" };
const DONE = { status: "ok", tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, thinking: 0 }, cost: 0.25, ttftMs: 300 };

describe("Filament's own numbers (AF-D12, AFC-129 to AFC-131)", () => {
  // (fails before: yes — found writing these tests: the minute feed and calls now counted a turn's parent beside the
  // call it made, and calls now memory's own calls, where the day's numbers count model calls alone; found driving
  // GLM 5.3: calls now's speed fell to 0 between the bursts its upstream sends in)
  test("each feed's rows and columns: model calls alone, as by the day; days asked for, or why not", async () => {
    const usage = usageOf();
    try {
      const feeds = createFeeds({ usage, archive: () => null });
      const parent = usage.start({ model: "agent/glm", upstream: "agent", agent: true });
      const tick = usage.start({ ...TICK, agentOf: parent.id });
      const memory = usage.start({ ...TICK, memoryFor: { purpose: "learn" } });
      const now = /** @type {any} */ (feeds.read("calls-now"));
      assert.deepEqual(now.rows.map((/** @type {any} */ r) => [r.model, r.upstream, r.phase, r.output]), [["glm-5.3", "zai", "waiting", 0]], "the call alone");
      assert.deepEqual(now.columns, FEEDS["calls-now"].columns.map(([name, format]) => ({ name, format })));
      for (const r of [tick, memory, parent]) usage.finish(r, structuredClone(DONE));
      assert.deepEqual(/** @type {any} */ (feeds.read("calls-now")).rows, []);
      const minutes = /** @type {any} */ (feeds.read("usage-by-minute")).rows;
      assert.equal(minutes.length, 60);
      assert.deepEqual([minutes.reduce((n, /** @type {any} */ m) => n + m.requests, 0), minutes.at(-1).output, minutes.at(-1).firstByteMs], [1, 50, 300]);
      // GLM 5.3's bursts, as the records said them some two seconds apart: nothing in the last second, no writing the
      // composer counts, 83 tokens over 4.6 s since the first byte.
      const writing = { ...TICK, phase: "streaming", elapsedMs: 5700, streamMs: 4600, liveOutTokens: 83, liveTps: 18, liveTpsNow: 0, liveTpsWriting: null };
      /** The calls in flight said by a store that holds these records. @param {any[]} live */
      const nowOf = (live) => /** @type {any} */ (createFeeds({ usage: /** @type {any} */ ({ live: () => live }), archive: () => null }).read("calls-now")).rows;
      assert.deepEqual(nowOf([writing]), [{ model: "glm-5.3", upstream: "zai", phase: "writing", seconds: 5.7, output: 83, tps: 18 }], "between two bursts, the speed so far");
      assert.deepEqual(nowOf([{ ...writing, streamMs: 21, liveTps: 3250 }]).map((/** @type {any} */ r) => r.tps), [null], "none over a first burst's milliseconds");
      const days = /** @type {any} */ (feeds.read("usage-by-day", { days: 7 })).rows;
      assert.deepEqual(days.map((/** @type {any} */ d) => d.day).at(-1), localDay());
      assert.equal(days.length, 7);
      assert.deepEqual([days.at(-1).requests, days.at(-1).output, days.at(-1).cost, days[0].requests, days[0].tps], [1, 50, 0.25, 0, null], "a day without calls a row of zeros");
      assert.equal(/** @type {any} */ (feeds.read("usage-by-day")).rows.length, 30, "30 days where none are asked for");
      assert.deepEqual(/** @type {any} */ (feeds.read("usage-by-model", { days: "1" })).rows.map((/** @type {any} */ r) => [r.model, r.upstream, r.requests, r.output, r.cost]), [["glm-5.3", "zai", 1, 50, 0.25]]);
      assert.deepEqual(feeds.read("nope"), { ok: false, status: 404, error: "Filament has no numbers named nope" });
      for (const d of [0, 401, "x", 2.5]) assert.deepEqual(feeds.read("usage-by-day", { days: d }), { ok: false, status: 400, error: "days is a whole number from 1 to 400" }, String(d));
      assert.deepEqual(feeds.read("sessions-by-day"), { ok: false, status: 500, error: "sessions by day could not be read: Filament keeps no record of sessions here: memory's archive is off" });
      const snap = feeds.snapshot(DASH);
      assert.deepEqual(Object.keys(snap.feeds), ["usage-by-day:7", "calls-now", "usage-by-day"]);
      assert.deepEqual([/** @type {any} */ (snap.feeds["usage-by-day:7"]).rows.length, /** @type {any} */ (snap.feeds["usage-by-day"]).rows.length], [7, 30]);
      assert.equal(typeof snap.at, "number");
    } finally {
      await usage.flush();
    }
  });

  // (fails before: yes — the archive counted no sessions by their day)
  test("sessions by day: the developer's own sessions and forks by the day each began, the turns of each day; none of a helper's", () => {
    const at = new Date(2027, 0, 14, 12).getTime();
    let clock = at;
    const archive = new Archive({ file: join(fresh("archive"), "a.db"), now: () => clock });
    try {
      let n = 0;
      const turn = (/** @type {number} */ chain) => {
        const user = { role: "user", content: [{ type: "text", text: `q${++n}` }] };
        const { turnId } = archive.beginTurn(chain, /** @type {any} */ ({ requestId: `r${n}`, model: "m", upstream: "u", userMessage: user }));
        archive.finishTurn(turnId, /** @type {any} */ ({ finalMessage: { role: "assistant", content: [{ type: "text", text: "a" }] }, requestId: `r${n}c` }));
      };
      const own = archive.chainForKey("h:one", { client: "test" });
      turn(own.id);
      turn(own.id);
      clock = at + 86_400_000;
      const fork = archive.chainForKey("h:two", { client: "test", kind: "fork" });
      turn(fork.id);
      const helper = archive.chainForKey("h:helper", { client: "test", kind: "subagent" });
      turn(helper.id);
      turn(helper.id);
      turn(own.id);
      const feeds = createFeeds({ usage: /** @type {any} */ ({}), archive: () => archive, now: () => clock });
      const day = (/** @type {number} */ ms) => localDay(new Date(ms));
      assert.deepEqual(/** @type {any} */ (feeds.read("sessions-by-day", { days: 3 })).rows, [
        { day: day(at - 86_400_000), sessions: 0, turns: 0 },
        { day: day(at), sessions: 1, turns: 2 },
        { day: day(clock), sessions: 1, turns: 2 },
      ]);
      assert.deepEqual(archive.sessionsByDay(clock - 3_600_000), [{ day: day(clock), sessions: 1, turns: 2 }], "from a moment on");
    } finally {
      archive.close();
    }
  });

  // (fails before: yes — nothing was told when Filament's numbers changed)
  test("followed: which feeds a call changes, said at most once a second; heard only while someone follows", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10_000 });
    const usage = new EventEmitter();
    const feeds = createFeeds({ usage: /** @type {any} */ (usage), archive: () => null });
    /** @type {string[][]} */
    const said = [];
    const stop = feeds.follow((names) => said.push(names));
    const other = feeds.follow(() => {
      throw new Error("a page gone");
    });
    assert.equal(usage.listenerCount("event"), 1, "one listener, however many follow");
    usage.emit("event", { type: "first-byte" });
    usage.emit("event", { type: "start" });
    t.mock.timers.tick(0);
    assert.deepEqual(said, [["usage-by-minute", "calls-now"]], "a call started: its minute and the calls now; a follower that throws stops no other");
    usage.emit("event", { type: "progress" });
    usage.emit("event", { type: "finish" });
    t.mock.timers.tick(999);
    assert.equal(said.length, 1, "not again within the second");
    t.mock.timers.tick(1);
    assert.deepEqual(said[1], ["usage-by-minute", "calls-now", "usage-by-day", "usage-by-model", "sessions-by-day"], "the calls of the second, in one word");
    stop();
    assert.equal(usage.listenerCount("event"), 1);
    other();
    assert.equal(usage.listenerCount("event"), 0, "the last to stop stops the listening");
    usage.emit("event", { type: "finish" });
    t.mock.timers.tick(5000);
    assert.equal(said.length, 2);
  });
});

/** The address's answer to a request, with what a stream writes and its closing. @param {any} answer */
const askerOf = (answer) => (/** @type {string} */ path, { name = "signups-k3f9", method = "GET" } = {}) => {
  /** @type {any} */
  const res = { status: 0, headers: {}, body: "", written: /** @type {string[]} */ ([]), writeHead(/** @type {number} */ s, /** @type {any} */ h) { this.status = s; this.headers = h; }, write(/** @type {any} */ x) { this.written.push(String(x)); }, end(/** @type {any} */ b) { this.body = b ? String(b) : ""; } };
  /** @type {(() => void)[]} */
  const closes = [];
  answer({ method, headers: {}, socket: { remoteAddress: "127.0.0.1" }, on: (/** @type {string} */ ev, /** @type {() => void} */ fn) => void (ev === "close" && closes.push(fn)) }, res, name, new URL(`http://x${path}`));
  res.close = () => closes.forEach((f) => f());
  return res;
};

describe("a Dashboard's address: its numbers, to it alone (AFC-129 to AFC-132)", () => {
  const store = storeOf(["k3f9", "p4ge", "d0c5"]);
  call(store, { action: "publish", type: "dashboard", title: "Signups", ...DASH });
  call(store, { action: "publish", id: "signups-k3f9", tiles: [{ kind: "table", title: "Models", from: "usage-by-model" }] });
  call(store, { action: "publish", title: "Spend", html: "<p>x</p>" });
  call(store, { action: "publish", type: "doc", title: "Notes", markdown: "# N\n" });
  /** @type {((names: string[]) => void)[]} */
  const followers = [];
  let stopped = 0;
  const feeds = {
    read: (/** @type {string} */ name, /** @type {any} */ o) => ({ ok: true, rows: [{ asked: name, days: o?.days ?? null }], columns: [] }),
    snapshot: () => ({ at: 0, feeds: {} }),
    follow: (/** @type {(names: string[]) => void} */ fn) => {
      followers.push(fn);
      return () => void stopped++;
    },
  };
  const ask = askerOf(createArtifactsHandler({ store, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300, feeds: /** @type {any} */ (feeds) }));
  const bare = askerOf(createArtifactsHandler({ store, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300 }));

  // (fails before: yes — an artifact's address answered nothing of Filament's numbers)
  test("a feed its version's tiles name: its rows, with the days asked for; any other, at any other address, nothing", () => {
    const r = ask("/_filament/feeds/usage-by-model?days=7");
    assert.deepEqual([r.status, r.headers["content-type"], r.headers["cache-control"]], [200, "application/json; charset=utf-8", "no-store"]);
    assert.match(r.headers["content-security-policy"], /^default-src 'none'; /);
    const body = JSON.parse(r.body);
    assert.deepEqual([body.feed, body.rows, body.columns, typeof body.at], ["usage-by-model", [{ asked: "usage-by-model", days: "7" }], [], "number"]);
    const no = (/** @type {string} */ path, /** @type {any} */ o = {}) => {
      const x = ask(path, o);
      return [x.status, JSON.parse(x.body || "{}").error];
    };
    assert.deepEqual(no("/_filament/feeds/usage-by-day"), [404, "v2 of Signups does not read usage-by-day."]);
    assert.deepEqual(no("/_filament/feeds/usage-by-day?v=1"), [200, undefined], "an old version reads its own (AFC-132)");
    assert.deepEqual(no("/_filament/feeds/usage-by-model?v=1"), [404, "v1 of Signups does not read usage-by-model."]);
    assert.deepEqual(no("/_filament/feeds/usage-by-day?v=3"), [404, "Signups has no version 3: it has 1 to 2."]);
    assert.deepEqual(no("/_filament/feeds/usage-by-day?v=x"), [404, "Signups has no version x: it has 1 to 2."]);
    assert.deepEqual(no("/_filament/feeds/calls-now", { name: "spend-p4ge" }), [404, "Spend reads none of Filament's numbers."]);
    assert.deepEqual(no("/_filament/feeds/calls-now", { name: "notes-d0c5" }), [404, "Notes reads none of Filament's numbers."]);
    assert.deepEqual(no("/_filament/feeds/calls-now", { name: "" }), [404, "This address reads none of Filament's numbers."]);
    assert.deepEqual(no("/_filament/feeds/%E0%A4%A"), [400, "That address does not read."]);
    assert.deepEqual(no("/_filament/feeds/usage-by-model", { method: "POST" }), [405, "Filament's numbers are read by GET."]);
    assert.equal(ask("/_filament/feeds/usage-by-model", { method: "HEAD" }).status, 200);
    assert.deepEqual([bare("/_filament/feeds/usage-by-model").status, JSON.parse(bare("/_filament/feeds/usage-by-model").body).error], [503, "This Filament reads none of its numbers for a dashboard."]);
  });

  // (fails before: yes — nothing was told when they changed)
  test("which of its numbers changed, as a stream: its own feeds alone, stopped when the page goes", () => {
    const s = ask("/_filament/feed-changes?v=1");
    assert.deepEqual([s.status, s.headers["content-type"], s.written], [200, "text/event-stream; charset=utf-8", [": following\n\n"]]);
    /** @type {(names: string[]) => void} */ (followers.at(-1))(["usage-by-model", "calls-now", "usage-by-day"]);
    /** @type {(names: string[]) => void} */ (followers.at(-1))(["usage-by-model"]);
    assert.deepEqual(s.written.slice(1), ['data: {"feeds":["calls-now","usage-by-day"]}\n\n'], "v1's feeds; a word of none of them is no word");
    s.close();
    assert.equal(stopped, 1);
    assert.deepEqual([ask("/_filament/feed-changes", { name: "spend-p4ge" }).status, ask("/_filament/feed-changes", { method: "POST" }).status], [404, 405]);
    assert.equal(JSON.parse(bare("/_filament/feed-changes").body).error, "v2 of Signups reads none of Filament's numbers.");
  });

  // (fails before: yes — a dashboard's address served its index.html, which it has none of)
  test("its page: Filament's own, its content and version inside — an old version's at its own", () => {
    const content = (/** @type {number} */ v) => JSON.parse(String(store.file("signups-k3f9", v, CONTENT_JSON)));
    assert.equal(ask("/").body, servedPage(typeShell("dashboard", "Signups", { content: content(2), v: 2 }, typeServed("dashboard")), "Signups"));
    assert.deepEqual(payloadOf(ask("/_filament/v/1/").body), { type: "dashboard", title: "Signups", content: content(1), v: 1 });
    assert.equal(typeData("dashboard", Buffer.from("{"), 1), null, "content that does not read draws nothing");
  });
});

describe("a Design's address and a download of each (AFC-133, AFC-137, AFC-141)", () => {
  // (fails before: yes — there was no Design to serve or download)
  test("a Design's page: its content with the look and the script each screen runs, written in", () => {
    const store = storeOf(["d3s9"]);
    call(store, { action: "publish", type: "design", title: "Onboarding", ...SCREENS });
    const ask = askerOf(createArtifactsHandler({ store, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300 }));
    const data = /** @type {any} */ (typeData("design", /** @type {Buffer} */ (store.file("onboarding-d3s9", 1, CONTENT_JSON)), 1));
    assert.deepEqual(data, { content: /** @type {any} */ (designOf(SCREENS)).content, kit: { look: lookCss(), script: SCREEN_SCRIPT_TEXT } });
    assert.equal(ask("/", { name: "onboarding-d3s9" }).body, servedPage(typeShell("design", "Onboarding", data, typeServed("design")), "Onboarding"));
    const page = downloadOf(/** @type {any} */ (store.get("onboarding-d3s9")), 1, /** @type {any} */ (store.files("onboarding-d3s9", 1))).data.toString("utf8");
    assert.deepEqual(payloadOf(page).kit.script, SCREEN_SCRIPT_TEXT, "a download draws its screens the same");
    const scripts = [...page.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.equal(scripts.length, 1);
    assert.doesNotThrow(() => new vm.Script(scripts[0]));
  });

  // (fails before: yes — a download kept no numbers)
  test("a Dashboard's download keeps its numbers as they were read, by each feed with its days; none where Filament reads none", () => {
    const store = storeOf(["k3f9"]);
    call(store, { action: "publish", type: "dashboard", title: "Signups", ...DASH });
    const a = /** @type {any} */ (store.get("signups-k3f9"));
    const feeds = { snapshot: (/** @type {any} */ content) => ({ at: 7, feeds: Object.fromEntries(feedAsks(content).map((x) => [feedKey(x), { ok: true, rows: [x], columns: [] }])) }) };
    const d = downloadOf(a, 1, /** @type {any} */ (store.files(a.name, 1)), /** @type {any} */ (feeds));
    assert.deepEqual([d.file, d.type], ["signups-k3f9.html", "text/html; charset=utf-8"]);
    const data = payloadOf(d.data.toString("utf8"));
    assert.deepEqual(Object.keys(data), ["type", "title", "content", "v", "snapshot"]);
    assert.deepEqual(data.snapshot, { at: 7, feeds: { "usage-by-day:7": { ok: true, rows: [{ feed: "usage-by-day", days: 7 }], columns: [] }, "calls-now": { ok: true, rows: [{ feed: "calls-now", days: null }], columns: [] }, "usage-by-day": { ok: true, rows: [{ feed: "usage-by-day", days: null }], columns: [] } } });
    assert.deepEqual(payloadOf(downloadOf(a, 1, /** @type {any} */ (store.files(a.name, 1))).data.toString("utf8")).snapshot.feeds, {});
  });
});

/**
 * The script a screen runs, in a stand-in frame: what it says to the Design's page, the notes it shows, what it opens
 * and asks for. @param {{ name?: string }} [o]
 */
function screenIn({ name = "filament-look:dark:full" } = {}) {
  /** @type {any[]} */
  const said = [];
  /** @type {any[]} */
  const notes = [];
  /** @type {any[][]} */
  const opened = [];
  /** @type {string[]} */
  const asked = [];
  /** @type {Record<string, string>} */
  const marks = {};
  /** @type {Record<string, ((e: any) => void)[]>} */
  const on = {};
  const listen = (/** @type {string} */ where) => (/** @type {string} */ type, /** @type {(e: any) => void} */ fn) => void (on[`${where}:${type}`] ||= []).push(fn);
  const media = { matches: false, addEventListener() {} };
  const document = {
    documentElement: { setAttribute: (/** @type {string} */ k, /** @type {string} */ v) => void (marks[k] = v), appendChild() {} },
    currentScript: null,
    createElement: (/** @type {string} */ tag) =>
      tag === "div"
        ? { textContent: "", style: {}, setAttribute() {}, addEventListener() {}, remove() {} }
        : tag === "canvas"
          ? { getContext: () => null }
          : { textContent: "" },
    addEventListener: listen("document"),
    body: { appendChild: (/** @type {any} */ n) => void notes.push(n) },
  };
  /** @type {any} */
  const win = {
    name,
    location: { href: "about:srcdoc", origin: "null", protocol: "about:" },
    fetch: (/** @type {string} */ url) => {
      asked.push(url);
      return Promise.reject(new Error("no fetch here"));
    },
    EventSource: function (/** @type {string} */ url) {
      asked.push(url);
    },
    setTimeout: () => 0,
    matchMedia: () => media,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    addEventListener: listen("window"),
    open: (/** @type {any[]} */ ...a) => void opened.push(a),
    document,
    URL,
  };
  win.window = win;
  win.parent = { postMessage: (/** @type {any} */ m, /** @type {string} */ to) => said.push({ m: JSON.parse(JSON.stringify(m)), to }) };
  vm.runInContext(SCREEN_SCRIPT_TEXT, vm.createContext(win));
  const fire = (/** @type {string} */ key, /** @type {any} */ e) => {
    for (const fn of on[key] || []) fn(e);
  };
  /** A click on a link to `href`: whether the page's own way was stopped. @param {string} href */
  const click = (href) => {
    const e = { defaultPrevented: false, prevented: false, target: { closest: () => ({ getAttribute: () => href }) }, preventDefault() { this.prevented = true; } };
    fire("document:click", e);
    return e.prevented;
  };
  return { said, notes, opened, asked, marks, fire, click, filament: win.filament, sendPrompt: win.sendPrompt };
}

describe("the script a Design's screen runs (AFC-136, AFC-137)", () => {
  // (fails before: yes — there were no screens)
  test("the look by its frame's name; here, its failures and Esc said to the Design's page; data and asks say it is a mockup", async () => {
    const s = screenIn();
    assert.deepEqual([s.marks["data-theme"], s.marks["data-motion"]], ["dark", "full"]);
    assert.deepEqual(s.said, [{ m: { kind: "here", filament: "artifact" }, to: "*" }]);
    s.fire("window:keydown", { key: "Escape" });
    s.fire("window:keydown", { key: "a" });
    assert.deepEqual(s.said.slice(1), [{ m: { kind: "escape", filament: "artifact" }, to: "*" }]);
    s.fire("window:error", { target: s, message: "boom", lineno: 3, filename: "" });
    assert.deepEqual(s.said[s.said.length - 1].m, { kind: "fail", what: "error", message: "boom", line: 3, url: "", filament: "artifact" });
    await assert.rejects(s.filament.db.list("x"), { message: SCREEN_DATA_WORDS });
    assert.equal(typeof s.filament.db.onChange(() => {}), "function");
    s.filament.ask("Make it blue");
    s.sendPrompt("  ");
    assert.deepEqual(s.notes.map((n) => n.textContent), [SCREEN_ASK_WORDS], "said once, for words; nothing to the harness");
    assert.ok(!s.said.some((x) => x.m.kind === "ask"));
    assert.deepEqual(s.asked, [], "nothing asked of any address");
    assert.doesNotMatch(SCREEN_SCRIPT_TEXT, /<\/script|<!--/i);
  });

  // (fails before: yes — the same)
  test("a link: one to a place in the screen stays; one to another page goes nowhere; a site written whole opens in a browser tab", () => {
    const s = screenIn();
    assert.deepEqual([s.click("#plans"), s.opened], [false, []]);
    assert.deepEqual([s.click("plans.html"), s.click("/x"), s.click("javascript:alert(1)"), s.opened], [true, true, true, []]);
    assert.equal(s.click("https://example.com/a"), true);
    assert.deepEqual(s.opened, [["https://example.com/a", "_blank", "noopener,noreferrer"]]);
  });
});

/** A document in which a chart measures its text: each letter 7 pixels wide. */
const chartDocument = () => {
  const g = /** @type {any} */ (globalThis);
  g.document = { createElement: () => ({ style: {}, getContext: () => null, remove() {} }), body: { append() {} } };
  g.getComputedStyle = () => ({});
};

describe("a Dashboard's charts and formats (AFC-125, AFC-126)", () => {
  // (fails before: yes — there were no charts)
  test("a value in each format; none as a dash; a value that is no number, as written", () => {
    const f = charts.formatValue;
    assert.deepEqual([f(null), f(""), f(undefined, "usd")], ["—", "—", "—"]);
    assert.deepEqual([f(3.14159), f(12.34), f(2500), f(1234567), f("12"), f("abc")], ["3.14", "12.3", "2,500", "1.23M", "12", "abc"]);
    assert.deepEqual([f(1.2, "usd"), f(1234.4, "usd"), f(0.001, "usd"), f(0, "usd"), f(-2, "usd")], ["$1.20", "$1,234", "<$0.01", "$0.00", "-$2.00"]);
    assert.deepEqual([f(0.25, "percent"), f(0.051, "percent")], ["25%", "5.1%"]);
    assert.deepEqual([f(999, "tokens"), f(12345, "tokens"), f(4_560_000, "tokens"), f(2e9, "tokens")], ["999", "12.3K", "4.56M", "2B"]);
    assert.deepEqual([f(850, "ms"), f(1500, "ms"), f(3.2, "seconds"), f(42.4, "seconds"), f(41.26, "tps")], ["850 ms", "1.5 s", "3.2 s", "42 s", "41.3 tok/s"]);
    const time = f(new Date(2026, 9, 16, 14, 5).toISOString(), "time").replace(/\s/g, " ");
    assert.deepEqual([f("2026-10-16", "date"), f("soon", "date"), time, f("nope", "time"), f(12, "text")], ["Oct 16", "soon", "2:05 PM", "nope", "12"], "a moment in this machine's time");
    assert.deepEqual([charts.numberOf(Infinity), charts.numberOf(" "), charts.numberOf("4.5"), charts.numberOf(true)], [null, null, 4.5, null]);
  });

  // (fails before: yes — the same)
  test("an axis's ticks: round steps from zero or below, past the most; 0 and 1 where all is zero", () => {
    const t = charts.ticksOf;
    assert.deepEqual([t(0, 0), t(0, 10), t(0, 7), t(-3, 9), t(0, 0.3), t(0, 1234), t(5, 6)], [
      [0, 1], [0, 2.5, 5, 7.5, 10], [0, 2, 4, 6, 8], [-5, 0, 5, 10], [0, 0.1, 0.2, 0.3], [0, 500, 1000, 1500], [0, 2, 4, 6],
    ]);
  });

  // (fails before: yes — the same)
  test("bars stand, or lie across where a name is long; a line breaks where a value is missing; each says the row under a point", () => {
    chartDocument();
    const base = { width: 400, xFormat: "text", formatOf: () => "number" };
    const rows = [{ x: "Mon", a: 3, b: 1 }, { x: "Tue", a: 5, b: null }];
    assert.equal(charts.barsAcross({ ...base, rows, x: "x", ys: ["a"] }), false);
    assert.equal(charts.barsAcross({ ...base, rows: [...rows, { x: "A long name, too", a: 1 }], x: "x", ys: ["a"] }), true);
    assert.equal(charts.barsAcross({ ...base, rows: [{ x: "2026-10-16" }], x: "x", ys: ["a"], xFormat: "date" }), false, "a day shown short stands");
    const bars = charts.barChart({ ...base, rows, x: "x", ys: ["a", "b"] });
    assert.equal(bars.across, false);
    assert.equal(bars.svg.match(/class="chart-bar series-1"/g)?.length, 2);
    assert.equal(bars.svg.match(/class="chart-bar series-2"/g)?.length, 1, "a missing value draws no bar");
    assert.deepEqual([bars.at(30, 100), bars.at(300, 100), bars.at(2, 100), bars.at(300, 400)], [0, 1, -1, -1]);
    const across = charts.barChart({ ...base, rows: [{ x: "A long name, too", a: 2 }, { x: "Another long one", a: 4 }], x: "x", ys: ["a"] });
    assert.equal(across.across, true);
    assert.match(across.svg, /class="chart-axis chart-value"/, "a single column's value at its bar's end");
    assert.deepEqual([across.at(200, 4 + 22 * 1.5), across.at(200, 0)], [1, -1]);
    const line = charts.lineChart({ ...base, rows: [1, 2, null, 4, 5].map((v, i) => ({ x: `d${i}`, a: v })), x: "x", ys: ["a"] });
    assert.equal(line.svg.match(/class="chart-line series-1"/g)?.length, 2, "two runs");
    assert.equal(line.svg.match(/class="chart-area series-1"/g)?.length, 2);
    assert.equal(line.svg.match(/class="chart-dot series-1 shown"/g)?.length, 4);
    assert.deepEqual([line.at(395, 100), line.at(30, 100), line.at(30, 300)], [4, 0, -1]);
  });
});

describe("the canvas a Design's screens lie on (AFC-135, AFC-137)", () => {
  /** @type {any} */
  const design = pageNames("design", ["screenBox", "screenLabel", "screenPage", "fitView", "zoomAt", "SCREEN_SIZES", "SCREEN_SIZE", "SCREEN_SANDBOX", "ZOOM_MIN", "ZOOM_MAX", "LOOK_NAME"]);

  // (fails before: yes — there was no canvas)
  test("a screen's box and label; its page: the look, its script and the shared style first, after a doctype", () => {
    assert.deepEqual([design.screenBox({ size: "phone" }), design.screenBox({ size: "phone", height: 300 }), design.screenBox({ size: "watch" })].map(plain), [[390, 844], [390, 300], [1440, 900]]);
    assert.equal(design.screenLabel({ title: "Home", size: "phone" }), "Home · phone, 390 × 844");
    const kit = { look: "L", script: "S" };
    assert.equal(design.screenPage({ title: "A & B", html: "<main>Hi</main>" }, kit, ""),
      '<!doctype html><html><head><meta charset="utf-8"><title>A &amp; B</title><style>L</style><script>S</script></head><body><main>Hi</main></body></html>');
    const bom = String.fromCharCode(0xfeff);
    assert.equal(design.screenPage({ title: "A", html: `${bom}<!-- c -->\n<!DOCTYPE html><html><p>x</p></html>` }, kit, "X"),
      `${bom}<!-- c -->\n<!DOCTYPE html><style>L</style><script>S</script><style>X</style><html><p>x</p></html>`);
    assert.equal(design.screenPage({ title: "A", html: "<html><p>x</p></html>" }, kit, ""), "<style>L</style><script>S</script><html><p>x</p></html>");
  });

  // (fails before: yes — the same)
  test("fit: at most 100%, room kept round it and over it for its name; a zoom kept to 10% to 400% at a point that stays", () => {
    const fit = design.fitView(390, 844, 1000, 800, 28);
    assert.equal(fit.z, (800 - 80 - 28) / 844);
    assert.equal(fit.x, (1000 - 390 * fit.z) / 2);
    assert.ok(Math.abs(fit.y - 68) < 1e-9, "its name's room kept above it");
    assert.deepEqual(plain(design.fitView(100, 100, 1000, 800)), { z: 1, x: 450, y: 350 });
    assert.equal(design.fitView(100_000, 100, 1000, 800).z, 0.1);
    assert.deepEqual(plain(design.zoomAt({ x: 0, y: 0, z: 1 }, 2, 100, 50)), { z: 2, x: -100, y: -50 });
    assert.deepEqual([design.zoomAt({ x: 0, y: 0, z: 1 }, 10, 0, 0).z, design.zoomAt({ x: 0, y: 0, z: 1 }, 0.01, 0, 0).z], [4, 0.1]);
    const v = design.zoomAt({ x: 10, y: 20, z: 0.5 }, 1, 110, 220);
    assert.deepEqual([v.x + 200 * v.z, v.y + 400 * v.z], [110, 220], "the point under the pointer stays");
  });

  // (fails before: yes — the same)
  test("the page's copies of the server's words; a screen's frame has no origin of its own", () => {
    assert.deepEqual([plain(design.SCREEN_SIZES), design.SCREEN_SIZE, design.LOOK_NAME], [plain(SCREEN_SIZES), SCREEN_SIZE, LOOK_MARK]);
    assert.doesNotMatch(design.SCREEN_SANDBOX, /allow-same-origin/);
    assert.deepEqual([design.ZOOM_MIN, design.ZOOM_MAX], [0.1, 4]);
    const dash = pageNames("dashboard", ["FEED_WORDS", "feedAsks", "feedKey", "formatsOf", "numberFrom", "FORMATS", "SERIES_MAX"]);
    assert.deepEqual(plain(dash.FEED_WORDS), Object.fromEntries(FEED_NAMES.map((n) => [n, FEEDS[n].words])));
    assert.deepEqual([plain(dash.FORMATS), dash.SERIES_MAX, plain(charts.FORMATS), charts.SERIES_MAX], [[...FORMATS], SERIES_MAX, [...FORMATS], SERIES_MAX]);
    const content = { tiles: [...DASH.tiles, { from: "calls-now" }, { from: "sessions-by-day", days: 2 }, null] };
    assert.deepEqual(plain(dash.feedAsks(content)), feedAsks(content));
    assert.deepEqual(feedAsks(content).map(dash.feedKey), feedAsks(content).map(feedKey));
    const cols = new Map([["day", "date"], ["cost", "usd"]]);
    assert.deepEqual(["day", "cost", "n"].map(dash.formatsOf({ format: "usd" }, cols)), ["date", "usd", "usd"], "a tile's format never over a column of days");
    assert.deepEqual(["day", "cost", "n"].map(dash.formatsOf({ format: { cost: "number" } }, cols)), ["date", "number", "number"]);
    assert.deepEqual(["x"].map(dash.formatsOf({}, null)), ["number"]);
    const rows = [{ n: 2 }, { n: "4" }, { n: null }, { n: 9 }];
    assert.deepEqual(["sum", "mean", "last", "max", "min", "count", undefined].map((of) => dash.numberFrom({ of, field: "n" }, rows)), [15, 5, 9, 9, 2, 4, 15]);
    assert.equal(dash.numberFrom({ field: "x" }, rows), null, "none where its column has no number");
  });

  // (fails before: yes — the tiles sat on one grid of three or four columns: three numbers, or a chart beside a wide
  // tile, left a hole)
  test("a Dashboard's tiles go in rows, in the order written, as many a line as fills it", () => {
    const { rowsOf } = pageNames("dashboard", ["rowsOf"]);
    const n = { kind: "number" };
    const bar = { kind: "bar" };
    const said = (/** @type {any[]} */ tiles) => plain(rowsOf(tiles)).map((r) => `${r.tiles.length}:${r.wide}/${r.mid}`);
    assert.deepEqual(said([n, n, n, { kind: "line" }, { ...bar, wide: true }, { kind: "table" }, { kind: "table" }]),
      ["3:3/2", "1:1/1", "1:1/1", "2:2/1"], "three numbers share a line; a chart before a wide tile has its line alone");
    assert.deepEqual(said([n, n, n, n, n]), ["5:3/2"], "five numbers go three and two, not four and one");
    assert.deepEqual(said([n, n, n, n, n, n, n, n, n]), ["9:3/2"]);
    assert.deepEqual(said([bar, bar, bar, n, bar]), ["3:2/1", "1:1/1", "1:1/1"], "a number between charts ends their run");
    assert.deepEqual(said([]), []);
    // (fails before: yes — a table with buttons on its rows shared a line and scrolled sideways; the mock's screen 8)
    assert.deepEqual(said([{ kind: "table", actions: ["rollback"] }, { kind: "table" }, { kind: "table" }]), ["1:1/1", "2:2/1"], "a table with buttons has its line alone");
  });

  // (fails before: yes — a table showed "2026-10-26T00:47:57.938Z" and run 8812 as "8,812"; the mock's screen 8)
  test("a table says a moment as people do, and a number that names a thing as written", () => {
    const { cellMoment } = pageNames("dashboard", ["cellMoment"]);
    const now = new Date(2026, 9, 26, 14, 30).getTime();
    const at = (/** @type {number} */ d, /** @type {number} */ h, /** @type {number} */ m) => new Date(2026, 9, d, h, m).toISOString();
    assert.deepEqual(
      [at(26, 14, 18), at(26, 12, 30), at(26, 7, 5), at(25, 18, 20), at(22, 11, 5)].map((v) => cellMoment(v, now)),
      ["12 min ago", "2 h ago", "07:05", "Yesterday 18:20", "Oct 22 11:05"],
    );
    assert.deepEqual([cellMoment("2026-10-24", now), cellMoment("Fix login", now), cellMoment(8812, now)], [null, null, null], "a day, words, a number: as before");
    assert.deepEqual([charts.formatValue(8812, "id"), charts.formatValue(8812, "number")], ["8812", "8,812"]);
    // (fails before: yes — found by the Hunter on the mock pass: the i flag made "paid" and "valid" ids)
    const { formatsOf } = pageNames("dashboard", ["formatsOf"]);
    assert.deepEqual(["id", "run", "runId", "run_id", "PR", "buildID", "paid", "valid", "hybrid", "total"].map(formatsOf({}, null)), ["id", "id", "id", "id", "id", "id", "number", "number", "number", "number"]);
    // The calendar's yesterday, across a night the clocks change (29 March 2026 in Europe; in any other zone as before).
    const morning = new Date(2026, 2, 30, 0, 30).getTime();
    assert.equal(cellMoment(new Date(2026, 2, 29, 18, 20).toISOString(), morning), "Yesterday 18:20");
  });
});

describe("in the harness: what a Dashboard reads (AFC-128)", () => {
  // (fails before: yes — nothing said a Dashboard read Filament's numbers)
  test("its view and Info say which of Filament's numbers its newest version reads", () => {
    assert.deepEqual([readsWords(undefined), readsWords([])], ["", ""]);
    assert.equal(readsWords([{ feed: "calls-now", words: "calls now" }]), "Filament's calls now");
    assert.equal(readsWords(["a", "b", "c"].map((w) => ({ feed: w, words: w }))), "Filament's a, b and c");
    const store = storeOf(["k3f9", "d3s9"]);
    call(store, { action: "publish", type: "dashboard", title: "Signups", ...DASH });
    call(store, { action: "publish", type: "design", title: "Onboarding", ...SCREENS });
    const view = (/** @type {string} */ name) => artifactView(/** @type {any} */ (store.get(name)), 20300, undefined, undefined, (a) => readsOf(store, a));
    assert.deepEqual(view("signups-k3f9").reads, [{ feed: "usage-by-day", words: "usage by day" }, { feed: "calls-now", words: "calls now" }]);
    assert.deepEqual(view("onboarding-d3s9").reads, []);
    call(store, { action: "publish", id: "signups-k3f9", tiles: [{ kind: "number", title: "N", value: 1 }] });
    assert.deepEqual(view("signups-k3f9").reads, [], "its newest version's");
  });
});
