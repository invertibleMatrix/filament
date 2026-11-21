// Upstream resolution: which URL and which auth header to use for a given upstream and wire format.
import { UPSTREAM_TYPES } from "./schema.js";
import { CURSOR_SDK_OFF, CURSOR_SDK_SWITCH, agentKey, cursorSdkHeld } from "./catalogues.js";
import { contextWindowFor, contextWindowWithSource, maxOutputFor, keepsThinkingInPricing, priceCard, billingFor } from "./pricing.js";
import { mergeRules, parseModelSuffix } from "./shaping.js";
import { DEFAULT_OUTPUT_TOKENS, fittedMaxTokens } from "./tokens.js";

/**
 * Whether an upstream is off: by its own switch, or as Cursor's SDK while Settings › Experimental's switch for it is
 * off (`cursorSdkOn`, the owner's of 11-10) — its models out of the pickers, a turn sent to it refused (`offWhy`).
 * @param {any} cfg @param {any} u
 */
export const upstreamOff = (cfg, u) => !u || u.enabled === false || cursorSdkHeld(cfg, u);

export function findUpstream(cfg, id) {
  return (cfg.upstreams || []).find((u) => u.id === id && !upstreamOff(cfg, u)) || null;
}

/**
 * Why an upstream on its own switch is off nonetheless, in words, or null: Cursor's SDK while its Experimental switch
 * is off (`CURSOR_SDK_OFF`). Said where a model of its was picked — a turn, a sub-agent's model, a summary's — so the
 * other way out is another model; a sign-in, a check or a test picked none, and says `CURSOR_SDK_OFF` alone.
 * @param {any} cfg @param {string} id
 */
export function offWhy(cfg, id) {
  const u = (cfg.upstreams || []).find((/** @type {any} */ x) => x.id === id);
  return u && u.enabled !== false && upstreamOff(cfg, u) ? `${CURSOR_SDK_OFF}, or pick a model of Cursor's` : null;
}
/**
 * Where such an upstream goes on (`offWhy`), as a sentence names it, or null: Settings › Experimental's switch for it.
 * @param {any} cfg @param {string} id
 */
export const offWhere = (cfg, id) => (offWhy(cfg, id) ? CURSOR_SDK_SWITCH : null);

export function upstreamBaseUrl(upstream) {
  const base = (upstream.baseUrl || UPSTREAM_TYPES[upstream.type]?.baseUrl || "").replace(/\/+$/, "");
  return base;
}

/**
 * Build the endpoint URL. Accepts bases with or without a trailing /vN and never doubles it; when the base
 * already carries an API version (…/v4), the appended path keeps that version instead of forcing /v1.
 * @param {any} upstream
 * @param {string} format
 * @param {{ wire?: string | null }} [opts]
 * @returns {string}
 */
export function upstreamEndpoint(upstream, format, { wire = null } = {}) {
  let base = upstreamBaseUrl(upstream);
  if (/\/(messages|chat\/completions|responses)$/i.test(base)) return base; // user gave the full endpoint
  const ver = (base.match(/\/(v\d+)$/i) || [null, "v1"])[1];
  base = base.replace(/\/v\d+$/i, "");
  const path =
    format === "anthropic"
      ? `/${ver}/messages`
      : wire === "responses"
        ? `/${ver}/responses`
        : `/${ver}/chat/completions`;
  if (upstream.type === "anthropic" && format === "anthropic") return `${base}${path}?beta=true`;
  return `${base}${path}`;
}

export function upstreamSupports(upstream, format) {
  const t = UPSTREAM_TYPES[upstream.type];
  return !t || t.formats.includes(format);
}

/**
 * Base URL with any trailing /vN removed, plus that version (default "v1"): for auxiliary endpoints
 * (models, embeddings) that live under the same version as chat. `verOf("…/paas/v4") -> ["…/paas", "v4"]`.
 * @param {any} upstream
 * @returns {[string, string]}
 */
export function upstreamVersionedBase(upstream) {
  const raw = upstreamBaseUrl(upstream);
  const m = raw.match(/\/(v\d+)$/i);
  return m ? [raw.slice(0, raw.length - m[0].length), m[1]] : [raw, "v1"];
}

export function authHeaders(upstream, format) {
  const key = upstream.apiKey || "";
  if (!key) return {};
  let style =
    upstream.authStyle && upstream.authStyle !== "auto"
      ? upstream.authStyle
      : UPSTREAM_TYPES[upstream.type]?.authStyle || "bearer";
  if (style === "auto") style = format === "anthropic" ? "x-api-key" : "bearer";
  const h = {};
  if (style === "x-api-key" || style === "both") h["x-api-key"] = key;
  if (style === "bearer" || style === "both") h["authorization"] = `Bearer ${key}`;
  return h;
}

