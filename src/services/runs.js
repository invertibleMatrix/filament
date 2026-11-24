// @ts-check
// The run log: every event a loop publishes on the bus under `run:<id>` — an agent turn's state changes, its rounds,
// its tools and its sub-agents — kept per run, numbered per run, and appended to `dataDir/runs/<id>.jsonl` so a viewer
// can replay a run after a restart. Producers stay unaware: the log subscribes to the whole bus and filters, so a
// loop that already publishes is recorded without a line of its own changing.
//
// Two honesty rules the readers rely on. A gap is announced, never skipped: when the in-memory ring has dropped
// older entries and the file cannot fill them either, `events()` says which number it can serve from, so a lagging
// viewer resyncs instead of silently missing what happened. And the operation log gets counts and ids only: a run's
// payloads (a brief, a question, a sub-agent's words) are conversation, and ops.jsonl is durable.
//
// Memory holds a run's newest events alone (the owner's of 11-15, after the server ran out of memory twice on 11-14:
// "have some limit that is always available in memory but scrolling back up and up after certain limit just shows up
// a spinner until that chunk is loaded from disk"). A running run's ring is capped by the size of its events as well
// as their count, and an ended run keeps none once its file holds them all; older events are read from the file a
// page at a time, found by an index of where its lines start, never by parsing it whole and keeping the parse.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { fewAtOnce } from "../core/at-once.js";
import { redactSecrets } from "../core/redact.js";
import { createRunImages } from "./run-images.js";
import { join } from "node:path";

/** @typedef {import("../core/ports.js").EventBus} EventBus */

/**
 * @typedef {object} RunMeta
 * @property {string} id
 * @property {string} kind  what kind of loop: "agent-turn" | "subagent" | "coding-agent" (a coding agent's turn,
 *   HarnessV3-ACP AC1-1) | "replay-compare" | "unknown" (events arrived before a start)
 * @property {string | null} title
 * @property {string | null} parentId  the run this one hangs off (a sub-agent's launching turn), when known
 * @property {number} startedAt
 * @property {number | null} endedAt
 * @property {string} status  "running" until `endRun`, then whatever the producer said (done, error, paused, …)
 * @property {any} summary  what the producer handed `endRun` (counts only by convention)
 * @property {any} meta  what the producer handed `startRun`
 * @property {number} events  events recorded so far (including any the ring has dropped)
 * @property {number} firstAvailable  the lowest `n` the ring still holds (0 when nothing was dropped, and once an
 *   ended run keeps no ring: its file holds every event)
 * @property {boolean} persisted  whether a jsonl file exists for this run
 */

/**
 * @typedef {object} RunEvent  the envelope every stored event carries; the producer's payload is spread into it
 * @property {number} n  monotonic per run — what a viewer detects gaps with and resumes from
 * @property {number} seq  the bus's own monotonic number (across all topics)
 * @property {number} ts
 * @property {string} runId
 * @property {string} type
 * @property {true} [afterEnd]  recorded after its run's end (a background sub-agent reporting into its parent's run): a
 *   file whose last line is one reads as ended, as one whose last line is its run-end
 */

/**
 * @typedef {object} SteerMessage  one steering message from the developer to a running loop (§4.6 of the plan)
 * @property {string} id
 * @property {"note" | "veto" | "stop" | "compact"} kind  advisory text · refuse the round's proposed actions · end the
 *   turn now · compact the context before the next round
 * @property {string} text
 * @property {string} from  who sent it: "harness" (the page), "chat" (a caller that named none), "lead", "agent",
 *   "filament", "developer" (their answer relayed), "watcher" (a watcher's guidance to the chat it watches,
 *   app/watchers/guidance.js) — whether the developer typed it is read from it (`typedByDeveloper`)
 * @property {string} [title]  its sender by name, where it has one: the watcher's title, which the heading its reader
 *   reads it under and its bubble say
 * @property {number} at
 * @property {boolean} [interrupt]  a coding agent's note that interrupts its agent instead of waiting for its next step
 *   (HarnessV3-FailurePoints FP-D8), where the run says it can (`interrupts`)
 * @property {SteerImage[]} [images]  the pictures a note or a veto carries, where the run says it reads them
 *   (`steerImages`): the loop hands them to the model with the words. The run's events name them without their bytes
 * @property {{ agentId: string, exchange: number, name: string }[]} [overrules]  the saved agents' answers a note's
 *   words overrule (HarnessV4_Tasks E15 step 3), by agent and name: the note's bubble says whose, live and after a reload
 * @property {true} [aside]  a note the person typed into the agent loop's turn that a fork weighs first (the owner's
 *   forked steer of 11-04): queued, and no read of the loop's takes it, until the fork passes it on (`pass`) — or the
 *   fork answers it or plans it, and it leaves the queue (`settle`)
 * @property {SteerVia} [via]  the way the person sent it, as the page says it (the owner's of 11-09)
 */
/**
 * @typedef {object} SteerVia  the row of the page's ⌄ menu a message went by while the turn ran, and how it was pressed:
 *   kept on the `steer` event, so the run log counts the ways people send mid-turn
 * @property {string} row  next-step, interrupt, veto, aside, queue-next-step, unread-note… — a word of lowercase letters
 *   and dashes
 * @property {"key" | "click" | "auto"} by  the send key or the veto key, a click on the button or the row, or no press
 *   at all: Filament sent it again by itself (an unread note)
 */
/**
 * @typedef {object} SteerAsides  what weighs the person's notes aside on a run (the owner's forked steer of 11-04): the
 *   agent loop's turn sets it (`Mailbox.aside`)
 * @property {(m: SteerMessage, o: { asked: boolean }) => boolean} take  whether it weighs this note, said before the note
 *   is queued: true holds it out of the loop's reads. `asked`: the person asked for a fork, which the session's switch
 *   need not be on for
 * @property {(m: SteerMessage, how: "edit" | "drop") => void} changed  a note it weighs changed its words, or was taken back
 */
/**
 * @typedef {object} SteerAsideSaid  how a fork's weighing of a note went, as the run's `steer-aside` says it
 * @property {"weighing" | "correction" | "question" | "work" | "straight"} as
 * @property {string} [agent]  the fork, by its sub-agent id
 * @property {string} [answer]  a question's answer, for the person
 * @property {string} [letter]  what the fork wrote the agent, sealed
 * @property {{ id: string, name: string }[]} [tasks]  the tasks it proposed on the agent's graph
 * @property {string} [why]  why the note went straight in, unweighed or weighed to no end
 */
/** @typedef {import("../core/media.js").SteerImage} SteerImage */
/** @typedef {Omit<SteerMessage, "images"> & { images?: { name: string, mediaType: string, bytes: number, ref?: string }[] }} SteerShown
 *  a message as the run's events and the mailbox's answer name it: its pictures by name, type and size, and a kept one
 *  by its ref (`runs/images/`, V4-D303) */

/**
 * @typedef {object} Mailbox  a run's steering mailbox, read by its loop at decision points, never mid-stream
 * @property {(pick?: (m: SteerMessage) => boolean) => SteerMessage[]} read  drain what is queued — or, with `pick`, only
 *   the messages it picks, the rest left waiting (each message taken is marked read on the run's timeline)
 * @property {(msgs: SteerMessage[]) => void} unheard  messages the loop took and then never acted on (the turn stopped
 *   first), said so on the timeline as `endRun` says of the ones it never took: `steer-unread`
 * @property {(ms: number) => Promise<SteerMessage[]>} wait  the decision window: resolves with what arrived, early on
 *   the first message or when `ms` elapse with nothing (then `[]`)
 * @property {() => number} size
 * @property {(pick?: (m: SteerMessage) => boolean) => Promise<void>} next  resolves as soon as a message is queued (at
 *   once when one already is) and reads nothing — so a wait can race it beside other things without ever draining a
 *   message nobody then handles. With `pick`, only a message it picks ends the wait, or the run's end: a coding
 *   agent's turn waits past the commands it holds for the turn's end
 * @property {(pick: (m: SteerMessage) => boolean) => SteerMessage | null} peek  the first queued message `pick` takes,
 *   left queued: a coding agent's turn hands it to the agent, and reads it only once the agent took it (`took`)
 * @property {(pick: (m: SteerMessage) => boolean) => SteerMessage[]} list  every queued message `pick` takes, left
 *   queued
 * @property {(m: SteerMessage) => boolean} handing  a peeked message a coding agent's turn hands to its agent now
 *   (HarnessV4_Tasks C34): said on the run (`steer-sent`) the first time, and from here the developer can no longer
 *   change it or take it back; false when it is no longer queued
 * @property {(m: SteerMessage, o?: { after?: boolean }) => boolean} took  a peeked message the agent took: off the
 *   queue and read on the run's timeline (`steer-read`); false when it is no longer queued. `after`: it ran as the
 *   agent's next prompt, its turn having ended first — the event says so, and the page's bubble reads "runs next"
 * @property {AbortSignal} stopSignal  aborts the moment a `stop` steer lands — the one message that does not wait for a
 *   decision point: the loop cuts its in-flight work on it (the model call, a running command, a foreground sub-agent)
 * @property {AbortSignal} forceSignal  aborts on a Force stop (`force`): the agent loop ends the turn at once,
 *   whatever it is waiting on
 * @property {(callId: string, move: () => { id: string } | null) => () => void} movable  a command running in the
 *   foreground under that call, with the way to send it to the background (`background`, HarnessV4_Four_Plan E21):
 *   held until the returned function is called, as the call answers
 * @property {(asides: SteerAsides) => () => void} aside  what weighs the person's notes aside from here on, until the
 *   returned function is called (the owner's forked steer of 11-04)
 * @property {(m: SteerMessage, said: SteerAsideSaid) => boolean} weighs  a note held aside, said on the run as its fork
 *   goes (`steer-aside`), still held; false when it is no longer queued
 * @property {(m: SteerMessage, said: SteerAsideSaid) => boolean} pass  a note held aside goes into the mailbox as any
 *   other, said on the run (`steer-aside`); false when it is no longer queued
 * @property {(m: SteerMessage, said: SteerAsideSaid) => boolean} settle  a note held aside leaves the queue, its fork
 *   having answered it or planned it, said on the run (`steer-aside`); false when it is no longer queued
 * @property {(why: string) => number} unweigh  every note held aside goes into the mailbox unweighed, said on the run
 *   (`steer-aside`, straight, `why`), its fork stopped: a turn that pauses carries them; how many went
 * @property {() => Promise<void> | null} weighed  resolves once no note is held aside, or the run ended; null whennone is
 */

/**
 * @typedef {object} OpenAsk  a question the run waits on the person to answer (HarnessV3-ACP AC2-4)
 * @property {(answer: any) => string} check  why an answer doesn't fit the question, or ""
 * @property {(answer: any) => void} settle  the wait's end: the answer, or null
 */

/**
 * @typedef {object} OpenRun  a run an earlier process started and never ended — it died with that process
 * @property {string} id
 * @property {any} meta  its run-start's meta
 * @property {any} brief  its run-start's brief (null when it had none)
 * @property {string | null} parentId
 * @property {number} rounds  how many round-starts it recorded
 * @property {number} lastAt  its newest event's time
 */

/**
 * @typedef {object} RunLog
 * @property {(args: { id: string, kind?: string, title?: string | null, parentId?: string | null, meta?: any, brief?: any }) => RunMeta} startRun
 * @property {(runId: string, end?: { status?: string, summary?: any }) => RunMeta | null} endRun
 * @property {(kind: string) => Promise<OpenRun[]>} openOnDisk  runs of that kind an earlier process left open (no run-end)
 * @property {(runId: string, end: { status: string, summary?: any }) => boolean} closeOnDisk  such a run's end, written
 * @property {(runId: string) => RunMeta | null} getRun
 * @property {(chainId: string) => RunMeta[]} runningIn  the turns running in a session now, as their runs name it
 * @property {(runId: string) => RunEvent[]} waitingAsks  the asks a running turn's chat lists that wait still, each its `ask` event
 * @property {(runId: string) => boolean} hasRun  whether `getRun` would answer: in memory or on disk, read by name alone
 * @property {(opts?: { limit?: number, kind?: string | null }) => RunMeta[]} listRuns
 * @property {(runId: string, opts?: { since?: number, limit?: number, types?: string[] | null, bodies?: boolean, graphs?: "all" | "last", calls?: "all" | "apart" | "only", of?: { round: number, parent: string } | null }) => { run: RunMeta, events: RunEvent[], firstAvailable: number, gap: { requested: number, firstAvailable: number } | null } | null} events
 *   `types`: those events alone (a reader of a whole run's snapshots or questions), `limit` counting only them;
 *   `bodies: false`: an event too large for a line as its envelope, its body not read (a reader of what a turn does now);
 *   `graphs: "last"`: of an ended run's task-graph events, only its last that carries its graph keeps it — each is the
 *   whole graph as it stood, and an ended turn's reader reads its newest alone (the page's, plan.js `planOf`);
 *   `calls: "apart"`: an ended run's sub-agents' calls left out but those that come whole (`ApartFacts`), the first
 *   subagent-start of each launching call they were left out of saying how many its card counts (`callsApart`), `limit`
 *   counting what comes — a sub-agent's card reads its own when it opens (the page's); `calls: "only"`: those calls
 *   alone, of one launching call where `of` names it (its round, its parent as the query says it), `limit` counting them
 * @property {(runId: string, fn: (evt: RunEvent) => void) => () => void} subscribe
 * @property {(runId: string, msg: { kind?: string, text?: string, from?: string, title?: string, interrupt?: boolean, images?: unknown, overrules?: unknown, weigh?: boolean, straight?: string, via?: unknown }) => { ok: true, message: SteerShown, queued: number } | { ok: false, error: string }} steer
 *   `weigh`: the person asked that a fork weigh the note first (the owner's of 11-05: the ⌄ menu's Weigh aside first,
 *   `/steer-fork`), whatever the session's switch says — one no fork can take goes in, saying why; `straight`: why the
 *   note goes straight in, never to a fork aside (the owner's forked steer of 11-04)
 * @property {(runId: string, id: string, change: { text?: string }) => { ok: true, message: SteerShown } | { ok: false, error: string, gone?: boolean }} editSteer
 *   the developer's message changed while it waits (HarnessV4_Tasks C34)
 * @property {(runId: string, id: string) => { ok: true } | { ok: false, error: string, gone?: boolean }} dropSteer
 *   the developer's message taken back while it waits (HarnessV4_Tasks C34)
 * @property {(runId: string, opts?: { from?: string }) => { ok: true, queued: boolean } | { ok: false, error: string }} force
 *   a Force stop: the stop made to land now (HarnessV3-FixRound F2 item 13) — queued when none is, then the turn ends
 * @property {(runId: string, id: string, o?: { check?: (answer: any) => string, signal?: AbortSignal | null }) => Promise<any>} awaitAnswer
 *   a question the run waits on the person to answer (HarnessV3-ACP AC2-4): the answer, or null on the signal or
 *   the run's end
 * @property {(runId: string, id: string, answer: any) => { ok: true } | { ok: false, error: string, gone?: boolean }} answer
 * @property {(runId: string, callId: string) => { ok: true, shell: string } | { ok: false, error: string, gone: boolean }} background
 *   a command the run's loop runs in the foreground, sent to the background (HarnessV4_Four_Plan E21)
 * @property {(runId: string) => Mailbox} mailbox
 * @property {(pictures: ({ data: string } | { path: string })[]) => { images: import("./run-images.js").KeptImage[], notKept: import("./run-images.js").NotKept | null }} keepImages
 *   a call's pictures (core/media.js `picturesIn`) kept beside the run files (HarnessV4_Tasks U9): what its tool-end
 *   names, never the bytes
 * @property {(ref: string) => string | null} imageFile  a kept picture's file, or null: the route serves it
 * @property {(ref: string) => string | null} imageType  a kept picture's type, by its name
 * @property {() => Promise<number>} sweep  the run files past their retention removed, then the pictures beside them: how
 *   many run files went
 * @property {() => RunLogMemory} memory  what the log holds in memory now
 * @property {() => void} close
 */
/**
 * @typedef {object} RunLogMemory  what the run log holds in memory: what its readers do not find on disk alone
 * @property {number} runs  the runs it keeps, running and ended
 * @property {number} events  the events their rings keep
 * @property {number} chars  those events' JSON, in characters, where a file holds them too (a run kept in memory alone
 *   is not measured)
 * @property {number} asSent  the events kept as published beside a file that holds them otherwise (a key redacted)
 * @property {number} indexes  the run files it keeps an index of
 */

