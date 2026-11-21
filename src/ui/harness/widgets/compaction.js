// @ts-check
// Compaction's parts on the page (the owner's rules of 10-31: three kinds — the same model writes one summary, a side
// model writes it, or an instant fold calls none): when the history makes room, how, and what is protected. The
// context ring's popover holds the line and Compact now… (widgets/context.js), which opens the card that asks
// (conversation/interaction.js, proposal_ux §4.12 step 3); the sheet How earlier turns are kept the rest
// (panes/context-how.js). They draw with what is here:
//   the words and the rules — the methods and the ways by their names (src/ui/lib/context-words.js, UX-4), the line's
//     bounds, where a figure stands against the line (`standing`), the method a session compacts by (`sessionMethod`),
//     the way an agent's session takes now and why (`wayNow`, `wayReason`), a method's
//     cost in a few words (`costWords`), its pace (`paceWords`) and how its writer reads the turns (`readsWords`), the
//     choices of the card that asks before a message is sent (`askChoices`, in the card's plain words: `roomWords`) and
//     the compaction each asks of the server (`choiceCompaction`);
//   `compactionParts(ctx)` — the session's compaction knobs as it resolves them, and the lists: each method weighed
//     (thumbnail · name and one line · what the next request would weigh · cost and calls), the choice written as
//     `context.compaction.method`; the method's own control (keep whole); an agent's ways (HarnessV3-ACP AC5-8); who
//     writes a summary — the same model (from its warm cache when it can) or a side model — with the two writers'
//     costs side by side, how each reads the turns, the cache's time left, each model's window (128K assumed, and
//     said); the instant line; the compactions so far, the newest with Undo.
// A client's session (another client's chat opened here, HarnessV3-Compaction §7.3): its client decides when to compact and its
// own model writes that summary, so there is no line of Filament's and no way to choose (the owner's rule of 10-31: an
// outside client gets a plain proxy plus memory).
// Every figure is the server's: the host's one preview per conversation state, whose `compaction` is the compactor's
// plan. Nothing here fetches; every write goes through ctx.write.
import { h } from "../../lib/dom.js";
import { METHODS as METHOD_WORDS, methodOf as methodWordsOf, methodName, roomWords, WAYS as WAY_WORDS } from "../../lib/context-words.js";
import { ICONS } from "../lib/icons.js";
import { compactionFacts } from "../lib/labels.js";
import { group, row, section, segmented, tok, usd, clock, ago, kids, spanWords } from "./kit.js";
import { windowFacts, heldFigure } from "./context.js";
import { createModelSelect } from "../composer/model.js";

/** The band the line may take, as the server's (app/sessions/compaction.js): under the lowest a compaction has next to
 *  no room to land beneath the line; past the highest the reply has no room. How low is worth it hangs on the window,
 *  which is the person's to judge (HarnessV4_Tasks C33: 400K of a 1M window is 40%). */
export const LINE_MIN = 15;
export const LINE_MAX = 95;

/** The methods (`context.compaction.method`): one summary, an instant fold; each `{ id, name, verb, line }`. */
export const METHODS = METHOD_WORDS;
/** A method's words by id; any other value reads as one summary's. */
export const methodOf = methodWordsOf;

/** Each way's glyph; Ours draws the method in force. */
const WAY_GLYPHS = Object.freeze({ suggested: "sparkles", own: "bot", self: "pencil", ours: "" });
/**
 * The ways a coding agent's session makes room (HarnessV3-ACP AC5-3 to AC5-5), as `context.compaction.agent` names
 * them: each with its glyph and its name, which takes the agent's.
 */
export const WAYS = Object.freeze(WAY_WORDS.map((w) => Object.freeze({
  id: w.id,
  glyph: WAY_GLYPHS[/** @type {keyof typeof WAY_GLYPHS} */ (w.id)] ?? "",
  name: (/** @type {string} */ who) => w.name.replace("{agent}", who),
  line: w.line,
})));

/**
 * The way Compact now takes in an agent's session, by the plan's `agent`: the server's — but a suggested Self whose
 * cache has gone cold since the figures came is Ours, as the server would say now. @param {any} a @param {number} now
 * @returns {"own" | "self" | "ours"}
 */
export const wayNow = (a, now) => (a.suggested && a.way === "self" && Number(a.warmUntil) <= now ? "ours" : a.way);

/**
 * Whether a coding agent's cache has gone cold (the plan's `agent`; HarnessV4_Tasks U3-6, UX-9): Filament weighs what it
 * holds, and its last turn ended longer ago than its cache keeps — whichever of its own ways runs now reads all it
 * holds again. @param {any} a @param {number} now
 */
export const isCold = (a, now) => !!a?.weighed && Number(a.warmUntil) > 0 && Number(a.warmUntil) <= now;

/**
 * Why `way` runs now, in a few words (the plan's `agent`): nothing the agent holds counted yet; or the suggestion's
 * reason — its cache warm (for how long) or gone cold, or no summary of its own — after the chosen way it lacks now.
 * Empty for the way the session chose. The suggestion takes its own compaction where it has one (U3-6).
 * @param {any} a @param {string} way @param {number} now
 */
export function wayReason(a, way, now) {
  if (!a.weighed) return a.chosen === "ours" ? "" : "Nothing it holds is counted yet";
  if (!a.suggested) return "";
  const why = way === "own" ? "its own compaction" : way === "self" ? `its cache is warm, ${clock(Number(a.warmUntil) - now)} left` : a.self ? "its cache has gone cold" : "it writes no summary";
  const lacks = a.chosen === "own" ? "Its own compaction isn't open now" : a.chosen === "self" ? "It can't write the summary now" : "";
  return lacks ? `${lacks}; suggested: ${why}` : `Suggested: ${why}`;
}

/**
 * Whether a session's history is its own client's — another client's chat opened here (HarnessV3-Compaction §7.3): the client
 * decides when it compacts, and its own model writes the summary. The harness takes no turn in one; it goes on in a
 * fork. @param {any} view
 */
export const isClientView = (view) => view?.settings?.native === false;

