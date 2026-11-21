# Context, compaction and memory — the rulebook

What Filament does to a conversation: how earlier turns reach the model, what happens when the window fills, and what memory adds. Kept in step with the code (`src/core/context-words.js`, `src/services/session-settings.js`, `src/app/sessions/`, `src/core/fold.js`, `src/core/trim.js`, `src/services/trim.js`, `src/services/memory/brain.js`, `src/app/pipeline/`).

**Two parts.** Part 1 is the model, in one set of words: who holds the conversation, the compaction line and its three kinds, a coding agent's ways, where each setting comes from, and the slice pass. It covers the harness, where Filament or a coding agent holds the conversation. Part 2 (§0 to §11) is the rulebook for an **outside client**, a tool that owns its transcript: what Filament and memory add to it, the round trips, the client's own compaction, the edge cases and worked scenarios.

## Part 1 — The model

### A. Who holds the conversation decides what applies

A conversation is held by one of three. What Filament can do to it follows from that, so every page and every reply draws the variant of the holder.

| | Filament's loop, or a team | A coding agent over ACP | An outside client |
|---|---|---|---|
| Who composes each request | Filament, from its archive | the agent, from its own session | the client, from its own transcript |
| What each request carries | the finished turns whole, from the newest compaction on | the agent's own history: Filament's copy only starts a fresh agent session, and follows the agent's own compaction (see D) | the client's history as it came: Filament reshapes none of it |
| The compaction line | acts at turn start and mid-turn | acts between turns; Claude Code is handed it and acts mid-turn too | none: the client decides when it compacts |
| The kinds | shrink what is sent | shrink Filament's copy, then a fresh agent session starts from it (the way *Filament's copy*) | none: the client compacts by itself, and its own model writes the summary (§7) |

The archive keeps every turn whole under all three. Nothing below deletes anything.

### B. One set of words

One idea has one name wherever it is said: the page, a command's reply, a setting's description. The stored values and the setting keys are in brackets.

**The forms a finished turn takes.** The live turn is always whole.

| Form | Stored | What reaches the model |
|---|---|---|
| Whole | `raw` | the whole turn, exactly as it happened |
| Folded | `fold` | your message and the answer; the work between becomes one line per tool call (§6). No model call. |

"Summary" always means a span of turns.

**Every request** sends the finished turns whole, as they were sent, until a compaction. What a compaction leaves — its summary, or the turns it folded — is what every request after it starts from, so the same bytes go out again and the provider's prompt cache holds.

