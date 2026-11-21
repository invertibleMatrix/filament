// @ts-check
// A coding agent leading a team (HarnessV3-ACP AC6-3 to AC6-5): the loop lead's ways in the agent's terms. Its words
// reach it through its standing context channel, as a worker's do; its team's tools — agent, worker and wait — are
// Filament's, over its MCP server (or the Cursor SDK's custom tools), served by the handlers the loop lead calls
// (team-tools.js) through the registry's door its turn opens, and the lead's tasks
// tool, its tasks naming its team's members (HarnessV3-TaskGraph G3). Its workers' reports reach it as Filament's
// messages: into its running turn where the agent takes one, else as its next prompt within the same harness turn —
// the loop lead's rule, that no turn ends before its workers report. Its orders run at once. What its workers send it
// is taken, and waited for, as any coding agent's sub-agents' reports are (agent-inbox.js).
//
// A lead that reads along with its workers (HarnessV3-TaskGraph-v2 §12, V2-0b; `engine.supervise`) is shown a look at
// them by the door a report uses: in its wait's answer, into its running turn where the agent takes words, or as its
// next prompt once its turn ended. Its conversation is its own — Filament can take nothing out of it — so each look is
// the new part only (looks.js `lean`), and one it never heard puts its marks back. Where its agent compacts its own
// context while a worker of its turn runs or has a change waiting, Filament tells it how its team stands, by the same
// door (TG2-D56).
import { PROMPT, leadLines } from "./agent/prompt.js";
import { STEERING_HEAD } from "./agent/loop.js";
import { WATCHER, guideBlocks } from "../core/watchers.js";
import { createTeamTools } from "./agent/team-tools.js";
import { waitedCommands } from "./agent/commands.js";
import { MCP_PATIENCE_MS, createAgentInbox } from "./agent-inbox.js";
import { ENVELOPE } from "./agent/tools.js";
import { ROLE_BLOCK } from "./agent-worker.js";

/**
 * The lead's part, in the loop lead's own words: its role, its team's persona, how it leads, that its team's tools are
 * Filament's and its own work as the permission mode allows (HarnessV4_Tasks decision 9) — or, for a team that changes
 * no file (`readOnly`), that they and its workers only read, whatever the chat's mode says: such a team's turn is held
 * to reading while it leads (acp-turn.js `modeAsked`); or, in a turn the session holds to reading (`held`: a /plan's, a
 * watcher's wake that only reads), that they only read in this turn, held by the turn and never by its team —, how it waits, and its
 * report. The words that teach
 * the loop's model its hands are left out: the agent has its own. `asks`: the session names saved agents its lead may
 * ask (HarnessV4_Tasks E15 step 3) — when to ask one stands with how it leads, as it does for the loop's lead.
 * `supervise`: it reads along with its workers (HarnessV3-TaskGraph-v2 TG2-D28) — its looks in the words of a lead
 * whose conversation is its own, and that a look wakes it as a report does. Off, its part is as it was. Its team's
 * `members` are whom its lines name, where they are not the four that ship; `models`, what each runs on — its card's
 * model, or the session's pool (the registry's `modelsOf`, HarnessV3-TaskGraph-v2 TG2-D47, §13.12).
 * @param {{ name: string, persona: string, members?: readonly import("../core/roster.js").Member[] | null, readOnly?: boolean }} team
 * @param {{ asks?: boolean, supervise?: boolean, models?: import("./agent/prompt.js").TeamModels | null, held?: boolean }} [o]
 * @returns {string}
 */
