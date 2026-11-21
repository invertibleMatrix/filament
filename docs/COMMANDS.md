# Commands you can type into a chat

Generated from `src/app/commands/registry.js` by `npm run docs`; the console's Docs → Commands tab shows the same list with the words your configuration uses. Filament answers the commands here itself, most with no model, no agent and no tokens, the reply marked local on the Traffic page; a row says where one calls a model or an agent (setting a goal, a sub-agent, a compaction). `/resume` and `/flow` give the agent a turn to run, and the harness's own box answers `/compaction`, `/craft` and `/rewind`: nothing goes to the model or agent until you choose. Memory's commands, on unless Memory → Settings switches them off, are answered in every chat memory does not leave out, memory on or off (it leaves out Filament's own calls and the clients, models and folders excluded in Memory settings), and `/goal …` in every chat. The rest are answered in a chat Filament runs, the harness's — with a coding agent, `/status`, `/compact` and `/clear` are passed on to the agent where it publishes its own; in an outside client's chat they go to its model or its coding agent as typed.

| where | meaning |
|---|---|
| api | API-model chats |
| agent | agent chats |

## In a chat Filament runs

Typed as the newest message in a chat Filament runs, the harness's. Filament answers these itself: no model or agent is called, nothing is billed, and the reply is marked local on the Traffic page. With a coding agent they stand beside those listed under In a chat with a coding agent (`/status` goes to the agent where it has one of its own). In an outside client's chat they go to its model or its coding agent as typed.

| command | forms | where | what happens |
|---|---|---|---|
| `/status` | `/status` | api, agent | Where this model name goes, what Filament changes on the request, this chat's spend and the upstream's health. In an agent chat: the agent, its model, mode, effort and context fill. |
| `/cost` | `/cost` | api, agent | This chat's cost, durations (API and wall), usage per model and prompt-cache stats — the shape of Claude CLI's /cost, from Filament's own records. Costs use each model's price card (its upstream's, else Filament's built-in rates); the provider's invoice is the truth. |
| `/help` | `/help` | api, agent | The short list of commands for this kind of chat. |

## The session's goal

One objective per session, sized before it starts. Proposing a goal spends one model call — the intake estimate — that says how big the goal is (hours to team-years) and which slice one developer with this assistant can plausibly finish. Nothing is active until you accept that slice; then it rides every request of the session: said on your next message, and at the end of the system prompt from the chat's next compaction on, so accepting, rewriting or closing a goal changes nothing the provider cached; and in a Filament chat it is driven round by round: each turn that ends starts the next by itself, until the agent marks the slice done or blocked, you press Stop, hold it or write to the agent, 20 rounds pass, or 2 hours do. It counts no money: nothing of a goal stops for what it spent.

