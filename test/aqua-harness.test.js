// @ts-check
// The harness's Aqua pass (HarnessV3 §15 item 92): the model helpers the picker and the tuning chip stand on — names in
// words, the level a switch of model keeps, what a choice writes (explicit values, only what moves), what "Use the
// defaults" unsets, the chip's face — the create call's held tuning, and the stylesheet's hygiene.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prettyModel, vendorOf, windowWords, fitLevel, needsThinking, locate, tuningOf, memberFor, planWrite, planReset, tuningFace, fastWords, priceLine, windowAgainst, TUNING_PATHS } from "../src/ui/harness/lib/families.js";
import { sessionStartBody } from "../src/ui/harness/session-start.js";
import { lastTuning, LEVELS, splitEffortLane } from "../src/ui/harness/composer/effort.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (/** @type {string} */ f) => readFileSync(join(ROOT, f), "utf8");

/** A model Filament tunes itself: every axis a setting. @returns {any} */
const opus = () => ({
  id: "claude-opus-5-5", upstream: "a", kind: "model",
  members: [{ id: "claude-opus-5-5", effort: null, speed: null, thinking: null, window: null }],
  effort: { via: "setting", levels: ["low", "medium", "high", "xhigh", "max"], default: "high", capWithoutThinking: "high" },
  speed: { via: "setting", options: ["standard", "fast"], multiplier: 2 },
  thinking: { via: "setting", options: ["off", "on"] },
  window: { via: "setting", options: [200000, 1000000], standard: 200000 },
});
/** A family whose ids carry the effort and the speed. @returns {any} */
const gpt = () => ({
  id: "gpt-9", upstream: "o", kind: "variants",
  members: [
    { id: "gpt-9", effort: null, speed: null, thinking: null, window: null },
    { id: "gpt-9-low", effort: "low", speed: null, thinking: null, window: null },
    { id: "gpt-9-high", effort: "high", speed: null, thinking: null, window: null },
    { id: "gpt-9-high-fast", effort: "high", speed: "fast", thinking: null, window: null },
  ],
  effort: { via: "name", levels: ["low", "high"], plain: true, default: null },
  speed: { via: "name", options: ["standard", "fast"] },
  thinking: null, window: null,
});
/** A coding agent's family whose ids carry thinking. @returns {any} */
const cursorOpus = () => ({
  id: "cursor/claude-opus-5", upstream: "cur", kind: "variants", codingAgent: true,
  members: [
    { id: "cursor/claude-opus-5", effort: null, speed: null, thinking: null, window: null },
    { id: "cursor/claude-opus-5-thinking", effort: null, speed: null, thinking: "on", window: null },
  ],
  effort: null, speed: null, thinking: { via: "name", options: ["off", "on"] }, window: null,
});
/** @returns {any} */
const bare = () => ({ id: "qwen-3", upstream: "q", kind: "model", members: [{ id: "qwen-3", effort: null, speed: null, thinking: null, window: null }], effort: null, speed: null, thinking: null, window: null });

test("names read as names: versions joined, brands spelled their way, a window in words", () => {
  assert.equal(prettyModel("claude-opus-5-5"), "Claude Opus 5.5");
  assert.equal(prettyModel("claude-sonnet-4-6-20260101"), "Claude Sonnet 4.6", "the date stamp goes");
  assert.equal(prettyModel("gpt-5.5"), "GPT-5.5");
  assert.equal(prettyModel("glm-5.3"), "GLM-5.3");
  assert.equal(prettyModel("claude-code/opus[1m]"), "Opus · 1M", "the route's prefix goes, the window reads as words");
  assert.equal(prettyModel("kimi-k3-fast"), "Kimi K3 Fast");
  assert.equal(vendorOf("claude-opus-5-5").key, "anthropic");
  assert.equal(vendorOf("grok-4.7").key, "xai");
  assert.equal(windowWords(200000), "200K");
  assert.equal(windowWords(1000000), "1M");
  assert.equal(windowWords(1500000), "1.5M");
  assert.equal(windowWords(0), "");
});

