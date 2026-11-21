// @ts-check
// Launches held for the person's yes (the owner's of 11-14): while Settings › Experimental › Parallelize tasks is off,
// a sub-agent that may change files starts only once the person agrees, on a card in the chat — "anytime the agent is
// suppose to spawn a sub agent that can edit files in parallel then it is suppose to show a card that asks for
// permission". The launches of one chat that come while its card waits join it, one card for them all, its countdown
// starting over at each. The person's Accept starts them; One at a time keeps the work with the agent, and a further
// launch of that turn is refused in words. With no answer in `HOLD_MS` the card answers itself on the server, whatever
// page shows it or none: Accept, wherever each launch would work (the owner's of 11-14: "if user don't accept or reject
// in 60 seconds then consider it to accept", and their choice, of the review of fc944b32, to start them all) — only one
// with no model known stays the agent's (`declines`). Every answer reaches the agent as a notice, which wakes its wait.
// Kept in memory: a restart ends the turn whose launch waited, and a turn that ends with its card unanswered starts
// nothing (`stop`). Plain Node, its clock and timers handed in.
import { randomBytes } from "node:crypto";

/** How long a card waits for the person before it answers itself. */
export const HOLD_MS = 60_000;
/** How many answered cards a chat keeps for its transcript, newest last. */
const KEPT = 5;

/**
 * One launch on a card, as the person reads it. `where`: in its own copy of the folder, in the person's folder, or on
 * another machine (`machine` names it). `declines`: why the card, unanswered, keeps it with the agent — no model is known
 * for it — or "" where it starts. `attached`: what the agent attached to it (attach.js), each by name. `agent`: the
 * sub-agent it started as, once the card is accepted.
 * `kept`: its card's clock left it with the agent while it started others. `queued`: accepted, a task of the graph that
 * waits to start — Filament starts it once a slot is free and the chat's turn runs.
 * @typedef {{ n: number, description: string, kind: string, model: string, where: "copy" | "folder" | "machine", machine?: string, attached?: { files: string[], pictures: string[] }, declines: string, agent?: string, kept?: boolean, queued?: boolean }} HeldLaunch
 */
/**
 * A card, as the page draws it and the agent is told of it. `until`: when it answers itself, by the server's clock;
 * `left`: how long that was as the card was said, which a page on another machine's clock counts down from; `onTimeout`: how
 * — all start, none does, or some do (those with a model known) —, `why` saying why the others stay.
 * @typedef {{ id: string, chainId: string, at: number, until: number, left: number, turn: number | null, onTimeout: "accept" | "decline" | "some",
 *   why: string, launches: HeldLaunch[], state: "waiting" | "accepted" | "declined", by: "person" | "timeout" | "stop" | null,
 *   answeredAt: number | null, started: string[], failed: string[], paused?: boolean, always?: boolean }} HoldView
 * `paused`: its turn waits on the person (a question, a permission): its clock stands until the turn goes on.
 * `always`: the person's Accept was Always accept in this chat (the owner's of 11-16): the chat's own Parallelize tasks
 * is on from then, and no card asks in it.
 */
/**
 * What a launch on a card does on its answer: `start` launches it (the ids of what it started, or a throw with the words
 * of what refused it); `declined` hears that it never will, and who said so (a graph task forgets it was held).
 * @typedef {{ view: Omit<HeldLaunch, "n">, start: () => Promise<string[]> | string[], declined?: (by: "person" | "timeout" | "stop") => void }} HeldEntry
 */

/** A list in words: "a", "a and b", "a, b and c". @param {string[]} xs */
const listed = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs.join(""));
/** A launch as the agent reads it. @param {HeldLaunch} l */
const named = (l) => `“${l.description}”`;

/**
 * What the agent's call answers as its launch is held. `declines`: why an unanswered card keeps it with the agent, or "".
 * @param {string} declines
 */
export const heldWords = (declines) =>
  `Held, not started: Parallelize tasks is off, so Filament asks the person on a card. ${
    declines ? `It starts on their Accept; with no answer in ${HOLD_MS / 1000} seconds it stays yours (${declines}).` : `It starts on their Accept, or by itself in ${HOLD_MS / 1000} seconds, and its report then comes as usual.`
  } Until Filament tells you which, do none of its work: go on with a piece of your own, or call wait — again if it returns before Filament tells you.`;

