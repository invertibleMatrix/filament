// @ts-check
// A read kept for a moment, one on its way per path (the chat-open audit of 10-29). The Run pane is drawn again at each
// pulse of a running turn, a turn of any chat's, and each draw asked for the chat's request lists anew: For developers'
// table and Calls' held-per-request bars read their list again every second or so while a turn ran. The same path asked
// again while its read is on its way gets that read; asked again within `keepMs` of its answer, that answer. A failed
// read is kept for nobody: the next ask reads again. Pure: it runs the reader it is given.

/**
 * @param {(path: string) => Promise<any>} read  the reader (the admin API; a test's stand-in)
 * @param {{ keepMs?: number, now?: () => number }} [o]  how long an answer is served again, and the clock
 * @returns {(path: string) => Promise<any>}
 */
export function briefReads(read, { keepMs = 8000, now = () => Date.now() } = {}) {
  /** Each path's read: `at` is when its answer landed, 0 while it is on its way. @type {Map<string, { at: number, answer: Promise<any> }>} */
  const kept = new Map();
  return (path) => {
    const t = now();
    // Answers past their moment are let go as any read is asked: a page open all day reads many chats' lists.
    for (const [p, k] of kept) if (k.at && t - k.at >= keepMs) kept.delete(p);
    const had = kept.get(path);
    if (had) return had.answer;
    const entry = { at: 0, answer: read(path) };
    kept.set(path, entry);
    entry.answer.then(
      () => {
        if (kept.get(path) === entry) entry.at = now();
      },
      () => {
        if (kept.get(path) === entry) kept.delete(path);
      },
    );
    return entry.answer;
  };
}
