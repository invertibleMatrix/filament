// @ts-check
// What a model can do at a provider, in words both faces share (HarnessV4_Settings_Plan HS-D1): the console's
// Upstreams page and the harness's Settings › Providers draw the same chips, windows, prices and sources from here,
// and the Tune sheet (model-tune.js) is built on it. Its reasoning levels, fast mode and what it costs, extended
// thinking, the context windows a session may choose, its output ceiling, whether it takes tools, its list price —
// each names who said it: set here, the provider's own model list (captured by Refresh list), the Rules page, Filament's
// built-in knowledge, or the model ids themselves (a provider that lists one id per variant). The functions that build
// elements take the page's `h`; the one that asks the server takes its `api`.

/** The row fields the sheet owns — core/model-caps.js's CAP_FIELDS (a page never imports core). */
export const TUNE_FIELDS = Object.freeze(["efforts", "effortDefault", "fast", "fastMultiplier", "fastParams", "flex", "flexMultiplier", "flexParams", "thinking", "windows", "windowMultipliers", "contextTokens", "maxOutputTokens", "tools"]);
export const LEVELS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
/** @type {Record<string, string>} */
export const LEVEL_WORDS = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
/** @type {Record<string, string>} */
const SHORT = { none: "none", minimal: "min", low: "low", medium: "med", high: "high", xhigh: "xhigh", max: "max" };
/** The legend's words for each source; the tooltips' longer ones below. @type {Record<string, string>} */
export const SOURCE_WORDS = { operator: "set here", agent: "the agent's", endpoint: "provider's list", rules: "Rules page", builtin: "built in", name: "model ids" };
/** @type {Record<string, string>} */
export const SOURCE_LONG = {
  operator: "set on this upstream",
  agent: "named by the coding agent itself as its turns ended (this account's, else another account's of the same agent)",
  endpoint: "stated by the provider: its own model list (read by Refresh list), or, for the output ceiling, its refusal of a request that asked for more",
  rules: "from the Rules page",
  builtin: "Filament's built-in knowledge",
  name: "spelled by the provider's model ids, one id per variant",
};

/**
 * The windows a family's picker offers, in tokens: its options, the plain member's standard one standing for 0.
 * @param {any} w  the family's `window` offer @returns {number[]}
 */
export const windowChoices = (w) => (w?.options || []).map((/** @type {number} */ n) => n || Number(w.standard) || 0).filter(Boolean);
/**
 * One window in words, with what it costs against the cheapest when it is dearer: "1M (2×)".
 * @param {any} w @param {number} n  tokens
 */
export const windowWithCost = (w, n) => {
  const opt = (w?.options || []).find((/** @type {number} */ o) => (o || Number(w.standard)) === n);
  const x = Number(w?.multipliers?.[String(opt ?? n)]) || 0;
  return `${winWords(n)}${x > 1 ? ` (${x}×)` : ""}`;
};
/**
 * Windows written back for the box that edits them, without losing a token: 200K, 1M, but 262144 as it is (the chips'
 * 262K would parse back as 262000).
 * @param {number[]} list
 */
export const windowsText = (list) => list.map((n) => (n % 1e6 === 0 ? `${n / 1e6}M` : n % 1000 === 0 ? `${n / 1000}K` : String(n))).join(", ");

/** Who said a value, in a tooltip's words. @param {string | null | undefined} source */
export const sourceLong = (source) => (source ? SOURCE_LONG[source] || source : "nobody states it");

/** A window in the picker's words: 200K, 1M, 1.05M. @param {unknown} n */
export const winWords = (n) => {
  const v = Number(n) || 0;
  if (!v) return "–";
  if (v >= 1e6) return `${+(v / 1e6).toFixed(v % 1e6 ? 2 : 0)}M`;
  return v >= 1000 ? `${Math.round(v / 1000)}K` : String(v);
};
/** @param {unknown} n */
export const tokens = (n) => `${Number(n).toLocaleString("en-US")} tokens`;
/** @param {string[]} L */
export const levelList = (L) => L.map((l) => LEVEL_WORDS[l] || l).join(" · ");

/**
 * Windows as a person types them — "200K, 1M", "262144" — or null when a part is not a window (under 1,000 tokens).
 * @param {string} text @returns {number[] | null}
 */
