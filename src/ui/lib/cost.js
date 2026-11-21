// @ts-check
// What a request, a turn or a period paid and what the same tokens cost at list price (Providers P4, D8), in words —
// DOM-free, for every surface that shows a cost. Spend is analytics: on a plan a request pays $0, and its list price
// is what it was worth. A figure nobody knows is "–", never $0. When the two agree (billed per token at the card) one
// figure is said.
import { fmt } from "./format.js";

/**
 * Whether the list figure says anything the paid one does not.
 * @param {unknown} paid @param {unknown} list
 */
export const listDiffers = (paid, list) => typeof list === "number" && (typeof paid !== "number" || Math.abs(list - paid) > 1e-9);

/**
 * One cost as a chip or a cell says it: "$0.0123" when paid at list price, "paid $0.0000 · at list $0.2900" when the
 * two part (a plan; a provider's own charge), "at list $0.29" when what was paid is unknown (an agent's estimated
 * tokens), "–" when nothing is known.
 * @param {unknown} paid @param {unknown} list
 * @param {{ usd?: (n: number) => string }} [o]  the figure's own format (the footer's is shorter)
 * @returns {{ text: string, title: string, paid: number | null, list: number | null }}
 */
export function costWords(paid, list, { usd = fmt.usd } = {}) {
  const p = typeof paid === "number" ? paid : null;
  const l = typeof list === "number" ? list : null;
  if (p == null && l == null) return { text: "–", title: "no price known", paid: p, list: l };
  if (!listDiffers(p, l)) return { text: usd(/** @type {number} */ (p)), title: l == null ? "what it paid; no list price is known" : "paid at list price", paid: p, list: l };
  if (p == null) return { text: `at list ${usd(/** @type {number} */ (l))}`, title: `what it paid is unknown (an agent's tokens are estimates); ${usd(/** @type {number} */ (l))} at list price`, paid: p, list: l };
  return {
    text: `paid ${usd(p)} · at list ${usd(/** @type {number} */ (l))}`,
    title: p === 0 ? `on a plan: paid $0; the same tokens cost ${usd(/** @type {number} */ (l))} at list price` : `paid ${usd(p)}, what the provider charged; ${usd(/** @type {number} */ (l))} at list price`,
    paid: p,
    list: l,
  };
}

/**
 * A rollup row's three figures (the daily store's `cost`/`costN`, `listCost`/`listCostN`, `planListCost`): paid, at
 * list price, and saved by plans (the list figure of the requests a plan paid $0 for) — "–" where nothing counted.
 * `unlisted` says how many of its requests carry no list figure (their model has no price card).
 * @param {any} r
 * @returns {{ paid: string, list: string, saved: string, unlisted: number }}
 */
export function rollupCosts(r) {
  const listN = Number(r?.listCostN) || 0;
  return {
    paid: r?.costN ? fmt.usd(r.cost) : "–",
    list: listN ? fmt.usd(r.listCost) : "–",
    saved: listN && Number(r.planListCost) > 0 ? fmt.usd(r.planListCost) : "–",
    unlisted: Math.max(0, (Number(r?.requests) || 0) - listN),
  };
}

/**
 * The per-model figures of a session's spend ledger (`usage.byModel`, Providers P4), the biggest list figure first.
 * @param {any} usage  the session's usage ledger (`usageOf`)
 * @returns {{ rows: { model: string, usd: number, listUsd: number, requests: number }[] }}
 */
export function byModelRows(usage) {
  const rows = Object.entries(usage?.byModel || {})
    .map(([model, m]) => ({ model, usd: Number(/** @type {any} */ (m).usd) || 0, listUsd: Number(/** @type {any} */ (m).listUsd) || 0, requests: Number(/** @type {any} */ (m).requests) || 0 }))
    .sort((a, b) => b.listUsd - a.listUsd || b.usd - a.usd || b.requests - a.requests);
  return { rows };
}

/**
 * The request drawer's sentence: how the request was billed, with its two figures. A request still running has no
 * billing yet, so its cost reads as it stands.
 * @param {any} r  a request record
 */
export function billingWords(r) {
  const list = typeof r?.listCost === "number" ? r.listCost : null;
  if (r?.billing === "plan") return `On a plan: paid ${fmt.usd(Number(r.cost) || 0)}${list != null ? ` · ${fmt.usd(list)} at list price` : " · no list price (nobody prices this model here)"}.`;
  const paid = typeof r?.cost === "number" ? fmt.usd(r.cost) : "no price known";
  const charged = r?.costSource === "provider" ? " (the provider's own charge)" : "";
  const both = listDiffers(r?.cost, list) ? ` paid${charged} · ${fmt.usd(/** @type {number} */ (list))} at list price` : charged;
  return r?.billing === "metered" ? `Billed per token: ${paid}${both}.` : `Cost ${paid}${both}.`;
}
