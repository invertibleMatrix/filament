// @ts-check
// One turn's DOM: the user row (bubble, reference chips, the clamp, the steer status line, the
// hover actions), the assistant group's fold header with its live duration, the work body, the final text, and the
// footer (hover actions, the time label, the honest numbers). The timeline owns when these are built and laid out.
import { overruleMark } from "../composer/overrule-line.js";
import { h, setHtml } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { costWords } from "../../lib/cost.js";
import { cacheSaid } from "../../lib/cache-facts.js";
import { mdChat } from "../lib/md-stream.js";
import { ICONS } from "../lib/icons.js";
import { menu } from "../lib/ui.js";
import { foldWords, messageTimeLabel, referenceChips, stopReasonText, factsLine, footerFacts, FACT_LABELS, turnPhaseWords, skipWaitWords, liveWords, placeName, RESUMED_WORDS, goalRoundWords, wokeWords, IDLE_TOLD, SYNCED_WORDS, TEAM_RESULT_WORDS, WATCHED_WORDS, GUIDED_WORDS, GUIDE_SUB_WORDS, reviewedWords, steerFromWords, BRIEF_WORDS, BRIEF_TIP, FLOW_END_WORDS, FLOW_DRIVE_WORDS, FLOW_ON_WORDS, FLOW_BACK_WORDS, outsideGitWords } from "../lib/labels.js";
import { PLAN_DEPTH_CHOICES, planReadyWords } from "../lib/plan-ask.js";
import { cardEl } from "./cards.js";
import { engineTag } from "./team-turns.js";
import { pictureThumb, SENT_TYPES } from "../lib/picture-view.js";
import { comeBackNote } from "../lib/come-back.js";
import { forkable, unsent } from "./history.js";
import { chatLinkEl, openTaggedChat } from "../lib/chat-open.js";
import { followWhileDrawn } from "../lib/follow-drawn.js";
import { whenShown } from "../lib/when-shown.js";
import { chipActions } from "./tools/layout.js";
import { WATCH_PRESS } from "./watch-line.js";
import { state } from "../state.js";
import { teamsOn } from "../../lib/teams-on.js";

/** The working-timer idiom: mutate textContent on one shared interval, never re-render the row — each element its
 * words for the time since its start. Guarded so the module stays importable where the page does not run — the
 * DOM-free tests import commandAnswer from here. @type {Map<HTMLElement, (ms: number) => string>} */
const timers = new Map();
if (typeof window !== "undefined") {
  window.setInterval(() => {
    const now = Date.now();
    for (const [el, say] of timers) {
      if (!el.isConnected) { timers.delete(el); continue; }
      const t0 = Number(el.dataset.t0 || 0);
      if (t0) el.textContent = say(now - t0);
    }
  }, 1000);
}

/**
 * Words that move with the clock: `say` of the time since `t0`, said again each second while `el` is on the page.
 * @param {HTMLElement} el @param {number} t0 @param {(ms: number) => string} say @returns {HTMLElement}
 */
export function ticking(el, t0, say) {
  el.dataset.t0 = String(t0);
  el.textContent = say(Date.now() - t0);
  timers.set(el, say);
  return el;
}

/**
 * A tagged chat's chip in the bubble (the Designer's of 10-26): its title under the chats' mark, the chat's link — a
 * press opens it, or, where it is no longer kept, says so and greys (lib/chat-open.js). Copy and Edit keep the
 * message's own text.
 * @param {{ title: string, id: string }} c
 */
const chatChip = (c) => chatLinkEl(c.title, c.id, { "data-ref": `chat:${c.id}` });

/** A user bubble's body: plain text, with `@file` / `/command` / `#session` / `$skill` and a tagged chat as chips. @param {string} text */
function bubbleBody(text, named = new Map()) {
  const REF_ICONS = { "@": ICONS.file, "/": ICONS.terminal, "$": ICONS.wandSparkles, "#": ICONS.messageCircle };
  return referenceChips(text).map((part) => {
    if (part.kind === "text") return part.text;
    if (part.kind === "chat") return chatChip(part);
    const who = part.mark === "@" ? named.get(String(part.name).toLowerCase()) : undefined;
    if (who) return namedChip(part.name, who);
    const ic = h("span", { class: "ref-ic", html: part.file?.endsWith("/") ? ICONS.folder : REF_ICONS[part.mark] || ICONS.file });
    // A project file the message tagged (the owner's of 11-04): a press opens it beside the chat, at its lines where the
    // tag names them. A folder's opens none.
    const file = part.file && !part.file.endsWith("/") && chipActions.open ? part.file : "";
    if (file)
      return h("button", {
        class: "ref-chip is-file", type: "button", "data-ref": `@${part.name}`, title: `${part.name} — open it beside the chat`,
        onclick: (/** @type {Event} */ e) => { e.stopPropagation(); chipActions.open?.(file, part.range || ""); },
      }, ic, part.name);
    return h("span", { class: "ref-chip", "data-ref": `${part.mark}${part.name}`, title: `${part.mark}${part.name}` }, ic, part.name);
  });
}

/**
 * The agents and teams a turn's message named with an `@` for the main agent to use (HarnessV4_OneAgent_Plan OA2), by
 * the word typed, lowered. @param {any} turn @returns {Map<string, { name: string, team: boolean }>}
 */
const namedOf = (turn) =>
  new Map((Array.isArray(turn?.use) ? turn.use : []).map((/** @type {any} */ n) => [String(n?.tag || n?.key || "").toLowerCase(), { name: String(n?.name || ""), team: !n?.tag }]));

/** The bubble's chip for an `@word` that named an agent or a team for the main agent to use: theirs, not a file's. @param {string} word @param {{ name: string, team: boolean }} who */
const namedChip = (word, who) =>
  h("span", { class: "ref-chip is-named", "data-ref": `@${word}`, title: `${who.team ? `the ${who.name} team` : who.name}, named with @ for your agent to use` },
    h("span", { class: "ref-ic", html: who.team ? ICONS.users : ICONS.atSign }),
    word);

/**
 * A live turn's head named whom its message named for the main agent to use (the timeline's `drawDelivered`): the
 * bubble's chips for those words become theirs, in place, the rest of the bubble as it is.
 * @param {any} root  the user row @param {any} turn
 */
export function markNamed(root, turn) {
  const named = namedOf(turn);
  if (!named.size) return;
  for (const chip of [...(root?.querySelectorAll?.(".u-bubble .ref-chip") || [])]) {
    const ref = String(chip.getAttribute?.("data-ref") || "");
    const who = ref.startsWith("@") && !chip.classList?.contains("is-named") ? named.get(ref.slice(1).toLowerCase()) : undefined;
    if (who) chip.replaceWith(namedChip(ref.slice(1), who));
  }
}

/**
 * What rode ahead of a turn's message, said under it: sub-agents' reports, and background shells' exits (TL-D24),
 * that reached the session while no turn ran. The model read them with the message; they are not the developer's
 * words. "" when nothing did. What Filament said of an overrule rode there too (`overrules`): it is the message's own
 * mark (`overrulesEl`), not a sub-agent's message. Neither is the line that names whom the agent may ask (`asking`):
 * standing words, which the chat's "The main agent may ask" row already says. Nor is the line naming whom the
 * message named with an `@` for the main agent to use (`use`): the message's own mark says them (`useEl`). Nor a
 * /flow's line (`flow`, OA3): its mark is `flowEl`; nor a /parallel's (`parallel`, Phase 5): `parallelEl`; nor the box's
 * side by side line (`side`, 11-06): standing words its chip says. A flow's start, told to the main agent (`flowStarts`, OA-D8), is
 * Filament's word and said as the flow you started; so is the word of a flow it drives In place (`flowNews`, OA4).
 * A rewind's line (`rewindNote`, the Designer's rewind in place) is said as word of your rewind; the line on why the
 * goal's drive halted (`goalHalt`, core/goal-drive.js `haltLine`), as word of why your goal halted. Of the shells' items,
 * a watch's lines (`shellWatch`), the agent's come-back note (`shellWake`), Filament's check-in on a command that runs
 * on with its agent idle (`shellIdle`, sessions/idle-wake.js) and word of your Cancel of a come-back (`shellCancel`,
 * the Designer's of 10-27) are no command's end, and said so. `deliveredCounts` counts each; this says them.
 * @param {DeliveredTurn} turn
 */
export function deliveredWords(turn) {
  const { rewind, goal, starts, news, messages, ends, watched, wake, idle, cancelled } = deliveredCounts(turn);
  const said = [
    rewind ? "word of your rewind" : "",
    goal ? "word of why your goal halted" : "",
    starts ? (starts === 1 ? "the flow you started" : `the ${starts} flows you started`) : "",
    news ? "word of the flow it drives" : "",
    messages ? `${messages} message${messages === 1 ? "" : "s"} from agents` : "",
    ends ? `${ends} background shell exit${ends === 1 ? "" : "s"}` : "",
    watched ? (watched === 1 ? "the lines a watch caught" : `the lines ${watched} watches caught`) : "",
    wake ? "the agent's come-back note" : "",
    idle ? "Filament's check-in on a running command" : "",
    cancelled ? "word of the come-back you cancelled" : "",
  ].filter(Boolean);
  return said.length ? `with ${said.join(" and ")}` : "";
}

/**
 * @typedef {{ deliveries?: number, shellExits?: number, shellWatch?: number, shellWake?: number, shellIdle?: number, shellCancel?: number, overrules?: readonly any[], asking?: number, use?: readonly any[], flow?: boolean, parallel?: boolean, plan?: boolean, side?: boolean, flowStarts?: number, flowNews?: number, rewindNote?: boolean, goalHalt?: boolean }} DeliveredTurn
 */

/**
 * How many of each kind rode ahead of a turn's message (`deliveredWords`): `messages` are the agents' — sub-agents'
 * reports —, `ends` the commands' ends.
 * @param {DeliveredTurn} turn
 */
