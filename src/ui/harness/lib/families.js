// @ts-check
// Models as a person reads them (HarnessV3 §15 item 92), DOM-free: a name in words ("claude-opus-5-5" → "Claude
// Opus 5.5"), whose model it is (the tile's mark and hue), the family a session's model belongs to with the tuning it
// carries, and what a choice writes — a member id for a family whose variants are ids, the model.effort /
// model.fast / model.window / thinking settings for a model Filament tunes itself. The families are the server's
// (`/api/models` → `families`, core/model-families.js); nothing here guesses a capability.

/** The levels in display order, each with its words and its short label for the meter. */
export const LEVELS = Object.freeze({
  none: { words: "None", short: "None" },
  minimal: { words: "Minimal", short: "Min" },
  low: { words: "Low", short: "Low" },
  medium: { words: "Medium", short: "Med" },
  high: { words: "High", short: "High" },
  xhigh: { words: "Extra high", short: "X-High" },
  max: { words: "Max", short: "Max" },
});
/** @param {string | null | undefined} id */
export const levelWords = (id) => (id && /** @type {any} */ (LEVELS)[id]?.words) || "Auto";

const BRANDS = Object.freeze({ gpt: "GPT", glm: "GLM", qwen: "Qwen", qwq: "QwQ", deepseek: "DeepSeek", kimi: "Kimi", grok: "Grok", claude: "Claude", gemini: "Gemini", gemma: "Gemma", llama: "Llama", mistral: "Mistral", mixtral: "Mixtral", codestral: "Codestral", nemotron: "Nemotron", minimax: "MiniMax", phi: "Phi", yi: "Yi", gpt4o: "GPT-4o" });
const SMALL = new Set(["for", "of", "and", "with", "the"]);
/** The brands whose version joins with a dash: GPT-5.5, GLM-5.3. */
const DASHED = new Set(["GPT", "GLM"]);

/**
 * A catalogue id as a name: the route's prefix and Cursor's own `cursor-` dropped, a date stamp dropped, Claude's
 * dash-separated version joined with a dot, brands spelled their way. `[1m]` reads as "1M".
 * @param {unknown} id
 */
export function prettyModel(id) {
  let s = String(id || "").split("/").pop() || "";
  s = s.replace(/^cursor-/i, "").replace(/-\d{8}$/, "");
  // The window wherever the id carries it: a coding agent's alias puts its effort after it ("…-5-1[1m]-max").
  const win = /\[(\d+(?:\.\d+)?)([km])\]/i.exec(s);
  if (win) s = s.slice(0, win.index) + s.slice(win.index + win[0].length);
  const parts = s.split(/[-_ ]+/).filter(Boolean);
  /** @type {string[]} */
  const out = [];
  for (const p of parts) {
    const low = p.toLowerCase();
    const prev = out[out.length - 1];
    if (/^\d+$/.test(p) && prev && /^\d+(\.\d+)*$/.test(prev) && out.length >= 2) {
      out[out.length - 1] = `${prev}.${p}`;
      continue;
    }
    if (/^[\d.]+$/.test(p) && prev && DASHED.has(prev)) {
      out[out.length - 1] = `${prev}-${p}`;
      continue;
    }
    const brand = /** @type {any} */ (BRANDS)[low];
    if (brand) { out.push(brand); continue; }
    const prefixed = Object.keys(BRANDS).find((b) => low.startsWith(b) && /^[\d.]/.test(low.slice(b.length)));
    if (prefixed) { out.push(`${/** @type {any} */ (BRANDS)[prefixed]}${p.slice(prefixed.length)}`); continue; }
    if (/^\d+(\.\d+)?[a-z]$/i.test(p)) { out.push(p.toUpperCase()); continue; }
    if (/^[a-z]\d+[a-z]?$/i.test(p)) { out.push(p.toUpperCase()); continue; }
    if (out.length && SMALL.has(low)) { out.push(low); continue; }
    out.push(/^[a-z]/.test(p) ? p[0].toUpperCase() + p.slice(1) : p);
  }
  const name = out.join(" ") || String(id || "");
  return win ? `${name} · ${win[1]}${win[2].toUpperCase()}` : name;
}

