// @ts-check
// Each model's backups (HarnessV4_Settings_Plan HS-5), as Settings › Providers' pages and Settings search read them (the
// owner's settings cleanup of 11-09): every model you can pick, across providers and coding agents — the provider it
// goes to first and its backups in order, whether it is in the picker, its window and price — and the one write the
// pages make: a model's backups, made against the route that catches it as it stands, refused when that route changed
// since the page read it (HS-D3).
// - `modelRoutesView(cfg, base, all)`: the page's view, from the configuration and the catalogue with nothing hidden.
// - `setBackups(config, name, rows, base)`: a model's backups kept (core/backups.js says how).
import { buildFamilies } from "../core/model-families.js";
import { backupsOf, backupsProblem, withBackups, routeWords } from "../core/backups.js";
import { prefixRouteOf } from "../core/providers.js";
import { isAgentUpstream } from "../core/schema.js";
import { describeDiff } from "../services/config/diff.js";
import { changeConfig, changeLines, failure } from "./config-change.js";

/** @param {unknown} s */
const low = (s) => String(s ?? "").toLowerCase();
/** @param {any} cfg @param {string} id */
const upOf = (cfg, id) => (cfg?.upstreams || []).find((/** @type {any} */ u) => u.id === id) || null;

/**
 * The page's view.
 * @param {any} cfg  the configuration as kept: its routes, and what each provider hides
 * @param {any} base  the configuration the catalogue was read from: a coding agent's names merged into its list, and
 *   nothing hidden, so a model out of the picker has its row too
 * @param {{ models: any[], upstreams: Record<string, any> }} all  `aggregateModels` over `base`
 */
export function modelRoutesView(cfg, base, all) {
  const rowOf = new Map((all.models || []).map((m) => [m.id, m]));
  /** The names a provider serves: its list as last read, else the names typed on it. @param {string} id */
  const namesOf = (id) => {
    const listed = all.upstreams?.[id]?.all;
    return Array.isArray(listed) ? listed.map(String) : (upOf(base, id)?.models || []).map(String);
  };
  /** @param {string} id */
  const who = (id) => {
    const u = upOf(cfg, id);
    return { id, name: u ? String(u.name || u.id) : `${id} (gone)`, agent: isAgentUpstream(u), enabled: !!u && u.enabled !== false };
  };
  /** The routes a model's row stands for: they are not listed again under "set in the console". @type {Set<number>} */
  const drawn = new Set();
  const families = buildFamilies(base, all.models || []);
  const models = families
    .filter((f) => f.kind !== "other")
    .map((f) => {
      const up = upOf(cfg, f.upstream);
      const hiddenLow = new Set((up?.hiddenModels || []).map(low));
      const lead = f.members.find((x) => !x.effort && !x.speed && !x.thinking && !x.window) || f.members[0];
      const members = f.members.map((x) => {
        const r = rowOf.get(x.id);
        const name = String(r?.upstreamModel ?? x.id);
        // a name an exact route makes is always offered; the provider's list speaks for the rest
        const hidable = r?.source !== "route";
        return { id: x.id, name, hidable, hidden: hidable && hiddenLow.has(low(name)) };
      });
      const b = backupsOf(cfg, lead.id);
      if (b?.exact) drawn.add(b.index);
      return {
        id: f.id,
        lead: lead.id,
        label: f.label || null,
        kind: f.kind,
        upstream: who(f.upstream),
        members,
        window: f.window || null,
        contextWindow: f.context_window || null,
        price: f.price || null,
        billing: f.codingAgent ? "agent" : f.billing || null,
        sent: b?.sent ?? String(rowOf.get(lead.id)?.upstreamModel ?? lead.id),
        route: b ? { match: b.match, exact: b.exact } : null,
        backups: (b?.backups || []).map((x) => ({ ...who(x.upstream), sent: x.sent, listed: namesOf(x.upstream).includes(x.sent) })),
        strategy: b?.strategy || "in_order",
        format: b?.format || "auto",
        ruleOverrides: b?.ruleOverrides || 0,
        can: !!b?.can,
        why: b ? b.why : "No route takes it.",
        // the ids of a family of variant ids that its lead's backups do not cover (HS-D65)
        alone: f.kind === "variants" ? f.members.filter((x) => x.id !== lead.id).map((x) => x.id) : [],
      };
    });
  const routes = (cfg.routes || [])
    .map((/** @type {any} */ r, /** @type {number} */ i) => ({ r, i }))
    .filter(({ r, i }) => !drawn.has(i) && prefixRouteOf(cfg, r.upstream) !== r)
    .map(({ r }) => ({ match: String(r.match || ""), upstream: String(r.upstream || ""), enabled: r.enabled !== false, words: routeWords(cfg, r) }));
  return {
    failover: cfg.rules?.resilience?.failover === true,
    models,
    providers: (cfg.upstreams || [])
      .filter((/** @type {any} */ u) => !isAgentUpstream(u))
      .map((/** @type {any} */ u) => ({ id: u.id, name: String(u.name || u.id), enabled: u.enabled !== false, names: namesOf(u.id) })),
    routes,
  };
}