// Glob-style route matching: "*" wildcard, case-insensitive. Also accepts "re:<regex>".
// Returns null when the pattern does not match, otherwise the list of wildcard captures
// ("claude-*" against "claude-opus-5" -> ["opus-5"]). "re:<regex>" patterns return their groups.
const routeRxCache = new Map();
function routeRx(pattern) {
  let r = routeRxCache.get(pattern);
  if (r !== undefined) return r;
  if (pattern.startsWith("re:")) {
    try {
      r = new RegExp(pattern.slice(3), "i");
    } catch {
      r = null;
    }
  } else if (pattern === "*") r = /^(.*)$/i;
  else {
    const esc = pattern
      .split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("(.*)");
    r = new RegExp(`^${esc}$`, "i");
  }
  routeRxCache.set(pattern, r);
  return r;
}
export function routeMatches(pattern, model) {
  if (!pattern) return null;
  const m = String(model || "");
  const r = routeRx(pattern);
  if (!r) return null;
  const hit = r.exec(m);
  return hit ? hit.slice(1) : null;
}
/**
 * An agent's route in the list, for detection and for an account added in Settings (HarnessV3-ACP AC3-7): `route`
 * goes in before the catch-all `*` where the upstream has none, and the upstream's route moves to the top where an
 * earlier, broader one would catch its names (`claude-*` catches `claude-code/sonnet`), since it could never win.
 * @param {any[]} routes  changed in place @param {string} upstreamId @param {string} prefix  its names' (`claude-code`)
 * @param {any} route
 * @returns {{ moved: string, above: string } | null}  the route moved, and the one it was moved above
 */
export function placeAgentRoute(routes, upstreamId, prefix, route) {
  if (!routes.some((rt) => rt.upstream === upstreamId)) {
    const star = routes.findIndex((rt) => rt.match === "*");
    routes.splice(star >= 0 ? star : routes.length, 0, route);
  }
  const probe = `${prefix}/some-model`;
  const winner = routes.find((rt) => rt.enabled !== false && routeMatches(rt.match, probe));
  if (!winner || winner.upstream === upstreamId) return null;
  const idx = routes.findIndex((rt) => rt.upstream === upstreamId && rt.enabled !== false && routeMatches(rt.match, probe));
  if (idx <= 0) return null;
  const [own] = routes.splice(idx, 1);
  routes.unshift(own);
  return { moved: own.match, above: winner.match };
}

/**
 * An agent being turned on has its own route on, and placed (`placeAgentRoute`): the one to its upstream at its own
 * names is turned on where it is off, so its names reach it rather than the catch-all.
 * @param {any[]} routes  changed in place @param {string} upstreamId @param {string} prefix @param {any} route  its own
 * @returns {{ moved: string, above: string } | null}
 */
export function turnOnAgentRoute(routes, upstreamId, prefix, route) {
  for (const rt of routes) if (rt.upstream === upstreamId && rt.match === route.match) rt.enabled = true;
  return placeAgentRoute(routes, upstreamId, prefix, route);
}

/**
 * The configuration without some upstreams (HarnessV3-ACP AC3-7, AC3-8): they go, and with them the routes to them and
 * the fallbacks that name them. A copy; `cfg` is left as it is.
 * @param {any} cfg @param {ReadonlySet<string>} ids
 */
export function withoutUpstreams(cfg, ids) {
  const next = structuredClone(cfg);
  next.upstreams = (next.upstreams || []).filter((/** @type {any} */ u) => !ids.has(u.id));
  next.routes = (next.routes || [])
    .filter((/** @type {any} */ rt) => !ids.has(rt.upstream))
    .map((/** @type {any} */ rt) =>
      Array.isArray(rt.fallbacks) && rt.fallbacks.some((/** @type {any} */ f) => ids.has(f?.upstream))
        ? { ...rt, fallbacks: rt.fallbacks.filter((/** @type {any} */ f) => !ids.has(f?.upstream)) }
        : rt,
    );
  return next;
}

/** A route's match that names one model, not a pattern. @param {unknown} match */
export const isExactMatch = (match) => !!match && !String(match).includes("*") && !String(match).startsWith("re:");

/**
 * The route that would catch route `i`'s name if route `i` were not there, with its index — or null (none would, or
 * route `i` is a pattern).
 * @param {any} cfg @param {number} i
 * @returns {{ route: any, index: number, sent: string } | null}
 */
