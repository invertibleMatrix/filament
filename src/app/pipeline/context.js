// @ts-check
// The request as it travels through the pipeline: one object every stage reads and extends. Stages run in order and
// each says whether the request continues or was answered; the context is what carries their results forward.
// JSDoc only: the object is built in run.js and filled in by the stages.

/** @typedef {import("../deps.js").AppDeps} AppDeps */
/**
 * The client's response, or the Responses front door's proxy over it, which adds two hooks: `rawMode(on)` — the
 * reply is already in the client's shape, pass bytes through untouched — and `noteResponse(resp)` — a finished
 * Responses object to remember for `previous_response_id`.
 * @typedef {import("node:http").ServerResponse & { rawMode?: (on: boolean) => void, noteResponse?: (resp: any) => void }} ClientResponse
 */
/** @typedef {"anthropic" | "openai"} ClientFormat  the two formats the pipeline itself speaks (Responses is bridged) */

/**
 * A body another front door already read and translated: the Responses API's translation, or a native session's
 * composed turn (HarnessV2 D2). The pipeline uses it instead of reading the socket. Consumers key on `api` or on
 * `responsesBody` — never on `pre` merely being set.
 * @typedef {object} PreParsed
 * @property {string} raw
 * @property {any} body
 * @property {string[]} notes  what the front door changed, for the record
 * @property {"responses" | "session"} api
 * @property {any} responsesBody  the original Responses request, for a passthrough to a Responses upstream (Responses only)
 * @property {import("../../core/wire/responses.js").Source[]} [responsesSources]  where the chat body's person and tool
 *   messages came from in `responsesBody.input`: what memory adds to them rides those items to a passthrough
 *   (Responses only)
 * @property {Record<string, string>} [headers]  headers the front door adds to the request's own (lower-case names)
 * @property {any} [composition]  a session turn's composer report (`api: "session"`): the view stage stamps it on the record
 * @property {import("../../core/tokens.js").BlockWeights | null} [weights]  a session turn's: the sessions' keeper of what
 *   the composed body's blocks weigh (`createBlockWeights`, by the archive's names for them), which the loop's turn
 *   weighs its conversation by
 * @property {any} [settings]  a session turn's effective settings document (HarnessV2 §5), resolved by the sessions service:
 *   the situate stage puts it on `sit.settings`, where memory and the loop read their knobs
 * @property {AbortSignal} [signal]  a session turn's own stop (the sessions service's `cancelTurn`): the only thing that
 *   cancels a native turn — its connection closing never does (HarnessV2 D1)
 * @property {{ turns: import("../../services/session-turns.js").SessionTurns, key: string, token: string }} [lock]  the
 *   session turn's lock as the sessions service took it: what the turn waits on before its request is sent — memory's
 *   lookups, a coding agent's start — is said on it, and memory's waits let go from the page (HarnessV3-FailurePoints
 *   §5.1 items 2 and 3)
 * @property {boolean} [runEvents]  a session turn whose page asked for the run's events in its reply (R3)
 * @property {{ from: string, text: string, after?: number }} [handover]  what the model a session moved to is handed with
 *   its first prompt or request (sessions/reattach.js `handoverFor`), from the model that answered last; `after`, the
 *   newest turn the side moved to held already, whose own went unhanded
 * @property {boolean} [unattended]  a session turn nobody is at the page for: Filament's replay of a session in a copy
 *   (HarnessV4_Tasks C26), where a coding agent's request its mode asks about is refused at once
 *   (HarnessV4_Overnight_Plan OV-D34)
 * @property {() => Promise<{ history: any[], id: number, fromTurn: number, toTurn: number, kind: string, method: string, note: string } | { error: string }>} [earlier]  a session turn of Filament's own
 *   loop: room in the whole chat in the middle of the turn (HarnessV4_Tasks C33) — the sessions service compacts the
 *   earlier turns by the session's method and composes the turn again; `history` is every message ahead of the turn's
 *   own, as that composition has them, beside the compaction made (its row's `id`, its turns, kind and method)
 * @property {import("../../adapters/agents/turn-bridge.js").Reseed | "ask"} [reseed]  a session turn on a coding agent:
 *   how its seed is made to fit when the agent refuses it for its size — Filament compacts its copy of the chat and
 *   composes the turn again (HarnessV3-FailurePoints D9); `"ask"` where the message asks before room is made, so the
 *   refusal stays the turn's (HarnessV4_Tasks C26)
 * @property {string | null} [send]  a session turn's: the page's own name for the send (`sendId`), which the turn it
 *   begins or goes on in keeps (the archive's `sends`) — how a page whose reply's head never came knows its turn
 * @property {boolean} [brief]  a session turn's: its message is a thread's brief (core/threads.js), Filament's own —
 *   the turn it begins is marked so (the archive's `brief`), none of the person's to quote
 * @property {import("../../core/turn-by.js").TurnBy | null} [by]  a session turn's: who began it where it is not the
 *   person (core/turn-by.js) — the turn it begins is marked so (the archive's `by`), none of the person's to quote
 * @property {{ upstream: string, sessionId: string, agent: string, tasks: any[], place?: number | null } | null} [ownCycle]  a session turn of
 *   a coding agent's own (HarnessV3-ACP AC3-9): a cycle it began by itself on the session its upstream holds, which the
 *   turn shows; the message is Filament's words for what the agent read. `place`: its user turn in the chat's
 *   history as the session's next prompt counts them, null where unknown
 */

