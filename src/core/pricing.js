// @ts-check
// Prices, context windows and concurrency limits looked up by model-name prefix in the pricing tables (an upstream's
// own, then the built-ins). Pure lookups; the record store and the router both read them from here.
import { PRICING_DEFAULTS, AGENT_TYPES } from "./schema.js";
import { providerForBaseUrl } from "./providers.js";

/**
 * The pricing key of a model name: last path segment, lower-case, date stamp dropped, dots → dashes. An effort word at
 * its end stays: `qwen3-max` and `gpt-5.1-codex-max` are models of their own, each priced as itself. A name that
 * carries an effort lane (`claude-opus-4-5-high`) still finds its model's row, a prefix of it, by the longest-prefix
 * rule the lookups use: the name without the word could find no row that the whole name does not.
 * @param {unknown} model
 */
export function normalizeModelForPricing(model) {
  let m = String(
    String(model || "")
      .split("/")
      .pop(),
  ).toLowerCase();
  m = m.replace(/-\d{8}$/, "").replace(/\./g, "-");
  return m;
}

// The upstream's own price table wins when it has any match for the model; the built-ins are the fallback.
// The context window for a model, from the same tables and the same longest-prefix rule as its price — with one
// tier between them: a window the provider's own model listing stated (OpenRouter-style `context_length`),
// captured at discovery. Precedence: the operator's table first (their word beats the endpoint's claim), then the
// window a coding agent named itself, then the endpoint's, then the built-in estimates. Used by the context stamp
// (every request's fit), by /autofit and by the slice pass (slice sizing).
const PRICE_INDEX = Symbol("filamentPriceIndex");
function pricingRows(table) {
  if (!table) return [];
  const keys = Object.keys(table);
  const sig = keys.join("\0");
  const cached = table[PRICE_INDEX];
  if (cached && cached.sig === sig) return cached.rows;
  const rows = [];
  for (const prefix of keys) {
    const p = normalizeModelForPricing(prefix);
    if (p) rows.push([p, prefix]);
  }
  try {
    Object.defineProperty(table, PRICE_INDEX, {
      value: { sig, rows },
      enumerable: false,
      configurable: true,
    });
  } catch {
    /* frozen / sealed tables just recompute */
  }
  return rows;
}
/**
 * Whether a model keeps its thinking blocks in the conversation's history — the interleaved-thinking models
 * (Opus 4.5+, Sonnet 4.6+, and their newer kin) whose every reply carries thinking the provider expects to see
 * again. The pricing tables' `keepsThinking: true` row says it, the same longest-prefix rule and the same tier
 * order as every other pricing fact (an upstream's own card, then the built-ins); nobody saying anything is "does
 * not keep" (false, never null — the derivation wants a decision).
 * @param {string} model @param {any} upstreamTable
 * @returns {boolean}
 */
export function keepsThinkingInPricing(model, upstreamTable) {
  const m = normalizeModelForPricing(model);
  if (!m) return false;
  for (const t of [upstreamTable, PRICING_DEFAULTS]) {
    if (!t) continue;
    let best = null;
    for (const [p, key] of pricingRows(t)) {
      // The longest row that NAMES the flag decides for this table — an explicit false is the operator's word,
      // not the absence of one.
      if (m.startsWith(p) && t[key] && "keepsThinking" in t[key] && (!best || p.length > best[0].length)) best = [p, t[key].keepsThinking === true];
    }
    if (best) return best[1];
  }
  return false;
}

/**
 * A table's longest matching prefix row for a field, WITHOUT the cross-table precedence: `[prefix, value]` or null.
 * The one matcher every table lookup shares, so `contextWindowWithSource` can name the tier a number came from
 * without duplicating the walk.
 * @param {any} table @param {string} field @param {string} [m]  the normalized model name, when the caller already has it
 * @returns {[string, number] | null}
 */
function bestRow(table, field, m = "") {
  if (!table) return null;
  let best = /** @type {[string, number] | null} */ (null);
  for (const [p, key] of pricingRows(table)) {
    const n = Number(table[key]?.[field]);
    if (Number.isFinite(n) && n > 0 && m.startsWith(p) && (!best || p.length > best[0].length)) best = [p, n];
  }
  return best;
}
function pickPricingField(model, upstreamTable, field, { positive = true } = {}) {
  const m = normalizeModelForPricing(model);
  const pick = (t) => {
    let best = null;
    for (const [p, key] of pricingRows(t)) {
      const n = Number(t[key]?.[field]);
      if (
        Number.isFinite(n) &&
        (!positive || n > 0) &&
        m.startsWith(p) &&
        (!best || p.length > best[0].length)
      )
        best = [p, n];
    }
    return best;
  };
  // An upstream's own card wins; the built-in estimates are the floor — versioned with the app, never a config
  // dependency.
  const best = pick(upstreamTable) || pick(PRICING_DEFAULTS);
  return best ? best[1] : null;
}

