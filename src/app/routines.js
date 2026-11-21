// @ts-check
// Routines' runner (HarnessV4_Space_Plan S6, the mock "Space, grown" screen 11): what an agent of a project does by
// itself at a time the person switched on. One timer, set to the soonest time of every routine on — an hour at most, so
// a clock moved or a computer that slept is seen —; at a time, the routine runs as a new chat of its project (SG-D15,
// R7), read-only unless it writes, in a git worktree of its own then (S6-D2), its first message the routine's words
// after a line saying what it is and what it may do. A time that comes while its last run still runs, or while Pause all
// is on, is skipped and said on its row; nothing is made up later (S6-D5). At the start, a time missed while Filament was
// off runs once where it was today's, and is said missed where it was an earlier day's (S6-D11). A run ends as its
// chat's turn lets go (the server's turn lock, `released`): what it answered, or why it failed — once in Needs you
// (S6-D10), never retried. The routines are the store's (services/spaces.js); the times' arithmetic is core's.
// A watcher (the plan of 11-11) runs as its events are heard (`heard`): at once, or — while a run of it is under way —
// once that run ends, with every event that came meanwhile; what waited through a restart or Pause all runs after. Who
// it wakes (its w5): a new chat each time, as a routine's run; the chat that proposed it — a turn of Filament's own
// there, beside the person's (`wakeChat`), held back while that chat is at work, a question waits, room is made for it
// or the person stopped it, and sent as it lets go; a no of that chat's that does not end by itself is its failure,
// said once, and one that can never end — the chat gone, archived, a client's own — pauses it —; or only the person,
// in Needs you. Each wake reads Filament's packet (app/watchers/packet.js) after its events, and a watcher wakes at
// most `WATCH_WAKES_HOUR` times an hour: past it, what it hears waits for the hour. While a watcher's turn is at work
// in a chat, that chat's events wake no watcher and its agent starts no run (`hostOf`): no run starts another (SA-D10).
// A wake whose turn failed goes again on the person's Retry of that turn (`runNow`'s `again`; r-doors, 11-12): the
// block it carried, read from that chat's record, as a run of the watcher's once more — held as its wakes are, its end
// written on its row —, never as the person's message.
// A wake whose post the door itself failed — thrown, or answered 503 or any 5xx: Filament stopping, its route broken —
// loses none of what it heard (r-itself, 11-12): the events wait for the next try, as they do behind a chat at work.
// What ends a wait is what gave it (s-itself, 11-12). A chat at work gave one that its letting go ends at once
// (`released`, `freed`). A wait of the watcher's own — the door failed its post, or its wake threw — is over when its
// own time is, each twice the last, or on the person's Run now or Retry, and no lock let go ends it: a turn that fails
// inside the lock lets go of its chat as it fails, and two watchers of one chat ended each other's wait so, turn after
// turn, for as long as the door stayed shut. A chat's own no (`hold`) is over as a turn of that chat's ends, never as
// the lock a refused post took lets go.
// A project the person archived runs nothing by itself (r-itself, 11-12; the store's `archived`): its routines' times
// are skipped and said, its watchers wake nothing and hear nothing, as under Pause all, with nothing switched off —
// brought back, each goes again, with what waited and nothing made up. The person's Run now runs one still.
import { ARCHIVED_AGENT, firstLine, missedTimes, momentWords, nextOf, routineRunsOn, runBranch, runTitle, runWords, scheduleOf, wakeWords, whenWords } from "../core/routines.js";
import { triggerWords, turnStands, wakesFreeAt, wokeParts } from "../core/watchers.js";
import { inRepo } from "../adapters/git/places.js";
import { UNTITLED_CHAT, writerName } from "../core/space.js";

/** The longest the timer waits before the routines are looked at again. */
export const ROUTINES_LOOK_MS = 3_600_000;
/** How late a time may be seen — a timer that fired late, past midnight — and still run, not be said missed. */
export const LATE_MS = 15 * 60_000;
/**
 * How long a watcher held back waits before it looks again — its chat could not take its turn, its wake threw, or the
 * door its turn goes through failed —: `PARK_MS` at first, doubled each time in a row, `PARK_MAX_MS` at most. Its
 * chat's next turn letting go ends the wait a chat at work gave at once (`released`); the timer is for the release
 * that never comes — and the one end of a wait that is the watcher's own (`OWN_WAITS`).
 */
export const PARK_MS = 60_000;
export const PARK_MAX_MS = 15 * 60_000;

/** Why a routine's time was skipped in a project the person archived, as its row says it (core/routines.js `rowWords`). */
const ARCHIVED_SKIP = "its project was archived";
/** What a watcher's run says on its row and in What happened where its turn's answer stays in the chat it woke. */
const ANSWER_IN_CHAT = "its answer is in the chat it woke";
/**
 * What holds a watcher back whose post the door itself failed (r-itself, 11-12) — thrown, or answered 503 or any 5xx —:
 * no word of the chat it wakes. What it heard waits for the next try, on the wait a chat at work gives it (`park`),
 * and under the cap what waits always has (core/watchers.js `WATCH_LIMITS.events`: the newest, the rest counted).
 */
const DOWN = "down";
/** Whether a post's answer is the door's own failure: a thrown one is read as a 502. @param {{ status: number }} res */
const doorFailed = (res) => res.status >= 500;
/**
 * The waits that are a watcher's own, given by no chat (s-itself, 11-12): the door failed its post (`DOWN`), or its
 * wake threw. One is over when its own time is, or on the person's Run now or Retry — never as a chat lets go
 * (`letGo`): the lock a failed turn took and let go is no sign that the door opened.
 */
const OWN_WAITS = Object.freeze([DOWN, "threw"]);

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/**
 * The chats' turns a run's events were of: what the run reviews, kept with it until its end (services/spaces.js
 * `routineEnded`). @param {import("../core/watchers.js").Pending | null | undefined} heard
 */
const turnsOf = (heard) => (heard?.events || []).flatMap((e) => (e.chain && e.of?.turn ? [{ chain: e.chain, turn: e.of.turn }] : []));

