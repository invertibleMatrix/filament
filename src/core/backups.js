// @ts-check
// A model's backups (HarnessV4_Settings_Plan HS-5): the providers a name in the picker goes to when the one before it
// fails. They are the failover order of the route that catches the name — its first provider, then each backup in turn,
// while `rules.resilience.failover` is on.
// - `backupsOf(cfg, name)`: where the name goes — the route that catches it, its first provider and the name sent there,
//   its backups, how they are chosen — and whether a provider's page in Settings › Providers can set them, or why not.
// - `backupsProblem(cfg, name, rows)` and `withBackups(cfg, name, rows)`: a new list checked, then the configuration with
//   it. A name its route catches by a pattern gets a route of its own right above that one, with the same provider,
//   name sent, format and rule overrides, so nothing else about it changes (HS-D61); taking every backup off takes that
//   route away again once it only adds them.
// - `routeWords(cfg, r)`: a route the page does not draw, in words.
// Backups are API providers only, for a model of an API provider (HS-D59): Filament's agent loop runs only where every
// provider a model may fall back to is an API, and a chat on a coding agent stays with its agent.
import { isAgentUpstream } from "./schema.js";
import { routeMatches, renderUpstreamModel, isExactMatch, routeBeneath, addsOnly } from "./routing.js";

/** How a route chooses among its first provider and its backups, in words. */
export const STRATEGY_WORDS = Object.freeze({
  in_order: "in order",
  round_robin: "taking turns",
  random: "at random",
  least_latency: "the fastest lately first",
  least_cost: "the cheapest first",
  quota_aware: "the one with the most quota left first",
});

/** Why a coding agent's model has no backups here. */
export const AGENT_WHY = "A coding agent's model takes no backups: a chat on it stays with its agent.";

/** @param {unknown} s */
const low = (s) => String(s ?? "").toLowerCase();
/** A configured upstream, switched on or off. @param {any} cfg @param {string} id */
const upOf = (cfg, id) => (cfg?.upstreams || []).find((/** @type {any} */ u) => u.id === id) || null;
/** An upstream's name as the pages say it. @param {any} cfg @param {string} id */
const upName = (cfg, id) => {
  const u = upOf(cfg, id);
  return u ? String(u.name || u.id) : `${id} (gone)`;
};
/** How many rule overrides a rules object sets. @param {any} v @returns {number} */
const leaves = (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.values(v).reduce((n, x) => n + leaves(x), 0) : v === undefined ? 0 : 1);

/**
 * @typedef {{ index: number, match: string, exact: boolean, upstream: string, sent: string,
 *   backups: { upstream: string, sent: string }[], strategy: string, format: string, ruleOverrides: number,
 *   can: boolean, why: string | null }} Backups
 */

/**
 * Where a name in the picker goes, or null when no route takes it.
 * @param {any} cfg @param {string} name
 * @returns {Backups | null}
 */
export function backupsOf(cfg, name) {
  const n = String(name || "");
  const routes = cfg?.routes || [];
  const index = routes.findIndex((/** @type {any} */ r) => r.enabled !== false && routeMatches(r.match, n));
  if (!n || index < 0) return null;
  const r = routes[index];
  const caps = routeMatches(r.match, n) || [];
  const sentOf = (/** @type {string} */ tpl) => renderUpstreamModel(tpl, n, caps) || n;
  const exact = isExactMatch(r.match) && low(r.match) === low(n);
  const backups = (Array.isArray(r.fallbacks) ? r.fallbacks : []).map((/** @type {any} */ f) => ({ upstream: String(f?.upstream || ""), sent: sentOf(f?.upstreamModel ?? r.upstreamModel) }));
  const why = isAgentUpstream(upOf(cfg, r.upstream))
    ? AGENT_WHY
    : !exact && backups.length
      ? `Its backups are route ${r.match}'s, set in the console: they serve every name it catches.`
      : null;
  return {
    index,
    match: String(r.match),
    exact,
    upstream: String(r.upstream),
    sent: sentOf(r.upstreamModel),
    backups,
    strategy: String(r.strategy || "in_order"),
    format: String(r.format || "auto"),
    ruleOverrides: leaves(r.rules || {}),
    can: !why,
    why,
  };
}

/**
 * Why a new list of backups cannot be kept, with the status a route answers it with — or null.
 * @param {any} cfg @param {string} name @param {unknown} rows  `[{ upstream, upstreamModel }]`
 * @returns {{ status: number, words: string } | null}
 */
