// @ts-check
// A turn against an agent upstream: the "model" is a local coding agent (over ACP, or Cursor's SDK in-process).
// Filament relays the newest user message into an agent session and streams the agent's reply back in the client's
// wire format — thoughts as thinking blocks or woven into the text, tool activity as rendered lines, and when the
// agent needs the client's hands, a tool call that the client answers on its next request. A sub-agent's or a team
// worker's run whose model is a coding agent is served here too, in host mode (HarnessV3-ACP AC6-1): the agent's turn
// in an agent session of the sub-agent's own, its run under the launching turn's, reporting to the registry.
import { outputCeiling, renderUpstreamModel } from "../core/routing.js";
import { estimateTokens } from "../core/tokens.js";
import { estimateCost } from "../core/pricing.js";
import { renderHints, renderRecord } from "../core/notes.js";
import { answeredAs } from "../core/answering-model.js";
import { moveNote, toldPatch } from "../core/move-note.js";
import { errorBody } from "../core/wire/errors.js";
import { summarizeBody } from "../core/body-summary.js";
import { clientConversationId, chainRefOf } from "../core/conversation.js";
import { estimateBodyTokens } from "../core/tokens.js";
import { flattenMessages } from "../core/wire/flatten.js";
import { ClientToolset, extractToolResults, isActionId } from "../adapters/agents/client-bridge.js";
import { loopCalls } from "../adapters/agents/turn-bridge.js";
import { checkAnswer, nobodyAnswer } from "../adapters/agents/asks.js";
import { ActivityRenderer, describeStopReason, mapStopReason } from "./acp-render.js";
import { detectHousekeeping, makeTitle, makeSummary } from "./housekeeping.js";
import { requestWasAborted } from "../services/health.js";
import { agentOwn, observeAgentStart, observeCountedModel } from "../services/token-calib.js";
import { agentCause, classifyFailure, saysPlanRefused, saysSignedOut, thrashWords } from "../adapters/agents/acp/failures.js";
import { meteredApart } from "../core/agent-limits.js";
import { isWall, wallWords } from "../core/provider-cause.js";
import { worded } from "../core/failure.js";
import { houseAuth } from "../services/house.js";
import { loopbackPost } from "../services/loopback.js";
import { selfAddress } from "../services/config/store.js";
import { sendJson } from "./pipeline/respond.js";
import { createAgentReply } from "./acp-wire.js";
import { createTurnCollector } from "./acp-collect.js";
import { createAgentRun } from "./agent-run.js";
import { EMPTY_REPLY_LINE, addedFoldersOf, fencedAdded, fencedFolderWords, folderRefusalOf, folderVerdict, loopConfig, projectPermissions, sessionMode, worktreeReadsOf } from "./agent/turn.js";
import { rulesFrom } from "./agent/rules.js";
import { keptNow } from "./agent/chat-always.js";
import { artifactsMakeHere } from "./agent/artifacts.js";
import { createAgentPermits, strayWords } from "./agent-permits.js";
import { lookIn } from "./second-look.js";
import { eventJson, followRunEvents, typedByDeveloper } from "../services/runs.js";
import { createTurnTree } from "./turn-tree.js";
import { answerAgentCommand, noteForeignCommand, parseAgentCommand } from "./commands/acp.js";
import { ENVELOPES_BLOCK, WHERE_BLOCK, agentContext, envelopesBlock, startBlocks, whereBlock } from "./agent-context.js";
import { lookSecondsOf, mcpServerProblem, readsAlong } from "../services/session-settings.js";
import { browserOffered } from "./agent/browser-tool.js";
import { spaceProjectOf } from "./agent/space.js";
import { agentSkillFolders, loadSkills, skillsForAgent } from "./agent/skills.js";
import { watchParts } from "./agent/team-tools.js";
import { FILAMENT, lookOf, whoseStop } from "./agent/looks.js";
import { SHIM, workerAsker, workerNote, workerStatus, workerWords } from "./agent-worker.js";
import { callsOf, countCalls, endedOf } from "../services/memory/outcomes.js";
import { followedBody, joinTurns } from "./agent-followon.js";
import { followOwnCompaction } from "./sessions/agent-copy.js";
import { compactionSettingsOf, transcriptSummary, ASSUMED_WINDOW, FORK_SUMMARY_INSTRUCTION } from "./sessions/compactor.js";
import { sideLineOf, summaryLead, summaryOfReply } from "./sessions/compaction.js";
import { LINE_HEADER, lineOf } from "../adapters/agents/compactions.js";
import { claudeCompactWindow, relayHere } from "../adapters/agents/acp/toolset.js";
import { modeAsks } from "../adapters/agents/acp/configure.js";
import { agentTurnModel } from "./engine.js";
import { sessionWindowFor } from "../core/model-families.js";
import { REPORT_ASK } from "../core/task-graph.js";
import { routineActs } from "../core/routines.js";
import { WATCHER, guideBlock } from "../core/watchers.js";
import { openingPictures, readJudge } from "./agent/attach.js";
import { createLeadTurn, heardBlock, leadGone, leadWords } from "./agent-lead.js";
import { createLaunchTurn } from "./agent-launch.js";
import { BACKGROUND_COMMAND, COMMANDS_HELD_MS, attendCommands } from "./agent/commands.js";
import { CODER_CHECKLIST_TOOL, CODER_UNPLANNED_LINE, changesWhatFailed, keepsAgentsMachine, launchKey, leadLaunchKey, PLAN_HELD } from "./agent/tools.js";
import { OPEN_BLOCK, RECALL_AFTER, WAITS_AGAIN, bodyWithDismiss, withDismiss } from "./agent/still-open.js";
import { READERS, compose, textOf, viaOf } from "./agent/checkpoint.js";
import { CHATS_AGENT, createSkillsBack } from "./agent/skills-back.js";
import { sealedListText } from "./agent/envelopes.js";
import { livePlan, planIn, reattachBlock, skillLoadOf } from "./sessions/reattach.js";
import { fileKey } from "../adapters/tools/fs-fence.js";
import { SIGHTING_AGENTS_LIMIT, comeBackOf, createSightingsKeeper, peekSightings, runningShellsOf, sightFile } from "../adapters/tools/hands.js";
import { staleNames } from "./agent/stale.js";
import { changedSecond, driftChanged, failedAgain, failingLine, newDriftState, outsideLine } from "../core/drift.js";
import { resolve } from "node:path";
import { redactorOf } from "../core/redact.js";
import { UNREAD_DEVICE, fullControl, heldGrant } from "../services/devices.js";

/** @typedef {import("./deps.js").AppDeps} AppDeps */
/** @typedef {import("../adapters/agents/turn-bridge.js").Steer} Steer  how a bridge hands the person's words to its agent's turn */
/** @typedef {import("../core/media.js").SteerImage} SteerImage */
/** @typedef {import("../adapters/agents/turn-bridge.js").AgentCommands} AgentCommands */

/**
 * @typedef {object} AcpTurnArgs
 * @property {import("node:http").ServerResponse} res
 * @property {"anthropic" | "openai"} format
 * @property {any} body
 * @property {string} raw  the request body as received (its length goes on the record)
 * @property {Record<string, string>} inboundHeaders
 * @property {any} requested  `parseModelSuffix` of the model name
 * @property {any} route
 * @property {any} candidate  the failover-order entry being tried
 * @property {any} upstream
 * @property {any} rec
 * @property {AbortController} clientAbort
 * @property {boolean} [isLast]  whether a failure before output may still fall back to another candidate
 * @property {{ sit: any, prep: any, chain: string | null, rowless: boolean } | null} [mem]  memory's situate/prepare
 *   results for this request, or its session's settings alone where memory left it out, the session the turn's own tools
 *   ride, and whether memory keeps no row of the turn, whose own agent's pictures are then kept on that session
 *   (pipeline/stages/situate.js `turnMemState`)
 * @property {boolean | string} [leftOut]  whether memory leaves the request's chat out (`chatLeftOutOf`): the Memory
 *   setting that does, in its words, or true for Filament's own call, which memory never situates; either way its
 *   agent's session is offered none of memory's tools — a turn whose situate failed is its chat's, which keeps them
 * @property {boolean} [confined]  the request's caller reaches its own project's sessions alone (another machine without
 *   the admin token), and so do memory's tools for its agent — memory situating the request or not
 * @property {boolean} [runEvents]  the harness's own turn (HarnessV3-ACP AC1-4): its reply carries the run's events,
 *   and is the agent's words and thoughts alone — the run's cards draw the rest
 * @property {boolean} [unattended]  a harness session's turn nobody is at the page for (Filament's replay of it in a
 *   copy): a request its mode asks about is refused at once (HarnessV4_Overnight_Plan OV-D34)
 * @property {{ from: string, text: string, after?: number } | null} [handover]  what the agent the session moved to is
 *   handed with its first prompt, from the model that answered last (sessions/reattach.js `handoverFor`); `after`, the
 *   newest turn its session held already, whose own went unhanded
 * @property {boolean} [session]  a harness session's own turn, its page's or not: its typed `/compact` is the session's
 *   own compaction (AC5-5)
 * @property {{ upstream: string, sessionId: string, agent: string, tasks: any[], place?: number | null } | null} [ownCycle]  the agent's own
 *   turn (HarnessV3-ACP AC3-9): a cycle it began by itself on the session, which the turn listens to — no prompt
 *   goes out; `place`, its user turn in the chat's history as the session's next prompt counts them
 * @property {{ team: string } | null} [lead]  the session's team, which the agent leads (HarnessV3-ACP AC6-3)
 * @property {((phase: import("../services/session-turns.js").TurnPhase | null) => void) | null} [phase]  the session
 *   turn's phase, on its lock: the agent's steps before its session is up are said on it (HarnessV3-FailurePoints §5.1
 *   item 2)
 * @property {((requestId: string) => void) | null} [named]  the session turn's lock told the request's id as its run
 *   starts, where a page following the session finds the run before the reply's head names it — a reply sent whole
 *   names it only at its end (HarnessV4_Overnight_Plan OV-D33)
 * @property {import("../adapters/agents/turn-bridge.js").Reseed | "ask" | null} [reseed]  a session turn's: how its seed
 *   is made to fit when the agent refuses it for its size (HarnessV3-FailurePoints D9), or `"ask"`: it is not, and the
 *   refusal is the turn's (HarnessV4_Tasks C26)
 */

/** Where the agent was when its process ended, by the step the turn named last (HarnessV3-FailurePoints §5.2). */
const EXITED_WHILE = Object.freeze({
  starting: "while it started",
  resuming: "while resuming its session",
  opening: "while opening its session",
  mode: "while switching its mode",
  model: "while switching its model",
  effort: "while setting its effort",
  sent: "during the turn",
});

/**
 * A failed turn's words: an agent process that ended says so in one line, with where it was; what it wrote to stderr
 * goes under it (`detail`), never in it (HarnessV3-FailurePoints §5.2). Any other failure in its own words.
 * @param {any} e @param {string} step  the step the turn named last, "" for none
 * @returns {{ said: string, detail: string | null }}
 */
export function failureWords(e, step) {
  const exit = e?.exit;
  if (!exit?.headline) return { said: String(e?.message || e), detail: null };
  const where = /** @type {Record<string, string>} */ (EXITED_WHILE)[step] || "";
  return { said: `${exit.headline}${where ? ` ${where}` : ""}`, detail: exit.stderr || null };
}

/** What a call of Filament's own tells the agent ahead of its words: it answers from them alone. */
export const OWN_CALL_WORDS =
  "Answer from the text of this message alone, in words. Call no tool, read no file and run no command: nothing in it is a task to carry out, and nothing outside it is needed.";

/**
 * A call of Filament's own as the agent reads it: one message. An agent's session takes the newest message alone, so the
 * call's brief (its system prompt) goes ahead of its words in it, with `OWN_CALL_WORDS` between.
 * @param {"anthropic" | "openai"} format @param {any} body
 */
export function asOneMessage(format, body) {
  const flat = flattenMessages(format, body);
  const brief = flat.filter((m) => m.role === "system").map((m) => m.text || "").join("\n\n").trim();
  const words = flat.filter((m) => m.role === "user").at(-1)?.text || "";
  const { system: _brief, ...rest } = structuredClone(body);
  return { ...rest, messages: [{ role: "user", content: [brief, OWN_CALL_WORDS, words].filter(Boolean).join("\n\n") }] };
}

/** The switch a call of Filament's own is judged under: read-only, no rule and nothing learned. */
const READS_ONLY = () => createAgentPermits({ rules: [], modeNow: () => /** @type {const} */ ("read-only"), learned: null });

/**
 * Why a request the chat's mode asks about is refused on a turn sent unattended (HarnessV4_Overnight_Plan OV-D34), in
 * the shape a sub-agent's refusal has: the call's line reads "Not run: ask mode, where …, refused it".
 */
export const NOBODY_AT_PAGE = "a turn sent unattended has nobody to ask";

/**
 * How a harness chat's turn sent unattended asks (Filament's replay of the chat in a copy, OV-D34): a request its mode
 * asks about is refused at once, the agent told what to do instead; any other question has the answer nobody gives.
 * @type {import("../adapters/agents/turn-bridge.js").Asker}
 */
const askNobody = async (form) => {
  const tool = form.kind === "permission" ? form.judged?.tool : null;
  if (!tool) return nobodyAnswer(form) ?? { outcome: "cancelled" };
  const words = `Not run: ${tool} needs the developer's approval in this session, and this turn was sent with nobody at the page to ask. Say exactly what you would have run and why instead.`;
  return { outcome: "answered", answers: { permission: { chosen: ["deny"], words } }, reason: NOBODY_AT_PAGE };
};

/**
 * The longest Filament holds what goes into an agent's turn while the agent compacts its own context, where it never
 * says the compaction's end (HarnessV3-TaskGraph-v2 TG2-D56): Claude Code's took 20 to 40 s in the drives.
 */
export const COMPACTING_HOLD_MS = 300_000;

/**
 * The longest a wait of the agent's that the developer's message ended holds its answer for the message to go to the
 * agent (HarnessV4_Tasks C34): the answer says Filament hands it over next.
 */
const HAND_OVER_MS = 2_000;

/**
 * The prompt block that names the skills a session is owed where it begins from Filament's copy of the chat (`turn`,
 * `seedBlocks`): beside what is open there, as what comes back after a compaction names them in one block.
 */
const SKILLS_BACK_BLOCK = "skills-back";
/**
 * The events that are the agent at work on its prompt: its words, its thoughts, its calls, its plan, its own compaction,
 * a sub-agent of its own, a call's question. A count of its context, a step of the bridge's or a note is none — a plan's
 * window used up is counted before the prompt fails.
 */
const AGENT_WORKS = new Set(["text", "thought", "tool", "plan", "compaction", "subagent", "ask"]);

/**
 * Whether what the developer types waits in Filament for the agent's next call, theirs to change or take back until
 * then (HarnessV4_Tasks C34): where the agent takes words into its running turn, queued at it or live — not where
 * Filament cancels its turn at its next step (`next`), whose words wait for that step in Filament already.
 * @param {Steer | null} steer
 */
const holds = (steer) => !!steer && steer.at !== "next";

/**
 * What a model's name is read by beyond the model, each mark with what it names (the security review of f-fence):
 * `@<mode>` at its end, the coding agent's mode for the turn and its session's after, kept over the mode that asks
 * (acp/configure.js, cursor-sdk.js); `#<id or title words>`, one of the coding agent's sessions here, resumed in its
 * own folder (acp/bridge.js `findSession`); `$`, which a route's template reads as its own words (core/routing.js
 * `renderUpstreamModel`). The suffixes of an effort (`-high`) and of speed (`-fast`, core/shaping.js
 * `parseModelSuffix`) and a provider's `/` are the model's own. Another machine's agents' chat takes a model without
 * any (`turn` below; http/admin/remote.js `agentModelRefusal` at their door); the person's own chats keep them.
 * @type {Readonly<Record<string, string>>}
 */
export const MODEL_MARKS = Object.freeze({ "@": "a coding agent's mode", "#": "one of a coding agent's sessions here", $: "a route's own words" });

/**
 * The agent path, built once per app.
 * @param {AppDeps} deps
 */
