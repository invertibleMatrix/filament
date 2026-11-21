// @ts-check
// The one wrapper every admin area's rows sit in: a local failure (archive, engine, config, a bad id) is answered as
// JSON with its message instead of falling through to the front door's generic 500 — 502 stays reserved for an
// upstream that failed. Areas that know more about their errors pass a mapping (memory off → 503, no such session →
// 404); the body reader's refusal is rethrown because it has already answered.
import { sendJson } from "../../app/pipeline/respond.js";
import { BodyRefused } from "../guards.js";

/**
 * @param {(r: any, a: any) => any} fn
 * @param {((message: string) => { status: number, error: string } | null) | null} [mapError]
 *   an area's own reading of a failure message; null falls back to a 500 with the message
 */
export const guard =
  (fn, mapError = null) =>
  async (r, a) => {
    try {
      return await fn(r, a);
    } catch (/** @type {any} */ e) {
      if (e instanceof BodyRefused) throw e;
      if (e instanceof URIError) return sendJson(r.res, 400, { error: "bad percent-encoding in the path" });
      const message = e?.message || String(e);
      const mapped = mapError ? mapError(message) : null;
      return sendJson(r.res, mapped?.status || 500, { error: mapped?.error || message });
    }
  };
