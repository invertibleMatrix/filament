// The conversation → agent-session map of one ACP bridge, with its persistence. A conversation (one chat, keyed by
// `conversationKey`) maps to the agent session that continues it; the map survives a restart (the agent reopens the
// session). Idle past its own limit, an outside client's conversation is forgotten, and a harness chat's keeps its
// session (`idleStep`, ../idle.js).
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { readSessionOffer, modelSelection } from "./negotiate.js";
import { idleStep } from "../idle.js";
import { addressGiven, addressKept } from "../turn-bridge.js";
import { RELAY_ADDRESS_VAR } from "./mcp-relay.js";
import { relayServer, withSettingsHeaders } from "./toolset.js";

/**
 * What the map keeps of a conversation across a restart. `commands` are what the agent published for the session: the
 * composer's menu offers them before the agent republishes them after a restart. `mcpNative` and `steering` are kept
 * because they describe what the AGENT's session was given, and that survives a restart (the session is reopened).
 * Without them a restored conversation fell back to "unknown", and unknown was treated as "toolset offered" — so after
 * any restart the six file tools came back for every bridge mode, including `off`, and a steered session kept the
 * tools but lost its instruction (turns is persisted, so the first-turn injection never fires again): an
 * instruction-less leak measurement.
 * @param {any} c
 * @returns {any}
 */
/** The updates that are the agent answering: its words, its thinking, its calls, its plan. */
const ANSWERS = new Set(["agent_message_chunk", "agent_thought_chunk", "tool_call", "plan"]);

/**
 * The address of Filament's own server as a session opened with it: over HTTP its `url`; through the relay over stdio
 * (toolset.js `relayServer`) the relay's variable. Null for any other server.
 * @param {any} s @returns {string | null}
 */
const ownAddress = (s) => {
  if (s?.name !== "filament") return null;
  if (typeof s.url === "string") return s.url;
  const v = Array.isArray(s.env) ? s.env.find((/** @type {any} */ e) => e?.name === RELAY_ADDRESS_VAR)?.value : null;
  return typeof v === "string" ? v : null;
};
/** Whether a server a session opened with is Filament's own, reached at its token's address. @param {any} s */
const isOwn = (s) => ownAddress(s) !== null;
/**
 * Filament's own server given another address, as it was given: over HTTP, or the relay as this Filament starts it —
 * its program and script where they are now, which an earlier start's may not be (an AppImage's folder is new each time).
 * @param {any} s @param {string} url
 */
const atAddress = (s, url) => (typeof s.url === "string" ? { ...s, url } : relayServer(url));

/**
 * What a session was opened with, as its record on disk keeps it: Filament's own server alone, by its address without
 * its token, the session's capability (`addressKept`). The chat's own MCP servers (HarnessV4_Overnight_Plan OV-D18)
 * and its upstream's own (`acp.mcpServers`), whose env and headers may carry a secret, are left out. A session opened
 * again from this record (a restart, then a way of its agent's own) is given its upstream's servers again from the
 * configuration and Filament's own a new token (`givenAgain`); it opens without the chat's, and the chat's next turn
 * opens it again with them.
 * @param {any} o
 */
const keptOpened = (o) => {
  const mcpServers = (o.mcpServers || []).filter(isOwn).map((/** @type {any} */ s) => atAddress(s, addressKept(/** @type {string} */ (ownAddress(s)))));
  // Nor the person's own headers its settings carry (toolset.js `planToolset`'s `ownHeaders`, the review of c04dd3507):
  // a gateway's token among them, as a rule. Opened again, it reads them as they stand (`withSettingsHeaders`).
  const sessionMeta = o.sessionMeta ? withSettingsHeaders(o.sessionMeta, null) : o.sessionMeta;
  return { ...o, mcpServers, ...(o.sessionMeta ? { sessionMeta } : {}), ...(Array.isArray(o.chat) && o.chat.length ? { chat: [] } : {}) };
};

/**
 * A session opened again from its record, outside a turn (a restart, then a way of its agent's own): its upstream's
 * own servers, which the record leaves out (`keptOpened`), given again as the configuration holds them now (`upstream`,
 * ACP's shape) where it names none of theirs, ahead of the rest as a turn's open gives them; and Filament's own server,
 * its token left out on disk, given a new one, which the conversation holds from then on — the session's next turn
 * goes on at that address. A record that holds them keeps what it holds. One opened for another machine's agents' chat
 * (`fenced`) was given none of its upstream's, and is given none again.
 * @param {any} conv @param {any[]} [upstream]
 */
