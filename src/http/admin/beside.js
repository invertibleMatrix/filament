// @ts-check
// The admin API's teams beside a chat (team_v2_plan §5.3, §5.4): the teams a chat's Team tab lists — each a chat of its
// own, tied to it — fired from its fire card, their switches flipped while they work, a result sent to the main agent,
// BugHunters' ask for Verify…, and Stop. app/teams-beside.js does each; a refusal is answered in its words.
import { sendJson } from "../../app/pipeline/respond.js";
import { guard as guardWith } from "./guard.js";
import { BUGHUNTERS, checkedByNone, verifyAsk } from "../../core/beside.js";

/** What a fire's body is. */
const FIRE_BODY = "a JSON object is required: { team, ask, model?, workers?, most?, total? (how many workers its lead launches in all this run), range? (what a bug hunt hunts in: uncommitted, since <ref>, a..b, or files), verify?, notify?, of? }";
/** What a switch's body is. */
const SET_BODY = "a JSON object is required: { verify?, notify? }, each true or false";

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
      if (/^no such session$/.test(String(e?.message)) && !r.res.headersSent) return sendJson(r.res, 404, { error: "no such session" });
      throw e;
    }
  });

/** A body that is a JSON object, else null. @param {any} r */
const objectBody = async (r) => {
  const b = await r.json();
  return b && typeof b === "object" && !Array.isArray(b) ? b : null;
};

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function besideRoutes(a) {
  /** @returns {import("../../app/teams-beside.js").TeamsBeside} */
  const besides = () => {
    if (!a.besides) throw Object.assign(new Error("teams beside a chat need Filament's archive"), { status: 409 });
    return a.besides;
  };
  /**
   * The team chat a route names, beside the chat it names — else 404.
   * @param {any} r
   */
  const teamOf = (r) => {
    const row = besides().row(String(r.params.tid));
    if (!row || row.main !== String(r.params.id)) throw Object.assign(new Error("no team beside this chat answers to that id"), { status: 404 });
    return row;
  };
  return [
    [
      "GET",
      "/sessions/:id/beside",
      guard((r) => {
        if (!a.memory?.archive?.getChain?.(String(r.params.id))) return sendJson(r.res, 404, { error: "no such session" });
        // `main`: the chat this one runs beside, where it is a team's own — it fires no team of its own — and `self`, its
        // own row, so its Teams tab shows it as its main chat's does (the owner's words of 10-19: the two showed
        // different activity).
        const main = a.memory.archive.mainOf(String(r.params.id));
        return sendJson(r.res, 200, { chainId: r.params.id, main, teams: besides().list(r.params.id), self: main ? besides().row(String(r.params.id)) : null });
      }),
    ],
    [
      // What a team would run on beside the chat now: the fire card says it before Send — its lead's model, its
      // workers', and each model the team names that cannot run, with why. Reads nothing that a fire changes.
      "GET",
      "/sessions/:id/beside/runs-on",
      guard(async (r) => {
        const q = r.url.searchParams;
        const on = await besides().runsOn(r.params.id, q.get("team") || "", { model: q.get("model") || "", workers: q.get("workers") || "" });
        return sendJson(r.res, 200, on);
      }),
    ],
    [
      // What a team's lead would read of the chat, said on the Brief before Send: the chat's finished turns it holds,
      // its size against the lead's window, the turn running now and a question waiting; `whole=1` adds the record
      // itself (Preview…). Local: no model is called, nothing is written.
      "GET",
      "/sessions/:id/beside/reads",
      guard(async (r) => {
        const q = r.url.searchParams;
        const on = await besides().runsOn(r.params.id, q.get("team") || "", { model: q.get("model") || "" });
        const team = a.teams?.find?.(q.get("team") || "");
        const { text, ...facts } = await a.sessions.recordFacts(String(r.params.id), { model: String(on.lead || ""), team: String(team?.name || q.get("team") || "") });
        return sendJson(r.res, 200, { ...facts, lead: on.lead, ...(q.get("whole") === "1" ? { text } : {}) });
      }),
    ],
    [
      // Fire a team beside the chat: Send on its fire card (one press never starts: the card's opening starts nothing).
      "POST",
      "/sessions/:id/beside",
      guard(async (r) => {
        const b = await objectBody(r);
        if (!b) return sendJson(r.res, 400, { error: FIRE_BODY });
        const row = await besides().fire(r.params.id, { team: b.team, ask: b.ask, model: b.model, workers: b.workers, range: b.range, effort: b.effort, workersEffort: b.workersEffort, verify: b.verify, notify: b.notify, of: b.of, reads: b.reads, by: "you" });
        return sendJson(r.res, 200, { ok: true, team: row, teams: besides().list(r.params.id) });
      }),
    ],
    [
      "PATCH",
      "/sessions/:id/beside/:tid",
      guard(async (r) => {
        teamOf(r);
        const b = await objectBody(r);
        if (!b) return sendJson(r.res, 400, { error: SET_BODY });
        return sendJson(r.res, 200, { ok: true, team: besides().set(r.params.tid, b) });
      }),
    ],
    [
      // Notify main agent: the team's result into the main chat — its running turn's next step, else a turn of its own.
      "POST",
      "/sessions/:id/beside/:tid/notify",
      guard(async (r) => {
        teamOf(r);
        const out = await besides().notify(r.params.tid);
        return sendJson(r.res, 200, { ok: true, how: out.how, team: besides().row(r.params.tid) });
      }),
    ],
    [
      // What Verify… fills BugHunters' fire card with: the team's result as claims to check.
      "GET",
      "/sessions/:id/beside/:tid/verify",
      guard((r) => {
        const row = teamOf(r);
        const f = a.sessions.besideFacts(row.id);
        if (!f.last?.final) return sendJson(r.res, 409, { error: "the team has no result to check yet" });
        if (row.checked) return sendJson(r.res, 409, { error: checkedByNone(row.team.name) });
        return sendJson(r.res, 200, { team: BUGHUNTERS, of: row.id, ask: verifyAsk({ name: row.team.name, ask: row.ask, result: f.last.text }) });
      }),
    ],
    [
      // Where a team's lead is now, for its board on the main chat's Teams tab (team_v2_plan §10 O2): its rounds, its
      // newest words, its newest round's calls, what its chat has spent. Its workers are its chat's own sub-agents list.
      "GET",
      "/sessions/:id/beside/:tid/lead",
      guard((r) => {
        const row = teamOf(r);
        return sendJson(r.res, 200, { id: row.id, ...a.sessions.leadFacts(row.id) });
      }),
    ],
    [
      // Its result whole (team_v2_plan §10 O3): Open beside's text and findings, and Send to your agent…'s words.
      "GET",
      "/sessions/:id/beside/:tid/result",
      guard((r) => {
        teamOf(r);
        return sendJson(r.res, 200, besides().result(r.params.tid));
      }),
    ],
    [
      // Its result went from the main chat's box (§10 O3): its card says so.
      "POST",
      "/sessions/:id/beside/:tid/sent",
      guard(async (r) => {
        teamOf(r);
        const b = await objectBody(r);
        if (!b) return sendJson(r.res, 400, { error: "the body is an object: { n, how }" });
        return sendJson(r.res, 200, { ok: true, team: besides().sent(r.params.tid, b) });
      }),
    ],
    [
      // A team's chat deleted from the Agents tab (the owner's ask of 10-23): refused in words while it works.
      "DELETE",
      "/sessions/:id/beside/:tid",
      guard(async (r) => {
        teamOf(r);
        return sendJson(r.res, 200, await besides().drop(r.params.tid));
      }),
    ],
    [
      "POST",
      "/sessions/:id/beside/:tid/stop",
      guard((r) => {
        teamOf(r);
        return sendJson(r.res, 200, { ok: true, ...besides().stop(r.params.tid), team: besides().row(r.params.tid) });
      }),
    ],
  ];
}
