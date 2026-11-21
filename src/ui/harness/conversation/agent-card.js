// @ts-check
// A saved agent's answer as one card in the chat (HarnessV4_Tasks E15): the question and the answer together, at the
// place it was asked. Two cards share one frame, and their first words say who asked.
//
// An agent you asked (step 2, AG-21): the session keeps two marks of it — sent off with the question, back with the
// answer and its figures (AG-19) — and the card is drawn at the first, taking the answer from the second, so it reads
// the same after a reload and after Filament restarts. Ask again, Send to main agent, Copy.
//
// An agent the main agent asked by itself (step 3, AG-46): the card is that call's row on the turn, drawn from the
// run's events. The answer is the main agent's already, so there is nothing to send on: Overrule prepares your next
// message to the main agent (AG-47), and the card then says what you overruled it with.
//
// An agent that started by itself (step 7, AG-195; a chat's from before the owner's word of 11-05 took those agents
// away): the same two marks as one you asked, with why it started where the question would stand. Nobody asked, so the
// card is one line under the report — "Explainer, by itself" and its
// answer's first line — and what it started on shows when it is opened. Its answer is yours as any other: Apply,
// Send to main agent, Copy.
//
// While the agent works either card follows the page's list of the session's agents: who, on which model, one live
// line, Stop. Done, it folds to the answer's first line with the model, tokens, cost and time; opened, the answer whole.
// Folded, a card is that one line in its agent's colour, swept by the colour while the agent works, the question its
// tooltip (the owner's words of 10-24: "collapsed into single colored line, that keeps shimmering as long as the side
// agent is running"); once the agent ended its Hide takes the card off the chat and counts its answer seen, and the
// chat menu brings it back (HarnessV4_Tasks_Logs E37). Hide, in words, where it was a ×: a close read as if it deleted
// the agent's work (the owner's of 11-01).
//
// A card paints its own parts (`data-self`): its buttons are drawn again in place at each paint, never made anew under
// a resting pointer (the owner's of 11-01: "buttons … start blinking … sometimes the clicks even don't pass through"),
// and the card of a call drawn again is the one that stands, painted from what the call says now (`askedCardAgain`).
import { h, morphChildren, setHtml } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { ICONS } from "../lib/icons.js";
import { prettyModel } from "../lib/families.js";
import { seatWords } from "../lib/pool.js";
import { callNamedIn, formatWorkedFor } from "../lib/labels.js";
import { attachedNames, attachedWords, cardTone, handedWords } from "../lib/agent-cards.js";
import { answeredOther, cardCut } from "../lib/subagents.js";
import { mdChat } from "../lib/md-stream.js";
import { chipActions } from "./tools/layout.js";
import { visualCard } from "./visual.js";
import { waitsWords } from "../lib/apply-words.js";

/** How an exchange that did not finish is said after the agent's name. @type {Readonly<Record<string, string>>} */
const ENDED_WORDS = Object.freeze({ failed: "failed", stopped: "was stopped", aborted: "was cut off", "budget-stopped": "stopped at a budget" });
/** For this long after a question was sent, a card whose agent the page's list does not hold yet is starting, not lost. */
const STARTING_MS = 15_000;

