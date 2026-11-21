// @ts-check
// A flow's box, changed on its sheet (HarnessV4_Flow_Plan F5; the F0 mock's "Edit a box"; HarnessV4_OneAgent_Plan
// OA3): who it is — one of your agents, at its own level or reading only, one of your teams, or your own review — what
// it is asked, which boxes before it it needs (their results are what it is handed, OA-D5), what it sees of your chat
// (its card's choice unless you change it, FL-D7), what it runs on (FL-D13), and whether an agent box is the flow's
// gate (never the first step, needing what it checks: the server says so in words where it is not). Done writes the
// flow's steps through its edit route; nothing runs. A new box comes the same way, at a step's end or as a step of its
// own. And Save as a flow… (F6): the steps kept under a name, to start again on other words.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { dialog, menu } from "../lib/ui.js";
import { kids } from "../widgets/kit.js";
import { toggle } from "../lib/fields.js";
import { cardIcon, cardTone } from "../lib/agent-cards.js";
import { leadLook } from "../lib/brief.js";
import { createModelSelect } from "../composer/model.js";
import { effortChip } from "../lib/effort-chip.js";
import { KIND_TIPS, stepsBody } from "../lib/flow.js";
import { state } from "../state.js";
import { teamsOn } from "../../lib/teams-on.js";

/** @typedef {typeof h} Mk */
/** @typedef {import("../lib/flow.js").Flow} Flow */
/**
 * @typedef {{ id: string, kind: "agent" | "team" | "review", agent: string, words: string, needs: string[], gate: boolean, readOnly: boolean,
 *   model: string | null, effort?: string, sees: string | null }} BoxBody  `id` "" for a new box: the server gives it one;
 *   `effort` where one is picked
 */
/** @typedef {{ why: string, boxes: BoxBody[] }} StepBody */

/** What an agent box may see of the chat, as its sheet offers it; null is its card's choice. */
export const CARD_SEES = Object.freeze([
  { id: "", label: "Its card's choice", title: "What its card says it sees, as when you ask it yourself" },
  { id: "none", label: "Nothing of this chat", title: "Only the flow's words and the results it needs" },
  { id: "folded", label: "This chat folded", title: "Each turn's words, one line per tool call, and its reply" },
]);
/** What a team box reads of the chat; null is the record, as a team on the side reads it. */
export const TEAM_SEES = Object.freeze([
  { id: "", label: "The chat's record, as a team reads it", title: "Its lead reads the main chat's record first, as a team you send on the side does" },
  { id: "words", label: "Only the flow's words", title: "None of the chat: its lead reads the flow's words and the results it needs alone" },
]);

/**
 * A new box's first shape: your first agent, else your first team, needing what it is given (the step before's boxes).
 * @param {readonly { tag: string }[]} cards @param {readonly { key: string }[]} teams @param {string[]} [needs] @returns {BoxBody}
 */
export function newBox(cards, teams, needs = []) {
  const c = cards[0] || null;
  if (c) return { id: "", kind: "agent", agent: c.tag, words: "", needs: [...needs], gate: false, readOnly: false, model: null, sees: null };
  return { id: "", kind: "team", agent: teams[0]?.key || "", words: "", needs: [...needs], gate: false, readOnly: false, model: null, sees: null };
}

/** @param {readonly StepBody[]} steps @returns {StepBody[]} */
const copyOf = (steps) => steps.map((s) => ({ why: s.why || "", boxes: s.boxes.map((b) => ({ ...b, needs: [...(b.needs || [])] })) }));

/**
 * The steps after a box's sheet's Done: the box in its place, at its step's end, or in a step of its own after the last.
 * @param {readonly StepBody[]} steps @param {number} step @param {number | null} index @param {BoxBody} box
 */
export function withBox(steps, step, index, box) {
  const out = copyOf(steps);
  if (step >= out.length) out.push({ why: "", boxes: [box] });
  else if (index == null || index < 0) out[step].boxes.push(box);
  else out[step].boxes[index] = box;
  return out;
}
/**
 * The steps without a box; a step it leaves empty goes. A box that needed it needs what it needed instead, so what it
 * is handed still comes from before it.
 * @param {readonly StepBody[]} steps @param {number} step @param {number} index
 */
