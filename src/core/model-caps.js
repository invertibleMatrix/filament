// @ts-check
// What a model can do at a provider — the one answer the picker, the wire and the dashboard share: its reasoning
// levels (and the one it uses when none is sent), fast mode (whether it has one, what it costs, the request fields
// that ask for it), extended thinking, the context windows a session may choose, its output ceiling, and whether it
// takes tools. Every answer names the tier that gave it; the first tier that speaks wins:
//   operator  the model's row on the Upstreams page (the upstream's `pricing` map, longest prefix — the dashboard's word)
//   agent     the window alone: what a coding agent named at the end of its turns (its account's, else another's)
//   endpoint  the provider's own model listing, captured at the last Refresh (Anthropic's states reasoning levels and
//             thinking; many state the window and the output ceiling; OpenRouter's and Mistral's state tools; nobody
//             lists fast mode; a coding agent's states the levels its session offered for the model it opened on), and
//             the output ceiling a provider stated as it refused a request that asked for more
//   rules     the Rules page: effort.modelCaps for the levels, speed.models for Anthropic's fast mode
//   builtin   Filament's shipped tables (model-traits.js, PRICING_DEFAULTS)
// Policy narrows on top, where requests are shaped and where the picker offers: effort.allowed (a ceiling),
// speed.mode, the suffixes a harness setting rides on. Nothing here widens a rule. Pure: the discovered facts come in
// through routing's injected lookups.
import { EFFORT_LEVELS, UPSTREAM_TYPES, isAgentUpstream } from "./schema.js";
import { findRoute, findUpstream, renderUpstreamModel, listedParse, discoveredCapsFor, discoveredWindowsOf, agentWindowOf, withEffort } from "./routing.js";
import { matches, mergeRules, parseModelSuffix, bareModel } from "./shaping.js";
import { traitsOf } from "./model-traits.js";
import { contextWindowWithSource, rowFieldFor, fastMultiplierFor, flexMultiplierFor, maxOutputWithSource } from "./pricing.js";

/** `agent`: a window a coding agent named itself (routing's `agentWindowOf`). @typedef {"operator" | "agent" | "endpoint" | "rules" | "builtin" | null} CapSource */
/**
 * @typedef {{
 *   upstream: string | null, sent: string, wire: "anthropic" | "openai" | null, agent: boolean,
 *   effort: { levels: string[] | null, source: CapSource, default: string | null, defaultSource: CapSource },
 *   fast: { available: boolean, declared: boolean | null, source: CapSource, multiplier: number | null, multiplierSource: CapSource,
 *     params: Record<string, unknown> | null, missing?: "params" },
 *   flex: { available: boolean, declared: boolean | null, source: CapSource, multiplier: number | null, multiplierSource: CapSource,
 *     params: Record<string, unknown> | null, missing?: "params" },
 *   thinking: { available: boolean, source: CapSource },
 *   window: { standard: number | null, standardSource: CapSource, options: number[], source: CapSource },
 *   maxOutput: { tokens: number | null, source: CapSource },
 *   tools: { available: boolean, source: CapSource },
 * }} ModelCaps
 */

/** The fields of a model's row that describe what it can do rather than what it costs — the dashboard's Tune sheet. */
export const CAP_FIELDS = Object.freeze(["efforts", "effortDefault", "fast", "fastMultiplier", "fastParams", "flex", "flexMultiplier", "flexParams", "thinking", "windows", "windowMultipliers", "contextTokens", "maxOutputTokens", "tools"]);

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** Levels in Filament's order, whatever order and case a row or a listing wrote them in. @param {unknown[]} xs */
const levelsIn = (xs) => {
  const have = new Set(xs.map((x) => String(x).trim().toLowerCase()));
  return EFFORT_LEVELS.filter((l) => have.has(l));
};

/**
 * @param {(f: string) => { key: string, value: any } | null} row @param {any} listed @param {any} rules
 * @param {string} name @param {import("./model-traits.js").ModelTraits | null} traits
 * @returns {ModelCaps["effort"]}
 */
