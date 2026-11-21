// @ts-check
// The Context instrument (HarnessV3 Step 6 design; the live control, HarnessV4_Tasks U3-2): how full the window is,
// and with what. The face, in the composer's typing row, is a small ring filling toward the compaction line's notch,
// and the percent. The popover is a stacked bar of the window's contents — system and tools, memory, messages, tool
// work, thinking, sub-agents — on the window's own scale, the compaction line its thumb (dragged within the band it may
// take) and a coding agent's own point marked where it is not the line; the legend under it in Filament's sessions; one
// sentence for the room before the line, who makes room and where (U3.3); the instant fold's offer with its count
// (the owner's rules of 10-31); Compact now…, which opens the card that asks with every way (proposal_ux §4.12, D6),
// and Stop and compact whenever a turn runs — in its place past a line an agent can't act on mid-turn (U2); the sheet How earlier turns are kept; Dry run and the Context map in Filament's sessions. Your line is
// labelled under the bar, a chip whose menu holds its stops and a number of your own (§4.12 step 2), and its thumb
// still drags. Every window figure is the server's: the window of the model in force comes with the session's settings
// (`settings.window`), the last request's verdict with its record or the turn's facts, the agent's point with its turn
// (A3); the line is the session's `context.compaction.thresholdPercent` of the window. A coding agent's session reads as the agent counts it
// (HarnessV3-ACP AC3-5): its own figure as it works and at its turn's end, the window it names, ≈ where Filament's
// estimate stands in — its line the same share of that window (AC5-3); its parts are not named, and Compact now takes
// its way (AC5-8). A client's session has no line of Filament's: its client compacts by itself. Tokens processed live
// in Spend. As a browser shows it (HarnessV4_Tasks U3, V4-D211 to V4-D214): the band shows only while the line is
// handled, "≈" is said once, how a figure is counted is its title, and the model is named as the composer's chip names
// it.
import { h, morphChildren } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { nameIn, roomWords, CARRY_WORDS } from "../../lib/context-words.js";
import { windowSourceWords, verdictWords, agentWindowWords } from "../lib/labels.js";
import { prettyModel } from "../lib/families.js";
import { menu } from "../lib/ui.js";
import { head, ringSvg, legend, link, note, slider, icon, tok, pct, kids, stackBar, barStrip } from "./kit.js";
import { foldColumns } from "../lib/overview.js";
import { LINE_MIN, LINE_MAX, WAYS, compactionParts, foldOfferWords, isClientView } from "./compaction.js";

/** The line's own stops in its menu (proposal_ux §4.12 step 2): a percent of the window. */
export const LINE_STOPS = Object.freeze([50, 70, 85, 95]);
/** The sheet the popover's link opens (how-sheet.js's title). */
const HOW_LINK = "How earlier turns are kept";

/**
 * A line typed in words: a percent ("40", "40%") — a bare number up to 100 is one —, or tokens ("400k", "1m",
 * "400000") as a share of the window. On the line's band (LINE_MIN to LINE_MAX), whole; null where the words name no
 * line, or tokens with no window to measure them against.
 * @param {string} text @param {number} window
 */
export function lineFromWords(text, window) {
  const s = String(text || "").trim().toLowerCase().replace(/,/g, "");
  if (!s) return null;
  const pctMatch = /^(\d+(?:\.\d+)?)\s*%$/.exec(s) || (/^\d+(?:\.\d+)?$/.test(s) && Number(s) <= 100 ? [s, s] : null);
  const tokens = pctMatch ? null : windowTokensOf(s);
  const v = pctMatch ? Number(pctMatch[1]) : tokens != null && window > 0 ? (tokens / window) * 100 : NaN;
  return Number.isFinite(v) && v > 0 ? onBand(v) : null;
}

/**
 * Your line as a chip (proposal_ux §4.12 steps 2 and 4), the ring's popover's and the sheet's: its tokens and its share
 * of the window, and a menu of the line's stops — each with its tokens where the window is known — and Type a number…,
 * which puts a field in the chip's place: a percent or tokens (`lineFromWords`), set on Enter, left as it was on blur.
 * `percent`: where the line stands, the menu's check; `onSet`: a line picked or typed, on the band.
 * @param {typeof h} m
 * @param {{ percent: () => number, window: () => number, onSet: (v: number) => void, toast: (msg: string, kind?: string) => void,
 *   drawIn?: (parent: any, nodes: any[]) => void }} o  `drawIn`: how the chip's words go into it — in place by default
 * @returns {{ chip: any, field: any, paint: (at: { tokens: number, percent: number } | null) => void }}
 */
export function lineControl(m, o) {
  const drawIn = o.drawIn || morphChildren;
  const chip = m("button", { class: "inst-line-chip", type: "button", "aria-haspopup": "menu", title: "Where the chat counts as full: pick a stop, or type a number" });
  const field = m("input", { class: "inst-field is-line inst-line-field hidden", type: "text", inputmode: "numeric", placeholder: "40% or 400k", "aria-label": "Your line: a percent of the window, or tokens" });
  const leave = () => {
    field.classList.add("hidden");
    chip.classList.remove("hidden");
  };
  field.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const w = o.window();
    const v = lineFromWords(field.value, w);
    if (v == null) return o.toast(w ? `A line is a percent of the window (${LINE_MIN}–${LINE_MAX}%) or tokens: 40%, 400k` : `A line is a percent of the window: ${LINE_MIN}–${LINE_MAX}%`, "err");
    leave();
    o.onSet(v);
  });
  field.addEventListener("blur", leave);
  chip.addEventListener("click", () => {
    const w = o.window();
    const at = o.percent();
    menu([
      ...LINE_STOPS.map((p) => ({ type: "radio", label: `${p}%`, desc: undefined, note: w ? tok(Math.floor((w * p) / 100)) : undefined, checked: p === at, onClick: () => o.onSet(p) })),
      { type: "separator" },
      {
        label: "Type a number…",
        icon: "pencil",
        onClick: () => {
          field.value = `${o.percent()}%`;
          chip.classList.add("hidden");
          field.classList.remove("hidden");
          field.focus();
          field.select?.();
        },
      },
    ], { anchor: chip, side: "bottom", align: "start", width: 200 });
  });
  return {
    chip,
    field,
    // Drawn again at every frame of a reply: in place, the words a press lands on the ones that stood (the owner's of
    // 11-01: buttons blinking under a resting pointer, clicks lost).
    paint: (at) => drawIn(chip, kids([at ? (at.tokens ? `${tok(at.tokens)} · ${at.percent}%` : `${at.percent}%`) : "—", icon(m, "chevronDown", "inst-line-chev")])),
  };
}

/** The three kinds as the popover's Makes room by writes them (the owner's rules of 10-31). @type {Record<string, Record<string, string>>} */
const KIND_PATCH = { same: { method: "summary", writer: "session" }, side: { method: "summary", writer: "model" }, fold: { method: "fold" } };

/**
 * What the Context popover's Makes room by offers (the design pass of 10-24), in the card's names: a coding agent's
 * ways, or the three kinds — the same model, a side model, the instant fold — each with its one line and the patch it
 * writes.
 * @param {ReturnType<typeof compactionParts>} cp @param {boolean} agent
 * @returns {{ id: string, label: string, desc: string, patch: Record<string, string> }[]}
 */
export const roomChoices = (cp, agent) => (agent
  ? WAYS.map((x) => ({ id: x.id, label: cp.wayName(x.id), desc: x.line, patch: { agent: x.id } }))
  : Object.keys(KIND_PATCH).map((id) => ({ id, label: roomWords(id)?.name || id, desc: roomWords(id)?.line || "", patch: KIND_PATCH[id] })));

/** The conversation's classes in a composition (core/fold.js), sub-agents' share among them. */
const MESSAGE_CLASSES = Object.freeze(["userText", "assistantText", "toolUse", "toolResult", "thinking", "subagents"]);

/**
 * The agent turn's end state (agent/turn.js stamps its newest round as `context.last`): that round's prompt as the
 * provider counted it and what it was made of. The record's own token columns are round one's — where the turn began.
 * @param {any} rec
 */
const endStateOf = (rec) => {
  const last = rec?.context?.last;
  return last && Number(last.held) > 0 && last.composition && typeof last.composition === "object" ? last : null;
};

