// @ts-check
// Who runs on what (the owner's plan of 11-05: three places at most — a card or a team in Library, this chat's Agents
// tab, a launch's pick): each agent, and each team's lead and workers, with the models it runs on in this chat — this
// chat's own rows for it, else its card's or its team's in Library, else this chat's list (everyone else's) or, for a
// lead, the main agent's model. Each is a list's chip (pool.js), each row at its effort, whose editor sets this chat's
// own rows (`subagents.byCard`, `subagents.byTeam`); its Use the default drops them, and Library's hold again. Under one
// row: unfolded in the Agents tab's gear, above the chat's list (views/side.js), and folded on the Start board. Each line says
// what the server runs (the review of 11-05): a lead's card's models after its team's; no lead line for the team that
// leads this chat — its lead is the chat's main agent —; a crew with none of its own, beside a chat with no list of its
// own, on its lead's model. A coding agent's chat reads them alike: its nameless row is the agent's own model (the
// owner's of 11-06).
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { orderOf, poolLine, poolRows } from "../lib/pool.js";
import { createPoolChip } from "./pool.js";
import { group, row } from "./kit.js";

/** @typedef {{ model: string, effort?: string }} Row */
/** @typedef {{ tag: string, name: string, model?: string | null, models?: readonly string[], efforts?: Record<string, string>, always?: boolean, from?: string | null, partOf?: string | null }} RunsOnCard */
/**
 * @typedef {object} RunsOnIO
 * @property {() => readonly RunsOnCard[]} cards  the agents a chat may name: Builder and Reviewer `always`
 * @property {(tag: string) => RunsOnCard | null} [card]  any card by its tag, one that is part of a team too (a team's
 *   lead, Build lead's): a lead's models where its team names none
 * @property {() => readonly { key: string, name: string, models?: readonly string[], efforts?: Record<string, string>, leadModels?: readonly string[],
 *   leadModel?: string | null, leadEfforts?: Record<string, string>, lead?: { tag: string } | null }[]} teams
 * @property {() => unknown} byCard  this chat's own rows, by card (`subagents.byCard`)
 * @property {() => unknown} byTeam  this chat's own rows, by team: its lead's and its workers' (`subagents.byTeam`)
 * @property {(next: Record<string, Row[]> | null) => void} setByCard  the whole map; null where none is left
 * @property {(next: Record<string, { lead?: Row[], workers?: Row[] }> | null) => void} setByTeam
 * @property {() => unknown} everyone  this chat's list (`subagents.pool`): what an agent or a crew with none runs on
 * @property {() => string} main  the main agent's model
 * @property {() => any[]} models @property {() => any[]} [families] @property {() => any[]} [accounts]
 * @property {import("./pool.js").PoolChipIO["facts"]} [facts]
 * @property {() => { level: string, desc: string }} [inherit]
 * @property {() => string | null} [leading]  the team that leads this chat, by key: its lead is the chat's main agent
 * @property {() => boolean} [ownList]  whether this chat holds a list of its own, which a team fired beside it takes
 *   along — none, its crew runs on its lead's model; left out, it does
 * @property {() => { model: string, effort: string } | null} [pick]  what a Brief picked for the crew of the team that
 *   leads this chat (`engine.teamWorkers`, `engine.teamEffort`): before this chat's rows for it, until the chat changes
 *   hands
 */

/**
 * One line of Who runs on what: an agent's, or a team's lead's or workers'. `rows`: the list in force; `whose`: where
 * it comes from — this chat's own rows, Library's, this chat's list, the main agent's model; `inherits`: a crew's
 * beside this chat, what a row with no effort thinks at — its lead's ("" the main agent's), as the team's chat runs it;
 * `after`: the Brief's line's, what holds once the pick goes — what its editor sets.
 * @typedef {"chat" | "library" | "card" | "everyone" | "lead" | "main" | "brief"} Whose
 * @typedef {{ id: string, kind: "card" | "lead" | "workers", key: string, name: string, part: string, rows: Row[],
 *   whose: Whose, inherits?: string, after?: { rows: Row[], whose: Whose } }} RunsOnLine
 */