export function deliveredCounts(turn) {
  const exits = Math.min(Number(turn.shellExits) || 0, Number(turn.deliveries) || 0);
  const watched = Math.min(Number(turn.shellWatch) || 0, exits);
  const wake = Math.min(Number(turn.shellWake) || 0, exits - watched);
  const idle = Math.min(Number(turn.shellIdle) || 0, exits - watched - wake);
  const cancelled = Math.min(Number(turn.shellCancel) || 0, exits - watched - wake - idle);
  const ends = exits - watched - wake - idle - cancelled;
  const over = Array.isArray(turn.overrules) ? turn.overrules.length : 0;
  const use = Array.isArray(turn.use) && turn.use.length ? 1 : 0;
  const flow = turn.flow === true ? 1 : 0;
  const parallel = turn.parallel === true ? 1 : 0;
  const plan = turn.plan === true ? 1 : 0;
  const side = turn.side === true ? 1 : 0;
  const rewind = turn.rewindNote === true ? 1 : 0;
  const goal = turn.goalHalt === true ? 1 : 0;
  const rest = Math.max(0, (Number(turn.deliveries) || 0) - exits - over - use - flow - parallel - plan - side - rewind - goal - (Number(turn.asking) || 0));
  const starts = Math.min(Number(turn.flowStarts) || 0, rest);
  const news = Math.min(Number(turn.flowNews) || 0, rest - starts);
  return { rewind, goal, starts, news, messages: rest - starts - news, ends, watched, wake, idle, cancelled };
}

/**
 * The user row's line saying `deliveredWords`, or null — drawn with the row, and again when a live turn's head
 * counts them (the timeline's `drawDelivered`, HarnessV3-Readiness RD1 c), as `useEl` is.
 * @param {{ deliveries?: number, shellExits?: number }} turn
 */
export function deliveredEl(turn) {
  const said = deliveredWords(turn);
  return said
    ? h("span", { class: "u-from u-delivered", title: "an agent's report or your launch notice, or a background shell that ended unread, delivered to the main agent with this message" }, said)
    : null;
}

/**
 * The user row's mark for a message that overrules what saved agents answered the main agent (HarnessV4_Tasks E15
 * step 3): "overrules PM's answer"; null for any other message.
 * @param {{ overrules?: readonly { name?: string }[] }} turn
 */
export function overrulesEl(turn) {
  const list = Array.isArray(turn.overrules) ? turn.overrules : [];
  return list.length
    ? h("span", { class: "u-from u-overrules", title: "Filament told the main agent whose answer your words stand over, ahead of your message" }, overruleMark(list))
    : null;
}

/** Names in a sentence: "A", "A and B", "A, B and C". @param {readonly string[]} names */
const andList = (names) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * The user row's mark for a message that named agents or teams with an `@` for the main agent to use
 * (HarnessV4_OneAgent_Plan OA2): "for your agent: Reviewer" — nothing started at Send. Null for any other message.
 * @param {{ use?: readonly { name?: string, key?: string }[] }} turn
 */
export function useEl(turn) {
  const names = (Array.isArray(turn.use) ? turn.use : []).map((a) => {
    const name = String(a?.name || "");
    return name && a?.key ? `the ${name} team` : name;
  }).filter(Boolean);
  if (!names.length) return null;
  return h("span", { class: "u-from u-use", title: "Named with @ for your agent to use: Filament told it so ahead of your message, and nothing started at Send" }, `for your agent: ${andList(names)}`);
}

/**
 * The user row's mark for a /flow message (HarnessV4_OneAgent_Plan OA3): "/flow · for your agent to design" — Filament
 * asked the main agent to design a flow from the words, and its draft stands over the box. Null for any other message.
 * @param {{ flow?: boolean }} turn
 */
export function flowEl(turn) {
  return turn.flow === true
    ? h("span", { class: "u-from u-flow", title: "You typed /flow: Filament asked your agent to design a flow from these words. Its draft stands over the message box; nothing runs until you press Start" }, "/flow · for your agent to design")
    : null;
}

/**
 * The user row's mark for a /parallel message (Phase 5): "/parallel · for your agent to re-plan" — Filament asked the
 * main agent to re-plan the work so its independent tasks can run in parallel, and the card after its reply offers
 * them; sent with Parallelize tasks on (`parallelOn`, the owner's of 11-09), the agent starts them itself, and no card
 * asks. Null for any other message.
 * @param {{ parallel?: boolean, parallelOn?: boolean }} turn
 */
export function parallelEl(turn) {
  return turn.parallel === true
    ? h("span", { class: "u-from u-parallel", title: turn.parallelOn === true ? "You typed /parallel with Parallelize tasks on: Filament asked your agent to re-plan the work so its independent tasks can run in parallel, and to start those on sub-agents itself — your consent. No card asks you first" : "You typed /parallel: Filament asked your agent to re-plan the work so its independent tasks can run in parallel. Where two or more can, a card after its reply offers them; nothing starts until you press Accept" }, "/parallel · for your agent to re-plan")
    : null;
}

/**
 * The user row's mark for a /plan message (the owner's of 11-05): "/plan · for your agent to plan" — Filament asked the
 * main agent to plan the work whole before any of it starts, and the card after its reply opens the Plan. Null for any
 * other message.
 * @param {{ plan?: boolean }} turn
 */
export function planEl(turn) {
  return turn.plan === true
    ? h("span", { class: "u-from u-plan", title: "You typed /plan: Filament asked your agent to plan the work whole before any of it starts — a short job on its checklist, complex work on its task graph — and to end its reply with the plan's summary. Nothing of it starts until you say go" }, "/plan · for your agent to plan")
    : null;
}

/**
 * A /plan's card under its reply (the owner's of 11-05: "a card asking that graph is ready to view which just opens the
 * Plan tab"): what the plan left — its tasks on the graph, its steps on the checklist — and its goal, with View the plan.
 * On the chat's newest turn (`acts`, the owner's plan mode of 11-06), Approve — the go that lets the plan start — and
 * Amend, which puts /plan in the box for what to change. Null where the turn is no /plan's, ended without its reply, or
 * its agent had nothing to plan on.
 * @param {{ planReady?: { tasks?: number, steps?: number, goal?: string } | null, status?: string, stopped?: unknown }} turn
 * @param {() => void} onOpen @param {{ onApprove: () => void, onAmend: () => void } | null} [acts]
 */
export function planReadyEl(turn, onOpen, acts = null) {
  const ready = turn.planReady;
  if (!ready || !(Number(ready.tasks) + Number(ready.steps) > 0) || turn.status !== "done" || turn.stopped) return null;
  const goal = String(ready.goal || "").trim();
  return h("div", { class: "turn-offer turn-plan-ready" },
    h("button", { class: "zc-btn zc-btn-v-outline zc-btn-s-sm", type: "button", title: "Opens the Plan tab: the plan's tasks, what each needs and writes, and its summary kept behind the graph", onclick: () => onOpen() },
      h("span", { class: "zc-btn-ic", html: ICONS.listTodo }), "View the plan"),
    acts ? h("button", { class: "zc-btn zc-btn-v-default zc-btn-s-sm", type: "button", title: "Your agent goes on with the plan as it stands: its sub-agents' tasks start as their needs are done", onclick: () => acts.onApprove() }, "Approve") : null,
    acts ? h("button", { class: "zc-btn zc-btn-v-ghost zc-btn-s-sm", type: "button", title: "Puts /plan in the message box: say what to change, and your agent plans again — still changing nothing", onclick: () => acts.onAmend() }, "Amend") : null,
    h("span", { class: "turn-offer-why" }, planReadyWords(ready), goal ? ` — ${goal}` : ""));
}

/**
 * A plan offered under the reply (the owner's plan mode of 11-06): its agent weighed the message as complex work, and
 * asks whether to plan it first. The depth — Light, Standard or Deep, the agent's suggestion chosen; Plan sends /plan with
 * the words of the message and the depth, Just do it a plain go. Parallelize tasks is no switch of the card's: Settings ›
 * Experimental's holds for every chat (the owner's of 11-08). It stands until the person's next message of their own
 * (`stands`, history.js `cardStands`, the owner's of 11-10): a turn they did not send leaves it; after their message its
 * moment has passed. The offer is written as it is made, so a turn that failed after it, or that a restart cut off, keeps
 * its card. Null where the turn offered none, was stopped, still runs, or has no words of the person's.
 * @param {{ planOffer?: { depth?: string, side?: boolean } | null, status?: string, stopped?: unknown, userText?: string, cutOff?: boolean }} turn
 * @param {boolean} stands
 * @param {{ onPlan: (o: { words: string, depth: string }) => void, onJustDo: () => void }} on
 */
export function planOfferEl(turn, stands, on) {
  const words = turn.userText && turn.userText !== "(attachments)" ? String(turn.userText).trim() : "";
  const offer = turn.planOffer;
  const ended = turn.status === "done" || turn.status === "error" || (turn.status === "open" && turn.cutOff === true);
  if (!offer || !stands || !ended || turn.stopped || !words) return null;
  let depth = PLAN_DEPTH_CHOICES.some((d) => d.key === offer.depth) ? String(offer.depth) : "standard";
  /** @type {any[]} */
  const chips = [];
  const what = h("span", { class: "turn-offer-why tpo-what" }, "");
  const paint = () => {
    for (const c of chips) {
      const on = c.key === depth;
      c.el.classList.toggle("is-on", on);
      c.el.setAttribute("aria-checked", on ? "true" : "false");
    }
    what.textContent = PLAN_DEPTH_CHOICES.find((d) => d.key === depth)?.what || "";
  };
  for (const d of PLAN_DEPTH_CHOICES) {
    const el = h("button", { class: "tpo-depth", type: "button", role: "radio", "aria-checked": "false", title: d.what, onclick: () => { depth = d.key; paint(); } }, d.label);
    chips.push({ key: d.key, el });
  }
  paint();
  return h("div", { class: "turn-offer turn-plan-offer" },
    h("div", { class: "tpo-head" },
      h("span", { class: "zc-btn-ic", html: ICONS.listTodo }),
      h("span", { class: "tpo-title" }, "Your agent offers to plan this first")),
    h("span", { class: "turn-offer-why" }, "It changes nothing while it plans, and the plan waits for your Approve."),
    h("div", { class: "tpo-row" },
      h("div", { class: "tpo-depths", role: "radiogroup", "aria-label": "How deep" }, ...chips.map((c) => c.el))),
    what,
    h("div", { class: "tpo-row" },
      h("button", { class: "zc-btn zc-btn-v-default zc-btn-s-sm", type: "button", title: "Sends /plan with your words: your agent plans read-only, and the plan waits for your Approve", onclick: () => on.onPlan({ words, depth }) }, "Plan"),
      h("button", { class: "zc-btn zc-btn-v-ghost zc-btn-s-sm", type: "button", title: "Your agent goes on with the work, no plan first", onclick: () => on.onJustDo() }, "Just do it")));
}

