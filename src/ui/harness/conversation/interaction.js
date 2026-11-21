// @ts-check
// The interaction blocks: the permission block, the input-required block, the error banner, and the limit card that
// takes the banner's place where a coding agent's plan stopped its turn (HarnessV3-ACP AC3-6). A permission to change
// a file shows the change: its file, and its diff (AC3's drive D5).
// They sit above the composer. Allow says the person's press (`allow`), never a word read for a yes; Deny says no, with the feedback text when the developer
// wrote one; Always allow appears where the ask carries the always-allow for its call's shape (`paused.offer`,
// HarnessV3-Views V3) — from the first ask of a shape (HarnessV4_Tasks E3) — and makes that rule; where the project
// offers none for a command, Always allow in this chat appears with what it keeps (`paused.keeps`, d-allow): exactly
// that command, in this chat. One always-row a card. A review rule's ask
// (HarnessV4_Space_Plan SG-D13) names the rule and has the Reviewer's second look on top, and never Always allow. A
// question with choices (HarnessV3-Tools TL-D11) sends the chosen label, or the developer's own words under Other….
import { h } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { ICONS } from "../lib/icons.js";
import { failureCard, failureWords } from "../lib/failure.js";
import { keepsWords, offerWords } from "../lib/labels.js";
import { inlineMarks, spanWords, tok } from "../widgets/kit.js";
import { diffView, menu } from "../lib/ui.js";
import { richDiff } from "../lib/diff-render.js";
import { alternativesOf, limitWords, summaryWords, whenWords } from "../../lib/accounts.js";
import { CARRY_WORDS } from "../../lib/context-words.js";
import { prettyModel } from "../lib/families.js";
import { compactingRow } from "./compacting.js";
import { secondLookView } from "./second-look.js";
import { unsent } from "./history.js";

/** Why a request whose agent offers only to always allow it asks, under its command or its changes. */
export const ALWAYS_ONLY = "The agent offers only to always allow this: once allowed, it runs calls like it without asking again for the rest of its session, whatever the switch says then.";

/**
 * The rows a block offers to choose from — the permission block's and a question's: a click chooses a row, a
 * double-click sends it; the confirm button is named for the chosen row; ↑/↓ move the choice and Enter sends it —
 * Ctrl+Enter from inside the block's text box, where Enter is a new line. The text box shows while a row that takes
 * words is chosen. `arm` wires the block's keys and chooses the first row.
 * @param {typeof h} mk @param {HTMLElement} text  the block's text box
 */
function choiceList(mk, text) {
  const confirm = mk("button", { class: "primary sm", type: "button" });
  /** @type {{ row: HTMLElement, button: string, words: boolean, go: () => void }[]} */
  const choices = [];
  let at = 0;
  /** @param {number} i */
  const choose = (i) => {
    at = i;
    choices.forEach((c, j) => {
      c.row.classList.toggle("on", j === i);
      c.row.setAttribute("aria-selected", j === i ? "true" : "false");
    });
    confirm.textContent = choices[i].button;
    text.classList.toggle("hidden", !choices[i].words);
  };
  /**
   * A row: its label, what it means, what sending it does. `words`: it sends the text box's words; `button`: what
   * the confirm button says while it is chosen (its label by default); `title`: what a resting pointer reads on it.
   * @param {string} label @param {string | any[]} desc  its words, or their nodes @param {() => void} go
   * @param {{ words?: boolean, button?: string, title?: string }} [o]
   */
  const option = (label, desc, go, { words = false, button = label, title = "" } = {}) => {
    const i = choices.length;
    const row = mk("button", { class: "ix-option", type: "button", role: "option", ...(title ? { title } : {}) },
      mk("span", { class: "ix-option-mark", html: ICONS.check }),
      mk("span", { class: "ix-option-label" }, label),
      desc.length ? mk("span", { class: "ix-option-desc" }, ...(Array.isArray(desc) ? desc : [desc])) : null);
    row.addEventListener("click", () => choose(i));
    row.addEventListener("dblclick", go);
    choices.push({ row, button, words, go });
    return row;
  };
  confirm.addEventListener("click", () => choices[at].go());
  /** @param {HTMLElement} block */
  const arm = (block) => {
    block.addEventListener("keydown", (e) => {
      const inText = e.target === text;
      if (e.key === "ArrowDown" && !inText) { e.preventDefault(); choose((at + 1) % choices.length); }
      else if (e.key === "ArrowUp" && !inText) { e.preventDefault(); choose((at - 1 + choices.length) % choices.length); }
      else if (e.key === "Enter" && (!inText || e.ctrlKey || e.metaKey)) { e.preventDefault(); choices[at].go(); }
    });
    choose(0);
    return block;
  };
  return { option, confirm, arm };
}

/**
 * A change as a card gets it, the server's `FileChange`: the file by its path in the folder, a unified patch, what it
 * adds and removes, and the rows the patch leaves out.
 * @typedef {{ file: string, patch: string, added: number, removed: number, created: boolean, deleted: boolean,
 *   every: boolean, omitted: number }} Change
 */

/**
 * A change a permission asks about (HarnessV3-ACP, AC3's drive D5): its file — the name, then the folder it is in —,
 * what it makes of the file and its line counts, over its diff: the plain rows at once, the rich ones (word-level,
 * highlighted, as the review pane draws them) once they load. A diff cut short says how many lines it left out.
 * @param {typeof h} mk @param {Change} c
 */
function changeBlock(mk, c) {
  const file = String(c.file || "");
  const at = file.lastIndexOf("/");
  const tag = c.created ? "New file" : c.deleted ? "Deleted" : c.every ? "Every occurrence" : "";
  const patch = String(c.patch || "");
  const diff = patch ? mk("div", { class: "ix-change-diff" }, diffView(patch.replace(/^--- [^\n]*\n\+\+\+ [^\n]*\n/, ""), { h: mk })) : null;
  if (diff) richDiff(patch, { unified: true }).then((el) => { if (el) diff.replaceChildren(el); }).catch(() => {});
  return mk("div", { class: "ix-change" },
    mk("div", { class: "ix-change-head", title: file },
      mk("span", { class: "ix-change-ic", html: ICONS.fileDiff }),
      mk("span", { class: "ix-change-name" }, at >= 0 ? file.slice(at + 1) : file),
      at > 0 ? mk("span", { class: "ix-change-dir" }, file.slice(0, at)) : null,
      tag ? mk("span", { class: "ix-change-tag" }, tag) : null,
      c.added || c.removed
        ? mk("span", { class: "zc-diff" },
            c.added ? mk("span", { class: "zc-diff-add" }, `+${c.added}`) : null,
            c.removed ? mk("span", { class: "zc-diff-del" }, `-${c.removed}`) : null)
        : null),
    diff,
    c.omitted ? mk("div", { class: "ix-change-more" }, `${c.omitted} more line${c.omitted === 1 ? "" : "s"} not shown`) : null);
}

/**
 * The permission block. A command shows whole, then why it asks (HarnessV3-Views V6-9); a change to a file as its file
 * and its diff (HarnessV3-ACP, AC3's drive D5). The question's words are written for clients that draw no card — a
 * command cut at 160 characters, a file by the path the call names, the way to answer in chat — so the block shows
 * them only for another call.
 * Allow and Always allow answer `{ allow: true }`; Deny answers `{ allow: false }` with its words, whatever they say — the
 * press decides, never the words (an "Okay, use pnpm" ran the call it denied, read for a yes).
 * Always allow in this chat (`paused.keeps`, d-allow) stands where the project offers no always-allow for the command:
 * its row says exactly what it keeps — the commands in code, or "this command" where that is the one shown above it or
 * too long for the row, the kept text then its title — and its press keeps them first (`onAlwaysInChat`), then allows.
 * A card handed no `onAlwaysInChat` has no such row: it could keep nothing.
 * @typedef {{ allow: boolean, words: string }} PermissionAnswer
 * @param {any} turn
 * @param {{ onAnswer: (a: PermissionAnswer) => void, onAlways?: (offer: import("../lib/labels.js").Offer) => void,
 *   onAlwaysInChat?: (keeps: import("../lib/labels.js").Keeps) => void }} cb
 * @param {{ h?: typeof h, look?: typeof secondLookView }} [o]  the element maker (a test's fake DOM); `look`: how a
 *   second look is drawn (a test's stand-in)
 */
export function permissionBlock(turn, cb, { h: mk = h, look = secondLookView } = {}) {
  const p = turn.paused || {};
  // A review rule asks (SG-D13): the rule, and the Reviewer's lines on top; no Always allow.
  const review = typeof p.review === "string" && p.review ? reviewWords(p.review) : null;
  /** @type {Change[]} */
  const changes = Array.isArray(p.changes) ? p.changes : [];
  const left = Number(p.changesLeft) || 0;
  const words = p.command || changes.length ? p.reason : p.question;
  // The feedback is Deny's: the words the model reads instead of a bare "no". It shows while Deny is the choice.
  const feedback = mk("textarea", { class: "ix-feedback hidden", rows: "2", placeholder: "Tell the model what to do instead (optional)" });
  const list = choiceList(mk, feedback);
  // The chat's own always-row (d-allow), where the project's does not stand and the card can keep: what it keeps, in
  // the row's words.
  const keeps = cb.onAlwaysInChat && p.keeps?.commands?.length && !p.offer?.shape && !review && !p.always ? /** @type {import("../lib/labels.js").Keeps} */ (p.keeps) : null;
  const kept = keeps ? keepsWords(keeps, p.command) : null;
  // An agent that offers only to always allow it (`always`): Allow grants that, for the rest of its session.
  const options = mk("div", { class: "ix-options", role: "listbox", "aria-label": "Your answer" },
    p.always
      ? list.option("Allow always", "it runs calls like it without asking again this session", () => cb.onAnswer({ allow: true, words: "" }))
      : list.option("Allow", "only this time", () => cb.onAnswer({ allow: true, words: "" })),
    p.offer?.shape && !review && !p.always
      ? list.option("Always allow in this project", offerWords(p.offer), () => {
          cb.onAlways?.(p.offer);
          cb.onAnswer({ allow: true, words: "" });
        })
      : keeps && kept
        ? list.option("Always allow in this chat", inlineMarks(mk, kept.words), () => {
            cb.onAlwaysInChat?.(keeps);
            cb.onAnswer({ allow: true, words: "" });
          }, { title: kept.title })
        : null,
    list.option("Deny", "reject it for now", () => cb.onAnswer({ allow: false, words: feedback.value.trim() }), { words: true }));
  return list.arm(mk("div", { class: `ix-block perm${review ? " is-review" : ""}` },
    mk("div", { class: "ix-head" },
      mk("span", { class: "ix-head-ic", html: ICONS.shieldAlert }),
      "Permission required",
      p.tool ? mk("span", { class: "ix-origin" }, p.tool) : null,
      review ? mk("span", { class: "ix-rule", title: p.review }, "rule: review · ", mk("code", {}, review.pattern), review.shipped ? ` · ${review.shipped}` : null) : null),
    review ? look(p.look, { h: mk }).el : null,
    p.command ? mk("pre", { class: "ix-preview" }, p.command) : null,
    ...changes.map((c) => changeBlock(mk, c)),
    left ? mk("div", { class: "ix-change-more" }, `${left} more file${left === 1 ? "" : "s"} in this change`) : null,
    words ? mk("div", { class: "ix-reason" }, ...inlineMarks(mk, words)) : null,
    p.always && words !== p.question ? mk("div", { class: "ix-reason" }, ALWAYS_ONLY) : null,
    options,
    feedback,
    mk("div", { class: "ix-foot" },
      mk("span", { class: "ix-hint" }, "↑↓ to choose · Enter to confirm"),
      list.confirm)));
}

