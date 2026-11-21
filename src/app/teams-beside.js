// @ts-check
// Teams beside a chat (team_v2_plan §5.3, §5.4; TV2-D2, D4, D5, D10): a team fired from a chat's Team tab — or by its
// main agent (§5.5) — runs as a chat of its own, kind `team`, tied to the main chat by a `beside` link. Its lead is that
// chat's own agent (engine.team), so its workers, its questions, its stops and its archive are a team-led chat's; its
// first message is the person's words after the full record of the main chat (the sessions service's `recordFor`). The
// main chat is untouched: nothing is added to it and its cache stays — until a result is sent on.
//
// A team's state is read from its chat as it stands (core/beside.js `besideState`), so a restart needs nothing: one a
// restart cut says stopped, and its card offers Resume…. Its result is its lead's final reply. Every hand-off is the
// person's — Notify main agent, Verify… — unless they switched it on as the team was fired (`verify`, `notify`), which
// act on its first result: Then verify fires BugHunters with its result as the claims to check, and Then notify sends
// the newest result (BugHunters' check, where both are on) to the main agent. A result reaches the main agent's running
// turn as a sub-agent's report does, through the registry: sealed while its agent works, opened while it waits
// (HarnessV4_Envelopes_Plan EN4); a turn that reads no inbox of Filament's takes it as Space syncs go, a note into its
// running turn; and a chat at rest, as a turn of Filament's own.
// Each change is said on the `turns` topic (`{ type: "beside", main, id, what }`), which the page follows.
import { BESIDE_LIMITS, BUGHUNTERS, FINDING_LIMITS, askProblem, checkedByNone, besideState, crewOf, findingsOf, noteFor, openingContent, resultMessage, resultSender, resultSubject, shortOf, verifyAsk } from "../core/beside.js";
import { subjectOf } from "./agent/envelopes.js";
import { byCardProblem, byTeamProblem, poolName, poolProblem } from "../core/pool.js";
import { SUBAGENT_EFFORTS } from "../core/schema.js";
import { imageBlock } from "../core/media.js";
import { agentTeamsOf, namesMode } from "../services/session-settings.js";
import { cardsNamedIn } from "../services/agent-cards.js";
import { foldedTeamWords, resultChecked } from "../core/folded-teams.js";
import { TEAMS_OFF } from "../core/teams-on.js";
import { huntsIn, rangeBlock } from "../core/hunt-range.js";
import { archivedSaid } from "./sessions/service.js";

/** How long a chat whose turn just ended waits before a result is sent: that turn lets go of it first. */
export const BESIDE_SETTLE_MS = 300;
/** How long a burst of a team's workers' events waits before its card is looked at again. */
const LOOK_MS = 200;

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });
/**
 * How hard a Brief asked a lead or its workers to think: one of SUBAGENT_EFFORTS, null where it asked nothing; any
 * other word is refused.
 * @param {unknown} v @param {"lead" | "workers"} who @returns {string | null}
 */
const effortIn = (v, who) => {
  if (v == null || String(v).trim() === "") return null;
  const s = String(v).trim().toLowerCase();
  if (!SUBAGENT_EFFORTS.includes(s)) throw refused(400, `${who === "lead" ? "effort" : "workersEffort"} is one of ${SUBAGENT_EFFORTS.join(", ")}: how hard ${who === "lead" ? "its lead thinks" : "its workers think"}`);
  return s;
};

/**
 * How the runner reaches the main chat (app/space-sync.js's `SyncReach`): whether a turn holds it, a turn of Filament's
 * own with a team's result, and the result into its running turn.
 * @typedef {{ busy: (chain: string) => boolean, post: (chain: string, text: string) => Promise<{ status: number, body: any }>,
 *   steer: (chain: string, text: string) => { ok: boolean, error?: string } }} BesideReach
 */

/**
 * Where a flow's team boxes work (HarnessV4_OneAgent_Plan OA5): `own` makes the flow's git worktree from the main chat's
 * folder (`MadeWorktree`), or says why none can be (`outside`); `bring` copies the uncommitted files of the place it was
 * made from into it, uncommitted (adapters/git/carry.js `bringUncommitted`); `takeBack` undoes one its chat never used;
 * `template` copies the project's worktree template into it, which the chat's first turn waits for, and `untemplate`
 * ends that copy where it is; `here`, whether a folder is still there.
 * @typedef {{ own: (cwd: string, name: string) => Promise<{ ok: true, name: string, branch: string, folder: string, cwd: string, main: string, place: string, commit: string } | { ok: false, outside?: string, error?: string }>,
 *   bring?: (made: { place: string, folder: string, commit: string }) => Promise<{ ok: true, files: string[], stays: string[] } | { ok: false, error: string }>,
 *   takeBack: (made: { main: string, folder: string, branch: string }) => Promise<string | null>,
 *   template?: (chatId: string, made: { place: string, folder: string }) => void, untemplate?: (chatId: string, why: string) => Promise<void>,
 *   here?: (folder: string) => boolean }} BesidePlaces
 */

/**
 * A team beside as its card reads it.
 * @typedef {{ id: string, main: string | null, team: { key: string, name: string }, ask: string, firedBy: import("../core/beside.js").FiredBy,
 *   at: number, model: string | null, title: string, state: import("../core/beside.js").BesideState,
 *   workers: { running: number, waiting: number, total: number, done?: number, failed?: number, stopped?: number }, verify: boolean, checked: boolean, notify: boolean, of: string | null,
 *   verifiedBy: string | null, result: { n: number, text: string, more: boolean, at: number | null } | null,
 *   findings: { counts: Record<import("../core/beside.js").FindingKind, number>, top: Finding[], total: number } | null,
 *   notified: { n: number, at: number, how: Delivered } | null, cut: boolean, readOnly: boolean,
 *   fresh: boolean, on: BesideOn, missed?: string | null, flow: { id: string, box: string } | null,
 *   place?: import("../core/flow.js").BoxPlace }} BesideRow  `checked`: its result comes checked — BugHunters', or the gone
 *   Verifier's (core/folded-teams.js `resultChecked`) — so nothing checks it again; `place`: where a flow's box that writes works (OA5); `flow`: the flow
 *   it is a box of (HarnessV4_Flow_Plan F2), whose runner hands its result on; `missed`: why its result, which Then notify was to
 *   send, reached nobody — refused, or waiting when Filament stopped — while it has not gone since; `findings`: its result's fixed list where its lead wrote one (team_v2_plan §10 O3): how
 *   many of each kind, and the first few in its lead's order
 * @typedef {{ kind: import("../core/beside.js").FindingKind, title: string, where: string, note: string }} Finding
 * @typedef {"steered" | "sent" | "waits" | "envelope"} Delivered  where a result went: into the running turn as a note,
 *   or whole where it reads Filament's inbox and its session takes results whole (`steered`); as a turn of Filament's own
 *   (`sent`); held for the turn's end (`waits`); into the running turn's inbox, sealed while its agent works (`envelope`,
 *   HarnessV4_Envelopes_Plan EN4)
 * @typedef {{ description: string, sender: string, subject: string, via?: "team" | "flow" }} EnvelopeWords  how a result's
 *   envelope names it, and whose it is: a team's or a flow's, which the page's card opens (EN5)
 * @typedef {{ id: string, n: number, text: string, envelope?: EnvelopeWords, sent?: (how: "sent" | null, why?: string) => void, auto?: boolean }} Result  one
 *   result for a main chat: `sent`, whoever keeps it hears where it went once it does — a flow's end message (`deliverOwn`) — in the
 *   place of its team's card; `auto`, the team's switch sends it, not a press: no turn of its own in an archived chat (`send`)
 * @typedef {{ lead: string | null, leadEffort?: string, leadFrom?: "here", workers: string[] | null, from: "picked" | "here" | "chat" | "project" | "team" | "seats",
 *   fell: { name: string, why: string, as: "lead" | "workers", next?: string, picked?: boolean }[] }} BesideOn  what it runs on: its lead's model — how hard it thinks on it where its row says (`leadEffort`) —, and its workers' models in
 *   order — `from` the fire card's pick, the main chat's own rows for the team (`here`), the main chat's own Seats for
 *   team workers, the team's own models, or (null)
 *   the Seats for team workers — and each model its team names that cannot run, with why: its lead on the chat's model
 *   in its place, its workers on the rest of the team's list; `picked`, a model the fire card picked that cannot run,
 *   which a fire refuses
 */

