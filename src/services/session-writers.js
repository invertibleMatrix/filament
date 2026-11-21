// @ts-check
// Which harness tab writes each session (HarnessV3-FixRound decision 22, Q1 (a)). Two tabs on one session used to send,
// steer and re-draw over each other; now the session has one writing tab, and every other tab on it follows read-only
// until it takes over. In memory only: it coordinates live pages, not stored state.
//
// A tab is a page load (its id is made when the page loads and never stored). It counts while its events stream is
// open — every harness page holds one — so a closed, reloaded or disconnected tab lets its session go at once, with no
// heartbeat and no lease. A tab writes at most one session: the one it shows.
//
// The writing follows the person (the owner's of 11-14, this PC's chat open in his MacBook's window too through Remote
// access: "the Take Over button above the composer keeps hopping around on both machines"): a session let go is free,
// and no tab takes it until one shows it or writes it; a write made as the person acts in a tab on the session it shows
// (`take`) takes it over first. Each tab's place — this computer, or a paired machine by its name — is kept from its stream, so the words say
// where the session is open.
//
// A request that carries no tab id (an outside client, a script) is not governed here.

/**
 * Where a tab is, as the person knows it: this computer, or a paired machine by the name its app paired with. `key` tells
 * two places apart; `name` is null where nothing names it (a tailnet login, the admin token).
 * @typedef {{ key: string, name: string | null }} Place
 */

/** The name the desktop app pairs its window by on another machine (desktop/lib/add-machine.js `deviceNameHere`). */
const APP_NAMED = "Filament app on ";

/**
 * The place of a request's caller (http/guards.js `whoIs`): this computer by `here`, its machine's name; a paired device
 * by its machine's name — an agents' device's `from`, else its app's pairing name without "Filament app on " —; a
 * tailnet login or the admin token by none. Null for nobody.
 * @param {any} who @param {string} [here]
 * @returns {Place | null}
 */
export function placeOf(who, here = "") {
  if (!who?.kind) return null;
  if (who.kind === "local") return { key: "local", name: String(here || "") || null };
  if (who.kind === "device") {
    const d = who.device || {};
    const name = String(d.from || (String(d.name || "").startsWith(APP_NAMED) ? String(d.name).slice(APP_NAMED.length) : d.name || ""));
    return { key: `device:${d.id}`, name: name || null };
  }
  if (who.kind === "tailnet") return { key: `tailnet:${who.login}`, name: null };
  return { key: String(who.kind), name: null };
}

/**
 * Where the session is open, as a tab at `here` reads it: on another machine by its name, else in another window.
 * @param {Place | null | undefined} where  the writer's place @param {Place | null | undefined} [here]  the reader's
 */
export const placeWords = (where, here = null) => (where?.name && where.key !== here?.key ? `on ${where.name}` : "in another window");

/**
 * The refusal's words: what a read-only tab is told when it writes with no act of the person's behind it.
 * @param {Place | null | undefined} [where] @param {Place | null | undefined} [here]
 */
export const readOnlyWords = (where = null, here = null) => `this chat is open for writing ${placeWords(where, here)} — type or send in this window to take it over`;
/** The refusal's words where neither place is known. */
export const READ_ONLY_WORDS = readOnlyWords();

/**
 * A tab's answer: the session it shows, the tab that writes it, whether that is the tab asking, where the writer is
 * (null while none writes it) and where the asking tab is.
 * @typedef {{ chainId: string | null, writer: string | null, you: boolean, where: Place | null, here: Place | null }} Answer
 */

export class SessionWriters {
  /** Every change of a session's writer: its new tab and that tab's place, or nulls when none writes it. @type {((chainId: string, tab: string | null, where: Place | null) => void) | null} */
  onChange = null;
  /** Open events streams per tab: a tab counts while it has one. @type {Map<string, number>} */
  #streams = new Map();
  /** Each counted tab's place, from its first stream. @type {Map<string, Place | null>} */
  #places = new Map();
  /** The tab that writes each session — a tab at most one. @type {Map<string, string>} */
  #writers = new Map();

  /** @param {{ log?: (level: string, msg: string) => void }} [o] */
  constructor({ log = () => {} } = {}) {
    this.log = log;
  }

