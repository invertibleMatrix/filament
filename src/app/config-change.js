// @ts-check
// A change a feature makes to the configuration, beside the console's editor (HarnessV3-ACP AC3-7, AC3-8: accounts
// added and removed, coding agents connected, turned off and removed): the next configuration normalized, checked and
// saved. A refusal names what was wrong, with the status a route answers it with. And what changed since a page read
// the configuration (HarnessV4_Settings_Plan HS-D3): a write made from an older read is refused with it, in lines.
import { normalizeConfig, validateConfig } from "../services/config/store.js";
import { describeDiff } from "../services/config/diff.js";
import { redactSecrets } from "../services/records.js";

/** A failure a route answers with its status. @param {number} status @param {string} message @param {Record<string, any>} [extra] */
export const failure = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra ? { extra } : {}) });

/**
 * @param {{ set: (cfg: any) => void, save: (o?: { forget?: string[] }) => void }} config  the ConfigStore
 * @param {any} next  the whole configuration as it should be
 * @param {{ forget?: string[] }} [o]  places of secrets the change takes away on purpose: one this secret.key cannot
 *   open goes too, never kept by the save (the store's `save({ forget })`)
 */
export function changeConfig(config, next, { forget = [] } = {}) {
  const merged = normalizeConfig(next);
  const v = validateConfig(merged);
  if (!v.ok) throw failure(400, `the change would leave an invalid configuration: ${v.errors.slice(0, 3).join("; ")}`);
  config.set(merged);
  config.save({ forget });
}

/**
 * A changed value as a line shows it: none or an empty list as a dash, a list of words as they are, a list of objects
 * (a route's backups) or an object as JSON. @param {any} v
 */
const valueWords = (v) =>
  v == null || (Array.isArray(v) && !v.length)
    ? "–"
    : typeof v !== "object" || (Array.isArray(v) && v.every((x) => x == null || typeof x !== "object"))
      ? String(v)
      : JSON.stringify(v);

/**
 * Each change in a line — "upstreams.zai.enabled: true → false" — a credential said as changed, never shown. The op
 * log stores these too: redactSecrets runs over the values again, because a path-pattern mask alone would let through a
 * credential stored under a key nobody thought to list.
 * @param {{ path: string, from: any, to: any, secret?: boolean }[]} diff @param {number} [limit]
 */
export const changeLines = (diff, limit = 12) =>
  diff.slice(0, limit).map((d) => redactSecrets(`${d.path}: ${d.secret ? "•••• (secret)" : `${valueWords(d.from).slice(0, 60)} → ${valueWords(d.to).slice(0, 60)}`}`));

/** One upstream's part of a configuration: its entry and the routes that name it, first or as a backup. @param {any} cfg @param {string} id */
const partOf = (cfg, id) => ({
  upstreams: (cfg?.upstreams || []).filter((/** @type {any} */ u) => u.id === id),
  routes: (cfg?.routes || []).filter((/** @type {any} */ r) => r.upstream === id || (r.fallbacks || []).some((/** @type {any} */ f) => f?.upstream === id)),
});

/**
 * What changed since version `base` was read: the whole configuration, or one upstream's part of it (`only`). Null
 * when that version is no longer kept, so nobody can say.
 * @param {{ get: () => any, at: (v: number) => any }} config @param {number} base @param {string | null} [only]
 */
export function changedSince(config, base, only = null) {
  const then = config.at(base);
  if (!then) return null;
  const now = config.get();
  return only ? describeDiff(partOf(then, only), partOf(now, only)) : describeDiff(then, now);
}

/**
 * What changed since version `base`, in lines, at the version it is now (a page's bar names it): `count` and `changes`
 * are null when that version is no longer kept.
 * @param {{ get: () => any, at: (v: number) => any, version: () => number }} config @param {number} base
 */
export function changesAnswer(config, base) {
  const diff = Number.isInteger(base) ? changedSince(config, base) : null;
  return { version: config.version(), count: diff ? diff.length : null, changes: diff ? changeLines(diff) : null };
}

/**
 * The refusal of a write made from an older read, with what changed since (HS-D3): the page shows it and offers to read
 * again, or to keep its own.
 * @param {{ get: () => any, at: (v: number) => any, version: () => number }} config @param {number} base
 */
export function staleAnswer(config, base) {
  const said = changesAnswer(config, base);
  const n = said.count ?? 0;
  return {
    error: said.changes
      ? `The configuration changed since this page read it (${n} change${n === 1 ? "" : "s"}): read it again, or keep yours to overwrite ${n === 1 ? "it" : "them"}.`
      : "The configuration changed since this page read it, too long ago to say what: read it again, or keep yours to overwrite it.",
    stale: true,
    ...said,
  };
}
