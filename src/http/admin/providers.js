// @ts-check
// The admin API's providers area (HarnessV4_Settings_Plan HS-2, HS-D3): the writes that name one provider — add one,
// change one, see what goes with one, remove one — each made against the configuration as it stands. Every answer
// carries the configuration's version, which a page sends back with a change (`base`) so one read before a newer change
// to the same provider is refused, with what changed. No answer holds a key.
import { sendJson } from "../../app/pipeline/respond.js";
import { configView } from "../../services/config/store.js";
import { pressNeeded } from "./config.js";

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function providerRoutes(a) {
  const { providers, config } = a;
  /**
   * One write's work answered with the version it left, or its refusal with its status and words.
   * @param {any} r @param {() => any} fn
   */
  const answer = async (r, fn) => {
    try {
      return sendJson(r.res, 200, { ...(await fn()), version: config.version() });
    } catch (/** @type {any} */ e) {
      if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 600) return sendJson(r.res, e.status, { error: e.message, ...(e.extra || {}), version: config.version() });
      throw e;
    }
  };
  const idOf = (/** @type {any} */ r) => decodeURIComponent(String(r.params.id || ""));
  /**
   * A write's weigher for its caller: the configuration it would leave, weighed as a save of the whole is (config.js
   * `pressNeeded`, the configuration's own weigher) — so what is a press there is one here, with no second list (s-rows,
   * 11-12): a provider's address moved while its key is kept sends the key there. A new provider with a key of its own,
   * a name, a switch and a model's row are none.
   * @param {any} r @returns {(was: any, next: any) => string | null}
   */
  const weigh = (r) => (was, next) => pressNeeded(r, next, was);
  return [
    ["GET", "/upstreams", (r) => answer(r, () => providers.list())],
    // The console's add flow takes the whole configuration back, as its other saves do.
    ["POST", "/upstreams", (r) => answer(r, async () => ({ upstream: providers.add(await r.json(), { refuse: weigh(r) }), ...configView(config) }))],
    ["PATCH", "/upstreams/:id", (r) => answer(r, async () => {
      const b = (await r.json()) || {};
      const { base = null, ...patch } = b;
      return { upstream: providers.change(idOf(r), patch, base == null ? null : Number(base), { refuse: weigh(r) }) };
    })],
    ["GET", "/upstreams/:id/removal", (r) => answer(r, () => providers.removal(idOf(r)))],
    ["DELETE", "/upstreams/:id", (r) => answer(r, () => providers.remove(idOf(r), { also: r.url.searchParams.get("also") === "1" }))],
  ];
}