export function routeBeneath(cfg, i) {
  const routes = cfg?.routes || [];
  const r = routes[i];
  if (!r || !isExactMatch(r.match)) return null;
  const name = String(r.match);
  for (let j = i + 1; j < routes.length; j++) {
    const b = routes[j];
    if (b.enabled === false) continue;
    const caps = routeMatches(b.match, name);
    if (caps) return { route: b, index: j, sent: renderUpstreamModel(b.upstreamModel, name, caps) || name };
  }
  return null;
}

/**
 * Whether route `i` names a model the routes beneath it would send to the same provider under the same name anyway: it
 * makes no name of its own, it only adds to that one — backups, a format, rule overrides (HarnessV4_Settings_Plan
 * HS-D62).
 * @param {any} cfg @param {number} i
 */
export function addsOnly(cfg, i) {
  const r = cfg?.routes?.[i];
  const b = routeBeneath(cfg, i);
  return !!b && b.route.upstream === r.upstream && b.sent === (renderUpstreamModel(r.upstreamModel, String(r.match), []) || String(r.match));
}

export function findRoute(cfg, baseModel) {
  for (const r of cfg.routes || []) {
    if (r.enabled === false) continue;
    const captures = routeMatches(r.match, baseModel);
    if (captures) return { ...r, captures };
  }
  return null;
}

// "{model}" = the whole matched name (without effort suffix); "{1}", "{2}"… = wildcard captures.
export const renderUpstreamModel = (template, base, captures = []) =>
  template && template.trim()
    ? template.replace(/\{model\}/g, base).replace(/\{(\d+)\}/g, (_, i) => captures[Number(i) - 1] ?? "")
    : base;

// The context window of the model a request is addressed to (0 = not recorded): what the context stamp, /autofit
// and the compactor size against, by the same longest-prefix lookup.
//
// Endpoint-stated windows (the provider's own model listing, captured at discovery) sit between the operator's
// tables and the built-in estimates. The discovery cache belongs to the adapter layer, so the composition root
// injects the lookup once (`wireDiscoveredWindows`); this module stays pure and importable by everything.
/** @type {(upstreamId: string) => Record<string, number> | null} */
let discoveredWindowsFor = () => null;
/** @param {(upstreamId: string) => Record<string, number> | null} fn */
export function wireDiscoveredWindows(fn) {
  discoveredWindowsFor = typeof fn === "function" ? fn : () => null;
}
/** @type {(upstreamId: string) => string[] | null} */
let discoveredNamesFor = () => null;
/** @param {(upstreamId: string) => string[] | null} fn */
export function wireDiscoveredNames(fn) {
  discoveredNamesFor = typeof fn === "function" ? fn : () => null;
}
/** @typedef {{ efforts?: string[], thinking?: boolean, maxOutput?: number, tools?: boolean }} DiscoveredCaps */
/** @type {(upstreamId: string) => Record<string, DiscoveredCaps> | null} */
let discoveredCapsTable = () => null;
/** What a provider's listing stated about each model beyond its window (Anthropic's `capabilities`, output ceilings). @param {(upstreamId: string) => Record<string, DiscoveredCaps> | null} fn */
export function wireDiscoveredCaps(fn) {
  discoveredCapsTable = typeof fn === "function" ? fn : () => null;
}
/** The windows an upstream's listing stated, `{ [name]: tokens }` in its spelling (null = none). @param {string} upstreamId */
export const discoveredWindowsOf = (upstreamId) => discoveredWindowsFor(String(upstreamId || ""));
// The windows coding agents named themselves at the end of their turns (`usage_update`'s size, Codex's model window),
// kept by the model cache, which injects the lookup once (`wireAgentWindows`) as it does the listings'.
/** @type {(upstreamId: string, sent: string) => number | null} */
let agentWindowFor = () => null;
/** @param {(upstreamId: string, sent: string) => number | null} fn */
export function wireAgentWindows(fn) {
  agentWindowFor = typeof fn === "function" ? fn : () => null;
}
/**
 * The window a coding agent named for a model, the name as its upstream receives it — its own account's word, else
 * another account's of the same agent — or null: an upstream that is no coding agent has none.
 * @param {any} up  the upstream @param {string} sent
 */
