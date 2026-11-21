// @ts-check
// Library › Agents and teams (HarnessV4_Tasks E15 steps 2, 4, 6 and 7; proposal_ux §4.15, phase 7; team_v2_plan §10
// O5; U13, "Agents, one thing"): the agents you keep across chats, made and changed here, and the teams built from them
// — one page, no tabs (U13-D4). An agent is kept as a card: the tag you type after @, its name, the line that says what
// it is good for, how it thinks, what it may do, the model it runs on and what it sees of the chat. One kind of agent
// (HarnessV4_OneAgent_Plan OA1): any agent can be asked, lead a team or work in one, and does what its card's level
// lets it. The page, top to bottom: the Teams, every team as a card with its workers (teams.js); the Agents — yours first —
// each saying the teams that seat it or that it leads, one list (the owner's word of 10-24:
// "everything was just an Agent and Teams just referenced those agents"). The six shipped teams' own Leads live in their pods, part of their
// team (`partOf`, OA-D4). A card says in chips what it may do, the teams it sits in or leads, what it sees,
// its model where it names one; where its own model cannot run an agent now, it says why. Its foot holds its one tick, "Your agent may use it" (step 3, U13-D9): the ticked agents
// are whom the main agent of every chat that chose no list of its own may ask by itself — Builder and
// Reviewer say in grey that it always can, and your copy of either takes its place where the copy is ticked —, and its
// Edit: every part of a card changes there, a shipped one's too, in place (HarnessV4_ShippedAgents_Plan SA4): a part
// of a shipped card you changed carries its "changed" mark and Put back, and where Filament's words for it moved since
// you changed it, a line says so with Show and Take Filament's; the card says "changed by you", and Put back as it ships
// gives it back whole. Its tools are switches that only take away (SA2). Pressed, a card opens across its row to its
// whole, with who uses it — the teams it leads or sits in, the starts that launch it — and Make a copy, and Delete on
// yours, Put back as it ships on a shipped one you changed; a seat's card in a pod carries the same, and on a team of yours Make
// a copy for this team, which seats the copy in the card's place. A card names its models first choice first (the
// owner's 10-19 list): the next takes over where one cannot run, has no room or its provider fails; where its first
// cannot run now, the card says the one it runs on meanwhile. How to use them, beside New agent… and New team… at the
// page's head, opens the guide over the Teams — how you use them, in a chat, never from here, and a word on the coding
// agents' own sub-agents, which Filament shows but does not keep —, closed until it is pressed. One column, its grids
// as wide as the page lets them (the owner's redesign of 11-09); New agent… ends the Agents only where none is yours. The
// editor opens in a sheet over the page (editor-sheet.js), its parts groups of rows: its foot says why Save waits, or a
// refusal in the server's words, and a model is checked as it is picked; Esc or × with a change asks first. A copy needs
// a tag of its own and saves nothing until Save. Delete asks first on the sheet. Built with an injected `h`, `api`,
// model picker, sheet and dialog, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { confirmDialog } from "../lib/ui.js";
import { prettyModel } from "../lib/families.js";
import { keepingFocus } from "../lib/keep-focus.js";
import { createModelSelect } from "../composer/model.js";
import { cardIcon, cardTone, listed, seesWords, askAfter, usedByWords, toolsOffWords, CHANGE_WORDS, COPY_HOLDS, MAY_WORDS, NO_WORDS, RUNS_HINT, TOOL_WORDS } from "../lib/agent-cards.js";
import { SUBAGENT_VIEW_WORDS } from "../../lib/context-words.js";
import { createTeamGroups } from "./teams.js";
import { state } from "../state.js";
import { teamsOn } from "../../lib/teams-on.js";
import { effortsIn, modelList } from "./model-list.js";
import { line as formRow, openEditorSheet, part, shippedMarks } from "./editor-sheet.js";

/** The share of a limit from which a count says it is near. */
const NEAR = 0.9;
/** A tag as a save takes it: 2 to 24 letters, digits and dashes, starting with a letter. */
const TAG = /^[a-z][a-z0-9-]{1,23}$/;
/** What a card that names no model runs on (HarnessV4_Tasks E23-D6, U13-D8): the chat's list, for its launch. */
const NO_MODEL = "Same as the main agent, unless this chat sets its own — as a team's worker, its team's models first";
/** The same, while Settings › Experimental's Teams switch is off (src/ui/lib/teams-on.js). */
const NO_MODEL_ALONE = "Same as the main agent, unless this chat sets its own";
/** What the editor says of a card's models. */
const MODELS_HINT = "First choice first: where one cannot run now, has no room, or its provider fails, the next takes over. As a team's worker, the team's own models come first. None: the main agent's, unless this chat sets its own.";
/** The same, while teams are off. */
const MODELS_HINT_ALONE = "First choice first: where one cannot run now, has no room, or its provider fails, the next takes over. None: the main agent's, unless this chat sets its own.";
/** Whether this page offers teams: Settings › Experimental's Teams switch. */
const teamsHere = () => teamsOn(state.config);
/** A change's choices under "and the code changes, as a patch:". */
const CHANGE_SHORT = Object.freeze({ turn: "the last turn's", uncommitted: "everything uncommitted" });
/** A card's models, first choice first: a card from before the list names one or none. @param {any} c @returns {string[]} */
const modelsOf = (c) => (Array.isArray(c?.models) ? c.models : c?.model ? [c.model] : []);
/**
 * How each one is used — always in a chat, never from this page (team_v2_plan §10 O5, U13-D2): a glyph, its tone, its
 * name and a line, a word between backticks set as code.
 */
const USES = Object.freeze([
  { icon: "atSign", tone: "indigo", name: "Ask", line: "— start a message with `@product is this worth it?` and the answer is yours alone. Name it later in a message to your agent, and the answer goes to your agent too. The line over the box says who gets it, and on which model, before you send." },
  { icon: "wrench", tone: "blue", name: "Start one beside you", line: "— the chat's Agents tab › Start…, or tell your agent: “send a reviewer to find where we parse dates”." },
  { icon: "crown", tone: "yellow", name: "Put a team in charge", line: "— Agents › Start… › a team › In charge, or `/team builders`. It runs your chat until Back to your agent." },
  { icon: "users", tone: "pink", name: "Send a team on the side", line: "— Agents › Start… › a team › On the side. It works in a chat of its own, listed under yours; its result waits for you." },
  // The owner's words of 10-19: asking for an agent on a model and an effort "is not documented in Agents and teams".
  { icon: "slidersHorizontal", tone: "teal", name: "Pick its model", line: "— say it in your words, “send a reviewer on GLM 5.3 Flash at high effort to find where we parse dates”, or type `/subagent model=\"GLM 5.3 Flash\" effort=high` and the task. Any model Filament lists, at the provider you name." },
  { icon: "bot", tone: "gray", name: "Your agent by itself", line: "— only what you let it use: Builder and Reviewer always; BugHunters to start with. A team it sends works on the side, its result waiting for you unless the team says otherwise. Ticks here count in every chat; a chat can change its own on its Agents tab." },
]);
/** How to use them while teams are off: no team's way, and your agent with no team. */
const USES_ALONE = Object.freeze([
  ...USES.filter((w) => w.icon !== "crown" && w.icon !== "users" && w.icon !== "bot"),
  { icon: "bot", tone: "gray", name: "Your agent by itself", line: "— only what you let it use: Builder and Reviewer always. Ticks here count in every chat; a chat can change its own on its Agents tab." },
]);
/** How to use them's panel, which its button opens. */
const GUIDE_ID = "lib-guide";
/** What asking an agent does, by its level (OA1): its answer, and what becomes of what it changes. */
const ASKED_DOES = Object.freeze({
  read: "it answers, and changes nothing",
  copy: "it answers, or does the work in its own copy of the project, and nothing it changes there is kept",
  edit: "it answers, or does the work in its own copy of the project, and what it changes waits there for you to apply",
});
/** What a new card sees until its maker says otherwise (services/agent-cards.js): what it is asked, alone. */
const NEW_SEES = Object.freeze({ view: "none", running: false, changes: null });
/** What a card sees, in a chip, by its view past "none". */
const SEES_CHIP = Object.freeze({ folded: "Sees the chat folded", window: "Sees your agent's context" });
/** A card's fields, in the order an edit sends them — every one a shipped card sets in place too (SA1). */
const CARD_FIELDS = /** @type {const} */ (["name", "goodFor", "thinks", "may", "models", "sees", "mayRun", "toolsOff"]);
/** Each field as the editor names it, for its Put back. @type {Readonly<Record<string, string>>} */
const FIELD_LABELS = Object.freeze({ name: "Name", goodFor: "Good for", thinks: "How it thinks", may: "May do", models: "Model", sees: "Sees", mayRun: "Runs without asking", toolsOff: "Its tools" });
/** Each field in a sentence: what of a shipped card you changed. @type {Readonly<Record<string, string>>} */
const CHANGED_WORDS = Object.freeze({ name: "its name", goodFor: "what it is good for", thinks: "how it thinks", may: "what it may do", models: "its models", efforts: "how hard it thinks on each", sees: "what it sees", mayRun: "the commands it runs without asking", toolsOff: "its tools" });
/** The levels, lowest first: a level raised past the one its words were written for asks whether they still hold. */
const MAY_RANK = Object.freeze({ read: 0, copy: 1, edit: 2 });
/** What the editor asks of a card whose level you raise while how it thinks stays as written (the plan's case 8). @type {Readonly<Record<string, string>>} */
const RAISED = Object.freeze({
  read: "How it thinks was written for an agent that changes nothing: change its words too?",
  copy: "How it thinks was written for an agent whose changes are not kept: change its words too?",
});
/** Whether two values of a field are the same, as the editor holds them. @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** A card's field as the editor's values hold it. @param {any} card @param {string} k */
const fieldOf = (card, k) =>
  k === "models" ? modelsOf(card)
    : k === "sees" ? { view: card.sees?.view || "none", running: !!card.sees?.running, changes: card.sees?.changes || null }
      : k === "mayRun" || k === "toolsOff" ? [...(card[k] || [])]
          : String(card[k] ?? "");