export function withoutBox(steps, step, index) {
  const gone = steps[step]?.boxes[index];
  const out = copyOf(steps).map((s, i) => (i === step ? { ...s, boxes: s.boxes.filter((_, j) => j !== index) } : s)).filter((s) => s.boxes.length);
  if (!gone?.id) return out;
  for (const s of out) for (const b of s.boxes) {
    if (!b.needs.includes(gone.id)) continue;
    b.needs = [...new Set(b.needs.flatMap((n) => (n === gone.id ? gone.needs || [] : [n])))].filter((n) => n !== b.id);
  }
  return out;
}

/**
 * Open a box's sheet. `index` null: a new box at the step's end; a `step` past the last: a new step.
 * @param {{ flow: Flow, step: number, index: number | null, cards: () => { tag: string, name: string, goodFor?: string, from?: string | null }[],
 *   teams: () => { key: string, name: string, line?: string, readOnly?: boolean }[], models: () => any[],
 *   families?: () => any[], accounts?: () => any[],
 *   write: (steps: StepBody[]) => Promise<boolean> }} io  `write`: the flow's steps through its edit route — true once
 *   the server took them, else it said why; `models`, `families`, `accounts`: the catalogue as the page has it, for
 *   Runs on's picker
 * @param {{ h?: Mk, dialog?: typeof dialog, menu?: typeof menu, modelSelect?: typeof createModelSelect }} [o]  the tests'
 *   fake DOM, dialog, menu and model picker
 */