/**
 * The §9 B8 arithmetic: estimated tokens per segment, zero segments dropped. On an agent turn the loop restamps
 * `view.composition` with the system text and tool set it actually sends (agent/turn.js), so System and Tools are
 * measured from the wire body, not the composer's dry run (which carries neither). An agent turn's rows describe
 * its end — its newest round — when the record carries it, so the work the turn did (sub-agents' calls, results and
 * reports among it) is in them. Sub-agents is carved out of the conversation by its share of the characters. Where the
 * record keeps the composer's figure for the prompt and tools (`view.fixedTokens`, LD-D17), System & tools is that.
 * A coding agent's turn has no rows (HarnessV3-ACP AC3-5).
 * @param {any} rec
 * @param {number | null} [heldReal]  the provider's count of the prompt; defaults to the record's own token columns
 * @returns {{ rows: [string, number][], measured: boolean, reconciled: boolean, sysItemised: boolean, mismatch: { estimate: number, real: number } | null }}
 */
export function contextSources(rec, heldReal = null) {
  // A coding agent keeps its own context — its prompt, its tools, its conversation — and reports it whole: what
  // Filament composed for the turn is not what the agent holds, so there are no parts to name.
  if (rec?.acp) return { rows: [], measured: false, reconciled: false, sysItemised: false, mismatch: null };
  const view = rec?.view;
  const mem = rec?.memory?.composition || {};
  const last = endStateOf(rec);
  const comp = last ? last.composition : view?.composition || {};
  const standing = (mem.briefing || 0) + (mem.goal || 0);
  /** @type {[string, number][]} */
  const memRows = [
    ["Briefing", mem.briefing || 0],
    ["Goal", mem.goal || 0],
    // memory.tokens is the per-turn material with the briefing inside on the turn it was built; the briefing has its row.
    ["Memory blocks", Math.max(0, (rec?.memory?.tokens || 0) - (mem.briefing || 0))],
  ];
  const histTok = Number(view?.historyTokens) || 0;
  // shapedTokens is the composer's history-scoped count; a client's own request states sentTokens alone, over the
  // same messages as its historyTokens.
  const shapedTok = Number(view?.shapedTokens ?? view?.sentTokens) || 0;
  const heldBack = view ? Math.max(0, histTok - shapedTok) : 0;
  // The composer's body carries no system text and no tools on an agent turn (the loop adds both on the way out),
  // so its composition says system = `""` and tools = `[]` — 2 characters each. A char count that small is "not in
  // this body", not a measurement.
  const sysEst = (Number(comp.system) || 0) > 2 || (Number(comp.tools) || 0) > 2
    ? Math.max(0, fmt.tokens(comp.system) + fmt.tokens(comp.tools) - standing)
    : null;
  // The composer's figure for the prompt and tools where it weighed them, the one the Map and /autofit say
  // (HarnessV3-Launch LD-D17). A record without it — a client's session, which sends its own — keeps the rule below:
  // they are what the count leaves.
  const fixed = Number(view?.fixedTokens) > 0 ? Number(view.fixedTokens) : null;
  // The provider's own count of the prompt (input + cache read + cache write) — the header's held number.
  const t = rec?.tokens || {};
  const real = last ? Number(last.held) : heldReal != null ? Number(heldReal) || 0 : (Number(t.input) || 0) + (Number(t.cacheRead) || 0) + (Number(t.cacheWrite) || 0);
  const memTotal = memRows.reduce((n, [, v]) => n + v, 0);
  const msgChars = MESSAGE_CLASSES.reduce((n, k) => n + (Number(comp[k]) || 0), 0);
  const subShare = msgChars ? Math.min(1, (Number(comp.subagents) || 0) / msgChars) : 0;
  const measured = !!view || !!last;
  // The end state's conversation is its characters on the composer's calibrated scale — the composer's own count
  // is the turn's first request.
  let conversation = last ? Math.round(fmt.tokens(msgChars) * (Number(view?.factor) > 0 ? Number(view.factor) : 1)) : view ? shapedTok : 0;
  let sysTools = fixed ?? sysEst ?? 0;
  /** @type {{ estimate: number, real: number } | null} */
  let mismatch = null;
  if (measured && real > 0 && fixed != null) {
    // One figure: the conversation is what the count leaves after memory and the prompt and tools; a count smaller than
    // those leaves none, and the rows drop it (and its sub-agents' share) below. The parts as estimated are memory, the
    // figure and the history; a gap past 15% says they don't describe the wire.
    const estimate = memTotal + fixed + conversation;
    if (estimate > real * 1.15) mismatch = { estimate, real };
    conversation = real - memTotal - fixed;
  } else if (measured && real > 0) {
    // Reconciled to the provider's count, so the rows add up to the header instead of contradicting it. System and
    // tools are what the provider counted beyond the history and the memory blocks.
    const rest = real - memTotal - conversation;
    if (rest >= 0) sysTools = rest;
    else {
      // The history estimate is LARGER than the whole prompt the provider counted. A few percent is the estimator's
      // usual overshoot (measured ~5% even calibrated), and it swallows the system/tools share — which an agent turn
      // cannot itemise client-side. The rows are scaled to the real count; only a gap past 15% is called out, since
      // then the estimate is not describing what reached the wire.
      const estimate = memTotal + conversation;
      if (estimate > real * 1.15) mismatch = { estimate, real };
      const s = real / estimate;
      for (const r of memRows) r[1] = Math.round(r[1] * s);
      conversation = Math.max(0, real - memRows.reduce((n, [, v]) => n + v, 0));
      sysTools = 0;
    }
  }
  const subagents = Math.round(conversation * subShare);
  /** @type {[string, number][]} */
  const rows = [["System & tools", sysTools], ...memRows, ["Sub-agents", subagents], ["Conversation", conversation - subagents], ["Held back", heldBack]];
  return { rows: rows.filter(([, n]) => n > 0), measured, reconciled: measured && real > 0, sysItemised: sysTools > 0, mismatch };
}

/** The fixed seat of each source's color, keyed to the label, not the row position (the inspector's breakdown). */
const SEATS = Object.freeze({ "System & tools": 1, Briefing: 2, Goal: 3, "Memory blocks": 5, Conversation: 6, "Sub-agents": 8 });
/** Held back has no seat: it is the hatch. @param {string} label @returns {number | null} the breakdown color index (1..8) */
export const sourceTint = (label) => (Object.hasOwn(SEATS, label) ? SEATS[/** @type {keyof typeof SEATS} */ (label)] : null);

/**
 * The window's contents as the donut draws them: the sources above, memory as one part, the conversation split by
 * its characters into messages, tool work and thinking (sub-agents already carved out). Each part keeps its fixed
 * color, so a missing middle part never re-seats the rest.
 * @param {any} rec @param {number | null} [heldReal]
 * @returns {{ parts: { key: string, label: string, tokens: number, color: string }[], heldBack: number, measured: boolean, mismatch: { estimate: number, real: number } | null }}
 */
export function windowParts(rec, heldReal = null) {
  const src = contextSources(rec, heldReal);
  const of = (/** @type {string} */ label) => src.rows.find(([l]) => l === label)?.[1] || 0;
  const comp = endStateOf(rec)?.composition || rec?.view?.composition || {};
  const c = (/** @type {string} */ k) => Number(comp[k]) || 0;
  const conversation = of("Conversation");
  const shares = { messages: c("userText") + c("assistantText"), tools: c("toolUse") + c("toolResult"), thinking: c("thinking") };
  const all = shares.messages + shares.tools + shares.thinking;
  const split = (/** @type {number} */ chars) => (all ? Math.round((conversation * chars) / all) : 0);
  const tools = split(shares.tools);
  const thinking = split(shares.thinking);
  // What rounding leaves goes to the messages, so the parts still add up to the conversation.
  const messages = all ? Math.max(0, conversation - tools - thinking) : conversation;
  const parts = [
    { key: "system", label: "System & tools", tokens: of("System & tools"), color: "var(--color-sys-gray)" },
    { key: "memory", label: "Memory", tokens: of("Briefing") + of("Goal") + of("Memory blocks"), color: "var(--color-sys-pink)" },
    { key: "messages", label: "Messages", tokens: messages, color: "var(--color-sys-blue)" },
    { key: "tools", label: "Tool work", tokens: tools, color: "var(--color-sys-cyan)" },
    { key: "thinking", label: "Thinking", tokens: thinking, color: "var(--color-sys-purple)" },
    { key: "subagents", label: "Sub-agents", tokens: of("Sub-agents"), color: "var(--color-sys-green)" },
  ].filter((p) => p.tokens > 0);
  return { parts, heldBack: of("Held back"), measured: src.measured, mismatch: src.mismatch };
}