/**
 * The window the provider's own model listing stated for a name, when discovery captured one: `{ [name]: tokens }`
 * keyed by the endpoint's spelling. An exact (normalized) match wins; else the longest key the name starts with —
 * the same longest-prefix rule the tables use. A claimed window outside sane bounds (a router misreporting, a
 * field that is not a token count) is ignored rather than trusted.
 * @param {string} model @param {Record<string, number> | null | undefined} discovered
 */
function pickDiscoveredWindow(model, discovered) {
  if (!discovered) return null;
  const m = normalizeModelForPricing(model);
  if (!m) return null;
  let best = /** @type {[string, number] | null} */ (null);
  for (const [name, n] of Object.entries(discovered)) {
    const num = Number(n);
    if (!Number.isFinite(num) || num < 1000 || num > 100_000_000) continue;
    const p = normalizeModelForPricing(name);
    if (!p) continue;
    if (m === p) return num; // exact spelling: no prefix can beat it
    if (m.startsWith(p) && (!best || p.length > best[0].length)) best = [p, num];
  }
  return best ? best[1] : null;
}

/**
 * The window an id names for itself in brackets at its end, in tokens — `claude-fable-5-2[1m]`, `opus[200k]`,
 * `x[1.5m]`, in any case — or null. Claude Code runs an id ending `[1m]` in the 1M window whichever model it names.
 * Brackets only: a hyphen form (`k3-256k`) is a name, which the tables and the provider's listing speak for.
 * @param {unknown} model @returns {number | null}
 */
function bracketWindow(model) {
  const x = /\[(\d+(?:\.\d+)?)([km])\]$/i.exec(String(model || "").trim());
  if (!x) return null;
  const n = Math.round(Number(x[1]) * (x[2].toLowerCase() === "m" ? 1_000_000 : 1000));
  return n >= 1000 ? n : null;
}

/**
 * The context window with the tier it came from — the one call every "which window applies, and do we trust it"
 * question goes through. `source`: "operator" the upstream's pricing table (the dashboard's word), "agent" the window a
 * coding agent named for this model at the end of its turns (`named`: the caller's lookup, `agentWindowOf`), "endpoint"
 * the provider's own model listing, "builtin" Filament's shipped estimates — the window the id names itself
 * (`bracketWindow`) ahead of the row its name starts with —, null no window is known at all.
 * @param {string} model @param {any} [upstreamTable] @param {Record<string, number> | null} [discovered]
 * @param {number | null} [named]
 * @returns {{ tokens: number | null, source: "operator" | "agent" | "endpoint" | "builtin" | null }}
 */
export function contextWindowWithSource(model, upstreamTable = null, discovered = null, named = null) {
  const m = normalizeModelForPricing(model);
  const own = bestRow(upstreamTable, "contextTokens", m);
  if (own) return { tokens: own[1], source: "operator" };
  if (Number(named) >= 1000) return { tokens: Number(named), source: "agent" };
  const fromEndpoint = pickDiscoveredWindow(model, discovered);
  if (fromEndpoint) return { tokens: fromEndpoint, source: "endpoint" };
  const said = bracketWindow(model);
  if (said) return { tokens: said, source: "builtin" };
  const builtin = bestRow(PRICING_DEFAULTS, "contextTokens", m);
  return builtin ? { tokens: builtin[1], source: "builtin" } : { tokens: null, source: null };
}

/**
 * The context window alone (null = none known) — the thin wrapper for callers that don't care which tier said so.
 * @param {string} model @param {any} [upstreamTable] @param {Record<string, number> | null} [discovered]
 * @param {number | null} [named]
 * @returns {number | null}
 */