// The event vocabulary (plan §4.2): every type a loop may publish on `run:<id>`, with the payload fields it carries
// beside the envelope (`n`, `ts`, `type`). Extend, never rename — the harness, the client stream and the replay all
// read these names. "agent" is the agent loop (app/agent/loop.js). A coding agent's turn (`coding-agent`) publishes
// the loop's events for what it does, read from what the agent sends (app/agent-run.js, HarnessV3-ACP AC1-3).
// The events SSE also writes two transport frames that are not run events and carry no `n`: `hello` (the run, the
// first available number, any gap) and `ended` (the run is over) — see http/admin/runs.js.
export const RUN_EVENT_FIELDS = Object.freeze({
  "run-start": "kind, title, parentId, meta, brief? — every run, published by the run log; brief: a sub-agent's run only, what a restart notice needs once the process that ran it is gone (agentId, exchange, description, task clipped at 600 characters, by, deliver) — on the event, never in the run's meta (the runs list stays small). A coding agent's turn: meta { engine (acp|cursor-sdk), upstream, model, root (its working folder), session (the agent's), chain }. The loop's: meta.hooks true where the session's hooks run commands in the run, which no call of it says (app/watchers/own-times.js keeps such a turn its chat's own time whole)",
  "run-end": "status, summary — every run; summary.unreadSteer counts messages queued but never read",
  "turn-state": "from, to, why, retry?, queue?, tokens?, woke? — agent: idle|sent|planning|acting|observing|paused|waiting|done|budget-stopped|stopped|aborted|failed. sent: a coding agent's prompt went out, its why the words ('sent — Claude is working', HarnessV3-FailurePoints §5.1 item 2). tokens: on planning, what the model call has thought so far in the agent's estimate (Claude's thinking_tokens), said again as it grows by a quarter. retry: on a waiting state, a model call's wait before its next try, its why the words (upstream, status, waitMs, next, of — HarnessV3-AtHome AH-F4). queue: on a waiting state, a model call's wait for a slot at its provider, its why the words (upstream, model, cap, holders — AH-F5). woke: the agent's turn had ended on its reply in the round running, and it went on within the same turn — a coding agent's next prompt of Filament's, or words queued at it that ran as one (planning); the loop's round for its sub-agents' reports, the developer's message, errors found late, sealed envelopes, a task's report or a turn-end hook (acting), never a reply cut at its ceiling — said even where the state stands; the page shows that reply outside the work (the owner's of 11-05)",
  budget: "which (output: the reply reached its output ceiling), at, limit — agent; the turn then ends budget-stopped: since TG2-D62, at the second cut in a row with nothing run between",
  "output-cut": "round, at, limit, by (ceiling|window), part (thinking|call|text|nothing), tool?, chars?, ran — agent: the round's reply stopped at max_tokens and the turn went on (HarnessV3-TaskGraph-v2 TG2-D62). at: the room the call asked for; by window: that was the room the context window had left (`limit` is the turn's ceiling). part: where the cut came — a thinking block (chars: its length) or a call (tool: its name) is dropped, a text block kept; ran: the reply's finished calls, which ran",
  compacting: "round, own?, by?, earlier?, exchanges? — agent: the mid-turn window-edge fold has started (the summarizer is running). earlier: what is ahead of the turn's own messages gives way instead (HarnessV4_Tasks C33) — the session's earlier turns, by its own compaction method; with exchanges, a sub-agent's earlier exchanges, by its own model. own: a coding agent compacting its own context (HarnessV3-ACP AC2-1), by: its name; round 0: before its first model call",
  compaction: "round, fromRound, toRound, tokensBefore, tokensAfter, by?, fork?, manual?, attached?, result?, stoodDown?, why?, own?, ms?, error?, summary?, earlier?, exchanges?, fromTurn?, toTurn?, method? — agent: the oldest work rounds folded into one summary to stay inside the window; one prefix rewrite, the loop continues; summary: that summary, which a reader beside the turn starts from (core/run-work.js `newestCompaction`).earlier: what was ahead of the turn's own messages gave way instead (HarnessV4_Tasks C33), the turn's own rounds kept whole — the session's earlier turns (fromTurn–toTurn, by `method`: the session's own compaction), or with exchanges a sub-agent's earlier exchanges (fromTurn–toTurn, the launch its first) to a summary its own model wrote; result none with `error`: they could not. round: the round that had just finished (the fold runs before the next). by: the model that wrote the summary (a team's lead's watch says it). manual: on the developer's Compact (a `compact` steer, BUG-21); attached ({ shown, named, plan, graph? }): what came back after the summary — the files shown, the files only named, whether the plan (HarnessV3-AtHome AH-D9 b), and the task graph (HarnessV3-TaskGraph); result (little|empty): a manual Compact that folded nothing, and why. stoodDown: the fold left the conversation at or past the line (the earlier turns hold the rest), so the line stands down for the rest of the turn. why: 'overflow-refusal' marks the fold run by the in-round overflow recovery (cleared: results cleared, folded: whether a summary was written), not the compaction line. own: a coding agent compacted its own context (Codex's `contextCompaction`, Claude's compaction — HarnessV3-ACP AC2-1): no rounds of Filament's; by its name, tokensBefore, tokensAfter and ms as the agent gave them, manual on its /compact, summary: the summary it kept where it said it (ACP's compaction updates, AC5-7), result failed with its error; round 0: before its first model call",
  window: "window (null = unknown), source (operator|endpoint|builtin|null), usable (null = unknown; the arithmetic is lane-defined — a session's composed request carries the composer's compaction line, a native request its own capped reply reserve, the agent loop its line), fixed — agent, once per turn: which context window this turn runs against, where the number came from, how much is usable, and what the system prompt + tool schemas cost",
  held: "round, tokens, window (null: the agent names none), exact — agent: what a coding agent's context holds while it works (HarnessV3-ACP AC3-5), as the agent counts it: Claude's usage_update (each model call, a compaction's end, the result), Codex's newest model call; exact false: Filament's estimate (the Cursor SDK's, at each model call's end: its base and what came in since). Published when it moved; the meter's figure until the turn's record lands",
  "round-cache": "round, input, cacheRead, cacheWrite, ttlMs? — agent: one model call's prompt as its provider counted it: the new input, what it read from the provider's cache, what it wrote to it; ttlMs: the cache lifetime a coding agent's own markers asked for, as its provider split its writes (Claude's cache_creation), kept from the run's newest call that said one. The loop's every round; a coding agent's own model calls where it counts them one by one (Claude's raw messages, Codex's token report), its sub-agents' never. The Cache instrument's last request while the turn runs",
  "round-start": "round (1-based), blocksBefore: how many reply blocks precede this round's output — the cards' placement anchor — and context: the tokens this round sends, by the loop's own measure (BUG-20: the live meter's figure) — agent, one per model call",
  "round-text": "round, text, block: the ordinal of this round's text block in the client's reply — agent",
  "round-thinking": "round, thinking — agent",
  "round-writing": "round, chars — agent: the input of the calls one model call is writing (a file's whole text, an edit's), in characters so far, said as it grows at most every 500 ms; the speed gauge counts it with the words and thinking the reply streams (the owner's word of 10-27). Its round-written ends it",
  "round-written": "round, output, ms — agent: what one model call wrote, as its provider counted it (its thinking and its calls' input included, which the stream may show little or nothing of), and the time it was writing (services/daily-usage.js writingMs; null where too short to rate). The loop's every round that wrote; the speed gauge's figure round by round",
  ask: "round, kind (question|permission|lead), tool?, question, options?, waits?, offer?, ask?, plan? — agent. waits: a team's worker's call that waits in place for the developer's answer, which its session's route gives (HarnessV3-AtHome P2) — no pause, and no answer in a next request; the route's modeSwitch answer has the call judged again under the mode now in force (AH-F1). lead: a team's worker's question to its lead, with ask_lead (HarnessV3-TaskGraph-v2 TG2-D49), on its own run — a coding agent's too, in the round its call was made in: its lead answers it, in its own call — whether it reads along or not (TG2-D58) — and it waits until that answer, its stop, or its lead's turn's end; options: its choices, its pick first; ask: its number among the worker's questions (TG2-D42); plan: it is the worker's plan, sent while its lead reviews it (TG2-D50) — a go lets its changes and commands run. offer { itemId, tool, shape }: a permission's always-allow waiting for the call's shape — the inferred permission item the page's Always allow confirms (HarnessV3-Views V3). A coding agent's question (HarnessV3-ACP AC2-4) waits in its run: `waits`, its `id`, `call` (the agent's tool call it belongs to, when it names one) and `form` (adapters/agents/asks.js: its questions with their choices, or the plan a `proposal` carries, or the address a `link` (a kind of its own) asks to open, or a permission's choices — one the session's switch asks about, `form.judged` (HarnessV3-ACP AC3-2), is the loop's card, answered allow or deny, and the page's `switched` once the switch moved has it judged again under the mode now in force); POST /api/runs/:id/answer settles it. One that belongs to no call draws on a card of its own, the round's call `ask:<id>` (its tool-start and tool-end, the answer's words as its preview)",
  "ask-end": "round, id, call?, outcome (answered|skipped|accepted|rejected|declined|cancelled), words — a coding agent's question settled (HarnessV3-ACP AC2-4): words, the answers a line each as the person gave them, a secret never said; cancelled: a stop, a hang-up or the run's end — the run's end says one for an ask the chat lists that it left waiting (its turn Force-stopped, which says nothing more); `nobody`: nobody could be asked, and the agent heard at once what `outcome` says",
  "tool-start": "round, name, args (the target, clipped; never content), card { kind, title, subject } (Step 3 D8: the same card the transcript's archived tools carry, computed from the call's input in whatever vocabulary it speaks), id, movable?, command?, edits? — agent (command: true where the call is a command that could have made a commit, from here to its tool-end — a shell's command its engine's gate does not read as only reading, an MCP tool nobody vouches for as reading, a Space's button pressed; app/watchers/commits.js takes a commit made meanwhile for its chat's own; edits: on a call that writes a file, a command aside, the files it says it writes from here to its tool-end — absolute paths as its tool resolves them, never content, 50 at most and none past 400 characters — or true where they are not known as it starts or pass either bound; app/watchers/own-times.js keeps them as its chat's writes; movable: a foreground command the developer may send to the background while it runs, POST /api/runs/:id/calls/:call/background — HarnessV4_Four_Plan E21)",
  "tool-output": "round, id, text — agent: a bash command's output as it runs, flushed at most every 250 ms (a rolling 4k tail); tool-end's preview is the whole result's head",
  "tool-end":
    "round, name, ok, ms, id, card (the call's card, as tool-start carried it), chars?, preview?, exitCode?, refused?, rule?, hook?, reason?, declined?, vetoed?, stopped?, notRun?, learned?, background?, file?, images?, imagesNotKept?, requestId?, lsp? — agent (lsp { errors, lines }: a write's or an edit's, the errors the language server found in its file as its result was written — their count, the first 20 as the lsp tool says them; background: the developer sent the running command to the background, as this background shell — its answer says so, and its exit is told as a background shell's (HarnessV4_Four_Plan E21); chars: absent where a coding agent showed nothing of the result — Gemini CLI shows none of a read; 0 for a call that never ran; refused: not run, with the rule, the hook or the reason in words — a plain sleep while a background sub-agent runs; a coding agent's call its permission policy refused, the reason naming the policy (HarnessV3-ACP AC2-3); declined: not run, the developer said no — a coding agent's call too, at its permission's question; preview: the head of the result the model got, clipped at observability.runEvents.toolPreviewChars — this event carries conversation like round-text; exitCode: bash only; stopped: the developer's stop cut it (BUG-09), so it reads Stopped, not Failed; notRun: with stopped, the stop came before the call started — nothing ran, and the call is drawn and counted as the archive has it (HarnessV3-FixRound F2); learned: it ran on a confirmed permission item, no question asked; file: a file the call made, as a coding agent says it — an image it generated — relative to its working folder where inside it; images: the pictures the call handed its model — a read of an image, a tool's screenshot, an image a coding agent looked at — kept beside the run files and served at GET /api/runs/images/:ref, each { ref, type, bytes }, never their bytes (HarnessV4_Tasks U9); imagesNotKept { count, why }: those it could not keep)",
  "tool-errors": "round, id, lsp { errors, lines } — agent: the errors the language server found in the file a write or an edit (id, of that round) left after its result was written, as tool-end's lsp; said to the agent at its next step",
  "shell-exit": "round, shells [{ id, command (clipped at 80 characters), code }] — agent: background shells of this agent that exited before it read their exit (HarnessV3-Tools TL-D24); a line each joined the conversation after this round, so the next round's call reads it",
  "instructions-told": "round, files [{ file, as, how (read|edit|write), chars, truncated?, text }] — agent: a folder below the chat's told its instruction files with this round's results, as the agent first read, edited or wrote a file there (agent/instructions.js folderInstructions): file is the told one, as the file worked on, both from the chat's folder; text what was told, redacted and cut as it was",
  plan: "round, items [{ text, status }] — agent: the checklist, whole, on every update",
  graph: "round, graph — agent: the session's task graph (HarnessV3-TaskGraph), whole, on every change the tasks tool made: as a page draws it (core/task-graph.js graphView) — its goal, every task with its layer, whether it is ready and on the critical path still to go, and the counts",
  visual: "round, id, title, bytes, turn? — agent: a visual the agent drew with show_visual (HarnessV4_Visuals_Plan E16) is kept, whole, on its turn under its call's id (id); turn: that turn's number in the session, which the page draws it from (GET /api/sessions/:id/turns/:n/visuals/:id) — never `n`, the run log's own number for each event; bytes: its code's size. Never its code",
  "visual-writing": "round, id, title, loading, chars | round, id, gone — agent: a show_visual call as the model writes it (VS-D11): said as it opens, again when its title (\"\" until it is whole) or one of its loading lines is whole, and as its size grows (chars, of its input so far) at most every 250 ms; gone: its round's stream broke and the call is asked again. Its tool-end, or its visual, ends it",
  artifact: "round, id?, name, v, title, address — agent: an artifact the agent published with its artifact tool (HarnessV4_Artifacts_Plan E18) is kept as version v: its name (its address's), its title, and its address at the port Filament listens on now; round and id: the call that published it — the loop's, or a coding agent's own where Filament finds it (else the round open then, and no id). Never its page",
  routine: "round, id?, project, routine, watcher, change, at — agent: a routine (watcher: false) or a watcher the agent proposed with its space tool, or changed (change), waits in the project's Space for the person's Switch on: the project and the routine's id there, and `at`, which its sheet is read by and a Switch on sends back (a newer one is a later change); round and id: the call that made it, as an artifact's are. The chat draws the card that switches it on from it. Never a webhook's address nor its secret",
  "permission-offer": "round, tool, shape, count, itemId — agent: the developer has allowed this call shape 'count' times in the project; an inferred permission item (itemId) awaits their confirm/dismiss (POST /api/memory/items/:id)",
  "subagent-start": "round, parent (the agent call's tool_use id), agentId, description, agent (the tag of the card it runs as, services/agent-cards.js; a coding agent's: the kind its agent gives it, as Cursor's explore or shell), model, team?, role?, card? ({ tag, name }: that card, HarnessV4_Tasks E15), asked? (it was called by its tag: its answer goes to whoever asked), prompt (redacted, clipped at 4,000 characters), background?, followUp? — agent: a sub-agent launched by that call started (app/agent/subagents.js); team and role: a team's worker, its team's key and its role (HarnessV3-Views V3); background: the loop did not wait for it; followUp: a further exchange with a sub-agent the call named by agent_id. A coding agent's sub-agent has no agentId (no viewer opens it): its card is the run's alone. callsApart: put on as it is read (`calls: \"apart\"`), never written — how many calls its card counts, some of them left out",
  "subagent-run": "round, parent, agentId, exchange, run — agent: the sub-agent's own run exists now (its host request's id, a run of this log); where its end is read once this run hears no more of it and the registry holds it no longer — a restart, a background one long outlived (HarnessV4_Tasks U1; GET /api/sessions/:id/subagents/:sid/end)",
  "subagent-tool-start": "round, parent, id, name, args, card, movable?, command?, edits? — agent: a sub-agent's own tool call started, as tool-start carries one (command, edits: a coding agent's own sub-agent's alone; a sub-agent Filament runs says them on its own run); round is the launching call's; movable: sent to the background through the sub-agent's own run (subagent-run)",
  "subagent-tool-end": "round, parent, and tool-end's fields — agent: a sub-agent's own tool call ended",
  "subagent-tool-errors": "round, parent, id, lsp — agent: a sub-agent's own tool-errors",
  "subagent-held": "round, parent, tokens — agent: what a coding agent's sub-agent holds, in tokens, where its agent says it (Claude's task progress, with each of its calls), sent where the figure moved: its row's and its thread's",
  "subagent-plan": "round, parent, items [{ text, status }] — agent: a coding agent's sub-agent's own plan, whole on every update, drawn on its card (HarnessV3-ACP AC3-4); the turn's checklist stays the main agent's",
  "subagent-words": "round, parent, msg (the message they belong to, \"\" where its agent names none), thinking?, text — agent: what a coding agent's sub-agent wrote since the run last heard, at most twice a second: the piece its newest message gained, or its thinking's where its agent sends any (HarnessV4_Tasks E15 step 5, AG-154). A message's pieces joined in order are that message whole, and another `msg` begins the next; its thread in the Agents tab draws it at work. Its end's report is its last message, clipped",
  "subagent-end": "round, parent, agentId, status (done|budget-stopped|stopped|aborted|failed), ok, ms, rounds?, toolCalls?, tokensIn?, tokensOut?, spentUsd?, model?, report? (clipped at 4,000 characters; reportCut says it was), error? — agent: the sub-agent's run is over; the whole report is the call's tool result (a background one's reaches the loop later as a subagent-report). model: a coding agent's sub-agent's, where its agent names it only at its end (Cursor's `cursor/task`)",
  "subagent-report": "round, agentId, description, kind (report|notice|task|overrule|applied|check), task?, state?, sent? — agent: a message from the sub-agent machinery joined the conversation after this round, so the next round's call reads it: a finished sub-agent's report, (notice) the developer's launch announced, (overrule) the developer overruling a saved agent's answer — whose, and to which question; their words are their own note — (applied) the developer's apply of a sub-agent's changes: which files changed under the agent — (check) what came of Filament's check of the folder after the lead applied a worker's change, where its call answered before the verdict — or (task) the task graph's words — a task's end, `task` its id and `state` how it stands now (done, failed, or waiting again once stopped), or the tasks Filament started (no task); sent: a report the developer had kept aside and passed on",
  "subagent-dispatch": "round, agentId, exchange, description, model, view, agent (its type), memory, pause, inform, deliver, followUp?, machine? ({ id, name }: the machine one on another machine works on) — agent: the developer sent a sub-agent off while this turn ran (the harness's spawn widget, the REST route, a follow-up from its viewer); pause: it holds this turn until it reports; deliver false: its report stays with the developer until they send it on. With no turn running the same mark is kept on the session (its transcript's boundaries, type subagent)",
  "subagent-arrival": "round, agentId, exchange, description, status, ms, rounds, toolCalls, delivery (auto|held), error?, machine? — agent: the developer's sub-agent reported while this turn ran; auto: the report went to the main agent (read by the next round's call, a subagent-report), held: it waits for the developer to send it on (the session records a send, which the arrival row reads)",
  "subagent-detached": "round, agentId, report — agent: the developer sent a foreground sub-agent to the background, freeing the call waiting on it (Run in background, BUG-12's Detach); it runs on there. report: its report reaches the main agent when it finishes; false: it is kept for the developer",
  "subagent-ask": "round, parent, agentId, tool, args?, question, ask, to?, options?, plan? — agent: a team's worker's call waits for the developer's answer (HarnessV3-AtHome P2), given through POST /api/sessions/:id/subagents/:sid/answer — or, to lead, its question to its lead (ask_lead, HarnessV3-TaskGraph-v2 TG2-D49; no args), with its options, its pick first, or its plan (plan, TG2-D50); round is the launching call's; ask: the question's number among the worker's, which an answer names (TG2-D42) — never `n`, which numbers the run's events",
  "subagent-ask-end": "round, parent, agentId, answered, to?, by?, allowed?, words?, plan? — agent: the worker's question is settled; answered false: its wait ended with no answer (its stop; to lead: its lead's turn's end — a plan's, its 3 minutes — or its run's end, TG2-D58). by and words: who answered and what it said — its lead's answer to a call, with allowed: whether it lets the call run (TG2-D41); to lead: the lead's or the developer's answer to its question, or to its plan (plan, TG2-D50)",
  look: "round, workers [{ id, run, fromEvent, toEvent, fromRound, toRound, signs }], tokens — agent: a team's lead that reads along (HarnessV3-TaskGraph-v2 §12, engine.supervise) was shown a look at its running workers after this round, so the next round's call reads it: for each worker its sub-agent id, its own run, the events of that run's log the look runs from (exclusive) and to, the rounds those are, and the signs that made it due (plan|change|outside|failure|asks|one-way|compacted); tokens: the look's size, estimated. The lead's conversation keeps only the newest look, so a page reads one again from the workers' runs between these marks (TG2-D22)",
  "envelope-sealed": "round, envelope, agentId, description, sender, subject — agent: another agent's result landed while the loop or a coding agent worked and reached it sealed (HarnessV4_Envelopes_Plan EN2, EN3): the agent read one line — its number (envelope; the log's own n numbers the event), who sent it, its subject — and its report waits with the session until the agent opens it",
  "envelope-opened": "round, envelope, agentId, description, by (tool|wait), id? — agent: a sealed result was opened, whole, oldest first: by the agent's envelope tool (id: its call), or as the agent waited — its wait, the developer's paused launch, its turn's end for its own agents, a coding agent's wake; a subagent-report at the same round says it reached the conversation",
  "envelope-reminder": "round, envelopes — agent: the turn would end with these envelopes still sealed: Filament said so once (EN-D5), and the next end is the agent's",
  "envelope-list": "round, envelopes, at (start|compaction) — agent: these envelopes were still sealed, a line each, none opened (EN-D6): at the turn's start after the developer's message, or after a coding agent compacted its own context. After a compaction of Filament's own the compaction's attached.envelopes says the same",
  waiting: "round, why — agent: the loop waits for sub-agents before going on (why: the developer's paused launch, or the turn's own background launches before it may end)",
  snapshot: "round, ref, commit — agent: the working tree after a round in which the hands wrote, on a hidden git ref (refs/filament/snapshots/…); a fork at this turn checks it out (POST /api/sessions/:id/fork { atTurn, worktree })",
  place: "round, id?, place, home — agent: where a chat's own agent works now moved (HarnessV4_Git_Plan §11): the place (a repository's or a worktree's top folder, as git names it) of the folder its call `id` works in — the file or folder it names, or where its command runs (app/now-in.js) — said once per move; home: it is the chat's folder, said only after the agent worked elsewhere. A helper's calls say none",
  hook: "round, on (pre-tool|post-tool|turn-end|pre-compact|subagent-end), tool?, command, ms, exit, verdict (allow|block), note?, rewrote?, timedOut? — agent: a session hook ran (HarnessV2 §5.6); a turn-end block sends the turn back for one more round",
  steer: "id, kind (note|veto|stop|compact), text, from, at, state (queued), images? ([{ name, mediaType, bytes, ref? }]: the pictures it carries, named, never their bytes; `ref` names one kept beside the run log, GET /api/runs/images/:ref), overrules? ([{ agentId, exchange, name }]: the saved agents' answers a note's words overrule), aside? (true: a fork weighs the note first, and the loop reads it only once its steer-aside passes it), via? ({ row, by }: the row of the page's ⌄ menu it went by — next-step, interrupt, veto, aside — and whether by a key or a click, the owner's of 11-09) — the mailbox, on POST /runs/:id/steer; from lead: a team's lead's message or stop to its worker's run (HarnessV3-AtHome P2). A coding agent's run takes a stop, which cancels the agent's turn, and a note where its run's meta says `steer: live` (HarnessV3-ACP AC3-1: the agent takes words into its running turn)",
  "steer-read": "ids, kinds — the loop read the mailbox at a decision point (with a stop queued, only the stop is taken); a coding agent's run: the agent took the note into its running turn, or — after: true — ran it as its next prompt, its turn having ended first",
  "steer-pictures": "round, ids, refused (the provider's words) — agent: the pictures these steering messages carried did not reach the model: its provider refused a request with images, so the round went again without them (HarnessV3-Tools TL-D17), or — the refusal already known this turn — they were not sent",
  "steer-unread": "ids, kinds — never acted on: the run ended with these still queued, or the loop took them and a stop ended the turn before they reached the model (a note) or ran (a compact); a coding agent's notes its turn ended before taking, which the harness sends as the next message",
  "steer-weighed": "ids, as (command|unsure|words), word? — a coding agent's run: how the run weighed a note against the agent's own commands, said where its words do not go in at once (HarnessV4_Tasks U1). command: it is the agent's own command (`word`), which waits queued for the turn's end and goes as the next message, as typed; unsure: it is shaped like one (`word`) and the agent has not said its commands yet — it waits until the agent says them, or answers without them; words: it waited so and is none of them — it goes in as words",
  "steer-aside": "id, as (weighing|correction|question|work|straight), agent?, answer?, letter?, tasks? ([{ id, name }]), why? — agent: how the fork that weighs the person's note aside goes (the owner's forked steer of 11-04), the note queued with aside: true until it ends. weighing: the fork (`agent`) started on it; correction: the fork found it a correction of the work at hand, and it goes into the mailbox as any note; question: the fork answered it for the person (`answer`), and it leaves the queue unread by the agent — where the answer changes the agent's work, `letter` is what the agent was given sealed; work: the fork planned it as tasks proposed on the agent's graph (`tasks`) and wrote the agent `letter`, sealed, and it leaves the queue; straight: it goes into the mailbox unweighed, or weighed to no end (`why`)",
  "steer-sent": "ids — a coding agent's run: its turn handed these notes to its agent (HarnessV4_Tasks C34) — a note of the developer's waits in Filament until the agent's next tool call starts, or goes at once to interrupt it; from here it can no longer be changed or taken back, and its steer-read says where the agent took it",
  "steer-edit": "id, text — the developer changed a message that still waited (HarnessV4_Tasks C34, PATCH /runs/:id/steer/:sid): these are its words now; its pictures stay",
  "steer-drop": "ids — the developer took back messages that still waited (HarnessV4_Tasks C34, DELETE /runs/:id/steer/:sid): nothing reads them",
  vetoed: "round, tasks, text — agent: the round's tool calls (tasks = their count) were refused on the developer's veto before any ran",
  stopped: "round, text, finished — agent: the developer stopped the turn (finished = tool calls completed)",
  "agent-notice": "round, severity (info|warning|error, or the agent's own), title, description?, subagent? — agent: a coding agent told the person something beside its answer (HarnessV4_Tasks C21; ACP's session notices, which Filament declares): Claude's adapter says a model fallback, a hook that blocked its turn, Fast mode turned off. Plain text; the page draws it on a line of its own and it is none of the reply's words — a client that draws no card gets it as a line of the reply. round: the round it came in, 0 before the agent's first model call; subagent: one of its sub-agents said it",
  notice: "kind (ask|permission|stop|output|compaction|window), text, quoted? — agent: Filament's note the reply is about to end on, for clients that draw no card — text is the note's words exactly, which the reply's last text ends with; quoted: a stop that came with the developer's words, which the note quotes (HarnessV3-Launch LD-D7: the harness leaves the copy out where its card says it)",
  "force-stop": "from — published by the run log: the developer's Force stop; an agent turn ends at once, whatever its loop was waiting on (the stop it had not read)",
  "replay-turn":
    "n, of, i, status (ok|error), original { requestId, status, sentTokens, historyTokens, inputTokens, outputTokens, cacheReadTokens, costUsd, ms, strategy }, replay { the same }, error? — replay-compare (HarnessV2 §10.6): one replayed turn of the source session against its copy under another preset; the run's summary carries every row and both totals",
});
export const RUN_EVENT_TYPES = Object.freeze({
  lifecycle: Object.freeze(["run-start", "run-end", "turn-state", "budget", "output-cut", "notice"]),
  context: Object.freeze(["compacting", "compaction", "window", "held", "round-cache"]),
  rounds: Object.freeze(["round-start", "round-text", "round-thinking", "round-writing", "round-written", "agent-notice", "ask", "ask-end"]),
  hands: Object.freeze(["tool-start", "tool-output", "tool-end", "tool-errors", "shell-exit", "instructions-told", "plan", "graph", "visual", "visual-writing", "artifact", "routine", "permission-offer", "snapshot", "place", "hook"]),
  subagent: Object.freeze(["subagent-start", "subagent-run", "subagent-tool-start", "subagent-tool-end", "subagent-tool-errors", "subagent-held", "subagent-plan", "subagent-words", "subagent-end", "subagent-report", "subagent-dispatch", "subagent-arrival", "subagent-detached", "subagent-ask", "subagent-ask-end", "waiting", "look", "envelope-sealed", "envelope-opened", "envelope-reminder", "envelope-list"]),
  steering: Object.freeze(["steer", "steer-read", "steer-pictures", "steer-unread", "steer-weighed", "steer-aside", "steer-sent", "steer-edit", "steer-drop", "vetoed", "stopped", "force-stop"]),
  replay: Object.freeze(["replay-turn"]),
});
export const RUN_EVENT_TYPE_LIST = Object.freeze(Object.values(RUN_EVENT_TYPES).flat());
// `compact` (BUG-21): the developer's Compact during a running agent turn — the loop folds its older rounds at its
// next step instead of the page refusing until the turn ends.
const STEER_KINDS = new Set(["note", "veto", "stop", "compact"]);
const MAX_MAILBOX = 50;

