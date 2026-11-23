// @ts-check
// The one tool-stub layout: icon, the kind label (gradient while
// running, subtlest at rest), the primary text, the secondary text, the status (only on failure), and the
// chevron when the card has content. The whole row toggles; Enter and Space do too. `tone` names the call's family
// (explore, changes, terminal, memory, agent, other) — the icon wears its color (HarnessV3 §15 item 92).
import { h } from "../../../lib/dom.js";
import { ICONS } from "../../lib/icons.js";

/** The ⌘ press, holding what it shows alone: one made in `toolRow` held the row's options, its body with them, and the
 *  row a drawing patched onto the one on the page kept that drawing whole (Fable 5.2's review of 11-17).
 *  @param {() => void} show */
const pressesPrompt = (show) => (/** @type {Event} */ e) => {
  e.preventDefault();
  e.stopPropagation();
  show();
};

/**
 * `fit`: the kind is the row's whole label (a work run's sentence, an agent's own title for a call), cut short with an
 * ellipsis when the row is narrow; a verb otherwise never gives way. `after`: what stands after the row's words and is
 * never cut with them — a running command's seconds and its Run in background.
 * @param {{ icon: string, kind: string, running?: boolean, primary?: (string|HTMLElement)[], secondary?: string | (string|HTMLElement)[],
 *   after?: (HTMLElement|null)[], status?: { word: string, title?: string, soft?: boolean }, source?: string, prompt?: () => void,
 *   body?: HTMLElement, open?: boolean, tone?: string, fit?: boolean }} o
 * @returns {HTMLElement}
 */
export function toolRow(o) {
  const kind = h("span", { class: `tool-kind${o.fit ? " fit" : ""}${o.running ? " gradient" : ""}` }, o.kind);
  const primary = h("span", { class: "tool-primary" }, ...(o.primary || []));
  const secondary = o.secondary ? h("span", { class: "tool-secondary" }, o.secondary) : null;
  const after = o.after?.some(Boolean) ? h("span", { class: "tool-after" }, ...o.after.filter(Boolean)) : null;
  const status = o.status
    ? h("span", { class: `tool-status${o.status.soft ? " soft" : ""}`, title: o.status.title || "" }, o.status.word)
    : null;
  const source = o.source ? h("span", { class: "tool-source" }, o.source) : null;
  const prompt = o.prompt
    ? h("button", {
      class: "tool-prompt", type: "button", title: "Show the prompt that made this call",
      onclick: pressesPrompt(o.prompt),
    }, "⌘")
    : null;

  const summary = h("summary", {},
    h("span", { class: "tool-ic", html: o.icon }),
    kind,
    primary,
    secondary,
    after,
    status,
    source,
    prompt,
    o.body ? h("span", { class: "tool-chev", html: ICONS.chevronRight }) : null);

  const tone = o.tone ? { "data-tone": o.tone } : {};
  if (!o.body) return h("div", { class: `tool-row${o.running ? " running" : ""}`, ...tone }, summary);

  const det = h("details", { class: `tool-row${o.running ? " running" : ""}`, ...tone, ...(o.open ? { open: "" } : {}) },
    summary, o.body);
  summary.addEventListener("keydown", (e) => {
    if (e.target !== summary) return; // a button inside the row keeps its own Enter
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); det.open = !det.open; }
  });
  return det;
}

