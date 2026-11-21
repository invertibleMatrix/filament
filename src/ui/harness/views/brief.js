// @ts-check
// A team's Brief (team_v2_plan §10 O1, the mock of 10-19; the rework of 11-11: one box and Send, the rest under
// Options): the one sheet every team starts from — the Teams tab's Brief…, Send a team…, Verify, then send… and
// Overview's teams open it. What stands open: its first question, the way — On the side (the team works in a chat of
// its own; your agent goes on, untouched; the result comes to you) or In charge (its lead takes your agent's seat in
// this chat) —, what it is to do, in your words, addressed to its lead, and one line that says every other choice as
// its outcome (lib/brief.js `defaultsLine`): what its lead reads, where its result goes, what runs. Options, a fold
// under that line kept as the person left it, holds each of those choices: for a team that hunts, on the side, what it
// hunts in (its range); what its lead reads before Send — this whole chat, its size against the lead's window, the
// turn running now — with Preview…; on the side, what happens when it is done — its result to you always, BugHunters'
// check and your agent only where switched on —, in charge that its orders go out at once; the team: its lead and its
// workers as portraits, the model each runs on — picked in the chat's own model picker, by provider, with its price
// and a plan's room — and how hard each thinks; and in charge what changes in this chat and what it costs once.
// Options opens by itself, its reason at its head, where a choice made for the person cannot stand (`optionsWhy`): a
// model that cannot run, a chat that does not fit its lead's window whole. While your agent works, in charge says over
// Options that it hands over when that turn ends. A team that changes no file opens on the side, and where In charge
// is picked for it its card and Options say, before Send, what the server holds it to there (lib/brief.js
// `chargeWords`; d-side, 11-12). It opens on the team's last run in this browser, said so, the
// team's own a press away. Opening it starts nothing; Send does. The words are lib/brief.js's; every read and press
// goes through the host (app.js).
import { h, placeChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { prettyModel } from "../lib/families.js";
import { toggle } from "../lib/fields.js";
import { menu as openMenu, sheet as openSheet } from "../lib/ui.js";
import { createModelSelect } from "../composer/model.js";
import { store } from "../../lib/store.js";
import { SIDE_EFFORTS, effortName } from "../lib/side.js";
import { kids } from "../widgets/kit.js";
import { fmt } from "../../lib/format.js";
import { BUGHUNTERS, SWITCH_WORDS, fellWords } from "../lib/beside.js";
import { possessive } from "../lib/labels.js";
import { NARROW, OPTIONS_PREF, PICKS_PREF, RANGE_WORDS, WAYS, cardsFirst, changesFiles, chargeWords, defaultsLine, fitOf, huntsIn, keepPicks, leadFrom, leadLook, memberLook, narrowed, optionsHolds, optionsWhy, ownModels, picksOf, readsLines, tokWords, usualWay, workersFrom } from "../lib/brief.js";

/**
 * The chat a Brief is opened over, as the host reads it now.
 * @typedef {{ title: string, model: string, live: boolean, round: number | null, paused: boolean, workersAtWork: boolean,
 *   tokens: number, compactions: number, turns: number, cost: { tokens: number, usd: number } | null,
 *   agentEffort?: string }} BriefChat  `agentEffort`: its main agent's effort, what a team's lead thinks at where
 *   the Brief picks nothing, and so its workers
 */

/**
 * What the Brief reads and does — the host's.
 * @typedef {{
 *   teams: () => any[],
 *   chat: () => BriefChat,
 *   models: () => any[],
 *   families?: () => any[],
 *   accounts?: () => any[],
 *   seats: () => string[],
 *   reads: (team: string, model: string) => Promise<import("../lib/brief.js").ReadsFacts | null>,
 *   preview: (team: string, model: string) => Promise<string | null>,
 *   runsOn: (team: string, pick: { model?: string, workers?: string }) => Promise<import("../lib/beside.js").BesideOn | null>,
 *   fire: (body: { team: string, ask: string, model: string | null, workers: string | null, range?: string, effort: string | null, workersEffort: string | null, verify: boolean, notify: boolean, of: string | null, reads: "chat" | "words" }) => Promise<boolean>,
 *   handOver: (o: { team: string, words: string, workers: string | null, workersEffort: string | null }) => Promise<"now" | "after" | false>,
 *   stopTurn: () => void,
 *   usd?: (n: number) => string,
 * }} BriefIO  `chat`: the chat it opens over — its model, whether a turn runs and its round, whether a question waits or
 *   workers are at work, its size and compactions, the switch's one cache rebuild; `families`,
 *   `accounts`: the catalogue's families and the coding agents' accounts, which the model pickers show; `seats`: the
 *   models of the Seats for team workers, in order; `reads`: what a lead on `model` would read, On the side; `preview`:
 *   that record whole; `runsOn`: what the team runs on, as a fire would pick; `fire`: On the side's Send, true once it started; `handOver`: In charge's Send —
 *   "now", or "after" the running turn, or false where the host said why; `stopTurn`: the chat's running turn stopped
 */

/**
 * What the Brief opens with: a team, a way, words, and what a Verify… carries.
 * @typedef {{ team?: string, way?: import("../lib/brief.js").Way, ask?: string, of?: string | null, model?: string, workers?: string }} BriefFill
 */

/**
 * Open the Brief over the page.
 * @param {BriefIO} io @param {BriefFill} [fill]
 * @param {{ h?: typeof h, place?: (parent: any, wanted: any[]) => void, sheet?: (o: any) => { el: any, close: () => void },
 *   modelSelect?: typeof createModelSelect, menu?: typeof openMenu, store?: { get: (k: string) => string | null, set: (k: string, v: string) => void } }} [o]
 *   the tests' fake DOM, its `place`, the sheet, the model picker, the menu, and where the last picks and Options'
 *   fold are kept
 * @returns {{ el: any, close: () => void, paint: () => void, state: () => any }}
 */
export function openBrief(io, fill = {}, o = {}) {
  const mk = o.h || h;
  const place = o.place || placeChildren;
  const sheetOf = o.sheet || openSheet;
  const menuOf = o.menu || openMenu;
  const keep = o.store || store;
  const usd = io.usd || ((/** @type {number} */ n) => `$${n.toFixed(2)}`);
  /** A price as about so much — "<$0.0001" says it already. @param {string} s */
  const about = (s) => (s.startsWith("<") ? s : `≈${s}`);
  /** @param {string} name @param {string} [cls] */
  const glyph = (name, cls = "inst-ic") => mk("span", { class: cls, html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });
  /** A portrait: a squircle in its tone, its glyph, a crown on a lead. @param {{ icon: string, tone: string }} look @param {string} size @param {{ crown?: boolean, cls?: string }} [x] */
  const portrait = (look, size, x = {}) =>
    mk("span", { class: `pf ${size} t-${look.tone}${x.cls ? ` ${x.cls}` : ""}`, "aria-hidden": "true" }, glyph(look.icon, "pf-ic"), x.crown ? glyph("crown", "pf-crown") : null);

  const teams = () => (io.teams() || []).filter((t) => t && t.key);
  const first = teams().find((t) => t.key === fill.team) || teams().find((t) => t.key === BUGHUNTERS) || teams()[0] || null;
  const st = {
    team: String(first?.key || ""),
    way: /** @type {import("../lib/brief.js").Way} */ (fill.way || (first ? usualWay(first) : "side")),
    ask: String(fill.ask || ""),
    model: String(fill.model || ""),
    workers: String(fill.workers || ""),
    /** How hard its lead thinks this run ("": as the settings say) and its workers (""): this chat's effort for agents). */
    effort: "",
    workersEffort: "",
    /** What a hunt hunts in, in the person's words ("": what is uncommitted and what this chat changed). */
    range: "",
    /** The picks it opened with from the team's last run, as `picksKey` says them; "" where it opened on the team's own. */
    seeded: "",
    verify: false,
    // Verify, then send…: BugHunters' check goes to your agent when it ends, unless the person turns it off here.
    notify: !!fill.of,
    /** @type {"chat" | "words"} On the side, what its lead reads first: this whole chat, or only the words (a fresh start). */
    reads: /** @type {"chat" | "words"} */ ("chat"),
    of: fill.of ?? null,
    sending: false,
  };
  const team = () => teams().find((t) => t.key === st.team) || null;
  /** Whether this Brief starts a hunt that takes a range: a team that hunts, on the side, checking no result. */
  const hunting = () => huntsIn(team()) && st.way === "side" && !st.of;
  // A Verify… checks one result: it goes on the side.
  if (st.of) st.way = "side";
  /** The picks as they stand, to tell whether they are still the last run's. */
  const picksKey = () => JSON.stringify([st.model, st.workers, st.effort, st.workersEffort]);
  /**
   * Its picks as the team's last run in this browser left them (the owner's yes of 10-21), where the Brief brings none
   * of its own — a check carries its own; a model no longer listed, or a word that is no effort, is left out.
   */
  const seed = () => {
    st.seeded = "";
    if (st.of) return;
    const p = picksOf(keep.get(PICKS_PREF), st.team);
    if (!p) return;
    const ids = new Set((io.models() || []).map((m) => String(m?.id ?? m)));
    /** @param {string} x */
    const listed = (x) => (x && (!ids.size || ids.has(x)) ? x : "");
    /** @param {string} x */
    const level = (x) => (SIDE_EFFORTS.includes(x) ? x : "");
    st.model = listed(p.model);
    st.workers = listed(p.workers);
    st.effort = level(p.effort) === "model" ? "" : level(p.effort);
    st.workersEffort = level(p.workersEffort);
    if (st.model || st.workers || st.effort || st.workersEffort) st.seeded = picksKey();
  };
  /** Every pick back to the team's own. */
  const unpick = () => {
    st.model = "";
    st.workers = "";
    st.effort = "";
    st.workersEffort = "";
    st.seeded = "";
  };
  if (!fill.model && !fill.workers) seed();

  // ---- what the server says, each read again only when what it depends on changes ----------------------------------
  /** @type {{ key: string, facts: import("../lib/brief.js").ReadsFacts | null, done: boolean }} */
  let reads = { key: "", facts: null, done: false };
  /** @type {{ key: string, on: import("../lib/beside.js").BesideOn | null, done: boolean }} */
  let runs = { key: "", on: null, done: false };
  let closed = false;
  /** The record whole, while Preview… shows it in place of What its lead reads. @type {string | null} */
  let previewing = null;

  // ---- the head ----------------------------------------------------------------------------------------------------
  const headTile = mk("span", { class: "br-head-tile" });
  const headTitle = mk("div", { class: "br-title" });
  const teamSel = mk("select", { class: "br-team-sel", "aria-label": "Change team", onchange: (/** @type {any} */ e) => {
    st.team = String(e.target.value);
    unpick();
    seed();
    const t = team();
    if (t && !st.of) st.way = usualWay(t);
    paint();
  } });
  const headLine = mk("div", { class: "br-line" });
  const head = mk("div", { class: "br-head" }, headTile, mk("div", { class: "br-head-text" }, mk("div", { class: "br-title-row" }, headTitle, teamSel), headLine));

  // ---- the way -----------------------------------------------------------------------------------------------------
  // In charge's line is the team's (d-side, 11-12): one the server holds to reading says so on the card, before the
  // press and before Send — painted with the team (`paintWays`).
  const chargeLine = mk("span", { class: "br-way-line" });
  /** @param {import("../lib/brief.js").Way} id */
  const wayCard = (id) => mk("button", { class: `br-way is-${id}`, type: "button", role: "radio", onclick: () => { if (st.of && id === "charge") return; st.way = id; paint(); } },
    mk("span", { class: "br-radio", "aria-hidden": "true" }),
    mk("span", { class: "br-way-text" },
      mk("span", { class: "br-way-name" }, glyph(id === "side" ? "columns2" : "crown", "br-way-ic"), WAYS[id].label),
      id === "charge" ? chargeLine : mk("span", { class: "br-way-line" }, WAYS[id].line)));
  const ways = { side: wayCard("side"), charge: wayCard("charge") };
  const wayEl = mk("div", { class: "br-ways", role: "radiogroup", "aria-label": "How should it work with this chat?" }, ways.side, ways.charge);

  // ---- In charge: what changes in this chat ------------------------------------------------------------------------
  const changes = mk("div", { class: "br-changes" });

  // ---- what it is to do --------------------------------------------------------------------------------------------
  const askTo = mk("span", { class: "br-to" });
  const askSize = mk("span", { class: "br-to-size" });
  const askIn = mk("textarea", { class: "br-ask", rows: "3", "aria-label": "What it is to do", placeholder: "What it is to do — find bugs in the last 5 phases, each with its file, line and the code that shows it", oninput: (/** @type {any} */ e) => { st.ask = String(e.target.value); paintSend(); paintAskSize(); } });
  askIn.value = st.ask;
  askIn.addEventListener("keydown", (/** @type {any} */ e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void go();
    }
  });
  const narrowEl = mk("div", { class: "br-narrow" }, mk("span", { class: "br-narrow-label" }, "Or narrow it:"),
    ...NARROW.map((n) => mk("button", { class: "br-chip", type: "button", title: n.words, onclick: () => { st.ask = narrowed(st.ask, n.id); askIn.value = st.ask; paintSend(); paintAskSize(); askIn.focus?.(); } }, n.label)));
  const askHead = mk("div", { class: "br-sec-head" });
  const askBox = mk("div", { class: "br-ask-box" }, mk("div", { class: "br-ask-top" }, askTo, askSize), askIn, narrowEl);
  const paintAskSize = () => askSize.replaceChildren(st.ask.trim() ? `${tokWords(fmt.tokens(st.ask.length))} tokens` : "");
  // What a hunt hunts in (the plan's p6): a team that hunts, on the side, names its range in plain words — none, what is
  // uncommitted and what this chat changed. Filament reads it from git as Send fires it, and refuses one that names
  // nothing in words there.
  const rangeIn = mk("input", { class: "zc-input br-range-in", type: "text", "aria-label": "What to hunt in", placeholder: RANGE_WORDS.hint, oninput: (/** @type {any} */ e) => { st.range = String(e.target.value); } });
  const rangeRow = mk("div", { class: "br-range" }, mk("label", { class: "br-range-label" }, mk("b", {}, "What to hunt in"), rangeIn), mk("p", { class: "br-note br-range-line" }, RANGE_WORDS.line));

  // ---- what its lead reads -----------------------------------------------------------------------------------------
  const readsHead = mk("div", { class: "br-sec-head" });
  const readsBox = mk("div", { class: "br-reads" });
  const previewBtn = mk("button", { class: "br-link", type: "button", onclick: () => void preview() }, glyph("eye", "br-link-ic"), "Preview…");
  // On the side, the lead reads this whole chat first, or only the words — a fresh start, nothing of this chat (the
  // owner's ask of 10-19: "what if i wanted a fresh bug hunter without any history").
  /** @param {"chat" | "words"} id @param {string} label @param {string} title */
  const readsOpt = (id, label, title) => mk("button", { class: "br-seg-btn", type: "button", role: "radio", title, onclick: () => { st.reads = id; previewing = null; paint(); } }, label);
  const readsOpts = { chat: readsOpt("chat", "This whole chat", "Its lead reads this chat first, then your words"), words: readsOpt("words", "Only what you write here", "A fresh start: its lead reads your words alone, nothing of this chat") };
  const readsSeg = mk("span", { class: "br-seg", role: "radiogroup", "aria-label": "What its lead reads" }, readsOpts.chat, readsOpts.words);

  // ---- when it is done / its orders --------------------------------------------------------------------------------
  const thenHead = mk("div", { class: "br-sec-head" });
  const thenBox = mk("div", { class: "br-then" });
  const thenNote = mk("p", { class: "br-note" });
  // Its steps are made once, each switch painted on or off in place (`paintThen`): a switch with the focus stays in the
  // page as its press paints.
  /** A step one of its switches turns on or off. @param {"verify" | "notify"} key @param {string} line */
  const thenStep = (key, line) => {
    const sw = toggle(mk, false, SWITCH_WORDS[key].label, () => { st[key] = !st[key]; paint(); });
    return { sw, el: mk("div", { class: "br-stp" }, sw, mk("span", { class: "br-stp-text" }, mk("b", {}, SWITCH_WORDS[key].label), mk("span", {}, line))) };
  };
  const resultStep = mk("div", { class: "br-stp" }, portrait({ icon: "user", tone: "you" }, "s24"), mk("span", { class: "br-stp-text" }, mk("b", {}, "Its result comes to you"), mk("span", {}, "always")));
  const verifyStep = thenStep("verify", "a second team, against the code");
  const notifyStep = thenStep("notify", "into its turn, by itself");
  const thenArrows = [glyph("chevronRight", "br-arw"), glyph("chevronRight", "br-arw")];

  // ---- In charge while a turn runs ----------------------------------------------------------------------------------
  const waitBar = mk("div", { class: "br-wait", role: "status" });

  // ---- the team: who runs it ---------------------------------------------------------------------------------------
  const squadTag = mk("span", { class: "br-tag" });
  const leadEl = mk("div", { class: "br-lead" });
  // Its lead's and its workers' models in the picker the chat's box has (the owner's 10-21: "can't see providers and
  // effort level"): by provider, searchable, each with its window, its price and the levels it takes, a plan's room on
  // its coding agent's tab.
  const pickerOf = o.modelSelect || createModelSelect;
  const leadPick = pickerOf({ onChange: (name) => { st.model = name; paint(); }, onUseDefault: () => { st.model = ""; paint(); }, defaultDesc: "This chat's rows for its lead, else the team's, else its card's, else this chat's model", blank: "This chat's model" });
  leadPick.el.setAttribute("aria-label", "Its lead runs on");
  const crewPick = pickerOf({ onChange: (name) => { st.workers = name; paint(); }, onUseDefault: () => { st.workers = ""; paint(); }, defaultDesc: "This chat's rows for its workers, else the team's models, else each worker's card's, else this chat's list, else its lead's model", blank: "Each worker's card's" });
  crewPick.el.setAttribute("aria-label", "Its workers run on");
  /** How hard one of them thinks: a chip with its words, its menu under it. @param {string} label @param {"lead" | "crew"} who */
  const effortChip = (label, who) => {
    const words = mk("span", { class: "br-effort-words" });
    const el = mk("button", { class: "br-effort", type: "button", title: label, "aria-label": label, "aria-haspopup": "menu", onclick: () => openEffort(el, who) },
      glyph("gauge", "br-effort-ic"), words, glyph("chevronDown", "br-effort-caret"));
    return { el, words };
  };
  const leadEffort = effortChip("How hard its lead thinks", "lead");
  const crewEffort = effortChip("How hard its workers think", "crew");
  // The lead's words, the row of its model and effort, and the workers' row of theirs stay the same elements across
  // paints: each picker is moved by no paint.
  const leadLine = mk("span", { class: "br-lead-line" });
  const leadChip = mk("span", { class: "br-chip-model" });
  const leadFromEl = mk("span", { class: "br-from" });
  const leadRow = mk("span", { class: "br-model-row" });
  const leadHead = mk("b", {}, "Its lead");
  const leadText = mk("div", { class: "br-lead-text" });
  const lastEl = mk("div", { class: "br-last" });
  const workersEl = mk("div", { class: "br-workers" });
  const fellEl = mk("div", { class: "br-fell", role: "status" });
  const folderEl = mk("div", { class: "br-folder" });
  const costEl = mk("div", { class: "br-cost" });

  // ---- the foot ----------------------------------------------------------------------------------------------------
  const footLine = mk("p", { class: "br-foot-line" });
  const why = mk("span", { class: "br-why", role: "status" });
  const send = mk("button", { class: "br-send", type: "button", onclick: () => void go() });
  const cancel = mk("button", { class: "br-cancel", type: "button", onclick: () => close() }, "Cancel");
  const foot = mk("div", { class: "br-foot" }, footLine, why, cancel, send);

  // ---- the defaults in a line, and Options --------------------------------------------------------------------------
  // Every choice Options holds, said as its outcome under the box: what the Brief does with nothing touched.
  const defaultsEl = mk("p", { class: "br-defaults" });
  // Options: a fold, as the person left it in this browser — and open by itself where a choice made for them cannot
  // stand (`optionsWhy`), its reason at its head, where it stays as the fold is shut.
  let optsOpen = keep.get(OPTIONS_PREF) === "1";
  /** The reasons Options last opened for, or stayed as it was for: it opens once for each set of them. */
  let optsWhy = "";
  const optsChev = glyph("chevronRight", "br-opts-chev");
  const optsHint = mk("span", { class: "br-hint" });
  const optsHead = mk("button", { class: "br-opts-head", type: "button", "aria-expanded": "false", onclick: () => {
    optsOpen = !optsOpen;
    keep.set(OPTIONS_PREF, optsOpen ? "1" : "0");
    paintOptions();
  } }, optsChev, mk("b", {}, "Options"), optsHint);
  const optsWhyEl = mk("div", { class: "br-opts-why", role: "status" });
  const optsNotes = mk("div", { class: "br-notes" });

  // Each section is made once, its parts painted in place: a part with the focus stays in the page as it paints.
  const askSec = mk("div", { class: "br-sec" }, askHead, askBox);
  const readsSec = mk("div", { class: "br-sec" }, readsHead, readsBox);
  const thenSec = mk("div", { class: "br-sec" }, thenHead, thenBox, thenNote);
  // "The team", over "Its lead" and "Its workers": the one thing both belong to, and what its tag — Read-only, Changes
  // files — says something of.
  const squadEl = mk("div", { class: "br-squad" }, mk("div", { class: "br-squad-head" }, mk("span", { class: "br-cap" }, "The team"), squadTag), lastEl, leadEl, workersEl, fellEl);
  // Options' parts, in the order they are said: what to hunt in, what its lead reads, when it is done or its orders,
  // the team; then, in charge and for a team that changes files, what changes, what it costs and whose folder it is.
  const optsBody = mk("div", { class: "br-opts hidden" },
    mk("div", { class: "br-grid" }, mk("div", { class: "br-col" }, rangeRow, readsSec, thenSec), mk("div", { class: "br-col is-side" }, squadEl)),
    optsNotes);
  const optsFold = mk("div", { class: "br-opts-fold" }, mk("div", { class: "br-opts-top" }, optsHead, optsWhyEl), optsBody);
  const body = mk("div", { class: "br-body" }, mk("div", { class: "br-q" }, "How should it work with this chat?"), wayEl, askSec, defaultsEl, waitBar, optsFold);

  /** A picker given the catalogue as the page has it, and the model it shows. @param {ReturnType<typeof createModelSelect>} p @param {string} name */
  const feed = (p, name) => {
    p.setModels(io.models() || []);
    p.setFamilies(io.families?.() || []);
    p.setAccounts(io.accounts?.() || []);
    p.set(name);
  };
  /** The levels a lead or its workers may be asked to think at, as an agent's Effort chip offers them (U12-D7). */
  const LEVELS = SIDE_EFFORTS.filter((id) => id !== "model");
  /** The main agent's effort: what its lead thinks at where nothing is picked, and so its workers (the owner's of 11-05). */
  const agentEffort = () => io.chat().agentEffort || "model";
  // Its lead's effort where none is picked: what the row of the model it runs on says (`leadEffort`, the review of
  // 11-05), else the main agent's.
  const leadDefault = () => runs.on?.leadEffort || agentEffort();
  /**
   * How hard its lead or its workers think this run: its lead as the main agent does, its workers as their lead — or a
   * level, at which a model that takes fewer thinks at its highest below it.
   * @param {any} anchor @param {"lead" | "crew"} who
   */
  function openEffort(anchor, who) {
    const lead = who === "lead";
    const now = lead ? st.effort : st.workersEffort;
    /** @param {string} id */
    const set = (id) => {
      if (lead) st.effort = id;
      else st.workersEffort = id;
      paint();
    };
    menuOf([
      { type: "label", label: lead ? "How hard its lead thinks" : "How hard its workers think" },
      lead
        ? { type: "radio", label: `The default: ${effortName(leadDefault())}`, desc: runs.on?.leadEffort ? "What its model's row says" : "The main agent's effort", checked: !now, onClick: () => set("") }
        : { type: "radio", label: "The default: as its lead", desc: "As hard as its lead thinks, as each model takes it", checked: !now, onClick: () => set("") },
      ...(lead ? [] : [{ type: "radio", label: effortName("model"), desc: "The level each model takes by itself", checked: now === "model", onClick: () => set("model") }]),
      ...LEVELS.map((id) => ({ type: "radio", label: effortName(id), checked: now === id, onClick: () => set(id) })),
      { type: "separator" },
      { type: "label", label: lead ? "A model that takes fewer levels thinks at its highest below this one" : "A model that takes fewer levels thinks at its highest below this one; its lead may still name another for one worker" },
    ], { anchor, width: 340 });
  }

  const workersName = mk("b", {});
  const workersHead = mk("div", { class: "br-workers-head" }, workersName);
  const crewFromEl = mk("span", { class: "br-from" });
  const useList = mk("button", { class: "br-link", type: "button", onclick: () => { st.workers = ""; paint(); } }, "Use the list");
  const crewRow = mk("span", { class: "br-model-row" });

  /** What the server says, read again where the picks changed. */
  function fetchFacts() {
    const t = team();
    if (!t) return;
    const pk = JSON.stringify([st.team, st.model, st.workers]);
    if (runs.key !== pk) {
      runs = { key: pk, on: null, done: false };
      void io.runsOn(st.team, { model: st.model, workers: st.workers }).then((on) => {
        if (closed || runs.key !== pk) return;
        runs = { key: pk, on, done: true };
        paint();
      });
    }
    const rk = JSON.stringify([st.team, st.model]);
    if (rk !== reads.key) previewing = null;
    if (st.way === "side" && reads.key !== rk) {
      reads = { key: rk, facts: null, done: false };
      void io.reads(st.team, st.model).then((facts) => {
        if (closed || reads.key !== rk) return;
        reads = { key: rk, facts, done: true };
        paint();
      });
    }
  }

  async function preview() {
    const text = await io.preview(st.team, st.model);
    if (closed || text == null) return;
    previewing = text;
    paint();
  }

  /** The send button's words and whether it may go. */
  function paintSend() {
    const t = team();
    const c = io.chat();
    const charge = st.way === "charge";
    const busy = charge && (c.live || c.paused || c.workersAtWork);
    const problem = !t
      ? "Pick a team"
      : !st.ask.trim()
        ? "Say what it is to do"
        : charge && c.paused
          ? "A question waits for your answer in this chat: answer it first"
          : "";
    send.replaceChildren(glyph("arrowUp", "br-send-ic"), st.sending ? (charge ? "Handing over…" : "Sending…") : charge && busy ? "Send — hand over after this turn" : "Send");
    send.toggleAttribute("disabled", !!problem || st.sending);
    send.setAttribute("title", problem || (charge ? "Its lead takes this chat and reads your words as its first message"
      : st.reads === "words" ? "Send it: its lead reads your words alone and goes to work beside this chat" : "Send it: its lead reads this chat and goes to work beside it"));
    why.replaceChildren(problem && st.ask.trim() ? problem : "");
  }

  function paintHead() {
    const t = team();
    headTile.replaceChildren(portrait(leadLook(st.team), "s48", { crown: true }));
    headTitle.replaceChildren(t ? `Brief the ${t.name}` : "Brief a team");
    const ids = teams().map((x) => x.key);
    if (teamSel.dataset?.key !== ids.join(",")) {
      teamSel.replaceChildren(...teams().map((x) => mk("option", { value: x.key }, x.name)));
      if (teamSel.dataset) teamSel.dataset.key = ids.join(",");
    }
    teamSel.value = st.team;
    headLine.replaceChildren([t?.line ? `${String(t.line).replace(/\.?$/, ".")}` : "", "Nothing runs until you press Send."].filter(Boolean).join(" "));
  }

  function paintWays() {
    chargeLine.replaceChildren(chargeWords(team()).line);
    for (const id of /** @type {const} */ (["side", "charge"])) {
      const on = st.way === id;
      ways[id].classList.toggle("is-on", on);
      ways[id].setAttribute("aria-checked", on ? "true" : "false");
      const off = id === "charge" && !!st.of;
      ways[id].toggleAttribute("disabled", off);
      if (off) ways[id].setAttribute("title", "A check goes on the side: it reads one result");
    }
  }

  function paintChanges() {
    const t = team();
    const c = io.chat();
    const lead = leadLook(st.team);
    const members = (t?.members || []).slice(0, 5).map((/** @type {any} */ m) => portrait(memberLook(m), "s24"));
    const you = portrait({ icon: "user", tone: "you" }, "s32");
    place(changes, [
      mk("div", { class: "br-sec-label" }, "What changes in this chat"),
      mk("div", { class: "br-lanes" },
        mk("div", { class: "br-lane" }, mk("span", { class: "br-lane-when" }, "Now"), you, glyph("arrowRightLeft", "br-arr"), portrait({ icon: "bot", tone: "agent" }, "s32"),
          mk("span", { class: "br-lane-text" }, mk("b", {}, "You and your agent"), c.model ? ` · ${prettyModel(c.model)}` : "")),
        mk("div", { class: "br-lane" }, mk("span", { class: "br-lane-when is-after" }, "After Send"), portrait({ icon: "user", tone: "you" }, "s32"), glyph("arrowRightLeft", "br-arr"), portrait(lead, "s32", { crown: true, cls: "ring-gold" }), glyph("arrowRight", "br-arr is-gold"),
          mk("span", { class: "br-mini-party" }, ...members),
          mk("span", { class: "br-lane-text" }, mk("b", {}, `You and the ${possessive(t?.name || "team")} lead`), ", which sends its workers")),
        mk("div", { class: "br-lane is-quiet" }, mk("span", { class: "br-lane-when" }), portrait({ icon: "bot", tone: "agent" }, "s24", { cls: "is-dim" }),
          mk("span", { class: "br-lane-text" }, "Your agent steps aside and waits. ", mk("b", {}, "Back to your agent"), ", on the band at the top of the chat, gives it the chat again — the whole conversation stays."))),
    ]);
  }

  function paintAsk() {
    const t = team();
    const charge = st.way === "charge";
    askHead.replaceChildren(mk("b", {}, "What it is to do"), mk("span", { class: "br-hint" }, charge ? "— your first message, to its lead" : "— your words, to its lead"));
    askTo.replaceChildren(portrait(leadLook(st.team), "s16"), `To: ${t ? `${possessive(t.name)} lead` : "its lead"}`);
    // The chips narrow the ask against this chat: a lead that reads none of it could not follow them.
    narrowEl.classList.toggle("hidden", charge || st.reads === "words");
    // A range is a hunt's, on the side: a check reads the claims it is given.
    rangeRow.classList.toggle("hidden", !hunting());
    paintAskSize();
  }

  function paintReads() {
    const c = io.chat();
    const charge = st.way === "charge";
    if (previewing != null && !charge) {
      const back = mk("button", { class: "br-link", type: "button", onclick: () => { previewing = null; paint(); } }, glyph("chevronLeft", "br-link-ic"), "Back");
      place(readsBox, [mk("div", { class: "br-preview" }, mk("div", { class: "br-preview-head" }, mk("b", {}, "What its lead reads first, whole"), back), mk("pre", { class: "br-preview-text" }, previewing))]);
      return;
    }
    readsHead.replaceChildren(mk("b", {}, "What its lead reads"), mk("span", { class: "br-hint" }, charge ? "— before it answers" : "— in this order, before it starts"), ...(charge ? [] : [mk("span", { class: "th-sp" }), readsSeg]));
    for (const [id, b] of Object.entries(readsOpts)) {
      b.classList.toggle("is-on", st.reads === id);
      b.setAttribute("aria-checked", String(st.reads === id));
    }
    if (charge) {
      place(readsBox, [
        mk("div", { class: "br-rd" }, mk("span", { class: "br-stack", "aria-hidden": "true" }, mk("i"), mk("i"), mk("i")),
          mk("div", { class: "br-rd-text" },
            mk("div", { class: "br-rd-head" }, mk("b", {}, "This whole chat"), mk("span", { class: "br-rd-fig" }, [`${c.turns} ${c.turns === 1 ? "turn" : "turns"}`, c.compactions ? `${c.compactions} ${c.compactions === 1 ? "compaction" : "compactions"}` : "", c.tokens ? `${tokWords(c.tokens)} tokens` : ""].filter(Boolean).join(" · "))),
            mk("div", { class: "br-rd-sub" }, "as your agent reads it now — then your words above, and from then on every message you send here"))),
      ]);
      return;
    }
    if (st.reads === "words") {
      place(readsBox, [
        mk("div", { class: "br-rd" }, mk("span", { class: "br-rd-words", "aria-hidden": "true" }, glyph("messageSquare", "br-rd-ic")),
          mk("div", { class: "br-rd-text" }, mk("div", { class: "br-rd-head" }, mk("b", {}, "Only your words above")),
            mk("div", { class: "br-rd-sub" }, "a fresh start: it reads nothing of this chat — say what to look at, and where"))),
      ]);
      return;
    }
    const f = reads.facts;
    const lines = f ? readsLines(f) : null;
    const fit = f ? fitOf(f) : null;
    place(readsBox, kids([
      mk("div", { class: "br-rd" }, mk("span", { class: "br-stack", "aria-hidden": "true" }, mk("i"), mk("i"), mk("i")),
        mk("div", { class: "br-rd-text" },
          mk("div", { class: "br-rd-head" }, mk("b", {}, "This whole chat"), mk("span", { class: "br-rd-fig" }, lines ? `${c.title ? `${c.title} · ` : ""}${lines.fig}` : reads.done ? "its size could not be read now" : "reading its size…"), f ? previewBtn : null),
          lines?.running ? mk("div", { class: "br-rd-sub is-live" }, glyph("loader", "br-rd-ic"), lines.running) : null,
          lines ? mk("div", { class: "br-rd-sub" }, lines.rest) : null)),
      mk("div", { class: "br-rd" }, mk("span", { class: "br-rd-words", "aria-hidden": "true" }, glyph("messageSquare", "br-rd-ic")),
        mk("div", { class: "br-rd-text" }, mk("div", { class: "br-rd-head" }, mk("b", {}, "Then your words above")), mk("div", { class: "br-rd-sub" }, "the task, last, where a lead reads it"))),
      fit ? mk("div", { class: `br-fit is-${fit.tone}` },
        mk("div", { class: "br-win" }, mk("i", { style: `width:${Math.max(1, Math.round(fit.share * 100))}%` }), mk("span", { class: "br-win-half" })),
        mk("p", { class: "br-fit-words" }, fit.words)) : null,
    ]));
  }

  function paintThen() {
    const t = team();
    const charge = st.way === "charge";
    if (charge) {
      // What goes out, and what it does to your folder, are the team's: one that changes no file applies nothing.
      const says = chargeWords(t);
      thenHead.replaceChildren(mk("b", {}, "Its orders to its workers"));
      place(thenBox, [mk("div", { class: "br-stp" },
        mk("span", { class: "br-stp-text" }, mk("b", {}, "They go out at once"), mk("span", {}, says.orders)))]);
      thenNote.replaceChildren(says.note);
      return;
    }
    thenHead.replaceChildren(mk("b", {}, "When it's done"), mk("span", { class: "br-hint" }, st.of ? "— its check goes to your agent unless you turn it off" : "— both off unless you turn them on"));
    // Nothing checks BugHunters' own result: its switch is not offered, and stays as it was for a team picked after it
    // (found by the Bug Hunter, 10-19: picking the team that checks turned it off for good).
    const canVerify = st.team !== BUGHUNTERS;
    for (const [step, on] of /** @type {const} */ ([[verifyStep, st.verify], [notifyStep, st.notify]])) {
      step.el.classList.toggle("is-off", !on);
      step.sw.classList.toggle("on", on);
      step.sw.setAttribute("aria-checked", on ? "true" : "false");
    }
    place(thenBox, kids([resultStep, thenArrows[0], canVerify ? verifyStep.el : null, canVerify ? thenArrows[1] : null, notifyStep.el]));
    thenNote.replaceChildren(st.notify
      ? `Your agent gets ${canVerify && st.verify ? "BugHunters' check of the result" : "its result"} by itself when it is done: into its running turn, else a turn of its own.`
      : `Off: the result waits for you on the Agents tab and as a card in this chat — your agent hears nothing of it until you send it there.`);
  }

  function paintWait() {
    const c = io.chat();
    const charge = st.way === "charge";
    // A question waiting comes first: Send cannot hand over until it is answered, whatever else runs (found by the Bug
    // Hunter, 10-19: the bar said nothing of it, or promised a hand-over Send would refuse).
    if (charge && c.paused) {
      place(waitBar, [
        glyph("circleHelp", "br-wait-ic"),
        mk("span", { class: "br-wait-text" }, mk("b", {}, "A question waits for your answer in this chat."), " Answer it first — then Send hands over."),
      ]);
      waitBar.classList.remove("hidden");
      return;
    }
    const busy = charge && (c.live || c.workersAtWork);
    place(waitBar, busy ? [
      glyph("loader", "br-wait-ic"),
      mk("span", { class: "br-wait-text" }, mk("b", {}, c.live ? `Your agent is working${c.round ? ` (round ${c.round})` : ""}.` : "Its workers are still at work."),
        " Send keeps your words and hands over the moment that ends — or stop it first."),
      c.live ? mk("button", { class: "br-link", type: "button", onclick: () => io.stopTurn() }, "Stop the turn") : null,
    ] : []);
    waitBar.classList.toggle("hidden", !busy);
  }

  /**
   * What would run with the picks as they stand, as the pickers show it and the line under the box says it: its
   * lead's model, and its workers' — the first of their list, whose list it is, and the rule whole (`workersFrom`).
   */
  const runsNow = () => {
    const c = io.chat();
    const charge = st.way === "charge";
    const on = runs.on;
    // Its lead: on the side, the card's pick, else the team's, else this chat's; in charge, this chat's own model.
    const leadModel = charge ? c.model : st.model || on?.lead || c.model;
    // Its workers with no list of this chat's to run on: each worker's card's, else its lead's model — in charge this
    // chat's own (teams-beside.js `runsOn`). No list to run on, as the server's answer says — a list whose rows are
    // all this chat's model is one, by name (the review of 0376f5a4f).
    const seats = io.seats();
    const none = !st.workers && !seats.length && (!on || on.from === "seats");
    const whose = charge ? "this chat's model" : "its lead's model";
    const wf = none
      ? { first: leadModel || "", words: whose, tip: cardsFirst(whose), cards: true }
      : workersFrom(st.workers ? { lead: null, workers: [st.workers], from: "picked", fell: [] } : on, seats);
    // The workers that run on a model of their own, whatever the picker shows: said with it, never as the list's.
    const theirs = ownModels(team()?.members || [], wf.cards);
    return { leadModel, wf, theirs };
  };

  function paintSquad() {
    const t = team();
    const c = io.chat();
    const charge = st.way === "charge";
    const builds = t ? changesFiles(t) : false;
    squadTag.replaceChildren(glyph(builds ? "pencil" : "lock", "br-tag-ic"), builds ? "Changes files" : "Read-only · changes no file");
    squadTag.className = `br-tag ${builds ? "is-ed" : "is-ro"}`;
    const on = runs.on;
    const { leadModel, wf, theirs } = runsNow();
    const leadWords = leadFrom({ pick: st.model, team: t, on });
    // A picker shows what runs unpicked too: dimmed as the effort chips are, so it never reads as a pick (the owner's 10-27).
    if (!charge) {
      feed(leadPick, leadModel || "");
      leadPick.setNote(leadWords);
      leadPick.el.classList.toggle("is-default", !st.model);
    }
    leadEffort.words.replaceChildren(effortName(st.effort || leadDefault()));
    leadEffort.el.classList.toggle("is-default", !st.effort);
    crewEffort.words.replaceChildren(st.workersEffort ? effortName(st.workersEffort) : "As its lead");
    crewEffort.el.classList.toggle("is-default", !st.workersEffort);
    // Opened on the team's last run in this browser: said so, with the team's own a press away.
    const asLast = !!st.seeded && st.seeded === picksKey();
    place(lastEl, asLast ? [glyph("history", "br-last-ic"), mk("span", { class: "br-last-text" }, "As you ran it last time."),
      mk("button", { class: "br-link", type: "button", onclick: () => { unpick(); paint(); } }, "Use the team's")] : []);
    lastEl.classList.toggle("hidden", !asLast);
    leadLine.replaceChildren(t?.lead?.name && t.lead.name !== t.name ? `${t.lead.name}: plans the work, hands it out, checks what comes back` : "plans the work, hands it out, checks what comes back");
    leadChip.replaceChildren(prettyModel(leadModel || "") || "this chat's model");
    leadFromEl.replaceChildren(charge ? "this chat's model and effort — change them in the box" : leadWords);
    place(leadRow, charge ? [leadChip, leadFromEl] : [leadPick.el, leadEffort.el, leadFromEl]);
    place(leadText, [leadHead, leadLine, leadRow]);
    place(leadEl, [portrait(leadLook(st.team), "s56", { crown: true, cls: "ring-gold" }), leadText]);
    // Its workers: one portrait per member; a team of one kind, its one, as many as the work needs.
    const members = /** @type {any[]} */ (t?.members || []);
    const party = members.length === 1
      ? [portrait(memberLook(members[0]), "s28"), mk("span", { class: "br-mul" }, "× as many as needed")]
      : members.map((m) => mk("span", { class: "br-mem" }, portrait(memberLook(m), "s28"), mk("span", { class: "br-mem-name" }, m.name)));
    // The picker shows the model and the words beside it whose list it is of; the rule whole — each worker's card's
    // first, where a list comes after them — is the picker's tip (the rework of 11-11: a model said as a model).
    feed(crewPick, st.workers || wf.first || "");
    crewPick.setNote(wf.tip);
    crewPick.el.classList.toggle("is-default", !st.workers);
    const names = members.length === 1 ? `${members[0].name}s` : "workers";
    // A member the team names a model for runs on it, at its effort where it names one, whatever is picked here.
    const owns = members.filter((m) => m.own?.model || m.own?.effort);
    const ownOf = (/** @type {any} */ m) => [m.own?.model ? `on ${prettyModel(m.own.model)}` : "", m.own?.effort ? `at ${effortName(m.own.effort).toLowerCase()}` : ""].filter(Boolean).join(" ");
    const ownWords = owns.map((m) => `${m.name} ${ownOf(m)}`);
    // A worker whose card names a model runs on it where the picker shows a list's first: named with it.
    const carded = theirs.filter((x) => x.whose === "card").map((x) => `${x.name} on ${prettyModel(x.model)}`);
    workersName.replaceChildren(`Its ${names}`);
    crewFromEl.replaceChildren(wf.words);
    place(crewRow, kids([crewPick.el, crewEffort.el, crewFromEl, st.workers ? useList : null]));
    place(workersEl, kids([
      workersHead,
      mk("div", { class: "br-party" }, ...kids(party)),
      mk("p", { class: "br-note" }, `${members.length === 1 ? "The lead decides how many it needs" : "The lead sends as many of each as the work needs"}; a model at its limit, set on its row under its provider, passes one to the next.`),
      owns.length
        ? mk("p", { class: "br-note br-own" }, `${ownWords.length > 1 ? `${ownWords.slice(0, -1).join(", ")} and ${ownWords.at(-1)}` : ownWords[0]}: the team's own for ${owns.length === 1 ? "it" : "them"}, over any pick here.`)
        : null,
      carded.length
        ? mk("p", { class: "br-note br-carded" }, `${carded.length > 1 ? `${carded.slice(0, -1).join(", ")} and ${carded.at(-1)}` : carded[0]}: ${carded.length === 1 ? "its card's" : "their cards'"}, unless you pick one here.`)
        : null,
      // A model picked here runs alone, its list's others dropped for this run: said, with the list a press away.
      crewRow,
    ]));
    // Each model it names that cannot run, with why, before Send.
    place(fellEl, fellWords(on).map((w) => mk("p", { class: "br-note is-warn" }, glyph("shieldAlert", "br-note-ic"), w)));
    // A check is only as good as the model its Checker runs on: a hint, never a lock.
    if (st.team === BUGHUNTERS && !st.workers && on?.from === "seats")
      fellEl.append(mk("p", { class: "br-note is-hint" }, glyph("shieldCheck", "br-note-ic"), "Checks are only as good as the model that makes them: a strong one is usual for the Checker — give it its own on Library › Agents and teams."));
    // In charge: what it costs once, and whose folder it is.
    place(costEl, charge ? [
      mk("div", { class: "br-cost-head" }, glyph("circleDollar", "br-cost-ic"), mk("b", {}, c.cost ? `Costs once: ${tokWords(c.cost.tokens)} tokens · ${about(usd(c.cost.usd))}` : "Costs once: this chat is cached again for the lead")),
      mk("p", { class: "br-note" }, "The lead reads this chat as a new reader, so your provider caches it again — once. After that it is cached as usual. Back to your agent costs the same, once."),
    ] : []);
    place(folderEl, builds ? [
      mk("div", { class: "br-cost-head" }, glyph("gitBranch", "br-cost-ic"), mk("b", {}, "Your folder stays yours")),
      mk("p", { class: "br-note" }, "A worker that changes files works in its own copy (a git worktree). The lead brings a change into your folder once Filament has run its check; nothing is committed."),
    ] : []);
  }

  /** The line under the box: every choice Options holds, as its outcome with the picks as they stand. */
  function paintDefaults() {
    const { leadModel, wf, theirs } = runsNow();
    const members = team()?.members || [];
    defaultsEl.replaceChildren(defaultsLine({
      way: st.way, reads: st.reads, verify: st.team !== BUGHUNTERS && st.verify, notify: st.notify,
      lead: leadModel || "", workers: st.workers || wf.first || "", own: !theirs.length ? "" : theirs.length < members.length ? "some" : "all",
      cut: !!reads.facts?.cut,
    }));
  }

  /** Options: open or folded, what it holds said at its head, why it opened by itself, and the notes that apply. */
  function paintOptions() {
    const t = team();
    const charge = st.way === "charge";
    const why = optionsWhy({ way: st.way, reads: st.reads, on: runs.on, facts: reads.facts });
    // It opens once for each set of reasons: folded by the person under one, it stays folded until another stands; and
    // open, it stays open as a reason goes — the part the person works in never folds under them.
    const said = why.join("\n");
    if (said && said !== optsWhy) optsOpen = true;
    optsWhy = said;
    optsHead.setAttribute("aria-expanded", optsOpen ? "true" : "false");
    optsHint.replaceChildren(`— ${optionsHolds(st.way, hunting())}`);
    place(optsWhyEl, why.map((w) => mk("p", { class: "br-opts-reason" }, glyph("shieldAlert", "br-note-ic"), w)));
    optsFold.classList.toggle("is-open", optsOpen);
    optsBody.classList.toggle("hidden", !optsOpen);
    place(optsNotes, kids([charge ? changes : null, charge ? costEl : null, t && changesFiles(t) ? folderEl : null]));
  }

  function paintFoot() {
    const t = team();
    const c = io.chat();
    const words = st.way === "charge"
      ? `From your message on, ${t ? `the ${possessive(t.name)} lead` : "its lead"} answers in this chat. Back to your agent is on the band at its top.`
      : `It works in a chat of its own${c.title ? `, beside “${c.title}”` : ""}. Your agent is not interrupted and its cache stays warm.`;
    footLine.replaceChildren(glyph(st.way === "charge" ? "crown" : "columns2", "br-foot-ic"), words);
  }

  function paint() {
    if (closed) return;
    fetchFacts();
    paintHead();
    paintWays();
    paintChanges();
    paintAsk();
    paintReads();
    paintThen();
    paintWait();
    paintSquad();
    paintDefaults();
    paintOptions();
    paintFoot();
    paintSend();
    sheetEl.classList?.toggle("is-charge", st.way === "charge");
  }

  async function go() {
    const t = team();
    if (!t || st.sending || !st.ask.trim()) return;
    const c = io.chat();
    if (st.way === "charge" && c.paused) return;
    st.sending = true;
    paintSend();
    let ok = false;
    // A hunt's range, where it names one (the plan's p6).
    const range = hunting() ? st.range.trim() : "";
    if (st.way === "side") {
      ok = await io.fire({ team: st.team, ask: st.ask.trim(), model: st.model || null, workers: st.workers || null, ...(range ? { range } : {}), effort: st.effort || null, workersEffort: st.workersEffort || null, verify: st.team !== BUGHUNTERS && st.verify, notify: st.notify, of: st.of, reads: st.reads });
    } else {
      ok = !!(await io.handOver({ team: st.team, words: st.ask.trim(), workers: st.workers || null, workersEffort: st.workersEffort || null }));
    }
    st.sending = false;
    // What it ran on, kept for the team's next Brief in this browser — a check's, which its result brings, by nobody.
    if (ok && !st.of) keep.set(PICKS_PREF, keepPicks(keep.get(PICKS_PREF), st.team, { model: st.model, workers: st.workers, effort: st.effort, workersEffort: st.workersEffort }));
    if (ok) close();
    else paintSend();
  }

  const s = sheetOf({ class: "brief-sheet", label: "Brief a team", head, body, foot, onClose: () => { closed = true; } });
  const sheetEl = s.el.querySelector?.(".zc-sheet") || s.el;
  function close() {
    if (closed) return;
    closed = true;
    s.close();
  }
  paint();
  askIn.focus?.();
  return { el: s.el, close, paint, state: () => ({ ...st }) };
}