function effortOf(row, listed, rules, name, traits) {
  /** @type {{ levels: string[] | null, source: CapSource }} */
  let got = { levels: null, source: null };
  const set = row("efforts");
  // The Rules page's caps: every entry that names the family narrows it (their intersection), as the wire always did.
  const caps = (rules?.effort?.modelCaps || []).filter((/** @type {any} */ c) => matches(c?.match, name));
  if (set && Array.isArray(set.value)) got = { levels: levelsIn(set.value), source: "operator" };
  else if (Array.isArray(listed?.efforts)) got = { levels: levelsIn(listed.efforts), source: "endpoint" };
  else if (caps.length) got = { levels: EFFORT_LEVELS.filter((l) => caps.every((/** @type {any} */ c) => (c.allowed || []).includes(l))), source: "rules" };
  else if (traits && Array.isArray(traits.efforts)) got = { levels: [...traits.efforts], source: "builtin" };
  // The level the provider uses when none is sent — only one the model takes (a default outside its levels says nothing).
  const d = row("effortDefault");
  const lv = d ? String(d.value).trim().toLowerCase() : "";
  const own = EFFORT_LEVELS.includes(lv) ? lv : null;
  /** @type {{ default: string, defaultSource: CapSource } | null} */
  const def = own ? { default: own, defaultSource: "operator" } : traits?.effortDefault ? { default: traits.effortDefault, defaultSource: "builtin" } : null;
  return { ...got, ...(def && (!got.levels || got.levels.includes(def.default)) ? def : { default: null, defaultSource: null }) };
}

/**
 * Fast mode. The wire decides whether a declared one can be asked for: Anthropic's is `speed: "fast"` and its beta;
 * an OpenAI-format provider's is fields of its own (xAI's and OpenAI's `service_tier: "priority"`), so a fast mode
 * declared there with no fields to send is not one Filament can ask for (`missing: "params"` says why). A coding
 * agent's speed is the agent's own: its fast variants are ids it lists.
 * @param {(f: string) => { key: string, value: any } | null} row @param {any} cfg @param {any} up @param {string} sent
 * @param {string} name @param {ModelCaps["wire"]} wire @param {any} rules
 * @returns {ModelCaps["fast"]}
 */
function fastOf(row, cfg, up, sent, name, wire, rules) {
  const own = row("fast");
  const p = row("fastParams");
  const params = p && isObj(p.value) && Object.keys(p.value).length ? /** @type {Record<string, unknown>} */ (p.value) : null;
  /** @type {boolean | null} */
  let declared = null;
  /** @type {CapSource} */
  let source = null;
  if (own && typeof own.value === "boolean") {
    declared = own.value;
    source = "operator";
  } else if (wire === "anthropic" && matches(rules?.speed?.models, name)) {
    declared = true;
    source = "rules";
  }
  const x = fastMultiplierFor(sent, up?.pricing);
  const missing = declared === true && wire === "openai" && !params;
  return {
    available: declared === true && !!wire && !missing,
    declared,
    source,
    multiplier: x?.value ?? null,
    multiplierSource: x?.source ?? null,
    params,
    ...(missing ? { missing: /** @type {const} */ ("params") } : {}),
  };
}

/**
 * The flex tier (Providers P5): a provider's cheaper, slower processing, asked for with fields of its own (OpenAI's
 * `service_tier: "flex"`). Only an operator declares it — nothing built in knows one — and only on an OpenAI-format
 * wire, with the fields to send (`missing: "params"` says why not otherwise).
 * @param {(f: string) => { key: string, value: any } | null} row @param {any} cfg @param {any} up @param {string} sent
 * @param {ModelCaps["wire"]} wire
 * @returns {ModelCaps["flex"]}
 */
function flexOf(row, cfg, up, sent, wire) {
  const own = row("flex");
  const p = row("flexParams");
  const params = p && isObj(p.value) && Object.keys(p.value).length ? /** @type {Record<string, unknown>} */ (p.value) : null;
  const declared = own && typeof own.value === "boolean" ? own.value : null;
  const x = flexMultiplierFor(sent, up?.pricing);
  const missing = declared === true && !params;
  return {
    available: declared === true && wire === "openai" && !!params,
    declared,
    source: declared == null ? null : "operator",
    multiplier: x?.value ?? null,
    multiplierSource: x?.source ?? null,
    params,
    ...(missing ? { missing: /** @type {const} */ ("params") } : {}),
  };
}

/**
 * Extended thinking: a setting only on the Anthropic wire (model.thinking.budget, adaptive where that is all a family
 * takes). The built-ins know Claude; a listing that states `capabilities.thinking` knows its own models.
 * @param {(f: string) => { key: string, value: any } | null} row @param {any} listed @param {string} name
 * @param {import("./model-traits.js").ModelTraits | null} traits @param {ModelCaps["wire"]} wire
 * @returns {ModelCaps["thinking"]}
 */
