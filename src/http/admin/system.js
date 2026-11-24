// @ts-check
// The admin API's system area: what Filament is (/state, /commands), its alerts, what's running right now (/jobs,
// /live), this machine's clones of a repository (/clones), the live event stream, and the graceful stop. Every handler
// gets the request facts (`r`) and the admin context (`a`, built once by the composition root — see index.js).
import { arch, availableParallelism, release, totalmem } from "node:os";
import { sep } from "node:path";
import { sendJson } from "../../app/pipeline/respond.js";
import { guard } from "./guard.js";
import { calibSnapshot, forgetTokenCalib } from "../../services/token-calib.js";
import { configView, serverAddress } from "../../services/config/store.js";
import { exposedWords } from "../../app/agent/turn.js";
import { nestLive } from "../../services/records.js";
import { commandCatalog } from "../../app/commands/registry.js";
import { attachEventsStream } from "../events.js";
import { placeOf } from "../../services/session-writers.js";
import { featureBoard } from "../../app/features.js";
import { systemPromptFor, PROMPT, PROMPT_VERSION } from "../../app/agent/prompt.js";
import { CODER_TASKS_TOOL, ENVELOPE_TOOL, FORK_REFUSALS, REPORT_TOOL, SUBAGENT_OFF, TEAM_AGENT_TOOL, TEAM_WAIT_TOOL, WORKER_TOOL, leadToolSetFor, toolSetFor } from "../../app/agent/tools.js";
import { SUBAGENT_NOTES } from "../../app/agent/subagents.js";
import { instructionsBlock, INSTRUCTIONS_FILE_CAP } from "../../app/agent/instructions.js";
import { environmentText, systemOf } from "../../app/agent/environment.js";
import { SHELL, POWERSHELL } from "../../adapters/tools/shell.js";
import { clonesOf, folderFacts, remoteKey } from "../../adapters/git/inspect.js";
import { MEMORY_TOOL_NAMES, RECALL_TOOL } from "../../app/memory-tools.js";
import { KNOBS } from "../../services/session-settings.js";
import { SHIPPED_CREW, SHIPPED_MEMBERS, memberCard } from "../../core/roster.js";
import { teamsOn } from "../../core/teams-on.js";
import { OWN_WORKERS, shippedCard } from "../../services/agent-cards.js";
import { clip } from "../../core/text.js";
import { startFacts } from "../../app/readiness.js";
import { CODER_GRAPH_TEXT } from "../../app/agent-context.js";
import { workerWords } from "../../app/agent-worker.js";
import { leadWords } from "../../app/agent-lead.js";
import { CONTEXT_HEAD, UPDATE_HEAD } from "../../adapters/agents/context.js";
import { MCP_TOOLS, serverInstructions } from "../mcp.js";
import { AGENT_WORK } from "../../adapters/agents/acp/bridge.js";
import { agentsDevice, isLocalCaller, loopbackTrusted, onTailnetDoor } from "../guards.js";
import { fullControl } from "../../services/devices.js";
import { artifactsAt } from "../../core/artifacts.js";
import { holderPass } from "../artifacts.js";
import { tailnetDoor } from "../../services/tailscale.js";
import { createMachineCaps } from "../../services/machine-caps.js";
import { AGENT_TAKES, agentFolderRefusal } from "./remote.js";

/**
 * The models a placeholder team's members run on, as the lead's lines name them where nothing is set: no card names one,
 * and the pool is its one row, the session's model.
 */
const PREVIEW_MODELS = { members: SHIPPED_MEMBERS.map((tag) => ({ tag, model: null })), pool: [{ model: "«the workers' model»", seats: 4 }] };

/** The folders /clones looks at most: each costs a git run, and a clone two more. */
const CLONE_FOLDERS = 200;

/**
 * @typedef {object} MachineFacts  this machine as an agent of another machine's must know it to work here
 * @property {string} os  the system by the name its owner knows it: "Windows 11 Pro", "macOS 15.1", "Ubuntu 22.04.4 LTS"
 * @property {string} arch  Node's name for it: x64, arm64
 * @property {string} release  the kernel's: "10.0.26200", "24.1.0", "5.15.0-91-generic"
 * @property {{ kind: string, name: string, file: string }} shell  what the bash tool runs its commands in
 * @property {{ kind: string, name: string, file: string } | null} powershell  what the powershell tool runs; null without one
 * @property {string} sep  what parts a path's folders: "\\" on Windows, "/" elsewhere
 * @property {number} cpus  the CPUs Node may run on
 * @property {number} memoryBytes  the machine's memory, all of it
 */