/**
 * @typedef {import("../core/routines.js").Routine} Routine
 * @typedef {{ ok: true, name: string, branch: string, folder: string, cwd: string, main: string, place: string } |
 *   { ok: false, outside: string } | { ok: false, error: string }} Owned
 * @typedef {{
 *   spaces: import("../services/spaces.js").SpaceStore,
 *   sessions: { create: (o: any) => { id: string }, besideFacts: (id: string) => { busy: boolean, asking: boolean,
 *     last: { n?: number, final: boolean, text: string, cut: boolean, failed: boolean, why: string, stopped: boolean } | null },
 *     wakeOf?: (id: string, n: number) => { text: string, watch: any } | null },
 *   mark: (chainId: string, meta: Record<string, unknown>) => void,
 *   markTurn?: (chainId: string, turn: number, meta: Record<string, unknown>) => void,
 *   postTurn: (chainId: string, body: Record<string, unknown>) => Promise<{ status: number, body: any, turn?: number | null }>,
 *   folderOf: (project: string) => string | null,
 *   gone?: (project: string) => boolean,
 *   places?: { own: (cwd: string, name: string) => Promise<Owned>, takeBack: (made: any) => Promise<string | null>,
 *     template?: (chatId: string, made: any) => void, untemplate?: (chatId: string, why: string) => Promise<void> } | null,
 *   remove?: (chainId: string) => Promise<unknown>,
 *   nameOf?: (project: string) => string,
 *   chatName?: (chain: string) => string,
 *   apart?: (chain: string) => boolean,
 *   problemOf?: (model: string) => string | null,
 *   chatModel?: (model: string, effort: string) => { name: string, effort: string | null },
 *   armed?: () => void,
 *   packetOf?: (r: Routine, heard: import("../core/watchers.js").Pending, reader: string | null) => Promise<string>,
 *   unwakeable?: (chain: string) => string | null,
 *   parkMs?: number,
 *   log?: (level: string, msg: string) => void,
 *   now?: () => number,
 * }} RoutinesDeps
 *   `postTurn`: a turn of Filament's own sent to a chat — its status, its refusal's body, and the turn it became there
 *   (`turn`), as the sessions service says it; `markTurn`: marks kept on one turn of a chat, by its number;
 *   `problemOf`: why a model cannot run an agent now, as the Agents page checks one; `chatModel`: a model and an effort as
 *   a chat is made on them (core/model-choice.js `chatEffortOf`) — without it the effort is kept beside the name;
 *   `chatName`: a chat's name, as a watcher's trigger names the chat it watches; `armed`: the routines changed, or were
 *   looked at — the watchers' sources that ask by themselves (a connection's, app/watchers/connection.js) follow them;
 *   `packetOf`: what Filament gathered for a wake's events (app/watchers/packet.js), for the chat that reads it — the
 *   chat a watcher wakes, or none for a run's new chat; `unwakeable`: why a chat a watcher wakes can never take its turn
 *   though it is there — archived, a client's own session —, else null; `parkMs`: `PARK_MS` (the tests')
 */

/**
 * The model a run starts on, and its effort, as a chat is made on them: `{ model, settings }` merged into its layer.
 * @param {string} model @param {string} effort @param {RoutinesDeps["chatModel"]} chatModel
 * @returns {{ model: string, effort: string | null }}
 */
const madeOn = (model, effort, chatModel) => {
  if (!effort) return { model, effort: null };
  const c = chatModel ? chatModel(model, effort) : { name: model, effort };
  return { model: c.name, effort: c.effort };
};

