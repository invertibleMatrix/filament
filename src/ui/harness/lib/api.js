// @ts-check
// The harness's two doors: the admin API through the shared `ui/lib` client (CSRF header and error shape included),
// and the model door — a native session's turn row (`POST /api/sessions/:id/turns`, which answers in `/v1/messages`
// shape) or the front door itself (`/v1/messages`) — with the inbound key it was handed at boot. The key lives in a
// module variable only — never in localStorage. Both doors name this page's tab (decision 22): the server refuses a
// write from a tab that follows its session read-only.
import { createApi, pressBridge, pressFetch, pressHeaders, setViewOnly } from "../../lib/api.js";
import { readSse, createAnthropicAccumulator } from "./stream.js";
import { saidUnder } from "./failure.js";
import { TAB_ID, takeNow } from "./tab.js";
import { holdWhileShown } from "../../lib/put-away.js";
import { runSocket } from "./run-socket.js";

// A turn needs no inbound key (guards.js `markSessionTurn`): the page sets none, and the keys never leave the machine they
// belong to (the owner's remote Filament of 11-06). A test that calls the turn route as another client sets one.
let inboundKey = "";
export const setInboundKey = (k) => {
  inboundKey = String(k || "");
};

/**
 * A write made as the person acts in this page takes the session on screen over from the tab that writes it (lib/tab.js
 * `takeNow`; session-writers.js `takeOf`): the writing follows the person. It names that session, and the server takes
 * it only where the write is that session's. A read takes nothing, and nor does a write that says `take: false` (a
 * chat's read or unread mark: opening a chat is no act of writing it).
 * @param {(RequestInit & { take?: boolean }) | undefined} init @returns {RequestInit | undefined}
 */
const taking = (init) => {
  if (!init) return init;
  const { take, ...rest } = init;
  const chain = take === false || String(rest.method || "GET").toUpperCase() === "GET" ? "" : takeNow();
  return chain ? { ...rest, headers: { ...(/** @type {any} */ (rest.headers) || {}), "x-filament-take": chain } } : rest;
};
// This computer's press carries the desktop app's key on each write of the page (ui/lib/api.js `pressFetch`).
const tabApi = createApi({ headers: { "x-filament-tab": TAB_ID }, fetchImpl: (url, init) => pressFetch(url, taking(init)) });
/** Heard when the server refuses a write because another tab writes the session: the page's view of it was stale. */
let onReadOnly = () => {};
/** @param {() => void} fn */
export const whenReadOnly = (fn) => {
  onReadOnly = fn;
};
export { VIEW_ONLY_REFUSED } from "../../lib/api.js";
/**
 * The page is a view-only device's (/api/state's device, app.js `paintViewOnly`): its client asks no write — the
 * shared client's gate (ui/lib/api.js `setViewOnly`), the console's too.
 * @param {boolean} on
 */
export const setViewOnlyApi = (on) => setViewOnly(on);
/**
 * The admin API, as this tab. On a view-only device's page a write is asked of no one (ui/lib/api.js `createApi`).
 * @type {ReturnType<typeof createApi>}
 */
export const api = async (path, init) => {
  try {
    return await tabApi(path, init);
  } catch (e) {
    if (/** @type {any} */ (e)?.body?.readOnly === true) onReadOnly();
    throw e;
  }
};

/** @type {Map<string, { p: Promise<any>, at: number }>} */
const onTheWay = new Map();
/**
 * A read of the admin API that shares an answer on its way: the same path asked again before it lands gets that
 * answer, not a request of its own. A session's row is read by the goal's look and by the Plan view as it opens, and
 * each asked for it. Nothing is kept once the answer lands: the next ask is a new read. `since`: a read that began
 * then or before is not shared — the feed said what it reads moved then (`git-moved`, the review of 11-02: the header's
 * ask again took the read on its way, begun before the move, and kept its answer) —, and the read begun in its place is
 * the one later asks share.
 * @param {string} path
 * @param {{ read?: (path: string) => Promise<any>, since?: number }} [o]  `read`: the reader (the admin API; a test's stand-in)
 * @returns {Promise<any>}
 */