/**
 * A turn's line on whom its message or its notes named with an `@` and its main agent did not use in it
 * (HarnessV4_OneAgent_Plan OA-D12): "You named @reviewer; it was not used". Null where it used them all, or named none.
 * @param {{ unused?: readonly { tag?: string, key?: string }[] }} turn
 */
export function unusedEl(turn) {
  const tags = (Array.isArray(turn.unused) ? turn.unused : []).map((n) => String(n?.tag || n?.key || "")).filter(Boolean).map((t) => `@${t}`);
  if (!tags.length) return null;
  return h("p", { class: "shim-note turn-unused", title: "Named with @ for your agent to use: it did not launch or send it in this turn" },
    h("span", { class: "shim-mark" }, "Filament"), `You named ${andList(tags)}; ${tags.length === 1 ? "it was" : "they were"} not used`);
}

/**
 * Run as a flow, under a reply whose main agent offered it (HarnessV4_OneAgent_Plan OA6, OA-D14): the press sends
 * `/flow` with the words of the message, and the agent drafts the flow then — the offer drew nothing. Null where the
 * turn offered none, ended without its reply, or has no words of the person's.
 * @param {{ flowOffer?: boolean, status?: string, stopped?: unknown, userText?: string }} turn @param {(words: string) => void} onPress
 */
export function flowOfferEl(turn, onPress) {
  const words = turn.userText && turn.userText !== "(attachments)" ? String(turn.userText).trim() : "";
  if (turn.flowOffer !== true || turn.status !== "done" || turn.stopped || !words) return null;
  return h("div", { class: "turn-offer" },
    h("button", { class: "zc-btn zc-btn-v-outline zc-btn-s-sm", type: "button", title: `Sends /flow with your words: your agent drafts a flow of ${teamsOn(state.config) ? "your agents and teams" : "your agents"} over the message box, and nothing runs until you press Start`, onclick: () => onPress(words) },
      h("span", { class: "zc-btn-ic", html: ICONS.waypoints }), "Run as a flow"),
    h("span", { class: "turn-offer-why" }, "Your agent offers to draw your message as a flow"));
}

/**
 * The pictures a message carries (V4-D301), from its own content: the model got each whole, and the archive keeps it
 * so, so a turn read back after a reload has them too. Each is named by the file it came from while the page still
 * knows it (the live turn's attachments, in the order they were sent), else as a picture you sent.
 * @param {any} turn @returns {{ src: string, alt: string }[]}
 */
export function sentPictures(turn) {
  const names = (turn.attachments || []).filter((/** @type {any} */ a) => a?.kind === "image").map((/** @type {any} */ a) => String(a.name || ""));
  /** @type {{ src: string, alt: string }[]} */
  const out = [];
  let i = 0;
  for (const b of Array.isArray(turn.userContent) ? turn.userContent : []) {
    if (b?.type !== "image") continue;
    const name = names[i++] || "";
    const s = b.source;
    if (s?.type !== "base64" || !SENT_TYPES.has(String(s.media_type)) || !s.data) continue;
    out.push({ src: `data:${s.media_type};base64,${s.data}`, alt: name || "A picture you sent" });
  }
  return out;
}

/**
 * The PDFs a message carries, by name, from its own content as `sentPictures` reads its pictures: the archive keeps
 * each whole, so a turn read back after a reload names them too.
 * @param {any} turn @returns {string[]}
 */
export function sentPdfs(turn) {
  return (Array.isArray(turn.userContent) ? turn.userContent : [])
    .filter((/** @type {any} */ b) => b?.type === "document" && b.source?.media_type === "application/pdf")
    .map((/** @type {any} */ b) => String(b.title || "A PDF you sent"));
}

/**
 * The user row: the pictures you sent above your words (V4-D301), any other file named on a chip — a PDF by the name
 * its content gives it, else (a message whose content the page no longer holds) by its attachment's.
 * @param {any} turn
 * @param {{ onCopy: () => void, onRewind?: () => void }} cb  `onRewind`: the rewind's confirm at this message, which
 *   took Edit's place (the Designer's rewind in place of 10-27; a fork with the text filled in is its Fork instead)
 */
export function userRow(turn, cb) {
  const pics = sentPictures(turn);
  const pdfs = sentPdfs(turn);
  const words = turn.userText && turn.userText !== "(attachments)" ? turn.userText : "";
  // Pictures alone need no words under them; files alone still say so.
  const text = words || (pics.length ? "" : turn.attachments?.length || pdfs.length ? "(attachments)" : turn.userText || "");
  const files = [
    ...(turn.attachments || []).filter((/** @type {any} */ a) => a?.kind !== "image" && (a?.kind !== "pdf" || !pdfs.length)).map((/** @type {any} */ a) => String(a.name)),
    ...pdfs,
  ];
  const bubble = h("div", { class: "u-bubble" }, ...bubbleBody(text, namedOf(turn)));
  // Long bodies clamp at 12 lines; the chevron expands them. Measured, not guessed — wrapping decides.
  const clamp = h("button", {
    class: "u-clamp hidden", type: "button", title: "show the whole message", "aria-label": "expand message",
    html: ICONS.chevronDown,
    onclick: (e) => { e.stopPropagation(); bubble.classList.toggle("open"); },
  });
  const steerState = turn.steerState
    ? h("div", { class: `u-status ${turn.steerState}` }, turn.steerState === "steered" ? "Conversation steered" : "Waiting for the run's next step…")
    : null;
  // Which window typed this turn (Step 3 D1): a turn from another client names it under the message, where it is
  // read as who said it; the harness's own turns say nothing.
  const from = turn.history && turn.client && turn.client !== "harness"
    ? h("span", { class: "u-from", title: `typed in ${turn.clientLabel || turn.client}` }, `from ${turn.clientLabel || turn.client}`)
    : null;
  const delivered = deliveredEl(turn);
  const overrules = overrulesEl(turn);
  const use = useEl(turn);
  const flow = flowEl(turn);
  const parallel = parallelEl(turn);
  // A /plan's mark, or the person's Approve of a plan (11-06): one at most, as a message is one or the other.
  const plan = planEl(turn);
  return h("div", { class: "u" },
    pics.length
      ? h("div", { class: "u-shots" },
          h("div", { class: pics.length > 1 ? "tool-shots many" : "tool-shots" },
            ...pics.map((p) => pictureThumb(p.src, p.alt, (img) => img.classList.add("gone")))))
      : null,
    files.length
      ? h("div", { class: "u-atts" }, ...files.map((name) => h("span", { class: "att" }, name)))
      : null,
    // A history turn (an earlier turn of a continued session) shows its message like any other; only a turn running
    // elsewhere, which has no message of its own here, skips the bubble — and pictures sent alone, which need none.
    (turn.past && !turn.history) || (pics.length && !words) ? null : h("div", { class: "u-bubble-wrap" }, bubble, clamp),
    steerState,
    // A team beside's lead's first message: the main chat's record it read, folded (team_v2_plan §5.3).
    turn.recordText ? h("details", { class: "sync-read u-record" }, h("summary", {}, "What the lead read: the main chat's record"), h("div", { class: "sync-text" }, turn.recordText)) : null,
    // A flow's team box: what the flow handed its lead — the person's words and every result before it (HarnessV4_Flow_Plan F5).
    turn.handoffText ? h("details", { class: "sync-read u-record" }, h("summary", {}, "What the flow handed it: your words and every result before it"), h("div", { class: "sync-text" }, turn.handoffText)) : null,
    // The actions come first so the window's name keeps the bubble's right edge while they are hidden.
    h("div", { class: "u-meta" },
      h("div", { class: "u-actions" },
        h("button", { class: "u-act", type: "button", title: "Copy", "aria-label": "Copy", html: ICONS.copy, onclick: cb.onCopy }),
        // Not on a rewound turn shown under its line: read-only, Copy alone.
        cb.onRewind && !turn.rewound
          ? h("button", { class: "u-act u-rewind", type: "button", title: "Rewind to this message — change it and send it again; the files can go back too", "aria-label": "Rewind", html: ICONS.undo, onclick: cb.onRewind })
          : null),
      overrules,
      use,
      flow,
      parallel,
      plan,
      delivered,
      from));
}

/**
 * What began the turn Filament sent to go on with one a restart cut off (HarnessV3-TaskGraph-v2 TG2-D83), in the
 * message's place: Filament's words, not the developer's — the row a coding agent's own turn has, no Copy, no Edit.
 */
export function resumedRow() {
  return h("div", { class: "own-turn" },
    h("div", { class: "boundary-row is-own", title: "Filament restarted while the turn above ran; at its start it told the agent so and asked it to go on — no message from you began this turn" },
      h("span", { class: "boundary-label" }, h("span", { class: "boundary-ic", html: ICONS.rotateCcw }), RESUMED_WORDS)));
}