/** What a writing launch is refused with once the person chose One at a time on the turn's card. */
export const ONE_AT_A_TIME_WORDS =
  "Not started: on this turn's card the person chose One at a time, so no sub-agent that changes files starts for the rest of the turn. Do this work yourself; a reviewer, which only reads, may still go.";

/** What the agent is told besides, where the person's Accept was Always accept in this chat. */
export const ALWAYS_WORDS =
  " They chose Always accept in this chat: Parallelize tasks is on for this chat from now on, so a sub-agent you launch that changes files starts at once, with no card asking them first.";

/**
 * What the agent is told of its card's answer. @param {HoldView} h
 * @returns {string}
 */
export function answerWords(h) {
  const all = h.launches.map(named);
  const them = all.length === 1 ? "it" : "them";
  if (h.state === "accepted") {
    const kept = h.launches.filter((l) => l.kept);
    const ran = h.launches.filter((l) => l.agent).map((l) => `${named(l)} as ${l.agent}`);
    const queued = h.launches.filter((l) => l.queued).map(named);
    const how = h.by === "timeout" ? `No answer on the card in ${HOLD_MS / 1000} seconds, so Filament ${ran.length ? "started" : "accepted"} ${kept.length ? "those with a model known" : "what it held"}` : "The person accepted the card";
    const started = ran.length ? `: ${listed(ran)} ${ran.length === 1 ? "runs; its report comes" : "run; their reports come"} as a message.` : ".";
    const waits = queued.length ? ` ${listed(queued)} ${queued.length === 1 ? "waits" : "wait"} to start: Filament starts ${queued.length === 1 ? "it" : "each"} once a slot is free and this chat's turn runs, its report then coming as a message.` : "";
    const failed = h.failed.length ? ` Not started: ${h.failed.join("; ")}.` : "";
    const yours = kept.length ? ` ${listed(kept.map((l) => `${named(l)} (${l.declines})`))} did not start: do ${kept.length === 1 ? "it" : "them"} yourself, in order.` : "";
    return `${how}${started}${waits}${failed}${yours}${h.always ? ALWAYS_WORDS : ""}`;
  }
  if (h.by === "stop") return `The turn ended before the person answered the card: ${listed(all)} did not start.`;
  if (h.by === "timeout") return `No answer on the card in ${HOLD_MS / 1000} seconds, and ${h.why}: ${listed(all)} did not start. Do ${them} yourself, in order.`;
  return `The person chose One at a time: ${listed(all)} did not start. Do ${them} yourself, in order; a sub-agent that changes files is refused for the rest of this turn.`;
}

/**
 * The cards of every chat.
 * @param {{ now?: () => number, later?: (fn: () => void, ms: number) => any, cancel?: (handle: any) => void,
 *   publish?: (h: HoldView) => void, tell?: (chainId: string, text: string) => void, holdMs?: number, newId?: () => string,
 *   consented?: (chainId: string) => boolean, warn?: (e: unknown) => void }} [o]
 *   `publish`: the card as it stands now, for every page; `tell`: words for the chat's agent; `consented`: whether the
 *   person has since given their yes to every launch (Parallelize tasks turned on) — a card its clock answers then starts
 *   all it holds; `warn`: a throw from what hears an answer, which never stops the answer
 */
