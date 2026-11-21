// @ts-check
// The teams and the models of Library › Agents and teams (HarnessV4_Tasks E15 step 6, AG-175; proposal_ux §4.15, phase
// 7; team_v2_plan §10 O5; the owner's pods of 10-20; U13, one page; the owner's redesign of 11-09). Its Teams part: every
// team — an agent leading a crew — as a card in one grid: its glyph, name and badge — Reads only or Changes files, no
// group heading —, its crew a row of chips, its lead first with the crown in the team's glyph and tone, each member with
// what this team asks of it in its tooltip, or one kind of member stacked with "× as many as needed"; those that look and
// check first, then those that build, yours first in each. A crew member is one card, seated in every team that uses
// it: its chip's tooltip names the teams that seat it, and pointing at it lights it in every pod. A seat pressed opens its
// card under the crew: what this team asks of it, what it does and runs on here, the card's own words and its acts
// (agents.js), and on a team of yours "Make a copy for this team", which seats the copy in its place. A pod says what the
// team is for, whether it changes files, and its tick: whether your agent may start it by itself (U13-D9, written whole
// as `PUT /api/subagents/teams`); in chips only what was set apart from the defaults — what happens
// when your agent sends it, what it was duplicated from; in grey what its lead and its crew run on, and how a chat
// starts it; then yours with Edit, Duplicate and Delete, the shipped ones with Edit — every part of it in place, its
// name, lead and crew too, each of those you changed marked with Put back, and Put back all (HarnessV4_ShippedAgents_Plan
// SA4) — and Duplicate. A team is never started
// here: that is the chat's. No list of models and no number stand here (the owner's word of 11-05): an agent runs on its
// card's models, else its chat's, else the main agent's model; a model's limit is set on its provider.
// Beside a chat (team_v2_plan §5.3, §5.5) a team runs its lead on its own model where it names one, read-only where it
// says so, and a main agent's fire of it notifies or verifies by itself where it says so: its card says each, and its
// editor sets them.
// A team may name the models its crew runs on, in order (TV2-D8): its card says them, and the editor sets them. The editor opens in a sheet over the page (editor-sheet.js; the owner's 10-21: "it could have been
// a popup"): a name and a lead, the crew with a name, a line, a model and an effort under each —
// any agent can lead or sit in a crew (U13-D1), a card twice under a name for each seat —, How it
// runs with the team's check, and Your agent, each a group of rows; its foot says why Save waits, or a refusal in the server's words. A
// Duplicate is filled from its team and saves nothing until Save. Esc or × with a change asks first. Closed, the page is
// where it stood, focus on what opened the editor, or on the team a save made. Delete asks first on the sheet. The page (agents.js) hands over its
// cards, and reads them again after a team changed, since who uses a card follows. Built with an injected `h`, `api`,
// model picker and sheet, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { confirmDialog } from "../lib/ui.js";
import { prettyModel } from "../lib/families.js";
import { leadsWords, memberIcon } from "../lib/team.js";
import { listed } from "../lib/agent-cards.js";
import { changesFiles, groupsOf, leadLook, memberLook, usualWay } from "../lib/brief.js";
import { effortName } from "../lib/side.js";
import { effortChip } from "../lib/effort-chip.js";
import { BUGHUNTERS } from "../lib/beside.js";
import { createModelSelect } from "../composer/model.js";
import { toggle } from "../lib/fields.js";
import { effortsIn, modelList } from "./model-list.js";
import { line, openEditorSheet, part, shippedMarks } from "./editor-sheet.js";

/** The share of a limit from which a count says it is near. */
const NEAR = 0.9;
/** @param {number} n */
const count = (n) => n.toLocaleString("en-US");
/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);
/** What a lead's seat says in its tooltip: the crown on it says the rest. */
const LEADS = "It leads: plans the work, hands out the pieces, checks what comes back";
/** What a member's work does to the project's files, by what its card may do. @type {Readonly<Record<string, string>>} */
const DOES = Object.freeze({ read: "changes nothing", copy: "works in its own copy, nothing kept", edit: "changes files" });
/** Each field of a shipped team in a sentence: what of it you changed (SA3). @type {Readonly<Record<string, string>>} */
const CHANGED_WORDS = Object.freeze({ name: "its name", lead: "its lead", members: "its workers", models: "its workers' models", efforts: "how hard its workers think on each", leadModels: "its lead's models", leadEfforts: "how hard its lead thinks on each", readOnly: "read-only on the side", fired: "what happens when your agent sends it", check: "its check" });
/** What a team's check is, under its field in the editor (the plan's p6). */
export const CHECK_DOES = "One command that proves a worker's change sound — every worker that changes files may run it without asking, and Filament runs it when that worker reports.";
/**
 * What runs where a team's list names none, as the server reads it (the review of 11-05): a lead on the side, its card's
 * models, else the main agent's; a crew, each member's card's, else the list of the chat it runs in — its main chat's
 * own, carried along —, else its lead's model. This chat's own rows for the team come before either.
 */
const LEAD_NONE = "Its card's models, else the main agent's — unless this chat sets its own";
const CREW_NONE = "Each worker's card's, else this chat's list, else its lead's model — unless this chat sets its own";
/** What a crew's row with no effort thinks at: its lead's, as the team's chat runs it. */
const CREW_EFFORT = Object.freeze({ level: "", words: "Its lead's", desc: "As its lead thinks, unless the Brief or the team names one for a worker" });
/** A card's grey line's tip: the whole chain its line shortens, a lead's and its workers', as the server reads it. */
const RUNS_CHAIN = "Its lead runs on the team's models where it names any, else its card's, else the chat's model — in charge, always the chat's model. Its workers run on the team's models where it names any, else each worker's card's, else the chat's list, else its lead's model.";
/** A team's lead's models as saved, its one model from before the list read as a list of one. @param {any} t @returns {string[]} */
const leadsOf = (t) => t.leadModels || (t.leadModel ? [t.leadModel] : []);
/** What of a shipped team you changed, in a sentence. @param {any} t */
const changedWords = (t) => listed((t.set || []).map((/** @type {string} */ k) => CHANGED_WORDS[k] || k));
/** Each part of a shipped team as its editor names it, for its Put back. @type {Readonly<Record<string, string>>} */
const TEAM_LABELS = Object.freeze({ name: "Name", lead: "Lead", members: "Workers" });
/**
 * A crew as a save names it: each member by its card, its name where the team gives one, its line, its model and its
 * effort, each only where it has one. @param {{ tag: string, name?: string, line?: string, model?: string, effort?: string }[]} list
 */
const savedCrew = (list) =>
  list.map((x) => ({ tag: String(x.tag), ...(x.name ? { name: String(x.name) } : {}), ...(x.line ? { line: String(x.line) } : {}), ...(x.model ? { model: String(x.model) } : {}), ...(x.effort ? { effort: String(x.effort) } : {}) }));
/** The key a team's name makes, as the store makes it: lower-cased, each run of other characters one dash. @param {unknown} name */
const keyOf = (name) => String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * @typedef {{ body: HTMLElement, cards: () => any[], repaint: () => void, read: () => Promise<void>,
 *   seat: (c: any, at: { team: any, lead: boolean, seat: string | null }) => { facts: any[], acts: any[] } }} AgentsPage
 *   the Agents section that draws this part: its scroll region, its cards (the shipped ones and yours), its paint, its
 *   read of the cards again, and what a seat's card shows of the card itself — its words and its acts
 */

/**
 * @param {AgentsPage} page
 * @param {{ onToast?: (msg: string, kind?: string) => void, onChanged?: () => void }} [cb]
 *   `onChanged`: a team or a list of seats changed
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, modelSelect?: typeof createModelSelect, confirm?: typeof confirmDialog,
 *   dialog?: typeof import("../lib/ui.js").dialog, drawIn?: (host: any, nodes: any[]) => void,
 *   menu?: Parameters<typeof effortChip>[0]["menu"], copy?: (text: string) => Promise<void> }} [io]  `dialog`: what the
 *   editor's sheet opens on; `menu`: what a seat's effort chip opens; `copy`: what a team's `/team` puts on the clipboard
 * @returns {{ read: () => Promise<void>, setModels: (list: any[], families?: any[]) => void, squads: () => any,
 *   newButton: () => any, editing: () => boolean, open: () => void,
 *   reveal: () => void, showSeat: (key: string, tag: string) => void, focusSeat: () => void,
 *   swap: (key: string, from: string, to: string, seat?: string | null) => Promise<void>, count: () => number, teamOf: (key: string) => any }}
 *   `read`: the teams, read again; `squads`: the Teams section as the page draws it; `newButton`: New team…, for
 *   the page's head, null until the teams are read; `editing`: whether an editor is open; `open`: a new team's editor,
 *   once the teams are read; `reveal`: the teams, brought into sight; `showSeat`: a seat's card open, at the next paint; `focusSeat`: the keys on the seat open, brought into
 *   sight; `swap`: a team of yours seats another card in a card's place; `count`: how many teams there are
 */
