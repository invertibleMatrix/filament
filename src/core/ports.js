// @ts-check
// The ports: what the application and the pure algorithms ask of the outside world, named as contracts so a fake can
// stand in for the real thing in a test and so no module has to know which service is behind it. A port is added here
// when code that consumes it exists; nothing below is speculative. Like types.js this module has no runtime code.

/** @typedef {() => number} Clock  milliseconds since the epoch, injected so pure code never reads `Date.now()` itself */

/**
 * One call to memory's model. Implemented by the memory service's `callModel`, which routes to memory's model for the
 * chat the call names (`chainId`), records the child request and applies the caller's timeout.
 * @typedef {(call: { system: string, user: string, purpose: string, chainId?: string }) => Promise<string>} Summarizer
 */

/** A cached slice summary as the archive stores it. */
/** @typedef {{ text: string, tokens?: number | null, chars?: number, model?: string | null }} SliceSummary */

/**
 * The per-slice summary cache keyed by content hash (`sliceKey`), so a second compaction over the same turns never pays for
 * the same slice twice. Implemented over the archive's `trim_slices` table; both methods are optional and may throw —
 * the pass treats a failing cache as an empty one.
 * @typedef {{ get?: (key: string) => string | null, put?: (key: string, value: SliceSummary) => void }} SliceCache
 */

/**
 * Where a long pass reports its progress: the compaction's progress, as its chat shows it. `percent` is of the whole
 * pass; `slice`/`slices`/`tokens` are present when a step concerns one slice.
 * @typedef {(p: { step: string, message: string, percent: number, slice?: number, slices?: number, tokens?: number }) => void} ProgressSink
 */

/**
 * The live configuration as the running app sees it: `get()` the current object, `set(next)` replaces it whole
 * (normalised) and tells every subscriber, `save()` writes it, `reload()` re-reads the file, `onChange(fn)` returns
 * the unsubscribe. `loaded` is what loading reported besides the config. A save or a reload moves `version()` on and
 * tells `onSaved`; `at(v)` is what a recent version held, or null once it is too old. `unreadable()` names the places
 * whose stored value this secret.key cannot open, which the file keeps; `save({ forget })` lets those it names go.
 * @typedef {{
 *   dataDir: string,
 *   loaded: { created: boolean, file: string, secretProblems: string[] },
 *   get: () => any,
 *   set: (next: any) => any,
 *   reload: () => any,
 *   save: (o?: { forget?: string[] }) => string,
 *   unreadable: () => string[],
 *   version: () => number,
 *   at: (version: number) => any,
 *   onChange: (fn: (cfg: any) => void) => () => void,
 *   onSaved: (fn: (version: number) => void) => () => void,
 * }} ConfigStore
 */

/**
 * One published event as the bus hands it to its subscribers: `seq` is monotonic across every topic (the run log keeps
 * it with each event of a run); `payload` is exactly what the producer published.
 * @typedef {{ seq: number, ts: number, topic: string, payload: any }} BusEntry
 */
/**
 * The event bus every surface reads from: `publish(topic, payload)` delivers to that topic's subscribers and the
 * `"*"` subscribers, synchronously and in publication order, and keeps nothing; `subscribe` returns the unsubscribe.
 * @typedef {{
 *   publish: (topic: string, payload: any) => BusEntry,
 *   subscribe: (topic: string, fn: (payload: any, entry: BusEntry) => void) => () => void,
 * }} EventBus
 */

/**
 * What a check of an agent's account came to (*Check now*, HarnessV3-ACP AC3-6): whether its plan's windows were read,
 * and the words for what it found — the plan as it was, or why none was read — null where the account it answered says
 * it all.
 * @typedef {{ read: boolean, said: string | null }} AccountCheck
 */
