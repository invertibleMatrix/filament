// @ts-check
// The developer's own sub-agents in the transcript (HarnessV3 §15 item 86): sent off, and back with a report. On the
// running turn's timeline they are its run's `subagent-dispatch` / `subagent-arrival` events, which labels.js groups
// into the round they happened in; between turns (no turn ran) they are the session's marks, drawn as boundaries. One
// row each, its name opening the sub-agent's conversation. A report the developer kept aside offers "Send to the main
// agent" for as long as the page knows the sub-agent — the registry holds sub-agents in memory, so after a restart
// the row stays and the button does not; whether the report was sent on, the session itself records. A sub-agent that
// came back with changes in its own worktree offers Apply (§15 item 88) until they are applied — after a restart too,
// since the repository keeps the work. Each row names the card the sub-agent runs as (HarnessV4_Tasks E15 step 4). An
// agent you asked by its tag is a card of its own (agent-card.js): its question and its answer in one, drawn at the
// mark it was sent off with.
import { h, morphChildren } from "../../lib/dom.js";
import { formatWorkedFor, subagentViewFact } from "../lib/labels.js";
import { machineWords, statusTone } from "../lib/subagents.js";
import { handedWords } from "../lib/agent-cards.js";
import { chipActions } from "./tools/layout.js";
import { agentCardRow } from "./agent-card.js";
import { waitsWords } from "../lib/apply-words.js";
import { followWhileDrawn } from "../lib/follow-drawn.js";

/** How an exchange ended, as the verb after the sub-agent's name. @type {Readonly<Record<string, string>>} */
const ENDED_VERBS = Object.freeze({ done: "reported", failed: "failed", stopped: "was stopped", aborted: "was cut off", "budget-stopped": "stopped at a budget" });

/**
 * A row follows the page's store of the session's agents until it is told to stop, or until the row has left the
 * document — `gone` hears that (lib/follow-drawn.js). Returns the stop; with no store to follow, nothing is followed.
 * @param {Element} row @param {() => void} onChange @param {() => void} [gone]
 */
export function followStore(row, onChange, gone) {
  return chipActions.watchSubagents ? followWhileDrawn(row, chipActions.watchSubagents, onChange, gone) : () => {};
}

/**
 * One mark, as a run event or a session boundary carries it. `told` and `read` are the timeline's: the main agent heard
 * of the launch on this turn, and where it read the report — at this row ("here") or before a later round (its number).
 * Between turns, `told` and `carriedBy` are the session's: the turn that carried the launch's notice or the report
 * (HarnessV3-FixRound decision 23), after the turn the mark follows (`afterTurn`).
 * @typedef {{ event: "dispatch" | "arrival", agentId: string, exchange: number, description: string, model?: string,
 *   view?: string, may?: string, card?: { tag: string, name: string }, asked?: boolean, handed?: string, handedFiles?: number,
 *   memory?: boolean, pause?: boolean, inform?: boolean, deliver?: boolean,
 *   followUp?: boolean, status?: string, ms?: number, rounds?: number, toolCalls?: number,
 *   delivery?: "auto" | "held", changes?: number, error?: string, told?: boolean, read?: "here" | number | null,
 *   afterTurn?: number, carriedBy?: number, machine?: { id: string, name: string } }} SubagentMark
 */

/**
 * Where one launched on another machine works, first among its row's facts (the remote-agents plan's s-ui): a dot in
 * its run's state — `tone`, as statusTone says it; none known, the dot stays grey — and "on Workstation". The machine as
 * the mark names it, else as the page's store does while Filament holds the sub-agent. Null for one of this machine's.
 * @param {SubagentMark} m @param {string} tone
 * @returns {{ el: HTMLElement, tone: (t: string) => void } | null}
 */
function machineAt(m, tone) {
  const words = machineWords(m.machine?.name ? m : chipActions.subagentRow?.(m.agentId));
  if (!words) return null;
  const el = h("span", { class: "sub-mark-at" }, h("span", { class: "sav-dot", "aria-hidden": "true" }), words);
  const paint = (/** @type {string} */ t) => void (el.className = `sub-mark-at${t ? ` tone-${t}` : ""}`);
  paint(tone);
  return { el, tone: paint };
}

/**
 * Its machine and its chat there, as the page's store says them: none before its chat there is made, nor while the
 * store knows it not. @param {SubagentMark} m
 */
function chatThere(m) {
  const r = chipActions.subagentRow?.(m.agentId);
  const machine = r?.machine || m.machine;
  return machine && r?.remote?.chat ? { machine, chat: r.remote.chat } : null;
}

