// @ts-check
// The conversation timeline: the conductor that owns the scroll region. Turns render
// through turn.js, thinking through reasoning.js, the empty state and the query-map rail are their own modules.
// Streaming updates only the open block (md-stream's cache); the follow rule re-arms inside 40px of the bottom and
// never fights an upward read; a finished turn's fold stays open until the chat's next turn starts, unless the
// developer opened or closed it by hand.
import { h, setHtml, placeChildren } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { mdChat } from "../lib/md-stream.js";
import { tailOpen } from "../lib/stream.js";
import { paintFences } from "../lib/highlighter.js";
import { renderDiagrams } from "../lib/diagrams.js";
import { alignEvents, toldWords, alignOnto, letGoOfLog, fillCalls, subsApart, shellExitWords, shouldFollow, websiteCardsFrom, fileChangePaths, SELECTION_LIMITS, shimLineOf, liveWords, cardBoxes, mergedCell, foldSplit, askedApart, cardAnchors, replyTextOf, compactionWords, compactionFacts, undoWords, endedStatus, steerWords, boxSteers, canTakeBack, roundCompactionWords, roundCompactingWords, turnPhaseWords, segmentsShown, splitNote, foldHeader, drawingStartsOver, pauseOf, settingsRowWords, askWaitWords, openTurnWords, lookWords, roundDrew, placeName, movedWords, copiedWords, steerFromWords, guideNoteWords, outsideGitWords, agentNoticeWords, ownCompacted, foldParts, wokeReplies, heardRounds, partSpans, partWords, foldSaysStopped, envelopeWords, envelopeOpenedWords, envelopeNoteWords, sentOnce } from "../lib/labels.js";
import { roundRows, askedRows, planCard, archivedRows, turnPictures, pictureStrip, keptRow, outputToEnd, revealCalls, foldCalls } from "./tools/render.js";
import { pictureThumb, pictureUrl } from "../lib/picture-view.js";
import { callsByLaunch, readCalls } from "../lib/run-calls.js";
import { chipActions } from "./tools/layout.js";
import { askCard, askFlag, askOf, errorBanner, limitCard, switchCard } from "./interaction.js";
import { signedOutBanner } from "../../lib/accounts.js";
import { engineDividers, loopWaitWords, orderRows, taskNote, waitWords, workerCalled } from "../lib/team.js";
import { listEndsKey } from "../lib/subagents.js";
import { engineDivider, engineSig, orderRowsEl } from "./team-turns.js";
import { api } from "../lib/api.js";
import { claimWords } from "../../lib/claims.js";
import { runChanges } from "../lib/turn-changes.js";
import { createFetchQueue } from "../lib/fetch-queue.js";
import { onceAFrame } from "../lib/once-a-frame.js";
import { nextFrame } from "../lib/weak-frame.js";
import { createStreamPace } from "../lib/stream-pace.js";
import { ICONS } from "../lib/icons.js";
import { userRow, ownRow, resumedRow, goalRoundRow, wokeRow, syncRow, teamResultRow, watchedRow, guidedRow, guideCard, reviewedChip, flowSaidRow, briefRow, deliveredEl, unusedEl, flowOfferEl, planOfferEl, planReadyEl, useEl, flowEl, parallelEl, planEl, markNamed, workFold, afterFold, tallyBetween, footerEl, treeCard, TREE_ROWS, outsideLine, shimNote, commandAnswer } from "./turn.js";
import { takeWork, heldWords, endedCompactions, composedCompactions, isOwnDuring, ownRowOf, unsent, newestOnRecord, turnNumbered, cardStands } from "./history.js";
import { overruleMark } from "../composer/overrule-line.js";
import { compactingRow } from "./compacting.js";
import { waitingOnRow } from "./waiting-on.js";
import { createLiveLine } from "./live-line.js";
import { memoryNoteEl } from "./cards.js";
import { filesRewoundRow, rewoundRow } from "./rewound.js";
import { followStore, subagentMarkRow } from "./subagent-marks.js";
import { besideMarkRow } from "./beside-marks.js";
import { sideOfferRow } from "./side-offer.js";
import { heldAnswered, heldLaunchRow, heldRound } from "./held-launch.js";
import { thinkEl } from "./reasoning.js";
import { visualCard } from "./visual.js";
import { artifactCard } from "./artifact.js";
import { createEmptyState } from "./empty.js";
import { createNavigator } from "./navigator.js";
import { quoteButton } from "./quote-button.js";
import { waitsForYou } from "../lib/overview.js";
import { pageShown } from "../lib/page-shown.js";

/** How many turns render before the "load earlier" button. The archive answers one payload; slicing is client-side. */
const PAGE = 60;
/** How many of a run's events one read of a finished turn's run brings. */
const RUN_PAGE = 5000;
/** The live view's loss in words, as the turn says it and the page keeps it (the filament-agent plan's Phase 4b). */
export const LIVE_LOST_WORDS = "Live view lost — reconnecting…";

/** A new block fades in once: the class leaves when its own fade ends, so a later move — the fold taking the
 *  previous round when the next text starts, the fold's rebuild at finish — never plays the fade again. Out of sight
 *  it comes as it is: no animation starts there (page-shown.js `stillWhileHidden`), and one held for the page's return
 *  would play then, every block drawn meanwhile at once. One whose fade the page's hiding stopped leaves it too.
 *  @param {HTMLElement} el */
function arriveOnce(el) {
  if (!pageShown()) return;
  el.classList.add("arrive");
  const done = (/** @type {Event} */ e) => {
    if (e.target !== el) return; // a child's own animation, bubbling
    el.classList.remove("arrive");
    el.removeEventListener("animationend", done);
    el.removeEventListener("animationcancel", done);
  };
  el.addEventListener("animationend", done);
  el.addEventListener("animationcancel", done);
}

/** A turn's banner dismissed: off the page and no longer the turn's, so neither the turn's next lay-out, the chat drawn
 *  again nor a read of it brings it back (the page's own turn keeps the word, and a read's copy of it takes it — app.js
 *  `keptOfTurn`; a reload shows it again).
 *  @param {any} turn @param {any} v  the turn's view */
const dismissOf = (turn, v) => () => {
  v.shim?.remove();
  v.shim = null;
  turn.shimDismissed = true;
};

/** Each fold's view, the one that drew it last: its toggle asks `showCopies` of that view and holds none itself — a
 *  listener closing over the view it was first heard for kept that view, and every row it drew, for the fold's life.
 *  @type {WeakMap<object, any>} */
const copiesOf = new WeakMap();
const copiesToggled = (/** @type {Event} */ e) => {
  const v = copiesOf.get(/** @type {object} */ (e.currentTarget));
  if (v) showCopies(v);
};

/** The pictures' strips watched for their first size (`shotsToNewest`), each with its watch. @type {Set<{ strip: HTMLElement, watch: ResizeObserver }>} */
const stripWatches = new Set();
/**
 * The watches of strips no longer on the page ended: one drawn where it never showed — under open folds, its chat
 * under the Plan — never had a size to say, and its watch held it, and the turn's whole drawing above it, for the
 * page's life (Fable 5.2's review of 11-17). Asked as a strip is replaced, watched, or a chat drawn anew.
 */
function letStripsGo() {
  for (const w of stripWatches)
    if (!w.strip.isConnected) {
      w.watch.disconnect();
      stripWatches.delete(w);
    }
}

/**
 * The strip's newest picture in view, once, the first time it shows: the row scrolls back to the earlier ones. One
 * drawn hidden — the turn's folds open, the chat under the Plan — has nothing to scroll until it shows, its size
 * then said (the review of 989fa6739: a turn closed while the Plan stood over the chat opened on its oldest).
 * @param {HTMLElement} strip
 */
function shotsToNewest(strip) {
  if (typeof ResizeObserver === "undefined") return;
  const watch = new ResizeObserver(() => {
    if (strip.isConnected && !strip.scrollWidth) return;
    if (strip.isConnected) strip.scrollLeft = strip.scrollWidth;
    watch.disconnect();
    stripWatches.delete(w);
  });
  const w = { strip, watch };
  stripWatches.add(w);
  watch.observe(strip);
}

/**
 * The box's copy of a message the work holds too (`is-inline`, paintSteers) shows while the fold that holds the
 * message is closed, and only then: a fold after the agent compacted its context, closed, showed every copy while
 * the work's own fold stood open on the messages themselves — each was drawn twice (the owner's of 11-05). Asked
 * again as any of the turn's folds opens or closes. A split's box of messages hides whole while the fold over it is
 * open, the message standing at that fold's foot. @param {any} v
 */
function showCopies(v) {
  for (const f of [v.fold?.el, ...(v.parts || []).map((/** @type {any} */ p) => p?.el)]) {
    if (!f) continue;
    copiesOf.set(f, v);
    if (f.copiesHeard) continue;
    f.copiesHeard = true;
    f.addEventListener("toggle", copiesToggled);
  }
  for (const el of v.steerEls || []) {
    if (!el.classList.contains("is-inline")) continue;
    // A turn with no fold to close shows none: its message stands in view where it joined.
    const fold = v.partFolds ? v.partFolds(Number(el.dataset?.round) || 0) : v.fold?.el;
    el.classList.toggle("is-shown", !!fold && !fold.open);
  }
  for (const box of v.heardBoxes?.values() || []) box.classList.toggle("hidden", ![...box.childNodes].some((/** @type {any} */ el) => el.classList?.contains("is-shown")));
  // The pictures' strip under the work hides once every fold of the turn is open: the cards show each picture then.
  const folds = [v.fold?.el, ...(v.parts || []).map((/** @type {any} */ p) => p?.el)].filter((f) => f && f.parentNode === v.group);
  v.group?.classList.toggle("folds-open", folds.length > 0 && folds.every((f) => f.open));
}

/** A text block's DOM: markdown through the cache; only the open tail re-draws while it streams. Exported for its test. */
export function blockEl(block) {
  const el = h("div", { class: "a-md" });
  /** The markdown blocks drawn, in order: the markup each was drawn from, and how many of the element's nodes it made. @type {{ html: string, nodes: number }[]} */
  let drawn = [];
  // The blocks whose markup stands keep their nodes — a fence painted, a diagram drawn, a selection in them — and only
  // what follows the last of them is drawn again: the open block the stream grows, and one it began. Setting the whole
  // message's markup each frame parsed and laid out every word of it again, so a word cost more the longer the reply.
  const paint = () => {
    const r = mdChat(block.text, block.mdCache || null);
    block.mdCache = { blocks: r.blocks, html: r.html };
    let keep = 0;
    while (keep < drawn.length && keep < r.html.length && drawn[keep].html === r.html[keep]) keep++;
    const at = drawn.slice(0, keep).reduce((n, d) => n + d.nodes, 0);
    while (el.childNodes.length > at) /** @type {ChildNode} */ (el.lastChild).remove();
    drawn = drawn.slice(0, keep);
    for (const html of r.html.slice(keep)) {
      const before = el.childNodes.length;
      el.insertAdjacentHTML("beforeend", html);
      drawn.push({ html, nodes: el.childNodes.length - before });
    }
  };
  // `draw()` runs at the reply's pace (lib/stream-pace.js, ten a second while the block grows); a paint rewrites the
  // open block's markup each time. Painted per delta, at stream speed that backed the main thread up (a re-parse and
  // layout per token), so the paint stalled and then a batch landed at once — the visible "stop → pop". The paint is
  // made at the next animation frame, with the turn's lay-out. `flush()` forces the synchronous paint (a finished turn,
  // a test) so the final text never waits a frame. The frame holds the block weakly (lib/weak-frame.js): a window that
  // gets no frames kept each block's drawing, and the turn around it, till frames came back (the owner's of 11-17).
  let due = false;
  const handle = {
    el,
    draw: () => {
      if (due) return;
      due = true;
      nextFrame(handle, paintDue);
    },
    flush: () => {
      due = false;
      paint();
    },
    /** The paint the frame asked for, unless a flush made it. */
    due: () => {
      if (!due) return;
      due = false;
      paint();
    },
  };
  paint();
  return handle;
}
/** A block's paint at its frame: a function of the handle alone, so the frame holds nothing drawn. @param {{ due: () => void }} b */
const paintDue = (b) => b.due();

/** One round's rows: the grouped stubs, then the plan card and the round's notes. The snapshot line and the
 *  files-changed card are NOT per-round: each writing round snapshots, so they would repeat per round (an edit's
 *  pencil chip already carries its own diff and +/-). They are aggregated once per turn in placeCards. `lead`: a
 *  team's lead answered the turn, and the graph's rows say so. A settled turn's rows leave out the saved agents its
 *  main agent asked: their cards stand outside the fold (placeCards). `turnAt`: the turn's chat and number, where
 *  an edit card asks its call's own change (HarnessV4_Four_Plan E22). `drawn`: the turn's rows drawn last, kept while
 *  what each is drawn from holds (render.js `DrawnRows`) — a call's, and a message the loop read. An agent's thread
 *  draws its rounds with it too (subagent-viewer.js, the transcript audit of 2026-10-23): its asks stay in place
 *  (`asksApart` false: no fold stands for them there) and it draws the messages its run read itself (`steers`); its
 *  envelopes are numbered in a session of its own, so their cards know only its run (`ownChat` false, EN5). `works`:
 *  the turn's work goes on — not waiting for the person (overview.js `waitsForYou`) —, the plan card's spinner turning.
 *  Exported for its test and the thread.
 *  @param {any} cell
 *  @param {{ onPlan?: any, onUndo?: any, onPrompt?: any, runId?: any, turnAt?: import("./tools/render.js").TurnAt | null, live?: boolean, works?: boolean, lead?: boolean, drawn?: import("./tools/render.js").DrawnRows | null, asksApart?: boolean, steers?: boolean, ownChat?: boolean }} o */
export function cardsEl(cell, { onPlan, onUndo, onPrompt, runId, turnAt = null, live = false, works = live, lead = false, drawn = null, asksApart = !live, steers = true, ownChat = true }) {
  const rows = roundRows(cell, { onPrompt, runId, turnAt, asksApart, drawn, live });
  // The round's other rows are kept while what they say holds, as its calls' are: drawn again on every run event, a
  // row the reader opened shut again and played its arrival once more. Keyed by the round they came from — a box of
  // several rounds by its last (labels.js `mergedCell`), so two such boxes never draw one row.
  const noted = cell.round ?? cell.notesRound;
  /** @param {string} kind @param {any[]} list @param {(x: any) => Node | null} make */
  const kept = (kind, list, make) => {
    list.forEach((x, i) => {
      const row = keptRow(drawn, `${kind}:${noted}:${i}`, JSON.stringify(x) ?? "", () => /** @type {any} */ (make(x)));
      if (row) rows.push(row);
    });
  };
  // Its step in progress spins while the turn's work goes on: drawn again as the turn settles, or waits for the person.
  if (cell.plan?.length) kept("plan", [{ plan: cell.plan, live: works }], (x) => planCard(x.plan, onPlan, x.live));
  kept("hook", cell.hooks || [], hookCard);
  kept("mark", cell.marks || [], subagentMarkRow);
  kept("detach", cell.detaches || [], detachNote);
  kept("look", cell.looks || [], (k) => lookNote(k, lead));
  kept("report", cell.reports || [], (r) => reportNote(r, lead));
  // Other agents' results sealed while the agent worked (HarnessV4_Envelopes_Plan EN5): a card each where it landed;
  // where one sealed in an earlier turn was opened; Filament's word on the ones still sealed.
  kept("envelope", cell.envelopes || [], (e) => envelopeCard(e, ownChat));
  kept("opened", cell.opens || [], envelopeOpenedRow);
  kept("env-note", cell.envelopeNotes || [], (k) => h("div", { class: "tool-note env-note" }, envelopeNoteWords(k)));
  kept("told", cell.told || [], toldNote);
  kept("compaction", cell.compactions || [], compactionNote);
  if (live && cell.compacting) rows.push(h("div", { class: "tool-note compaction-note" }, h("span", { class: "work-state gradient" }, roundCompactingWords(cell.compacting))));
  // BUG-13: a message the loop has read stands where it joined — after this round's work, before the next round's
  // words — not in the box at the bottom; settled too (the owner's of 10-29: at the turn's end they jumped below the
  // words that came after them), the box's copy then showing only while the work is folded away (`paintSteers`).
  // Its pictures are your own, drawn again on every run event: kept while it holds (a picture's bytes by their size).
  if (steers) for (const s of cell.steers || []) if (s.read) rows.push(keptRow(drawn, `steer:${s.id}`, JSON.stringify(s, (k, x) => (k === "src" && typeof x === "string" && x.length > 200 ? `${x.length}:${x.slice(-64)}` : x)), () => steerEl(s)));
  if (cell.vetoed) rows.push(h("div", { class: "tool-note veto" }, `✎ the developer vetoed ${cell.vetoed} call${cell.vetoed === 1 ? "" : "s"} this round before any ran`));
  return rows;
}

/**
 * Open on an envelope's card or row: whoever sent it — a team's chat beside this one, a flow, the chat that wrote a
 * letter, else the sub-agent's thread, where its report is whole, or the letter it wrote among its work. Null where the
 * page offers no way there.
 * @param {{ agentId: string, via?: "team" | "flow" | "chat" | "steer" | "agent" }} e
 */
function envelopeOpen(e) {
  const go = e.via === "team" ? chipActions.openTeam : e.via === "flow" ? chipActions.openFlow : e.via === "chat" ? chipActions.openChat : chipActions.openSubagent;
  if (!go || !e.agentId) return null;
  const title = e.via === "team" ? "Open the team's chat: its result whole" : e.via === "flow" ? "Open the flow: its end whole" : e.via === "chat" ? "Open the chat that wrote it" : e.via === "agent" ? "Open the sub-agent that wrote it" : "Open its conversation: its report whole";
  return h("button", { class: "subagent-open", type: "button", title, onclick: () => go?.(e.agentId) }, "Open");
}

/**
 * An envelope's card (HarnessV4_Envelopes_Plan EN5): another agent's result that reached the agent sealed while it
 * worked — its number, who sent it and its subject — and how it stands. Opened in its own run, it says the step; else
 * it follows the page's store of the session's sealed envelopes and the chat's later turns until it is opened — in
 * the open chat's own timeline (`ownChat`); an agent's thread numbers its envelopes in a session of its own, so its
 * card says what its run knows. Exported for its test.
 * @param {{ n: number, agentId: string, description: string, sender: string, subject: string, via?: "team" | "flow" | "chat", opened: { round: number, by: "tool" | "wait" } | null }} e
 * @param {boolean} [ownChat]
 */
export function envelopeCard(e, ownChat = true) {
  const ic = h("span", { class: "env-ic", "aria-hidden": "true" });
  const state = h("span", { class: "env-state" });
  const first = envelopeWords(e);
  const row = h("div", { class: "tool-note env-card", title: e.sender ? `From ${e.sender}` : "" },
    ic,
    h("span", { class: "env-text" },
      h("span", { class: "env-head" }, first.head),
      first.subject ? h("span", { class: "env-subject" }, first.subject) : null),
    state,
    envelopeOpen(e));
  const paint = () => {
    const w = envelopeWords(e, ownChat ? chipActions.envelopeState?.(e.n) || {} : { alone: true });
    state.textContent = w.state;
    row.classList.toggle("is-opened", w.opened);
    row.classList.toggle("is-sealed", !w.opened);
    setHtml(ic, w.opened ? ICONS.mailOpen : ICONS.mail);
  };
  paint();
  // One its own run opened stands as it is; one still sealed here hears the store until it opens.
  if (ownChat && !e.opened && chipActions.envelopeState) followStore(row, paint);
  return row;
}

/** Where the agent opened an envelope sealed in an earlier turn (EN5). @param {{ n: number, agentId: string, description: string, via?: "team" | "flow" | "chat", by: "tool" | "wait" }} o */
function envelopeOpenedRow(o) {
  return h("div", { class: "tool-note sub-report sub-mark env-opened" },
    h("span", { class: "sub-mark-ic", "aria-hidden": "true", html: ICONS.mailOpen }),
    h("span", { class: "sub-mark-text" }, envelopeOpenedWords(o)),
    envelopeOpen(o));
}

/**
 * A box of a turn's cards as its rounds had it, its rows put in place — only one out of place moves — else a new box.
 * Drawn anew on every run event, the turn's work went and came back at each call (the owner's words of 10-18).
 * @param {Map<number, HTMLElement> | null | undefined} boxes  the turn's boxes, by their first round @param {number} round
 * @param {HTMLElement[]} rows
 */
export function keptBox(boxes, round, rows) {
  const box = boxes?.get(round) || h("div", { class: "cards" });
  placeChildren(box, rows);
  return box;
}

/**
 * The command outputs of a turn once its cards are placed: one a move put back at its top (a row going into a group
 * drawn anew) is given its place back, and one drawn now starts at its end in this frame — its own wait for the next
 * showed its top for one, at each call. `before`: each output and where it stood, read before the cards were drawn.
 * @param {[HTMLElement, number][]} before @param {HTMLElement | null | undefined} root
 */
export function keepOutputs(before, root) {
  for (const [p, top] of before) if (top > 0 && p.isConnected && !p.scrollTop) p.scrollTop = top;
  // One in a row still closed goes to its end as its row opens (`outputToEnd`): each read of a closed row's output laid
  // that row out on its own, and a long running turn drawn whole — its chat shown again — holds thousands.
  for (const p of Array.from(root?.querySelectorAll?.("pre.term-out[data-end]") || [])) outputToEnd(/** @type {HTMLElement} */ (p));
}

/**
 * What the agent told the person beside its answer (HarnessV4_Tasks C21; ACP's session notices): each on a line of its
 * own under the turn's words, live and settled, never folded with the work — a model fallback, a hook that blocked the
 * turn, Fast mode turned off — in its severity's tone. None of the reply's words.
 * @param {{ severity: string, title: string, description?: string, subagent?: boolean }[]} notices
 */
export function noticesEl(notices) {
  return h("div", { class: "agent-notices" }, ...notices.map((n) => {
    const { tone, words } = agentNoticeWords(n);
    return h("div", { class: `agent-notice is-${tone}`, role: "note" }, h("span", { class: "agent-notice-ic", html: ICONS.info }), h("span", { class: "agent-notice-words" }, words));
  }));
}

/**
 * A compaction in the round, in words; an agent's own opens on the summary it kept, where it said one (HarnessV3-ACP
 * AC5-7). @param {any} k
 */
/**
 * A folder's instruction file told as the agent first worked there (the Designer's answer of 10-27): one quiet line,
 * opening to the text it was told. @param {{ file: string, as: string, how: string, text: string }} t
 */
function toldNote(t) {
  return h("details", { class: "tool-note told-note compaction-kept" },
    h("summary", { title: "What the agent was told, with this round's results" }, h("span", {}, toldWords(t)), h("span", { class: "work-chev", html: ICONS.chevronRight })),
    h("div", { class: "compaction-kept-text" }, t.text));
}

function compactionNote(k) {
  const words = roundCompactionWords(k);
  if (!k.own || !k.summary) return h("div", { class: "tool-note compaction-note" }, words);
  return h("details", { class: "tool-note compaction-note compaction-kept" },
    h("summary", { title: "What it kept: the summary its session goes on from" }, h("span", {}, words), h("span", { class: "work-chev", html: ICONS.chevronRight })),
    h("div", { class: "compaction-kept-text" }, String(k.summary)));
}

