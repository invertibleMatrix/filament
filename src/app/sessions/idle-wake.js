// @ts-check
// The idle wake (the owner's of 11-08: "if filament goes idle when you stop the turn, filament needs to wake it back up
// after let's say 5 minutes so that you are not stuck forever. a lot of devs leave agents running overnight"; narrowed:
// "not wake up on open tasks but just when background command is running. agent can keep tasks open and still end
// turn"). A chat's agent that ends its turn while a background command of its own runs — one it started, or one the
// person sent to the background — is told after the minutes set (`sessions.idleWakeMinutes`, 5 by default, 0 off) that
// the command still runs with no end, so it can say where it stands, wait on, or stop one that hangs: told as a
// shell's exit is (hands.js `tellLater`, kind `idle`), and the waker sends the chat its turn (wake.js). Only where the
// command still runs and nothing else came: anything that starts a turn first — the command's end, the person's
// message, a report, a letter, a come_back — cancels it, and a chat the person stopped, with a question waiting, or
// with another wake due or on its way is not told (`blocked`), its check-in set again. Idle wakes in a row with nothing
// else between them wait twice as long each, to an hour: a command that hangs all night costs a dozen turns, not a
// hundred. Each chat keeps its timer across a restart (`kept`, sessions/owed-wakes.js; the nudge map of 11-10: "Nothing
// wakes a chat after a restart"), and the start arms it again at its time (`restore`): the commands it was set for ran
// under the Filament that stopped, which ended them, so as its time comes the agent is told that in place of a check-in
// on them.

/** The minutes an agent is left idle with a command running, where none is set. */
export const IDLE_WAKE_MIN = 5;
/** The most it is left: the setting's ceiling, and the back-off's. */
export const IDLE_WAKE_MAX_MIN = 60;
/**
 * How many check-ins in a row a wake owed that nothing sends may hold back before one is told all the same (`blocked`'s
 * "owed"; the review of 11-11). One such wake may still be on its way — the room made for the chat asks it again —, so
 * the first two are set again; past them it is one the waker gave up on, or the start's sweep let be.
 */
const OWED_HOLDS = 2;
/** The most of a command's line the words name, and how many commands they list. */
const COMMAND_CHARS = 80;
const LISTED = 3;

/**
 * @typedef {{ id: string, command: string, startedAt: number }} IdleCommand  a background command still running
 * @typedef {{ at: number, commands: IdleCommand[] }} IdleWake  when the chat is told, and of what, as the page shows it
 * @typedef {{ id: number, at: number, since?: number, waitMin: number, streak: number, commands: IdleCommand[] }} KeptIdleWake  a chat's
 *   timer as the chat keeps it for a restart: its id, when, when the turn it was set for ended (`since`; where none was
 *   kept, its time less its wait), its wait, the back-off's step, what ran as it was set
 * @typedef {ReturnType<typeof createIdleWaker>} IdleWaker
 */

/** The setting as minutes: 5 where none is set or it does not read, 0 (and below) off, else whole minutes from 1 to 60. @param {unknown} v */
export function idleWakeMinutes(v) {
  const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
  if (v == null || v === "" || !Number.isFinite(n)) return IDLE_WAKE_MIN;
  if (n <= 0) return 0;
  return Math.min(IDLE_WAKE_MAX_MIN, Math.max(1, Math.round(n)));
}

/** The wait before the idle wake after `streak` of them in a row: twice as long each, to an hour. @param {number} base @param {number} streak */
export const idleWaitMinutes = (base, streak) => Math.min(IDLE_WAKE_MAX_MIN, base * 2 ** Math.max(0, streak));

/** How long, in words: "1 min", "20 min", "1 h", "1 h 30 min". @param {number} ms */
const spanOf = (ms) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};
/** A command's line as the words name it: its first line, no backtick to break the quote, cut. @param {string} c */
const lineOf = (c) => {
  const one = String(c || "").split(/\r?\n/)[0].replace(/`/g, "'").trim();
  return one.length > COMMAND_CHARS ? `${one.slice(0, COMMAND_CHARS - 1)}…` : one;
};

/**
 * What the agent is told, in Filament's words: how long since its turn ended, each command still running — its line,
 * its id, how long it has run —, and when Filament checks in again if it keeps running. Never whether anything else
 * came meanwhile: a letter or a word of the person's can wait beside it, and the wake's own line says which.
 * @param {readonly IdleCommand[]} commands @param {{ idleMin: number, nextMin: number, now: number }} o
 */
export function idleText(commands, { idleMin, nextMin, now }) {
  const each = commands.slice(0, LISTED).map((c) => `\`${lineOf(c.command)}\` (${c.id}, running ${spanOf(now - c.startedAt)})`);
  const more = commands.length > LISTED ? `; and ${commands.length - LISTED} more` : "";
  const which = commands.length === 1 ? "your background command still runs" : `your ${commands.length} background commands still run`;
  return `[Filament: ${idleMin} min since your turn ended, ${which} with no end: ${each.join("; ")}${more}. If it keeps running, Filament checks in again in ${nextMin} min.]`;
}