| command | forms | where | what happens |
|---|---|---|---|
| `/goal <text>` | `/goal <text>` | api, agent | Propose the goal. Filament sizes it with one model call (the chat's own model when it is a plain route, else memory's model) and proposes the achievable slice; the goal stays proposed. |
| `/goal accept` | `/goal accept` | api, agent | Activate the proposed slice: your next message carries it, the system prompt from the next compaction on, and in a Filament chat its first round starts. |
| `/goal go` | `/goal go` · `/goal hold` | agent | Drive an active goal on — after the agent said done or blocked, your Stop, a hold, your words to the agent, or its 20 rounds or 2 hours — with 20 rounds or 2 hours more; hold stops it starting rounds by itself. |
| `/goal slice <text>` | `/goal slice <text>` | api, agent | Rewrite the slice in your own words, before or after accepting (after: the block changes on the next request). |
| `/goal status` | `/goal` · `/goal status` | api, agent | The goal, its estimate and slice, and its drive: the round it is at, or why it halted and what goes on. |
| `/goal done` | `/goal done` · `/goal abandon` | api, agent | Close the goal (kept on the session's record); your next message says so, and the block leaves the system prompt at the next compaction. |

## Sub-agents

A fresh agent loop on one task, with this session's tools, rules, hooks and instructions — its own request on Traffic and the tray, its model calls under it. It sees nothing of the conversation unless it is given a view of it, composed locally from the archive with no model call. The report goes to the session's agent, in its loop, or stays with you as this command's answer (`wait=on`, a start, an agent called by its tag) until you send it on. In an outside client's chat the command goes to its model as typed.

| command | forms | where | what happens |
|---|---|---|---|
| `/subagent <task>` | `/subagent <task>` · `/subagent model=<m> view=<none\|folded\|window\|fork> <task>` · `/subagent may=<read\|copy\|edit> pause=on inform=on <task>` · `/subagent worktree=off <task>` · `/subagent wait=on <task>` · `/subagent wait=off <task>` · `/subagent start=<ask\|job\|review> <task>` · `/subagent as=<tag> <question>` | api, agent | Launch one. Options are `key=value`, before the task: `model=` (else this chat's rows for its card, else its card's models, else this chat's list `subagents.pool`, else the main agent's model — each at its row's effort), `view=none\|folded\|window\|fork` (what it sees of this conversation, else nothing — `folded` every completed turn folded, `window` the agent's context window, `fork` the agent's newest request whole, on the agent's model), `may=read\|copy\|edit` (what it may do, where lower than its card says: `read` only reads; `copy` works in its own copy of the project, under the session's permission mode, and nothing it changes there is kept; `edit` changes files), `worktree=on\|off` (a writing sub-agent works in its own git worktree and its changes wait for `apply`; else the session's `subagents.worktree`), `pause=on` (the agent turn running now waits for the report; with none running there is nothing to pause), `inform=on` (the running agent hears at once what you launched), `wait=on\|off` (the report kept with you as this command's answer, or delivered to the session's agent). `pause` and `inform` need the report delivered. `start=ask\|job\|review` fills the options for one of three starts, an option you name beside it winning, and keeps the report with you: `ask` is the Reviewer, who only reads, and sees the conversation folded and the turn running now; `job` is the Builder, in its own worktree, and sees the conversation folded and the turn running now; `review` is the Reviewer, who only reads, and sees what the last finished turn changed, as a patch, and nothing of the conversation. `as=<tag>` calls one of your saved agents by its tag (Library › Agents and teams: `product`, `enduser`, `builder`, `reviewer`, and yours): it sees and may do what its card says, runs on this chat's rows for it, else its card's models, first choice first, else this chat's list, else the main agent's model, and its answer comes back to you as this command's answer; `model=`, `view=` and `wait=off` beside it win over the card, `may=` lowers its level for this one launch and never raises it, and it takes no `start=`. |
| `/btw <question>` | `/btw <question>` | api, agent | A side question: `/subagent start=ask <question>` by its shorter name. The Reviewer reads this conversation, changes nothing and answers here; nothing is delivered to the session's agent. Typed in the harness's own box it is no message of the session's at all: its thread opens in the Agents tab, while a turn runs or not, and the main agent never sees the words. |
| `/subagent list` | `/subagent` · `/subagent list` | api, agent | This session's sub-agents, newest first: state, the agent each runs as, model and task. |
| `/subagent <id>` | `/subagent <id>` · `/subagent status <id>` | api, agent | One sub-agent: its state, rounds and tool calls, and its newest report in full. |
| `/subagent ask <id> <follow-up>` | `/subagent ask <id> <follow-up>` | api, agent | Continue a sub-agent's conversation in the context it already has — "check again" after you fixed what it found. The report goes where the sub-agent's went (one whose reports you keep answers here), unless `wait=on\|off` says otherwise. |
| `/subagent stop <id>` | `/subagent stop <id>` | api, agent | Stop it now — its running command or model call is cut; what it finished is kept and delivered as its report. |
| `/subagent send <id>` | `/subagent send <id>` | api, agent | Pass a report you kept (`wait=on`, or a harness launch with its report kept aside) on to the session's agent: its running turn reads it at the next step, else it opens the agent's next turn. |
| `/subagent changes <id>` | `/subagent changes <id>` | api, agent | What a sub-agent changed in its own git worktree, waiting to be applied: the files with their line counts, and the diff. |
| `/subagent apply <id>` | `/subagent apply <id>` | api, agent | Bring a sub-agent's worktree changes into this session's folder — a file changed here meanwhile is merged with them; if any change overlaps, nothing is applied and you hear which files. The index and HEAD are untouched; it works after a restart too. |

## Every setting (/set, /unset, /settings)

The settings registry is the one table every setting lives in, and these three commands read it — a setting added next month is changeable from any chat Filament runs the day it exists, with no new command code. The familiar commands stay because they are quicker to type: underneath, they write the same settings. Commands write only this session's own layer; the project layer and your global settings are edited in the console. In an outside client's chat these go to its model as typed.

| command | forms | where | what happens |
|---|---|---|---|
| `/set` | `/set <setting> <value>` · `/set stubChars 200` · `/set compaction.model haiku` | api, agent | Change exactly one setting for this session, with no feature rules. The name is its dotted path or a unique ending of it; the reply names the old value and where it came from. |
| `/unset` | `/unset <setting>` | api, agent | Remove this session's own value, so the setting follows the layers below again. When nothing is set there is no write, and the reply says what it already follows. |
| `/settings` | `/settings` · `/settings all` · `/settings <section or prefix>` · `/settings <name>` | api, agent | What is in force and where each value came from (this session, this project, your global settings, the built-in default), grouped by section. `all` lists every setting; a prefix narrows; an exact name explains one: its description, form, value in each layer with the winner, its reach, and how to change it back. |

## Teams (/team)

Which team answers this chat's turns in the harness. A team is a lead on the chat's model — it plans, briefs and checks — and workers that do the work — Builders and Reviewers, seated as its Scout, Builder, Tester and Reviewer — on a seat's own model, else the Brief's pick, else this chat's rows for its workers, else the team's models, else each worker's card, else this chat's list (subagents.pool), else its lead's model, at its lead's effort where a row names none. Two ship with Filament (`builders`, and `bughunters`, which finds bugs and checks claims), and yours sit beside them. Choosing one writes this chat's settings (engine.mode and engine.team), so it holds until you give the chat back. The lead's orders run at once — an apply writes the worker's change into your folder and commits nothing. While its workers run the lead reads along with them (engine.supervise, on unless you turn it off): Filament shows it what each one thinks, says and calls, and it corrects one that heads wrong with a message the worker reads at its next step. A compaction and Filament's own calls never go to the team. Teams are still being tried: these are answered while Settings › Experimental's Teams switch is on, and off, `/team` says so and `/team off` still gives a chat back.

| command | forms | where | what happens |
|---|---|---|---|
| `/team` | `/team` · `/team help` | api | The teams — each one's lead in a sentence — which one leads this chat, and the model its workers run on. |
| `/team <name>` | `/team <name>` | api | Hand this chat's turns to a team from the next message on: its key or its name (`/team BugHunters`). Switching costs one fresh prompt cache, once. |
| `/team off` | `/team off` | api | Give the chat back: its turns go to your agent again. |

## Task graph (/graph)

How every session plans — the agent, or a team's lead while a team answers the session. The planner has a tasks tool beside its checklist: work whose pieces depend on each other or could run in parallel goes on a graph of tasks, each with the tasks it needs — Filament keeps them in order, and refuses a loop of needs, an unknown need and two tasks at once on one file — while a short straight list stays on the checklist. The planner chooses, piece by piece. The agent gives each task to itself, a sub-agent or an explorer; a lead gives each to a worker of its team's roles, and may have a reviewer read a builder's or a tester's change before it merges, two rounds at most. Filament starts each task by itself once its needs are done and a slot is free, merges each change into the folder when its worker reports done with its check passed, and tells the planner each end. The harness's Plan view draws the graph live.

| command | forms | where | what happens |
|---|---|---|---|
| `/graph` | `/graph` | api | This session's task graph as its planner reads it — the agent, or a team's lead. |

## Compaction (/compact)

In a chat Filament runs, the session makes room its own way when it reaches its line — one summary by the same model while its cache is warm, one by the side model, or the instant fold (Settings › Context). An outside client's own compaction goes to its model as the client sent it: Filament adds memory to it, and nothing else.

| command | forms | where | what happens |
|---|---|---|---|
| `/compact` | `/compact` · `/compact <what to keep>` · `/clear` | api, agent | In a chat Filament runs, compact the session now, its own way — one summary it learns from first, or the instant fold — inside this command's own turn; Undo is on its row until the next message. In a harness chat with a coding agent that compacts its own context when asked (Claude Code, Codex), the agent does, told what to keep, and the compaction is listed with the session's, with the same Undo. Typed in an outside client's chat it goes to the client's model or coding agent as typed. /clear, in a harness chat with a coding agent, is explained, or passed to the agent where it has its own. |

## Context fit (/autofit)

Nothing between a client and its provider reshapes a request — a request that does not fit goes out as it came and the provider's refusal reaches you: reshaping a request on its way out would re-write the prompt cache on every request. When a session outgrows its window, /autofit compacts exactly as many of the oldest turns as the window needs — never more — and verifies by re-composing. The window, the estimate and the verdict are on every request record either way.

| command | forms | where | what happens |
|---|---|---|---|
| `/autofit` | `/autofit` | api, agent | Fit this session now: summarize the smallest prefix of oldest turns that holds the next request — the agent's own prompt and tools beside the history — under 85% of the compaction line (one compaction-model call), then report the before and after. Already inside the margin: it says so and writes nothing; the prompt and tools alone past it: it says so, since no summary can help. |
| `/autofit <30-95>` | `/autofit 70` · `/autofit 50` | api, agent | The margin — the share of the compaction line to hold after the fit. A smaller number compacts deeper. |
| `/autofit status` | `/autofit status` | api, agent | The numbers, nothing written: window, compaction line, the next request's estimate (the agent's prompt and tools, and the history), and what a fit would compact. |

