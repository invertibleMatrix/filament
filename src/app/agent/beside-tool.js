// @ts-check
// The main agent's `team` tool (team_v2_plan §5.5, TV2-D6, TV2-D10): it sends a team to work beside its chat — a lead
// that reads the whole chat, with workers of its own, in a chat of their own (app/teams-beside.js) — and asks how the
// teams beside it stand. It reads no result and has no say in where one goes: the fired card's switches decide, set ahead
// from the chat's `engine.agentTeams`, else the team's own, else off. One tool of Filament's own, the same for both engines:
// the loop offers it, and a coding agent reaches it over Filament's MCP server or as Cursor's custom tools
// (agent-tools.js). Offered from the chat's first message (TV2-D7) to a harness chat's own agent while its
// `loop.tools.team` switch is on — never to a team's lead, a worker or a helper, nor in a team's own chat: a team
// beside sends no teams. A call made after the person switched it off is refused in words. A send may name the models
// its lead and its workers run on, and how hard each thinks, as the person's fire card picks them (the owner's of 10-30),
// and a bug hunt's range (core/hunt-range.js, the plan's p6). Its act is `send`, the page's word for it, since version
// 123; `fire`, its name until then, is taken as send for good (core/beside.js `besideAction`). The runner's own names
// (`fire`, `firedBy`, the `fired` mark) are as they were.
import { BESIDE_LIMITS, besideAction, shortOf } from "../../core/beside.js";
import { SUBAGENT_EFFORTS } from "../../core/schema.js";
import { possessive } from "../../core/text.js";
import { TEAMS_SWITCH } from "../../core/teams-on.js";

export const BESIDE_TEAM = "team";
/** What the tool does, in the order its description gives them. */
export const BESIDE_ACTIONS = Object.freeze(["send", "status", "note"]);
/** A call where the chat sends no teams: no harness chat, a team's own, or a lead's, a worker's or a helper's. */
export const BESIDE_OFF = "Not run: teams beside a chat are sent by a harness chat's own agent, and this is none.";
/** A call made while Settings › Experimental's Teams switch is off: a coding agent holding the tool from before it. */
export const BESIDE_TEAMS_OFF = `Not run: teams are off here. The person turns them on in ${TEAMS_SWITCH}. Do the work yourself.`;
/** A call made after the person switched the tool off for the chat. */
export const BESIDE_SWITCHED_OFF = "Not run: the person switched the team tool off for this chat. Do the work yourself, or say in your answer which team you would have sent and why.";

export const BESIDE_TOOL = Object.freeze({
  name: BESIDE_TEAM,
  description:
    "Send a team to work beside this chat, in a chat of its own, for a large job you can say in a few lines and need not watch: a bug hunt over recent work, or a check of claims against the code (bughunters finds bugs and checks claims, and fixes none). Its lead reads this whole chat, splits the job, hands pieces to workers of its own and checks what they bring, while you go on with yours. Not for one sub-agent (agent). " +
    "send starts one (team, ask): say what to do, not what was done, since its lead reads this chat already. " +
    "You send only the teams the person lets this chat's agent send (BugHunters, unless they chose others in the chat's settings); the rest are theirs: name one in your answer where it fits. " +
    "status says which teams run beside this chat, on what, how far each is, which wait for the person, and which there are to send. " +
    "note puts one line before the lead of a team at work, read at its next step (what changed, what to skip); a team whose turn ended takes none. " +
    "You do not read a team's result here: the person decides where it goes. Do not wait for it: go on with your work.",
  input_schema: {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: [...BESIDE_ACTIONS], description: "send, status or note." },
      team: { type: "string", description: "send, note: the team, by its key or its name; status lists them (bughunters, builders, …)." },
      note: { type: "string", description: `note: the line for its lead; ${BESIDE_LIMITS.note} characters at most.` },
      ask: { type: "string", description: `send: what the team is to do, in your words; ${BESIDE_LIMITS.ask} characters at most.` },
      range: { type: "string", description: "send, a bug hunt: what it hunts in: uncommitted, since <ref>, a commit range (main..HEAD), or files and folders by commas; its lead reads those files, with the lines each changes, before your words. Left out: what is uncommitted and the files this chat changed." },
      model: { type: "string", description: "send: the model its lead runs on, as you'd say it. Left out: this chat's for its lead, else the team's, else its card's, else this chat's model." },
      provider: { type: "string", description: "send: who serves its lead's model (a provider or a coding agent), where several do." },
      effort: { type: "string", enum: [...SUBAGENT_EFFORTS], description: "send: how hard its lead thinks (the highest level its model takes at or below it); model: its model's own." },
      workers_model: { type: "string", description: "send: the model its workers run on, but a worker its team names one for. Left out: this chat's for its workers, else the team's, else this chat's for each worker's kind, else its card's, else this chat's list, else its lead's." },
      workers_provider: { type: "string", description: "send: who serves its workers' model, where several do." },
      workers_effort: { type: "string", enum: [...SUBAGENT_EFFORTS], description: "send: how hard its workers think, where its lead's launch and its team name none." },
    },
  },
});

