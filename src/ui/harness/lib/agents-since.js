// @ts-check
// Each chat's Agents list read as the rows that moved (the slowness of 11-02): the owner's largest chat's list was
// 1.1 MB, 65 agents, read again every few seconds while one ran — by the Agents tab, by Now, by the Teams board and by
// the desktop's tray — though one or two rows moved between reads. The list route gives each answer a version
// (http/admin/sessions.js, core/list-since.js); a read that names the version held is sent every row's id in order and
// the rows that moved since, and the list is put together here whole. Needs no page: the tray's watcher reads it too.

/**
 * Each chat's list as last read whole: the version the server gave it and its rows by id, as the server sent them —
 * each reader is handed copies, so what it writes on its rows (a running agent's progress, heard on the feed) never
 * stands for the server's word on a row that did not move (the review of 11-02).
 * @type {Map<string, { version: string, byId: Map<string, any> }>}
 */
const lists = new Map();
/** The chats' lists kept at most, the one read longest ago going first. */
const MOST = 20;
/**
 * How long one read of a chat's list may take: past it, the read is let go (its request's signal) and fails every ask
 * that shares it, as a failed read does. The page's API has no time of its own, and every ask of the chat waits behind
 * the read on its way: one that never answered held the chat's list for good (the review of 11-19).
 */
export const READ_MOST_MS = 30_000;

/**
 * Each chat's read on its way, and the one waiting behind it that every ask meanwhile shares (lib/one-behind.js's rule,
 * its answer shared): the Agents tab's store and Now asked a chat's list each on its own, at once, each from the version
 * it held — their answers crossed, and one asked from a version the other had passed was sent every row (the lab's
 * logs of 11-17: one window reading the list five times a second while six agents ran, rows of 220 KB sent again).
 * Whoever asks has an answer read after its ask, its rows its own copies.
 * @type {Map<string, { inFlight: Promise<any> | null, behind: Promise<any> | null }>}
 */
const reads = new Map();

/** An answer as one asker is handed it: its rows, and the coding agents' own, copies of its own. @param {any} got */
const own = (got) =>
  got && typeof got === "object" && Array.isArray(got.subagents)
    ? { ...got, subagents: got.subagents.map((/** @type {any} */ x) => ({ ...x })), ...(Array.isArray(got.own) ? { own: got.own.map((/** @type {any} */ x) => ({ ...x })) } : {}) }
    : got;

/**
 * A chat's Agents list whole, as the list route answers it: read as the rows that moved since the version held, where
 * one is. An answer that moved from a version other than the one held — another read of the chat landed between — is
 * asked again from the one held, and after a second such, whole. One read of a chat is on its way at a time, and one
 * at most waits behind it (`reads`); a read that fails, or takes past READ_MOST_MS, fails every ask that shares it, the
 * list held as it was.
 * @param {string} chainId @param {(path: string, init?: { signal?: AbortSignal }) => Promise<any>} read  the admin API,
 *   or a test's stand-in
 * @returns {Promise<any>}
 */
export function readAgents(chainId, read) {
  let q = reads.get(chainId);
  if (!q) reads.set(chainId, (q = { inFlight: null, behind: null }));
  const queue = q;
  const start = () => {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(new Error(`the chat's agents list was not read in ${READ_MOST_MS / 1000} s`)), READ_MOST_MS);
    /** @type {any} */ (timer)?.unref?.();
    const done = readWhole(chainId, read, stop.signal).finally(() => {
      clearTimeout(timer);
      if (queue.inFlight === done) queue.inFlight = null;
      if (!queue.inFlight && !queue.behind && reads.get(chainId) === queue) reads.delete(chainId);
    });
    queue.inFlight = done;
    return done;
  };
  // A read just ended has let go of its place before the one behind it starts (`finally`, then `next`): an ask between
  // shares that one, never a second read beside it (Fable 5.2's review of 11-17).
  if (!queue.behind) {
    if (!queue.inFlight) return start().then(own);
    // After the one on its way, however it ended.
    const next = () => {
      queue.behind = null;
      return start();
    };
    queue.behind = queue.inFlight.then(next, next);
  }
  return queue.behind.then(own);
}

/**
 * One read of a chat's list, put together whole; its rows the ones `lists` keeps, which the asker's own copies are made
 * of (`own`). Let go once `signal` says so, whether its reader hears the signal or not.
 * @param {string} chainId @param {(path: string, init?: { signal?: AbortSignal }) => Promise<any>} read
 * @param {AbortSignal} signal @returns {Promise<any>}
 */
async function readWhole(chainId, read, signal) {
  // Each exchange's words as the rows draw them (`heads`): a card opened, a box picked, reads them whole.
  const base = `/sessions/${encodeURIComponent(chainId)}/subagents?heads=1`;
  /** @type {Promise<never>} */
  const stopped = new Promise((_, fail) => signal.addEventListener("abort", () => fail(signal.reason), { once: true }));
  stopped.catch(() => {});
  for (let tries = 0; ; tries++) {
    const had = tries < 2 ? lists.get(chainId) : undefined;
    const r = await Promise.race([read(had ? `${base}&since=${encodeURIComponent(had.version)}` : base, { signal }), stopped]);
    const now = lists.get(chainId);
    /** @type {any[] | null} */
    let rows = Array.isArray(r?.subagents) ? r.subagents : null;
    if (had && Array.isArray(r?.ids)) {
      if (!rows || !now || now.version !== r.since) continue;
      const moved = new Map(rows.map((x) => [String(x.id), x]));
      const whole = r.ids.map((/** @type {string} */ id) => moved.get(String(id)) || now.byId.get(String(id)));
      if (!whole.every(Boolean)) continue;
      rows = whole;
    }
    lists.delete(chainId);
    if (rows && typeof r?.version === "string" && r.version) {
      lists.set(chainId, { version: r.version, byId: new Map(rows.map((x) => [String(x.id), x])) });
      while (lists.size > MOST) lists.delete(/** @type {string} */ (lists.keys().next().value));
    }
    if (!r || typeof r !== "object") return r;
    const { ids: _ids, since: _since, ...rest } = r;
    return rows ? { ...rest, subagents: rows } : rest;
  }
}
