// @ts-check
// The request planner: which upstream one candidate is and the shaped request it gets — routing, rules, translation,
// the Responses wire-API detour. Pure over the config handed in, so the dry-run can plan against a draft. The
// pipeline reaches it as deps.plan; the admin API's dry-run as deps.dryRun (dryRunWith below).
import {
  findRoute,
  findUpstream,
  offWhy,
  upstreamSupports,
  upstreamEndpoint,
  upstreamBaseUrl,
  authHeaders,
  renderUpstreamModel,
  listedParse,
  callRoom,
} from "../core/routing.js";
import { estimateBodyTokens } from "../core/tokens.js";
import {
  mergeRules,
  parseModelSuffix,
  shapeAnthropic,
  shapeOpenAI,
  shapeHeaders,
  shapeResponses,
  applyFastParams,
  applyToolStream,
} from "../core/shaping.js";
import { capsAt, flexParse } from "../core/model-caps.js";
import { openaiToAnthropicRequest, anthropicToOpenaiRequest } from "../core/wire/translate.js";
import { chatToResponsesRequest } from "../core/wire/responses.js";
import { redactHeaders } from "../core/redact.js";

/**
 * The model name a candidate's upstream receives, before shaping: the route's template rendered with the requested
 * name. One answer for the plan and for what is remembered of a model (HarnessV3-AtHome AH-D1: one that refused tools).
 * @param {any} cfgX @param {any} candidate @param {any} route @param {any} requested
 * @param {any} [rules]  the rules in force at the candidate, merged here when not handed in
 */
export function upstreamModelOf(
  cfgX,
  candidate,
  route,
  requested,
  rules = mergeRules(cfgX.rules, findUpstream(cfgX, candidate.upstream)?.rules, route.rules),
) {
  const template = candidate.upstreamModel ?? route.upstreamModel;
  // effort.stripSuffix off for this route or upstream: forward the exact name the client sent (its own effort spelling)
  if (rules.effort?.stripSuffix === false && requested.original && requested.original !== requested.base) {
    const full = findRoute(cfgX, requested.original);
    if (full && full.match === route.match && full.upstream === route.upstream)
      return renderUpstreamModel(template, requested.original, full.captures || []);
  }
  return renderUpstreamModel(template, requested.base, route.captures || []);
}

/**
 * The cache lifetime a house call's chat chose for its turn (`x-filament-cache-ttl`, the chat's `model.cacheTtl`), as a
 * rules layer over the route's: the markers Filament adds ask for it. A client's request never carries the header (it
 * is house-only, services/house.js). Undefined where none is said.
 * @param {Record<string, string> | null | undefined} headers  lower-cased names
 */
export function cacheTtlLayer(headers) {
  const v = String(headers?.["x-filament-cache-ttl"] || "");
  return v === "5m" || v === "1h" ? { cache: { ttl: v } } : undefined;
}

// Decide upstream + shaped request for one candidate. Pure enough to reuse for dry-run.
/**
 * @param {() => any} getConfig  the live config read (cfgX overrides it — a dry-run plans against a draft)
 * @param {(u: any) => string | null} wireApiFor  the wire-API detection map's reader
 * @param {any} plan0  { format, body, inboundHeaders, candidate, route, requested, requestId, cfgX?, wire?, responsesBody? }
 */