/**
 * What the agent is told where its check-in was set before a restart (`restore`) and nothing of its runs now: each
 * command it was set for — its line, its id — ran under the Filament that stopped, which ended it, so its result will
 * not come. @param {readonly IdleCommand[]} commands @param {{ idleMin: number }} o
 */
export function idleGoneText(commands, { idleMin }) {
  const each = commands.slice(0, LISTED).map((c) => `\`${lineOf(c.command)}\` (${c.id})`);
  const more = commands.length > LISTED ? `; and ${commands.length - LISTED} more` : "";
  const which = commands.length === 1 ? "the background command you left running" : `the ${commands.length} background commands you left running`;
  const them = commands.length === 1 ? "it, and its result" : "them, and their results";
  return `[Filament: ${idleMin} min since your turn ended, and Filament restarted meanwhile: ${which} ran under the Filament that stopped, which ended ${commands.length === 1 ? "it" : "them"} — ${each.join("; ")}${more}. Filament no longer follows ${them} will not come. Say in a line where your work stands, then start again what you still need, or go on with your work.]`;
}

/**
 * What the agent is told in place of a check-in told before a restart that had not reached it (sessions/owed-wakes.js
 * `restoreOwed`, the review of 11-11): its words said the command still ran, which the restart made untrue. What it was
 * on is not kept with the told note, so these name none: the restart's own word of each command rides beside them
 * (agent/commands.js `tellStoppedCommands`).
 */
export const idleCutText = () =>
  "[Filament: Filament restarted before its check-in on what you left running in the background reached you: it ran under the Filament that stopped, which ended it — Filament no longer follows it, and its results will not come. Say in a line where your work stands, then start again what you still need, or go on with your work.]";

/**
 * The idle waker: one timer per chat. `ended(chat)` arms it as a turn ends — where a command of the chat's agent runs
 * (`running`) and the setting is not off (`minutes`) —, replacing the one before; `began(chat, { idle })` cancels it as
 * any turn starts, and starts the back-off again unless that turn is the idle wake's own; `stopped(chat)` and
 * `cancel(chat)` drop it. When its time comes, the chat is told (`tell`) only where a command still runs, the setting is
 * still on, and nothing keeps it from being woken (`blocked`: the person stopped or archived it, a question waits,
 * another wake is due or on its way) — a block sets it again for the next wait, as the check-in before promised; one that is only
 * another wake owed that nothing sends (`blocked` says "owed") does so OWED_HOLDS times in a row at most. `changed`
 * hears each chat's timer as it is set, spent or dropped, for the page and for what the chat keeps (`kept`). A timer armed again
 * after a restart (`restore`) whose commands that restart ended tells the agent so (`idleGoneText`, kind "exit": their
 * end came) — `blocked` then asked with `restored`, as the restart's own word of them waits untold
 * (agent/commands.js `tellStoppedCommands`) and is no other wake. `minuteMs`: a minute's length, a live test's seam
 * (server.js `overrides.idleWakeMinuteMs`).
 * @param {{ minutes: () => unknown, running: (chat: string) => IdleCommand[], blocked?: (chat: string, o?: { restored?: boolean }) => boolean | "owed",
 *   tell: (chat: string, note: { id: string, text: string, commands: IdleCommand[], kind?: "idle" | "exit" }) => void,
 *   changed?: (chat: string, wake: IdleWake | null) => void, now?: () => number, log?: (level: string, msg: string) => void, minuteMs?: number }} o
 */