export function givenAgain(conv, upstream = []) {
  const servers = Array.isArray(conv.opened?.mcpServers) ? conv.opened.mcpServers : [];
  const fromConfig = conv.opened?.fenced === true ? [] : upstream.filter((s) => !servers.some((/** @type {any} */ x) => x?.name === s?.name));
  const at = servers.findIndex(isOwn);
  const again = at >= 0 ? addressGiven(/** @type {string} */ (ownAddress(servers[at]))) : null;
  if (again) conv.mcpToken = again.token;
  conv.opened = { ...conv.opened, mcpServers: [...fromConfig, ...servers.map((/** @type {any} */ s, /** @type {number} */ i) => (again && i === at ? atAddress(s, again.url) : s))] };
}

function kept(c) {
  return {
    sessionId: c.sessionId,
    cwd: c.cwd,
    turns: c.turns,
    lastUsed: c.lastUsed,
    modelId: c.modelId,
    mode: c.mode,
    // The modes the session offers: Filament's summary, written in the session itself, takes the one that changes
    // nothing (the bug report's L26).
    availableModes: c.availableModes,
    idleMs: c.idleMs,
    upstreamId: c.upstreamId,
    effort: c.effort,
    paramOptions: c.paramOptions,
    // Its MCP token is not kept: it is the capability of Filament's server's address, and a session opened again after
    // a restart is given a new one (`givenAgain`, or the turn that opens it).
    mcpNative: c.mcpNative === true,
    steering: c.steering === true,
    title: c.title,
    commands: c.commands,
    // Cursor's to-do list as it keeps it in the session: its next update may name only the items it changes.
    todos: c.todos,
    // What the session has of Filament's context, and whether it was given the graph's tool, memory's tools, a task's
    // report, a worker's ask_lead — by its id — a team's tools, Filament's agent tool — as the word for what that tool
    // offered — the visual tools or the artifact tool (HarnessV3-ACP AC4-1, AC4-5, AC6-1, AC6-3; D4 of 11-01;
    // HarnessV4_Tasks E15 step 3; HarnessV3-TaskGraph-v2 TG2-D49; HarnessV4_Visuals_Plan E16; HarnessV4_Artifacts_Plan
    // E18), and which of the chat's own MCP servers and added folders, by their keys
    // (HarnessV4_Overnight_Plan OV-D18): a session reopened after a restart keeps what its own history holds. The
    // servers' key is kept empty where its open's record leaves them out (`keptOpened`), so the next turn gives them.
    given: c.given,
    toolsGraph: c.toolsGraph === true,
    toolsMemory: c.toolsMemory === true,
    toolsReport: c.toolsReport === true,
    toolsAsksLead: String(c.toolsAsksLead || ""),
    toolsTeam: c.toolsTeam === true,
    toolsLaunch: String(c.toolsLaunch || ""),
    toolsReads: c.toolsReads === true,
    toolsVisuals: c.toolsVisuals === true,
    toolsArtifacts: c.toolsArtifacts === true,
    toolsBeside: c.toolsBeside === true,
    toolsThread: c.toolsThread === true,
    toolsFlow: c.toolsFlow === true,
    toolsBrowser: c.toolsBrowser === true,
    toolsSkills: c.toolsSkills === true,
    // Whether its chat's project had its Space as it opened (the owner's of 11-08, h3).
    toolsSpace: c.toolsSpace === true,
    toolsMcp: c.opened?.chat?.length ? "" : String(c.toolsMcp || ""),
    toolsDirs: String(c.toolsDirs || ""),
    steerSaid: c.steerSaid,
    // What the session has heard of the chat, and whether it is still owed its seed (the bug report's L20, L21): a
    // session reopened after a restart catches up on what it missed since, and no more.
    seenUserTurns: c.seenUserTurns,
    heard: c.heard,
    ...(c.fresh ? { fresh: true } : {}),
    // The start of Filament's copy its count was made on, where that start is an agent's own summary, and whether it
    // was left untold some of the chat (`recounted`, `owes`).
    ...(c.countedOn != null ? { countedOn: c.countedOn } : {}),
    ...(c.partial ? { partial: true } : {}),
    // The chat's compaction the session stands on, and the session from before it while an undo can still bring it
    // back (AC5-1).
    basedOn: c.basedOn,
    before: c.before ? kept(c.before) : null,
    // A harness chat's: its record outlives idleness (`idleStep`).
    ...(c.harness ? { harness: true } : {}),
    // Its last turn was refused by the model's provider: the chat's next turn lets it go, after a restart too.
    ...(c.refused ? { refused: true } : {}),
    // A session Filament made: the fork the agent's own compaction keeps for Undo, deleted once let go (AC5-5).
    ...(c.made ? { made: true } : {}),
    // What the session was last opened with, and what its agent could do with it then (HarnessV4_Tasks C33): a way of
    // the agent's own — its compaction, its summary — opens the session again with the same, in a process started
    // for it, where none holds it (a restart, an idle agent let go). And the line it stands on.
    ...(c.opened ? { opened: keptOpened(c.opened) } : {}),
    ...(c.line != null ? { line: c.line } : {}),
    // What the session's transcript saved of its running totals, as far as Filament knows (the bridge's `saved`): a
    // query that resumes it after a restart goes on from them, since Filament ends its agents with their tree.
    ...(c.saved ? { saved: c.saved } : {}),
  };
}