export const agentWindowOf = (up, sent) => (up && UPSTREAM_TYPES[up.type]?.agent ? agentWindowFor(String(up.id || ""), String(sent || "")) : null);
// The names a coding agent listed itself when it was last asked — its own list, without the ones typed on its card or
// its key's — kept by the model cache, which injects the lookup once (`wireAgentNames`); null where it was never asked.
/** @type {(upstreamId: string) => string[] | null} */
let agentNamesFor = () => null;
/** @param {(upstreamId: string) => string[] | null} fn */
export function wireAgentNames(fn) {
  agentNamesFor = typeof fn === "function" ? fn : () => null;
}
// The output ceilings providers stated as they refused a request that asked for more (pipeline/dispatch/verdict.js),
// kept by the model cache, which injects the lookup once as it does the listings'.
/** @type {(upstreamId: string, sent: string) => number | null} */
let refusedCeilingFor = () => null;
/** @param {(upstreamId: string, sent: string) => number | null} fn */
export function wireOutputCeilings(fn) {
  refusedCeilingFor = typeof fn === "function" ? fn : () => null;
}
/** A listing's spelling and the name sent, compared as the same model: path, case, date stamp and dots aside. @param {unknown} s */
const listingKey = (s) => (String(s || "").split("/").pop() || "").toLowerCase().replace(/-\d{8}$/, "").replace(/\./g, "-");
/**
 * What an upstream itself stated about ONE model, the name as sent — its listing's claims, an exact match only (a claim
 * about claude-opus-5 says nothing about claude-opus-5-5), with the output ceiling it stated when it refused more (the
 * lower one when both) — or null.
 * @param {string} upstreamId @param {string} sent
 * @returns {DiscoveredCaps | null}
 */
export function discoveredCapsFor(upstreamId, sent) {
  const want = listingKey(sent);
  if (!upstreamId || !want) return null;
  const all = discoveredCapsTable(String(upstreamId));
  /** @type {DiscoveredCaps | null} */
  let listed = null;
  for (const [name, v] of Object.entries(all || {}))
    if (listingKey(name) === want && v && typeof v === "object") {
      listed = v;
      break;
    }
  const said = refusedCeilingFor(String(upstreamId), String(sent));
  if (!said) return listed;
  return { ...(listed || {}), maxOutput: listed?.maxOutput ? Math.min(listed.maxOutput, said) : said };
}

/**
 * Whether a model name is itself a model its route's upstream lists (its manual list or its discovered one) — a
 * provider's own `kimi-k3-fast` or `qwen3-max`. Such a name travels whole: the `-fast` or `-max` Filament would
 * otherwise read as its own suffix is part of the provider's id there, and stripping it would send another model.
 * @param {any} cfg @param {string} name
 */
export function listedWhole(cfg, name) {
  const n = String(name || "");
  const r = n ? findRoute(cfg, n) : null;
  const up = r ? findUpstream(cfg, r.upstream) : null;
  if (!up) return false;
  const sent = (renderUpstreamModel(r.upstreamModel, n, r.captures || []) || n).toLowerCase();
  return [...(up.models || []), ...(discoveredNamesFor(up.id) || [])].some((x) => String(x).toLowerCase() === sent);
}

/**
 * A requested name read against its upstream's own ids: the name whole when it is one (`kimi-k3-fast`), else the
 * longest start of it that is one, the words after it Filament's suffixes — `kimi-k3-fast-high` is the provider's
 * kimi-k3-fast at high effort, `qwen3-max-fast` its qwen3-max in fast mode. Null when no start of it is listed (the
 * plain parse stands), and always with effort.stripSuffix off (the name travels as sent).
 * @param {any} cfg @param {string} name
 * @returns {{ base: string, suffixEffort: string | null, suffixFast: boolean, original: string } | null}
 */
export function listedParse(cfg, name) {
  const n = String(name || "");
  const rules = cfg?.rules;
  if (parseModelSuffix(n, rules).base === n) return null;
  if (listedWhole(cfg, n)) return { base: n, suffixEffort: null, suffixFast: false, original: n };
  const efforts = [...(rules?.effort?.suffixes || [])].sort((a, b) => b.length - a.length);
  let m = n, suffixEffort = null, suffixFast = false;
  // The same peel as parseModelSuffix (one level, one -fast, from the end), stopping at the first listed start.
  for (let guard = 0; guard < 2; guard++) {
    const lower = m.toLowerCase();
    const e = suffixEffort ? null : efforts.find((s) => lower.endsWith(`-${s}`));
    if (e) { suffixEffort = e; m = m.slice(0, -(e.length + 1)); }
    else if (rules?.speed?.suffix !== false && !suffixFast && lower.endsWith("-fast")) { suffixFast = true; m = m.slice(0, -5); }
    else return null;
    if (listedWhole(cfg, m)) return { base: m, suffixEffort, suffixFast, original: n };
  }
  return null;
}