/**
 * The bridge that runs an agent's turns for an upstream — an ACP agent process, Codex's app-server or the Cursor SDK
 * in-process — as the application calls it. A turn outlives one HTTP reply when the agent needs the client's hands, which is why this is
 * a session holder and not a function: `run` starts a turn, `turnForRequest` finds the one a request continues,
 * `resume` / `interrupt` / `drain` / `detach` steer it, and the rest reads or forgets what the bridge remembers.
 * Signing in and out is each agent's own (HarnessV3-ACP AC3-7): `signInWays` names them — a program run in a
 * terminal (an ACP agent's own, else its CLI's), a page in the browser (`signIn`: Codex's app-server, Cursor's SDK,
 * which makes a key; an ACP agent's `authenticate`, whose page it opens itself: no `url`), or a key the person pastes,
 * which `signIn` takes as `key`; a page that can't open names a program instead (its error's `instead`). `signsOut` says whether
 * it has a sign-out of its own; `signOut` may ask for the upstream's key to be forgotten. `letGo` stops an upstream's
 * agent processes, so its next turn starts in its login as it now stands. `listen` shows a cycle the agent began by
 * itself as a turn of the harness chat its session belongs to (HarnessV3-ACP AC3-9): no prompt goes out. `holds` says
 * whether the bridge keeps a session for a harness chat, the one its next turn goes on in (HarnessV4_Tasks C26).
 * `summarizes` says how the agent can write Filament's summary of a harness chat from the session it holds open — in a fork of it,
 * or in the session itself — or that it can't (null); `summarize` has it write one (HarnessV3-ACP AC5-4). `compacts`
 * says whether the agent compacts that session itself when asked — keeping a fork of it from before, or not — or that
 * it can't (null); `compactOwn` has it compact (AC5-5): `record` lists the compaction and names the row the session
 * stands on from then on, and the fork stays as the session from before, for Undo. `checkAccount` asks the agent of its
 * account afresh (*Check now*, HarnessV3-ACP AC3-6), and says what the check came to where there is something to say.
 * `onSignIn` hears what a session opened or refused outside a turn — the one an agent's models are read from — shows
 * of its sign-in: opened, or refused asking for one, in the refusal's words.
 * `restByRequest` has the agent let go of the session a request's conversation holds, where it holds one open between
 * turns, while the bridge keeps the record: a sub-agent's exchange ends with it, and its follow-up opens the session
 * again (HarnessV4_Tasks E15, step 1).
 * @typedef {{
 *   run: (opts: any) => Promise<any>,
 *   listen?: (opts: any) => Promise<any>,
 *   turnForRequest: (args: any) => any,
 *   resume: (args: { turn: any, results?: any[], onEvent: (ev: any) => void, signal?: AbortSignal | null }) =>
 *     Promise<any>,
 *   interrupt: (turn: any, reason?: string) => Promise<any>,
 *   drain: (turn: any, onEvent: (ev: any) => void) => number,
 *   detach: (turn: any) => void,
 *   attach: (args: any) => Promise<any>,
 *   peekByRequest: (args: any) => any,
 *   forgetByRequest: (args: any) => boolean,
 *   restByRequest?: (args: any) => Promise<void>,
 *   listSessions: (upstream: any, req?: { format: string, body: any, cwdHint?: string | null } | null) => Promise<any>,
 *   listModels: (upstream: any, opts?: { force?: boolean }) =>
 *     Promise<{ names: string[], labels?: Record<string, ModelLabel>, caps?: Record<string, { efforts?: string[] }>,
 *       source: string, error?: string, keyed?: string[], keyNote?: string }>,
 *   offer: (upstream: any, opts?: { force?: boolean }) => Promise<any>,
 *   processInfo: (upstreamId: string) => any,
 *   test: (upstream: any) => Promise<any>,
 *   onAccount: ((upstreamId: string, report: import("./agent-limits.js").AccountReport) => void) | null,
 *   onSignIn: ((upstreamId: string, signedIn: boolean, said?: string) => void) | null,
 *   checkAccount: (upstream: any) => Promise<AccountCheck | void>,
 *   useResetCredit?: (upstream: any) => Promise<string>,
 *   signInWays?: (upstream: any, o?: { start?: boolean }) => Promise<SignInWay[]>,
 *   signIn?: (upstream: any, o: { way: string, name: string, signal: AbortSignal, key?: string }) => Promise<{
 *     url: string | null, code: string | null,
 *     done: Promise<{ ok: boolean, error: string | null, key?: string, expiresAt?: number | null }> }>,
 *   cancelSignIn?: (upstream: any) => Promise<boolean>,
 *   signsOut?: (upstream: any) => boolean,
 *   signOut?: (upstream: any) => Promise<{ forgetKey?: boolean } | void>,
 *   letGo?: (upstreamId: string) => void,
 *   holds?: (where: AgentChat) => boolean,
 *   summarizes?: (where: AgentChat) => "fork" | "session" | null,
 *   summarize?: (o: AgentChat & { instruction: string, signal?: AbortSignal | null }) => Promise<AgentSummary>,
 *   compacts?: (where: AgentChat) => "fork" | "session" | null,
 *   closed?: (where: AgentChat) => boolean,
 *   compactOwn?: (o: AgentOwnAsk) => Promise<AgentOwnCompaction>,
 *   running: (upstreamId: string) => boolean,
 * }} AgentBridge
 */