/**
 * Open on Workstation, beside Open, for one launched on another machine where the page opens that machine's (s2e): its
 * chat there, as that machine shows it — drawn once that chat is made, as the store says while the row stands. Null for
 * one of this machine's.
 * @param {SubagentMark} m
 * @returns {{ el: HTMLElement, paint: () => void } | null}
 */
function thereButton(m) {
  if (!chipActions.openOnMachine || !(m.machine?.id || chipActions.subagentRow?.(m.agentId)?.machine)) return null;
  const el = h("button", { class: "subagent-open hidden", type: "button", onclick: () => {
    const at = chatThere(m);
    if (at) chipActions.openOnMachine?.(at.machine, at.chat);
  } });
  const paint = () => {
    const at = chatThere(m);
    el.classList.toggle("hidden", !at);
    const words = at ? `Open on ${at.machine.name}` : "";
    if (at && el.textContent !== words) {
      el.textContent = words;
      el.title = `Its chat on ${at.machine.name}, as that machine shows it`;
    }
  };
  paint();
  return { el, paint };
}

/** How a sub-agent's exchange stands now in the page's store, as statusTone says it; "" while the store knows it not. @param {SubagentMark} m */
function toneNow(m) {
  const r = chipActions.subagentRow?.(m.agentId);
  const status = r?.exchanges?.[m.exchange]?.status ?? r?.status;
  return status ? statusTone(status) : "";
}

/**
 * Where an arriving report went, after the sub-agent's name, for a report not kept aside: read at a step of the turn
 * it arrived in, or between turns with the next turn — "goes" until the turn that carried it is recorded, then "went"
 * (decision 23).
 * @param {SubagentMark} m @param {boolean} between
 */
export function arrivalWhere(m, between) {
  return m.read === "here" ? " — its report joined the conversation here"
    : typeof m.read === "number" ? ` — the main agent read it before round ${m.read}`
    : between && typeof m.carriedBy === "number" ? ` — its report went with ${m.carriedBy === Number(m.afterTurn) + 1 ? "the next turn" : `turn ${m.carriedBy}`}`
    : between ? " — its report goes with the main agent's next turn"
    : " — the main agent reads it at its next step";
}

/**
 * A mark's row. `between` says it stands between turns: its report, when it goes to the main agent, goes with the
 * main agent's next turn rather than at a next step. The mark of an agent asked by its tag is its card — and no row
 * at all for the answer's mark where the chat holds the question's, which draws both.
 * `shown`: a card's, told at each paint whether it stands (agent-card.js `frame`).
 * @param {SubagentMark} m @param {{ between?: boolean, shown?: (on: boolean) => void }} [o]
 * @returns {HTMLElement | null}
 */