function thinkingOf(row, listed, name, traits, wire) {
  if (wire !== "anthropic") return { available: false, source: null };
  const own = row("thinking");
  if (own && typeof own.value === "boolean") return { available: own.value, source: "operator" };
  if (typeof listed?.thinking === "boolean") return { available: listed.thinking, source: "endpoint" };
  if (traits && /claude/i.test(name)) return { available: true, source: "builtin" };
  return { available: false, source: null };
}

/**
 * Whether the model takes tools (HarnessV4_Tasks E4): the row's `tools`, else what the provider's listing stated.
 * Nobody saying is not a no — such a model is taken to take them. A coding agent brings tools of its own, so
 * nothing here speaks for one.
 * @param {(f: string) => { key: string, value: any } | null} row @param {any} listed @param {boolean} agent
 * @returns {ModelCaps["tools"]}
 */
function toolsOf(row, listed, agent) {
  if (agent) return { available: true, source: null };
  const own = row("tools");
  if (own && typeof own.value === "boolean") return { available: own.value, source: "operator" };
  if (typeof listed?.tools === "boolean") return { available: listed.tools, source: "endpoint" };
  return { available: true, source: null };
}

/**
 * The windows a session may work in: the standard one (the operator's contextTokens, else the one a coding agent
 * named, else the listing's, else the built-in estimate) and the others the model offers — the row's `windows` (an
 * empty list: the standard one only), else the built-in traits'. Fewer than two is no choice at all.
 * @param {(f: string) => { key: string, value: any } | null} row @param {any} cfg @param {any} up @param {string} sent
 * @param {import("./model-traits.js").ModelTraits | null} traits
 * @returns {ModelCaps["window"]}
 */
function windowOf(row, cfg, up, sent, traits) {
  const std = contextWindowWithSource(sent, up?.pricing, up ? discoveredWindowsOf(up.id) : null, agentWindowOf(up, sent));
  const own = row("windows");
  const extra = own && Array.isArray(own.value)
    ? { list: own.value, source: /** @type {CapSource} */ ("operator") }
    : traits?.windows?.length ? { list: traits.windows, source: /** @type {CapSource} */ ("builtin") } : null;
  const all = extra ? [...new Set([std.tokens, ...extra.list].map(Number).filter((n) => Number.isFinite(n) && n >= 1000))].sort((a, b) => a - b) : [];
  return { standard: std.tokens, standardSource: std.source, options: all.length >= 2 ? all : [], source: extra ? extra.source : null };
}

/**
 * What a model can do at one upstream, the name as that upstream receives it.
 * @param {any} cfg  the config
 * @param {any} up  the upstream the model is sent to; null: no route leads anywhere, only the built-ins speak
 * @param {string} sent  the model name as that upstream receives it
 * @param {any} [rules]  the rules in force there (default: the global rules under the upstream's own)
 * @returns {ModelCaps}
 */
export function capsAt(cfg, up, sent, rules = mergeRules(cfg?.rules, up?.rules)) {
  const name = bareModel(sent) || "";
  const agent = !!up && isAgentUpstream(up);
  const formats = UPSTREAM_TYPES[up?.type]?.formats || [];
  const wire = !up || agent ? null : formats.includes("anthropic") ? "anthropic" : formats.includes("openai") ? "openai" : null;
  const listed = up ? discoveredCapsFor(up.id, sent) : null;
  const traits = traitsOf(name);
  const row = (/** @type {string} */ f) => rowFieldFor(sent, up?.pricing, f);
  return {
    upstream: up?.id ?? null,
    sent: String(sent || ""),
    wire,
    agent,
    effort: effortOf(row, listed, rules, name, traits),
    fast: fastOf(row, cfg, up, sent, name, wire, rules),
    flex: flexOf(row, cfg, up, sent, wire),
    thinking: thinkingOf(row, listed, name, traits, wire),
    window: windowOf(row, cfg, up, sent, traits),
    maxOutput: maxOutputWithSource(sent, up?.pricing, listed?.maxOutput),
    tools: toolsOf(row, listed, agent),
  };
}

/**
 * Where a catalogue or requested name goes: its route, the upstream, the name that upstream receives — a provider's
 * own suffixed id read whole, as the pipeline's parse reads it (`kimi-k3-fast` is its id, not kimi-k3 in fast mode) —
 * and the rules in force there. Null when no route leads anywhere.
 * @param {any} cfg @param {string} name
 */
