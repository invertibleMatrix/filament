// @ts-check
// A watcher's guidance (the plan of 11-11, its w6): what a watcher the person let guide (`guides`) writes to the chat
// its trigger names. The chat the watcher wakes, or a run of it, asks (`send`); Filament brings the words to the watched
// chat as that chat can take them: a note into its running turn, read by its agent at its next step under the
// watcher's own heading (core/watchers.js `guideBlock`) — never the developer's —; a turn of Filament's own where the
// chat is at rest (the sessions service's `by: "guide"`, core/routines.js `guideWords`); or it waits — a question of
// that chat's waits for the person, they stopped it, room is being made for it, its agent takes no words while it
// works, the note went unread — and goes as the chat next lets go, or into its next turn where that begins first.
// A chat that needs compacting first says so inside the lock of the guidance turn it refuses, and that lock lets go
// too: no turn of that chat's, so nothing is sent again at it (`refusedIn`; s-itself, 11-12) — it was, every
// `GUIDE_SETTLE_MS`, for the day a guidance waits. A turn of that chat's ending, room made for it and the look try again.
// The person's word comes first, and the rules that stop two agents answering each other without end are counts,
// never anything read from words: at most `GUIDES_PER_MESSAGE` go to a chat since its person last wrote there, whoever
// sent them (counted on the chat's letters record, which their message starts again); past that a guidance is held
// for the person in Needs you, who may send it; while a guidance turn is on its way to a chat and until that turn lets
// go, the chat is hosted (`hosting`): what that turn does wakes no watcher, so a turn that only answered guidance is
// not reviewed again. A chat never guides itself.
// Each guidance is kept in its Space (services/spaces.js `guideKeep`, `guideMove`), so a restart loses none: one sent as
// a note and not known read waits again. One waits per watcher and chat — the reviewer's newer view takes the older's
// place —, for a day at most; while its watcher is paused or Pause all is on it stays; the store drops it where its
// watcher is changed or removed.
import { GUIDES_PER_MESSAGE, GUIDE_CHARS, GUIDE_LIMITS, WATCHER, guideTitle, triggerChat, turnStands } from "../../core/watchers.js";
import { guideWords } from "../../core/routines.js";
import { readerNames } from "../../core/space.js";

/** How long a chat whose turn just ended waits before a guidance that waited for it is sent: that turn lets go first. */
export const GUIDE_SETTLE_MS = 300;
/** The longest the timer waits before what waits is looked at again. */
const LOOK_MS = 3_600_000;

/**
 * @typedef {import("../../core/routines.js").Routine} Routine
 * @typedef {import("../../core/watchers.js").Guidance} Guidance
 * @typedef {{ busy: boolean, asking: boolean, last: { stopped: boolean, n?: number, final?: boolean, failed?: boolean, cut?: boolean, text?: string } | null }} ChatFacts
 * @typedef {"note" | "turn" | "waits" | "held" | "refused"} GuideHow
 * @typedef {{ ok: boolean, how: GuideHow, text: string, id?: string, to?: string }} GuideAnswer  what its sender is
 *   told, in words, and for code: sent as a note, sent as a turn, kept waiting, held for the person, or refused
 * @typedef {{ state: "sent", how: "note", sentAt: number, run: string, steer: string }
 *   | { state: "sent", how: "turn", sentAt: number, turn: number }
 *   | { state: "waiting", why: string, wait: keyof typeof WAITS }
 *   | { state: "held" }
 *   | { state: "dropped", why: string }} Outcome  one try to bring a guidance to its chat
 * @typedef {{
 *   spaces: Pick<import("../../services/spaces.js").SpaceStore, "has" | "get" | "pausedSince" | "archived" | "guideKeep" | "guideMove" | "guidance" | "guidanceLive">,
 *   sessions: { besideFacts: (chain: string) => ChatFacts },
 *   letters: { guideSent: (chain: string, most: number) => boolean, guideDropped: (chain: string) => void },
 *   reach: {
 *     busy: (chain: string) => boolean,
 *     steer: (chain: string, text: string, as: { from: string, title: string }) => { ok: boolean, run?: string, id?: string, error?: string },
 *     post: (chain: string, body: Record<string, unknown>) => Promise<{ status: number, body: any, turn?: number | null }>,
 *   },
 *   runOf: (chain: string) => { project: string, id: string } | null,
 *   projectOf: (chain: string) => string | null,
 *   projectName?: (project: string) => string,
 *   nameOf?: (chain: string) => string,
 *   apart?: (chain: string) => boolean,
 *   unwakeable?: (chain: string) => string | null,
 *   log?: (level: string, msg: string) => void,
 *   now?: () => number,
 *   settleMs?: number,
 * }} GuidanceDeps
 *   `reach`: how a guidance reaches a chat — `busy`, whether a turn holds it now; `steer`, the words into its running
 *   turn as the watcher's, `ok` where its agent takes words while it works, with the run and the note's id there;
 *   `post`, a turn of Filament's own through the route a message takes. `runOf`: the routine a chat is a run of
 *   (app/routines.js marks it). `nameOf`, `apart`: the chats' names, and whose words are no other chat's agent's to
 *   read (core/space.js `readerNames`). `unwakeable`: why a chat never takes a turn of Filament's — archived, a
 *   client's own session.
 */