## The compaction card (/compaction)

In the harness, the card that asks before a message when the chat is past its line or its cache has gone cold, brought up when you want it rather than when the chat is full. The harness's own box answers it: nothing goes to the model or agent, and nothing is compacted until you choose.

| command | forms | where | what happens |
|---|---|---|---|
| `/compaction` | `/compaction` · `/compaction <message>` | api, agent | Bring up the compaction card after the chat's last turn: what the chat holds against its line, every way to make room with what each leaves, costs and takes (a coding agent's own ways apart from Filament's), and, for this compaction only, the model that writes and the share kept word for word. Alone, Compact makes room by the way chosen. With a message after the word, Compact and send makes room and then sends it, Send as it is sends it now, and Dismiss puts it back in the box. Outside the harness the word goes to the model or agent as typed. |

## A flow (/flow)

In the harness, ask your main agent for a flow: your agents and teams in steps beside the chat, each box handed your words and the results of the boxes it needs. Your agent designs it with its flow tool and the draft stands over the message box; nothing runs until you press Start.

| command | forms | where | what happens |
|---|---|---|---|
| `/flow <words>` | `/flow <words>` | api, agent | Your words go to your main agent with Filament's line ahead of them: design a flow from them with the flow tool — who does what, in which order, which result each box needs, and why each step is where it is. The draft stands over the box: change it by hand or by telling your agent, then Start beside your chat. While a turn runs it waits in the queue. Outside the harness the word goes to the model or agent as typed. |

