// MemoryService: the one object the server talks to for long-term memory (docs/memory-architecture.md).
//
// It owns the memory folder (archive.db, mnemosyne/, memory.json), runs the Mnemosyne engine as a child process,
// runs the brain on every request, and serves the dashboard's /api/memory/* endpoints. The chat commands (`@mem`
// and the rest) and the tool-loop glue live in the app layer (app/commands/*, app/memory-tools.js).
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Archive, FEED_DAYS, SCHEMA_VERSION, textOfMessage, isRetired } from "./archive.js";
import { messageKind } from "../../core/messages.js";
import { chainRefOf } from "../../core/conversation.js";
import {
  MemoryBrain,
  chainLookup,
  stripMessageMemoryBlocks,
  newestUserIndex,
  stripMemoryBlocks,
  createConversationScan,
  personTextAt,
  isBlockEligibleUser,
  LISTED_KINDS,
  projectOf,
  messageHash,
} from "./brain.js";
import { pinHashOf } from "../../core/fold.js";
import { booksOnSession, foldTurnFacts, lineageParentOf } from "../../core/turn-facts.js";
import { cacheSaid, promptOf, saysCache, seenPrompt } from "../../core/cache-facts.js";
import { NO_PROJECT_ID, normalizeCwd } from "../../core/project-id.js";
import { projectFolderOf } from "../project-folder.js";
// For normalizing the in-flight-turn comparison below. acp.js does not import this module, so there is no cycle.
import { stripReminders } from "../../core/wire/flatten.js";
import { MemoryLearner, learningOptOut, OPT_OUT_KEYS, unreadWhy } from "./learn.js";
import { MemoryCurator } from "./curator.js";
import { ObservationBus, PitfallMiner } from "./observe.js";
import { BackupManager } from "./backup.js";
import {
  importClaudeCode,
  importMnemosyneDb,
  detectSources,
  SOURCES,
  sourceById,
  importOverview,
  chatStates,
  readChats,
  pendingOf,
  importState,
  setImportPrefs,
  noteImportRun,
  noteEmpty,
  noteReading,
  noteRemoved,
  forgetRemoved,
  unreadChats,
  refusal,
} from "./import.js";
import { loadKey } from "../config/secrets.js";
import { houseAuth, houseKey, isMachineryRequest } from "../house.js";
import { loopbackPost } from "../loopback.js";
import { STREAM_ERROR_STATUS, retryAfterSeconds, withRetries } from "../../core/retry.js";
import { selfAddress } from "../config/store.js";
import { MemoryTrace, withTrace, currentTrace } from "./trace.js";
import { summarizeInSlices, estTokens } from "../trim.js";
import { SessionPolicies } from "./policy.js";
import {
  KNOBS,
  applyPatch,
  flatten,
  harnessGlobalLayer,
  settingsChangeCard,
  resolveSettings,
  spaceLayerOf,
  resolveChainSettings,
  sliceConfigOf,
  unflatten,
} from "../session-settings.js";
import { MCP_KNOB, maskList } from "../mcp-servers.js";
import { sha256 } from "../../core/hash.js";
import { sessionTruth } from "./truth.js";
import { memoryHandle } from "./port.js";
import { OUTCOME_DAYS, callsIn, didOf, outcomeTable } from "./outcomes.js";
import { METRIC_DAYS } from "./metrics.js";
import { createSseFold, droppedLines } from "../../core/wire/sse.js";
import { callRoom } from "../../core/routing.js";
import { turnModelName } from "../../core/model-caps.js";
import { chooseMemoryModel, memoryEffort, plainModelOf, whyNoModelWords } from "./model-choice.js";

const SIDECAR = fileURLToPath(new URL("../../../sidecar/mnemosyne_sidecar.py", import.meta.url));
// Tests run a stand-in engine: `FILAMENT_MEMORY_SIDECAR` holds its { command, args, env }.
const sidecarHook = () => (process.env.FILAMENT_MEMORY_SIDECAR ? JSON.parse(process.env.FILAMENT_MEMORY_SIDECAR) : null);
/**
 * The purposes no one waits on (the filament-agent plan's D3): learning, the curator's pass, and a chat's name
 * (app/chat-namer.js). They wait behind the person's work for a slot, and have no clock (HarnessV3-FailurePoints §4 A):
 * the provider's answer or failure ends them.
 */
const BACKGROUND = new Set(["learn", "curate", "title"]);
/**
 * The background calls asked again while their provider is busy for a moment (core/retry.js): learning and the curator,
 * whose callers carry memory's own stop, so memory closing ends the wait. A chat's name is not: its namer tries again on
 * a later turn.
 */
const RETRIED = new Set(["learn", "curate"]);
/** The calls that go at memory's effort: its own, and the small jobs that run on its model (a chat's name, a goal's estimate). */
const MEMORY_EFFORT_PURPOSES = new Set(["learn", "curate", "recall", "title", "estimate"]);
/** A response's body, read whole as it arrives. @param {Response} r */
async function readAll(r) {
  if (!r.body) return "";
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out + dec.decode();
}
/**
 * A streamed answer folded as it arrives into the reply it streamed (core/wire/sse.js `createSseFold`), its text never
 * kept: a reply with a line past what Filament reads of one is the error that says so, `onOver` told.
 * @param {Response} r @param {(over: import("../../core/lines.js").Over) => void} onOver
 */
async function foldAll(r, onOver) {
  const fold = createSseFold("anthropic", { onOver, whole: true });
  if (r.body) {
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      fold.feed(dec.decode(value, { stream: true }));
    }
    fold.feed(dec.decode());
  }
  fold.end();
  return fold.reply();
}
/** The document's top-level sections: what a project row's settings_json holds beside its display flags. */
const SECTIONS = new Set(Object.keys(KNOBS).map((p) => p.split(".")[0]));
/** The words of a settings change for the operation log: "a, b changed", "a reset", or both. @param {{ path: string, to?: any }[]} changes */
const changeTitle = (changes) => {
  const set = changes.filter((c) => c.to !== undefined).map((c) => c.path);
  const reset = changes.filter((c) => c.to === undefined).map((c) => c.path);
  return [set.length ? `${set.join(", ")} changed` : "", reset.length ? `${reset.join(", ")} reset` : ""].filter(Boolean).join("; ");
};
/**
 * One line per change, the value as JSON or "inherits again"; an MCP server's credentials as the placeholder, since the
 * log is read back on pages (HarnessV4_Settings_Plan HS-D8).
 * @param {{ path: string, to?: any }[]} changes
 */
const changeLines = (changes) => changes.map((c) => `${c.path}: ${c.to === undefined ? "inherits again" : JSON.stringify(c.path === MCP_KNOB ? maskList(c.to) : c.to)}`);
/**
 * A refusal its callers tell apart by its code, never by its words: `not-found` (no such session or project) or
 * `invalid` (a name or value the request got wrong). The sessions service answers the code as
 * HTTP; the chat commands say the words. A missing archive keeps its plain "no archive" error for the admin edge.
 * @param {"not-found" | "invalid"} code @param {string} message
 */