export function openBoxSheet(io, o = {}) {
  const mk = o.h || h;
  const open = o.dialog || dialog;
  const openMenu = o.menu || menu;
  /** @param {string} name @param {string} [cls] */
  const glyph = (name, cls = "inst-ic") => mk("span", { class: cls, "aria-hidden": "true", html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });
  const steps = /** @type {StepBody[]} */ (copyOf(/** @type {any} */ (stepsBody(io.flow))));
  const fresh = io.index == null || io.step >= steps.length;
  // The boxes before its step, each with its step: what it may need.
  const earlier = steps.slice(0, Math.min(io.step, steps.length)).flatMap((s, i) => s.boxes.map((b) => ({ box: b, step: i })));
  const nameIn = (/** @type {string} */ id) => io.flow.steps.flatMap((s) => s.boxes).find((b) => b.id === id)?.name || id;
  /** @type {BoxBody} */
  const box = fresh
    ? newBox(io.cards(), io.teams(), io.step > 0 ? (steps[Math.min(io.step, steps.length) - 1]?.boxes || []).map((b) => b.id) : [])
    : { ...steps[io.step].boxes[/** @type {number} */ (io.index)] };
  const words = mk("textarea", { class: "fl-input fl-sheet-words", rows: "4", maxlength: "2000", placeholder: "What this box is asked: its part of the flow", "aria-label": "What it is asked", oninput: () => { box.words = String(/** @type {any} */ (words).value || ""); } });
  /** @type {any} */ (words).value = box.words;
  const body = mk("div", { class: "fl-sheet" });
  const note = mk("p", { class: "fl-note is-warn hidden" });
  let saving = false;

  const card = () => io.cards().find((c) => c.tag === box.agent) || null;
  const team = () => io.teams().find((t) => t.key === box.agent) || null;
  const nameOf = () => (box.kind === "review" ? "Your review" : (box.kind === "team" ? team()?.name : card()?.name) || box.agent || "Pick who");
  const where = fresh
    ? io.step >= steps.length ? `a new step, step ${steps.length + 1}` : `step ${io.step + 1}, beside the others`
    : `step ${io.step + 1}`;
  /** A face: a team's with its crown, your review's, an agent's card. @param {Pick<BoxBody, "kind" | "agent">} b @param {string} size */
  const faceOf = (b, size) => {
    if (b.kind === "team") {
      const look = leadLook(b.agent);
      return mk("span", { class: `pf ${size} t-${look.tone}`, "aria-hidden": "true" }, glyph(look.icon, "pf-ic"), glyph("crown", "pf-crown"));
    }
    if (b.kind === "review") return mk("span", { class: `pf ${size} t-gray`, "aria-hidden": "true" }, glyph("user", "pf-ic"));
    const c = io.cards().find((x) => x.tag === b.agent) || null;
    return mk("span", { class: `pf ${size} t-${c ? cardTone(c) : "gray"}`, "aria-hidden": "true" }, glyph(c ? cardIcon(c) : "bot", "pf-ic"));
  };

  /** Who it is: your agents, your teams each with its crown, and your own review. @param {any} anchor */
  const pickWho = (anchor) => {
    const cards = io.cards();
    const teams = io.teams();
    const pick = (/** @type {"agent" | "team" | "review"} */ as, /** @type {string} */ id) => {
      // Its effort goes with its model where it changes kind (the review of a8e034ded): a lead's is not an agent's, and a
      // review has none.
      if (as !== box.kind) delete box.effort;
      if (as === "review") Object.assign(box, { kind: "review", agent: "", gate: false, readOnly: false, sees: null, model: null });
      else if (as === "team") Object.assign(box, { kind: "team", agent: id, gate: false, sees: box.kind === "team" ? box.sees : null, model: box.kind === "team" ? box.model : null });
      else Object.assign(box, { kind: "agent", agent: id, sees: box.kind === "agent" ? box.sees : null, model: box.kind === "agent" ? box.model : null });
      paint();
    };
    openMenu([
      ...(cards.length ? [{ type: "label", label: "Your agents" }, ...cards.map((c) => ({ type: "radio", label: c.name, desc: c.goodFor || "", icon: cardIcon(c), checked: box.kind === "agent" && box.agent === c.tag, onClick: () => pick("agent", c.tag) }))] : []),
      ...(teams.length ? [{ type: "label", label: "Your teams: a lead and its workers" }, ...teams.map((t) => ({ type: "radio", label: t.name, desc: t.line || "", icon: "crown", checked: box.kind === "team" && box.agent === t.key, onClick: () => pick("team", t.key) }))] : []),
      { type: "label", label: "You" },
      { type: "radio", label: "Your review", desc: KIND_TIPS.review, icon: "user", checked: box.kind === "review", onClick: () => pick("review", "") },
    ], { anchor, width: 340 });
  };
  /** What it sees of the chat. @param {any} anchor */
  const pickSees = (anchor) => {
    const list = box.kind === "team" ? TEAM_SEES : CARD_SEES;
    openMenu(list.map((x) => ({ type: "radio", label: x.label, desc: x.title, checked: (box.sees || "") === x.id || (box.kind === "team" && !box.sees && x.id === "" ), onClick: () => { box.sees = x.id || null; paint(); } })), { anchor, width: 340 });
  };
  // What it runs on, in the picker the chat's box has (the owner's of 10-28: "anywhere in the harness where model picker
  // is used, have it use our standard model picker"): by provider, searchable, each model with its window, its price
  // and what it takes; Use the default goes back to its card's model, or its team's. One picker for an agent's box and
  // one for a team's, each saying its own default.
  const pickerOf = o.modelSelect || createModelSelect;
  /** @type {Record<string, ReturnType<typeof createModelSelect>>} */
  const pickers = {};
  const runsOn = () => {
    const team = box.kind === "team";
    const p = pickers[box.kind] || (pickers[box.kind] = pickerOf({
      onChange: (name) => { box.model = name || null; paint(); },
      onUseDefault: () => { box.model = null; paint(); },
      defaultDesc: team ? "Its lead and its workers on what the team names" : "This chat's rows for its card, else its card's models, else this chat's list, else the main agent's model",
      blank: team ? "Its team's models" : "Its card's model",
    }));
    p.el.setAttribute("aria-label", "Runs on");
    p.el.classList.toggle("is-default", !box.model);
    p.setModels(io.models() || []);
    p.setFamilies(io.families?.() || []);
    p.setAccounts(io.accounts?.() || []);
    p.set(box.model || "");
    return p.el;
  };
  // How hard it thinks beside its model (the owner's word of 11-05: effort in every model picker): an agent box's agent;
  // a team box's lead, and its crew where their team and cards name none; the default as its card or team says, else
  // the main agent's.
  const effort = effortChip({
    label: "How hard it thinks",
    value: box.effort || "",
    onChange: (l) => { if (l) box.effort = l; else delete box.effort; paint(); },
    model: () => box.model || "",
    families: () => io.families?.() || [],
    // A team box's says its team's, as its model's picker does (the look of 11-05).
    inherit: () => (box.kind === "team"
      ? { level: "", words: "As its team says", desc: "As its team or its lead's card says, else as the main agent thinks" }
      : { level: "", words: "As its card says", desc: "As its card says, else as the main agent thinks" }),
    mk,
    menu: openMenu,
  });

  /** A row of the sheet: its label, its control. @param {string} label @param {...any} control */
  const row = (label, ...control) => mk("div", { class: "fl-srow" }, mk("span", { class: "fl-sl" }, label), ...kids(control));
  /** A popup button with its words. @param {string} words @param {string} title @param {(anchor: any) => void} fn */
  const popup = (words, title, fn) => {
    const b = mk("button", { class: "fl-popup", type: "button", title, onclick: () => fn(b) }, mk("span", {}, words), glyph("chevronsUpDown", "fl-popup-ic"));
    return b;
  };
  /** One need, ticked or not. @param {string} id @param {string} name @param {string} line @param {boolean} broken */
  const needEl = (id, name, line, broken) => {
    const on = box.needs.includes(id);
    const tick = mk("input", { type: "checkbox", class: "fl-need-tick", "aria-label": `Needs ${name}`, ...(on ? { checked: "" } : {}), onchange: () => {
      box.needs = on ? box.needs.filter((n) => n !== id) : [...box.needs, id];
      paint();
    } });
    const b = earlier.find((x) => x.box.id === id)?.box;
    return mk("label", { class: `fl-need${broken ? " is-broken" : ""}` }, tick, b ? faceOf(b, "s16") : null, mk("span", { class: "fl-need-n" }, name), mk("span", { class: "fl-q" }, line));
  };
  /** Which boxes before it it needs: their results are what it is handed, with your words. */
  const needsOf = () => {
    if (io.step === 0) return [mk("p", { class: "fl-shint" }, "Nothing: the first step is handed your words alone.")];
    const broken = box.needs.filter((n) => !earlier.some((x) => x.box.id === n));
    return [
      mk("div", { class: "fl-needs-list", role: "group", "aria-label": "It needs" },
        ...earlier.map((x) => needEl(x.box.id, nameIn(x.box.id), `step ${x.step + 1}`, false)),
        ...broken.map((n) => needEl(n, nameIn(n), "not before it: untick it, or move a box", true))),
      mk("p", { class: "fl-shint" }, box.needs.length ? "It is handed your words and these results, nothing else." : "It is handed your words alone."),
    ];
  };

  function paint() {
    const t = team();
    const sees = (box.kind === "team" ? TEAM_SEES : CARD_SEES).find((x) => x.id === (box.sees || "")) || null;
    const roTeam = !!t?.readOnly;
    const review = box.kind === "review";
    body.replaceChildren(...kids([
      mk("div", { class: "fl-sheet-head" }, faceOf(box, "s32"), mk("div", {}, mk("div", { class: "fl-sheet-t" }, nameOf()), mk("div", { class: "fl-q" }, where))),
      row("Who", popup(nameOf(), teamsOn(state.config) ? "One of your agents, one of your teams, or your own review" : "One of your agents, or your own review", pickWho)),
      mk("p", { class: "fl-shint" }, KIND_TIPS[box.kind]),
      mk("div", { class: "fl-srow is-col" }, mk("span", { class: "fl-sl" }, review ? "What you look at" : "What it is asked"), words),
      mk("div", { class: "fl-srow is-col" }, mk("span", { class: "fl-sl" }, "It needs"), ...needsOf()),
      review ? null : row("It sees", popup(sees?.label || "Its card's choice", sees?.title || "", pickSees)),
      review ? null : row("Runs on", runsOn(), (effort.set(box.effort || ""), effort.el)),
      box.kind === "team"
        ? row("Reads only", toggle(mk, roTeam || box.readOnly, "Reads only", () => { if (!roTeam) { box.readOnly = !box.readOnly; paint(); } }), mk("span", { class: "fl-shint is-inline" }, roTeam ? "this team reads only as it is" : box.readOnly ? "it changes no file of your project" : "it writes: in a git project, in the flow's own worktree"))
        : null,
      box.kind === "agent"
        ? row("Reads only", toggle(mk, box.readOnly, "Reads only", () => { box.readOnly = !box.readOnly; paint(); }), mk("span", { class: "fl-shint is-inline" }, box.readOnly ? "it reads, and changes nothing" : "at its card's own level"))
        : null,
      box.kind === "agent"
        ? row("A gate", toggle(mk, box.gate, "A gate", () => { box.gate = !box.gate; paint(); }), mk("span", { class: "fl-shint is-inline" }, box.gate ? "its answer begins with its verdict; the steps after it wait for go" : "never the first step: it checks the boxes it needs"))
        : null,
      note,
      mk("div", { class: "fl-sheet-foot" }, ...kids([
        fresh ? null : mk("button", { class: "inst-btn is-quiet is-red", type: "button", onclick: () => void remove() }, "Remove the box"),
        mk("span", { class: "th-sp" }),
        mk("button", { class: "inst-btn", type: "button", onclick: () => d.close(true) }, "Cancel"),
        mk("button", { class: "inst-btn is-primary", type: "button", onclick: () => void done() }, fresh ? "Add" : "Done"),
      ])),
    ]));
  }
  /** @param {StepBody[]} next */
  const write = async (next) => {
    if (saving) return;
    saving = true;
    const ok = await io.write(next);
    saving = false;
    if (ok) d.close(true);
  };
  const done = async () => {
    box.words = String(/** @type {any} */ (words).value || "").trim();
    if (box.kind !== "review" && !box.agent) return say(teamsOn(state.config) ? "Pick who this box is: one of your agents or teams, or your review" : "Pick who this box is: one of your agents, or your review");
    if (box.kind !== "review" && !box.words) return say("Say what this box is asked: its part of the flow");
    if (box.kind === "review" && !box.needs.length) return say("Tick what you review: the boxes whose results you look at");
    await write(withBox(steps, io.step, fresh ? null : io.index, box));
  };
  const remove = async () => {
    if (fresh || io.index == null) return;
    await write(withoutBox(steps, io.step, io.index));
  };
  /** @param {string} words */
  const say = (words) => {
    note.replaceChildren(words);
    note.classList.remove("hidden");
  };

  paint();
  const d = open({ title: fresh ? "A new box" : "Change the box", body, wide: false });
  return { body, box, done, remove, close: () => d.close(true) };
}