/**
 * A family's name: its coding agent's own for the model where its listing gave one (HarnessV3-ACP AF2: Claude Code's
 * "Haiku 4.5", not "Haiku"), else its id made readable.
 * @param {any} f
 */
export function familyName(f) {
  return f?.label ? String(f.label) : prettyModel(f?.id);
}

/**
 * Whose model a catalogue id is, for its tile: a mark and a hue.
 * @param {unknown} id
 * @returns {{ key: string, name: string, mark: string, hue: string }}
 */
export function vendorOf(id) {
  const s = (String(id || "").split("/").pop() || "").toLowerCase().replace(/^cursor-/, "");
  const is = (/** @type {RegExp} */ r) => r.test(s);
  if (is(/claude|^opus|^sonnet|^haiku|fable|mythos/)) return { key: "anthropic", name: "Anthropic", mark: "A", hue: "#d97757" };
  if (is(/^gpt|^o\d|codex|^chatgpt/)) return { key: "openai", name: "OpenAI", mark: "O", hue: "#10a37f" };
  if (is(/^grok/)) return { key: "xai", name: "xAI", mark: "X", hue: "#6e7a8a" };
  if (is(/^gemini|^gemma/)) return { key: "google", name: "Google", mark: "G", hue: "#4285f4" };
  if (is(/^kimi|moonshot|^k\d/)) return { key: "moonshot", name: "Moonshot", mark: "K", hue: "#0ea5e9" };
  if (is(/^glm|zhipu|z-ai/)) return { key: "zhipu", name: "Zhipu", mark: "Z", hue: "#3858f6" };
  if (is(/^qwen|^qwq|^qmodel|^q\d/)) return { key: "qwen", name: "Qwen", mark: "Q", hue: "#615ced" };
  if (is(/deepseek|^dmodel|^dfmodel/)) return { key: "deepseek", name: "DeepSeek", mark: "D", hue: "#4d6bfe" };
  if (is(/^composer|^auto|^default/)) return { key: "cursor", name: "Cursor", mark: "C", hue: "#48484a" };
  if (is(/nemotron|nvidia/)) return { key: "nvidia", name: "NVIDIA", mark: "N", hue: "#76b900" };
  if (is(/llama|^meta/)) return { key: "meta", name: "Meta", mark: "M", hue: "#0866ff" };
  if (is(/mistral|mixtral|codestral/)) return { key: "mistral", name: "Mistral", mark: "M", hue: "#fa520f" };
  if (is(/minimax|^mmodel/)) return { key: "minimax", name: "MiniMax", mark: "M", hue: "#e2336b" };
  const first = prettyModel(id).replace(/[^A-Za-z0-9]/g, "")[0] || "?";
  return { key: "other", name: "", mark: first.toUpperCase(), hue: "#8e8e93" };
}

/**
 * A window in words: 200K, 1M, 1.5M.
 * @param {number | null | undefined} n
 */
export function windowWords(n) {
  const v = Number(n) || 0;
  if (!v) return "";
  if (v >= 1e6) return `${Math.round(v / 1e5) / 10}M`.replace(/\.0M$/, "M");
  return `${Math.round(v / 1000)}K`;
}

