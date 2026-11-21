// @ts-check
// A flow on the page (HarnessV4_Flow_Plan F5; its F0 mock, HarnessV4_Flow_Plan-mock.html; HarnessV4_OneAgent_Plan
// OA3, OA4): the person's agents and teams, and their own review, in steps beside the chat, which run top to bottom — a
// step's boxes side by side, each step with its why, each box with what it needs — and wear cyan (orange while the
// flow waits for you, gray once stopped). One card draws a flow wherever it shows: its head (the tile, where it stands,
// its title), what it waits for — a restart's Go on, a gate's verdict with Send back, Go on anyway and Stop, your
// review with Go on, Send back and Stop, a box that failed with Retry, Skip and Stop, a box that asks you — its steps,
// and once it ended where its end went.
//
// It shows in three places. Over the message box (`createFlowDock`), in whichever view shows the dock: a draft whole —
// your agent's, from a /flow, or one drawn by hand: move a box up or down a step, remove it, open it, Bring my
// uncommitted edits into its worktree, Discard, Save as a flow…, Start, the one press that runs it (FL-D2) — and a flow
// that waits for you, by what it waits for. On the
// Agents tab (`createFlowPane`), a flow's row opens it whole: pick a box to read what it was handed and its answer, and
// act on it. The Flows row there is where a flow is drawn by hand or from a saved one (F6). And in the chat's header
// (`createFlowStatus`), the line of the one that runs: "Flow · step 3 of 5 · Reviewer asks you". The main agent hears
// of a flow at its Start and at its end (OA-D8, FL-D10). Every press goes through the host (`io.press`), which puts the
// flow the server answers in the list and says a refusal in words. A card is built again only when what it shows
// changes; the fields typed into stay the same nodes. Start ▾ starts it In place too (OA4): a turn of your agent drives
// it — the card says so, with what your agent did and why, and where that turn ended before the flow did, Go on beside.
// A flow moves while it runs (the Designer's of 10-28): a box at work says what it does now — its round, its tool, how
// long — over a sliding bar, kept in place as its agent moves and the clock ticks (`live`), and what changed since the
// list's last read is played once on the card drawn after it (flow-moves.js); the header's line shimmers while it runs.
import { h, morphChildren, placeChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { toggle } from "../lib/fields.js";
import { kids } from "../widgets/kit.js";
import { doneMark } from "../lib/marks.js";
import { cardIcon, cardTone } from "../lib/agent-cards.js";
import { leadLook } from "../lib/brief.js";
import {
  BRING_FAILED_WORDS, BRING_WORDS, COUNT_HELD_WORDS, DRAFT_NOTE, FLOW_HOME, KIND_TIPS, KIND_WORDS, START_WAYS, TELL_WORDS, agentActs, backOffers, boxBadge, boxLine, boxOf, boxesOf,
  bringFailed, bringNote, countNote, endWords, ended, flowFig, flowOfItem, gateWords, isLive, money, moveBox, needsWords, needsYou, placeNote, placeWords, savedLine, statusOf, stepNow,
  stepsBody, sumLine, tookOf, worksWords, writeTip,
} from "../lib/flow.js";
import { menu } from "../lib/ui.js";
import { formatWorkedFor } from "../lib/labels.js";
import { withoutBox } from "./flow-sheet.js";
import { playFlowMoves } from "./flow-moves.js";
import { motion } from "../bar-flight.js";

/** @typedef {typeof h} Mk */
/** @typedef {import("../lib/flow.js").Flow} Flow */
/** @typedef {import("../lib/flow.js").FlowBox} FlowBox */
/** @typedef {import("../lib/flow.js").FlowRoutes} FlowRoutes */
/** @typedef {{ tag: string, name: string, kind?: string, goodFor?: string, from?: string | null }} Card */
/** @typedef {{ key: string, name: string, line?: string, readOnly?: boolean }} Team */

/**
 * What a flow's card reads and does — the host's.
 * @typedef {{
 *   rows: () => Flow[],
 *   cards: () => Card[],
 *   teams: () => Team[],
 *   seats?: () => number | null,
 *   uncommitted?: () => import("../lib/flow.js").Uncommitted | null,
 *   recount?: () => void,
 *   press: (fn: (r: FlowRoutes) => Promise<any>) => Promise<any>,
 *   editBox?: (flow: Flow, step: number, index: number | null) => void,
 *   save?: (flow: Flow) => void,
 *   openThread: (id: string) => void,
 *   openTeam: (id: string) => void,
 *   openFlow: (id: string) => void,
 *   putBack?: (words: string) => void,
 *   saved?: () => import("../lib/flow.js").SavedFlow[] | null,
 *   loadSaved?: () => void,
 *   teamsOn?: () => boolean,
 *   created?: (flow: Flow) => void,
 *   now?: () => number,
 *   changes?: (id: string) => import("../lib/flow.js").FlowMoment[],
 *   live?: (box: FlowBox) => BoxLive | null,
 * }} FlowIO  `press`: a route called through the host — the flow it answers stands in the list at once, a refusal is
 *   said; null where it was refused; `editBox`: a box's sheet (views/flow-sheet.js), `index` null for a new box at the
 *   step's end, a `step` past the last for a new step; `save`: Save as a flow…'s sheet; `openThread`: an agent box's
 *   thread on the Agents tab; `openTeam`: a team box's chat; `openFlow`: the flow's row on the Agents tab;
 *   `putBack`: Discard's words back in the message box; `saved`: the saved flows, null until read, and `loadSaved`
 *   reads them; `created`: a flow drawn by hand or from a saved one; `changes`: what the list saw change in a flow a
 *   moment ago, played on its card (flow-moves.js); `live`: what a box at work does now — its agent's round and tool,
 *   a team's workers — null where it is not known; `uncommitted`: the count of uncommitted files a draft's worktree
 *   would leave in the chat's folder (lib/flow.js `bringNote`, `countNote`): whether it is asked now, which holds Start,
 *   and why it failed; `recount`: Count again, after a failed one
 */
/**
 * What a box at work does now (the Designer's of 10-28): its agent's round, the tool it runs or its newest words; a
 * team box, its workers at work and waiting.
 * @typedef {{ round?: number, tool?: { name: string, args?: string } | null, words?: string, team?: string }} BoxLive
 */
/**
 * A box at work's live line, kept across the card's draws: its words and its tool, the box they say, and what each said
 * last, so a second's tick that changes nothing touches nothing.
 * @typedef {{ el: any, line: any, tool: any, b: FlowBox, said: string, did: string }} LiveNode
 */

/**
 * The fields a card types in: the gate's line, a draft's name and words. One set for each place the card shows — over
 * the box and on the Agents tab — as a node stands in one place only.
 * @typedef {{ line: any, title: any, goal: any }} CardFields
 */

/**
 * The page's state of a card, kept per flow: the box it shows, whether it is being edited, the gate's line as typed in
 * either place, each place's fields, the answers read whole.
 * @typedef {{ sel: string | null, picked: boolean, editing: boolean, typed: string, at: { pane?: CardFields, dock?: CardFields }, whole: Map<string, string>, reading: Set<string>, live: Map<string, LiveNode> }} CardState
 *   `live`: each box at work's live line, by its place and its id
 */

/**
 * @param {FlowIO} io @param {{ h?: Mk, place?: (parent: any, wanted: any[]) => void }} [o]  the tests' fake DOM and its `place`
 */
export function createFlowCards(io, o = {}) {
  const mk = o.h || h;
  const now = io.now || Date.now;
  /** @param {string} name @param {string} [cls] */
  const glyph = (name, cls = "inst-ic") => mk("span", { class: cls, "aria-hidden": "true", html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });
  /**
   * A button: its words, its tip, its press. @param {string} label @param {string} title @param {() => void} fn
   * @param {{ primary?: boolean, icon?: string, quiet?: boolean, disabled?: boolean }} [p]
   */
  const button = (label, title, fn, p = {}) =>
    mk("button", { class: `inst-btn${p.primary ? " is-primary" : ""}${p.quiet ? " is-quiet" : ""}`, type: "button", title, onclick: () => { if (!p.disabled) fn(); }, ...(p.disabled ? { disabled: "", "aria-disabled": "true" } : {}) },
      p.icon ? glyph(p.icon) : null, label);
  /** A link-styled press. @param {string} label @param {string} title @param {() => void} fn */
  const link = (label, title, fn) => mk("button", { class: "br-link", type: "button", title, onclick: fn }, label, glyph("chevronRight", "br-link-ic"));

  /** A box's face: its card's glyph and colour, a team's with its crown, your review's. @param {Pick<FlowBox, "kind" | "agent">} b @param {string} size */
  const faceOf = (b, size) => {
    if (b.kind === "team") {
      const look = leadLook(b.agent);
      return mk("span", { class: `pf ${size} t-${look.tone}`, "aria-hidden": "true" }, glyph(look.icon, "pf-ic"), glyph("crown", "pf-crown"));
    }
    if (b.kind === "review") return mk("span", { class: `pf ${size} t-gray`, "aria-hidden": "true" }, glyph("user", "pf-ic"));
    const c = io.cards().find((x) => x.tag === b.agent) || null;
    return mk("span", { class: `pf ${size} t-${c ? cardTone(c) : "gray"}`, "aria-hidden": "true" }, glyph(c ? cardIcon(c) : "bot", "pf-ic"));
  };

  /** @type {Map<string, CardState>} */
  const states = new Map();
  /** @param {Flow} f @returns {CardState} */
  const stateOf = (f) => {
    let s = states.get(f.id);
    if (!s) {
      s = { sel: null, picked: false, editing: false, typed: "", at: {}, whole: new Map(), reading: new Set(), live: new Map() };
      states.set(f.id, s);
    }
    return s;
  };
  /**
   * A card's fields in one place, made on its first build there; the gate's line typed in one place is the other's too.
   * @param {Flow} f @param {CardState} s @param {"pane" | "dock"} where @returns {CardFields}
   */
  const fieldsAt = (f, s, where) => {
    const had = s.at[where];
    if (had) return had;
    /** @type {any} */
    let line = null;
    line = mk("input", { class: "fl-input", type: "text", maxlength: "600", placeholder: "Optional: what it should change", "aria-label": "Your line for the send-back", oninput: () => { s.typed = String(line?.value || ""); } });
    line.value = s.typed;
    const made = {
      line,
      title: mk("input", { class: "fl-input", type: "text", maxlength: "120", "aria-label": "The flow's name", onchange: () => void words(f.id, where) }),
      goal: mk("textarea", { class: "fl-input fl-goal-input", rows: "3", maxlength: "8000", "aria-label": "Your words: they head every box's ask", onchange: () => void words(f.id, where) }),
    };
    s.at[where] = made;
    return made;
  };
  /** Each place's gate line shows what was typed in either, but where the person types now. @param {CardState} s */
  const syncLines = (s) => {
    for (const x of [s.at.pane, s.at.dock]) if (x && document_active() !== x.line && x.line.value !== s.typed) x.line.value = s.typed;
  };
  /** A draft's name and words, as typed in its fields in one place. @param {string} id @param {"pane" | "dock"} where */
  const words = async (id, where) => {
    const x = states.get(id)?.at[where];
    if (!x) return;
    await io.press((r) => r.edit(id, { title: String(x.title.value || ""), goal: String(x.goal.value || "") }));
  };

  /** The cards built, each with what it was built from. @type {Map<string, { el: any, key: string }>} */
  const built = new Map();
  /** Something a card shows moved on the page alone (a box picked, edit mode): it is built again on its next paint. @param {string} id */
  const stale = (id) => {
    built.delete(`${id}:pane`);
    built.delete(`${id}:dock`);
  };

  /** @type {(() => void) | null} */
  let onStale = null;

  /** A box's act, through the host. @param {Flow} f @param {string} bid @param {"stop" | "skip" | "retry" | "hand-on" | "take"} what */
  const act = (f, bid, what) => void io.press((r) => r.act(f.id, bid, what));

  /**
   * The head: the tile, Flow and where it stands, its title (the goal on its tip); Stop while it runs; in the dock, the
   * way to its steps on the Agents tab.
   * @param {Flow} f @param {"pane" | "dock"} where
   */
  const headOf = (f, where) => {
    const fig = flowFig(f);
    const stops = f.state === "running" || f.state === "holds" || f.state === "cut";
    return mk("div", { class: "fl-head" },
      mk("span", { class: `fl-tile${fig.tone === "warn" ? " is-warn" : fig.tone === "gray" ? " is-gray" : ""}` }, glyph("waypoints")),
      mk("div", { class: "fl-ht" },
        mk("div", { class: "fl-name" }, "Flow", mk("span", { class: `fl-fig${fig.tone === "warn" ? " is-warn" : ""}` }, ...figParts(fig))),
        mk("div", { class: "fl-goal", title: f.goal }, `“${f.title}”`)),
      ...kids([
        where === "dock" && f.state !== "draft" ? link("Open its steps", "The flow on the Agents tab: each box, what it was handed and its answer", () => io.openFlow(f.id)) : null,
        stops ? button("Stop", f.drives ? "Stop the flow: every box at work stops; what is done stays, and your agent hears it" : "Stop the flow: every box at work stops, as a team or an agent stops; what is done stays", () => void io.press((r) => r.stop(f.id)), { icon: "square" }) : null,
      ]));
  };

  /**
   * The head's figure, the step's digit in a span of its own that rolls as the step moves (the Designer's of 10-28).
   * @param {{ words: string, at: number }} fig
   */
  const figParts = (fig) => {
    const said = `step ${fig.at} of`;
    const i = fig.at ? fig.words.indexOf(said) : -1;
    if (i < 0) return [fig.words];
    return [fig.words.slice(0, i + 5), mk("span", { class: "fl-fig-n" }, String(fig.at)), fig.words.slice(i + 5 + String(fig.at).length)];
  };

  /**
   * A box at work's live line (the Designer's of 10-28): "at work · round 4 · 1m 12s" — a team's "its lead · 2 at work
   * · 3m 10s" — and under it the tool its agent runs, else its newest words, else Thinking…; kept across the card's
   * draws and said again in place as its agent moves and each second (`live`).
   * @param {FlowBox} b @param {CardState} s @param {"pane" | "dock"} where
   */
  const liveOf = (b, s, where) => {
    const k = `${where}:${b.id}`;
    let n = s.live.get(k);
    if (!n) {
      const line = mk("span", { class: "fl-box-line fl-live" });
      const tool = mk("span", { class: "ag-tool fl-tool hidden" });
      n = { el: mk("span", { class: "fl-live-w" }, line, tool), line, tool, b, said: "", did: "" };
      s.live.set(k, n);
    }
    n.b = b;
    paintLive(n);
    return n.el;
  };
  /** @param {LiveNode} n */
  const paintLive = (n) => {
    const b = n.b;
    const x = io.live?.(b) || null;
    const took = b.startedAt ? formatWorkedFor(now() - b.startedAt) : "";
    const sent = b.sentBack ? `sent back${b.sentBack > 1 ? ` ${b.sentBack} times` : ""}` : "";
    const words = b.kind === "team"
      ? [sent, x?.team ? `its lead · ${x.team}` : "its lead and its workers at work", took]
      : [sent, "at work", x?.round ? `round ${x.round}` : "", took];
    const said = words.filter(Boolean).join(" · ");
    if (n.said !== said) n.line.replaceChildren((n.said = said));
    const doing = b.kind === "team" || !x ? "" : x.tool ? x.tool : String(x.words || "").trim().split("\n").filter(Boolean).at(-1) || "Thinking…";
    const did = doing ? JSON.stringify(doing) : "";
    if (n.did === did && n.did) return;
    n.did = did;
    n.tool.classList.toggle("hidden", !doing);
    if (!doing) return void n.tool.replaceChildren();
    if (typeof doing === "string") {
      n.tool.replaceChildren(doing);
      n.tool.setAttribute("title", doing);
    } else {
      n.tool.replaceChildren(mk("b", {}, doing.name), doing.args ? ` ${doing.args}` : "");
      n.tool.setAttribute("title", `${doing.name} ${doing.args || ""}`.trim());
    }
  };

  /**
   * In place (OA4): how it stands with your agent, under the head, and what your agent did to it, each with its why.
   * Nothing for a flow started beside the chat.
   * @param {Flow} f
   */
  const placeOf = (f) => {
    const words = placeWords(f);
    const acts = f.inPlace ? agentActs(f) : [];
    if (!words && !acts.length) return [];
    return [mk("div", { class: "fl-place" },
      words ? mk("div", { class: "fl-place-l" }, glyph("bot", "fl-note-ic"), words) : null,
      ...acts.map((a) => mk("div", { class: "fl-act" }, mk("b", {}, `Your agent ${a.what}`), a.why ? mk("span", { class: "fl-act-why" }, ` — ${a.why}`) : null)))];
  };

  /**
   * Where it works (OA5), under the head: its own worktree and branch, or your folder where it is not a git repository;
   * nothing before a team that writes started.
   * @param {Flow} f
   */
  const worksOf = (f) => {
    const w = worksWords(f);
    return w ? [mk("div", { class: `fl-works${w.worktree ? "" : " is-folder"}`, title: w.title }, glyph(w.worktree ? "gitFork" : "folder", "fl-note-ic"), w.words)] : [];
  };

  /**
   * The turn that drove a flow In place ended before it did (OA4 case 8): why, and the way on — beside your chat, as
   * a flow started there runs, or Stop. The boxes at work go on meanwhile; nothing new starts.
   * @param {Flow} f
   */
  const driverOf = (f) =>
    mk("div", { class: "fl-gate is-hold", role: "group", "aria-label": "Your agent stopped driving the flow" },
      mk("div", { class: "fl-gate-top" }, mk("span", { class: "pf s32 t-gray", "aria-hidden": "true" }, glyph("bot", "pf-ic")),
        mk("div", { class: "fl-gate-ht" }, mk("b", {}, "Your agent stopped driving it"), mk("div", { class: "fl-q" }, `step ${stepNow(f) + 1} · the boxes at work go on; nothing new starts`)),
        mk("span", { class: "tg-badge is-asking" }, "Asks you")),
      f.lost ? mk("p", { class: "fl-gate-why" }, f.lost[0].toUpperCase() + f.lost.slice(1)) : null,
      mk("div", { class: "fl-foot" },
        button("Go on beside", "Filament runs the rest beside your chat, as a flow started there runs: each step once the one above it is done, its holds for you", () => void io.press((r) => r.decide(f.id, { action: "on" })), { primary: true, icon: "play" }),
        button("Stop the flow", "Every box at work stops; what is done stays", () => void io.press((r) => r.decide(f.id, { action: "stop" })), { quiet: true })));

  /** After a restart (FL-D19): nothing goes on by itself; Go on is the person's one press. @param {Flow} f */
  const cutOf = (f) =>
    mk("div", { class: "fl-callout" }, glyph("refreshCw", "fl-callout-ic"),
      mk("div", { class: "fl-callout-t" }, mk("b", {}, "Stopped by a restart"),
        mk("div", {}, f.drives
          ? `Filament restarted while step ${stepNow(f) + 1} ran. Your agent's turn goes on by itself and may retry or skip what was cut; Go on resumes it all yourself.`
          : `Filament restarted while step ${stepNow(f) + 1} ran. Nothing goes on by itself. Go on resumes its team boxes where they were cut, starts its cut asks again, and runs the steps after them.`)),
      button("Go on", "Resume the boxes the restart cut, then the steps after them", () => void io.press((r) => r.goOn(f.id)), { primary: true, icon: "play" }));

  /** The line went with a decision: gone from both places. @param {CardState} s */
  const lineSent = (s) => {
    s.typed = "";
    for (const x of [s.at.pane, s.at.dock]) if (x) x.line.value = "";
  };

  /**
   * The gate that did not say go (§4.5): its verdict and why, its answer to read, a line of yours, and Send back to a
   * box it needs, Go on anyway, Stop the flow — nothing loops by itself (Q2).
   * @param {Flow} f @param {FlowBox} g @param {"pane" | "dock"} where
   */
  const gateOf = (f, g, where) => {
    const s = stateOf(f);
    const fx = fieldsAt(f, s, where);
    const w = gateWords(g);
    const at = boxOf(f, g.id)?.step ?? 0;
    const offers = backOffers(f, g.id);
    const line = () => String(fx.line.value || "").trim();
    const sent = () => lineSent(s);
    return mk("div", { class: "fl-gate", role: "group", "aria-label": `${g.name}, the flow's gate, asks you` },
      mk("div", { class: "fl-gate-top" }, faceOf(g, "s32"),
        mk("div", { class: "fl-gate-ht" }, mk("b", {}, w.head), mk("div", { class: "fl-q" }, [`the flow's gate, step ${at + 1}`, f.drives ? "your agent may decide, or you do" : "the steps after it wait", w.back].filter(Boolean).join(" · "))),
        mk("span", { class: "tg-badge is-asking" }, "Asks you")),
      mk("p", { class: "fl-gate-why" }, w.why),
      g.result?.text ? mk("details", { class: "fl-read" }, mk("summary", {}, "Read its answer"), mk("div", { class: "fl-ans" }, g.result.text)) : null,
      mk("label", { class: "fl-field" }, mk("span", { class: "fl-field-l" }, "Your line for the send-back"), fx.line),
      mk("div", { class: "fl-foot" }, ...offers.map((x, i) => button(x.label, x.title, () => void io.press((r) => r.decide(f.id, { action: "back", to: x.id, line: line() })).then((out) => { if (out) sent(); }), { primary: i === 0, icon: i === 0 ? "rotateCcw" : "" })),
        button("Go on anyway", "The next step starts, handed the gate's answer as it is", () => void io.press((r) => r.decide(f.id, { action: "on" }))),
        button("Stop the flow", "Every box at work stops; what is done stays", () => void io.press((r) => r.decide(f.id, { action: "stop" })), { quiet: true })));
  };

  /**
   * Your review, once its step comes (OA-D10): what you look at, each result it needs to read, a line of yours, and Go
   * on, Send back to a box it needs, Stop the flow. Nothing goes on by itself, and nothing times it out.
   * @param {Flow} f @param {FlowBox} b @param {"pane" | "dock"} where
   */
  const reviewOf = (f, b, where) => {
    const s = stateOf(f);
    const fx = fieldsAt(f, s, where);
    const at = boxOf(f, b.id)?.step ?? 0;
    const offers = backOffers(f, b.id);
    const line = () => String(fx.line.value || "").trim();
    const sent = () => lineSent(s);
    /** @type {FlowBox[]} */
    const reads = [];
    for (const n of b.needsOf || []) {
      const x = boxOf(f, n.id)?.box;
      if (x) reads.push(x);
    }
    return mk("div", { class: "fl-gate is-review", role: "group", "aria-label": "Your review: the flow waits for you" },
      mk("div", { class: "fl-gate-top" }, faceOf(b, "s32"),
        mk("div", { class: "fl-gate-ht" }, mk("b", {}, "Your review"), mk("div", { class: "fl-q" }, [`step ${at + 1}`, f.drives ? "your agent waits for you too" : "the steps after it wait for you", b.sends ? `you sent back ${b.sends === 1 ? "once" : `${b.sends} times`}` : ""].filter(Boolean).join(" · "))),
        mk("span", { class: "tg-badge is-asking" }, "Waits for you")),
      b.words ? mk("p", { class: "fl-gate-why" }, b.words) : null,
      ...reads.map((x) => x.result?.text
        ? mk("details", { class: "fl-read" }, mk("summary", {}, `Read ${x.name}'s ${x.gate ? "verdict and answer" : x.kind === "team" ? "reply" : "answer"}`), mk("div", { class: "fl-ans" }, x.result.text))
        : mk("p", { class: "fl-q" }, `${x.name}: ${x.state === "skipped" ? "skipped, it handed on nothing" : "no answer"}`)),
      mk("label", { class: "fl-field" }, mk("span", { class: "fl-field-l" }, "Your line: it goes on with the flow, or with what you send back"), fx.line),
      mk("div", { class: "fl-foot" },
        button("Go on", "The next step starts, handed your line", () => void io.press((r) => r.decide(f.id, { action: "on", box: b.id, line: line() })).then((out) => { if (out) sent(); }), { primary: true, icon: "play" }),
        ...offers.map((x) => button(x.label, x.title, () => void io.press((r) => r.decide(f.id, { action: "back", box: b.id, to: x.id, line: line() })).then((out) => { if (out) sent(); }), { icon: "rotateCcw" })),
        button("Stop the flow", "Every box at work stops; what is done stays", () => void io.press((r) => r.decide(f.id, { action: "stop", box: b.id })), { quiet: true })));
  };

  /**
   * Retry without my edits (OA5), where a box failed because the flow's Bring my uncommitted edits could not copy them
   * into its new worktree: the switch goes off for the flow, and the box starts again from the last commit alone.
   * @param {Flow} f @param {FlowBox} b
   */
  const retryWithout = (f, b) =>
    button(BRING_FAILED_WORDS.label, BRING_FAILED_WORDS.title, () => void io.press(async (r) => {
      await r.edit(f.id, { bring: false });
      return r.act(f.id, b.id, "retry");
    }), { icon: "rotateCcw" });

  /** A box that failed, stopped or was cut holds the flow: Retry, Skip, Stop — and Retry without my edits where its Bring failed. @param {Flow} f @param {FlowBox} b */
  const holdOf = (f, b) => {
    const at = boxOf(f, b.id)?.step ?? 0;
    const bring = bringFailed(f, b);
    return mk("div", { class: "fl-gate is-hold", role: "group", "aria-label": `${b.name} ${b.state === "failed" ? "failed" : "stopped"}` },
      mk("div", { class: "fl-gate-top" }, faceOf(b, "s32"),
        mk("div", { class: "fl-gate-ht" }, mk("b", {}, `${b.name} ${b.state === "failed" ? "failed" : "stopped"}`), mk("div", { class: "fl-q" }, `step ${at + 1} · the steps after it wait`)),
        mk("span", { class: `tg-badge ${boxBadge(b).cls}` }, boxBadge(b).words)),
      b.error ? mk("p", { class: "fl-gate-why" }, b.error[0].toUpperCase() + b.error.slice(1)) : null,
      bring ? mk("p", { class: "fl-note" }, glyph("gitFork", "fl-note-ic"), BRING_FAILED_WORDS.note) : null,
      mk("div", { class: "fl-foot" },
        button("Retry", bring ? "Its worktree is made again, and the copy of your uncommitted edits tried again" : b.kind === "team" ? "Its chat goes on from where it stopped" : "It starts again, handed the same", () => act(f, b.id, "retry"), { primary: true, icon: "rotateCcw" }),
        bring ? retryWithout(f, b) : null,
        button("Skip", "It hands on nothing; the boxes after it are told it was skipped", () => act(f, b.id, "skip")),
        button("Stop the flow", "Every box at work stops; what is done stays", () => void io.press((r) => r.stop(f.id)), { quiet: true })));
  };

  /** A team box whose lead asks you, or whose reply ends on a question (FL-D18): nothing is handed on until it ends. @param {Flow} f @param {FlowBox} b */
  const asksOf = (f, b) =>
    mk("div", { class: "fl-gate is-asks", role: "group", "aria-label": `${b.name} asks you` },
      mk("div", { class: "fl-gate-top" }, faceOf(b, "s32"),
        mk("div", { class: "fl-gate-ht" }, mk("b", {}, `${b.name} asks you`), mk("div", { class: "fl-q" }, `step ${(boxOf(f, b.id)?.step ?? 0) + 1} · it hands on nothing until it ends`)),
        mk("span", { class: "tg-badge is-asking" }, "Asks you")),
      b.error ? mk("p", { class: "fl-gate-why" }, b.error[0].toUpperCase() + b.error.slice(1)) : null,
      b.result?.text ? mk("div", { class: "fl-ans is-short" }, b.result.text) : null,
      mk("div", { class: "fl-foot" },
        b.run?.team ? button("Open its chat to answer", "Answer in its chat: its next reply is handed on", () => io.openTeam(String(b.run?.team)), { primary: true }) : null,
        b.kind === "team" && b.result ? button("Hand on anyway", "Its reply goes on as its result, question and all", () => act(f, b.id, "hand-on")) : null));

  /** What the flow waits for now, as a card of its own: a restart's, a gate's, a held box's, your review, a box that asks. @param {Flow} f @param {"pane" | "dock"} where */
  const waitsOf = (f, where) => {
    if (f.state === "cut") return [cutOf(f)];
    if (f.state === "holds" && f.hold?.kind === "driver") return [driverOf(f)];
    if (f.state === "holds" && f.hold) {
      const b = boxOf(f, f.hold.box)?.box;
      if (b) return [f.hold.kind === "gate" ? gateOf(f, b, where) : holdOf(f, b)];
    }
    if (f.state === "running") return boxesOf(f).filter((x) => x.box.state === "asking").map((x) => (x.box.kind === "review" ? reviewOf(f, x.box, where) : asksOf(f, x.box)));
    return [];
  };

  /**
   * What a box needs, under its line: "needs PM and Designer"; one that is not in an earlier step said in orange, as
   * the server refuses Start for it (OA3 case 5). Nothing in the first step that needs nothing.
   * @param {FlowBox} b @param {number} step
   */
  const needsEl = (b, step) => {
    const broken = b.broken || [];
    if (step === 0 && !(b.needsOf || []).length) return [];
    return kids([
      mk("span", { class: "fl-box-needs", title: "It is handed your words and the results of these boxes, nothing else" }, needsWords(b)),
      broken.length ? mk("span", { class: "fl-box-needs is-broken", title: "A box reads only the results of the steps before its own: move one of them, or change what it needs" }, glyph("shieldAlert", "fl-tag-ic"), `${broken.join(" and ")} ${broken.length === 1 ? "is" : "are"} not before it`) : null,
    ]);
  };

  /**
   * A draft's box can move a step up or down, into the step there or a step of its own, and be removed; its needs stay
   * as they were, so one that no longer holds shows on it (L38). @param {Flow} f @param {FlowBox} b @param {number} step
   */
  const boxActs = (f, b, step) => {
    const index = f.steps[step].boxes.indexOf(b);
    const last = f.steps.length - 1;
    const up = moveBox(f, step, index, -1);
    const down = moveBox(f, step, index, 1);
    /** @param {string} icon @param {string} title @param {any} next */
    const act = (icon, title, next) =>
      mk("button", { class: "fl-box-act", type: "button", title, "aria-label": title, onclick: () => { if (next) void io.press((r) => r.edit(f.id, { steps: next })); }, ...(next ? {} : { disabled: "", "aria-disabled": "true" }) }, glyph(icon));
    return mk("span", { class: "fl-box-acts" },
      act("arrowUp", up ? `Move ${b.name} up: ${step === 0 ? "a step of its own before the first" : `into step ${step}`}` : `${b.name} is alone in the first step`, up),
      act("arrowDown", down ? `Move ${b.name} down: ${step === last ? "a step of its own after the last" : `into step ${step + 2}`}` : `${b.name} is alone in the last step`, down),
      act("trash2", `Remove ${b.name}: a box that needed it needs what it needed`, withoutBox(/** @type {any} */ (stepsBody(f)), step, index)));
  };

  /**
   * A box in its step: its face, its name and tags — its part, writes, reads only, gate — its state, its line and what
   * it needs. In a draft it opens its sheet and moves up or down; in a step still to come while edit mode is on it
   * opens its sheet; else it is picked, and the pane shows it.
   * @param {Flow} f @param {FlowBox} b @param {number} step @param {CardState} s @param {"pane" | "dock"} where
   */
  const boxEl = (f, b, step, s, where) => {
    const t = now();
    const draft = f.state === "draft";
    const edits = draft || (s.editing && step > stepNow(f) && !ended(f));
    const badge = boxBadge(b);
    const asks = b.state === "asking" || (f.hold?.box === b.id && f.state === "holds");
    const working = !draft && b.state === "working";
    const tags = kids([
      mk("span", { class: "fl-tag", title: KIND_TIPS[b.kind] }, KIND_WORDS[b.kind]),
      b.writes ? mk("span", { class: "fl-tag is-write", title: writeTip(b) }, glyph("pencil", "fl-tag-ic"), "writes") : null,
      (b.kind === "team" && !b.writes) || (b.kind === "agent" && b.readOnly) ? mk("span", { class: "fl-tag", title: "Changes no file" }, glyph("eye", "fl-tag-ic"), "reads only") : null,
      b.gate ? mk("span", { class: "fl-tag is-gate", title: "The next step waits for its verdict" }, glyph("shieldAlert", "fl-tag-ic"), "gate") : null,
    ]);
    const press = () => {
      if (edits) return io.editBox?.(f, step, f.steps[step].boxes.indexOf(b));
      if (where === "dock") return io.openFlow(f.id);
      s.sel = s.sel === b.id ? null : b.id;
      s.picked = true;
      stale(f.id);
      onStale?.();
    };
    const inner = [
      mk("span", { class: "fl-box-top" }, faceOf(b, "s28"),
        mk("span", { class: "fl-box-who" }, mk("b", {}, b.name), mk("span", { class: "fl-tags" }, ...tags)),
        // Done is a quiet tick (the redesign of 10-23): a word only where it says more — a gate's verdict, a state that
        // calls for you or holds the flow.
        draft ? null : b.state === "done" && !b.gate ? doneMark(mk) : mk("span", { class: `tg-badge ${badge.cls}` }, badge.words)),
      working ? liveOf(b, s, where) : mk("span", { class: "fl-box-line" }, boxLine(b, step, f, t)),
      ...needsEl(b, step),
      // At work, a bar slides along its foot as if it had never been drawn again: its place set from the clock.
      ...kids([working ? mk("span", { class: "tg-node-bar ag-bar", "aria-hidden": "true" }, mk("span", { class: "tg-node-bar-fill", style: `animation-delay:-${t % 1600}ms` })) : null]),
    ];
    const cls = `fl-box st-${b.state}${asks ? " is-asks" : ""}${s.sel === b.id && where === "pane" ? " is-sel" : ""}${edits ? " is-edit" : ""}${(b.broken || []).length ? " is-broken" : ""}`;
    if (draft)
      return mk("div", { class: `${cls} is-draft`, "data-box": b.id },
        mk("button", { class: "fl-box-open", type: "button", title: `Change ${b.name}'s part`, onclick: press }, ...inner),
        boxActs(f, b, step));
    return mk("button", {
      class: cls,
      type: "button",
      "data-box": b.id,
      title: edits ? `Change ${b.name}'s part` : where === "dock" ? "Open the flow on the Agents tab" : `${b.name}: what it was handed and its answer`,
      onclick: press,
    }, ...inner);
  };

  /** The steps, top to bottom: each its number on the rail (a gate's its shield), its why, and its boxes side by side. @param {Flow} f @param {CardState} s @param {"pane" | "dock"} where */
  const stepsOf = (f, s, where) => {
    const draft = f.state === "draft";
    const at = stepNow(f);
    const adds = draft ? s.editing : s.editing && !ended(f);
    return mk("div", { class: "fl-steps" },
      ...f.steps.map((st, i) => {
        const done = st.boxes.length > 0 && st.boxes.every((b) => b.state === "done" || b.state === "skipped") && !draft;
        const gate = st.boxes.some((b) => b.gate);
        const open = adds && (draft || i > at);
        return mk("div", { class: `fl-step${done ? " is-done" : ""}${!draft && i === at && !ended(f) ? " is-now" : ""}`, "data-step": String(i) },
          mk("div", { class: "fl-rail" }, mk("span", { class: `fl-num${gate ? " is-gate" : ""}`, title: gate ? "A gate: the steps after it wait for its verdict" : `Step ${i + 1}` }, gate ? glyph("shieldAlert") : String(i + 1))),
          mk("div", { class: "fl-boxes" }, ...kids([st.why ? mk("div", { class: "fl-why", title: "Why this step is where it is" }, st.why) : null]), ...st.boxes.map((b) => boxEl(f, b, i, s, where)),
            ...kids([open && io.editBox ? mk("button", { class: "fl-add", type: "button", title: "Another box in this step: it runs beside the others", onclick: () => io.editBox?.(f, i, null) }, glyph("plus"), "Add a box") : null])));
      }),
      ...kids([adds && io.editBox ? mk("button", { class: "fl-add is-step", type: "button", title: "A step after the last: it starts once every box above it is done", onclick: () => io.editBox?.(f, f.steps.length, null) }, glyph("plus"), "Add a step") : null]));
  };

  /**
   * A box picked on the Agents tab: what it is, what it was handed, its answer — whole on a press — the artifacts it
   * published, a gate's earlier answers, and what can be done with it now.
   * @param {Flow} f @param {FlowBox} b @param {CardState} s
   */
  const detailOf = (f, b, s) => {
    const t = now();
    const at = boxOf(f, b.id)?.step ?? 0;
    const badge = boxBadge(b);
    /** @type {{ box: FlowBox, step: number }[]} */
    const before = [];
    for (const n of b.needsOf || []) {
      const x = boxOf(f, n.id);
      if (x) before.push(x);
    }
    const whole = s.whole.get(b.id);
    const text = whole ?? String(b.result?.text || "");
    const live = isLive(b);
    const open = !ended(f) && f.state !== "draft";
    const nextStarted = f.steps.slice(at + 1).some((st) => st.boxes.some((x) => x.state !== "waits"));
    const answerWord = b.gate ? "Its verdict and answer" : b.kind === "team" ? "The reply it ended on" : b.kind === "review" ? "What you said" : "Its answer";
    const readWhole = async () => {
      if (s.reading.has(b.id)) return;
      s.reading.add(b.id);
      const out = await io.press((r) => r.result(f.id, b.id));
      s.reading.delete(b.id);
      if (out?.result) s.whole.set(b.id, String(out.result.text || ""));
      stale(f.id);
      onStale?.();
    };
    return mk("div", { class: `fl-detail${b.state === "asking" ? " is-asks" : ""}`, "data-detail": b.id },
      mk("div", { class: "fl-d-top" }, faceOf(b, "s32"),
        mk("div", { class: "fl-d-who" }, mk("b", {}, b.name),
          mk("div", { class: "fl-q" }, [b.gate ? "the flow's gate" : b.kind === "review" ? "your review" : b.kind === "agent" ? (b.readOnly ? "an agent, reading only" : "an agent at its card's level") : b.writes ? "a team that writes" : "a team that reads only", `step ${at + 1}`, b.state === "done" && b.endedAt ? ["done", tookOf(b, t) ? `in ${tookOf(b, t)}` : ""].join(" ").trim() : "", money(b.usd)].filter(Boolean).join(" · "))),
        mk("span", { class: `tg-badge ${badge.cls}` }, badge.words)),
      b.error && b.state !== "done" ? mk("p", { class: "fl-note is-warn" }, glyph("info", "fl-note-ic"), b.error[0].toUpperCase() + b.error.slice(1)) : null,
      bringFailed(f, b) ? mk("p", { class: "fl-note" }, glyph("gitFork", "fl-note-ic"), BRING_FAILED_WORDS.note) : null,
      b.state === "seat" ? mk("p", { class: "fl-note" }, glyph("info", "fl-note-ic"), `It waits for ${b.waiting || "a free seat"}: it starts once one frees, and never fails for want of one.`) : null,
      placeNote(b) ? mk("p", { class: "fl-note" }, glyph(b.place?.kind === "worktree" ? "gitFork" : "folder", "fl-note-ic"), placeNote(b)) : null,
      ...kids([b.words ? mk("div", { class: "fl-d-sect" }, b.kind === "review" ? "What you look at" : "Asked") : null, b.words ? mk("p", { class: "fl-d-words" }, b.words) : null]),
      mk("div", { class: "fl-d-sect" }, b.kind === "review" ? "It shows you" : "Handed"),
      mk("div", { class: "fl-handed" }, mk("span", { class: "fl-hchip", title: f.goal }, glyph("user"), "your words"),
        ...before.map((x) => mk("span", { class: `fl-hchip${x.box.state === "skipped" ? " is-skipped" : ""}`, title: x.box.state === "skipped" ? "Skipped: it handed on nothing" : `Its ${x.box.gate ? "verdict and answer" : "result"}, whole up to 60,000 characters` }, faceOf(x.box, "s16"), x.box.state === "skipped" ? `${x.box.name}: skipped` : `${x.box.name}'s ${x.box.gate ? "verdict" : x.box.kind === "team" ? "reply" : "answer"}`))),
      text ? mk("div", { class: "fl-d-sect" }, answerWord) : null,
      text ? mk("div", { class: "fl-ans" }, text) : null,
      b.result?.more && whole == null ? mk("button", { class: "br-link", type: "button", onclick: () => void readWhole() }, s.reading.has(b.id) ? "Reading…" : `Read it whole: ${Number(b.result.chars || 0).toLocaleString("en-US")} characters`, glyph("chevronDown", "br-link-ic")) : null,
      b.result?.made?.length ? mk("div", { class: "fl-d-sect" }, "It published") : null,
      ...(b.result?.made || []).map((m) => mk("div", { class: "fl-made" }, glyph("image", "fl-note-ic"), mk("span", {}, m.title || "An artifact"), mk("code", {}, m.address))),
      b.past.length ? mk("details", { class: "fl-read" }, mk("summary", {}, `Its earlier answers: ${b.past.length}`),
        ...b.past.map((p) => mk("div", { class: "fl-past" }, mk("b", {}, p.verdict?.go ? "Verdict: go" : p.verdict ? `Verdict: not yet${p.verdict.why ? ` — ${p.verdict.why}` : ""}` : "No verdict"), mk("div", { class: "fl-ans is-short" }, p.text)))) : null,
      mk("div", { class: "fl-foot" }, ...kids([
        b.run?.sub ? button("Open its thread", "Its whole exchange, on the Agents tab", () => io.openThread(String(b.run?.sub))) : null,
        b.run?.team ? button(b.state === "asking" ? "Open its chat to answer" : "Open its chat", "Its team chat: its lead, its workers, its questions", () => io.openTeam(String(b.run?.team)), { primary: b.state === "asking" }) : null,
        open && b.kind === "team" && b.state === "asking" && b.result ? button("Hand on anyway", "Its reply goes on as its result, question and all", () => act(f, b.id, "hand-on")) : null,
        open && b.kind === "team" && b.state === "done" && !nextStarted && f.state !== "holds" ? button("Hand on its newest reply", "What its lead said last in its chat becomes its result, before the next step starts", () => act(f, b.id, "take")) : null,
        open && (b.state === "failed" || b.state === "stopped" || b.state === "cut") ? button("Retry", bringFailed(f, b) ? "Its worktree is made again, and the copy of your uncommitted edits tried again" : b.kind === "team" ? "Its chat goes on from where it stopped" : "It starts again, handed the same", () => act(f, b.id, "retry"), { primary: true, icon: "rotateCcw" }) : null,
        open && bringFailed(f, b) ? retryWithout(f, b) : null,
        open && live ? button("Stop", "Stop this box: the flow holds at it, with Retry, Skip and Stop", () => act(f, b.id, "stop")) : null,
        open && b.state !== "done" && b.state !== "skipped" ? button("Skip", "It hands on nothing; the boxes after it are told it was skipped", () => act(f, b.id, "skip"), { quiet: true }) : null,
      ])));
  };

  /** The Bring my uncommitted edits switch, with its label (OA5). @param {Flow} f */
  const bringSwitch = (f) =>
    mk("span", { class: "fl-bring-sw" },
      toggle(mk, !!f.bring, BRING_WORDS.label, () => void io.press((r) => r.edit(f.id, { bring: !f.bring }))),
      mk("span", { class: "fl-sw-l", title: BRING_WORDS.title }, BRING_WORDS.label));

  /**
   * The words under a draft's steps: its size and seats, what it says of itself, and why it cannot start; where its
   * worktree would leave your uncommitted files here, that, with Bring my uncommitted edits (OA5) — or that your folder
   * is being checked for them, or that it could not be, with Count again.
   * @param {Flow} f
   */
  const draftWords = (f) => {
    const c = io.uncommitted?.() ?? null;
    const bring = bringNote(f, c?.files ?? null);
    const counting = countNote(f, c);
    return kids([
      mk("div", { class: "fl-sum" }, sumLine(f, io.seats?.() ?? null)),
      f.problem ? mk("p", { class: "fl-note is-warn" }, glyph("shieldAlert", "fl-note-ic"), `It cannot start yet: ${f.problem}.`) : mk("p", { class: "fl-note" }, glyph("info", "fl-note-ic"), DRAFT_NOTE),
      bring ? mk("div", { class: "fl-bring" }, mk("p", { class: "fl-note" }, glyph("gitFork", "fl-note-ic"), bring), bringSwitch(f)) : null,
      counting?.held ? mk("p", { class: "fl-note" }, glyph("hourglass", "fl-note-ic"), counting.words) : null,
      counting && !counting.held ? mk("div", { class: "fl-bring" },
        mk("p", { class: "fl-note is-warn" }, glyph("info", "fl-note-ic"), counting.words, link("Count again", "Your folder's uncommitted files counted once more", () => io.recount?.())),
        bringSwitch(f)) : null,
    ]);
  };

  /** Why a draft's Start is held, in words, else null: it cannot start, or its folder is still being checked (OA5). @param {Flow} f */
  const startHeld = (f) => (f.problem ? `It cannot start yet: ${f.problem}` : countNote(f, io.uncommitted?.() ?? null)?.held ? COUNT_HELD_WORDS : null);

  /** A draft's foot: Tell my agent when done, Discard, Save as a flow…, Edit…, Start. @param {Flow} f @param {CardState} s */
  const draftFoot = (f, s) => {
    const held = startHeld(f);
    return mk("div", { class: "fl-foot" },
      toggle(mk, f.tell, TELL_WORDS.label, () => void io.press((r) => r.edit(f.id, { tell: !f.tell }))),
      mk("span", { class: "fl-sw-l", title: TELL_WORDS.title }, TELL_WORDS.label),
      mk("span", { class: "th-sp" }),
      button("Discard", "The draft goes; your words go back in the message box where it is empty", () => void io.press((r) => r.remove(f.id)).then((out) => { if (out) io.putBack?.(f.goal); })),
      ...kids([io.save ? button("Save as a flow…", "Keep its steps to start again on other words, from Agents › Flows", () => io.save?.(f)) : null]),
      button(s.editing ? "Done" : "Edit…", s.editing ? "Leave edit mode" : "Its name, your words, its steps: add a box or a step; a box opens its sheet", () => { s.editing = !s.editing; stale(f.id); onStale?.(); }),
      mk("span", { class: "fl-split" },
        button("Start", held || "Runs it beside your chat: each step starts once the one above it is done, and your agent is told the flow", () => void io.press((r) => r.start(f.id)), { primary: true, icon: "play", disabled: !!held }),
        mk("button", {
          class: "inst-btn is-primary fl-split-more", type: "button", title: held || "Start it another way: beside your chat, or in place", "aria-label": "Start it another way", "aria-haspopup": "menu",
          onclick: (/** @type {any} */ e) => { if (!startHeld(f)) startWays(f, e?.currentTarget); },
          ...(held ? { disabled: "", "aria-disabled": "true" } : {}),
        }, glyph("chevronDown"))));
  };

  /** Start ▾ (OA4, L19): beside your chat, as Start does, or In place — a turn of your agent drives it. @param {Flow} f @param {any} anchor */
  const startWays = (f, anchor) =>
    menu([
      { label: START_WAYS.beside.label, icon: "play", desc: START_WAYS.beside.desc, onClick: () => void io.press((r) => r.start(f.id)) },
      { label: START_WAYS.inPlace.label, icon: "bot", desc: START_WAYS.inPlace.desc, onClick: () => void io.press((r) => r.start(f.id, { inPlace: true })) },
    ], { anchor, align: "end", side: "top", width: 300 });

  /** An ended flow's foot: where its end went, Send again, Save as a flow…, Remove. @param {Flow} f */
  const endFoot = (f) => {
    const e = endWords(f);
    return kids([
      e ? mk("p", { class: `fl-end is-${e.tone}` }, glyph(e.tone === "ok" ? "check" : e.tone === "wait" ? "hourglass" : "shieldAlert", "fl-note-ic"), e.words) : null,
      mk("div", { class: "fl-foot" }, ...kids([
        e?.send ? button("Send its end", "One message to your agent: a line for each box and the last step's results whole", () => void io.press((r) => r.send(f.id)), { primary: true }) : null,
        io.save ? button("Save as a flow…", "Keep its steps to start again on other words", () => io.save?.(f)) : null,
        mk("span", { class: "th-sp" }),
        button("Remove", "Take it off this chat's list; its boxes' threads and team chats stay", () => void io.press((r) => r.remove(f.id)), { quiet: true }),
      ])),
    ]);
  };

  /** The fields edit mode shows over a draft's steps: its name and the words that head every box's ask. @param {Flow} f @param {CardState} s @param {"pane" | "dock"} where */
  const fieldsOf = (f, s, where) => {
    const fx = fieldsAt(f, s, where);
    if (document_active() !== fx.title) fx.title.value = f.title;
    if (document_active() !== fx.goal) fx.goal.value = f.goal;
    return mk("div", { class: "fl-fields" },
      mk("label", { class: "fl-field" }, mk("span", { class: "fl-field-l" }, "Its name"), fx.title),
      mk("label", { class: "fl-field" }, mk("span", { class: "fl-field-l" }, "Your words: they head every box's ask"), fx.goal));
  };

  /**
   * A flow's card. `pane`: the Agents tab's, whole, a box picked shown under its steps; `dock`: over the message box —
   * a draft whole, else what it waits for.
   * @param {Flow} f @param {"pane" | "dock"} where
   */
  function card(f, where) {
    const s = stateOf(f);
    // A draft with no step yet opens in edit mode: its Add a step is the way to its first box.
    if (f.state === "draft" && !f.steps.length) s.editing = true;
    // A box that needs you is shown until you pick another.
    if (where === "pane" && !s.picked) {
      const want = f.hold?.box || boxesOf(f).find((x) => x.box.state === "asking")?.box.id || null;
      s.sel = want;
    }
    const sel = where === "pane" && s.sel ? boxOf(f, s.sel)?.box || null : null;
    // No clock in the key: a box at work says its time in place (`live`), so a card is drawn again only as it moves.
    const key = JSON.stringify([f, where, s.sel, s.editing, [...s.whole.keys()], [...s.reading], io.seats?.() ?? null, io.uncommitted?.() ?? null]);
    const had = built.get(`${f.id}:${where}`);
    syncLines(s);
    if (had?.key === key) return had.el;
    const draft = f.state === "draft";
    const showSteps = where === "pane" || draft;
    const el = mk("section", { class: `fl-card is-${f.state}${where === "dock" ? " in-dock" : ""}${needsYou(f) && !draft ? " needs-you" : ""}`, "data-flow": f.id, "aria-label": `Flow: ${f.title}` },
      headOf(f, where),
      ...placeOf(f),
      ...worksOf(f),
      ...waitsOf(f, where),
      ...(draft && s.editing ? [fieldsOf(f, s, where)] : []),
      ...(showSteps ? [stepsOf(f, s, where)] : []),
      ...(sel && !draft ? [detailOf(f, sel, s)] : []),
      ...(draft ? [...draftWords(f), draftFoot(f, s)] : []),
      ...(ended(f) ? endFoot(f) : []),
      ...(!draft && !ended(f) && where === "pane" ? [mk("div", { class: "fl-foot is-quiet" }, mk("span", { class: "fl-q" }, f.state !== "running" ? "" : f.drives ? "Your agent drives it in its turn; you may act on it too, and it hears what you do." : "Your chat stays yours: your agent was told the flow at its start, and hears its end."), mk("span", { class: "th-sp" }),
        button(s.editing ? "Done" : "Edit the steps to come…", s.editing ? "Leave edit mode" : "Change a box of a step that has not started, or add one", () => { s.editing = !s.editing; stale(f.id); onStale?.(); }, { quiet: true }))] : []));
    built.set(`${f.id}:${where}`, { el, key });
    // The live lines of boxes no longer at work go.
    for (const [k, n] of s.live) if (k.startsWith(`${where}:`) && (boxOf(f, n.b.id)?.box.state !== "working" || draft)) s.live.delete(k);
    // What the list saw change a moment ago plays once on the card drawn after it, where it stands on the page.
    const moments = io.changes?.(f.id) || [];
    if (moments.length && typeof requestAnimationFrame === "function") requestAnimationFrame(() => playFlowMoves(el, moments, now()));
    return el;
  }

  return {
    card,
    /** The cards of flows no longer listed go. @param {readonly Flow[]} flows */
    keep(flows) {
      const ids = new Set(flows.map((f) => f.id));
      for (const k of [...built.keys()]) if (!ids.has(k.split(":")[0])) built.delete(k);
      for (const k of [...states.keys()]) if (!ids.has(k)) states.delete(k);
    },
    /** Something a card shows moved on the page alone: the host paints again. @param {() => void} fn */
    onStale(fn) { onStale = fn; },
    /**
     * The live lines of the boxes at work said again in place — their agents moved, or a second passed — with no card
     * drawn again (the Designer's of 10-28).
     */
    live() {
      for (const s of states.values())
        for (const [k, n] of s.live) {
          if (n.el.isConnected === false) s.live.delete(k);
          else paintLive(n);
        }
    },
    /** A box shown on a flow's card in the pane, as a crew line of its row asks. @param {string} fid @param {string} bid */
    pick(fid, bid) {
      const f = io.rows().find((x) => x.id === fid);
      if (!f) return;
      const s = stateOf(f);
      s.sel = bid;
      s.picked = true;
      stale(fid);
    },
  };
}

/** The element that has the keyboard, where there is a page. */
const document_active = () => (typeof document === "undefined" ? null : document.activeElement);

/**
 * A moment's classes on a part, taken off once it played: put back on the page later, it must not play again. Motion
 * Off plays none — the dock's ring is no animation, so the page's Off alone never stilled it; one put back while it
 * still plays starts again, a layout between (the Hunter's of 10-28). @param {any} el @param {string[]} cls @param {number} ms
 */
const flash = (el, cls, ms) => {
  if (typeof document !== "undefined" && motion() === "off") return;
  for (const c of cls) el.classList.remove(c);
  void el.offsetWidth;
  for (const c of cls) el.classList.add(c);
  setTimeout(() => { for (const c of cls) el.classList.remove(c); }, ms + 80);
};

/**
 * The Agents tab's pane for a flow's row (U13-D5's teams part): that flow whole; for the Flows row, a new flow by hand
 * or from a saved one (F6), and the saved flows. The Flows row's home is drawn again at each key typed into its field,
 * each press on a start and each read of the saved flows, in place (dom.js `morphChildren`), its rows, Forget and New
 * flow keyed by what they are, so the one under a resting pointer is the element that stood: its hover holds and a
 * press on it lands (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
 * @param {FlowIO} io @param {ReturnType<typeof createFlowCards>} cards
 * @param {{ h?: Mk, place?: (parent: any, wanted: any[]) => void, drawIn?: (host: any, nodes: any[]) => void }} [o]  the
 *   tests' fake DOM; `place`: how a flow's card goes into the pane; `drawIn`: how the home's draw goes into it — in
 *   place (dom.js `morphChildren`, the page's), or a fake DOM's own
 */
export function createFlowPane(io, cards, o = {}) {
  const mk = o.h || h;
  const place = o.place || placeChildren;
  const drawIn = o.drawIn || morphChildren;
  /** @param {string} name @param {string} [cls] */
  const glyph = (name, cls = "inst-ic") => mk("span", { class: cls, "aria-hidden": "true", html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });
  const el = mk("section", { class: "tv-section fl-pane", "aria-label": "A flow beside this chat" });
  const goal = mk("textarea", { class: "fl-input fl-goal-input", rows: "3", maxlength: "8000", placeholder: "What the flow is for: these words head every box's ask", "aria-label": "What the flow is for", oninput: () => paintHome() });
  // The field and its label, built once: a draw keeps them as they stand, the words typed and the keyboard in them.
  const goalField = mk("label", { class: "fl-field", "data-key": "goal" }, mk("span", { class: "fl-field-l" }, "What is it for"), goal);
  /** The start the new flow is drawn from: "" for none, else a saved flow's key. */
  let from = "";
  let making = false;
  /** @type {any} */
  let chat = null;
  let shown = "";

  /** The name a saved box shows, from the person's agents and teams; your review's own. @param {{ kind: string, agent: string }} b */
  const nameOf = (b) => (b.kind === "review" ? "Your review" : (b.kind === "team" ? io.teams().find((t) => t.key === b.agent)?.name : io.cards().find((c) => c.tag === b.agent)?.name) || b.agent);

  const make = async () => {
    const words = String(goal.value || "").trim();
    if (!words || making) return;
    making = true;
    paintHome();
    const out = await io.press((r) => r.create(from ? { saved: from, goal: words } : { flow: { goal: words, title: words.split("\n")[0].slice(0, 80), steps: [] } }));
    making = false;
    if (out?.flow) {
      goal.value = "";
      io.created?.(out.flow);
    } else paintHome();
  };

  function paintHome() {
    const kept = io.saved?.() ?? null;
    if (kept == null) io.loadSaved?.();
    // While Settings › Experimental's Teams switch is off (`teamsOn`) a saved flow with a team box is no start: its
    // Start would be refused.
    const teams = io.teamsOn?.() !== false;
    const saved = kept && (teams ? kept : kept.filter((s) => !s.steps.some((st) => st.boxes.some((b) => b.kind === "team"))));
    if (!teams && from && saved && !saved.some((s) => s.key === from)) from = "";
    const words = String(goal.value || "").trim();
    const row = (/** @type {string} */ key, /** @type {string} */ name, /** @type {string} */ line, /** @type {any} */ extra = null) =>
      mk("div", { class: `fl-from${from === key ? " is-on" : ""}`, role: "radio", "aria-checked": from === key ? "true" : "false", tabindex: "0", "data-key": `from:${key}`, onclick: () => { from = key; paintHome(); } },
        mk("span", { class: "fl-from-dot", "aria-hidden": "true" }),
        mk("span", { class: "fl-from-t" }, mk("b", {}, name), mk("span", { class: "fl-q" }, line)),
        ...kids([extra]));
    drawIn(el, kids([
      mk("div", { class: "fl-head", "data-key": "head" }, mk("span", { class: "fl-tile" }, glyph("waypoints")),
        mk("div", { class: "fl-ht" }, mk("h3", { class: "tv-h is-big" }, "Flows"),
          mk("p", { class: "bes-line" }, `${teams ? "Your agents and teams" : "Your agents"} in steps beside this chat. A step's boxes run side by side; each box is handed your words and the results of the boxes it needs; a gate, or your own review, holds the steps after it for your word. Nothing runs until you press Start. Or type /flow and your words in the message box: your agent designs it for you.`))),
      goalField,
      mk("div", { class: "fl-d-sect", "data-key": "from" }, "Start from"),
      mk("div", { class: "fl-froms", role: "radiogroup", "aria-label": "Start from", "data-key": "froms" },
        row("", "Nothing", "add each step and box yourself"),
        ...(saved || []).map((s) => row(s.key, s.name, savedLine(s, nameOf), s.shipped ? mk("span", { class: "fl-tag" }, "Filament's") : mk("button", { class: "br-link", type: "button", title: "Forget this saved flow", "data-key": "forget", onclick: (/** @type {any} */ e) => { e?.stopPropagation?.(); void io.press((r) => r.forget(s.key)).then(() => io.loadSaved?.()); } }, "Forget")))),
      saved == null ? mk("p", { class: "fl-note", "data-key": "note" }, "Reading your saved flows…") : null,
      mk("div", { class: "fl-foot", "data-key": "foot" }, mk("span", { class: "th-sp" }),
        mk("button", { class: "inst-btn is-primary", type: "button", "data-key": "new", title: words ? "A draft with these steps: change any box, then Start — nothing runs before" : "Say what the flow is for first", onclick: () => void make(), ...(!words || making ? { disabled: "", "aria-disabled": "true" } : {}) }, glyph("plus"), making ? "Drawing…" : "New flow")),
    ]));
  }

  return {
    el,
    /** @param {any} c @param {string} id  the row: a flow's, or the Flows row */
    paint(c, id) {
      chat = c;
      shown = id;
      if (!chat?.chainId) return place(el, []);
      if (id === FLOW_HOME) return paintHome();
      const fid = flowOfItem(id);
      const f = fid ? io.rows().find((x) => x.id === fid) || null : null;
      if (!f) return place(el, [mk("p", { class: "bes-line" }, "This flow is no longer on this chat's list.")]);
      place(el, [cards.card(f, "pane")]);
    },
    /** The row it shows. */
    shown: () => shown,
  };
}

/**
 * The flows over the message box (§4.8, §4.10): a draft whole, and each flow that waits for you by what it waits for —
 * the one place a flow speaks in the chat before its end. Hidden with none.
 * @param {FlowIO} io @param {ReturnType<typeof createFlowCards>} cards @param {{ h?: Mk, place?: (parent: any, wanted: any[]) => void }} [o]
 */
export function createFlowDock(io, cards, o = {}) {
  const mk = o.h || h;
  const place = o.place || placeChildren;
  const el = mk("div", { class: "fl-dock is-empty", role: "region", "aria-label": "Flows beside this chat" });
  /** The chat the dock showed last, and the flows it showed there: one new to it rises in (the Designer's of 10-28). */
  let shownFor = "";
  let shown = new Set();
  return {
    el,
    /** @param {any} chat  the chat on screen */
    paint(chat) {
      const flows = chat?.chainId ? io.rows().filter((f) => needsYou(f)) : [];
      el.classList.toggle("is-empty", !flows.length);
      const cardsNow = flows.map((f) => cards.card(f, "dock"));
      place(el, cardsNow);
      const same = String(chat?.chainId || "") === shownFor;
      // A flow come to wait for you while you are in its chat: its card rises in from below where you are, and rings once.
      if (same) flows.forEach((f, i) => { if (!shown.has(f.id) && f.state !== "draft") flash(cardsNow[i], ["is-new-now", "is-flash"], 1200); });
      shownFor = String(chat?.chainId || "");
      shown = new Set(flows.map((f) => f.id));
    },
  };
}

/**
 * The chat's status line for its flow (§4.8), in the header beside the status capsule: "Flow · step 3 of 5 · Reviewer
 * asks you", orange while it waits for you, gray after a restart; its tip names a team writing, and where. A press
 * opens the flow on the Agents tab. Hidden while no flow runs.
 * @param {{ open: (id: string) => void }} io @param {{ h?: Mk }} [o]
 */
export function createFlowStatus(io, o = {}) {
  const mk = o.h || h;
  const words = mk("span", { class: "fl-status-w" });
  let id = "";
  /** What it said last, and for which chat: a line come or changed in the same chat moves once (the Designer's of 10-28). */
  let said = "";
  let saidFor = /** @type {string | null} */ (null);
  const el = mk("button", { class: "fl-status hidden", type: "button", onclick: () => { if (id) io.open(id); } }, mk("span", { class: "fl-status-ic", "aria-hidden": "true", html: ICONS.waypoints }), words);
  return {
    el,
    /** @param {readonly Flow[]} flows @param {string} [chain]  the chat they are of */
    paint(flows, chain = "") {
      const s = statusOf(flows);
      el.classList.toggle("hidden", !s);
      const same = saidFor === chain;
      saidFor = chain;
      if (!s) {
        said = "";
        return;
      }
      id = s.id;
      el.classList.toggle("is-warn", s.tone === "warn");
      el.classList.toggle("is-gray", s.tone === "gray");
      // It shimmers while its flow runs and nothing asks you; it rises in where it came, its words where they changed.
      el.classList.toggle("is-running", s.tone === "" && flows.some((f) => f.id === s.id && f.state === "running"));
      if (same && !said) flash(el, ["is-new-now"], 240);
      else if (same && said !== s.words) flash(words, ["is-said"], 180);
      said = s.words;
      words.replaceChildren(s.words);
      el.setAttribute("title", s.title);
      el.setAttribute("aria-label", s.words);
    },
  };
}

/** The steps of a flow as its edit sends them, for the box's sheet (views/flow-sheet.js). */
export { stepsBody };