/**
 * The pictures a message carries, read from what was sent: each an image by its type, with its base64. One that is
 * not is the message's refusal, in words.
 * @param {unknown} sent @returns {{ images: SteerImage[] } | { error: string }}
 */
export function readImages(sent) {
  if (sent == null) return { images: [] };
  if (!Array.isArray(sent)) return { error: "images must be a list of { name, mediaType, data }" };
  /** @type {SteerImage[]} */
  const images = [];
  for (const [i, p] of sent.entries()) {
    const mediaType = String(p?.mediaType || "");
    const data = typeof p?.data === "string" ? p.data : "";
    if (!/^image\/[\w.+-]+$/.test(mediaType)) return { error: `image ${i + 1} is no picture: its mediaType must be an image's (image/png, image/jpeg…)` };
    if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) return { error: `image ${i + 1} carries no base64 data` };
    images.push({ name: String(p?.name || `picture ${i + 1}`).slice(0, 200), mediaType, data });
  }
  return { images };
}
/**
 * The way a message was sent, as the page says it, kept where it has the shape of one: anything else is left out, so a
 * caller's odd field never rides the run's events. @param {any} via @returns {SteerVia | null}
 */
function viaOf(via) {
  const row = String(via?.row || "");
  return /^[a-z][a-z-]{0,39}$/.test(row) && (via.by === "key" || via.by === "click" || via.by === "auto") ? { row, by: via.by } : null;
}
/**
 * A message as the run's events and the mailbox's answer name it: its pictures by name, type and size, without their
 * bytes, and each one kept beside the run's log by its ref (`refs`, one place per picture: V4-D303).
 * @param {SteerMessage} m @param {(string | null)[]} [refs] @returns {SteerShown}
 */
function shownOf(m, refs = []) {
  const { images, ...words } = m;
  if (!images?.length) return words;
  return { ...words, images: images.map((p, i) => ({ name: p.name, mediaType: p.mediaType, bytes: (p.data.length * 3) / 4 - (p.data.endsWith("==") ? 2 : p.data.endsWith("=") ? 1 : 0), ...(refs[i] ? { ref: String(refs[i]) } : {}) })) };
}

/** Who sends a message the developer typed: the page (`harness`), and a caller of the steer route that names no sender,
 *  which a steer keeps as `chat` (`steer`'s own default). */
const TYPED_FROM = new Set(["harness", "chat"]);
/**
 * Whether the developer typed the message: theirs to change or take back while it waits. Its sender is the page's, or
 * none named (absent, or the steer's own `chat`); any other — a team's lead, the agent that planned a worker's task,
 * Filament, the developer's answer Filament relays, or a sender no list here knows — is not theirs.
 * @param {{ from?: string }} m
 */
export const typedByDeveloper = (m) => m?.from == null || m.from === "" || TYPED_FROM.has(String(m.from));
/**
 * A message of the developer's that still waits on a run, to change or take back (HarnessV4_Tasks C34): a note or a
 * veto they typed, still queued, that a coding agent's turn has not handed to its agent. Else why not, in words; `gone`
 * where nothing waits under that id any more.
 * @param {any} entry  the run's entry, or undefined @param {string} id
 * @returns {{ entry: any, m: SteerMessage } | { ok: false, error: string, gone?: boolean }}
 */
function waitingOf(entry, id) {
  if (!entry || entry.meta.kind === "unknown") return { ok: false, error: "no loop is running under that id", gone: true };
  if (entry.meta.endedAt != null) return { ok: false, error: `the run has ended (${entry.meta.status}); nothing waits on it any more`, gone: true };
  /** @type {SteerMessage | undefined} */
  const m = entry.queue.find((/** @type {SteerMessage} */ x) => x.id === String(id || ""));
  if (!m) return { ok: false, error: "that message no longer waits: the agent has it, or it was taken back", gone: true };
  if (m.kind !== "note" && m.kind !== "veto") return { ok: false, error: `a ${m.kind} has no words to change` };
  if (!typedByDeveloper(m)) return { ok: false, error: "only a message you typed can be changed or taken back" };
  if (entry.handed.has(m.id)) return { ok: false, error: `${entry.meta.meta?.agent || "the agent"} has it already: it goes in at its next step`, gone: true };
  return { entry, m };
}

const MAX_LINE_BYTES = 256 * 1024;
const MAX_APPEND_FAILURES = 3;
/** How many run files the log keeps an index of (`FileIndex`): a few numbers each, where a parse kept every event. */
const INDEX_RUNS = 256;
/** How many events apart a file's index marks where a line starts: a page from any number reads at most this many
 *  lines before its first. */
const MARK_EVERY = 256;
/** The newest events a running run keeps in memory however large they are: what is read of what its turn does now,
 *  from memory and never the file (http/admin/system.js `recentEvents`, the newest 200). */