/**
 * A review rule as its card names it, from `describeRule`'s words — `bash(git push*--force*) review · Second look
 * before risky commands` —: its pattern, and the switch it is one of, where it is.
 * @param {string} said
 */
export function reviewWords(said) {
  const m = /^[^(]*\((.*)\) review(?: · (.+))?$/.exec(said);
  return m ? { pattern: m[1], shipped: m[2] || "" } : { pattern: said, shipped: "" };
}

/**
 * The input-required block, for an ask of kind question. With the model's choices (`paused.options`, TL-D11) they are
 * rows — its recommendation first — and Other… takes the developer's own words; without, a text box. Dismiss leaves
 * the answer to the composer.
 * @param {any} turn @param {{ onAnswer: (text: string) => void }} cb
 * @param {{ h?: typeof h }} [o]  the element maker (a test's fake DOM)
 */
export function inputBlock(turn, cb, { h: mk = h } = {}) {
  const p = turn.paused || {};
  const head = mk("div", { class: "ix-head" }, mk("span", { class: "ix-head-ic ask", html: ICONS.circleHelp }), "Input required");
  const reason = p.question ? mk("div", { class: "ix-reason" }, ...inlineMarks(mk, p.question)) : null;
  const dismiss = mk("button", { class: "ghost sm", type: "button", onclick: () => cb.onAnswer("") }, "Dismiss");
  const choices = Array.isArray(p.options) ? p.options : [];
  if (!choices.length) {
    const answer = mk("textarea", { class: "ix-feedback", rows: "2", placeholder: "Enter your answer..." });
    const submit = mk("button", { class: "primary sm", type: "button" }, "Submit");
    submit.addEventListener("click", () => { const t = answer.value.trim(); if (t) cb.onAnswer(t); });
    return mk("div", { class: "ix-block" }, head, reason, answer, mk("div", { class: "ix-foot" }, dismiss, submit));
  }
  const own = mk("textarea", { class: "ix-feedback hidden", rows: "2", placeholder: "Your answer, in your own words" });
  const list = choiceList(mk, own);
  const rows = mk("div", { class: "ix-options", role: "listbox", "aria-label": "Your answer" },
    ...choices.map((/** @type {any} */ o) => list.option(String(o.label), String(o.description || ""), () => cb.onAnswer(String(o.label)))),
    list.option("Other…", "answer in your own words", () => { const t = own.value.trim(); if (t) cb.onAnswer(t); }, { words: true, button: "Send" }));
  return list.arm(mk("div", { class: "ix-block" }, head, reason, rows, own,
    mk("div", { class: "ix-foot" }, mk("span", { class: "ix-hint" }, "↑↓ to choose · Enter to confirm"), dismiss, list.confirm)));
}

/**
 * The error banner: the one failure card (lib/failure.js), with the chat's ways on. `failure` is the message in its
 * two parts, where a failure in the one shape made it: the cause, then what it had done and what is kept; `detail`
 * what was said under it — a coding agent's own error, the body the server sent — in the card's fold. A turn its
 * coding agent's login refused offers Sign in (`onSignIn`, HarnessV3-ACP AC3-7), handed the banner's one resend for
 * the sign-in to send the turn again with. A send that was stopped to ask how to make room is no failure: the card
 * that asks draws it (`askCard`).
 * @param {string} message
 * @param {{ onRetry?: () => unknown, onDismiss?: () => void, detail?: string, onToast?: (msg: string, kind?: string) => void,
 *   failure?: { head?: string, more?: string } | null, onSignIn?: (resend: () => void) => void }} [cb]
 */
export function errorBanner(message, cb = {}) {
  const copy = (/** @type {string} */ text) => {
    if (!navigator.clipboard) { cb.onToast?.("Copy failed", "err"); return; }
    navigator.clipboard.writeText(text).then(() => cb.onToast?.("Copied"), () => cb.onToast?.("Copy failed", "err"));
  };
  // One resend per banner: "Retry" and a sign-in's Send again send the same text again, so the first spends them
  // both — the sign-in sheet's too, which calls its resend from outside the banner.
  /** @type {HTMLButtonElement[]} */
  const senders = [];
  let spent = false;
  /** A resend the page could not make — its chat's turn still runs, the send refused it before it went (false, or the
   *  words of why) — spends nothing: the buttons stand again. @param {unknown} went */
  const answered = (went) => {
    if (went !== false && typeof went !== "string") return;
    spent = false;
    for (const b of senders) b.disabled = false;
  };
  const once = (/** @type {(() => unknown) | undefined} */ fn) => () => {
    if (spent) return;
    spent = true;
    for (const b of senders) b.disabled = true;
    const went = fn?.();
    if (went instanceof Promise) void went.then(answered, () => answered(false));
    else answered(went);
  };
  const retry = cb.onRetry ? h("button", { class: "ghost sm f-retry", type: "button", onclick: once(cb.onRetry) }, "Retry") : null;
  const signIn = cb.onSignIn ? h("button", { class: "primary sm f-sign-in", type: "button", title: "Sign the agent in, then send the turn again", onclick: () => cb.onSignIn?.(once(cb.onRetry)) }, "Sign in") : null;
  for (const b of [retry, signIn]) if (b) senders.push(/** @type {HTMLButtonElement} */ (b));
  // The words with their icon, then the buttons as one group: under a long message the group wraps whole.
  return failureCard(h, failureWords({ error: message, failure: cb.failure, detail: cb.detail }), {
    acts: [signIn, retry, cb.onDismiss ? h("button", { class: "ghost sm", type: "button", onclick: cb.onDismiss }, "Dismiss") : null].filter(Boolean),
    onCopy: copy,
  });
}

/**
 * What a send was stopped to ask (HarnessV4_Tasks C26), as the server said it. `size`: what will read the session
 * cannot take it under the session's line. `cold`: the cache of what reads it has gone cold, so going on pays for all
 * of it again. `lost`: a coding agent keeps no session of the chat, so a new one starts from Filament's copy.
 * `refused`: the agent refused the copy a new session started from; nothing was compacted and nothing went on.
 * `switched`: the chat's last turn ran on another account or model, so this message starts a new session of it
 * (HarnessV4_Tasks A7; `switch` says from what to what). `summoned`: you brought the card up yourself (`/compaction`,
 * the owner's words of 10-18; the ring's Compact now…, proposal_ux D6), with the chat's figures as the ring shows them;
 * `sends`, a message waits to go once room is made; `midTurn`, a turn of Filament's loop runs, so room is made at its
 * next step.
 * `reads` is what will read the session and from where, `cache` its cache's clock, `tokens` what it would read of
 * `window`, against the session's line (`usable`); `why`, on `size`, is what does not fit, in the server's words, and
 * `carry` the form a switch's fresh session was weighed in — the answer sends it back —, and on `lost` the form the new
 * session carries the turns in (the owner's of 11-06), which the card lets you change; `moved`, on `lost`, the folder the
 * chat moved to (a worktree), where the agent starts its new session; `changes`, on `changed` and on a cold one, what
 * the chat sends ahead of its history that changed since it last sent it, in words.
 * @typedef {{ kind: "size" | "cold" | "lost" | "changed" | "refused" | "switched" | "summoned", why?: string | null, sends?: boolean, midTurn?: boolean,
 *   reads?: { kind: "model" | "agent", name: string, from: "session" | "copy" } | null,
 *   cache?: { state: "warm" | "cold" | "none", idleMs: number, ttlMs: number, leftMs: number } | null,
 *   tokens?: number | null, estimated?: boolean, usable?: number | null, window?: number | null, switch?: SwitchAsk,
 *   carry?: string, moved?: string, changes?: string[] }} Ask
 */

/**
 * A switch as the server asks about it (app/sessions/switch-question.js): each side's name and the model it was sent;
 * `account` where both are logins of the same agent, `sameModel` and the model stayed; `resumes` where the new side
 * still has its session of the chat and goes on in it, handed the turns it missed; `compacted` where the copy starts
 * from a compaction's summary; `suggested` the form a message sent past the card carries, `session` the session's own
 * (`context.carry`); `window`/`usable` the new side's window and line; `own` what that agent's own prompt and tools
 * take, where a turn measured it. `handoff`: what the model that answered last can write first — Filament's summary by
 * the loop's model (`summary`), or written by a coding agent in its session (`self`) —, by whom, and its cache's clock.
 * `loop`: the new side is a model Filament calls, which reads the copy as composed (`held` its weight), so the card
 * offers Send as it is and the handoff, `suggested` naming one ("send", "handoff"); `fromAgent` where a coding agent
 * answered last.
 * @typedef {{ way: "summary" | "self", by: string, cache: { state: "warm" | "cold" | "none", idleMs: number, ttlMs: number, leftMs: number } | null }} Handoff
 * @typedef {{ from: { upstream: string, name: string, model: string | null }, to: { upstream: string, name: string, model: string | null },
 *   account: boolean, sameModel: boolean, resumes?: boolean, compacted: boolean, suggested: string, session: string,
 *   window: number | null, usable: number | null, own: number | null, handoff?: Handoff | null, loop?: boolean,
 *   fromAgent?: boolean, answeredBefore?: boolean, held?: number | null }} SwitchAsk
 */

/**
 * The question a turn was stopped with: from its refusal's body (`switchQuestion`, `resumeQuestion`,
 * `needsCompaction`), or — a seed its agent refused while the session asks first — from its facts (`needsRoom`). Null:
 * the turn asks nothing.
 * @param {any} errorBody @param {any} facts
 * @returns {Ask | null}
 */
export function askOf(errorBody, facts) {
  const s = errorBody?.switchQuestion;
  if (s) return { kind: "switched", switch: s, usable: s.usable ?? null, window: s.window ?? null };
  const q = errorBody?.resumeQuestion;
  if (q) return { kind: q.why === "lost" ? "lost" : q.why === "changed" ? "changed" : "cold", reads: q.reads || null, cache: q.cache || null, tokens: q.held ?? null, estimated: !!q.estimated, usable: q.usable ?? null, window: q.window ?? null, ...(q.moved ? { moved: String(q.moved) } : {}), ...(q.why === "lost" && q.carry ? { carry: String(q.carry) } : {}), ...(Array.isArray(q.changes) && q.changes.length ? { changes: q.changes.map(String) } : {}) };
  if (errorBody?.needsCompaction)
    return { kind: "size", why: errorBody.why || null, reads: errorBody.reads || null, cache: errorBody.cache || null, tokens: errorBody.sentTokens ?? null, estimated: errorBody.estimated !== false, usable: errorBody.usable ?? null, window: errorBody.window ?? null, ...(errorBody.carry ? { carry: String(errorBody.carry) } : {}) };
  return facts?.needsRoom ? { kind: "refused" } : null;
}

/**
 * The page's turns as a way on sends a turn's message again (the card's answers, Retry, a waiting row's own send): a
 * message stopped to ask is on no record, nor is one that waited for the chat, or was withdrawn while it waited
 * (history.js `unsent`, `stoppedToAsk`), so its row goes, and the turn sent now stands in its place — one message, with no card or
 * waiting row left behind, as a reload shows it. A turn on record (a seed its agent refused, a failure) stays. Null where nothing goes.
 * @param {any[]} turns @param {any} turn
 * @returns {any[] | null}
 */
export function withoutAsked(turns, turn) {
  return turn && unsent(turn) && turns.includes(turn) ? turns.filter((t) => t !== turn) : null;
}

/**
 * The card's facts, each a short line: what will read the session and from where, how much of which window against
 * the line, and its cache — warm with the time left, cold with how long it sat and how long the cache lasts, or none
 * where the model's replies cached nothing. A switch's (HarnessV4_Tasks A7): the new side's window and line, and what
 * its agent's own prompt and tools take. A fact the server did not say is left out.
 * @param {Ask} ask
 * @returns {string[]}
 */
export function askFacts(ask) {
  const out = [];
  const s = ask.switch;
  if (s) {
    if (ask.window) out.push(`${s.to.name}'s window: ${fmt.n(ask.window)} tokens${ask.usable ? ` · the line is at ${fmt.n(ask.usable)}` : ""}`);
    if (s.own && !s.resumes) out.push(`Its own prompt and tools take ≈${fmt.n(s.own)}`);
    return out;
  }
  const r = ask.reads;
  if (r) out.push(r.kind !== "agent" ? `Read by ${r.name}` : r.from === "session" ? `Read by ${r.name}, in its own session` : `Read by ${r.name}, in a new session started from Filament's copy`);
  if (ask.tokens != null && ask.window) out.push(`${ask.estimated ? "≈" : ""}${fmt.n(ask.tokens)} of ${fmt.n(ask.window)} tokens${ask.usable ? ` · the line is at ${fmt.n(ask.usable)}` : ""}`);
  const c = ask.cache;
  if (c?.state === "warm") out.push(`Cache warm · ${spanWords(c.leftMs)} left`);
  else if (c?.state === "cold") out.push(`Cache cold · idle ${spanWords(c.idleMs)}, it lasts ${spanWords(c.ttlMs)}`);
  else if (c?.state === "none") out.push("No cache · its replies cached nothing");
  return out;
}

/**
 * A way to make room as the card offers it (widgets/compaction.js `askChoices`).
 * @typedef {import("../widgets/compaction.js").WayChoice} WayChoice
 */

/**
 * What the card lists: the ways; `writable` where a side model can be picked for this once (`writer`: the side model
 * that writes now, "" where none can); `same`: the chat's own model, which writes the same model's summary;
 * `agentName`: the coding agent the session runs on, where it runs on one — the card's sentence names it.
 * @typedef {{ ways: WayChoice[], writable?: boolean, writer?: string, same?: string, agentName?: string }} AskOptions
 */

/**
 * A Compact and send under way, as the card keeps it (HarnessV4_Tasks U11): what it comes to — false, or the words of
 * why it could not go, gives the card back — and the card's sentence while it runs. The page keeps it with its turn,
 * so a card drawn again meanwhile (a chat switched away from and back) shows it running.
 * @typedef {{ done: Promise<unknown>, words: string }} AskWork
 */

/**
 * Who makes room by a way, and what it does, as the card says it (HarnessV4_Tasks U11): "Claude Code" · "compact the
 * chat" · "is compacting the chat". A summary Filament has written — the same model's or a side model's, the session's
 * own `summary` — is its writer's, by the model's name; in a coding agent's session the agent then starts a fresh
 * session from what Filament's way leaves. The instant fold, which calls no model, is Filament's.
 * @param {string | null | undefined} id
 * @param {{ agentName?: string, agent?: boolean, writer?: string }} [o]
 * @returns {{ who: string, does: string, doing: string }}
 */
export function wayDoes(id, { agentName = "The agent", agent = false, writer = "" } = {}) {
  const by = writer ? prettyModel(writer) : "Filament";
  const fresh = agent ? ` for a fresh ${agentName} session` : "";
  if (id === "way:own") return { who: agentName, does: "compact the chat", doing: "is compacting the chat" };
  if (id === "way:self") return { who: agentName, does: "write a summary and start fresh from it", doing: "is writing a summary of the chat" };
  if (id === "same" || id === "side" || id === "summary") return { who: by, does: `summarize everything${fresh}`, doing: `is summarizing everything${fresh}` };
  if (id === "fold") return { who: "Filament", does: `fold the tool calls away, one line each${fresh}`, doing: `is folding the tool calls away${fresh}` };
  return { who: "Filament", does: "make room", doing: "is making room" };
}

/** The form a lost session's fresh one carries the turns in, in its words; null where none was named. @param {Ask} ask */
const carriedForm = (ask) => (ask.kind === "lost" && ask.carry ? CARRY_WORDS.find((x) => x.id === ask.carry) || null : null);

/**
 * Why the card asks, in one plain clause, from the server's figures (HarnessV4_Tasks U11): the chat past the line and
 * by how much; a fresh agent session's copy past it; no room left for a reply; a cold cache and what going on reads
 * again; a session the agent no longer keeps. Null where the figures did not come, and for a seed its agent refused —
 * the server's own words say those.
 * @param {Ask} ask
 * @returns {string | null}
 */
export function askReason(ask) {
  const held = ask.tokens != null ? `${ask.estimated ? "≈" : ""}${tok(ask.tokens)}` : "";
  const name = ask.reads?.name || "";
  if (ask.kind === "size") {
    if (ask.tokens == null) return null;
    if (ask.usable && ask.tokens < ask.usable) return ask.window ? `This chat leaves no room for a reply in its ${tok(ask.window)} window` : null;
    const line = ask.usable ? `your ${tok(ask.usable)} line` : "your line";
    if (ask.reads?.kind === "agent" && ask.reads.from === "copy") return `${name || "The agent"} starts fresh from Filament's copy of the chat, and the copy is past ${line} (${held})`;
    return `This chat is past ${line} (${held})`;
  }
  const changed = ask.changes?.length ? ask.changes.join("; ") : "";
  if (ask.kind === "cold") {
    const idle = Number(ask.cache?.idleMs) > 0 ? ` ${spanWords(Number(ask.cache?.idleMs))}` : "";
    return `This chat sat idle${idle} and ${name || "the model"}'s cache has gone cold, so going on reads ${held ? `all ${held}` : "all of it"} again at full price${changed ? ` — and what it sends ahead of its history changed: ${changed}` : ""}`;
  }
  // What the chat sends ahead of its history changed (Filament updated, an MCP server, a tool switched): a coding
  // agent's session that goes on can keep what it already loaded in its old form; the loop writes the whole history to
  // its cache again.
  if (ask.kind === "changed") {
    const what = changed || "Filament's words or tools";
    return ask.reads?.kind === "agent"
      ? `What ${name || "the agent"} is given ahead of this chat changed — ${what} — and in the session it goes on in, what it already loaded can keep its old form`
      : `What this chat sends ahead of its history changed — ${what} — so going on writes ${held ? `all ${held}` : "all of it"} to ${name || "the model"}'s cache again`;
  }
  if (ask.kind === "lost") {
    const form = carriedForm(ask);
    const copy = `Filament's copy${form ? ` as ${form.name}` : ""}${held ? ` (${held})` : ""}, with nothing cached`;
    return ask.moved ? `This chat moved to ${ask.moved}, so ${name || "the agent"} starts a new session there from ${copy}` : `${name || "The agent"} no longer has a session of this chat, so it starts a new one from ${copy}`;
  }
  // Brought up by you (`/compaction`): what the chat holds, against its line.
  if (ask.kind === "summoned") {
    if (!held) return "This chat's size is not counted yet";
    return ask.usable ? `This chat holds ${held} of your ${tok(ask.usable)} line` : ask.window ? `This chat holds ${held} of its ${tok(ask.window)} window` : `This chat holds ${held}`;
  }
  return null;
}

/**
 * The card's one sentence (HarnessV4_Tasks U11): why it asks, then what its main answer does — "This chat is past
 * your 400K line (408K), so Claude Code will compact the chat before your message goes." A cold cache or a lost
 * session asks the server's question with the way in it. Before the ways come, room is made by the session's own way;
 * where the figures did not come, the server's words of what does not fit — and for a seed its agent refused, the
 * failure's — stand alone.
 * @param {Ask} ask @param {{ who: string, does: string } | null} way  what Compact and send does now
 * @param {string} message
 */
export function askSentence(ask, way, message) {
  const reason = ask.kind === "refused" ? null : askReason(ask);
  if (!reason) return ask.why || message;
  if (ask.kind === "cold" || ask.kind === "lost" || ask.kind === "changed") return `${reason}. Send it as it is, or ${way ? `let ${way.who} ${way.does} first` : "make room first"}?`;
  if (ask.kind === "summoned" && ask.midTurn) return `${reason}. The turn is running: at its next step its older rounds fold into one summary, the newest stay whole.`;
  if (ask.kind === "summoned") return `${reason}. ${way ? `${way.who} will ${way.does}` : "Room is made"}${ask.sends ? " before your message goes" : ""}.`;
  return `${reason}, so ${way ? `${way.who} will ${way.does}` : "room is made"} before your message goes.`;
}

/**
 * The flag under a turn stopped to ask (HarnessV4_Tasks U11; it said "not sent", in the warning's yellow): what its
 * message waits for — room, or the person's answer to the card above.
 * @param {Ask} ask
 */
export const askFlag = (ask) => (ask.kind === "size" || ask.kind === "refused" ? "waits for room" : "waits for your answer");

/** The sentence on a card whose Compact and send runs; `sends`, a message waits for it. @param {{ who: string, doing: string } | null} way @param {boolean} [sends] */
const workWords = (way, sends = true) => `Making room${way ? `: ${way.who} ${way.doing}` : ""}.${sends ? " Your message goes when it's done." : ""}`;

/**
 * The card's title, the question it asks (proposal_ux §4.12 step 3): before a message that waits, or — brought up by
 * you with none — now, or while a turn runs.
 * @param {Ask} ask
 */
export function askTitle(ask) {
  if (ask.kind === "changed") return "Update the session before this message?";
  if (ask.kind !== "summoned" || ask.sends) return "Make room before this message?";
  return ask.midTurn ? "Make room while the turn runs?" : "Make room now?";
}

/**
 * The card's question in a line, as the left bar's Now says it while the card waits (the owner's of 11-01): a switch's
 * is its Switch and send, any other's its title. @param {Ask} ask
 */
export const askQuestion = (ask) => (ask.kind === "switched" ? "Switch and send?" : askTitle(ask));

/** Whether what the chat holds is at its line or past it, where both are counted. @param {Ask} ask */
const pastLine = (ask) => ask.tokens != null && ask.usable != null && ask.tokens >= ask.usable;

/**
 * What sending as it is does, on its row: a cold cache read again at full price, a lost session started from all of
 * Filament's copy, or — the message you held on a card you brought up — the message going now with nothing compacted,
 * the agent's or the loop's own making room left to the turn; past the line, the chat still makes room before it goes,
 * or asks again where it asks before making room (`context.compaction.mode`).
 * @param {Ask} ask @param {string} agentName  "" for Filament's loop
 */
export function asIsLine(ask, agentName) {
  if (ask.kind === "cold") return "Going on reads all of it again, at full price.";
  if (ask.kind === "lost") {
    // The form it carries, said — "all of Filament's copy" was said of a Words copy that left every tool's output out.
    const form = carriedForm(ask);
    return form ? `${agentName || "The agent"} starts its new session from Filament's copy as ${form.name}: ${form.line}.` : `${agentName || "The agent"} starts its new session from all of Filament's copy.`;
  }
  if (ask.kind === "changed") return agentName ? `${agentName} goes on in its session; what it already loaded there can keep its old form.` : "Going on writes all of it to the cache again, at a write's price.";
  if (pastLine(ask)) return "Past your line, the chat still makes room its own way before your message goes — or asks again, where it asks first.";
  return `Your message goes now, nothing compacted — ${agentName ? `${agentName} may compact by itself mid-turn` : "the turn makes room at your line by itself"}.`;
}

/** The id of Send it as it is among the ways. */
const SEND = "send";

/**
 * The card that asks before a message is sent (HarnessV4_Tasks C26), in place of the error banner on a turn the server
 * stopped to ask — a question in the compaction's colour, not a failure. Laid out as proposal_ux §4.12 step 3 draws it
 * (phase 3): its question and one sentence — why it asks and what the chosen way does (`askSentence`) —, then the ways
 * themselves, each a choice with what it does and costs, its tag (Recommended, Costly), and on its right what it
 * leaves and how long it takes: Send it as it is first where the cache has gone cold or the session is lost (the
 * owner's rules of 10-31), then the main ones in the order they came (`WayChoice.main`: the agent's own, then the
 * three kinds — the same model, a side model, the instant fold), Send it as it is after them where you held the
 * message, then the rest under More ways with the way to stop being asked. Under the ways, for this compaction only,
 * the side model that writes its summary (`writerPicker`) — nothing is written to the session. At its foot what the
 * card knows (`askFacts`), Not now, and the one act: Compact and send, Compact, or Send, by the way chosen. Pressed, the card turns into its own progress: who makes room, then the compaction's steps,
 * clock and bar as the Compacting row says them (`watch`), with its Stop; one that went leaves the card to the message
 * sent again, one that could not gives the card back, with why on it. Brought up by you (`/compaction`, Compact now…:
 * `summoned`), it has no way to stop being asked; while a turn runs (`midTurn`) its one act folds that turn's older
 * rounds at its next step. A lost session's card lists, under its sentence, the forms its new session can carry the
 * turns in, each weighed (`carryOptions`, `carryChoices`; the owner's of 11-06): the server's own marked, and one picked
 * goes with the answer — Send it as it is, or Compact and send (`carry`) — while the sentence, the Send row and the
 * facts weigh it.
 * @param {string} message
 * @param {Ask} ask
 * @param {{ options?: (once: { model?: string } | null) => Promise<AskOptions | null>,
 *   writerPicker?: (onPick: (name: string) => void) => { el: HTMLElement, set: (name: string) => void } | null,
 *   carryOptions?: () => Promise<{ ways: CarryChoice[] } | null>,
 *   onCompact?: (choice: string | null, once: { model?: string } | null, carry?: string) => unknown,
 *   onSendAsIs?: (carry?: string) => unknown, onNeverAsk?: (carry?: string) => unknown, onDismiss?: () => void,
 *   watch?: (paint: (p: import("./compacting.js").CompactionProgress | null, o?: { onStop?: (() => any) | null, stopTitle?: string }) => void) => () => void,
 *   pending?: AskWork | null, onWorking?: (w: AskWork) => void }} [cb]  an answer that resolves false, or to the words of
 *   why it could not go, gives the card back; `pending`, a Compact and send of this turn's still running
 */
export function askCard(message, ask, cb = {}) {
  const cold = ask.kind === "cold" || ask.kind === "lost";
  // What the chat sends ahead changed: a compaction is recommended, Send it as it is after the ways.
  const changed = ask.kind === "changed";
  // Brought up by you: its act sends only where a message waits, and it asks nothing to stop.
  const summoned = ask.kind === "summoned";
  const sends = !summoned || !!ask.sends;
  const midTurn = summoned && !!ask.midTurn;
  // Send it as it is: where the message could go so — a cold cache, a lost session, what it sends ahead changed, a
  // message you held.
  const canSend = !!cb.onSendAsIs && (cold || changed || (summoned && sends));
  // With the ways listed it is one of them; with none to list, a button beside the act.
  const listed = !!cb.options && !midTurn;
  /** @type {AskOptions | null} */
  let opts = null;
  /** The way chosen: an id of the ways, SEND, or null — the session's own way, before the ways come. @type {string | null} */
  let chosen = null;
  /** Whether the person picked a way, so a reweigh never moves their pick. */
  let picked = false;
  /** The ways the card shows first, kept as they came so a pick never moves a row. @type {Set<string>} */
  const first = new Set();
  /** The side model chosen on the card. @type {{ model: string | null }} */
  const once = { model: null };
  const onceNow = () => (once.model == null ? null : { model: once.model });
  // A lost session's new one carries the turns in a form: the card weighs each, the server's own chosen first.
  const carries = ask.kind === "lost" && !!cb.carryOptions;
  /** The form the new session carries: the server's, until one is picked. @type {string | null} */
  let carry = ask.kind === "lost" ? ask.carry || null : null;
  /** @type {CarryChoice[]} */
  let forms = [];
  /** The question as the form picked weighs it: the sentence, the Send row and the facts say that form's size. @returns {Ask} */
  const askNow = () => (!carry || carry === ask.carry ? ask : { ...ask, carry, tokens: forms.find((x) => x.id === carry)?.tokens ?? null });
  /** The form picked, where it is not the server's own: Send it as it is sends it, so the server's own keeps its why. */
  const carryOut = () => (carry && carry !== ask.carry ? carry : undefined);
  /** What the act does now, in the card's words — a side model's reading that is the instant fold, the fold's; null
   *  before the ways come and for Send. */
  const wayNow = () => {
    if (!chosen || chosen === SEND) return null;
    const o = opts?.ways.find((x) => x.id === chosen);
    const writer = chosen === "same" ? opts?.same ?? "" : once.model ?? opts?.writer ?? "";
    return wayDoes(o?.folds ? "fold" : chosen, { agentName: opts?.agentName || "The agent", agent: !!opts?.agentName, writer });
  };
  const msg = h("span", { class: "ix-error-msg" });
  /** Why the last answer could not go, on the card it gave back. */
  const note = h("span", { class: "ix-ask-note hidden" });
  /** A compaction under way: its steps, clock and bar, with its Stop. */
  const work = h("div", { class: "ix-ask-work hidden" });
  /** @type {HTMLButtonElement[]} */
  const answers = [];
  let spent = false;
  let running = false;
  /**
   * An answer: pressed once, every answer waits; `works`, it makes room first and the card shows it running.
   * @param {() => unknown} fn @param {boolean} works
   */
  const go = (fn, works) => {
    if (spent) return;
    spent = true;
    for (const x of answers) x.disabled = true;
    note.classList.add("hidden");
    const done = Promise.resolve(fn());
    if (works) {
      /** @type {AskWork} */
      const w = { done, words: workWords(wayNow(), sends) };
      cb.onWorking?.(w);
      run(w);
      return;
    }
    // An answer that could not go (a turn running, its setting not written) gives the card back, said where it
    // failed; one that went takes the card with its row (`withoutAsked`).
    void done.then((went) => { if (went === false || typeof went === "string") back(went); }, () => back(false));
  };
  /** @param {string} cls @param {string} label @param {string} title @param {() => void} onclick */
  const button = (cls, label, title, onclick) => {
    const b = /** @type {HTMLButtonElement} */ (h("button", { class: cls, type: "button", title, onclick: () => { if (!b.disabled) onclick(); } }, label));
    answers.push(b);
    return b;
  };
  // Compact and send sends the form the card shows, the server's own too: once Filament has made room the session
  // starts from its compaction, no longer a lost one, and would carry the chat's own form (the review of 8bcb358fc).
  const compactNow = () => cb.onCompact?.(chosen, chosen && !/^way:/.test(chosen) ? onceNow() : null, carry || undefined);
  const sendNow = () => cb.onSendAsIs?.(carryOut());
  /** The way Compact takes where none is picked: the recommended, else the first that can run, a fold past the instant
   *  line never (`over`). */
  const compactWay = () => {
    const open = (opts?.ways || []).filter((o) => !o.disabled);
    return (open.find((o) => o.recommended) || open.find((o) => !o.over))?.id || null;
  };
  // The one act, by the way chosen.
  const act = cb.onCompact
    ? button("primary sm ix-ask-act", "", "", () => {
        if (chosen === SEND && cb.onSendAsIs) go(sendNow, false);
        else if (cb.onCompact) go(compactNow, true);
      })
    : null;
  const asIs = canSend && !listed && cb.onSendAsIs ? button("ghost sm", "Send as it is", "Send your message now, the chat as it stands", () => go(sendNow, false)) : null;
  const never = summoned || !cb.onNeverAsk
    ? null
    : changed
      ? button("ghost sm", "Just send from now on", "From now on this chat sends as it is when what it sends ahead of its history changed, without asking — this message first. Switch it back: How earlier turns are kept › After an update", () => cb.onNeverAsk && go(cb.onNeverAsk, false))
    : cold
      ? button("ghost sm", "Just send from now on", "From now on this chat sends as it is when its cache has gone cold, without asking — this message first. Switch it back: How earlier turns are kept › Back after a break", () => cb.onNeverAsk && go(() => cb.onNeverAsk?.(carryOut()), false))
      : button("ghost sm", "Just do it from now on", "From now on this chat makes room by itself when it is full, and sends — this message first. Switch it back: How earlier turns are kept › Then", () => cb.onNeverAsk && go(cb.onNeverAsk, false));
  // A message not sent goes back to the box with its files — one the card stopped (the owner's of 11-01: "it should
  // return back into composer with everything"), one you held; a turn on record (a seed its agent refused) stays, the
  // card closed.
  const notNow = cb.onDismiss ? button("ghost sm", "Not now", ask.kind !== "refused" && sends ? "Close the card: your message goes back to the box" : "Close the card", () => cb.onDismiss?.()) : null;
  const closeX = cb.onDismiss ? h("button", { class: "ghost icon ix-ask-x", type: "button", "aria-label": "Not now", html: ICONS.x, onclick: () => { if (!spent) cb.onDismiss?.(); } }) : null;
  /** The act's words and whether it can go, by the way chosen. */
  const paintAct = () => {
    if (!act) return;
    act.textContent = chosen === SEND ? "Send" : midTurn ? "Compact at its next step" : sends ? "Compact and send" : "Compact";
    act.setAttribute("title", chosen === SEND ? "Send your message now, the chat as it stands" : midTurn ? "The turn folds its older rounds into one summary at its next step" : sends ? "Make room the way chosen, then send your message" : "Make room the way chosen");
    const ways = opts?.ways || [];
    // With ways listed and none that can run now, there is nothing to compact by: each listed way says why.
    if (!spent) act.disabled = chosen !== SEND && ways.length > 0 && !ways.some((o) => !o.disabled && o.id === chosen);
  };

  const waysEl = h("div", { class: "ix-choices ix-ask-ways", role: "radiogroup", "aria-label": "How to make room" });
  const restEl = h("div", { class: "ix-choices ix-ask-ways" });
  const picker = cb.writerPicker && !midTurn
    ? cb.writerPicker((name) => {
        if (!name || name === (once.model ?? opts?.writer ?? "")) return;
        once.model = name;
        load();
      })
    : null;
  /** The ways the side model picked here serves. */
  const writerFor = h("span", { class: "ix-ask-hint" });
  const writerRow = h("label", { class: "ix-ask-field hidden" }, "Side model", picker ? picker.el : null, writerFor);
  const onceEl = h("div", { class: "ix-ask-once hidden", title: "For this compaction only: nothing is saved to the chat's settings" },
    h("div", { class: "ix-ask-head" }, h("span", { class: "ix-ask-lead" }, "For this compaction only"), h("span", { class: "ix-ask-hint" }, "nothing is saved to the chat's settings")),
    writerRow);
  const moreEl = h("div", { class: "ix-ask-more hidden" }, restEl, never ? h("div", { class: "ix-ask-never" }, h("span", { class: "ix-ask-hint" }, "Or stop being asked:"), never) : null);
  let shown = false;
  const more = h("button", {
    class: "ghost sm ix-ask-toggle hidden", type: "button", "aria-expanded": "false",
    onclick: () => {
      if (running) return;
      shown = !shown;
      more.setAttribute("aria-expanded", shown ? "true" : "false");
      moreEl.classList.toggle("hidden", !shown);
    },
  });
  const factsEl = h("span", { class: "ix-ask-facts" });
  const paintFacts = () => factsEl.replaceChildren(...askFacts(askNow()).map((f) => h("span", { class: "ix-ask-fact" }, f)));
  const acts = h("span", { class: "ix-error-acts" }, asIs, notNow, act);
  const foot = h("div", { class: "ix-ask-foot" }, factsEl, acts);
  const formsEl = h("div", { class: "ix-choices", role: "radiogroup", "aria-label": "What the new session carries" });
  const carryEl = h("div", { class: "ix-ask-carry hidden" }, h("span", { class: "ix-ask-lead" }, "The new session carries the turns as"), formsEl);
  /** The forms, each with what it weighs; the server's own tagged Default. */
  const paintForms = () => {
    carryEl.classList.toggle("hidden", !forms.length);
    formsEl.replaceChildren(...forms.map((o) => h("button", {
      class: `ix-choice${o.id === carry ? " is-on" : ""}`,
      type: "button",
      role: "radio",
      "aria-checked": o.id === carry ? "true" : "false",
      ...(o.title ? { title: o.title } : {}),
      onclick: () => {
        if (spent || o.id === carry) return;
        carry = o.id;
        // A form past the line has room made before the message goes: Compact leads (the hunt of carry-card).
        if (!o.fits && chosen === SEND) chosen = compactWay() || SEND;
        paint();
      },
    }, h("b", {}, o.label), o.sub ? h("span", {}, o.sub) : null, o.recommended ? h("span", { class: "ix-choice-tag" }, "Default") : null)));
  };
  const say = () => {
    const a = askNow();
    msg.textContent = chosen === SEND ? `${askReason(a) || message}. ${summoned && pastLine(a) ? asIsLine(a, "") : "Your message goes now, as it is."}` : askSentence(a, wayNow(), message);
  };
  /** Pick a way. @param {string} id */
  const pick = (id) => {
    if (spent) return;
    chosen = id;
    picked = true;
    paint();
  };
  /** A way as a row: a choice, its name and what it does — or why it cannot run now — and what it costs; on its right
   *  what it leaves and how long it takes. @param {WayChoice} o */
  const wayRow = (o) => h("button", {
    class: `ix-choice ix-way${o.id === chosen ? " is-on" : ""}${o.disabled ? " is-off" : ""}`,
    type: "button",
    role: "radio",
    "aria-checked": o.id === chosen ? "true" : "false",
    ...(o.disabled ? { "aria-disabled": "true" } : {}),
    ...(o.sub ? { title: o.sub } : {}),
    onclick: () => { if (!o.disabled) pick(o.id); },
  },
    h("span", { class: "ix-way-dot", "aria-hidden": "true" }),
    h("span", { class: "ix-way-text" },
      h("b", {}, o.label, o.tag ? h("span", { class: `ix-choice-tag${o.tag === "Costly" ? " is-costly" : ""}` }, o.tag) : null),
      o.title ? h("span", { class: "ix-way-line" }, o.disabled ? `Can't run now. ${o.title.replace(/^./, (c) => c.toUpperCase())}` : o.title) : null,
      !o.disabled && (o.note || o.cost) ? h("span", { class: "ix-way-sub" }, [o.note, o.cost].filter(Boolean).join(" · ")) : null),
    !o.disabled && (o.after || o.pace) ? h("span", { class: "ix-way-fig" }, o.after ? h("span", {}, o.after) : null, o.pace ? h("span", {}, o.pace) : null) : null);
  /** Send it as it is, as a way: what it does, and what the chat holds — in the form picked, on a lost session's. */
  const sendRow = () => {
    const a = askNow();
    return h("button", {
      class: `ix-choice ix-way ix-way-send${chosen === SEND ? " is-on" : ""}`,
      type: "button",
      role: "radio",
      "aria-checked": chosen === SEND ? "true" : "false",
      onclick: () => pick(SEND),
    },
      h("span", { class: "ix-way-dot", "aria-hidden": "true" }),
      h("span", { class: "ix-way-text" }, h("b", {}, "Send it as it is"), h("span", { class: "ix-way-line" }, asIsLine(a, opts?.agentName || ""))),
      a.tokens != null ? h("span", { class: "ix-way-fig" }, h("span", {}, `${a.estimated ? "≈" : ""}${tok(a.tokens)}`)) : null);
  };
  /** Ways by name, quoted, as a sentence says them: “A”, “B” and “C”. @param {WayChoice[]} list */
  const namesOf = (list) => {
    const q = list.map((o) => `“${o.label}”`);
    return q.length > 1 ? `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}` : q[0] || "";
  };
  const paint = () => {
    const ways = opts?.ways || [];
    const send = listed && canSend ? [sendRow()] : [];
    // Send it as it is leads where going on reads it all again (a cold cache, a lost session); after the ways where you
    // held the message.
    const firstWays = ways.filter((o) => first.has(o.id)).map(wayRow);
    waysEl.replaceChildren(...(cold ? [...send, ...firstWays] : [...firstWays, ...send]));
    const rest = ways.filter((o) => !first.has(o.id));
    restEl.replaceChildren(...rest.map(wayRow));
    restEl.classList.toggle("hidden", !rest.length);
    more.textContent = rest.length ? `More ways (${rest.length})` : "More";
    more.classList.toggle("hidden", !rest.length && !never);
    // The side model stands whatever way is chosen, naming the ways it serves; one picked can make a summary possible
    // that no model could write.
    const written = ways.filter((o) => o.writes);
    const writes = !!opts?.writable && !!picker && written.length > 0;
    writerFor.textContent = `for ${namesOf(written)}`;
    writerRow.classList.toggle("hidden", !writes);
    onceEl.classList.toggle("hidden", !writes);
    paintForms();
    paintFacts();
    paintAct();
    if (!spent) say();
  };
  /** The card back from an answer that could not go: its ways, its answers, and why. @param {unknown} went */
  const back = (went) => {
    spent = false;
    running = false;
    el.classList.remove("is-running");
    for (const x of answers) x.disabled = false;
    const why = typeof went === "string" ? went : "";
    note.textContent = why;
    note.classList.toggle("hidden", !why);
    paint();
  };
  /** A compaction under way: the card says who makes room, then the compaction's steps, clock and bar with its Stop,
   *  until it comes to something — the message on its way, or the card back with why. @param {AskWork} w */
  const run = (w) => {
    spent = true;
    running = true;
    el.classList.add("is-running");
    for (const x of answers) x.disabled = true;
    note.classList.add("hidden");
    msg.textContent = w.words;
    const row = compactingRow({ bar: true });
    work.replaceChildren(row.el);
    work.classList.remove("hidden");
    /** @type {(() => void) | null} */
    let unwatch = cb.watch?.((p, o) => { if (p) row.set(p, o); }) || null;
    /** @type {any} */
    let timer = null;
    const quit = () => {
      clearInterval(timer);
      unwatch?.();
      unwatch = null;
    };
    // The clock moves between the server's words; a card the page drew away stops watching.
    timer = setInterval(() => (el.isConnected ? row.tick() : quit()), 1000);
    timer?.unref?.();
    void w.done.then((went) => {
      quit();
      work.classList.add("hidden");
      if (went === false || typeof went === "string") return back(went);
      msg.textContent = sends ? "Room made. Your message is on its way." : "Room made.";
    }, () => {
      quit();
      work.classList.add("hidden");
      back(false);
    });
  };
  let asked = 0;
  /** The ways, weighed with the card's choices; a later answer wins over an earlier one still on its way. */
  function load() {
    if (!listed || !cb.options) return;
    const mine = ++asked;
    cb.options(onceNow()).then((r) => {
      if (mine !== asked || !r) return;
      opts = r;
      const open = r.ways.filter((o) => !o.disabled);
      // Chosen first: the recommended way; else the first that can run, a fold past the instant line never (`over`: the
      // person's to pick); with none, Send it as it is where the card offers it. A pick of the person's stays.
      if (!picked || (chosen !== SEND && !open.some((o) => o.id === chosen)))
        chosen = compactWay() || (canSend ? SEND : null);
      // The card's first ways (§4.12): the main ones that can run and the one chosen; with none that can run, every
      // main one, each with why. Kept as they came.
      for (const o of r.ways) if ((o.main && !o.disabled) || o.recommended || o.id === chosen) first.add(o.id);
      if (!open.length) for (const o of r.ways) if (o.main) first.add(o.id);
      if (picker && once.model == null && r.writer) picker.set(r.writer);
      paint();
    }).catch(() => {});
  }
  const el = h("div", { class: "ix-error ix-resume ix-ask" },
    h("div", { class: "ix-ask-top" },
      h("span", { class: "ix-ask-tile", html: ICONS.foldVertical }),
      h("span", { class: "ix-ask-title" }, askTitle(ask)),
      closeX),
    h("span", { class: "ix-error-words" }, msg, note),
    carries ? carryEl : null,
    listed ? waysEl : null,
    listed ? onceEl : null,
    listed || never ? h("div", { class: "ix-ask-morebar" }, more) : null,
    moreEl,
    work,
    foot);
  paint();
  load();
  if (carries)
    cb.carryOptions?.().then((r) => {
      if (!r) return;
      forms = r.ways;
      if (!carry) carry = (forms.find((o) => o.recommended) || forms[0])?.id || null;
      paint();
    }).catch(() => {});
  if (cb.pending) run(cb.pending);
  return el;
}

/** The forms a switch's card lists, fullest first. */
const SWITCH_FORMS = ["plain", "fold+2", "fold", "words"];

/**
 * A form a switch's card offers: its name, what it weighs and what it is, the one chosen first, and — past the new
 * side's line — why room is made first.
 * @typedef {{ id: string, label: string, sub: string, recommended: boolean, disabled: boolean, title: string }} SwitchChoice
 */

/** What a switch's card lists: the forms, and the answer shown first. @typedef {{ ways: SwitchChoice[], suggest?: "send" | "compact" }} SwitchOptions */

/**
 * A form a lost session's card offers its new session: as a switch's, with what the request weighs in it (`tokens`,
 * null where the preview did not weigh it) and whether that fits under the line.
 * @typedef {SwitchChoice & { tokens: number | null, fits: boolean }} CarryChoice
 */

/**
 * What a lost session's card lists (the owner's of 11-06: a moved chat's card weighed its copy as Words, 4.5K, and
 * called it "all of Filament's copy"): each form the new session can carry the turns in, fullest first, with what the
 * request weighs in it — the preview's sweep, the history and what rides beside it (`forms[form].whole`) — and, past the
 * line, that room is made first; the form the server carries (`ask.carry`, else Whole) marked as the default.
 * @param {any} pv  the session's compose preview @param {Ask} ask
 * @returns {{ ways: CarryChoice[] }}
 */
export function carryChoices(pv, ask) {
  const sweep = pv?.forms || {};
  const first = ask.carry && SWITCH_FORMS.includes(ask.carry) ? ask.carry : "plain";
  /** @param {any} f */
  const wholeOf = (f) => (Number(f?.whole) > 0 ? Number(f.whole) : Number(f?.tokens) > 0 ? Number(f.tokens) + (Number(f.fixed) || 0) : null);
  // The preview weighs the copy with no message, the question with the one you sent: every form is shifted by that, so
  // the server's own says the question's figure.
  const base = ask.carry ? wholeOf(sweep[ask.carry]) : null;
  const shift = base && Number(ask.tokens) > base ? Number(ask.tokens) - base : 0;
  return {
    ways: SWITCH_FORMS.map((id) => {
      const w = wholeOf(sweep[id]);
      const tokens = w == null ? null : w + shift;
      const fits = tokens == null || !ask.usable || tokens <= ask.usable;
      const named = CARRY_WORDS.find((x) => x.id === id);
      const line = named?.line ? named.line.replace(/^./, (c) => c.toUpperCase()) : "";
      return {
        id,
        label: named?.name || id,
        sub: tokens == null ? "" : fits ? `≈${tok(tokens)}` : `≈${tok(tokens)}, past your line`,
        recommended: id === first,
        disabled: false,
        title: [line, fits ? "" : `past the line at ${fmt.n(Number(ask.usable))}: room is made before your message goes`].filter(Boolean).join(" · "),
        tokens,
        fits,
      };
    }),
  };
}

/**
 * What a switch's card lists (HarnessV4_Tasks A7): each form the new session can carry the turns in, fullest first,
 * with what it weighs there — the preview's sweep (`forms[form].tokens`) and the agent's own prompt and tools
 * (`own`) — and, past the new side's line, that room is made before it goes. Chosen first: on an account switch, Whole
 * where it fits, else the fullest form that fits (Whole where none does); on another, the form the server suggests (the
 * session's own, `context.carry`). A form the preview did not weigh is listed without a figure, and so is every form
 * where the new side goes on in its own session (`resumes`): it is handed the turns it missed, which the preview's
 * figures, of the whole copy, do not weigh.
 * Where the model that answered last can write a summary first (`handoff`; the owner's of 11-08), it is listed after
 * the forms, chosen first where no form fits. Into a model Filament calls (`loop`) there is no form to choose: Send as it
 * is, the copy as composed with what it weighs, and the handoff — the one the server suggests chosen first.
 * @param {any} pv  the session's compose preview @param {SwitchAsk} q
 * @returns {SwitchOptions}
 */
export function switchChoices(pv, q) {
  if (q.loop) {
    const held = Number(q.held) || 0;
    const fits = !held || !q.usable || held < q.usable;
    const size = !held ? "" : fits ? `≈${fmt.n(held)} tokens` : `≈${fmt.n(held)} tokens, past the line at ${fmt.n(Number(q.usable))}: room is made first`;
    const handoff = q.handoff && q.suggested === "handoff";
    return {
      ways: [
        {
          id: "send",
          label: "Send as it is",
          sub: [size, q.compacted ? "the summary, then every turn since, as it stands" : "every turn as it stands"].filter(Boolean).join(" · "),
          recommended: !handoff,
          disabled: false,
          title: fits ? "" : "The copy does not fit under the line, so room is made before the message goes",
        },
        ...(q.handoff ? [handoffChoice(q, !!handoff)] : []),
      ],
      suggest: "send",
    };
  }
  const sweep = q.resumes ? {} : pv?.forms || {};
  const own = Number(q.own) || 0;
  const rows = SWITCH_FORMS.map((id) => {
    const t = Number(sweep[id]?.tokens) || 0;
    const weighs = t ? t + own : null;
    return { id, weighs, fits: weighs == null || !q.usable || weighs <= q.usable };
  });
  const noneFits = rows.every((r) => !r.fits);
  const first = q.handoff && noneFits ? "handoff" : q.account ? rows.find((r) => r.fits)?.id || "plain" : SWITCH_FORMS.includes(q.suggested) ? q.suggested : "words";
  return {
    ways: [...rows.map((r) => {
      const named = CARRY_WORDS.find((x) => x.id === r.id);
      const size = r.weighs == null ? "" : r.fits ? `≈${fmt.n(r.weighs)} tokens` : `≈${fmt.n(r.weighs)} tokens, past the line at ${fmt.n(Number(q.usable))}: room is made first`;
      return {
        id: r.id,
        label: named?.name || r.id,
        sub: [size, named?.line || ""].filter(Boolean).join(" · "),
        recommended: r.id === first,
        disabled: false,
        title: r.fits ? "" : "The new session cannot take this form under its line, so the session makes room before the message goes",
      };
    }), ...(q.handoff ? [handoffChoice(q, first === "handoff")] : [])],
    suggest: "compact",
  };
}

/**
 * The handoff as a switch's card lists it (the owner's of 11-08): the model that answered last writes a summary of the
 * chat first — from its cache while it is warm —, and the side switched to starts from it.
 * @param {SwitchAsk} q @param {boolean} first
 * @returns {SwitchChoice}
 */
function handoffChoice(q, first) {
  const h = /** @type {Handoff} */ (q.handoff);
  const c = h.cache;
  const cache = c?.state === "warm" ? `from its warm cache, ${spanWords(c.leftMs)} left` : c?.state === "cold" ? "its cache is cold: it reads the chat again" : "";
  return {
    id: "handoff",
    label: `Summary by ${h.by} first`,
    sub: [cache, `${q.to.name} starts from the summary`].filter(Boolean).join(" · "),
    recommended: first,
    disabled: false,
    title: h.way === "self" ? `${h.by} writes Filament's summary in its own session; then the message goes` : `${h.by} writes Filament's summary; then the message goes`,
  };
}

/**
 * The card a switch asks with before its first message (HarnessV4_Tasks A7), in place of the error banner on the turn
 * the server stopped: the server's words — the switch, and what happens now —, the new side's window and line, then each
 * form the new session can carry the turns in, with what it weighs there (`options`, `switchChoices`), the first choice
 * marked; where the new side goes on in its own session, the turns it missed go in the form chosen. Asked every time:
 * what the session will hold is the person's to see before it goes. The answers: Switch and send, with the form
 * chosen, and Dismiss — the message goes back to the box, with its files (the page's `onTakeBack`). Switch and send is
 * held until the forms are weighed, reading "Weighing…" meanwhile: the server suggests Whole on an account switch
 * without weighing it, and only the weighing says whether it fits the new window (the hunt of 11-09) — where the
 * weighing fails, the server's stands.
 * @param {string} message @param {Ask} ask
 * @param {{ options?: () => Promise<SwitchOptions | null>, onSwitch?: (form: string) => unknown, onDismiss?: () => void }} [cb]
 *   an answer that is false, or resolves false or to the words of why it could not go, gives the card back
 */
export function switchCard(message, ask, cb = {}) {
  /** Until the forms are weighed, the one the server suggests. @type {string | null} */
  let chosen = ask.switch?.suggested || null;
  let spent = false;
  /** Whether the forms are weighed, or none will be. */
  let weighed = !cb.options;
  /** @type {SwitchChoice[]} */
  let ways = [];
  /** Why the last answer could not go, on the card it gave back. */
  const note = h("span", { class: "ix-ask-note hidden" });
  /** What the answer came to: one that could not go — a turn still running in the chat, a send refused before it went —
   *  gives the card back, saying why where the page did. @param {unknown} went */
  const answered = (went) => {
    if (went !== false && typeof went !== "string") return;
    spent = false;
    go.disabled = false;
    if (dismiss) dismiss.disabled = false;
    note.textContent = typeof went === "string" ? went : "";
    note.classList.toggle("hidden", !note.textContent);
  };
  const goTitle = ask.switch?.loop ? "Send the message the way chosen" : "Start the new session with the turns in the form chosen, and send the message";
  /** @type {HTMLButtonElement} */
  const go = h("button", { class: "primary sm", type: "button", title: weighed ? goTitle : "Waits while each form is weighed for the new session", onclick: () => {
    if (spent || go.disabled || !weighed || !chosen) return;
    spent = true;
    go.disabled = true;
    if (dismiss) dismiss.disabled = true;
    note.classList.add("hidden");
    const went = cb.onSwitch?.(chosen);
    if (went instanceof Promise) void went.then(answered, () => answered(false));
    else answered(went);
  } }, weighed ? "Switch and send" : "Weighing…");
  if (!cb.onSwitch || !weighed) go.disabled = true;
  // Held while the answer is under way, as the ask card's Not now is: the message has gone, or waits on a handoff's
  // summary that sends it once written — given back to the box then, it would go twice (the hunt of 11-08).
  /** @type {HTMLButtonElement | null} */
  const dismiss = cb.onDismiss ? h("button", { class: "ghost sm", type: "button", title: "Close the card: your message goes back to the box", onclick: () => { if (!spent) cb.onDismiss?.(); } }, "Dismiss") : null;
  const waysEl = h("div", { class: "ix-choices ix-ask-ways", role: "radiogroup", "aria-label": "What the new session carries" });
  const paint = () => {
    waysEl.replaceChildren(...ways.map((o) => h("button", {
      class: `ix-choice${o.id === chosen ? " is-on" : ""}`,
      type: "button",
      role: "radio",
      "aria-checked": o.id === chosen ? "true" : "false",
      title: o.title,
      onclick: () => { if (spent) return; chosen = o.id; paint(); },
    }, h("b", {}, o.label), h("span", {}, o.sub), o.recommended ? h("span", { class: "ix-choice-tag" }, "Recommended") : null)));
  };
  /** The forms weighed, or not to be: Switch and send can go. Held, its face said why: the weighing can take a minute on
   *  a long chat, and a button disabled with no word reads as broken (the owner's of 11-09). */
  const ready = () => {
    weighed = true;
    go.textContent = "Switch and send";
    go.title = goTitle;
    if (cb.onSwitch) go.disabled = false;
  };
  cb.options?.().then((r) => {
    if (!r) return;
    ways = r.ways;
    chosen = (ways.find((o) => o.recommended) || ways[0])?.id || chosen;
    paint();
  }).catch(() => {}).finally(ready);
  const facts = askFacts(ask);
  return h("div", { class: "ix-error ix-resume ix-ask ix-switch" },
    h("span", { class: "ix-error-main" }, h("span", { class: "ix-error-ic", html: ICONS.repeat }), h("span", { class: "ix-error-msg" }, message)),
    note,
    facts.length ? h("div", { class: "ix-ask-facts" }, ...facts.map((f) => h("span", { class: "ix-ask-fact" }, f))) : null,
    cb.options ? h("span", { class: "ix-ask-lead" }, ask.switch?.loop ? `How ${ask.switch.to.name} starts` : ask.switch?.resumes ? "The turns it missed go as" : "The new session carries the turns as") : null,
    cb.options ? waysEl : null,
    h("span", { class: "ix-error-acts" }, go, dismiss));
}

/** The longest a limit card waits between looks for its reset: one drawn away stops looking within it. */
const RESET_LOOK_MS = 60_000;

/**
 * The way a limit card's turn went on, said on the card where its ways stood: `by` which — a Retry, a Continue on or
 * with, the page's countdown with its "continue" —, `said` its words.
 * @typedef {{ by: "retry" | "continue" | "resume", said: string }} LimitTaken
 */

/**
 * The limit card (HarnessV3-ACP AC3-6), in place of the error banner on a coding agent's turn its plan stopped: the
 * window that ran out and when the plan is free again, in words, and the ways on — *Continue on* another account of
 * the same agent with room, *Continue with* another agent with room (each switches the session's model to it and sends
 * the turn's words again: the agent's new session is seeded from Filament's copy), *Resume at* the reset (a countdown
 * in this tab that sends "continue" then), a Codex reset credit where one is left (Codex's word on it back: once it
 * reset the plan, Retry takes its place), Retry once the plan may have room again — its reset come while the card is on
 * screen too: Retry takes the countdown's place then, and no Resume at a time gone is offered —, the agent's own words
 * (Show details), and Dismiss. The alternatives are read as the card is drawn. A way taken is said in the ways' place,
 * which offer none again.
 * @param {import("../../lib/accounts.js").PlanLimit} limit
 * @param {{ message: string, detail?: string, rows: () => import("../../lib/accounts.js").AgentRow[], now?: () => number,
 *   onContinue?: (upstream: string) => unknown, onCancel?: () => void, resumeAt?: () => number | null, onResume?: (at: number | null) => void,
 *   onResetCredit?: (upstream: string) => Promise<string | null>, onRetry?: () => unknown, onDismiss?: () => void,
 *   taken?: () => LimitTaken | null, onTaken?: (way: LimitTaken | null) => void,
 *   watchResume?: (paint: () => void, back: () => void) => void }} cb  onCancel: the Cancel of a Continue on under way
 *   where no countdown is armed — the page stops the way, which answers that it was not taken; taken, onTaken: the way
 *   taken as the page keeps it on the turn — its countdown's too —, and the card's own taken there, or given back;
 *   watchResume: the page says the card again as its countdown changes away from it — it fires, a Continue on holds it
 *   or gives it back —, and gives back the card a Continue on spent whose words were refused after they went
 */
export function limitCard(limit, cb) {
  const now = cb.now || Date.now;
  const t = now();
  const words = limitWords(limit, t);
  const rows = cb.rows();
  const alt = alternativesOf(limit, rows);
  const from = rows.find((r) => r.upstream === limit.upstream) || null;
  const detail = h("pre", { class: "ix-detail hidden" }, [cb.message, cb.detail].filter(Boolean).join("\n\n"));
  const toggle = h("button", { class: "ghost sm ix-keep", type: "button", onclick: () => {
    detail.classList.toggle("hidden");
    toggle.textContent = detail.classList.contains("hidden") ? "Show details" : "Hide details";
  } }, "Show details");
  // One way on per card: the first one taken stands the others down, lets go of a countdown armed, and is said on the
  // card where the ways stood — a press that went, or the page's countdown that fired. The page keeps it on the turn
  // (`taken`), so the card drawn again offers none either.
  /** @type {HTMLButtonElement[]} */
  const ways = [];
  /** The way under way — a Continue's, whose Cancel stays live, or a Retry's —; null while none is.
   *  @type {"continue" | "retry" | null} */
  let going = null;
  /** The way taken, where the page keeps none for the card. @type {LimitTaken | null} */
  let own = null;
  /** The way taken: the page's word on the turn, where it keeps one. @returns {LimitTaken | null} */
  const taken = () => (cb.taken ? cb.taken() : own);
  /** A way taken here — or, null, given back — and the card painted as it stands. @param {LimitTaken | null} way */
  const keep = (way) => {
    if (cb.onTaken) cb.onTaken(way);
    else own = way;
    paintResume();
  };
  /** A Retry that went: the countdown armed is let go too. */
  const retried = () => {
    if (cb.resumeAt?.() != null) cb.onResume?.(null);
    keep({ by: "retry", said: "Sent again" });
  };
  const takenEl = h("span", { class: "ix-limit-taken muted small hidden" });
  /**
   * The button for one group of alternatives: one is named on it; several open a menu of them.
   * @param {import("../../lib/accounts.js").AgentRow[]} list @param {string} verb @param {string} went  the way
   *   said once it went @param {boolean} primary
   */
  const goButton = (list, verb, went, primary) => {
    if (!list.length || !cb.onContinue) return null;
    // The page holds a countdown armed while it takes the way, and lets it go or gives it back as the way goes: the
    // card leaves it to the page. A way it could not take (false: a turn running in the chat, a message waiting for
    // it) gives the card back as it was; a row of a menu left open, picked once a way is taken or while one is under
    // way, does nothing.
    const go = async (/** @type {import("../../lib/accounts.js").AgentRow} */ r) => {
      if (taken() || going) return;
      // A Cancel stays live — the countdown's where one is armed, else the way's own (`onCancel`) —: it stops the way
      // under way, and the card comes back as it stood.
      going = "continue";
      paintResume();
      const answer = await cb.onContinue?.(r.upstream);
      going = null;
      if (answer !== false) return keep({ by: "continue", said: `${went} ${r.name}` });
      paintResume();
    };
    const b = h("button", {
      class: `${primary ? "primary" : "ghost"} sm`,
      type: "button",
      title: list.length === 1 ? summaryWords(list[0], t) : `${list.length} of them have room`,
      onclick: () => {
        if (list.length === 1) return go(list[0]);
        menu(list.map((r) => ({ label: r.name, desc: summaryWords(r, now()), onClick: () => go(r) })), { anchor: b, side: "top", align: "start", width: 320 });
      },
    }, list.length === 1 ? `${verb} ${list[0].name}` : `${verb}…`);
    ways.push(/** @type {HTMLButtonElement} */ (b));
    return b;
  };
  const freeAt = limit.freeAt;
  /** The plan may have room again: its reset has passed — as the card was drawn, or since, while it is on screen —, no
   *  reset was said (a workspace's credits), or a reset credit has just reset it. */
  let freed = freeAt == null || freeAt <= t;
  // Armed, it says when it sends and offers the cancel; pressed again, it lets go.
  const resume = cb.onResume && !freed
    ? h("button", {
        class: `${alt.same.length || alt.other.length ? "ghost" : "primary"} sm`,
        type: "button",
        onclick: () => {
          cb.onResume?.((cb.resumeAt?.() ?? null) != null ? null : freeAt);
          paintResume();
        },
      })
    : null;
  // A Continue on under way where no countdown is armed: its own Cancel, which the page answers by stopping the way.
  const stopWay = cb.onCancel
    ? h("button", { class: "ghost sm hidden", type: "button", title: "Stop the Continue on under way: the session stays on its model, and nothing is sent", onclick: () => cb.onCancel?.() }, "Cancel")
    : null;
  /** The card as it stands: its ways — none once one is taken, which it says; the countdown's Cancel, or the way's own,
   *  alone while a Continue is under way —, and its Resume as the page has the countdown. */
  const paintResume = () => {
    if (!freed && freeAt != null && now() >= freeAt) return atReset();
    const armed = cb.resumeAt?.() ?? null;
    const way = taken();
    for (const b of ways) b.disabled = !!way || (going != null && !(going === "continue" && b === resume && armed != null));
    takenEl.textContent = way?.said || "";
    takenEl.classList.toggle("hidden", !way);
    stopWay?.classList.toggle("hidden", going !== "continue" || armed != null);
    if (!resume || freeAt == null) return;
    // Past the reset no countdown is offered for a time gone: one armed says itself until it fires or is let go.
    resume.classList.toggle("hidden", freed && armed == null);
    resume.textContent = armed != null ? `Resumes at ${whenWords(armed, now())} · Cancel` : `Resume at ${whenWords(freeAt, t)}`;
    resume.title = armed != null ? "Cancel: nothing is sent at the reset" : "Send “continue” in this chat once the plan is free again — while this tab stays open";
  };
  if (resume) ways.push(/** @type {HTMLButtonElement} */ (resume));
  // A Retry the page could not send (a turn still running in the chat, the send refused it before it went) leaves the
  // card as it was, its Resume armed; while the send answers, the ways stand down.
  const retryOnce = () => {
    if (taken() || going) return;
    /** @param {unknown} went */
    const answered = (went) => {
      going = null;
      if (went !== false && typeof went !== "string") return retried();
      paintResume();
    };
    const went = cb.onRetry?.();
    if (!(went instanceof Promise)) return answered(went);
    going = "retry";
    paintResume();
    void went.then(answered, () => answered(false));
  };
  const retry = cb.onRetry ? h("button", { class: `ghost sm${freed ? "" : " hidden"}`, type: "button", onclick: retryOnce }, "Retry") : null;
  if (retry) ways.push(/** @type {HTMLButtonElement} */ (retry));
  const credits = from?.type === "codex" ? from.account?.resetCredits?.available || 0 : 0;
  // Offered while the plan's reset is still to come: past it the plan may have room again, whatever its account said
  // last, and Retry is the way on.
  const credit = cb.onResetCredit && from && credits > 0 && from.account?.spent && !(freeAt != null && freeAt <= t)
    ? h("button", {
        class: "ghost sm",
        type: "button",
        title: `${credits} left: resets the plan's windows now`,
        onclick: async () => {
          const outcome = await cb.onResetCredit?.(from.upstream);
          if (outcome !== "reset" && outcome !== "alreadyRedeemed") return;
          // The plan is free now: the countdown has nothing left to wait for, and Retry is the way on.
          freed = true;
          if (cb.resumeAt?.() != null) cb.onResume?.(null);
          resume?.classList.add("hidden");
          credit?.classList.add("hidden");
          retry?.classList.remove("hidden", "ghost");
          retry?.classList.add("primary");
        },
      }, "Use a reset credit")
    : null;
  if (credit) ways.push(/** @type {HTMLButtonElement} */ (credit));
  const line = [words.free, words.why].filter(Boolean).join(" ");
  const lineEl = line ? h("span", { class: "ix-limit-line" }, line) : null;
  /** The reset has come while the card is on screen: Retry takes the countdown's place — the way on, where Resume was
   *  —, no reset credit is offered, and the line says the plan has reset. */
  const atReset = () => {
    freed = true;
    credit?.classList.add("hidden");
    if (retry) {
      retry.classList.remove("hidden");
      if (resume?.classList.contains("primary")) {
        retry.classList.remove("ghost");
        retry.classList.add("primary");
      }
    }
    if (lineEl) lineEl.textContent = [limitWords(limit, Math.max(now(), freeAt ?? 0)).free, words.why].filter(Boolean).join(" ");
    paintResume();
  };
  const el = h("div", { class: "ix-error ix-limit" },
    h("span", { class: "ix-error-ic", html: ICONS.gauge }),
    h("span", { class: "ix-limit-text" }, h("b", { class: "ix-limit-title" }, words.title), lineEl),
    h("div", { class: "ix-limit-ways" },
      goButton(alt.same, "Continue on", "Continued on", true),
      goButton(alt.other, "Continue with", "Continued with", !alt.same.length),
      resume,
      stopWay,
      credit,
      retry,
      takenEl,
      h("span", { class: "grow" }),
      toggle,
      cb.onDismiss ? h("button", { class: "ghost sm ix-keep", type: "button", onclick: cb.onDismiss }, "Dismiss") : null),
    detail);
  paintResume();
  // The page gives back a Continue on whose words were refused after they went — no other way's.
  cb.watchResume?.(paintResume, () => (taken()?.by === "continue" ? keep(null) : paintResume()));
  // The reset is looked for while the card is on the page: at its time, a minute at most between looks — a card drawn
  // away looks no more.
  const watchReset = () => {
    if (freed || freeAt == null) return;
    const wait = freeAt - now();
    if (wait <= 0) return atReset();
    const timer = /** @type {any} */ (setTimeout(() => (el.isConnected ? watchReset() : undefined), Math.min(wait, RESET_LOOK_MS)));
    timer?.unref?.();
  };
  watchReset();
  return el;
}
