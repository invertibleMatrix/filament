// @ts-check
// When a chat's work is its own (the plan of 11-11): the keeper every watcher source asks, so that a watcher is not
// woken by what a chat it would wake did itself — a commit it made (app/watchers/commits.js). One for the server,
// hearing the bus (`listen`) and the hands' list of background commands (`shells`). It judges nothing: which chats
// count to a watcher, and whether a commit falls in one of their times, is each source's.
// A command's time is from its call's start to its end, as its run says them on the bus (a `tool-start` or
// `subagent-tool-start` marked `command`, services/runs.js — Filament's loop's and a coding agent's alike, a
// sub-agent's and a helper's run counted with the chat it is of), less the while it waits for the person's answer. A
// call that ran nothing — refused, declined, vetoed, not run — is none, and one its run's end finds running ended there.
// A command in the background (the hands' list: one that runs here) is its chat's for its first two minutes and, once
// it ended, its last two — whole where it ran four or less (`SHELL_EDGE_MS` says why). A source that meets one listed
// past its first two minutes may wait for its end (`endOf`): as the hands say it, `holdMs` at most.
// A whole turn is a chat's own time (the turns' lock) only where its commands are not all said: a turn no run of the
// chat's own was heard in — so each turn, until its run starts — and a turn of a chat whose session hooks run
// commands, which start unsaid (a helper's run with such hooks is one time whole).
// What a coding agent runs unsaid — its own hooks, its own background shells — is in no time of its chat's.
// A file-writing call (`writesOf`) is kept beside those times and is none of them: from its start to its end, with the
// files its start says (`edits` on the same two events: absolute paths, or only that it writes), read by the rules a
// command's call is — for a source that hears of files changed. What lands in a repository while a chat edits a file
// is not that chat's by it.
import { POLL_MS } from "../../adapters/git/watch.js";
import { TURN_RUNS } from "../sessions/cut-turns.js";

/** The turns and the commands kept of a chat (its file-writing calls as its commands), and of how many chats, at most; and how long an ended one is kept. */
const TURNS_KEPT = 20;
const COMMANDS_KEPT = 200;
const CHATS_KEPT = 500;
const TURN_KEPT_MS = 24 * 60 * 60_000;
/** The runs under way whose chat is kept, at most. */
const RUNS_KEPT = 500;
/**
 * How much of a background command's start and of its end is its chat's own time. The commands agents start in the
 * background are mostly a dev server, a watcher of tests or a tail of a log: up for hours, committing nothing. Taken
 * whole, one would leave its chat's watchers deaf to every commit made meanwhile, the person's too, for as long as it
 * runs. One that commits does so near its end, a chain such as `npm test && git commit`, or is a short script: its
 * first and last two minutes hold those, and a commit in the middle of a long one is heard once, which the wake limit
 * bounds — a watcher that tells once too often is the lesser harm.
 */
export const SHELL_EDGE_MS = 120_000;

/**
 * @typedef {{ from: number, to: number | null }} Time  a time of a chat's own: when it began and ended (null: on now)
 * @typedef {{ from: number, to: number | null, ran?: boolean, hooks?: boolean }} Worked  a turn of a chat: when its lock
 *   was taken and let go (null: at work now); `ran`: a run of the chat's own was heard in it, so its commands are said;
 *   `hooks`: that run's session hooks run commands, which are not
 * @typedef {{ from: number, to: number | null, held?: boolean, shell?: boolean }} Ran  a command of a chat's: when it
 *   started and ended (null: running now); `held`: it waits for the person's answer, and runs nothing meanwhile;
 *   `shell`: it runs in the background, its own time its edges (`SHELL_EDGE_MS`)
 * @typedef {{ from: number, to: number | null, held?: boolean, paths: string[] | null }} Wrote  a file-writing call of a
 *   chat's: when it started and ended (null: running now); `held`: as a command's; `paths`: the files its start said,
 *   absolute, or null where it said only that it writes
 * @typedef {{ turns: Worked[], commands: Map<string, Ran>, writes: Map<string, Wrote> }} Chat  a chat's turns, newest
 *   last, and its commands by key: a call's (`call`, its run, its id), a helper's run whole (`run`, its id), a
 *   background command's (`shell`, its id); and its file-writing calls, each by its call's key
 */