test("a switch of model keeps the spirit of the level: the highest it takes under the wanted one, else its lowest", () => {
  assert.equal(fitLevel(["low", "medium", "high"], "max"), "high", "Max on Opus is High on a model whose top is High");
  assert.equal(fitLevel(["low", "medium", "high", "xhigh", "max"], "xhigh"), "xhigh");
  assert.equal(fitLevel(["medium", "high"], "low"), "medium", "below the lowest offered: the lowest");
  assert.equal(fitLevel([], "high"), null, "a model with no levels takes none");
  assert.equal(fitLevel(["low", "high"], null), null, "Auto stays Auto");
  assert.equal(fitLevel(["high", "low"], "medium"), "low", "the offered order does not matter");
});

test("the levels a model runs capped without extended thinking are known — only where it has a thinking switch", () => {
  const f = opus();
  assert.equal(needsThinking(f, "xhigh"), true);
  assert.equal(needsThinking(f, "max"), true);
  assert.equal(needsThinking(f, "high"), false, "the cap itself runs as asked");
  assert.equal(needsThinking(f, null), false);
  assert.equal(needsThinking({ ...f, thinking: null }, "max"), false, "no switch to turn: nothing is marked");
  assert.equal(needsThinking({ ...f, effort: { ...f.effort, capWithoutThinking: undefined } }, "max"), false);
});

test("a stored name finds its family: whole, behind the loop's prefix, or an older session's suffixed name", () => {
  const fams = [opus(), gpt(), bare()];
  assert.equal(locate(fams, "claude-opus-5-5")?.family.id, "claude-opus-5-5");
  assert.equal(locate(fams, "agent/claude-opus-5-5")?.family.id, "claude-opus-5-5");
  assert.equal(locate(fams, "gpt-9-high-fast")?.member.id, "gpt-9-high-fast", "a member id is found whole");
  const old = locate(fams, "claude-opus-5-5-high");
  assert.equal(old?.family.id, "claude-opus-5-5");
  assert.deepEqual(old?.fromName, { effort: "high" }, "the suffix is read back as the tuning it asked for");
  assert.equal(locate(fams, "nobody-knows-me"), null);
});

test("the tuning in force: a tuned model's settings, a family of ids' member", () => {
  const f = opus();
  const at = /** @type {any} */ (locate([f], "claude-opus-5-5"));
  assert.deepEqual(tuningOf(at, { effort: "max", fast: true, window: 1000000, thinkingBudget: 16000 }), { effort: "max", speed: "fast", thinking: "on", window: 1000000 });
  assert.deepEqual(tuningOf(at, {}), { effort: null, speed: "standard", thinking: "off", window: 0 });
  const g = gpt();
  const atG = /** @type {any} */ (locate([g], "gpt-9-high-fast"));
  assert.deepEqual(tuningOf(atG, { effort: "low" }), { effort: "high", speed: "fast", thinking: "off", window: 0 }, "the member's own name wins over a setting");
  assert.equal(memberFor(g, { effort: "high", speed: "standard", thinking: "off", window: 0 }).id, "gpt-9-high");
  assert.equal(memberFor(g, { effort: "low", speed: "fast", thinking: "off", window: 0 }, "speed").id, "gpt-9-high-fast", "the axis just changed wins when no member has both");
});