/**
 * What began the turn Filament sent as a driving goal's next round (core/goal-drive.js), in the message's place: its
 * words, as a restart's resume has them — no Copy, no Edit.
 * @param {{ goalRound?: { round: number, cap: number } }} turn
 */
export function goalRoundRow(turn) {
  const r = turn?.goalRound || { round: 0, cap: 0 };
  return h("div", { class: "own-turn" },
    h("div", { class: "boundary-row is-own", title: "The goal drives on: the turn above ended with no mark of done or blocked, so Filament sent the agent the goal's next round — no message from you began this turn. /goal hold holds it" },
      h("span", { class: "boundary-label" }, h("span", { class: "boundary-ic", html: ICONS.goal }), goalRoundWords(r.round, r.cap))));
}

/**
 * One thing the agent was told in a turn Filament sent by itself, as that turn's capsule lists it: green for a clean exit
 * or a time that came, amber for an exit that failed or lines watched. A command's end and a watch's lines are said in
 * the agent's own words, made a sentence; the time the agent set says its note instead (the Designer's of 10-27: "The
 * agent's note: Check the deploy…"), cut to a row's room, whole on hover (`title`).
 * @param {string} told  the line the agent read @returns {{ tone: "ok" | "warn", words: string, title: string }}
 */
export function wokeLine(told) {
  const note = /^\[Filament: the time you set has come\b[\s\S]*? Your note: ([\s\S]*)\]$/.exec(told);
  if (note) return { tone: "ok", words: `The agent's note: ${comeBackNote(note[1])}`, title: note[1] };
  // Filament's check-in on a command that runs on (sessions/idle-wake.js): said for the person, not to the agent.
  const idle = IDLE_TOLD.exec(told);
  if (idle) return { tone: "warn", words: `Idle ${idle[1]} min while ${idle[2]} ran on — the next check-in in ${idle[3]} min if it still runs`, title: "" };
  const words = told.replace(/^\[Filament: /, "").replace(/\]$/, "").replace(/^./, (c) => c.toUpperCase());
  return { tone: /exited with code 0\b|the time you set/.test(told) ? "ok" : "warn", words, title: "" };
}

/** A capsule's line past this many characters, or holding a line break, folds to one row (`ownLine`). */
const LINE_ROOM = 100;

/**
 * One line of the list under a turn's capsule — a thing the agent was told, or a background task's end — its glyph in
 * its tone. A long one (a line break in it, or past `LINE_ROOM` characters: a command's end with its output's last lines)
 * stands folded to one row, its words cut with an ellipsis and a chevron at its right (the owner's words of 11-03: "put
 * this background command output as collapsible text on a single line"). Pressed, or Enter or Space on it, it opens
 * whole, its line breaks kept, and folds again; a press that ends a selection of its words is not one, so a path being
 * copied stays. The turn keeps the lines that stand open by their place (`linesOpen`): drawn again, they are drawn open.
 * @param {{ linesOpen?: Set<number> }} turn @param {number} i  the line's place in the list
 * @param {{ tone: string, glyph: string, words: string, title: string }} l
 */
function ownLine(turn, i, l) {
  const cls = `own-task${l.tone ? ` tone-${l.tone}` : ""}`;
  const ic = h("span", { class: "own-task-ic", "aria-hidden": "true" }, l.glyph);
  const words = h("span", { class: "own-task-words" }, l.words);
  if (!l.words.includes("\n") && l.words.length <= LINE_ROOM) return h("div", { class: cls, title: l.title || undefined }, ic, words);
  const open = turn.linesOpen?.has(i) === true;
  const flip = () => {
    const on = row.classList.toggle("open");
    row.setAttribute("aria-expanded", String(on));
    const kept = (turn.linesOpen ||= new Set());
    if (on) kept.add(i);
    else kept.delete(i);
  };
  const row = h("div", {
    class: `${cls} is-fold${open ? " open" : ""}`, role: "button", tabindex: "0", "aria-expanded": String(open), title: l.title || undefined,
    onclick: () => { if (!String(globalThis.getSelection?.() || "")) flip(); },
    onkeydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      flip();
    },
  }, ic, words, h("span", { class: "own-task-chev", "aria-hidden": "true", html: ICONS.chevronRight }));
  return row;
}

/**
 * What began the turn Filament sent as a background command ended (HarnessV4_Four_Plan E21, FO-D49) — or as the lines a
 * watch caught or the time the agent set came (the owner's word of 10-27), sub-agents' reports reached the chat while
 * no turn ran, or a letter from another chat came (`wakeLetter`) — in the message's place: Filament's words, as a
 * restart's resume has them — no Copy, no Edit. Each thing the agent was told of the commands follows as a line
 * (`wokeLine`), as a coding agent's own turn lists its tasks, a long one folded (`ownLine`).
 * @param {{ wakeExits?: string[], wakeLetter?: boolean, linesOpen?: Set<number> } & DeliveredTurn} turn
 */
export function wokeRow(turn) {
  const exits = Array.isArray(turn?.wakeExits) ? turn.wakeExits : [];
  return h("div", { class: "own-turn" },
    h("div", { class: "boundary-row is-own", title: "What the agent waited on came after the turn above — a background command's end, the lines a watch caught, the time it set to come back, a sub-agent's report, a letter from another chat, or Filament's check-in on a command that ran on while the agent sat idle; Filament told the agent and it went on — no message from you began this turn" },
      h("span", { class: "boundary-label" }, h("span", { class: "boundary-ic", html: ICONS.terminal }), wokeWords(exits, deliveredCounts(turn).messages, turn?.wakeLetter === true))),
    exits.length
      ? h("div", { class: "own-tasks" }, ...exits.map((x, i) => {
          const l = wokeLine(x);
          return ownLine(turn, i, { tone: l.tone, glyph: l.tone === "ok" ? "✓" : "!", words: l.words, title: l.title });
        }))
      : null);
}

/**
 * What began a turn with a sync's message from the project's Space (proposal_ux §4.14), in the message's place: a
 * capsule — the person ran the sync, but the words are Filament's, so no Copy, no Edit — with the message whole under
 * What the agent read, folded.
 * @param {{ syncText?: string }} turn
 */
export function syncRow(turn) {
  const text = String(turn?.syncText || "");
  return h("div", { class: "own-turn is-sync" },
    h("div", { class: "boundary-row is-own is-sync", title: "You ran a sync from the project's Space: Filament added this message to the chat, and the agent went on from it" },
      h("span", { class: "boundary-label" }, h("span", { class: "boundary-ic", html: ICONS.refreshCw }), SYNCED_WORDS)),
    ...(text ? [h("details", { class: "sync-read" }, h("summary", {}, "What the agent read"), h("div", { class: "sync-text" }, text.replace(/^\[Filament: /, "").replace(/\]$/, "")))] : []));
}

/**
 * What began a turn with a team beside's result (team_v2_plan §5.4), in the message's place: a capsule — the person
 * pressed Notify main agent, or switched it on as the team was fired, but the words are Filament's — with the message
 * whole under What the agent read, folded. A flow's end (HarnessV4_Flow_Plan FL-D11) is drawn so too, in its own words,
 * and so is the message that opened the turn a flow started In place (`flowDrive`, HarnessV4_OneAgent_Plan OA4).
 * @param {{ teamText?: string, flowEnd?: boolean, flowDrive?: boolean }} turn
 */
export function teamResultRow(turn) {
  const text = String(turn?.teamText || "");
  const drive = turn?.flowDrive === true;
  const flow = turn?.flowEnd === true || drive;
  const tip = drive
    ? "You started a flow in place: Filament added this message to the chat, and the agent drives the flow in this turn — it hears each box's result as it lands"
    : flow
      ? "A flow you started beside this chat finished, and you had it tell the agent: Filament added this message to the chat, and the agent went on from it"
      : "A team that ran beside this chat finished, and its result was sent to the agent: Filament added this message to the chat, and the agent went on from it";
  return h("div", { class: "own-turn is-sync is-beside" },
    h("div", { class: "boundary-row is-own is-sync", title: tip },
      h("span", { class: "boundary-label" }, h("span", { class: "boundary-ic", html: flow ? ICONS.waypoints : ICONS.users }), drive ? FLOW_DRIVE_WORDS : flow ? FLOW_END_WORDS : TEAM_RESULT_WORDS)),
    ...(text ? [h("details", { class: "sync-read" }, h("summary", {}, "What the agent read"), h("div", { class: "sync-text" }, text))] : []));
}

/**
 * What began a watcher's turn (the plan of 11-11, its w5), in the message's place: a capsule — a watcher that wakes
 * this chat heard what it watches, and Filament sent it with what it gathered; the words are Filament's, so no Copy, no
 * Edit — with the message whole under What the agent read, folded. The capsule says which watcher and what it heard
 * in Filament's own words (`watch.words`, core/watchers.js `wokeParts`), each chat they name a link to it; a turn
 * that keeps none says a watcher woke the chat.
 * @param {{ watchText?: string, watch?: { words?: (string | { chain: string, name: string })[] } | null }} turn
 */
export function watchedRow(turn) {
  const text = String(turn?.watchText || "");
  const words = Array.isArray(turn?.watch?.words) && turn.watch.words.length ? turn.watch.words : null;
  return h("div", { class: "own-turn is-sync is-watched" },
    h("div", { class: "boundary-row is-own is-sync", title: "A watcher that wakes this chat heard what it watches: Filament added this message to the chat with what it heard, and the agent went on from it — no message from you began this turn. Its row in the Space's Watchers pauses it" },
      h("span", { class: "boundary-label" }, h("span", { class: "boundary-ic", html: ICONS.eye }),
        // One run of words, the links among them: the capsule lays its glyph and its words out side by side.
        words ? h("span", { class: "boundary-words" }, ...words.map((p) => (typeof p === "string" ? p : chatLinkEl(p.name, p.chain, { title: `Open ${p.name}` })))) : WATCHED_WORDS)),
    ...(text ? [h("details", { class: "sync-read" }, h("summary", {}, "What the agent read"), h("div", { class: "sync-text" }, text))] : []));
}

