// @ts-check
// The desk's bridge (the remote desk of 11-22): This computer's page acts on the window's other machines through here, in
// Electron main, by a short table of operations — never a path, never a token. Each operation names what it does (its
// chats, a search, a turn, an answer…); its request is made here — the machine's admin route, its ids encoded, its body's
// fields this module's own — and sent as this window's sign-in there (lib/reach.js). A write about a chat goes as the
// desk's own tab there (`x-filament-tab`, `x-filament-take`), so that machine's one-writer rule holds and its page says
// the chat is open for writing on this computer. A press — an answer, a mode, a chat started in one — goes as a Full
// device alone. And one events stream per machine kept and connected (its /api/events, as the desk's tab) says when
// something there moved: its hello, a turn's start or end, a chat's writer, an ask — each frame cut to the fields the desk
// reads, for main to tell This computer's page and to look again. Plain Node (NA-D13).
import { randomBytes } from "node:crypto";
import { pickRoute } from "./machines.js";
import { deskChats, routeFetch } from "./watch.js";
import { ANSWER_MAX, CALL_MS, FOR, createReach } from "./reach.js";
import { LEARN_MS } from "./learn-routes.js";
import { bodyText } from "../../src/services/machines/client.js";

/** How long a write waits on its answer: a chat made in its folder, a stop, a mode written. */
const WRITE_MS = 20_000;
/** How long a turn — or a chat's own ask's answer, which goes on in its turn — waits for its answer's head. */
const BEGIN_MS = 20_000;
/** How long a machine stays reached — its way asked, its /remote/me read — for the calls that follow. */
const REACHED_MS = 20_000;
/** How long its first bytes are waited on once the head came, before its stream is let go: the turn goes on there. */
const FIRST_MS = 3000;
/** The most calls one machine has under way from the desk at once: a page that asks past them is told so. */
export const CALLS_MOST = 8;
/** The longest message a turn carries, in characters, and the longest words an answer carries. */
const CONTENT_MAX = 200_000;
const WORDS_MAX = 20_000;
/** The longest search, title and model's name; the longest folder, past which none is sent (a folder cut is another). */
const QUERY_MAX = 200;
const TITLE_MAX = 200;
const MODEL_MAX = 200;
const FOLDER_MAX = 400;
/** The most of a machine's words a refusal says. */
const SAID_MAX = 300;
/**
 * A chat's id, a run's, an option's: as the desk's other ids (main.js `filament:desk-seen`). A letter or a digit first:
 * an id of dots alone would be a step up the path its request goes to (`/sessions/../settings`).
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
/** An ask's id (http/admin/sessions.js `asksIn`): its request's, or its run's or sub-agent's, a dot and its own. */
const ASK_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
/**
 * The longest id of an ask's answer (`choice`). It goes in the answer's body, never its path, so any words but control
 * characters are one: a coding agent's question names its answers by their labels ("Use Postgres").
 */
export const CHOICE_MAX = 500;
/** Whether `v` is an answer's id the desk sends. @param {unknown} v */
export const choiceOk = (v) => typeof v === "string" && v.length > 0 && v.length <= CHOICE_MAX && !/[\u0000-\u001f\u007f]/.test(v);
/** The permission modes a chat takes (src/ui/harness/composer/mode.js `MODES`). */
export const DESK_MODES = Object.freeze(["read-only", "edit", "ask", "auto"]);
/** The kinds of chat the desk lists, as the watch reads them (watch.js `CHATS_PATH`). */
const KINDS = "interactive,fork,team";
/** How long a machine's events stream may say nothing — its pings come every 25 s — before it is taken for gone. */
const QUIET_MS = 70_000;
/**
 * Its reconnect waits: from `AGAIN_MS`, doubling to `AGAIN_MAX_MS`. One that stood `STOOD_MS` from its hello is joined again at once,
 * by the best way that answers now, and said down only where that fails: its way gave out under it — a better one
 * taken, its tunnel let go —, not its machine.
 */