/**
 * @typedef {object} MemoryState
 * @property {any} trace  the timed, content-free trace of memory's steps (null with memory off)
 * @property {any} sit  where this request sits: project, client, session chain (from `memory.situate`) — null where memory
 *   leaves the request out
 * @property {any} [kept]  a session turn — a turn of a chat Filament composes — that Memory settings leave out, situated
 *   all the same so its turn is kept (`sit.leftOut` says why, in their words): memory-prepare has memory keep the turn,
 *   which the chat's history is composed from and its page reads, and nothing else of memory's; a command answered in
 *   it is a turn of the chat too (commands/answer.js). Null elsewhere
 * @property {any} prep  what memory's prepare pass did to the body (null until memoryPrepare ran, or when it stayed out);
 *   a kept turn's says why it is left out (`leftOut`) and is `silent`
 * @property {(rec: any) => void} traceOn  attaches the trace to a record: rebased to its clock, saved on finish
 * @property {number} [localDropped]  how many of Filament's own texts (command answers, cues) situate left out of the
 *   history (HarnessV3 Step 2 D11); memory-prepare puts the count on the record
 * @property {any} [housekeeping]  the title/summary probe situate detected once (Step 3 D12): null when the request
 *   is not housekeeping; a summary probe is a compaction request (the handed stage reads its `kind`)
 * @property {{ settings: any, composed: boolean } | null} [settingsOnly]  a request memory leaves out (no `sit`): its
 *   session's settings all the same, for the loop and a coding agent — null where there is no session or memory
 *   situated it
 * @property {{ chain: string, composed: boolean } | null} [session]  the session the request belongs to, as situate
 *   found it (never made there): the chain Filament's own `x-filament-chain` names, else the one memory identified from
 *   the conversation — memory situating the request or leaving it out, so a harness turn's commands reach their session
 *   either way (commands/answer.js `commandChain`), and so do its own tools (stages/situate.js `turnMemState`);
 *   `composed`: Filament composes its history. Null where none is known
 * @property {() => string | null} [excluded]  why Memory settings leave the request out, in their words
 *   (memory/brain.js `capturedOut`), read when first asked — null where memory situated it or left it out for a reason
 *   of its own; `leftOutOf` (stages/situate.js) says it of the request, `chatLeftOutOf` of its chat, as a coding agent's
 *   turn takes it
 * @property {() => string | null} [excludedOrUnread]  `excluded`, save that a request whose leaving-out could not be
 *   read is said left out: what gives memory's tools to a request memory could not read asks (stages/memory-prepare.js)
 * @property {boolean} [failed]  memory's situate of the request failed: it goes on without memory, in a chat memory
 *   works in unless a Memory setting leaves it out (stages/situate.js `chatLeftOutOf`)
 * @property {string | null} [failedWhy]  why it failed, in its own words, where it did
 * @property {string | null} [down]  why memory missed a request that carries its tools all the same, as every request of
 *   its chat does (stages/memory-prepare.js, t420): a call of theirs is answered that memory is unavailable, never run
 * @property {{ chain: string, deferTo: string } | null} [standIn]  the chat a missed request's filament_recall rides on,
 *   memory having named none for it, and where what its reply cannot carry waits (stages/memory-prepare.js)
 * @property {boolean} [confined]  memory's tools keep to the request's project's sessions, its caller reaching no
 *   others (`reads` false) — whether or not memory situated it: a coding agent's turn is given them either way
 * @property {(() => void) | null} [toolsAdded]  set when memory's tools went on a request that carried none of its own —
 *   or filament_recall alone, where memory's did not: puts its tools back as the client sent them, for the retry when the
 *   model refuses tools (HarnessV3-AtHome AH-D1)
 * @property {"memory" | "recall"} [toolsAddedAre]  which went on (`toolsAdded`): memory's tools, filament_recall beside
 *   them where it rides, or filament_recall alone — what the retry's words name
 */