export function parseWindows(text) {
  const out = [];
  for (const part of String(text || "").split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(part);
    if (!m) return null;
    const n = Math.round(Number(m[1]) * (m[2] ? (m[2].toLowerCase() === "m" ? 1e6 : 1000) : 1));
    if (!(n >= 1000)) return null;
    out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * A model name as a price row is keyed: the part after its last slash, lower case, without an effort suffix or a date,
 * dots as dashes (grok-4.6 and grok-4-6 are one row).
 * @param {unknown} m
 */
export const normPrice = (m) => (String(m || "").split("/").pop() || "").toLowerCase().replace(/-(low|medium|high|xhigh|max)$/, "").replace(/-\d{8}$/, "").replace(/\./g, "-");
/** Whether a row states a price (or the one field asked). @param {any} v @param {string} [field] */
export const statesPrice = (v, field) => (field ? Number.isFinite(Number(v?.[field])) && Number(v[field]) > 0 : Number.isFinite(Number(v?.input)) || Number.isFinite(Number(v?.output)));
/**
 * The row of a price table that speaks for a name: the longest key the name starts with that states the field.
 * @param {Record<string, any> | undefined} table @param {string} name @param {string} [field]
 * @returns {{ p: string, k: string, v: any } | null}
 */
export const pickPrice = (table, name, field) => {
  const m = normPrice(name);
  /** @type {{ p: string, k: string, v: any } | null} */
  let best = null;
  for (const [k, v] of Object.entries(table || {})) {
    const p = normPrice(k);
    if (p && m.startsWith(p) && statesPrice(v, field) && (!best || p.length > best.p.length)) best = { p, k, v };
  }
  return best;
};
/** A price per million tokens: $3, $0.6. @param {unknown} v */
export const fmtPrice = (v) => (v == null || v === "" ? "–" : `$${Number(v) % 1 === 0 ? Number(v) : Number(v).toFixed(2).replace(/0$/, "")}`);

/**
 * One upstream's model cards, cached on what they depend on (its rows, its rules, the names asked). Only the rows and
 * rules travel — never its key. `clear()` after a Refresh list. `families`: the answer also lists the upstream's
 * families over every name it offers, the hidden ones too (a page ticks them from its own lists), and with no names
 * asked, a card for each family's lead.
 * @param {(path: string, o?: any) => Promise<any>} api @param {{ families?: boolean }} [opts]
 */
export function capsLoader(api, opts = {}) {
  const families = opts.families === true;
  /** @typedef {{ byId: Map<string, any>, errors: string[], agent: boolean, families: any[] | null, error?: string }} CapsAnswer */
  /** @type {Map<string, Promise<CapsAnswer>>} */
  const cache = new Map();
  /** @param {any} u @param {string[]} [names] @returns {Promise<CapsAnswer>} */
  const load = (u, names) => {
    const key = JSON.stringify([u.id, u.pricing || {}, u.rules || {}, names || null, families]);
    const hit = cache.get(key);
    if (hit) return hit;
    if (cache.size > 40) cache.clear();
    /** @type {Promise<CapsAnswer>} */
    const p = api("/models/caps", { method: "POST", body: { upstream: { id: u.id, pricing: u.pricing || {}, rules: u.rules || {} }, names, ...(families ? { families: true } : {}) } })
      .then((/** @type {any} */ r) => ({ byId: new Map((r.models || []).map((/** @type {any} */ m) => [m.id, m])), errors: r.errors || [], agent: !!r.agent, families: Array.isArray(r.families) ? r.families : null }))
      .catch((/** @type {any} */ e) => ({ byId: /** @type {Map<string, any>} */ (new Map()), errors: /** @type {string[]} */ ([]), agent: false, families: null, error: String(e?.message || e) }));
    cache.set(key, p);
    return p;
  };
  load.clear = () => cache.clear();
  return load;
}

/**
 * A chip: its words, its source's look, a tooltip that says both. A value a prefix row of this upstream said (the row
 * “grok-4.7” speaks for grok-4.7-mini too) is marked inherited and names the row.
 * @param {(tag: string, attrs?: any, ...kids: any[]) => any} h
 * @param {string} text @param {string | null} source @param {string} title @param {string} [more] @param {string | null} [row]
 */
const chip = (h, text, source, title, more = "", row = null) => {
  const inherited = source === "operator" && !!row;
  const who = inherited ? `set on this upstream's row “${row}”, which covers every model whose name starts with it` : source ? SOURCE_LONG[source] || source : "";
  return h("span", { class: `cap-chip src-${source || "none"}${inherited ? " inherited" : ""}${more ? ` ${more}` : ""}`, title: `${title}${who ? ` — ${who}` : ""}` }, text);
};

/** The legend over a model table: one chip per source, in the table's own look. @param {(tag: string, attrs?: any, ...kids: any[]) => any} h */
export function capLegend(h) {
  return h("div", { class: "cap-legend" }, h("span", {}, "What a model can do, by who said it:"), ...["operator", "endpoint", "rules", "builtin", "name"].map((s) => chip(h, SOURCE_WORDS[s], s, SOURCE_LONG[s])), h("span", { class: "muted" }, "· tune a model to set any of it here"));
}

/**
 * What a model can do, as a table's chips — what the harness's picker offers (the Rules page's policy applied), each
 * chip styled by who said it. `window: false` leaves the windows to a cell of their own (the family table's).
 * @param {(tag: string, attrs?: any, ...kids: any[]) => any} h
 * @param {any} entry  one model of POST /api/models/caps @param {{ window?: boolean }} [opts]
 * @returns {HTMLElement[]}
 */
export function capChips(h, entry, opts = {}) {
  if (!entry?.caps) return [];
  const { caps, offer, policy } = entry;
  const own = normPrice(entry.sent || entry.upstreamModel || "");
  /** The prefix row that said a field, when it is not this model's own. @param {string} field */
  const row = (field) => { const k = entry.rowKeys?.[field]; return k && normPrice(k) !== own ? String(k) : null; };
  const out = [];
  const eff = offer?.effort;
  if (eff?.levels?.length) {
    /** @type {string[]} */
    const L = eff.levels;
    const range = L.length === 1 ? SHORT[L[0]] || L[0] : `${SHORT[L[0]] || L[0]}–${SHORT[L[L.length - 1]] || L[L.length - 1]}`;
    out.push(chip(h, `reasoning ${range}`, eff.via === "name" ? "name" : caps.effort.source, `Reasoning: ${levelList(L)}${eff.default ? ` (the model's own default: ${LEVEL_WORDS[eff.default] || eff.default})` : ""}`, "", row("efforts")));
  } else if (Array.isArray(caps.effort.levels) && !caps.effort.levels.length && (caps.effort.source === "operator" || caps.effort.source === "endpoint")) {
    out.push(chip(h, "no reasoning field", caps.effort.source, "Takes no effort field: Filament removes it from requests", "muted", row("efforts")));
  }
  const sp = offer?.speed;
  if (sp?.options?.includes("fast")) {
    const x = Number(sp.multiplier) > 1 ? `${sp.multiplier}×` : "";
    // On a subscription plan (Providers P4) the multiplier spends the plan's usage, not dollars.
    const plan = entry.billing?.billing === "plan";
    const costs = !x ? "" : plan ? `, costing ${x} your plan's usage` : sp.via === "name" ? `, costing ${x} the standard ones` : `, costing ${x} the standard price (on a plan: ${x} its quota)`;
    out.push(chip(h, x ? `fast ${x}` : "fast", sp.via === "name" ? "name" : caps.fast.source, sp.via === "name" ? `Fast variants, listed as ids of their own${costs}` : `Fast mode${costs}`, "", row("fast")));
  } else if (caps.fast.missing === "params") {
    out.push(chip(h, "fast: needs fields", "operator", "Marked fast, but with no request fields to ask for it: add them on the Tune sheet (xAI and OpenAI take service_tier = priority)", "warn", row("fast")));
  } else if (caps.fast.available && (policy?.speedMode === "never" || policy?.speedSuffix === false)) {
    out.push(chip(h, "fast off", "rules", policy?.speedMode === "never" ? "Has fast mode, but the Rules page's speed mode is never" : "Has fast mode, but the Rules page's -fast suffix is off, so the harness cannot ask for it", "muted"));
  }
  if (sp?.options?.includes("flex")) {
    // Ids of its own, or (Providers P5) a tier Filament asks for with the row's fields, billed at its multiplier when served.
    const fx = Number(sp.flexMultiplier) > 0 && Number(sp.flexMultiplier) < 1 ? `${sp.flexMultiplier}×` : "";
    const plan = entry.billing?.billing === "plan";
    out.push(sp.via === "name"
      ? chip(h, "flex", "name", "A cheaper, slower tier, listed as an id of its own")
      : chip(h, fx ? `flex ${fx}` : "flex", caps.flex?.source || "operator", `The flex tier: the provider's cheaper, slower processing${fx ? `, costing ${fx} ${plan ? "your plan's usage" : "the standard price"} when it is served there` : ""}`, "", row("flex")));
  } else if (caps.flex?.missing === "params") {
    out.push(chip(h, "flex: needs fields", "operator", "Marked flex, but with no request fields to ask for it: add them on the Tune sheet (OpenAI takes service_tier = flex)", "warn", row("flex")));
  }
  const th = offer?.thinking;
  if (th) out.push(chip(h, "thinking", th.via === "name" ? "name" : caps.thinking.source, "Extended thinking", "", row("thinking")));
  const w = offer?.window;
  /** @type {number[]} */
  const wins = windowChoices(w);
  if (wins.length && opts.window !== false) out.push(chip(h, wins.map((n) => windowWithCost(w, n)).join(" · "), w.via === "name" ? "name" : caps.window.source, `Context windows a session may choose: ${wins.map((n) => n.toLocaleString("en-US")).join(", ")} tokens${w.via === "name" ? " — each a model id of its own" : ""}`, "", row("windows")));
  const mo = caps.maxOutput;
  if (mo?.tokens && (mo.source === "operator" || mo.source === "endpoint")) out.push(chip(h, `out ${winWords(mo.tokens)}`, mo.source, `Output ceiling: ${tokens(mo.tokens)} (sessions without their own max_tokens use it)`, "", row("maxOutputTokens")));
  if (caps.tools?.available === false) out.push(chip(h, "no tools", caps.tools.source, "Takes no tools: Filament's agent answers on it in words only, memory offers it none, and the Assistant refuses it", "muted", row("tools")));
  return out;
}

/**
 * A family's windows in one cell (Providers P2), the same figure its picker offers: the standard window and then the
 * others it may choose, each dearer one with what it costs — "200K · 1M (2×)" — and "?" for a standard window nobody
 * states beside windows its ids spell (zeta-5 beside zeta-5-1m: "? · 1M", where a chip once said 1M and the column
 * "–"). A model with one window says it, or "–".
 * @param {any} offer  the family's `window` offer @param {any} caps  the lead model's resolved `window`
 */
export function familyWindowWords(offer, caps) {
  const std = Number(offer?.standard) || Number(caps?.standard) || 0;
  /** @type {number[]} */
  const opts = offer?.options || [];
  if (opts.length < 2) return std ? winWords(std) : "–";
  return opts.map((o) => {
    const n = o || std;
    if (!n) return "?";
    const x = Number(offer?.multipliers?.[String(o)]) || 0;
    return `${winWords(n)}${x > 1 ? ` (${x}×)` : ""}`;
  }).join(" · ");
}

/**
 * What a member id of a family spells, in words: "High · Fast", "1M", "Thinking"; "standard" for the plain one.
 * @param {{ effort?: string | null, speed?: string | null, thinking?: string | null, window?: number | null }} m
 */
export function spelledWords(m) {
  const out = [];
  if (m?.effort) out.push(LEVEL_WORDS[m.effort] || m.effort);
  if (m?.speed) out.push(m.speed === "fast" ? "Fast" : m.speed === "flex" ? "Flex" : m.speed);
  if (m?.thinking) out.push(m.thinking === "on" ? "Thinking" : "No thinking");
  if (m?.window) out.push(winWords(m.window));
  return out.length ? out.join(" · ") : "standard";
}

/** The row fields the sheet's Pricing section owns, besides the capability fields. */
export const PRICE_FIELDS = Object.freeze(["input", "cacheRead", "output", "cacheWrite"]);

/**
 * Whether the row that prices a model states this price itself (the caps answer's `stated`); an unstated cache price
 * is the in price (Providers P4).
 * @param {any} p @param {string} f
 */
export const statedIn = (p, f) => p.stated.includes(f);

/** A price in words: "$2 in · $0.20 cached · $8 out", the cache said as the in price when the row leaves it out. @param {any} p @param {(v: unknown) => string} fmtP */
export const priceWords = (p, fmtP) => (p && (Number(p.input) || Number(p.output)) ? `${fmtP(p.input)} in · ${statedIn(p, "cacheRead") ? `${fmtP(p.cacheRead)} cached` : "cached at the in price"} · ${fmtP(p.output)} out` : "no list price known");

/**
 * A price is a whole card: the first box typed into on a row with no price of its own carries the others from what
 * applied, so the rest are never priced at $0 by accident — only the figures that row states, never a derived one.
 * @param {any} was  the price that applied @param {string} typed  the field being typed
 * @returns {Record<string, number>}
 */
export function carriedPrices(was, typed) {
  /** @type {Record<string, number>} */
  const out = {};
  if (was) for (const g of PRICE_FIELDS) if (g !== typed && statedIn(was, g) && Number(was[g]) > 0) out[g] = Number(was[g]);
  return out;
}
