// @ts-check
// The admin API's update area, `updateRoutes` (the remote desk's s3d): this Filament updated on the person's word from
// another machine's desktop app — its Update Filament, one machine or all — as `filament update --wait` updates it when
// typed there (cli/update.js `createSelfUpdate`): the release asked for, or the newest, restarted on once no turn runs,
// and left for the version before where it does not come up. The person's alone: another machine's agents and a view
// device reach neither row (remote.js AGENT_ROUTES, VIEW_ROUTES), and the update is a press (press.js).
import { sendJson } from "../../app/pipeline/respond.js";
import { guard } from "./guard.js";

/**
 * @param {any} a  the admin context: `selfUpdate` (cli/update.js `createSelfUpdate`), null where nothing wired it
 * @returns {import("../router.js").RouteRow[]}
 */
export function updateRoutes(a) {
  /** Where nothing wired it — a test's Filament —: it cannot. */
  const none = { can: false, why: "This Filament does not update itself on request: filament update there updates it.", version: null };
  return [
    // Whether it can update itself here, and why not (`can`, `why`, its `version`); whether an update runs now, and
    // how the last one went (`last`: the version asked, when, its exit code — null while it runs —, what it said).
    ["GET", "/update", guard(async (r) => sendJson(r.res, 200, a.selfUpdate ? { ...a.selfUpdate.can(), ...(await a.selfUpdate.state()) } : { ...none, running: false, last: null }))],
    // `{ version? }`: an update started → 202 `{ ok, version }`; refused in words — 409 where it cannot or one runs, 400
    // for a version that is none, 502 where systemd did not start it.
    [
      "POST",
      "/update",
      guard(async (r) => {
        if (!a.selfUpdate) return sendJson(r.res, 409, { error: none.why });
        const b = await r.json();
        const version = b?.version == null || b.version === "" ? null : String(b.version);
        try {
          return sendJson(r.res, 202, await a.selfUpdate.start(version));
        } catch (/** @type {any} */ e) {
          if (!e?.status) throw e;
          return sendJson(r.res, e.status, { error: String(e.message) });
        }
      }),
    ],
  ];
}