test("a choice writes explicit values, only what moves — an Auto over a preset's level is an explicit null", () => {
  const f = opus();
  const eff = { name: "claude-opus-5-5", effort: null, fast: false, window: null, thinking: { budget: null } };
  assert.deepEqual(planWrite(f, { effort: "max", speed: "standard", thinking: "on", window: 0 }, { eff }).patch,
    { model: { effort: "max", thinking: { budget: 16000 } } }, "the name the session already runs is not written again");
  assert.deepEqual(planWrite(f, { effort: null, speed: "standard", thinking: "off", window: 0 }, { eff: { ...eff, effort: "high" } }).patch,
    { model: { effort: null } }, "Auto over an inherited level is written as null: it overrides the layer below");
  assert.equal(planWrite(f, { effort: null, speed: "standard", thinking: "off", window: 0 }, { eff }).patch, null, "nothing moved: nothing is written");
  assert.deepEqual(planWrite(f, { effort: null, speed: "fast", thinking: "off", window: 1000000 }, { eff }).patch, { model: { fast: true, window: 1000000 } });
  assert.deepEqual(planWrite(f, { effort: null, speed: "standard", thinking: "off", window: 200000 }, { eff: { ...eff, window: 1000000 } }).patch,
    { model: { window: null } }, "the standard window is written as null");
  assert.deepEqual(planWrite(f, { effort: "none", speed: "standard", thinking: "off", window: 0 }, { eff: { ...eff, effort: "low" } }).patch,
    { model: { effort: null } }, "a level the model does not take is never written");
  assert.deepEqual(planWrite(f, { effort: null, speed: "standard", thinking: "on", window: 0 }, { eff, thinkingBudget: 32000 }).patch,
    { model: { thinking: { budget: 32000 } } }, "the session's own budget is kept");
});

test("a family whose ids carry an axis neutralizes the setting for it (a standing model.effort would re-suffix the member)", () => {
  const g = gpt();
  const plan = planWrite(g, { effort: "high", speed: "fast", thinking: "off", window: 0 }, { eff: { name: "claude-opus-5-5", effort: "max", fast: true, window: 1000000 } });
  assert.equal(plan.name, "gpt-9-high-fast");
  assert.deepEqual(plan.patch, { model: { name: "gpt-9-high-fast", effort: null, fast: false, window: null } });
});

test("a family whose ids carry thinking clears a standing budget: the plain member would think while the chip reads off", () => {
  const f = cursorOpus();
  const eff = { name: "cursor/claude-opus-5", thinking: { budget: 16000 } };
  assert.deepEqual(planWrite(f, { effort: null, speed: "standard", thinking: "off", window: 0 }, { eff }).patch, { model: { thinking: { budget: null } } });
  assert.deepEqual(planWrite(f, { effort: null, speed: "standard", thinking: "on", window: 0 }, { eff }).patch,
    { model: { name: "cursor/claude-opus-5-thinking", thinking: { budget: null } } }, "thinking is the member's name, never a budget beside it");
  assert.equal(planWrite(f, { effort: null, speed: "standard", thinking: "off", window: 0 }, { eff: { name: "cursor/claude-opus-5" } }).patch, null);
});

test("the chip names the level the wire sends: a stored level fitted to the model, capped while thinking is off", () => {
  const f = opus();
  const at = { family: f, member: f.members[0], fromName: {} };
  assert.equal(tuningOf(at, { effort: "max", thinkingBudget: 16000 }).effort, "max");
  assert.equal(tuningOf(at, { effort: "max" }).effort, "high", "Opus takes Max only with thinking: the rules send High");
  assert.equal(tuningOf(at, { effort: "xhigh" }).effort, "high");
  assert.equal(tuningOf(at, { effort: "medium" }).effort, "medium");
  const grok = { ...opus(), id: "grok-4.7", effort: { via: "setting", levels: ["low", "medium", "high"], default: "high" }, thinking: null };
  const atG = { family: grok, member: grok.members[0], fromName: {} };
  assert.equal(tuningOf(atG, { effort: "max" }).effort, "high", "a level the model does not take reads as the one the wire clamps to");
  assert.equal(tuningOf(atG, { effort: "none" }).effort, "low");
  assert.equal(tuningOf({ family: bare(), member: bare().members[0], fromName: {} }, { effort: "max" }).effort, null, "no levels: no level");
});