## Plan before it starts (/plan)

In the harness, ask your main agent to plan the work whole before any of it starts: a short job on its checklist, complex work on its task graph — each task with what it needs, the files it writes and the check that proves it done, the plan's summary kept behind the graph. Its reply ends with that summary, and a card after it opens the Plan. Nothing of it starts until you say go. Asking for a plan in your own words does the same, without the card.

| command | forms | where | what happens |
|---|---|---|---|
| `/plan <words>` | `/plan` · `/plan <words>` | api, agent | Your words — what to plan, or nothing for the work under way — go to your main agent with Filament's line ahead of them: plan it whole by its size, start no task and change no file, and end the reply with the plan's summary. The card after it says how many tasks or steps the plan has and its goal: View the plan opens the chat's Plan tab. In a chat whose agent has no task graph, it plans in its reply. While a turn runs it waits in the queue. Outside the harness the word goes to the model or agent as typed. |

## Weigh a message aside (/steer-fork)

In the harness, while Filament's own agent works: your message goes first to a fork of its running turn — its conversation as the provider's cache holds it, on its model and effort — which sorts it while the agent works on. The ⌄ menu's Weigh aside first does the same; Weigh your messages aside in Settings › Experimental does it for every message.

| command | forms | where | what happens |
|---|---|---|---|
| `/steer-fork <message>` | `/steer-fork <message>` | api | A correction of the work at hand reaches the agent once the fork has sorted it; a question the fork answers under your message, and the agent hears of it only where the answer changes its work; more work it plans as tasks proposed on the agent's graph, none started, with a sealed letter the agent opens when it chooses. Where no fork can weigh it — the turn's first request is not back, the cache is cold, the conversation was compacted since, or a fork would carry more than half its line — it goes straight in, and its bubble says why. With no turn running, or in a coding agent's chat, it is refused and stays in the box. Outside the harness the word goes to the model or agent as typed. |