export function plan(
  getConfig,
  wireApiFor,
  {
    format,
    body,
    inboundHeaders,
    candidate,
    route,
    requested,
    requestId,
    cfgX = getConfig(),
    wire = null,
    responsesBody = null,
  },
) {
  const upstream = findUpstream(cfgX, candidate.upstream);
  if (!upstream) return { error: offWhy(cfgX, candidate.upstream) || `upstream "${candidate.upstream}" not found or disabled` };
  const rules = mergeRules(cfgX.rules, upstream.rules, route.rules, cacheTtlLayer(inboundHeaders));
  // Which wire format goes upstream: the route's explicit format, else the client's format if the upstream speaks
  // it, else the other one. A difference means translation (unless the translate rule says never).
  const other = format === "anthropic" ? "openai" : "anthropic";
  let upstreamFormat =
    route.format && route.format !== "auto"
      ? route.format
      : upstreamSupports(upstream, format)
        ? format
        : other;
  if (!upstreamSupports(upstream, upstreamFormat))
    return { error: `upstream "${upstream.id}" (${upstream.type}) does not speak ${upstreamFormat}` };
  let translated = null,
    working = body;
  if (upstreamFormat !== format) {
    if (rules.translate?.mode === "never")
      return {
        error: `route "${route.match}" needs ${upstreamFormat} format but the request is ${format}, and rules.translate.mode is "never"`,
      };
    translated =
      format === "openai"
        ? // An OpenAI client that sends no max_tokens asks for all the model can write: the most it can, in its window.
          openaiToAnthropicRequest(body, { defaultMaxTokens: callRoom(cfgX, requested.base, estimateBodyTokens(body, "request")) })
        : anthropicToOpenaiRequest(body, {
            maxTokensField: rules.translate?.openaiMaxTokensField || "max_tokens",
            includeUsage: rules.params?.openaiIncludeUsage !== false,
          });
    working = translated.body;
  }
  const upstreamModel = upstreamModelOf(cfgX, candidate, route, requested, rules);
  // OpenAI-style servers: Chat Completions unless this upstream speaks only the Responses API (setting or detection).
  const openaiStyle =
    upstreamFormat === "openai" && (upstream.type === "openai" || upstream.type === "openai-compatible");
  const wireApi = openaiStyle ? wire || wireApiFor(upstream) : null;
  // What the model takes at this upstream (its row on the Upstreams page, its provider's listing, the rules, the
  // built-ins): the levels effort is clamped to, whether fast mode exists here and the fields that ask for it.
  const caps = capsAt(cfgX, upstream, upstreamModel || requested.base, rules);
  let shaped,
    passthrough = false;
  if (wireApi === "responses" && responsesBody && !translated) {
    // A Responses client and a Responses server: nothing to translate. Model name, effort and defaults still apply.
    shaped = shapeResponses({ body: responsesBody, rules, requested, upstreamModel, caps });
    passthrough = true;
    shaped.changes.push(
      "passthrough: OpenAI Responses in, OpenAI Responses out, nothing translated in between",
    );
  } else {
    shaped =
      upstreamFormat === "anthropic"
        ? shapeAnthropic({ body: working, rules, requested, upstreamModel, caps })
        : shapeOpenAI({ body: working, rules, requested, upstreamModel, caps });
    if (translated) shaped.changes = [...translated.notes, ...shaped.changes];
    // A call's input as the model writes it, where the server must be asked for it (Z.ai's `tool_stream`).
    if (openaiStyle && wireApi !== "responses") applyToolStream(shaped.body, upstreamBaseUrl(upstream), shaped.changes);
    if (wireApi === "responses") {
      shaped.body = chatToResponsesRequest(shaped.body);
      // The Responses shape carries only the fields it maps: fast mode's own fields are set again on it.
      if (shaped.fast && caps.fast.params) applyFastParams(shaped.body, caps.fast.params, "the model's row", []);
      shaped.changes.push(
        `wire API: sent to /v1/responses in the OpenAI Responses shape (${upstream.wireApi === "responses" ? "wireApi = responses on this upstream" : "this server answered 404/405 on /v1/chat/completions"}); the reply is converted back`,
      );
    }
  }
  const headers = shapeHeaders({
    rules,
    inbound: inboundHeaders,
    format: upstreamFormat,
    upstreamHeaders: upstream.headers,
    auth: authHeaders(upstream, upstreamFormat),
    requestId,
    extraBetas: /** @type {any} */ (shaped).extraBetas || [],
  });
  return {
    upstream,
    rules,
    upstreamModel,
    shaped,
    headers,
    url: upstreamEndpoint(upstream, upstreamFormat, { wire: wireApi }),
    upstreamFormat,
    translated: !!translated,
    wireApi,
    passthrough,
    caps,
  };
}

// Dry run against the live config or a draft (used by the admin API and the assistant).
/**
 * @param {() => any} getConfig
 * @param {(u: any) => string | null} wireApiFor
 * @param {any} input  { body, headers?, format? }
 * @param {any} [cfgX]
 */
export function dryRunWith(getConfig, wireApiFor, input, cfgX = getConfig()) {
  const format =
    input.format ||
    (input.body.messages &&
    input.body.max_tokens != null &&
    !input.body.messages.some((m) => m.role === "system")
      ? "anthropic"
      : "openai");
  // The parse stage's reading: a provider's own suffixed id (`qwen3-max`, `kimi-k3-fast`) is its name, not a lane.
  const requested = flexParse(cfgX, listedParse(cfgX, input.body.model) || parseModelSuffix(input.body.model, cfgX.rules));
  const route = findRoute(cfgX, requested.base) || findRoute(cfgX, input.body.model);
  if (!route) return { ok: false, error: `no route matches model "${input.body.model}"`, requested };
  const p = /** @type {any} */ (
    plan(getConfig, wireApiFor, {
      format,
      body: input.body,
      inboundHeaders: Object.fromEntries(
        Object.entries(input.headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
      ),
      candidate: { upstream: route.upstream, upstreamModel: route.upstreamModel },
      route,
      requested,
      requestId: "dry-run",
      cfgX,
    })
  );
  if (p.error) return { ok: false, error: p.error, route: route.match, requested };
  return {
    ok: true,
    format,
    upstreamFormat: p.upstreamFormat,
    wireApi: p.wireApi || undefined,
    passthrough: p.passthrough || undefined,
    translated: p.translated,
    route: route.match,
    upstream: p.upstream.id,
    url: p.url,
    headers: redactHeaders(p.headers),
    body: p.shaped.body,
    changes: p.shaped.changes,
    effectiveRules: p.rules,
    // What the model takes there and who said so (its row, its provider's listing, the rules, the built-ins).
    caps: p.caps,
    requested,
  };
}
