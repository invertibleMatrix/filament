// @ts-check
// /v1/embeddings: routed by model like chat, forwarded to an OpenAI-compatible upstream's /v1/embeddings, recorded.
import { parseModelSuffix } from "../core/shaping.js";
import {
  findRoute,
  findUpstream,
  renderUpstreamModel,
  upstreamVersionedBase,
  authHeaders,
} from "../core/routing.js";
import { lowerHeaders } from "../core/headers.js";
import { errorBody } from "../core/wire/errors.js";
import { admitHeaders } from "../services/house.js";
import { providerFetch } from "../adapters/providers/fetch.js";
import { sendJson } from "./pipeline/respond.js";

/** @typedef {import("./deps.js").AppDeps} AppDeps */

/**
 * @param {AppDeps} deps
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export async function handleEmbeddings({ config, usage, finish, checkInboundAuth, readBody }, req, res) {
  const cfg = config();
  if (!checkInboundAuth(req))
    return sendJson(res, 401, errorBody("openai", 401, "invalid or missing API key (Filament inbound key)"));
  let raw, body;
  try {
    raw = await readBody(req);
    body = JSON.parse(raw);
  } catch (/** @type {any} */ e) {
    return sendJson(
      res,
      e.status || 400,
      errorBody("openai", e.status || 400, e.status ? e.message : "invalid JSON body"),
    );
  }
  if (!body?.model || body.input == null)
    return sendJson(res, 400, errorBody("openai", 400, "model and input are required"));
  const requested = parseModelSuffix(body.model, cfg.rules);
  const route = findRoute(cfg, requested.base) || findRoute(cfg, body.model);
  if (!route) return sendJson(res, 404, errorBody("openai", 404, `no route matches model "${body.model}"`));
  const upstream = findUpstream(cfg, route.upstream);
  if (!upstream || !["openai", "openai-compatible"].includes(upstream.type))
    return sendJson(
      res,
      502,
      errorBody(
        "openai",
        502,
        `route "${route.match}" points at ${upstream?.type || "a missing upstream"}, which has no embeddings endpoint; embeddings need an OpenAI-compatible upstream`,
      ),
    );
  const model = renderUpstreamModel(route.upstreamModel, requested.base, route.captures || []);
  const rec = usage.start({
    format: "embeddings",
    model: body.model,
    route: route.match,
    upstream: upstream.id,
    upstreamModel: model,
    stream: false,
    clientIp: req.socket.remoteAddress,
    ua: admitHeaders(lowerHeaders(req.headers)).headers["user-agent"] || "",
  });
  // Under the base's own version, as chat, the model list and the connection test are: …/paas/v4 → …/v4/embeddings.
  const [base, ver] = upstreamVersionedBase(upstream);
  const url = `${base}/${ver}/embeddings`;
  // The call has no clock (HarnessV3-FailurePoints §4 A): the provider answers or fails it, or the client hangs up.
  const hangUp = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) hangUp.abort();
  });
  try {
    const r = await providerFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(upstream, "openai"),
        ...(upstream.headers || {}),
      },
      body: JSON.stringify({ ...body, model }),
      signal: hangUp.signal,
    });
    const text = await r.text();
    usage.firstByte(rec);
    let j = null;
    try {
      j = JSON.parse(text);
    } catch {}
    res.writeHead(r.status, {
      "content-type": "application/json; charset=utf-8",
      "x-filament-request-id": rec.id,
    });
    res.end(text);
    finish(
      rec,
      {
        status: r.ok ? "ok" : "error",
        httpStatus: r.status,
        tokens: { ...rec.tokens, input: j?.usage?.prompt_tokens || 0 },
        error: r.ok ? undefined : text.slice(0, 300),
        changes: [
          `embeddings ${body.model} -> ${upstream.id}/${model}`,
          `${Array.isArray(body.input) ? body.input.length : 1} input(s)`,
        ],
      },
    );
  } catch (/** @type {any} */ e) {
    if (hangUp.signal.aborted) return finish(rec, { status: "aborted", error: "client disconnected" });
    sendJson(res, 502, errorBody("openai", 502, `embeddings upstream failed: ${e.message}`));
    finish(rec, { status: "error", error: e.message });
  }
}