/**
 * @param {{ archive: () => any, sessions: any, teams: import("../services/teams.js").TeamStore, registry: () => any,
 *   postTurn: (chain: string, body: Record<string, unknown>) => Promise<{ status: number, body: any }>, reach: BesideReach,
 *   remove: (chain: string) => Promise<unknown>, events: { publish: (topic: string, msg: any) => void, subscribe?: (topic: string, fn: (msg: any) => void) => () => void },
 *   log?: (level: string, msg: string) => void, now?: () => number, settleMs?: number,
 *   chatEffortOf?: (model: string, wanted: string, asked: boolean) => { name: string, effort: string | null }, places?: BesidePlaces | null,
 *   modeOf?: ((model: string) => string | null) | null, teamsOn?: () => boolean }} o
 *   `registry`: the sub-agents' registry (its `list`, `stop`, `modelNamed` and `mainEffort`); `postTurn`: a turn through
 *   the route a message takes; `remove`: a chat deleted, as the archive's Delete does; `chatEffortOf`: a chat's model and
 *   effort as it is made at a level — the highest it takes at or below it — kept as a chat keeps one; `asked` false, a
 *   level its name spells is kept (core/model-choice.js); `places`: a worktree of its own for a flow's box that writes (OA5);
 *   `modeOf`: the mode a turn on a model sets its coding agent to, its route's own included (engine.js `agentModeOf`);
 *   `teamsOn`: Settings › Experimental's Teams switch (core/teams-on.js) — off, no team is sent and a message names
 *   none, while a team at work finishes
 */
