// @ts-check
// Filament's own events, heard by the watchers (the plan of 11-11, its w2). Each source says what happened, typed
// (core/watchers.js `FilamentEvent`): a chat's turn ended — the files its rounds wrote, the tasks it marked done —, a
// task of its graph became done, failed or blocked — a diff of the graph each time it is kept —, a question waited for
// the person past a watcher's minutes, a command of its agent failed, a sub-agent of it reported. Each goes to the
// watchers of the chat's project that are on and whose trigger picks it (`picks`): a filter set once, never a model
// reading every event, never the person's words. What they heard waits in the store, coalesced, for their run
// (app/routines.js `heard`): all a watcher picks of one change in one hearing, so it wakes once. A chat whose events
// wake none: one of no project, archived, a helper's, another machine's agents', a routine's own run — a run wakes no
// watcher, as no run starts another (SA-D10) —, and a chat while a watcher's turn is at work in it (`hosted`): what
// that turn does wakes neither the watcher itself nor another, which would answer it turn for turn.
// Whose words an event carries: a chat whose words are its own alone (`quiet`: memory keeps its turns to itself, or
// its newest turn was kept apart) is heard by any reader but itself as what happened, with none of what it said, and
// under the name that reader reads (core/space.js `readerNames`); the chat a watcher wakes reads its own in full. Each
// such event is marked so (`quiet`): the answer of a turn that read it is never quoted to the Space.
// The run events ride the bus Filament already publishes (`listen`); a turn's end, a graph's keep, a background shell's
// failure and a sub-agent's end are said here by their sources. Not heard: a background sub-agent's question once its
// parent's run has ended (its run carries it no more), a coding agent's own background commands (Filament runs none of
// them), a question that waited through a restart — what waits is kept in memory, from the moment it is heard —, and
// most turns of a client's own chat: it has no rounds of Filament's, so only a watcher of every turn hears its ends.
import { readerNames } from "../../core/space.js";
import { graphChanges, picks, watchEventOf } from "../../core/watchers.js";

/** How often a question still waiting is weighed against the watchers' minutes, while one waits. */
export const ASK_CHECK_MS = 60_000;
/** What is kept in memory, at most: the runs whose chat is known, the questions waiting, a chat's marks between turns. */
const RUNS_KEPT = 500;
const ASKS_KEPT = 200;
const MARKS_KEPT = 50;
const CHATS_KEPT = 500;

/**
 * @typedef {import("../../core/watchers.js").FilamentEvent} FilamentEvent
 * @typedef {{ own?: unknown, before?: unknown, after?: unknown }} Round  a writing round of a turn, as memory keeps it
 *   (`roundsOf`): the files its agent wrote, and the place's tree before and after
 * @typedef {{ chain: string, ask: string, at: number, words: string, run: string | null, ends: "id" | "state" | "turn" }} Waiting
 *   a question waiting for the person: its id among the chat's, since when, its words, and what ends it — its own end
 *   (`id`: an ask-end by its id, a sub-agent's ask-end), the run's next state (`state`: a call that waits in place), or
 *   the chat's next turn (`turn`: the loop's turn that paused on it); its run's end ends all but the last
 */

/**
 * @param {{ store: { routinesAll: () => { project: string, r: import("../../core/routines.js").Routine }[] },
 *   heard: (project: string, id: string, events: readonly unknown[]) => Promise<number> | number,
 *   chatOf: (chain: string) => { project: string | null } | null,
 *   nameOf: (chain: string) => string,
 *   apart?: (chain: string) => boolean,
 *   quiet?: (chain: string) => boolean,
 *   hosted?: (chain: string) => boolean,
 *   roundsOf?: (chain: string, turn: number) => Round[],
 *   now?: () => number, log?: (level: string, msg: string) => void, askCheckMs?: number }} deps
 *   `chatOf`: the chat's project, or null where its events wake no watcher (see the head of this file). `apart`: a
 *   chat no other chat's agent reads by name (`readerNames`); `quiet`: one whose words are its own alone now;
 *   `hosted`: a watcher's turn is at work in the chat, or on its way to it (app/routines.js `hostOf`).
 */
