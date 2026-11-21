// @ts-check
// A window of Filament's own that loses its page's process says so in the log (the owner's of 11-17: a chat window
// following a 22-hour turn reached 13 GB, and a minute later another process stood in its place with nothing said, so
// nobody could tell a crash from a reload): which window, what it showed, why its process ended and how big it was last
// seen. A window that stops answering is said too, and when it answers again — never acted on: one big draw may hold a
// page for seconds. A page whose process went is loaded again (`crashPlan`): where it was, else without the chat that
// took it down, and no more once it keeps going down. Plain Node: main.js hands it each window's webContents, and loads
// what the plan says.

/**
 * What a watcher reads of a window's page: Electron's webContents, as far as this uses it.
 * @typedef {{
 *   on: (event: any, fn: any) => unknown,
 *   getURL: () => string,
 *   getOSProcessId: () => number,
 *   isDestroyed: () => boolean,
 * }} WatchedContents
 */

/**
 * The page's process as the memory sampler saw it last (lib/metrics.js `lastOf`): private memory on Windows, the
 * working set elsewhere.
 * @typedef {{ mb: number, peakMB: number, at: number, measure?: "private" | "working set" }} SeenMemory
 */

/** The most of a window's address a line says: a pane's tab can name a long path. */
export const PLACE_MAX = 300;

/**
 * A window's address as the log says it: its page's path, its pane and its route — the chat it showed — at most
 * `PLACE_MAX` characters. Not a URL, not a page: what it was.
 * @param {string} url
 */
export function placeOf(url) {
  const cut = (/** @type {string} */ s) => (s.length > PLACE_MAX ? `${s.slice(0, PLACE_MAX - 1)}…` : s);
  try {
    const u = new URL(url);
    if (u.protocol === "data:") return "Filament's own waiting page";
    return cut(`${u.pathname}${u.search}${u.hash}` || url);
  } catch {
    return url ? cut(String(url)) : "no page";
  }
}

/** MB as the log says them. @param {number} mb */
const mbOf = (mb) => `${Math.round(mb).toLocaleString("en-US")} MB`;

/** The crashes a window's page may have in `CRASH_SPAN_MS`: at the last, it is loaded no more — a page that goes down as
 *  it loads would load and go down for ever. */
export const CRASH_CAP = 3;
export const CRASH_SPAN_MS = 10 * 60_000;
/** A chat whose page went down within this of an earlier time on that chat is left out of the next load. */
export const CHAT_CRASH_MS = 30 * 60_000;
/** How long after its process went a page is loaded again: what is left of the process settles first. */
export const RELOAD_AFTER_MS = 800;

/**
 * What a window loaded no more says, in the app's own page (lib/waiting.js `waitPage`): Filament's icon loads the
 * harness and the dashboard again in the same window, which keeps what its chats had queued (main.js `openWindow`); a
 * pane's own window is closed, its pane going back to the main window. @param {boolean} pane
 */
export const stoppedWords = (pane) => ({
  title: "This window's page kept going down",
  line: `Its process went ${CRASH_CAP} times in ${CRASH_SPAN_MS / 60_000} minutes, so Filament stopped loading it. ${pane ? "Close this window to bring its pane back to the main one." : "Choose Filament's icon to load it once more."}`,
});

/** The reasons a page's process went that are its memory's: the chat it showed is left out of the next load. */
const MEMORY_REASONS = Object.freeze(["oom", "memory-eviction"]);

/** The harness page's own address: the only one that hears why it was loaded again, and shows a chat. @param {URL} u */
const harnessAt = (u) => (u.protocol === "http:" || u.protocol === "https:") && u.pathname.endsWith("/ui/harness.html");