/**
 * A watcher of the chat shown, as much of it as a guidance card reads (core/routines.js `chatWatchers`).
 * @typedef {{ id: string, project: string, title: string, state: string, paused: boolean, role: string, chat?: string }} GuideWatcher
 */
/**
 * What a guidance card's presses need of the page, which app.js sets: the watchers of the chat shown as Filament says
 * them now (`watchers`; null before its list is read), each change of that list (`watch`, which returns its stop), and
 * the press the line over the box makes (`press`: Pause and Resume, the watcher's own write). Unset, a card is its
 * words.
 * @type {{ watchers: (() => GuideWatcher[] | null) | null, watch: ((fn: () => void) => () => void) | null,
 *   press: ((line: { press: "pause" | "resume", of: { id: string, project: string } }) => void) | null }}
 */
export const guideHands = { watchers: null, watch: null, press: null };

/**
 * A watcher's guidance on a card (the plan of 11-11, its w8), where it lands — under its turn's capsule, or among a
 * running turn's work as a note: the watcher's title and, quietly, whose it is and how its words weigh; the
 * reviewer's words read as a reply's, a dozen lines' height with Show all where they are more; and at its right Open its
 * chat — the chat whose agent wrote them — and Pause, the write its row's switch on the Watchers page makes: paused,
 * the card says so and offers Resume. Its watcher is read from the chat's list as it stands (`guideHands`), so the
 * card follows a pause made anywhere, its buttons the elements they were; where the list holds no such watcher —
 * removed, or the guidance is known by its words alone — there is nothing of it to press.
 * @param {{ title: string, text: string, chat?: string, state?: { text: string, tip: string } | null,
 *   find: (list: GuideWatcher[]) => GuideWatcher | null, known?: { id: string, project: string, paused: boolean } | null }} o
 *   `chat`: the chat that wrote it, where the guidance says; else its watcher's own (`GuideWatcher.chat`);
 *   `state`: a note's, where it stands in its turn; `find`: its watcher among the chat's; `known`: its watcher as
 *   the guidance itself says it, for a page that holds no list
 */
export function guideCard({ title, text, chat = "", state = null, find, known = null }) {
  // An agent wrote them, lists and code among them: they read as a reply's do, as a thread's brief does (`briefRow`).
  const words = h("div", { class: "guide-text a-md" });
  setHtml(words, mdChat(text || "", null).out);
  const more = h("button", { class: "guide-more hidden", type: "button", "aria-expanded": "false" }, "Show all");
  more.addEventListener("click", () => {
    const open = words.classList.toggle("open");
    more.textContent = open ? "Show less" : "Show all";
    more.setAttribute("aria-expanded", String(open));
  });
  // Show all only where its dozen lines hold less than it has: measured once it is laid out, near the screen.
  whenShown(words, () => { if (words.scrollHeight > words.clientHeight + 2) more.classList.remove("hidden"); });
  const paused = h("span", { class: "guide-paused hidden" }, "Paused");
  const open = h("button", { class: "ghost sm guide-open", type: "button", title: "The chat whose agent wrote this" }, "Open its chat");
  const pause = h("button", { class: "ghost sm guide-pause", type: "button" });
  const card = h("div", { class: "guide-card" },
    h("div", { class: "guide-head" },
      h("div", { class: "guide-who" }, h("span", { class: "guide-title" }, title), h("span", { class: "guide-sub" }, GUIDE_SUB_WORDS)),
      h("div", { class: "guide-acts" }, state ? h("span", { class: "guide-state", title: state.tip }, state.text) : null, paused, open, pause)),
    words, more);
  /** Its watcher now: among the chat's as the page holds them, else as the guidance says it. @returns {(GuideWatcher | { id: string, project: string, paused: boolean, chat?: string }) | null} */
  const watcher = () => {
    const list = guideHands.watchers?.() ?? null;
    return list ? find(list) : known;
  };
  /** The chat its Open opens. */
  const chatOf = () => chat || watcher()?.chat || "";
  open.addEventListener("click", () => { if (chatOf()) void openTaggedChat(chatOf(), open); });
  pause.addEventListener("click", () => {
    const w = watcher();
    if (w) guideHands.press?.({ press: w.paused ? "resume" : "pause", of: { id: w.id, project: w.project } });
  });
  const paint = () => {
    const w = guideHands.press ? watcher() : null;
    const says = WATCH_PRESS[w?.paused ? "resume" : "pause"];
    pause.textContent = says.label;
    pause.setAttribute("title", says.title);
    pause.classList.toggle("hidden", !w);
    paused.classList.toggle("hidden", !w?.paused);
    card.classList.toggle("is-paused", !!w?.paused);
    open.classList.toggle("hidden", !chatOf());
  };
  paint();
  if (guideHands.watch) followWhileDrawn(card, guideHands.watch, paint);
  return card;
}

/**
 * What began a turn with a watcher's guidance (app/watchers/guidance.js), in the message's place: a capsule naming the
 * watcher — one the person let review this chat wrote to it, and Filament passed it on while the chat was at rest —,
 * and under it the reviewer's words on their card (`guideCard`), from the parts Filament says of the guidance
 * (`guide`): never the person's words, so no Copy, no Edit. The message whole, Filament's block with them, stays under
 * What the agent read, folded. Parts that name no watcher (its Space keeps that guidance no more) draw the words
 * alone; a turn with no parts, the capsule over its fold.
 * @param {{ guideText?: string, guide?: { title?: string, text?: string, watcher?: string, project?: string, chat?: string, paused?: boolean } | null }} turn
 */
export function guidedRow(turn) {
  const text = String(turn?.guideText || "");
  const g = turn?.guide || null;
  const of = g?.watcher && g.project ? { id: g.watcher, project: g.project } : null;
  return h("div", { class: "own-turn is-sync is-guided" },
    h("div", { class: "boundary-row is-own is-sync", title: "A watcher you let guide this chat wrote to it: Filament added this message to the chat, and the agent went on from it — no message from you began this turn. Your own words come before a watcher's. Its row in the Space's Watchers pauses it" },
      h("span", { class: "boundary-label" }, h("span", { class: "boundary-ic", html: ICONS.eye }), g ? steerFromWords({ from: "watcher", title: String(g.title || "") }) : GUIDED_WORDS)),
    ...(g
      ? [guideCard({
          title: String(g.title || "A watcher"),
          text: String(g.text || ""),
          chat: String(g.chat || ""),
          find: (list) => (of && list.find((w) => w.id === of.id && w.project === of.project && w.state === "on")) || null,
          known: of ? { ...of, paused: !!g.paused } : null,
        })]
      : []),
    ...(text ? [h("details", { class: "sync-read" }, h("summary", {}, "What the agent read"), h("div", { class: "sync-text" }, text))] : []));
}

/**
 * A thread's first message, its brief (core/threads.js), in the message's place: the words its starter's agent wrote for
 * this chat, as a card of their own across the column, under who wrote them and the way to that chat — never drawn as
 * the person's: Copy, no Rewind. Its words read as a reply's do (an agent writes them, lists and code among them), and
 * a long one clamps as a long message does, its chevron opening it.
 * @param {{ brief?: { from: string | null, title: string, text: string } }} turn
 * @param {{ onCopy: () => void }} cb
 */
export function briefRow(turn, cb) {
  const b = turn?.brief || { from: null, title: "", text: "" };
  const named = b.title || "another chat";
  const text = h("div", { class: "brief-text a-md" });
  setHtml(text, mdChat(b.text || "", null).out);
  const clamp = h("button", {
    class: "u-clamp hidden", type: "button", title: "show the whole brief", "aria-label": "expand the brief",
    html: ICONS.chevronDown,
    onclick: (/** @type {MouseEvent} */ e) => { e.stopPropagation(); text.classList.toggle("open"); },
  });
  return h("div", { class: "u is-brief" },
    h("div", { class: "brief-card", title: BRIEF_TIP },
      h("div", { class: "brief-head" },
        h("span", { class: "brief-ic", html: ICONS.messagesSquare }),
        h("span", { class: "brief-who" }, BRIEF_WORDS),
        b.from ? chatLinkEl(named, b.from) : h("span", { class: "brief-named" }, named)),
      h("div", { class: "brief-wrap" }, text, clamp)),
    h("div", { class: "u-meta" },
      h("div", { class: "u-actions" },
        h("button", { class: "u-act", type: "button", title: "Copy the brief", "aria-label": "Copy the brief", html: ICONS.copy, onclick: cb.onCopy }))));
}

/**
 * What began a team box's turn the flow sent (HarnessV4_Flow_Plan F5), in the message's place: the person pressed Go
 * on, Retry or Send back on its flow's card, but the words are Filament's — no Copy, no Edit; a send-back's message, the
 * gate's answer and the person's line, whole under What the lead read.
 * @param {{ flowSaid?: "on" | "back", flowText?: string }} turn
 */
export function flowSaidRow(turn) {
  const back = turn?.flowSaid === "back";
  const text = String(turn?.flowText || "");
  return h("div", { class: "own-turn is-sync is-beside" },
    h("div", { class: "boundary-row is-own is-sync", title: back ? "The flow's gate did not let this box's step go on, and you sent its part back: Filament added this message, and the lead went on from it" : "You pressed Go on or Retry on this box's flow: Filament added this message, and the lead went on from where it stopped" },
      h("span", { class: "boundary-label" }, h("span", { class: "boundary-ic", html: back ? ICONS.rotateCcw : ICONS.waypoints }), back ? FLOW_BACK_WORDS : FLOW_ON_WORDS)),
    ...(back && text ? [h("details", { class: "sync-read" }, h("summary", {}, "What the lead read: the gate's answer and your line"), h("div", { class: "sync-text" }, text))] : []));
}