/**
 * A send as the tool hands it on: the team, its words, and the models its lead and its workers run on where the agent
 * names any.
 * @typedef {{ team: unknown, ask: unknown, model?: unknown, provider?: unknown, effort?: unknown, workersModel?: unknown,
 *   workersProvider?: unknown, workersEffort?: unknown, range?: unknown, readOnly?: boolean }} BesideFire  `range`: what a
 *   bug hunt hunts in, in words (the plan's p6); `readOnly`: fired from a turn held to reading, its chat reads only
 */

/**
 * A team as the tool's status names it: `mine`, one the chat lets its main agent send by itself (U13-D9).
 * @typedef {{ key: string, name: string, line: string, mine: boolean }} BesideTeam
 */

/**
 * Where a team's lead is, as the runner reads it off its running turn (`sessions.leadFacts`).
 * @typedef {{ running?: boolean, rounds?: number, words?: string, calls?: { name: string, subject: string, open: boolean }[] }} LeadFacts
 */

/**
 * Where a call stands: the chat it fires beside, a fire, a note and the list as the teams-beside runner answers them,
 * where a team's lead is now, the teams there are, and whether the person's switch leaves the tool on now.
 * @typedef {{ chain: string, fire: (input: BesideFire) => Promise<import("../teams-beside.js").BesideRow>,
 *   note?: (input: { team: unknown, note: string }) => Promise<import("../teams-beside.js").BesideRow>,
 *   list: () => import("../teams-beside.js").BesideRow[], lead?: (id: string) => LeadFacts | null, teams: () => BesideTeam[],
 *   on?: () => boolean }} BesideAt
 */

/**
 * The teams beside the chats as the agents' tools reach them, wired once by the server: a fire and a note as the main
 * agent's, a chat's list, where a team's lead is now, the teams there are as that chat sees them, whether a chat fires
 * teams at all (a team's own does not), and whether its `loop.tools` switch leaves the tool on now.
 * @typedef {{ fire: (chain: string, input: BesideFire) => Promise<import("../teams-beside.js").BesideRow>,
 *   note: (chain: string, input: { team: unknown, note: string }) => Promise<import("../teams-beside.js").BesideRow>,
 *   list: (chain: string) => import("../teams-beside.js").BesideRow[], lead: (id: string) => LeadFacts | null,
 *   teams: (chain: string) => BesideTeam[], fires: (chain: string) => boolean, on: (chain: string) => boolean,
 *   teamsOn?: () => boolean }} BesideDeps
 *   `teamsOn`: Settings › Experimental's Teams switch (core/teams-on.js); none is on
 */

/**
 * Where a call of a chat stands, or null where it fires no teams: a chat of another kind, or teams switched off.
 * @param {BesideDeps | null | undefined} deps @param {string | null | undefined} chain @returns {BesideAt | null}
 */
export function besideAtOf(deps, chain) {
  if (!deps || !chain || !deps.fires(chain) || deps.teamsOn?.() === false) return null;
  return {
    chain, fire: (input) => deps.fire(chain, input), note: (input) => deps.note(chain, input), list: () => deps.list(chain),
    lead: (id) => deps.lead(id), teams: () => deps.teams(chain), on: () => deps.on(chain),
  };
}

/**
 * Where a team's lead is now, in a line, for status: its open call, else its newest call done, else the last line of
 * its newest words, else its round; "" where its turn does not run.
 * @param {LeadFacts | null | undefined} f
 */