/**
 * The model name a harness turn carries (Facade D6): the setting's effort wins over a suffix in the name — the
 * proxy's own reading (`parseModelSuffix`) says what the base is — so `x-high` with `model.effort: low` goes out
 * as `x-low`, never `x-high-low`. A `-fast` suffix survives. With no setting the name goes out as stored; with
 * `effort.stripSuffix` off the suffix is part of the name, and the old append-only rule stands. `fast` (the
 * session's model.fast) adds the `-fast` suffix the proxy reads as fast mode, where the rules recognise it — judged
 * by the parse stage's own reading, so a provider's `kimi-k3-fast` (its own word, not fast mode) still gets one.
 * @param {string} name @param {string | null} effort @param {any} cfg @param {boolean} [fast]
 */
export function withEffort(name, effort, cfg, fast = false) {
  const e = String(effort || "").trim().toLowerCase();
  const known = (cfg?.rules?.effort?.suffixes || []).map((s) => String(s).toLowerCase());
  const fastOk = fast === true && cfg?.rules?.speed?.suffix !== false;
  let out = name;
  if (e && known.includes(e)) {
    // A provider's own id (kimi-k3-fast, qwen3-max) keeps every word: the level rides after it, and the parse stage
    // reads only that (listedParse). Re-joined from its parse, it would name another model.
    if (listedWhole(cfg, name)) out = `${name}-${e}`;
    else if (cfg?.rules?.effort?.stripSuffix === false) out = name.toLowerCase().endsWith(`-${e}`) ? name : `${name}-${e}`;
    else {
      const parsed = parseModelSuffix(name, cfg?.rules);
      out = `${parsed.base}-${e}${parsed.suffixFast ? "-fast" : ""}`;
    }
  }
  return fastOk && !(listedParse(cfg, out) || parseModelSuffix(out, cfg?.rules)).suffixFast ? `${out}-fast` : out;
}

/** The window AND its source for the model a request is addressed to — the resolution every lane shares. */
export function contextWindowWithSourceFor(cfg, model) {
  if (!model || !cfg) return { tokens: null, source: null };
  const base = parseModelSuffix(String(model), cfg.rules).base;
  const r = findRoute(cfg, base) || findRoute(cfg, String(model));
  if (!r) return { tokens: null, source: null };
  const up = findUpstream(cfg, r.upstream);
  const sent = renderUpstreamModel(r.upstreamModel, base, r.captures || []) || base;
  return contextWindowWithSource(sent, up?.pricing, up ? discoveredWindowsFor(up.id) : null, agentWindowOf(up, sent));
}

export function contextWindowForModel(cfg, model) {
  return contextWindowWithSourceFor(cfg, model).tokens || 0;
}

/** The price card of the model a request is addressed to, keyed by the name the route actually sends — the same
 *  resolution as the window. Null when no table prices it (or no route leads anywhere). */
export function priceCardFor(cfg, model, opts = {}) {
  if (!model || !cfg) return null;
  const base = parseModelSuffix(String(model), cfg.rules).base;
  const r = findRoute(cfg, base) || findRoute(cfg, String(model));
  if (!r) return priceCard(base, null, opts);
  const up = findUpstream(cfg, r.upstream);
  const sent = renderUpstreamModel(r.upstreamModel, base, r.captures || []) || base;
  return priceCard(sent, up?.pricing, opts);
}

/**
 * How a model name is billed where its route sends it (Providers P4, `billingFor`): "plan" for a subscription (a
 * coding agent's, a row's, an upstream's or its catalogue plan's), else "metered". A name no route takes is metered.
 * @param {any} cfg @param {string} model
 * @returns {"metered" | "plan"}
 */
export function billingForModel(cfg, model) {
  if (!model || !cfg) return "metered";
  const base = parseModelSuffix(String(model), cfg.rules).base;
  const r = findRoute(cfg, base) || findRoute(cfg, String(model));
  if (!r) return "metered";
  const sent = renderUpstreamModel(r.upstreamModel, base, r.captures || []) || base;
  return billingFor(sent, findUpstream(cfg, r.upstream));
}

// Whether the model keeps its thinking blocks in the conversation (Opus 4.5+, Sonnet 4.6+ and newer) — the
// route's upstream card first, then the operator's table, then the built-ins. The keepInHistory derivation
// (Step 6 §1.4) reads this: with thinking on, such a model's blocks are kept so the prefix stays byte-stable.
export function modelKeepsThinking(cfg, model) {
  if (!model || !cfg) return false;
  const base = parseModelSuffix(String(model), cfg.rules).base;
  const r = findRoute(cfg, base) || findRoute(cfg, String(model));
  // No route (a chain that has never sent): the operator's table and the built-ins still speak, by the asked-for
  // name. With a route, the name actually sent is what the tables key (the same rule as the window and the
  // output ceiling) — a renaming route must not hide the capability.
  if (!r) return keepsThinkingInPricing(base, null);
  const up = findUpstream(cfg, r.upstream);
  const sent = renderUpstreamModel(r.upstreamModel, base, r.captures || []) || base;
  return keepsThinkingInPricing(sent, up?.pricing);
}