/** What the last request carried, from the reply's usage (input plus the cache tokens — the prompt's real size). @param {any} usage */
export const heldFromUsage = (usage) =>
  usage ? (Number(usage.input_tokens) || 0) + (Number(usage.cache_read_input_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0) : 0;

/**
 * What a record measured of the prompt: what the session held at the turn's end, where the record says it — an agent
 * turn's newest round (its reply's usage and its record's columns are round one's), or a coding agent's own count of
 * its context (HarnessV3-ACP AC3-5: its record's columns add up every model call it made) — else the reply's usage,
 * else the record's own token columns (input alone would drop the cached share). 0 when it measured nothing: a call
 * stopped before the provider counted it.
 * @param {any} rec @param {any} [usage]
 */
export function recordHeld(rec, usage = null) {
  const t = rec?.tokens;
  return Number(rec?.context?.last?.held) || heldFromUsage(usage) || (t ? (Number(t.input) || 0) + (Number(t.cacheRead) || 0) + (Number(t.cacheWrite) || 0) : 0);
}

/** What a turn's facts (Facade D2) say it held: its newest round's count, else its newest request's; 0 for nothing. @param {any} facts */
export const factsHeld = (facts) => (Number(facts?.context?.held) > 0 ? Number(facts.context.held) : Number(facts?.held) || 0);

/**
 * What the meter reads once a compaction was written since the session's newest model turn — Compact now, or
 * `/autofit` (an Undo takes it back): the server's measure of the next request, the compose preview's `current`, as
 * facts. Exact, not an estimate; no verdict until it is sent. Null when nothing was compacted since (LD-D6, F20). In a
 * coding agent's session (HarnessV3-ACP AC5-8): after its own compaction, what it said it holds, in its window — or,
 * where it named nothing after it, no figure (`unsaid`) until its next turn counts; after one of Filament's, the
 * composition its next turn starts a fresh agent session from — an estimate, the agent adding its own prompt and
 * tools.
 * @param {any} current  the compose preview's `current`
 */
export function factsAfterCompaction(current) {
  if (!current?.compactedSince) return null;
  const own = current.agentHeld;
  if (Number(own?.held) > 0) return { held: Number(own.held), context: { window: Number(own.window) || null, usable: null, verdict: null, source: "agent" }, afterCompaction: true };
  if (own) return { held: 0, context: { window: Number(own.window) || null, usable: null, verdict: null, source: "agent" }, afterCompaction: true, unsaid: true };
  if (!(Number(current.whole) > 0)) return null;
  const fresh = "agentHeld" in current;
  return { held: Number(current.whole), context: { window: Number(current.window) || null, usable: Number(current.usable) || null, verdict: null, source: null, ...(fresh ? { estimated: true } : {}) }, afterCompaction: true };
}

/**
 * What the meter reads after a switch into a coding agent that holds none of the chat (HarnessV4_Tasks U3-10): the
 * composition its next turn starts a fresh agent session from — the compose preview's `current`, marked `freshStart`
 * by the server — an estimate, in the window of the model in force. The newest turn's count is what the engine that
 * answered last held, in its own window, and says nothing of this agent. Null where nothing was switched.
 * @param {any} current  the compose preview's `current`
 */
export function factsOfFreshStart(current) {
  if (!current?.freshStart || !(Number(current.whole) > 0)) return null;
  return { held: Number(current.whole), context: { window: Number(current.window) || null, usable: Number(current.usable) || null, verdict: null, source: null, estimated: true }, freshStart: String(current.freshStart.why || "switch") };
}

/**
 * The figure the meter shows, whether a real count stands behind it, and whether that count is an estimate: the
 * record's (recordHeld) with the streamed output folded in; else the newest turn's facts, which outlive the record
 * ring; else the typed estimate. A record or facts that measured nothing — a call stopped before the provider counted
 * it — is no figure (HarnessV3-Launch LD-D6). While a turn runs, the loop's own measure wins (BUG-20): `liveHeld` is
 * what the running round sent (its round-start's `context`), and only the output streamed since that round began
 * (`liveOut - liveOutBase`) is added — the previous turn plus everything streamed in a long turn (every round's
 * thinking) passed the window while the real conversation was far under it. In a coding agent's session
 * (HarnessV3-ACP AC3-5) `liveHeld` is the agent's own count as it works (`liveExact` false: Filament's estimate stands
 * in for it), a record's or facts' figure may be an estimate too, and a draft is no measure at all — the agent adds its
 * own prompt and tools — so nothing is said until the agent has counted.
 * @param {{ rec?: any, usage?: any, facts?: any, liveOut?: number, estimate?: number, liveHeld?: number, liveOutBase?: number,
 *   liveExact?: boolean, agent?: boolean }} s
 * @returns {{ tokens: number, known: boolean, estimated?: boolean }}
 */
export function heldFigure({ rec = null, usage = null, facts = null, liveOut = 0, estimate = 0, liveHeld = 0, liveOutBase = 0, liveExact = true, agent = false }) {
  if (Number(liveHeld) > 0) return { tokens: Number(liveHeld) + Math.max(0, (Number(liveOut) || 0) - (Number(liveOutBase) || 0)), known: true, ...(liveExact === false ? { estimated: true } : {}) };
  const fromRec = rec ? recordHeld(rec, usage) : 0;
  const held = fromRec || factsHeld(facts);
  if (held > 0) return { tokens: held + liveOut, known: true, ...((fromRec ? rec.context?.last?.estimated : facts?.context?.estimated) ? { estimated: true } : {}) };
  return { tokens: agent ? 0 : estimate, known: false };
}

/**
 * The window facts the widget shows, all the server's: the window of the model in force (the session's settings),
 * else the last request's; the compaction line, the verdict and the estimate from what the meter reads (its record
 * while the page has it, else its facts — after a compaction, the server's measure of the next request, which has no
 * verdict yet), else the newest turn's facts. A coding agent runs against its own window (HarnessV3-ACP AC3-5): the
 * one it names — as it works, else at its newest turn's end — wins over the one Filament reads from the model's name.
 * @param {any} view  the session view @param {any} live  the composer's live figures
 * @returns {{ window: number | null, source: string | null, usable: number | null, verdict: string | null }}
 */
export function windowFacts(view, live) {
  const inForce = view?.settings?.window || null;
  const last = live?.rec?.context || live?.facts?.context || view?.facts?.context || null;
  const named = !live?.agent ? 0 : Number(live.liveWindow) > 0 ? Number(live.liveWindow) : last?.source === "agent" && Number(last.window) > 0 ? Number(last.window) : 0;
  if (named) return { window: named, source: "agent", usable: null, verdict: null };
  const window = Number(inForce?.tokens) > 0 ? Number(inForce.tokens) : Number(last?.window) > 0 ? Number(last.window) : null;
  const source = Number(inForce?.tokens) > 0 ? inForce.source ?? null : last?.source ?? null;
  return { window, source, usable: Number(last?.usable) > 0 ? Number(last.usable) : null, verdict: last?.verdict ?? null };
}

/**
 * Where the next request compacts, as a fraction of the window and in tokens: the session's own percentage (the line
 * the next request is judged by — the last request's `usable` is one reply stale), else that stale edge, else none.
 * @param {any} view @param {number | null} window @param {number | null} usable
 * @returns {{ f: number, tokens: number, percent: number } | null}
 */
export function compactionLine(view, window, usable) {
  if (!window) return null;
  const knob = Number(view?.settings?.flat?.["context.compaction.thresholdPercent"] ?? view?.settings?.effective?.context?.compaction?.thresholdPercent);
  const percent = knob > 0 && knob <= 100 ? knob : usable ? (usable / window) * 100 : 0;
  if (!(percent > 0)) return null;
  return { f: Math.min(1, percent / 100), tokens: Math.floor((window * percent) / 100), percent: Math.round(percent) };
}

/**
 * The tokens a person's words name for a window — `200k`, `1m`, `200,000`, `200000` — or null (HarnessV4_Tasks C33).
 * @param {string} text @returns {number | null}
 */
export function windowTokensOf(text) {
  const t = String(text || "").trim().toLowerCase().replace(/[,_\s]/g, "").replace(/tokens?$/, "");
  const x = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(t);
  if (!x) return null;
  const n = Math.round(Number(x[1]) * (x[2] === "m" ? 1_000_000 : x[2] === "k" ? 1_000 : 1));
  return n >= 1000 ? n : null;
}

/**
 * What the Context popover says where the session's model has no window anyone knows, or has the one the person
 * said (HarnessV4_Tasks C33): null where another said it (the agent, the provider's listing, Filament's table, a wider
 * row of the dashboard's) — the header names that one.
 * @param {{ tokens?: number | null, source?: string | null, model?: string | null, settable?: boolean, own?: boolean } | null | undefined} w
 *   the session view's `settings.window`
 * @param {{ agent: boolean, named: boolean, modelName: string }} o  `named`: the agent has named its window itself
 * @returns {{ state: "unknown" | "yours", words: string } | null}
 */
export function windowAsk(w, { agent, named, modelName }) {
  if (!w?.settable || named) return null;
  if (!w.tokens)
    return {
      state: "unknown",
      words: agent
        ? `Nobody knows ${modelName}'s window: the agent names none, and Filament has no figure for it. So this session has no line: nothing asks before a message, and Filament makes no room. Say it once and every chat on this model has a line.`
        : `Nobody knows ${modelName}'s window, so Filament weighs its requests against an assumed 200,000 tokens and makes no room in the middle of a turn. Say it once and every chat on this model has a true line.`,
    };
  return w.own ? { state: "yours", words: `You said ${modelName}'s window: ${Number(w.tokens).toLocaleString()} tokens. It holds for every chat on this model.` } : null;
}

/** The composer's figures before it has any. */
const NO_LIVE = Object.freeze({ rec: null, usage: null, facts: null, liveOut: 0, estimate: 0, streaming: false });

/** A percent on the band the line may take (the slider's bounds, LINE_MIN to LINE_MAX). @param {number} v */
const onBand = (v) => Math.min(LINE_MAX, Math.max(LINE_MIN, Math.round(Number(v) || 0)));

/**
 * What the context ring shows of the session — the figure and whether a count stands behind it, the window, the
 * compaction line, the share held, its tone and colour, and the face's words — for the Context widget and the Team
 * view's leader card alike (HarnessV3-Views V3), so the two never read differently.
 * @param {any} view  the session view @param {any} live  the composer's live figures
 * @returns {{ tokens: number, known: boolean, estimated: boolean, window: number | null, line: { f: number, tokens: number, percent: number } | null,
 *   fill: number | null, tone: "" | "warn" | "error", color: string, text: string }}
 */
export function windowFace(view, live) {
  const l = live || NO_LIVE;
  const agent = !!l.agent;
  const wf = windowFacts(view, l);
  const fig = heldFigure({ rec: l.rec, usage: l.usage, facts: l.facts || view?.facts || null, liveOut: l.liveOut, estimate: l.estimate, liveHeld: l.liveHeld, liveOutBase: l.liveOutBase, liveExact: l.liveExact, agent });
  // A coding agent's session has its line too: the same share of the agent's window (HarnessV3-ACP AC5-3).
  const line = compactionLine(view, wf.window, wf.usable);
  // The share of the window held, 0..1, or null with no window known — or, in an agent's session, nothing counted yet.
  const fill = wf.window && (fig.known || !agent) ? Math.max(0, Math.min(1, fig.tokens / wf.window)) : null;
  // "" · warn (nearing the line) · error (past the line).
  /** @type {"" | "warn" | "error"} */
  const tone = wf.verdict === "over" || (fill != null && line && fill >= line.f) ? "error"
    : wf.verdict === "edge" || (fill != null && line && fill >= line.f * 0.85) ? "warn"
    : "";
  const color = tone === "error" ? "var(--color-sys-red)" : tone === "warn" ? "var(--color-sys-orange)" : "var(--color-sys-blue)";
  // While a turn streams the figure is the loop's own measure or the agent's count as it works, not the final count;
  // an estimate stays one after: "≈" on the ring's face too, as on the popover (the UI/UX review, 2026-09-30).
  const approx = l.streaming || fig.estimated ? "≈" : "";
  const p = fill == null ? 0 : fill * 100;
  // An empty draft before any reply has nothing to count: the hollow ring alone says so. "<1%" is a bound already, so
  // no "≈" before it (HarnessV4_Tasks U3, V4-D212).
  const text = fill == null
    ? (fig.tokens > 0 || fig.known ? `${approx}${tok(fig.tokens)}${fig.known ? "" : " est"}` : "")
    : p > 0 && p < 1 ? "<1%" : `${approx}${Math.round(p)}%`;
  return { tokens: fig.tokens, known: fig.known, estimated: !!fig.estimated, window: wf.window, line, fill, tone, color, text };
}

/**
 * Where a coding agent makes room by itself, as its newest turn says (HarnessV4_Tasks U3-2): `at`, its point, and
 * `line`, the line its session was handed (A3) — Claude Code's point is that line, or 67,000 under it and 967,000
 * over it. Null where none was handed (an older adapter, `CLAUDE_MODEL_CONFIG`, a first turn with no window
 * known, an agent that takes no line): it compacts at a point of its own, drawn once one is known. After a compaction
 * the newest turn's facts still say it.
 * @param {any} view  the session view @param {any} live  the composer's live figures
 * @returns {{ at: number, line: number | null } | null}
 */
export function agentPointOf(view, live) {
  const p = live?.rec?.context?.point || live?.facts?.context?.point || view?.facts?.context?.point || null;
  return Number(p?.at) > 0 ? { at: Number(p.at), line: Number(p.line) > 0 ? Number(p.line) : null } : null;
}

/**
 * The popover's one sentence (HarnessV4_Tasks U3.3, C26): the room before the line, who makes room, and where. A turn
 * that is running makes room by itself: Filament's loop at the line by its method, carrying on; a coding agent handed
 * the line (A3) there too, even mid-turn — at 67,000 at the earliest under it, at 967,000 before it over it — and it
 * takes a moved line as a turn starts; with no line handed it compacts at a point of its own and the line acts between
 * turns. A message you send past the line asks first (`ask`), or makes room first by itself. `point` is the agent's
 * (agentPointOf). It is "your line" in every session, the person's to drag; the loop's method is Compact now's to
 * name, below it (V4-D214).
 * @param {{ held: number, line: { tokens: number }, ask: boolean, agent: boolean, who: string,
 *   point: { at: number, line: number | null } | null, running: boolean }} s
 *   `who`: the agent's name ("Claude Code", "The agent")
 */
export function lineSentence(s) {
  const at = tok(s.line.tokens);
  const room = s.line.tokens - s.held;
  const who = s.who;
  const whoIn = who.replace(/^The /, "the ");
  if (!s.agent) {
    if (room > 0) return `${tok(room)} of room before your line (${at}). A running turn makes room there and carries on; ${s.ask ? "a message you send past it asks first" : "so does a message you send past it"}.`;
    if (s.running) return `Past your line (${at}) — the turn makes room at its next step.`;
    return s.ask ? `Past your line (${at}) — your next message asks how to make room first.` : `Past your line (${at}) — your next message makes room first.`;
  }
  const p = s.point;
  // The line its session took: the one it was handed is the line now.
  const taken = !!p && p.line === s.line.tokens;
  /** What a message sent past the line does, where the session asks first. */
  const asks = s.ask ? " A message you send past it asks first." : "";
  if (room <= 0) {
    if (!s.running) return s.ask ? `Past your line (${at}) — your next message asks how to make room first.` : `Past your line (${at}) — your next message makes room first.`;
    if (p && taken && s.held >= p.at) return `Past your line (${at}) — ${whoIn} compacts by itself at its next step.`;
    if (p && taken) return `Past your line (${at}) mid-turn. ${who} compacts by itself at ${tok(p.at)} at the earliest; Filament checks your line between turns.`;
    if (p) return `Past your line (${at}) mid-turn. ${who} takes your new line as a turn starts.`;
    return `Past your line (${at}) mid-turn. It acts between turns; ${whoIn} compacts by itself at its own point.`;
  }
  const before = `${tok(room)} before your line (${at}).`;
  if (p && taken && p.at === s.line.tokens) return `${before} ${who} compacts there by itself, even mid-turn.${asks}`;
  if (p && taken && p.at > s.line.tokens) return `Your line is ${at}. ${who} compacts by itself at ${tok(p.at)} at the earliest, even mid-turn; Filament checks your line between turns.${asks}`;
  if (p && taken) return `${who} compacts by itself at ${tok(p.at)}, before your line (${at}).${asks}`;
  if (p) return `${before} ${who} takes your new line as a turn starts.${asks}`;
  return `${before} Your line acts between turns. ${who} compacts by itself at its own point.${asks}`;
}

/**
 * Whether Stop and compact is offered (HarnessV4_Tasks U2, CW-D5): a coding agent's turn running past a line it can't
 * act on by itself — with no line handed or a moved one, or short of the point it took (a line under 67,000).
 * Filament's loop makes room at its line mid-turn by itself; a client decides for itself.
 * @param {{ held: number, line: { tokens: number } | null, agent: boolean, running: boolean,
 *   point: { at: number, line: number | null } | null }} s
 */
export function stopOffered(s) {
  if (!s.agent || !s.running || !s.line || s.held < s.line.tokens) return false;
  const p = s.point;
  return !(p && p.line === s.line.tokens && s.held >= p.at);
}

/**
 * @param {import("./registry.js").WidgetContext} ctx
 * @param {import("./frame.js").WidgetIO} [io]
 * @returns {import("./frame.js").WidgetSpec}
 */
export function contextWidget(ctx, io = {}) {
  const mk = io.h || h;
  // The open popover is drawn again at every frame of a reply: its parts in place (`painter`).
  const drawIn = io.drawIn || morphChildren;
  const live = () => ctx.live() || NO_LIVE;
  const facts = () => windowFacts(ctx.view(), live());
  const face = () => windowFace(ctx.view(), live());
  const figure = () => { const f = face(); return { tokens: f.tokens, known: f.known, estimated: f.estimated }; };
  /** The session's model is a coding agent's: it counts and compacts its own context (HarnessV3-ACP AC3-5). */
  const agent = () => !!live().agent;
  const line = () => face().line;
  const fill = () => face().fill;
  const tone = () => face().tone;
  const toneColor = () => face().color;
  const pctText = () => face().text;

  /** The room before the line, in the words a person would use: the pill's title, and the popover's sentence where it
   *  draws no line (no window known, no line, nothing counted yet). */
  const roomSentence = () => {
    const f = figure();
    const wf = facts();
    const l = line();
    // An agent that has counted nothing yet has no room to speak of.
    if (agent() && !f.known) return "";
    // No window: a draft needs no sentence (the legend says what the count is); a session's model without one does.
    if (!wf.window) return !f.known ? "" : agent() ? `${tok(f.tokens)} tokens held — the agent hasn't named its window.` : `${tok(f.tokens)} tokens held — this model's window isn't known, so there's no line to measure against.`;
    if (!l) return `${tok(Math.max(0, wf.window - f.tokens))} left in the window.`;
    const room = l.tokens - f.tokens;
    if (room <= 0) return ask()
      ? `Past the compaction line (${l.percent}%) — your next message asks how to make room first.`
      : `Past the compaction line (${l.percent}%) — your next message makes room first.`;
    return `${tok(room)} of room before compaction at ${l.percent}%.`;
  };

  /**
   * What the figure is in an agent's session (HarnessV3-ACP AC3-5; after a compaction, AC5-8): `note`, where it changes
   * what a person would do — nothing counted, a compaction that named nothing, Filament's copy after a switch — in the
   * popover's body; `how`, how an ordinary count is counted, the figure's title (HarnessV4_Tasks U3, V4-D212: a paragraph
   * on every open said what the number already showed).
   * @param {any} l  the live figures @param {{ known: boolean, estimated?: boolean }} f
   * @returns {{ note: string, how: string }}
   */
  const agentNote = (l, f) => {
    if (!l.rec && l.facts?.unsaid) return { note: "The agent compacted its context and didn't say what it holds now — it counts again at its next turn.", how: "" };
    if (!f.known) return { note: "The agent counts its context after its first model call.", how: "" };
    // After a switch (U3-10): the figure is Filament's copy, which the agent's fresh session starts from.
    if (!l.rec && l.facts?.freshStart) {
      const who = String(ctx.accounts?.session?.()?.agentName || "the agent");
      const carry = nameIn(CARRY_WORDS, String(ctx.view()?.settings?.effective?.context?.carry || "plain"));
      return { note: `An estimate: another model answered last, so ${who} holds none of this chat yet. Its next turn starts a fresh session from Filament's copy, earlier turns carried as ${carry}; it adds its own prompt and tools.`, how: "" };
    }
    if (!l.rec && l.facts?.afterCompaction)
      return {
        note: l.facts.context?.source === "agent"
          ? "What the agent said it holds after its compaction."
          : "An estimate after the compaction: the agent's next turn starts afresh from it, as Filament composes it — the agent adds its own prompt and tools.",
        how: "",
      };
    if (f.estimated) return { note: "", how: "An estimate — this agent doesn't report its context, so Filament counts it from what it saw go in." };
    if (l.streaming && Number(l.liveHeld) > 0) return { note: "", how: "The agent's own count as of its newest model call, and what it has written since. Its count at the turn's end replaces it." };
    if (l.streaming) return { note: "", how: "Where the agent's last turn ended, and what it has written since — its count for this turn arrives as it works." };
    return { note: "", how: "The agent's own count, as its last turn ended." };
  };

  const flat = () => ctx.view()?.settings?.flat || {};
  const eff = () => ctx.view()?.settings?.effective?.context || {};
  /** A compaction knob as the session resolves it. @param {string} name @param {any} fallback */
  const knob = (name, fallback) => flat()[`context.compaction.${name}`] ?? eff().compaction?.[name] ?? fallback;
  /** The line's percent the session keeps, null where it keeps none (the last request's edge stands in, compactionLine). */
  const storedPercent = () => {
    const v = Number(knob("thresholdPercent", null));
    return v > 0 && v <= 100 ? v : null;
  };
  /** A message sent past the line asks first, unless the session chose to make room by itself (`context.compaction.mode`). */
  const ask = () => String(knob("mode", "ask")) !== "auto";
  /** The agent's name as its accounts give it ("Claude Code"), else "The agent". */
  const who = () => String(ctx.accounts?.session?.()?.agentName || "The agent");
  /** A client's session: its client in its own name ("Codex"). */
  const clientName = () => String((ctx.view()?.windows || []).find((/** @type {any} */ w) => w?.window !== "harness")?.clientLabel || "Your client");
  /** The session's model as the composer's chip names it: the page's list's label, else its pretty name; the route
   *  ("claude-code-northwind/opus") stays in the title (V4-D214). @param {string} id */
  const modelName = (id) => String((ctx.models?.() || []).find((/** @type {any} */ x) => x?.id === id)?.label || prettyModel(id));
  /** A link at the foot, with what it opens in its title. @param {typeof h} m @param {string} label @param {string} title @param {() => void} run */
  const footLink = (m, label, title, run) => {
    const b = link(m, label, run);
    b.setAttribute("title", title);
    return b;
  };

  /** @type {null | (() => void)} */
  let painter = null;

  /** @param {typeof h} m @param {() => void} close */
  const panel = (m, close) => {
    const client = isClientView(ctx.view());
    const session = ctx.hasSession();
    const num = m("div", { class: "inst-ring-num" });
    const cap = m("div", { class: "inst-ring-cap" });
    // The figure, how it is counted in its title (V4-D212).
    const headEl = m("div", { class: "inst-meter-head" }, num, cap);
    // The bar (UX-7): what the window holds on the window's own scale, the band the line may take, the line as its
    // thumb, and the agent's own point where it is not the line. A client's session has no line of Filament's. The band
    // shows while the line is handled — hovered, focused, dragged — and not at rest, where it read as part of the count
    // (V4-D211).
    const band = `left:${LINE_MIN}%;width:${LINE_MAX - LINE_MIN}%`;
    const fillEl = m("span", { class: "inst-cap-fill" });
    const pointEl = m("span", { class: "inst-cap-point hidden" });
    /** Where the thumb stands; whether it is being dragged; the percent let go at that the settings don't say yet — the
     *  thumb stays there until they do. */
    let thumb = onBand(line()?.percent ?? storedPercent() ?? 85);
    let dragging = false;
    /** @type {number | null} */
    let written = null;
    /** The line let go at, written as the session's. @param {number} v */
    const writeLine = (v) => {
      if (v === storedPercent()) return;
      written = v;
      ctx.write({ patch: { context: { compaction: { thresholdPercent: v } } } });
    };
    const lineSlider = client || !session ? null : slider(m, {
      min: LINE_MIN,
      max: LINE_MAX,
      value: thumb,
      cls: "inst-cap-slider",
      ariaLabel: "Compaction line, percent of the window",
      onInput: (v) => { dragging = true; thumb = v; painter?.(); },
      onChange: (v) => { dragging = false; thumb = v; writeLine(v); painter?.(); },
    });
    const bar = m("div", { class: "inst-cap-bar", title: client ? "What the window holds" : `The line can sit from ${LINE_MIN}% to ${LINE_MAX}% of the window` },
      client ? null : m("span", { class: "inst-cap-zone", style: band }),
      fillEl,
      pointEl,
      lineSlider ? m("span", { class: "inst-cap-rail", style: band }, lineSlider) : null);
    // Your line, labelled (proposal_ux §4.12 step 2): its figure as a chip whose menu has the line's stops and a number of
    // your own; dragging the thumb stays. The agent's own point is the sentence's and its mark's title.
    const lineCtl = lineControl(m, {
      drawIn,
      percent: () => thumb,
      window: () => facts().window || 0,
      toast: (msg, kind) => ctx.toast(msg, kind),
      onSet: (v) => {
        thumb = v;
        if (lineSlider) lineSlider.value = String(v);
        writeLine(v);
        painter?.();
      },
    });
    const lineRow = m("div", { class: "inst-line-row" },
      m("span", { class: "inst-line-label" }, "Your line"), lineCtl.chip, lineCtl.field);
    // The two choices beside your line (the design pass of 10-24: what a person changes here stays in reach, not behind
    // the sheet): how room is made — Filament's methods, or a coding agent's ways — and whether a message past the line
    // asks first (`context.compaction.mode`). The sheet keeps the rest. A client compacts by itself, its own way: neither
    // row there. Each keeps what was picked until the settings say it (`wayWant`, `askWant`), as the thumb does.
    const cp = compactionParts(ctx);
    /** @type {string | null} */
    let wayWant = null;
    /** @type {boolean | null} */
    let askWant = null;
    let wayShown = "";
    const wayNowId = () => (agent() ? cp.chosenWay() : cp.kind());
    const wayChip = m("button", { class: "inst-line-chip", type: "button", "aria-haspopup": "menu", title: "How room is made at the line: pick a way" });
    wayChip.addEventListener("click", () => {
      const at = wayWant ?? wayNowId();
      menu(roomChoices(cp, agent()).map((w) => ({
        type: "radio",
        label: w.label,
        desc: w.desc,
        checked: w.id === at,
        onClick: () => {
          if (w.id === at) return;
          wayWant = w.id;
          ctx.write({ patch: { context: { compaction: w.patch } } });
          painter?.();
        },
      })), { anchor: wayChip, side: "bottom", align: "end", width: 320 });
    });
    const wayRow = m("div", { class: "inst-set-row" }, m("span", { class: "inst-line-label" }, "Makes room by"), wayChip);
    const askInput = m("input", {
      class: "ios-switch",
      type: "checkbox",
      role: "switch",
      "aria-label": "Ask before making room",
      onchange: (/** @type {Event} */ e) => {
        const on = !!(/** @type {HTMLInputElement} */ (e.target)).checked;
        if (on === (askWant ?? ask())) return;
        askWant = on;
        ctx.write({ patch: { context: { compaction: { mode: on ? "ask" : "auto" } } } });
      },
    });
    const askRow = m("label", {
      class: "inst-set-row",
      title: "On: a message you send past the line waits, and a card asks how to make room. Off: room is made by itself, then the message goes. A turn already running makes room by itself either way.",
    }, m("span", { class: "inst-line-label" }, "Ask before making room"), askInput);
    const legendBox = m("div", {});
    const sentence = m("div", { class: "inst-lede" });
    const extra = m("div", { class: "inst-section" });
    const sub = m("div", { class: "inst-sub" });
    // The model's window, where nobody knows it or the person said it (HarnessV4_Tasks C33): the words, and a field.
    // Made once, and in the popover only while it is asked for (`windowSlot`): a repaint while a turn streams never
    // takes the field from under the caret, and a session whose window is known holds no control for it.
    // A client's session has no line of Filament's to give a window to: no field there.
    const windowWords = m("div", { class: "inst-note" });
    const windowSave = m("button", { class: "inst-btn is-primary", type: "button" }, "Save");
    const windowBack = m("button", { class: "inst-btn", type: "button", title: "Take your figure back: nobody knows the window again, and the session has no line" }, "Take back");
    const windowField = session && !client ? m("input", { class: "inst-field is-line", type: "text", inputmode: "numeric", placeholder: "200k", "aria-label": "The model's context window, in tokens" }) : null;
    const windowBox = windowField ? m("div", { class: "inst-window" }, windowWords, m("div", { class: "inst-window-row" }, windowField, windowSave, windowBack)) : null;
    const windowSlot = windowBox ? m("div", {}) : null;
    let windowShown = false;
    // The model's window is every chat's on that model, not this chat's (`setWindow` writes it on the model's row):
    // said apart, at the foot (the design pass of 10-24), with Change… for the field where the person may say it — a
    // window the agent names, or one this chat chose of the model's, is no model's.
    let windowOpen = false;
    const scopeText = m("span", { class: "inst-scope-text" });
    const scopeChange = m("button", {
      class: "inst-link",
      type: "button",
      title: "Say this model's window: every chat on it takes yours",
      onclick: () => {
        windowOpen = true;
        painter?.();
        windowField?.focus?.();
      },
    }, "Change…");
    const scope = windowBox ? m("div", { class: "inst-scope" }, scopeText, scopeChange) : null;
    const saveWindow = () => {
      const n = windowTokensOf(windowField?.value || "");
      if (n == null) return ctx.toast("A window is a number of tokens: 200k, 1m, 128000", "err");
      if (windowField) windowField.value = "";
      ctx.setWindow(n);
    };
    windowSave.addEventListener("click", saveWindow);
    windowBack.addEventListener("click", () => ctx.setWindow(null));
    windowField?.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => { if (e.key === "Enter") { e.preventDefault(); saveWindow(); } });
    /** @type {string} */
    let windowState = "";
    // Compact now… (proposal_ux §4.12 step 2, D6): the card that asks, with every way, what each leaves and how long it
    // takes — a press here never compacts. While a coding agent's turn runs it waits for the turn's end; past a line the
    // agent can't act on mid-turn, Stop and compact stands in its place (U2), and while any other turn runs it stands
    // beside it — the composer's ⌄ menu had it, which is about the message typed (the owner's of 11-09). Made once: a
    // repaint while a turn streams never swaps a button under the pointer.
    const compactBtn = m("button", {
      class: "inst-btn is-wide",
      type: "button",
      onclick: () => {
        if (compactBtn.disabled) return;
        close();
        ctx.summon?.();
      },
    }, icon(m, "foldVertical"), m("span", { class: "inst-btn-text" }, "Compact now…"));
    const stopBtn = m("button", {
      class: "inst-btn",
      type: "button",
      title: "Stop the turn, then compact this session once it has ended",
      onclick: () => { close(); ctx.stopAndCompact(); },
    }, icon(m, "square"), "Stop and compact");
    // The instant fold, offered with its count (the owner's rules of 10-31: "an offer with its count is visible any
    // time"): where its plan leaves the earlier turns at the instant line or under, Fold now; over it, the count alone.
    // From the host's one preview, asked as the popover opens; a client's session has none. In a coding agent's chat the
    // fold is of Filament's copy, and the agent starts a fresh session from it.
    const foldText = m("span", { class: "inst-fold-text" });
    const foldBtn = m("button", {
      class: "inst-btn",
      type: "button",
      title: agent()
        ? `Fold Filament's copy of the chat now: each tool call becomes one line, no model call; ${who()}'s next turn starts a fresh session from it — Undo is on its row until you send`
        : "Fold the earlier turns now: each tool call becomes one line, no model call — Undo is on its row until you send",
      onclick: () => { if (foldBtn.disabled) return; close(); ctx.foldNow?.(); },
    }, icon(m, "foldVertical"), "Fold now");
    const foldBox = m("div", { class: "inst-fold-offer hidden" }, foldText);
    if (session && !client && ctx.preview) {
      void Promise.resolve(ctx.preview()).then((pv) => {
        const plan = pv?.compaction?.native ? pv.compaction : null;
        const offer = foldOfferWords(plan?.methods?.fold, plan?.instantTokens);
        const words = offer && agent() ? `${offer} — ${who()} starts a fresh session from it` : offer;
        foldText.replaceChildren(words);
        // Past the instant line too (the owner's of 11-05): it folds all the same, its words saying how much it leaves.
        const fold = plan?.methods?.fold;
        foldBox.replaceChildren(...kids([foldText, fold?.possible && (fold.instant || Number(plan?.instantTokens) > 0) && ctx.foldNow ? foldBtn : null]));
        foldBox.classList.toggle("hidden", !words);
      }, () => {});
    }
    // The sheet with the rest (§4.12 step 4): your line, how room is made, what every request carries.
    const howLink = footLink(m, HOW_LINK, "Your line, how room is made and what every request carries — for this chat, its project or every new chat", () => { close(); ctx.openHow?.(); });
    const actionRow = m("div", { class: "inst-actions" });
    /** How the row offers Stop and compact — in Compact now…'s place, beside it while a turn runs, or not; "" before its
     *  first paint. @type {"" | "instead" | "beside" | "none"} */
    let offering = "";
    painter = () => {
      const l = live();
      const f = figure();
      const wf = facts();
      // The settings caught up with the line let go; otherwise the thumb follows the session's line.
      const stored = storedPercent();
      if (written != null && stored === written) written = null;
      if (lineSlider && !dragging && written == null) {
        const v = onBand(line()?.percent ?? stored ?? 85);
        if (v !== thumb) {
          thumb = v;
          lineSlider.value = String(v);
        }
      }
      const window = wf.window || 0;
      // The line drawn: the thumb's while it moves and until its write lands, else the session's.
      const moving = dragging || written != null;
      const cl = !window || client ? null : moving ? { f: thumb / 100, tokens: Math.floor((window * thumb) / 100), percent: thumb } : line();
      const rec = l.rec;
      // Reconciled against the provider's count WITHOUT the streaming estimate: the live output is not yet part of
      // any request the provider counted.
      const wp = windowParts(rec, rec ? heldFromUsage(l.usage) || null : null);
      const held = f.tokens;
      const sum = wp.parts.reduce((n, p) => n + p.tokens, 0);
      const scale = window ? Math.min(1, held / window) / (sum || 1) : 0;
      // A share of the window to draw: a window known and, in an agent's session, a count to measure against it.
      const share = fill() != null;
      /** @type {"" | "warn" | "error"} */
      const t = client ? "" : moving && cl && share ? (held >= cl.tokens ? "error" : held >= cl.tokens * 0.85 ? "warn" : "") : tone();
      // An agent that has counted nothing says so in the number's place, not with a dash (V4-D212).
      const uncounted = !share && !f.known && agent();
      num.classList.toggle("is-words", uncounted);
      drawIn(num, kids([share ? pctText().replace("%", "") : uncounted ? "Not counted yet" : tok(held), share ? m("small", {}, "%") : null]));
      // ≈ while the turn runs: the figure is the loop's own measure (or the agent's count as it works) until the final
      // count lands at its end, so a small step then is expected, not a jump (the UI/UX review, 2026-09-30); an estimate
      // stays ≈. Said once, on the big number (pctText); the tokens under it do not say it again (V4-D212).
      drawIn(cap, kids([share ? `${tok(held)} of ${tok(window)}` : f.known ? "tokens held" : uncounted ? null : "in your draft"]));
      // How the figure is counted, as its title; what changes what to do stays a note below (V4-D212).
      const said = agent() ? agentNote(l, f) : null;
      headEl.setAttribute("title", said ? said.how : l.streaming ? "An estimate while the turn runs — the loop's own measure of what it sends. The provider's exact count replaces it when the turn ends." : "");
      // The fill: each part its share of the WINDOW, in its legend's color, so the empty track is the room left; with
      // nothing itemised, one fill in the tone's color is the held figure.
      bar.classList.toggle("hidden", !window);
      bar.classList.toggle("is-moving", dragging);
      lineRow.classList.toggle("hidden", !window || client || !session);
      const parts = sum && share ? wp.parts : [];
      fillEl.classList.toggle("hidden", !share);
      fillEl.classList.toggle("is-parts", parts.length > 0);
      fillEl.classList.toggle("is-near", !parts.length && t === "warn");
      fillEl.classList.toggle("is-over", !parts.length && t === "error");
      fillEl.setAttribute("style", `width:${share ? Math.round(Math.min(100, (held / window) * 100) * 100) / 100 : 0}%`);
      drawIn(fillEl, parts.map((p) => m("span", { class: "inst-cap-part", style: `flex-basis:${Math.round((p.tokens / sum) * 10000) / 100}%;background:${p.color}`, title: `${p.label} · ${tok(p.tokens)}` })));
      // The agent's own point, where the line it took is not where it acts (67,000 under it, 967,000 over it).
      const point = agentPointOf(ctx.view(), l);
      const mark = agent() && cl && point && point.line === cl.tokens && point.at !== cl.tokens && point.at < window ? point.at : null;
      pointEl.classList.toggle("hidden", mark == null);
      pointEl.setAttribute("style", mark == null ? "" : `left:${Math.round((mark / window) * 10000) / 100}%`);
      pointEl.setAttribute("title", mark == null ? "" : `${who()} compacts by itself here, at ${tok(mark)}`);
      // Your line's chip: its tokens and its share of the window, following the thumb while it moves.
      lineCtl.paint(cl ? { tokens: cl.tokens, percent: cl.percent } : null);
      lineSlider?.setAttribute("aria-valuetext", cl ? `${cl.percent}% of the window, ${tok(cl.tokens)} tokens` : `${thumb}% of the window`);
      // The legend in Filament's sessions (UX-7): every percent a share of the window, as the fill is (LD-D6); with no
      // window known, of what is itemised. An agent's whole is never itemised.
      /** @type {{ color: string, label: string, value: string, share?: string, hollow?: boolean }[]} */
      const rows = agent() ? [] : wp.parts.map((p) => ({ color: p.color, label: p.label, value: tok(p.tokens), share: window ? pct(p.tokens * scale, 1) : pct(p.tokens, sum) }));
      if (!agent() && cl) rows.push({ color: "", label: "Room to your line", value: tok(Math.max(0, cl.tokens - held)), hollow: true });
      drawIn(legendBox, kids([
        rows.length ? legend(m, rows) : null,
        !agent() && !rows.length ? note(m, f.known ? "The last request isn't itemised — the figure is the turn's own." : "Counts your draft for now — the exact numbers arrive with the first reply.") : null,
      ]));
      // The one sentence (U3.3); where no line is drawn, the room words.
      const words = client
        ? `${clientName()} compacts by itself; its own model writes the summary.`
        : !cl || (agent() && !f.known)
          ? roomSentence()
          : lineSentence({ held, line: cl, ask: ask(), agent: agent(), who: who(), point, running: !!l.streaming });
      drawIn(sentence, [words]);
      sentence.classList.toggle("hidden", !words);
      sentence.classList.toggle("is-warn", t === "warn");
      sentence.classList.toggle("is-error", t === "error");
      // Stop and compact in place of Compact now while it is offered, beside it while any other turn runs; the row
      // changes only when that does. A client's session has neither: its client compacts it.
      const offer = stopOffered({ held, line: cl, agent: agent(), running: !!l.streaming, point });
      const how = offer ? "instead" : l.streaming ? "beside" : "none";
      if (how !== offering) {
        offering = how;
        stopBtn.classList.toggle("is-primary", offer);
        actionRow.replaceChildren(...(client ? [] : how === "instead" ? [stopBtn] : how === "beside" ? [compactBtn, stopBtn] : [compactBtn]), howLink);
      }
      // A coding agent's turn compacts its own context as it works: the card comes once the turn ends.
      const waits = agent() && !!l.streaming && !offer;
      compactBtn.disabled = waits;
      // A running turn makes room at its next step its own way: no fold until it ends.
      /** @type {HTMLButtonElement} */ (foldBtn).disabled = !!l.streaming;
      compactBtn.setAttribute("title", waits
        ? `${who()} compacts its own context as it works — Compact now… opens once its turn ends`
        : l.streaming ? "Choose how this turn makes room at its next step" : "Choose how to make room: every way, what each leaves and how long it takes");
      const sw = ctx.view()?.settings?.window;
      const model = sw?.model;
      const asksWindow = windowBox ? windowAsk(sw, { agent: agent(), named: wf.source === "agent", modelName: model ? modelName(model) : "this model" }) : null;
      // The model's own word, said elsewhere (its card, the provider's list, Filament's table): the scope line, and the
      // field once Change… is pressed.
      const modelWide = !!sw?.settable && !!sw?.tokens && !asksWindow && wf.source !== "agent" && wf.source !== "session";
      const told = asksWindow || (modelWide && windowOpen
        ? { state: "known", words: `${model ? modelName(model) : "This model"}'s window is ${Number(sw.tokens).toLocaleString()} tokens (${windowSourceWords(wf.source)}). Say another and every chat on this model takes yours.` }
        : null);
      if (windowSlot && windowBox && !!told !== windowShown) {
        windowShown = !!told;
        windowSlot.replaceChildren(...(told ? [windowBox] : []));
      }
      if (windowBox && told && `${told.state}\n${told.words}` !== windowState) {
        windowState = `${told.state}\n${told.words}`;
        windowWords.replaceChildren(told.words);
        windowBox.classList.toggle("is-unknown", told.state === "unknown");
        windowBack.classList.toggle("hidden", told.state !== "yours");
        windowSave.replaceChildren(told.state === "unknown" ? "Save" : "Change");
      }
      if (scope) {
        scope.classList.toggle("hidden", !modelWide);
        scopeText.replaceChildren(model ? `Every chat on ${modelName(model)} shares this window` : "Every chat on this model shares this window");
        scopeChange.classList.toggle("hidden", windowOpen);
      }
      // The way and the question as the settings say them, or as picked until they do.
      if (wayWant != null && wayWant === wayNowId()) wayWant = null;
      if (askWant != null && askWant === ask()) askWant = null;
      const wayId = wayWant ?? wayNowId();
      const wayText = agent() ? cp.wayName(wayId) : roomWords(wayId)?.name || cp.plainOf(wayId);
      if (wayText !== wayShown) {
        wayShown = wayText;
        wayChip.replaceChildren(wayText, icon(m, "chevronDown", "inst-line-chev"));
      }
      /** @type {HTMLInputElement} */ (askInput).checked = askWant ?? ask();
      // A coding agent that counts a window of its own other than the one said for its model here: why the card's window
      // is not the picker's, and the name that runs it in 1M where the window answer gives one (the owner's of 11-10,
      // Fable 5.2; the rule is the server's, routing's `oneMToAdd`).
      // Only while the count is the picked model's: a turn that ran on another, before a switch, counted that one's.
      const sent = sw?.sent || model || "";
      const ranOn = String(l.rec?.upstreamModel || l.facts?.model || ctx.view()?.facts?.model || "");
      const ownWindow = agent() && wf.source === "agent" && sent && ranOn.toLowerCase() === sent.toLowerCase()
        ? agentWindowWords({ who: who(), model: sent, runs: wf.window, set: sw?.tokens, add: sw?.add })
        : null;
      drawIn(sub, [window ? `${model ? `${modelName(model)} · ` : ""}${tok(window)} window` : !ctx.hasSession() ? "A new chat" : agent() ? "The agent hasn't named its window" : "Window unknown for this model"]);
      sub.setAttribute("title", `${model ? `${model} — ` : ""}${windowSourceWords(wf.source)}`);
      drawIn(extra, kids([
        wp.heldBack > 0 ? note(m, [m("b", {}, tok(wp.heldBack)), " of older history kept off the wire by a fold or the tool-result policy."]) : null,
        !rec && l.facts?.afterCompaction && !agent() ? note(m, "Measured after the compaction: the next request as Filament composes it now. Its parts are itemised once it is sent.") : null,
        said?.note ? note(m, said.note) : null,
        wf.verdict && wf.verdict !== "fits" && !l.streaming ? note(m, `Last request: ${verdictWords(wf.verdict, wf.usable)}.`, wf.verdict === "over" ? "error" : "warn") : null,
        ownWindow ? note(m, ownWindow, "warn") : null,
      ]));
    };
    painter();
    return m("div", { class: "inst inst-context" },
      head(m, { icon: "gauge", title: "Context", sub }),
      m("div", { class: "inst-meter" }, headEl, bar, m("div", { class: "inst-sets" }, lineRow, ...(!client && session ? [wayRow, askRow] : []))),
      legendBox,
      sentence,
      windowSlot,
      extra,
      foldBox,
      session ? actionRow : null,
      // The dry run and the map weigh Filament's composition, which a coding agent never reads (HarnessV3-ACP AC5-8).
      session && !agent()
        ? m("div", { class: "inst-foot" },
            m("span", { class: "inst-foot-links" },
              footLink(m, "Dry run", "The request the composer would send for your draft, message by message — nothing is sent", () => { close(); ctx.dryRun(); }),
              footLink(m, "Next request", "Every turn of the session and the form it reaches the model in", () => { close(); ctx.openPane?.("next-request"); })))
        : null,
      scope);
  };

  /**
   * The tile on Overview (proposal_ux §4.6, size L): how full the chat is, on the window's own scale with your line on
   * it, what fills it, the sentence the popover says, the window held turn by turn, and the two ways on — Compact now…
   * opens the card, How earlier turns are kept the sheet; neither acts on its own press. M drops the turns' strip.
   * @param {typeof h} m @param {import("./frame.js").TileSize} size
   */
  const tile = (m, size) => {
    const f = face();
    const wf = facts();
    const l = line();
    const rec = live().rec;
    const parts = rec && !agent() ? windowParts(rec, f.known ? f.tokens : null).parts : [];
    const bar = parts.length ? parts.map((p) => ({ value: p.tokens, color: p.color, label: `${p.label} ${tok(p.tokens)}` })) : f.tokens > 0 ? [{ value: f.tokens, color: toneColor(), label: `Held ${tok(f.tokens)}` }] : [];
    const turns = ctx.turns().filter((t) => t?.facts && !t.command);
    const strip = foldColumns(turns.map((t) => ({ n: Number(t.n) || 0, value: factsHeld(t.facts) })));
    const sentence = l && f.known ? lineSentence({ held: f.tokens, line: l, ask: ask(), agent: agent(), who: who(), point: agentPointOf(ctx.view(), live()), running: !!live().streaming }) : roomSentence();
    return kids([
      m("div", { class: "ov-ctx-fig" },
        m("span", { class: `ov-ctx-pct${tone() ? ` is-${tone()}` : ""}` }, pctText() || "—"),
        m("span", { class: "ov-quiet" }, wf.window ? `${tok(f.tokens)} of ${tok(wf.window)} tokens` : f.tokens ? `${tok(f.tokens)} tokens` : "nothing counted yet")),
      wf.window ? stackBar(m, bar, { total: wf.window, tall: true, notch: l?.f ?? null }) : null,
      wf.window && l ? m("div", { class: "ov-ctx-scale" }, m("span", {}, "0"), m("span", {}, `Your line · ${tok(l.tokens)}`), m("span", {}, tok(wf.window))) : null,
      parts.length ? m("div", { class: "ov-legend-line" }, ...parts.map((p) => m("span", { class: "ov-legend-item" }, m("span", { class: "inst-dot", style: `background:${p.color}` }), `${p.label} ${tok(p.tokens)}`))) : null,
      sentence ? m("p", { class: "ov-line" }, sentence) : null,
      size === "L" && strip.length ? barStrip(m, strip.map((c, i, all) => ({ value: c.value, label: `${c.label}: ${tok(c.value)} held`, mark: i === all.length - 1 })), { height: 30, ariaLabel: "What the chat held, turn by turn", slots: 24 }) : null,
      ctx.hasSession()
        ? m("div", { class: "ov-acts is-split" },
            ctx.summon && !isClientView(ctx.view()) ? m("button", { class: "ov-btn", type: "button", onclick: () => ctx.summon?.() }, icon(m, "foldVertical"), "Compact now…") : null,
            ctx.openHow ? link(m, "How earlier turns are kept", () => ctx.openHow?.()) : null)
        : null,
    ]);
  };

  return {
    id: "context",
    tileIcon: "gauge",
    label: "Context",
    // Named beside its ring, with what it holds after the share (the design pass of 10-24): a bare "6%" said nothing.
    named: true,
    more: () => (fill() != null && figure().known ? tok(figure().tokens) : ""),
    // As wide as the Compaction popover was: Compact now names its way ("Claude Code writes a summary") in one row.
    width: 392,
    liveNow: true,
    tile,
    tileSub: () => {
      const wf = facts();
      const model = ctx.subagents?.sessionModel?.() || "";
      return [model ? modelName(model) : "", wf.window ? `${tok(wf.window)} window` : "", agent() ? `${who()}'s own count` : ""].filter(Boolean).join(" · ");
    },
    tileTrail: (m) => (live().streaming ? m("span", { class: "ov-quiet" }, "live") : null),
    face: (m) => m("span", { class: "inst-face" },
      m("span", { class: "inst-face-ring", html: ringSvg({ size: 16, width: 2.6, parts: fill() != null ? [{ f: Math.max(0.001, /** @type {number} */ (fill())), color: toneColor() }] : [], notch: line()?.f ?? null }) }),
      pctText() ? m("span", { class: "inst-face-text" }, pctText()) : null),
    // Hollow: no share of the window to show — no window known, or an agent that has counted nothing yet.
    marks: () => ({ hollow: fill() == null }),
    state: () => pctText(),
    tone,
    title: () => {
      const f = figure();
      const wf = facts();
      if (agent() && !f.known)
        return !live().rec && live().facts?.unsaid
          ? "Context: not counted since the agent's compaction — it counts again at its next turn"
          : "Context: nothing counted yet — the agent counts its context after its first model call";
      const est = f.known && !f.estimated ? "" : " (estimate)";
      const hedge = !live().streaming ? ""
        : !agent() ? " — the loop's measure while the turn runs; the exact count lands when it ends"
        : Number(live().liveHeld) > 0 ? " — the agent's count as it works; its count at the turn's end replaces it"
        : " — where its last turn ended; its count for this turn arrives as it works";
      return wf.window
        ? `Context: ${fmt.n(f.tokens)} of ${fmt.n(wf.window)} tokens${est} — ${roomSentence()}${hedge}`
        : `Context: ${fmt.n(f.tokens)} tokens held${est} — ${agent() ? "the agent hasn't named its window" : windowSourceWords(null)}${hedge}`;
    },
    panel,
    repaint: () => painter?.(),
  };
}