export function leadStep(f) {
  if (!f?.running) return "";
  const calls = f.calls || [];
  const call = calls.find((c) => c.open) || calls.at(-1);
  if (call) return shortOf(`${call.name}${call.subject ? ` ${call.subject}` : ""}${call.open ? "" : ", done"}`, 120);
  const line = String(f.words || "").split("\n").map((l) => l.trim()).filter(Boolean).at(-1);
  if (line) return `“${shortOf(line, 100)}”`;
  return f.rounds ? `round ${f.rounds}` : "";
}

/** @param {string} error @returns {{ ok: false, error: string }} */
const no = (error) => ({ ok: false, error });

/** How long ago, in a word or two. @param {number} at @param {number} now */
function agoWords(at, now) {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
}

/**
 * Where a team's result goes, as its switches stand: to the agent by itself, or to the person first.
 * @param {{ verify: boolean, notify: boolean }} r
 */
function routeWords(r) {
  if (r.verify && r.notify) return "When it ends, BugHunters checks its result, and the check comes to you as a message.";
  if (r.notify) return "Its result comes to you as a message when it ends.";
  if (r.verify) return "When it ends, BugHunters checks its result; the check waits for the person, who may send it to you.";
  return "Its result waits for the person, who may send it to you.";
}

/**
 * How one team beside stands, as status says it to the agent: who sent it, its state, and where its result went.
 * `step`: where its lead is now, for a team at work (`leadStep`).
 * @param {import("../teams-beside.js").BesideRow} r @param {number} now @param {string} [step]
 */
function rowWords(r, now, step = "") {
  const who = r.firedBy === "agent" ? "you" : "the person";
  // What it runs on, so a pick is seen to have taken: its lead's model, and its workers' — where nothing names theirs,
  // and the chat has no list of its own to send, their cards', else its lead's (teams-beside.js `runsOn`); a list the
  // chat's or its project's — in the words the page says it in (ui/harness/lib/beside.js `onWords`).
  const list = r.on?.workers?.length ? [...new Set(r.on.workers)].join(", ") : "";
  const workers = !list ? "their cards' models, else its lead's model" : r.on?.from === "project" ? `their cards' models, else this project's list: ${list}` : r.on?.from === "chat" ? `their cards' models, else this chat's list: ${list}` : list;
  const head = `${r.team.name}, sent by ${who} ${agoWords(r.at, now)} — runs on ${r.on?.lead || r.model || "this chat's model"}, its workers on ${workers}`;
  const asked = `Asked: "${shortOf(r.ask, 120)}"`;
  // Its workers, where a team at work or one whose lead asks has any: those still spending, and how the rest ended.
  const w = r.workers;
  const work = [
    w.running ? `${w.running} at work` : "", w.waiting ? `${w.waiting} wait${w.waiting === 1 ? "s" : ""} for a slot` : "",
    w.done ? `${w.done} done` : "", w.failed ? `${w.failed} failed` : "", w.stopped ? `${w.stopped} stopped before finishing` : "",
  ].filter(Boolean).join(", ");
  const crew = work ? ` (${work})` : "";
  /** @type {string} */
  let state;
  if (r.state === "working") state = `at work${crew}${step ? `; its lead now: ${step}` : ""}. ${routeWords(r)}`;
  else if (r.state === "asking") state = `its lead asks the person something, and waits for the answer${crew}`;
  else if (r.state === "stopped") state = r.cut ? "Filament stopped while it worked; the person may resume it" : "stopped before it had a result";
  else if (r.notified?.how === "waits") state = "done: its result goes to you once your turn ends";
  else if (r.notified?.how === "envelope") state = "done: its result went to you as an envelope";
  else if (r.notified) state = "done: its result went to you";
  else if (r.verifiedBy) state = "done: BugHunters checks its result";
  else if (r.missed) state = `done: its result did not reach you (${shortOf(r.missed, 160)}); the person may send it to you`;
  else if (r.notify) state = "done: its result is on its way to you";
  else state = "done: its result waits for the person";
  // A state that ends in a sentence of its own keeps its one full stop.
  return `- ${head} — ${state.replace(/\.$/, "")}. ${asked}`;
}

