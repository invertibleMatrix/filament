// @ts-check
// The dock's decisions (HarnessV3-Views VW-D1, VW-D6, V3): what waits for the developer sits above the composer, in
// whichever view shows — the session's own pause (a permission or a question), a coding agent's questions while its
// turn runs (HarnessV3-ACP AC2-4, agent-ask.js), and each worker's waiting call on one line. The
// turn that asked keeps a line pointing here (timeline.js). In the Team view a worker's card asks instead, so its line
// leaves the dock. A worker's answers — Deny with a line for why, Always allow when an offer stands, and Allow — are
// drawn here once, for the dock's lines and the Team view's cards alike.
import { h, placeChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { offerWords } from "../lib/labels.js";
import { askKey, askWords, cardState, loopWaitWords, whoOf } from "../lib/team.js";
import { kids } from "../widgets/kit.js";
import { ALWAYS_ONLY, inputBlock, permissionBlock, reviewWords } from "./interaction.js";
import { secondLookView } from "./second-look.js";
import { agentAskBlock } from "./agent-ask.js";
import { newestOnRecord } from "./history.js";

/** @typedef {typeof h} Mk */
/** @typedef {(parent: any, wanted: any[]) => void} Place */
/**
 * A worker's waiting call answered by a press: Allow or Deny, Deny's why, and `ask`, the number of the ask its card
 * drew (TG2-D42) — the answer settles that ask alone, never one that came after. A question another machine's chat asks
 * (`questionChoices`) is answered by a choice — `choice`, its number from 1, `words` its own — or the person's words.
 * @typedef {import("./interaction.js").PermissionAnswer & { ask?: number | null, choice?: string }} WorkerAnswer
 */

/**
 * What draws a worker's waiting call's answers anew: the call (`askKey`) and its ask's number, which their presses
 * carry — the same call asked again is another ask, with answers of its own.
 * @param {any} asking
 */
export const answersKey = (asking) => `${askKey(asking)}\u0000${asking.n ?? ""}`;

/**
 * The choices of a question a sub-agent's chat on another machine asks there (the s-asks hunt's), by their words — none
 * for a question its words alone answer —, or null where it asks for a permission: Allow or Deny answer that.
 * @param {any} asking @returns {string[] | null}
 */
export const questionChoices = (asking) => (asking?.kind === "question" ? (Array.isArray(asking.options) ? asking.options.map(String) : []) : null);

/**
 * A question's answers for `answerControls`: its choices, and whether the person's words answer it too (none where it
 * takes its choices alone, `words` false); for a permission, `onlyAlways` where its agent offers only to always allow it.
 * @param {any} asking
 * @returns {{ choices?: string[], words?: boolean, onlyAlways?: boolean }}
 */
export const questionOf = (asking) => {
  const choices = questionChoices(asking);
  // An agent that offers only to always allow its call: Allow always on every surface that answers it, never a plain
  // Allow (the bug hunt of 5d57bbe8a: the thread's strip, the viewer and the Team card said "Run it, this once").
  return { ...(choices ? { choices, words: asking.words !== false } : {}), ...(asking?.always ? { onlyAlways: true } : {}) };
};

/**
 * What a worker's waiting call asks, on its line: a question's words are the ask itself, so they give way to its
 * choices at the line's end and its hover holds them whole (`is-question`).
 * @param {Mk} mk @param {any} asking @param {string} verb  its words (`askWords`)
 */
export const askWhat = (mk, asking, verb) =>
  questionChoices(asking) ? mk("span", { class: "ask-what is-question", title: verb }, verb) : mk("span", { class: "ask-what" }, verb);

/**
 * A worker's waiting call's answers (VW-D10): Deny opens a line for why, which the worker reads; Always allow makes
 * the rule the call's shape is offered under — from its first ask (HarnessV4_Tasks E3) — then runs it; Allow, the one
 * blue button, runs it once. One answer at a time: the buttons wait for it, and a refused one gives them back (the
 * host says why). A question (`choices`, `questionOf`) has no Allow or Deny: each of its choices answers it, and
 * Other… opens a line for the person's own words, where words answer it (`words`). One whose agent offers only to
 * always allow it (`onlyAlways`) has Allow always in place of Allow, and no rule to offer.
 * @param {Mk} mk
 * The press decides: Allow answers `{ allow: true }`, Deny `{ allow: false }` with its why as typed, a choice
 * `{ allow: false, choice, words }` — each, and Always allow, with `n`, the number of the ask the card drew, where its
 * ask has one.
 * @param {{ id: string, who: string, n?: number | null, offer?: import("../lib/labels.js").Offer | null,
 *   answer: (id: string, a: WorkerAnswer) => Promise<boolean>, always: (id: string, offer: import("../lib/labels.js").Offer, ask: number | null) => Promise<boolean>,
 *   place?: Place, choices?: string[] | null, words?: boolean, onlyAlways?: boolean }} o  `who` names the worker in the why line's words
 * @returns {{ el: any }}
 */
export function answerControls(mk, o) {
  const place = o.place || placeChildren;
  const n = Number.isInteger(o.n) ? /** @type {number} */ (o.n) : null;
  const ask = n == null ? {} : { ask: n };
  let denying = false;
  let busy = false;
  let answered = false;
  const btn = (/** @type {string} */ label, /** @type {string} */ title, /** @type {() => void} */ fn, primary = false) =>
    mk("button", { class: `inst-btn${primary ? " is-primary" : ""}`, type: "button", title, onclick: fn }, label);
  /** @param {() => Promise<boolean>} fn */
  const send = async (fn) => {
    if (busy || answered) return;
    busy = true;
    paint();
    let ok = false;
    try {
      ok = await fn();
    } catch {}
    busy = false;
    answered = ok;
    paint();
  };
  const choices = Array.isArray(o.choices) ? o.choices : null;
  const deny = () => {
    const words = String(why.value || "").trim();
    // A question's Other… sends words, or nothing.
    if (choices && !words) return void why.focus();
    void send(() => o.answer(o.id, { allow: false, words, ...ask }));
  };
  const back = () => {
    denying = false;
    paint();
    (choices ? otherBtn : denyBtn)?.focus();
  };
  const why = mk("input", {
    class: "ask-why",
    type: "text",
    placeholder: choices ? "Your answer, in your own words" : `Why not? ${o.who} reads it (optional)`,
    "aria-label": choices ? `Your answer to ${o.who}` : `Why ${o.who} may not`,
    onkeydown: (/** @type {KeyboardEvent} */ e) => {
      // Enter that ends a composition (an input method's) is no send.
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") { e.preventDefault(); deny(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); back(); }
    },
  });
  const denyBtn = btn("Deny", `Say no; a line for why reaches ${o.who}`, () => { denying = true; paint(); why.focus(); });
  const offer = o.offer;
  const alwaysBtn = offer?.shape && !o.onlyAlways ? btn("Always allow", `Always allow in this project: ${offerWords(offer)}`, () => void send(() => o.always(o.id, offer, n))) : null;
  const allowBtn = o.onlyAlways
    ? btn("Allow always", "Run it, and let its agent run calls like it without asking again this session", () => void send(() => o.answer(o.id, { allow: true, words: "", ...ask })), true)
    : btn("Allow", "Run it, this once", () => void send(() => o.answer(o.id, { allow: true, words: "", ...ask })), true);
  const cancelBtn = btn("Cancel", choices ? "Back to its choices" : "Back to the answers", back);
  const sendDeny = choices ? btn("Send", "Answer in your words", deny, true) : btn("Deny", "Answer no, with your words", deny);
  // A question's: each choice answers it by its number, its words the choice's own; Other… opens the line for words.
  const picks = (choices || []).map((label, i) => btn(label, `Answer: ${label}`, () => void send(() => o.answer(o.id, { allow: false, words: label, choice: String(i + 1), ...ask }))));
  const otherBtn = choices && o.words !== false ? btn("Other…", "Answer in your own words", () => { denying = true; paint(); why.focus(); }) : null;
  const el = mk("div", { class: choices ? "ask-acts is-question" : "ask-acts" });
  function paint() {
    const off = busy || answered;
    for (const b of [denyBtn, alwaysBtn, allowBtn, cancelBtn, sendDeny, why, otherBtn, ...picks]) b?.toggleAttribute("disabled", off);
    place(el, kids(denying ? [why, cancelBtn, sendDeny] : choices ? [...picks, otherBtn] : [denyBtn, alwaysBtn, allowBtn]));
  }
  paint();
  return { el };
}

/**
 * A worker's waiting call on one line (VW-D10) — a review rule's with its second look under it (SG-D13) —: its glyph, who asks — a click opens its card in the Team view — what it
 * wants to do, and the answers.
 * @param {Mk} mk @param {any} row
 * @param {{ answer: (id: string, a: WorkerAnswer) => Promise<boolean>, always: (id: string, offer: import("../lib/labels.js").Offer, ask: number | null) => Promise<boolean>, reveal: (id: string) => void, place?: Place, look?: typeof secondLookView }} o
 */
export function workerLine(mk, row, o) {
  const who = whoOf(row);
  const asking = row.progress.asking;
  const w = askWords(asking);
  const strip = mk("div", { class: "ask-strip", role: "group", "aria-label": `${who.word} ${row.id} asks` },
    mk("span", { class: `role-tile is-sm${who.worker ? "" : " is-sub"}`, html: ICONS[/** @type {keyof typeof ICONS} */ (who.icon)] || "" }),
    mk("button", { class: "ask-who", type: "button", title: `${row.id}: its card on the Agents tab`, onclick: () => o.reveal(row.id) }, who.word),
    askWhat(mk, asking, w.verb),
    w.what ? mk("code", { class: "ask-cmd", title: w.whole }, w.what) : null,
    answerControls(mk, { id: row.id, who: `the ${who.word.toLowerCase()}`, n: asking.n, offer: asking.review || asking.always ? null : asking.offer || null, answer: o.answer, always: o.always, place: o.place, ...questionOf(asking) }).el);
  // One its agent offers only to always allow: what a yes keeps, under the line.
  const always = asking.always ? mk("div", { class: "ix-reason" }, ALWAYS_ONLY) : null;
  // A review rule asks (HarnessV4_Space_Plan SG-D13): the Reviewer's second look under the line, the rule named.
  if (!asking.review) return always ? mk("div", { class: "ask-strip-look" }, strip, always) : strip;
  const r = reviewWords(String(asking.review));
  return mk("div", { class: "ask-strip-look" },
    strip,
    always,
    mk("div", { class: "ix-rule", title: String(asking.review) }, "rule: review · ", mk("code", {}, r.pattern), r.shipped ? ` · ${r.shipped}` : null),
    (o.look || secondLookView)(asking.look, { h: mk }).el);
}

/**
 * @typedef {{
 *   answer: (chat: any, text: string) => void,
 *   permit: (chat: any, a: import("./interaction.js").PermissionAnswer) => void,
 *   always: (chat: any, offer: import("../lib/labels.js").Offer) => void,
 *   alwaysInChat?: (chat: any, keeps: import("../lib/labels.js").Keeps) => void,
 *   workerAnswer: (id: string, a: WorkerAnswer) => Promise<boolean>,
 *   workerAlways: (id: string, offer: import("../lib/labels.js").Offer, ask: number | null) => Promise<boolean>,
 *   reveal: (id: string) => void,
 *   agentAnswer: (chat: any, ask: any, a: import("./agent-ask.js").AgentAnswer) => Promise<string>,
 *   agentPlan: (chat: any, ask: any, x: { choice: string, words: string }) => Promise<string>,
 *   agentPermission: (chat: any, ask: any, x: { allow: boolean, words: string }) => void,
 *   open: (url: string) => void,
 *   keys?: () => "free" | "resting" | null,
 * }} DecisionsIO  `answer`: the session's question answered, its words sent as the next message ("" leaves the answer to
 *   the composer); `permit`: the session's waiting call answered by the card's press, with Deny's words; `always`: the offer standing for the paused call's shape confirmed; `alwaysInChat`: what the waiting command's card offered to always allow in this chat (d-allow), kept — the press's answer follows it, and a dock given none draws no such row; `workerAnswer`/`workerAlways`: a worker's waiting call answered; `reveal`: a worker's
 *   card, in the Team view; `agentAnswer`: a coding agent's question answered on its run ("" once the run took it, else
 *   why not); `agentPlan`: a coding agent's plan answered with one of its own ways on, the same; `agentPermission`: a
 *   coding agent's request the session's switch asked about, allowed or denied — Deny's words for the agent; `open`: a
 *   link an agent asks the person to open, in a new tab; `keys`: whose the keys are now (`dockKeys`), for a decision
 *   that appears — with none, a decision never takes them by itself
 */

/** Where the developer types: a field, or anything in a sheet, a dialog, a popover or a menu. */
const TYPING = 'input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]';

/**
 * Whose the keys are when a decision appears in the dock (HarnessV4_Tasks U1; HarnessV3-ACP AC3's notes: with the
 * focus in the composer, the number keys a decision's hint names typed into the composer). Null where the developer
 * types — words wait in the composer, the focus is in another field, a sheet or a dialog is open; "free" where
 * nothing holds them; "resting" where the empty composer holds them, or a control that types nothing.
 * @param {{ draft: string, modal: boolean, active: any, body: any, box: any }} s  the composer's words and its box,
 *   whether a modal sheet or dialog is open, and what holds the focus
 * @returns {"free" | "resting" | null}
 */
export function dockKeys(s) {
  if (String(s.draft || "").trim() || s.modal) return null;
  if (!s.active || s.active === s.body) return "free";
  if (s.active === s.box) return "resting";
  return s.active.closest?.(TYPING) ? null : "resting";
}

/**
 * A question Filament's loop paused on while a coding agent is the chat's model: it waits for Filament's agent — what
 * it asks, and that the agent answers none of it — with nothing to press. A message to the agent goes to the agent, and
 * the question is left unanswered (the transcript's `unanswered`, which the turn that asked then says).
 * @param {Mk} mk @param {any} p  the pause @param {string} coder  the coding agent, by name
 */
function loopWaits(mk, p, coder) {
  const asks = p?.question ? String(p.question) : "";
  return mk("div", { class: "dock-loop-waits", role: "note" },
    mk("div", { class: "dlw-head" }, loopWaitWords(p)),
    asks ? mk("div", { class: "dlw-asks" }, asks) : null,
    mk("div", { class: "dlw-note" }, `${coder} answers none of it. Switch the chat back to Filament's agent to answer it — a message to ${coder} goes to ${coder}, and leaves it unanswered.`));
}

/**
 * The dock's decisions. `paint` takes the chat on screen, its sub-agents, the view that shows and the team that leads;
 * each block is kept while what it asks holds, so the words typed into it survive the run's events.
 * @param {DecisionsIO} io
 * @param {{ h?: Mk, place?: Place, later?: (fn: () => void, ms: number) => void }} [o]  the tests' fake DOM and clock
 * @returns {{ el: any, paint: (s: { chat: any, rows: any[], view: string, team: { key?: string, name: string, icon: string, members?: readonly import("../lib/team.js").TeamMember[] } | null, coder?: string }) => void, focus: () => void }}
 *   `coder`: the coding agent that is the chat's model now, by name, "" for Filament's loop — which alone answers the
 *   question its turn paused on
 */
export function createDecisions(io, o = {}) {
  const mk = o.h || h;
  const place = o.place || placeChildren;
  const later = o.later || ((fn, ms) => { setTimeout(fn, ms); });
  const el = mk("div", { class: "dock-asks is-empty", role: "region", "aria-label": "Waiting for you" });
  /** @type {{ paused: any, key: string, el: any } | null} */
  let pause = null;
  /** @type {Map<string, { key: string, el: any }>} */
  const lines = new Map();
  /** A coding agent's questions that wait on its run, by run and id: each keeps its block, with what was typed in it.
   *  @type {Map<string, any>} */
  const asked = new Map();
  /** Their blocks as the dock shows them. @type {any[]} */
  let questions = [];
  /** The decision on top at the last paint — its block, and what it asks — to tell one that appears. @type {any} */
  let topEl = null;
  /** @type {any} */
  let topAsks = null;

  /**
   * A decision's block takes the focus: a question or a permission on its chosen answer, which the arrows move and
   * Enter sends. A coding agent's question takes it whole: its keys are the block's. `flash`: a moment's ring says
   * where, as the Team view's reveal does.
   * @param {any} block @param {boolean} flash
   */
  const take = (block, flash) => {
    const whole = block.classList.contains("ax-block");
    (whole ? block : block.querySelector?.("button") || block).focus?.();
    if (!flash) return;
    block.classList.add("is-flash");
    later(() => block.classList.remove("is-flash"), 1200);
  };

  /** A permission block's way to keep what Always allow in this chat offers (d-allow), where the page gives one. @param {any} chat */
  const keeper = (chat) => (io.alwaysInChat ? { onAlwaysInChat: (/** @type {import("../lib/labels.js").Keeps} */ keeps) => io.alwaysInChat?.(chat, keeps) } : {});

  /**
   * The block for the session's pause: a permission, or a question — or, while a coding agent is the chat's model
   * (`coder`), the loop's question waiting for Filament's agent, with nothing to press: only the loop's turn answers it,
   * and a message to the agent leaves it unanswered.
   * @param {any} chat @param {any} turn @param {string} coder
   */
  const pauseBlock = (chat, turn, coder) => {
    const p = turn.paused;
    if (coder) return loopWaits(mk, p, coder);
    if (p.kind === "permission") return permissionBlock(turn, { onAnswer: (a) => io.permit(chat, a), onAlways: (offer) => io.always(chat, offer), ...keeper(chat) }, { h: mk });
    return inputBlock(turn, { onAnswer: (text) => io.answer(chat, text) }, { h: mk });
  };

  /**
   * A coding agent's request the session's switch asks about (HarnessV3-ACP AC3-2): the loop's own permission card —
   * the agent and the loop's tool it reads as, the command whole and why it asks, the files it changes as their diffs
   * (AC3's drive D5), Allow, the project's always-allow or the chat's own (d-allow), and Deny with words for the agent.
   * @param {any} chat @param {any} a  the run's ask, its form `judged`
   */
  const judgedBlock = (chat, a) => {
    const f = a.form;
    const j = f.judged;
    const paused = { tool: f.agent ? `${f.agent} · ${j.tool}` : j.tool, command: j.command, reason: j.reason, question: f.title, offer: j.offer, ...(j.keeps ? { keeps: j.keeps } : {}), changes: j.changes, changesLeft: j.changesLeft, ...(j.review ? { review: j.review, look: j.look } : {}), ...(j.always ? { always: true } : {}) };
    return permissionBlock({ paused }, {
      onAnswer: (x) => io.agentPermission(chat, a, x),
      onAlways: (offer) => io.always(chat, offer),
      ...keeper(chat),
    }, { h: mk });
  };

  return {
    el,
    paint(s) {
      const turn = newestOnRecord(s.chat?.turns);
      const paused = turn?.paused || null;
      // The pause's block is kept while its pause holds, with the words typed into it.
      const coder = String(s.coder || "");
      const key = coder;
      if (!paused) pause = null;
      else if (pause?.paused !== paused || pause?.key !== key) pause = { paused, key, el: pauseBlock(s.chat, turn, coder) };
      const asking = (s.rows || []).filter((r) => cardState(r) === "asking");
      for (const id of [...lines.keys()]) if (!asking.some((r) => r.id === id)) lines.delete(id);
      for (const r of asking) {
        const key = answersKey(r.progress.asking);
        if (lines.get(r.id)?.key !== key) lines.set(r.id, { key, el: workerLine(mk, r, { answer: io.workerAnswer, always: io.workerAlways, reveal: io.reveal, place }) });
      }
      /** @type {any[]} */
      const waiting = Array.isArray(turn?.waiting) ? turn.waiting : [];
      // A plan with its agent's own ways on says what a yes does to the switch (HarnessV3-ACP AC3-3): its block is
      // drawn anew as the switch moves.
      const mode = String(s.chat?.view?.settings?.effective?.loop?.permissions || "");
      const keys = waiting.map((a) => `${a.runId ?? ""}:${a.id}${a.form?.kind === "plan" && a.form.questions?.length ? `:${mode}` : ""}`);
      for (const k of [...asked.keys()]) if (!keys.includes(k)) asked.delete(k);
      waiting.forEach((a, i) => {
        if (asked.has(keys[i])) return;
        asked.set(keys[i], a.form?.judged
          ? judgedBlock(s.chat, a)
          : agentAskBlock(mk, a, { answer: (x) => io.agentAnswer(s.chat, a, x), plan: (x) => io.agentPlan(s.chat, a, x), open: io.open, mode }));
      });
      questions = keys.map((k) => asked.get(k));
      // In the Team view the worker's card asks: its line leaves the dock, and comes back, as it was, outside it.
      const shown = s.view === "team" ? [] : asking.map((r) => /** @type {{ el: any }} */ (lines.get(r.id)).el);
      place(el, kids([pause?.el, ...questions, ...shown]));
      el.classList.toggle("is-empty", !pause && !questions.length && !shown.length);
      // A decision that appears on top takes the keys where the developer types nothing (HarnessV4_Tasks U1), as a
      // coding agent's own prompt does: the keys its hint names are its block's, not the composer's. The same
      // decision drawn anew takes them back only where the redraw dropped them, never from the composer the developer
      // went to.
      const top = pause?.el || questions[0] || null;
      const asks = pause ? pause.paused : waiting.length ? `${waiting[0].runId ?? ""}:${waiting[0].id}` : null;
      if (top && top !== topEl) {
        const keys = io.keys?.() || null;
        if (asks !== topAsks ? keys : keys === "free") take(top, asks !== topAsks);
      }
      topEl = top;
      topAsks = asks;
    },
    /** The decision on top takes the focus, and a moment's ring says where: the turn's pointer brings the developer
     *  here. */
    focus() {
      const block = pause?.el || questions[0];
      if (block) take(block, true);
    },
  };
}