/**
 * A harness chat as an agent bridge keys it: the upstream, the folder its turns name (`x-filament-cwd`) and the chat's
 * conversation id (`chain:<id>`). `base` is the chat's newest compaction, as its next turn names it (AC5-1): a session
 * standing on another is not the one that turn goes to — an undo brings the one from before back — and neither writes
 * Filament's summary nor compacts itself (AC5-5).
 * @typedef {{ upstream: any, cwdHint?: string | null, conversationId: string, base?: number | null }} AgentChat
 */
/**
 * The summary an agent wrote for Filament (HarnessV3-ACP AC5-4): what it said, where it wrote it, and the tokens it
 * spent as the agent counts them (null where it said none).
 * @typedef {{ text: string, how: "fork" | "session", usage: { input: number, output: number, cacheRead: number, cacheWrite: number, total: number | null } | null }} AgentSummary
 */
/**
 * The agent's own compaction of a harness chat's session, asked for (HarnessV3-ACP AC5-5): what to keep (`keep`, the
 * agent's own instructions where it takes some), whether to fork the session first (`fork`), and `record`, which lists
 * the compaction once the agent says it compacted and answers the row's id — the chat's compaction the session stands on
 * from then on. `onEvent` takes the compaction's events as the agent says them.
 * @typedef {AgentChat & { keep: string, fork: boolean, record: (facts: AgentOwnCompaction) => number,
 *   signal?: AbortSignal | null, onEvent?: ((ev: any) => void) | null }} AgentOwnAsk
 */
/**
 * How the agent's own compaction went, as it said it: its context's tokens before and after where it named them (0
 * where it did not), the time it took, what it spent, whether a fork keeps the session from before, whether it was
 * given what to keep (`instructed`: Codex's compaction takes no instructions), and the summary its context goes on
 * from (`summary`), where it hands one over and its session held the whole chat: Filament's copy of the chat starts
 * from it then. Codex and Cursor hand none over.
 * @typedef {{ tokensBefore: number, tokensAfter: number, ms: number, usage: AgentSummary["usage"], forked: boolean, instructed: boolean, summary?: string }} AgentOwnCompaction
 */
