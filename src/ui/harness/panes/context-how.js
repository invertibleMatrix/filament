// @ts-check
// How earlier turns are kept (HarnessV4_Tasks U3, UX-3; U3-3; proposal_ux §4.12 step 4): the sheet's section, and
// Settings › How earlier turns are kept's, drawn over your defaults. Laid out as the mock of 10-18 (U5 phase 3), in four
// parts and plain words: When the chat is full — Your line (the ring's chip: the line's stops, or a number of your own),
// Then (Ask me, or Just do it: whether a message asks before room is made, HarnessV4_Tasks C26), Back after a break
// (the cold cache: Ask me, or Send as it is); How it makes room — the way (the card's first choice), who writes
// Filament's summaries — the same model or a side model; Other agents' results — sealed or whole while the agent works
// (HarnessV4_Envelopes_Plan EN5); History — the newest compactions, Undo on the newest; and ▸ Advanced, the numbers
// behind the names: newest whole, the instant line, the tool results of the turns sent whole. It draws
// the variant of who holds the conversation (UX-2): a coding agent keeps its own history and compacts it itself, and
// its Advanced holds a fresh start, Filament's copy and Filament's methods on that copy (UX-9); a client compacts by
// itself, its own model writing the summary (UX-10). A row's ▾ opens its list under it, one at a time, and what is
// open outlives the section's draws. The parts are the instruments' own (compactionParts, the ring's lineControl), the
// figures the host's one preview; every write
// goes through ctx.write. Over your defaults (`io.defaults`) it holds the loop's rows and a coding agent's together, no
// history (a session's own), and under each row where its value comes from — yours (with Reset), the dashboard's
// rules.
import { h } from "../../lib/dom.js";
import { nameIn, CARRY_WORDS } from "../../lib/context-words.js";
import { settingChangeWords, sourceOfKnob } from "../lib/labels.js";
import { group, section, note, segmented, switchRow, icon, tok, usd, ago, kids } from "../widgets/kit.js";
import { compactionParts, noSmaller, onPlan, shareLine, shortModel, standing, wayNow } from "../widgets/compaction.js";
import { agentPointOf, lineControl } from "../widgets/context.js";
import { carryControl } from "../widgets/carry.js";

/** The tool-result policy where none is chosen (`context.results`'s default): the turns sent whole keep their results
 *  (V4-D302). */
const DEFAULT_RESULTS = "keep";
/** The tool-result policies (`context.results`) offered here (the owner's of 11-07). */
const RESULTS = Object.freeze([
  { id: "keep", label: "As is", title: "Every tool result as it came back" },
  { id: "line", label: "One line", title: "Each result of a finished turn sent whole becomes one line, with its recall id where the line leaves something out, where the turn's lines save 10K tokens or more; a smaller turn goes as it ran, so the cache holds" },
]);
/** The policies offered before, said where a chat still holds one: it sends as it did until another is picked. */
const EARLIER_RESULTS = Object.freeze(/** @type {Record<string, string>} */ ({
  status: "One line without its recall id",
  "dedupe-to-tail": "Newest only",
  pointer: "Pointers",
}));
/** What is open, by session: the row whose list shows, and the disclosure. It outlives the pane's draws.
 *  @type {Map<string, { row: string | null, more: boolean }>} */
const opened = new Map();

/**
 * Where a coding agent makes room by itself, in one line under its way (HarnessV4_Tasks UX-9; the facts of U3.4): at
 * the line it was handed, even mid-turn; at 67K at the earliest under it; at 967K, before it, over it; a moved line
 * taken as a turn starts. With none handed it compacts at its own point while the line acts between turns. `who` is
 * the agent's name, `line` the line in tokens, `point` agentPointOf's.
 * @param {{ who: string, line: number | null, point: { at: number, line: number | null } | null }} s
 */
export function pointLine(s) {
  const who = s.who;
  const whoIn = who.replace(/^The /, "the ");
  const p = s.point;
  if (!s.line) return `${who} compacts by itself at its own point.`;
  if (p && p.line === s.line && p.at === s.line) return `${who} compacts at your line, even mid-turn.`;
  if (p && p.line === s.line && p.at > s.line) return `${who} compacts by itself at ${tok(p.at)} at the earliest, even mid-turn; Filament checks your line between turns.`;
  if (p && p.line === s.line) return `${who} compacts by itself at ${tok(p.at)}, before your line.`;
  if (p) return `${who} takes your new line as a turn starts.`;
  return `Your line acts between turns; ${whoIn} compacts by itself at its own point.`;
}

