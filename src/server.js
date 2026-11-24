// HTTP server: model endpoints (/v1/messages, /v1/chat/completions), admin API (/api/*) and the UI.
// First, before any module that may start a program: on Windows a bare name is the PATH's, never a project folder's.
import "./adapters/tools/own-programs.js";
import http from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appDataDir, createConfigStore, hostAndPort, isCheckout, selfAddress } from "./services/config/store.js";
import { removeListening, writeListening } from "./cli/listening.js";
import { createSelfUpdate } from "./cli/update.js";
import { contextWindowForModel, findUpstream, aggregateModels } from "./core/routing.js";
import { priceCard } from "./core/pricing.js";
import { placeOfName } from "./core/model-caps.js";
import { poolName } from "./core/pool.js";
import { git, gitAbove, placeOf } from "./adapters/git/snapshot.js";
import { isAgentUpstream, isMachineUpstream } from "./core/schema.js";
import { prefixRouteOf } from "./core/providers.js";
import { sameIdentity } from "./core/agent-limits.js";
import { httpDestination } from "./adapters/providers/http.js";
import { filamentDestination, forgetOffline } from "./adapters/providers/filament.js";
import { fetchLimitsLifted } from "./adapters/providers/fetch.js";
import { UsageStore, redactSecrets } from "./services/records.js";
import { houseAuth } from "./services/house.js";
import { loopbackPost } from "./services/loopback.js";
import { OpLog, wireMemoryOps, wireHealthOps } from "./services/oplog.js";
import { watchLoopStalls } from "./services/loop-stall.js";
import { watchLoopHealth } from "./services/loop-health.js";
import { AGENT_WORK, AcpBridge } from "./adapters/agents/acp/bridge.js";
import { CodexBridge } from "./adapters/agents/codex/bridge.js";
import { acpDestination, codexDestination, cursorDestination } from "./adapters/agents/destinations.js";
import { detectedAgentSeed, upstreamLogin } from "./adapters/agents/acp/detect.js";
import { createEventBus } from "./services/events.js";
import { createRunLog, runRetentionDays } from "./services/runs.js";
import { createChangesKept } from "./services/changes-kept.js";
import { censusOf, postCensus } from "./services/memory-log.js";
import { createLiveWords } from "./services/live-words.js";
import { createAgentAccounts } from "./services/agent-accounts.js";
import { createMachine } from "./services/machine.js";
import { UNREAD_DEVICE, createDevices, fullControl, heldGrant } from "./services/devices.js";
import { createOwner } from "./services/owner.js";
import { copiesRootOf, createCopies } from "./services/copies.js";
import { createTransfers } from "./services/transfers.js";
import { bundleKept, captureCopy, checkoutCopy, dropKept, importBundle, keepCapture, mirrorHas, mirrorHaves } from "./adapters/git/send.js";
import { createMachines } from "./services/machines/index.js";
import { createLanListener, lanNames } from "./services/lan-tls.js";
import { createTailnetShare, fileMemo } from "./services/tailscale.js";
import { createAgentLogins } from "./app/agent-logins.js";
import { createChatNamer } from "./app/chat-namer.js";
import { createChatWatchers } from "./app/chat-watchers.js";
import { createAgentSelf } from "./app/agent-self.js";
import { createCodingAgents } from "./app/coding-agents.js";
import { createRegistry } from "./adapters/agents/registry.js";
import { createAgyFeed, withAgyFeed } from "./adapters/agents/agy-feed.js";
import { createInstalls } from "./adapters/agents/installs.js";
import { createReplayCompare } from "./app/sessions/replay-compare.js";
import { createTerminalService } from "./services/terminal.js";
import { SessionTurns } from "./services/session-turns.js";
import { SessionWriters } from "./services/session-writers.js";
import { createCacheChurnWatch } from "./services/cache-churn.js";
import { LISTED_KINDS, holderLabel } from "./services/memory/brain.js";
import { spawnTerminal, windowsPtyOf } from "./adapters/terminal/pty.js";
import { terminalUpgrade } from "./http/admin/terminal.js";
import { runSocketUpgrade } from "./http/admin/run-socket.js";
import { browserUpgrade } from "./http/admin/browser.js";
import { tunnelsFor } from "./http/admin/tunnel.js";
import { createBrowserHost } from "./app/browser/host.js";
import { createHeadlessHost, findChrome } from "./app/browser/headless-host.js";
import { createBrowsers } from "./app/browser/registry.js";
import { BROWSER } from "./app/agent/browser-tool.js";
import { filamentsOwn } from "./core/browser.js";
import { ruleFor, rulesFrom } from "./app/agent/rules.js";
import { Assistant } from "./app/assistant.js";
import { addedFoldersOf, createAgentLoopTurn, exposedWords, folderVerdict, newFolderRefusal, outsideRootsWords, parseAgentModel, plainModelProblem, shareKeptOut } from "./app/agent/turn.js";
import { agentTitle } from "./core/catalogues.js";
import { leadingTeams, teamsOn } from "./core/teams-on.js";
import { forksOf, forkHeldBack, heldBack, leftBehind, ownWorktree, readWorktree, takeBack, worktreesOf } from "./adapters/git/places.js";
import { bringUncommitted } from "./adapters/git/carry.js";
import { taskFolders } from "./adapters/git/changes.js";
import { createSubagentRegistry } from "./app/agent/subagents.js";
import { createRemoteAgents } from "./app/agent/remote-agents.js";
import { createRemoteWork } from "./app/remote-work.js";
import { copiesOf, setCopiesHome, sweepTaskWorktrees, unsavedCopies } from "./adapters/git/worktree.js";
import { routineBranches } from "./adapters/git/footprint.js";
import { createFootprint, deletedChatsWork } from "./app/git-footprint.js";
import { runOfBranch, runSlug } from "./core/routines.js";
import { REVIEWER, createSecondLook } from "./app/second-look.js";
import { createGraphRunner, memoryThreads } from "./app/agent/graph-runner.js";
import { createGraphNotes, graphNoteSources } from "./app/agent/graph-notes.js";
import { createTaskNotes } from "./services/task-notes.js";
import { createGuests } from "./app/agent-guests.js";
import { createAcpTurn } from "./app/acp-turn.js";
import { agentModeOf, agentSessionOf, upstreamsOffProblem, walledProblem } from "./app/engine.js";
import { createModelBook } from "./app/model-book.js";
import { chatEffortOf, chooseModel as chooseModelOf, effortOf as effortOfModel, modelList as modelListOf } from "./core/model-choice.js";
import { wireOwnTurns } from "./app/own-turns.js";
import { createPipeline } from "./app/pipeline/run.js";
import { McpToolServer } from "./http/mcp.js";
import { MemoryMcp } from "./http/memory-mcp.js";
import { CursorSdkBridge } from "./adapters/agents/cursor-sdk.js";
import * as qoder from "./adapters/providers/qoder.js";
import { HealthBoard, ConcurrencyGate } from "./services/health.js";
import { MemoryService } from "./services/memory/index.js";
import { createTeamStore } from "./services/teams.js";
import { createArtifactStore } from "./services/artifacts.js";
import { SPACE_PRUNE_EVERY_MS, createSpaceStore } from "./services/spaces.js";
import { createSpaceFiles } from "./services/space-files.js";
import { createSpaceMachines } from "./services/space-machines.js";
import { NO_PROJECT_ID, normalizeCwd } from "./core/project-id.js";
import { createAgentCardStore, teamClashes } from "./services/agent-cards.js";
import { takesHttpMcp } from "./adapters/agents/acp/profile.js";
import { relayHere } from "./adapters/agents/acp/toolset.js";
import { cardRunsProblem, checkCommandsProblem } from "./app/agent/grants.js";
import { agentTeamsOf, graphCrew, resolveChainSettings, teamMembersOf } from "./services/session-settings.js";
import { sidecar } from "./adapters/sidecar/index.js";
import { createAgentTools } from "./app/agent-tools.js";
import { agentSkillFolders, skillsForAgent } from "./app/agent/skills.js";
import { commandsOf, createBackgroundCommands, runningRecord, tellStoppedCommands } from "./app/agent/commands.js";
import { FOLDER_PARTS, MORE_KEPT_MS, changesOf, createStillOpen, moreOf } from "./app/agent/still-open.js";
import { createAgentTurns } from "./app/agent-inbox.js";
import { createToolTails } from "./app/agent/tool-tail.js";
import { createAdminHandler } from "./http/admin/index.js";
import { agentFileRefusal, agentFolderRefusal } from "./http/admin/remote.js";
import { testUpstream } from "./app/upstream-test.js";
import { createResponsesFrontDoor } from "./http/responses.js";
import { LENT_IN_FLIGHT, createFrontDoor, lanDoor, mainDoor } from "./http/front-door.js";
import { createHookDoor } from "./http/hooks.js";
import { artifactsDoor, artifactsListener, createArtifactsHandler, createPasses, passKeyIn } from "./http/artifacts.js";
import { createFeeds } from "./services/artifact-feeds.js";
import { plan, dryRunWith } from "./app/plan.js";
import { dropForksOf, forkSession } from "./app/fork.js";
import { createSessions } from "./app/sessions/service.js";
import { createMcpServers } from "./app/sessions/mcp-servers.js";
import { createMcpSignIns } from "./app/sessions/mcp-sign-in.js";
import { createConnectorDoor } from "./http/mcp-connector.js";
import { createSignInStore } from "./services/mcp-sign-ins.js";
import { createProviders } from "./app/providers.js";
import { LEFT_OPEN, TURN_RUNS, keepCutTurns } from "./app/sessions/cut-turns.js";
import { FLOW_WAITS, TEAM_WAITS, noteRunningAtStop, resumePlan, resumeCutTurns, stoppedTurns, takeRunningAtStop } from "./app/sessions/resume-cut.js";
import { createModelCache } from "./app/models.js";
import { modelsThatAnswer } from "./app/readiness.js";
import { createFinish, createLeftSpend } from "./app/finish.js";
import { comeBackKept, comeBackOf, disposeBackgroundShells, disposeSpills, endChatShells, envPassFrom, keepComeBack, keepUntold, onComeBackChange, onShellFailed, onShellWake, onShellsChange, onUntoldChange, onUntoldLost, runningShellsOf, shellsAttended, sweepSpills, tellLater, untoldOf, wakeDue, wakes } from "./adapters/tools/hands.js";
import { WAKE_AGAIN_MS, createWaker } from "./app/sessions/wake.js";
import { createIdleWaker } from "./app/sessions/idle-wake.js";
import { OWED_HOLD_MAX_MS, OWED_STAGGER_MS, createOwedKeeper, restoreOwed, staleWords, wakeOwedAtStart } from "./app/sessions/owed-wakes.js";
import { createSpaceSync } from "./app/space-sync.js";
import { createSpaceNews } from "./app/space-news.js";
import { createSpaceLanes, placeFiles } from "./app/space-lanes.js";
import { branchOf, remoteOf, uncommittedIn } from "./adapters/git/inspect.js";
import { folderHung } from "./adapters/git/folder-there.js";
import { repoStandingOf } from "./adapters/git/standing.js";
import { createDashboardRunner, JOBS_KEPT } from "./services/dashboard-runner.js";
import { createPulls } from "./app/space-pulls.js";
import { createAppRuns } from "./services/app-runs.js";
import { createAppSecrets } from "./services/app-secrets.js";
import { createAppSql } from "./services/app-sql.js";
import { createAppHooks } from "./services/app-hooks.js";
import { createRoutines } from "./app/routines.js";
import { createWatchEvents } from "./app/watchers/events.js";
import { createGuidance } from "./app/watchers/guidance.js";
import { createConnectionWatch } from "./app/watchers/connection.js";
import { createCommitWatch, placeAmong } from "./app/watchers/commits.js";
import { createFileWatch } from "./app/watchers/files.js";
import { appSecretsOf, createScriptWatch } from "./app/watchers/script.js";
import { createWebhookWatch } from "./app/watchers/webhook.js";
import { createWatchHooks } from "./services/watch-hooks.js";
import { createWatchHookDoor } from "./http/watch-hooks.js";
import { createOwnTimes } from "./app/watchers/own-times.js";
import { createPacket } from "./app/watchers/packet.js";
import { commitsShown } from "./adapters/git/watch.js";
import { showText } from "./core/task-graph.js";
import { createSpaceAsks } from "./app/space-asks.js";
import { createOwnSpaces } from "./app/own-spaces.js";
import { createEverything } from "./app/everything.js";
import { createPluginSources } from "./app/plugin-sources.js";
import { createPlugins } from "./app/plugins.js";
import { createSkillStore } from "./app/skill-store.js";
import { createSkillLibrary } from "./app/skill-library.js";
import { createCrafterChats } from "./app/crafter-chats.js";
import { createPluginPlaces } from "./app/plugin-places.js";
import { createSkillPlaces } from "./app/skill-places.js";
import { createConnectorCatalogue } from "./app/connector-catalogue.js";
import { createSpaceTools } from "./app/space-tools.js";
import { createFilamentRows } from "./app/filament-rows.js";
import { fetchSource } from "./adapters/tools/source-fetch.js";
import { engineState } from "./adapters/sidecar/install.js";
import { createDrafts } from "./app/space-drafts.js";
import { accountWords, ownAuthorization } from "./core/oauth.js";
import { runActionCommand, runCommand as runSourceCommand } from "./adapters/tools/source-command.js";
import { allowedFolderSoon } from "./http/admin/folder.js";
import { fewAtOnce } from "./core/at-once.js";
import { createTeamsBeside } from "./app/teams-beside.js";
import { createThreads } from "./app/threads.js";
import { createLetters } from "./app/letters.js";
import { createFlowRunner } from "./app/flow-runner.js";
import { createFlowStore } from "./services/flow-store.js";
import { createSavedFlows } from "./services/saved-flows.js";
import { FILAMENT } from "./app/agent/looks.js";
import { createWorktreeCopies } from "./app/sessions/copies.js";
import { captureEnvironment, cachedCapture, cliCommand } from "./app/agent/environment.js";
import { initTokenCalib, disposeTokenCalib } from "./services/token-calib.js";
import { describeDiff } from "./services/config/diff.js";
import { teamsSpendOf, usageOf } from "./services/spend.js";
import { readBody, checkInboundAuth, readsEverySession } from "./http/guards.js";
import { createTelemetry, officialBuild, takeInstallChoice } from "./services/telemetry.js";
import { changeFields } from "./app/config-fields.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const VERSION = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")).version;
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
/** How often the marks' holds past their time are swept after the start's sweep (the owner's of 11-09). */
const MARKS_SWEEP_EVERY_MS = 6 * 3600_000;
/** A folder's path to compare by: resolved, in one case on Windows. @param {string} p */
const pathKey = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
// `autoInstall`: this process installs memory's engine by itself when it is missing (HarnessV3-AtHome AH-D2), armed
// once the server listens. The CLI asks for it; tests never do. `supervisor`: what starts Filament again once it stops
// ("desktop", the Filament app), or null when nothing does: the harness's Restart says so before it acts (HarnessV4_Settings_Plan HC-66).
export function createApp({ dataDir, overrides = {}, onShutdown = () => process.exit(0), autoInstall = false, supervisor = null, telemetry: sendsTelemetry = false } = {}) {
  let draining = false; // set by /api/shutdown and stop(): new model requests are refused while in-flight turns finish
  /** Where Filament listens since it started: a host or port saved since waits for a restart (HC-67). @type {{ host: string, port: number } | null} */
  let listening = null;
  /** The listener's own address once it listens (`server.address()`). @type {import("node:net").AddressInfo | null} */
  let boundAt = null;
  /** The port Filament's calls to itself go to: where it listens, not a port saved since. Before it listens, the config's. */
  const selfPort = () => listening?.port ?? config.get().server.port;
  /** Where Filament reaches itself (`selfAddress`): the address it listens on, once it does; before that, the config's. */
  const selfBase = () => selfAddress(boundAt ?? { host: config.get().server.host, port: selfPort() });
  // The live configuration; the first-run seed (which coding agents this machine has) is the bridge's knowledge, handed in here.
  const config = createConfigStore({ dataDir, overrides, agents: detectedAgentSeed });
  // Token calibration learns from receipts only (the usage every real reply states) — never a provider call. Off in
  // the config stands it down entirely: nothing observed, nothing applied.
  const calibFile = config.get().observability?.tokenCalibration === false ? null : join(dataDir, "token-calib.json");
  // A coding agent's upstream is never calibrated: what it states is its own context's count, not a request's. Its
  // model borrows the factor of the model its turns name, learned on an upstream that is.
  const agentUpstream = (/** @type {string} */ id) => (config.get().upstreams || []).some((/** @type {any} */ u) => String(u.id).toLowerCase() === id.toLowerCase() && isAgentUpstream(u));
  initTokenCalib(calibFile ? { file: calibFile, log: (l, m) => log(l, m), uncalibrated: agentUpstream } : {});
  const usage = new UsageStore({ dataDir, options: config.get().observability });
  // The operation log: everything that is not a model call. Kept beside the request store because the dashboard shows
  // both in one feed, and because a health cooldown or a config change is exactly the context a request row lacks.
  const ops = new OpLog({ dataDir, options: config.get().observability, log: (l, m) => log(l, m) });
  // A held event loop is an operation (BUG-19, F3 item 17): the server can say when it, not the browser, was the wait.
  const stalls = watchLoopStalls({ ops });
  const startedAt = Date.now();
  const events = createEventBus(); // the bus everything is published on
  const sseClients = new Set(); // the open dashboard streams, so shutdown can end them
  const log = (level, ...args) => {
    if (LEVELS[level] <= LEVELS[config.get().server.logLevel || "info"])
      console[level === "debug" ? "log" : level](
        `[Filament] ${new Date().toISOString()} ${level.toUpperCase()}`,
        ...args,
      );
    // Warnings and errors become durable operations. This is the cheapest large win in the whole observability work:
    // 94 log() call sites used to go to stdout and vanish on restart, and now the interesting ones are on the System
    // tab with a timestamp. Messages from the op log itself are skipped, or a failed write would log a failure to
    // write, forever.
    if ((level === "warn" || level === "error") && ops) {
      const msg = String(args[0] ?? "");
      // Redacted, because a warn/error message is not always Filament's own words: the upstream-error paths interpolate
      // the provider's response body, and a gateway that echoes an Authorization value in a 401 would otherwise put it
      // in ops.jsonl, over SSE and on screen. The config path redacts for the same reason.
      if (msg && !msg.startsWith("ops:")) {
        const safe = String(redactSecrets(msg));
        ops.record("log", safe.slice(0, 300), {
          level,
          detail:
            args.length > 1
              ? {
                  extra: String(
                    redactSecrets(
                      args
                        .slice(1)
                        .map((a) => String(a))
                        .join(" "),
                    ),
                  ).slice(0, 160),
                }
              : null,
        });
      }
    }
  };
  // A loop slow short of a stall is said in the server's log: its p99 delay past 100 ms, at most a line a minute.
  const loopHealth = watchLoopHealth({ log });
  // This machine's id and name, as another Filament that adds it knows it (/.well-known/filament, /api/state).
  const machine = createMachine({ dataDir, log });
  // The devices paired with it and the codes that pair them: the admin API, its stream and its sockets know them.
  const devices = createDevices({ dataDir, log });
  // This computer's key to the admin API (services/owner.js), minted as Filament listens: its own programs send it.
  const owner = createOwner({ dataDir, log });
  // Where another machine's agents work in a copy of their project (services/copies.js, the remote plan's cp-root).
  const remoteCopies = createCopies({ dataDir, root: copiesRootOf(), devices, log });
  // The copies of a project another machine sends here for its agents, taken into its mirror in that machine's store.
  const transfers = createTransfers({ copies: remoteCopies, take: importBundle, haves: mirrorHaves, has: mirrorHas, checkout: checkoutCopy, capture: captureCopy, keep: keepCapture, kept: bundleKept, drop: dropKept, log });
  if (process.env.FILAMENT_COPIES_DIR && remoteCopies.root !== resolve(process.env.FILAMENT_COPIES_DIR.trim()))
    log("warn", `[copies] FILAMENT_COPIES_DIR names a drive's root or a home folder, which a Clear would empty: copies are kept in ${remoteCopies.root}`);
  // The machines it is paired with as a device, where its agents send work (services/machines, the remote-agents plan).
  const machines = createMachines({ dataDir });
  // This Filament updated on the person's word from another machine's desktop app (the remote desk's s3d): where it is a
  // server build systemd runs, `filament update --wait` in a unit of systemd's own (cli/update.js).
  const selfUpdate = createSelfUpdate({ dataDir, supervisor });
  // Run on (the remote desk's s2b): a folder of the person's sent to one of those machines for a chat of theirs, and
  // what it changed brought back (app/remote-work.js), over this Filament's agents' device there. Its whole repository
  // goes and comes back, so that is judged as a chat's folder is; and a bring back writes in the repository's turn,
  // beside no sub-agent's Apply.
  const remoteWork = createRemoteWork({
    dataDir,
    remote: createRemoteAgents({ machines }),
    may: (repo) => {
      const v = folderVerdict(config.get(), repo, { person: true });
      return v.ok ? "" : v.why === "outside" ? outsideRootsWords(repo) : `${repo} is no folder a chat may work in here`;
    },
    inRepo: (repo, fn) => subagents.inRepoAhead(repo, fn),
    log,
  });
  // Every call to a provider goes without Node's two hidden 300 s limits (adapters/providers/fetch.js); a Node that
  // keeps its fetch's dispatcher out of reach keeps them, said once here (HarnessV3-FailurePoints §4 A).
  if (!fetchLimitsLifted())
    log("warn", "providers: this Node keeps its fetch's dispatcher out of Filament's reach, so a provider's reply that takes more than 300 s to start, or pauses for more than 300 s, still fails there");
  usage.on("event", (ev) => events.publish("record", ev));
  usage.on("warn", (m) => log("warn", m));
  /** Whether memory has opened and what the last stop left is settled (`openMemory`): set once, as Filament starts. */
  let opened = false;
  /** @type {(wentOver: boolean) => void} */
  let openedNow = () => {};
  /** Memory's open ended: true where it went over every run the last process left open (`openMemory`). @type {Promise<boolean>} */
  const openedAtStart = new Promise((r) => (openedNow = r));
  // The run log: every `run:<id>` topic on the bus, numbered per run and appended to runs/<id>.jsonl (the harness's replay).
  // Its sweep waits for memory's open to settle the runs the last process left open, and keeps those an open has not
  // gone over.
  const runs = createRunLog({ events, dataDir, config: config.get, log, ops, sweepAfter: openedAtStart, settles: ["subagent", ...TURN_RUNS] });
  // A turn's and a run's changes, cut to the rows their cards draw, kept on disk across a restart where their walk was
  // slow (the owner's of 11-18): a turn's go with its chat, a run's past the run log's retention.
  const changesKept = {
    turns: createChangesKept({ dir: dataDir ? join(dataDir, "changes-kept", "turns") : null, log }),
    runs: createChangesKept({ dir: dataDir ? join(dataDir, "changes-kept", "runs") : null, log, maxAgeDays: () => runRetentionDays(config.get()) }),
  };
  void changesKept.turns.sweep();
  void changesKept.runs.sweep();
  // A running agent turn's words, held while it runs (HarnessV3-Launch LD-D16): a page that joins the turn reads them
  // beside its run's events, since the run log keeps a round's words only when the round ends.
  const liveWords = createLiveWords();
  // The integrated terminals (B4): PTY sessions the harness pane attaches to; killed wholesale at shutdown. A test
  // hands in a stand-in for node-pty (`terminalSpawn`): the program and its environment are still assembled here.
  const terminal = createTerminalService({
    log: (m) => log("info", m),
    windowsPty: windowsPtyOf(),
    spawn: (o) => {
      const r = spawnTerminal({ ...o, ...(overrides.terminalSpawn ? { spawn: overrides.terminalSpawn } : {}) });
      if (!r.ok) throw new Error(r.error);
      return r.pty;
    },
  });
  // One stream, two item types (the dashboard's All tab merges them): `{record}`, and `{type:"op"}` for an operation.
  ops.on("op", (op) => events.publish("op", { type: "op", op }));
  ops.on("warn", (m) => log("warn", m));
  // Every save or reload, whether or not the op log is on, with the version it made: the harness re-reads its model
  // catalogue without a page load, and an open dashboard re-reads its draft or says it is stale (HS-D3). A change
  // written in place (a sign-in's tokens) reaches them too: it is told at its save.
  config.onSaved((version) => events.publish("config", { type: "config-changed", version }));
  for (const prob of config.loaded.secretProblems)
    log("warn", `secret could not be read: ${prob}. Re-enter it on the Upstreams or Settings page.`);
  const bridge = new AcpBridge({
    log,
    stateFile: join(dataDir, "acp-sessions.json"),
    profilesFile: join(dataDir, "acp-profiles.json"),
    ...(overrides.agyQuota ? { agyQuota: overrides.agyQuota } : {}),
  });
  // What an agent declared goes with it (HarnessV3-ACP AC0-1): one no longer configured is let go of at start and on
  // every save.
  bridge.profiles.retain(config.get().upstreams || []);
  config.onChange((c) => bridge.profiles.retain(c.upstreams || []));
  // Long-term memory: Filament's own archive plus Mnemosyne as a child process (docs/memory-architecture.md).
  // The saved agents (HarnessV4_Tasks E15): one store, read by the admin routes and by every launch that names a card.
  // A card a team uses stays (step 6): the teams say which.
  /** @type {import("./services/teams.js").TeamStore | null} */
  let teamsOfCards = null;
  /** The plugins installed, made further down: their agents are cards too (HarnessV4_SpacesPlugins_Plan B3). @type {{ agents: () => any[] } | null} */
  let pluginsOfCards = null;
  // An agent and a team never share a name (HarnessV4_OneAgent_Plan OA1): the teams say which names they hold.
  const agentCards = createAgentCardStore({
    dataDir,
    log,
    usedBy: (tag) => teamsOfCards?.holds(tag) ?? null,
    runsProblem: cardRunsProblem,
    teamNamed: (name) => teamsOfCards?.names().find((t) => t.name.toLowerCase() === name.trim().toLowerCase())?.name ?? null,
    teamKeyed: (tag) => teamsOfCards?.names().find((t) => t.key === tag)?.name ?? null,
    memberNamed: (tag) => teamsOfCards?.memberNamed(tag) ?? null,
    plugins: () => pluginsOfCards?.agents() ?? [],
  });
  // The teams (HarnessV3-AtHome P2), each a group of those cards: one store, read by the engine, `/team`, the sessions
  // service and the admin routes. A team's check is judged as a task graph's is.
  const teams = createTeamStore({ dataDir, cards: agentCards, log, checkProblem: (c) => checkCommandsProblem([c]) });
  teamsOfCards = teams;
  // An agents file written by hand is read before the teams: where it meets them, the log says which to rename.
  for (const line of teamClashes(agentCards.list(), teams.list())) log("warn", `agents: ${line}`);
  // The artifacts (HarnessV4_Artifacts_Plan E18): pages agents make, kept in the data folder with their versions —
  // published by the agent's tool on both engines, answered on their own addresses by the front door's fence. Each
  // version kept is said on the events stream (`artifacts`), which every page open on it follows (AF-D37), and so is
  // the developer's rename, pin and delete (AFC-83), and each change to what a page keeps (AFC-97).
  // An app's secrets (the Space Apps plan of 10-29): typed in Filament's own sheet, sealed as connector tokens are,
  // handed to its commands alone — and forgotten with the app.
  const appSecrets = createAppSecrets({ dataDir, encrypt: () => config.get().server?.encryptSecrets !== false, log });
  // Its hooks' addresses (phase 4): a token each, made at its Keep — and forgotten with the app.
  const appHooks = createAppHooks({ dataDir, log });
  // Its own SQLite database (phase 4), run in a process apart at its page's ask — and forgotten with the app.
  const appSql = createAppSql({ dataDir, log: (line) => log("info", line) });
  const artifactStore = createArtifactStore({
    dataDir,
    log,
    onPublished: (a, v) => events.publish("artifacts", { type: "artifact", name: a.name, v: v.v, title: a.title }),
    onChanged: (name, change) => {
      if (change === "deleted") {
        for (const [what, store] of /** @type {const} */ ([["secrets", appSecrets], ["hooks", appHooks]]))
          try {
            store.drop(name);
          } catch (/** @type {any} */ e) {
            log("warn", `app ${what}: ${name}'s could not be forgotten (${e?.message || e})`);
          }
        appSql.drop(name).catch((/** @type {any} */ e) => log("warn", `app database: ${name}'s could not be forgotten (${e?.message || e})`));
        // Its button running stops, and its runs go with it.
        try {
          dashboards.forget(name);
        } catch (/** @type {any} */ e) {
          log("warn", `app runs: ${name}'s could not be forgotten (${e?.message || e})`);
        }
      }
      events.publish("artifacts", { type: "artifact", name, change });
    },
    onData: (name, news) => events.publish("artifacts", { type: "artifact", name, change: "data", collection: news.collection }),
  });
  const memory = new MemoryService({
    sidecar,
    getConfig: config.get,
    dataDir,
    log,
    selfBase,
    windowFor: (name) => windowForModel(name),
    // The records store: the facts fold's lineage walk reads it (Facade D2).
    records: usage,
    // Where a session's repository stands, read by git as its briefing is built (the owner's of 10-29); a folder the
    // fence refuses is not read, as the Worktrees page reads none (GWC-89), nor one whose share does not answer, looked
    // at off the server's thread first. The briefing names the newest commit alone (the memory plan's e1): one of each
    // is read.
    repoState: (/** @type {string} */ folder) =>
      repoStandingOf(folder, {
        commits: 1,
        own: 1,
        refusedOf: async (path) => {
          const f = await allowedFolderSoon(config.get(), path);
          return f.ok || f.status === 404 ? null : f.error;
        },
      }),
    // Whether memory may ask the disk of a folder a request names: a network share the folder rules keep out it may not
    // (`shareKeptOut`), nor one on a drive or share known not to answer now (`folderHung`, asking nothing), whose walk
    // up to its repository would hold the server's thread as long as the share; that folder stands in its own project,
    // as written, unkept, and is walked once its share answers.
    mayAsk: (/** @type {string} */ folder) => !shareKeptOut(config.get(), folder) && !folderHung(folder),
    ...(overrides.importHome ? { home: overrides.importHome } : {}),
  });
  // Filament's own numbers a Dashboard reads (E18 step 7, AF-D12): the records' and the archive's, read-only,
  // answered on the Dashboard's own address and kept in its download.
  const artifactFeeds = createFeeds({ usage, archive: () => memory.archive });
  // The projects' Spaces (proposal_ux §4.14, U5 phase 8): one file per project in the data folder's `spaces`, each
  // change said on the bus's `space` topic, which an open Space follows. The agents' `space` tool finds a chat's by its
  // chain — the project it belongs to, its name, its `loop.tools` switch — read at each call, as the sessions service
  // is built further down. Where the archive cannot say, the chat has no Space.
  const spaceStore = createSpaceStore({
    dir: join(dataDir, "spaces"),
    events,
    log,
    // A project has a Space once the person makes one (the owner's of 10-29): nothing writes one into being.
    madeOnly: true,
    // A deleted Space past its 30 days is removed while Filament runs on, not at its next start alone (10-29).
    pruneEvery: SPACE_PRUNE_EVERY_MS,
    // A refusal to a chat's agent names another chat as that agent may read it (`space.apart`, below).
    apart: (chain) => space.apart(chain),
    // An archived project runs nothing by itself (r-itself, 11-12): the left bar's Archive project, read at each ask.
    archived: (project) => {
      try {
        return !!memory.archive?.projectArchived(project);
      } catch {
        return false;
      }
    },
    // A Space dropped with its project is written again only once its project is (A5).
    exists: (project) => {
      try {
        return !memory.archive || !!memory.archive.getProject(project);
      } catch {
        return true;
      }
    },
  });
  // The files attached to the Spaces' tasks (the owner's of 11-02): what no Space holds any more goes at the start, then
  // as often as the deleted Spaces are pruned.
  const spaceFiles = createSpaceFiles({ dir: join(dataDir, "space-files"), log });
  const sweepSpaceFiles = () => spaceFiles.sweep((project) => spaceStore.filesHeld(project));
  sweepSpaceFiles();
  const spaceFilesSweep = setInterval(sweepSpaceFiles, SPACE_PRUNE_EVERY_MS);
  spaceFilesSweep.unref?.();
  // A project a Space of your own shows gets that Space's connectors and plugins (the owner's word of 10-26): every
  // settings resolution asks the archive, which asks memory, which asks here.
  memory.spaceOf = (id) => {
    try {
      return spaceStore.ownAbove(id);
    } catch {
      return null;
    }
  };
  // Another machine's agents' chat whose device holds no Full control here runs with memory's recall and tools off: every
  // settings resolution asks the archive (archive.js `fenced`), which asks memory, which asks here, as the grant stands.
  memory.fullControlOf = (id) => fullControl(devices, id);
  /** @param {string} chainId */
  const chainRow = (chainId) => {
    try {
      return memory.archive?.getChain(String(chainId)) || null;
    } catch {
      return null;
    }
  };
  /** A chain's head (its project, its kind), without its meta parsed or its settings opened. @param {string} chainId */
  const chainHeadOf = (chainId) => {
    try {
      return memory.archive?.chainHead(String(chainId)) || null;
    } catch {
      return null;
    }
  };
  /**
   * The teams a chat's settings may name to lead it, its task graph's crew and its lead's workers read from them: none
   * while Settings › Experimental's Teams switch is off, but in a team's own chat (core/teams-on.js `leadingTeams`).
   * @param {string} chainId
   */
  const ledBy = (chainId) => leadingTeams(config.get(), chainHeadOf(chainId)?.kind === "team", teams);
  /** @type {import("./app/agent/space.js").SpaceDeps} */
  const space = {
    store: spaceStore,
    projectOf: (chainId) => {
      const p = chainHeadOf(chainId)?.project_id;
      return p && p !== NO_PROJECT_ID ? String(p) : null;
    },
    nameOf: (chainId) => String(chainRow(chainId)?.title || "an untitled chat"),
    // A chat whose words no other chat's agent reads (core/space.js `readerNames`): one whose turns memory keeps to itself
    // (memory's `keptToItself`), or one a turn kept apart named (`meta.namedApart`). The person's pages name it all the same.
    apart: (chainId) => memory.keptToItself(String(chainId)) || !!chainRow(chainId)?.meta?.namedApart,
    on: (chainId) => {
      try {
        return !deps.sessions || deps.sessions.effectiveOf(chainId)?.loop?.tools?.space !== false;
      } catch {
        return true;
      }
    },
    // A routine a chat proposes runs on the model the chat runs on as it proposes it (HarnessV4_Space_Plan S6).
    modelOf: (chainId) => {
      try {
        return String(deps.sessions?.launchInfo?.(chainId)?.full || "");
      } catch {
        return "";
      }
    },
    // A chat's folder: the lane a repro's Fix it… starts in (HarnessV4_Space_Plan S7).
    cwdOf: (chainId) => {
      try {
        return String(deps.sessions?.launchInfo?.(chainId)?.cwd || "");
      } catch {
        return "";
      }
    },
    // The routine a chat is a run of (app/routines.js marks it), or the watcher whose turn is at work in it (`hostOf`):
    // no run starts another (HarnessV4_AgentsSpace_Plan SA-D10), whichever chat it runs in.
    runOf: (chainId) => {
      const m = chainRow(chainId)?.meta?.routine;
      if (m && typeof m === "object") return { title: String(m.title || "a routine") };
      const hosted = routines?.hostOf(String(chainId));
      return hosted ? { title: hosted.title, hosted: true } : null;
    },
    // A project's chats by name, the newest first: whom an agent's ask to tell names (HarnessV4_AgentsSpace_Plan SA-D7),
    // and its refusal lists to that agent's model. A chat whose turns memory keeps to itself is none of them (memory's
    // `keptToItself`): its name is its words, which no other chat's model is given; nor is a chat named by the words of a
    // turn kept apart (`meta.namedApart`).
    chatsOf: (project) => {
      try {
        return (memory.archive?.chainsForProject(project, { limit: 200, kinds: LISTED_KINDS }) || [])
          .filter((c) => !c.meta?.archived && !memory.keptToItself(String(c.id)))
          .map((c) => ({ chain: String(c.id), name: String((!c.meta?.namedApart && (c.title || c.preview)) || "an untitled chat") }));
      } catch {
        return [];
      }
    },
  };
  // A connection's tools for a Space's dashboards (HarnessV4_Space_Plan S4a): the project's MCP servers by name, with
  // their sign-ins — both made further down, so the door is built when a dashboard first asks.
  /** @type {ReturnType<typeof createMcpServers> | null} */
  let mcpServers = null;
  /** @type {import("./app/space-tools.js").SpaceTools | null} */
  let spaceTools = null;
  const spaceToolsNow = () =>
    (spaceTools ||= createSpaceTools({
      serverFor: (project, name) => (mcpServers ? mcpServers.serverFor(project, name) : { ok: false, error: "Filament is still starting" }),
      auth: mcpSignIns.auth,
      log,
    }));
  // A Space's dashboards that read by themselves (HarnessV4_Space_Plan S2): a kept one's commands run in its project's
  // folder as the Keep granted them, read when its page asks; its watches look in the background and write in What
  // happened. The drafts a project's chats publish show in its Space, reading nothing until they are kept.
  /** A project's folder, as the archive keeps it: where its apps' commands run and its folders are read. @param {string} project */
  const projectFolder = (project) => {
    try {
      return memory.archive?.getProject(project)?.cwd || null;
    } catch {
      return null;
    }
  };
  // One project's Space fed by every machine (the remote-agents plan's sp-cross): what each machine kept for the agents
  // writes in its Spaces of the same repository, pulled every minute once memory has opened (`afterListening`).
  const spaceMachines = createSpaceMachines({ spaces: spaceStore, machines, folderOf: projectFolder, remoteOf, log, ...(overrides.spaceMachinesMs ? { everyMs: Math.max(50, Number(overrides.spaceMachinesMs)) } : {}) });
  // Filament's own rows for an app's `filament` source (the Space Apps plan of 10-29, more reads): the board, the
  // project's chats and what each spent, its places.
  const filamentRows = createFilamentRows({
    tasksOf: (project) => (spaceStore.has(project) ? spaceStore.get(project).tasks : []),
    chainsOf: (project) => (memory.archive?.chainsForProject(project, { limit: 200, kinds: LISTED_KINDS }) || []).filter((c) => !c.meta?.archived),
    nameOf: (chain) => space.nameOf(chain),
    // An app's rows are one read every chat's agent reads: a chat whose words are none of theirs is named so in them.
    apart: (chain) => space.apart(chain),
    // The chats at work now: those holding a turn (sessionTurns, made further down; asked once Filament runs).
    working: () => new Set((sessionTurns.holders() || []).map((h) => memory.archive?.chainIdForKey?.(h.key)).filter(Boolean).map(String)),
    spendOf: usageOf,
    folderOf: projectFolder,
    placesOf: async (folder) => {
      const wt = await worktreesOf(folder);
      if (!wt.ok) throw new Error(wt.error || "not in a git repository");
      return Promise.all(wt.worktrees.map((w) => readWorktree(w)));
    },
  });
  const dashboards = createDashboardRunner({
    spaces: spaceStore,
    artifacts: artifactStore,
    folderOf: projectFolder,
    projectOfChain: space.projectOf,
    events,
    log,
    run: runSourceCommand,
    act: runActionCommand,
    // A button's second look (HarnessV4_Space_Plan S3b): the Reviewer, in the chat that made the version shown — as the
    // person asks, on the model they chose (the owner's word of 10-31).
    startLook: (o) => secondLook.start(o),
    // An agent's check of what a button did (S5d): the same Reviewer, after the run, and its end.
    checks: { start: (o) => secondLook.check(o), ended: (chain, agent) => secondLook.ended(chain, agent) },
    // The model the sheet shows first, and why; a check on one that cannot run is refused before the button runs —
    // judged as the model a name names, `agent/` and all, as the launch reads it (found by the review of 10-31).
    lookModel: (chain) => subagents.selfModel(chain, REVIEWER),
    modelProblem: (name) => subagentModelProblem(poolName(name)),
    // A connection's tools (S4a): a source reads one its server marks read-only, a button calls one from its sheet.
    tools: {
      read: (project, tool, signal) => spaceToolsNow().read(project, tool, signal),
      act: (project, tool, args, signal) => spaceToolsNow().act(project, tool, args, signal),
      check: (project, list) => spaceToolsNow().check(project, list),
      schema: (project, tool) => spaceToolsNow().schema(project, tool),
    },
    // Its buttons' runs, kept across a restart (the owner's of 10-29): `<dataDir>/app-runs/<name>/<id>.json`.
    runs: createAppRuns({ dir: join(dataDir, "app-runs"), kept: JOBS_KEPT, log }),
    secrets: appSecrets,
    // More reads (10-29): an address with the app's secrets, Filament's own rows, and Python through the memory
    // engine's uv — else one on PATH. Never Filament's own port: its API lets this computer in.
    fetch: (f, o) => fetchSource(f, { ...o, port: selfPort }),
    filament: (project, what) => filamentRows(project, what),
    // Who pressed or paused, as another chat's agent reads it in a refusal: one `space.apart` says is "an untitled chat".
    apart: (chain) => space.apart(chain),
    uv: () => engineState(dataDir).uv || "uv",
    hooks: appHooks,
    base: selfBase,
  });
  // Pull from… (the Space Apps plan of 10-29, decision 7): a board's issues of Linear, GitHub or Jira, read through the
  // project's connector as an app's tool source is; a card moved back only on the person's word.
  const spacePulls = createPulls({ spaces: spaceStore, tools: () => spaceToolsNow(), events, log });
  // The agents' space tool reads the board as the Space draws it: with the cards its dashboards (S4c) and its pulls put
  // there.
  space.fed = (project) => {
    const fed = dashboards.feeds(project);
    const pulled = spacePulls.cards(project);
    return {
      tasks: [...fed.tasks, ...pulled.tasks.map((c) => ({ title: c.title, task: c.task, key: c.keyWords, line: c.line, column: c.column, stale: c.stale, pulled: true }))],
      counts: [...fed.counts, ...pulled.counts],
    };
  };
  // And reads them, reads one again, pauses one and presses a kept button as the page does (HarnessV4_AgentsSpace_Plan AS3).
  space.dashboards = dashboards;
  /**
   * The account a project's server signs in with, and those signed in at its address (S4b) — null for one that signs
   * in its own way: a server on this computer, or one carrying its own Authorization.
   * @param {string} project @param {string} name
   */
  const accountsOf = (project, name) => {
    const s = mcpServers ? mcpServers.serverFor(project, name) : null;
    if (!s?.ok || typeof s.spec.url !== "string" || ownAuthorization(s.spec.headers)) return null;
    const seen = mcpSignIns.stateOf(s.spec.url, s.spec.headers, s.spec.account);
    return { account: accountWords(s.spec.account), accounts: seen?.accounts?.length ? seen.accounts : [accountWords(s.spec.account)] };
  };
  // A draft an agent writes (HarnessV4_Space_Plan S5c) names a connection the project's chats have, on, and sends as the
  // account the project picks there; its sheet and the person's Send are the drafts' own.
  space.connection = (project, name) => {
    const s = mcpServers ? mcpServers.serverFor(project, name) : { ok: /** @type {const} */ (false), error: "Filament is still starting" };
    return s.ok ? { ok: true, account: accountsOf(project, name)?.account ?? "" } : s;
  };
  const spaceDrafts = createDrafts({
    spaces: spaceStore,
    tools: {
      sendable: (project, tool, account) => spaceToolsNow().sendable(project, tool, account),
      send: (project, tool, args, account, signal) => spaceToolsNow().send(project, tool, args, account, signal),
    },
    accounts: accountsOf,
    chatOf: (chainId) => {
      const row = chainRow(chainId);
      return row ? { name: String(row.title || "an untitled chat") } : null;
    },
    log,
  });
  // A draft being sent is not an agent's to discard (HarnessV4_AgentsSpace_Plan AS2), as on the page.
  space.sending = (project, row) => spaceDrafts.sending(project, row);
  // The teams beside the chats, as the main agent's `team` tool reaches them (team_v2_plan §5.5): a fire as the main
  // agent's, read at each call — the runner is built further down, with the route a turn takes. A harness chat fires
  // them, a forked one too; a team's own chat does not.
  /** @type {import("./app/agent/beside-tool.js").BesideDeps} */
  const beside = {
    fire: (chainId, input) => {
      if (!besides) throw Object.assign(new Error("teams beside a chat need Filament's archive"), { status: 409 });
      // The models it runs on, as the fire card picks them, where the agent names any (the owner's of 10-30).
      return besides.fire(chainId, {
        team: input.team, ask: input.ask, by: "agent",
        model: input.model, provider: input.provider, effort: input.effort,
        workers: input.workersModel, workersProvider: input.workersProvider, workersEffort: input.workersEffort,
        range: input.range,
        // Fired from a turn held to reading (agent/beside-tool.js): its chat reads only.
        ...(input.readOnly === true ? { readOnly: true } : {}),
      });
    },
    // A line for the lead of a team at work, into its running turn as a steer goes (the owner's of 10-30).
    note: async (chainId, input) => {
      if (!besides) throw Object.assign(new Error("teams beside a chat need Filament's archive"), { status: 409 });
      return besides.noteLead(chainId, input.team, input.note);
    },
    list: (chainId) => besides?.list(chainId) || [],
    // Where a team's lead is now, read off its running turn — status asks it of a team at work alone.
    lead: (teamId) => deps.sessions?.leadFacts?.(teamId) || null,
    // Each team with whether the chat lets its main agent fire it by itself (U13-D9) — or the developer's newest message
    // names it (HarnessV4_OneAgent_Plan OA2) — as the runner's fire reads it.
    teams: (chainId) => {
      /** @type {string[]} */
      let may = [];
      try {
        may = besides ? besides.agentMay(chainId) : agentTeamsOf(deps.sessions ? deps.sessions.effectiveOf(chainId) : null, (k) => teams.find(k)?.key ?? null);
      } catch {}
      return teams.list().map((t) => ({ key: t.key, name: t.name, line: t.line, mine: may.includes(t.key) }));
    },
    fires: (chainId) => {
      const kind = chainHeadOf(chainId)?.kind;
      return kind === "interactive" || kind === "fork";
    },
    // Settings › Experimental's Teams switch (core/teams-on.js): off, no chat's agent has the team tool. `fires` stays
    // the chat's kind alone: the flow tool reads it too.
    teamsOn: () => teamsOn(config.get()),
    on: (chainId) => {
      try {
        return !deps.sessions || deps.sessions.effectiveOf(chainId)?.loop?.tools?.team !== false;
      } catch {
        return true;
      }
    },
  };
  // The threads (app/threads.js; the owner's of 11-09 and 11-11), as the main agent's `thread` tool reaches them: a
  // linked chat it starts. The runner is built further down, with the sessions and the route a turn takes, so it is read
  // at each call. A harness chat starts them, a forked one too; a team's own chat does not.
  /** @type {ReturnType<typeof createThreads> | null} */
  let threads = null;
  /** @type {import("./app/agent/thread-tool.js").ThreadDeps} */
  const thread = {
    start: (chainId, input, ctx) => {
      if (!threads) throw Object.assign(new Error("threads need Filament's archive"), { status: 409 });
      return threads.start(chainId, input, ctx);
    },
    starts: (chainId) => {
      const kind = chainHeadOf(chainId)?.kind;
      return kind === "interactive" || kind === "fork";
    },
    asks: (chainId, input) => threads?.asks(chainId, input) ?? null,
    refusal: async (chainId, input) => (threads ? threads.refusal(chainId, input) : null),
    on: (chainId) => {
      try {
        return !deps.sessions || deps.sessions.effectiveOf(chainId)?.loop?.tools?.thread !== false;
      } catch {
        return true;
      }
    },
  };
  // Crafter chats (the owner's word of 10-27): /craft opens a chat of its own whose agent crafts a skill in the open,
  // with the `craft` tool beside its others. The store, the library, the sessions and the loopback turn are built
  // further down, so they are read at each call.
  const crafterChats = createCrafterChats({ store: () => skillStore, library: () => skillLibrary, archive: () => memory.archive, sessions: () => sessions, log });
  // The flows beside the chats, as the main agent's `flow` tool reaches them (HarnessV4_OneAgent_Plan OA3): a draft
  // after the person's /flow, an edit of a draft of its own, a read, the offer of Run as a flow under its reply (OA6) —
  // never a start. The runner and the sessions are built further down, so they are read at each call. A chat that fires
  // teams beside it draws flows; a team's own does not.
  /** @param {string} what */
  const noFlows = (what) => Object.assign(new Error(`${what} needs Filament's archive`), { status: 409 });
  /** @type {import("./app/agent/flow-tool.js").FlowDeps} */
  const flowTool = {
    draft: (chainId, input) => {
      if (!flowRunner) throw noFlows("a flow");
      return flowRunner.draftBy(chainId, input);
    },
    edit: (chainId, input) => {
      if (!flowRunner) throw noFlows("a flow");
      return flowRunner.editBy(chainId, input);
    },
    read: (chainId) => (flowRunner ? flowRunner.read(chainId) : "No flow stands in this chat: flows need Filament's archive."),
    // A flow the person started In place, which the main agent drives (OA4).
    act: (chainId, input) => {
      if (!flowRunner) throw noFlows("a flow");
      return flowRunner.actBy(chainId, input);
    },
    // Run as a flow (OA6, OA-D14): marked on the person's turn that runs, once; the page hears it on the feed and draws
    // the button at the turn's end — the turn's row says it after.
    offer: (chainId) => {
      if (!flowRunner || !deps.sessions) throw noFlows("a flow");
      const id = deps.sessions.offerFlowInTurn(chainId);
      events.publish("turns", { type: "flow-offer", chainId: id });
    },
    fires: (chainId) => beside.fires(chainId),
    on: (chainId) => {
      try {
        return !deps.sessions || deps.sessions.effectiveOf(chainId)?.loop?.tools?.flow !== false;
      } catch {
        return true;
      }
    },
  };
  // Filament's own tools for a coding agent's session (HarnessV3-ACP AC4-2, AC4-5, AC6-3): memory's while its tools are
  // on, the task graph's in the session's own turns, its team's while it leads one, and Filament's agent and wait
  // for a plain chat whose session offers them (HarnessV4_Tasks E12 step 2) — a lead's naming its team's members, its
  // turn found by its session among the
  // turns that hold a door into the sub-agent registry. The graph runner, the sessions service and that registry are
  // built further down, so they are read at each call.
  // What they read of a chat's settings is a knob or two, at every tool round, every poll of its agents and every end
  // of a graph's task: the document in force (`resolveChainSettings`), never the Settings page's whole answer
  // (`settingsOf`). Null where the archive holds no such chat.
  const effectiveOf = (/** @type {string} */ chainId) => (memory.archive ? (resolveChainSettings(memory.archive, config.get(), chainId)?.effective ?? null) : null);
  /**
   * Parallelize tasks for a chat (the owner's of 11-09 and 11-16): the chat's own switch where it has one (its card's
   * Always accept in this chat, `subagents.parallelize`), else Settings › Experimental's for every chat. Read at each call.
   * @param {string | null | undefined} chainId
   */
  const parallelFor = (chainId) => {
    let own = null;
    try {
      own = chainId ? effectiveOf(String(chainId))?.subagents?.parallelize ?? null : null;
    } catch {}
    return own == null ? config.get().experimental?.parallelizeTasks === true : own === true;
  };
  // Parallelize tasks off for the chat: a sub-agent its agent launches that may change files waits on a card for the
  // person's yes (app/agent/held-launch.js, the owner's of 11-14). `overrides.holdWriters` false lets a test's launches
  // start with no card; a test of the card leaves it on.
  const holdsWritersNow = (/** @type {string | null | undefined} */ chainId) => overrides.holdWriters !== false && !parallelFor(chainId);
  /**
   * The device of another machine's agents that started a chat (`meta.agentDevice`, which a chat made from it, or forked
   * from it, keeps too; a sub-agent's is its session's): its id, null for a chat of this machine's person. A meta that
   * cannot be read is read as theirs, of a device none knows (`UNREAD_DEVICE`): what such a chat may not do, it does not
   * (the xf-words2 hunt's). @param {string} chainId @returns {string | null}
   */
  const agentDeviceOf = (chainId) => {
    try {
      const id = memory?.archive?.metaOf(chainId, ["agentDevice"])?.agentDevice;
      return typeof id === "string" ? id : null;
    } catch (/** @type {any} */ e) {
      log("warn", `remote: whether chat ${chainId} was started by another machine's agents could not be read (${e?.message || e}): it is taken as theirs`);
      return UNREAD_DEVICE;
    }
  };
  const agentTurns = createAgentTurns();
  // What a coding agent that takes words only once a step ended hears mid-turn: the tail of Filament's next tool answer
  // to it (checkpoint.js "tool-answer"), owed by its turn (acp-turn.js) and taken by its next call (agent-tools.js).
  const toolTails = createToolTails();
  const agentTools = createAgentTools({
    memory,
    tails: toolTails,
    memoryToolsOn: () => memory.enabled() && config.get().memory?.autopilot?.tools !== false,
    graphs: () => deps.graphs ?? null,
    turns: agentTurns,
    subagents: () => deps.subagents ?? null,
    machines,
    membersOf: (chainId) => (deps.sessions ? teamMembersOf(deps.sessions.effectiveOf(chainId), ledBy(chainId)) : null),
    artifacts: artifactStore,
    port: selfPort,
    maxBytes: () => config.get().server.maxBodyBytes,
    space,
    beside,
    thread,
    flow: flowTool,
    craft: crafterChats.tool,
    // The chats' browsers, made further down (AT-D7), and whether a chat's switch leaves its browser on now.
    browsers: () => deps.browsers ?? null,
    browserOn: (chainId) => {
      const doc = deps.sessions ? deps.sessions.effectiveOf(chainId) : null;
      return doc?.plugins?.browser === true && doc?.loop?.tools?.browser !== false;
    },
    // A coding agent's long commands (HarnessV4_Background_Plan E34): an end goes into the running turn through the
    // registry, made further down, so it is read at each end. One on another machine runs as this Filament's agents'
    // device kept there (the remote-agents plan's c-tools) — never from a chat another machine's agents started.
    commands: createBackgroundCommands({
      registry: () => deps.subagents ?? null,
      log,
      machines,
      agentsChat: (chainId) => agentDeviceOf(chainId) !== null,
    }),
    // A chat's skills for its coding agent (HarnessV4_Skills_Plan S1-1, S1-3): its skills and plugins on, less those
    // the agent loads from its own folders — in the chat's folder and the one it works in (a sub-agent's worktree).
    skills: (chainId, upstreamId, cwd) => {
      let set;
      try {
        set = deps.sessions?.skillsOf(chainId) ?? null;
      } catch {
        return null;
      }
      if (!set) return null;
      const up = findUpstream(config.get(), upstreamId);
      return skillsForAgent(set, [...new Set([...agentSkillFolders(up, set.cwd), ...(cwd ? agentSkillFolders(up, cwd) : [])])]);
    },
    // A line of what is still open the agent dismissed with its envelope (the owner's of 11-09), made further down.
    dismiss: (chainId, ids) => stillOpen.dismiss(chainId, ids),
  });
  bridge.agentTools = agentTools;
  // Seeding a new agent session from the archive instead of from the client's history: a hook rather than an import,
  // so the bridge works with memory off and both stay testable alone. Read-only: it never creates a chain, as the agent path archives no turns of its own.
  // Without the upstream's own budget, the seed takes half the window Filament knows for the agent's model (AC-R1).
  /** @type {(args: any, opts: any) => any} */
  const archivedSeed = (args, opts) => memory.archivedTranscript(args, { ...opts, window: contextWindowForModel(config.get(), args?.model) });
  bridge.archivedTranscript = archivedSeed;
  // Agent lifecycle → the operation log. Injected rather than imported, the same pattern as `memory.onJobEvent`, so the
  // bridges stay independent of the op log and keep working with observability off. `/api/acp/status` is a snapshot:
  // without this, "which agent asked for permission an hour ago and what did Filament decide" has no answer anywhere.
  const agentOp = (which) => (title, opts) =>
    ops.record("agent", title, { ...(opts || {}), detail: { bridge: which, ...(opts?.detail || {}) } });
  bridge.onOp = agentOp("acp");
  wireMemoryOps(memory, ops);
  // Filament's command line as an agent's shell runs it, with its data folder where that is not the one the command finds
  // by itself: the loop's Environment section names it, and a coding agent is told it as it connects.
  const cliLine = cliCommand({ dataDir: !dataDir || pathKey(dataDir) === pathKey(appDataDir({ dev: isCheckout() })) ? null : dataDir });
  const mcp = new McpToolServer({ bridge, log, tools: agentTools, cli: cliLine }); // Filament's toolset for agents: the hands when built-in tools are off, its own tools as each session has them
  // MCP tool calls -> the operation log. McpToolServer is constructed eagerly here, so a direct assignment works.
  mcp.onOp = (title, opts) => ops.record("tool", title, opts);
  // Memory as a service (HarnessV3-Memory M7-6): any agent's MCP client reaches the same brain on /mcp/memory.
  const memoryMcp = new MemoryMcp({ memory, config, log });
  memoryMcp.onOp = (title, opts) => ops.record("tool", title, opts);
  // Cursor through its official SDK: a second agent bridge with the same client-facing behaviour. The SDK itself is
  // optional and loaded on first use; a missing install is explained in words, never a crash.
  const sdkBridge = new CursorSdkBridge({
    log,
    stateFile: join(dataDir, "cursor-sdk-sessions.json"),
    loader: overrides.cursorSdkLoader || null,
    cli: cliLine,
  });
  // Codex over its own app-server (HarnessV3-ACP AC2-1). What Codex says of itself is kept beside what the ACP agents
  // declared, in the one profile store.
  const codexBridge = new CodexBridge({ log, stateFile: join(dataDir, "codex-sessions.json"), profiles: bridge.profiles });
  // The sessions Filament runs in the coding agents, by the agent's own id: a chat one of them holds is a session
  // already, so the Import section passes it over (HarnessV4_Import_Plan IM-4).
  memory.agentSessionIds = () => {
    const ids = new Set();
    for (const b of [bridge, sdkBridge, codexBridge])
      for (const c of b.convs.values()) for (const id of [c?.sessionId, c?.agentId, c?.threadId]) if (typeof id === "string" && id) ids.add(id);
    return ids;
  };
  // Every bridge, not one: the dashboard renders the same `acp` group for all of them, so a hook wired to only some is
  // a knob that silently does nothing for the rest. That has happened twice (`acp.catchUp`, `acp.steering`), and both
  // times the schema-presence test passed because the knob did exist.
  sdkBridge.archivedTranscript = archivedSeed;
  sdkBridge.onOp = agentOp("cursor-sdk");
  codexBridge.archivedTranscript = archivedSeed;
  codexBridge.onOp = agentOp("codex");
  // Filament's own tools reach every agent: Codex over the MCP server too, Cursor's SDK as its custom tools.
  sdkBridge.agentTools = agentTools;
  codexBridge.agentTools = agentTools;
  mcp.contextFor = (token) => bridge.contextForMcpToken(token) || codexBridge.contextForMcpToken(token);
  // The admin routes that look across the agents (their status, a process killed, a conversation forgotten).
  const agentBridges = [bridge, codexBridge, sdkBridge];
  // Each coding agent's account and its plan's windows, as the agents say them (HarnessV3-ACP AC3-6): every bridge
  // hands what it heard to the one store, whose changes reach the open pages as `accounts`. One no longer configured
  // is let go of at start and on every save, as its profile is.
  const accounts = createAgentAccounts({ file: join(dataDir, "agent-accounts.json"), log });
  accounts.retain(config.get().upstreams || []);
  config.onChange((c) => accounts.retain(c.upstreams || []));
  for (const b of agentBridges) b.onAccount = (upstreamId, report) => accounts.report(upstreamId, report);
  accounts.onChange((upstream) => events.publish("accounts", { type: "accounts", upstream }));
  // The one place that reads an upstream's type: everything downstream holds a Destination (core/ports.js) instead.
  const destinationFor = (u) => {
    if (!u) return null;
    if (u.type === "cursor-sdk") return cursorDestination(sdkBridge, u);
    if (u.type === "codex") return codexDestination(codexBridge, u);
    if (u.type === "acp") return acpDestination(bridge, u);
    if (u.type === "filament") return filamentDestination(u, { machines, inFlight: LENT_IN_FLIGHT });
    return u.type === "qoder" ? qoder.qoderDestination(u, { log }) : httpDestination(u);
  };
  const discover = (u, opts) => destinationFor(u).listModels(opts);
  const health = new HealthBoard({
    cooldownBaseMs: (config.get().rules.resilience?.cooldownBaseSeconds || 10) * 1000,
    cooldownMaxMs: (config.get().rules.resilience?.cooldownMaxSeconds || 300) * 1000,
  });
  // Every configuration change reaches its readers through the store, in this order: memory first (its reload reads the new config), then the stores' knobs, then the health board's cooldowns.
  config.onChange(() => {
    try {
      memory.reload();
    } catch (e) {
      log("warn", `memory: reload failed: ${e.message}`);
    }
  });
  config.onChange((c) => {
    usage.configure(c.observability);
    ops.configure(c.observability);
    health.configure({
      cooldownBaseMs: (c.rules.resilience?.cooldownBaseSeconds || 10) * 1000,
      cooldownMaxMs: (c.rules.resilience?.cooldownMaxSeconds || 300) * 1000,
    });
  });
  const concurrency = new ConcurrencyGate();
  wireHealthOps(health, ops);
  // A provider held as one that cannot serve this account (HarnessV3-TaskGraph-v2 TG2-D54) is let go by a fix: a change
  // of its upstream in Settings — its key, address or type, or switching it on — and, for a coding agent, its own word:
  // its plan's windows saying none is spent lift an out, and its saying it is signed in as another login than the one it
  // was held as — or signed in at all, where it was held signed out — lifts an account. Its saying the same login again
  // is no fix, and nor is its first word where it had said none: its adapter says whom it runs as in the background,
  // as its first turns run, often after the first has failed.
  /** What a fix of an upstream changes. @param {any} u */
  const servesShapeOf = (u) => JSON.stringify([u?.type || "", String(u?.baseUrl || "").replace(/\/+$/, ""), u?.apiKey || "", u?.enabled !== false, u?.acp?.home || ""]);
  let servesShapes = new Map((config.get().upstreams || []).map((/** @type {any} */ u) => [u.id, servesShapeOf(u)]));
  config.onChange((c) => {
    const next = new Map((c.upstreams || []).map((/** @type {any} */ u) => [u.id, servesShapeOf(u)]));
    for (const [id, shape] of next) {
      if (shape === servesShapes.get(id) || !health.wallOf(id)) continue;
      health.liftWall(id);
      log("info", `health: ${id} changed in Settings — it is no longer held as one that cannot serve`);
    }
    servesShapes = next;
  });
  // What was found of another machine's models offline (adapters/providers/filament.js) is of the upstream as it stood:
  // removed, renamed, naming another machine or moved to another prefix, it is said offline no more.
  /** @param {any} c @param {any} u */
  const machineShapeOf = (c, u) => JSON.stringify([u.machine || "", prefixRouteOf(c, u.id)?.match || ""]);
  /** @param {any} c */
  const machineShapesOf = (c) => new Map((c.upstreams || []).filter(isMachineUpstream).map((/** @type {any} */ u) => [u.id, machineShapeOf(c, u)]));
  let machineShapes = machineShapesOf(config.get());
  config.onChange((c) => {
    const next = machineShapesOf(c);
    for (const [id, shape] of machineShapes) if (next.get(id) !== shape) forgetOffline(id);
    machineShapes = next;
  });
  accounts.onChange((upstream) => {
    const v = accounts.view(upstream);
    const w = health.wallOf(upstream);
    if (!v || !w) return;
    const lifts = w.kind === "out" ? v.windows.length > 0 && !v.spent : !!w.as && !!v.identity && !v.signedOut && !sameIdentity(w.as, v.identity);
    if (!lifts) return;
    health.liftWall(upstream, w.kind);
    log("info", `health: ${upstream} said ${w.kind === "out" ? "its plan's windows have room again" : w.as?.kind === "none" ? "it is signed in" : "it is signed in as another login"} — it is no longer held as one that cannot serve`);
  });

  const qoderLogins = new Map(); // nonce -> pending device login
  const liveAborts = new Map(); // request id -> the AbortController that can stop an in-flight request (the dashboard's stop button)
  // Alerts: thresholds that come to find you (failover, a degraded memory engine, a daily budget), shown as a banner
  // on every dashboard page and on the tray card. Deduplicated by key; dismissable.
  const alerts = { list: [], seen: new Set() };
  const pushAlert = (kind, text, key) => {
    const k = key || `${kind}:${Date.now()}`;
    if (alerts.seen.has(k)) return;
    alerts.seen.add(k);
    ops.record("alert", text, {
      sub: kind,
      level: kind === "budget" || kind === "cache" ? "warn" : "info",
      detail: { alertKey: k },
    });
    if (alerts.seen.size > 600) alerts.seen = new Set([...alerts.seen].slice(-300));
    alerts.list.push({ id: k, at: new Date().toISOString(), kind, text: String(text).slice(0, 300) });
    if (alerts.list.length > 100) alerts.list.shift();
    log("warn", `alert [${kind}]: ${text}`);
  };
  // The cache-churn watch: a client that resends a changing history re-caches nearly the whole conversation on every
  // request, and only the provider's columns show it (2026-09-27: 99 requests, 17.3M tokens re-written, $128). The
  // store's finish runs the watch before the record persists, so the verdict lands on the crossing request; the
  // alert carries it to the dashboard banner.
  const churnWatch = createCacheChurnWatch({ onAlert: pushAlert });
  usage.setOnFinishRecord(churnWatch.note);

  const { cfgForModels, persistModelCache, windowForModel, discoveryOf, adopt: adoptModels, askAgent, listed, ownNames, keyedFor, labelsFor, noteAgentWindow, noteOutputCeiling, close: closeModelCache } = createModelCache({
    dataDir,
    config,
    log,
    destinationFor,
    // A save's discovery answered: open pages re-read the list (the dashboard's Upstreams card, the harness picker).
    onDiscovered: (msg) => {
      events.publish("config", { type: "models-discovered", ...msg });
      modelBook.stale();
    },
  });
  // More than one account per coding agent (HarnessV3-ACP AC3-7): accounts added, renamed and removed, and signed in
  // and out in each agent's own way, in a terminal or on the agent's page; the open pages hear each change as
  // `accounts`. Where an agent doesn't say who it runs as itself — Codex and Cursor's SDK always do, an ACP agent as its
  // last start declared — its sign-in is read from its CLI or its files (a test hands in a stand-in, `signInOf`), from
  // the start on, and learnt from its turns and from the sessions its bridge opens for its models (`onSignIn`, below):
  // the picker offers it only while someone is signed in (the owner's of 10-30).
  const saysWho = (u) => (u.type === "acp" ? (bridge.profiles.all()[u.id]?.account ?? null) : true);
  const logins = createAgentLogins({
    config,
    destinationFor,
    terminal,
    accounts,
    dataDir,
    adoptModels,
    askModels: askAgent,
    publish: (upstream) => events.publish("accounts", { type: "accounts", upstream }),
    log,
    signInOf: overrides.signInOf || upstreamLogin,
    saysWho,
  });
  for (const b of agentBridges) b.onSignIn = (upstreamId, signedIn, said) => logins.turnSaid(upstreamId, signedIn, said);
  logins.refresh();
  // Settings → Coding agents (HarnessV3-ACP AC3-8): the agents Filament knows and ACP's registry's — read by the server,
  // kept with their icons under `<data dir>/agents` — installed in a terminal the person sees, connected, turned off,
  // updated and removed; the open pages hear each change as `coding-agents`, on the accounts' topic. Antigravity's
  // version and program come from Google's own release feed, read beside the registry (agy-feed.js). A test hands in a
  // stand-in for the registry's CDN, Google's feed and the makers' downloads (`registryFetch`).
  const agentsDir = join(dataDir, "agents");
  const registry = withAgyFeed(
    createRegistry({ dir: agentsDir, fetch: overrides.registryFetch || globalThis.fetch, log }),
    createAgyFeed({ dir: agentsDir, fetch: overrides.registryFetch || globalThis.fetch, log }),
  );
  const installs = createInstalls({ dir: join(agentsDir, "installed"), fetch: overrides.registryFetch || globalThis.fetch, log });
  const codingAgents = createCodingAgents({
    config,
    destinationFor,
    terminal,
    registry,
    installs,
    models: { askAgent, listed, discoveryOf },
    logins,
    profileOf: (id) => bridge.profiles.all()[id] || null,
    publish: (id) => events.publish("accounts", { type: "coding-agents", id }),
    log,
  });
  // The catalogue as the harness reads it, from the caches (a read never asks a provider): Get started's facts and the
  // count `start()` resolves for `--open` come from it (HarnessV3-Launch LD-D1, LD-D2).
  const catalogueNow = async () => (await aggregateModels(await cfgForModels(false), { discover })).models || [];
  // The models a sub-agent's launch reads (HarnessV4_Tasks E23): the picker's, folded once per change — a save, or a
  // provider's or an agent's list answering — never per launch.
  const modelBook = createModelBook({ config, rows: catalogueNow, labelsFor, log });
  config.onChange(() => modelBook.stale());
  // Memory opens once Filament listens (`openMemory`, below).
  // Each request a session books moves its Spend on an open page at once (`spend`: the ledger as the settings document
  // says it), so a running turn's cost follows its model calls, not only its end. The ledger comes as it was written,
  // and the turn count from the chain's head: the chain is not read whole for it at every model call.
  // A team's chat books beside its main chat (team_v2_plan §5.3): the main chat's Spend counts it, so it is said again.
  /** @param {string} chainId @param {any} spend */
  const spendSaid = (chainId, spend) => {
    const a = memory.archive;
    events.publish("spend", { type: "spend", chainId, usage: usageOf({ meta: { spend }, turns: a?.chainHead(chainId)?.turns }, teamsSpendOf(a, chainId)) });
    try {
      const main = a?.mainOf?.(String(chainId));
      if (main) events.publish("spend", { type: "spend", chainId: main, usage: usageOf({ meta: { spend: a.metaOf(main, ["spend"])?.spend }, turns: a.chainHead(main)?.turns }, teamsSpendOf(a, main)) });
    } catch (e) {
      log("warn", `spend: the main chat of ${String(chainId).slice(0, 12)} was not told its team's spend (${String(/** @type {any} */ (e)?.message || e).slice(0, 120)})`);
    }
  };
  const finish = createFinish({ config, usage, health, liveAborts, pushAlert, log, memory, spent: spendSaid });
  // What a harness chat's coding agent spent between turns, which no turn showed, left as the chat is let go of past
  // its keep limit: booked on the chat's spend, under its last turn.
  bridge.onSpentLeft = createLeftSpend({ config, usage, memory, log, spent: spendSaid });
  // The models an account's API key offers beyond Claude Code's own list are kept with its model list: a bridge started
  // afresh starts a turn on one in a process of its own before it has listed anything (acp/bridge.js `#keyedOf`).
  bridge.keyedOf = keyedFor;
  // And so is the list Claude Code gave itself: a bridge started afresh reads from it whether a name typed on the card
  // is one Claude Code lists, which runs where every listed model does (acp/bridge.js `#customModel`).
  bridge.listedOf = ownNames;

  // The assistant talks to a model through Filament's own front door, so routing, rules and translation apply.
  const assistant = new Assistant({
    getConfig: config.get,
    describeDiff,
    dataDir,
    log,
    usage,
    memory,
    alertsList: () => alerts.list,
    unreadable: () => config.unreadable(),
    dryRun: (input, draft) => dryRunWith(config.get, wireApiFor, input, draft || config.get()),
    listModels: async () => aggregateModels(await cfgForModels(false), { discover }),
    testUpstream: async (id) => {
      const u = findUpstream(config.get(), id);
      return u
        ? testUpstream(u, config, destinationFor)
        : { ok: false, error: `upstream "${id}" not found in the saved config` };
    },
    // No clock (HarnessV3-FailurePoints §4 A): the console's chat hanging up ends the call.
    callModel: async (body, { signal = null } = {}) => {
      const r = await loopbackPost(`${selfBase()}/v1/messages`, {
        headers: {
          "content-type": "application/json",
          ...houseAuth(),
          "user-agent": "filament-assistant/0.1",
          "x-session-id": `assistant-${body.model}`,
        },
        body: JSON.stringify({ ...body, stream: false }),
        signal,
      });
      const j = await r.json().catch(() => ({ type: "error", error: { message: `HTTP ${r.status}` } }));
      if (!r.ok && j.type !== "error")
        return { type: "error", error: { message: j.error?.message || `HTTP ${r.status}` } };
      return j;
    },
  });

  // Upstreams (wireApi = auto) whose Responses endpoint served a request their Chat Completions endpoint refused:
  // remembered until that upstream's address, type or wire API changes (BUG-02 — a corrected URL must get its Chat
  // Completions tried again), or a restart.
  const wireApiDetected = new Map();
  // Models that refused memory's tools (HarnessV3-AtHome AH-D1), by upstream and the model name it was sent: a request
  // that carries no tools of its own is offered none of memory's on them. Forgotten the same way.
  /** @type {Map<string, { status: number, at: string }>} */
  const toolsRefused = new Map();
  /** What a remembered detection depends on. @param {any} u */
  const wireShapeOf = (u) => JSON.stringify([u?.type || "", String(u?.baseUrl || "").replace(/\/+$/, ""), u?.wireApi || "auto"]);
  let wireShapes = new Map((config.get().upstreams || []).map((/** @type {any} */ u) => [u.id, wireShapeOf(u)]));
  config.onChange((c) => {
    const next = new Map((c.upstreams || []).map((/** @type {any} */ u) => [u.id, wireShapeOf(u)]));
    for (const id of [...wireApiDetected.keys()]) {
      if (next.get(id) === wireShapes.get(id)) continue;
      wireApiDetected.delete(id);
      log("info", `wire API: ${id}'s address, type or wire API changed — its Chat Completions endpoint will be tried again`);
    }
    for (const key of [...toolsRefused.keys()]) {
      const id = key.split("\0")[0];
      if (next.get(id) === wireShapes.get(id)) continue;
      toolsRefused.delete(key);
      log("info", `memory: ${id}'s address, type or wire API changed — ${key.split("\0")[1]} is offered memory's tools again`);
    }
    wireShapes = next;
  });
  const wireApiFor = (u) => {
    const s = u?.wireApi || "auto";
    return s === "responses" || (s === "auto" && wireApiDetected.get(u?.id) === "responses")
      ? "responses"
      : "chat-completions";
  };

  // One turn at a time in a harness chat (HarnessV3 Step 3 D12): the lock the sessions service takes around a harness
  // turn and a chat's move around the move. In memory only — it guards live traffic, not stored state.
  const sessionTurns = new SessionTurns({ log, labelOf: holderLabel });
  /**
   * The Space's syncs (proposal_ux §4.14), built below with the route a turn takes; a lane that waits for its chat's
   * turn to end goes as the turn lock lets go of it.
   * @type {import("./app/space-sync.js").SpaceSyncRunner | null}
   */
  let spaceSync = null;
  /**
   * What happened in a project's Space, filling itself (HarnessV4_Space_Plan SG-D4): built below; a chat's turn that
   * ends has its project's places read and Filament's own lines written.
   * @type {import("./app/space-news.js").SpaceNews | null}
   */
  let spaceNews = null;
  /**
   * The teams beside a chat (team_v2_plan §5.3), built below with the route a turn takes: a team chat's turn that ends
   * may bring its result, and a result that waits for its main chat goes as that chat's turn lets go.
   * @type {import("./app/teams-beside.js").TeamsBeside | null}
   */
  let besides = null;
  /**
   * The flows beside a chat (HarnessV4_Flow_Plan F3; HarnessV4_OneAgent_Plan OA3), built below with the route a turn
   * takes: the main agent's flow tool and the sessions service's /flow reach it.
   * @type {import("./app/flow-runner.js").FlowRunner | null}
   */
  let flowRunner = null;
  /**
   * The Spaces' routines (HarnessV4_Space_Plan S6), built below with the route a turn takes: a routine's run is a chat of
   * its own, whose end its turn letting go says.
   * @type {import("./app/routines.js").Routines | null}
   */
  let routines = null;
  /**
   * What Filament's own events wake (the plan of 11-11, its w2), built below with the routines: a chat's turn that ends,
   * its graph kept, a question waiting, a command failed, a sub-agent's end — each to the watchers that pick it.
   * @type {import("./app/watchers/events.js").WatchEvents | null}
   */
  let watchEvents = null;
  /**
   * The watchers that ask a connection's tool (the plan of 11-11, its w4), built below with the routines, whose every
   * arm they follow. @type {import("./app/watchers/connection.js").ConnectionWatch | null}
   */
  let connectionWatch = null;
  /** The watchers of a branch's commits (its w3), built and following the routines as those of a connection do. @type {import("./app/watchers/commits.js").CommitWatch | null} */
  let commitWatch = null;
  /** The watchers of a folder's files (v2-a), built and following the routines as those of a branch do. @type {import("./app/watchers/files.js").FileWatch | null} */
  let fileWatch = null;
  /** The watchers fed by a program of their project (v2-c), built and following the routines as those of a connection do. @type {import("./app/watchers/script.js").ScriptWatch | null} */
  let scriptWatch = null;
  /** The watchers a program posts to (its v2-b), built and following the routines as those of a connection do. @type {import("./app/watchers/webhook.js").WebhookWatch | null} */
  let webhookWatch = null;
  /**
   * What a watcher writes to the chat it watches (its w6), built below with the routines: into that chat's running
   * turn, as a turn of Filament's own, or kept until it lets go. @type {import("./app/watchers/guidance.js").Guiding | null}
   */
  let guidance = null;
  /**
   * An app's asks run here (the owner's of 11-04), built below: an ask's run is a chat whose end its turn letting go says.
   * @type {import("./app/space-asks.js").SpaceAsks | null}
   */
  let spaceAsks = null;
  /**
   * The chat each turn holding the lock is of, by its key, kept while it holds (the review of 11-09): the lock knows a
   * turn by the chat's key alone, and a chat deleted mid-turn has no row left to read its id from (`chatsAtWork`).
   * @type {Map<string, string>}
   */
  const turnChats = new Map();
  /** A turn took a chat: the start's hold on it goes (`heldAtStart`). Set once the hold stands, below; none is before. */
  let turnTook = (/** @type {string} */ _chainId) => {};
  sessionTurns.onHolder = (key, holder) => {
    const chainId = memory.archive?.chainIdForKey?.(key);
    const of = chainId || turnChats.get(key);
    if (holder && chainId) turnChats.set(key, chainId);
    if (holder && chainId) turnTook(chainId);
    else if (!holder) {
      turnChats.delete(key);
      // A deleted chat's fork its own turn kept goes as that turn ends.
      if (of) void dropForks([of], { busy: true });
    }
    // A chat deleted mid-turn has no row to name it: a routine's run in it ends all the same, as its chat is gone,
    // and the watchers held back on it look again.
    if (!chainId && !holder && of) routines?.released(of);
    if (!chainId && !holder && of) guidance?.released(of);
    if (!chainId) return;
    if (!holder) spaceSync?.released(chainId);
    if (!holder) spaceNews?.ended(chainId);
    if (!holder) besides?.released(chainId);
    if (!holder) routines?.released(chainId);
    // A guidance turn in it is over, and a watcher's guidance that waited for it goes.
    if (!holder) guidance?.released(chainId);
    if (!holder) spaceAsks?.released(chainId);
    // A thread's first reply its starter asked for (`notify`) goes as its brief's turn lets go.
    if (!holder) threads?.released(chainId);
    // The `turns` topic (Facade D11): every holder change, whatever session it is, with the chat's id — the events feed
    // carries it beside records and ops, for the sidebar and the chat a page shows. The lock's key is the chain KEY; a
    // session with no chain yet has no id to name, so its holder changes go unsaid.
    events.publish("turns", { type: "turn", chainId, holder });
  };
  // A client's chat ends a turn (memory's word: no lock holds a client's chat): its project's What happened reads it,
  // and the `turns` topic says it as a lock letting go says it, with no holder — the sidebar reads its list again, and a
  // chat the page keeps but does not show is marked unseen. The turn's number, and whether its end failed, go to What
  // happened: the end of a request that failed, then of the retry that went on with its turn, is one turn there. The page
  // reads the chat again at each. A chat a lock holds meanwhile (a move) has its end said as that lock lets go of it.
  memory.onClientTurnEnded = (/** @type {string} */ chainId, /** @type {number | null} */ turn, /** @type {boolean} */ failed) => {
    const key = chainHeadOf(chainId)?.key;
    if (key && sessionTurns.holder(key)) return;
    spaceNews?.ended(chainId, turn, failed);
    // Its watchers hear it, as a harness chat's turn (the plan of 11-11): no rounds of Filament's, so no files.
    watchEvents?.turnEnded(chainId, { turn, failed });
    events.publish("turns", { type: "turn", chainId, holder: null });
  };
  // Chats named by the side model (Settings › Experimental, the owner's of 11-05): a turn's reply archived, for every
  // client and engine, its chat named once where Filament named it from its first message; the name on the `turns`
  // topic, for the sidebar and the header.
  const chatNamer = createChatNamer({ config: config.get, memory: () => memory, publish: (msg) => events.publish("turns", msg), log });
  memory.onMessageSent = (/** @type {{ chainId: string }} */ t) => chatNamer.messageSent(t);
  memory.onTurnFinished = (/** @type {{ chainId: string }} */ t) => chatNamer.turnFinished(t);
  // A coding agent's own turns (HarnessV3-ACP AC3-9): a cycle Claude begins by itself on a harness chat's session is
  // asked for as a turn of that chat, through Filament's own door.
  // A question a turn of the chat paused on that ends with no answer's turn is said on the sessions' feed (`question-over`).
  wireOwnTurns(bridge, {
    base: selfBase,
    log,
    sessionTurns,
    chainKeyOf: (id) => memory.archive?.chainHead(id)?.key || null,
    questionOver: (chainId, fn) => events.subscribe("compactions", (e) => void (e?.type === "question-over" && e.chainId === chainId && fn())),
  });
  // Claude's tasks while they run (HarnessV3-FailurePoints §5.1 item 2): they ride the events feed at most once each
  // TASKS_FEED_MS, the newest list always (`tasksOnFeed`) — `turns`, with the chat's id, as its commands do: the harness
  // page hears them there, whoever holds the chat, on the one stream it holds (HarnessV3-Responsiveness R3) — and the
  // newest list is kept for the transcript, which a page that opens the chat later reads.
  /** @type {Map<string, import("./adapters/agents/acp/bridge.js").AgentTask[]>} */
  const agentTasks = new Map();
  /** The session each chat's list is of: only that session reaches its tasks by their ids. @type {Map<string, string>} */
  const agentTaskSessions = new Map();
  /** The upstream whose session runs each chat's list, where its bridge says. @type {Map<string, string>} */
  const agentTaskUpstreams = new Map();
  /** How often, at most, a chat's task list reaches the events feed: a running task's progress moves it at every step. */
  const TASKS_FEED_MS = 500;
  /**
   * Each chat whose list went out in the last TASKS_FEED_MS: the newest list said since, which goes at that window's end.
   * @type {Map<string, { next: any }>}
   */
  const tasksHeld = new Map();
  /**
   * A chat's task list onto the events feed, as a sub-agent's progress goes (subagents.js `progressed`): at once where
   * none went out in the last TASKS_FEED_MS, else at that window's end, as the list stands then — a busy agent's tasks
   * say one list each TASKS_FEED_MS, and the newest always goes.
   * @param {string} chain @param {any} msg
   */
  const tasksOnFeed = (chain, msg) => {
    const open = tasksHeld.get(chain);
    if (open) return void (open.next = msg);
    events.publish("turns", msg);
    /** @type {{ next: any }} */
    const held = { next: null };
    tasksHeld.set(chain, held);
    const end = () => {
      if (!held.next) return void tasksHeld.delete(chain);
      events.publish("turns", held.next);
      held.next = null;
      setTimeout(end, TASKS_FEED_MS).unref?.();
    };
    setTimeout(end, TASKS_FEED_MS).unref?.();
  };
  bridge.onTasks = ({ chain, sessionId, upstream = null, tasks }) => {
    // A session's empty list ends its own: the list of another session of the chat — one on another account, the one a
    // fresh start opened — stands (the review of cb2d2d1f0: the session before's last word cleared the live tasks of
    // the one after it).
    const runs = agentTaskSessions.get(chain);
    if (!tasks.length && runs && runs !== sessionId) return;
    if (tasks.length) agentTasks.set(chain, tasks);
    else agentTasks.delete(chain);
    if (tasks.length) agentTaskSessions.set(chain, sessionId);
    else agentTaskSessions.delete(chain);
    if (tasks.length && upstream) agentTaskUpstreams.set(chain, upstream);
    else agentTaskUpstreams.delete(chain);
    tasksOnFeed(chain, { type: "agent-tasks", chainId: chain, sessionId, tasks });
  };
  // Which harness tab writes each session (HarnessV3-FixRound decision 22): every change rides the events feed, where
  // each page hears whether it writes the session it shows or follows it.
  const sessionWriters = new SessionWriters({ log });
  sessionWriters.onChange = (chainId, tab, where) => events.publish("writers", { type: "writer", chainId, tab, where });
  // A settings change rides the events feed (`settings`), which every page holds (HarnessV3-Responsiveness R3). It
  // says the document's new hash, so a page that holds it already (the one that wrote it) does not read it again
  // (BUG-10 P9).
  // Each page of claim changes rides the events feed too (`claims`, HarnessV3-Memory M7-D36): a page reads again only
  // what changed, on the stream it holds already.
  memory.onClaims = (msg) => events.publish("claims", msg);
  // Where memory's engine stands rides the feed too (`engine`, AH-D2): the console's line and the harness's memory
  // widget follow an install as it goes. An install nobody pressed for that fails is an alert.
  memory.onEngine = (now) => events.publish("engine", { type: "engine", engine: now });
  memory.onAlert = pushAlert;
  /** The person brought a chat back from the archive: the start's hold on it goes (`heldAtStart`). Set once the hold stands, below; none is before. */
  let unarchived = (/** @type {string} */ _chainId) => {};
  memory.onSessionEvent = (chainId, payload) => {
    if (payload?.type !== "settings") return;
    events.publish("settings", { type: "settings", chainId, hash: resolveChainSettings(memory.archive, config.get(), chainId)?.hash || null });
    if (payload.unarchived) unarchived(chainId);
  };
  // Sub-agents (HarnessV3 §15 item 86): one registry for the process — agent turns launch from it, the harness and
  // /subagent launch into it, and a sub-agent's own request is served against it. It reads the sessions it serves
  // through a context bound below, once the sessions service exists.
  const subagents = createSubagentRegistry({ config: config.get, log, events, runs, liveWords, selfBase, machines, cli: cliLine, sendsFile: join(dataDir, "remote-sends.json"), dataDir });
  // Its memory's census each minute to the desktop app, which keeps it in its memory log (services/memory-log.js); none
  // where Filament runs under no app.
  const stopCensus = postCensus(/** @type {any} */ (process).parentPort, () => censusOf({ runs, subagents }));
  // The copies its helpers and checks take name this data folder on their records: Filament's footprint in a repository
  // tells its own copies from another Filament's by it (the footprint plan).
  setCopiesHome(dataDir);
  // Filament's footprint in a repository (the footprint plan): one for the process — Space › places' line and its Clean
  // up read it (http/admin/git.js), and what is still open in a chat says its copies' disk as its reads measured it.
  const footprint = createFootprint({
    home: String(dataDir || ""),
    subagents,
    archive: () => memory.archive ?? null,
    backups: () => memory.backups?.heldSince?.() ?? null,
    routines: () => (spaceStore.routinesAll?.() || []).map(({ project, r }) => ({ title: r.title, folder: projectFolder(project) })),
    log,
  });
  /** The projects' folders; none where the archive could not be read, said. @returns {string[]} */
  const projectFolders = () => {
    try {
      return (memory.archive?.projects() || []).map((/** @type {{ cwd: string }} */ p) => String(p.cwd || "")).filter(Boolean);
    } catch (/** @type {any} */ e) {
      log("warn", `git: the projects' folders could not be read (${e?.message || e})`);
      return [];
    }
  };
  /**
   * The folders of the projects being deleted now. A project's delete takes its row before its chats' delete is heard
   * (memory's `deleteProject`, then `onSessionsDeleted`), so its folder is noted first: the repository its chats' forks
   * and helpers' copies are in, which no project names once its row is gone (the owner's of 11-09, its review).
   * @type {Set<string>}
   */
  const goingFolders = new Set();
  const deleteProject = memory.deleteProject.bind(memory);
  memory.deleteProject = async (/** @type {string} */ projectId) => {
    let cwd = "";
    try {
      cwd = String(memory.archive?.getProject?.(projectId)?.cwd || "");
    } catch {}
    if (cwd) goingFolders.add(cwd);
    try {
      return await deleteProject(projectId);
    } finally {
      goingFolders.delete(cwd);
    }
  };
  /**
   * Every folder Filament knows a chat of — the projects', those of the projects being deleted, and the folders its
   * sub-agents work from —: where its copies are swept as it starts, and where a deleted chat's helpers' copies and
   * refs, and its forks, are looked for (the owner's of 11-09).
   * @returns {string[]}
   */
  const knownFolders = () => [...new Set([...projectFolders(), ...goingFolders, ...subagents.folders()])];
  /**
   * The chats at work now: a turn holding the lock — a deleted one's too, which its row no longer names (`turnChats`) —,
   * a sub-agent working, a coding agent's own agents.
   */
  const chatsAtWork = () =>
    new Set([
      ...(sessionTurns.holders() || []).map((h) => memory.archive?.chainIdForKey?.(h.key) || turnChats.get(h.key)).filter(Boolean).map(String),
      ...(subagents.atWork?.() || []),
      ...[...agentTasks].filter(([, tasks]) => tasks.some((t) => AGENT_WORK.has(t.kind))).map(([chain]) => String(chain)),
    ]);
  /**
   * The deleted chats whose forks stayed only because the chat was still at work as it was deleted: each tried again as
   * that work ends — its turn letting go, a sub-agent of its ending (the review of 11-09). @type {Set<string>}
   */
  const forksBusy = new Set();
  /** The forks' removals, one after another: two never move one fork at once. */
  let forksDropping = Promise.resolve();
  /**
   * The forks' worktrees of deleted chats go (fork.js `dropForksOf`), what they held kept on a ref first — never one
   * whose folder a chat at work, a project or another chat uses; one its own chat's work alone keeps is noted
   * (`forksBusy`). `busy`: only those of the chats noted so, asked once the removals under way end — a turn ending as
   * its fork's delete is still read is heard. Failures logged.
   * @param {string[]} ids @param {{ busy?: boolean }} [o]
   */
  const dropForks = (ids, { busy = false } = {}) =>
    (forksDropping = forksDropping
      .then(async () => {
        const now = busy ? ids.filter((id) => forksBusy.has(id)) : ids;
        if (!now.length) return;
        const r = await dropForksOf(now, { folders: knownFolders(), log, chatsIn: (paths) => memory.chatsIn(paths), projects: projectFolders, atWork: chatsAtWork });
        for (const id of now) forksBusy.delete(id);
        for (const s of r.stayed) if (s.busy) forksBusy.add(s.chain);
      })
      .catch((/** @type {any} */ e) => log("warn", `forks: the forks of deleted chats could not be let go (${e?.message || e})`)));
  events.subscribe("subagents", (/** @type {any} */ e) => {
    if (e?.type === "subagent" && e.status !== "running" && e.chainId) void dropForks([String(e.chainId)], { busy: true });
  });
  // A chat deleted — with the teams beside it, or with its project — takes what the registry keeps for it (SUB-6), the
  // changes its turns kept on disk, and what the coding agents' bridge keeps for it: its sessions, and what they spent
  // between turns that no turn showed.
  // Its background commands stop, and its come-back goes: nothing is left running for a chat that is gone — nor its idle
  // wake's check-in, armed (the bug hunt of 11-08). What its helpers kept in the repositories goes (the registry's
  // `forgetChat`), and so do its forks' worktrees, what they held kept on a ref first — never one whose folder a chat at
  // work, a project or another chat uses (the owner's of 11-09); one that stays is tried again as Filament starts, and as
  // its chat's work ends where only that kept it.
  memory.onSessionsDeleted = (/** @type {string[]} */ ids) => {
    for (const id of ids) {
      void changesKept.turns.purge(id);
      void subagents.forgetChat(id);
      bridge.chatGone(id);
      idleWake.cancel(id);
      void endChatShells(id).then((n) => n && log("info", `background commands: ${n} of deleted chat ${id} stopped`));
      browsers.forget(id);
    }
    void dropForks(ids);
    // And the texts its lists kept, which nothing reads again (sessions/service.js `forgetKeptTexts`).
    for (const id of ids) sessions.forgetKeptTexts(id);
  };
  // What is still open in each chat (the owner's plan of 11-02, Phase 4): its commands running, its coding agent's own
  // background tasks, its sub-agents working, asking, waiting or failed — said after a summary, after the agent's own
  // compaction, and at a turn's start where it changed since its agent heard it, which the chat's meta keeps.
  // The coding agent's own tasks in a session other than the one told (`theirs`): the agent the chat moved off, or one
  // of its sessions before a fresh one — named whose they are, which the one told can neither read nor stop.
  // And what waits on the main agent besides (the owner's of 11-09): its graph tasks' and team workers' changes, and
  // what its folder holds — a change's drift, failed captures, a deleted chat's work, Filament's copies and what is left
  // over, as Space › places shows them —, each repository read once for all its chats every five minutes at most
  // (`holdsOf`): reading each worktree's status is the dearest of it, and what is left over moves slowly.
  /** @type {Map<string, { at: number, p: Promise<import("./app/agent/still-open.js").FolderHolds | null> }>} */
  const holdsRead = new Map();
  const HOLDS_KEPT_MS = 5 * MORE_KEPT_MS;
  /** What a read that failed whole says of a repository: nothing, every part of it unread. */
  const unreadHolds = () => ({ unread: [...FOLDER_PARTS] });
  /**
   * A worktree's read that could not tell whether it is left over — it threw, or git would not read the folder, say
   * what is uncommitted in it, or compare its branch —: not one whose folder is gone, or that the folder fence refuses,
   * which are read and no leftover. @param {Awaited<ReturnType<typeof readWorktree>> | null} p
   */
  const untold = (p) => !p || (!p.missing && !p.refused && (!p.ok || (!!p.head && !p.uncommitted) || (!!p.mergedInto && p.merged == null)));
  /**
   * What a repository holds, each part git would not read named (`unread`): a part that failed lists nothing, which is
   * no word that nothing is there — Still open lets go of no dismissal for it (the re-read of 11-11). A folder in no
   * repository holds nothing (null).
   * @param {string} folder @returns {Promise<import("./app/agent/still-open.js").FolderHolds | null>}
   */
  const readHolds = async (folder) => {
    const wt = await worktreesOf(folder);
    if (!wt.ok) return gitAbove(folder) ? unreadHolds() : null;
    const [unsaved, deleted, copies, forks] = await Promise.all([
      unsavedCopies(folder).catch(() => null),
      deletedChatsWork(folder, { archive: () => memory.archive || null }).catch(() => null),
      copiesOf(folder).catch(() => null),
      forksOf(folder).catch(() => null),
    ]);
    const forked = forks?.ok ? forks.forks : [];
    const forkAt = new Set(forked.map((f) => normalizeCwd(f.path)));
    const into = wt.worktrees.find((w) => w.main)?.branch || null;
    const others = wt.worktrees.filter((w) => !w.main && !forkAt.has(normalizeCwd(w.path)));
    // Each read as Space › places reads it: one the folder fence refuses is not read, and so never said (GWC-89).
    const reads = await fewAtOnce(others, async (w) => {
      const f = await allowedFolderSoon(config.get(), w.path);
      return readWorktree(w, { refused: f.ok || f.status === 404 ? null : f.error, into }).catch(() => null);
    });
    const slugs = new Map((spaceStore.routinesAll?.() || []).map((/** @type {{ r: { title: string } }} */ { r }) => [runSlug(r.title), r.title]));
    const routine = slugs.size ? await routineBranches(folder, (b) => runOfBranch(b, slugs)).catch(() => null) : null;
    // Their disk as the footprint's reads last measured it — Space › places opened —: none said before one did.
    const sized = copies?.ok ? footprint.measured(copies.copies) : null;
    return {
      unsaved: unsaved?.ok ? unsaved.copies : [],
      deleted: deleted?.ok ? deleted.work.map((d) => ({ id: d.id, chainId: d.chainId, deletedAt: d.deletedAt, head: d.head, at: d.at })) : [],
      copies: copies?.ok ? [{ repo: copies.repo, count: copies.copies.length, bytes: sized?.bytes ?? null, ...(sized?.partial ? { partial: true } : {}) }] : [],
      // Whether a chat works in one now is read as the list is (`working` below): these are kept for minutes.
      worktrees: others.flatMap((w, i) => {
        const p = reads[i];
        return p && heldBack(p, [], { branch: true }) === null ? [{ path: w.path, branch: w.branch, into: p.mergedInto, head: String(w.head || ""), age: p.age.commit }] : [];
      }),
      branches: routine?.ok ? routine.branches.filter((b) => !b.worktree && b.base && b.ahead === 0).map((b) => ({ name: b.name, into: String(b.base), head: b.commit, age: null })) : [],
      forks: forked.filter((f) => !f.missing && !chainRow(f.chain)).map((f) => ({ chain: f.chain, path: f.path, head: f.head, why: forkHeldBack(f) })),
      unread: /** @type {import("./app/agent/still-open.js").FolderPart[]} */ ([
        ...(unsaved?.ok ? [] : ["uncaptured"]),
        ...(deleted?.ok ? [] : ["deleted"]),
        ...(copies?.ok ? [] : ["copies"]),
        ...(reads.some(untold) ? ["worktrees"] : []),
        ...(slugs.size && !routine?.ok ? ["branches"] : []),
        ...(forks?.ok ? [] : ["forks"]),
      ]),
    };
  };
  /** @param {string} folder */
  const holdsOf = (folder) => {
    const key = normalizeCwd(folder);
    const had = holdsRead.get(key);
    if (had && Date.now() - had.at < HOLDS_KEPT_MS) return had.p;
    const p = readHolds(folder).catch(unreadHolds);
    holdsRead.delete(key);
    holdsRead.set(key, { at: Date.now(), p });
    if (holdsRead.size > 50) holdsRead.delete(/** @type {string} */ (holdsRead.keys().next().value));
    return p;
  };
  const stillOpen = createStillOpen({
    registry: subagents,
    archive: () => memory.archive || null,
    changes: (chainId) => changesOf(subagents.list(chainId), memory.archive?.metaOf(chainId, ["graph"])?.graph || null),
    more: async (chainId) => {
      const folder = space.cwdOf(chainId);
      if (!folder) return null;
      const subs = subagents.list(chainId);
      return moreOf({
        chain: chainId,
        folder,
        subs,
        failed: subagents.failedCaptures(),
        holds: await holdsOf(folder),
        project: !!space.projectOf(chainId),
        count: async (base) => {
          const r = await git(["rev-list", "--count", `${base}..HEAD`], { cwd: folder });
          return r.code === 0 && /^\d+$/.test(r.out.trim()) ? Number(r.out.trim()) : null;
        },
        // The worktrees a chat works in now (GW-D39), as Space › places reads them: a turn running, a sub-agent working,
        // a coding agent's own agents.
        working: (paths) => {
          const at = new Set([
            ...(sessionTurns.holders() || []).map((h) => memory.archive?.chainIdForKey?.(h.key)).filter(Boolean).map(String),
            ...(subagents.atWork?.() || []),
            ...[...agentTasks].filter(([, tasks]) => tasks.some((t) => AGENT_WORK.has(t.kind))).map(([chain]) => String(chain)),
          ]);
          const chats = memory.chatsIn([...paths]);
          return new Set(paths.filter((p) => (chats.get(p) || []).some((c) => at.has(c.id))));
        },
      });
    },
    tasks: (chainId, agentSession) => (agentTaskSessions.get(chainId) === agentSession ? agentTasks.get(chainId) || [] : []),
    theirs: (chainId, agentSession) => {
      const runs = agentTaskSessions.get(chainId);
      const tasks = (agentTasks.get(chainId) || []).filter((t) => t.background !== false);
      if (!runs || runs === agentSession || !tasks.length) return null;
      const up = agentTaskUpstreams.get(chainId);
      const found = up ? findUpstream(config.get(), up) : null;
      return { who: found ? agentTitle(found) : "the coding agent", tasks };
    },
    // A test's clock, which moves a turn past a long wait (still-open.js `waited`) without waiting it out.
    ...(typeof overrides.stillOpenNow === "function" ? { now: /** @type {() => number} */ (overrides.stillOpenNow) } : {}),
  });
  // A second look (HarnessV4_Space_Plan S3b, SG-D12): the Reviewer, read-only, on a move that asks — a review rule's call,
  // a dashboard's button —, as an agent of a chat that is there.
  const secondLook = createSecondLook({ registry: () => subagents, events, chatOf: (id) => (chainRow(id) ? { title: String(chainRow(id)?.title || "") } : null), log });
  // A sub-agent runs on the loop, or as the coding agent its name reaches first (HarnessV3-ACP AC6-1): a name with no
  // route, or one that reaches an agent only through a fallback, runs neither, and nor does one whose upstreams are all
  // switched off (AG-259: its first call would end with nothing sent, where a pool has another row to give). The
  // launch asks this, a pool of each of its rows, and the Agents page of a card's own model.
  // Nor does one whose provider said it cannot serve this account, while that holds (HarnessV3-TaskGraph-v2 TG2-D54): a
  // coding agent's too.
  /** @param {string} name @returns {string | null} */
  const subagentModelProblem = (name) => {
    const cfg = config.get();
    const walled = () => walledProblem(cfg, name, (id) => health.wallOf(id));
    return agentSessionOf(cfg, name) ? walled() : plainModelProblem(cfg, name, destinationFor)?.why || upstreamsOffProblem(cfg, name) || walled();
  };
  // What a row of a session's pool needs of its model (HarnessV4_Tasks E15 step 8): why it cannot run an agent, how
  // many agents its provider takes at once — what a 429 taught, never the requests a minute its headers state (the
  // review of 11-05; a call's own wait reads those, dispatch/attempt.js) — and its price per million tokens for the
  // pool's editor. `at`: the source its name lands on and the name it receives there, whose slots across Filament it
  // takes (core/slots.js, team_v2_plan TV2-D8), and `seen` the ceiling its provider showed there, which lowers them for
  // a while.
  /** @param {string} name */
  const subagentModelFacts = (name) => {
    const place = placeOfName(config.get(), name);
    // What its provider showed lowers it for a while; a price card's maxConcurrency says nothing (the owner's 10-19).
    const seen = place?.up ? health.learnedCeiling(place.up.id, place.sent) : null;
    const limit = seen || null;
    const card = place ? priceCard(place.sent, place.up?.pricing) : null;
    return {
      problem: subagentModelProblem(name),
      limit,
      price: card ? { input: card.input, output: card.output } : null,
      at: place?.up ? { upstream: String(place.up.id), model: String(place.sent), name: String(place.up.name || place.up.id) } : null,
      seen: seen
        ? {
            cap: seen.cap,
            from: seen.from,
            ...("liftsAt" in seen && seen.liftsAt ? { liftsAt: seen.liftsAt } : {}),
            ...("times" in seen && Number(seen.times) >= 2 ? { takes: seen.takes, times: seen.times, since: seen.since, probing: !!seen.probing } : {}),
          }
        : null,
    };
  };
  /**
   * What a choice of a sub-agent's model reads (core/model-choice.js `Book`): the picker's models, the launch's own
   * check, each coding agent's account as Filament last heard of it, and where each coding agent stands — read only
   * where a refusal's words need it.
   * @param {import("./app/model-book.js").ModelBook | null} b
   * @returns {import("./core/model-choice.js").Book}
   */
  const choiceBook = (b) => ({
    cfg: config.get(),
    families: b?.families || [],
    reading: !b,
    problem: subagentModelProblem,
    account: (id) => {
      const v = accounts.view(id);
      return v ? { signedOut: !!v.signedOut, spent: !!v.spent, freeAt: v.freeAt ?? null } : null;
    },
    agents: () => codingAgents.list().entries.map((e) => ({ id: e.id, name: e.name, state: e.state })),
  });
  // Sign-ins to remote MCP servers (HarnessV4_Settings_Plan HS-7): kept by the server's address in mcp-sign-ins.json,
  // sealed as the configuration's secrets are; every engine's servers take their tokens from here.
  const mcpSignIns = createMcpSignIns({ store: createSignInStore({ dataDir, encrypt: () => config.get().server?.encryptSecrets !== false, log }), selfBase, log });
  // A coding agent reaches a chat's signed-in connector at Filament's door, which adds the token as it forwards (the
  // owner's of 11-07): the agent holds none, and a renewal changes nothing it was given. Its key is this run's.
  const connectors = createConnectorDoor({ auth: mcpSignIns.connectorAuth, log });
  // What the application layer (src/app) is handed: the services and adapters built above and the closures over them
  // that more than one use case needs. The shape is app/deps.js's AppDeps; every use case takes it as its first
  // argument instead of reaching into this scope.
  // The agent's browser (HarnessV4_Browser_Plan BR1): the desktop app holds its pages and connects for them
  // (`/api/browser/host`), and while no app is connected Chrome on this machine does, headless (b-headless);
  // each chat's tabs, the sites allowed and the developer's take-over are kept here. Filament's own address is opened
  // by no one: its API trusts this machine (the bug hunt of 10-30, DESK-1).
  // Filament is reached at every port it listens on — its own, and its doors' (the network's, the artifacts' beside it,
  // the tailnet's two), each handing its paths to the front door — on this machine's names and addresses, and where
  // Tailscale serves it: all of it read as a page asks, so a door turned on or moved is Filament's from then on. This
  // machine's addresses take milliseconds to read, so they are read again at most every `ADDRESSES_MS`.
  const ADDRESSES_MS = 2000;
  let addresses = { at: -Infinity, list: /** @type {string[]} */ ([]) };
  const machineAddresses = () => {
    if (Date.now() - addresses.at > ADDRESSES_MS)
      addresses = { at: Date.now(), list: Object.values(networkInterfaces()).flatMap((l) => (l || []).map((n) => n.address)) };
    return addresses.list;
  };
  /** @returns {{ ports: number[], names: string[], origins: string[] }} */
  const ownPlaces = () => {
    const s = config.get().server;
    const t = tailnet.state();
    return {
      ports: [selfPort(), lan.port(), artLan.port(), t.listening?.port, t.listening?.artPort].filter((p) => Number.isInteger(p) && Number(p) > 0).map(Number),
      names: [s.host, ...(Array.isArray(s.allowedHosts) ? s.allowedHosts : []), ...lanNames(), ...machineAddresses()].filter((n) => typeof n === "string" && !!n),
      origins: [t.address, t.artifacts].filter((o) => typeof o === "string" && URL.canParse(o)).map((o) => new URL(String(o)).origin),
    };
  };
  /** @param {string} url */
  const browserOwn = (url) => {
    const o = ownPlaces();
    return filamentsOwn(url, o.ports, o.names, o.origins);
  };
  // A coding agent Filament launched asks its door to add nothing where the agent's own settings send its model calls
  // back to Filament (core/conversation.js `addsNothing`), and knows the door by the same places: Settings › Connect
  // writes the address its page was opened at, which may be this machine's on the network or the tailnet.
  bridge.ownPlaces = ownPlaces;
  codexBridge.ownPlaces = ownPlaces;
  const browserHost = createBrowserHost({
    log,
    places: ownPlaces,
    chrome: createHeadlessHost({ dataDir, own: browserOwn, log, find: overrides.findChrome || (() => findChrome()), ...(overrides.chromeSpawn ? { spawn: overrides.chromeSpawn } : {}) }),
  });
  // A page that comes with no agent's call at work — a popup — is judged by its chat's rules, as a call would judge it.
  const browsers = createBrowsers({
    host: browserHost,
    log,
    own: browserOwn,
    looks: (chain, page) => {
      try {
        return ruleFor(rulesFrom(deps.sessions?.effectiveOf(chain) ?? null), BROWSER, { action: "snapshot", page })?.verdict !== "deny";
      } catch {
        return true;
      }
    },
    // A chat's agents' use of its browser, for the line over its box (the owner's of 11-02): on the events feed.
    moved: (chain, use) => events.publish("browser", { type: "browser", chainId: chain, ...use }),
    // A chat whose turn runs, or whose sub-agents do, keeps its tabs however long one stood unused. Asked first by the
    // minute's look, long after `chatBusy` below is made.
    working: (chain) => chatBusy(chain) || subagents.atWork().includes(String(chain)),
  });
  // Where plugins come from (HarnessV4_SpacesPlugins_Plan B1): Claude Code's and Codex's, read where they stand when the
  // Plugins page asks; the marketplaces the person adds, cloned into the data folder.
  const pluginSources = createPluginSources({ dataDir, codexHome: process.env.CODEX_HOME || "", log });
  // The plugins installed (B2): each copied at its commit into the data folder, its values per place, its updates; what
  // those on at a chat's place bring joins its settings as each request reads them (B3), its servers with the switch,
  // account and load the place picked for them in its Connectors.
  const plugins = createPlugins({ dataDir, sources: pluginSources, log, mcpLayers: (where) => mcpServers?.layersAt(where) ?? [], spaceOf: (id) => memory.spaceOf(id) });
  pluginsOfCards = plugins;
  // Your skills (HarnessV4_Skills_Plan S1-6): found on this computer, added from a folder or a git address, made here,
  // and Filament's own; those on at a chat's place join its settings after the plugins'.
  const skillStore = createSkillStore({ dataDir, shippedDir: join(__dirname, "skills"), log });
  // A made skill's books (HarnessV4_Skills_Plan step 2): split into parts, a table of contents, a full-text index.
  const skillLibrary = createSkillLibrary({ log });
  const deps = {
    config: config.get,
    selfPort,
    selfBase,
    plugins,
    skills: skillStore,
    mcpSignIns,
    connectors,
    browsers,
    subagents,
    machines,
    devices,
    // Where another machine's agents' chat without Full control may work, judged at each of its turns as their chat was
    // as it started (http/admin/remote.js `agentFolderRefusal`; the fc-review's).
    agentsFolder: (/** @type {string} */ cwd, /** @type {string | null | undefined} */ device) =>
      agentFolderRefusal(cwd, { dataDir, roots: config.get().agentLoop?.roots || [], folders: memory.chatFolders({ person: true }), doing: "work", ...remoteCopies.fenceOf(device || "") }),
    // The copy placed for a chat of the person's, bound to it as their machine's app started it there (http/admin/
    // sessions.js): its turns work in it whatever agentLoop.roots lists.
    ownCopy: (/** @type {string} */ chat) => {
      if (!chat) return "";
      const id = memory.archive?.metaOf?.(chat, ["copy"])?.copy;
      const c = typeof id === "string" ? remoteCopies.get(id) : null;
      return c?.owned && c.chat === chat ? c.folder : "";
    },
    secondLook,
    // Parallelize tasks for a chat: its own switch, else Settings › Experimental's (`parallelFor`).
    parallelFor,
    log,
    usage,
    ops,
    events,
    runs,
    liveWords,
    memory,
    teams,
    artifacts: artifactStore,
    space,
    beside,
    thread,
    flow: flowTool,
    craft: crafterChats.tool,
    agentTurns,
    toolTails,
    agentTasks: (chainId) => agentTasks.get(chainId) || [],
    stillOpen,
    health,
    concurrency,
    checkInboundAuth: (req) => checkInboundAuth(req, config.get().server),
    readsEverySession: (req) => readsEverySession(req, config.get().server),
    readBody: (req) => readBody(req, config.get().server.maxBodyBytes),
    destination: destinationFor,
    finish,
    liveAborts,
    plan: (a) => plan(config.get, wireApiFor, a),
    dryRun: (input, draft) => dryRunWith(config.get, wireApiFor, input, draft || config.get()),
    wireApiFor,
    wireApiDetected,
    toolsRefused,
    modelsConfig: cfgForModels,
    noteAgentWindow,
    noteOutputCeiling,
    // A coding agent's account as its store reads it now, for what its failure says of it (TG2-D54).
    agentAccount: (id) => accounts.view(id),
    agentProfile: (id) => bridge.profiles.all()[id] || null,
    agentSignIn: (id, served, said) => logins.turnSaid(id, served, said),
    ownCallFolder: () => {
      const dir = join(dataDir, "agent-calls");
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    agentHeartbeatMs: Math.max(1000, Number(overrides.heartbeatMs) || 15000),
    // The loop's Environment section (HarnessV3-SystemPrompt SP-D7): this machine, read behind a short per-folder cache,
    // with Filament's own address as the config states it, an IPv6 host in brackets, and its command line with its data
    // folder where that is not the one the command finds by itself — or the fixed one a test hands in.
    environment:
      typeof overrides.environment === "function"
        ? overrides.environment
        : cachedCapture((root) =>
            captureEnvironment(root, {
              listen: hostAndPort(listening?.host ?? config.get().server.host, selfPort()),
              cli: cliLine,
            }),
          ),
  };
  // Agent upstreams: the "model" is a local coding agent; its reply is relayed in the client's wire format.
  const agentTurn = createAcpTurn(deps);
  // The agent loop: one model with Filament's hands behind `agent/<model>` — ticks, budgets, pause-and-resume.
  const agentLoop = createAgentLoopTurn(deps);

  // The model-request pipeline (src/app/pipeline): parse → situate → chat commands → the session's engine → route →
  // budgets → composed → memory → handed → agent loop → view → the context stamp (observation only) → dispatch; each
  // stage answers the request or hands it on.
  const pipeline = createPipeline(deps, { agentTurn, agentLoop });
  // Native sessions (HarnessV2 §3): the archive chain is the session; a turn is composed from it and enters the
  // same pipeline as any /v1/messages request, addressed to its chain.
  // Each MCP server's last test in Settings › MCP servers, by its spec: the settings list shows it and the New Task
  // board dots the servers a chat will start (HarnessV4_Settings_Plan HC-26).
  const mcpTests = new Map();
  // The copies of the projects' worktree templates (HarnessV4_Four_Plan E19): a chat's turn waits for the one into its
  // worktree, and each copy's start and end ride the feed with its chat's row.
  const copies = createWorktreeCopies({ memory, log, publish: (chainId, e) => events.publish("copies", { ...e, chainId }) });
  /** Whether a turn that wakes a chat's agent is on its way: set once the waker stands, below; none is before. */
  let wakeComing = (/** @type {string} */ _chainId) => false;
  /** A chat's turn that ended, told to the waker that tries a failed wake again: set once it stands, below. */
  let wakeEnded = (/** @type {string} */ _chainId, /** @type {boolean} */ _kept) => {};
  /** A driving goal's next round sent to a chat: set once the waker stands, below; none is before. */
  let goalRound = (/** @type {string} */ _chainId) => {};
  /** A chat's wakes and goal round asked again once the room made for it is no message's: set once the wakers stand. */
  let roomMade = (/** @type {string} */ _chainId) => {};
  // Letters between chats (the owner's of 11-04): a chat's agent writes another chat with its envelope tool, and the
  // registry delivers it sealed — into that chat's running turn, or woken for it.
  const letters = createLetters({ archive: () => memory?.archive ?? null, registry: () => subagents, guides: (from, to) => !!guidance?.mayWrite(from, to), log });
  // The idle wake (sessions/idle-wake.js, the owner's of 11-08: "so that you are not stuck forever"): a chat's agent that
  // ended its turn while a background command of its own runs — a shell its main agent started or the person sent to the
  // background, or its coding agent's own background shell — is told after `sessions.idleWakeMinutes` that the command
  // runs on, as a command's end is told: kept untold, and the waker sends the chat its turn. Never where a turn holds the
  // chat, a question waits, the person stopped or archived it (`sessions.idleHeld`), or something else that wakes it is
  // due or on its way. Each change rides the `turns` topic for the chat's status and Now.
  /**
   * Whether a chat's coding agent's own background tasks are those of the agent the chat runs on now (the owner's of
   * 11-08): a chat moved off that agent — to the loop, or another — is not woken for them, as though they were its new
   * agent's. True where the bridge named no upstream.
   * @param {string} chainId
   */
  const tasksOfChatAgent = (chainId) => {
    const up = agentTaskUpstreams.get(chainId);
    if (!up) return true;
    // The chat's model as its turns read it: its settings', else the one its chain was opened on (another client's).
    const name = String(sessions.effectiveOf(chainId)?.model?.name || memory.archive?.getChain(String(chainId))?.model || "").trim();
    const inner = parseAgentModel(name)?.model || name;
    return !!inner && agentSessionOf(config.get(), inner) === up;
  };
  // What each chat is owed a wake for, kept with it so a restart loses none of it (sessions/owed-wakes.js, the nudge map
  // of 11-10: "Nothing wakes a chat after a restart"): what waits untold for its agents, its come-back and its idle
  // check-in, as each changes. Filament's own stop ends the keeping first: what that stop clears stays kept.
  const owedKeeper = createOwedKeeper({ archive: () => memory?.archive ?? null, log });
  // `failed`: the start's own keep of a chat (`restoreOwed`), with the parts it could not give back, which the keeper
  // leaves as they were kept; a change's keep names none.
  const keepOwed = (/** @type {string} */ chainId, /** @type {import("./app/sessions/owed-wakes.js").OwedPart[] | undefined} */ failed = undefined) =>
    owedKeeper.keep(chainId, { untold: untoldOf(chainId), comeBack: comeBackKept(chainId), idle: idleWake.kept(chainId) }, failed);
  const idleWake = createIdleWaker({
    minutes: () => config.get().sessions?.idleWakeMinutes,
    running: (chainId) => [
      ...runningShellsOf(chainId)
        .filter((s) => s.agent === null)
        .map((s) => ({ id: s.id, command: s.command, startedAt: s.startedAt })),
      ...(tasksOfChatAgent(chainId) ? agentTasks.get(chainId) || [] : []).filter((t) => t.background && t.kind === "local_bash").map((t) => ({ id: t.id, command: t.description || "a background shell", startedAt: t.since })),
    ],
    // A check-in armed again after a restart, whose commands that restart ended, waits on nothing else: the restart's word
    // of them waits untold beside it (agent/commands.js `tellStoppedCommands`), and anything else owed goes in its wake.
    // One held only by another wake owed that is not on its way is "owed": a few such and it is told all the same.
    blocked: (chainId, { restored = false } = {}) => {
      if (sessions.idleHeld(chainId)) return true;
      if (restored) return false;
      if (wakeComing(chainId)) return true;
      return wakeDue(chainId) || subagents.reportsDue(chainId) || subagents.lettersDue(chainId) || sessions.goalOwed(chainId) ? "owed" : false;
    },
    tell: (chainId, { id, text, kind = "idle" }) => tellLater({ session: chainId, agent: null }, { id, command: "", code: null, kind, text }),
    changed: (chainId, wake) => {
      events.publish("turns", { type: "idle-wake", chainId, idleWake: wake });
      keepOwed(chainId);
    },
    log,
    // A live test's minute (test/idle-wake-live.test.js): a real one everywhere else.
    minuteMs: Math.max(50, Number(overrides.idleWakeMinuteMs) || 60_000),
  });
  // A chat's watchers, for the line over its box (the plan of 11-11, its w8): its transcript carries the list, and each
  // change of a Space that moves a chat's list says it again, whole, on the `turns` topic, which every page hears. The
  // turns of a chat its watchers reviewed go the same road, for the chip under each (`reviews`).
  const chatWatching = createChatWatchers({
    spaces: spaceStore,
    nameOf: (chainId) => space.nameOf(chainId),
    publish: (chainId, watchers) => events.publish("turns", { type: "watchers", chainId, watchers }),
    publishReviews: (chainId, reviews) => events.publish("turns", { type: "reviews", chainId, reviews }),
    log,
  });
  const stopSayingWatchers = events.subscribe("space", () => chatWatching.moved());
  const sessions = createSessions({
    memory,
    config,
    pipeline,
    ops,
    log,
    forkSession: (chainId, args) => forkSession({ memory }, chainId, args),
    sessionTurns,
    subagents,
    // The teams a developer's message names past its start start beside it (the owner's list of 10-19), by the runner
    // made below.
    besides: () => besides,
    // A message that asks the main agent for a flow (`/flow`, HarnessV4_OneAgent_Plan OA3): the runner made below says
    // what it may draft, and the person's agents and teams the line ahead of its words names.
    flows: () => flowRunner,
    // What is kept behind a session's graph's tasks (E33), marked in the graph that comes back after a summary: the
    // runner made below reads it.
    graphKept: (chainId) => graphs.kept(chainId),
    // Where its planner stands after that graph, the running and paused tasks' checkpoints in it (E41 P1); `starting`, as
    // the turn starting now says it (a switch's handover).
    graphWhere: (chainId, crew, o) => graphs.where(chainId, crew, { back: true, starting: !!o?.starting }),
    // What is still open in a chat, last in that block, and what its main agent heard of it once a summary lands.
    stillOpen,
    // The side-by-side card (Phase 5): its agent suggests it (the owner's of 11-10), kept with the graph by the runner
    // made below, and the transcript draws the one that stands.
    sideOffers: { offered: (chainId) => graphs.offered(chainId) },
    // A planning turn holds what its graph changes for the person's Approve, which lets it go (the owner's plan mode of 11-06).
    plans: { turn: (chainId, on) => graphs.planTurn(chainId, on), carryRefusal: (chainId) => graphs.carryRefusal(chainId), carry: (from, to, o) => graphs.carry(from, to, o) },
    records: usage,
    // A chat another machine's agents started in a copy here holds it while its turns run, and a while after for a
    // follow-up; one whose copy went to a newer launch is refused (services/copies.js `lease`, `grace`).
    copyLease: { start: (id, chat) => remoteCopies.lease(id, chat), end: (id, until) => void remoteCopies.grace(id, until) },
    // A running compaction's progress rides the events feed every page holds, with its session's id
    // (HarnessV3-FailurePoints §5.1 item 3; HarnessV4_Tasks U3-5).
    publish: (chainId, e) => events.publish("compactions", { ...e, chainId }),
    // The loop's paused turns: one whose question ended with no answer's turn is let go with its in-process work.
    parks: { letGo: (chainId) => agentLoop.letGo(chainId) },
    runs,
    // The New Task board weighs the reader model by the loop's own refusal rule (HarnessV3-NewTask NT-D6), and the
    // Environment section by the loop's own capture (HarnessV3-SystemPrompt SP-D7).
    modelProblem: (name) => plainModelProblem(config.get(), name, destinationFor)?.why || null,
    environment: deps.environment,
    teams,
    // A coding agent's session makes room with the agent writing Filament's summary of it (HarnessV3-ACP AC5-4).
    agentSelf: createAgentSelf({ config, destination: destinationFor }),
    agentTasks: (chainId) => agentTasks.get(chainId) || [],
    agentTaskStop: (chainId, taskId) => bridge.stopTask(chainId, taskId),
    // The board and the fit weigh the space tool where the turn offers it: a project whose Space the person made.
    spaceMade: (project) => spaceStore.has(project),
    chatWatchers: (chainId) => chatWatching.of(chainId),
    chatWatching,
    mcpTests,
    copies,
    // Whether a coding agent takes Filament's MCP server: over HTTP, as it declared at its last start, else over stdio
    // through the relay (toolset.js `relayHere`). One that takes neither has no tool of Filament's, and the lines ahead
    // of a message say so.
    agentTakesMcp: (id) => (config.get().upstreams || []).find((u) => u.id === id)?.type !== "acp" || takesHttpMcp(bridge.profiles.all()[id]) || relayHere(),
    // What the plugins and skills on at a chat's place bring (HarnessV4_SpacesPlugins_Plan B3, HarnessV4_Skills_Plan
    // S1-6): the board, the instructions row and the fit read the document a turn would.
    withPlugins: (doc, where) => skillStore.into(plugins.into(doc, where)),
    // A turn that wakes a chat's agent on its way keeps its work stretch going (sessions/stretch.js).
    wakeComing: (chainId) => wakeComing(chainId),
    // A turn Filament started by itself that failed before its model did any work gave back what it carried (the owner's
    // of 11-11): the waker wakes the chat for it again, a few times.
    wakeEnded: (chainId, kept) => wakeEnded(chainId, kept),
    // A check Filament runs for a chat's task graph keeps its stretch going: its verdict wakes the agent.
    graphChecks: (chainId) => graphs.checking(chainId),
    goalRound: (chainId) => goalRound(chainId),
    // No wake or goal round runs while room is made for a chat (the owner's of 11-09): asked again after — and a
    // watcher's turn held back for it goes then (app/routines.js `freed`).
    roomMade: (chainId) => {
      roomMade(chainId);
      routines?.freed(chainId);
      guidance?.freed(chainId);
    },
    idleWake,
    // Each message of the person's tells letters which chats its agent may write to (the owner's of 11-04).
    letters,
    // Each turn's end, on every engine, to the watchers (the plan of 11-11).
    turnEnded: (chainId, t) => watchEvents?.turnEnded(chainId, t),
  });
  // A chat another machine's agents work in, in a copy here, holds it while its sub-agents or background commands go on
  // past its turns, its coding agent's own among them: no newer launch takes it from under them (services/copies.js
  // `setWorking`).
  remoteCopies.setWorking(
    (chat) => runningShellsOf(chat).length > 0 || subagents.list(chat).some((s) => s.status === "running") || (agentTasks.get(chat) || []).some((t) => t.background !== false),
  );
  // A chat deleted lets go of the copy it was bound to: the person's (Run on) is no one's own then.
  remoteCopies.setChatThere((chat) => memory.archive?.hasChain?.(chat) !== false);
  // Late-bound on purpose: the service takes the pipeline, the pipeline's commands take the service — a cycle
  // resolved by reading the property at call time (the /autofit command), never at wiring time.
  deps.sessions = sessions;
  // The sessions' task graphs (HarnessV3-TaskGraph G2, G3): one runner for the process. Every change to a session's
  // graph goes through it — the planner's tasks calls, the agent's or a team's lead's, and what Filament does by itself:
  // it starts the tasks' work, runs their reviews, merges their changes into the folder and tells the planner each
  // end. It reads the archive as memory holds it at each call.
  // What the planner keeps behind its graph's tasks (HarnessV4_TaskNotes_Plan E33): on disk with the chat, never in its
  // record — a file from the chat's folder or the folders the agent may work in, a picture one of the chat's agents drew.
  const taskNotes = createTaskNotes({ dir: dataDir ? join(dataDir, "task-notes") : null, log });
  const graphNotes = createGraphNotes({
    notes: taskNotes,
    ...graphNoteSources({
      config,
      dataDir,
      folderOf: (chainId) => (memory.archive ? sessions.launchInfo(chainId)?.cwd || null : null),
      // A chat another machine's agents started keeps what their fence lets them reach (x-keep).
      agentsChat: (chainId) => {
        const device = memory.archive?.metaOf(chainId, ["agentDevice"])?.agentDevice;
        return typeof device !== "string" ? null : fullControl(devices, device) ? "full" : "fenced";
      },
      fileRefusal: agentFileRefusal,
      picture: (chainId, name) => subagents.picture(chainId, name),
      // The chat's own pictures, newest first: its turns' and its own, each read when asked.
      ownPictures: (chainId) => {
        const a = memory.archive;
        const own = a?.metaOf(chainId, ["visuals"]);
        if (!own) return [];
        /** @param {any} v @param {number} at @param {() => any} read */
        const one = (v, at, read) => (v?.id ? [{ id: String(v.id), title: String(v.title || ""), at: Number(v.at) || at, code: () => { try { const x = read(); return typeof x?.code === "string" ? x.code : null; } catch { return null; } } }] : []);
        return [
          ...a.getTurns(chainId).flatMap((/** @type {any} */ t) => (Array.isArray(t.meta?.visuals) ? t.meta.visuals : []).flatMap((/** @type {any} */ v) => one(v, Number(t.started_at) || 0, () => sessions.turnVisual(chainId, Number(t.n), String(v.id))))),
          ...(Array.isArray(own.visuals) ? own.visuals : []).flatMap((/** @type {any} */ v) => one(v, 0, () => sessions.sessionVisual(chainId, String(v.id)))),
        ].sort((x, y) => y.at - x.at);
      },
    }),
  });
  const graphs = createGraphRunner({
    archive: {
      metaOf: (chainId, keys) => memory.archive?.metaOf(chainId, keys) ?? null,
      mergeMeta: (chainId, patch) => memory.archive?.mergeMeta(chainId, patch) ?? null,
      openGraphs: () => memory.archive?.openGraphs() ?? [],
      // The chat's turn now, which a task added or changed keeps (11-09).
      newestTurnN: (chainId) => memory.archive?.newestTurnN(chainId) ?? 0,
    },
    registry: subagents,
    events,
    crew: (chainId) => graphCrew(sessions.effectiveOf(chainId), ledBy(chainId)),
    log,
    // Memory's open threads a task finishes (HarnessV4_GraphThreads E28): read as the call is, closed at its done.
    threads: memoryThreads(memory),
    // What else is open beside the graph, said after a done or a tick (the owner's of 11-10).
    alsoOpen: (chainId, skip, said) => stillOpen.also(chainId, skip, said),
    personAt: (chainId) => Number(memory.archive?.metaOf(String(chainId), ["personAt"])?.personAt) || null,
    notes: graphNotes,
    // What the folder changed while a task of the agent's own ran, from git (HarnessV4_TaskGraphPlus_Plan E41 P2 case 11),
    // and what of a merged task's change is still uncommitted (11-09).
    folders: { ...taskFolders, uncommitted: uncommittedIn },
    // A plan offered on a card under the person's turn that runs (the owner's plan mode of 11-06): marked on the turn,
    // which stamps it at its end; the page hears it on the feed and draws the card then.
    offerPlan: (chainId, offer) => {
      const id = sessions.offerPlanInTurn(chainId, offer);
      events.publish("turns", { type: "plan-offer", chainId: id, depth: offer.depth, side: offer.side });
    },
    // A check's end: the chat's work stretch weighs again what keeps it (a check running counts, the owner's of 11-06).
    onCheckEnd: (chainId) => sessions.stretchCheck(chainId),
    // The watchers hear each task done or blocked, and a turn's tasks marked done (the plan of 11-11).
    onGraphKept: (chainId, was, next) => watchEvents?.graphKept(chainId, was, next),
    // Parallelize tasks for the chat, read at each call (the owner's of 11-09; `parallelFor`): on, the person's consent —
    // the tasks answers say to start what can run at once now, and no side-by-side card is offered.
    parallel: parallelFor,
    // Off, a new task for a sub-agent that changes files waits on the chat's card for the person's yes (held-launch.js).
    holdsWriters: holdsWritersNow,
    // The chat's own model, as its turns read it: a side-by-side card in a coding agent's chat runs its tasks on it.
    chatModel: (chainId) => String(sessions.effectiveOf(chainId)?.model?.name || memory.archive?.getChain(String(chainId))?.model || "").trim() || null,
  });
  deps.graphs = graphs;
  /** The waker's way to a chat a report came for (10-28): set once the waker stands, below; none is woken before. */
  let wakeForReport = (/** @type {string} */ _chainId) => {};
  subagents.setContext({
    // A chat's agent writes another chat a letter, or answers one (app/letters.js).
    sendLetter: (chainId, input, o) => letters.send(chainId, input, o),
    card: (tag) => agentCards.find(tag),
    cards: () => agentCards.list(),
    teamNames: () => teams.list().map((t) => t.name),
    settings: effectiveOf,
    // Where a chat's setting comes from: an agent's launch keeps to the list the person set (the owner's of 11-19).
    settingFrom: (chainId, path) => (memory.archive ? (resolveChainSettings(memory.archive, config.get(), chainId)?.sources?.[path] ?? null) : null),
    session: (chainId) => (memory?.archive ? sessions.launchInfo(chainId) : null),
    view: (chainId, strategy, o) => (memory?.archive?.hasChain(chainId) ? sessions.contextView(chainId, strategy, o) : Promise.resolve(null)),
    windowView: (chainId, o) => (memory?.archive?.hasChain(chainId) ? sessions.windowView(chainId, o) : Promise.resolve(null)),
    sinceMessage: (chainId) => (memory?.archive?.hasChain(chainId) ? sessions.sinceMessage(chainId) : 0),
    asking: (chainId) => !!memory?.archive?.hasChain(chainId) && sessions.asking(chainId),
    // A sub-agent's brief (HarnessV3-Memory M7-1), in its session and on the turn that launched it.
    brief: ({ chainId, projectId, launchedBy, task, tools, model }) =>
      memory.scope({ role: "agent", project: projectId, chain: chainId, turn: memory.archive?.turnOfRequest(chainId, launchedBy) ?? null }).brief({ purpose: "subagent", task, tools, model }),
    // Why Memory settings leave a sub-agent's work out on the model it went on to: its brief is not sent there.
    leftOut: (chainId, model) => memory.subagentLeftOut(chainId, model),
    // What a sub-agent found (HarnessV3-Memory M7-2): its report onto memory's observation bus, in its session and on
    // the turn that launched it; the learner reads it there.
    reported: ({ chainId, launchedBy, agentId, agentType, model, sentModel, task, report, calls }) =>
      memory.observe({ type: "subagent.report", chain: chainId, turn: memory.archive?.turnOfRequest(chainId, launchedBy) ?? null, id: agentId, agentType, model, sentModel, task, report, calls }),
    // A team's lead said a worker's reported work fell short (M7-D50): how models did counts that task as corrected.
    corrected: ({ chainId, request }) => memory.correctWorker({ chainId, request }),
    modelProblem: subagentModelProblem,
    modelFacts: subagentModelFacts,
    agentOf: (name) => agentSessionOf(config.get(), name),
    // A launch that names its model as a person says it (HarnessV4_Tasks E23): matched against the picker's models at
    // the provider named, with why it cannot run in words; the effort it runs at; and the list a launcher reads.
    chooseModel: async (name, provider, prefer = null, within = null) => chooseModelOf(name, provider, choiceBook(await modelBook.fresh()), { prefer, within }),
    effortOf: (model, wanted, asked) => effortOfModel(model, wanted, { cfg: config.get(), families: modelBook.now()?.families || [] }, { asked }),
    modelList: async (ask, seats) => modelListOf(ask, choiceBook(await modelBook.fresh()), { seats }),
    mark: (chainId, m) => (memory?.archive?.hasChain(chainId) ? sessions.subagentMark(chainId, m) : null),
    // Parallelize tasks off: a sub-agent the chat's agent launches that may change files waits on a card for the person's
    // yes (held-launch.js, the owner's of 11-14).
    holdsWriters: holdsWritersNow,
    // The chat's newest turn as the archive numbers it: a card for sub-agents that change files follows it (held-launch.js).
    newestTurn: (chainId) => {
      try {
        const n = memory?.archive?.newestTurnN?.(chainId);
        return typeof n === "number" && n > 0 ? n : null;
      } catch {
        return null;
      }
    },
    saveQueue: (chainId, list) => {
      if (memory?.archive?.hasChain(chainId)) sessions.saveSubagentQueue(chainId, list);
    },
    loadQueue: (chainId) => (memory?.archive?.hasChain(chainId) ? sessions.loadSubagentQueue(chainId) : []),
    // The agents the developer's newest message named, kept on the chat across a restart.
    keepHeard: (chainId, tags) => {
      if (memory?.archive?.hasChain(chainId)) memory.archive.mergeMeta(chainId, { heardAgents: tags });
    },
    heardKept: (chainId) => memory?.archive?.metaOf(chainId, ["heardAgents"])?.heardAgents || [],
    saveHeld: (chainId, list) => {
      if (memory?.archive?.hasChain(chainId)) sessions.saveSubagentHeld(chainId, list);
    },
    loadHeld: (chainId) => (memory?.archive?.hasChain(chainId) ? sessions.loadSubagentHeld(chainId) : []),
    saveThread: (chainId, thread, max) => {
      if (memory?.archive?.hasChain(chainId)) sessions.saveSubagentThread(chainId, thread, max);
    },
    loadThreads: (chainId, held) => (memory?.archive?.hasChain(chainId) ? sessions.loadSubagentThreads(chainId, held) : []),
    forgetThread: (chainId, agentId) => {
      if (memory?.archive?.hasChain(chainId)) sessions.forgetSubagentThread(chainId, agentId);
    },
    threadsNamed: (agentIds) => memory?.archive?.threadsNamed(agentIds) ?? [],
    // A chat another machine's agents started (`meta.agentDevice`, which a chat made from it, or forked from it, keeps
    // too; a sub-agent's is its session's): it sends no sub-agent to a machine of this Filament's, and lists none —
    // under Full control too.
    agentsChat: (chainId) => agentDeviceOf(chainId) !== null,
    // Such a chat whose device may not run without asking here (its grant `unasked` as it stands, or Full control,
    // which holds it): Filament runs no command task or check of it.
    agentsAsk: (chainId) => {
      const id = agentDeviceOf(chainId);
      return id !== null && !heldGrant(devices.get(id), "unasked");
    },
    // Such a chat whose device holds no Full control here (devices.js `fullControl`): it runs fenced, as turn.js reads it.
    agentsFenced: (chainId) => {
      const id = agentDeviceOf(chainId);
      return id !== null && !fullControl(devices, id);
    },
    // A deleted chat's helpers, as its delete noted them, and where they are looked for (the owner's of 11-09).
    goneHelpers: (chainId) => memory?.archive?.goneChains().get(String(chainId))?.helpers ?? [],
    folders: () => knownFolders(),
    // A picture one of the chat's agents drew, whole, for the agent that opens it (HarnessV4_DesignPass_Plan UX1): from
    // the turn that launched it, or from the session.
    visualCode: (chainId, d) => {
      if (!memory?.archive?.hasChain(chainId)) return null;
      try {
        const v = d.session ? sessions.sessionVisual(chainId, d.id) : sessions.turnVisual(chainId, Number(d.turn), d.id);
        return typeof v?.code === "string" ? v.code : null;
      } catch {
        return null;
      }
    },
    // The pictures drawn in the chats of the teams beside a chat — on their turns, by their leads and their crews, or
    // kept on the team's chat — that the chat's agent opens by name as it opens its helpers' (HarnessV4_DesignPass_Plan,
    // case 13). Read off the turns' rows: no turn's body is opened.
    besidePictures: (chainId) => {
      const a = memory?.archive;
      if (!a?.hasChain(chainId)) return [];
      return a.besideOf(chainId).flatMap((/** @type {string} */ id) => {
        const team = a.metaOf(id, ["beside", "visuals"]);
        const b = team?.beside && typeof team.beside === "object" ? team.beside : null;
        if (!b) return [];
        const by = `the ${String(b.name || b.team || "team")} team beside this chat`;
        const task = String(b.ask || "");
        /** @param {any} v @param {any} where */
        const one = (v, where, at) => (v?.id ? [{ chain: id, d: { id: String(v.id), title: String(v.title || ""), bytes: Number(v.bytes) || 0, ...where }, by, task, at: Number(v.at) || Number(at) || 0 }] : []);
        return [
          ...a.getTurns(id).flatMap((/** @type {any} */ t) => (Array.isArray(t.meta?.visuals) ? t.meta.visuals : []).flatMap((/** @type {any} */ v) => one(v, { turn: Number(t.n) }, t.started_at))),
          ...(Array.isArray(team?.visuals) ? team.visuals : []).flatMap((/** @type {any} */ v) => one(v, { session: true }, 0)),
        ];
      });
    },
    // Each exchange's end frees a slot a graph's task may wait for, and a graph task's end moves its task on.
    exchangeEnded: (o) => {
      // The watchers hear a sub-agent's report (the plan of 11-11), apart: theirs failing is no graph's, nor the graph's theirs.
      try {
        watchEvents?.subagentEnded({ chain: o.chainId, agent: o.agentId, ...o.ended });
      } catch (/** @type {any} */ e) {
        log("warn", `watchers: sub-agent ${o.agentId}'s end was not heard (${e?.message || e})`);
      }
      graphs.ended(o);
    },
    // The developer's apply of a sub-agent's work: a graph task's change that waited for its apply is done (10-28).
    workApplied: (o) => graphs.applied(o),
    // The agent's — or a lead's — apply of a graph task's change that waits for it: the graph's checked merge (11-02).
    taskApply: (o) => graphs.applyAsked(o),
    // A mark of a graph task's change as applied, brought in by hand: the graph's word on it (11-10), told as an apply.
    taskMark: (o) => graphs.markRefusal(o.chainId, o.agentId),
    // What any apply wrote stays the sub-agent's in Changes until committed, across a restart (10-29): a round of the
    // chat's newest turn in the repository's place, as git spells it, as its rounds are — the chat's own where it has
    // no turn yet — kept before the apply says itself, which awaits it (found reviewing the Changes tab, 10-29).
    appliedWrote: (o) =>
      placeOf(o.repo).then((at) => {
        if (at.place) memory?.recordApplied(o.chainId, { place: at.place, agent: o.agentId, own: o.paths });
      }, () => {}),
    // A graph task's change sent back to rebase goes back the graph's way (the Designer's of 10-27, built 10-28).
    rebaseTask: (o) => graphs.rebaseTask(o),
    // One sent back to rebase is due only while its graph task waits for it to go on (the Hunter's of 10-28).
    rebaseWaits: (chainId, agentId) => graphs.rebaseWaits(chainId, agentId),
    // A graph worker whose change waits for the developer's Apply is kept across a restart, as a helper is (10-28).
    waitsForYou: (chainId, agentId) => graphs.waitsForYou(chainId, agentId),
    // Another agent's report came for the agent while no turn ran: the chat goes on by itself to read it (10-28).
    reportWaits: (chainId) => wakeForReport(chainId),
    // A coding agent's launch names a task of its graph (10-28): its box shows who works on it.
    taskHelper: { refusal: (chainId, id) => graphs.helperRefusal(chainId, id), took: (chainId, id, helper) => graphs.helperTook(chainId, id, helper) },
    // A Hunter fired from a task of the graph keeps that task as the graph holds it (11-02).
    huntedTask: (chainId, id) => graphs.huntedTask(chainId, id),
    // A sub-agent its session's graph will still ask for outlives the registry's prune (the bug report's L9).
    holds: (chainId) => graphs.holds(chainId),
    // A flow the main agent drives In place (HarnessV4_OneAgent_Plan OA4): the chat's turn stays open until it ends.
    flowOwes: (chainId) => flowRunner?.drives(chainId) ?? null,
    flowDriven: (chainId) => !!flowRunner?.driven(chainId),
    // A worktree's folder does not exist before it is made: its nearest existing ancestor answers for it.
    folderProblem: (path) => {
      let p = resolve(path);
      while (!existsSync(p) && dirname(p) !== p) p = dirname(p);
      const v = folderVerdict(config.get(), p);
      return v.ok ? null : v.why;
    },
  });
  /** The turns the last stop cut off, given their work as memory opens (`openMemory`): the ones Filament goes on with (HarnessV3-TaskGraph-v2 TG2-D83). @type {import("./app/sessions/cut-turns.js").KeptTurn[]} */
  const keptAtStart = [];
  /** Whether the last clean stop's note was read: by memory's open, or by a stop that came before it did. */
  let noteRead = false;
  /** The chats a stop notes for the next start (`noteAtStop`). @type {Set<string>} */
  const notedAtStop = new Set();
  /**
   * The note a stop leaves the next start (TG2-D85): the chats whose harness turn runs now, the turns memory's open kept
   * and did not send on (`keptAtStart`), and the chats of the last stop's note where memory's open has not read it — a
   * stop during the open leaves the next start all of them. Called again, it adds what the open kept since.
   * @param {string[]} running
   */
  const noteAtStop = (running) => {
    for (const c of running) notedAtStop.add(c);
    for (const k of keptAtStart) notedAtStop.add(k.chainId);
    if (!noteRead) {
      noteRead = true;
      for (const c of takeRunningAtStop(dataDir)?.chains || []) notedAtStop.add(c);
    }
    noteRunningAtStop(dataDir, [...notedAtStop]);
  };
  /** What the start sent the chats whose turn a restart cut off (TG2-D83): each chat's outcome once its reply's head is
   *  in; none before the server listens. */
  let resumedAtStart = Promise.resolve(/** @type {any[]} */ ([]));
  /**
   * The chats owed a wake as Filament starts (`wakeSoon`, the nudge map of 11-10): gathered from the listen, as memory's
   * open settles what the last stop left, until the sweep after the cut turns went on (`sweepOwed`) — null before and
   * after — or `OWED_HOLD_MAX_MS` at most, should a cut turn take long to go on. @type {Set<string> | null}
   */
  let owedAtStart = null;
  /** The come-backs the chats kept as Filament last stopped, by chat, when each was due: the sweep's `staleWords` reads them. @type {Map<string, number>} */
  const comeBackAtStart = new Map();
  /**
   * What the start gave back to each chat that kept something as Filament last stopped (`restoreOwed`), by chat: each
   * item's id as it is told — what waited untold, its come-back, its idle check-in. The sweep weighs each chat
   * (`sweepOwed`), and its hold on one covers these alone. @type {Map<string, Set<string>>}
   */
  const restoredAtStart = new Map();
  /**
   * The chats this start does not go on with, by chat: why, and what it gave back to each (`gave`; the review of
   * 11-11). The sweep weighs every chat the start gave something back to by the start's own rules (`startSkip`), and
   * those owed a wake now are skipped for it; but a come-back or an idle check-in armed again for later comes after the
   * sweep, and woke its chat all the same — with Go on after a restart off, in a chat the person left days ago. Held
   * here, what the start gave back waits untold for the chat's next turn, which carries it.
   * The hold covers what the start gave back, and nothing else (the review's second look: it held every wake, so a
   * letter another chat wrote hours later, a sub-agent's report, the person's Apply never woke the chat, though its
   * sender was told Filament wakes it): what comes for the chat since — `cameSince` — wakes it as it would any chat, and
   * what was held rides that turn. The hold goes as a turn takes the chat (`turnTook`), and as the person brings it back
   * from the archive (`unarchived`): either way the chat is theirs again. Switching Go on after a restart back on lets
   * go of nothing: it is a rule of the next start. @type {Map<string, { why: string, gave: Set<string> }>}
   */
  const heldAtStart = new Map();
  /**
   * The chats something came for between memory's open and the sweep (`wakeSoon`'s `fresh`): a letter or a report of
   * this run, not what the start settled of the last stop. The sweep holds none of them. @type {Set<string>}
   */
  const freshAtStart = new Set();
  /**
   * Whether something waits for a held chat's agent that the start did not give back: what came for it between memory's
   * open and the sweep, or an untold item that wakes it under an id the start never gave it — a command's end, a watch's
   * lines, a come-back set since. @param {string} chainId @param {{ gave: Set<string> }} held
   */
  const cameSince = (chainId, held) => freshAtStart.has(chainId) || untoldOf(chainId).some((x) => wakes(x) && !held.gave.has(x.id));
  /**
   * The chats a turn took from the start's begin to its sweep (`owedAtStart` set): a cut turn the start sent on, a
   * message of the person's that came first. Live already, the sweep holds none of them. @type {Set<string>}
   */
  const tookAtStart = new Set();
  turnTook = (chainId) => {
    heldAtStart.delete(chainId);
    if (owedAtStart) tookAtStart.add(chainId);
  };
  unarchived = (chainId) => {
    const held = heldAtStart.get(chainId);
    if (!held) return;
    heldAtStart.delete(chainId);
    log("info", `sessions: ${chainId}: the person brought it back from the archive, so the start's hold on it goes (${held.why}): what comes for its agent wakes it as it would any chat`);
  };
  /** What the start's sweep did with the chats it owed a wake: a test waits on it instead of on the clock. */
  let owedWokenAtStart = Promise.resolve(/** @type {{ chainId: string, woke: boolean, why?: string }[]} */ ([]));
  /**
   * A turn Filament sends a chat of its own accord: the chat's turns route on loopback, as replay-compare sends its
   * copy's — streamed, so the head says at once whether it was taken, and read to its end, so the reply is never hung
   * up on. `turn`: the turn it became in that chat, as its head says it (`x-filament-turn`); null where it says none.
   * @param {string} chainId @param {Record<string, unknown>} body  what the turn is: a resume, a wake, a sync
   */
  const postOwnTurn = async (chainId, body) => {
    const key = (config.get().server?.inboundKeys || [])[0] || "";
    const r = await loopbackPost(`${selfBase()}/api/sessions/${encodeURIComponent(chainId)}/turns`, {
      headers: { "content-type": "application/json", "x-filament-ui": "1", "x-api-key": key },
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (!r.ok) return { status: r.status, body: await r.json().catch(() => null) };
    void (async () => {
      try {
        for await (const _ of /** @type {any} */ (r.body)) void _;
      } catch {}
    })();
    return { status: r.status, body: null, turn: Number(r.headers.get("x-filament-turn")) || null };
  };
  /** The turn Filament sends a chat to go on with its cut turn (TG2-D83). */
  const postResume = (/** @type {string} */ chainId) => postOwnTurn(chainId, { by: "resume" });
  /** The turn Filament sends a chat as a background command ends (HarnessV4_Four_Plan E21, FO-D49). */
  const postWake = (/** @type {string} */ chainId) => postOwnTurn(chainId, { by: "wake" });
  // Another agent's report that came for the agent while no turn ran wakes the chat too (the owner's of 10-28). A chat it
  // lets go of with no turn sent has its work stretch weighed: it ends unless something still keeps it.
  const wakeOwed = (/** @type {string} */ session) => wakeDue(session) || subagents.reportsDue(session) || subagents.lettersDue(session);
  // A wake's turn that failed before its model did any work is tried again after 1, 5 and 15 minutes (wake.js
  // WAKE_AGAIN_MS); a test's own waits (test/wake-carried-back.test.js): the real ones everywhere else.
  const wakeAgainMs = Array.isArray(overrides.wakeAgainMs) ? overrides.wakeAgainMs.map(Number) : WAKE_AGAIN_MS;
  const waker = createWaker({ post: postWake, due: wakeOwed, attended: (session) => shellsAttended(session) || subagents.turnRuns(session), idle: (session) => sessions.stretchCheck(session), log, againMs: wakeAgainMs });
  wakeEnded = (chainId, kept) => waker.ended(chainId, kept);
  /**
   * A wake asked for while Filament starts — from memory's open, where what the last stop left is settled, to the sweep
   * once the cut turns went on (`afterListening`) — waits for that sweep (sessions/owed-wakes.js, the nudge map of 11-10):
   * a sub-agent's report the stop cut, a come-back that came while Filament was not running. The sweep wakes them a few
   * seconds apart, not all at once on one account's quota, nor before the server can take their turns.
   * `fresh`: what came is of this run — another agent's report, a letter —, never what the start gave back.
   * @param {string} chainId @param {{ fresh?: boolean }} [o]
   */
  const wakeSoon = (chainId, { fresh = false } = {}) => {
    if (owedAtStart) {
      owedAtStart.add(chainId);
      // Memory's open settles the last stop — a cut sub-agent's report, a graph's word —, which is the start's to
      // weigh; what comes once it is open is new.
      if (fresh && opened) freshAtStart.add(chainId);
      return;
    }
    // …and one the start does not go on with is not woken later by what the start gave back to it — a come-back or an
    // idle check-in armed again, as its time comes —: that waits for its next turn. Anything else wakes it.
    const held = heldAtStart.get(chainId);
    if (!held || fresh || cameSince(chainId, held)) return waker.wake(chainId);
    log("info", `sessions: ${chainId}: what the start gave back to its agent waits for the chat's next turn, as Filament started and did not go on with it: ${held.why}`);
    sessions.stretchCheck(chainId);
  };
  const stopWaking = onShellWake((session) => wakeSoon(session));
  // The variables the person passes to commands whatever their names read like (`agentLoop.envPass`), read by the hands
  // at each command they start (hands.js `safeEnv`): a name written in Settings reaches the next one (r-hands, 11-12).
  const stopEnvPass = envPassFrom(() => config.get().agentLoop?.envPass);
  // Untold items past their cap go (hands.js UNTOLD_MAX): logged, as the agent is told at its next turn (the nudge map of
  // 11-10: they went silently) — once a run, as the first go: the rest are counted for that telling.
  const stopLogLost = onUntoldLost((session, agent, n) => log("warn", `sessions: ${session}: ${n} untold background item(s) of ${agent ? agent : "its main agent"} let go — more than the cap waited; more that go before its next telling are counted, not logged, and that telling says how many`));
  wakeForReport = (chainId) => wakeSoon(chainId, { fresh: true });
  // A driving goal's next round (core/goal-drive.js, the owner's of 11-05): sent once the turn whose end owed it lets
  // go of the chat, as a wake is — a turn of the person's that comes first takes it, and its own end decides again.
  // A round it gives up on is owed no more (`goalLetGo`): the end of the chat's next turn decides again.
  const goalWaker = createWaker({
    post: (chainId) => postOwnTurn(chainId, { by: "goal" }),
    due: (chainId) => sessions.goalOwed(chainId),
    attended: () => false,
    idle: (chainId, gaveUp) => sessions.goalLetGo(chainId, gaveUp),
    log,
    words: { came: (chainId) => `a goal's next round is owed to ${chainId}`, waits: "the round is owed no more: the end of the chat's next turn decides again" },
  });
  goalRound = (chainId) => goalWaker.wake(chainId);
  /**
   * What a wake or a goal round waited with, sent where it is still owed. → whether one was sent for. The start's hold
   * is the sweep's own to weigh (`sweepOwed`): the room made for a chat asks for it as it would any chat's.
   * @param {string} chainId
   */
  const wakeAnyOwed = (chainId) => {
    const owed = wakeOwed(chainId);
    if (owed) waker.wake(chainId);
    const goal = sessions.goalOwed(chainId);
    if (goal) goalWaker.wake(chainId);
    return owed || goal;
  };
  // …as room was made for the chat, where no message of the person's took it; and as Filament starts (`sweepOwed`).
  roomMade = wakeAnyOwed;
  // A chat's work stretch goes on while a turn that wakes its agent is on its way: the waker's, or its coding agent's own
  // (sessions/stretch.js). Its goal's next round the sessions count themselves, while it is owed.
  wakeComing = (chainId) => waker.coming(chainId) || bridge.ownComing(chainId);
  // …and is weighed as its commands start, end or are stopped: the person's Stop of the last wakes nobody, and ends it.
  const stopWeighingStretches = onShellsChange((chainId) => sessions.stretchCheck(chainId));
  // The commands that run in the background, a chat's whole list at each start and end (HarnessV4_Background_Plan
  // E38-D4): on the `turns` topic, which every page hears, for the chat's status capsule and Now.
  const stopTellingCommands = onShellsChange((chainId) => events.publish("turns", { type: "commands", chainId, commands: commandsOf(chainId) }));
  // …and kept with the chat while they run (`runningRecord`), so that as Filament starts again its agent is told which
  // its stop ended. Filament's own stop below ends this first: what that stop ends stays in the record.
  const stopKeepingCommands = onShellsChange((chainId) => {
    const rows = runningRecord(chainId);
    memory.archive?.mergeMeta(chainId, { shellsRunning: rows.length ? rows : undefined });
  });
  // A chat's come-back (agent/come-back.js) as it stands after each set, replace, Cancel, Stop and its time coming —
  // null once none waits (the Designer's of 10-27): on the same topic, for the chat's status capsule and Now.
  const stopTellingComeBacks = onComeBackChange((chainId) => events.publish("turns", { type: "come-back", chainId, comeBack: comeBackOf(chainId) }));
  // What waits untold for a chat's agents and its come-back, kept with it as each changes (`keepOwed`, the nudge map of
  // 11-10). Filament's own stop below ends this first, as it ends the record of the commands.
  const stopKeepingUntold = onUntoldChange(keepOwed);
  const stopKeepingComeBacks = onComeBackChange(keepOwed);
  /**
   * Why no turn of Filament's own starts in a chat now, whatever came, or null: the rules the wake's gate refuses by at
   * any moment (sessions/service.js `turn`), asked here so the sweep says why and sends nothing — the person stopped its
   * newest turn, whose waiting line says their next message tells the agent, or archived it (`notByItself`, the one
   * rule the gates, the idle check-in and this ask). They hold a chat for as long as they last, with no hold kept here.
   * @param {string} chainId
   */
  const liveSkip = (chainId) => (sessions.stoppedNow(chainId) ? "the person stopped its newest turn" : sessions.notByItself(chainId));
  /**
   * Why the start does not go on with a chat it gave something back to (sessions/owed-wakes.js), or null — the rules of
   * the start alone, which weigh what a restart gives back and nothing that comes later: a team beside a chat and a
   * flow's team box go on only on the person's word (resume-cut.js `resumePlan`), the person turned off going on after
   * a restart, or left the chat over a day ago. What they hold of a chat is what the start gave back to it
   * (`heldAtStart`).
   * @param {string} chainId
   */
  const startSkip = (chainId) => {
    // A team's chat keeps what any chat does — its lead's commands, its come-back, its workers' reports — and its
    // card says it stopped, with Resume…: woken for them, it went on by itself.
    const chain = chainRow(chainId);
    if (chain?.kind === "team") return chain.meta?.beside?.flow ? FLOW_WAITS : TEAM_WAITS;
    // The person turned off going on after a restart: nothing starts by itself then (FabeleHelper's of 11-10).
    if (config.get().sessions?.resumeAfterRestart === false) return "Go on after a restart is off";
    // A chat the person left over a day ago (owed-wakes.js `staleWords`): measured from their own message — where the
    // chat kept none, from its newest turn that Filament did not start by itself, and where it holds none of theirs (a
    // routine's run, an ask's), from when it began (`personLast`) —, and from a come-back it set.
    return staleWords({ ...sessions.personLast(chainId), comeBackAt: comeBackAtStart.get(chainId) || 0, now: Date.now() });
  };
  /**
   * Why a chat the start owes a wake now is not woken at the sweep's turn for it, though the start goes on with it, or
   * null: the account its model runs on is out of quota — a wall its provider said (an earlier wake of the sweep's may
   * have just run into it), or a coding agent's plan spent, as its plan's windows say (services/agent-accounts.js). Its
   * timers armed again for later wake it as they come: the quota may be back by then. @param {string} chainId
   */
  const quotaSkip = (chainId) => {
    const cfg = config.get();
    const name = String(sessions.effectiveOf(chainId)?.model?.name || memory.archive?.getChain(String(chainId))?.model || "").trim();
    const inner = parseAgentModel(name)?.model || name;
    if (!inner) return null;
    const walled = walledProblem(cfg, inner, (id) => health.wallOf(id));
    if (walled) return `its account is out of quota (${walled})`;
    const up = agentSessionOf(cfg, inner);
    const plan = up ? accounts.view(up) : null;
    return plan?.spent ? `its account is out of quota: ${up}'s plan is spent${plan.freeAt ? ` until ${new Date(plan.freeAt).toTimeString().slice(0, 5)}` : ""}` : null;
  };
  /**
   * The chats Filament owes a wake as it starts (`wakeSoon`), woken one after another once the cut turns went on —
   * those a stop, the archive or a quota holds back skipped, said in the log (sessions/owed-wakes.js). Every chat the
   * start gave something back to is weighed by the start's own rules first, at once (`startSkip`): one it does not go
   * on with is held (`heldAtStart`), so its come-back or idle check-in armed again for later wakes nothing either; one
   * a turn took already — a cut turn the start sent on, the person's message — is live, and held by none. A held chat
   * something new came for meanwhile (`cameSince`) is woken at its turn all the same. → each chat's outcome.
   */
  const sweepOwed = () => {
    const chats = [...(owedAtStart || [])];
    owedAtStart = null;
    const owedNow = new Set(chats);
    for (const chainId of new Set([...chats, ...restoredAtStart.keys()])) {
      if (tookAtStart.has(chainId)) continue;
      /** @type {string | null} */
      let why = null;
      try {
        why = startSkip(chainId);
      } catch (/** @type {any} */ e) {
        why = `what it stands on could not be read (${e?.message || e})`;
      }
      if (!why) continue;
      heldAtStart.set(chainId, { why, gave: restoredAtStart.get(chainId) ?? new Set() });
      if (!owedNow.has(chainId)) log("info", `sessions: ${chainId} is not gone on with as Filament started: ${why}. What its timers bring as they come waits for the chat's next turn`);
    }
    restoredAtStart.clear();
    tookAtStart.clear();
    if (chats.length) log("info", `sessions: ${chats.length} chat${chats.length === 1 ? " was" : "s were"} owed a wake as Filament started: woken one after another`);
    /** Why the start's hold keeps a chat from its wake at the sweep, or null: held, with nothing new come for it. @param {string} chainId */
    const heldWhy = (chainId) => {
      const held = heldAtStart.get(chainId);
      return held && !cameSince(chainId, held) ? held.why : null;
    };
    return wakeOwedAtStart({ chats, skip: (chainId) => liveSkip(chainId) ?? heldWhy(chainId) ?? quotaSkip(chainId), wake: wakeAnyOwed, stop: () => draining, log, staggerMs: Number.isFinite(Number(overrides.owedStaggerMs)) ? Number(overrides.owedStaggerMs) : OWED_STAGGER_MS }).finally(() => freshAtStart.clear());
  };
  /** Whether a turn holds a chat now. @param {string} chainId */
  const chatBusy = (chainId) => {
    const c = chainRow(chainId);
    return !!c && !!sessionTurns.holder(c.key);
  };
  /**
   * Words of Filament's into a chat's running turn: the turn the lock names as the harness's, or, where it names none
   * yet, the chat's running turns that are the harness's own requests (`api: "session"` on their record) — a chat's
   * move holds no turn to tell; the first that takes the note, answered with its run and its id there. `as`: who it is
   * from where it is not Filament's own word — a watcher's guidance, with the watcher's title.
   * @param {string} chainId @param {string} text @param {{ from?: string, title?: string }} [as]
   */
  const chatSteer = (chainId, text, as = {}) => {
    const c = chainRow(chainId);
    const holder = c ? sessionTurns.holder(c.key) : null;
    const ids =
      holder && holder.window !== "harness"
        ? []
        : holder?.requestId
          ? [holder.requestId]
          : runs.runningIn(chainId).filter((m) => usage.byId?.get(m.id)?.api === "session").map((m) => m.id);
    /** @type {{ ok: boolean, run?: string, id?: string, error?: string }} */
    let last = { ok: false, error: "no turn of Filament's runs in the chat now" };
    for (const id of ids) {
      const r = runs.steer(id, { kind: "note", text, from: as.from || FILAMENT, ...(as.title ? { title: as.title } : {}) });
      if (r.ok) return { ok: true, run: id, id: r.message.id };
      last = r;
    }
    return last;
  };
  // A sync from a project's Space (proposal_ux §4.14): on the person's Tell them (Tell the chats…), each lane's chat is
  // sent its message — a turn of Filament's own where the chat is at rest, a note into its running turn where its agent
  // takes words while it works, else once that turn ends, which the turn lock says (`onHolder` above). Each message names
  // the other chats as its chat's agent may read them (`space.apart`).
  spaceSync = createSpaceSync({
    store: spaceStore,
    projectOf: space.projectOf,
    nameOf: space.nameOf,
    apart: space.apart,
    log,
    reach: { busy: chatBusy, post: (chainId, text) => postOwnTurn(chainId, { content: [{ type: "text", text }], by: "sync" }), steer: chatSteer },
  });
  /**
   * The places of the repository a folder is in, as the Space's lanes read them: each worktree whole, a folder the fence
   * refuses said so, each looked at off the server's thread first — a chat's turn end reads them. @param {string} folder
   * @returns {Promise<{ ok: true, places: any[] } | { ok: false, error: string }>}
   */
  const projectPlaces = async (folder) => {
    const f = await allowedFolderSoon(config.get(), folder);
    if (!f.ok) return { ok: false, error: f.error };
    const wt = await worktreesOf(f.root);
    if (!wt.ok) return { ok: false, error: String(wt.error || "git could not read it") };
    const read = await fewAtOnce(wt.worktrees, async (w) => {
      const g = await allowedFolderSoon(config.get(), w.path);
      return readWorktree(w, { refused: g.ok || g.status === 404 ? null : g.error });
    });
    return { ok: true, places: read };
  };
  // What happened, filling itself (HarnessV4_Space_Plan SG-D4): as a chat of a project ends a turn, the project's places
  // are read and Filament writes what the chat finished and what the lanes did.
  spaceNews = createSpaceNews({
    store: spaceStore,
    chat: (chainId) => {
      const row = chainRow(chainId);
      if (!row) return null;
      const p = row.project_id && row.project_id !== NO_PROJECT_ID ? String(row.project_id) : null;
      return { project: p, name: String(row.title || row.preview || "an untitled chat"), listed: LISTED_KINDS.includes(row.kind || "interactive") && !row.meta?.archived, from: typeof row.meta?.from?.space === "string" ? row.meta.from.space : null };
    },
    // A project as a handed chat's line names it in the Space it came from (A4): a Space of your own by its own name.
    nameOf: (project) => {
      try {
        return spaceStore.get(project).own?.name || memory.archive?.getProject(project)?.name || null;
      } catch {
        return null;
      }
    },
    folderOf: projectFolder,
    places: projectPlaces,
    chatsIn: (folders) => memory.chatsIn(folders),
    log,
  });
  // The lanes as the agents' space tool reads them (HarnessV4_AgentsSpace_Plan SA-D6), as the Space's page does: the
  // same places, each chat at work now as the places list says it (GW-D39), what each place changed as the page's files
  // read says it, fenced alike. The chats are those the asking chat's agent may read, as `chatsOf` names them: none whose
  // turns memory keeps to itself but its own, and none by the words of a turn kept apart (memory's `chatsIn`, `readFor`).
  const spaceLanes = createSpaceLanes({
    folderOf: projectFolder,
    places: projectPlaces,
    chatsIn: (folders, self) => memory.chatsIn(folders, { readFor: self || "" }),
    filesOf: async (path) => {
      const f = await allowedFolderSoon(config.get(), path);
      if (!f.ok) return { path, ok: false, error: f.status === 404 ? "the folder is gone" : f.error, branch: null, base: null, ahead: null, commits: 0, files: [], more: 0 };
      return placeFiles(await branchOf(f.root), path);
    },
    atWork: () =>
      new Set([
        ...(sessionTurns.holders() || []).map((h) => memory.archive?.chainIdForKey?.(h.key)).filter(Boolean).map(String),
        ...(subagents.atWork?.() || []),
        ...[...agentTasks].filter(([, tasks]) => tasks.some((t) => AGENT_WORK.has(t.kind))).map(([chain]) => String(chain)),
      ]),
    lastAt: (chainId) => {
      const t = Number(chainRow(chainId)?.last_at);
      return Number.isFinite(t) && t > 0 ? t : null;
    },
  });
  space.lanes = (project, self) => spaceLanes.read(project, self);
  // Threads (app/threads.js): a chat's agent starts a linked chat, its brief posted as Filament's own turn.
  threads = createThreads({
    sessions,
    archive: () => {
      if (!memory.archive) throw new Error(`no archive: threads need it. ${memory.archiveWhy()}`);
      return memory.archive;
    },
    registry: () => subagents,
    chatEffortOf: (model, wanted, asked) => chatEffortOf(model, wanted, { cfg: config.get(), families: modelBook.now()?.families || [] }, { asked }),
    postTurn: postOwnTurn,
    letters,
    remove: (chainId) => memory.deleteSession(chainId),
    folderOk: (folder) => folderVerdict(config.get(), folder),
    modeOf: (model) => agentModeOf(config.get(), model),
    log,
  });
  // Teams beside a chat (team_v2_plan §5.3, §5.4): each a chat of its own whose lead starts from the main chat's record;
  // a result reaches the main agent the way a sync does, on the person's word or their switch.
  besides = createTeamsBeside({
    archive: () => {
      if (!memory.archive) throw new Error(`no archive: teams beside a chat need it. ${memory.archiveWhy()}`);
      return memory.archive;
    },
    sessions,
    teams,
    registry: () => subagents,
    postTurn: postOwnTurn,
    reach: { busy: chatBusy, post: (chainId, text) => postOwnTurn(chainId, { content: [{ type: "text", text }], by: "beside" }), steer: chatSteer },
    remove: (chainId) => memory.deleteSession(chainId),
    events,
    log,
    chatEffortOf: (model, wanted, asked) => chatEffortOf(model, wanted, { cfg: config.get(), families: modelBook.now()?.families || [] }, { asked }),
    modeOf: (model) => agentModeOf(config.get(), model),
    // A flow's team box that writes, in a git worktree of its own (HarnessV4_OneAgent_Plan OA5): made as a chat's Works in
    // makes one, under the folders Filament may work in, its project's template copied in — and, where the flow asks,
    // the uncommitted files of the place it was made from.
    places: {
      own: (cwd, name) => ownWorktree(cwd, name, { refuse: (x) => newFolderRefusal(config.get(), x, { from: cwd }) }),
      bring: (made) => bringUncommitted(made.place, made.folder, made.commit),
      takeBack,
      template: (chatId, made) => copies.start(chatId, { from: made.place, to: made.folder, paths: sessions.worktreeTemplate(made.place).copy }),
      untemplate: (chatId, why) => copies.stop(chatId, why),
      here: (folder) => !!folder && existsSync(folder),
    },
    teamsOn: () => teamsOn(config.get()),
  });
  /**
   * A project the archive no longer knows (HarnessV4_SpacesPlugins_Plan A5): its Space's routines and watches are paused,
   * not run. False while there is no archive to ask: nothing is paused on a guess.
   * @param {string} project
   */
  const projectGone = (project) => {
    try {
      return !!memory.archive && !memory.archive.getProject(project);
    } catch {
      return false;
    }
  };
  // A Space's routines (HarnessV4_Space_Plan S6): at a time the person switched on, a new chat of the project — read-only,
  // or in a worktree of its own where the routine writes, made as a flow's box makes one — its first message the
  // routine's words. Started once Filament listens (below): a run's turn goes on loopback.
  // A chat whose words are its own alone now (the plan of 11-11, its w5): memory keeps its turns to itself, or its
  // newest turn was kept apart. What happens in it is heard as a fact, with none of what it said, by any reader but
  // itself. One that cannot be read counts as such.
  const wordsOwn = (/** @type {string} */ chainId) => {
    try {
      return memory.keptToItself(String(chainId)) || !!memory.archive?.getTurns(String(chainId), { last: 1 })[0]?.meta?.apart;
    } catch {
      return true;
    }
  };
  // What a woken watcher reads past its events' lines (the plan of 11-11, its w5): a turn's ask, reply, notes and patch;
  // the chat's task graph and goal; a commit move's commits whole — for whoever reads it: nothing of a chat whose
  // words are its own, save to that chat.
  const packet = createPacket({
    turnOf: (chain, n, o) => sessions.turnRead(chain, n, o),
    graphOf: (chain) => {
      const goal = memory.goalFor?.(chain);
      const graph = memory.archive?.getChain?.(chain)?.meta?.graph || null;
      const live = goal && (goal.status === "active" || goal.status === "proposed") ? `The chat's goal (${goal.status}): ${goal.slice || goal.text}` : "";
      return [live, graph ? showText(graph, graphCrew(sessions.effectiveOf(chain), ledBy(chain))) : ""].filter(Boolean).join("\n\n");
    },
    patchOf: (chain, n, o) => sessions.turnPatch(chain, n, o),
    commitsOf: async (place, from, to) => {
      const r = await commitsShown(place, from, to);
      if (!r.ok) throw new Error(r.error);
      return r.text;
    },
    postOf: (post) => webhookWatch?.postOf(post) ?? [],
    nameOf: (chain) => space.nameOf(chain),
    apart: (chain) => space.apart(chain),
    quiet: wordsOwn,
  });
  /** A project by its name, as a watcher's words say whose Space it is of. @param {string} project */
  const projectName = (project) => {
    try {
      return String(memory.archive?.getProject(project)?.name || project);
    } catch {
      return project;
    }
  };
  /**
   * Why a chat never takes a turn of a watcher's — its wake, its guidance —, or null: archived, the person put it away;
   * a client's own session, whose client owns its turns, so Filament starts none there. @param {string} chain
   */
  const unwakeable = (chain) => {
    const meta = chainRow(chain)?.meta;
    return meta?.archived ? "it is archived" : meta && !meta.native ? "it is another client's own session, where Filament starts no turn" : null;
  };
  routines = createRoutines({
    spaces: spaceStore,
    sessions,
    mark: (chainId, meta) => memory.archive?.mergeMeta(chainId, meta),
    markTurn: (chainId, n, meta) => {
      const t = memory.archive?.getTurns(chainId, { from: n, to: n })[0];
      if (t) memory.archive?.mergeTurnMeta(t.id, meta);
    },
    postTurn: postOwnTurn,
    folderOf: (project) => {
      try {
        return memory.archive?.getProject(project)?.cwd || null;
      } catch {
        return null;
      }
    },
    places: {
      own: (cwd, name) => ownWorktree(cwd, name, { refuse: (x) => newFolderRefusal(config.get(), x, { from: cwd }) }),
      takeBack,
      template: (chatId, made) => copies.start(chatId, { from: made.place, to: made.folder, paths: sessions.worktreeTemplate(made.place).copy }),
      untemplate: (chatId, why) => copies.stop(chatId, why),
    },
    remove: (chainId) => memory.deleteSession(chainId),
    gone: projectGone,
    nameOf: projectName,
    // A run's chat reads the chat that pressed Run now, and the chat a watcher watches, as any other chat's agent does
    // (`space.nameOf`, `space.apart`).
    chatName: (chain) => space.nameOf(chain),
    apart: (chain) => space.apart(chain),
    // What it runs on (the owner's of 11-04): a model that cannot run now gives way to its Space's, and an effort is kept
    // as a chat keeps one.
    problemOf: (model) => subagentModelProblem(poolName(model)),
    chatModel: (model, effort) => chatEffortOf(model, effort, { cfg: config.get(), families: modelBook.now()?.families || [] }),
    // The watchers that ask by themselves follow each change of the routines (the plan of 11-11), and a guidance that
    // waited for its watcher's Resume, or for Pause all to go off, is looked at again.
    armed: () => {
      connectionWatch?.sync();
      commitWatch?.sync();
      fileWatch?.sync();
      scriptWatch?.sync();
      webhookWatch?.sync();
      guidance?.look();
    },
    packetOf: (_r, heard, reader) => packet.packetOf(heard, { reader }),
    unwakeable,
    log,
  });
  // The agents' space tool pauses a routine, runs one now and switches Pause all on as the page does (HarnessV4_AgentsSpace_Plan AS4).
  space.routines = routines;
  // What a watcher the person let guide writes to the chat it watches (the plan of 11-11, its w6): into that chat's
  // running turn as the watcher's note, as a turn of Filament's own where it is at rest, or kept in its Space until the
  // chat lets go (`onHolder` above, `roomMade`, a question's end below) — three at most for each message of the
  // person's there, the rest held for them in Needs you.
  guidance = createGuidance({
    spaces: spaceStore,
    sessions,
    letters,
    reach: { busy: chatBusy, steer: chatSteer, post: postOwnTurn },
    runOf: (chain) => {
      const m = chainRow(chain)?.meta?.routine;
      return m && typeof m === "object" && m.project && m.id ? { project: String(m.project), id: String(m.id) } : null;
    },
    projectOf: space.projectOf,
    projectName,
    nameOf: (chain) => space.nameOf(chain),
    apart: (chain) => space.apart(chain),
    unwakeable,
    log,
  });
  // The space tool's way to it: a watcher's woken agent sends its guidance through the routine action.
  space.guidance = guidance;
  const stopGuidanceBus = guidance.listen(events);
  // A question a turn paused on that ended with no answer's turn — it lapsed, the person rewound past it — lets no lock
  // go: a run it left under way ends there, and the watchers held back on that chat look again, as at a lock's letting go.
  const stopRoutinesAsks = events.subscribe("compactions", (/** @type {any} */ e) => {
    if (!(e?.type === "question-over" || e?.type === "rewind") || !e.chainId) return;
    routines?.released(String(e.chainId));
    guidance?.released(String(e.chainId));
  });
  // Filament's own events, to the watchers that pick them (the plan of 11-11, its w2). A chat's events wake none where it
  // is of no project, archived, a helper's, another machine's agents', or a routine's own run: no run wakes a watcher —
  // nor while a watcher's turn is at work in it (`hosted`). A chat whose words are its own alone is heard as what
  // happened, under the name its reader reads, with none of what it said (`apart`, `quiet`).
  const watching = createWatchEvents({
    store: spaceStore,
    heard: (project, id, evs) => /** @type {NonNullable<typeof routines>} */ (routines).heard(project, id, evs),
    chatOf: (chainId) => {
      const row = chainRow(chainId);
      if (!row || row.meta?.archived || row.meta?.routine || row.meta?.agentDevice) return null;
      if (![...LISTED_KINDS, "team"].includes(row.kind || "interactive")) return null;
      return { project: row.project_id && row.project_id !== NO_PROJECT_ID ? String(row.project_id) : null };
    },
    nameOf: (chain) => space.nameOf(chain),
    apart: (chain) => space.apart(chain),
    quiet: wordsOwn,
    // …nor while a watcher's guidance turn is at work in it: a turn that only answered guidance is not reviewed again.
    hosted: (chain) => !!routines?.hostOf(chain) || !!guidance?.hosting(chain),
    // The turn's writing rounds alone, as memory's `roundsOf` picks them: no tree is read for a count of files.
    roundsOf: (chainId, turn) => (memory.archive?.roundChanges(chainId, { turn }) || []).filter((r) => r.base !== "move"),
    log,
  });
  watchEvents = watching;
  const stopWatchingBus = watching.listen(events);
  const stopWatchingShells = onShellFailed((e) => watching.shellFailed({ chain: e.session, id: e.id, command: e.command, exit: e.code }));
  // A connection's read-only tool, asked on each watcher's schedule as the person approved it by switching it on (w4).
  const asking = createConnectionWatch({
    store: spaceStore,
    heard: (project, id, evs) => /** @type {NonNullable<typeof routines>} */ (routines).heard(project, id, evs),
    ask: (project, tool, signal) => spaceToolsNow().ask(project, tool, signal),
    log,
  });
  connectionWatch = asking;
  // When a chat's work is its own, kept once for every watcher source that must not hear the chat it would wake: each
  // run's calls and the turns' lock off the bus, the commands in the background from the hands.
  const ownTimes = createOwnTimes({ log });
  const stopWatchingTurns = ownTimes.listen(events);
  const stopWatchingCommands = onShellsChange((chainId) => ownTimes.shells(chainId, runningShellsOf(chainId)));
  /**
   * A project's folders, which a commit watcher's place is held to (app/watchers/commits.js `placeAmong`): its own
   * first, then those its layer adds for its chats to read (`loop.addedFolders`, judged as a chat's are) and the
   * worktrees of its repository the fence allows, as the lanes read them. None where it has no folder.
   * @param {string} project @returns {Promise<string[]>}
   */
  const watchFolders = async (project) => {
    const own = projectFolder(project);
    if (!own) return [];
    /** @type {string[]} */
    let added = [];
    try {
      added = addedFoldersOf(config.get(), memory.archive?.projectSettings(project)?.loop?.addedFolders).folders;
    } catch {
      // The project's settings could not be read: none added, so a place there is not followed.
    }
    const wt = await worktreesOf(own);
    const paths = wt.ok ? wt.worktrees.map((w) => w.path) : [];
    const fenced = await Promise.all(paths.map((p) => allowedFolderSoon(config.get(), p)));
    const trees = paths.filter((_, i) => fenced[i].ok);
    return [own, ...added, ...trees];
  };
  // What a watcher's trigger names, checked as an agent proposes it (the space tool): a commit's place a folder of the
  // project, a connection's tool one its chats have that its server marks read-only.
  space.placeIn = async (project, place) => placeAmong(await watchFolders(project), place);
  space.toolReads = (project, tool) => spaceToolsNow().askable(project, tool);
  // A branch's new commits, within moments of each, caught up after a restart from where each watcher last looked (w3);
  // never a watcher's own: a commit made in its repository while a command of a routine's run, or of the chat it wakes,
  // ran there, as the keeper has it.
  const committing = createCommitWatch({
    store: spaceStore,
    heard: (project, id, evs) => /** @type {NonNullable<typeof routines>} */ (routines).heard(project, id, evs),
    folderOf: projectFolder,
    // A place kept is followed only where it is a folder of its project, as one proposed is taken only so.
    foldersOf: watchFolders,
    chatOf: (chain) => {
      const row = chainRow(chain);
      if (!row) return null;
      return { run: !!row.meta?.routine, folder: memory.archive ? sessions.launchInfo(chain)?.cwd || null : null };
    },
    own: ownTimes,
    log,
  });
  commitWatch = committing;
  // A folder's files that appear, change or go, heard once they are still and caught up after a restart by their times
  // (v2-a); never a watcher's own: a file written by a routine's run, or by the chat it wakes, as the keeper has it.
  const filing = createFileWatch({
    store: spaceStore,
    heard: (project, id, evs) => /** @type {NonNullable<typeof routines>} */ (routines).heard(project, id, evs),
    folderOf: projectFolder,
    foldersOf: watchFolders,
    chatOf: (chain) => {
      const row = chainRow(chain);
      if (!row) return null;
      return { run: !!row.meta?.routine, folder: memory.archive ? sessions.launchInfo(chain)?.cwd || null : null };
    },
    own: ownTimes,
    log,
  });
  fileWatch = filing;
  // A program of the project as a watcher's trigger (v2-c): approved by its content at the person's Switch on, kept up
  // while its watcher is on and checked against that approval before each start, each line it prints an event. It runs
  // as the person, outside any chat's permission mode; the app secrets it names are those the project's kept apps were
  // handed, in its environment alone.
  const scripting = createScriptWatch({
    store: spaceStore,
    heard: (project, id, evs) => /** @type {NonNullable<typeof routines>} */ (routines).heard(project, id, evs),
    folderOf: projectFolder,
    secretsOf: appSecretsOf({ kept: () => spaceStore.keptDashboards(), values: (app) => appSecrets.values(app) }),
    log,
  });
  scriptWatch = scripting;
  // A program's posts to a watcher's own address (v2-b): the address made as the person switches the watcher on, kept
  // beside the Spaces and never in one; its door is the front door's `/watch/`.
  const posting = createWebhookWatch({
    store: spaceStore,
    hooks: createWatchHooks({ dataDir, encrypt: () => config.get().server?.encryptSecrets !== false, log }),
    heard: (project, id, evs) => /** @type {NonNullable<typeof routines>} */ (routines).heard(project, id, evs),
    base: selfBase,
    log,
  });
  webhookWatch = posting;
  // An app's ask run in the background (the owner's of 11-04): a read-only chat of its Space on the Space's model, on the
  // person's press — its sheet's Run it, or Settings › Space's "Run it at once".
  spaceAsks = createSpaceAsks({
    spaces: spaceStore,
    sessions,
    postTurn: postOwnTurn,
    // Its chat marked as an ask's run (`meta.ask`), which its first turn's gate reads (sessions/service.js).
    mark: (chainId, meta) => memory.archive?.mergeMeta(chainId, meta),
    folderOf: (project) => {
      try {
        return memory.archive?.getProject(project)?.cwd || null;
      } catch {
        return null;
      }
    },
    nameOf: (project) => {
      try {
        return String(spaceStore.get(project).own?.name || memory.archive?.getProject(project)?.name || project);
      } catch {
        return project;
      }
    },
    problemOf: (model) => subagentModelProblem(poolName(model)),
    chatModel: (model, effort) => chatEffortOf(model, effort, { cfg: config.get(), families: modelBook.now()?.families || [] }),
    remove: (chainId) => memory.deleteSession(chainId),
    log,
  });
  // Spaces of your own (HarnessV4_SpacesPlugins_Plan A1, A2): a Space that belongs to no project, made as a project
  // whose folder Filament makes for it; what its chats may read is its layer's.
  const ownSpaces = createOwnSpaces({ spaces: spaceStore, memory, config, routines, taskNotes, log });
  // Everything (the owner's of 10-30): the folder of Filament's own, and its project, a chat outside any project works in.
  const everything = createEverything({ dataDir, memory, config });
  // Where a plugin is on (B3, B5): your defaults', a project's or a chat's `plugins.on`, through each layer's writer.
  const ownName = (/** @type {string} */ id) => {
    try {
      return spaceStore.get(id).own?.name || null;
    } catch {
      return null;
    }
  };
  const pluginPlaces = createPluginPlaces({ sessions, memory, config, ownName });
  // Where a skill is on (HarnessV4_Skills_Plan S1-6): the same places, `skills.on`.
  const skillPlaces = createSkillPlaces({ sessions, memory, config, ownName });
  // The connectors' picker (the owner's word of 10-26): the marketplaces' plugins that bring an MCP server, Add one in a
  // press; what each brings looked at in the background and kept in the data folder.
  const connectorCatalogue = createConnectorCatalogue({ dataDir, sources: pluginSources, plugins, places: pluginPlaces, log });
  // Flows beside a chat (HarnessV4_Flow_Plan F3, F4; HarnessV4_OneAgent_Plan OA3): the person's agents and teams in
  // steps, designed by the main agent after /flow or drawn by hand, each box handed the results of the boxes it needs;
  // kept in Filament's data folder, a file a chat. A flow a restart cut waits for the person's Go on (FL-D19); its holds
  // come to find them as alerts.
  const savedFlows = createSavedFlows({ dataDir, log });
  const flows = createFlowRunner({
    store: createFlowStore({ dir: dataDir ? join(dataDir, "flows") : null, log }),
    archive: () => {
      if (!memory.archive) throw Object.assign(new Error(`no archive: flows need it. ${memory.archiveWhy()}`), { status: 409 });
      return memory.archive;
    },
    registry: () => subagents,
    besides: () => besides,
    sessions,
    roster: () => ({
      // A team's own Lead is its team's (OA-D4): never a box by itself.
      cards: agentCards.list().filter((c) => !c.partOf).map((c) => ({ tag: c.tag, name: c.name, goodFor: c.goodFor, may: c.may })),
      teams: teams.list().map((t) => ({ key: t.key, name: t.name, line: t.line, readOnly: t.readOnly === true })),
    }),
    postTurn: postOwnTurn,
    events,
    alert: (text, key) => pushAlert("flow", text, key),
    log,
    saved: savedFlows,
    here: (folder) => !!folder && existsSync(folder),
    // A chat with no folder has nothing to count; one whose folder is gone is a count that failed, said in git's words.
    uncommittedOf: async (chainId) => {
      const cwd = sessions.launchInfo(chainId)?.cwd;
      return cwd ? leftBehind(cwd) : { ok: true, count: null };
    },
    teamsOn: () => teamsOn(config.get()),
  });
  flowRunner = flows;
  /** The open under way, until it ends: a stop waits for it before it closes memory. @type {Promise<boolean> | null} */
  let openingNow = null;
  /**
   * Set by a stop once it has waited for an open under way (its end, or 3 s), before it notes the turns the open kept
   * and closes memory: from then on the open keeps no turn and settles nothing more, and what it has not settled stays
   * on disk for the next start.
   */
  let memoryClosing = false;
  /** How many sub-agent runs, left open with an end that could not be written, a chat keeps that it was told of. */
  const LEFT_OPEN_TOLD = 50;
  /**
   * Memory opens once Filament listens (`start`), and what the last stop left is settled with it, in this order; the
   * run files are read off the event loop. Each request that reads memory waits for its end at the front door
   * (`opening`): none reads the archive before it is open, or a chat before what the stop cut is settled in it. Nothing
   * opens once a stop is asked for, and an open still going when a stop has waited for it settles nothing more
   * (`memoryClosing`): what it has not settled stays on disk for the next start. → whether it went over every run the
   * last process left open, the sub-agents' and the turns': false where a stop cut it short or a scan failed, and the
   * run log's sweep keeps those files for a start that does.
   */
  const openMemory = async () => {
    if (draining) return false;
    try {
      memory.start();
    } catch (/** @type {any} */ e) {
      log("warn", `memory: could not start: ${e.message}`);
    }
    // A Space whose project was deleted before its Space went with it (A5): what runs by itself there is paused once the
    // archive is open to say which projects are known, and before the watches are armed, so nothing fires where nobody
    // sees it — the routines start later, after this (found by the Hunter on A5: the watches looked first).
    for (const p of spaceStore.projects())
      try {
        if (!memory.archive || memory.archive.getProject(p)) continue;
        const n = spaceStore.pauseGone(p);
        if (n) log("info", `spaces: paused ${n} thing${n === 1 ? "" : "s"} that ran by itself in the Space of ${p}: its project is gone`);
      } catch (/** @type {any} */ e) {
        log("warn", `spaces: the Space of ${p}, whose project is gone, could not be paused (${e?.message || e})`);
      }
    try {
      dashboards.start();
    } catch (/** @type {any} */ e) {
      log("warn", `dashboards: their watches could not be armed (${e?.message || e})`);
    }
    // BUG-26's crash case: a stop that never ran (a crash, a killed process) cut no sub-agent and told no session. A
    // sub-agent run left open on disk died with that process: its session hears it once, and its run's end is written,
    // so the next start finds nothing to tell. A run whose end cannot be written (runs kept in memory alone, a file that
    // refuses the write) is found again at each start: its chat keeps the runs it has had its word on (`leftOpenTold`) —
    // told then, or found told already (a notice a graceful stop left) — so it hears each once, and the run log's sweep
    // removes the file in time. Each run is settled on its own.
    let wentOver = true;
    /** @type {import("./services/runs.js").OpenRun[]} */
    let left = [];
    try {
      left = await runs.openOnDisk("subagent");
    } catch (/** @type {any} */ e) {
      wentOver = false;
      log("warn", `sub-agents: the runs left open by the last stop could not be read (${e.message})`);
    }
    if (memoryClosing) return false;
    for (const o of left)
      try {
        const chain = String(o.meta?.chain ?? "");
        const told = chain ? memory.archive?.metaOf(chain, ["leftOpenTold"])?.leftOpenTold : null;
        const toldBefore = Array.isArray(told) && told.map(String).includes(o.id);
        if (!toldBefore) subagents.orphaned({ runId: o.id, chainId: chain || null, brief: o.brief, agentId: o.meta?.subagent ?? null, rounds: o.rounds });
        if (!runs.closeOnDisk(o.id, { status: "aborted", summary: { error: LEFT_OPEN } }) && chain && !toldBefore) memory.archive?.appendMeta(chain, "leftOpenTold", o.id, LEFT_OPEN_TOLD);
      } catch (/** @type {any} */ e) {
        log("warn", `sub-agents: the run ${o.id} the last stop left open could not be settled (${e.message})`);
      }
    // A sub-agent on another machine has no run on disk here: one whose exchange that process left open is found in the
    // threads its chat keeps, and its turn there is sent its stop (`recallCut`) — none runs on there unwatched until
    // someone opens its chat here.
    try {
      subagents.recallCut(memory?.archive?.chainsCutThere() ?? []);
    } catch (/** @type {any} */ e) {
      log("warn", `sub-agents: the turns on other machines the last stop left open could not be found (${e.message})`);
    }
    // A turn that process cut off left its work in its run log alone: its turn gets it, and its run's end is written
    // (HarnessV4_Tasks A2), so the session's next message reads the turn with its work. None is kept once a stop has
    // waited for the open (`memoryClosing`).
    try {
      const cut = await keepCutTurns({ runs, archive: memory?.archive ?? null, log, onKept: (k) => keptAtStart.push(k), stop: () => memoryClosing });
      if (cut.kept) log("info", `sessions: ${cut.kept} turn${cut.kept === 1 ? "" : "s"} the last stop cut off got the work the run log holds of ${cut.kept === 1 ? "it" : "them"}`);
    } catch (/** @type {any} */ e) {
      wentOver = false;
      log("warn", `sessions: the turns the last stop cut off could not be settled (${e.message})`);
    }
    if (memoryClosing) return false;
    // A clean stop's turns (TG2-D85): its drain refuses every new model call, so a turn between rounds failed rather than
    // being cut. The chats it noted whose newest turn has no reply go on too; a chat both found goes on once. A stop
    // that came first read the note already, and left it for the next start (`noteAtStop`).
    try {
      if (!noteRead) {
        noteRead = true;
        const noted = takeRunningAtStop(dataDir);
        if (noted) keptAtStart.push(...stoppedTurns({ archive: memory?.archive ?? null, runs, chains: noted.chains }));
      }
    } catch (/** @type {any} */ e) {
      log("warn", `sessions: the turns the last clean stop noted could not be read (${e.message})`);
    }
    // What the chats were owed a wake for as Filament last stopped (sessions/owed-wakes.js, the nudge map of 11-10): given
    // back before any turn can begin — what waited untold, each come-back and idle check-in, a goal's round —, and the
    // chats owed one now wait for the sweep once the cut turns went on (`sweepOwed`). Read before the restart's word of
    // its commands is told below: that word is kept with the chat over what it kept, and wakes nothing.
    if (memory.archive)
      try {
        const rows = owedKeeper.kept();
        for (const r of rows) {
          // Each by the id it is told under: an idle check-in's is its timer's (idle-wake.js `fire`).
          restoredAtStart.set(r.chainId, new Set([...r.owed.untold.map((x) => x.id), ...(r.owed.comeBack ? [r.owed.comeBack.id] : []), ...(r.owed.idle ? [`idle-${r.owed.idle.id}`] : [])]));
          if (r.owed.comeBack) comeBackAtStart.set(r.chainId, r.owed.comeBack.at);
        }
        const owed = restoreOwed(rows, { keepUntold, keepComeBack, restoreIdle: (chainId, k) => idleWake.restore(chainId, k), oweGoal: (chainId) => sessions.oweGoal(chainId), kept: keepOwed, log });
        for (const chainId of owed) wakeSoon(chainId);
      } catch (/** @type {any} */ e) {
        log("warn", `sessions: what the chats were owed a wake for as Filament last stopped could not be read (${e?.message || e}); their next turns carry what came`);
      }
    if (memory.archive)
      try {
        const ended = tellStoppedCommands(memory.archive);
        if (ended) log("info", `background commands: ${ended} running as Filament last stopped, told to their chats with their next turn`);
      } catch (/** @type {any} */ e) {
        log("warn", `background commands: what ran as Filament last stopped could not be read (${e?.message || e}); no chat is told of it`);
      }
    try {
      const cut = flows.reconcile();
      if (cut) log("info", `flows: ${cut} flow${cut === 1 ? "" : "s"} the last stop cut wait${cut === 1 ? "s" : ""} for the person's Go on`);
    } catch (/** @type {any} */ e) {
      log("warn", `flows: what the last stop cut could not be settled (${e.message})`);
    }
    // A thread's start a stop left unsettled (app/threads.js): one that never got its brief is taken back, and one
    // that owes its starter its first reply owes it again.
    if (memory.archive)
      try {
        const left = threads?.reconcile() ?? { back: 0, owes: 0 };
        if (left.back || left.owes) log("info", `threads: ${left.back} that never got a brief taken back, ${left.owes} owing a first reply`);
      } catch (/** @type {any} */ e) {
        log("warn", `threads: the starts the last stop left unsettled could not be read (${e?.message || e})`);
      }
    // A sync that waited for a chat's turn when Filament stopped went nowhere: its lanes say so.
    try {
      const dropped = spaceStore.dropWaiting("Filament started again before the chat's turn ended, so it was not sent: run the sync again");
      if (dropped) log("info", `space: ${dropped} lane${dropped === 1 ? "" : "s"} of a sync waited when Filament stopped; ${dropped === 1 ? "it says" : "they say"} so`);
    } catch (/** @type {any} */ e) {
      log("warn", `space: the syncs left waiting could not be read (${e.message})`);
    }
    // A graph task a stop cut fails, and its session hears it with its next turn (HarnessV3-TaskGraph G2-9).
    try {
      const told = graphs.reconcile();
      if (told) log("info", `task graphs: ${told} session${told === 1 ? "" : "s"} will hear what the last stop cut`);
    } catch (/** @type {any} */ e) {
      log("warn", `task graphs: what the last stop cut could not be settled (${e.message})`);
    }
    return wentOver;
  };
  // Replay-compare (HarnessV2 §10.6): a session's last turns replayed on a copy under other settings, as a run.
  const replayCompare = createReplayCompare({
    sessions,
    archive: () => {
      if (!memory.archive) throw new Error(`no archive: native sessions need it. ${memory.archiveWhy()}`);
      return memory.archive;
    },
    usage,
    runs,
    events,
    config,
    log,
    selfBase,
  });

  // ----------------------------------------------------------------------------------------------
  // Admin API: one route table over the five areas (http/admin/*), behind the loopback/token and CSRF guards.
  // ----------------------------------------------------------------------------------------------

  // Settings › MCP servers (HarnessV4_Settings_Plan HS-1): each place's list, written one server at a time. Import from
  // other apps reads Claude Desktop's file under APPDATA and Codex's under CODEX_HOME where they are set. A Space's
  // dashboards reach a project's servers through it too (HarnessV4_Space_Plan S4a).
  mcpServers = createMcpServers({ sessions, memory, config, tests: mcpTests, appData: process.env.APPDATA || "", codexHome: process.env.CODEX_HOME || "", signIns: mcpSignIns,
    ownName: (id) => { try { return spaceStore.get(id).own?.name || null; } catch { return null; } },
    // A place's list shows the servers its plugins on bring (the Designer's of 10-26), marked with their plugin.
    pluginServers: (p) => plugins.serversAt(pluginPlaces.onAt(p.scope), { project: p.projectId, chat: p.chainId, cwd: p.cwd }).map((s) => ({ ...s, onPlace: pluginPlaces.placeOn(s.plugin, p.scope) })) });
  const handleAdmin = createAdminHandler({
    config,
    log,
    usage,
    ops,
    memory,
    health,
    bridge,
    agentBridges,
    accounts,
    logins,
    codingAgents,
    mcp,
    mcpServers,
    mcpSignIns,
    // Settings › Providers (HS-2): one provider added, changed or removed against the configuration as it stands.
    providers: createProviders({ config, usage, machines }),
    assistant,
    alerts,
    events,
    runs,
    changesKept,
    liveWords,
    terminal,
    browsers,
    browserHost,
    sseClients,
    liveAborts,
    qoderLogins,
    overrides,
    VERSION,
    startedAt,
    dataDir,
    supervisor,
    machine,
    devices,
    owner,
    remoteCopies,
    transfers,
    remoteWork,
    selfUpdate,
    cfgForModels,
    discover,
    catalogue: catalogueNow,
    persistModelCache,
    discoveryOf,
    ownNames,
    keyedFor,
    labelsFor,
    dryRun: (input) => dryRunWith(config.get, wireApiFor, input),
    sessions,
    copies,
    teams,
    agentCards,
    artifacts: artifactStore,
    artifactFeeds,
    spaces: spaceStore,
    spaceFiles,
    spaceSync,
    dashboards,
    appSecrets,
    spaceDrafts,
    spacePulls,
    routines,
    guidance,
    scriptWatch: scripting,
    webhookWatch: posting,
    spaceAsks,
    secondLook,
    besides,
    letters,
    stillOpen,
    // A worktree removed or put back, Filament's copies cleaned up (http/admin/git.js): what each chat's Still open says
    // of its folder is read anew at the next look, not minutes on (the reviewer's of 11-10).
    openMoved: () => {
      holdsRead.clear();
      stillOpen.moved();
    },
    flows,
    savedFlows,
    spaceNames: space.nameOf,
    spaceApart: space.apart,
    // What an `@#` in the message box lists: the project's names, by the language servers the loop keeps warm.
    projectSymbols: (query, o) => agentLoop.symbols(query, o),
    ownSpaces,
    everything,
    pluginSources,
    plugins,
    pluginPlaces,
    skillStore,
    skillPlaces,
    skillLibrary,
    crafterChats,
    connectorCatalogue,
    subagentModelProblem,
    subagentModelFacts,
    subagents,
    graphs,
    taskNotes,
    // A coding agent's own agents, read from the session's turns' runs for the session's list (E15 step 5).
    guests: createGuests({ runs, turnRuns: (chainId, limit) => sessions.turnRuns(chainId, limit) }),
    sessionTurns,
    // Every session's coding-agent tasks now (`bridge.onTasks` above): an idle-only stop waits for the agents among them.
    agentTasksNow: () => [...agentTasks.values()].flat(),
    // The sessions whose coding agent's own agents work now: a worktree they work in is not removed (GW-D39).
    agentWork: () => [...agentTasks].filter(([, tasks]) => tasks.some((t) => AGENT_WORK.has(t.kind))).map(([chain]) => chain),
    footprint,
    sessionWriters,
    replayCompare,
    destinationFor,
    environment: deps.environment,
    stopApi: () => api.stop(),
    // The stop's first step, taken the moment one is asked for: no model request and no session turn starts after it.
    // What runs by itself stops first (r-itself, 11-12): a turn sent through a door about to close is refused, and
    // what a watcher hears from here on waits in its Space for the next start.
    drain: () => {
      routines?.stop();
      draining = true;
    },
    isDraining: () => draining,
    listening: () => listening,
    // The network's listener (services/lan-tls.js), made below with the servers: asked only once a request comes.
    lan: () => lan,
    // The artifacts' network address (http/artifacts.js `artifactsListener`), where /state says a page reads them.
    artifactsNet: () => artLan,
    // Filament on the tailnet (services/tailscale.js `createTailnetShare`), made below with the servers.
    tailnet: () => tailnet,
    // Anonymous telemetry (services/telemetry.js), made below with the alerts' timer.
    telemetry: () => telemetry,
    // Windows Firewall as admin/remote.js reads and changes it: tests answer for it.
    ...(overrides.firewall ? { firewall: overrides.firewall } : {}),
    selfPort,
    selfBase,
    onShutdown,
  });

  // A copy idle a week goes once memory has opened, so the chats in it go with it (http/admin/sessions.js hears it),
  // then every hour; a folder a removal left is removed again with it.
  /** @type {ReturnType<typeof setInterval> | null} */
  let copiesSweep = null;

  // Watched conditions, checked quietly in the background: a degraded memory engine and today's spend.
  const alertTimer = setInterval(() => {
    try {
      if (config.get().alerts?.degraded !== false && memory.engineLive().state === "degraded")
        pushAlert(
          "memory",
          "the memory engine is degraded: recall runs on the archive alone until it restarts (Probe or Update on the Memory page)",
          `memory-degraded:${Math.floor(Date.now() / 3600_000)}`,
        );
      const cap = Number(config.get().alerts?.dailyCostUsd) || 0;
      if (cap > 0) {
        const today = usage.dailyStore.list({ limit: 1 })[0];
        if (today && (today.cost || 0) >= cap)
          pushAlert(
            "budget",
            `today's client spend is $${(today.cost || 0).toFixed(2)}, past the $${cap} alert`,
            `budget:${today.day}`,
          );
      }
    } catch {}
  }, 30_000);
  alertTimer.unref?.();

  // Anonymous telemetry (services/telemetry.js): armed by bin/filament.js alone, so a test's Filament never sends. On by
  // default in an official build alone (its build-info.json says so) or where FILAMENT_TELEMETRY=1 asks for it; off by
  // default in a checkout and any other build, where the person's own switch turns it on.
  const installKind = (() => {
    if (supervisor === "desktop") return "desktop";
    if (supervisor === "systemd") return "server";
    try {
      if (JSON.parse(readFileSync(join(__dirname, "..", "build-info.json"), "utf8"))?.kind === "server") return "server";
    } catch {}
    return isCheckout() ? "checkout" : "other";
  })();
  // The Windows installer's no, asked before this first start: the setting, where the person has chosen nothing yet.
  if (takeInstallChoice(dataDir) && typeof config.get()?.telemetry?.enabled !== "boolean") changeFields(config, { set: { "telemetry.enabled": false } });
  const telemetry = createTelemetry({
    dataDir,
    armed: !!sendsTelemetry,
    onByDefault: officialBuild(join(__dirname, "..")) || process.env.FILAMENT_TELEMETRY === "1",
    config,
    usage,
    events,
    log,
    markSeen: () => changeFields(config, { set: { "telemetry.noticeSeen": true } }),
    context: () => {
      const intl = Intl.DateTimeFormat().resolvedOptions();
      return { version: VERSION, platform: process.platform, arch: process.arch, install: installKind, locale: intl.locale, timeZone: intl.timeZone };
    },
    features: () => {
      const cfg = config.get();
      const n = (/** @type {() => number} */ f) => {
        try {
          return f();
        } catch {
          return 0;
        }
      };
      return {
        memory: cfg.memory?.enabled !== false,
        lan: cfg.server?.lan?.enabled === true,
        tailscale: cfg.server?.tailscale?.serve === true,
        artifacts: n(() => artifactStore.list().length),
        spaces: n(() => spaceStore.projects().length),
        machines: n(() => machines.list().length),
        devices: n(() => devices.list().filter((d) => !d.revokedAt).length),
      };
    },
  });

  const responsesDoor = createResponsesFrontDoor({ config, pipeline });
  // The most a request may take to arrive whole, its headers and its body: Node's own default, five minutes. A request
  // still arriving past it has its socket closed — a 408 on it where nothing was written there yet — so a client that
  // sends a byte a minute holds no socket and no handler. It times the request alone: an answer that streams for
  // longer — a model's reply, an event stream, a WebSocket once upgraded — is never cut by it. Node looks at its clocks
  // every 30 s, or as often as a shorter deadline needs.
  const requestMs = Math.max(1000, Number(overrides.requestMs) || 300_000);
  // The artifacts' pages, at their own addresses: this machine's `<name>.art.localhost`, and the network's (below).
  const artifactsAnswer = createArtifactsHandler({ store: artifactStore, server: () => config.get().server, port: selfPort, feeds: artifactFeeds, dashboards, sql: appSql });
  const frontDoor = createFrontDoor({
      config,
      log,
      deps,
      pipeline,
      responsesDoor,
      mcp,
      memoryMcp,
      connectors,
      admin: handleAdmin,
      artifacts: artifactsAnswer,
      hooks: createHookDoor({ dashboards, server: () => config.get().server, log }),
      watchHooks: createWatchHookDoor({ watch: posting, server: () => config.get().server, log }),
      opening: () => (opened ? null : openedAtStart),
      isDraining: () => draining,
      VERSION,
      startedAt,
      machine,
      devices,
    });
  // A model call sending a device's token — another machine's agents through an SSH tunnel — passes the network's door
  // here too (front-door.js `mainDoor`).
  const server = http.createServer({ connectionsCheckingInterval: Math.min(30_000, requestMs) }, mainDoor(frontDoor, { devices }));
  // Three WebSockets: a desktop app's browser host (HarnessV4_Browser_Plan BR-D2; a viewer's app, b-remote), a page's
  // run follows (one socket a page, so its followed runs hold none of the browser's six connections to this host — and
  // the chats' browsers cast live to a page with no app of its own to show them, another machine's), and the terminal's
  // stream — which answers every other upgrade, refusing what is none of them. A viewer's app's link carries its pages'
  // streams to this machine's loopback (b-tunnel), never to a port Filament listens on.
  const hostUpgrade = browserUpgrade({ config, browserHost, devices, tunnels: tunnelsFor({ places: ownPlaces, name: () => machine.get().name }) });
  const runsUpgrade = runSocketUpgrade({ config, runs, liveWords, sseClients, devices, browsers });
  const termUpgrade = terminalUpgrade({ config, terminal, devices });
  // An upgrade whose target no address reads is refused on the raw socket before any of them parses it: a throw there
  // would leave the socket open and unanswered.
  server.on("upgrade", (req, socket, head) => {
    if (!URL.canParse(String(req.url || ""), "http://localhost")) {
      socket.write("HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\nthe request's target is no address");
      return void socket.destroy();
    }
    void (hostUpgrade(req, socket, head) || runsUpgrade(req, socket, head) || termUpgrade(req, socket, head));
  });
  server.requestTimeout = requestMs;
  server.headersTimeout = Math.min(120000, requestMs);
  server.keepAliveTimeout = 65000;
  // Reach this machine on my network (the owner's remote Filament of 11-06, Part 2): an https listener of its own,
  // behind the network's door (front-door.js `lanDoor`), with the run socket, the terminal's stream and the browser host
  // — there a viewer's app's alone, by its full device's sign-in (b-remote). On and off as server.lan says, once
  // Filament listens.
  const lan = createLanListener({
    dataDir,
    handler: lanDoor(frontDoor, { devices }),
    upgrade: (req, socket, head) => {
      if (!URL.canParse(String(req.url || ""), "http://localhost")) return void socket.destroy();
      void (hostUpgrade(req, socket, head) || runsUpgrade(req, socket, head) || termUpgrade(req, socket, head));
    },
    name: () => machine.get().name,
    log,
    ...(overrides.lanHost ? { host: overrides.lanHost } : {}),
  });
  // The artifacts on the network (the owner's remote Filament of 11-06, Part 4): one https address of their own at the
  // listener's port + 1, its certificate, for this machine and the devices paired alone — on and off with it.
  const artLan = artifactsListener({
    dataDir,
    answer: artifactsAnswer,
    server: () => config.get().server,
    devices,
    name: () => machine.get().name,
    log,
    ...(overrides.lanHost ? { host: overrides.lanHost } : {}),
  });
  // Share on my tailnet (the owner's remote Filament of 11-06, Part 2): tailscale serve hands Filament's pages, behind
  // the network's door, and the artifacts' network address to doors of their own on loopback — on and off as
  // server.tailscale says, once Filament listens; its sockets as the network's. Tests answer for Tailscale's command line.
  const tailnet = createTailnetShare({
    handler: lanDoor(frontDoor, { devices }),
    upgrade: (req, socket, head) => {
      if (!URL.canParse(String(req.url || ""), "http://localhost")) return void socket.destroy();
      void (hostUpgrade(req, socket, head) || runsUpgrade(req, socket, head) || termUpgrade(req, socket, head));
    },
    artifacts: artifactsDoor({ answer: artifactsAnswer, server: () => config.get().server, devices, log, passes: createPasses({ key: passKeyIn(dataDir) }) }),
    log,
    memo: fileMemo(join(dataDir, "tailnet-serve.json")),
    ...(overrides.tailnet ?? {}),
  });
  config.onChange((c) => {
    if (!listening) return;
    // The app's browser is told where Filament is reached once its doors have moved.
    void Promise.all([lan.apply(c.server?.lan), artLan.apply(c.server?.lan), tailnet.apply(c.server?.tailscale)]).then(
      () => browserHost.placesMoved(),
      () => {},
    );
  });

  /** The marks' holds' sweep after the start's (`expireMarks`), stopped with Filament. @type {ReturnType<typeof setInterval> | null} */
  let marksSweep = null;
  /** The marks' holds past their time go, in every repository Filament knows (the registry's `expireMarks`); failures logged. */
  const expireMarks = () => subagents.expireMarks(knownFolders()).catch((/** @type {any} */ e) => log("warn", `sub-agents: the marks' holds could not be swept (${e?.message || e})`));
  /**
   * Every repository's helper copies put right as Filament starts (the owner's of 11-09): what an orphan holds kept on
   * its agent's refs, busy ones parked, half-made checkouts gone, past the cap the least recently used let go — in each
   * repository a project or a sub-agent works in. Then the marks' holds past their time go, and the forks of the chats
   * this Filament deleted that stayed are tried again (the review of 11-09). Never blocks the start; a repository that
   * fails is logged, and the rest go on.
   */
  const sweepCopiesAtStart = async () => {
    try {
      const r = await sweepTaskWorktrees(knownFolders(), { keep: () => new Set(subagents.treesInUse()) });
      for (const f of r.failed) log("warn", `git: the helper copies in ${f.folder} could not be put right as Filament started (${f.error})`);
      if (r.gone) log("info", `git: ${r.gone} helper cop${r.gone === 1 ? "y" : "ies"} let go as Filament started, in ${r.repos.length} repositor${r.repos.length === 1 ? "y" : "ies"}`);
    } catch (/** @type {any} */ e) {
      log("warn", `git: the helper copies could not be put right as Filament started (${e?.message || e})`);
    }
    await expireMarks();
    /** @type {string[]} */
    let deleted = [];
    try {
      deleted = [...(memory.archive?.goneChains?.().keys() || [])];
    } catch (/** @type {any} */ e) {
      log("warn", `forks: the deleted chats could not be read, so their forks were not tried again (${e?.message || e})`);
    }
    if (deleted.length) await dropForks(deleted);
  };
  /**
   * What follows the listen, in order: memory opened once the loop has turned (`openMemory`), and the requests waiting
   * at the front door let through; the turns the last stop cut off sent on; memory's engine installed where it is asked for. → what `start`
   * says of memory and the models.
   * @param {Promise<number>} answering  how many models can answer
   */
  const afterListening = async (answering) => {
    // The wakes asked for from here on wait for the sweep below (`wakeSoon`).
    owedAtStart = new Set();
    // A request already in that reads nothing of memory's (the page's files, /api/state) is answered before it opens.
    await new Promise((r) => setImmediate(r));
    let wentOver = false;
    try {
      wentOver = await (openingNow = openMemory());
    } finally {
      opened = true;
      openedNow(wentOver);
    }
    if (!draining && !copiesSweep) {
      void remoteCopies.sweep();
      copiesSweep = setInterval(() => void remoteCopies.sweep(), 3600_000);
      copiesSweep.unref?.();
    }
    if (!draining) {
      // The turns the last stop cut off go on, now that a turn can be sent (HarnessV3-TaskGraph-v2 TG2-D83). The ones that
      // go on stay among the start's turns, which a stop's note holds (`noteAtStop`), until their resume is answered
      // other than by a stop's drain, or fails other than under a stop: one the drain refused, the stop cut, or not
      // answered yet, goes on at the next start. The others' marks say why they wait.
      const plan = resumePlan({ archive: memory?.archive ?? null, kept: keptAtStart, on: config.get().sessions?.resumeAfterRestart !== false, notByItself: (chainId) => sessions.notByItself(chainId) });
      /** @param {(chainId: string) => boolean} out */
      const letGo = (out) => {
        for (let i = keptAtStart.length - 1; i >= 0; i--) if (out(keptAtStart[i].chainId)) keptAtStart.splice(i, 1);
      };
      const going = new Set(plan.map((p) => p.chainId));
      letGo((chainId) => !going.has(chainId));
      /** @param {string} chainId */
      const post = async (chainId) => {
        /** @type {{ status: number, body: any } | null} */
        let r = null;
        try {
          return (r = await postResume(chainId));
        } finally {
          if (!(r ? r.status === 503 && r.body?.restarting : draining)) letGo((c) => c === chainId);
        }
      };
      resumedAtStart = resumeCutTurns({ plan, archive: memory?.archive ?? null, post, log });
      // The chats owed a wake are woken once the cut turns went on, a few seconds apart (the nudge map of 11-10): a chat
      // that went on holds its turn, which carries what came.
      // At most OWED_HOLD_MAX_MS: one cut turn that compacts first holds no chat's wake as long (FabeleHelper's of 11-10).
      const holdMs = Number.isFinite(Number(overrides.owedHoldMs)) ? Number(overrides.owedHoldMs) : OWED_HOLD_MAX_MS;
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let held;
      owedWokenAtStart = Promise.race([resumedAtStart.catch(() => []), new Promise((r) => ((held = setTimeout(r, holdMs)), held.unref?.()))])
        .finally(() => clearTimeout(held))
        .then(() => sweepOwed());
      // The routines begin once the cut turns went on (S6): a run the stop cut and Filament resumed reads as still at
      // work, not failed; the times missed while Filament was off are caught up.
      // A Space whose project is gone was paused as memory opened, before its watches were armed (A5).
      // Not once a stop was asked for meanwhile: its first step stopped them, and nothing begins them again.
      void resumedAtStart
        .catch(() => [])
        .then(() => (draining ? undefined : routines?.start()))
        .catch((/** @type {any} */ e) => log("warn", `routines: could not start (${e?.message || e})`))
        // A watcher's guidance that waited through the restart goes on, once the cut turns did.
        .then(() => guidance?.start())
        .catch((/** @type {any} */ e) => log("warn", `guidance: could not start (${e?.message || e})`));
      spaceMachines.start();
      // Only the process that owns the port installs memory's engine: one that could not listen never does.
      if (autoInstall) memory.armAutoInstall();
      // The copies a crash or the last stop left are put right now, in the background (the owner's of 11-09), not at the
      // next copy taken in their repository; then the marks' holds past their time go, and again every few hours.
      void sweepCopiesAtStart();
      marksSweep = setInterval(() => void expireMarks(), MARKS_SWEEP_EVERY_MS);
      marksSweep.unref?.();
    }
    return {
      answering: await answering,
      // Where memory's engine stands as the server starts: the CLI says when it is installing.
      engine: memory.engineNow(),
    };
  };

  const api = {
    // `memory` is exposed for the same reason `usage`, `ops` and `acp` are: tests and scratch rigs need to reach the
    // service to seed or stub it (e.g. `engineLive()`, which reports the engine's in-flight call count and cannot be
    // made non-zero without a real Mnemosyne sidecar running). Nothing in the request path depends on it.
    get config() {
      return config.get();
    },
    usage,
    ops,
    events,
    runs,
    memory,
    // The turn lock, for the same reason: a test holds a chat's turn the way a harness turn or a move holds it.
    sessionTurns,
    // The native sessions, for the same reason: a test makes a create fail after its worktree was made.
    sessions,
    // The sub-agents' registry, for the same reason: a test calls the agent tool's launch as a turn's loop does.
    subagents,
    // Parallelize tasks for a chat, and whether its writing launches wait on the card, for the same reason: a test reads
    // them as a chat's launches and its agent's prompt do.
    parallelFor,
    holdsWriters: holdsWritersNow,
    // The task graphs' runner, for the same reason: a test puts a chat's graph in place as its tasks tool does.
    graphs,
    // The Spaces and the machines' feeds of them, for the same reason: a test writes a watch's lines as a kept
    // dashboard's watch does, and pulls the feeds now instead of waiting on the clock.
    spaces: spaceStore,
    spaceMachines,
    // A watcher's guidance, for the same reason: a test sends one as a watcher's chat's agent will.
    get guidance() {
      return guidance;
    },
    // The chats' letters, for the same reason: a test writes one as a chat's agent does.
    letters,
    // The worktree templates' copies, for the same reason: a test waits on a copy's end instead of on the clock.
    copies,
    // The copies another machine's agents work in here (services/copies.js), for the same reason: a test takes one as a
    // launch from there does.
    remoteCopies,
    // The providers' health, for the same reason: a test teaches a model a ceiling as a 429 does, the only cap a call
    // holds to.
    health,
    // What the start sent the chats a restart cut a turn off in (TG2-D83): a test waits on it instead of on the clock.
    get resumedAtStart() {
      return resumedAtStart;
    },
    // What the start's sweep did with the chats it owed a wake (sessions/owed-wakes.js), for the same reason.
    get owedWokenAtStart() {
      return owedWokenAtStart;
    },
    // The live-words hub, for the same reason: a test sees that it let go of a turn's words when the turn ended.
    liveWords,
    // What turns owe Filament's next tool answer to their agents, for the same reason: a test counts what a turn owed.
    toolTails,
    // What is still open for each chat's main agent, for the same reason: a test sees that a turn's end let go of its record.
    stillOpen,
    // The coding agents' accounts, for the same reason: a test hears an agent's report as its bridge passes it on.
    accounts,
    // The chats' browsers, for the same reason: a test drives a chat's pages as the browser tool does.
    browsers,
    log,
    // Anonymous telemetry: its state for Settings, and a look now once the notice is shown.
    telemetry,
    acp: bridge,
    mcp,
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.get().server.port, config.get().server.host, () => {
          server.off("error", reject);
          boundAt = /** @type {import("node:net").AddressInfo} */ (server.address());
          const port = boundAt.port;
          config.get().server.port = port;
          listening = { host: config.get().server.host, port };
          // This start's owner key, in its file before the command line finds Filament by the next.
          owner.listen(port);
          // Where the command line finds it (cli/listening.js): its address, its process, its version.
          try {
            writeListening(dataDir, { host: config.get().server.host, port, pid: process.pid, version: VERSION, startedAt: Date.now() });
          } catch (/** @type {any} */ e) {
            log("warn", `the command line's listening.json could not be written (${e?.message || e}): \`filament status\` reads the config's port instead`);
          }
          telemetry.start();
          // A listener open beyond this machine with no folder in agentLoop.roots works, and is said plainly as it starts.
          const exposed = exposedWords(config.get());
          if (exposed) log("warn", exposed);
          // The bash hand's spill files a Filament that was killed before its stop left behind, past their 30 minutes.
          const swept = sweepSpills();
          if (swept) log("info", `removed ${swept} command output file${swept === 1 ? "" : "s"} an earlier Filament left in the temp folder`);
          // The coding agents' folders no install names: an update's old version, an install stopped half way.
          void installs.sweep();
          // The models a sub-agent's launch reads (HarnessV4_Tasks E23): read now, so the first launch finds its
          // model's efforts.
          void modelBook.fresh();
          // How many models can answer, so `--open` lands where the person can start (LD-D1). A catalogue that could
          // not be read is none: the console's Home says why.
          const answering = catalogueNow()
            .then((models) => modelsThatAnswer(config.get(), models).length)
            .catch(() => 0);
          // The network's listener, where server.lan asks for it: a port it cannot have is said on its row, never a
          // start that fails.
          const lanUp = Promise.all([lan.apply(config.get().server?.lan), artLan.apply(config.get().server?.lan)]);
          // The tailnet, where server.tailscale asks for it: Tailscale's command line may take its while, which the start
          // never waits on — Settings › Remote access says how it went.
          void tailnet.apply(config.get().server?.tailscale);
          afterListening(answering).then(
            async (now) => {
              await lanUp;
              resolve({
                host: config.get().server.host,
                port,
                created: config.loaded.created,
                configFile: config.loaded.file,
                lan: lan.state(),
                ...now,
              });
            },
            reject,
          );
        });
      });
    },
    // Stop in order: refuse new model requests, let the turns in flight finish (agent turns take time; cap 20 s), then
    // close the agents and every connection. A chat flowing through Filament at that moment is cut only after the cap.
    stop({ drainMs = 20000 } = {}) {
      // The chats whose harness turn runs now, before the drain fails or cuts them: the next start goes on with them
      // (HarnessV3-TaskGraph-v2 TG2-D85), and with what memory's open has not sent on yet (`noteAtStop`).
      try {
        noteAtStop(sessions.running());
      } catch (e) {
        log("warn", `sessions: the turns running at the stop could not be noted (${e.message})`);
      }
      // The routines and the watchers start nothing more, before the doors close (r-itself, 11-12): until now they
      // stopped once the drain was over, so a turn that ended inside it was heard by its watcher, whose wake the turns
      // route refused (503), and what it heard went with that failure. Heard from here on, it waits in the Space, and
      // the next start's routines take it up; a run under way still has its end read as its chat lets go.
      routines?.stop();
      draining = true;
      // No chat goes on by itself from here: a wake on its way would post to an address that may soon be another's.
      waker.stop();
      goalWaker.stop();
      // Nor does a watcher's program run on through the drain: its tree is stopped at once, and waited for with the watchers below.
      void scripting.stop();
      telemetry.stop();
      // The task graphs start nothing more — a sub-agent launched now could make no call — and their turns stop
      // waiting on them (HarnessV3-TaskGraph G2-9).
      graphs.shutdown();
      // The flows move on no more: what the stop cuts says so at the next start (FL-D19), not as a stop of the person's.
      flows.close();
      // Running sub-agents are cut now, while the drain still lets each end and leave its session a notice (BUG-26):
      // one mid-call when the cap ran out used to die with the process, unannounced.
      subagents.shutdown();
      const t0 = Date.now();
      return new Promise((resolve) => {
        // Async and awaited: the daily-usage stores write asynchronously now (a synchronous 6.7 MB write blocked the
        // event loop for ~18 ms every 1.5 s under load), so exiting without waiting could cut the last write and lose
        // usage data. Bounded by a race, because a hung filesystem must never stop the proxy from shutting down.
        const finish = async () => {
          // A sign-in under way stops first: Cursor's waiting on its page, Codex's in an app-server about to close.
          await Promise.race([logins.stopAll(), new Promise((r) => setTimeout(r, 3000).unref())]);
          // So does an agent's install: its folder is deleted at the next start.
          codingAgents.stopAll();
          for (const b of agentBridges) b.shutdown();
          // The background shells die with the proxy: a dev server Filament started should not outlive Filament. So do
          // the bash hand's spill files, whose removal timers would die with it (HarnessV3-FixRound F1 item 1). The stop
          // is awaited — on Windows it scans for what Git Bash forked (HarnessV3-Tools TL-D3) — and bounded like the
          // flush below.
          stopWaking();
          stopEnvPass();
          stopLogLost();
          stopWeighingStretches();
          stopTellingCommands();
          stopKeepingCommands();
          stopTellingComeBacks();
          // What the chats are owed a wake for stays kept as it stands: what this stop clears is not theirs to lose.
          stopKeepingUntold();
          stopKeepingComeBacks();
          owedKeeper.stop();
          idleWake.dispose();
          // The teams beside a chat look at no card past here: the archive closes below.
          besides?.close();
          await Promise.race([disposeBackgroundShells(), new Promise((r) => setTimeout(r, 3000).unref())]);
          // A worktree's copy ends where it is, its record saying Filament stopped (HarnessV4_Four_Plan FOC-70).
          await Promise.race([copies.stopAll(), new Promise((r) => setTimeout(r, 3000).unref())]);
          disposeSpills();
          // Flush whatever calibration was learned this run (debounced otherwise) — this instance's file only.
          disposeTokenCalib(calibFile);
          // The catalogue's pending save is written now, and nothing after (an unref'd timer died with the process,
          // or wrote into a data dir already removed).
          closeModelCache();
          // Memory closes once an open under way as the stop came has ended, or after 3 s. An open still going then keeps
          // no turn from here on and settles nothing more (`memoryClosing`, set before the note below, so the note holds
          // every turn the open kept): what it has not settled stays on disk for the next start.
          await Promise.race([openingNow?.catch(() => {}), new Promise((r) => setTimeout(r, 3000).unref())]);
          memoryClosing = true;
          // The turns the open kept since the stop noted its chats, and the resumes not taken yet: the next start goes on
          // with them too.
          if (keptAtStart.length)
            try {
              noteAtStop([]);
            } catch (/** @type {any} */ e) {
              log("warn", `sessions: the turns the start kept could not be noted for the next one (${e?.message || e})`);
            }
          // The watchers that look by themselves stop before memory and the Spaces close: none writes a cursor after.
          asking.stop();
          stopWatchingTurns();
          stopWatchingCommands();
          committing.stop();
          filing.stop();
          // A watcher's program is stopped with its whole tree, which is waited for: it runs as the person, and none outlives Filament.
          await Promise.race([scripting.stop(), new Promise((r) => setTimeout(r, 3000).unref())]);
          posting.stop();
          ownTimes.stop();
          // Awaited BEFORE the flush below. memory.shutdown() now waits for the engine's async stop(), which records
          // the last operation the engine will ever emit; flushing first lost it. Found by watching a real scratch
          // shut down gracefully and finding no stop operation in ops.jsonl.
          try {
            await memory.shutdown();
          } catch {}
          stopCensus();
          runs.close();
          stalls.stop();
          loopHealth.stop();
          spaceStore.stop();
          spaceMachines.stop();
          clearInterval(spaceFilesSweep);
          if (copiesSweep) clearInterval(copiesSweep);
          if (marksSweep) clearInterval(marksSweep);
          // A button running stops with its tree, its run kept as it ended.
          await Promise.race([dashboards.stop(), new Promise((r) => setTimeout(r, 3000).unref())]);
          stopRoutinesAsks();
          guidance?.stop();
          stopGuidanceBus();
          stopSayingWatchers();
          stopWatchingBus();
          stopWatchingShells();
          watching.stop();
          terminal.stopAll();
          // Chrome on this machine, where it held the agent's pages, stops with Filament; so does the look for unused tabs.
          browsers.stop();
          browserHost.stop();
          // The apps' databases are let go with their process.
          await Promise.race([appSql.stop(), new Promise((r) => setTimeout(r, 3000).unref())]);
          // The sessions' MCP servers go with their whole process trees, each close bounded on its own; awaited, so a
          // folder one of them worked in is free when Filament has stopped (HarnessV3-Readiness RD1 d).
          await Promise.race([Promise.all([agentLoop.close(), spaceTools?.close()]), new Promise((r) => setTimeout(r, 3000).unref())]);
          for (const c of sseClients) c.end();
          // Bounded by a race, because a hung filesystem must never stop the proxy from shutting down. The op log is
          // in the race too: the operations most likely to be in flight here are the last ones ever recorded — the
          // "shutdown requested" event itself and anything a finishing job emits during the drain.
          try {
            await Promise.race([
              Promise.all([Promise.resolve(usage.flush?.()), Promise.resolve(ops.flush?.())]),
              new Promise((r) => setTimeout(r, 3000)),
            ]);
          } catch {}
          ops.close();
          try {
            removeListening(dataDir, process.pid);
          } catch {}
          try {
            owner.close();
          } catch {}
          // The network's listener closes with what it holds open: a device's terminal, its stream.
          await Promise.race([Promise.all([lan.close(), artLan.close(), tailnet.close()]), new Promise((r) => setTimeout(r, 2000).unref())]);
          server.close(() => resolve());
          server.closeIdleConnections?.();
          setTimeout(() => {
            server.closeAllConnections?.();
            resolve();
          }, 2000).unref();
        };
        const tick = () => {
          if (usage.live().length === 0 || Date.now() - t0 > drainMs) {
            finish().catch(() => resolve());
          } else setTimeout(tick, 250);
        };
        tick();
      });
    },
  };
  return api;
}

// The config diff lives in services/config/diff.js (Phase 4.2); re-exported for the tests that learned it here.
export { describeDiff } from "./services/config/diff.js";