/**
 * @param {{ now?: () => number, log?: (level: string, msg: string) => void, holdMs?: number }} [deps]
 *   `holdMs`: how long a wait for a background command's end lasts at most (`endOf`), a poll of a branch's watch.
 */
export function createOwnTimes({ now = Date.now, log = () => {}, holdMs = POLL_MS } = {}) {
  /** Each chat's turns, commands and file-writing calls, the chat heard of last at the end. @type {Map<string, Chat>} */
  const chats = new Map();
  /** The chat each run under way is of. @type {Map<string, string>} */
  const runs = new Map();
  /** The waits for a background command's end, by its chat and its key there (`endOf`). @type {Map<string, Set<() => void>>} */
  const ending = new Map();
  let stopped = false;

  /**
   * A chat's own times: each command of it that runs or ran, and each turn whose commands are not all said — none of
   * its own runs heard in it, or one whose session hooks run commands.
   * @param {Chat} c @returns {Time[]}
   */
  const timesIn = (c) => [...[...c.commands.values()].flatMap((x) => (x.held ? [] : x.shell ? edgesOf(x) : [x])), ...c.turns.filter((t) => !t.ran || t.hooks)].map((t) => ({ from: t.from, to: t.to }));
  /**
   * A background command's own times: its first two minutes, and once it ended its last two — whole where it ran four or
   * less. @param {Ran} x
   */
  const edgesOf = (x) =>
    x.to === null ? [{ from: x.from, to: x.from + SHELL_EDGE_MS }] : x.to - x.from <= 2 * SHELL_EDGE_MS ? [x] : [{ from: x.from, to: x.from + SHELL_EDGE_MS }, { from: x.to - SHELL_EDGE_MS, to: x.to }];
  /**
   * Until one of the background commands `keys` ended — as the hands say it (`shells`) —, `holdMs` passed, or the
   * keeper stopped. @param {string[]} keys  each as `chatsSince` gives it @returns {Promise<void>}
   */
  const endOf = (keys) =>
    new Promise((ok) => {
      if (stopped) return ok();
      const done = () => {
        clearTimeout(t);
        for (const k of keys) {
          const set = ending.get(k);
          set?.delete(done);
          if (set && !set.size) ending.delete(k);
        }
        ok();
      };
      const t = setTimeout(done, holdMs);
      for (const k of keys) ending.set(k, (ending.get(k) || new Set()).add(done));
    });

  /** A chat's times, the chat now the one heard of last: those heard of longest ago go past `CHATS_KEPT`. @param {string} chain */
  const chatFor = (chain) => {
    const c = chats.get(chain) || { turns: [], commands: new Map(), writes: new Map() };
    chats.delete(chain);
    chats.set(chain, c);
    for (const k of chats.keys()) {
      if (chats.size <= CHATS_KEPT) break;
      chats.delete(k);
    }
    return c;
  };
  /** @param {string} chain @param {number} at */
  const began = (chain, at) => {
    // A lock said again while its turn is at work — a phase of it — begins none.
    if (chats.get(chain)?.turns.at(-1)?.to === null) return;
    const c = chatFor(chain);
    c.turns = [...c.turns.filter((t) => t.to == null || at - t.to < TURN_KEPT_MS), { from: at, to: null }].slice(-TURNS_KEPT);
  };
  /** @param {string} chain @param {number} at */
  const ended = (chain, at) => {
    const open = chats.get(chain)?.turns.at(-1);
    if (open && open.to === null) open.to = at;
  };
  /**
   * One more among a chat's commands, or among its file-writing calls. Those that ended a day ago go, and ended ones
   * past `COMMANDS_KEPT`, oldest first: never one that runs.
   * @template {Ran | Wrote} X @param {Map<string, X>} kept @param {string} key @param {X} x
   */
  const keep = (kept, key, x) => {
    for (const [k, old] of kept) if (old.to != null && (x.from - old.to >= TURN_KEPT_MS || kept.size >= COMMANDS_KEPT)) kept.delete(k);
    kept.set(key, x);
  };
  /**
   * A command of a chat's begins.
   * @param {string} chain @param {string} key @param {number} from @param {boolean} [shell]  it runs in the background
   */
  const ranFrom = (chain, key, from, shell = false) => keep(chatFor(chain).commands, key, { from, to: null, ...(shell ? { shell: true } : {}) });
  /**
   * What a call's start says it writes (`edits`): its files, each an absolute path; null where it says only that it
   * writes — `true`, or a list that is not paths alone; undefined where it says no file-writing call.
   * @param {unknown} edits @returns {string[] | null | undefined}
   */
  const pathsSaid = (edits) => (Array.isArray(edits) ? (edits.length && edits.every((p) => typeof p === "string" && p) ? [...edits] : null) : edits === true ? null : undefined);
  /** A helper's run whole, by its key in its chat's commands; with `id`, a call of a run. @param {string} run @param {string} [id] */
  const keyIn = (run, id) => (id === undefined ? `run\n${run}` : `call\n${run}\n${id}`);
  /**
   * One event of a run, as the bus carries it (services/runs.js): the chat it is of from its start, each call marked
   * `command` a time of that chat's from its start to its end, and each that says `edits` a file-writing call of it
   * over the same while. A call that ran nothing — refused, declined, vetoed, not run — is none; one that waits for
   * the person's answer begins as it is answered; one its run's end finds running ended there.
   * @param {string} run @param {any} p @param {number} [at]
   */
  const runEvent = (run, p, at = now()) => {
    if (!run || !p || typeof p.type !== "string") return;
    if (p.type === "run-start") {
      const chain = typeof p.meta?.chain === "string" ? p.meta.chain : "";
      if (!chain) return;
      runs.delete(run);
      runs.set(run, chain);
      for (const k of runs.keys()) {
        if (runs.size <= RUNS_KEPT) break;
        runs.delete(k);
      }
      const hooks = p.meta.hooks === true;
      if (TURN_RUNS.includes(p.kind)) {
        // The chat's own turn's run: its commands are said from here on — its session hooks' aside.
        const open = chats.get(chain)?.turns.at(-1);
        if (open && open.to === null) {
          open.ran = true;
          if (hooks) open.hooks = true;
        }
      } else if (hooks) ranFrom(chain, keyIn(run), at);
      return;
    }
    const chain = runs.get(run);
    const chat = chain ? chats.get(chain) : undefined;
    // A call's end, its answer and its run's end are read alike of a command and of a file-writing call.
    const calls = chat ? [chat.commands, chat.writes] : [];
    if (p.type === "run-end") {
      runs.delete(run);
      for (const kept of calls)
        for (const [k, x] of kept) {
          if (x.to !== null || !(k === keyIn(run) || k.startsWith(keyIn(run, "")))) continue;
          if (x.held) kept.delete(k);
          else x.to = at;
        }
      return;
    }
    if (!chain) return;
    if (p.type === "tool-start" || p.type === "subagent-tool-start") {
      if (p.id == null) return;
      const key = keyIn(run, String(p.id));
      if (p.command === true) ranFrom(chain, key, at);
      const paths = pathsSaid(p.edits);
      if (paths !== undefined) keep(chatFor(chain).writes, key, { from: at, to: null, paths });
      return;
    }
    if (p.type === "tool-end" || p.type === "subagent-tool-end") {
      const key = keyIn(run, String(p.id));
      for (const kept of calls) {
        const x = kept.get(key);
        if (!x || x.to !== null) continue;
        if (x.held || p.refused || p.declined || p.vetoed || p.notRun) kept.delete(key);
        else x.to = at;
      }
      return;
    }
    if ((p.type === "ask" || p.type === "ask-end") && p.call != null) {
      for (const kept of calls) {
        const x = kept.get(keyIn(run, String(p.call)));
        if (!x || x.to !== null) continue;
        x.held = p.type === "ask";
        if (!x.held) x.from = at;
      }
    }
  };
  /**
   * A chat's background commands that run here now (the hands' list, said at each start and end): each from its start,
   * ended once it is listed no more — as the hands say it, the moment they set its end. One on another machine makes
   * nothing here.
   * @param {string} chain @param {readonly { id: string, startedAt: number, machine?: string }[]} running @param {number} [at]
   */
  const shells = (chain, running, at = now()) => {
    const here = running.filter((s) => s && !s.machine);
    const had = chats.get(chain)?.commands;
    if (!chain || (!here.length && !had)) return;
    const on = new Set(here.map((s) => `shell\n${s.id}`));
    for (const s of here) if (!had?.has(`shell\n${s.id}`)) ranFrom(chain, `shell\n${s.id}`, Number(s.startedAt) || at, true);
    for (const [k, x] of had || []) {
      if (!k.startsWith("shell\n") || x.to !== null || on.has(k)) continue;
      x.to = at;
      // A source that waits for its end judges now.
      for (const done of [...(ending.get(`${chain}\n${k}`) || [])]) done();
    }
  };

  return {
    /** A chat's turn began, or ended: its lock taken or let go. */
    turnBegan: (/** @type {string} */ chain, at = now()) => began(chain, at),
    turnEnded: (/** @type {string} */ chain, at = now()) => ended(chain, at),
    runEvent,
    shells,
    /**
     * Hear the bus: the turns' lock and every run's events, so each chat's commands — and its turns, where they are
     * not all said — are known for the times its work is its own in, and its file-writing calls beside them.
     * @param {{ subscribe: (topic: string, fn: (payload: any, entry: { ts: number, topic: string }) => void) => () => void }} bus
     */
    listen(bus) {
      return bus.subscribe("*", (p, entry) => {
        try {
          const topic = String(entry?.topic || "");
          if (topic.startsWith("run:")) return void runEvent(topic.slice(4), p, entry?.ts || now());
          if (topic !== "turns" || p?.type !== "turn" || !p.chainId) return;
          if (p.holder) began(String(p.chainId), entry?.ts || now());
          else ended(String(p.chainId), entry?.ts || now());
        } catch (/** @type {any} */ x) {
          log("warn", `watchers: a turn's lock or a run's event was not heard (${x?.message || x})`);
        }
      });
    },
    /** The times a chat's work is its own in, as kept now. @param {string} chain @returns {Time[]} */
    timesOf: (chain) => {
      const c = chats.get(chain);
      return c ? timesIn(c) : [];
    },
    /**
     * A chat's file-writing calls, as kept now: each from its start to its end (null: running now) with the files its
     * start said, absolute — null where it said only that it writes, so any file may be its own in that while. One
     * that waits for the person's answer is none until answered.
     * @param {string} chain @returns {{ from: number, to: number | null, paths: string[] | null }[]}
     */
    writesOf: (chain) => [...(chats.get(chain)?.writes.values() || [])].filter((x) => !x.held).map((x) => ({ from: x.from, to: x.to, paths: x.paths && [...x.paths] })),
    /**
     * Each chat that has a time since `since` — one on now, or ended then or later — or a background command listed
     * now, for a source to pick those that count to it: those times, and those commands, each by the key a wait for its
     * end takes (`endOf`) and from when it runs.
     * @param {number} since @returns {{ chain: string, times: Time[], running: { key: string, from: number }[] }[]}
     */
    chatsSince: (since) =>
      [...chats].flatMap(([chain, chat]) => {
        const times = timesIn(chat).filter((t) => (t.to ?? Infinity) >= since);
        const running = [...chat.commands].filter(([, x]) => x.shell && x.to === null).map(([k, x]) => ({ key: `${chain}\n${k}`, from: x.from }));
        return times.length || running.length ? [{ chain, times, running }] : [];
      }),
    endOf,
    /** Every wait over, and none begun after (the server's stop). */
    stop() {
      stopped = true;
      for (const set of [...ending.values()]) for (const done of [...set]) done();
    },
  };
}

/** @typedef {ReturnType<typeof createOwnTimes>} OwnTimes */