export function contextWindowFor(model, upstreamTable = null, discovered = null, named = null) {
  return contextWindowWithSource(model, upstreamTable, discovered, named).tokens;
}
/**
 * The model's maximum OUTPUT tokens with the tier it came from: the operator's table, then what the provider's own
 * model listing stated (Anthropic's `max_tokens`, OpenRouter's `top_provider.max_completion_tokens`, captured at
 * discovery) or the provider said refusing a request that asked for more, then the built-ins. Sessions and agent
 * turns without their own max_tokens use it, else 128,000 — the common ceiling — when nobody has said (a Haiku that
 * stops at 64,000 is told so by its listing).
 * @param {string} model @param {any} [upstreamTable] @param {unknown} [discovered]  the provider's figure for this model
 * @returns {{ tokens: number | null, source: "operator" | "endpoint" | "builtin" | null }}
 */
export function maxOutputWithSource(model, upstreamTable = null, discovered = null) {
  const m = normalizeModelForPricing(model);
  const own = bestRow(upstreamTable, "maxOutputTokens", m);
  if (own) return { tokens: Math.floor(own[1]), source: "operator" };
  const d = Number(discovered);
  if (discovered != null && Number.isFinite(d) && d >= 256 && d <= 10_000_000) return { tokens: Math.floor(d), source: "endpoint" };
  const builtin = bestRow(PRICING_DEFAULTS, "maxOutputTokens", m);
  return builtin ? { tokens: Math.floor(builtin[1]), source: "builtin" } : { tokens: null, source: null };
}
/** The output ceiling alone (null = not stated). @param {string} model @param {any} [upstreamTable] @param {unknown} [discovered] */
export function maxOutputFor(model, upstreamTable = null, discovered = null) {
  return maxOutputWithSource(model, upstreamTable, discovered).tokens;
}

/**
 * The longest row of ONE table that names a field, whatever its value — the capability fields a model's row may
 * carry (`efforts`, `fast`, `windows`…) are lists and switches, not prices, and an explicit `false` or `[]` is the
 * operator's word, not the absence of one. Null when no row names it.
 * @param {string} model @param {any} table @param {string} field
 * @returns {{ key: string, value: any } | null}
 */
export function rowFieldFor(model, table, field) {
  if (!table) return null;
  const m = normalizeModelForPricing(model);
  if (!m) return null;
  let best = /** @type {[string, string] | null} */ (null);
  for (const [p, key] of pricingRows(table)) {
    const row = table[key];
    if (row && typeof row === "object" && row[field] != null && m.startsWith(p) && (!best || p.length > best[0].length)) best = [p, key];
  }
  return best ? { key: best[1], value: table[best[1]][field] } : null;
}

/**
 * The key of the table's row that names `model` itself — no shorter prefix, which speaks for its siblings too — or
 * null: where a fact about this one model is written.
 * @param {string} model @param {any} table
 * @returns {string | null}
 */
export function exactRowKey(model, table) {
  const m = normalizeModelForPricing(model);
  if (!m || !table) return null;
  return pricingRows(table).find(([p]) => p === m)?.[1] ?? null;
}

/** The tables a price fact is read from, in precedence order, with the tier each one is. @param {any} upstreamTable */
const priceTiers = (upstreamTable) =>
  /** @type {[any, "operator" | "builtin"][]} */ ([[upstreamTable, "operator"], [PRICING_DEFAULTS, "builtin"]]);

/** A table's longest row that states a price at all — a bare capability row prices nothing. @param {string} m @param {any} t */
function pricedRowOf(m, t) {
  let best = null;
  for (const [p, key] of pricingRows(t)) {
    const priced = Number.isFinite(Number(t[key]?.input)) || Number.isFinite(Number(t[key]?.output));
    if (priced && m.startsWith(p) && (!best || p.length > best[0].length)) best = [p, t[key]];
  }
  return best;
}

/**
 * What each window of a family costs against its cheapest — a provider that sells each window as a name of its own
 * (Kimi's `k3` at 1M beside `k3-256k`): the family row's `windowMultipliers`, window tokens → multiplier (2 = twice;
 * on a plan, twice the quota). The longest row that states it speaks for the whole family, as the Tune sheet writes
 * one row for a family. Null when none does.
 * @param {string} model @param {any} [upstreamTable]
 * @returns {Record<string, number> | null}
 */