export function createWatchEvents({ store, heard, chatOf, nameOf, apart = () => false, quiet = () => false, hosted = () => false, roundsOf = () => [], now = Date.now, log = () => {}, askCheckMs = ASK_CHECK_MS }) {
  /** Each chat's tasks marked done since its last turn ended, with when. @type {Map<string, { id: string, at: number }[]>} */
  const marks = new Map();
  /**
   * The runs heard starting, by id: the chat each is of, whether it is a helper's (a sub-agent's, a second look's), and
   * whether a coding agent runs it, whose commands may end failed with no exit said.
   * @type {Map<string, { chain: string, helper: boolean, coder: boolean }>}
   */
  const runs = new Map();
  /** The questions waiting for the person, by their key. @type {Map<string, Waiting>} */
  const asks = new Map();
  /** The check of the questions waiting, armed while one does. @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** The hearings under way, for the tests to wait on. @type {Set<Promise<unknown>>} */
  const hearing = new Set();

  /** @param {Map<string, unknown>} m @param {number} max */
  const capped = (m, max) => {
    for (const k of m.keys()) {
      if (m.size <= max) break;
      m.delete(k);
    }
  };

  /**
   * Events of one chat that one change brought, to every watcher of its project that is on: each hears those it picks,
   * all in one hearing, worded for whoever reads what it hears. → how many were picked, over all the watchers.
   * @param {string} chain @param {FilamentEvent[]} evs
   */
  function publishAll(chain, evs) {
    const c = chain && evs.length ? chatOf(chain) : null;
    if (!c?.project || hosted(chain)) return 0;
    let n = 0;
    const at = now();
    const hush = quiet(chain);
    for (const { project, r } of store.routinesAll()) {
      const t = r.trigger;
      if (project !== c.project || !t || r.state !== "on" || r.paused) continue;
      const picked = evs.filter((e) => picks(t, e, at));
      if (!picked.length) continue;
      n += picked.length;
      // Who reads what it hears: the chat it wakes, which reads its own chat whole; else a run's new chat or the
      // Space's Needs you, which read another chat as any other chat's agent does.
      const reader = r.wakes === "chat" ? r.madeIn : "";
      const names = readerNames({ nameOf, apart }, reader);
      // Marked where the chat's words are its own alone, whoever reads it (`quiet` on the event): the chat itself reads
      // them whole, so what its turn answers is not the Space's to quote (app/routines.js `settle`).
      const said = picked.map((e) => ({ ...watchEventOf(e, t, names.nameOf, { quiet: hush && reader !== chain }), ...(hush ? { quiet: true } : {}) }));
      const p = Promise.resolve()
        .then(() => heard(project, r.id, said))
        .catch((/** @type {any} */ x) => log("warn", `watchers: “${r.title}” of ${project} did not hear ${said.length === 1 ? `a ${said[0].kind} event` : `${said.length} events`} (${x?.message || x})`))
        .finally(() => hearing.delete(p));
      hearing.add(p);
    }
    return n;
  }
  /**
   * One event of a chat (`publishAll`). A connection's news is no chat's: its watcher hears it from its own ask
   * (app/watchers/connection.js). @param {FilamentEvent} e
   */
  const publish = (e) => (e.chain ? publishAll(e.chain, [e]) : 0);
  /** Whether a watcher of turns that is on could pick this chat's: one of its project, naming it or none. @param {string} chain */
  const turnWatched = (chain) => {
    const c = chatOf(chain);
    return !!c?.project && store.routinesAll().some(({ project, r }) => project === c.project && r.state === "on" && !r.paused && r.trigger?.kind === "turn" && (!r.trigger.chat || r.trigger.chat === chain));
  };

  /** @param {string} chain @param {string[]} ids */
  const mark = (chain, ids) => {
    const at = now();
    const had = marks.get(chain) || [];
    // Kept newest last: the chats past the cap are the ones marked longest ago.
    marks.delete(chain);
    marks.set(chain, [...had, ...ids.map((id) => ({ id, at }))].slice(-MARKS_KEPT));
    capped(marks, CHATS_KEPT);
  };

  /**
   * The questions waiting: each weighed against the watchers' minutes now, the check armed again while one waits. One
   * whose chat wakes no watcher any more — deleted, archived — waits no longer.
   */
  const check = () => {
    timer = null;
    for (const [key, a] of [...asks]) {
      try {
        if (!chatOf(a.chain)?.project) {
          asks.delete(key);
          continue;
        }
        publish({ kind: "ask", chain: a.chain, at: a.at, ask: a.ask, words: a.words });
      } catch (/** @type {any} */ x) {
        log("warn", `watchers: a question of ${a.chain} was not weighed (${x?.message || x})`);
      }
    }
    arm();
  };
  const arm = () => {
    if (timer || !asks.size) return;
    timer = setTimeout(check, askCheckMs);
    timer.unref?.();
  };
  /**
   * A question waits, kept only where its chat's events may wake a watcher. Past the cap, the newest is not kept: those
   * waiting longest are nearest their minutes.
   * @param {string} key @param {Waiting} a
   */
  const waits = (key, a) => {
    if (!chatOf(a.chain)?.project || (asks.size >= ASKS_KEPT && !asks.has(key))) return;
    asks.set(key, a);
    arm();
  };
  /** @param {(a: Waiting, key: string) => boolean} which */
  const over = (which) => {
    for (const [k, a] of [...asks]) if (which(a, k)) asks.delete(k);
    if (!asks.size && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /**
   * A run's event, as the bus carries it on `run:<id>`. Its start names its chat; a helper's run says nothing here — a
   * sub-agent's questions reach its parent's run, its end is `subagentEnded`'s.
   * @param {string} run @param {any} p @param {number} ts
   */
  function runEvent(run, p, ts) {
    if (!p || typeof p !== "object") return;
    if (p.type === "run-start") {
      const chain = typeof p.meta?.chain === "string" ? p.meta.chain : "";
      if (chain) runs.set(run, { chain, helper: !!(p.brief || p.parentId || p.meta?.second || p.meta?.weighs), coder: typeof p.meta?.engine === "string" });
      capped(runs, RUNS_KEPT);
      return;
    }
    const of = runs.get(run);
    if (p.type === "run-end") {
      runs.delete(run);
      over((a) => a.run === run && a.ends !== "turn");
      return;
    }
    if (!of || of.helper) return;
    const at = Number(ts) || now();
    if (p.type === "ask" && p.kind !== "lead") {
      // A permission on another machine says its words in its form alone.
      const words = String(p.question || p.form?.title || p.form?.questions?.[0]?.prompt || "");
      if (p.id != null) waits(`${run}\n${p.id}`, { chain: of.chain, ask: `${run}:${p.id}`, at, words, run, ends: "id" });
      else if (p.waits) waits(`${run}\nwaits`, { chain: of.chain, ask: `${run}:${p.round ?? 0}`, at, words, run, ends: "state" });
      else waits(`turn\n${of.chain}`, { chain: of.chain, ask: `${run}:${p.round ?? 0}`, at, words, run, ends: "turn" });
    } else if (p.type === "ask-end") over((_, k) => k === `${run}\n${p.id}`);
    else if (p.type === "turn-state" && p.from === "waiting") over((a, k) => k === `${run}\nwaits`);
    else if (p.type === "subagent-ask" && p.to !== "lead") {
      const id = `${p.agentId}:${p.ask ?? 0}`;
      waits(`${run}\n${id}`, { chain: of.chain, ask: id, at, words: String(p.question || ""), run, ends: "id" });
    }
    // A worker waits on one question at a time, and its end names none: all of that worker's are over.
    else if (p.type === "subagent-ask-end") over((_, k) => k.startsWith(`${run}\n${p.agentId}:`));
    else if (p.type === "tool-end") shellEnd(of, run, p, at);
  }

  /** A turn of the chat took it (the turns' lock): a question its last turn paused on is answered, or passed by. @param {string} chain */
  const turnBegan = (chain) => over((a) => a.chain === chain && a.ends === "turn");

  /**
   * A command the chat's agent ran in its turn, ended: a failure is one where it ran and exited other than 0 — never one
   * the person or Filament stopped, refused or sent to the background, whose end is told as a background shell's. A
   * coding agent may say a command failed with no exit (Claude's status alone); Filament's own loop says each exit, so
   * one of its with none never ran.
   * @param {{ chain: string, coder: boolean }} of @param {string} run @param {any} p @param {number} at
   */
  function shellEnd(of, run, p, at) {
    if (p.card?.kind !== "shell" || p.card?.title !== "Run") return;
    if (p.stopped || p.refused || p.declined || p.notRun || p.background || p.vetoed) return;
    const exit = typeof p.exitCode === "number" ? p.exitCode : null;
    if (exit === 0 || (exit === null && (p.ok !== false || !of.coder))) return;
    publish({ kind: "shell", chain: of.chain, at, id: `${run}:${p.id ?? ""}`, command: String(p.card?.subject || p.args || ""), exit });
  }

  return {
    publish,
    runEvent,
    /**
     * A turn of the chat ended (the sessions service, every engine's; a client's chat by memory): its number, whether
     * it failed or the person stopped it, the files its rounds wrote and whether its folder changed, the tasks of its
     * graph marked done since `since` — its start: its agent's, and a check's or a worker's that ended meanwhile; all
     * since the turn before where none is said.
     * @param {string} chain @param {{ turn: number | null, failed?: boolean, stopped?: boolean, since?: number | null }} t
     */
    turnEnded(chain, { turn, failed = false, stopped = false, since = null }) {
      const done = [...new Set((marks.get(chain) || []).filter((m) => since == null || m.at >= since).map((m) => m.id))];
      marks.delete(chain);
      // A question a turn before this one paused on is over: this turn went on past it.
      if (since != null) over((a) => a.chain === chain && a.ends === "turn" && a.at < since);
      // Its rounds are a read of the archive: made only where a watcher of turns could pick this chat's, and never for
      // a watcher's own turn there, which wakes none.
      if (!turnWatched(chain) || hosted(chain)) return 0;
      /** @type {Round[]} */
      let rounds = [];
      try {
        rounds = turn != null ? roundsOf(chain, turn) : [];
      } catch (/** @type {any} */ x) {
        log("warn", `watchers: the rounds of ${chain}'s turn ${turn} could not be read (${x?.message || x})`);
      }
      const files = new Set(rounds.flatMap((r) => (Array.isArray(r.own) ? r.own.map(String) : []))).size;
      const tree = rounds.some((r) => typeof r.before === "string" && typeof r.after === "string" && r.before !== r.after);
      return publish({ kind: "turn", chain, at: now(), turn, failed, stopped, files, tree, done });
    },
    /**
     * A chat's graph kept (graph-runner `keep`): the tasks that became done, failed or blocked, each an event, heard
     * together; those marked done counted for the turn's end.
     * @param {string} chain @param {import("../../core/task-graph.js").Graph | null} was @param {import("../../core/task-graph.js").Graph} next
     */
    graphKept(chain, was, next) {
      const ch = graphChanges(was, next);
      if (ch.marked.length) mark(chain, ch.marked);
      const at = now();
      publishAll(chain, ch.tasks.map((t) => ({ kind: /** @type {const} */ ("task"), chain, at, graph: next.startedAt, ...t })));
    },
    turnBegan,
    /** The question a turn of the chat paused on ended with no answer's turn (`question-over`). @param {string} chain */
    questionOver: turnBegan,
    /**
     * A background command of the chat's agent failed (adapters/tools/hands.js `onShellFailed`): its exit, not 0.
     * @param {{ chain: string, id: string, command: string, exit: number | null }} s
     */
    shellFailed({ chain, id, command, exit }) {
      return publish({ kind: "shell", chain, at: now(), id: `bg:${id}`, command, exit });
    },
    /**
     * A sub-agent's exchange ended (the registry's `exchangeEnded`): its report, or how it ended. A helper's — a second
     * look, a fork weighing the person's message — reports to no watcher.
     * @param {{ chain: string, agent: string, exchange: number, description: string, ok: boolean, status: string, report: string, helper?: boolean }} s
     */
    subagentEnded({ helper = false, ...s }) {
      if (helper) return 0;
      return publish({ kind: "subagent", at: now(), ...s });
    },
    /**
     * Hear the bus: each run's events, the turns' lock taken, a question over.
     * @param {{ subscribe: (topic: string, fn: (payload: any, entry: { ts: number, topic: string }) => void) => () => void }} bus
     */
    listen(bus) {
      return bus.subscribe("*", (p, entry) => {
        try {
          if (entry.topic.startsWith("run:")) runEvent(entry.topic.slice(4), p, entry.ts);
          // A question the loop's turn paused on is over as the chat's next turn takes it, or as it ends unanswered.
          else if (entry.topic === "turns" && p?.type === "turn" && p.holder && p.chainId) turnBegan(String(p.chainId));
          else if (entry.topic === "compactions" && p?.type === "question-over" && p.chainId) turnBegan(String(p.chainId));
        } catch (/** @type {any} */ x) {
          log("warn", `watchers: a ${entry.topic} event was not heard (${x?.message || x})`);
        }
      });
    },
    /** The questions waiting, as the check weighs them (the tests'). */
    waiting: () => [...asks.values()],
    /** The check of the questions waiting, now (the tests'). */
    check,
    /** Every hearing under way, settled (the tests'). */
    settled: () => Promise.all([...hearing]),
    /** Stop the check (the server's stop). */
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      asks.clear();
    },
  };
}

/** @typedef {ReturnType<typeof createWatchEvents>} WatchEvents */