/**
 * A turn's files written outside any repository, at its files card's foot (HarnessV4_Four_Plan FO-D27): counted, with
 * the way to Outputs, where they are listed. `alone`: the turn wrote nowhere else — the card's head counts them, the
 * line is the way alone.
 * @param {number} n @param {boolean} alone @param {(() => void) | undefined} onOpen  Outputs opened
 */
export function outsideLine(n, alone, onOpen) {
  return h("div", { class: "file-outside" },
    alone ? null : h("span", {}, outsideGitWords(n, false)),
    onOpen
      ? h("button", { class: "file-outputs", type: "button", onclick: (/** @type {MouseEvent} */ e) => { e.preventDefault(); e.stopPropagation(); onOpen(); } }, "Show in Outputs")
      : h("span", {}, "listed in Outputs"));
}

/** How a background task ended, as its line's tone: the sub-agent marks' tones (subagent-marks.js). */
const TASK_TONES = Object.freeze({ completed: "ok", failed: "error", stopped: "warn" });

/**
 * What began a turn its coding agent took by itself (HarnessV3-ACP AC3-9), in the message's place: nothing the
 * developer sent — the agent went on, most often for a background task of its own that ended. A capsule on the
 * hairline names the agent and why; each task's end follows as one line, its glyph in the task's tone, a long one folded
 * (`ownLine`). No Copy, no Edit: the words that began the turn are Filament's.
 * @param {{ own: { agent: string, tasks?: { status?: string, summary?: string }[] }, linesOpen?: Set<number> }} turn
 */
export function ownRow(turn) {
  const { agent, tasks = [] } = turn.own;
  const why = tasks.length > 1 ? `${tasks.length} background tasks ended` : tasks.length ? "a background task ended" : "";
  return h("div", { class: "own-turn" },
    h("div", { class: "boundary-row is-own", title: `${agent} went on by itself — no message from you began this turn` },
      h("span", { class: "boundary-label" }, h("span", { class: "boundary-ic", html: ICONS.bot }), why ? `${agent} · ${why}` : `${agent} went on by itself`)),
    tasks.length
      ? h("div", { class: "own-tasks" }, ...tasks.map((t, i) => {
          const tone = TASK_TONES[/** @type {keyof typeof TASK_TONES} */ (String(t.status))] || "";
          return ownLine(turn, i, { tone, glyph: tone === "ok" ? "✓" : tone ? "!" : "•", words: t.summary || `The task ${t.status || "ended"}, with no summary`, title: t.status ? `The task ${t.status}` : "" });
        }))
      : null);
}

/**
 * A run's work in figures, from its aligned events: the rounds that called tools (tool legs) and the calls.
 * @param {{ byRound: Map<number, { tools: Map<string, any> }> }} aligned
 */
export function tallyOf(aligned) {
  let legs = 0, calls = 0;
  for (const c of aligned?.byRound?.values?.() || []) if (c.tools?.size) { legs++; calls += c.tools.size; }
  return { legs, calls };
}

/**
 * A run's work in figures for the rounds after `from` up to `to`: the work after a coding agent's own compaction, to
 * the next (`afterFold`). @param {{ byRound: Map<number, { tools: Map<string, any> }> }} aligned @param {number} from
 * @param {number} [to]
 */
export function tallyBetween(aligned, from, to = Infinity) {
  let legs = 0, calls = 0;
  for (const [r, c] of aligned?.byRound?.entries?.() || []) if (r > from && r <= to && c.tools?.size) { legs++; calls += c.tools.size; }
  return { legs, calls };
}

/**
 * A tally in the fold header's words: " · 7 tool calls", or nothing — the rounds they came in (the session truth's
 * tool legs) on hover, in plain words (the Designer's review of 10-24: "tool leg" is the builder's word).
 * @param {{ legs: number, calls: number } | null} t
 */
const tallyWords = (t) => (t && t.calls ? ` · ${t.calls} tool call${t.calls === 1 ? "" : "s"}` : "");
/** @param {{ legs: number, calls: number } | null} t */
const tallyTitle = (t) =>
  t && t.calls ? `${t.calls} tool call${t.calls === 1 ? "" : "s"} in ${t.legs} step${t.legs === 1 ? "" : "s"}: a step is one go of the agent's — it calls one or more tools, then reads what they answer` : "";

/**
 * The fold header (The work so far → Worked for … / Stopped after … → Worked; `foldWords`). Open while running; the timeline
 * auto-collapses it 300ms after the run ends unless the developer opened it by hand. While the turn runs, what the
 * loop is doing rides beside the timer ("· running 3 tool calls", from its turn-state events — `setState`). While the
 * turn waits on what it can be sent without — the summary Filament writes before its request, memory's recall or its
 * capture (`setSkip`, by the turn's phase) — `onSkip` is a button beside them: Send without it (the filament-agent
 * plan's D6), its tooltip saying what it lets go (`skipWaitWords`).
 * @param {any} turn @param {{ onSkip?: (() => void) | null }} [o]
 * @returns {{ el: HTMLElement, body: HTMLElement, setState: (words: string) => void, setSkip: (phase: any) => void, recount: () => void, part: (p: { words: string, tally: { legs: number, calls: number } | null, stopped?: boolean } | null) => void }}
 */
export function workFold(turn, { onSkip = null } = {}) {
  const live = turn.status === "streaming" || turn.status === "paused";
  const started = turn.startedAt || Date.now();
  turn.startedAt = started;
  const stateEl = h("span", { class: "work-state muted" });
  // What the turn does now shimmers, as a running call's verb does (AC1-6).
  /** @param {string} words */
  const setState = (words) => {
    stateEl.textContent = live && words ? ` · ${words}` : "";
    stateEl.classList.toggle("gradient", live && !!words);
  };
  // Inside the header: its click must not open or close the fold.
  const skipBtn = live && onSkip
    ? /** @type {HTMLButtonElement} */ (h("button", {
        class: "work-skip hidden", type: "button",
        title: skipWaitWords(turn.phase),
        onclick: (/** @type {MouseEvent} */ e) => {
          e.preventDefault();
          e.stopPropagation();
          /** @type {HTMLButtonElement} */ (e.currentTarget).disabled = true;
          onSkip();
        },
      }, "Send without it"))
    : null;
  /** @param {any} phase  the turn's phase: shown while it can be sent without (`skippable`) */
  const setSkip = (phase) => {
    if (!skipBtn) return;
    const on = !!phase?.skippable;
    skipBtn.classList.toggle("hidden", !on);
    if (on) skipBtn.title = skipWaitWords(phase);
    else skipBtn.disabled = false;
  };
  // A fold redrawn while the turn compacts before its request (decision 1 of the codebase pass) keeps saying so; one
  // redrawn mid-run says what the run does now.
  setState(turnPhaseWords(turn.phase) || (turn.aligned ? liveWords(turn.aligned, turn.engine?.kind === "team") : ""));
  setSkip(turn.phase);
  /** @type {HTMLElement} */
  let label;
  let labelTitle = "";
  // While it runs, the live line under the turn says "Working" and keeps its clock, alone (the Designer's review of
  // 10-24: four "Working"s, their clocks a second apart); the header names the work.
  /** The whole turn's words, settled: what the fold says again once its work is no longer split. */
  let whole = "";
  if (live) {
    label = h("span", { class: "timer" }, "The work so far");
  } else {
    const w = foldWords(turn);
    whole = w.text;
    label = h("span", { class: "work-words" }, whole);
    labelTitle = w.title;
  }
  const body = h("div", { class: "work-body" });
  // The work counted as the session truth counts it: tool legs (rounds of the tool loop) and tool calls — an archived
  // turn's from the archive, a turn that just ran here from its run's events. An archived turn the archive never
  // counted is counted once its work is read (`recount`). A fold that holds one part of the work counts that part.
  const counts = h("span", { class: "work-counts muted" });
  /** @type {{ words: string, tally: { legs: number, calls: number } | null, stopped?: boolean } | null} */
  let held = null;
  const recount = () => {
    const tally = held ? held.tally : turn.history ? (typeof turn.toolLegs === "number" ? { legs: turn.toolLegs, calls: Number(turn.toolCalls) || 0 } : null)
      : !live && turn.aligned ? tallyOf(turn.aligned) : null;
    counts.textContent = tallyWords(tally);
    counts.title = tallyTitle(tally);
  };
  recount();
  // The counts ride inside the label so one ordinary space separates them, not the row's gap.
  const labelEl = h("span", { class: "work-label", ...(labelTitle ? { title: labelTitle } : {}) }, label, live ? stateEl : null, counts);
  const summary = h("summary", {},
    labelEl,
    skipBtn,
    h("span", { class: "work-chev", html: ICONS.chevronRight }));
  summary.addEventListener("click", (e) => {
    // A bare header (a stopped turn that did no work, LD-D7) has nothing to open.
    if (det.classList.contains("bare")) return e.preventDefault();
    // Held the way the developer leaves it, open or closed: the click comes before the fold toggles.
    turn.foldHeld = true;
    turn.foldOpen = !det.open;
  });
  const det = h("details", { class: "work-fold" }, summary, body);
  // Drawn again, a turn that just ended keeps its fold open until the chat's next turn starts (foldLeftOpen).
  if (turn.foldOpen ?? (live || turn.foldHeld || turn.foldLeftOpen)) det.open = true;
  /**
   * The settled fold holds the turn's work up to where it was split — a reply the agent ended on, or its own compaction
   * (timeline placeParts): it says that part, its time and its calls — who stopped the turn only where the stop ended
   * this part (`stopped`); null, the whole turn again.
   * @param {{ words: string, tally: { legs: number, calls: number } | null, stopped?: boolean } | null} p
   */
  const part = (p) => {
    // Every layout asks: a fold that says the same is left as it stands.
    if (live || (!p && !held) || (p && held && p.words === held.words && p.stopped === held.stopped && JSON.stringify(p.tally) === JSON.stringify(held.tally))) return;
    held = p;
    label.textContent = p ? p.words : whole;
    if (labelTitle) labelEl.title = !p || p.stopped ? labelTitle : "";
    recount();
  };
  return { el: det, body, setState, setSkip, recount, part };
}