const refused = (code, message) => Object.assign(new Error(message), { code });
const fmtTokens = (n) => {
  n = Number(n) || 0;
  return n >= 1e6
    ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M tokens`
    : n >= 1000
      ? `${Math.round(n / 1000)}k tokens`
      : `${n} tokens`;
};
// Normalize both sides of the in-flight-turn comparison in `archivedTranscript`. Neither side is "wrong": the archive
// stores the client's RAW message bytes, while the text an agent turn works with has had `<system-reminder>` blocks
// stripped and may carry a re-attached `<filament-memory>` block. Comparing them directly fails for exactly the clients
// that inject reminders (Claude Code — the default), and it fails silently: the newest message just shows up
// twice in the seed. So both sides are reduced to the same thing before they are compared.
const normalizeForCompare = (s) =>
  stripMemoryBlocks(stripReminders(String(s ?? "")).text)
    .replace(/\s+/g, " ")
    .trim();
/** A day, for the claims feed's prune (HarnessV3-Memory M7-D32). */
const DAY_MS = 86_400_000;
/** The claims feed's page: the stream's and the fan-out's (M7-D35, M7-D36). */
export const FEED_PAGE = 200;

/**
 * A claims feed row as the stream and the fan-out send it (M7-D35): its id in the feed's epoch, the claim (null for a
 * dossier), what happened, when, who, where; and where a moved claim came from. Never its words or a reason: the card
 * is read for those. @param {string} epoch @param {any} row
 */
export const claimChange = (epoch, row) => ({
  type: "change",
  id: `${epoch}:${row.id}`,
  claim: row.item_id != null ? `i${row.item_id}` : null,
  action: row.action,
  at: new Date(row.at).toISOString(),
  by: row.by ?? null,
  project: row.project_id ?? null,
  session: row.chain_id ?? null,
  ...(row.from_project != null ? { from: row.from_project } : {}),
});

/**
 * A new agent session's seed from the archive, in tokens, where its upstream sets no budget (HarnessV3-ACP AC-R1): half
 * the window Filament knows for the agent's model — the other half is the agent's to work in — else 100,000.
 * @param {number} window
 */
export const seedBudgetOf = (window) => (Number(window) > 0 ? Math.floor(Number(window) / 2) : 100_000);

/**
 * Whether a closed record ends a client's loop in its chat (`turnStopped`): an outside client's own request — not the
 * harness's, whose lock says its turns; not one through the Responses API, whose stop reason does not say a tool was
 * called; not Filament's machinery, a loop's tick or a sub-agent's call — whose reply called no tool and paused no turn,
 * or that failed, or whose client went. A call is one the client was shown (`_toolCalls`, the reply paths' count) or one
 * its stop reason says, a function's among them: an OpenAI upstream's `stop` beside its calls reaches an Anthropic
 * client as `end_turn`. A reply that called a tool leaves its loop waiting for the leg that goes on with it; a paused one
 * (`pause_turn`), for its client to send it again.
 * @param {any} rec
 */
const endsClientTurn = (rec) =>
  !!rec &&
  rec.api !== "session" &&
  rec.api !== "responses" &&
  !rec.agentOf &&
  !rec.subagentOf &&
  (rec.status !== "ok" || !!rec.error || !(rec._toolCalls > 0 || /tool_use|tool_calls|function_call|pause_turn/.test(String(rec.stopReason || ""))));

export class MemoryService {
  /** What hears that the claims feed may have grown (M7-D35): each stream's "read again". @type {Set<() => void>} */
  #claimWatchers = new Set();
  /** The wake queued for the feed's changes, so a burst is read once (`#claimsChanged`). @type {NodeJS.Immediate | null} */
  #claimsWake = null;
  /**
   * The fan-out's place in the feed (M7-D36): the store's epoch and the newest row read, which is the `last` the newest
   * message said: a read that finds no row finds no id past it either (a rollback takes its ids back, and a delete
   * that takes rows writes its `deleted` after them). @type {{ epoch: string, read: number } | null}
   */
  #fan = null;
  /** The daily prune of the claims feed and the outcomes. @type {NodeJS.Timeout | null} */
  #dailyPrune = null;
  /** What the open archive was opened with — its folder and privacy — while it is open: `start` keeps it while they hold. @type {string | null} */
  #archiveWith = null;
  /** Told each page of claim changes, or a reset (M7-D36): server.js publishes it on the events fan-out. @type {((msg: any) => void) | null} */
  onClaims = null;
  /** Told where the engine stands whenever that changes (AH-D2): server.js puts it on the events feed. @type {((now: any) => void) | null} */
  onEngine = null;
  /** Raises an alert in the console's banner and on the tray card: server.js hands in its own. @type {((kind: string, text: string, key: string) => void) | null} */
  onAlert = null;
  /** Whether this process installs a missing engine by itself (AH-D2): armed once the server listens. */
  #autoArmed = false;
  /** Whether it tried in this run, or the person removed the engine: either way it waits for the next start. */
  #autoDone = false;
  /** What `onEngine` was last told, so it is told only a change. */
  #engineSaid = "";
  /** Why the engine is held — being replaced (the release's going in over another) or removed —, in the log's words: it is
   *  not started meanwhile. @type {string | null} */
  #engineHeld = null;
  /**
   * The requests running a turn now, each by its record's id: the turn's chain and number (none for a leg of a turn the
   * archive does not hold), whether the request came beside its window's turn (`sit.alongside`), and its window — set as
   * prepare opens the turn or goes on with it (a tool-loop leg too, one on a branch of its turn among them), before
   * memory's lookups and capture are waited on; gone as the request's record closes (`turnStopped`), or as its prepare
   * fails before the turn is known. What a window's request comes beside reads it (`#beside`). In memory only: after a
   * restart none runs.
   * @type {Map<string, { chain: string, n: number | null, alongside: boolean, window: string }>}
   */
  #turnsRunning = new Map();
  constructor({
    getConfig,
    dataDir,
    log = () => {},
    selfBase = () => selfAddress({ port: 20300 }),
    windowFor = () => 0,
    now = () => Date.now(),
    sidecar = null,
    records = null,
    home = homedir(),
    repoState = null,
    mayAsk = () => true,
  } = {}) {
    // Where other coding agents keep their chats (the Import section reads under it).
    this.home = home;
    // The Mnemosyne client and installer (adapters/sidecar) come from the composition root: this service imports no adapter.
    if (!sidecar)
      throw new Error("MemoryService needs the sidecar (client and installer) from the composition root");
    Object.assign(this, {
      getConfig,
      dataDir,
      log,
      // Where Filament reaches itself (services/config/store.js `selfAddress`): memory's own model calls and its engine's
      // come back through it.
      selfBase,
      windowFor,
      now,
      sidecar,
      // The request records store (services/records.js): the facts fold's lineage walk reads a record's ancestors
      // from the ring (Facade D2).
      records,
      // Where a folder's repository stands (adapters/git/standing.js), for the briefing: this service imports no adapter.
      repoState,
      // Whether the disk may be asked of a folder a request names, as the folder rules say (the composition root's): a
      // network share they keep out is never asked, and stands in its own project, as written.
      mayAsk,
    });
    this.policies = new SessionPolicies({
      archive: () => this.archive,
      archiveWhy: () => this.archiveWhy(),
      config: () => this.getConfig(),
      now: () => this.now(),
    });
    this.archive = null;
    /**
     * The Space of your own that shows a project, or null (services/spaces.js `ownAbove`): the server sets it once the
     * Spaces are read, and the archive relays it to whatever resolves a chat's settings (session-settings.js
     * `spaceLayerOf`). @type {(projectId: string) => string | null}
     */
    this.spaceOf = () => null;
    /**
     * Whether another machine's agents' device holds Full control here (services/devices.js `fullControl`): the server
     * says, the archive relays it to whatever resolves a chat's settings (archive.js `fenced`). @type {(deviceId: string) => boolean}
     */
    this.fullControlOf = () => false;
    /** @type {string | null} why the archive did not open, its words or its folder's; null if it did or has not tried */
    this.archiveError = null;
    this.store = null;
    // The engine's start (M2-3): ready, its own rows fenced, its rows adopted, the queued writes sent. It resolves
    // either way, failures logged; the engine import waits on it to report what the restart adopted.
    /** @type {Promise<void>} */
    this.engineStart = Promise.resolve();
    this.brain = null;
    this.folder = null;
    this.openedWith = null;
    this.jobs = new Map();
    this.sessionLists = new Map();
    this.pendingLoads = new Map();
    this.startedAt = null;
    this.learner = null;
    /** @type {ObservationBus | null} */
    this.observations = null;
    this.backups = new BackupManager({ service: this, getConfig: () => this.cfg(), log, now });
    this.backups.start();
  }

  // Archive-level operations (delete / backup / restore / reindex) as durable operations, injected by the server as
  // `memory.onArchiveOp` — the same pattern as onLearnerOp and onEngineOp. These are methods on the long-lived service
  // itself, so no forwarder is needed; the import path is deliberately NOT here because it already runs as a `job` op
  // via startJob, and recording it twice would put one import on the System tab twice.
  #archiveOp(title, opts) {
    try {
      this.onArchiveOp?.(title, opts);
    } catch {
      /* observability must never break an archive operation */
    }
  }
  /**
   * A turn's message goes to its model or agent now, past every refusal Filament makes itself — a hook's block, a
   * command it answers, a folder it refuses: `memory.onMessageSent`, injected by the server like onTurnFinished, hears
   * it, and a chat's name is read from its first message (app/chat-namer.js). Said by the loop's turn and a coding
   * agent's (agent/turn.js, acp-turn.js).
   * @param {string} chainId @param {number} turnId
   */
  messageSent(chainId, turnId) {
    try {
      this.onMessageSent?.({ chainId, turnId });
    } catch (/** @type {any} */ e) {
      this.log("warn", `memory: the message-sent hook failed for ${chainId} (${e?.message || e})`);
    }
  }
  // A turn's final reply was archived: `memory.onTurnFinished`, injected by the server like onArchiveOp, hears it.
  /** @param {string} chainId @param {number} turnId @param {string | null} stopReason  how the turn ended, where its caller says */
  #turnFinished(chainId, turnId, stopReason) {
    try {
      this.onTurnFinished?.({ chainId, turnId, stopReason });
    } catch (/** @type {any} */ e) {
      this.log("warn", `memory: the turn-finished hook failed for ${chainId} (${e?.message || e})`);
    }
  }
  // Sessions deleted — a chat with the teams beside it, or every chat of a project: `memory.onSessionsDeleted`,
  // injected by the server like onTurnFinished, hears their ids, so what the process keeps for them goes too.
  /** @param {string[]} ids */
  #sessionsDeleted(ids) {
    if (!ids.length) return;
    try {
      this.onSessionsDeleted?.(ids);
    } catch (/** @type {any} */ e) {
      this.log("warn", `memory: the sessions-deleted hook failed (${e?.message || e})`);
    }
  }
  // Memory's model, through Filament's own front door: visible in Usage, never captured. Unnamed, the model is memory's
  // for the chat the call is for (`modelFor`); memory's own calls go at its effort (`memory.models.effort`, low unset).
  /**
   * The call asks for the most its model can write, inside its window (`callRoom`, HarnessV3-FailurePoints §13): the
   * length an answer should have is its prompt's to ask, never a cap's to enforce. `includeUsage` returns the billed
   * usage beside the text. No clock ends the call (§4 A): the provider's answer or failure does, or its caller's
   * `signal`. `maxTokens`: the room a caller that weighed the call itself found for the reply, on the scale it weighed
   * the request by (a side agent's summary of its earlier exchanges, turn.js `exchangesGiveWay`); it stands in place
   * of `callRoom`'s.
   * @param {{ system: string, user: string, model?: string | null, purpose?: string, chainId?: string | null,
   *   parentRequest?: string | null, jobId?: string | null, includeUsage?: boolean, signal?: AbortSignal | null, maxTokens?: number | null }} a
   */
  async callModel({
    system,
    user,
    model = null,
    purpose = "memory",
    chainId = null,
    parentRequest = null,
    jobId = null,
    includeUsage = false,
    signal = null,
    maxTokens = null,
  }) {
    const chose = model ? null : this.modelFor({ chainId });
    const mdl = model || chose?.model || "";
    if (!mdl) throw new Error(whyNoModelWords(chose?.from || "none"));
    const effort = MEMORY_EFFORT_PURPOSES.has(purpose) ? memoryEffort(this.cfg().models?.effort) : null;
    // Every call STREAMS (D3). A model that thinks first and a long summary put bytes on the wire long before the
    // answer exists: a non-streaming call emits nothing until its answer is whole, which an edge proxy kills at ~126 s
    // (W8: ten Cloudflare 524s), and its record shows nothing streaming meanwhile.
    const background = BACKGROUND.has(purpose);
    // The window memory's model cache knows, else the tables'.
    const cap = Number(maxTokens) > 0 ? Math.floor(Number(maxTokens)) : callRoom(this.getConfig(), mdl, estTokens(system) + estTokens(user), Number(this.windowFor?.(mdl)) || undefined);
    const { j, r } = await this.#ask({ system, user, mdl, cap, purpose, chainId, parentRequest, jobId, signal, background, effort });
    const text = (j.content || [])
      .filter((/** @type {any} */ b) => b.type === "text")
      .map((/** @type {any} */ b) => b.text)
      .join("");
    // Opt-in so every string caller (trim slices, recall rewrites) is untouched: the learner wants the BILLED usage
    // for its operation records, not a chars/4 estimate of the prompt. A route that reports no usage yields null,
    // never a fabricated zero.
    if (includeUsage) {
      const u = j.usage && (j.usage.input_tokens != null || j.usage.output_tokens != null) ? j.usage : null;
      return {
        text,
        usage: u ? { input: u.input_tokens ?? null, output: u.output_tokens ?? null } : null,
        requestId: r.headers.get("x-filament-request-id") || null,
      };
    }
    return text;
  }
  /**
   * One request of `callModel` through Filament's front door, its answer parsed (a stream gathered). An HTTP failure or
   * an error answer throws. No clock (HarnessV3-FailurePoints §4 A): it goes over loopback (services/loopback.js),
   * where Node's fetch would end a wait past 300 s on its own. Background work names itself, so its slot comes after
   * the person's work.
   * @param {{ system: string, user: string, mdl: string, cap: number, purpose: string, chainId: string | null,
   *   parentRequest: string | null, jobId: string | null, signal: AbortSignal | null, background: boolean }} a
   * @returns {Promise<{ j: any, r: Response }>}
   */
  async #ask({ system, user, mdl, cap, purpose, chainId, parentRequest, jobId, signal, background, effort = null }) {
    // `x-filament-memory-purpose` / `-for` tag the record as memory's own call (the dashboard shows these apart, per
    // session) — tags that count because the call presents the house key.
    // `signal`: the caller's own stop (a harness turn stopped while its compaction summary is written).
    const post = () => loopbackPost(`${this.selfBase()}/v1/messages`, {
      signal,
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        ...houseAuth(),
        "user-agent": "filament-memory/0.1",
        "x-filament-memory": "off",
        "x-filament-memory-purpose": purpose,
        ...(background ? { "x-filament-background": "1" } : {}),
        ...(chainId ? { "x-filament-memory-for": String(chainId) } : {}),
        ...(parentRequest ? { "x-filament-parent-request": String(parentRequest) } : {}),
        ...(jobId ? { "x-filament-job": String(jobId) } : {}),
        "x-session-id": `memory-${this.now().toString(36)}`,
      },
      body: JSON.stringify({
        model: mdl,
        max_tokens: cap,
        system,
        messages: [{ role: "user", content: user }],
        ...(effort ? { output_config: { effort } } : {}),
        stream: true,
      }),
    });
    /** One try, as `withRetries` reads it: its answer parsed, or its failure - an HTTP status, or an error inside its 200 stream - with the provider it reached and what its Retry-After and `x-should-retry` ask. */
    const once = async () => {
      const r = await post();
      const should = r.headers.get("x-should-retry");
      const told = { r, upstream: r.headers.get("x-filament-upstream") || null, retryAfter: retryAfterSeconds(r.headers), shouldRetry: should === "true" ? true : should === "false" ? false : null };
      if (!r.ok) {
        const body = await readAll(r);
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {}
        return { ok: false, status: r.status, json, ...told, failed: `memory's model answered HTTP ${r.status}: ${body.slice(0, 200)}` };
      }
      const ct = r.headers.get("content-type") || "";
      const said = droppedLines(this.log, `memory: the ${purpose} call ${r.headers.get("x-filament-request-id") || ""}`.trim(), "it was dropped unread, and the reply with it: the call fails in those words");
      const j = ct.includes("text/event-stream") ? await foldAll(r, said.onOver) : JSON.parse(await readAll(r));
      if (j?.type === "error" || j?.error)
        return {
          ok: false,
          status: STREAM_ERROR_STATUS[String(j?.error?.type)] ?? 502,
          json: j,
          ...told,
          inStream: true,
          failed: `memory's model answered with an error: ${String(j?.error?.message || j?.error?.type || j?.error || "stream error").slice(0, 200)}`,
        };
      return { ok: true, status: r.status, json: j, ...told, failed: "" };
    };
    // Learning and the curator try again while their provider is busy for a moment, as Filament's own loops do
    // (core/retry.js): a learning run failed on one rate limit, and its session's turns waited for a boundary a finished
    // session never has. A call someone waits on (a recall's rewrite, a compaction's summary) fails at once: its caller
    // goes on.
    const tried = RETRIED.has(purpose)
      ? await withRetries(once, { signal, onWait: (w) => w && this.log("info", `memory: the ${purpose} call: ${w.words}`) })
      : { r: await once() };
    if (!tried.r.ok) throw new Error(tried.tooLong ? `${tried.r.failed} (${tried.tooLong})` : tried.r.failed);
    return { j: tried.r.json, r: tried.r.r };
  }
  noteBackup(manifest) {
    if (this.folder) {
      const m = this.#manifest(this.folder);
      this.#writeManifest(this.folder, {
        ...m,
        lastBackupAt: manifest.at,
        lastBackupDir: manifest.dir || null,
      });
    }
  }
  cfg() {
    return this.getConfig()?.memory || {};
  }
  enabled() {
    return this.cfg().enabled === true;
  }
  /** Whether memory has started and its folder opened, so a handle's verbs can run. */
  isOpen() {
    return !!this.brain;
  }
  /**
   * Whether memory's tools ride a request of a chat under `settings` (its document, null for the config's alone), as
   * brain.js `toolsOffered` gives it for a chat with turns: memory on, its autopilot on and its tools on — what a request
   * memory could not read is given, so the tools section the provider caches does not change for it (t420). With
   * `known` false its chat is not known, so its settings are not: the config decides only where no chat's or project's
   * own settings choose memory's tools (archive.js `memoryToolsChosen`), else none ride. A fresh chat's quiet
   * or muted first request, bare where memory reads it, is the one case it cannot tell.
   * @param {any} settings @param {{ known?: boolean }} [o]
   */
  toolsRide(settings, { known = true } = {}) {
    if (!this.brain) return false;
    try {
      const { auto } = this.brain.settingsFor({ settings });
      return auto.enabled !== false && auto.tools !== false && (known || !this.archive?.memoryToolsChosen());
    } catch {
      return false;
    }
  }
  /**
   * Why there is no archive, as a sentence a reply can carry: the archive's own words when it would not open (a file
   * another build wrote says how to start over where Filament runs) or secret.key's, the folder's when it could not be
   * made, else that memory has not started.
   */
  archiveWhy() {
    const why = String(this.archiveError || "memory has not started").trim();
    return `${why[0].toUpperCase()}${why.slice(1)}${/[.!?]$/.test(why) ? "" : "."}`;
  }
  /**
   * The memory port (HarnessV3-Memory MD-21): a handle for one consumer, whose role is the `by` of every write it
   * makes. Every module outside this service reaches memory this way, never through the brain, the archive's claims
   * or the engine. @param {Parameters<typeof memoryHandle>[1]} o
   */
  scope(o) {
    return memoryHandle(this, o);
  }
  /**
   * Where an outside agent's call over `/mcp/memory` stands (HarnessV3-Memory M7-D40): the project of the folder it
   * names (its main folder's for a worktree, HarnessV4_Git_Plan GW-D46), made on first sight so the claim browser
   * lists what it files there, and its session's chain, of kind `mcp`, made on first use. → ids (null for none), or
   * null while memory is closed.
   * @param {{ key?: string | null, cwd?: string, client?: string, meta?: any }} o
   * @returns {{ project: string | null, chain: string | null } | null}
   */
  mcpStand({ key = null, cwd = "", client = "", meta = null }) {
    const a = this.archive;
    if (!a) return null;
    const project = cwd ? a.ensureProject(projectFolderOf(cwd, { asks: this.mayAsk(cwd) })).id : null;
    const chain = key ? a.chainForKey(key, { project, client: client || null, kind: "mcp", meta }) : null;
    return { project, chain: chain?.id ?? null };
  }
  /** The chain an MCP session already has (M7-D41), or null: none yet, or memory closed. @param {string} key */
  mcpChainOf(key) {
    const id = this.archive?.chainIdForKey(key);
    return id ? this.archive.getChain(id) : null;
  }
  /**
   * An MCP session its client ended (M7-D41): its chain says so, so its id stays ended after a restart. What it declared
   * goes: an ended session is never adopted again. @param {string} key
   */
  mcpEnd(key) {
    const chain = this.mcpChainOf(key);
    if (chain) this.archive.mergeMeta(chain.id, { mcp: { ended: this.archive.now() } });
  }
  folderPath() {
    const f = String(this.cfg().folder || "").trim();
    return f ? resolve(f) : join(this.dataDir, "memory");
  }
  engineDir() {
    return this.sidecar.engineDir(this.dataDir);
  }

  // Open (or reopen after a config change) the archive, the store and the brain.
  start() {
    const m = this.cfg();
    const signature = JSON.stringify({
      enabled: m.enabled,
      folder: this.folderPath(),
      engine: m.engine,
      privacy: m.privacy,
      hook: process.env.FILAMENT_MEMORY_SIDECAR || "",
    });
    if (this.openedWith === signature) return;
    // The archive is the record every running turn writes to: one that only the engine changed under — its install
    // finished, an update, memory switched on or off — stays open, and only the engine side opens again. Closed under
    // it, a turn that ran on failed at its save: "database is not open" (a fresh install's first chat, 10-27).
    const archiveWith = JSON.stringify({ folder: this.folderPath(), privacy: m.privacy });
    const keep = !!this.archive && this.#archiveWith === archiveWith;
    this.stop({ keepArchive: keep });
    this.openedWith = signature;
    // The archive opens whether memory is on or off: it is the record every native session, transcript and
    // inspector reads (HarnessV2 D6, "recording never stops"). The switch decides what rides on top of it — the
    // engine, the learner, the injections, the tools — exactly as the per-session knob does (off = muted).
    const on = this.enabled();
    const folder = this.folderPath();
    this.folder = folder;
    try {
      mkdirSync(folder, { recursive: true });
    } catch (e) {
      this.archiveError = `cannot create the memory folder ${folder}: ${e.message}`;
      this.log("error", `memory: ${this.archiveError}`);
      return;
    }
    const manifest = this.#manifest(folder);
    const encrypted = !!(manifest.encrypted ?? m.privacy?.encryptArchive !== false);
    this.archiveError = null;
    try {
      if (!keep) {
        // Read here, where the archive opens: a secret.key that does not read is why it does not, in the key's own words.
        const key = encrypted ? loadKey(this.dataDir) : null;
        this.archive = new Archive({
          file: join(folder, "archive.db"),
          key,
          // A settings layer's credentials are sealed with Filament's secret key, encrypted bodies or not (HS-D8).
          secretKey: key || loadKey(this.dataDir),
          caps: {
            messageBytes: m.capture?.messageCapBytes || 1048576,
            inputChars: m.capture?.inputCapChars || 4000,
          },
          index: m.privacy?.searchIndex !== false,
          blockKeyOf: messageHash,
        });
        const up = this.archive.upgraded;
        if (up) this.log("info", `memory: the archive was upgraded from version ${up.from} to ${SCHEMA_VERSION}${up.copy ? `; the file as it was is kept at ${up.copy}` : ""}`);
      }
    } catch (e) {
      this.log("error", `memory: cannot open the archive: ${e.message}`);
      // Kept for the Memory page, which says it in the archive's own words or the key's (a refusal says how to start
      // over where Filament runs).
      this.archiveError = String(e.message);
      this.archive = null;
      return;
    }
    this.#archiveWith = archiveWith;
    const archive = /** @type {Archive} */ (this.archive);
    // The claims feed (M7-D32): told before anything below writes, so no change goes unheard. The archive is rebuilt on
    // every open; the service, stable, relays it.
    archive.onClaimChange = () => this.#claimsChanged();
    // The Space above a project, relayed the same way: the archive is what every settings resolution is handed.
    archive.spaceOf = (id) => this.spaceOf(id);
    // Whether another machine's agents' device holds Full control here, relayed the same way (archive.js `fenced`).
    archive.fullControlOf = (id) => this.fullControlOf(id);
    this.#followFeed();
    this.#prune();
    this.#dailyPrune = setInterval(() => this.#prune(), DAY_MS);
    this.#dailyPrune.unref?.();
    const hook = sidecarHook();
    // Only an engine whose install finished (AH-D2): the venv's Python is there from 40% of an install on, and a
    // failed install leaves it behind with no Mnemosyne in it.
    const es = this.sidecar.engineState(this.dataDir);
    const python = es.installed ? es.venvPython : null;
    if (!on) {
      this.store = null;
    } else if (this.#engineHeld && !hook) {
      this.store = null;
      this.log("info", `memory: ${this.#engineHeld}`);
    } else if (hook || python) {
      this.store = new this.sidecar.MemoryEngine({
        command: hook?.command || python,
        args: hook?.args || [SIDECAR],
        env: this.#engineEnv(hook),
        memoryFolder: folder,
        log: this.log,
        writeConfig: !hook,
        trace: currentTrace,
      });
      // Forwarded through the service, exactly like the learner's recorder: the engine is constructed HERE, when a
      // memory folder is opened, and nulled by stop(). A recorder assigned from server.js at boot would attach to
      // null, and then to a dead object after the first close/reopen.
      this.store.onOp = (title, opts) => this.onEngineOp?.(title, opts);
      // The per-CALL ops (the noisy `engineop` kind) get their own forwarder beside the lifecycle one, so a
      // kind can be switched on without the other.
      this.store.onCallOp = (title, opts) => this.onEngineCallOp?.(title, opts);
    } else {
      this.store = null;
      this.log("warn", "memory: the Mnemosyne engine is not installed; memory runs on the archive alone until it is");
      // Worth a durable line of its own: it is the reason the Live tab's engine panel, every recall and every
      // mirroring write silently do nothing. Without it the System tab shows an engine history that simply stops,
      // with no explanation attached.
      try {
        this.onEngineOp?.("memory engine is not installed; memory runs on the archive alone", {
          sub: "unavailable",
          level: "warn",
          detail: { installed: false, state: "not installed" },
        });
      } catch {
        /* observability must never stop memory from opening */
      }
    }
    this.brain = new MemoryBrain({
      store: this.store,
      archive: this.archive,
      getConfig: () => this.cfg(),
      log: this.log,
      now: this.now,
      callModel: (a) => this.callModel({ ...a, purpose: a.purpose || "recall" }),
      // The creator (D6): prepare's chain comes from here, never the archive direct, so every path that creates a
      // first request's chain agrees.
      chainFor: (sit, o) => this.chainFor(sit, o),
      observe: (e) => this.observe(e),
      settingsOf: (chainId) => resolveChainSettings(this.archive, this.getConfig(), chainId),
      chatModelOf: (chainId) => this.chatModelOf(chainId),
      // A request's record (M7-D20): the run a loop's tick belongs to, and the sub-agent that run is.
      runOf: (requestId) => (requestId ? this.records?.byId?.get(String(requestId)) || null : null),
      repoState: this.repoState,
      mayAsk: (folder) => this.mayAsk(folder),
      pendingLoads: this.pendingLoads,
    });
    // The search op forwarder, installed at the construction site like the learner and engine: the brain is rebuilt
    // on every memory open, so a recorder assigned once from server.js would be lost on the first close/reopen.
    this.brain.onOp = (title, opts) => this.onSearchOp?.(title, opts);
    if (on) {
      this.learner = new MemoryLearner({
        archive: this.archive,
        brain: this.brain,
        callModel: (a) => this.callModel(a),
        model: (/** @type {string | null | undefined} */ chainId) => this.modelFor({ chainId }).model,
        whyNoModel: (/** @type {string | null | undefined} */ chainId) => this.#whyNoModel(chainId),
        getConfig: () => this.cfg(),
        log: this.log,
        now: this.now,
      });
      // Forwarded through the service rather than assigned straight onto the learner: the learner is constructed HERE,
      // when a memory folder is opened, and nulled by stop(). A recorder injected once from server.js at startup would
      // attach to null and be silently lost on every close/reopen — the failure mode would be "the learner chip works
      // until the first time memory is reopened". The service is the stable object, so server.js assigns this instead.
      this.learner.onOp = (title, opts) => this.onLearnerOp?.(title, opts);
      this.learner.start();
      // The curator (HarnessV3-Memory M4, the memory plan's m1): a pass over a project once it is due — a learning run
      // landed or a chat of it started a turn, with claims changed since a pass 6 h old —, or asked for. Its op recorder is forwarded the same way as the learner's: it is rebuilt on every open.
      this.curator = new MemoryCurator({
        archive: this.archive,
        brain: this.brain,
        callModel: (a) => this.callModel(a),
        model: (/** @type {string | null} */ projectId) => this.curatorModel(projectId),
        getConfig: () => this.cfg(),
        log: this.log,
        now: this.now,
      });
      this.curator.onOp = (title, opts) => this.onCuratorOp?.(title, opts);
      // A learning run that lands, like a chat of the project starting a turn (`prepare`), lets the curator see whether
      // the project's pass is due (the memory plan's m1).
      this.learner.onLearned = (projectId) => this.curator?.poke(projectId, "learned");
      // A pass a killed Filament left open ends now, said (HarnessV3-Readiness RD1 e).
      this.curator.endLeftOpen();
      this.curator.start();
      // The observation bus (M5-4): what agents' tool calls did, read off the request path. Its miner learns as the
      // learner does, from sessions that learn, and a pitfall it files queues the curator's pass like a learning run.
      this.observations = new ObservationBus({ log: this.log });
      const miner = new PitfallMiner({
        brain: () => this.brain,
        mayLearn: (chainId) => this.learner?.cfg().learn !== false && !this.#optedOut(chainId),
        onFiled: (projectId) => this.curator?.poke(projectId, "learned"),
        log: this.log,
      });
      this.observations.on((e) => miner.observe(e));
      // A sub-agent's report (M7-D17): the learner reads it on its own line, so the bus never waits on a model. One
      // whose chat Memory settings leave out, or the model its calls went out on (`sentModel`), is not read
      // (`subagentLeftOut`).
      this.observations.on((e) => {
        if (e?.type === "subagent.report" && !this.brain?.subagentLeftOut(String(e.chain ?? ""), String(e.sentModel || ""))) void this.learner?.findings(e);
      });
    } else {
      this.learner = null;
      this.curator = null;
      this.observations = null;
    }
    this.startedAt = this.now();
    this.#writeManifest(folder, {
      ...manifest,
      encrypted,
      lastOpened: new Date().toISOString(),
      bank: m.engine?.bank || "default",
    });
    this.engineStart = this.store?.ensure
      ? this.store
          .ensure()
          .then(() => this.fenceEngine())
          .then(() => this.adoptEngine())
          .then(() => this.brain?.outbox.drain())
          .catch((e) =>
            // One stopped as it started (its replacement, its removal) did not fail, and nothing retries it.
            e?.stopped
              ? undefined
              : this.log("warn", `memory: engine start failed (${e.message.slice(0, 160)}); it retries on the next request`),
          )
      : Promise.resolve();
    // Not part of the start the engine's callers wait on: making a store's vectors again can take minutes.
    if (this.store?.reindex) void this.engineStart.then(() => this.reembedEngine());
    this.log(
      "info",
      on
        ? `memory: on, folder ${folder}, archive ${this.archive.chainTotal()} sessions`
        : `memory: off — recording only (the archive at ${folder}, ${this.archive.chainTotal()} sessions); nothing is recalled, learned or offered as a tool`,
    );
    // Memory on: armed, it installs a missing engine (AH-D2), or replaces one this release's bundle did not put in,
    // whether at the first start or switched on later.
    if (on) this.#autoInstall();
  }
  /** @param {{ keepArchive?: boolean }} [o]  `keepArchive`: the engine side alone closes (`start`, the archive's folder and privacy unchanged) */
  stop({ keepArchive = false } = {}) {
    if (this.#dailyPrune) clearInterval(this.#dailyPrune);
    this.#dailyPrune = null;
    try {
      this.learner?.stop();
    } catch {}
    try {
      this.curator?.stop();
    } catch {}
    this.observations?.stop();
    try {
      this.brain?.stop?.();
    } catch {}
    try {
      // Closed for good: an engine memory drops never starts again for whoever still holds it (a turn begun before,
      // the learner) — beside the one memory opens next, or over files an install replaces.
      const s = this.store;
      if (s?.close) s.close();
      else s?.stop?.();
    } catch {}
    if (!keepArchive) {
      try {
        this.archive?.close();
      } catch {}
      this.archive = null;
      this.#archiveWith = null;
    }
    this.store = null;
    this.brain = null;
    this.learner = null;
    this.curator = null;
    this.observations = null;
    this.openedWith = null;
  }
  /**
   * What happened while an agent worked (HarnessV3-Memory M5-4, M7-D17), onto the observation bus: never waits, and
   * dropped when memory is closed or does not learn.
   * @param {import("./observe.js").ToolResult | import("./observe.js").SubagentReport} event
   */
  observe(event) {
    this.observations?.push(event);
  }
  // Async, and the server awaits it before flushing the op log — that ordering is load-bearing. MemoryEngine.stop()
  // is async (it asks the sidecar to shut down and waits up to 2 s for the acknowledgement) and it records the
  // engine's final operation. stop() below calls it WITHOUT awaiting, so the caller used to move straight on to
  // ops.flush() and the "memory engine stopped" event was recorded after the flush and lost. The last line of the
  // engine's durable history was the one that never arrived — exactly the event you want when asking why memory went
  // away. Calling store.stop() twice is safe: the second call finds no child and returns before recording anything.
  async shutdown() {
    this.backups.stop();
    try {
      await this.store?.stop?.();
    } catch {}
    this.stop();
  }
  reload() {
    this.start();
    // A change of memory's model reopens nothing (memory reads its models live), but the engine's next start calls it.
    this.#refreshEngineEnv();
  }
  /**
   * The engine's environment as memory's settings have it now: its folders, the door its model calls come back
   * through and the model it calls; a stand-in engine's own over it.
   * @param {any} hook
   */
  #engineEnv(hook) {
    const m = this.cfg();
    return {
      ...this.sidecar.sidecarEnv({
        memoryFolder: this.folder,
        engineDir: this.engineDir(),
        base: this.selfBase(),
        // The engine's model calls come back through /memory-engine/, the door only the house key opens.
        apiKey: houseKey(),
        model: this.modelFor({}).model,
        llmEnabled: !!this.modelFor({}).model,
        embeddings: m.engine?.embeddings !== false,
        // The model its install warmed (c2): the engine runs on what its cache holds.
        embeddingModel: this.sidecar.engineState?.(this.dataDir)?.embeddingModel || "",
        bank: m.engine?.bank || "default",
      }),
      ...(hook?.env || {}),
    };
  }
  #refreshEngineEnv() {
    if (this.store) this.store.env = this.#engineEnv(sidecarHook());
  }
  #manifest(folder) {
    try {
      return JSON.parse(readFileSync(join(folder, "memory.json"), "utf8"));
    } catch {
      return { version: 1, createdAt: new Date().toISOString(), deviceId: randomBytes(6).toString("hex") };
    }
  }
  #writeManifest(folder, m) {
    try {
      writeFileSync(join(folder, "memory.json"), JSON.stringify({ ...m, version: 1 }, null, 2));
    } catch (e) {
      this.log(
        "warn",
        `memory: could not write the memory folder's manifest (${join(folder, "memory.json")}): ${e.message}`,
      );
    }
  }

  /**
   * The model the person set in Settings › Memory › Model (memory.models.summarizer): a dedicated model for memory, ""
   * where none is set or memory's model is off. The compactor's side writer and the agent loop's fold read it as the
   * side model where no compaction model is named.
   */
  summarizerModel() {
    const want = String(this.cfg().models?.summarizer || "").trim();
    return want === "off" || want === "auto" ? "" : want;
  }
  /**
   * Memory's model for a chat, a project or neither (the memory plan's m1, `chooseMemoryModel`): the one set in Settings
   * › Memory first; else the chat's compaction model; else its own model — a sub-agent's chat's, the chat that launched
   * it; a project's, its most recently active chat's —; else the most recently active chat's anywhere (the model new
   * chats start on is the harness's pick, kept in the browser); else none, `from` saying why.
   * @param {{ chainId?: string | null, projectId?: string | null }} [at]
   * @returns {{ model: string, from: import("./model-choice.js").ModelFrom }}
   */
  modelFor({ chainId = null, projectId = null } = {}) {
    const cfg = this.getConfig() || {};
    const set = String(this.cfg().models?.summarizer ?? "").trim();
    if (set === "off" || (set && set !== "auto")) return chooseMemoryModel({ set, plain: () => "" });
    let head = chainId && this.archive ? this.archive.chainHead(String(chainId)) : null;
    // A sub-agent's chat (a sub-agent's sub-agent's too) stands on the chat that launched it.
    for (let up = 0; head?.kind === "subagent" && up < 8; up++) {
      const parent = this.archive.parentIdOf(head.id);
      const next = parent ? this.archive.chainHead(parent) : null;
      if (!next) break;
      head = next;
    }
    if (!head && projectId && projectId !== NO_PROJECT_ID && this.archive) {
      const newest = this.archive.newestChainId({ project: projectId, kinds: LISTED_KINDS });
      head = newest ? this.archive.chainHead(newest) : null;
    }
    const defaults = resolveSettings({ global: harnessGlobalLayer(cfg) }).effective;
    const doc = (head && resolveChainSettings(this.archive, cfg, head.id)?.effective) || defaults;
    return chooseMemoryModel({
      set,
      compaction: String(doc?.context?.compaction?.model || ""),
      chat: head ? this.#chatModelBase(head.id) : "",
      fallback: () => {
        const newest = this.archive?.newestChainId({ kinds: LISTED_KINDS });
        return newest && newest !== head?.id ? this.#chatModelBase(newest) : "";
      },
      plain: (name) => plainModelOf(cfg, name),
    });
  }
  /**
   * Memory's model as Settings › Memory shows it (HarnessV3-Memory M6-3, the memory plan's m1): what is set (`summarizer`:
   * a model, "" unset, `off`), the effort set ("" low), whether the curator uses a model, and what memory calls where no
   * chat is named (`now`, from where; `whyNone` while it has none).
   * @returns {{ summarizer: string, effort: string, curatorUsesModel: boolean, now: string | null, from: import("./model-choice.js").ModelFrom, whyNone: string | null }}
   */
  models() {
    const m = this.cfg().models || {};
    const set = String(m.summarizer ?? "").trim();
    const at = this.modelFor({});
    return {
      summarizer: set === "auto" ? "" : set,
      effort: String(m.effort ?? "").trim(),
      curatorUsesModel: this.cfg().curator?.usesModel !== false,
      now: at.model || null,
      from: at.from,
      whyNone: at.model ? null : whyNoModelWords(at.from),
    };
  }
  /**
   * A chat's model as memory takes it: its name without the tier or effort its turns put on it (`chatModelOf`'s), so
   * memory's call goes at memory's own effort and never on a chat's fast or flex tier. @param {string} chainId
   */
  #chatModelBase(chainId) {
    const head = this.archive?.chainHead(String(chainId)) || null;
    if (!head?.native) return String(head?.model || "");
    const eff = resolveChainSettings(this.archive, this.getConfig(), head.id)?.effective;
    return String(eff?.model?.name || head.model || "").trim();
  }
  /** Why memory learns a chat with no model, in words. @param {string | null} [chainId] */
  #whyNoModel(chainId = null) {
    return `no learning model: ${whyNoModelWords(this.modelFor({ chainId }).from)}`;
  }
  /**
   * The curator's model for a project (HarnessV3-Memory M4-1, the memory plan's m1): memory's, its project's newest
   * chat's where none is set; "" where the curator works by rule alone (memory.curator.usesModel off).
   * @param {string | null} [projectId]
   */
  curatorModel(projectId = null) {
    if (this.cfg().curator?.usesModel === false) return "";
    return this.modelFor({ projectId }).model;
  }

  // ---- request path -------------------------------------------------------------------------------
  // One trace per request: every step below records into it (content-free); the server attaches it to the record.
  // The request path runs whenever the archive is open — memory off records the turn and injects nothing (the brain
  // reads the switch as autopilot off); only a failed open (no brain) keeps memory out of a request entirely.
  trace() {
    return this.brain ? new MemoryTrace() : null;
  }
  /**
   * Where a request sits (brain.js `situate`), or null where memory stays out of it — save a turn of a chat Filament
   * composes (`args.keep`), situated all the same where Memory settings leave it out (`sit.leftOut`). One whose reading
   * failed goes on without memory, though its chat is one memory works in, and `failed` hears it: null, or for a request
   * of a chat Filament composes, what it names alone (brain.js `missedSituation`, `sit.missed`) — its turn kept where the
   * archive can write it, memory doing nothing else for it; `failed` hears why.
   * @param {any} args @param {MemoryTrace | null} [trace] @param {((why: string) => void) | null} [failed]
   */
  situate(args, trace = null, failed = null) {
    if (!this.brain) return null;
    return withTrace(trace, () => {
      try {
        const sit = trace
          ? trace.spanSync("situate", () => this.brain.situate(args), {
              note: "who is talking, from where, which session",
            })
          : this.brain.situate(args);
        if (!sit) return null;
        sit.trace = trace;
        // A chat Memory settings leave out (`sit.leftOut`) is loaded nothing into.
        const want = sit.leftOut ? "" : String(args?.headers?.["x-filament-memory-load"] || "").trim(); // <session>[:<view>] from a client that integrates
        if (want) {
          const [chainId, view] = want.split(":");
          if (chainId && this.archive?.getChain(chainId))
            this.pendingLoads.set(sit.key, {
              chainId,
              view: ["chat", "summary", "full", "compact"].includes(view) ? view : "chat",
            });
        }
        return sit;
      } catch (e) {
        this.log("warn", `memory: situate failed (${e.message.slice(0, 120)})`);
        failed?.(String(e?.message || e).slice(0, 120));
        try {
          const sit = this.brain.missedSituation(args, String(e?.message || e).slice(0, 120));
          if (sit) sit.trace = trace;
          return sit;
        } catch (e2) {
          this.log("warn", `memory: the turn is not kept: the archive could not read its chat (${String(e2?.message || e2).slice(0, 120)})`);
          return null;
        }
      }
    });
  }
  /**
   * Why Memory settings leave a request out, in their words (brain.js `capturedOut`) — or null: memory has not started,
   * none of them excludes it, or the request could not be read (as a situate that failed could not), which names none
   * of its own: where it names a chat (`x-filament-chain`), that chat is asked then by its own row (`chatLeftOut`), so a
   * request of a chat they leave out is left out with it whatever of the request could not be read. `args` are
   * `situate`'s, read as it reads them. With `unread`, a request whose reading failed and that names no chat is said
   * left out in its words: what gives memory's tools to a request memory could not read asks so (t420), the request's
   * leaving-out not known.
   * @param {any} args @param {{ unread?: string | null }} [o]
   */
  excludedWhy(args, { unread = null } = {}) {
    if (!this.brain) return null;
    try {
      return this.brain.excludedWhy(args);
    } catch (e) {
      const ref = chainRefOf(args?.headers || {});
      this.log("warn", `memory: why it leaves a request out could not be read (${String(e?.message || e).slice(0, 120)})${ref ? "; the chat it names is asked" : ""}`);
      return ref ? this.chatLeftOut(String(ref)) : unread;
    }
  }
  /**
   * Why Memory settings leave a chat out, in their words (brain.js `chatLeftOut`: its client, its model, its folder, and
   * a team's chat with the chat it runs beside) — or null: none of them does, or memory has not started. One whose
   * leaving-out could not be read is left out, said so, as `keptToItself` and `subagentLeftOut` keep it: memory does
   * nothing there it may not. `model`: the name its turns send, where the caller holds it already, read no more.
   * @param {string} chainId @param {string | null} [model]
   */
  chatLeftOut(chainId, model = null) {
    if (!this.brain) return null;
    try {
      return this.brain.chatLeftOut(chainId, undefined, model);
    } catch (e) {
      this.log("warn", `memory: why it leaves a chat out could not be read (${String(e?.message || e).slice(0, 120)}); it is left out`);
      return "Memory settings could not be read";
    }
  }
  /**
   * Whether a chat's turns are its own alone, read for no other chat or call (brain.js `keptToItself`: Memory settings
   * leave it out, turn capture is off in a chat Filament composes, or every turn of it was kept apart); one whose
   * settings could not be read is. False while memory has not started. @param {string} chainId
   */
  keptToItself(chainId) {
    return this.brain ? this.brain.keptToItself(String(chainId || "")) : false;
  }
  /**
   * Why Memory settings leave a sub-agent's work out on the model its calls go out on (brain.js `subagentLeftOut`: that
   * model, else the chat it works for), in their words — or null: none of them does, or memory has not started. One
   * that could not be read leaves it out: a brief is never sent where it may not go.
   * @param {string} chainId @param {string} model  as its calls send it
   */
  subagentLeftOut(chainId, model) {
    if (!this.brain) return null;
    try {
      return this.brain.subagentLeftOut(chainId, model);
    } catch (e) {
      this.log("warn", `memory: why it leaves a sub-agent out could not be read (${String(e?.message || e).slice(0, 120)})`);
      return "Memory settings could not be read";
    }
  }
  /**
   * The model a chat's turns name: a harness chat's as its turns send it — its document's model, else the chain's, with
   * its tier and its effort (core/model-caps.js `turnModelName`) —, an outside client's the one its own requests last
   * named (the chain's model column); "" for no such chat. @param {string} chainId
   */
  chatModelOf(chainId) {
    const head = this.archive?.chainHead(String(chainId)) || null;
    if (!head?.native) return String(head?.model || "");
    const cfg = this.getConfig();
    const eff = resolveChainSettings(this.archive, cfg, head.id)?.effective;
    const name = String(eff?.model?.name || head.model || "").trim();
    return name ? turnModelName(cfg, eff, name) : "";
  }
  // P7 (§11.1–11.2): the ARCHIVED version of this conversation, for seeding or re-attaching an agent session.
  //
  // The client's own history is lossy in one direction — it saw the narration, and it compacts — and an agent's session
  // is lossy in the other: it never saw the turns a different model handled. The archive is the only place holding the
  // whole cross-model conversation byte-exact, so it makes a better seed than re-flattening whatever the client
  // happened to send this time. Read-only end to end, and it never creates a chain: the ACP path does not archive
  // agent turns itself, so an empty chain would be indistinguishable from "there was nothing to seed from".
  // `view: "summary"` is the cross-agent handoff shape (§11.3) — per-turn summaries rather than a transcript, and it
  // costs no model call, because the archive already stores them. `budgetTokens`: the upstream's budget for the seed;
  // without one (0), half of `window`, the window Filament knows for the agent's model (`seedBudgetOf`). The result says
  // the budget it used.
  archivedTranscript(
    {
      format,
      body,
      responsesBody = null,
      headers = {},
      cwdHint = "",
      acpCwd = "",
      model = "",
      newestText = "",
    } = {},
    { view = "chat", budgetTokens = 0, window = 0 } = {},
  ) {
    if (!this.brain || !this.archive) return null;
    // A sub-agent's run rides its session's chain (the header is house-only), but its conversation is its own
    // (HarnessV3-ACP AC6-2): the chain is its launcher's, and what it said before is in its own request.
    if (headers?.["x-filament-subagent"]) return null;
    try {
      const sit = this.brain.situate({ format, body, responsesBody, headers, cwdHint, acpCwd, model });
      if (!sit?.key) return null;
      // Only a chain keyed on the CLIENT'S OWN conversation id may seed an agent. Without that header the key is a
      // fingerprint of (folder + first message), so two different chats in one folder that open the same way share one
      // chain — and seeding from it would hand one chat's transcript to another chat's tool-running agent under
      // "Earlier conversation; continue it, do not repeat it". Memory's briefing already risks that collision, but it
      // leaks hedged snippets that say they may be outdated; this would leak a whole transcript stated as fact. A
      // header-less client loses almost nothing by this: after a compaction its fingerprint moves with the new first
      // message, so the lookup misses anyway and it falls back to the body either way.
      if (sit.keySource !== "header" && sit.keySource !== "chain") return null;
      const chainId = this.archive.chainIdForKey(sit.key);
      if (!chainId) return null; // this chat has never been archived: the caller falls back to the request body
      // Drop the in-flight turn when the archive already holds it. `memory.prepare` archives the newest user message
      // BEFORE the agent is asked anything, so seeding from the whole chain would put that message in the seed and
      // then again under "Latest user message". Matched on TEXT rather than by always dropping the last turn: when
      // memory did not prepare this request (a tool-loop leg, a housekeeping call, an excluded client) the last
      // archived turn is an older one and dropping it would silently lose real history.
      let toTurn = null;
      // Derived from the RAW body the same way `beginTurn` archives it, rather than taken from the caller's flattened
      // copy — see `normalizeForCompare`. `newestText` is only a fallback for a caller with no body to offer.
      const idx = newestUserIndex(format, body);
      const want = normalizeForCompare((idx >= 0 ? textOfMessage(body?.messages?.[idx]) : "") || newestText);
      if (want) {
        const turns = this.archive.getTurns(chainId) || [];
        const last = turns.at(-1);
        if (last) {
          const had = normalizeForCompare(textOfMessage(this.archive.getMessage(last.user_hash)?.message));
          if (had && had === want) toTurn = Math.max(0, (last.n ?? turns.length) - 1);
        }
        if (toTurn === 0) return null; // the only archived turn is the one in flight: nothing earlier to seed from
      }
      // "full" is not offered: it renders message objects rather than text, which is not what a prompt preamble wants.
      const v = ["chat", "summary", "compact"].includes(view) ? view : "chat";
      const budget = Number(budgetTokens) > 0 ? Math.max(200, Math.floor(Number(budgetTokens))) : seedBudgetOf(window);
      const r = this.brain.load(chainId, { view: v, budgetTokens: budget, toTurn });
      const text = String(r?.text || "").trim();
      if (!text) return null;
      return {
        chainId,
        view: v,
        text,
        turns: r.turns || 0,
        dropped: r.dropped || 0,
        tokens: r.tokens || 0,
        title: r.title || null,
        excludedInFlight: toTurn != null,
        budget,
      };
    } catch (e) {
      this.log("warn", `memory: archived transcript failed (${e.message.slice(0, 120)})`);
      return null;
    }
  }
  /**
   * @param {any} sit
   * @param {{ requestId?: string | null, upstream?: string, captureOnly?: boolean, dryRun?: boolean, engine?: any, waiting?: import("./brain.js").MemoryWaiting | null }} [o]
   */
  async prepare(sit, { requestId = null, upstream = "", captureOnly = false, dryRun = false, engine = null, waiting = null } = {}) {
    if (!sit || !this.brain) return null;
    const tr = sit.trace || null;
    return withTrace(tr, async () => {
      /** The turn the request runs, as prepare told it (`opened`): `{ chain, n, turnId?, legWork? }`. @type {any} */
      let begun = null;
      // The request runs its turn from the moment the turn is known — before the briefing, the turn block and the
      // capture are waited on — until its record closes: a request of its window that comes meanwhile comes beside it.
      const opened =
        !dryRun && requestId != null
          ? (/** @type {{ chain: string, n: number | null, turnId?: number, legWork?: any[] }} */ t) => {
              begun = t;
              this.#turnsRunning.set(String(requestId), { chain: String(t.chain), n: t.n == null ? null : Number(t.n), alongside: !!sit.alongside, window: String(sit.window || "") });
            }
          : null;
      try {
        // A client's own rewind (D11) is marked before anything else prepare does: before the new turn opens.
        if (!dryRun) this.alignHistory(sit);
        const run = () => this.brain.prepare(sit, { requestId, upstream, captureOnly, dryRun, engine, waiting, opened });
        const out = tr
          ? await tr.span("prepare", run, {
              note: "everything memory does to the request before the upstream is called",
            })
          : await run();
        // A chat of the project starts a turn: its curator pass runs in the background where one is due (m1).
        if (!dryRun && out?.newTurn && out.project) {
          try {
            this.curator?.poke(out.project, "turn");
          } catch (/** @type {any} */ e) {
            this.log("warn", `memory curator: could not see whether a pass is due (${String(e?.message || e).slice(0, 120)})`);
          }
        }
        if (out && tr) {
          const s = tr.steps.find((x) => x.name === "prepare");
          if (s)
            Object.assign(s, {
              tokensAdded: out.tokens || 0,
              briefingItems: out.briefing || 0,
              turnItems: out.injected || 0,
            });
        }
        return out;
      } catch (e) {
        this.log(
          "warn",
          `memory: prepare failed (${e.message.slice(0, 160)}); the request goes on without memory`,
        );
        // A request whose turn was known before prepare failed still runs it, without memory's lookups: its close says the
        // turn's end, and where its reply is archived on the turn its record names it (a leg's with the loop so far). A
        // turn of a chat Filament composes whose turn was not known is kept as one whose situate failed is, where the
        // archive can write it (brain.js `prepare`'s `missed`): memory does nothing else for it. What fails there is the
        // archive — as where a turn kept so failed already: that turn is not kept, and its record says so. Any other
        // request whose turn was not known runs no turn of memory's: its record names none.
        let unkept = null;
        if (!dryRun && !begun && sit.composed && !sit.quiet) {
          if (sit.missed || sit.leftOut) unkept = e.message.slice(0, 80);
          else {
            sit.missed = e.message.slice(0, 80);
            try {
              return await this.brain.prepare(sit, { requestId, upstream, captureOnly, dryRun, engine, waiting, opened });
            } catch (e2) {
              unkept = String(e2?.message || e2).slice(0, 80);
            }
          }
          this.log("warn", `memory: the turn is not kept: the archive could not write it (${unkept})`);
        }
        if (!dryRun && requestId != null && !begun) this.#turnsRunning.delete(String(requestId));
        return {
          notes: [`memory: skipped (${e.message.slice(0, 80)})${unkept ? `; the turn is not kept: the archive could not write it (${unkept})` : ""}`],
          injected: 0,
          briefing: 0,
          tokens: 0,
          ids: [],
          tools: false,
          // Why memory missed the request: its tools ride it all the same where they ride the chat's (memory-prepare.js).
          missed: e.message.slice(0, 80),
          ...(begun ? { chain: begun.chain } : {}),
          ...(begun?.turnId != null ? { turn: begun.turnId, turnN: begun.n, ...(begun.legWork?.length ? { legWork: begun.legWork } : {}) } : {}),
        };
      }
    });
  }
  /**
   * A chat command Filament answered itself, typed in a session it composes (D7: keyed on `sit.composed` — a native
   * session's turn, or the harness's turn on any session, another client's included): recorded as a turn of that session
   * (the command as the user message, Filament's text as the final, `meta.command`), so the transcript keeps it
   * across a reload instead of dropping it. Traffic no session composes keeps its own history and is left alone. Kept
   * apart where the chat's turns are its own alone as it is recorded, as any of its turns is (brain.js `apartWhy`).
   * @param {any} sit @param {{ requestId: string, model?: string | null, userText: string, answerText: string, card?: any }} o
   */
  recordCommandTurn(sit, { requestId, model = null, userText, answerText, card = null }) {
    if (!this.archive || !sit?.chainRef || !userText || !sit.composed) return null;
    try {
      const chain = this.archive.getChain(sit.chainRef);
      if (!chain) return null;
      const apart = sit.leftOut || this.brain?.apartWhy(chain.id) || null;
      // Begun when its request arrived (HarnessV3-Launch RD-D4): a compaction the command wrote stays undoable after it.
      const t = this.archive.beginTurn(chain.id, { requestId, model, window: sit.window || "harness", client: sit.client || "harness", format: "anthropic", userMessage: { role: "user", content: userText }, command: true, startedAt: sit.at ?? null, send: sit.send || null, apart });
      this.archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: String(answerText || "") }] }, requestId, outputChars: String(answerText || "").length });
      if (card) this.archive.mergeTurnMeta(t.turnId, { card });
      return t;
    } catch (e) {
      this.log("warn", `memory: a command's turn was not recorded (${e?.message || e})`);
      return null;
    }
  }

  /**
   * The turn's facts (Facade D2): fold this finished record into its turn's stored facts. Called from `finish`,
   * after the goal and spend booking, so the facts are written in the same synchronous step as the record's close —
   * a page that hears the turn ended can never ask for the facts before they exist. The fold declines records that
   * do not book on a session (memory's own calls, Filament's answers), so this is one unconditional call.
   *
   * The record's turn is its ROOT's: the lineage headers are followed to the record that has none, and that root's
   * `memory.turnId` names the turn. A record whose ancestry cannot be followed — an ancestor gone from the ring —
   * writes no facts anywhere (never on the internal chain's turn a tick's record names), and the log says so.
   * @param {any} rec
   */
  turnFactsAdd(rec) {
    const a = this.archive;
    if (!a || !rec || !booksOnSession(rec)) return;
    try {
      const root = this.#rootOfRecord(rec);
      if (!root) {
        this.log("warn", `records: ${rec.id}'s ancestry could not be followed; its numbers join no turn's facts`);
        return;
      }
      // A root that opened no turn — a house call, the developer's own sub-agent — books its numbers on no turn.
      const turnId = root.memory?.turnId;
      if (turnId == null) return;
      const prev = a.turnMeta(turnId)?.facts || null;
      const parent = lineageParentOf(rec);
      // A round of the turn's own loop brings its notes to the turn's Details (F2 item 14); a sub-agent's do not.
      a.mergeTurnMeta(turnId, { facts: foldTurnFacts(prev, rec, { own: !parent, round: !!parent && rec.agentOf === root.id }) });
    } catch (e) {
      this.log("warn", `records: ${rec.id}'s facts were not written (${e?.message || e})`);
    }
  }

  /**
   * The record's request runs its turn no more (HarnessV3-FailurePoints finding 3): it closed, whatever its outcome, so
   * the turn's `meta.running` goes, and the request leaves the turns running now (`#turnsRunning`). The turn is the
   * record's own — a loop round's is its internal one, never the turn it works for. A client's next request of the same
   * turn marks it again (`archive.beginTurn`); a mark still there after a restart is a turn that ran at it
   * (`cutOffBefore`). A client's request that ran a turn of its chat and ends its loop (`endsClientTurn`), with no other
   * request running a turn of that chat now, ends the chat's turn: no lock holds a client's chat to say so, so
   * `memory.onClientTurnEnded`, injected by the server like onTurnFinished, hears the chat's id, the turn's number
   * (null where the archive holds no turn of it) and whether the request failed. A request that failed ends its turn at
   * once, and the client's retry goes on with that turn (`archive.beginTurn`), so its end is said again under the same
   * number. A request that came alongside ends none while a loop of its window waits on its tools (`archive.loopWaits`)
   * — Claude Code's /btw while a tool runs: the loop's leg that goes on from the tool ends it.
   * @param {any} rec
   */
  turnStopped(rec) {
    const ran = rec?.id != null ? this.#turnsRunning.get(String(rec.id)) : undefined;
    if (rec?.id != null) this.#turnsRunning.delete(String(rec.id));
    const a = this.archive;
    const turnId = rec?.memory?.turnId;
    if (a && turnId != null)
      try {
        if (a.turnMeta(turnId)?.running != null) a.mergeTurnMeta(turnId, { running: undefined });
      } catch (e) {
        this.log("warn", `records: ${rec.id}'s turn still reads as running (${e?.message || e})`);
      }
    if (ran && endsClientTurn(rec) && ![...this.#turnsRunning.values()].some((r) => r.chain === ran.chain))
      try {
        if (!(ran.alongside && a?.loopWaits(ran.chain, ran.window))) this.onClientTurnEnded?.(ran.chain, ran.n, rec.status !== "ok" || !!rec.error);
      } catch (/** @type {any} */ e) {
        this.log("warn", `memory: the end of a client's turn could not be told for ${ran.chain} (${e?.message || e})`);
      }
  }

  /**
   * The record a record's numbers flow up to — its lineage root, whose `memory.turnId` names the turn. Ancestors are
   * read from the ring, where a pending parent is never evicted while its children run; a missing ancestor (or a
   * cycle) ends the walk with null.
   * @param {any} rec
   * @returns {any | null}
   */
  #rootOfRecord(rec) {
    let cur = rec;
    const seen = new Set();
    while (lineageParentOf(cur)) {
      if (seen.has(cur.id)) return null;
      seen.add(cur.id);
      const parent = this.records?.byId?.get(lineageParentOf(cur));
      if (!parent) return null;
      cur = parent;
    }
    return cur;
  }

  /**
   * The session a record's spend books on (HarnessV3 Step 5 D6): its own chain, or — for a loop's tick — the chain of
   * the record that started the work, found by following agentOf to it. `parentRequest` is not followed: a summary's slice
   * or a compaction summary is memory's own call, which a session's spend does not book (`booksOnSession`). Null when
   * the ancestry cannot be followed.
   * @param {any} rec
   * @returns {string | null}
   */
  sessionChainOf(rec) {
    /** @param {any} r */
    const up = (r) => r?.agentOf || null;
    let cur = rec;
    const seen = new Set();
    while (up(cur)) {
      if (seen.has(cur.id)) return null;
      seen.add(cur.id);
      const parent = this.records?.byId?.get(up(cur));
      if (!parent) return null;
      cur = parent;
    }
    return cur?.memory?.chain || null;
  }

  afterReply(args) {
    if (!this.brain) return;
    const tr = args?.trace || null;
    tr?.setPhase("after");
    withTrace(tr, () => {
      const run = () => {
        const compacted = this.brain.afterReply(args);
        // A session's turn finished (HarnessV3 Step 5 D7), whichever client ran it: the composition root hears it.
        if (args?.chainId && args.turnId && args.finalMessage) this.#turnFinished(args.chainId, args.turnId, args.stopReason ?? null);
        if (args?.chainId && this.learner) {
          // A chain the learner may not read is not queued at all, and the trace says why rather than promising a
          // run that would only skip.
          const optedOut = this.#optedOut(args.chainId);
          if (!optedOut) this.learner.note(args.chainId);
          const idle = Number(this.cfg().capture?.idleMinutes) || 30;
          const model = this.modelFor({ chainId: args.chainId }).model;
          // A compaction the client adopted learns now (M7-D27): its own summary through this door, once its row is
          // written (an empty reply writes none).
          const learning = compacted ? this.compacted(compacted, { door: "client" }) : null;
          if (learning?.learning)
            tr?.step("learning starts now", { session: compacted || args.chainId, why: "the session compacted", model: learning.model });
          else if (learning) tr?.step("learning off", { note: learning.why });
          else if (this.cfg().capture?.learn === false)
            tr?.step("learning off", { note: "learning from sessions is off in Memory settings" });
          else if (optedOut) tr?.step("learning off", { note: optedOut });
          else
            tr?.step("learning queued", {
              session: args.chainId,
              when: `once this session is idle for ${idle} min`,
              model: model || "none (no model memory can call)",
              note: "memory's model then reads the new turns and extracts a title, an end state and durable items; those calls show under Memory → Activity",
            });
        }
      };
      if (tr)
        tr.spanSync("after the reply", run, {
          note: "bookkeeping once the client has its answer; not on the critical path",
        });
      else run();
    });
  }
  /**
   * A compaction a window adopted was written on a session (HarnessV3-Memory M7-D27): whichever door wrote it — the
   * harness's line, Compact now or `/autofit`, a client's own summary — the turns it stands
   * for are learned now, off the hot path, before the session goes on without them. Answers in words for the door's
   * note, op and trace: learning now (on `model`), or `why` not — memory off, learning off, the session opted out or
   * muted, no learning model.
   * @param {string} chainId @param {{ door: string }} o
   * @returns {{ learning: true, model: string } | { learning: false, why: string }}
   */
  compacted(chainId, { door }) {
    const off = this.#learningOff(chainId);
    if (off) return off;
    this.learner.learnChain(chainId, { reason: "compaction", door }).catch(() => {});
    return { learning: true, model: this.modelFor({ chainId }).model };
  }
  /**
   * Why a session's compaction learns nothing now, the widest switch first (the one to turn on first), or null when it
   * learns.
   * @param {string} chainId @returns {{ learning: false, why: string } | null}
   */
  #learningOff(chainId) {
    if (!this.learner) return { learning: false, why: "memory is off: nothing learns" };
    if (this.cfg().capture?.learn === false) return { learning: false, why: "learning from sessions is off in Memory settings" };
    const optedOut = this.#optedOut(chainId);
    if (optedOut) return { learning: false, why: optedOut };
    if (!this.modelFor({ chainId }).model) return { learning: false, why: this.#whyNoModel(chainId) };
    return null;
  }
  /**
   * Why the learner may not read a chain (`learningOptOut`), or null: read as the meta keys it reads, not the chain
   * whole — every reply of every agent asks (its turn's learning is queued), and the meta grows with the chat — and
   * whether Memory settings leave the chat out (brain.js `chatLeftOut`).
   * @param {string} chainId
   */
  #optedOut(chainId) {
    return learningOptOut(this.archive?.metaOf(chainId, OPT_OUT_KEYS), this.turnsAsideWhy(chainId));
  }
  /**
   * Why a chat's turns are its own alone, in words (brain.js `turnsAsideWhy`: Memory settings leave it out, or turn
   * capture is off and Filament composes it) — or null: memory reads them, or has not started. One that could not be
   * read is said so: nothing reads its turns.
   * @param {string} chainId
   */
  turnsAsideWhy(chainId) {
    if (!this.brain) return null;
    try {
      return this.brain.turnsAsideWhy(chainId);
    } catch (e) {
      this.log("warn", `memory: whether a chat's turns are its own alone could not be read (${String(e?.message || e).slice(0, 120)})`);
      return "Memory settings could not be read";
    }
  }
  /**
   * Why memory learns nothing from a chat now, in words — or null where it does: turn capture is off and the chat is an
   * outside client's, none of whose new turns memory keeps, else the learner's own answer (`#learningOff`: memory not
   * started, learning off in Memory settings, the session opted out or muted, its turns its own alone, no learning
   * model). The harness's Memory pill says it. @param {string} chainId
   */
  learningOffWhy(chainId) {
    const id = String(chainId);
    const head = this.learner && this.cfg().capture?.turns === false ? this.archive?.chainHead(id) : null;
    if (head && !head.native) return "turn capture is off in Memory settings: none of its new turns is kept";
    return this.#learningOff(id)?.why ?? null;
  }
  // The dashboard's benchmark: memory's cost per request (from the traces on the records), memory's own model
  // calls, and the learner's recent runs.
  benchmark(records = [], { limit = 100 } = {}) {
    const traced = records
      .filter((r) => r.memoryTrace && r.status !== "pending")
      .slice(-limit)
      .reverse();
    const usedOf = (id) => {
      if (!this.archive) return null;
      const rows = this.archive.injections.forRequest?.(id) || [];
      if (!rows.length) return null;
      return rows.some((x) => x.used === true) ? true : rows.every((x) => x.used === false) ? false : null;
    };
    const rows = traced.map((r) => {
      const s = r.memoryTrace.summary || {};
      const m = r.memory || {};
      return {
        id: r.id,
        ts: r.ts,
        model: r.model,
        upstream: r.upstream,
        status: r.status,
        client: m.client,
        position: m.position,
        chain: m.chain,
        turn: m.turn,
        command: m.command || undefined,
        blockingMs: r.memory ? s.blockingMs : undefined,
        afterMs: s.afterMs,
        toolRounds: s.toolRounds,
        toolMs: s.toolMs,
        engineCalls: s.engineCalls,
        engineMs: s.engineMs,
        engineErrors: s.engineErrors,
        tokens: m.tokens || 0,
        briefing: m.briefing || 0,
        injected: m.injected || 0,
        ttftMs: r.ttftMs,
        totalMs: r.totalMs,
        used: m.tokens ? usedOf(r.id) : null,
        stayedOut: !r.memory
          ? r.memoryTrace.steps.find((x) => x.name === "memory stays out")?.why ||
            "no memory for this request"
          : undefined,
      };
    });
    const withMem = rows.filter((x) => typeof x.blockingMs === "number" && !x.command); // commands never reach an upstream: not part of the cost picture
    const sorted = withMem.map((x) => x.blockingMs).sort((a, b) => a - b);
    const pct = (q) =>
      sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] : null;
    const timed = withMem.filter((x) => x.totalMs);
    const engineCalls = withMem.reduce((n, x) => n + (x.engineCalls || 0), 0);
    const judged = rows.filter((x) => x.used === true || x.used === false);
    const stats = {
      requests: rows.length,
      withMemory: withMem.length,
      blockingP50: pct(0.5),
      blockingP95: pct(0.95),
      blockingMax: pct(1),
      shareOfTotal: timed.length
        ? Math.round(
            (timed.reduce((n, x) => n + x.blockingMs, 0) / timed.reduce((n, x) => n + x.totalMs, 0)) * 1000,
          ) / 10
        : null,
      enginePerCallMs: engineCalls
        ? Math.round((withMem.reduce((n, x) => n + (x.engineMs || 0), 0) / engineCalls) * 10) / 10
        : null,
      engineCalls,
      engineErrors: withMem.reduce((n, x) => n + (x.engineErrors || 0), 0),
      tokensAvg: withMem.length
        ? Math.round(withMem.reduce((n, x) => n + (x.tokens || 0), 0) / withMem.length)
        : 0,
      toolRounds: withMem.reduce((n, x) => n + (x.toolRounds || 0), 0),
      toolMs: withMem.reduce((n, x) => n + (x.toolMs || 0), 0),
      usedRate: judged.length
        ? Math.round((judged.filter((x) => x.used).length / judged.length) * 100)
        : null,
      judged: judged.length,
    };
    const modelCalls = records
      .filter((r) => r.memoryFor && r.status !== "pending")
      .slice(-limit)
      .reverse()
      .map((r) => ({
        id: r.id,
        ts: r.ts,
        purpose: r.memoryFor.purpose,
        chain: r.memoryFor.chain || null,
        model: r.model,
        upstream: r.upstream,
        tokens: r.tokens,
        cost: r.cost,
        totalMs: r.totalMs,
        status: r.status,
      }));
    const learning = this.learner
      ? {
          runs: this.learner.recent.slice(0, limit),
          stats: { ...this.learner.stats, pending: this.learner.pending.size },
          idleMinutes: Number(this.cfg().capture?.idleMinutes) || 30,
          model: this.modelFor({}).model || null,
        }
      : null;
    return { rows, stats, modelCalls, learning };
  }
  learn(chainId, opts = {}) {
    if (!this.learner) throw new Error("memory is off or has not started: the learner does not run");
    return this.learner.learnChain(chainId, { reason: "manual", force: true, uncapped: true, ...opts });
  }

  // ---- a session's settings document and its per-session policy (policy.js) ------------------------------------------
  // One store for every client (HarnessV3 Step 1): the chat commands read from and write to the session's
  // settings document — the same layers the harness inspector and the dashboard's session pages write — never a
  // second policy column on the chain.
  docFor(chainId = null) {
    return this.policies.docFor(chainId);
  }
  /**
   * The one writer for a session's own layer (D7): every surface — the chat commands, the harness and dashboard
   * editors, the create's held changes, the facade's per-turn settingsPatch — writes through here. Validates
   * for the session layer, writes, mirrors the knobs whose effect lives outside the document, and records one
   * operation (kind archive, sub session-settings): "session X: a, b changed (via)". Display knobs are not audited
   * (a write that changes only them records nothing); the harness marks sessions read and unread constantly.
   * @param {string} chainId @param {{ patch?: any, unset?: string[] }} change
   * @param {{ via?: string, audit?: boolean, title?: string, card?: boolean }} [o] `title` overrides the operation's
   *   line (a create says what it started with, not which knobs it set); `card` asks for the change card (Facade D4),
   *   which only the chat commands that answer with one need
   * @returns {{ layer: any, changes: { path: string, from: any, to: any, live: boolean }[], errors: string[], card?: any }}
   */
  patchSessionSettings(chainId, { patch = {}, unset = [] } = {}, { via = "settings", audit = true, title = null, card = false } = {}) {
    const kept = teamChatKeeps(this.archive?.getChain?.(String(chainId)), this.archive?.chainSettings?.(String(chainId)), patch, unset);
    if (kept) return { layer: null, changes: [], errors: [kept] };
    // The card needs both states, so the state before the write is read only when a card was asked for.
    const before = card ? this.#cardState(chainId) : null;
    // Who answered before, read only where the write names the engine.
    const ledBefore = touchesEngine(patch, unset) ? leaderOf(this.docFor(String(chainId)).effective) : undefined;
    const r = this.policies.patchSession(chainId, { patch, unset });
    if (r.errors.length || !r.changes.length) return r;
    this.#mirrorSession(chainId, r.changes);
    if (ledBefore !== undefined) this.#markEngine(String(chainId), ledBefore);
    if (before) r.card = settingsChangeCard(before, this.#cardState(chainId), { changes: r.changes });
    if (audit) {
      const named = r.changes.filter((c) => !c.path.startsWith("display."));
      if (named.length)
        this.#archiveOp(title || `session ${chainId}: ${changeTitle(named)} (${via})`, {
          sub: "session-settings",
          detail: { chainId, changes: changeLines(named), via },
          ref: { chainId },
        });
    }
    this.sessionLists?.clear?.();
    // Every page open on the session hears its document moved — the dashboard's editor, another tab, a `/set` —
    // and reads it afresh (BUG-10 P9: the Agents panel's default line stayed stale until the next turn ended). The
    // server sends it on the events feed, with the new hash. `unarchived`: the write brought the chat back from the
    // archive, which lets go of what held it at rest (server.js `heldAtStart`).
    this.onSessionEvent?.(chainId, { type: "settings", ...(r.changes.some((c) => c.path === "display.archived" && c.from && !c.to) ? { unarchived: true } : {}) });
    return r;
  }
  /**
   * A switch of who answers the session — a team's lead, or the agent — marked on the chat with the turn it follows
   * (Bug Hunter #13, 10-19: a chat handed back to the same team with no turn between drew no divider, and its
   * "Leading for" counted from the first take-over). The page reads them with the transcript's other boundaries.
   * @param {string} chainId @param {string | null} ledBefore  the team that led before the write, null for the agent
   */
  #markEngine(chainId, ledBefore) {
    const a = this.archive;
    const led = leaderOf(this.docFor(chainId).effective);
    if (!a || led === ledBefore) return;
    a.appendMeta(chainId, "engineMarks", { from: ledBefore, to: led, at: this.now(), afterTurn: a.newestTurnN(chainId) }, ENGINE_MARKS);
  }
  /**
   * One state of a change card (Facade D4): the document's values and their layers as they stand now — read once
   * before a write and once after it.
   * @param {string} chainId
   */
  #cardState(chainId) {
    const doc = this.docFor(String(chainId));
    return { flat: doc.flat, sources: doc.sources };
  }

  /**
   * The knobs whose effect lives outside the document, mirrored where their readers look (D7): memory.enabled into the
   * chain's muted flag, display.* into the sidebar's chain-meta flags, model.name into the chain's model column, privacy into the learner's guard and the search index. The mirror is written, never
   * read back. `muted` mirrors the session's OWN choice only — set exactly when the session's layer holds
   * memory.enabled false — so a global off/on never leaves a session muted behind it.
   * @param {string} chainId @param {{ path: string, to: any }[]} changes
   */
  #mirrorSession(chainId, changes) {
    const a = this.archive;
    if (!a) return;
    let learn = false, index = false;
    /** @type {Record<string, any>} */
    const flags = {};
    for (const c of changes) {
      if (c.path === "memory.enabled") {
        try {
          this.brain?.mute(chainId, c.to === false);
        } catch (/** @type {any} */ e) {
          this.log("warn", `memory: ${chainId} mirror of memory.enabled failed: ${e.message}`);
        }
      }
      if (c.path === "display.pinned") flags.pinned = c.to ? true : undefined;
      if (c.path === "display.archived") flags.archived = c.to ? true : undefined;
      if (c.path === "display.unread") flags.unread = c.to ? true : undefined;
      if (c.path === "display.title") {
        a.setTitle(chainId, typeof c.to === "string" && c.to ? c.to : null);
        // A name of the person's: Filament's mark goes, and the side model never names the chat (app/chat-namer.js).
        flags.autoNamed = undefined;
      }
      if (c.path === "model.name") a.setChainModel(chainId, typeof c.to === "string" && c.to ? c.to : null);
      if (c.path === "memory.learn" || c.path === "privacy.learn") learn = true;
      if (c.path === "memory.index" || c.path === "privacy.index") index = true;
    }
    if (Object.keys(flags).length)
      try {
        a.mergeMeta(chainId, flags);
        // The teams beside a chat are archived with it, and come back with it (team_v2_plan §9 Q9).
        if ("archived" in flags) for (const id of a.besideOf(chainId)) a.mergeMeta(id, { archived: flags.archived });
      } catch (/** @type {any} */ e) {
        this.log("warn", `memory: ${chainId} mirror of ${Object.keys(flags).join(", ")} failed: ${e.message}`);
      }
    if (learn || index) this.assertPrivacy(chainId, { learn, index });
  }
  /**
   * Bring a chain's privacy flags in line with its effective document: meta.noLearn (the learner's guard) and the
   * search index (meta.noIndex, rows out or back in). Called by the session writer, the project writer and the harness
   * turn — the effective value may come from a layer no session-level mirror sees change. Writes only on a difference,
   * so the index is never rebuilt for nothing.
   * @param {string} chainId @param {{ learn?: boolean, index?: boolean }} [which]
   */
  assertPrivacy(chainId, { learn = true, index = true } = {}) {
    try {
      const a = this.archive;
      if (!a) return;
      const chain = a.getChain(chainId);
      if (!chain) return;
      const eff = this.docFor(chain.id).effective;
      const noLearn = eff.memory?.learn === false || eff.privacy?.learn === false;
      const noIndex = eff.memory?.index === false || eff.privacy?.index === false;
      if (learn && !!chain.meta?.noLearn !== noLearn) a.mergeMeta(chain.id, { noLearn: noLearn ? true : undefined });
      if (index && !!chain.meta?.noIndex !== noIndex) a.setChainIndexed(chain.id, !noIndex);
    } catch (/** @type {any} */ e) {
      this.log("warn", `memory: ${chainId} privacy flags could not be asserted: ${e.message}`);
    }
  }
  /**
   * The one writer for a project's layer (D7): repo facts only (validateLayer's rule), privacy pushed to the project's
   * chains as today, one project-settings operation.
   * @param {string} projectId @param {{ patch?: any, unset?: string[] }} change
   * @returns {{ layer: any, changes: { path: string, from: any, to: any, live: boolean }[], errors: string[] }}
   */
  patchProjectSettings(projectId, { patch = {}, unset = [] } = {}) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    const a = this.archive;
    const project = a.getProject(String(projectId || ""));
    if (!project) throw refused("not-found", "no such project");
    const cur = a.projectSettings(project.id);
    const r = applyPatch(cur, { patch, unset: Array.isArray(unset) ? unset.map(String) : [] }, { at: "project" });
    if (r.errors.length) return { layer: unflatten(flatten(cur)), changes: [], errors: r.errors };
    if (r.changes.length) {
      // setProjectSettings merges top-level keys, so only the knobs' sections are written, and a section the patch
      // emptied arrives as undefined to go. Every other key the row keeps (the learner's approval counts) stays as
      // stored: through dotted paths, a count for `write: *.md` would come back split at its dot.
      /** @type {Record<string, any>} */
      const next = {};
      for (const k of new Set([...Object.keys(cur), ...Object.keys(r.layer || {})])) if (SECTIONS.has(k)) next[k] = r.layer?.[k];
      a.setProjectSettings(project.id, next);
      this.#archiveOp(`project ${project.id}: ${changeTitle(r.changes)} (project settings)`, {
        sub: "project-settings",
        detail: { projectId: project.id, changes: changeLines(r.changes) },
      });
      const learn = r.changes.some((c) => c.path === "memory.learn" || c.path === "privacy.learn");
      const index = r.changes.some((c) => c.path === "memory.index" || c.path === "privacy.index");
      if (learn || index) for (const chain of a.chainsForProject(project.id, { limit: 100_000 })) this.assertPrivacy(chain.id, { learn, index });
    }
    return { layer: a.projectSettings(project.id), changes: r.changes, errors: [] };
  }
  /** The slice pass's configuration (Rules → trim), the same for every session. */
  sliceConfig() {
    return sliceConfigOf(this.getConfig());
  }
  /**
   * Record one of Filament's own texts for a session (D11): every reply it writes itself in the chat, and every cue it
   * places in front of one. The SHA-256 of the normalized text — line endings as \n, trimmed — is what lands in the
   * archive's local_texts; no text is stored. Never throws: a text that cannot be recorded only fails to drop out
   * later, which is the safe direction.
   * @param {string} chainId @param {"reply" | "prefix"} kind @param {string} text
   */
  recordLocalText(chainId, kind, text) {
    const norm = String(text ?? "").replace(/\r\n?/g, "\n").trim();
    if (!this.archive || !chainId || !norm) return null;
    return this.#bookkeep("recording Filament's own text", () => this.archive.addLocalText(chainId, sha256(norm), kind), null);
  }
  /**
   * Leave Filament's own texts out of what the model sees (D11): an assistant message whose whole text matches a
   * recorded reply goes, together with the person message before it when it is one (a tool result stays); an
   * assistant message whose first text starts with a recorded prefix loses that prefix and the blank line after it.
   * The client still shows the exchange — this only shapes what its model is asked with. What situate derived from the
   * body (the scan, newestIndex, newest) is refreshed, so every later stage sees one consistent body. Returns how
   * many messages were removed or un-prefixed.
   * @param {any} sit @param {string} chainId
   */
  dropLocalTexts(sit, chainId) {
    try {
      const rows = this.archive?.localTexts?.(String(chainId || "")) || [];
      if (!rows.length || !sit || !Array.isArray(sit.body?.messages)) return 0;
      const replies = new Set(rows.filter((r) => r.kind !== "prefix").map((r) => r.hash));
      const prefixes = new Set(rows.filter((r) => r.kind === "prefix").map((r) => r.hash));
      if (!replies.size && !prefixes.size) return 0;
      const norm = (s) => String(s ?? "").replace(/\r\n?/g, "\n").trim();
      const hash = (s) => sha256(norm(s));
      const isToolResultUser = (m) =>
        Array.isArray(m?.content) && m.content.some((b) => b?.type === "tool_result");
      let touched = 0;
      const msgs = sit.body.messages;
      const oneTextBlock = (m) =>
        typeof m?.content === "string" ||
        (Array.isArray(m?.content) && m.content.every((b) => b?.type === "text") && m.content.length <= 1);
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        // A tool call in the message means the next message is its tool result: splicing the assistant message
        // would orphan it and the provider would refuse the body. Such a message is never Filament's own reply
        // anyway (its answers carry no calls).
        if (m?.role !== "assistant" || messageKind(m) === "tool_use") continue;
        const whole = norm(textOfMessage(m));
        if (!whole) continue;
        if (replies.has(hash(whole))) {
          const prev = msgs[i - 1];
          const withPerson = prev && prev.role === "user" && !isToolResultUser(prev) ? 1 : 0;
          msgs.splice(i - withPerson, 1 + withPerson);
          touched += 1 + withPerson;
          continue;
        }
        if (prefixes.size && oneTextBlock(m)) {
          let raw = String(textOfMessage(m) ?? "");
          // More than one of Filament's recorded lines can sit in front of one reply in a client's history, so the
          // leading recorded prefix is stripped repeatedly — a single cut would leave the next line riding the history
          // to the model forever.
          let cut = 0;
          for (let guard = 0; guard < 4; guard++) {
            const at = raw.indexOf("\n\n");
            if (at <= 0 || !prefixes.has(hash(raw.slice(0, at)))) break;
            raw = raw.slice(at + 2);
            cut = 1;
          }
          if (cut) {
            if (typeof m.content === "string") m.content = raw;
            else if (Array.isArray(m.content)) {
              // The block's copy in its place, never the block changed: a composed request's blocks are its turns', which
              // a composition weighs once and keeps (tokens.js `createBlockWeights`).
              const first = m.content.findIndex((b) => b?.type === "text");
              if (first >= 0) m.content[first] = { ...m.content[first], text: raw };
              else m.content.unshift({ type: "text", text: raw });
            }
            touched++;
          }
        }
      }
      if (touched) this.resituateBody(sit);
      return touched;
    } catch (/** @type {any} */ e) {
      this.log("warn", `memory: could not leave Filament's own texts out of the request (${e.message.slice(0, 120)})`);
      return 0;
    }
  }
  /**
   * One consistent body for every later stage after a stage reshaped the request's messages (Filament's own texts
   * dropped): the scan and the newest-message facts are re-derived
   * from what is there now. The key and the fingerprint stay as situate computed them — they named the session.
   * @param {any} sit
   */
  resituateBody(sit) {
    if (!sit || !Array.isArray(sit.body?.messages)) return;
    sit.scan = createConversationScan(sit.format, sit.body, sit.responsesBody || null);
    sit.newestIndex = newestUserIndex(sit.format, sit.body);
    sit.newest = sit.newestIndex >= 0 ? personTextAt(sit.body, sit.newestIndex) : "";
  }
  goalFor(chainId) {
    return this.policies.goalFor(chainId);
  }
  setGoal(chainId, goal) {
    return this.policies.setGoal(chainId, goal);
  }

  /**
   * The slice cache the pass reads and writes (trim.js's contract: get(key) → text | null, put(key, { text, tokens,
   * chars, model })). The archive stores each summary as a sealed message and keeps only the hash and size in
   * trim_slices; content-addressed, so the same excerpt summarized once is never paid for again, whichever pass meets it.
   * @param {string} model  the model named on a stored row when the pass names none
   */
  #sliceCache(model) {
    return {
      get: (/** @type {string} */ h) => {
        try {
          return this.archive.trimSlice(h)?.summary || null;
        } catch {
          return null;
        }
      },
      put: (/** @type {string} */ h, /** @type {any} */ v) => {
        try {
          this.archive.trimSlicePut(h, {
            summaryText: typeof v === "string" ? v : v?.text,
            tokens: v?.tokens ?? null,
            model: v?.model || model,
          });
        } catch (/** @type {any} */ e) {
          this.log("warn", `memory: could not cache a slice summary (${e.message.slice(0, 100)})`);
        }
      },
    };
  }
  /**
   * A summary of messages that outgrew one call, made by the slice pass (the compactor's summary when the
   * turns it condenses are bigger than the writer's slice budget): sequential slices sized to the
   * writer's window, the summaries carried forward and rolled into one digest past the cap, hollow replies retried
   * smaller, every good slice cached. A turn bigger than one slice is cut at its steps into parts that fit, so
   * every part of it is read; a message of words longer than the pass's cap on one message —
   * the summary the pass continues from, a turn's fold — is read in pieces (`wordsInPieces`), all of it. Returns the
   * joined text ("" when nothing landed) and the pass's figures. `jobId` names the compaction each call is part of,
   * and `onProgress` hears each step ("summarizing slice 2 …"), for the compaction's progress
   * (HarnessV3-FailurePoints §5.1 item 3).
   * @param {{ chainId?: string | null, messages: any[], model: string, windowTokens: number, signal?: AbortSignal | null, jobId?: string | null,
   *   onProgress?: import("../../core/ports.js").ProgressSink }} a
   */
  async sliceSummarize({ chainId = null, messages, model, windowTokens, signal = null, jobId = null, onProgress = () => {} }) {
    const { text, pass, notes } = await summarizeInSlices({
      messages,
      policy: this.sliceConfig(),
      windowTokens,
      callModel: (a) => this.callModel({ ...a, model, purpose: "compact", chainId, signal, jobId }),
      cache: this.#sliceCache(model),
      onProgress,
      signal,
      model,
    });
    return { text, calls: pass.calls, cached: pass.cached, slices: pass.slices.length, written: pass.written, endedBy: pass.endedBy, notes };
  }
  // The session a request belongs to, without running the whole prepare pass. Read-only twin of chainIdFor: the chain if it exists, never created (count_tokens and dashboards use this).
  lookupChainId(sit) {
    try {
      return this.archive && sit?.key ? this.archive.chainIdForKey(sit.key) : null;
    } catch {
      return null;
    }
  }

  // ---- a session's windows (HarnessV3 Step 3): a request's intent, a client's rewind, stops ------------------------
  /** What this request is to its session (D12): one answer for prepare and alignHistory.
   *  @param {any} sit @returns {"turn" | "leg" | "compaction" | "none"} */
  turnIntent(sit) {
    if (!this.brain) return "none";
    return this.#bookkeep("telling what this request is to its session", () => this.brain.turnIntent(sit), "none");
  }
  /**
   * Session bookkeeping that rides a live request (the window marks, the intent, a stopped turn's stamp): it must
   * never fail the request, and it must never fail silently — a failure is logged and the fallback answers.
   * @template T @param {string} what @param {() => T} fn @param {T} [fallback]
   * @returns {T}
   */
  #bookkeep(what, fn, fallback = /** @type {any} */ (null)) {
    try {
      return fn();
    } catch (/** @type {any} */ e) {
      this.log("warn", `memory: ${what} failed (${String(e?.message || e).slice(0, 160)})`);
      return fallback;
    }
  }

  /**
   * Where a window's history stands against the archive (D9): which of this window's own turns the history still
   * holds (matched in order, by the pin identity D3), and whether it rewound a line (D11) — marked right here, because
   * every later turn was built on the dropped ones. A request that opens a turn is told what it comes beside first
   * (`#beside`: `sit.alongside`, `sit.joinsRunning`), which its turn's opening reads too. Pure over the body and the
   * archive apart from that one mark. Runs before anything else prepare does. Never runs for the harness's own turns
   * (their history was composed from the archive already), nor Filament's internal machinery. Reads the per-turn stamps
   * (meta.key) off the rows, never a message body.
   * @param {any} sit
   * @returns {{ intent: string, matched: { n: number, index: number }[], rewind: { from: number, to: number, line: string } | null }}
   */
  alignHistory(sit) {
    const none = { intent: "none", matched: [], rewind: null };
    try {
      if (!this.archive || !sit || !Array.isArray(sit.body?.messages)) return none;
      if (sit.composed || isMachineryRequest(sit.headers)) return none;
      const chainId = sit.chainRef || this.lookupChainId(sit);
      if (!chainId) return none;
      // Its key is all of the chain read here (every request of a proxied chat lines up), never its growing meta.
      const chain = this.archive.chainHead(chainId);
      if (!chain) return none;
      const window = sit.window || Archive.turnWindow(null, chain);
      const intent = this.turnIntent(sit);
      // Only a new turn can rewind a line: a request that opens none (every tool leg, a compaction request) reads no
      // turns at all.
      if (intent !== "turn") return { ...none, intent };
      // The window's horizon (D9): its newest compaction (stamped with a window; one written with none, an import's, by
      // kind — plain/manual/brief count as the harness's, every other kind as the chain's first window's). The turns up
      // to it are out of the window's history.
      let horizon = 0;
      for (const c of this.archive.getCompactions(chainId)) {
        // A preview no window adopted (door `now`) left nothing out of its window.
        if (c.detail?.door === "now") continue;
        const stamped = c.window ? c.window === window : ["plain", "manual", "brief"].includes(c.kind) ? window === "harness" : window === chain.key;
        if (stamped && Number(c.to_turn) > horizon) horizon = Number(c.to_turn);
      }
      // Each turn's marks alone (`turnMarks`): its window — its own stamp, else the rule — whether it is finished, a
      // command's or rewound, and its pin, the archive's one answer (its D3 stamp). No turn is read whole, however long
      // the chat: this runs on each of its turns.
      const marks = this.archive.turnMarks(chainId);
      const rows = marks.filter((t) => !t.rewound);
      const own = rows.filter((t) => t.window === window && t.n > horizon);
      const ownFinished = own.filter((t) => t.finished && !t.command);
      // Matching in order (D3): each own finished turn matches the first person message at or after the previous
      // match with the same pin identity. Repeated texts ("continue") are told apart by the order.
      const msgs = sit.body.messages;
      const personIdx = [];
      for (let i = 0; i < msgs.length; i++) if (isBlockEligibleUser(msgs[i], sit.format)) personIdx.push(i);
      const pins = personIdx.map((i) => pinHashOf(msgs[i]));
      // What the request comes beside, told before its turn opens (`beginTurn` reads both).
      const beside = this.#beside(chainId, window, marks, msgs, personIdx, pins);
      sit.alongside = beside.alongside;
      sit.joinsRunning = beside.joinsRunning;
      /** @type {{ n: number, index: number }[]} */
      const matched = [];
      let from = 0;
      for (const t of ownFinished) {
        const at = pins.indexOf(t.pin, from);
        if (at === -1) continue;
        matched.push({ n: t.n, index: personIdx[at] });
        from = at + 1;
      }
      const matchedNs = new Set(matched.map((m) => m.n));
      let unmatchedOwn = ownFinished.filter((t) => !matchedNs.has(t.n));
      // Ambiguity is not a rewind (D9's no-guess rule): a turn the in-order pass did not consume whose pin the
      // history still holds somewhere — a trimmed history whose first kept message repeats an earlier turn's text,
      // which greedy in-order matching binds to the wrong copy — says the history and the archive cannot be lined
      // up with certainty. Nothing is marked.
      if (matched.length && unmatchedOwn.some((t) => pins.includes(t.pin))) {
        matched.length = 0;
        unmatchedOwn = ownFinished;
      }
      // The front trim: every unmatched own turn sits before the first matched one — a prefix the client cut off its own
      // history, which marks nothing. A history that holds none of the window's own turns is not a trim: it is nothing
      // this archive can line up (a different conversation, or a trim to zero) and takes the no-guess path below.
      const firstMatchedN = matched.length ? matched[0].n : null;
      const prefixOnly = unmatchedOwn.length > 0 && firstMatchedN != null && unmatchedOwn.every((t) => t.n < firstMatchedN);
      // The rewind (D11): the request opens a turn, and the history no longer holds a finished turn of this
      // window's after the horizon — a gap after the newest one it still holds (an edit or rewind), or its newest
      // finished turn matched the newest person message itself with no reply after it (a regenerate). From that turn
      // on, the line drops each turn the history no longer holds — of any window, since a later turn was built on the
      // dropped one — and keeps each it still holds, finished or not, matched in order after the newest turn it holds
      // before the line: a turn the history holds past a dropped one ran beside it (the conversation going on beside a
      // fork of it) and was built on none of it. The request's own new message holds no finished turn — a regenerate
      // drops the turn it asks again — only one that never finished, which the request goes on with. A request
      // alongside a running turn rewinds nothing itself — its history need not hold what that turn is still doing.
      let rewind = null;
      if (ownFinished.length && !prefixOnly && !sit.alongside) {
        let fromN = null;
        if (unmatchedOwn.length && matched.length) fromN = Math.min(...unmatchedOwn.map((t) => t.n));
        else if (matched.length) {
          const last = matched[matched.length - 1];
          const lastPerson = personIdx[personIdx.length - 1];
          if (last.index === lastPerson && lastPerson === msgs.length - 1) fromN = last.n; // the reply is gone: asked again
        }
        if (fromN != null) {
          const line = /** @type {number} */ (fromN);
          const held = matched.filter((m) => m.n < line).at(-1);
          let next = held ? personIdx.indexOf(held.index) + 1 : 0;
          const asks = personIdx.length - 1;
          /** @type {Set<number>} */
          const keep = new Set();
          for (const t of rows.filter((x) => x.n >= line).sort((a, b) => a.n - b.n)) {
            const at = pins.indexOf(t.pin, next);
            if (at === -1 || (at === asks && t.finished)) continue;
            keep.add(t.n);
            next = at + 1;
          }
          rewind = this.markRewound(chainId, { from: line, by: window, keep });
        }
      }
      return { intent, matched, rewind };
    } catch (/** @type {any} */ e) {
      // Never fatal to the request — the history goes on as the client sent it — but never silent either.
      this.log("warn", `memory: the history could not be lined up with the archive (${String(e?.message || e).slice(0, 160)}); nothing marked`);
      return none;
    }
  }

  /**
   * What a request that opens a turn comes beside (D12): its window's own turns at work as it comes. While a request of
   * the window runs a turn as the window's own (`#turnsRunning`: it came beside nothing), any new message of the window
   * comes alongside it: a client's side request of the same conversation — Claude Code's forks of it, a `/btw` question
   * or a prompt suggestion — or the person's own message while such a fork runs; neither says which it is. While none
   * does, a loop that waits on its tools (`loopsWaiting`) is forked by a request whose person message before its own is
   * the loop's, and which holds no more of the loop than the loop's last request did — a fork made of that request,
   * Claude Code's `/btw` while a tool runs. A request alongside opens a turn of its own and rewinds nothing; one that
   * holds the loop's newest reply, or sends its message again, goes on from it, and a turn that comes beside none leaves
   * the window's loops behind — a crashed client's among them, its leg never coming. `joinsRunning`: a request
   * alongside whose person message is a running turn's own — a client's second send while the first still runs —
   * which `beginTurn` files in that turn.
   * @param {string} chainId @param {string} window
   * @param {{ n: number, pin: string, window: any }[]} marks  every turn of the chain (`turnMarks`)
   * @param {any[]} msgs  the request's messages @param {number[]} personIdx  where its person messages are
   * @param {string[]} pins  their pins
   * @returns {{ alongside: boolean, joinsRunning: boolean }}
   */
  #beside(chainId, window, marks, msgs, personIdx, pins) {
    const mine = new Map(marks.filter((t) => t.window === window).map((t) => [t.n, t]));
    const running = [...this.#turnsRunning.values()].filter((r) => r.chain === String(chainId) && mine.has(r.n));
    const own = pins.length ? pins[pins.length - 1] : null;
    const twin = own != null && running.some((r) => mine.get(r.n)?.pin === own);
    let alongside = running.some((r) => !r.alongside);
    if (!alongside && pins.length >= 2 && pins[pins.length - 2] !== own) {
      const before = pins[pins.length - 2];
      let replies = 0;
      for (let i = personIdx[personIdx.length - 2] + 1; i < personIdx[personIdx.length - 1]; i++) if (msgs[i]?.role === "assistant") replies++;
      alongside = this.archive.loopsWaiting(chainId, window, before).some((l) => replies <= l.legs);
    }
    return { alongside, joinsRunning: alongside && twin };
  }

  /**
   * Mark a rewound line (D11): every turn from `from` on — of any window, because later turns were built on the
   * dropped one — gets `meta.rewound = { line, by, at }`. Turns already on an older line keep it. → the line's id
   * and the last turn it marked. `what`: a rewind in place says whether its files went back too (`both`) or stayed
   * (`conversation`, app/sessions/rewind.js). `keep`: turns from `from` on that the history still holds, built on
   * none of the dropped ones (alignment's): they stay on the line.
   * @param {string} chainId @param {{ from: number, by: string, what?: string | null, keep?: Set<number> | null }} o
   */
  markRewound(chainId, { from, by, what = null, keep = null }) {
    const at = this.archiveTurnTime();
    const line = `r${at.toString(36)}${randomBytes(3).toString("hex")}`;
    let to = from;
    for (const t of this.archive.getTurns(chainId)) {
      if (t.n < from || t.meta?.rewound || keep?.has(t.n)) continue;
      this.archive.mergeTurnMeta(t.id, { rewound: { line, by: String(by), at, ...(what ? { what: String(what) } : {}) } });
      to = Math.max(to, t.n);
    }
    return { from, to, line };
  }

  /**
   * Open a rewound line as its own session (D11). The archive owns the operation (`archive.forkLine`: the live
   * turns before the line plus the line itself, the mark removed from the copies); this is the door the API and
   * the UI use (Step 3 D19's line-fork route), and it keeps the same record a fork keeps (`forkSession`): the
   * session lists refreshed and one durable line. → the fork row, or { error }.
   * @param {string} chainId @param {string} line
   */
  forkLine(chainId, line) {
    let r;
    try {
      r = this.archive.forkLine(chainId, line);
    } catch (/** @type {any} */ e) {
      return { error: String(e?.message || e) };
    }
    if (r?.error) return r;
    this.sessionLists?.clear?.();
    this.#archiveOp(`session ${r.forkedFrom}: rewound line ${line} opened as ${r.id} (${r.copied.turns} turn(s))`, {
      sub: "fork",
      detail: { chainId: r.forkedFrom, forkId: r.id, atTurn: r.atTurn, line: String(line), ...r.copied },
      ref: { chainId: r.id },
    });
    return r;
  }
  /** A wall-clock for the rewind mark (the archive's own injected clock, so tests are deterministic). */
  archiveTurnTime() {
    return typeof this.archive?.now === "function" ? this.archive.now() : Date.now();
  }
  /**
   * The person pressed Stop (HarnessV4_Four_Plan FO-D50): `meta.lastStop = { turn, at }`, `turn` the chain's newest
   * turn then. Until a newer turn begins, Filament starts no turn of its own in the chat (a background command's end
   * waits for the next message). Kept whichever way the stop lands — steered, forced or cancelled — and where it found
   * no turn of the harness's to stop.
   * @param {string} chainId
   */
  markLastStop(chainId) {
    this.#bookkeep("marking the person's stop", () =>
      this.archive.mergeMeta(chainId, { lastStop: { turn: this.archive.newestTurnN(chainId), at: this.archiveTurnTime() } }));
  }
  /**
   * Stamp the turn a stopped run belongs to: `meta.stopped = { by, at, forced? }` (§5's turn meta). The turn is found by
   * the request that ran it.
   * @param {string} chainId @param {{ requestId?: string | null, by?: string, forced?: boolean }} o
   */
  markStopped(chainId, { requestId = null, by = "harness", forced = false } = {}) {
    this.#bookkeep("stamping the stopped turn", () => {
      const turns = this.archive.getTurns(chainId);
      // A named request that matches nothing stamps nothing: the fallback to the newest turn would mark an
      // unrelated turn under a race (the request belongs to another session or never archived).
      const t = requestId ? turns.find((x) => (x.requestIds || []).includes(String(requestId))) : turns.at(-1);
      // A Force stop says so (HarnessV3-FixRound F2 item 13): the turn did not wait for the loop's next step.
      if (t) this.archive.mergeTurnMeta(t.id, { stopped: { by: String(by), at: this.archiveTurnTime(), ...(forced ? { forced: true } : {}) } });
    });
  }
  /**
   * The one creator of a chain for a live request (D6): memory's prepare and the chat commands both come here. Imports, forks and the harness's explicit create keep calling the archive themselves, because they
   * decide their own settings. A new chain starts from your defaults, its own layer empty. `dry` writes nothing: it
   * returns the existing chain, or a stand-in row (`id: "dry"`).
   * @param {any} sit @param {{ dry?: boolean }} [o]
   */
  chainFor(sit, { dry = false } = {}) {
    if (!this.archive || !sit?.key) return null;
    const lookup = chainLookup(sit);
    if (dry) {
      const found = this.archive.recentChains({ limit: 10000 }).find((c) => c.key === sit.key);
      return (
        (found && this.archive.getChain(found.id)) || {
          id: "dry",
          key: sit.key,
          turns: 0,
          meta_json: null,
          blocks_json: null,
          briefing: null,
          project_id: lookup.project || "none",
        }
      );
    }
    try {
      return this.archive.chainForKey(sit.key, lookup);
    } catch {
      return null;
    }
  }
  chainIdFor(sit) {
    return this.chainFor(sit)?.id || null;
  }
  // ---- cleanup: deleting removes the archive rows; engine twins of the deleted learned items are forgotten
  // best-effort (the engine itself is untouched otherwise).
  // A forget that fails must be said out loud: the person asked for something to be gone, and the returned count
  // alone does not say that some of it is still in the engine, or why.
  async #forgetAll(memoryIds) {
    let forgotten = 0;
    const failed = [];
    for (const id of memoryIds || []) {
      try {
        await this.store?.forget?.(id);
        forgotten++;
      } catch (e) {
        failed.push(`${String(id).slice(0, 24)}: ${String(e?.message || e).slice(0, 80)}`);
      }
    }
    if (failed.length)
      this.log(
        "warn",
        `memory: ${failed.length} of ${(memoryIds || []).length} learned item(s) could not be forgotten in the engine — deleted from the archive, but they may still be recalled (${failed.slice(0, 3).join("; ")}${failed.length > 3 ? "; …" : ""})`,
      );
    return forgotten;
  }
  async deleteSession(chainId) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    // The teams beside it go with it (team_v2_plan §9 Q9): read before its links go.
    const beside = this.archive.besideOf(String(chainId));
    const r = this.archive.deleteChain(chainId);
    if (!r) throw new Error("no such session");
    const gone = [String(r.id)];
    for (const id of beside) {
      const t = this.archive.deleteChain(id);
      if (!t) continue;
      gone.push(String(t.id));
      r.turns += t.turns;
      r.items += t.items;
      r.memoryIds.push(...t.memoryIds);
    }
    // One an import made is remembered as removed: a Sync does not bring it back.
    noteRemoved(this.archive, [r.key]);
    this.sessionLists?.clear?.();
    this.#sessionsDeleted(gone);
    const forgotten = await this.#forgetAll(r.memoryIds);
    // Deleting a session is destructive and irreversible, so it gets a durable line: which session, and how much of it
    // went away. Counts and the id only — a session title is user text and ops.jsonl is kept for weeks.
    this.#archiveOp(`archived session ${r.id} deleted: ${r.turns} turn(s), ${r.items} item(s)`, {
      sub: "delete-chain",
      level: "warn",
      detail: {
        chainId: r.id,
        turns: r.turns,
        items: r.items,
        forgotten: Array.isArray(forgotten) ? forgotten.length : Number(forgotten) || 0,
        ...(beside.length ? { beside: beside.length } : {}),
      },
      ref: { chainId: r.id },
    });
    return { deleted: "session", id: r.id, turns: r.turns, items: r.items, forgotten, ...(beside.length ? { beside: beside.length } : {}) };
  }
  async deleteProject(projectId) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    const r = this.archive.deleteProject(projectId);
    if (!r) throw new Error("no such project");
    noteRemoved(this.archive, r.keys);
    this.sessionLists?.clear?.();
    this.#sessionsDeleted((r.chainIds || []).map(String));
    const forgotten = await this.#forgetAll(r.memoryIds);
    // Deleting a project deletes every session under it — the most destructive archive operation there is.
    this.#archiveOp(`archived project deleted: ${r.chains} session(s), ${r.turns} turn(s)`, {
      sub: "delete-project",
      level: "warn",
      detail: {
        projectId: r.id,
        chains: r.chains,
        turns: r.turns,
        items: r.items,
        forgotten: Array.isArray(forgotten) ? forgotten.length : Number(forgotten) || 0,
      },
    });
    return {
      deleted: "project",
      id: r.id,
      name: r.name,
      chains: r.chains,
      turns: r.turns,
      items: r.items,
      forgotten,
    };
  }
  moveSession(chainId, projectId) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    const r = this.archive.moveChain(chainId, String(projectId));
    if (r?.error) throw new Error(r.error);
    this.sessionLists?.clear?.();
    return r;
  }
  // Fork a session at a turn: a new chain that is the source through `atTurn` (the archive shares the message bodies;
  // see Archive.forkChain for what is inherited and what deliberately is not), under a key no client conversation
  // reaches (`n:`): a fork is the harness's own chat, which the sessions route makes (app/sessions/service.js `fork`).
  forkSession(chainId, { atTurn } = {}) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    const r = this.archive.forkChain(String(chainId), { atTurn, key: `n:fork-${randomBytes(9).toString("base64url")}` });
    if (r?.error) throw new Error(r.error);
    this.sessionLists?.clear?.();
    // A fork is a new session that was never lived: worth a durable line. Ids and counts only.
    this.#archiveOp(`session ${r.forkedFrom} forked at turn ${r.atTurn} → ${r.id} (${r.copied.turns} turn(s))`, {
      sub: "fork",
      detail: { chainId: r.forkedFrom, forkId: r.id, atTurn: r.atTurn, ...r.copied },
      ref: { chainId: r.id },
    });
    return {
      chainId: r.id,
      forkedFrom: r.forkedFrom,
      atTurn: r.atTurn,
      title: r.title,
      copied: r.copied,
      tree: r.meta?.tree || { snapshotRef: null },
    };
  }
  // A working-tree snapshot the agent loop took while a turn ran (WP-J.2), onto the turn's row. Never throws — a
  // snapshot must not break the round it followed.
  recordTreeSnapshot(turnId, { ref, commit, round = null } = {}) {
    if (!this.archive || !turnId || !ref || !commit) return null;
    try {
      return this.archive.setTurnTree(turnId, { ref, commit, round });
    } catch (e) {
      this.log("warn", `memory: tree snapshot not recorded (${String(e?.message || e).slice(0, 120)})`);
      return null;
    }
  }
  // What a turn wrote in its folder that no snapshot of it holds (`treeUnheld` on the turn's meta): the newest round
  // whose snapshot failed, the files named there since and whether a command ran; null once a snapshot holds them. A
  // fork from the turn, or a later one with no snapshot of its own, says its files miss them (`treeAtTurn`). Never
  // throws, as a round's record.
  /** @param {number} turnId @param {{ round: number, files: string[], command: boolean } | null} note */
  recordTreeUnheld(turnId, note) {
    if (!this.archive || !turnId) return null;
    try {
      return this.archive.mergeTurnMeta(turnId, { treeUnheld: note ? { round: note.round, files: note.files.slice(0, 50), command: !!note.command } : undefined });
    } catch (e) {
      this.log("warn", `memory: what a turn's snapshot missed not recorded (${String(e?.message || e).slice(0, 120)})`);
      return null;
    }
  }
  // One writing round of a turn in one place, for one agent (HarnessV4_Git_Plan step 1). Never throws — a record must
  // not break the round it followed.
  /** @param {number} turnId @param {import("../../core/types.js").RoundChange} c */
  recordRoundChange(turnId, c) {
    if (!this.archive || !turnId || c?.place == null) return null;
    try {
      return this.archive.addRoundChange(turnId, c);
    } catch (e) {
      this.log("warn", `memory: a turn's round not recorded (${String(e?.message || e).slice(0, 120)})`);
      return null;
    }
  }
  // What a sub-agent's Apply wrote into a place (10-29): a round of the chat's newest turn there, base "apply", with no
  // snapshot — or, in a chat with no turn yet, the chat's own row (found driving the Apply, 10-29) — Changes reads its
  // files as that sub-agent's until they are committed, across a restart. Never throws.
  /** @param {string} chainId @param {{ place: string, agent: string, own: string[] }} c */
  recordApplied(chainId, { place, agent, own }) {
    if (!this.archive || !place || !own.length) return null;
    try {
      const n = this.archive.newestTurnN(chainId);
      const turnId = n ? this.archive.getTurns(chainId, { from: n, to: n })[0]?.id : null;
      const c = { place, round: null, agent, before: null, after: null, base: "apply", own, command: false };
      if (!turnId) return this.archive.addChainChange(chainId, c);
      return this.recordRoundChange(turnId, c);
    } catch (e) {
      this.log("warn", `memory: an apply's files not recorded (${String(/** @type {any} */ (e)?.message || e).slice(0, 120)})`);
      return null;
    }
  }
  // The rounds a chat's move recorded, taken back with the move (HarnessV4_Git_Plan GW-D79). Never throws: what stays
  // is said in the log.
  /** @param {number} turnId @param {number[]} seqs */
  dropRoundChanges(turnId, seqs) {
    if (!this.archive || !turnId || !seqs.length) return;
    try {
      this.archive.dropRoundChanges(turnId, seqs);
    } catch (e) {
      this.log("warn", `memory: a move's rounds not taken back (${String(e?.message || e).slice(0, 120)})`);
    }
  }
  // The newest snapshot a chain's turns left in a place: the parent of its next one there.
  /** @param {string} chainId @param {string} place */
  lastInPlace(chainId, place) {
    if (!this.archive) return null;
    return this.archive.lastInPlace(String(chainId), String(place));
  }
  // The places besides its folder a chat's agents wrote in (HarnessV4_Git_Plan GW-D3): each of its turns snapshots
  // them as it begins, as it does the folder, and each writing round asks again. Read as its one key of the meta, which
  // grows with the chat. Never throws.
  /** @param {string} chainId @returns {string[]} */
  placesOf(chainId) {
    try {
      const places = this.archive?.metaOf(String(chainId), ["places"])?.places;
      return Array.isArray(places) ? places.map(String) : [];
    } catch {
      return [];
    }
  }
  // A repository's worktrees' chats (HarnessV4_Git_Plan GW-D39): for each folder, the chats whose folder is in it — the
  // deepest of them, where one worktree sits inside another (`home`) — and those whose agents wrote in it. Archived
  // chats and helpers' are left out. `readFor`: the chat whose agent reads them, for which memory reads no other chat
  // whose turns it keeps to itself (brain.js `keptToItself`) — its name is its words — and names none by the words of a
  // turn kept apart (`meta.namedApart`: its name ""). Never throws: no archive, no chats.
  /** @param {string[]} folders @param {{ readFor?: string | null }} [o] @returns {Map<string, { id: string, name: string, home: boolean, own: boolean }[]>} */
  chatsIn(folders, { readFor = null } = {}) {
    try {
      const chats = this.#chatsIn(folders);
      if (readFor == null) return chats;
      /** @type {Map<string, boolean>} */
      const keptAside = new Map();
      const read = (/** @type {{ id: string, name: string, namedApart: boolean }} */ c) => c.id === String(readFor) || !this.brain || !this.brain.keptToItself(c.id, keptAside);
      return new Map([...chats].map(([f, list]) => [f, list.filter(read).map((c) => (c.namedApart && c.id !== String(readFor) ? { ...c, name: "" } : c))]));
    } catch (e) {
      this.log("warn", `memory: a worktree's chats not read (${String(/** @type {any} */ (e)?.message || e).slice(0, 120)})`);
      return new Map(folders.map((f) => [f, []]));
    }
  }
  // The places only this chat works in (HarnessV4_Git_Plan GW-D57): no other chat's folder is in it and no other
  // chat's agents wrote there, as `chatsIn` counts them. What its commands changed there is its own. Never throws:
  // where the chats cannot be read, none is its alone.
  /** @param {string} chainId @param {string[]} places @returns {Set<string>} */
  placesAlone(chainId, places) {
    const list = [...new Set(places.filter(Boolean))];
    if (!list.length || !this.archive) return new Set();
    try {
      const chats = this.#chatsIn(list);
      return new Set(list.filter((p) => !(chats.get(p) || []).some((c) => c.id !== String(chainId))));
    } catch (e) {
      this.log("warn", `memory: whose places these are not read (${String(/** @type {any} */ (e)?.message || e).slice(0, 120)})`);
      return new Set();
    }
  }
  /** `chatsIn`, throwing where the archive could not be read. @param {string[]} folders */
  #chatsIn(folders) {
    /** @type {Map<string, { id: string, name: string, namedApart: boolean, home: boolean, own: boolean, routine: string }[]>} */
    const out = new Map(folders.map((f) => [f, []]));
    const deepest = folders.map((f) => ({ f, k: normalizeCwd(f) })).sort((a, b) => b.k.length - a.k.length);
    const homeOf = (/** @type {string} */ p) => {
      const n = normalizeCwd(p);
      return deepest.find(({ k }) => n === k || n.startsWith(`${k}/`))?.f ?? null;
    };
    const rows = this.archive?.chatsTouching(folders, LISTED_KINDS) || [];
    for (const r of rows) {
      const home = r.cwd ? homeOf(r.cwd) : null;
      const homes = new Set([home, ...r.places.map(homeOf)]);
      for (const f of homes) if (f) out.get(f)?.push({ id: r.id, name: r.name, namedApart: r.namedApart, home: f === home, own: r.own, routine: r.routine });
    }
    return out;
  }
  /** @param {string} chainId @param {string} place */
  followPlace(chainId, place) {
    try {
      const have = this.placesOf(chainId);
      if (!this.archive || have.includes(String(place))) return;
      this.archive.mergeMeta(String(chainId), { places: [...have, String(place)] });
    } catch (e) {
      this.log("warn", `memory: a place not followed (${String(e?.message || e).slice(0, 120)})`);
    }
  }
  // What a turn changed (`turn`), or the whole chat (`turn` null): its writing rounds, place by place; the chat's own
  // folder — a worktree's chat keeps its own, else its project's (HarnessV4_Git_Plan GW-D47); and, for a turn, the
  // folder's snapshot in force at it, which a fork checks out (step 1). A move's rounds are the chat's, never a turn's
  // (GW-D88).
  /** @param {string} chainId @param {{ turn?: number | null }} [o] */
  roundsOf(chainId, { turn = null } = {}) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    const chain = this.archive.getChain(String(chainId));
    if (!chain) throw new Error("no such session");
    const project = chain.project_id ? this.archive.getProject?.(chain.project_id) : null;
    const own = typeof chain.meta?.cwd === "string" && chain.meta.cwd ? chain.meta.cwd : null;
    const n = turn == null ? null : Number(turn);
    const one = n != null && Number.isInteger(n) && n > 0;
    const rounds = n == null ? this.archive.roundChanges(chain.id) : one ? this.archive.roundChanges(chain.id, { turn: n }).filter((r) => r.base !== "move") : [];
    const tree = one ? this.archive.treeAtTurn(chain.id, n) : null;
    return { chainId: chain.id, turns: chain.turns || 0, cwd: own || project?.cwd || null, rounds, tree };
  }
  // The worktree a fork was checked out into, onto the fork's meta beside its snapshot ref.
  setSessionWorktree(chainId, path) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    const ch = this.archive.getChain(String(chainId));
    if (!ch) throw new Error("no such session");
    const meta = this.archive.mergeMeta(ch.id, { tree: { ...(ch.meta?.tree || { snapshotRef: null }), worktree: String(path) } });
    return meta?.tree || null;
  }
  // The agent loop's standing in this session (WP-F/WP-L): the permission mode its newest turn's request fixed — null
  // when its calls follow the session's own (HarnessV3-AtHome AH-F1) — and the backing model, what the inspector's "in
  // force" block reads. Never throws: a note about a turn must not stop the turn.
  setSessionAgent(chainId, { permissions, model }) {
    try {
      if (!this.archive) return null;
      const meta = this.archive.mergeMeta(String(chainId), { agent: { permissions: permissions ? String(permissions) : null, model: String(model || ""), at: this.now() } });
      return meta?.agent || null;
    } catch {
      return null;
    }
  }
  // The session's spend ledger (HarnessV2 §5.8 `budgets.*`): every model call of the chain — the developer's request,
  // a loop's tick — adds to one running total in the chain's meta, so a session budget is judged on the archive's
  // numbers and not on whatever request records the ring still holds. Totals only, never per-request rows — and the
  // same totals per model (Providers P4), so the Spend widget can say where the money and the list price went. `call`:
  // the newest model call of a record that stands for several (a coding agent's turn), its prompt as counted; `own`
  // false: a side agent's call (core/turn-facts.js `ownAgentCall`), which adds to the totals and leaves `last` as it was;
  // `agent`: a sub-agent's, counted apart too (`agents`) — from the ledger's first write since it is counted, what the
  // chat had spent before then (`before`), which tells none apart. `cacheSeen`: the call's usage said its cache numbers
  // (core/cache-facts.js): the ledger keeps the prompt tokens of the calls that did (`cacheSeenTokens`, written from
  // the first that does; a ledger kept before it is counted by its figures), which its share read from the cache is
  // taken of, and the last request says whether it did, where it went (`upstream`) and the lifetime its call said.
  // A goal books nothing (the owner's of 11-05: "drop the whole spend tracking" from the goal): the chat's spend is this
  // one. One read and one write of the meta, which grows with the chat. → the spend as written; null when nothing was
  // (no archive, no such session, a failure). Never throws — accounting must not break a record's close.
  spendAdd(chainId, entry = {}) {
    try {
      if (!this.archive) return null;
      /** @type {any} */
      let spend = null;
      this.archive.updateMeta(String(chainId), (meta) => {
        spend = this.#spendAfter(meta.spend || {}, entry);
        meta.spend = spend;
      });
      return spend;
    } catch (e) {
      this.log("warn", `memory: spend ledger append failed (${String(e?.message || e).slice(0, 120)})`);
      return null;
    }
  }
  /** The spend ledger `cur` with one model call's entry added (`spendAdd`). */
  #spendAfter(cur, { usd = 0, listUsd = 0, inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, cacheWrite1hTokens = 0, savedUsd = 0, unpriced = 0, listUnpriced = 0, model = "", at = 0, call = null, own = true, agent = false, cacheSeen = undefined, upstream = "" } = {}) {
    const round6 = (n) => Math.round(n * 1e6) / 1e6;
    const p = call || { input: inputTokens, cacheRead: cacheReadTokens, cacheWrite: cacheWriteTokens };
    const prompt = (Number(p.input) || 0) + (Number(p.cacheRead) || 0) + (Number(p.cacheWrite) || 0);
    const sent = { input: inputTokens, cacheRead: cacheReadTokens, cacheWrite: cacheWriteTokens };
    // An entry that says nothing of it (one booked before the mark) is read by its figures, as the ledger before is.
    const said = cacheSeen ?? cacheSaid(sent);
    const seenTokens = seenPrompt({ input: cur.inputTokens, cacheRead: cur.cacheReadTokens, cacheWrite: cur.cacheWriteTokens, cacheSeen: cur.cacheSeenTokens }) + (said ? promptOf(sent) : 0);
    const where = upstream ? { upstream: String(upstream) } : {};
    const byModel = { ...(cur.byModel || {}) };
    const name = String(model || "") || "(unnamed)";
    const m = byModel[name] || {};
    byModel[name] = {
      usd: round6((Number(m.usd) || 0) + (Number(usd) || 0)),
      listUsd: round6((Number(m.listUsd) || 0) + (Number(listUsd) || 0)),
      requests: (Number(m.requests) || 0) + 1,
      inputTokens: (Number(m.inputTokens) || 0) + (Number(inputTokens) || 0),
      outputTokens: (Number(m.outputTokens) || 0) + (Number(outputTokens) || 0),
      cacheReadTokens: (Number(m.cacheReadTokens) || 0) + (Number(cacheReadTokens) || 0),
      cacheWriteTokens: (Number(m.cacheWriteTokens) || 0) + (Number(cacheWriteTokens) || 0),
      unpricedRequests: (Number(m.unpricedRequests) || 0) + (Number(unpriced) || 0),
      listUnpricedRequests: (Number(m.listUnpricedRequests) || 0) + (Number(listUnpriced) || 0),
    };
    const agents = cur.agents || { usd: 0, listUsd: 0, requests: 0, before: round6(Number(cur.usd) || 0) };
    const spend = {
      usd: round6((Number(cur.usd) || 0) + (Number(usd) || 0)),
      // the sub-agents' share (the owner's of 11-05): the Spend tells the chat's agent, its sub-agents and its teams apart
      agents: agent
        ? { ...agents, usd: round6((Number(agents.usd) || 0) + (Number(usd) || 0)), listUsd: round6((Number(agents.listUsd) || 0) + (Number(listUsd) || 0)), requests: (Number(agents.requests) || 0) + 1 }
        : agents,
      listUsd: round6((Number(cur.listUsd) || 0) + (Number(listUsd) || 0)),
      listUnpricedRequests: (Number(cur.listUnpricedRequests) || 0) + (Number(listUnpriced) || 0),
      byModel,
      inputTokens: (Number(cur.inputTokens) || 0) + (Number(inputTokens) || 0),
      outputTokens: (Number(cur.outputTokens) || 0) + (Number(outputTokens) || 0),
      cacheReadTokens: (Number(cur.cacheReadTokens) || 0) + (Number(cacheReadTokens) || 0),
      cacheWriteTokens: (Number(cur.cacheWriteTokens) || 0) + (Number(cacheWriteTokens) || 0),
      // the writes kept an hour, out of the writes: the Spend widget prices them at twice the input price
      cacheWrite1hTokens: (Number(cur.cacheWrite1hTokens) || 0) + (Number(cacheWrite1hTokens) || 0),
      ...(seenTokens > 0 ? { cacheSeenTokens: seenTokens } : {}),
      savedUsd: round6((Number(cur.savedUsd) || 0) + (Number(savedUsd) || 0)),
      unpricedRequests: (Number(cur.unpricedRequests) || 0) + (Number(unpriced) || 0),
      requests: (Number(cur.requests) || 0) + 1,
      firstAt: Number(cur.firstAt) || this.now(),
      lastAt: this.now(),
      // The newest request's own numbers — the Cache widget's "the last request" rows read this, not a sum — of the
      // session's own agent, and one whose prompt was counted: a side agent's call reads another cache, and a request
      // that failed before its provider counted anything says nothing of it. A record that stands for several model
      // calls sums them: its newest call's prompt is the last request, and the dollars, which no one call of it has
      // apart, are not said. One whose usage said no cache numbers is the last request all the same, marked so
      // (`cacheSeen: false`): the newest request is the one the Cache widget speaks of, or says nothing for.
      last: !own || !(prompt > 0)
        ? cur.last || null
        : call
        ? {
            at: Number(at) || this.now(),
            model: String(model || ""),
            input: Number(call.input) || 0,
            cacheRead: Number(call.cacheRead) || 0,
            cacheWrite: Number(call.cacheWrite) || 0,
            cacheSeen: saysCache(call.cacheRead, call.cacheWrite),
            ...(Number(call.ttlMs) > 0 ? { ttlMs: Number(call.ttlMs) } : {}),
            ...where,
          }
        : {
            at: Number(at) || this.now(),
            usd: round6(Number(usd) || 0),
            listUsd: round6(Number(listUsd) || 0),
            model: String(model || ""),
            input: Number(inputTokens) || 0,
            output: Number(outputTokens) || 0,
            cacheRead: Number(cacheReadTokens) || 0,
            cacheWrite: Number(cacheWriteTokens) || 0,
            cacheSeen: said,
            savedUsd: round6(Number(savedUsd) || 0),
            unpriced: Number(unpriced) || 0,
            ...where,
          },
    };
    return spend;
  }
  // The session inspector's read side: everything about one session that is not its transcript (truth.js). The
  // request records are handed in by the caller — the usage ring is the composition root's, not memory's.
  sessionTruth(chainId, { records = [], capped = false } = {}) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    return sessionTruth(
      { archive: this.archive, policies: this.policies, lineage: (id) => this.lineage(id) },
      String(chainId),
      { records, capped, now: this.now() },
    );
  }
  async backup() {
    const t0 = Date.now();
    try {
      const r = await this.backups.run({ reason: "manual" });
      // A backup is the one operation whose absence you discover exactly when you need it. Record it durably.
      this.#archiveOp(
        `memory backed up (${Math.round((r?.bytes || 0) / 1024)} KB, ${Object.keys(r?.files || {}).length} file(s))`,
        {
          sub: "backup",
          ms: Date.now() - t0,
          detail: {
            bytes: r?.bytes || 0,
            files: Object.keys(r?.files || {}).length,
            reason: r?.reason || "manual",
          },
        },
      );
      return r;
    } catch (e) {
      this.#archiveOp(`memory backup failed: ${String(e.message).slice(0, 160)}`, {
        sub: "backup",
        level: "error",
        ms: Date.now() - t0,
        detail: { error: String(e.message).slice(0, 160) },
      });
      throw e;
    }
  }
  listBackups() {
    return this.backups.list();
  }
  async restore(dir) {
    if (!this.folder) throw new Error(`no archive: ${this.archiveWhy()}`);
    const folder = this.folder;
    const sig = this.openedWith;
    const engine = this.store;
    this.stop();
    const t0 = Date.now();
    try {
      // The engine's process holds its database until it has ended: the backup's copies go in after that, never under it.
      await (engine?.close ? engine.close() : engine?.stop?.());
      const out = await this.backups.restoreFiles(dir, folder);
      // Restore replaces the live databases — a destructive act that should be durable and dated.
      const restored = Array.isArray(out) ? out.length : (out?.restored?.length ?? 0);
      this.#archiveOp(`memory restored from a backup (${restored} file(s))`, {
        sub: "restore",
        level: "warn",
        ms: Date.now() - t0,
        detail: { restored },
      });
      return out;
    } catch (e) {
      this.#archiveOp(`memory restore failed: ${String(e.message).slice(0, 160)}`, {
        sub: "restore",
        level: "error",
        ms: Date.now() - t0,
        detail: { error: String(e.message).slice(0, 160) },
      });
      throw e;
    } finally {
      this.openedWith = null;
      this.start();
      void sig;
    }
  }

  // ---- dashboard / API ------------------------------------------------------------------------------
  async status({ probe = false } = {}) {
    const m = this.cfg();
    const es = this.sidecar.engineState(this.dataDir);
    let hello = this.store?.hello || null;
    if (probe && this.store?.ensure) {
      try {
        await this.store.ensure();
        hello = this.store.call ? await this.store.call("hello", {}) : this.store.hello;
        if (this.store.call) this.store.hello = hello;
      } catch (e) {
        /* status shows lastError */
      }
    } // a probe refreshes the counts
    else if (probe && this.store?.helloInfo && !hello) {
      try {
        hello = await this.store.helloInfo();
      } catch {}
    }
    // Read after the probe: the state it reports is the one the probe left.
    const st = this.store?.status?.() || null;
    const counts = this.archive ? this.archive.counts() : null;
    return {
      enabled: this.enabled(),
      folder: this.folderPath(),
      folderExists: existsSync(this.folderPath()),
      manifest: this.folder ? this.#manifest(this.folder) : null,
      engine: {
        installed: es.installed || (!!process.env.FILAMENT_MEMORY_SIDECAR && st?.state === "ready"),
        // Where its packages came from (AH-D2): "bundle", "download", or null when its install did not say.
        source: es.source || null,
        // The engine bundle that came with this Filament, the only thing an Install takes (AH-D2): whether one is here
        // (`why` not, in words), and whether the engine installed is the one it holds.
        bundle: this.#bundleNow(es),
        dir: es.dir,
        version: hello?.version || es.mnemosyneVersion || null,
        python: es.pythonVersion || null,
        embeddings: hello?.embeddings ?? (es.installed ? es.embeddings : null),
        vec: hello?.vec ?? null,
        state: st?.state || (es.installed ? "stopped" : "missing"),
        lastError: st?.lastError || es.error || null,
        // The engine's last stall since Filament started (the watch's: it answered nothing, not even a ping, and was
        // restarted, or stopped as it stalled again soon after; `out` while it is left stopped for that), with how many
        // there were; null for none.
        stalled: st?.stalled || null,
        counts: hello?.counts || null,
        dbPath: hello?.dbPath || null,
        calls: st?.calls || 0,
        pid: st?.pid || null,
        installLog: es.log || [],
        // The engine writes still to send, or set aside (HarnessV3-Memory M2-2).
        outbox: this.archive ? this.archive.outbox.status() : null,
      },
      archive: counts,
      // Why the archive did not open, in its own words (null when it did): the Memory page says it.
      archiveError: this.archive ? null : this.archiveError,
      summarizer: this.modelFor({}).model,
      // As set, and the model memory calls where no chat is named, from where (the memory plan's m1).
      models: this.models(),
      backups: { ...(m.backups || {}), ...this.backups.status() },
      learning: this.learner ? { ...this.learner.stats, pending: this.learner.pending.size } : null,
      autopilot: m.autopilot || {},
      jobs: [...this.jobs.values()].slice(-5),
    };
  }
  /** The jobs under way that the person can stop (an engine install or update, an import, memory reading imported chats), by job id: each one's stop. @type {Map<string, AbortController>} */
  #jobStops = new Map();
  /**
   * A job the person can stop: its steps have no clock (HarnessV3-FailurePoints FP-D3), so a stuck one ends by
   * their hand. Kept while it runs.
   * @param {{ id: string, done: Promise<any> }} job @param {AbortController} stop
   */
  #stoppable(job, stop) {
    this.#jobStops.set(job.id, stop);
    job.stoppable = true;
    const gone = () => this.#jobStops.delete(job.id);
    job.done.then(gone, gone);
  }
  /**
   * The person stops a job under way: an engine install's or update's running step is killed, and the job fails
   * saying where it stopped; an import ends after the turn in hand, memory's reading after the chat in hand. False
   * when that job runs no longer, or is none that can be stopped.
   * @param {string} id
   */
  stopJob(id) {
    const stop = this.#jobStops.get(id);
    if (!stop) return false;
    stop.abort();
    return true;
  }
  // Background jobs (install, update, import) polled by the dashboard. `job.done` resolves when the run ends, so a
  // caller that must wait for the result can await the SAME job
  // the dashboard is polling — one job, two observers, no duplicate work.
  startJob(kind, run) {
    const id = `${kind}-${this.now().toString(36)}`;
    const job = {
      id,
      kind,
      status: "running",
      startedAt: new Date().toISOString(),
      progress: [],
      percent: 0,
      message: "",
      error: null,
      result: null,
    };
    this.jobs.set(id, job);
    if (this.jobs.size > 20) this.jobs.delete(this.jobs.keys().next().value);
    const onProgress = (p) => {
      job.progress.push({ ...p, at: this.now() });
      if (job.progress.length > 400) job.progress.shift();
      if (p.percent != null) job.percent = p.percent;
      if (p.message) job.message = `${p.step ? `${p.step}: ` : ""}${p.message}`;
    };
    // `run` receives the job itself, not just the progress callback: a caller that needs the job's own id (so its
    // model calls can name the job that spawned them) would otherwise have to close over the `const job = startJob(…)`
    // binding, which is still in its temporal dead zone while `run` executes synchronously up to its first await.
    // The op-log hook (injected by the server, like `archivedTranscript`, so this module stays independent of it).
    // A job that ends `done` with `result.ok === false` is reported as "refused", not as a success: its status says
    // "done" and its percent 100 while it achieved nothing. Persisting the outcome here is also what makes a
    // post-mortem survive a restart — `this.jobs` holds 20, in RAM.
    this.onJobEvent?.(job, "start");
    job.done = run(onProgress, job)
      .then((result) => {
        const refused = !!(result && typeof result === "object" && result.ok === false);
        job.status = "done";
        job.result = result ?? null;
        job.endedAt = new Date().toISOString();
        // A pass that produced nothing did not finish successfully, and `percent: 100` says it did. Keep the percent it
        // actually reached and flag the refusal explicitly, so both the API and the dashboard can tell "done" from
        // "refused" without inspecting the result shape (W8 D8: all four failed passes read done/100/error:null).
        job.refused = refused;
        if (refused) job.reason = String(result?.reason || "the pass produced no summaries").slice(0, 300);
        else job.percent = 100;
        this.onJobEvent?.(job, refused ? "refused" : "done");
        return result;
      })
      .catch((e) => {
        job.status = "error";
        job.error = e.message.slice(0, 500);
        // The person's stop (`stopJob`): theirs, and no failure of the job's — its panel says stopped.
        if (e?.aborted) job.stopped = true;
        job.endedAt = new Date().toISOString();
        this.onJobEvent?.(job, "error", e);
        throw e;
      });
    return job;
  }
  job(id) {
    return this.jobs.get(id) || null;
  }
  // The engine's live counters, and nothing else. `status()` rebuilds the whole memory status — `archive.counts()`,
  // the engine's files, the backups' list — which is fine on demand and not fine every 1.5 s from the Live tab.
  // `pending` is the number of engine calls in flight right now, which is what that tab wants to show.
  engineLive() {
    const st = this.store?.status?.();
    if (!st)
      return { installed: false, state: this.store ? "unknown" : "not installed", calls: 0, pending: 0 };
    return {
      installed: true,
      state: st.state || "unknown",
      pid: st.pid ?? null,
      calls: st.calls || 0,
      pending: st.pending || 0,
      failures: st.failures || 0,
      lastError: st.lastError ? String(st.lastError).slice(0, 160) : null,
      stalled: st.stalled || null,
    };
  }
  /**
   * The person restarts an engine they see hung (HarnessV4_Tasks U1): its process is ended, each call in flight ends
   * saying so — a turn that waited on its recall goes on without it — and it starts again at once. `why`: there is
   * none to restart. Throws where it does not come back, with why.
   * @returns {Promise<{ restarted: true, cut: number, state: string } | { restarted: false, why: string }>}
   */
  async restartEngine() {
    if (this.#engineJob()) return { restarted: false, why: "the memory engine is installing: its job's Stop ends that" };
    const store = this.store;
    if (!store?.restart) return { restarted: false, why: this.enabled() ? "the memory engine is not installed: there is none to restart" : "memory is off: no engine runs" };
    const { cut } = await store.restart();
    return { restarted: true, cut, state: String(store.status?.().state || "unknown") };
  }
  /** The install running now, or null: one engine job at a time (AH-D2). */
  #engineJob() {
    for (const j of this.jobs.values()) if (j.kind === "install" && j.status === "running") return j;
    return null;
  }
  /**
   * The bundle that came with this Filament as the pages say it: `ready` when one here serves this release's engine,
   * `why` not, and `current` when the engine installed is the one it holds.
   * @param {any} es  the engine's state
   */
  #bundleNow(es) {
    const { bundle, why } = this.sidecar.bundleFor(this.sidecar.bundleRoot());
    return { ready: !!bundle, why: bundle ? null : why, current: this.sidecar.engineIsBundles(es, bundle) };
  }
  /**
   * Where memory's engine stands, for the pages (HarnessV3-AtHome AH-D2): `installing` with the job's percent, where it
   * takes its packages from (null until the install has said) and whether memory started it by itself; `ready`, with
   * where it came from, and `kept` when the last install, over it, did not go in (it runs on); `missing`, with the last
   * install's failure, and `why` none can be installed when no bundle is here; `off` while memory is.
   */
  engineNow() {
    const job = this.#engineJob();
    if (job)
      return {
        state: "installing",
        percent: Math.round(Number(job.percent) || 0),
        source: job.source || null,
        auto: !!job.auto,
      };
    if (!this.enabled()) return { state: "off" };
    // A stand-in engine (tests) is the engine.
    if (sidecarHook()) return { state: "ready", source: null };
    const es = this.sidecar.engineState(this.dataDir);
    if (es.installed) {
      let last = null;
      for (const j of this.jobs.values()) if (j.kind === "install") last = j;
      return last?.status === "error" ? { state: "ready", source: es.source || null, kept: true } : { state: "ready", source: es.source || null };
    }
    const { bundle, why } = this.sidecar.bundleFor(this.sidecar.bundleRoot());
    return { state: "missing", error: es.error ? String(es.error).split("\n")[0] : null, ...(bundle ? {} : { why }) };
  }
  #engineChanged() {
    const now = this.engineNow(),
      said = JSON.stringify(now);
    if (said === this.#engineSaid) return;
    this.#engineSaid = said;
    try {
      this.onEngine?.(now);
    } catch (e) {
      this.log("warn", `memory: telling the pages where the engine stands failed: ${/** @type {any} */ (e)?.message || e}`);
    }
  }
  /** An engine job's progress: on the job, where it takes its packages from as well, and said to the pages. */
  #engineProgress(onProgress, self) {
    return (p) => {
      onProgress(p);
      if (p.source) self.source = p.source;
      this.#engineChanged();
    };
  }
  /**
   * From now on this process installs memory's engine by itself (AH-D2). The server arms it once it listens, and only
   * when its maker asked (the CLI does; tests never), so a second Filament that could not listen never installs into the
   * same folder at the same time.
   */
  armAutoInstall() {
    this.#autoArmed = true;
    if (this.enabled()) this.#autoInstall();
  }
  // Memory on, `memory.engine.autoInstall` on, nothing installing and no stand-in engine: a missing engine is
  // installed, and one this release's bundle did not put in — another release's, a download's — gives way to it (each
  // release carries its engine, and none is ever updated); once a run. With no bundle here (a checkout that has not
  // built one), an engine installed stays as it is.
  #autoInstall() {
    if (!this.#autoArmed || this.#autoDone || this.cfg().engine?.autoInstall === false) return;
    if (this.#engineJob() || sidecarHook()) return;
    const es = this.sidecar.engineState(this.dataDir);
    const { bundle, why } = this.sidecar.bundleFor(this.sidecar.bundleRoot());
    if (es.installed) {
      if (!bundle || this.sidecar.engineIsBundles(es, bundle)) return;
      const was = es.source === "download" ? "downloaded" : "another release's";
      this.log("info", `memory: replacing its engine (mnemosyne ${es.mnemosyneVersion || "?"}, ${was}) with the one this Filament came with (mnemosyne ${bundle.manifest?.mnemosyne || "?"})`);
    } else if (!bundle) {
      // Nothing to install it from: no job that can only fail, but the person is told why, once a run.
      this.#autoDone = true;
      this.log("warn", `memory: its engine isn't installed, and can't be: ${why}`);
      this.onAlert?.("memory", `memory's engine isn't installed, and can't be: ${why}; memory runs on the archive alone`, "memory-no-bundle");
      return;
    } else this.log("info", "memory: installing the Mnemosyne engine in the background");
    this.#autoDone = true;
    this.install({ auto: true });
  }
  /** Whether the engine installed is one `#autoInstall` replaces: not this release's bundle's, with the bundle here. */
  #givesWay() {
    if (this.cfg().engine?.autoInstall === false || sidecarHook()) return false;
    const es = this.sidecar.engineState(this.dataDir);
    if (!es.installed) return false;
    const { bundle } = this.sidecar.bundleFor(this.sidecar.bundleRoot());
    return !!bundle && !this.sidecar.engineIsBundles(es, bundle);
  }
  /**
   * Memory's engine from the bundle that came with this Filament (AH-D2): the only install there is — offline, never a
   * download, and no engine is ever updated. Refused before anything is touched when no bundle here serves this
   * release, saying why. Over an engine installed already (the release's replacing another's), memory is backed up
   * first when the Mnemosyne version changes, and the old engine's process has ended before its files are replaced;
   * memory runs on the archive alone meanwhile. One engine job at a time: while one runs, that one.
   * @param {{ auto?: boolean }} [o]  `auto`: memory started it by itself
   */
  install({ auto = false } = {}) {
    const running = this.#engineJob();
    if (running) return running;
    const stop = new AbortController();
    const job = this.startJob("install", async (onProgress, self) => {
      self.auto = auto;
      const progress = this.#engineProgress(onProgress, self);
      const root = this.sidecar.bundleRoot();
      const { bundle, why } = this.sidecar.bundleFor(root);
      if (!bundle) throw new Error(why);
      const was = this.sidecar.engineState(this.dataDir);
      let held = false;
      try {
        if (was.installed) {
          await this.#backupBeforeEngine(was, bundle, progress);
          if (stop.signal.aborted) throw Object.assign(new Error("memory engine install aborted before it began"), { aborted: true });
          held = true;
          await this.#holdEngine("its engine is being replaced by the one this Filament came with; memory runs on the archive alone until it is in");
        }
        const state = await this.sidecar.installEngine({ dataDir: this.dataDir, bundle: root, onProgress: progress, signal: stop.signal });
        this.#engineHeld = null;
        this.openedWith = null;
        this.start(); // pick up the engine
        return { installed: state.installed, version: state.mnemosyneVersion, source: state.source };
      } catch (e) {
        // What the failed install left: memory goes on as it can, on the archive alone.
        if (held) {
          this.#engineHeld = null;
          this.openedWith = null;
          this.start();
        }
        throw e;
      }
    });
    this.#stoppable(job, stop);
    this.#engineChanged();
    job.done.then(
      () => this.#engineChanged(),
      (e) => {
        this.#engineChanged();
        // One nobody pressed for comes to find you when it fails; a pressed one fails in front of the person, and one
        // the person stopped was theirs. An engine that stood before and was never touched keeps running.
        if (auto && !e?.aborted) {
          const said = String(e?.message || e).split("\n")[0];
          this.onAlert?.(
            "memory",
            this.sidecar.engineState(this.dataDir).installed
              ? `the memory engine this Filament came with did not go in: ${said}; the one installed before keeps running (Install on the Memory page tries again)`
              : `the memory engine did not install: ${said}; memory runs on the archive alone (Install on the Memory page tries again)`,
            `memory-install:${job.id}`,
          );
        }
      },
    );
    return job;
  }
  /**
   * Memory backed up before its engine changes Mnemosyne version — a new one may change its database as it opens — to
   * memory's backups folder, or `<data folder>/memory-backups` when none is set. A backup that fails stops the change,
   * the engine left as it was.
   * @param {any} was  the engine's state  @param {any} bundle  @param {(p: any) => void} progress
   */
  async #backupBeforeEngine(was, bundle, progress) {
    const from = String(was.mnemosyneVersion || ""),
      to = String(bundle.manifest?.mnemosyne || "");
    if (from && from === to) return;
    const folder = this.cfg().backups?.folder || join(this.dataDir, "memory-backups");
    progress({ step: "backup", status: "start", percent: 0, message: `backing up memory before its engine goes from mnemosyne ${from || "?"} to ${to || "?"}` });
    try {
      const r = await this.backups.run({ reason: "engine-change", folder });
      progress({ step: "backup", status: "done", message: `memory backed up to ${r.dir}` });
    } catch (e) {
      throw new Error(`memory was not backed up before its engine changed, so the engine was left as it is: ${/** @type {any} */ (e)?.message || e}`);
    }
  }
  /**
   * The engine stops for its files to be replaced or removed: memory reopens on the archive alone — the archive itself
   * stays open, the record every running turn holds —, the old engine closed for good (nothing that still holds it
   * starts it again), its process ended when this settles.
   * @param {string} why  the log's words while it is held
   */
  async #holdEngine(why) {
    const old = this.store;
    this.#engineHeld = why;
    this.openedWith = null;
    this.start();
    await (old?.close ? old.close() : old?.stop?.());
  }
  async uninstall() {
    if (this.#engineJob()) throw new Error("the memory engine is installing: wait for it to finish");
    // Removed by the person: memory doesn't install it again by itself until Filament next starts (AH-D2).
    this.#autoDone = true;
    // The engine alone stops, its process ended before its folder goes. The archive stays open: every running turn holds
    // it (its permits read what was allowed before, its saves write), and closed under them a Claude Code chat's next
    // permission request failed "database is not open" while the folder was removed (the hunt of 10-28). Memory runs on
    // the archive alone meanwhile, and opens again whether the removal went through or not.
    await this.#holdEngine("its engine is being removed; memory runs on the archive alone");
    try {
      return await this.sidecar.uninstallEngine(this.dataDir);
    } finally {
      this.#engineHeld = null;
      this.openedWith = null;
      this.start();
    }
  }
  sessions(query, opts) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.brain.sessions(query, opts);
  }
  projects() {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.archive.projects();
  }
  /**
   * Every folder a chat works in and every project's — the person's alone, or one agents' device's chats' (the archive's
   * `chatFolders`); none without an archive. @param {{ person?: boolean, agentDevice?: string }} [o] @returns {string[]}
   */
  chatFolders(o) {
    return this.archive ? this.archive.chatFolders(o) : [];
  }
  /**
   * A project as the pages name it (HarnessV3-Launch LD-D8): its id, its folder's name and the folder. Null for no
   * project (a session that named no folder is "none"'s); an id the archive does not know keeps the id alone.
   * @param {string | null | undefined} id
   * @returns {{ id: string, name: string | null, cwd: string | null } | null}
   */
  projectNamed(id) {
    if (!id || id === NO_PROJECT_ID) return null;
    const p = this.archive?.getProject(String(id));
    return { id: String(id), name: p?.name || null, cwd: p?.cwd || null };
  }
  /**
   * The project each folder stands in, as a chat's create would file it (HarnessV4_Git_Plan GW-D46): a folder inside a
   * linked worktree stands in the same place in its repository's main folder, any other folder in its own. Computed,
   * never made. Each answer: the project's id, its folder and its name — the archive's where it has the row (`known`),
   * else the folder's own —; null for an empty path. A folder the disk may not be asked of stands as written.
   * @param {readonly string[]} paths
   * @returns {({ id: string, cwd: string, name: string, known: boolean } | null)[]}
   */
  projectsOf(paths) {
    return paths.map((path) => {
      const p = projectOf({ cwdHint: path, mayAsk: (folder) => this.mayAsk(folder) });
      if (p.id === NO_PROJECT_ID) return null;
      const row = this.archive?.getProject(p.id) || null;
      return { id: p.id, cwd: row?.cwd || p.home, name: row?.name || p.name, known: !!row };
    });
  }
  /**
   * A project named from the harness ("Add project"): the folder must exist and be a directory, judged as the
   * filesystem sees it (a link is followed), so the tree never grows a project for a typo. A worktree's folder names
   * its main folder's project (HarnessV4_Git_Plan GW-D46). → the row, or { error }.
   * @param {string} cwd
   */
  createProject(cwd) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    const c = String(cwd || "").trim();
    if (!c) return { error: "a folder path is required" };
    let real;
    try {
      // `.native` gives the folder's spelling as the disk has it (drive letter and case on Windows), so the project's
      // name is the folder's own and not whatever the field held.
      real = realpathSync.native(c);
      if (!statSync(real).isDirectory()) return { error: `${c} is not a folder` };
    } catch {
      return { error: `the folder does not exist on this machine: ${c}` };
    }
    return this.archive.ensureProject(projectFolderOf(real));
  }
  /**
   * A project's name changed (HarnessV4_SpacesPlugins_Plan A1): a Space of your own renamed.
   * @param {string} projectId @param {string} name
   */
  renameProject(projectId, name) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    if (!this.archive.setProjectName(String(projectId), String(name))) return { error: "no such project" };
    this.sessionLists?.clear?.();
    return { id: String(projectId), name: String(name).trim() };
  }
  /** @param {string} projectId @param {boolean} on */
  archiveProject(projectId, on) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    if (!this.archive.setProjectArchived(String(projectId), !!on)) return { error: "no such project" };
    this.sessionLists?.clear?.();
    return { id: String(projectId), archived: !!on };
  }
  /** What memory did for one turn of a session (HarnessV3-Memory M6-1), or null. @param {string} chainId @param {number} n */
  turnMemory(chainId, n) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.brain.turnMemory(String(chainId), Number(n));
  }
  /**
   * The claims of a project, or the global ones (null), as the claim browser lists them (HarnessV3-Memory M6-5).
   * @param {string | null} projectId @param {{ state?: string, kind?: string | null, q?: string, limit?: number }} [o]
   */
  claims(projectId, o) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.brain.claims(projectId, o);
  }
  /** Where the claims feed stands (M7-D35): the store's epoch, its newest row, and the newest pruned. */
  claimFeed() {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.archive.feed.position();
  }
  /**
   * The claim changes after the feed's row `after`, as the stream sends them (M7-D35), a page at a time: `through` is
   * where the next page starts. `project`: its claims, the global ones and those moved out of it.
   * @param {{ after?: number, limit?: number, project?: string }} [o]
   */
  claimChanges({ after = 0, limit = FEED_PAGE, project = undefined } = {}) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    const { rows, through } = this.archive.feed.after({ after, limit, project });
    return { changes: rows.map((r) => claimChange(this.archive.feedEpoch, r)), through };
  }
  /** Tells `fn` whenever the claims feed may have grown, after the write that grew it (M7-D35); returns its undo. @param {() => void} fn */
  watchClaims(fn) {
    this.#claimWatchers.add(fn);
    return () => void this.#claimWatchers.delete(fn);
  }
  /** The archive wrote a feed row, inside its transaction: read it once that is over, a burst once (M7-D32). */
  #claimsChanged() {
    if (this.#claimsWake) return;
    this.#claimsWake = setImmediate(() => {
      this.#claimsWake = null;
      this.#publishClaims();
      for (const fn of [...this.#claimWatchers])
        try {
          fn();
        } catch (e) {
          this.log("warn", `memory: a claims watcher failed: ${/** @type {any} */ (e)?.message || e}`);
        }
    });
  }
  /**
   * The fan-out follows the archive just opened (M7-D36), from its newest row, and says reset: every page reads all it
   * shows again. Another store (the owner reset theirs) shows other claims; the same one, reopened after an open that
   * failed, answered nothing meanwhile, and a page that read then shows the failure. An open is rare (the switch, the
   * folder, the engine or privacy changed), a page's read of all it shows cheap. The streams follow by the epoch.
   */
  #followFeed() {
    const { epoch, last } = /** @type {Archive} */ (this.archive).feed.position();
    this.#fan = { epoch, read: last };
    this.#tellClaims({ type: "claims", reset: true, last: `${epoch}:${last}` });
    this.#claimsChanged();
  }
  /** Each page of new changes, onto the fan-out (M7-D36): `prev` is where it read from, the `last` the message before said. */
  #publishClaims() {
    const a = this.archive;
    const fan = this.#fan;
    if (!a || !fan) return;
    for (;;) {
      const prev = fan.read;
      const { rows, through } = a.feed.after({ after: prev, limit: FEED_PAGE });
      fan.read = through;
      if (rows.length) this.#tellClaims({ type: "claims", prev: `${fan.epoch}:${prev}`, last: `${fan.epoch}:${through}`, changes: rows.map((r) => claimChange(fan.epoch, r)) });
      if (rows.length < FEED_PAGE) return;
    }
  }
  /** @param {any} msg */
  #tellClaims(msg) {
    try {
      this.onClaims?.(msg);
    } catch (e) {
      this.log("warn", `memory: the claims fan-out failed: ${/** @type {any} */ (e)?.message || e}`);
    }
  }
  /**
   * The claims feed keeps FEED_DAYS (M7-D32) and the outcomes OUTCOME_DAYS (M7-D51), by the clock that stamps their
   * rows: pruned when memory opens and once a day after; one that fails leaves the other to run.
   */
  #prune() {
    const a = this.archive;
    if (!a) return;
    for (const [what, run] of /** @type {[string, () => void][]} */ ([
      ["the claims feed's", () => a.feed.prune(a.now() - FEED_DAYS * DAY_MS)],
      ["the outcomes'", () => a.outcomes.prune(a.now() - OUTCOME_DAYS * DAY_MS)],
    ]))
      try {
        run();
      } catch (e) {
        this.log("warn", `memory: ${what} prune failed: ${/** @type {any} */ (e)?.message || e}`);
      }
  }
  /**
   * One finished piece of an agent's work (HarnessV3-Memory M7-D48): what it did is read from its calls, and it is kept
   * with its session, on its turn (none given: its request's). Nothing is kept while memory is off or closed.
   * Never throws: an outcome is a record, and the work it records is done. → its id, or null when none was kept.
   * @param {import("./outcomes.js").OutcomeInput} o
   */
  recordOutcome(o) {
    const a = this.archive;
    if (!a || !this.enabled()) return null;
    try {
      if (!a.getChain(o.chain)) return null;
      return a.outcomes.add({
        chain: o.chain,
        turn: o.turn ?? (o.request ? a.turnOfRequest(o.chain, o.request) : null),
        request: o.request ?? null,
        kind: o.kind,
        agent: o.agent ?? null,
        model: o.model,
        did: didOf(o.counts),
        counts: o.counts,
        ended: o.ended,
        rounds: o.rounds,
        calls: callsIn(o.counts),
        tokensIn: o.tokensIn,
        tokensOut: o.tokensOut,
        usd: o.usd,
        ms: Math.max(0, Math.round(o.ms)),
      });
    } catch (e) {
      this.log("warn", `memory: an outcome was not kept: ${/** @type {any} */ (e)?.message || e}`);
      return null;
    }
  }
  /**
   * A team's lead said a worker's reported work fell short (M7-D50): the outcome its run's request kept, not corrected
   * yet, counts as corrected by the lead. Nothing is marked while memory is off or closed. Never throws: the follow-up
   * that carries the correction goes on whatever happens here. → how many were marked.
   * @param {{ chainId: string, request: string }} c
   */
  correctWorker(c) {
    const a = this.archive;
    if (!a || !this.enabled()) return 0;
    try {
      return Number(a.outcomes.correctWorker(c.chainId, c.request)) || 0;
    } catch (e) {
      this.log("warn", `memory: a lead's correction was not kept: ${/** @type {any} */ (e)?.message || e}`);
      return 0;
    }
  }
  /**
   * How models did (M7-D52): the outcomes of the last `days`, in `project` or everywhere, of `kind` or every kind, by
   * model and kind. @param {{ project?: string | null, days?: number, kind?: string | null }} [o]
   */
  outcomes({ project = null, days = 30, kind = null } = {}) {
    const a = this.archive;
    if (!a) throw new Error(`no archive: ${this.archiveWhy()}`);
    const rows = a.outcomes.list({ since: a.now() - days * DAY_MS, project, kind });
    return { project, days, kind, runs: rows.length, groups: outcomeTable(rows) };
  }
  /**
   * Memory's metrics over the last `days` (the memory plan's b4): what each layer showed and what of it the work used,
   * by day, its tokens, the showings that came again, whose memories are used, what was served then corrected, and what
   * fades now — from the injection log on disk, so the figures outlive a restart. @param {{ days?: number }} [o]
   */
  metrics({ days = METRIC_DAYS } = {}) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.brain.metrics(days);
  }
  /**
   * How often each memory was shown over the last `days`, and used (b4). @param {string[]} refs @param {{ days?: number }} [o]
   * @returns {Record<string, { shown: number, judged: number, used: number }>}
   */
  useCounts(refs, { days = METRIC_DAYS } = {}) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    return Object.fromEntries(this.brain.useCounts(refs, days));
  }
  /** One claim's card as the claim browser draws it, or why there is none (M7-D34). @param {string} id */
  card(id) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.brain.card(id);
  }
  /** Where claims live: "Everywhere", then each project, with its count (M6-5). */
  claimScopes() {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.brain.claimScopes();
  }
  /** A project's dossier as a session starting now reads it (HarnessV3-Memory M4-7), or null. @param {string} projectId */
  dossier(projectId) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.brain.dossierOf(String(projectId));
  }
  // A project's topic pages as a search serves them now (the memory plan's f7).
  pages(projectId) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.brain.pagesOf(String(projectId));
  }
  // The session's family: ancestors (lineageOf, newest first) and descendants (parent links and incoming
  // continues/child edges, breadth-first, capped), plus the edges between the nodes that made it in.
  lineage(chainId) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    const chain = this.archive.getChain(chainId);
    if (!chain) return null;
    const nodes = new Map();
    const edges = [];
    const seen = new Set();
    const add = (c, depth) => {
      if (!c || seen.has(c.id) || nodes.size >= 40) return false;
      seen.add(c.id);
      nodes.set(c.id, {
        id: c.id,
        title: c.title || null,
        // An untitled node is named by its first message, as the sessions list names its row (HarnessV3-Launch F14).
        preview: c.title ? null : c.preview || null,
        when: c.last_at || c.started_at || null,
        turns: c.turns || 0,
        depth,
        current: c.id === chainId,
      });
      return true;
    };
    add(chain, 0);
    const ancestors = this.brain ? this.brain.lineageOf(chain) : [];
    ancestors.forEach((a, i) => add(a, -(i + 1)));
    for (let i = 0; i < ancestors.length; i++)
      edges.push({ src: i === 0 ? chain.id : ancestors[i - 1].id, dst: ancestors[i].id, type: "continues" });
    // A fork is a descendant too, but a fork's source is not an ANCESTOR (lineageOf walks parent_id/continues only,
    // so recall never crosses a fork edge into the turns the fork rewound away from); here the graph shows it, with
    // the turn it forked at, so the Sessions page can draw the branch point.
    const forkOf = (c) => (c?.meta?.fork?.from ? { from: c.meta.fork.from, atTurn: c.meta.fork.atTurn } : null);
    const source = forkOf(chain);
    if (source) {
      const sc = this.archive.getChain(source.from);
      if (sc && add(sc, -1)) edges.push({ src: chain.id, dst: sc.id, type: "forked", atTurn: source.atTurn });
    }
    const kidEdges = (id) =>
      this.archive.linksFor(id).filter((l) => l.dst === id && ["continues", "child", "forked"].includes(l.type));
    let frontier = [chain.id];
    for (let depth = 1; depth <= 4 && nodes.size < 40; depth++) {
      const next = [];
      for (const id of frontier) {
        const kids = new Map();
        for (const c of this.archive.chainsChildren(id)) kids.set(c.id, { chain: c, type: "child" });
        for (const l of kidEdges(id)) kids.set(l.src, { chain: this.archive.getChain(l.src), type: l.type });
        for (const [kidId, { chain: kc, type }] of kids) {
          if (seen.has(kidId) || !kc) continue;
          if (!add(kc, depth)) continue;
          const edge = { src: kidId, dst: id, type };
          if (type === "forked") edge.atTurn = forkOf(kc)?.atTurn ?? null;
          edges.push(edge);
          next.push(kidId);
        }
      }
      if (!next.length) break;
      frontier = next;
    }
    const edgeKey = new Set();
    for (const id of [...nodes.keys()])
      for (const l of this.archive.linksFor(id))
        if (l.type === "loaded" && nodes.has(l.src) && nodes.has(l.dst)) {
          const k = `${l.src}>${l.dst}`;
          if (!edgeKey.has(k)) {
            edgeKey.add(k);
            edges.push({ src: l.src, dst: l.dst, type: "loaded" });
          }
        }
    return { root: chainId, nodes: [...nodes.values()], edges };
  }
  turnDetail(turnId) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.archive.turnDetail(Number(turnId));
  }
  // The items behind an injection row. Each id resolves the way the model's tools resolve it (MD-9): a learned item
  // (i<n>, or an engine twin), past words (s:), or an engine memory fetched by id. A retired item
  // shows with its status.
  async injectionItems(ids = []) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    const out = [];
    for (const raw of ids.slice(0, 30)) {
      const id = String(raw);
      const ref = this.brain.resolveRef(id);
      if (ref.type === "words") out.push({ id, kind: "session", text: "a matching turn of a past session (found by search)" });
      else if (ref.type === "item")
        out.push({ id, kind: ref.item.kind, text: ref.item.text, chainId: ref.item.chain_id || null, itemId: ref.item.id, status: ref.item.status });
      else {
        let row = null;
        try {
          if (ref.type === "engine" && this.store?.status?.().state === "ready") row = await this.store.get(ref.engineId);
        } catch {}
        out.push(row?.content ? { id, kind: row.memory_type || row.source || "memory", text: row.content } : { id, kind: "memory", text: null });
      }
    }
    return out;
  }
  session(id, { view = "chat", budgetTokens = 8000, fromTurn = null, toTurn = null } = {}) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    const ch = this.archive.getChain(id);
    if (!ch) return null;
    const turns = this.archive.getTurns(id);
    return {
      chain: ch,
      project: this.projectNamed(ch.project_id),
      turns: turns.map((t) => ({
        id: t.id,
        n: t.n,
        startedAt: t.started_at,
        endedAt: t.ended_at,
        inputChars: t.input_chars,
        outputChars: t.output_chars,
        summary: t.summary,
        work: (t.work || []).length,
      })),
      compactions: this.archive.compactionsWithText?.(id) || [],
      rendered: this.archive.render(id, { view, budgetTokens, fromTurn, toTurn }),
    };
  }
  items(opts = {}) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    // Each row names its project (LD-D8): the always-allow offers show the folder, not its id.
    /** @type {Map<string, ReturnType<MemoryService["projectNamed"]>>} */
    const named = new Map();
    return this.archive.items.list(opts).map((/** @type {any} */ it) => {
      if (!named.has(it.project_id)) named.set(it.project_id, this.projectNamed(it.project_id));
      const p = named.get(it.project_id);
      return { ...it, projectName: p?.name ?? null, projectCwd: p?.cwd ?? null };
    });
  }
  activity({ limit = 50 } = {}) {
    if (!this.archive) return [];
    return this.archive.injections.recent(limit);
  }
  /** The facts about the user that hold in every project, as the Memory page's Identity facts list them (the memory plan's f5). */
  identity() {
    return this.brain ? this.brain.identityFacts() : [];
  }
  // Past sessions and an existing Mnemosyne database, as background jobs with progress.
  sources() {
    try {
      return detectSources();
    } catch (e) {
      return { error: e.message };
    }
  }
  // ---- chats from other coding agents: the Import section (the plan: HarnessV4_Import_Plan in the vault) -----------
  /** The import under way. One runs at a time: two writers to one session would make its turns twice. @type {any} */
  #importJob = null;
  /** One import at a time: one asked for while another runs is refused, in words, before anything is read for it. */
  #oneAtATime() {
    if (this.#importJob?.status === "running") throw refusal("an import is running: wait for it to end, or stop it");
  }
  /** @param {string} kind @param {(onProgress: (p: any) => void, signal: AbortSignal) => Promise<any>} run */
  #startImport(kind, run) {
    this.#oneAtATime();
    const stop = new AbortController();
    const job = this.startJob(kind, (onProgress) => run(onProgress, stop.signal));
    this.#stoppable(job, stop);
    this.#importJob = job;
    return job;
  }
  /** The sessions Filament's bridges run in the coding agents, by the agent's own id (the server sets `agentSessionIds`). */
  #ownIds() {
    return this.agentSessionIds?.() || null;
  }
  /**
   * What the Import section shows first: the agents with their chats' counts and states, what a Sync would bring, the
   * person's choices, the last run, the import under way, the room left on the archive's drive, and what memory has
   * not read of the imported chats, with the model that would read them, or why it can read none (`why`), and its
   * reading under way. `list`: what a Sync would bring names its chats too (the welcome tour's Your chats).
   * @param {{ list?: boolean }} [o]
   */
  async importOverview({ list = false } = {}) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    const overview = await importOverview({ archive: this.archive, home: this.home, folder: this.folder, ownIds: this.#ownIds(), now: this.now(), list });
    const job = this.#importJob?.status === "running" ? this.#importJob : null;
    const reading = this.#reading();
    return {
      ...overview,
      job: job ? { id: job.id, kind: job.kind } : null,
      reading: reading ? { id: reading.id } : null,
      learner: { model: this.modelFor({}).model || null, why: !this.learner ? "memory is switched off" : this.modelFor({}).model ? null : this.#whyNoModel().replace(/^no learning model: /, "") },
    };
  }
  /** One agent's chats, each with how it stands in Filament, the newest first. @param {string} sourceId */
  async importChats(sourceId) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    const source = sourceById(String(sourceId || ""));
    if (!source) throw refusal(`no such agent: ${String(sourceId || "").slice(0, 40) || "none named"}`);
    const where = source.where(this.home);
    if (!source.found(where)) return { source: source.id, label: source.label, where, found: false, chats: [] };
    const state = importState(this.archive);
    const chats = await chatStates(source, { archive: this.archive, where, ownIds: this.#ownIds(), removed: state.removed, empty: state.empty });
    return { source: source.id, label: source.label, where, found: true, chats: chats.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)) };
  }
  /** The person's choices for the section, changed. @param {{ reachDays?: unknown, on?: unknown, learn?: unknown }} patch */
  importPrefs(patch) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    const s = setImportPrefs(this.archive, patch || {});
    return { prefs: { reachDays: s.reachDays, on: s.on, learn: s.learn } };
  }
  /**
   * The chats named, brought in: from one agent (`source`, with `chats`: their ids on its list — Browse's), or from
   * several in one run (`picks`: an agent and its chats each — the welcome tour's Your chats; the job is
   * `import-chosen`). A chat that Filament ran itself is not taken, and one the person removed comes back, since they
   * ask for it by name. Of `picks`, an agent none of whose chats named is on its list brings nothing, and the others'
   * come in; where no chat named is on its agent's list at all, the request is refused.
   * @param {{ source?: string, chats?: unknown, picks?: unknown, learn?: boolean }} o
   */
  async importChosen({ source: sourceId, chats: ids, picks, learn }) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    const several = picks !== undefined;
    /** @type {any[]} */
    const asked = several ? (Array.isArray(picks) ? picks : []) : [{ source: sourceId, chats: ids }];
    if (!asked.length) throw refusal("name the chats to import");
    /** Each agent named, once, with where its chats are and the ids asked of it. @type {Map<any, { where: string, wanted: Set<string> }>} */
    const named = new Map();
    for (const pick of asked) {
      const source = sourceById(String(pick?.source || ""));
      if (!source) throw refusal(`no such agent: ${String(pick?.source || "").slice(0, 40) || "none named"}`);
      const where = source.where(this.home);
      if (!source.found(where)) throw refusal(`${source.label} keeps no chats at ${where}`);
      const entry = named.get(source) || { where, wanted: new Set() };
      for (const id of Array.isArray(pick.chats) ? pick.chats : []) entry.wanted.add(String(id));
      named.set(source, entry);
    }
    if (![...named.values()].some((n) => n.wanted.size)) throw refusal("name the chats to import");
    this.#oneAtATime();
    const state = importState(this.archive);
    /** @type {{ source: any, where: string, chats: any[], bytes: number }[]} */
    const plan = [];
    for (const [source, { where, wanted }] of named) {
      if (!wanted.size) continue;
      const all = await chatStates(source, { archive: this.archive, where, ownIds: this.#ownIds(), removed: state.removed, empty: state.empty });
      const chats = all.filter((c) => c.state !== "own" && wanted.has(c.id));
      if (chats.length) plan.push({ source, where, chats, bytes: chats.reduce((n, c) => n + (c.bytes || 0), 0) });
    }
    if (!plan.length) throw refusal(several ? "none of those chats is on its agent's list" : "none of those chats is on the agent's list");
    return this.#startImport(several ? "import-chosen" : `import-${plan[0].source.id}`, async (onProgress, signal) => {
      forgetRemoved(this.archive, plan.flatMap((p) => p.chats.map((c) => c.key)));
      return this.#importDone("browse", await this.#runPlan(plan, onProgress, signal), { learn: learn ?? state.learn });
    });
  }
  /**
   * Sync: from every agent the person switched on (none is, until they do), the chats that are new or have grown and
   * were active inside the reach. One job; its progress goes agent by agent.
   */
  async importSync() {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    this.#oneAtATime();
    const state = importState(this.archive);
    const now = this.now();
    const plan = (
      await Promise.all(
        SOURCES.filter((s) => state.on.includes(s.id)).map(async (source) => {
          const where = source.where(this.home);
          if (!source.found(where)) return null;
          // An agent whose store cannot be read brings nothing: its row in the section says why.
          const chats = pendingOf((await readChats(source, { archive: this.archive, where, ownIds: this.#ownIds(), removed: state.removed, empty: state.empty })).chats, { reachDays: state.reachDays, now });
          return chats.length ? { source, where, chats, bytes: chats.reduce((n, c) => n + (c.bytes || 0), 0) } : null;
        }),
      )
    ).filter((p) => p != null);
    return this.#startImport("import-sync", async (onProgress, signal) => this.#importDone("sync", await this.#runPlan(plan, onProgress, signal), { learn: state.learn, reachDays: state.reachDays }));
  }
  /**
   * A run's chats brought in agent by agent, on one progress scale: each agent's part of it is its chats' share of
   * the bytes to read. → what each agent's run did, by its id.
   * @param {{ source: any, where: string, chats: any[], bytes: number }[]} plan @param {(p: any) => void} onProgress @param {AbortSignal} signal
   */
  async #runPlan(plan, onProgress, signal) {
    /** @type {Record<string, any>} */
    const results = {};
    const total = plan.reduce((n, p) => n + p.bytes, 0);
    let before = 0;
    for (const p of plan) {
      const share = total ? p.bytes / total : 1 / plan.length;
      const base = total ? before / total : 0;
      results[p.source.id] = await p.source.run({
        archive: this.archive,
        where: p.where,
        only: new Set(p.chats.map((c) => c.id)),
        signal,
        onProgress: (/** @type {any} */ q) => onProgress({ ...q, ...(q.percent != null ? { percent: Math.round((base + (q.percent / 100) * share) * 100) } : {}) }),
      });
      before += p.bytes;
    }
    return results;
  }
  /**
   * An import's end: what came in, per agent and in all, kept for the section; the chats that held no turn are
   * remembered, so no Sync counts them as new again; the session lists read again; memory reads the new chats when
   * the person chose so.
   * @param {"sync" | "browse"} by @param {Record<string, any>} results @param {{ learn?: boolean, reachDays?: number }} o
   */
  #importDone(by, results, { learn = false, reachDays } = {}) {
    const add = (/** @type {string} */ k) => Object.values(results).reduce((n, r) => n + (Number(r?.[k]) || 0), 0);
    const errors = Object.entries(results).flatMap(([source, r]) => (r?.errors || []).map((/** @type {any} */ e) => ({ source, ...e })));
    // The lines too long to read, each left out while the rest of its chat came in (sink.js `LINE_MAX_BYTES`).
    const long = Object.entries(results).flatMap(([source, r]) => (r?.long || []).map((/** @type {any} */ l) => ({ source, ...l })));
    const empty = Object.values(results).flatMap((r) => r?.empty || []);
    noteEmpty(this.archive, empty);
    const out = {
      by,
      at: this.now(),
      ...(reachDays != null ? { reachDays } : {}),
      chats: add("chains"),
      newChats: add("newChains"),
      newTurns: add("newTurns"),
      ...(empty.length ? { empty: empty.length } : {}),
      errors,
      ...(long.length ? { long } : {}),
      sources: Object.fromEntries(Object.entries(results).map(([id, r]) => [id, { chats: r.chains, newChats: r.newChains, newTurns: r.newTurns, errors: (r.errors || []).length }])),
    };
    noteImportRun(this.archive, out);
    this.sessionLists?.clear?.();
    if (learn && out.newTurns && !this.#reading()) this.backfill({ imported: true });
    return out;
  }
  /**
   * The console's Import: every chat of Claude Code (`claude-code`), or an existing Mnemosyne database.
   * The chats go through the door the Import section's runs go through: one import at a time, and it can be stopped.
   */
  import({ source, root, srcFile, replace = false, learn = true } = {}) {
    if (!this.archive) throw new Error(`no archive: ${this.archiveWhy()}`);
    if (source === "claude-code")
      return this.#startImport(`import-${source}`, async (onProgress, signal) => {
        const r = await importClaudeCode({ archive: this.archive, root: root || undefined, onProgress, signal });
        this.sessionLists?.clear?.();
        if (learn && !this.#reading()) this.backfill();
        return r;
      });
    return this.startJob(`import-${source}`, async (onProgress) => {
      let r;
      if (source === "mnemosyne") {
        if (!srcFile) throw new Error("srcFile is required");
        if (this.store) {
          try {
            // Closed for good, its process ended: whoever still holds it — a turn's recall, the outbox — must not start
            // it again over the database the copy replaces. The engine memory opens after the copy is a new one.
            await (this.store.close ? this.store.close() : this.store.stop?.());
          } catch {}
        }
        try {
          r = await importMnemosyneDb({ srcFile, memoryFolder: this.folder, onProgress, replace });
        } finally {
          // A new engine: its rows are adopted at the restart, like a first start's (M2-3).
          this.archive.schemaMetaSet("engineAdoption", null);
          this.openedWith = null;
          this.start();
        }
        await this.engineStart;
        r.adopted = this.archive?.schemaMetaGet("engineAdoption") || null;
        if (this.store?.reindex) {
          onProgress({ step: "mnemosyne", message: "rebuilding embeddings for the imported memories" });
          const brain = this.brain;
          if (brain) brain.reembedding = true;
          try {
            r.reindex = await this.store.reindex();
          } catch (e) {
            r.reindexError = e.message;
          } finally {
            if (brain) brain.reembedding = false;
          }
        }
      } else throw new Error(`unknown source ${source}`);
      return r;
    });
  }
  // Learn from archived sessions that were never learned from (imports), newest first, a bounded batch per run.
  // `imported`: only the chats an import made (the Import section says how many those are before the click).
  // `signal`: the person's stop, heard between sessions: the one being read is read to its end.
  // Says how many it read, how many held nothing to read, and why each other was left unread (`unread`, by reason);
  // its progress counts the unread as it goes, so a reading that goes wrong is seen before its end.
  async backfillLearning({ limit = 200, onProgress = () => {}, imported = false, signal = null } = {}) {
    if (!this.learner || !this.archive) return { learned: 0 };
    const waiting = imported
      ? unreadChats(this.archive)
      : this.archive.recentChains({ limit: 5000 }).filter((c) => (c.turns || 0) > 0 && !(c.meta?.learnedThrough >= (c.turns || 0)));
    const chains = waiting.slice(0, limit);
    let n = 0;
    let nothing = 0;
    let unread = 0;
    /** @type {Map<string, number>} */
    const why = new Map();
    for (const [i, c] of chains.entries()) {
      if (signal?.aborted) throw Object.assign(new Error("memory's reading was stopped"), { aborted: true });
      onProgress({ step: "learn", message: `session ${c.id}`, percent: Math.round((i / chains.length) * 100), done: i, total: chains.length, unread });
      // A deliberate backfill is not bound by the daily cap.
      const r = await this.learner.learnChain(c.id, { reason: "backfill", uncapped: true });
      const left = unreadWhy(r);
      if (left) {
        unread++;
        why.set(left, (why.get(left) || 0) + 1);
      } else if (r.skipped) nothing++;
      else n++;
    }
    return { learned: n, considered: chains.length, nothing, unread: [...why].map(([w, chats]) => ({ why: w, chats })) };
  }
  /** Memory's reading under way, or null: one at a time. */
  #reading() {
    return [...this.jobs.values()].find((j) => j.kind === "learn-backfill" && j.status === "running") || null;
  }
  /** Memory's reading as a job the person sees and can stop; refused in words while one runs. */
  backfill(opts = {}) {
    if (this.#reading()) throw refusal("memory is reading already: wait for it to end, or stop it");
    const stop = new AbortController();
    const job = this.startJob("learn-backfill", (onProgress) => this.backfillLearning({ ...opts, onProgress, signal: stop.signal }));
    this.#stoppable(job, stop);
    // How it ended is kept for the Import section: a reading an import started may end with nobody looking. One
    // stopped, or one memory closed under, leaves no note.
    job.done.then((r) => noteReading(this.archive, { at: this.now(), ...r })).catch(() => {});
    return job;
  }
  // The reindex: every standing item the engine holds no copy of (a write set aside, or made before the outbox) is
  // queued again through the outbox (HarnessV3-Memory M2-2), and the run waits for it to drain.
  async mirrorItems({ limit = 2000, onProgress = () => {} } = {}) {
    if (!this.archive || !this.store || !this.brain) throw new Error("memory engine unavailable");
    const items = this.archive.items
      .list({ limit: 5000 })
      .filter((it) => !it.memory_id && !isRetired(it.status))
      .slice(0, limit);
    onProgress({ step: "mirror", message: `${items.length} items queued`, done: 0, total: items.length });
    this.archive.transaction(() => {
      for (const it of items) this.brain.enqueue(it.id, "mirror", { via: "filament-reindex" });
    });
    await this.brain.outbox.drain();
    const stored = items.filter((it) => this.archive.items.get(it.id)?.memory_id).length;
    return { considered: items.length, stored, failed: items.length - stored };
  }
  mirror(opts = {}) {
    return this.startJob("mirror", (onProgress) => this.mirrorItems({ ...opts, onProgress }));
  }
  /** Set a fact about the user that holds in every project, by its name: the owner's word (f5). @param {{ name: string, body: string }} row */
  async identitySet({ name, body }) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.brain.setIdentity(String(name), String(body), { by: "owner" });
  }
  /** Retire a fact about the user that holds in every project, by its id, else its name (f5). @param {{ id?: string, name?: string }} row */
  async identityForget({ id, name }) {
    if (!this.brain) throw new Error(`no archive: ${this.archiveWhy()}`);
    return this.brain.forgetIdentity({ id: id ? String(id) : undefined, name: name ? String(name) : undefined }, { by: "owner" });
  }
  /**
   * Filament owns what is true (HarnessV3-Memory MD-0): what the engine wrote by itself — its sleep summaries and its
   * model-refresh guesses, which it applied unchecked and Filament then served (F12, F13) — is marked superseded in the
   * engine when it starts, so it stops crowding recall. Nothing is deleted: the ids are kept in the archive, and
   * undoing it is clearing two columns on exactly those rows. The brain never serves such rows in any case.
   */
  async fenceEngine() {
    const store = this.store;
    if (!store?.fence) return null;
    const r = await store.fence();
    const got = { working: r?.working || [], episodic: r?.episodic || [], canonical: r?.canonical || [] };
    const n = got.working.length + got.episodic.length + got.canonical.length;
    if (n && this.archive) {
      const prev = this.archive.schemaMetaGet("engineFence") || {};
      const ids = (k) => [...new Set([...(prev[k] || []), ...got[k]])];
      this.archive.schemaMetaSet("engineFence", { at: Date.now(), working: ids("working"), episodic: ids("episodic"), canonical: ids("canonical") });
      this.#archiveOp(`memory engine: ${n} row${n === 1 ? "" : "s"} the engine wrote by itself fenced off`, {
        sub: "fence",
        detail: { working: got.working.length, episodic: got.episodic.length, canonical: got.canonical.length },
      });
    }
    return got;
  }
  /**
   * Every row the engine can serve gets a claim (HarnessV3-Memory M2-3), once per engine: the bulk adoption runs at the
   * first start and is recorded like the fence (`engineAdoption`). An engine import clears the record, so the restart
   * after it adopts what was imported. Recall adopts any row written since, the first time it sees one.
   */
  async adoptEngine() {
    if (!this.store?.rows || !this.archive || !this.brain) return null;
    if (this.archive.schemaMetaGet("engineAdoption")) return null;
    const got = await this.brain.adoptRows();
    this.archive.schemaMetaSet("engineAdoption", { at: this.now(), ...got });
    this.#archiveOp(`memory engine: ${got.rows} row${got.rows === 1 ? "" : "s"} read, ${got.adopted} adopted as claims`, {
      sub: "adopt",
      detail: got,
    });
    return got;
  }
  /**
   * The engine's vectors as the model it runs makes them (the memory plan's c2): a store whose vectors no record says
   * this model made — its model changed with a release's bundle — has every one made again (`reindex`), recall reading
   * the archive alone meanwhile (`brain.reembedding`: vectors of two models are never compared), and the model is
   * recorded (`engineVectors`), so it runs once a model. An empty store is recorded alone; one that fails is made again
   * at the next start. → the reindex's answer, or null where none ran.
   */
  reembedEngine() {
    // One at a time: the start's, and any asked for while it runs, are the same.
    this.#reembedding ??= this.#reembed().finally(() => (this.#reembedding = null));
    return this.#reembedding;
  }
  /** @type {Promise<any> | null} */
  #reembedding = null;
  async #reembed() {
    const store = this.store;
    try {
      const hello = store?.status?.().hello || null;
      const model = hello?.embeddings ? String(hello.embeddingModel || "") : "";
      if (!model || !this.archive || !this.brain || this.store !== store) return null;
      if (this.archive.schemaMetaGet("engineVectors")?.model === model) return null;
      // An engine about to give way to this release's makes none: its install, armed only once the server listens,
      // stops it part way. The one that replaces it makes them at its own start.
      if (this.#givesWay()) return null;
      const rows = Number(hello.counts?.working || 0) + Number(hello.counts?.episodic || 0);
      let r = null;
      if (rows) {
        this.log("info", `memory: making the engine's ${rows} vectors again with ${model}; recall reads the archive alone until it ends`);
        const brain = this.brain;
        brain.reembedding = true;
        try {
          r = await this.reindex();
        } finally {
          brain.reembedding = false;
        }
      }
      if (this.store === store) this.archive?.schemaMetaSet("engineVectors", { model, at: this.now(), rows });
      return r;
    } catch (e) {
      this.log("warn", `memory: making the engine's vectors again failed (${String(/** @type {any} */ (e)?.message || e).slice(0, 160)}); it runs again at the next start`);
      return null;
    }
  }
  async reindex() {
    const t0 = Date.now();
    // While the engine makes its vectors again, half of them are made: recall reads the archive alone, and the curator
    // looks nothing up by meaning (the memory plan's f6), whoever asked for it.
    const brain = this.brain;
    const was = !!brain?.reembedding;
    if (brain) brain.reembedding = true;
    // The guard lives inside the try so an unavailable engine records the attempt, rather than throwing in silence.
    try {
      if (!this.store?.reindex) throw new Error("memory engine unavailable");
      const r = await this.store.reindex();
      this.#archiveOp(`memory embeddings reindexed`, {
        sub: "reindex",
        ms: Date.now() - t0,
        detail: { ok: true },
      });
      return r;
    } catch (e) {
      this.#archiveOp(`memory reindex failed: ${String(e.message).slice(0, 160)}`, {
        sub: "reindex",
        level: "error",
        ms: Date.now() - t0,
        detail: { error: String(e.message).slice(0, 160) },
      });
      throw e;
    } finally {
      if (brain) brain.reembedding = was;
    }
  }
  async hygiene(opts) {
    if (!this.store) throw new Error("memory engine unavailable");
    return this.store.hygiene(opts);
  }
  async diagnose() {
    if (!this.store?.diagnose) throw new Error("memory engine unavailable");
    return this.store.diagnose();
  }
}