/** The levels from least to most — the order every meter and every fit reads. */
export const LEVEL_ORDER = Object.freeze(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const rank = (/** @type {string | null | undefined} */ l) => LEVEL_ORDER.indexOf(String(l || ""));

/**
 * A wanted level fitted to the levels a model takes: the level itself when offered, else the highest offered level
 * under it, else the lowest offered — the way a switch of model keeps the spirit of the choice (Max on Opus becomes
 * High on a model whose top is High). Null for no level wanted or none offered.
 * @param {readonly string[] | null | undefined} levels @param {string | null | undefined} want
 */
export function fitLevel(levels, want) {
  if (!want || !levels?.length) return null;
  if (levels.includes(want)) return want;
  const w = rank(want);
  if (w < 0) return null;
  const sorted = [...levels].sort((x, y) => rank(x) - rank(y));
  let best = null;
  for (const l of sorted) if (rank(l) <= w) best = l;
  return best || sorted[0];
}

/** The levels an agent's or a Space's effort may name, least first (SUBAGENT_EFFORTS but "model", SPACE_EFFORTS). */
export const AGENT_LEVELS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

/**
 * The levels a model takes that an agent's or a Space's effort may name, least first, as its family says them: [] where
 * it takes none, null where the catalogue does not know it ("" — the main agent's — among them).
 * @param {readonly any[] | null | undefined} families @param {string} model @returns {string[] | null}
 */
export function levelsIn(families, model) {
  const at = model ? locate(/** @type {Family[]} */ (families || []), model) : null;
  if (!at) return null;
  const levels = at.family?.effort?.levels;
  return Array.isArray(levels) ? levels.filter((/** @type {string} */ l) => AGENT_LEVELS.includes(l)) : [];
}

/**
 * Whether a level runs capped without extended thinking on this model (the rules' capWhenThinkingDisabled: Opus
 * refuses Extra high and Max without a thinking object — the wire sends High then).
 * @param {any} f  a family @param {string | null | undefined} level
 */
export function needsThinking(f, level) {
  const cap = f?.effort?.capWithoutThinking;
  if (!cap || !level || !f?.thinking) return false;
  return rank(level) > rank(cap);
}

/** @typedef {{ id: string, effort: string | null, speed: string | null, thinking: string | null, window: number | null, context_window?: number }} Member */
/** @typedef {{ id: string, upstream: string, kind: "variants" | "model" | "other", members: Member[], effort: any, speed: any, thinking: any, window: any, context_window?: number, codingAgent?: boolean, billing?: "plan", price?: { input: number, output: number } | null, noTools?: "operator" | "endpoint", onMachine?: string }} Family */
/** @typedef {{ effort: string | null, speed: string, thinking: string, window: number }} Tuning */

const SUFFIX = /-(low|medium|high|xhigh|max|fast)$/i;

/**
 * The families a model picker lists: every one but the models that are not for chat (kind "other" — an embedding,
 * rerank, speech or image model; its name still routes when a tool asks for it). Providers P2.
 * @param {Family[]} families @returns {Family[]}
 */
export const pickable = (families) => (families || []).filter((f) => f.kind !== "other");

/**
 * The family a stored model name belongs to and the member it names — a suffixed name (`claude-opus-5-5-high`, as
 * `/set model.name` may hold it) finds its base's family, the suffix read back as the tuning it asked for.
 * @param {Family[]} families @param {string} name
 * @returns {{ family: Family, member: Member, fromName: Partial<Tuning> } | null}
 */
export function locate(families, name) {
  const n = String(name || "").replace(/^agent\//, "");
  if (!n) return null;
  for (const f of families || [])
    for (const m of f.members) if (m.id === n) return { family: f, member: m, fromName: {} };
  // A suffix Filament itself reads: strip it word by word and look again.
  let rest = n;
  /** @type {Partial<Tuning>} */
  const fromName = {};
  for (let guard = 0; guard < 2 && SUFFIX.test(rest); guard++) {
    const w = /** @type {RegExpExecArray} */ (SUFFIX.exec(rest))[1].toLowerCase();
    if (w === "fast") fromName.speed = "fast";
    else fromName.effort = w;
    rest = rest.slice(0, -(w.length + 1));
    for (const f of families || [])
      for (const m of f.members) if (m.id === rest && f.kind === "model") return { family: f, member: m, fromName };
  }
  return null;
}

/**
 * The tuning in force for a located model: the member's own words for a family of variant ids, the session's
 * settings for a model Filament tunes (the name's suffix only where no setting says otherwise — the wire's rule).
 * A level is the one the wire sends: a stored level the model does not take is fitted to its levels, and one it
 * refuses without thinking (Opus: Extra high and Max) reads as the cap while thinking is off.
 * @param {{ family: Family, member: Member, fromName: Partial<Tuning> }} at
 * @param {{ effort?: string | null, fast?: boolean, flex?: boolean, window?: number | null, thinkingBudget?: number | null }} settings  the session's effective model section
 * @returns {Tuning}
 */
export function tuningOf(at, settings = {}) {
  const f = at.family, m = at.member;
  const byName = (/** @type {string} */ axis) => f[axis]?.via === "name";
  const thinking = byName("thinking") ? m.thinking || "off" : Number(settings.thinkingBudget) > 0 ? "on" : "off";
  let effort = byName("effort") ? m.effort || null : fitLevel(f.effort?.levels || [], settings.effort || at.fromName.effort || null);
  if (effort && !byName("effort") && thinking === "off" && needsThinking(f, effort)) {
    const cap = rank(f.effort?.capWithoutThinking);
    effort = fitLevel((f.effort?.levels || []).filter((l) => rank(l) <= cap), effort);
  }
  return {
    effort,
    // Fast wins over flex (the server's rule); flex counts only where the model offers it (Providers P5).
    speed: byName("speed")
      ? m.speed || "standard"
      : settings.fast === true || at.fromName.speed === "fast"
        ? "fast"
        : settings.flex === true && f.speed?.options?.includes("flex")
          ? "flex"
          : "standard",
    thinking,
    window: byName("window") ? m.window || 0 : Number(settings.window) || 0,
  };
}

/**
 * The member of a family of variant ids that best matches a tuning: every axis the family spells must match when a
 * member can; otherwise the one matching the most (the axis just changed first). Null for a family with one member.
 * @param {Family} f @param {Tuning} want @param {keyof Tuning | null} [changed]
 */
export function memberFor(f, want, changed = null) {
  if (f.members.length === 1) return f.members[0];
  let best = f.members[0], score = -1;
  for (const m of f.members) {
    let s = 0;
    for (const a of nameAxes(f)) if (memberValue(m, a) === want[a]) s += a === changed ? 100 : 10;
    if (s > score) { best = m; score = s; }
  }
  return best;
}

/** The axes a family's ids spell. @param {Family} f */
const nameAxes = (f) => /** @type {(keyof Tuning)[]} */ (["effort", "speed", "thinking", "window"]).filter((a) => f[a]?.via === "name");
/** A member's word on one axis, its plain value when its id says nothing. @param {Member} m @param {keyof Tuning} a */
const memberValue = (m, a) => (a === "effort" ? m.effort : a === "speed" ? m.speed || "standard" : a === "thinking" ? m.thinking || "off" : m.window || 0);

/** @typedef {{ name?: string | null, effort?: string | null, fast?: boolean | null, flex?: boolean | null, window?: number | null, thinking?: { budget?: number | null } | null }} ModelSection */

/** A stored name without the loop's prefix (a session started on `agent/<model>` runs that model). @param {unknown} name */
const bareName = (name) => String(name || "").replace(/^agent\//, "");

/**
 * A new chat's held tuning as the create call's flat settings: only what differs from the defaults (the effort rides
 * the create call on its own). Fast mode and the flex tier (Providers P5) only where they are settings.
 * @param {Family} f @param {Tuning} t
 * @returns {Record<string, any>}
 */
export function heldFlat(f, t) {
  /** @type {Record<string, any>} */
  const out = {};
  if (f.speed?.via === "setting" && t.speed === "fast") out["model.fast"] = true;
  if (f.speed?.via === "setting" && t.speed === "flex") out["model.flex"] = true;
  if (f.window?.via === "setting" && t.window && t.window !== Number(f.window.standard)) out["model.window"] = t.window;
  if (f.thinking?.via === "setting" && t.thinking === "on") out["model.thinking.budget"] = 16000;
  return out;
}

/**
 * What a choice writes: the model name and every setting it moves, as one patch of explicit values — only what differs
 * from what the session runs with now (`eff`, its effective model section), so a value it already has keeps its source.
 * An explicit null (Auto, the standard window, thinking off) overrides the project's or the global value, the way the
 * choice reads. A family whose ids carry an axis neutralizes that setting: a model.effort left standing would re-suffix
 * the member's own name on the wire, model.fast would append -fast to it, and a thinking budget would think on the
 * plain member while the chip reads Thinking off.
 * @param {Family} f @param {Tuning} want
 * @param {{ changed?: keyof Tuning | null, eff?: ModelSection | null, thinkingBudget?: number }} [o]
 * @returns {{ name: string, patch: { model: Record<string, any> } | null }}
 */
export function planWrite(f, want, o = {}) {
  const eff = o.eff || {};
  const member = memberFor(f, want, o.changed || null);
  /** @type {Record<string, any>} */
  const model = {};
  if (member.id !== bareName(eff.name)) model.name = member.id;
  const setting = (/** @type {string} */ axis) => /** @type {any} */ (f)[axis]?.via === "setting";
  const effort = setting("effort") && want.effort && f.effort.levels.includes(want.effort) ? want.effort : null;
  if ((eff.effort || null) !== effort) model.effort = effort;
  const fast = setting("speed") && want.speed === "fast";
  if ((eff.fast === true) !== fast) model.fast = fast;
  // The flex tier (Providers P5) is a setting of its own beside fast; a choice writes one on and the other off.
  const flex = setting("speed") && want.speed === "flex";
  if ((eff.flex === true) !== flex) model.flex = flex;
  const win = setting("window") && want.window && want.window !== Number(f.window.standard) && f.window.options.includes(want.window) ? want.window : null;
  if ((Number(eff.window) || null) !== win) model.window = win;
  if (setting("thinking")) {
    const on = want.thinking === "on";
    if (on !== (Number(eff.thinking?.budget) > 0)) model.thinking = { budget: on ? o.thinkingBudget || 16000 : null };
  } else if (f.thinking?.via === "name" && Number(eff.thinking?.budget) > 0) model.thinking = { budget: null };
  return { name: member.id, patch: Object.keys(model).length ? { model } : null };
}

/** The tuning paths a session's own layer may hold — what "Use the defaults" unsets. */
export const TUNING_PATHS = Object.freeze(["model.effort", "model.fast", "model.flex", "model.window", "model.thinking.budget"]);

/**
 * "Use the defaults": the session's own tuning unset (only the paths its own layer holds — the layers below decide
 * again), and for a family of variant ids its plain member. An axis no member leaves plain (a catalogue listing only
 * `-low` and `-high`) keeps the running member's word: there is no default to go back to, and the first-listed
 * member would have switched the model under the button.
 * @param {Family} f @param {{ eff?: ModelSection | null, own?: Set<string> }} [o]
 * @returns {{ name: string, patch: { model: Record<string, any> } | null, unset: string[] }}
 */
export function planReset(f, o = {}) {
  const own = o.own || new Set();
  /** @type {Tuning} */
  const want = { effort: null, speed: "standard", thinking: "off", window: 0 };
  const running = f.members.find((m) => m.id === bareName(o.eff?.name));
  if (running) for (const a of nameAxes(f)) if (!f.members.some((m) => memberValue(m, a) === want[a])) /** @type {any} */ (want)[a] = memberValue(running, a);
  const member = memberFor(f, want);
  return { name: member.id, patch: member.id !== bareName(o.eff?.name) ? { model: { name: member.id } } : null, unset: TUNING_PATHS.filter((p) => own.has(p)) };
}

/**
 * The tuning chip's face: the effort meter's lit bars (out of the family's levels), the words, and the badges.
 * @param {Family | null} f @param {Tuning | null} t
 * @returns {{ show: boolean, lit: number, of: number, label: string, fast: boolean, thinking: boolean, window: string }}
 */
export function tuningFace(f, t) {
  if (!f || !t) return { show: false, lit: 0, of: 0, label: "", fast: false, thinking: false, window: "" };
  const levels = f.effort?.levels || [];
  const at = t.effort ? levels.indexOf(t.effort) : -1;
  const show = !!(f.effort || f.speed || f.window || f.thinking);
  const std = Number(f.window?.standard) || 0;
  return {
    show,
    lit: at + 1,
    of: levels.length,
    label: f.effort ? levelWords(t.effort)
      : f.speed ? (t.speed === "fast" ? "Fast" : t.speed === "flex" ? "Flex" : "Standard")
        : f.window ? windowWords(t.window || std)
          : f.thinking ? (t.thinking === "on" ? "Thinking" : "No thinking") : "",
    fast: t.speed === "fast",
    thinking: t.thinking === "on",
    window: t.window && t.window !== std ? windowWords(t.window) : "",
  };
}

/** A per-million price as the tune panel's head says it. @param {number} n */
const perMillion = (n) => `$${n >= 10 ? Math.round(n) : Number(n.toFixed(2)).toString()}`;

/**
 * The tune panel's price words under the model's name: "$3 in · $15 out per million"; on a subscription plan
 * (Providers P4) "On your plan · $3 in · $15 out per million at list price"; a coding agent says so, and another
 * machine's model names the machine ("On MacBook · … at list price").
 * @param {Family} f
 */
export function priceLine(f) {
  const card = f.price && (f.price.input || f.price.output) ? `${perMillion(f.price.input)} in · ${perMillion(f.price.output)} out per million` : "";
  if (f.codingAgent) return "Coding agent";
  if (f.onMachine) return [`On ${f.onMachine}`, card && `${card} at list price`].filter(Boolean).join(" · ");
  return f.billing === "plan" ? ["On your plan", card && `${card} at list price`].filter(Boolean).join(" · ") : card;
}

/** What a window's multiplier is against: the cheapest window — on a subscription plan, the plan's usage of it. @param {Family} f */
export const windowAgainst = (f) => (f.billing === "plan" ? "your plan's usage of the cheapest window" : "the cheapest window");

/**
 * What the flex tier is, in the Speed section's words (Providers P5): the provider's cheaper, slower processing, and
 * what it costs — billed at its multiplier only when the reply says it was served there, against the plan's usage on
 * a subscription plan, "a lower price" when nobody states one.
 * @param {Family} f
 * @returns {string}
 */
export function flexWords(f) {
  const x = Number(f.speed?.flexMultiplier) || 0;
  const cost = !(x > 0 && x < 1) ? "at a lower price when it is served there"
    : f.billing === "plan" ? `${x}× your plan's usage when it is served there`
      : `billed at ${x}× the price when it is served there`;
  return `the provider's cheaper tier, slower when it is busy, ${cost}`;
}

/**
 * The Speed section's caption: the chosen tier in words, or — on Standard — the normal speed and each other tier the
 * model has (a model with both a fast mode and a flex tier names both). A flex tier sold as an id of its own says what
 * it is; one Filament asks for (Providers P5) says its price too.
 * @param {Family} f @param {string} speed
 */
export function speedCaption(f, speed) {
  const opts = /** @type {string[]} */ (f.speed?.options || []);
  const fast = fastWords(f);
  const flex = f.speed?.via === "setting" ? flexWords(f) : "the provider's cheaper tier, slower when it is busy";
  if (speed === "fast") return `Fast: ${fast}.`;
  if (speed === "flex") return `Flex: ${flex}.`;
  const normal = f.price && (f.price.input || f.price.output) ? "The model's normal speed and price." : "The model's normal speed.";
  return [normal, ...(opts.includes("fast") ? [`Fast is ${fast}.`] : []), ...(opts.includes("flex") ? [`Flex is ${flex}.`] : [])].join(" ");
}

/**
 * What fast mode is, in the Speed section's words: what it buys (Anthropic's fast mode is up to 2.5× faster output;
 * elsewhere it is the provider's priority lane, or a faster id of its own) and what it costs — against the price where
 * the model is priced, against the plan's usage on a subscription plan, against the plan's quota for a coding agent or a
 * model nobody prices, "more" when nobody says.
 * A priority lane is billed fast only when the reply says it was served there (the provider may serve it standard).
 * @param {Family} f
 * @returns {string}
 */
export function fastWords(f) {
  const x = Number(f.speed?.multiplier) || 0;
  const lane = f.speed?.via === "setting" && f.speed?.wire !== "anthropic";
  const what = f.speed?.via === "name" ? "the provider's faster variant of this model" : lane ? "the provider's priority lane" : "up to 2.5× faster output";
  const priced = !f.codingAgent && !!(f.price && (f.price.input || f.price.output));
  const cost = x === 1 ? "at the standard price"
    : !(x > 1) ? "at a higher price than standard"
      : f.billing === "plan" ? `${x}× your plan's usage${lane ? " when it is served there" : ""}`
        : priced ? `billed at ${x}× the price${lane ? " when it is served there" : ""}`
        : f.codingAgent ? `${x}× your plan's quota`
          : `${x}× a standard request (${x}× your plan's quota, if you are on one)`;
  return `${what}, ${cost}`;
}