export function createHolds({ now = Date.now, later = (fn, ms) => setTimeout(fn, ms), cancel = (h) => clearTimeout(h), publish = () => {}, tell = () => {}, holdMs = HOLD_MS, newId = () => `hl_${randomBytes(4).toString("hex")}`, consented = () => false, warn = () => {} } = {}) {
  /**
   * `runId`: the turn it was held in, by its first request — a turn paused and resumed is one turn. `done`: its answer
   * has started all it will. `halt`: its turn ended while an Accept was starting what it held: start no more. `gone`:
   * its chat was let go (`drop`): nothing more is said of it.
   * @typedef {{ v: HoldView, entries: HeldEntry[], runId: string, timer: any, settled: Promise<void>, settle: () => void, done: boolean, halt: boolean, gone?: boolean }} Hold
   */
  /** Every chat's cards, the waiting one and the newest answered. @type {Map<string, Hold[]>} */
  const byChat = new Map();
  /** The turns whose person chose One at a time, by chat. @type {Map<string, Set<string>>} */
  const refused = new Map();
  /** What hears an answer, never stopping it. @param {() => void} fn */
  const quietly = (fn) => {
    try {
      fn();
    } catch (e) {
      warn(e);
    }
  };

  /** @param {Hold} h @returns {HoldView} */
  const viewOf = (h) => ({ ...h.v, left: h.v.state === "waiting" && !h.v.paused ? Math.max(0, h.v.until - now()) : 0, launches: h.v.launches.map((l) => ({ ...l })), started: [...h.v.started], failed: [...h.v.failed] });
  /** @param {string} chainId */
  const waitingOf = (chainId) => (byChat.get(chainId) || []).find((h) => h.v.state === "waiting") || null;
  /**
   * How the card answers itself, launch by launch: each with a model known starts, wherever it would work, and each other
   * stays the agent's — all, none or some — and why for those that stay. @param {Hold} h
   */
  const timeoutOf = (h) => {
    const stays = h.v.launches.filter((l) => l.declines);
    h.v.onTimeout = !stays.length ? "accept" : stays.length === h.v.launches.length ? "decline" : "some";
    h.v.why = [...new Set(stays.map((l) => l.declines))].join("; ");
  };
  /** @param {Hold} h */
  const arm = (h) => {
    if (h.timer != null) cancel(h.timer);
    h.v.until = now() + holdMs;
    h.timer = later(() => void answer(h.v.chainId, h.v.id, h.v.onTimeout !== "decline" || consented(h.v.chainId) ? "accept" : "decline", "timeout").catch(warn), holdMs);
    h.timer?.unref?.();
  };

  /**
   * Hold a launch: on the chat's waiting card where it is this turn's, or on a new one. Returns the card as it stands.
   * @param {string} chainId @param {{ runId: string, turn?: number | null } & HeldEntry} e
   */
  function hold(chainId, { runId, turn = null, view, start, declined }) {
    let h = waitingOf(chainId);
    // A card is its turn's alone: one an ended turn left waiting starts nothing, and this launch gets a card of its own.
    if (h && h.runId !== runId) {
      void answer(chainId, h.v.id, "decline", "stop").catch(warn);
      h = null;
    }
    if (!h) {
      /** @type {() => void} */
      let settle = () => {};
      const settled = new Promise((r) => (settle = () => r(undefined)));
      h = { v: { id: newId(), chainId, at: now(), until: 0, left: 0, turn, onTimeout: "accept", why: "", launches: [], state: "waiting", by: null, answeredAt: null, started: [], failed: [] }, entries: [], runId, timer: null, settled, settle, done: false, halt: false };
      const list = byChat.get(chainId) || [];
      list.push(h);
      byChat.set(chainId, list.slice(-KEPT));
    }
    h.entries.push({ view, start, ...(declined ? { declined } : {}) });
    h.v.launches.push({ n: h.v.launches.length + 1, ...view });
    timeoutOf(h);
    h.v.paused = false;
    arm(h);
    const v = viewOf(h);
    quietly(() => publish(v));
    return v;
  }

  /**
   * The card answered: by the person, by its own clock, or by its turn's end. Accept starts each launch in the order
   * held; a launch refused at its start is said with the rest. Its clock starts only the launches that may start by
   * themselves — every one where the person has since turned Parallelize tasks on —, the rest staying the agent's.
   * Answered once: a second answer is refused in words. `always`: the person's Accept was Always accept in this chat.
   * @param {string} chainId @param {string} id @param {"accept" | "decline"} said @param {"person" | "timeout" | "stop"} by
   * @param {{ always?: boolean }} [o]
   * @returns {Promise<{ ok: true, hold: HoldView } | { ok: false, error: string }>}
   */
  async function answer(chainId, id, said, by, { always = false } = {}) {
    const h = (byChat.get(chainId) || []).find((x) => x.v.id === id);
    if (!h) return { ok: false, error: "no such card in this chat" };
    if (h.v.state !== "waiting") return { ok: false, error: `the card was answered already (${h.v.state === "accepted" ? "accepted" : "kept with the agent"})` };
    if (h.timer != null) cancel(h.timer);
    h.timer = null;
    const all = by !== "timeout" || consented(chainId);
    h.v.state = said === "accept" ? "accepted" : "declined";
    h.v.by = by;
    h.v.answeredAt = now();
    if (always && said === "accept" && by === "person") h.v.always = true;
    if (h.v.state === "declined" && by === "person") {
      const s = refused.get(chainId) || new Set();
      s.add(h.runId);
      refused.set(chainId, s);
    }
    quietly(() => publish(viewOf(h)));
    try {
      for (const [i, e] of h.entries.entries()) {
        const l = h.v.launches[i];
        if (h.v.state !== "accepted" || (!all && l.declines)) {
          if (h.v.state === "accepted") l.kept = true;
          quietly(() => e.declined?.(by));
          continue;
        }
        if (h.halt) {
          h.v.failed.push(`${named(l)} (the turn ended first)`);
          // It never starts: what it took (a coding agent's task) is let go, as a turn's end lets go of a card.
          quietly(() => e.declined?.("stop"));
          continue;
        }
        try {
          const ids = await e.start();
          h.v.started.push(...ids);
          if (ids[0]) l.agent = ids[0];
          // Started nothing yet: a graph's task that waits to start — a free slot, the chat's turn —, its yes kept.
          else l.queued = true;
        } catch (/** @type {any} */ err) {
          h.v.failed.push(`${named(l)} (${String(err?.message || err).replace(/\.$/, "")})`);
        }
      }
    } finally {
      // What it started runs as the turn's own before the turn hears the card settled: its wait goes on for them. Its
      // launches' starts — each holding its turn's conversation — are let go: answered once, nothing calls them again.
      h.done = true;
      h.entries = [];
      h.settle();
    }
    const v = viewOf(h);
    // Its chat let go while an Accept was starting: no word of it — a notice would make the gone chat's state anew.
    if (h.gone) return { ok: true, hold: v };
    if (h.v.state === "accepted") quietly(() => publish(v));
    quietly(() => tell(chainId, answerWords(v)));
    return { ok: true, hold: v };
  }

  return {
    hold,
    answer,
    /** The chat's cards, the one waiting and the newest answered, oldest first. @param {string} chainId */
    list: (chainId) => (byChat.get(chainId) || []).map(viewOf),
    /** The chat's waiting card, or null. @param {string} chainId */
    waiting: (chainId) => {
      const h = waitingOf(chainId);
      return h ? viewOf(h) : null;
    },
    /** What the turn may not end before: its chat's card answered, and what its Accept starts started. @param {string} chainId */
    owed: (chainId) => (byChat.get(chainId) || []).find((h) => !h.done)?.settled || null,
    /** Whether the person chose One at a time on a card of this turn. @param {string} chainId @param {string} runId */
    refusing: (chainId, runId) => refused.get(chainId)?.has(runId) === true,
    /**
     * The turn ended — `runId` its first request's, or null for whatever turn the chat had (a question it paused on let
     * go): its chat's waiting card starts nothing, an Accept starting what it held starts no more, and the turn's One at
     * a time is let go. @param {string} chainId @param {string | null} runId
     */
    stop: (chainId, runId) => {
      if (runId == null) refused.delete(chainId);
      else refused.get(chainId)?.delete(runId);
      for (const h of byChat.get(chainId) || []) {
        if (h.done || (runId != null && h.runId !== runId)) continue;
        if (h.v.state === "waiting") void answer(chainId, h.v.id, "decline", "stop").catch(warn);
        else h.halt = true;
      }
    },
    /**
     * The turn paused on the person — a question, a permission —, or went on after it (`on`): its waiting card's clock
     * stands meanwhile, and starts over at the resume, so nothing starts by itself while no turn runs to own it.
     * @param {string} chainId @param {string} runId @param {boolean} on
     */
    pause: (chainId, runId, on) => {
      const h = waitingOf(chainId);
      if (!h || h.runId !== runId || !!h.v.paused === on) return;
      if (on) {
        if (h.timer != null) cancel(h.timer);
        h.timer = null;
        h.v.paused = true;
      } else {
        h.v.paused = false;
        arm(h);
      }
      const v = viewOf(h);
      quietly(() => publish(v));
    },
    /** The chat is gone: its waiting card starts nothing, and its cards are forgotten. @param {string} chainId */
    drop: (chainId) => {
      for (const h of byChat.get(chainId) || []) {
        if (h.v.state === "waiting") void answer(chainId, h.v.id, "decline", "stop").catch(warn);
        else if (!h.done) {
          h.halt = true;
          h.gone = true;
        }
      }
      byChat.delete(chainId);
      refused.delete(chainId);
    },
    /** Every card's clock stopped, as Filament stops. */
    close: () => {
      for (const list of byChat.values()) for (const h of list) if (h.timer != null) cancel(h.timer);
    },
  };
}
