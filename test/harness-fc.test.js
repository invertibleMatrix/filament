// @ts-check
// HarnessV3-Facade Phase FC (D6–D11, D13): the session view, the composer's controls as settings views, the
// widget frame, and the sidebar's rows — on the widget registry of Step 4 D8, where each
// widget turns the one widget context into a spec. DOM-free: the view and the specs take the `h` injectable, the
// frame takes the popover too, and the wiring pins grep the sources (the browser-only files).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

import { applySessionView, onSessionView } from "../src/ui/harness/state.js";
import { holderFromView } from "../src/ui/harness/waiting.js";
import { sessionStartBody } from "../src/ui/harness/session-start.js";
import { LEVELS } from "../src/ui/harness/composer/effort.js";
import { MODES, createModeSwitch } from "../src/ui/harness/composer/mode.js";
import { sourceOfKnob, sourceWords, workingWords } from "../src/ui/harness/lib/labels.js";
import { featureWidget } from "../src/ui/harness/widgets/frame.js";
import { memoryWidget } from "../src/ui/harness/widgets/memory.js";
import { spendWidget, spendSplit } from "../src/ui/harness/widgets/spend.js";
import { viewSettingsOf } from "../src/ui/harness/view-settings.js";
import { cacheWidget, predictNextRead, warmthOf, hitOf, carriedOf, callOf } from "../src/ui/harness/widgets/cache.js";
import { KNOBS } from "../src/services/session-settings.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf, recordingPopover } from "./helpers/fake-dom.js";

// --- the recording h (test/helpers/fake-dom.js): the widgets and the frame run without a DOM ---

const widgetH = fakeH;

/** Open a widget pill with a recording popover; its covered settings draw as one row per path. @returns {{ pill: any, pops: any[] }} */
const openWidget = (spec) => {
  const { popover, pops } = recordingPopover();
  const rows = (covers) => covers.paths.map((p) => widgetH("div", { class: "sess" }, p));
  const pill = /** @type {any} */ (featureWidget(spec, { h: widgetH, drawIn: fakeDrawIn, popover, rows }).el);
  pill.dispatch("click");
  return { pill, pops };
};

/**
 * The cache setting the server says of a chat whose markers Filament's own agent adds (`cacheSettingOf`): the route's
 * five minutes, the chat's to choose. The Cache instrument's clock runs on a lifetime something said, and this says one.
 */
const MARKED = Object.freeze({ ttl: "5m", from: "rules", settable: true });

/**
 * A widget context over a fixed session view (Step 4 D8), every action a no-op unless the test records it.
 * @param {any} view @param {Record<string, any>} [over]
 * @returns {import("../src/ui/harness/widgets/registry.js").WidgetContext}
 */
const ctxOf = (view, over = {}) => ({
  view: () => view,
  hasSession: () => true,
  knobs: () => KNOBS,
  models: () => over.models || [],
  live: () => ({ rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false }),
  turns: () => [],
  setWindow: () => {},
  write: () => {},
  command: () => {},
  openPage: () => {},
  memoryEngine: () => null,
  toast: () => {},
  stopAndCompact: () => {},
  undoCompaction: () => {},
  preview: async () => null,
  scrollToTurn: () => false,
  dryRun: () => {},
  subagents: { rows: () => [], models: () => [], sessionModel: () => "m", cache: () => ({ state: "none", running: false, leftMs: 0, ttlMs: 0, tokens: 0, model: null }) },
  memory: { confirm: async () => ({ ok: true }), correct: async () => ({ ok: true }), forget: async () => ({ ok: true }), answer: async () => ({ ok: true }) },
  team: { open: () => {}, back: () => {}, wait: () => null },
  accounts: { session: () => null, check: async () => {}, useResetCredit: async () => null, rows: () => [], signIn: () => {}, switchTo: () => {}, manage: () => {} },
  ...over,
});

// --- FC 1: the session view ---

test("the session view: one updater merges each part, and every subscriber hears each change once (FC 1)", () => {
  const chat = { id: "c1" };
  /** @type {any[]} */
  const heard = [];
  const off = onSessionView(chat, (v) => heard.push(structuredClone(v)));
  applySessionView(chat, { settings: { hash: "h1", sources: { "loop.permissions": "session" } } });
  applySessionView(chat, { facts: { costUsd: 0.01 } });
  assert.equal(heard.length, 2, "one notification per apply");
  assert.equal(heard[0].settings.sources["loop.permissions"], "session");
  assert.equal(heard[1].settings.hash, "h1", "a later apply keeps the earlier settings");
  assert.equal(heard[1].facts.costUsd, 0.01);
  off();
  applySessionView(chat, { holder: { window: "opencode", client: "opencode" } });
  assert.equal(heard.length, 2, "the unsubscribe stops the hearing");
  assert.equal(chat.view.holder.window, "opencode", "the holder reaches the view only through applySessionView (the events feed's `turn`, the holders resync and a refused send call it for the open chat)");
});

// --- FC 2 / FC 11: effort is the setting, never a suffix ---