export function windowMultipliersFor(model, upstreamTable = null) {
  const m = normalizeModelForPricing(model);
  if (!m) return null;
  for (const [t] of priceTiers(upstreamTable)) {
    let best = null;
    for (const [p, key] of pricingRows(t)) {
      const map = t[key]?.windowMultipliers;
      if (map && typeof map === "object" && !Array.isArray(map) && m.startsWith(p) && (!best || p.length > best[0].length)) best = [p, map];
    }
    if (best) {
      /** @type {Record<string, number>} */
      const out = {};
      for (const [w, x] of Object.entries(best[1])) if (Number(w) >= 1000 && Number(x) >= 1) out[String(Math.round(Number(w)))] = Number(x);
      return Object.keys(out).length ? out : null;
    }
  }
  return null;
}

/**
 * What fast mode costs against the standard price, with the tier that said it: the priced row's own
 * `fastMultiplier` when it states one, else the longest row that does (the built-ins know Anthropic's 2×; an
 * operator's card that reprices the model keeps them). Null when nobody states one. The same number prices a fast
 * request (`priceCard`) and tells the picker what the speed costs — on a subscription, what it takes from the quota.
 * @param {string} model @param {any} [upstreamTable]
 * @returns {{ value: number, source: "operator" | "builtin" } | null}
 */
export function fastMultiplierFor(model, upstreamTable = null) {
  const m = normalizeModelForPricing(model);
  if (!m) return null;
  for (const [t, source] of priceTiers(upstreamTable)) {
    const priced = t ? pricedRowOf(m, t) : null;
    if (!priced) continue;
    const own = Number(priced[1]?.fastMultiplier);
    if (Number.isFinite(own) && own >= 1) return { value: own, source };
    break;
  }
  for (const [t, source] of priceTiers(upstreamTable)) {
    const b = bestRow(t, "fastMultiplier", m);
    if (b) return { value: Math.max(1, b[1]), source };
  }
  return null;
}
/**
 * What the flex tier costs against the standard price (Providers P5): the priced row's own `flexMultiplier` when it
 * states one, else the longest row that does — above 0 and at most 1 (0.5 = half the price). No built-in knows one,
 * so null when nobody states it.
 * @param {string} model @param {any} [upstreamTable]
 * @returns {{ value: number, source: "operator" | "builtin" } | null}
 */