/** Why a guidance waits, as the chat that wrote it is told; `name`: the chat it is for, as its writer may read it. */
const WAITS = Object.freeze({
  asking: (/** @type {string} */ name) => `a question of ${name}'s waits for the person`,
  stopped: (/** @type {string} */ name) => `the person stopped ${name}, and Filament starts no turn there until they write in it again`,
  room: (/** @type {string} */ name) => `room is being made for ${name}`,
  compact: (/** @type {string} */ name) => `${name} needs compacting before it can take a turn`,
  work: (/** @type {string} */ name) => `${name}'s agent takes no words while it works, so it goes as its turn ends`,
  unread: (/** @type {string} */ name) => `${name}'s turn ended before its agent read it`,
  paused: (/** @type {string} */ _name) => "its watcher is paused, or Pause all is on",
});

/** @param {GuidanceDeps} deps */
export function createGuidance({ spaces, sessions, letters, reach, runOf, projectOf, projectName = (p) => p, nameOf = () => "a chat of this project", apart = () => false, unwakeable = () => null, log = () => {}, now = Date.now, settleMs = GUIDE_SETTLE_MS }) {
  /**
   * The chats a guidance turn is on its way to, or at work in: the posts under way, and the guidance each turn taken
   * carries, by its id with its project. @type {Map<string, { posts: number, ids: Map<string, string> }>}
   */
  const hosts = new Map();
  /** The notes sent into running turns, by their run and their id there: the guidance each is. @type {Map<string, { project: string, id: string, to: string }>} */
  const notes = new Map();
  /** Each chat's deliveries, one after another. @type {Map<string, Promise<unknown>>} */
  const lanes = new Map();
  /** The chats whose waiting guidance goes once their turn has let go. @type {Map<string, ReturnType<typeof setTimeout>>} */
  const settling = new Map();
  /**
   * The chats that said a no of their own to a guidance turn — each needs compacting first —, with its newest turn as
   * it stood then (core/watchers.js `turnStands`). The lock that refused turn took lets go too: at a lock let go while
   * that turn stands as it did, what waits for the chat is not sent again (`flush`). @type {Map<string, string>}
   */
  const refusedIn = new Map();
  /** The timer of the next look. @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let started = false;
  let stopped = false;
  /** What is under way, for the tests to wait on. @type {Set<Promise<unknown>>} */
  const under = new Set();

  /** @param {string} project @returns {Routine[]} */
  const routinesOf = (project) => {
    try {
      return spaces.has(project) ? spaces.get(project).routines : [];
    } catch {
      return [];
    }
  };
  /** @param {string} project @param {string} id */
  const watcherOf = (project, id) => routinesOf(project).find((r) => r.id === id) || null;
  /** @param {string} chain @returns {ChatFacts | null}  null where the chat is gone */
  const factsOf = (chain) => {
    try {
      return sessions.besideFacts(chain);
    } catch {
      return null;
    }
  };
  /** A chat's name as the agent of `reader` may read it. @param {string} chain @param {string} reader */
  const nameFor = (chain, reader) => readerNames({ nameOf, apart }, reader).nameOf(chain);

  /**
   * Why a watcher sends no guidance from `from`, or "": it is on, not paused, let guide by the person, watches one
   * chat, and that chat is another. @param {Routine} r @param {string} from
   */
  const barred = (r, from) => {
    const to = r.trigger ? triggerChat(r.trigger) : "";
    if (r.state !== "on") return `“${r.title}” is not switched on`;
    if (!r.guides) return `“${r.title}” may not guide the chat it watches: only the person's Switch on allows it`;
    if (!to) return `“${r.title}” watches no one chat, so it has none to guide`;
    if (to === from) return `“${r.title}” watches this chat, and a chat never guides itself`;
    if (r.paused) return `“${r.title}” is paused: it guides again once the person resumes it`;
    return "";
  };
  /**
   * The watchers a chat speaks for: those that wake it, and the one it is a run of.
   * @param {string} project @param {string} from
   */
  const spokenFor = (project, from) => {
    const run = runOf(from);
    return routinesOf(project).filter((r) => !!r.trigger && r.state !== "removed" && ((r.madeIn === from && r.wakes === "chat") || (!!run && run.project === project && run.id === r.id)));
  };
  /**
   * The watcher a guidance from `from` is of, or why none: the one named, else the only one of the chat's that may guide.
   * @param {string} project @param {string} from @param {string} id
   * @returns {{ r: Routine } | { error: string }}
   */
  const watcherFor = (project, from, id) => {
    const mine = spokenFor(project, from);
    if (id) {
      const r = mine.find((x) => x.id === id);
      if (!r) return { error: `there is no watcher “${id.slice(0, 40)}” that wakes this chat, or that this chat is a run of` };
      const why = barred(r, from);
      return why ? { error: why } : { r };
    }
    if (!mine.length) return { error: "this chat is no watcher's: only the chat a watcher wakes, or a run of it, guides the chat that watcher watches" };
    const may = mine.filter((r) => !barred(r, from));
    if (may.length === 1) return { r: may[0] };
    if (may.length > 1) return { error: `this chat speaks for ${may.length} watchers that may guide: ${may.map((r) => `“${r.title}” (${r.id})`).join(", ")}. Say which, by its id` };
    return { error: mine.map((r) => barred(r, from)).join("; ") };
  };

  /** One delivery after another for a chat. @template T @param {string} chain @param {() => Promise<T>} fn @returns {Promise<T>} */
  const inLane = (chain, fn) => {
    const next = (lanes.get(chain) || Promise.resolve()).then(fn, fn);
    const tail = next.then(
      () => {},
      () => {},
    );
    lanes.set(chain, tail);
    under.add(tail);
    void tail.then(() => {
      under.delete(tail);
      if (lanes.get(chain) === tail) lanes.delete(chain);
    });
    return next;
  };

  /**
   * One try to bring a guidance to its chat, now: into its running turn where its agent takes words, as a turn of
   * Filament's own where it is at rest, else why it waits. One not yet sent takes one of the chat's `GUIDES_PER_MESSAGE`
   * for its person's last message first — given back where it does not go —, and is held where none is left; one the
   * person pressed Send it for takes none.
   * @param {string} project @param {Routine} r @param {Pick<Guidance, "from" | "to" | "text"> & Partial<Pick<Guidance, "sentAt" | "pressed">>} g
   * @returns {Promise<Outcome>}
   */
  async function attempt(project, r, g) {
    const to = g.to;
    const counted = !!g.sentAt || g.pressed === true;
    if (!counted && !letters.guideSent(to, GUIDES_PER_MESSAGE)) return { state: "held" };
    const sentAt = g.sentAt || now();
    /** @param {Outcome} out */
    const notSent = (out) => {
      if (!counted) letters.guideDropped(to);
      return out;
    };
    // A turn that takes the chat between the look and the post is tried once more, as a note into it.
    for (let tries = 0; tries < 2; tries++) {
      if (reach.busy(to)) {
        const s = reach.steer(to, g.text, { from: WATCHER, title: guideTitle(r.title) });
        if (s.ok && s.run && s.id) return { state: "sent", how: "note", sentAt, run: s.run, steer: s.id };
        return notSent({ state: "waiting", wait: "work", why: WAITS.work("its chat") });
      }
      const f = factsOf(to);
      if (!f) return notSent({ state: "dropped", why: "its chat is gone" });
      if (f.asking) return notSent({ state: "waiting", wait: "asking", why: WAITS.asking("its chat") });
      if (f.last?.stopped) return notSent({ state: "waiting", wait: "stopped", why: WAITS.stopped("its chat") });
      const host = hosts.get(to) || { posts: 0, ids: new Map() };
      host.posts += 1;
      hosts.set(to, host);
      /** @type {{ status: number, body: any, turn?: number | null }} */
      let res;
      try {
        res = await reach.post(to, { by: "guide", content: [{ type: "text", text: guideWords(r, { project: projectName(project), byName: nameFor(g.from, to), text: g.text }) }] });
      } catch (/** @type {any} */ e) {
        res = { status: 502, body: { error: String(e?.message || e) } };
      }
      host.posts -= 1;
      if (res.status >= 200 && res.status < 300) return { state: "sent", how: "turn", sentAt, turn: Number.isInteger(res.turn) && Number(res.turn) > 0 ? Number(res.turn) : 0 };
      if (!host.posts && !host.ids.size) hosts.delete(to);
      const b = res.body || {};
      const held = res.status !== 409 ? "" : ["room", "asking", "stopped"].includes(b.guide) ? String(b.guide) : b.byFilament === "asking" ? "asking" : b.needsCompaction ? "compact" : "";
      // Its own no, which no lock let go ends: kept with its newest turn as it stands (`refusedIn`).
      const stands = held === "compact" ? factsOf(to) : null;
      if (stands) refusedIn.set(to, turnStands(stands.last));
      if (held) return notSent({ state: "waiting", wait: /** @type {keyof typeof WAITS} */ (held), why: WAITS[/** @type {keyof typeof WAITS} */ (held)]("its chat") });
      if (res.status === 409 && b.holder) continue;
      return notSent({ state: "dropped", why: `its chat could not take it: ${String(b.error || `HTTP ${res.status}`)}` });
    }
    return notSent({ state: "waiting", wait: "work", why: WAITS.work("its chat") });
  }

  /**
   * A guidance turn's chat let go: the guidance it carried was read, and the chat is hosted no more — unless a turn
   * holds it still, a question of that turn's waits for the person, or a post is on its way.
   * @param {string} chain
   */
  const settle = (chain) => {
    const host = hosts.get(chain);
    if (!host || host.posts) return;
    const f = factsOf(chain);
    if (f && (f.busy || f.asking)) return;
    hosts.delete(chain);
    for (const [id, project] of host.ids) moved(project, id, { state: "read" });
  };

  /**
   * @param {string} project @param {string} id @param {Parameters<GuidanceDeps["spaces"]["guideMove"]>[2]} patch
   * @param {Parameters<GuidanceDeps["spaces"]["guideMove"]>[3]} [o]
   */
  const moved = (project, id, patch, o) => {
    try {
      return spaces.guideMove(project, id, patch, o);
    } catch (/** @type {any} */ e) {
      log("warn", `guidance: ${id} of ${project} could not be noted (${e?.message || e})`);
      return null;
    }
  };

  /**
   * What a try made of a guidance the Space keeps, kept: where it stands, and what this module follows of it — the
   * note it went as, the turn that carries it.
   * @param {string} project @param {Guidance} g @param {Outcome} out
   */
  const took = (project, g, out) => {
    if (out.state === "sent" && out.how === "note") {
      notes.set(`${out.run}\n${out.steer}`, { project, id: g.id, to: g.to });
      moved(project, g.id, { state: "sent", how: "note", sentAt: out.sentAt, turn: undefined, why: undefined });
    } else if (out.state === "sent") {
      const host = hosts.get(g.to) || { posts: 0, ids: new Map() };
      host.ids.set(g.id, project);
      hosts.set(g.to, host);
      moved(project, g.id, { state: "sent", how: "turn", sentAt: out.sentAt, ...(out.turn ? { turn: out.turn } : {}), why: undefined });
      // A turn that ended before it was noted let go unread: read now.
      settle(g.to);
    } else if (out.state === "waiting") moved(project, g.id, { state: "waiting", why: out.why, how: undefined, turn: undefined });
    else if (out.state === "held") moved(project, g.id, { state: "held", why: undefined, how: undefined, turn: undefined }, { nameOf });
    else
      moved(project, g.id, { state: "dropped", why: out.why, how: undefined, turn: undefined }, { say: [`“${g.title}”'s guidance for `, { chain: g.to, name: nameOf(g.to) }, ` was not sent: ${out.why}.`] });
    if (out.state !== "sent") log("info", `guidance: ${g.id} of ${project} for ${g.to} ${out.state === "waiting" ? `waits (${out.why})` : out.state === "held" ? "is held for the person, past the cap" : `was dropped (${out.why})`}`);
    else log("info", `guidance: ${g.id} of ${project} went to ${g.to} as a ${out.how}`);
  };

  /**
   * The guidance that waits for a chat, sent now where it can go: each in turn, the first as a turn of its own where
   * the chat is at rest, those after it into that turn. One whose watcher is gone, off or lets guide no more, or that
   * waited a day, is dropped, said once; one whose watcher is paused, under Pause all or of an archived project, stays.
   * `letGo`: a lock of the chat let go, and no more is known — where the chat said it needs compacting first and its
   * newest turn stands as it did then (`refusedIn`), that lock was a refused turn's, and nothing is sent again.
   * @param {string} chain @param {boolean} [letGo]
   */
  const flush = (chain, letGo = false) =>
    inLane(chain, async () => {
      if (stopped) return;
      if (letGo && refusedIn.has(chain) && refusedIn.get(chain) === turnStands(factsOf(chain)?.last)) return;
      refusedIn.delete(chain);
      for (const { project, g } of spaces.guidanceLive().filter((x) => x.g.to === chain && x.g.state === "waiting")) {
        const r = watcherOf(project, g.watcher);
        const gone = !r || r.state !== "on" || !r.guides ? "its watcher is switched on to guide no more" : now() - g.at > GUIDE_LIMITS.waitMs ? `it waited a day for its chat (${g.why || "which did not let go"})` : "";
        if (gone || !r) {
          took(project, g, { state: "dropped", why: gone });
          continue;
        }
        if (r.paused || spaces.pausedSince() || spaces.archived(project)) continue;
        const out = await attempt(project, r, g);
        // One the store dropped meanwhile — its watcher was changed or removed — stays dropped, unless it went.
        if (out.state !== "sent" && spaces.guidance(project).find((x) => x.id === g.id)?.state !== "waiting") continue;
        took(project, g, out);
      }
    });

  /** A chat's waiting guidance goes once its turn has let go of it. @param {string} chain */
  const soon = (chain) => {
    if (stopped || settling.has(chain)) return;
    if (!spaces.guidanceLive().some((x) => x.g.to === chain && x.g.state === "waiting")) return;
    const t = setTimeout(() => {
      settling.delete(chain);
      void flush(chain, true).catch((/** @type {any} */ e) => log("warn", `guidance: what waited for ${chain} could not be sent (${e?.message || e})`));
    }, settleMs);
    t.unref?.();
    settling.set(chain, t);
  };

  /**
   * A note's news from its run: read by the chat's agent, or left unread as its turn ended — then it waits, and goes
   * as a turn. One read and then given back (a turn stopped before its model read it) waits again too.
   * @param {string} key @param {"read" | "unread"} how
   */
  const noteNews = (key, how) => {
    const n = notes.get(key);
    if (!n) return;
    const g = spaces.guidance(n.project).find((x) => x.id === n.id);
    if (!g || g.how !== "note" || (g.state !== "sent" && g.state !== "read")) return void notes.delete(key);
    if (how === "read") return void moved(n.project, n.id, { state: "read" });
    notes.delete(key);
    moved(n.project, n.id, { state: "waiting", why: WAITS.unread("its chat"), how: undefined });
    soon(n.to);
  };

  /** The next look is set to when the oldest that waits has waited its day, an hour at most. */
  function arm() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!started || stopped) return;
    const waiting = spaces.guidanceLive().filter((x) => x.g.state === "waiting");
    if (!waiting.length) return;
    const next = Math.min(...waiting.map((x) => x.g.at + GUIDE_LIMITS.waitMs + 1000));
    timer = setTimeout(look, Math.min(LOOK_MS, Math.max(1000, next - now())));
    timer.unref?.();
  }

  /**
   * What waits is looked at: one that waited a day, or whose watcher guides no more, is dropped; the others go where
   * their chat is at rest — a watcher resumed, Pause all switched off.
   */
  function look() {
    if (!started || stopped) return;
    const chains = new Set(spaces.guidanceLive().filter((x) => x.g.state === "waiting").map((x) => x.g.to));
    for (const chain of chains) if (!reach.busy(chain)) void flush(chain).catch((/** @type {any} */ e) => log("warn", `guidance: what waited for ${chain} could not be sent (${e?.message || e})`));
    arm();
  }

  return {
    /**
     * A watcher's guidance to the chat it watches, from the chat that watcher wakes or a run of it: sent now, kept
     * waiting, held for the person, or refused — said in words, and for code (`how`).
     * @param {{ project: string, from: string, id?: string, text: unknown }} o  `id`: the watcher, where the chat
     *   speaks for several
     * @returns {Promise<GuideAnswer>}
     */
    async send({ project, from, id = "", text }) {
      /** @param {string} why @returns {GuideAnswer} */
      const refuse = (why) => ({ ok: false, how: "refused", text: `Not sent: ${why}.` });
      const words = String(text ?? "").replace(/\r\n?/g, "\n").trim();
      if (!words) return refuse("the guidance has no words");
      if (words.length > GUIDE_CHARS) return refuse(`the guidance is ${words.length.toLocaleString("en-US")} characters, past the ${GUIDE_CHARS.toLocaleString("en-US")} one holds: say it shorter`);
      const found = watcherFor(String(project), String(from), String(id || "").trim());
      if ("error" in found) return refuse(found.error);
      const r = found.r;
      const to = triggerChat(/** @type {import("../../core/watchers.js").Trigger} */ (r.trigger));
      if (spaces.pausedSince()) return refuse("Pause all is on: nothing a watcher writes goes out until the person switches it off");
      // Nor in a project the person archived (r-itself, 11-12), where no chat takes a turn Filament starts.
      if (spaces.archived(String(project))) return refuse("this project is archived: nothing a watcher writes goes out until the person brings it back");
      const name = nameFor(to, from);
      if (!factsOf(to)) return refuse(`the chat “${r.title}” watches is gone`);
      const never = unwakeable(to);
      if (never) return refuse(`the chat “${r.title}” watches (${name}) takes no guidance: ${never}`);
      return inLane(to, async () => {
        const out = await attempt(project, r, { from, to, text: words });
        if (out.state === "dropped") return refuse(out.why);
        const g = spaces.guideKeep(project, r.id, { from, to, text: words, state: out.state, ...(out.state === "sent" ? { how: out.how, sentAt: out.sentAt, ...(out.how === "turn" && out.turn ? { turn: out.turn } : {}) } : {}), ...(out.state === "waiting" ? { why: out.why } : {}) }, { nameOf });
        if (out.state === "sent" && out.how === "note") notes.set(`${out.run}\n${out.steer}`, { project, id: g.id, to });
        if (out.state === "sent" && out.how === "turn") {
          const host = hosts.get(to) || { posts: 0, ids: new Map() };
          host.ids.set(g.id, project);
          hosts.set(to, host);
          settle(to);
        }
        if (out.state === "waiting") arm();
        log("info", `guidance: “${r.title}” of ${project} wrote ${to} ${g.id}: ${out.state === "sent" ? `sent as a ${out.how}` : out.state === "held" ? "held for the person, past the cap" : `waits (${out.why})`}`);
        /** @type {GuideAnswer} */
        const answer =
          out.state === "sent" && out.how === "note" ? { ok: true, how: "note", text: `Sent to ${name} as a note into its running turn: its agent reads it at its next step.` }
          : out.state === "sent" ? { ok: true, how: "turn", text: `Sent to ${name} as a turn of its own: the chat was at rest.` }
          : out.state === "waiting" ? { ok: true, how: "waits", text: `Not sent yet: ${WAITS[out.wait](name)}. Filament keeps it: it goes as that chat next lets go, or into its next turn where that begins first.` }
          : { ok: true, how: "held", text: `Not sent: ${GUIDES_PER_MESSAGE} went to ${name} since the person last wrote there, the most Filament sends by itself. It is held for the person in Needs you, who may send it.` };
        return { ...answer, id: g.id, to };
      });
    },

    /**
     * The person's Send it on a guidance held for them: that one goes now, whatever was sent since they last wrote —
     * as a note, as a turn, or as its chat next lets go. Refused in words where the row holds none, or it is held no more.
     * @param {string} project @param {string} row  the row of Needs you
     * @returns {Promise<GuideAnswer>}
     */
    async sendHeld(project, row) {
      const refused = (/** @type {number} */ status, /** @type {string} */ message) => Object.assign(new Error(message), { status });
      const n = spaces.get(project).needs.find((x) => x.id === String(row ?? ""));
      const held = n?.kind === "routine" ? n.routine?.guide : null;
      if (!n || !held) throw refused(404, `There is no guidance held under "${String(row ?? "").slice(0, 40)}" in this Space's Needs you.`);
      const g = spaces.guidance(project).find((x) => x.id === held.id);
      const r = g ? watcherOf(project, g.watcher) : null;
      if (!g || g.state !== "held" || !r) throw refused(409, "This guidance is held no more: it was sent, or its watcher changed since.");
      if (!factsOf(g.to)) throw refused(409, `The chat “${r.title}” watches is gone.`);
      const never = unwakeable(g.to);
      if (never) throw refused(409, `${nameOf(g.to)} takes no guidance: ${never}.`);
      return inLane(g.to, async () => {
        const out = await attempt(project, r, { ...g, pressed: true });
        if (spaces.guidance(project).find((x) => x.id === g.id)?.state !== "held" && out.state !== "sent") throw refused(409, "This guidance is held no more: it was sent, or its watcher changed since.");
        moved(project, g.id, { pressed: true });
        took(project, g, out);
        if (out.state === "dropped") throw refused(409, `Not sent: ${out.why}.`);
        if (out.state === "waiting") arm();
        const name = nameOf(g.to);
        /** @type {GuideAnswer} */
        const answer =
          out.state === "sent" && out.how === "note" ? { ok: true, how: "note", text: `Sent to ${name} as a note into its running turn.` }
          : out.state === "sent" ? { ok: true, how: "turn", text: `Sent to ${name} as a turn of its own.` }
          : { ok: true, how: "waits", text: `It goes as ${name} next lets go: ${out.state === "waiting" ? WAITS[out.wait](name) : "it waits"}.` };
        return { ...answer, id: g.id, to: g.to };
      });
    },

    /**
     * Whether `from` may write `to` a letter with no tag: it is the chat a watcher wakes, or a run of it, and `to` the
     * chat that watcher may guide now — on, not paused, let guide by the person (app/letters.js).
     * @param {string} from @param {string} to
     */
    mayWrite(from, to) {
      const project = runOf(from)?.project || projectOf(from);
      if (!project || from === to) return false;
      return spokenFor(project, from).some((r) => !barred(r, from) && triggerChat(/** @type {import("../../core/watchers.js").Trigger} */ (r.trigger)) === to);
    },

    /**
     * Whether a guidance turn is on its way to a chat, or at work in it: what that turn does wakes no watcher
     * (app/watchers/events.js `hosted`). @param {string} chain
     */
    hosting: (chain) => hosts.has(chain),

    /**
     * A chat's turn let go of it (the server's turn lock), or a question it paused on ended with no answer's turn: a
     * guidance turn there is over, and what waited for the chat goes. @param {string} chain
     */
    released(chain) {
      settle(chain);
      soon(chain);
    },

    /** Room was made for a chat: what waited for it goes, its no — it needed compacting — over. @param {string} chain */
    freed(chain) {
      refusedIn.delete(chain);
      soon(chain);
    },

    look,

    /**
     * Follow the runs' events (the bus Filament publishes on): a note read, or left unread as its turn ended; and a
     * turn that begins in a chat a guidance waits for, which takes it as a note. → the way to stop following.
     * @param {{ subscribe: (topic: string, fn: (p: any, entry: { topic: string }) => void) => () => void }} bus
     */
    listen(bus) {
      return bus.subscribe("*", (p, entry) => {
        try {
          if (!entry.topic.startsWith("run:") || !p || typeof p !== "object") return;
          const run = entry.topic.slice(4);
          if (p.type === "steer-read" || p.type === "steer-unread") for (const id of Array.isArray(p.ids) ? p.ids : []) noteNews(`${run}\n${id}`, p.type === "steer-read" ? "read" : "unread");
          else if (p.type === "run-end") {
            // A note its run never said read went unread with it.
            for (const key of [...notes.keys()].filter((k) => k.startsWith(`${run}\n`))) {
              const n = /** @type {{ project: string, id: string, to: string }} */ (notes.get(key));
              if (spaces.guidance(n.project).find((x) => x.id === n.id)?.state === "sent") noteNews(key, "unread");
              notes.delete(key);
            }
          } else if (p.type === "run-start") {
            const chain = typeof p.meta?.chain === "string" ? p.meta.chain : "";
            const helper = !!(p.brief || p.parentId || p.meta?.second || p.meta?.weighs);
            if (chain && !helper && !stopped && spaces.guidanceLive().some((x) => x.g.to === chain && x.g.state === "waiting"))
              void flush(chain).catch((/** @type {any} */ e) => log("warn", `guidance: what waited for ${chain} could not go into its turn (${e?.message || e})`));
          }
        } catch (/** @type {any} */ x) {
          log("warn", `guidance: a ${entry.topic} event was not heard (${x?.message || x})`);
        }
      });
    },

    /**
     * As Filament starts: a guidance sent as a note and not known read waits again; a guidance turn a restart cut
     * hosts its chat while that turn goes on, and is read where it does not; then what waits is looked at.
     */
    start() {
      started = true;
      stopped = false;
      for (const { project, g } of spaces.guidanceLive()) {
        if (g.state !== "sent") continue;
        if (g.how === "note") moved(project, g.id, { state: "waiting", why: WAITS.unread("its chat"), how: undefined });
        else {
          const host = hosts.get(g.to) || { posts: 0, ids: new Map() };
          host.ids.set(g.id, project);
          hosts.set(g.to, host);
        }
      }
      for (const chain of [...hosts.keys()]) settle(chain);
      look();
    },

    /** Everything under way, settled (the tests'). */
    settled: async () => {
      while (under.size) await Promise.all([...under]);
    },

    /** Stop the timers (the server's stop): what waits stays in its Space. */
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      for (const t of settling.values()) clearTimeout(t);
      settling.clear();
    },
  };
}

/** @typedef {ReturnType<typeof createGuidance>} Guiding */