/** Where a card's links go. The app points `open` at the side pane's code viewer, `readFile` at the files route (an
 *  image a card shows) and `openSubagent` at the sub-agent viewer; a report the developer kept aside is looked up
 *  (`subagentDelivery`: its exchange's delivery, undefined while the page does not know the sub-agent), sent on
 *  (`sendSubagent`) and followed (`watchSubagents`: hear every change, returns the unsubscribe) through the page's
 *  sub-agent store; a sub-agent's worktree changes are looked up (`subagentWork`: null while the page does not know
 *  it; `hand`, its newest apply a mark as applied, `found` where Filament found it in the folder itself, and `undo`, one
 *  that can be undone now) and reviewed (`reviewSubagent`: its row in Changes, open, where Apply says what it would do and applies them —
 *  the card's and the mark's "Review ›"); `subagentRow` is the store's row of a sub-agent, for the card
 *  of a call whose run stopped hearing of it, and `subagentsKnown` whether the store's list was answered — only then
 *  is a sub-agent it holds no row of one Filament forgot, whose end `subagentLogged` reads from its own run's log
 *  (HarnessV4_Tasks U1); an answer the list carries as a head is read in its agent's cards' form (`subagentCard`, the
 *  store's `card`). A saved agent's card (HarnessV4_Tasks E15 step 2) reads the two marks the chat holds of it
 *  (`cardMarks`: sent off, back), its whole answer where the chat holds only the list's clipped one (`cardAnswer`),
 *  stops it (`stopSubagent`), asks it again (`askAgain`: in its thread, or anew by its tag once Filament holds it no
 *  longer) and says which outside client writes the session's turns, if one does (`outsideClient`). The card of an
 *  agent the main agent asked (step 3) prepares your overrule of its answer (`overrule`: the line over the box) and
 *  reads the words you overruled it with (`overruledOf`). The card that launched or asked a helper says what it drew
 *  (`drewOf`, HarnessV4_Visuals_Plan VS-D50), and a picture opened under it writes its words into the message box
 *  (`visualWords`, VS-D51). An envelope's card (HarnessV4_Envelopes_Plan EN5) reads how it stands in the chat now
 *  (`envelopeState`: still sealed, as the store says, and the later turn that opened it) and opens whoever sent it — a
 *  team's chat beside this one (`openTeam`), a flow (`openFlow`), else the sub-agent. An agent's card the person
 *  hid stays off the chat, its answer seen (`cardClosed`, HarnessV4_Tasks_Logs E37); one whose agent runs again stands
 *  and says so at each paint, and once its row has left the document (`standing`). A sub-agent on another machine
 *  opens its chat there (`openOnMachine`: in place beside the left bar where the desktop app can, else on that
 *  machine's whole page; null where the page opens no other machine's). With nothing set
 *  (a test page, a card rendered outside the harness) a file chip copies its path instead, an image card shows no
 *  picture and a sub-agent card offers no link. */
/**
 * @type {{ open: ((path: string, range?: string) => void) | null, readFile: ((path: string) => Promise<any>) | null,
 *   openSubagent: ((id: string) => void) | null,
 *   subagentDelivery: ((id: string, exchange: number) => string | null | undefined) | null,
 *   sendSubagent: ((id: string, exchange: number) => Promise<void>) | null,
 *   watchSubagents: ((fn: () => void) => () => void) | null,
 *   subagentWork: ((id: string) => { pending: number, applied: number, hand?: boolean, found?: boolean, undo?: boolean } | null) | null,
 *   reviewSubagent: ((id: string) => void) | null,
 *   subagentRow: ((id: string) => import("../../lib/subagents.js").SubagentRow | null) | null,
 *   subagentsKnown: (() => boolean) | null,
 *   subagentLogged: ((sub: any) => import("../../lib/subagents.js").LoggedEnd | null | undefined) | null,
 *   subagentCard: ((id: string, exchange: number) => import("../../lib/subagents.js").SubagentExchange | null | undefined) | null,
 *   cardMarks: ((id: string, exchange: number) => { dispatch?: any, arrival?: any }) | null,
 *   cardAnswer: ((id: string, exchange: number) => Promise<string>) | null,
 *   cardOpen: { get: (id: string, exchange: number) => boolean, set: (id: string, exchange: number, open: boolean) => void } | null,
 *   cardClosed: { has: (id: string, exchange: number) => boolean, close: (id: string, exchange: number) => void,
 *     standing?: (row: HTMLElement, id: string, exchange: number, on: boolean) => void } | null,
 *   stopSubagent: ((id: string) => void) | null,
 *   askAgain: ((id: string, tag: string, question: string) => void) | null,
 *   outsideClient: (() => string | null) | null,
 *   overrule: ((o: { agentId: string, exchange: number, name: string, question: string, answer: string }) => void) | null,
 *   overruledOf: ((id: string, exchange: number) => { words: string } | null) | null,
 *   drewOf: ((id: string, exchange: number) => { chain: string, drew: import("../../lib/subagents.js").Drew[] } | null) | null,
 *   visualWords: ((text: string) => void) | null,
 *   madeOf: ((id: string, exchange: number) => import("../../lib/subagents.js").Made[]) | null,
 *   openArtifact: ((name: string) => void) | null,
 *   toBackground: ((runId: string, callId: string) => Promise<string | null>) | null,
 *   readCalls: ((runId: string, of: { round: number, parent: any }) => Promise<any[]>) | null,
 *   envelopeState: ((n: number) => { sealed: boolean | null, later: { turn: number, round: number, by: "tool" | "wait" } | null }) | null,
 *   openTeam: ((id: string) => void) | null,
 *   openFlow: ((id: string) => void) | null,
 *   openChat: ((chain: string) => void) | null,
 *   openOnMachine: ((machine: { id: string, name: string }, chat: string) => void) | null }}
 */