/**
 * The work a settled turn did after its coding agent compacted its own context, folded under the line that says so (the
 * owner's words of 10-18: "it should sit where it happened"): "The work after it", counted as the turn's fold counts
 * (`count`, the rounds after the line) — or after a reply the agent ended its turn on before Filament woke it (the
 * owner's of 11-05, `after` "reply"), or after a message the person sent that the agent read as it worked (`after`
 * "message"); in a turn a reply or a message splits, in the words `count` is given: "Worked for 3m 10s". Open as
 * the turn's fold is when it is made, and
 * closed with it. A click on its header holds the turn's folds as the developer leaves them, as one on the turn's does.
 * Its segments go in `a`.
 * @param {any} turn @param {boolean} open
 * @returns {{ el: HTMLDetailsElement, a: HTMLElement, count: (tally: { legs: number, calls: number } | null, said?: string | null, after?: "reply" | "message" | null) => void }}
 */
export function afterFold(turn, open) {
  const counts = h("span", { class: "work-counts muted" });
  const words = h("span", { class: "work-words" }, "The work after it");
  const summary = h("summary", {},
    h("span", { class: "work-label" }, words, counts),
    h("span", { class: "work-chev", html: ICONS.chevronRight }));
  summary.addEventListener("click", () => {
    turn.foldHeld = true;
  });
  const a = h("div", { class: "a" });
  const det = /** @type {HTMLDetailsElement} */ (h("details", { class: "work-fold is-after" }, summary, h("div", { class: "work-body" }, a)));
  if (open) det.open = true;
  return {
    el: det,
    a,
    count: (tally, said = null, after = null) => {
      words.textContent = said || "The work after it";
      counts.textContent = tallyWords(tally);
      counts.title = tallyTitle(tally) && `${after === "reply" ? "After its reply" : after === "message" ? "After the message" : "After the compaction"}: ${tallyTitle(tally)}`;
    },
  };
}

/** The files a tree card lists; it counts the rest. */
export const TREE_ROWS = 200;

/**
 * What this turn changed, as a card: one collapsed line — "N files changed +A −R" — that opens into the
 * file rows. `turn.tree` is the changes route's answer (`/api/memory/sessions/:id/changes`): the turn's agents' own
 * files — the ones their write and edit calls named, in every place they wrote in — each net over the turn, read from
 * the session's git snapshots (HarnessV4_Git_Plan step 1). A file in a place other than the chat's folder says which;
 * one someone else changed too is marked. What was written outside any repository is counted at the foot, with the
 * way to Outputs, where it is listed (HarnessV4_Four_Plan FO-D27); a turn that wrote only there says so in the head.
 * What changed while a command ran is a line apart, not counted as the turn's — except in a folder only this chat
 * works in: there it is the turn's own, marked "via a command" (GW-D57). Absent when nothing was written, or memory or
 * `agentLoop.treeSnapshots` is off — the card simply does not appear. The page reads its first TREE_ROWS files with
 * the counts (`counts`, the route's `?first=`); a host that answers whole is counted here.
 * @param {any} turn @param {{ onOutputs?: () => void }} [o]  `onOutputs`: Outputs opened
 */
export function treeCard(turn, { onOutputs } = {}) {
  const t = turn.tree;
  const totals = t?.totals || {};
  const counts = t?.counts || null;
  const outside = counts ? Number(counts.outside) || 0 : new Set((t?.outside || []).map((/** @type {any} */ o) => String(o.path))).size;
  const count = Number(totals.files) || 0;
  if (!count && !outside) return null;
  const files = [...(t.files || [])].sort((a, b) => String(a.place || "").localeCompare(String(b.place || "")) || String(a.path).localeCompare(String(b.path)));
  const rows = files.slice(0, TREE_ROWS).map((f) => {
    const where = f.place && t.folder && f.place !== t.folder ? `in ${placeName(f.place)}` : "";
    return h("div", { class: "tree-file" },
      h("span", { class: `tree-status st-${f.status}`, title: f.status, "aria-label": `${f.status} ${f.path}` }, f.status ? f.status[0].toUpperCase() : "?"),
      f.oldPath ? h("span", { class: "tree-path", title: `${f.oldPath} → ${f.path}` }, `${f.oldPath} → ${f.path}`) : h("span", { class: "tree-path", title: where ? `${f.place}/${f.path}` : f.path }, f.path),
      where ? h("span", { class: "tree-place muted" }, where) : null,
      f.also ? h("span", { class: "tree-also muted", title: "someone else changed this file too while the turn ran: its diff holds both" }, "also changed by someone else") : null,
      f.via === "command"
        ? h("span", { class: "tree-via muted", title: "its commands changed this file, not its edit calls; only this chat works in this folder, so it counts as its own" }, "via a command")
        : null,
      h("span", { class: "tree-counts" },
        f.binary ? h("span", { class: "muted" }, "binary") : [
          h("span", { class: "tree-add" }, `+${fmt.n(f.added || 0)}`),
          h("span", { class: "tree-del" }, `−${fmt.n(f.removed || 0)}`),
        ]));
  });
  const more = count > rows.length ? h("div", { class: "tree-more muted" }, `… ${fmt.n(count - rows.length)} more files`) : null;
  const during = counts ? Number(counts.during) || 0 : new Set((t.during || []).map((/** @type {any} */ d) => `${d.place}\n${d.path}`)).size;
  const ran = (counts ? !!counts.ran : files.some((f) => f.via === "command")) ? ", and what their commands changed where only this chat works" : "";
  return h("details", { class: "tree-card" },
    h("summary", {
      title: "the files this turn's agents wrote and edited, each net over the turn — the per-call cards inside the work fold count tool calls only",
    },
      count
        ? h("span", { class: "tree-sum" },
          `${fmt.n(count)} file${count === 1 ? "" : "s"} changed`,
          h("span", { class: "tree-add" }, ` +${fmt.n(totals.added || 0)}`),
          h("span", { class: "tree-del" }, ` −${fmt.n(totals.removed || 0)}`))
        : h("span", { class: "tree-sum" }, outsideGitWords(outside, true)),
      h("span", { class: "work-chev", html: ICONS.chevronRight })),
    h("div", { class: "tree-files" }, ...rows, more, outside ? outsideLine(outside, !count, onOutputs) : null),
    during ? h("div", { class: "tree-note muted" }, `${fmt.n(during)} more changed while its commands ran — by them or by someone else`) : null,
    h("div", { class: "tree-note muted" }, `the files this turn's agents wrote and edited${ran}, each net over the turn — what someone else changed meanwhile is not the turn's`));
}

/**
 * A turn's fact segments, factsLine's shape: the server's facts once the turn has them (Facade D3 — the page never
 * recomputes them); before they land, the reply's own usage and the record stand in, as they always have.
 * @param {any} turn
 * @returns {{ id: string, text: string, title: string, tone: string }[]}
 */
function factSegments(turn) {
  if (turn.facts) return factsLine(turn.facts);
  const u = turn.reply?.usage || {};
  const rec = turn.rec;
  const sent = rec?.tokens?.input ?? u.input_tokens ?? null;
  const cacheRead = u.cache_read_input_tokens ?? rec?.tokens?.cacheRead ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? rec?.tokens?.cacheWrite ?? 0;
  // Whether the turn's usage said its cache numbers (lib/cache-facts.js): its record's word, else the reply's figures.
  const said = rec?.tokens ? cacheSaid(rec.tokens) : Number(cacheRead) > 0 || Number(cacheWrite) > 0;
  // An agent turn's cost is what its children spent; the shell record's own cost is one round (§9.3.4). Its list
  // figure is its rounds' too (Providers P4); a plan's turn paid $0, and says what it was worth.
  const cost = rec?.agent?.spentUsd ?? rec?.cost;
  const list = rec?.agent?.spentUsd != null ? rec.agent.listUsd : rec?.listCost;
  const w = costWords(cost ?? null, list ?? null);
  return [
    sent != null ? { id: "sent", text: `sent ${fmt.n(sent)}`, title: said ? `${fmt.n(sent)} fresh tokens went out; ${fmt.n(cacheRead)} read from the provider's cache, ${fmt.n(cacheWrite)} written to it` : `${fmt.n(sent)} fresh tokens went out; this turn's usage gave no cache numbers`, tone: "" } : null,
    cost || typeof list === "number" ? { id: "cost", text: w.text, title: w.title === "paid at list price" ? "what this turn cost" : w.title, tone: "" } : null,
  ].filter((s) => s !== null);
}

/**
 * The footer under a finished reply (its action row): Copy, Fork, Retry and Details with the time and the
 * short facts, shown while the pointer is on the turn — the latest turn keeps it. What must never hide stays in a
 * status line above it: a cut or failed reply, a window that did not fit, a stop, the waiting queue's ways out.
 * `asked`: the turn was stopped to ask before its message was sent (interaction.js's card), which is no failure — the
 * flag's words, what the message waits for (`askFlag`). A turn its watchers read has their chip at the row's far end,
 * beside the actions and never among them, so it shows with no pointer on the turn (`reviewedChip`).
 * @param {any} turn
 * @param {{ onCopy: () => void, onFork: () => void, onRetry: () => void, onWatchRun: () => void, onExplain?: () => void, onReviewed?: () => void }} cb
 *   `onReviewed`: a guided Reviewed chip's press
 * @param {string | false} [asked]
 */
