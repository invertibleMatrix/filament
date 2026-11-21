// @ts-check
// The admin API's transfers area, `transferRoutes` (the remote plan's cp-send): a copy of a project another machine
// sends here for its agents — the commits its mirror holds, a send opened or opened again, its parts, its end —, each a
// row another machine's agents reach (remote.js AGENT_ROUTES, AGENT_BODIES) and no one else: what comes in lands in
// their machine's store in the copies folder alone (services/transfers.js).
import { sendJson } from "../../app/pipeline/respond.js";
import { agentsDevice } from "../guards.js";
import { guard } from "./guard.js";

/**
 * @param {any} a  the admin context: `transfers` (services/transfers.js)
 * @returns {import("../router.js").RouteRow[]}
 */
export function transferRoutes(a) {
  /**
   * The agents' device that asks, or the refusal sent: these rows are another machine's agents' alone.
   * @param {any} r @returns {string | null}
   */
  const theirs = (r) => {
    if (!agentsDevice(r.who)) {
      sendJson(r.res, 403, { error: "a copy is sent here by another machine's agents alone" });
      return null;
    }
    if (!a.transfers) {
      sendJson(r.res, 503, { error: "this Filament takes no copies" });
      return null;
    }
    return String(r.who.device.id);
  };
  /**
   * An answer, or its refusal with its status: where it stands (`have`), `lacks` where the bundle builds on what
   * this machine does not hold, `runs` where a turn still runs in the copy asked about. @param {any} r @param {any} out
   */
  const answer = (r, out) =>
    out && "status" in out && "error" in out
      ? sendJson(r.res, out.status, { error: out.error, ...(out.have != null ? { have: out.have } : {}), ...(out.lacks ? { lacks: true } : {}), ...(out.runs ? { runs: true } : {}) })
      : sendJson(r.res, 200, out);
  return [
    // `?project=&repo=`: the commits the project's mirror holds, newest first: the next bundle carries only what changed
    // since one of them. `repo` tells its repository from another of that folder's name.
    [
      "GET",
      "/transfers/haves",
      guard(async (r) => {
        const device = theirs(r);
        return device && answer(r, await a.transfers.haves(device, r.url.searchParams.get("project"), r.url.searchParams.get("repo")));
      }),
    ],
    // `{ project, repo, bytes, sha256 }`: a send opened, or opened again → `{ id, have }`, what came of it already, and
    // `done` where it was taken already.
    [
      "POST",
      "/transfers",
      guard(async (r) => {
        const device = theirs(r);
        return device && answer(r, await a.transfers.open(device, await r.json()));
      }),
    ],
    // `{ offset, data }`: a part, in base64, from where the send stands → `{ have }`; 409 with `have` from anywhere else.
    [
      "POST",
      "/transfers/:id/part",
      guard(async (r) => {
        const device = theirs(r);
        return device && answer(r, await a.transfers.part(device, r.params.id, await r.json()));
      }),
    ],
    // `{ project, repo, commit }`: a copy taken for a launch and checked out at a commit the mirror holds → `{ copy, folder,
    // reused }`, the folder its chat starts in.
    [
      "POST",
      "/transfers/place",
      guard(async (r) => {
        const device = theirs(r);
        return device && answer(r, await a.transfers.place(device, await r.json()));
      }),
    ],
    // `{ copy, chat, haves }`: what a launch's sub-agent changed in its copy, captured to go back → `{ id, base, commit,
    // bytes, sha256, … }`, its parts read below; `id` null where nothing is to read (`unchanged`, `had`); 409 with `runs`
    // while a turn of its chat still runs in the copy.
    [
      "POST",
      "/transfers/back",
      guard(async (r) => {
        const device = theirs(r);
        return device && answer(r, await a.transfers.back(device, await r.json()));
      }),
    ],
    // `?offset=`: a part of a capture going back, in base64 → `{ offset, data, end }`.
    [
      "GET",
      "/transfers/back/:id",
      guard(async (r) => {
        const device = theirs(r);
        return device && answer(r, await a.transfers.backPart(device, r.params.id, r.url.searchParams.get("offset")));
      }),
    ],
    // The send's end: checked whole and taken into the project's mirror → `{ commit, project }`.
    [
      "POST",
      "/transfers/:id/commit",
      guard(async (r) => {
        const device = theirs(r);
        return device && answer(r, await a.transfers.commit(device, r.params.id));
      }),
    ],
  ];
}