/** What of a shipped card you changed, in a sentence: "how it thinks and what it may do". @param {any} c */
const changedWords = (c) => listed((c.set || []).map((/** @type {string} */ k) => CHANGED_WORDS[k] || k));
/** The tools a card goes without, by name. @param {readonly string[] | undefined} off */
const toolNames = (off) => (off || []).map((id) => TOOL_WORDS[id]?.name || id);
/** @param {number} n */
const count = (n) => n.toLocaleString("en-US");
/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);
/** What a card sees, as its chip says it: what it is asked, unless it sees more. @param {any} c */
const seesChip = (c) => {
  const v = String(c.sees?.view || "none");
  const base = /** @type {Record<string, string>} */ (SEES_CHIP)[v] || "Sees what it is asked";
  return c.sees?.changes ? `${base} + a patch` : base;
};

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, onChanged?: () => void, start?: string | null, acts?: HTMLElement | null }} [cb]
 *   `onChanged`: an agent or a team was made, changed or deleted, or a list changed; `start`: "new" opens on a new
 *   agent's editor, "new-team" on a new team's, "groups" with the teams in sight;
 *   `acts`: the page's head, where New agent… and New team… stand — else a bar at the top of `body`
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, modelSelect?: typeof createModelSelect, confirm?: typeof confirmDialog,
 *   dialog?: typeof import("../lib/ui.js").dialog, menu?: Parameters<typeof import("../lib/effort-chip.js").effortChip>[0]["menu"], copy?: (text: string) => Promise<void> }} [io]  `dialog`: what an editor's sheet opens on;
 *   `copy`: what a team's /team, pressed, puts on the clipboard
 */