/**
 * Where a coding agent's call to Filament's own tools stands (HarnessV3-ACP AC4-2, AC4-5): the agent's folder and
 * upstream, the session it runs in and the session's turn the call is filed on (none outside a session), whether the
 * session has the task graph's tool, whether it has a graph task's `report` (a sub-agent's on a task, AC6-1), the id
 * of a team's worker whose lead reads along, which asks it (`asksLead`, HarnessV3-TaskGraph-v2 TG2-D49: ask_lead),
 * whether its agent leads the session's team (`team`, AC6-3: the team's tools) and reads along with its workers
 * (`reads`, V2-0b: the worker and the wait that say so), whether a plain chat was given Filament's agent tool (`launch`,
 * HarnessV4_Tasks E12 step 2), whether its chat shows the agent's visuals (`visuals`, HarnessV4_Visuals_Plan E16: kept
 * on the call's turn, `by` the sub-agent whose run it is and which of its exchanges — one no turn launched keeps them
 * on its session, VS-D48 — under the id and round of the agent's own call the call came in where its bridge can say
 * which, `callOf`), whether its chat makes the agent's artifacts (`artifacts`, HarnessV4_Artifacts_Plan E18: the
 * model the agent runs on names who made a version, `model`, and a folder is published from its folder or the ones
 * its chat adds, `dirs`), how long the agent lets one of Filament's calls run (`patienceMs`: a wait answers within
 * it, and a launch that takes longer runs on), and the running turn's events, where a graph that changed is drawn,
 * a visual drawn or an artifact published is announced and a report given reaches its run. `beside`: its agent is
 * a harness chat's own, which fires teams beside its chat (team_v2_plan §5.5) and starts threads (`thread`, app/threads.js); `flow`, which designs flows beside it
 * (HarnessV4_OneAgent_Plan OA3). `browser`: its agents drive the chat's browser (HarnessV4_AgentTools_Plan AT-D7), a
 * call judged by the chat's switch (`permit`, which may ask the person — or a worker's lead, `by: "lead"`; `judgeNow`,
 * what it would answer now, asking nobody) — a sub-agent's in tabs of its own, by `by`'s id and name, a team's worker's
 * yes from its lead kept for its team (`by`'s `team`). `space: false`: its agent goes without the project's Space, its
 * card switched it off (HarnessV4_ShippedAgents_Plan SA2). `skills`: its chat offers skills, which the skill tool reads
 * at each call (HarnessV4_Skills_Plan S1-1). `confined`: the turn is for a caller that reaches its own project's
 * sessions alone (another machine without the admin token), and so are memory's tools. `leftOut`: Memory settings leave
 * its chat out (D4 of 11-01): none of memory's tools. `rowless`: memory keeps no row of the turn — it leaves the turn
 * out for a reason of its own, or its situate or prepare failed — so the chat's own agent's pictures are kept on its
 * session while it runs.
 * @typedef {{ cwd: string, upstream: string, chain: string | null, turn: string | null, graph: boolean,
 *   report?: boolean, asksLead?: string | null, team?: boolean, reads?: boolean, confined?: boolean, leftOut?: boolean, rowless?: boolean, launch?: boolean, held?: boolean, visuals?: boolean, space?: boolean, by?: { id: string, exchange: number, name?: string, team?: { key: string, name: string } } | null,
 *   artifacts?: boolean, beside?: boolean, thread?: boolean, flow?: boolean, browser?: boolean, skills?: boolean, model?: string, dirs?: readonly string[],
 *   permit?: ((calls: { name: string, input: any }[], what: string) => Promise<{ asked: boolean, by?: "lead" }>) | null,
 *   judgeNow?: ((calls: { name: string, input: any }[]) => "run" | "ask" | "refuse") | null,
 *   modeNow?: (() => string | null) | null,
 *   askPerson?: ((form: any, o: { signal?: AbortSignal | null, again?: (() => any) | null }) => Promise<any>) | null,
 *   rulesAsk?: ((calls: { name: string, input: any }[]) => string | null) | null,
 *   callOf?: ((name: string) => Promise<{ id: string, round: number } | null>) | null, callIsOwn?: ((name: string) => Promise<boolean | null>) | null,
 *   patienceMs?: number, emit?: ((ev: any) => void) | null,
 *   signal?: AbortSignal | null }} AgentToolCtx  `signal`: aborted once the call should stop — its turn ended or was stopped, or the agent let go of it;
 *   `callIsOwn`: whether the call came in the agent's own call or a sub-agent's of its own, which calls over the agent's
 *   session (agent-run.js `callIsOwn`) — null where that cannot be told;
 *   `askPerson`: a form put to the person on the running turn's card, answered as its answer (turn-bridge.js
 *   `askPerson`, asks.js's shapes) — a command's ask on another machine (the remote-agents plan's c-tools); `rulesAsk`:
 *   the chat's ask or review rule that speaks for calls whatever its mode, which asks first for one there; `modeNow`:
 *   the chat's mode now, which a command there is judged in (null where no turn runs)
 */