/** @type {MachineFacts | null} */
let factsKept = null;
/**
 * This machine's facts (the remote-agents plan's f-ident): its system as environment.js `systemOf` names it, the
 * shells shell.js chose, and the rest from Node. Read once: none of it changes while Filament runs.
 * @returns {MachineFacts}
 */
const machineFacts = () => {
  const shellOf = (/** @type {{ kind: string, name: string, file: string }} */ s) => ({ kind: s.kind, name: s.name, file: s.file });
  factsKept ||= Object.freeze({ os: systemOf().name, arch: arch(), release: release(), shell: shellOf(SHELL), powershell: POWERSHELL ? shellOf(POWERSHELL) : null, sep, cpus: availableParallelism(), memoryBytes: totalmem() });
  return factsKept;
};
/** This machine's facts as another machine's agents read them: its shells without their programs' paths. */
const theirFacts = () => {
  const f = machineFacts();
  const named = (/** @type {{ kind: string, name: string }} */ s) => ({ kind: s.kind, name: s.name });
  return { ...f, shell: named(f.shell), powershell: f.powershell ? named(f.powershell) : null };
};

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function systemRoutes(a) {
  /**
   * A shipped agent as it stands — what you set on it in place included (HarnessV4_ShippedAgents_Plan SA1) — for the
   * prompts shown here. @param {string} tag
   */
  const cardOf = (tag) => a.agentCards?.find(tag) || shippedCard(tag);
  const {
    config,
    usage,
    memory,
    sessions = null,
    alerts,
    log,
    ops,
    VERSION,
    startedAt,
    dataDir,
    supervisor = null,
    machine = null,
    listening = () => null,
    environment = null,
    stopApi,
    drain,
    sessionTurns = null,
    subagents = null,
    agentTasksNow = () => [],
    onShutdown,
    runs = null,
    catalogue = async () => [],
    discoveryOf = null,
    codingAgents = null,
    accounts = null,
    machineCaps = createMachineCaps(),
  } = a;
  /**
   * The coding agents signed in here, by the names Settings › Coding agents gives them: connected, their program here,
   * and an account of theirs on that no agent said is signed out. Never whose accounts they are.
   * @returns {string[]}
   */
  const signedInAgents = () => {
    const on = new Set((config?.get().upstreams || []).filter((/** @type {any} */ u) => u.enabled !== false).map((/** @type {any} */ u) => u.id));
    return (codingAgents?.list().entries || [])
      .filter((/** @type {any} */ e) => e.state === "connected" && !e.gone && e.upstreams.some((/** @type {string} */ id) => on.has(id) && accounts?.view(id)?.signedOut !== true))
      .map((/** @type {any} */ e) => String(e.name));
  };
  /** A run's newest events, for what its turn is doing now (`nestLive`): from the ring, never the file, and an event too
   *  large for a line as its envelope, which carries its type, time, call's id and tool's name. @param {string} id */
  const recentEvents = (id) => {
    const meta = runs?.getRun?.(id);
    if (!meta || meta.endedAt != null) return null;
    return runs.events(id, { since: Math.max(0, (Number(meta.events) || 0) - 200), limit: 200, bodies: false })?.events || [];
  };
  return [
    [
      "GET",
      "/state",
      (r) => {
        // Another machine's agents read what Filament is — its version, this machine, its system —, who they are here
        // (the remote-agents plan's f-fence) and what it takes from them (remote.js AGENT_TAKES): never the
        // configuration, the data folder, the config file or the usage, which serve the person
        // (services/machines/remotes.js `connectRemote` reads the version).
        // Its shells by their kind and name alone: a program's path names whose machine it is (a user's AppData), which
        // theirs do not need (the swarm's review of 11-10).
        if (agentsDevice(r.who))
          return sendJson(r.res, 200, { version: VERSION, platform: process.platform, system: theirFacts(), machine: machine?.get() ?? null, viewer: "remote", device: { id: r.who.device.id, name: r.who.device.name, scope: r.who.scope }, takes: [...AGENT_TAKES] });
        return sendJson(r.res, 200, {
          version: VERSION,
          uptimeMs: Date.now() - startedAt,
          dataDir,
          // The system Filament runs on, in Node's names (win32, darwin, linux): a folder opens in its file manager, which
          // the page names by it — Explorer, Finder.
          platform: process.platform,
          // What an agent of another machine's must know to work on this one — its system, architecture and kernel, the
          // shells its commands run in, its path separator, CPUs and memory (`MachineFacts`) —, read once.
          system: machineFacts(),
          // What starts Filament again after a stop (HC-66): "desktop" (the Filament app), or null when nothing does.
          supervisor,
          // This machine's id and name (services/machine.js), and who reads this answer: "local" — this computer, through
          // no proxy, or a call in Filament's own process, which has no socket — or "remote" (the owner's remote Filament
          // of 11-06). It says; it guards nothing.
          machine: machine?.get() ?? null,
          viewer: r.req?.socket && !isLocalCaller(r.req) ? "remote" : "local",
          // The paired device that reads it, and its scope — the page draws a view-only device's controls off.
          device: r.who?.kind === "device" ? { id: r.who.device.id, name: r.who.device.name, scope: r.who.scope } : null,
          // This computer's calls without its owner key since this start, and the programs that made them
          // (services/owner.js): this computer's to read, which Settings › Remote access and `filament doctor` say —
          // refused under `server.loopbackTrust` "token", answered under "legacy".
          ...(r.who?.kind === "local" && a.owner ? { ownerless: { ...a.owner.said(), refused: !loopbackTrusted(config.get().server) } } : {}),
          // Where it listens since it started; a host or port saved since waits for a restart (HC-67).
          listening: listening(),
          configFile: config.loaded.file,
          // The configuration, and the places whose stored value this secret.key cannot open (`unreadable`).
          ...configView(config),
          // What a draft read from this answer sends back with its save, so a newer change is never quietly undone.
          configVersion: config.version(),
          summary: usage.summary(24 * 3600 * 1000),
          logReach: usage.logReach?.() ?? null, // how far back the request log reaches (R7)
          // Where apps reach Filament now: where it listens, not a host or port saved since — a wildcard host as
          // localhost, an IPv6 one in brackets (`serverAddress`).
          endpoints: {
            anthropic: `${serverAddress(listening() ?? config.get().server)}/v1`,
            openai: `${serverAddress(listening() ?? config.get().server)}/v1`,
          },
          // A listener open beyond this machine with no folder in agentLoop.roots, said plainly (`exposedWords`); null
          // where there is nothing to say. Settings shows it.
          exposed: exposedWords(config.get()) || null,
          // Where this page reads the artifacts (the owner's remote Filament of 11-06, Part 4), by the address it reached
          // Filament at: this machine's `<name>.art.localhost` (an SSH tunnel's too), else the network's artifacts
          // address — null where it does not listen; reached on the tailnet, its artifacts' https port there. A call with no
          // request (Filament's own) says none: the page's own address. This machine's carry the page's pass for every
          // artifact where its programs need the owner key (http/artifacts.js `holderPass`): no frame carries a credential.
          ...(r.req?.headers?.host
            ? {
                artifacts: artifactsAt(String(r.req.headers.host), onTailnetDoor(r.req) ? tailnetDoor()?.artPort ?? null : a.artifactsNet?.()?.state?.()?.listening?.port ?? null, () =>
                  !loopbackTrusted(config.get().server) && r.who && a.artifactPasses ? holderPass(a.artifactPasses(), r.who, config.get().server) : "",
                ),
              }
            : {}),
        });
      },
    ],
    // Get started's steps as the server knows them (HarnessV3-Launch LD-D2): whether a model can answer, memory's state,
    // whether the harness has a task yet. Home and Start here draw them from this one answer.
    [
      "GET",
      "/start",
      guard(async (r) =>
        sendJson(r.res, 200, await startFacts({ cfg: config.get(), models: await catalogue(), memory, discoveryOf })),
      ),
    ],
    // This machine's clones of a repository, named by its remote's URL in any of its forms — its ssh one finds a clone
    // whose remote is https (the remote-agents plan's f-ident): where an agent another machine launches here may work on
    // the same project. The folders looked at are its projects' and its chats' (`chatFolders`), the first CLONE_FOLDERS
    // of them, said with how many there are; each clone once, with its path, HEAD, branch and whether it is dirty. The
    // answer names the repository by its key alone, never by the URL asked, which may hold a token. Another machine's
    // agents' device is answered from the folders its chats may start in alone — the person's own projects and chats,
    // fenced as a chat of theirs is (remote.js `agentFolderRefusal`, its Full control too) —, as the Space feed is: never
    // another device's. A folder the launch names (`cwd`) is read itself, where a chat of theirs may start in it: whether
    // it is there, in git, and a clone of this repository, a subfolder of one its clone (`named`, inspect.js
    // `folderFacts`; null where it may not; the review of 11-10).
    [
      "GET",
      "/clones",
      guard(async (r) => {
        const url = String(r.url.searchParams.get("remote") || "").trim();
        const key = remoteKey(url);
        if (!key) return sendJson(r.res, 400, { error: "name the repository with remote=: its remote's URL, as `git remote get-url origin` prints it" });
        /** @type {string[]} */
        let folders = [];
        const theirs = agentsDevice(r.who);
        try {
          folders = memory?.chatFolders?.(theirs ? { person: true } : undefined) || [];
        } catch {} // no archive: no project or chat is known, so no folder is looked at
        const cwd = String(r.url.searchParams.get("cwd") || "").trim();
        /** Why a chat of theirs may not start in a folder: none for this machine's person. @type {(f: string) => string | null} */
        let fenced = () => null;
        if (theirs) {
          const roots = config.get().agentLoop?.roots || [];
          const person = folders;
          const full = fullControl(a.devices, r.who.device.id);
          const copies = a.remoteCopies?.fenceOf(r.who.device.id);
          fenced = (f) => agentFolderRefusal(f, { dataDir, roots, folders: person, full, ...copies });
          folders = person.filter((f) => !fenced(f));
        }
        const looked = folders.slice(0, CLONE_FOLDERS);
        // One their fence refuses is said with why, for the launch to say before it starts anything (the swarm's review).
        const refused = cwd ? fenced(cwd) : null;
        const named = cwd ? (refused ? null : await folderFacts(cwd, url)) : undefined;
        // A clone is said by its repository's top folder, which may hold the folder looked at from beyond their fence (a
        // home that is a repository, a parent no root lists): such a clone is not theirs, and the folder named is said
        // as itself (the swarm's review of 11-10).
        const clones = (await clonesOf(looked, url)).filter((c) => !fenced(c.path));
        if (named?.path && fenced(named.path)) named.path = cwd;
        return sendJson(r.res, 200, { key, clones, folders: folders.length, looked: looked.length, cap: CLONE_FOLDERS, ...(named !== undefined ? { named } : {}), ...(refused ? { refused } : {}) });
      }),
    ],
    // What this machine has to work with now (the remote-agents plan's p-caps): its CPUs and their load, its memory free,
    // its GPUs (services/machine-caps.js `MachineCaps`), and the coding agents signed in here, by name — what another
    // machine's agents choose where a task runs by. Nothing of whose machine it is: no folder, user, environment or account.
    ["GET", "/machine/caps", guard(async (r) => sendJson(r.res, 200, { ...(await machineCaps.read()), codingAgents: signedInAgents() }))],
    // Everything you can type into a chat, with the words THIS configuration uses (Docs → Commands).
    ["GET", "/commands", (r) => sendJson(r.res, 200, commandCatalog(config.get()))],
    // What the token estimator has learned, per upstream+model (Settings → Observability): the factor each key
    // serves, how many real replies taught it, when it last moved. Read-only — the data itself lives in
    // token-calib.json in the data directory and is learned from receipts only.
    ["GET", "/token-calib", (r) => sendJson(r.res, 200, calibSnapshot())],
    // Forget one key's learning: the factor stops applying (the class-weighted heuristic stands) until new
    // replies teach it again. The key is the snapshot entry's `key` (`upstream::model`) — it carries "::" so it
    // rides the body, not the path.
    [
      "DELETE",
      "/token-calib",
      guard(async (r) => {
        const b = (await r.json()) || {};
        return forgetTokenCalib(String(b.key || ""))
          ? sendJson(r.res, 200, { ok: true, key: b.key })
          : sendJson(r.res, 404, { error: `nothing learned under "${String(b.key || "").slice(0, 80)}"` });
      }),
    ],
    // Every system prompt Filament itself authors, assembled as the next turn would carry it, plus the request's
    // anatomy around it: the three system slots in wire order (memory's shaped system first, the loop's prompt,
    // the project's instructions & skills last), the tools array that follows the system (every available tool
    // with its one-liner — per session the set differs), each sub-agent type's own prompt, and a team's lead's and
    // each worker's (HarnessV3-AtHome P2), and what a coding agent's session is given, whose system prompt is its
    // maker's (HarnessV4_Tasks C18). The loop's prompt
    // is one for every permission mode (the mode is enforced at the tool gate and never touches these bytes).
    // Read-only — the overlay is edited where it lives (agentLoop.systemPrompt, this page); the built-in bytes are
    // versioned.
    [
      "GET",
      "/prompts",
      guard(async (r) => {
        const cfg = config.get();
        const overlay = String(cfg.agentLoop?.systemPrompt || "").trim();
        // Settings › Agent loop's commit trailer, read as the loop reads it for every seat (agent/system.js): the care
        // section's git line.
        const trailer = cfg.sessions?.commitTrailer !== false;
        // The loop offers delegate_read only when a reader model is configured; the preview must match the next
        // real turn's bytes, not a paragraph no request would carry.
        const delegateRead = !!String(cfg.agentLoop?.readerModel || "").trim();
        const root = "«the session's working folder»";
        // The instructions slot is real bytes when a folder can stand in for a session's working folder: the first
        // allowlisted agent root, read with the document's default file list and the same cap the turn applies.
        const folder = (Array.isArray(cfg.agentLoop?.roots) ? cfg.agentLoop.roots : []).map(String).find((f) => f.trim()) || null;
        let instr = /** @type {import("../../app/agent/instructions.js").InstructionsBlock} */ ({ files: [], missing: [], yoursMissing: [], same: [], text: "", hash: null, sessionChars: 0, read: {} });
        if (folder) {
          try {
            instr = instructionsBlock({ instructions: { files: KNOBS["instructions.files"].default } }, folder);
          } catch { /* an unreadable folder previews as empty, said by the fields below */ }
        }
        // The Environment section as this machine writes it for the same folder (the machine alone without one); the
        // model and window lines are a session's, so the preview has none (HarnessV3-SystemPrompt SP-D12).
        const envFacts = environment ? await environment(folder || "").catch(() => null) : null;
        const env = envFacts ? environmentText(envFacts) : "";
        return sendJson(r.res, 200, {
          loop: {
            promptVersion: PROMPT_VERSION,
            overlay,
            // The built-in opening text, exposed so the page's editable entry can pre-fill with it and its
            // copy button can restore it: an overlay whose bytes equal this is saved as empty (the stock
            // prompt, with its report line, stays in force).
            role: PROMPT.role,
            prompt: systemPromptFor({ root, delegateRead, overlay, environment: env, trailer }),
          },
          anatomy: {
            // The wire order the provider caches as one prefix: the system blocks, then the tools, then the history.
            wire: ["the system blocks", "the tools array", "the conversation history: the finished turns whole from the newest compaction on"],
            memory: {
              on: !!memory?.archive,
              tools: cfg.memory?.autopilot?.tools !== false,
            },
            instructions: {
              folder,
              capChars: INSTRUCTIONS_FILE_CAP,
              files: instr.files,
              missing: instr.missing,
              text: instr.text,
              hash: instr.hash,
            },
            tools: {
              loop: toolSetFor({ delegateRead }).map((t) => ({ name: t.name, brief: clip(String(t.description || "").split("\n")[0], 180) })),
              memory: { names: MEMORY_TOOL_NAMES, recall: RECALL_TOOL },
            },
          },
          // A sub-agent's own system prompt, as each of the two workers the agent may always launch — its role,
          // permission and report sentences in the loop prompt's place, its card's words after its role, the
          // project's instructions and skills after it as for the main agent — and the tools it
          // is offered (the loop's without the ones `off` names). A fork has no prompt of its own: it runs on the main
          // agent's system prompt and tools byte for byte, and reads the fork note after the whole conversation.
          subagents: {
            workers: Object.fromEntries(OWN_WORKERS.map((tag) => [tag, systemPromptFor({ root, delegateRead, toolsOff: SUBAGENT_OFF, subagent: true, card: cardOf(tag), environment: env, trailer })])),
            tools: toolSetFor({ delegateRead, disabled: SUBAGENT_OFF }).map((t) => t.name),
            off: SUBAGENT_OFF,
            notes: SUBAGENT_NOTES,
            forkRefusals: FORK_REFUSALS,
          },
          // A team's lead and its workers: the lead's own prompt — its team's name and persona after its role, here
          // a placeholder team's with the four members every shipped team has — and its tools, which only read; each
          // of those members' prompts, written from its card with its team's own line for it, offered the sub-agents' tools. As a session has them
          // where nothing is set: the lead reads along with its workers (`engine.supervise`, HarnessV3-TaskGraph-v2 §12).
          // None while Settings › Experimental's Teams switch is off (core/teams-on.js).
          teams: !teamsOn(cfg) ? null : {
            lead: systemPromptFor({ root, delegateRead, lead: { name: "«the team»", persona: "«the team's persona»", models: PREVIEW_MODELS }, environment: env, supervise: true, trailer }),
            leadTools: leadToolSetFor({ delegateRead, supervise: true }).map((t) => t.name),
            roleMay: Object.fromEntries(SHIPPED_CREW.map((m) => [m.tag, cardOf(memberCard(m))?.may])),
            workers: Object.fromEntries(
              SHIPPED_CREW.map((m) => [m.tag, systemPromptFor({ root, delegateRead, toolsOff: SUBAGENT_OFF, subagent: true, card: cardOf(memberCard(m)), worker: { team: "«the team»", words: "«the team's own line for this worker»" }, environment: env, supervise: true, trailer })]),
            ),
          },
          // A coding agent's session (Claude Code, Codex, Antigravity, Cursor over a bridge): Filament writes none of its
          // system prompt. What it does write for one: the words ahead of the context it gives the session and ahead
          // of a change to it, its MCP server's words as the agent connects, the task graph's words, and the agent's
          // part as a sub-agent, a team's worker (a builder's here: a role changes its role's line) or a team's lead
          // — and the tools it offers over that server.
          coder: {
            head: CONTEXT_HEAD,
            update: UPDATE_HEAD,
            server: serverInstructions({ cwd: root }),
            graph: CODER_GRAPH_TEXT,
            subagent: workerWords({ id: "", card: /** @type {any} */ (cardOf(OWN_WORKERS[0])), readOnly: false, asks: false, team: null, task: null }),
            worker: workerWords({ id: "", card: /** @type {any} */ (cardOf("builder")), readOnly: false, asks: false, team: { name: "«the team»", role: "builder", words: "«the team's own line for this worker»" }, task: null }),
            lead: leadWords({ name: "«the team»", persona: "«the team's persona»" }, { supervise: true, models: PREVIEW_MODELS }),
            tools: {
              graph: CODER_TASKS_TOOL.name,
              report: REPORT_TOOL.name,
              lead: [TEAM_AGENT_TOOL, WORKER_TOOL, TEAM_WAIT_TOOL, ENVELOPE_TOOL].map((t) => t.name),
              hands: MCP_TOOLS.map((t) => t.name),
            },
          },
        });
      }),
    ],
    // The Feature board (HarnessV2 §10.6): every feature with its switch, its state in the session named by
    // `?session=`, a number from the owner's own traffic, and where the evidence lives.
    [
      "GET",
      "/features",
      (r) => {
        const id = String(r.url.searchParams.get("session") || "").trim();
        const archive = memory?.archive || null;
        let session = null;
        if (id && archive?.getChain?.(id)) {
          const { records, capped } = usage?.forChain ? usage.forChain(id) : { records: [], capped: false };
          const truth = memory.sessionTruth(id, { records, capped });
          let settings = null;
          try {
            settings = sessions?.settingsOf ? sessions.settingsOf(id) : null;
          } catch {}
          session = { id, truth, settings };
        }
        return sendJson(r.res, 200, featureBoard({ cfg: config.get(), records: usage.records || [], archive, session }));
      },
    ],
    ["GET", "/alerts", (r) => sendJson(r.res, 200, { alerts: alerts.list })],
    [
      "POST",
      "/alerts/ack",
      (r) => {
        alerts.list = [];
        return sendJson(r.res, 200, { ok: true });
      },
    ],
    // What is running right now, cheaply. The Live tab polls this every 1.5 s; `/api/memory/status` would also answer
    // it, but that rebuilds the whole memory status — `archive.counts()`, the engine's files, the backups' list — for
    // one small field. This reads two in-memory structures.
    [
      "GET",
      "/jobs",
      (r) => {
        const running = [...(memory.jobs || []).values()]
          .filter((j) => j.status === "running")
          .map((j) => ({
            id: j.id,
            kind: j.kind,
            status: j.status,
            startedAt: j.startedAt,
            percent: j.percent || 0,
            message: j.message || "",
            progressEntries: (j.progress || []).length,
          }));
        return sendJson(r.res, 200, { jobs: running, engine: memory.engineLive() });
      },
    ],
    [
      "GET",
      "/live",
      (r) => sendJson(r.res, 200, { active: nestLive(usage.live(), recentEvents) }),
    ],
    // Graceful stop (the tray's Restart uses it): from here no model request and no session turn starts (`drain`),
    // what is in flight finishes, up to 20 s, then Filament exits so the supervisor restarts it. `{ ifIdle: true }`
    // stops it only while nothing is in flight — no request (an outside client's included: its turn between two of
    // its requests holds nothing here), no harness turn holding its chat (one still composing has no request yet), no
    // compaction, no sub-agent at work: Filament's own, which a stop cuts, nor a coding agent's (`AGENT_WORK`), which
    // dies with its process — each between its calls holds no request, and works on after its session's turn ended.
    // Asked and decided in one step here, so a turn that began a moment before the call is never cut: 409 says what
    // held it back, and Filament goes on.
    [
      "POST",
      "/shutdown",
      async (r) => {
        const b = await r.json();
        const inflight = usage.live().length;
        const holders = sessionTurns?.holders() || [];
        const turns = holders.length;
        const compacting = sessions?.compactionsNow().length || 0;
        const working = subagents?.running() || 0;
        const agentTasks = agentTasksNow().filter((/** @type {{ kind: string }} */ t) => AGENT_WORK.has(t.kind)).length;
        if (b?.ifIdle === true && (inflight || turns || compacting || working || agentTasks)) {
          const many = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ rest) => (n ? `${n} ${one}${n === 1 ? "" : "s"} ${rest}` : "");
          // The chats whose turns hold it, named as the sidebar names them, by title or else their first words
          // (HarnessV4_Settings_Plan HC-65): the page says which to wait for.
          const chats = holders
            .map((h) => {
              const id = memory?.archive?.chainIdForKey?.(h.key);
              if (!id) return null;
              const c = memory.archive.getChain?.(id);
              const name = String(c?.title || c?.preview || "").replace(/\s+/g, " ").trim();
              return !name ? "an untitled chat" : name.length > 48 ? `${name.slice(0, 47)}…` : name;
            })
            .filter((t) => t !== null);
          const held = [
            many(inflight, "request", "in flight"),
            `${many(turns, "turn", "running")}${chats.length ? ` in ${chats.map((t) => `“${t}”`).join(", ")}` : ""}`,
            many(compacting, "compaction", "running"),
            many(working, "sub-agent", "working"),
            many(agentTasks, "coding-agent task", "working"),
          ]
            .filter(Boolean)
            .join(", ");
          log("info", `shutdown asked for only while idle; not stopped: ${held}`);
          return sendJson(r.res, 409, { ok: false, inflight, turns, chats, compacting, subagents: working, agentTasks, note: `not stopped: ${held}` });
        }
        drain();
        log("info", `shutdown requested; ${inflight} request(s) in flight`);
        ops.record("config", `shutdown requested with ${inflight} request(s) in flight`, {
          sub: "shutdown",
          level: inflight ? "warn" : "info",
          detail: { inflight },
        });
        sendJson(r.res, 200, {
          ok: true,
          inflight,
          note: inflight ? "finishing the requests in flight first (up to 20 s)" : "stopping now",
        });
        setTimeout(() => stopApi().finally(() => onShutdown()), 50);
        return;
      },
    ],
    [
      "GET",
      "/events",
      // A device revoked, or signed out, hears no more: its stream ends at once (index.js, as every device's request).
      // Where the page is — this computer or a paired machine — is its tab's place: the words say where a chat is open.
      (r) => attachEventsStream(r.req, r.res, a, placeOf(r.who, a.machine?.get?.()?.name)),
    ],
  ];
}
