// @ts-check
// The live line under the running turn (proposal_ux §4.3, Phase 5): what the turn does now — waiting, thinking, acting,
// reading results, or the step before its request (compacting first, starting the agent) —, its round and its time,
// and for a coding agent when the turn reached it (the run's "sent"): the owner's 10-09 "no way for me to know" whether
// a turn reached the agent. It sits after the last turn, where the eye is while the work streams; the fold's header
// over the work says the same in its own words. The clocks tick on the fold's shared timer (turn.js `ticking`).
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { formatWorkedFor, turnPhaseWords, waitingWords } from "../lib/labels.js";
import { agoShort } from "../../lib/format.js";
import { TURN_STATES } from "../lib/overview.js";
import { ticking } from "./turn.js";

/**
 * What the line says of a running turn: whether it waits for you, the state in the loop's words — a wait, what it
 * waits for (`waitingWords`) —, its round, when it started, and when it reached its coding agent (null before, or for
 * a turn Filament's loop runs).
 * While the page reads what a turn opened from elsewhere did so far (`loading`, lib/replay-hold.js), it says so: what
 * it holds aligned is still the replay's start.
 * @param {any} turn  the running turn: its `phase`, `aligned`, `startedAt`, `paused`, `loading`
 * @returns {{ asks: boolean, state: string, round: number, startedAt: number, sentAt: number | null }}
 */
export function liveLineOf(turn) {
  const al = turn?.loading ? null : turn?.aligned || null;
  const asks = !!turn?.paused || !!al?.waiting?.length;
  const to = String(al?.turnState?.to || "");
  const state = asks ? "for your answer" : turn?.loading ? "loading what it did so far" : turnPhaseWords(turn?.phase) || waitingWords(al?.turnState) || TURN_STATES.find((s) => s.id === to)?.words || "";
  return {
    asks,
    state,
    round: Number(al?.maxRound) || 0,
    startedAt: Number(turn?.startedAt) || Date.now(),
    sentAt: Number(al?.sentAt) > 0 ? Number(al.sentAt) : null,
  };
}

/** When the turn reached its agent, as the line says it: "just now", "17m ago". @param {number} ms */
const reachedWords = (ms) => {
  const w = agoShort(0, Math.max(0, ms));
  return w === "now" ? "just now" : w;
};

/**
 * The line: painted in place from the turn as it moves, its clocks ticking between the run's events; `clear` takes it
 * away once the turn ends.
 * @returns {{ el: HTMLElement, paint: (turn: any, coder: string) => void, clear: () => void }}
 */
export function createLiveLine() {
  const lead = h("b", { class: "turn-live-lead" });
  const state = h("span", { class: "turn-live-state" });
  const round = h("span", { class: "turn-live-round" });
  const took = h("span", { class: "turn-live-took" });
  const reached = h("span", { class: "turn-live-reached" });
  const el = h("div", { class: "turn-live hidden", role: "status" },
    h("span", { class: "turn-live-spin", "aria-hidden": "true", html: ICONS.loader }), lead, state, round, took, reached);
  /** The clocks' starts as last set: a clock is set again only when its start moves. */
  let tookFrom = 0;
  let sentFrom = 0;
  let sentBy = "";
  return {
    el,
    paint(turn, coder) {
      const s = liveLineOf(turn);
      el.classList.remove("hidden");
      el.classList.toggle("is-asks", s.asks);
      lead.textContent = s.asks ? "Waiting" : "Working";
      state.textContent = s.state ? ` · ${s.state}` : "";
      round.textContent = s.round ? ` · step ${s.round}` : "";
      if (s.startedAt !== tookFrom) {
        tookFrom = s.startedAt;
        ticking(took, s.startedAt, (ms) => ` · ${formatWorkedFor(ms)}`);
      }
      const at = coder && s.sentAt ? s.sentAt : 0;
      if (at !== sentFrom || coder !== sentBy) {
        sentFrom = at;
        sentBy = coder;
        // Before its run says so, nothing: the state says the step it is on ("starting Claude Code").
        if (at) ticking(reached, at, (ms) => ` · the turn reached ${coder} ${reachedWords(ms)}`);
        else {
          delete reached.dataset.t0;
          reached.textContent = "";
        }
      }
    },
    // The clocks go with their words: a turn painted next that reaches no agent changes neither start, and kept, the
    // words were the turn's before — another chat's "the turn reached Claude Code 7m ago", frozen, under a turn
    // Filament's loop ran (the owner's of 11-02).
    clear() {
      el.classList.add("hidden");
      tookFrom = 0;
      sentFrom = 0;
      sentBy = "";
      delete took.dataset.t0;
      delete reached.dataset.t0;
      took.textContent = "";
      reached.textContent = "";
    },
  };
}