/** @param {RoutinesDeps} deps */
export function createRoutines({ spaces, sessions, mark, markTurn = () => {}, postTurn, folderOf, gone = () => false, places = null, remove, nameOf = (p) => p, chatName = () => "a chat of this project", apart = () => false, problemOf = () => null, chatModel, armed = () => {}, packetOf = async () => "", unwakeable = () => null, parkMs = PARK_MS, log = () => {}, now = Date.now }) {
  let started = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** The runs starting, by project and routine: two presses start one. @type {Set<string>} */
  const starting = new Set();
  /**
   * The watchers held back, by project and routine, each until when, how long it waited this time, what holds it
   * (`why`) and the listening the wait was made in (`from`, its `seen.from`): the chat one wakes could not take its
   * turn — at work, a question waiting, room being made, stopped by the person —, its wake threw, or the door its turn
   * goes through failed (`DOWN`). That chat's next turn letting go ends the wait the chat gave (`released`, `letGo`);
   * else the timer does (`PARK_MS`), which alone ends a wait of the watcher's own (`OWN_WAITS`). One whose chat said a
   * no that does not end by itself waits for that chat alone, on no timer (`hold`), with that chat's newest turn as it
   * stood (`stood`). `shut`: the door failed its last post, and none of its posts was taken since — kept through a
   * wait its chat gives meanwhile. A wait ends with the listening it was made in (`waitOf`).
   * @type {Map<string, { until: number, wait: number, why: string, from: number | null, shut?: boolean, stood?: string }>}
   */
  const parked = new Map();
  /**
   * The chats a watcher's turn is on its way to — its wake being gathered and sent, its run not written yet —, each
   * with the watcher's title and how many: that turn may begin, and end, before its run is written (`hostOf`).
   * @type {Map<string, { title: string, n: number }>}
   */
  const waking = new Map();

  /** @param {string} project @param {string} id */
  const routineOf = (project, id) => spaces.get(project).routines.find((x) => x.id === id) || null;

  /**
   * A watcher's wait, where it is of the listening it has now: one made before it was paused and resumed, switched off
   * and on, or removed and put back — it listens anew since (`seen.from`) — is over, and forgotten.
   * @param {string} key @param {Routine | null} r
   */
  const waitOf = (key, r) => {
    const p = parked.get(key);
    if (p && p.from === (r?.seen?.from ?? null)) return p;
    parked.delete(key);
    return null;
  };
  /**
   * A watcher held back from now: twice as long as the last time in a row, `PARK_MAX_MS` at most. `why`: what holds
   * it — its chat "busy", "asking", "stopped" or making "room", its wake "threw", or the door `DOWN`.
   * @param {string} key @param {Routine | null} r @param {string} why
   */
  const park = (key, r, why) => {
    const was = waitOf(key, r);
    const wait = Math.min(was?.wait ? was.wait * 2 : parkMs, Math.max(parkMs, PARK_MAX_MS));
    parked.set(key, { until: now() + wait, wait, why, from: r?.seen?.from ?? null, ...(why === DOWN || was?.shut ? { shut: true } : {}) });
  };
  /**
   * A chat's newest turn as it stands, in a word (core/watchers.js `turnStands`); null where the chat cannot be read.
   * The lock a refused post took and let go changes none of it (`hold`). @param {string} chain
   */
  const standsOf = (chain) => {
    try {
      return turnStands(sessions.besideFacts(chain).last);
    } catch {
      return null;
    }
  };
  /**
   * A watcher held back for its chat alone: that chat said a no that does not end by itself, so no timer sends its
   * turn again — that chat's next turn letting go does, room made for it, or a Run now. The lock its refused post
   * took lets go too, and is no turn of that chat's: the hold keeps that chat's newest turn as it stands (`stood`),
   * and stands until that is another, or ended otherwise (`letGo`).
   * @param {string} key @param {Routine} r
   */
  const hold = (key, r) => void parked.set(key, { until: Infinity, wait: 0, why: "refused", from: r.seen?.from ?? null, stood: standsOf(r.madeIn) ?? undefined });
  /**
   * A chat let go — a lock of it (`released`), or the room made for it (`freed`) —: the wait it gave one of its
   * watchers is over, and that one looks at once. Not a wait of the watcher's own (`OWN_WAITS`), which its own time
   * ends; nor, at a lock's letting go (`turn`: that chat's newest turn as it stands now, where it can be read), a
   * hold made while that turn stood as it does — the lock was a refused post's, this watcher's or another's. Behind
   * a door that failed its last post (`shut`) the door's wait is the one that stands from here, over as it is: failed
   * again, that is said no more, and it waits twice as long. → whether a wait ended.
   * @param {string} key @param {string | null} [turn]
   */
  const letGo = (key, turn = null) => {
    const p = parked.get(key);
    if (!p || OWN_WAITS.includes(p.why) || (turn != null && p.why === "refused" && p.stood === turn)) return false;
    if (p.shut) parked.set(key, { ...p, until: 0, why: DOWN });
    else parked.delete(key);
    return true;
  };
  /** Whether a watcher is held back still. @param {string} key @param {Routine | null} r */
  const parkedNow = (key, r) => (waitOf(key, r)?.until ?? 0) > now();

  /**
   * A routine's schedule in words; a watcher's trigger, each chat named as a run's chat reads another's (core/space.js
   * `writerName`). @param {Routine} r
   */
  const whenOf = (r) => {
    if (r.trigger) return triggerWords(r.trigger, (c) => writerName(c, chatName(c), { nameOf: () => UNTITLED_CHAT, apart }));
    const s = scheduleOf(r.when);
    return s.ok ? whenWords(s.s) : r.when;
  };

  /**
   * When a watcher's waiting events may wake it: now — after a restart, its last run's end, Pause all switched off —,
   * or once it is held back no longer and its hour frees, past its cap of wake-ups. Null where none wait, or where
   * something else holds them: it is off or paused, Pause all is on, its project is archived, a run of it is under way
   * or starting — whose end looks again.
   * @param {string} project @param {Routine} r
   */
  const wakeAt = (project, r) => {
    const key = `${project}|${r.id}`;
    if (!r.trigger || !r.pending || r.state !== "on" || r.paused || r.last?.state === "running" || starting.has(key) || spaces.pausedSince() || spaces.archived(project)) return null;
    const t = now();
    return Math.max(t, waitOf(key, r)?.until ?? 0, r.wakes === "you" ? 0 : (wakesFreeAt(r.woke, t) ?? 0));
  };

  /** The timer set to the soonest time of every routine on, and of every watcher whose events wait; none where none is. */
  function arm() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!started) return;
    try {
      armed();
    } catch (/** @type {any} */ e) {
      log("warn", `routines: the watchers' sources could not follow them (${e?.message || e})`);
    }
    let soon = Infinity;
    for (const { project, r } of spaces.routinesAll()) {
      // A watcher gone off, paused or removed is held back no more: back on, it looks at once.
      if (r.state !== "on" || r.paused) parked.delete(`${project}|${r.id}`);
      const n = wakeAt(project, r) ?? nextOf(r);
      if (n != null && n < soon) soon = n;
    }
    if (!Number.isFinite(soon)) return;
    timer = setTimeout(() => {
      timer = null;
      void tick().catch((/** @type {any} */ e) => log("warn", `routines: a look at the times failed (${e?.message || e})`));
    }, Math.max(0, Math.min(soon - now(), ROUTINES_LOOK_MS)));
    timer.unref?.();
  }

  /**
   * Each routine whose time came, at its newest time — the ones before it passed while the computer slept are not
   * made up —: it runs, or is skipped and said; one whose newest time was an earlier day's is said missed.
   * @param {string} why  why a time was missed: Filament off, the computer asleep
   */
  async function catchUp(why) {
    const t = now();
    for (const { project, r: listed } of spaces.routinesAll()) {
      // As it stands now: a start awaited before this one may have run it, or the person paused or removed it meanwhile.
      const r = routineOf(project, listed.id);
      if (!r) continue;
      try {
        if (r.trigger) {
          const at = wakeAt(project, r);
          if (at != null && at <= t) await woken(project, r.id);
          continue;
        }
        const n = nextOf(r);
        if (n == null || n > t) continue;
        const s = scheduleOf(r.when);
        if (!s.ok || r.onAt == null) continue;
        const m = missedTimes(s.s, Math.max(r.upTo ?? 0, r.onAt), t, r.onAt);
        const at = m.today ?? (m.earlier != null && t - m.earlier < LATE_MS ? m.earlier : null);
        if (at != null) await due(project, r, at);
        else if (m.earlier != null) spaces.routineSkipped(project, r.id, { at: m.earlier, why, missed: true });
      } catch (/** @type {any} */ e) {
        log("warn", `routines: “${r.title}” of ${project} could not be looked at (${e?.message || e})`);
      }
    }
  }

  /**
   * The look under way, and whether another was asked for meanwhile: one look at a time, so none acts on what another
   * is changing — a look asked for while one runs is made once it ends.
   * @type {Promise<void> | null}
   */
  let looking = null;
  let lookAgain = false;
  async function tick() {
    if (looking) {
      lookAgain = true;
      return looking;
    }
    looking = (async () => {
      try {
        do {
          lookAgain = false;
          await catchUp("the computer was asleep");
        } while (lookAgain && started);
      } finally {
        looking = null;
      }
      arm();
    })();
    return looking;
  }

  /**
   * A watcher with events waiting wakes with them — its run starts, a turn goes to the chat it wakes, or the person is
   * told in Needs you —, save while a run of it is under way, whose end takes them up; while it is off, paused, Pause
   * all is on or its project is archived; while it is held back; or past its wake-ups of the hour, until the hour
   * frees — all of which keep them waiting. → the chat it woke, or null.
   * @param {string} project @param {string} id
   */
  async function wake(project, id) {
    const key = `${project}|${id}`;
    const r = routineOf(project, id);
    if (!started || !r?.trigger || !r.pending || r.state !== "on" || r.paused || spaces.pausedSince() || spaces.archived(project) || starting.has(key)) return null;
    // Held back: the end of its wait is on the timer, whatever waited when the wait was made.
    if (parkedNow(key, r)) {
      arm();
      return null;
    }
    if (r.wakes === "you") {
      spaces.watchTold(project, id);
      return null;
    }
    if (r.last?.state === "running" && settle(project, r)) return null;
    if (wakesFreeAt(r.woke, now()) != null) {
      arm();
      return null;
    }
    if (r.wakes === "chat") return wakeChat(project, id, "event");
    return run(project, id, now(), "event");
  }

  /**
   * `wake`, never throwing: a wake that threw — the store could not be written — is logged, and its watcher held back
   * as one whose chat said no, so the timer tries it again later and never at once without end.
   * @param {string} project @param {string} id
   */
  async function woken(project, id) {
    /** @type {Routine | null} */
    let r = null;
    try {
      r = routineOf(project, id);
      return await wake(project, id);
    } catch (/** @type {any} */ e) {
      log("warn", `routines: a watcher of ${project} could not wake (${e?.message || e})`);
      park(`${project}|${id}`, r, "threw");
      arm();
      return null;
    }
  }

  /**
   * A watcher's turn in the chat that proposed it (the plan of 11-11, its w5): Filament's own there, beside the
   * person's — never their message, never a question answered (the sessions service's `watch`) —, its words the
   * watcher's block, the events and the packet. The service holds that turn to reading, whatever the chat's own
   * switch; where the watcher writes, the post says the turn works as the chat does (`works`). That chat at work, a
   * question waiting for the person, room being made for it or stopped by them since: the watcher is held back
   * (`park`), the events kept waiting, until that chat's next turn lets go (`released`) or its wait ends. A no of that
   * chat's that does not end by itself — it needs compacting first, say, or its agent cannot be held to reading — is
   * the watcher's failure, said once: what it heard waits for that chat's next letting go, and no timer sends it
   * again (`hold`). Gone, archived or a client's own session, it can never take the turn: its failure once,
   * and the watcher paused with the reason (the store's `watchPaused`), what it heard kept. A post the door itself
   * failed (`doorFailed`: thrown, a 503 or any 5xx) is no word of that chat's (r-itself, 11-12): what it heard waits
   * for the next try, the watcher held back on a wait of its own (`park`, why `DOWN`: no chat's letting go ends it),
   * its failure said once while the door stays shut — and not at all where Filament is restarting (the route's
   * `restarting`), whose next start takes them up. A post that fails otherwise — that chat's own no, a 4xx — is its failure with its events. The
   * events taken are those the turn carried. The turn is the watcher's
   * run, by its chat: its end is read as a run's, from the turn its post became; that chat is never marked a routine's
   * run, and from the moment the wake is on its way the chat hosts it (`hostOf`). `by` "you": the person's Run now,
   * with what waits, or none; "agent": a chat's (`startedBy`). → that chat, or null.
   * `again`: the person's Retry of a wake that failed (`runNow`) — the block that turn carried goes as it was, and
   * the turn it becomes keeps what woke that one; nothing is heard anew: what waits goes on waiting for its next look,
   * and the hour's wake-ups count none.
   * @param {string} project @param {string} id @param {"event" | "you" | "agent"} by
   * @param {{ chain: string, byName: string } | null} [startedBy]
   * @param {{ turn: number, text: string, watch: any } | null} [again]
   */
  async function wakeChat(project, id, by, startedBy = null, again = null) {
    const key = `${project}|${id}`;
    const r = routineOf(project, id);
    if (!r || starting.has(key)) return null;
    starting.add(key);
    const at = now();
    const chain = r.madeIn;
    // Its failure's row is the Space's, read by every chat of the project: the chat named as another chat's agent reads it.
    const name = writerName(chain, chatName(chain), { nameOf: () => UNTITLED_CHAT, apart });
    const who = startedBy ? { startedBy } : {};
    let hosting = false;
    /**
     * Its failure, on its row and once in Needs you. `heard`: the events that go with it; none where they wait for
     * its next look. @param {string} why @param {import("../core/watchers.js").Pending | null} heard
     */
    const fail = (why, heard) => {
      if (heard) spaces.watchTake(project, id, heard);
      spaces.routineEnded(project, id, { at, chain: "", by, ...who, state: "failed", why: `the chat it wakes (${name}) ${why}` });
      log("warn", `routines: the watcher “${r.title}” of ${project} could not wake ${chain}: ${why}`);
      return null;
    };
    /**
     * That chat can never take its turn: its failure once, and the watcher paused with the reason — no later hearing
     * fails it again —, what it heard kept as a paused watcher's is. Resume, or Remove, is the person's.
     * @param {string} why
     */
    const never = (why) => {
      fail(why, null);
      if (spaces.watchPaused(project, id, `the chat it wakes (${name}) ${why}`)) log("info", `routines: the watcher “${r.title}” of ${project} was paused: ${chain} ${why}`);
      parked.delete(key);
      return null;
    };
    try {
      const heard = again ? null : (r.pending ?? null);
      /** @type {ReturnType<RoutinesDeps["sessions"]["besideFacts"]>} */
      let f;
      try {
        f = sessions.besideFacts(chain);
      } catch {
        return never("is gone");
      }
      const no = unwakeable(chain);
      if (no) return never(`cannot be woken: ${no}`);
      if (f.busy || f.asking || f.last?.stopped) {
        park(key, r, f.busy ? "busy" : f.asking ? "asking" : "stopped");
        return null;
      }
      if (!heard && by === "event") return null;
      hosting = true;
      waking.set(chain, { title: r.title, n: (waking.get(chain)?.n || 0) + 1 });
      const packet = heard ? await packetOf(r, heard, chain).catch((/** @type {any} */ e) => `(Filament's packet for these events could not be gathered: ${e?.message || e})`) : "";
      // Who pressed Run now, as this chat reads another: one `apart` to it is "an untitled chat"; itself, by its name.
      const byName = startedBy ? (startedBy.chain === chain ? startedBy.byName : writerName(startedBy.chain, startedBy.byName, { nameOf: () => UNTITLED_CHAT, apart })) : "";
      const text = again ? again.text : wakeWords(r, { project: nameOf(project), when: whenOf(r), by, byName, heard, packet, now: now() });
      /** @type {{ status: number, body: any, turn?: number | null }} */
      let res;
      try {
        // The service holds a watcher's turn to reading by itself; one whose watcher writes says so (`works`), and
        // runs as any message posted to that chat would.
        res = await postTurn(chain, { by: "watch", ...(r.writes ? { works: true } : {}), content: [{ type: "text", text }] });
      } catch (/** @type {any} */ e) {
        res = { status: 502, body: { error: String(e?.message || e) } };
      }
      // A turn took it first (the service names its `holder`), a question came, room is being made, the person
      // stopped it (its `watch`): each ends by itself, and what it heard waits for that chat to let go.
      const held = res.status !== 409 ? "" : ["room", "asking", "stopped"].includes(res.body?.watch) ? String(res.body.watch) : res.body?.holder ? "busy" : "";
      if (held) {
        park(key, r, held);
        log("info", `routines: the watcher “${r.title}” of ${project} waits for ${chain} to let go (${String(res.body?.error || "it said no")})`);
        return null;
      }
      // A client's own session never takes a turn of Filament's.
      if (res.status === 409 && res.body?.client) return never(`could not take its turn: ${String(res.body?.error || "it is a client's own session")}`);
      // A turn held to reading is held by what that chat's agent asks Filament before it acts; one that asks nothing —
      // in the mode its model's name sets (the service's `watch` "unheld") — cannot be, and a model's name changes by
      // nobody but the person: the watcher's failure once, and it is paused with the reason.
      if (res.status === 409 && res.body?.watch === "unheld")
        return never(`cannot be held to reading: its agent asks Filament nothing before it acts${res.body?.mode ? `, in the mode its model's name sets (${String(res.body.mode)})` : ""}`);
      // Any other no of that chat's does not end by itself — it must make room first, say —: the watcher's failure,
      // said once. What it heard waits for that chat's next letting go, which no timer stands in for.
      if (res.status === 409) {
        fail(res.body?.needsCompaction ? "needs compacting before it can take a turn" : `could not take its turn: ${String(res.body?.error || "it said no")}`, null);
        hold(key, r);
        return null;
      }
      // The door itself failed, not that chat (r-itself, 11-12): what it heard waits for the next try, on the wait a
      // chat at work gives it. Its failure is said with none of its events, once while the door stays shut; where
      // Filament is restarting there is none to say — the routines begin again with the next start, and take them up.
      if (doorFailed(res)) {
        const why = `could not take its turn: ${String(res.body?.error || `HTTP ${res.status}`)}`;
        if (res.body?.restarting || waitOf(key, r)?.shut) log("info", `routines: the watcher “${r.title}” of ${project} keeps what it heard for its next try: ${chain} ${why}`);
        else fail(why, null);
        park(key, r, DOWN);
        return null;
      }
      if (res.status < 200 || res.status >= 300) return fail(`could not take its turn: ${String(res.body?.error || `HTTP ${res.status}`)}`, heard);
      if (heard) spaces.watchTake(project, id, heard);
      const events = heard ? heard.events.length + heard.more : 0;
      // Its end is read from its own turn — the one its post became, as the service says it (`turn`), never a guess
      // made before it went: the same wake after a try that failed goes on in that try's turn — and never from a later
      // one of the person's. What it carried of a chat whose words were its own alone is kept with it (`quiet`).
      const turn = Number.isInteger(res.turn) && Number(res.turn) > 0 ? Number(res.turn) : 0;
      // Which watcher woke it and what it heard, kept on that turn for the capsule its page draws over it (core/watchers.js
      // `wokeParts`): the page reads no word of the wake's block. A turn that keeps none is drawn as a watcher's wake.
      if (turn && r.trigger) {
        try {
          markTurn(chain, turn, { watch: again ? again.watch : { id: r.id, project, title: r.title, words: wokeParts(r.title, r.trigger, heard, { nameOf: chatName, by, startedBy }) } });
        } catch (/** @type {any} */ e) {
          log("warn", `routines: what woke ${chain} was not kept on its turn (${String(e?.message || e).slice(0, 160)})`);
        }
      }
      spaces.routineStarted(project, id, { at, chain, by, ...who, ...(events ? { events } : {}), ...(turn ? { turn } : {}), ...(heard?.events.some((e) => e.quiet) ? { quiet: true } : {}), turns: turnsOf(heard) });
      // Its turn went and is written: it is held back no more. Not before — a wake that throws once its turn was sent
      // (its Space could not be written) waits twice as long as the last that did (`woken`).
      parked.delete(key);
      // A turn that ended before its start was written let go unread: read now.
      const after = routineOf(project, id);
      if (after?.last?.state === "running" && after.last.chain === chain) settle(project, after);
      log("info", `routines: the watcher “${r.title}” of ${project} woke ${chain} ${again ? `on the person's Retry of its turn ${again.turn}` : by === "you" ? "on the person's Run now" : by === "agent" ? `on ${startedBy?.byName || "a chat"}'s Run now` : `on ${events === 1 ? "1 event" : `${events} events`}`}`);
      return chain;
    } finally {
      starting.delete(key);
      if (hosting) {
        const w = waking.get(chain);
        if (w && w.n > 1) waking.set(chain, { ...w, n: w.n - 1 });
        else waking.delete(chain);
      }
      // What still waits — held back, heard meanwhile, or after a failure — has its time on the timer.
      if (routineOf(project, id)?.pending) arm();
    }
  }

  /**
   * A time that came: the routine runs — or not, and its row says why: Pause all, its project archived, or its last
   * run still under way.
   * @param {string} project @param {Routine} r @param {number} at
   */
  async function due(project, r, at) {
    if (spaces.pausedSince()) return void spaces.routineSkipped(project, r.id, { at, why: "Pause all was on" });
    if (spaces.archived(project)) return void spaces.routineSkipped(project, r.id, { at, why: ARCHIVED_SKIP });
    // A run of it starting — its chat made, its turn not begun — is under way too: nothing of it is read from its chat yet.
    if (starting.has(`${project}|${r.id}`)) return void spaces.routineSkipped(project, r.id, { at, why: "a run of it was starting" });
    if (r.last?.state === "running" && settle(project, r)) return void spaces.routineSkipped(project, r.id, { at, why: `the ${momentWords(r.last.at, r.last.at)} run was still under way` });
    await run(project, r.id, at, "time");
  }

  /**
   * A run under way read from its chat: still at work — a turn holds it, or it waits for the person — or ended, and how,
   * written. → whether it still runs.
   * @param {string} project @param {Routine} r
   */
  function settle(project, r) {
    const run = r.last;
    if (!run || run.state !== "running") return false;
    const base = { at: run.at, chain: run.chain, by: run.by, ...(run.startedBy ? { startedBy: run.startedBy } : {}) };
    /** @type {ReturnType<RoutinesDeps["sessions"]["besideFacts"]>} */
    let f;
    try {
      f = sessions.besideFacts(run.chain);
    } catch {
      spaces.routineEnded(project, r.id, { ...base, state: "failed", why: "its chat is gone" });
      return false;
    }
    // A question or a permission waits for the person: the run goes on once they answer (case 9).
    if (f.busy || f.asking) return true;
    // The connections' tools it acted through without asking were the run's (A2c): its chat keeps naming the routine,
    // and a message the person sends there after is judged as any chat's. A watcher's turn in the chat that proposed it
    // was no run of a chat of its own — a run's chat is new, never that one —: that chat stays the person's, whatever
    // the watcher wakes by now.
    const hosted = run.chain === r.madeIn;
    if (!hosted) mark(run.chain, { routine: { project, id: r.id, title: r.title, at: run.at, by: run.by, ...(run.startedBy ? { startedBy: run.startedBy } : {}) } });
    const l = f.last;
    // Its turn there is the one its post became (`turn`): a later one is the person's, and none of the watcher's to
    // read; an earlier one alone means its turn ended with nothing kept of it. Nor is its answer the Space's to quote
    // — What happened is read by every chat of the project — where that chat's words are its own alone (`apart`),
    // where its wake carried an event of a chat whose words were (`quiet`: its own chat read them whole), or where
    // its turn is not known, and the newest may be the person's.
    const newest = hosted && run.turn != null && l?.n != null ? l.n : null;
    const unquoted = hosted && (apart(run.chain) || run.quiet === true || run.turn == null);
    if (newest != null && newest > /** @type {number} */ (run.turn)) spaces.routineEnded(project, r.id, { ...base, state: "done", said: ANSWER_IN_CHAT });
    else if (newest != null && newest < /** @type {number} */ (run.turn)) spaces.routineEnded(project, r.id, { ...base, state: "failed", why: "its turn there ended with nothing kept of it" });
    else if (l?.stopped) spaces.routineEnded(project, r.id, { ...base, state: "stopped" });
    else if (l?.final) spaces.routineEnded(project, r.id, { ...base, state: "done", said: unquoted ? ANSWER_IN_CHAT : firstLine(l.text) });
    else spaces.routineEnded(project, r.id, { ...base, state: "failed", why: l?.failed && l.why ? l.why : l?.cut ? "Filament stopped before it ended" : "it ended with no answer" });
    return false;
  }

  /**
   * One run: its place — the project's folder, or a worktree of its own where it writes —, its chat, its first message.
   * Anything that keeps it from starting is its failure, said on its row and once in Needs you. → its chat, or null.
   * `startedBy`: the chat whose agent pressed Run now (`by` "agent", HarnessV4_AgentsSpace_Plan SA-D10). A watcher's
   * run takes the events that wait as it begins — whatever comes after waits for its next —: its first message lists
   * them, and a run that cannot start fails with them, said, never tried again with the same. Save where the door its
   * first message goes through failed (`doorFailed`; r-itself, 11-12): its run is said failed as any that could not
   * start, and what it took waits again for the next try (the store's `watchBack`), ahead of what was heard
   * meanwhile, the watcher held back as from a chat at work (`park`, why `DOWN`).
   * @param {string} project @param {string} id @param {number} at @param {import("../core/routines.js").RunBy} by
   * @param {{ chain: string, byName: string } | null} [startedBy]
   */
  async function run(project, id, at, by, startedBy = null) {
    const key = `${project}|${id}`;
    if (starting.has(key)) return null;
    const r = routineOf(project, id);
    if (!r) return null;
    starting.add(key);
    /** @type {import("../core/watchers.js").Pending | null} */
    let heard = null;
    let events = 0;
    let packet = "";
    /** @type {any} */
    let made = null;
    /** @param {string} why */
    const fail = (why) => {
      spaces.routineEnded(project, id, { at, chain: "", by, ...(startedBy ? { startedBy } : {}), state: "failed", why });
      log("warn", `routines: “${r.title}” of ${project} could not start: ${why}`);
      return null;
    };
    const letGo = async () => {
      if (!made || !places) return;
      const stays = await places.takeBack(made).catch((/** @type {any} */ e) => String(e?.message || e));
      if (stays) log("warn", `routines: ${stays}`);
    };
    try {
      heard = r.trigger ? spaces.watchTake(project, id) : null;
      events = heard ? heard.events.length + heard.more : 0;
      // What Filament gathered for its events, read as it wakes (app/watchers/packet.js): for a chat of its own, which
      // reads every other chat as any other chat's agent does.
      packet = heard ? await packetOf(r, heard, null).catch((/** @type {any} */ e) => `(Filament's packet for these events could not be gathered: ${e?.message || e})`) : "";
      const folder = folderOf(project);
      if (!folder) {
        // Its project is gone (HarnessV4_SpacesPlugins_Plan A5): what runs by itself there is paused, once, with a line
        // saying why — never a failure at every time where nobody sees it.
        if (gone(project)) {
          spaces.pauseGone(project);
          log("info", `routines: “${r.title}” of ${project} was paused: its project is gone`);
          return null;
        }
        return fail("Filament does not know its project's folder");
      }
      // What it runs on (the owner's of 11-04): the model the person chose for it, else its Space's — Settings › Space's,
      // or its own Space settings' —, else the one it was proposed on; where that one cannot run now, its Space's in its
      // place, said. None to run on is its failure, before anything is made for it.
      const space = spaces.runsOn(project);
      let pick = routineRunsOn(r, space);
      let instead = "";
      if (!pick.model) return fail("it has no model to run on: choose one on its sheet, or set a model for every Space in Settings › Space");
      const cannot = problemOf(pick.model);
      if (cannot) {
        const back = space.model && space.model !== pick.model && !problemOf(space.model) ? space : null;
        if (!back) return fail(`it runs on ${pick.model}, which cannot run now: ${cannot}`);
        instead = `${pick.model} could not run (${cannot})`;
        pick = { model: back.model, effort: back.effort, from: back.from || "default" };
      }
      const on = madeOn(pick.model, pick.effort, chatModel);
      const onWords = `${pick.model}${pick.effort ? ` · ${pick.effort}` : ""}`;
      let cwd = folder;
      let inPlace = false;
      if (r.writes) {
        if (!places) return fail("it writes, and this Filament makes no worktree for it");
        const got = await places.own(folder, runBranch(r.title, at));
        // A Space of the person's own whose folder is no git repository writes in that folder (HarnessV4_SpacesPlugins_Plan
        // A2c): Filament made it to hold the Space's files, and no lane can be made there. Only there, as its sheet said: a
        // repository with no commit yet, or one git cannot be asked about, fails in words.
        const own = spaces.get(project).own;
        if (!got.ok && "outside" in got && own && !inRepo(own.folder || folder)) inPlace = true;
        else if (!got.ok) return fail("outside" in got ? `it writes, and ${got.outside}: a lane of its own needs git` : `its worktree could not be made: ${got.error}`);
        else {
          made = got;
          cwd = got.cwd;
        }
      }
      // Its project deleted while its lane was made: a chat made now would make the project again, in its folder (found by
      // the Hunter on A5). Nothing starts; what was made goes.
      if (gone(project)) {
        await letGo();
        log("info", `routines: “${r.title}” of ${project} did not start: its project was deleted`);
        return null;
      }
      /** @type {{ id: string }} */
      let chat;
      try {
        const effort = on.effort ? { model: { effort: on.effort } } : null;
        chat = sessions.create({ cwd, model: on.model, title: runTitle(r.title, at), settings: r.writes ? effort : { loop: { permissions: "read-only" }, ...effort } });
      } catch (/** @type {any} */ e) {
        await letGo();
        return fail(`its chat could not be made: ${e?.message || e}`);
      }
      // Its chat names the routine (case 18): the row opens it, and the run's end finds it — and the connections' tools it
      // acts through without asking, as the person switched it on (A2c): the turn reads them from here, never the chat.
      mark(chat.id, { routine: { project, id, title: r.title, at, by, ...(startedBy ? { startedBy } : {}), ...(r.acts?.length ? { acts: r.acts } : {}) } });
      if (made) places?.template?.(chat.id, made);
      spaces.routineStarted(project, id, { at, chain: chat.id, by, ...(startedBy ? { startedBy } : {}), on: onWords, ...(instead ? { instead } : {}), ...(events ? { events } : {}), turns: turnsOf(heard) });
      /** @type {{ status: number, body: any }} */
      let res;
      try {
        // The run's chat reads who pressed Run now as another chat's agent reads it: one `apart` says is "an untitled
        // chat" (core/space.js `writerName`).
        const byName = startedBy ? writerName(startedBy.chain, startedBy.byName, { nameOf: () => UNTITLED_CHAT, apart }) : "";
        res = await postTurn(chat.id, { by: "routine", content: [{ type: "text", text: runWords(r, { project: nameOf(project), when: whenOf(r), by, byName, inPlace, heard, packet, now: now() }) }] });
      } catch (/** @type {any} */ e) {
        res = { status: 502, body: { error: String(e?.message || e) } };
      }
      if (res.status < 200 || res.status >= 300) {
        const why = `its turn could not start: ${String(res.body?.error || `HTTP ${res.status}`)}`;
        // Its template still copying in ends first, as a flow's box's does: the worktree is taken back from under no copy
        // (found by the Hunter on S6: the copy still held files in the folder taken back).
        if (made) await Promise.resolve(places?.untemplate?.(chat.id, "its routine's run could not start")).catch(() => {});
        if (remove) await remove(chat.id).catch((/** @type {any} */ e) => log("warn", `routines: the chat of a run that could not start stays (${e?.message || e})`));
        await letGo();
        // The door itself failed (r-itself, 11-12): what a watcher's run took waits again for its next try, on its wait.
        if (heard && doorFailed(res) && spaces.watchBack(project, id, heard)) park(key, r, DOWN);
        return remove ? fail(why) : (spaces.routineEnded(project, id, { at, chain: chat.id, by, ...(startedBy ? { startedBy } : {}), state: "failed", why }), null);
      }
      parked.delete(key);
      log("info", `routines: “${r.title}” of ${project} runs ${by === "you" ? "on the person's Run now" : by === "agent" ? `on ${startedBy?.byName || "a chat"}'s Run now` : by === "event" ? `on ${events === 1 ? "1 event" : `${events} events`}` : "at its time"} (${chat.id}${made ? `, in ${made.folder}` : inPlace ? `, writing in ${folder}` : ""})`);
      return chat.id;
    } finally {
      starting.delete(key);
      // A watcher's events heard while this start was under way wait for its run's end — or, where it could not
      // start, for the timer: nothing else looks at them.
      const after = routineOf(project, id);
      if (after?.pending && after.last?.state !== "running") arm();
    }
  }

  return {
    /** The routines begin: a run the last stop cut is read from its chat, the times missed meanwhile caught up, the timer set. */
    async start() {
      started = true;
      for (const { project, r } of spaces.routinesAll())
        try {
          // A Space whose project is gone was paused as Filament started: its run's chat went with its project, and is
          // no failure to say where nobody sees it (found by the Hunter on A5).
          if (r.last?.state === "running" && !gone(project)) settle(project, r);
        } catch (/** @type {any} */ e) {
          log("warn", `routines: the run of “${r.title}” the last stop cut could not be read (${e?.message || e})`);
        }
      await catchUp("Filament was off");
      arm();
    },
    /** Nothing starts by itself any more. */
    stop() {
      started = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    /** The timer set again: a routine switched on, paused, resumed, removed, put back; Pause all switched. */
    arm,
    /** The times looked at now, as the timer does (the tests'). */
    tick,
    /**
     * Events a watcher's source heard (the plan of 11-11): those new to it wait in the store (`watchHeard`), and its run
     * starts with them now — or, while one of it runs, once that one ends, with whatever came meanwhile. Off, paused or
     * Pause all, it hears none. → how many of them wait for it now.
     * @param {string} project @param {string} id @param {readonly unknown[]} events
     */
    async heard(project, id, events) {
      const took = spaces.watchHeard(project, id, events);
      if (took) await woken(project, id);
      return took;
    },
    /**
     * A chat's turn let go (the server's turn lock), the chat went, or a question a turn of it paused on ended with no
     * answer's turn — it lapsed, the person rewound past it —: every run under way in it has its end read and written;
     * and the watchers that chat held back may send their turn now. The lock lets go too of a turn that failed inside
     * it, and of a post refused there: what ends by it is `letGo`'s to say.
     * @param {string} chainId
     */
    released(chainId) {
      const all = spaces.routinesAll();
      // Each of them: a watcher's turn there, and one before it that a question's end left under way.
      const hits = all.filter(({ r }) => r.last?.state === "running" && r.last.chain === chainId);
      for (const hit of hits)
        try {
          settle(hit.project, hit.r);
        } catch (/** @type {any} */ e) {
          log("warn", `routines: the end of “${hit.r.title}”'s run could not be written (${e?.message || e})`);
        }
      // The watchers this chat proposed, held back — on it, whatever they wake by now —: the wait it gave them is over
      // (`letGo`). Not one whose own post is on its way: a lock that lets go meanwhile ends no wait that post has yet
      // to make.
      let unparked = false;
      /** That chat's newest turn as it stands, read once where a wait of its watchers' asks. @type {string | null | undefined} */
      let turn;
      for (const { project, r } of all) {
        const key = `${project}|${r.id}`;
        if (r.madeIn !== chainId || starting.has(key) || !parked.has(key)) continue;
        if (turn === undefined) turn = standsOf(chainId);
        unparked = letGo(key, turn) || unparked;
      }
      if (hits.length || unparked) arm();
    },
    /**
     * A chat may take a turn of Filament's again with no turn of its own having ended — the room made for it stands
     * (the sessions service's `roomMade`) —: the watchers held back on it send theirs now. @param {string} chainId
     */
    freed(chainId) {
      let unparked = false;
      for (const { project, r } of spaces.routinesAll()) if (r.madeIn === chainId) unparked = letGo(`${project}|${r.id}`) || unparked;
      if (unparked) arm();
    },
    /**
     * The watcher whose turn is at work in a chat it wakes, or on its way there — its wake being sent, its run not
     * written yet —: that chat's events wake no watcher meanwhile (app/watchers/events.js), and its agent starts no
     * run (SA-D10). Null for any other chat: a run's own chat is marked as it is made.
     * @param {string} chainId @returns {{ title: string } | null}
     */
    hostOf(chainId) {
      const w = waking.get(chainId);
      if (w) return { title: w.title };
      const hit = spaces.routinesAll().find(({ r }) => r.last?.state === "running" && r.last.chain === chainId && r.madeIn === chainId);
      return hit ? { title: hit.r.title } : null;
    },
    /**
     * Run now, the person's press (case 12): a routine on runs once, whatever its schedule, Pause all and its project's
     * archive say — refused while a run of it is under way. `startedBy`: an agent's press (HarnessV4_AgentsSpace_Plan
     * SA-D10), the chat whose agent pressed it, which its row and its run's first message name — refused in an
     * archived project, where nothing starts but on the person's own press (r-itself, 11-12). → its run's chat.
     * `again`: the person's Retry of a wake of it that failed, by that turn's number in the chat it wakes (r-doors,
     * 11-12: the page sent the wake's block as the person's message, and it ran in the chat's own mode): the block is
     * read from that chat's record (the sessions service's `wakeOf`) — whoever asks sends none —, and only a turn that
     * keeps this watcher as what woke it goes again.
     * @param {string} project @param {string} id @param {{ chain: string, byName: string } | null} [startedBy]
     * @param {number | null} [again]
     * @returns {Promise<string>}
     */
    async runNow(project, id, startedBy = null, again = null) {
      const r = routineOf(project, id);
      if (!r) throw refused(404, `There is no routine "${String(id).slice(0, 40)}" in this Space.`);
      if (r.state !== "on") throw refused(409, r.state === "proposed" ? `“${r.title}” is not on: its Switch on… says what it does first.` : `“${r.title}” was removed: put it back first.`);
      if (r.wakes === "you") throw refused(409, `“${r.title}” tells only you, in Needs you: it runs nothing.`);
      if (startedBy && spaces.archived(project)) throw refused(409, `${ARCHIVED_AGENT}. Their Run now runs it still.`);
      // A run of it starting — its chat made, its turn not begun — is read from no chat yet.
      if (starting.has(`${project}|${id}`)) throw refused(409, `“${r.title}” is starting now.`);
      if (r.last?.state === "running" && settle(project, r)) throw refused(409, `“${r.title}” is running now: open its run, or stop it there.`);
      if (again != null && r.wakes !== "chat") throw refused(409, `“${r.title}” wakes no chat: there is no wake of it to send again.`);
      // A watcher of the chat that proposed it looks there, with what waits (w5).
      if (r.wakes === "chat") {
        /** @type {{ turn: number, text: string, watch: any } | null} */
        let retried = null;
        if (again != null) {
          let kept = null;
          try {
            kept = sessions.wakeOf?.(r.madeIn, again) ?? null;
          } catch {}
          if (!kept || kept.watch?.id !== r.id) throw refused(409, `Turn ${again} of the chat “${r.title}” wakes is no wake of it that failed: there is nothing to send again.`);
          retried = { turn: again, ...kept };
        }
        const was = r.last?.ended ?? null;
        const woke = await wakeChat(project, id, startedBy ? "agent" : "you", startedBy, retried);
        if (woke) return woke;
        const after = routineOf(project, id);
        if (after?.last?.state === "failed" && after.last.ended !== was) throw refused(502, `“${r.title}” could not wake its chat: ${after.last.why || "it said no more"}`);
        // The door its turn goes through failed, with no failure said anew — said already while it stays shut, or
        // Filament is restarting (r-itself, 11-12): no word of its chat's, which is neither at work nor waiting.
        if (parked.get(`${project}|${id}`)?.why === DOWN)
          throw refused(503, `“${r.title}” could not wake its chat: Filament could not start its turn there now: ${after?.pending ? "what it heard goes at the next try" : "press Run now again in a while"}.`);
        // Held back by a chat the person stopped: that lets go only as they write there again.
        if (parked.get(`${project}|${id}`)?.why === "stopped")
          throw refused(409, `“${r.title}”'s chat was stopped by the person, and Filament starts no turn there until they write in it again: ${after?.pending ? "what it heard goes after their next message there" : "press Run now again after their next message there"}.`);
        throw refused(409, `“${r.title}”'s chat is at work, or waits for the person: ${after?.pending ? "what it heard goes as that lets go" : "press Run now again once that lets go"}.`);
      }
      const chain = await run(project, id, now(), startedBy ? "agent" : "you", startedBy);
      const after = routineOf(project, id);
      if (!chain) throw refused(502, `“${r.title}” could not start: ${after?.last?.why || "it said no more"}`);
      return chain;
    },
    /**
     * A project's routines as its page draws them (screen 11): each as kept, with its row's words — its run under way read
     * from its chat, whether it waits for the person. The removed are left out but for Put back's (`removed`).
     * @param {string} project
     */
    live(project) {
      return spaces.get(project).routines.map((r) => {
        if (r.last?.state !== "running") return { r, live: null };
        try {
          const f = sessions.besideFacts(r.last.chain);
          return { r, live: { busy: f.busy, asking: f.asking } };
        } catch {
          // Its chat is gone — deleted, its archive lost —: the run ends now, as its next time would end it, not "running"
          // until then with an Open that opens nothing (found by the Hunter on S6).
          try {
            settle(project, r);
          } catch (/** @type {any} */ e) {
            log("warn", `routines: the end of “${r.title}”'s run could not be written (${e?.message || e})`);
          }
          return { r: routineOf(project, r.id) || r, live: null };
        }
      });
    },
  };
}

/** @typedef {ReturnType<typeof createRoutines>} Routines */