const AGAIN_MS = 2000;
const AGAIN_MAX_MS = 60_000;
const STOOD_MS = 60_000;
/** The most an unfinished frame of its may hold before the stream is let go: no frame the desk reads is near it. */
const FRAME_MAX = 4 * 1024 * 1024;
/**
 * The frames the desk reads off a machine's events stream, by their `type`: each is cut to its fields (`frameOf`). An
 * ask's comes from a Filament that publishes one as an ask opens or closes (s1f); from one before, a chat's own ask
 * still says itself by its turn's end, and another's at the watch's next look.
 */
const HEARD = new Set(["hello", "turn", "writer", "ask"]);

/**
 * What a call came to, for the page: `json` the machine's answer where it took it — a list's cut to the desk's fields —,
 * else `words`, what stands in the way; `press`: it needs a Full device's press, which this window's sign-in there is
 * not or was refused; `unsure`: a write whose answer never came, so
 * it may have been done there; `away`: the machine itself is disconnected or does not answer; `sendId`: a turn's own name,
 * which the turn there keeps — its chat's live state finds it.
 * @typedef {{ ok: boolean, status: number, json?: any, words?: string, press?: true, unsure?: true, away?: "off" | "quiet", sendId?: string }} DeskAnswer
 * A frame of a machine's events stream, as the page hears it: `hello` its stream (re)joined — what moved meanwhile is
 * read again —, `down` its stream lost; `turn` a chat's turn began or ended (`busy`); `writer` who writes a chat now —
 * this desk (`mine`), or a page elsewhere (`where`, its machine's name where one names it); `ask` an ask opened or closed
 * in a chat.
 * @typedef {{ machine: string, type: "hello" | "down" } | { machine: string, type: "turn", chain: string, busy: boolean }
 *   | { machine: string, type: "writer", chain: string, mine: boolean, where: string | null }
 *   | { machine: string, type: "ask", chain: string, ask: string, open: boolean }} DeskFrame
 * One operation's request: its method and path under /api, its body; `chat` the chat it writes (the tab's heads),
 * `write` a write's longer wait, `press` a Full device's alone, `stream` a turn's answer, let go once it begins,
 * `shape` its answer cut for the page. Every route here is one a Filament from before the desk answers: what a machine's
 * Filament does for the desk beyond them its /remote/me says (`desk`, reach.js `flags`), and the desk greys what it lacks.
 * @typedef {{ method: string, path: string, body?: any, chat?: string, write?: boolean, press?: boolean, stream?: boolean, shape?: (json: any) => any }} Built
 * @typedef {import("./machines.js").Machine} Machine
 * @typedef {import("./reach.js").Reached} Reached
 */