/** Where a line's list comes from, in the chip's tag and the editor's note. */
export const WHOSE = Object.freeze({
  chat: { tag: "This chat", note: "this chat's own" },
  library: { tag: "Library", note: "as in Library" },
  card: { tag: "Its card", note: "as its lead's card in Library" },
  everyone: { tag: "Everyone else", note: "this chat's list, as everyone else" },
  lead: { tag: "Its lead's", note: "its lead's model and effort: this chat has no list of its own to send its team" },
  main: { tag: "Main agent", note: "the main agent's model" },
  brief: { tag: "The Brief's", note: "the Brief's pick for its workers, until the chat changes hands; the rows here hold then" },
});

/** The editor's foot here: how an agent takes a model, and what comes first. */
export const RUNS_FOOT =
  "An agent takes the first model with room, from the top: one at its limit, one that cannot run now or one that fails passes it to the next. This chat's rows here come before Library's. A model's limit across your chats is set on its row under its provider in Settings; with none set, it has none.";
/** A lead's editor's foot: a lead runs on the first that can, whatever its limit says (teams-beside.js). */
export const LEAD_FOOT = "A lead takes the first model that can run now, from the top. This chat's rows here come before Library's.";
/** A crew's line, in its chip's tooltip: what comes before its rows. */
export const CREW_NOTE = "A worker its team names a model for keeps it; with no models for its workers, each runs on its card's first.";

/** A plain object's own entries, or none. @param {unknown} v @returns {Record<string, any>} */
const mapOf = (v) => (v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, any>} */ (v) : {});
/** Rows a setting holds, or null where it holds none. @param {unknown} v @returns {Row[] | null} */
const rowsIn = (v) => (Array.isArray(v) && v.length ? orderOf(poolRows(v)) : null);
/** A Library list's rows: its models in order, each at its effort. @param {readonly string[] | undefined} models @param {Record<string, string> | undefined} efforts */
const libraryRows = (models, efforts = {}) => (models || []).filter(Boolean).map((m) => ({ model: m, ...(efforts[m] ? { effort: efforts[m] } : {}) }));

/**
 * Every line, in order: the agents, then each team's lead and workers. DOM-free.
 * @param {RunsOnIO} io @returns {RunsOnLine[]}
 */
export function runsOnLines(io) {
  const byCard = mapOf(io.byCard());
  const byTeam = mapOf(io.byTeam());
  const list = orderOf(poolRows(io.everyone()));
  const leading = io.leading?.() || null;
  const ownList = io.ownList ? io.ownList() : true;
  const cards = io.cards();
  /** Any card by its tag: one that is part of a team too. @param {string} tag */
  const find = (tag) => io.card?.(tag) || cards.find((c) => c.tag === tag) || null;
  /** A Library card's rows, its models in order. @param {ReturnType<RunsOnIO["cards"]>[number] | undefined} c */
  const cardRows = (c) => (c ? libraryRows(c.models?.length ? c.models : c.model ? [c.model] : [], c.efforts) : []);
  /**
   * The first list that holds a row, with whose it is; none, the main agent's model.
   * @param {...[RunsOnLine["whose"], Row[] | null]} lists @returns {{ rows: Row[], whose: RunsOnLine["whose"] }}
   */
  const first = (...lists) => {
    for (const [whose, rows] of lists) if (rows?.length) return { rows, whose };
    return { rows: [{ model: "" }], whose: "main" };
  };
  /** @type {RunsOnLine[]} */
  const out = [];
  for (const c of cards)
    out.push({ id: `card:${c.tag}`, kind: "card", key: c.tag, name: c.name, part: "", ...first(["chat", rowsIn(byCard[c.tag])], ["library", cardRows(c)], ["everyone", list]) });
  const pick = io.pick?.() || null;
  for (const t of io.teams()) {
    const own = mapOf(byTeam[t.key]);
    // A beside lead's order (teams-beside.js): this chat's rows, its team's, its card's, the main agent's model.
    const lead = first(
      ["chat", rowsIn(own.lead)],
      ["library", libraryRows(t.leadModels?.length ? t.leadModels : t.leadModel ? [t.leadModel] : [], t.leadEfforts)],
      ["card", cardRows((t.lead?.tag && find(t.lead.tag)) || undefined)],
      ["main", [{ model: "" }]],
    );
    // The team that leads this chat runs its lead as the chat's main agent, on the chat's model: no rows of its own.
    if (t.key !== leading) out.push({ id: `lead:${t.key}`, kind: "lead", key: t.key, name: t.name, part: "Lead", ...lead });
    // A crew with none: this chat's list, which a team fired beside it takes along where the chat holds one of its own
    // — else its own chat's, its lead's model.
    /** @type {[RunsOnLine["whose"], Row[]]} */
    const none = t.key === leading || ownList ? ["everyone", list] : ["lead", lead.rows.slice(0, 1)];
    const crew = first(["chat", rowsIn(own.workers)], ["library", libraryRows(t.models, t.efforts)], none);
    // The Brief's pick for the team in charge comes first: its model, else each row at its effort (subagents.js teamRows);
    // what it stands before holds once it goes.
    const picked = t.key === leading && pick && (pick.model || pick.effort)
      ? { rows: pick.model ? [{ model: pick.model, ...(pick.effort ? { effort: pick.effort } : {}) }] : crew.rows.map((r) => ({ ...r, effort: pick.effort })), whose: /** @type {const} */ ("brief"), after: crew }
      : null;
    // Beside this chat, its crew thinks as its lead where a row says nothing: the team's chat runs at its lead's effort.
    const inherits = t.key === leading ? {} : { inherits: lead.rows[0]?.effort || "" };
    out.push({ id: `workers:${t.key}`, kind: "workers", key: t.key, name: t.name, part: "Workers", ...(picked || crew), ...inherits });
  }
  return out;
}

