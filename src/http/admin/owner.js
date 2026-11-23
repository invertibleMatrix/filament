// @ts-check
// This computer's owner key (services/owner.js), its one row: POST /owner/session, a browser session for the desktop
// app's windows, minted for a call that holds the key — the app's own main process, which reads it from the data folder
// and keeps the answer as an HttpOnly cookie in its windows' session, so the page itself never holds a secret. Never the
// key itself; a session lasts while this start of Filament does.
import { sendJson } from "../../app/pipeline/respond.js";
import { OWNER_COOKIE } from "../../services/owner.js";

/** What a call without the key is told. */
export const SESSION_REFUSED = "a browser session is minted for a call from this computer with its owner key: the Filament app's own";

/**
 * @param {any} a  the admin context: `owner`, the key (services/owner.js `createOwner`)
 * @returns {import("../router.js").RouteRow[]}
 */
export function ownerRoutes(a) {
  return [
    [
      "POST",
      "/owner/session",
      (r) => {
        if (r.who?.kind !== "local" || !r.who.owner || !a.owner) return sendJson(r.res, 403, { error: SESSION_REFUSED });
        return sendJson(r.res, 200, { cookie: OWNER_COOKIE, token: a.owner.session() }, { "cache-control": "no-store" });
      },
    ],
  ];
}