/** An answer's first line, as plain words: the markdown's marks dropped. @param {string} text */
export function firstLine(text) {
  const line = String(text || "").split("\n").map((l) => l.trim()).find((l) => l && !/^(```|---+$|\*\*\*+$)/.test(l)) || "";
  return line.replace(/^(#{1,6}|>|[-*+]|\d+[.)])\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/`([^`]+)`/g, "$1");
}

/**
 * What a running agent is doing, in a line: a worker's question to its lead is its lead's (HarnessV3-TaskGraph-v2
 * TG2-D49), and so is its plan (TG2-D50). @param {import("../lib/subagents.js").SubagentProgress | null | undefined} p
 */
export function liveLine(p) {
  if (p?.asking?.to === "lead") return `${p.asking.plan ? "Sent its lead its plan" : "Asks its lead"}: ${p.asking.question}`;
  if (p?.asking) return `Waits for your answer: ${p.asking.question || p.asking.tool}`;
  if (p?.tool) return `${p.tool.name}${p.tool.args ? ` ${p.tool.args}` : ""}`;
  const said = String(p?.words || "").trim().split("\n").filter(Boolean).at(-1);
  return said || "Thinking…";
}

/**
 * How a card stands. `whole`: `text` is the answer whole, not a clipped copy; `lost`: why no end is known.
 * @typedef {{ phase: "running" | "done" | "failed" | "lost", status: string, text: string, whole: boolean, live: string, model: string,
 *   seat: { from: string, skipped: string[] } | null, tokens: number, usd: number, ms: number, error: string, lost: string, other?: string }} CardState
 *   `seat`: where its model came from, where the session's pool chose it (lib/pool.js `seatWords`); `other`: what
 *   answered where that was another model than the one it was launched on (lib/subagents.js `answeredOther`)
 */
/** @type {CardState} */
const RUNNING = Object.freeze({ phase: "running", status: "running", text: "", whole: true, live: "", model: "", seat: null, tokens: 0, usd: 0, ms: 0, error: "", lost: "" });
/**
 * What a card says of where its agent's model came from (HarnessV4_Tasks E15 step 8): the rows its launch passed
 * are said on its first exchange's card, once.
 * @param {import("../lib/subagents.js").SubagentRow | null} row @param {unknown} exchange
 */
const seatOf = (row, exchange) => {
  const w = seatWords(row?.seat);
  return w && Number(exchange) ? { ...w, skipped: [] } : w;
};
/** @param {string} status */
const phaseOf = (status) => /** @type {"done" | "failed"} */ (status === "done" ? "done" : "failed");

/**
 * How the card of an agent you asked stands now, from what the chat holds of it and what the page's list says.
 * @param {any} asked  the mark it was sent off with (or, where the chat holds only the answer's, that one)
 * @param {any | null} answer  the mark it came back with
 * @param {{ row: import("../lib/subagents.js").SubagentRow | null, known: boolean, now: number,
 *   card?: ((id: string, exchange: number) => import("../lib/subagents.js").SubagentExchange | null | undefined) | null }} at
 *   `card`: an answer the list carries as a head, in its agent's cards' form (the store's `card`)
 * @returns {CardState}
 */
export function cardState(asked, answer, { row, known, now, card = null }) {
  const x = row?.exchanges?.[Number(asked.exchange) || 0] || null;
  const other = answeredOther(row, Number(asked.exchange) || 0);
  const base = { ...RUNNING, model: String(answer?.model || asked.model || row?.model || ""), seat: seatOf(row, asked.exchange), ...(other ? { other } : {}) };
  if (answer) {
    const status = String(answer.status || "done");
    return { ...base, phase: phaseOf(status), status, text: String(answer.answer || ""), tokens: (Number(answer.tokensIn) || 0) + (Number(answer.tokensOut) || 0), usd: Number(answer.spentUsd) || 0, ms: Number(answer.ms) || 0, error: String(answer.error || "") };
  }
  // The list's own word of the end: its report is clipped there, so the whole answer is asked for when opened. Its
  // status says it ended; its time may not be known — one a restart cut before it ended has none, and stood "running".
  // Where the list carries it as a head, its cards' form stands in its place once read: the folded line is its first.
  if (x && x.status !== "running") {
    const form = x.reportHead && card && row ? card(row.id, Number(asked.exchange) || 0) : null;
    return { ...base, phase: phaseOf(x.status), status: x.status, text: form ? cardCut(String(form.report ?? x.report ?? "")) : String(x.report || ""), whole: false, tokens: (Number(x.tokensIn) || 0) + (Number(x.tokensOut) || 0), usd: Number(x.spentUsd) || 0, ms: Number(x.ms) || (x.endedAt != null ? Math.max(0, x.endedAt - x.startedAt) : 0), error: String(x.error || "") };
  }
  if (x || row?.status === "running") return { ...base, live: liveLine(row?.progress) };
  const sentAt = Number(asked.at) || 0;
  if (!known || (sentAt && now - sentAt < STARTING_MS)) return { ...base, live: "Starting…" };
  return { ...base, phase: "lost", status: "lost", lost: "did not finish: Filament restarted while it worked" };
}

/**
 * How the card of an agent the main agent asked stands now, from what its turn's events told of it — with the end the
 * page's list gave where the turn stopped hearing (`listed`).
 * @param {any} s  the call's facts (lib/labels.js alignEvents; `endFromList` over them)
 * @param {{ running: boolean, listed: boolean, row: import("../lib/subagents.js").SubagentRow | null }} at
 * @returns {CardState}
 */
export function askedState(s, { running, listed, row }) {
  const other = running ? "" : answeredOther(row, Number(s.exchange) || 0);
  const base = { ...RUNNING, model: String(s.model || row?.model || ""), seat: seatOf(row, s.exchange), ...(other ? { other } : {}) };
  if (running) {
    const calls = (s.order || []).map((/** @type {string} */ id) => s.tools.get(id)).filter(Boolean);
    const now = [...calls].reverse().find((c) => c.state === "running");
    // A call named once it has run a moment (labels.js CALL_NAMED_AFTER_MS), so a quick one never swaps the words.
    // Its calls an ended turn's read left apart count as made (labels.js `fillCalls`).
    const made = s.apart && !s.apart.filled ? Number(s.apart.calls) || 0 : calls.length;
    const own = now && !callNamedIn(now) ? `${now.card?.title || now.name}${now.card?.subject ? ` ${now.card.subject}` : ""}` : made ? "Thinking…" : "Starting…";
    return { ...base, live: s.asking ? (s.asking.to === "lead" ? (s.asking.plan ? "Sent its lead its plan" : "Asks its lead") : "Waits for your answer") : row?.progress ? liveLine(row.progress) : own };
  }
  if (s.status === "cut") return { ...base, phase: "lost", status: "lost", lost: "was cut off: Filament stopped while it worked" };
  if (s.status === "forgotten") return { ...base, phase: "lost", status: "lost", lost: "its end is not known: Filament holds this agent no longer" };
  const status = String(s.status || (s.state === "done" ? "done" : "failed"));
  const x = row?.exchanges?.[Number(s.exchange) || 0] || null;
  return { ...base, phase: phaseOf(status), status, text: String(s.report || ""), whole: !listed && !s.reportCut, tokens: Number(s.tokens) || 0, usd: Number(s.usd) || Number(x?.spentUsd) || 0, ms: Number(s.ms) || 0, error: String(s.error || "") };
}

/**
 * The figures after an answer: its model — the one that answered where that was another (`other`), from the pool where
 * a row of the session's list named it — tokens, cost and time. @param {CardState} s
 */
export function cardFacts(s) {
  return [s.other || (s.model ? prettyModel(s.model) : ""), s.model ? s.seat?.from : "", s.tokens ? fmt.k(s.tokens) : "", s.usd > 0 ? fmt.usd(s.usd) : "", s.ms ? formatWorkedFor(s.ms) : ""].filter(Boolean).join(" · ");
}

/**
 * The pictures opened under a card, by session and call id, each with whether it stands open: a card drawn anew as its
 * turn goes on puts them back as they were. @type {Map<string, { pic: ReturnType<typeof visualCard>, open: boolean }>}
 */
const shownUnder = new Map();
/** @param {string} chain @param {string} vid */
const underKey = (chain, vid) => `${chain}\u0000${vid}`;
/** A picture's ask and its Tell, from under a card: into the message box (HarnessV4_Visuals_Plan VS-D51). @param {string} text */
const intoBox = (text) => chipActions.visualWords?.(text);

/**
 * What a helper drew in one exchange, under the card that launched or asked it (HarnessV4_Visuals_Plan VS-D50): a line
 * that names each picture once it drew; one clicked opens under the card, clicked again it folds — hidden, never drawn
 * again. `paint` follows what the page knows of what it drew.
 * @param {string} id @param {number} exchange
 */
export function drewPart(id, exchange) {
  const line = h("div", { class: "ask-card-drew hidden" });
  const box = h("div", { class: "ask-card-drawn" });
  let key = "";
  const paint = () => {
    const at = chipActions.drewOf?.(id, exchange) || null;
    const drew = at?.drew || [];
    if (!at || !drew.length) {
      key = "";
      line.classList.add("hidden");
      return void line.replaceChildren();
    }
    // The ones opened before this card was drawn anew stand under it again, in the order drawn.
    for (const d of drew) {
      const held = shownUnder.get(underKey(at.chain, d.id));
      if (held && held.pic.el.parentNode !== box) box.append(held.pic.el);
    }
    const now = drew.map((d) => `${d.id}\u0000${d.title}\u0000${shownUnder.get(underKey(at.chain, d.id))?.open ? 1 : 0}`).join("\u0001");
    if (now === key) return;
    key = now;
    line.classList.remove("hidden");
    morphChildren(line, [
      h("span", { class: "ask-card-drew-ic", html: ICONS.palette }),
      h("span", { class: "ask-card-drew-label" }, "Drew"),
      ...drew.map((d) => {
        const on = shownUnder.get(underKey(at.chain, d.id))?.open === true;
        return h("button", { class: `ask-card-drew-pic${on ? " is-open" : ""}`, type: "button", "data-key": d.id, "aria-expanded": on ? "true" : "false", title: on ? `Fold ${d.title}` : `Open ${d.title} under this card`, onclick: () => toggle(at.chain, d, drew) }, d.title);
      }),
    ]);
  };
  /**
   * @param {string} chain @param {import("../lib/subagents.js").Drew} d
   * @param {import("../lib/subagents.js").Drew[]} drew  all it drew in the exchange, in the order drawn
   */
  const toggle = (chain, d, drew) => {
    const k = underKey(chain, d.id);
    let held = shownUnder.get(k);
    if (!held) {
      const pic = visualCard({ id: d.id, title: d.title }, { onAsk: intoBox, onTell: intoBox });
      held = { pic, open: false };
      shownUnder.set(k, held);
      const later = drew.slice(drew.indexOf(d) + 1).map((x) => shownUnder.get(underKey(chain, x.id))?.pic.el).find((el) => el?.parentNode === box);
      box.insertBefore(pic.el, later || null);
      pic.show({ chain, n: d.turn ?? null, session: d.session === true, title: d.title });
    }
    held.open = !held.open;
    held.pic.el.classList.toggle("hidden", !held.open);
    paint();
  };
  return { line, box, paint };
}

/**
 * What a helper published in one exchange, under the card that launched or asked it (HarnessV4_Artifacts_Plan
 * AFC-100): a line that names each artifact once it made one; one clicked opens in its own side-pane tab. `paint`
 * follows what the page knows of what it made.
 * @param {string} id @param {number} exchange
 */
export function madePart(id, exchange) {
  const line = h("div", { class: "ask-card-made hidden" });
  let key = "";
  const paint = () => {
    const made = chipActions.madeOf?.(id, exchange) || [];
    const now = made.map((m) => `${m.name}\u0000${m.v}\u0000${m.title}`).join("\u0001");
    if (now === key) return;
    key = now;
    line.classList.toggle("hidden", !made.length);
    morphChildren(line, made.length
      ? [
          h("span", { class: "ask-card-drew-ic", html: ICONS.appWindow }),
          h("span", { class: "ask-card-drew-label" }, "Made"),
          ...made.map((m) => h("button", { class: "ask-card-drew-pic", type: "button", "data-key": m.name, title: `Open ${m.title} (v${m.v}) beside the chat`, onclick: () => chipActions.openArtifact?.(m.name) }, m.title)),
        ]
      : []);
  };
  return { line, paint };
}

/** A card's button, kept by its words as the card paints again; its press hears the event, on the button that stands.
 *  @typedef {(label: string, title: string, onclick: (e: Event) => void, cls?: string) => HTMLElement} CardButton */
/**
 * What a card's own part reads when it draws its buttons: how the card stands, the answer as far as it is read, the
 * page's row of the agent, and the button maker.
 * @typedef {{ s: CardState, text: string, known: import("../lib/subagents.js").SubagentRow | null, button: CardButton }} CardNow
 */

/**
 * The frame both cards share: the agent's line; opened, the question under who asked, the answer whole, the buttons.
 * @param {{ id: string, exchange: number, name: string, tag: string, who: string, question: string, pictures?: string[],
 *   files?: string[], said?: string, quiet?: boolean, tone?: string,
 *   handed?: (known: import("../lib/subagents.js").SubagentRow | null) => string,
 *   state: (known: import("../lib/subagents.js").SubagentRow | null) => CardState,
 *   acts: (c: CardNow) => (Node | null)[], lost: (c: CardNow) => (Node | null)[], waits?: (c: CardNow) => (Node | null)[],
 *   opened?: { get: () => boolean, set: (open: boolean) => void }, shown?: (on: boolean) => void }} o
 *   `pictures`, `files`: what the question carried, by name — the person's pictures, or what the main agent attached;
 *   `said`: the name as the card's line says it, where that is more than the name; `quiet`: nobody asked (it started
 *   by itself); `tone`: its agent's colour, a system colour's name (its Library tile's);
 *   `handed`: the change the agent was handed with the question, in words ("" for none);
 *   `state`: how the card stands now; `acts`: its buttons under an answer, and `lost`, under one that has no end;
 *   `waits`: those of its buttons that wait for the person, on the folded line too (E37 case 3);
 *   `opened`: where a card that is drawn anew as its turn goes on keeps whether its answer stands open — and where
 *   the page says a card stands open before anyone touched it (Catch me up's); `shown`: told at each paint whether the
 *   card stands, or was closed — the row that holds it goes with it
 * @param {(row: HTMLElement, onChange: () => void, gone: () => void) => unknown} follow  the card follows the page's
 *   list through it, and hears through `gone` that its row has left the document
 */
function frame({ id, exchange, name, tag, who, question, pictures = [], files = [], said = name, quiet = false, tone = "blue", handed = () => "", state, acts, lost, waits = () => [], opened, shown }, follow) {
  /** What it paints from: a card of a call drawn again is painted from what the call says now (`askedCardAgain`). */
  let from = { handed, state, acts, lost, waits };
  let open = opened?.get() === true;
  /** The person opened or folded it: from then on it stands as they left it. */
  let touched = false;
  /** The whole answer, once asked of the list for a card that holds a clipped one. @type {string | null} */
  let fetched = null;
  let fetching = false;
  /** It could not be read while the card stood open: the list's words stand, and its next opening asks again. */
  let missed = false;
  /** The answer the card's body holds now. */
  let bodyText = "";

  const withPictures = pictures.length || files.length ? h("span", { class: "ask-card-pics", title: attachedNames({ files, pictures }) }, attachedWords({ files, pictures })) : null;
  const withChange = h("span", { class: "ask-card-pics ask-card-handed hidden" });
  const lead = h("span", { class: "ask-card-lead" });
  const first = h("span", { class: "ask-card-first" });
  const facts = h("span", { class: "ask-card-facts" });
  const side = h("span", { class: "ask-card-side" });
  // The rows of the pool its launch passed, each with why (AG-236).
  const passed = h("div", { class: "ask-card-passed hidden" });
  const body = h("div", { class: "ask-card-body a-md hidden" });
  const foot = h("div", { class: "ask-card-acts" });
  const drew = drewPart(id, exchange);
  const made = madePart(id, exchange);
  const asked = h("div", { class: "ask-card-q" }, h("span", { class: "ask-card-you" }, who), h("span", { class: "ask-card-question" }, question), withPictures, withChange);
  const line = h("div", { class: "ask-card-line" }, lead, h("b", { class: "ask-card-name" }, said), first, facts, side);
  const row = h("div", { class: "ask-card", "data-agent": id, "data-tag": tag, "data-self": "", style: `--card-tone: var(--color-sys-${tone})` },
    asked,
    line,
    passed,
    drew.line,
    drew.box,
    made.line,
    body,
    foot);

  /** @type {CardButton} */
  const button = (label, title, onclick, cls = "") => h("button", { class: `sub-mark-send${cls ? ` ${cls}` : ""}`, type: "button", "data-key": label, title, onclick }, label);
  /** The person opens or folds the card: the question whole and the answer whole, or each to its first line. */
  const flip = () => {
    touched = true;
    open = !open;
    opened?.set(open);
    if (open) missed = false;
    paint();
  };
  // The card stands folded until opened (the owner's words of 10-24: "these cards should be collapsed by default",
  // "collapsed into single colored line"): its line pressed opens or folds it — while the agent runs too, when no
  // chevron shows — and the question, shown while it stands open, folds it. A press on a button of the line, or one
  // that ends a selection of its words, is not one; from the keyboard, the line's words are the button.
  /** @param {Event} e */
  const pressed = (e) => {
    if (/** @type {any} */ (e.target)?.closest?.("button, a")) return;
    if (String(globalThis.getSelection?.() || "")) return;
    flip();
  };
  /** @param {KeyboardEvent} e */
  const keyed = (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    flip();
  };
  for (const el of [asked, first]) {
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.addEventListener("keydown", keyed);
  }
  asked.addEventListener("click", pressed);
  line.addEventListener("click", pressed);
  /** Its Hide (E37): the card leaves the chat, its answer seen; the agent's conversation stays in the Agents tab. */
  const hide = () => {
    chipActions.cardClosed?.close(id, exchange);
    paint();
  };

  const paint = () => {
    if (!touched && opened?.get() === true) open = true;
    const known = chipActions.subagentRow?.(id) || null;
    const s = from.state(known);
    // Closed, once the agent ended: one that runs again shows whatever was said of it before — once the session's list
    // says it runs. Before the list answers (the chat shown again), a closed card reads as starting for want of word,
    // and stays closed.
    const kept = chipActions.cardClosed?.has(id, exchange) === true;
    const closed = kept && (s.phase !== "running" || chipActions.subagentsKnown?.() !== true);
    // One that stands all the same is no hidden card: the chat menu's Show N hidden agent cards leaves it out.
    chipActions.cardClosed?.standing?.(row, id, exchange, kept && !closed);
    row.className = `ask-card is-${s.phase}${open ? " is-open" : ""}${quiet ? " is-self" : ""}${closed ? " hidden" : ""}`;
    shown?.(!closed);
    if (closed) return;
    drew.paint();
    made.paint();
    const text = fetched ?? s.text;
    const change = from.handed(known);
    withChange.textContent = change;
    withChange.classList.toggle("hidden", !change);
    passed.textContent = s.seat?.skipped.join(" · ") || "";
    passed.classList.toggle("hidden", !s.seat?.skipped.length);
    asked.classList.toggle("hidden", !open);
    asked.setAttribute("aria-expanded", open ? "true" : "false");
    asked.title = "Fold the card";
    first.setAttribute("aria-expanded", open ? "true" : "false");
    line.title = open ? "" : `${who}: ${question}`;
    const hideBtn = chipActions.cardClosed
      ? h("button", { class: "sub-mark-send is-quiet ask-card-hide", type: "button", "data-key": "hide", "aria-label": `Hide ${name}'s card`, title: "Hide this card from the chat. Nothing is deleted: its conversation stays in the Agents tab, and the chat menu shows the card again", onclick: hide }, "Hide")
      : null;
    if (s.phase === "running") {
      setHtml(lead, "");
      lead.className = "ask-card-lead is-dot";
      first.textContent = s.live;
      facts.textContent = cardFacts(s);
    facts.classList.toggle("is-warn", !!s.other);
      morphChildren(side, [
        ...(chipActions.openSubagent && known ? [button("Open", `Watch ${name} work, beside the chat`, () => chipActions.openSubagent?.(id), "is-quiet")] : []),
        ...(chipActions.stopSubagent && known ? [button("Stop", `Stop ${name}: what it has written so far stays`, () => chipActions.stopSubagent?.(id))] : []),
      ]);
      body.classList.add("hidden");
      morphChildren(foot, []);
      return;
    }
    lead.className = "ask-card-lead";
    setHtml(lead, ICONS.atSign);
    if (s.phase === "lost") {
      first.textContent = s.lost;
      facts.textContent = "";
      morphChildren(side, hideBtn ? [hideBtn] : []);
      body.classList.add("hidden");
      morphChildren(foot, open ? from.lost({ s, text, known, button }) : []);
      return;
    }
    const ended = s.phase === "failed";
    first.textContent = ended ? `${ENDED_WORDS[s.status] || s.status}${s.error ? `: ${s.error}` : ""}` : firstLine(text) || "(no words)";
    facts.textContent = cardFacts(s);
    facts.classList.toggle("is-warn", !!s.other);
    const toggle = h("button", { class: "ask-card-toggle", type: "button", "data-key": "toggle", "aria-expanded": open ? "true" : "false", "aria-label": open ? `Fold ${name}'s answer` : `${name}'s whole answer`, html: open ? ICONS.chevronDown : ICONS.chevronRight, onclick: flip });
    // A clipped answer: the whole one is read once, while it stands open and Filament holds its agent — and again at its
    // next opening where it could not be, or came back empty: the list's words stand meanwhile, as they move (its heads,
    // then its cards' form).
    if (open && !s.whole && fetched == null && !fetching && !missed && known && chipActions.cardAnswer) {
      fetching = true;
      chipActions.cardAnswer(id, exchange).then((whole) => { fetching = false; if (whole) fetched = whole; else missed = true; paint(); }, () => { fetching = false; missed = true; paint(); });
    }
    const c = { s, text, known, button };
    // Folded, the line keeps what waits for the person; opened, every button stands under the answer.
    morphChildren(side, [...(open ? [] : from.waits(c)), hideBtn, text ? toggle : null]);
    body.classList.toggle("hidden", !open || !text);
    // The answer is read into the card once a text: the card paints again each time the agents' list moves.
    if (open && text && text !== bodyText) {
      setHtml(body, mdChat(text, null).out);
      bodyText = text;
    }
    morphChildren(foot, open ? from.acts(c) : []);
  };

  paint();
  follow(row, paint, () => chipActions.cardClosed?.standing?.(row, id, exchange, false));
  paintsOf.set(row, (/** @type {typeof from} */ next) => {
    from = next;
    paint();
  });
  return row;
}
/** Each card's paint from what it is drawn from now (`frame`, `askedCardAgain`). @type {WeakMap<Element, (from: any) => void>} */
const paintsOf = new WeakMap();

/** @param {CardNow} c */
const copyButton = (c) => (c.text ? c.button("Copy", "Copy the answer", () => { navigator.clipboard?.writeText(c.text).catch(() => {}); }) : null);

/**
 * The card for the mark of an agent you asked by its tag; null for the answer's mark where the chat holds the
 * question's too — that one draws the answer. A worker that came back with changes in its own worktree says so here
 * (AG-79), "2 files wait in its copy · Review ›", and the press opens its row in Changes, where Apply says what it would
 * do before you press it (the Designer's of 10-27): on the card of its newest answer alone, since one worktree holds all
 * it changed.
 * @param {any} m  a mark that carries a card
 * @param {{ follow?: (row: HTMLElement, onChange: () => void, gone: () => void) => unknown, now?: () => number, shown?: (on: boolean) => void }} [io]
 *   `shown`: told at each paint whether the card stands (`frame`)
 */
export function agentCardRow(m, { follow = () => {}, now = Date.now, shown } = {}) {
  const id = String(m.agentId);
  const exchange = Number(m.exchange) || 0;
  const pairNow = () => chipActions.cardMarks?.(id, exchange) || {};
  if (m.event === "arrival" && pairNow().dispatch) return null;
  const name = String(m.card?.name || "Agent");
  const tag = String(m.card?.tag || "");
  /** It started by itself: `question` holds why. */
  const self = m.self === true;
  const arrivalNow = () => (m.event === "arrival" ? m : pairNow().arrival || null);
  /**
   * The files that wait in its worktree: what the page's list says, else what its answer's mark said — none where the
   * list was answered without it: Filament holds it no longer, and Changes has no row of it to open (the Hunter's of 10-28).
   */
  const waiting = () => {
    const work = chipActions.subagentWork?.(id) ?? null;
    if (!work && chipActions.subagentsKnown?.() === true) return 0;
    return work ? work.pending : Number(arrivalNow()?.changes) || 0;
  };
  /** @param {CardNow} c @param {number} n */
  const reviewButton = (c, n) => c.button(waitsWords(n), "Its changes wait in its own copy: its row in Changes says what Apply would do, and applies them", () => chipActions.reviewSubagent?.(id));

  /** @param {CardNow} c */
  const sendButton = (c) => {
    return c.button("Send to main agent", "The answer joins the main agent's work: the running turn's next step, else its next turn", (e) => {
      const b = /** @type {HTMLButtonElement} */ (e.currentTarget);
      b.disabled = true;
      chipActions.sendSubagent?.(id, exchange).catch(() => { b.disabled = false; });
    });
  };

  /** Changes waiting in its worktree, and its answer kept for you to send on: what its folded line keeps. @param {CardNow} c */
  const waitsFor = (c) => {
    const newest = !c.known || exchange >= c.known.exchanges.length - 1;
    const n = chipActions.reviewSubagent && newest ? waiting() : 0;
    const held = c.s.phase !== "failed" && !chipActions.outsideClient?.() && chipActions.subagentDelivery?.(id, exchange) === "held" && !!chipActions.sendSubagent && !!c.text;
    return [n > 0 ? reviewButton(c, n) : null, held ? sendButton(c) : null];
  };

  return frame({
    id, exchange, name, tag,
    who: self ? "Started by itself on" : m.followUp ? "You asked again" : "You asked",
    question: String(m.question || m.description || ""),
    tone: cardTone(m.card),
    waits: waitsFor,
    ...(self ? { said: `${name}, by itself`, quiet: true } : {}),
    pictures: Array.isArray(m.pictures) ? m.pictures.map(String) : [],
    handed: (known) => handedWords(m.handed, arrivalNow()?.handedFiles ?? known?.exchanges?.[exchange]?.handed?.files ?? null),
    opened: { get: () => chipActions.cardOpen?.get(id, exchange) === true, set: (open) => chipActions.cardOpen?.set(id, exchange, open) },
    shown,
    state: (known) => cardState(m, arrivalNow(), { row: known, known: chipActions.subagentsKnown?.() === true, now: now(), card: chipActions.subagentCard }),
    // One that started by itself was asked nothing to ask again: the next turn's end starts it anew.
    lost: (c) => [chipActions.askAgain && !self ? c.button("Ask again", `Ask ${name} this once more`, () => chipActions.askAgain?.(id, tag, String(m.question || ""))) : null],
    acts: (c) => {
      // Where the answer stands: with you, until you send it on (L-63). One that did not finish is not handed on from
      // here: what was written before the end can be read and copied.
      const delivery = chipActions.subagentDelivery?.(id, exchange);
      const outside = chipActions.outsideClient?.() || null;
      const send = delivery === "sent" ? h("span", { class: "ask-card-note" }, "Sent to the main agent")
        // Its answer went on to the main agent by itself.
        : delivery === "auto" ? h("span", { class: "ask-card-note" }, "Its answer goes to the main agent by itself")
        : c.s.phase === "failed" ? null
        : outside ? h("span", { class: "ask-card-note" }, `${outside} writes this session's turns: copy the answer over to pass it on`)
        : delivery === "held" && chipActions.sendSubagent && c.text ? sendButton(c)
        : null;
      const newest = !c.known || exchange >= c.known.exchanges.length - 1;
      const waits = chipActions.reviewSubagent && newest ? waiting() : 0;
      return [
        waits > 0 ? reviewButton(c, waits) : null,
        chipActions.askAgain ? c.button("Ask again", c.known ? `Go on with ${name} in the same thread: it is told what happened since` : `Ask ${name} anew`, () => chipActions.askAgain?.(id, tag, "")) : null,
        send,
        copyButton(c),
        chipActions.openSubagent && c.known ? c.button("Open", `${name}'s conversation, beside the chat`, () => chipActions.openSubagent?.(id), "is-quiet") : null,
      ];
    },
  }, follow);
}

/**
 * The card for an agent the main agent asked by itself, in place of that call's row on the turn (AG-46).
 * @param {any} s  the call's facts: what its turn's events told of the agent, with the list's end where the turn
 *   stopped hearing
 * @param {{ running: boolean, listed?: boolean, follow?: (row: HTMLElement, onChange: () => void, gone: () => void) => unknown,
 *   opened?: { get: () => boolean, set: (open: boolean) => void } }} io
 */
export function askedCardRow(s, { running, listed = false, follow = () => {}, opened }) {
  const row = frame(askedFrom(s, { running, listed, opened }), follow);
  askedCards.set(row, askedKey(s));
  return row;
}

/** Who the card of an agent the main agent asked is of, and what it was asked: a call drawn again with these the same
 *  paints the card that stands (`askedCardAgain`). @param {any} s */
const askedKey = (s) => JSON.stringify([String(s.agentId || ""), Number(s.exchange) || 0, s.card?.name ?? null, s.card?.tag ?? null, String(s.prompt || s.description || ""), !!s.followUp, cardTone(s.card)]);
/** The cards of agents the main agent asked, by the row on the page: whom each is of (`askedKey`). @type {WeakMap<Element, string>} */
const askedCards = new WeakMap();

/**
 * The card of an agent the main agent asked, on the page as `row`, painted from what its call says now: a running turn
 * draws its rows again at every event, and the card made anew each time — its Stop, Open, Hide and Overrule with it —
 * blinked under a resting pointer and lost the press (the owner's of 11-01). The row, or null where it is no such card
 * of the same agent and question.
 * @param {Element} row @param {any} s @param {{ running: boolean, listed?: boolean, opened?: { get: () => boolean, set: (open: boolean) => void } }} io
 * @returns {HTMLElement | null}
 */
export function askedCardAgain(row, s, { running, listed = false, opened }) {
  const paint = paintsOf.get(row);
  if (!paint || askedCards.get(row) !== askedKey(s)) return null;
  paint(askedFrom(s, { running, listed, opened }));
  return /** @type {HTMLElement} */ (row);
}

/**
 * What the card of an agent the main agent asked is drawn from (`frame`'s parts).
 * @param {any} s @param {{ running: boolean, listed: boolean, opened?: { get: () => boolean, set: (open: boolean) => void } }} io
 */
function askedFrom(s, { running, listed, opened }) {
  const id = String(s.agentId || "");
  const exchange = Number(s.exchange) || 0;
  const name = String(s.card?.name || "Agent");
  const tag = String(s.card?.tag || "");
  const question = String(s.prompt || s.description || "");
  /**
   * An editor's files that wait in its copy, as the page's list says — its newest exchange's card says so, folded too,
   * and its Review › opens its row in Changes (the Hunter's of 10-28: this card alone had none).
   * @param {CardNow} c
   */
  const review = (c) => {
    const newest = !c.known || exchange >= c.known.exchanges.length - 1;
    const n = chipActions.reviewSubagent && newest && c.s.phase !== "running" ? chipActions.subagentWork?.(id)?.pending || 0 : 0;
    return n > 0 ? c.button(waitsWords(n), "Its changes wait in its own copy: its row in Changes says what Apply would do, and applies them", () => chipActions.reviewSubagent?.(id)) : null;
  };
  return {
    id, exchange, name, tag,
    who: s.followUp ? "The main agent asked again" : "The main agent asked",
    question,
    pictures: s.attached?.pictures || [],
    files: s.attached?.files || [],
    tone: cardTone(s.card),
    waits: (c) => [review(c)],
    handed: (known) => handedWords(s.handed, known?.exchanges?.[exchange]?.handed?.files ?? null),
    opened,
    state: (known) => askedState(s, { running, listed, row: known }),
    lost: (c) => [chipActions.openSubagent && c.known ? c.button("Open", `${name}'s conversation, beside the chat`, () => chipActions.openSubagent?.(id), "is-quiet") : null],
    acts: (c) => {
      const over = chipActions.overruledOf?.(id, exchange) || null;
      // Your words stand over an answer that was given; one that did not finish gave the main agent nothing to follow.
      // A session another client writes takes no message from this page, so there is nothing to overrule it with.
      const can = c.s.phase === "done" && !!chipActions.overrule && !chipActions.outsideClient?.();
      return [
        review(c),
        over ?h("span", { class: "ask-card-note is-overruled", title: over.words }, `Overruled by you: “${over.words}”`) : null,
        can ? c.button(over ? "Overrule again" : "Overrule", "Your next message tells the main agent that your words stand over this answer", () => chipActions.overrule?.({ agentId: id, exchange, name, question, answer: firstLine(c.text) })) : null,
        copyButton(c),
        chipActions.openSubagent && c.known ? c.button("Open", `${name}'s conversation, beside the chat`, () => chipActions.openSubagent?.(id), "is-quiet") : null,
      ];
    },
  };
}