/**
 * This chat's rows for one line set, or dropped (`rows` null): the whole map as it is written — null where none is left.
 * @param {RunsOnIO} io @param {RunsOnLine} line @param {Row[] | null} rows
 * @returns {{ byCard: Record<string, Row[]> | null } | { byTeam: Record<string, { lead?: Row[], workers?: Row[] }> | null }}
 */
export function runsOnWrite(io, line, rows) {
  if (line.kind === "card") {
    const next = /** @type {Record<string, Row[]>} */ ({ ...mapOf(io.byCard()) });
    if (rows) next[line.key] = orderOf(poolRows(rows));
    else delete next[line.key];
    return { byCard: Object.keys(next).length ? next : null };
  }
  const all = /** @type {Record<string, { lead?: Row[], workers?: Row[] }>} */ ({ ...mapOf(io.byTeam()) });
  const team = { ...mapOf(all[line.key]) };
  if (rows) team[line.kind] = orderOf(poolRows(rows));
  else delete team[line.kind];
  if (Object.keys(team).length) all[line.key] = team;
  else delete all[line.key];
  return { byTeam: Object.keys(all).length ? all : null };
}

/**
 * This chat's rows written and not answered yet, by a key of its owner's — its chat's and its setting's (the review of
 * 11-05): a read takes the newest, so a second edit before the first's answer builds on it, not on what the server
 * said last. A write's value goes once its answer is in, unless a newer one took its place.
 * @returns {{ read: (key: string, stored: unknown) => unknown, write: (key: string, next: unknown, go: () => Promise<unknown>) => Promise<void> }}
 */
export function rowsAhead() {
  /** @type {Map<string, { next: unknown }>} */
  const ahead = new Map();
  return {
    read: (key, stored) => (ahead.has(key) ? ahead.get(key)?.next : stored),
    async write(key, next, go) {
      const mine = { next };
      ahead.set(key, mine);
      try {
        await go();
      } finally {
        if (ahead.get(key) === mine) ahead.delete(key);
      }
    },
  };
}

/** The folded row's line: how many are set here — under the Brief's pick too, which its line's editor sets. @param {RunsOnLine[]} lines */
export const runsOnSub = (lines) => {
  const n = lines.filter((l) => (l.after || l).whose === "chat").length;
  return n ? `${n} set in this chat` : "As in Library, else this chat's list";
};