/**
 * A compaction's row in words: what it did, its kind where it is not plain, then its figures (before → after, who
 * wrote it), else its summary's size. `here`: on the turn it fell in (compactionWords).
 * @param {any} b @param {{ here?: boolean }} [o]
 */
const compactionRowWords = (b, o) =>
  `⌁ ${compactionWords(b, o)}${b.kind && b.kind !== "plain" ? ` (${b.kind})` : ""}${compactionFacts(b) || (b.chars ? ` · ${b.chars >= 1000 ? `${Math.round(b.chars / 1000)}k` : b.chars} chars` : "")}`;

/**
 * A coding agent's own compaction in the middle of a turn, where it happened (the owner's words of 10-18: "it should sit
 * where it happened"): the compaction's row in the turn's work, not between turns — shown the moment the agent's
 * compaction ends, kept on the turn after it ends with its work folded on either side (`foldParts`). While the turn
 * runs it says what the agent said of it (`k`, the run's event: the figures, the summary it kept); once the server has
 * written the chat's row for it (`b`, C28 — read as the turn ended, or with the chat) the row's words, what Filament's
 * copy does with it. The summary opens behind Show summary, as the row's does.
 * @param {any} k @param {any} b
 */
function ownCompactionRow(k, b) {
  const label = h("span", { class: "boundary-label" }, b ? compactionRowWords(b, { here: true }) : roundCompactionWords(k));
  const kept = String(b?.text || k?.summary || "");
  if (!kept) return h("div", { class: "boundary is-compaction is-here" }, h("div", { class: "boundary-row is-compaction" }, label));
  const text = h("div", { class: "boundary-text" }, kept);
  text.hidden = true;
  const toggle = h("button", {
    class: "boundary-toggle", type: "button",
    onclick: () => {
      text.hidden = !text.hidden;
      toggle.textContent = text.hidden ? "Show summary" : "Hide summary";
    },
  }, "Show summary");
  return h("div", { class: "boundary is-compaction is-here" }, h("div", { class: "boundary-row is-compaction" }, label, toggle), text);
}

/**
 * A message from the sub-agent machinery that joined the conversation before this round: a finished sub-agent's
 * report (one the developer kept aside and sent on, `sent`), or the developer's launch announced. Its name opens the
 * sub-agent's conversation. Or (`shell`) a background shell that exited unread: `agentId` is the shell, `description`
 * its command. Or (`task`) the task graph's words: a task's end and how it stands now, or the tasks Filament started —
 * in the words of whoever plans: a team's lead (`lead`), else the agent.
 * Or (`overrule`) the developer overruled a saved agent's answer: `description` is that agent's name.
 * Or (`applied`) the developer applied a sub-agent's changes, and the agent read which files changed under it.
 * Or (`check`) what came of Filament's check of the folder after the lead applied a worker's change, where its call
 * answered before the verdict (HarnessV3-TaskGraph-v2 TG2-D55).
 * Or (`told`) the developer's own words to one of its workers or sub-agents, past it (HarnessV4_Tasks decision 10).
 * Or (`result`) a team's result beside the chat, or a flow's end, which reached the agent as a sub-agent's report does
 * (HarnessV4_Envelopes_Plan EN4).
 * @param {{ agentId: string, kind: "report" | "notice" | "shell" | "task" | "overrule" | "applied" | "check" | "told" | "result", description: string, sent?: boolean, code?: number | null, task?: string, state?: string }} r
 * @param {boolean} lead
 */
function reportNote(r, lead) {
  // A background shell that ended unread (TL-D24): the shell, its command and its code, and that the agent was told.
  if (r.kind === "shell") return h("div", { class: "tool-note sub-report" }, shellExitWords(r));
  // Your overrule of a saved agent's answer (HarnessV4_Tasks E15 step 3): where the main agent read whose answer
  // your words stand over.
  if (r.kind === "overrule")
    return h("div", { class: "tool-note sub-report sub-mark" },
      h("span", { class: "sub-mark-ic" }, "↳"),
      h("span", { class: "sub-mark-text" }, `The main agent read here that you overrule ${r.description || "a saved agent"}'s answer`));
  const who = r.description ? `“${r.description}”` : r.agentId;
  const open = chipActions.openSubagent
    ? h("button", { class: "subagent-open", type: "button", title: "Open its conversation", onclick: () => chipActions.openSubagent?.(r.agentId) }, "Open")
    : null;
  // Filament's own notice — a flow's start, or the word of a flow it drives In place (HarnessV4_OneAgent_Plan OA3, OA4):
  // no agent of yours to open.
  if (r.kind === "notice" && !r.agentId) return h("div", { class: "tool-note sub-report is-filament" }, `↳ The main agent read Filament's word here: ${r.description || "a notice"}`);
  if (r.kind === "notice") return h("div", { class: "tool-note sub-report" }, `↳ The main agent heard of your agent ${who} before this step`, open);
  // Your apply of a sub-agent's changes (HarnessV4_Tasks E15 step 5, BW-8): where the main agent read which files
  // changed under it.
  if (r.kind === "applied") return h("div", { class: "tool-note sub-report" }, `↳ The main agent read here that you applied the changes of ${who}`, open);
  // The folder's verdict after the lead's apply, where its call answered first (TG2-D55): where the lead read it.
  if (r.kind === "check") return h("div", { class: "tool-note sub-report" }, `↳ The lead read here how Filament's check of the folder went with ${who}'s change`, open);
  // Your words to one of its workers, past it (HarnessV4_Tasks decision 10): where the lead read what you told it.
  if (r.kind === "told") return h("div", { class: "tool-note sub-report" }, `↳ ${lead ? "The lead" : "The main agent"} read here what you told ${who}`, open);
  // A team's result or a flow's end (EN4): its card beside the chat is where it opens, not an agent of yours.
  if (r.kind === "result")
    return h("div", { class: "tool-note sub-report sub-mark tone-ok" },
      h("span", { class: "sub-mark-ic" }, "✓"),
      h("span", { class: "sub-mark-text" }, `The result of ${r.description || "a team beside this chat"} joined the conversation here`));
  // The task graph's words reached whoever plans here (HarnessV3-TaskGraph G2-11, G3-7): a task's end — done, failed,
  // or stopped and waiting again, its work or its review — with Open for the sub-agent or worker that ran it; or the
  // tasks Filament started.
  if (r.kind === "task") {
    const w = taskNote(r, who, lead);
    return h("div", { class: `tool-note sub-report sub-mark${w.tone ? ` tone-${w.tone}` : ""}` },
      h("span", { class: "sub-mark-ic" }, w.ic),
      h("span", { class: "sub-mark-text" }, w.text),
      r.agentId ? open : null);
  }
  // A report reaching the main agent is an arrival, drawn as one — the green check of the arrival rows — not the faint
  // line of a hook or a snapshot note (the owner "did not see a chip"; the UI/UX review, 2026-09-30). While Filament
  // holds the agent it is said by its card's name (HarnessV4_Tasks E15): one asked by its tag answered, any other
  // reported.
  const known = chipActions.subagentRow?.(r.agentId) || null;
  const name = known?.card?.name || "";
  const words = known?.asked
    ? r.sent ? `${name}'s answer, which you sent on, joined the conversation here` : `${name} answered — its answer joined the conversation here`
    : r.sent ? `The report of ${name || "agent"} ${who} you sent on joined the conversation here` : `${name || "Agent"} ${who} reported — its report joined the conversation here`;
  return h("div", { class: "tool-note sub-report sub-mark tone-ok" },
    h("span", { class: "sub-mark-ic" }, "✓"),
    h("span", { class: "sub-mark-text" }, words),
    open);
}

/**
 * A look the lead was shown at its workers (HarnessV3-TaskGraph-v2 TG2-D22), or the agent at its graph's sub-agents
 * (V2-0c): whom, their rounds since the look before and their signs, and the look's size; each one opens its
 * conversation, where what the look showed is its rounds. `lead`: a team's lead read it.
 * @param {{ workers: { id: string, fromRound: number, toRound: number, signs: string[] }[], tokens: number }} k
 * @param {boolean} lead
 */
function lookNote(k, lead) {
  const w = lookWords(k, { lead, roleOf: (id) => { const r = chipActions.subagentRow?.(id); return r?.team?.role ? workerCalled(r) || String(r.team.role).charAt(0).toUpperCase() + String(r.team.role).slice(1) : ""; } });
  return h("div", { class: "tool-note sub-report sub-mark look-note", title: "What it was shown is each one's rounds since the look before: open its conversation to read them" },
    h("span", { class: "sub-mark-ic look-ic", html: ICONS.eye }),
    h("span", { class: "sub-mark-text" }, `${w.head}${w.size ? ` · ${w.size}` : ""}`),
    ...w.workers.map((x) => chipActions.openSubagent
      ? h("button", { class: "subagent-open look-worker", type: "button", title: "Open its conversation", onclick: () => chipActions.openSubagent?.(x.id) }, x.text)
      : h("span", { class: "look-worker" }, x.text)));
}

/**
 * The developer sent a sub-agent the main agent was waiting on to the background (Run in background, once Detach):
 * where its report goes, and Open.
 * @param {{ agentId: string, report: boolean, description: string }} d
 */
function detachNote(d) {
  const who = d.description ? `“${d.description}”` : d.agentId;
  const open = chipActions.openSubagent
    ? h("button", { class: "subagent-open", type: "button", title: "Open its conversation", onclick: () => chipActions.openSubagent?.(d.agentId) }, "Open")
    : null;
  return h("div", { class: "tool-note sub-report" },
    d.report
      ? `↳ You sent ${who} to the background — it keeps running; its report joins the conversation when it finishes`
      : `↳ You sent ${who} to the background — it keeps running; its report comes to you`,
    open);
}

/**
 * A hook's card (HarnessV2 §5.6): the event and tool, the command, the verdict with the exit code or the timeout,
 * and the note when the hook left one. A block reads as a stop; a builtin (loop.verify) is named as Filament's own.
 * @param {any} k  a `hook` run event
 */