/**
 * Which of a conversation's thinking blocks reach the upstream a model's route sends Anthropic-shaped requests to —
 * the agent loop's (HarnessV3-TaskGraph-v2 TG2-D81), so its window measure counts what is sent. OpenAI's format:
 * "none", its translation drops every one (wire/translate.js). Anthropic's: "signed", its shaping drops the unsigned
 * (shaping.js `thinking.stripUnsignedHistory`), or "all" where the merged rules turn that off. The format is the
 * route's own, else Anthropic's where the upstream speaks it, as plan.js picks. No route or upstream: "all", the
 * count that never says less than may be sent.
 * @param {any} cfg @param {string} model
 * @returns {"all" | "signed" | "none"}
 */
export function thinkingOnWire(cfg, model) {
  if (!model || !cfg) return "all";
  const base = parseModelSuffix(String(model), cfg.rules).base;
  const r = findRoute(cfg, base) || findRoute(cfg, String(model));
  const up = r && findUpstream(cfg, r.upstream);
  if (!up) return "all";
  const format = r.format && r.format !== "auto" ? r.format : upstreamSupports(up, "anthropic") ? "anthropic" : "openai";
  if (format !== "anthropic") return "none";
  return mergeRules(cfg.rules, up.rules, r.rules)?.thinking?.stripUnsignedHistory === false ? "all" : "signed";
}

// The model's maximum output as the pricing tables state it, else as its provider's listing did (0 = not stated).
// `outputCeiling` adds the floor for when nobody has said.
export function maxOutputForModel(cfg, model) {
  if (!model || !cfg) return 0;
  const base = parseModelSuffix(String(model), cfg.rules).base;
  const r = findRoute(cfg, base) || findRoute(cfg, String(model));
  if (!r) return 0;
  const up = findUpstream(cfg, r.upstream);
  const sent = renderUpstreamModel(r.upstreamModel, base, r.captures || []) || base;
  return maxOutputFor(sent, up?.pricing, up ? discoveredCapsFor(up.id, sent)?.maxOutput : null) || 0;
}

/**
 * The most a model can write: its stated maximum output (maxOutputForModel), else DEFAULT_OUTPUT_TOKENS. Sessions and
 * agent turns without their own `max_tokens` ask for it, and so does every call Filament makes itself (`callRoom`).
 * @param {any} cfg @param {string} model
 */
export function outputCeiling(cfg, model) {
  return maxOutputForModel(cfg, model) || DEFAULT_OUTPUT_TOKENS;
}

/**
 * The `max_tokens` of a call Filament makes itself (HarnessV3-FailurePoints §13): the most its model can write, fitted
 * to what its window leaves after a request of `request` tokens. A cap sized to the answer alone ended a reasoning
 * model's calls in thought, with nothing written: GLM 5.3 Flash spent each 1,500-token cap of a compaction's slices
 * thinking. The length an answer should have is its prompt's to ask. `window` is the caller's when it knows the
 * model's better than the tables do (memory's model cache). A request the window cannot hold goes with the ceiling,
 * and the provider refuses it in its own words.
 * @param {any} cfg @param {string} model @param {number} request @param {number} [window]
 */
export function callRoom(cfg, model, request, window = contextWindowForModel(cfg, model)) {
  const ceiling = outputCeiling(cfg, model);
  return fittedMaxTokens({ window, request, cap: ceiling, floor: 1 }) ?? ceiling;
}