test("a lane is split only from a name no family holds whole", () => {
  const known = (/** @type {string} */ id) => ["qwen3", "qwen3-max", "claude-opus-5-5", "cursor/grok-4.7", "cursor/grok-4.7-high"].includes(id);
  const fam = (/** @type {string} */ id, /** @type {string[]} */ ids = [id]) => ({ ...opus(), id, kind: ids.length > 1 ? "variants" : "model", members: ids.map((m) => ({ id: m, effort: null, speed: null, thinking: null, window: null })) });
  const families = [fam("qwen3"), fam("qwen3-max"), fam("claude-opus-5-5"), fam("cursor/grok-4.7", ["cursor/grok-4.7", "cursor/grok-4.7-high"])];
  assert.equal(splitEffortLane("qwen3-max", known, families), null, "the provider's qwen3-max is a model, not Qwen 3 at Max");
  assert.equal(splitEffortLane("cursor/grok-4.7-high", known, families), null, "a member's own id is not a lane");
  assert.deepEqual(splitEffortLane("claude-opus-5-5-high", known, families), { base: "claude-opus-5-5", effort: "high" }, "a suffixed name splits");
  assert.deepEqual(splitEffortLane("qwen3-max", known), { base: "qwen3", effort: "max" }, "before the families land, the catalogue's rule stands");
});

test("Use the defaults unsets only what the session's own layer holds, and puts a family of ids back on its plain member", () => {
  assert.deepEqual(TUNING_PATHS, ["model.effort", "model.fast", "model.flex", "model.window", "model.thinking.budget"]);
  const r = planReset(opus(), { eff: { name: "claude-opus-5-5" }, own: new Set(["model.effort", "model.fast", "loop.permissions"]) });
  assert.deepEqual(r, { name: "claude-opus-5-5", patch: null, unset: ["model.effort", "model.fast"] });
  const g = planReset(gpt(), { eff: { name: "gpt-9-high-fast" }, own: new Set() });
  assert.deepEqual(g, { name: "gpt-9", patch: { model: { name: "gpt-9" } }, unset: [] });
  // A catalogue that lists only levelled ids has no plain level to go back to: the running level stays, only what
  // has a default (the speed) goes back — never the first-listed member.
  const ids = () => ({ ...gpt(), id: "x/grok-4.7", members: [
    { id: "x/grok-4.7-low", effort: "low", speed: null, thinking: null, window: null },
    { id: "x/grok-4.7-high", effort: "high", speed: null, thinking: null, window: null },
    { id: "x/grok-4.7-high-fast", effort: "high", speed: "fast", thinking: null, window: null },
  ], effort: { via: "name", levels: ["low", "high"], plain: false, default: null } });
  assert.deepEqual(planReset(ids(), { eff: { name: "x/grok-4.7-high" } }), { name: "x/grok-4.7-high", patch: null, unset: [] });
  assert.deepEqual(planReset(ids(), { eff: { name: "x/grok-4.7-high-fast" } }), { name: "x/grok-4.7-high", patch: { model: { name: "x/grok-4.7-high" } }, unset: [] });
  assert.equal(planReset(ids(), { eff: { name: "agent/x/grok-4.7-low" } }).patch, null, "the loop's prefix names the same member");
});

test("the chip's face: the meter out of the model's own levels, the words, the badges — hidden with nothing to tune", () => {
  const f = opus();
  assert.deepEqual(tuningFace(f, { effort: "high", speed: "fast", thinking: "on", window: 1000000 }), { show: true, lit: 3, of: 5, label: "High", fast: true, thinking: true, window: "1M" });
  assert.equal(tuningFace(f, { effort: null, speed: "standard", thinking: "off", window: 200000 }).label, "Auto");
  assert.equal(tuningFace(f, { effort: null, speed: "standard", thinking: "off", window: 200000 }).window, "", "the standard window earns no badge");
  assert.equal(tuningFace(bare(), { effort: null, speed: "standard", thinking: "off", window: 0 }).show, false, "nothing to tune: no face");
  assert.equal(tuningFace(null, null).show, false);
  const speedOnly = { ...bare(), speed: { via: "name", options: ["standard", "fast"] } };
  assert.equal(tuningFace(/** @type {any} */ (speedOnly), { effort: null, speed: "standard", thinking: "off", window: 0 }).label, "Standard", "a model with only a speed says its speed");
});