export function subagentMarkRow(m, { between = false, shown } = {}) {
  if (m.asked) return agentCardRow(m, { follow: (row, onChange, gone) => followStore(row, onChange, gone), shown });
  const name = m.card?.name || "Agent";
  const who = m.description ? `“${m.description}”` : m.agentId;
  const open = chipActions.openSubagent
    ? h("button", { class: "subagent-open", type: "button", title: "Open its conversation", onclick: () => chipActions.openSubagent?.(m.agentId) }, "Open")
    : null;
  if (m.event === "dispatch") {
    const facts = [
      m.model || "",
      subagentViewFact(m.view),
      m.may === "read" ? "read-only" : m.may === "copy" ? "in its own copy, nothing kept" : "",
      handedWords(m.handed),
      m.memory ? "memory brief" : "",
      m.pause ? "the main agent waits for it" : "",
      m.inform ? (m.told ? "the main agent was told" : "the main agent is told") : "",
      m.deliver === false ? "report kept for you" : "",
    ].filter(Boolean);
    // One on another machine: its dot follows its run there, in the store, while the row stands, and its chat there opens.
    const at = machineAt(m, toneNow(m));
    const there = thereButton(m);
    const row = h("div", { class: "tool-note sub-mark is-dispatch" },
      h("span", { class: "sub-mark-ic", "aria-hidden": "true" }, "↗"),
      h("span", { class: "sub-mark-text" },
        m.followUp ? `You asked ${name} ${who} again` : `You sent ${name} ${who} off`,
        at ? h("span", { class: "sub-mark-facts" }, " · ", at.el) : null,
        facts.length ? h("span", { class: "sub-mark-facts" }, ` · ${facts.join(" · ")}`) : null),
      there?.el ?? null,
      open);
    if (at || there)
      followStore(row, () => {
        at?.tone(toneNow(m));
        there?.paint();
      });
    return row;
  }
  const status = m.status || "done";
  const facts = [m.ms ? formatWorkedFor(m.ms) : "", m.rounds ? `${m.rounds} round${m.rounds === 1 ? "" : "s"}` : "", m.toolCalls ? `${m.toolCalls} tool call${m.toolCalls === 1 ? "" : "s"}` : ""].filter(Boolean);
  const at = machineAt(m, statusTone(status));
  const there = thereButton(m);
  const where = h("span", { class: "sub-mark-where" });
  const action = h("span", { class: "sub-mark-action" });
  const work = h("span", { class: "sub-mark-action" });
  const row = h("div", { class: `tool-note sub-mark is-arrival tone-${statusTone(status)}`, title: m.error || "" },
    h("span", { class: "sub-mark-ic", "aria-hidden": "true" }, status === "done" ? "✓" : "!"),
    h("span", { class: "sub-mark-text" },
      `${name} ${who} ${ENDED_VERBS[status] || status}`,
      at ? h("span", { class: "sub-mark-facts" }, " · ", at.el) : null,
      facts.length ? h("span", { class: "sub-mark-facts" }, ` · ${facts.join(" · ")}`) : null,
      where),
    work,
    action,
    there?.el ?? null,
    open);
  if (there) followStore(row, there.paint);
  const held = m.delivery === "held";
  if (!held) where.textContent = arrivalWhere(m, between);
  if (!held && !(Number(m.changes) > 0)) return row;
  // A report kept aside, and changes waiting in its worktree: the buttons follow the sub-agent's state in the page's
  // store until the report is sent and the changes applied, or the row is replaced. The transcript attaches a row in
  // the task that builds it and the store speaks in later ones, so a row out of the document when the store speaks
  // has been replaced for good.
  /** @type {(() => void) | null} */
  let unwatch = null;
  let settled = false;
  const settle = () => {
    settled = true;
    unwatch?.();
    unwatch = null;
  };
  /** The kept report's part; true once there is nothing more to follow. */
  const paintHeld = () => {
    if (!held) return true;
    const state = chipActions.subagentDelivery?.(m.agentId, m.exchange);
    if (state === "sent") {
      where.textContent = " — you sent its report to the main agent";
      morphChildren(action, []);
      return true;
    }
    where.textContent = " — report kept for you";
    // Drawn again in place at each word of the store, never made anew under a resting pointer (the owner's of 11-01).
    morphChildren(action, state === "held" && chipActions.sendSubagent ? [sendButton()] : []);
    return false;
  };
  /**
   * The worktree's part: what the store says waits, else what the mark said at arrival; true once none waits — and no
   * mark as applied could be undone, which would have its changes wait again.
   */
  const paintWork = () => {
    if (!(Number(m.changes) > 0)) return true;
    const known = chipActions.subagentWork?.(m.agentId) ?? null;
    // The list answered without it: Filament holds it no longer, and Changes has no row of it to open (the Hunter's of 10-28).
    if (!known && chipActions.subagentsKnown?.() === true) {
      morphChildren(work, []);
      return true;
    }
    const pending = known ? known.pending : Number(m.changes);
    if (!pending) {
      morphChildren(work, [h("span", { class: "sub-mark-facts" }, known?.found ? " · its changes were found in your folder" : known?.hand ? " · its changes are marked as applied" : known?.applied ? " · its changes are applied" : " · no changes wait any more")]);
      return !known?.undo;
    }
    morphChildren(work, [chipActions.reviewSubagent ? reviewButton(pending) : h("span", { class: "sub-mark-facts" }, ` · ${pending} file${pending === 1 ? "" : "s"} wait in its copy`)]);
    return false;
  };
  /** @param {boolean} built  the row is being built (not attached yet) */
  const paint = (built) => {
    if (settled) return;
    if (!built && !row.isConnected) return settle();
    const heldDone = paintHeld();
    if (paintWork() && heldDone) settle();
  };
  /** What waits in its copy, and the way to it: its row in Changes, where Apply says what it would do. @param {number} n */
  const reviewButton = (n) =>
    h("button", { class: "sub-mark-send", type: "button", title: "Its changes wait in its own copy: its row in Changes says what Apply would do, and applies them", onclick: () => chipActions.reviewSubagent?.(m.agentId) }, waitsWords(n));
  const sendButton = () =>
    h("button", {
      class: "sub-mark-send", type: "button", title: "Its report joins the main agent's work: the running turn's next step, else its next turn",
      onclick: (/** @type {Event} */ e) => {
        const b = /** @type {HTMLButtonElement} */ (e.currentTarget);
        b.disabled = true;
        chipActions.sendSubagent?.(m.agentId, m.exchange).catch(() => {
          b.disabled = false;
        });
      },
    }, "Send to the main agent");
  paint(true);
  if (!settled) unwatch = followStore(row, () => paint(false), () => { settled = true; unwatch = null; });
  return row;
}