/**
 * Where Filament's MCP server stands for the conversation behind a token (src/http/mcp.js; each bridge's
 * `contextForMcpToken`): the conversation and its newest turn, the agent's folder and upstream, whether the session was
 * given Filament's hands (`native`), memory's chain, the running turn's id and events, the task graph's tool, a graph
 * task's `report` (AC6-1), a worker's ask_lead by its id (`asksLead`, TG2-D49), a team's tools (`team`, AC6-3), a plain
 * chat's agent tool (`launch`) and how long its agent lets one of Filament's calls run (`patienceMs`), the visual tools
 * of a chat that shows them (`visuals`, E16), the artifact tool of one that makes them (`artifacts`, E18), the team
 * tool of a harness chat's own agent (`beside`, team_v2_plan §5.5) and its flow tool (`flow`, OA3), the chat's browser
 * (`browser`, with `permit` and `judgeNow`, AT-D7), a command's ask on another machine put to the person (`askPerson`,
 * the remote-agents plan's c-tools) and the rule that asks first for one (`rulesAsk`), the skill tool of a chat that offers skills (`skills`,
 * HarnessV4_Skills_Plan S1-1), a session that writes Filament's summary (`writing`, AC5-4), a
 * harness chat's (`chat`), and a chat Memory settings leave out (`leftOut`, D4 of 11-01: its newest turn says so, or
 * the turn opening its session), which is offered none of memory's tools. `confined`: whether the caller reaches its own
 * project's sessions alone, as the newest turn or the turn opening the session says; unsaid where neither places the
 * caller, and memory's tools keep to the project's sessions then. `by` and `space`: the sub-agent the session is, and a
 * card without the Space, as the turn opening the session says them before any turn is the session's.
 * `settled`: the same once the turn the call is for is known, the one the session's own requests find (the bug
 * report's P1). `listed`: told the names the server listed at the address, Filament's own hand for the session's
 * permission requests (turn-bridge.js `loopCalls`).
 * @typedef {{ conv: any, turn: any, cwd: string, upstream: any, native: boolean, chain: string | null,
 *   turnId: string | null, graph: boolean, report?: boolean, asksLead?: string | null, team?: boolean, reads?: boolean, launch?: boolean, held?: boolean, visuals?: boolean, artifacts?: boolean, beside?: boolean, thread?: boolean, flow?: boolean, browser?: boolean, skills?: boolean, leftOut?: boolean, confined?: boolean, patienceMs?: number, writing?: boolean, by?: any, space?: boolean,
 *   permit?: ((calls: { name: string, input: any }[], what: string) => Promise<{ asked: boolean }>) | null,
 *   judgeNow?: ((calls: { name: string, input: any }[]) => "run" | "ask" | "refuse") | null, modeNow?: AgentToolCtx["modeNow"],
 *   askPerson?: AgentToolCtx["askPerson"], rulesAsk?: AgentToolCtx["rulesAsk"],
 *   emit: ((ev: any) => void) | null, chat?: boolean, settled?: () => Promise<McpContext>, listed?: (names: string[]) => void }} McpContext
 */