/** The switches of who answers a chat it keeps, newest last. */
const ENGINE_MARKS = 100;

/** The team whose lead answers under a document, else null: the agent. @param {any} eff */
const leaderOf = (eff) => (eff?.engine?.mode === "team" && eff.engine.team ? String(eff.engine.team) : null);

/** Whether a write names the engine's mode or team. @param {any} patch @param {string[]} unset */
function touchesEngine(patch, unset) {
  const keys = Object.keys(patch || {});
  return keys.some((k) => k === "engine" || k === "engine.mode" || k === "engine.team") || (Array.isArray(unset) ? unset : []).some((u) => u === "engine" || u === "engine.mode" || u === "engine.team");
}

/**
 * Why a write would change who a team's own chat is, else null (team_v2_plan §5.3; found by the Bug Hunter, 10-19: In
 * charge could hand a team's chat to another team). Its team is the chat — its lead started from the main chat's record
 * — so no write sets another team on it, or gives it back to an agent; its birth, which sets the team, still writes.
 * @param {any} chain @param {any} layer  its settings layer as it stands @param {any} patch @param {string[]} unset
 */
function teamChatKeeps(chain, layer, patch, unset) {
  if (chain?.kind !== "team") return null;
  const had = layer?.engine?.team ?? layer?.["engine.team"];
  if (!had) return null;
  /** @param {string} k */
  const asked = (k) => patch?.[`engine.${k}`] ?? patch?.engine?.[k];
  const gone = (Array.isArray(unset) ? unset : []).some((u) => u === "engine" || u === "engine.mode" || u === "engine.team");
  const mode = asked("mode");
  const team = asked("team");
  if (gone || (mode !== undefined && mode !== "team") || (team !== undefined && team !== had))
    return "a team's own chat keeps its team: put a team in charge of its main chat instead";
  return null;
}