/** How many sessions' commands are kept while no conversation holds them (`SessionMap`'s `#early`): throwaway sessions publish theirs too. */
const EARLY_SESSIONS = 32;

/** Everything opening the session (session/new, /load or /resume) told us about it, as read by `readSessionOffer`. */
export class SessionMap extends Map {
  #saveTimer = null;
  /**
   * The commands an agent published for a session no conversation holds yet, by the session's id: it says them as the
   * session opens, and its word can come in with the open's answer, ahead of the record made from it. The record takes
   * them when it is kept (`set`).
   * @type {Map<string, any[]>}
   */
  #early = new Map();
  /**
   * What each harness chat's sessions spent between turns that no turn showed, by the chat, added up (the bridge's
   * `#keepUnshown`): the chat's next turn books it, after a restart too, so it is kept with the map.
   * @type {Map<string, any>}
   */
  unshown = new Map();
  /** @param {{ stateFile?: string | null, log?: (level: string, msg: string) => void }} [opts] */
  constructor({ stateFile = null, log = () => {} } = {}) {
    super();
    this.stateFile = stateFile;
    this.log = log;
  }

  /**
   * A conversation kept: the commands its session published before it was (`#early`) are its own, and words that
   * waited for them have them (`commandsSaid`, the bridge's `ownCommands`). @param {string} key @param {any} conv
   */
  set(key, conv) {
    const early = conv?.sessionId != null ? this.#early.get(conv.sessionId) : undefined;
    if (early) {
      this.#early.delete(conv.sessionId);
      if (!Array.isArray(conv.commands)) {
        conv.commands = early;
        conv.commandsSaid?.resolve();
        delete conv.commandsSaid;
      }
    }
    return super.set(key, conv);
  }

  load() {
    if (!this.stateFile) return;
    // No file is the normal first run. Anything else — unreadable, or not JSON — means every conversation's session
    // mapping is gone, and a restart that silently forgets them is exactly the kind of loss that must be logged.
    try {
      const j = JSON.parse(readFileSync(this.stateFile, "utf8"));
      for (const [k, c] of Object.entries(j.conversations || {})) this.set(k, { ...c, procKey: null });
      for (const [chain, spent] of Object.entries(j.unshown || {})) this.unshown.set(chain, spent);
      this.log("debug", `[acp] restored ${this.size} conversation(s)`);
    } catch (e) {
      if (e?.code !== "ENOENT")
        this.log(
          "warn",
          `[acp] could not restore the session map from ${this.stateFile} (${e.message}); every chat starts a new agent session`,
        );
    }
  }

