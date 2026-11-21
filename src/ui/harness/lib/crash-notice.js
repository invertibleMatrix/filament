// @ts-check
// A page Filament loaded again because its process went (desktop/lib/renderer-watch.js `crashPlan`; the owner's of
// 11-17: a chat window following a 22-hour turn reached 13 GB, and a minute later another process stood in its place
// with nothing said). Its address says why (`crashed`) and which chat the load left out (`away`): the page takes them
// off its address, so a reload of its own says nothing, and says so once the person is at it (app.js `sayCrash`),
// offering that chat back. A crash runs no pagehide: the chats' queues are kept as they change (app.js `keepQueues`), so
// what waited comes back paused. DOM-free.

/** How long the notice stays: long enough to read it and reach its button. */
export const CRASH_NOTICE_MS = 30_000;

/** What the page says of why its process went, by Electron's reason. */
const WHY = /** @type {Record<string, string>} */ ({
  oom: "ran out of memory",
  "memory-eviction": "was ended to free memory",
  killed: "was ended from outside Filament",
  crashed: "crashed",
  "abnormal-exit": "ended unexpectedly",
  "launch-failed": "could not start",
});

/**
 * The notice an address asks for, or none: its words, and the chat the load left out.
 * @param {string} search  the address's query (`location.search`)
 * @returns {{ words: string, away: string | null } | null}
 */
export function crashNoticeOf(search) {
  /** @type {URLSearchParams} */
  let q;
  try {
    q = new URLSearchParams(search);
  } catch {
    return null;
  }
  const reason = (q.get("crashed") || "").slice(0, 40);
  if (!reason) return null;
  const away = q.get("away") || null;
  const why = WHY[reason] || `ended (${reason})`;
  const left = away ? " It opened without the chat it was showing, so that chat cannot take it down again." : "";
  return { words: `This window's page ${why}, and Filament loaded it again.${left} Queued messages wait in their chats, paused: look them over before Continue — one queued in its last moments may be missing.`, away };
}

/** The address without what the crash put in it: the page's own query and route stay. @param {string} href */
export function addressWithoutCrash(href) {
  try {
    const u = new URL(href);
    u.searchParams.delete("crashed");
    u.searchParams.delete("away");
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return href;
  }
}
