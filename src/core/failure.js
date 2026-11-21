// @ts-check
// One shape for every failure (HarnessV3-FailurePoints §5.2): what failed, where, what it said, when and for how
// long, what it had done, and what Filament kept and does next. A run's end, the task graph's notices to a lead, the
// page's failure card and the Requests page read the same fields; `failureLine` says them in one line, for a person
// and a model alike, and `worded` puts that line's two parts on the shape (`head`, `more`) where a failure is made:
// the page's card draws them and composes nothing (HarnessV4_Tasks U1). A failure on its provider carries what it says
// of the provider (`cause`, HarnessV3-TaskGraph-v2 TG2-D54): one that is a wall, or a model the provider refuses this
// account, says it was not tried again. Pure.
import { aboutTokens, durationWords } from "./text.js";
import { causeWords, holdWords, isFinal } from "./provider-cause.js";

/**
 * @typedef {object} Failure
 * @property {string} what  what failed: "round 2's model call", "Filament's agent loop"
 * @property {string | null} where  the model it was asked of (with its provider when the answer named one), or the
 *   agent and account; null when nothing outside Filament was asked
 * @property {string} said  what it said, in words: the provider's own, or a network error's in plain words
 * @property {string | null} code  a network error's code (`ECONNRESET`), an exit code; null when there was none
 * @property {number | null} status  the provider's HTTP status, when it answered
 * @property {number | null} tries  how many times it was asked, when more than once
 * @property {number | null} began  when it began (epoch ms), when known
 * @property {number} at  when it failed (epoch ms)
 * @property {{ thinking: number, text: number } | null} streamed  what had streamed of it, in characters
 * @property {string | null} kept  what Filament kept of the work ("1 finished round is kept")
 * @property {string | null} next  what happens next ("retrying in 20 s"), when anything does
 * @property {FailureCause | null} [cause]  what it says of its provider, where it failed on one (core/provider-cause.js)
 * @property {string} [head]  its words, said where it is made (`worded`): the cause in one line — what failed, where,
 *   after how long and what it said
 * @property {string} [more]  and the rest of them: what it had streamed, what is kept and what happens next ("" for
 *   none of the three)
 */
/**
 * A failure's cause on its provider: busy, rate, out, account or model; the provider, as the reply named it; and an out's
 * reset, where the provider said one Filament could read (epoch ms).
 * @typedef {{ kind: import("./provider-cause.js").CauseKind, provider: string | null, resets: number | null }} FailureCause
 */

/** A network error's code in plain words: the codes Node's sockets and its fetch (undici) give. */
export const NETWORK_WORDS = Object.freeze({
  ECONNRESET: "the connection was reset",
  ECONNREFUSED: "the connection was refused",
  ECONNABORTED: "the connection was aborted",
  EPIPE: "the connection closed while Filament was still sending",
  ETIMEDOUT: "the network gave up on the connection",
  ENOTFOUND: "the provider's address could not be found",
  EAI_AGAIN: "the provider's address could not be looked up for now",
  EHOSTUNREACH: "the provider's host could not be reached",
  ENETUNREACH: "the network could not be reached",
  UND_ERR_SOCKET: "the connection closed in the middle of the reply",
  UND_ERR_CLOSED: "the connection was closed",
  UND_ERR_CONNECT_TIMEOUT: "the connection could not be opened in time",
  UND_ERR_HEADERS_TIMEOUT: "no reply came within Node's wait for one",
  UND_ERR_BODY_TIMEOUT: "the reply went quiet past Node's wait",
});

/**
 * What a thrown error said, in words: a network code anywhere in its causes (fetch's "fetch failed" carries the
 * socket's), Filament's own time limit as such, else its message.
 * @param {any} e @returns {{ said: string, code: string | null }}
 */
export function saidOf(e) {
  for (let c = e, depth = 0; c && depth < 4; c = c.cause, depth++) {
    const code = typeof c.code === "string" ? c.code : null;
    if (code && Object.hasOwn(NETWORK_WORDS, code)) return { said: NETWORK_WORDS[/** @type {keyof typeof NETWORK_WORDS} */ (code)], code };
  }
  if (e?.name === "TimeoutError") return { said: "Filament's time limit on the call cut it", code: null };
  return { said: String(e?.message || e || "an unknown error").slice(0, 300), code: typeof e?.code === "string" ? e.code : null };
}

/** A failure shorter than this says no time: a quick failure's seconds tell nothing. */
const SAY_TIME_FROM_MS = 10_000;

/**
 * The failure's words in two parts. `head`, the cause in one line: "round 2's model call to glm-5.3-flash at zai failed
 * after 10 min: the connection was reset (ECONNRESET)." `more`, what it had done and what comes of it: "It had streamed
 * about 11,000 tokens of thinking. 1 finished round is kept." — "" where there is none of it.
 * @param {Failure} f @returns {{ head: string, more: string }}
 */
export function failureParts(f) {
  const ms = f.began != null ? f.at - f.began : 0;
  const tries = f.tries && f.tries > 1 ? ` after ${f.tries} tries${ms >= SAY_TIME_FROM_MS ? ` over ${durationWords(ms)}` : ""}` : ms >= SAY_TIME_FROM_MS ? ` after ${durationWords(ms)}` : "";
  const marks = [f.code && !f.said.includes(f.code) ? f.code : null, f.status && !f.said.includes(String(f.status)) ? `HTTP ${f.status}` : null].filter(Boolean);
  const head = `${f.what}${f.where ? ` to ${f.where}` : ""} failed${tries}: ${f.said.replace(/[.\s]+$/, "")}${marks.length ? ` (${marks.join(", ")})` : ""}.`;
  const s = f.streamed;
  const streamed =
    s && (s.thinking > 0 || s.text > 0)
      ? `It had streamed ${[s.thinking > 0 ? `${aboutTokens(s.thinking)} of thinking` : "", s.text > 0 ? `${aboutTokens(s.text)} of text` : ""].filter(Boolean).join(" and ")}.`
      : "";
  return { head, more: [wallLine(f), streamed, f.kept ? `${f.kept.charAt(0).toUpperCase()}${f.kept.slice(1)}.` : "", f.next ? `${f.next.charAt(0).toUpperCase()}${f.next.slice(1)}.` : ""].filter(Boolean).join(" ") };
}

/**
 * What a failure on a wall adds (TG2-D54): "Not tried again: zai says this account's allowance is used up, until it
 * resets in 4 h 50 min." — and on a model the provider refuses this account: "Not tried again: zai says this account
 * may not use this model." "" for any other.
 * @param {Failure} f
 */
function wallLine(f) {
  const c = f.cause;
  if (!c || !isFinal({ kind: c.kind, resets: c.resets })) return "";
  const resets = c.kind === "out" && c.resets != null && c.resets > f.at ? `, until it resets in ${holdWords(c.resets - f.at)}` : "";
  return `Not tried again: ${causeWords(c.kind, c.provider)}${resets}.`;
}

/** The failure in one line: its cause, then what it had done and what comes of it (`failureParts`). @param {Failure} f */
export function failureLine(f) {
  const { head, more } = failureParts(f);
  return more ? `${head} ${more}` : head;
}

/** A failure as it is made, its words on it: every door that carries the shape carries them. @param {Failure} f @returns {Failure} */
export const worded = (f) => ({ ...f, ...failureParts(f) });

/** What a turn kept when it failed at `round`: the rounds before it, which finished. @param {number} round */
export const keptRounds = (round) => {
  const n = Math.max(0, round - 1);
  return n ? `${n} finished round${n === 1 ? " is" : "s are"} kept` : null;
};
