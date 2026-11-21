// @ts-check
// The request is read and checked: the inbound key, a JSON body with a model name, a route for that name
// (`agent/<model>` resolves to the agent loop, for Filament's own requests). Anything missing is
// answered here, in the client's format, and the request goes no further.
import { parseModelSuffix } from "../../../core/shaping.js";
import { findRoute, listedParse } from "../../../core/routing.js";
import { namesAgentUpstream, namesMachineUpstream } from "../../../core/schema.js";
import { keptStateNamed } from "../../../core/provider-state.js";
import { forAnotherMachine, modelsLentTo } from "../../../services/devices.js";
import { MODEL_MARKS } from "../../acp-turn.js";
import { flexParse } from "../../../core/model-caps.js";
import { lowerHeaders } from "../../../core/headers.js";
import { ADDS_HEADER } from "../../../core/conversation.js";
import { admitHeaders } from "../../../services/house.js";
import { errorBody } from "../../../core/wire/errors.js";
import { parseAgentModel } from "../../agent/turn.js";
import { sendJson } from "../respond.js";
import { agentRoute, harnessRunsLoop } from "../../engine.js";
import { sentThrough } from "../../internal-call.js";
import { namedCopies } from "../../../core/tokens.js";

/** @type {import("../context.js").Stage} */
export async function parseAndAuthenticate(ctx, { config, checkInboundAuth, readBody, readsEverySession }) {
  const { req, res, format, pre } = ctx;
  const cfg = config();
  if (!checkInboundAuth(req)) {
    sendJson(res, 401, errorBody(format, 401, "invalid or missing API key (Filament inbound key)"));
    return "replied";
  }
  let raw, body;
  if (pre) {
    raw = pre.raw;
    body = pre.body;
  } else
    try {
      raw = await readBody(req);
      body = JSON.parse(raw);
    } catch (/** @type {any} */ e) {
      sendJson(
        res,
        e.status || 400,
        errorBody(format, e.status || 400, e.status ? e.message : "invalid JSON body"),
      );
      return "replied";
    }
  if (!body || typeof body !== "object" || typeof body.model !== "string") {
    sendJson(res, 400, errorBody(format, 400, "body.model is required"));
    return "replied";
  }
  // Another machine's chats call this machine's models by their name alone (services/devices.js `modelsLentTo`, the
  // remote-agents plan's m-door): a mark is read by a coding agent (acp-turn.js `MODEL_MARKS`), and none of its traffic
  // goes out through another machine.
  const lent = modelsLentTo(req);
  const mark = lent ? [...body.model].find((c) => Object.hasOwn(MODEL_MARKS, c)) : null;
  if (mark) {
    sendJson(res, 403, errorBody(format, 403, `another machine's chats name a model here alone: "${mark}" in ${body.model} names ${MODEL_MARKS[mark]}`));
    return "replied";
  }
  // Nor what this machine's provider keeps on its account (core/provider-state.js) — a Responses call's fields as its
  // client sent them, which a Responses upstream is sent as they are —; and a completion is stored nowhere there.
  const kept = lent ? keptStateNamed(pre?.responsesBody ? "responses" : format, pre?.responsesBody || body) : "";
  if (kept) {
    sendJson(res, 400, errorBody(format, 400, `another machine's chat names ${kept}, which this machine's provider keeps on this machine's account: send what it holds instead`));
    return "replied";
  }
  // A completion asked to be stored is not; one that says nothing is stored by no provider — OpenAI's own unsaid is false —,
  // and a strict OpenAI-compatible one refuses a field it does not know, so none is added.
  if (lent && format === "openai" && !pre && Object.hasOwn(body, "store")) body.store = false;
  // A hole in the conversation (`null` where a message should be — a client that serialised an undefined variable)
  // is the client's mistake, said as one, not a stack trace from the first stage that reads `.content`.
  if (Array.isArray(body.messages)) {
    const hole = body.messages.findIndex((m) => m === null || typeof m !== "object");
    if (hole >= 0) {
      sendJson(res, 400, errorBody(format, 400, `messages[${hole}] must be a message object, got ${body.messages[hole] === null ? "null" : typeof body.messages[hole]}`));
      return "replied";
    }
  }
  ctx.raw = raw;
  ctx.body = body;
  // The request's headers as the pipeline may believe them: lineage and Filament's own user agents only from a house
  // call, a session named to be loaded only from a caller that could read every session anyway. A front door's own
  // headers (a session turn's chain, folder, permissions, the session it loads) sit beside them, and win.
  const reads = !!readsEverySession?.(req);
  const admitted = admitHeaders(lowerHeaders(req.headers), { reads });
  ctx.headers = { ...admitted.headers, ...(pre?.headers || {}) };
  // A chat's own turn is Filament's, its turn kept whatever came with it: a client's ask to add nothing
  // (core/conversation.js `addsNothing`) counts at the front door alone (the review of c04dd3507).
  if (pre?.api === "session") delete ctx.headers[ADDS_HEADER];
  ctx.house = admitted.house;
  // A call of Filament's own that sent its body as it is, read back here as its copy: each block of the copy is named
  // after the block it copies, and weighed by what that one weighed (internal-call.js `sentThrough`).
  const sent = !pre && admitted.house ? sentThrough(String(req.headers["x-filament-call"] || "")) : null;
  ctx.weights = sent && Array.isArray(body.messages) ? namedCopies(sent.weights, sent.messages, body.messages) : null;
  ctx.setAside = admitted.setAside;
  // Whether the caller reaches every session's memory, as the caller is: Filament's own calls are made on this
  // machine.
  ctx.reads = reads;
  ctx.requested = parseModelSuffix(body.model, cfg.rules);
  // A name its upstream lists whole (a provider's own kimi-k3-fast or qwen3-max) is that model, not a base carrying
  // Filament's suffix: it routes and forwards as sent — and with Filament's words after it (kimi-k3-fast-high, the
  // session's level riding the provider's id), only those words are read.
  ctx.requested = listedParse(cfg, body.model) || ctx.requested;
  // Filament's `-flex` (Providers P5): read only on a model whose row declares a flex tier with its fields — a
  // provider's own `-flex` id declares nothing and stays that id.
  ctx.requested = flexParse(cfg, ctx.requested);
  // `agent/<model>` is Filament's own name for its loop, always on (the owner's of 11-09) — a call of Filament's own (a
  // sub-agent's) or a harness turn's, on /v1/messages, the door they take: it resolves to the loop, never to a plain
  // route. An outside client's, or one on another door, is no model of Filament's and falls through to the routes (a
  // 404 where none matches): an outside client gets a plain proxy plus memory.
  ctx.agent = format === "anthropic" && (ctx.house || pre?.api === "session") ? parseAgentModel(body.model) : null;
  // The harness runs on the loop, period — its turns never need the `agent/` prefix: a session turn that names a
  // plain LLM route (not a coding agent's own route, and a route that exists) runs as if it had named `agent/<model>`.
  // Outside clients keep the plain meaning of the same name, and Filament's own calls never come this way: a loop's
  // tick and a sub-agent's run are not pre.api "session", and a coding agent's own cycle, which is, carries the house
  // key — it goes to the agent whose cycle it shows (dispatch's `ownCycle`), whatever its route names first now.
  // The loop runs the name as sent, suffixes and all: the session's effort and fast mode ride it (`-high-fast`), and
  // every tick's own parse turns them into the request's effort and speed — the base alone would drop both.
  if (!ctx.agent && !ctx.house && pre?.api === "session" && harnessRunsLoop(cfg, body.model, ctx.requested.base)) ctx.agent = parseAgentModel(`agent/${body.model}`);
  // A harness session's engine (engine.mode) may re-resolve the name after situate: the engine stage uses the same
  // builders.
  ctx.route = ctx.agent ? agentRoute(ctx.agent) : findRoute(cfg, ctx.requested.base) || findRoute(cfg, body.model);
  if (!ctx.route) {
    sendJson(
      res,
      404,
      errorBody(format, 404, `no route matches model "${body.model}". Add one on the Routes page.`),
    );
    return "replied";
  }
  // Theirs is an API model's answer: a coding agent's route would have its agent work on this machine for them — one
  // switched off too, which may be on again by the time the call is sent. Its backups that are one the route stage
  // leaves out, and the dispatch stage refuses one where it is reached.
  if (lent && namesAgentUpstream(cfg, ctx.route.upstream)) {
    sendJson(res, 403, errorBody(format, 403, `another machine's chats use this machine's API models; ${body.model} is answered by a coding agent, which works on this machine alone`));
    return "replied";
  }
  // Nor a third machine's models, which that machine lends to this one alone (m-upstream): the route stage leaves out a
  // backup that is one. A loop's call for another machine's agents' chat here neither (`forAnotherMachine`).
  if (forAnotherMachine(req, ctx.headers) && namesMachineUpstream(cfg, ctx.route.upstream)) {
    sendJson(res, 403, errorBody(format, 403, `another machine's chats use this machine's own models; ${body.model} is answered by another machine's, which it lends to this machine alone`));
    return "replied";
  }
  return "continue";
}