export const chipActions = {
  open: null, readFile: null, openSubagent: null, subagentDelivery: null, sendSubagent: null, watchSubagents: null, subagentWork: null, reviewSubagent: null,
  subagentRow: null, subagentsKnown: null, subagentLogged: null, subagentCard: null, cardMarks: null, cardAnswer: null, cardOpen: null, cardClosed: null, stopSubagent: null, askAgain: null, outsideClient: null,
  overrule: null, overruledOf: null, drewOf: null, visualWords: null, madeOf: null, openArtifact: null, toBackground: null, readCalls: null,
  envelopeState: null, openTeam: null, openFlow: null, openChat: null, openOnMachine: null,
};

/** A file chip: the leaf name, the path as its title. Click opens the file in the side pane (§5.7 B3). @param {string} path */
export function fileChip(path) {
  const leaf = String(path || "").split(/[\\/]/).pop() || path;
  return h("button", {
    class: "file-chip", type: "button", title: chipActions.open ? `${path} — open in the side pane` : path,
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!path) return;
      if (chipActions.open) chipActions.open(path);
      else if (navigator.clipboard) navigator.clipboard.writeText(path).catch(() => {});
    },
  }, leaf);
}

/** The honest facts a finished call may carry: chars and ms, never invented output. A call that never ran (refused,
 *  declined, vetoed, or one a stop came before) has neither: its chars would count the refusal's own words, its time
 *  the wait for an answer.
 *  @param {any} t */
export function factsOf(t) {
  if (t?.state === "refused" || t?.state === "declined" || t?.state === "vetoed" || t?.notRun) return "";
  const parts = [];
  if (t?.chars != null) parts.push(t.chars > 4000 ? `${Math.round(t.chars / 100) / 10}k chars` : `${t.chars} chars`);
  if (t?.ms != null && t.ms >= 1000) parts.push(`${(t.ms / 1000).toFixed(1)}s`);
  return parts.join(" · ");
}

/** Why a refused call did not run, for a card's facts line: the session rule, the pre-tool hook, or the loop's own
 *  reason (a refused `sleep`: HarnessV3-FixRound F1 item 2); "" for any other call. @param {any} t */
export function refusedWhy(t) {
  if (t?.state !== "refused") return "";
  return t.rule ? `rule ${t.rule}` : t.hook ? `hook ${t.hook}` : t.reason || "";
}

/** The failure word, or null when the call did not fail. Only Failed is destructive. @param {any} t */
export function statusOf(t) {
  if (t?.state === "failed") return { word: "Failed", title: t.error || "the call failed" };
  if (t?.state === "refused") return { word: "Refused", title: t.rule ? `refused by the session rule ${t.rule}` : t.hook ? `blocked by the pre-tool hook ${t.hook}` : t.reason ? `not run: ${t.reason}` : "refused by the permission mode", soft: true };
  if (t?.state === "declined") return { word: "Denied", title: "the developer declined", soft: true };
  if (t?.state === "vetoed") return { word: "Stopped", title: "vetoed by the developer", soft: true };
  if (t?.state === "stopped") return { word: "Stopped", title: t.notRun ? "not run: the turn was stopped before it started" : "stopped with the turn — its output so far is below", soft: true };
  // What its run's end left running (lib/labels.js alignEvents, HarnessV4_Tasks U1).
  if (t?.state === "cut") return { word: "Cut off", title: "Filament stopped while this call ran: its run ended without it, and its result was never recorded", soft: true };
  // The developer sent the running command to the background (HarnessV4_Four_Plan E21): it runs on as that shell.
  if (t?.background)
    return {
      word: "In the background",
      title: t.movedBy === "timeout" ? `It ran past its timeout, so Filament sent it to the background: it runs on as ${t.background}, and the agent is told when it ends` : `You sent it to the background: it runs on as ${t.background}, and the agent is told when it ends`,
      soft: true,
    };
  if (t?.state === "unfollowed") return { word: "Not followed", title: "this call was running when its turn's run ended, and the run heard no more of it: what followed is in the agent's own conversation, where Filament still holds one", soft: true };
  return null;
}
