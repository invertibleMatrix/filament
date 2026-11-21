// @ts-check
// The Run pane (proposal_ux §4.10, M1): this run, round by round, in three depths under one segmented control —
// Rounds, the spine (run.js: a station per round, its lamp, what it thought, said and met, the metrics and the replay);
// Calls, one card per model call of the chat (prompt.js), headed by the newest reply's record (last-reply.js, the
// Context pane's until R2); For developers, the token tiles, the table and the network (devtools.js), and what Filament
// did to the newest request. The part shown is the page's, the same in every chat: a door that opens the pane at a part
// ("Read it ›" opens Calls) picks it first. A coding agent's own requests do not pass through Filament: Calls says so,
// over Filament's own calls (rule 5).
import { h, morphChildren } from "../../lib/dom.js";
import { segmented } from "../widgets/kit.js";
import { renderRunPane as renderRounds, refreshRunPane as refreshRounds } from "./run.js";
import { renderPrompt, refreshPrompt } from "./prompt.js";
import { renderDevtools, refreshDevtools } from "./devtools.js";
import { renderLastReply, renderFilamentDid } from "./last-reply.js";

/** The pane's parts, in order. */
export const RUN_PARTS = Object.freeze([
  { id: "rounds", label: "Rounds", title: "One station per round: what it thought, said and met" },
  { id: "calls", label: "Calls", title: "Every model call of the chat; open one to read its request" },
  { id: "dev", label: "For developers", title: "The token table, the network, and what Filament did" },
]);

/** The part shown, the page's. */
let part = "rounds";

/** The part the pane shows next: a door picks it before it opens the pane. @param {string} id */
export function showRunPart(id) {
  if (RUN_PARTS.some((p) => p.id === id)) part = id;
}

/** @typedef {{ chat: any, setBadge?: (n: number) => void, config?: any, coder?: () => string }} RunPaneCtx */

/** @param {HTMLElement} body @param {RunPaneCtx} ctx */
export function renderRun(body, ctx) {
  const box = h("div", { class: "run-part" });
  const seg = segmented(h, { options: RUN_PARTS, value: () => part, onChange: (id) => { part = id; drawPart(box, ctx); }, ariaLabel: "What the Run pane shows" });
  body.append(h("div", { class: "pane-toolbar run-parts" }, seg.el), box);
  drawPart(box, ctx);
}

/**
 * The run's pulse, and a turn's end: the part drawn again in place — the spine by its own paint, the calls from their
 * brief cache with the cards left open still open. Typed in, it is drawn all the same: Calls' search is never drawn
 * over, so it keeps its word and its focus (a pulse that drew nothing while it had the focus left the part as the turn
 * ran — the developer's reviewer of 11-02).
 * @param {HTMLElement} body @param {RunPaneCtx} ctx
 */
export function refreshRun(body, ctx) {
  const box = /** @type {HTMLElement | null} */ (body.querySelector(".run-part"));
  // A door picked another part meanwhile: the control is drawn again with it.
  if (!box || box.dataset.part !== part) {
    body.replaceChildren();
    renderRun(body, ctx);
    return;
  }
  refreshPart(box, ctx);
}

/** Calls' note where a coding agent runs the chat: its own requests do not pass through Filament (rule 5). @param {RunPaneCtx} ctx */
const coderNote = (ctx) => {
  const coder = ctx.coder?.() || "";
  return coder ? h("p", { class: "pane-note run-greyed", "data-key": "coder" }, `${coder}'s own requests do not pass through Filament: these are Filament's own calls for this chat (memory, summaries, sub-agents).`) : null;
};

/** @param {HTMLElement} box @param {RunPaneCtx} ctx */
function drawPart(box, ctx) {
  box.dataset.part = part;
  box.replaceChildren();
  if (part === "rounds") {
    renderRounds(box, ctx);
    return;
  }
  if (part === "calls") {
    const head = h("div", { class: "run-last" });
    const list = h("div", { class: "run-calls" });
    box.append(...[coderNote(ctx), head, list].filter((x) => x != null));
    renderLastReply(head, ctx);
    renderPrompt(list, ctx);
    return;
  }
  const did = h("div", { class: "run-did" });
  const table = h("div", { class: "run-dev" });
  box.append(did, table);
  renderFilamentDid(did, ctx);
  renderDevtools(table, ctx);
}

/**
 * The part the box shows drawn again in place: each of its boxes stands and is filled anew — the pulse emptied the
 * part and made every part anew, the toolbar's buttons, the search field and every card new elements under a resting
 * pointer, an open card back to "Loading…" (the owner's of 11-01: buttons blinking under a resting pointer, clicks
 * lost).
 * @param {HTMLElement} box @param {RunPaneCtx} ctx
 */
function refreshPart(box, ctx) {
  if (part === "rounds") {
    refreshRounds(box, ctx);
    return;
  }
  if (part === "calls") {
    const head = /** @type {HTMLElement} */ (box.querySelector(".run-last"));
    const list = /** @type {HTMLElement} */ (box.querySelector(".run-calls"));
    morphChildren(box, [coderNote(ctx), head, list]);
    renderLastReply(head, ctx);
    refreshPrompt(list, ctx);
    return;
  }
  renderFilamentDid(/** @type {HTMLElement} */ (box.querySelector(".run-did")), ctx);
  refreshDevtools(/** @type {HTMLElement} */ (box.querySelector(".run-dev")), ctx);
}