/**
 * The method a session compacts by (`context.compaction.method`; anything else is one summary); null in a client's
 * session, whose client compacts by itself.
 * @param {any} view
 * @returns {string | null}
 */
export function sessionMethod(view) {
  if (isClientView(view)) return null;
  const s = view?.settings;
  const v = String(s?.flat?.["context.compaction.method"] ?? s?.effective?.context?.compaction?.method ?? "summary");
  return METHODS.some((x) => x.id === v) ? v : "summary";
}

/**
 * The kind a session chose, as the card names it: the instant fold (`context.compaction.method` fold), or one summary
 * by the same model or by a side model (`context.compaction.writer`); null where it chose neither, and the cache
 * decides (`askChoices`).
 * @param {any} view
 * @returns {"same" | "side" | "fold" | null}
 */
export function sessionKind(view) {
  if (sessionMethod(view) === "fold") return "fold";
  const s = view?.settings;
  const w = s?.flat?.["context.compaction.writer"] ?? s?.effective?.context?.compaction?.writer ?? null;
  return w === "session" ? "same" : w === "model" ? "side" : null;
}

/** A history row's verb by how the compaction made room. @type {Record<string, string>} */
const HISTORY_VERB = { fold: "folded", summary: "summarized", own: "compacted by the agent" };

/**
 * A history row's label: its turns and how the compaction made room. One a coding agent made of its own context in the
 * middle of a turn (`detail.during`) says that turn and whose it was; a summary Filament wrote for its copy of the chat
 * alone (`detail.copy`, HarnessV4_Tasks C29) says so.
 * @param {{ fromTurn: number, toTurn: number, method: string, detail?: { during?: number, by?: string, copy?: string } | null }} c
 */
export const historyLabel = (c) =>
  Number(c.detail?.during) > 0 ? `During turn ${c.detail?.during}: compacted by ${c.detail?.by || "the agent"}`
    : c.detail?.copy ? `Turns ${c.fromTurn}–${c.toTurn} summarized for Filament's copy`
      : `Turns ${c.fromTurn}–${c.toTurn} ${HISTORY_VERB[c.method] || "compacted"}`;

/**
 * The history as a method leaves it, five turns oldest on top: a whole turn a long bar, a fold a short one, a summary
 * one pale block. Numbers and the accent only.
 * @param {string} id
 */
export function methodThumb(id) {
  const bar = (/** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ op) => `<rect x="4" y="${y}" width="${w}" height="3" rx="1.5" style="fill:var(--accent);opacity:${op}"/>`;
  // A summary is a page of its own words: a pale block with its lines in it.
  const line = (/** @type {number} */ y, /** @type {number} */ w) => `<rect x="7" y="${y}" width="${w}" height="1.6" rx="0.8" style="fill:var(--accent);opacity:0.85"/>`;
  const block = (/** @type {number} */ y, /** @type {number} */ ht) => `<rect x="4" y="${y}" width="26" height="${ht}" rx="2.5" style="fill:var(--accent);opacity:0.22"/>`;
  /** @type {Record<string, string[]>} */
  const shapes = {
    fold: [bar(4, 14, 0.62), bar(9, 14, 0.62), bar(14, 14, 0.62), bar(19, 14, 0.62), bar(24, 26, 1)],
    summary: [block(4, 23), line(8, 20), line(12.5, 16), line(17, 19), line(21.5, 11)],
  };
  return `<svg viewBox="0 0 34 30" width="34" height="30" aria-hidden="true">${(shapes[id] || shapes.summary).join("")}</svg>`;
}

/**
 * Where the window stands against a line: the line in tokens, and "" · warn (within 15% of it, as the Context face
 * warns) · error (at or past it). No window, no standing.
 * @param {number} held @param {number | null | undefined} window @param {number} percent
 * @returns {{ lineTokens: number, tone: "" | "warn" | "error" }}
 */
export function standing(held, window, percent) {
  if (!window) return { lineTokens: 0, tone: "" };
  const lineTokens = Math.floor((window * percent) / 100);
  return { lineTokens, tone: held >= lineTokens ? "error" : held >= lineTokens * 0.85 ? "warn" : "" };
}