export function renderLibraryAgents(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const pickModel = io.modelSelect || createModelSelect;
  const ask = io.confirm || confirmDialog;
  const toast = cb.onToast || (() => {});
  const changed = cb.onChanged || (() => {});
  const start = cb.start || null;
  const acts = cb.acts || null;

  /**
   * The editor open, and where the page stood when it opened; what opened it — the head's New agent…, a seat's card
   * in a pod, else the Agents' own New agent…; the team a copy is made for, with the card it takes the place of; its
   * sheet, and what draws its pickers again. `edit` on a shipped card sets it in place.
   * @typedef {{ mode: "new" | "copy" | "edit", card: any, top: number, at: "bar" | "seat" | null,
   *   team: { key: string, from: string, seat: string | null } | null, sheet: { close: (force?: boolean) => void } | null, refresh?: () => void }} Editing
   */
  const st = {
    /** @type {any} */ data: null,
    /** @type {string | null} */ failed: null,
    /** @type {any[]} */ catalogue: [],
    /** The catalogue's families: the efforts each model takes. @type {any[]} */ families: [],
    /** Cards opened to their whole, by tag. @type {Set<string>} */ open: new Set(),
    /** Whether How to use them is open: closed until it is pressed. */ guide: false,
    /** @type {Editing | null} */ editing: null,
  };
  /**
   * The page as painted, for focus to come back to: each card's face and acts, the Agents' New agent… (none where some
   * agent is yours), the head's, How to use them, a seat's card's acts.
   */
  const openers = {
    /** @type {Map<string, Record<string, HTMLElement | null>>} */ cards: new Map(),
    /** @type {HTMLElement | null} */ add: null,
    /** @type {HTMLElement | null} */ addAgent: null,
    /** @type {HTMLElement | null} */ guide: null,
    /** @type {Record<string, HTMLElement | null> | null} */ seat: null,
  };

  /** @param {string} name @param {string} [cls] */
  const glyph = (name, cls = "tset-ic") => m("span", { class: cls, "aria-hidden": "true", html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });
  const cards = () => [...(st.data?.shipped || []), ...(st.data?.saved || []), ...(st.data?.plugins || [])];
  /** A card's name by its tag, or the tag. @param {string} tag */
  const nameOf = (tag) => cards().find((c) => c.tag === tag)?.name || `@${tag}`;
  /** A card's models in words: "GLM-5.3, then Kimi K3", or what it runs on with none. @param {any} c */
  const modelWords = (c) => (modelsOf(c).length ? modelsOf(c).map((x) => prettyModel(x)).join(", then ") : teamsHere() ? NO_MODEL : NO_MODEL_ALONE);
  /** Where a card's first model cannot run now and another of its list can: that one, and those passed. @param {any} c */
  const fallbackOf = (c) => st.data?.fallbacks?.[c.tag] || null;
  /** What a write answers of the cards' models: why none can run, the one each runs on meanwhile. @param {any} r */
  const tookModels = (r) => {
    st.data.problems = r.problems || {};
    st.data.fallbacks = r.fallbacks || {};
  };
  /** The two agents your agent has in every session: Builder and Reviewer. @returns {string[]} */
  const always = () => st.data?.always || [];
  /** Whose place a card takes where your agent may use it: a copy of Builder or Reviewer. @param {any} c @returns {string | null} */
  const placeOf = (c) => (!c.shipped && always().includes(c.from) ? c.from : null);
  /** The teams and the models, beside the cards the teams are built from. */
  const groups = createTeamGroups({ body, cards, repaint: () => paint(), read: () => read(), seat: (c, at) => seatOwn(c, at) }, cb, io);

  // ---- whom your agent may use by itself -------------------------------------------------------------------------
  /** The ticked tags whose card exists: a write names no agent that is gone. */
  const ticked = () => (st.data?.ask || []).filter((/** @type {string} */ t) => cards().some((c) => c.tag === t));
  /** @param {any} c @param {boolean} on */
  async function setAsk(c, on) {
    try {
      const r = await call("/subagents/ask", { method: "PUT", body: { tags: askAfter(ticked(), c.tag, on) } });
      st.data.ask = r.ask;
      const place = placeOf(c);
      const there = place ? `: there it takes ${nameOf(place)}'s place` : "";
      toast(on
        ? `Your agent may use ${c.name}, in every chat that chose no list of its own${there}`
        : `Your agent no longer uses ${c.name} by itself`);
      changed();
    } catch (e) {
      toast(errText(e), "err");
    }
    paint();
    openers.cards.get(c.tag)?.ask?.focus({ preventScroll: true });
  }

  // ---- the cards --------------------------------------------------------------------------------------------------
  /** One row of a card's whole. @param {string} label @param {any[]} value */
  const fact = (label, ...value) => m("div", { class: "aset-fact" }, m("span", { class: "aset-fact-label" }, label), m("span", { class: "aset-fact-value" }, ...value));
  /** A chip on a card's face. @param {string} icon @param {string} words @param {string} tone @param {string} [title] */
  const chip = (icon, words, tone, title = "") =>
    m("span", { class: `lib-chip${tone ? ` ${tone}` : ""}`, ...(title ? { title } : {}) }, icon ? glyph(icon, "lib-chip-ic") : null, words);
  /**
   * What a card's face says in chips (U13 revised): what it may do — Reads only, Runs in its own copy, Changes files —;
   * the teams it leads or sits in; what it sees; and its model where it names one, or the one it runs on meanwhile.
   * @param {any} c
   */
  const chipsOf = (c) => {
    // The teams it leads or sits in, while teams are on.
    const used = teamsHere() ? st.data.usedBy?.[c.tag]?.teams || [] : [];
    const led = used.filter((/** @type {any} */ t) => t.as === "lead").map((/** @type {any} */ t) => String(t.name));
    const seated = used.filter((/** @type {any} */ t) => t.as !== "lead").map((/** @type {any} */ t) => String(t.name));
    const list = modelsOf(c);
    const fb = fallbackOf(c);
    const view = String(c.sees?.view || "none");
    return m("span", { class: "lib-chips" },
      c.may === "read" ? chip("lock", "Reads only", "is-read", MAY_WORDS.read)
        : c.may === "copy" ? chip("gitBranch", "Runs in its own copy", "is-copy", MAY_WORDS.copy)
          : chip("pencil", "Changes files", "is-edit", `${MAY_WORDS.edit}${c.mayRun?.length ? " · it runs some commands without asking" : ""}`),
      led.length ? chip("crown", `leads ${listed(led)}`, "", `It leads ${listed(led)}`) : null,
      seated.length ? chip("", seated.length > 1 ? `in ${seated.length} teams` : `in ${seated[0]}`, "", `One card, a worker in ${listed(seated)}: a change to it is a change in each`) : null,
      chip(view === "none" ? "eyeOff" : "eye", seesChip(c), "", seesWords(c.sees)),
      fb ? chip("layers", `${prettyModel(fb.model)} for now`, "is-warn", `${prettyModel(fb.passed[0]?.model || "")} cannot run now`)
        : list.length ? chip("layers", list.length > 1 ? `${prettyModel(list[0])}, then ${list.length - 1} more` : prettyModel(list[0]), "", modelWords(c)) : null,
      c.toolsOff?.length ? chip("circleSlash", toolsOffWords(c.toolsOff), "", `It goes without ${listed(toolNames(c.toolsOff))}: switched off on its card`) : null);
  };
  /** @param {any} c */
  const card = (c) => {
    const open = st.open.has(c.tag);
    const place = placeOf(c);
    const problem = st.data.problems?.[c.tag] || null;
    // A plugin's agent is read from its files (B3): no Edit or Delete here — Make a copy to change it.
    const plug = c.plugin ? String(c.plugin) : "";
    // A shipped card's Edit sets it in place, every part of it but its tag (SA1).
    const change = plug ? null : m("button", { class: "sm", type: "button", ...(c.shipped ? { title: "Every part of it, in place: a part you change carries Put back" } : {}), onclick: () => edit("edit", c) }, "Edit");
    const copy = open ? m("button", { class: "sm", type: "button", ...(plug ? { title: "A copy of its card, yours to change, on this page" } : {}), onclick: () => edit("copy", c) }, "Make a copy") : null;
    const del = open && !c.shipped && !plug ? m("button", { class: "sm ghost tset-del", type: "button", "aria-label": `Delete ${c.name}`, onclick: () => void remove(c) }, "Delete") : null;
    const mine = new Set(c.set || []);
    const back = open && c.shipped && mine.size ? m("button", { class: "sm ghost", type: "button", title: `What you changed — ${changedWords(c)} — put back`, onclick: () => void putBackCard(c) }, "Put back as it ships") : null;
    /** A fact's " — changed by you", where that part of a shipped card is yours. @param {string} k */
    const yours = (k) => (mine.has(k) ? m("span", { class: "aset-hint" }, " — changed by you") : null);
    // The face opens the card to its whole, across its row.
    const face = m("button", {
      class: "lib-card-face",
      type: "button",
      "aria-expanded": open ? "true" : "false",
      title: open ? "Fold the card" : "The whole card: how it thinks, what it may do and sees, and who uses it",
      onclick: () => {
        if (!st.open.delete(c.tag)) st.open.add(c.tag);
        paint();
      },
    },
    m("span", { class: "lib-card-head" },
      glyph(cardIcon(c), `team-tile is-sm lib-tile is-${cardTone(c)}`),
      m("span", { class: "lib-card-who" }, m("span", { class: "lib-card-name" }, c.name), m("code", { class: "lib-tag" }, `@${c.tag}`)),
      plug ? m("span", { class: "lib-mark", title: `It comes with the plugin ${plug}: Library › Plugins & Connectors` }, `from ${plug.split("@")[0]}`)
        : !c.shipped ? m("span", { class: "lib-mark" }, "yours")
        : mine.size ? m("span", { class: "lib-mark", title: `It ships with Filament; you changed ${changedWords(c)}` }, "changed by you") : null),
    m("span", { class: "lib-card-line" }, c.goodFor),
    chipsOf(c));
    // The teams it sits in, while teams are on; its quick starts always.
    const usedBy = st.data.usedBy?.[c.tag];
    const used = usedByWords(usedBy && !teamsHere() ? { ...usedBy, teams: [] } : usedBy);
    // Builder and Reviewer are your agent's in every chat: nothing to tick.
    const own = c.shipped && always().includes(c.tag);
    const tick = !own ? m("input", { type: "checkbox", "aria-label": `Your agent may use ${c.name}`, onchange: () => void setAsk(c, !!(/** @type {any} */ (tick)).checked) }) : null;
    if (tick) tick.checked = (st.data.ask || []).includes(c.tag);
    const detail = open
      ? m("div", { class: "tset-detail lib-card-detail" },
        c.moved?.length ? m("p", { class: "aset-hint lib-card-moved", role: "note" }, `Filament's words for ${listed(c.moved.map((/** @type {string} */ k) => CHANGED_WORDS[k] || k))} changed since you changed ${c.moved.length > 1 ? "them" : "it"}: Edit shows Filament's`) : null,
        fact("Thinks", c.thinks ? m("p", { class: "tset-persona" }, c.thinks) : m("span", { class: "aset-hint" }, NO_WORDS), yours("thinks")),
        fact("May do", MAY_WORDS[c.may] || c.may, m("span", { class: "aset-hint" }, " — one ask may lower it, never raise it"), yours("may")),
        c.mayRun?.length ? fact("Runs without asking", ...c.mayRun.map((/** @type {string} */ x) => m("code", { class: "tset-code aset-run" }, x)), m("span", { class: "aset-hint" }, " — in its own copy only"), yours("mayRun")) : null,
        c.toolsOff?.length ? fact("Goes without", listed(toolNames(c.toolsOff)), m("span", { class: "aset-hint" }, " — switched off on its card"), yours("toolsOff")) : null,
        fact("Model", modelWords(c),
          modelsOf(c).length > 1 ? m("span", { class: "aset-hint" }, " — the next takes over where one cannot run, has no room or fails") : null,
          yours("models"),
          c.may === "read" && !modelsOf(c).length ? m("span", { class: "aset-hint" }, " — a different model family from your agent's gives a more independent view") : null),
        fact("Sees", seesWords(c.sees), yours("sees")),
        fact("Asked", `${ASKED_DOES[c.may] || ASKED_DOES.read}; its answer comes to you, and stays with you until you send it on; one your agent asks reports to your agent`),
        plug ? fact("Comes with", `The plugin ${plug}, read from its files: it is asked only in the chats where its plugin is on, on the chat's model. Make a copy to change it.`) : null,
        used ? fact("Used by", used) : null,
        place ? m("p", { class: "aset-place" }, `A copy of ${nameOf(place)}: where your agent may use it, it takes ${nameOf(place)}'s place`) : null,
        c.from && !place ? m("div", { class: "tset-d-foot" }, m("span", { class: "tset-from" }, `A copy of ${nameOf(c.from)}`)) : null,
        m("div", { class: "lib-acts lib-card-more" }, copy, del, back))
      : null;
    const foot = m("div", { class: "lib-card-bar" },
      tick
        ? m("label", { class: "lib-tick" }, tick, "Your agent may use it")
        : own ? m("span", { class: "lib-always", title: "Builder and Reviewer are your agent's in every chat" }, glyph("check", "lib-always-ic"), "Your agent can always use it") : null,
      m("span", { class: "lib-gap" }),
      change);
    const el = m("article", { class: `tset-card lib-card${open ? " is-open" : ""}${problem ? " is-off" : ""}`, "data-tag": c.tag, "aria-label": `${c.name}, @${c.tag}` },
      face,
      problemNote(c),
      detail,
      foot);
    openers.cards.set(c.tag, { card: el, face, edit: change, copy, ask: tick });
    return el;
  };
  /** Why a card cannot run now, or the model it runs on meanwhile; nothing where it runs as it says. @param {any} c */
  const problemNote = (c) => {
    const problem = st.data.problems?.[c.tag] || null;
    const fb = fallbackOf(c);
    return problem
      ? m("p", { class: "aset-problem lib-card-problem", role: "note" }, modelsOf(c).length > 1 ? `${c.name} cannot run now: none of its models can — ${problem}` : `${c.name} cannot run on “${prettyModel(c.model)}” now: ${problem}`)
      : fb
        ? m("p", { class: "aset-hint lib-card-fallback", role: "note" }, `${prettyModel(fb.passed[0]?.model || "")} cannot run now (${fb.passed[0]?.why || ""}): ${c.name} runs on ${prettyModel(fb.model)} meanwhile`)
        : null;
  };
  /**
   * What a seat's card in a pod shows of the card itself — teams.js draws what the team asks of it: its good-for line,
   * how it thinks where its pod is its only home (a team's own Lead, OA-D4), why it cannot run now; and its
   * acts: Edit its card, Make a copy, and on a team of yours Make a copy for this team — the copy seated in its place,
   * that seat alone (`seat`, the member's id; null for the lead's).
   * @param {any} c @param {{ team: any, lead: boolean, seat: string | null }} at
   */
  function seatOwn(c, { team, seat }) {
    const home = !!c.partOf;
    const change = m("button", { class: "sm", type: "button", title: c.shipped ? "Its card, in place: a change to it is a change wherever it works, and Put back gives Filament's again" : "Its card: a change to it is a change in every team that seats it", onclick: () => edit("edit", c, "seat") }, "Edit its card");
    const copy = m("button", { class: "sm", type: "button", title: "A copy of its card, yours to change, on this page", onclick: () => edit("copy", c, "seat") }, "Make a copy");
    const here = team.shipped ? null : m("button", { class: "sm", type: "button", title: `A copy of ${c.name}, yours to change, seated in the ${team.name} team in its place; any other team keeps ${c.name}`, onclick: () => edit("copy", c, "seat", { key: team.key, from: c.tag, seat }) }, "Make a copy for this team");
    openers.seat = { edit: change, copy, here };
    return {
      facts: [
        fact("Good for", c.goodFor),
        home ? fact("Thinks", c.thinks ? m("p", { class: "tset-persona lib-seat-thinks" }, c.thinks) : m("span", { class: "aset-hint" }, NO_WORDS)) : null,
        problemNote(c),
      ].filter(Boolean),
      acts: [change, copy, here].filter(Boolean),
    };
  }

  /** A part's head: its name, how many it holds and what its cards are. @param {string} name @param {number} n @param {string} what */
  const head = (name, n, what) => m("div", { class: "lib-sec-h" }, m("h3", { class: "lib-sec-name" }, name), m("span", { class: "lib-sec-n" }, String(n)), m("span", { class: "lib-quiet" }, what));
  /** A word between backticks set as code. @param {string} line */
  const coded = (line) => line.split("`").map((s, i) => (i % 2 ? m("code", { class: "lib-tag" }, s) : s));
  /**
   * How they are used — in a chat, never from here (team_v2_plan §10 O5, U13-D2): each way where it is done, and the
   * coding agents' own. Behind the head's How to use them, closed until it is pressed (the owner's redesign of 11-09);
   * its × closes it, the keys back on that button.
   */
  const guide = () => {
    const shut = m("button", { class: "ghost icon lib-guide-x", type: "button", "aria-label": "Close how to use them", title: "Close", html: ICONS.x,
      onclick: () => {
        st.guide = false;
        paint();
        openers.guide?.focus({ preventScroll: true });
      } });
    return m("section", { class: "lib-panel lib-guide", id: GUIDE_ID, "aria-label": "How you use them — in a chat" },
      m("div", { class: "lib-panel-h" }, glyph("messageCircle", "team-tile is-sm lib-tile is-blue"), m("h3", { class: "lib-panel-name" }, "How you use them — in a chat"), m("span", { class: "th-sp" }), shut),
      m("div", { class: "lib-where-list", role: "list" },
        ...(teamsHere() ? USES : USES_ALONE).map((w) => m("div", { class: "lib-where-row", role: "listitem" },
          glyph(w.icon, `team-tile is-xs lib-tile is-${w.tone}`),
          m("p", { class: "lib-where-line" }, m("b", {}, w.name), " ", ...coded(w.line))))),
      codingOwn());
  };
  /** The Agents' New agent…, where none of the agents is yours yet. */
  const newTile = () => m("button", { class: "lib-new", type: "button", title: "One card: its tag, its name, how it thinks and what it may do. Saving starts nothing.", onclick: () => edit("new", null) }, glyph("plus", "lib-new-ic"), "New agent…");
  // Every agent shown, as people in a list (team_v2_plan §10 O5): yours first, then the shipped ones; no Show all; with
  // none of yours, New agent… ends them — else it is the head's alone. A team's own Lead lives in its pod (OA-D4).
  // One list, no groups (the owner's word of 10-24: "everything was just an Agent and Teams just referenced those
  // agents"): a card a team seats says so on it, "in 4 teams".
  const agentsList = () => {
    // A plugin's agents after yours (HarnessV4_SpacesPlugins_Plan B3): read from its files, each marked with its plugin.
    const all = [...(st.data.saved || []), ...(st.data.plugins || []), ...(st.data.shipped || [])].filter((c) => !c.partOf);
    openers.add = (st.data.saved || []).length ? null : newTile();
    return m("section", { class: "lib-sec aset-agents", "aria-label": "Agents" },
      head("Agents", all.length, teamsHere() ? "any of them can be asked, lead a team or work in one" : "any of them can be asked"),
      m("div", { class: "lib-grid" }, ...all.map(card)),
      openers.add ? m("div", { class: "lib-new-row" }, openers.add, m("span", { class: "lib-quiet" }, "None of these is yours yet: make one, or Edit one that ships.")) : null,
      heldCards());
  };
  /**
   * Your agents the file keeps that cannot be used now — one under a tag a card that ships holds, one a save would refuse
   * — each with why, Make a copy, which opens the editor on what it holds under a tag of its own, and Delete. Null with
   * none.
   */
  const heldCards = () => {
    /** @type {{ tag: string, name: string, why: string, card: any }[]} */
    const held = st.data.held || [];
    if (!held.length) return null;
    const one = held.length === 1;
    return m("div", { class: "lib-held", role: "list", "aria-label": "Your agents that cannot be used now" },
      m("p", { class: "lib-note-row" }, glyph("info", "lib-note-ic"), `Kept as you saved ${one ? "it" : "them"}, not usable now for the reason on ${one ? "its row" : "each row"}: make ${one ? "it" : "one"} again with Make a copy, under a tag of its own, or delete ${one ? "it" : "one"}.`),
      ...held.map((h) => {
        const copy = m("button", { class: "sm", type: "button", title: "The editor, on what it holds: give it a tag of its own", onclick: () => edit("copy", { ...h.card, name: h.card?.name || h.name, tag: h.tag, kept: true }) }, "Make a copy");
        openers.cards.set(`kept ${h.tag}`, { copy });
        return m("div", { class: "lib-held-row", role: "listitem", "data-tag": h.tag },
          m("span", { class: "lib-held-name" }, `${h.name} (@${h.tag})`),
          m("span", { class: "lib-quiet lib-held-why", title: h.why }, h.why),
          copy,
          m("button", { class: "sm", type: "button", "aria-label": `Delete ${h.name}, kept as saved`, onclick: () => void removeKept(h) }, "Delete"));
      }));
  };
  /** The coding agents' own sub-agents: shown when they run, never kept here — the guide's last word. */
  const codingOwn = () =>
    m("div", { class: "lib-where-row lib-own", role: "note", "aria-label": "Coding agents' own" },
      glyph("squareTerminal", "team-tile is-xs lib-tile is-gray"),
      m("p", { class: "lib-where-line" }, m("b", {}, "Coding agents' own"), " — Claude Code starts sub-agents of its own: general-purpose, Explore, Plan. They show in a chat's Agents tab tagged ",
        m("span", { class: "lib-own-tag" }, "Claude Code's own"), ", with Stop; Filament keeps none of them and cannot change them."));
  /** The page's head: How to use them, which opens the guide, then New agent… and New team…. Saving either starts nothing. */
  const newButtons = () => {
    openers.guide = m("button", { class: `th-link-btn lib-ag-guide${st.guide ? " is-on" : ""}`, type: "button", "aria-expanded": st.guide ? "true" : "false", "aria-controls": GUIDE_ID,
      title: teamsHere() ? "How you ask an agent or send a team, in a chat" : "How you ask an agent, in a chat", onclick: () => { st.guide = !st.guide; paint(); } }, glyph("circleHelp", "th-btn-ic"), "How to use them");
    openers.addAgent = m("button", { class: "th-brief lib-ag-new", type: "button", title: "One card: its tag, its name, how it thinks and what it may do. Saving starts nothing.", onclick: () => edit("new", null, "bar") }, glyph("plus", "th-btn-ic"), "New agent…");
    // New team… while teams are on.
    return [openers.guide, openers.addAgent, teamsHere() ? groups.newButton() : null].filter(Boolean);
  };

  /** @param {any} c */
  async function remove(c) {
    const ok = await ask({
      title: `Delete ${c.name} (@${c.tag})?`,
      description: "Answers it already gave stay in their chats under its name. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    // Focus goes to the card that stood after it, else the one before, as the page was drawn.
    const order = [...openers.cards.keys()];
    const at = order.indexOf(c.tag);
    const near = [...order.slice(at + 1), ...order.slice(0, Math.max(0, at)).reverse()];
    try {
      const r = await call(`/agents/${encodeURIComponent(c.tag)}`, { method: "DELETE" });
      st.data.saved = r.saved;
      st.data.ask = r.ask;
      tookModels(r);
      st.open.delete(c.tag);
      toast(`${c.name} is deleted`);
      paint();
      (near.map((t) => openers.cards.get(t)?.face).find(Boolean) || openers.add || openers.addAgent)?.focus({ preventScroll: true });
      changed();
    } catch (e) {
      toast(errText(e), "err");
    }
  }

  /** One of yours kept as saved, deleted on your word: focus goes to New agent…. @param {{ tag: string, name: string }} h */
  async function removeKept(h) {
    const ok = await ask({
      title: `Delete ${h.name} (@${h.tag})?`,
      description: "It is kept as you saved it, and no chat can use it. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      const r = await call(`/agents/${encodeURIComponent(h.tag)}`, { method: "DELETE" });
      st.data.saved = r.saved;
      st.data.held = r.held;
      tookModels(r);
      toast(`${h.name} is deleted`);
      paint();
      (openers.add || openers.addAgent)?.focus({ preventScroll: true });
      changed();
    } catch (e) {
      toast(errText(e), "err");
    }
  }

  /**
   * A shipped card put back as it ships, every part of it, on the person's word (SA-D2): false where they said no. A
   * refusal is thrown, for the caller to say where it was pressed. @param {any} c @returns {Promise<boolean>}
   */
  async function putBackAll(c) {
    const ok = await ask({
      title: `Put back ${c.name} as it ships?`,
      description: `What you changed of it goes: ${changedWords(c)}. This cannot be undone.`,
      confirmLabel: "Put back",
      destructive: true,
    });
    if (!ok) return false;
    const r = await call(`/agents/${encodeURIComponent(c.tag)}`, { method: "PUT", body: { reset: true } });
    if (r.shipped) st.data.shipped = r.shipped;
    tookModels(r);
    // A team names its lead and crew by their cards: its pod says the name as it ships again.
    await groups.read();
    toast(`${c.name} is as it ships`);
    changed();
    return true;
  }
  /** The card's own Put back as it ships, from its whole: the keys stay on its face. @param {any} c */
  async function putBackCard(c) {
    try {
      if (!(await putBackAll(c))) return;
    } catch (e) {
      toast(errText(e), "err");
      return;
    }
    paint();
    openers.cards.get(c.tag)?.face?.focus({ preventScroll: true });
  }

  // ---- the editor --------------------------------------------------------------------------------------------------
  /**
   * An editor opened in its sheet over the page (editor-sheet.js), the page left where it stood behind it. One already
   * open keeps its place: what it holds is not thrown away unsaved.
   * @param {"new" | "copy" | "edit"} mode @param {any} c
   * @param {"bar" | "seat" | null} [at]  what opened it, for focus to come back to: the head's New agent…, a seat's card
   * @param {{ key: string, from: string, seat: string | null } | null} [team]  a copy's: the team of yours that seats it in
   *   `from`'s place — the seat by its member's id, or null for its lead
   */
  function edit(mode, c, at = null, team = null) {
    if (st.editing || groups.editing()) {
      toast("Save or cancel the editor that is open first");
      return;
    }
    /** @type {Editing} */
    const e = { mode, card: c, top: body.scrollTop, at, team, sheet: null };
    st.editing = e;
    const ed = editor();
    e.refresh = ed.refresh;
    e.sheet = openEditorSheet({ m, dialog: io.dialog, confirm: ask, title: ed.title, tile: ed.tile, sub: ed.sub, body: ed.body, foot: ed.foot, dirty: ed.dirty, onClose: () => { if (st.editing === e) settle(e); } });
    ed.first.focus({ preventScroll: true });
  }
  /**
   * The sheet closed, saved or not: the page drawn again where it stood, focus on what opened the editor, or on the
   * agent a save made, brought into sight; a copy made for a team stays in its pod, the keys on its seat's card.
   * @param {any} [made]
   */
  const close = (made) => {
    const e = st.editing;
    if (!e) return;
    st.editing = null;
    e.sheet?.close(true);
    settle(e, made);
  };
  /** @param {Editing} e @param {any} [made] */
  function settle(e, made) {
    const { mode, card: c, top, at: where, team } = e;
    st.editing = null;
    paint();
    body.scrollTop = top;
    const at = (/** @type {string} */ tag) => openers.cards.get(tag);
    if (made && !team) at(made.tag)?.card?.scrollIntoView({ block: "nearest" });
    const back = made && !team ? at(made.tag)?.edit
      : where === "seat" ? openers.seat?.[made ? "edit" : team ? "here" : mode]
        : mode === "new" ? (where === "bar" ? openers.addAgent : openers.add || openers.addAgent)
          : at(c.kept ? `kept ${c.tag}` : c.tag)?.[mode];
    back?.focus({ preventScroll: true });
  }

  /** The editor of what `st.editing` names, and the field it opens on. */
  function editor() {
    const { mode, card: c, team: forTeam } = /** @type {Editing} */ (st.editing);
    const limits = st.data.limits;
    // A shipped card, set in place (SA1, SA4): each field as it ships — what its Put back gives —, and the fields whose
    // shipped words Filament changed since you changed them.
    const shipped = mode === "edit" && !!c?.shipped;
    const ships = shipped ? { ...c, ...(c.ships || {}) } : null;
    const moved = new Set(shipped ? c.moved || [] : []);
    /** Each field's marks on a shipped card, made once and shown as the editor stands (`paintMarks`). @type {Map<string, ReturnType<typeof shippedMarks>>} */
    const marks = new Map(shipped ? CARD_FIELDS.map((k) => [k, fieldMark(k)]) : []);
    /** A field's "changed" mark and its Put back, where it stands beside the field's name. @param {string} k */
    const mineAt = (k) => marks.get(k)?.slot || null;
    /** A field's line under it: Filament's words for it moved since you changed it. @param {string} k */
    const movedAt = (k) => marks.get(k)?.line || null;
    /** A row's label, with its field's mark on a shipped card. @param {string} text @param {string} k */
    const labelled = (text, k) => (shipped ? m("span", { class: "ed-label-with" }, text, mineAt(k)) : text);
    let busy = false;
    // Esc is the sheet's: it asks before it throws a change away (a page's own keys see it only where no sheet does).
    const keys = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); }
      else if (e.key === "Escape") { e.preventDefault(); st.editing?.sheet?.close(); }
    };
    const typed = () => { paintCount(); mark(); };
    const line = (/** @type {string} */ label, /** @type {string} */ value, /** @type {Record<string, string>} */ more = {}) => {
      const el = m("input", { class: "zc-input tset-input", type: "text", "aria-label": label, autocomplete: "off", spellcheck: "false", oninput: typed, onkeydown: keys, ...more });
      el.value = value;
      return el;
    };
    const tagIn = line("Tag", "", { placeholder: "security", maxlength: String(limits.tag) });
    const nameIn = line("Name", mode === "new" ? "" : c.name);
    const goodIn = line("Good for", mode === "new" ? "" : c.goodFor);
    const thinksIn = m("textarea", { class: "zc-input tset-area", rows: "7", "aria-label": "How it thinks", oninput: typed, onkeydown: keys });
    thinksIn.value = mode === "new" ? "" : c.thinks;
    const thinksHint = m("span", { class: "tset-hint" });
    const thinksCount = m("span", { class: "tset-count" });

    // What it may do: one of three levels, for any agent (one kind of agent, OA1) — whoever asks it, alone or in a team.
    /** @type {string} */
    let may = mode === "new" ? "read" : c.may;
    /** @type {Map<string, HTMLInputElement>} */
    const levels = new Map();
    const levelList = m("div", { class: "aset-levels", role: "radiogroup", "aria-label": "May do" },
      ...(st.data.may || ["read"]).map((/** @type {string} */ id) => {
        const r = m("input", { type: "radio", name: "aset-may", value: id, onchange: () => { may = id; paintLevel(); mark(); } });
        levels.set(id, /** @type {any} */ (r));
        return m("label", { class: "aset-check" }, r, MAY_WORDS[id] || id);
      }));
    const holds = m("p", { class: "tset-hint" }, COPY_HOLDS);
    // What it runs without asking in its own copy (decision 21, AG-267): one command a line; none where it only reads.
    const runsIn = m("textarea", { class: "zc-input tset-area aset-runs", rows: "3", "aria-label": "Runs without asking", spellcheck: "false", placeholder: "npm test", oninput: () => mark(), onkeydown: keys });
    runsIn.value = mode === "new" ? "" : (c.mayRun || []).join("\n");
    const runsBox = m("div", { class: "ed-row is-wide aset-runs-box" }, m("div", { class: "aset-sublabel" }, "Runs without asking", mineAt("mayRun")), m("p", { class: "tset-hint" }, RUNS_HINT), runsIn, movedAt("mayRun"));
    /** The commands as typed: one a line, blanks and repeats left out. */
    const runLines = () => [...new Set(String(runsIn.value).split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];

    // Its models, first choice first (the owner's 10-19 list); none — the chat's list. Each is checked as it is picked:
    // the reason it cannot run an agent now stands under it before Save, and the save is still taken.
    /** @type {string[]} */
    const models = mode === "new" ? [] : [...modelsOf(c)];
    /** How hard it thinks on each: the list's rows' efforts, changed in place. @type {Record<string, string>} */
    const efforts = mode === "new" ? {} : effortsIn(models, c.efforts);
    const modelHint = m("span", { class: "tset-hint" }, "A different model family from your agent's gives a more independent view. ");
    /** What each model's check said: why it cannot run an agent now, or why that could not be checked. @type {Map<string, { problem?: string, unchecked?: string }>} */
    const heard = new Map();
    /** @param {string} name */
    const check = (name) => {
      if (heard.has(name)) return;
      heard.set(name, {});
      call(`/subagents/model-problem?model=${encodeURIComponent(name)}`)
        .then((r) => { heard.set(name, r?.problem ? { problem: String(r.problem) } : {}); list.paint(); })
        .catch((e) => { heard.set(name, { unchecked: errText(e) }); list.paint(); });
    };
    const list = modelList({
      m,
      models,
      most: limits.models || 6,
      catalogue: () => st.catalogue,
      pick: pickModel,
      efforts,
      families: () => st.families,
      none: "Same as the main agent, unless this chat sets its own",
      changed: () => { models.forEach(check); mark(); },
      note: (name, at) => {
        const h = heard.get(name);
        if (h?.unchecked) return m("p", { class: "aset-problem", role: "status" }, m("span", { class: "aset-hint" }, `Whether an agent can run on “${prettyModel(name)}” could not be checked: ${h.unchecked}`));
        if (!h?.problem) return null;
        return m("p", { class: "aset-problem", role: "status" }, `An agent cannot run on “${prettyModel(name)}” now: ${h.problem}`,
          m("span", { class: "aset-hint" }, at < models.length - 1 ? " — it can still be saved; the next on the list runs meanwhile." : " — it can still be saved; its card says this until the model can run one."));
      },
    });
    models.forEach(check);

    // What it sees: a new card what it is asked, alone, until a choice here is made.
    const sees = { ...(mode === "new" ? NEW_SEES : c.sees) };
    const viewIn = m("select", { class: "set-select", "aria-label": "What it sees of the session", onchange: () => { sees.view = viewIn.value; paintRunning(); mark(); } },
      ...SUBAGENT_VIEW_WORDS.filter((v) => (st.data.views || []).includes(v.id)).map((v) => m("option", { value: v.id, ...(v.id === sees.view ? { selected: "" } : {}) }, `${v.name} — ${v.line}`)));
    viewIn.value = sees.view;
    const runningIn = m("input", { class: "ios-switch", type: "checkbox", role: "switch", "aria-label": "And the turn running now", onchange: () => { sees.running = !!runningIn.checked; mark(); } });
    runningIn.checked = !!sees.running;
    // The context window holds the turn running now already: the box says so, and asks nothing.
    const paintRunning = () => {
      const held = sees.view === "window";
      runningIn.disabled = held;
      runningIn.title = held ? "The context window has the turn running now in it" : "";
    };
    paintRunning();
    const changesIn = m("select", { class: "set-select", "aria-label": "And a change, as a patch", onchange: () => { sees.changes = changesIn.value || null; mark(); } },
      m("option", { value: "", ...(sees.changes ? {} : { selected: "" }) }, "none"),
      // The label says "as a patch" already: each choice is the change alone.
      ...(st.data.changes || []).map((/** @type {string} */ id) => m("option", { value: id, ...(id === sees.changes ? { selected: "" } : {}) }, CHANGE_SHORT[id] || CHANGE_WORDS[id] || id)));
    changesIn.value = sees.changes || "";

    // Its tools (SA2): each on unless switched off here. A switch takes a tool away, never gives one (SA-D4); writing
    // files is the level's.
    /** @type {string[]} */
    const toolIds = st.data.tools || Object.keys(TOOL_WORDS);
    /** @type {Set<string>} */
    const off = new Set(mode === "new" ? [] : c.toolsOff || []);
    const tools = toolIds.map((id) => {
      const words = TOOL_WORDS[id] || { name: id, line: "" };
      const sw = /** @type {HTMLInputElement} */ (m("input", { class: "ios-switch", type: "checkbox", role: "switch", "aria-label": words.name, onchange: () => { if (sw.checked) off.delete(id); else off.add(id); mark(); } }));
      const sub = m("span", {});
      return { id, words, sw, sub, row: formRow(m, { label: words.name, sub }, sw) };
    });
    /** The switches as `off` stands, each line as the level says it: one that reads only reads with its shell too. */
    const paintTools = () => {
      for (const t of tools) {
        t.sw.checked = !off.has(t.id);
        t.sub.replaceChildren(may === "read" && t.words.read ? t.words.read : t.words.line);
      }
    };
    // A level raised while how it thinks stays as written: its words may say otherwise (the plan's case 8).
    const raised = m("p", { class: "tset-hint aset-raised", role: "note", hidden: "" });
    const error = m("p", { class: "tset-error", role: "alert" });
    const note = m("p", { class: "tset-why" });
    const save = m("button", { class: "zc-btn zc-btn-v-default", type: "button", onclick: () => void submit() }, "Save");

    /** The levels, and what goes with one that changes anything, as `may` stands. */
    function paintLevel() {
      for (const [id, r] of levels) r.checked = id === may;
      holds.toggleAttribute("hidden", may === "read");
      runsBox.toggleAttribute("hidden", may === "read");
      paintTools();
    }
    thinksHint.replaceChildren("Its own paragraph, or nothing: with nothing it works as your agent would, on what it is asked. Asked by its tag, Filament adds the rest: its verdict or its result first, then its reasons and evidence.");

    const values = () => ({
      tag: String(tagIn.value).trim().replace(/^@/, "").toLowerCase(),
      name: String(nameIn.value).trim(),
      goodFor: String(goodIn.value).trim(),
      thinks: String(thinksIn.value).trim(),
      may,
      models: [...models],
      efforts: effortsIn(models, efforts),
      sees: { view: sees.view, running: !!sees.running, changes: sees.changes || null },
      // One that only reads runs nothing of its own: what the box holds goes with the choice.
      mayRun: may === "read" ? [] : runLines(),
      toolsOff: toolIds.filter((id) => off.has(id)),
    });
    /**
     * An edit's body: only what changed, in the fields' order. A field of a shipped card you had changed, now as it
     * ships again, is sent as null: put back, as the server's log then says it.
     * @param {ReturnType<typeof values>} v
     */
    const changes = (v) => {
      const now = /** @type {Record<string, unknown>} */ (v);
      const diff = Object.fromEntries(CARD_FIELDS.filter((k) => !same(now[k], fieldOf(c, k)))
        .map((k) => [k, shipped && (c.set || []).includes(k) && same(now[k], fieldOf(ships, k)) ? null : now[k]]));
      // Its models go with their efforts: a list of names alone is read as none set.
      const efforts = !same(v.efforts, effortsIn(modelsOf(c), c.efforts)) || ("models" in diff && Object.keys(v.efforts).length);
      return { ...diff, ...(efforts ? { efforts: v.efforts } : {}) };
    };
    /** A new card's body: its efforts only where it names some — its models, names alone, say none. @param {ReturnType<typeof values>} v */
    const made = ({ efforts: e, ...v }) => ({ ...v, ...(Object.keys(e).length ? { efforts: e } : {}) });
    const why = () => {
      const v = values();
      if (mode === "edit" && !Object.keys(changes(v)).length) return "Nothing has changed yet";
      if (mode !== "edit") {
        if (!v.tag) return mode === "copy" ? `A copy of ${c.name} needs a tag of its own: what you will type after @` : "An agent needs a tag: what you type after @";
        if (!TAG.test(v.tag)) return "A tag is 2 to 24 letters, digits and dashes, and starts with a letter";
        const taken = cards().find((x) => x.tag === v.tag);
        if (taken) return `@${v.tag} is taken by ${taken.name}`;
      }
      if (!v.name || !v.goodFor) return "An agent needs a name and what it is good for";
      return null;
    };
    const mark = () => {
      const no = why();
      save.toggleAttribute("disabled", busy || !!no);
      note.replaceChildren(...(no ? [no] : []));
      paintMarks();
      const from = mode === "new" ? "" : String(c.may || "");
      const up = !!from && (MAY_RANK[/** @type {keyof typeof MAY_RANK} */ (may)] ?? 0) > (MAY_RANK[/** @type {keyof typeof MAY_RANK} */ (from)] ?? 0)
        && !!String(c.thinks || "").trim() && String(thinksIn.value).trim() === String(c.thinks || "").trim();
      raised.toggleAttribute("hidden", !up);
      raised.replaceChildren(up ? RAISED[from] || "" : "");
    };
    /** Each field's marks as the editor stands: "changed" while it differs from how it ships, Filament's moved words while it is yours. */
    function paintMarks() {
      if (!shipped) return;
      const now = /** @type {Record<string, unknown>} */ (values());
      for (const [k, x] of marks) x.paint(!same(now[k], fieldOf(ships, k)), moved.has(k));
    }
    /** A field's marks on a shipped card (editor-sheet.js): "changed" and Put back, Filament's moved words. @param {string} k */
    function fieldMark(k) {
      return shippedMarks(m, { label: FIELD_LABELS[k] || k, ships: shipsWords(k), back: () => putBack(k) });
    }
    /** A field as a shipped card ships it, in words: what Show gives. @param {string} k */
    function shipsWords(k) {
      const s = /** @type {any} */ (fieldOf(ships, k));
      return k === "may" ? MAY_WORDS[s] || s
        : k === "models" ? modelWords({ models: s })
          : k === "sees" ? seesWords(s)
              : k === "mayRun" ? (s.length ? s.join(" · ") : "none")
                : k === "toolsOff" ? (s.length ? `Without ${listed(toolNames(s))}` : "Every tool its level gives")
                  : s || NO_WORDS;
    }
    /** A field of a shipped card put back in the editor as it ships; Save keeps it so. The keys go to its control. @param {string} k */
    function putBack(k) {
      const s = /** @type {any} */ (fieldOf(ships, k));
      /** @type {any} */
      let at = null;
      if (k === "name") { nameIn.value = s; at = nameIn; }
      else if (k === "goodFor") { goodIn.value = s; at = goodIn; }
      else if (k === "thinks") { thinksIn.value = s; paintCount(); at = thinksIn; }
      else if (k === "may") { may = s; paintLevel(); at = levels.get(may); }
      else if (k === "models") {
        models.splice(0, models.length, ...s);
        // Its rows' efforts as it ships, with them.
        for (const x of Object.keys(efforts)) delete efforts[x];
        Object.assign(efforts, effortsIn(s, ships?.efforts));
        models.forEach(check);
        list.paint();
        at = list.el.querySelector?.(".model-chip");
      }
      else if (k === "sees") { Object.assign(sees, s); viewIn.value = s.view; runningIn.checked = !!s.running; changesIn.value = s.changes || ""; paintRunning(); at = viewIn; }
      else if (k === "mayRun") { runsIn.value = s.join("\n"); at = runsIn; }
      else if (k === "toolsOff") { off.clear(); for (const id of s) off.add(id); paintTools(); at = tools[0]?.sw; }
      mark();
      at?.focus?.({ preventScroll: true });
    }
    const paintCount = () => {
      const n = String(thinksIn.value).trim().length;
      thinksCount.replaceChildren(`${count(n)} / ${count(limits.thinks)}`);
      thinksCount.classList.toggle("is-near", n >= limits.thinks * NEAR && n <= limits.thinks);
      thinksCount.classList.toggle("is-over", n > limits.thinks);
    };
    async function submit() {
      if (busy || why()) return;
      const v = values();
      busy = true;
      mark();
      error.replaceChildren();
      try {
        const r = mode === "edit"
          ? await call(`/agents/${encodeURIComponent(c.tag)}`, { method: "PUT", body: changes(v) })
          : await call("/agents", { method: "POST", body: mode === "copy" && !c.kept ? { from: c.tag, ...made(v) } : made(v) });
        st.data.saved = r.saved;
        // A card kept under the tag it was saved under gives way to it.
        if (r.held) st.data.held = r.held;
        if (r.shipped) st.data.shipped = r.shipped;
        tookModels(r);
        const a = r.agent;
        // A copy made for a team of yours: the team seats it in its card's place, and who uses each card follows.
        const teamName = forTeam ? groups.teamOf(forTeam.key)?.name || forTeam.key : "";
        /** @type {string | null} */
        let unseated = null;
        if (forTeam) {
          try {
            await groups.swap(forTeam.key, forTeam.from, a.tag, forTeam.seat);
          } catch (e) {
            unseated = errText(e);
          }
          await read();
        }
        // A team names its lead and crew by their cards: the teams are read again before the page is drawn.
        await groups.read();
        if (forTeam && unseated) toast(`${a.name} is saved, but the ${teamName} team could not seat it: ${unseated}`, "err");
        else toast(forTeam
          ? `${a.name} is saved, and sits in the ${teamName} team in ${c.name}'s place`
          : mode === "edit"
            ? `${a.name} is saved`
            : `${a.name} is saved: start a message with @${a.tag} to ask it, or tick “Your agent may use it” for your agent to use it`);
        close(mode === "edit" ? null : a);
        changed();
      } catch (e) {
        busy = false;
        error.replaceChildren(errText(e));
        mark();
      }
    }
    paintLevel();
    paintCount();
    mark();
    /** What a close would throw away: anything that differs from what the editor opened with. */
    const opened = JSON.stringify(values());
    const dirty = () => !busy && JSON.stringify(values()) !== opened;
    const foot = m("div", { class: "ed-foot" },
      error,
      note,
      m("button", { class: "zc-btn zc-btn-v-secondary", type: "button", onclick: () => close() }, "Cancel"),
      save);
    const tile = glyph(cardIcon(c), `team-tile lib-tile ed-tile is-${cardTone(c)}`);
    const refresh = () => list.paint();
    // A shipped card's Put back all: every part of it as it ships, on your word (SA-D2).
    const plain = !(c?.set || []).length;
    const resetAll = shipped
      ? m("button", { class: "sm ghost", type: "button", ...(plain ? { disabled: "" } : {}), title: plain ? "It is as it ships" : "Every part of it as it ships", onclick: () => void putBackWhole() }, "Put back all")
      : null;
    async function putBackWhole() {
      if (busy) return;
      busy = true;
      mark();
      error.replaceChildren();
      try {
        if (await putBackAll(c)) close();
        else {
          busy = false;
          mark();
        }
      } catch (e) {
        busy = false;
        error.replaceChildren(errText(e));
        mark();
      }
    }
    const body = [
      part(m, "", [
        mode === "edit"
          ? formRow(m, { label: "Tag", sub: "It stays: answers already in your chats name it" }, m("code", { class: "tset-code aset-tag" }, `@${c.tag}`))
          : formRow(m, { label: "Tag", sub: "What you type after @" }, tagIn),
        formRow(m, { label: labelled("Name", "name") }, nameIn),
        movedAt("name"),
        formRow(m, { label: labelled("Good for", "goodFor"), sub: "One line: what to use it for" }, goodIn),
        movedAt("goodFor"),
      ], teamsHere() ? "Any agent can be asked, lead a team or work in one." : "Any agent can be asked."),
      part(m, "How it thinks", [m("div", { class: "ed-row is-wide" }, thinksIn, thinksCount), movedAt("thinks")], thinksHint, mineAt("thinks")),
      part(m, "May do", [m("div", { class: "ed-row is-wide" }, levelList, holds, raised), movedAt("may"), runsBox], teamsHere() ? "Whoever asks it, alone or in a team. One ask may lower it, never raise it." : "Whoever asks it. One ask may lower it, never raise it.", mineAt("may")),
      part(m, "Its tools", [...tools.map((t) => t.row), movedAt("toolsOff")],
        "A switch takes a tool away, never gives one: where a chat switches one off, it is off there too. Writing files is its level's — May do. On Claude Code, Codex and Cursor these reach the tools Filament hands them; their own tools follow its level.",
        mineAt("toolsOff")),
      part(m, "Model", [m("div", { class: "ed-row is-wide" }, list.el), movedAt("models")], m("span", {}, modelHint, teamsHere() ? MODELS_HINT : MODELS_HINT_ALONE), mineAt("models")),
      part(m, "Sees", [
        formRow(m, { label: "Of the chat", sub: "One ask or launch can choose otherwise" }, viewIn),
        formRow(m, { label: "And the turn running now" }, runningIn),
        formRow(m, { label: "And the code changes, as a patch" }, changesIn),
        movedAt("sees"),
      ], null, mineAt("sees")),
      shipped ? part(m, "", [formRow(m, { label: "As it ships", sub: plain ? "Nothing of it is changed" : `What you changed of it — ${changedWords(c)} — put back` }, resetAll)]) : null,
    ];
    return {
      title: mode === "new" ? "New agent" : mode === "copy" ? `A copy of ${c.name}` : `Edit ${c.name}`,
      tile,
      sub: mode === "new" ? "Saving starts nothing: you ask it in a chat."
        : mode === "copy" && c.kept ? `Made again from ${c.name}, kept as you saved it: it needs a tag of its own. Saving starts nothing.`
        : mode === "copy" ? `From ${c.name}: it needs a tag of its own. Saving starts nothing.`
          : shipped ? `@${c.tag} ships with Filament: every part of it is yours to change, and Put back gives Filament's again` : `@${c.tag}`,
      body,
      foot,
      dirty,
      first: mode === "edit" ? nameIn : tagIn,
      refresh,
    };
  }

  // ---- the page ----------------------------------------------------------------------------------------------------
  function paint() {
    if (st.failed) {
      acts?.replaceChildren();
      body.replaceChildren(m("div", { class: "tset-failed" },
        m("p", { class: "set-error" }, `The agents could not be read: ${st.failed}`),
        m("button", { class: "sm", type: "button", onclick: () => void load() }, "Try again")));
      return;
    }
    if (!st.data) {
      body.replaceChildren(m("p", { class: "set-note" }, "Loading…"));
      return;
    }
    openers.cards.clear();
    openers.seat = null;
    const news = newButtons();
    if (acts) keepingFocus(acts, () => acts.replaceChildren(...news));
    // The page is drawn again whole — a card opened, a tick, a seat's card — and the control that had the focus is a
    // new node after it: the keyboard's place is put back on the one that sits where it sat.
    // One page (U13-D4), one column (the owner's redesign of 11-09): How to use them where it is open, the Teams, the
    // Agents.
    keepingFocus(body, () => body.replaceChildren(m("div", { class: "lib-ag" },
      acts ? null : m("div", { class: "lib-ag-bar" }, m("span", { class: "lib-gap" }), ...news),
      st.guide ? guide() : null,
      teamsHere() ? groups.squads() : null,
      agentsList())));
  }

  /** The cards, read again: who uses each and whose model cannot run with them. */
  async function read() {
    st.failed = null;
    try {
      st.data = await call("/agents");
    } catch (e) {
      st.failed = errText(e);
    }
  }
  async function load() {
    await Promise.all([read(), groups.read()]);
    paint();
    // Opened on a new agent's or a new team's editor: its sheet over the page, once both are read.
    if (!st.failed && start === "new") edit("new", null);
    if (!st.failed && start === "new-team" && teamsHere()) groups.open();
    if (!st.failed && start === "groups" && teamsHere()) groups.reveal();
  }

  paint();
  void load();
  call("/models?all=1")
    .then((c) => {
      st.catalogue = c?.models || c?.data || [];
      st.families = c?.families || [];
      groups.setModels(st.catalogue, st.families);
      st.editing?.refresh?.();
    })
    .catch(() => {});
}