export function footerEl(turn, cb, asked = false) {
  const segments = factSegments(turn);
  const { meta, warn } = footerFacts(segments);
  const changes = turn.facts?.changes || turn.rec?.changes || [];
  const running = turn.status === "streaming";
  const when = messageTimeLabel(turn.endedAt || turn.startedAt);
  const explain = turn.requestId && cb.onExplain ? cb.onExplain : null;
  // The shape this turn takes in later requests (HarnessV2 §6.6): the one a compaction left it in, or the fork it came with.
  const shape = turn.history && turn.shape && turn.shape !== "raw" ? { text: `${turn.shape === "fold" ? "folded" : turn.shape} by a compaction` } : null;
  const act = (title, iconName, onclick, disabled = false, kind = "") =>
    h("button", { class: kind ? `a-act ${kind}` : "a-act", type: "button", title, "aria-label": title, html: ICONS[iconName], onclick, ...(disabled ? { disabled: "" } : {}) });

  const details = segments.length || changes.length || shape || explain || turn.runId
    ? act("Details — the turn's numbers and what Filament did", "info", () => {
        const items = [
          { type: "node", node: detailsCard(segments, shape) },
          ...(changes.length ? [
            { type: "separator" },
            { type: "label", label: `What Filament did${turn.facts?.changesMore ? ` (+${turn.facts.changesMore} more)` : ""}` },
            { type: "node", node: h("ul", { class: "turn-changes" }, ...changes.map((c) => h("li", {}, c))) },
          ] : []),
          ...(explain || turn.runId ? [{ type: "separator" }] : []),
          ...(explain ? [{ label: "Explain this request", icon: "scrollText", desc: "How it was composed: shapes, memory, the settings in force", onClick: explain }] : []),
          ...(turn.runId ? [{ label: "Watch the run", icon: "eye", onClick: cb.onWatchRun }] : []),
        ];
        menu(items, { anchor: details, side: "top", align: "start", width: 320 });
      })
    : null;

  // A message that waits for the chat (app.js `armWaiting`) is on no record yet: it sends itself, or is cancelled — never
  // sent again beside its own queue, nor forked from. One withdrawn, or stopped to ask, is on none either (history.js
  // `unsent`): no Fork, and Retry sends it after all. None has a reply to copy. A turn that failed has no answer to fork at (`forkable`); one
  // running is forked once it ends.
  const waiting = turn.status === "waiting";
  const actions = h("div", { class: "a-actions" },
    unsent(turn) ? null : act("Copy", "copy", cb.onCopy),
    // Fork and Retry each write: a view-only device's page hides them (harness.css `.view-only`).
    unsent(turn) || !(running || forkable(turn)) ? null : act(running ? "Fork after the turn finishes" : "Fork from here", "trending", cb.onFork, running, "a-fork"),
    // A turn its agent began by itself (HarnessV3-ACP AC3-9) has no text of the developer's to send again; nor has a
    // thread's brief, its starter's agent's words: one whose turn failed goes again from the failure's own Retry. Nor
    // has a watcher's wake, which goes again so too, nor the first message of a chat Filament made for it, which
    // never does (r-doors, 11-12: this Retry sent each as the person's message).
    turn.watched || turn.opening || turn.own || turn.brief || waiting ? null : act("Retry — sends the same text as a new turn; the earlier reply stays", "rotateCcw", cb.onRetry, false, "a-retry"),
    details,
    when || meta.length
      ? h("span", { class: "a-meta" }, ...[when ? h("span", {}, when) : null, engineTag(turn.engine), ...meta.map((s) => h("span", { title: s.title }, s.text))].filter(Boolean))
      : null);

  // A stop is said once, in the fold's header ("Stopped after 9s", live and after a reload, who in its title —
  // HarnessV3-FixRound item 11): the footer adds no "Stopped by you" or "Stopped from the harness".
  const stop = turn.status === "stopped" || turn.stopped ? "" : stopReasonText(turn.reply?.stopReason);
  // A failure is said once: its words in the banner above, and here a flag that says "failed" (its words on hover) —
  // the facts' "an error occurred" would say it again. A turn stopped to ask failed at nothing: its flag says, in the
  // card's teal, what the message waits for (HarnessV4_Tasks U11; a yellow "not sent" read as a failure).
  const failed = turn.status === "error";
  const status = [
    ...warn.filter((s) => !(failed && s.id === "errors")).map((s) => h("span", { class: `a-flag ${s.tone}`, title: s.title }, s.text)),
    // The cut words only while facts are absent — factsLine carries the cut as its own warning segment once the
    // facts exist (one warning, one place).
    stop && !turn.facts && /cut|incomplete|stopped/.test(stop)
      ? h("span", { class: "a-flag warn" }, /cut|incomplete/.test(stop) ? `✂ ${stop}` : stop) : null,
    failed ? h("span", { class: `a-flag ${asked ? "ask" : "err"}`, title: asked ? "Nothing was sent yet: the card above says why" : turn.error || undefined }, asked || "failed") : null,
    // Its question was left unanswered: the person went on with a coding agent instead — said once, here.
    turn.unanswered ? h("span", { class: "a-flag", title: `You went on with ${turn.unanswered.by || "a coding agent"} instead of answering it` }, "question left unanswered") : null,
    // The harness queue (Step 3 D14): a send that waits for a running turn, its Cancel, and — where the turn is a coding
    // agent's own (app.js `armWaiting`) — Stop it and go first.
    turn.status === "waiting" ? h("span", { class: "a-flag warn a-waiting" }, turn.waitingText || "Waiting — the chat is busy") : null,
    turn.status === "waiting" && turn.cancelWait ? h("button", { class: "ghost sm", type: "button", onclick: turn.cancelWait }, "Cancel") : null,
    turn.status === "waiting" && turn.stopIt ? h("button", { class: "ghost sm", type: "button", title: "Stop the agent's own turn; this message sends itself when it ends", onclick: turn.stopIt }, "Stop it and go first") : null,
  ].filter(Boolean);
  return h("div", { class: "a-foot" }, status.length ? h("div", { class: "a-status" }, ...status) : null, h("div", { class: "a-row" }, actions, reviewedChip(turn, cb.onReviewed)));
}

/**
 * A turn's Reviewed chip (the plan of 11-11, its w8), at the far end of its footer's row: an eye and "Reviewed" where a watcher
 * read the turn and sent nothing, in the watcher's teal with "guided" where one wrote the chat guidance, counted where
 * several read it; on hover, who read it, when and what came of it, in Filament's words (`reviewedWords`). A press
 * on a guided one is the page's (`onPress`), which goes to the guidance; a plain one has its tip alone.
 * `had`: the chip that stands in the footer, said anew in place — reviews land after their turn ended, and its
 * footer is not drawn again for them. → the chip, or null for a turn no watcher read.
 * @param {{ reviews?: { guided: boolean, words: string }[] }} turn @param {(() => void) | undefined} onPress
 * @param {HTMLElement | null} [had]
 * @returns {HTMLElement | null}
 */
export function reviewedChip(turn, onPress, had = null) {
  const reviews = Array.isArray(turn?.reviews) ? turn.reviews : [];
  if (!reviews.length) return null;
  const w = reviewedWords(reviews);
  const chip = had || h("button", { class: "a-reviewed", type: "button", onclick: () => { if (chip.classList.contains("is-guided")) onPress?.(); } },
    h("span", { class: "a-reviewed-ic", html: ICONS.eye, "aria-hidden": "true" }), h("span", { class: "a-reviewed-words" }));
  chip.classList.toggle("is-guided", w.guided);
  chip.setAttribute("title", w.tip);
  const words = chip.querySelector(".a-reviewed-words");
  if (words) words.textContent = w.text;
  return chip;
}

/**
 * The details card's rows: factsLine's segments named by their id — the card labels them, it never formats a fact —
 * and the shape later requests see. Each row's title keeps the segment's full sentence.
 * @param {{ id: string, text: string, title: string, tone: string }[]} segments @param {{ text: string } | null} shape
 */
function detailsCard(segments, shape) {
  const rows = segments.map((s) => {
    const label = FACT_LABELS[s.id] || s.id;
    // The row's label already says what the inline segment's first word says ("sent 300" under "Sent").
    const lead = `${label.toLowerCase()} `;
    const value = s.text.toLowerCase().startsWith(lead) ? s.text.slice(lead.length) : s.text;
    return h("div", { class: `turn-fact${s.tone ? ` ${s.tone}` : ""}`, title: s.title },
      h("span", { class: "turn-fact-k" }, label),
      h("span", { class: "turn-fact-v" }, value));
  });
  if (shape) rows.push(h("div", { class: "turn-fact", title: "the shape this turn takes in later requests" },
    h("span", { class: "turn-fact-k" }, "Later requests"),
    h("span", { class: "turn-fact-v" }, shape.text)));
  return h("div", { class: "turn-facts" }, ...(rows.length ? rows : [h("div", { class: "turn-fact muted" }, "No numbers were recorded for this turn.")]));
}

/**
 * The shim's own last block: a subtlest paragraph prefixed by the mark, never model prose — in the warning's colour
 * where it says something the person must not miss (`warn`).
 * @param {string} text @param {{ warn?: boolean }} [o]
 */
export function shimNote(text, { warn = false } = {}) {
  return h("p", { class: warn ? "shim-note is-warn" : "shim-note" }, h("span", { class: "shim-mark" }, "Filament"), text);
}

/**
 * Filament's own answer to a chat command (`@mem`, `/compact`, `/help` …): marked as Filament's, the text kept whole.
 * With a card the page can draw (Facade D4), the card is painted instead of the text; a kind the page doesn't
 * know (or a card that never arrived) leaves the text — no flash of text that turns into a card. `by` names who
 * answered where that was not Filament: a coding agent's own command in a chat read from its files.
 * @param {string} text @param {any} card @param {{ onCommand?: (command: string) => void, onInspector?: () => void }} [cb]
 * @param {{ h?: any, by?: string | null }} [io]
 */
export function commandAnswer(text, card = null, cb = {}, io = {}) {
  const mk = io.h || h;
  const drawn = cardEl(card, cb, io);
  const body = drawn || (() => {
    const el = mk("div", { class: "shim-answer-text a-md" });
    setHtml(el, mdChat(String(text || ""), null).out);
    return el;
  })();
  return mk("div", { class: "shim-answer" }, mk("div", { class: "shim-mark" }, `${io.by || "Filament"} answered this — no model was called`), body);
}