const RING_FLOOR = 200;
/** How much of a run's file one read takes. */
const READ_CHUNK = 1024 * 1024;
/** A sub-agent's own calls, as its launching turn's run carries them: what an ended run's reader may take apart (`calls`). */
export const CALL_TYPES = Object.freeze(["subagent-tool-start", "subagent-tool-end", "subagent-tool-errors"]);
const CALL_SET = new Set(CALL_TYPES);
/** The ended runs whose calls' facts are kept (`apartOf`): a few numbers each, read again where the file changed. */
const APART_RUNS = 16;
/**
 * The launching call a sub-agent's event is of, as the page's alignment finds it: its round as read there (an integer,
 * else 0) and its parent by value (labels.js `roundOf`, `subOf`).
 * @param {any} e
 */
const callKey = (e) => `${Number.isInteger(e.round) ? e.round : 0}\n${JSON.stringify(e.parent ?? null)}`;
/** A call of a launching call, its id by value. @param {string} key @param {any} e */
const callOf = (key, e) => `${key}\n${JSON.stringify(e.id ?? null)}`;
/**
 * What an ended run's reader leaves apart of its sub-agents' calls (`calls: "apart"`): the launching calls whose calls
 * some are left out of (`keys`), each one's first subagent-start by its number with how many calls its card counts —
 * the distinct ids of its starts and ends, what the page's alignment holds of it (`starts`) — and the calls that come
 * whole all the same (`kept`): one with pictures, which the turn's strip draws, or with no end, which its run's end
 * marks where it stood. A launching call with no subagent-start (its run's early events gone) is read whole.
 * @typedef {{ keys: Set<string>, starts: Map<number, number>, kept: Set<string> }} ApartFacts
 */
/** How many run files the sweep reads the times of at once, and decides on between two turns of the event loop. */
const SWEEP_BATCH = 64;

/** The index of the first event numbered past `n`, in a list in number order. @param {RunEvent[]} list @param {number} n */
const afterNumber = (list, n) => {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid].n > n) hi = mid;
    else lo = mid + 1;
  }
  return lo;
};

/**
 * A fresh controller in the state `c` is in — aborted, with its reason, where it was — holding none of its listeners.
 * The reason's stack is read first: an error holds the functions on the stack it was made on until then.
 * @param {AbortController} c
 */
const standIn = (c) => {
  const fresh = new AbortController();
  if (c.signal.aborted) {
    void c.signal.reason?.stack;
    fresh.abort(c.signal.reason);
  }
  return fresh;
};

// The event the log is handing to its subscribers right now, and its JSON once something asked for it: the log
// serialises each event once — for its file, and for every viewer that writes it to a client while it is delivered.
/** @type {RunEvent | null} */
let delivering = null;
/** @type {string | null} */
let deliveringJson = null;

/**
 * An event's JSON, as `JSON.stringify` writes it. While the run log hands a live event to its subscribers it is the
 * log's own string, made once however many viewers follow the run; a replayed event is serialised here.
 * @param {RunEvent} evt @returns {string}
 */
export function eventJson(evt) {
  if (evt !== delivering) return JSON.stringify(evt);
  return (deliveringJson ??= JSON.stringify(evt));
}

/**
 * A run's events after `since`, replayed and then followed live, each handed to `send` exactly once and in order —
 * the one implementation behind the events stream (`http/admin/runs.js`), a page's run socket
 * (`http/admin/run-socket.js`) and the harness turn's reply, which carries its run's events itself
 * (HarnessV3-Responsiveness R3: a second stream per turn cost the page one of its six connections). A run stream is a
 * record, not a feed, so nothing is skipped: the replay is paged and waits for the reader before each write
 * (`needsDrain`/`drained`), live events that land meanwhile queue behind it, and the number check makes a double send
 * impossible. A live event is sent as it lands: a writer whose reader is behind keeps it in the stream's queue
 * (http/events.js `writeHeld`), and cuts off only a reader that stopped reading. At the run's end the follow stops and
 * `onEnded` fires, once: at a live `run-end`, or, for a run that had already ended, as the follow goes live, which can
 * be before `followRunEvents` returns (the bug report's H12: a caller that stopped the follow there had none to stop
 * yet, and the run kept its subscriber, which holds it in memory). `keep` follows on past the end, for a viewer that
 * holds its stream open, and says nothing of it. `send` answering false stops the follow. A gap in a page of the replay
 * after the first (events the ring let go of while it ran, a file that would not read) goes to `onGap`, as the first
 * page's goes to its caller, and the replay goes on past it: never a silent skip.
 * @param {RunLog} runs
 * @param {string} id
 * @param {{ events: RunEvent[], run: RunMeta }} page  the first page, `runs.events(id, { since, limit: pageSize })` —
 *   the caller answers a run that does not exist
 * @param {{ since?: number, pageSize?: number, send: (evt: RunEvent) => boolean, needsDrain?: () => boolean,
 *   drained?: () => Promise<unknown>, onEnded?: (status: string) => void, onGap?: (gap: { requested: number, firstAvailable: number }) => void, keep?: boolean }} o
 * @returns {{ stop: () => void, live: Promise<void> }}  `live` settles once the replay is done (or the follow stopped)
 */
export function followRunEvents(runs, id, page, o) {
  const { since = 0, pageSize = 5000, send, needsDrain = () => false, drained = () => Promise.resolve(), onEnded = () => {}, onGap = () => {}, keep = false } = o;
  let stopped = false;
  let last = since;
  let replaying = true;
  /** @type {RunEvent[]} */
  const backlog = [];
  /** @param {RunEvent} evt */
  const deliver = (evt) => {
    if (evt.n <= last) return true;
    last = evt.n;
    return send(evt);
  };
  /** @param {string} status */
  const ended = (status) => {
    if (stopped || keep) return;
    stop();
    onEnded(status);
  };
  /** @type {(() => void) | null} */
  let unsubscribe = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe?.();
  };
  unsubscribe = runs.subscribe(id, (evt) => {
    if (stopped) return;
    if (replaying) return void backlog.push(evt);
    if (!deliver(evt)) return stop();
    if (evt.type === "run-end") ended(String(/** @type {any} */ (evt).status || "ended"));
  });
  // Each write of the replay waits for the reader first — the first one too: the stream may be full already (a large
  // words frame just went ahead of it), and the replay is what keeps a lagging reader's queue short.
  const live = (async () => {
    let batch = page;
    for (;;) {
      for (const evt of batch.events) {
        if (needsDrain()) await drained();
        if (stopped) return;
        if (!deliver(evt)) return stop();
      }
      if (batch.events.length < pageSize) break;
      const next = runs.events(id, { since: last, limit: pageSize });
      if (next?.gap) onGap(next.gap);
      if (!next || !next.events.length) break;
      batch = next;
    }
    // The backlog grows while it drains (events keep landing until the flag flips), so it is walked by index and
    // waits for the reader like the replay does: a burst that lands mid-flush is delivered, never skipped.
    for (let i = 0; i < backlog.length; i++) {
      if (needsDrain()) await drained();
      if (stopped) return;
      if (!deliver(backlog[i])) return stop();
    }
    backlog.length = 0;
    replaying = false;
    // A run that ended before the follow went live — before it began, or during the replay — ends it here.
    const run = runs.getRun(id) || page.run;
    if (run?.endedAt != null) ended(String(run.status || "ended"));
  })();
  return { stop, live };
}

/**
 * How many days a run's file is kept past its last write (`observability.runEvents.retentionDays`, 7 unless said; 0
 * keeps them): what is kept of a run elsewhere, past the process, goes by it too.
 * @param {any} cfg  the configuration
 */
export function runRetentionDays(cfg) {
  const k = cfg?.observability?.runEvents || {};
  return Number.isFinite(Number(k.retentionDays)) ? Number(k.retentionDays) : 7;
}

/**
 * @param {{ events: EventBus, dataDir: string, config: () => any, log?: (level: string, msg: string) => void, ops?: any, now?: () => number,
 *   sweepAfter?: Promise<unknown>, settles?: readonly string[] }} args
 *   `config` is the live getter (knobs are read per call, so a save applies without a restart); `ops` records the
 *   run-start / run-end operations (kind `run`, counts only) when given. `sweepAfter`: every sweep waits for it — the
 *   server's start hands in the end of what it settles of the runs an earlier process left open (`openOnDisk`), so no
 *   file is removed before it is read — true where that start went over every one of them. `settles`: the kinds of run
 *   that start settles; past its retention, the file of such a run left open — its last line no run-end — goes only
 *   once `sweepAfter` said true: until a start has gone over it, its log may be the one record of its work.
 * @returns {RunLog}
 */