/** The chat a harness address shows (`#/task/<chainId>`), or none. @param {string} url */
export function chatOf(url) {
  try {
    const u = new URL(url);
    const m = harnessAt(u) ? /^#\/task\/([^/?#]+)/.exec(u.hash) : null;
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{ do: "again" | "without" | "stop" | "leave", url: string | null, chat: string | null }} CrashPlan
 * What a window does once its page's process went: `again`, its page loaded at the same place; `without`, loaded
 * without the chat its address shows — the process went for its memory, or that chat's page went down twice within
 * `CHAT_CRASH_MS`; `stop`, loaded no more, at the `CRASH_CAP`-th time within `CRASH_SPAN_MS`, the app's own page saying
 * so; `leave`, nothing loaded — the page that went was already the app's own (that page, or the waiting one), whose
 * process going again and again must not load it for ever. The harness hears why in its address — `crashed`, and
 * `away`, the chat it left out, kept where its page went down again before taking them off — which it says
 * (ui/harness/lib/crash-notice.js); any other page is loaded as it was.
 */

/**
 * @param {{ at: number, chat: string | null }[]} before  the window's earlier crashes, oldest first
 * @param {{ reason: string, url: string, now: number }} c
 * @returns {CrashPlan}
 */
export function crashPlan(before, { reason, url, now }) {
  /** @type {URL | null} */
  let u = null;
  try {
    u = new URL(url);
  } catch {}
  const web = !!u && (u.protocol === "http:" || u.protocol === "https:");
  const chat = chatOf(url);
  if (before.filter((x) => now - x.at < CRASH_SPAN_MS).length + 1 >= CRASH_CAP) return { do: web ? "stop" : "leave", url: null, chat };
  if (!u || !harnessAt(u)) return { do: "again", url: url || null, chat: null };
  u.searchParams.set("crashed", reason.slice(0, 40));
  const leave = !!chat && (MEMORY_REASONS.includes(reason) || before.some((x) => x.chat === chat && now - x.at < CHAT_CRASH_MS));
  if (!leave) {
    if (chat) u.searchParams.delete("away");
    return { do: "again", url: u.href, chat };
  }
  u.hash = "";
  u.searchParams.set("away", /** @type {string} */ (chat));
  return { do: "without", url: u.href, chat };
}

/**
 * Watch one window's page. `name` says which window it is (asked as it is needed: a pane's window is named once it
 * pops out), `quitting` whether the app is going (a page ending then is the app's own doing), `lastOf` what the
 * sampler saw last of a process. The page's process is remembered while it lives — once it is gone it has no id to
 * ask by. `pid()` is that id, for the sampler to name the window's line. A handler that throws says so in the log and
 * never reaches Electron: main has no handler of its own for one, and an error dialog every time would be worse.
 * `recover` is handed what the window does next (`crashPlan`), the line having said it; main does it.
 * @param {WatchedContents} wc
 * @param {{ name: () => string, log: (line: string) => void, quitting: () => boolean, lastOf?: (pid: number) => SeenMemory | null, now?: () => number, recover?: (plan: CrashPlan) => void }} o
 * @returns {{ pid: () => number }}
 */
export function watchRenderer(wc, { name, log, quitting, lastOf = () => null, now = Date.now, recover = () => {} }) {
  let pid = 0;
  /** @type {number | null} */
  let stuckSince = null;
  /** The window's crashes as long as a plan reads them back, oldest first. @type {{ at: number, chat: string | null }[]} */
  let crashes = [];
  const seen = () => {
    try {
      const p = wc.getOSProcessId();
      if (p > 0) pid = p;
    } catch {}
    return pid;
  };
  /** @param {string} what @param {(...args: any[]) => void} fn */
  const safely = (what, fn) => (/** @type {any[]} */ ...args) => {
    try {
      fn(...args);
    } catch (e) {
      try {
        log(`a window's ${what} could not be said: ${/** @type {any} */ (e)?.message || e}`);
      } catch {}
    }
  };
  wc.on("did-finish-load", safely("load", seen));
  wc.on("dom-ready", safely("load", seen));
  wc.on(
    "render-process-gone",
    safely("ended page", (/** @type {unknown} */ _e, /** @type {{ reason?: string, exitCode?: number } | undefined} */ d) => {
      const reason = String(d?.reason || "unknown");
      // The app's own going, a page that ended cleanly, or a window already gone: nothing went wrong.
      if (quitting() || reason === "clean-exit" || wc.isDestroyed()) return;
      const was = pid;
      pid = 0;
      stuckSince = null;
      let url = "";
      try {
        url = wc.getURL();
      } catch {}
      const t = now();
      const plan = crashPlan(crashes, { reason, url, now: t });
      crashes = [...crashes.filter((x) => t - x.at < Math.max(CRASH_SPAN_MS, CHAT_CRASH_MS)), { at: t, chat: plan.chat }];
      // Loaded again whatever the line could say.
      try {
        const last = was ? lastOf(was) : null;
        const memory = last
          ? `; last seen at ${mbOf(last.mb)} ${last.measure || "private"} ${Math.max(0, Math.round((t - last.at) / 1000))} s before, ${mbOf(last.peakMB)} at most since the memory log's last line`
          : "; no memory seen of it yet";
        const times = `${CRASH_CAP} times in ${CRASH_SPAN_MS / 60_000} minutes`;
        const next =
          plan.do === "stop"
            ? `; loaded no more: ${times}`
            : plan.do === "leave"
              ? `; left as it is: ${times}, the app's own page among them`
              : plan.do === "without"
                ? `; loaded again without chat ${plan.chat} (${MEMORY_REASONS.includes(reason) ? "its memory" : `its second time in ${CHAT_CRASH_MS / 60_000} minutes`})`
                : "; loaded again";
        log(`${name()}'s page process ended: ${reason}, exit code ${Number(d?.exitCode ?? 0)}${was ? `, pid ${was}` : ""}, showing ${url ? placeOf(url) : "no page"}${memory}${next}`);
      } finally {
        recover(plan);
      }
    }),
  );
  wc.on(
    "unresponsive",
    safely("stop", () => {
      if (stuckSince != null) return;
      stuckSince = now();
      log(`${name()} stopped answering`);
    }),
  );
  wc.on(
    "responsive",
    safely("answer", () => {
      if (stuckSince == null) return;
      const s = Math.round((now() - stuckSince) / 1000);
      stuckSince = null;
      log(`${name()} answers again after ${s} s`);
    }),
  );
  return { pid: seen };
}
