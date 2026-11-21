// @ts-check
// One failure card for every failure (HarnessV4_Tasks U1; HarnessV3-FailurePoints §5.2): a failed turn in the chat, a
// failed sub-agent in its tool card, in its own view and in the Team view, a failed task in the Plan view. The cause
// in one line; under it what it had done, what Filament kept and what happens next; a failure that repeats, called
// out; what was said under the words — a coding agent's own error, the body a provider sent — in a fold; then the
// ways on, as the surface's own buttons. The words are the server's (core/failure.js `worded`: a failure's `head` and
// `more`): nothing here composes them.
import { ICONS } from "./icons.js";

/**
 * @typedef {object} FailureWords
 * @property {string} head  the cause, in one line
 * @property {string} more  what it had done, what is kept, what happens next; "" for none of it
 * @property {string} repeat  the failure that repeats, called out; "" for a first one
 * @property {string} detail  what was said under the words; "" for nothing
 */

/**
 * A failure's words for its card, from what the surface holds: the one shape's two parts where the server sent them
 * (`failure`), else its line whole as the cause — on one line either way.
 * @param {{ error?: string | null, failure?: { head?: string, more?: string } | null, detail?: string | null, repeat?: string | null }} o
 * @returns {FailureWords}
 */
export function failureWords({ error = "", failure = null, detail = "", repeat = "" }) {
  const parts = failure?.head ? failure : null;
  return {
    head: String(parts?.head || error || "").replace(/\s+/g, " ").trim(),
    more: String(parts?.more || "").replace(/\s+/g, " ").trim(),
    repeat: String(repeat || ""),
    detail: String(detail || ""),
  };
}

/**
 * What a failed reply's body says beyond its message (`{ error: { message, detail?, failure? } }`, in either wire
 * format): the failure's two parts, where the one shape made it, and the agent's own error, where one was said under
 * the message.
 * @param {any} body @returns {{ failure: { head: string, more: string } | null, detail: string }}
 */
export function saidUnder(body) {
  const e = body?.error && typeof body.error === "object" ? body.error : null;
  return {
    failure: typeof e?.failure?.head === "string" && e.failure.head ? { head: e.failure.head, more: String(e.failure.more || "") } : null,
    detail: typeof e?.detail === "string" ? e.detail : "",
  };
}

/**
 * The card. `acts`: the surface's ways on (Retry, Sign in, Send back…), after the card's own Show details; `onCopy`:
 * a Copy button, handed the card's words; `inset`: inside another card (a worker's, a task's, a call's), at that
 * card's size.
 * @param {(tag: string, attrs?: Record<string, any>, ...kids: any[]) => any} mk  the element maker (a test's fake DOM)
 * @param {FailureWords} w
 * @param {{ acts?: any[], onCopy?: ((text: string) => void) | null, inset?: boolean }} [o]
 */
export function failureCard(mk, w, { acts = [], onCopy = null, inset = false } = {}) {
  const detail = w.detail ? mk("pre", { class: "ix-detail hidden" }, w.detail) : null;
  /** @type {any} */
  const toggle = detail
    ? mk("button", { class: "ghost sm", type: "button", title: "What was said under it, as it came", onclick: (/** @type {Event} */ e) => {
        e.stopPropagation();
        detail.classList.toggle("hidden");
        toggle.replaceChildren(detail.classList.contains("hidden") ? "Show details" : "Hide details");
      } }, "Show details")
    : null;
  const copy = onCopy ? mk("button", { class: "ghost sm", type: "button", onclick: (/** @type {Event} */ e) => { e.stopPropagation(); onCopy([w.head, w.more, w.repeat, w.detail].filter(Boolean).join("\n\n")); } }, "Copy") : null;
  const buttons = [toggle, copy, ...acts].filter(Boolean);
  return mk("div", { class: `ix-error${inset ? " is-inset" : ""}` },
    mk("span", { class: "ix-error-main" },
      mk("span", { class: "ix-error-ic", html: ICONS.info }),
      mk("span", { class: "ix-error-words" },
        ...[mk("span", { class: "ix-error-msg" }, w.head), w.more ? mk("span", { class: "ix-error-more" }, w.more) : null, w.repeat ? mk("span", { class: "ix-error-repeat" }, w.repeat) : null].filter(Boolean))),
    ...[buttons.length ? mk("span", { class: "ix-error-acts" }, ...buttons) : null, detail].filter(Boolean));
}
