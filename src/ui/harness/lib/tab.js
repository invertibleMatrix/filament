// @ts-check
// This page as a tab (HarnessV3-FixRound decision 22): the server keeps one writing tab per session, and a page names
// itself to it with an id made when the page loads. The id is never stored, so a reload is a new tab, and a duplicated
// tab never poses as its original. What the person does in it says they are here (`acting`).

/**
 * A pane popped out into a window of its own (HarnessV4_BrowserSize_Plan BS4) is no tab of its own: it names none, so
 * it never takes or holds a session's writing — the main window's stays, and its pane's acts are never refused.
 */
const popped = /[?&]pane=/.test(String(/** @type {any} */ (globalThis).location?.search || ""));
/** The tab's id: on the admin requests (`x-filament-tab`), the turn's request, and the events stream's URL. */
export const TAB_ID = popped
  ? ""
  : String(
      globalThis.crypto?.randomUUID?.() ||
        // `randomUUID` needs a secure context: a page served to another machine by its address is not one.
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
    ).slice(0, 80);

/**
 * How long a press or a key in this page counts as the person acting in it: a write the page makes meanwhile takes its
 * chat over from the window that writes it (the owner's of 11-14: the writing follows the person, from his PC's window to
 * his MacBook's and back, with no Take over to press).
 */
export const ACT_MS = 5000;
let actedAt = 0;
/** The person pressed, typed, pasted or dropped something in this page. @param {number} [at] */
export const acted = (at = Date.now()) => {
  actedAt = at;
};
/** Whether the person acts in this page now. @param {number} [now] */
export const acting = (now = Date.now()) => actedAt > 0 && now - actedAt < ACT_MS;
/** The session on screen, as the page says it (app.js). @type {() => string | null} */
let shown = () => null;
/** @param {() => string | null} fn */
export const whenShown = (fn) => {
  shown = fn;
};
/**
 * The session a write made now takes over (`x-filament-take`, session-writers.js `takeOf`): the one on screen, while the
 * person acts in this page — never another chat a write of the page names (a chat's unread mark, a queued send of one
 * not shown, the review of 11-14), which the server takes nothing of. "" for none.
 * @param {number} [now]
 */
export const takeNow = (now = Date.now()) => (acting(now) ? shown() || "" : "");
// Only the person's own events: one a script dispatches is not trusted. Heard before the page's own handlers, so the
// write a press or a key makes already counts as acting.
for (const type of ["pointerdown", "keydown", "paste", "drop"]) {
  /** @type {any} */ (globalThis).addEventListener?.(type, (/** @type {Event} */ e) => e.isTrusted && acted(), { capture: true, passive: true });
}

/** How a tab asks for the session it shows: `peek` only asks who writes it, `open` writes it if none does, `take` takes it. @typedef {"peek" | "open" | "take"} Ask */
const STRENGTH = { peek: 0, open: 1, take: 2 };

/**
 * The tab's ask for the session it shows, one request at a time. A newer wish waits for the one in flight, and only
 * the newest is sent, so the server hears the sessions in the order the tab showed them. Only the newest answer is
 * handed on. A stronger ask made while the same session's ask waits is kept (a take-over over an open, an open over a
 * peek). A failed ask is dropped: the next reconnect, switch or take-over asks again.
 * @param {{ send: (chainId: string | null, how: Ask) => Promise<any>, onAnswer: (answer: any) => void }} o
 * @returns {(chainId: string | null, how?: Ask) => void}
 */
export function writerClaim({ send, onAnswer }) {
  let busy = false;
  /** @type {{ chainId: string | null, how: Ask } | null} */
  let owed = null;
  const run = async () => {
    busy = true;
    while (owed) {
      const want = owed;
      owed = null;
      try {
        const answer = await send(want.chainId, want.how);
        if (!owed) onAnswer(answer);
      } catch {}
    }
    busy = false;
  };
  return (chainId, how = "open") => {
    const id = chainId || null;
    const kept = owed?.chainId === id && STRENGTH[owed.how] > STRENGTH[how] ? owed.how : how;
    owed = { chainId: id, how: kept };
    if (!busy) run();
  };
}