export function placeOfName(cfg, name) {
  const n = String(name || "");
  if (!n || !cfg) return null;
  const parsed = listedParse(cfg, n) || parseModelSuffix(n, cfg.rules);
  const route = findRoute(cfg, parsed.base) || findRoute(cfg, n);
  if (!route) return null;
  const up = findUpstream(cfg, route.upstream);
  const sent = renderUpstreamModel(route.upstreamModel, parsed.base, route.captures || []) || parsed.base;
  return { route, up, sent, rules: mergeRules(cfg.rules, up?.rules, route.rules) };
}

/**
 * What a catalogue or requested name can do, with the rules in force where it lands. Null when no route leads anywhere.
 * @param {any} cfg @param {string} name
 * @returns {(ModelCaps & { rules: any }) | null}
 */
export function modelCapsFor(cfg, name) {
  const place = placeOfName(cfg, name);
  if (!place) return null;
  return { ...capsAt(cfg, place.up, place.sent, place.rules), rules: place.rules };
}

/**
 * Filament's flex suffix on a parsed name (Providers P5): a trailing `-flex` on the base — after the effort peel, so
 * `x-flex-high` is x at high effort on the flex tier — is read as the flex tier only when the name without it lands on
 * a model whose row declares flex, with the fields to ask for it. A provider's own `-flex` id declares nothing, so it
 * stays that id (flex has no built-in). Returns the parse with `suffixFlex`.
 * @template {{ base: string }} P
 * @param {any} cfg @param {P} parsed
 * @returns {P & { suffixFlex: boolean }}
 */
export function flexParse(cfg, parsed) {
  const base = String(parsed?.base || "");
  if (!/-flex$/i.test(base) || cfg?.rules?.speed?.suffix === false) return { ...parsed, suffixFlex: false };
  const plain = base.slice(0, -5);
  const caps = plain ? modelCapsFor(cfg, plain) : null;
  return caps?.flex?.available ? { ...parsed, base: plain, suffixFlex: true } : { ...parsed, suffixFlex: false };
}

/**
 * The session's model.flex on its name (Providers P5): `-flex` on the base, before any effort or fast suffix
 * (`x-flex-high`), read back by the parse stage's `flexParse`. Only where the model has a flex tier: on any other a
 * `-flex` would not be read and would name another model. A name already on flex keeps its own.
 * @param {string} name @param {any} cfg @param {boolean} [flex]
 */
export function withFlex(name, cfg, flex = false) {
  if (!flex || !name || cfg?.rules?.speed?.suffix === false) return name;
  const parsed = listedParse(cfg, name) || parseModelSuffix(name, cfg?.rules);
  if (flexParse(cfg, parsed).suffixFlex || !modelCapsFor(cfg, parsed.base)?.flex?.available) return name;
  if (parsed.base === name) return `${name}-flex`;
  return `${parsed.base}-flex${parsed.suffixEffort ? `-${parsed.suffixEffort}` : ""}${parsed.suffixFast ? "-fast" : ""}`;
}

/**
 * The name a harness session's turn sends (`body.model`), as the routes and memory read it: the session's model with
 * its flex tier where it asks for one (`model.flex`) or `-fast` where it goes fast (`model.fast`), then its effort's
 * level (`model.effort`).
 * @param {any} cfg @param {any} eff  the session's document @param {string} name  its model (`model.name`)
 */
export function turnModelName(cfg, eff, name) {
  const fast = eff?.model?.fast === true;
  return withEffort(fast ? name : withFlex(name, cfg, eff?.model?.flex === true), eff?.model?.effort, cfg, fast);
}

/**
 * The upstream as it would be without the operator's word on what its models can do — every capability field taken
 * off its rows, the prices kept: what the dashboard's "Use the provider's" falls back to.
 * @param {any} up
 */
export function withoutOperatorCaps(up) {
  if (!up || !isObj(up.pricing)) return up;
  /** @type {Record<string, any>} */
  const pricing = {};
  for (const [k, row] of Object.entries(up.pricing)) {
    if (!isObj(row)) {
      pricing[k] = row;
      continue;
    }
    const r = { ...row };
    for (const f of CAP_FIELDS) delete r[f];
    pricing[k] = r;
  }
  return { ...up, pricing };
}