export function createRunLog({ events, dataDir, config, log = () => {}, ops = null, now = Date.now, sweepAfter = Promise.resolve(), settles = [] }) {
  const dir = join(dataDir, "runs");
  const knobs = () => {
    const k = config()?.observability?.runEvents || {};
    return {
      persist: k.persist !== false,
      retentionDays: runRetentionDays(config()),
      maxPerRun: Math.max(100, Number(k.maxPerRun) || 20000),
      ringMB: Number.isFinite(Number(k.ringMB)) ? Math.max(0, Number(k.ringMB)) : 4,
      keepRuns: Math.max(10, Number(k.keepRuns) || 200),
      imagesMaxMB: Number.isFinite(Number(k.imagesMaxMB)) ? Math.max(0, Number(k.imagesMaxMB)) : 500,
    };
  };
  /** @type {Map<string, { meta: RunMeta, ring: RunEvent[], sizes: number[], ringChars: number, ringGone: boolean, fileGap: boolean, asSent: Map<number, { evt: RunEvent, size: number }>, asSentChars: number, subscribers: Set<(evt: RunEvent) => void>, fileBroken: number, fd: number, ended: boolean, queue: SteerMessage[], waiters: Set<() => void>, stopper: AbortController, forcer: AbortController, asks: Map<string, OpenAsk>, waitingAsks: Map<string, RunEvent>, movers: Map<string, () => { id: string } | null>, handed: Set<string>, asides: SteerAsides | null }>} */
  const runs = new Map();
  /** @param {string} id */
  const fileOf = (id) => join(dir, `${id}.jsonl`);
  // Every run file on disk, by id, with its size and modification time: what the runs list and the run-exists check
  // answer from (the list is polled about every 750 ms and the transcript asks for every turn it lists, and each used
  // to read the directory or stat a file). Read from the directory once as the log starts, then kept by the log itself
  // — the one writer of these files — as it appends, sweeps and lets runs leave memory. A run's time here matters only
  // once it has left memory (the list shows a run in memory by its meta), so it is read from the file then.
  /** @type {Map<string, { size: number, mtimeMs: number, unread?: true }>} */
  const files = new Map();
  /** The file's size and time as the disk has them now; one that is gone leaves the index. @param {string} id */
  const noteFile = (id) => {
    try {
      const st = statSync(fileOf(id));
      files.set(id, { size: st.size, mtimeMs: st.mtimeMs });
    } catch (/** @type {any} */ e) {
      // A file the disk listed but would not stat (a scan or another process holding it) is listed as the directory
      // read once did, with no time, and stat-ed again whenever it is asked about (`fileNow`): a refusal that passes
      // does not hide its run until the next start.
      if (e?.code === "ENOENT") files.delete(id);
      else files.set(id, { size: 0, mtimeMs: 0, unread: true });
    }
  };
  /** The index's word on a run's file, stat-ed again first where the disk would not say before. @param {string} id */
  const fileNow = (id) => {
    if (files.get(id)?.unread) noteFile(id);
    return files.get(id);
  };
  // The pictures the runs' calls handed their models, beside the run files (HarnessV4_Tasks U9).
  const images = createRunImages({ dir: join(dir, "images"), knobs, log });
  /** One picture a message carries, kept as a call's are (V4-D303): its ref, or null where it is not kept. @param {string} data */
  const keepSent = (data) => images.keep([{ data }]).images[0]?.ref || null;
  let dirReady = false;
  const ensureDir = () => {
    if (dirReady) return true;
    try {
      mkdirSync(dir, { recursive: true });
      dirReady = true;
    } catch (/** @type {any} */ e) {
      log("warn", `run log: ${dir} could not be created (${e.message}); runs are kept in memory only`);
    }
    return dirReady;
  };
  const op = (title, opts) => {
    if (!ops) return;
    try {
      ops.record("run", title, opts);
    } catch (/** @type {any} */ e) {
      log("warn", `run log: an operation could not be recorded (${e.message})`);
    }
  };
  /** A run let go of from memory: read from its file from then on, and listed from the index, by its file's time. @param {any} entry */
  const leaveMemory = (entry) => {
    runs.delete(entry.meta.id);
    letGoOfFile(entry);
    if (files.has(entry.meta.id)) noteFile(entry.meta.id);
  };
  // Runs are bounded in memory. Ended runs leave first, oldest first; a running run is never evicted (its producer
  // is still writing). What leaves memory stays on disk until the sweep, so `events()` can still answer from the file.
  const evict = () => {
    const { keepRuns } = knobs();
    if (runs.size <= keepRuns) return;
    const ended = [...runs.values()]
      .filter((r) => r.meta.endedAt != null && !r.subscribers.size)
      .sort((a, b) => (a.meta.endedAt || 0) - (b.meta.endedAt || 0));
    for (const r of ended) {
      if (runs.size <= keepRuns) break;
      leaveMemory(r);
    }
  };
  /**
   * @param {string} id
   * @param {{ kind?: string, title?: string | null, parentId?: string | null, meta?: any }} [init]
   */
  const create = (id, { kind = "unknown", title = null, parentId = null, meta = null } = {}) => {
    const entry = {
      meta: /** @type {RunMeta} */ ({
        id,
        kind,
        title,
        parentId,
        startedAt: now(),
        endedAt: null,
        status: "running",
        summary: null,
        meta,
        events: 0,
        firstAvailable: 0,
        persisted: false,
      }),
      ring: /** @type {RunEvent[]} */ ([]),
      // Each ring event's JSON, in characters (0 where it was not serialised: persistence off), and their sum.
      sizes: /** @type {number[]} */ ([]),
      ringChars: 0,
      // An ended run whose file holds every event keeps no ring (`endRun`), until it starts again.
      ringGone: false,
      // An event did not reach the file (persistence off, an append that failed): the ring is then the one copy of what
      // it holds, kept by count alone, and kept past the run's end.
      fileGap: false,
      /**
       * The events the file holds otherwise than they were published, by number — a key redacted out of the line, a
       * body that could not be kept beside it — read from here in place of the file's while the run runs, the newest up
       * to `ringMB` of JSON (`asSentChars`): an older one, and any once the run has ended, reads as its file holds it.
       * @type {Map<number, { evt: RunEvent, size: number }>}
       */
      asSent: new Map(),
      asSentChars: 0,
      subscribers: new Set(),
      fileBroken: 0,
      // The run's file, held open while it runs (`append`): -1 when it is not.
      fd: -1,
      // Whether its run's end is recorded — here, or in the file it was made from: what comes after it says so (`afterEnd`).
      ended: false,
      queue: /** @type {SteerMessage[]} */ ([]),
      waiters: new Set(),
      // Aborted by a `stop` steer: the loop cuts its in-flight work on it (the mailbox hands it over as `stopSignal`).
      stopper: new AbortController(),
      // Aborted by a Force stop: the agent loop ends the turn at once (`forceSignal`).
      forcer: new AbortController(),
      /** The questions the run waits on the person to answer, by id (HarnessV3-ACP AC2-4). @type {Map<string, OpenAsk>} */
      asks: new Map(),
      /**
       * Its asks the chat lists that wait still, by id (`askOf` in `record`): each its `ask` event, until its `ask-end`
       * — read whole however long the turn ran since (`waitingAsks`), and ended with the run (`endRun`).
       * @type {Map<string, RunEvent>}
       */
      waitingAsks: new Map(),
      /**
       * The commands running in the foreground the developer may send to the background, by call id: each the way to
       * do it (HarnessV4_Four_Plan E21). @type {Map<string, () => { id: string } | null>}
       */
      movers: new Map(),
      /**
       * The messages a coding agent's turn handed to its agent, by id (HarnessV4_Tasks C34): still queued until the agent
       * takes them, and no longer the developer's to change or take back. @type {Set<string>}
       */
      handed: new Set(),
      /** What weighs the person's notes aside, while the run's turn sets it (the owner's forked steer of 11-04). @type {SteerAsides | null} */
      asides: null,
    };
    // A file under this id already exists (a viewer opened an ended run, or a producer reuses an id after a restart):
    // the entry starts from what the file says — numbering continues, an ended run stays ended — instead of a second
    // run 1..K that would overlap the first on disk and show as "running" forever.
    const onDisk = indexOf(id);
    if (onDisk?.count) {
      const m = metaOfIndex(id, onDisk);
      entry.meta = { ...m, kind: kind === "unknown" ? m.kind : kind, title: title ?? m.title, parentId: parentId ?? m.parentId, meta: meta ?? m.meta, firstAvailable: 0 };
      // Ended where the file's newest start or end is an end (a producer that reuses an id starts the run again), and
      // then read from its file, as an ended run is (`ringGone`).
      entry.ended = onDisk.ended;
      entry.ringGone = onDisk.ended;
    }
    runs.set(id, entry);
    evict();
    return entry;
  };
  // A running run holds its file open: one open for its life, a write per event, the close at its end. Its events come
  // as fast as a command prints or a sub-agent writes (a sub-agent's tool events land on its own run and its parent's),
  // and an open and a close for each would cost more than its write. A run that is not running — ended, or with events
  // before its start — appends with an open and a close of its own: an event after the end (a background sub-agent
  // reporting into its parent's run) is rare, and nothing holds a file its run will not write again. The file is opened
  // with Node's default sharing, so a reader, the sweep or a delete is never locked out of it on Windows.
  /** @param {any} entry @param {Buffer} buf @returns {boolean} whether it went through the file the run holds open */
  const append = (entry, buf) => {
    if (entry.fd < 0 && entry.meta.endedAt == null && entry.meta.kind !== "unknown") {
      // What the file holds already (a producer that reuses an id) is indexed as the run takes it, and from here each
      // line as it is written (`record`): a running run's file is not read again to find a page of it.
      const idx = indexOf(entry.meta.id) || emptyIndex();
      entry.fd = openSync(fileOf(entry.meta.id), "a");
      idx.held = true;
      keepIndex(entry.meta.id, idx);
    }
    if (entry.fd < 0) {
      appendFileSync(fileOf(entry.meta.id), buf);
      return false;
    }
    for (let at = 0; at < buf.length; ) at += writeSync(entry.fd, buf, at, buf.length - at);
    return true;
  };
  /** The run's file let go of: at its end, as it leaves memory, after a failed write, at shutdown. @param {any} entry */
  const letGoOfFile = (entry) => {
    if (entry.fd < 0) return;
    const fd = entry.fd;
    entry.fd = -1;
    try {
      closeSync(fd);
    } catch {}
    // Its index was kept by its appends; from here a read checks it against the file's size and time, taken now.
    const id = entry.meta.id;
    const idx = indexes.get(id);
    if (!idx?.held) return;
    idx.held = false;
    try {
      const st = statSync(fileOf(id));
      if (st.size === idx.size) idx.mtimeMs = st.mtimeMs;
      else indexes.delete(id);
    } catch {
      indexes.delete(id);
    }
  };
  /** The oldest `k` events let go of from a run's ring. @param {any} entry @param {number} k */
  const dropOldest = (entry, k) => {
    if (k <= 0) return;
    for (let i = 0; i < k; i++) entry.ringChars -= entry.sizes[i];
    entry.ring.splice(0, k);
    entry.sizes.splice(0, k);
    entry.meta.firstAvailable = entry.ring[0]?.n ?? 0;
  };
  // One event onto the run: numbered, appended, ringed, delivered. The append is synchronous so the file order is the
  // number order (two async appends to one path may land out of order). The event is serialised once: its JSON goes
  // to the file, redacted, and as published to every viewer that writes it to a client while it is delivered
  // (`eventJson`). The ring keeps the run's newest events in memory: by count (`maxPerRun`), and, where the file holds
  // every event so what leaves the ring is read from there, by the size of their JSON too (`ringMB`), never fewer than
  // the newest `RING_FLOOR`. An event whose body is kept beside the file is held as its envelope (`stubs`), the body read
  // back when the event is: a task graph's snapshot runs to half a megabyte, 28 of them in one run's first 200 events.
  const record = (entry, /** @type {any} */ payload, seq) => {
    const { maxPerRun, persist, ringMB } = knobs();
    const n = entry.meta.events + 1;
    entry.meta.events = n;
    /** @type {RunEvent} */
    const evt = { ...payload, n, seq, ts: now(), runId: entry.meta.id, type: String(payload?.type || "event") };
    // An event after its run's end says so: its file then reads as ended at its last line (`headLeftOpen`).
    if (evt.type === "run-start") {
      entry.ended = false;
      entry.ringGone = false;
    } else if (evt.type === "run-end") entry.ended = true;
    else if (entry.ended) evt.afterEnd = true;
    /** @type {string | null} */
    let json = null;
    let filed = false;
    /** @type {RunEvent | null} */
    let stub = null;
    if (persist && entry.fileBroken < MAX_APPEND_FAILURES && ensureDir()) {
      const id = entry.meta.id;
      try {
        // The file is durable like ops.jsonl, so the same redaction pass runs before the append: an upstream error
        // body that echoed a key (a tool's error) must not outlive the turn on disk. The live view keeps the bytes as
        // published: the ring, and past it `asSent`.
        json = JSON.stringify(evt);
        const redacted = redactSecrets(json);
        let line = redacted;
        let verbatim = redacted === json;
        /** The line's event where the line is its envelope. @type {any} */
        let enveloped;
        // A payload this large is a body, not an event: it is kept whole in a file of its own beside the run's
        // (`bodies/<id>/<n>.json`), and its line is an envelope that names it, so the numbering stays intact and a read
        // puts the body back. Where it cannot be kept, the envelope says only its size.
        const bytes = Buffer.byteLength(line, "utf8");
        if (bytes > MAX_LINE_BYTES) {
          const kept = keepBody(id, n, redacted);
          if (!kept) verbatim = false;
          // Its call's id and tool's name ride on it: a reader of what a turn does now reads those of an envelope.
          const { id: callId, name } = /** @type {any} */ (evt);
          const envelope = { n, seq, ts: evt.ts, runId: evt.runId, type: evt.type, ...(evt.afterEnd ? { afterEnd: true } : {}), ...(typeof callId === "string" && callId.length < 200 ? { id: callId } : {}), ...(typeof name === "string" && name.length < 200 ? { name } : {}), truncated: bytes, ...(kept ? { body: true } : {}) };
          line = JSON.stringify(envelope);
          enveloped = envelope;
          if (kept) stubs.add((stub = /** @type {RunEvent} */ (envelope)));
        }
        // A file this process does not hold whose last line a process that died left half written (its index reads to
        // its last whole line): the event starts a line of its own. Glued to the half line, the run's end the next start
        // writes read as no end, and the start after found the run open again.
        const lead = entry.fd < 0 && tornTail(id) ? "\n" : "";
        const buf = Buffer.from(lead + line + "\n", "utf8");
        const at = files.get(id)?.size || 0;
        const held = append(entry, buf);
        entry.meta.persisted = true;
        entry.fileBroken = 0;
        filed = true;
        if (!verbatim && !entry.ringGone) {
          entry.asSent.set(n, { evt, size: json.length });
          entry.asSentChars += json.length;
          for (const [k, was] of entry.asSent) {
            if (entry.asSentChars <= ringMB * 1e6 || k === n) break;
            entry.asSent.delete(k);
            entry.asSentChars -= was.size;
          }
        }
        const known = files.get(id);
        files.set(id, { size: (known?.size || 0) + buf.length, mtimeMs: known?.mtimeMs || 0 });
        // A run already out of memory (evicted as it was made) is listed by its file's time: read it now.
        if (runs.get(id) !== entry) noteFile(id);
        // A file the run holds open is written by this log alone, in whole lines, so its index takes each line as a
        // fresh read would: a long run's file is not read again to find a page of it, and once the run lets go of it
        // the next read indexes only what came after. Any other append is the next read's: the file has grown, and its
        // new lines are indexed then.
        const idx = held ? indexes.get(id) : undefined;
        if (idx?.held && idx.size !== at) indexes.delete(id);
        else if (idx?.held) {
          noteEvent(idx, verbatim || (evt.type !== "run-start" && evt.type !== "run-end") ? evt : JSON.parse(redacted), at + lead.length, enveloped);
          idx.size = idx.bytes = at + buf.length;
        }
      } catch (/** @type {any} */ e) {
        // A failed append is not the turn's problem. Three in a row and the run stays in memory only (a disk that is
        // full does not recover per event); one that recovers is written again from the next event on, through a file
        // opened afresh, and indexed afresh (a write that failed half way left a torn line).
        letGoOfFile(entry);
        indexes.delete(id);
        entry.fileBroken++;
        if (entry.fileBroken === MAX_APPEND_FAILURES)
          log("warn", `run log: ${entry.meta.id} could not be appended (${e.message}); this run stays in memory only`);
      }
    }
    if (!filed) entry.fileGap = true;
    // An ended run whose file holds it keeps no ring (`endRun`): an event after its end (a background sub-agent's
    // report) is read from the file with the rest.
    if (!(entry.ringGone && filed && !entry.fileGap)) {
      const asStub = filed ? stub : null;
      const size = asStub ? JSON.stringify(asStub).length : json ? json.length : 0;
      entry.ring.push(asStub || evt);
      entry.sizes.push(size);
      entry.ringChars += size;
      if (entry.ring.length > maxPerRun) dropOldest(entry, entry.ring.length - maxPerRun);
      // The size too, at the count's cap as below it: a run whose first `maxPerRun` events were small held its next
      // `maxPerRun` whatever their size.
      if (!entry.fileGap && entry.ringChars > ringMB * 1e6) {
        // Down to three quarters of the cap at once, never under the floor: a run past its cap lets a stretch go, not
        // an event at each event. An event too large for a line whose body could not be kept counts toward no floor.
        let k = 0;
        for (let chars = entry.ringChars; chars > ringMB * 75e4 && (entry.ring.length - k > RING_FLOOR || entry.sizes[k] > MAX_LINE_BYTES); k++) chars -= entry.sizes[k];
        dropOldest(entry, k);
      }
    }
    // A coding agent's question that waits for the person, opened or settled (the remote desk of 11-22), and the card the
    // chat's own agent waits on for a command on another machine (agent/loop.js `askThere`): said on the events feed by
    // its chat and its id as the chat's asks name it (http/admin/sessions.js `agentAsks`) — its words stay in the run —,
    // so another machine's desk reads the chat's asks again at once, not at its next look.
    const askOf = (entry.meta.kind === "coding-agent" || entry.meta.kind === "agent-turn") && (evt.type === "ask" || evt.type === "ask-end") ? String(entry.meta.meta?.chain || "") : "";
    const ask = /** @type {any} */ (evt);
    // Its listeners' failure is theirs: the run's own followers below hear the event all the same.
    if (askOf && typeof ask.id === "string" && ask.id && (ask.type === "ask-end" || (ask.waits === true && ask.kind !== "lead"))) {
      if (ask.type === "ask") entry.waitingAsks.set(ask.id, evt);
      else entry.waitingAsks.delete(ask.id);
      try {
        events.publish("turns", { type: "ask", chainId: askOf, id: `${entry.meta.id}.${ask.id}`, open: ask.type === "ask" });
      } catch (/** @type {any} */ e) {
        log("warn", `run log: an ask's word on the feed failed (${e.message})`);
      }
    }
    if (!entry.subscribers.size) return;
    const was = delivering;
    const wasJson = deliveringJson;
    delivering = evt;
    deliveringJson = json;
    try {
      for (const fn of entry.subscribers) {
        try {
          fn(evt);
        } catch (/** @type {any} */ e) {
          log("warn", `run log: a subscriber failed (${e.message})`);
        }
      }
    } finally {
      delivering = was;
      deliveringJson = wasJson;
    }
  };
  // A run's file, read back by pages. What the log keeps of a file is its index (`FileIndex`): where every
  // MARK_EVERY-th event's line starts, and what its lines say of the run — its first start, its last end, its count,
  // its first and last numbers — never its events, so a page reads from the mark before it to its last event and
  // nothing else stays in memory (the crashes of 11-14: an ended run's every event was read back whole and kept, as
  // the ring of a running one was). A file that grew — a run's appends, the only way one is written — has its new lines
  // indexed alone, from its last whole line read (the 10-29 speed pass), and the file a running run holds open is
  // indexed by its appends instead. A run with no file (the index of the run files says) costs no look at the disk.
  // Bad lines are skipped rather than failing the whole read.
  /**
   * @typedef {{ size: number, mtimeMs: number, bytes: number, held: boolean, count: number, marks: number[], firstN: number,
   *   lastN: number, firstTs: number, lastTs: number, start: any, end: any, ended: boolean, rounds: number,
   *   lastGraph: number, graphApart: boolean, agents: boolean }} FileIndex
   *   `size` and `mtimeMs`: the file's as it was last indexed; `bytes`: up to the end of its last whole line; `held`:
   *   its running run holds it open, and its appends keep it current; `marks`: an event's number and where its line
   *   starts, flat, for every MARK_EVERY-th event; `start`, `end`: its first run-start's and last run-end's fields that
   *   say the run's meta; `ended`: its newest start or end is an end; `rounds`: its round-starts; `lastGraph`: its last
   *   task-graph event that carries its graph — a whole line, or an envelope whose body was kept —, and `graphApart`
   *   whether that one's body is kept beside the file; `agents`: a subagent-start is among its events (`apartOf`)
   */
  /** @type {Map<string, FileIndex>} */
  const indexes = new Map();
  /** The rings' envelopes of events whose body is kept beside their file (`record`). @type {WeakSet<object>} */
  const stubs = new WeakSet();
  /** @returns {FileIndex} */
  const emptyIndex = () => ({ size: 0, mtimeMs: 0, bytes: 0, held: false, count: 0, marks: [], firstN: 0, lastN: 0, firstTs: 0, lastTs: 0, start: null, end: null, ended: false, rounds: 0, lastGraph: 0, graphApart: false, agents: false });
  /** An index kept as the newest used, the oldest let go of past INDEX_RUNS — never one its run holds open. @param {string} id @param {FileIndex} idx */
  const keepIndex = (id, idx) => {
    indexes.delete(id);
    indexes.set(id, idx);
    if (indexes.size > INDEX_RUNS)
      for (const [old, x] of indexes) {
        if (indexes.size <= INDEX_RUNS) break;
        if (!x.held && old !== id) indexes.delete(old);
      }
    return idx;
  };
  /**
   * One event of a file noted in its index, its line starting at `at`; `line`: the event as its line has it, where that
   * is its envelope (`record`'s appends note the event itself).
   * @param {FileIndex} idx @param {any} e @param {number} at @param {any} [line]
   */
  const noteEvent = (idx, e, at, line = e) => {
    if (idx.count % MARK_EVERY === 0) idx.marks.push(e.n, at);
    if (!idx.count) {
      idx.firstN = e.n;
      idx.firstTs = e.ts;
    }
    idx.count++;
    idx.lastN = e.n;
    idx.lastTs = e.ts;
    if (e.type === "run-start") {
      idx.start ??= { ts: e.ts, kind: e.kind, title: e.title, parentId: e.parentId, meta: e.meta };
      idx.ended = false;
    } else if (e.type === "run-end") {
      idx.end = { ts: e.ts, status: e.status, summary: e.summary };
      idx.ended = true;
    } else if (e.type === "round-start") idx.rounds++;
    else if (e.type === "subagent-start") idx.agents = true;
    else if (e.type === "graph" && (line.truncated == null ? line.graph != null : line.body === true)) {
      idx.lastGraph = e.n;
      idx.graphApart = line.truncated != null;
    }
  };
  // The bodies of events too large for a line (MAX_LINE_BYTES), each whole in a file of its own beside the run's.
  const bodiesDir = join(dir, "bodies");
  /** @param {string} id @param {number} n */
  const bodyOf = (id, n) => join(bodiesDir, id, `${n}.json`);
  /** An event's body kept beside its run's file: whether it was. @param {string} id @param {number} n @param {string} text */
  const keepBody = (id, n, text) => {
    try {
      mkdirSync(join(bodiesDir, id), { recursive: true });
      writeFileSync(bodyOf(id, n), text);
      return true;
    } catch (/** @type {any} */ e) {
      log("warn", `run log: event ${n} of ${id} is too large for a line and could not be kept beside it (${e.message})`);
      return false;
    }
  };
  /**
   * One line of a run's file as its event, with its body put back where it was kept apart (all of them, or only a
   * run-start's or a run-end's, which say the run's meta: `startsOnly`); null for a line that is no event.
   * @param {string} id @param {Buffer} line @param {boolean} startsOnly @returns {RunEvent | null}
   */
  const parseLine = (id, line, startsOnly) => {
    let e;
    try {
      e = JSON.parse(line.toString("utf8"));
    } catch {
      return null;
    }
    if (!e || typeof e.n !== "number") return null;
    if (e.body !== true || (startsOnly && e.type !== "run-start" && e.type !== "run-end")) return e;
    return withBody(id, e);
  };
  /** An envelope's event with its body put back from beside its run's file; the envelope where it would not read.
   *  @param {string} id @param {any} e @returns {RunEvent} */
  const withBody = (id, e) => {
    try {
      const whole = JSON.parse(readFileSync(bodyOf(id, e.n), "utf8"));
      if (whole && whole.n === e.n) return whole;
    } catch {}
    return e;
  };
  /** A task-graph event without its graph: a copy, the ring's own left as it is. @param {any} e @returns {RunEvent} */
  const withoutGraph = ({ graph, ...rest }) => rest;
  /**
   * The number of an ended run's last task-graph event that carries its graph, the one `events`' `graphs: "last"` keeps
   * it on; 0 where none goes without: a run still running (its next may come), one whose file and ring each hold some of
   * it (a run whose file missed events keeps its ring), or one whose last's body, kept beside the file, is not there.
   * @param {string} id @param {any} live  the run's entry, if in memory
   */
  const lastGraphOf = (id, live) => {
    if (live && live.meta.endedAt == null) return 0;
    const idx = indexOf(id);
    const ring = live ? live.ring : [];
    if (ring.length && idx?.count) return 0;
    // A ring alone is a run kept in memory alone (persistence off), its events whole — or one whose file is gone.
    for (let i = ring.length - 1; i >= 0; i--) if (ring[i].type === "graph" && /** @type {any} */ (ring[i]).graph != null) return ring[i].n;
    if (!idx?.lastGraph) return 0;
    return idx.graphApart && !existsSync(bodyOf(id, idx.lastGraph)) ? 0 : idx.lastGraph;
  };
  /** Each ended run's calls' facts, by its file as it was read (`apartOf`). @type {Map<string, { size: number, mtimeMs: number, facts: ApartFacts | null }>} */
  const apartKept = new Map();
  /**
   * The facts of a run's sub-agents' calls, folded from its events in order (`ApartFacts`); null where one of them is a
   * line too large, its envelope naming no launching call — the run is read whole.
   * @param {(visit: (e: any) => boolean) => void} each  hands each event of the run to `visit`, which answers false to stop
   * @returns {ApartFacts | null}
   */
  const factsOf = (each) => {
    /** @type {Map<string, { start: number, ids: Set<string>, ended: Set<string>, shots: Set<string> }>} */
    const by = new Map();
    const of = (/** @type {string} */ k) => by.get(k) || (by.set(k, { start: 0, ids: new Set(), ended: new Set(), shots: new Set() }), /** @type {any} */ (by.get(k)));
    let enveloped = false;
    each((e) => {
      const call = CALL_SET.has(e.type);
      if (!call && e.type !== "subagent-start") return true;
      if (typeof e.truncated === "number") return !(enveloped = true);
      const k = callKey(e);
      const x = of(k);
      if (!call) x.start ||= e.n;
      else if (e.type !== "subagent-tool-errors") {
        const id = callOf(k, e);
        x.ids.add(id);
        if (e.type === "subagent-tool-end") {
          x.ended.add(id);
          if ((Array.isArray(e.images) && e.images.length) || e.imagesNotKept) x.shots.add(id);
        }
      }
      return true;
    });
    if (enveloped) return null;
    /** @type {ApartFacts} */
    const facts = { keys: new Set(), starts: new Map(), kept: new Set() };
    for (const [k, x] of by) {
      if (!x.start) continue;
      let apart = 0;
      for (const id of x.ids) {
        if (x.ended.has(id) && !x.shots.has(id)) apart++;
        else facts.kept.add(id);
      }
      if (!apart) continue;
      facts.keys.add(k);
      facts.starts.set(x.start, x.ids.size);
    }
    return facts;
  };
  /**
   * What an ended run's reader leaves apart of its sub-agents' calls (`calls: "apart"`), read from its file's calls'
   * lines alone, once while the file stays as it was; null where the run is read whole: one still running (its next
   * calls may come), one its ring still holds — kept in memory alone, or its file missed events: a ring past `maxPerRun`
   * has let go of its first events, so a card's read from the start would say a gap —, one whose file starts past its
   * first event or says it is not over (its newest start or end is a start), one with a line too large among its calls,
   * and one with nothing to leave apart — its index finds no subagent-start among its events, unscanned.
   * @param {string} id @param {any} live  the run's entry, if in memory
   * @returns {ApartFacts | null}
   */
  const apartOf = (id, live) => {
    if (live && (live.meta.endedAt == null || live.ring.length)) return null;
    const idx = indexOf(id);
    if (!idx?.count || !idx.ended || idx.firstN > 1 || !idx.agents) return null;
    const known = apartKept.get(id);
    if (known && known.size === idx.size && known.mtimeMs === idx.mtimeMs) {
      apartKept.delete(id);
      apartKept.set(id, known);
      return known.facts;
    }
    const named = [...CALL_TYPES, "subagent-start"].map((t) => Buffer.from(`"type":${JSON.stringify(t)}`));
    let read = true;
    const facts = factsOf((visit) => {
      try {
        eachLine(id, 0, idx.bytes, (line) => {
          if (!named.some((t) => line.includes(t))) return true;
          const e = parseLine(id, line, true);
          return !e || visit(e);
        });
      } catch {
        read = false;
      }
    });
    if (!read) return null;
    // Nothing left apart: read whole, as a run with no sub-agent is — no question asked of each event.
    const some = facts?.keys.size ? facts : null;
    apartKept.delete(id);
    apartKept.set(id, { size: idx.size, mtimeMs: idx.mtimeMs, facts: some });
    while (apartKept.size > APART_RUNS) apartKept.delete(/** @type {string} */ (apartKept.keys().next().value));
    return some;
  };
  /**
   * Each whole line of a run's file between two byte offsets, read READ_CHUNK at a time: `visit` gets the line, where
   * it starts and where the next begins, and stops the read by answering false. A last line with no newline yet is not
   * read: the next read takes it, whole.
   * @param {string} id @param {number} from @param {number} to @param {(line: Buffer, at: number, next: number) => boolean | void} visit
   */
  const eachLine = (id, from, to, visit) => {
    const fd = openSync(fileOf(id), "r");
    try {
      let at = from;
      let carry = Buffer.alloc(0);
      while (at + carry.length < to) {
        const want = Math.min(READ_CHUNK, to - at - carry.length);
        const chunk = Buffer.allocUnsafe(want);
        const got = readSync(fd, chunk, 0, want, at + carry.length);
        if (!got) break;
        const buf = carry.length ? Buffer.concat([carry, chunk.subarray(0, got)]) : chunk.subarray(0, got);
        let start = 0;
        for (let nl = buf.indexOf(10); nl >= 0; nl = buf.indexOf(10, start)) {
          if (visit(buf.subarray(start, nl), at + start, at + nl + 1) === false) return;
          start = nl + 1;
        }
        at += start;
        carry = Buffer.from(buf.subarray(start));
      }
    } finally {
      closeSync(fd);
    }
  };
  /** Whether a run's file ends in half a line, as a process that died mid-write leaves it: its index reads to its last
   *  whole line. @param {string} id */
  const tornTail = (id) => {
    const idx = files.get(id)?.size ? indexOf(id) : null;
    return !!idx && idx.size > idx.bytes;
  };
  /**
   * A run's file as its index has it, current with the file: indexed afresh, or from its last whole line where it grew
   * since; null where there is no file, or it would not read.
   * @param {string} id @returns {FileIndex | null}
   */
  const indexOf = (id) => {
    if (!files.has(id)) return null;
    const known = indexes.get(id);
    if (known?.held) return keepIndex(id, known);
    let st;
    try {
      st = statSync(fileOf(id));
    } catch {
      return null;
    }
    if (known && known.size === st.size && known.mtimeMs === st.mtimeMs) return keepIndex(id, known);
    // Grown since: what was indexed up to its last whole line stands, and the rest is indexed — a line cut at the end
    // last time with it, whole now. A file that shrank is indexed afresh.
    const idx = known && st.size >= known.size ? known : emptyIndex();
    try {
      if (st.size > idx.bytes)
        eachLine(id, idx.bytes, st.size, (line, at, next) => {
          const e = parseLine(id, line, true);
          if (e) noteEvent(idx, e, at);
          idx.bytes = next;
        });
    } catch {
      indexes.delete(id);
      return null;
    }
    idx.size = st.size;
    idx.mtimeMs = st.mtimeMs;
    return keepIndex(id, idx);
  };
  /**
   * A page of a run's file: its events numbered past `since`, `cap` at most, read from the index's mark before the
   * first of them — of `types` alone where it names some, a line that names none of them skipped unparsed. An event the
   * file holds otherwise than it was published (a running run's, `asSent`) is read as published. Null where the file
   * would not read: a short page would read as the run's end. `bodies` false: an envelope stays one, its body unread.
   * @param {string} id @param {FileIndex} idx @param {number} since @param {number} cap @param {any} live  the run's entry, if in memory
   * @param {Set<string> | null} types @param {boolean} bodies
   * @param {((e: any) => boolean) | null} [fits]  of the events read, those the page takes, `cap` counting them alone
   * @returns {RunEvent[] | null}
   */
  const pageOf = (id, idx, since, cap, live, types, bodies, fits = null) => {
    /** @type {RunEvent[]} */
    const out = [];
    if (since >= idx.lastN) return out;
    const named = types ? [...types].map((t) => Buffer.from(`"type":${JSON.stringify(t)}`)) : null;
    // The last mark at or before the event after `since`: every line before it is numbered at or below `since`.
    let lo = 0;
    let hi = idx.marks.length / 2;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (idx.marks[mid * 2] <= since + 1) lo = mid + 1;
      else hi = mid;
    }
    const from = lo ? idx.marks[(lo - 1) * 2 + 1] : 0;
    try {
      eachLine(id, from, idx.bytes, (line) => {
        if (named && !named.some((t) => line.includes(t))) return true;
        const e = parseLine(id, line, !bodies);
        if (!e || e.n <= since || (types && !types.has(e.type))) return true;
        const evt = ((bodies || !(/** @type {any} */ (e).truncated)) && live?.asSent.get(e.n)?.evt) || e;
        if (fits && !fits(evt)) return true;
        out.push(evt);
        return out.length < cap;
      });
    } catch {
      return null;
    }
    return out;
  };
  // A run that exists only on disk (the process restarted, or it was evicted): its meta is what its own start and
  // end events say, so a viewer's list after a restart still shows kind, title and how it ended.
  /** @param {string} id @param {FileIndex} idx @returns {RunMeta} */
  const metaOfIndex = (id, idx) => {
    /** @type {any} */ const s = idx.start || {};
    /** @type {any} */ const e = idx.end || {};
    return {
      id,
      kind: s.kind || "unknown",
      title: s.title ?? null,
      parentId: s.parentId ?? null,
      startedAt: idx.start?.ts ?? (idx.count ? idx.firstTs : 0) ?? 0,
      endedAt: idx.end ? e.ts : idx.count ? idx.lastTs : null,
      status: idx.end ? String(e.status || "ended") : "unknown",
      summary: e.summary ?? null,
      meta: s.meta ?? null,
      events: idx.count ? idx.lastN : 0,
      firstAvailable: idx.count ? idx.firstN : 0,
      persisted: true,
    };
  };
  /** A file's first event, parsed — read in 4 KB steps until the first newline (a start line is small). @param {import("node:fs/promises").FileHandle} fh */
  const firstLine = async (fh) => {
    const chunk = Buffer.alloc(4096);
    /** @type {Buffer[]} */
    const parts = [];
    for (let pos = 0; pos < MAX_LINE_BYTES; ) {
      const { bytesRead: got } = await fh.read(chunk, 0, chunk.length, pos);
      if (!got) break;
      const nl = chunk.subarray(0, got).indexOf(10);
      parts.push(Buffer.from(chunk.subarray(0, nl < 0 ? got : nl)));
      if (nl >= 0) break;
      pos += got;
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  };
  /**
   * A file's last event, parsed — read back from its end, 4 KB first, then as much as a line can hold — or null where
   * the file ends in a line cut short. @param {import("node:fs/promises").FileHandle} fh
   */
  const lastLine = async (fh) => {
    const { size } = await fh.stat();
    for (const want of [4096, MAX_LINE_BYTES + 2]) {
      const from = Math.max(0, size - want);
      const buf = Buffer.alloc(size - from);
      const text = buf.subarray(0, (await fh.read(buf, 0, buf.length, from)).bytesRead);
      // A whole line ends with its newline, and begins after the newline before it.
      if (text[text.length - 1] !== 10) return null;
      const nl = text.lastIndexOf(10, text.length - 2);
      if (nl >= 0 || from === 0) return JSON.parse(text.subarray(nl + 1, text.length - 1).toString("utf8"));
    }
    return null;
  };
  /**
   * The run-start of a run file whose run is of one of `kinds` and whose last line is no run-end — read off the event
   * loop, without the lines between: its first line says its kind, and a run's end is written last, or before the lines
   * that came after it, each of which says so (`afterEnd`). Null for any other file, and for one that does not open or
   * whose first line does not parse; a last line cut short or that does not parse is no run-end.
   * @param {string} id @param {readonly string[]} kinds @returns {Promise<any>}
   */
  const headLeftOpen = async (id, kinds) => {
    /** @type {import("node:fs/promises").FileHandle | null} */
    let fh = null;
    try {
      fh = await open(fileOf(id), "r");
      let head = await firstLine(fh);
      // A start too large for a line says its kind and its meta in its body, kept beside the file.
      if (head?.body === true) head = withBody(id, head);
      if (head?.type !== "run-start" || !kinds.includes(head.kind)) return null;
      const last = await lastLine(/** @type {import("node:fs/promises").FileHandle} */ (fh)).catch(() => null);
      return last?.type === "run-end" || last?.afterEnd === true ? null : head;
    } catch {
      return null;
    } finally {
      await fh?.close().catch(() => {});
    }
  };
  const diskRunIds = () => {
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => f.slice(0, -6));
    } catch {
      return [];
    }
  };
  for (const id of diskRunIds()) noteFile(id);
  // Every `run:<id>` topic on the bus lands here; anything else is not a run and is ignored.
  const off = events.subscribe("*", (payload, entry) => {
    if (!entry || typeof entry.topic !== "string" || !entry.topic.startsWith("run:")) return;
    const id = entry.topic.slice(4);
    if (!id) return;
    // The one layer whose failure would reach the producer's turn: contained here, whatever the payload was.
    try {
      const run = runs.get(id) || create(id);
      record(run, payload, entry.seq);
    } catch (/** @type {any} */ e) {
      log("warn", `run log: an event on ${id} could not be recorded (${e.message})`);
    }
  });

  let sweeping = false;
  let closed = false;
  /**
   * The run files past their retention removed, and the pictures beside them (HarnessV4_Tasks U9) — at the start and
   * every six hours, each once `sweepAfter` has settled. The folder is listed and its files' times read off the event
   * loop, a batch at a time: a data folder holds thousands of run files, and one blocking pass over them all would hold
   * every chat for a tenth of a second. Each file it would remove is decided as it goes by a fresh look — a running run's
   * stays, a run of a kind the start settles (`settles`) that an earlier process left open stays until a start has gone
   * over it (`sweepAfter`), read at its two ends alone, and a file whose time is past the retention now goes — so a run
   * written or started while the sweep read keeps its file. One sweep at a time: one asked while another runs removes
   * nothing. → how many run files went.
   */
  const sweep = async () => {
    if (sweeping || closed) return 0;
    sweeping = true;
    let removed = 0;
    let pictures = 0;
    let retentionDays = 0;
    try {
      const wentOver = (await Promise.resolve(sweepAfter).catch(() => false)) === true;
      ({ retentionDays } = knobs());
      if (retentionDays > 0 && !closed) {
        const cutoff = now() - retentionDays * 86400_000;
        /** @type {string[]} */
        let ids = [];
        try {
          ids = (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6));
        } catch {}
        for (let i = 0; i < ids.length && !closed; i += SWEEP_BATCH) {
          const batch = ids.slice(i, i + SWEEP_BATCH);
          const times = await Promise.all(batch.map((id) => stat(fileOf(id)).then((st) => st.mtimeMs, () => null)));
          for (const [j, id] of batch.entries()) {
            // A file whose time was not past the retention as it was read is not past it now: a write only moves it on.
            if (closed || times[j] === null || !(/** @type {number} */ (times[j]) < cutoff)) continue;
            // A run the start settles, left open — its last line no run-end — waits for a start to go over it: its log may
            // be the one record of its work. Once one has, settled or not (its end could not be written, its turn could
            // not be kept), it goes like any other.
            if (settles.length && !wentOver && (await headLeftOpen(id, settles))) continue;
            const live = runs.get(id);
            if (closed || (live && live.meta.endedAt == null)) continue;
            try {
              if (statSync(fileOf(id)).mtimeMs < cutoff) {
                rmSync(fileOf(id), { force: true });
                files.delete(id);
                indexes.delete(id);
                // An ended run still in memory goes with its file: it keeps no ring to read it from once its file held
                // it all, and one that does is past the retention too. One a viewer follows stays, as eviction keeps it.
                if (live && !live.subscribers.size) runs.delete(id);
                removed++;
              }
            } catch {}
          }
        }
        // The bodies kept beside the run files go with them: those whose run has no file any more — removed here, by
        // other hands, or by a sweep cut short — listed off the event loop, few as they are; a running run keeps its
        // own, its file still to come.
        try {
          for (const id of await readdir(bodiesDir)) {
            const live = runs.get(id);
            if (!closed && !files.has(id) && !(live && live.meta.endedAt == null)) rmSync(join(bodiesDir, id), { recursive: true, force: true });
          }
        } catch {}
      }
      // The pictures beside them: by the same retention, counted from each one's last use, then down to their cap
      // (HarnessV4_Tasks U9). A retention of 0 keeps them as it keeps the run files; the cap still holds.
      if (!closed) pictures = await images.sweep();
    } finally {
      sweeping = false;
    }
    if (removed) op(`${removed} run file(s) past the ${retentionDays}-day retention removed`, { sub: "sweep", detail: { removed, retentionDays } });
    if (pictures) op(`${pictures} kept picture(s) removed, past the ${retentionDays}-day retention or the imagesMaxMB cap`, { sub: "sweep", detail: { pictures, retentionDays } });
    return removed;
  };
  // The start's sweep runs once the log is made, not inside its making: a sweep asked for meanwhile is the one that runs.
  const bootSweep = setTimeout(() => void sweep().catch((/** @type {any} */ e) => log("warn", `run log: the boot-time sweep failed (${e.message})`)), 0);
  bootSweep.unref?.();
  const sweepTimer = setInterval(() => void sweep().catch(() => {}), 6 * 3600_000);
  sweepTimer.unref?.();

  return {
    startRun({ id, kind = "unknown", title = null, parentId = null, meta = null, brief = null }) {
      if (!id) throw new Error("run log: a run needs an id");
      // Events may have arrived before the producer announced itself, or the entry may have been seeded from a file
      // under this id: the announcement fills the blanks in and makes the run live, it never restarts the numbering.
      const entry = runs.get(id) || create(id, { kind, title, parentId, meta });
      entry.meta.kind = kind;
      entry.meta.title = title;
      entry.meta.parentId = parentId;
      entry.meta.meta = meta;
      entry.meta.startedAt = now();
      entry.meta.endedAt = null;
      entry.meta.status = "running";
      entry.meta.summary = null;
      events.publish(`run:${id}`, { type: "run-start", kind, title, parentId, meta, ...(brief ? { brief } : {}) });
      op(`run ${kind} ${id} started`, { sub: "start", detail: { runId: id, kind, parentId: parentId || undefined }, ref: { requestId: id } });
      return entry.meta;
    },
    endRun(runId, { status = "done", summary = null } = {}) {
      const entry = runs.get(runId);
      if (!entry) return null;
      if (entry.meta.endedAt != null) return entry.meta; // idempotent: the first end is the end
      // A message queued after the loop's last decision point was accepted and never read: the timeline says so, and
      // the summary counts it, so the sender is never left wondering whether it was heard (§4.6).
      if (entry.queue.length) {
        const unread = entry.queue.splice(0, entry.queue.length);
        events.publish(`run:${runId}`, { type: "steer-unread", ids: unread.map((m) => m.id), kinds: unread.map((m) => m.kind) });
        summary = { ...(summary && typeof summary === "object" ? summary : {}), unreadSteer: unread.length };
      }
      // An ask the chat lists that the run leaves waiting ends with it, unanswered: a turn Force-stopped says nothing
      // more (agent/loop.js `emit`), so the card it waited on would be listed open on the feed and in the run for good.
      for (const [id, a] of [...entry.waitingAsks]) events.publish(`run:${runId}`, { type: "ask-end", round: /** @type {any} */ (a).round ?? 0, id, ...(/** @type {any} */ (a).call != null ? { call: /** @type {any} */ (a).call } : {}), outcome: "cancelled", words: [] });
      for (const open of [...entry.asks.values()]) open.settle(null);
      entry.meta.endedAt = now();
      entry.meta.status = String(status || "done");
      entry.meta.summary = summary;
      // Its waiters wake once the run has ended: a wait for a message its pick takes (`next`) reads the end.
      for (const wake of [...entry.waiters]) wake();
      // Nothing stops an ended run any more (`steer` and `force` refuse it), yet what listened for its stop or its Force
      // stop — the turn that ran it, and everything that turn held — lived as long as the signal, which the run kept
      // among the newest `keepRuns` (the crashes of 11-14). It lets go of both: a fresh pair, in the state they were in,
      // stands in for whoever reads them after.
      entry.stopper = standIn(entry.stopper);
      entry.forcer = standIn(entry.forcer);
      events.publish(`run:${runId}`, { type: "run-end", status: entry.meta.status, summary });
      // Its last line is written: the file is let go of.
      letGoOfFile(entry);
      // And where the file holds every event (none failed to reach it), so is the ring: an ended run is read from its
      // file, a page at a time, where the newest `keepRuns` of them each kept up to `maxPerRun` events in memory (the
      // crashes of 11-14). What it holds otherwise than published goes too (`asSent`): an ended run reads as its file
      // holds it, a key redacted, as it does after a restart — the newest `keepRuns` each kept up to `ringMB` of it, and
      // the keys with it (the review of 11-16).
      if (!entry.fileGap && entry.meta.persisted) {
        entry.ring = [];
        entry.sizes = [];
        entry.ringChars = 0;
        entry.ringGone = true;
        entry.meta.firstAvailable = 0;
        entry.asSent.clear();
        entry.asSentChars = 0;
      }
      op(`run ${entry.meta.kind} ${runId} ended: ${entry.meta.status}`, {
        sub: entry.meta.status.slice(0, 48),
        level: entry.meta.status === "error" ? "warn" : "info",
        ms: entry.meta.endedAt - entry.meta.startedAt,
        detail: { runId, kind: entry.meta.kind, events: entry.meta.events, status: entry.meta.status },
        ref: { requestId: runId },
      });
      evict();
      return entry.meta;
    },
    /**
     * The runs of `kind` an earlier process left open: a file whose run-start says that kind and that holds no run-end
     * (BUG-26's crash case — the process died, so no shutdown cut them). The files are read off the event loop, a few at
     * once, and of each only the first line, which says its kind, and the last, where a run's end is written: a file
     * whose last line is neither its run-end nor a line after it (`afterEnd`) is indexed whole. A run live here is not
     * one of them.
     * @param {string} kind
     * @returns {Promise<OpenRun[]>}
     */
    async openOnDisk(kind) {
      const read = await fewAtOnce(diskRunIds(), async (id) => {
        const live = runs.get(id);
        if (live && live.meta.endedAt == null) return null;
        const head = await headLeftOpen(id, [kind]);
        return head ? { id, head } : null;
      });
      /** @type {OpenRun[]} */
      const out = [];
      for (const r of read) {
        if (!r) continue;
        // One this process took up while the files were read is live, not left open.
        const live = runs.get(r.id);
        if (live && live.meta.endedAt == null) continue;
        const { id, head } = r;
        const idx = indexOf(id);
        if (idx?.end) continue;
        out.push({ id, meta: head.meta ?? null, brief: head.brief ?? null, parentId: head.parentId ?? null, rounds: idx?.rounds ?? 0, lastAt: (idx?.count ? idx.lastTs : null) ?? head.ts ?? 0 });
      }
      return out;
    },
    /**
     * Write the end of a run an earlier process left open, so a later start finds it ended. False when it is not such
     * a run (no file, already ended, or live here), and when its end did not reach its file — the log closed, runs kept
     * in memory alone, a write that failed: the run stays open on disk for a later start, and nothing says it ended,
     * in memory either: the entry its end made leaves memory again, so the run reads as its file has it.
     * @param {string} runId @param {{ status: string, summary?: any }} end
     */
    closeOnDisk(runId, { status, summary = null }) {
      if (closed || !knobs().persist || runs.get(runId)?.meta.status === "running") return false;
      const idx = indexOf(runId);
      if (!idx?.count || idx.end) return false;
      const size = files.get(runId)?.size ?? 0;
      events.publish(`run:${runId}`, { type: "run-end", status, summary });
      const entry = runs.get(runId);
      if ((files.get(runId)?.size ?? 0) <= size) {
        // One a viewer follows stays: the viewer heard the end.
        if (entry && !entry.subscribers.size) leaveMemory(entry);
        return false;
      }
      if (entry) Object.assign(entry.meta, { endedAt: now(), status, summary });
      op(`run ${entry?.meta.kind || "unknown"} ${runId} ended: ${status} — left open by the last stop`, { sub: String(status).slice(0, 48), level: "warn", detail: { runId, kind: entry?.meta.kind, status, leftOpen: true }, ref: { requestId: runId } });
      return true;
    },
    getRun(runId) {
      const live = runs.get(runId);
      if (live) return live.meta;
      const idx = indexOf(runId);
      return idx?.count ? metaOfIndex(runId, idx) : null;
    },
    /**
     * The turns running in a session now — a loop's, a coding agent's — as their runs name it (`meta.chain`); a
     * sub-agent's run is its turn's to stop. What the session's stop reaches when its lock no longer names the turn.
     * @param {string} chainId
     * @returns {RunMeta[]}
     */
    runningIn(chainId) {
      const id = String(chainId || "");
      if (!id) return [];
      return [...runs.values()].map((r) => r.meta).filter((m) => m.endedAt == null && (m.kind === "agent-turn" || m.kind === "coding-agent") && String(m.meta?.chain || "") === id);
    },
    /**
     * The asks a running turn's chat lists that wait still — a coding agent's questions, the cards its own agent waits on
     * for a command on another machine —, each its `ask` event, however many events the turn logged since; none for a
     * run that ended or is not here.
     * @param {string} runId @returns {RunEvent[]}
     */
    waitingAsks(runId) {
      const entry = runs.get(String(runId || ""));
      return entry && entry.meta.endedAt == null ? [...entry.waitingAsks.values()] : [];
    },
    // The transcript asks this for every turn it lists (HarnessV3-Launch LD-D13), so the page looks a run up only
    // where one exists: the file's presence answers, not its events — as the index of the run files has it.
    hasRun(runId) {
      if (runs.has(runId)) return true;
      return (fileNow(runId)?.size || 0) > 0;
    },
    listRuns({ limit = 50, kind = null } = {}) {
      /** @type {Map<string, RunMeta>} */
      const all = new Map();
      for (const [id, r] of runs) all.set(id, r.meta);
      // Disk-only runs are listed by id and mtime alone (reading every file to learn its kind would make the list
      // cost the whole directory); their full meta comes when one is opened. The index of the run files has their
      // times, so the list, polled while the page is open, reads nothing from the disk but a file it could not stat.
      for (const [id, known] of files) {
        const f = known.unread ? fileNow(id) : known;
        if (f && !all.has(id)) {
          const t = f.mtimeMs;
          all.set(id, {
            id,
            kind: "unknown",
            title: null,
            parentId: null,
            startedAt: t,
            endedAt: t,
            status: "ended",
            summary: null,
            meta: null,
            events: 0,
            firstAvailable: 0,
            persisted: true,
          });
        }
      }
      return [...all.values()]
        .filter((m) => !kind || m.kind === kind)
        .sort((a, b) => {
          const la = a.endedAt == null ? 1 : 0;
          const lb = b.endedAt == null ? 1 : 0;
          return lb - la || b.startedAt - a.startedAt;
        })
        .slice(0, Math.max(1, limit));
    },
    events(runId, { since = 0, limit = 5000, types = null, bodies = true, graphs = "all", calls = "all", of = null } = {}) {
      const live = runs.get(runId);
      const from = Math.max(0, Number(since) || 0);
      const cap = Math.max(1, Math.min(50000, Number(limit) || 5000));
      // A reader of one kind of event in a whole run (its snapshots, its questions) is read those alone: the file's
      // other lines are skipped unparsed, and the page counts only those.
      const only = calls === "only" ? CALL_SET : Array.isArray(types) && types.length ? new Set(types.map(String)) : null;
      // An ended run's sub-agents' calls left apart, but those that come whole (`apartOf`); or one launching call's alone.
      const facts = calls === "apart" ? apartOf(runId, live) : null;
      /** @type {((e: any) => boolean) | null} */
      const fits = facts
        ? (e) => {
            if (!CALL_SET.has(e.type)) return true;
            const k = callKey(e);
            return !facts.keys.has(k) || facts.kept.has(callOf(k, e));
          }
        : calls === "only" && of
          ? (e) => (Number.isInteger(e.round) ? e.round : 0) === of.round && e.parent != null && String(e.parent) === of.parent
          : null;
      // What serves the page: the file's events when it does (`page`, read from it), then the ring's (`tail`).
      /** @type {RunEvent[]} */
      let page = [];
      /** @type {RunEvent[]} */
      let tail = live ? live.ring : [];
      let meta = live ? live.meta : null;
      // The first number the file holds, where it holds any.
      let onFile = 0;
      // A run in memory whose events past `since` the ring let go of and its file could not give back (gone, or would not
      // read): said as a gap, never a short page that reads as the run's end.
      let unread = false;
      // The ring serves when it still holds the event after `since`. Otherwise the file may (persistence on, the run
      // written): what the file has comes first, and the ring's newer tail follows it — a run seeded from disk and an
      // ended run have an empty ring and everything on file, a long run has an old prefix on file and its recent events
      // in the ring.
      const ringServes = tail.length > 0 && from >= tail[0].n - 1;
      if (!ringServes) {
        const idx = indexOf(runId);
        const read = idx?.count ? pageOf(runId, idx, from, cap, live, only, bodies, fits) : null;
        if (idx?.count && read) {
          onFile = idx.firstN;
          page = read;
          tail = tail.slice(afterNumber(tail, idx.lastN));
        } else unread = from < (live ? live.meta.events : idx?.count ? idx.lastN : 0);
        if (!meta && idx?.count) meta = metaOfIndex(runId, idx);
      }
      if (!meta) return null;
      const firstAvailable = onFile || (tail.length ? tail[0].n : unread ? meta.events + 1 : 0);
      const gap = (onFile || tail.length || unread) && from + 1 < firstAvailable ? { requested: from, firstAvailable } : null;
      // Both are in number order (an event is numbered as it is recorded, and appended in that order), so the page
      // starts where a search finds `since`, not after a pass over every event held.
      if (page.length < cap) {
        const t = afterNumber(tail, from);
        const room = cap - page.length;
        const rest = only ? tail.slice(t).filter((e) => only.has(e.type)) : fits ? tail.slice(t) : tail.slice(t, t + room);
        // The ring's envelopes (`stubs`) as their events: as published where that differs from the file, else with the
        // body kept beside it — and only then asked whether the page takes them, which an envelope cannot say.
        const told = (fits ? rest : rest.slice(0, room)).map((e) => (stubs.has(e) && bodies ? live?.asSent.get(e.n)?.evt || withBody(runId, e) : e));
        page = page.concat(fits ? told.filter(fits).slice(0, room) : told);
      }
      // How many calls each card counts, where some were left apart: on its first subagent-start, a copy.
      if (facts?.starts.size) page = page.map((e) => (e.type === "subagent-start" && facts.starts.has(e.n) ? { ...e, callsApart: facts.starts.get(e.n) } : e));
      // An ended run's task graphs before its last that carries one, without it: every event still comes, numbered as
      // it was, so a reader's pages end where they did.
      const keep = graphs === "last" ? lastGraphOf(runId, live) : 0;
      if (keep) page = page.map((e) => (e.type === "graph" && e.n < keep && /** @type {any} */ (e).graph !== undefined ? withoutGraph(e) : e));
      return { run: meta, events: page, firstAvailable, gap };
    },
    subscribe(runId, fn) {
      const entry = runs.get(runId) || create(runId);
      entry.subscribers.add(fn);
      return () => {
        entry.subscribers.delete(fn);
        evict();
      };
    },
    // The mailbox (§4.6). A message is queued for a RUNNING run only — an ended run has no decision point left to read
    // it at, and saying so beats a message that looks accepted and is never heard. Queuing publishes a `steer` event
    // (state "queued") so the timeline shows the intervention the moment it happens; the loop's `read()` publishes
    // `steer-read` when it weighs the message. A waiting decision window wakes on the first message. `straight`: a note
    // that speaks to the agent's work beyond its words — it overrules answers, names agents to use — goes straight in,
    // never to a fork aside. `via`: the row of the page's menu it went by, and how (the owner's of 11-09), kept on its
    // `steer` event. `title`: its sender by name (a watcher's), kept on the message in one line.
    steer(runId, { kind = "note", text = "", from = "chat", title = "", interrupt = false, images = null, overrules = null, weigh = false, straight = "", via = null } = {}) {
      const entry = runs.get(runId);
      if (!entry || entry.meta.kind === "unknown") return { ok: false, error: "no loop is running under that id" };
      if (entry.meta.endedAt != null) return { ok: false, error: `the run has ended (${entry.meta.status}); nothing is left to steer` };
      const k = String(kind || "note");
      if (!STEER_KINDS.has(k)) return { ok: false, error: `kind must be one of ${[...STEER_KINDS].join(", ")}` };
      // A coding agent's turn (HarnessV3-ACP AC1-1) hears a stop, which cancels it, and a note where its agent takes
      // words while it works: queued at it (`steer: "queued"`, HarnessV3-FailurePoints §7.2), into its running turn
      // (`"live"`, AC3-1) or at its next step (`"next"`, AC-D6). A note interrupts the agent only where the run says it
      // can (`interrupts`, FP-D8). A veto and a Compact are the loop's.
      if (entry.meta.kind === "coding-agent" && k !== "stop") {
        const takes = ["queued", "live", "next"].includes(String(entry.meta.meta?.steer));
        if (k !== "note") return { ok: false, error: `a coding agent's turn takes ${takes ? "a note or a stop" : "a stop"}; this was a ${k}` };
        if (!takes) return { ok: false, error: "this agent takes no words while its turn runs; send them when it ends" };
      }
      if (interrupt === true && !(k === "note" && entry.meta.meta?.interrupts === true))
        return { ok: false, error: "only a note to a coding agent that can be interrupted interrupts it; send it without `interrupt` to queue it" };
      // Only the agent loop (a turn's or a sub-agent's) folds its own rounds.
      if (k === "compact" && !["agent-turn", "subagent"].includes(String(entry.meta.kind)))
        return { ok: false, error: `compact is for an agent turn's run; this one is ${entry.meta.kind}` };
      // A picture rides a note or a veto, into a run that says it reads pictures (`steerImages`: the agent loop's own
      // turn, which hands them to its model with the words, and a coding agent's whose agent takes pictures in a
      // prompt — Claude Code, Codex — HarnessV4_Tasks C22). Another run takes words only while it runs: said, so the
      // page keeps the picture for the next message instead of losing it.
      const pics = readImages(images);
      if ("error" in pics) return { ok: false, error: pics.error };
      if (pics.images.length && !(k === "note" || k === "veto")) return { ok: false, error: `a ${k} carries no picture` };
      if (pics.images.length && entry.meta.meta?.steerImages !== true) return { ok: false, error: "this run takes words only while it runs; a picture goes with the next message" };
      // The words go whole (HarnessV4_Tasks B3): nothing clips what a person, or a lead, says into a running turn.
      const body = String(text || "").trim();
      if (!body && !pics.images.length && k !== "stop" && k !== "compact") return { ok: false, error: "text is required" };
      if (entry.queue.length >= MAX_MAILBOX) return { ok: false, error: `the mailbox holds ${MAX_MAILBOX} unread messages; wait for the loop to read them` };
      // Whose answers a note overrules, as the caller found them (the admin route asks the sub-agent registry).
      const whose = (k === "note" && Array.isArray(overrules) ? overrules : [])
        .map((/** @type {any} */ o) => ({ agentId: String(o?.agentId || ""), exchange: Number(o?.exchange) || 0, name: String(o?.name || "") }))
        .filter((o) => o.agentId && o.name);
      const way = viaOf(via);
      const sender = String(title || "").replace(/\s+/g, " ").trim().slice(0, 80);
      /** @type {SteerMessage} */
      const message = {
        id: `s${entry.meta.events + 1}-${Math.random().toString(36).slice(2, 8)}`,
        kind: /** @type {SteerMessage["kind"]} */ (k),
        text: body,
        from: String(from || "chat").slice(0, 40),
        ...(sender ? { title: sender } : {}),
        at: now(),
        ...(interrupt === true ? { interrupt: true } : {}),
        ...(pics.images.length ? { images: pics.images } : {}),
        ...(whose.length ? { overrules: whose } : {}),
        ...(way ? { via: way } : {}),
      };
      // A note the person typed into a turn that weighs them aside goes to its fork first (the owner's forked steer of
      // 11-04): held out of the loop's reads until the fork passes it on. A picture, a veto, a stop, a Compact go in as ever.
      // Only the agent loop's turn weighs a note aside: a coding agent's says what it does with a note in words of its own.
      const asked = k === "note" && weigh === true && entry.meta.kind === "agent-turn";
      const unweighed =
        straight ? String(straight)
        : pics.images.length ? "a message with pictures goes straight in"
        : interrupt === true || !typedByDeveloper(message) ? "only a message you type is weighed aside"
        : !entry.asides ? "this turn weighs no message aside"
        : "";
      if (k === "note" && !unweighed && entry.asides?.take(message, { asked })) message.aside = true;
      entry.queue.push(message);
      // Its pictures are kept beside the run's log, as a call's are (U9), so its bubble shows each, live and after a
      // reload (V4-D303): the log names a kept one by its ref, never its bytes; the loop reads them as sent.
      const refs = pics.images.map((p) => keepSent(p.data));
      const shown = shownOf(message, refs);
      events.publish(`run:${runId}`, { type: "steer", ...shown, state: "queued" });
      // One the person asked a fork for that none takes goes in as any note, saying why.
      if (asked && !message.aside) events.publish(`run:${runId}`, { type: "steer-aside", id: message.id, as: "straight", why: unweighed || "the turn is ending" });
      for (const wake of [...entry.waiters]) wake();
      // A stop cannot wait for a decision point: a long command or a held model stream never reaches one (2026-09-30,
      // a 600 s command ran out its own timeout under a stop). The signal cuts the loop's in-flight work at once; the
      // message stays queued, so the loop still ends the turn in its words.
      if (k === "stop") entry.stopper.abort();
      return { ok: true, message: shown, queued: entry.queue.length };
    },
    /**
     * The developer's message changed while it waits (HarnessV4_Tasks C34, PATCH /runs/:id/steer/:sid): a note or a
     * veto still queued — the loop has not read it, a coding agent's turn has not handed it to its agent — takes the
     * new words, said on the run (`steer-edit`), so its bubble, and the turn that reads it, have them. Its pictures
     * stay. `gone`: the run, or the message, no longer waits.
     * @param {string} runId @param {string} id @param {{ text?: string }} change
     * @returns {{ ok: true, message: SteerShown } | { ok: false, error: string, gone?: boolean }}
     */
    editSteer(runId, id, { text = "" } = {}) {
      const entry = runs.get(runId);
      const found = waitingOf(entry, id);
      if ("error" in found) return found;
      const m = found.m;
      const body = String(text || "").trim();
      if (!body && !m.images?.length) return { ok: false, error: "a message needs words: Delete takes it back" };
      if (body === m.text) return { ok: true, message: shownOf(m) };
      m.text = body;
      events.publish(`run:${runId}`, { type: "steer-edit", id: m.id, text: body });
      // A turn that weighed the old words (a coding agent's own command, held for the turn's end; a fork aside) weighs these.
      if (m.aside) found.entry.asides?.changed(m, "edit");
      for (const wake of [...found.entry.waiters]) wake();
      return { ok: true, message: shownOf(m) };
    },
    /**
     * The developer's message taken back while it waits (HarnessV4_Tasks C34, DELETE /runs/:id/steer/:sid): off the
     * queue, said on the run (`steer-drop`); nothing reads it. `gone`: as `editSteer`'s.
     * @param {string} runId @param {string} id
     * @returns {{ ok: true } | { ok: false, error: string, gone?: boolean }}
     */
    dropSteer(runId, id) {
      const entry = runs.get(runId);
      const found = waitingOf(entry, id);
      if ("error" in found) return found;
      found.entry.queue.splice(found.entry.queue.indexOf(found.m), 1);
      events.publish(`run:${runId}`, { type: "steer-drop", ids: [found.m.id] });
      // Its fork stops, and a turn waiting for the notes held aside reads that this one is no more.
      if (found.m.aside) {
        found.entry.asides?.changed(found.m, "drop");
        for (const wake of [...found.entry.waiters]) wake();
      }
      return { ok: true };
    },
    // A Force stop (HarnessV3-FixRound F2 item 13): a stop the loop has not acted on, made to land now — the stop
    // signal cuts what it can, and the force signal ends the turn whatever the loop is waiting on (a hook, a reader,
    // a compaction, a snapshot). It is a stop first: one is queued when none is, so the turn still ends in the stop's
    // words. The agent loop listens for it, and a coding agent's turn (whatever its agent does with the cancel).
    force(runId, { from = "harness" } = {}) {
      const entry = runs.get(runId);
      if (!entry || entry.meta.kind === "unknown") return { ok: false, error: "no loop is running under that id" };
      if (entry.meta.endedAt != null) return { ok: false, error: `the run has ended (${entry.meta.status}); nothing is left to stop` };
      if (!["agent-turn", "subagent", "coding-agent"].includes(String(entry.meta.kind))) return { ok: false, error: `a Force stop is for an agent's turn or a sub-agent's run; this one is ${entry.meta.kind}` };
      const who = String(from || "harness").slice(0, 40);
      const queued = !entry.queue.some((m) => m.kind === "stop");
      if (queued) {
        /** @type {SteerMessage} */
        const message = { id: `s${entry.meta.events + 1}-${Math.random().toString(36).slice(2, 8)}`, kind: "stop", text: "", from: who, at: now() };
        entry.queue.push(message);
        events.publish(`run:${runId}`, { type: "steer", ...message, state: "queued" });
      }
      events.publish(`run:${runId}`, { type: "force-stop", from: who });
      entry.stopper.abort();
      entry.forcer.abort();
      for (const wake of [...entry.waiters]) wake();
      return { ok: true, queued };
    },
    /**
     * A question the run waits on the person to answer (HarnessV3-ACP AC2-4), settled by `answer` with what the page
     * sent once `check` finds it fits, or with null when `signal` aborts or the run ends. The question itself is the
     * producer's `ask` event and its end the producer's `ask-end`: the run log only holds the wait.
     * @param {string} runId @param {string} id
     * @param {{ check?: (answer: any) => string, signal?: AbortSignal | null }} [o]
     * @returns {Promise<any>}
     */
    awaitAnswer(runId, id, { check = () => "", signal = null } = {}) {
      const entry = runs.get(runId);
      if (!entry || entry.meta.endedAt != null || signal?.aborted) return Promise.resolve(null);
      return new Promise((resolve) => {
        /** @param {any} answer */
        const settle = (answer) => {
          if (entry.asks.get(id)?.settle !== settle) return;
          entry.asks.delete(id);
          signal?.removeEventListener("abort", onAbort);
          resolve(answer);
        };
        const onAbort = () => settle(null);
        signal?.addEventListener("abort", onAbort, { once: true });
        entry.asks.set(id, { check, settle });
      });
    },
    /**
     * The person's answer to a question the run waits on (POST /runs/:id/answer). `gone`: the run, or the question, no
     * longer waits; otherwise the error is the check's words for an answer that doesn't fit the question.
     * @param {string} runId @param {string} id @param {any} answer
     * @returns {{ ok: true } | { ok: false, error: string, gone?: boolean }}
     */
    answer(runId, id, answer) {
      const entry = runs.get(runId);
      if (!entry || entry.meta.kind === "unknown") return { ok: false, error: "no loop is running under that id", gone: true };
      if (entry.meta.endedAt != null) return { ok: false, error: `the run has ended (${entry.meta.status}); its questions were settled`, gone: true };
      const open = entry.asks.get(String(id || ""));
      if (!open) return { ok: false, error: "that question is no longer waiting for an answer", gone: true };
      const why = open.check(answer);
      if (why) return { ok: false, error: why };
      open.settle(answer);
      return { ok: true };
    },
    /**
     * The developer's Background on a command the run's loop runs in the foreground (HarnessV4_Four_Plan E21,
     * POST /runs/:id/calls/:call/background): the call answers now, and the command goes on as a background shell.
     * Its tool-end says which. `gone`: the run, or the command, no longer runs in the foreground.
     * @param {string} runId @param {string} callId
     * @returns {{ ok: true, shell: string } | { ok: false, error: string, gone: boolean }}
     */
    background(runId, callId) {
      const entry = runs.get(runId);
      if (!entry || entry.meta.kind === "unknown") return { ok: false, error: "no loop is running under that id", gone: true };
      if (entry.meta.endedAt != null) return { ok: false, error: `the run has ended (${entry.meta.status}); its commands ended with it`, gone: true };
      const move = entry.movers.get(String(callId || ""));
      if (!move) return { ok: false, error: "that call is not a command running in the foreground: it has ended, or it is not a command", gone: true };
      const moved = move();
      if (!moved) return { ok: false, error: "the command has already ended: its result is the call's answer", gone: true };
      return { ok: true, shell: moved.id };
    },
    mailbox(runId) {
      const entry = runs.get(runId) || create(runId);
      // A note held aside is no message of the loop's yet (the owner's forked steer of 11-04): no read takes it, and
      // nothing waiting wakes on it.
      /** @param {SteerMessage} m */
      const readable = (m) => !m.aside;
      const queued = () => entry.queue.filter(readable);
      /** The run ended, or a Force stop ends it: whatever waits for a message stops waiting. */
      const ending = () => entry.meta.endedAt != null || entry.forcer.signal.aborted;
      /** @param {(m: SteerMessage) => boolean} [pick] */
      const read = (pick) => {
        if (!entry.queue.length) return [];
        /** @type {SteerMessage[]} */
        const out = [];
        for (let i = 0; i < entry.queue.length; ) if (readable(entry.queue[i]) && (!pick || pick(entry.queue[i]))) out.push(...entry.queue.splice(i, 1)); else i++;
        if (!out.length) return [];
        events.publish(`run:${runId}`, { type: "steer-read", ids: out.map((m) => m.id), kinds: out.map((m) => m.kind) });
        return out;
      };
      /** A note held aside, said on the run as its fork goes, then — `then` — passed in or taken off the queue. @param {SteerMessage} m @param {SteerAsideSaid} said @param {"hold" | "pass" | "settle"} then */
      const aside = (m, said, then) => {
        const i = entry.queue.indexOf(m);
        if (i < 0 || !m.aside) return false;
        if (then === "pass") delete m.aside;
        if (then === "settle") entry.queue.splice(i, 1);
        events.publish(`run:${runId}`, { type: "steer-aside", id: m.id, ...said });
        if (then !== "hold") for (const wake of [...entry.waiters]) wake();
        return true;
      };
      return {
        read,
        unheard: (msgs) => {
          const list = (msgs || []).filter((m) => m && m.id);
          if (list.length) events.publish(`run:${runId}`, { type: "steer-unread", ids: list.map((m) => m.id), kinds: list.map((m) => m.kind) });
        },
        wait: (ms) =>
          new Promise((resolve) => {
            if (queued().length || !(ms > 0)) return resolve(read());
            /** @type {NodeJS.Timeout} */
            let timer;
            const done = () => {
              clearTimeout(timer);
              entry.waiters.delete(wake);
              resolve(read());
            };
            const wake = () => {
              if (queued().length || ending()) done();
            };
            timer = setTimeout(done, ms);
            timer.unref?.();
            entry.waiters.add(wake);
          }),
        size: () => queued().length,
        next: (pick) => {
          const over = () => (pick ? entry.meta.endedAt != null || queued().some(pick) : queued().length > 0);
          if (over()) return Promise.resolve();
          return new Promise((resolve) => {
            // A wake that leaves nothing to read — a note held aside, taken back or answered by its fork — is no message.
            const wake = () => {
              if (!over() && (pick || !ending())) return;
              entry.waiters.delete(wake);
              resolve(undefined);
            };
            entry.waiters.add(wake);
          });
        },
        peek: (pick) => queued().find(pick) || null,
        list: (pick) => queued().filter(pick),
        handing: (m) => {
          if (!entry.queue.includes(m)) return false;
          if (entry.handed.has(m.id)) return true;
          entry.handed.add(m.id);
          events.publish(`run:${runId}`, { type: "steer-sent", ids: [m.id] });
          return true;
        },
        took: (m, { after = false } = {}) => {
          const i = entry.queue.indexOf(m);
          if (i < 0) return false;
          entry.queue.splice(i, 1);
          events.publish(`run:${runId}`, { type: "steer-read", ids: [m.id], kinds: [m.kind], ...(after ? { after: true } : {}) });
          return true;
        },
        /** Aborts the moment a `stop` steer lands: the loop passes it to the model call, the hands and its foreground
         *  sub-agents, so a stop cuts what is running instead of waiting for the next decision point. */
        stopSignal: entry.stopper.signal,
        /** Aborts on a Force stop: the agent loop ends the turn at once, whatever it is waiting on. */
        forceSignal: entry.forcer.signal,
        movable: (callId, move) => {
          entry.movers.set(callId, move);
          return () => {
            if (entry.movers.get(callId) === move) entry.movers.delete(callId);
          };
        },
        aside: (asides) => {
          entry.asides = asides;
          return () => {
            if (entry.asides === asides) entry.asides = null;
          };
        },
        weighs: (m, said) => aside(m, said, "hold"),
        pass: (m, said) => aside(m, said, "pass"),
        settle: (m, said) => aside(m, said, "settle"),
        unweigh: (why) => {
          const held = entry.queue.filter((m) => m.aside);
          for (const m of held) {
            // Its fork stops first, so what it would have made of the note is nobody's.
            entry.asides?.changed(m, "drop");
            aside(m, { as: "straight", why }, "pass");
          }
          return held.length;
        },
        weighed: () => {
          const over = () => entry.meta.endedAt != null || !entry.queue.some((m) => m.aside);
          if (over()) return null;
          return new Promise((resolve) => {
            const wake = () => {
              if (!over()) return;
              entry.waiters.delete(wake);
              resolve(undefined);
            };
            entry.waiters.add(wake);
          });
        },
      };
    },
    keepImages: (pictures) => images.keep(pictures),
    imageFile: (ref) => images.fileOf(ref),
    imageType: (ref) => images.typeOf(ref),
    sweep,
    memory() {
      let events = 0;
      let chars = 0;
      let asSent = 0;
      for (const r of runs.values()) {
        events += r.ring.length;
        chars += r.ringChars;
        asSent += r.asSent.size;
      }
      return { runs: runs.size, events, chars, asSent, indexes: indexes.size };
    },
    close() {
      off();
      closed = true;
      clearTimeout(bootSweep);
      clearInterval(sweepTimer);
      for (const entry of runs.values()) letGoOfFile(entry);
    },
  };
}
