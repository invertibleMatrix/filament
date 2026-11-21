// @ts-check
// What the page tells the person in words, kept with the chat it concerns (the filament-agent plan's Phase 4b): its
// toasts (a note, or an error), the error it drew on a turn, its status lines (the live view lost). They go to the
// server, which keeps them on the session, so an agent reads them (`filament_memory_load`, view `page`) where the person
// had to describe them. A line said while the server can't be reached waits, and goes once it can, a reload of the page
// between them included: those moments are the ones worth keeping. The harness wires where the lines go
// (`keepPageSaid`); until it does, saying is a no-op.

/** @typedef {"note" | "error" | "status"} PageKind */
/** @typedef {{ at: number, kind: PageKind, text: string }} PageLine */

/** @type {((kind: PageKind, text: string, chainId: string | undefined) => void) | null} */
let sink = null;
/** Where the lines waiting for the server are kept across a reload (the tab's sessionStorage). */
const STORE_KEY = "filament.pageSaid";

/**
 * Say it: kept with the session `chainId` names, or with the chat open now when it names none; "" is no session.
 * @param {PageKind} kind @param {unknown} text @param {string} [chainId]
 */
export function pageSaid(kind, text, chainId) {
  sink?.(kind, String(text ?? ""), chainId);
}
/** A toast's words, as kept: an error toast an error, any other a note. @param {unknown} msg @param {string} [kind] */
export const toastSaid = (msg, kind = "") => pageSaid(kind === "err" ? "error" : "note", msg);

/**
 * Where the page's words go: each chat's lines gathered a moment (`wait`), then posted together. Lines the server
 * could not be reached for are kept, the newest `most` of each chat, and posted again after `retry`, in the order they
 * were said. A refusal (4xx: no such session) drops them: the server read them and said no. `store` keeps the lines
 * waiting across a reload of the page: a page reloaded while the server could not be reached posts them once it can.
 * @param {{ chainNow: () => string | null | undefined, post: (chainId: string, lines: PageLine[]) => Promise<unknown>, now?: () => number, wait?: number, retry?: number, most?: number,
 *   store?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null }} o
 */
export function keepPageSaid({ chainNow, post, now = Date.now, wait = 1000, retry = 5000, most = 100, store = null }) {
  /** @type {Map<string, PageLine[]>} */
  const held = new Map(storedLines(store));
  const save = () => {
    try {
      if (held.size) store?.setItem(STORE_KEY, JSON.stringify([...held]));
      else store?.removeItem(STORE_KEY);
    } catch {
      // A store that is full or refused: the lines stay in this page's memory.
    }
  };
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let posting = false;
  const later = (/** @type {number} */ ms) => {
    timer ??= setTimeout(flush, ms);
  };
  async function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (posting) return later(wait);
    posting = true;
    let failed = false;
    try {
      for (const [chainId, lines] of [...held]) {
        held.delete(chainId);
        try {
          await post(chainId, lines);
        } catch (/** @type {any} */ e) {
          if (e?.status >= 400 && e.status < 500) continue;
          held.set(chainId, [...lines, ...(held.get(chainId) || [])].slice(-most));
          failed = true;
        }
      }
    } finally {
      posting = false;
      save();
    }
    if (failed) later(retry);
    else if (held.size) later(wait);
  }
  sink = (kind, text, chainId) => {
    const id = chainId === undefined ? chainNow() : chainId;
    if (!id || !text.trim()) return;
    held.set(id, [...(held.get(id) || []), { at: now(), kind, text }].slice(-most));
    save();
    later(wait);
  };
  if (held.size) later(wait);
  return {
    flush,
    /** The lines waiting, by chat. */
    held,
    /** No more lines kept, and none posted. */
    stop() {
      sink = null;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** The lines a reloaded page found waiting in its store, as `[chainId, lines]`. @param {any} store @returns {[string, PageLine[]][]} */
function storedLines(store) {
  try {
    const v = JSON.parse(store?.getItem(STORE_KEY) || "[]");
    return Array.isArray(v) ? v.filter((e) => Array.isArray(e) && typeof e[0] === "string" && Array.isArray(e[1])) : [];
  } catch {
    return [];
  }
}
