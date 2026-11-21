// @ts-check
// /v1/messages/count_tokens, answered LOCALLY and only locally. Counting must never be a data pump: Anthropic's
// "free" count endpoint ships the whole conversation out, and OpenAI-compatible providers have no counting
// endpoint at all — so the owner's rule is no provider is ever contacted for a count. The answer is Filament's own
// estimate (the same estimator compose, the context stamp and the loop's compaction edge use), over the body as it
// would go out.
import { parseModelSuffix } from "../core/shaping.js";
import { findRoute, findUpstream } from "../core/routing.js";
import { errorBody } from "../core/wire/errors.js";
import { estimateBodyTokens } from "../core/tokens.js";
import { renderUpstreamModel } from "../core/routing.js";
import { calibFactor } from "../services/token-calib.js";
import { sendJson } from "./pipeline/respond.js";
import { namesAgentUpstream } from "../core/schema.js";
import { modelsLentTo } from "../services/devices.js";
import { MODEL_MARKS } from "./acp-turn.js";

/** @typedef {import("./deps.js").AppDeps} AppDeps */

/**
 * @param {AppDeps} deps
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export async function handleCountTokens(deps, req, res) {
  const { config, destination, checkInboundAuth, readBody } = deps;
  const cfg = config();
  if (!checkInboundAuth(req))
    return sendJson(res, 401, errorBody("anthropic", 401, "invalid or missing API key"));
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (/** @type {any} */ e) {
    return sendJson(
      res,
      e.status || 400,
      errorBody("anthropic", e.status || 400, e.status ? e.message : "invalid JSON body"),
    );
  }
  const requested = parseModelSuffix(body.model, cfg.rules);
  const route = findRoute(cfg, requested.base) || findRoute(cfg, body.model);
  // Another machine's chat (services/devices.js `modelsLentTo`) counts for the models it may call, as the parse stage
  // refuses it the rest: a name with a mark a coding agent reads, and a coding agent's route.
  if (modelsLentTo(req)) {
    const mark = [...String(body?.model ?? "")].find((c) => Object.hasOwn(MODEL_MARKS, c));
    if (mark) return sendJson(res, 403, errorBody("anthropic", 403, `another machine's chats name a model here alone: "${mark}" in ${body.model} names ${MODEL_MARKS[mark]}`));
    if (route && namesAgentUpstream(cfg, route.upstream))
      return sendJson(res, 403, errorBody("anthropic", 403, `another machine's chats use this machine's API models; ${body.model} is answered by a coding agent, which works on this machine alone`));
  }
  const acpUp = route && findUpstream(cfg, route.upstream);
  // The calibration key is the RENDERED wire model — the same name the observation sites saw on the body they
  // estimated.
  const factorKey = (route) =>
    parseModelSuffix(
      renderUpstreamModel(route?.upstreamModel, requested.base, route?.captures || []) || requested.base || body.model,
      cfg.rules,
    ).base;
  if (acpUp && destination(acpUp)?.agent) {
    // A coding agent's upstream: its count is Filament's own local estimate, in the upstream's mode — on the scale the
    // model its turns were counted under showed over the API, where the estimator has learned one, else the plain
    // class-weighted one (services/token-calib.js).
    const est = acpUp.acp?.inputTokenEstimate || "conversation";
    return sendJson(res, 200, {
      input_tokens: est === "none" ? 0 : estimateBodyTokens(body, est === "request" ? "request" : "conversation", calibFactor(acpUp.id, factorKey(route))),
    });
  }
  // The whole prompt as it would go out: system, messages, tools — counted here, sent nowhere. Calibrated by what
  // this upstream's past replies actually reported, when they did.
  return sendJson(res, 200, { input_tokens: estimateBodyTokens(body, "request", acpUp ? calibFactor(acpUp.id, factorKey(route)) : null) });
}
