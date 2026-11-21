// @ts-check
// The admin API's models-across-providers area (HarnessV4_Settings_Plan HS-5): the view Settings › Providers' pages and
// search read — every model you can pick with the provider it goes to first and its backups — and its one write, a
// model's backups. Every answer carries the configuration's version, which the page sends back with a write (`base`) so
// one read before a newer change to that model's route is refused, with what changed.
import { sendJson } from "../../app/pipeline/respond.js";
import { aggregateModels } from "../../core/routing.js";
import { modelRoutesView, setBackups } from "../../app/model-routes.js";
import { pressNeeded } from "./config.js";

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function modelRouteRoutes(a) {
  const { config, cfgForModels, discover } = a;
  /** The view, read from the catalogue as last listed: a read never asks a provider for its models. */
  const view = async () => {
    const read = await cfgForModels(false);
    const base = { ...read, upstreams: (read.upstreams || []).map((/** @type {any} */ u) => ({ ...u, hiddenModels: [] })) };
    return { ...modelRoutesView(config.get(), base, await aggregateModels(base, { discover })), version: config.version() };
  };
  return [
    ["GET", "/model-routes", async (r) => sendJson(r.res, 200, await view())],
    [
      "PUT",
      "/model-routes",
      async (r) => {
        const b = (await r.json()) || {};
        try {
          // The route it writes is weighed as a save of the whole configuration is (config.js `pressNeeded`): what is
          // a press there is one here, with no second list (s-rows, 11-12).
          setBackups(config, String(b.name ?? ""), b.backups, b.base == null ? null : Number(b.base), { refuse: (was, next) => pressNeeded(r, next, was) });
        } catch (/** @type {any} */ e) {
          if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 600) return sendJson(r.res, e.status, { error: e.message, ...(e.extra || {}), version: config.version() });
          throw e;
        }
        return sendJson(r.res, 200, await view());
      },
    ],
  ];
}