  save() {
    if (!this.stateFile) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.flush(), 300);
    this.#saveTimer.unref?.();
  }

  /** Write the map now, as it stands, a save still waiting with it: its bridge shuts down (the bug report's H10). */
  flush() {
    clearTimeout(this.#saveTimer);
    if (!this.stateFile) return;
    try {
      const conversations = {};
      for (const [k, c] of this) conversations[k] = kept(c);
      // Written beside the map, then put in its place: a write cut short leaves the map as it was, never torn.
      const tmp = `${this.stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, conversations, ...(this.unshown.size ? { unshown: Object.fromEntries(this.unshown) } : {}) }, null, 1));
      renameSync(tmp, this.stateFile);
    } catch (e) {
      this.log("warn", `[acp] could not save session map: ${e.message}`);
    }
  }

  // Session-level facts arrive outside turns too (right after session/new): keep them on the conversation record.
  // `replay`: the update is a loaded session's history, which the agent says again, no answer of its own now.
  absorbUpdate(sessionId, u, { replay = false } = {}) {
    const k = u.sessionUpdate;
    // The agent answers in a session that has not said its commands: it has none to say yet — an agent says them as
    // its session opens, before it answers — and words that waited for its word go on as words (`answered`, the
    // bridge's `ownCommands`; HarnessV3-FailurePoints, the early-command race).
    if (!replay && ANSWERS.has(k)) {
      for (const c of this.values())
        if (c.sessionId === sessionId && !c.answered) {
          c.answered = true;
          c.commandsSaid?.resolve();
          delete c.commandsSaid;
        }
      return;
    }
    if (
      k === "available_commands_update" ||
      k === "current_mode_update" ||
      k === "session_info_update" ||
      k === "config_option_update"
    ) {
      const commands =
        k === "available_commands_update"
          ? (u.availableCommands || []).map((x) => ({ name: x.name, description: x.description || "", hint: x.input?.hint || "" })).filter((x) => x.name)
          : null;
      let held = false;
      for (const c of this.values())
        if (c.sessionId === sessionId) {
          held = true;
          if (commands) {
            c.commands = commands;
            // Words that waited for the agent's word on its commands have it (the bridge's `ownCommands`).
            c.commandsSaid?.resolve();
            delete c.commandsSaid;
          } else if (k === "current_mode_update") {
            const m = u.currentModeId || u.modeId;
            if (m) c.mode = m;
          } // the spec's prose and schema disagree on the name
          else if (k === "session_info_update") {
            if (typeof u.title === "string" && u.title.trim()) c.title = u.title.trim().slice(0, 120);
            else if (u.title === null) c.title = null;
          } else if (k === "config_option_update" && Array.isArray(u.configOptions)) {
            const o = readSessionOffer({ configOptions: u.configOptions });
            c.paramOptions = o.params;
            c.effortOptions = o.efforts;
            c.effortConfigId = o.effortConfigId || c.effortConfigId;
            if (o.currentEffort != null) c.effort = o.currentEffort;
            if (o.models.length) {
              c.availableModels = o.models;
              // Its words for its models: an update that names its ids alone does not take them back.
              c.modelLabels = { ...c.modelLabels, ...o.modelLabels };
            }
            if (o.currentModel) c.modelId = o.currentModel;
            if (o.currentMode) c.mode = o.currentMode;
          }
          this.save();
        }
      // No conversation holds the session yet: its commands wait for the one made for it, the newest few sessions' kept.
      if (commands && !held && sessionId != null) {
        this.#early.delete(sessionId);
        this.#early.set(sessionId, commands);
        if (this.#early.size > EARLY_SESSIONS) this.#early.delete(this.#early.keys().next().value);
      }
    }
  }

  // Titles the agent's own session list knows for sessions we hold without one.
  adoptTitles(sessions) {
    for (const x of sessions)
      if (x.title)
        for (const c of this.values()) if (c.sessionId === x.sessionId && !c.title) c.title = x.title;
  }

  /**
   * The idle sweep (`idleStep`): the conversations to drop are dropped, and returned with the harness chats to rest
   * (`resting`), which stay. One in use (`inUse`: work queued or running on it) is not idle, however long that work
   * has run (the bug report's H8).
   * @param {number} now @param {(convKey: string) => boolean} inUse
   * @returns {{ dropped: any[], resting: any[] }}
   */
  sweep(now, inUse) {
    const dropped = [];
    const resting = [];
    for (const [k, c] of this) {
      const step = idleStep(c, now, inUse(k));
      if (step === "drop") {
        this.delete(k);
        dropped.push(c);
      } else if (step === "rest") resting.push(c);
    }
    if (dropped.length) this.save();
    return { dropped, resting };
  }
}

// A conversation record for a session the agent already had (attached by id or title, or resumed on a turn).
export function resumedConversation({ found, proc, upstream, acp, cwd, offer }) {
  return {
    sessionId: found.sessionId,
    procKey: proc.key,
    upstreamId: upstream.id,
    cwd,
    turns: 0,
    lastUsed: Date.now(),
    idleMs: Math.max(1, Number(acp.sessionIdleMinutes) || 240) * 60000,
    modelId: offer.currentModel,
    mode: offer.currentMode || "agent",
    availableModes: offer.modes,
    availableModels: offer.models,
    modelLabels: offer.modelLabels,
    modelConfig: offer.modelConfig,
    modelConfigId: offer.modelConfigId,
    effortOptions: offer.efforts,
    effortConfigId: offer.effortConfigId,
    effort: offer.currentEffort,
    resumedFrom: found.sessionId,
    title: found.title || null,
    // Its model as the agent names it, which a resumed session's may not run on: set again (configure.js).
    modelUnproven: true,
  };
}

// A conversation record for a session opened by this turn.
export function newConversation({ res, proc, upstream, acp, cwd, offer, modelId, lastText }) {
  return {
    sessionId: res.sessionId,
    procKey: proc.key,
    upstreamId: upstream.id,
    paramOptions: offer.params,
    cwd,
    turns: 0,
    lastUsed: Date.now(),
    idleMs: Math.max(1, Number(acp.sessionIdleMinutes) || 240) * 60000,
    modelId: modelSelection(acp) === "session" || offer.modelConfig ? offer.currentModel : modelId,
    mode: offer.currentMode || "agent",
    availableModes: offer.modes,
    availableModels: offer.models,
    modelLabels: offer.modelLabels,
    modelConfig: offer.modelConfig,
    modelConfigId: offer.modelConfigId,
    effortOptions: offer.efforts,
    effortConfigId: offer.effortConfigId,
    effort: offer.currentEffort,
    title:
      String(lastText || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60) || null,
  };
}