export function apiShared(path, { read = api, since = 0 } = {}) {
  const had = onTheWay.get(path);
  if (had && had.at > since) return had.p;
  const entry = { p: /** @type {Promise<any>} */ (Promise.resolve(null)), at: Date.now() };
  entry.p = read(path).finally(() => {
    if (onTheWay.get(path) === entry) onTheWay.delete(path);
  });
  onTheWay.set(path, entry);
  return entry.p;
}

/**
 * Every row of a list the admin API answers a page at a time (`limit`, `offset`), read page after page until one comes
 * back short: `path` with the list's own query, `key` the answer's field the rows are in. A row read twice — the list
 * moved under the reads — is kept once, by its id; a full page that brings nothing new ends the reading.
 * @param {string} path @param {string} key
 * @param {{ read?: (path: string) => Promise<any>, page?: number }} [o]  `read`: the admin API (a test's stand-in);
 *   `page`: the rows one read asks for
 * @returns {Promise<any[]>}
 */
export async function readEvery(path, key, { read = api, page = 200 } = {}) {
  /** @type {any[]} */
  const out = [];
  const seen = new Set();
  for (let offset = 0; ; offset += page) {
    const rows = /** @type {any[]} */ ((await read(`${path}${path.includes("?") ? "&" : "?"}limit=${page}&offset=${offset}`))?.[key] || []);
    let fresh = 0;
    for (const r of rows) {
      if (seen.has(r?.id)) continue;
      seen.add(r?.id);
      out.push(r);
      fresh++;
    }
    if (rows.length < page || !fresh) return out;
  }
}

/** The model-door headers one request shares. @param {Record<string, string>} extra */
export function chatHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    ...(inboundKey ? { "x-api-key": inboundKey } : {}),
    ...extra,
  };
}

/**
 * Read a `/v1/messages`-shaped reply — an event stream or one JSON body — into the accumulator. `onEvent(j, reply)`
 * fires per parsed SSE event with the accumulator's live reply object (the same reference throughout — render
 * from it). An HTTP error lands on `reply.error` with the body clipped for the banner's Show details. The run events a
 * harness turn's reply carries beside it (`filament_run` frames, R3) go to `onRunEvent` and never reach the reply.
 * @param {Response} res @param {((j: any, reply: any) => void) | undefined} onEvent
 * @param {((e: any) => void) | null} [onRunEvent]
 */
async function readReply(res, onEvent, onRunEvent = null) {
  const ct = res.headers.get("content-type") || "";
  const acc = createAnthropicAccumulator();
  if (ct.includes("text/event-stream")) {
    await readSse(res, (j) => {
      if (j?.type === "filament_run") {
        if (j.event) onRunEvent?.(j.event);
        return;
      }
      acc.push(j);
      onEvent?.(j, acc.reply);
    });
    return acc.reply;
  }
  const t = await res.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {}
  if (!res.ok) {
    const under = saidUnder(j);
    acc.reply.error = j?.error?.message || j?.error || `HTTP ${res.status}`;
    acc.reply.failure = under.failure;
    // Under the message: the agent's own error where the body carries one, else the body as it came.
    acc.reply.errorDetail = under.detail ? under.detail.slice(0, 4000) : `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}\n${t.slice(0, 4000)}`;
    acc.reply.httpStatus = res.status;
    acc.reply.errorBody = j || null; // a 409 carries the holder (Step 3 D14): the queue UI reads it
  } else if (j) {
    for (const b of j.content || []) {
      if (b.type === "text") acc.reply.blocks.push({ type: "text", text: b.text || "" });
      else if (b.type === "thinking") acc.reply.blocks.push({ type: "thinking", text: b.thinking || "" });
    }
    acc.reply.usage = j.usage || null;
    acc.reply.stopReason = j.stop_reason || null;
  } else acc.reply.error = `HTTP ${res.status}: ${t.slice(0, 300)}`;
  onEvent?.(j || { type: "error" }, acc.reply);
  return acc.reply;
}

/**
 * A send's own name (`sendId`): the turn it begins or goes on in keeps it, so a send whose reply's head never came
 * knows its turn. `getRandomValues`, unlike `randomUUID`, is there on a page served to another machine by its address.
 */