function hookCard(k) {
  const where = `${k.on}${k.tool ? `(${k.tool})` : ""}`;
  const how = k.timedOut ? "timed out" : k.exit == null ? "did not run" : `exit ${k.exit}`;
  const verdict = k.verdict === "block" ? "blocked" : k.rewrote ? "allowed, input rewritten" : "allowed";
  const note = k.note ? String(k.note).split("\n")[0].slice(0, 200) : "";
  return h("div", { class: `tool-note hook ${k.verdict === "block" ? "veto" : ""}`, title: k.note ? String(k.note).slice(0, 1000) : "" },
    `⚓ hook ${where}: ${k.builtin ? `Filament's ${k.builtin}` : String(k.command || "").slice(0, 80)} → ${verdict} (${how}, ${k.ms ?? 0} ms)${note ? ` — ${note}` : ""}`);
}

/** @typedef {{ path: string, place?: string, agent?: string, added?: number, removed?: number, via?: string }} FileRow */
/**
 * A file card's rows: what they are drawn from as its newest answer has them, the lines under them (`tail`), and
 * whether they stand on its list. They stand while the card is open, and while Find's words match one of them
 * (`found`, `revealFiles`): a closed card drew every row whatever it held (the owner's of 11-17: one turn's card held
 * 78,058 rows — 530,000 nodes — under the tree card that stands in for it, drawn again at each placing of its turn).
 * Held by the card, never by a handler made beside it. A turn of more files than FILES_FIRST reads its first rows alone
 * (`more`: how many it left out), its counts whole; `whole`: it holds every row, or has nothing more to read — `read`,
 * its first read, and `readWhole`, the rest, read once (Show all, and Find before it searches: `readWork`).
 * @typedef {{ rows: FileRow[], folder: string | null, list: HTMLElement, tail: HTMLElement[], onChanges?: (f: { path: string, place: string | null, agent: string }) => void, painted: boolean, found?: string,
 *   more: number, whole: boolean, read: Promise<void>, readWhole: () => Promise<boolean> }} FileRows
 * @type {WeakMap<Element, FileRows>}
 */
const fileRowsOf = new WeakMap();
/**
 * The rows a files card reads of its run's answer at first: a turn of more draws these and a row that reads the rest
 * (the owner's of 11-17: one turn's answer was 22.8 MB, 77,842 rows, read and held for a card most often hidden under its
 * tree card). A turn of these or fewer reads every row at once.
 */
export const FILES_FIRST = 500;

/**
 * What a file's row says, a string a span: what its row draws, and what Find's words are matched against while it is
 * not drawn — one reading for both, so they say the same. @param {FileRow} f @param {string | null} folder
 */
function fileRowWords(f, folder) {
  const leaf = f.path.split(/[\\/]/).pop() || f.path;
  const added = Number(f.added) || 0;
  const removed = Number(f.removed) || 0;
  return {
    leaf,
    added: added ? `+${added}` : "",
    removed: removed ? `−${removed}` : "",
    path: leaf !== f.path ? f.path : "",
    where: f.place && folder && f.place !== folder ? `in ${placeName(f.place)}` : "",
    via: f.via === "command" ? "via a command" : "",
  };
}

/** A file's row. @param {FileRow} f @param {FileRows} st */
function fileRowEl(f, st) {
  const w = fileRowWords(f, st.folder);
  const onChanges = st.onChanges;
  const open = onChanges ? () => onChanges({ path: f.path, place: f.place || null, agent: f.agent || "" }) : null;
  return h("button", { class: "file-row", type: "button", title: `${f.place && w.where ? `${f.place}/` : ""}${f.path}${open ? " — open in Changes" : ""}`, onclick: () => open?.() },
    h("span", { class: "file-leaf" }, w.leaf),
    h("span", { class: "file-counts" }, ...[w.added ? h("span", { class: "fc-add" }, w.added) : null, w.removed ? h("span", { class: "fc-del" }, w.removed) : null].filter((x) => x !== null)),
    w.path ? h("span", { class: "file-path" }, w.path) : null,
    w.where ? h("span", { class: "file-place" }, w.where) : null,
    w.via ? h("span", { class: "file-via", title: "its commands changed this file, not its edit calls; only this chat works in this folder, so it counts as its own" }, w.via) : null);
}

/** The row after a card's first rows that reads the rest, and draws them once in. @param {FileRows} st */
function showAllEl(st) {
  const all = st.rows.length + st.more;
  /** @param {Event} e */
  const press = (e) => {
    const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
    const focused = document.activeElement === btn;
    const at = st.rows.length;
    btn.disabled = true;
    btn.textContent = `Reading all ${fmt.n(all)} files…`;
    void st.readWhole().then((read) => {
      // Drawn as it landed: the focus, where it stood on this row and nothing took it meanwhile, goes to the first row
      // it brought, where it stands.
      const now = document.activeElement;
      if (read) return void (focused && (!now || now === document.body || now === btn) && /** @type {HTMLElement | undefined} */ (st.list.children[at])?.focus?.({ preventScroll: true }));
      btn.disabled = false;
      btn.textContent = `Show all ${fmt.n(all)} files — they could not be read; try again`;
    });
  };
  return h("button", { class: "file-row file-all", type: "button", title: `Read and show every file this turn changed (${fmt.n(all)})`, onclick: press }, `Show all ${fmt.n(all)} files`);
}

/** A file card's rows on its list, before the lines under them, one at a time: a list of every row as one call's
 *  arguments has the stack's bound. @param {FileRows} st */
function paintFileRows(st) {
  st.list.replaceChildren(...st.tail);
  const before = st.tail[0] || null;
  for (const f of st.rows) st.list.insertBefore(fileRowEl(f, st), before);
  if (st.more > 0) st.list.insertBefore(showAllEl(st), before);
  st.painted = true;
}

/** The file cards drawn under `root`, each as it holds its rows. @param {Element | null} root */
function fileCardsIn(root) {
  return /** @type {FileRows[]} */ (Array.from(root?.querySelectorAll?.(".file-card") || []).map((card) => fileRowsOf.get(card)).filter(Boolean));
}

/** A file card's rows let go: the lines under them stay. @param {FileRows} st */
function letGoFileRows(st) {
  st.list.replaceChildren(...st.tail);
  st.painted = false;
}

/** A press on a closed file card's head: its rows drawn before the frame that shows it open. @param {Event} e */
function fileCardPressed(e) {
  const card = /** @type {HTMLDetailsElement | null} */ (/** @type {HTMLElement} */ (e.currentTarget).parentNode);
  const st = card ? fileRowsOf.get(card) : null;
  if (card && st && !card.open && !st.painted) paintFileRows(st);
}

/** A file card opened or closed, however: open, its rows stand; closed, they go unless Find holds them. @param {Event} e */
function fileCardToggled(e) {
  const card = /** @type {HTMLDetailsElement} */ (e.currentTarget);
  const st = fileRowsOf.get(card);
  if (!st) return;
  if (card.open) {
    if (!st.painted) paintFileRows(st);
  } else if (st.painted && !st.found) letGoFileRows(st);
}

/**
 * Find covers what is drawn: each file card under `root` whose rows say `needle` (lower case) in one of their spans
 * draws them — a hidden card's too, whose rows Find always read — and keeps them for it; one it drew them for that the
 * words no longer match lets them go, unless it stands open. → how many cards drew them.
 * @param {Element | null} root @param {string} needle
 */
export function revealFiles(root, needle) {
  let drawn = 0;
  for (const card of /** @type {HTMLDetailsElement[]} */ (Array.from(root?.querySelectorAll?.(".file-card") || []))) {
    const st = fileRowsOf.get(card);
    if (!st) continue;
    const holds = st.rows.some((f) => Object.values(fileRowWords(f, st.folder)).some((t) => t.toLowerCase().includes(needle)));
    if (!holds) {
      if (st.found && st.painted && !card.open) letGoFileRows(st);
      st.found = undefined;
      continue;
    }
    st.found = needle;
    if (st.painted) continue;
    paintFileRows(st);
    drawn++;
  }
  return drawn;
}

/** Find closed: the file cards it drew rows for that stand closed let them go (`revealFiles`). @param {Element | null} root */
export function foldFiles(root) {
  for (const card of /** @type {HTMLDetailsElement[]} */ (Array.from(root?.querySelectorAll?.(".file-card") || []))) {
    const st = fileRowsOf.get(card);
    if (!st) continue;
    const held = !!st.found;
    st.found = undefined;
    if (held && st.painted && !card.open) letGoFileRows(st);
  }
}

/**
 * The file-change card (AC1-6): what the turn changed, a row per file with its `+N −N`, from the rounds its run
 * recorded — its agents' own files, each once, in every place they wrote in (`whole`, HarnessV4_Git_Plan step 1). A
 * file in a place other than the run's folder says which. What changed while its commands ran is a line of its own,
 * not counted as the turn's — except in a folder only this chat works in: there it is the turn's own, marked "via a
 * command" (GW-D57). What was written outside any repository is counted at the foot, the way to Outputs, where it is
 * listed (HarnessV4_Four_Plan FO-D27): a turn that wrote only there says so in the card's head. Until the run
 * answers, the files the calls named stand in, without counts; a run that recorded no change of its own has no card.
 * A row opens the Changes pane on this turn with its file open (`onChanges`, HarnessV4_Git_Plan GWC-37); Undo forks
 * this turn. A turn of more than FILES_FIRST files reads its first rows and its counts, and draws a row that reads the
 * rest (`FileRows` `more`); `whole`: it reads them all at once — while Find is open.
 * @param {string[]} files  the files the calls named
 * @param {{ onUndo?: () => void, onChanges?: (f: { path: string, place: string | null, agent: string }) => void, runId?: string,
 *   onOutputs?: () => void, onOutsideSeen?: () => void, whole?: boolean }} o  `onOutputs`: Outputs opened; `onOutsideSeen`: the turn
 *   wrote outside any repository (FO-D28)
 */
export function fileChangeCard(files, { onUndo, onChanges, runId, onOutputs, onOutsideSeen, whole = false }) {
  const label = h("span", { class: "file-label" });
  const total = h("span", { class: "file-counts" });
  const list = h("div", { class: "file-list" });
  /** @type {FileRows} */
  const st = { rows: [], folder: null, list, tail: [], onChanges, painted: false, more: 0, whole: !runId, read: Promise.resolve(), readWhole: () => Promise.resolve(false) };
  /**
   * @param {FileRow[]} rows
   * @param {string | null} [folder]  the place of the run's folder @param {number} [during] @param {number} [outside]
   * @param {number} [count]  how many files in all: more than `rows` where the answer held its first alone
   */
  const paint = (rows, folder = null, during = 0, outside = 0, count = rows.length) => {
    label.textContent = !count && outside ? outsideGitWords(outside, true) : count === 1 ? "1 file changed" : `${count} files changed`;
    st.rows = rows;
    st.more = Math.max(0, count - rows.length);
    st.folder = folder;
    st.tail = [...(during ? [h("div", { class: "file-during" }, `${during} more changed while its commands ran — by them or by someone else`)] : []),
      ...(outside ? [outsideLine(outside, !rows.length, onOutputs)] : [])];
    // Its rows stand only where they stood: open, or held for Find (`fileRowsOf`).
    if (st.painted) paintFileRows(st);
    else list.replaceChildren(...st.tail);
  };
  paint(files.map((path) => ({ path })));
  const summary = h("summary", {},
    h("span", { class: "file-chev", html: ICONS.chevronRight }),
    h("span", { class: "file-diff-ic", html: ICONS.fileDiff }),
    label,
    total,
    h("span", { class: "grow" }),
    h("button", { class: "ghost sm file-undo", type: "button", title: "Put these files back as they were before this turn — here, in this chat", html: ICONS.undo, onclick: (e) => { e.preventDefault(); e.stopPropagation(); onUndo?.(); } }, "Undo"));
  const card = h("details", { class: "file-card" }, summary, list);
  fileRowsOf.set(card, st);
  // Its rows drawn as it opens — at the press, before the frame that shows it open, and at the toggle for an open by
  // any other way — and let go as it closes, unless Find holds them (`revealFiles`). Rows that stand stay: Find draws
  // and marks them, then opens the card on its match.
  summary.addEventListener("click", fileCardPressed);
  card.addEventListener("toggle", fileCardToggled);
  card.hidden = !files.length;
  let seen = false;
  /**
   * Its run's answer drawn, its first rows or all of them — the counts its own where it says them (`counts`), else
   * counted of its lists, as from a host that answers them whole. One that holds its first rows never stands in place
   * of one that holds all; one with no whole (a run that recorded no change of its own) leaves nothing more to read,
   * where no first rows stand. @param {any} r
   */
  const take = (r) => {
    const w = r?.whole;
    if (!w) {
      if (!st.more) st.whole = true;
      return;
    }
    const c = w.counts || null;
    if (c && st.whole) return;
    const rows = w.files || [];
    const count = c ? Number(c.files) || 0 : rows.length;
    const outside = c ? Number(c.outside) || 0 : new Set((w.outside || []).map((/** @type {any} */ o) => String(o.path))).size;
    const during = c ? Number(c.during) || 0 : new Set((w.during || []).map((/** @type {any} */ d) => `${d.place}\n${d.path}`)).size;
    st.whole = count <= rows.length;
    card.hidden = !count && !outside;
    if (card.hidden) return;
    // Offered to the chat on screen alone, once: a card of a chat switched away from offers its panes nothing.
    if (outside && card.isConnected && !seen) {
      seen = true;
      onOutsideSeen?.();
    }
    paint(rows, r.folder || null, during, outside, count);
    total.replaceChildren(...diffCounts(Number(w.totals?.added) || 0, Number(w.totals?.removed) || 0));
  };
  // One read per run at a time while it is fresh (lib/turn-changes.js): each placing of the turn makes the card anew, and
  // a read per placing would stampede git. A run the server holds no more has nothing more to read.
  if (runId) {
    st.read = runChanges(runId, whole ? {} : { first: FILES_FIRST })
      .then(take)
      .catch((e) => {
        if (e?.status === 404) st.whole = true;
      });
    /** @type {Promise<boolean> | null} */
    let reading = null;
    // Says whether it brought rows: one that brought none is asked again at the next ask, unless it left nothing to read.
    st.readWhole = () => {
      if (st.whole) return Promise.resolve(false);
      return (reading ||= runChanges(runId).then(
        (r) => {
          take(r);
          if (!r?.whole) reading = null;
          return !!r?.whole;
        },
        (e) => {
          reading = null;
          if (e?.status === 404) st.whole = true;
          return false;
        },
      ));
    };
  }
  return card;
}

/** A diff's counts, the added in green and the removed in red: "+12", "−3". @param {number} added @param {number} removed */
function diffCounts(added, removed) {
  return [added ? h("span", { class: "fc-add" }, `+${added}`) : null, removed ? h("span", { class: "fc-del" }, `−${removed}`) : null].filter((x) => x !== null);
}

/** The website preview card: 44px globe tile, title, “Website”, Open. */
function websiteCard(card) {
  return h("a", { class: "web-card", href: card.url, target: "_blank", rel: "noopener" },
    h("span", { class: "web-ic", html: ICONS.globe }),
    h("span", { class: "web-meta" },
      h("span", { class: "web-title" }, card.title),
      h("span", { class: "web-kind" }, card.kind)),
    h("span", { class: "web-open" }, "Open"));
}

/**
 * A steering bubble inside the running turn (§5.5.3): queued → read, or honestly never read / never delivered. The
 * words are `steerWords`' (a stop and a compact are actions: a fixed chip, states in their own words — BUG-09).
 * The pictures it carried into the turn show above its words, as a message's own do (V4-D303): kept beside the run's
 * log and named there by their ref, or, before the log names them, the page's own bytes (`shots`, one place per name
 * in `files`). One the page has neither for is named on a chip. Where the model's provider refused them they are
 * dimmed and the chips struck through (`refused`: its words, on their tip).
 * A message that overrules saved agents' answers says whose (`overrules`, HarnessV4_Tasks E15 step 3).
 * A message in a worker's run that is not the developer's own says whose it is (`from`: its lead's, Filament's, the
 * developer's answer relayed — HarnessV3-TaskGraph-v2 TG2-D38, TG2-D41).
 * One the developer typed that still waits for the run to take it offers Edit and Delete (`acts`, `canTakeBack`,
 * HarnessV4_Tasks C34): Edit takes it back into the box to change and send again, Delete takes it back.
 * A question the fork that weighed it answered (`answer`, the owner's forked steer of 11-04) stands under it, in the
 * fork's words.
 * A watcher's guidance (`from` "watcher") is no bubble: the card its turn draws where the chat is at rest (turn.js
 * `guideCard`), across the column, with where it stands at its right — and none of the person's Edit and Delete,
 * whose words it is not. Its watcher is the one of that title that watches the chat, where exactly one does.
 * @param {{ id?: string, kind?: string, text?: string, read?: boolean, unread?: boolean, undelivered?: boolean, files?: string[], shots?: ({ ref?: string, src?: string } | null)[], refused?: string, overrules?: { name?: string }[], from?: string, title?: string, canTakeBack?: boolean, answer?: string }} s
 * @param {boolean} [settled]  the turn is over: nothing it holds is pending any more
 * @param {boolean} [stopped]  the owner stopped it: a message the stop overtook says so
 * @param {{ onBack: (edit: boolean) => void } | null} [acts]
 */
export function steerEl(s, settled = false, stopped = false, acts = null) {
  const w = steerWords(s, { settled, stopped });
  if (s.from === "watcher")
    return h("div", { class: `steer steer-guide ${w.tone} steer-from-watcher` },
      guideCard({
        title: s.title || "A watcher",
        text: String(s.text || ""),
        state: guideNoteWords(w),
        find: (list) => {
          const named = list.filter((x) => x.role === "watched" && x.state === "on" && x.title === s.title);
          return named.length === 1 ? named[0] : null;
        },
      }));
  const files = s.files || [];
  const srcOf = (/** @type {number} */ i) => s.shots?.[i]?.src || (s.shots?.[i]?.ref ? pictureUrl(String(s.shots[i]?.ref)) : "");
  const drawn = files.map((name, i) => ({ name, src: srcOf(i) })).filter((p) => p.src);
  const named = files.filter((_, i) => !srcOf(i));
  const refusedTip = s.refused ? `Not sent — the provider said: ${s.refused}` : null;
  const text = w.text || (named.length ? "(pictures)" : "");
  return h("div", { class: `steer${w.action ? " steer-action" : ""} ${w.tone}${s.from ? ` steer-from-${s.from}` : ""}` },
    s.from ? h("div", { class: "steer-from" }, steerFromWords(s)) : null,
    drawn.length
      ? h("div", { class: s.refused ? "u-shots refused" : "u-shots", title: refusedTip },
          h("div", { class: drawn.length > 1 ? "tool-shots many" : "tool-shots" }, ...drawn.map((p) => pictureThumb(p.src, p.name, (img) => img.classList.add("gone")))))
      : null,
    text || !drawn.length ? h("div", { class: "steer-text" }, text) : null,
    named.length ? h("div", { class: s.refused ? "u-atts refused" : "u-atts", title: refusedTip }, ...named.map((name) => h("span", { class: "att" }, name))) : null,
    s.overrules?.length ? h("div", { class: "steer-state steer-overrules" }, overruleMark(s.overrules)) : null,
    s.answer ? steerAnswer(s.answer) : null,
    acts && canTakeBack(s, settled)
      ? h("div", { class: "steer-foot" },
          h("span", { class: "steer-state" }, w.state),
          h("button", { class: "ghost sm", type: "button", title: "Take it back into the box to change it, then send it again", onclick: () => acts.onBack(true) }, "Edit"),
          h("button", { class: "ghost sm", type: "button", title: "Take it back: it is never sent", onclick: () => acts.onBack(false) }, "Delete"))
      : h("div", { class: "steer-state" }, w.state));
}

/** The fork's answer to the person's question, under their message (the owner's forked steer of 11-04). @param {string} text */
function steerAnswer(text) {
  const body = h("div", { class: "steer-answer-body a-md" });
  setHtml(body, mdChat(text, null).out);
  return h("div", { class: "steer-answer" }, h("div", { class: "steer-answer-head" }, "The answer, from a fork of the agent"), body);
}

/**
 * What a paused turn's pointer says (HarnessV3-Views V3): what it waits for, and that the decision waits below — the
 * permission or the question stands in the dock, over the composer, in whichever view shows (decisions.js). A coding
 * agent's questions wait on its run instead of a pause (HarnessV3-ACP AC2-4), in the dock all the same. While a coding
 * agent is the chat's model (`coder`), the loop's pause waits for Filament's agent, as the dock says: the agent answers
 * none of it. "" while the turn waits on nothing.
 * @param {any} turn @param {string} coder  the coding agent that is the chat's model now, by name; "" for Filament's loop
 */
function pointerWords(turn, coder) {
  if (!turn.paused && !turn.waiting?.length) return "";
  const asks = turn.paused ? [] : turn.waiting;
  return asks.length ? askWaitWords(asks) : coder ? `${loopWaitWords(turn.paused)}, below` : waitWords(turn.paused);
}

/**
 * A paused turn's pointer, in its words (`pointerWords`): a coding agent's plan that waits on its run (its ask's kind
 * `proposal`, HarnessV3-ACP AC2-4) in the plan's colour. @param {any} turn @param {string} words
 * @param {() => void} onGo  the dock's decision takes the focus
 */
function pausePointer(turn, words, onGo) {
  const plan = !turn.paused && turn.waiting?.[0]?.kind === "proposal";
  return h("button", { class: `pp-pointer${plan ? " is-proposal" : ""}`, type: "button", title: "Go to it", onclick: onGo },
    h("span", { class: "pp-pointer-ic", html: ICONS.arrowDown }), words);
}

/**
 * The timeline region. `host` is the conversation frame; callbacks reach the rest of the harness.
 * @param {HTMLElement} host
 * @param {{ onFork: (chat: any, turn: any, opts?: { prefill?: string, precheck?: boolean }) => void, onRetry: (chat: any, turn: any) => unknown, onChanges?: (turn: any, f: { path: string, place: string | null, agent: string }) => void, onCompact?: (chat: any, turn: any, choice: string | null, once: { model?: string } | null, carry: string | null) => unknown,
 *   onOutputs?: () => void, onOutsideSeen?: () => void,
 *   askOptions?: (chat: any, ask: import("./interaction.js").Ask, once: { model?: string } | null) => Promise<import("./interaction.js").AskOptions | null>,
 *   switchOptions?: (chat: any, ask: import("./interaction.js").Ask) => Promise<import("./interaction.js").SwitchOptions | null>,
 *   carryOptions?: (chat: any, ask: import("./interaction.js").Ask) => Promise<{ ways: import("./interaction.js").CarryChoice[] } | null>,
 *   writerPicker?: (onPick: (name: string) => void) => { el: HTMLElement, set: (name: string) => void } | null,
 *   accountRows?: () => import("../../lib/accounts.js").AgentRow[],
 *   onContinue?: (chat: any, turn: any, upstream: string) => unknown, onContinueCancel?: (chat: any) => void, resumeAt?: (chat: any) => number | null,
 *   onResume?: (chat: any, at: number | null) => void, onResetCredit?: (upstream: string) => Promise<string | null>,
 *   onSignIn?: (upstream: string, resend: () => void) => void,
 *   onSendAsIs?: (chat: any, turn: any, carry?: string) => unknown, onNeverAsk?: (chat: any, turn: any, kind: import("./interaction.js").Ask["kind"], carry?: string) => unknown, onSkipWait?: (chat: any, turn: any) => void,
 *   onSummonedCompact?: (chat: any, choice: string | null, once: { model?: string } | null) => unknown,
 *   onSummonedSend?: (chat: any) => unknown, onSummonedDismiss?: (chat: any) => void, onTakeBack?: (chat: any, turn: any) => boolean,
 *   onSteerBack?: (turn: any, steer: any, edit: boolean) => void,
 *   onSwitch?: (chat: any, turn: any, form: string, ask: import("./interaction.js").Ask) => unknown,
 *   onUndoCompaction?: (chat: any, b: any) => void,
 *   onRewind?: (chat: any, turn: any, o?: { what?: string }) => void, onUndoRewind?: (chat: any) => void,
 *   onShowRewound?: (chat: any, line: string) => void, onRewindFiles?: (chat: any) => void,
 *   onMoveBack?: (chat: any, b: any) => void,
 *   onPauseChange: () => void, onToDecision: () => void, agentRows?: () => any[], agentRowsKnown?: () => boolean,
 *   agentLogged?: (sub: any) => any, agentCard?: (id: string, exchange: number) => any,
 *   onRevealAgent?: (id: string) => void,
 *   onWatchRun: (chat: any) => void, onExplain?: (chat: any, turn: any) => void, onOpenPlan: () => void,
 *   onOpenFork?: (chat: any, fork: any) => void, onCommand?: (chat: any, command: string) => void,
 *   onRunAsFlow?: (chat: any, words: string) => void, sessionRow?: (id: string) => any, onAddLine?: (line: string) => void,
 *   onPlanOffer?: (chat: any, o: { words: string, depth: string }) => void, onJustDo?: (chat: any) => void,
 *   onApprovePlan?: (chat: any) => void, onAmendPlan?: (chat: any) => void,
 *   onInspector?: (chat: any, tab?: string) => void, getFolder?: () => string, setFolder?: (p: string) => void,
 *   onQuote?: (text: string, kind: string) => void, onToast?: (msg: string, kind?: string) => void,
 *   onVisualAsk?: (text: string) => void, onVisualTell?: (text: string) => void, onOpenArtifact?: (name: string) => void,
 *   onPrompt?: (t: any) => void, chatOf?: () => any, coderName?: () => string,
 *   onHeld?: (c: { patch: Record<string, any> }) => void,
 *   start?: import("./empty.js").StartHooks, spaceOf?: (cwd: string) => { name: string, own: boolean } | null,
 *   otherMachines?: () => Promise<{ machines: import("./empty.js").OtherMachine[] } | null>,
 *   machineNames?: () => Promise<{ machines: import("./empty.js").OtherMachine[] } | null>, openOn?: (machine: string, cwd: string) => void,
 *   runOn?: import("./empty.js").RunOnHooks, alsoOn?: (cwd: string) => string[] }} cb
 *   `otherMachines`, `machineNames`, `openOn`: the new chat's menu's other machines, and a new chat on one (empty.js);
 *   `runOn`, `alsoOn`: where the new chat runs, and the machines a project is on too (empty.js)
 */
export function createTimeline(host, cb) {
  const scroller = h("div", { class: "transcript" });
  const inner = h("div", { class: "transcript-inner" });
  const loadEarlier = h("button", { class: "load-earlier hidden", type: "button" }, "Load earlier messages");
  const empty = createEmptyState({
    getFolder: () => cb.getFolder?.() || "",
    setFolder: (p) => cb.setFolder?.(p),
    onToast: (msg, kind) => cb.onToast?.(msg, kind),
    // The Start board (D15, HarnessV3-NewTask): the held choice lives on the current chat, in app.js.
    chatOf: () => cb.chatOf?.() || null,
    onHeld: (c) => cb.onHeld?.(c),
    start: cb.start,
    spaceOf: (cwd) => cb.spaceOf?.(cwd) || null,
    ...(cb.otherMachines ? { otherMachines: cb.otherMachines } : {}),
    ...(cb.machineNames ? { machineNames: cb.machineNames } : {}),
    ...(cb.openOn ? { openOn: cb.openOn } : {}),
    ...(cb.runOn ? { runOn: cb.runOn } : {}),
    ...(cb.alsoOn ? { alsoOn: cb.alsoOn } : {}),
  });
  const nav = createNavigator({
    onJump: (i) => jumpTo(i),
    previewOf: (i) => previewOf(i),
  });
  // After the last turn, where the eye is: the live line under the running turn (proposal_ux §4.3), and the Compacting
  // row's place while a compaction runs (HarnessV4_Tasks U3-5).
  const liveLine = createLiveLine();
  const compactSlot = h("div", { class: "transcript-compacting" });
  // …and, once the turn is over, what its work still runs on (waiting-on.js): the chat is not done.
  const waitSlot = h("div", { class: "transcript-waiting" });
  const tail = h("div", { class: "transcript-tail" }, liveLine.el, compactSlot, waitSlot);
  /** The live line, from the chat shown's running turn; none once no turn runs. */
  const paintLive = () => {
    const turn = chat?.live?.turn;
    if (!turn || (turn.status !== "streaming" && turn.status !== "paused")) return liveLine.clear();
    liveLine.paint(turn, cb.coderName?.() || "");
  };
  // The compaction card you brought up (`/compaction`, the owner's words of 10-18), over the Compacting row's place:
  // the chat's own (`chat.summoned`), drawn again with it.
  const summonedSlot = h("div", { class: "transcript-summoned" });
  scroller.append(inner, summonedSlot, tail);
  inner.append(loadEarlier);
  // The saved agents asked before the chat's first turn (HarnessV4_Tasks E15 AG-24): their cards, where it will stand.
  const askedBox = h("div", { class: "asked-first hidden" });
  /** The Compacting row while a compaction runs for the chat shown, and the clock that moves its times. */
  /** @type {ReturnType<typeof compactingRow> | null} */
  let compactingNow = null;
  /** @type {any} */
  let compactingTimer = null;
  /** The waiting line while the chat shown waits on work that goes on without a turn, and the clock that moves it. */
  /** @type {ReturnType<typeof waitingOnRow> | null} */
  let waitingNow = null;
  /** @type {any} */
  let waitingTimer = null;

  const pill = h("button", { class: "to-bottom hidden", type: "button" }, "↓ latest");
  // Selection → Add to chat (quote-button.js).
  const quoteBtn = quoteButton({ host, scroller, limit: SELECTION_LIMITS.chars, onQuote: (text, kind) => cb.onQuote?.(text, kind) });
  host.append(scroller, empty.el, nav.el, pill, quoteBtn);
  // The pill stands just above where the transcript ends (`--tail-gap`, how far that is above the frame's foot): under it
  // the dock grows with a long draft, the steer line, a card that asks, and the pill had stood a fixed 148px up the
  // frame, on the composer once the dock was taller (the owner's of 10-31). Read again whenever the transcript's box
  // changes, which it does as the dock grows or shrinks; set on the pill alone, so no line of a draft restyles the
  // transcript under the frame. The rail stands beside the transcript's box the same way, from its top to where it ends:
  // it ran the frame's height, down beside the composer (the owner's of 10-31: "it's length should not go below the
  // composer").
  /** How far the transcript's box stands from the frame's top and foot, as last read. */
  const gaps = { head: 0, tail: 0 };
  const placeOver = () => {
    gaps.head = scroller.offsetTop;
    gaps.tail = Math.max(0, host.clientHeight - gaps.head - scroller.offsetHeight);
    pill.style.setProperty("--tail-gap", `${gaps.tail}px`);
    nav.place(gaps.head, gaps.tail);
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(placeOver).observe(scroller);
  // A markdown image shimmers until it loads (the class is the CSS's signal).
  scroller.addEventListener("load", (e) => {
    const img = /** @type {HTMLElement} */ (e.target);
    img.closest?.(".md-img")?.classList.add("loaded");
  }, true);
  scroller.addEventListener("error", (e) => {
    const img = /** @type {HTMLElement} */ (e.target);
    img.closest?.(".md-img")?.classList.add("loaded");
  }, true);

  /** @type {any} */
  let chat = null;
  /** how many of the oldest turns are hidden behind "load earlier" — kept per chat, never across chats */
  const hiddenOf = new WeakMap();
  /** The chats whose reader asked for every turn (Load earlier to the first, a jump to it): their none hidden stands. */
  const allAsked = new WeakSet();
  /** The oldest `n` turns of `c` hidden, as its reader asked. @param {any} c @param {number} n */
  const showFrom = (c, n) => {
    hiddenOf.set(c, n);
    if (n === 0) allAsked.add(c);
  };
  /** @type {Map<any, any>} turn → its DOM handles */
  const view = new Map();
  /** @type {WeakMap<any, { paint: () => void, back: () => void }>} turn → its limit card's Resume, said again
   *  (`paintResume`), and the card given back (`limitBack`) */
  const limitCards = new WeakMap();
  /**
   * A turn its agent's login refused (HarnessV3-ACP AC3-7): its banner's Sign in, for the account the facts name.
   * @param {any} turn @returns {((resend: () => void) => void) | undefined}
   */
  const signInOf = (turn) => {
    const upstream = turn.facts?.signIn?.upstream;
    return upstream && cb.onSignIn ? (resend) => cb.onSignIn?.(upstream, resend) : undefined;
  };
  /**
   * A failed turn's Retry, on its banner: none for a message that is never sent again from the page (labels.js
   * `sentOnce`: the first message of a chat Filament made for it; r-doors, 11-12). @param {any} c @param {any} turn
   */
  const retryOf = (c, turn) => (sentOnce(turn) ? undefined : () => cb.onRetry(c, turn));
  /**
   * A failed turn's banner words: one its agent's login refused says so in a person's words beside its Sign in;
   * any other keeps its message — in its two parts where a failure in the one shape made it (the reply's, or the
   * transcript's after a reload).
   * @param {any} turn @param {string} detail
   * @returns {{ message: string, detail: string, failure: { head: string, more: string } | null }}
   */
  const bannerWords = (turn, detail) =>
    signInOf(turn)
      ? { ...signedOutBanner(turn.error, detail, (cb.accountRows?.() || []).find((x) => x.upstream === turn.facts.signIn.upstream)), failure: null }
      : { message: turn.error, detail, failure: turn.reply?.failure || turn.failure || null };
  /**
   * The limit card for a turn its agent's plan stopped (HarnessV3-ACP AC3-6), with the page's ways on.
   * @param {any} c @param {any} turn @param {string} detail @param {() => void} dismiss
   */
  const limitShim = (c, turn, detail, dismiss) => limitCard(turn.facts.limit, {
    message: turn.error,
    detail,
    rows: () => cb.accountRows?.() || [],
    onContinue: cb.onContinue ? (upstream) => cb.onContinue?.(c, turn, upstream) : undefined,
    onCancel: cb.onContinueCancel ? () => cb.onContinueCancel?.(c) : undefined,
    resumeAt: () => cb.resumeAt?.(c) ?? null,
    onResume: cb.onResume ? (at) => cb.onResume?.(c, at) : undefined,
    onResetCredit: cb.onResetCredit,
    onRetry: () => cb.onRetry(c, turn),
    onDismiss: dismiss,
    // The way taken is the page's own turn's (`limitTaken`): the turn's next lay-out and the chat drawn again offer
    // none either; a reload offers them again.
    taken: () => turn.limitTaken || null,
    onTaken: (way) => void (turn.limitTaken = way || undefined),
    watchResume: (paint, back) => void limitCards.set(turn, { paint, back }),
  });
  /**
   * The card on a turn the server stopped to ask before it sent (HarnessV4_Tasks C26), with the page's answers: the
   * server's own words where it refused the send, the failure's where the agent refused the copy it started from. A
   * switch's is its own card (A7): the forms the new session can carry, and Switch and send. Not now — the ×, a
   * switch's Dismiss — gives the message back to the box with its files, its row gone (`onTakeBack`, the owner's of
   * 11-01); a turn on record (a seed its agent refused) keeps its row, the card closed.
   * @param {any} c @param {any} turn @param {import("./interaction.js").Ask} ask @param {string} failed @param {() => void} dismiss
   */
  const askShim = (c, turn, ask, failed, dismiss) => {
    const notNow = () => { if (!cb.onTakeBack?.(c, turn)) dismiss(); };
    return ask.kind === "switched" ? switchCard(turn.error, ask, {
      options: cb.switchOptions ? () => cb.switchOptions?.(c, ask) ?? Promise.resolve(null) : undefined,
      onSwitch: cb.onSwitch ? (form) => cb.onSwitch?.(c, turn, form, ask) : undefined,
      onDismiss: notNow,
    }) : askCard(ask.kind === "refused" ? failed : turn.error, ask, {
      options: cb.askOptions ? (once) => cb.askOptions?.(c, ask, once) ?? Promise.resolve(null) : undefined,
      writerPicker: cb.writerPicker,
      // A lost session's card sends the form picked on it, none where the server's own stands; any other sends back the
      // form a switch's answer chose (`ask.carry`).
      carryOptions: cb.carryOptions && ask.kind === "lost" ? () => cb.carryOptions?.(c, ask) ?? Promise.resolve(null) : undefined,
      onCompact: cb.onCompact ? (choice, once, carry) => cb.onCompact?.(c, turn, choice, once, ask.kind === "lost" ? carry ?? null : ask.carry ?? null) : undefined,
      onSendAsIs: cb.onSendAsIs ? (carry) => cb.onSendAsIs?.(c, turn, carry) : undefined,
      onNeverAsk: cb.onNeverAsk ? (carry) => cb.onNeverAsk?.(c, turn, ask.kind, carry) : undefined,
      onDismiss: notNow,
      // Its Compact and send shows the compaction where the Compacting row would (HarnessV4_Tasks U11), and is kept
      // with the turn while it runs: a card drawn again meanwhile shows it running, and the flag under it says the
      // message waits for room.
      watch: watchCompacting,
      pending: workOf.get(turn) || null,
      onWorking: (w) => {
        workOf.set(turn, w);
        const flag = view.get(turn)?.foot?.querySelector?.(".a-flag.ask");
        if (flag) flag.textContent = "waits for room";
        const done = () => { if (workOf.get(turn) === w) workOf.delete(turn); };
        w.done.then(done, done);
      },
    });
  };
  /** A card's Compact and send under way, by its turn (HarnessV4_Tasks U11). @type {WeakMap<any, import("./interaction.js").AskWork>} */
  const workOf = new WeakMap();
  /** The flag under a turn stopped to ask: what its message waits for — room, once its card's Compact and send runs.
   *  False where the turn asked nothing, or failed on record (a seed its agent refused). @param {any} turn
   *  @param {import("./interaction.js").Ask | null} ask */
  const flagOf = (turn, ask) => (ask && ask.kind !== "refused" ? (workOf.has(turn) ? "waits for room" : askFlag(ask)) : false);
  /** The painter of the card whose Compact and send runs now: it shows the compaction in place of the Compacting row.
   *  @type {((p: import("./compacting.js").CompactionProgress | null, o?: { onStop?: (() => any) | null, stopTitle?: string }) => void) | null} */
  let cardWork = null;
  /** Find is open (`readWork` to `foldWork`): a file card made meanwhile — Find's reads place turns again — reads every
   *  row at once, as Find searches them (`fileChangeCard` `whole`). */
  let findOpen = false;
  /** What the server last said of the compaction under way, for a card that starts watching it.
   *  @type {{ p: import("./compacting.js").CompactionProgress, o: { onStop?: (() => any) | null, stopTitle?: string } } | null} */
  let compactingSaid = null;
  /** A card's Compact and send watches the compaction under way: what the server last said of it, then each word
   *  after; the Compacting row gives way to the card, and is back once the card stops watching while it still runs.
   *  @param {(p: import("./compacting.js").CompactionProgress | null, o?: { onStop?: (() => any) | null, stopTitle?: string }) => void} paint */
  const watchCompacting = (paint) => {
    cardWork = paint;
    const said = compactingSaid;
    api_.compacting(said ? said.p : null, said ? said.o : {});
    return () => {
      if (cardWork !== paint) return;
      cardWork = null;
      const now = compactingSaid;
      if (now) api_.compacting(now.p, now.o);
    };
  };
  // A history turn's cards and its changes load when its row comes within a screen of view, two fetches at a time
  // (HarnessV3-Responsiveness R4). A 60-turn page used to ask for all of them at once — up to 120 requests — and the
  // browser's six connections to Filament queued every click behind them.
  const cardQueue = createFetchQueue(2);
  /** The loads each row waits to run until it nears the screen. @type {WeakMap<Element, (() => any)[]>} */
  const loadsOf = new WeakMap();
  const nearScreen = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          nearScreen?.unobserve(e.target);
          const jobs = loadsOf.get(e.target) || [];
          loadsOf.delete(e.target);
          // A row re-rendered away while its load waited is skipped; its turn loads again from the new row.
          for (const job of jobs) cardQueue.run(() => (e.target.isConnected ? job() : undefined)).catch(() => {});
        }
      }, { root: scroller, rootMargin: "100% 0px" })
    : null;
  /** Run `job` through the queue once the turn's row `root` nears the screen. @param {Element} root @param {() => any} job */
  function whenNear(root, job) {
    if (!nearScreen) return void cardQueue.run(job).catch(() => {});
    const jobs = loadsOf.get(root);
    if (jobs) jobs.push(job);
    else {
      loadsOf.set(root, [job]);
      nearScreen.observe(root);
    }
  }
  /** A turn this timeline may draw: one of the displayed chat's own. A background run's events still update the
   * turn's data (steers, aligned cards, the pause) — switching back renders from it — but never this chat's DOM:
   * unguarded, a run left streaming in another chat appended its turns and yanked this chat's scroll. */
  const owned = (turn) => !!chat && (chat.turns || []).includes(turn);

  // --- scrolling: follow the tail; an upward read disarms until the bottom band ---
  const follow = () => { if (chat?.following) scroller.scrollTop = scroller.scrollHeight; };
  // Each turn laid out follows at the next frame, once however many were (HarnessV4_Worktrees_Plan S2): following
  // reads the height, which laid the page out once per turn a render drew and once per event of a running turn.
  const followSoon = onceAFrame(follow);
  /** The turns whose lay-out waits for the next frame, each with the view it was asked for (`layoutSoon`). @type {Map<any, any>} */
  const layoutDue = new Map();
  const layoutDueNow = onceAFrame(() => {
    const due = [...layoutDue];
    layoutDue.clear();
    for (const [turn, v] of due) if (view.get(turn) === v) layout(turn, v);
  });
  /**
   * A running turn laid out at the next frame, once however many pieces of its reply came before it: each piece laid
   * the whole turn out again — its folds, its pictures, its parts —, many times a frame while words stream.
   * @param {any} turn @param {any} v
   */
  const layoutSoon = (turn, v) => {
    layoutDue.set(turn, v);
    layoutDueNow();
  };
  /** The user rows whose 12-line clamp is measured once each shows. @type {WeakMap<Element, Element>} */
  const clampOf = new WeakMap();
  // Measured as its turn was drawn, every bubble laid the page out once per turn (S2); seen, the page is laid out.
  const clampSeen = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          clampSeen?.unobserve(e.target);
          const btn = clampOf.get(e.target);
          if (btn && e.target.scrollHeight > e.target.clientHeight + 2) btn.classList.remove("hidden");
        }
      }, { root: scroller })
    : null;
  /** The clamp shows only when the bubble overflows its 12 lines. @param {Element} bubble @param {Element} btn */
  const clampWhenSeen = (bubble, btn) => {
    if (!clampSeen) {
      if (bubble.scrollHeight > bubble.clientHeight + 2) btn.classList.remove("hidden");
      return;
    }
    clampOf.set(bubble, btn);
    clampSeen.observe(bubble);
  };
  // Late layout — a history turn's cards, painted fences, the footer's facts, a loaded font, a turn off the screen laid
  // out as it comes into view — grows the transcript without a scroll event; a follower stays on the tail through it,
  // and through the summoned card as its ways arrive.
  const grows = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { turnTops = null; follow(); }) : null;
  grows?.observe(inner);
  grows?.observe(summonedSlot);
  /**
   * Where each turn drawn stands, in the order drawn, for the navigator's mark as the transcript scrolls: read at a
   * scroll once the transcript was laid out anew — a turn drawn, laid out or grown —, not at every scroll, each read of
   * every turn's place a lay-out of the page while a turn streamed. @type {number[] | null}
   */
  let turnTops = null;
  let lastTop = 0;
  // Closed fences get shiki, mermaid placeholders get diagrams — lazily, idempotently, off the paint path.
  const enrich = () => {
    paintFences(inner).catch(() => {});
    renderDiagrams(inner).catch(() => {});
  };
  let pillTimer = null;
  /** Where each command's output stands, kept as it scrolls (`keepOutputs`): read off every output of a turn at each
   *  placing of its cards, they laid the page out at each event of a running turn (HarnessV4_Worktrees_Plan S2).
   *  @type {WeakMap<Element, number>} */
  const outputTops = new WeakMap();
  scroller.addEventListener("scroll", (e) => {
    const t = /** @type {any} */ (e.target);
    if (t !== scroller && t?.classList?.contains("term-out")) outputTops.set(t, Number(t.scrollTop) || 0);
  }, true);
  scroller.addEventListener("scroll", () => {
    if (!chat) return;
    const dist = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const movedUp = scroller.scrollTop < lastTop - 1;
    lastTop = scroller.scrollTop;
    chat.following = shouldFollow(dist, chat.following, movedUp);
    if (chat.following) pill.classList.add("hidden");
    const tops = (turnTops ||= [...view.values()].map((v) => v.root.offsetTop));
    const at = tops.findIndex((t) => t > scroller.scrollTop + 48);
    nav.setActive(at < 0 ? tops.length - 1 : Math.max(0, at - 1));
  });
  const showPillSoon = () => {
    if (!chat || chat.following) return;
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => pill.classList.toggle("hidden", !chat || chat.following), 250);
  };
  pill.onclick = () => {
    if (chat) chat.following = true;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    pill.classList.add("hidden");
  };

  // The rail shows while the pointer is near the frame's left 48px, beside the transcript: not by the dock under it.
  host.addEventListener("pointermove", (e) => {
    const r = host.getBoundingClientRect();
    const y = e.clientY - r.top;
    nav.arm(e.clientX - r.left < 48 && y >= gaps.head && y <= r.height - gaps.tail);
  });
  host.addEventListener("pointerleave", () => nav.arm(false));

  // Code block buttons (Copy code, Wrap lines) and the table toolbar live in the markdown HTML.
  scroller.addEventListener("click", (e) => {
    const t = /** @type {HTMLElement} */ (e.target)?.closest?.("button");
    if (!t) return;
    if (t.classList.contains("code-wrap")) {
      t.closest(".code-block")?.classList.toggle("wrap");
      return;
    }
    if (t.classList.contains("code-copy")) {
      const text = t.closest(".code-block")?.querySelector("pre")?.textContent || "";
      if (text && navigator.clipboard) navigator.clipboard.writeText(text).then(() => {
        t.classList.add("copied");
        setTimeout(() => t.classList.remove("copied"), 2000);
      }).catch(() => {});
      return;
    }
    if (t.classList.contains("table-copy") || t.classList.contains("table-csv")) {
      const table = t.closest(".table-wrap")?.querySelector("table");
      if (!table) return;
      const rows = Array.from(table.querySelectorAll("tr")).map((tr) => Array.from(tr.children).map((c) => c.textContent || ""));
      const text = t.classList.contains("table-csv")
        ? rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n")
        : rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
      if (t.classList.contains("table-csv")) {
        // The file's address is let go once the download has it, as a visual's Save lets its own go: kept, each press's
        // would hold its table for the page's life.
        const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
        h("a", { href: url, download: "table.csv" }).click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    }
  });


  /** The turn's segments re-laid (`foldSplit`'s rule): while the turn runs, in the order they happened — the fold,
   *  the last reply text, then whatever followed that text, so the newest work is always the bottom of the turn;
   *  once it settles, all the work folds and the answer stands under the fold with its website cards; words with no
   *  work among them fold nowhere and stand above the answer, and the reply's last words stand with Filament's note
   *  under them (an answered question's lead-in). Settled, that note is the turn's last word, under its cards, order
   *  rows and tree card, so an answered question sits right over its answer (HarnessV3-Views V6-14). The
   *  steers sit under the newest work while it runs (queued words wait at the bottom) and, once settled, stay in view
   *  between the work and the reply — they are the person's own words. So do the cards of the saved agents the main
   *  agent asked (HarnessV4_Tasks E15 step 3): the answer it weighed stands right over what it decided, with its
   *  Overrule. A team lead's order rows follow its words; a
   *  pause's pointer to the dock sits under the newest work, outside the fold. A visual the agent drew never folds: it
   *  stands between the work and the words that follow it (HarnessV4_Visuals_Plan VC-41), and nothing that stood above
   *  it is ever placed below it, since its frame moved would draw again. Only nodes out of place move: a node put
   *  back restarts its arrive animation, and card rebuilds re-lay the turn on every run event. */
  function layout(turn, v) {
    // Laid out now: a lay-out asked for the next frame has nothing left to do, and the turns' places are read anew.
    layoutDue.delete(turn);
    turnTops = null;
    const live = turn.status === "streaming" || turn.status === "paused";
    // One "N files changed" card per turn: the session's tree card (every change, hand edits included) is the more
    // truthful one, so once it has landed the run's own card stands down (the UI/UX review, 2026-09-30).
    for (const s of turn.segments || []) if (s.kind === "files") s.el.querySelector?.(".file-card")?.classList.toggle("hidden", !!v.tree);
    // The closing note's copy is left out while the page says it (LD-D7: the question's card, the fold's "Stopped"); the
    // reply's own last words are then its answer. Its segment stays, so an answered question draws the copy again.
    const { asked, rest } = askedApart(segmentsShown(turn));
    const { lastText, lead, pictures, fold, after, closing } = foldSplit(rest, { live, note: turn.note });
    // Settled, the work folds on either side of each line where its coding agent compacted its own context (foldParts,
    // the owner's words of 10-18), of each reply it ended its turn on before Filament woke it, and of each message the
    // person sent that it read while it worked (the owner's of 11-05); while the turn runs, every line stands in the work
    // in the order it happened.
    const settledSplit = !live && !!v.fold && !!turn.aligned;
    const replies = settledSplit ? wokeReplies(turn.segments, turn.aligned.byRound) : null;
    const parts = live || !v.fold ? { before: [], head: fold, after: [] } : foldParts(fold, replies, settledSplit ? heardRounds(turn.aligned.byRound) : null);
    paintSteers(turn, v);
    const wanted = parts.head.map((s) => s.el);
    placeChildren(v.a, wanted);
    // A finished turn that did no work (a plain reply, a failed request) has nothing to fold: the header would be
    // a "Worked" over an empty box. It stays while the turn runs — the work may still arrive — and a stopped turn's
    // stays bare, the page's one word of the stop (LD-D7).
    if (v.fold?.el) {
      const head = foldHeader(turn, wanted.length);
      v.fold.el.classList.toggle("hidden", head.hidden);
      v.fold.el.classList.toggle("bare", head.bare);
      if (head.bare) /** @type {HTMLDetailsElement} */ (v.fold.el).open = false;
      // Work moved in under a newer text: the running turn's fold opens on it, as it opened at the turn's start —
      // unless the developer has opened or closed it themselves.
      else if (live && !turn.foldHeld) /** @type {HTMLDetailsElement} */ (v.fold.el).open = true;
    }
    paintShots(turn, v);
    placeParts(turn, v, parts, replies);
    // The box under the work keeps the messages no split stands: those still waiting, and those beside a reply.
    const between = new Set(parts.after.filter((p) => p.heard != null).map((p) => Number(p.round)));
    placeChildren(v.steerBox, (v.steerEls || []).filter((/** @type {any} */ el) => !between.has(Number(el.dataset?.round ?? NaN))));
    const steers = v.steerBox.childNodes.length ? v.steerBox : null;
    showCopies(v);
    // The memory note sits above the reply (§7): "Related memories — here:" and the recall rows come first.
    placeChildren(v.final, [v.memoryNote || null, live ? null : steers, ...lead.map((s) => s.el), ...pictures.map((s) => s.el), ...asked.map((/** @type {any} */ s) => s.el), lastText ? lastText.el : null, ...after.map((s) => s.el), v.notices, v.orders, live ? steers : null, live && turn.liveLost ? lostNote(v) : null, (turn.paused || turn.waiting?.length) && v.pointer ? v.pointer : null, v.tree, v.shim, v.unused || null, v.offer || null, closing ? closing.el : null, v.foot].filter(Boolean));
    followSoon();
  }

  /**
   * A settled turn's lines where its coding agent compacted its own context, between the folds of its work (foldParts,
   * the owner's words of 10-18), and its replies the agent ended its turn on before Filament woke it, each with the box
   * of what woke it — the developer's message, the reports (the owner's of 11-05): a line before any work stands above
   * the turn's fold, each other one after it with the work that followed in a fold of its own (`afterFold`, made once
   * and kept by its place), then the turn's pictures and its answer. Once a reply splits it, each fold says the part it
   * holds — the turn's its time and calls up to its first line, each after a line its own ("Worked for 3m"), the last
   * the stop where one ended the turn; split only where its agent compacted, the turn's fold says the whole turn. While
   * the turn runs there are no parts: its lines stand in the work. A message the person sent, read while the agent
   * worked, stands where the agent had it, between the folds: its copy (`is-inline`, paintSteers), out of the box above
   * the answer, which drew every message of a split turn below the work that came after it (the owner's of 11-05).
   * @param {any} turn @param {any} v @param {{ before: any[], head: any[], after: { line: any, round?: number, heard?: number, with?: any[], segs: any[] }[] }} parts
   * @param {Map<any, number> | null} replies
   */
  function placeParts(turn, v, parts, replies) {
    if (!v.fold || !v.group) return;
    /** @type {(ReturnType<typeof afterFold> | undefined)[]} */
    const made = (v.parts ||= []);
    const rounds = parts.after.map((p) => Number(p.round ?? p.line?.round) || 0);
    /** Each split's messages, in a box of their own kept by its round. @type {Map<number, HTMLElement>} */
    const heardBoxes = (v.heardBoxes ||= new Map());
    const lineOf = (/** @type {{ line: any, round?: number, heard?: number }} */ p) => {
      if (p.heard == null) return p.line?.el || null;
      const r = Number(p.round);
      const box = heardBoxes.get(r) || h("div", { class: "steers is-heard" });
      heardBoxes.set(r, box);
      placeChildren(box, (v.steerEls || []).filter((/** @type {any} */ el) => Number(el.dataset?.round ?? NaN) === r));
      return box;
    };
    const above = parts.before.map((s) => replies?.get(s)).filter((r) => r != null).at(-1) ?? null;
    const spans = above != null || parts.after.some((p) => p.round != null) ? partSpans(turn, parts.after, turn.aligned?.byRound, above) : null;
    // The stop's word goes to the last fold, which the stop ended.
    const last = spans && foldSaysStopped(turn) ? parts.after.findLastIndex((p) => p.segs.length) : -2;
    const tally = (/** @type {number} */ from, /** @type {number} */ to) => (turn.aligned ? tallyBetween(turn.aligned, from, to) : null);
    v.fold.part?.(spans ? { words: partWords(spans[0], last === -1), tally: tally(above ?? 0, rounds[0] ?? Infinity), stopped: last === -1 } : null);
    const folds = parts.after.map((p, i) => {
      if (!p.segs.length) return null;
      const f = (made[i] ||= afterFold(turn, !!v.fold.el.open));
      f.count(tally(rounds[i], rounds[i + 1] ?? Infinity), spans ? partWords(spans[i + 1] ?? null, i === last) : null, p.heard != null ? "message" : p.round != null ? "reply" : null);
      placeChildren(f.a, p.segs.map((s) => s.el));
      return f.el;
    });
    placeChildren(v.group, [v.sig, ...parts.before.map((s) => s.el), v.fold.el, ...parts.after.flatMap((p, i) => [lineOf(p), ...(p.with || []).map((s) => s.el), folds[i]]), v.shots, v.final].filter(Boolean));
    // The rounds whose box stands in view beside a reply: their messages are never folded away.
    const beside = new Set([...parts.before, ...parts.after.flatMap((p) => p.with || [])].filter((s) => s.kind === "cards").map((s) => Number(s.round)));
    // Which fold holds a round's work: the work's own up to the first line, then each after it — none for a round whose
    // box stands beside a reply.
    v.partFolds = (/** @type {number} */ r) => {
      if (beside.has(r)) return null;
      const i = rounds.filter((x) => r > x).length;
      return i === 0 ? v.fold.el : folds[i - 1] || null;
    };
  }

  /**
   * The turn's pictures right under its folds (HarnessV4_Tasks U9): the folds close on its work, every picture the agent
   * saw stays in view (render.js `pictureStrip`), and the strip hides once all of them are open, its cards showing them
   * (harness.css, `showCopies`). Drawn again only when the pictures change. @param {any} turn @param {any} v
   */
  function paintShots(turn, v) {
    const pics = v.fold && turn.aligned ? turnPictures(turn.aligned) : [];
    const key = pics.map((p) => p.ref).join(",");
    if (key === (v.shotsKey || "")) return;
    v.shotsKey = key;
    v.shots?.remove();
    v.shots = pics.length ? pictureStrip(pics) : null;
    letStripsGo();
    if (!v.shots) return;
    v.final.parentNode?.insertBefore(v.shots, v.final);
    shotsToNewest(v.shots);
  }

  /**
   * The lead's launches under its reply (HarnessV3-Views VW-D8), each with its worker's state as the session's list has
   * it now; drawn again only when one moved. Whether they moved. @param {any} turn @param {any} v
   */
  function paintOrders(turn, v) {
    const orders = orderRows(turn.aligned, cb.agentRows?.() || []);
    const key = orders.map((o) => `${o.agentId}:${o.state}`).join(",");
    if (key === v.ordersKey) return false;
    v.ordersKey = key;
    v.orders = orders.length ? orderRowsEl(orders, (id) => cb.onRevealAgent?.(id)) : null;
    return true;
  }

  /**
   * A turn's pointer to the decision it waits on, in the words for the chat's model now (`cb.coderName`), kept with
   * them (`pointerWords`, to tell a change of model that changes them); none while it waits on nothing.
   * @param {any} turn @param {any} v
   */
  function point(turn, v) {
    v.pointerWords = pointerWords(turn, cb.coderName?.() || "");
    v.pointer = v.pointerWords ? pausePointer(turn, v.pointerWords, cb.onToDecision) : null;
  }

  /** The live view's loss, said under the newest work (F3 item 16, BUG-25): the watchdog found events the page had
   *  not heard, and follows the run again from its cursor. Gone at the first event heard. */
  function lostNote(v) {
    v.lost ||= h("div", { class: "live-lost", role: "status" }, h("span", { class: "live-lost-dot" }), h("span", {}, LIVE_LOST_WORDS));
    return v.lost;
  }

  /** The steer box's bubbles (BUG-13): while the turn runs, only the messages still waiting for the loop; once it has
   *  settled, every one — each the loop read marked `is-inline`, as it stands in the work where it joined too
   *  (`cardsEl`), and the page shows this copy only while the fold that holds it is closed (`showCopies`), between the
   *  folds where the work splits at it (`placeParts`). Redrawn only when what
   *  they say changes — a bubble put back restarts its arrive animation. One the developer may still take back offers
   *  Edit and Delete (HarnessV4_Tasks C34). */
  function paintSteers(turn, v) {
    const live = turn.status === "streaming" || turn.status === "paused";
    const stopped = turn.status === "stopped";
    const list = /** @type {any[]} */ (boxSteers(/** @type {any[]} */ (turn.steers), live));
    // Each message the work holds, by the round whose box draws it: the run's word on it, never the page's own copy —
    // one typed here keeps the POST's fields, no round among them (the review of cf313a1ae).
    /** @type {Map<string, number>} */
    const inWork = new Map(live || !turn.aligned ? [] : [...turn.aligned.byRound.entries()].flatMap(([r, /** @type {any} */ c]) => (c.steers || []).filter((/** @type {any} */ s) => s.read).map((/** @type {any} */ s) => /** @type {[string, number]} */ ([s.id, r]))));
    const said = (/** @type {any} */ s) => {
      const w = steerWords(s, { settled: !live, stopped });
      return [s.id, w.tone, w.state, w.text, (s.files || []).length, canTakeBack(s, !live) ? 1 : 0, inWork.get(s.id) ?? ""].join(":");
    };
    const key = `${live ? "live" : "settled"}|${turn.status}|${list.map(said).join(",")}`;
    if (v.steerKey === key) return;
    v.steerKey = key;
    v.steerEls = list.map((s) => {
      const el = steerEl(s, !live, stopped, cb.onSteerBack ? { onBack: (edit) => cb.onSteerBack?.(turn, s, edit) } : null);
      if (inWork.has(s.id)) {
        el.classList.add("is-inline");
        el.dataset.round = String(inWork.get(s.id));
      }
      return el;
    });
    // Each in the box until the layout stands a settled turn's copies between its folds (placeParts).
    v.steerBox.replaceChildren(...v.steerEls);
  }

  /**
   * Boundary rows kept while what each is drawn from holds, each in its slot: drawn again whole at every mark heard of
   * any agent of the chat, a finished agent's card was a new element under a resting pointer — its Hide blinked, and a
   * press on it was lost (the owner's of 11-02). A row is kept by the boundary it stands for, said the same way, while
   * it stands on the page: one taken off it let go of the agents' list it paints from (lib/follow-drawn.js), and is made
   * anew. A boundary that draws nothing (`boundaryRow`'s null) is asked again at the next draw.
   * @param {Map<string, HTMLElement>} kept  the slot's rows, by what each is drawn from @param {any[]} list
   * @param {boolean} divider
   * @param {((b: any) => HTMLElement | null) | null} [made]  the view's own row for a boundary, where it keeps one
   * @returns {HTMLElement[]}
   */
  function keptBoundaries(kept, list, divider, made = null) {
    /** How many of the same boundary came before, so two alike are two rows. @type {Map<string, number>} */
    const alike = new Map();
    /** @type {[string, HTMLElement][]} */
    const rows = [];
    for (const b of list) {
      // An answer's row draws nothing once its question's card stands in the chat (agent-card.js `agentCardRow`): what
      // the page holds, not the boundary, so it is part of what the row is drawn from.
      const paired = b?.type === "subagent" && b.event === "arrival" ? !!chipActions.cardMarks?.(String(b.agentId), Number(b.exchange) || 0)?.dispatch : null;
      const sig = JSON.stringify([b, divider, paired]);
      const n = alike.get(sig) || 0;
      alike.set(sig, n + 1);
      const key = `${n}:${sig}`;
      const was = kept.get(key);
      const row = was?.isConnected ? was : made?.(b) || boundaryRow(b, divider);
      if (row) rows.push([key, row]);
    }
    kept.clear();
    for (const [key, row] of rows) kept.set(key, row);
    return rows.map(([, row]) => row);
  }
  /** Each chat's rows of its agents asked before its first turn, kept as `keptBoundaries` keeps a turn's. @type {WeakMap<any, Map<string, HTMLElement>>} */
  const askedKept = new WeakMap();

  /** The cards of `c.asked`, drawn; whether any stands — one hidden stands no more. @param {any} c */
  function paintAsked(c) {
    let kept = askedKept.get(c);
    if (!kept) askedKept.set(c, (kept = new Map()));
    // Placed, never put in again: a row that stands stays on the page.
    placeChildren(askedBox, keptBoundaries(kept, c.asked || [], false));
    const stands = askedStands();
    askedBox.classList.toggle("hidden", !stands);
    return stands;
  }
  /** Whether a card of the agents asked before the chat's first turn stands. */
  function askedStands() {
    return [...askedBox.children].some((r) => !r.classList.contains("hidden"));
  }
  /**
   * A card of `c.asked` hidden or shown again as it paints: the Start board comes back where none stands in a chat with
   * no turn, and gives way again where one does (the Hunter's of 11-01: hiding the last one left the chat blank).
   */
  function paintDraft() {
    if (!chat) return;
    const stands = askedStands();
    askedBox.classList.toggle("hidden", !stands);
    const draft = (chat.turns || []).length === 0 && !stands;
    if (draft === !empty.el.classList.contains("hidden")) return;
    empty.el.classList.toggle("hidden", !draft);
    if (draft) empty.refresh();
    inner.classList.toggle("draft", draft);
  }

  /**
   * A boundary between turns as one row: a settings change (the document's hash moved), a compaction (the turns
   * before it now reach the model as one summary, or folded — by its method), the chat moved to
   * another place, a worktree template copied in, or the developer's sub-agent sent off or back while no turn ran.
   * Counts and hashes; the summary's text behind a disclosure. Null for a settings row that has nothing to say beside
   * the engine's divider (`divider`, HarnessV3-Views V6-10).
   * @param {any} b @param {boolean} divider
   */
  function boundaryRow(b, divider) {
    if (b.type === "subagent") {
      // A card you closed takes its row with it: the row's padding stood as an empty space where it was.
      const wrap = h("div", { class: `boundary-row is-subagent${b.asked ? " is-asked" : ""}` });
      const row = subagentMarkRow(b, { between: true, shown: (on) => {
        wrap.classList.toggle("hidden", !on);
        // One of the agents asked before the chat's first turn: the Start board stands where none of theirs does.
        if (wrap.parentNode === askedBox) paintDraft();
      } });
      if (!row) return null;
      wrap.append(row);
      return wrap;
    }
    // A team beside fired, or its result in (team_v2_plan §5.4): the page's own card, never sent to the agent.
    if (b.type === "team") return h("div", { class: "boundary-row is-subagent is-beside" }, besideMarkRow(b));
    // The side-by-side card (Phase 5): the graph's, drawn by the page; its Accept and Ignore are the chat's.
    if (b.type === "side") return chat?.chainId ? sideOfferRow(b, String(chat.chainId)) : null;
    // The card for sub-agents that change files, while Parallelize tasks is off: its Accept and One at a time are the chat's.
    if (b.type === "held") return chat?.chainId ? heldLaunchRow(b, String(chat.chainId)) : null;
    // A switch of who answers: the engine's divider says it (engineDividers), never a row of its own.
    if (b.type === "engine") return null;
    if (b.type === "compaction") {
      // The words, then the figures when the row kept them (before → after, who wrote it), else the summary's size.
      const label = h("span", { class: "boundary-label" }, compactionRowWords(b));
      // Undo, while it is the newest compaction and nothing has been sent since (the server says so, and refuses
      // otherwise in words): the turns come back as they were.
      const owner = chat;
      const undo = b.undoable && b.id
        ? h("button", { class: "boundary-toggle is-undo", type: "button", title: undoWords(b), onclick: () => cb.onUndoCompaction?.(owner, b) }, "Undo")
        : null;
      if (!b.text) return h("div", { class: "boundary-row is-compaction" }, label, ...(undo ? [undo] : []));
      // The summary's text opens under the rule, full width — the row itself stays one line.
      const text = h("div", { class: "boundary-text" }, b.text);
      text.hidden = true;
      const toggle = h("button", {
        class: "boundary-toggle", type: "button",
        onclick: () => {
          text.hidden = !text.hidden;
          toggle.textContent = text.hidden ? "Show summary" : "Hide summary";
        },
      }, "Show summary");
      return h("div", { class: "boundary is-compaction" }, h("div", { class: "boundary-row is-compaction" }, label, toggle, ...(undo ? [undo] : [])), text);
    }
    if (b.type === "moved") {
      // The chat moved to another place (HarnessV4_Git_Plan GW-D77); Move back while no turn has run since (GW-D79).
      const owner = chat;
      const back = b.undoable && b.id
        ? h("button", {
          class: "boundary-toggle is-undo", type: "button",
          title: `Its files go back to ${b.from}, and a worktree the move made goes too where it holds nothing else`,
          onclick: () => cb.onMoveBack?.(owner, b),
        }, "Move back")
        : null;
      return h("div", { class: "boundary-row is-moved" },
        h("span", { class: "boundary-label" }, h("span", { class: "boundary-ic", html: ICONS.gitFork }), movedWords(b)), back);
    }
    if (b.type === "copied") {
      // The worktree template's copy (HarnessV4_Four_Plan FO-D37): what it copied, then what it did not and why, under
      // a disclosure; running until its end comes on the feed.
      const w = copiedWords(b);
      const cut = b.state === "cut" || !!b.result?.cut;
      const label = h("span", { class: "boundary-label" }, h("span", { class: "boundary-ic", html: ICONS.copy }), w.text);
      const cls = `boundary-row is-copied${b.state === "running" ? " is-running" : ""}${cut ? " is-cut" : ""}`;
      if (!w.notes.length) return h("div", { class: cls }, label);
      const notes = h("ul", { class: "boundary-text copied-notes" }, ...w.notes.map((n) => h("li", {}, n)));
      notes.hidden = true;
      const said = `${w.notes.length} note${w.notes.length === 1 ? "" : "s"}`;
      const toggle = h("button", {
        class: "boundary-toggle", type: "button",
        onclick: () => {
          notes.hidden = !notes.hidden;
          toggle.textContent = notes.hidden ? `Show ${said}` : `Hide ${said}`;
        },
      }, `Show ${said}`);
      return h("div", { class: "boundary is-copied" }, h("div", { class: cls }, label, toggle), notes);
    }
    // `is-settings`, not `settings`: that class is the Settings overlay's (absolute, opaque, over the whole pane).
    // What moved, in words (the server reads it from the settings history); the row opens the inspector, where the
    // whole history is. The document hashes are the machinery's, never shown.
    const words = settingsRowWords(b, divider);
    if (!words) return null;
    const said = words.length ? `${words.slice(0, 3).join(" · ")}${words.length > 3 ? ` · ${words.length - 3} more` : ""}` : "Settings changed";
    const owner = chat;
    return h("button", {
      class: "boundary-row is-settings", type: "button",
      title: `${words.length ? words.join("\n") : "The session's settings changed between these turns"}\nOpen the settings history`,
      onclick: () => cb.onInspector?.(owner, "history"),
    }, h("span", { class: "boundary-label" }, h("span", { class: "boundary-ic", html: ICONS.slidersHorizontal }), said));
  }

  /**
   * A row drawn as its send went that is on no record after all (`unsent`: the send waits for the chat, or a card stopped
   * it) has nothing to rewind: its Rewind goes. @param {any} turn @param {any} v
   */
  function dropRewind(turn, v) {
    if (unsent(turn)) v.userEl.querySelector(".u-rewind")?.remove();
  }

  function ensureView(turn) {
    if (!view.has(turn)) {
      turn.startedAt ||= Date.now();
      // An earlier turn of a session (turn.history) is a real turn, read-only; a bare past card is not.
      const card = turn.past && !turn.history;
      // A turn its coding agent began by itself (HarnessV3-ACP AC3-9) has no message: its row says what began it. So
      // does the one Filament sent to go on with a turn a restart cut off (HarnessV3-TaskGraph-v2 TG2-D83).
      const userEl = card ? h("div") : turn.own ? ownRow(turn) : turn.resumed ? resumedRow() : turn.goalRound ? goalRoundRow(turn) : turn.woke ? wokeRow(turn) : turn.synced ? syncRow(turn) : turn.teamResult ? teamResultRow(turn) : turn.flowSaid ? flowSaidRow(turn) : turn.brief ? briefRow(turn, { onCopy: () => { const t = turn.brief?.text || ""; if (t && navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}); } }) : turn.watched ? watchedRow(turn) : turn.guided ? guidedRow(turn) : userRow(turn, {
        onCopy: () => { const t = turn.userText || ""; if (t && navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {}); },
        // A message on no record (a waiting row's) has nothing to rewind: it sends itself, or is cancelled.
        onRewind: unsent(turn) ? undefined : () => cb.onRewind?.(chat, turn),
      });
      const a = h("div", { class: "a" });
      const final = h("div", { class: "a-final" });
      const steerBox = h("div", { class: "steers" });
      const fold = card ? null : workFold(turn, { onSkip: cb.onSkipWait ? () => cb.onSkipWait?.(chat, turn) : null });
      // A team's lead signs the replies it gives (U13-D6, W3): who talks, at the head, by the turn's stamp.
      const sig = engineSig(turn.engine);
      const group = h("div", { class: "assistant-turn" }, sig, fold ? fold.el : a, final);
      const before = h("div", { class: "boundaries" });
      const after = h("div", { class: "boundaries" });
      // `data-turn` names the turn on its element; a bare past card has no number of its own.
      // `pictures`: the turn's visuals by their call's id, each one card made once, so its frame is never made twice;
      // `made`: its artifacts' cards, by the call that published each.
      const v = { root: h("section", { class: "turn", ...(turn.n != null ? { "data-turn": String(turn.n) } : {}) }, before, userEl, group, after), userEl, a, final, fold, group, sig, steerBox, pointer: null, orders: null, ordersKey: "", foot: null, shim: null, tree: null, memoryNote: null, notices: null, noticesKey: "", blocks: new Map(), pictures: new Map(), made: new Map(), before, after };
      if (fold) fold.body.append(a);
      view.set(turn, v);
      turnTops = null;
      inner.append(v.root);
      api_.drawBoundaries(turn);
      // The clamp shows only when the bubble actually overflows its 12 lines: measured once it shows.
      const bubble = v.userEl.querySelector?.(".u-bubble, .brief-text");
      const clampBtn = v.userEl.querySelector?.(".u-clamp");
      if (bubble && clampBtn) clampWhenSeen(bubble, clampBtn);
      turn.segments ||= [];
    }
    return view.get(turn);
  }

  /** @param {number} i the visible turn index */
  function jumpTo(i) {
    const turns = shownTurns();
    const v = view.get(turns[i]);
    if (!v) return;
    if (chat) chat.following = false;
    v.root.scrollIntoView({ block: "start", behavior: "smooth" });
    v.root.classList.add("turn-hl");
    setTimeout(() => v.root.classList.remove("turn-hl"), 1200);
  }

  /** @param {number} i */
  function previewOf(i) {
    const t = shownTurns()[i];
    if (!t) return { query: "", answer: "" };
    const answer = replyTextOf(t.blocks, " ").slice(0, 240);
    // A thread's brief previews as its agent's words, never Filament's block before them.
    return { query: (t.brief ? String(t.brief.text || "") : t.userText || "").slice(0, 160), answer };
  }

  /** The turns on screen: past the load-earlier cut, past-cards excluded from the rail's count. */
  function shownTurns() {
    return (chat?.turns || []).slice(hiddenOf.get(chat) || 0).filter((t) => !t.past || t.history);
  }

  /** A run's events whole, a page at a time: a long turn's run is past one page, and its newest cards — its last
   *  work, the files it changed — are in its last. `holed`: a page said a gap (events the log let go of, a file that
   *  would not read). An ended run's task graphs come without their graph but its last (`graphs=last`): each is the
   *  whole graph as it stood, up to a quarter of a megabyte, and what reads them of a turn (plan.js `planOf`) reads its
   *  newest alone. Its sub-agents' calls come apart (`calls=apart`), each card counting them, read as it opens
   *  (render.js `readApart`): they were 54 of one turn's 64 MB (the owner's of 11-17) — whole while Find is open, which
   *  searches them (`findOpen`). @param {string} runId @returns {Promise<{ events: any[], holed: boolean }>} */
  async function runEventsOf(runId) {
    /** @type {any[]} */
    const all = [];
    let holed = false;
    const calls = findOpen ? "" : "&calls=apart";
    for (let since = 0; ;) {
      const page = await api(`/runs/${encodeURIComponent(runId)}/events?since=${since}&limit=${RUN_PAGE}&graphs=last${calls}`);
      if (page?.gap) holed = true;
      const events = page?.events || [];
      all.push(...events);
      const last = Number(events.at(-1)?.n) || 0;
      if (events.length < RUN_PAGE || last <= since) return { events: all, holed };
      since = last;
    }
  }

  /** A turn's sub-agents' calls its read left apart, every card's at once (Find's read): its run's calls read whole,
   *  and each sub filled with its launching call's (labels.js `fillCalls`) — one a card's own read filled first is
   *  filled already. → how many it filled. @param {any} turn @returns {Promise<number>} */
  async function fillApart(turn) {
    const subs = subsApart(turn.aligned);
    if (!subs.length) return 0;
    const byLaunch = callsByLaunch(await readCalls(api, String(turn.runId)));
    let filled = 0;
    for (const sub of subs) {
      const events = byLaunch.get(sub.apart.round)?.get(sub.apart.parent);
      if (events?.length && fillCalls(sub, events)) filled++;
    }
    return filled;
  }

  /** An earlier turn's cards come from its persisted run, read once (the run log keeps them for days). What the run
   *  says lands on the turn whether or not the transcript draws it now — the Plan view reads the newest turn's
   *  checklist from it while the transcript is hidden — and is drawn only onto a turn the transcript has drawn:
   *  placing cards on any other would append a row for it. A running turn the page follows is read by its follower
   *  (app.js marks it read), and an ended turn's log the page aligned whole before — followed to its end, or read here —
   *  came with it from the reading before as its alignment (lib/turn-reads.js): neither is read again. An ended turn
   *  keeps its log's alignment alone, the events let go of (labels.js `letGoOfLog`). */
  function historyCards(turn) {
    if (!turn.runId) return Promise.resolve();
    // A log read while its turn still ran is not the whole of it: let go of only once the turn has ended. Nor is one
    // with a hole: a later reading reads it again.
    const ended = turn.status === "done" || turn.status === "error" || turn.status === "stopped";
    turn.runRead ||= (turn.alignCache?.whole ? Promise.resolve(null) : runEventsOf(turn.runId))
      .then((read) => {
        api_.applyEvents(turn, read?.events ?? null, view.has(turn));
        if (ended && read && !read.holed) letGoOfLog(turn.alignCache, read.events);
      })
      .catch(() => {
        // the run is gone from the log (swept) — the turn shows its text and its numbers, no cards
      });
    return turn.runRead;
  }

  function refreshNav() {
    nav.setCount(shownTurns().length);
  }

  /** The turn's working-tree changes card: what this turn changed, read from the session's git
   *  snapshots. Fetched once per turn — `undefined` = not tried yet, `null` = tried, nothing to show (no writes,
   *  snapshots off, not a repository, or the turn predates memory). Only a turn that changed files gets a card; a
   *  turn with no tool work can never have taken a snapshot, so it never even asks (a re-render of sixty history
   *  turns would otherwise fire sixty git walks for nothing). It reads the files the card lists, in its order — the
   *  page's own locale — and the counts of the rest: one turn's whole was 22.9 MB (the owner's of 11-17). */
  function attachTree(turn, chainId, turnNo) {
    if (turn.tree !== undefined || !chainId || !Number.isFinite(Number(turnNo)) || Number(turnNo) < 1) return;
    if (!Number(turn.toolCalls) && !Number(turn.toolLegs)) return;
    turn.tree = null; // claimed before the fetch: no second call races the first
    const locale = new Intl.Collator().resolvedOptions().locale;
    return api(`/memory/sessions/${encodeURIComponent(chainId)}/changes?turn=${Number(turnNo)}&first=${TREE_ROWS}&locale=${encodeURIComponent(locale)}`)
      .then((out) => {
        // No card is simply no card: why a snapshot is missing (snapshots off, no repository) is never a line in
        // the conversation.
        if (!out || (!Number(out.totals?.files) && !out.outside?.length)) return;
        turn.tree = out;
        const v = view.get(turn);
        if (out.outside?.length && v?.root.isConnected) cb.onOutsideSeen?.();
        if (v && v.root.isConnected) {
          v.tree = treeCard(turn, { onOutputs: cb.onOutputs });
          layout(turn, v);
        }
      })
      .catch(() => {});
  }

  loadEarlier.onclick = () => {
    // The reader stays where they read, the earlier turns drawn above (render keeps the place of a reader who let go).
    chat.following = false;
    showFrom(chat, Math.max(0, (hiddenOf.get(chat) || 0) - PAGE));
    api_.render(chat);
  };

  /** The turn at the top of the screen and how far below the scroller's top it starts (negative: it started above),
   *  for a render to put back where it stood. @returns {{ turn: any, gap: number } | null} */
  function topOnScreen() {
    const top = scroller.getBoundingClientRect().top;
    for (const turn of shownTurns()) {
      const r = view.get(turn)?.root?.getBoundingClientRect();
      if (r && r.bottom > top) return { turn, gap: r.top - top };
    }
    return null;
  }

  /** One turn of the chat drawn onto its row: its blocks, its cards, the rows around its reply. A full render draws
   *  every shown turn so; a past turn whose work has come is drawn again where it stands (`redrawPast`).
   *  @param {any} c @param {any} turn */
  function drawTurn(c, turn) {
    // A rewound line (Step 3 D11; rewind in place, 10-27): one line instead of its turns — the range, who rewound it,
    // Show them, Undo while the rewind can be taken back, the fork. The line belongs to its FIRST turn only (every turn
    // of the line carries the same mark); shown, its turns follow it greyed and read-only.
    if (turn.history && turn.rewound) {
      const line = String(turn.rewound.line || "");
      const shown = !!c.rewoundShown?.has(line);
      if (turn.rewound.from == null || Number(turn.rewound.from) === Number(turn.n))
        inner.append(rewoundRow(turn, c, {
          h,
          open: (row) => cb.onOpenFork?.(c, row),
          shown,
          show: () => cb.onShowRewound?.(c, line),
          undo: c.rewind?.line && c.rewind.line === line ? () => cb.onUndoRewind?.(c) : null,
        }));
      if (!shown) return;
    }
    // A streaming turn re-derives its segments every render (startLive resets the block handles, drawBlocks
    // re-pushes them); not resetting them here duplicated every block on each switch back to a running chat.
    if (!turn.past || turn.history || turn.status === "streaming") turn.segments = [];
    const v = ensureView(turn);
    v.root.classList.toggle("is-rewound", !!(turn.history && turn.rewound));
    // A turn drawn again where it stands may be counted now (its work read whole).
    v.fold?.recount();
    if (turn.history) whenNear(v.root, () => historyCards(turn));
    // The work's first stretch is read when the row nears the screen. A job that waited past a read's start, or
    // past its failure, does nothing: a failed read is tried again from its row alone.
    if (turn.history && unread(turn.held)) whenNear(v.root, () => (unread(turn.held) ? heldWork(c, turn) : undefined));
    let firstThink = true;
    // A turn drawn again where it stands keeps the blocks it had drawn: its answer is the same block, and that
    // block's node is not made twice.
    const drawn = v.blocks;
    v.blocks = new Map();
    // The closing note a block of its own (LD-D7): the archive's final holds it after its words.
    for (const b of splitNote(turn.blocks, turn.note)) {
      if (b.type === "thinking") {
        b.startedAt ||= Date.now();
        if (b.done == null) b.done = true;
      }
      const hnd = drawn.get(b) || (b.type === "thinking" ? thinkEl(b, { isFirst: firstThink }) : blockEl(b));
      if (b.type === "thinking") firstThink = false;
      v.blocks.set(b, hnd);
      turn.segments.push({ kind: "block", block: b, el: hnd.el });
    }
    // What the fold says of work not all read: that it is being read, or how much is shown, with the way to more.
    const more = heldRow(c, turn);
    if (more) turn.segments.push({ kind: "held", el: more });
    api_.placeCards(turn);
    // The tree card, rebuilt from the turn's cached data, on the view (`v.tree`) — `layout()` owns v.final's children
    // and would drop anything merely appended to it: a re-render (switching chats and back, loading earlier turns)
    // clears the view, and the once-per-turn fetch must not be the only writer.
    if (turn.tree) v.tree = treeCard(turn, { onOutputs: cb.onOutputs });
    v.steerKey = null;
    paintSteers(turn, v);
    point(turn, v);
    // An unanswered turn (the reply never landed in the archive): said under the bubble, not left blank — and why,
    // when a restart cut it off (2b-C D8), with what was kept of it (HarnessV4_Tasks U1).
    if (turn.status === "open" && !c.live) v.shim = h("div", { class: "turn-open-note" }, openTurnWords(turn));
    // A plan its agent offered before a restart cut the turn off: written as it was made, its card stands still.
    if (turn.status === "open") v.offer = offerOf(c, turn);
    if (turn.status === "done" || turn.status === "stopped" || turn.status === "error") {
      const texts = replyTextOf(turn.blocks);
      const sites = websiteCardsFrom(texts);
      if (sites.length) turn.segments.push({ kind: "web", el: h("div", { class: "web-cards" }, ...sites.map(websiteCard)) });
      const said = shimLineOf(turn);
      if (said?.kind === "command") v.shim = commandAnswer(turn.commandText || "", turn.card, { onCommand: (cmd2) => cb.onCommand?.(c, cmd2), onInspector: () => cb.onInspector?.(c) }, { by: turn.commandBy });
      else if (said?.kind === "note") v.shim = shimNote(said.text, { warn: !!said.warn });
      v.memoryNote = turn.facts?.memory?.related ? memoryNoteEl(turn.facts.memory.related, memoryNoteCb(c, turn)) : null;
      // Whom its message or notes named with an `@` and its main agent did not use (HarnessV4_OneAgent_Plan OA-D12).
      v.unused = unusedEl(turn);
      // Run as a flow, where its main agent offered it (OA6): the press is the person's /flow with these words. A /plan's
      // card, where its plan is ready: View the plan opens the Plan tab.
      v.offer = offerOf(c, turn);
      /** @type {string | false} */
      let asked = false;
      if (turn.status === "error" && turn.error) {
        const w = bannerWords(turn, turn.errorDetail || "");
        const ask = askOf(turn.reply?.errorBody, turn.facts);
        asked = flagOf(turn, ask);
        const dismiss = dismissOf(turn, v);
        if (!turn.shimDismissed)
          v.shim = turn.facts?.limit
            ? limitShim(c, turn, "", dismiss)
            : ask
              ? askShim(c, turn, ask, w.message, dismiss)
              : errorBanner(w.message, { detail: w.detail, failure: w.failure, onRetry: retryOf(c, turn), onSignIn: signInOf(turn), onDismiss: dismiss });
      }
      v.foot = footerEl(turn, footActs(c, turn, texts), asked);
      if (turn.status !== "error") whenNear(v.root, () => attachTree(turn, c.chainId || turn.rec?.memory?.chain, turn.n ?? turn.rec?.memory?.turn));
    } else if (turn.status === "waiting") {
      // A message that waits for the chat (app.js `armWaiting`): its footer is its line, Cancel and Stop it and go first,
      // drawn with the chat as the turn holds them.
      v.foot = footerEl(turn, footActs(c, turn, replyTextOf(turn.blocks || [])));
    }
    layout(turn, v);
  }

  /** A past turn's work, which the transcript holds back (a long session's is hundreds of megabytes): its next
   *  stretch, read and drawn onto the turn's row. The first is read when the row nears the screen, each later one
   *  when the fold's own row asks. A read that failed says why on that row, with the way to try again.
   *  @param {any} c @param {any} turn @returns {Promise<void>} */
  /**
   * The card under a turn's reply, one at most: Run as a flow, where its agent offered it (OA6); a plan offered first
   * (the owner's plan mode of 11-06), until the person's next message of their own (`cardStands`: a wake, a goal's
   * round, a resume or its coding agent's own turn after it leaves it standing); or a /plan's card, which opens the
   * Plan — with Approve and Amend until that message too.
   * @param {any} c @param {any} turn
   */
  function offerOf(c, turn) {
    const stands = cardStands(c?.turns, turn);
    return (
      flowOfferEl(turn, (words) => cb.onRunAsFlow?.(c, words)) ||
      planOfferEl(turn, stands, { onPlan: (o) => cb.onPlanOffer?.(c, o), onJustDo: () => cb.onJustDo?.(c) }) ||
      planReadyEl(turn, () => cb.onOpenPlan(), stands ? { onApprove: () => cb.onApprovePlan?.(c), onAmend: () => cb.onAmendPlan?.(c) } : null)
    );
  }

  function heldWork(c, turn) {
    const held = turn.held;
    if (!held || held.next == null || !c?.chainId) return Promise.resolve();
    if (held.reading) return held.reading;
    const asked = held.next > 0 || !!held.failed;
    held.failed = "";
    held.reading = api(`/sessions/${encodeURIComponent(String(c.chainId))}/turns/${Number(turn.n)}/work?from=${held.next}`)
      .then((page) => void takeWork(turn, page), (e) => { held.failed = String(e?.message || e); })
      .then(() => {
        held.reading = null;
        redrawPast(turn);
      });
    // Asked for by its row: the row says it is reading.
    if (asked) redrawPast(turn);
    return held.reading;
  }

  /** A past turn drawn again where it stands, from what the turn holds now. @param {any} turn */
  function redrawPast(turn) {
    if (!chat || !owned(turn) || !view.has(turn)) return;
    drawTurn(chat, turn);
    enrich();
  }

  /** The row a past turn's fold ends on while its work is not all read (`heldWords`). @param {any} c @param {any} turn */
  function heldRow(c, turn) {
    const w = heldWords(turn.held);
    if (!w) return null;
    return h("div", { class: "work-held" },
      h("span", { class: "tool-note" }, w.text),
      w.action ? h("button", { class: "tool-note link", type: "button", onclick: () => void heldWork(c, turn) }, w.action) : null);
  }

  /** Whether nothing of a turn's held work was read or asked for yet. @param {any} held */
  function unread(held) {
    return !!held && held.next === 0 && !held.failed && !held.reading;
  }

  /**
   * The rounds the answered cards for sub-agents that change files a turn's agent asked were asked in (`heldRound`), by
   * card: each ends its box (cardBoxes), so its line stands right after the round that ran when it asked. One whose
   * run's calls carry no time has none, and stays after the turn. @param {any} turn @param {any} al @returns {Map<string, number | null>}
   */
  function heldRounds(turn, al) {
    const chainId = chat?.chainId ? String(chat.chainId) : "";
    /** @type {Map<string, number | null>} */
    const at = new Map();
    for (const b of chainId ? turn.boundariesAfter || [] : []) {
      if (b?.type === "held" && heldAnswered(b, chainId)) at.set(String(b.id), heldRound(al.byRound, Number(b.at) || 0));
    }
    return at;
  }

  /**
   * Each answered card's line after the box of its round (`heldRounds`); a round in no box keeps it after the turn.
   * Each card's line is made once. @param {any} turn @param {any} v @param {Map<string, number | null>} at @returns {string[]} the ids placed
   */
  function placeHeld(turn, v, at) {
    /** @type {Map<string, HTMLElement>} */
    const rows = (v.heldRows ||= new Map());
    /** @type {string[]} */
    const here = [];
    for (const b of turn.boundariesAfter || []) {
      const round = b?.type === "held" ? at.get(String(b.id)) : undefined;
      if (round == null) continue;
      const box = turn.segments.findLastIndex((/** @type {any} */ s) => s.kind === "cards" && Number(s.round) <= round);
      if (box < 0) continue;
      let idx = box + 1;
      while (["visual", "artifact", "compacted", "hold"].includes(turn.segments[idx]?.kind)) idx++;
      const el = heldRowOf(v, b);
      if (!el) continue;
      turn.segments.splice(idx, 0, { kind: "hold", round, el });
      here.push(b.id);
    }
    const cards = new Set((turn.boundariesAfter || []).filter((/** @type {any} */ b) => b?.type === "held").map((/** @type {any} */ b) => b.id));
    for (const id of [...rows.keys()]) if (!cards.has(id)) rows.delete(id);
    return here;
  }

  /**
   * A card's one row on a turn's view, after the turn or in it (`placeHeld`), made once: a redraw moves it, and leaves
   * no row behind that was never in the document and so follows its card for the page's life (the review of fe6b8d579).
   * Null where the chat has no session to answer it in. @param {any} v @param {any} b @returns {HTMLElement | null}
   */
  function heldRowOf(v, b) {
    if (!chat?.chainId) return null;
    /** @type {Map<string, HTMLElement>} */
    const rows = (v.heldRows ||= new Map());
    let el = rows.get(b.id);
    if (!el) rows.set(b.id, (el = heldLaunchRow(b, String(chat.chainId))));
    return el;
  }

  /** A turn's calls as its archived work holds them (D8), for a turn no run of its own draws: each box of cards
   *  after the words that led to its calls, in the order the work happened (`takeWork`'s parts). A box is drawn
   *  once, and again only when calls joined it. The visuals its main agent drew, as the transcript lists them, stand
   *  after the box of the call that drew each; one whose call is not read yet, before the answer's words. The pages
   *  it published, as the session lists them by call (AF-D38), stand after the box of the call that published each.
   *  @param {any} turn */
  function archiveCards(turn) {
    const v = view.get(turn);
    const drew = v ? (turn.visuals || []).filter((/** @type {any} */ x) => !x.by) : [];
    /** @type {any[]} */
    const published = v ? chat?.made || [] : [];
    /** @type {Set<string>} */
    const placed = new Set();
    /** @type {Map<any, any[]>} the boxes that follow each block; under null, the ones ahead of every block */
    const after = new Map();
    let said = null;
    for (const [i, p] of (turn.held?.parts || []).entries()) {
      if (p.block) {
        said = p.block;
        continue;
      }
      if (p.drawn !== p.tools.length)
        Object.assign(p, { drawn: p.tools.length, el: h("div", { class: "cards" }, ...archivedRows(p.tools, { key: `${turn.turnId ?? turn.n}-${i}`, turnAt: turnAtOf(turn) })) });
      const pics = drew.filter((/** @type {any} */ x) => !placed.has(x.id) && p.tools.some((/** @type {any} */ t) => String(t.id) === x.id));
      for (const x of pics) placed.add(x.id);
      const pages = published.filter((x) => p.tools.some((/** @type {any} */ t) => String(t.id) === x.call));
      after.set(said, [...(after.get(said) || []), { kind: "cards", round: 0, el: p.el }, ...pics.map((/** @type {any} */ x) => keptSegment(turn, v, x)), ...pages.map((x) => artifactSegment(v, { ...x, id: x.call }))]);
    }
    const unplaced = drew.filter((/** @type {any} */ x) => !placed.has(x.id));
    if (!after.size && !unplaced.length) return;
    const rest = (turn.segments || []).filter((/** @type {any} */ s) => s.kind !== "cards" && s.kind !== "visual" && s.kind !== "artifact");
    const segs = [...(after.get(null) || []), ...rest.flatMap((/** @type {any} */ s) => [s, ...((s.kind === "block" && after.get(s.block)) || [])])];
    const answer = segs.findLastIndex((/** @type {any} */ s) => s.kind === "block" && s.block?.type === "text");
    segs.splice(answer < 0 ? segs.length : answer, 0, ...unplaced.map((/** @type {any} */ x) => keptSegment(turn, v, x)));
    turn.segments = segs;
  }

  /** A visual's card on a turn's view, made once by its call's id: its frame is never made twice. @param {any} v
   *  @param {string} id @param {string} title @param {string | null} [madeIn]  the app it was drawn in, when not Filament */
  function pictureOf(v, id, title, madeIn = null) {
    let pic = v.pictures.get(id);
    if (!pic) v.pictures.set(id, (pic = visualCard({ id, title, madeIn }, { onAsk: (t) => cb.onVisualAsk?.(t), onTell: (t) => cb.onVisualTell?.(t) })));
    return pic;
  }

  /** The memory note's hands (cards.js `memoryNoteEl`): its buttons send their command as the chat's; a chat it names
   *  is read from the sessions list the page holds, and what the briefing told the agent from the turn's memory, in the
   *  briefing's own words. @param {any} c @param {any} turn */
  function memoryNoteCb(c, turn) {
    return {
      addLine: (/** @type {string} */ line) => cb.onAddLine?.(line),
      chatOf: (/** @type {string} */ id) => cb.sessionRow?.(id) ?? null,
      told: async () => {
        const at = turnAtOf(turn);
        if (!at) return [];
        const mem = await api(`/memory/sessions/${encodeURIComponent(at.chain)}/turns/${at.n}/memory`);
        return (mem?.shown || []).filter((/** @type {any} */ s) => (s.layers || []).includes("briefing")).map(claimWords);
      },
    };
  }

  /** A turn's footer's hands (turn.js `footerEl`): Copy its words, Fork from it, Retry it, Watch its run, Explain its
   *  request, and go to the guidance its Reviewed chip speaks of. @param {any} c @param {any} turn
   *  @param {string} texts  its words, as Copy takes them */
  function footActs(c, turn, texts) {
    return {
      onCopy: () => { if (texts && navigator.clipboard) navigator.clipboard.writeText(texts).catch(() => {}); },
      onFork: () => cb.onFork(c, turn),
      onRetry: () => cb.onRetry(c, turn),
      onWatchRun: () => cb.onWatchRun(c),
      ...(cb.onExplain ? { onExplain: () => cb.onExplain?.(c, turn) } : {}),
      onReviewed: () => toGuidance(turn),
    };
  }

  /**
   * A guided Reviewed chip's press: the guidance after its turn comes into view — the first card drawn in a later
   * turn, a guidance turn's or a note's in a turn at work —, lit as a turn jumped to is. Where none is on the page the
   * chip's tip is all it has. @param {any} turn
   */
  function toGuidance(turn) {
    const turns = chat?.turns || [];
    const at = turns.indexOf(turn);
    if (at < 0) return;
    for (const t of turns.slice(at + 1)) {
      const v = view.get(t);
      const cards = /** @type {HTMLElement[]} */ ([...(v?.root.querySelectorAll(".guide-card") || [])]);
      if (!cards.length) continue;
      if (chat) chat.following = false;
      // A note the agent read stands in its turn's work and, while that is folded away, in its copy under it: the one
      // laid out is the one to go to; with neither, its turn.
      (cards.find((el) => el.offsetParent !== null) || v.root).scrollIntoView({ block: "center", behavior: "smooth" });
      v.root.classList.add("turn-hl");
      setTimeout(() => v.root.classList.remove("turn-hl"), 1200);
      return;
    }
  }

  /** Where a turn's edit cards ask their call's own change (HarnessV4_Four_Plan E22): its chat and number in it, null
   *  before it has both. @param {any} turn @returns {{ chain: string, n: number } | null} */
  function turnAtOf(turn) {
    const chain = chat?.chainId || turn.rec?.memory?.chain || null;
    const n = Number(turn.rec?.memory?.turn ?? turn.n);
    return chain && Number.isInteger(n) && n > 0 ? { chain: String(chain), n } : null;
  }

  /** A visual kept on a turn, as a segment: drawn from where it is kept — the turn its event names, else this turn's
   *  number in the session, or the session itself where its event says so. @param {any} turn @param {any} v
   *  @param {{ id: string, title: string, turn?: number, session?: boolean, madeIn?: string }} k */
  function keptSegment(turn, v, k) {
    const pic = pictureOf(v, k.id, k.title, k.madeIn || null);
    const chain = chat?.chainId || turn.rec?.memory?.chain || null;
    const n = Number.isInteger(k.turn) ? Number(k.turn) : Number(turn.n);
    // One the run said is kept on the session — the agent's in a turn memory keeps no row of (one it leaves out for a
    // reason of its own, or failed) — is read from there.
    pic.show({ chain, n: Number.isInteger(n) && n > 0 ? n : null, session: k.session === true, title: k.title });
    return { kind: "visual", id: k.id, el: pic.el };
  }

  /** A page the agent published, as a segment: its card made once on the turn's view, by the call that published it
   *  (HarnessV4_Artifacts_Plan AF-D34). @param {any} v
   *  @param {{ id: string, name: string, v: number, title: string, icon?: string, type?: string }} k */
  function artifactSegment(v, k) {
    let card = v.made.get(k.id);
    if (!card) v.made.set(k.id, (card = artifactCard(k, { onOpen: (name) => cb.onOpenArtifact?.(name) })));
    return { kind: "artifact", id: k.id, el: card.el };
  }

  /** A round's visuals as segments (HarnessV4_Visuals_Plan E16): the ones kept, in the order drawn, then any its model
   *  is still writing (VS-D11); then the pages it published (HarnessV4_Artifacts_Plan E18).
   *  @param {any} turn @param {any} v @param {any} cell */
  function visualSegments(turn, v, cell) {
    if (!cell) return [];
    return [
      ...(cell.visuals || []).map((/** @type {any} */ k) => keptSegment(turn, v, k)),
      ...[...(cell.writing?.values() || [])].map((/** @type {any} */ w) => {
        const pic = pictureOf(v, w.id, w.title);
        pic.writing(w);
        return { kind: "visual", id: w.id, el: pic.el };
      }),
      ...(cell.artifacts || []).map((/** @type {any} */ k) => artifactSegment(v, k)),
    ];
  }

  /** The reply's blocks the turn draws: a command answer's card carries the text (the reply header named the kind), so
   *  raw text blocks would double it. @param {any} live */
  const replyBlocks = (live) => {
    const raw = live.reply?.blocks;
    return live.turn.cardKind && Array.isArray(raw) ? raw.filter((/** @type {any} */ b) => b.type !== "text") : raw;
  };

  /** The reply's current blocks drawn now (`drawBlocks`, which paces them). @param {any} live
   *  @param {{ redraw?: boolean, again?: boolean }} [o] */
  function drawReply(live, { redraw = false, again = false } = {}) {
    if (chat !== live.chat) return; // the developer moved on; the old run keeps streaming into its own chat
    const turn = live.turn;
    const v = ensureView(turn);
    const blocks = replyBlocks(live);
    // A render that rebuilt the view (Load earlier) detached this drawing's nodes: start the handles over so
    // the drawing repaints into the new view instead of feeding detached ones (self-healing, no caller flag).
    const startsOver = drawingStartsOver(live, v);
    if (startsOver) live.blockHandles = [];
    live.handlesView = v;
    const before = live.blockHandles?.length || 0;
    while ((live.blockHandles?.length || 0) < blocks.length) {
      const i = live.blockHandles?.length || 0;
      const b = blocks[i];
      const prev = i > 0 ? live.blockHandles[i - 1] : null;
      if (prev && blocks[i - 1].type === "thinking" && !blocks[i - 1].done) prev.finish();
      if (b.type === "thinking" && !b.startedAt) { b.startedAt = Date.now(); b.done = false; }
      const firstThink = b.type === "thinking" && !blocks.slice(0, i).some((x) => x.type === "thinking");
      const hnd = b.type === "thinking" ? thinkEl(b, { isFirst: firstThink }) : blockEl(b);
      if (!again && !startsOver) arriveOnce(hnd.el);
      (live.blockHandles ||= []).push(hnd);
      turn.segments.push({ kind: "block", block: b, el: hnd.el });
    }
    // Only the open tail redraws — a closed block's text never changes, so its DOM stays untouched — unless a whole
    // set of words landed (`redraw`).
    const open = live.blockHandles[live.blockHandles.length - 1];
    if (redraw) for (const hnd of live.blockHandles) if (hnd !== open) hnd.draw();
    // A thought whose block has ended (its model call went on to a call) is done thinking, and says how long it
    // thought, as one a later block follows does (HarnessV4_Tasks U4).
    const tail = blocks[blocks.length - 1];
    if (open && tail?.type === "thinking" && !tail.done && live.reply && !tailOpen(live.reply)) open.finish();
    // The caret rides the open tail while its words still come: one element carries it, and a block that has ended
    // — its model call is over, its tools run — hands it back clean (HarnessV4_Tasks U4).
    const writing = open && (!live.reply || tailOpen(live.reply)) ? open.el : null;
    if (live.caretEl && live.caretEl !== writing) live.caretEl.classList.remove("streaming");
    live.caretEl = writing;
    writing?.classList.add("streaming");
    open?.draw();
    // Words drawn from the first (a render, or a rebuilt view, started the handles over) came after the cards laid
    // while they were missing: the cards are laid again among them, each after the words that led to it.
    if (!before && live.blockHandles.length && turn.aligned && owned(turn) && turn.segments.some((/** @type {any} */ s) => s.kind !== "block")) api_.placeCards(turn);
    else layoutSoon(turn, v);
    showPillSoon();
    // A block that just closed left its fence plain; paint it now, not per token.
    if ((live.blockHandles?.length || 0) > before) enrich();
  }

  const api_ = {
    /** An earlier turn's run, read now through the queue a row nearing the screen reads it through, unless it is read
     *  already: the Plan view asks for the newest turn's while the transcript is hidden. Resolves once the turn holds
     *  what its run says. @param {any} turn @returns {Promise<void>} */
    loadRun(turn) {
      return turn.runRead || cardQueue.run(() => historyCards(turn));
    },

    /** The work no drawn turn has read yet, its first stretch read now through the queue a row nearing the screen
     *  reads it through: Find searches what is drawn, and a turn far from the screen has not read its work. The file
     *  cards that hold their first rows alone read the rest once their first read is in, and a card made while Find is
     *  open reads them all (`findOpen`): Find searches every row of a card that holds its first (FILES_FIRST). The
     *  sub-agents' calls an ended turn's read left apart are read too, each run's at once once its read is in (Find
     *  searches a closed card's calls, render.js `revealCalls`) — or at once where its turn holds them apart already:
     *  an alignment carried from the chat's last reading (lib/turn-reads.js) is drawn before its run is asked —, and a
     *  run read while Find is open comes whole. Resolves, once each has landed, with how many turns and cards were
     *  read. @returns {Promise<number>} */
    readWork() {
      const c = chat;
      findOpen = true;
      const turns = [...view.keys()].filter((turn) => unread(turn.held));
      const cards = fileCardsIn(inner).map((st) => st.read.then(() => st.readWhole()));
      const runs = [...view.keys()].filter((turn) => turn.runId && (turn.runRead || subsApart(turn.aligned).length));
      return Promise.all([
        Promise.all(turns.map((turn) => cardQueue.run(() => heldWork(c, turn)).catch(() => {}))).then(() => turns.length),
        Promise.all(cards).then((read) => read.filter(Boolean).length),
        Promise.all(runs.map((turn) => Promise.resolve(turn.runRead).then(() => fillApart(turn)).catch(() => 0))).then((filled) => filled.reduce((a, b) => a + b, 0)),
      ]).then(([n, m, k]) => n + m + k);
    },

    /** Find's words in a closed sub-agent card's calls, or a closed file card's rows: that card's rows drawn, which it
     *  draws only while open (render.js `revealCalls`, `revealFiles`). @param {string} needle  lower case */
    revealWork(needle) {
      revealCalls(inner, needle);
      revealFiles(inner, needle);
    },

    /** Find closed: the closed cards' rows it drew let go (render.js `foldCalls`, `foldFiles`), and a file card made
     *  from now on reads its first rows alone again. */
    foldWork() {
      findOpen = false;
      foldCalls(inner);
      foldFiles(inner);
    },

    /** A full render of a chat (switch or initial paint). */
    render(c) {
      // The chat on the screen drawn again — its transcript read again, a followed turn's end, Load earlier — keeps its
      // reader's place: at its latest turn where they followed it, else the turn at the screen's top where it stood.
      const again = c === chat;
      const followed = !again || c.following !== false;
      const kept = followed ? null : topOnScreen();
      chat = c;
      view.clear();
      turnTops = null;
      cardWork = null;
      nearScreen?.disconnect(); // the old rows' waiting loads go with them
      clampSeen?.disconnect();
      inner.replaceChildren(loadEarlier);
      letStripsGo();
      const turns = c.turns || [];
      // A long session starts at its latest page. Without this the first render built every turn, and a 200-turn
      // archive blew the render budget the page size exists to protect.
      // A chat rendered once while empty (boot creates it before its turns load) must still page when the turns
      // arrive, so the offset is recomputed whenever it would hide nothing of a long session — unless its reader asked
      // for every turn.
      let hidden = hiddenOf.get(c) || 0;
      if (!hidden && turns.length > PAGE && !allAsked.has(c)) hidden = turns.length - PAGE;
      if (hidden > turns.length) hidden = Math.max(0, turns.length - PAGE);
      hiddenOf.set(c, hidden);
      loadEarlier.classList.toggle("hidden", hidden === 0);
      loadEarlier.textContent = hidden ? `Load earlier messages (${hidden})` : "Load earlier messages";
      // The session's head note: a fork says where it came from; a task that loads a session as material says so.
      if (c.forkNote || (c.load && c.loadTitle && !turns.length)) {
        inner.append(h("div", { class: "history-note" },
          c.forkNote ? h("span", { class: "fork-head" }, c.forkNote) : null,
          c.load && !turns.length ? h("span", { class: "history-title" }, `“${c.loadTitle}” loads into this chat's first turn as memory material`) : null));
      }
      inner.append(askedBox);
      const asked = paintAsked(c);
      for (const turn of turns.slice(hidden)) drawTurn(c, turn);
      // A rewind of the files alone, while its Undo stands: its line after the newest turn (the Designer's §5).
      if (c.rewind?.what === "files" && Number(c.rewind.files) > 0)
        inner.append(filesRewoundRow({ turn: Number(c.rewind.turn), files: Number(c.rewind.files) }, { h, undo: () => cb.onUndoRewind?.(c), changes: cb.onRewindFiles ? () => cb.onRewindFiles?.(c) : null }));
      if (c.live) api_.startLive(c.live);
      paintLive();
      const draft = turns.length === 0 && !asked;
      empty.el.classList.toggle("hidden", !draft);
      if (draft) empty.refresh();
      inner.classList.toggle("draft", draft);
      refreshNav();
      api_.drawSummoned(c);
      // A chat opens on its latest turn, following it; the first upward read lets go.
      c.following = followed;
      scroller.scrollTop = scroller.scrollHeight;
      const back = kept ? view.get(kept.turn)?.root : null;
      if (kept && back) scroller.scrollTop += back.getBoundingClientRect().top - scroller.getBoundingClientRect().top - kept.gap;
      lastTop = scroller.scrollTop;
      // That height counts the turns off the screen at their usual one, until they are laid out (HarnessV4_Worktrees_Plan
      // S2): the chat is measured anew, so its true height is followed even where it matches the chat shown before,
      // whose height was the last one heard — two chats of a height left the tail short of the end, the drive found.
      grows?.unobserve(inner);
      grows?.observe(inner);
      enrich(); // history's fences and diagrams, painted after the switch lands
    },

    /**
     * The compaction card you brought up (`/compaction`, the owner's words of 10-18), after the chat's last turn: the
     * card that asks before a message, from the chat's `summoned` — its figures as the ring shows them, the message it
     * holds — with the page's answers; none, no card. Its Compact shows the compaction where the Compacting row would,
     * and is kept with it while it runs. `reveal`: brought up just now (the ring's Compact now…), the view follows it.
     * @param {any} c @param {{ reveal?: boolean }} [o]
     */
    drawSummoned(c, { reveal = false } = {}) {
      if (c !== chat) return;
      const s = c.summoned;
      if (!s) return void summonedSlot.replaceChildren();
      summonedSlot.replaceChildren(askCard("", s.ask, {
        options: cb.askOptions ? (once) => cb.askOptions?.(c, s.ask, once) ?? Promise.resolve(null) : undefined,
        writerPicker: cb.writerPicker,
        onCompact: (choice, once) => cb.onSummonedCompact?.(c, choice, once),
        onSendAsIs: s.ask.sends ? () => cb.onSummonedSend?.(c) : undefined,
        onDismiss: () => cb.onSummonedDismiss?.(c),
        watch: watchCompacting,
        pending: s.work || null,
        onWorking: (w) => {
          s.work = w;
          const done = () => { if (s.work === w) s.work = null; };
          w.done.then(done, done);
        },
      }));
      // Brought up just now: the view goes to the tail, where the card is, clear of the box, as the pill's press does.
      if (reveal) {
        c.following = true;
        pill.classList.add("hidden");
      }
      if (c.following !== false) followSoon();
    },

    /** A turn's row out of the transcript, where it stands (HarnessV4_Tasks U11): the message a card stopped gives its
     *  place to the same message sent again, and the chat is not drawn again around it — the rows above stay as
     *  they are, the compaction's among them. @param {any} turn */
    dropTurn(turn) {
      const v = view.get(turn);
      if (!v) return;
      v.root.remove();
      view.delete(turn);
      turnTops = null;
      refreshNav();
    },

    /** The folder chip changed outside the chooser (the header's field): repaint the chip and the Start board. */
    refreshFolder() {
      empty.paintChip();
      empty.paintStart();
    },

    /** The Spaces moved: the chip's line on the Space its folder works in, said again. */
    refreshSpace() {
      empty.paintChip();
    },

    /** A Run on send ended (app.js `runOnFirst`): the chip says where the draft runs now. */
    refreshRunOn() {
      empty.paintChip();
    },

    /** A repository's places read again and moved (`git-moved`): Works in's, where they are its folder's. @param {any} msg */
    placesMoved(msg) {
      empty.placesMoved(msg);
    },

    /** Something the Start board weighs moved — the draft, the model, a held knob: it asks again after a pause. */
    startChanged() {
      empty.draftChanged();
    },

    /** The chat's agents asked before its first turn changed (`c.asked`): their cards, and the Start board gives way
     *  to the first of them. @param {any} c */
    drawAsked(c) {
      if (c !== chat) return;
      const asked = paintAsked(c);
      const draft = (c.turns || []).length === 0 && !asked;
      empty.el.classList.toggle("hidden", !draft);
      inner.classList.toggle("draft", draft);
      if (asked && c.following !== false) scroller.scrollTop = scroller.scrollHeight;
    },

    /** The turn's boundary rows (before its bubble, after its reply) from `turn.boundaries` / `turn.boundariesAfter`. */
    drawBoundaries(turn) {
      const v = view.get(turn);
      if (!v?.before) return;
      // Where the conversation's engine changed (HarnessV3-Views VW-D8): the divider stands nearest the turn.
      const engine = engineDividers(chat?.turns || []).get(turn);
      // Each row kept while what it is drawn from holds, and placed, never put in again (`keptBoundaries`).
      const divider = engine ? JSON.stringify([engine, turn.startedAt]) : "";
      if (v.divider?.sig !== divider) v.divider = engine ? { sig: divider, row: engineDivider(engine, turn.startedAt) } : null;
      placeChildren(v.before, [...keptBoundaries((v.keptBefore ||= new Map()), turn.boundaries || [], !!engine), ...(v.divider ? [v.divider.row] : [])]);
      // A coding agent's own compaction in the middle of this turn stands where it happened while its line does
      // (placeCards, `hereShown`): its row steps aside, and stands after the turn where there is no line (the run's log
      // swept).
      // An answered card for sub-agents that change files stands where its agent asked while it is drawn there
      // (placeCards, `heldHere`).
      const after = (turn.boundariesAfter || []).filter((/** @type {any} */ b) => !(v.hereShown && isOwnDuring(b, turn.n)) && !(b.type === "held" && v.heldHere?.has(b.id)));
      placeChildren(v.after, keptBoundaries((v.keptAfter ||= new Map()), after, false, (/** @type {any} */ b) => (b.type === "held" ? heldRowOf(v, b) : null)));
    },

    /** What rode ahead of the turn's message, said under it once the turn's head counts it (HarnessV3-Readiness
     *  RD1 c), whom it named with an `@` for the main agent to use (HarnessV4_OneAgent_Plan OA2), and a /flow's mark
     *  (OA3): each mark is swapped in place, in the row's order, so the bubble keeps whatever the developer did to it. */
    drawDelivered(turn) {
      const meta = view.get(turn)?.userEl.querySelector?.(".u-meta");
      if (!meta) return;
      meta.querySelector(".u-delivered")?.remove();
      meta.querySelector(".u-use")?.remove();
      meta.querySelector(".u-flow")?.remove();
      meta.querySelector(".u-parallel")?.remove();
      meta.querySelector(".u-plan")?.remove();
      const marks = [useEl(turn), flowEl(turn), parallelEl(turn), planEl(turn), deliveredEl(turn)].filter(Boolean);
      const after = meta.querySelector(".u-overrules") || meta.querySelector(".u-actions");
      if (marks.length) after?.after(...marks);
      markNamed(view.get(turn)?.userEl, turn);
    },

    /** A waiting message's footer drawn again from its turn (app.js `armWaiting`): what it offers moves with the turn it
     *  waits on, and its line and buttons go the moment the message goes, or is cancelled. A waiting row with none yet —
     *  one a reload restored, laid out before it was armed — has it drawn; a row of another status only where it has one. */
    drawFoot(turn) {
      const v = view.get(turn);
      if (v) dropRewind(turn, v);
      if (!v || !owned(turn) || turn.status === "error" || !(v.foot || turn.status === "waiting")) return;
      v.foot = footerEl(turn, footActs(chat, turn, replyTextOf(turn.blocks || [])));
      layout(turn, v);
    },

    /** A turn's reviews moved after it ended (app.js `setReviews`): its Reviewed chip made, said anew or taken away in
     *  the footer that stands — the footer, its Copy under the pointer, is the element it was. A turn with no footer
     *  drawn yet has the chip with it when it is. @param {any} turn */
    drawReviews(turn) {
      const row = view.get(turn)?.foot?.querySelector(".a-row");
      if (!row) return;
      const had = /** @type {HTMLElement | null} */ (row.querySelector(".a-reviewed"));
      const chip = reviewedChip(turn, () => toGuidance(turn), had);
      if (!chip) had?.remove();
      else if (chip !== had) row.append(chip);
    },

    /** A waiting message's line said anew (app.js `armWaiting`): its minutes and idle seconds move on at each look of its
     *  queue, and its words change in place — the footer, its Cancel under the pointer, stands as drawn. A row with no
     *  line drawn yet is left as it is: its footer, when drawn, says the line from the turn. */
    waitingLine(turn) {
      const el = view.get(turn)?.foot?.querySelector(".a-waiting");
      if (el && turn.waitingText) el.textContent = turn.waitingText;
    },

    /** A chat's countdown changed at the page — armed, let go, fired, held while a Continue on writes the model (app.js
     *  `armResume`, `holdResume`): its limit cards' Resume says it as it stands. @param {any} c */
    paintResume(c) {
      if (c !== chat) return;
      for (const t of c.turns || []) limitCards.get(t)?.paint();
    },

    /** A turn's limit card a Continue on spent, given back: the words it sent again were refused after they went
     *  (app.js `continueOn`) — on the turn too, where its card is not drawn now. @param {any} turn */
    limitBack(turn) {
      if (turn.limitTaken?.by === "continue") turn.limitTaken = undefined;
      limitCards.get(turn)?.back();
    },

    /** The rewind's Undo ended with the next message: the files-only line goes, and the rewound line keeps no Undo —
     *  in place, as the running turn is not drawn again. @param {any} c */
    rewindEnded(c) {
      if (c !== chat) return;
      for (const el of inner.querySelectorAll(".boundary-row.is-files-rewound")) el.remove();
      for (const el of inner.querySelectorAll(".boundary-row.is-rewound .is-undo")) el.remove();
    },

    /** Scroll to a turn by its number (the overview's "Open it in the chat"): the pages that hide it are revealed
     *  first, then it scrolls and highlights like the navigator's jump. @param {number} n */
    scrollToTurn(n) {
      const turns = chat?.turns || [];
      const i = turns.findIndex((/** @type {any} */ t) => !unsent(t) && Number(t.n) === Number(n) && (!t.past || t.history));
      if (i < 0) return false;
      if (i < (hiddenOf.get(chat) || 0)) { showFrom(chat, i); api_.render(chat); }
      const v = view.get(turns[i]);
      if (!v) return false;
      if (chat) chat.following = false;
      v.root.scrollIntoView({ block: "start", behavior: "smooth" });
      v.root.classList.add("turn-hl");
      setTimeout(() => v.root.classList.remove("turn-hl"), 1200);
      return true;
    },

    /** Begin a turn: the bubble now, the reply streams into it. The previous turn's question is answered. */
    startTurn(turn) {
      if (!owned(turn)) return; // the send's chat was switched away from before this landed
      empty.el.classList.add("hidden");
      // The Start board's wider column gives way with it: the live line's tail keeps the turns' width.
      inner.classList.remove("draft");
      // A plan's offer and its Approve stand until the person's next message of their own (11-10): one sent here ends
      // an earlier one's.
      for (const prev of chat?.turns || []) {
        const pv = prev !== turn && (prev.planOffer || prev.planReady) ? view.get(prev) : null;
        if (!pv?.offer) continue;
        pv.offer = offerOf(chat, prev);
        layout(prev, pv);
      }
      for (const prev of chat?.turns || []) {
        if (prev === turn || !(prev.paused || prev.foldLeftOpen)) continue;
        const pv = view.get(prev);
        if (prev.paused) {
          prev.paused = null;
          if (pv) {
            pv.pointer = null;
            layout(prev, pv);
          }
        }
        // A finished turn's fold stayed open until this turn, a paused one's for its question: both fold now, the work
        // after a compaction's line with them (afterFold), unless held by hand.
        prev.foldLeftOpen = false;
        if (pv && !prev.foldHeld) {
          if (pv.fold?.el) /** @type {HTMLDetailsElement} */ (pv.fold.el).open = false;
          for (const p of pv.parts || []) if (p) p.el.open = false;
        }
      }
      const v = ensureView(turn);
      layout(turn, v);
      refreshNav();
      paintLive();
      cb.onPauseChange();
    },

    /** Attach the live reply to its turn. */
    startLive(live) {
      if (live.chat && chat !== live.chat) return; // the run belongs to a chat this page is not showing
      ensureView(live.turn);
      live.turn.segments ||= [];
      live.blockHandles = [];
      // The words the reply holds already (a render while the turn runs) are drawn now, among the cards, not at the
      // next piece of the reply.
      if (live.reply?.blocks?.length && chat === live.chat) api_.drawBlocks(live, { again: true });
      paintLive();
    },

    /** The reply's current blocks — only the open tail re-renders; new nodes animate in once. With `redraw`, every
     *  block re-renders: a joining page's whole set of words (HarnessV3-Launch LD-D16) may have grown any of them.
     *  `again`: words the page had drawn before (a render while the turn runs) — they stand, they do not fade in again.
     *  Words that only grow the block being written are drawn at the reply's pace (lib/stream-pace.js): at once after a
     *  rest, else with the pieces that follow at the pace's end, from the newest words — each draw paints the block,
     *  lays the turn out and keeps a follower at the tail, which at every frame of a 120 Hz screen held its renderer at
     *  about 40% of a core.
     *  A block begun or ended, a whole set of words, a view drawn anew are drawn at once. */
    drawBlocks(live, { redraw = false, again = false } = {}) {
      if (chat !== live.chat) return; // the developer moved on; the old run keeps streaming into its own chat
      const pace = (live.pace ||= createStreamPace(() => drawReply(live)));
      const hands = live.blockHandles || [];
      const open = hands[hands.length - 1];
      // Only the block being written grew: the blocks drawn are all the reply holds, in the view that stands, and the
      // caret is still on the last of them, its words still coming.
      const grows = !redraw && !again && !!open && hands.length === (replyBlocks(live)?.length || 0) && live.handlesView === view.get(live.turn) && live.caretEl === open.el && tailOpen(live.reply);
      if (grows) return void pace.ask();
      drawReply(live, { redraw, again });
      pace.drew();
    },

    /** The words the reply's pace holds back, drawn now: the page lets go of the live view — the turn it followed from
     *  elsewhere ended, the send hands its turn over — and its last words are not left undrawn. @param {any} live */
    flushBlocks(live) {
      live.pace?.flush();
    },

    /** The run's events, aligned: cards before the next text block. A turn with no run of its own (an outside
     *  client's, a chat read from a coding agent's files) draws the cards of its archived work instead (D8,
     *  `archiveCards`): each after the words that led to it. @param {any} turn @param {any} [aligned] */
    placeCards(turn, aligned = null) {
      if (!owned(turn)) return;
      const v = ensureView(turn);
      const al = aligned || turn.aligned;
      if (!al) return void archiveCards(turn);
      turn.aligned = al;
      const live = turn.status === "streaming" || turn.status === "paused";
      // The rows and boxes drawn last stay while what each is drawn from holds (`keptBox`, render.js `DrawnRows`), and
      // each command's output where it stood (`keepOutputs`).
      v.drawn ||= new Map();
      const outputs = /** @type {[HTMLElement, number][]} */ ([...(v.root.querySelectorAll?.("pre.term-out") || [])].map((p) => [p, outputTops.get(p) || 0]));
      /** @type {Map<number, HTMLElement>} */
      const boxes = new Map();
      // What the agent told the person beside its answer (HarnessV4_Tasks C21): drawn again only when it changes.
      const noticesKey = JSON.stringify(al.notices || []);
      if (noticesKey !== v.noticesKey) {
        v.noticesKey = noticesKey;
        v.notices = al.notices?.length ? noticesEl(al.notices) : null;
      }
      turn.segments = (turn.segments || []).filter((s) => s.kind !== "cards" && s.kind !== "files" && s.kind !== "asked" && s.kind !== "visual" && s.kind !== "artifact" && s.kind !== "compacted" && s.kind !== "hold");
      // Undo on the files card: the rewind's confirm at this turn, with the files alone chosen (the Designer's §1).
      const onUndo = () => cb.onRewind?.(chat, turn, { what: "files" });
      const drawn = [...al.byRound.entries()].sort((x, y) => x[0] - y[0]).filter(([, cell]) => {
        const readSteers = (cell.steers || []).some((/** @type {any} */ s) => s.read);
        return cell.order.length || (cell.plan && cell.plan.length) || cell.snapshots.length || cell.hooks.length || cell.reports.length || cell.marks.length || cell.compactions?.length || cell.detaches?.length || cell.looks?.length || cell.envelopes?.length || cell.opens?.length || cell.envelopeNotes?.length || cell.told?.length || cell.vetoed || readSteers || (live && cell.compacting) || roundDrew(cell);
      }).map(([round]) => round);
      const onPrompt = (/** @type {any} */ t) => (cb.onPrompt ? cb.onPrompt(t) : cb.onToast?.(`The call's record is ${t.requestId}`));
      // The saved agents the main agent asked (HarnessV4_Tasks E15 step 3), and the helpers it launched that drew
      // (HarnessV4_Visuals_Plan VS-D50): while the turn runs their cards stand where it asked; settled, in one box
      // outside the fold (kind "asked", `apartCall`), so no answer the developer may overrule and no picture is behind
      // "Worked for…".
      const turnAt = turnAtOf(turn);
      const asked = live ? [] : askedRows(drawn.map((r) => al.byRound.get(r)), { onPrompt, runId: turn.runId, turnAt });
      // A coding agent's own compaction stands where it happened (the owner's words of 10-18), a line of its own right
      // after its round's box — a round with a note ends its box (cardBoxes). The newest takes the chat's row for it,
      // once the server has written one (C28): its words and its summary.
      const ownRow = ownRowOf(turn);
      const newestOwn = [...al.byRound.values()].flatMap((c) => (c.compactions || []).filter(ownCompacted)).at(-1) || null;
      let lines = 0;
      // Rounds whose cards land side by side share one box (cardBoxes), so calls fold across rounds.
      // The rounds its answered cards were asked in end their boxes: each card's line stands right after its round.
      const heldAt = heldRounds(turn, al);
      // Weighed once each: a card heard again re-places the turn only where one was answered since (`heldMoved`).
      v.heldWeighed = new Set(heldAt.keys());
      // Read once for every box (labels.js `cardAnchors`): what each box splices in below is no block, so where a round
      // lands is read off the segments as they stand at its box.
      const anchorAt = cardAnchors(turn.segments, al.byRound);
      for (const rounds of cardBoxes(turn.segments, al.byRound, drawn, live, [...heldAt.values()].filter((r) => r != null))) {
        const whole = mergedCell(rounds.map((r) => al.byRound.get(r)));
        const own = (whole.compactions || []).filter(ownCompacted);
        const cell = own.length ? { ...whole, compactions: whole.compactions.filter((/** @type {any} */ k) => !ownCompacted(k)) } : whole;
        const rows = cardsEl(cell, { live, lead: turn.engine?.kind === "team", runId: turn.runId, works: live && !waitsForYou(turn), turnAt, onPlan: cb.onOpenPlan, onUndo, onPrompt, drawn: v.drawn });
        // The visuals its rounds drew stand right after its box, in the order drawn (HarnessV4_Visuals_Plan VC-48), and
        // the pages they published after them (HarnessV4_Artifacts_Plan AF-D34).
        const pics = rounds.flatMap((r) => visualSegments(turn, v, al.byRound.get(r)));
        // Rounds that only asked hold nothing once their cards stand apart: no empty box for the fold to count.
        if (!rows.length && !pics.length && !own.length) continue;
        // The round-start's `blocksBefore` anchor (roundCardAnchor's rule): after round r's own blocks, before the
        // next round's first — the order the wire spoke them in. No anchor (a round whose start the log no longer
        // holds) keeps the counting rule.
        let idx = anchorAt(rounds[0], turn.segments);
        while (turn.segments[idx]?.kind === "cards" || turn.segments[idx]?.kind === "visual" || turn.segments[idx]?.kind === "artifact" || turn.segments[idx]?.kind === "compacted") idx++;
        const box = rows.length ? keptBox(v.boxes, rounds[0], rows) : null;
        if (box) boxes.set(rounds[0], box);
        // Kept while what it says holds, as a card is (render.js `keptRow`): a figure, the summary, the chat's row.
        const round = Number(rounds.at(-1)) || 0;
        const here = own.map((/** @type {any} */ k, /** @type {number} */ i) => {
          const b = k === newestOwn ? ownRow : null;
          const sig = JSON.stringify([k.by, k.tokensBefore, k.tokensAfter, k.ms, k.manual, String(k.summary || "").length, b && [b.id, compactionRowWords(b, { here: true }), String(b.text || "").length]]);
          return { kind: "compacted", round, at: Number(k.ts) || 0, began: Number(k.began) || 0, ms: Number(k.ms) || 0, el: keptRow(v.drawn, `compacted:${round}:${i}`, sig, () => ownCompactionRow(k, b)) };
        });
        lines += here.length;
        turn.segments.splice(idx, 0, ...(box ? [{ kind: "cards", round: rounds[0], last: rounds.at(-1), el: box }] : []), ...pics, ...here);
      }
      v.boxes = boxes;
      // The cards for sub-agents that change files its agent asked (the owner's of 11-16: "these cards are now stuck at
      // the end of the chat pushing the work above"): one answered is a line where it was asked, and steps out of the
      // rows after the turn, where one waiting stays for its answer.
      const held = placeHeld(turn, v, heldAt);
      if (held.join(" ") !== [...(v.heldHere || [])].join(" ")) {
        v.heldHere = new Set(held);
        api_.drawBoundaries(turn);
      }
      // A run whose events were swept (or never landed) leaves the turn without cards: the archived work's (D8)
      // stand in, rather than the turn losing its cards whole.
      if (!turn.segments.some((s) => s.kind === "cards" || s.kind === "compacted") && !asked.length) archiveCards(turn);
      // The chat's row for a line steps aside while the line stands, and comes back where it goes (drawBoundaries).
      if ((lines > 0) !== !!v.hereShown) {
        v.hereShown = lines > 0;
        api_.drawBoundaries(turn);
      }
      if (asked.length) turn.segments.push({ kind: "asked", round: Infinity, el: h("div", { class: "cards asked-cards" }, ...asked) });
      // One snapshot line and one files-changed card per TURN, not per round (each writing round snapshots, so a
      // per-round card repeated under every edit's pencil chip). The card spans every round: fillCounts with no
      // round sums the run's totals, and the single ⚑ line names the newest snapshot (hover for the ref).
      // BUG-16: only once the turn has settled, at its end, outside the fold (kind "files", foldSplit keeps it under
      // the answer). While the turn runs, each edit's own card carries its +/− — a summary that followed "the newest
      // round's cards" popped up mid-stream and moved after every round.
      const snaps = [...al.byRound.values()].flatMap((cell) => cell.snapshots || []);
      const allTools = [...al.byRound.values()].flatMap((cell) => [...(cell.tools?.values() || [])]);
      const files = fileChangePaths(allTools);
      if (!live && (snaps.length || files.length)) {
        const last = snaps.findLast((s) => s.ref);
        // A round records one event per agent and place it wrote in: the line counts rounds.
        const rounds = new Set(snaps.map((s) => s.round)).size;
        // A row opens Changes on this turn with its file open (GWC-37), whichever turn is the last.
        const onChanges = cb.onChanges && turn.runId ? (/** @type {{ path: string, place: string | null, agent: string }} */ f) => cb.onChanges?.(turn, f) : undefined;
        const box = h("div", { class: "cards" },
          snaps.length ? h("div", { class: "tool-note", title: last?.ref || "" }, `⚑ working tree snapshotted (${rounds} round${rounds === 1 ? "" : "s"})`) : null,
          files.length || (snaps.length && turn.runId) ? fileChangeCard(files, { onUndo, onChanges, runId: turn.runId, onOutputs: cb.onOutputs, onOutsideSeen: cb.onOutsideSeen, whole: findOpen }) : null);
        turn.segments.push({ kind: "files", round: Infinity, el: box });
      }
      paintOrders(turn, v);
      layout(turn, v);
      keepOutputs(outputs, v.root);
    },

    /** The session's sub-agents moved: the order rows on screen take their workers' states now (VW-D8). */
    paintOrders() {
      for (const [turn, v] of view) if (turn.aligned && paintOrders(turn, v)) layout(turn, v);
    },

    /** The chat's model may have changed: a pointer whose words change with it — the loop's pause waits for Filament's
     *  agent while a coding agent is the model — is drawn anew. */
    paintPointers() {
      const coder = cb.coderName?.() || "";
      for (const [turn, v] of view)
        if (v.pointer && pointerWords(turn, coder) !== v.pointerWords) {
          point(turn, v);
          layout(turn, v);
        }
    },

    /** A card for sub-agents that change files heard again: a turn of the chat with a card answered since its cards
     *  were last placed draws it where its agent asked (placeCards, `placeHeld`); the rest stand as they are. */
    heldMoved() {
      if (!chat?.chainId) return;
      const chainId = String(chat.chainId);
      for (const [turn, v] of view) {
        if (!turn.aligned || !owned(turn)) continue;
        const answered = (turn.boundariesAfter || []).filter((/** @type {any} */ b) => b?.type === "held" && heldAnswered(b, chainId));
        if (answered.some((/** @type {any} */ b) => !v.heldWeighed?.has(b.id))) this.placeCards(turn);
      }
    },

    /**
     * The session's sub-agents moved: a card whose sub-agent ended after its turn stopped hearing of it — the turn
     * paused, or ended first — is drawn again with its end, from the list (HarnessV4_Tasks U1; the bug report's L10).
     * Only a turn whose cards would change is drawn again. One the list holds no longer takes its end from its own
     * run's log (`agentLogged`), once the list is known (`agentRowsKnown`); an answer the list carries as a head, from
     * its agent's cards' form (`agentCard`).
     */
    paintAgentEnds() {
      const rows = cb.agentRows?.() || [];
      // Each drawn turn's every call looks its agent up: by id, not through the list each time.
      const byId = new Map();
      for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
      const known = !!cb.agentRowsKnown?.();
      for (const [turn, v] of view) {
        if (!turn.aligned) continue;
        const key = listEndsKey(turn.aligned, (id) => byId.get(id) || null, known, cb.agentLogged || null, cb.agentCard || null);
        if (key === (v.agentEnds || "")) continue;
        v.agentEnds = key;
        this.placeCards(turn);
      }
    },

    addSteer(turn, s) {
      if (turn.steers.some((x) => x.id === s.id)) return;
      turn.steers.push(s);
      if (!owned(turn)) return;
      const v = ensureView(turn);
      layout(turn, v); // paints the steer box (paintSteers)
    },

    markSteers(turn) {
      if (!owned(turn)) return;
      const v = ensureView(turn);
      layout(turn, v);
    },

    /** The watchdog's word on a live turn's view: lost (the note under the newest work) or back. The mark is the
     *  turn's, so a chat switched away and back draws it the same. */
    liveLost(turn, on) {
      turn.liveLost = !!on;
      if (!owned(turn)) return;
      layout(turn, ensureView(turn));
    },

    /** A turn opened from elsewhere whose run's replay is still passing (lib/replay-hold.js): its live line says it
     *  loads what the turn did so far until the replay is in. @param {any} turn @param {boolean} on */
    loading(turn, on) {
      turn.loading = !!on;
      if (owned(turn)) paintLive();
    },

    /** What the live turn does before its request is sent (decision 1 of the codebase pass): beside the timer, until
     *  it is done — the run's own events say what it does after. A summary it waits on can be let go there (D6 of
     *  the filament-agent plan). @param {any} turn @param {any} phase */
    phase(turn, phase) {
      turn.phase = phase || null;
      if (!owned(turn)) return;
      const fold = view.get(turn)?.fold;
      fold?.setState?.(turnPhaseWords(turn.phase));
      fold?.setSkip?.(turn.phase);
      paintLive();
    },

    /** A compaction under way for the chat shown (HarnessV4_Tasks U3-5, UX-8): its row after the last turn, drawn
     *  from what the server last said of it and ticking between its words, with its stop where it has one; null takes
     *  the row away. @param {import("./compacting.js").CompactionProgress | null} progress
     *  @param {{ onStop?: (() => any) | null, stopTitle?: string }} [o] */
    compacting(progress, o = {}) {
      compactingSaid = progress ? { p: progress, o } : null;
      // A card's Compact and send shows it on the card (HarnessV4_Tasks U11): no row of its own beside it.
      if (cardWork) {
        cardWork(progress, o);
        progress = null;
      }
      if (!progress) {
        clearInterval(compactingTimer);
        compactingTimer = null;
        compactingNow = null;
        compactSlot.replaceChildren();
        return;
      }
      if (!compactingNow) {
        const row = (compactingNow = compactingRow());
        compactSlot.replaceChildren(row.el);
        compactingTimer = setInterval(() => row.tick(), 1000);
      }
      compactingNow.set(progress, o);
      followSoon();
    },

    /** What the chat shown waits on while its turn is over and its work goes on (waiting-on.js `waitingOn`): the line
     *  after the last turn, its clock moving; null takes it away.
     *  @param {import("./waiting-on.js").WaitingOn | null} w @param {{ onStop?: (id: string, command: string) => void }} [o] */
    waitingOn(w, o = {}) {
      if (!w) {
        clearInterval(waitingTimer);
        waitingTimer = null;
        waitingNow = null;
        waitSlot.replaceChildren();
        return;
      }
      if (!waitingNow) {
        const row = (waitingNow = waitingOnRow({ onStop: o.onStop }));
        waitSlot.replaceChildren(row.el);
        waitingTimer = setInterval(() => row.tick(), 1000);
        followSoon();
      }
      waitingNow.set(w);
    },

    pause(turn) {
      if (!owned(turn)) return;
      const v = ensureView(turn);
      point(turn, v);
      layout(turn, v);
      paintLive();
      cb.onPauseChange();
    },

    /** The reply ended: finish thinking, the fold stays open until the next turn, the footer lands, the record follows. The
     * record and the transcript row are fetched whatever chat is displayed — they are the turn's data, and the run's own
     * chat re-renders from them when the developer switches back; only the DOM here belongs to the displayed chat. */
    async finish(live, status) {
      const turn = live.turn;
      // The words the pace held back are drawn as the stream drew them, before the end reads what is drawn.
      live.pace?.flush();
      turn.status = status;
      turn.endedAt = Date.now();
      if (chat === live.chat) paintLive();
      // The agent's questions end with its run (HarnessV3-ACP AC2-4): the dock lets go of any it still drew.
      if (turn.waiting?.length) {
        turn.waiting = [];
        cb.onPauseChange();
      }
      if (live.caretEl) { live.caretEl.classList.remove("streaming"); live.caretEl = null; }
      for (const hnd of live.blockHandles || []) { hnd.flush?.(); hnd.finish?.(); }
      const texts = replyTextOf(live.reply?.blocks || turn.blocks);
      const sites = websiteCardsFrom(texts);
      turn.segments = (turn.segments || []).filter((s) => s.kind !== "web");
      if (sites.length) turn.segments.push({ kind: "web", el: h("div", { class: "web-cards" }, ...sites.map(websiteCard)) });
      if (turn.requestId) {
        try { turn.rec = await api(`/requests/${encodeURIComponent(turn.requestId)}`); } catch {}
        // The record says how the run ended (BUG-07): stopped by a developer on any surface, or done after all.
        turn.status = endedStatus(turn.status, turn.rec, { aborted: !!live.aborter?.signal?.aborted });
      }
      // The transcript row for the turn just watched (Facade FB): the facts (the footer's numbers), a command
      // answer's card, the client words — the live stream carries none of them; one retry covers the write race.
      const isCommand = !!(turn.rec?.local || turn.rec?.memory?.command || turn.cardKind);
      /** The turns whose question this one left unanswered, marked from the read below. @type {any[]} */
      const leftUnanswered = [];
      if (turn.requestId && live.chat?.chainId) {
        const chainId = live.chat.chainId;
        // The last few rows, matched by this turn's request id: on a shared session the just-ended turn is not
        // always the last one.
        const tail = async () => {
          try {
            const tr = await api(`/sessions/${encodeURIComponent(chainId)}/transcript?limit=5&work=0`);
            const row = (tr?.turns || []).find((x) => (x.requestIds || []).includes(turn.requestId)) || null;
            // A command that compacted inside its own turn (`/compact`, `/autofit` — HarnessV3-Launch RD-D4), or a coding
            // agent that compacted its own context in the middle of it (C28): the rows, for the page to place now.
            if (row) turn.compactions = endedCompactions(tr.boundaries, row, isCommand);
            // The compactions the composer made for it — at its line, for a seed its coding agent refused, in the middle
            // of it — by the ids its record names: the rows as a read holds them.
            turn.composedCompactions = composedCompactions(tr.boundaries, turn.rec?.view?.compactions);
            // A worktree template's copy as it stands now (HarnessV4_Four_Plan FO-D37): one told on the feed before
            // the page knew the chat's id has its row from here.
            turn.copies = (tr.boundaries || []).filter((b) => b.type === "copied");
            // The settings row drawn as the turn started knew the hashes alone, as the headers carry them: the
            // transcript says what moved (HarnessV3-Views V6-10).
            const moved = row && (tr.boundaries || []).find((b) => b.type === "settings" && Number(b.beforeTurn) === Number(row.n));
            const mine = (turn.boundaries || []).find((b) => b.type === "settings");
            if (mine && Array.isArray(moved?.changes)) mine.changes = moved.changes;
            // The loop's question this turn left unanswered — the person went on with a coding agent: the turn that
            // asked says so from now, as a reload draws it.
            for (const r of tr?.turns || []) {
              const asked = r.unanswered ? turnNumbered(live.chat.turns || [], r.n) : null;
              if (!asked || asked.unanswered) continue;
              asked.unanswered = { by: String(r.unanswered.by || "") };
              leftUnanswered.push(asked);
            }
            return row;
          } catch { return null; }
        };
        let row = await tail();
        // A command answer never has facts (no model call); the retry is only for a model turn's write race — and for
        // the stamp that says whom a turn that named some with an `@` did not use (OA-D12), written after the facts — and
        // for its offer of Run as a flow, heard on the feed while it ran (OA6).
        if ((!row?.facts || ((turn.use?.length || turn.useNoted) && !Array.isArray(row?.unused)) || (turn.flowOffer === true && row?.flowOffer !== true) || (turn.planCard === true && !row?.planReady) || (!!turn.planOffer && !row?.planOffer)) && !isCommand) {
          await new Promise((later) => setTimeout(later, 700));
          row = (await tail()) || row;
        }
        if (row) {
          turn.facts = row.facts || turn.facts || null;
          turn.card = row.card || turn.card || null;
          turn.clientLabel = row.clientLabel || turn.clientLabel || null;
          // The note the reply ended on, as the archive keeps it (LD-D7). A stop from elsewhere (another tab, the
          // CLI) is the row's mark: the fold says it now, as it will after a reload.
          turn.note = row.notice || turn.note || null;
          turn.stopped = row.stopped || turn.stopped || null;
          turn.unused = Array.isArray(row.unused) ? row.unused : turn.unused || null;
          turn.flowOffer = row.flowOffer === true || turn.flowOffer === true;
          turn.planReady = row.planReady || turn.planReady || null;
          turn.planOffer = row.planOffer || turn.planOffer || null;
        }
      }
      if (chat !== live.chat) return; // switched away mid-stream: the data above is kept, the DOM is the other chat's
      for (const t of leftUnanswered) api_.drawFoot(t);
      const v = ensureView(turn);
      dropRewind(turn, v);
      if ((turn.boundaries || []).some((b) => b.type === "settings")) api_.drawBoundaries(turn);
      v.unused = unusedEl(turn);
      v.offer = offerOf(chat, turn);
      // A command Filament answered itself, painted live as the reload paints it (history.js): the answer is
      // Filament's own text, kept off the model's blocks and drawn with its card (from the transcript row);
      // the memory note comes from the facts.
      if (isCommand) {
        turn.command = true;
        turn.commandText = (turn.reply?.blocks || turn.blocks || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
        turn.blocks = [];
        turn.segments = (turn.segments || []).filter((s) => !(s.kind === "block" && s.block?.type === "text"));
        v.shim = commandAnswer(turn.commandText || "Filament answered this", turn.card || null, { onCommand: (cmd2) => cb.onCommand?.(chat, cmd2), onInspector: () => cb.onInspector?.(chat) });
      } else {
        // The note the turn carries (labels.js `shimLineOf`: another model than the chat's answered, in the words its
        // facts keep), painted live as the reload paints it.
        const said = shimLineOf(turn);
        if (said?.kind === "note") v.shim = shimNote(said.text, { warn: !!said.warn });
      }
      if (turn.facts?.memory?.related) v.memoryNote = memoryNoteEl(turn.facts.memory.related, memoryNoteCb(chat, turn));
      // The fold's live label freezes into its final words and the fold stays as it stood: open, it stays open until
      // the chat's next turn starts (startTurn), so the last steps never vanish under the reader's eyes (the owner's
      // yes of 10-27); one the developer opened or closed by hand stays as they left it.
      if (v.fold) {
        if (!turn.foldHeld && /** @type {HTMLDetailsElement} */ (v.fold.el).open) turn.foldLeftOpen = true;
        const wasOpen = /** @type {HTMLDetailsElement} */ (v.fold.el).open;
        const next = workFold(turn);
        if (wasOpen) /** @type {HTMLDetailsElement} */ (next.el).open = true;
        next.body.append(v.a);
        v.fold.el.replaceWith(next.el);
        v.fold = next;
      }
      // The settled turn's cards (BUG-13/16): the files-changed summary appears at the end, and the messages drawn in
      // the flow while it ran join the box between the work and the reply.
      api_.placeCards(turn);
      layout(turn, v);
      /** @type {string | false} */
      let asked = false;
      if (turn.status === "error" && turn.error) {
        const w = bannerWords(turn, live.reply?.errorDetail || turn.reply?.errorDetail || "");
        const ask = askOf(live.reply?.errorBody || turn.reply?.errorBody, turn.facts);
        asked = flagOf(turn, ask);
        const dismiss = dismissOf(turn, v);
        if (!turn.shimDismissed)
          v.shim = turn.facts?.limit
            ? limitShim(chat, turn, live.reply?.errorDetail || turn.reply?.errorDetail || "", dismiss)
            : ask
              ? askShim(chat, turn, ask, w.message, dismiss)
              : errorBanner(w.message, { detail: w.detail, failure: w.failure, onRetry: retryOf(chat, turn), onSignIn: signInOf(turn), onDismiss: dismiss, onToast: cb.onToast });
      }
      v.foot = footerEl(turn, footActs(chat, turn, texts), asked);
      // The tree card needs the record (for the archive's turn number) — fetched just above — and the chain. The
      // record's number is the archive's own; the transcript's n only stands in when the record fetch failed.
      if (turn.status !== "error")
        attachTree(turn, turn.rec?.memory?.chain || live.chat?.chainId, turn.rec?.memory?.turn ?? turn.n);
      layout(turn, v);
      enrich(); // the reply's last fence closed with the run
    },

    setPaused(turn, paused) {
      // The pause is the turn's data before it is this chat's DOM: a run that pauses while another chat is
      // displayed must still surface its ask when the developer switches back (render reads turn.paused).
      turn.paused = paused;
      if (!owned(turn)) return;
      api_.pause(turn);
    },

    /** The whole event log so far, aligned onto the turn (replay or live tick), drawn when `mine`: by default when the
     *  turn is the displayed chat's. With no log, what the turn holds aligned is drawn again: an ended turn's, whose log
     *  was let go of (`historyCards`). @param {any} turn @param {any[] | null} events @param {boolean} [mine] */
    applyEvents(turn, events, mine = owned(turn)) {
      // Folded onto what was aligned of the same log at the last frame: a frame's work no longer grows with the turn.
      const al = alignOnto((turn.alignCache ||= {}), events);
      turn.aligned = al; // the turn's data, whatever chat is displayed
      // The note the reply is about to end on (LD-D7): the loop says it ahead of the words, so the copy never lands
      // where the page draws the card for it.
      if (al.note) turn.note = al.note;
      if (mine) api_.placeCards(turn, al);
      // What the turn is doing now rides the live fold's label (Step 4 D6) — the call running now, named (AC1-6); an
      // ended turn's label is its final words.
      if (mine) view.get(turn)?.fold?.setState?.(liveWords(al, turn.engine?.kind === "team"));
      if (mine) paintLive();
      const seen = new Set(turn.steers.map((s) => s.id));
      // A steer the event log carries first (it can beat the POST that sent it) is drawn from here: the POST's
      // own addSteer then finds it already held and draws nothing.
      let dirty = false;
      // One the developer took back was never sent: it leaves the chat (HarnessV4_Tasks C34).
      if (al.dropped.size && turn.steers.some((/** @type {any} */ s) => al.dropped.has(String(s.id)))) {
        turn.steers = turn.steers.filter((/** @type {any} */ s) => !al.dropped.has(String(s.id)));
        dirty = true;
      }
      for (const s of al.steers.values()) if (!seen.has(s.id)) { turn.steers.push(s); dirty = true; }
      /** What the log says of a message beyond what was typed. */
      const FROM_LOG = /** @type {const} */ (["read", "unread", "taken", "after", "queuedAt", "interrupt", "waits", "word", "agent", "refused", "text", "sent", "holds", "canTakeBack", "aside", "why", "fork", "answer", "letter", "tasks"]);
      for (const s of turn.steers) {
        const src = al.steers.get(s.id);
        // How its agent takes it — queued at it, interrupting it, run next, waiting on its commands, held for its next
        // tool call, handed over — and its words as last changed are the log's to say, too.
        if (src && FROM_LOG.some((k) => src[k] !== s[k])) {
          for (const k of FROM_LOG) s[k] = src[k];
          dirty = true;
        }
      }
      if (dirty && mine) api_.markSteers(turn);
      // A coding agent's questions that wait on its run (HarnessV3-ACP AC2-4): the dock draws each while it waits, and
      // the turn keeps a line pointing there. The chat on screen is painted as they change; another, once it shows. An
      // ask the log holds as it was is the same object: only a new one is read whole, and the turn keeps it, so the next
      // read finds the same object again — painted only where it reads otherwise.
      const was = turn.waiting || [];
      const keyOf = (/** @type {any[]} */ asks) => asks.map((a) => `${a.runId ?? ""}:${a.id}`).join("\n");
      if (al.waiting.length !== was.length || al.waiting.some((a, i) => a !== was[i])) {
        const moved = keyOf(al.waiting) !== keyOf(was);
        turn.waiting = al.waiting;
        const v = moved && mine ? view.get(turn) : null;
        if (v) {
          point(turn, v);
          layout(turn, v);
        }
        if (moved && mine) cb.onPauseChange();
      }
      const lastAsk = [...al.byRound.values()].flatMap((c) => c.asks).at(-1);
      // An ask shows only on its chat's last turn: the answer is the turn after it, and the stale follower of the
      // pre-answer reply (its 30 s safety net) used to resurrect the ask over a turn that was already answered.
      // For the chat on screen that is `turn === lastTurn`; a background chat's own last turn is judged by `mine`
      // alone (it is not in the displayed chat's array, and its ask must land or it is lost to the switch back).
      const lastTurn = newestOnRecord(chat?.turns);
      if (lastAsk && !turn.paused && !turn.history && (!mine || turn === lastTurn))
        api_.setPaused(turn, pauseOf(lastAsk));
      return al;
    },
  };
  return api_;
}