  /** @param {string} chainId @param {string | null} tab */
  #emit(chainId, tab) {
    try {
      this.onChange?.(chainId, tab, tab ? this.placeOf(tab) : null);
    } catch (e) {
      this.log("warn", `session writers: listener failed (${e && typeof e === "object" && "message" in e ? e.message : e})`);
    }
  }

  /** The session `tab` writes, or null. @param {string} tab */
  #sessionOf(tab) {
    for (const [chainId, t] of this.#writers) if (t === tab) return chainId;
    return null;
  }

  /** Let go of the session `tab` writes, if any; the session is told it has no writer. @param {string} tab */
  #drop(tab) {
    const chainId = this.#sessionOf(tab);
    if (!chainId) return;
    this.#writers.delete(chainId);
    this.#emit(chainId, null);
  }

  /** @param {string | null} chainId @param {string | null} writer @param {string} tab @returns {Answer} */
  #answer(chainId, writer, tab) {
    return { chainId, writer, you: !!writer && writer === tab, where: writer ? this.placeOf(writer) : null, here: tab ? this.placeOf(tab) : null };
  }

  /**
   * A tab's events stream opened, from `place`. The answer is its close. A tab whose first stream opens after it claimed
   * a session is now counted, so its session is said again.
   * @param {string} tab @param {Place | null} [place] @returns {() => void}
   */
  connect(tab, place = null) {
    const t = String(tab || "");
    if (!t) return () => {};
    const n = this.#streams.get(t) || 0;
    this.#streams.set(t, n + 1);
    if (!n) this.#places.set(t, place);
    const chainId = n ? null : this.#sessionOf(t);
    if (chainId) this.#emit(chainId, t);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      const left = (this.#streams.get(t) || 1) - 1;
      if (left > 0) return void this.#streams.set(t, left);
      this.#streams.delete(t);
      this.#drop(t);
      this.#places.delete(t);
    };
  }

  /** @param {string} tab */
  live(tab) {
    return (this.#streams.get(String(tab || "")) || 0) > 0;
  }

  /** Where a counted tab is, or null. @param {string} tab */
  placeOf(tab) {
    return this.#places.get(String(tab || "")) ?? null;
  }

  /** The tab that writes the session now: its claimant, while that tab's stream is open. @param {string} chainId */
  writerOf(chainId) {
    const t = this.#writers.get(String(chainId || ""));
    return t && this.live(t) ? t : null;
  }

  /**
   * The tab shows `chainId` (null: no session — a new chat, another page). It writes the session when no counted tab
   * does, or when it takes it over; otherwise it follows. Either way it lets go of any other session it wrote. `peek`:
   * it only asks who writes it, and takes it in neither case — a page whose stream came back after a gap, which did not
   * write the session before it.
   * @param {string} tab @param {string | null} chainId @param {{ take?: boolean, peek?: boolean }} [o]
   * @returns {Answer}
   */
  open(tab, chainId, { take = false, peek = false } = {}) {
    const t = String(tab || "");
    const id = chainId ? String(chainId) : null;
    if (!t || !id) {
      this.#drop(t);
      return this.#answer(id, id ? this.writerOf(id) : null, t);
    }
    if (this.#sessionOf(t) !== id) this.#drop(t);
    const now = this.writerOf(id);
    if (now === t || peek || (now && !take)) return this.#answer(id, now, t);
    const before = this.#writers.get(id);
    this.#writers.set(id, t);
    if (before !== t) this.#emit(id, t);
    return { ...this.#answer(id, t, t), you: true };
  }

  /**
   * Why `tab` may not write the session now — null when it may: no tab id (not a harness tab), no counted writer, this
   * tab is the writer, or the person acts in this tab on this session (`take` names it), which takes it over first. A
   * take that names another session — the one the tab shows, where this write is another chat's — takes nothing.
   * @param {string} chainId @param {string | null | undefined} tab @param {{ take?: string }} [o]
   */
  refusal(chainId, tab, { take = "" } = {}) {
    const t = String(tab || "");
    if (!t) return null;
    if (take && take === String(chainId)) {
      this.open(t, String(chainId), { take: true });
      return null;
    }
    const w = this.writerOf(chainId);
    return !w || w === t ? null : readOnlyWords(this.placeOf(w), this.placeOf(t));
  }
}

/** The tab a request names (`x-filament-tab`), or "". @param {import("node:http").IncomingMessage} req */
export const tabOf = (req) => String(req?.headers?.["x-filament-tab"] || "").slice(0, 80);
/**
 * The session a tab's request was made in as the person acted there (`x-filament-take`: the one the tab shows), or "": a
 * write of that session takes it over (`refusal`).
 * @param {import("node:http").IncomingMessage} req
 */
export const takeOf = (req) => String(req?.headers?.["x-filament-take"] || "").slice(0, 200);