/**
 * One call of the tool, its answer in words, or its refusal; the runner's refusals in their own words. `turn.mode`:
 * the permission mode the calling turn runs in now. A turn Filament holds to reading — a plan's, a watcher's wake —
 * sends a team that reads only: a chat of its own would else do what the turn that sent it may not. Its action is read
 * through `besideAction`, the one line that takes `fire` as send.
 * @param {any} input @param {BesideAt} at @param {number} [now] @param {{ mode?: (() => string | null) | null }} [turn]
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>}
 */
export async function besideCall(input, at, now = Date.now(), turn = {}) {
  if (at.on && !at.on()) return no(BESIDE_SWITCHED_OFF);
  const action = besideAction(input?.action);
  if (!BESIDE_ACTIONS.includes(action)) return no(`team takes an action: send, status or note${action ? `; ${shortOf(action, 40)} is none of them` : ""}.`);
  if (action === "note") {
    const note = String(input?.note ?? "").replace(/\s+/g, " ").trim();
    if (!note) return no("Not sent: a note says in a line what its lead is to know.");
    if (note.length > BESIDE_LIMITS.note) return no(`Not sent: a note is ${BESIDE_LIMITS.note} characters at most; this is ${note.length}.`);
    if (!at.note) return no("Not sent: this chat reaches no team's lead.");
    try {
      const row = await at.note({ team: input?.team, note });
      return { ok: true, text: `Your note went to the ${possessive(row.team.name)} lead: it reads it at its next step. Go on with your work.` };
    } catch (/** @type {any} */ e) {
      if (Number.isInteger(e?.status)) return no(`Not sent: ${e.message}.`);
      throw e;
    }
  }
  if (action === "status") {
    const rows = at.list();
    const all = at.teams();
    /** @param {BesideTeam[]} list */
    const lines = (list) => list.map((t) => `- \`${t.key}\` ${t.name} — ${t.line}`).join("\n");
    // Where each lead at work is: read off its running turn's log, so only for a team at work, and only here.
    /** @param {string} id */
    const stepOf = (id) => {
      try {
        return leadStep(at.lead?.(id));
      } catch {
        return "";
      }
    };
    // The teams the chat lets it send by itself, and the rest, which only the person sends (U13-D9).
    const mine = all.filter((t) => t.mine);
    const theirs = all.filter((t) => !t.mine);
    return {
      ok: true,
      text: [
        rows.length ? `Teams beside this chat, the newest first:\n${rows.map((r) => rowWords(r, now, r.state === "working" ? stepOf(r.id) : "")).join("\n")}` : "No team runs beside this chat.",
        "",
        mine.length ? `Teams you can send:\n${lines(mine)}` : "Teams you can send: none — the person decides which.",
        ...(theirs.length ? ["", `Teams only the person sends — name one in your answer where it fits:\n${lines(theirs)}`] : []),
      ].join("\n"),
    };
  }
  /** A field the call gave, else nothing. @param {string} k */
  const given = (k) => (input?.[k] == null || String(input[k]).trim() === "" ? undefined : String(input[k]).trim());
  if (given("provider") && !given("model")) return no("Not sent: provider names who serves its lead's model: name the model too.");
  if (given("workers_provider") && !given("workers_model")) return no("Not sent: workers_provider names who serves its workers' model: name workers_model too.");
  // The models it runs on, where the call names any: the fire card's picks, by the runner's names.
  const picks = Object.fromEntries(
    /** @type {[string, string][]} */ ([["model", "model"], ["provider", "provider"], ["effort", "effort"], ["workersModel", "workers_model"], ["workersProvider", "workers_provider"], ["workersEffort", "workers_effort"], ["range", "range"]])
      .flatMap(([to, from]) => (given(from) ? [[to, given(from)]] : [])));
  try {
    const held = turn.mode?.() === "read-only";
    const row = await at.fire({ team: input?.team, ask: input?.ask, ...picks, ...(held ? { readOnly: true } : {}) });
    return { ok: true, text: `${row.team.name} started beside this chat${held ? ", reading only, as this turn does" : ""}. ${routeWords(row)} Go on with your work: do not wait for it.` };
  } catch (/** @type {any} */ e) {
    if (Number.isInteger(e?.status)) return no(`Not sent: ${e.message}.`);
    throw e;
  }
}
