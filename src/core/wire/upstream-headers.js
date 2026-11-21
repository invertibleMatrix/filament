// @ts-check
// What Filament reads off an upstream reply's headers: the ones handed back to the client, and the provider metadata
// (rate limits, request ids, which model or backend actually served) kept on the record.
import { FILAMENT_MARK } from "../headers.js";

/**
 * Upstream response headers to hand back to the agent. `minimal` forwards the three that identify a request;
 * otherwise everything but the transport and identity headers a proxy must not relay. Never one of Filament's own —
 * its mark (`FILAMENT_MARK`), or any `x-filament-*` —, whatever the provider said: another machine reads the mark on a
 * reply as its door's own refusal of the device it lends its models to (adapters/providers/filament.js), Filament's
 * page reads the others as what this Filament said of its turn, and a provider's answer passed on is never that — the
 * one another machine's Filament lends included. Filament sets its own after (dispatch/reply.js).
 * @param {Response} ures
 * @param {{ headers: { forwardResponse?: string } }} rules  the effective rules
 * @returns {Record<string, string>}
 */
export function responseHeaders(ures, rules) {
  /** @type {Record<string, string>} */
  const out = {};
  const minimal = ["request-id", "x-request-id", "retry-after"];
  const blocked = new Set([
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "set-cookie",
    "content-type",
    "date",
    "server",
    "alt-svc",
    "cf-ray",
    "via",
    "x-powered-by",
  ]);
  ures.headers.forEach((v, k) => {
    const key = k.toLowerCase();
    if (key === FILAMENT_MARK || key.startsWith(`${FILAMENT_MARK}-`)) return;
    if (rules.headers.forwardResponse === "minimal" ? minimal.includes(key) : !blocked.has(key)) out[key] = v;
  });
  return out;
}

/**
 * Provider metadata worth keeping on the record; undefined when the reply carries none.
 * @param {Response} ures
 * @returns {Record<string, string> | undefined}
 */
export function providerMeta(ures) {
  /** @type {Record<string, string>} */
  const meta = {};
  ures.headers.forEach((v, k) => {
    const key = k.toLowerCase();
    if (
      /ratelimit|request-id|retry-after|x-served-by|x-provider|x-model|openrouter|x-9r|x-omniroute|x-cache/i.test(
        key,
      )
    )
      meta[key] = v;
  });
  return Object.keys(meta).length ? meta : undefined;
}