export function createAcpTurn(deps) {
  const { config, log, usage, memory, health, destination, finish, agentHeartbeatMs, runs, events, liveWords } = deps;
  const selfBase = deps.selfBase || (() => selfAddress(config().server));
  /**
   * The skills each coding agent had loaded with Filament's skill tool as it last compacted its own context, until what
   * comes back after it went (c-skills): kept with its chat, by whose session compacted (agent/skills-back.js) — a
   * restart keeps them as it keeps that the compaction is still unsaid, and a sub-agent's run has its own.
   */
  const skillsBack = createSkillsBack({ archive: () => memory.archive });
  /**
   * The files each chat's coding agent read or wrote with its own tools, as Filament saw them then, by the chat's chain
   * (c-news): those that changed since are named at its next turn's start, as the loop's are told (hands.js sightings).
   */
  const agentSightings = createSightingsKeeper();
  /**
   * The sightings among them that an agent took before the chat moved to another: the agent it moved to read none of
   * those files, so a change behind one is told it as the chat's, never as a file it read (stale.js `staleNames`,
   * `moved`; the review of 11-11). A sighting its own read or write takes is its own. @type {WeakSet<object>}
   */
  const sightedBefore = new WeakSet();
  /**
   * The move each chat's sightings were last set aside at, by the chat's chain: a handover still owed at a second turn —
   * its first prompt went as the agent's own command — sets nothing aside the agent saw since. @type {Map<string, string>}
   */
  const movedAt = new Map();
  /**
   * The chat moved to this agent (`handover`): what its agent before saw is set aside, once a move.
   * @param {string} chain @param {import("../adapters/tools/hands.js").Sightings} seen @param {{ from: string, after?: number }} handover
   */
  const setAside = (chain, seen, handover) => {
    const at = `${handover.from}\n${handover.after ?? ""}`;
    if (movedAt.get(chain) !== at) for (const v of seen.values()) sightedBefore.add(v);
    movedAt.delete(chain);
    movedAt.set(chain, at);
    if (movedAt.size > SIGHTING_AGENTS_LIMIT) movedAt.delete(/** @type {string} */ (movedAt.keys().next().value));
  };
  /**
   * The files a chat's agent saw that changed since (hands.js `peekSightings`), as its turn's start names them — its own
   * as files it read, those set aside at a move as the chat's —, and `commit`, which moves their sightings once the
   * prompt that names them went out. Nothing of the look outlives this but `commit`, and that lets go of the rest once
   * called: a turn may run for hours, and what each changed file held and holds stayed with it (the review of 11-11).
   * @param {import("../adapters/tools/hands.js").Sightings} seen @param {string} root
   * @returns {Promise<{ names: string, commit: () => void }>}
   */
  const newsOf = async (seen, root) => {
    const aside = new Set([...seen.values()].filter((v) => sightedBefore.has(v)).map((v) => v.abs));
    const looked = await peekSightings(seen);
    const names = [staleNames(looked.changes.filter((c) => !aside.has(c.abs)), { root }), staleNames(looked.changes.filter((c) => aside.has(c.abs)), { root, moved: true })].filter(Boolean).join("\n\n");
    /** @type {(() => void) | null} */
    let move = looked.commit;
    return {
      names,
      commit: () => {
        if (!move) return;
        // A sighting set aside stays so once it moved to the file as it is now: the agent was told of it, and read nothing.
        const kept = [...seen].filter(([, v]) => sightedBefore.has(v)).map(([k]) => k);
        move();
        move = null;
        for (const k of kept) {
          const now = seen.get(k);
          if (now) sightedBefore.add(now);
        }
      },
    };
  };

  /**
   * @param {AcpTurnArgs} args
   * @returns {Promise<{ failedEarly: true, error: string, reason?: string, detail?: string | null, spent?: any } | void>}  `failedEarly`
   *   hands the request to the next candidate, with the failure's headline and what the agent wrote as it ended — and
   *   what it spent, where it reported any (`spent`: its upstream and model, the failure, its tokens priced, its `acp`)
   */
  async function turn({
    res,
    format,
    body,
    raw,
    inboundHeaders,
    requested,
    route,
    candidate,
    upstream,
    rec,
    clientAbort,
    isLast = true,
    mem = null,
    leftOut = false,
    confined = false,
    runEvents = false,
    unattended = false,
    handover = null,
    session = false,
    ownCycle = null,
    lead = null,
    phase = null,
    named = null,
    reseed = null,
  }) {
    const startedAt = Date.now();
    // A call of Filament's own to the agent's model (HarnessV4_Tasks C33: memory's, a summary's writer among them). The
    // agent answers it in words, in a session of its own that the call's end lets go of: never a command or a client's
    // housekeeping, its brief said with its words, nothing of Filament's said into its answer, what it asks to do
    // judged at read-only, and Filament's tools left out. The header is house-only, so a client cannot claim it.
    const ownCall = !!rec.memoryFor;
    // Host mode (HarnessV3-ACP AC6-1): the registry launched this request as a sub-agent's run and says what the run
    // is. The header is house-only, so a client cannot claim it. A sub-agent's run has no other candidate: a model
    // behind its agent's fallback would answer its brief without hands.
    const registry = deps.subagents || null;
    const saId = String(inboundHeaders["x-filament-subagent"] || "");
    const host = saId ? registry?.hostOf(saId) || null : null;
    if (saId && !host) {
      const said = `no sub-agent ${saId} is waiting for its run`;
      sendJson(res, 409, errorBody(format, 409, said));
      finish(rec, { status: "error", httpStatus: 409, error: said });
      return;
    }
    if (host) isLast = true;
    // Another machine's agents' chat (`meta.agentDevice`, the chat's own or the one its sub-agent runs for) takes its
    // model by its name alone (`MODEL_MARKS`): their door refuses the marks, and a sub-agent its agent launched on a
    // name that routes as written (core/model-choice.js `routedAsNamed`) is refused them here. `agentDevice`: the id of
    // their device; null for any other chat. A meta that cannot be read is read as theirs (`UNREAD_DEVICE`), as turn.js
    // and server.js read it.
    const agentDevice = (() => {
      const chat = chainRefOf(inboundHeaders) || String(mem?.chain || "");
      try {
        const id = chat ? memory?.archive?.metaOf(chat, ["agentDevice"])?.agentDevice : null;
        return typeof id === "string" ? id : null;
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} remote: whether chat ${chat} was started by another machine's agents could not be read (${e?.message || e}): its turn runs as theirs`);
        return UNREAD_DEVICE;
      }
    })();
    const theirs = agentDevice !== null;
    // Under Full control (devices.js `fullControl`, read once for the turn) their chat runs as the person's own: the
    // coding agent opens with the person's settings, MCP servers and skills, and Filament's tools reach past its folder.
    // No machine of this Filament's is offered it all the same (`launchOffer`).
    const fenced = theirs && !fullControl(deps.devices ?? null, agentDevice);
    const mark = theirs ? [...String(body.model || "")].find((c) => Object.hasOwn(MODEL_MARKS, c)) : null;
    if (mark) {
      const said = `another machine's agents' chat runs on a model named alone: "${mark}" in ${body.model} names ${MODEL_MARKS[mark]}`;
      sendJson(res, 400, errorBody(format, 400, said));
      finish(rec, { status: "error", httpStatus: 400, error: said });
      return;
    }
    // A coding agent here works on this machine's person's sign-in: their chat, or its sub-agent, runs on one while
    // their device's grant `codingAgents` is on, or Full control, which holds it (services/devices.js `heldGrant`), read
    // as it stands — refused before the agent starts, for a revoked device too. A call of Filament's own for their chat
    // (`ownCall`: memory's, a summary's) is no turn of theirs.
    if (theirs && !ownCall) {
      const device = deps.devices?.get?.(agentDevice) ?? null;
      if (!device || device.revokedAt != null || !heldGrant(device, "codingAgents")) {
        const who = device?.name || "another machine's agents";
        const said = `${who} may not use coding agents here: ${body.model} is ${upstream.name || upstream.id}, a coding agent on this machine's own sign-in. "Coding agents", pressed on their machine's card in Settings › Remote access › Machines on this machine, lets them.`;
        sendJson(res, 403, errorBody(format, 403, said));
        finish(rec, { status: "error", httpStatus: 403, error: said });
        return;
      }
    }
    // Cursor model ids legitimately end in -high/-xhigh, so render from the unstripped name when the same route matches it
    // — read by the one rule that weighs and holds a mode too (engine.js `agentTurnModel`), so they read this name.
    const template = candidate?.upstreamModel ?? route.upstreamModel;
    const sent = /** @type {NonNullable<ReturnType<typeof agentTurnModel>>} */ (agentTurnModel(config(), body.model, { base: requested.base, route, template }));
    let modelId = sent.model;
    // The model as Filament's window lookup names it (routing's placeOfName: the route's template over the parsed name):
    // where the window the agent names is kept.
    const windowName = renderUpstreamModel(template, requested.base, route.captures || []) || requested.base;
    // A side agent's compaction line (`sideLineOf`): the default share of its agent's window up to 400,000, never its
    // session's — handed to an agent that takes a line of its own (Claude Code's auto-compact window, HarnessV4_Tasks
    // A3); any other compacts at its own point. None while nobody knows the window: the agent's first turn names it.
    const sideKnown = host ? sessionWindowFor(config(), body.model, null) : null;
    const sideWindow = sideKnown?.tokens ?? null;
    const agentHeaders = sideWindow ? { ...inboundHeaders, [LINE_HEADER]: String(sideLineOf(sideWindow)) } : inboundHeaders;
    // `claude-code/sonnet#3716601d`: continue the agent's own session whose id starts with that text.
    /** @type {string | null} */
    let resumeSessionId = sent.resume;
    // `cursor/composer-2.5@plan`: the part after @ selects the agent mode for this turn (and the rest of the session).
    /** @type {string | null} */
    let modeOverride = sent.mode;
    // A sub-agent's run asks as its chat does (the re-read of 11-11). The mode its model's name asks for is taken where
    // the agent asks or plans in it (`modeAsks`), or where its chat's own model names the same mode on this agent: a
    // press set that name (http/admin/press.js). Any other came by a row that is no press — a launch's model, a pool's,
    // a card's, a team's, the main agent's own tool — and would have its agent ask nobody, whatever its chat's switch
    // says: the run goes on in the mode its chat's turns run in, and its record says so. The chat's mode is the one its
    // turns set, as rendered (`agentTurnModel`), never read off its name (the second read of 11-12): a route's own model
    // may set one the name does not show, or drop one it does.
    if (host && modeOverride && !modeAsks(modeOverride, upstream.acp || {})) {
      const own = agentTurnModel(config(), String(mem?.sit?.settings?.model?.name || ""));
      const ownMode = own && own.upstream === upstream.id ? own.mode : null;
      if (ownMode !== modeOverride) {
        (rec.priorChanges ||= []).push(`acp: mode ${modeOverride} not taken from its model's name (${body.model}): a sub-agent's run asks as its chat does, and only its chat's own model names a mode in which its agent asks less`);
        modeOverride = null;
      }
    }
    // an effort suffix hidden behind `#id` was not visible to the generic suffix parser
    if (resumeSessionId && !requested.suffixEffort) {
      const em = /-(low|medium|high|xhigh|max)$/i.exec(modelId);
      if (em) {
        requested = { ...requested, suffixEffort: em[1].toLowerCase() };
        modelId = modelId.slice(0, em.index);
      }
    }
    const acp = upstream.acp || {};
    const dest = destination(upstream);
    if (!dest?.agent) return { failedEarly: true, error: `${upstream.id} runs no agent turns` };
    const bridge = dest.agent; // an ACP process, Codex's app-server, or Cursor's SDK in-process
    if (ownCycle && !bridge.listen) return { failedEarly: true, error: `${upstream.id} shows no turns its agent begins by itself` };
    const agentName = (upstream.name || upstream.id).replace(" (agent via ACP)", "");
    /**
     * The agent compacted its own context during the harness's turn (HarnessV4_Tasks C28): Filament's copy of the chat
     * starts from the summary it handed over, written once the turn's work is archived. Where it handed none, or its
     * session held less than the whole chat, the copy keeps the turn whole, the record says why, and the turn keeps
     * that the agent compacted in it (`meta.ownCompaction`): the session writes the copy's summary itself once the
     * turn has ended, where it keeps its copy in step (C29: sessions/service.js `followCopy`).
     * @param {ReturnType<NonNullable<ReturnType<typeof createAgentRun>["agent"]>["archive"]>} own
     * @param {{ chain: string, turn: number }} at
     */
    const followCompaction = (own, at) => {
      const blockAfter = deps.sessions?.blockAfterOwn ? (/** @type {number} */ toTurn, /** @type {any} */ cut) => /** @type {any} */ (deps.sessions).blockAfterOwn(at.chain, toTurn, cut) : null;
      const row = own.compacted ? followOwnCompaction({ archive: memory.archive, chainId: at.chain, turnId: at.turn, by: agentName, model: modelId, compacted: own.compacted, blockAfter }) : null;
      if (own.left) memory.archive.mergeTurnMeta(at.turn, { ownCompaction: { by: agentName, left: own.left } });
      const copy = compactionSettingsOf(mem?.sit?.settings).follow
        ? "Filament's copy keeps this turn, and a summary of the turns before it is written for the copy once the turn has ended, where a model can write it and they weigh more than a summary would (context.compaction.follow)"
        : "Filament's copy keeps the turns as they were (context.compaction.follow is off)";
      const said = [
        row && `acp: ${agentName} compacted its own context during the turn and handed its summary over: Filament's copy of the chat starts from that summary, then this turn from there on`,
        own.left === "partial" && `acp: ${agentName} compacted its own context during the turn, in a session that held less than the whole chat: its summary is not the chat's — ${copy}`,
        own.left === "unsaid" && `acp: ${agentName} compacted its own context during the turn and handed no summary over: ${copy}`,
      ].filter(Boolean);
      if (said.length) (rec.changes ||= []).push(...said);
    };
    // What the turn gives the agent's session besides the person's words (HarnessV3-ACP AC4-1 to AC4-5): memory's
    // blocks, taken from a copy of the request the agent alone reads — a candidate after it that is no agent gets
    // the request as memory prepared it — and the task graph's words. Filament's own
    // tools stand in the session and turn the request opened.
    // A sub-agent's run is no planner of the session's graph, and what its memory tools keep is filed on the turn that
    // launched it, as the loop's host files it. The graph is a harness chat's own turn's (one the session composed, never
    // Filament's own call): an outside client's request is not reshaped by it (V4-D105).
    // The session Filament's tools stand in: memory's chain where its prepare names it, else the session the request
    // belongs to — where memory left the turn out (D4 of 11-01), or its prepare failed before it opened the turn. Where
    // memory leaves the chat out (`keptOut`: a Memory setting, or Filament's own call, the console Assistant's say) the
    // agent's session is offered none of memory's tools; a turn whose situate failed is its chat's, and is offered them
    // as the chat's other turns are. A chat whose own settings switch memory's tools off (`memory.tools`, which every
    // engine obeys) is offered none either: another machine's agents' chat among them, which no other chat's memory
    // reaches (the remote-agents plan's f-fence).
    const graphs = deps.graphs || null;
    const memChain = mem?.chain || null;
    const keptOut = !!leftOut || mem?.sit?.settings?.memory?.tools === false;
    const graphOn = !host && !ownCall && !!mem?.sit?.composed && !!memChain && !!graphs;
    // The session's team, which this agent leads (AC6-3): a session's own turn, in a session the registry knows. Its
    // words stand in its context, its team's tools are Filament's, and its tasks are the lead's.
    const leadTeam = !host && lead && memChain && registry ? deps.teams?.find(lead.team) || null : null;
    // A team that changes no file (`readOnly`: BugHunters) holds each turn it leads to reading, as its chat on the side
    // is held and the loop's lead is: its lead's own requests, and the workers and the graph its turn opens, whatever
    // the chat's own mode says. Any other turn's mode is the one its request names, else the session's at each call.
    const modeAsked = leadTeam?.readOnly ? "read-only" : inboundHeaders["x-filament-permissions"];
    // What the session offers its agent of Filament's sub-agents (HarnessV4_Tasks E12 step 2, E15 step 3): the saved
    // agents its agent may ask. A harness chat's own turn (one the session composed) is given Filament's agent and wait
    // whatever its session names — a launch's model falls back to the agent's own (the owner's of 11-06) — while an outside
    // client's session has no page to show a launch on, a sub-agent launches none, and a call of Filament's own takes no
    // tools. A team's lead asks on its team's agent tool, which lists whom. Every such turn holds the loop's door into
    // the registry, tools or none (`openLaunch`): what the developer's own sub-agents send the session's agent reaches
    // the turn that runs.
    const offer = mem?.sit?.composed && !host && !ownCall && memChain && registry ? registry.offer(memChain) : null;
    // Whether its own sub-agent tool is held back beside Filament's (toolset.js `CLAUDE_OWN_AGENTS`) is the bridge's to
    // say as it opens the session: the agent declares the adapter that holds it as it starts, which may be after now.
    // Where this Filament keeps a machine for its agents, its agent tool takes machine (the remote-agents plan's
    // s-tools): read once for the turn, it is part of the offer's word, so the session takes the tool as it opens. Another
    // machine's agents' chat takes none: what this Filament keeps there is for the person's agents.
    const launchOffer = offer && !leadTeam ? (!theirs && keepsAgentsMachine(deps.machines) ? { ...offer, machines: true } : offer) : null;
    // It reads along with its workers (HarnessV3-TaskGraph-v2 §12, V2-0b; `engine.supervise`), where Filament keeps the
    // run log their trails are read from. Read as the turn starts: its part and its tools say so for the whole of it.
    const leadReads = !!leadTeam && !!registry?.readsRuns() && readsAlong(mem?.sit?.settings);
    // A turn the session holds to reading (a /plan's, a watcher's wake that only reads) holds a lead whose team changes
    // files as its door does (`openLead`): its part says so for this turn, held by the turn and not by its team.
    const leadHeld = !!leadTeam && !leadTeam.readOnly && sessionMode({ config, archive: null, chain: null, sit: null, header: modeAsked }).fixed === "read-only";
    // Nor does a turn held to reading — a /plan's and an answer it waits on, a watcher's wake that reads, a turn of
    // Filament's own while a plan waits, a team's that changes no file — take a mode from its model's name in which its
    // agent asks nobody (the second read of 11-12: a /plan's turn in a chat on `…@bypassPermissions` set its agent to that
    // mode, and the switch that holds the turn heard of no call): its agent asks, as the chat's own turns ask
    // (acp/configure.js), and the record says so. A mode in which it asks or plans is taken as named.
    if (modeOverride && !modeAsks(modeOverride, acp) && sessionMode({ config, archive: null, chain: null, sit: null, header: modeAsked }).fixed === "read-only") {
      (rec.priorChanges ||= []).push(`acp: mode ${modeOverride} not taken from its model's name (${body.model}): the turn is held to reading, and in that mode its agent asks nobody`);
      modeOverride = null;
    }
    body = ownCall ? asOneMessage(format, body) : structuredClone(body);
    // The chat moved to another place since its last turn (HarnessV4_Git_Plan GW-D72): its agent, in a new session in
    // the new folder, hears where it works now with this prompt, until a turn runs to its end. Its moves alone are read
    // of the chat's meta, at every turn.
    const moved = !host && !ownCall && !!mem?.sit?.composed && memChain ? moveNote(memory.archive?.metaOf(memChain, ["moves"])) : null;
    // A team that names its workers' models runs them there (team_v2_plan TV2-D8): read once for the turn.
    const leadRows = leadTeam && registry ? await registry.teamRows(leadTeam, memChain || null) : null;
    // The chat's skills for its agent (HarnessV4_Skills_Plan S1-1 to S1-3): a harness chat's folders and plugins on,
    // less those the agent loads from its own folders — the chat's and the one it works in. Read as the turn opens for
    // the words that name them; the skill tool reads them again at each call. Another machine's agents' chat has none: the
    // Library and the plugins are the person's.
    const chatCwd = String(inboundHeaders["x-filament-cwd"] || mem?.sit?.project?.cwd || "");
    const workCwd = String(host?.workdir || chatCwd);
    const agentSkills =
      mem?.sit?.composed && !ownCall && !fenced && memChain && chatCwd && mem?.sit?.settings
        ? skillsForAgent(loadSkills(mem.sit.settings), [...new Set([...agentSkillFolders(upstream, chatCwd), ...agentSkillFolders(upstream, workCwd)])])
        : null;
    // Filament's co-author line on a commit (Settings › Agent loop's `sessions.commitTrailer`, the owner's of 11-10): asked
    // of a harness chat's agent and the agents it sends, never of Filament's own call or an outside client's request.
    const commitTrailer = !!mem?.sit?.composed && !ownCall && config().sessions?.commitTrailer !== false;
    const context = agentContext({
      format,
      body,
      graph: graphOn,
      trailer: commitTrailer,
      // Its lines name the models its members run on, each as its launch resolves it (HarnessV3-TaskGraph-v2 TG2-D47).
      role: host ? workerWords(host) : leadTeam ? leadWords(leadTeam, { asks: !!offer?.asks.length, supervise: leadReads, held: leadHeld, models: registry?.modelsOf(memChain, leadTeam.members, String(body.model || ""), undefined, leadRows) ?? null }) : null,
      roleGone: leadTeam ? leadGone(leadTeam) : null,
      lead: !!leadTeam,
      launch: launchOffer,
      // Parallelize tasks on for the chat (the owner's of 11-09 and 11-16): the person's consent, its block beside the graph's.
      parallel: deps.parallelFor ? deps.parallelFor(memChain) : config().experimental?.parallelizeTasks === true,
      moved: moved?.text ?? null,
      // What of its services the chat's place uses, said beside the servers it is given (the owner's word of 10-26).
      servers: mem?.sit?.composed && !ownCall && !fenced && !(host?.card?.toolsOff || []).includes("mcp") && Array.isArray(mem?.sit?.settings?.plugins?.mcp) ? mem.sit.settings.plugins.mcp : null,
      skills: agentSkills,
      briefing: mem?.prep?.briefingInForce ?? null,
      goal: mem?.prep?.goalInForce ?? null,
    });
    // The envelopes still sealed (HarnessV4_Envelopes_Plan case 12, EN-D6): the turn's first prompt carries a line each
    // after the developer's words — none opened for it — where its session was given the envelope tool; its later
    // prompts go without, as what they carry opens them or says them.
    const sealedAtStart = (leadTeam || launchOffer) && memChain && registry && !ownCycle ? registry.envelopes(memChain) : [];
    // Where it stands on its task graph (HarnessV4_TaskGraphPlus_Plan E41 P1 case 1): the turn's first prompt carries
    // it while the graph has open tasks — its later prompts go without, the words as they stood when the turn opened.
    // Asked for once a turn, here: the turn begun counts on each running task of its own (E41 P2 case 13), kept once the
    // first prompt carrying it reached the agent (`whereGiven`, `reachedNow`; c-begin) — one that never did, or went as
    // the agent's own command, marks nothing. With nothing open there is nothing to hear: what the start keeps is kept at once.
    const whereOpening = graphOn && memChain && !ownCycle && graphs?.opening ? graphs.opening(memChain, leadTeam ? leadTeam.members : "agent") : null;
    const whereAtStart = whereOpening?.words ?? null;
    if (whereOpening && whereAtStart == null) whereOpening.begun();
    // What is still open for a harness chat's main agent (agent/still-open.js; the owner's plan of 11-02, Phase 4): told
    // again after it compacts its own context, and with a turn's first prompt where it compacted with nothing said
    // after, or where a change it was told waits for it went since — the list as it stands then, after the developer's
    // words, never in the session's standing instructions. The chat keeps what it heard only once the prompt that
    // carried it reached the agent, at the turn's end (`openEnded`).
    const openFor = !host && !ownCall && !!mem?.sit?.composed && !!memChain && deps.stillOpen ? deps.stillOpen : null;
    // Whether the session has Filament's tools, recall's among them (the owner's of 11-08): as the agent declared on
    // starting, where the turn has not opened it yet — an agent that declares no HTTP MCP server is offered Filament's
    // through the relay over stdio, where the install holds it, and else none (toolset.js `mcpOk`); once it has, as its
    // bridge says (`ownTools`). An agent never seen yet is taken to have them, as every bridge offers them where it can.
    const declaredOwn = () => {
      const p = deps.agentProfile?.(upstream.id);
      return !p?.mcp?.declared || p.mcp.http === true || relayHere();
    };
    // The chat moved to this agent from another model (`handover`, sessions/reattach.js `handoverFor`; the owner's of
    // 11-08): what stands goes with its first prompt where the list of what is open goes — the list is part of it, so
    // nothing is said twice — and the chat keeps that the agent heard the list once that prompt reached it, as for the
    // list alone.
    // Its dismiss words, as those of the block kept with Filament's summary its seed may carry, go only to an agent with
    // Filament's envelope tool: a lead's, or one Filament's sub-agents launch through (still-open.js `withDismiss`).
    const dismissOk = !!(leadTeam || launchOffer) && declaredOwn();
    const handedOver = handover?.text && !ownCycle ? { ...handover, text: withDismiss(handover.text, dismissOk) } : null;
    // A switch right after the agent's own compaction, which nothing said since (the hunt of 11-08): the model the chat
    // moved to starts from that summary too, so recall's list of the turns — what the compaction was owed (`openWords`),
    // and what the turn's end takes as said — rides with what stands, where its session has Filament's tools.
    const owedRecall = !!handedOver && !!openFor && !!memChain && !ownCycle && declaredOwn() && openFor.due(memChain)?.why === "lost";
    // What the folder holds is read where the list is said now (`dueNow`), and for its own compaction in the turn.
    /** @type {{ text: string, keys: string[], why: "lost" | "folded" | "changed" | "waits" | "more" | "switched" } | null} */
    const openAtStart = openFor && memChain && !ownCycle ? (handedOver ? { text: owedRecall ? `${handedOver.text}\n\n${RECALL_AFTER}` : handedOver.text, keys: openFor.keys(memChain), why: "switched" } : await openFor.dueNow(memChain, { recall: declaredOwn(), dismiss: dismissOk })) : null;
    if (openFor && memChain) void openFor.refresh(memChain);
    /** The words under the session's redaction, as the block after a summary has them. @param {string} text */
    const openSaid = (text) => {
      const redact = redactorOf(mem?.sit?.settings?.privacy?.redact);
      return redact ? redact(text) : text;
    };
    /** The skills this turn loaded with Filament's skill tool since it began, or since the agent last compacted. @type {{ name: string, turn: number }[]} */
    let skillsHere = [];
    /** The calls of Filament's skill tool under way, by id: the skill each loads. @type {Map<string, string>} */
    const skillCalls = new Map();
    /**
     * Whose skills the turn's agent is owed after its compaction (`skillsBack`): the chat's own agent's — a cycle it
     * began by itself too —, or a sub-agent's run its own, by the sub-agent's id; none for Filament's own call, which is
     * no session of the chat's.
     */
    const skillsOf = memChain && !ownCall ? { chain: memChain, who: host ? String(host.id) : CHATS_AGENT } : null;
    /**
     * A skill the agent loaded (c-skills): this turn's, and no longer one its last compaction brings back — its text is in
     * its context again. @param {string} name
     */
    const skillLoaded = (name) => {
      skillsHere.push({ name, turn: Number(mem?.prep?.turnN) || 0 });
      if (skillsOf) skillsBack.loaded(skillsOf.chain, skillsOf.who, name);
    };
    /**
     * The turn's agent as the composer reads it (checkpoint.js `READERS`): the coding agents' row for what it is — a
     * team's lead, a sub-agent, a chat's own agent —, with what the moment alone knows: how words reach its running turn
     * now (`steer`: none before its session is up), and whether its session has Filament's envelope tool.
     * @param {"queued" | "live" | "next" | null} steer @param {boolean} envelopes
     */
    const readerOf = (steer, envelopes) => ({ ...(leadTeam ? READERS.codingLead : host ? READERS.codingWorker : READERS.claude), steer, envelopes });
    /**
     * What comes back after the agent's own compaction (checkpoint.js `compose`, "after-compact"), as it stands as it is
     * said: its task graph as a compaction hands it back — where it stands, a graph left open with all done too —, what is
     * still open (`lines` where the caller read them; without its team's workers, whom a lead hears in its team's words),
     * the skills it had loaded (`skillsBack`), a lead's team (`team`), and the envelopes still sealed (`sealed`: not where the turn's first prompt lists them
     * itself) — one block, in words of that compaction (`when`: "now" in the turn, "since" at its next turn's start, where
     * its graph comes back as that start says where it stands), and
     * recall's list of the turns where its session has Filament's tools (`recall`). A coding agent's own compaction keeps
     * what files it needs: none come back (checkpoint.js DIVERGENCE recent-files). `steer`: how words reach its running
     * turn; `session`: the agent's session, whose own tasks are named as its; `opens`: whether it has the envelope tool.
     * `keys`: what is open as it says it; `envelopes`: the ones it lists; `graph`: the graph's words where it carries the
     * graph, else null; "" where nothing comes back.
     * @param {"now" | "since"} when
     * @param {{ lines?: readonly string[] | null, team?: string | null, sealed?: boolean, steer?: "queued" | "live" | "next" | null, session?: string | null, opens?: boolean, recall?: boolean }} [o]
     */
    const backText = (when, { lines = null, team = null, sealed = true, steer = null, session = null, opens = declaredOwn(), recall = declaredOwn() } = {}) => {
      const graph = graphOn && memChain && !ownCycle && graphs ? graphs.open(memChain, leadTeam ? leadTeam.members : "agent", { starting: when === "since" }) : null;
      const open = lines ?? (openFor && memChain ? openFor.of(memChain, null, { workers: false, agentSession: session, others: true }).lines : null);
      const list = sealed && opens && memChain && registry ? registry.envelopes(memChain) : [];
      // The skills it had loaded as it compacted, but one a call of its loads now: that call's answer carries its text.
      const loading = new Set([...skillCalls.values()].map((n) => n.toLowerCase()));
      const skills = skillsOf ? skillsBack.of(skillsOf.chain, skillsOf.who).filter((k) => !loading.has(k.name.toLowerCase())) : [];
      const c = compose("after-compact", readerOf(steer, opens), { back: graph || open?.length || skills.length ? { files: [], plan: null, graph, open: open?.length ? open : null, letters: null, ended: null, skills: skills.length ? skills : null } : null, team: team || "", sealed: list.length ? sealedListText(list) : "" });
      // One lead line: the team is a part of the block, said after what is open.
      const parts = c.blocks.find((b) => b.id === "back")?.back;
      const crew = c.blocks.find((b) => b.id === "team")?.text || null;
      const back = parts || crew ? reattachBlock({ files: [], plan: null, graph: parts?.graph ?? null, root: "", rules: [], redact: redactorOf(mem?.sit?.settings?.privacy?.redact), window: null, open: parts?.open ?? null, skills: parts?.skills ?? null, team: crew, own: when, dismiss: recall && !!(leadTeam || launchOffer), recall }).text : "";
      const text = [back, textOf(c.blocks.filter((b) => b.id !== "back" && b.id !== "team"))].filter(Boolean).join("\n\n");
      return { text: text && recall ? `${text}\n${RECALL_AFTER}` : text, keys: openFor && memChain ? openFor.keys(memChain) : [], envelopes: list.map((e) => e.n), graph: parts?.graph || null };
    };
    // A compaction of its own that nothing said after (`lost`) comes back at this start as the block its turn never heard
    // (checkpoint.js: owed) — what is open in it, and its graph where it has one, in place of the list and where it
    // stands said alone (FabeleHelper's of 11-10: nothing twice); the envelopes still sealed are listed after it, as at
    // any start. With nothing to bring back, the compaction and recall's list alone.
    const owedBack = openAtStart?.why === "lost" ? backText("since", { lines: openFor?.of(String(memChain), null, { workers: false }).lines ?? null, sealed: false }) : null;
    const opening = owedBack?.text || openAtStart?.text || handedOver?.text || "";
    // In the order the loop's turn start has them (checkpoint.js `compose`, FabeleHelper's of 11-10): what comes back,
    // what is open, the envelopes still sealed, where it stands.
    // The owed block is rendered already (`opening`): its parts carry the graph's words alone, where it has them, which
    // where it stands then goes without.
    const owes = !!owedBack?.text;
    // What the chat's own agent was owed of its skills and no start will say any more goes — its compaction undone, a
    // summary of Filament's landed since, the chat moved to another model: its next compaction owes what it loads from here.
    if (skillsOf && !host && !ownCycle && openAtStart?.why !== "lost") skillsBack.heard(skillsOf.chain, skillsOf.who);
    const startReader = readerOf(null, !!(leadTeam || launchOffer));
    const sealedFact = sealedAtStart.length ? envelopesBlock(sealedAtStart).text : "";
    // A move to this agent (`handedOver`) is the switch's moment: what stands goes as the handover, its task graph with
    // where it stands in it, so no word of where it stands goes beside it (FabeleHelper's of 11-10: the parity map's
    // switch double) — as the turn's start says it (sw-quiet), so the handover going is where it stands going.
    const switched = !!handedOver && !owes;
    // The files it read or wrote that changed since it last saw them (c-news): named, with how many lines changed — it
    // reads them again with its own tools —, as the loop's start tells them. A run of its own (`ownCycle`) and a
    // sub-agent's are no turn of the chat's. Their sightings move once the prompt that names them reached the agent
    // (`newsGiven`, `reachedNow`): one that never did, or went as the agent's own command, leaves them for the next
    // (checkpoint.js: a prompt that never reached it says nothing). With nothing to tell, what the look found moves now.
    const sightings = memChain && !ownCycle && !host ? agentSightings(memChain) : null;
    // A move to this agent: what the chat's agent before it saw is no sight of its own, and is told as the chat's.
    if (sightings && memChain && handedOver) setAside(memChain, sightings, handedOver);
    const news = sightings ? await newsOf(sightings, workCwd) : null;
    const newsNames = news?.names || "";
    const newsFact = newsNames ? { text: "", names: newsNames } : null;
    if (news && !newsFact) news.commit();
    const start = switched
      ? compose("switch", startReader, { fileNews: newsFact, handover: opening, sealed: sealedFact })
      : compose("turn-start", startReader, {
          fileNews: newsFact,
          back: owes ? { files: [], plan: null, graph: owedBack?.graph ?? null, open: null, letters: null, ended: null, skills: null } : null,
          owed: owes,
          open: owes ? "" : opening,
          sealed: sealedFact,
          where: whereAtStart || "",
        });
    // Where it stands, as a summary's block brings it back: a fresh session's seed that holds it, or this, says it
    // already, and the bridge leaves the block out (context.js `notHeldIn`), as the loop's turn start does (`whereHeld`).
    const whereBack = whereAtStart && memChain && graphs?.where ? graphs.where(memChain, leadTeam ? leadTeam.members : "agent", { back: true }) : null;
    // Each composed block as the agent's context carries it, by its id: its words, and the tool it is said for.
    /** @param {readonly import("./agent/checkpoint.js").Block[]} blocks @param {string} open  the block that says what is open */
    const blocksOf = (blocks, open) =>
      startBlocks(blocks, {
        open: () => ({ id: OPEN_BLOCK, text: openSaid(open) }),
        sealed: () => envelopesBlock(sealedAtStart),
        where: () => ({ ...whereBlock(String(whereAtStart)), sameAs: [String(whereAtStart), ...(whereBack ? [whereBack] : [])] }),
      });
    const firstBlocks = blocksOf(start.blocks, opening);
    // The prompt that says a compaction nothing was said after — the block it owes, or with nothing to bring back that
    // the chat's context was compacted — may open a new session from Filament's copy of the chat instead (the bridge's
    // seed: an agent that cannot open its session again after a restart, a session it lost). That session never
    // compacted, and its seed holds what the compaction left: it hears what any start says — what is open as it stands,
    // in words of a session that begins; where it stands, unless the seed says so (`sameAs`) — and the skills it is
    // owed, unless a summary's block in the seed names each (`allIn`); nothing of the compaction (context.js `seeded`).
    const unsaid = openAtStart?.why === "lost";
    /** @param {Partial<Parameters<typeof reattachBlock>[0]>} parts */
    const seedBlock = (parts) => reattachBlock({ files: [], plan: null, root: "", rules: [], redact: redactorOf(mem?.sit?.settings?.privacy?.redact), window: null, own: "seed", dismiss: dismissOk, recall: false, ...parts }).text;
    const seedLines = unsaid ? (openFor?.of(String(memChain), null, { workers: false }).lines ?? []) : [];
    const seedOpen = seedLines.length ? seedBlock({ open: seedLines }) : "";
    const seedSkills = unsaid && skillsOf ? skillsBack.of(skillsOf.chain, skillsOf.who) : [];
    const seedStart = unsaid ? blocksOf(compose("turn-start", startReader, { fileNews: newsFact, open: seedOpen, sealed: sealedFact, where: whereAtStart || "" }).blocks, seedOpen) : null;
    const seedSkillsBlock = seedSkills.length ? { id: SKILLS_BACK_BLOCK, text: seedBlock({ skills: seedSkills }), allIn: seedSkills.map((k) => `\n- ${k.name} (turn `) } : null;
    // The skills come first of what stands, as the block owed names them with what comes back: after the files' news.
    const seedFirst = seedStart ? seedStart.findIndex((b) => b.id !== "file-news") : -1;
    const seedBlocks = !seedStart ? null : !seedSkillsBlock ? seedStart : seedFirst < 0 ? [...seedStart, seedSkillsBlock] : [...seedStart.slice(0, seedFirst), seedSkillsBlock, ...seedStart.slice(seedFirst)];
    /** The first prompt's context, with that list and where it stands. @type {import("../adapters/agents/context.js").AgentContext | null} */
    let firstContext = { ...context, prompt: [...context.prompt, ...firstBlocks], ...(seedBlocks ? { seeded: [...context.prompt, ...seedBlocks] } : {}) };
    // The prompts after it carry what the turn owes the agent — a sub-agent's report, a relayed note, a letter — never
    // the person's words: what goes with a prompt alone (memory's recall, its errata and quotes, made for those words; a
    // move's note) went with theirs, and on each later prompt it would be the same text again, a memory retired since
    // among it (the main agent's chat of 11-09). What stands for the session goes on as it does.
    const laterContext = { ...context, prompt: [] };
    // `launch`: the offer as one word — a changed word is a changed tool, which a session takes as it opens.
    const launch = leadTeam ? leadLaunchKey(offer?.asks || [], leadTeam.members) : launchOffer ? launchKey(launchOffer) : "";
    // A team's worker whose lead reads along asks it with ask_lead, by its id (HarnessV3-TaskGraph-v2 TG2-D49).
    const toolsTurn = (host ? mem?.prep?.launchTurn : mem?.prep?.turn) || null;
    // A harness chat shows the agent's visuals (HarnessV4_Visuals_Plan E16), kept on the turn as the loop's are — a
    // sub-agent's on the turn that launched it, one no turn launched on its session (VS-D48), and the chat's own agent's
    // there too in a turn memory keeps no row of (`rowless`: one it leaves out for a reason of its own, or whose situate
    // or prepare failed) — while the session's switch (loop.tools.show_visual) is on.
    // A sub-agent goes without what its card switched off (HarnessV4_ShippedAgents_Plan SA2): Filament's tools it is
    // handed, and the chat's MCP servers. Its own built-in tools are its agent's, and follow its level.
    const cardOff = new Set(host?.card?.toolsOff || []);
    const visuals = !!mem?.sit?.composed && !ownCall && (!!toolsTurn || (!!memChain && (!!host || !!mem?.rowless))) && mem?.sit?.settings?.loop?.tools?.show_visual !== false && !cardOff.has("visuals");
    // It makes artifacts (HarnessV4_Artifacts_Plan AF-D3) in a harness chat, as the loop's agent does — its own agent
    // and the agents it sends or asks (OA1), never an agent that started by itself — while the
    // session's switch (loop.tools.artifact) is on. Another machine's agents' chat goes without it, and without the team,
    // flow and browser tools, the Space and the chat's MCP servers (turn.js AGENTS_CHAT_OFF): each reaches past its folder
    // into what is the person's here.
    const artifacts = !!deps.artifacts && !ownCall && !fenced && !!memChain && artifactsMakeHere({ composed: !!mem?.sit?.composed, host }) && mem?.sit?.settings?.loop?.tools?.artifact !== false && !cardOff.has("visuals");
    // A harness chat's own MCP servers and the folders it adds for reading (HarnessV4_Overnight_Plan OV-D15, OV-D17,
    // OV-D23), as Filament's own agent takes them: for the chat's agent, its sub-agents, a team's workers and its lead —
    // which has hands of its own (HarnessV4_Tasks decision 9) — and never for Filament's own call or an outside client's
    // request.
    const harnessChat = !!mem?.sit?.composed && !ownCall;
    // Teams beside the chat (team_v2_plan §5.5): fired by a harness chat's own agent — never a team's lead, a worker or
    // a helper — in a chat that fires them (a team's own does not), while the chat's switch (loop.tools.team) is on.
    const beside = harnessChat && !fenced && !host && !leadTeam && !!memChain && !!deps.beside?.fires(memChain) && mem?.sit?.settings?.loop?.tools?.team !== false;
    // A flow beside the chat (HarnessV4_OneAgent_Plan OA3, L41): designed by the same agent, in the same chats, while the
    // chat's switch (loop.tools.flow) is on.
    const flow = harnessChat && !fenced && !host && !leadTeam && !!memChain && !!deps.flow?.fires(memChain) && mem?.sit?.settings?.loop?.tools?.flow !== false;
    // A thread of the chat (app/threads.js): started by the same agent, in the same chats, while the chat's switch
    // (loop.tools.thread) is on — never in a chat of another machine's agents, Full control or not.
    const thread = harnessChat && !theirs && !host && !leadTeam && !!memChain && !!deps.thread?.starts(memChain) && mem?.sit?.settings?.loop?.tools?.thread !== false;
    // The chat's browser (HarnessV4_AgentTools_Plan AT-D7): a harness chat's agent drives it through Filament's MCP
    // server, as the loop's does — its sub-agents too, each in tabs of its own (AT-D2) — while the chat's switch
    // (`plugins.browser`, `loop.tools.browser`) is on.
    const browser = harnessChat && !fenced && !!memChain && !!deps.browsers && !cardOff.has("browser") && browserOffered(mem?.sit?.settings, mem?.sit?.settings?.loop?.tools?.browser === false ? ["browser"] : []);
    // The project's Space (the owner's of 11-08, h3): whether a harness chat's project has one made, its switch on, now —
    // read as Filament's tools list it (agent-tools.js `spaceAt`), never for a card without it. An agent reads its tools
    // as its session opens, so a Space made, switched off or deleted since opens the session again. An outside client's
    // request is given no server of Filament's for it.
    const spaceOn = harnessChat && !fenced && !cardOff.has("space") && !!memChain && !!deps.space && !!spaceProjectOf(deps.space, memChain) && deps.space.on(memChain);
    const listed = harnessChat && !fenced && !cardOff.has("mcp") ? (Array.isArray(mem?.sit?.settings?.plugins?.mcp) ? mem.sit.settings.plugins.mcp : []).filter((m) => m && !mcpServerProblem(m)) : [];
    // A signed-in server goes at Filament's door, which adds its token as it forwards each request (the owner's of 11-07):
    // a renewal changes nothing the agent was given, so its session goes on. One whose sign-in ended is left out, in
    // words (HarnessV4_Settings_Plan HS-D88, HC-149).
    // A chain named by id (the harness's sessions) is the agent conversation's name, as it is the loop's: a client
    // that names neither is told apart by its first message. A sub-agent's is its own, never its session's: a
    // follow-up goes on in it, the agent holding all it read (AC6-D2).
    const chainRef = chainRefOf(inboundHeaders);
    const conversationId = ownCall ? `own:${rec.id}` : host ? `subagent:${host.id}` : chainRef ? `chain:${chainRef}` : clientConversationId(inboundHeaders);
    // The door names the chat by the conversation the agent's session is kept under, and lets go of what its last turn
    // gave: a server no longer listed answers no more.
    // A client that names no conversation keeps no session: its turn is its own.
    const door = deps.connectors;
    const doorChat = conversationId || `turn:${rec.id}`;
    door?.forget(doorChat);
    const signed = listed.length && deps.mcpSignIns && door ? deps.mcpSignIns.forAgent(listed, (s) => door.give(selfBase(), doorChat, s)) : { list: listed, words: [] };
    const chatServers = signed.list;
    for (const w of signed.words) (rec.priorChanges ||= []).push(w);
    const added = harnessChat ? addedFoldersOf(config(), mem?.sit?.settings?.loop?.addedFolders, { person: !theirs }) : { folders: [], left: [] };
    for (const l of added.left) (rec.priorChanges ||= []).push(`acp: an added folder is left out — ${l}`);
    // Another machine's agents' chat without Full control reads none their fence refuses (turn.js `fencedAdded`).
    if (fenced) added.folders = fencedAdded(added.folders, (f) => deps.agentsFolder?.(f, agentDevice) ?? null, rec, "priorChanges");
    // `by`: the sub-agent whose run it is and which of its exchanges, which its visuals are kept under. `callOf`: the
    // agent's own call a call over MCP came in, on the turn's run (agent-run.js `callFor`), whose id and round a visual
    // takes; `callIsOwn`: whether it came in the agent's own call or a sub-agent's of its own, which calls over the
    // agent's session — what the turn owes the agent's next answer rides only its own (agent-tools.js `tailed`).
    const toolsAt = {
      chain: memChain,
      turn: toolsTurn,
      graph: graphOn,
      report: !!host?.task,
      ...(host?.askLead ? { asksLead: host.id } : {}),
      team: !!leadTeam,
      reads: leadReads,
      // A turn for a caller that reaches its own project's sessions alone: memory's tools keep to them (port.js), memory
      // situating the request or not.
      ...(confined ? { confined: true } : {}),
      // A chat memory leaves out — by a Memory setting, or Filament's own call: none of memory's tools.
      ...(keptOut ? { leftOut: true } : {}),
      // A chat memory works in, its tools offered or not (the owner's of 11-09): Claude Code's own auto memory goes off
      // there, so two memories never write (acp/toolset.js).
      ...(!leftOut ? { memoryWorks: true } : {}),
      // A turn memory keeps no row of: the chat's own agent's pictures are kept on its session while it runs.
      ...(mem?.rowless ? { rowless: true } : {}),
      launch,
      visuals,
      artifacts,
      beside,
      thread,
      flow,
      browser,
      skills: !!agentSkills && agentSkills.skills.length + agentSkills.library.length > 0,
      ...(cardOff.has("space") || fenced ? { space: false } : {}),
      spaceOn,
      // Their chat's coding agent opens with none of this machine's MCP servers (chat-servers.js `serversFor`, Codex's
      // `theirsOff`), and Claude Code with none of the person's settings nor its own tools that reach past the folder
      // (acp/toolset.js).
      ...(fenced ? { agentsChat: true } : {}),
      // Filament's co-author line on (Settings › Agent loop, the owner's of 11-10): Claude Code's attribution carries it
      // (acp/toolset.js), and the standing context asks it of every agent (`commitTrailer` above).
      ...(commitTrailer ? { trailer: true } : {}),
      model: String(body.model || ""),
      mcp: chatServers,
      dirs: added.folders,
      ...(host ? { by: { id: host.id, exchange: host.brief.exchange, name: host.card.name, ...(host.team ? { team: { key: String(host.team.key), name: String(host.team.name) } } : {}) } } : {}),
      callOf: (/** @type {string} */ name) => (run.agent ? run.agent.callFor(name) : Promise.resolve(null)),
      callIsOwn: (/** @type {string} */ name) => (run.agent ? run.agent.callIsOwn(name) : Promise.resolve(null)),
      ...(ownCall ? { none: true } : {}),
    };
    // Where the agent works: a sub-agent's own worktree, when it has one (its request names the session's folder, its
    // project), else the folder the request names.
    // A call of Filament's own reads no project: it runs in a folder of Filament's, apart from the person's.
    const cwdHint = ownCall ? deps.ownCallFolder?.() || null : host?.workdir || inboundHeaders["x-filament-cwd"];
    // The folder the request names, judged as Filament's own loop judges its working folder (`folderVerdict`): one
    // outside the roots agentLoop.roots lists has the turn answered in the loop's words, the agent not called (below,
    // where Filament answers by itself); with none listed, any folder is the agent's. Filament's own call runs in its
    // own folder, and a cycle the agent began by itself is its session's, under way already. Filament's copies folder is
    // a root for another machine's agents' chat alone (`person`), as the loop judges it.
    const fence =!ownCall && !ownCycle && cwdHint ? folderVerdict(config(), String(cwdHint), { person: !theirs }) : null;
    // A harness chat's run that only reads for the whole of its turn — its request names read-only, as a Reviewer's
    // does — has its commands that only read reach its repository's other worktrees too, Filament's helper copies among
    // them (the owner's of 11-09), as the loop's agent does: judged by the session's switch, read once a turn before the
    // agent is called (`worktreeReads`). A run whose mode may let it write gets none.
    const worktreesListed =
      harnessChat && fence?.ok && sessionMode({ config, archive: null, chain: null, sit: null, header: modeAsked }).fixed === "read-only"
        ? worktreeReadsOf(config(), fence.root, { person: !theirs }).then((l) => (fenced ? l.filter((f) => !deps.agentsFolder?.(f, agentDevice)) : l))
        : null;
    /** @type {string[]} */
    let worktreeReads = [];
    // The client's own tools (Read, Write, Edit, Bash, AskUserQuestion, TodoWrite …). When the agent needs
    // a hand, Filament ends the reply with one of these tool calls and continues the turn from the client's next request.
    const clientTools = ClientToolset.from(format, body);
    const toolResults = extractToolResults(format, body).filter((r) => isActionId(r.id));
    const liveTurn = bridge.turnForRequest({
      upstream,
      format,
      body,
      cwdHint,
      conversationId,
      actionIds: toolResults.map((r) => r.id),
    });
    const continuing = toolResults.length > 0 && !!liveTurn;
    // Effort: from a Filament suffix (`cursor/grok-4.6-xhigh`) or the client's own field. Only applied when the
    // upstream says how its agent spells effort (acp.effortTemplate); otherwise effort is part of the model name.
    const clientEffort = (body.output_config && body.output_config.effort) || body.reasoning_effort || null;
    const effort = requested.suffixEffort || clientEffort || null;
    /** @type {string | null} */
    let effortNote = null;
    if (effort && acp.effortTemplate) {
      const base = renderUpstreamModel(template, requested.base, route.captures || []).replace(
        /@[A-Za-z][\w-]*$/,
        "",
      );
      modelId = acp.effortTemplate.replace(/\{model\}/g, base).replace(/\{effort\}/g, effort);
      effortNote = `acp: effort ${effort} (from ${requested.suffixEffort ? "model suffix" : "client"}) -> model ${modelId}`;
    } else if (effort) {
      // the bridge applies it when the agent offers an effort setting
      effortNote = `acp: effort ${effort} requested (${requested.suffixEffort ? "model suffix" : "client"})`;
    }
    const stream = body.stream === true;
    // How thoughts travel. `auto` (default): an Anthropic-format client gets one thinking block per thought, in the
    // order they happened, because Anthropic parsers keep one part per content block. An OpenAI-format client keeps
    // ONE reasoning part and ONE text part per reply (the AI SDK's OpenAI-compatible parser hard-codes `reasoning-0`
    // and `txt-0`), so a thought streamed as `reasoning_content` after the text has begun is painted below all the text
    // or merged into the block at the top: for such clients the thoughts before the first text go out natively
    // and every later thought is woven into the text as a quoted paragraph, in order (ThoughtInliner).
    const thoughtsSetting = acp.thoughts || "auto";
    // The harness's own turn reads its thoughts as thinking blocks, whatever an outside client needs; `hide` holds
    // there too (HarnessV3-ACP AC1-4).
    const harness = runEvents === true && !!runs;
    // A turn of a harness chat, its page's or one sent another way (HarnessV4_Overnight_Plan OV-D32, OV-D35): the
    // chat's switch judges what its agent asks, and the chat keeps its work, its snapshots and its outcome as it keeps
    // the page's. The reply's shape alone is the page's (`harness`). A sub-agent's run is its registry's.
    const chatTurn = harness || (harnessChat && !host);
    const thoughtsMode = ownCall
      ? "hide"
      : harness
        ? thoughtsSetting === "hide"
          ? "hide"
          : "thinking-block"
        : thoughtsSetting === "auto"
          ? format === "anthropic"
            ? "thinking-block"
            : "native-then-inline"
          : thoughtsSetting;
    const toolMode = ownCall ? "hide" : acp.toolActivity || "quiet";
    // Whether Filament may speak in the reply at all. Defined once, early, because both the buffered-turn label and the
    // hint/stop-reason block below need it. Off (the default) sends Filament's notes to the request record only: a chat
    // client keeps the reply as permanent context, so every line Filament adds is a line the next model reads and may
    // imitate — switch to an API model mid-conversation and it can start answering in Filament's own style.
    const sayMeta = acp.hints === true;
    Object.assign(rec, {
      upstream: upstream.id,
      upstreamModel: modelId,
      url: dest.transport,
      changes: [],
    });
    if (config().observability.storeBodies !== "none")
      rec.translation = {
        received: summarizeBody(body, format, raw.length),
        sent: { model: modelId, stream, transport: "acp (newest user message only)" },
      };
    log("debug", `${rec.id} ${format} ${body.model} -> acp ${upstream.id}/${modelId}`);

    const wire = createAgentReply({
      res,
      format,
      model: body.model,
      requestId: rec.id,
      upstreamId: upstream.id,
      stream,
      heartbeatMs: agentHeartbeatMs,
      pacingMs: Math.max(0, Number(acp.pacingMs ?? 60) || 0),
      onFirstByte: () => usage.firstByte(rec),
      sideEvents: harness,
    });

    // `null` means "not set, follow the mode's default"; an explicit 0 means "off". Collapsing the two with
    // `Number(x) || 0` would turn "not set" into "show no diffs at all".
    const knob = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    const renderer =
      (continuing && liveTurn?.renderer) ||
      new ActivityRenderer(
        /** @type {any} */ ({
          toolMode,
          agentName,
          diffStyle: acp.toolDiffStyle || null,
          outputMode: acp.toolOutput || null,
          maxDiffFiles: knob(acp.toolDiffMaxFiles),
          maxOutputLines: knob(acp.toolOutputMaxLines),
          // Passed through as it is: the renderer treats only an explicit `false` as "no glyphs".
          icons: acp.toolIcons,
        }),
      );
    if (continuing && liveTurn) liveTurn.renderer = renderer;
    const collector = createTurnCollector({
      rec,
      stream,
      wire,
      thoughtsMode,
      renderer,
      log,
      progress: (fields) => usage.progress(rec, fields),
      harness,
      // A sub-agent's coding agent too (the transcript audit, 2026-10-23): its thread reads its run's words as the page
      // reads a chat's turn. Filament's tool lines were its words there, under the cards that drew the same calls.
      paged: chatTurn || !!host,
      words: liveWords ? { piece: (type, t) => liveWords.piece(rec.id, type, t), endBlock: () => liveWords.endBlock(rec.id) } : null,
    });
    const { col, onEvent, flushThought, ownLine } = collector;

    // The turn's run (HarnessV3-ACP AC1-1), under the request's id as the loop's turn is: opened when the agent's
    // session is up (the bridge says so before the prompt goes out) or the turn this reply continues is known. What
    // Filament answers itself has none, nor has a turn that fails before its session is up.
    const topic = `run:${rec.id}`;
    /**
     * The run, once it starts: what reads the agent's events into the run's, and its mailbox; and the turn's facts as
     * the bridge keeps them (its session, how it began, the lines it changed), from the session's start, which a turn
     * that fails keeps on its record (HarnessV3-ACP AC2-5).
     * @type {{ agent: ReturnType<typeof createAgentRun> | null, mailbox: import("../services/runs.js").Mailbox | null,
     *   facts: Record<string, any> | null }}
     */
    const run = { agent: null, mailbox: null, facts: null };
    /**
     * A side agent's earlier exchanges that gave way before its prompt went (`exchangesGiveWay`): its session was let go
     * of, and its conversation starts from the summary — `start`, the messages its prompt goes with. Null where nothing
     * gave way.
     * @type {{ start: any[] } | null}
     */
    let gaveWay = null;
    /** What the agent spent writing its own summary in its session as they did, or tried to, as it counted it: the exchange's spend counts it. @type {import("../core/ports.js").AgentSummary["usage"]} */
    let summarySpent = null;
    /** The run's stop: the agent cancels its turn (`session/cancel`), which then ends in the stop's words. */
    const stopCtl = new AbortController();
    /** A Force stop ends the turn at once, whatever the agent does with its cancel: what it sends after is no one's. */
    let forced = false;
    /** @type {(v: "forced") => void} */
    let onForced = () => {};
    /** @type {Promise<"forced">} */
    const forcedStop = new Promise((resolve) => (onForced = resolve));
    /** The force, for the bridge: it stops waiting for the agent's answer too, so the chat's next turn can run (HarnessV4_Tasks A5). */
    const forceCtl = new AbortController();
    /** The session the run started on. @type {{ sessionId: string | null, cwd: string | null }} */
    let runSession = { sessionId: null, cwd: null };
    /** How Filament's own words stood when the run started: the archive keeps those said after as the closing lines. */
    let saidFrom = 0;
    /** @type {string | null} */
    let runStatus = null;
    /** @type {{ stop: () => void } | null} */
    let carried = null;
    /** A graph task's sub-agent's report, the latest it gave (AC6-1). @type {import("../core/task-graph.js").TaskReport | null} */
    let taskReport = null;
    /** Whether the agent was asked for its task's report, which it is once. */
    let reportAsked = false;
    /**
     * The turn's door into the registry, while it runs: its team's, where the agent leads one (AC6-3), or a plain
     * chat's that launches Filament's sub-agents (HarnessV4_Tasks E12 step 2); a sub-agent's, the door its own
     * background commands' ends come in by (h1, `attendCommands`).
     * @type {import("./agent-inbox.js").AgentTurn | null}
     */
    let doorTurn = null;
    /** What the sub-agents whose reports the agent got spent so far: nothing where its turn holds no door. */
    const launchedSpent = () => doorTurn?.spentUsd() || 0;
    /** What lets the door go at the turn's end. @type {(() => void) | null} */
    let doorShut = null;
    /** The door's inbox, which the first prompt's list of sealed envelopes tells of its letters (`fresh`). @type {import("./agent/subagents.js").Inbox | null} */
    let turnInbox = null;
    /**
     * Whether the agent opens envelopes (EN-D10): its bridge says the envelope tool reached its session, at the prompt's
     * start — null until then.
     */
    const opensNow = () => (run.facts ? run.facts.opensEnvelopes === true : null);
    /** The session whose task graph the turn's lead runs (G3), which the developer's Stop holds. @type {string | null} */
    let ledGraph = null;
    /**
     * While the agent compacts its own context (HarnessV3-TaskGraph-v2 TG2-D56): nothing goes into its turn, which reads
     * nothing until it is done — what lands meanwhile waits at the door, where the word on a lead's team that follows the
     * compaction knows of it — and the hold's end: the compaction's end, the prompt's, or `COMPACTING_HOLD_MS`.
     * @type {{ ends: Promise<void>, release: () => void } | null}
     */
    let compacting = null;
    const holdWhileCompacting = () => {
      if (compacting) return;
      /** @type {() => void} */
      let done = () => {};
      const ends = /** @type {Promise<void>} */ (new Promise((resolve) => (done = () => resolve(undefined))));
      const timer = setTimeout(() => hold.release(), COMPACTING_HOLD_MS);
      timer.unref?.();
      const hold = {
        ends,
        release: () => {
          clearTimeout(timer);
          if (compacting === hold) compacting = null;
          done();
        },
      };
      compacting = hold;
    };
    /** The way into the agent's running turn, as its newest prompt's session gave it. @type {Steer | null} */
    let steerNow = null;
    // The person's pictures this turn, as its agent's `attach` numbers them (attach.js): its message's, then those of the
    // messages it took into the turn, in the order it took them (`settled`).
    /** @type {import("./agent/attach.js").TurnPicture[]} */
    const heardPictures = [];
    /** @type {() => void} */
    let moveSteer = () => {};
    /** Resolves when the way into the turn moves (`steerTo`): a prompt ends, or the next begins. @type {Promise<void>} */
    let steerMoved = new Promise((r) => (moveSteer = () => r(undefined)));
    /** The way into the agent's turn moves. @param {Steer | null} steer */
    const steerTo = (steer) => {
      steerNow = steer;
      const moved = moveSteer;
      steerMoved = new Promise((r) => (moveSteer = () => r(undefined)));
      moved();
    };
    /** Which words are the agent's own commands, as its newest prompt's session said: kept past the prompt, for a
     *  lead's wait between its prompts (HarnessV3-FailurePoints finding 2). @type {AgentCommands | null} */
    let ownNow = null;
    /** Whether the person's notes are being handed to the agent now. */
    let delivering = false;
    /** Notes queued at the agent (HarnessV3-FailurePoints §7.2), by id: each one's settling, taken or handed back.
     *  None is sent again: one handed back goes as a later prompt's words, or as the next message. @type {Map<string,
     *  Promise<void>>} */
    const atAgent = new Map();
    /**
     * Words queued at the agent that its echo has not shown taken yet, in the order sent: what reads each where the
     * agent took it (`taken`, the bridge's word at the echo, before what the agent does with them).
     * @type {{ words: string, take: (after: boolean) => void }[]}
     */
    const placing = [];
    /**
     * Words queued at the agent, to be read where it takes them (`take`). → what lets them go once their send settles:
     * true while they were never placed — then the send's outcome is the caller's.
     * @param {string} words @param {(after: boolean) => void} take
     */
    const place = (words, take) => {
      const p = { words: words.trim(), take };
      placing.push(p);
      return () => {
        const i = placing.indexOf(p);
        if (i < 0) return false;
        placing.splice(i, 1);
        return true;
      };
    };
    /** The agent took words queued at it, by its echo (the bridge's `taken`). @param {{ text?: string, after?: boolean }} ev */
    const takenAt = (ev) => {
      const i = placing.findIndex((p) => p.words === ev.text);
      if (i >= 0) placing.splice(i, 1)[0].take(!!ev.after);
    };
    /** Whether the agent handed a note back: the deliveries end until the turn's next prompt. */
    let handedBack = false;
    /** The notes that are the agent's own commands, by id → the words weighed: each waits queued for the turn's end,
     *  said once — words changed since are weighed again. @type {Map<string, string>} */
    const heldNotes = new Map();
    /** The notes that waited for the agent to say its commands, by id: said once. */
    const unsureNotes = new Set();
    /**
     * The developer's notes whose wait for the agent's next call is over, by id (HarnessV4_Tasks C34): what they typed
     * waits in Filament until the agent's next tool call starts — until then they may change it or take it back — and
     * then goes, every note queued by then with it. A wait of the agent's that a note ended hands that one over at once
     * (`handOver`).
     * @type {Set<string>}
     */
    const due = new Set();
    /** @type {() => void} */
    let wakeHold = () => {};
    /** Resolves when a held note may go: the agent's next call started, or one is handed over. @type {Promise<void>} */
    let holdEnds = new Promise((r) => (wakeHold = () => r(undefined)));
    /** The notes held so far go: their wait is over. */
    const letHeldGo = () => {
      const woke = wakeHold;
      holdEnds = new Promise((r) => (wakeHold = () => r(undefined)));
      woke();
    };
    /**
     * Whether the sub-agent's turn waits for the background tasks its agent left running (the bridge's `waiting`, the
     * owner's D3 of 11-09): its agent is idle, no call of its comes before their end, and what the developer types goes
     * at once — until the agent's next call, or the prompt's end.
     */
    let tasksWait = false;
    /** When the run's wait for those tasks ends, from its first (COMMANDS_HELD_MS): null before any. @type {number | null} */
    let tasksUntil = null;
    /**
     * The agent's own call started (not a sub-agent's): the developer's notes queued by now go, and what Filament says at
     * a call (`stepWords`) — the turn goes on past this call, so the words go in at its next step. @param {any} ev  the call
     */
    const callCame = (ev) => {
      steps++;
      tasksWait = false;
      for (const m of run.mailbox?.list((x) => x.kind === "note") || []) due.add(m.id);
      letHeldGo();
      void stepWords(ev);
    };
    /** The agent's own calls so far in the turn: its steps, as the loop's rounds. */
    let steps = 0;
    /** The step whose landings the line of the task they came during followed: once a step, as the loop's once a round. */
    let onTaskStep = -1;
    /**
     * Which task of its own the agent is on, and how to take what came up first (task-graph.js `onTaskText`; E41 P1 case
     * 7) — said behind what lands while it runs, a report sealed or the person's words (checkpoint.js "note", the owner's
     * of 11-10: the loop's line reaches the coding agents too): once a step. Null where nothing of its own runs, or the
     * step said it already. `onTaskSaid` marks it said, once it went in.
     */
    const onTaskNow = () => (onTaskStep === steps || !graphOn || !graphs || !memChain || host ? null : graphs.onTask(memChain));
    const onTaskSaid = () => void (onTaskStep = steps);
    /**
     * What follows the person's words into the running turn (checkpoint.js "note"): which task of its own the agent is on.
     * Held for the step as it is handed out — words sent before these went in carry none of it (the review of bcc37fbb7,
     * sa_ea3782cd: a queued send settles only at its echo) —; `said` records it once the words went in, `unsaid` lets the
     * step say it again where they did not. Null where none is. @param {Steer} steer
     */
    const noteBlocks = (steer) => {
      const c = compose("note", readerOf(steer.at, opensNow() ?? declaredOwn()), { onTask: onTaskNow() || "" });
      if (!c.blocks.length) return null;
      const held = c.marks.includes("on-task");
      const was = onTaskStep;
      if (held) onTaskSaid();
      const at = onTaskStep;
      return {
        blocks: c.blocks,
        said: () => {
          if (held) (rec.priorChanges ||= []).push("acp: the person's words came while a task of the agent's own ran — Filament said which, and how to take them up first");
        },
        unsaid: () => {
          if (held && onTaskStep === at) onTaskStep = was;
        },
      };
    };
    /** `onTaskNow`, marked said as it is handed out: for what hands it on with words that go at once (a report's line). */
    const onTaskOnce = () => {
      const line = onTaskNow();
      if (line) onTaskSaid();
      return line;
    };
    /**
     * The files the agent's own edits changed in the turn, by key (`fileKey`), until there are two: its second is where
     * `CODER_UNPLANNED_LINE` is judged, once a turn (checkpoint.js "action", the owner's of 11-09 and 11-10).
     */
    const changedFiles = new Set();
    /**
     * The paths each call of the agent's own names, on whichever of its events says them, by its call's id, until it ends
     * (c-news; an edit's are judged then): Claude's adapter announces a call bare, names its file on the update after, and
     * ends it naming none (the review of 11-11). @type {Map<string, string[]>}
     */
    const callPaths = new Map();
    /** What each call of the agent's own is, as it starts or as an update says it, by its call's id: Codex's end says only how it went (the review of 11-11). @type {Map<string, string>} */
    const callKinds = new Map();
    /** The tool and the input each call of the agent's own names, as the newest of its events to say each has them, by its call's id, until it ends: its end may say neither. @type {Map<string, { name: string, input: any }>} */
    const callSaid = new Map();
    /** The turn's drift watch (core/drift.js, d-fails), as the loop's: the command that failed in a row with nothing changed between. */
    const drift = newDriftState();
    /** The command each of the agent's own runs names, and the folder where it names one (Codex's `cwd`), by its call's id: counted once it ended, null from then. @type {Map<string, { command: string, where: string } | null>} */
    const runCalls = new Map();
    /** A command that failed a third time in a row with nothing changed between, said at the agent's next call (`stepWords`), as the unplanned line is. */
    let failingOwed = "";
    /**
     * The files it changed outside every open task's writes (graph-runner `outside`), said at its next call too: each
     * task named is told once its line went in (`outsideSaid`), so one the turn's end took unsaid is said at a later edit.
     * @type {{ path: string, tasks: { id: string, name: string, writes: string[] }[] }[]}
     */
    const strayOwed = [];
    /** The tasks a line owed, or one on its way, names: an edit before it went names none of them again. @type {Set<string>} */
    const strayPending = new Set();
    /** The turn kept a checklist — Filament's, or the agent's own todo list. */
    let planKept = false;
    /**
     * Whether the agent's own todo list, as the turn last drew it, has an item not done yet: null where it drew none. The
     * chat keeps it at the turn's end (`planEnded`), for a later turn's judging — the agent's own todo list lives in its
     * session, and the request need not carry the chat (FabeleHelper's of 11-10). Filament's checklist is not it: its
     * items are tasks on the graph, open as long as they are.
     * @type {boolean | null}
     */
    let planLive = null;
    /** Whether a todo list's entries have one not done, nor given up. @param {any} items */
    const liveOf = (items) => Array.isArray(items) && items.some((it) => !/^(completed|done|cancell?ed)$/i.test(String(it?.status ?? "")));
    /**
     * The agent's own todo list an earlier turn left open, as the chat keeps it (`checklistOpen`): whose list — the
     * agent and its session, where the list lives — and the turn that drew it. Null where the chat keeps none: a list
     * all done, or a mark from before the chat kept whose it was.
     * @returns {{ agent: string, session: string, turn: number } | null}
     */
    const listLeft = () => {
      const m = memChain ? memory?.archive?.metaOf?.(memChain, ["checklistOpen"])?.checklistOpen : null;
      return m && typeof m === "object" && typeof m.agent === "string" && typeof m.session === "string" ? { agent: m.agent, session: m.session, turn: Number(m.turn) || 0 } : null;
    };
    /** The agent's session this turn runs in, once it is known. */
    const sessionNow = () => run.facts?.sessionId ?? runSession.sessionId;
    /**
     * Whether the list an earlier turn left open (`listLeft`) is this turn's agent's to go by: drawn in the session the
     * turn runs in, which did not compact its own context since — in this turn (`compactions`), or between turns (a
     * compaction of the method own up to its turn or past it). A list lives in its agent's session: the agent the chat
     * moved to never had it, a fresh session starts without it, and after its own compaction nothing says the agent
     * still holds it (the re-read of 11-11: the mark was the chat's for good, so the plan line never came again).
     */
    const checklistOpen = () => {
      const m = listLeft();
      if (!m || compactions.size || m.agent !== upstream.id || m.session !== sessionNow()) return false;
      // A mark with no turn to count from tells of no compaction since: it stands.
      return !(m.turn > 0 && (memory?.archive?.getCompactions?.(String(memChain)) || []).some((/** @type {any} */ c) => c.method === "own" && Number(c.to_turn) >= m.turn));
    };
    /**
     * The turn's end: the chat keeps whether the agent's own todo list is still open, where the turn drew one — with
     * the session it lives in and the turn. A turn that drew none and compacted its own context lets go of the list
     * its session had left open (`checklistOpen`).
     */
    const planEnded = () => {
      if (host || !memChain) return;
      const session = sessionNow();
      if (planLive !== null) memory?.archive?.mergeMeta?.(memChain, { checklistOpen: planLive && session ? { agent: upstream.id, session, turn: Number(mem?.prep?.turnN) || 0 } : undefined });
      else if (compactions.size && listLeft()?.session === session) memory?.archive?.mergeMeta?.(memChain, { checklistOpen: undefined });
    };
    /**
     * Whether the turn keeps its steps nowhere, as the loop's `unplannedAt` judges it — on state, never on a message's
     * words. Only the chat's own agent is asked, and only where its session has Filament's tools, whose checklist and
     * task graph the line names (the hunt of c-unplanned, sa_0b8ff31c): a sub-agent keeps no checklist of its own. None
     * is asked where the turn kept a checklist, where the chat holds one still open — as an earlier turn of the agent's
     * left it (`checklistOpen`), or in the chat the request carries (a turn of Filament's loop's) — or where the graph has
     * open tasks.
     */
    const unplannedNow = () => {
      if (host || ownCycle || !graphOn || !graphs || !memChain || !declaredOwn() || planKept || checklistOpen()) return false;
      return !livePlan(planIn(Array.isArray(body.messages) ? body.messages : [])) && !graphs.hasOpen(memChain);
    };
    /** Whether the edit that changed `path` changed the turn's second file, its steps kept nowhere (`unplannedNow`). @param {string} path */
    const unplannedAt = (path) => !!path && changedSecond(changedFiles, fileKey(String(workCwd || cwdHint || ""), path)) && unplannedNow();
    /**
     * Memory at the moment of action (HarnessV3-Memory M5-3, M5-5; checkpoint.js "action"): the pitfalls the agent's own
     * call walks into and the open threads on the files it touches, each its line — as the loop's ride its call's result —,
     * through the turn's memory handle, in this chat's project, session and turn. None where memory stayed out of the
     * request (`prep.silent`). Read unmarked: memory records each firing (`fired`) only once its line reached the agent
     * (`remindHeard`) — a coding agent's words go at its next step, or never (the review of bcc37fbb7, FabeleHelper's
     * lt_f840c285).
     */
    const memoryHere = mem?.sit?.project?.id && !mem?.prep?.silent && /** @type {any} */ (memory).scope ? /** @type {any} */ (memory).scope({ role: "agent", project: mem.sit.project.id, chain: mem?.prep?.chain || null, turn: mem?.prep?.turn || mem?.prep?.launchTurn || null, conversation: mem?.prep?.conversation || null, client: mem?.sit?.client || "" }) : null;
    /** The reminders read at a call and not yet heard, by id: a call before they go says none of them again. */
    const remindPending = new Set();
    /** The events of the agent's own calls memory is asked at (`sawWork`): each call's first to say its input. @type {WeakSet<object>} */
    const remindAt = new WeakSet();
    /**
     * How far each call of the agent's own said its input, by its call's id, until it ends: whether it was whole then (the
     * call no longer being written), and the reminders handed out for it, none of which it is handed twice.
     * @type {Map<string, { whole: boolean, ids: Set<string> }>}
     */
    const inputSaid = new Map();
    /**
     * What memory says at the agent's own call, none still on its way: asked at the event that says the call's input
     * (`remindAt`), with the files the event names beside it, where its agent names them apart (Cursor's SDK). A call that
     * runs a command is asked as a shell's ("bash", services/memory/triggers.js), whatever its agent names the tool: a
     * pitfall is kept under the shell, and an agent that names none (Cursor's CLI, any plain ACP agent) titles the call
     * with its command (the review of 11-11).
     * @param {any} ev @returns {{ id: string, line: string, fire?: any }[]}
     */
    const remindedBy = (ev) => {
      if (!memoryHere || ev?.type !== "tool" || !remindAt.has(ev)) return [];
      try {
        if (!memoryHere.isOpen()) return [];
        const id = String(ev.id || "");
        const raw = ev.rawInput && typeof ev.rawInput === "object" ? ev.rawInput : {};
        const located = (Array.isArray(ev.locations) ? ev.locations.map((/** @type {any} */ l) => l?.path) : []).filter((/** @type {any} */ p) => typeof p === "string" && p);
        const command = raw.command ?? raw.cmd;
        const runs = String(ev.kind || callKinds.get(id) || "").toLowerCase() === "execute" && (Array.isArray(command) ? command.length > 0 : typeof command === "string" && !!command.trim());
        const input = located.length ? { ...raw, paths: [...(Array.isArray(raw.paths) ? raw.paths : []), ...located] } : raw;
        const handed = inputSaid.get(id)?.ids;
        const list = memoryHere.reminders(runs ? "bash" : String(ev.toolName || ev.title || ""), input, { mark: false }).filter((/** @type {any} */ p) => !remindPending.has(p.id) && !handed?.has(p.id));
        for (const p of list) {
          remindPending.add(p.id);
          handed?.add(p.id);
        }
        return list;
      } catch {
        return [];
      }
    };
    /** Reminders that reached the agent: memory records each fired. @param {readonly { id: string, fire?: any }[]} list */
    const remindHeard = (list) => {
      for (const p of list) remindPending.delete(p.id);
      try {
        if (list.length) memoryHere?.fired(list);
      } catch {
        // What memory could not record changes nothing the agent heard.
      }
    };
    /** Reminders that never went: unrecorded, each said again at a call that walks into it. @param {readonly { id: string }[]} list */
    const remindLost = (list) => {
      for (const p of list) remindPending.delete(p.id);
    };
    /** Whether a long wait's list is on its way into the turn (`waitedNow`): no other step says it meanwhile. */
    let waitedGoing = false;
    /** The tails this turn owes Filament's next tool answer that no answer took yet (`stepWords`, tool-tail.js). */
    let tailsOwed = 0;
    /**
     * What is still open, for the chat's own agent, where a change waited long in the turn with nothing said of it
     * (still-open.js `waited`), under the session's redaction as the turn's start says it: none while one is on its way,
     * nor while what comes back after its compaction waits to go, which says the list itself.
     */
    const waitedNow = () => {
      if (!openFor || !memChain || waitedGoing || backPending) return null;
      const w = openFor.waited(memChain, { dismiss: dismissOk });
      return w ? { ...w, text: openSaid(w.text) } : null;
    };
    /**
     * A long wait's list reached the agent: the chat keeps it heard (`waitedHeard`), and the record says how.
     * @param {{ keys: string[], waits: string[] }} w @param {string} how
     */
    const waitedHeard = (w, how) => {
      if (openFor && memChain) openFor.waitedHeard(memChain, w);
      (rec.priorChanges ||= []).push(`acp: what is still open, said to ${agentName} ${how} — a sub-agent's change waited long in its turn with nothing said of it`);
    };
    /**
     * What Filament says at the agent's own call, in one message (checkpoint.js "after-compact" then "action"; FabeleHelper's
     * of 11-10: two steers at one step were one too many): what comes back after its compaction, with what waits at the
     * door right behind it; else what is still open where a change waited long in the turn (`waitedNow`); then memory at
     * the moment of action for this call, and the unplanned line where it still holds
     * — judged again now, a plan made since lets it go (the hunt of c-unplanned, sa_0b8ff31c). How it goes follows from
     * the reader (`via`): into the running turn where the agent takes words while it works, queued or live; at the end of
     * Filament's next tool answer to it where it takes them only once a step ended (`tool-answer`, tool-tail.js) — the
     * chat's own agent's; what no answer carried by the turn's end goes with it, but what comes back after a compaction,
     * which waits for the next turn's start. Each is said on the record once it went in, and memory records its reminders
     * then; where none can go now, memory is not asked, and an unplanned line that did not go waits for the next call,
     * judged again there. @param {any} ev  the call
     */
    const stepWords = async (ev) => {
      const steer = steerNow;
      const reader = readerOf(steer?.at ?? null, opensNow() ?? declaredOwn());
      const tails = viaOf("action", reader) === "tool-answer" && !host && memChain && !runStatus ? deps.toolTails || null : null;
      const steers = !!steer && (steer.at === "queued" || steer.at === "live") && !handedBack && !runStatus;
      const reminded = tails || steers ? remindedBy(ev) : [];
      const unplanned = unplannedOwed && unplannedNow();
      unplannedOwed = false;
      const failing = failingOwed;
      failingOwed = "";
      const strays = strayOwed.splice(0);
      const drifted = [failing ? failingLine(failing, "coding") : "", ...strays.map((o) => outsideLine(o, "coding"))].filter(Boolean).join("\n\n");
      const memoryText = reminded.map((p) => p.line).join("\n\n");
      const toolName = String(ev?.toolName || ev?.title || "a call");
      /** @param {string} how @param {boolean} asked  whether the unplanned line went */
      const said = (how, asked) => {
        if (asked) (rec.priorChanges ||= []).push(`acp: ${agentName} changed a second file with neither a checklist nor a task graph — Filament asked it to plan its steps, ${how}`);
        if (reminded.length) (rec.priorChanges ||= []).push(`acp: memory reminded ${agentName}'s ${toolName} call of ${reminded.map((p) => p.id).join(", ")}, ${how}`);
        if (failing) (rec.priorChanges ||= []).push(`acp: ${agentName}'s \`${failing}\` failed a third time in a row, and nothing Filament saw changed between them — Filament said so, ${how}`);
        for (const o of strays) (rec.priorChanges ||= []).push(`acp: ${agentName} changed ${o.path} outside every open task's writes while on ${o.tasks.map((t) => t.id).join(", ")} — Filament said so, ${how}`);
        const told = strays.flatMap((o) => o.tasks.map((t) => t.id));
        if (told.length && graphs && memChain) graphs.outsideSaid(memChain, told);
        for (const t of told) strayPending.delete(t);
      };
      // Where they ride the end of Filament's next tool answer, each is judged as that answer goes (the review of
      // bcc37fbb7, sa_ea3782cd): the unplanned line again — the call that takes them may be the one that planned —, what
      // comes back after a compaction as it stands then, with what waits at the door right behind it, as a steer carries
      // them. A compaction's block not taken by then waits for what goes next: a wake's prompt, or the next turn's start.
      if (tails && memChain) {
        // A call that brings nothing of its own owes no tail while one of the turn's waits already: that one says what
        // comes back, or a long wait's list, as it goes — a tail for each call the agent made of its own tools meanwhile
        // would be made again, to no words, with every such call.
        const brings = reminded.length > 0 || unplanned || !!drifted;
        if (!brings && (tailsOwed > 0 || (!backPending && !waitedNow()))) return;
        /** @type {ReturnType<typeof backNow>} */
        let back = null;
        /** @type {string[]} */
        let taken = [];
        let asked = false;
        /** @type {ReturnType<typeof waitedNow>} */
        let waits = null;
        tailsOwed++;
        tails.owe(memChain, {
          text: () => {
            back = backNow(steer, { tail: true });
            taken = back && doorTurn ? doorTurn.take({ seal: true }) : [];
            asked = unplanned && unplannedNow();
            waits = back ? null : waitedNow();
            const action = compose("action", reader, { open: waits?.text || "", unplanned: asked ? CODER_UNPLANNED_LINE : "", memory: memoryText, drift: drifted });
            return [back?.text, ...taken, textOf(action.blocks)].filter(Boolean).join("\n\n");
          },
          said: () => {
            tailsOwed--;
            back?.heard("tail", taken);
            remindHeard(reminded);
            said("with Filament's next tool answer to it", asked);
            if (waits) waitedHeard(waits, "with Filament's next tool answer to it");
          },
          dropped: () => {
            tailsOwed--;
            back?.keep();
            if (taken.length) doorTurn?.unheard();
            remindLost(reminded);
            if (failing) failingOwed ||= failing;
            strayOwed.unshift(...strays);
          },
        });
        return;
      }
      const back = backNow(steer);
      const waits = steers && !back ? waitedNow() : null;
      const action = compose("action", reader, { open: waits?.text || "", unplanned: unplanned ? CODER_UNPLANNED_LINE : "", memory: memoryText, drift: drifted });
      if (!back && !action.blocks.length) return;
      /**
       * Nothing went: what comes back waits on, each reminder is said again at a call that walks into it, the unplanned
       * and failing lines wait for the next call, and a long wait is weighed again there.
       */
      const lost = () => {
        back?.keep();
        remindLost(reminded);
        if (unplanned) unplannedOwed = true;
        if (failing) failingOwed ||= failing;
        strayOwed.unshift(...strays);
        if (waits) waitedGoing = false;
      };
      if (!steers || !steer) return void lost();
      if (waits) waitedGoing = true;
      const taken = back && doorTurn ? doorTurn.take({ seal: true }) : [];
      const text = [back?.text, ...taken, textOf(action.blocks)].filter(Boolean).join("\n\n");
      const unplaced = steer.at === "queued" ? place(text, (after) => run.agent?.steered(text, [], !!after)) : () => true;
      const took = await steer.send(text, text, [], "filament").catch(() => /** @type {const} */ (false));
      if (!took) {
        unplaced();
        if (taken.length) doorTurn?.unheard();
        lost();
        return;
      }
      if (unplaced()) run.agent?.steered(text, [], took === "after");
      back?.heard(took, taken);
      remindHeard(reminded);
      said(took === "after" ? "after its turn's answer, as words of their own" : "at its next step", unplanned);
      if (waits) {
        waitedGoing = false;
        waitedHeard(waits, took === "after" ? "after its turn's answer, as words of their own" : "at its next step");
      }
    };
    /**
     * One of the agent's own calls under the name the loop's rule of what may change a failed command's outcome knows it
     * by (tools.js `changesWhatFailed`): one of Filament's own tools over its MCP server by that tool's name in the loop —
     * its background command, given a command to start, is the loop's bash_background, and one only asked of a command
     * started before starts none —, any other call by the name its agent says. @param {string} name @param {any} input
     */
    const asLoopNames = (name, input) => {
      const own = /^mcp__filament__(.+)$/.exec(name)?.[1];
      if (own == null) return name;
      return own === BACKGROUND_COMMAND && typeof input?.command === "string" && input.command.trim() ? "bash_background" : own;
    };
    /**
     * What the agent's own tool events say of its plan and its work: a checklist kept, a call's input and paths, an edit
     * that completed, a command that failed again. A sub-agent's are its own — but for the agent's failed runs (d-fails).
     * @param {any} ev
     */
    const sawWork = (ev) => {
      if (ev?.subagent || ev?.parentToolCallId) {
        // A sub-agent's edit, or a command it ran to its end, in the folder the agent's commands run in (Claude's Task
        // works in it) may change what failed there: the count of the agent's failed runs starts again, as at its own.
        const k = String(ev?.kind || "").toLowerCase();
        if (ev?.type === "tool" && !ev.notRun && ((ev.status === "completed" && (k === "edit" || k === "delete" || k === "move")) || (k === "execute" && (ev.status === "completed" || ev.status === "failed")))) driftChanged(drift);
        return;
      }
      // The agent's own todo list, its entries; Filament's checklist draws its items on the turn too, and lives on the
      // graph, whose open tasks say whether it is open (FabeleHelper's of 11-10; the review of e0a070c96, sa_3c539618).
      if (ev?.type === "plan" && Array.isArray(ev.entries)) {
        planKept = true;
        planLive = liveOf(ev.entries);
      }
      if (ev?.type !== "tool") return;
      if (ev.phase === "call" && String(ev.toolName || "").replace(/^mcp__filament__/, "") === CODER_CHECKLIST_TOOL.name) planKept = true;
      const id = String(ev.id || "");
      // What the call is, as it or an update of it said: Codex's end says none (`callKinds`).
      if (id && ev.kind) callKinds.set(id, String(ev.kind).toLowerCase());
      const kind = String(ev.kind || (id && callKinds.get(id)) || "").toLowerCase();
      const paths = [...(Array.isArray(ev.locations) ? ev.locations.map((/** @type {any} */ l) => l?.path) : []), ev.rawInput?.file_path, ev.rawInput?.path, ev.rawInput?.notebook_path].filter((p) => typeof p === "string" && p);
      const ended = ev.status === "completed" || ev.status === "failed";
      // Its tool and its input, as the newest of its events to say each has them: Claude's adapter announces a call bare
      // and says its input on the update after, and neither it nor Codex says them again as the call ends.
      const given = ev.rawInput && typeof ev.rawInput === "object" && Object.keys(ev.rawInput).length ? ev.rawInput : null;
      const said = { name: String(ev.toolName || callSaid.get(id)?.name || ""), input: given || callSaid.get(id)?.input || null };
      if (ended) callSaid.delete(id);
      else if (id) callSaid.set(id, said);
      // Memory is asked of the call at the first of its events that says its input (`remindedBy`): as it is announced,
      // or on the update that says it, where what Filament says at a call goes again with it (`stepWords`). A call still
      // being written then is asked once more as it starts to run — Cursor writes a call's input out as its model does,
      // and a command half written names another. Never at an update that ends it: words queued at a turn with no step
      // left would run as a prompt of their own.
      const asked = inputSaid.get(id);
      if ((given || paths.length) && (!asked || (!asked.whole && ev.status !== "pending")) && (ev.phase === "call" || !ended)) {
        if (id) inputSaid.set(id, { whole: ev.status !== "pending", ids: asked?.ids || new Set() });
        remindAt.add(ev);
        if (ev.phase !== "call") void stepWords(ev);
      }
      // A skill Filament's tool loads, named by the call or an update of it: in the agent's context once it completed.
      const skill = skillLoadOf(ev.toolName, ev.rawInput);
      if (skill) skillCalls.set(id, skill);
      const loading = skillCalls.get(id);
      if (loading && ended) {
        skillCalls.delete(id);
        if (ev.status === "completed") skillLoaded(loading);
      }
      // A file it read or wrote with its own tools, or read with a command that names what it reads (Codex's `reads`):
      // Filament sees it as it is once the call completed (c-news), under one spelling of its path, so its own edit of a
      // file it read is the same file's (`resolve`: `H:/x` beside `H:\x`).
      const reads = Array.isArray(ev.reads) ? ev.reads.filter((/** @type {any} */ p) => typeof p === "string" && p) : [];
      const sighted = kind === "execute" ? reads : [...paths, ...reads];
      if (sighted.length) callPaths.set(id, [...new Set([...(callPaths.get(id) || []), ...sighted])]);
      const touched = ended ? callPaths.get(id) || [] : [];
      if (ended) {
        callPaths.delete(id);
        callKinds.delete(id);
        inputSaid.delete(id);
        const seen = memChain && !ownCycle && !host ? agentSightings(memChain) : null;
        if (seen && ev.status === "completed" && (kind === "read" || kind === "edit" || kind === "delete" || kind === "move" || kind === "execute"))
          for (const p of touched) void sightFile(seen, resolve(workCwd, p));
      }
      // A command it ran to its end, counted as the loop counts its own (d-fails), where it ran: one that failed again
      // with nothing changed between is said at its next call. The command is the newest its events named before its end,
      // as a call still being written names a part of it. Anything else of its own that changes or runs — an edit, a run
      // whose command it did not name, a call the loop's rule says may change what failed (`changesWhatFailed`: one of
      // Filament's tools that applies a sub-agent's change, merges a task's or starts a command; another server's tool
      // not said to only read) — starts the count again; one kept from running ran nothing, and an end said twice counts
      // once.
      const command = typeof ev.rawInput?.command === "string" ? ev.rawInput.command : "";
      if (kind === "execute" && command && runCalls.get(id) !== null) runCalls.set(id, { command, where: typeof ev.rawInput.cwd === "string" ? ev.rawInput.cwd : runCalls.get(id)?.where || "" });
      if (ended && !ev.notRun) {
        const ran = runCalls.get(id);
        if (ran) {
          runCalls.set(id, null);
          // Its exit as the event says it, or as its terminal's output does (Cursor's SDK: a command that ran is a success).
          const exit = ev.exitCode ?? ev.terminalOutput?.exitCode;
          if (failedAgain(drift, ran.command, ev.status === "failed" || (exit != null && Number(exit) !== 0), ran.where)) failingOwed = ran.command;
        } else if (ran === undefined && (kind === "execute" || (ev.status === "completed" && (kind === "edit" || kind === "delete" || kind === "move")) || changesWhatFailed(asLoopNames(said.name, said.input), kind === "read" || kind === "search" || kind === "fetch" ? "read" : "mutate", said.input)))
          driftChanged(drift);
      }
      // An edit of its own that completed: the files its events named, on whichever of them.
      if (ev.status !== "completed" || !(kind === "edit" || kind === "delete" || kind === "move")) return;
      const named = touched;
      if (named.some((p) => unplannedAt(p))) unplannedOwed = true;
      // A file it changed outside every open task's writes, while tasks of its own that named writes run (d-writes): said
      // at its next call, as the loop says it on the edit's result — each such task told once, once its line went in.
      if (!host && !ownCycle && graphOn && graphs && memChain)
        for (const p of named) {
          const o = graphs.outside(memChain, p, String(workCwd || cwdHint || ""), { mark: false });
          const tasks = o ? o.tasks.filter((t) => !strayPending.has(t.id)) : [];
          for (const t of tasks) strayPending.add(t.id);
          if (o && tasks.length) strayOwed.push({ path: o.path, tasks });
        }
    };
    /**
     * The unplanned line waits for the agent's next call (`callCame`, `stepWords`), as what comes back after its
     * compaction does: words queued at a turn with no step left would run as a prompt of their own.
     */
    let unplannedOwed = false;
    /** Who waits for a note to be handed to the agent, by its id: a wait of the agent's it ended. @type {Map<string, () => void>} */
    const handing = new Map();
    /** The notes handed to the agent, by id. @type {Set<string>} */
    const handed = new Set();
    /**
     * A note that ended a wait of the agent's goes to it now (HarnessV3-TaskGraph-v2 TG2-D43): the wait's answer says
     * Filament hands it over next, so it waits for the note to go — `HAND_OVER_MS` at most.
     * @param {import("../services/runs.js").SteerMessage} m @returns {Promise<void>}
     */
    const handOver = (m) => {
      if (!steerNow || handedBack || atAgent.has(m.id) || due.has(m.id)) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          if (handing.get(m.id) === done) handing.delete(m.id);
          resolve(undefined);
        };
        const timer = setTimeout(done, HAND_OVER_MS);
        timer.unref?.();
        handing.set(m.id, done);
        due.add(m.id);
        letHeldGo();
      });
    };
    /**
     * How a note weighs, by the agent's own commands (`ownNow`): "command" — held, it waits queued for the turn's end
     * and goes as the next message, as typed — or "words"; or, shaped like a command and sent before the agent said its
     * commands, the promise of its word, to weigh it again then (HarnessV3-FailurePoints, the early-command race). Each
     * is said once — in the record, and on the run (`steer-weighed`, HarnessV4_Tasks U1), where the page's bubble reads
     * why its words have not gone in; a note that waited for the agent's commands and is none of them says that too.
     * @param {import("../services/runs.js").SteerMessage} note @returns {"command" | "words" | Promise<void>}
     */
    const weigh = (note) => {
      if (heldNotes.get(note.id) === note.text) return "command";
      /** @param {"command" | "unsure" | "words"} as @param {string | null} [word] */
      const say = (as, word = null) => events.publish(topic, { type: "steer-weighed", ids: [note.id], as, ...(word ? { word } : {}) });
      // The developer changed a held command's words (HarnessV4_Tasks C34): they are weighed again.
      const was = heldNotes.delete(note.id);
      const command = ownNow?.holds(note.text) || null;
      if (command) {
        heldNotes.set(note.id, note.text);
        say("command", command);
        if (!was) (rec.priorChanges ||= []).push(`acp: ${command} is ${agentName}'s own command: sent while it worked, it waits for the turn's end and goes as the next message, as typed`);
        return "command";
      }
      const unsure = ownNow?.unsure(note.text) || null;
      if (!unsure) {
        if (unsureNotes.delete(note.id) || was) say("words");
        return "words";
      }
      if (!unsureNotes.has(note.id)) {
        unsureNotes.add(note.id);
        const word = String(note.text).trim().split(/\s/)[0];
        (rec.priorChanges ||= []).push(`acp: ${word} may be ${agentName}'s own command, and ${agentName} has not said its commands yet: the message waits until it says them, or answers without them`);
        say("unsure", word);
      }
      return unsure;
    };
    /**
     * How a message queued on the run reaches the agent, for the words its wait ends with (HarnessV3-TaskGraph-v2
     * TG2-D43): at its next step, where it is queued at the agent or on its way there — or only as its next message,
     * where the agent takes no words mid-turn or handed them back (`wakeWith` hands them over). The agent's own command,
     * held for the turn's end, ends no wait, and nor does a message with pictures that only the next message can carry.
     * @param {import("../services/runs.js").SteerMessage} m @returns {import("./agent-inbox.js").Reach}
     */
    const reach = (m) => (m.kind !== "note" || weigh(m) !== "words" ? null : atAgent.has(m.id) || (steerNow && !handedBack) ? "step" : m.images?.length ? null : "reply");
    /** Whether the developer's stop ended the agent's wait for its sub-agents — a lead's for its workers — between its prompts (AC6-6). */
    let waitStopped = false;
    /**
     * @param {{ sessionId?: string | null, cwd?: string | null, rawMessages?: boolean, steer?: Steer | null, ownCommands?: AgentCommands | null }} session
     *   `steer`: how the bridge hands the person's words to the agent's turn, true once the agent took them — into its
     *   running turn (`live`, HarnessV3-ACP AC3-1), or at its next step (`next`, AC-D6) — where the agent can take them;
     *   `ownCommands`: which words are the agent's own commands, where it has any
     * @param {(() => void) | null} [cancel]  how the stop reaches a turn that started in an earlier reply
     * @returns {Promise<void>}  once the turn may begin: the bridge sends the prompt after it
     */
    const openRun = async ({ sessionId = null, cwd = null, rawMessages = false, steer = null, ownCommands = null }, cancel = null) => {
      stepsDone();
      if (!runs || run.agent) return;
      runSession = { sessionId, cwd };
      runs.startRun({
        id: rec.id,
        kind: host ? "subagent" : "coding-agent",
        title: host ? `${host.team ? host.team.role : "sub-agent"} ${host.id}` : body.model,
        // A sub-agent's run hangs off the turn that launched it, as the loop host's does (AC6-1).
        parentId: host && rec.subagentOf && rec.subagentOf !== "owner" ? rec.subagentOf : null,
        // `chain`: the session the run belongs to, which the harness's sidebar reads off the runs list. `steer`: what
        // the run does with a note, which the composer says — "queued", queued at the agent, which takes it at its next
        // step or after its turn's answer; "live", the agent takes it into its running turn; "next", at its next step,
        // where the turn goes on with it — a team's lead's next prompt, which Filament wakes it with (AC6-4), where its
        // agent takes none while one runs; "queue", it waits for the turn's end. `interrupts`: a note can interrupt the
        // agent instead (FP-D8). `holds`: a note waits in Filament for the agent's next tool call, and the developer may
        // change it or take it back until then (HarnessV4_Tasks C34). `steerImages`: a note's pictures go in with its
        // words (C22), so the composer sends a message with pictures into the turn instead of queueing it for the
        // turn's end. `own`: the agent began the turn by itself (AC3-9), and the composer says whose turn a
        // note waits behind. `agent`: its name, for the words of a note sent to it ("Queued at Claude Code…").
        meta: { engine: upstream.type, upstream: upstream.id, agent: agentName, model: modelId, root: cwd, session: sessionId, chain: (host ? chainRef : memChain) || null, steer: steer?.at || (leadTeam ? "next" : "queue"), ...(steer?.interrupt ? { interrupts: true } : {}), ...(holds(steer) ? { holds: true } : {}), ...(steer?.images ? { steerImages: true } : {}), ...(ownCycle ? { own: { agent: agentName } } : {}), ...(host ? { subagent: host.id, card: host.card.tag } : {}) },
        ...(host?.brief ? { brief: host.brief } : {}),
      });
      liveWords?.start(rec.id);
      wire.markRun();
      saidFrom = collector.said.length;
      const mb = runs.mailbox(rec.id);
      run.mailbox = mb;
      mb.stopSignal.addEventListener("abort", () => stopCtl.abort(), { once: true });
      if (cancel) stopCtl.signal.addEventListener("abort", cancel, { once: true });
      mb.forceSignal.addEventListener(
        "abort",
        () => {
          onForced("forced");
          forceCtl.abort();
        },
        { once: true },
      );
      // The harness's own turn carries the run's events in its reply (HarnessV3-Responsiveness R3), and its head opens
      // now: the page steers by the request's id from the run's start. A chat's turn sent another way opens its head
      // now too, so whoever sent it has the id that answers its questions, steers it or stops it
      // (HarnessV4_Overnight_Plan OV-D33).
      if (harness && stream) {
        const page = runs.events(rec.id, { since: 0, limit: 5000 });
        if (page) carried = followRunEvents(runs, rec.id, page, { pageSize: 5000, send: (evt) => wire.runEvent(eventJson(evt)) });
        res.once("close", () => carried?.stop());
        wire.ensureStart();
      } else if (chatTurn && stream) wire.ensureStart();
      if (chatTurn) named?.(rec.id);
      // Working-tree snapshots, as the loop takes them (WP-J.2): onto the session's chain, by the archive turn this
      // request opened — in a harness chat alone, where Filament composes the session (the setting's reach) and its cards
      // and Review read them, on each of its turns, its page's or not, a sub-agent's run aside (HarnessV4_Overnight_Plan
      // OV-D35); none without a turn, or with the session's `loop.treeSnapshots` off.
      const chainId = mem?.prep?.chain || null;
      const turnId = mem?.prep?.turn || null;
      const turnNo = mem?.prep?.turnN || turnId;
      const al = loopConfig(config().agentLoop || {}, mem?.sit?.settings?.loop || null);
      const tree = chatTurn && al.treeSnapshots !== false && chainId && turnId && cwd ? createTurnTree({ memory, chainId, turnId, turnNo, root: cwd }) : null;
      /** The session's gate, made once a call asks whether it only reads. @type {import("../adapters/agents/turn-bridge.js").Permits | null} */
      let reader = null;
      /**
       * Whether the session's gate reads a call as only reading: the call read as an ACP agent's request for it is
       * (`loopCalls`), a command only where its input gives it whole — never by its title.
       * @param {{ kind: string, title: string, rawInput: any, locations: any[], name: string }} tc
       */
      const onlyReads = (tc) => {
        const calls = loopCalls(tc, upstream.id);
        if (!Array.isArray(calls)) return false;
        const raw = tc.rawInput && typeof tc.rawInput === "object" ? tc.rawInput : {};
        if (calls.some((c) => c.name === "bash" || c.name === "powershell") && typeof raw.command !== "string" && typeof raw.CommandLine !== "string") return false;
        reader ||= sessionPermits();
        return !!reader.onlyReads?.(calls, String(cwd || ""));
      };
      run.agent = createAgentRun({
        // A sub-agent's events reach its launcher too: its card, its lead's watch (AC6-1).
        publish: (evt) => {
          events.publish(topic, evt);
          if (host) registry?.relay(host.id, evt);
        },
        sink: { breakBlock: collector.breakBlock, thought: collector.thought },
        rawMessages,
        root: cwd,
        previewChars: config().observability?.runEvents?.toolPreviewChars ?? 2000,
        // The pictures the agent's calls hand its model, kept beside the run files for their cards (HarnessV4_Tasks U9).
        keepImages: runs?.keepImages ? (pictures) => runs.keepImages(pictures) : null,
        tree,
        // Where the agent works now rides a chat's own turn (HarnessV4_Git_Plan GW-D66).
        saysPlace: chatTurn && !host,
        note: (text) => (rec.priorChanges ||= []).push(text),
        agent: agentName,
        // A call's `command`, for the commit watch (app/watchers/commits.js): a call the session's gate reads as only
        // reading says none, where the session has that gate. The run asks it of a call its agent's own message names
        // (Claude's) and of no other: every other agent's command says one.
        reads: chatTurn || host || leadTeam ? onlyReads : null,
      });
      ownNow = ownCommands;
      steerTo(steer);
      if (steer) void deliver(mb);
      // What its launcher said before the run existed reaches it now, as the person's notes do.
      if (host) registry?.attach(host.id, rec.id);
      // The folder as the turn begins, before the agent hears the prompt, which waits for it: what was there before,
      // work not yet committed or edits by hand since the last turn, is never the turn's change (HarnessV3-ACP, AC3's
      // drive D1). A turn that has been working already, one the agent began by itself or one an earlier reply
      // started, starts where the chain left off.
      if (tree && !ownCycle && !cancel) await tree.begin({ signal: AbortSignal.any([clientAbort.signal, stopCtl.signal]) });
    };
    /**
     * A note the agent took, read on the run and kept in the archive where it took it — or one it handed back, left
     * queued with any after it: the run's end says them unread, and the harness sends them as the next message, and the
     * deliveries end until the turn's next prompt. → whether it was taken.
     * @param {import("../services/runs.js").Mailbox} mb @param {import("../services/runs.js").SteerMessage} note
     * @param {boolean | "after"} took @param {"queued" | "live" | "next" | "interrupt"} how
     * @param {SteerImage[]} pictures  the pictures that went with its words, which the archive keeps with them
     */
    const settled = (mb, note, took, how, pictures) => {
      // The person's alone, as the loop counts them: never a lead's, the main agent's, Filament's or a watcher's.
      if (took && pictures.length && !["lead", "agent", FILAMENT, WATCHER].includes(String(note.from))) heardPictures.push(...pictures);
      if (!took || !mb.took(note, { after: took === "after" })) {
        handedBack = true;
        if (!took)
          (rec.priorChanges ||= []).push(
            how === "next"
              ? `acp: ${agentName}'s turn ended before its next step; a message sent while it ran goes as the next message`
              : how === "queued"
                ? `acp: ${agentName} never took a message queued while it worked — its turn ended or stopped first, or it refused the message; it goes as the next message`
                : `acp: ${agentName} handed back a message sent while it ran; it goes as the next message`,
          );
        return false;
      }
      // A watcher's guidance is kept as its agent read it, under the watcher's heading: never as bare words of the person's.
      run.agent?.steered(note.from === WATCHER ? guideBlock(note.title, [note.text]) : note.text, pictures, took === "after");
      (rec.priorChanges ||= []).push(
        how === "next"
          ? `acp: a message sent while ${agentName} worked went in at its next step: its turn was cancelled after a call and went on with it`
          : how === "queued"
            ? took === "after"
              ? `acp: a message sent while ${agentName} worked was queued and ran as its next prompt: its turn had ended first`
              : `acp: a message sent while ${agentName} worked was queued and went in at its next step`
            : how === "interrupt"
              ? `acp: a message sent while ${agentName} worked interrupted it and went into its running turn`
              : `acp: a message sent while ${agentName} worked went into its running turn`,
      );
      return true;
    };
    /**
     * The person's notes into the agent's turn, in the order sent (HarnessV3-ACP AC3-1): each read on the run once the
     * agent took it — queued at the agent, which takes it at its next step or after its turn's answer (HarnessV3-
     * FailurePoints §7.2), into its running turn, or at its next step (AC-D6) — and kept in the archive where it did
     * (`settled`). Notes queued at the agent go out one after another, as Claude Code queues what is typed; any other
     * waits for the last to be taken. One it doesn't take — the turn has just ended or ended before its next step, or it
     * takes none now (Codex's review) — stays queued with any after it; a prompt of the same turn's after it (AC6-1,
     * AC6-4) takes them in its own way in, or as its words. A note that asks to interrupt the agent does, where it can
     * (FP-D8). The agent's own command is never sent into the turn (`weigh`): it waits queued for the turn's end, said
     * once, and the words sent after it go on in. Words that may be one, sent before the agent said its commands, hold
     * the deliveries until it has, or the prompt ends. What the developer typed waits in Filament for the agent's next
     * tool call (HarnessV4_Tasks C34) — until then they may change it or take it back — and one the prompt ends before
     * goes as the next message; handed over, it is said on the run (`steer-sent`). A stop ends the deliveries; it is
     * the turn's.
     * @param {import("../services/runs.js").Mailbox} mb
     */
    const deliver = async (mb) => {
      if (delivering) return;
      delivering = true;
      try {
        /**
         * A note not yet weighed: words to hand over, or a command the turn holds.
         * @param {import("../services/runs.js").SteerMessage} m
         */
        const fresh = (m) => m.kind === "note" && heldNotes.get(m.id) !== m.text && !atAgent.has(m.id);
        /** The turn's stop. @type {Promise<void>} */
        const stopped = new Promise((r) => (stopCtl.signal.aborted ? r(undefined) : stopCtl.signal.addEventListener("abort", () => r(undefined), { once: true })));
        for (;;) {
          await mb.next(fresh);
          if (runStatus || stopCtl.signal.aborted || handedBack) return;
          const note = mb.peek(fresh);
          const steer = steerNow;
          if (!note || !steer) return;
          const weighed = weigh(note);
          if (weighed === "command") continue;
          if (weighed !== "words") {
            await Promise.race([weighed, steerMoved]);
            continue;
          }
          const interrupting = !!note.interrupt && !!steer.interrupt;
          // What the developer typed waits for the agent's next call (HarnessV4_Tasks C34), and the note is looked at
          // again then: its words as they are, or the next note where they took it back. One that interrupts goes now,
          // and so does one for an agent whose turn Filament cancels at its next step (`next`): those words wait in
          // Filament for that step already, and a wait for a call first would let it run one more. One typed while a
          // sub-agent's turn waits for its agent's own background tasks goes now too: no call comes before their end.
          if (!interrupting && !tasksWait && holds(steer) && typedByDeveloper(note) && !due.has(note.id)) {
            await Promise.race([holdEnds, steerMoved, stopped]);
            continue;
          }
          // Pictures where the way in takes none now (it moved to another prompt's): the note is handed back, to go as
          // the next message whole, never its words without them.
          if (note.images?.length && !steer.images) {
            settled(mb, note, false, steer.at, []);
            return;
          }
          if (!mb.handing(note)) continue;
          handed.add(note.id);
          // A wait the note ended answers once it is on its way (`handOver`).
          setImmediate(() => handing.get(note.id)?.());
          const send = interrupting && steer.interrupt ? steer.interrupt : steer.send;
          // A sub-agent's agent hears whose message it is, as the loop's worker does — Filament relays it; the session
          // keeps the words. A main chat's are the person's, but Filament's own (a Space sync, a team's result beside it)
          // and a watcher's guidance, which its agent reads under the watcher's heading with how to weigh it.
          const guided = note.from === WATCHER;
          const by = host || note.from === FILAMENT || guided ? "filament" : "person";
          // The person's words, followed by whose answers they overrule and which task of its own they came during, and how
          // to take them up first, as the loop's are (checkpoint.js "note") — each marked said once the words went in.
          const told = by === "person" && !host ? noteBlocks(steer) : null;
          const words = host ? workerNote(note) : guided ? guideBlock(note.title, [note.text]) : [note.text, told ? textOf(told.blocks) : ""].filter(Boolean).join("\n\n");
          /** @param {unknown} took */
          const toldNow = (took) => void (took ? told?.said() : told?.unsaid());
          // The pictures go with them where the agent takes pictures (HarnessV4_Tasks C22).
          const pictures = steer.images ? note.images || [] : [];
          if (steer.at === "queued" && !interrupting) {
            // Read where the agent took it, at its echo; one it never took is handed back once its prompt is answered.
            const unplaced = place(words, (after) => settled(mb, note, after ? "after" : true, "queued", pictures));
            atAgent.set(
              note.id,
              send(words, note.text, pictures, by)
                .catch(() => /** @type {const} */ (false))
                .then((took) => {
                  toldNow(took);
                  if (unplaced()) settled(mb, note, took, "queued", pictures);
                }),
            );
            continue;
          }
          const took = await send(words, note.text, pictures, by).catch(() => /** @type {const} */ (false));
          toldNow(took);
          if (!settled(mb, note, took, interrupting ? "interrupt" : steer.at, pictures)) return;
        }
      } finally {
        delivering = false;
      }
    };
    /**
     * How a harness chat's turn asks the person (HarnessV3-ACP AC2-4; HarnessV4_Overnight_Plan OV-D33): its run holds
     * the question until an answer that fits it comes — from the page open on the chat, which follows the run whoever
     * sent the turn, or through the API (`POST /api/runs/:id/answer`) — or the run's stop, the reply's hang-up or the
     * agent's own signal ends the wait (null).
     * @type {import("../adapters/agents/turn-bridge.js").Asker}
     */
    const askPage = (form, id, signal) =>
      runs && run.agent
        ? runs.awaitAnswer(rec.id, id, {
            check: (a) => checkAnswer(form, a),
            signal: AbortSignal.any([stopCtl.signal, clientAbort.signal, ...(signal ? [signal] : [])]),
          })
        : Promise.resolve(null);
    /**
     * The run's count of its agent's questions, which numbers them (`ask` ids): every prompt of the run carries it on, so
     * a question of a later prompt never takes the id of one an earlier prompt asked and ended (the owner's of 11-10).
     */
    const asks = { n: 0 };
    /** What the fence's refusals already said to this worker in this turn: each is said once. @type {Set<string>} */
    const strays = new Set();
    /**
     * The fence refused a worker's request: Filament's word goes into its run as a note it reads at its next step —
     * where the same file is in its worktree. Its agent heard only a no.
     * @param {import("./agent-permits.js").Stray} out
     */
    const strayTold = (out) => {
      const text = strayWords(out, String(host?.workdir || ""), host?.folder || null);
      if (!runs || strays.has(text)) return;
      strays.add(text);
      runs.steer(rec.id, { kind: "note", text, from: SHIM });
    };
    /** Whether the hold's words reached this worker in this turn: they are said once. */
    let heldSaid = false;
    /**
     * The switch refused a worker's change or command while its lead reviews its plan (HarnessV3-TaskGraph-v2 TG2-D50):
     * Filament's word goes into its run as a note it reads at its next step — send its plan with ask_lead. Its agent
     * heard only a no.
     */
    const heldTold = () => {
      if (!runs || heldSaid) return;
      heldSaid = true;
      runs.steer(rec.id, { kind: "note", text: PLAN_HELD, from: SHIM });
    };
    /**
     * How a harness chat's turn judges what its agent asks to do (HarnessV3-ACP AC3-2): by the session's rules and its
     * switch, as the loop judges its own calls, with the project's learned permissions; the mode read at each request,
     * so a switch made while the agent works reaches its next one — a team's lead's too, which has hands of its own
     * (HarnessV4_Tasks decision 9; AC6-D3 held it at read-only). A worker in its own worktree is held to it (`confine`): a change
     * it asks to make anywhere else is refused, and so is a command that reaches the developer's folder and may write
     * there, since its work is read from its worktree; Filament says so to it (`strayTold`). A worker whose lead reviews
     * its plan has its changes and commands refused until its lead's go (`held`, TG2-D50), which Filament says to it too
     * (`heldTold`).
     */
    const sessionPermits = () => {
      const archive = /** @type {any} */ (memory).archive || null;
      const chain = memChain;
      const browsers = deps.browsers || null;
      const team = host?.team ? { key: String(host.team.key), name: String(host.team.name) } : null;
      return createAgentPermits({
        rules: rulesFrom(mem?.sit?.settings || null),
        modeNow: sessionMode({ config, archive, chain: chain || chainRef || null, sit: mem?.sit, header: modeAsked, devices: deps.devices ?? null, device: agentDevice }).modeNow,
        learned: projectPermissions({ archive, projectId: mem?.sit?.project?.id, chainId: chain, loop: loopConfig(config().agentLoop || {}, mem?.sit?.settings?.loop || null) }),
        confine: host?.workdir || null,
        folder: host?.workdir ? host.folder || null : null,
        reads: [...added.folders, ...worktreeReads],
        onStray: host?.workdir ? strayTold : null,
        // What its brief lets it run without anyone's answer, in its worktree (HarnessV3-TaskGraph-v2 TG2-D44) — in another
        // machine's agents' chat, only while their device may run without asking here, read at each call (`unasked`, or
        // Full control), as the loop's worker's are (turn.js).
        grants: host?.workdir ? host.grants || null : null,
        grantsHold: agentDevice !== null ? () => heldGrant(deps.devices?.get?.(agentDevice), "unasked") : null,
        // Its run starts held for its lead's review of its plan (TG2-D50), asked of the registry at each request.
        held: host?.planHeld && registry ? () => registry.planHeld(host.id) : null,
        onHeld: host?.planHeld ? heldTold : null,
        // Another machine's agents' chat, or a sub-agent's run in one: a command that reads this machine's Filament is no
        // read-only command there (read-only-commands.js `agentsDevice`) — unless under Full control, as the person's.
        agentsDevice: fenced,
        // The sites the chat's agents may act on in its browser (AT-D7): a team's worker's, those its lead said yes to too,
        // and its question says whose yes holds for whom.
        browserAllowed: chain && browsers ? (site) => browsers.allowed(chain, site, team) : null,
        browserTeam: team,
        // A review rule's second look (HarnessV4_Space_Plan S3b): the Reviewer, in this chat.
        look: deps.secondLook && (chain || chainRef) ? lookIn(deps.secondLook, String(chain || chainRef)) : null,
        // A routine's run acts through the connections' tools the person switched it on with (HarnessV4_SpacesPlugins_Plan
        // A2c), as the loop's own run does: Filament marked them on the chat as the run began; its workers get none.
        acts: !host && chain ? routineActs(archive?.metaOf(chain, ["routine"])) : null,
        // The commands the chat keeps always allowed (d-allow, agent/chat-always.js), read from its meta at each request:
        // its own seat's — its agent, or a team's lead in charge — never a sub-agent's, whose run rides the chat's chain,
        // nor a chat another machine's agents started, under Full control or not.
        alwaysRun: !host && (chain || chainRef) && agentDevice === null ? () => keptNow(archive, chain || chainRef) : null,
      });
    };
    /** Whether the turn's phase says a step of the agent's. */
    let stepping = false;
    /** The step the turn named last: a failure says where the agent was (`failureWords`). */
    let lastStep = "";
    /**
     * A step the turn waits on, by name (HarnessV3-FailurePoints §5.1 item 2): before the agent's session is up — its
     * start, its session opened or resumed, a switch of its mode — the turn's phase on the session's lock, which the
     * run's start ends; after, the run's ("sent").
     * @param {{ step: import("../services/session-turns.js").AgentStep | "sent", to?: string }} ev
     */
    const stepped = (ev) => {
      lastStep = ev.step;
      if (run.agent) return run.agent.take(ev);
      if (!phase || ev.step === "sent") return;
      stepping = true;
      phase({ kind: "agent", method: null, since: Date.now(), step: ev.step, agent: agentName, ...(ev.to ? { to: String(ev.to) } : {}) });
    };
    /** The agent's session is up, or the turn is over: its phase says no step any more. */
    const stepsDone = () => {
      if (!stepping) return;
      stepping = false;
      phase?.(null);
    };
    /**
     * What the agent sends: the run's events from it first (a round's start breaks the reply's block), then the reply.
     * The session's start answers once the turn may begin, and the bridge sends the prompt after it.
     * @returns {Promise<void> | void}
     */
    // The agent's first count of its context in this turn (HarnessV4_Tasks C33): in a session new to it, its own
    // prompt and tools with what Filament sent.
    let firstCount = 0;
    const take = (/** @type {any} */ ev) => {
      if (forced) return;
      if (ev?.type === "usage" && !firstCount && Number(ev.usage?.used) > 0) firstCount = Number(ev.usage.used);
      if (ev?.type === "step") {
        // The prompt was written to the agent: what it carried is kept once it reached it (`reachedNow`).
        if (ev.step === "sent") {
          promptSent = true;
          reaching = true;
        }
        return stepped(ev);
      }
      if (ev?.type === "taken") return takenAt(ev);
      if (ev?.type === "session") {
        run.facts = ev.facts || null;
        // The agent's session may say which model it is on before any reply (a set it answered with another model, the
        // one its last turn was answered by): a client that reads the reply alone is told at once.
        if (!chatTurn && !host) weighModel(run.facts);
        // A prompt of the same turn's after the first (AC6-1, AC6-4) goes on in the run: the way into it is its own,
        // and it takes what the last handed back. A run that started before its session was up, as a side agent's
        // earlier exchanges gave way (`exchangesGiveWay`), learns its session here.
        if (run.agent) {
          if (!runSession.sessionId) runSession = { sessionId: ev.sessionId ?? null, cwd: ev.cwd ?? runSession.cwd };
          ownNow = ev.ownCommands || null;
          steerTo(ev.steer || null);
          handedBack = false;
          if (steerNow && run.mailbox) void deliver(run.mailbox);
          sideSaid(ev.facts);
          return;
        }
        const opened = openRun(ev);
        // A sub-agent's run says its window and its line, now that it is there (`openRun` made it before its first wait).
        sideSaid(ev.facts);
        // The envelopes still sealed went with the first prompt: said on the run, now it is there, and on the record.
        if (sealedAtStart.length && ev.facts?.given?.recall?.includes(ENVELOPES_BLOCK)) {
          (rec.priorChanges ||= []).push(`acp: ${sealedAtStart.length} envelope${sealedAtStart.length === 1 ? "" : "s"} still sealed, listed with ${agentName}'s first prompt of the turn`);
          // `openRun` made the run's agent: the check above it said none yet.
          const round = /** @type {any} */ (run).agent?.round() ?? 0;
          // A letter that came while no turn ran is told here for the first time: its card, as one sealed in the turn —
          // as the loop's start draws it; the others are listed again.
          const fresh = turnInbox?.fresh(sealedAtStart.map((e) => e.n)) || [];
          for (const e of fresh) events.publish(topic, { type: "envelope-sealed", round, envelope: e.n, agentId: e.from, description: e.description, sender: e.sender, subject: e.subject, ...(e.via ? { via: e.via } : {}) });
          const again = sealedAtStart.filter((e) => !fresh.some((f) => f.n === e.n)).map((e) => e.n);
          if (again.length) events.publish(topic, { type: "envelope-list", round, envelopes: again, at: "start" });
        }
        // The files read or written in the chat that changed since went with it (c-news) — not with the agent's own command.
        newsGiven = !!newsFact && !!ev.facts?.given?.recall?.includes("file-news");
        if (newsGiven) (rec.priorChanges ||= []).push(`acp: files read or written in this chat changed since — named with ${agentName}'s first prompt of the turn`);
        // The prompt that was to say the compaction opened a new session from Filament's copy of the chat instead, with
        // the blocks made for one (`seedBlocks`): its seed holds what the compaction left, so nothing of it is owed any more.
        seededStart = !!seedBlocks && ev.facts?.seeded === true;
        // What is still open goes with it too — not with the agent's own command, which carries nothing of Filament's.
        openInPrompt = !!openAtStart && (seededStart || !!ev.facts?.given?.recall?.includes(OPEN_BLOCK));
        if (openInPrompt && openAtStart && openFor && memChain) openFor.startSaid(memChain, openAtStart.keys);
        // And where it stands — said with it, held by the seed it went with (context.js `notHeldIn`), in what a move
        // handed over (sw-quiet), or in the task graph of the block its compaction owed, which says it as this start does.
        const given = [...(ev.facts?.given?.recall || []), ...(ev.facts?.given?.held || [])];
        whereGiven = !!whereAtStart && (given.includes(WHERE_BLOCK) || ((switched || (owes && !seededStart && !!owedBack?.graph)) && given.includes(OPEN_BLOCK)));
        return opened;
      }
      // A graph task's report, given through Filament's tool (AC6-1): its run's end hands it on.
      if (ev?.type === "task-report") {
        taskReport = ev.report;
        return;
      }
      // A sub-agent's turn waits for the background tasks its agent left running (the owner's D3 of 11-09): its run says
      // what it waits for, as it does for its background commands, and what the developer typed goes now (`tasksWait`) —
      // while words still go into the turn: once those queued at the agent were answered (`closed`) they wait for the
      // agent's next call (C34), else go as the next message.
      if (ev?.type === "waiting") {
        run.agent?.waiting(String(ev.why || ""));
        tasksUntil ??= Date.now() + COMMANDS_HELD_MS;
        if (ev.closed) return;
        tasksWait = true;
        for (const m of run.mailbox?.list((x) => x.kind === "note") || []) due.add(m.id);
        letHeldGo();
        return;
      }
      // The agent at work on the prompt written to it: the prompt reached it, before anything is made of what it does.
      if (reaching && AGENT_WORKS.has(ev?.type)) reachedNow();
      run.agent?.take(ev);
      onEvent(ev);
      sawWork(ev);
      // The agent's own call starts — a sub-agent's is not its step: what the developer typed meanwhile goes now
      // (HarnessV4_Tasks C34).
      if (ev?.type === "tool" && ev.phase === "call" && !ev.subagent && !ev.parentToolCallId) callCame(ev);
      // The agent compacting its own context (HarnessV3-TaskGraph-v2 TG2-D56): while it does, what its sub-agents send
      // waits at the door. Once it compacted, what the summary may have lost comes back in one block at its next step
      // (`compactedAfter`, `stepWords`). A compaction of a sub-agent the agent runs itself (`ev.subagent`: Claude's Task,
      // Codex's and Cursor's own) is its child's, not its.
      if (ev?.type === "compaction" && ev.state && !ev.subagent) {
        if (ev.state === "started") holdWhileCompacting();
        else {
          if (ev.state === "completed") compactedAfter(String(ev.id || ""));
          compacting?.release();
        }
      }
    };
    /** Whether a prompt was written to the agent (its bridge's `sent` step): the turn made a model call, or tried to. */
    let promptSent = false;
    /** Whether a prompt written to the agent has yet to reach it (`reachedNow`). */
    let reaching = false;
    /** Whether a prompt of the turn's reached the agent (`reachedNow`): what the first carried is the chat's to keep. */
    let promptReached = false;
    /**
     * What a wake's or a reminder's prompt marks heard once it reached the agent (`reachedNow`): what comes back after a
     * compaction, which a prompt that never reached it leaves owed (the hunt of c-compact, sa_014723a3).
     * @type {(() => void) | null}
     */
    let wakeWent = null;
    /** Whether the turn's first prompt carries what is still open (`openAtStart`). */
    let openInPrompt = false;
    /** Whether that prompt opened a new session from Filament's copy of the chat, with the blocks made for one in place of what it was to say of the compaction (`seedBlocks`). */
    let seededStart = false;
    /** Whether the prompt going out carries where it stands (`whereAtStart`): once it reached the agent, the turn's start is kept. */
    let whereGiven = false;
    /** Whether the prompt going out names the files it read that changed since (`newsFact`): once it reached the agent, their sightings move. */
    let newsGiven = false;
    /**
     * The prompt written to the agent reached it (c-begin; the re-review of 11-11: its `sent` step is no proof): its
     * first word, thought or call after it (`take`), or the prompt's end where it did not fail (`prompt`) — one the
     * agent refused, or that failed at its plan's wall, carried nothing to it. What it carried is kept now: a wake's
     * block as heard, the turn's start on its task graph, the sightings of the files it named — by the one rule the
     * turn's end keeps what is still open by (`openEnded`).
     */
    const reachedNow = () => {
      if (!reaching) return;
      reaching = false;
      promptReached = true;
      const went = wakeWent;
      wakeWent = null;
      went?.();
      // Where it stands reached the agent with this prompt: the turn's start is kept (`whereOpening`).
      if (whereGiven) {
        whereGiven = false;
        whereOpening?.begun();
      }
      // And what changed in the files it read: their sightings move (c-news).
      if (newsGiven) {
        newsGiven = false;
        news?.commit();
      }
    };
    /** The agent's own compactions in this turn that gave an id, by it: each comes back once (TG2-D56). @type {Set<string>} */
    const compactions = new Set();
    /** How many times the agent compacted in this turn: a block on its way as it compacts again is of the one before (`backNow`). */
    let compactedTimes = 0;
    /** Whether what comes back after the agent's own compaction waits for its next step (`stepWords`). */
    let backPending = false;
    /**
     * Whether the agent compacted in this turn with nothing said after it (`compactedAfter`, `stepWords`): the turn's end
     * keeps the compaction for its next turn's first prompt, though this turn's first prompt carried the list (the review
     * of 11-08: a second compaction was taken as told).
     */
    let compactedUnsaid = false;
    /**
     * The agent compacted its own context (the owner's of 11-10: one block, as the loop's fold has): the chat keeps that
     * nothing has said what is open since (`lost`, agent/still-open.js), and what comes back waits for the agent's next
     * step in this turn (`stepWords`) — or, where the turn takes none, for its next turn's first prompt. Never a prompt of
     * its own: one would be a model call on the compacted context for these words alone. Once a compaction, by its id —
     * one the agent gives no id for is a compaction each time its end is said (the bridge says an end once, updates.js).
     * @param {string} id
     */
    const compactedAfter = (id) => {
      if (id && compactions.has(id)) return;
      if (id) compactions.add(id);
      compactedTimes++;
      backPending = true;
      // The skills it had loaded, whose text the compaction may have taken (c-skills), kept with the chat for its
      // session: what it was owed still — a compaction before this one, whose block never went —, those of the turns
      // Filament's copy holds since its head, then this turn's so far. A sub-agent's run holds its own turn's alone:
      // the copy's turns are the chat's agent's.
      if (skillsOf) skillsBack.compacted(skillsOf.chain, skillsOf.who, [...(host ? [] : [.../** @type {any} */ (deps.sessions)?.skillsLoaded?.(skillsOf.chain) || []].reverse()), ...skillsHere]);
      skillsHere = [];
      if (!openFor || !memChain) return;
      openFor.lost(memChain);
      compactedUnsaid = true;
    };
    /**
     * What comes back after the agent's compaction, taken to go in now (no longer pending) — by `steer` into its running
     * turn, or with the run's own next prompt (`prompt`, `wakeWith`), which goes anyway: null where none waits, while it
     * compacts again, or where the agent takes words only by Filament cancelling its turn at its next step (`next`),
     * which is not cut for them — its next prompt says them. Read before what waits at the door is taken: a lead's team
     * words say a report there comes right behind them. `heard`: it went in — what is open is kept as heard, the
     * envelopes as listed, and the record says it; `keep`: nothing went with it, or the turn handed it back (Cursor's
     * `revert_to_followup`, a steer refused), so it waits on for what goes next — the agent's next step, or the follow-up
     * that carries what waits at the door — and is marked heard as that goes out. With none, the chat keeps the
     * compaction (`lost`) for its next turn's first prompt. `tail`: it rides the end of Filament's next tool answer to an
     * agent that takes words only once a step ended (`stepWords`, tool-tail.js), heard as that answer goes. `sealed`:
     * false where the prompt it goes with lists the envelopes still sealed itself (`owed`, the reminder).
     * @param {Steer | null} steer @param {{ prompt?: boolean, tail?: boolean, sealed?: boolean }} [o]
     */
    const backNow = (steer, { prompt = false, tail = false, sealed = true } = {}) => {
      if (!backPending || runStatus || compacting) return null;
      if (!prompt && !tail && (!steer || (steer.at !== "queued" && steer.at !== "live") || handedBack)) return null;
      backPending = false;
      const chain = memChain;
      const of = compactedTimes;
      const team = leadTeam ? (doorTurn?.teamNow?.() ?? null) : null;
      const b = backText("now", { team: team?.text ?? null, sealed, steer: steer?.at ?? null, session: runSession.sessionId, opens: opensNow() ?? declaredOwn(), recall: typeof run.facts?.ownTools === "boolean" ? run.facts.ownTools : declaredOwn() });
      if (!b.text) return null;
      return {
        text: b.text,
        /** @param {boolean | "after" | "tail" | "report" | "reminder"} took  how it went: `report` and `reminder`, with the prompt that asks a task's report or reminds of sealed envelopes @param {readonly string[]} behind  what went in behind it */
        heard: (took, behind) => {
          // It compacted again while this block was on its way: the block is of the compaction before, and what that
          // one may have lost is still to say — at its next step, or its next turn's start (the re-review of 11-11).
          const stale = of !== compactedTimes;
          if (!stale && skillsOf) skillsBack.heard(skillsOf.chain, skillsOf.who);
          if (!stale && openFor && chain) {
            openFor.heard(chain, b.keys);
            compactedUnsaid = false;
          }
          if (b.envelopes.length) events.publish(topic, { round: run.agent?.round() ?? 0, type: "envelope-list", envelopes: b.envelopes, at: "compaction" });
          if (leadTeam) (rec.priorChanges ||= []).push(team ? `agent: the lead compacted its context — Filament tells it how its ${team.workers === 1 ? "worker of this turn stands" : `${team.workers} workers of this turn stand`}` : "agent: the lead compacted its context with no worker of this turn: Filament said nothing of its team");
          const graphToo = b.graph ? ", its task graph with it" : "";
          (rec.priorChanges ||= []).push(
            took === "after"
              ? `acp: what comes back after ${agentName}'s compaction was taken after its turn's answer`
              : took === "tail"
                ? `acp: what comes back after ${agentName}'s compaction rode the end of Filament's next tool answer to it${graphToo}`
                : took === "report" || took === "reminder"
                  ? `acp: what comes back after ${agentName}'s compaction went with the prompt that ${took === "report" ? "asked for its task's report" : "reminded it of the envelopes still sealed"}${graphToo}`
                  : `acp: what comes back after ${agentName}'s compaction went into its turn${graphToo}${behind.length ? `, ${fromFilament(behind)} behind it` : ""}`,
          );
        },
        keep: () => void (backPending = true),
      };
    };
    /**
     * The turn's end, for what is still open: where the agent's prompt reached it (`reachedNow`) — with the list, where
     * one was due — the chat keeps the list as it stands (`ended`); else nothing moves, and its next turn's first prompt
     * says what this one never did. A turn that failed before its prompt reached the agent reached nothing; one that
     * failed after did, as a cycle the agent began by itself does where it did not fail. @param {boolean} failed
     */
    const openEnded = (failed) => {
      if (!openFor || !memChain) return;
      if (backPending && !failed) (rec.priorChanges ||= []).push(`acp: ${agentName} compacted its context and took no step Filament could send words in at: its next turn's first prompt says what the compaction may have lost`);
      backPending = false;
      const reached = promptReached || (!failed && !!ownCycle);
      const told = openInPrompt && promptReached;
      // The block owed since its compaction went — or the seed of a new session, which holds what it left —, the skills
      // it had loaded in it (c-skills): none is owed any more, unless it compacted again.
      if (told && owes && !compactedUnsaid && skillsOf) skillsBack.heard(skillsOf.chain, skillsOf.who);
      // The switch's first prompt went as the agent's own command, which carries nothing of Filament's: the turn keeps
      // where the chat moved from, and the agent's next prompt is handed what stands (the hunt of 11-08: it never was) —
      // where its session went on, what came after its newest turn there alone (`handoverAfter`, the bug hunt of 11-09).
      if (reached && !told && openAtStart?.why === "switched" && handedOver && mem?.prep?.turn) {
        memory.archive?.mergeTurnMeta?.(mem.prep.turn, { handoverOwed: handedOver.from, ...(handedOver.after ? { handoverAfter: handedOver.after } : {}) });
        (rec.priorChanges ||= []).push(`acp: the agent's own command went as typed, carrying nothing of Filament's: what stands as the chat moved from ${handedOver.from} goes with ${agentName}'s next prompt`);
      }
      if (!reached || (openAtStart && !told)) return;
      if (told && openAtStart)
        (rec.priorChanges ||= []).push(
          seededStart
            ? `acp: ${agentName}'s new session begins from Filament's copy of the chat, which holds what its compaction left: nothing is said of the compaction beside it`
            : openAtStart.why === "switched"
            ? `acp: what stands, handed to ${agentName} with its first prompt of the turn as the chat moved from ${handedOver?.from}`
            : openAtStart.keys.length || openAtStart.why !== "lost"
            ? `acp: what is still open, listed with ${agentName}'s first prompt of the turn — ${openAtStart.why === "lost" ? "it compacted its context since it was last told" : openAtStart.why === "folded" ? "Filament folded the chat's turns since it was last told" : openAtStart.why === "waits" ? `a sub-agent's change still waits for it, unsaid for ${WAITS_AGAIN} turns` : openAtStart.why === "more" ? "an answer of its last turn counted what else is open and named only a part" : "a change it was told waits for it was applied or dropped since"}`
            : `acp: recall's list of the turns, named with ${agentName}'s first prompt of the turn — it compacted its context since, with nothing open`,
        );
      openFor.ended(memChain, told && !compactedUnsaid);
    };
    /** Whether the record says what waited for the agent's next call: once. */
    let waitedSaid = false;
    /**
     * What the developer typed that waited for the agent's next call, which never came (HarnessV4_Tasks C34), said on
     * the record once, before the turn's record is put together: the run's end says it unread, and it goes as the next
     * message.
     */
    const sayWaited = () => {
      if (waitedSaid || !run.mailbox) return;
      waitedSaid = true;
      const n = run.mailbox.list((m) => m.kind === "note" && typedByDeveloper(m) && !handed.has(m.id) && heldNotes.get(m.id) !== m.text).length;
      if (n) (rec.priorChanges ||= []).push(`acp: ${n === 1 ? "a message" : `${n} messages`} sent while ${agentName} worked waited for its next tool call, and its turn ended first: ${n === 1 ? "it goes" : "they go"} as the next message`);
    };
    /**
     * The run's end, once, before the reply's (the loop's order: the reply carries it): its translator closes the calls
     * still open and takes the last snapshot, then the run log and the live words let it go.
     * @param {"done" | "stopped" | "aborted" | "failed" | "paused"} status @param {Record<string, any>} [summary]
     */
    const endRun = async (status, summary = {}) => {
      const agent = run.agent;
      if (!agent || runStatus) return;
      // The notes queued at the agent settle first, once its turn has drained them: each read where the agent took it,
      // or left for the next message. A Force stop ends the run now.
      if (!forced) await Promise.all(atAgent.values());
      if (runStatus) return;
      sayWaited();
      runStatus = status;
      await agent.close({ status, forced });
      runs.endRun(rec.id, { status: status === "failed" ? "error" : status, summary: { ...agent.counts(), ...summary, ...(forced ? { forced: true } : {}) } });
      liveWords?.end(rec.id);
    };
    /**
     * The record's `acp` block: how the turn ran and what it did, from its result, or from its facts as they stood when
     * it failed (HarnessV3-ACP AC2-5).
     * @param {any} r @param {{ clientAction?: any, stoppedBy?: { by: string } | null }} [o]
     */
    const acpBlock = (r, { clientAction, stoppedBy = null } = {}) => ({
      sessionId: r.sessionId ?? null,
      cwd: r.cwd ?? null,
      reused: r.reused,
      seeded: r.seeded,
      resumed: r.resumed,
      tools: [...renderer.lines],
      bridge: r.bridge || null,
      configuredBridge: acp.clientBridge || "prompts",
      steering: r.steering || undefined,
      toolStats: renderer.summary,
      modelUsage: r.modelUsage || undefined,
      linesAdded: r.linesAdded || 0,
      linesRemoved: r.linesRemoved || 0,
      agentModel: r.agentModel || undefined,
      // Where that is not the model the turn asked for (`weighModel`): both names, and the words said under the turn.
      otherModel: otherNow ? { chosen: otherNow.chosen, answered: otherNow.answered, ...(otherNow.said ? { said: otherNow.said } : {}) } : undefined,
      title: r.title || undefined,
      // Who the agent ran as and its plan's windows, as the agent itself said, in the one shape every agent's account
      // takes (core/agent-limits.js, HarnessV3-ACP AC3-6): Claude's, Codex's, the owner of Cursor's API key.
      account: r.account || undefined,
      // What the turn gave the session of Filament's context, and through which channel (HarnessV3-ACP AC4-1).
      given: r.given || undefined,
      clientAction,
      continued: continuing || undefined,
      own: ownCycle ? true : undefined,
      // The turn's run (HarnessV3-ACP AC1-1): how it ended and what it did, counted.
      run: run.agent
        ? { status: runStatus, ...run.agent.counts(), ...(stoppedBy ? { stoppedBy: stoppedBy.by } : {}), ...(forced ? { forced: true } : {}) }
        : undefined,
      // The team the agent led (AC6-3), and what the reports it heard spent.
      team: leadTeam && doorTurn ? { key: leadTeam.key, name: leadTeam.name, spentUsd: Math.round(doorTurn.spentUsd() * 1e6) / 1e6 } : undefined,
    });
    /**
     * What a turn that failed keeps of the bridge's facts: how its session began and ran, what it changed, the model
     * and the account it ran on, and the models that counted what the agent reported it spent; never its words, which
     * it does not have whole.
     * @param {Record<string, any> | null} f
     */
    const factsOf = (f) =>
      f
        ? {
            sessionId: f.sessionId,
            cwd: f.cwd,
            reused: f.reused,
            seeded: f.seeded,
            resumed: f.resumed,
            bridge: f.bridge,
            steering: f.steering,
            linesAdded: f.linesAdded,
            linesRemoved: f.linesRemoved,
            agentModel: f.agentModel,
            title: f.title,
            account: f.account,
            modelUsage: f.modelUsage,
          }
        : {};
    /**
     * Another model than the chat's answered (core/answering-model.js `answeredAs`): the agent names the model a turn
     * was answered by (`agentModel` on the bridge's facts), and it is not the one the turn asked for. Both names go on
     * the turn's record every time (`acp.otherModel`, which its footer reads). The words — the note of kind
     * "other-model": both names, what it means, the one thing to do — are said once for a pair of names: on the chat's
     * first such turn, and again when the model that answered changes. Where: under the turn on a harness chat's page
     * (`said`, Filament's own paragraph: a reply's italic line is easy to miss, and the agent's next turn would read
     * it as its own words), in the reply's own line for a client that draws no page — at once where the agent's
     * session says it before any reply (`weighModel` at the session's start) —, in its report for a sub-agent's run
     * (the registry's, each time). The pair said last is the chat's (`meta.otherModel`, and the bridge's conversation's
     * where no chat is kept), so a restart does not say it again; a turn answered by the model it asked for forgets it.
     */
    const chosenModel = windowName || modelId;
    const otherChat = memChain || chainRefOf(inboundHeaders) || null;
    const otherConv = () => bridge.peekByRequest({ upstream, format, body, cwdHint, conversationId });
    /** Whether a pair said is this one: the model that answered under the same name, or another name of it. @param {any} pair @param {string} answered */
    const isPair = (pair, answered) => !!pair && pair.chosen === chosenModel && (pair.answered === answered || answeredAs(pair.answered, answered) === "same");
    /** The pair said last in this chat, or null. */
    const otherSaidLast = () => {
      try {
        const kept = otherChat ? memory?.archive?.metaOf(otherChat, ["otherModel"])?.otherModel : null;
        if (kept) return kept;
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} what this chat was told of the model that answered could not be read: ${e.message}`);
      }
      return otherConv()?.otherModel || null;
    };
    /** @param {{ chosen: string, answered: string } | null} pair  the pair said now; null forgets it */
    const otherKeep = (pair) => {
      const conv = otherConv();
      if (conv) conv.otherModel = pair;
      try {
        if (otherChat)
          memory?.archive?.updateMeta(otherChat, (meta) => {
            if (pair) meta.otherModel = pair;
            else delete meta.otherModel;
          });
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} what this chat was told of the model that answered was not kept: ${e.message}`);
      }
    };
    /**
     * What the turn knows of it: both names, why where the turn's notes say (`why`), and the words where this turn
     * says them under itself (`said`). Null while the model that answered is the turn's, or nobody named one.
     * @type {{ chosen: string, answered: string, why: "not-offered" | "rerouted" | null, said?: string } | null}
     */
    let otherNow = null;
    /**
     * What a sub-agent's run hands its registry of it (`HostFinish`): the model its agent says answered, and both
     * names where that is not the one it was launched on. @param {Record<string, any> | null | undefined} r
     */
    const answeredFinish = (r) => ({
      ...(r?.agentModel ? { agentModel: String(r.agentModel) } : {}),
      ...(otherNow ? { otherModel: { chosen: otherNow.chosen, answered: otherNow.answered } } : {}),
    });
    /**
     * Read the model that answered off the bridge's facts and say it where it is due.
     * @param {Record<string, any> | null | undefined} r  the facts as they stand, or the turn's result
     * @param {{ ended?: boolean, quiet?: boolean }} [o]  `ended`: the turn ran to its end, and one answered by its own
     *   model forgets the pair said last; `quiet`: the record alone keeps it (a turn that failed or was stopped, whose
     *   reply takes no more words)
     */
    const weighModel = (r, { ended = false, quiet = false } = {}) => {
      const answered = r?.agentModel ? String(r.agentModel) : "";
      // The agent's own word that it is not on the model asked for: it moved the turn, it does not offer the name,
      // or it answered the set with another model (`modelKept`). Two names that may be one model are then two.
      const why = r?.rerouted ? "rerouted" : (r?.structured || []).some((/** @type {any} */ s) => s?.note?.kind === "model-not-offered") ? "not-offered" : null;
      const verdict = ownCall ? "unknown" : answeredAs(modelId, answered, { sure: !!why || !!r?.modelKept });
      if (verdict !== "different") {
        otherNow = null;
        if (ended && verdict === "same" && otherSaidLast()) otherKeep(null);
        return;
      }
      const told = isPair(otherNow, answered) ? otherNow?.said : undefined;
      otherNow = { chosen: chosenModel, answered, why, ...(told ? { said: told } : {}) };
      // A sub-agent's run says it in its report, which its registry writes.
      if (quiet || host || told || isPair(otherSaidLast(), answered)) return;
      const text = renderHints({ kind: "other-model", chosen: chosenModel, answered, why }, { agentName, firstTurn: false }).map((h) => h.text).join(" ");
      if (chatTurn) otherNow.said = text;
      else ownLine(text);
      otherKeep({ chosen: chosenModel, answered });
      (ended ? (rec.changes ||= []) : (rec.priorChanges ||= [])).push(`acp: hint shown to the user: ${text}`);
    };
    /** The record's sentence for it, where the turn found it. */
    const otherRecord = () => (otherNow ? renderRecord({ kind: "other-model", chosen: otherNow.chosen, answered: otherNow.answered, why: otherNow.why }) : null);
    /**
     * What a turn cost (HarnessV3-ACP, AC3's drive D3), from its result, or from its facts as they stood when it failed:
     * an agent's own figure is its tokens at the API's prices — what a login billed by use paid, and what a turn was
     * worth while a plan paid it ($0) — where the agent reported its usage. How the login pays is the agent's word on
     * who it ran as; where it said nothing, an agent's turn is billed as its upstream is (a plan's).
     * @param {Record<string, any> | null} r
     */
    const spendOf = (r) => {
      const figure = r?.usage ? (r.context?.cost ?? null) : null;
      const pays = r?.account?.billing || null;
      // An agent that said what its session cost, but not this turn's share of it (`costUnseen`): the turn's tokens at
      // the price card, where one prices the model.
      const priced = figure ?? (r?.usage && r.costUnseen ? estimateCost(cardModel(), r.usage, upstream.pricing || null) : null);
      return {
        billing: pays || undefined,
        cost: priced == null ? null : pays === "metered" ? priced : 0,
        listCost: priced ?? undefined,
        costSource: figure != null && pays === "metered" ? /** @type {const} */ ("agent") : undefined,
      };
    };
    /** The model a turn's tokens are priced as at the card, as the record's close prices them. */
    const cardModel = () => String(rec.upstreamModel || rec.model || modelId || "");
    /**
     * Why a turn's cost is not the agent's own figure, where it said what its session cost but not this turn's share
     * (`costUnseen`, the bridge's words for why): its tokens at the card, or no figure at all where no card prices the
     * model. Null otherwise.
     * @param {Record<string, any> | null} r
     */
    const costWhy = (r) => {
      if (!r?.usage || !r.costUnseen) return null;
      const model = cardModel();
      const how = estimateCost(model, r.usage, upstream.pricing || null) == null ? `no price card prices ${model}: the turn books its tokens with no figure` : "priced from its tokens at the card";
      return `acp: ${agentName}'s figure for what this turn cost is not known: ${r.costUnseen}; ${how}`;
    };
    /** Resolves "stopped" once the signal aborts. @param {AbortSignal} s @returns {Promise<string>} */
    const abortOf = (s) => (s.aborted ? Promise.resolve("stopped") : new Promise((resolve) => s.addEventListener("abort", () => resolve("stopped"), { once: true })));
    /**
     * What wakes an agent whose turn ended while Filament's sub-agents still owe it (AC6-4): what it has not heard — a
     * lead's workers' reports, a plain chat's sub-agents' reports, and what the developer typed meanwhile — at once
     * where any waits, else once something lands while they run. Their words never wait for the sub-agents: no tool
     * call of the agent's comes between its prompts to take them in (the owner's of 11-04). Null when nothing more is
     * owed, or the stop, the hang-up, a Force stop or the run's end ends the wait. The agent's own command is no word to it (`weigh`): it waits queued for the turn's end, as typed, as one
     * sent while the agent works does (HarnessV3-FailurePoints finding 2) — and so do words that may be one, sent
     * before the agent said its commands.
     * @param {import("./agent-inbox.js").AgentTurn} lt
     * @returns {Promise<string | null>}
     */
    /** What Filament hands a lead, counted in the record's words: its messages, and a look at its workers where one rides last. @param {readonly string[]} texts */
    const fromFilament = (texts) => {
      const looked = texts.length > 0 && lookOf(texts[texts.length - 1]) !== null;
      const said = texts.length - (looked ? 1 : 0);
      return [said && `${said} message${said === 1 ? "" : "s"} from Filament`, looked && "a look at its workers"].filter(Boolean).join(" and ");
    };
    const wakeWith = async (lt) => {
      /**
       * A note the agent hears: words, not its own command. One with pictures goes as the next message whole: the prompt
       * it would wake the agent with takes words alone.
       * @param {import("../services/runs.js").SteerMessage} m
       */
      const heard = (m) => m.kind === "note" && !m.images?.length && weigh(m) === "words";
      for (let said = false; ; said = true) {
        // Its turn ended, so it works no more (HarnessV4_Envelopes_Plan EN-D13): a result that came as it wrote its last
        // reply is opened, the sealed ones ahead of it; with none they stay sealed for the reminder. Once it waited for
        // its own, what is sealed opens first, then what arrived (case 7).
        // What comes back after its compaction, where nothing took it yet, goes first where a prompt goes anyway. Nothing
        // may await between it and the take: a lead's team words say what is at the door comes right after them.
        const back = backNow(steerNow, { prompt: true });
        const texts = lt.take(said ? {} : { end: true });
        const owes = lt.owes();
        // A plain chat's words wake its agent while it waits on its sub-agents, and go with the last report that wakes
        // it; with neither, its turn ends and they go as the next message.
        const notes = run.mailbox && (leadTeam || owes || texts.length) ? run.mailbox.read(heard) : [];
        if (texts.length || notes.length) {
          const guided = notes.filter((m) => m.from === WATCHER).length;
          (rec.priorChanges ||= []).push(`acp: ${agentName} woken in the same turn: ${[fromFilament(texts), notes.length > guided && `${notes.length - guided} of the developer's`, guided && `${guided} a watcher's guidance`].filter(Boolean).join(" and ")}`);
          // A sub-agent's agent hears whose each message is, as it does while it works.
          const heardWords = notes.length ? [host ? notes.map(workerNote).join("\n\n") : heardBlock(notes)] : [];
          wakeWent = back ? () => back.heard(true, texts) : null;
          return [...(back ? [back.text] : []), ...texts, ...heardWords].join("\n\n");
        }
        back?.keep();
        if (!owes) return null;
        if (!said) run.agent?.waiting(leadTeam ? "waiting for the team's workers to report" : lt.why?.() || "waiting for Filament's sub-agents to report");
        const mb = run.mailbox;
        // The mailbox's wait ends on a note the agent hears, or the run's end: then none can come.
        const got = await Promise.race([lt.arrival().then(() => "in"), owes.then(() => "in"), ...(mb ? [mb.next(heard).then(() => (mb.peek(heard) ? "in" : "ended"))] : []), abortOf(stopCtl.signal), abortOf(clientAbort.signal), forcedStop]);
        if (got !== "in") {
          waitStopped = got === "stopped" && stopCtl.signal.aborted && !clientAbort.signal.aborted;
          return null;
        }
      }
    };
    /**
     * What the agent's turn owes before the request ends, in Filament's words to it (AC6-1, AC6-4) — a graph task's
     * sub-agent that ended without its report is asked for it, once, as the loop's is; an agent whose turn holds a
     * door is woken with what its sub-agents sent — or null: a turn that ended by itself alone owes more, never one stopped, cut, waiting for the
     * client or whose plan was sent back.
     * @param {any} r
     * @returns {Promise<string | null>}
     */
    const owed = async (r) => {
      if (forced || stopCtl.signal.aborted || clientAbort.signal.aborted || r?.clientAction || r?.planBack || r?.stopReason !== "end_turn") return null;
      // What comes back after its compaction, where nothing took it yet, goes first with either prompt below, as with a
      // wake's: a prompt goes anyway, and the block would else wait for a turn after it — heard once that prompt reached
      // the agent (`wakeWent`).
      if (host?.task && !taskReport && !reportAsked) {
        reportAsked = true;
        (rec.priorChanges ||= []).push(`acp: asked ${agentName} for its task's report — its turn would have ended without one`);
        const back = backNow(steerNow, { prompt: true });
        wakeWent = back ? () => back.heard("report", []) : null;
        return back ? `${back.text}\n\n${REPORT_ASK}` : REPORT_ASK;
      }
      if (!doorTurn) return null;
      const woken = await wakeWith(doorTurn);
      if (woken != null || forced || stopCtl.signal.aborted || clientAbort.signal.aborted) return woken;
      // Envelopes still sealed as the turn would end: said once (HarnessV4_Envelopes_Plan EN-D5), and the agent may
      // end all the same. The reminder lists them, so the block before it does not.
      const reminder = doorTurn.remind?.() ?? null;
      if (!reminder) return null;
      const back = backNow(steerNow, { prompt: true, sealed: false });
      wakeWent = back ? () => back.heard("reminder", []) : null;
      return back ? `${back.text}\n\n${reminder}` : reminder;
    };
    /**
     * The reports of Filament's sub-agents into the agent's running turn as they land (AC6-4), where the agent takes
     * Filament's words while it works — its wait, while one holds, answers with them instead, and while the agent compacts
     * its own context they wait for its end (TG2-D56), and go behind what comes back after it, where its next step has
     * not taken that yet (`backNow`): no words of their own for it. What it can't take goes with its next prompt.
     * @param {import("./agent-inbox.js").AgentTurn} lt @param {Promise<any>} prompt  the prompt's end
     */
    const pumpReports = async (lt, prompt) => {
      let over = false;
      const ended = prompt.then(
        () => (over = true),
        () => (over = true),
      );
      for (;;) {
        await Promise.race([lt.arrival(), ended]);
        if (over || runStatus || stopCtl.signal.aborted) return;
        const held = compacting?.ends || lt.waiting();
        if (held) {
          await Promise.race([held, ended]);
          continue;
        }
        const steer = steerNow;
        if (!steer) return;
        // The agent works: another agent's result goes in as its envelope's line (HarnessV4_Envelopes_Plan EN-D1).
        // Read before the take, with nothing awaited between: a lead's team words say what is at the door comes right
        // after them.
        const back = backNow(steer);
        const texts = lt.take({ seal: true });
        if (!texts.length) {
          back?.keep();
          continue;
        }
        const text = [...(back ? [back.text] : []), ...texts].join("\n\n");
        // Queued at the agent, the reports are read where it took them, at its echo.
        const unplaced = steer.at === "queued" ? place(text, (after) => run.agent?.steered(text, [], !!after)) : () => true;
        // Filament's words, said as Filament's where they wait for the agent's next step (the nudge map of 11-10).
        const took = await steer.send(text, text, [], "filament").catch(() => false);
        if (!took) {
          unplaced();
          lt.unheard();
          back?.keep();
          return;
        }
        if (unplaced()) run.agent?.steered(text, [], took === "after");
        back?.heard(took, texts);
        const what = fromFilament(texts);
        (rec.priorChanges ||= []).push(took === "after" ? `acp: ${what} ran as ${agentName}'s next prompt: its turn had ended first` : `acp: ${what} went into ${agentName}'s running turn`);
      }
    };
    /**
     * What its agent attaches with a launch or a follow-up (attach.js), read as its own read is judged
     * (agent-permits.js): the session's read rules, and in another machine's agents' chat without Full control its folder's
     * fence while the mode asks (`readPast`). @param {string} cwd
     */
    const attachOf = (cwd) => () => {
      const reads = [...added.folders, ...worktreeReads];
      const mode = sessionMode({ config, archive: /** @type {any} */ (memory).archive || null, chain: memChain || chainRef || null, sit: mem?.sit, header: modeAsked, devices: deps.devices ?? null, device: agentDevice }).modeNow();
      return {
        judge: readJudge({ root: cwd, rules: rulesFrom(mem?.sit?.settings || null), fenced: fenced && mode !== "auto", reads, theirs: fenced }),
        redact: redactorOf(mem?.sit?.settings?.privacy?.redact),
        pictures: () => [...openingPictures(body), ...heardPictures],
        folders: [...(cwd ? [cwd] : []), ...reads],
      };
    };
    /**
     * The agent's turn as its team's lead (AC6-3): its door into the registry, which its team's tools go through over
     * Filament's MCP server, and the graph's work under it (HarnessV3-TaskGraph G3). Its orders
     * read the team's mode at each one, so a switch reaches the running turn.
     * @param {NonNullable<typeof leadTeam>} t @param {string} chainId
     */
    const openLead = (t, chainId) => {
      const sa = /** @type {NonNullable<typeof registry>} */ (registry);
      const cwd = String(cwdHint || "");
      const model = String(body.model);
      // Its check goes to each of its members that changes files (the plan's p6).
      const team = { key: t.key, name: t.name, members: t.members, models: t.models, check: t.check };
      const at = () => run.agent?.round() ?? 0;
      const emit = (/** @type {any} */ evt) => events.publish(topic, { round: at(), ...evt });
      const graph = graphOn && graphs ? graphs : null;
      const { docNow, fixed } = sessionMode({ config, archive: /** @type {any} */ (memory).archive || null, chain: chainId, sit: mem?.sit, header: modeAsked });
      // Its looks at its workers (TG2-D14): the new part only, since its conversation is its own, at the pace the
      // session says at each look.
      const looks = leadReads ? { seconds: () => lookSecondsOf(docNow()), lean: true, head: (/** @type {any} */ w, /** @type {number} */ now) => watchParts(w, now, { look: true }) } : null;
      // Its workers and its graph's follow the session's mode at each launch; a turn held to reading has them
      // read-only, as its lead is: at its door, on its orders and on its graph. Held by its team, which changes no
      // file, or by the session — a /plan's turn, a watcher's wake that only reads —, as a plain chat's door reads it
      // (`openLaunch`; r-doors, 11-12: a turn the session held read its team alone here, and a worker its lead briefed
      // wrote as the chat's mode let — on what a watcher heard from outside, with nobody there).
      const mode = fixed === "read-only" ? /** @type {const} */ ("read-only") : null;
      const door = sa.openTurn({ chainId, runId: rec.id, cwd, mode, model, thinking: null, fork: () => null, cache: null, emit, lead: true, round: at, owes: graph ? () => graph.owes(chainId) : null, before: null, looks, opens: opensNow, attach: attachOf(cwd) });
      turnInbox = door.inbox;
      graph?.attach(chainId, { runId: rec.id, cwd, mode, model, thinking: null, team });
      if (graph) ledGraph = chainId;
      const lt = createLeadTurn({
        registry: sa,
        door,
        chainId,
        runId: rec.id,
        cwd,
        model,
        mode,
        team,
        emit,
        note: (text) => (rec.priorChanges ||= []).push(text),
        mailbox: () => run.mailbox,
        reach,
        handOver,
        wrote: (writes) => run.agent?.wrote(writes),
        signal: AbortSignal.any([stopCtl.signal, clientAbort.signal]),
        callOf: async (name) => (run.agent ? run.agent.callFor(name) : null),
        graph: graph ? { apply: (input) => graph.apply(chainId, input, { crew: t.members }) } : null,
        // Its workers' reports reach it sealed while it works where it can open them: its bridge said the envelope tool
        // reached its session, at the prompt's start (EN-D10).
        opens: () => run.facts?.opensEnvelopes === true,
        // What lands while a task of its own runs is followed by which task, and how to take it up first (E41 P1 case 7).
        onTask: graph ? onTaskOnce : null,
      });
      const off = deps.agentTurns?.open(chainId, lt) || null;
      doorTurn = lt;
      doorShut = () => {
        off?.();
        lt.close();
        graph?.detach(chainId, rec.id);
      };
      (rec.priorChanges ||= []).push(`acp: ${agentName} leads team ${t.name} (engine.team): its workers do the work — Filament's agent, worker and wait reach it over MCP — and its own tools ${t.readOnly ? "only read, as its workers do: its team changes no file" : mode ? "only read in this turn, as its workers do: the turn is held to reading" : "work as the chat's permission mode allows, for a piece better done itself"}`);
      rec.priorChanges.push(
        leadReads
          ? `acp: ${agentName} reads along with its workers (engine.supervise): Filament shows it a look at them at once on a sign, else ${lookSecondsOf(docNow()) ? `every ${lookSecondsOf(docNow())} s while` : "whenever"} something is new (engine.lookSeconds) — the new part only, since its conversation is its own`
          : `acp: ${agentName} does not read along with its workers (engine.supervise is off, or Filament keeps no run log here): its wait answers with a line for each of them`,
      );
    };
    /**
     * A plain chat's turn: the loop's own door into the registry (HarnessV4_Tasks E12 step 2, E15 steps 3 and 5). What
     * Filament's sub-agents send the session's agent goes through it into the turn that runs, as it does into the
     * loop's — a report the developer sends on now (BW-8), one of a side agent they had tell it, one they had it wait
     * for, which the turn does not end before. Where the session names a model for Filament's sub-agents or someone to
     * ask (`o`), Filament's agent and wait go through it too: a launch runs under the session's permission mode as it
     * stands then, on the model the session names. Nothing of the agent's request is Filament's to fork.
     * @param {typeof launchOffer} o @param {string} chainId
     */
    const openLaunch = (o, chainId) => {
      const sa = /** @type {NonNullable<typeof registry>} */ (registry);
      const at = () => run.agent?.round() ?? 0;
      const emit = (/** @type {any} */ evt) => events.publish(topic, { round: at(), ...evt });
      // A turn the session made read-only — a /plan's (the owner's plan mode of 11-06) — launches its helpers read-only
      // too, as the loop's door does; any other follows the session's mode at each launch.
      const fixed = sessionMode({ config, archive: /** @type {any} */ (memory).archive || null, chain: chainId, sit: mem?.sit, header: modeAsked }).fixed;
      const door = sa.openTurn({ chainId, runId: rec.id, cwd: String(cwdHint || ""), mode: fixed === "read-only" ? "read-only" : null, model: String(body.model), thinking: null, fork: null, cache: null, emit, lead: false, round: at, owes: null, before: null, opens: opensNow, attach: attachOf(String(cwdHint || "")) });
      turnInbox = door.inbox;
      const lt = createLaunchTurn({
        registry: sa,
        door,
        chainId,
        emit,
        note: (text) => (rec.priorChanges ||= []).push(text),
        mailbox: () => run.mailbox,
        reach,
        handOver,
        wrote: (writes) => run.agent?.wrote(writes),
        signal: clientAbort.signal,
        stopSignal: stopCtl.signal,
        callOf: async (name) => (run.agent ? run.agent.callFor(name) : null),
        opens: () => run.facts?.opensEnvelopes === true,
        onTask: graphOn && graphs ? onTaskOnce : null,
        ownWork: graphOn && graphs ? () => graphs.ownWork(chainId, { solo: true }) : null,
      });
      const off = deps.agentTurns?.open(chainId, lt) || null;
      doorTurn = lt;
      doorShut = () => {
        off?.();
        lt.close();
      };
      if (!o) return;
      const what = [`sub-agents on the model each launch names, else this chat's and their cards', else ${agentName}'s own`, o.asks.length && `it may ask ${o.asks.map((a) => a.name).join(", ")} (subagents.ask)`].filter(Boolean).join("; ");
      (rec.priorChanges ||= []).push(`acp: Filament's agent and wait are ${agentName}'s for this turn: ${what}`);
    };
    /**
     * A sub-agent's turn (h1, the owner's of 11-08): the ends of the background commands it started go into its run as a
     * plain chat's reports go into its turn — beside its next tool call where its agent takes words while it works, else
     * as its next prompt within this request — and its run owes them: it neither ends nor sends its report while one of
     * them still runs (`owed`), for an hour of waiting at most (commands.js `COMMANDS_HELD_MS`). Once the run is over, an
     * end goes to the session's agent.
     * @param {string} chainId @param {string} id  the sub-agent
     */
    const openCommands = (chainId, id) => {
      const at = () => run.agent?.round() ?? 0;
      const lt = attendCommands({ session: chainId, agent: `subagent:${id}` }, { emit: (evt) => events.publish(topic, { round: at(), ...evt }), note: (text) => (rec.priorChanges ||= []).push(text) });
      doorTurn = lt;
      doorShut = () => lt.close();
    };
    /** The agent's closing words so far. */
    const closingWords = () => (run.agent?.archive().final || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text || "")).join("\n").trim();
    /**
     * A sub-agent's conversation as the registry keeps it (HarnessV4_Tasks B2), in the shape the loop's host keeps its
     * own: what it was sent, its work as the agent gave it — each call and its result — and its closing words. A
     * follow-up whose agent session is gone reads it, and a task's next worker is briefed with its calls.
     * @param {string} report  its closing words
     */
    const hostConvo = (report) => [...(Array.isArray(body.messages) ? body.messages : []), ...(run.agent?.archive().work || []), ...(report ? [{ role: "assistant", content: [{ type: "text", text: report }] }] : [])];
    /** What a conversation weighs by Filament's estimate, as an agent reading it holds it. @param {any[]} messages */
    const weighed = (messages) => estimateBodyTokens({ messages }, "conversation");
    /** The agent's own prompt and tools, which its every session holds beside what it was sent, where a start of it measured them (token-calib.js `agentOwn`); 0 where none did. */
    const agentShare = () => Number(agentOwn(upstream.id, cwdHint)?.own) || 0;
    /**
     * What the agent's context holds as a sub-agent's run ends (subagents.js `AgentHeld`): what its next message is
     * weighed against its line by (`exchangesGiveWay`). The agent's own count where it said one (`said`: its context's
     * fill as its `usage_update` says it, Codex's thread's, Cursor's meter); else its newest model call's prompt and the
     * words it closed with, where it counts its calls one by one; else Filament's estimate — on the session it went on
     * in, what that held as the exchange before ended and what this one added to it (its message, its work, its closing
     * words); on a fresh one, or with no figure before, all it was sent and did (`hostConvo`: after a give-way, from the
     * seed it began with), with the agent's own prompt and tools where known. Never a turn's usage, which counts the
     * context once for each of its calls. Null where the prompt never reached the agent and nothing gave way: its
     * session holds what it held, which the exchange before says.
     * @param {{ used?: number, size?: number, estimated?: boolean } | null | undefined} said @param {string} report
     * @returns {import("./agent/subagents.js").AgentHeld | null}
     */
    const heldNow = (said, report) => {
      const named = Number(said?.size) > 0 ? Number(said?.size) : null;
      if (Number(said?.used) > 0) return { tokens: Number(said?.used), window: named, ...(said?.estimated ? { estimated: /** @type {const} */ (true) } : {}) };
      if (!promptSent && !gaveWay) return null;
      const call = promptSent ? run.agent?.lastModelCall() : null;
      if (call) return { tokens: call.input + call.cacheRead + call.cacheWrite + estimateTokens(report), window: named, estimated: true };
      const all = hostConvo(report);
      const before = gaveWay ? null : host?.held || null;
      const sent = Array.isArray(body.messages) ? body.messages.length : 0;
      if (before) return { tokens: before.tokens + weighed(all.slice(Math.max(0, sent - 1))), window: before.window, estimated: true };
      return { tokens: weighed(all) + agentShare(), window: named, estimated: true };
    };
    /** One of the run's events, as its agent's are said: on its run, and to the registry. @param {any} e */
    const tellRun = (e) => {
      events.publish(topic, e);
      if (host) registry?.relay(host.id, e);
    };
    /** What a sub-agent's run last said of its window and its line (`sideSaid`). */
    let sideTold = "";
    /**
     * A sub-agent's run says the window Filament knows for its model and where its agent makes room by itself in the
     * middle of its work — the point its session took (`facts.point`: Claude Code's auto-compact window, Codex's
     * auto-compact limit, each handed the side agent's line) — as its session comes up, once, and again only where
     * either moved: what its card's gauge weighs its agent's count against (the owner's of 11-12: "it's token count as
     * well and also at what percentage the compaction will start out of it's context window"; subagents.js `relay`),
     * and its Run pane's line. An agent that takes no line makes room at a point of its own, which nothing says: no line
     * is said for it, and Filament's own check of the line stands between its exchanges (`exchangesGiveWay`). Nothing
     * is said where nobody knows the window and no line was taken: the window its agent names rides its counts (`held`).
     * @param {any} facts  its session's facts
     */
    const sideSaid = (facts) => {
      if (!host) return;
      const at = Number(facts?.point?.at) > 0 ? Number(facts.point.at) : null;
      if (!sideWindow && !at) return;
      const key = `${sideWindow}/${at}`;
      if (key === sideTold) return;
      sideTold = key;
      tellRun({ type: "window", window: sideWindow, source: sideKnown?.source ?? null, usable: at });
    };
    /**
     * A side agent's follow-up past its line, on a coding agent with no compaction of its own — Cursor's SDK, an ACP
     * agent other than Claude's adapter; Claude Code's `/compact` and Codex's `thread/compact/start` (`reportsCompaction`)
     * stay theirs, as each is handed the side agent's line and makes room by itself — has its earlier exchanges give
     * way before its prompt goes, as the loop's do at its first round (turn.js `exchangesGiveWay`). Past its line: what
     * the agent's context held as the newest exchange that says it ended (`host.held`; with none, Filament's copy of
     * what it was sent, weighed), and the follow-up's own message on top, at or past the side agent's line of the window
     * it named, else of Filament's for its model, else of the window assumed where nobody knows one (`sideLineOf`,
     * `ASSUMED_WINDOW`). Its run starts as it begins, and says it makes room while the summary is written. The agent
     * writes the summary first, in its session, asked as a session's Self is (`FORK_SUMMARY_INSTRUCTION`), what it
     * spent kept as the Self's is (an op) and counted in the exchange's spend; where it writes none, its own model
     * summarizes Filament's copy of the conversation in a session of its own, as the loop's transcript path does
     * (compactor.js `transcriptSummary`). Its session is then let go of, and a fresh one takes the follow-up up: its
     * first prompt one user message — the standing notes its first message carried (`host.notes`: memory's brief, its
     * work's notes, its grants), the summary (`summaryLead`), then the follow-up's own words — so nothing of any system
     * prompt moves, and the conversation the registry keeps starts from it (`hostConvo`, `gaveWay.start`). → the body
     * its prompt goes with; null where nothing gives way — a stop while the summary was written included, the prompt
     * going with the stop — and the follow-up goes on in its session as it stands.
     * @param {AbortSignal} signal
     */
    const exchangesGiveWay = async (signal) => {
      const n = host?.brief.exchange || 0;
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const ask = messages.at(-1);
      if (!host || !conversationId || n < 1 || messages.length < 2 || ask?.role !== "user" || deps.agentProfile?.(upstream.id)?.reportsCompaction) return null;
      const held = host.held || { tokens: weighed(messages.slice(0, -1)) + agentShare(), window: null, estimated: true };
      const coming = weighed([ask]);
      const known = Number(held.window) || sideWindow || 0;
      const line = sideLineOf(known || ASSUMED_WINDOW);
      if (held.tokens + coming < line) return null;
      const where = { upstream, cwdHint, conversationId };
      const of = { round: 0, earlier: true, exchanges: true, fresh: true };
      const them = n === 1 ? "its earlier exchange" : `its ${n} earlier exchanges`;
      const holds = host.held ? `${agentName}'s context held ${held.estimated ? "≈" : ""}${held.tokens.toLocaleString()} tokens as its last exchange ended` : `Filament's copy of ${agentName}'s conversation weighs ≈${held.tokens.toLocaleString()} tokens, as no exchange said what its context holds`;
      const past = `${holds} and the message ≈${coming.toLocaleString()}, past its ${line.toLocaleString()}-token line as a side agent${known ? "" : ` (of the ${ASSUMED_WINDOW.toLocaleString()}-token window assumed, as nobody knows its own)`}`;
      await openRun({ sessionId: null, cwd: cwdHint || null, rawMessages: deps.agentProfile?.(upstream.id)?.rawMessages === true });
      tellRun({ type: "compacting", ...of });
      let text = "";
      let how = "";
      /** Whether the summary is the one the agent wrote in its session. */
      let own = false;
      /** @type {string[]} */
      const why = [];
      const can = bridge.summarizes?.(where) || null;
      if (!can || !bridge.summarize) why.push(`${agentName} holds no session of it to write the summary in`);
      else
        try {
          const r = await bridge.summarize({ ...where, instruction: FORK_SUMMARY_INSTRUCTION, signal });
          summarySpent = r.usage;
          text = summaryOfReply(r.text);
          own = !!text;
          if (own) how = `reading its own session${can === "fork" ? ", in a fork of it" : ""}`;
          else why.push(`${agentName} wrote no summary in its session`);
        } catch (/** @type {any} */ e) {
          why.push(`${agentName} could not write it in its session: ${String(e?.message || e).slice(0, 200)}`);
          if (!signal.aborted) log("warn", `${rec.id} a side agent's own summary of its earlier exchanges failed (${e?.message || e}); its model summarizes their transcript instead`);
        }
      if (signal.aborted) return null;
      if (!text) {
        const model = String(body.model || "");
        const t = await transcriptSummary(memory, { gone: messages.slice(0, -1), model, window: known || ASSUMED_WINDOW, ceiling: outputCeiling(config(), model), grow: true, chainId: chainRef || null, signal });
        if (signal.aborted) return null;
        if ("error" in t) why.push(t.error);
        else {
          text = t.text;
          how = `${t.from}, in a session of its own (${why.join("; ")})`;
        }
      }
      if (!text) {
        tellRun({ type: "compaction", ...of, result: "none", error: why.join("; ") });
        (rec.priorChanges ||= []).push(`acp: ${past}, and ${them} could not give way (${why.join("; ")}): the message goes on in its session as it stands`);
        return null;
      }
      bridge.forgetByRequest({ upstream, format, body, cwdHint, conversationId });
      const words = (Array.isArray(ask.content) ? ask.content : [{ type: "text", text: String(ask.content ?? "") }]).filter((/** @type {any} */ b) => b?.type !== "tool_result");
      const notes = (host.notes || []).map((t) => ({ type: "text", text: t }));
      const start = [{ role: "user", content: [...notes, { type: "text", text: summaryLead(1, n, text) }, ...words] }];
      gaveWay = { start };
      const summary = estimateTokens(text);
      // What the agent spent writing it in its session, as the session's own Self keeps it (compactor.js `run`): an
      // op's detail keeps flat figures only.
      const u = own ? summarySpent : null;
      if (u)
        deps.ops?.record("compaction", `sub-agent ${host.id}: ${them} summarized by ${agentName}, itself, in its own session`, {
          sub: "subagent",
          detail: { chainId: chainRef || null, agentId: host.id, exchanges: n, chars: text.length, model: String(body.model || ""), how: can === "fork" ? "agent-fork" : "agent", inputTokens: u.input, outputTokens: u.output, cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite },
          ref: { requestId: rec.id },
        });
      tellRun({ type: "compaction", ...of, fromTurn: 1, toTurn: n, method: "summary", tokensBefore: held.tokens, summary });
      const cost = u ? `; writing it read ${(u.input + u.cacheRead + u.cacheWrite).toLocaleString()} tokens and wrote ${u.output.toLocaleString()}` : "";
      (rec.priorChanges ||= []).push(`acp: ${past}: ${them} summarized by ${agentName}, itself, ${how} (≈${summary.toLocaleString()} tokens${cost}), and its session let go of — a fresh one takes the message up from that summary${notes.length ? ", after the notes its first message carried" : ""}`);
      return { ...body, messages: start };
    };
    /**
     * What a sub-agent's run spent beyond its turn: the summary its agent wrote in its session, or tried to, as its
     * earlier exchanges were to give way (`summarySpent`) — its tokens as the agent counted them, and their price as a
     * turn's are priced. Nothing where it was asked for none.
     * @param {any} account  the agent's word on who it ran as, the turn's
     */
    const summarySpend = (account) => {
      const u = summarySpent;
      if (!u) return { tokensIn: 0, tokensOut: 0, usd: 0 };
      return { tokensIn: u.input + u.cacheRead + u.cacheWrite, tokensOut: u.output, usd: spendOf({ usage: u, costUnseen: true, account }).cost ?? 0 };
    };
    /** The seed a give-way began the conversation from (`gaveWay.start`), for the registry: nothing where none did. */
    const seedFinish = () => (gaveWay ? { start: gaveWay.start } : {});
    /** The agent's turn, or a Force stop's end of it: the turn's work as far as it went (the loop's F2 item 13). */
    const orForced = async (/** @type {Promise<any>} */ pending) => {
      // The bridge lets go of the agent on the same force, and its turn then fails as let go: that is the force's end.
      const r = await Promise.race([pending.catch((e) => (forceCtl.signal.aborted ? forcedStop : Promise.reject(e))), forcedStop]);
      if (r !== "forced") return r;
      forced = true;
      return {
        notes: [`acp: the developer force-stopped the turn; Filament did not wait for ${agentName} to end it`],
        stopReason: "cancelled",
        sessionId: runSession.sessionId,
        cwd: runSession.cwd,
        reused: true,
        seeded: false,
      };
    };

    // Input token count, always Filament's own local estimate — no provider is ever contacted for a count: the
    // conversation leaving for a third party only to be counted would be an exfiltration trap. The plain
    // class-weighted one: an agent's upstream is never calibrated, and one that states no usage names no model to
    // borrow a factor from (services/token-calib.js). Its how-string prints only for an agent that states no usage — a
    // reporting agent's how is nulled below, its count is its own.
    const estMode = acp.inputTokenEstimate || "conversation";
    const countPromise = Promise.resolve({
            n: estimateBodyTokens(body, estMode),
            how: estMode === "none" ? null : `estimated from the ${estMode} (the local class-weighted estimate; this agent reports no usage)`,
          });
    // Chat commands answered by Filament itself (commands/acp.js): /sessions, /resume <id>, /new, /status and the rest.
    const lastUserText = (
      flattenMessages(format, body)
        .filter((m) => m.role === "user")
        .at(-1)?.text || ""
    ).trim();
    // They are a harness session's alone: an outside client's `/status` or `/sessions` goes to its agent as typed. A
    // turn of the agent's own is no client's request: never a command, housekeeping, or a word to the agent; nor is a
    // sub-agent's brief, whatever it opens with.
    const cmd = !session || toolResults.length || ownCycle || host || ownCall ? null : parseAgentCommand(lastUserText);
    /** @type {string | null} */
    let localReply = null;
    /** @type {string | null} */
    let localNote = null;
    // Tool results for a turn Filament no longer has (it restarted, or waited too long for the client): say so, in words.
    if (toolResults.length && !liveTurn) {
      localReply = `_filament: the ${agentName} turn that asked for this has already ended (Filament restarted, or the answer came after ${acp.clientWaitMinutes || 60} minutes). Nothing was lost on disk; send your next message to continue in the same session._`;
      localNote = `acp: ${toolResults.length} tool result(s) arrived for a turn Filament no longer has (${toolResults.map((r) => r.id.slice(-6)).join(", ")}); answered in words`;
    }
    // Housekeeping requests (a client asking its model for a session title) must not become agent tasks: answered here,
    // or handed to a cheap API model through Filament's own front door when acp.housekeepingModel names one.
    const hk = acp.housekeeping === "agent" || toolResults.length || ownCycle || host || ownCall ? null : detectHousekeeping(format, body);
    if (
      hk &&
      acp.housekeeping === "model" &&
      acp.housekeepingModel &&
      !inboundHeaders["x-filament-housekeeping"]
    ) {
      const target = acp.housekeepingModel;
      try {
        const r = await loopbackPost(
          `${selfBase()}${format === "anthropic" ? "/v1/messages" : "/v1/chat/completions"}`,
          {
            headers: {
              "content-type": "application/json",
              ...houseAuth(),
              "user-agent": "filament-housekeeping/0.1",
              "x-filament-housekeeping": "1",
            },
            body: JSON.stringify({ ...body, model: target }),
            signal: clientAbort.signal,
          },
        );
        rec.changes.push(
          `acp: ${hk.kind} request from the client (housekeeping, not a conversation) sent to ${target} instead of ${agentName}`,
        );
        Object.assign(rec, { upstreamModel: target, url: `Filament://housekeeping/${target}` });
        res.writeHead(r.status, {
          "content-type": r.headers.get("content-type") || "application/json",
          ...wire.extra,
        });
        if (r.body) for await (const chunk of /** @type {any} */ (r.body)) res.write(chunk);
        res.end();
        finish(
          rec,
          {
            status: r.ok ? "ok" : "error",
            httpStatus: r.status,
            local: true,
            error: r.ok ? undefined : `housekeeping model ${target} answered HTTP ${r.status}`,
            tokens: { ...rec.tokens, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 },
            estimatedTokens: false,
            cost: 0,
          },
        );
        return;
      } catch (/** @type {any} */ e) {
        rec.changes.push(
          `acp: housekeeping model ${target} could not be reached (${e.message}); answered locally instead`,
        );
      }
    }
    if (hk && hk.kind === "title") {
      localReply = makeTitle(hk.source, { json: hk.wantsJson });
      localNote = `acp: session-title request from the client answered by Filament (${JSON.parse(makeTitle(hk.source)).title}); agent not called`;
    } else if (hk) {
      localReply = makeSummary(format, body);
      localNote = `acp: ${hk.kind} request from the client (housekeeping) answered by Filament with a trimmed transcript; set acp.housekeepingModel for a written summary. It never reaches ${agentName}: a housekeeping request waiting behind a live agent turn would deadlock the chat`;
    }
    // A folder outside the roots (`fence` above), or one that is gone — a worktree removed, which its chat still names:
    // nothing of the agent's starts there, a command's neither, never in the folder the agent would fall back on (the
    // home folder, `determineCwd`). The tool results its running turn waits for go on: that turn began where it works.
    const refusedFolder = (fence?.why === "outside" || fence?.why === "missing") && !continuing ? folderRefusalOf(config(), String(cwdHint), fence) : null;
    if (refusedFolder && !localReply) {
      localReply = refusedFolder.text;
      localNote = `acp: refused — ${refusedFolder.note}; ${agentName} was not called`;
    }
    // Their chat without Full control works only where their fence lets a chat start (deps.js `agentsFolder`), judged at
    // each turn: one started under Full control in a folder the fence refuses works there no more once it is off.
    const fencedOut = fenced && !ownCall && !continuing && cwdHint ? (deps.agentsFolder?.(String(cwdHint), agentDevice) ?? null) : null;
    if (fencedOut && !localReply) {
      localReply = fencedFolderWords(fencedOut);
      localNote = `acp: refused — another machine's agents' chat, fenced, in a folder their fence refuses; ${agentName} was not called`;
    }
    // any other /command, an outside client's every one: passed to the agent; note whether the agent has published it
    if (!cmd && !ownCycle)
      noteForeignCommand({
        rec,
        bridge,
        upstream,
        format,
        body,
        inboundHeaders,
        conversationId,
        lastUserText,
        outside: !session && !host && !ownCall,
      });
    if (cmd && !refusedFolder) {
      const answer = await answerAgentCommand(deps, {
        cmd,
        rec,
        bridge,
        upstream,
        acp,
        format,
        body,
        inboundHeaders,
        route,
        modelId,
        agentName,
        conversationId,
        chain: chainRef,
        res,
        onEvent,
      });
      if (answer.error) {
        // the agent could not even be started or asked: close the record like any other failure, or it stays "pending" forever
        log("warn", `${rec.id} /resume failed: ${answer.error}`);
        sendJson(
          res,
          502,
          errorBody(format, 502, `Could not attach to session \`${cmd[2]}\`: ${answer.error}`),
          wire.extra,
        );
        finish(
          rec,
          { status: "error", httpStatus: 502, error: `/resume failed: ${answer.error}` },
        );
        return;
      }
      localReply = answer.reply;
      if (answer.note) localNote = answer.note;
      if (answer.intro) onEvent({ type: "text", text: answer.intro });
      if (answer.body) body = answer.body;
    }
    /** @type {any} */
    let result;
    /** The facts of each of the turn's prompts its agent answered, as their bridge handed them back. @type {any[]} */
    const answered = [];
    /** Whether the agent's turn failed: what it carried may never have reached the agent. */
    let agentFailed = false;
    // The person's message goes to the agent now — no command Filament answered above, nor a client's results handed
    // back: a chat's name may be read from it (memory's `messageSent`, app/chat-namer.js).
    if (!localReply && !continuing && mem?.prep?.chain && mem.prep.turn) /** @type {any} */ (memory).messageSent?.(String(mem.prep.chain), Number(mem.prep.turn));
    if (localReply) {
      onEvent({ type: "text", own: true, text: localReply });
      result = {
        notes: [
          localNote ||
            `acp: chat command ${/** @type {RegExpExecArray} */ (cmd)[0].trim()} answered by Filament, agent not called`,
        ],
        stopReason: "end_turn",
        sessionId: null,
        cwd: null,
        reused: false,
        seeded: false,
      };
    } else
      try {
        // A change that waits long in this turn with nothing said of it is weighed from its start (`stepWords`). The
        // turn's record begins here, where its end below lets go of it (`over`) by every road out: a message Filament
        // answers itself asks the agent nothing, and has none.
        if (openFor && memChain) openFor.begin(memChain);
        if (worktreesListed) worktreeReads = await worktreesListed;
        if (continuing) {
          // The client ran the tool Filament asked for; hand the results to the waiting agent and stream the rest of its turn here.
          (rec.priorChanges ||= []).push(
            `acp: continued the agent's turn with the client's result(s) for ${toolResults.map((r) => r.id.slice(-6)).join(", ")}`,
          );
          void openRun({ sessionId: liveTurn.sessionId, cwd: liveTurn.conv?.cwd || null, rawMessages: !!liveTurn.rawMessages }, () => liveTurn.cancel?.());
          const r = await orForced(bridge.resume({ turn: liveTurn, results: toolResults, onEvent: take, signal: clientAbort.signal }));
          for (const a of r.settled || [])
            rec.priorChanges.push(`acp: client ran ${a.name} for the agent (${a.kind})`);
          result = forced ? r : r.res;
        } else {
          if (liveTurn && !liveTurn.done) {
            const it = await bridge.interrupt(liveTurn, "the user sent a new message");
            (rec.priorChanges ||= []).push(
              `acp: the previous turn was still waiting for the client (${it.cancelledActions} action(s)); it was cancelled because a new message arrived`,
            );
          }
          // The previous turn's buffered output is the AGENT's own words, so it is always delivered; only Filament's
          // prose label around it is gated. The rule that follows is structure, not commentary — it is what a chat
          // client renders as a divider and models do not imitate it — but it is emitted only when the drain actually
          // produced something visible. A buffer holding nothing but invisible events (notes, usage, config) would
          // otherwise leave a stray divider hanging in the reply with nothing above it.
          if (liveTurn && liveTurn.buffer.length) {
            if (sayMeta)
              onEvent({
                type: "text",
                own: true,
                text: `_filament: from ${agentName}'s previous turn, while it waited for the client:_\n`,
              });
            // Measured across text AND thoughts: a buffered thought is still buffered (not yet in col.text) at this
            // point, and a `hide` thought will never become visible, so both cases are counted correctly.
            const visible = () => col.text.length + (thoughtsMode === "hide" ? 0 : col.thought.length);
            const hadVisible = visible();
            const n = bridge.drain(liveTurn, onEvent);
            (rec.priorChanges ||= []).push(
              `acp: ${n} buffered event(s) from the previous turn delivered first${sayMeta ? "" : " (unlabelled in the reply, separated by a rule — acp.hints adds the label)"}`,
            );
            if (visible() !== hadVisible) onEvent({ type: "text", own: true, text: "\n---\n" });
          }
          const signal = AbortSignal.any([clientAbort.signal, stopCtl.signal]);
          const prompted = {
            upstream,
            modelId,
            format,
            body,
            cwdHint,
            headers: agentHeaders,
            onEvent: take,
            signal,
            force: forceCtl.signal,
            mode: modeOverride,
            conversationId,
            effort: acp.effortTemplate ? null : effort,
            resumeSessionId,
            clientTools,
            mcpBase: selfBase(),
            // A sub-agent's run is judged by its session's switch under its own mode, its permission questions the
            // developer's on its lead's timeline (AC6-1); a team's lead's under the chat's switch (decision 9).
            // The words of a no to a worker's call — the developer's or its lead's — go into its run as a note: its
            // agent hears only a reject (HarnessV3-TaskGraph-v2 TG2-D41). Every other turn of a harness chat, its
            // page's or not, answers to the chat's switch, its questions waiting on its run as the page's do; one sent
            // unattended has nobody to ask (HarnessV4_Overnight_Plan OV-D32 to OV-D34).
            asks,
            asker: harness ? askPage : host && registry ? workerAsker(registry, host, runs ? (text, from) => runs.steer(rec.id, { kind: "note", text, from }) : null) : chatTurn ? (unattended ? askNobody : askPage) : null,
            permits: chatTurn || host || leadTeam ? sessionPermits() : ownCall ? READS_ONLY() : null,
            // The harness chat the turn runs in: the agent's own turns show there (AC3-9).
            chain: chatTurn ? chainRef : null,
            toolsAt,
            reseed,
            // A window the agent names as it refuses a prompt for size is its model's from now on, as one named at a
            // turn's end is (HarnessV4_Tasks C33).
            windowSaid: (/** @type {number} */ tokens) => deps.noteAgentWindow?.(upstream.id, windowName, tokens),
          };
          // One prompt of the turn's to the agent: a lead's workers' reports go into it as they land (AC6-4). Once it
          // has ended there is no way into it: what comes meanwhile waits for the next one.
          const prompt = (/** @type {any} */ b) => {
            // The first carries memory's blocks for the person's words and the list of the envelopes still sealed; the rest
            // go without (EN-D6).
            // A sub-agent's turn, which no chat shows a cycle of its agent's own, waits for the background tasks its agent
            // left running and reads its answer to their end (the owner's D3 of 11-09), as long as its run waits for its
            // background commands: one bound for the run, from its first wait, whichever prompt waits.
            const tasksHeldMs = !host ? 0 : tasksUntil == null ? COMMANDS_HELD_MS : Math.max(0, tasksUntil - Date.now());
            // What the chat's copy says to dismiss is said only to an agent with the envelope tool (`dismissOk`).
            // A prompt that ended without failing reached the agent, whatever it said — but one a Force stop gave up on,
            // and one that failed, which leaves what it carried to be said again (`reachedNow`).
            const p = orForced(bridge.run({ ...prompted, tasksHeldMs, context: firstContext || laterContext, body: bodyWithDismiss(b, dismissOk) })).then(
              (r) => {
                if (!forced) reachedNow();
                return r;
              },
              (e) => {
                reaching = false;
                throw e;
              },
            );
            firstContext = null;
            if (doorTurn) void pumpReports(doorTurn, p);
            return p.finally(() => {
              tasksWait = false;
              steerTo(null);
              // A compaction the agent never said the end of ends with its prompt: the next one is not held for it.
              compacting?.release();
              // The session a call of Filament's own made is let go of with the call: closed where its agent closes one.
              if (ownCall) bridge.forgetByRequest({ upstream, format, body: b, cwdHint, conversationId });
            });
          };
          // A side agent's follow-up past its line, on an agent with no compaction of its own, makes room first: a fresh
          // session takes it up from the summary (`exchangesGiveWay`).
          if (host && !ownCycle) body = (await exchangesGiveWay(signal)) || body;
          // A turn the agent began by itself holds the door too (the owner's list of 11-08: an agent woken by its own
          // background work was refused Filament's agent and wait, for want of a turn of the person's): it is a whole
          // turn of the chat — the lock, the Stop, the session's switch — and what its sub-agents send goes into it. A
          // lead's holds its team's (the owner's of 11-09: its worker was refused there, its wait the wrong one).
          if (leadTeam && memChain) openLead(leadTeam, memChain);
          else if (offer && !leadTeam && memChain) openLaunch(launchOffer, memChain);
          // A sub-agent's run hears its own background commands and stays open for them (h1).
          else if (host && memChain) openCommands(memChain, host.id);
          if (ownCycle && bridge.listen) {
            const p = orForced(
              bridge.listen({
                upstream,
                sessionId: ownCycle.sessionId,
                onEvent: take,
                signal,
                force: forceCtl.signal,
                asks,
                asker: harness ? askPage : null,
                permits: harness ? sessionPermits() : null,
                toolsAt,
                // Where the cycle sits in the chat's history: past the turns the chat had with another model since, which
                // its session still owes.
                place: ownCycle.place ?? null,
              }),
            );
            if (doorTurn) void pumpReports(doorTurn, p);
            result = await p;
          } else result = await prompt(body);
          answered.push(result);
          // What the turn still owes goes to the agent as its next prompt, in the same session and run, within this
          // request (AC6-1, AC6-D4), after the turn so far; the turn is the prompts' together.
          for (let words = ownCycle ? null : await owed(result); words; words = await owed(result)) {
            const asked = followedBody(body, run.agent?.archive() || { work: [], final: [] }, words);
            run.agent?.prompted(words);
            const next = await prompt(asked);
            answered.push(next);
            result = joinTurns(result, next);
          }
        }
      } catch (/** @type {any} */ e) {
        agentFailed = true;
        const aborted = requestWasAborted(e, clientAbort);
        // A compaction of the agent's own that kept refilling is said in Filament's words, with the point it makes room at
        // (Claude Code's: the line it was handed, within the auto-compact windows it takes); its own under them.
        const handed = lineOf(agentHeaders);
        const { said: failed, detail } = thrashWords(e, { who: agentName, line: handed ? claudeCompactWindow(handed).at : null, window: Number(run.facts?.context?.size) || null, chat: !host }) || failureWords(e, lastStep);
        // What the agent reported the turn spent before it failed: what the prompts it answered spent (`result`, joined as
        // a finished turn's prompts are), and the failing prompt's own by its facts — a prompt that failed before its
        // session began left the last answered one's in place. A turn that failed before any began says in its failure
        // what the agent spent that it never showed (`facts`: a cycle of the agent's own whose process ended first).
        const failing = run.facts ? (answered.includes(run.facts) ? null : run.facts) : (e?.facts ?? null);
        const spentFacts = result && failing ? joinTurns(result, failing) : result || failing;
        // The model that answered what the turn got done, where it is not the turn's: its record keeps it.
        weighModel(spentFacts, { quiet: true });
        const spent = spentFacts?.usage || null;
        // Priced as a finished turn's: its run's end, its report to whoever launched it and its record say it.
        const costs = spent ? spendOf(spentFacts) : null;
        const costSaid = costWhy(spentFacts);
        log(
          aborted ? "info" : "warn",
          `${rec.id} acp ${upstream.id}: ${aborted ? "client disconnected" : e.message}`,
        );
        // Flush the buffered thought FIRST. It is real agent output and must be delivered, and flushing it also opens
        // the stream — which matters because every branch below keys off `headersSent`. Because thoughts are buffered
        // into runs, an agent that thinks and then dies may not have written a single byte yet; without this the user would
        // get a bare SSE error event instead of the sentence explaining what happened.
        flushThought();
        // The harness says a failure once, in the banner it draws from the stream's error (with Retry); an outside
        // client may draw no stream error, so its reply says it.
        if (!aborted && wire.headersSent && !harness) ownLine(`${agentName} failed: ${failed}`);
        if (stream) await wire.flushPaced();
        // The run's end counts what the turn spent, as a finished turn's does: what the agent reported, and what its team
        // spent.
        const turnCost = Math.round(((costs?.cost ?? 0) + launchedSpent()) * 1e6) / 1e6;
        await endRun(aborted ? "aborted" : "failed", { error: String(failed).slice(0, 160), ...(spent ? { inputTokens: spent.input, outputTokens: spent.output } : {}), ...(turnCost ? { childCostUsd: turnCost } : {}) });
        // What the failure says of the agent's account (HarnessV3-TaskGraph-v2 TG2-D54), read with what its plan's
        // windows say now: a sub-agent's run carries it to its lead, and a wall holds the agent as one that cannot serve.
        const account = aborted || ownCycle ? null : deps.agentAccount?.(upstream.id) ?? null;
        const cause = aborted || ownCycle ? null : agentCause(e, account, modelId);
        // A sign-in the agent asks for says nobody is signed in there (app/agent-logins.js `turnSaid`); an allowance used
        // up, or a session or file it may not open, says nothing of it.
        if (!aborted && !ownCycle && saysSignedOut(e)) deps.agentSignIn?.(upstream.id, false, String(failed));
        // What the agent's context held when it was last heard from (HarnessV4_Tasks B1): its session still holds that.
        const heldAt = run.facts?.context || null;
        // A sub-agent's failed run reports what it did before it failed (HarnessV4_Tasks B2): its calls, which the
        // run's end has closed, and its last words — and, where it failed on its account, why, in one shape — and what
        // its context held, its next message's line is weighed by.
        if (host) {
          const report = closingWords();
          const counts = run.agent?.counts();
          const shaped = cause ? worded({ what: `${agentName}'s turn`, where: upstream.id, said: String(failed).slice(0, 300), code: null, status: null, tries: null, began: null, at: Date.now(), streamed: null, kept: null, next: null, cause: { kind: cause.kind, provider: upstream.id, resets: cause.resets } }) : null;
          const extra = summarySpend(spentFacts?.account);
          registry?.finish(host.id, { status: aborted ? "aborted" : "failed", error: String(failed).slice(0, 300), report, convo: hostConvo(report), rounds: counts?.rounds || 0, toolCalls: counts?.tools || 0, tokensIn: (spent ? spent.input + spent.cacheRead + spent.cacheWrite : 0) + extra.tokensIn, tokensOut: (spent?.output ?? 0) + extra.tokensOut, spentUsd: (costs?.cost ?? 0) + extra.usd, roundIds: [rec.id], taskReport, held: heldNow(heldAt, report), ...seedFinish(), ...(shaped ? { failure: shaped } : {}), ...answeredFinish(spentFacts) });
        }
        const kindName = dest.label;
        // The failure by its kind (HarnessV3-ACP AC0-3), on the agent's health here, once: a prompt it refused, or
        // one too long for its context, says nothing about its health and cools nothing, and the client is told
        // when sending the request again as is cannot help.
        // A turn of the agent's own never judges its health: a cycle it ran by itself is no reason to keep the
        // person's next message from it (AC3-9).
        const failure = aborted || ownCycle ? null : classifyFailure(e);
        if (ownCycle) rec.healthRecordedFor = upstream.id;
        /** @type {string[]} */
        const said = [];
        if (failure) {
          said.push(
            `acp: ${upstream.id} failed (${failure.kind}: ${failure.retryable ? "retryable" : "not retryable as sent"}${failure.cools ? "" : "; no cooldown"})`,
          );
          const h = health.recordFailure(upstream.id, { message: e.message, retryable: failure.cools });
          rec.healthRecordedFor = upstream.id;
          if (h.cooledDown) {
            said.push(
              `health: ${upstream.id} cooling down ${Math.round(h.waitMs / 1000)} s after ${h.failures} failure(s)`,
            );
            log("warn", `${upstream.id} cooling down for ${Math.round(h.waitMs / 1000)} s (${h.failures} failure(s))`);
          }
        }
        // An agent whose account cannot serve is held as such (TG2-D54): the pool skips it until its window resets, a
        // turn there succeeds, or it is fixed. Held with whom it said it runs as: only another sign-in is a fix. An
        // allowance used up on a model its plan meters apart (Antigravity's groups) is that group's: the agent still
        // serves its other models, and is not held.
        if (cause?.kind === "out" && meteredApart(account, modelId)) said.push(`health: ${upstream.id} not held: its plan meters ${modelId} apart, and its other models may still have room`);
        else if (cause && isWall(cause)) {
          const w = health.noteWall(upstream.id, { kind: cause.kind === "out" ? "out" : "account", said: String(failed), status: null, resets: cause.resets, as: account?.identity ?? null });
          said.push(`health: ${wallWords(w, upstream.id)}`);
          log("warn", `${rec.id} health: ${wallWords(w, upstream.id)}`);
        }
        if (!wire.headersSent && !aborted && !isLast && !col.text) {
          (rec.priorChanges ||= []).push(
            ...said,
            `acp: ${upstream.id} failed before output (${failed}); trying fallback`,
          );
          rec.changes = [...rec.priorChanges];
          // What it spent before it failed, where the agent reported any: its attempt's own record, beside the request's
          // (pipeline/stages/dispatch.js), while the next candidate serves — its newest model call with it (`call`), and
          // why its cost is not the agent's own figure, where it is not (`changes`).
          const attempt = spent
            ? { upstream: upstream.id, upstreamModel: modelId, error: failed, tokens: { input: spent.input, output: spent.output, cacheRead: spent.cacheRead, cacheWrite: spent.cacheWrite, ...(spent.cacheSeen ? { cacheSeen: true } : {}) }, ...costs, acp: acpBlock({ ...factsOf(spentFacts), sessionId: run.facts?.sessionId ?? e.sessionId ?? null }), call: run.agent?.lastModelCall() || null, ...(costSaid ? { changes: [costSaid] } : {}) }
            : null;
          return { failedEarly: true, error: `${kindName} "${upstream.id}" failed: ${failed}`, reason: failed, detail, ...(attempt ? { spent: attempt } : {}) };
        }
        (rec.changes ||= []).push(...said);
        if (costSaid) rec.changes.push(costSaid);
        const otherSaid = otherRecord();
        if (otherSaid) rec.changes.push(otherSaid);
        // One whose account is signed in but whose plan or credit refused it says so (`signedIn`): its banner keeps its
        // own words, not the sign-in's (the review of 11-19).
        if (failure) rec.failure = { kind: failure.kind, retryable: failure.retryable, ...(failure.kind === "auth" && saysPlanRefused(e) ? { signedIn: true } : {}) };
        // What the agent's context held (`heldAt`): the record says it as a finished turn's does, and the session's line
        // is read against it.
        if (Number(heldAt?.used) > 0)
          rec.context = {
            ...(rec.context || {}),
            ...(Number(heldAt.size) > 0 ? { window: Number(heldAt.size), source: "agent" } : {}),
            usable: null,
            verdict: null,
            last: { held: Number(heldAt.used), ...(heldAt.estimated ? { estimated: true } : {}) },
          };
        // A harness chat's turn that failed after doing work stays in the history, as the loop's does (HarnessV4_Tasks
        // B1): its work as the agent gave it, every call answered (the run's end cut those still open), and why it
        // failed with its closing words, which the next turn reads as its reply (`modelTurnsOf`) and a fresh agent
        // session's seed carries. One that did nothing drops out, and Retry sends it again; a hang-up is no failure of
        // the turn. A sub-agent's conversation is the registry's.
        if (!aborted && chatTurn && run.agent && mem?.prep?.turn) {
          try {
            const own = run.agent.archive();
            if (own.work.length) {
              const closing = closingWords();
              memory.archive?.addWork?.(mem.prep.turn, own.work);
              memory.archive?.mergeTurnMeta?.(mem.prep.turn, { failed: { at: Date.now(), cause: String(failed), ...(closing ? { text: closing } : {}) } });
              followCompaction(own, mem.prep);
            }
          } catch (/** @type {any} */ err) {
            log("warn", `${rec.id} the failed turn's work was not kept: ${err.message}`);
          }
        }
        if (!wire.headersSent) {
          const body = errorBody(format, 502, `${kindName} "${upstream.id}" failed: ${failed}`);
          sendJson(
            res,
            502,
            detail ? { ...body, error: { ...body.error, detail } } : body,
            failure?.retryable === false ? { ...wire.extra, "x-should-retry": "false" } : wire.extra,
          );
        } else wire.endWithError(failed, detail);
        // What the agent reported the turn spent before it failed stays on the record, as a finished turn's does: its
        // tokens and its figure, and the models that counted them (`factsOf`). A turn that failed after real model calls
        // is in the chat's spend, its /cost and its cache line — its newest model call the session's last request, as a
        // finished turn's is (a `_` field, which the store keeps from every client).
        rec._lastModelCall = spent ? run.agent?.lastModelCall() || null : null;
        finish(
          rec,
          {
            status: aborted ? "aborted" : "error",
            httpStatus: wire.headersSent ? 200 : 502,
            error: aborted ? "client disconnected" : failed,
            ...(detail && !aborted ? { errorDetail: detail } : {}),
            ...(spent
              ? {
                  tokens: { ...rec.tokens, input: spent.input, output: spent.output, cacheRead: spent.cacheRead, cacheWrite: spent.cacheWrite, ...(spent.cacheSeen ? { cacheSeen: true } : {}) },
                  estimatedTokens: false,
                  ...costs,
                }
              : {}),
            acp: acpBlock({ ...factsOf(spentFacts), sessionId: run.facts?.sessionId ?? e.sessionId ?? null }),
          },
        );
        return;
      } finally {
        stepsDone();
        // The door closes with its turn; the sub-agents it launched run on, their reports for the session's next turn
        // (AC6-6).
        /** @type {(() => void) | null} */ (doorShut)?.();
        // What no answer of Filament's carried to an agent that takes words only once a step ended goes with the turn —
        // but what comes back after its compaction, which waits for its next turn's start (`stepWords`).
        if (memChain && !host) deps.toolTails?.drop(memChain);
        openEnded(agentFailed);
        planEnded();
        // The turn is over, however it ended: Still open weighs a long wait in a running turn alone (`over`).
        if (openFor && memChain) openFor.over(memChain);
        // A turn that ended on its own leaves each task of the planner's own still running idle where nothing is at work
        // on it, Filament's commands for the chat and a come-back the chat has set among what is (d-idle), as the loop's
        // does: its next start says so. A task the agent runs by itself in the background — Claude's command or agent,
        // whose end begins a turn of its own — is at work too (the review of 11-11: its turn was said to have left
        // nothing at work while its own command ran on).
        if (!agentFailed && !host && !ownCycle && !handedBack && graphOn && graphs && memChain && !stopCtl.signal.aborted && !clientAbort.signal.aborted)
          graphs.turnEnded(memChain, { commands: runningShellsOf(memChain).length > 0 || (deps.agentTasks?.(memChain) || []).some((t) => t.background !== false), comeBack: !!comeBackOf(memChain) });
        // A sub-agent's exchange is over, however it ended: its agent lets go of the session, so nothing of the agent's
        // stands in the sub-agent's worktree when its work is captured and the folder goes. A follow-up opens the
        // same session again. Where the bridge has a session to let go of.
        if (host) await bridge.restByRequest?.({ upstream, format, body, cwdHint, conversationId });
      }
    // The developer's stop (HarnessV3-ACP AC1-1): the agent cancelled its turn on the run's stop, or a Force stop ended
    // it. The turn ends in the stop's words, as the loop's does: the notice first, so a page reading the run beside the
    // reply knows the block before it lands, then the note as the reply's last block. A stop that came as the agent
    // ended its turn anyway stays unread, and the run's end says so; one that ended the agent's wait for its sub-agents is
    // the turn's.
    /** @type {{ by: string, forced: boolean } | null} */
    let stoppedBy = null;
    if (run.mailbox && stopCtl.signal.aborted && !clientAbort.signal.aborted && (forced || result?.stopReason === "cancelled" || waitStopped)) {
      const m = run.mailbox.read((x) => x.kind === "stop")[0] || { text: "", from: "harness" };
      stoppedBy = { by: String(m.from || "harness"), forced };
      const n = run.agent?.counts().tools || 0;
      // Whose stop it was: a worker's lead, Filament once another attempt at its brief won (TG2-D53), or the developer.
      const { who, what } = whoseStop(m.from);
      const note = `(Filament: ${who} ${forced ? "force-stopped" : "stopped"} this ${what} after ${n} tool call${n === 1 ? "" : "s"}${m.text ? ` — "${String(m.text).slice(0, 400)}"` : ""}; ${collector.agentChars ? "what was finished is above" : "no reply had been written yet"}.)`;
      events.publish(topic, { type: "notice", kind: "stop", text: note, ...(m.text ? { quoted: true } : {}) });
      collector.breakBlock();
      const apart = harness || !col.text || col.text.endsWith("\n\n") ? "" : col.text.endsWith("\n") ? "\n" : "\n\n";
      onEvent({ type: "text", own: true, text: apart + note });
      // A lead's open task graph is held below, and the workers at its tasks stopped.
      const led = ledGraph ? graphs?.get(ledGraph) : null;
      const holds = !!led && !led.closed;
      if (!forced) (rec.priorChanges ||= []).push(waitStopped ? `acp: the developer stopped the turn while ${agentName} waited for ${leadTeam ? "its workers" : "Filament's sub-agents"}, ${holds ? "its task graph held and the workers at its tasks stopped; the others run on" : "who run on"}` : `acp: the developer stopped the turn; ${agentName} cancelled it`);
    }
    // The agent needs the client's hands: this reply ends with the tool call; the turn waits for the next request.
    /** @type {any} */
    let action = null;
    /** @type {any} */
    let actionTurn = null;
    /** @type {any[]} */
    let actions = [];
    if (result && result.clientAction) {
      action = result.clientAction;
      actions = result.clientActions || [action];
      actionTurn = result.turn;
      const seen = actionTurn.notesSeen || 0;
      const fresh = (actionTurn.notes || []).slice(seen);
      actionTurn.notesSeen = (actionTurn.notes || []).length;
      result = {
        structured: (actionTurn.structured || []).filter((s) => s.at >= seen),
        notes: [
          ...fresh,
          `acp: ${agentName} needs the client's ${[...new Set(actions.map((a) => a.kind))].join(", ")}: asked the client to run ${actions.map((a) => a.name).join(", ")}${actions.length > 1 ? ` (${actions.length} calls in one reply)` : ""}; the turn continues when the client answers`,
        ],
        stopReason: "tool_use",
        sessionId: actionTurn.sessionId,
        cwd: actionTurn.conv?.cwd || null,
        reused: true,
        seeded: false,
        resumed: false,
        title: actionTurn.conv?.title || null,
        bridge: actionTurn.bridgeEffective ?? null,
        steering: !!actionTurn.conv?.steering,
      };
    } else if (continuing && !forced && result && Array.isArray(result.notes))
      result = {
        ...result,
        notes: result.notes.slice(liveTurn.notesSeen || 0),
        structured: (result.structured || []).filter((s) => s.at >= (liveTurn.notesSeen || 0)),
      };
    // The developer's Stop of a lead holds the task graph its team runs and stops the workers at its tasks, as the loop's
    // does (G2-8); a hang-up is no stop, and the work goes on.
    if (ledGraph && stoppedBy && !action) graphs?.stop(ledGraph);
    sayWaited();
    rec.changes = [...(rec.priorChanges || []), ...result.notes];
    const structured = [...(rec._priorNotes || []), ...(result.structured || []).map((s) => s.note)];
    if (structured.length) rec.notes = structured;
    if (effortNote) rec.changes.push(effortNote);
    // Filament's own voice, gated by `sayMeta` (defined with the renderer settings above). The CALLER decides whether
    // to speak — by passing text or null — because some cases must be said regardless of the setting (a turn that
    // failed with nothing to read). This helper only renders the decision and makes sure the record always has it.
    const meta = (text, note) => {
      if (note) (rec.changes ||= []).push(note);
      if (text) ownLine(text);
    };
    // A plan the person sent back ends the turn with the agent's cancel (HarnessV3-ACP AC3-3): the turn did as they
    // said.
    if (result.planBack) meta(null, `acp: stop reason cancelled — the person sent the plan back, and ${agentName}'s adapter ends its turn then`);
    const stopWords = action || stoppedBy || result.planBack ? null : describeStopReason(result.stopReason, agentName, { harness: chatTurn });
    // When Filament may explain an unusual stop reason in the reply itself:
    //   • the turn FAILED (refusal, cancelled) — there is no answer to read, and most chat clients do not surface the
    //     mapped stop reason, so without a sentence the user just sees silence or a stray tool line;
    //   • or the agent left no text at all;
    //   • or hints are on.
    // A turn that merely ran long (max_tokens, max_turn_requests) produced a real reply that was cut short, and the
    // wire already carries `length`, so appending a paragraph there is chatter that lands in the client's permanent
    // context — the kind of note `acp.hints` off exists to keep out.
    const turnFailed = result.stopReason === "refusal" || result.stopReason === "cancelled";
    // The AGENT's own words, not `col.text`: that also holds Filament's tool narration, inline 💭 quotes and the
    // previous turn's carry-over. Counting those as an answer is how a turn that produced only `⚙` lines and then ran
    // out of budget looked complete, so its truncation was never explained.
    const noText = collector.agentChars === 0;
    if (stopWords) {
      const say = sayMeta || turnFailed || noText;
      meta(
        say ? stopWords : null,
        `acp: stop reason ${result.stopReason}${say ? "" : " (recorded only — the reply is there and the wire carries the stop reason; acp.hints adds the explanation)"}`,
      );
    }
    // Things the user asked for that could not happen. ALWAYS recorded; split into two classes for the reply:
    //   • `mustSay` — Filament silently did something different from what the user configured or expects. These are
    //     said once per conversation even with `hints` off, because there is no other way to find out from inside a
    //     chat: a permission policy of "ask" that never asks is a silent security downgrade, and an agent working in
    //     a folder other than the chat's project can put edits in the wrong tree. Both are once-per-conversation, so
    //     they cost the client's context one line each, ever.
    //   • `hints` — conveniences and things the user can see for themselves (the turn's record shows the model, mode
    //     and folder in force). Gated on `acp.hints`, which is off by default: they are chatter in the client's context.
    // A stopped turn's note is its reply's last block.
    if (!localReply && !action && !stoppedBy && !ownCall) {
      const convH = bridge.peekByRequest({
        upstream,
        format,
        body,
        cwdHint,
        conversationId,
      });
      const hints = [];
      const mustSay = [];
      const hintCtx = { agentName, firstTurn: convH?.turns === 1 };
      const say = (note) => {
        for (const h of renderHints(note, hintCtx)) (h.mustSay ? mustSay : hints).push(h.text);
      };
      for (const s of result.structured || []) say(s.note);
      // Notes the agent raised mid-turn (permission prompts) are said once per kind, however often it tripped them.
      const priorKinds = new Set();
      for (const n of rec._priorNotes || [])
        if (!priorKinds.has(n.kind)) {
          priorKinds.add(n.kind);
          say(n);
        }
      if (result.seeded)
        hints.push(`your earlier messages in this chat were handed to ${agentName} so it can continue them.`);
      // The must-say items go out regardless of `hints`; everything else only when hints are on, and never in the
      // harness's own turn, whose commands and status are its own. Both share one dedupe list, so a conversation never
      // sees the same sentence twice whichever setting produced it — and a safety item that was already shown while
      // hints were on is not repeated when they are off.
      const sayable = sayMeta && !harness ? hints : [];
      const shown = new Set(convH?.hintsShown || []);
      const fresh = [...mustSay, ...sayable].filter((x) => !shown.has(x));
      if (fresh.length) {
        if (convH) convH.hintsShown = [...shown, ...fresh].slice(-30);
        ownLine(fresh.join(" "));
        rec.changes.push(`acp: hint shown to the user: ${fresh.join(" | ")}`);
      }
    }
    // The model that answered, where it is not the turn's (`weighModel`): on the record, and said where it is due —
    // never into a reply Filament answered itself, one that goes on at the client, or one that ends in a stop's note.
    weighModel(result, { ended: true, quiet: !!localReply || !!action || (!!stoppedBy && !chatTurn) });
    const otherSaid = otherRecord();
    if (otherSaid) rec.changes.push(otherSaid);
    // Exact usage when the agent reports it (Claude Code); otherwise the estimate computed alongside the turn.
    const au = result.usage || null;
    const ctx = result.context || null;
    const spend = spendOf(result);
    const billed = spend.cost;
    const costSaid = costWhy(result);
    if (costSaid) rec.changes.push(costSaid);
    let outTokens = au ? au.output : Math.ceil((col.text.length + col.thought.length) / 4);
    const counted = au ? { n: au.input, how: null } : await countPromise;
    let inTokens = counted.n || 0,
      cacheRead = au ? au.cacheRead : 0,
      cacheWrite = au ? au.cacheWrite : 0;
    if (au)
      rec.changes.push(
        `acp: usage reported by the agent: ${inTokens} in, ${cacheRead} cache read, ${cacheWrite} cache write, ${outTokens} out${ctx?.used ? ` · context ${ctx.used.toLocaleString()}${ctx.size ? ` of ${ctx.size.toLocaleString()}` : ""} tokens${ctx.size ? ` (${Math.round((100 * ctx.used) / ctx.size)}%)` : ""}` : ""}`,
      );
    else if (counted.how && !localReply) rec.changes.push(`acp: input_tokens ${inTokens} ${counted.how}`);
    // A reply Filament wrote carries no tokens, on the wire too. No model ran in this turn but for a harness `/compact`
    // the agent performed, whose figures the compaction's op keeps where the agent reported them (compactor.js `own`).
    if (localReply) inTokens = outTokens = cacheRead = cacheWrite = 0;
    // On the wire, the input figure is what the client shows as its context meter. An agent's usage for a whole
    // turn sums every model call it made, which is what was billed but not what is in the context. When the agent
    // reports its context fill (Claude Code's usage_update, the Cursor SDK's last model call), the wire carries that.
    let wireIn = inTokens,
      wireCacheRead = cacheRead,
      wireCacheWrite = cacheWrite;
    if (!localReply && ctx && typeof ctx.used === "number" && ctx.used > 0) {
      wireCacheRead = Math.min(typeof ctx.cacheRead === "number" ? ctx.cacheRead : cacheRead, ctx.used);
      wireCacheWrite = 0;
      wireIn = Math.max(0, ctx.used - wireCacheRead);
      if (ctx.used !== inTokens + cacheRead + cacheWrite)
        rec.changes.push(
          `acp: context meter set to the agent's context (${ctx.used.toLocaleString()} tokens${ctx.estimated ? `, estimated: base prompt + ${(ctx.appended || 0).toLocaleString()} appended this turn` : ""}); the record keeps the billed total`,
        );
    }
    const usageObj =
      format === "anthropic"
        ? {
            input_tokens: wireIn,
            output_tokens: outTokens,
            cache_read_input_tokens: wireCacheRead,
            cache_creation_input_tokens: wireCacheWrite,
          }
        : {
            prompt_tokens: wireIn + wireCacheRead + wireCacheWrite,
            completion_tokens: outTokens,
            total_tokens: wireIn + wireCacheRead + wireCacheWrite + outTokens,
            prompt_tokens_details: { cached_tokens: wireCacheRead },
          };
    const stopReason = mapStopReason(result.stopReason, format);
    // The turn is over: flush any thought still buffered, and stop the flush timer so it cannot fire after the reply
    // has been assembled (which would write to a finished stream and drop the thought from col.text's record).
    flushThought();
    // A harness turn that said nothing at all still owes its page a reply, as the loop's does; a plan sent back is its
    // own.
    if (harness && run.agent && !col.text && !col.nativeThought && !result.planBack) onEvent({ type: "text", own: true, text: EMPTY_REPLY_LINE });
    if (stream) await wire.flushPaced();
    // A turn the client hung up on resolves (the bridge cancels it) instead of rejecting, so it lands here: it is
    // neither a delivered reply nor the agent's fault — the same `aborted` the provider path records.
    const hungUp = clientAbort.signal.aborted;
    const status = action ? "paused" : stoppedBy ? "stopped" : hungUp ? "aborted" : "done";
    // What the turn cost, its team's workers counted, as the loop's run says its own (`childCostUsd`; HarnessV4_Tasks
    // B12): the reports a lead heard spent what `acp.team` says, and no figure of the turn's held it.
    const turnCost = Math.round(((billed ?? 0) + launchedSpent()) * 1e6) / 1e6;
    await endRun(status, {
      stopReason: result.stopReason || "end_turn",
      inputTokens: inTokens,
      outputTokens: outTokens,
      childCostUsd: turnCost,
    });
    // A sub-agent's run reports to the registry before its reply goes out, as the loop host's does: its launcher reads
    // the outcome there. Its report is the agent's closing words, which its conversation keeps with its work
    // (`hostConvo`); its cost is this record's, and its own summary's where it wrote one in its session; what its
    // context holds (`heldNow`), its next message's line is weighed by.
    const hostStatus = host ? workerStatus({ stopped: !!stoppedBy, hungUp, stopReason: result.stopReason || null }) : null;
    const turnCounts = run.agent?.counts();
    if (host) {
      const report = closingWords();
      const extra = summarySpend(result.account);
      registry?.finish(host.id, {
        status: /** @type {NonNullable<typeof hostStatus>} */ (hostStatus),
        error: null,
        report,
        convo: hostConvo(report),
        rounds: turnCounts?.rounds || 0,
        toolCalls: turnCounts?.tools || 0,
        tokensIn: inTokens + cacheRead + cacheWrite + extra.tokensIn,
        tokensOut: outTokens + extra.tokensOut,
        spentUsd: (billed ?? 0) + extra.usd,
        roundIds: [rec.id],
        stoppedBy: stoppedBy?.by ?? null,
        taskReport,
        held: heldNow(localReply ? null : ctx, report),
        ...seedFinish(),
        ...answeredFinish(result),
      });
    }
    // How the agent did (HarnessV3-Memory M7-D48), kept as the loop keeps its turns and its workers' runs: a harness
    // chat's turn, a sub-agent's or a worker's run, where memory keeps the session's work (`prep.silent`). An
    // outside client's turn and a command Filament answered are no work of the session's; a paused turn is no end.
    const prep = mem?.prep;
    const ended = endedOf(hostStatus || status);
    if ((chatTurn || host) && !localReply && ended && prep?.chain && !prep.silent)
      memory.recordOutcome({
        chain: prep.chain,
        turn: prep.turn || prep.launchTurn || null,
        request: rec.id,
        kind: host ? (host.team ? "worker" : "subagent") : "turn",
        agent: host ? host.card.tag : null,
        model: String(body.model || modelId),
        counts: countCalls(callsOf(run.agent?.archive().work || [])),
        ended,
        rounds: turnCounts?.rounds || 0,
        tokensIn: inTokens + cacheRead + cacheWrite,
        tokensOut: outTokens,
        usd: billed,
        ms: Date.now() - startedAt,
      });
    /** @type {{ id: string, name: string, args: string, input: any }[]} */
    let actionCalls = []; // the client-action tool calls this turn, hoisted so the memory bookkeeping below can archive them
    if (action) {
      const calls = actions.map((a) => ({
        id: a.id,
        name: a.name,
        args: JSON.stringify(a.input || {}),
        input: a.input || {},
      }));
      actionCalls = calls;
      if (stream) wire.endWithActions(calls, usageObj);
      else wire.sendActions(col, calls, usageObj);
      actionTurn.renderer = renderer;
      bridge.detach(actionTurn);
    } else if (stream) wire.endStream(stopReason, usageObj);
    else wire.sendMessage(col, stopReason, usageObj);
    // Memory: the agent's turn goes into the archive (final text and the tools it called), and injected items are scored.
    // A sub-agent's run opens no turn — the registry's request is memory-quiet — so nothing of its conversation is
    // archived on the session it rode.
    if (mem?.prep?.turn) {
      try {
        const memCalls = actionCalls;
        // A harness chat's turn is archived as a loop turn is (HarnessV3-ACP AC1-8): each round's words and calls with
        // the results the model read, then the closing words and Filament's own closing lines. An outside client's
        // archive keeps its reply as the client holds it.
        const own = chatTurn && run.agent ? run.agent.archive() : null;
        const closing = own ? [...own.final, ...collector.said.slice(saidFrom).map((text) => ({ type: "text", text }))] : [];
        memory.afterReply({
          chainId: mem.prep.chain,
          turnId: mem.prep.turn,
          requestId: rec.id,
          finalMessage: {
            role: "assistant",
            content: own
              ? closing.length
                ? closing
                : own.work.length
                  ? [{ type: "text", text: EMPTY_REPLY_LINE }]
                  : []
              : [
                  ...(col.text ? [{ type: "text", text: col.text }] : []),
                  ...memCalls.map((c) => {
                    let input = {};
                    try {
                      input = JSON.parse(c.args || "{}");
                    } catch {}
                    return { type: "tool_use", id: c.id, name: c.name, input };
                  }),
                ],
          },
          ...(own ? { workMessages: own.work } : {}),
          // How the turn ended, for those who hear it finished before its record's facts say.
          stopReason: result.stopReason || null,
          replyText: col.text,
          outputChars: col.text.length,
          injectedIds: mem.prep.ids,
          trace: mem.sit?.trace || null,
        });
        if (own) followCompaction(own, mem.prep);
        // Filament's own answer stays on the record as the command it was, so no seed or catch-up hands it to an agent
        // as conversation.
        if (localReply) memory.archive?.mergeTurnMeta?.(mem.prep.turn, { command: true });
        // A turn the developer stopped carries the loop's stamp (BUG-07): after a reload its footer says so.
        if (stoppedBy) memory.markStopped?.(mem.prep.chain, { requestId: rec.id, by: stoppedBy.by, forced: stoppedBy.forced });
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} memory bookkeeping failed: ${e.message}`);
      }
    }
    // The move's word reached the agent's session with a turn that ran to its end (GW-D86): marked on the session, in a
    // chat memory leaves out too.
    if (moved && !hungUp && memChain) {
      try {
        memory.archive?.updateMeta(memChain, (meta) => Object.assign(meta, toldPatch(meta, moved.ids)));
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} the move's word was not kept: ${e.message}`);
      }
    }
    // A chat command answered by Filament counts as a request with no tokens and no speed; a harness `/compact` the
    // agent performed keeps its figures on the compaction's op, where the agent reported them.
    if (localReply) inTokens = outTokens = cacheRead = cacheWrite = 0;
    // What the agent's context holds now, as the agent counted it (HarnessV3-ACP AC3-5): the meter's figure once the
    // turn has ended — the record's own columns are what was billed, every model call's prompt added up — with the
    // agent's window where it named one. Filament's line and verdict judge a request Filament composes; an agent
    // composes its own and compacts it itself, so its turn has neither, and a command Filament answered sent no request
    // at all (nor holds anything). An estimate says so: the Cursor SDK's (its base and what came in since), or, where
    // the agent counted nothing, what Filament counted. Where its session was handed the line, the point it makes room at
    // by itself (HarnessV4_Tasks U3-2), so the meter draws it and works nothing out.
    const held = wireIn + wireCacheRead + wireCacheWrite;
    const exact = Number(ctx?.used) > 0 && !ctx.estimated;
    // The agent's own share of its context (HarnessV4_Tasks C33): its prompt and tools, which no compaction of Filament's
    // copy makes smaller. Measured where a session's turn began a session new to the agent — seeded from Filament's
    // composition, or the chat's first: its first count, with what Filament sent by Filament's estimate, is kept with the
    // agent's other starts in this folder, and the share is the fit over them (token-calib.js `ownFit`; the owner's look
    // of 10-24: the first count less the estimate booked the estimate's shortfall as the agent's).
    const fresh = !result.reused && !result.resumed && (result.seeded || !Number(rec.view?.totalTurns));
    const measured = !!rec.view?.composed && !localReply && fresh && firstCount > 0;
    if (measured) observeAgentStart(upstream.id, cwdHint, firstCount, Number(rec.view.sentTokens) || 0);
    const ownShare = measured ? (agentOwn(upstream.id, cwdHint)?.own ?? firstCount - (Number(rec.view.sentTokens) || 0)) : 0;
    rec.context = {
      ...(rec.context || {}),
      ...(Number(ctx?.size) > 0 ? { window: Number(ctx.size), source: "agent" } : {}),
      usable: null,
      verdict: null,
      ...(held > 0 ? { last: { held, ...(exact ? {} : { estimated: true }) } } : {}),
      ...(result.point ? { point: result.point } : {}),
      ...(ownShare > 0 ? { own: ownShare } : {}),
    };
    // The window it named is Filament's for its model from now on (the account-switch fix, D1): a switch into this
    // agent, its line and the meters weigh against it, as do the agent's other accounts until they name their own.
    if (Number(ctx?.size) > 0) deps.noteAgentWindow?.(upstream.id, windowName, Number(ctx.size));
    // The models that counted the turn name what the agent's own model name stands for: the estimator weighs the
    // session's copy on the scale that model showed over the API (services/token-calib.js, HarnessV4_Tasks C19).
    observeCountedModel(upstream.id, windowName, result.modelUsage);
    // A turn its agent served says someone is signed in there (app/agent-logins.js `turnSaid`); one Filament answered
    // itself, a hang-up and a stop say nothing of it.
    if (!localReply && !hungUp && !stoppedBy && result.stopReason !== "cancelled") deps.agentSignIn?.(upstream.id, true);
    // The turn's newest model call, where the agent counts its calls one by one: the session's ledger books it as its last
    // request (finish.js), which the record's columns — every call of the turn added up — are not. A `_` field: the store
    // keeps it from the persisted record and from every client.
    rec._lastModelCall = localReply ? null : run.agent?.lastModelCall() || null;
    finish(
      rec,
      {
        status: hungUp ? "aborted" : "ok",
        error: hungUp ? "client disconnected" : undefined,
        httpStatus: 200,
        local: localReply ? true : undefined,
        tokens: {
          ...rec.tokens,
          input: inTokens,
          output: outTokens,
          cacheRead,
          cacheWrite,
          thinking: au || localReply ? 0 : estimateTokens(col.thought),
          // The agent's usage carried its cache counts (core/cache-facts.js): an estimate of Filament's says none.
          ...(au?.cacheSeen && !localReply ? { cacheSeen: true } : {}),
        },
        estimatedTokens: localReply ? false : !au,
        ...spend,
        contextUsed: ctx?.used ?? undefined,
        contextSize: ctx?.size ?? undefined,
        stopReason: result.stopReason || "end_turn",
        thinkingChars: col.thought.length,
        textChars: col.text.length,
        acp: acpBlock(result, { clientAction: action ? { kind: action.kind, tool: action.name, calls: actions.length } : undefined, stoppedBy }),
      },
    );
  }

  return { turn };
}
