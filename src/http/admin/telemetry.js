// @ts-check
// Anonymous telemetry's door (services/telemetry.js): what Settings › Data and privacy and the harness's one-time notice
// read and say. GET /telemetry: whether it sends, and why not (not armed: a test's Filament; off by the environment,
// the setting, or the default of a build that is not official; the notice not shown yet), whether it sends where the
// person chose nothing, with the body last sent as it went. POST
// /telemetry/notice-seen: the notice was shown — `off: true` when the person turned it off from it —, and a look at once.
import { sendJson } from "../../app/pipeline/respond.js";
import { changeFields } from "../../app/config-fields.js";

/**
 * @param {any} a  the admin context: `config`, and `telemetry()`, the service
 * @returns {import("../router.js").RouteRow[]}
 */
export function telemetryRoutes(a) {
  const { config } = a;
  const service = () => /** @type {import("../../services/telemetry.js").Telemetry | null} */ (a.telemetry?.() || null);
  const view = () => service()?.view() || { on: false, why: "not-armed", armed: false, onByDefault: false, last: null, waiting: 0 };
  return [
    ["GET", "/telemetry", (r) => sendJson(r.res, 200, view())],
    [
      "POST",
      "/telemetry/notice-seen",
      async (r) => {
        const b = (await r.json().catch(() => null)) || {};
        changeFields(config, { set: { "telemetry.noticeSeen": true, ...(b.off === true ? { "telemetry.enabled": false } : {}) } });
        void service()?.look();
        return sendJson(r.res, 200, view());
      },
    ],
  ];
}
