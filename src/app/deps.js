// @ts-check
// What the application layer is handed by the composition root (server.js): the services and adapters it works with,
// and the few closures over them that more than one use case needs. Every app module takes this object as its first
// argument instead of reaching into `createApp`'s scope, so each one says what it depends on and can be built alone
// in a test. JSDoc only: no runtime code.

/**
 * @typedef {object} AppDeps
 * @property {() => any} config
 *   the live config; a getter because a save replaces the object
 * @property {() => number} [selfPort]
 *   the port Filament listens on now: a port saved since waits for a restart (HarnessV4_Settings_Plan HC-67), so the
 *   configuration's may name one nobody listens on yet
 * @property {() => string} [selfBase]
 *   where Filament reaches itself (services/config/store.js `selfAddress`): the address it listens on now, as a URL —
 *   where its calls to itself go, and the addresses it hands out for its own doors
 * @property {ReturnType<typeof import("./plugins.js").createPlugins>} [plugins]
 *   the plugins installed (HarnessV4_SpacesPlugins_Plan B2, B3): what those on at a chat's place bring — their MCP
 *   servers, skills and commands — joins its settings as the situate stage reads them (`into`)
 * @property {ReturnType<typeof import("./skill-store.js").createSkillStore>} [skills]
 *   your skills (HarnessV4_Skills_Plan S1-6): the files of those on at a chat's place join its settings after the
 *   plugins' (`into`)
 * @property {ReturnType<typeof import("./sessions/mcp-sign-in.js").createMcpSignIns>} [mcpSignIns]
 *   the sign-ins to remote MCP servers (HarnessV4_Settings_Plan HS-7): Filament's own agent's MCP client asks it for each
 *   request's token, and Filament's door adds it to what a coding agent sends a signed-in server
 * @property {import("./sessions/mcp-sign-in.js").ConnectorDoor} [connectors]
 *   the door a coding agent reaches a chat's signed-in connector at (http/mcp-connector.js, the owner's of 11-07)
 * @property {(level: string, ...args: unknown[]) => void} log
 * @property {any} usage
 *   the request records (`UsageStore`): `start`, `firstByte`, `progress`, `finish`, `records`, `byId`
 * @property {any} ops
 * @property {import("../core/ports.js").EventBus} events  what happens, by topic, for every surface that watches
 *   the operation log (`OpLog`): `record(kind, title, opts)`
 * @property {import("../services/runs.js").RunLog} runs
 *   the run log over the bus: `startRun` / `endRun` around a loop, `events` and `subscribe` for the viewer
 * @property {import("../services/live-words.js").LiveWords} [liveWords]
 *   a running agent turn's words, held while it runs (HarnessV3-Launch LD-D16): the turn feeds them as it streams them
 *   to its own page, and a page that joins the turn reads them beside the run's events
 * @property {any} memory
 *   the memory service: situate, prepare, commands, trim, view, the archive, after-reply bookkeeping
 * @property {any} [sessions]
 *   the sessions service (compose, compaction, settings) — late-bound in the composition root, read at call time
 *   (the /autofit command) because the service takes the pipeline the commands run in
 * @property {import("./agent/subagents.js").SubagentRegistry} [subagents]
 *   the process-wide sub-agent registry: agent turns launch from it, a sub-agent's own request is served against it
 * @property {import("../services/machines/index.js").Machines | null} [machines]
 *   the machines this Filament is paired with (services/machines): where it keeps one for its agents, a turn's agent tool
 *   takes `machine` (the remote-agents plan's s-tools)
 * @property {import("../services/devices.js").DeviceStore | null} [devices]
 *   the devices paired with this Filament (services/devices.js): another machine's agents' chat runs Auto as Edit, and
 *   a coding agent at all, as its device's grants say at each call
 * @property {(cwd: string, device?: string | null) => string | null} [agentsFolder]
 *   why another machine's agents' chat without Full control may not work in `cwd`, in words, or null where their fence
 *   lets it (http/admin/remote.js `agentFolderRefusal`), `device` theirs, whose machine's copies they work in: judged
 *   at each of its turns
 * @property {import("./second-look.js").SecondLook} [secondLook]  the Reviewer's second look at a move that asks
 *   (HarnessV4_Space_Plan S3b)
 * @property {(chainId: string | null | undefined) => boolean} [parallelFor]  Parallelize tasks for a chat: its own
 *   switch (`subagents.parallelize`, its card's Always accept in this chat), else Settings › Experimental's
 * @property {import("./agent/graph-runner.js").GraphRunner} [graphs]
 *   the sessions' task graphs (HarnessV3-TaskGraph G2): every change to one goes through it, and it starts, merges and
 *   tells the sub-agents' tasks while a turn with the switch on runs
 * @property {import("../services/teams.js").TeamStore} [teams]
 *   the teams (HarnessV3-AtHome P2): the shipped ones and yours — the engine finds a session's team here, and `/team`
 *   lists them
 * @property {import("../services/artifacts.js").ArtifactStore} [artifacts]
 *   the artifacts (HarnessV4_Artifacts_Plan E18): the pages agents publish with their `artifact` tool
 * @property {import("./agent/space.js").SpaceDeps} [space]
 *   the projects' Spaces (proposal_ux §4.14): the store, and each chat's project, name and switch, which the agents'
 *   `space` tool reads and writes through
 * @property {import("./agent/beside-tool.js").BesideDeps} [beside]
 *   the teams beside the chats (team_v2_plan §5.5): a fire as the main agent's, a chat's list, the teams there are and
 *   each chat's switch, which the main agent's `team` tool goes through
 * @property {import("./agent/flow-tool.js").FlowDeps} [flow]
 *   the flows beside the chats (HarnessV4_OneAgent_Plan OA3): a draft, an edit and a read as the main agent's, and each
 *   chat's switch, which the main agent's `flow` tool goes through
 * @property {import("./agent/thread-tool.js").ThreadDeps} [thread]
 *   the threads (app/threads.js): a start as the main agent's, which chats start them, and each chat's switch, which the
 *   main agent's `thread` tool goes through
 * @property {import("./agent/craft-tool.js").CraftDeps} [craft]
 *   the crafter chats (app/crafter-chats.js): the skill each crafts, made, its books added and its files written
 * @property {import("./agent/still-open.js").StillOpen} [stillOpen]
 *   what is still open in each chat, and what its main agent heard of it (the owner's plan of 11-02, Phase 4): told
 *   again after a compaction, and at a turn's start where it changed since
 * @property {ReturnType<typeof import("./agent-inbox.js").createAgentTurns>} [agentTurns]
 *   the sessions whose coding agent's turn holds a door into the sub-agent registry now — a team's lead's (HarnessV3-ACP
 *   AC6-3), a plain chat's that launches Filament's sub-agents (HarnessV4_Tasks E12 step 2): the turn opens it here,
 *   and Filament's MCP server finds it by the session a tool call comes from
 * @property {ReturnType<typeof import("./agent/tool-tail.js").createToolTails>} [toolTails]
 *   what a coding agent's turn owes the end of Filament's next tool answer to it, where it takes words only once a step
 *   ended (checkpoint.js "tool-answer"): owed by acp-turn.js, taken by agent-tools.js
 * @property {(chainId: string) => readonly import("../adapters/agents/acp/bridge.js").AgentTask[]} [agentTasks]
 *   the tasks a chat's coding agent runs by itself now, as its bridge last said them (Claude's background commands and
 *   agents): a turn that ends with one running is not left with nothing at work (acp-turn.js, d-idle)
 * @property {any} health
 *   the upstream health board, already wrapped so every state change is an operation
 * @property {any} concurrency
 *   the per-upstream concurrency gate
 * @property {(req: import("node:http").IncomingMessage) => boolean} checkInboundAuth
 *   whether the request carries one of the inbound keys (always true when the server does not require one)
 * @property {(req: import("node:http").IncomingMessage) => boolean} [readsEverySession]
 *   whether the request's caller could read every session anyway, as the admin API answers it: naming this machine,
 *   over loopback or with the admin token. Only such a caller names a session to load (services/house.js
 *   `READER_HEADERS`); any other keeps to its own project's sessions — memory's tools, and the `x-filament-chain` of
 *   Filament's own calls for it (the parse stage's `reads`). Left out, every caller keeps to its own
 * @property {(req: import("node:http").IncomingMessage) => Promise<string>} readBody
 *   the request body as text; rejects with `status: 413` past server.maxBodyBytes
 * @property {(upstream: any) => import("../core/ports.js").Destination | null} destination
 *   where a request to this upstream goes — an agent bridge that runs turns, or an answerer of shaped requests —
 *   with its model list and connection test; `null` for an upstream that does not exist
 * @property {(rec: any, patch: any) => void} finish
 *   closes a request record: the store, the failover alert, the upstream's health, in one place
 * @property {Map<string, AbortController>} liveAborts
 *   request id → the controller that stops an in-flight request (the dashboard's stop button)
 * @property {(args: any) => any} plan
 *   upstream + shaped request + headers + URL for one candidate, or `{ error }`
 * @property {(input: any, cfg?: any) => any} dryRun
 *   `plan` against the live config or a draft, in the shape the admin API and the assistant show
 * @property {(upstream: any) => "responses" | "chat-completions"} wireApiFor
 *   which OpenAI-style endpoint an upstream speaks: its setting, else what was detected at runtime
 * @property {Map<string, string>} wireApiDetected
 *   upstreams (wireApi = auto) that turned out to have no /v1/chat/completions; remembered until restart
 * @property {Map<string, { status: number, at: string }>} toolsRefused
 *   models (`toolsRefusalKey`: the upstream and the model name it was sent) that refused memory's tools on a request
 *   that carried none of its own (HarnessV3-AtHome AH-D1); remembered until the upstream changes, or a restart
 * @property {(force: boolean) => Promise<any>} modelsConfig
 *   the config with each agent's and Qoder's discovered model names merged into its upstreams (cached; `force` re-asks)
 * @property {(upstreamId: string, sent: string, tokens: number) => void} [noteAgentWindow]
 *   keeps the window a coding agent named for a model as its turn ended (models-cache.json): Filament's window for it
 * @property {(upstreamId: string, sent: string, tokens: number) => void} [noteOutputCeiling]
 *   keeps the most a model may write at an upstream, as the upstream said refusing more (models-cache.json): every
 *   output question after reads it
 * @property {(upstreamId: string) => { spent?: boolean, freeAt?: number | null, identity?: import("../core/agent-limits.js").Identity | null } | null} [agentAccount]
 *   a coding agent's account as its store reads it now: whether its plan has a spent window, when it is free again,
 *   and whom it said it runs as (HarnessV3-TaskGraph-v2 TG2-D54)
 * @property {(upstreamId: string) => import("../adapters/agents/acp/profile.js").AgentProfile | null} [agentProfile]
 *   what a coding agent declared as it last started (acp/profile.js; Codex's, as its app-server's version reads): whether
 *   it has a compaction of its own (`reportsCompaction`), which a side agent's follow-up past its line is left to
 * @property {(upstreamId: string, served: boolean, said?: string) => void} [agentSignIn]
 *   what a coding agent's turn showed of its sign-in: served, or refused for its account (with its words) — kept for an
 *   agent that doesn't say who it runs as itself (app/agent-logins.js `turnSaid`)
 * @property {() => string} [ownCallFolder]
 *   the folder a call of Filament's own to a coding agent runs in (a summary's writer, HarnessV4_Tasks C33): Filament's,
 *   apart from any project, made when first asked for
 * @property {number} agentHeartbeatMs
 *   silence on an agent stream after which a ping goes out (tests shorten it)
 * @property {ReturnType<typeof import("./browser/registry.js").createBrowsers>} [browsers]
 *   each chat's browser in the desktop app (HarnessV4_Browser_Plan BR1): the `browser` tool's calls run through it
 * @property {((root: string) => Promise<import("./agent/environment.js").EnvironmentFacts>) | null} [environment]
 *   the capture of a folder's Environment section (HarnessV3-SystemPrompt SP-D7) — the real one behind a short cache,
 *   or a fixed one a test hands in (`overrides.environment`); without it the loop's prompt has no Environment
 */

export {};