export function flexMultiplierFor(model, upstreamTable = null) {
  const m = normalizeModelForPricing(model);
  if (!m) return null;
  const ok = (/** @type {unknown} */ v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 1;
  for (const [t, source] of priceTiers(upstreamTable)) {
    const priced = t ? pricedRowOf(m, t) : null;
    if (!priced) continue;
    if (ok(priced[1]?.flexMultiplier)) return { value: Number(priced[1].flexMultiplier), source };
    break;
  }
  for (const [t, source] of priceTiers(upstreamTable)) {
    const b = bestRow(t, "flexMultiplier", m);
    if (b && ok(b[1])) return { value: Number(b[1]), source };
  }
  return null;
}
/**
 * The price card a model is billed by (USD per million tokens), or null when no table prices it: the upstream's own
 * card, then the built-ins — longest prefix within each. `estimateCost` bills by it;
 * the session's settings answer hands it to the harness (Spend splits the dollars with it).
 * A fast-mode request (`opts.fast`) costs the row's prices times its `fastMultiplier` — the priced row's own when it
 * states one, else the longest row that does (the built-ins know the provider's fast rates; an operator's card that
 * reprices the model keeps them). A flex request (`opts.flex`, served on the flex tier) costs them times its
 * `flexMultiplier`; with none stated, the standard price.
 * @param {string} model @param {any} [upstreamTable] @param {{ fast?: boolean, flex?: boolean }} [opts]
 * @returns {{ input: number, output: number, cacheRead: number, cacheWrite: number } | null}
 */
export function priceCard(model, upstreamTable = null, opts = {}) {
  const m = normalizeModelForPricing(model);
  // A row that states no price at all (a bare capability row, like keepsThinking) prices nothing: it must never win
  // the longest-prefix walk and silently price a model at $0. Keys may be spelled like the model (grok-4.6) or
  // normalised (grok-4-6).
  const pick = (/** @type {any} */ t) => (t ? pricedRowOf(m, t) : null);
  const best = pick(upstreamTable) || pick(PRICING_DEFAULTS);
  if (!best) return null;
  const p = best[1];
  const x = opts.fast ? fastMultiplierFor(model, upstreamTable)?.value || 1 : opts.flex ? flexMultiplierFor(model, upstreamTable)?.value || 1 : 1;
  const input = Number(p.input) || 0;
  // A cache price the row does not state is the input price — no discount is assumed. Billing those tokens at $0
  // made every request that read the cache look nearly free on a card that named only in and out.
  const stated = (/** @type {any} */ v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : input);
  return { input: input * x, output: (Number(p.output) || 0) * x, cacheRead: stated(p.cacheRead) * x, cacheWrite: stated(p.cacheWrite) * x };
}

/**
 * Which of the four prices the row that prices `model` states itself, in priceCard's own order of tables. The rest
 * are derived — an unstated cache price is the input price — so a page never writes a derived figure back as if
 * someone had typed it.
 * @param {string} model @param {any} [upstreamTable]
 * @returns {("input" | "output" | "cacheRead" | "cacheWrite")[]}
 */
export function statedPricesOf(model, upstreamTable = null) {
  const m = normalizeModelForPricing(model);
  const best = (upstreamTable && pricedRowOf(m, upstreamTable)) || pricedRowOf(m, PRICING_DEFAULTS);
  if (!best) return [];
  return /** @type {const} */ (["input", "output", "cacheRead", "cacheWrite"]).filter((f) => best[1][f] != null && Number.isFinite(Number(best[1][f])));
}

/**
 * Which table priceCard reads a model's price from, in its own order: the upstream's rows, then the built-in API
 * rates. Null when none prices it.
 * @param {string} model @param {any} [upstreamTable]
 * @returns {"upstream" | "builtin" | null}
 */
export function priceSourceOf(model, upstreamTable = null) {
  const m = normalizeModelForPricing(model);
  if (upstreamTable && pricedRowOf(m, upstreamTable)) return "upstream";
  return pricedRowOf(m, PRICING_DEFAULTS) ? "builtin" : null;
}

/** How a request is paid for (Providers D7): per token at the card, or by a subscription whose card is its list price. */
export const BILLINGS = Object.freeze(["metered", "plan"]);

/**
 * How `model` is billed at `upstream`, and who said so. A coding agent is a plan (its subscription pays). Else the
 * longest row of the upstream's pricing that states `billing` — a provider may sell one model per token beside
 * another on a plan. Else the upstream's own `billing`. Else the catalogue plan its address is (a Z.AI coding-plan
 * address is a plan without anyone saying so). Else metered.
 * @param {string} model @param {any} upstream
 * @returns {{ billing: "metered" | "plan", source: "agent" | "row" | "upstream" | "catalogue" | "default" }}
 */
export function billingOf(model, upstream) {
  if (upstream && AGENT_TYPES.has(upstream.type)) return { billing: "plan", source: "agent" };
  const row = rowFieldFor(model, upstream?.pricing || null, "billing");
  if (row && BILLINGS.includes(row.value)) return { billing: row.value, source: "row" };
  if (BILLINGS.includes(upstream?.billing)) return { billing: upstream.billing, source: "upstream" };
  const known = upstream?.baseUrl ? providerForBaseUrl(upstream.baseUrl) : null;
  if (known && BILLINGS.includes(known.plan.billing)) return { billing: known.plan.billing, source: "catalogue" };
  return { billing: "metered", source: "default" };
}

/** @param {string} model @param {any} upstream */
export const billingFor = (model, upstream) => billingOf(model, upstream).billing;

/**
 * What tokens cost at a model's card. `cacheWrite1h`, where the usage says it, is the share of `cacheWrite` an hour's
 * cache holds: twice the input price (Anthropic's rule for every model that has one), the rest at the card's write
 * price, a five-minute cache's.
 * @param {string} model @param {any} tokens @param {any} [upstreamTable] @param {{ fast?: boolean, flex?: boolean }} [opts]
 */
export function estimateCost(model, tokens, upstreamTable = null, opts = {}) {
  const p = priceCard(model, upstreamTable, opts);
  if (!p) return null;
  const wrote = tokens.cacheWrite || 0;
  const hour = Math.min(wrote, Math.max(0, Number(tokens.cacheWrite1h) || 0));
  const usd =
    ((tokens.input || 0) * (p.input || 0) +
      (tokens.output || 0) * (p.output || 0) +
      (tokens.cacheRead || 0) * (p.cacheRead || 0) +
      (wrote - hour) * (p.cacheWrite || 0) +
      hour * 2 * (p.input || 0)) /
    1e6;
  return Math.round(usd * 1e6) / 1e6;
}