export const newSendId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The head that says how a turn's message went while the turn before it ran (the owner's of 11-09), for the server to
 * keep with the turn's record:
 *
 *   x-filament-via: row=<row>; by=<by>
 *
 * `<row>`: one word of lowercase letters and dashes, at most 40 — `when-done` (the ⌄ menu's Send when it's done, or
 * the send key where it does that), `stop-and-send` (Stop and send), `next-step` (Send at its next step, where the message
 * went as the next one instead: its run took none, or the turn ended before a run was known), `unread-note` (a note the turn ended before reading, sent again as the next message),
 * `queue-next-step` (the queue panel's send on a row), and the menu's other rows as their steers name them (`veto`,
 * `interrupt`, `aside`). `<by>`: `key` (the send key or the veto key), `click` (the button, a row) or `auto` (no press:
 * Filament sent it again by itself). Exactly one space after the `;`, the fields in that order. No head at all for a
 * message typed between turns, or anything not of that form — a reader takes its absence as "not said".
 * @param {{ row: string, by: string } | null | undefined} via @returns {{ "x-filament-via"?: string }}
 */
export const viaHeader = (via) =>
  via && /^[a-z][a-z-]{0,39}$/.test(String(via.row)) && (via.by === "key" || via.by === "click" || via.by === "auto") ? { "x-filament-via": `row=${via.row}; by=${via.by}` } : {};

/**
 * One turn of a native session (HarnessV2 §8.1): the server composes the request from the archive and the session's
 * settings; only the new message travels. The reply is in `/v1/messages` shape, streamed. `onHeaders` gets the request
 * id and the settings marks (`settingsHash`; `boundary` = the previous hash when the document changed since the last
 * turn). The row needs the inbound key too, because the turn enters the pipeline. The turn asks for its run's events in
 * the reply (HarnessV3-Responsiveness R3): an agent turn's head says it carries them (`marks.runEvents`), and each one
 * reaches `onRunEvent` — the page follows no second stream for them. The head counts what rode ahead of the message
 * (`deliveries`, of them `shellExits` background shells' exits and `asking` the line that names whom the agent may ask;
 * HarnessV3-Readiness RD1 c), 0 when nothing did.
 * `allow`: the person's press on the card of the call the turn waits on — true for Allow, the one way it runs; false
 *   for Deny, whose words never run it, whatever they say; left out (null), the message answers it as words do.
 * `modeSwitch`: the message is the permission switch answering a waiting call (HarnessV3-AtHome AH-F1).
 * `sendAsIs`: the message goes past the cold-cache question — the card's answer Send as it is, and the resend after
 * its Compact and send (HarnessV4_Tasks C26).
 * `overrules`: the saved agents' answers the message overrules (HarnessV4_Tasks E15 step 3): Filament tells the agent
 * whose, ahead of the words.
 * `carry`: the form a switch's fresh agent session carries the earlier turns in — the switch card's answer
 * (HarnessV4_Tasks A7).
 * `use`: the saved agents the message names with an `@` past its start (their tags), and `useTeams` the teams (their
 * keys) — HarnessV4_OneAgent_Plan OA2: nothing starts at Send; Filament tells the main agent to use them, ahead of the
 * words. The head says how many it named so (`use`).
 * `flow`: the words are a /flow's (OA3): Filament asks the main agent to design a flow from them, ahead of the words; the
 * head says it did (`flow`). `plan`: the message is a /plan: Filament asks the main agent to plan the work whole before
 * any of it starts; the head says so (`plan`). Parallelize tasks is the session's to read (the review of 11-09): the page
 * sends no word of it.
 * `sendId`: the send's own name (`newSendId`), which the turn keeps.
 * `via`: the way a message sent while the turn before ran went (the owner's of 11-09) — queued for the turn's end,
 * stopped-and-sent, or a note that turn never read, sent again: said in the request's head as `viaHeader` writes it.
 * `thread`: the content is a thread's brief, sent again as the brief it was (Retry on its turn; `againOf`): the server
 * takes it as its starter's agent's, in a thread whose turns are briefs with no reply.
 * `take`: sent as the person acts in this tab, into the session on screen (lib/tab.js `takeNow`, read as the send goes): it
 * takes the session over. A queued send of a chat not shown takes nothing.
 * @param {{ chainId: string, content: any, sendId?: string | null, permissions?: string | null, allow?: boolean | null, modeSwitch?: boolean, settingsPatch?: any, load?: string | null, sendAsIs?: boolean, overrules?: any[], carry?: string | null, use?: string[], useTeams?: string[], flow?: boolean, plan?: boolean, thread?: boolean, via?: { row: string, by: string } | null, take?: boolean, signal: AbortSignal,
 *   onHeaders?: (requestId: string | null, marks: { settingsHash: string | null, boundary: string | null, status: number, cardKind: string | null, runEvents: boolean, run: boolean, deliveries: number, asking: number, shellExits: number, shellWatch: number, shellWake: number, shellIdle: number, shellCancel: number, use: number, flow: boolean, plan: boolean, planCard: boolean, side: boolean, flowStarts: number, flowNews: number, rewindNote: boolean, goalHalt: boolean, turn: number | null }) => void,
 *   onEvent: (j: any, reply: any) => void, onRunEvent?: (e: any) => void }} o
 */
export async function postTurn({ chainId, content, sendId = null, permissions = null, allow = null, modeSwitch = false, settingsPatch = null, load = null, sendAsIs = false, overrules = [], carry = null, use = [], useTeams = [], flow = false, plan = false, thread = false, via = null, take = !!chainId && takeNow() === chainId, signal, onHeaders, onEvent, onRunEvent }) {
  const res = await fetch(`/api/sessions/${encodeURIComponent(chainId)}/turns`, {
    method: "POST",
    // When the page sent it: the record holds the gap to the route's own stamp (BUG-19, F3 item 17).
    // Sent as the person acts in this tab (a press, a key): it takes the session over from the tab that writes it.
    headers: chatHeaders({ "x-filament-ui": "1", "x-filament-sent-at": String(Date.now()), "x-filament-tab": TAB_ID, ...(take ? { "x-filament-take": chainId } : {}), ...viaHeader(via), ...(pressBridge() ? await pressHeaders(pressBridge()) : {}) }),
    body: JSON.stringify({
      content,
      stream: true,
      runEvents: true,
      ...(sendId ? { sendId } : {}),
      ...(permissions ? { permissions } : {}),
      ...(typeof allow === "boolean" ? { allow } : {}),
      ...(modeSwitch ? { modeSwitch: true } : {}),
      ...(settingsPatch ? { settingsPatch } : {}),
      ...(load ? { load } : {}),
      ...(sendAsIs ? { sendAsIs: true } : {}),
      ...(overrules.length ? { overrules } : {}),
      ...(carry ? { carry } : {}),
      ...(use.length ? { use } : {}),
      ...(useTeams.length ? { useTeams } : {}),
      ...(flow ? { flow: true } : {}),
      ...(plan ? { plan: true } : {}),
      ...(thread ? { by: "thread" } : {}),
    }),
    signal,
  });
  const requestId = res.headers.get("x-filament-request-id");
  onHeaders?.(requestId, {
    settingsHash: res.headers.get("x-filament-settings-hash"),
    boundary: res.headers.get("x-filament-settings-boundary"),
    status: res.status,
    cardKind: res.headers.get("x-filament-card"),
    runEvents: res.headers.get("x-filament-run-events") === "1",
    // The turn has a run to look up (LD-D13): a command Filament answered itself has none.
    run: res.headers.get("x-filament-run") === "1",
    deliveries: Number(res.headers.get("x-filament-deliveries")) || 0,
    asking: Number(res.headers.get("x-filament-asking")) || 0,
    shellExits: Number(res.headers.get("x-filament-shell-exits")) || 0,
    shellWatch: Number(res.headers.get("x-filament-shell-watch")) || 0,
    shellWake: Number(res.headers.get("x-filament-shell-wake")) || 0,
    shellIdle: Number(res.headers.get("x-filament-shell-idle")) || 0,
    shellCancel: Number(res.headers.get("x-filament-shell-cancel")) || 0,
    use: Number(res.headers.get("x-filament-use")) || 0,
    flow: res.headers.get("x-filament-flow") === "1",
    plan: !!res.headers.get("x-filament-plan"),
    // …and whether a card can follow it: the agent has a task graph to plan on.
    planCard: res.headers.get("x-filament-plan") === "graph",
    // The box's side by side line rode ahead of the message (11-06): counted apart from the agents' messages.
    side: res.headers.get("x-filament-side") === "1",
    flowStarts: Number(res.headers.get("x-filament-flow-starts")) || 0,
    flowNews: Number(res.headers.get("x-filament-flow-news")) || 0,
    rewindNote: res.headers.get("x-filament-rewind-note") === "1",
    // The line on why the goal's drive halted rode ahead of the message (core/goal-drive.js `haltLine`).
    goalHalt: res.headers.get("x-filament-goal-halt") === "1",
    // The number the session gave the turn (memory numbers it as it opens; a turn memory leaves out has none).
    turn: Number(res.headers.get("x-filament-turn")) || null,
  });
  const reply = await readReply(res, onEvent, onRunEvent || null);
  return { requestId, status: res.status, reply, cardKind: res.headers.get("x-filament-card") };
}

/** What a view drawing a run from its log says when the server no longer holds it (`followRun`'s `onMissing`). */
export const RUN_GONE = "This run's log is no longer kept: what is drawn is all it had.";

/**
 * Follow a run's event log: replay everything after `since`, then follow live, on the page's run socket
 * (lib/run-socket.js — one WebSocket for every follow of the page, so a followed run holds none of the browser's six
 * connections to Filament). The server ends the follow at run-end; `onDone` runs then. `stop()` lets the follow go, as
 * the page put away does (ui/lib/put-away.js: brought back, it loads afresh and follows the run again). The stream names
 * its run as it opens: `onRun` hears it — its kind and status — on each connection, whatever the ring still holds. A gap
 * the log cannot fill is handed to `onGap` — announced, never skipped. With `words`, the stream carries the running
 * turn's words beside its events (HarnessV3-Launch LD-D16): each `words` frame reaches `onWords` — the blocks so far,
 * then each piece. A dropped connection, an end with no end marker (a restart?) or a frame its hearer failed on is
 * followed again from the cursor after a beat; the ring keeps the events meanwhile. A run the server does not hold (not
 * registered yet, or its log swept) ends the follow in the open: `onMissing`, then `onDone` — never `onRunEnd`, its end
 * was not seen, and never a retry: whoever follows decides whether to ask again (fable51's F4: it used to return
 * without a word, and the view kept the running face it had drawn).
 * @param {string} runId @param {{ since?: number, words?: boolean, onEvent: (e: any, ev?: { data: string, id: string | null }) => void, onWords?: (frame: any) => void, onRun?: (run: any) => void, onGap?: (gap: any) => void, onMissing?: () => void, onDone?: () => void, onRunEnd?: (status: string) => void }} o
 */
export function followRun(runId, { since = 0, words = false, onEvent, onWords, onRun, onGap, onMissing, onDone, onRunEnd }) {
  let stopped = false;
  let cursor = since;
  /** The follow on the socket now, as its stop. @type {(() => void) | null} */
  let untap = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let beat;
  /** @type {() => void} */
  let settle = () => {};
  const p = new Promise((resolve) => {
    settle = () => resolve(undefined);
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(beat);
    untap?.();
    untap = null;
    settle();
  };
  const release = holdWhileShown(stop);
  /** @param {any} j @param {{ data: string, id: string | null }} ev */
  const dispatch = (j, ev) => {
    // The stream's own envelopes: `hello` (the page's run, gap and first-available), `ended` (a run that had
    // already ended when we arrived), a live `run-end` event flowing through the ring. Everything else is a run event.
    if (j.type === "hello") {
      if (j.run) onRun?.(j.run);
      if (j.gap) onGap?.(j.gap);
      return null;
    }
    if (j.type === "ended") return j.status || "ended";
    if (j.type === "words") {
      onWords?.(j);
      return null;
    }
    if (j.type === "run-end") {
      onEvent(j, ev);
      return j.status || "ended";
    }
    if (j.n != null) cursor = j.n;
    onEvent(j, ev);
    return null;
  };
  /** The follow over, said: `stop()` has nothing left to let go. @param {() => void} say */
  const over = (say) => {
    untap = null;
    stopped = true;
    try {
      say();
    } finally {
      settle();
    }
  };
  /** Followed again from the cursor, after a beat. */
  const again = () => {
    untap?.();
    untap = null;
    if (!stopped) beat = setTimeout(follow, 1200);
  };
  const follow = () => {
    if (stopped) return;
    /** @type {string | null} */
    let ended = null;
    untap = runSocket.tap(runId, { since: cursor, words }, {
      frame: (j, data) => {
        try {
          // An event carries its number as the stream's id, the stream's own frames none.
          ended = dispatch(j, { data, id: j?.n != null ? String(j.n) : null }) || ended;
        } catch {
          again();
        }
      },
      missing: () =>
        over(() => {
          onMissing?.();
          onDone?.();
        }),
      end: () => {
        untap = null;
        if (!ended) return again();
        const status = ended;
        over(() => {
          onRunEnd?.(status);
          onDone?.();
        });
      },
      drop: () => {
        untap = null;
        again();
      },
    });
  };
  follow();
  return { promise: p.finally(release), stop };
}

/**
 * Whether this page drives another machine's Filament (the owner's remote Filament of 11-06): its server says it reads
 * the page from elsewhere (`/api/state`'s `viewer`, which the page hands `setRemotePage`, or a refusal marked `remote`),
 * or its address names the SSH alias the rail reached the machine by (`sshAlias`) — through an SSH tunnel the page is
 * this machine's own to its server. What opens a window opens it on the screen of the machine Filament runs on, not
 * yours — the folder dialog, Show in folder, the file manager —, so such a page asks for none: it browses folders in the
 * page and copies a path.
 */
let remote = false;
/** @param {boolean} on */
export const setRemotePage = (on) => {
  remote = on === true;
};
export const remotePage = () => remote || !!sshAlias();

/**
 * The SSH alias the rail reached this machine by — its address's `ssh`, as the rail opens a machine over its SSH route —
 * which an editor on your machine opens a folder of it by (lib/editors.js). "" where it names none, or names what is no
 * host's alias: letters, digits, `.`, `_` and `-`, a `user@` before them at most, never a `-` first (ssh would read an
 * option there).
 */
export const sshAlias = () => {
  let said = "";
  try {
    said = new URLSearchParams(String(globalThis.location?.search || "")).get("ssh") || "";
  } catch {}
  return said.length <= 253 && /^(?:\w[\w.-]*@)?\w[\w.-]*$/.test(said) ? said : "";
};

/**
 * The OS folder dialog — the desktop app's own, over its window (desktop/harness-preload.cjs `filamentApp.pickFolder`),
 * else raised by the server, which runs on this machine: either way the user's real Explorer or Finder, and an absolute
 * path back. `"picked"` on success, `false` when the dialog was cancelled (nothing more to do), `"failed"` when it
 * could not be raised — that is the case callers answer with the inline browser, said through `onError` only where a
 * dialog should have opened: a server with none (`noDialog`, a headless Linux) is quiet. On another machine's page
 * (`remotePage`) neither is asked for, and `"failed"` is said to no one: the inline browser is that page's own way.
 * @param {HTMLInputElement} input
 * @param {(msg: string) => void} [onError]
 * @returns {Promise<"picked" | "failed" | false>}
 */
export async function pickFolderNative(input, onError) {
  if (remotePage()) return "failed";
  /** @param {string} path */
  const fill = (path) => {
    input.value = path;
    input.dispatchEvent(new Event("input"));
    return /** @type {const} */ ("picked");
  };
  const app = /** @type {any} */ (globalThis).filamentApp;
  // The app's answer, or null where it does not hear this page: then the server's.
  const mine = typeof app?.pickFolder === "function" ? await Promise.resolve().then(() => app.pickFolder()).catch((/** @type {any} */ e) => ({ ok: false, reason: String(e?.message || e) })) : null;
  if (mine?.ok && mine.path) return fill(String(mine.path));
  if (mine?.cancelled) return false;
  if (mine) {
    onError?.(`the folder dialog could not open (${mine.reason || "unknown reason"}) — the inline picker is the fallback`);
    return "failed";
  }
  try {
    const r = await api("/files/pick-folder", { method: "POST", body: {} });
    if (r?.ok && r.path) return fill(r.path);
    if (r?.noDialog) return "failed";
    if (r && r.ok === false && !r.cancelled) {
      onError?.(`the folder dialog could not open (${r.reason || "unknown reason"}) — the inline picker is the fallback`);
      return "failed";
    }
  } catch (/** @type {any} */ e) {
    // The server's word that this page is another machine's (http/admin/files.js), heard before /api/state's: so from here on.
    if (e?.body?.remote === true) {
      setRemotePage(true);
      return "failed";
    }
    onError?.(`the folder dialog could not open (${String(e?.message || e)}) — the inline picker is the fallback`);
    return "failed";
  }
  return false;
}