export function createTeamGroups(page, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const ask = io.confirm || confirmDialog;
  const toast = cb.onToast || (() => {});
  const changed = cb.onChanged || (() => {});
  const copy = io.copy || ((/** @type {string} */ text) => (globalThis.navigator?.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error("Copy failed"))));

  /**
   * The editor open, where the page stood when it opened, its sheet, and what draws its pickers again. `held`: a team of
   * yours the file keeps that cannot be used now, opened on what the file keeps of it.
   * @typedef {{ mode: "new" | "duplicate" | "edit" | "held", team: any, top: number, sheet: { close: (force?: boolean) => void } | null, refresh?: () => void }} Editing
   */
  /** This part's state: what the teams' read said, the cards open, the editor. */
  const st = {
    /** @type {any} */ data: null,
    /** @type {string | null} */ failed: null,
    /** @type {any[]} */ catalogue: [],
    /** The catalogue's families: the efforts each model takes. @type {any[]} */ families: [],
    /** The seat whose card is open: its team's key and its card's tag. @type {null | { key: string, tag: string }} */ seat: null,
    /** @type {Editing | null} */ editing: null,
  };
  /** The list as painted, for focus to come back to: each pod with its Edit and Duplicate by key, each seat, New team. */
  const openers = {
    /** @type {Map<string, Record<string, HTMLElement | null>>} */ cards: new Map(),
    /** Each seat, by its team's key and its card's tag. @type {Map<string, any>} */ seats: new Map(),
    /** @type {HTMLElement | null} */ add: null,
    /** @type {any} */ section: null,
  };

  /** @param {string} name @param {string} [cls] */
  const glyph = (name, cls = "tset-ic") => m("span", { class: cls, "aria-hidden": "true", html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });
  const teams = () => [...(st.data?.saved || []), ...(st.data?.shipped || [])];
  /** A team's name by its key, or the key. @param {string} key */
  const nameOf = (key) => teams().find((t) => t.key === key)?.name || key;
  /** A card by its tag, or null. @param {string} tag */
  const cardOf = (tag) => page.cards().find((c) => c.tag === tag) || null;
  /** A member's card's tag: its `card` where the team names that seat, else its tag. @param {any} x */
  const cardTagOf = (x) => String(x.card || x.tag);
  /**
   * A team's crew as a save names it, from its members as the store hands them out: each by its card; its name where
   * the team gives one — its id is that name's, or it reads apart from its card's —; its line, model and effort.
   * @param {any[]} members
   */
  const crewOf = (members) =>
    savedCrew((members || []).map((/** @type {any} */ x) => ({ tag: cardTagOf(x), name: x.card || x.name !== cardOf(cardTagOf(x))?.name ? x.name : "", line: x.line, model: x.own?.model, effort: x.own?.effort })));
  /** A card's place: the shipped card it is, or was copied from, however many copies back. @param {string} tag @returns {string | null} */
  const placeOf = (tag) => {
    /** @type {Set<string>} */
    const seen = new Set();
    for (let c = cardOf(tag); c && !seen.has(c.tag); c = c.from ? cardOf(c.from) : null) {
      if (c.shipped) return c.tag;
      seen.add(c.tag);
    }
    return null;
  };
  /**
   * The model a member runs on, in words, the first that is set (U13-D8): its team's first (TV2-D8), else its card's,
   * else the list of the chat it runs in — a list is a chat's own (the owner's plan of 11-05) —, else its lead's model.
   * @param {string | null | undefined} model @param {readonly string[]} [teamModels]
   */
  const modelWords = (model, teamModels = []) => {
    if (teamModels.length) return teamModels.length > 1 ? "its team's models" : prettyModel(teamModels[0]);
    return model ? prettyModel(model) : "your chat's list, else its lead's model";
  };
  /**
   * What a pod's lead and workers run on, in grey: a model where the team or its lead's card names one — its lead's on
   * the side, the team's, else its card's (U13-D11); its workers', the team's —, else the shortest true rule, since no
   * chat is in sight here (the rework of 11-11): "Lead: the chat's model · Workers: each one's own, else the lead's".
   * A shipped team's own says it was set by you. The whole chain is the line's tip (`RUNS_CHAIN`).
   * @param {any} t
   */
  const runsWords = (t) => {
    const leads = Array.isArray(t.leadModels) && t.leadModels.length ? t.leadModels : t.leadModel ? [t.leadModel] : [];
    const own = cardOf(String(t.lead?.tag || ""));
    const cardLeads = Array.isArray(own?.models) ? own.models : [];
    const named = Array.isArray(t.models) ? t.models : [];
    const mine = t.shipped ? " — set by you" : "";
    const first = (/** @type {string[]} */ l) => `${prettyModel(l[0])}${l.length > 1 ? `, then ${l.length - 1} more` : ""}`;
    const lead = leads.length ? `${first(leads)} on the side${mine}` : cardLeads.length ? `${first(cardLeads)} on the side — its card's` : "the chat's model";
    const workers = named.length ? `${first(named)}${mine}` : "each one's own, else the lead's";
    return `Lead: ${lead} · Workers: ${workers}`;
  };
  /**
   * What its lead runs on beside a chat, in words: its models, first choice first, and read-only — "Claude Opus 5.5,
   * then GLM 5.3 · read-only: it changes no file".
   * @param {any} t
   */
  const besideWords = (t) => {
    const leads = Array.isArray(t.leadModels) && t.leadModels.length ? t.leadModels : t.leadModel ? [t.leadModel] : [];
    // None of the team's: its card's, as its lead takes them (teams-beside.js; the review of 0376f5a4f).
    const card = cardOf(String(t.lead?.tag || ""));
    const cardLeads = Array.isArray(card?.models) ? card.models : [];
    const on = leads.length ? leads.map((/** @type {string} */ x) => prettyModel(x)).join(", then ") : cardLeads.length ? `${cardLeads.map((/** @type {string} */ x) => prettyModel(x)).join(", then ")} — its card's` : "your chat's model";
    return [on, t.readOnly ? "read-only: it changes no file" : ""].filter(Boolean).join(" · ");
  };
  /**
   * What a main agent's fire of the team does by itself, as a fire does it: BugHunters' own result is checked by none,
   * whatever its switch says (app/teams-beside.js). @param {any} t
   */
  const firedOf = (t) => ({ notify: t.fired?.notify === true, verify: t.fired?.verify === true && t.key !== BUGHUNTERS });
  /** Where its result goes when the main agent sends it, by the team's two switches. @param {any} t */
  const firedWords = (t) => {
    const f = firedOf(t);
    return f.notify && f.verify ? "BugHunters checks its result, then your agent gets it" : f.notify ? "your agent gets its result" : f.verify ? "BugHunters checks its result, then it waits for you" : "its result waits for you";
  };
  /**
   * A Duplicate's name: "<Name> copy", then "copy 2" and on, the first whose key no team holds — as its key or as its
   * name's, yours kept but not usable among them —, cut to the limit before its suffix: the store's own naming.
   * @param {string} name
   */
  const freeName = (name) => {
    const taken = new Set([...teams(), ...(st.data?.held || [])].flatMap((t) => [String(t.key), keyOf(t.name)]));
    for (let n = 1; ; n++) {
      const suffix = ` copy${n > 1 ? ` ${n}` : ""}`;
      const candidate = `${name.slice(0, st.data.limits.name - suffix.length).trimEnd()}${suffix}`;
      if (!taken.has(keyOf(candidate))) return candidate;
    }
  };

  // ---- the teams your agent may start by itself (U13-D9) ----------------------------------------------------------
  /**
   * Their keys as the read or a write last answered them: the config's list as a fire reads it, else BugHunters. A team
   * made, renamed or deleted answers them too, since it can change which team a name on the list is.
   * @returns {string[]}
   */
  const agentTeams = () => (Array.isArray(st.data?.agentTeams) ? st.data.agentTeams : []);
  /**
   * The list written whole, with only the teams that still are: true where it was; a refusal is said.
   * @param {string} key @param {boolean} on
   */
  async function putAgentTeams(key, on) {
    const rest = agentTeams().filter((k) => k !== key && teams().some((x) => x.key === k));
    try {
      st.data.agentTeams = (await call("/subagents/teams", { method: "PUT", body: { teams: on ? [...rest, key] : rest } })).agentTeams;
      return true;
    } catch (e) {
      toast(errText(e), "err");
      return false;
    }
  }
  /** A pod's tick. @param {any} t @param {boolean} on */
  async function setTeam(t, on) {
    if (await putAgentTeams(t.key, on)) {
      toast(on ? `Your agent may send the ${t.name} team by itself, in every chat that chose no list of its own` : `Your agent no longer sends the ${t.name} team by itself`);
      changed();
    }
    page.repaint();
    openers.cards.get(t.key)?.tick?.focus({ preventScroll: true });
  }

  // ---- the teams: pods, in two groups (team_v2_plan §10 O5; the owner's pods of 10-20) ------------------------------
  /**
   * A portrait as the pods draw it; `n`, on a worker's: how many teams seat its card, said where it is more than one.
   * @param {{ icon: string, tone: string }} look @param {string} size @param {boolean} [crown] @param {number} [n]
   */
  const portrait = (look, size, crown = false, n = 0) =>
    m("span", { class: `pf ${size} t-${look.tone}`, "aria-hidden": "true" }, glyph(look.icon, "pf-ic"), crown ? glyph("crown", "pf-crown") : null, n > 1 ? m("span", { class: "pf-num" }, String(n)) : null);
  /** The teams that seat a worker's card, once or more. @param {string} tag  the card's */
  const seatedIn = (tag) => teams().filter((t) => (t.members || []).some((/** @type {any} */ x) => cardTagOf(x) === tag));
  /** Every seat drawn, by its card's tag: pointing at one lights the same card in every pod. @type {Map<string, any[]>} */
  const seatEls = new Map();
  /** @param {string} tag @param {boolean} on */
  const light = (tag, on) => {
    for (const el of seatEls.get(tag) || []) el.classList.toggle("is-same", on);
  };
  /** One fact of a seat's card. @param {string} label @param {any[]} value */
  const fact = (label, ...value) => m("div", { class: "aset-fact" }, m("span", { class: "aset-fact-label" }, label), m("span", { class: "aset-fact-value" }, ...value));
  /**
   * A seat in a pod's crew, a chip: its lead's first, with the crown; a member's with what this team asks of it in its
   * tooltip; one kind of worker, stacked, as many as the work needs. Pressed, its card opens under the crew.
   * @param {any} t @param {any} x  its lead or a member @param {"lead" | "member" | "many"} as
   */
  const seat = (t, x, as) => {
    // A seat by its member's id; its card — what lights in every pod — by the card's tag, where the team names the seat.
    const tag = String(x.tag);
    const lead = as === "lead";
    const card = lead ? tag : cardTagOf(x);
    const on = !!st.seat && st.seat.key === t.key && st.seat.tag === tag;
    const shared = lead ? [] : seatedIn(card);
    const n = shared.length;
    const look = lead ? leadLook(t.key) : memberLook(x);
    // Its tooltip: what this team asks of it, and the teams its one card sits in.
    const said = lead ? LEADS : [x.line ? String(x.line) : "", n > 1 ? `One card, seated in ${n} teams: ${listed(shared.map((s) => s.name))}` : ""].filter(Boolean).join("\n");
    const el = m("button", {
      class: `lib-seat is-${as}${on ? " is-on" : ""}`,
      type: "button",
      "data-seat": tag,
      // A shipped team's lead has no tile of its own (U13-D3): a search for its card lands on its seat.
      ...(lead && t.shipped ? { "data-tag": tag } : {}),
      // The crown says who leads; the keys hear it in words.
      ...(lead ? { "aria-label": `${x.name}, its lead` } : {}),
      "aria-expanded": on ? "true" : "false",
      title: said || (on ? `Fold ${x.name}'s card` : `${x.name}'s card`),
      onclick: () => {
        st.seat = on ? null : { key: t.key, tag };
        page.repaint();
      },
      onmouseenter: () => light(card, true),
      onmouseleave: () => light(card, false),
      onfocus: () => light(card, true),
      onblur: () => light(card, false),
    },
    // No count on a chip's glyph (the owner's of 11-09): it read as that many of the member; its tooltip names the teams.
    as === "many"
      ? m("span", { class: "lib-stack" }, portrait(look, "s24"), portrait(look, "s24"), portrait(look, "s24"))
      : portrait(look, "s24", lead),
    m("span", { class: "lib-seat-who" }, x.name),
    as === "many" ? m("span", { class: "th-mul" }, "× as many as needed") : null);
    seatEls.set(card, [...(seatEls.get(card) || []), el]);
    openers.seats.set(`${t.key} ${tag}`, el);
    return el;
  };
  /**
   * The open seat's card, under its crew: what this team asks of it, what it does and runs on here, whom else it sits
   * with; then the card's own words and acts, the page's.
   * @param {any} t
   */
  const seatCard = (t) => {
    if (!st.seat || st.seat.key !== t.key) return null;
    const tag = st.seat.tag;
    const lead = t.lead.tag === tag;
    const x = lead ? t.lead : (t.members || []).find((/** @type {any} */ y) => y.tag === tag);
    if (!x) return null;
    const card = lead ? tag : cardTagOf(x);
    const c = cardOf(card);
    const shared = lead ? [] : seatedIn(card);
    const own = c ? page.seat(c, { team: t, lead, seat: lead ? null : tag }) : { facts: [], acts: [] };
    const fold = m("button", { class: "ghost icon lib-seat-fold", type: "button", "aria-label": `Fold ${x.name}'s card`, title: "Fold", html: ICONS.x,
      onclick: () => {
        st.seat = null;
        page.repaint();
        openers.seats.get(`${t.key} ${tag}`)?.focus({ preventScroll: true });
      } });
    return m("div", { class: "lib-seat-card", role: "region", "aria-label": `${x.name} in the ${t.name} team` },
      m("div", { class: "lib-seat-card-h" },
        portrait(lead ? leadLook(t.key) : memberLook(x), "s24", lead),
        m("span", { class: "lib-seat-card-name" }, x.name),
        m("code", { class: "lib-tag" }, `@${card}`),
        m("span", { class: "th-sp" }),
        fold),
      m("div", { class: "tset-detail lib-seat-detail" },
        ...(lead
          ? [fact("Here", "it leads: plans the work, hands the pieces to its workers, checks what comes back — and can do any of it itself"), fact("Runs on", besideWords(t))]
          : [fact("Here", x.line ? String(x.line) : m("span", { class: "aset-hint" }, "Nothing beyond the words on its card")), fact("Does", `${DOES[x.may] || x.may} · ${x.own?.model ? prettyModel(x.own.model) : modelWords(x.model, t.models || [])}${x.own?.effort ? ` at ${effortName(x.own.effort).toLowerCase()}` : ""}`)]),
        ...own.facts,
        shared.length > 1 ? m("p", { class: "aset-hint lib-seat-shared" }, `One card in ${shared.length} teams — ${listed(shared.map((s) => s.name))}: a change to it is a change in each.`) : null,
        c ? null : m("p", { class: "aset-problem" }, "Its card is gone: Edit the team to seat another.")),
      own.acts.length ? m("div", { class: "lib-acts lib-seat-acts" }, ...own.acts) : null);
  };
  /**
   * What a team was set apart from the defaults, in chips: its check, what happens when your
   * agent sends it, what it was duplicated from — its models are its grey line's. None where it is as the defaults say.
   * @param {any} t
   */
  const chips = (t) => {
    const f = firedOf(t);
    const said = [
      t.check ? `Its check: ${t.check}` : "",
      f.notify || f.verify ? `Sent by your agent: ${firedWords(t)}` : "",
      t.from ? `Duplicated from ${nameOf(t.from)}` : "",
    ].filter(Boolean);
    return said.length ? m("div", { class: "lib-pod-chips" }, ...said.map((s) => m("span", { class: "lib-pod-chip" }, s))) : null;
  };
  /**
   * A team's crew, a row of chips: the lead first, then each member; one kind of worker stacked, as many as needed.
   * @param {any} t
   */
  const crewRow = (t) => {
    const members = Array.isArray(t.members) ? t.members : [];
    const alone = members.length === 1;
    return m("div", { class: "lib-crew", role: "group", "aria-label": `The ${t.name} team's lead and workers` },
      seat(t, t.lead, "lead"),
      ...(alone ? [seat(t, members[0], "many")] : members.map((/** @type {any} */ x) => seat(t, x, "member"))));
  };
  /**
   * A team's Edit, Duplicate and its tick — whether your agent may start it by itself (U13-D9), the same tick as on an
   * agent's card —, kept for focus to come back to.
   * @param {any} t
   */
  const actsOf = (t) => {
    const duplicate = m("button", { class: "sm", type: "button", onclick: () => edit("duplicate", t) }, "Duplicate");
    const change = m("button", { class: "sm", type: "button", title: t.shipped ? "Every part of it, in place: a part you change carries Put back" : "Its name, lead, workers and how it runs", onclick: () => edit("edit", t) }, "Edit");
    const tick = m("input", { type: "checkbox", "aria-label": `Your agent may use the ${t.name} team`, onchange: () => void setTeam(t, !!(/** @type {any} */ (tick)).checked) });
    /** @type {any} */ (tick).checked = agentTeams().includes(t.key);
    return { change, duplicate, tick };
  };
  /** A shipped team's "changed by you", or "yours" on one of yours. @param {any} t */
  const markOf = (t) => (t.shipped ? (t.tuned ? m("span", { class: "lib-mark", title: `It ships with Filament; you changed ${changedWords(t)}` }, "changed by you") : null) : m("span", { class: "lib-mark" }, "yours"));
  /**
   * How a chat starts it, at its foot: what a chat's message box takes, pressed to copy it, by the team's usual way
   * (lib/brief.js `usualWay`; d-side, 11-12: a team that changes no file is never sent in charge by default) — its
   * command, which puts a team that builds in charge; `@` and its key for one that looks and checks, where Enter
   * opens its Brief, on the side —; the way through the chat's Agents tab in its tooltip. @param {any} t
   */
  const startWords = (t) => {
    const side = usualWay(t) === "side";
    const command = side ? `@${t.key}` : `/team ${t.key}`;
    return m("button", {
      class: "lib-pod-start",
      type: "button",
      title: `Copy ${command}${side ? ": in a chat's message box, Enter opens its Brief, on the side" : ""}. Or send it from a chat: Agents › Start… › ${t.name} › On the side or In charge`,
      onclick: () => void copy(command).then(
        () => toast(`Copied ${command} — paste it in a chat to ${side ? "brief the team on the side" : "put the team in charge"}`),
        // The browser's refusal is in its own words ("Document is not focused"): what to do instead is said.
        () => toast(`${command} was not copied: type it in a chat's message box instead`, "err")),
    }, m("code", {}, command), glyph("copy", "lib-pod-start-ic"));
  };
  /** @param {any} t */
  const card = (t) => {
    const { change, duplicate, tick } = actsOf(t);
    const acts = t.shipped
      ? [change, duplicate]
      : [change, duplicate, m("button", { class: "sm ghost tset-del", type: "button", "aria-label": `Delete the ${t.name} team`, onclick: () => void remove(t) }, "Delete")];
    const builds = changesFiles(t);
    // Its glyph is its lead's, without the crown: the crew's first chip wears that. Five parts, each always there — its
    // head, its line, its body (its crew, a seat's card, its chips), what it runs on, its foot —: the cards of a row line
    // up part by part (library.css), the body taking the room a taller neighbour leaves.
    const el = m("article", { class: `tset-card lib-team lib-pod ${builds ? "is-build" : "is-look"}${st.seat?.key === t.key ? " is-open" : ""}`, "data-key": t.key, "aria-label": `${t.name} team` },
      m("div", { class: "lib-pod-h" },
        portrait(leadLook(t.key), "s32"),
        m("span", { class: "lib-pod-who" },
          m("span", { class: "lib-team-name" }, t.name, markOf(t)),
          m("span", { class: `th-tag ${builds ? "is-ed" : "is-ro"}` }, glyph(builds ? "pencil" : "lock", "th-tag-ic"), builds ? "Changes files" : "Reads only")),
        m("label", { class: "lib-tick lib-pod-tick" }, tick, "Your agent may use it")),
      m("p", { class: "lib-pod-line", ...(t.line ? { title: String(t.line) } : {}) }, ...(t.line ? [String(t.line)] : [])),
      m("div", { class: "lib-pod-body" }, crewRow(t), seatCard(t), chips(t)),
      m("p", { class: "lib-pod-runs", title: RUNS_CHAIN }, runsWords(t)),
      m("div", { class: "th-sq-foot lib-sq-foot" },
        startWords(t),
        m("span", { class: "th-sp" }),
        m("div", { class: "lib-acts" }, ...acts)));
    openers.cards.set(t.key, { card: el, edit: change, duplicate, tick });
    return el;
  };

  /** A part's head: its name, how many it holds and what they are. @param {string} name @param {number} n @param {string} what */
  const head = (name, n, what) => m("div", { class: "lib-sec-h" }, m("h3", { class: "lib-sec-name" }, name), m("span", { class: "lib-sec-n" }, String(n)), m("span", { class: "lib-quiet" }, what));
  /**
   * The Teams section (team_v2_plan §10 O5; the owner's pods of 10-20; U13-D3, D4): every team as a card in one grid —
   * those that look and check, then those that build, yours first in each; its badge says which. Under them, what a
   * seat is.
   */
  const squads = () => {
    openers.cards.clear();
    openers.seats.clear();
    seatEls.clear();
    if (st.failed)
      openers.section = m("section", { class: "lib-sec aset-groups", "aria-label": "Teams" },
        m("div", { class: "tset-failed" },
          m("p", { class: "set-error" }, `The teams could not be read: ${st.failed}`),
          m("button", { class: "sm", type: "button", onclick: () => void read().then(() => page.repaint()) }, "Try again")));
    else if (!st.data) openers.section = m("section", { class: "lib-sec aset-groups", "aria-label": "Teams" }, m("p", { class: "set-note" }, "Loading…"));
    else {
      const g = groupsOf(teams());
      openers.section = m("section", { class: "lib-sec aset-groups", "aria-label": "Teams" },
        head("Teams", teams().length, "a lead and its workers"),
        m("div", { class: "lib-pod-grid" }, ...[...g.look, ...g.build].map(card)),
        heldTeams(),
        m("p", { class: "lib-note-row" }, glyph("info", "lib-note-ic"), "Press a lead or a worker for its card. One card can sit in several teams: a change to it is a change in each."));
    }
    return openers.section;
  };
  /**
   * Your teams the file keeps that cannot be used now — one naming an agent that is gone — each with why, its Edit and
   * its Delete: kept as saved, so what its row names put right in its editor brings the team back. Its note does not
   * offer the agent's coming back: a card under a name the shipped crews seat (Scout, Tester, Hunter, Checker) is
   * refused (agent-cards.js `memberNamed`). One held under a shipped team's key has no Edit: that key is the shipped
   * team's. Null with none.
   */
  const heldTeams = () => {
    /** @type {{ key: string, name: string, why: string, team?: any }[]} */
    const held = st.data?.held || [];
    if (!held.length) return null;
    const one = held.length === 1;
    const shippedKeys = new Set((st.data?.shipped || []).map((/** @type {any} */ t) => t.key));
    return m("div", { class: "lib-held", role: "list", "aria-label": "Your teams that cannot be used now" },
      m("p", { class: "lib-note-row" }, glyph("info", "lib-note-ic"), `Kept as you saved ${one ? "it" : "them"}, not usable now for the reason on ${one ? "its row" : "each row"}: put that right in ${one ? "its" : "a team's"} Edit and it is usable again, or delete ${one ? "it" : "one"}.`),
      ...held.map((h) => {
        const change = h.team && !shippedKeys.has(h.key) ? m("button", { class: "sm", type: "button", "aria-label": `Edit the ${h.name} team`, onclick: () => edit("held", { ...h.team, why: h.why }) }, "Edit") : null;
        if (change) openers.cards.set(h.key, { held: change });
        return m("div", { class: "lib-held-row", role: "listitem", "data-held": h.key },
          m("span", { class: "lib-held-name" }, h.name),
          m("span", { class: "lib-quiet lib-held-why", title: h.why }, h.why),
          change,
          m("button", { class: "sm", type: "button", onclick: () => void remove(h) }, "Delete"));
      }));
  };
  /** New team…, for the page's head: kept, for focus to come back to. Null until the teams are read. */
  const newButton = () => {
    openers.add = st.data ? m("button", { class: "th-brief is-primary lib-ag-new", type: "button", title: "An agent to lead, its workers, and what the team asks of each. Saving starts nothing.", onclick: () => edit("new", null) }, glyph("plus", "th-btn-ic"), "New team…") : null;
    return openers.add;
  };
  /**
   * A team of yours seats another card in a card's place: its lead (`seat` null), or the one seat of a member by its id
   * (`seat`), whose name, line, model and effort it keeps — another seat of the same card keeps that card. The seat
   * stays open: by its id still where the team names it, else as the new card's.
   * @param {string} key @param {string} from @param {string} to @param {string | null} [seat]  the member's id
   */
  async function swap(key, from, to, seat = null) {
    const t = teams().find((x) => x.key === key);
    if (!t) throw new Error(`No team answers to ${key}`);
    const at = seat == null ? null : t.members.find((/** @type {any} */ x) => x.tag === seat);
    if (seat != null && (!at || cardTagOf(at) !== from)) throw new Error(`The ${t.name} team has no seat ${seat} of ${from}`);
    const crew = crewOf(t.members);
    const body = at ? { members: crew.map((x, i) => (t.members[i] === at ? { ...x, tag: to } : x)) } : { lead: to };
    const r = await call(`/teams/${encodeURIComponent(key)}`, { method: "PUT", body });
    st.data.saved = r.saved;
    st.seat = { key, tag: at?.card ? String(at.tag) : to };
    changed();
  }

  /** @param {any} t */
  async function remove(t) {
    const ok = await ask({
      title: `Delete the ${t.name} team?`,
      description: "Sessions it leads keep its name, and are told on their next turn that no team answers to it. Its lead's and its workers' cards stay. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      const r = await call(`/teams/${encodeURIComponent(t.key)}`, { method: "DELETE" });
      st.data.saved = r.saved;
      st.data.held = r.held;
      st.data.agentTeams = r.agentTeams;
      if (st.seat?.key === t.key) st.seat = null;
      toast(`The ${t.name} team is deleted`);
      await page.read();
      page.repaint();
      // Its pod is gone: focus goes to New team, at the page's head.
      /** @type {HTMLElement | null} */ (openers.add)?.focus({ preventScroll: true });
      changed();
    } catch (e) {
      toast(errText(e), "err");
    }
  }

  // ---- the editor --------------------------------------------------------------------------------------------------
  /**
   * The editor opened in its sheet over the page (editor-sheet.js), the page left where it stood behind it.
   * @param {"new" | "duplicate" | "edit" | "held"} mode @param {any} team
   */
  function edit(mode, team) {
    if (st.editing || !st.data) return;
    /** @type {Editing} */
    const e = { mode, team, top: page.body.scrollTop, sheet: null };
    st.editing = e;
    const ed = editor();
    e.refresh = ed.refresh;
    e.sheet = openEditorSheet({ m, dialog: io.dialog, confirm: ask, title: ed.title, tile: ed.tile, sub: ed.sub, body: ed.body, foot: ed.foot, dirty: ed.dirty, onClose: () => { if (st.editing === e) settle(e); } });
    ed.first.focus({ preventScroll: true });
  }
  /**
   * The sheet closed, saved or not: the page drawn again where it stood, focus on what opened the editor; after a save
   * that made a team, that team's pod is brought into sight, focus on its Edit.
   * @param {any} [made]  the team a save made
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
    st.editing = null;
    page.repaint();
    page.body.scrollTop = e.top;
    const at = (/** @type {string} */ key) => /** @type {Record<string, HTMLElement> | undefined} */ (openers.cards.get(key));
    if (made) at(made.key)?.card.scrollIntoView?.({ block: "nearest" });
    const back = made ? at(made.key)?.edit : e.mode === "new" ? openers.add : at(e.team.key)?.[e.mode];
    back?.focus({ preventScroll: true });
  }

  /** The editor of what `st.editing` names, and the field it opens on. */
  function editor() {
    const { mode, team } = /** @type {{ mode: "new" | "duplicate" | "edit" | "held", team: any }} */ (st.editing);
    // A team held opens on what the file keeps (teams.js `heldTeam`): its lead and its members as saved, one whose card
    // is gone with the words that say which card to pick.
    const held = mode === "held";
    const limits = st.data.limits;
    // A team that ships, set in place (SA3, SA4): its name, lead and crew as it ships — what their Put back gives —, and
    // those whose shipped words Filament changed since you changed them.
    const shipped = mode === "edit" && team.shipped === true;
    /** @type {{ name: string, lead: string, members: ReturnType<typeof savedCrew> } | null} */
    const ships = shipped ? { name: String(team.ships?.name ?? team.name), lead: String(team.ships?.lead?.tag ?? team.lead.tag), members: team.ships?.members ? savedCrew(team.ships.members) : crewOf(team.members) } : null;
    const moved = new Set(shipped ? team.moved || [] : []);
    /** Each of those parts' marks (editor-sheet.js), made once and shown as the editor stands. @type {Map<string, ReturnType<typeof shippedMarks>>} */
    const marks = new Map(shipped ? ["name", "lead", "members"].map((k) => [k, shippedMarks(m, { label: TEAM_LABELS[k], ships: shipsWords(k), back: () => putBack(k) })]) : []);
    /** A part's "changed" and Put back, beside its name. @param {string} k */
    const mineAt = (k) => marks.get(k)?.slot || null;
    /** A part's line under it: Filament's words for it moved since. @param {string} k */
    const movedAt = (k) => marks.get(k)?.line || null;
    /** A row's label, with its part's mark on a shipped team. @param {string} text @param {string} k */
    const labelled = (text, k) => (shipped ? m("span", { class: "ed-label-with" }, text, mineAt(k)) : text);
    let busy = false;
    // Esc is the sheet's: it asks before it throws a change away (a page's own keys see it only where no sheet does).
    const keys = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); }
      else if (e.key === "Escape") { e.preventDefault(); st.editing?.sheet?.close(); }
    };
    const typed = () => { paintCounts(); mark(); };
    const nameIn = m("input", { class: "zc-input tset-input", type: "text", "aria-label": "Name", autocomplete: "off", spellcheck: "false", oninput: typed, onkeydown: keys });
    nameIn.value = mode === "new" ? "" : mode === "duplicate" ? freeName(team.name) : team.name;

    // Its lead: any agent's card, yours or one that ships (U13-D1); not another team's own Lead (OA-D4) — but the one this team has now, and on a
    // team that ships, the one it ships with, for its Put back.
    let lead = mode === "new" ? "" : held ? (cardOf(team.lead) ? String(team.lead) : "") : String(team.lead.tag);
    /** A held team's lead whose card is gone: the words that say which card to pick. */
    const leadGone = held ? team.leadGone || null : null;
    const leads = page.cards().filter((c) => !c.partOf || c.tag === lead || c.tag === ships?.lead);
    const leadLine = m("span", { class: "aset-lead-line" });
    const leadIn = m("select", { class: "set-select", "aria-label": "Lead", onchange: () => { lead = String(leadIn.value); paintLead(); mark(); } },
      ...(lead ? [] : [m("option", { value: "", selected: "" }, "Pick a lead…")]),
      ...leads.map((c) => m("option", { value: c.tag, ...(c.tag === lead ? { selected: "" } : {}) }, `${c.name} (@${c.tag})`)));
    leadIn.value = lead;
    const paintLead = () => leadLine.replaceChildren(...(cardOf(lead)?.goodFor ? [cardOf(lead).goodFor] : !lead && leadGone ? [leadGone] : []));

    // Its check (the plan's p6): one command line, given to every member that changes files, up to the read's limit.
    const checkMost = Number(limits.check) || 400;
    const checkIn = m("input", { class: "zc-input tset-input tset-check", type: "text", "aria-label": "Check", placeholder: "npm test", autocomplete: "off", spellcheck: "false", oninput: typed, onkeydown: keys });
    checkIn.value = mode === "new" ? "" : String(team.check || "");
    const checkCount = m("span", { class: "tset-count" });

    // Its crew: any agent's card, with what this team asks of it (U13-D1); a card twice,
    // each seat under a name of its own. Each member may run on a model and at an effort of its own — the model picker
    // the agent's editor uses, one model; the effort words a Brief uses.
    const pick = io.modelSelect || createModelSelect;
    /** @typedef {{ tag: string, nameIn: any, input: any, count: any, does: any, models: string[], list: { el: any, paint: () => void }, effort: { el: any, value: () => string }, gone?: string }} MemberRow */
    /** @type {MemberRow[]} */
    const rows = [];
    /** A row's head says what its member does and what it runs on: its own model, else its card's, else the list. @param {MemberRow} r */
    const paintDoes = (r) => {
      const c = cardOf(r.tag);
      r.does.replaceChildren(`${DOES[c?.may] || "its card is gone"} · ${r.models.length ? prettyModel(r.models[0]) : modelWords(c?.model)}`);
    };
    /** @param {{ tag: string, name?: string, line?: string, model?: string, effort?: string, gone?: string }} x @returns {MemberRow} */
    const addRow = (x) => {
      const tag = String(x.tag);
      const name = cardOf(tag)?.name || tag;
      const nameIn = m("input", { class: "zc-input tset-input tset-member-name", type: "text", "aria-label": `This team's name for ${name}`, placeholder: `${name} — name it to seat ${name} twice`, autocomplete: "off", spellcheck: "false", oninput: typed, onkeydown: keys });
      nameIn.value = String(x.name || "");
      const input = m("textarea", { class: "zc-input tset-area is-role", rows: "2", "aria-label": `What this team asks of ${name}`, placeholder: "What this team asks of it", oninput: typed, onkeydown: keys });
      input.value = String(x.line || "");
      /** @type {string[]} */
      const models = x.model ? [String(x.model)] : [];
      const list = modelList({ m, models, most: 1, catalogue: () => st.catalogue || [], pick, changed: () => { paintDoes(r); mark(); }, add: "", first: "", none: "The Brief's pick, else the team's for its workers, else its card's", cls: "tset-member-model" });
      // How hard it thinks beside its model, on the agents' chip as the lead's and the crew's rows have it (the owner's
      // of 11-06: never a list of names): the levels its model takes, and "The model's own".
      const effort = effortChip({
        label: `How hard ${name} thinks in this team`,
        value: String(x.effort || ""),
        onChange: () => mark(),
        model: () => models[0] || "",
        families: () => st.families || [],
        inherit: () => ({ level: "", words: "The Brief's, else the chat's", desc: "Where none is picked here: as the Brief says, else as the chat's agent thinks" }),
        mk: m,
        ...(io.menu ? { menu: io.menu } : {}),
      });
      /** @type {MemberRow} */
      const r = { tag, nameIn, input, count: m("span", { class: "tset-count" }), does: m("span", { class: "tset-erole-does" }), models, list, effort, ...(x.gone ? { gone: x.gone } : {}) };
      paintDoes(r);
      rows.push(r);
      return r;
    };
    /**
     * A member whose card is gone seated as another card, in its place: its name, line, model and effort kept; the keys
     * go to its line. @param {MemberRow} r @param {string} tag
     */
    const reseat = (r, tag) => {
      const at = rows.indexOf(r);
      const next = addRow({ tag, name: String(r.nameIn.value), line: String(r.input.value), model: r.models[0], effort: r.effort.value() });
      rows.splice(rows.indexOf(next), 1);
      rows.splice(at, 1, next);
      paintMembers();
      typed();
      next.input.focus({ preventScroll: true });
    };
    if (held) for (const x of team.members) addRow(x);
    else if (mode !== "new") for (const x of crewOf(team.members)) addRow(x);
    const membersEl = m("div", { class: "aset-members" });
    const fullNote = m("p", { class: "tset-hint" });
    const addIn = m("select", {
      class: "set-select",
      "aria-label": "Add a worker",
      onchange: () => {
        const tag = String(addIn.value);
        if (!tag) return;
        const r = addRow({ tag });
        paintMembers();
        typed();
        // A card seated twice is told apart by its name: the keys go there.
        (rows.filter((x) => x.tag === tag).length > 1 ? r.nameIn : r.input).focus({ preventScroll: true });
      },
    });
    /**
     * A member whose card is gone, on a team held: the words that say which card does its work, and the pick of a card
     * to seat in its place. None for a member whose card is there. @param {MemberRow} r
     */
    const goneParts = (r) => {
      if (cardOf(r.tag)) return [];
      const seatIn = m("select", { class: "set-select tset-reseat", "aria-label": `A card in place of @${r.tag}`, onchange: () => { if (seatIn.value) reseat(r, String(seatIn.value)); } },
        m("option", { value: "", selected: "" }, "Seat a card…"),
        ...page.cards().filter((c) => !c.partOf).map((c) => m("option", { value: c.tag }, `${c.name} (@${c.tag})`)));
      return [m("p", { class: "tset-hint tset-gone", role: "note" }, r.gone || `There is no agent @${r.tag}: seat another card in its place`), seatIn];
    };
    /** @param {MemberRow} r */
    const memberRow = (r) => {
      const c = cardOf(r.tag);
      const name = c?.name || r.tag;
      return m("div", { class: "ed-row is-wide tset-erole", "data-member": r.tag },
        m("div", { class: "tset-erole-head" },
          glyph(memberIcon({ may: c?.may, place: placeOf(r.tag) }), "role-tile is-sm"),
          m("span", { class: "tset-erole-word" }, name),
          r.does,
          m("button", {
            class: "sm ghost tset-del aset-out",
            type: "button",
            "aria-label": `Take ${String(r.nameIn.value || "").trim() || name} out of the team`,
            onclick: () => {
              rows.splice(rows.indexOf(r), 1);
              paintMembers();
              typed();
              addIn.focus({ preventScroll: true });
            },
          }, "Take out")),
        ...goneParts(r),
        r.nameIn,
        r.input,
        r.count,
        m("div", { class: "tset-member-runs" }, m("span", { class: "tset-hint" }, "Runs on"), r.list.el, m("span", { class: "tset-hint" }, "at"), r.effort.el));
    };
    function paintMembers() {
      membersEl.replaceChildren(...rows.map(memberRow));
      // A card already seated is offered again: a second seat of it takes a name of its own.
      const free = page.cards().filter((c) => !c.partOf);
      addIn.replaceChildren(m("option", { value: "", selected: "" }, "Add a worker…"), ...free.map((c) => m("option", { value: c.tag }, `${c.name} (@${c.tag})`)));
      addIn.value = "";
      const full = rows.length >= limits.members;
      addIn.toggleAttribute("hidden", full || !free.length);
      // The shipped agents alone outnumber a crew's limit: what stops an add is the limit.
      fullNote.replaceChildren(...(full ? [`A team has up to ${limits.members} workers.`] : []));
    }

    // How it runs (team_v2_plan TV2-D8, §5.3, §5.5; U13-D15): read-only on the side; its lead's models there and its
    // crew's, each first choice first with backups — none picked, your chat's model and your chat's list —; and
    // whether your agent may use it, with what happens to its result then.
    let readOnly = mode === "new" ? false : team.readOnly === true;
    /** @type {string[]} */
    const leadModels = mode === "new" ? [] : [...leadsOf(team)];
    /** How hard its lead thinks on each, and its crew: each list's rows' efforts, changed in place (the owner's of 11-05). */
    const leadEfforts = mode === "new" ? {} : effortsIn(leadModels, team.leadEfforts);
    const leadList = modelList({ m, models: leadModels, efforts: leadEfforts, families: () => st.families, most: limits.models || 6, catalogue: () => st.catalogue || [], pick, changed: () => mark(), add: "", first: "", none: LEAD_NONE, next: "Add a backup", cls: "tset-lead-model" });
    const leadModelEl = leadList.el;
    /** @type {string[]} */
    const models = mode === "new" ? [] : [...(team.models || [])];
    const efforts = mode === "new" ? {} : effortsIn(models, team.efforts);
    const crewList = modelList({ m, models, efforts, families: () => st.families, most: limits.models || 6, catalogue: () => st.catalogue || [], pick, changed: () => mark(), add: "", first: "", none: CREW_NONE, inherit: () => CREW_EFFORT, next: "Add a backup", cls: "tset-crew-model" });
    const modelsEl = crewList.el;
    const fired = { notify: mode !== "new" && team.fired?.notify === true, verify: mode !== "new" && team.fired?.verify === true };
    /** Whether your agent may use it (U13-D9), every chat's list: a new team and a Duplicate start without. */
    const startWas = (mode === "edit" || held) && agentTeams().includes(team.key);
    let start = startWas;
    /**
     * A row with its switch, turned in place so the keys stay on it. `aria`: the switch's own name, whole.
     * @param {{ label: string, sub?: string, aria: string }} o @param {boolean} on @param {(v: boolean) => void} set
     */
    const switchRow = (o, on, set) => {
      const b = toggle(m, on, o.aria, () => {
        on = !on;
        set(on);
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
        mark();
      });
      return line(m, { label: o.label, sub: o.sub, cls: "is-switch" }, b);
    };
    const readOnlyRow = switchRow({ label: "Read-only on the side", sub: "Neither its lead nor its workers change a file", aria: "Read-only on the side: neither its lead nor its workers change a file" }, readOnly, (v) => { readOnly = v; });
    const startRow = switchRow({ label: "May use it", sub: "Send it by itself, in every chat that lets it", aria: "Your agent may use it" }, start, (v) => { start = v; });
    // What your agent's start of it does by itself, in every chat that lets it — one with a list of its own too.
    const notifyRow = switchRow({ label: "Gets the result when it finishes", sub: "When your agent sends it", aria: "Give your agent the result when it finishes" }, fired.notify, (v) => { fired.notify = v; });
    // BugHunters checks a result first; its own is checked by none, so it has no such switch.
    const verifyRow = mode === "edit" && team.key === BUGHUNTERS ? null : switchRow({ label: "BugHunters checks it first", sub: "Before the result goes anywhere", aria: "Have BugHunters check it first" }, fired.verify, (v) => { fired.verify = v; });

    const error = m("p", { class: "tset-error", role: "alert" });
    const note = m("p", { class: "tset-why" });
    const save = m("button", { class: "zc-btn zc-btn-v-default", type: "button", onclick: () => void submit() }, "Save");

    /** What the fields hold, as a save takes it: a member the team asks nothing more of, without a line. */
    const values = () => ({
      name: String(nameIn.value).trim(),
      lead,
      members: savedCrew(rows.map((r) => ({ tag: r.tag, name: String(r.nameIn.value).trim(), line: String(r.input.value).trim(), model: r.models[0], effort: r.effort.value() }))),
      models: [...models],
      efforts: effortsIn(models, efforts),
      leadModels: [...leadModels],
      leadEfforts: effortsIn(leadModels, leadEfforts),
      readOnly,
      fired: { ...fired },
      check: String(checkIn.value).trim() || null,
    });
    /**
     * A body whole, its efforts only where a list names some: its models, names alone, say none.
     * @param {ReturnType<typeof values>} v
     */
    const lean = ({ efforts: e, leadEfforts: le, ...v }) => ({ ...v, ...(Object.keys(e).length ? { efforts: e } : {}), ...(Object.keys(le).length ? { leadEfforts: le } : {}) });
    /** A new team's body: its own fields only where it names them. @param {ReturnType<typeof values>} v */
    const newBody = ({ models: named, efforts: e, leadModels: lm, leadEfforts: le, readOnly: ro, fired: f, check: ck, ...v }) => ({
      ...v,
      ...(named.length ? { models: named } : {}),
      ...(Object.keys(e).length ? { efforts: e } : {}),
      ...(lm.length ? { leadModels: lm } : {}),
      ...(Object.keys(le).length ? { leadEfforts: le } : {}),
      ...(ro ? { readOnly: true } : {}),
      ...(f.notify || f.verify ? { fired: f } : {}),
      ...(ck ? { check: ck } : {}),
    });
    /** The team's members as a save would name them unchanged. */
    const had = mode === "new" || held ? "" : JSON.stringify(crewOf(team.members));
    /**
     * A part of a shipped team you had changed, now as it ships again: sent as null, put back, as the server's log then
     * says it. @param {"name" | "lead" | "members"} k @param {any} v
     */
    const asSent = (k, v) => (ships && (team.set || []).includes(k) && JSON.stringify(v) === JSON.stringify(ships[k]) ? null : v);
    /** An edit's body: only what changed. @param {ReturnType<typeof values>} v */
    const changes = (v) => ({
      ...(v.name !== team.name ? { name: asSent("name", v.name) } : {}),
      ...(v.lead !== team.lead.tag ? { lead: asSent("lead", v.lead) } : {}),
      ...(JSON.stringify(v.members) !== had ? { members: asSent("members", v.members) } : {}),
      ...(JSON.stringify(v.models) !== JSON.stringify(team.models || []) ? { models: v.models } : {}),
      ...(JSON.stringify(v.leadModels) !== JSON.stringify(leadsOf(team)) ? { leadModels: v.leadModels } : {}),
      // A list goes with its efforts: names alone are read as none set.
      ...(JSON.stringify(v.efforts) !== JSON.stringify(effortsIn(team.models || [], team.efforts)) || (JSON.stringify(v.models) !== JSON.stringify(team.models || []) && Object.keys(v.efforts).length) ? { efforts: v.efforts } : {}),
      ...(JSON.stringify(v.leadEfforts) !== JSON.stringify(effortsIn(leadsOf(team), team.leadEfforts)) || (JSON.stringify(v.leadModels) !== JSON.stringify(leadsOf(team)) && Object.keys(v.leadEfforts).length) ? { leadEfforts: v.leadEfforts } : {}),
      ...(v.readOnly !== (team.readOnly === true) ? { readOnly: v.readOnly } : {}),
      ...(v.fired.notify !== (team.fired?.notify === true) || v.fired.verify !== (team.fired?.verify === true) ? { fired: v.fired } : {}),
      ...(v.check !== (team.check ?? null) ? { check: v.check } : {}),
    });
    const why = () => {
      const v = values();
      if (mode === "edit" && !Object.keys(changes(v)).length && start === startWas) return "Nothing has changed yet";
      if (!v.name) return "A team needs a name";
      if (!v.lead) return leadGone || "A team needs a lead: the agent in charge";
      // A member whose card is gone waits for a card in its place (a team held).
      const lost = rows.find((r) => !cardOf(r.tag));
      if (lost) return lost.gone || `There is no agent @${lost.tag}: seat another card in its place`;
      if (v.check && v.check.length > checkMost) return `A check is one command line, up to ${count(checkMost)} characters`;
      return v.members.length ? null : "A team needs at least one worker";
    };
    const mark = () => {
      const no = why();
      save.toggleAttribute("disabled", busy || !!no);
      note.replaceChildren(...(no ? [no] : []));
      paintMarks();
    };
    /** Each part's marks as the editor stands: "changed" while it differs from how it ships. */
    function paintMarks() {
      if (!ships) return;
      const v = /** @type {Record<string, unknown>} */ (values());
      for (const [k, x] of marks) x.paint(JSON.stringify(v[k]) !== JSON.stringify(ships[/** @type {"name" | "lead" | "members"} */ (k)]), moved.has(k));
    }
    /** A part as the team ships it, in words: what Show gives. @param {string} k */
    function shipsWords(k) {
      const s = /** @type {NonNullable<typeof ships>} */ (ships);
      return k === "name" ? s.name
        : k === "lead" ? `${cardOf(s.lead)?.name || team.ships?.lead?.name || s.lead} (@${s.lead})`
          : s.members.map((x) => `${x.name || cardOf(x.tag)?.name || x.tag}${x.line ? ` — ${x.line}` : ""}`).join("\n");
    }
    /** A part put back in the editor as the team ships it; Save keeps it so. The keys go to its control. @param {string} k */
    function putBack(k) {
      if (!ships) return;
      if (k === "name") nameIn.value = ships.name;
      else if (k === "lead") {
        lead = ships.lead;
        leadIn.value = lead;
        paintLead();
      } else {
        rows.splice(0, rows.length);
        for (const x of ships.members) addRow(x);
        paintMembers();
        paintCounts();
      }
      mark();
      (k === "name" ? nameIn : k === "lead" ? leadIn : rows[0]?.input || addIn).focus({ preventScroll: true });
    }
    /** Each member's line, and the check, against its limit, said from where it is near. */
    function paintCounts() {
      /** @param {any} el @param {number} n @param {number} most */
      const said = (el, n, most) => {
        el.replaceChildren(...(n >= most * NEAR ? [`${count(n)} / ${count(most)}`] : []));
        el.classList.toggle("is-near", n >= most * NEAR && n <= most);
        el.classList.toggle("is-over", n > most);
      };
      for (const r of rows) said(r.count, String(r.input.value).trim().length, limits.line);
      said(checkCount, String(checkIn.value).trim().length, checkMost);
    }
    async function submit() {
      if (busy || why()) return;
      const v = values();
      busy = true;
      mark();
      error.replaceChildren();
      try {
        const body = mode === "edit" ? changes(v) : {};
        // A team held is saved whole: what the editor holds takes the place of what the file kept.
        const r = held ? await call(`/teams/${encodeURIComponent(team.key)}`, { method: "PUT", body: lean(v) })
          : mode !== "edit"
            ? await call("/teams", { method: "POST", body: mode === "duplicate" ? { from: team.key, ...lean(v) } : newBody(v) })
            : Object.keys(body).length ? await call(`/teams/${encodeURIComponent(team.key)}`, { method: "PUT", body }) : null;
        if (r) {
          st.data.saved = r.saved;
          st.data.agentTeams = r.agentTeams;
          if (r.held) st.data.held = r.held;
          // A team that ships, set: its card says what was saved.
          if (r.team?.shipped) st.data.shipped = (st.data.shipped || []).map((/** @type {any} */ x) => (x.key === r.team.key ? r.team : x));
        }
        const made = r?.team || team;
        // Whether your agent may use it is every chat's list of teams (U13-D9), written once the team is: a new one has
        // its key only then. A refusal is said; the team stays saved.
        if (start !== startWas) await putAgentTeams(made.key, start);
        toast(mode === "edit" ? `The ${made.name} team is saved` : held ? `The ${made.name} team is saved, and can be used again` : `The ${made.name} team is saved: /team ${made.key} hands a session to it`);
        // Who uses a card follows: the cards are read again before the page is drawn.
        await page.read();
        close(mode === "edit" ? null : made);
        changed();
      } catch (e) {
        busy = false;
        error.replaceChildren(errText(e));
        mark();
      }
    }

    paintLead();
    paintMembers();
    paintCounts();
    mark();
    /** What a close would throw away: anything that differs from what the editor opened with. */
    const opened = JSON.stringify([values(), start]);
    const dirty = () => !busy && JSON.stringify([values(), start]) !== opened;
    // A team that ships: every part of it in place, and Put back all, on your word (SA-D2, SA-D8).
    const sub = shipped ? `${leadsWords(team)}. It ships with Filament: every part of it is yours to change, and Put back gives Filament's again.`
      : held ? `Kept as you saved it, not usable now: ${team.why}. Saved, it is a team of yours again.`
      : mode === "edit" ? leadsWords(team)
        : mode === "duplicate" ? `A copy of ${team.name}. Saving starts nothing.`
          : "A lead and its workers. Saving starts nothing: a team is sent from a chat.";
    const plain = !(team?.set || []).length;
    const resetAll = shipped
      ? m("button", { class: "sm ghost", type: "button", ...(plain ? { disabled: "" } : {}), title: plain ? "It is as it ships" : "Every part of it as it ships", onclick: () => void putBackWhole() }, "Put back all")
      : null;
    async function putBackWhole() {
      if (busy) return;
      busy = true;
      mark();
      error.replaceChildren();
      try {
        const ok = await ask({ title: `Put back the ${team.name} team as it ships?`, description: `What you changed of it goes: ${changedWords(team)}. This cannot be undone.`, confirmLabel: "Put back", destructive: true });
        if (!ok) {
          busy = false;
          mark();
          return;
        }
        const r = await call(`/teams/${encodeURIComponent(team.key)}`, { method: "PUT", body: { reset: true } });
        st.data.saved = r.saved;
        st.data.agentTeams = r.agentTeams;
        if (r.team?.shipped) st.data.shipped = (st.data.shipped || []).map((/** @type {any} */ x) => (x.key === r.team.key ? r.team : x));
        toast(`The ${r.team?.name || team.name} team is as it ships`);
        await page.read();
        close();
        changed();
      } catch (e) {
        busy = false;
        error.replaceChildren(errText(e));
        mark();
      }
    }
    const body = [
      part(m, "", [
        line(m, { label: labelled("Name", "name"), sub: mode === "edit" || held ? m("span", {}, "Its command, ", m("code", { class: "tset-code" }, `/team ${team.key}`), ", stays when the name changes") : null }, nameIn),
        movedAt("name"),
        line(m, { label: labelled("Lead", "lead"), sub: leadLine }, leadIn),
        movedAt("lead"),
      ], "The lead plans, hands out the pieces and checks what comes back."),
      part(m, "Workers", [membersEl, m("div", { class: "ed-row is-add" }, addIn, fullNote), movedAt("members")], "Under each, what this team asks of it; left empty, it goes by its card.", mineAt("members")),
      part(m, "How it runs", [
        line(m, { label: "Lead runs on", sub: "On the side. In charge, your chat's model" }, leadModelEl),
        line(m, { label: "Workers run on", sub: "A worker the team names a model for keeps it" }, modelsEl),
        line(m, { label: "Check", sub: CHECK_DOES, wide: true }, checkIn, checkCount),
        readOnlyRow,
      ], "When you send it yourself, its Brief can change these for that run."),
      part(m, "Your agent", [startRow, notifyRow, verifyRow]),
      shipped ? part(m, "", [line(m, { label: "As it ships", sub: plain ? "Nothing of it is changed" : `What you changed of it — ${changedWords(team)} — put back` }, resetAll)]) : null,
    ];
    const foot = m("div", { class: "ed-foot" },
      error,
      note,
      m("button", { class: "zc-btn zc-btn-v-secondary", type: "button", onclick: () => close() }, "Cancel"),
      save);
    return {
      title: mode === "new" ? "New team" : mode === "duplicate" ? `Duplicate ${team.name}` : `Edit ${team.name}`,
      tile: portrait(leadLook(mode === "edit" ? team.key : ""), "s32", true),
      sub,
      body,
      foot,
      dirty,
      first: nameIn,
      refresh: () => { leadList.paint(); crewList.paint(); for (const r of rows) r.list.paint(); },
    };
  }

  async function read() {
    st.failed = null;
    try {
      st.data = await call("/teams");
    } catch (e) {
      st.failed = errText(e);
    }
  }

  return {
    read,
    setModels(list, families = []) {
      st.catalogue = list;
      st.families = families;
      // An editor open meanwhile: its pickers offer the catalogue, drawn again with it.
      st.editing?.refresh?.();
    },
    squads,
    newButton,
    editing: () => !!st.editing,
    open: () => edit("new", null),
    reveal: () => {
      page.repaint();
      openers.section?.scrollIntoView?.({ block: "start" });
    },
    showSeat: (key, tag) => {
      st.seat = { key, tag };
    },
    focusSeat: () => {
      const at = st.seat ? openers.seats.get(`${st.seat.key} ${st.seat.tag}`) : null;
      openers.cards.get(st.seat?.key || "")?.card?.scrollIntoView?.({ block: "nearest" });
      at?.focus({ preventScroll: true });
    },
    swap,
    count: () => teams().length,
    teamOf: (key) => teams().find((t) => t.key === key) || null,
  };
}
