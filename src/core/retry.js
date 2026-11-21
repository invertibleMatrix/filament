// @ts-check
// HarnessV3-AtHome AH-F4: a model call Filament's own loops make — a round of a turn or of a sub-agent, a fork that
// writes a compaction's summary, memory's learning and its curator (the memory plan's g1) — is tried again when its provider was busy for a moment: up to
// ten tries, waiting 1 s, 2 s, 4 s … up to 32 s between them, or what the provider's Retry-After asks. Only a failure
// that reached a provider is tried again: the reply names its upstream, and Filament's own refusals never do. A call a
// client sends through the proxy is not: the client tries again itself, and two layers of retries multiply the wait.
// A provider that said this account's allowance is spent, or that it refuses the account or its key, is a wall
// (HarnessV3-TaskGraph-v2 TG2-D54): no try passes it, so the first refusal is the answer. So is one that said this
// account may not use the model asked for: every try of that model meets the same refusal.
import { durationWords } from "./text.js";
import { isFinal, providerCause } from "./provider-cause.js";

/** Tries in all, the first one included. */
export const RETRY_TRIES = 10;
/** The longest wait the backoff picks between two tries, in seconds. */
const BACKOFF_MAX_S = 32;
/** A Retry-After longer than this, in seconds, is not waited out: the call fails, saying when the provider takes calls again. */
const RETRY_AFTER_LIMIT_S = 600;

/**
 * The status an error inside a 200 stream stands for, by its Anthropic error type — the wire the front door speaks
 * to its own loops. A type it does not know is a 502.
 * @type {Record<string, number>}
 */
export const STREAM_ERROR_STATUS = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
};

/**
 * The seconds a reply asks its caller to wait before trying again, or null when it asks nothing: `retry-after-ms`
 * when a provider sends it, else `retry-after` as seconds or an HTTP date.
 * @param {Headers} h @param {number} [nowMs]
 */
export function retryAfterSeconds(h, nowMs = Date.now()) {
  const ms = h.get("retry-after-ms");
  if (ms != null && ms.trim() !== "" && Number.isFinite(Number(ms)) && Number(ms) >= 0) return Number(ms) / 1000;
  const v = String(h.get("retry-after") ?? "").trim();
  if (!v) return null;
  if (Number.isFinite(Number(v))) return Number(v) >= 0 ? Number(v) : null;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, (at - nowMs) / 1000) : null;
}

/**
 * What a try answered, as the internal call reports it: `upstream` names the provider (null for Filament's own
 * refusals), `retryAfter` is what its Retry-After asks in seconds, `shouldRetry` what its `x-should-retry` says, and
 * `inStream` that the failure came inside a 200 stream.
 * @typedef {{ ok: boolean, status: number, json: any, upstream?: string | null, retryAfter?: number | null, shouldRetry?: boolean | null, inStream?: boolean }} Tried
 */
/**
 * A wait between two tries: the failure that caused it, how long, which try comes next, and all of it in words.
 * @typedef {{ r: Tried, waitMs: number, next: number, words: string }} Wait
 */

/**
 * What a failed try says of its provider (core/provider-cause.js): its status, its error's type and words, and the
 * wait its Retry-After asks. Null for a try that answered, and for Filament's own refusals, which name no provider.
 * @param {Tried} r
 */
export const causeOf = (r) => (r.ok || !r.upstream ? null : providerCause({ status: r.status, type: r.json?.error?.type ?? null, said: r.json?.error?.message ?? null, retryAfter: r.retryAfter ?? null }));

/**
 * A failure worth another try: it reached a provider, which timed out, was busy, limited the rate of calls or failed on
 * its side — the statuses the Anthropic SDK tries again (408, 409, 429, 5xx; a provider Filament could not reach is
 * its 502 naming it) — unless the reply's `x-should-retry` says otherwise, as the SDK reads it too. Never a wall: a
 * provider whose words say this account's allowance is spent, or that it refuses the account or its key (TG2-D54);
 * nor a model it says this account may not use.
 * @param {Tried} r
 */
export function transient(r) {
  if (r.ok || !r.upstream) return false;
  if (isFinal(causeOf(r))) return false;
  if (r.shouldRetry != null) return r.shouldRetry;
  return r.status === 408 || r.status === 409 || r.status === 429 || r.status >= 500;
}

/**
 * The failure in a few words, naming its provider: "kimi-cn is overloaded", "kimi-cn is limiting the rate of calls",
 * "kimi-cn timed out", "kimi-cn could not be reached", "kimi-cn's stream broke off (terminated)" — a failure inside a
 * 200 stream has no HTTP status of its own —, "kimi-cn failed with HTTP 500".
 * @param {Tried} r
 */
function failureWords(r) {
  const up = r.upstream || "the provider";
  const e = r.json?.error || {};
  if (r.status === 529 || /overload/i.test(`${e.type || ""} ${e.message || ""}`)) return `${up} is overloaded`;
  if (r.status === 429) return `${up} is limiting the rate of calls`;
  if (r.status === 408 || r.status === 504) return `${up} timed out`;
  if (/\bunreachable\b/i.test(String(e.message || ""))) return `${up} could not be reached`;
  if (r.inStream) return `${up}'s stream broke off (${String(e.message || "it said no reason").slice(0, 160)})`;
  return `${up} failed with HTTP ${r.status}`;
}

/**
 * Wait `ms`, or less when `signal` aborts: true when the whole wait passed.
 * @param {number} ms @param {AbortSignal | null} signal
 * @returns {Promise<boolean>}
 */
function pause(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A call tried until it answers, fails for good or runs out of tries. `attempt(n)` makes try `n` (from 1); `again(r)`
 * is the caller's own condition for another try (the loop's round: nothing of it has streamed, or its stream broke on
 * the provider's side, HarnessV3-FailurePoints FP-D6). Each wait is told to
 * `onWait` before it starts, and `onWait(null)` when it is over and the next try begins. A wait ends early when
 * `signal` aborts: `cut` says so, and the last failure is the answer. A Retry-After over ten minutes is not waited
 * out: `tooLong` says when the provider takes calls again.
 * @template {Tried} R
 * @param {(n: number) => Promise<R>} attempt
 * @param {{ tries?: number, signal?: AbortSignal | null, again?: (r: R) => boolean, onWait?: (w: Wait | null) => void }} [o]
 * @returns {Promise<{ r: R, tries: number, cut?: true, tooLong?: string }>}
 */
export async function withRetries(attempt, { tries = RETRY_TRIES, signal = null, again = () => true, onWait = () => {} } = {}) {
  for (let n = 1; ; n++) {
    const r = await attempt(n);
    if (n >= tries || !transient(r) || !again(r) || signal?.aborted) return { r, tries: n };
    const waitMs = Math.round((r.retryAfter != null && r.retryAfter >= 0 ? r.retryAfter : Math.min(BACKOFF_MAX_S, 2 ** (n - 1))) * 1000);
    if (waitMs > RETRY_AFTER_LIMIT_S * 1000) return { r, tries: n, tooLong: `${failureWords(r)} and asks to be called again in ${durationWords(waitMs)}` };
    onWait({ r, waitMs, next: n + 1, words: `${failureWords(r)} — ${waitMs > 0 ? `trying again in ${durationWords(waitMs)}` : "trying again now"} (try ${n + 1} of ${tries})` });
    if (!(await pause(waitMs, signal))) return { r, tries: n, cut: true };
    onWait(null);
  }
}