export function createTeamsBeside({ archive, sessions, teams, registry, postTurn, reach, remove, events, log = () => {}, now = Date.now, settleMs = BESIDE_SETTLE_MS, chatEffortOf = undefined, places = null, modeOf = null, teamsOn = () => true }) {
  /** The results waiting for their main chat's turn to end, by main chat, oldest first. @type {Map<string, Result[]>} */
  const waiting = new Map();
  /** The main chats a waiting result is being sent to now. @type {Set<string>} */
  const sending = new Set();
  /**
   * The main chats asked to send while one was being sent — a let-go among them: that send may meet the turn that let
   * go, so the results that wait are tried once more after it. @type {Set<string>}
   */
  const askedMeanwhile = new Set();
  /** The team chats a look is due for. @type {Map<string, ReturnType<typeof setTimeout>>} */
  const looks = new Map();
  /** How many results are on their way to each main chat now (`notify`): each a turn of its own there, or a word into its running turn. @type {Map<string, number>} */
  const notifying = new Map();
  /** Filament stopped: no result is sent after, and none is looked at. */
  let closed = false;

  /**
   * The switches a fire of the main agent's starts with (§5.5): the chat's own settings (`engine.agentTeams`), else
   * the team's own, else off. The person's fire card says its own.
   * @param {string} mainId @param {{ fired?: { notify: boolean, verify: boolean } }} team
   * @returns {{ notify: boolean, verify: boolean }}
   */
  const firedAhead = (mainId, team) => {
    /** @type {any} */
    let chat = {};
    try {
      chat = sessions.settingsOf(mainId)?.effective?.engine?.agentTeams || {};
    } catch {}
    const own = team.fired || { notify: false, verify: false };
    return {
      notify: typeof chat.notifyWhenDone === "boolean" ? chat.notifyWhenDone : own.notify === true,
      verify: typeof chat.verifyFirst === "boolean" ? chat.verifyFirst : own.verify === true,
    };
  };
  /**
   * The teams the developer's newest message to a chat's main agent names, by name or key, an `@` or none (`heard`),
   * by chat: the main agent may start them (HarnessV4_OneAgent_Plan OA2: "plain names = may; teams the same").
   * @type {Map<string, Set<string>>}
   */
  const heardTeams = new Map();
  /**
   * The teams the main agent may fire by itself beside a chat (U13-D9): its `subagents.teams`, each as a team finds it,
   * and those the developer's newest message names (`heard`).
   * @param {string} mainId @returns {string[]}  their keys
   */
  const agentMay = (mainId) => {
    /** @type {any} */
    let doc = null;
    try {
      doc = sessions.settingsOf(mainId)?.effective;
    } catch {}
    const listed = agentTeamsOf(doc, (k) => teams.find(k)?.key ?? null);
    return [...new Set([...listed, ...heardOf(mainId)])];
  };
  /**
   * The teams the developer's newest message named, as its chat keeps them: a restart keeps them, and a turn it cut
   * goes on with them (the bug round of 10-23). @param {string} mainId @returns {Set<string>}
   */
  const heardOf = (mainId) => {
    let s = heardTeams.get(mainId);
    if (!s) {
      /** @type {string[]} */
      let kept = [];
      try {
        const v = archive().getChain(mainId)?.meta?.heardTeams;
        if (Array.isArray(v)) kept = v.map(String);
      } catch {}
      heardTeams.set(mainId, (s = new Set(kept)));
    }
    return s;
  };
  /** A team chat's own words: what it was fired with. @param {any} chain */
  const besideOf = (chain) => (chain?.kind === "team" && chain.meta?.beside && typeof chain.meta.beside === "object" ? chain.meta.beside : null);
  /**
   * What a team's result says of the pictures its lead and its crew drew in its turn, for the main chat it reaches
   * (HarnessV4_DesignPass_Plan, case 13): their names and sizes, and how its agent opens one where it can — the registry's
   * words, a helper's report's. Empty where they drew none.
   * @param {string | null} main @param {{ title: string, bytes: number }[] | undefined} drew
   */
  const picturesLine = (main, drew) => (main && drew?.length ? String(registry()?.drewWords?.(main, drew, "The team") || "") : "");
  /** @param {string} id @param {Record<string, unknown>} patch */
  const note = (id, patch) => {
    const chain = archive().getChain(id);
    if (chain) archive().mergeMeta(id, { beside: { ...(chain.meta?.beside || {}), ...patch } });
  };
  /**
   * A change said on the feed; a fire's or a result's mark rides with it, so an open transcript draws it at once.
   * @param {string} main @param {string} id @param {string} what @param {any} [mark]
   */
  const said = (main, id, what, mark = null) => events.publish("turns", { type: "beside", main, id, what, ...(mark ? { mark } : {}) });

  /**
   * A team beside's card, as its chat stands now; null for a chat that is no team beside.
   * @param {string} id @returns {BesideRow | null}
   */
  function rowOf(id) {
    return rowFrom(archive().getChain(String(id || "")));
  }
  /**
   * The same of its chat as its caller read it a moment ago, nothing written since.
   * @param {any} chain @returns {BesideRow | null}
   */
  function rowFrom(chain) {
    const b = besideOf(chain);
    if (!chain || !b) return null;
    const f = sessions.besideFacts(chain.id);
    // Those done, those that failed and those stopped before finishing too, so the agent's status tells a team going well
    // from one going wrong.
    const crew = crewOf(/** @type {any[]} */ (registry()?.list(chain.id) || []));
    const state = besideState({ busy: f.busy, asking: f.asking, workers: crew.running + crew.waiting, last: f.last });
    const team = teams.find(b.team);
    const main = archive().mainOf(chain.id);
    const text = String(f.last?.text || "");
    const n = Number(f.last?.n) || 0;
    // A result that waited for its main chat when Filament stopped went nowhere: its card offers Notify again.
    const queued = !!main && (waiting.get(main) || []).some((w) => w.id === chain.id);
    const notified = b.notified && Number(b.notified.n) === n && (b.notified.how !== "waits" || queued) ? b.notified : null;
    // A result Then notify was to send that reached nobody (the 9 plausible of 10-19: the team tool said "on its way").
    const lost = b.notified && Number(b.notified.n) === n && b.notified.how === "waits" && !queued ? "Filament stopped before it could go" : null;
    const missed = notified || b.notify !== true ? null : b.missed && Number(b.missed.n) === n ? String(b.missed.why || "it was refused") : lost;
    const found = f.last?.final ? findingsOf(text) : null;
    return {
      id: chain.id,
      main,
      team: { key: String(b.team), name: team?.name || String(b.name || b.team) },
      ask: String(b.ask || ""),
      firedBy: b.firedBy === "agent" ? "agent" : "you",
      at: Number(b.at) || 0,
      model: chain.model || null,
      title: chain.title || "",
      state,
      workers: crew,
      // A team whose result comes checked has none checked again: no switch says it will be (the plan's p6).
      verify: b.verify === true && !resultChecked(b.team),
      checked: resultChecked(b.team),
      notify: b.notify === true,
      of: b.of || null,
      verifiedBy: b.verifiedBy || null,
      result: f.last?.final ? { n, text: text.slice(0, BESIDE_LIMITS.short * 10), more: text.length > BESIDE_LIMITS.short * 10, at: f.last.endedAt } : null,
      findings: found ? { counts: found.counts, top: found.items.slice(0, FINDING_LIMITS.top), total: found.items.length } : null,
      notified,
      cut: !!f.last?.cut,
      readOnly: b.readOnly === true,
      fresh: b.fresh === true,
      missed,
      flow: b.flow && typeof b.flow === "object" ? { id: String(b.flow.id || ""), box: String(b.flow.box || "") } : null,
      ...(b.place && typeof b.place === "object" ? { place: b.place } : {}),
      on: {
        lead: typeof b.on?.lead === "string" ? b.on.lead : chain.model || null,
        ...(typeof b.on?.leadEffort === "string" ? { leadEffort: b.on.leadEffort } : {}),
        ...(b.on?.leadFrom === "here" ? { leadFrom: /** @type {const} */ ("here") } : {}),
        workers: Array.isArray(b.on?.workers) ? b.on.workers.map(String) : null,
        from: ["picked", "here", "chat", "project", "team"].includes(b.on?.from) ? b.on.from : "seats",
        fell: Array.isArray(b.on?.fell) ? b.on.fell.map((/** @type {any} */ f) => ({ name: String(f?.name ?? f), why: String(f?.why ?? ""), as: f?.as === "lead" ? /** @type {const} */ ("lead") : /** @type {const} */ ("workers"), ...(f?.next ? { next: String(f.next) } : {}) })) : [],
      },
    };
  }

  /**
   * What a team fired beside a chat runs on now — the fire card says it before Send, and a fire does it, in the one
   * sentence of U13-D8: its lead on `model` (the card's pick), else the team's own models for it, else its own card's
   * (U13-D11), else the chat's; its workers on `workers` (the card's pick), else this chat's rows for them, else the
   * team's own models, else the main chat's own list — none, each member's card's, else its lead's model. A model the team or the lead's card names that
   * cannot run now is said with why, never passed over in silence. A pick that cannot run is said the same way,
   * `picked` (the 9 plausible of 10-19: the Brief read a refusal as nothing to say, and a lead's pick was never
   * checked), and a fire refuses it in words.
   * @param {any} main  the main chat @param {import("../services/teams.js").Team} team
   * @param {{ model?: unknown, provider?: unknown, workers?: unknown, workersProvider?: unknown }} [pick]  `provider`,
   *   `workersProvider`: who serves each pick — a provider or a coding agent — where several do (the main agent's)
   * @returns {Promise<BesideOn & { own: { pool?: unknown } | null, pick: string | null }>}
   *   `own`: the main chat's own list for agents, which the team's chat takes; `pick`: the workers' model
   *   picked
   */
  async function runsOn(main, team, pick = {}) {
    const info = sessions.launchInfo(main.id);
    const chatModel = String(info.full || info.model || "") || null;
    /** @param {string} name @param {unknown} [provider] @returns {Promise<{ model: string | null, why: string }>} */
    const choose = async (name, provider) => (await registry()?.modelChoice?.(name, String(provider ?? "").trim() || null)) || { model: null, why: "Filament cannot read its models now" };
    /** @type {{ name: string, why: string, as: "lead" | "workers", next?: string, picked?: boolean }[]} */
    const fell = [];
    const pickLead = String(pick.model ?? "").trim();
    // This chat's own rows for the team (the owner's plan of 11-05): its lead's and its workers', each in order — "" the
    // chat's own model — before the team's own.
    const doc = sessions.settingsOf(main.id);
    const sub = doc?.effective?.subagents || {};
    const mine = sub.byTeam && !byTeamProblem(sub.byTeam) ? sub.byTeam[team.key] || null : null;
    // Each model once — "" the chat's own — at the first effort its rows say, as the chat's list (`seatsOf`, the review of
    // 11-05).
    /** @param {unknown} rows @returns {{ name: string, effort: string | null }[]} */
    const rowsOf = (rows) => {
      /** @type {{ name: string, effort: string | null }[]} */
      const out = [];
      for (const r of Array.isArray(rows) && !poolProblem(rows) ? rows : []) {
        const name = poolName(r.model) || String(chatModel || "");
        const had = out.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (name && !had) out.push({ name, effort: r.effort ? String(r.effort) : null });
        else if (had && !had.effort && r.effort) had.effort = String(r.effort);
      }
      return out;
    };
    let lead = null;
    if (pickLead) {
      const c = await choose(pickLead, pick.provider);
      if (c.model) lead = c.model;
      else fell.push({ name: pickLead, why: c.why, as: "lead", picked: true });
    }
    // Its lead's models, first choice first (the owner's 10-19 list): this chat's own for it, then its team's, then its
    // own card's (U13-D11): the first that can run now; each before it is said with why, and with the one its lead runs
    // on instead.
    const teamLead = team.leadModels?.length ? team.leadModels : team.leadModel ? [team.leadModel] : [];
    const cardLead = /** @type {string[]} */ (registry()?.cardModels?.(team.lead?.tag) || []);
    const cardEfforts = /** @type {Record<string, string>} */ (registry()?.cardEfforts?.(team.lead?.tag) || {});
    /** @type {{ name: string, effort: string | null }[]} */
    const leads = [];
    for (const r of [...rowsOf(mine?.lead).map((x) => ({ ...x, here: true })), ...teamLead.map((name) => ({ name, effort: team.leadEfforts?.[name] || null })), ...cardLead.map((name) => ({ name, effort: cardEfforts[name] || null }))])
      if (r.name && !leads.some((x) => x.name.toLowerCase() === r.name.toLowerCase())) leads.push(r);
    // How hard its lead thinks on the one it runs on, where its row says (the owner's word of 11-05).
    /** @type {string | null} */
    let leadEffort = null;
    let leadHere = false;
    if (!pickLead)
      for (const { name, effort, here } of /** @type {{ name: string, effort: string | null, here?: boolean }[]} */ (leads)) {
        const c = await choose(name);
        if (c.model) {
          lead = c.model;
          leadEffort = effort;
          leadHere = here === true;
          for (const f of fell) if (f.as === "lead") f.next = name;
          break;
        }
        fell.push({ name, why: c.why, as: "lead" });
      }
    lead = lead || chatModel;
    const said = { ...(leadEffort ? { leadEffort } : {}), ...(leadHere ? { leadFrom: /** @type {const} */ ("here") } : {}) };
    const asked = String(pick.workers ?? "").trim();
    let picked = null;
    if (asked) {
      const c = await choose(asked, pick.workersProvider);
      if (c.model) picked = c.model;
      else fell.push({ name: asked, why: c.why, as: "workers", picked: true });
    }
    // The main chat's own list goes with the team to its chat, where it comes after the team's own models (U13-D8): the
    // crews have no list of their own (U13-D14), and a list is a chat's own alone (the owner's word of 11-05). So do its
    // own rows for each card, and for this team's workers.
    // A row that says "" is this chat's own model, as Send says: so it goes, where its chat's model is its lead's (the
    // review of 11-05) — each model once (`rowsOf`).
    /** @param {unknown} rows @returns {{ model: string, effort?: string }[]} */
    const asHere = (rows) => rowsOf(rows).map((r) => ({ model: r.name, ...(r.effort ? { effort: r.effort } : {}) }));
    const source = doc?.sources?.["subagents.pool"];
    const pool = source === "session" ? asHere(sub.pool) : [];
    const byCard = sub.byCard && !byCardProblem(sub.byCard) ? Object.fromEntries(Object.entries(sub.byCard).map(([tag, rows]) => [tag, asHere(rows)]).filter(([, rows]) => rows.length)) : {};
    const workersMine = asHere(mine?.workers);
    const kept = { ...(pool.length ? { pool } : {}), ...(Object.keys(byCard).length ? { byCard } : {}), ...(workersMine.length ? { byTeam: { [team.key]: { workers: workersMine } } } : {}) };
    const own = Object.keys(kept).length ? kept : null;
    if (picked) return { lead, ...said, workers: [picked], from: "picked", fell, own, pick: picked };
    /** @type {string[]} */
    const ran = [];
    for (const { model: name } of workersMine) {
      const c = await choose(name);
      if (c.model && !ran.includes(c.model)) ran.push(c.model);
      else if (!c.model) fell.push({ name, why: c.why, as: "workers" });
    }
    if (ran.length) return { lead, ...said, workers: ran, from: "here", fell, own, pick: null };
    for (const name of team.models) {
      const c = await choose(name);
      if (c.model) ran.push(c.model);
      else fell.push({ name, why: c.why, as: "workers" });
    }
    if (ran.length) return { lead, ...said, workers: ran, from: "team", fell, own, pick: null };
    if (source === "session") return { lead, ...said, workers: pool.map((w) => w.model), from: "chat", fell, own, pick: null };
    return { lead, ...said, workers: null, from: "seats", fell, own, pick: null };
  }

  /**
   * Fire a team beside a chat: its chat made and tied to the main one, its lead sent the person's words after the main
   * chat's record. Refused in words — the team, the words, the main chat — and where its lead's first turn could not
   * start, its chat is taken back.
   * @param {string} mainId
   * @param {{ team?: unknown, ask?: unknown, model?: unknown, provider?: unknown, workers?: unknown, workersProvider?: unknown, range?: unknown, effort?: unknown, workersEffort?: unknown, verify?: unknown, notify?: unknown, by?: unknown, of?: unknown, auto?: unknown, reads?: unknown, images?: readonly { mediaType: string, data: string }[], flow?: unknown, handoff?: unknown, readOnly?: unknown, own?: unknown }} input
   *   `range`: what a hunt hunts in (the plan's p6, core/hunt-range.js) — a diff, a commit range or files, in words;
   *   none, what is uncommitted and the files the main chat changed — read from git into its lead's opening, its files
   *   with their lines and how to read each diff, none named as its lead's first turn starts, which waits for it; one
   *   that names nothing, or a ref git does not know, refused in words;
   *   given to a team that hunts no bugs, or to a check or a flow's box, refused;
   *   `model`: its lead's, else the team's own, else its lead's card's, else the main chat's; `workers`: the model its
   *   workers run on this time, else the team's own models, else each member's card's, else the main chat's own list,
   *   else its lead's model (U13-D8); `provider`, `workersProvider`: who serves each of the two,
   *   where several do — the main agent's tool names them (the owner's of 10-30); `by`: "agent", a fire of the main agent's own, which takes
   *   only the teams its chat lets it (`subagents.teams`, U13-D9);
   *   `effort`: how hard its lead thinks this time, on its model's name — the highest level it takes at or below it — else
   *   the main agent's (the owner's word of 11-05); `workersEffort`: how hard its workers think where their lead names
   *   none, else as hard as its lead, whose they inherit (one of SUBAGENT_EFFORTS each); `of`: the team chat whose result this one checks, `auto` with it where Then verify sent it (`verify`); `reads`: "words" — a fresh start, its lead reading the person's
   *   words alone, none of the main chat (the owner's ask of 10-19: "what if i wanted a fresh bug hunter without any
   *   history") — else the main chat's record first; `images`: pictures that go with its ask, after its words. A
   *   flow's box (HarnessV4_Flow_Plan F2): `by: "flow"`, the person's — they pressed Start —
   *   with `flow` (its flow and its box), `handoff` (the flow's words and every result before the box, a part of its own
   *   ahead of the ask, past the 4,000 a Brief's words take), `readOnly` (the box drawn Reads only), and `own` — where it
   *   works (HarnessV4_OneAgent_Plan OA5): `{ name }`, the flow's first box that writes, makes the flow's git worktree
   *   from the main chat's folder, that name or the first free one — `bring`, with a copy of the folder's uncommitted
   *   files in it, uncommitted, before its lead starts (a copy that fails takes the worktree back and refuses the fire
   *   with `bring: true` on the refusal); `{ use }`, a box after it, works in that one; it
   *   leaves no mark in the main chat, and its result is the flow's runner's to hand on
   * @returns {Promise<BesideRow>}
   */
  async function fire(mainId, input = {}) {
    const a = archive();
    const main = a.getChain(String(mainId || ""));
    if (!main) throw refused(404, "no such session");
    if (main.kind === "team") throw refused(400, "a team beside sends no team of its own: send it from its main chat");
    // While teams are off none is sent — the person's, the main agent's, a flow's box — but the check Then verify sends
    // on the result of a team that was at work (`verify`'s `auto`): the end of that team's work, which finishes.
    if (!teamsOn() && !(input.of != null && input.auto === true)) throw refused(400, TEAMS_OFF);
    const team = teams.find(input.team);
    if (!team) {
      const folded = foldedTeamWords(input.team);
      throw refused(404, folded ? `no team answers to "${String(input.team ?? "")}": ${folded}` : `no team answers to "${String(input.team ?? "")}": Library › Agents and teams lists them`);
    }
    const by = input.by === "agent" ? "agent" : input.by === "flow" ? "flow" : "you";
    const flow = by === "flow" && input.flow && typeof input.flow === "object" ? { id: String(/** @type {any} */ (input.flow).id || ""), box: String(/** @type {any} */ (input.flow).box || "") } : null;
    if (by === "flow" && (!flow?.id || !flow.box)) throw refused(400, "a flow's send names its flow and its box");
    const handoff = input.handoff == null ? "" : String(input.handoff).replace(/\r\n?/g, "\n").trim();
    if (handoff && by !== "flow") throw refused(400, "a hand-off rides with a flow's box alone");
    if (handoff.length > BESIDE_LIMITS.handoff) throw refused(400, `a flow's hand-off is ${BESIDE_LIMITS.handoff} characters at most; this is ${handoff.length}`);
    const readOnly = team.readOnly === true || input.readOnly === true;
    // The main agent fires by itself only the teams its chat lets it (U13-D9); a check of a result fired on a switch or
    // a press (`of`) is the person's.
    if (by === "agent" && input.of == null && !agentMay(main.id).includes(team.key)) {
      const may = agentMay(main.id).map((k) => teams.find(k)?.name || k);
      throw refused(403, `the ${team.name} team is not one this chat lets you send by yourself — the person decides which${may.length ? ` (you may send: ${may.join(", ")})` : " (you may send none)"}. Say in your answer which team you would send, and why`);
    }
    // A check's words carry the result it checks, whole: a check's room, where the person's words have theirs.
    const problem = askProblem(input.ask, input.of == null ? BESIDE_LIMITS.ask : BESIDE_LIMITS.check);
    if (problem) throw refused(400, problem);
    const ask = String(input.ask).replace(/\r\n?/g, "\n").trim();
    const effort = effortIn(input.effort, "lead");
    const workersEffort = effortIn(input.workersEffort, "workers");
    const of = input.of == null ? null : String(input.of);
    if (of && archive().mainOf(of) !== main.id) throw refused(400, "the result to check is no team's beside this chat");
    // A result that comes checked is checked by none, whoever asks: Verify… and a fire that names it alike.
    const checks = of ? besideOf(archive().getChain(of)) : null;
    if (checks && resultChecked(checks.team)) throw refused(409, checkedByNone(String(checks.name || checks.team)));
    // A hunt's range (the plan's p6). One it names is read from git at the fire, refused in words where it names nothing or a ref
    // git does not know; none named — what is uncommitted and what the main chat changed — is never refused, so it is
    // read as its lead starts, and its first message waits for it. A check reads the claims it is given, and a flow's
    // box its hand-off: neither hunts in a range.
    const hunt = huntsIn(team) && !of && by !== "flow";
    const rangeNamed = input.range != null && !(typeof input.range === "string" && !input.range.trim());
    if (rangeNamed && !hunt) throw refused(400, !huntsIn(team) ? `the ${team.name} team hunts no bugs: leave range out` : of ? "a check reads the claims it is given: leave range out" : "a flow's box hunts in what its flow hands it: leave range out");
    /** @type {import("../core/hunt-range.js").HuntRange | null} */
    let range = null;
    if (hunt && rangeNamed && sessions.huntRange) {
      const r = await sessions.huntRange(main.id, input.range);
      if (!r.ok) throw refused(400, `the range cannot be hunted in: ${r.error}`);
      range = r.range;
    }
    /** The range's facts as the team chat keeps them. @param {import("../core/hunt-range.js").HuntRange} x */
    const rangeKept = (x) => ({ kind: x.kind, label: x.label, files: x.files.length });
    const info = sessions.launchInfo(main.id);
    const { own, pick, ...on } = await runsOn(main, team, { model: input.model, provider: input.provider, workers: input.workers, workersProvider: input.workersProvider });
    const off = on.fell.find((f) => f.picked);
    if (off) throw refused(400, `${off.name} cannot run now (${off.why}): pick another model for its ${off.as === "lead" ? "lead" : "workers"}`);
    const model = on.lead;
    if (!model) throw refused(400, "the main chat has no model, and the team names none for its lead: pick its lead's model");
    // Its lead's model is its chat's own, and a chat's own model that names its coding agent's mode runs in it, asking
    // nobody (acp-turn.js). A press sets such a name on a chat (http/admin/press.js); none set this one — it is the
    // fire's, the team's own list's or the main agent's —, so it is refused, as a thread's is (threads.js). The main
    // chat's own model, mode and all, is the person's: a lead on the same runs as that chat does.
    if (namesMode(model) && model !== String(info.full || info.model || ""))
      throw refused(400, `name its lead's model alone: a team beside a chat asks as that chat does, so its coding agent's mode (${model}) is not named`);
    // A name with no mode in it whose route sets one names it all the same (engine.js `agentModeOf`; the second read of
    // 11-12), unless it is the main chat's own.
    const routed = model === String(info.full || info.model || "") ? null : modeOf?.(model) ?? null;
    if (routed) throw refused(400, `${model} sets its coding agent's mode (${routed}) by its route, and a team beside a chat asks as that chat does: pick another model for its lead`);
    // Its lead at the effort picked, else the main agent's (the owner's word of 11-05), as its chat keeps one: beside its
    // name where its model takes a setting — so an effort your defaults hold never beats it —, its member at that level
    // where its ids spell it; none (`model`), its model's own. Inherited, a level its model's name spells is kept (the
    // review of 11-05). Its crew inherits its lead's, as any agent its main agent's, where its Brief picks none.
    // A row of its lead's models that says how hard it thinks on it comes after the pick, before the main agent's.
    const named = effort || on.leadEffort || null;
    const inherited = named ? null : registry().mainEffort?.(main.id, model) || { level: "model", asked: false };
    const leadEffort = named || inherited?.level || "model";
    const lead = leadEffort !== "model" && chatEffortOf ? chatEffortOf(model, leadEffort, !!named || !!inherited?.asked) : { name: model, effort: null };
    // Its switches: as the fire says them, else — a fire of the main agent's, which says none — as set ahead. A team
    // whose result comes checked has it checked by none, whatever the chat or the team says ahead.
    const ahead = by === "agent" ? firedAhead(main.id, team) : { notify: false, verify: false };
    const verify = !resultChecked(team.key) && (typeof input.verify === "boolean" ? input.verify : ahead.verify);
    const notify = typeof input.notify === "boolean" ? input.notify : ahead.notify;
    const at = now();
    const fresh = input.reads === "words";
    const record = fresh ? null : await sessions.recordFor(main.id, { model, team: team.name });
    // The fire card's pick for its workers, and the main chat's own list, go with it: its workers take the pick, else the
    // team's own models, else that list (U13-D8, D14).
    const settings = {
      model: { effort: lead.effort },
      engine: { mode: "team", team: team.key, ...(pick ? { teamWorkers: pick } : {}), ...(workersEffort ? { teamEffort: workersEffort } : {}) },
      ...(readOnly ? { loop: { permissions: "read-only" } } : {}),
      ...(own ? { subagents: own } : {}),
    };
    // A flow's boxes work in a git worktree of the flow's own from its first team box that writes on, made from the main
    // chat's folder (HarnessV4_OneAgent_Plan OA5): never in the files the main agent works in. Outside git that box works
    // in the folder, and says so (OA-D13); a worktree that cannot be made otherwise refuses the fire in words.
    /** @type {import("../core/flow.js").BoxPlace | null} */
    let place = null;
    /** @type {{ name: string, branch: string, folder: string, cwd: string, main: string, place: string, commit: string } | null} */
    let made = null;
    /** @type {any} */
    const where = flow && input.own && typeof input.own === "object" ? input.own : null;
    const use = where?.use && typeof where.use === "object" && where.use.kind === "worktree" ? where.use : null;
    /** A worktree its chat will not use goes back. */
    const letGo = async () => {
      if (!made || !places) return;
      const stays = await places.takeBack(made).catch((/** @type {any} */ e) => String(e?.message || e));
      log(stays ? "warn" : "info", `teams beside: the worktree ${made.folder} taken back${stays ? `; ${stays}` : ""}`);
    };
    if (use) {
      if (places?.here && !places.here(String(use.cwd || ""))) throw refused(409, `its flow's worktree ${String(use.folder || use.cwd || "")} is gone: put it back, or start the flow again`);
      place = { kind: "worktree", name: String(use.name || ""), branch: String(use.branch || ""), folder: String(use.folder || ""), cwd: String(use.cwd || "") };
    } else if (where?.name && !readOnly && places) {
      const got = await places.own(info.cwd, String(where.name));
      if (got.ok) {
        made = got;
        place = { kind: "worktree", name: got.name, branch: got.branch, folder: got.folder, cwd: got.cwd };
        log("info", `teams beside: the worktree ${got.folder} made on branch ${got.branch} for the ${team.name} team's flow box`);
        // Bring my uncommitted edits: the folder's uncommitted files copied in before its lead reads a file. A copy that
        // fails takes the worktree back and refuses the fire: its team would build on less than the person asked for.
        // The refusal says it was the copy's (`bring`), so the flow's box can offer to start again without it.
        if (where.bring === true) {
          const copied = places.bring ? await places.bring(got).catch((/** @type {any} */ e) => ({ ok: /** @type {const} */ (false), error: String(e?.message || e) })) : { ok: /** @type {const} */ (false), error: "Filament cannot copy files into it here" };
          if (!copied.ok) {
            await letGo();
            throw Object.assign(refused(409, `your uncommitted edits could not be brought into its worktree: ${copied.error}`), { bring: true });
          }
          place.brought = { files: copied.files.length, stays: copied.stays };
          log("info", `teams beside: ${copied.files.length} uncommitted file${copied.files.length === 1 ? "" : "s"} of ${got.place} copied into ${got.folder}${copied.stays.length ? `; ${copied.stays.length} not plain files stayed` : ""}`);
        }
      } else if (got.outside) place = { kind: "folder", folder: info.cwd, why: got.outside };
      else throw refused(409, `its worktree could not be made: ${got.error || "git said no more"}`);
    }
    const cwd = place?.kind === "worktree" ? place.cwd : info.cwd;
    /** @type {any} */
    let chat;
    try {
      chat = sessions.create({ cwd, model: lead.name, kind: "team", beside: main.id, title: `${team.name}: ${shortOf(flow ? ask.replace(/^Your part:\s*/, "").split(/\n\s*\n/)[0] : ask, 80)}`, settings });
    } catch (/** @type {any} */ e) {
      await letGo();
      throw e;
    }
    if (made) places?.template?.(chat.id, made);
    // A flow's box is the person's (they pressed Start): its card says "you" fired it, and its flow is kept beside.
    a.mergeMeta(chat.id, {
      beside: {
        team: team.key, name: team.name, ask, firedBy: by === "agent" ? "agent" : "you", at, verify, notify, of, readOnly, on,
        ...(range ? { range: rangeKept(range) } : {}),
        ...(fresh ? { fresh: true } : {}), ...(flow ? { flow } : {}), ...(place ? { place } : {}),
      },
    });
    // None named: read from git as its lead's first turn holds the chat, which sets it in once read.
    const later =
      hunt && !rangeNamed && sessions.huntRange && sessions.openingAfter
        ? sessions.openingAfter(
            chat.id,
            Promise.resolve(sessions.huntRange(main.id, null)).then((/** @type {any} */ x) => {
              if (!x?.ok || !x.range) return null;
              note(chat.id, { range: rangeKept(x.range) });
              return { type: "text", text: rangeBlock(x.range) };
            }),
          )
        : null;
    /** @type {{ status: number, body: any }} */
    let r;
    try {
      const pictures = (Array.isArray(input.images) ? input.images : []).map((p) => imageBlock(p.mediaType, p.data));
      const posting = postTurn(chat.id, { by: "team", content: [...openingContent({ record, ask, handoff, range: range ? rangeBlock(range) : null }), ...pictures] });
      // Its lead has started once its turn holds the chat and waits for its range: the fire answers then.
      r = later ? await Promise.race([posting, later.taken.then(() => ({ status: 202, body: null }))]) : await posting;
      if (later) void posting.catch(() => {});
    } catch (/** @type {any} */ e) {
      r = { status: 502, body: { error: String(e?.message || e) } };
    }
    if (r.status < 200 || r.status >= 300) {
      later?.drop();
      // Its template still copying in ends first, as a move taken back ends it (sessions/move.js): a copy that went on
      // would write the folder back as the worktree is taken away, and hold its files open on Windows.
      if (made) await Promise.resolve(places?.untemplate?.(chat.id, "its team's lead could not start")).catch(() => {});
      await remove(chat.id).catch((/** @type {any} */ e) => log("warn", `teams beside: the chat of a team that could not start stays (${e?.message || e})`));
      await letGo();
      throw refused(r.status >= 400 && r.status < 500 ? r.status : 502, `the ${team.name} team's lead could not start: ${String(r.body?.error || `HTTP ${r.status}`)}`);
    }
    // A flow's box leaves no mark in the main chat: the flow's card is where it shows (FL-D10).
    const mark = flow ? null : sessions.teamMark(main.id, { event: "fired", id: chat.id, at });
    if (of) note(of, { verifiedBy: chat.id });
    log("info", `teams beside: the ${team.name} team sent beside ${main.id} by ${by === "agent" ? "its main agent" : by === "flow" ? `the person's flow ${flow?.id}` : "the person"} (${chat.id})`);
    said(main.id, chat.id, "fired", mark);
    return /** @type {BesideRow} */ (rowOf(chat.id));
  }

  /**
   * A team's result to its main agent: into its running turn — sealed while its agent works, where that turn reads
   * Filament's inbox (EN4) — else a turn of Filament's own; held while a turn or a question holds the chat, and sent when
   * it ends. Its envelope says the team and its lead's subject line, else Filament's (EN-D3).
   * @param {string} id @param {{ auto?: boolean }} [o]  `auto`: the team's switch sent it, not a press
   * @returns {Promise<{ how: Delivered }>}
   */
  async function notify(id, { auto = false } = {}) {
    const a = archive();
    const chain = a.getChain(String(id || ""));
    const b = besideOf(chain);
    if (!chain || !b) throw refused(404, "no team beside answers to that id");
    const main = a.mainOf(chain.id);
    if (!main || !a.getChain(main)) throw refused(409, "its main chat is gone");
    const f = sessions.besideFacts(chain.id);
    if (!f.last?.final) throw refused(409, "the team has no result yet");
    const n = Number(f.last.n) || 0;
    const row = rowOf(chain.id);
    if (row?.notified) throw refused(409, "its result already went to the main agent");
    const checked = b.of ? besideOf(a.getChain(b.of)) : null;
    const name = String(b.name || b.team);
    const of = checked ? { name: String(checked.name || checked.team) } : null;
    const text = resultMessage({ name, ask: String(b.ask || ""), firedBy: b.firedBy === "agent" ? "agent" : "you", result: f.last.text, checked: of, auto, pictures: picturesLine(main, f.last.drew) });
    const envelope = { description: `the ${name} team`, sender: resultSender({ name, checked: of }), subject: subjectOf(f.last.text) || resultSubject({ ask: String(b.ask || ""), result: f.last.text }), via: /** @type {const} */ ("team") };
    notifying.set(main, (notifying.get(main) || 0) + 1);
    /** @type {Delivered} */
    let how;
    try {
      how = await deliver(main, { id: chain.id, n, text, envelope, auto });
    } finally {
      const left = (notifying.get(main) || 1) - 1;
      if (left > 0) notifying.set(main, left);
      else notifying.delete(main);
    }
    note(chain.id, { notified: { n, at: now(), how } });
    said(main, chain.id, "notified");
    return { how };
  }

  /**
   * One result to its main chat: into the turn running there — its inbox, as a sub-agent's report goes, where it reads
   * Filament's (EN4), else a note — or a turn of Filament's own; held until the chat is free where neither can take it
   * now. A result handed into a turn that ends before it reads it comes back here, and waits for the chat to be free.
   * @param {string} main @param {Result} d
   * @returns {Promise<Delivered>}
   */
  async function deliver(main, d) {
    if (reach.busy(main)) {
      const back = () => {
        park(main, d);
        if (!d.sent) note(d.id, { notified: { n: d.n, at: now(), how: "waits" } });
        said(main, d.id, "notified");
        log("info", `teams beside: ${main}'s turn ended before it read the result of ${d.id}; it goes as a turn of its own once the chat is free`);
      };
      const handed = d.envelope ? registry()?.hand?.(main, { ...d.envelope, id: d.id, text: d.text, back }) : null;
      if (handed?.ok) return handed.sealed ? "envelope" : "steered";
      if (reach.steer(main, d.text).ok) return "steered";
      park(main, d);
      return "waits";
    }
    const out = await send(main, d);
    if (out === "wait") {
      park(main, d);
      return "waits";
    }
    return "sent";
  }

  /**
   * One result as a turn of its own. → "done" once it went; "wait" while a turn or a question holds the chat; a
   * refusal for good is thrown, in the route's words.
   * Then notify's own send (`auto`) starts no turn in a chat the person archived, or one of a project they archived
   * (s-itself, 11-12: the chats' one rule, sessions/service.js `notByItself`): refused in the words a wake is, so the
   * result stands on its card as one that reached nobody, with why (`missedOn`, `flush`) — nothing of it lost, and the
   * person's Send to your agent… sends it still. One that came while a turn of the chat ran rode that turn (`deliver`).
   * @param {string} main @param {{ id: string, n: number, text: string, auto?: boolean }} d @returns {Promise<"done" | "wait">}
   */
  async function send(main, d) {
    const alone = d.auto ? sessions.notByItself?.(main) : null;
    if (alone) throw refused(409, `the result could not reach the main agent: ${archivedSaid(alone)}, and Filament starts no turn in it by itself`);
    const r = await reach.post(main, d.text);
    if (r.status >= 200 && r.status < 300) return "done";
    if (r.status === 409 && (r.body?.beside === "asking" || r.body?.holder)) return "wait";
    throw refused(r.status >= 400 && r.status < 500 ? r.status : 502, `the result could not reach the main agent: ${String(r.body?.error || `HTTP ${r.status}`)}`);
  }

  /** @param {string} main @param {Result} d */
  function park(main, d) {
    const list = (waiting.get(main) || []).filter((w) => w.id !== d.id);
    waiting.set(main, [...list, d]);
    if (!reach.busy(main)) void flush(main, 0);
  }

  /**
   * The results waiting for a main chat go, one turn each, once its turn has let go of it; one still held waits for the
   * next end.
   * @param {string} main @param {number} settle
   */
  async function flush(main, settle) {
    if (closed || !waiting.get(main)?.length) return;
    if (sending.has(main)) {
      askedMeanwhile.add(main);
      return;
    }
    sending.add(main);
    try {
      if (settle) await new Promise((r) => setTimeout(r, settle).unref?.());
      const d = waiting.get(main)?.[0];
      if (closed || !d || reach.busy(main)) return;
      try {
        if ((await send(main, d)) === "wait") return;
        if (d.sent) d.sent("sent");
        else note(d.id, { notified: { n: d.n, at: now(), how: "sent" } });
      } catch (/** @type {any} */ e) {
        if (d.sent) d.sent(null, String(e?.message || e));
        else note(d.id, { notified: null, missed: { n: d.n, why: String(e?.message || e) } });
        log("warn", `teams beside: a result for ${main} was refused (${e?.message || e}); ${d.sent ? "its flow offers Send again" : "its card offers Notify again"}`);
      }
      waiting.set(main, (waiting.get(main) || []).filter((w) => w !== d));
      said(main, d.id, "notified");
    } catch (/** @type {any} */ e) {
      // A flush runs on its own, after a turn or a park, with no one to answer: what fails is logged, and the result
      // stays for the chat's next end.
      log("warn", `teams beside: the results waiting for ${main} could not go (${e?.message || e})`);
    } finally {
      sending.delete(main);
      if (askedMeanwhile.delete(main)) void flush(main, settleMs);
    }
    // The next one waits for the turn this one started to end.
  }

  /**
   * A team chat looked at again: its card said, and a new result recorded on its main chat — where the team's switches
   * act on its first: Then verify fires BugHunters, else Then notify sends the result on.
   * @param {string} id
   */
  function look(id) {
    const a = archive();
    const chain = a.getChain(id);
    const b = besideOf(chain);
    const main = b ? a.mainOf(id) : null;
    if (!chain || !b || !main) return;
    const row = rowFrom(chain);
    if (!row) return;
    said(main, id, "state");
    // A flow's box: its runner hears the state said and hands the result on; the main chat gets no mark of it.
    if (b.flow) return;
    if (row.state !== "done" || !row.result || Number(b.ended) === row.result.n) return;
    note(id, { ended: row.result.n, endedAt: now() });
    let mark = null;
    try {
      mark = sessions.teamMark(main, { event: "result", id, at: now() });
    } catch (/** @type {any} */ e) {
      log("warn", `teams beside: a result's mark on ${main} could not be kept (${e?.message || e})`);
    }
    said(main, id, "result", mark);
    if (b.auto) return;
    note(id, { auto: true });
    // A check that does not start leaves Then notify to the result itself: the main agent hears it unchecked, not
    // nothing (found by the Bug Hunter, 10-19). A result that comes checked is checked by none.
    if (b.verify && !resultChecked(b.team)) {
      void verify(id, { auto: true }).catch((/** @type {any} */ e) => {
        log("warn", `teams beside: Then verify did not start for ${id} (${e?.message || e})${b.notify ? "; Then notify sends its result unchecked" : ""}`);
        if (b.notify) return notify(id, { auto: true }).catch((/** @type {any} */ e2) => missedOn(id, row.result?.n, e2));
      });
      return;
    }
    if (b.notify) void notify(id, { auto: true }).catch((/** @type {any} */ e) => missedOn(id, row.result?.n, e));
  }

  /**
   * Then notify's send that did not go: kept on the team's chat, so its card and the team tool say it reached nobody.
   * @param {string} id @param {number | undefined} n  the result's turn @param {any} e
   */
  function missedOn(id, n, e) {
    const main = archive().mainOf(id);
    log("warn", `teams beside: Then notify did not reach ${main} (${e?.message || e})`);
    note(id, { missed: { n: Number(n) || 0, why: String(e?.message || e) } });
    if (main) said(main, id, "state");
  }

  /**
   * BugHunters fired on a team's result, as the claims to check (Verify… where it is pressed and sent, Then verify where
   * it was switched on): the team's Notify switch goes with it, so the check is what reaches the main agent.
   * Then verify (`auto`) sends no team beside a chat the person archived, or one of a project they archived (s-itself,
   * 11-12, as `send`): the person's Verify… sends it still.
   * @param {string} id @param {{ auto?: boolean, model?: unknown, ask?: unknown }} [o]
   */
  async function verify(id, { auto = false, model = null, ask = null } = {}) {
    const a = archive();
    const chain = a.getChain(String(id || ""));
    const b = besideOf(chain);
    if (!chain || !b) throw refused(404, "no team beside answers to that id");
    const main = a.mainOf(chain.id);
    if (!main) throw refused(409, "its main chat is gone");
    const alone = auto ? sessions.notByItself?.(main) : null;
    if (alone) throw refused(409, `${archivedSaid(alone)}, and Filament sends no team beside it by itself`);
    const f = sessions.besideFacts(chain.id);
    if (!f.last?.final) throw refused(409, "the team has no result to check yet");
    if (resultChecked(b.team)) throw refused(409, checkedByNone(String(b.name || b.team)));
    const words = ask == null ? verifyAsk({ name: String(b.name || b.team), ask: String(b.ask || ""), result: f.last.text }) : ask;
    return fire(main, { team: BUGHUNTERS, ask: words, model, by: b.firedBy, verify: false, notify: auto ? b.notify === true : false, of: chain.id, ...(auto ? { auto: true } : {}) });
  }

  /**
   * Stop a team beside: its lead's running turn and every worker of its.
   * @param {string} id
   */
  function stop(id) {
    const chain = archive().getChain(String(id || ""));
    if (!besideOf(chain)) throw refused(404, "no team beside answers to that id");
    const turn = sessions.cancelTurn(chain.id);
    let workers = 0;
    for (const s of registry()?.list(chain.id) || []) if (s.status === "running" && registry().stop(s.id).ok) workers += 1;
    return { turn, workers };
  }

  // A team's workers changed: its card is looked at again, a moment after a burst. Every chat's agents' events come
  // here, a running agent's progress twice a second: whether the chat is a team's is read off its head alone.
  const unsubscribe = events.subscribe?.("subagents", (msg) => {
    const chain = String(msg?.chainId || "");
    if (!chain || looks.has(chain)) return;
    looks.set(chain, setTimeout(() => {
      looks.delete(chain);
      try {
        if (archive().chainHead(chain)?.kind === "team") look(chain);
      } catch (/** @type {any} */ e) {
        log("warn", `teams beside: ${chain} could not be looked at (${e?.message || e})`);
      }
    }, LOOK_MS));
    looks.get(chain)?.unref?.();
  });

  /**
   * The teams a developer's message to its main agent names with an `@` past its start, which the page found
   * (HarnessV4_OneAgent_Plan OA2): each team once, in the message's order — none started; the main agent is told to
   * use them (core/messages.js `useLine`). A key no team holds is the message's own text, and so is every key while
   * teams are off.
   * @param {unknown} keys @returns {{ key: string, name: string }[]}
   */
  function usesOf(keys) {
    /** @type {{ key: string, name: string }[]} */
    const out = [];
    if (!teamsOn()) return out;
    for (const k of Array.isArray(keys) ? keys : []) {
      const team = teams.find(String(k ?? "").trim().replace(/^@/, ""));
      if (team && !out.some((t) => t.key === team.key)) out.push({ key: team.key, name: team.name });
    }
    return out;
  }
  /**
   * The developer's message to a chat's main agent, read for the teams it names — by name or key, with an `@` or
   * without, never inside code or a longer name (services/agent-cards.js `cardsNamedIn`): the main agent may start them
   * while it is their newest; a note into the running turn (`add`) adds its own. Their keys. While teams are off a
   * message names none, and the chat keeps none: turned on again, a team an older message named is not the agent's.
   * @param {string} mainId @param {unknown} text @param {{ add?: boolean }} [o] @returns {string[]}
   */
  function heard(mainId, text, { add = false } = {}) {
    const on = teamsOn();
    const all = on ? teams.list() : [];
    const keys = on ? cardsNamedIn(text, all.map((t) => ({ tag: t.key, name: t.name })), all.map((t) => t.name)) : [];
    const next = new Set([...(add && on ? heardOf(String(mainId)) : []), ...keys]);
    heardTeams.set(String(mainId), next);
    try {
      if (archive().getChain(String(mainId))) archive().mergeMeta(String(mainId), { heardTeams: [...next] });
    } catch (/** @type {any} */ e) {
      log("warn", `teams beside: ${mainId}: the teams its message named were not kept (${e?.message || e})`);
    }
    return keys;
  }
  /**
   * The teams a chat's main agent fired by itself since a moment (HarnessV4_OneAgent_Plan OA-D12): their keys, what a
   * turn's line on a team it was named and did not start reads.
   * @param {string} mainId @param {number} since @returns {Set<string>}
   */
  const usedSince = (mainId, since) =>
    new Set(/** @type {BesideRow[]} */ (archive().besideOf(String(mainId || "")).map(rowOf).filter(Boolean)).filter((r) => r.firedBy === "agent" && r.at >= since).map((r) => r.team.key));

  /**
   * A note of the main agent's for the lead of a team at work (the owner's of 10-30): one line into its running turn,
   * read at its next step, as a steer goes — never a turn of its own. The newest of team `key` beside the main chat
   * whose lead's turn runs (`noteFor`, by `besideFacts`' `busy`: not one at work only as its workers finish, nor one whose
   * lead asks the person — their turns have ended); refused in words where none does, nothing sent.
   * @param {string} mainId @param {unknown} key @param {unknown} text @returns {BesideRow}
   */
  function noteLead(mainId, key, text) {
    const main = archive().getChain(String(mainId || ""));
    if (!main) throw refused(404, "no such session");
    const team = teams.find(key);
    if (!team) throw refused(404, `no team answers to "${String(key ?? "")}": status lists the teams beside this chat`);
    const words = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!words) throw refused(400, "a note says in a line what its lead is to know");
    if (words.length > BESIDE_LIMITS.note) throw refused(400, `a note is ${BESIDE_LIMITS.note} characters at most; this is ${words.length}`);
    const mine = /** @type {BesideRow[]} */ (archive().besideOf(main.id).map(rowOf).filter(Boolean)).filter((r) => r.team.key === team.key).sort((a, b) => b.at - a.at);
    const to = noteFor(mine, team.name, words, (r) => !!sessions.besideFacts(r.id).busy);
    if (!to.ok) throw refused(409, to.error);
    const r = reach.steer(to.row.id, to.text);
    if (!r.ok) throw refused(409, r.error || "its lead's turn takes no note now");
    return to.row;
  }

  return {
    fire,
    noteLead,
    agentMay,
    usesOf,
    heard,
    usedSince,
    /**
     * What a team would run on beside a chat now, for its fire card. @param {string} mainId @param {unknown} key
     * @param {{ model?: unknown, workers?: unknown }} [pick]
     */
    async runsOn(mainId, key, pick = {}) {
      const main = archive().getChain(String(mainId || ""));
      if (!main) throw refused(404, "no such session");
      const team = teams.find(key);
      if (!team) throw refused(404, `no team answers to "${String(key ?? "")}": Library › Agents and teams lists them`);
      const { own: _own, pick: _pick, ...on } = await runsOn(main, team, pick);
      return on;
    },
    notify,
    /**
     * One message of Filament's own to a main chat's agent, as a team's result goes (HarnessV4_Flow_Plan F2: a flow's
     * end): into its running turn — sealed while its agent works, where `envelope` names it (EN4) — else a turn of its
     * own; held while a turn or a question holds the chat and sent once it ends — `sent` hears then where it went. A
     * refusal for good is thrown.
     * @param {string} main @param {{ id: string, text: string, envelope?: EnvelopeWords, sent: (how: "sent" | null, why?: string) => void }} d
     */
    deliverOwn: (main, d) => deliver(String(main || ""), { id: String(d.id), n: 0, text: String(d.text), ...(d.envelope ? { envelope: d.envelope } : {}), sent: d.sent }),
    /**
     * A team's result whole (team_v2_plan §10 O3): for Open beside — its text and its findings — and for Send to your
     * agent…, which puts `message` (the words Notify sends) in the main chat's box, where the person's Send sends it.
     * @param {string} id
     */
    result(id) {
      const chain = archive().getChain(String(id || ""));
      const b = besideOf(chain);
      if (!chain || !b) throw refused(404, "no team beside answers to that id");
      const f = sessions.besideFacts(chain.id);
      if (!f.last?.final) throw refused(409, "the team has no result yet");
      const checked = b.of ? besideOf(archive().getChain(b.of)) : null;
      const text = String(f.last.text || "");
      const name = String(b.name || b.team);
      const firedBy = b.firedBy === "agent" ? "agent" : "you";
      return {
        id: chain.id,
        n: Number(f.last.n) || 0,
        team: { key: String(b.team), name: teams.find(b.team)?.name || name },
        ask: String(b.ask || ""),
        firedBy,
        at: Number(f.last.endedAt) || null,
        text,
        findings: findingsOf(text),
        message: resultMessage({ name, ask: String(b.ask || ""), firedBy, result: text, checked: checked ? { name: String(checked.name || checked.team) } : null, auto: false, pictures: picturesLine(archive().mainOf(chain.id), f.last.drew) }),
      };
    },
    /**
     * Its result went to the main agent from the main chat's box (team_v2_plan §10 O3: Send to your agent… fills the box,
     * the person's Send sends it): its card says so from now on. `how`: steered into the running turn, or sent as a turn.
     * @param {string} id @param {{ n?: unknown, how?: unknown }} input
     */
    sent(id, input = {}) {
      const chain = archive().getChain(String(id || ""));
      const b = besideOf(chain);
      if (!chain || !b) throw refused(404, "no team beside answers to that id");
      const how = input.how === "steered" ? "steered" : input.how === "sent" ? "sent" : null;
      if (!how) throw refused(400, "how is steered (into the running turn) or sent (a turn of its own)");
      const f = sessions.besideFacts(chain.id);
      const n = Number(f.last?.n) || 0;
      if (!f.last?.final || Number(input.n) !== n) throw refused(409, "that is not the team's newest result");
      note(chain.id, { notified: { n, at: now(), how } });
      const main = archive().mainOf(chain.id);
      if (main) said(main, chain.id, "notified");
      return /** @type {BesideRow} */ (rowOf(chain.id));
    },
    verify,
    stop,
    /**
     * A team on the side deleted from the Agents tab (the owner's ask of 10-23): its own chat goes, as the archive's
     * Delete takes a chat — its lead's and its workers' threads with it. One whose lead asks the person is stopped
     * first; one at work is refused, to stop first. A flow's team box goes with its flow alone (`flow`: the flow
     * runner's delete).
     * @param {string} id @param {{ flow?: boolean }} [o] @returns {Promise<{ ok: true, id: string }>}
     */
    async drop(id, { flow = false } = {}) {
      const row = rowOf(id);
      if (!row) throw refused(404, "no team beside answers to that id");
      if (row.flow && !flow) throw refused(409, "it is a box of a flow: it goes with its flow");
      if (row.state === "working") throw refused(409, "it is at work: stop it first");
      if (row.state === "asking") stop(row.id);
      await remove(row.id);
      if (row.main) said(row.main, row.id, "removed");
      log("info", `teams beside: the ${row.team.name} team's chat ${row.id} deleted`);
      return { ok: true, id: row.id };
    },
    /** @param {string} id */
    row: rowOf,
    /** The teams beside a chat, the newest first. @param {string} mainId @returns {BesideRow[]} */
    list: (mainId) => /** @type {BesideRow[]} */ (archive().besideOf(String(mainId || "")).map(rowOf).filter(Boolean)),
    /**
     * A team's switches flipped while it works (§5.5: both can be flipped on its card): they act on its first result.
     * @param {string} id @param {{ verify?: unknown, notify?: unknown }} input
     */
    set(id, input) {
      const chain = archive().getChain(String(id || ""));
      const b = besideOf(chain);
      if (!b) throw refused(404, "no team beside answers to that id");
      /** @type {Record<string, boolean>} */
      const patch = {};
      for (const k of /** @type {const} */ (["verify", "notify"])) {
        if (input?.[k] === undefined) continue;
        if (typeof input[k] !== "boolean") throw refused(400, `${k} is true or false`);
        patch[k] = input[k];
      }
      if (patch.verify && resultChecked(b.team)) throw refused(409, checkedByNone(String(b.name || b.team)));
      note(chain.id, patch);
      const main = archive().mainOf(chain.id);
      if (main) said(main, chain.id, "switches");
      return /** @type {BesideRow} */ (rowOf(chain.id));
    },
    /**
     * How many results reach a main chat's agent by themselves — as a turn of their own where none of it runs — and keep
     * its work stretch going (sessions/stretch.js): those waiting for its turn to end or on their way, and its teams'
     * whose Then notify is on while they work, their lead's turn or a worker of theirs (`wakingWork`). Not a flow's box,
     * whose runner hands its result on. @param {string} mainId
     */
    owing(mainId) {
      const main = String(mainId || "");
      const queued = waiting.get(main) || [];
      let n = queued.length + (notifying.get(main) || 0);
      const a = archive();
      for (const id of a.besideOf(main)) {
        const b = a.metaOf(id, ["beside"])?.beside;
        if (b?.notify !== true || b.flow || queued.some((w) => w.id === id)) continue;
        if (reach.busy(id) || (registry()?.wakingWork?.(id) || 0) > 0) n++;
      }
      return n;
    },
    /**
     * A chat's turn ended (the turn lock let go of it): a team chat is looked at — its result may be in — and the
     * results waiting for a main chat go.
     * @param {string} chainId
     */
    released(chainId) {
      try {
        if (archive().getChain(chainId)?.kind === "team") look(chainId);
      } catch (/** @type {any} */ e) {
        log("warn", `teams beside: ${chainId} could not be looked at (${e?.message || e})`);
      }
      if (waiting.get(chainId)?.length) void flush(chainId, settleMs);
    },
    /**
     * Every team beside a chat stopped, before the chat goes (§9 Q9: they go with it). → the team chats.
     * @param {string} mainId
     */
    stopAll(mainId) {
      const ids = archive().besideOf(String(mainId || ""));
      for (const id of ids)
        try {
          stop(id);
        } catch {}
      waiting.delete(String(mainId || ""));
      return ids;
    },
    /** Filament stops: no look is due any more, no worker's event is heard, and no waiting result goes. */
    close() {
      closed = true;
      waiting.clear();
      unsubscribe?.();
      for (const t of looks.values()) clearTimeout(t);
      looks.clear();
    },
  };
}

/** @typedef {ReturnType<typeof createTeamsBeside>} TeamsBeside */