export function createIdleWaker({ minutes, running, blocked = () => false, tell, changed = () => {}, now = Date.now, log = () => {}, minuteMs = 60_000 }) {
  /**
   * Each chat's timer — one at most: a new one clears the one before —, its id, when, when the turn it was set for
   * ended (`since`: one set again counts from there still), its wait, what ran as it was set; `restored`: armed again
   * as Filament started (`restore`).
   * @type {Map<string, { id: number, at: number, since: number, waitMin: number, commands: IdleCommand[], timer: any, restored?: boolean }>}
   */
  const armed = new Map();
  /** Each chat's idle wakes in a row with nothing else between them: the back-off's step. @type {Map<string, number>} */
  const streak = new Map();
  /** Each chat's check-ins in a row held back by a wake owed that nothing sends (`OWED_HOLDS`). @type {Map<string, number>} */
  const owedHeld = new Map();
  // Ids from the clock on: one a chat kept from before a restart is never given again (`restore`).
  let seq = now();
  /** @param {string} chat @param {IdleWake | null} wake */
  const say = (chat, wake) => {
    try {
      changed(chat, wake);
    } catch {}
  };
  /** The chat's timer cleared; whether one was. @param {string} chat @param {{ quiet?: boolean }} [o]  `quiet`: the page not told — another is set at once */
  const clear = (chat, { quiet = false } = {}) => {
    const a = armed.get(chat);
    if (!a) return false;
    clearTimeout(a.timer);
    armed.delete(chat);
    if (!quiet) say(chat, null);
    return true;
  };
  /**
   * The chat's timer set, replacing the one before: after its wait at the back-off's step, for `commands`. `again`: the
   * timer whose time found the chat held, set again — it counts from the same turn's end (`since`); one the start armed
   * again keeps its id, which the start's hold knows it by (server.js `heldAtStart`), and where the restart ended its
   * commands it stays one that says so (`restored`).
   * @param {string} chat @param {number} base @param {IdleCommand[]} commands @param {{ since: number, id?: number, restored?: boolean } | null} [again]
   */
  const arm = (chat, base, commands, again = null) => {
    clear(chat, { quiet: true });
    const waitMin = idleWaitMinutes(base, streak.get(chat) ?? 0);
    const id = again?.id ?? ++seq;
    const at = now() + waitMin * minuteMs;
    const timer = setTimeout(() => fire(chat), waitMin * minuteMs);
    timer.unref?.();
    armed.set(chat, { id, at, since: again ? again.since : now(), waitMin, commands, timer, ...(again?.restored ? { restored: true } : {}) });
    say(chat, { at, commands });
    return { at, minutes: waitMin };
  };
  /** The minutes since the turn a timer was set for ended, as its words say them. @param {{ since: number }} a */
  const idleMinOf = (a) => Math.max(1, Math.round((now() - a.since) / minuteMs));
  /** @param {string} chat */
  const fire = (chat) => {
    const a = armed.get(chat);
    if (!a) return;
    armed.delete(chat);
    say(chat, null);
    const base = idleWakeMinutes(minutes());
    const commands = running(chat);
    // Armed again after a restart, with nothing of the chat's running: the restart ended what it was set for.
    const gone = !!a.restored && !commands.length && a.commands.length > 0;
    // Turned off meanwhile; or the command ended — its own end is what wakes the agent.
    if (!base || (!commands.length && !gone)) return;
    // Armed again (the nudge map of 11-10): the check-in before promised "checks in again in N min", and a block that
    // let the time pass — another wake due that never came, a question since answered — left the agent idle for good.
    // A turn that comes meanwhile drops it, and its end arms it anew. One a restart's end of its commands made keeps
    // saying so at its next try.
    const held = blocked(chat, { restored: gone });
    // Held only by another wake owed that nothing sends (the review of 11-11): set again at the same wait while the
    // command ran, it wrote, said and logged each time, and never came. Past OWED_HOLDS in a row it is told all the same,
    // not dropped: its telling asks the waker again, which sends what was owed with it where it can; where it cannot, both
    // wait for the chat's next turn, and the timer, spent, is set no more.
    const owedRun = held === "owed" ? (owedHeld.get(chat) ?? 0) + 1 : 0;
    if (owedRun) owedHeld.set(chat, owedRun);
    else owedHeld.delete(chat);
    if (held && owedRun <= OWED_HOLDS) {
      const again = arm(chat, base, gone ? a.commands : commands, { since: a.since, ...(a.restored ? { id: a.id } : {}), restored: gone });
      log("info", `sessions: ${chat} idle ${a.waitMin} min with a command running, and not woken for it (stopped, archived, asking, or another wake comes): checked again in ${again.minutes} min`);
      return;
    }
    if (owedRun) {
      owedHeld.delete(chat);
      log("info", `sessions: ${chat} idle ${a.waitMin} min with a command running, another wake owed to it and not sent for ${owedRun} check-ins: its agent is told all the same`);
    }
    if (gone) {
      log("info", `sessions: ${chat} idle ${a.waitMin} min, its commands ended by Filament's restart: its agent is told`);
      tell(chat, { id: `idle-${a.id}`, text: idleGoneText(a.commands, { idleMin: idleMinOf(a) }), commands: a.commands, kind: "exit" });
      return;
    }
    const step = (streak.get(chat) ?? 0) + 1;
    streak.set(chat, step);
    log("info", `sessions: ${chat} idle ${a.waitMin} min with ${commands.length} command(s) running: its agent is told`);
    // Counted from its turn's end, not its last wait: one set again comes later than that wait.
    tell(chat, { id: `idle-${a.id}`, text: idleText(commands, { idleMin: idleMinOf(a), nextMin: idleWaitMinutes(base, step), now: now() }), commands });
  };
  return {
    /**
     * A turn of the chat's ended: armed where a command of its agent runs, else dropped and the back-off started again.
     * → when it is told and after how many minutes, or null where nothing is armed.
     * @param {string} chat @returns {{ at: number, minutes: number } | null}
     */
    ended(chat) {
      const base = idleWakeMinutes(minutes());
      const commands = base ? running(chat) : [];
      if (!commands.length) {
        clear(chat);
        streak.delete(chat);
        return null;
      }
      return arm(chat, base, commands);
    },
    /** A turn of the chat's starts: its timer dropped; the back-off starts again unless it is the idle wake's own turn. @param {string} chat @param {{ idle?: boolean }} [o] */
    began(chat, { idle = false } = {}) {
      clear(chat);
      owedHeld.delete(chat);
      if (!idle) streak.delete(chat);
    },
    /** The person stopped the chat: nothing told, the back-off from the start. @param {string} chat */
    stopped(chat) {
      clear(chat);
      streak.delete(chat);
      owedHeld.delete(chat);
    },
    /** The chat gone, or its timer no longer wanted. @param {string} chat */
    cancel(chat) {
      clear(chat);
      streak.delete(chat);
      owedHeld.delete(chat);
    },
    /** When the chat is told, and of what; null where nothing is armed. @param {string} chat @returns {IdleWake | null} */
    next(chat) {
      const a = armed.get(chat);
      return a ? { at: a.at, commands: a.commands } : null;
    },
    /** The chat's timer as it keeps it for a restart; null where nothing is armed. @param {string} chat @returns {KeptIdleWake | null} */
    kept(chat) {
      const a = armed.get(chat);
      return a ? { id: a.id, at: a.at, since: a.since, waitMin: a.waitMin, streak: streak.get(chat) ?? 0, commands: a.commands.map((c) => ({ ...c })) } : null;
    },
    /**
     * A timer the chat kept as Filament last stopped, armed again as it starts (the nudge map of 11-10): at its time, or
     * at once where its time came while Filament was not running; its back-off where it was. One armed since is left as
     * it is. At once is before this answers, not a timer's turn later (the review of 11-11): the start then counts its
     * chat among those it owes a wake, and wakes them a stagger apart — on a timer's turn it came after the start's
     * sweep where no cut turn went on first, and every such chat was woken at the same moment.
     * → whether it was armed. @param {string} chat @param {KeptIdleWake} k
     */
    restore(chat, k) {
      if (!chat || armed.has(chat) || !Number.isFinite(Number(k?.at))) return false;
      const at = Number(k.at);
      if (Number(k.streak) > 0) streak.set(chat, Number(k.streak));
      const commands = (Array.isArray(k.commands) ? k.commands : []).map((c) => ({ id: String(c.id), command: String(c.command || ""), startedAt: Number(c.startedAt) || 0 }));
      const wait = at - now();
      const timer = wait > 0 ? setTimeout(() => fire(chat), wait) : null;
      timer?.unref?.();
      const waitMin = Number(k.waitMin) || 0;
      armed.set(chat, { id: Number(k.id) || ++seq, at, since: Number(k.since) || at - waitMin * minuteMs, waitMin, commands, timer, restored: true });
      if (timer) say(chat, { at, commands });
      else fire(chat);
      return true;
    },
    /** Every chat armed, for the page's resync. @returns {{ chainId: string, idleWake: IdleWake }[]} */
    list: () => [...armed].map(([chainId, a]) => ({ chainId, idleWake: { at: a.at, commands: a.commands } })),
    /** How many chats are armed (the tests' look). */
    pending: () => armed.size,
    /** Every timer dropped: Filament stopping. */
    dispose() {
      for (const a of armed.values()) clearTimeout(a.timer);
      armed.clear();
      streak.clear();
      owedHeld.clear();
    },
  };
}