export function leadWords(team, { asks = false, supervise = false, models = null, held = false } = {}) {
  // Its own tools: as the chat's mode allows, or — its team changing no file, or this turn held to reading — read only,
  // as its workers do.
  const turnHeld = held && !team.readOnly;
  const own = team.readOnly
    ? "Your own tools and your workers only read here, whatever the developer's permission mode says: you change no file and run no command that changes one. Keep your own tools for the pieces better done yourself, and brief a worker for the rest."
    : turnHeld
      ? "Your own tools and your workers only read in this turn, whatever the developer's permission mode says: it is held to reading, so you change no file and run no command that changes one until a turn that is not held. Keep your own tools for the pieces better done yourself, and brief a worker for the rest."
      : "Your own tools work as the developer's permission mode allows: keep them for the pieces better done yourself, and brief a worker for the rest.";
  const lines = [
    "These are Filament's instructions for this session, not background.",
    PROMPT.leadRole,
    `${PROMPT.headTeam} ${team.name}`,
    String(team.persona || "").trim(),
    PROMPT.headLead,
    leadLines({ supervise, own: true, members: team.members, models, readOnly: !!team.readOnly, held: turnHeld }),
    PROMPT.ambiguity,
    asks ? `- ${PROMPT.askFirst}` : "",
    asks ? PROMPT.agentAsk : "",
    supervise
      ? `Your team's tools are Filament's, on its MCP server: agent launches a worker, worker messages, stops, reads, follows up on or applies one, and wait waits for them. Where you have a sub-agent tool of your own, it is not that agent tool: what it starts is no worker of your team, and Filament shows you nothing of it. ${own}`
      : `Your team's tools are Filament's, on its MCP server: agent launches a worker, worker messages, stops, follows up on or applies one, and wait waits for them. ${own}`,
    supervise
      ? "A worker's report or a look that lands while you work reaches you as a message from Filament, a report waiting sealed for its envelope tool where Filament's line says so. When only waiting is left, end your turn: Filament wakes you with the reports, and with a look when one is due, as your next message, in the same turn of the developer's."
      : "A worker's report that lands while you work reaches you as a message from Filament, or waits sealed for its envelope tool where Filament's line says so. When only waiting is left, end your turn: Filament wakes you with the reports as your next message, in the same turn of the developer's.",
    team.readOnly || turnHeld ? PROMPT.leadPermissionReads : PROMPT.leadPermission,
    PROMPT.leadCare,
    PROMPT.leadReport,
  ];
  return `<filament-context kind="${ROLE_BLOCK}">\n${lines.filter(Boolean).join("\n")}\n</filament-context>`;
}

/**
 * The lead's words gone from its standing context: the developer set the session's engine back to a single agent. They
 * name the team it led (HarnessV4_Tasks B12), as the words that made it its lead did.
 * @param {{ name: string }} team
 */
export const leadGone = (team) =>
  `You no longer lead team ${team.name}: the developer set this session's engine back to a single agent. Filament's team tools are gone, and your own tools work as the session's permission mode allows.`;

/**
 * The developer's messages that reached the lead between its prompts, in the words the loop's boundary says them. A
 * watcher's guidance among them is no message of theirs: each watcher's follows under its own heading, with how to
 * weigh it (core/watchers.js `guideBlocks`).
 * @param {{ text: string, from?: string, title?: string }[]} notes
 */
export const heardBlock = (notes) => {
  const typed = notes.filter((m) => m.from !== WATCHER);
  const theirs = typed.length ? [`${STEERING_HEAD} (${typed.length} message${typed.length === 1 ? "" : "s"}). Acknowledge what you heard in your next reply before acting on it:\n${typed.map((m) => `- ${m.text}`).join("\n")}`] : [];
  return [...theirs, ...guideBlocks(notes)].join("\n\n");
};

/**
 * @typedef {import("./agent-run.js").OwnCall} OwnCall
 * @typedef {import("./agent-inbox.js").AgentTurn} AgentTurn
 */

/**
 * The lead's turn, over the door its harness turn opened in the registry.
 * @param {{
 *   registry: import("./agent/subagents.js").SubagentRegistry,
 *   door: { inbox: import("./agent/subagents.js").Inbox, close: () => any },
 *   chainId: string, runId: string, cwd: string, model: string, mode?: "read-only" | null,
 *   team: { key: string, name: string, members: readonly import("../core/roster.js").Member[] },
 *   emit: (evt: any) => void,
 *   note: (text: string) => void,
 *   mailbox: () => import("../services/runs.js").Mailbox | null,
 *   reach?: (m: import("../services/runs.js").SteerMessage) => import("./agent-inbox.js").Reach,
 *   handOver?: (m: import("../services/runs.js").SteerMessage) => Promise<void>,
 *   wrote?: (writes?: import("./turn-tree.js").Writes | null) => void,
 *   signal: AbortSignal,
 *   callOf?: (name: string) => Promise<OwnCall | null>,
 *   graph?: { apply: (input: any) => any } | null,
 *   opens?: () => boolean,
 *   onTask?: (() => string | null) | null,
 * }} o  `mode`: read-only where its team changes no file — its orders launch read-only; else none, and each follows
 *   the session's mode; `emit`: an event on the lead's run, at its round; `note`: the record's line; `reach`: how a message of the developer's
 *   reaches the lead's agent — at its next step, or as its next message — which ends its wait in those words
 *   (HarnessV3-TaskGraph-v2 TG2-D43; where nothing says, none ends it); `handOver`: such a message, at its next step,
 *   goes to the agent before the wait answers (HarnessV4_Tasks C34); `wrote`: the team changed the folder — a
 *   change the lead applied, a merge a report tells of — which the run snapshots, with the files it names
 *   (HarnessV4_Tasks B12); `signal`: the
 *   turn's stop or hang-up; `callOf`:
 *   the agent's own call a team's tool call came in, on its run, once the agent has said it — the worker it launches
 *   hangs off its card; `graph`: the session's task graph — a tasks call goes to it as the lead's (its crew the team's
 *   members); `opens`: whether its agent can open an envelope now — Filament's tools reach
 *   its session (agent-inbox.js): its workers' reports reach it sealed while it works, as the loop lead's do (EN-D7);
 *   `onTask`: the line behind what lands while a task of the lead's own runs on its graph (E41 P1 case 7)
 * @returns {AgentTurn & { teamNow: () => { text: string, workers: number } | null }}  its `call` takes the team's tools,
 *   the envelope tool and the lead's tasks tool; it owes its workers' reports; `teamNow`: its agent compacted its own
 *   context — how its team stands now, for the block that comes back after it (team-tools.js `teamNow`, TG2-D56;
 *   acp-turn.js `backNow`), a report still at the door said by the words behind it; null with no worker of this turn,
 *   or once the turn is over
 */