export function backupsProblem(cfg, name, rows) {
  const at = backupsOf(cfg, name);
  if (!at) return { status: 404, words: `No route takes ${name}: it is in no picker.` };
  if (!at.can) return { status: 409, words: /** @type {string} */ (at.why) };
  if (!Array.isArray(rows)) return { status: 400, words: "Backups are a list of providers, each with the model's name there." };
  const first = `${at.upstream}\u0000${low(at.sent)}`;
  const seen = new Set([first]);
  for (const x of rows) {
    const id = String(x?.upstream ?? "");
    const model = String(x?.upstreamModel ?? "").trim();
    const u = upOf(cfg, id);
    if (!u) return { status: 400, words: `There is no provider "${id}".` };
    const who = String(u.name || u.id);
    if (isAgentUpstream(u)) return { status: 400, words: `${who} is a coding agent: a backup is a provider's API, so the agent loop can still run on ${name}.` };
    if (!model) return { status: 400, words: `Type the model's name at ${who}.` };
    if (/[{},]/.test(model)) return { status: 400, words: `A model's name has no braces or commas: ${model}` };
    const key = `${id}\u0000${low(model)}`;
    if (seen.has(key)) return { status: 400, words: key === first ? `${who} as ${model} is where ${name} goes first.` : `${who} as ${model} is in the list twice.` };
    seen.add(key);
  }
  return null;
}

/**
 * The configuration with a name's backups set (checked by `backupsProblem` first). A copy; `cfg` is left as it is.
 * @param {any} cfg @param {string} name @param {{ upstream: string, upstreamModel: string }[]} rows
 */
export function withBackups(cfg, name, rows) {
  const at = /** @type {Backups} */ (backupsOf(cfg, name));
  const next = structuredClone(cfg);
  const routes = (next.routes ||= []);
  const fallbacks = rows.map((x) => ({ upstream: String(x.upstream), upstreamModel: String(x.upstreamModel).trim() }));
  if (at.exact) {
    const r = routes[at.index];
    const b = routeBeneath(next, at.index);
    // A route that held nothing but these backups goes with them: the name goes where it went before.
    const bare = !fallbacks.length && addsOnly(next, at.index) && !!b && (r.format || "auto") === (b.route.format || "auto") &&
      JSON.stringify(r.rules || {}) === JSON.stringify(b.route.rules || {}) && !(r.discoverPrefixes || []).length;
    if (bare) routes.splice(at.index, 1);
    else r.fallbacks = fallbacks;
    return next;
  }
  if (!fallbacks.length) return next;
  const r = routes[at.index];
  routes.splice(at.index, 0, {
    match: String(name),
    upstream: at.upstream,
    upstreamModel: at.sent,
    format: r.format || "auto",
    fallbacks,
    strategy: "in_order",
    discoverPrefixes: [],
    enabled: true,
    rules: structuredClone(r.rules || {}),
  });
  return next;
}

/**
 * A route in words, for the routes the page does not draw: which names it catches, where it sends them and as what,
 * then its backups, how they are chosen, its format, its rule overrides, and whether it is off.
 * @param {any} cfg @param {any} r
 */
export function routeWords(cfg, r) {
  const m = String(r?.match || "");
  const which = m === "*" ? "Every other name goes" : m.startsWith("re:") ? `Names matching ${m.slice(3)} go` : m.includes("*") ? `Names like ${m} go` : `The name ${m} goes`;
  const tpl = String(r?.upstreamModel || "{model}");
  const parts = [`${which} to ${upName(cfg, r?.upstream)} ${tpl === "{model}" ? "as asked" : `as ${tpl}`}`];
  const fb = Array.isArray(r?.fallbacks) ? r.fallbacks : [];
  if (fb.length) parts.push(`then ${fb.map((/** @type {any} */ f) => upName(cfg, f?.upstream)).join(", then ")}`);
  const s = String(r?.strategy || "in_order");
  if (fb.length && s !== "in_order") parts.push(`chosen ${STRATEGY_WORDS[/** @type {keyof typeof STRATEGY_WORDS} */ (s)] || s}`);
  if (r?.format && r.format !== "auto") parts.push(`${r.format === "anthropic" ? "Anthropic's" : "OpenAI's"} format only`);
  const n = leaves(r?.rules || {});
  if (n) parts.push(`${n} rule override${n === 1 ? "" : "s"}`);
  if (r?.enabled === false) parts.push("switched off");
  return parts.join("; ");
}
