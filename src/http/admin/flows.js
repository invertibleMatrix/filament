// @ts-check
// The admin API's flows (HarnessV4_Flow_Plan F4; HarnessV4_OneAgent_Plan OA3, OA4): a chat's flows — designed by its
// main agent after /flow (its flow tool, not a route), drawn by hand or from a saved flow, edited, started beside the
// chat or In place, decided at a gate or the person's review, stopped, gone on with after a restart — and the saved
// flows (F6). app/flow-runner.js does each; a refusal is answered in its words.
import { sendJson } from "../../app/pipeline/respond.js";
import { guard as guardWith } from "./guard.js";

/**
 * The runner's refusals name their status and are answered with their words; anything else is the shared guard's 500.
 * @param {(r: any, a: any) => any} fn
 */
const guard = (fn) =>
  guardWith(async (r, a) => {
    try {
      return await fn(r, a);
    } catch (/** @type {any} */ e) {
      if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 500 && !r.res.headersSent) return sendJson(r.res, e.status, { error: e.message });
      throw e;
    }
  });

/** A body that is a JSON object, else null. @param {any} r */
const objectBody = async (r) => {
  const b = await r.json();
  return b && typeof b === "object" && !Array.isArray(b) ? b : null;
};

/** The box acts a route names. */
const BOX_ACTS = ["stop", "skip", "retry", "hand-on", "take"];

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function flowRoutes(a) {
  /** @returns {import("../../app/flow-runner.js").FlowRunner} */
  const flows = () => {
    if (!a.flows) throw Object.assign(new Error("flows need Filament's archive"), { status: 409 });
    return a.flows;
  };
  /** @returns {import("../../services/saved-flows.js").SavedFlows} */
  const saved = () => {
    if (!a.savedFlows) throw Object.assign(new Error("saved flows need Filament's data folder"), { status: 409 });
    return a.savedFlows;
  };
  return [
    ["GET", "/sessions/:id/flows", guard((r) => sendJson(r.res, 200, { chainId: r.params.id, flows: flows().list(String(r.params.id)) }))],
    // The files of the chat's folder a draft's worktree would leave there, which its card says (OA5): asked on its own,
    // git walking the folder for it, so the list never waits on it. `{ uncommitted }`: how many, or null where there is
    // nothing to say; with `error`, why git could not tell — the card says so, and Start is not held on it.
    ["GET", "/sessions/:id/flows/uncommitted", guard(async (r) => sendJson(r.res, 200, await flows().leftBehind(String(r.params.id))))],
    [
      // A flow by hand (Agents › New flow), or from a saved one with the person's words.
      "POST",
      "/sessions/:id/flows",
      guard(async (r) => {
        const b = await objectBody(r);
        if (!b) return sendJson(r.res, 400, { error: "the body is an object: { flow } or { saved, goal }" });
        const flow = b.saved != null ? flows().fromSaved(String(r.params.id), b.saved, b.goal) : flows().create(String(r.params.id), b.flow || b);
        return sendJson(r.res, 200, { ok: true, flow });
      }),
    ],
    ["GET", "/sessions/:id/flows/:fid", guard((r) => sendJson(r.res, 200, flows().get(String(r.params.id), String(r.params.fid))))],
    [
      "PUT",
      "/sessions/:id/flows/:fid",
      guard(async (r) => {
        const b = await objectBody(r);
        if (!b) return sendJson(r.res, 400, { error: "the body is an object: { steps?, goal?, title?, tell? }" });
        return sendJson(r.res, 200, { ok: true, flow: flows().edit(String(r.params.id), String(r.params.fid), b) });
      }),
    ],
    // Remove takes it off the list; `?runs=1`, the Agents tab's Delete (the owner's ask of 10-23), what it ran with it.
    [
      "DELETE",
      "/sessions/:id/flows/:fid",
      guard(async (r) => {
        const [id, fid] = [String(r.params.id), String(r.params.fid)];
        return sendJson(r.res, 200, r.url.searchParams.get("runs") === "1" ? await flows().removeAll(id, fid) : flows().remove(id, fid));
      }),
    ],
    [
      // Start: the person's one press that runs it (FL-D2) — beside the chat, or `{ inPlace: true }`: a turn of the main
      // agent drives it (OA4).
      "POST",
      "/sessions/:id/flows/:fid/start",
      guard(async (r) => {
        const b = (await objectBody(r)) || {};
        const id = String(r.params.id);
        const fid = String(r.params.fid);
        return sendJson(r.res, 200, { ok: true, flow: b.inPlace === true ? await flows().startInPlace(id, fid) : flows().start(id, fid) });
      }),
    ],
    [
      // At a gate that did not say go (§4.5): { action: "back", to, line } | { action: "on" } | { action: "stop" }; at
      // the person's review (OA-D10) the same, with its box: { box, action, to?, line? }.
      "POST",
      "/sessions/:id/flows/:fid/decide",
      guard(async (r) => {
        const b = await objectBody(r);
        if (!b) return sendJson(r.res, 400, { error: "the body is an object: { action, to?, line? }" });
        return sendJson(r.res, 200, { ok: true, flow: flows().decide(String(r.params.id), String(r.params.fid), b) });
      }),
    ],
    ["POST", "/sessions/:id/flows/:fid/stop", guard((r) => sendJson(r.res, 200, { ok: true, flow: flows().stop(String(r.params.id), String(r.params.fid)) }))],
    // After a restart: Go on, the person's one press (FL-D19).
    ["POST", "/sessions/:id/flows/:fid/go-on", guard((r) => sendJson(r.res, 200, { ok: true, flow: flows().goOn(String(r.params.id), String(r.params.fid)) }))],
    // Its end message again, where it did not go.
    ["POST", "/sessions/:id/flows/:fid/send", guard((r) => sendJson(r.res, 200, { ok: true, flow: flows().send(String(r.params.id), String(r.params.fid)) }))],
    [
      // A drawn flow kept to start again (F6).
      "POST",
      "/sessions/:id/flows/:fid/keep",
      guard(async (r) => {
        const b = (await objectBody(r)) || {};
        return sendJson(r.res, 200, { ok: true, saved: flows().keep(String(r.params.id), String(r.params.fid), b) });
      }),
    ],
    ["GET", "/sessions/:id/flows/:fid/boxes/:bid", guard((r) => sendJson(r.res, 200, flows().result(String(r.params.id), String(r.params.fid), String(r.params.bid))))],
    [
      "POST",
      "/sessions/:id/flows/:fid/boxes/:bid/:act",
      guard((r) => {
        const act = String(r.params.act);
        if (!BOX_ACTS.includes(act)) return sendJson(r.res, 404, { error: `a box's act is ${BOX_ACTS.join(", ")}` });
        return sendJson(r.res, 200, { ok: true, flow: flows().box(String(r.params.id), String(r.params.fid), String(r.params.bid), act) });
      }),
    ],
    ["GET", "/flows/saved", guard((r) => sendJson(r.res, 200, { flows: saved().list() }))],
    ["DELETE", "/flows/saved/:key", guard((r) => sendJson(r.res, 200, saved().remove(String(r.params.key))))],
  ];
}