/**
 * @param {RunsOnIO} io
 * @param {{ h?: typeof h, poolChip?: typeof createPoolChip, open?: boolean }} [o]  the test's stand-ins; `open`: unfolded
 *   to start with (the Agents tab's gear sheet, which is for it)
 * @returns {{ el: HTMLElement, paint: () => void }}  `paint` is its owner's to call, the first time too
 */
export function createRunsOn(io, o = {}) {
  const mk = o.h || h;
  const poolChip = o.poolChip || createPoolChip;
  let open = !!o.open;
  let key = "";
  const sub = mk("span", { class: "runs-on-sub" });
  const chev = mk("span", { class: "runs-on-chev", "aria-hidden": "true", html: ICONS.chevronRight });
  const head = row(mk, { label: "Who runs on what", sub, value: chev, cls: "runs-on-head", chevron: false, onClick: () => { open = !open; key = ""; paint(); } });
  head.setAttribute("aria-expanded", "false");
  const list = mk("div", { class: "runs-on-list hidden" });
  const el = mk("div", { class: "runs-on", role: "group", "aria-label": "Who runs on what" }, group(mk, head), list);

  /** @param {RunsOnLine} line */
  const chipOf = (line) => {
    const whose = WHOSE[line.whose];
    // The Brief's line says its pick, and its editor what holds once the pick goes: this chat's rows, which the server
    // reads only then (the review of 8a278df79).
    const edits = line.after || line;
    const who = line.part ? `the ${line.name} team's ${line.part.toLowerCase()}` : line.name;
    /** @param {Row[] | null} rows */
    const write = (rows) => {
      const w = runsOnWrite(io, line, rows);
      if ("byCard" in w) io.setByCard(w.byCard);
      else io.setByTeam(w.byTeam);
    };
    const crew = line.kind === "workers" ? ` ${CREW_NOTE}` : "";
    const chip = poolChip({
      rows: () => edits.rows,
      line: () => (line.after ? poolLine(/** @type {any} */ (line.rows), io.main()) : null),
      foot: line.kind === "lead" ? LEAD_FOOT : RUNS_FOOT,
      from: () => ({ note: whose.note, title: `${who[0].toUpperCase()}${who.slice(1)}: ${whose.note}. A change here is this chat's own.${crew}` }),
      main: io.main,
      models: io.models,
      ...(io.families ? { families: io.families } : {}),
      ...(io.accounts ? { accounts: io.accounts } : {}),
      ...(io.facts ? { facts: io.facts } : {}),
      ...(line.inherits !== undefined
        ? { inherit: () => ({ level: line.inherits || io.inherit?.().level || "model", desc: "Its lead's effort: the team's chat thinks as its lead" }) }
        : io.inherit ? { inherit: io.inherit } : {}),
      label: `What ${who} ${line.kind === "workers" ? "run" : "runs"} on in this chat`,
      defaultWords: line.kind === "lead" ? "Drop this chat's rows for it: the team's in Library hold again, else its lead's card's, else the main agent's model" : "Drop this chat's rows for it: Library's hold again, else this chat's list",
      onChange: (rows) => write(rows),
      // Nothing of this chat's to drop: nothing is written.
      onUseDefault: () => { if (edits.whose === "chat") write(null); },
    });
    chip.paint();
    return chip.el;
  };

  const paint = () => {
    const lines = runsOnLines(io);
    sub.replaceChildren(runsOnSub(lines));
    head.setAttribute("aria-expanded", String(open));
    chev.classList.toggle("is-open", open);
    list.classList.toggle("hidden", !open);
    const next = open ? JSON.stringify([lines, io.main()]) : "";
    if (next === key) return;
    key = next;
    // Whose list it is under its name, its part's first (the look of 11-05: on the chip it left the list "Yo…").
    list.replaceChildren(...(open && lines.length ? [group(mk, ...lines.map((l) => row(mk, { label: l.name, sub: l.part ? `${l.part} · ${WHOSE[l.whose].tag}` : WHOSE[l.whose].tag, trailing: chipOf(l), cls: `runs-on-row is-${l.kind}` })))] : []));
  };
  return { el, paint };
}