test("fast mode in the Speed section's words: what it buys on its wire, and what it costs — price, quota, or more", () => {
  const fam = (/** @type {any} */ speed, /** @type {any} */ more = {}) => /** @type {any} */ ({ ...bare(), speed, ...more });
  // On a subscription plan (Providers P4) the multiplier spends the plan's usage, priced or not.
  const plan = { billing: "plan", price: { input: 4, output: 20 } };
  assert.equal(fastWords(fam({ via: "setting", options: ["standard", "fast"], multiplier: 2, wire: "anthropic" }, plan)), "up to 2.5× faster output, 2× your plan's usage");
  assert.equal(fastWords(fam({ via: "setting", options: ["standard", "fast"], multiplier: 2, wire: "openai" }, { billing: "plan" })), "the provider's priority lane, 2× your plan's usage when it is served there");
  assert.equal(priceLine(fam(null, { price: { input: 3, output: 15 } })), "$3 in · $15 out per million");
  assert.equal(priceLine(fam(null, { ...plan, price: { input: 3, output: 15 } })), "On your plan · $3 in · $15 out per million at list price");
  assert.equal(priceLine(fam(null, { billing: "plan" })), "On your plan", "a plan model nobody prices");
  assert.equal(priceLine(fam(null, { codingAgent: true, price: { input: 3, output: 15 } })), "Coding agent");
  assert.equal(priceLine(fam(null, {})), "");
  assert.equal(windowAgainst(fam(null, {})), "the cheapest window");
  assert.equal(windowAgainst(fam(null, { billing: "plan" })), "your plan's usage of the cheapest window");
  assert.equal(fastWords(fam({ via: "setting", options: ["standard", "fast"], multiplier: 2, wire: "anthropic" }, { price: { input: 4, output: 20 } })), "up to 2.5× faster output, billed at 2× the price");
  assert.equal(fastWords(fam({ via: "setting", options: ["standard", "fast"], multiplier: 2, wire: "openai" }, { price: { input: 2, output: 6 } })), "the provider's priority lane, billed at 2× the price when it is served there", "xAI's priority tier is no 2.5× promise, and bills fast only when the reply says so");
  assert.equal(fastWords(fam({ via: "setting", options: ["standard", "fast"], multiplier: 2, wire: "openai" })), "the provider's priority lane, 2× a standard request (2× your plan's quota, if you are on one)", "unpriced: the number still counts");
  assert.equal(fastWords(fam({ via: "name", options: ["standard", "fast"], multiplier: 2 }, { codingAgent: true })), "the provider's faster variant of this model, 2× your plan's quota");
  assert.equal(fastWords(fam({ via: "setting", options: ["standard", "fast"], wire: "openai" })), "the provider's priority lane, at a higher price than standard", "nobody states the multiplier");
  assert.equal(fastWords(fam({ via: "setting", options: ["standard", "fast"], multiplier: 1, wire: "anthropic" }, { price: { input: 4, output: 20 } })), "up to 2.5× faster output, at the standard price", "a multiplier of 1 is no surcharge");
});