## Craft a skill (/craft)

In the harness, make a skill of anything — files, folders, books, web pages, this chat — in a chat of its own: you watch its agent craft it, step by step, and steer it there. The skill is kept in Library › Skills, on nowhere until you turn it on.

| command | forms | where | what happens |
|---|---|---|---|
| `/craft <words>` | `/craft <words>` | api, agent | Opens a crafter chat in the same folder with the same model, its first message — your words with Filament's brief — in its box, unsent: change the model or the words, then press Send. Its agent — every tool it has, the web and the browser among them, and its skill_craft tool — names the skill, adds its books, reads, and writes SKILL.md in the open. The chat you typed it in carries on. A skill's page has Craft it in a chat… for one already made. Outside the harness the word goes to the model or agent as typed. |

## Rewind (/rewind)

In the harness, go back to before one of your messages, in place: the files the chat's agents changed since, the conversation, or both. The turns are kept, folded into one line that opens as a fork; Undo on it puts it all back until your next message.

| command | forms | where | what happens |
|---|---|---|---|
| `/rewind` | `/rewind` | api, agent | Go back to an earlier message in this chat: the list of your messages, newest first — Esc twice in an empty box opens it too — then a confirm that says which files go back and how, and which turns leave the conversation. Nothing moves until you press it. Rewind on a message's hover opens the same confirm. Outside the harness the word goes to the model or agent as typed. |

## Welcome (/welcome)

In the harness, the welcome tour: connect a coding agent or a key, choose the model new chats start on and how the agent asks, set memory up, bring in the chats you had in other coding agents, pick a folder, meet the agents and teams, and see what else Filament does.

| command | forms | where | what happens |
|---|---|---|---|
| `/welcome` | `/welcome` | api | Open the welcome tour, at the step it was left on: Welcome, Connect a model, Default model, How it asks, Memory, Your chats, Your work, Agents and teams, Everything else, Ready. The command center's Welcome tour and the help menu's open it too. Outside the harness the word goes to the model or agent as typed. |

## Memory (@mem)

Long-term memory across every model and client. Answered by Filament, the upstream not called, in every chat — an outside client's included, memory on or off — but those memory leaves out: Filament's own calls, and an outside client's chat the clients, models and folders excluded in Memory settings leave out. In a chat of Filament's they leave out it is answered in their words, and does nothing.