test("the effort levels are the setting's values, bare — the composer's model name carries no suffix (FC 2, FC 11)", () => {
  assert.deepEqual(LEVELS.map((l) => l.id), ["", "low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(LEVELS.map((l) => l.id).filter(Boolean), KNOBS["model.effort"].options, "the levels are `model.effort`'s options");
  const src = read("src/ui/harness/composer/composer.js");
  assert.match(src, /modelName\(\) \{\n      return model\.name\(\)\.trim\(\);/, "the composer names the base model only — the effort rides `model.effort`");
});

test("sessionStartBody: effort joins the held settings unless the board holds its own, and the model goes unsuffixed (FC 11)", () => {
  const same = sessionStartBody({ held: { "model.effort": "high" } }, "C:/p", "m", "t", "edit", "low");
  assert.equal(same.model, "m");
  assert.equal(same.settings?.model?.effort, "high", "the board's own effort is not overwritten");
  const changed = sessionStartBody({}, "C:/p", "m", "t", "edit", "low");
  const flatEffort = JSON.stringify(changed.settings);
  assert.match(flatEffort, /"effort":"low"/, "a changed effort is written as model.effort");
  assert.ok(!/-low|-high|-xhigh|-max/.test(changed.model), "body.model is never a suffixed name");
  const untouched = sessionStartBody({}, "C:/p", "m", "t", "edit", "");
  assert.equal("settings" in untouched, false, "an untouched effort and an untouched mode are not sent: the chat follows your defaults (HS-D48)");
  const picked = sessionStartBody({ permTouched: true }, "C:/p", "m", "t", "edit", "");
  assert.match(JSON.stringify(picked.settings), /"permissions":"edit"/, "a mode picked for the chat is held");
});

// --- FC 3 (fails before): the next send carries no settingsPatch ---

test("the next send carries no settingsPatch — model, effort and mode write at once (FC 3, fails before)", () => {
  const src = read("src/ui/harness/app.js");
  assert.equal(/settingsPatch/.test(src), false, "app.js no longer builds a per-send settingsPatch");
});

// --- FC 4: the permission switch lists exactly the setting's values ---

test("the permission switch lists exactly loop.permissions' options (FC 4, fails before)", () => {
  assert.deepEqual(MODES.map((m) => m.id), KNOBS["loop.permissions"].options);
});

// (fails before: yes — the switch started on the mode the browser remembered and wrote every pick back, so a pick made
// for one chat became the next chat's start and "New chats start in" never reached a harness chat; HS-D48, HC-52)
test("the switch remembers nothing: it reads and writes no browser storage, starts on Filament's default and shows what it is handed", () => {
  /** @type {string[]} */
  const touched = [];
  /** @type {any} */ (globalThis).localStorage = { getItem: (/** @type {string} */ k) => { touched.push(`get ${k}`); return "auto"; }, setItem: (/** @type {string} */ k) => touched.push(`set ${k}`) };
  try {
    /** @type {any[][]} */
    const menus = [];
    /** @type {string[]} */
    const picks = [];
    const sw = createModeSwitch({ onChange: (id) => picks.push(id) }, { h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, menu: /** @type {any} */ ((/** @type {any[]} */ items) => { menus.push(items); return { el: fakeH("div"), close() {} }; }) });
    assert.equal(sw.mode(), "edit", "Filament's own default until the page hands the chat's standing");
    sw.set("read-only");
    assert.equal(sw.mode(), "read-only");
    /** @type {any} */ (sw.el).dispatch("click");
    menus.at(-1)?.find((i) => i.label === "Full access")?.onClick();
    assert.deepEqual(picks, ["auto"]);
    assert.equal(sw.mode(), "auto");
    assert.deepEqual(touched, [], "no browser storage is read or written");
  } finally {
    delete (/** @type {any} */ (globalThis).localStorage);
  }
});

// (fails before: yes — the design pass of 10-24, UX8: the Full access chip stood red at rest, a red that is always on
// and so looked past)
test("Full access wears red only while a turn runs: at rest the chip is like the others, its shield in the mode's red", () => {
  const sw = createModeSwitch({}, { h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, menu: /** @type {any} */ (() => ({ el: fakeH("div"), close() {} })) });
  const chip = /** @type {any} */ (sw.el);
  sw.set("auto");
  assert.equal(chip.classList.contains("warn"), false, "at rest: no red chip");
  assert.equal(chip.style["--tone"], "var(--color-sys-red)", "the shield keeps the mode's red");
  sw.setLive(true);
  assert.equal(chip.classList.contains("warn"), true, "a turn runs under Full access: the chip is red");
  sw.set("edit");
  assert.equal(chip.classList.contains("warn"), false, "a mode that asks is never red");
  sw.set("auto");
  sw.setLive(false);
  assert.equal(chip.classList.contains("warn"), false, "the turn ended: at rest again");
  const composer = read("src/ui/harness/composer/composer.js");
  assert.match(composer, /live = on;\n\s+mode\.setLive\(on\);/, "the composer tells the switch when a turn runs");
  const overview = read("src/ui/harness/widgets/overview-setup.js");
  assert.match(overview, /tone: ctx\.live\(\)\?\.streaming \? p\.tone : ""/, "Overview's Permission row the same: its tone only while a turn runs");
});

// --- FC 5: the frame ---

test("the frame: the sections come in order, the rows are the shared editor's, Esc returns focus (FC 5)", () => {
  const spec = {
    id: "t", label: "T", state: () => "s",
    now: () => widgetH("div", { class: "now" }, "now-row"),
    covers: { paths: ["context.results"] },
    actions: () => [widgetH("button", { class: "ghost sm" }, "act")],
    link: () => ({ label: "All T settings", onClick: () => {} }),
  };
  const { pill, pops } = openWidget(spec);
  assert.equal(pops.length, 1, "the pill opens the popover");
  const body = pops[0].body;
  const classes = body.kids.map((k) => String(k.attrs?.class || ""));
  assert.deepEqual(classes.filter((c) => c.startsWith("widget-")), ["widget-title", "widget-section widget-now", "widget-section widget-session", "widget-section widget-actions", "widget-section widget-link"], "Now, This session, Actions, then the link");
  const wsrc = read("src/ui/harness/widgets/frame.js");
  assert.match(wsrc, /import \{ knobRow, derivedOf \} from "\.\.\/\.\.\/lib\/settings\/editor\.js";/, "the setting rows are the shared editor's (and its derived map)");
  assert.equal(/knob-doc|knob-line/.test(wsrc.split("widgetSettingsRows")[1] || ""), false, "the widget file holds no row code of its own");
  assert.equal(pill.focused, undefined, "the pill was not focused yet");
  pops[0] && (pill.dispatch("keydown", { key: "Escape" }));
  assert.equal(pops[0].closed, true, "Esc closes the popover");
  assert.equal(pill.focused, true, "Esc returns focus to the pill");
});

// (FC 6's preset instrument went with the presets: the owner's of 11-07)

// --- FC 7: the memory instrument ---

/** The switch under a body by its label. @param {any} body @param {string} label */
const switchOf = (body, label) => {
  /** @param {any} n @returns {any} */
  const walk = (n) => {
    if (!n || typeof n !== "object") return null;
    if (n.tag === "input" && n.attrs?.["aria-label"] === label) return n;
    for (const k of n.kids || []) { const r = walk(k); if (r) return r; }
    return null;
  };
  return walk(body);
};

test("the memory instrument: the count, Muted or Off; the switches write the session's knobs; the global switch is not this session's to flip (FC 7)", () => {
  /** @type {any[]} */
  const writes = [];
  const spec = (view) => memoryWidget(ctxOf(view, { write: (c) => writes.push(c) }), { h: widgetH, drawIn: fakeDrawIn });
  const on = spec({ settings: { effective: { memory: { enabled: true } }, sources: { "memory.enabled": "default" } }, facts: { memory: { injected: 3, tokens: 900 } } });
  assert.equal(on.state(), "3");
  const muted = spec({ settings: { effective: { memory: { enabled: false } }, sources: { "memory.enabled": "session" } } });
  assert.equal(muted.state(), "Muted");
  const off = spec({ settings: { effective: { memory: { enabled: false } }, sources: { "memory.enabled": "global" } } });
  assert.equal(off.state(), "Off");
  const { pops } = openWidget(on);
  const text = textOf(pops[0].body);
  assert.ok(text.includes("3|memories"), text);
  assert.ok(text.includes("in the last turn · 900 tokens"));
  switchOf(pops[0].body, "Memory for this session").dispatch("change", { target: { checked: false } });
  assert.deepEqual(writes, [{ patch: { "memory.enabled": false } }], "muting writes the session's memory.enabled false");
  switchOf(pops[0].body, "Recall into each turn").dispatch("change", { target: { checked: false } });
  assert.deepEqual(writes.at(-1), { patch: { "memory.turnBlock": false } });
  const { pops: m } = openWidget(muted);
  assert.equal(switchOf(m[0].body, "Recall into each turn").attrs.disabled, "", "nothing below the main switch while memory is muted");
  switchOf(m[0].body, "Memory for this session").dispatch("change", { target: { checked: true } });
  assert.deepEqual(writes.at(-1), { unset: ["memory.enabled"] }, "unmuting unsets the session's own value");
  const { pops: o } = openWidget(off);
  assert.ok(textOf(o[0].body).includes("Off in your global settings"));
  assert.equal(switchOf(o[0].body, "Memory for this session").attrs.disabled, "", "the global switch is the dashboard's");
});

// --- FC 8: the spend instrument ---

test("the spend instrument is a view: the ledger's dollars, a column per turn, the dollars split by the price card, the tokens processed; no ceilings, and an unpriced model says so (FC 8, Step 6)", () => {
  const usage = { usd: 0.5, requests: 7, input: 90000, output: 4000, cacheRead: 600000, cacheWrite: 30000, savedUsd: 1.25, unpriced: 0, turns: 3, last: null };
  const price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
  const turns = [{ n: 1, facts: { costUsd: 0.1 } }, { n: 2, facts: { costUsd: 0.18 } }, { n: 3, facts: { costUsd: 0.22 } }];
  const spec = (view) => spendWidget(ctxOf(view, { turns: () => turns }), { h: widgetH, drawIn: fakeDrawIn });
  const plain = spec({ settings: { usage, price } });
  assert.equal(plain.state(), "$0.50");
  assert.equal(plain.covers, undefined, "a view covers no knobs");
  const { pops } = openWidget(plain);
  const text = textOf(pops[0].body);
  for (const bit of ["$0.50", "3 turns · 7 requests", "By turn", "$0.22 last turn", "Where it went", "Output", "Cache writes", "Cache reads", "New input", "$0.08", "Tokens processed", "724K", "Saved by the cache", "$1.25", "Tracked, never capped"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
  assert.doesNotMatch(text, /ceiling|warn at|stop at/i, "no ceilings anywhere");
  assert.deepEqual(spendSplit(usage, price)?.map((p) => [p.key, Math.round(p.usd * 1000) / 1000]), [["output", 0.08], ["write", 0.15], ["read", 0.12], ["input", 0.36]], "each class's tokens at the card's price");
  assert.equal(spendSplit(usage, null), null, "no card, no split");
  // (fails before: yes — the owner's 1-hour cache of 10-29: every write was priced at the card's five-minute rate)
  assert.equal(Math.round(/** @type {any} */ (spendSplit({ ...usage, cacheWrite1h: 10000 }, price)).find((/** @type {any} */ p) => p.key === "write").usd * 1000) / 1000, 0.18, "an hour's writes at twice the input price, the rest at the card's");
  const off = spec({ settings: { usage: { ...usage, unpriced: 4 } } });
  const { pops: p2 } = openWidget(off);
  assert.match(textOf(p2[0].body), /4 requests have no price — set the model's price on the Upstreams page/);
  assert.ok(buttonsOf(p2[0].body).some((b) => textOf(b).startsWith("Prices")), "a link to the prices");
  const dormant = spec({ settings: { usage, budget: { spentUsd: 5.01, state: "hard" } } });
  assert.equal(dormant.state(), "$0.50", "a dormant ceiling in the budget document changes nothing here");
  assert.equal(dormant.tone?.(), "");
});

// (fails before: yes — Providers P4: on a plan the hero read $0.00 with bars of $0 and no word of what it was worth)
test("the spend instrument on a plan: paid is the hero with the list price beside it; the bars and the split read the list figure; a by-model list from the ledger", () => {
  const usage = { usd: 0.5, listUsd: 2.3, requests: 3, input: 90000, output: 4000, cacheRead: 600000, cacheWrite: 30000, savedUsd: 1.25, unpriced: 0, turns: 2, last: null,
    byModel: { "glm-5": { usd: 0, listUsd: 1.8, requests: 2 }, "grok-4.6": { usd: 0.5, listUsd: 0.5, requests: 1 } } };
  const turns = [{ n: 1, facts: { costUsd: 0, listUsd: 1.8 } }, { n: 2, facts: { costUsd: 0.5, listUsd: 0.5 } }];
  const spec = spendWidget(ctxOf({ settings: { usage, price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } } }, { turns: () => turns }), { h: widgetH, drawIn: fakeDrawIn });
  assert.equal(spec.state(), "$0.50", "the chip is what was paid");
  assert.equal(spec.title?.(), "Spend: $0.50 this session · $2.30 at list price");
  const body = openWidget(spec).pops[0].body;
  const text = textOf(body);
  for (const bit of ["$2.30 at list price · 2 turns · 3 requests", "$0.50 last turn", "at list", "By model", "2 models", "glm-5", "paid $0.00", "$1.80 at list", "grok-4.6"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
  /** @type {any[]} */
  const bars = [];
  const walk = (/** @type {any} */ n) => { if (!n || typeof n !== "object") return; if (n.attrs?.["aria-label"] === "each turn at list price") bars.push(...n.kids.filter((/** @type {any} */ k) => !k.classList.contains("is-ghost"))); for (const k of n.kids || []) walk(k); };
  walk(body);
  assert.deepEqual(bars.map((b) => b.attrs.title), ["Turn 1: paid $0.00 · $1.80 at list", "Turn 2: $0.50"], "a plan's column is its worth, said as such");
  assert.deepEqual(bars.map((b) => Math.round(Number(/height:([\d.]+)%/.exec(b.attrs.style)?.[1]))), [100, 28], "and drawn at its worth: $1.80 the full column, $0.50 against it");
  // billed per token at the card: none of it shows
  const metered = spendWidget(ctxOf({ settings: { usage: { ...usage, listUsd: 0.5, byModel: { m: { usd: 0.5, listUsd: 0.5, requests: 4 } } } } }, { turns: () => [] }), { h: widgetH, drawIn: fakeDrawIn });
  const mt = textOf(openWidget(metered).pops[0].body);
  assert.doesNotMatch(mt, /at list|By model/);
  assert.equal(metered.title?.(), "Spend: $0.50 this session");
});

// (fails before: yes — the owner's of 11-05: the pill left out the teams beside the chat, and nothing told the chat's
// agent from its sub-agents)
test("the spend instrument counts the teams beside the chat, and Who spent it tells the chat's agent, its sub-agents and its teams apart", () => {
  const usage = { usd: 10, listUsd: 10, requests: 40, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, savedUsd: 0, unpriced: 0, turns: 6, last: null,
    agents: { usd: 3.5, listUsd: 3.5, requests: 12, before: 2.25 }, teams: { usd: 4, listUsd: 4, runs: 2 } };
  const spec = spendWidget(ctxOf({ settings: { usage } }, { turns: () => [] }), { h: widgetH, drawIn: fakeDrawIn });
  assert.equal(spec.state(), "$14.00", "the pill: the chat's ledger and its teams'");
  assert.equal(spec.title?.(), "Spend: $14.00 this session, $4.00 of it its teams'");
  const text = textOf(openWidget(spec).pops[0].body);
  for (const bit of ["This chat and its teams", "$14.00", "Who spent it", "This chat's agent", "$6.50", "Sub-agents", "12 requests", "$3.50", "Teams beside it", "2 runs, each a chat of its own", "$4.00", "The $2.25 spent before sub-agents were counted apart is under the chat's agent."]) assert.ok(text.includes(bit), `${bit} in ${text}`);
  const alone = spendWidget(ctxOf({ settings: { usage: { ...usage, agents: { usd: 0, listUsd: 0, requests: 0, before: 0 }, teams: { usd: 0, listUsd: 0, runs: 0 } } } }, { turns: () => [] }), { h: widgetH, drawIn: fakeDrawIn });
  assert.equal(alone.state(), "$10.00");
  assert.doesNotMatch(textOf(openWidget(alone).pops[0].body), /Who spent it/, "nothing to tell apart: no card");
});

test("the per-turn charts agree: a command Filament answered keeps its column as a stub in Spend and in Cache, a running turn waits, and the last turn's dollars are the last model turn's", () => {
  const turns = [
    { n: 1, facts: { costUsd: 0.1, tokens: { input: 500, cacheRead: 0, cacheWrite: 8000 } } },
    { n: 2, command: true, facts: null },
    { n: 3, facts: { costUsd: 0.2, tokens: { input: 100, cacheRead: 20000, cacheWrite: 1000 } } },
    { n: 4, command: true, facts: null },
    { n: 5, status: "streaming", facts: null },
  ];
  const usage = { usd: 0.3, requests: 4, input: 600, output: 900, cacheRead: 20000, cacheWrite: 9000, savedUsd: 0.1, turns: 4, last: { at: Date.now(), input: 100, cacheRead: 20000, cacheWrite: 1000 } };
  const view = { settings: { usage, price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } } };
  const bars = (/** @type {any} */ body, /** @type {string} */ aria) => {
    /** @type {any[]} */
    const out = [];
    const walk = (/** @type {any} */ n) => { if (!n || typeof n !== "object") return; if (n.attrs?.["aria-label"] === aria) out.push(...n.kids.filter((/** @type {any} */ k) => !k.classList.contains("is-ghost"))); for (const k of n.kids || []) walk(k); };
    walk(body);
    return out;
  };
  const spend = openWidget(spendWidget(ctxOf(view, { turns: () => turns }), { h: widgetH, drawIn: fakeDrawIn })).pops[0].body;
  const spendBars = bars(spend, "the cost of each turn");
  assert.deepEqual(spendBars.map((b) => b.attrs.title), ["Turn 1: $0.10", "Turn 2: a command — no request", "Turn 3: $0.20", "Turn 4: a command — no request"], "four finished turns, the running one waits");
  assert.equal(spendBars[1].classList.contains("is-empty"), true, "a command is a stub");
  assert.ok(textOf(spend).includes("$0.20 last turn"), "the newest turn with dollars, not the command after it");
  assert.ok(textOf(spend).includes("4 turns · 4 requests"), "the columns and the caption count the same turns");
  const cache = openWidget(cacheWidget(ctxOf(view, { turns: () => turns, preview: async () => null }), { h: widgetH, drawIn: fakeDrawIn })).pops[0].body;
  const cacheBars = bars(cache, "the share read from cache, turn by turn");
  assert.deepEqual(cacheBars.map((b) => b.attrs.title), ["Turn 1: 0% from cache", "Turn 2: a command — no request", "Turn 3: 95% from cache", "Turn 4: a command — no request"], "turn N is the same column in both charts");
});

test("the view's settings loader carries the ledger, the price card and the derivations (fails before: the whitelist dropped them)", () => {
  // The seam the widgets' figures ride through: the server's settings answer → the session view. The widget tests
  // above inject the view directly, so nothing else pins this whitelist — and for weeks it silently dropped
  // `usage` while the widgets read zeros (Step 6 §2.2's bug hunt).
  const doc = { hash: "h1", effective: { context: { results: "status" } }, usage: { usd: 0.42, requests: 3, last: { cacheRead: 900 } }, price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }, derived: [{ path: "model.thinking.keepInHistory" }], knobs: { "context.results": {} } };
  const v = viewSettingsOf(doc);
  assert.deepEqual(v.usage, doc.usage, "the spend ledger reaches the widgets");
  assert.deepEqual(v.price, doc.price, "the price card reaches Spend and Cache");
  // (fails before: yes — the review of 10-29: the chat's cache lifetime never reached the Cache widget's 5 min / 1 hour)
  assert.deepEqual(viewSettingsOf({ ...doc, cache: { ttl: "1h", from: "chat", settable: true } }).cache, { ttl: "1h", from: "chat", settable: true }, "the cache lifetime reaches Cache");
  assert.deepEqual(v.derived, doc.derived, "the derivations reach the widgets");
  assert.equal(v.hash, "h1");
  assert.ok(v.knobs, "the knob catalogue rides the full read");
  // Absent fields are never undefined — the widgets stand on nulls and empty lists.
  const bare = viewSettingsOf({ hash: "h2" });
  assert.equal(bare.usage, null);
  assert.equal(bare.price, null);
  assert.equal(bare.cache, null);
  assert.deepEqual(bare.derived, []);
  assert.equal(bare.effective, null);
  assert.equal(bare.knobs, undefined, "no knob catalogue on a write's answer");
  // Whose history it is (HarnessV3-Compaction §7.3): the Compaction widget draws a client's side from it.
  assert.equal(viewSettingsOf({ native: false }).native, false, "a client's session");
  assert.equal(viewSettingsOf({ native: true }).native, true);
  assert.equal(bare.native, null, "unsaid stays unsaid");
});

test("the ledger stays live: every finished turn — this page's and another tab's — refetches the settings document Spend and Cache read (source contract; fails before: only a command did)", () => {
  // app.js boots a DOM at import, so the wiring is pinned in its source: the ledger (`usage`) lives in the settings
  // document, and a model turn moves it — the facts alone left Spend's dollars and Cache's warmth a turn behind.
  const src = read("src/ui/harness/app.js");
  const at = src.indexOf("// The view follows the turn (D7)");
  const end = src.slice(at, at + 600);
  assert.match(end, /\n  refreshSessionDoc\(chat\);/, "the page's own turn, command or not");
  assert.doesNotMatch(end, /if \(turn\.command\) refreshSessionDoc/, "no longer after a command only");
  // Another tab's turn, followed here: the chat is read again at its end, and the read's arming refetches the document.
  const body = (/** @type {string} */ head) => src.slice(src.indexOf(head), src.indexOf("\n}\n", src.indexOf(head)));
  assert.match(body("function followLiveTurn("), /await hydrate\(chat\)/, "another tab's turn, read at its end");
  assert.match(body("async function hydrate("), /\n  armSessionView\(chat\);/);
  assert.match(body("function armSessionView("), /\n  refreshSessionDoc\(chat\);/, "the read refetches the document");
});

// --- FC 12: the source words ---

// (the owner's of 11-07: there are no presets, so a knob reads its layer; a card kept from before names its preset in words)
test("the source words: a knob reads its layer; a kept card's preset reads preset <Name> (FC 12; the name in words: HarnessV3-Launch F14)", () => {
  const s = { sources: { "loop.permissions": "session", "model.effort": "global", "memory.enabled": "default" } };
  assert.equal(sourceOfKnob("loop.permissions", s), "session");
  assert.equal(sourceOfKnob("model.effort", s), "global");
  assert.equal(sourceOfKnob("memory.enabled", s), "default");
  assert.equal(sourceWords("preset", "max"), "preset Max");
  assert.equal(sourceWords("preset"), "the applied preset");
});

test("a change card kept from before presets went, over a preset's value, reads was preset Max (FC 12; the name in words: HarnessV3-Launch F14)", async () => {
  const { cardEl } = await import("../src/ui/harness/conversation/cards.js");
  const el = cardEl({
    kind: "settings-change", v: 1, preset: { name: "max" },
    changes: [{ path: "loop.permissions", from: "edit", to: "auto", fromSource: "preset", toSource: "session" }],
  }, {}, { h: widgetH });
  assert.match(textOf(el), /was preset Max, now this session/);
});

// (fails before: yes — the goal card drew the goal alone: a budget left out, an estimate not made, went unsaid)
test("a goal card draws its notes, and the validator takes words only", async () => {
  const { cardEl } = await import("../src/ui/harness/conversation/cards.js");
  const { cardProblem } = await import("../src/core/cards.js");
  const card = { kind: "goal", v: 1, state: "proposed", title: "Goal proposed", text: "ship it", notes: ["“budget 30” was left out: goal budgets were retired — spend is tracked, never capped."] };
  assert.equal(cardProblem(card), null);
  assert.match(textOf(cardEl(card, {}, { h: widgetH })), /note\|“budget 30” was left out: goal budgets were retired/);
  assert.equal(textOf(cardEl({ ...card, notes: undefined }, {}, { h: widgetH })).includes("note"), false, "no notes, no note row");
  assert.equal(cardProblem({ ...card, notes: "one string" }), "goal notes must be a list of words");
  assert.equal(cardProblem({ ...card, notes: [1] }), "goal notes must be a list of words");
});

// --- FC 13 (fails before): the waiting queue reads the view's holder, not the transcript ---

test("the waiting queue's free reads the session view's holder, with no transcript fetch (FC 13, fails before)", () => {
  const src = read("src/ui/harness/app.js");
  const at = src.indexOf("function armWaiting");
  assert.ok(at > 0, "armWaiting is in app.js");
  const body = src.slice(at, src.indexOf("\n}", at));
  assert.equal(body.includes("/transcript"), false, "the queue stops polling the transcript — the view's holder is the one source");
  assert.match(body, /holderFromView\(chat, holder\)/, "free reads the view through the one helper (behaviorally pinned above)");
});

// (fails before: yes — the owner's rule of 10-31: an outside client gets a plain proxy plus memory, nothing more, and its
// chat is a session of its own, yet a row whose session more than one window had run turns on wore a "shared: OpenCode,
// the harness" badge, and a wide bar's second line said who it was "shared with")
test("a sidebar row names no client a chat is shared with: no session is shared with one", () => {
  const src = read("src/ui/harness/sidebar.js");
  const left = /sharedBadgeText|clientLabels|row-client|s\.shared\b|shared with \$\{/;
  assert.equal(left.test(src), false, src.match(new RegExp(`.*(${left.source}).*`))?.[0]);
  assert.equal(/\.row-client\b/.test(read("src/ui/harness.css")), false, "no badge rule left");
});

// HarnessV3-FixRound decision 29. (fails before: yes — the list loaded with the page and after its own turns only: a
// session another window started stayed off the sidebar until a reload; the
// feed's release is pinned in fc-pipeline.test.js, the row appearing in the hand test)
test("a turn let go anywhere reloads the sidebar's list once, a moment later", () => {
  const src = read("src/ui/harness/sidebar.js");
  assert.match(src, /listTimer = setTimeout\(\(\) => \{ listTimer = null; load\(query\); \}, 750\);/, "once per burst, with the search the list shows");
  // The views paint again between the two (the Plan tab draws the agent's own task paused once no turn is at work).
  assert.match(src, /if \(msg\?\.type === "turn"\) \{[^}]*patchChats\(\[msg\.chainId\]\);\s*cb\.onAtWork\?\.\(\);\s*if \(!msg\.holder\) loadSoon\(\);\s*\}/,"on a release: the turn's title and time are in the archive by then");
});

// --- FC 15: the new chat ---

test("a new chat draws no memory pill and no spend pill; the session brings them (FC 15)", () => {
  const view = { settings: { budget: { spentUsd: 0 }, effective: { memory: { enabled: true } }, sources: {} } };
  for (const build of [memoryWidget, spendWidget]) {
    const before = /** @type {any} */ (featureWidget(build(ctxOf(view, { hasSession: () => false }), { h: widgetH, drawIn: fakeDrawIn }), { h: widgetH, drawIn: fakeDrawIn, popover: () => ({ el: null, close() {} }) }));
    assert.equal(before.el.classList.contains("hidden"), true, `${before.spec.id}: hidden before the session exists`);
    let born = false;
    const after = /** @type {any} */ (featureWidget(build(ctxOf(view, { hasSession: () => born }), { h: widgetH, drawIn: fakeDrawIn }), { h: widgetH, drawIn: fakeDrawIn, popover: () => ({ el: null, close() {} }) }));
    born = true;
    after.paint();
    assert.equal(after.el.classList.contains("hidden"), false, `${after.spec.id}: shown once the session exists`);
  }
  const src = read("src/ui/harness/composer/composer.js");
  assert.match(src, /sessionMain\.classList\.toggle\("hidden", !hasSession\)/, "Session appears once the session view has the session");
});

// --- FC 10: the spinner's words ---

test("the sidebar spinner's words are the holder's own (FC 10, fails before: the spinner named no holder)", () => {
  assert.equal(workingWords({ label: "OpenCode" }), "OpenCode is working");
  assert.equal(workingWords({ client: "opencode" }), "opencode is working", "the id falls through only when the words are missing");
  assert.equal(workingWords(null), "another window is working");
});

// --- FC 13: the queue's free reads the view verbatim ---

test("holderFromView: the view's null sends the message; the captured holder never resurrects (FC 13)", () => {
  const holder = { window: "w1", client: "opencode", label: "OpenCode" };
  // The follow is armed: the view is the one source, null included.
  const followed = { follow: { chainId: "c1" }, view: { holder: null } };
  assert.equal(holderFromView(followed, holder), null, "the release reaches the queue — the send happens");
  const held = { follow: { chainId: "c1" }, view: { holder } };
  assert.equal(holderFromView(held, holder), holder);
  // A chat whose view was never applied (no session yet): the arm-time holder covers the gap.
  assert.equal(holderFromView({}, holder), holder, "no view at all: the arm-time holder stands");
});

// --- the review's fixes: the meter after a reload, the model chip, the lines under a turn ---

test("the meter's figure: the record's, else the newest turn's facts, else the typed estimate", async () => {
  const { heldFigure } = await import("../src/ui/harness/widgets/context.js");
  const rec = { tokens: { input: 100, cacheRead: 900, cacheWrite: 0 } };
  assert.deepEqual(heldFigure({ rec, facts: { held: 5 }, estimate: 7 }), { tokens: 1000, known: true }, "the record wins while the ring has it");
  assert.deepEqual(heldFigure({ rec, usage: { input_tokens: 10, cache_read_input_tokens: 20 }, liveOut: 3 }), { tokens: 33, known: true }, "the reply's usage, with the streamed output");
  assert.deepEqual(heldFigure({ facts: { held: 300 }, estimate: 7 }), { tokens: 300, known: true }, "after a reload the facts hold the figure — not 0");
  // A zero is a call the provider never counted — a Stop before it answered — not a prompt of no tokens (LD-D6, F23).
  assert.deepEqual(heldFigure({ facts: { held: 0 }, estimate: 7 }), { tokens: 7, known: false }, "a zero is no figure");
  assert.deepEqual(heldFigure({ facts: null, estimate: 7 }), { tokens: 7, known: false }, "no turn yet: the estimate");
});

test("an agent turn's meter reads where the turn ended — its newest round — with sub-agents' share as a row of its own", async () => {
  const { heldFigure, contextSources, sourceTint } = await import("../src/ui/harness/widgets/context.js");
  // Round one sent 1,000 tokens; the turn ended at 9,000 after a sub-agent's call and report joined the conversation.
  const comp = { userText: 400, assistantText: 400, toolUse: 400, toolResult: 8000, thinking: 0, subagents: 4000, system: 12000, tools: 8000, messages: 6, toolCalls: 3, subagentCalls: 1 };
  const rec = { tokens: { input: 100, cacheRead: 900, cacheWrite: 0 }, view: { historyTokens: 500, shapedTokens: 500, composition: { userText: 400, system: 12000, tools: 8000 } }, context: { window: 200000, last: { held: 9000, rounds: 3, composition: comp } } };
  assert.deepEqual(heldFigure({ rec, usage: { input_tokens: 100, cache_read_input_tokens: 900 }, liveOut: 5 }), { tokens: 9005, known: true }, "the newest round, not round one's usage");
  assert.deepEqual(heldFigure({ facts: { held: 1000, context: { held: 9000 } } }), { tokens: 9000, known: true }, "after a reload, the facts' end state");
  const src = contextSources(rec, 1000);
  const row = (/** @type {string} */ label) => src.rows.find(([l]) => l === label)?.[1] || 0;
  assert.equal(src.rows.reduce((n, [label, v]) => n + (label === "Held back" ? 0 : v), 0), 9000, "the rows add up to the provider's count of the newest round");
  const msgTok = Math.ceil(13200 / 4);
  assert.equal(row("Sub-agents") + row("Conversation"), msgTok, "the conversation is the newest round's messages");
  assert.equal(row("Sub-agents"), Math.round(msgTok * (4000 / 13200)), "sub-agents' share of those characters");
  assert.equal(row("System & tools"), 9000 - msgTok);
  assert.deepEqual([sourceTint("Sub-agents"), sourceTint("Conversation"), sourceTint("Held back"), sourceTint("constructor")], [8, 6, null, null], "its own seat and hue; the others keep theirs");
  const plain = contextSources({ tokens: { input: 1000 }, view: { historyTokens: 800, shapedTokens: 800, composition: { userText: 1000, subagents: 1000, system: 4, tools: 2 } } });
  assert.equal(plain.rows.find(([l]) => l === "Sub-agents")?.[1], 400, "a request without an end state splits the composer's count by the same share");
});

test("the meter reads the newest finished model turn — never a command's answer, never a running turn", async () => {
  const { meterTurnOf } = await import("../src/ui/harness/conversation/history.js");
  const model = { n: 1, status: "done", facts: { held: 300 }, requestId: "r1" };
  const command = { n: 2, status: "done", command: true, requestId: "r2" };
  const running = { n: 3, status: "streaming", requestId: "r3" };
  const unknown = () => null;
  assert.equal(meterTurnOf([model, command, running], unknown), model);
  assert.equal(meterTurnOf([{ n: 1, status: "open", requestId: "r0" }], unknown), null, "an unanswered turn holds nothing");
  assert.equal(meterTurnOf([], unknown), null);
});

test("a suffixed model name (`/set model.name x-high`) splits into base and effort, unless the catalogue knows it whole", async () => {
  const { splitEffortLane } = await import("../src/ui/harness/composer/effort.js");
  const catalogue = new Set(["claude-x", "qwen-max", "both", "both-high"]);
  const known = (/** @type {string} */ id) => catalogue.has(id);
  assert.deepEqual(splitEffortLane("claude-x-high", known), { base: "claude-x", effort: "high" });
  assert.deepEqual(splitEffortLane("claude-x-XHIGH", known), { base: "claude-x", effort: "xhigh" }, "the longer level wins over its tail");
  assert.equal(splitEffortLane("qwen-max", known), null, "a model whose id merely ends like a level");
  assert.deepEqual(splitEffortLane("both-high", known), { base: "both", effort: "high" }, "base and whole both known: it is a lane");
  assert.equal(splitEffortLane("claude-x", known), null);
  assert.equal(splitEffortLane("-high", known), null, "a level with no model is no model");
});

test("what Filament says under a turn: its answer, else the turn's note — memory's note never displaces it", async () => {
  const { shimLineOf } = await import("../src/ui/harness/lib/labels.js");
  const related = { memory: { related: { sessions: [{ id: "s1" }] } } };
  assert.deepEqual(shimLineOf({ command: true, shimNote: "a note", facts: related }), { kind: "command" }, "a command's card is never replaced by a note");
  assert.deepEqual(shimLineOf({ shimNote: "the tree is unchanged", facts: related }), { kind: "note", text: "the tree is unchanged" }, "related memories do not drop the note");
  assert.equal(shimLineOf({ facts: related }), null);
});

// --- the redesign's pure pieces: the footer's split, the details card's names, the follow rule, the pill's name ---

test("the footer's split: model, cost and time ride the hover row, every toned segment stays visible", async () => {
  const { factsLine, footerFacts } = await import("../src/ui/harness/lib/labels.js");
  const segments = factsLine({
    model: "m1", tokens: { input: 100, cacheRead: 20, cacheWrite: 0 }, held: 120, costUsd: 0.004,
    startedAt: 1000, endedAt: 4000, context: { verdict: "tight", window: 1000, usable: 800 }, stopReason: "max_tokens", failovers: 1,
  });
  const { meta, warn } = footerFacts(segments);
  assert.deepEqual(meta.map((s) => s.id), ["model", "cost", "time"], "only the short facts beside the actions");
  assert.deepEqual(warn.map((s) => s.id), ["fit", "cut", "failover"], "a window that did not fit, a cut reply and a failover never hide");
  assert.ok(warn.every((s) => s.tone), "every always-shown segment is toned");
  assert.deepEqual(footerFacts([]), { meta: [], warn: [] });
});

// (fails before: yes — HarnessV4_Tasks C13: a coding agent's turn that ran on three models named the one it asked
// for; the record held the three, the facts and the page did not)
test("a turn its agent ran on more than one model says so beside the model, and names each in the details card", async () => {
  const { factsLine, footerFacts, FACT_LABELS } = await import("../src/ui/harness/lib/labels.js");
  const models = [
    { model: "claude-fable-5-1", input: 114, output: 7012, cacheRead: 401000, cacheWrite: 167000 },
    { model: "claude-opus-5", input: 56, output: 4100, cacheRead: 198000, cacheWrite: 5000 },
    { model: "claude-opus-4-8", input: 2, output: 3020, cacheRead: 0, cacheWrite: 210000 },
  ];
  const segments = factsLine({ model: "claude-fable-5-1[1m]-max", upstream: "Claude Code", models, tokens: { input: 172, cacheRead: 599000, cacheWrite: 382000 } });
  const model = segments.find((s) => s.id === "model");
  // Named as the box names it, the window and the effort its alias carries read too (the Designer's review of 10-24:
  // "Claude Opus 5.5" in the box, "claude-opus-5-5" under each reply); the ids stay in the title.
  assert.equal(model?.text, "Claude Fable 5.1 Max · 1M +2");
  assert.match(model?.title ?? "", /its agent counted the turn's tokens on 3 models: claude-fable-5-1 \(7,012 out\), claude-opus-5 \(4,100 out\), claude-opus-4-8 \(3,020 out\)/);
  const ran = segments.find((s) => s.id === "models");
  assert.equal(ran?.text, "Claude Fable 5.1 7,012 out · Claude Opus 5 4,100 out · Claude Opus 4.8 3,020 out");
  assert.equal(FACT_LABELS.models, "Ran on");
  assert.deepEqual(segments.map((s) => s.id).slice(0, 2), ["model", "models"], "the row sits under the model's");
  assert.deepEqual(footerFacts(segments).meta.map((s) => s.id), ["model"], "the hover row keeps the model, with its +2; the list is the card's");
  // One model counted: the name the agent answered on is in the tooltip, and nothing else changes.
  const one = factsLine({ model: "opus-max", models: [models[1]], tokens: { input: 1 } });
  assert.deepEqual(one.map((s) => [s.id, s.text]).slice(0, 1), [["model", "Opus Max"]]);
  assert.match(one[0].title, /its agent counted the turn's tokens on claude-opus-5 \(4,100 out\)$/);
  assert.equal(one.some((s) => s.id === "models"), false);
  // No count from the agent (Filament's own loop, an agent that says none): as before.
  assert.deepEqual(factsLine({ model: "m1", upstream: "u1" }).map((s) => [s.text, s.title]), [["M1", "answered by m1 on u1"]]);
});

test("the details card names every segment factsLine can make — no raw id reaches the card", async () => {
  const { factsLine, FACT_LABELS } = await import("../src/ui/harness/lib/labels.js");
  const every = factsLine({
    models: [{ model: "a", output: 2 }, { model: "b", output: 1 }],
    model: "m1", upstream: "u1", tokens: { input: 100, cacheRead: 20, cacheWrite: 5 }, held: 125, costUsd: 0.5,
    startedAt: 1000, endedAt: 5000, memory: { injected: 2, tokens: 90 }, view: { form: "plain", savedTokens: 400 },
    context: { verdict: "fits", window: 1000, usable: 800 }, stopReason: "max_tokens", failovers: 2, errors: 1,
  });
  assert.ok(every.length >= 12, `the fixture reaches every segment (${every.map((s) => s.id).join(",")})`);
  for (const s of every) assert.ok(FACT_LABELS[s.id], `the card has a name for ${s.id}`);
});

test("the follow rule: an upward read lets go, the page's own catch-up while content grows keeps following", async () => {
  const { shouldFollow } = await import("../src/ui/harness/lib/labels.js");
  assert.equal(shouldFollow(400, true, false), true, "content grew under a follower: no upward scroll, still following");
  assert.equal(shouldFollow(400, true, true), false, "the developer scrolled up: free");
  assert.equal(shouldFollow(400, false, false), false, "a free reader stays free until the band");
  assert.equal(shouldFollow(20, false, true), true, "inside the band: following again, whichever way the scroll went");
});

test("a widget pill carries the feature's name beside its value; the page decides where the name shows", () => {
  const spec = { id: "t", label: "Preset", state: () => "balanced" };
  const pill = /** @type {any} */ (featureWidget(spec, { h: widgetH, drawIn: fakeDrawIn, popover: () => ({ el: null, close() {} }) }).el);
  const label = pill.querySelector(".widget-label");
  const value = pill.querySelector(".widget-value");
  assert.ok(label && value, "the pill has a name and a value");
  assert.equal(textOf(label), "Preset");
  assert.equal(textOf(value), "balanced");
  assert.equal(pill.attrs["aria-label"], "Preset: balanced", "a screen reader hears both");
});

// (fails before: yes — the Designer's review of 10-24: the strip's gauges were bare figures, "80%" or "6%", that said
// neither what they measured nor what the figure was)
test("a named gauge shows its name beside its figure, and the figure's word after it, following the figure; the CSS shows them only on a named pill, and not on a narrow composer", () => {
  let word = "warm 3:43";
  const w = featureWidget({ id: "t", label: "Cache", state: () => "80%", named: true, more: () => word }, { h: widgetH, drawIn: fakeDrawIn, popover: () => ({ el: null, close() {} }) });
  const pill = /** @type {any} */ (w.el);
  assert.ok(pill.classList.contains("is-named"));
  assert.equal(textOf(pill.querySelector(".widget-more")), "warm 3:43");
  assert.equal(pill.attrs["aria-label"], "Cache: 80% warm 3:43", "heard with the figure");
  word = "";
  w.paint();
  assert.equal(textOf(pill.querySelector(".widget-more")), "", "nothing to say: nothing after the figure");
  const plain = /** @type {any} */ (featureWidget({ id: "u", label: "Preset", state: () => "balanced" }, { h: widgetH, drawIn: fakeDrawIn, popover: () => ({ el: null, close() {} }) }).el);
  assert.equal(plain.classList.contains("is-named"), false);
  const css = readFileSync(new URL("../src/ui/harness/instruments.css", import.meta.url), "utf8");
  assert.match(css, /\n\.widget-pill\.is-named \.widget-label \{ display: inline;/);
  assert.match(css, /\n\.widget-pill \.widget-more \{ display: none; \}\n\.widget-pill\.is-named \.widget-more:not\(:empty\) \{ display: inline;/);
  // A narrow column hides the strip's names, the words after their figures kept ("warm 4 min"); the typing row's fold
  // by the room the row finds (bar-fit.js, aqua.css).
  assert.match(css, /\n@container composer \(max-width: 640px\) \{ \.composer-strip \.widget-pill\.is-named \.widget-label \{ display: none; \} \}/);
  assert.doesNotMatch(css, /@container composer \(max-width: 640px\) \{[^}]*\.widget-more/);
});

test("a popover closed from outside — Esc, a press elsewhere — leaves the pill closed: one click opens it again (M6-7)", () => {
  const { popover, pops } = recordingPopover();
  const w = featureWidget({ id: "t", label: "Memory", state: () => "1", now: () => widgetH("div", {}, "now") }, { h: widgetH, drawIn: fakeDrawIn, popover });
  const pill = /** @type {any} */ (w.el);
  pill.dispatch("click");
  assert.equal(pops.length, 1);
  assert.ok(pill.classList.contains("is-open"));
  pops[0].close(); // the overlay stack's Esc, or a press outside it
  assert.ok(!pill.classList.contains("is-open"), "the pill no longer looks pressed");
  pill.dispatch("click");
  assert.equal(pops.length, 2, "one click opens it again");
  assert.ok(pill.classList.contains("is-open"));
  pill.dispatch("click");
  assert.equal(pops[1].closed, true, "and the next closes it");
  assert.ok(!pill.classList.contains("is-open"));
  // A shortcut opens it after an outside close too.
  pill.dispatch("click");
  pops[2].close();
  w.show();
  assert.equal(pops.length, 4, "show opens it again");
});

// --- Step 6 design: the Cache instrument ---

test("the cache instrument: the last request's hit rate on the pill; the ring, warmth from the newest request, the split, the turns and the prediction in the popover", async () => {
  const usage = { usd: 0.3, requests: 5, input: 1000, output: 3000, cacheRead: 90000, cacheWrite: 9000, savedUsd: 0.8, last: { at: Date.now() - 60_000, input: 100, cacheRead: 30000, cacheWrite: 900, output: 200 } };
  const turns = [{ n: 1, facts: { tokens: { input: 500, cacheRead: 0, cacheWrite: 8000 } } }, { n: 2, facts: { tokens: { input: 100, cacheRead: 20000, cacheWrite: 1000 } } }, { n: 3, user: "no facts yet" }];
  const view = { settings: { usage, cache: MARKED, effective: { context: { results: "keep" } }, price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } } };
  const spec = cacheWidget(ctxOf(view, { turns: () => turns, preview: async () => ({ current: { perTurn: [], wouldCompact: false } }) }), { h: widgetH, drawIn: fakeDrawIn });
  assert.equal(spec.state(), "97%", "30,000 of 31,000 read from the cache");
  assert.equal(spec.tone?.(), "");
  assert.match(String(spec.title?.()), /read 97% of its prompt from the provider's cache/);
  const { pops } = openWidget(spec);
  await new Promise((r) => setTimeout(r, 0));
  const text = textOf(pops[0].body);
  for (const bit of ["Cache", "Five-minute prompt cache", "97|%", "last request", "Warm · 4:00 left", "Session average", "90%", "Saved so far", "$0.80", "Next turn", "~100%", "Filament never rewrites a past turn", "Last request", "31K tokens", "Read from cache", "Written to cache", "New input", "Hit rate by turn", "2 turns", "A cached token costs 5% of a new one"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
  // A poor hit rate after the first request warns; the first request never does (it writes the cache).
  const cold = cacheWidget(ctxOf({ settings: { usage: { ...usage, last: { ...usage.last, cacheRead: 100, cacheWrite: 30000 } } } }), { h: widgetH, drawIn: fakeDrawIn });
  assert.equal(cold.tone?.(), "warn");
  const first = cacheWidget(ctxOf({ settings: { usage: { ...usage, requests: 1, last: { ...usage.last, cacheRead: 0, cacheWrite: 30000 } } } }), { h: widgetH, drawIn: fakeDrawIn });
  assert.equal(first.tone?.(), "");
  assert.equal(cacheWidget(ctxOf({ settings: {} }), { h: widgetH, drawIn: fakeDrawIn }).state(), "—", "no request yet");
});

// (fails before: yes — the owner's report of 10-26: all through a running turn the pill said 75%, the last turn's record,
// which sums every call of a coding agent's turn, while each call read near all of its prompt from the cache)
test("the cache instrument follows the running turn: each model call its run says is the last request until the ledger books a newer one; the record stands in only where nothing counted", async () => {
  const now = Date.now();
  const usage = { usd: 0.3, requests: 5, input: 1000, output: 3000, cacheRead: 90000, cacheWrite: 9000, savedUsd: 0.8, last: { at: now - 60_000, input: 100, cacheRead: 30000, cacheWrite: 900, output: 200 } };
  const view = /** @type {any} */ ({ settings: { usage, effective: { context: { results: "keep" } } } });
  const live = /** @type {any} */ ({ rec: { tokens: { input: 8, cacheRead: 603_000, cacheWrite: 203_000 } }, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: true, agent: true, call: null });
  const spec = cacheWidget(ctxOf(view, { live: () => live, preview: async () => null }), { h: widgetH, drawIn: fakeDrawIn });
  assert.equal(spec.state(), "97%", "before the turn's first call: the ledger's newest request, not the record's sum (75%)");
  // The turn's calls, as its run says them (`round-cache`, read by callOf), each with the lifetime the agent's writes
  // asked for (`ttlMs`, its provider's split of them): the clock's.
  live.call = callOf({ type: "round-cache", round: 1, input: 6, cacheRead: 98_000, cacheWrite: 2000, ttlMs: 300_000, ts: now - 1000 });
  assert.equal(spec.state(), "98%");
  const { pops } = openWidget(spec);
  await new Promise((r) => setTimeout(r, 0));
  const text = textOf(pops[0].body);
  for (const bit of ["98|%", "Warm · 4:5", "100K tokens", "98K", "2K"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
  live.call = callOf({ type: "round-cache", round: 2, input: 4, cacheRead: 60_000, cacheWrite: 40_000, ts: now });
  assert.equal(spec.state(), "60%", "every call moves it");
  // The turn over, the ledger refreshed: a newer booked request wins; one older than the call heard does not.
  view.settings.usage = { ...usage, last: { at: now + 5000, input: 10, cacheRead: 99_000, cacheWrite: 990 } };
  assert.equal(spec.state(), "99%");
  view.settings.usage = { ...usage, last: { at: now - 5000, input: 10, cacheRead: 99_000, cacheWrite: 990 } };
  assert.equal(spec.state(), "60%");
  // Nothing counted anywhere: the reply's record stands in.
  live.call = null;
  view.settings.usage = /** @type {any} */ ({ ...usage, last: null });
  assert.equal(spec.state(), "75%");
  assert.equal(callOf({ type: "round-cache", input: 0, cacheRead: 0, cacheWrite: 0 }), null, "a call that counted no prompt is none");
  assert.deepEqual(callOf({ input: 3, cacheRead: 1, cacheWrite: 0 }, 42), { input: 3, cacheRead: 1, cacheWrite: 0, at: 42 }, "an event the log gave no time: the page's now");
});

// (fails before: yes — the owner's look of 10-31: a lead waiting an hour inside its turn on a sub-agent showed "Cache 100%
// warm 60 min", the minutes standing still, though nothing had read the cache since its last call)
test("the cache instrument counts down while a turn runs: from the turn's newest use — its start, a call, its model writing — and a turn idle past the cache's life reads cold", () => {
  const now = Date.now();
  const usage = { usd: 0.3, requests: 5, input: 1000, output: 3000, cacheRead: 90000, cacheWrite: 9000, savedUsd: 0.8, last: { at: now - 3 * 3_600_000, input: 100, cacheRead: 30000, cacheWrite: 900, output: 200 } };
  const view = /** @type {any} */ ({ settings: { usage, effective: { context: { results: "keep" } } } });
  const call = callOf({ type: "round-cache", round: 9, input: 6, cacheRead: 98_000, cacheWrite: 2000, ttlMs: 3_600_000, ts: now - 61 * 60_000 });
  const live = /** @type {any} */ ({ rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: true, agent: true, call, usedAt: now - 62 * 60_000 });
  const spec = cacheWidget(ctxOf(view, { live: () => live, preview: async () => null }), { h: widgetH, drawIn: fakeDrawIn });
  assert.equal(spec.more?.(), "gone cold", "its last call an hour and a minute ago, an hour's cache: cold, though the turn still runs");
  assert.equal(spec.marks?.().cold, true);
  live.usedAt = now - 5 * 60_000;
  assert.equal(spec.more?.(), "warm 55 min", "its model wrote five minutes ago: the hour runs from there");
  live.usedAt = null;
  live.call = { ...call, at: now - 20 * 60_000 };
  assert.equal(spec.more?.(), "warm 40 min", "and from its newest call");
});

// (fails before: yes — the owner's words of 10-29: the cache's lifetime was the route's alone, and a coding agent's
// hour-long cache read as five minutes)
test("the cache's lifetime: the popover chooses 5 min or 1 hour for the chat's next turn where Filament adds the markers; a coding agent's is what its own calls said", async () => {
  const now = Date.now();
  const usage = { usd: 0.3, requests: 5, input: 1000, output: 3000, cacheRead: 90000, cacheWrite: 9000, savedUsd: 0.8, last: { at: now - 20 * 60_000, input: 100, cacheRead: 30000, cacheWrite: 900, output: 200 } };
  /** @type {any[]} */
  const writes = [];
  const view = /** @type {any} */ ({ settings: { usage, effective: { context: { results: "keep" } }, cache: { ttl: "5m", from: "rules", settable: true } } });
  // The last turn's writes, as its provider split them: five minutes' (none an hour's).
  let turns = [{ n: 1, facts: { tokens: { input: 100, cacheRead: 0, cacheWrite: 900, cacheWrite1h: 0 } } }];
  const spec = cacheWidget(ctxOf(view, { write: (/** @type {any} */ c) => writes.push(c), turns: () => turns }), { h: widgetH, drawIn: fakeDrawIn });
  assert.equal(spec.more?.(), "gone cold", "five minutes from the newest request, twenty minutes ago");
  const { pops } = openWidget(spec);
  const choices = buttonsOf(pops[0].body).filter((b) => b.attrs.role === "radio");
  assert.deepEqual(choices.map((b) => [textOf(b), b.attrs["aria-checked"]]), [["5 min", "true"], ["1 hour", "false"]]);
  assert.ok(textOf(pops[0].body).includes("Writes cost 1.25× the input price"));
  choices[1].dispatch("click");
  assert.deepEqual(writes, [{ patch: { model: { cacheTtl: "1h" } } }], "the chat's setting, which its next turn reads");
  view.settings.cache = { ttl: "1h", from: "chat", settable: true };
  // (fails before: yes — the review of 10-29: the switch read the cache the last turn left as an hour's)
  assert.equal(spec.more?.(), "gone cold", "the hour is the next turn's: the cache the last turn left was five minutes'");
  turns = [...turns, { n: 2, facts: { tokens: { input: 100, cacheRead: 900, cacheWrite: 80, cacheWrite1h: 80 } } }];
  assert.equal(spec.more?.(), "warm 40 min", "a turn that wrote an hour's cache: counted an hour from the newest request");
  // A model whose markers Filament does not add (another format, or markers off): no choice to offer.
  view.settings.cache = { ttl: "5m", from: "rules", settable: false };
  assert.ok(!buttonsOf(openWidget(spec).pops[0].body).some((b) => b.attrs.role === "radio"));
  // A coding agent's own markers: said, not chosen — Claude Code's hour on a subscription.
  const agentView = /** @type {any} */ ({ settings: { usage, effective: { context: { results: "keep" } }, cache: { ttl: "5m", from: "rules", settable: false } } });
  const live = /** @type {any} */ ({ rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false, agent: true, call: callOf({ type: "round-cache", round: 1, input: 6, cacheRead: 98_000, cacheWrite: 2000, ttlMs: 3_600_000, ts: now - 20 * 60_000 }) });
  const agentSpec = cacheWidget(ctxOf(agentView, { live: () => live }), { h: widgetH, drawIn: fakeDrawIn });
  assert.equal(agentSpec.more?.(), "warm 40 min");
  const agentPop = openWidget(agentSpec).pops[0].body;
  for (const bit of ["One-hour prompt cache", "Cache lifetime", "Set by the agent's own requests", "1 hour"]) assert.ok(textOf(agentPop).includes(bit), `${bit} in ${textOf(agentPop)}`);
  assert.ok(!buttonsOf(agentPop).some((b) => b.attrs.role === "radio"), "nothing to choose");
});

// (fails before: yes — the Designer's review of 10-24: the tile said "0 busts so far", the builder's word)
test("the cache tile says the turns that read it cold in plain words, what a miss is on hover", () => {
  const usage = { usd: 0.3, requests: 3, input: 1000, output: 3000, cacheRead: 40000, cacheWrite: 9000, last: { at: Date.now() - 60_000, input: 100, cacheRead: 30000, cacheWrite: 900, output: 200 } };
  const write = { n: 1, facts: { tokens: { input: 500, cacheRead: 0, cacheWrite: 8000 } } };
  const warm = { n: 2, facts: { tokens: { input: 100, cacheRead: 20000, cacheWrite: 1000 } } };
  const cold = { n: 3, facts: { tokens: { input: 100, cacheRead: 100, cacheWrite: 20000 } } };
  const lines = (/** @type {any[]} */ turns) => {
    const tile = cacheWidget(ctxOf({ settings: { usage } }, { turns: () => turns }), { h: widgetH, drawIn: fakeDrawIn }).tile?.(widgetH, "L", { open: () => {} }) || [];
    return /** @type {any[]} */ (tile)[0].kids[1].kids;
  };
  assert.equal(textOf(lines([write, warm]).at(-1)), "No turn missed it", "the first turn writes it: no miss");
  const missed = lines([write, warm, cold]).at(-1);
  assert.deepEqual([textOf(missed), missed.attrs.title], ["1 turn missed it", "Turns after the first whose request read less than half its prompt from the cache: each paid for most of it anew"]);
  assert.equal(textOf(lines([write, cold, cold]).at(-1)), "2 turns missed it");
});

test("warmthOf: the main agent's cache state when the page has it, else counted from the newest request; hitOf is the share of the prompt read", () => {
  const now = 1_000_000_000;
  assert.deepEqual(warmthOf({ state: "warm", leftMs: 125_000, ttlMs: 300_000 }, null, now), { warm: true, leftMs: 125_000, ttlMs: 300_000, words: "Warm · 2:05 left" });
  assert.equal(warmthOf({ state: "none", leftMs: 0, ttlMs: 0 }, now - 30_000, now).words, "Warm · 4:30 left", "five minutes from the newest request");
  assert.equal(warmthOf({ state: "none", leftMs: 0, ttlMs: 0 }, now - 12 * 60_000, now).words, "Cold — expired 7 min ago");
  assert.equal(warmthOf({ state: "cold", leftMs: 0, ttlMs: 300_000 }, now - 30_000, now).warm, false, "the registry's cold wins over the clock");
  assert.equal(warmthOf({ state: "uncached", leftMs: 0, ttlMs: 0 }, now, now).words, "Not cached");
  assert.equal(warmthOf({ state: "none", leftMs: 0, ttlMs: 0 }, null, now).words, "Waiting for a reply");
  assert.equal(warmthOf({ state: "none", leftMs: 0, ttlMs: 3_600_000 }, now - 30 * 60_000, now).words, "Warm · 30:00 left", "an hour's cache counts an hour");
  // A turn in flight uses the cache as it starts, at each call and while its model writes (`lastAt` counts those);
  // between them its life runs down as any other time's.
  assert.deepEqual(warmthOf({ state: "none", leftMs: 0, ttlMs: 0 }, null, now, { inFlight: true }), { warm: true, leftMs: 300_000, ttlMs: 300_000, words: "In use by this turn" }, "no use counted yet: its first request reads it now");
  assert.equal(warmthOf({ state: "none", leftMs: 0, ttlMs: 0 }, now - 30_000, now, { inFlight: true, ttlMs: 3_600_000 }).words, "Warm · 59:30 left", "an hour's cache, counted from the turn's newest use");
  assert.deepEqual(warmthOf({ state: "none", leftMs: 0, ttlMs: 0 }, now - 61 * 60_000, now, { inFlight: true, ttlMs: 3_600_000 }), { warm: false, leftMs: 0, ttlMs: 3_600_000, words: "Cold — expired 1 min ago" }, "a turn idle past its cache's life — waiting on a sub-agent an hour — reads it cold");
  assert.equal(warmthOf({ state: "cold", leftMs: 0, ttlMs: 300_000 }, now - 30_000, now, { inFlight: true }).words, "Warm · 4:30 left", "the turn's newest use is newer than a state taken before it");
  assert.equal(warmthOf({ state: "uncached", leftMs: 0, ttlMs: 0 }, now, now, { inFlight: true }).words, "Not cached", "a model that is not cached stays so");
  assert.equal(hitOf({ input: 10, cacheRead: 80, cacheWrite: 10 }), 0.8);
  assert.equal(hitOf({ input: 0, cacheRead: 0, cacheWrite: 0 }), null);
});

test("the next turn's cache, predicted: the whole history carries over between compactions; the compaction line starts cold", () => {
  assert.deepEqual(predictNextRead({ carried: 0.96 }), { share: 0.96, words: "Filament never rewrites a past turn between compactions, so the whole history carries over from the cache." });
  assert.deepEqual(predictNextRead({ carried: 0.96, wouldCompact: true }), { share: 0.03, words: "The next turn crosses the compaction line and restarts from a summary, so it starts cold." });
  assert.equal(predictNextRead({ carried: null }).share, null, "no request yet");
  // An expired cache serves nothing — the last request's 96% was last time's, not the next turn's.
  assert.deepEqual(predictNextRead({ carried: 0.96, cold: true, ttlMin: 5 }), { share: 0, words: "The cache has expired, so the next turn writes the whole prompt again. Sending within 5 minutes of a request keeps it warm." });
  assert.equal(predictNextRead({ carried: 0.96, uncached: true }).share, 0, "a model that is not cached");
  assert.equal(predictNextRead({ carried: 0.96, cold: true, wouldCompact: true }).share, 0.03, "the compaction line says it first");
  // A cold start (after a compaction, or the session's first request) read nothing and wrote the prefix: the next
  // turn reads what it wrote — the last hit rate (0%) would have predicted the opposite of what happens.
  const coldStart = { input: 130, cacheRead: 0, cacheWrite: 3100 };
  assert.equal(hitOf(coldStart), 0);
  assert.equal(carriedOf(coldStart), 3100 / 3230);
  assert.equal(Math.round(/** @type {number} */ (predictNextRead({ carried: carriedOf(coldStart) }).share) * 100), 96);
  assert.equal(carriedOf({ input: 0, cacheRead: 0, cacheWrite: 0 }), null);
});

test("the cache instrument predicts from the warmth now: an expired cache reads ~0% in orange, and the card redraws the moment the countdown runs out", async () => {
  const at = Date.now() - 20 * 60_000;
  const usage = { usd: 0.3, requests: 5, input: 1000, output: 3000, cacheRead: 90000, cacheWrite: 9000, savedUsd: 0.8, last: { at, input: 100, cacheRead: 30000, cacheWrite: 900, output: 200 } };
  const view = { settings: { usage, cache: MARKED, effective: { context: { results: "keep" } } } };
  const spec = cacheWidget(ctxOf(view, { preview: async () => ({ current: { perTurn: [], wouldCompact: false } }) }), { h: widgetH, drawIn: fakeDrawIn });
  const { pops } = openWidget(spec);
  await new Promise((r) => setTimeout(r, 0));
  const text = textOf(pops[0].body);
  for (const bit of ["Cold — expired 15 min ago", "~0%", "The cache has expired"]) assert.ok(text.includes(bit), `${bit} in ${text}`);
  assert.equal(text.includes("~97%"), false, "never last time's rate on a cold cache");
  const card = (/** @type {any} */ (pops[0].body)).querySelector("inst-predict");
  assert.ok(card?.classList.contains("is-warn"), "a poor prediction wears the warning color");
});

test("the cache popover's clock: the warmth counts down while it is open, the prediction redraws the moment the cache goes cold, and the timer ends with the popover", async (t) => {
  const start = 1_000_000_000_000;
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: start });
  const usage = { usd: 0.3, requests: 5, input: 1000, output: 3000, cacheRead: 90000, cacheWrite: 9000, savedUsd: 0.8, last: { at: start - 298_000, input: 100, cacheRead: 30000, cacheWrite: 900, output: 200 } };
  const spec = cacheWidget(ctxOf({ settings: { usage, cache: MARKED, effective: { context: { results: "keep" } } } }, { preview: async () => null }), { h: widgetH, drawIn: fakeDrawIn });
  const { pops } = openWidget(spec);
  const body = /** @type {any} */ (pops[0].body);
  const root = body.querySelector("inst-cache");
  root.isConnected = true;
  assert.ok(textOf(body).includes("Warm · 0:02 left"));
  assert.ok(textOf(body).includes("~100%"), "warm: the next turn reads what the last one left");
  t.mock.timers.tick(1000);
  assert.ok(textOf(body).includes("Warm · 0:01 left"), "the countdown ticks");
  t.mock.timers.tick(2000);
  assert.ok(textOf(body).includes("Cold — expired 1 min ago"), textOf(body));
  assert.ok(textOf(body).includes("~0%"), "the prediction followed the warmth without a reopen");
  assert.ok(body.querySelector("inst-predict")?.classList.contains("is-warn"));
  // Closed: the next tick ends the timer, and nothing redraws after it.
  root.isConnected = false;
  t.mock.timers.tick(1000);
  usage.last.at = Date.now();
  t.mock.timers.tick(5000);
  assert.ok(textOf(body).includes("~0%"), "no repaint once the popover is gone");
});