**The line** (`context.compaction.thresholdPercent`, 85): the percent of the model's window at which the session makes room. The reply's room is kept apart, so the percent you set is the percent you get. The Compaction widget's slider goes from 15 to 95. In a harness chat on a coding agent, `/autocompact 400k` (Claude Code's own word for it) sets the session's line too: Filament answers it, turns the tokens into a whole percent of the agent's window and says the figure it took (a figure off the slider's band is refused, with the lowest or highest line in tokens); a session opened from then on is handed it as its agent's own point.

**The window** is the model's own, as its route or its coding agent says it. Where nobody says one (an agent that names none, such as Cursor), the Context ring's popover takes it from you: a figure in tokens, kept for that model on that upstream (`PUT /sessions/:id/window`). A window the agent names later replaces it. An agent that refuses a prompt for size and names its window in the refusal is taken at its word the same way.

**The three kinds of compaction.** Each makes the history smaller.

| Kind | Stored | What it does |
|---|---|---|
| Same model | `method: summary`, `writer: session` | the session's own model writes one summary of every finished turn since the last summary, reading its warm prompt cache when it can: the kind to pick while the cache is warm |
| Side model | `method: summary`, `writer: model` | a side model (`context.compaction.model`, else memory's model where one is set) writes that summary: the kind to pick once the cache is cold |
| Instant fold | `method: fold` | every finished turn but the newest `context.compaction.keepWhole` (1) folds. No model call. |

`context.compaction.method` is `summary` (the default) or `fold`; `context.compaction.writer` is `session` or `model`, and unset it is the named `context.compaction.model` where there is one, else the session's own model. A coding agent's model can be named as the writer too. The agent then reads the transcript in a session of its own: opened for the one call in a folder of Filament's, read-only, with none of Filament's tools, and closed after it. It runs on the agent's plan, with the agent's own prompt on top of each call, and the card says "in a session of its own". The chat's own agent stands in for no writer nobody named.

**How a writer reads the turns.** The same model forks its warm cache where it can. Otherwise a writer reads the finished turns whole where they fit one call of its window; where they don't, their tool calls fold first, and the folded turns are read in one call; folded turns still too big for one call are read in sequential slices, the last resort (G). A side model that cannot read the turns whole, where the fold leaves the earlier turns at the instant line or under, is not called at all: the compaction is the instant fold. Each writer is priced on what it reads.

**The instant line** (`context.compaction.instantTokens`, 20,000; 0 never): the most an instant fold may leave of the earlier turns — the finished turns as the fold leaves them and the summary before them, never the system prompt or the tools. The card offers Instant fold at the line or under, and lists it otherwise with its count and why; the ring's popover shows the fold's count any time. A session whose method is fold folds at its compaction line whatever the fold leaves.

The kinds and their settings (`context.compaction.method`, `writer`, `model`, `keepWhole`, `instantTokens`) belong to the chats the harness holds: none reaches an outside client, which compacts by itself (§7).

**Send it as it is** is not a compaction: the message goes unchanged, and pays for the full re-read once. It is offered where the message could go so — a cold cache, a lost session, a message you held — never where the message does not fit.

**Before a message is sent, Filament asks.** In five cases your message stops before it is sent, and a card asks what to do: it does not fit under the line; the prompt cache has gone cold, so everything the session holds is read again at full price; a coding agent's own session was lost (it had one, and its bridge no longer keeps it); a fresh start from Filament's copy does not fit the agent; or you switched the chat to another account or model of a coding agent (its own card, below). The card says in one sentence why it asks and what its main answer does ("This chat is past your 170K line (≈181K), so Claude Code will compact the chat before your message goes"), and the message's flag says *waits for room* (*waits for your answer* where it could go as it is). Its facts say who reads the conversation and from where, how many tokens it holds against the line and the window, and the cache's state ("Cache cold · idle 2 h 10 min, it lasts 1 h"). Then the ways, each with what it costs, how many calls it makes, who writes, how it reads the turns, what it leaves where that is measured (a fold; a summary still to write is never guessed at on the card), and about how long it takes: how long that writer's summaries have taken, whole, in the request log (which counts what it thinks before it writes), else its measured speed; nothing is said of time where the log has no finished call of that model. In a coding agent's session its own ways come first — the agent writing the summary stands for the same model there —, then **Side model** and **Instant fold** on Filament's copy. Elsewhere, where the cache is warm: **Same model** (Recommended), **Side model**, **Instant fold**. Where it has gone cold, or the session was lost: **Send it as it is** first, then **Side model** (Recommended), **Instant fold**, **Same model** (Costly). The kind the session chose is chosen first; where you held the message, Send it as it is comes after the ways. **More ways (n)** opens the rest. A way that cannot run now is listed too, with why. In a coding agent's session the agent's own share — its prompt and tools, which a fresh session of it holds too, measured from the agent's first count in a session new to it — is never said on a way, but it is counted: a way that would leave the chat no smaller than it is now says so ("no smaller than now"), and it is still offered. A line set under that share is said as such: no way gets under it, so every message asks. A message a card stopped is kept as the session's draft, so a reload brings it back. **For this compaction only** picks the side model that writes the summary, naming the ways it serves; nothing is written to the session's settings. The answers are **Compact and send** (or **Send**, with Send it as it is chosen), **Not now**, and **Just do it from now on** (on a cold cache **Just send from now on**), whose hint names the row that brings the question back. Pressed, Compact and send turns the card into the compaction's progress — its step, its clock and **Stop** — and the Compacting row under the last turn gives way to it. Once room is made, a note says how much and the message goes out where it stood; a compaction that fails or is stopped brings the card back with why. One kind of turn asks nothing, because nobody is there to answer: the turns Filament itself replays in a copy of a session (Settings › Features, replay-compare). Past the copy's line they make room by the copy's kind; a message you later send into that copy is asked like any other.

**When the chat is full** (`context.compaction.mode`, `ask` · `auto`; `ask` by default): *Ask me*, or *Just do it* — room is made by the session's kind, by itself, and the message goes. A turn that is already running never stops to ask: it makes room and keeps going.

**Back after a break** (`context.compaction.resumeQuestion`, on by default): *Ask me*, or *Send as it is* — the message goes as it is. A coding agent's cache counts as cold one hour after its last turn ended, the longest any provider keeps one. For a model Filament calls it is the cache life of its route, 5 minutes or 1 hour; where the model's replies read and wrote no cache, there is none to lose and nothing is asked.

**A coding agent's ways** (`context.compaction.agent`):

| Way | Stored | What it does |
|---|---|---|
| Suggested (the default) | `suggested` | the agent's own compaction where it has one; else it writes a summary while its cache is warm; else Filament's copy |
| The agent's own compaction | `own` | the agent compacts its live session itself, as its `/compact` does, and goes on in it |
| The agent writes a summary | `self` | the agent writes Filament's summary from its warm session, read-only; a fresh session starts from it |
| Filament's copy | `ours` | Filament's kinds on its own copy; a fresh agent session starts from what they leave |

**Carry earlier turns as**: the one label of the control wherever a chat is carried somewhere else.

| Where | Setting | Choices |
|---|---|---|
| A fresh coding-agent session | `context.carry` | Words (the default) · Folded · Folded, newest 2 whole · Whole |
| Filament's copy of a coding agent's chat | `context.compaction.follow` | Kept in step with the agent (the default) · Keeps every turn |
| A fork | `fork.transcript` | As it was · Folded · One summary |

**A sub-agent's launch** sees its task alone: a sub-agent handed the conversation takes on the main agent's view of it,
and one handed only its task answers apart. A launch may ask for more (the agent tool's `context`, `/subagent view=`,
the Sees chip): Folded · Context window · A live copy, each from the session's last compaction on, its summary first;
Context window is what the main agent holds now, the running turn from its own newest compaction to its newest round.
Catch me up, Ask and Try it in a copy ask for Folded — Catch me up for A live copy while the main agent's cache is warm
and a fork pays; Review my last change is handed the change alone.

**Pointers** (`r:…`): a tool result's recall id, which `filament_recall` brings back whole — One line carries it beside the line it leaves (`context.results`).

**Tool results** (`context.results`, Advanced › Every turn) say how the finished turns, sent whole, send their tool results: as they ran (`keep`, the default), or one line each with its recall id where the line leaves something out (`line`; a reader with no `filament_recall`, a coding agent that takes no MCP tools, gets the line alone). One line rewrites only a turn whose lines save 10K tokens or more (`LINE_MIN_TOKENS`, counted without the calibration factor so a turn always decides the same): the rewrite costs the provider's cache one miss over that turn, and a turn of small results goes as it ran. The policies offered before stay valid for the chats that chose them and send the same bytes as they did: the line without an id (`status`), a repeated call's newest only (`dedupe-to-tail`), pointers (`pointer`). `filament_recall` brings one back whole: it rides every request of a chat Filament runs, so a fold or a policy changes the messages and never the tools.

### C. A session Filament's own loop runs

Filament holds the conversation and composes every request from the archive.

- **Every request.** The finished turns go whole from the newest compaction on. The same turns always go as the same bytes, so the provider's prompt cache holds.
- **At the line, as you send.** The message stops and the card asks how to make room (*When the chat is full*). Set to make room by itself, the session's kind runs and the turn goes on. `/autofit` makes room too.
- **Mid-turn.** A long turn that reaches the line makes room and keeps running, whichever way the session answers a message past the line: a running turn never stops to ask. Where the earlier turns hold more than the turn's own steps, they give way first: the session's kind runs on them, once in a turn, the turn's own message and steps stay whole, and the model's prompt cache starts over once from there (the run says "Room made in the whole chat: turns 1–3 summarized, this turn's own steps kept whole"). A summary that fails, or that you send on without, gives way to a fold. Where they cannot give way, the run says why. Else, and after that, the turn folds its own oldest rounds into one summary. A fold reaches the turn's own rounds only, so it is bounded. After a fold, the next one at the line waits until the turn has grown by the room a compaction is for (40% of the window, up to the line; half the line where a line set near or under 40% leaves less). A fold that leaves the conversation still past the line means the earlier turns hold the rest: the line stands down for the rest of that turn, the turn goes on whole, and your next message makes room in the whole session. At the window itself a fold is still asked for, because the alternative is the turn ending there.
- **A refusal for size.** If the provider refuses a round as too long, the loop clears old tool results, compacts and tries that round once more.
- **After a summary**, what the summarized turns read comes back: the files, the plan and the task graph, so the next turn does not start blind. Inside a turn the files take at most half of the room the summary made; a file past that is named, to be read again if it is needed.
- **On request.** *Compact now…* (the card, with every way and, for this once, the side model that writes it; `/compaction` brings it up too), `/compact` (the session's own way at once, with no card, inside the command's own turn), *Fold now* where the instant fold is at the instant line or under, `/autofit` (the smallest cut of the oldest turns that holds the next request under a margin of the line, 85% of it by default; §8), and *Undo* on the newest compaction until the next message is sent.
- **Dry run and Next request** show what the next request would hold, part by part, before it is sent.

### D. A coding agent's session

The agent (Claude Code, Codex, Cursor, any agent over ACP) keeps its own history and composes its own requests. Filament keeps a copy of every turn, which the agent never reads while its session lives.

- **Its own history.** Filament shapes none of the agent's requests: what it sets is the line, the way the agent makes room, and what a fresh session of it starts from.
- **Its line** is the same percent, of the agent's window, against what the agent last said its context holds. Filament checks it between turns. Claude Code is handed the line as its own auto-compact point, so it also acts in the middle of a turn, whichever way *When the chat is full* is set: a running turn never stops to ask. Other agents compact mid-turn at their own point. `/autocompact <tokens>` typed in the chat sets the line for the session, and lasts: Filament keeps it, where Claude Code's own setting would end with its session.
- **At the line, and on Compact now,** the way in force makes room. With nothing set, that is the agent's own compaction wherever the agent has one: the chat goes on in the same session. Else the agent writes Filament's summary while its cache is warm (its last turn ended within the hour: the clock the cold question asks by). Else Filament compacts its copy. A way that fails gives way to *Filament's copy*, and the note says why. Where no process holds the chat's session any more (Filament restarted, or the idle agent was let go), or the agent lost it under a turn, and the agent can open it again, its own ways stay offered and say "Opens its session first".
- **A cold cache.** Once the agent's cache has gone cold, *Compact now…* opens the card with what each way costs first: an agent's own way says how many tokens it reads again; Filament's kinds say what they leave and what they cost.
- **A message sent after the cache went cold** (`context.compaction.resumeQuestion`) asks first, whatever the session holds: the card above, with the agent's own ways among the ways to make room. The same card asks when the agent's own session was lost, and when a fresh start from Filament's copy does not fit it.
- **Fold now** in the ring's popover folds Filament's copy, and the agent starts a fresh session from it; the popover says so.
- **Undo** after the agent's own compaction: where the session was forked first, the session from before comes back; else a fresh session starts from Filament's copy. The button's hint says which.
- **A fresh start.** The agent starts a fresh session from Filament's copy in three cases: another model or another account answered last (a switch into the agent), Filament's compaction made room (*the agent writes a summary*, *Filament's copy*), or the agent's own session was lost. *Carry earlier turns as* (`context.carry`) shapes that start, and the turn's note says it happened, in what form and why that form: **Words** (the default) is what you and the agent said, each turn's tool calls counted in one line; **Folded** keeps one line per tool call; **Whole** keeps every tool call with its whole input and its whole result. The agent's thinking is never carried: Filament does not keep it.
- **A switch asks first, every time** (HarnessV4_Tasks A7). The first message after a switch to another account or model of a coding agent stops, and its card says what happens now — a new session handed Filament's copy (the newest compaction's summary, then the turns since), or, where the agent's session of the chat is still up, that session going on with the turns it missed; a session the copy's newest summary went past (another agent compacted its own context since, or Filament summarized the copy) is not up, and a new one starts from that summary (HarnessV4_Tasks A8) — and lists the forms, fullest first, each weighed in the new window with the agent's own prompt and tools. On an account switch the first choice is **Whole** where it fits, else the fullest form that fits; on a model switch it is the session's own `context.carry`. *Switch and send* answers it; a turn sent through the API answers it with `carry` (a form) or `sendAsIs` (the suggested one: Whole where the account changed and the model sent did not, else `context.carry`). Not asked of a turn that answers a waiting one, nor of one nobody is there for.
- **Filament's copy stays the size of what the agent holds.** Filament keeps its own copy of the chat: what another model, another agent or a fresh session of the same agent starts from. Two rules keep it from outgrowing the agent's context.
  - *Tool output stays out.* Under Words a finished turn is your message, the agent's words and one line: `⚙ [Filament left this turn's 7 tool calls out: Edit×2, Bash×3, Read, Write · 1 failed · changed src/a.js — re-run a tool if you need its output]`. The archive keeps the turn whole; the chat's page shows every call as it did.
  - *The copy follows the agent's own compaction.* Where the agent compacts its context and hands its summary over (Claude Code does: by itself in the middle of a turn, at the line, or on `/compact`), Filament's copy starts from that summary too, at no model call. The summary stands for the turns before it and for the turn's work up to then; the copy goes on with the rest of that turn. The Compaction pane lists it ("Claude Code compacted its own context during turn 12: Filament's copy starts from its summary"). A compaction the agent made by itself during a turn has no Undo: its session has moved on already.
  - *An agent that hands no summary over* (Codex, Cursor): Filament writes the copy's summary itself. Once the turn has ended, the compaction model (else memory's) reads the summary the copy stood on and the finished turns since, and writes one summary for the copy alone, in the background. The agent's own session goes on as it is, and is told its place in the copy once. The newest finished turn always stays as it was said. The same happens where the copy passes the session's line while the agent is under its own. It is written only where it makes the copy smaller: where the turns it would stand for, as the copy holds them, weigh no more than a summary would (about 1,000 tokens, or what the session's earlier summaries ran to), nothing is written and no model is called. The copy keeps those turns, and is asked again after each turn; Compact now's answer says so. The row reads "turns 1–8 compacted into one summary for Filament's copy alone (Codex compacted its own context and handed no summary over): Codex's own session goes on as it is". It has no Undo. **Stop** on its progress row leaves the copy as it is until the agent next compacts; a compaction you ask for meanwhile takes its place. *Keep the copy in step* (`context.compaction.follow`, on by default; the Context tab's **Filament's copy** row) switches it off: the copy then keeps every turn, and a start that does not fit asks first. With no model to write with, nothing is started, and the row says so.
- **Filament's copy is bounded at every step.** Two rules hold however long the session grows.
  - *A summary reads the summary before it.* A compaction of the copy reads the summary it stands on and the turns since, never the session from its first turn. What you wrote and what the model said is read whole, every word. For a coding agent's session the turns are read as their folds: a line per tool call, no results. For Filament's own loop each tool call's input and its result is read to a cap in a one-call reading (300 and 800 characters), and the cut is marked with how much was left out. The writer reads in the order of B (*How a writer reads the turns*): its warm cache, the turns whole, the instant fold, the turns folded in one call, and slices, one after another, where even folded they don't fit one call: a turn bigger than a slice is read in order across slices, and a long summary or fold is read whole, in pieces. Only a single message bigger than a whole slice is cut, and the summary says so. What comes back after a summary (the newest files, the plan) is read from the turns since the summary before it and from what that one brought back.
  - *A request opens what its copy holds.* The archive lists a session's turns without opening their messages, and a composition opens the turns after the copy's summary. What a turn costs to compose follows the copy, not the session's length.
- **The ring after a switch.** Until the agent has answered once, the ring shows Filament's copy as an estimate, in the agent's window, and says so. The agent's own count takes over with its first turn.

### E. Where a setting comes from

Every setting above resolves through the same layers, the last one that names it winning:

1. the built-in value;
2. **your defaults**: **Settings › Context** in the harness (`sessions.defaults` in the config), laid over what the dashboard's rules name;
3. the project's settings;
4. the session's own. What the Start board changes for a new chat is written into the session when it starts, so it wins there.

Your defaults reach the sessions the harness holds: Filament's own loop, a team, a coding agent's chat. An outside client's chat skips layer 2's first half and stays on the dashboard's rules: what Settings › Context says of the harness's chats never reshapes a client's requests.

A default reaches every such chat that has not chosen its own, old chats too, from its next request. Settings › Context draws the same rows as a chat's Context tab, says under each row where its value comes from (*Your default*, with Reset, or *From the dashboard's rules*).

### F. Seeing it

- **The ring** in the composer shows how full the window is, with the line marked. Its popover has a bar of the window's parts with the line as a thumb to drag, one sentence on what happens at the line for this holder, **Makes room by** (a coding agent's ways, or Same model, Side model and Instant fold), *Compact now…*, the instant fold's count any time — with *Fold now* where it is at the instant line or under —, and, for Filament's sessions, *Dry run* and *Next request*.
- **The Context tab** of the side pane, under *How earlier turns reach the model*: **When the chat is full** (**Your line**; **Then**, *Ask me* or *Just do it*, where a card's Just do it from now on is switched back; **Back after a break**, *Ask me* or *Send as it is*), **How it makes room** (**The way**: the kind; **Summaries written by**: Same model or Side model), **Other agents' results**, **History** (the compactions), and **▸ Advanced**: **Every turn** (Tool results) and **Making room** (the fold's newest turns kept whole, and the instant line). A coding agent's chat shows the line, with where the agent compacts by itself, and its way; under Advanced, **A fresh start** and **Filament's copy**.
- **While a compaction runs**, a row under the last turn says who writes, how much is written, how long it has run and how long since the last byte, with **Stop** where it can be stopped: "⌁ Compacting · claude-opus-5-5 writes the summary in one call · ≈1,240 tokens written · 0:42 · last byte 8 s ago". A model that thinks first is said thinking ("thinking, ≈10,500 tokens so far"), then what it writes with that thinking beside it ("≈2,782 tokens written after ≈10,500 of thinking"), so the figure never falls back as if the call began again.
- **The finished row** stays in the transcript: "⌁ turns 1–4 compacted into one summary · 380k → 41k · 1m 12s · claude-opus-5-5 · cost $0.0421 · 2 files brought back", with *Show summary* and, while it is the newest and nothing was sent since, *Undo*. The figures are the request before and after (≈ where the after is an estimate), the time it took, who wrote it, what it cost, and what came back. The cost is the sum of the compaction's model calls, written once their records have finished; on a plan it reads "on your plan ($0.2900 at list price)", and where no call was priced the row says nothing.

### G. The slice pass

A summary its writer cannot read in one call, even with the turns' tool calls folded, is read in **sequential slices**: the last resort of *How a writer reads the turns* (B). Filament's own compactions fall to it, `/autofit` and the summary of a coding agent's copy among them; an outside client's compaction never does, since the client's own model writes that summary (§7). Its settings are `rules.trim` (Rules → trim), global — no session sets them: `sliceBudgetFraction`, `digestCapFraction`, `sliceSummaryTokens`, `minSummaryPercent`, `maxSliceTokens` and `tailMessageCapChars`.

- **What the writer reads**: each message as text — a tool call as `⚙ name(args…)`, a tool result cut at `tailMessageCapChars` (24,000 characters, about 6k tokens) with a pointer to the archive, thinking dropped, an image or a document as `[image]` / `[document]`. A message of words alone is never cut: it is read whole, in pieces.
- **Slices**: oldest first, whole turns while they fit, each call carrying the summaries before it. One call may use `sliceBudgetFraction` (0.7) of the writer's window, less the room kept for its reply, and a slice never holds more than `maxSliceTokens` (100,000; 0 sets no ceiling). Each slice is sized once the call before it returns, from the summary that call wrote, so the pass finds its count as it goes; the compaction's progress names the slice it is on.
- **Long turns**: a turn bigger than one slice is cut into **parts at step boundaries** (a step is one model reply with its tool results, so a call is never separated from its result). Short turns are never cut. Only a single message bigger than a whole slice is cut, and the summary says so.
- **The rolling digest**: once the carried summaries pass `digestCapFraction` (0.3) of the slice budget, one call re-compresses them into a rolling digest, so later slices still have room. That call breaks the cache reuse of the carried prefix; between digests the prefix only grows, and caches.
- **Each summary** is asked for about `sliceSummaryTokens` (1,500), in words in its prompt, and kept whole: the call asks for all the writer can write inside its window, since a reasoning model thinks inside the same room.
- **Hollow summaries**: one under `minSummaryPercent` (0.5%) of its slice is retried on a slice half the size (at most 3 paid retries a pass; the rest of the pass stays at the size that worked). One that cannot be split further is kept, and its heading says it is unusually short. A hollow summary is never cached, and a cached one under the floor is written again.
- **Failures**: a slice that fails or comes back empty is not represented, and the summary says so; when the pass's first three calls all fail, the pass stops.
- **Cache**: slice summaries are kept by content hash (the archive's `trim_slices`), shared across sessions, so a slice read again costs nothing.
- **Cost**: one record per call, under memory purpose `compact`.
- **The summary** is the pass's parts in order: `## Earlier, condensed` (the rolling digest, when there is one), `## Part n — messages a to b`, and `## Not represented` where something was left out.

## Part 2 — An outside client's chat

**Scope.** From here on this is the rulebook for an **outside client** — a tool that owns its transcript. Filament sends its history as it came and adds memory; the client compacts by itself, its own model writing the summary (§7). The harness's compaction is Part 1's and [GUIDE.md §23](GUIDE.md#23-the-harness)'s. Where this part and those differ for a harness session, they are right.

## 0. The mental model, one screen

Your client (Cursor, Codex, Claude Code used as an API client) **owns the transcript**. It resends the whole conversation on every message, and it alone decides when to compact and what to adopt as its new context. Filament sits on the wire and can do exactly two kinds of thing to that conversation:

1. **Answer a request itself** — memory's chat commands (`@mem …`, `/goal …`; [COMMANDS.md](COMMANDS.md) lists them all: the rest are Filament's in its own chats, and here go to the client's model or coding agent as typed). The client's *compaction request* is not one of them: it goes to the client's own model as the client sent it, and the client adopts the summary that model writes (§7).
2. **Add to a request** — memory's briefing (at the end of the system prompt) and per-message "related memory" blocks, re-attached byte-identically on every resend so the provider's prompt cache holds.

Nothing reshapes a request: the history goes out as it came, one over the model's window too, and the provider's refusal reaches the client (§8). Independently of both, Filament **archives** every user message, model reply and tool exchange of every session. Nothing any mechanism below does deletes anything: `@mem load <session> full` gets the originals back.

## 1. Vocabulary

| Word | Meaning |
|---|---|
| **client** | The program you type into (Cursor, Claude Code, Codex). It owns the transcript and the decision to compact. |
| **history** | The message list the client sends with every request — its entire conversation, unchanged. Filament never modifies this or the client's scrollback, and sends it on as it came. |
| **provider / API server** | Where the model runs (Anthropic, OpenAI, a router). It sees only what Filament sends. |
| **session** | Filament's name for one conversation over time, identified by the client's conversation id (else a fingerprint of folder + first message). What you set on it — in the console, or `@mem off` — lives on it. The memory pages call it a *chain*. |
| **turn** | One unit of work: your message, then everything the model did until it stopped and waited for you again — tool calls, tool results, its text. The last turn in the history is the **live turn** (your new message alone, or a tool loop in progress). All others are **completed**. |
| **step** | Inside a turn: one model reply together with the tool results that answer it. A 200-tool-call turn is ~200 steps. Cuts inside a turn happen only between steps, so a call is never separated from its result. |
| **traffic** | The tool_use blocks, tool_result blocks, thinking blocks and images inside a turn. The bulk. |
| **report** | The turn's text: your message and the model's text (all of it, in the order it was written). The part that carries meaning. |
| **stub** | One line standing in for one tool call: what was called, on what, what came back in ten words. `⚙ Read src/trim.js → 584 lines · 22 KB`. |
| **fold** | Turning a completed turn into exactly two messages — your message (text only) and one assistant message that opens with a one-line header and then carries the model's text and the stubs in the order they happened. Pure parsing; no model is called (§6). |
| **compaction request** | The request the client sends when it compacts: the whole history plus a message asking the model to summarize it. Filament recognizes it by that message. |
| **compaction** | The event: the client replaces its history with one summary text, which its own model wrote. The archive keeps it as the session's compaction of kind **client** (§7). |
| **memory's model** | The model memory works with (`memory.models.summarizer`, Settings › Memory › Model): it learns sessions, curates, rewrites recall queries and names chats, at low effort (`memory.models.effort`). Not set, each call takes the chat's compaction model, else the chat's own, else the most recently active chat's; never the cheapest by itself. |
| **/autofit** | The manual fit, typed when a harness session has outgrown its window: the smallest run of oldest turns that holds the next request under the margin is summarized into one compaction. Nothing ever does this on its own; in a client's session it goes to the client's model as typed — the client owns its history. |
| **memory blocks** | What memory adds: the **briefing** (end of the system prompt, built once per session) and the **related-memory block** (on your message, when retrieval finds something). Re-attached byte-identically on every later request. |
| **archive** | Filament's own store of every turn, reply, tool exchange and compaction, per session. Nothing any mechanism does removes anything from it. |
| **record** | One row on the Traffic page: one request through Filament, with tokens, cost, cache, the history's weight and composition, the changes made, and (when bodies are stored) what came in and what went out. |
| **local reply** | An answer Filament wrote itself: a chat command's. Cost 0, marked local on the record. Most commands call no model; the one call setting a goal spends (`/goal <text>`) is a record of its own. |
| **raw estimate / billed** | Two counts for the same conversation: the record's stamp estimates chars/4 of the raw messages; the provider bills the truth. Filament's runs low on code. |
| **cache read / write / prefix** | The provider caches the beginning (prefix) of a request; a request that begins with the same bytes as the last one reads it at 0.1× price; new or changed bytes are written at 1.25×. A client that resends its history unchanged keeps the prefix stable. |

## 2. What happens to every message, in order

1. **Situate.** Filament identifies the client, the project (from the working directory in the system prompt) and the **session**: the client's conversation id header when it sends one, else a fingerprint of folder + first message. Nothing is written yet.
2. **Chat commands.** If the newest message is one of memory's chat commands — `@mem …`, `/goal …` ([COMMANDS.md](COMMANDS.md) lists them all) —, Filament answers it and stops; the rest, `/compact` among them, are Filament's in its own chats, and here go to the client's model or coding agent as typed. For memory's commands no model is called and nothing is billed — but for the one call `/goal <text>` spends sizing the goal —, and the message is *not* archived as a turn. Your client still keeps the exchange in its transcript, so it shows up in later requests as an ordinary (text-only) turn.
3. **Memory's prepare pass** (memory on): the new user message is archived byte-exact; earlier `<filament-memory>` blocks are re-attached where they were; the briefing is built on the first turns and then reused; a "related memory" block is added for this message when it earns one; a compaction request is recognized, and gets no related-memory block while keeping what every request of the session carries (§7). Details in §5.
4. **Handed on.** Whether this request is the client's compaction request is noted — memory's signal, or the request's own shape where memory's pass stopped early — so that a summary cut at the output cap is named on the reply (§8). The memory trace marks where the request is handed to the upstream.
5. **The history's stamp.** The record notes what the history carries as it was sent — its weight, its turns, its composition. Nothing is changed.
6. **The context stamp** (§8): the record notes the destination's window, where the number came from, the request's estimate and a one-word verdict. Nothing is changed — a request over the window goes out as it is, and a provider's "prompt too long" reaches the client unchanged.
7. **Upstream call.** Afterwards, memory archives the reply and the tool work, judges whether injected memory was used, and hands the session to the learner (background); a compaction request's reply is archived as this session's compaction, and the learner reads the session's turns at once. A compaction reply that stopped at the output cap is flagged (§8).

`count_tokens` requests (Anthropic clients' meter) are answered locally after step 1: Filament's own estimate of the body as it came, never sent on.

## 3. Round trips — Client → Filament → provider → Filament → Client

Who does what, what is parsing and what is a model call, and when the client is waiting.

### 3.1 Which operations call a model, and who waits

| Operation | How it is done | Model call? | Does the client wait? |
|---|---|---|---|
| `@mem status`, memory's other commands but setting a goal | parsing + a lookup on the session | no | instant local reply |
| `/goal <text>` (setting a goal) | the goal's intake estimate, then a local reply that proposes its slice | **yes — the chat's own model when it is a plain route, else memory's model**, once | yes, for that command only |
| The client's compaction request | the request goes on as it came, with what memory adds to every request of the session | **yes — the client's own model**, once, reading its warm cache where it still holds | yes, as for any compaction the client's model writes |
| `/autofit` (typed in a harness session) | the smallest prefix of oldest turns that holds the margin, summarized; the result weighed before anything is written | **yes — the session's summary writer** (Part 1 B), once — twice when the first summary came back fatter than the cut allowed | yes, for that command only; nothing else ever triggers it |
| Memory retrieval, briefing, related-memory block | search in the local memory engine and the archive | no paid model; the engine is a local process | yes, milliseconds |
| Memory query rewrite (off by default) | alternative search words for a message whose own words find little | **yes — memory's model**, one small call | yes, waited for; a failed rewrite is dropped |
| Memory tools (the model asks memory mid-reply) | Filament answers the tool calls locally and asks the main model again | the **main model**, extra rounds | yes; a streaming client sees the reply only after the rounds |
| Learner (durable facts from a session) | runs when the session has been idle for 30 minutes, or right after any compaction a window adopts (the client's own summary included): the session's own turns, in passes | yes — memory's model for the chat | **no** — always in the background |
| The history's stamp, `count_tokens` | parsing | no | no |

Everything that costs money appears as its own record on the Traffic page: the main call under the client's name, Filament's own calls under memory purpose `compact` (`/autofit`, Compact now, and the slices of either), `recall` (rewrite) or `learn`.

### 3.2 An ordinary message

```
Client ──(1)──▶ Filament ──(2)──▶ Provider ──(3)──▶ Filament ──(4)──▶ Client
```

1. **Client → filament.** `{ model, system, tools, messages: the whole history, max_tokens, stream }` plus its conversation id. Only the last message is new to Filament.
2. **Inside Filament, before the call** (you are waiting; normally tens of milliseconds): the session is identified; your message is archived byte-exact; the memory blocks earlier messages received are put back on them, unchanged; the briefing is appended to the system prompt (built on the first turns from the engine and the archive, then reused as-is); a related-memory block is added to your message when retrieval finds something (with a rewrite call, where you switched it on, when the message's own words find little); the record is stamped with the history's weight and the context-fit numbers (§8 — nothing is reshaped to fit); the model name is mapped to the upstream and the credentials swapped.
3. **Filament → provider → filament.** The request goes out; the reply streams back. Filament forwards the bytes as they arrive, reading usage and the stop reason from them. If the model calls Filament's memory tools, Filament holds the stream, answers, asks the model again, and only then lets the reply through.
4. **Filament → client.** The client receives what the provider produced (plus, at most, a one-line memory cue in front). After the last byte: the reply and the tool work are archived, memory use is judged (no model), the session is marked for the learner — background, never waited on.

Stored: the record (tokens, cost, cache read/write, the changes list); the archive turn; the bodies when `storeBodies: full`.

### 3.3 A chat command

`@mem status`, `@mem off`: Filament recognizes the newest message, computes the answer locally, stores the setting on the session where the command sets one, and replies in the client's wire format as if a model had answered. Nothing goes to the provider; cost 0; the message is not archived as a turn; the client keeps the exchange in its transcript.

### 3.4 A compaction request

1. **Client → filament.** The whole history plus its summary prompt ("create a detailed summary of the conversation so far…") — sent by the client on its own when its meter is full, or when you run its compact command.
2. **Inside Filament.** Memory recognizes the compaction request (§7): it adds no related-memory block and keeps what every request of the session carries — the earlier blocks, the briefing, its tools — so the provider reads the history from its cache where it still holds it. The request then continues like an ordinary message, to the provider as it came.
3. **The model writes the summary**: your main model, now acting as the summarizer. **You wait for the main model, billed at its price on the whole history**, at the cache's read price where its cache still holds it.
4. **Filament → client.** Filament forwards the summary, flags it with **✂** if it stopped at the output cap (§8), and archives it as the session's compaction of kind `client`; the learner reads the session's turns at once, in the background. The client adopts the summary as its new context.
5. **Your next message.** It goes out after the summary; memory recognizes it as after compaction and links the continuation; the provider writes a fresh, small cache prefix; work continues.

### 3.5 A request over the window

Nothing special happens on the way out: the record's context stamp says `over`, the request goes to the provider as it came, and the provider's refusal ("prompt is too long") reaches the client unchanged — no retry, no trimming, no local refusal. The fix is the client's own compaction, or `/autofit` in a harness session (§8). The harness's agent loop is the one place that stops before sending: it is the client of its own turns, and past the full window it says so in words and names `/autofit`.

### 3.6 `count_tokens`

The client asks "how big is this?"; Filament answers with its own local estimate of the body as it came — the request is counted, never sent; no memory, no archive, no model, no provider.

### 3.7 In the background, never waited on

The learner (after 30 idle minutes, or right after any compaction), archive housekeeping, the memory engine's consolidation. All visible under Memory → learning and on the System tab.

## 4. Sessions: what persists, and when you get a new one

Everything set on a session — in the console, or with `@mem off` — is stored on the **session** (memory's chain). So:

| Situation | Session | What carries over |
|---|---|---|
| New chat | new | nothing: its project's settings and the dashboard's rules |
| Same chat resumed tomorrow (same client conversation id) | same | everything. The provider's cache has expired, so the first request is one full cache write whatever you do. |
| Client compacts (its own model's summary) | same | everything. Memory recognizes the summary's first line and links the continuation. |
| Fork / duplicate the chat in the client | new id → **new session** | **nothing.** Its settings start over. Memory links the new session to an earlier one of the project when its agent loads that one in its first turn, and borrows the earlier memory blocks for cache stability — but not your settings. |
| Client id rotates for the same conversation | new | same as fork |
| Memory off | as with memory on | everything: the archive still records each session and keeps what is set on it; nothing is recalled or learned, and `@mem` is still answered |
| A chat with an ACP agent (Claude Code as an agent, Cursor SDK) | yes | the agent keeps its own history, and its own compaction does not pass through Filament. In the harness such a chat has its own ways of making room, `/compact` and Compact now among them: Part 1 D |

In a client's chat Filament answers memory's commands alone: `/set` and the rest of Filament's go to the client's model or coding agent as typed — `/status`, `/sessions` and the commands [COMMANDS.md](COMMANDS.md) lists under In a chat with a coding agent included —, and the session's settings are changed in the console.

## 5. Memory, per turn

What the memory system does on an ordinary message (all of it visible in the request drawer's memory timeline):

- **Turn archived** — your message, byte-exact, encrypted at rest. Tool-loop legs (a tool result coming back) are not new turns.
- **Earlier blocks re-attached** — every `<filament-memory>` block an earlier message received is put back on that message, unchanged, so the history the provider cached stays byte-identical.
- **Signals** read from your text: its words to search by, after-compaction, compaction request. How much memory looks up never depends on what the words say.
- **Briefing** — built once, on the first turns of a session (identity facts, project facts, where the repository stands and its newest commit as git reads them then, recent sessions), placed at the end of the system prompt and reused as-is afterwards. Never rebuilt mid-session.
- **Related memory block** — a `<filament-memory kind="turn">` block on this message when retrieval finds something above the score floor: ~300 tokens budget (×1.5 after a compaction, or on a first message no briefing was built on; at most 3 items in conservative mode), leaving out what is in view already — what the briefing showed and what an earlier block shows on a message still sent; nothing for a message with no word to search by ("ok", "thanks") or for tool legs.
- **Memory tools** offered to the model (if enabled) — extra rounds the model may spend before answering; withheld from the client, counted on the record.
- **After the reply** — reply and tool work archived; "use judged" (did the model use what was injected); the learner extracts durable facts with memory's model.
- **Compaction request** — no related-memory block: the earlier blocks, the briefing and memory's tools stay as on every request of the session, so the prompt cache holds; the model's summary is archived as this session's compaction (§7); the next request is recognized as "after compaction" and linked.

## 6. The fold

The fold is the one shape Filament gives a finished turn without a model: a fold compaction in the harness, a writer's folded reading (Part 1 B), and a fresh coding-agent session carried Folded all use it.

- A **turn** starts at a user message that is not a tool result and runs until the next one. The last turn is the **live** turn, and it is never folded.
- A completed turn folds into two messages — your message (text only) and one assistant message carrying, in order, the model's text and **one line per tool call**: `⚙ Read src/trim.js → 584 lines · 22 KB`, `⚙ Bash npm test → error: 3 failing`. A header line says `[Filament folded this turn: N tool calls shown one line each — re-run a tool if you need its output]`. Thinking is dropped. Images and documents become `[image]` / `[document]` (`context.view.foldImages`, default on). Text the client tucked into a tool-result leg (a system reminder) is kept as text.
- A stub is at most `context.view.stubChars` (160) characters: tool name, the argument that identifies the call (path, command, pattern, query, URL…), and the result — verbatim when short, else `N lines · X KB`, errors as `error: <first line>`.
- **Deterministic**: the same bytes always fold to the same bytes, so a folded prefix is byte-stable and the provider's cache serves it. `VIEW_VERSION` changes every fold at once (one write) when the format changes.
- Anything the model *did not write down* about a tool result is gone from what the fold carries — that is the whole trade. The archive keeps the turn whole, and `filament_recall`, on every request of the chat, brings it back.
- Weaker models may imitate `⚙` lines in their own text; the header line is the tell.
- The fold does not touch the system prompt or tools; a huge system prompt is a huge system prompt.

## 7. The client's compaction

The client compacts by itself: it sends its whole history plus a message asking its model to summarize it, the model writes the summary, and the client adopts that as its new context. Filament sends the request on as it came, with what memory adds to every request of the session; none of the harness's compaction settings (Part 1 B) reaches it.

- **Recognized** by the client's newest message, where it asks the model to summarize the conversation: Claude Code's prompt matches, as does any prompt of the shape "create a summary of the conversation so far"; memory's own signal is OR-ed in. A tool-result leg that carries those words is a tool loop, not a compaction.
- **What memory adds**: what every request of the session carries — the earlier blocks re-attached, the briefing, the goal where the session has one, memory's tools — and nothing new, so the provider's prompt cache holds. The memory trace says "memory: this is the client's compaction request; the summary it produces is archived as a compaction".
- **What memory keeps**: the summary the model writes, archived as the session's compaction of kind `client` (method `summary`), standing for turns 1 to the newest finished one; an empty reply archives nothing. The learner reads the turns it stands for at once (§3.1), and the next request is recognized as after compaction and linked.
- **A summary cut at the output cap** is flagged on the record, and a warning is written (§8).
- A client that compacts with its **own** prompt shape that the pattern does not recognize sends memory an ordinary request: its summary is not archived as a compaction, and the memory trace shows no `compaction request` signal.

## 8. Fitting the window, and the client's own compaction

- **Nothing fits a request for you.** Every request record carries the context stamp — the window (and whether the operator's pricing, the provider's own listing or the built-in table named it), the usable room (on a harness session's request the compaction line, on any other client's the room after the reply's reserve), the estimate, and a verdict — but no request is ever trimmed, retried or refused to make it fit. Auto-fit did that until 2026-09-28; its "clear just enough" boundary walked one tool result forward per request and re-wrote the whole prompt cache every leg. A request over the window goes out as it came, and the provider's refusal reaches the client.
- **`/autofit`** is the manual fit for Filament's own (harness) sessions. It summarizes the smallest run of the oldest turns that holds the next request under a margin of the usable room — 85% by default (`rules.autofit.margin`), or name it for one run: `/autofit 70` — weighing the request as the agent loop sends it, its own system prompt and tool schemas beside the history (when those alone are past the margin it says so: no summary can help). It weighs the real summary before it writes, deepens the cut once if the summary came back fatter than the guess, and writes one compaction. `/autofit status` says the numbers and writes nothing. In a client's session it goes to the client's model as typed: the client owns its history, so compact on the client's side.
- **The client's own compaction** (§7): the client sends the whole history plus its summary prompt, the model writes the summary, the client adopts it. Filament archives it as the session's compaction of kind `client`. When that summary **stops at the output cap** (`max_tokens`), the record gets a `changes` line and a **✂ summary cut** pill, and a warn-level `compaction` operation is written: the client adopted a summary cut mid-sentence. Raise the client's max_tokens for compaction.
- **Token figures** are chars/4 estimates (`~`); the billed numbers are on the same record and run higher on code-heavy chats (measured 1.8–2×). An image counts a flat ~1,500 wherever it sits, in a tool result too: a screenshot read by a tool used to count by its base64, ~114k for a 300 KB PNG. A picture a request leaves out past its 24 MB of pictures, PDFs and files counts the words in its place, not ~1,500. A PDF a model reads as its text counts that text once Filament has read it; one Claude reads itself counts by its size, up to 100k.

## 9. Scenarios

**S1 — Fresh chat, nothing changed.** Every message: memory situates the session, archives your message, maybe adds a briefing (first turns) and a related-memory block, and forwards the history as it came. When the client compacts, its request goes to its own model with its own prompt, memory's blocks and briefing on it as on every request of the session; memory archives the summary the model writes as a compaction, and the learner reads the session's turns at once.

**S2 — Resume a chat tomorrow.** Same client conversation id → same session, same settings. The provider's cache is cold, so the first request writes the whole prefix once.

**S3 — Fork a chat in the client.** New conversation id → **new session**: its settings start over. Memory links the fork to an earlier session of the project if its agent loads that one in its first turn, and borrows the earlier memory blocks so the cached history stays identical — but you re-issue any setting you set yourself.

**S4 — Claude Code, an ACP agent.** Claude Code as an API client: everything above, `@mem …` its commands of Filament's. An ACP agent chat: in the harness `/compact` and Compact now make room by the chat's own ways (Part 1 D); `@mem load <session> compact` brings the compaction the session adopted into a new agent session.

## 10. Recipes

**General user** (the defaults): your client compacts on its own, with its own model; memory archives each summary and learns the session's turns at once.

**Compaction checks**: a ✂ on a client's compaction means its summary was cut at the output cap: raise the client's max_tokens for compaction.

## 11. Stress-testing: what to type, what to watch

- Per request: the record's tokens and cache read/write, the `changes` list (`compaction: … output cap`), the memory timeline.
- Compactions: a client's compaction is a request on Traffic like any other, the summary its reply; one cut at the output cap shows **✂ summary cut** on its row, and a warn op under System.
- Good looks like: cache read ≫ write after the first request, a compaction request's included while the cache holds; no ✂.
- Bad looks like: a cache write as large as the history on a request where nothing changed (report it with the request id); a ✂.
- Known-soft numbers: every `~` token figure is chars/4 and runs low on code; the billed numbers on the record are the truth. With `storeBodies: full`, a 400k-token session makes ~4 MB records and the request log keeps only a dozen of them across a restart.