/**
 * Filament's own tools for a coding agent's session, one list and one way to call them for every bridge — over
 * Filament's MCP server, or as Cursor SDK's custom tools: memory's while its tools are on (`memoryOn`), the task graph's
 * `tasks` while the session has it; `teamsOn`: Settings › Experimental's Teams switch (core/teams-on.js). `has` says whether a tool is one of them; `call` runs one, its refusals in words — a picture beside its words in `media` (the browser's screenshot).
 * @typedef {{
 *   memoryOn: () => boolean,
 *   teamsOn?: () => boolean,
 *   list: (ctx: AgentToolCtx) => { name: string, description: string, inputSchema: any, upfront?: boolean }[],
 *   has: (name: string) => boolean,
 *   call: (name: string, args: any, ctx: AgentToolCtx) => Promise<{ text: string, isError?: boolean, media?: any[] }>,
 * }} AgentTools
 */
/**
 * An agent's own words for one model it lists (HarnessV3-ACP AF2): its name for it, and its description.
 * @typedef {{ label?: string, note?: string }} ModelLabel
 */
/**
 * A way an agent signs in (HarnessV3-ACP AC3-7), as its bridge names it: a program run in a terminal (its file, its
 * arguments and its whole environment, the account's folder in it), a page in the browser that `signIn` opens — or that
 * the agent opens itself (an ACP agent's own, `authenticate`) —, or a key the person pastes (the review of 11-10), its
 * field named by `label`: kept in the account's environment as `variable` where the agent reads it from one, else handed
 * to `signIn`, which gives it to the agent (Codex's OpenAI API key). A page's way that finishes from a browser on
 * another computer than Filament's says `far` (Codex's code): the command line offers it first where no page comes back.
 * @typedef {{ id: string, name: string, description: string, kind: "terminal", command: string, args: string[],
 *   env: Record<string, unknown> } | { id: string, name: string, description: string, kind: "browser", far?: boolean }
 *   | { id: string, name: string, description: string, kind: "key", label: string, variable?: string }} SignInWay
 */
/**
 * A destination that answers a shaped request. `open` sends it and resolves with the response and the cleanup that
 * releases whatever the send held; `url` and `notes` when the destination chose them itself (Qoder signs its own
 * URL; another machine's Filament takes the wire's own path there, `format`). `unreachable(e)` is the sentence for a
 * connection failure and whether the next candidate may try after it.
 * @typedef {{
 *   open: (req: {
 *     url: string,
 *     headers: Record<string, string>,
 *     bodyString: string,
 *     body: any,
 *     modelId: string,
 *     format?: "anthropic" | "openai",
 *     signal?: AbortSignal,
 *   }) => Promise<{ res: any, cleanup: () => void, url?: string, notes?: string[] }>,
 *   unreachable: (e: any) => { message: string, retryable: boolean },
 * }} RequestAnswerer
 */
/**
 * Where a request goes: one object per upstream from `deps.destination(upstream)`. Exactly one of `agent` and
 * `answers` is set. A destination that RUNS TURNS (an ACP agent, Codex, the Cursor SDK) has session semantics —
 * permissions, MCP servers, modes — and reports its work as events the application renders; one that ANSWERS REQUESTS
 * (an HTTP provider, Qoder) takes the shaped request and returns a response stream the dispatch stage judges and
 * delivers. `label` is how a sentence names it; `transport` is what a record's `url` says when the request has no URL.
 * @typedef {{
 *   id: string,
 *   type: string,
 *   label: string,
 *   transport: string | null,
 *   agent: AgentBridge | null,
 *   answers: RequestAnswerer | null,
 *   listModels: (opts?: { force?: boolean }) => Promise<{ names: string[], labels?: Record<string, ModelLabel>,
 *     caps?: Record<string, { efforts?: string[] }>, source: string, error?: string, cached?: string[], keyed?: string[],
 *     keyNote?: string }>,
 *   test: () => Promise<{ ok: boolean, status?: number, ms?: number, error?: string, [k: string]: any }>,
 * }} Destination
 */
export {};