/**
 * Save as a flow… (F6): its steps under a name, to start again from Agents › Flows on other words. Its words stay its own.
 * @param {{ name: string, save: (name: string) => Promise<boolean> }} io @param {{ h?: Mk, dialog?: typeof dialog }} [o]
 */
export function openSaveSheet(io, o = {}) {
  const mk = o.h || h;
  const open = o.dialog || dialog;
  const name = mk("input", { class: "fl-input", type: "text", maxlength: "80", "aria-label": "Its name" });
  /** @type {any} */ (name).value = io.name;
  let saving = false;
  const go = async () => {
    const n = String(/** @type {any} */ (name).value || "").trim();
    if (!n || saving) return;
    saving = true;
    const ok = await io.save(n);
    saving = false;
    if (ok) d.close(true);
  };
  const body = mk("div", { class: "fl-sheet" },
    mk("p", { class: "fl-shint is-wide" }, "Its steps and boxes are kept — who each is, what it is asked, what it needs, why each step is where it is — without the words it was drawn from. Agents › Flows starts it again on new words."),
    mk("label", { class: "fl-field" }, mk("span", { class: "fl-field-l" }, "Its name"), name),
    mk("div", { class: "fl-sheet-foot" }, mk("span", { class: "th-sp" }),
      mk("button", { class: "inst-btn", type: "button", onclick: () => d.close(true) }, "Cancel"),
      mk("button", { class: "inst-btn is-primary", type: "button", onclick: () => void go() }, "Save")));
  const d = open({ title: "Save as a flow", body });
  return { body, go };
}
