// @ts-check
// The usage breakdown Settings › Usage stats reads (the owner's of 11-12): a span of the daily store's days in one
// answer, with what the store keeps no word of — each account as a person knows it and how it bills, what caching
// saved at the list prices as they stand, a project's name. All of it is worked out as it is read, from the days' own
// rows: nothing here is kept.
import { agentName, agentTitle } from "../core/catalogues.js";
import { billingOf, priceCard, statedPricesOf } from "../core/pricing.js";
import { providerForBaseUrl } from "../core/providers.js";
import { MEMORY_PURPOSES, isAgentUpstream, isMachineUpstream } from "../core/schema.js";
import { KEEP_DAYS, localDay } from "../services/daily-usage.js";

/**
 * The days a read asks for, both ends counted: the last `days` up to today on this computer's own calendar, or `from`
 * and `to` as they are given; neither is every day on record.
 * @param {{ days?: number | null, from?: string | null, to?: string | null }} [q] @param {Date} [now]
 * @returns {{ from: string | null, to: string | null }}
 */
export function spanOf({ days = 0, from = null, to = null } = {}, now = new Date()) {
  if (!(Number(days) > 0)) return { from: from || null, to: to || null };
  return { from: localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (Math.floor(Number(days)) - 1))), to: localDay(now) };
}

/**
 * What caching saved over a span's rows, at the list prices as they stand now: the tokens read from cache billed as new
 * input less as cache reads, less what the tokens written to it cost over new input — per row by `priceCard`, the
 * upstream's own card first. A row no table prices is left out and its model named (`unpriced`); so is one whose card
 * names no price for a cache read (`flat`): its reads are billed as input there, and there is no saving to say. `usd`
 * is null where nothing was priced — never $0 —, and negative where more was written than was ever read back. `plan`:
 * the part of it on calls a plan paid for, where it is what they would have cost less and no money paid less. An
 * hour's cache write and a fast or long-context rate are not kept by the day: the figure is an estimate, said as one.
 * @param {{ upstream: string, model: string, cacheRead?: number, cacheWrite?: number }[]} rows
 * @param {(upstream: string) => any} tableOf  an upstream's own pricing rows, or null
 * @param {(row: { upstream: string, model: string }) => boolean} [onPlan]  whether a plan pays for a row's calls
 * @returns {{ usd: number | null, plan: number, models: number, unpriced: string[], flat: string[] }}
 */
export function cacheSaved(rows, tableOf, onPlan = () => false) {
  const usd6 = (/** @type {number} */ v) => Math.round(v * 1e6) / 1e6;
  let usd = 0;
  let plan = 0;
  /** @type {Record<"priced" | "unpriced" | "flat", Set<string>>} */
  const models = { priced: new Set(), unpriced: new Set(), flat: new Set() };
  for (const r of rows) {
    const read = r.cacheRead || 0;
    const wrote = r.cacheWrite || 0;
    if (!read && !wrote) continue;
    const table = tableOf(r.upstream);
    const p = priceCard(r.model, table);
    if (!p || !statedPricesOf(r.model, table).includes("cacheRead")) {
      models[p ? "flat" : "unpriced"].add(r.model);
      continue;
    }
    const saved = (read * (p.input - p.cacheRead) - wrote * (p.cacheWrite - p.input)) / 1e6;
    usd += saved;
    if (onPlan(r)) plan += saved;
    models.priced.add(r.model);
  }
  return { usd: models.priced.size ? usd6(usd) : null, plan: usd6(plan), models: models.priced.size, unpriced: [...models.unpriced].sort(), flat: [...models.flat].sort() };
}

/**
 * Each upstream a row names, as a person knows it: a coding agent's account by its agent and the account's name
 * ("Claude Code · Work"), a provider by its card's name; `of` the agent it is an account of, or the catalogue's
 * provider its address is; `billing` how its calls are paid for where nothing says otherwise of a model. One the
 * configuration no longer holds keeps its id and says `gone`.
 * @param {any} cfg @param {string[]} ids
 * @returns {Record<string, { name: string, kind: "agent" | "provider" | "machine" | "gone", of: string | null, billing: "plan" | "metered" | null }>}
 */
export function accountsOf(cfg, ids) {
  return Object.fromEntries(
    ids.map((id) => {
      const u = (cfg?.upstreams || []).find((/** @type {any} */ x) => x?.id === id) || null;
      if (!u) return [id, { name: id, kind: "gone", of: null, billing: null }];
      if (isAgentUpstream(u)) return [id, { name: agentTitle(u), kind: "agent", of: agentName(u), billing: "plan" }];
      return [id, { name: String(u.name || u.id), kind: isMachineUpstream(u) ? "machine" : "provider", of: providerForBaseUrl(u.baseUrl)?.provider.name ?? null, billing: billingOf("", u).billing }];
    }),
  );
}

/**
 * The breakdown of a span of days (`spanOf`'s): `days`, each day's sums newest first, without its rows; `total`, the
 * span added up with its rows and hours (`DailyUsage.aggregate`); `accounts`, the rows' upstreams in words; `cache`,
 * what caching saved; `who`, the sums by client and by project with each project named by memory's archive; `kept`,
 * what is on record whatever the span — how many days, the first and the last, how many are kept at most and the file.
 * @param {{ usage: any, config: { get: () => any }, memory?: any }} deps
 * @param {{ days?: number | null, from?: string | null, to?: string | null }} [query]
 */
export function usageBreakdown({ usage, config, memory = null }, query = {}) {
  const store = usage.dailyStore;
  const cfg = config.get();
  const span = spanOf(query);
  const total = store.aggregate(span);
  const upstreamOf = (/** @type {string} */ id) => (cfg?.upstreams || []).find((/** @type {any} */ u) => u?.id === id) || null;
  const who = store.who(span);
  return {
    today: localDay(),
    ...span,
    kept: { ...store.reach(), keepDays: KEEP_DAYS, file: store.persist ? store.path : null },
    days: store.list(span).map((/** @type {any} */ { rows, hours, ...sums }) => sums),
    total,
    accounts: accountsOf(cfg, [...new Set(total.rows.map((/** @type {any} */ r) => String(r.upstream)))]),
    cache: cacheSaved(total.rows, (id) => upstreamOf(id)?.pricing || null, (r) => billingOf(r.model, upstreamOf(r.upstream)).billing === "plan"),
    who: {
      ...who,
      projects: who.projects.map((/** @type {any} */ p) => {
        const named = memory?.projectNamed?.(p.id) ?? null;
        return { ...p, name: named?.name ?? null, cwd: named?.cwd ?? null };
      }),
    },
    // Memory's own calls are read apart (`GET /memory/usage`); what each of their purposes is called rides here.
    memoryPurposes: Object.fromEntries(Object.entries(MEMORY_PURPOSES).map(([k, v]) => [k, v.label])),
  };
}
