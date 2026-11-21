// @ts-check
// The ask for a star (the owner's of 11-22: "a Star filament card similar to how update card is shown, we will show
// this after few hours of usage on filament per user"): once the data folder's Filament has been used in
// `STAR_AFTER_HOURS` different hours — an hour of a day with a model call in it, as Usage counts them by the hour
// (services/daily-usage.js) —, the harness's sidebar asks once for a star on GitHub. GET /star: whether it asks now —
// never once asked (`ui.star.asked`), nor while the usage-stats notice still waits to be said, so two cards never stand
// at once —, the hours counted and the address. POST /star/seen: asked, by Star on GitHub or Not now alike; it never
// asks again.
import { sendJson } from "../../app/pipeline/respond.js";
import { changeFields } from "../../app/config-fields.js";

/** Where a star is given. */
export const STAR_URL = "https://github.com/invertibleMatrix/filament";
/** The hours used before it asks. */
export const STAR_AFTER_HOURS = 5;

/**
 * The hours Filament was used in: each hour of each day with a model call in it, from the days' counts by the hour.
 * @param {{ hours?: number[] }[]} days
 */
export function hoursUsed(days) {
  let n = 0;
  for (const d of days || []) for (const c of Array.isArray(d?.hours) ? d.hours : []) if (c > 0) n++;
  return n;
}

/**
 * Whether the card asks now: not asked yet, used long enough, and no usage-stats notice waiting.
 * @param {{ asked: boolean, hours: number, telemetryNotice: boolean }} o
 */
export const starAsks = ({ asked, hours, telemetryNotice }) => !asked && !telemetryNotice && hours >= STAR_AFTER_HOURS;

/**
 * @param {any} a  the admin context: `config`, `usage` (its `dailyStore`), and `telemetry()`, the service
 * @returns {import("../router.js").RouteRow[]}
 */
export function starRoutes(a) {
  const { config } = a;
  const view = () => {
    const asked = config.get()?.ui?.star?.asked === true;
    // Counted only while it may still ask: once asked, Usage's days are not read again.
    const hours = asked ? 0 : hoursUsed(a.usage?.dailyStore?.list?.() || []);
    const t = a.telemetry?.()?.view?.();
    const telemetryNotice = !!t && t.armed === true && t.why === "notice";
    return { asks: starAsks({ asked, hours, telemetryNotice }), asked, hours, after: STAR_AFTER_HOURS, url: STAR_URL };
  };
  return [
    ["GET", "/star", (r) => sendJson(r.res, 200, view())],
    [
      "POST",
      "/star/seen",
      (r) => {
        changeFields(config, { set: { "ui.star.asked": true } });
        return sendJson(r.res, 200, view());
      },
    ],
  ];
}