/**
 * @typedef {object} RequestContext
 * @property {import("node:http").IncomingMessage} req
 * @property {ClientResponse} res
 * @property {ClientFormat} format
 * @property {PreParsed | null} pre
 * @property {number} t0  `performance.now()` at entry
 * @property {string} raw  the body as received
 * @property {any} body  the parsed body; stages that reshape it (memory) replace `messages` in place
 * @property {Record<string, string>} headers  inbound headers, lower-cased, as admitted (services/house.js): a client's
 *   request carries no lineage and no Filament user agent
 * @property {boolean} house  the request is one of Filament's own calls (it presented the house key)
 * @property {import("../../core/tokens.js").BlockWeights | null} [weights]  a call of Filament's own that sent its body as
 *   it is (internal-call.js `sentThrough`): the keeper that weighs the body's blocks by what the blocks they copy
 *   weighed (tokens.js `namedCopies`); null for any other request
 * @property {import("../../services/house.js").SetAside} setAside  what a client's request sent that only a house call
 *   may carry: the headers dropped, and the Filament user agent kept only as unverified
 * @property {boolean} [reads]  whether the caller reaches every session's memory (`readsEverySession`; a house call, as
 *   the request it works for): false keeps its memory tools, and the `x-filament-chain` of Filament's own calls for
 *   it, to its own project's sessions
 * @property {any} requested  the model name parsed: base, suffix effort, original
 * @property {{ model: string, team?: string } | null} agent  the agent loop the model name resolved to (`agent/<model>`),
 *   or null; the engine stage's team lead carries its team's key
 * @property {{ team: string } | null} [lead]  the session's team, led by the coding agent the name reaches (the engine
 *   stage's, HarnessV3-ACP AC6-3): the agent's turn leads it
 * @property {any} route  the route (or the agent loop's synthetic route)
 * @property {string[]} [notes]  what the stages before the record changed about the request — the session's engine
 *   (Step 5 D1) — for the record's notes
 * @property {MemoryState} memory
 * @property {any} rec  the request record, once opened by the route stage (chat commands open and close their own)
 * @property {boolean} failover  whether backups may be tried
 * @property {{ upstream: string, upstreamModel?: string }[]} candidates  the failover order, health-sorted
 * @property {{ abort: AbortController }} client  the controller that stops the upstream call when the client hangs up
 * @property {{ internalCall: boolean, bodiesAllowed: boolean, memAgent: boolean, askedToCompact: boolean, recallTool?: boolean, housekeeping?: boolean }} flags
 *   internalCall: Filament's own call (bodies stay out of the record unless allowed) · memAgent: who answers — the
 *   primary, or the agent a turn of its own goes to — is a coding agent (memory captures only) · askedToCompact: the client asked its model to summarize the conversation ·
 *   recallTool: filament_recall rides the request, as on
 *   every request of a chat Filament runs (the tool loop runs for it even with memory's own tools off) · housekeeping: the
 *   client's own title or summary probe (Step 3 D12), detected once in situate — the stages after it read the flag
 */

/** @typedef {"continue" | "replied"} StageResult */
/** @typedef {(ctx: RequestContext, deps: AppDeps) => Promise<StageResult>} Stage */

export {};