test("the effort control's levels are still model.effort's, and a fresh browser's last tuning is the defaults", () => {
  assert.deepEqual(LEVELS.map((l) => l.id), ["", "low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(lastTuning(), { effort: null, speed: "standard", thinking: "off", window: 0 });
});

// (fails before: yes — a remembered effort with a leading "-", which only an earlier build wrote, was read as its
// level; HarnessV3-AtHome AH-C1)
test("a remembered effort is read as this build writes it: a level by its own name, else none", () => {
  /** @type {Map<string, string>} */
  const saved = new Map();
  /** @type {any} */ (globalThis).localStorage = { getItem: (/** @type {string} */ k) => saved.get(k) ?? null, setItem: () => {} };
  try {
    saved.set("filament.harness.lastEffort", "high");
    assert.equal(lastTuning().effort, "high");
    saved.set("filament.harness.lastEffort", "-high");
    assert.equal(lastTuning().effort, null);
  } finally {
    delete (/** @type {any} */ (globalThis).localStorage);
  }
});

test("the create call carries the held tuning — never over the board's changes of the same knob", () => {
  const body = sessionStartBody({}, "C:/p", "claude-opus-5-5", "t", "", "max", { "model.fast": true, "model.window": 1000000, "model.thinking.budget": 16000 });
  assert.deepEqual(body.settings?.model, { effort: "max", fast: true, window: 1000000, thinking: { budget: 16000 } });
  const kept = sessionStartBody({ held: { "model.fast": false } }, "C:/p", "m", "", "", "", { "model.fast": true });
  assert.equal(kept.settings?.model?.fast, false, "the board's change wins");
  const none = sessionStartBody({}, "C:/p", "m", "", "", "", {});
  assert.equal(none.settings, undefined, "nothing held: no settings");
});

test("aqua.css reads only custom properties a harness sheet defines (or the builders set inline), and adds no keyframes twice", () => {
  const aqua = read("src/ui/harness/aqua.css");
  const sheets = [aqua, read("src/ui/harness.css"), read("src/ui/harness/zc.css"), read("src/ui/harness/instruments.css")].join("\n");
  // `--card-tone`: an agent card's colour, set on its row by conversation/agent-card.js (E37).
  const inline = new Set(["--tone", "--tile", "--k", "--n", "--pane-w", "--card-tone"]);
  const used = [...new Set([...aqua.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
  assert.deepEqual(used.filter((v) => !inline.has(v) && !sheets.includes(`${v}:`)), []);
  const kf = [...sheets.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(kf.filter((n, i) => kf.indexOf(n) !== i))], [], "duplicate keyframes across the harness sheets");
  // Both themes declare the same Aqua tokens.
  const theme = (/** @type {string} */ name) => [...(aqua.match(new RegExp(`\\.${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] || "").matchAll(/(--aq-[\w-]+)\s*:/g)].map((m) => m[1]).sort();
  assert.ok(theme("theme-zai-dark").length > 10);
  assert.deepEqual(theme("theme-zai-dark"), theme("theme-zai-light"));
  const own = [...read("src/ui/harness.html").matchAll(/<link rel="stylesheet" href="(\/ui\/[^"]+\.css)"/g)].map((m) => m[1]).filter((p) => !p.includes("/vendor/"));
  assert.equal(own.at(-1), "/ui/harness/aqua.css", "loaded after every harness sheet, over them all");
});

test("a select's list reads in both themes: each option on the theme's solid colour, not a control's fill", () => {
  // (fails before: yes — the move sheet's list drew its options white on white in the dark theme: the system's pop-up
  // painted them on the select's see-through fill, under the page's light text)
  const css = read("src/ui/harness.css");
  const rule = css.match(/select option, select optgroup \{([^}]*)\}/)?.[1] || "";
  assert.match(rule, /background-color: var\(--color-popover\)/);
  assert.match(rule, /color: var\(--color-popover-foreground\)/);
  const block = (/** @type {string} */ sel) => css.match(new RegExp(`\\n${sel} \\{([\\s\\S]*?)\\n\\}`))?.[1] || "";
  for (const sel of ["\\.theme-zai-dark", "\\.theme-zai-light"])
    assert.match(block(sel), /--color-popover: #[0-9a-f]{6};/, `${sel}: a solid popover`);
  const aqua = read("src/ui/harness/aqua.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(aqua, /--color-popover:|(^|[\s,>])option\b[^{};]*\{/m, "aqua.css leaves the options alone");
});