/**
 * The section for the session `ctx` reads. `repaint` draws it again when what it shows has moved — a settings write, a
 * turn, the engine answering — or when told to (`force`: a compaction landed or was undone, which moves neither).
 * @param {import("../widgets/registry.js").WidgetContext} ctx
 * @param {{ h?: typeof h, drawIn?: (parent: any, nodes: any[]) => void, key?: string, modelSelect?: any, defaults?: boolean }} [io]
 *   `drawIn`: how its live parts' newest draw goes in, the frame's (widgets/frame.js `WidgetIO`); `key` names the session, for what is open; `modelSelect` the writer's model picker (a test hands in its own);
 *   `defaults`: the section is Settings › Context — `ctx` reads and writes your defaults, a value of yours has the
 *   source "session" in its view, the dashboard's "global"
 * @returns {{ el: any, repaint: (force?: boolean) => void }}
 */
export function howSection(ctx, io = {}) {
  const m = io.h || h;
  /** Settings › Context: the section is drawn over your defaults. */
  const D = !!io.defaults;
  const P = compactionParts(ctx, io);
  const key = String(io.key || "");
  const ui = opened.get(key) || { row: null, more: false };
  opened.set(key, ui);
  const el = m("div", { class: "inst inst-context inst-how" });
  /** Who holds the conversation (UX-2): a client, a coding agent, or Filament's loop. */
  const variant = () => (D ? "defaults" : P.isClient() ? "client" : P.isAgent() ? "agent" : "loop");
  /** The state the section was drawn for: a settings write, a turn, or another engine answering draws it again. */
  // What the section shows is the host's preview: where the host names the state that answers for (`previewKey`, which
  // a turn moves at its end), the section draws again with it; else by the count of turns.
  const stateKey = () => `${ctx.view()?.settings?.hash || ""}|${ctx.previewKey?.() ?? (ctx.turns?.() || []).length}|${variant()}`;
  let drawn = "";
  let asked = 0;
  /** The preview drawn last: undefined while it is on its way. @type {any} */
  let shownPv;
  /** A list picked from stays open, its check moved: the row's ▾ closes it. */
  const stay = () => {};
  /** @param {number} w */
  const skel = (w) => m("span", { class: "inst-skel", style: `width:${w}px` });
  /** @param {string} id */
  const toggle = (id) => {
    ui.row = ui.row === id ? null : id;
    draw(shownPv);
  };

  /**
   * One row (proposal_ux §4.12 step 4): its name with what it is under it, a figure, then its choice at the row's end —
   * a control (`control`), or a button whose ▾ opens the row's list under it — lines under it, and its list while open.
   * A row with nothing to choose says its choice in words; `dim`, one that does not apply here.
   * @param {{ id: string, label: string, sub?: string, choice?: any, control?: any, lead?: string, fig?: any, extra?: any, under?: any[], title?: string, open?: () => any[], dim?: boolean }} o
   */
  const item = (o) => {
    const isOpen = !!o.open && ui.row === o.id;
    return m("div", { class: `inst-how-item${isOpen ? " is-open" : ""}${o.dim ? " is-dim" : ""}`, "data-row": o.id },
      m("div", { class: "inst-how-row" },
        m("span", { class: "inst-how-label", ...(o.title && !o.open ? { title: o.title } : {}) },
          m("span", { class: "inst-how-name" }, o.label),
          o.sub ? m("span", { class: "inst-how-label-sub" }, o.sub) : null),
        o.fig != null && o.fig !== "" ? m("span", { class: "inst-how-fig" }, o.fig) : null,
        m("span", { class: "inst-how-value" },
          o.lead ? m("span", { class: "inst-how-lead" }, o.lead) : null,
          o.control
            ? o.control
            : o.open
              ? m("button", { class: "inst-how-pick", type: "button", "aria-expanded": isOpen ? "true" : "false", ...(o.title ? { title: o.title } : {}), onclick: () => toggle(o.id) },
                  m("span", { class: "inst-how-choice" }, o.choice), icon(m, "chevronDown", "inst-how-chev"))
              : m("span", { class: "inst-how-choice is-still" }, o.choice)),
        o.extra || null),
      ...kids((o.under || []).map((u) => (u ? m("div", { class: "inst-how-under" }, ...kids([u])) : null))),
      isOpen && o.open ? m("div", { class: "inst-how-open" }, ...kids(o.open())) : null);
  };

  /**
   * Your line (U11; proposal_ux §4.12 step 4): where the chat counts as full — the ring's chip, with the line's stops and
   * a number of your own; dragging it stays the ring's. Your defaults have no window, so there the chip says a percent.
   * `under`: lines under it.
   * @param {any[]} [under]
   */
  const lineRow = (under = []) => {
    const w = D ? 0 : P.window() || 0;
    const at = P.percent();
    const c = lineControl(m, {
      drawIn: io.drawIn,
      percent: () => at,
      window: () => w,
      toast: (msg, kind) => ctx.toast(msg, kind),
      onSet: (v) => { if (v !== at) ctx.write({ patch: { context: { compaction: { thresholdPercent: v } } } }); },
    });
    c.paint({ tokens: w ? standing(0, w, at).lineTokens : 0, percent: at });
    return item({
      id: "line",
      label: "Your line",
      sub: "where room is made",
      control: m("span", { class: "inst-how-line" }, c.chip, c.field),
      title: "Where the chat counts as full: past it, room is made before your next message goes",
      under,
    });
  };

  /**
   * Then (HarnessV4_Tasks C26; one choice of two since U11): a message that would go past the line waits and its card
   * asks how to make room (Ask me), or room is made by itself, the session's own way, and the message goes (Just do it)
   * — what the card's "Just do it from now on" writes, so one pressed by mistake is a click to take back
   * (`context.compaction.mode`). What each does is its title. `how`: the way room is made, in its own name; `under`:
   * lines under it.
   * @param {{ how?: string, under?: any[] }} [o]
   */
  const fullRow = (o = {}) => {
    const ask = P.mode() === "ask";
    return item({
      id: "asks-fit",
      label: "Then",
      sub: "a message past the line",
      control: segmented(m, {
        options: [
          { id: "ask", label: "Ask me", title: "Your message waits, and a card asks before room is made. A turn already running makes room by itself." },
          { id: "auto", label: "Just do it", title: `Room is made by itself${o.how ? ` (${o.how})` : ""}, then your message goes. Nothing asks.` },
        ],
        value: () => (ask ? "ask" : "auto"),
        ariaLabel: "When the chat is full",
        onChange: (v) => { if ((v === "ask") !== ask) ctx.write({ patch: { context: { compaction: { mode: v === "ask" ? "ask" : "auto" } } } }); },
      }).el,
      title: "What your message does when the chat is past the line",
      under: o.under || [],
    });
  };

  /**
   * Back after a break (HarnessV4_Tasks C26): a message sent once the cache's life has run out waits and its card asks
   * (Ask me), or goes as it is (Send as it is) — what the card's "Just send from now on" writes
   * (`context.compaction.resumeQuestion`). How long a cache lives, and what a late message costs, is the row's title.
   * One name for a coding agent's chat and the loop's, though the mock says "an hour": a model's cache may last five
   * minutes, and the card's way to stop being asked names the row.
   * @param {{ agent?: boolean, under?: any[] }} [o]  `agent`: a coding agent's session, whose cache lasts an hour at the
   *   most; `under`: lines under it
   */
  const coldRow = (o = {}) => {
    const ask = P.asksCold();
    const life = o.agent ? "A coding agent's cache lasts an hour at the most" : "A model's cache lasts five minutes or an hour, by its route";
    return item({
      id: "asks-cold",
      label: "Back after a break",
      sub: "the cache has gone cold",
      control: segmented(m, {
        options: [
          { id: "ask", label: "Ask me", title: "Your message waits, and a card asks: send it as it is, or make room first" },
          { id: "send", label: "Send as it is", title: "Your message goes as it is, at the full price" },
        ],
        value: () => (ask ? "ask" : "send"),
        ariaLabel: "When the cache is cold",
        onChange: (v) => { if ((v === "ask") !== ask) ctx.write({ patch: { context: { compaction: { resumeQuestion: v === "ask" } } } }); },
      }).el,
      title: `${life}. A message sent after that reads the whole chat again at the full price${ask ? ", so a card asks first" : ", and nothing asks"}.`,
      under: o.under || [],
    });
  };

  /**
   * After an update (the owner's of 11-06): a message sent once what the chat sends ahead of its history changed —
   * Filament updated, an MCP server, a tool switched — waits and its card asks (Ask me), or goes as it is (Send as it
   * is) — what the card's "Just send from now on" writes (`context.compaction.changeQuestion`).
   * @param {{ agent?: boolean, under?: any[] }} [o]  `agent`: a coding agent's session; `under`: lines under it
   */
  const changedRow = (o = {}) => {
    const ask = P.asksChanged();
    const goes = o.agent ? "A coding agent's session that goes on can keep what it already loaded in its old form; making room first starts a fresh one that reads the new" : "Every request sends them as they are now, so going on while the cache is warm writes the whole chat to it again";
    return item({
      id: "asks-changed",
      label: "After an update",
      sub: "Filament, an MCP server or a tool changed",
      control: segmented(m, {
        options: [
          { id: "ask", label: "Ask me", title: "Your message waits, and a card asks: send it as it is, or make room first" },
          { id: "send", label: "Send as it is", title: o.agent ? "Your message goes on in the agent's session as it is" : "Your message goes as it is, the whole chat written to the cache again" },
        ],
        value: () => (ask ? "ask" : "send"),
        ariaLabel: "When what the chat sends ahead changed",
        onChange: (v) => { if ((v === "ask") !== ask) ctx.write({ patch: { context: { compaction: { changeQuestion: v === "ask" } } } }); },
      }).el,
      title: `${goes}${ask ? ", so a card asks first" : ", and nothing asks"}.`,
      under: o.under || [],
    });
  };

  /** Summaries written by, while the method writes a summary (One summary): who writes it — the same model or a side
   *  model — and what it costs each time; `more`: lines under it. @param {any} pv @param {any} plan @param {any[]} [more] */
  const writer = (pv, plan, more = []) => {
    const id = P.method();
    if (id !== "summary") return null;
    const choice = P.writerChoice();
    const named = P.namedModel();
    const side = plan?.writers?.side?.model;
    const who = choice === "session" ? "The same model"
      : named ? shortModel(named)
      : choice === "model" ? (side ? shortModel(side) : "A side model")
      : "The same model";
    // What the summary costs as its writer reads the turns: whole, folded, in slices — or the instant fold in its place.
    const est = plan?.methods?.[id];
    return item({
      id: "writer",
      label: "Summaries written by",
      sub: "when Filament writes one",
      choice: who,
      title: "Who writes the summary room is made with",
      fig: pv === undefined ? skel(56) : est?.reads === "instant" ? "free, no model call" : est?.cost != null ? (onPlan(est) ? "on your plan" : `≈${usd(est.cost)} each time`) : null,
      under: more,
      open: () => [P.writerSection(m, plan, { bare: true, waiting: pv === undefined })],
    });
  };

  /**
   * History (proposal_ux §4.12 step 4): the newest compactions, each with what it left, Undo on the newest until the next
   * message; how many so far and when the last was beside the heading. @param {any} pv
   */
  const historyPart = (pv) => {
    const list = Array.isArray(pv?.compactions) ? pv.compactions : [];
    const last = list[list.length - 1];
    return m("div", { class: "inst-how-part", "data-part": "history" },
      m("div", { class: "inst-how-sec" }, "History",
        pv !== undefined && last ? m("span", { class: "inst-how-sec-aside" }, `${list.length} so far · the last ${ago(Number(last.at))}`) : null),
      pv === undefined ? m("div", { class: "inst-how-list" }, m("div", { class: "inst-how-item" }, skel(160)))
        : last ? P.historyRows(m, list, stay)
          : note(m, "None yet. A compaction lands here, and as a row in the chat where it happened."));
  };

  /** The way (U11; proposal_ux §4.12 step 4: the card's first choice): the method with what it would leave now — or
   *  why it cannot run, or that it would leave the chat no smaller (V4-D309). `under`: lines under it; `sub`: what the
   *  row is.
   *  @param {any} pv @param {any} plan @param {any[]} [under] @param {string} [sub] */
  const methodRow = (pv, plan, under = [], sub = "the card's first choice") => {
    const id = P.method();
    const est = id ? plan?.methods?.[id] : null;
    const cannot = !!est && est.possible === false;
    return item({
      id: "method",
      label: "The way",
      sub,
      choice: P.plainOf(id),
      title: "How room is made at the line",
      fig: pv === undefined ? skel(56) : est && !cannot ? `${est.exact ? "" : "≈"}${tok(est.after)} after` : null,
      under: [
        est && !cannot && noSmaller(est, plan?.now) ? `↳ No smaller than now (${tok(Number(plan.now))})` : null,
        cannot ? `↳ Can't run now: ${String(est.why || "nothing to compact this way")}` : null,
        ...under,
      ],
      open: () => [P.methodList(m, plan, pv === undefined ? null : pv)],
    });
  };

  /** The parts a variant fills: When the chat is full, How it makes room, and what Advanced holds before its knobs.
   *  @typedef {{ full: any[], room: any[], more: any[] }} Parts */

  /** Filament's loop, or a team: your line, then, back after a break; the way, who writes the summary; under
   *  Advanced, earlier turns. @param {any} pv @param {any} plan @returns {Parts} */
  const loopRows = (pv, plan) => {
    const shown = P.method();
    return {
      full: [
        lineRow(fromLines(LINE)),
        fullRow({ how: shown ? P.plainOf(shown) : "", under: fromLines(["context.compaction.mode"]) }),
        coldRow({ under: fromLines(["context.compaction.resumeQuestion"]) }),
        changedRow({ under: fromLines(["context.compaction.changeQuestion"]) }),
      ],
      room: [methodRow(pv, plan, fromLines(["context.compaction.method"])), writer(pv, plan, fromLines(["context.compaction.writer", "context.compaction.model"]))],
      more: [],
    };
  };

  /**
   * A fresh start (U3-7, UX-12): what a fresh session of the agent carries of the earlier turns — after a switch into
   * it, after Filament's copy made room. The session's own choice (`context.carry`, Words unless chosen); a session the
   * agent lost — the chat moved, or the agent let it go — carries the turns Whole unless one is chosen (the owner's of
   * 11-06). Its ▾ opens the control a fork and a sub-agent's launch share, each form with
   * what a start under it weighs now (the preview's sweep; the agent adds its own prompt and tools).
   * @param {any} pv @param {any[]} [more]  lines under it
   */
  const freshStart = (pv, more = []) => {
    const who = P.agentName().replace(/^The /, "the ");
    const set = String(ctx.view()?.settings?.effective?.context?.carry || "words");
    const now = CARRY_WORDS.some((x) => x.id === set) ? set : "words";
    const sweep = pv?.forms || {};
    const size = (/** @type {string} */ id) => Number(sweep[id]?.tokens) || 0;
    // Where what a start would carry holds no tool calls — a summary alone, turns of words — every form weighs the
    // same, and the row says why instead of looking broken.
    const sizes = CARRY_WORDS.map((x) => size(x.id));
    const same = !!pv && sizes[0] > 0 && sizes.every((n) => n === sizes[0]);
    /** Whether there is a chat to weigh a start of: your defaults (Settings › Context) have none, so no figures. */
    const weighed = !!pv && sizes.some((n) => n > 0);
    return item({
      id: "carry",
      label: "A fresh start",
      sub: "carries earlier turns as",
      choice: nameIn(CARRY_WORDS, now),
      title: `What a fresh ${who} session carries of this chat: after a switch into ${who}, after Filament's copy makes room. After its session was lost — the chat moved, or ${who} let it go — it carries the turns Whole, unless you choose a form here`,
      fig: pv === undefined ? skel(64) : size(now) ? `starts from ≈${tok(size(now))}` : null,
      under: [same ? m("span", { class: "inst-how-why", title: "What a start would carry holds no tool calls to fold or count, so every form sends the same." }, "↳ Every form weighs the same now: no tool calls to fold.") : null, ...more],
      open: () => {
        const c = carryControl(m, { options: CARRY_WORDS, value: () => now, onChange: (id) => ctx.write({ patch: { context: { carry: id } } }), figures: weighed, bare: true });
        if (weighed) for (const x of CARRY_WORDS) c.fig(x.id, size(x.id) ? tok(size(x.id)) : "—");
        return [c.el];
      },
    });
  };

  /**
   * Filament's copy (HarnessV4_Tasks C29): whether Filament keeps its own copy of a coding agent's chat in step with the
   * agent — a summary written for the copy alone where the agent compacts and hands none over, or the copy passes the
   * line — and who writes it. The copy is what a fresh agent session, or another model, starts from.
   * @param {any} pv @param {any} plan @param {any[]} [more]  lines under it
   */
  const copyRow = (pv, plan, more = []) => {
    const who = D ? "the agent" : P.agentName().replace(/^The /, "the ");
    const on = P.follows();
    const model = plan?.writers?.chosen?.model || null;
    // Kept in step: one line says who writes the copy's summary; when, in full, is its title (V4-D217: the whole
    // sentence ran to three lines under the row).
    /** @param {string} writer  in the sentence @param {string} lead  the line's own start @param {string} [more] */
    const inStep = (writer, lead, more = "") => m("span", {
      class: "inst-how-why",
      title: `When ${who} compacts and hands no summary over, or the copy passes the line, ${writer} writes the copy's summary in the background, once that makes the copy smaller.${more}`,
    }, `↳ ${lead} writes its summary in the background.`);
    const how = !on ? "↳ The copy keeps every turn until you compact it; a start that does not fit asks first."
      : D || pv === undefined ? inStep("a model Filament calls", "A model Filament calls")
        : model ? inStep(shortModel(model), shortModel(model), " Its own session goes on as it is.")
          : "↳ No model to write the copy's summary with: name a compaction model, or give memory one. Until then the copy keeps every turn.";
    return item({
      id: "copy",
      label: "Filament's copy",
      choice: on ? "Kept in step" : "Keeps every turn",
      title: `What Filament does with its own copy of the chat as ${who} compacts`,
      under: [how, ...more],
      open: () => [group(m, switchRow(m, {
        label: "Keep the copy in step",
        sub: "Filament summarizes its own copy as the agent compacts; the agent's session is not touched",
        checked: on,
        onChange: (v) => { if (v !== on) ctx.write({ patch: { context: { compaction: { follow: v } } } }); },
      }))],
    });
  };

  /**
   * Where a row's value comes from, one line under it. In a chat (the mock of 10-18): a row the chat changed says
   * "Changed here" with Use yours, which takes the chat's own value back so the row follows your defaults again; a
   * row it follows says nothing. On your defaults: "Your default" with Reset, which takes back the row's knobs that are
   * yours; the dashboard's rules. A row on its built-in value says nothing.
   * @param {string[]} paths  the knobs the row writes
   * @returns {any[]}
   */
  const fromLines = (paths) => {
    const settings = ctx.view()?.settings;
    const sources = settings?.sources || {};
    // The chat's own, or yours on your defaults: the layer this section writes.
    const own = (/** @type {string} */ p) => (D ? sources[p] === "session" : sourceOfKnob(p, settings) === "session");
    const mine = paths.filter(own);
    if (!D)
      return mine.length
        ? [["↳ Changed here · ", m("button", { class: "inst-link", type: "button", title: "Take this chat's own value back: the row follows your defaults again", onclick: () => ctx.write({ unset: mine }) }, "Use yours")]]
        : [];
    const flat = settings?.flat || {};
    return [
      mine.length
        ? ["↳ Your default · ", m("button", { class: "inst-link", type: "button", title: "Take your default back: the dashboard's rule, else the built-in value", onclick: () => ctx.write({ unset: mine }) }, "Reset")]
        // The mirror names some knobs with nothing in them (no model named): that is no rule to speak of.
        : paths.some((p) => sources[p] === "global" && flat[p] != null && flat[p] !== "") ? "↳ From the dashboard's rules" : null,
    ];
  };
  /** Your line's knob. */
  const LINE = ["context.compaction.thresholdPercent"];

  /** Your defaults (Settings › How earlier turns are kept, U3-8): what a chat takes where it has not chosen — your line,
   *  then and back after a break; the way in Filament's own chats and in a coding agent's, and who writes Filament's
   *  summaries; under Advanced a coding agent's fresh start and copy, then tool results and making room. No history:
   *  that is a session's own. @param {any} pv @param {any} plan @returns {Parts} */
  const defaultRows = (pv, plan) => {
    const chosen = P.chosenWay();
    return {
      full: [
        lineRow(fromLines(LINE)),
        fullRow({ under: fromLines(["context.compaction.mode"]) }),
        coldRow({ under: fromLines(["context.compaction.resumeQuestion"]) }),
        changedRow({ under: fromLines(["context.compaction.changeQuestion"]) }),
      ],
      room: [
        methodRow(pv, plan, fromLines(["context.compaction.method"]), "in the chats Filament runs itself"),
        item({
          id: "way",
          label: "A coding agent's way",
          sub: "in a coding agent's chat",
          choice: P.wayName(chosen),
          title: "How a coding agent's chat makes room",
          under: fromLines(["context.compaction.agent"]),
          open: () => [P.waysGroup(m, null)],
        }),
        writer(pv, plan, ["↳ In the chats Filament runs itself, as with GLM; a coding agent writes its own.", ...fromLines(["context.compaction.writer", "context.compaction.model"])]),
      ],
      more: [
        m("div", { class: "inst-how-sub" }, "In a coding agent's chat"),
        freshStart(pv, fromLines(["context.carry"])),
        copyRow(pv, plan, fromLines(["context.compaction.follow"])),
      ],
    };
  };

  /** A coding agent (UX-9): it keeps its own history and compacts it itself — your line with where it compacts by itself,
   *  then and back after a break; its way; under Advanced, a fresh start, Filament's copy, then Filament's methods on
   *  that copy. @param {any} pv @param {any} plan @returns {Parts} */
  const agentRows = (pv, plan) => {
    const who = P.agentName();
    const a = plan?.agent || null;
    const chosen = P.chosenWay();
    const running = a ? wayNow(a, Date.now()) : chosen;
    const w = P.window();
    const line = w ? standing(0, w, P.percent()).lineTokens : 0;
    // Why Compact now takes this way, and what it leaves: the Compaction pill's How row said it (U3-4). Where the row
    // names the way the suggestion takes, the line does not name it again (V4-D217).
    const why = P.wayLine(plan, Date.now(), { named: chosen === "suggested" && !!a });
    const under = shareLine({ who, share: a?.share, line });
    const id = P.method();
    return {
      full: [
        lineRow([`↳ ${pointLine({ who, line: line || null, point: agentPointOf(ctx.view(), ctx.live()) })}`, under ? `↳ ${under}` : null, ...fromLines(LINE)]),
        fullRow({ how: running === "suggested" ? "" : P.wayName(running), under: fromLines(["context.compaction.mode"]) }),
        coldRow({ agent: true, under: fromLines(["context.compaction.resumeQuestion"]) }),
        changedRow({ agent: true, under: fromLines(["context.compaction.changeQuestion"]) }),
      ],
      room: [
        item({
          id: "way",
          label: "The way",
          sub: "the card's first choice",
          choice: chosen === "suggested" && a ? `${P.wayName("suggested")} · ${P.wayName(running)} now` : P.wayName(chosen),
          title: "How this session makes room",
          under: [why ? `↳ ${why}` : null, ...fromLines(["context.compaction.agent"])],
          open: () => [P.waysGroup(m, a)],
        }),
      ],
      more: [
        freshStart(pv, fromLines(["context.carry"])),
        copyRow(pv, plan, fromLines(["context.compaction.follow"])),
        // Filament's methods, for the copy a fresh agent session starts from (UX-9; their own disclosure until U11). They
        // make room where the copy does — Compact now on it, its way at the line; keeping the copy in step in the
        // background writes one summary of all but its newest turn, whatever is chosen here (HarnessV4_Tasks C30 item 4).
        m("div", { class: "inst-how-sub" }, "Compact on Filament's copy instead"),
        note(m, `Filament keeps its own copy of this chat. A fresh ${who.replace(/^The /, "")} session starts from it: after Filament's copy makes room, a fresh start, or a switch to another agent. These are how the copy makes room when you compact on it; kept in step in the background, it gets one summary of all but its newest turn.`),
        P.methodList(m, plan, pv === undefined ? null : pv),
        P.methodControl(m),
        group(m, P.instantRow(m, plan)),
        id === "summary" ? P.writerSection(m, plan, { waiting: pv === undefined }) : null,
      ],
    };
  };

  /** A client (UX-10): it compacts by itself, its own model writing the summary — no line of Filament's, so nothing
   *  asks when it is full, and no way of Filament's to choose. @returns {Parts} */
  const clientRows = () => {
    const name = P.clientName();
    return {
      full: [],
      room: [item({ id: "method", label: "The way", sub: `${name} compacts by itself`, choice: `${name}'s own`, title: `${name}'s compaction goes to its own model as ${name} sent it` })],
      more: [],
    };
  };

  /** A disclosure: ▸ its title and what it is; what it holds now, its title. @param {string} title @param {string} sub
   *  @param {string} holds */
  const disclosure = (title, sub, holds) => m("button", {
    class: `inst-how-more${ui.more ? " is-open" : ""}`,
    type: "button",
    "aria-expanded": ui.more ? "true" : "false",
    ...(holds ? { title: `Holds ${holds}` } : {}),
    onclick: () => { ui.more = !ui.more; draw(shownPv); },
  }, icon(m, "chevronRight", "inst-how-more-chev"), m("span", { class: "inst-how-more-title" }, title), m("span", { class: "inst-how-more-sub" }, sub));

  /** Advanced's rows: the numbers behind the rows' names, and the rarer knobs. @param {any} pv @param {any} plan */
  const advancedParts = (pv, plan) => {
    const s = ctx.view()?.settings || {};
    const flat = s.flat || {};
    const id = P.method();
    // The tool results of the turns sent whole: as they came back unless a policy is chosen.
    const results = String(flat["context.results"] ?? DEFAULT_RESULTS);
    const from = String(s.sources?.["context.results"] || "default");
    const resultsRow = m("div", { class: "inst-row inst-how-stack" },
      m("span", { class: "inst-row-text" },
        m("span", { class: "inst-row-label" }, "Tool results"),
        m("span", { class: "inst-row-sub" }, ...kids([
          EARLIER_RESULTS[results] ? m("span", { class: "inst-how-earlier", title: "Offered no more: it sends as it did until you pick As is or One line" }, `${EARLIER_RESULTS[results]}, chosen before · `) : null,
          from === "session" ? (D ? "Your default · " : "Chosen for this session · ") : from === "default" ? "Filament's default: as they came back" : D ? "From the dashboard's rules" : "From your settings",
          from === "session" ? m("button", { class: "inst-link", type: "button", title: "Send them as they came back, Filament's default", onclick: () => ctx.write({ unset: ["context.results"] }) }, "The default") : null,
        ]))),
      segmented(m, { options: RESULTS, value: () => results, ariaLabel: "How tool results of finished turns are sent", onChange: (v) => { if (v !== results) ctx.write({ patch: { context: { results: v } } }); } }).el);
    // Making room: the method's own number, and the instant line (the owner's rules of 10-31).
    const full = kids([P.methodControl(m), group(m, P.instantRow(m, plan))]);
    return [
      section(m, "Every turn", group(m, resultsRow)),
      full.length ? section(m, "Making room", ...full) : null,
    ];
  };

  /** What Advanced holds for this session now, for its title: only what it would show — the rows before the knobs by
   *  their names, then the finer knobs. @param {any[]} rows */
  const advancedHint = (rows) => {
    const v = variant();
    const id = P.method();
    const named = rows.length
      ? v === "agent" ? ["a fresh start", "Filament's copy", "Filament's methods on it"]
        : v === "defaults" ? ["a coding agent's fresh start and copy"]
          : []
      : [];
    const knobs = v === "agent" ? [] : [
      id === "fold" ? "newest whole" : "",
      "the instant line",
      "tool results",
    ];
    return [...named, ...knobs].filter(Boolean).join(" · ");
  };

  /** ▸ Advanced, what every request carries: the variant's rows (`rows`), then — but in a coding agent's session, whose
   *  own come with its rows — the finer knobs. @param {any} pv @param {any} plan @param {any[]} rows */
  const advancedBox = (pv, plan, rows) => [
    disclosure("Advanced", "what every request carries", advancedHint(rows)),
    ui.more
      ? m("div", { class: "inst-how-open inst-how-advanced" }, ...kids([
          rows.length ? m("div", { class: "inst-how-list" }, ...kids(rows)) : null,
          ...(variant() === "agent" ? [] : advancedParts(pv, plan)),
        ]))
      : null,
  ];

  /** A part: its heading, then its rows on one card; with no rows, none. @param {string} title @param {string} id
   *  @param {any[]} rows */
  const part = (title, id, rows) => {
    const list = kids(rows);
    return list.length ? m("div", { class: "inst-how-part", "data-part": id }, m("div", { class: "inst-how-sec" }, title), m("div", { class: "inst-how-list" }, ...list)) : null;
  };

  /**
   * Other agents' results (HarnessV4_Envelopes_Plan EN5): what reaches the agent while it works — a sub-agent's report,
   * a team's result beside the chat, a flow's end — sealed, one line with who sent it and its subject, opened with its
   * envelope tool when it reaches a stopping point; or whole, the report itself in its next request
   * (`subagents.envelopes`). A client runs no loop of Filament's that one could reach. @returns {any[]}
   */
  const resultsRows = () => {
    const s = ctx.view()?.settings;
    const now = String(s?.flat?.["subagents.envelopes"] ?? s?.effective?.subagents?.envelopes ?? "sealed") === "whole" ? "whole" : "sealed";
    return [item({
      id: "envelopes",
      label: "While your agent works",
      sub: "another agent's result",
      control: segmented(m, {
        options: [
          { id: "sealed", label: "Sealed", title: "One line with who sent it and its subject; the agent opens it when it reaches a stopping point, so its work is not broken off. One that lands as it waits, or as its turn ends, opens by itself." },
          { id: "whole", label: "Whole", title: "The whole report joins the agent's next request, wherever it is in its work" },
        ],
        value: () => now,
        ariaLabel: "How another agent's result reaches your agent while it works",
        onChange: (v) => { if (v !== now) ctx.write({ patch: { subagents: { envelopes: v } } }); },
      }).el,
      title: "How a sub-agent's report, a team's result or a flow's end reaches your agent while it works",
      under: fromLines(["subagents.envelopes"]),
    })];
  };

  /** @param {any} pv  the preview; undefined while it is on its way, {} where there is none */
  const draw = (pv) => {
    shownPv = pv;
    const v = variant();
    const plan = pv ? P.planOf(pv) : null;
    const rows = v === "defaults" ? defaultRows(pv, plan) : v === "agent" ? agentRows(pv, plan) : v === "client" ? clientRows() : loopRows(pv, plan);
    el.replaceChildren(...kids([
      m("div", { class: "inst-how-title" }, v === "defaults" ? "How earlier turns reach the model, where a chat has not chosen its own" : `How earlier turns reach ${v === "agent" ? P.agentName().replace(/^The /, "the ") : "the model"}`),
      part("When the chat is full", "full", rows.full),
      part("How it makes room", "room", rows.room),
      v === "client" ? null : part("Other agents' results", "results", resultsRows()),
      v === "defaults" ? null : historyPart(pv),
      // A client's requests obey none of Advanced's knobs: they reach its provider as it sent them.
      ...(v === "client" ? [] : advancedBox(pv, plan, rows.more)),
    ]));
  };
  const paint = () => {
    drawn = stateKey();
    const mine = ++asked;
    draw(undefined);
    Promise.resolve(ctx.preview?.()).then((pv) => { if (mine === asked) draw(pv || {}); }, () => { if (mine === asked) draw({}); });
  };
  paint();
  return { el, repaint: (force = false) => { if (force || drawn !== stateKey()) paint(); } };
}