| command | forms | where | what happens |
|---|---|---|---|
| `@mem status` | `@mem status` | api, agent | Engine, counts, this session, autopilot mode. |
| `@mem recall` | `@mem recall <words>` · `@mem search <words>` | api, agent | Search memory: facts, rules, preferences, decisions, summaries of past turns. |
| `@mem sessions` | `@mem sessions` · `@mem sessions <words>` | api, agent | Find past sessions by what you typed in them (no words: recent ones), numbered for `load`. |
| `@mem load` | `@mem load <n\|id>` · `@mem load <n\|id> chat\|summary\|full\|compact\|lineage` | api, agent | Paste a past session into your next message. `chat`: your inputs and final answers; `summary`: plus per-turn summaries; `full`: everything including tool activity; `compact`: the latest compaction bundle plus what followed; `lineage`: the session and all its ancestors, oldest first. |
| `@mem remember` | `@mem remember <text>` | api, agent | Keep a fact by hand, as your word. |
| `@mem rule` | `@mem rule <text>` | api, agent | Keep a rule by hand, as your word: how the agent must work. |
| `@mem prefer` | `@mem prefer <text>` | api, agent | Keep a preference by hand, as your word. |
| `@mem procedure` | `@mem procedure How to <goal>: 1. <step> 2. <step>` | api, agent | Keep a way to do a thing by hand, as your word; it replaces the other ways to its goal. |
| `@mem forget` | `@mem forget <id>` | api, agent | Remove a memory item by the id shown in recall results. |
| `@mem off` | `@mem off` · `@mem on` | api, agent | Memory for this chat: off recalls nothing into it and learns nothing from it (the archive still records). |
| `@mem new` | `@mem new` | api, agent | Start a fresh memory session in this chat: the next message starts a fresh chain with a fresh briefing, linked to a session of the folder its agent loads in that first turn. A chat of the harness's own goes on as itself; New chat starts fresh. |

## In a chat with a coding agent

A harness chat whose route points at a coding agent (Claude Code, Cursor, Codex, Antigravity, Qoder) through Filament's agent bridges. These are answered by Filament about the agent — `/resume` hands the agent a turn; the agent's own slash commands pass through to it (type /commands to see them). In an outside client's chat they go to its agent as typed.

| command | forms | where | what happens |
|---|---|---|---|
| `/sessions` | `/sessions` | agent | The chats the agent knows about, with the id to resume each one. |
| `/resume` | `/resume <id or its first characters>` · `/resume <title words>` | agent | Continue one of the agent's earlier sessions in this chat: Filament attaches the chat to it, and the agent runs a turn that says in a line or two where you left off. |
| `/new` | `/new` | agent | Start a fresh agent session; the earlier messages in this window are not sent along. |
| `/commands` | `/commands` | agent | Every command the agent itself offers, with what each one does (asked of the agent directly). |
| `/autocompact` | `/autocompact` · `/autocompact <tokens>` · `/autocompact auto` | agent | In the harness: this session's compaction line, said in tokens (`/autocompact 400k`). It is Claude Code's own word for where it makes room, and in a harness chat that point is the session's line: Filament opens every session of the chat with it, so Filament keeps what you type as the session's own line (the Context meter's) and it lasts through restarts and new sessions. `auto` gives the line back to your default; alone, it says the line. Outside the harness the word goes to the agent as typed. |

## Tricks on the model name

Not commands, but typed by you all the same: suffixes on the model name your client asks for. Each is stripped before the request leaves, and the record's changes say what was applied.

| command | forms | where | what happens |
|---|---|---|---|
| `-low … -max` | `<model>-low` · `<model>-medium` · `<model>-high` · `<model>-xhigh` · `<model>-max` | api, agent | Reasoning effort, spelled the provider's way on the wire (thinking budget, reasoning_effort, …). Your client's own effort picker works too. |
| `-fast` | `<model>-fast` | api | Anthropic fast mode where the model supports it (Opus); elsewhere the suffix is dropped and the record says so. |
| `@mode` | `<model>@plan` · `<model>@ask` | agent | The agent's mode for this chat (plan, ask, …), where the agent has modes. |
| `#id` | `<model>#<session id>` | agent | Resume that agent session from the first message: in an outside client's chat, the way to an earlier one. |