/** Words another machine said, as the page may show them: one line, control characters out, clipped. @param {unknown} v @param {number} [max] */
const said = (v, max = SAID_MAX) => {
  const s = String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
/** @param {any} e */
const why = (e) => said(e?.message || e, 200);
const enc = encodeURIComponent;
/** A request that cannot be made: its words. @param {string} error */
const bad = (error) => ({ error });
/** A list's rows: objects alone. @param {unknown} list @returns {any[]} */
const rowsOf = (list) => (Array.isArray(list) ? list.filter((r) => !!r && typeof r === "object") : []);
/** A chats' list cut to what the desk lists of each (watch.js `deskChats`). @param {any} json */
const listed = (json) => ({ chats: deskChats(rowsOf(json?.sessions)) });
/** A send's own name, as the page makes one (src/ui/harness/lib/api.js `newSendId`): the turn there keeps it. */
const newSendId = () => randomBytes(16).toString("hex");

/**
 * The operation on a chat named by its id: its request, or why none. @param {any} p
 * @param {(chat: string) => Built | { error: string }} fn
 */
const onChat = (p, fn) => {
  const chat = String(p.chat ?? "");
  return ID.test(chat) ? fn(chat) : bad("chat is the id of a chat there");
};

/**
 * Every operation the desk asks of another machine, by name: its request made from the page's fields, each checked;
 * nothing else reaches the machine. A null prototype: no name the page sends finds anything but these.
 * @type {Readonly<Record<string, (p: any) => Built | { error: string }>>}
 */
const OPS = Object.freeze(
  Object.assign(Object.create(null), {
    /** Its chats, newest first, as the desk lists them. */
    chats: () => ({ method: "GET", path: `/memory/sessions?limit=200&kind=${KINDS}&remotes=1`, shape: listed }),
    /**
     * Its chats that a search finds, as the desk lists them: without their repositories' keys, which a search's rows
     * never stand by and whose git reads would wait on each keystroke's (the review of s1h). @param {any} p
     */
    search: (p) => {
      const q = typeof p.q === "string" ? p.q.trim() : "";
      if (!q || q.length > QUERY_MAX) return bad(`q is the search: 1 to ${QUERY_MAX} characters`);
      return { method: "GET", path: `/memory/sessions?q=${enc(q)}&limit=20&kind=${KINDS}`, shape: listed };
    },
    /** Its chats at work now, and what else runs. */
    holders: () => ({ method: "GET", path: "/sessions/holders" }),
    /**
     * Who this window is there: a device (its id), the person's tailnet login, or this computer through a tunnel — a
     * chat of the person's in a copy placed for it starts from the device that made this Filament's agents' device there
     * alone (Run on, the remote desk's s2c).
     */
    me: () => ({ method: "GET", path: "/remote/me", shape: (/** @type {any} */ j) => ({ who: typeof j?.who === "string" ? said(j.who, 20) : null, device: typeof j?.device?.id === "string" && ID.test(j.device.id) ? j.device.id : null }) }),
    /** The asks waiting in a chat. @param {any} p */
    asks: (p) => onChat(p, (chat) => ({ method: "GET", path: `/sessions/${enc(chat)}/asks` })),
    /** A chat's live state: its turn at work, and what came after a run of its (`after`). @param {any} p */
    "live-state": (p) =>
      onChat(p, (chat) => {
        if (p.after != null && !ID.test(String(p.after))) return bad("after is the id of a run of the chat");
        return { method: "GET", path: `/sessions/${enc(chat)}/live-state${p.after != null ? `?after=${enc(String(p.after))}` : ""}` };
      }),
    /** A new chat there, in its folder; on its model and in its mode where named — a press there where it asks less. @param {any} p */
    create: (p) => {
      const cwd = typeof p.cwd === "string" ? p.cwd.trim() : "";
      if (!cwd || cwd.length > FOLDER_MAX || /^[\\/]{2}/.test(cwd)) return bad(`cwd is the folder the chat works in there: at most ${FOLDER_MAX} characters, on no share`);
      if (p.title != null && (typeof p.title !== "string" || p.title.length > TITLE_MAX)) return bad(`title is the chat's name: at most ${TITLE_MAX} characters`);
      if (p.model != null && (typeof p.model !== "string" || p.model.length > MODEL_MAX)) return bad("model is the name of a model there");
      if (p.mode != null && !DESK_MODES.includes(p.mode)) return bad(`mode is one of ${DESK_MODES.join(", ")}`);
      const title = String(p.title ?? "").trim();
      const body = { cwd, ...(p.model ? { model: p.model } : {}), ...(title ? { title } : { autoTitle: true }), ...(p.mode ? { settings: { loop: { permissions: p.mode } } } : {}) };
      return { method: "POST", path: "/sessions", body, write: true, shape: (/** @type {any} */ j) => ({ chat: typeof j?.id === "string" && ID.test(j.id) ? j.id : null }) };
    },
    /** A message sent in a chat, as the person's: past its cold-cache question, as the command line sends one. @param {any} p */
    turn: (p) =>
      onChat(p, (chat) => {
        if (typeof p.content !== "string" || !p.content.trim() || p.content.length > CONTENT_MAX) return bad(`content is the message: words, at most ${CONTENT_MAX} characters`);
        return { method: "POST", path: `/sessions/${enc(chat)}/turns`, body: { content: p.content, stream: true, runEvents: true, sendAsIs: true, sendId: newSendId() }, chat, write: true, stream: true };
      }),
    /**
     * An ask in a chat answered: a permission by its press (`allow`, or its `choice`), a question by its choice or its
     * words. Always a press there (http/admin/press.js). The chat's own ask goes on in its turn, as a stream. @param {any} p
     */
    answer: (p) =>
      onChat(p, (chat) => {
        const ask = String(p.ask ?? "");
        if (!ASK_ID.test(ask)) return bad("ask is the id of an ask waiting in the chat");
        if (p.allow != null && typeof p.allow !== "boolean") return bad("allow is true or false");
        if (p.choice != null && !choiceOk(p.choice)) return bad(`choice is the id of one of its options: words, at most ${CHOICE_MAX} characters`);
        if (p.words != null && (typeof p.words !== "string" || p.words.length > WORDS_MAX)) return bad(`words are the answer's own: at most ${WORDS_MAX} characters`);
        if (p.allow == null && p.choice == null && !String(p.words ?? "").trim()) return bad("an answer is allow, a choice or words");
        const body = { ...(p.allow != null ? { allow: p.allow } : {}), ...(p.choice != null ? { choice: p.choice } : {}), ...(p.words != null ? { words: p.words } : {}), stream: true, runEvents: true };
        return { method: "POST", path: `/sessions/${enc(chat)}/asks/${enc(ask)}/answer`, body, chat, write: true, press: true, stream: true };
      }),
    /** A chat's turn stopped. @param {any} p */
    stop: (p) => onChat(p, (chat) => ({ method: "POST", path: `/sessions/${enc(chat)}/stop`, body: {}, chat, write: true })),
    /** A chat's permission mode set: a press there where it asks less (http/admin/press.js), which that machine judges. @param {any} p */
    mode: (p) =>
      onChat(p, (chat) => {
        if (!DESK_MODES.includes(p.mode)) return bad(`mode is one of ${DESK_MODES.join(", ")}`);
        return { method: "PATCH", path: `/sessions/${enc(chat)}/settings`, body: { patch: { loop: { permissions: p.mode } } }, chat, write: true };
      }),
  }),
);
/** The operations' names. */
export const DESK_OPS = Object.freeze(Object.keys(OPS));

/**
 * A frame of a machine's events stream cut to what the desk reads of it, or null for one it reads nothing of. Its
 * chats' ids by pattern, its words clipped: another machine's Filament answers what it likes.
 * @param {any} d  the frame's data @param {string} tab  the desk's tab there
 */
export const frameOf = (d, tab) => {
  const chain = typeof d?.chainId === "string" && ID.test(d.chainId) ? d.chainId : null;
  if (d?.type === "hello") return { type: /** @type {const} */ ("hello") };
  if (!chain) return null;
  if (d.type === "turn") return { type: /** @type {const} */ ("turn"), chain, busy: !!d.holder };
  if (d.type === "writer") return { type: /** @type {const} */ ("writer"), chain, mine: typeof d.tab === "string" && d.tab === tab, where: said(d.where?.name, 80) || null };
  if (d.type === "ask" && typeof d.id === "string" && ASK_ID.test(d.id)) return { type: /** @type {const} */ ("ask"), chain, ask: d.id, open: d.open === true };
  return null;
};

/**
 * @param {{ machines: () => Machine[], cookieOf: (partition: string, origin: string) => Promise<string>, keepSignIn?: import("./watch.js").KeepSignIn, tell: (frame: DeskFrame) => void,
 *   pick?: typeof pickRoute, fetchOf?: (route: import("./machines.js").Route) => typeof fetch, tab?: string, now?: () => number,
 *   sleep?: (ms: number, signal: AbortSignal) => Promise<void>, quietMs?: number, beginMs?: number, learn?: (m: Machine, r: Reached) => Promise<unknown>, learnMs?: number }} o
 *   `machines`: the machines the window keeps, read now; `cookieOf`: the Cookie header the machine's partition sends that
 *   origin; `keepSignIn`: the sign-in an answer sent again, kept there (watch.js `storeSignIn`); `tell`: each frame of
 *   every machine's events stream the desk reads; `tab`: the desk's tab on every machine
 *   (made here, for this run of the app); `quietMs`: how long a stream may say nothing (`QUIET_MS`); `beginMs`: how long
 *   a turn's head is waited on (`BEGIN_MS`); `learn`: the ways a machine says it has, read where its stream is joined
 *   and each `learnMs` while it stands (lib/learn-routes.js)
 */
export function createDesk({ machines, cookieOf, keepSignIn, tell, pick = pickRoute, fetchOf = routeFetch, tab = `desk-${randomBytes(8).toString("hex")}`, now = Date.now, sleep = rest, quietMs = QUIET_MS, beginMs = BEGIN_MS, learn = async () => {}, learnMs = LEARN_MS }) {
  const reach = createReach({ cookieOf, keepSignIn, pick, fetchOf });
  /** A machine by its id, kept beside this computer now. @param {string} id */
  const machineOf = (id) => machines().find((m) => !m.local && m.id === String(id).toLowerCase()) ?? null;
  /** Calls under way, per machine. @type {Map<string, number>} */
  const calls = new Map();
  /**
   * Each machine as last reached, by its id, for `REACHED_MS`: its way asked and its /remote/me read once for a run of
   * calls — a way that no longer answers costs each call its wait else (the review of s1e). Its ways as they were, so a
   * machine whose ways changed is reached anew; let go at any call that failed on its way or its sign-in.
   * @type {Map<string, { r: Reached, at: number, ways: string }>}
   */
  const reachedOf = new Map();
  /** A machine reached, kept a moment, or what stands in the way. @param {Machine} m */
  const reachKept = async (m) => {
    const ways = JSON.stringify(m.routes);
    const had = reachedOf.get(m.id);
    if (had && had.ways === ways && now() - had.at < REACHED_MS) return had.r;
    const r = await reach(m, FOR.desk);
    if ("words" in r) reachedOf.delete(m.id);
    else reachedOf.set(m.id, { r, at: now(), ways });
    return r;
  };

  /** @param {string} words @param {Partial<DeskAnswer>} [o] @returns {DeskAnswer} */
  const no = (words, o = {}) => ({ ok: false, status: 0, words, ...o });

  /**
   * The machine's answer, as the page hears it: `json` as that machine said it, for the page to read as it reads any
   * other machine's words — ids by pattern, words clipped — (src/ui/harness/lib/desk.js `readDesk`); a sign-in it
   * refused lets go of the machine as reached.
   * @param {Machine} m @param {{ status: number, json: any }} a @param {Built} b @returns {DeskAnswer}
   */
  const answered = (m, a, b) => {
    if (a.status >= 200 && a.status < 300) return { ok: true, status: a.status, json: b.shape ? b.shape(a.json) : a.json };
    if (a.status === 401 || (a.status === 403 && a.json?.press !== true)) reachedOf.delete(m.id);
    const words = said(a.json?.error) || `HTTP ${a.status}`;
    // A press it refused: this window's sign-in there is no device whose press counts.
    if (a.status === 403 && a.json?.press === true) return no(`${m.name} refused it: ${words}. Pair this machine again as Full with Add a machine, and it works from here.`, { status: a.status, press: true });
    return no(`${m.name} answered: ${words}`, { status: a.status });
  };

  /**
   * A turn sent there — or a chat's own ask answered, which goes on in its turn —: its answer read until the turn
   * begins, then let go; the turn goes on there whether it is heard here or not. Never sent again: an answer that never
   * came may have reached it, and its `sendId` finds the turn. An answer that is no stream is read as any call's. A head
   * that does not come in `BEGIN_MS` — a coding agent's that starts cold writes none till its first words — has the
   * chat's live state asked: a turn at work there is this one begun (as remote-agents.js asks after a drop).
   * @param {Machine} m @param {Reached} r @param {Built} b @param {any} init @returns {Promise<DeskAnswer>}
   */
  async function begin(m, r, b, init) {
    const sendId = typeof b.body?.sendId === "string" ? b.body.sendId : null;
    const withId = sendId ? { sendId } : {};
    const ctl = new AbortController();
    let late = false;
    let timer = setTimeout(() => {
      late = true;
      ctl.abort();
    }, beginMs);
    try {
      /** @type {Response} */
      let res;
      try {
        res = await r.open(b.path, { ...init, signal: ctl.signal });
      } catch (/** @type {any} */ e) {
        if (!late) reachedOf.delete(m.id);
        const live = late && b.chat ? await r.send(`/sessions/${enc(b.chat)}/live-state`).catch(() => null) : null;
        const at = String(live?.json?.live?.requestId ?? "");
        if (live?.status === 200 && ID.test(at)) return { ok: true, status: 200, json: { request: at }, ...withId };
        return no(`${m.name} did not answer: ${why(e)}. It may have reached the chat there: look at the chat before you send it again.`, { unsure: true, ...withId });
      }
      if (!String(res.headers.get("content-type") || "").includes("text/event-stream")) {
        clearTimeout(timer);
        timer = setTimeout(() => ctl.abort(), CALL_MS);
        let json = null;
        try {
          json = JSON.parse(await bodyText(res, ANSWER_MAX, "it", `${b.method} ${b.path}`));
        } catch {}
        return { ...answered(m, { status: res.status, json }, b), ...withId };
      }
      // Its head came: the turn began there. Its first bytes are waited on a moment, and the stream let go.
      clearTimeout(timer);
      timer = setTimeout(() => ctl.abort(), FIRST_MS);
      const reader = res.body?.getReader();
      await reader?.read().catch(() => null);
      void reader?.cancel().catch(() => {});
      const request = String(res.headers.get("x-filament-request-id") || "");
      return { ok: true, status: res.status, json: { request: ID.test(request) ? request : null }, ...withId };
    } finally {
      clearTimeout(timer);
      ctl.abort();
    }
  }

  /** One operation's request made on its machine. @param {Machine} m @param {Built} b @returns {Promise<DeskAnswer>} */
  async function run(m, b) {
    const r = await reachKept(m);
    // Its words are another machine's in part (its name, what it answered): said as any of its words are.
    if ("words" in r) return no(said(r.words, 2 * SAID_MAX), r.away ? { away: r.away } : {});
    // Through a tunnel, or by the person's tailnet login, the machine counts no press of this app's: an answer, a press
    // always (http/admin/press.js), is refused here in words that say what to do. A mode, or a chat started in one, is a
    // press only where it asks less than before, which that machine alone knows: it is sent, and its refusal said.
    if (b.press && r.who !== "device")
      return no(`This app reaches ${m.name} ${r.who === "tailnet" ? "by your tailnet login" : "through a tunnel"}, not as a paired Full device, and this needs one: pair this machine as Full with Add a machine, and it works from here.`, { press: true });
    /** @type {Record<string, string>} */
    const headers = b.chat ? { "x-filament-tab": tab, "x-filament-take": b.chat } : {};
    const init = { method: b.method, ...(b.body !== undefined ? { body: b.body } : {}), headers };
    if (b.stream) return begin(m, r, b, init);
    try {
      return answered(m, await r.send(b.path, { ...init, ms: b.write ? WRITE_MS : CALL_MS }), b);
    } catch (/** @type {any} */ e) {
      reachedOf.delete(m.id);
      if (!b.write) return no(`${m.name} did not answer: ${why(e)}.`, { away: "quiet" });
      return no(`${m.name} did not answer in time: ${why(e)}. It may have been done there: look before you ask again.`, { unsure: true });
    }
  }

  /**
   * A machine's events stream held: `up` once a stream of its said hello, until it is said down; `since`, when the
   * stream joined now said its hello — null until it does.
   * @typedef {{ closed: boolean, ctl: AbortController, up: boolean, since: number | null }} Stream
   */
  /** Each machine's events stream held, by its id. @type {Map<string, Stream>} */
  const streams = new Map();

  /**
   * A machine's events stream read as it comes, frame by frame: those the desk reads told (`frameOf`). Ends where it
   * ends, where it says nothing for `QUIET_MS`, or where a frame grows past `FRAME_MAX`.
   * @param {string} id @param {Stream} s @param {Reached} r
   */
  async function listen(id, s, r) {
    const ctl = new AbortController();
    const off = () => ctl.abort();
    s.ctl.signal.addEventListener("abort", off, { once: true });
    let quiet = setTimeout(off, quietMs);
    // Its ways read again while it stands: an address it moved to is learned with no drop first.
    const again = setInterval(() => {
      const m = machineOf(id);
      if (m && !m.off) void Promise.resolve(learn(m, r)).catch(() => {});
    }, learnMs);
    again.unref?.();
    try {
      // Its holders' and writers' topics alone, where its Filament takes `?only=` (its desk flag `events-only`): no record
      // streams past unread.
      const res = await r.open(`/events?tab=${enc(tab)}${r.flags.includes("events-only") ? "&only=turns,writers" : ""}`, { signal: ctl.signal });
      if (res.status !== 200 || !String(res.headers.get("content-type") || "").includes("text/event-stream") || !res.body) {
        void res.body?.cancel().catch(() => {});
        return;
      }
      const reader = res.body.getReader();
      const text = new TextDecoder();
      let held = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done || s.closed) break;
        clearTimeout(quiet);
        quiet = setTimeout(off, quietMs);
        held += text.decode(value, { stream: true });
        let at;
        while ((at = held.indexOf("\n\n")) >= 0) {
          heard(id, s, held.slice(0, at));
          held = held.slice(at + 2);
        }
        if (held.length > FRAME_MAX) break;
      }
      void reader.cancel().catch(() => {});
    } finally {
      clearTimeout(quiet);
      clearInterval(again);
      s.ctl.signal.removeEventListener("abort", off);
      ctl.abort();
    }
  }

  /**
   * One frame of the stream: its data read where its type is one the desk reads — its head says it (each is published
   * with its type first), so the records and the rest that stream past are never parsed —, and told.
   * @param {string} id @param {Stream} s @param {string} frame
   */
  function heard(id, s, frame) {
    const data = frame
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, "").replace(/\r$/, ""))
      .join("\n");
    const type = /^\{"type":"([a-z-]{1,40})"/.exec(data)?.[1];
    if (!type || !HEARD.has(type) || s.closed) return;
    // A machine removed or disconnected since the last `sync` is told of nothing more: its stream is let go now.
    const m = machineOf(id);
    if (!m || m.off) {
      s.closed = true;
      s.ctl.abort();
      return;
    }
    /** @type {any} */
    let d = null;
    try {
      d = JSON.parse(data);
    } catch {
      return;
    }
    const f = frameOf(d, tab);
    if (!f) return;
    if (f.type === "hello") {
      s.up = true;
      s.since = now();
    }
    say(/** @type {DeskFrame} */ ({ machine: id, ...f }));
  }

  /** A frame told: a listener that throws stops no stream. @param {DeskFrame} f */
  const say = (f) => {
    try {
      tell(f);
    } catch {}
  };

  /**
   * A machine's events stream held while it is kept and connected, joined again after a drop — at once where it stood
   * `STOOD_MS` since its own hello, said down only where that fails; else further apart each time —, its ways learned as it is joined
   * (`learn`). One that ends of itself — its machine gone from the list — lets go of its place, for `sync` to start it
   * again. @param {string} id @param {Stream} s
   */
  async function follow(id, s) {
    let wait = AGAIN_MS;
    while (!s.closed) {
      const m = machineOf(id);
      if (!m || m.off) break;
      const began = now();
      s.since = null;
      const r = await reach(m, FOR.desk).catch((/** @type {any} */ e) => ({ words: why(e) }));
      if (!s.closed && !("words" in r)) {
        void Promise.resolve(learn(m, r)).catch(() => {});
        await listen(id, s, r).catch(() => {});
      }
      if (s.closed) break;
      if (now() - began >= STOOD_MS) wait = AGAIN_MS;
      // Stood since its own hello: joined again at once, not said down.
      if (s.up && s.since !== null && now() - s.since >= STOOD_MS) continue;
      if (s.up) {
        s.up = false;
        say({ machine: id, type: "down" });
      }
      await sleep(wait, s.ctl.signal);
      wait = Math.min(wait * 2, AGAIN_MAX_MS);
    }
    if (streams.get(id) === s) streams.delete(id);
  }

  return {
    /** The desk's tab on every machine: its writes', and its events streams'. */
    tab,
    /**
     * One operation on another machine, as the page asks it (`OPS`): → what came of it. An operation not in the table,
     * a field that does not fit it, a machine this window does not keep, or one with `CALLS_MOST` under way, is refused
     * here, nothing sent. @param {unknown} p @returns {Promise<DeskAnswer>}
     */
    async call(p) {
      if (!p || typeof p !== "object") return no("The desk asks by an operation: { op, machine, … }.");
      const q = /** @type {any} */ (p);
      const op = String(q.op ?? "");
      if (!(op in OPS)) return no(`No such operation on the desk${op ? `: ${said(op, 40)}` : ""}.`);
      const m = machineOf(String(q.machine ?? ""));
      if (!m) return no("This window keeps no such machine now.");
      const b = OPS[op](q);
      if ("error" in b) return no(b.error);
      const under = calls.get(m.id) || 0;
      if (under >= CALLS_MOST) return no(`${m.name} has ${CALLS_MOST} calls from here under way already: ask again once they end.`);
      calls.set(m.id, under + 1);
      try {
        return await run(m, b);
      } finally {
        const left = (calls.get(m.id) || 1) - 1;
        if (left > 0) calls.set(m.id, left);
        else calls.delete(m.id);
      }
    },
    /** Each machine kept and connected has its events stream held; one removed or disconnected, none. */
    sync() {
      const want = new Set(machines().filter((m) => !m.local && !m.off).map((m) => m.id));
      for (const [id, s] of streams)
        if (!want.has(id)) {
          s.closed = true;
          s.ctl.abort();
          streams.delete(id);
          if (s.up) say({ machine: id, type: "down" });
        }
      for (const id of want)
        if (!streams.has(id)) {
          const s = { closed: false, ctl: new AbortController(), up: false, since: null };
          streams.set(id, s);
          void follow(id, s);
        }
    },
    /** Whether a machine's events stream stands now. @param {string} id */
    live: (id) => !!streams.get(id)?.up,
    /** Every stream let go: the app quits. */
    close() {
      for (const s of streams.values()) {
        s.closed = true;
        s.ctl.abort();
      }
      streams.clear();
    },
  };
}

/** A wait that its signal ends early. @param {number} ms @param {AbortSignal} signal @returns {Promise<void>} */
function rest(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    t.unref?.();
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