export function createLeadTurn({ registry, door, chainId, runId, cwd, model, mode = null, team, emit, note, mailbox, reach = () => null, handOver = async () => {}, wrote = () => {}, signal, callOf = async () => null, graph = null, opens = () => false, onTask = null }) {
  const tools = createTeamTools({ registry });
  // Its wait waits for the chat's background commands too, as the agent's own chat's does (the gap of 11-10, f6's follow-up).
  const box = createAgentInbox({ door, emit, note, mailbox, reach, handOver, wrote, signal, reader: "the lead", opens, onTask, commands: waitedCommands(chainId) });
  /** The lead reads along with its workers: its door makes looks (HarnessV3-TaskGraph-v2 §12). */
  const reads = !!door.inbox.reads;
  let n = 0;
  /** The turn is over: no word of its team after it. */
  let over = false;

  /** @param {any} input @param {OwnCall | null} own @param {number} patienceMs */
  const teamCall = (input, own, patienceMs) => ({ chainId, lead: own ? { runId, callId: own.id, round: own.round } : { runId, callId: `mcp:${++n}` }, cwd, mode, model, thinking: null, team, input, reads, patienceMs });
  /**
   * An order run, its record's line kept; a tasks call goes to the graph, the view it leaves drawn on the run.
   * `patienceMs`: how long the call it answers may still run — an apply waits for the folder's check within it (TG2-D55).
   * @param {string} name @param {any} input @param {OwnCall | null} own  the agent's call it came in @param {number} patienceMs
   */
  const run = async (name, input, own, patienceMs) => {
    if (name === "tasks") {
      if (!graph) return { text: "Not run: this session has no task graph.", isError: true };
      const g = graph.apply(input);
      if (!g.ok) return { text: g.error, isError: true };
      if (g.view) emit({ type: "graph", graph: g.view });
      // What the folder changed while a task it marked done ran (E41 P2 case 11), once git has read it.
      const changed = g.more ? await g.more : "";
      const words = changed ? `${g.text}\n${changed}` : g.text;
      return g.media?.length ? { text: words, media: g.media } : { text: words };
    }
    const r = name === "agent" ? await tools.agent(teamCall(input, own, patienceMs)) : await tools.worker(teamCall(input, own, patienceMs));
    note(r.note);
    if (r.wrote) wrote(r.writes || null);
    return { text: r.text, ...(r.ok ? {} : { isError: true }) };
  };

  /**
   * The lead's wait: it ends the moment something reaches the lead — a report, a look that is due — and answers with
   * what came, and the watch — or, where the lead reads along, a look at its workers as they stand now, whatever ended
   * the wait.
   * @param {unknown} seconds @param {number} patienceMs
   */
  const wait = async (seconds, patienceMs) => {
    const got = await box.wait(seconds, patienceMs, { who: "the workers" });
    return `${got ? got.said : "Nothing to wait for: no worker you launched is running, and none of your background commands runs."}\n\n${got?.look ?? tools.watch({ chainId }).text}`;
  };

  return {
    async call(name, input, { patienceMs = MCP_PATIENCE_MS } = {}) {
      if (name === "wait") return { text: await wait(input?.seconds, patienceMs) };
      if (name === ENVELOPE) return { text: box.open(input, (await callOf(name))?.id ?? null) };
      const own = name === "agent" || name === "worker" ? await callOf(name) : null;
      return run(name, input, own, patienceMs);
    },
    take: box.take,
    unheard: box.unheard,
    owes: () => door.inbox.owed(),
    arrival: box.arrival,
    waiting: box.waiting,
    spentUsd: box.spentUsd,
    remind: box.remind,
    close() {
      over = true;
      box.close();
    },
    teamNow() {
      if (over) return null;
      // A report still at the door goes in right behind these words — as its envelope's line, where the lead takes it
      // sealed at work (EN3): they only say it comes.
      return tools.teamNow({ chainId, ids: door.inbox.own?.() || [], reads, coming: door.inbox.coming?.() || [], sealed: box.seals() });
    },
  };
}