/** A model's name as the chip shows it. @param {string | null | undefined} m */
export const shortModel = (m) => String(m || "").replace(/^agent\//, "");

/**
 * A writer's or a method's $0 that a subscription plan pays, not a free one: paid nothing, though its tokens have a
 * list price (or none states one). A fold is $0 at list too — free.
 * @param {any} est
 */
export const onPlan = (est) => est?.cost === 0 && (est.listCost === null || Number(est.listCost) > 0);

/**
 * What a method would cost and call, in a few words: "Free · no model call", "≈ $0.29 · 1 call · from the cache", "On your plan · 1 call", and where a coding agent's model writes it, "On your
 * plan · 1 call · in a session of its own" (`est.agentWriter`, HarnessV4_Tasks C33). `est` is one of the plan's
 * methods; `model` names the writer too (the How row on the main page — the How page's writer section names it there).
 * @param {string} id @param {any} est @param {{ model?: boolean }} [o]
 */
export function costWords(id, est, { model = false } = {}) {
  if (!est) return "";
  const price = est.cost == null ? "unpriced" : onPlan(est) ? "On your plan" : est.cost === 0 ? "Free" : `≈ ${usd(est.cost)}`;
  if (id === "fold" || est.reads === "instant") return "Free · no model call";
  const calls = Number(est.slices) > 1 ? `${est.slices} calls` : "1 call";
  // A coding agent as the writer reads in a session of its own, its own prompt on top of each call.
  const who = `${model && est.model ? ` · ${shortModel(est.model)}` : ""}${est.agentWriter ? " · in a session of its own" : ""}`;
  return `${price} · ${calls}${who}${est.fork ? " · from the cache" : ""}`;
}

/**
 * How a method's calls go, after its cost: "one after another" where its summary is written in more than one call, and
 * about how long they take by the writer's measured speed ("about 4 min"). The time is the request log's — the
 * writer's first byte and its tokens a second in its newest calls; where the log has no finished call of that model
 * the plan says none (`aboutMs` null), and nothing is said of time here.
 * @param {any} est
 */
export function paceWords(est) {
  return [Number(est?.slices) > 1 ? "one after another" : "", Number(est?.aboutMs) > 0 ? `about ${spanWords(Number(est.aboutMs))}` : ""].filter(Boolean).join(" · ");
}

/** What a way's line adds where it would leave the chat no smaller than it is now (HarnessV4_Tasks U3, V4-D309). */
export const NO_SMALLER = "no smaller than now";

/**
 * Whether a way would leave the session no smaller than it is now (HarnessV4_Tasks U3, V4-D309: on a 7.3K chat the
 * pull-down offered "One summary now ≈8K after"): what it leaves, with a coding agent's own share where a turn measured
 * one, at or above what the session holds now (the plan's `now`). The way stays on offer: a person may want a summary
 * all the same. Before the plan's figure for now, nothing is said.
 * @param {any} est @param {number | null | undefined} now @param {any} [agent]  the plan's `agent`
 */
export const noSmaller = (est, now, agent = null) =>
  Number(now) > 0 && Number(est?.after) > 0 && Number(est.after) + (Number(agent?.share) > 0 ? Number(agent.share) : 0) >= Number(now);

/**
 * What a way leaves in the next request, by Filament's count, where it was measured: a summary not yet written is a
 * guess, and says no figure (the owner's word of 10-24: "you can drop the token counter on compaction if you think
 * that is just an estimate"); nor is a coding agent's own share said ("no need to show the claude code's own system
 * prompt and tools"). `now`, what the session holds now (the plan's): a way that would leave it no smaller says so.
 * "" where there is nothing to say.
 * @param {any} est @param {any} [agent]  the plan's `agent` @param {number | null} [now]
 */
export const afterWords = (est, agent = null, now = null) =>
  [est.exact ? `${tok(est.after)} after` : "", noSmaller(est, now, agent) ? NO_SMALLER : ""].filter(Boolean).join(" · ");

/**
 * Where a coding agent's line sits at or under its own share (its prompt and tools): no way gets under it, so every
 * message asks. In words, for the Context tab beside the line; null where the line clears it, or nothing measured it.
 * @param {{ who: string, share: number | null | undefined, line: number | null | undefined }} o
 */
export function shareLine({ who, share, line }) {
  if (!(Number(share) > 0) || !(Number(line) > 0) || Number(line) > Number(share)) return null;
  return `The line (${tok(Number(line))}) is under what ${who} holds before any of the chat (≈${tok(Number(share))}, its own prompt and tools): no way gets under it, so every message asks`;
}

/** Why one of an agent's own ways is not offered, on its row (HarnessV4_Tasks C33): its session open or not makes no
 *  difference — Filament opens it first — so what is left is the agent having no such way, or no session to go on in. */
export const NOT_OFFERED = Object.freeze({
  own: "Not offered: no compaction of its own here, or no session of this chat to go on in",
  self: "Not offered: no session of this chat to go on in, or it writes no summary",
});

/** Why no side model can write: the card's and the How page's words. */
export const SIDE_NONE = "No side model: pick one under Written by, or set memory's model";

/**
 * How a writer reads the turns, as the plan weighed it (the owner's rules of 10-31): from its warm cache; the turns
 * whole; with their tool calls folded first, where they are too big whole for one call; in calls one after another,
 * where even folded they are — and a side model's reading of turns that fold to the instant line or under is the
 * instant fold itself, no call. "" before the plan says.
 * @param {any} est  a writer's estimate (the plan's `writers.session`, `writers.side`) or the summary's
 */
export function readsWords(est) {
  const r = est?.reads;
  if (r === "fork") return "From its warm cache";
  if (r === "whole") return "Reads the turns whole";
  if (r === "folded") return "Reads the turns with their tool calls folded: too big whole for one call";
  if (r === "slices") return `Reads the ${est.folded === false ? "" : "folded "}turns in ${Number(est.slices) > 1 ? `${est.slices} calls` : "slices"}: too big for one`;
  if (r === "instant") return "Too big whole for one call: an instant fold in its place, no model call";
  return "";
}

/**
 * The instant fold's offer in a line, from the plan (the owner's rules of 10-31: "the tokens left are shown in advance;
 * an offer with its count is visible any time"): what a fold leaves of the earlier turns, offered at the instant line
 * or under; over it, the count beside the line; "" where a fold frees nothing.
 * @param {any} fold  the plan's `methods.fold` @param {number | null | undefined} line  the plan's `instantTokens`
 */
export function foldOfferWords(fold, line) {
  if (!fold?.possible || fold.earlier == null) return "";
  const left = tok(Number(fold.earlier));
  if (fold.instant) return `Instant fold: leaves ${left} of the earlier turns, no model call`;
  return Number(line) > 0
    ? `A fold leaves ${left} of the earlier turns, over your ${tok(Number(line))} instant line — no model call`
    : `Instant fold is off; a fold would leave ${left} of the earlier turns`;
}

/**
 * The compaction a card's choice asks of the server (`POST /sessions/:id/compact`): a coding agent's own way
 * (`way:own`, `way:self`); one summary by the same model or by the side model — `model`, one picked on the card, for
 * this once — or the instant fold; anything else, the session's own way.
 * @param {string | null | undefined} choice @param {string | null} [model]
 * @returns {{ method: "summary" | "fold" | null, way: "own" | "self" | null, once: { writer: "session" | "model", model?: string } | null }}
 */
export function choiceCompaction(choice, model = null) {
  if (choice === "way:own" || choice === "way:self") return { method: null, way: choice === "way:own" ? "own" : "self", once: null };
  if (choice === "same") return { method: "summary", way: null, once: { writer: "session" } };
  if (choice === "side") return { method: "summary", way: null, once: { writer: "model", ...(model ? { model } : {}) } };
  if (choice === "fold") return { method: "fold", way: null, once: null };
  return { method: null, way: null, once: null };
}

/**
 * A coding agent's own ways to make room now, where the plan says it has them (`plan.agent`, HarnessV4_Tasks U3-6): on
 * a cold cache (`isCold`) each says what it reads again — all the agent holds. A way it lacks is `off`, with why.
 * @param {any} plan @param {any} a  the plan's `agent` @param {string} agentName @param {number} now
 * @returns {{ id: string, way: "own" | "self", label: string, sub: string, off: boolean, why: string }[]}
 */
function agentWays(plan, a, agentName, now) {
  /** A way's words. @param {string} id */
  const way = (id) => WAYS.find((x) => x.id === id) || WAYS[0];
  const summary = plan?.methods?.summary;
  const reads = isCold(a, now) && Number(a.held) > 0 ? `Reads ${a.estimated ? "≈" : ""}${tok(a.held)} again` : "";
  /** What one of its own ways does, after its session opening first (no process holds it — a restart, an idle agent
   *  let go — or the agent lost it) and what it reads again on a cold cache. @param {string} detail */
  const said = (detail) => [a.opens ? "Opens its session first" : "", reads, detail].filter(Boolean).map((x, i) => x.replace(/^./, (c) => (i ? c.toLowerCase() : c.toUpperCase()))).join(" · ");
  return [
    {
      id: "way:own", way: "own", label: way("own").name(agentName),
      sub: !a.own ? NOT_OFFERED.own : said(a.own === "fork" ? "Forked first, so Undo brings its session back" : a.opens ? "In its session" : "In its live session"),
      off: !a.own, why: a.own ? "" : "It has no compaction of its own on demand, or keeps no session of this chat that your next message goes on in",
    },
    {
      id: "way:self", way: "self", label: way("self").name(agentName),
      sub: !a.self ? NOT_OFFERED.self : said([summary ? afterWords(summary, a, plan?.now) : "", `${a.self === "fork" ? "in a fork" : "in its session"}, read-only`].filter(Boolean).join(" · ")),
      off: !a.self, why: a.self ? "" : "It keeps no session of this chat that your next message goes on in, or writes no summary",
    },
  ];
}

/**
 * A way to make room as the card offers it: its plain name and line (`roomWords`, proposal_ux §4.12) — or, where it
 * cannot run now, why; what it leaves (`after`), what it costs and calls (`cost`), how long it takes (`pace`: "about 40
 * s", "instant" where no model is called), and what it does first or how it reads the turns (`note`); `sub`, all of it
 * in one line; whether it is the one recommended and chosen first, and whether it can run now; `tag`, the word beside
 * its name ("Recommended", "Costly"); `writes`, whether the side model picked on the card writes it; `folds`, whether
 * it is the instant fold — the side model's too, where its reading is the fold; `main`, one of the card's first ways —
 * the rest wait under More ways.
 * @typedef {{ id: string, label: string, sub: string, recommended: boolean, disabled: boolean, title: string, writes: boolean,
 *   main: boolean, after: string, cost: string, pace: string, note: string, tag: string, folds: boolean, over?: boolean }} WayChoice
 */

/**
 * The choices of the card that asks before a message is sent (HarnessV4_Tasks C26, U3-6; the owner's rules of 10-31): a
 * coding agent's own ways first, where it has them, then the three kinds — one summary by the same model (in an
 * agent's session, the agent writing it is its own way), by the side model, and the fold, offered wherever it frees room:
 * past the instant line (`plan.methods.fold.instant`) it says so, with its count, and is never the one recommended (the
 * owner's of 11-05: "sometimes the tokens are ever so slightly above 20K so if i want i can just go and select that
 * strategy myself") — each with what it leaves, costs and takes, from the plan's own writers (`plan.writers`).
 * Recommended and chosen first: an agent's own way where it takes one now (`wayNow`), else the kind the session chose
 * (`chosen`: `same`, `side` or `fold` at the line or under), else by the cache (`plan.recommended`): the same model while
 * its cache is warm, else the side model, else the fold at the line or under. Ordered so: warm, the same
 * model, the side model, the instant fold; else the side model, the instant fold, then the same model, costly on a cold
 * cache — the recommended kind first. Empty without a plan of Filament's (a client's session). Where what the chat sends
 * ahead of its history changed (`changed`, the owner's of 11-06): the instant fold, else the side model's summary, is
 * recommended — the kind the session chose where it is one of them — and an agent's own compaction is not offered: its
 * session goes on, what it already loaded keeping its old form, where Filament's ways start a fresh one.
 * @param {{ plan: any, agent: boolean, agentName: string, now: number, chosen?: string | null, changed?: boolean }} o
 * @returns {WayChoice[]}
 */
export function askChoices({ plan, agent, agentName, now, chosen = null, changed = false }) {
  if (!plan?.native || !plan.methods) return [];
  const a = agent ? plan.agent : null;
  const who = agentName || "The agent";
  const w = plan.writers || {};
  const fold = plan.methods.fold;
  const cold = w.cache?.state === "cold";
  /** @type {WayChoice[]} */
  const own = a ? agentWays(plan, a, who, now).filter((r) => !(changed && r.id === "way:own")).map((r) => {
    const words = roomWords(r.id, { agent: who });
    return {
      id: r.id, label: words?.name || r.label, sub: r.sub, recommended: false, disabled: r.off,
      title: r.off ? r.why : words?.line || String(WAYS.find((x) => x.id === r.way)?.line || ""),
      writes: false, main: !!words?.main, after: "", cost: "", pace: "", note: r.off ? "" : r.sub, tag: "", folds: false,
    };
  }) : [];
  /** A kind as the card offers it: its estimate, or why it cannot run now. @param {"same" | "side" | "fold"} id @returns {WayChoice} */
  const kind = (id) => {
    const est = id === "same" ? w.session : id === "side" ? w.side : fold;
    // The instant fold switched off (`instantTokens` 0) stays off; past a line, it folds all the same.
    const why = !est
      ? id === "same" ? "The chat's model is not known yet" : SIDE_NONE
      : !est.possible ? String(est.why || "Nothing to do this way")
        : id === "fold" && fold.instant !== true && !(Number(plan.instantTokens) > 0) ? String(fold.instantWhy || "The instant fold is off") : "";
    const off = !!why;
    // Past the instant line: it leaves more of the earlier turns than an instant fold may — offered, never chosen for you.
    const over = id === "fold" && !off && fold.instant !== true;
    const words = roomWords(id, { agent: who });
    const folds = id === "fold" || est?.reads === "instant";
    const figures = off ? { after: "", cost: "", pace: "" } : { after: afterWords(est, a, plan.now), cost: costWords(id, est, { model: true }), pace: paceWords(est) || (folds ? "instant" : "") };
    const note = off ? "" : id === "fold" ? `Leaves ${tok(Number(fold.earlier) || 0)} of the earlier turns${over ? `, over your ${tok(Number(plan.instantTokens))} instant line` : ""}` : readsWords(est);
    return {
      id, label: words?.name || id, sub: off ? why : [figures.after, figures.cost, paceWords(est)].filter(Boolean).join(" · "),
      recommended: false, disabled: off, title: off ? why.replace(/^./, (c) => c.toUpperCase()) : words?.line || "",
      writes: id === "side", main: !!words?.main, ...figures, note,
      tag: !off && id === "same" && cold && !est.fork ? "Costly" : "", folds, ...(over ? { over: true } : {}),
    };
  };
  const warm = plan.recommended === "session";
  /** @type {("same" | "side" | "fold")[]} */
  const order = a ? ["side", "fold"] : warm ? ["same", "side", "fold"] : ["side", "fold", "same"];
  const kinds = order.map(kind);
  // A fold past the instant line is offered, never recommended.
  const can = (/** @type {string | null} */ id) => !!id && !(id === "fold" && fold?.instant !== true) && [...own, ...kinds].some((r) => r.id === id && !r.disabled);
  const takes = a ? wayNow(a, now) : "ours";
  const byCache = plan.recommended === "session" ? "same" : plan.recommended === "model" ? "side" : null;
  // An agent's own way comes before the kind chosen, which is its copy's (Ours).
  const pick = (changed ? [chosen === "fold" || chosen === "side" ? chosen : null, "fold", "side"] : [takes !== "ours" ? `way:${takes}` : null, chosen, byCache, "fold"]).find(can) || null;
  // A kind the session chose stays first on a cold cache, and still says what it costs.
  for (const r of [...own, ...kinds]) if (r.id === pick) Object.assign(r, { recommended: true, tag: r.tag || "Recommended" });
  return [...own, ...kinds.filter((k) => k.id === pick), ...kinds.filter((k) => k.id !== pick)];
}

/**
 * Compaction's parts (HarnessV4_Tasks U3-3): the session's compaction knobs as it resolves them, and the lists the
 * page draws — every method weighed, an agent's ways, who writes a summary, the compactions so far. The context
 * ring's popover and the Context tab's section draw from this one set, so the two say and write the same; every write
 * goes through ctx.write.
 * @param {import("./registry.js").WidgetContext} ctx
 * @param {{ modelSelect?: typeof createModelSelect }} [io]  `modelSelect` is the Aqua model picker (a test hands in its
 *   own: the picker draws with the page's DOM)
 */
export function compactionParts(ctx, io = {}) {
  const modelSelect = io.modelSelect || createModelSelect;
  const flat = () => ctx.view()?.settings?.flat || {};
  const eff = () => ctx.view()?.settings?.effective?.context || {};
  /** A compaction knob as the session resolves it. @param {string} name @param {any} fallback */
  const knob = (name, fallback) => flat()[`context.compaction.${name}`] ?? eff().compaction?.[name] ?? fallback;
  const percent = () => {
    const v = Number(knob("thresholdPercent", 85));
    return v > 0 && v <= 100 ? v : 85;
  };
  /** What a message does at the line (`context.compaction.mode`): it asks first, unless the session chose otherwise. */
  const mode = () => (String(knob("mode", "ask")) === "auto" ? "auto" : "ask");
  /** Whether a message asks first once the cache has gone cold (`context.compaction.resumeQuestion`). */
  const asksCold = () => knob("resumeQuestion", true) !== false;
  /** Whether a message asks first where what the chat sends ahead of its history changed (`context.compaction.changeQuestion`). */
  const asksChanged = () => knob("changeQuestion", true) !== false;
  /** Whether this session's history is its own client's (isClientView): the pages speak for the client's side. */
  const isClient = () => isClientView(ctx.view());
  /** Whether the session runs on a coding agent (HarnessV3-ACP AC5-8): the pages speak for the agent's context. */
  const isAgent = () => !isClient() && !!ctx.live()?.agent;
  /** The agent's name as its accounts give it ("Claude Code"), else "The agent". */
  const agentName = () => String(ctx.accounts?.session?.()?.agentName || "The agent");
  /** Whether Filament keeps its copy of an agent's chat in step with the agent (`context.compaction.follow`). */
  const follows = () => knob("follow", true) !== false;
  /** The session's way (`context.compaction.agent`). */
  const chosenWay = () => {
    const v = String(knob("agent", "suggested"));
    return WAYS.some((x) => x.id === v) ? v : "suggested";
  };
  /** A way's name, the agent's in it. @param {string} id */
  const wayName = (id) => (WAYS.find((x) => x.id === id) || WAYS[0]).name(agentName());
  /** A way's name inside a sentence. @param {string} id */
  const wayWords = (id) => (id === "suggested" ? "the suggested way" : wayName(id).replace(/^The /, "the "));
  /** A way's thumb: its glyph, or — Ours — the method in force. @param {typeof h} m @param {string} id */
  const wayThumb = (m, id) => {
    const glyph = (WAYS.find((x) => x.id === id) || WAYS[0]).glyph;
    return glyph ? m("span", { class: "inst-thumb is-glyph", html: ICONS[glyph] }) : m("span", { class: "inst-thumb", html: methodThumb(method() ?? "summary") });
  };
  /** A client's session's client, in its own name ("Codex"). */
  const clientName = () => String((ctx.view()?.windows || []).find((/** @type {any} */ w) => w?.window !== "harness")?.clientLabel || "Your client");
  /** The way in force (sessionMethod); null in a client's session. */
  const method = () => sessionMethod(ctx.view());
  const writerChoice = () => {
    const v = knob("writer", null);
    return v === "session" || v === "model" ? v : null;
  };
  const keepWhole = () => Math.max(0, Math.min(10, Math.round(Number(knob("keepWhole", 1)) || 0)));
  /** The instant line (`context.compaction.instantTokens`): what an instant fold may leave of the earlier turns; 0, never. */
  const instantTokens = () => {
    const v = Math.round(Number(knob("instantTokens", 20_000)));
    return Number.isFinite(v) && v >= 0 ? v : 20_000;
  };
  /** A method's name with this session's number in it: "Instant fold, newest 1 whole". @param {string | null | undefined} id */
  const nameOf = (id) => methodName(id, { keepWhole: keepWhole() });
  /** A way in the card's plain words (proposal_ux §4.12: "Instant fold"); the method's own name where the card has
   *  none. @param {string | null | undefined} id */
  const plainOf = (id) => roomWords(String(id ?? ""))?.name || nameOf(id);
  const namedModel = () => String(knob("model", "") || "");
  /** The kind in force, as the card names it: the one the session chose (`sessionKind`), else the rule's — a model
   *  named writes, a side model, else the same model. */
  const kind = () => sessionKind(ctx.view()) ?? (namedModel() ? "side" : "same");
  const window = () => windowFacts(ctx.view(), ctx.live()).window;
  /** What the window holds, and whether a count stands behind it: an agent's draft is no count (HarnessV3-ACP AC3-5). */
  const heldFig = () => {
    const l = ctx.live() || {};
    return heldFigure({ rec: l.rec, usage: l.usage, facts: l.facts || ctx.view()?.facts || null, liveOut: 0, estimate: l.estimate || 0, liveHeld: l.liveHeld || 0, agent: !!l.agent });
  };
  const held = () => heldFig().tokens;
  /** The plan from a preview answer: the compactor's; a client's session has none. @param {any} pv */
  const planOf = (pv) => (pv?.compaction?.native ? pv.compaction : null);

  /**
   * Every method weighed, one radio row each (the How page's list; the Context tab's Makes room by): thumbnail · name
   * and one line, or why it can't run now · what the next request would weigh. An instant fold says what it leaves of
   * the earlier turns, and where that is over the instant line, that the card offers it only under it. The choice is
   * written as `context.compaction.method`.
   * @param {typeof h} m @param {any} plan @param {any} pv
   */
  const methodList = (m, plan, pv) => {
    const cur = method();
    const scale = Number(plan?.window) || Math.max(Number(plan?.now) || 0, 1);
    /** One radio row: thumbnail · name and one line (or why it can't) · what the next request would weigh. @param {string} id */
    const methodRow = (id) => {
      const on = cur === id;
      const est = plan?.methods?.[id] || null;
      const off = !!plan && !est?.possible;
      const plain = roomWords(id);
      const line = plain?.line || methodOf(id).line;
      const name = plain?.name || nameOf(id);
      // What a fold leaves of the earlier turns, the figure the instant line counts.
      const earlier = id === "fold" && est?.earlier != null
        ? ` · leaves ${tok(Number(est.earlier))} of the earlier turns${est.instant === false && est.instantWhy ? Number(plan?.instantTokens) > 0 ? ", over the instant line: the card offers it, never recommends it" : ", the instant fold off: the card does not offer it" : ""}`
        : "";
      return m("button", {
        class: `inst-row inst-view-row inst-method-row is-button${on ? " is-on" : ""}${off ? " is-off" : ""}`,
        type: "button",
        role: "radio",
        "aria-checked": on ? "true" : "false",
        ...(off ? { "aria-disabled": "true" } : {}),
        title: off ? String(est?.why || "") : on ? `${name} is how this session compacts` : `Compact this way from now on`,
        onclick: () => { if (!off && !on) ctx.write({ patch: { context: { compaction: { method: id } } } }); },
      },
        m("span", { class: "inst-thumb", html: methodThumb(id) }),
        m("span", { class: "inst-row-text" },
          m("span", { class: "inst-row-label" }, name, on ? m("span", { class: "inst-inline-check", html: ICONS.check }) : null),
          m("span", { class: "inst-row-sub" }, off ? String(est?.why || "") : line),
          !pv ? m("span", { class: "inst-skel", style: "width:90px" }) : !off && est ? m("span", { class: "inst-method-cost" }, `${costWords(id, est)}${earlier}${noSmaller(est, plan?.now, isAgent() ? plan?.agent : null) ? ` · ${NO_SMALLER}` : ""}`) : null),
        m("span", { class: "inst-view-fig" },
          !pv ? m("span", { class: "inst-skel", style: "width:34px" }) : est && !off ? m("b", {}, `${est.exact ? "" : "≈"}${tok(est.after)}`) : m("b", {}, "—"),
          est && !off ? m("span", { class: "inst-view-bar inst-method-bar" }, m("span", { style: `width:${Math.max(3, Math.min(100, (est.after / scale) * 100))}%` })) : null));
    };
    return m("div", { class: "inst-group", role: "radiogroup", "aria-label": "How compaction makes room" }, ...METHODS.map((x) => methodRow(x.id)));
  };

  /**
   * The method's own control, under its list: how many of the newest turns an instant fold keeps whole. One summary has
   * none.
   * @param {typeof h} m
   */
  const methodControl = (m) => {
    if (method() !== "fold") return null;
    return group(m, row(m, {
      label: "Keep whole",
      sub: "The newest finished turns, as they are",
      trailing: segmented(m, {
        options: [0, 1, 2, 3].map((n) => ({ id: String(n), label: String(n) })),
        value: () => String(keepWhole()),
        ariaLabel: "The newest finished turns kept whole",
        onChange: (id) => { if (Number(id) !== keepWhole()) ctx.write({ patch: { context: { compaction: { keepWhole: Number(id) } } } }); },
      }).el,
    }));
  };

  /** The instant line's choices, in tokens: off, then the steps a person reaches for; the session's own where it is none of them. */
  const INSTANT_STEPS = [0, 10_000, 20_000, 40_000];
  /**
   * The instant line (`context.compaction.instantTokens`, the owner's rules of 10-31): the most an instant fold may
   * leave of the earlier turns — the system prompt and the tools not counted — for the card to offer it, and for a side
   * model to fold in place of a summary of turns too big for it whole. Off, never.
   * @param {typeof h} m @param {any} plan
   */
  const instantRow = (m, plan) => {
    const v = instantTokens();
    const steps = INSTANT_STEPS.includes(v) ? INSTANT_STEPS : [...INSTANT_STEPS, v].sort((x, y) => x - y);
    const fold = plan?.methods?.fold;
    const now = fold?.possible && fold.earlier != null ? `A fold now leaves ${tok(Number(fold.earlier))} of them` : "";
    return row(m, {
      label: "Instant fold up to",
      sub: [v ? "What a fold may leave of the earlier turns, for the card to offer it" : "Off: the card never offers an instant fold", now].filter(Boolean).join(" · "),
      trailing: segmented(m, {
        options: steps.map((n) => ({ id: String(n), label: n ? tok(n) : "Off" })),
        value: () => String(instantTokens()),
        ariaLabel: "The most an instant fold may leave of the earlier turns",
        onChange: (id) => { if (Number(id) !== instantTokens()) ctx.write({ patch: { context: { compaction: { instantTokens: Number(id) } } } }); },
      }).el,
    });
  };

  /**
   * The ways an agent's session makes room (HarnessV3-ACP AC5-8): the session's checked, the one Compact now takes
   * marked Now; a way the agent lacks now stays choosable — the suggestion stands in until it has it.
   * @param {typeof h} m @param {any} a  the plan's `agent`, null before the figures
   */
  const waysGroup = (m, a) => {
    const chosen = chosenWay();
    const running = a ? wayNow(a, Date.now()) : null;
    return m("div", { class: "inst-group", role: "radiogroup", "aria-label": "How this session makes room" }, ...WAYS.map((x) => {
      const on = chosen === x.id;
      const lacks = !!a && ((x.id === "own" && !a.own) || (x.id === "self" && !a.self));
      return m("button", {
        class: `inst-row inst-view-row inst-way-row is-button${on ? " is-on" : ""}`,
        type: "button",
        role: "radio",
        "aria-checked": on ? "true" : "false",
        title: on ? `${wayName(x.id)}: how this session makes room` : "Make room this way from now on",
        onclick: () => { if (!on) ctx.write({ patch: { context: { compaction: { agent: x.id } } } }); },
      },
        wayThumb(m, x.id),
        m("span", { class: "inst-row-text" },
          m("span", { class: "inst-row-label" }, wayName(x.id), on ? m("span", { class: "inst-inline-check", html: ICONS.check }) : null),
          m("span", { class: "inst-row-sub" }, lacks ? `${NOT_OFFERED[x.id === "own" ? "own" : "self"]}; the suggestion stands in` : x.line)),
        m("span", { class: "inst-view-fig" }, running === x.id ? m("b", {}, "Now") : null));
    }));
  };

  /**
   * Who writes a summary: the same model — the session's own, from its warm cache when the cache can take a summary —
   * or a side model, the one named, else memory's model where one is set; the two side by side, with what each would cost, how it
   * reads the turns (`readsWords`), its window, and how long the cache stays warm. Chosen by neither, the rule stands:
   * a model named writes, else the same model. `bare` leaves out its title, for a row that names it already (the
   * Context tab's Summaries written by). `waiting`: the chat's preview is on its way, so its writers are drawn as
   * placeholders; with no chat to weigh (your defaults) there are none to draw.
   * @param {typeof h} m @param {any} plan @param {{ bare?: boolean, waiting?: boolean }} [o]
   */
  const writerSection = (m, plan, o = {}) => {
    // An agent's session (HarnessV3-ACP AC5-2): Filament's summary is written by the side model — a model Filament
    // calls, or a coding agent's in a session of its own; the chat's agent writing it in its own session is a way of
    // its own, so there is no writer to choose.
    const agent = isAgent();
    const choice = writerChoice();
    const shownChoice = choice ?? (namedModel() ? "model" : "session");
    const seg = agent ? null : segmented(m, {
      options: [
        { id: "session", label: "Same model", title: "The chat's own model — from its warm cache when it can" },
        { id: "model", label: "Side model", title: "The side model you pick below — else memory's model" },
      ],
      value: () => shownChoice,
      ariaLabel: "Who writes a compaction's summary",
      // The one shown is the rule's answer where none is chosen: pressing it again chooses nothing.
      onChange: (id) => { if (id !== shownChoice) ctx.write({ patch: { context: { compaction: { writer: id } } } }); },
    });
    const w = plan?.writers || {};
    const cache = w.cache || null;
    const costs = [w.session?.cost, w.side?.cost].filter((c) => c != null);
    const most = Math.max(...costs, 0) || 1;
    const chosenModel = w.chosen?.model || null;
    /**
     * What a writer would pay: "≈ $0.29", or on a subscription plan "On your plan · ≈ $0.29 at list price" — or, where its
     * reading is the instant fold, nothing: "Free · no model call".
     * @param {any} wr
     */
    const writerPrice = (wr) =>
      wr.reads === "instant" ? costWords("summary", wr)
        : wr.cost == null ? "unpriced" : onPlan(wr) ? `On your plan${wr.listCost ? ` · ≈ ${usd(wr.listCost)} at list price` : ""}` : `≈ ${usd(wr.cost)}`;
    /** One writer: its model, what it would read from, its cost as a bar against the dearer. @param {any} wr @param {string} sub */
    const writerRow = (wr, sub) => m("div", { class: `inst-row inst-writer-row${chosenModel && wr.model === chosenModel ? " is-on" : ""}` },
      m("span", { class: "inst-row-text" },
        m("span", { class: "inst-row-label" }, shortModel(wr.model), chosenModel && wr.model === chosenModel ? m("span", { class: "inst-inline-check", html: ICONS.check }) : null),
        m("span", { class: "inst-row-sub" }, sub)),
      m("span", { class: "inst-view-fig" },
        m("b", {}, writerPrice(wr)),
        wr.cost != null && wr.reads !== "instant" ? m("span", { class: "inst-view-bar" }, m("span", { style: `width:${Math.max(3, Math.round((wr.cost / most) * 100))}%` })) : null));
    const windowWords = (/** @type {any} */ wr) => (wr?.windowSource === "assumed" ? `${tok(wr.window)} assumed` : wr?.window ? `${tok(wr.window)} window` : "");
    /** How a writer reads the turns, where it does not read the cache. @param {any} wr */
    const reading = (wr) => (wr?.reads && wr.reads !== "fork" ? readsWords(wr) : "");
    // What the same model would read from: its warm cache (and for how long), or — cold, uncached, too full to hold a
    // summary — everything as new input (the row's price says so).
    const cacheWords = !cache || cache.state === "none"
        ? "Same model · nothing cached yet"
        : cache.state === "uncached"
          ? "Same model · its replies wrote no cache"
          : cache.state === "cold"
            ? "Same model · cache gone cold"
            : cache.forkRoom == null
              ? `Same model · cache too full for a summary`
              : `Same model · warm cache, ${clock(cache.leftMs)} left`;
    const picker = agent || shownChoice === "model"
      ? (() => {
          const sel = modelSelect({ onChange: (name) => { if (name && name !== namedModel()) ctx.write({ patch: { context: { compaction: { model: name } } } }); } });
          sel.setModels(ctx.models?.() || []);
          if (namedModel()) sel.set(namedModel());
          // No model named: memory's model writes — say which, rather than ask.
          const now = !namedModel() && w.side?.model ? `Now memory's model, ${shortModel(w.side.model)}` : "";
          return row(m, { label: "Side model", sub: namedModel() ? "" : now || "Pick the model that writes summaries", trailing: sel.el });
        })()
      : null;
    const writers = plan
      ? group(m, ...kids([
          w.session ? writerRow(w.session, [cacheWords, reading(w.session)].filter(Boolean).join(" · ")) : null,
          w.side && w.side.model !== w.session?.model
            ? writerRow(w.side, ["Side model", w.side.agentWriter ? "a coding agent, in a session of its own" : "", windowWords(w.side), reading(w.side)].filter(Boolean).join(" · "))
            : null,
          picker,
        ]))
      : o.waiting
        ? group(m, ...kids([m("div", { class: "inst-row" }, m("span", { class: "inst-skel", style: "width:180px" })), picker]))
        : picker ? group(m, picker) : null;
    return o.bare ? m("div", { class: "inst-section" }, ...kids([seg?.el, writers])) : section(m, "Written by", seg?.el, writers);
  };

  /**
   * The compactions so far, the four newest first; the newest with Undo while nothing has been sent since (Undo, then
   * `close`).
   * @param {typeof h} m @param {any[]} list  the preview's `compactions`, oldest first @param {() => void} close
   */
  const historyRows = (m, list, close) => group(m, ...list.slice(-4).reverse().map((/** @type {any} */ c) => row(m, {
    icon: "foldVertical",
    label: historyLabel(c),
    sub: `${ago(Number(c.at))}${compactionFacts(c)}`,
    trailing: c.undoable
      ? m("button", { class: "inst-link inst-undo", type: "button", title: "Take this compaction back: the next request sees those turns as it did before", onclick: () => { ctx.undoCompaction(Number(c.id)); close(); } }, "Undo")
      : null,
  })));

  /**
   * In a coding agent's session, why Compact now takes the way it takes, and what that leaves, in a line: "Suggested:
   * its cache is warm, 2:30 left · in a fork, read-only" — a way of the agent's own after its session opening first,
   * where it does, as the card's choice says (`agentWays`). Its own compaction leaves what it decides; the summary it
   * writes for Filament is the summary method's; Filament's copy is the method in force's, in the card's words. "" before the
   * plan's word on the session. A summary the agent writes needs no model of Filament's, so that lack alone (the
   * estimate's `status`: the writer is all that is missing) is no reason against it. `named`: the row above already
   * says "Suggested · <the way> now", so the line drops "Suggested:", and a reason that only names the way again ("its
   * own compaction") goes (HarnessV4_Tasks U3, V4-D217).
   * @param {any} plan @param {number} now @param {{ named?: boolean }} [o]
   */
  const wayLine = (plan, now, { named = false } = {}) => {
    const a = plan?.agent;
    if (!a) return "";
    const id = wayNow(a, now);
    const shown = id === "self" ? "summary" : id === "ours" ? method() : null;
    const est = shown ? plan?.methods?.[shown] : null;
    const after = est ? afterWords(est, a, plan?.now) : "";
    const cannot = est?.possible === false && !(id === "self" && est.status === 400);
    const first = a.opens ? "opens its session first" : "";
    const detail = id === "own"
      ? !a.own ? "" : [first, a.own === "fork" ? "forked first, so Undo brings its session back" : a.opens ? "in its session" : "in its live session"].filter(Boolean).join(" · ")
      : !est ? ""
      : cannot ? String(est.why || "")
      : id === "self" ? [first, after, `${a.self === "fork" ? "in a fork" : "in its session"}, read-only`].filter(Boolean).join(" · ")
      : [plainOf(shown), after, costWords(/** @type {string} */ (shown), est, { model: true })].filter(Boolean).join(" · ");
    const reason = wayReason(a, id, now);
    const why = !named ? reason : id === "own" && a.suggested ? "" : reason.replace(/^Suggested: /, "");
    return [why, detail].filter(Boolean).join(" · ").replace(/^./, (c) => c.toUpperCase());
  };

  return {
    knob, percent, mode, asksCold, asksChanged, isClient, isAgent, agentName, chosenWay, follows, wayName, wayWords, wayThumb, clientName,
    method, writerChoice, keepWhole, instantTokens, nameOf, plainOf, namedModel, kind, window, heldFig, held, planOf,
    methodList, methodControl, instantRow, waysGroup, writerSection, historyRows, wayLine,
  };
}