/** The part of a configuration a name's backups live in: the route that catches it. @param {any} cfg @param {string} name */
const partOf = (cfg, name) => {
  const at = backupsOf(cfg, name);
  return { route: at ? cfg.routes[at.index] : null };
};

/**
 * What changed in the route that catches `name`, in words: its backups then and now, by their providers' names — else,
 * where the backups are the same, the route's own changed lines.
 * @param {any} then @param {any} now @param {string} name @param {{ path: string, from: any, to: any }[]} diff
 */
const changeWords = (then, now, name, diff) => {
  const list = (/** @type {any} */ cfg) => {
    const at = backupsOf(cfg, name);
    const nameOf = (/** @type {string} */ id) => String((cfg.upstreams || []).find((/** @type {any} */ u) => u.id === id)?.name || id);
    return at?.backups.length ? at.backups.map((/** @type {any} */ b) => `${nameOf(b.upstream)} as ${b.sent}`).join(", then ") : "none";
  };
  const was = list(then);
  const is = list(now);
  return was === is ? changeLines(diff) : [`they were ${was}; now ${is}`];
};

/**
 * A model's backups kept. `base`: the version the page read them at — when the route that catches the name changed
 * since, the change is refused with what changed (HC-100). `refuse`: its caller's weigher — why the configuration it
 * would leave is not saved, or null where it is; the press key's (http/admin/config.js `pressNeeded`, the
 * configuration's own weigher: what is a press in a save of the whole is one here; s-rows, 11-12) —, refused with
 * `press: true` before anything moves, as a field's is (config-fields.js).
 * @param {{ get: () => any, at: (v: number) => any, version: () => number, set: (cfg: any) => void, save: () => void }} config
 * @param {string} name @param {unknown} rows @param {number | null} [base]
 * @param {{ refuse?: ((was: any, next: any) => string | null) | null }} [o]
 */
export function setBackups(config, name, rows, base = null, { refuse = null } = {}) {
  const n = String(name || "").trim();
  if (!n) throw failure(400, "Name the model whose backups these are.");
  const cfg = config.get();
  if (Number.isInteger(base) && base !== config.version()) {
    const then = config.at(/** @type {number} */ (base));
    if (!then) throw failure(409, `${n}'s backups were read too long ago to tell what changed since: read them again.`, { stale: true });
    const diff = describeDiff(partOf(then, n), partOf(cfg, n));
    if (diff.length) throw failure(409, `${n}'s backups changed since this page read them: read them again.`, { stale: true, changes: changeWords(then, cfg, n, diff) });
  }
  const problem = backupsProblem(cfg, n, rows);
  if (problem) throw failure(problem.status, problem.words);
  const next = withBackups(cfg, n, /** @type {any[]} */ (rows));
  const no = refuse?.(cfg, next);
  if (no) throw failure(403, no, { press: true });
  changeConfig(config, next);
}