// A model name as "who answers it" — the upstream's name over the model actually sent, with the asked-for name in
// parens when it differs. `agent/grok-4.6-xhigh` is a lane, not a place: it reads as
// "SpaceX/grok-4.6 (agent/grok-4.6-xhigh)" — the destination first, the lane that asked in parens.
export function resolveModelDisplay(cfg, name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const stripped = raw.replace(/^agent\//, ""); // the agent loop runs the bare model through the same routes
  const base = parseModelSuffix(stripped, cfg.rules).base;
  const r = findRoute(cfg, base) || findRoute(cfg, stripped);
  if (!r) return raw;
  const up = (cfg.upstreams || []).find((u) => u.id === r.upstream);
  if (!up) return raw;
  const sent = renderUpstreamModel(r.upstreamModel, base, r.captures || []) || base;
  const who = `${up.name || up.id}/${sent}`;
  return sent === stripped && raw === stripped ? who : `${who} (${raw})`;
}

// ---------------------------------------------------------------------------------------------------
// Model discovery: ask upstreams what they serve, then map those names back to agent-facing names.
// ---------------------------------------------------------------------------------------------------

// Given a route and a model name the upstream serves, return the agent-facing name that would route
// to it, or null. Handles glob matches with one "*" and templates built from "{model}" or "{1}".
export function invertRoute(route, upstreamModel) {
  const tpl = (route.upstreamModel || "{model}").trim() || "{model}";
  const match = route.match || "";
  if (match.startsWith("re:")) return null;
  const stars = (match.match(/\*/g) || []).length;
  if (stars > 1) return null;
  const [pre, post = ""] = match.split("*");
  if (tpl.includes("{model}")) {
    const [tpre, tpost = ""] = tpl.split("{model}");
    if (!upstreamModel.startsWith(tpre) || !upstreamModel.endsWith(tpost)) return null;
    const name = upstreamModel.slice(tpre.length, upstreamModel.length - tpost.length);
    if (stars === 0) return name === match ? name : null;
    return name.startsWith(pre) && name.endsWith(post) && name.length >= pre.length + post.length
      ? name
      : null;
  }
  if (tpl.includes("{1}") && stars === 1) {
    const [tpre, tpost = ""] = tpl.split("{1}");
    if (!upstreamModel.startsWith(tpre) || !upstreamModel.endsWith(tpost)) return null;
    const captured = upstreamModel.slice(tpre.length, upstreamModel.length - tpost.length);
    return `${pre}${captured}${post}`;
  }
  return stars === 0 && tpl === upstreamModel ? match : null;
}

/**
 * What a destination reports for an upstream when asked for its models.
 * @typedef {(upstream: any, opts: { force: boolean }) => Promise<{ names: string[], source: string, error?: string, cached?: string[] }>} Discover
 */
// The names an upstream offers to the aggregate: its manual list alone when discovery is off or the destination is
// local or built in (agents and Qoder are asked by the composition root, which merges what they said into `models`
// before this runs), otherwise what `discover` — the HTTP destination's `listModels` — reports.
async function namesOf(upstream, { force, discover }) {
  const manual = (upstream.models || []).filter(Boolean);
  if (
    !discover ||
    upstream.discoverModels === false ||
    UPSTREAM_TYPES[upstream.type]?.local ||
    UPSTREAM_TYPES[upstream.type]?.builtin
  )
    return { names: manual, source: "manual" };
  return discover(upstream, { force });
}

// Agent-facing model list: explicit route names + inverted discovered names (+ optional effort variants).
/** Whether an upstream runs Claude Code, which runs a model in 1M by its id with `[1m]`. @param {any} up */
const claudeCode = (up) => !!up && UPSTREAM_TYPES[up.type]?.agent && agentKey(up) === "claude-code";

/**
 * The name to add on a Claude Code card to run a model in 1M — its id with `[1m]` — or null: the one rule, which the
 * models list (`agent_window_add`) and a session's window answer (`add`) both carry, and the page draws as given. Only
 * where the window said for the model is 1M or more, its id names no window itself, the model has a 1M form and the
 * card does not hold that name already, typed on it or listed by Claude Code. Claude Code's own list is the word on
 * the names it holds — `haiku` has no `haiku[1m]` there, and `opus[1m]` is there to pick — so only a name it does not
 * list, one typed on the card or its key's, has a name to add: nothing Filament keeps says such a name has no 1M form.
 * @param {any} up  the upstream @param {string} sent  the name it is sent
 * @param {number | null | undefined} said  the window said for it here
 * @returns {string | null}
 */
export function oneMToAdd(up, sent, said) {
  if (!claudeCode(up) || !(Number(said) >= 1_000_000) || !sent || /\[[\d.]+[km]\]$/i.test(sent)) return null;
  const is = (/** @type {unknown} */ a, /** @type {string} */ b) => String(a).toLowerCase() === b.toLowerCase();
  const own = agentNamesFor(String(up.id || "")) || [];
  if (own.some((n) => is(n, sent))) return null;
  const add = `${sent}[1m]`;
  return [...(up.models || []), ...own].some((n) => is(n, add)) ? null : add;
}

/**
 * @param {any} cfg
 * @param {{ force?: boolean, discover?: Discover | null }} [opts]
 */
export async function aggregateModels(cfg, { force = false, discover = null } = {}) {
  const out = new Map(); // name -> { upstream, upstreamModel, source }
  // An upstream an Experimental switch keeps off offers none of its names (`upstreamOff`).
  const kept = new Set((cfg.upstreams || []).filter((/** @type {any} */ u) => u.enabled !== false && upstreamOff(cfg, u)).map((/** @type {any} */ u) => u.id));
  for (const r of cfg.routes || [])
    if (
      r.enabled !== false &&
      !kept.has(r.upstream) &&
      r.match &&
      !r.match.includes("*") &&
      !r.match.startsWith("re:") &&
      !out.has(r.match)
    )
      out.set(r.match, {
        upstream: r.upstream,
        upstreamModel: renderUpstreamModel(r.upstreamModel, r.match, []),
        source: "route",
      });
  const perUpstream = {};
  for (const u of cfg.upstreams || []) {
    if (upstreamOff(cfg, u)) continue;
    const res = await namesOf(u, { force, discover });
    // A failed refresh keeps the previously discovered names instead of blanking every picker until the next success.
    if (res.error && res.cached?.length) {
      res.names = [...new Set([...res.cached, ...(u.models || []).filter(Boolean)])];
      res.source = "stale";
    }
    perUpstream[u.id] = {
      count: res.names.length,
      source: res.source,
      error: res.error,
      hidden: (u.hiddenModels || []).length,
      all: res.names,
    };
    // Gateways and routers (OpenRouter, LiteLLM, local routers) list ids as "<provider>/<model>" and usually accept the
    // bare model too; try both forms and keep a candidate only if the route resolves it back to the discovered id (or
    // its bare form) on this upstream.
    const isRouter = u.type === "openai-compatible" || u.type === "anthropic-compatible";
    const hidden = new Set((u.hiddenModels || []).map((x) => String(x).toLowerCase()));
    // A route that only adds to a name this upstream lists (its backups, HS-D62) is no name of its own: the name is
    // offered as the upstream lists it, in its place in the list, and a hidden one stays hidden.
    (cfg.routes || []).forEach((r, i) => {
      if (r.enabled === false || r.upstream !== u.id || out.get(r.match)?.source !== "route" || !addsOnly(cfg, i)) return;
      if (res.names.includes(renderUpstreamModel(r.upstreamModel, r.match, []))) out.delete(r.match);
    });
    for (const name of res.names) {
      if (hidden.has(String(name).toLowerCase())) continue; // kept out of pickers by the user; still routable by name
      const slash = name.lastIndexOf("/");
      const bare = slash >= 0 ? name.slice(slash + 1) : null;
      const prefix = slash >= 0 ? name.slice(0, slash) : null;
      for (const r of cfg.routes || []) {
        if (r.enabled === false || r.upstream !== u.id) continue;
        const forms = [name];
        if (isRouter && bare && (r.discoverPrefixes || []).includes(prefix)) forms.push(bare);
        for (const form of forms) {
          const agentName = invertRoute(r, form);
          if (!agentName || out.has(agentName)) continue;
          const resolved = findRoute(cfg, agentName);
          if (!resolved || resolved.upstream !== u.id) continue;
          const sent = renderUpstreamModel(resolved.upstreamModel, agentName, resolved.captures);
          if (sent === name || sent === bare)
            out.set(agentName, { upstream: u.id, upstreamModel: sent, source: "discovered" });
        }
      }
    }
  }
  const suffixes = cfg.server?.advertiseEffortSuffixes || [];
  if (suffixes.length)
    for (const [name, info] of [...out])
      if (/claude/i.test(name))
        for (const s of suffixes)
          if (!out.has(`${name}-${s}`)) out.set(`${name}-${s}`, { ...info, source: "effort-variant" });
  // Each model's context window, from the same tables and prefix rule as its price: the operator's tables
  // first, then a window a coding agent named itself, then one the provider's own listing stated, then the
  // built-in estimates. Clients see it in /v1/models, the dashboard shows it, and the context stamp judges by it.
  const ups = new Map((cfg.upstreams || []).map((u) => [u.id, u]));
  return {
    models: [...out].map(([id, info]) => {
      const up = ups.get(info.upstream);
      const pricing = up?.pricing;
      const sent = info.upstreamModel || id;
      const named = agentWindowOf(up, sent);
      const win = contextWindowFor(sent, pricing, up ? discoveredWindowsFor(up.id) : null, named);
      // A coding agent that runs it in a window of its own other than the one said for it (the owner's of 11-10: Claude
      // Code ran Fable 5.2 in 200K under a Tune of 1M): its window, and on Claude Code the id that runs it in 1M.
      const differs = !!named && !!win && named !== win;
      const add = differs ? oneMToAdd(up, sent, win) : null;
      return {
        id,
        ...info,
        ...(win ? { context_window: win } : {}),
        ...(differs ? { agent_window: named, ...(add ? { agent_window_add: add } : {}) } : {}),
      };
    }),
    upstreams: perUpstream,
  };
}
