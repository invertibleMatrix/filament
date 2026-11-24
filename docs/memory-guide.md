# Filament memory: the technical guide

*Everything the memory system does, from the moment a request arrives to the moment a fact is learned from it, with
every mechanism explained. Written for a reader who is comfortable with algorithms and data structures but has not
worked with language models; every model term is defined the first time it matters. The last chapter maps each
number in the console back to the mechanism that produced it.*

This guide describes the code in `src/services/memory/` (the older `src/memory-*.js` and `src/archive.js` paths it
names are one-line shims to it), `sidecar/mnemosyne_sidecar.py` and the console's Memory page
(`src/ui/pages/memory.js`). The harness shows the same memory in its Memory instrument and inspector tab. Where a number is a default you can change, the configuration key is named in brackets, for
example [`memory.autopilot.turnTokens`]; the full key list is in chapter 13.

---

## Contents

1. Vocabulary: the model and retrieval terms used below
2. The big picture: three stores and a brain
3. What a conversation is to memory: projects, sessions, turns, messages
4. Fresh session, resumed session, continued session, tool leg
5. The memory loop, step by step: before the upstream is called
6. The memory loop: while the upstream answers
7. The memory loop: after the reply, and later
8. Retrieval in depth: keywords, the engine, ranking, budgets
9. Learning and curation: when a model is called, what it is asked, what happens to the answer
10. Coding agents, and memory for any agent (`/mcp/memory`)
11. Commands and headers
12. The memory tools a model can call
13. Configuration reference
14. Data on disk: the archive schema, the engine database, the files
15. Privacy and security guarantees
16. Imports
17. Backups and restore
18. Observability: the trace, the benchmark, memory's own model usage
19. The console and the harness, element by element
20. Worked examples
21. Troubleshooting

---

## 1. Vocabulary

Read this chapter once; every later chapter uses these words without redefining them.

### 1.1 Models and prompts

**Model.** A large language model (LLM): a neural network that takes a sequence of text and produces the continuation
one piece at a time. Filament never runs a model itself; it forwards requests to providers (Anthropic, OpenAI-compatible
servers such as xAI or Neural Watt) or to coding agents (Cursor, Claude Code, Codex, Qoder), which run models.

**Token.** The unit a model reads and writes. Roughly four characters of English, or one short word; code tokenises
worse (more tokens per character). Providers bill per token and models have a maximum number of tokens they can see
at once (the **context window**). Filament estimates tokens as characters ÷ 4 everywhere it needs a budget; the
provider's own counts appear on request records after the fact.

**Prompt.** Everything sent to the model in one request: the **system prompt** (instructions the client puts first,
such as "You are a coding assistant. Working directory: C:\Filament"), then the **messages**, alternating user and
assistant turns. The client resends the whole history on every request; the model has no memory of its own between
requests. That fact is the reason this system exists.

**Wire format.** The JSON shape of a request. Filament speaks three: Anthropic Messages (`system` field plus
`messages`, content as arrays of typed blocks), OpenAI Chat Completions (`messages` with role `system`, `user`,
`assistant`, `tool`), and OpenAI Responses (`instructions` plus `input` items). Memory works the same in all three;
where a block is placed differs, and chapter 5 says where.

**Tool calling** (also *function calling*). A request may declare tools: named functions with a JSON schema for
their arguments. Instead of answering, the model may reply with a tool call (name plus arguments). Whoever runs the
loop executes it, appends a **tool result** message, and asks the model again. A coding agent's file edits and shell
commands work this way. Filament adds eight memory tools to requests and runs their calls itself (chapter 6).

**Tool loop, tool leg.** One user message often produces several requests: the model calls a tool, the client runs it,
sends the result back, the model calls another tool, and so on until it answers in text. Each of those requests is a
*leg* of the same turn. Memory recognises legs (chapter 4) so it does not treat every leg as a new message from you.

**Stop reason.** Why the model stopped: it finished (`end_turn` / `stop`), it wants tools run (`tool_use` /
`tool_calls`), or it hit the output limit (`max_tokens` / `length`).

**Streaming.** The reply arrives as a sequence of server-sent events (SSE), a few tokens at a time, rather than one
JSON body at the end. Filament forwards streams as they arrive; the memory tool loop has to work inside a stream
(chapter 6.2).

**Prompt cache.** Providers can cache the processed form of a prompt prefix and charge less (and answer faster) when
the next request starts with the same bytes. Anthropic charges cache *writes* more than plain input and cache *reads*
much less. Any change inside the cached prefix breaks the cache from that point on. Memory therefore places its text
so the prefix stays byte-identical across the requests of a session (chapter 5.9).

**Compaction.** When a conversation grows near the context window, clients (Claude Code, Codex) ask the model
to summarise it and start a new conversation whose first message is that summary. Memory detects both sides of this:
the request that asks for the summary, and the new conversation that begins with it (chapter 4).

**Housekeeping request.** A request a client sends for its own bookkeeping, not a conversation: "generate a title for
this chat", "summarise these messages". Memory stays out of these.

**Memory's model.** The model memory learns, curates, rewrites searches and names chats with (chapter 9.1),
[`memory.models.summarizer`], set in Settings › Memory › Model. Not set, each call takes the chat's compaction model,
else the chat's own. Its calls run at low effort ([`memory.models.effort`]).

### 1.2 Retrieval

**Embedding.** A fixed-length vector of numbers (here 384 floats) computed from a piece of text by a small neural
network, arranged so that texts with similar meaning get vectors that point in similar directions. The engine uses
the model its install warmed (`embeddingModel` in `engine.json`) through `fastembed`, on the CPU, offline: this build
installs `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, which puts a sentence and its translation in
some fifty languages near each other, so a memory written in English is found from a question asked in Japanese.
Loaded, it takes about 530 MB of RAM: the engine lets it go once it has made its vectors again, and after ten minutes
in which nothing was embedded, and loads it again, in under a second, at the next search or write.

**Cosine similarity.** The cosine of the angle between two vectors: 1 for identical direction, 0 for unrelated. It is
how "similar meaning" is measured between an embedding of your query and the embedding of a stored memory.

**Vector index.** A structure for finding the stored vectors nearest to a query vector without comparing against every
one. The engine uses the `sqlite-vec` extension inside SQLite.

**Lexical search, FTS5, BM25.** Search by words rather than meaning. SQLite's FTS5 is a full-text index; BM25 is the
ranking function it uses: a document scores higher when it contains more of the query's words, especially rare ones,
and is not very long. The archive uses FTS5 over your inputs and final answers; the engine uses it as one half of its
hybrid recall.

**Hybrid recall.** Combining lexical and vector search, then ranking. The engine does this; Filament adds its own
ranking on top (chapter 8).

**Stop words.** Very common words (the, and, is, you, please) that carry no search value. Removed before a query is
built.

**Keyword extraction.** Reducing your message to the words worth searching for. Chapter 8.1 gives the exact algorithm.

**n-gram.** A run of *n* consecutive words. Filament judges whether a reply used an injected memory by checking whether
any run of five words from the memory appears in the reply (chapter 7.2).

**Score, floor, gate.** Every retrieved item gets a number between 0 and 1. A *floor* is a minimum score; a *gate* is
a rule that drops candidates before scoring (the engine's lexical gate, chapter 8.3).

**Deduplication.** Recognising two texts as the same thing: by hash (identical bytes), by normalised text (case and
whitespace folded), by word overlap (a fraction of shared words), or by the first 80 normalised characters.

### 1.3 The engine's own terms (Mnemosyne)

**Working memory.** The engine's table of recent memories. Everything Filament stores lands here first. The engine's
default expiry is switched off by Filament (a ten-year time-to-live), so nothing ages out on its own.

**Episodic memory.** Summaries the engine writes by itself (its `sleep` consolidation). Filament never asks for one and
never serves one: rows the engine wrote on its own are fenced off (chapter 9.4).

**Canonical facts.** The engine's own fixed slots keyed by owner, category and name. Filament neither reads nor writes
them: what holds of you in every project is a memory of yours of no project (chapter 5.7, step 3; chapter 9.3, step 12).

**Triples, knowledge graph.** Subject-predicate-object facts the engine can extract. Filament reads their count for the
console and does not write them directly.

**Importance, veracity, scope, source, pin.** Fields on every engine memory. *Importance* (0 to 1) weighs ranking.
*Veracity* is `stated` (the user said it) or `inferred` (a model guessed it). *Scope* is `global` for everything
Filament stores (visible across sessions). *Source* is `filament-<kind>` (`filament-rule`, `filament-fact` and so on).
*Pin* protects a memory from hygiene and decay.

**Bank.** A separate engine database. Default `default`; [`memory.engine.bank`].

### 1.4 Filament's own terms

**Archive.** Filament's own SQLite database of every conversation, byte for byte, encrypted. Chapter 14.

**Engine.** Mnemosyne, run by Filament as a child process and spoken to over pipes. Chapter 2.

**Brain, autopilot.** The code that runs on every request and decides what to add to it, without any command from
you. It files nothing from your words: what you say reaches memory as the agent keeps it, as you keep it, or as the
learner reads it (chapter 5.10).

**Learner.** The code that calls memory's model at session boundaries. Chapter 9.

**Session, chain.** One conversation as memory sees it, across all its requests and legs. The code calls it a *chain*;
the console says *session*. Chapter 3.

**Turn.** One user message plus everything it caused, up to the final answer.

**Briefing.** The block memory places once per session at the end of the system prompt.

**Turn block.** The block memory appends to your newest message.

**Learned item.** A typed piece of knowledge (decision, rule, convention, preference, fact, thread, procedure) Filament keeps in
its own table and mirrors to the engine: the record of truth, which the engine copy follows. It carries where it came
from (its *origin*: you, your correction, your words an agent quoted, a model's tool call, a sub-agent, the learner,
an import, the owner in the console) and its status: `inferred` until you confirm it, `confirmed`, or retired — `dismissed` (never
true) or `superseded` (replaced by a correction, which it names). A retired item is kept with who retired it, why and
when, and its engine copy is invalidated, never deleted; every change of status is in its history (`@mem history
<id>`). Every write says who asks: you (`@mem`), the owner (the console), a model's tool call, an agent, or the
learner, and your word and the owner's stand while a model's or an agent's is a note.

**Slot.** The one thing a learned item gives a value of, when it gives one: "subject · attribute" within its project,
such as `project · package manager`, holding `bun`. A new value in a slot replaces the old one (the newer word wins,
by when it was said); the same value said again in another session is *evidence* for the item already there, recorded
in its history, not a second item. A value you said, corrected or confirmed is never replaced by a learned one:
- **Said before yours,** the learned value is retired.
- **Said after yours,** it is *held for your answer*: filed, held off (`dismissed`), and memory asks you whether it
  replaces yours (chapter 9.3, *memory's questions*). Meanwhile your word stands, its line says *said otherwise later:
  <value>* and the block's legend tells the model to ask you which is true where it matters. Accept, and your claim
  is corrected to the later words, with its history; reject, and yours stays as it was. The same value said again is
  not asked again; another value is.

Items a `remember` files have no slot.

**Value.** A typed value a claim's words hold, read when the claim is used and never stored. The kinds of value are:
- the package manager a project uses;
- the folder it is checked out in;
- that there are no file tools;
- the machine's platform;
- a cloud region;
- a port.

Only the value's own wording counts: "uses pnpm" holds one, "run npm test" does not. The words must name exactly one
current value: "bun instead of pnpm" holds bun. A value said of another subject ("the docs site uses yarn") is not this
project's. A stored slot is read first.

**Anchor.** A file or folder a claim names under its project's folder, recorded when the claim is filed: its hash,
size and mtime, the git commit, and the symbols the claim names that the file held. A claim filed before anchors
existed is anchored the first time it is looked at, as of when it was said. When a file changed since, the claim's line
says *file changed since*. When the file is gone, or a symbol it named is gone from it, the claim is held back.

**Held back.** Not served by the autopilot while something now says otherwise:
- a file the claim names is gone;
- a symbol it names is gone from its file;
- the request's own environment contradicts one of its values: its folder, its lockfile, the tools offered, the
  platform.

Held back is no status: the claim stands, and it comes back when the contradiction goes. Search still shows it,
labelled. The environment speaks only for its own project: another project's claim is held back where it would
mislead, but only this project's claims and global ones get a `contested` event in their history.

**Confidence.** How sure memory is of a claim, from 0 to 1. It is computed on each request from the claim's record and
never stored. It starts from where the claim came from:

| Source | Confidence |
|---|---|
| your correction | 1.0 |
| your word, or the owner's | 0.95 |
| confirmed | 0.9 |
| your words, quoted | 0.8 |
| learned, or the agent's own note | 0.6 |
| a sub-agent's or an outside agent's finding | 0.55 |
| imported | 0.4 |

The agent's own note stands with a learned memory: of the memories shown on a live archive, as many of each were used
(14.5% and 14.4%), and a third as many findings (the memory plan's d5).

Then it is adjusted:
- +0.05 for each other session that said it, up to +0.15;
- +0.05 when the turn it was learned from bears it out (the curator's check, chapter 9.3 step 8);
- −0.25 for each suspicion on it — a session the learner found showed it wrong (chapter 5.10) — until the curator
  judges it to be about something else (chapter 9.3, step 7). Never for your word, your correction, your words quoted
  or a confirmed claim: those change only by asking;
- −0.2 when a file it names changed;
- by age and kind: an open thread loses 0.1 a week after its first week; a fact or decision loses 0.05 a quarter after
  half a year, at most 0.2 in all; rules, preferences and conventions don't age.

Confidence weighs a claim's rank. Below 0.35 the autopilot leaves the claim out; search still finds it.

**Your rules.** Your rules, preferences and conventions open every briefing (chapter 5.7). These are the ones you or the
owner said, corrected or confirmed. They are not ranked against facts and do not fade.

**Trigger.** The tool call a claim is about, kept with the claim: the call's tool (every shell is `bash`), its *shape*
(the command and its subcommand: `npm run`, `git push`, `pytest`), its *words* (what makes a call of that shape the
mistaken one: `--force` for `git push --force`, `migrate` for `npm run migrate`; none means every call of the shape)
and its *right way* when one is known (`env -u CLAUDECODE`, `CI=1`). A call that holds the right way is not the
mistake. Chapter 5.13.

**Pitfall.** A claim with a trigger: "don't run `npm test` bare here, run it with `env -u CLAUDECODE`". It stays a rule
or a fact, and it is also said on the very tool call that would repeat the mistake, on that call's result, before the
model's next step. A pitfall comes from your words (read when the claim is filed) or from the miner. It is said only
once it is sure: your word at once; a learned one once another session has seen the same thing.

**Open thread.** Unfinished work a session left (`thread`): "the retry logic in `src/net/client.js` still drops the
last attempt". A thread that names a file comes back when a later session touches that file, once a session, and no
more once a session finished it (chapter 9.2).

**Procedure.** How a multi-step thing is done in a project, kept as one claim: "How to release: 1. `npm run build`
2. `npm run docs` 3. tag it". It is known by its *goal* ("release"): it comes with a task that names the goal, never for
a word one of its steps shares, and it is listed by its goal in the briefing's "How to" section. One way to a goal
stands at a time: a newer one replaces it.

**Observation bus, miner.** The bus is where memory is told what tool calls did as they finish: from the harness's own
agent loop, and from a proxied client's tool-result messages. The *pitfall miner* reads it: a shell command that failed
and then worked set up another way, in the same turn, is a pitfall seen (chapter 5.13).

**Memory id.** The id a memory line shows and the tools take: `i<n>` for a learned item, `s:<chain>:<n>` for the words
of a past session's turn, and `s:<chain>` for a past session as the dossier cites it. A tool that changes a memory
refuses a past session's words, saying so: they are a record, not a claim. Every memory line is an item: an engine memory with no item behind it (an import) is adopted
as an *imported* item when it is first seen. An engine row's id — `e:<id>`, or bare as the engine's own tools show
it — names the item that row mirrors.

**Erratum.** One line telling a session that a memory it was shown earlier no longer holds, and what replaced it. A
*memory check* is the same kind of line for a file that memory was about: the file changed, lost a symbol, or is gone
(chapter 5.8).

**Trace.** The timed, content-free record of every step memory took for one request. Chapter 18.

---

## 2. The big picture

```
 client (Claude Code, Cursor, curl …)
    │  HTTP request: model name, system prompt, messages, tools
    ▼
 Filament ──► route ──► [ memory: situate → prepare ] ──► shape ──► upstream provider / agent
                              │                                          │
                              │ reads and writes                          │ reply (JSON or stream)
                              ▼                                          ▼
                    ┌─────────────────┐                     [ memory: tool loop, cue ]
                    │ ARCHIVE          │                                  │
                    │ archive.db       │◄── every turn, byte-exact        ▼
                    │ (Filament SQLite) │                     [ memory: after the reply ]
                    └─────────────────┘                                  │
                    ┌─────────────────┐                                  ▼  later
                    │ ENGINE           │◄── remember / recall   [ learner: memory's model ]
                    │ Mnemosyne child  │                        [ engine: fenced at start ]
                    │ process, Python  │                        [ backups ]
                    └─────────────────┘
```

Three stores hold different things:

| Store | Holds | Technology | Where |
|---|---|---|---|
| **Archive** | What happened: every message of every session, compaction summaries, links between sessions, learned items, the injection log, a search index of your inputs | `node:sqlite`, WAL mode, AES-256-GCM bodies, FTS5 | `<memory folder>/archive.db` |
| **Engine** | What was learned, recallable by meaning: memories with embeddings, canonical facts, episodic summaries, the knowledge graph | Mnemosyne 3.15.1 in a private Python 3.12, SQLite with `sqlite-vec` and FTS5, `fastembed` | `<memory folder>/mnemosyne/` |
| **Brain** | Nothing durable: the decisions on each request | JavaScript inside Filament | `src/memory-brain.js` |

Two processes: Filament (Node) and the engine sidecar (Python), which Filament starts on demand and supervises. They
talk over the sidecar's stdin and stdout with one JSON object per line: `{"id": 7, "op": "recall", "args": {...}}`
in, `{"id": 7, "ok": true, "result": [...]}` out. The sidecar processes requests one at a time on one SQLite
connection; long operations (export, import, backup, reindex, diagnose, hygiene clean) run on a worker thread
so a quick recall is never stuck behind them. No call has a clock: a call ends with the engine's answer, its error or its exit, however long the engine works on it. A turn waits on memory for a minute in all (briefing, related memory): its live view says so ("recalling memory"), "Send without it" sends it on at once, and past the minute it goes on by itself, its record saying memory took longer than 60 s; what memory was doing finishes unwaited. A model's memory tool call is waited on as long, its result saying so past it. The sidecar answers a `ping` on its own stdin thread whatever it is doing; Filament pings an engine silent for 5 s with calls in flight, and one that answers nothing for a minute has stalled: logged once, recorded, restarted as **Restart** does, each call in flight ending in words, and Memory → Engine and Settings' engine row say when and with which calls. A crash restarts the
sidecar with a back-off of 1, 5 and 30 seconds; three failures in a row mark the engine *degraded*, and the brain
runs on the archive alone until the next successful start. An engine that hangs on a call while it still answers pings crashes nothing, and no clock ends that call: **Restart**, on Memory → Settings' engine row and on the Live tab's engine panel
(`POST /api/memory/engine/restart`), ends its process and starts it again at once, with no failure counted. An engine that stalls again within ten minutes of a stall-restart is stopped instead and counted as a failure, with the back-off; one that stalls each time it starts is degraded by its fourth stall and left stopped, every call saying why, until **Restart**. Each call
in flight ends saying the engine was restarted, and a turn that waited on its recall goes on without it. Every
failure path returns the request to the normal flow with a note on its record. A turn of a chat Filament composes
whose memory fails before the turn opens — its situate, or its prepare — is kept all the same where the archive can
write it, and memory does nothing else for it (`memory: skipped (…) — the chat keeps the turn, and memory adds nothing
to it`); where the archive itself cannot write it, the turn is not kept, and its record says so. Any request memory
could not read that way — a client's over `/v1` as much as a chat's — still carries memory's tools where its chat's
requests carry them (memory, its autopilot and its tools on, no Memory setting leaving it out, a model that takes
tools, no housekeeping), in the same place — before `filament_recall`, which a chat of Filament's keeps on such a
request too — so the tools section the provider caches stays as it was: with none, it would shrink for that request
and grow back with the next, and the whole conversation would be written to the cache twice for one miss. Where that
cannot be told, none ride: a request whose chat is not known while some chat or project chose
`memory.tools` (it may be that chat), or whose leaving-out by Memory settings could not be read either. A call of
theirs on that request is answered that memory is unavailable, never run; why memory missed it stays on its record,
which says the tools stayed offered.

The memory folder defaults to `<data folder>/memory`, that is `%APPDATA%\Filament\memory` on Windows
(`%APPDATA%\Filament-dev\memory` for Filament run from a git checkout) [`memory.folder`]. It holds `archive.db`, `mnemosyne/` (with `mnemosyne.db` and a `config.yaml` Filament rewrites
before every engine start, without secrets) and `memory.json` (a manifest: created date, device id, whether the
archive is encrypted, last backup). The engine's software lives apart in `<data folder>/memory-engine` (uv, Python,
the virtual environment, the embedding model cache); it is machine-local, never backed up, and safe to delete and
reinstall.

The engine comes with Filament: each release carries its own, in the bundle the installer puts beside the app
(`vendor/memory-engine/<platform>-<arch>/`, or under the folder `FILAMENT_MEMORY_BUNDLE` names), and Filament installs
it from there alone. Nothing is ever downloaded, and no engine is ever updated: a new Mnemosyne comes with a new
Filament, tested with it. The install takes the bundle's uv, the python-build-standalone archive uv installs Python
from (read as uv's download mirror), the wheels pinned by their sha256 and the model's cache, all offline
(`UV_OFFLINE`, `--offline --no-index --require-hashes`, `HF_HUB_OFFLINE`). Every file is checked against the bundle's
`manifest.json` first; a damaged one stops the install, named. With no bundle that serves this release's engine
(a git checkout that has not built one), Install is refused before anything is touched, saying why, and an engine
installed already keeps running. `engine.json` records where the engine came from (`source`), which bundle
(`bundle.id`, the manifest's sha256) and the embedding model it warmed (`embeddingModel`, the manifest's `model`),
which the engine is started on (`MNEMOSYNE_EMBEDDING_MODEL`). When the engine starts on a model the archive has no
record of having made its vectors with (schema_meta `engineVectors`: the model, when, how many rows), Filament has
the engine make every stored memory's vector again once (`reindex`), in the background; recall reads the archive alone
until it is done, since vectors of two models cannot be compared.

Filament installs the engine by itself when memory is on [`memory.engine.autoInstall`]: as the CLI (or the desktop
app, or the tray, which run it) starts, and when memory is switched on later — where the engine is missing, and where
the one installed is another than this Filament's (an earlier release's, or one an older Filament downloaded): the
new release's replaces it. Before a replacement that changes the Mnemosyne version, memory is backed up (to
`memory.backups.folder`, or `<data folder>/memory-backups` when none is set); a backup that fails leaves the engine as
it was, running. The old engine is stopped and its process has ended before its files are replaced; memory runs on the
archive alone meanwhile. Only the process that owns the port installs, once a run: one that fails is not tried again
until the next start, and an Uninstall holds for the rest of the run. One engine job runs at a time, and a half-built
engine is never started. `GET /api/memory/engine` and the events feed's `engine` messages say where the engine stands
(`installing` with the percent, `ready`, `missing` with the last error, `off`); `GET /api/memory/status` says whether
the bundle is here (`engine.bundle.ready`, and `why` not) and whether the engine installed is its own
(`engine.bundle.current`). An install nobody pressed for that fails raises an alert.

`npm run engine:bundle` (`node scripts/build-memory-bundle.mjs [--version 3.15.1] [--out <folder>] [--keep]`) builds
the bundle for the machine it runs on: the one way an engine is ever downloaded. It downloads about 500 MB: it installs
the engine by download into a temporary folder, takes the Python archive uv names, makes the wheels of exactly what
that install holds (`pip wheel` in a seeded venv), pins them in `requirements.txt`, copies the model's cache with its
links resolved, and writes the manifest. It then installs from the new bundle into another temporary folder, offline;
only a bundle that installs replaces the one in place. On a Mac it first signs the bundle's programs with the
Developer ID Application certificate the keychain holds, before the wheels are pinned and the manifest hashes them
(the manifest says `signed`, and `signedInside`): uv, and the programs inside its archives, because Apple's notary
opens every archive an app carries. Each wheel's libraries are signed in it, with their lines in its `RECORD`
written again, and the Python archive's interpreter and libraries are signed and the archive packed again. Then
uv's own sha256 of the release no longer fits it, so the bundle lists it for uv with its own sha256
(`python/downloads.json`, which the install hands uv as `UV_PYTHON_DOWNLOADS_JSON_URL`; every bundle carries one): a
notarized app carries no unsigned program. The bundle is never committed and is not in the npm package;
`npm run dist:win` (and `dist:mac`, `dist:linux`, each on its own system) refuses to build an installer without one
that serves this release's engine, and the installer carries it.

---

## 3. What a conversation is to memory

Memory organises everything as **projects → sessions → turns → messages**.

**Project.** The folder you are working in. The brain finds it, in order, from the `x-filament-cwd` header if a client
sends one, from a line in the system prompt matching `Working directory:` (also `Current working directory:`,
`cwd:`, `Project root:`, `Repository root:`, and the `<env>` block Claude Code writes), or from the working directory
a coding agent reports. The project id is the first 12 hex characters of the SHA-256 of the lower-cased,
forward-slashed path; the project name is the last path segment. With no folder anywhere, the project is `none`.

**Session (chain).** One conversation across all its requests. Its identity is a **chain key**:

- If a request of Filament's own names an existing chain by its id in `x-filament-chain` (a house-only header: a
  client's is dropped, said on the record), the request continues that chain: the key
  is the chain's stored key, whatever produced it. This is how the harness opens an archived session as the same
  session (its own, or one an import brought in). An id the archive does not know is ignored, not an error.
- Else, if the client sends a conversation id header (`x-filament-conversation`, `x-session-id`, `x-opencode-session`,
  `x-conversation-id` or `x-thread-id`), the key is `h:` plus a hash of that id.
- Otherwise the key is a **fingerprint**: `f:` plus a hash of the project folder and the first 2,000 characters of the
  first user message in the request. Claude Code sends no id, so this is how its sessions are followed: every request
  of one Claude Code session resends the same first message from the same folder, so it hashes to the same key.

Every chain has a **kind**: `interactive` (somebody's conversation), `fork`, `tick` (a conversation one of a loop's
own rounds opened), `subagent` (an imported sub-agent transcript) or `mcp` (an outside agent's session on
`/mcp/memory`, chapter 10.1: no turns, only what it was shown). The harness lists `interactive` and `fork` unless
asked for more; searches span everything but `tick` and `mcp`. Recall quotes only `interactive` and `fork` chains, a
person's words: a tick's are Filament's, and an imported sub-agent's are its parent agent's.

The archive row for a chain carries the project, client, model, a title and end state (filled by the learner), the
number of finished turns, a parent chain, the exact briefing text placed in its system prompt, a map of
per-message blocks (chapter 5.9), and a metadata object (muted flag, which ids the briefing used, learning progress).
Chain ids are 8 base-36 characters: 4 derived from the time, so ids sort roughly by age, and 4 random.

**Turn.** One user message and everything it caused. When a request arrives, memory hashes the newest user message
that is *not* a tool result. If the chain's newest turn is still open (no final answer yet) and has the same hash, the
request is another leg of that turn; otherwise a new turn opens with number n+1. So a turn spans all the tool-loop
legs of one message and closes when a final text answer arrives.

**Message.** Stored once by content: the SHA-256 of the message JSON is the key, so a message the client resends on
every request is stored exactly once. Bodies are encrypted at rest (12-byte random IV, 16-byte authentication tag,
AES-256-GCM with Filament's `secret.key`). Bodies over 1 MB [`memory.capture.messageCapBytes`] are stored as a marker
with the first megabyte; the pictures and files a message carries in base64 are not counted, so a message large for what was
attached to it is kept whole and its chat's next turn sends it again. Each message also has a *kind* (`text`, `tool_use`, `tool_result`, `thinking`, `image`,
`other`) derived without decrypting, so counts and views can be computed cheaply.

**The client detected.** From the user-agent and headers: `claude-code` when the user-agent says claude-cli or
claude-code; the user-agent's first token when a session header is present; `opencode`, `codex`, `cursor` by
their signatures; otherwise the first token of the user-agent (`node`, `curl`).

---

## 4. Fresh session, resumed session, continued session, tool leg

The brain gives every request a **position**, and the position drives budgets and behaviour.

| Position | How it is recognised | What memory does differently |
|---|---|---|
| **first** | The request holds a single user message (the conversation just started) | Builds the briefing (chapter 5.7); normal turn budget where the briefing was built on this message (it recalls on the same words), ×1.5 where none was (the briefing off, let go, empty, or built before); linked to a session of the project its agent loads before this first turn is finished (the continuation link, chapter 5.6) |
| **mid** | Several user messages in the history | Reuses the stored briefing byte for byte; normal turn budget |
| **afterCompaction** | First message, and its text starts like a compaction summary (`This session is being continued from a previous conversation`, `Summary of the conversation so far`, `# Conversation summary`) | Treated as first, with the turn budget ×1.5 (the blocks the compaction took are out of view), plus: the new chain is linked to the most recent other chain of the same project with a `continues` edge, becomes its child, and the summary text is archived as a compaction on that previous chain, so the old session's record shows where it ended |
| **toolLeg** | The newest message is a tool result, not a person speaking | No briefing build, no turn block; earlier blocks are re-attached; memory at the moment of action: the pitfalls the calls walked into, the open threads on their files and the *rules that act* ride on the results, and the results are told to the observation bus (chapter 5.13) |
| **compaction request** | The message asks the model to write a summary of the conversation for continuation | Nothing is added; the reply is later archived as a compaction of this chain (chapter 7.1) |

**Fresh session.** New chain key → `chainForKey` inserts a chain (`isNew: true`), the first turn opens, a briefing is
built. The engine and the archive are searched with the words of your first message; your rules, the facts about you,
the project's dossier and its recent sessions are always considered. Nothing the message says links it to an earlier
chain; where the agent loads one of the project's sessions before the first turn is finished, the two are linked.

**Resumed session.** The client resends a history it already sent (you reopen a chat, or the client retries). Same key
→ same chain; the same first message → the same turn (still open) or a closed one. The stored briefing is re-applied
unchanged; each earlier user message gets the exact block it received before (looked up by message hash); the newest
message gets a fresh lookup only if it was never seen. Nothing is stored twice.

**Continued after compaction.** A new chain (the first message is now the summary), linked to the old one as above.
The old chain keeps its turns, and the summary is filed on it as its compaction; the new one starts at turn 1 with a
briefing that, because it runs deep recall on the summary's words, tends to surface the items the old session
established. The learner is not started by the link: it learns from the old chain's turns as from any session's, once
the old chain has been idle (chapter 9.1). Learning starts at once only where the client's compaction request itself
came through Filament, its reply archived as the compaction.

**`@mem new`.** Rekeys the current chain (its key becomes `<key>#closed-<time>`), so the next request with the same
history starts a fresh chain with a fresh briefing, linked to a session only where its agent loads one of the
project's in that first turn (the continuation link, below). A chat of the
harness's own names its session by id,
which no key moves: there it rekeys nothing and says the chat goes on as this session; New chat starts fresh.

**Tool legs.** The archive attaches the request id to the open turn; the trace shows `turn archived · new: no` and
`no turn block · a tool-loop leg`. Turn budget is zero on legs. What memory says on a leg is about the calls the model
just made, not the conversation (chapter 5.13).

**The session's ancestors (lineage).** A chain's parent (`parent_id`) and, failing that, its `continues` links (written
live by chapter 5.6 and in bulk by imports) form its **lineage**: the sequence of sessions this one continues. Walking
it is a depth-first chase of parent pointers with a visited set and a depth limit of 6 (trace `lineage walked`). Two
things read it: the briefing's arc line (chapter 5.7 step 6) and the `lineage` render view (chapter 8.7).

---

## 5. The memory loop, step by step: before the upstream is called

This chapter follows one request from arrival to the moment Filament forwards it. Every step here is on the critical
path: the client waits for it. In practice the whole chapter costs a few milliseconds when the engine is warm
(chapter 18 shows the measured numbers per request); the first request after an engine start pays the engine's start
time, about a second, once.

Each step names the **trace step** the console shows for it (chapter 18).

### 5.1 Arrival and routing

Filament parses the body, reads the model name, and finds the route. Only then does memory start; a request for a
model name with no route never reaches memory.

### 5.2 Situate (trace: `situate`, `situated`)

Reads who is talking and from where, without writing anything:

1. Refuses early when memory must stay out (trace `memory stays out` with the reason): Filament's own internal requests
   (user-agent starting `Filament-` or carrying `x-filament-memory-purpose` — both count only on a call that presents
   Filament's house key; a client's request that sends them is a client's, its user agent marked `unverified`), a client listed in
   [`memory.capture.excludeClients`], a model matching [`memory.capture.excludeModels`] (same `*` syntax as routes; an
   `agent/<model>` name is matched as `<model>` too), or a working folder under [`memory.capture.excludeFolders`].
   Exclusion follows the chat: a call Filament makes for a chat — a loop's round or fork, a sub-agent's or a team
   worker's on any model, a flow's step, a team's chat beside it — is left out where the chat is, by its client, the
   model its turns name or its folder; a sub-agent is handed no brief, and nothing is learned from its report, where its
   chat is left out or the model its calls go out on is excluded — a card's next model its run goes on to included: that
   model gets the first message without the brief written for the one before, after a restart too. A chat left out keeps Filament's own tools all the
   same, under its own session — the task graph, artifacts, pictures (kept on its turn), the browser, the Space, teams
   and flows, its MCP servers and added folders — for Filament's own agent and a coding agent alike, while memory's own
   tools stay off on every request it makes: no `filament_memory_*` on its turns and the loop's ticks, and none of
   memory's tools over Filament's MCP server to a coding agent's session, whose words as it connects name none (a call
   to one by name is refused). `filament_recall` rides its turns and ticks as any chat's: it reads only the chat's own
   record, so a result past the loop's cap and a folded turn come back through it, and a call of it made beside the
   loop's own tools is answered on the next tick, its answer riding on there as it went out. A chat Filament composes keeps its own turns all the same — its model's history
   is composed from them and its page shows them after a reload, its commands' answers among them — and memory does
   nothing else there: no briefing, recall, cue, capture or learning, no block placed again, and none of its turns is
   read for another chat or call (no search, session list, load, grep, briefing or continuation names it). Each turn
   kept so — and each kept while turn capture is off — is marked apart as it begins (`meta.apart`, why), and stays apart
   for good: once the chat is no longer left out (its model switched, its folder moved, the list edited), memory reads
   its later turns as any chat's and none of those: no search quotes them, no load or grep of it for another chat
   carries them, the learner moves past them unread, and a chat they named is named to others by no title or preview;
   a chat all of whose turns are apart is no other's at all. The chat itself and your own sidebar still read them. An
   outside client's chat left out is recorded not at all. The New Task board and Overview say memory leaves the chat out, and why. The header `x-filament-memory: off` is different: it does NOT
   skip — the request goes through prepare in **quiet mode** (trace `autopilot stops here`): earlier injections are
   re-attached and the briefing re-applied byte-identically (so the provider's prompt cache survives), while nothing
   new is injected, captured or learned. On a fresh chain, which has nothing to keep stable, a quiet request is
   fully bare — no briefing, no tools, no capture.
2. Extracts the system prompt text, the project (chapter 3), all user message texts (with earlier memory blocks
   stripped), the index of the newest user message that is a person speaking, and the chain key.
3. Sets the position: `toolLeg`, `first` or `mid` (afterCompaction is decided in 5.4 once signals are read).

If the request is a housekeeping request (chapter 1.1), detected by its system prompt (short, no assistant messages,
no tools, and phrases such as "not a conversation", "title generation task", "return exactly one valid JSON
object"), memory stops here with `memory stays out · a housekeeping request`.

### 5.3 Command check (trace: `memory command @mem <verb>`)

If the first line of the newest user message starts with the command prefix [`memory.commands.prefix`], Filament
answers the command itself (chapter 11) and never calls the upstream. The record shows `command: true`.

### 5.4 Session lookup and signals (trace: `session lookup`, `signals read`)

`chainForKey` creates or refreshes the project and the chain (one write transaction). The trace shows the chain id,
whether it is new, how many turns it has, whether it is muted, and whether a briefing is stored.

**Signals** are read from the newest message with plain pattern matching, no model. None files a claim (chapter
5.10). Each is a boolean:

| Signal | Recognised by | Effect |
|---|---|---|
| `afterCompaction` | The message starts like a client's compaction summary (that client's fixed machine text) | Position becomes afterCompaction; on a new chain's first turn, link to the project's previous chain |
| `compactionRequest` | *create/write/produce a summary of the conversation, summarise the conversation so far, conversation summary for continuation, your task is to create a summary* | Nothing added; the reply becomes a compaction |

How much memory looks up for a message is never read from its words: a turn's room comes from where the message
stands (5.8), a message with no keyword to search by ("ok", "thanks") gets no lookup, and the briefing treats such a
first message as holding no task (5.7). The signals step also records the number of keywords and code tokens
extracted (chapter 8.1) and the search query built from them, with anything key-shaped removed.

### 5.5 Turn archived (trace: `turn archived`)

Unless [`memory.capture.turns`] is off, `beginTurn` stores the newest user message (once, by hash, encrypted), opens
turn n+1 or joins the open turn (chapter 3), and puts the first 4,000 characters [`memory.capture.inputCapChars`]
of the message text into the search index. The trace notes `new: yes` with "the user's message is stored byte-exact"
or `new: no` for a leg. A chat Filament composes keeps its turns with turn capture off too — its history is composed
from them, and its page shows them — and each is kept apart for good (`meta.apart`): memory captures nothing from it
(no claim, no correction marked, no call of memory's model), and its search, loads and learning read none of them
for any other chat, even once capture is on again.

### 5.6 Earlier blocks re-attached (trace: `earlier blocks re-attached`)

The chain stores its blocks in a dedicated `blocks` table, one row per **message hash** — deliberately uncapped,
because trimming a stored block would change bytes the provider has already seen and kill its prompt cache from
that point on. For every user message in the request whose hash has a row, the stored block is appended again,
byte for byte. Each row also records `nth`, the occurrence of that text among user messages when the block was
created, so a *later duplicate* of the same text does not pull the block onto an *earlier identical* message that
originally went out clean — that, too, would change already-sent history. This is what keeps
history identical across requests so provider prompt caches survive (chapter 5.9). Then:

- **Muted chain, autopilot off, or a coding agent** (trace `autopilot stops here` with the reason): the stored briefing
  is re-applied when there is one and the request goes on. Coding agents (chapter 10) get their turns archived and
  nothing injected.
- **Deferred tool results** (trace `deferred tool results attached`): if the model's previous reply in this chain
  mixed memory tools with the client's own tools, Filament ran the memory calls then and kept the results; they are
  now appended to the newest message as a block of kind `tool` (chapter 6.3).
- **Memory at the moment of action** (trace `memory at the moment of action`): on a tool leg, what memory knows of the
  calls the previous assistant message made rides on their results: the pitfalls they walked into, the open threads
  on the files they touched, then the *rules that act*. Chapter 5.13.
- **Pending load** (trace `past session loaded`): a session you asked for with `@mem load` or the header
  `x-filament-memory-load: <id>[:<view>]` — believed from a caller that could read every session anyway, over loopback or with the admin token; from another it is set aside, and the record says so — is rendered (chapter 8.7) within 6,000 tokens and appended to the newest
  message as a block of kind `load`, after the message's own block (its recall runs as on any message) and kept beside
  it: every resend puts the two back in that order, on that message alone — a later message of the same words carries
  no load. A `loaded` link is recorded between the two chains. The chat's own session, loaded or in a loaded lineage,
  stops before this message's turn, and no link of it to itself is written. A request memory says nothing new into —
  the chat's memory off, autopilot off, a quiet one (`x-filament-memory: off`, a loop's tick, a sub-agent's), a coding
  agent's tool legs and the turns it starts itself — leaves the load waiting for the next; one with nothing to paste is
  used up, and the notes say so.
- **Continuation link** (trace `linked to the previous session`): on a new chain's first turn after a client's
  compaction (afterCompaction), the most recent other chain of the project becomes this chain's parent with a
  `continues` link. Nothing the person types links a chain ("continue …" is their word to the agent): where the
  chat's own agent loads a session of the project (`filament_memory_load`, or the same over MCP) before its first turn
  is finished, that session becomes its parent the same way (brain.js `linkLoaded`), once, and only where it has none;
  a sub-agent's load links nothing.

### 5.7 The briefing (trace: `briefing built` / `briefing reused` / `briefing empty` / `briefing placed`)

The briefing is built **once per session**, on its first turn (retried on turns 2 and 3 if it came out empty, never
after), then stored on the chain and re-applied unchanged. Budget [`memory.autopilot.briefingTokens`] (4,500 tokens,
counted as 18,000 characters): the whole briefing, its header, its line on the tools and the legends under its lines
counted too (the memory plan's d2; they rode outside it before, some 700 tokens over what the setting said). Your rules
and the facts about you come first, in their own shares of the budget. Each block after them has **its own share of the
room they leave** and the header's, so no block crowds out another:

| Block | With a task in the first message | With none ("hello", "thanks", yes/no) |
|---|---|---|
| Where the repository stands | 8% | 8% |
| The arc and the recent sessions | 14% | 14% |
| The project's procedures, whole | — | 20% |
| The project's dossier | 42% | 58% |
| Deep recall | what the others leave | — |

**What can be read is small** (the memory plan's e1): where the repository stands is this folder, its newest commit and
the other worktrees in one line — your client lists its recent commits itself (Filament's Environment, Claude Code's git
status) — and a recent session's row says what it ended with and how much it left open, not the items, which the
project's open threads hold. The room is the dossier's and recall's: what only memory holds. A briefing of a project
with ten worktrees, 24 commits and five recent sessions went from some 2,900 tokens to 1,760, its dossier whole.

A first message with no task — no keyword in it to search by (chapter 5.4) — gets no deep recall: it would rank the
project's memories against a greeting. Its share goes to the dossier and to the project's procedures, shown whole. A
short task ("fix lint") has its words, and is recalled for. The blocks are assembled in this order:

1. **Header**: a fixed paragraph telling the model this is long-term memory from past sessions — leads, not the source
   of truth: much may have changed since a line was written that memory does not know, so before it acts on a line (a
   file, a function, a setting, a command, the state of the work, what is done or open) it checks it against the code,
   git and the running system now, and never builds on it unchecked (the owner's of 10-30); that the user's own rules
   and preferences are their instructions, not claims, and are followed; that each line starts with its id, its kind
   and how it is known; not to recite it unprompted, and to reference it as "from memory"; that when what it finds
   contradicts a memory, it trusts what it finds and fixes the memory
   by its id with `filament_memory_correct` (never by storing a separate "Correction" note, which would leave the old
   line standing beside it) and marks one that proved right with `filament_memory_confirm`; that words from past
   sessions are quotes, not checked facts; and, where the tools are offered, what memory is for (the memory plan's d2):
   "Later sessions with this user start from what memory holds: keep there what they could not re-read from the code
   or git — the user's rules, corrections and decisions with their reason, and the pitfalls you hit." What it is for,
   never how: a rule of how to keep memory cut a model's gain from it. The remember tool's words carry the same
   sentence.
2. **Your rules** (trace `the user's rules`): under "The user's rules and preferences (their own word):".
   - **What is in it:** every rule, preference and convention of this project, and every global one, that you or the
     owner said, corrected or confirmed. Oldest first, each with its line as below.
   - **Its budget:** a quarter of the briefing's. The first rule always shows, however long its line.
   - **What does not fit** is counted, never dropped in silence: "…and N more; filament_memory_search finds them."
   - **What stays out:** a rule held back by its files or the environment. A learned rule, a model's note, and your
     words read as a preference but never confirmed stay in recall, where confidence ranks them.
   - **No repeats:** recall never repeats a rule this section shows.
3. **What holds in every project** (trace `in every project`): your word of no project, the facts and decisions you
   said, corrected or confirmed, one a line with its id like any memory: six at most, in a tenth of the budget, one in
   a slot about you first (e1, f5).
   - **Where they come from:** a fact a project learned about you that you chose to keep everywhere (chapter 9.3,
     step 12), one set on the console's Memory page (*Identity facts*), or one you said outside any project (the
     Library's *Remember something*, everywhere).
   - **Not here:** your rules, preferences and conventions of no project, which are among your rules (step 2); the
     engine's canonical facts, which Filament no longer reads.
4. **Project**: `Project: <name> (<path>).`
5. **The project's dossier** (trace `the project's dossier`; chapter 9.3): the project's short living document, in its
   share. A session that named no folder gets none.
   - **The curator's version**, when one is written. Its sections: what it is; conventions and rules; how to; pitfalls;
     key decisions; facts; current work and open threads. Each line ends with the memories it rests on:
     `- text [i12, i40]`.
   - **How to** lists the project's procedures by their goal only ("How to release"). Their steps come with a message
     that names the goal (chapter 5.8), or from `filament_memory_search`. One line under the block says so.
   - **Pitfalls** holds the claims with a trigger, whatever their kind: what goes wrong here, and the way that works.
   - **Only standing lines show.** A line shows only while every claim it cites stands and is not held back, so a fact
     you retire leaves every briefing at once, whatever version was written. A line whose claims all went unused
     (chapter 9.3, step 10) is not shown either, and is counted in the line below. A cited file that changed since is noted
     in the brackets: `[i12 · file changed since]`.
   - **New since vN:** claims that earned a place after the version was written follow under that heading.
   - **Without a version** (no model, the curator off, or no pass yet): the project's standing memories that earned a
     place, under the same sections, by kind, and a pitfall under Pitfalls. A memory earns a place when you said or
     confirmed it, when two sessions said it, or when it is an open thread. It must also be above the confidence gate
     and not held back. Your own rules never show here (step 2 shows them), and neither does a fragment of code; a
     procedure's steps and a pitfall's commands are not taken for one. Six lines a section, the surest, most
     important and most used first; a memory left for going unused (chapter 9.3, step 10) is not shown, and is
     counted in the line below.
   - **What does not fit** is counted: "…and N more lines; filament_memory_search finds them."
   - **Pinned:** the version is recorded on the chain (`meta.dossier`) with the briefing. The claims the lines cite are
     recorded as shown, so errata follow them.
6. **The project's procedures, whole** (trace `the project's procedures, whole`), only when the first message holds no
   task: under "How things are done in this project (its procedures, whole):", the project's standing procedures above
   the confidence gate and not held back, the surest and most important first, each as recall serves one. A dossier
   line that cites only a procedure shown here is left out, so it is not listed by its goal beside its steps. With a
   task, the dossier lists them by goal, and recall serves the steps of the one the task names (chapter 5.8).
7. **Where the repository stands** (trace `where the repository stands`): read by git as the briefing is built, never
   from memory, under "Where things stand (git, read as this session started; ask git for the state now):". The first
   line is this folder: its top folder, the repository's main folder when it is a worktree, its branch and commit, how
   it stands against the base branch (commits the base lacks; merged into it; nothing of its own yet; how many the base
   has more), the base's commit, and what is uncommitted. The second is the other worktrees, the main folder first, up
   to six, Filament's helper copies left out, in one line by how each stands — `- Other worktrees (git worktree list):
   on main: app; merged into main: app-perf (2 uncommitted); ahead of main: app-wip (3 commits); nothing of its own
   yet: …; not compared with main: …; its folder gone: …; not read: …; 2 more not read` — each by its folder's last
   part, with its commits the base lacks and its uncommitted files; with no base branch, by its branch. The third is
   the newest commit, a pointer to the rest: this branch's own where it has commits the base lacks (`- Newest commit
   here: <date> <commit> <subject> (N commits main lacks: git log main..HEAD)`), else the base's (`- Newest commit on
   main: … (git log main for the rest)`). A subject is cut at its first ": " when that comes after a few words, else
   clipped to 110 characters. A row that does not fit the share is passed over, the rest kept. Each other worktree has
   2 seconds; one git is slower on, one the folder fence refuses, or one git cannot read is *not read*. The read as a
   whole has 4 seconds: a slower one, a folder the fence refuses, a folder in no repository, or no git leaves the block
   out.
8. **The arc** (trace `lineage walked`): when this chain has ancestors (chapter 4's lineage), up to the four most
   recent are joined oldest first as one line: `This session continues an effort (N sessions so far): session <id>
   "<title>" — <state summary> → …`, so the model knows it is stepping into the middle of something and what happened
   before it. Chains already named in the arc are then excluded from the next step, so nothing is listed twice. Its
   line comes out of the recent sessions' share.
9. **Recent sessions of the project** (trace `recent sessions of the project`): up to 5 other chains of this project
   that are not in the arc, newest first, each as `session <id> "<title>" — <date> — in <folder> — <state summary> —
   N left open`. *In <folder>* shows when the session worked in another folder of the project than this one (a
   worktree). The summary, what it ended with, is cut to 160 characters; its open items are counted, not told — the
   project's open threads hold them, and `filament_memory_load` brings the session in when you ask. The rows after the
   first that does not fit the share are left out.
10. **Relevant memory**, with a task only: deep recall (trace `retrieve`, mode `briefing`) — the query is the keywords
    of your message (or of the first message), at most 16, falling back to the project name; chapter 8 explains the
    retrieval; limit 14 items — placed as `- [i12 rule · user corrected · 2026-09-30 · ✓3] text` lines, each clipped
    to 260 characters, until the budget is full.
   - **The label** holds the id, the kind, how it is known, the date, and its marks.
   - **How it is known** is written from the model's side:
     - *user said*: you stated it or added it;
     - *user corrected*;
     - *user confirmed*;
     - *user's words*: your sentence, quoted by the agent that remembered it (`remember` with `quote`, chapter 12);
       your word all the same: a rule or preference of it stands in every briefing;
     - *inferred*: learned from past sessions, unchecked;
     - *assistant noted*: stored by a model's tool call;
     - *a sub-agent found*: what a sub-agent of a session established, read from its report or stored by its own
       tool call, unchecked (chapter 9.2, *What a sub-agent found*); a line under the block says so;
     - *an agent found*: stored or corrected by an agent outside Filament over `/mcp/memory`, named for its client
       (chapter 10.1);
     - *imported*.
   - **The marks:**
     - `✓n` says n separate sessions said the claim.
     - *file changed since* says a file it names changed after it was recorded.
     - *in question: the user is asked if iN replaces it* says memory has asked you whether to retire it (chapter
       9.3). Until you answer, it stays served, marked.

     Under the block, one line explains each mark the block uses; a line that brings a legend is placed only where the
     legend fits too.
   - **Quotes:** words of past sessions go under their own heading, "Words from past sessions (quotes, not checked
     facts):", as `- [s:<chain>:<n> · date] text`, so the model never reads an old sentence as a standing fact.
12. **Memory tools**: one sentence naming the tools (`filament_memory_*`: search and sessions find, load brings a
    session in, remember and correct keep, close, confirm and forget settle a line by its id) and when to use them, and
    that a recent session is named for reference, loaded only when you ask for it or tag it; their own definitions say
    the rest (only when tools are on and the engine is ready).

If no item and no tools came out, there is no briefing. Otherwise the text is wrapped in
`<filament-memory kind="briefing"> … </filament-memory>` and placed at the **end of the system prompt** (Anthropic:
appended to `system`, as a new text block when `system` is an array; OpenAI: appended to the system or developer
message, or a system message is inserted first; Responses: appended to `instructions`). The ids used are recorded on
the chain so the turn block never repeats them, an **injection** row (kind `briefing`, ids, tokens) is written to the
archive, and a **cue** may be prepared (chapter 6.4).

That is the briefing of a session's first request. One built on a later turn — the first found no material, or the
person let it go — would rewrite a system prompt the provider has cached, so it rides the message it was built on
instead: kept beside that message's own block (after it, before the results of memory calls and a load), sent there
again with the history, and said on the person's next message where the history no longer sends that one (rewound).
The system prompt takes it at the chat's next compaction (`briefingSeated`, `meta.briefingSeat`, kept for each window
of the chain, one answer per compaction of that window) — never while the history a request sends still carries it on
a message (a compaction undone, a fork, a compaction that kept that message), and a rotated session id whose borrowed
blocks carry a sibling's builds none beside it. A loop's tick places nothing new; a sub-agent's run, a conversation of
its own, carries the briefing in its system prompt as its first request found it. The session's goal goes the same
way: a goal accepted, rewritten or closed is said on the person's next message, and the system prompt carries the goal
as it stood at the newest compaction of the request's window (`applyGoal`, `meta.goalPinned`).

### 5.8 The turn block (trace: `turn budget`, `related memory looked up`, `turn block attached` / `nothing attached`)

For every message that is a person speaking and holds a word to search by:

1. The message hash is looked up in the chain's block map. If present, the stored block is re-attached (`turn block
   re-attached`), or nothing is added if the earlier lookup found nothing (`turn block skipped`). No new lookup.
2. Otherwise the **turn budget** is computed [`memory.autopilot.turnTokens`], 300 by default: ×1.5 after a compaction,
   0 on tool legs; nothing the message says changes it. A session's first message has the turn block's own room where
   the briefing was built on it, recalling on the same words, and ×1.5 where none was (the session turns the briefing
   off, the person or the turn's clock let it go, nothing was known to build one from, or one was built before). In `conservative` mode at most 3 items are
   considered (8 in `eager`).
3. Retrieval runs with mode `turn` (chapter 8), excluding what the session has **in view** already: the ids its
   briefing showed, and every memory an earlier block shows on a message the request still sends (re-attached,
   chapter 5.6) — a line of a turn block, a claim or past words, by the id at its head; a reminder on a tool call
   (chapter 5.13); the results of a memory call placed on a message, this request's own on the newest message too. A line is said once while it is in view: a claim
   the person keeps asking about is not repeated turn after turn. An id a line only names is not in view — an
   erratum's replacement, in 200 characters, or a claim citing another — so its whole may still come, a procedure's
   steps with it. A compaction that took a message takes its block out of view, and what it showed may be said again.
   The memory calls of a turn put back whole (chapter 6) are not read for it.
4. Items become lines as in the briefing (id, kind, how it is known, date, marks), clipped to 300 characters, under
   the heading "Related memory for this message (Filament; claims from past sessions, not the source of truth — check
   each against the code and the system now before acting on it)" (`RELATED_HEAD`); words of past sessions go under "Words
   from past sessions (quotes, not checked facts):", at most two of them, after the claims. One line explains each mark
   the block uses.
   - **The room:** lines are added while they fit the budget (4 characters per token); one that does not fit is passed
     over for the next that does. The first line always shows, however long.
   - **Procedures first.** A procedure is here only because the message names its goal: at least half of the goal's
     identifying words ("release" for "How to release a new version"), lightly stemmed, so "releases" counts. A word
     one of its steps shares ("npm" in "fix the npm warning") never brings it. It comes first, whole: a procedure is
     never cut short of its steps, since half of one would be followed as if it were all of it.
   - **A past turn that said a procedure is not quoted.** Its words come as the procedure, for a task that names its
     goal.
5. **Errata** (trace `errata attached`): one line per memory leads the block, in two cases:
   - **Retired:** a memory this session was shown in the last 14 days has been retired since, by a correction in
     another session, the model's `correct` or `forget`, or you in the console. The line reads: `Memory correction:
     [i12] "the staging server is in eu-west-2" no longer holds — now [i40] "… eu-central-1 …" (the user,
     2026-10-02).` Who retired it is the user (you, or the person in a chat), Filament (the learner or the curator),
     an agent that is a finder by its name and what it is (`Cursor, an agent over MCP`, a sub-agent), else an
     assistant.
   - **A memory check:** a file such a memory names moved. The line reads: `Memory check: [i7] "src/config.js exports
     loadConfig" — src/config.js changed since it was recorded; read the file before relying on it`. For a symbol or
     a file that is gone it ends "…; the memory is held back".

   The files of the memories this session was shown are checked on each of its requests, so a file edited mid-session
   is told on the next turn. Each line is said once (the queue on the chain is emptied), and at most 10 wait per
   session. The session that did the retiring is not told: it was there. With the turn block off they wait. Being part
   of the stored block, they re-attach byte for byte like the rest.
6. The block is wrapped in `<filament-memory kind="turn">`, **appended to the newest user message** (string content
   gets it appended; array content gets a new text block), stored in the block map under the message hash, and an
   injection row (kind `turn`; `erratum` for a replacement an erratum named) is written.
7. When nothing qualifies, the trace says why: everything that matched was in view already (in the briefing, or an
   earlier block of this chat), the best score
   was under the floor, nothing survived ranking, or there were no query words.

### 5.9 Why placement matters: cache stability

Provider caches key on the exact prefix bytes. Memory therefore never edits anything that came before the newest
message except by re-applying the identical bytes: the briefing is one fixed string per session at the end of the
system prompt; each user message carries exactly the block it carried the first time, looked up by the hash of the
message *as the client sent it* (memory's own blocks are stripped before hashing, so the hash is stable even though
the message now contains a block). New material only ever lands on the newest message. Result: the cached prefix
grows by one message per turn, as it would without memory.

### 5.10 What files a claim

Nothing is filed from your message by its words (the memory plan's d3). Until then a list of English phrases read every
message — *no, …*, *I prefer*, *let's go with*, *remember that …*, *remember how to …* — and filed a rule, a
preference, a decision, a fact or a procedure from the sentence that matched, and a correction retired the claims it
shared most words with; one call of memory's model read a non-English message that opened like a correction. Lists of
words misread pasted text, missed most languages and every paraphrase, and gave your authority to whatever matched.
What you say reaches memory three ways now:

1. **The agent keeps it** with its memory tools as you say it: `filament_memory_remember` for a new claim,
   `filament_memory_correct` naming the claim it replaces by its id. Given `quote` — your words, copied exactly —
   Filament looks for them in what you typed in this chat (chapter 12), and a quote that is there and says the claim
   files it as yours: *user's words* for a remember, *user corrected* for a correct. Your words are your word: a rule or
   preference of them stands in every briefing (5.7), a learned value never replaces them (chapter 1.4, *Slot*), and a
   session found to show them wrong asks you.
2. **You keep it** with `@mem remember` (a fact), `@mem rule`, `@mem prefer` or `@mem procedure` (chapter 13), or on the
   Memories tab: *user said*, confirmed. The command names the kind, never your words.
3. **The learner** reads the session at a boundary (chapter 9) and files what it established: a rule, a preference or a
   decision only where your own words of its turn say it.

A client whose model never calls memory's tools reaches memory by the learner alone: a correction you make there is
learned at the session's next boundary (30 minutes idle, or a compaction), not in the turn you say it.

**A procedure** is kept as "How to <goal>: 1. … 2. …", at most 12 steps within 1,200 characters (the last steps left
out when it is longer, never a step cut in two, and the answer says how many). It takes its goal's slot (`how to ·
<goal>`, articles and case aside, so "cut a release" and "cut the release" are one goal): one way to a goal stands, so
an older procedure there is superseded by it, and the answer names it (a model's procedure never replaces yours: it is
filed dismissed, naming yours).

**Triggers are armed as a claim is filed** (by the agent's tools, your commands and the learner alike). A rule, convention,
preference, fact or decision whose words name a command under a negation ("don't run `npm test` bare", "never use
`git push --force`", "instead of `npm run migrate`") gets a trigger on that command, with the right way when the
sentence gives one ("run it with `env -u CLAUDECODE`"). Chapter 5.13 says how its words are read.

Each becomes a learned item in the archive (deduplicated against items of the same project and kind by normalised
text; a duplicate is not stored again, and when another session says it, that session is recorded once as *evidence*
for the item already there, which its confidence and its `✓n` mark count) and, when the engine is ready, a `remember`
call to the engine with `source:
filament-<kind>`, scope global, veracity as above, metadata `{ chain, turn, project, client, kind, via: "filament" }`,
pinned when confirmed or a rule. The engine write is fire-and-forget: it completes in the background (trace `engine
remember · background` in the *later* phase) and the item is then linked to its engine id. Texts under 8 characters
are ignored; everything is clipped to 500 characters. Your remember (`@mem remember`, the Memories tab) of a text you
had retired brings it back with its own engine copy restored, and says it stands again; a model's remember never brings
one back.

**What a correction retires** is the claim it names by its id (`filament_memory_correct`, `@mem correct`, the Memories
tab): no overlap of words decides it.
1. **The old claim becomes `superseded`,** naming the correction as its replacement, with the reason in its history. It
   leaves recall and the dossier at once and is never learned again from the same words. The archive's message
   history is untouched, and a past turn whose own claim was retired is not quoted back either.
2. **Its engine copy is invalidated** (`valid_until` set, `superseded_by` naming the replacement), never deleted: the
   engine stops recalling it, and bringing the claim back restores it.
3. **Sessions that were shown the old claim** get an erratum on their next turn (chapter 5.8).

A claim a session showed may be wrong carries a `suspected` event: the learner reads each session with the claims
memory showed it, by id, and says which the session showed wrong — you said otherwise, or a call that worked proved
otherwise — with the turn and why (chapter 9.2, step 4, *What the session showed*). It lowers the confidence of a claim that is
not your word (chapter 1.4), and the curator judges it (chapter 9.3, step 7). No overlap of words casts one.

### 5.11 Tools offered (trace: `memory tools offered`, `tools added to the request`)

When [`memory.autopilot.tools`] is on and the engine is ready (not degraded), the eight `filament_memory_*` tools
(chapter 12) are appended to the request's `tools` array in the client's wire format, skipping any the client already
declared. Coding agents do not get them here (chapter 10).

### 5.12 Handed to the upstream (trace: `handed to the upstream`)

Memory's work before the call ends. The record gets `memory = { chain, turn, position, client, signals, briefing:
items, injected: items, tokens, ids, tools, loaded, muted }`, and every step above is listed under
"Changes applied" as `memory: …` notes. The trace marks `handed`; the time from arrival to this mark is the
**blocking time** the benchmark reports (chapter 18).

### 5.13 Memory at the moment of action (trace: `memory at the moment of action`)

What memory knows about a tool call is said on that call's result, so the model reads it before its next step. A
briefing said it once, far back; a mistake is made at the call.

**Where it happens.**
- **A proxied client's tool leg** (Claude Code, Codex, Cursor, any client that sends tool results): the calls of the
  assistant message before the leg. The block is appended to the leg's message as `<filament-memory kind="rule">`,
  stored under that message's hash (a resend places it again byte for byte), and written as injection rows of kinds
  `pitfall` and `thread`.
- **The harness's own agent loop**: each hand, web or MCP call gets its reminders on its own result, after any
  post-tool hook's note, and its tool card names the memory ids. The loop's own model rounds are quiet requests the
  proxy leaves alone, so nothing is said twice.

**What is said, in this order:**
1. **The pitfalls the call walks into.** A claim's trigger matches when all of these hold:
   - **The shape:** the call is of the trigger's tool, and for a shell, one of its simple commands has the trigger's
     shape. Commands are split at `&&`, `||`, `;`, `|` and newlines, each read after its setup (`cd web && FOO=1 npm
     test` has the shapes `cd` and `npm test`). A trigger on a head alone (`npm`) matches every command under it.
   - **The words:** that command carries every word of the trigger anywhere after the shape, quotes and case aside.
     `git push --force origin main` carries `--force`; `git push origin main` does not.
   - **Not the right way:** the call does not hold the right way. `env -u CLAUDECODE npm test` holds `env -u
     CLAUDECODE`.
   - **Armed:** your word or the owner's, a confirmed claim, or one another session said again. A learned pitfall seen
     in one session stays quiet.
   - **Standing:** not held back by its files, and above the confidence gate.

   A pitfall with a right way is said on every call that misses it; one without, once a conversation: the session's
   own or a sub-agent's. Each saying is a `fired` event in the claim's history, naming the session,
   the turn, the conversation when it is not the session's own, the shape and the words.

   A call of the trigger's shape that holds the right way is noted too, never as evidence:
   - **`followed`:** the conversation was told, and a later call took the right way: once after each saying.
   - **`kept`:** the conversation was never told, and the call took the right way anyway: once a conversation, and
     only while the pitfall is armed and standing. A rule kept without a reminder is one the model knew.

   The claim browser says both on the trigger: "said 3 times · followed 2 times · kept 1 time without a reminder".
2. **The open threads on the files the call touches.** A thread anchored to a file the call names, or to a folder that
   holds one: a file tool's path field (`file_path`, `path`, `notebook_path`, `target_file` and the like), or the
   paths a shell command names, under the project's folder. Once a conversation, and not when it is held back or no longer
   sure (a thread ages from when a session last said it). A thread needs no second session.
3. **The rules that act** (proxy legs): every rule whose id (`i<n>` as its line shows it, or its engine row's id) is
   listed in [`memory.rules.act`] is compared with the text of the calls
   (name plus arguments), and a rule whose words overlap it by 25% or more rides along. Off for every rule until you
   list it, and never a rule already said as a pitfall.

**When memory stays out.** Nothing is said on a call's result, and nothing is told to the bus, where memory stays out
of the request: a muted session (`@mem off`, or its Memory switch off), a quiet request (`x-filament-memory: off`), or
memory or its autopilot off ([`memory.autopilot.enabled`]). The harness's agent loop keeps to the request that
started it, so its calls get no reminders and the miner learns nothing from them either.

A sub-agent is the session's own work. Its requests are quiet (its brief is in its opening, chapter 5.14), but in a
session whose memory and autopilot are on its calls get their reminders and teach the miner, on the turn that
launched it. A muted session's sub-agent gets neither.

The block reads:

```
Memory on the tool call the model just made (Filament):
- [memory i12 · user said] Don't run `npm test` bare here: run it with `env -u CLAUDECODE`.
- [memory i31 · inferred · open thread on src/net/client.js] The retry in src/net/client.js still drops the last attempt.
```

**How a claim's words become a trigger.** It is read when the claim is filed, without a model, for a rule, convention,
preference, fact or decision:
- **The mistake:** a command under a negation: "don't run X", "never use X", "stop running X", "avoid X", "instead of
  X", "not X". A way's verb under a negation is the mistake too, never the right way ("never run the migrations with
  X").
- **The right way:** "run it as Y", "use Y instead", "Y instead of X", "with Y", and after a colon or in the next
  sentence ("don't run X bare: use Y", "Don't run X bare. Use Y."). Y is the right way when it runs the
  same command, and what it adds before it is kept: setup (`env -u CLAUDECODE`, `CI=1`, `source .venv/bin/activate`)
  or a wrapper Filament does not know (`dotenv -e .env.test`, `aws-vault exec prod --`, `npx`), so long as none of the
  words before the command is prose. "Always run tests with `env -u A npm test`", with no negation, arms `npm test`
  with that way.
- **The words that make a call the mistaken one:**
  - backticked: every word after the shape (`` `git push --force` `` keeps `--force`);
  - in plain words, only the words that are surely the command's: an option (`--force`), a word with a path's, a
    name's or a number's mark (`node_modules`, `build:prod`, `3000`), and what a runner runs (`npm run migrate` keeps
    `migrate`, `python -m pytest` keeps `-m pytest`).

  So "never run psql against prod" fires on every `psql`, never only on a call that says "against". A second
  subcommand in plain words is not kept: "never run docker system prune" fires on every `docker system`. Backticked,
  it is exact.
- **When the reading changes** in a new version of Filament, the claims on file are read again once, as memory opens.

**The observation bus and the miner.** The bus is told what each call did as it ends, in-process: the producers never
wait, and a full bus (1,000 events) drops the oldest and says so in the log.
- **The harness loop** tells each call's end: its tool and input, whether it worked, its exit code, and the first 2,000
  characters of a failure.
- **A proxied leg** tells the results of the previous message's calls. An Anthropic `tool_result` failed when it says
  `is_error`, with the exit code read from its words ("Exit code 1"). An OpenAI `tool` message counts only when its
  words open with its exit code.

The **pitfall miner** reads the bus. A shell call that failed, then a call of the same turn that ran the same command
set up another way and worked, is a pitfall seen. Two ways count:
- **Setup before the same command:** `CI=1 npm test`, `env -u X npm test`, `sudo apt install …`; when the command was
  not found (exit 127, "command not found", "is not recognized"), a runner too: `npx jest`, `python -m pytest`;
- **A setup-only command before it in the same call:** `source .venv/bin/activate && pytest`, `nvm use 20 && npm test`.

An argument added after the command is not a way (it may only narrow what ran, or force it), nor is another command
first that is more than setup (`npm install && …`, `cd web && …`). A command that later works unchanged clears its
failure: it failed for another reason, since fixed.

What is seen is filed as a learned fact, `` `npm test` failed here (exit 1: <the error's telling line>); `env -u
CLAUDECODE npm test` worked. ``, importance 0.7, with its trigger: the shape, what a runner runs, and the right way. It
is not armed yet:
- **Another session that sees the same trigger** (the same shape, words and right way) adds evidence, and from then on
  it fires.
- **A claim already on file that says it** takes the evidence (and the trigger, when it has none).
- **A claim near in words that has another trigger** is another pitfall (`npm run test:unit` and `npm run build`, each
  worked around the same way, are two).

Nothing is mined from a session with no project, one that does not learn (learning off, or memory off for the chat), a call already read (a
resent leg), or a call whose words carry a secret (a key's shape, or a secret-named variable set).

**What shows.** The trace step `memory at the moment of action` counts the calls, pitfalls, threads, rules considered
and matched, and the tokens. The request's notes say `memory: 1 pitfall attached to the tool result (the call walked
into what memory knows)`; the log says `memory: a pitfall seen in session <id>: …` when the miner files one.

### 5.14 A worker's brief (a sub-agent's opening)

A sub-agent starts without the session's conversation, apart from what its launch or its card asks it to see —
nothing unless one asks. What memory hands it is a **brief**: the memories its task needs, each line with its id, so
it can cite, confirm or correct what it was told. Its first message is the conversation it was asked to see, if any,
then the brief inside `<memory>…</memory>`, then the task. Every sub-agent gets it while the chat's memory is on: memory
is core, and no setting or launch turns it off (`/subagent memory=` is said to be no option).

**What it holds, in this order:**
1. **Corrections.** What the session was shown in the last 14 days that was retired or corrected since, the most
   recently shown first, up to 10: `Memory correction: [i7] "…" no longer holds — now [i9] "…" (the user,
   2026-10-03).` A claim the curator merged into another is no correction: the survivor still says it.
2. **Your rules,** as the briefing gives them (chapter 5.7).
3. **The project and its dossier,** without the lines that rest only on pitfalls: those are said in the pitfalls
   layer, for the tools the sub-agent has. A line on a pitfall and something else stays, and the pitfall is said
   whole in the pitfalls layer too.
4. **How to do it here:** the procedures the task names, whole.
5. **Pitfalls of the tools it has:** the claims with a trigger on a tool the sub-agent may use (its mode's tools: an
   explorer cannot run a command, so it hears no command's pitfall). Armed, standing and above the confidence gate,
   as at the call. Each is said again at the call that walks into it.
6. **Open threads on the files the task names,** in the project's folder.
7. **Relevant to your task:** what else retrieval finds for the task's words, and quotes from other sessions. Never
   from this session: of its conversation the sub-agent has what its launch asked to see, and nothing more.

**Not said twice.** A sub-agent's requests carry the session's briefing in their system prompt (when memory and the
briefing are on for the session), so the brief leaves out what that briefing showed and says so in its first line.
A rule you gave after the briefing is in the brief.

**Its size.** The briefing's and the turn block's budgets together ([`memory.autopilot.briefingTokens`], at most
1,200 of it, and [`memory.autopilot.turnTokens`]): a brief carries neither where the repository stands nor the recent
sessions, which the briefing's larger budget is for. The first procedure shows even when it is long.

**No brief** when memory or its autopilot is off, the session is muted, Memory settings leave its chat out or exclude
the model its calls go out on (chapter 5.2), or nothing in memory applies to the task. The sub-agent then opens with
what it was asked to see and the task. A run its provider failed that goes on to its card's next model sends that model
the same first message — without the brief where Memory settings exclude it, in a thread given back after a restart too
(the session keeps the brief's words with the thread).

**What shows.** The sub-agent window's *Context handed over* has a *Memory brief · N lines* block, and its head says
*memory brief*. The brief is logged on the turn that launched the sub-agent as an injection of kind `brief`, so the
turn's memory widget lists each claim *in a sub-agent's brief*, and a claim it showed that is corrected later reaches
the session as a correction.

**What it found comes back.** When its exchange ends done with a report, memory reads what it established into the
session's memory as its findings (chapter 9.2, *What a sub-agent found*). Its own `remember` and `correct` calls are
its findings too (chapter 12).

---

## 6. The memory loop: while the upstream answers

### 6.1 The model asks memory (JSON replies)

When the reply contains calls to `filament_memory_*` tools and to nothing else, Filament runs them (trace `the model
asked memory`, `tool <name>`), appends to the outbound body an assistant message holding the model's text and its
memory tool calls plus a tool-result message with the outputs (the shape depends on the wire format; thinking blocks
are passed back only Anthropic-to-Anthropic where their signatures stay valid), and asks the same upstream again
(trace `upstream asked again with the results`). This repeats up to [`memory.autopilot.toolIterations`] rounds (4). Each call is waited on as long as a turn waits on memory (a minute): past it, its result says memory took longer than 60 s and the turn goes on, the call finishing or failing unwaited; a coding agent's calls and `/mcp/memory`'s too.
The client receives one reply: the visible blocks of every round, the memory tool calls removed, and the finish
reason of the last round. **Usage is reported from the client's point of view**: the first round's prompt plus the
sum of visible output — the conversation the client actually holds, since the withheld tool exchanges never become
client history (a client that reads usage as its context size would otherwise believe a 15k conversation was 150k
after one deep-retrieval episode and compact far too early). The request record keeps the summed processing total
of every round (the billing truth). Each tool result is capped at 12,000 characters (60,000 for a session load).

### 6.2 The same inside a stream

For streaming replies a stage sits between the upstream stream and the client. Text and the client's own tool calls
flow through as they arrive. A memory tool call's start, argument deltas and stop are **withheld**; the events that
would end the message (`message_delta`/`message_stop`, the `finish_reason` chunk and `[DONE]`, `response.completed`)
are **held** while only memory tools were called. When the upstream reply ends, Filament runs the calls, appends the
follow-up to the body, requests again, and continues the same client stream: block indices are **renumbered** so the
client sees a continuous sequence (Anthropic `index`, Responses `output_index` and `sequence_number`), usage from all
rounds is **summed** into the terminal event, and exactly one ending is sent. If a follow-up fails, Filament closes the
stream cleanly with an error event rather than leaving the client hanging.

### 6.3 Mixed replies are deferred (trace: `memory results deferred`)

A reply that calls both a memory tool and one of the client's tools cannot be looped: the client must run its own
tool first. Filament forwards the reply with the memory calls removed, runs the memory calls anyway, and keeps the
results on the chain. The client's next request of that chain (the tool-result leg) gets them appended to its newest
message as a block of kind `tool` (chapter 5.6), so the model still receives what it asked for, one leg later.

In Filament's own chats each memory call the request runs, looped or deferred, is also told to the agent loop that
sent it, in-process (never on the request's record): the chat draws it as a pill in the round that made it — what it
was asked, and what came back — live and after a reload, from the run's log. Where a chat's memory tools are off, the
briefing names none of them, and a call the model makes anyway is answered `Not run: memory's tools are off in this
chat. Go on without them.` — by the request where it carries the recall tool alone, by the agent loop where it carries
none — and never runs (10-28/29).

### 6.4 The cue (trace: `cue placed`)

On a session's first reply, when the briefing found related items or earlier sessions of the project, one visible line
is put in front of the model's first text: `Memory: 2 related items, 1 earlier session here (k3f9 tray loop). Say
"@mem load k3f9" to bring one in.` For streams the line is injected as the first text delta; for JSON it is prefixed
to the first text block. When memory has questions for you (chapter 9.3), the cue ends with `1 question for you: say
"@mem inbox" to see it.`, and a cue is shown for questions alone. A reply that is only tool calls gets no cue. Off with
[`memory.autopilot.cue`].

---

## 7. The memory loop: after the reply, and later

### 7.1 After the reply (trace: `after the reply`, `reply archived`, `use judged`, `learning queued`, `learning starts now`)

Once the client has its answer (off the critical path):

1. If this request was a **compaction request**, the reply text is archived as a compaction of this chain (turns 1 to
   the current count, kind `client`). An empty reply archives nothing.
2. The final assistant message is stored (by hash, encrypted) and **closes the turn**: `final_hash`, `ended_at`,
   output length, the answer's text in the search index, and the chain's finished-turn count.
3. **Use judgement** (chapter 7.2) marks each memory the request carried used or not.
4. The chain is noted for the **learner** (chapter 9): it will run once the session has been idle for
   [`memory.capture.idleMinutes`] (30). A compaction the client adopted starts the learner on that chain right away
   instead (chapter 9.1), once its row is written.
   The trace says `learning starts now` with the model, or `learning off` with why.

### 7.2 Use judgement and fading

For every item injected into a request, Filament keeps the item text in a small in-memory map (last 200 requests). When
the reply arrives, an item counts as **used** if any run of five consecutive words of the item appears in the reply, or,
for very short items, if the word overlap exceeds 60% (70% when the 5-gram test was possible but failed); or if the
turn's tool calls carry a word of the item that is rare across memory — held by at most 2% of the standing memories —
so a rule obeyed in a command ("use pnpm", then `pnpm install`) counts though the reply never says it. Memory's own
tools are left out of that, and so are strings longer than 2,000 characters (a file's body). The verdict
is kept **per memory**: each id the request carried is marked used or not on its own (`injection_ids.used`), so one
echoed line no longer credits its neighbours. The request's injection rows also carry `used = 1` if at least one
item was used, else `0`, for the Activity tab (yes / no / unknown); rows stay `null` when no reply was judged. A
model's `filament_memory_confirm` counts as a use of the memory where it was last shown, and a memory search that finds a
memory the session was shown counts as a use of that showing: the agent went back for it. A use counted while the turn
ran stands when its reply is judged.

A briefing is judged on the reply it was built for, and again on every later reply of its session: a memory it shows
is not shown again that session, so a reply that repeats it, or a call that carries a rare word of it, credits the
briefing's showing, once a session. When each memory was last used is kept too (`memory_last_used`), as the dossier
reads it (chapter 9.3, step 10): every use sets it, a session's later uses of its briefing's memory each as it comes,
and a fork's, whose briefing is its parent's and has no showing of its own to credit.

**Metrics.** Memory → Activity's "What memory showed, and what the work used" reads `GET /api/memory/metrics?days=`
(7, 30 or 90 days on the page; 1 to 365 through the API): per layer — briefing, turn block, pitfalls and open threads on
a tool call, corrections, a sub-agent's brief — what was shown, how much was judged and used, the tokens and tokens a
turn, and the showings of a memory the session had been shown already; then the use rate by whose memory it is (your
word, the agent's notes, sub-agents' findings, what was learned from sessions), how many memories shown were later
corrected, and how many fade now. It reads the injection log on disk, so its figures outlive a restart.

**Fading.** For each memory id, Filament counts how many of its showings in a row (newest first, skipping unjudged
ones) were not used. In `conservative` mode [`memory.autopilot.mode`], a memory with three or more consecutive unused
showings is dropped from autopilot retrieval, and every unused showing lowers its score by 0.05. Only facts, plain
memories and past words fade: **rules, preferences, conventions and anything you confirmed never do** — an obeyed rule
is not echoed, and silence is no evidence against it. Explicit searches (`@mem recall`, the search tool, the
console) ignore the fade and still find everything. A single use resets the count.

### 7.3 Later, in the background

- **Engine writes** of the claims filed complete (trace phase *later*).
- **Learning** (chapter 9) runs on idle chains, checked every 60 seconds, and at once on a session that compacted.
- **The curator** (chapter 9.3) runs a project's pass in the background once memory learned something in it since its
  last pass and that pass is [`memory.curator.everyHours`] (6) old, seen as a learning run lands and as a chat of the
  project starts a turn.
- **Backups** (chapter 17) at the configured hour.

### 7.4 How each model's work went (outcomes)

Memory keeps a record of how each model's finished work went: one row per finished piece of an agent's work, as
counts, never words (the `outcomes` table, chapter 14.1). It is a record for you to read. Filament never picks,
ranks or switches a model by it.

**Two kinds of work, each kept when it ends:**
- **A harness turn** (`turn`): the agent loop's. Kept when the turn ends.
- **A sub-agent's exchange** (`subagent`): its launch or a follow-up, kept when its run ends. Its `agent` is the
  sub-agent's type.

**How it ended** (`ended`): `done`, `failed` (the model call failed), or `stopped` (by you, a
round or time budget, the deadline, or the client leaving). A pause is no end: a turn paused on a question or a
permission keeps what it spent with the pause (on the session's row too, so a restart loses nothing), and the turn
that answers it writes one outcome for both halves. A pause never answered writes none. A loop that throws writes
none: that is Filament failing, not the model.

**What it did** (`did`): the most it reached, in this order:
1. `tests`: a shell command that runs tests. A test program (`pytest`, `jest`, `vitest`, …), a tool's test
   subcommand (`npm test`, `go test`, `cargo test`, `yarn test:unit`), what a runner runs (`npm run test:e2e`,
   `uv run pytest`, `python -m pytest`), a build's test goal (`./gradlew check`), or `node --test`.
2. `edited`: it wrote or edited a file.
3. `ran`: it ran any other command.
4. `delegated`: it handed work on to a sub-agent.
5. `read`: it read, searched or listed (the reader sub-agent, `delegate_read`, counts as a read).
6. `answered`: none of those (a question, the plan, memory's tools, an MCP tool).

The count of each kind of call is kept beside it.

**What it spent:** its rounds, its tool calls, tokens in (the prompt as the provider counted it, cached parts
included) and out, its cost (null when no price is known), and its time. Read off each of its own model calls'
records as the call returns. A turn's sub-agents are outcomes of their own, so a row never counts them twice.

**Corrected later** (`corrected`), which takes a run out of *held* (done and never corrected) but keeps how it ended:
- **`user`**: you pushed back on the reply you had just read, in any language: the harness turn whose reply your
  message answers is marked, never an older one. Models judge it, never a list of words:
  - the learner, as it reads the session (chapter 9.2): it names the turns whose words push back on the reply before
    them — say it was wrong, undo it, ask for it done another way — and an answer to a question that reply asked is
    none ("No, leave the README" after "Shall I update the README too?"). A pass that starts mid-session reads how the
    reply before its first turn ended (its last 400 characters), so a turn at the boundary is judged too;
  - the agent, at once, when it corrects a memory the session had been shown before that turn, quoting your words of
    that very turn (`filament_memory_correct` with `quote`, chapter 12); a memory the session never saw is news to it,
    and marks nothing.
  So a session that learns nothing (learning off, muted, opted out, no memory's model) marks only what its agent
  corrects with your words.
- A sub-agent's exchange is never marked: nothing says which one a correction of yours meant.

**Where memory stays out, nothing is kept:** memory off, its autopilot off, a muted session, a request that asked
memory to stay out (`x-filament-memory: off`). Rows go with their session when you delete it, and are
pruned after 365 days when memory opens.

**Where to read it:** Memory → Overview's *How models did* (chapter 19.4) and the harness's Settings → Memory →
*Models* (chapter 19.12), both from `GET /api/memory/outcomes?project=&days=&kind=`: the last `days` (1 to 365, 30 by
default), in one workspace or everywhere, of one kind or all. Grouped by model and kind, each group gives its runs; how
many were done, failed, stopped, corrected and held; its median rounds and median time; its tokens; its cost in all
and per priced run; and the same counts by what each run did.

---

## 8. Retrieval in depth

### 8.1 Keyword extraction

The query sent to the engine and the archive is not your sentence; it is its keywords. The algorithm
(`keywordsOf`):

1. Remove any memory blocks from the text. Inside fenced code blocks (```` ``` ````) strip every character except
   letters, digits, whitespace and `. / : _ -`, so code keeps its identifiers but loses its punctuation noise.
2. Split on whitespace, on the characters `" ' ` ( ) { } [ ] < > , ; ! ? | = + * & ^ % $ # @ ~`, and on any character
   outside ASCII that is no letter, mark or digit (`、`, `？`, `—`).
3. Trim leading and trailing `. : / \ -` from each piece. Drop pieces shorter than 2 or longer than 64 characters.
4. Deduplicate case-insensitively, keeping first appearance order.
5. **Code tokens first.** A piece is a code token when it contains a letter and matches one of: several
   alphanumeric parts joined by `. / : \ -` (paths, `usage.js:227`, `claude-opus-5`), camelCase (`getChain`),
   snake_case (`chain_id`), or letters followed by digits (`gpt5`, `k3f9`). Code tokens keep their case and go to the
   front of the result: they are the most specific things you said.
6. Every other piece must be a word of any script — a letter, then letters, marks, digits, `'` or `-` — long enough
   for its script (two characters in Chinese, Japanese, Korean or Thai, three elsewhere: words.js `shortestWord`), and
   not a **stop word**. No language is detected and no list of a language's words is kept: an ASCII text reads as it
   always did, and a run of a script written without spaces (`本番へのリリースは何曜日`) is one keyword, which the engine
   and the archive's trigram index (`fts_tri`) search by its parts. Where two texts are compared — a duplicate, an
   echo in a reply, a correction's overlap — such a run counts as its pairs of characters (words.js `segmentsOf`). The
   stop list, English's alone, holds about 150 words: articles, pronouns, auxiliaries, prepositions, politeness
   (please, thanks), fillers (just, really, quite), and generic verbs of talking about work (want, need, know, think,
   see, look, use, try, go, make, get). Kept words are lower-cased.
7. At most 14 keywords (16 when building a query). The query is the keywords joined by spaces.

Example: *"format this file for me the way I like, and keep in mind I never want semicolons"* →
`format file keep mind semicolons` (this, for, me, the, way, I, like, and, in, never, want are stop words). The trace's
`signals read` step shows the query, after dropping anything that looks like a key or token.

### 8.2 Query rewriting

Keywords can only find what was *worded* similarly. You remember an effort as "the bus refactor"; the sessions that
hold it say "GenericEventBus migration" and "action bus work" — no keyword query built from your words reaches them.
Recall by meaning (8.3) closes much of that gap, and the agent searches memory itself when it needs more; where you
switch it on, memory's model is asked to bridge the rest (trace `query rewritten` / `query rewrite skipped`):

- **When**: [`memory.autopilot.rewrite`] is on (it is off by default, until the memory evals show it pays), the turn
  block is being built, **and the base keyword query came back thin — fewer than two survivors after the gates**.
  Nothing the message says decides it (until 2026-11 words like *again*, *last time* or *continue* did). When your own
  words already find the material, no call is spent at all (trace `query rewrite skipped · the message's own keywords
  already found enough`).
- **The call**: one request to memory's model for the chat (chapter 9.1), at its effort, tagged purpose `recall` on
  LLM usage,
  system prompt asking for *only* `{"queries":["...","..."]}` with 2 to 3 alternative keyword queries of 2 to 6
  words, the message (memory blocks stripped, first 600 characters) as the user message, `max_tokens` 200.
- **The wait**: the call is waited for, however long it takes (since 2026-10-10: quality first). A failed rewrite is
  dropped and the turn block is built from the message's own keywords alone.
- **Filtering**: at most 3 variants survive; each is clipped to 60 characters; a variant whose every word already
  appears in the message's own keyword set is discarded (it adds nothing).
- **Use**: the surviving variants and the base keyword query are all passed to `retrieve` (8.4), which runs the engine
  recall and the archive search **once per query** and merges the results before ranking. The trace's `retrieve` step
  shows every query that ran; `query rewritten` shows the variants and their milliseconds.

### 8.3 What the engine does with the query

`recall(query, top_k, temporal_weight)` in Mnemosyne is a **hybrid** search over working memory (FTS5 plus vectors)
and episodic memory (vectors plus FTS5), returning up to `top_k` rows (Filament asks for at least 8) each with a
`score` between 0 and 1, `content`, `importance`, `source`, `scope`, `veracity`, `timestamp` and `metadata`. Inside
the engine, in outline:

- the query is tokenised; tokens of at least 3 characters that are not stop words or pure digits are the *lexical
  tokens*; hyphenated tokens also contribute their parts (`orion-gateway` → `orion`, `gateway`), and a small synonym
  table widens the FTS candidate set;
- candidates come from FTS5 (BM25) and from the vector index (cosine similarity of the query embedding against stored
  embeddings, when embeddings are on);
- a **lexical gate** protects precision: a candidate must share enough meaningful words with the query, and the
  required share rises with query length (one real word suffices for one- or two-word lookups; three-word queries need
  half; four or more need 30%), so a long natural-language sentence cannot match on a stray common word;
- the score blends the lexical relevance and the vector similarity, then applies importance, a veracity multiplier,
  and recency decay weighted by `temporal_weight` (Filament passes 0 for briefings, so recency does not matter, and
  0.1 for turn blocks, so recency is a light tiebreaker);
- entity-aware recall adds memories about an entity named in the query.

The lexical gate means the engine's recall never returns a row that shares no word with the query, however close in
meaning: the vectors only reorder rows that passed it. A question in another language than the memory, or a paraphrase
("pictures" for "screenshots"), would find nothing. So Filament asks a second question beside it, **by meaning**: the
`dense` op takes the person's own sentence (the newest message, the briefing's first message, the brief's task or the
search query, up to 500 characters), embeds it, takes the nearest stored vectors from the engine's index, and scores
each by the true cosine similarity of the two embeddings (the index's own figure is compressed by its int8 storage, so
that unrelated texts score 0.8 too). Rows below 0.45 are dropped, the rest join recall's rows with their score scaled
by 0.6, so a row both questions found counts once at its better score and a row found only by meaning has to be close
to beat a row that shares the words. On the golden set this raised recall on every surface (the briefing's from 0.85
to 0.96) with precision up too and the turn block about 12 tokens longer.

Filament asks with `hydrate: true`, so a memory whose content the engine truncated to 500 characters in its result set
is fetched in full. The engine's canonical facts are not read: the facts about you are memories of yours (chapter 5.7,
step 3).

### 8.4 Filament's filtering and ranking

`retrieve({ query, queries = [], projectId, mode, limit, excludeIds, entities, excludeChainId, within })` merges three
sources and ranks them; the trace shows each stage (`retrieve`, `engine results filtered`, `learned items scanned`,
`past sessions searched`, `ranked`). `queries` holds memory's model's rewritten variants (chapter 8.2) and every
source is run once per query — the base keyword query and each variant — with the results merged before filtering.
`excludeChainId` is the current session's own chain: its just-archived words are in the search index, and without
this filter the session would cite itself as "related memory from the past". `within` is set only by the search
tool's `project_only`: a claim filed in another project is dropped (the trace's `engine results filtered` step
counts it as `elsewhere`), and past sessions are searched in that project alone (with no project: only sessions in none). Left
out, memory crosses projects and the request's own ranks first.

**Engine rows.** A row is kept when `score ≥ minScore` [`memory.autopilot.minScore`, 0.2] **or** `score ≥ 0.05 and
score ≥ 60% of the best score in this result set` (so a query whose best hit is weak still yields its relative best).
Then: +0.15 if the memory's metadata says it came from this project; +0.2 if its text contains one of the message's
code tokens (*entities*); −0.05 per consecutive unused injection, and dropped at three in conservative mode unless the
mode is `search` (facts and plain memories only, chapter 7.2). Its kind is the stored `kind` from metadata, else the
kind of the item behind it, else `turn` when it points at a chain, else `rule` for engine memory type `instruction`,
else `memory`. Two kinds of row are never served: rows the engine wrote by itself (sources `sleep_*` and `memoria_*`,
chapter 9.4; the trace counts them as `engineWritten`), and rows whose item is retired, even where the engine still
holds them valid (`retired`). A row answers as the item behind it, `i<n>` with that item's trust; a row with none is
adopted as one first (origin import, inferred: *imported*, counted as `adopted`).

**Learned items** of the project (up to 200 newest, not retired): the word overlap between the query and the item
text is computed as shared words (longer than 2 characters) divided by the smaller word set; kept when ≥ 0.25. Score
`0.4 + 0.5 × overlap`; how sure memory is of the item is weighed later, with every claim's. Id `i<n>`, the same id its
engine copy answers with, so the two merge. (Your rules reach the briefing on their own, chapter 5.7.)

**Past sessions**: `searchInputs(query, limit 8)` runs FTS5 over what you typed and what the model finally answered.
The query becomes an OR of quoted phrases, one per word (so `usage.js:227` stays one phrase), ranked by BM25; a query
with no letters or digits falls back to a substring scan. Each hit becomes an item of kind `session`, id
`s:<chain>:<n>`, with text `"<title>" turn <n>: <snippet>` (the snippet is 12 tokens around the match), score
`0.55 − 0.05 × rank` (floor 0.2), +0.1 for the same project. A hit is dropped when the turn it quotes made a claim that
has since been retired or is held back, and the snippet is that claim's words: a corrected value must not come back as
a quote, nor a withheld one.

**Merging.** An item is dropped when its id is in `excludeIds` (in view already: the briefing's, or an earlier
block's on a message still sent) or when the first 80
characters of its normalised text were already seen (duplicates across sources).

**Weighing.** Each claim's score is weighed by its confidence (chapter 1.4): `relevance × (0.5 + 0.5 × confidence)`.
- **Quotes** of past sessions count as confidence 0.5: words nobody checked.
- **The order:** everything is sorted by the weighed score, and claims are then looked at in that order until `limit`
  is filled.
- **Each claim's standing** is read as it comes:
  - its anchors, against the files as they are (one `stat` per file per request);
  - its values, against the request's environment (its working folder, the lockfiles there, the tools it offers, the
    platform its `<env>` names).
- **What the autopilot skips:**
  - a claim held back, which explicit search keeps, marked `held` and labelled: *file gone*, *contested: the
    environment says bun (bun.lock)*, or *of another project: here the working folder is …*;
  - a claim whose confidence is under 0.35 (with −0.2 for a changed file), which search also keeps.
- **Marks:** a kept claim gets `✓n` when n ≥ 2 sessions said it, and *file changed since* when a file it names moved.
- **The result** is sorted again.

The `ranked` step shows:
- how many candidates;
- how many were held back and how many were unsure;
- how many were in view already, and how many were duplicates;
- which sources contributed, and the top score.

### 8.5 Budgets

Budgets are in tokens and enforced as characters ÷ 4 while lines are added; the first line that would overflow stops
the loop. Defaults: briefing 4,500 tokens; turn 300, ×1.5 after a compaction and on a first message no briefing was built on; 0 on tool legs and on a message with no word
to search by. A loaded session gets 6,000 tokens (up to 30,000 when the model
asks through the tool with `budget_tokens`).

### 8.6 The query for the briefing versus the turn

Both use the same keyword algorithm. The briefing uses the newest message (or the first, on retries) with limit 14 and
recency weight 0; the turn block uses the newest message with limit 3 (8 in `eager` mode) and recency weight
0.1, and excludes every id the briefing already placed.

### 8.7 Rendering a past session (views)

`render(chainId, { view, budgetTokens, fromTurn, toTurn })` builds text from the archive, newest turns first within
the budget (the newest turn is always kept; older ones are dropped first, and a line says how many were omitted):

- **chat**: `### Turn n (time)` / `User: <your message, capped at 4,000 chars>` / `Assistant: <the final answer>`.
- **summary**: the same, but the assistant part is the turn's one-line summary written by the learner, or the first
  400 characters of the answer plus a count of tool calls.
- **full**: the raw messages of each turn (user, all tool work, final), as JSON.
- **compact**: the newest compaction summary of the chain, then the chat view of the turns after it.
- **lineage**: not one session but the whole effort: the session and all of its ancestors (chapter 3.1), oldest first,
  each rendered in `summary` view within an equal share of the budget (at least 400 tokens), headed by its id, title,
  date, learner end-state summary, and `— this session` on the one you named. One load brings in the arc of a
  multi-session effort; the token count is the sum.

---

## 9. Learning and curation: when a model is called

Learning (9.1, 9.2) and the curator (9.3) are where Filament itself calls a model to build memory. Both run in the
background, so no reply waits on them. Everything in chapters 5 to 8 is pattern matching, database lookups and vector
search, apart from the few bounded calls chapter 9.5 names.

### 9.1 Triggers

| Trigger | When | Reason shown |
|---|---|---|
| idle | A chain that had a turn finished has been quiet for [`memory.capture.idleMinutes`] (30); checked every 60 seconds | `idle` |
| compaction | A compaction a window adopted was written: the harness's line, Compact now (`/compact` too) or `/autofit`; a client's own summary. Not a loop's round fold or a fork's brief | `compaction`, with its door: `line`, `manual`, `autofit` or `client` |
| manual | `POST /api/memory/learn/<chain>` | `manual` |
| backfill | After an import, or Memory → Settings → *Learn from imported sessions*: every chain never learned from, newest first, one run per chain, not bound by the daily cap | `backfill` |
| a sub-agent's report | A sub-agent's exchange (its launch or a follow-up) ended done with a report; read on the learner's own line, one report at a time (chapter 9.2, *What a sub-agent found*) | `subagent` |

A compaction's run starts at once, off the hot path, so the turns it stands for are learned before the session goes
on without them. The compaction says so in its note, its operation and its trace: "learning from them now on
<model>", or "nothing learned from them now: <why>". The why is the widest switch that is off: memory off, learning
off ([`memory.capture.learn`]), the session muted or opted out, no learning model. Undoing a compaction does not undo
what was learned from it. One run reads a session at a
time: a compaction that comes while one is going runs once it ends; any other trigger is turned away (`running`).

Learning needs a model: memory's model, [`memory.models.summarizer`], set in Settings › Memory › Model (the
composer's picker, with an effort chip beside it). A model set there is first for every memory call — learning, the
curator, a search's rewrite, a chat's name — whatever chat the call is for. Not set (empty, or an older config's
`auto`), each call resolves in this order and takes the first that serves:

1. the chat's compaction model ([`context.compaction.model`]);
2. the chat's own model — for a sub-agent's chat (its findings), the chat that launched it; for the curator, the
   project's most recently active chat;
3. the most recently active chat's model anywhere (the model new chats start on is the harness's own pick, kept in the
   browser);
4. none: memory waits, and every place that shows it says why.

A step that names a coding agent's model (Claude Code's, Codex's) stands as the same model through a provider's route
where one serves it — the model the agent's route sends, called as a plain completion — and is passed over where none
does: an agent with hands of its own never reads memory's prompts. Memory never picks the cheapest model by itself:
what reads a project's chats is a provider the person chose for it. `off` is none. Without a model, nothing is learned,
the curator works by rule alone and no search is rewritten; sessions are still archived and searchable.

**Effort.** Memory's calls (learning, curating, rewriting, chat names, a goal's estimate) are
sent at low effort, as `output_config.effort`: memory reads and files, it does not solve. [`memory.models.effort`] sets
another level, or `model` for the model's own (none sent); a level the model does not take is fitted as every
request's is. A compaction's summary is the chat's work and keeps the model's own.

### 9.2 One learning run

1. **What it reads.** Every finished turn since the last learned one (`meta.learnedThrough + 1`; a forced run reads
   from turn 1), up to the newest finished when the run starts: a turn still running is left for a later run. Each
   turn reads as the chat view shows it: the person's words, then **the calls its work made**, oldest first (the
   newest 40, each tool with its input in brief, *(failed)* when its result was an error), then the answer. Nothing
   new → skipped. **In passes:** the turns go oldest first, at most 12,000 tokens and 16 turns a pass, a turn never
   split; one longer than 24,000 characters keeps both ends, with a marker for the middle. A run reads at most 12
   passes; with more left, the session is noted for its next boundary, which reads on from where this run stopped.
2. One request per pass to memory's model through Filament's own front door (`/v1/messages`, headers `user-agent:
   filament-memory/0.1`, `x-filament-memory: off`, `x-filament-memory-purpose: learn`, `x-filament-memory-for: <chain>`),
   `max_tokens` 3,000 plus the reasoning room (chapter 9.3), with the fixed learning prompt as the system prompt. The
   user message names the project; from the second pass on it says what the earlier passes established ("The session
   so far, as learned from its earlier turns: …"), so the end state is the whole session's; then the pass's turns,
   secrets redacted. After the turns come, read again for each pass, the project's **open threads** by id (the
   standing ones, the most recently said first, at most 20), the **goals of its procedures** (newest first, at most
   20) and the **claims memory showed the session** by id, up to the pass's last turn (its briefing, related memory and
   searches, the most recently shown first, at most 30; threads are the open threads'). A pass that starts after the
   session's first turn reads first how the reply before that turn ended, its last 400 characters, so a turn there
   that pushes back on it is judged too.
   The prompt opens with what memory is for — later sessions with this user start from what memory holds: keep there
   what they could not re-read from the code or git, the user's rules, corrections and decisions with their reason,
   and the pitfalls the session hit (the memory plan's d5) — and asks for **only a JSON object**:
   - `title` (3 to 8 words);
   - `state`: `summary`, `done[]`, `open[]` (unfinished work or an unanswered question, one self-contained sentence
     naming its file when there is one), `next[]` (in the same form), `closed[]` (a listed thread this session finished
     or made moot, `{ id, because }`) and `still[]` (the id of a listed thread it worked on that is not finished);
   - `turns[]` (one-line summary per turn number);
   - `items[]`: kind ∈ decision, rule, convention, preference, fact, procedure; one or two sentences; importance 0 to
     1; the turn it came from; and, for an item that states the current value of one thing, its `slot`: subject,
     attribute, value, and `multi` when the thing holds several values at once;
   - `corrected[]`: the turns whose words push back on the reply just before them, in any language (an answer to a
     question that reply asked, a new request or thanks is none);
   - `contradicted[]` (`{ id, turn, why }`) and `held[]`: a listed claim the session showed wrong — you said otherwise,
     or a call that worked proved otherwise — and one it relied on and found true.

   Its rules: only things that matter in future sessions, no transient steps, no file contents, no secrets, fewer
   better items (0 to 8), corrections are rules with importance 0.9, unfinished work in `state.open`, not in items. A
   multi-step task that worked and is likely to be done again (a release, a deploy, a migration, a setup) is one
   procedure, "How to <goal>: 1. <step> 2. <step>": the goal in the words a user would ask for it with, each step the
   exact command or action that worked (never one that failed), at most 12. A goal on the list that the session
   carried out again is filed under that same goal. A listed thread is never repeated in `state.open`. A turn's calls
   are the assistant's: a procedure's steps and a convention's command are calls that worked, and a failed call proves
   only that it failed.
3. If the reply holds no JSON object, one retry with a firmer instruction. Still none: when the model has answered
   JSON before (since Filament started), the pass is split in two and each half read; a single turn it still cannot
   answer is **passed over**, said as a warning in Activity, and the cursor moves past it, so a session never sticks on
   one turn. When it never has, the run stops as `bad json` and the turns wait: the model, not the turns, is the likely
   fault. A model error stops the run where it is; what landed stays.
4. Applied to the archive, pass by pass: the title (if the chain has none: the first pass's), the end state (the
   newest pass's; status `open` when anything is open, else `done`), turn summaries (only for turns without one), and
   items.
   - **The threads it was shown:** each listed thread in `closed` closes. A learned one is retired (dismissed, its
     reason `done: <because> (session <id>)`, with a `closed` event); one you said, corrected or confirmed is asked
     instead, as an inbox question of kind `close` (chapter 9.3), once a session. Each listed thread in `still` is said
     again: evidence, so it does not age. An id that was not listed is passed over. A model that finishes a thread's
     work closes it itself, the same way, with `filament_memory_close` (chapter 12).
   - **What the session showed:** each turn in `corrected` that the pass read, and that Filament did not begin itself,
     marks the reply it answers as corrected by you (chapter 7.4), once — not one kept apart, which no model reads. Each listed claim in `contradicted` gets a
     `suspected` event with the turn and why, once a session, for the curator to judge (chapter 9.3, step 7); each in
     `held`, and not contradicted, is said again (evidence, once a session, never by the session it came from). An id
     that was not listed is passed over.
   - **Unfinished work becomes threads:** each line of `state.open` and `state.next` is filed as a `thread` item,
     importance 0.6, of the pass's last turn. A thread that names a file is anchored to it (chapter 5.13 says
     when it comes back).
   - **Items:** kind must be one of the seven, text at least 8 characters, anything matching a key or token pattern
     (`sk-…`, `Bearer …`, `api_key=…`, `password:`) is discarded, importance clamped to [0.3, 1] with defaults 0.9
     rule, 0.75 decision, 0.6 otherwise. A fragment of code or markup is counted as junk and left out. A procedure
     must read as one, with at least two steps (a single command is a convention), or it is junk; it is kept as it
     reads, at most 12 steps within 1,200 characters, in its goal's slot.

   Each item is then filed against what is on record (`brain.fileLearned`):
   - **A rule, preference or decision needs your own words.** It is kept as one only when your own words of
     its turn say it: a third of its key words are among them. Text you pasted or quoted, Filament's notices and the
     assistant's words do not count. Otherwise it is stored as a *fact*, and its history says why.
   - **The same words, or the same value in its slot, already on record:** an *evidence* event on that item ("said
     again in session …"), once per session, not a second item. The same words retired stay retired: the learner
     never brings back what was retired.
   - **Engine memory overlapping the item's words by 80% or more,** from this project or a global one: evidence for
     the item behind it when that item stands. When that item was retired, the new one is stored dismissed, naming it.
     Another project's memory is not a duplicate. For an item with a slot, the overlapping one must hold the same
     value. A thread is near only to a thread: open work and a fact in the same words are two memories, and only the
     thread is closed when the work is done.
   - **Otherwise a new item,** `inferred`, origin `learner`, mirrored to the engine (rules pinned). In a single-valued
     slot it replaces the values said before it (superseded, with history and errata), and is itself stored
     superseded when a value was said after it: when a session said it decides, not when it was learned. A value
     you said, corrected or confirmed is never replaced: the learned one is stored dismissed, naming yours. A
     procedure's slot is its goal, single-valued: a session that did a thing another way replaces the older way.
   - **Triggers:** a rule, convention, preference, fact or decision filed new is read for triggers (chapter 5.13).
5. **The cursor.** Each pass that lands moves `learnedThrough` to its last turn, never back. The daily cap
   [`memory.capture.dailyCap`] (200 items) stops item storage: a capped pass does not move the cursor, and the run
   stops there, so those turns are read again on the next run. A backfill is not capped.
6. The project's curator pass is queued (9.3), and the chain's `meta.lastLearn` and the learner's run list are
   updated. The console's
   Learning runs table reads that list.

Cost: one call per pass, two with a retry; a session read at its first compaction is usually a few passes. The prompt
is the session text, which is new each time, so prompt caching does not help here.

**What a sub-agent found.** A sub-agent works in its session's project: it reads the files and runs the commands, and
what it establishes there would be lost with its window. When one of its exchanges (its launch or a follow-up) ends
done with a report, the harness tells memory's observation bus (chapter 5.13): the session, the turn that launched it,
the sub-agent's id, type and model, its task, the calls it made and its report. A failed, stopped or cut exchange
tells nothing, and neither does an empty report. The bus never waits: the learner reads each report on its own line,
one after another, in the order they came.
1. **Skipped,** with the reason in Activity, when the session is not in the archive, learning is off
   ([`memory.capture.learn`]), the session does not learn (muted, or its learning off), there is no learning model
   ([`memory.models.summarizer`] is `off`, or nothing you connected has a price to choose), or the report is empty.
   A report whose chat Memory settings leave out, or whose calls went out on a model they exclude, never reaches the
   learner (chapter 5.2): it is not read, and Activity has no row for it.
2. **One request** to the learning model, as in step 2 above, with the findings prompt as the system prompt. The user
   message names the project, the sub-agent (its id, type and model) and its session, then gives:
   - its task, 4,000 characters at most;
   - the calls it made, oldest first: the newest 40, each tool with its input in brief (200 characters at most), and
     *(failed)* when its result was an error;
   - its report, 16,000 characters at most, both ends kept;
   - the goals of the project's procedures.

   Secrets are redacted before any of it leaves. No JSON: one retry with a firmer instruction, then `bad json`.
3. **What it may file:** facts, conventions and procedures it established by reading the project's files or running
   its commands, and only what a later session could not re-read from the code or git in a moment: a command that
   fails here and the way that works, a place or a behaviour it had to search for, how the project is built, run or
   tested as its calls showed. The prompt says so, as what memory is for. **At most 3 a report**, the ones the model
   weighed most important; the rest are counted as over. A finding was used by a third as many of the sessions shown
   it as a learned memory, and findings were most of memory (the memory plan's d5). A rule, preference or decision is the user's word, which a sub-agent cannot give, and an
   open thread is its session's own work: those are refused. What its task asserted, or what it guessed or planned,
   is not asked for, and a failed call proves only that it failed. Junk, code, a one-step procedure and a secret's
   shape are left out as in step 4, and the daily cap applies.
4. **Filed as the learner's items are** (`brain.fileLearned`: the same evidence, slots, and your word holding its
   slot), but as the sub-agent's finding: origin `subagent`, *a sub-agent found*, confidence 0.55, in its session and
   on the turn that launched it. Its `created` event names the finder: its id, type and model.
5. **No second witness:** a sub-agent is its session's own work, so what it says is not another session's word.
   Evidence still counts only from another session. A pitfall it found is armed, like a learned one, once another
   session's evidence or your word backs it.
6. **The trace:** a learning run in Activity, reason `subagent`, with the sub-agent named:
   - "learning from sub-agent sa_…'s report (session …)";
   - how many notes the model proposed;
   - then "learned from …: N notes", with what was filed, deduped, refused, junk, a secret or over the 3, or
     "… skipped — <why>".

   When it filed anything, the project's curator pass is queued.

Cost: one call per report, two with a retry.

### 9.3 The curator: memory's sleep

Between sessions a **curator** goes over a project's memory, the way sleep consolidates what a day held:
- what says the same thing becomes one memory;
- a value gets the slot that lets a newer one replace it;
- a memory whose file changed is checked against the file;
- a suspicion is judged against what cast it: what a session found, or a correction;
- a memory the dossier is about to be written from is checked against the turn it came from;
- what went stale is retired, and a finding no session used lapses;
- the project's dossier is written;
- the same correction given in two sessions or more becomes a question: keep its lesson as your rule?
- a fact about you learned in two projects or more becomes a question: keep it about you in every project?
- one topic of the project gets its page: its memories folded into a few lines, each citing them.

**The model judges, rules choose.** The model says whether two memories say the same thing, which value a note
states, whether a note still holds against its file, whether what a session found says a note is wrong, whether the
turn a note came from bears it out, what lesson corrections across sessions share, and which fact about you holds in
every project. Fixed rules decide which memory
survives, which value wins, and what may be retired without asking you. The curator never writes a memory's words:
memories keep their sayers' words. A lesson it proposes is a question, and its words become a memory only when you
accept them, as yours.

**When it runs.** One pass at a time, in the background — a pass never holds up a turn:
- by activity: as a learning run lands in a project, and as a chat of the project starts a turn, memory looks whether
  the project's pass is due — something was filed, said again or reworded there since its last pass began, and that
  pass is [`memory.curator.everyHours`] (6) old; before its first pass, its first memory is. The global memories are a
  scope of their own, looked at the same moments. So at most four passes a day for a project in use, none for one where
  nothing was learned, and none waiting on a clock: a machine asleep at night misses nothing. A scope already waiting
  or going is not queued twice;
- on demand: `@mem curate` for this project, or `POST /api/memory/curator/run` with `{ project }` (no project = the
  global memories).

Off with [`memory.curator.enabled`].

**Its model.** Memory's model for the project (chapter 9.1): the one set in Settings › Memory, else the compaction
model or own model of the project's most recently active chat. [`memory.curator.usesModel`] off (Settings › Memory's
*The curator uses memory's model*) is no model, and the steps that need none still run. Calls go through Filament's
front door as purpose `curate`, at low effort, at most [`memory.curator.maxCalls`] (20) a pass. A pass that runs out of
calls stops calling and says so, keeping what it did. The dossier's call is kept for it where the dossier will
write (what it is written from moved since its last version): a step before it that would take the last call stops
one short ("…, the dossier's call kept for it"), so a step with more to do than the pass has calls for does not starve
the dossier every session reads. A dossier that would stand keeps none, and its call goes to the step with work; where
that call's answer moves what the dossier is written from (a memory retired or merged), the dossier is owed, and the
project's next pass is due however little it learned since.

**When memory closes under it.** Filament stopping, or a setting that reopens memory (on or off, its folder, its engine,
privacy), cuts the pass going:
- **Its run ends at once:** it keeps the calls the pass made and the steps it did, marked `cut: "memory closed"`. A pass's
  calls are on its run as it makes them, so even a pass cut by Filament being killed keeps its count.
- **Its model call is stopped:** no answer is paid for that could not be filed, and one that comes anyway is not read.
- **The rest waits:** a pass queued behind it skips, and so does the learner's idle tick.
- **The learner's run is cut the same way,** as is a report's reading. It ends "memory closed", with no warning and no
  error counted. What landed stays filed with the session's cursor past it, and the rest is read next time.

**A busy provider is asked again.** Learning and the curator try a call again when its provider was busy for a moment
(it limited the rate of calls, was overloaded, timed out or failed on its side — before its answer began, or in the
middle of its stream), as Filament's own loops do: up to ten tries, waiting 1 s, doubling to 32 s, or what the
provider's Retry-After asks. A spent allowance or a refused key is no moment: the first refusal stands. Memory closing
ends the wait. A run someone waits on (`@mem curate`, Learn now) waits with it. A call a turn waits on — a recall's
rewrite, a compaction's summary — fails at once, and its caller goes on; so does a chat's name, which is tried again on
a later turn. One rate limit failed a learning run otherwise, and a finished session's turns waited for a boundary it
never has. Each try is a request of its own in Usage.

**No cap on an answer.** Every memory call asks for the most its model can write: learning, curation, query
rewriting, goal estimates, compaction summaries and their slices alike.
- **The ceiling:** what the model can write, when its tables or its provider say so, else 128,000 tokens; fitted to
  what the model's window leaves after the prompt, which a provider would refuse to pass.
- **Why:** a model that reasons writes its thinking inside `max_tokens`. With a cap sized to the answer alone, GLM 5.3
  spent whole judgement calls thinking and answered nothing, and GLM 5.3 Flash spent every 1,500-token slice of a
  compaction thinking, so the compaction failed (HarnessV3-FailurePoints §13).
- **The cost:** a cap is a ceiling, not a spend: a model pays for what it writes.
- **The length:** an answer's length is asked in its prompt ("about 1,100 words"), and a summary is kept whole.

**The steps**, in this order. Each one fails alone, and the pass reports it:
1. **Threads expire.** An open thread whose confidence has fallen under the gate is retired as expired. A thread ages
   from the last session that said it.
2. **Gone files.** A memory whose file has been gone for a day (since it was last seen) is retired. One in your word
   is asked about instead.
3. **Unused findings lapse.** A finding — a sub-agent's or an outside agent's, a fact or a convention — is retired
   ("lapsed: N sessions were shown it M times and none used it, and no other session said it") once it was shown in a
   turn's related memory 3 times, in 2 sessions at least, and the reply used it none of them, where no other session
   said it again and nobody confirmed it. One session's turns on one task are one look. A briefing's showing is not
   counted: a dossier line shows the memories it cites in its own words, which the reply is judged against once a
   session; nor is a sub-agent's brief, which is never judged. A procedure comes only when a task names its goal, and a
   rule, preference or decision an agent filed itself is seldom said back in a reply: those never lapse. No erratum is
   said, nor a line in a brief: it was never wrong. Without it, a finding faded from conservative briefings at most,
   and stood for good.
4. **Keying.** Unkeyed facts, conventions, decisions and preferences go to the model. For each note that states the
   current value of one thing, it names the thing and its value.
   - **The slots in use come first:** the model is shown the ones already in the project, yours first, at most 40. It is
     told to key a note about one of those things into its slot exactly, whatever the note calls it: "the api", "the
     server" and "the http server" are one slot when they are one thing. A newer value then meets yours, and you are
     asked. In the live check, "api" and "server" split one port in two, and your old value stood unasked.
   - **A note given several slots is not keyed:** it states several values, such as a project's summary. It is marked
     unkeyed, with the values named, never keyed by whichever came last.
   - A slot is kept only when the value is in the note's own words.
   - Once keyed, the slot's rule settles it: in a single-valued slot the newer value wins and yours holds.
   - Two values you said become a question.
5. **Merge.** Candidate pairs are found by rule: the identifying words of one hold half the other's, or one slot
   holds one value.
   - **By meaning too** (f6): each memory of the project the merge has not looked up yet, the oldest first, 100 at
     most a pass, is looked up in the engine by meaning (chapter 8.3's vectors): of the 16 rows nearest it, every
     project's, its three nearest memories of this project from a cosine of 0.75 up pair with it — a memory said
     again in close words, or in another language ("Das Projekt verwendet pnpm" beside "The project uses pnpm"). On
     the engine's multilingual model a memory said again in other words measured 0.59 to 0.95, in another language
     0.76 to 0.98, and two memories on one topic that say different things 0.30 to 0.59; on a project of 2,308
     memories on one topic, 0.55 gave 3,973 pairs, mostly two things on one topic, and 0.75 gave 519. A looser
     rewording is found only by its shared words.
   - **Looked up once:** a memory is marked looked up, with its pass, once every pair it is in is settled — judged
     different, or merged into one. One whose pair a pass had no call or no answer for, or that the model judged the
     same but no group could take, is looked up again next pass, and so is one that stands again after it was
     retired, and both memories of a verdict undone. Undoing a pass looks its memories up again; deleting a memory
     takes its mark. Nothing is looked up while the engine makes its vectors again (a new model, a reindex asked on
     the console, an import's), with an engine that has none, or when the pass has no call left to judge a pair; a
     memory not in the engine yet waits, and a lookup that fails waits for the next pass, behind the others. An engine
     without its vector index (sqlite-vec) gets 20 lookups a pass: each scans every vector it holds.
   - **Never candidates:** two memories holding rival values (`3000` and `8080`, `pnpm` and `bun`), however near
     by meaning (two values of one thing measured up to 0.93), or two of different kinds unless both tell how to
     work.
   - **The model judges each pair.** A pair judged different is not asked again. A procedure is shown to it whole: a
     step one lacks makes it another way, and two ways to one goal are settled by its slot, the newer way standing.
   - **The survivor is chosen by rule:** your word, then a confirmed memory, then the one more sessions said, then the
     oldest.
   - **The others** are superseded by it ("merged: says the same as iN"), and their sessions count for it (`✓n`).
     Since your word survives first, a merge never retires it.
   - **Only memories judged the same as each other become one:** a memory is never merged into one it was not put
     beside, even through a third that resembles both.
6. **Re-verify.** A memory whose file changed, or lost a name it relies on, goes to the model with the file's text
   around what it names (at most 6,000 characters).
   - *Holds:* anchored afresh, and the label goes.
   - *Wrong:* retired. Yours is asked about instead.
   - *Unsure:* left labelled.

   Each answer is kept with the state of the files, so files that have not changed are not asked about twice.
   **Which first:** a memory not checked in the last week before one checked since, so a file that changes every
   pass never takes every call; then the memories the dossier cites, which every session reads; then the most shown in
   the last 30 days; then the oldest. What a pass has no calls for waits for the next (the pass's `reverifyLeft`).
7. **Suspicions.** A learning pass that found its session showed a memory wrong casts a suspicion on it, with the
   turn and why (chapter 5.10). A memory's suspicions since it was last judged go to the model, each beside what the
   session found, or the correction on record that cast it, twelve to a call and at most two calls a pass:
   - *About something else:* cleared. The suspicion stops counting against the memory's confidence. Shared words alone
     are not enough to make it wrong.
   - *Wrong:* a learned memory is retired with the reason ("session … showed it wrong: …"; one judged against a
     correction is superseded by it). Yours is asked about instead, and stands meanwhile. One project's session never
     retires a global memory: that one is weighed, and stands.
   - *Unsure:* weighed. The suspicion still counts.

   A suspicion whose correction was retired since is cleared with no call; one with neither a finding nor a
   correction is left as it is. A judged memory is not asked about again until a new suspicion comes.
8. **Grounding.** A memory the dossier is about to be written from is checked against the turn it was learned from.
   A cheap learner can read two sessions wrong alike, and two sessions earn a dossier line; the turn is what was said.
   In a call, a turn is shown once for the memories it gave there, in parts, each cut around their words where it is
   long, each memory's words given a place:
   - what you said (600 characters);
   - the calls that name them, with what each returned (or "failed:" where the call failed): at most three, those
     whose results name them first, as an edit that writes a memory's words returns only "done" (an input in 160
     characters, a result in 300). Memory's own calls are left out, Filament's and `/mcp/memory`'s, and so are memory's
     reminders and Filament's notices on a result: what memory said is no proof of itself;
   - the assistant's answer (700 characters for one memory, more for each other, at most 1,200).

   This sends memory's model what calls returned, which no other step does. Each part has its secrets blanked before
   it is cut: what Filament's redaction blanks everywhere, and beyond it a secret set in an environment or config line
   (`DATABASE_URL=…`, `export SESSION_SECRET=…`; a number such as `max_tokens: 4096` stays), a password in an address
   (`postgres://user:…@`), a private key, and live or test keys (`sk_live_…`, `AKIA…`).

   Then the model's verdict:
   - *Borne out:* +0.05 to the memory's confidence, what another session saying it adds (chapter 1.4). It is no
     session: `✓n` and the lapse of an unused finding still count sessions alone.
   - *Wrong* (you said otherwise, or what a call returned shows otherwise): retired, "checked against session …, turn
     n: …", with an erratum to the sessions shown it.
   - *Unsure* (what is shown does not bear on it, or the learner named the wrong turn): kept as it is.
   - *No answer* for it: asked again next pass.

   Each memory is asked once, the most shown in the last 30 days first, six to a call and at most two calls a pass;
   the rest wait (the pass's `groundLeft`). Not checked:
   - your word: your words were held to the turn as they were kept;
   - an open thread: it is filed on a reading's last turn, and it expires on its own;
   - a finding: it is filed on the turn that launched its agent, where the only thing that names it is that agent's
     report, a call's result, which would be shown as proof of itself;
   - a memory with no turn of its own, or one from a turn kept apart, unfinished or rewound, or from a chat Memory
     settings leave out.
9. **Restore.** Engine rows the fence set aside (chapter 9.4) that are word for word old items become questions:
   bring them back or not.
10. **The dossier.** The model writes the project's dossier in sections: what it is; conventions and rules; how to;
   pitfalls; key decisions; facts; current work and open threads, each only when it has something. It works from the
   project's standing memories, each with its trust and `✓n`, and from its last five sessions' titles, dates and
   summaries.
   - **Open threads:** from the thread memories alone, each cited by its id. A session's own *open* and *next* lines
     are not given: they may be done by now, and a line citing a session for open work could never be closed.
   - **How to:** one line a procedure, as the memory names it: "How to <goal> (n steps)". Its steps are left to
     recall, which serves them to a task that names the goal.
   - **Pitfalls:** the memories marked `pitfall` (the ones with a trigger): what fails here, and the way that works.
   - **Cites:** each line cites the memories (`i12`) or sessions (`s:<id>`) it rests on. A line that cites nothing it
     was given is dropped before it is stored.
   - **Use:** the memories it is given are ranked by how sure, how important and how used they are. Use is counted in
     thirds over a memory's last nine judged showings in a turn's related memory, once three were: used in a third of
     them weighs 1.15, in two thirds 1.3, less (or too few judged to tell) 1, so a rank moves only when the rate
     crosses a third. A briefing's showings weigh nothing here: it shows the dossier whatever the session is about,
     and its verdicts would weigh a memory down for being in the dossier. The last nine, not the last days: a memory
     in the dossier is shown in no turn, and a window of days would let its rate lapse as time passed, out of the
     dossier and back.
   - **Left out for going unused:** a memory the briefings of five sessions showed after it was last used, none of
     them using it, is not given. A briefing's memories are judged on every reply of the session, not its first
     alone (chapter 7.2), and a use counts from when it was judged: a session that uses its briefing's memory late
     starts the count again, whatever sessions began meanwhile. Such a memory leaves the dossier at once (a line
     resting on it alone is not shown, counted in "…and N more"), the next version is written without it, and
     `@mem curate` says how many beside that version. It stands, search finds it, and a turn's related memory still
     shows it where a message names it; once a reply uses it, its count starts again and it is given again. There is
     no window: a memory left out is in no briefing's dossier, and would age back in a month later. Your word, rules,
     preferences, conventions, procedures, open threads and pitfalls keep their place however seldom a reply repeats
     them: a pitfall's fired, followed and kept are the better signal.
   - **Versions:** a new version is written only when what it would be written from has changed: the set of memories
     it is given (the 80 surest, most important and most used) and the sessions as it reads them (title, day,
     summary). The same memories ranked anew among themselves, by a use or otherwise, or a learning run that left a
     summary as it was, write none and make no call; a memory that rises into the 80, falls out or is left for going
     unused is a new set.
   - **Not in it:** your own rules, which the briefing shows first (chapter 5.7 step 2).
   - **Reading it:** Memory → Projects → *Show*, or `GET /api/memory/dossier?project=<id>`.
11. **Patterns across sessions.** One session sees only its own corrections, and the same one given in three sessions
   was three. The curator reads the project's corrections of the last 90 days:
   - what you said to a reply you pushed back on (a turn the learner, or the agent quoting you, marked corrected);
   - a memory your word put in place of another, with what it said before;
   - a memory a session showed wrong, and why (step 7).

   Corrections given in two sessions or more that share words are one pattern: every two of its corrections share at
   least two identifying words and half the shorter's, so one short line like two others joins one of them, never both
   into one. A fork counts as the session it was taken from, and a correction to words already on file as the
   session's that heard it. For each pattern, the model is asked whether its corrections share one lesson to follow
   from now on, shown beside your own rules, preferences and conventions that share their words and the lessons you
   turned down (at most three of each; at most two calls a pass, the patterns of most sessions first):
   - *A lesson one of those says already:* no question.
   - *A lesson that says a rule of yours is out of date:* a question, *change "your rule" to "the lesson"*. Your rule
     stands meanwhile, flagged with the words it would take; accepted, it is corrected to them, with its history.
   - *Any other lesson* in words the corrections hold: a question, *keep as your rule*. Accepted, the words become
     your rule, shown first in every briefing (chapter 5.7, step 2).
   - *Reject:* never asked again. The question keeps the corrections it was drawn from, and a pattern holding any of
     them is its, however many sessions give the same correction after; once they have all aged past the 90 days, the
     model is shown the lesson you turned down beside the pattern.
   - *No lesson*, or a rule in words the corrections do not hold: no question; the pattern is looked at again once a
     session more gives it.

   The question names no memory, so none is served marked in question while it is open. A turn kept apart, and a
   chat Memory settings leave out, give no correction, and a secret in one is blanked before the model sees it. A
   suspicion the curator cleared (step 7) is none. Undoing a pass withdraws its questions, and their corrections stay
   asked, as a restore's do. `@mem curate` says how many were asked.
12. **About you, everywhere.** Each project keeps its own memories, so who you are and how you work was learned again
   in every project and known in none of the others. The learner gives a fact about you a slot whose subject is you
   (*user · background*, *user · editor*). One thing about you is a slot that holds one value, or one value of a slot
   that holds several (each language you write is its own). Where the facts of two projects or more hold the same
   thing, and no memory of no project holds it yet, the model is shown them, one per project first, the newest first,
   at most six. It picks the one true of you in every project, about you rather than one project's work, and names
   the others that say the same; or none, where none holds beyond its project or they contradict each other (at most
   two calls a pass). The one it picks becomes a question in every project's inbox, *keep about you in every project*:
   - *Accept:* its words are yours in every project, a memory of no project in the same slot. A fact or a decision is
     shown in every briefing after your rules (chapter 5.7, step 3); a preference or a convention among your rules. The fact it
     picked and the ones it said say the same are replaced by it, with their history; one it left out, that says
     more or is about one project's work, stays. Where you keep a value of that slot everywhere already, it is
     corrected to these words.
   - *Reject:* never asked again for that value as the learner worded it. A further project's fact may put the thing
     again, and a different value may be asked.
   - *None*: no question; the thing is looked at again once a project that was not judged holds it.

   While its question is open, a thing is not put again. The curator writes no words of its own here either: the
   question carries a project's fact as it was learned. A question whose picked fact is retired or corrected
   meanwhile is withdrawn. Once you keep a value everywhere, a project's learner hears it: the same value said again
   counts for yours, and the project's older learned value of that thing gives way to it; another value is your word
   against it, filed set aside and asked about later, your line marked *said otherwise later* meanwhile. A value set
   on the Memory page holds what its words name, so the same value learned in two projects is not asked about. A
   question that would keep a fact in every project quotes other projects' facts: a handle kept to one project (a
   device paired for it) neither lists, counts nor answers it. `@mem curate` says how many were asked.
13. **Topic pages.** A search of memories serves them one by one, a few at a time: a question several memories of one
   topic answer got part of them, each with its own line of metadata. A topic page folds a topic's memories into a
   few lines, as the dossier does the project's, read when the work comes to that topic.
   - **Topics, by rule:** the memories of one thing their slot names — a component (*task graph · …*,
     *acp bridge · …*), not the project itself, you or a procedure's goal — and the memories naming files of one folder
     of the project (*src/app/agent*), not its top folder: that is the project, which the dossier is about. A memory
     may be in two topics. A topic has three memories or more (open threads aside: they are the project's work), of
     which a page is written from the 30 surest and most important. On the owner's largest project (2,159 standing
     memories) that made 35 topics by slot and 45 by folder, 11 of them over 30 memories: at a page a pass, some 80
     passes to write each once.
   - **One page a pass:** a topic with no page first, the larger first; then the topic whose memories moved most since
     its page was written — memories in or out, or their words changed — once a third of those it was written from
     moved, so a rank shuffled at a large topic's 30th place, or one memory more, writes no new page (one call). A topic
     whose page stands makes no call, and a pass with no call left reads no topic.
   - **Written and kept like the dossier:** the model folds the memories into sections (the dossier's, but its current
     work), each line one sentence citing the memories it rests on, names, values, paths and commands copied as they
     stand. A line that cites none it was given, or whose words its memories do not hold (60% of its identifying words),
     is dropped. Then its caps: at most 10 lines, six a section as the dossier's; no longer than the memories it cites
     (a page that says more than its memories abstracted nothing), lines dropped from its end until it is; and citing
     three memories or more, else no page. A topic whose page came to nothing is asked again only once its memories
     move — each project's topics their own; an answer with no JSON (cut, or broken) is no verdict, and the topic is
     asked again next pass.
   - **Read as it is now:** a line shows only while every memory it cites stands, is not held back and is still the one
     it was written from — its words as they were, in the page's project — so a retired memory's line leaves the page
     at once, whatever version was written, and so does one whose words changed, or whose chat moved to another project;
     a page with fewer than two lines left is no page.
   - **Served by search:** where two memories a search found or more rest under one page's lines — a third of what its
     lines rest on, or the page no longer than they are, so a narrow search is not handed a page of other things — the
     page is served in the place of the first and those memories are left out: its lines carry them with their ids
     (`page:<name>`, kind `page`; at most two pages a search). A search for `page:<name>` gives that page alone, whatever
     share. Only the asker's project's pages are served. The memories a page's lines carry count as in view, as a
     memory's own result does (a turn's related memory does not say them again, chapter 5.8); over MCP they are logged
     as shown, so one retired later reaches the session as an erratum; and a search that serves in a page a memory the
     session was shown counts as a use of it.
   - **Linked from the dossier:** the first dossier line placed that a page's lines rest on ends with
     `→ page:<name>`, each page once, and a line under the briefing says a search for it gives the page.
   - **Never learned from:** a page is read, never made into memories.
   - **Reading them:** `GET /api/memory/pages?project=<id>`.

   Measured on the golden recall eval's corpus (test/memory-recall-golden.test.js): a question five memories of one topic answer — payments, sales
   tax, discount codes and invoices at checkout — got two of them from a search of memories (87 tokens); with the
   page, all five (153 tokens), where the five memories served as search results take 212.

**Undo.** Every action is a history event of its pass (`r<n>`). `@mem undo r<n>` (or `POST
/api/memory/curator/runs/<n>/undo`) takes a pass back, newest action first:
- statuses, slots and counts go back to what they were;
- its dossier and topic pages are set aside (the versions before them are read again), and its questions are
  withdrawn;
- an action whose memory changed after it is left as it is, and the reply says which.

Nothing is deleted: the undone events stay, marked. `GET /api/memory/curator/runs` lists the passes.

**Memory's questions.** What would retire or change your own word is asked, never done:
- two values you said for one thing;
- a value a later session learned for one of yours (chapter 1.4, *Slot*): it would correct yours to the later words;
- a memory of yours whose file is gone, or that no longer holds against its file;
- a memory of yours a session found or a correction says is wrong (step 7);
- an open thread of yours that a session or a model says it finished (`close`, chapter 9.2);
- an old item the fence set aside;
- a lesson the same correction in several sessions suggests, to keep as your rule, or a rule of yours it says is
  out of date, to change (step 11);
- a fact projects learned about you, to keep in every project (step 12).

How to answer:
- `@mem inbox` lists them (`GET /api/memory/inbox`).
- `@mem accept q<n>` does what it proposes, as your word, with its history.
- `@mem reject q<n>` closes it for good: the same question never comes back.
- Over the API: `POST /api/memory/inbox/<n>` with `{ "answer": "accept" }` or `"reject"`.
- On the pages: Memory → Memories → *Memory asks* in the console, the Questions view of Settings → Memory and the
  *Memory asks* section of the session's Memory instrument in the harness (chapter 19.12).

Until you answer, the memory stays served, marked *in question* (chapter 5.7 step 9), or *said otherwise later* for a
later value; the later value's own card says *held for your answer* and what it would replace. The first reply's cue
says how many questions wait (chapter 6.4). A question whose memory is retired meanwhile, by you or anyone (or whose
replacement is), is withdrawn at once, saying why. Deleting a session or a project takes the questions about its
memories with it.

### 9.4 The engine writes nothing by itself (the fence)

Filament owns what is true; the engine stores and recalls what Filament gives it. Mnemosyne can also write on its own —
its `sleep` consolidation summarises working memories into episodic ones, its model-refresh step proposes "facts"
about your setup, and its MEMORIA layer adds instruction fragments — and on the owner's store those rows were guesses
that outranked what you had said. So:

- Filament never asks the engine to `sleep` (there is no nightly run and no *Sleep now* button), and it starts the
  engine with model refresh switched off (`MNEMOSYNE_SLEEP_MODEL_REFRESH_ENABLED` and `_AUTO_APPLY` false, also
  written to its `config.yaml`).
- On every engine start, a `fence` marks every row the engine wrote by itself (source `sleep_*`) and not yet fenced as
  superseded (`superseded_by = 'filament:engine-written'`, `valid_until` now), in working and episodic memory, and
  expires such canonical facts. Nothing is deleted; the ids are recorded in the archive (`schema_meta` key
  `engineFence`), so undoing a fence is clearing those two columns on exactly those rows. A second fence finds none.
- Recall never serves an engine-written row (sources `sleep_*` or `memoria_*`, tier `memoria`), fenced or not.

Should the engine still call a model, its calls come back to Filament under `/memory-engine/v1`, are served like any
other request, tagged purpose `engine`, never captured into memory, and shown on Traffic → **Memory** (labelled
`memory · Memory engine`).

### 9.5 What is never done

No summarisation per message. No embedding computed in Filament (the engine embeds what it stores). No model call to
decide what to inject. No model call to judge use. There are two exceptions to "no model per message":
- **The client's own model** deciding to call a memory tool: one extra round of the model you already chose.
- **The query rewriter** (chapter 8.2), where you switch it on: when a message's own words find little, it suggests
  alternative search words. It narrows or widens the search and never decides what is injected.

---

## 10. Coding agents

Requests routed to an ACP agent (Cursor, Claude Code, Codex, Qoder run as child processes) or the Cursor SDK follow
the same situate and prepare steps with `captureOnly`: the turn is archived, earlier blocks are re-attached, and
nothing is injected and no tools are added to the request, because the agent owns its own prompt and tools. Instead
Filament hands the agent an **MCP server** (Model Context Protocol, the standard way agents discover external tools)
at `POST /mcp/<token>` on Filament itself, listing the eight memory tools (and, when the agent's built-in tools are
switched off, Filament's file and terminal "hands"). The agent's model can call `filament_memory_search` and the rest
exactly as an API model would; the project for those calls is the agent's working directory, and what the agent
stores is its note (inferred, *assistant noted*; its history says *agent*). After the agent's turn,
the final text and the list of tools it called are archived and the turn closes. Memory's briefing is not placed into
the agent's prompt today.


### 10.1 Memory for any agent: `/mcp/memory`

An agent Filament does not run (Claude Code on its own, Cursor, VS Code, any MCP client) adds Filament's memory as one
MCP server, once, for every project (HarnessV3-Memory M7-6). For Claude Code:

```
claude mcp add --scope user --transport http filament-memory http://127.0.0.1:20300/mcp/memory --header "Authorization: Bearer <your inbound key>"
```

Settings → Memory shows this line with Filament's own address, ready to copy. It never shows the key.

**The door (M7-D39).**
- The house key passes.
- With `server.inboundKeys` set, the request must carry one of them (Bearer or `x-api-key`), whatever `requireAuth`
  says: 401 otherwise, with `WWW-Authenticate: Bearer`.
- With none set, only this machine (403 from another address).
- A browser page is refused before any key is read: an `Origin` that is not loopback, `server.host` or an
  `allowedHosts` name is 403. A POST must be `application/json` (415), which a page cannot send without a preflight.
- The Host guard (421) and the restart's 503 hold as on every `/mcp/` path.

**The protocol (M7-D38).** Streamable HTTP:
- **POST** carries JSON-RPC: one message, or a batch. Notifications and answers get 202.
- **DELETE** ends the session.
- **GET** is 405: there is no standalone stream.
- **The answer** is JSON. It is an SSE stream only when the client must first be asked its folder.
- **The protocol version** is the client's when it is one Filament knows (2024-11-05 to 2025-11-25), else the newest.

**A session is memory's (M7-D40, M7-D41).**
- **The session id.** `initialize` gives an `Mcp-Session-Id` (32 hex digits).
- **Its chain.** The session's first call that reads or writes memory makes a chain of kind `mcp`, keyed
  `mcp:<id>`. It is in the project of the session's folder, its client named `mcp:<clientInfo.name>`. A session that
  only lists the tools writes nothing.
- **What it is shown is logged on the chain**: a brief, search results, a claim's card or history, a reminder (each
  kind with its own lines' tokens; nothing for a search that found nothing). A claim retired later reaches the
  session as an erratum, opening its next answer as a first text block, once. A session told nothing new gets one
  block.
- **Provenance.** What it remembers, corrects or retires names its chain, and its client as the finder (M7-D47). An
  erratum for a claim it retired names it: `(Cursor, an agent over MCP, 2026-10-03)`.
- **Not listed.** The chain is in no list of the person's sessions.
- **Restarts.** A session outlives Filament's restart: an id Filament did not issue in this process is adopted, and its
  chain found by its key.
- **Ending.** An id its client ended with DELETE is 404, here and, when it has a chain, after a restart too.
- **No id.** A call stands in no session: it is told no erratum and logs nothing.

**The folder (M7-D42).** In this order:
1. the call's `cwd` argument;
2. the session's `x-filament-cwd` header, or `?cwd=` on the URL;
3. the client's first `file://` root.

The roots are asked with `roots/list`, on the first answer after `initialize`, as an SSE stream, when the client
declared `roots`, named no folder and accepts a stream. Claude Code answers with the folder it was started in. The
client's answer comes back as a POST. One that does not answer within 5 seconds leaves the session with no folder.
`notifications/roots/list_changed` asks again.

A folder seen for the first time becomes a project, so the claim browser lists what was filed there.

**No folder (M7-D43).** `remember` is refused unless asked with `scope: "global"`: a claim that holds in every
project, about the user, not a codebase. Reads with no folder read every project.

**The opening (M7-D45).** `initialize` answers with `instructions`, which a client puts in its agent's system prompt.
They say how memory is used. When the folder is known as the session opens, they also carry the brief for no task: the
user's rules and the project's dossier, in 600 tokens, logged as shown on the session.

**The tools (M7-D44).** By short names: a client prefixes its server's name, as in `mcp__filament-memory__brief`.
Every call is `agent`. What it stores or corrects is its finding, never the user's word (M7-D47):
- **Status.** Inferred, as sure as a sub-agent's finding (0.55).
- **Its line.** Says *an agent found*, which a brief's legend explains.
- **The card.** In the claim browser it names the client as `Cursor (MCP)`.
- **Its history.** Says *agent*.

An agent's rule is not briefed as the user's: a session finds it when its turn asks.

| Tool | Arguments | Returns |
|---|---|---|
| `brief` | `task`, `tools` (default Bash, Read, Edit, Write), `budget` (tokens, 300 to 4,000), `cwd` | The brief chapter 5.14 describes, for an agent: rules, the dossier, the procedures the task names, the pitfalls of its tools, the threads on the files it names, what else matches; or why there is none |
| `search` | as chapter 12, and `cwd` | as chapter 12; each result logged as shown |
| `claim` | `id` | The claim's card, as the claim browser draws it (`GET /api/memory/claims/:id`) |
| `history` | `id` | as `GET /api/memory/items/:id/history` |
| `pitfalls` | `tool`, `input` (the call's arguments), `cwd` | The reminders the call would get in a session (chapter 5.13). A pitfall with a right way is said each time a call does it the wrong way; anything else is said once in the session |
| `questions` | `cwd` | Memory's open questions in the project and everywhere. Read only: the user answers them |
| `sessions`, `load` | as chapter 12 | as chapter 12 |
| `remember` | as chapter 12 without `quote` (the session holds no words you typed), and `scope` (project, global), `cwd` | as chapter 12 |
| `correct` | as chapter 12 without `quote` | as chapter 12 |
| `close`, `confirm`, `forget` | as chapter 12 | as chapter 12 |

What memory refuses is a tool error (`isError`), in words, never a protocol error. With memory off or not started,
every call says so. The reads are marked `readOnlyHint`.

The operation log records each call: which tool, whether it worked, the client and the session. It never records the
call's arguments or its answer.

---

## 11. Commands and headers

Type these as the first line of a message in any chat, whichever client or model. Filament answers and the upstream is
not called (the record shows `command: true` and `local: true`). Prefix [`memory.commands.prefix`], default `@mem`;
`/`, `!` and `#` never reach Filament from Claude Code, which is why the prefix is `@`.

| Command | What Filament does |
|---|---|
| `@mem status` | Engine version and state, embeddings on or off, memory counts, archived sessions and turns, this session's id, project, turn count and muted flag, autopilot mode and tools |
| `@mem recall <words>` / `@mem search <words>` | Retrieval in `search` mode (no project filter, no fade, limit 10) over the engine, learned items and past sessions; lists kind, date, session, text and id |
| `@mem sessions <words>` | Past sessions whose *inputs* match the words (FTS), up to 10, numbered, with title, date, client, turns, the session each one *continues*, end state and matching snippets; no words = the 10 most recent. The numbering is remembered for `load` |
| `@mem load <n or id> [chat\|summary\|full\|compact\|lineage]` | Renders the session (default `chat`, 6,000 tokens) and attaches it to your **next** message in this chat as a block of kind `load`; records a `loaded` link. `lineage` renders the session plus all of its ancestors, oldest first (chapter 8.7). The chat's own session stops before the message it rides, with no link. While memory is off in the chat (or autopilot is), the load waits, and the reply says so |
| `@mem remember <text>` | Stores the text as a confirmed fact (your word: *user said*) and a pinned engine memory, importance 0.85. A text you had retired stands again, and the reply says so |
| `@mem rule <text>` · `@mem prefer <text>` | The same, as a rule or a preference: the command names the kind, never your words (chapter 5.10) |
| `@mem procedure How to <goal>: 1. … 2. …` | The same, as a procedure; one that does not read so is refused. It replaces the older way to its goal, and the reply names it (chapter 5.10) |
| `@mem forget <id>` | Retires a memory by its id (`i<n>`, or `e:<id>` for an engine row): dismissed, kept with who and why, its engine copy invalidated, never deleted; sessions shown it lately get an erratum. Past words (`s:…`) are quotes and cannot be forgotten |
| `@mem confirm <id>` | Your word that a standing memory is right: it is confirmed (*user confirmed*) and anchored afresh to its files as they are now, so a change it survived is no longer flagged. One confirmed already says so. A retired one is not confirmed back: remembering its words again brings it back |
| `@mem correct <id> <what is true now>` | Your correction: the new words replace the memory (it is superseded, kept with its history), and the sessions shown it lately hear of it. `@mem forget <id>` retires one with nothing in its place |
| `@mem history <id>` | A memory's history: its kind, status and trust, its words, its slot and value when it has one, every change with when, who and why (and each session that said it again), and what it replaced or was replaced by. The same as `GET /api/memory/items/<id>/history`, which takes the console's item number or any id a line shows |
| `@mem off` / `@mem on` | Mutes or unmutes this chain: while muted nothing is recalled into it and nothing is captured or learned from it; the archive still records turns |
| `@mem new` | Rekeys the chain so the next message starts a fresh session for memory. In a chat of the harness's own it rekeys nothing: the chat goes on as this session, and New chat starts fresh |
| `@mem curate` | Runs the curator on this project now (chapter 9.3) and says what it did: merged, keyed, checked, the corrections' doubts judged, retired, the dossier written, questions raised, model calls, and the pass to undo |
| `@mem undo <r>` | Takes a curator pass back (`r12`, as `@mem curate` names it): what it changed is put back, newest first; an action whose memory changed since is left, and the reply says which |
| `@mem inbox` (or `questions`) | Memory's questions for you: what the curator would do to your own word, asked instead of done |
| `@mem accept <q>` / `@mem reject <q>` | Answers a question: accept does what it proposes, as your word, with its history; reject closes it for good, and it is never asked again |
| `@mem help` (or anything else) | The list above |

Headers a client can send: `x-filament-memory: off` switches this request to quiet mode — nothing new is injected,
captured or learned, but the injections the conversation already carries stay byte-identical (dropping them would
break the provider's prompt cache for no privacy gain: they were sent already). On a fresh chain the request is
fully bare. `x-filament-adds: none` keeps memory out entirely — bare, nothing re-attached — along with every other
addition of Filament's: a Claude Code or Codex Filament launched sends it where its model calls go to Filament, as its chat's turn has memory already. To keep memory out of a whole client, model or folder for good, use the `memory.capture.exclude*` lists —
those stay bare on every request; `x-filament-memory-load: <session>[:<view>]` attaches a session to the newest message of the first request memory speaks into — this one, unless memory stays out of it (same as `@mem load`; from a caller over loopback or with the admin token alone, else set aside and said on the record); `x-filament-cwd: <path>`
names the project folder when the system prompt does not.

---

## 12. The memory tools a model can call

Added to API requests (chapter 5.11) and offered to agents over MCP (chapter 10). Names are prefixed
`filament_memory_`.

| Tool | Arguments | Runs | Returns |
|---|---|---|---|
| `search` | `query` (names, files, errors, topics, or the question in a sentence: recall asks by its words and by meaning, chapter 8.3), `limit` (≤30, default 10), `project_only` (default false) | Retrieval in `search` mode: claims held back or under the confidence gate are kept, labelled. Every project's memory, the request's own first; with `project_only`, the project's alone: its claims, the ones that hold in every project and its sessions' words, never another project's (from no project: the ones that hold everywhere) | `{ results: [{ id, kind, trust, when, session, turn, score, text, flags }] }` (`flags` when a line has marks: `✓n`, *file changed since*, *file gone*, *contested: …*, *of another project: …*); a topic page of the asker's project in the place of two memories found or more that its lines carry, `{ id: "page:<name>", kind: "page", when, score, text }`, and a `query` of `page:<name>` gives that page alone (chapter 9.3, step 13) |
| `sessions` | `query`, `limit` (≤20) | FTS over past inputs, grouped by session | `{ sessions: [{ id, title, project, projectName, cwd, client, when, turns, state, open[], matches[] }] }` |
| `load` | `session`, `view` (chat, summary, full, compact, lineage), `from_turn`, `to_turn`, `budget_tokens` (200 to 30,000, default 4,000) | `render` (lineage: the session plus its ancestors, chapter 8.7) | the rendered text (or messages as text for `full`), capped at 60,000 characters |
| `remember` | `text`, `kind` (fact, rule, preference, decision, procedure), `importance` (default 0.8), `quote` (optional: your words that say it) | A new item, tagged with this chain and turn: the model's note, so `inferred`, origin `model` (*assistant noted*), its engine copy unpinned (a sub-agent's own call is its finding: origin `subagent`, *a sub-agent found*, naming it; an agent's over `/mcp/memory`, origin `agent`, *an agent found*, naming its client); a text that was retired stays retired. A procedure must read "How to <goal>: 1. <step> 2. <step>" (else `{ error }`); it replaces the older way to its goal, unless that one is yours (a quote of your older words never replaces your newer way). With `quote` found in your own words in this chat (below), the item is yours: origin `capture`, *user's words*, still `inferred` until you confirm it — and a note of the model's already on file with the same words becomes yours, its history saying who heard it | `{ stored: true, id, quote?, replaced?, note? }` (`quote`: whether it was found, and why not; `replaced`: the procedures it replaced; `note`: steps that did not fit), or `{ stored: false, id, note }` for a retired text or a goal your own procedure holds |
| `correct` | `id`, `text` (optional), `reason`, `quote` (optional: your words that correct it) | The new text becomes its own item (inferred, *assistant noted*; a sub-agent's, *a sub-agent found*; with `quote` found in your own words in this chat, origin `correction`, *user corrected*, and your own word it replaces is not asked about: it is your newer word) and the old one is superseded by it, with the reason; its engine copy invalidated; sessions shown it get an erratum. Without `text` the memory is only retired. An open thread whose work is done is closed, not corrected. A retired memory is refused, saying what stands: its replacements followed to the one that stands, to correct instead; or, when none does, why, and that what is true now is a new memory | `{ ok, id, replaces, status }` or `{ ok: false, error }` |
| `close` | `id`, `because` | An open thread whose work is done, closed as the learner closes one (chapter 9.2): dismissed with the reason `done: <because> (session <id>)` and a `closed` event naming the session, the turn and the sub-agent or agent that closed it; no longer served or said at a call. Your own thread is yours to close: you are asked (`close`, chapter 9.3) and it stays open until you answer. Any other claim is refused, in words: it is corrected instead. So is a past session's words (`s:<chain>`, as a dossier cites a session): an open thread is a memory with an i-number | `{ ok, id, status: "dismissed", closed: true }`; `{ ok, id, asked: "q<n>", note }` for yours; `{ ok, id, status, already: true }` for one retired already; or `{ ok: false, error }` |
| `confirm` | `id` | The memory counts as used where it was last shown (so it does not fade) and its history notes it; only you make an item *confirmed* | `{ ok, id, status, note }` |
| `forget` | `id`, `reason` (optional) | Retire a memory that was never true: dismissed, kept, engine copy invalidated | `{ ok, id, status }` or `{ ok: false, error }` |

Every tool takes the id a line or a search result shows (`i<n>`, `e:<id>`, or the bare id the engine's own tools
show). An engine memory with no item behind it is adopted as an imported item before it is corrected or retired, so
its retirement has the same history. The briefing tells the model when to use them: when the user refers to past
work, when starting on a project, when context is missing, before repeating something the user corrected, and, when
what it observes contradicts a memory, to correct that memory by its id. Every result is JSON text capped at 12,000
characters. Errors come back as `{ error }` so a failure never breaks the model's loop. For a caller that could not read every session, `search` keeps to its project's memory as `project_only` does, `sessions` lists its project's sessions, and `load`/`grep` reach those and its own — any other is `{ error: "no such session in this project's memory" }`, and a lineage leaves out other projects' ancestors; its briefing and related memory keep to its project too.

**A quoted word is yours (the memory plan's d1).** `remember` and `correct` take `quote`: your words that say it,
copied exactly. Filament looks for them in what you typed in this chat — your own words as memory reads them: a text
block that opens as Filament's notice is left out whole, with the command's output, the team's result or
the flow's news it carries; so are memory's blocks, a client's reminders, quoted lines, fenced and long pasted blocks —
case and spaces aside, in the chat's newest 500 turns. The quote must say the claim: half the claim's identifying
words, its numbers among them, are in it, each found as it stands (inside a run of Japanese or Chinese too, so your
sentence in your language backs a claim written in English where they share its names and numbers). Where all that
holds, the claim is filed as yours: *user's words* for `remember`, *user corrected* for
`correct` — never by words you said before the memory it replaces. Its history keeps the quote, the turn you said it in
and who filed it (`created`: `quote`, `turn`, `filedBy`). Nothing is read for meaning: the words are compared as they
stand, in any language. A quote that does not hold stays the model's note, and the answer says why:
- words you never typed, or typed in another chat;
- words that do not say the claim (half its identifying words);
- under 8 characters besides spaces, or over 500;
- a call that stands on no turn of a chat of yours;
- a turn you kept apart, rewound or answered with a command, one Filament began itself, or a client's compaction
  summary, which quotes you back;
- a sub-agent's call — Filament's own (its finding), a coding agent's run as a sub-agent, or any call standing in a
  sub-agent's chat: you spoke to the agent that launched it, which quotes you itself;
- an agent's over `/mcp/memory`, whose session holds no words you typed (its `remember` and `correct` take no `quote`).
So a page or a tool's output that says "remember the user wants X" never becomes your word: only what you typed is
heard — and what you pasted into your message with no fence and no opening line of your own, which reads as typed.
One more is not told apart: Claude Code's own Task sub-agent over `/v1` sends no mark of being one, so its chat opens
with the prompt its parent model wrote, and a quote of that prompt is heard.

**On which turn.** A request's tools file on its own turn. The harness's agent loop sends each later round as a
quiet request of its own (a tick, `x-filament-agent-of`), and what that round's tools file is on the turn of the loop
it belongs to. A sub-agent's rounds file on the turn that launched it, as the sub-agent's findings.

---

## 13. Configuration reference

All keys live under `memory` in `config.json` and on Memory → Settings. Saving applies at once: the service reopens
the folder and the engine with the new values.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. Off: the archive still records every conversation, but nothing is recalled, learned or offered as a tool. A config that saved it off stays off. |
| `folder` | `""` | Memory folder; empty = `<data folder>/memory`. Pointing a fresh install at an existing folder adopts it. |
| `engine.autoInstall` | `true` | Install the engine that came with Filament by itself when memory is on, once a run, offline: where it is missing, and over another engine than this Filament's (memory backed up first when the Mnemosyne version changes). Off: nothing installs until you press Install. |
| `engine.embeddings` | `true` | Meaning-based recall with the local embedding model. Off: keyword recall only. Changing it needs a reindex. |
| `engine.bank` | `default` | Mnemosyne bank (a separate database). |
| `autopilot.enabled` | `true` | Recall into requests automatically. Off: archive only. |
| `autopilot.mode` | `conservative` | `conservative`: at most 3 items per turn, never-used items fade after three misses. `eager`: no fade, 8 items. |
| `autopilot.briefingTokens` | `4500` | Budget of the once-per-session briefing, the whole of it — header, tools' line and legends counted — each block in its share (chapter 5.7). |
| `autopilot.turnTokens` | `300` | Budget of the per-message block before multipliers. |
| `autopilot.minScore` | `0.2` | Score floor for engine results (or within 60% of the query's best). |
| `autopilot.tools` | `true` | Offer the eight memory tools to API models. |
| `autopilot.toolIterations` | `4` | Most memory tool rounds per request. |
| `autopilot.cue` | `true` | The one-line cue on a session's first reply. |
| `autopilot.rewrite` | `false` | When a message's own words find fewer than two memories, memory's model suggests 2-3 alternative search words and recall looks again (chapter 8.2). Off until the memory evals show it pays. |
| `autopilot.loadBudgetTokens` | `30000` | Most tokens of past sessions one request may pull through `filament_memory_load`, across every round. |
| `capture.turns` | `true` | Archive every turn; off, a chat Filament composes keeps its own, which memory captures nothing from and reads for nothing else, even once it is on again. |
| `capture.learn` | `true` | Learn at boundaries. Off: nothing is learned, the archive still records; what the agent or you keep with memory's tools and commands is kept all the same. |
| `capture.idleMinutes` | `30` | Idle time that counts as a boundary. |
| `capture.dailyCap` | `200` | Most learned items per day (backfills are exempt). |
| `capture.messageCapBytes` | `1048576` | Largest message stored in full, the pictures and files it carries in base64 not counted. |
| `capture.inputCapChars` | `4000` | How much of each of your messages feeds the search index and the rendered views. |
| `capture.excludeClients` | `[]` | User-agent prefixes that never get memory. |
| `capture.excludeModels` | `[]` | Model-name patterns (`*` syntax) that never get memory. |
| `capture.excludeFolders` | `[]` | Working directories (prefix match) never captured or recalled. |
| `models.summarizer` | `""` | Memory's model (Settings › Memory › Model): a route name or a virtual model name (chapter 19.9), first for every memory call. Empty = not set: each call takes the chat's compaction model, else the chat's own, else the most recently active chat's (chapter 9.1) — never the cheapest by itself; `off` = none: nothing is learned, the curator works by rule alone. |
| `models.effort` | `""` | The effort memory's calls are sent at. Empty = low; `model` = the model's own; else a level. |
| `curator.enabled` | `true` | Run the curator: a pass once a project is due (something learned since a pass `everyHours` old), and on `@mem curate`. Off: no passes. |
| `curator.usesModel` | `true` | The curator works with memory's model. Off: by rule alone (the steps that need no model still run, and no dossier is written: the last one stays, and a project with none has it rendered from its memories by kind). |
| `curator.everyHours` | `6` | Hours a project's last pass (before its first, its first memory) must be old before the next runs. |
| `curator.maxCalls` | `20` | Most model calls one pass makes; the dossier's call is kept for it where it will write. |
| `commands.enabled` | `true` | Answer `@mem` commands locally. |
| `commands.prefix` | `@mem` | The command prefix. |
| `backups.enabled` | `false` | Daily backups. |
| `backups.folder` | `""` | Destination folder (a Google Drive for Desktop or OneDrive folder). |
| `backups.hour` | `3` | Local hour of the daily backup. |
| `backups.keep` | `14` | Backups kept. |
| `privacy.encryptArchive` | `true` | Encrypt archived bodies. Applies to new folders; an archive keeps the mode it was created with. |
| `privacy.searchIndex` | `true` | Keep the capped plaintext search index. Off: session search is disabled. |
| `rules.act` | `[]` | Ids of learned rules allowed to ride along with matching tool results. |

The engine also receives fixed settings Filament does not expose: scope `global`, cross-session recall on, working
memory time-to-live 87,600 hours, the engine's own auto-sleep off, its model refresh off (chapter 9.4), LLM base URL
`http://127.0.0.1:<port>/memory-engine/v1` (Filament's own address: on another listener, the one it listens on) with Filament's inbound key and the summariser as its model.

---

## 14. Data on disk

### 14.1 The archive (`archive.db`)

SQLite in WAL mode (readers never block the writer). Tables:

| Table | One row per | Columns worth knowing |
|---|---|---|
| `schema_meta` | fact about the store | `key`, `value`: the archive's version, the encryption mode, the feed's epoch, the engine's fence and adoption, the curator's nightly mark |
| `projects` | working folder | `id` (12 hex chars), `cwd`, `name`, `first_seen`, `last_seen`, `settings_json` (the project's settings layer) |
| `chains` | session | `id`, `key` (unique chain key), `project_id`, `client`, `model`, `title`, `started_at`, `last_at`, `turns` (finished), `parent_id`, `state_json` (summary, done, open, next, status), `briefing` (exact text placed), `meta_json` (muted, briefingIds, learnedThrough, learnedAt, lastLearn, import info) |
| `chain_windows` | in an older archive alone: a chat `@mem attach` filed under another session | `key` (the chat's conversation key, primary key), `chain_id`, `client`, `created_at` — nothing reads or writes it and a new archive has none: a chat's key resolves to its own session alone |
| `local_texts` | text Filament wrote itself in a session | `chain_id` + `hash` (SHA-256 of the normalized text, primary key), `kind` (`reply`, `prefix`); no text is stored |
| `blocks` | memory block given to one message of a session | `chain_id` + `hash` (the message's content hash, primary key), `block` (the exact text appended), `nth` (which occurrence of that hash it was created for). Uncapped on purpose: every stored block must re-attach byte for byte or the provider's prompt cache breaks. |
| `turns` | user message and its consequences | `chain_id`, `n`, `started_at`, `ended_at`, `request_ids_json` (every leg's request id), `model`, `upstream`, `user_hash`, `final_hash`, `work_json` (hashes of tool calls, results and thinking in order), `input_chars`, `output_chars`, `summary` (learner's one line) |
| `messages` | distinct message | `hash` (SHA-256 of the JSON), `role`, `kind`, `bytes`, `truncated`, `body` (encrypted), `created_at` |
| `compactions` | summary or fold standing in for turns | `chain_id`, `from_turn`, `to_turn`, `summary_hash` (none for a fold), `kind` (`client`, `plain` at the compaction line, `manual`, `autofit`, `brief` for a fork's summary, `fork` for a fork's folded copy, `compaction` and `continuation` imported; older rows may say `trim`), `window` (who compacted: `harness`, or the compacting window's key), `method` (summary, fold, own — a coding agent's own compaction; older rows may say trim), `detail_json` (what it did, in figures) |
| `trim_slices` | the slice pass's summary of one slice | `hash` (the slice's, primary key), `summary_hash`, `tokens`, `chars`, `model`: a slice read again is summarized without another call |
| `links` | typed edge | `src`, `dst`, `type` (`continues`, `loaded`, `child`), `weight` |
| `items` | learned item | `project_id`, `chain_id`, `turn_id`, `kind` (fact, rule, convention, preference, decision, thread, procedure), `text`, `status` (inferred, confirmed, dismissed, superseded), `importance`, `memory_id` (engine id once mirrored), `origin` (person, correction, capture, model, learner, import, owner, subagent, agent), `superseded_by` (the replacing item), `invalid_reason`, `invalid_at`, `slot` ("subject · attribute"; a procedure's is "how to · <goal>"), `slot_value`, `slot_multi` (null for an unkeyed item) |
| `item_events` | change to an item | `item_id`, `at`, `action` (created, status, verified, evidence, kind, anchor, contested, suspected, cleared, weighed, fired, followed, kept, closed, moved; slot, the curator's or a correction's; the curator's unkeyed, distinct, checked, undo), `by`, `reason`, `detail_json`, `run_id` (the curator pass that made it), `undone_at` (set when its pass was undone: kept, no longer counted). What `detail_json` holds, by action: <br>• created: the status, the kind, the slot and its value, and a finding's finder (a sub-agent's id, type and model; an outside agent's client, `MCP`);<br>• a status change: from, to, replacement, the finder of an agent that made it (M7-D47), and `quiet` where the sessions shown it hear nothing of it, no erratum nor a brief's line (a merge, a thread expired, a finding lapsed);<br>• evidence: the chain, the turn, and the words when they differ;<br>• kind: from, to;<br>• anchor: the file, its new state and the old one, and the symbol;<br>• contested: the value's kind, the value, and what the environment says;<br>• suspected: the chain, the project, the turn (its id and number) and why, as the learner found the session showed it wrong (or, written by a correction, its id);<br>• cleared (the curator judged a suspicion to be about something else, or its correction was retired since): what cast them (`s:<chain>` for a session's finding, `i<n>` for a correction), and `retired` for the latter; the suspicions before it stop counting;<br>• weighed (the curator judged a suspicion and it still counts): the verdict (`wrong` or `unsure`), the corrections, and `asked` when your word was asked about;<br>• fired (said at the moment of action): the chain, the turn, the conversation when it is not the session's own (a sub-agent's id), and the trigger's shape, words and right way, or a thread's file;<br>• followed and kept (the right way taken after a reminder, or with none said in the conversation): the same as fired;<br>• closed (a thread a session finished, by the learner or a model's `filament_memory_close`): the chain, the turn, and the finder of a sub-agent or agent that closed it;<br>• moved (its session moved to another project, by you; an older row by Filament: a chat's notes that followed it into the session `@mem attach` filed it under): from, to, the session;<br>• slot: from, to. |
| `item_anchors` | file or folder a claim names | `item_id` + `path` (primary key), `name` (as the claim names it), `kind` (file, folder), `hash` (sha1; none over 1 MB or with no baseline), `size`, `mtime`, `head` (git commit), `symbols_json` (the symbols the claim names that the file held), `state` (ok, changed, gone, symbol, as last seen), `at`, `checked_at` |
| `item_triggers` | trigger of a claim | `item_id` + `tool` + `shape` + `args` (primary key), `unless` (the right way, or null), `source` (`words`: read from the claim's words; `seen`: what the miner saw), `at`; indexed by tool and shape for the lookup on each call (chapter 5.13) |
| `curator_runs` | curator pass | `project_id` (null = the global memories), `reason` (learned, turn, manual; nightly on passes before 2026-11), `model`, `calls`, `actions`, `started_at`, `ended_at`, `error`, `detail_json` (what each step did), `undone_at`, `undone_by` |
| `inbox` | memory's question for you | `project_id`, `kind` (retire, restore, close), `key` (unique: a question is raised once, ever), `item_ids_json`, `proposal_json`, `reason`, `run_id`, `status` (open, accepted, rejected, withdrawn), `created_at`, `decided_at`, `decided_by`, `outcome_json` |
| `dossiers` | version of a project's dossier | `project_id`, `version`, `sections_json` (titles and lines, each with its cites), `cites_json`, `basis` (what it was written from, hashed), `model`, `run_id`, `created_at`, `undone_at` |
| `outcomes` | how one finished piece of an agent's work went (chapter 7.4) | `at`, `chain_id`, `turn_id` (the session's turn it ended on; null for your own sub-agent launch), `request_id` (a turn's or a sub-agent run's own), `kind` (turn, subagent), `agent` (a sub-agent's type; null for a turn of the agent loop), `model`, `did` (tests, edited, ran, delegated, read, answered), `counts_json` (calls of each kind), `ended` (done, failed, stopped), `corrected` (user, or null), `corrected_at`, `rounds`, `calls`, `tokens_in`, `tokens_out`, `usd` (null with no price known), `ms`. Indexed by session and turn, and by time; goes with its session, pruned after 365 days. No words |
| `claim_feed` | change a claim's card shows, or a dossier's, or a project gone | `id` (never reused, even after a delete or a prune), `at`, `item_id` (null for a dossier and a project gone), `action` (an item event's, or `asked`, `decided`, `anchored`, `triggers`, `deleted`, `dossier`), `project_id` and `chain_id` (the claim's, as it stood), `from_project` (where a moved claim came from), `by`. Kept 30 days. The feed's name, its `epoch`, and the newest id a prune took are in `schema_meta` (chapter 18.4) |
| `injections` | what one request received | `request_id`, `chain_id`, `turn_id`, `kind` (briefing, turn, erratum, pitfall, thread; brief, a sub-agent's, on the turn that launched it with no request id), `ids_json`, `tokens`, `used` (null, 0, 1); indexed by chain for the per-request file check of what a session was shown |
| `injection_ids` | memory one request carried | `injection_id`, `memory_id` (the id as shown: `i<n>`, `e:<id>`, `s:…`, `canon:…`), `used` (null, 0, 1: judged per memory) |
| `memory_last_used` | when each memory was last used (chapter 7.2) | `memory_id` (as shown), `at` (when the use was judged, or credited by a search or a later reply) |
| `item_near` | the memories the curator's merge looked up by meaning (chapter 9.3, step 5) | `item_id`, `run_id` (the pass: undone, looked up again), `at` |
| `pages` | each topic's page, versioned (chapter 9.3, step 13) | `project_id`, `topic` (`about:<subject>`, `dir:<folder>`), `slug` (its name), `title`, `version`, `sections_json`, `cites_json`, `sources_json` (the memories it was written from, each with a hash of its words), `basis`, `model`, `run_id`, `undone_at` |
| `withheld` | memory's exchange the client never saw | `anchor` (a tool call's id or a thinking signature's hash, primary key), `entry` (the exchange's fingerprints and its withheld messages' hashes), `created_at`; the `withheld` stage puts the exchange back on the wire |
| `engine_outbox` | engine write about an item | `item_id`, `op` (mirror, invalidate, restore), `args_json`, `attempts`, `last_error`, `next_at`, `done_at`, `dead`: written with the archive change it follows, sent in order per item, retried with backoff |
| `fts_text` | searchable copy | FTS5 over `text` with `chain_id`, `turn_id`, `role`; user inputs and final answers, capped at `inputCapChars`; the one plaintext copy |

Everything is written inside one transaction per public call (`BEGIN IMMEDIATE`), so a crash never leaves half a turn.

### 14.2 The engine (`mnemosyne/mnemosyne.db`)

Mnemosyne's own schema: `working_memory` (what Filament stores: content, embedding, importance, source, scope,
veracity, metadata JSON, pinned flag, recall counts, `valid_until` and `superseded_by` — set when Filament retires or
fences a row, cleared when it restores one), `episodic_memory` (the engine's own summaries, fenced), `canonical_facts`
(owner, category, name, body, confidence, version, valid_until), `triples`, plus FTS5 shadow tables and `sqlite-vec`
virtual tables for the embeddings. Filament never writes this file directly; every change goes through the sidecar.

### 14.3 Files

| File | Holds |
|---|---|
| `<memory folder>/memory.json` | `version`, `createdAt`, `deviceId`, `encrypted`, `lastOpened`, `bank`, `lastBackupAt`, `lastBackupDir` |
| `<memory folder>/mnemosyne/config.yaml` | Rewritten before every engine start from the environment Filament passes (data dir, blob and backup dirs, embedding cache, default scope, cross-session, TTL, auto-sleep, model refresh and its auto-apply, LLM enabled, base URL, model); **never** the API key. Mnemosyne reads this file before its environment, which is why Filament owns it. |
| `<data folder>/secret.key` | 32 random bytes, base64. Encrypts the archive bodies and the secrets in `config.json`. Losing it makes the archive unreadable; back up the data folder. Filament refuses to replace an unreadable key. |
| `<data folder>/memory-engine/engine.json` | Install record: uv and Python versions, Mnemosyne version, embeddings flag, embedding model, install log. |
| `<data folder>/requests.jsonl` (+ `.1`) | Every request record, including `memory` (counts and ids), `memoryTrace` (chapter 18) and `memoryFor` (memory's own calls). Rotates at 50 MB. |
| `<data folder>/daily-usage.json` | Per-day totals of client traffic; memory's own calls excluded. |
| `<data folder>/memory-usage.json` | Per-day totals of memory's own model calls, rows split by purpose. |

### 14.4 What a request record carries

`rec.memory`: `chain`, `turn`, `position`, `client`, `signals` (names only), `briefing` (item count), `injected` (item
count), `tokens` (estimate added), `ids` (item ids, never text), `tools` (offered or not), `toolRounds`, `toolCalls`,
`cue`, `loaded`, `muted`, `command`. `rec.memoryTrace`: the timeline (chapter 18). `rec.memoryFor`: `{ purpose,
chain }` on memory's own model calls. `rec.changes` holds the `memory: …` notes. The list endpoints only flag
`hasMemoryTrace`; the detail endpoint carries the trace.

---

## 15. Privacy and security guarantees

1. **Memory content never enters request records, logs, the events stream or the trace.** Records carry counts,
   ids, scores, durations and reasons. The only text from your side that reaches a record is the search query built
   from your own message, and only after every token that looks like a key (`sk-…`, `ghp_…`, `AKIA…`, `eyJ…`, any
   32-plus-character run) is removed.
2. **The archive is encrypted at rest** (AES-256-GCM, per-message random IV, authentication tag) with a key that never
   leaves your data folder. The search index is the one plaintext copy, capped per message, and can be turned off.
3. **Secrets are filtered before anything is learned**: the learner drops items matching key and password patterns;
   imports run Filament's secret redaction over every message before archiving; the engine's `config.yaml` never holds
   the API key.
4. **You can keep memory out**: per request (`x-filament-memory: off`), per chat (`@mem off`), per client, model
   pattern or folder (the exclude lists), or entirely (`enabled: false`, which leaves everything on disk).
5. **Filament's own traffic is never captured**: internal user-agents, memory's own model calls, housekeeping requests,
   pings.
6. **Nothing leaves the machine.** The engine is a local child process, the embedding model runs on your CPU, the only
   network calls are the ones your requests were already making to their providers, plus the cheap-model calls for
   learning, which go to a provider you chose.
7. **Memory's door for other agents (`/mcp/memory`, chapter 10.1) is shut to the network and to web pages.**
   - With an inbound key set, it asks for one, whatever `requireAuth` says.
   - With none set, it answers this machine only: Filament's own calls, and a program here with its owner key (`owner.key`) where `server.loopbackTrust` is `token`, the default.
   - A browser page from elsewhere is refused by its `Origin` before any key is read.
   - A caller with an inbound key that could not read every session anyway keeps to the sessions of the project its folder names: `search`, `sessions`, `load` and `brief`, as chapter 12 says.
   - The operation log names the tool, the client and the session, never what was asked or answered.

---

## 16. Imports

Chats you had in other coding agents come in as ordinary archived sessions: listed in the harness's sidebar and on
Sessions, loadable with `@mem load`, and a source for learning. The harness's **Settings › Import** is the place for
it (GUIDE, *Imports*): it lists each agent's chats with how they stand, brings what is new or has grown at **Sync
now** from the agents you switched on (none is until you do), and one chat or a project's from **Browse**. The console's Memory → Settings → *Import past sessions* is the
older door: every chat of Claude Code at a click, and an existing Mnemosyne database.

| Source | Found at | Becomes |
|---|---|---|
| **Claude Code** | `~/.claude/projects/<slug>/<id>.jsonl` | One chain per file, key `cc:<file name>`, project from the chat's cwd. A command Claude Code answered itself is a command turn; work it began with no message of the person's is the agent's own turn. A chat resumed from another carries `meta.resumedFrom` and, when that chat is in the archive, a `continues` link to it. Claude Code's own compaction summaries become compactions of method `own`. |
| **Codex** | `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<time>-<id>.jsonl` | One chain per chat, key `cx:<session id>`. A chat Filament started (`originator: Filament`) is a session already and is passed over. A fork is a fork of its source's chain when that one is in the archive. Codex's compactions become compactions, with no summary where Codex sealed it. |
| **Cursor** | `~/.cursor/projects/<folder name>/agent-transcripts/<id>/<id>.jsonl` | One chain per chat, key `cu:<chat id>`. Cursor keeps no result of a call, no model and no token count: none is written. |
| **Mnemosyne database** | `~/.hermes/mnemosyne/mnemosyne.db`, also inside WSL distributions (`\\wsl.localhost\<distro>\home\<user>\.hermes\…`) | Copied into the engine's database with SQLite's online backup (inside the distro through `python3` when the file lives in WSL, because a WSL file cannot be locked from Windows), merged or, with *replace*, put in place of the current one; then re-embedded (reindex). |

A chain is found again by its key, and a turn by its place and its message's hash, so importing the same source twice
adds nothing and a chat that grew gains only its new turns. An imported chain names no model: each turn keeps the
model that answered it. A chain an import makes is the harness's own: its client and every turn's are `harness`, it
is marked `native`, and it keeps `importedThrough`, the newest turn the agent's copy holds. A chain with a turn after
that one was gone on with in the harness and takes nothing more from its agent: what the agent adds goes to its fork,
key `<chain key>~<turn>`, the chain through the last turn both have with an answer, then the agent's; the chain's
`syncForks` names its forks, so one the person deleted is not made again. A chain an earlier import made, with no
`importedThrough`, is told by its turns: where the agent's copy and the chain first differ while the chain has a turn
there, the agent's turns go to the fork. A chain found again is read, not stamped: its `last_at` moves only where its
turns are written, so one gone on with keeps its own time and its place in the sidebar. Secrets are masked before anything is written. Learning from imported sessions is a backfill
run (chapter 9): a cheap-model call per imported session, more for a long one. The harness's section starts one only
when **Memory reads what is imported** is on (off at first) or at **Let memory read them**; the console's door has
*learn after importing* ticked. Imports run as background jobs with progress, one at a time whichever page started it,
and an import of chats can be stopped: what was written stays. The Overview's Archive card nags until at least three
sessions exist.

---

## 17. Backups and restore

[`memory.backups`] Daily at the configured hour (checked every 60 seconds, once per day), or *Back up now*, Filament
writes `<destination>/filament-memory-<timestamp>/` holding `archive.db.gz`, `mnemosyne.db.gz` and `memory.json`,
each copied with SQLite's online backup API first (a plain file copy of a WAL database can be inconsistent), gzipped,
with a `manifest.json` listing sizes and SHA-256 checksums. Rotation keeps the newest N. A scheduled backup that fails
is tried again at the next check of its hour, and leaves no folder behind. **Restore** waits for the engine's process to
end, then replaces the databases from a chosen backup whole or not at all — each copied in beside the one it replaces
first, so a damaged backup or a database something still holds leaves memory as it was — and restarts; a manifest that
names a path rather than a file of its own is refused. The engine software is not part of a backup; a fresh
install pointed at a restored memory folder adopts it. Memory → Overview and Settings show the destination, the last
backup and the list.

---

## 18. Observability

### 18.1 The trace

Every request with memory on gets a `MemoryTrace`: a list of steps, each with `at` (milliseconds since the request
arrived), `phase`, `depth` (nesting), a name, `ms` for steps that time something, and details (counts, ids, scores,
reasons). The trace travels through the pipeline in Node's `AsyncLocalStorage`, so the brain, the engine wrapper and
the tool loop add steps without passing it around; it is attached to the record when the request finishes.

Phases: **before** (everything up to the upstream call; the sum of the top-level `ms` here is the *blocking time*),
**upstream** (tool rounds, follow-ups), **after** (bookkeeping once the client has its reply), **later** (background
engine writes). Marks: `handed` (when the upstream call started) and `firstByte` (when the reply began).

Step catalogue, in the order they usually appear:

| Step | Phase | Details |
|---|---|---|
| `situate` › `situated` | before | client, project, position, session source (conversation id or fingerprint), user message count, newest kind, system chars |
| `memory stays out` | before | why (opt-out header, excluded client/model/folder, internal, housekeeping) |
| `memory command @mem <verb>` | before | the command answered locally |
| `prepare` | before | tokens added, briefing items, turn items; children below |
| `session lookup` | before | session id, new, turns so far, muted, briefing stored |
| `signals read` | before | position, signals, keyword and code-token counts, explicit remember, the filtered query |
| `compaction request` | before | the reply will be archived as a compaction |
| `turn archived` / `turn not archived` | before | turn number, new or a leg |
| `earlier blocks re-attached` | before | blocks re-attached, stored |
| `autopilot stops here` | before | muted, autopilot off, or a coding agent |
| `deferred tool results attached` | before | tokens |
| `memory at the moment of action` | before | calls, pitfalls, threads, rules considered and matched, tokens |
| `past session loaded` / `past session load failed` | before | session, view, tokens |
| `linked to the previous session` | before | previous session, after compaction |
| `briefing built` › `in every project`, `retrieve`, `engine recall`, `engine results filtered`, `learned items scanned`, `past sessions searched`, `ranked`, `lineage walked`, `recent sessions of the project` | before | rows, kept, under floor, faded, top score, floor, hits, candidates, duplicates, sources; lineage: how many ancestors |
| `briefing placed` / `briefing reused` / `briefing empty` / `no briefing` | before | items, tokens, sources, cue |
| `turn budget` | before | tokens, base, why |
| `query rewritten` / `query rewrite skipped` | before | variants, ms; or the error that dropped it |
| `related memory looked up` › retrieval children | before | as above, mode `turn` |
| `turn block attached` / `nothing attached` / `turn block re-attached` / `turn block skipped` / `no turn block` | before | items, tokens, sources, or why not |
| `memory tools offered` / `memory tools not offered` | before | tools or why not |
| `tools added to the request` | before | count, format |
| `handed to the upstream` | upstream | upstream id |
| `the model asked memory` › `tool <name>` › retrieval children | upstream | round, calls, result chars |
| `upstream asked again with the results` / `follow-up request failed` | upstream | ms to the follow-up's first byte |
| `memory results deferred` | upstream | calls |
| `after the reply` › `compaction archived`, `tool work archived`, `reply archived`, `use judged`, `learning queued` / `learning starts now` / `learning off` | after | output chars, injected, used, verdict, session, when, model |
| `cue placed` | after | |
| `engine <op> · background` | later | the fire-and-forget write completed |

Every `engine <op>` step carries `ms`, `ok`, `rows` for list results, `started` when the engine had to start first
(a cold start), and `error` on failure. At most 200 steps are kept per request.

### 18.2 The benchmark (*Memory cost per request*)

On Memory → **Activity** (`#memory:activity`). Since W9, Filament's operations are also on Traffic → **System**, and
memory's model calls on Traffic → **Memory**.

Over the recent traced requests: requests with memory versus without; median, 95th percentile and worst blocking
time; blocking share of total request time; engine calls and average time per call; average tokens added; tool rounds
and their time; how many judged replies used the added memory. The per-request table links each row to its timeline.
Commands and requests where memory stayed out are listed but excluded from the statistics.

### 18.3 Memory's own model usage (Traffic → **Memory**)

A record is memory's own when it carries `memoryFor`, set from the `x-filament-memory-purpose` header the learner
sends, memory's user agent (`filament-memory/…`), or the `/memory-engine/` prefix the engine calls through. Those
records are excluded from Traffic, Usage, the general daily totals, the timeline and the upstream statistics, and
counted in `memory-usage.json` instead, split by purpose (`learn`, `curate`, `recall`, `signal`, `compact`,
`engine`) and by upstream and model.

### 18.4 Following memory's changes (the claims feed)

Every change a claim's card shows is a row on the **claims feed**, written in the same transaction as the change.
That covers:
- a claim filed, its standing changed, corrected, said again, keyed;
- its file changed, said at a call, followed or kept without a reminder;
- moved to another project, deleted by you;
- its triggers read anew, its first anchors;
- a question about it asked or settled;
- a dossier written or undone;
- a project deleted (`deleted`, with no claim, in that project).

A change rolled back leaves no row. The feed keeps 30 days.

- **`GET /api/memory/claims/stream`** (server-sent events) gives the changes as they happen:
  - first `hello`, `{ type: "hello", last, gap }`, its `id:` where the stream starts;
  - then each change: `id: <epoch>:<n>`, data `{ type: "change", id, claim, action, at, by, project, session,
    from? }`. `claim` is null for a dossier and a project gone; `from` is where a moved claim came from. Never a
    claim's words or a reason: its card is read for those.
  - **Where it starts:** after `Last-Event-ID` (a browser's reconnect sends it) or `?since=<id>`, else after the
    newest. An id it cannot resume from says `gap: true`, and the stream starts after the newest: the reader reads
    what it shows afresh. That is an id from another store (you reset yours), one older than the 30 days kept, or one
    past the newest.
  - **`?project=<id>`** gives that project's changes, the global claims' and a claim moved out of it. An unknown
    project is 404; memory not started, 503.
  - **It never skips a change.** It reads the feed at its own pace and waits for a slow reader. Memory reopened on
    another store says `{ type: "reset", last }` and goes on from there. A comment line every 25 s keeps it open.
- **`GET /api/memory/claims/<id>`** reads one claim's card as the claim browser draws it, by any id a line shows
  (`i12`, `12`, an engine twin's `e:…`). Words from a past session or an always-allow offer are no claim,
  and the refusal says which.
- **The pages** hear the same changes on the events stream they already hold (`/api/events`, type `claims`), so a tab
  never spends a second connection on them. Each reads again only what a change touches (chapters 19.5, 19.11,
  19.12). When it may have missed one (a skipped message, a reconnect, memory opened again), it reads everything it
  shows. A page showing a project deleted elsewhere goes where it opens.

An agent that follows memory opens the stream with `?project=`, keeps the last `id`, and reads the card of a claim it
cares about when a change names it. Like every admin route, it answers this computer, a device paired in
Settings › Remote access (a command line's token as a bearer token), or `server.adminToken` as a bearer token:

```bash
curl -N "http://127.0.0.1:<port>/api/memory/claims/stream?project=<id>"
```

---

## 19. The console and the harness, element by element

### 19.1 Home

**Where you left off**: the five most recent sessions (`/api/memory/sessions?limit=5`): title (from the learner, else
"untitled session"), id, client, turn count, project name, last activity, and the end state: *N open* when the learner
left open items, *wrapped up* when there is a summary with nothing open, *no end state yet* before any learning run.
Click a row to open it on Sessions. **Latest** lists client requests only; memory's own calls are not there.

### 19.2 Traffic

The list holds client requests only. Open one for:

- **What the model knew**: session (link), turn, position, client, signals, briefing items, attached this turn,
  memory tokens, tools offered, tool rounds and calls, loaded session, muted, the count of ids, and every
  `memory: …` note. A memory command shows "answered by Filament".
- **Memory timeline**: the stacked bar (memory before the call, upstream wait, reply, memory after), the summary chips
  (before the call and its share, engine calls and time, tokens added, tool rounds, after the reply, model calls by
  memory: none during a request), and the step table grouped by phase, with `at`, the step, `took` and the details of
  chapter 18.1. Engine steps carry an *engine* pill and *cold start* when the engine had to start.

### 19.3 Usage

Client traffic only, per model and upstream and per day, from `daily-usage.json`. Memory's own model calls are kept
in `memory-usage.json` and listed on Traffic → **Memory**; the Usage page adds the two up for you rather than merging
the files, so "your spend" keeps meaning your spend.

### 19.4 Memory → Overview

- **Engine card**: the state pill (*ready*, *starting…*, *idle* = installed and waiting for the first request that
  needs it, *degraded* = three failures in a row, or an engine left stopped because it stalled again each time it started (Restart starts it), *not installed*), counts from the engine's `hello` (**Working**
  memories, **Episodic** = the engine's own summaries, never served, **Facts** = knowledge-graph triples), version,
  embeddings on or off, Python version, last memory time, engine calls since start and the child's pid, the last
  error, and where it was installed from (the copy that came with this Filament, a copy that came with another, or a
  download). Buttons: *Install memory engine* (uv, Python 3.12, Mnemosyne and the 220 MB embedding model into the engine
  folder, offline from the bundle that came with Filament; without one, the card says why there is nothing to install),
  *Install this Filament's engine* over another engine than this Filament's, *Probe* (a `hello` now, starting the
  engine if idle). There is no Update: a new engine comes with a new Filament. While an install runs, a line above
  every console page says how far it is.
- **Archive card**: **Sessions** (chains) and projects, **Turns** and compactions, **Messages** and their bytes,
  **Learned items**, **Injections**; folder path, created date, device id; whether bodies are encrypted. Until three
  sessions exist, an *Import past sessions* nag.
- **Autopilot card**: mode, briefing budget, per-turn budget, score floor, tools and rounds, cue; the note that the
  model's cost is on Traffic → Memory.
- **Backups card**: destination, hour, keep, last backup, list; a warning until a destination is set.
- **What changed · last 24 hours**: from the injection log: briefings placed, turn blocks attached, tool calls the
  model made, tokens added, and *picked up* = judged used / judged, with the unknown count.
- **How models did** (chapter 7.4): pickers for the workspace (*Every workspace* or one), the window (7, 30 or 90
  days, or a year) and the kind of work (*All*, *Turns*, *Sub-agents*). A row per model and kind: its
  runs, *Held* as a share with a bar of how its runs ended (held, done then corrected, failed, stopped), what went
  wrong in words, median *Rounds* and *Time*, the cost of *A run* (over the priced runs) and in all. Under it, a line
  per thing its runs did (*Ran tests*, *Edited files*, *Ran commands*, *Delegated*, *Read only*, *Answered*) with its
  own held count and bar. A pick reads again; a read overtaken by a newer pick is dropped. With nothing in the window
  it says so, and when each kind of work is kept.

### 19.5 Memory → Memories

The claims, the questions about them and the engine's own tools, top to bottom. The page acts as the owner, with no
session open (the harness's pages act as the session they show).

- **Memories**: the claim browser, the same as the harness's Settings → Memory (chapter 19.12), in the console's
  style and words.
  - **Where**: everywhere (your global claims) or a project, with how many stand in each; the project with the most
    is picked first (`GET /api/memory/claims/scopes`).
  - **Which**: *Standing*; *To review*, the standing ones memory flags, holds back or is no longer sure of; *Retired*.
    By kind: *Rules* (rules, preferences, conventions), *How to*, *Pitfalls* (the ones with a trigger), *Decisions*,
    *Facts*, *Threads*. A search narrows by words, each anywhere in the claim, or by an id (`i12`). Each count is
    what that choice would list (`GET /api/memory/claims?state=&kind=&q=&project=`, at most 200 rows and a *more*
    count).
  - **Each claim**: its kind, its words whole, its flags (*file changed since*, *in question*, *said otherwise later*,
    *held back from recall*, *would replace iN if you say so*, *replaced by iN*), its trigger in words ("On `npm test`
    · the right way: `env -u CLAUDECODE` · said 3 times · followed 2 times · kept 1 time without a reminder"), its id with how it is known and `✓n` for
    the sessions behind it, the sub-agent that found it (`sa_… (reviewer)`: its card's tag) when one did, and how sure memory is
    (amber under the line recall leaves out, chapter 1.4).
  - **Actions**: *Confirm* when it says something new (a claim neither confirmed nor your own word yet, or one whose
    file changed since: a Confirm checks it against its files afresh); *Correct* (new words replace it, the old kept
    as history, `POST /api/memory/items/<n>/correct`); *Retire* (it is not true); *Restore* on a dismissed one (it
    holds after all, `POST /api/memory/items/<n>` with a status); *History* opens its timeline under the row (`GET
    /api/memory/items/<n>/history`). A retired claim is struck through. One *held for your answer* (chapter 1.4,
    *Slot*) is not: it is not untrue, it waits on the question below, where it is answered, so it has no Restore.
  - **Live** (chapter 18.4): a change memory makes elsewhere shows here within a moment. That is the learner filing a
    claim, the curator retiring one, a reminder firing, or another page correcting one. Only what it touches is read
    again:
    - the counts, on a change that can move one;
    - the list, on a change in the scope shown or to a claim it lists;
    - the questions, when one is asked or settled there;
    - an open history, when its claim changed.

    While you correct a claim, the list and its histories wait, and are read once you save or cancel: your words are
    never replaced under you. The project shown, deleted in another tab, sends the tab where it opens (the project
    with the most claims, else everywhere), once you are done. *Refresh* reads everything again.
- **Memory asks · N**: memory's questions about the scope shown (chapter 9.3): what memory would do, why, when it
  asked; *Accept* or *Reject* in place.
- **Search memory**: retrieval in `search` mode (the claims, the engine's copies of them and the archive's matching
  turns, no fade); a session result links to the Sessions tab.
- **Remember something**: words, a kind and where (everywhere or a project); stored as your word, a confirmed claim
  with its copy in the engine (`POST /api/memory/remember`). A how-to must read "How to <goal>: 1. <step> 2. <step>".
- **Maintenance**, on the engine's own database: *Hygiene audit* (lists stale or noisy rows without changing
  anything), *Diagnose* (database, embeddings, vector index), *Rebuild embeddings* (needed after switching the
  embeddings setting). Tidying the claims is the curator's (chapter 9.3).
- **Identity facts**: the facts about you that hold in every project, each a memory of yours of no project in a slot
  about you, by its name (`GET`/`POST`/`DELETE /api/memory/identity`): setting a name again corrects its memory (or
  adds one beside the others, where the slot holds several values), and delete retires the row's own memory, by its
  id; six at most join every briefing (chapter 5.7, step 3). A fact a project learned about you comes here once you
  keep it everywhere (chapter 9.3, step 12).
- **Always-allow offers**: when you allow the same call in a project often enough, memory offers to allow it always
  there (*Offered*, *Always allowed*, *Dismissed*). These are not claims: an always-allow only spares the question.

### 19.6 Memory → Sessions

- **Search** by words you typed (FTS over inputs and final answers); empty = most recent 40. A **project filter**
  (set from the Projects page) narrows the list to one folder and shows a pill with a clear button. Each list entry:
  title or "untitled session", id, date, client, turns, a **learning pill** — green `learned · N items` once the
  memory's model has been through the session (hover for when; N counts its learned, not dismissed, items), amber
  `waiting` while it has not been distilled, red `learn failed` if its last pass errored — then *N open*, the
  end-state summary, and matching snippets with turn numbers.
- **Detail**: title, id (copy), status pill, and **Learn now** — force-runs the learner over this session at once
  (title, end state, turn summaries, items) even if it is not idle; a manual pass re-reads from turn 1, dedupes
  what is already known instead of duplicating it, and is exempt from the daily learning cap; **move to project** —
  re-file a session (with its learned items) under the project it belongs to, for chats whose working directory
  accidentally created a phantom project; **Delete** — removes the session for good after a confirmation: its turns,
  learned items, lineage links and injections go, message bodies shared with other sessions stay, and what the
  engine learned from it is forgotten there; project, client,
  model, started, last activity, turns, *continues*
  (parent link), muted; the end state (summary, open, next, done); **Lineage** — the session's family as a graph:
  ancestors to the left, later sessions to the right, solid edges for `continues`/`child`, dashed for `loaded`,
  the current session highlighted; click a node to open it (the same walk the briefing's arc line uses, plus the
  sessions that continued this one); **Load it into a chat** with the exact `@mem load
  <id> [view]` command to copy; the **Rendered** view with a view switch (chat, summary, full, compact, lineage), how
  many turns fit the 8,000-token preview budget and the token estimate; a **turns table** (#, when, took, input and
  output chars, tool work count, the learner's one-line summary) whose **rows open in place**: the user message, the
  final answer and the work between them as capped previews (`GET /api/memory/turns/<id>`); **Compactions** as
  expandable entries showing the stored summary text.

### 19.7 Memory → Activity (`#memory:activity`)

**Memory cost per request** (chapter 18.2), **Learning runs** (when, session, reason, model calls, items, deduped,
took, result: learned with title/state, skipped with the reason, or failed), then **Recent injections**: one row per
briefing or turn block placed, with request link (opening the request shows its memory timeline — every decision),
session link, turn, an **items** button that expands to the actual items injected, resolved from the archive
(`POST /api/memory/injection-items`), tokens and *used* (yes / no / unknown, chapter 7.2). A line points to LLM usage
for the model calls themselves.

### 19.8 Memory → LLM usage (`#memory:usage`)

Memory's own model calls (chapter 18.3): a period picker (today, yesterday, 7 days, 30 days, all time, custom) and CSV
export; cards for calls, tokens in (fresh, from cache, written to cache), tokens out, cache hit rate, average call
time and first byte, cost; **By purpose and model** (learning versus engine, per model and upstream, with failures,
tokens, cache hit, average call and cost); **By day** (click a day to select it); **Recent calls**, the same request
table as Traffic, each opening the ordinary request drawer with its trace.

These calls also appear on **Traffic** now: its *Requests* tab lists every model call Filament forwarded or made, and
its *Memory* tab is this same set with a purpose filter. What is still kept apart is the **money**: Traffic's list is
one feed, but the durable per-day rollups behind Usage remain two files, so "your spend" keeps meaning your spend and
the Usage page adds the two up for you instead of merging them. Their bodies are not stored by default either — see
`observability.storeInternalBodies` in chapter 18.3 — because a learning or compaction prompt is your conversation text.

### 19.9 Memory → Settings

Sections mirror chapter 13: **Engine and folder** (enabled, folder; the engine controls Install / Restart / Uninstall
act at once; autoInstall, embeddings, bank), **Autopilot**, **Capture**, **Memory's model**
(one picker over *not set*, *off*, your virtual models such as `free-model` built on the Routes page, and every model
of every upstream, a coding agent's included: `models.summarizer`; and a line saying which model memory works with
now), **Commands**, **Import past sessions** (chapter 16, with *Learn from imported sessions* to run a
backfill by hand), **Backups** (settings, *Back up now*, the list with *Restore*), **Privacy**, and a folded **Rules
that act** section (`rules.act`).

### 19.10 Destinations

Not a memory page, but memory's model is a route: any route name, including a virtual model whose failover order
chains several providers' free models, can be chosen as `models.summarizer`.

### 19.11 Memory → Projects

One card per project the archive has seen (`GET /api/memory/projects`): folder path, session and turn counts, how
many memories stand in it (the claim browser's count), when memory last saw it (*Last activity*), and the project's
**dossier** (chapter 9.3): which version the curator wrote, or that sessions open with the project's standing memories
by kind until it writes one. *Show* reads it in place as a session starting now would get it (`GET
/api/memory/dossier?project=<id>`), by section, each line with the claims it cites as chips: a chip opens that claim
on the Memories tab, where it is confirmed, corrected or retired, and the line follows (a dossier is edited through
the memories it cites). *Rewrite now* asks the curator for a pass over the project at once (`POST
/api/memory/curator/run`) and says what it did. The dossier follows memory (chapter 18.4): shown, it is read again
when a claim in the project changes; hidden, its version follows a rewrite. The project deleted in another tab, the
card says so and reads nothing more. *Sessions →* filters the Sessions page to that project; *Memories →*
opens its standing claims; *Settings →* its repo settings (instructions, hooks, privacy). **Delete project** removes the project and everything under it after a confirmation that names the counts:
every session, turn and learned item, its dossier and memory's questions about it (`POST
/api/memory/projects/<id>/delete`). The claims feed says it went (chapter 18.4), so the other tabs follow. Engine twins of its learned items are forgotten; its curator passes stay, as
counts. The intended cleanup for a phantom project born of a wrong working directory:
move the sessions worth keeping to the right project first (Sessions → open one → *move to project*), then delete the
empty husk. The project id shown under each card is the key used in learned items, briefings and the project
filter.

### 19.12 The harness: memory in a session, and Settings → Memory

The harness draws the same memory from the same routes, as the session it shows: what its pages do there is that
session's (its errata spare it, and the history names it).

**The Memory instrument** is the *Memory* pill in the session's strip, once the session exists.
- **The pill** shows how many memories the last turn was shown. A dot in Memory's pink says memory spoke at one of the
  turn's calls; an orange dot says it asks you something. *Muted* is this session's own switch off; *Off* is the
  global one.
- **The popover** reads the turn's memory from the archive (`GET /api/memory/sessions/<id>/turns/<n>/memory`): how
  many memories and tokens, then, each when there is something to show:
  - *At the call*: the pitfalls and threads said on the turn's tool calls (chapter 5.13), with how often, and a check
    mark once the right way was followed.
  - *This turn*: each memory it was shown, where it came in (in the briefing, recalled, in a correction note, at a
    call), whether it was used, how it is known and how sure memory is; *Confirm*, *Correct* (in place) and *Retire*
    on it.
  - *Said this turn*: what the turn filed (with what a sub-agent it launched found, named for it), and what that
    replaced; a learned value held for your answer says so and
    what it would replace.
  - *Memory asks*: the first questions, with *Accept* and *Reject*.
  - The switches for this session: memory itself, recall into each turn, the tools, the briefing; then *Related
    sessions* to load, *Browse memories* and *All memory settings*.

  It closes on Esc, a click elsewhere or another page, and one click opens it again. It follows memory (chapter
  18.4). The turn's memory is read again on any of these:
  - a change to a memory it shows, reminds of, filed or asks about;
  - a memory filed in this session;
  - a question asked or settled in the workspace or for the global memories.

**The note above a reply** says what memory brought into it: "Memory put 2 related items into this turn and found 1
earlier session here:", with *Load* beside each session (`@mem load <id>`).

**Settings → Memory**, in the harness's own Settings:
- **Model**: the composer's picker over every route and an effort chip beside it (`POST /api/memory/models`, with
  `summarizer` and `effort`). Memory's model is first for every memory call, and Settings › Experimental can have it
  name chats too. Not set (*Use the default*), the row says each chat's compaction model, else its own, stands, and
  which model memory calls where no chat is named; the chip says *Low* until another level is picked. Its switch turns
  it off (`off`) and back on (not set). **The curator uses memory's model**: off, the curator works by rule alone
  (`curatorUsesModel`).
- **Other agents**: the `claude mcp add` command that gives Claude Code this memory, at the page's own address, with a
  copy button. Any other client gets the URL and the header (chapter 10.1). The key is named, never shown
  (`GET /api/memory/mcp` says only whether one is asked). With no inbound key set, the command has no header, and the
  row says only this machine reaches it.
- **Where**: *Everywhere* and each workspace, with counts. Narrower than about 600 pixels, the list stands above the
  claims as a row.
- **The workspace picked**, in four views:
  - *Memories*: the claim browser of chapter 19.5. With a pointer, a claim's actions float on its card's top edge while
    it is hovered or focused; on a touch screen they stay at the end of its meta row. *Add* remembers words as your
    word, where the page stands (a rule, preference, decision, fact or how-to).
  - *Dossier*: its sections, each line's claims as chips that open the claim; *Add* and *Rewrite now*.
  - *Questions*: memory's questions, answered in place.
  - *Models*: how models did there (chapter 7.4; *Everywhere* is every workspace), over the last 7, 30 or 90 days or
    a year, of every kind of work or one. A card per model and kind: its tile (turn cyan, sub-agent indigo), its runs, the figures (*held*, median rounds, median time, the cost of a run), the bar of how its runs
    ended, what went wrong and the cost in all, and a line per thing its runs did. The note above the cards says it is
    a record, and that Filament never picks a model by it.
- **Live**, as the console's claim browser is (chapter 19.5). The *Dossier* view reads the dossier again on a change in
  its workspace. A claim being added holds the list as a correction does. The workspace shown, deleted elsewhere,
  sends the page where it opens.

---

## 20. Worked examples

**A. First message of a new Claude Code session in `C:\Filament`: "format this file for me the way I like".**
Situate: client claude-code, project Filament, no session header → fingerprint key, position first. Session lookup
creates chain `k3f9…`. Signals: none; keywords `format file like` → query `format file`. Turn 1 archived. Briefing
built: the facts about you (your name, voice), project line, no canon yet, retrieve mode briefing → engine recall (say 3
rows, 2 kept above 0.2), learned items (0), past sessions (1 hit), ranked 3; recent sessions of the project (2);
placed: 6 items, ~280 tokens, cue prepared. Turn budget 300 (conservative 3); retrieve mode turn → the same
rows, all already in the briefing → *nothing attached*. Tools offered: 5. Handed to the upstream at
about 6 ms. Reply: cue line prefixed. After: reply archived, use judged (used if the reply repeats an item), learning
queued for 30 minutes idle. Traffic drawer shows all of it; Activity gains one briefing row.

**B. Second message in the same session: "now the other file too".**
Same key → same chain, position mid. Turn 2 archived. Briefing reused byte for byte. Turn budget 300; keywords `file`
→ retrieval finds nothing new → nothing attached. The provider's cache keeps the whole prefix.

**C. "What did we decide about the tray restart last time?"**
Turn budget 300, up to 3 items ("last time" changes neither); the query `decide tray restart last time` recalls the decision
item from a past session and the session's turn where you typed about it; a turn block with, say, 3 items is appended
to your message. If the model still wants more, it calls `filament_memory_search("tray restart")`; Filament runs it,
asks the model again, and the client sees one answer with summed usage. Activity shows the turn block and, on the
request, `toolRounds: 1`.

**D. "No, never restart Filament while a chat is flowing."**
Signal `correction` → the reply before counts as corrected; nothing is filed by the words. The agent keeps the rule:
`filament_memory_remember` with `text` "Never restart Filament while a chat is flowing.", `kind` rule and `quote` "never
restart Filament while a chat is flowing". The quote is in your message and says the claim, so the rule is filed as
*user's words*, stored as a learned item and mirrored to the engine, pinned, and it opens every later briefing among
your rules. A client whose model never calls the tool gets it from the learner at the session's next boundary. Listing its id under *rules that act* makes it ride along with the
tool result whenever the model runs a command whose text overlaps it.

**E. Claude Code compacts.**
The compaction request (its system prompt asks for a summary) is recognised: nothing is added, and its reply is
archived as a compaction of the chain; the learner runs on the chain right away. The next request starts with the
summary: a new chain in position afterCompaction, linked to the old one as `continues`, its briefing built from the
summary's keywords. The Sessions page shows the new session with *continues → old id*.

**F. Cursor through ACP: "add a retry to the uploader".**
Situate and prepare run with `captureOnly`: the turn is archived, nothing is injected. Cursor's agent receives
Filament's MCP server and may call `filament_memory_search` itself. After the turn, the final text and the tool calls
are archived. The trace shows *autopilot stops here · a coding agent*.

**G. `@mem sessions migrate 9router` then `@mem load 2 summary`.**
Both answered by Filament without an upstream call (records show `command: true`). The second attaches the session's
summary view (turn summaries the learner wrote) to your next message as a block of kind `load`, and links the two
sessions with `loaded`.

**H. "No, we switched to bun for installs; drop pnpm." (a correction)**
The agent was shown the preference "I always use pnpm for package installs in this project" (`i12`, say) in its
briefing, and corrects it by that id: `filament_memory_correct` with `text` "We use bun for installs.", `quote` "we
switched to bun for installs". The quote is your newer word, so the correction is *user corrected*, and `i12` is
superseded by it, its engine copy invalidated. A later `@mem recall package manager` finds bun and no pnpm item;
another session that was shown the pnpm preference this fortnight opens its next turn with a "Memory correction" line.
Nothing the agent did not name is retired.

**I. "Didn't we already try the bus refactor last week?" (query rewriting, switched on)**
With [`memory.autopilot.rewrite`] on and the base query finding fewer than two memories, the rewriter runs before
the turn block is built: memory's model gets the message and returns
`{"queries":["generic event bus migration","action bus refactor","event loop work"]}`. The base query (from your words: `bus refactor`) plus the two surviving variants are each sent to the
engine recall and the archive search; a session titled "GenericEventBus migration" that the base query could not
reach now matches. The trace shows `query rewritten` with the variants and `retrieve` with all three queries.

**J. A multi-session effort, continued (lineage).**
Monday's session in `C:\myapp` is compacted by the client; Tuesday's chat starts with the summary → new chain linked
`continues` to Monday's (example E). Wednesday you open a third chat and type "back to it": its briefing includes
the arc line — `This session continues an effort (3 sessions so far): session a1b2 "Rate limiter" — token bucket
done → session c3d4 "Redis dropped" …` — and the sessions already in the arc are not repeated under recent sessions.
`@mem load <Wednesday's id> lineage` (or the model calling `filament_memory_load` with view `lineage`) renders all
three, oldest first, each as a summary with its end state, within the budget.

**K. The same mistake, not made again (a pitfall).**
Monday, in Claude Code: the model runs `npm test`; it fails with exit 1, "nested Claude Code session detected". It runs
`env -u CLAUDECODE npm test`, which works. On the next leg the proxy tells the observation bus both results; the miner
files the fact "`npm test` failed here (exit 1: …); `env -u CLAUDECODE npm test` worked." with the trigger `npm test`,
right way `env -u CLAUDECODE`. It is learned once, so it is not armed: Tuesday's session makes the same mistake and
works around it the same way, and the miner adds that session as evidence instead of a second claim. Wednesday, the
model runs `npm test` bare: on that call's result rides `Memory on the tool call the model just made (Filament): - [memory
i58 · inferred] …`, and its next call is `env -u CLAUDECODE npm test`, which is not reminded. Had you said "don't
run `npm test` bare here, run it with `env -u CLAUDECODE`" on Monday, it would have fired on the next call that made
the mistake: your word needs no second session. The trace shows `memory at the moment of action · pitfalls: 1`; the claim's history
shows each `fired`.

**L. Unfinished work comes back where it is (an open thread).**
A session ends with the retry in `src/net/client.js` half done. The learner files the state's open line "the retry in
src/net/client.js still drops the last attempt" as a thread, anchored to that file. Two days later a session about
something else opens `src/net/client.js`: on the read's result rides `[memory i61 · inferred · open thread on
src/net/client.js] …`, once that session. That session finishes the retry; its learning run is shown the thread by id
and puts it in `state.closed` with what did it, so it is dismissed (`done: …`) and never comes back. Had you said the
thread yourself, `@mem inbox` would ask you instead.

**M. `@mem procedure How to release: 1. npm run build 2. npm run docs 3. npm publish`**
Memory keeps a procedure in the slot `how to · release`, confirmed (the agent's `remember` of kind procedure, quoting
you, files the same as *user's words*). The dossier lists `How to release (3 steps)`. A later "fix the npm warning in
the build" does not bring it (a step's word is not its goal); "let's cut a release" does, first in the turn block and
whole. When you keep another way to release, the new way supersedes the old, and sessions that were shown the old one
get an erratum.

---

## 21. Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| Overview says *not installed*; requests show `engine not asked` | The engine's install failed (its error is on the card and was an alert), was removed, or `memory.engine.autoInstall` is off | Memory → Overview → Install memory engine, or restart Filament |
| Engine *degraded* | Three failures in a row (crash, hang, `hello` timeout) | Probe on the Overview restarts it; the last error is on the card; the brain meanwhile runs on the archive alone |
| *calls in flight* on the Live tab stays above zero, turns sit at "recalling memory" | The engine hangs on a call while it still answers pings: no call has a clock, and a turn goes on without memory after a minute | **Restart** on Memory → Settings' engine row or **Restart engine** on the Live tab; "Send without it" sends the one turn on meanwhile. An engine that answers nothing, not even a ping, is restarted by Filament after a minute, and Memory → Engine says so |
| First request after a start takes about a second longer | Cold start of the engine (the trace shows *cold start*) | Expected once per engine start; Probe warms it |
| *briefing empty* on a new session | Nothing is known about this user or project yet and no engine for the tools | Import past sessions; add identity facts on the console's Memory page; it retries on turns 2 and 3 |
| *nothing attached* on most turns | Conservative mode with a high floor, or everything relevant is in view already: in the briefing, or an earlier block of the chat | Lower `autopilot.minScore`, switch to `eager`, or accept: the briefing already carries it |
| Activity shows *used: no* often | The reply did not repeat five consecutive words of any injected item; the judge is strict by design | Facts unused three times fade in conservative mode (rules, preferences, conventions and confirmed items never do); searches still find them |
| Nothing is learned; LLM usage is empty | No model: `models.summarizer` is `off`, or it is not set and no chat's model is one a provider serves (a coding agent's alone is none) | Pick a model under Settings › Memory › Model, or route the agent's model to a provider (chapter 9.1) |
| A burst of cheap-model calls | A backfill after an import, or a manual *Learn from imported sessions* | Expected once; the count equals the sessions imported |
| `@mem` commands reach the model instead of Filament | Commands off, memory failed to open, the client, model or folder excluded in Memory settings, a different prefix, or the client rewrote the message | Check `commands.enabled`, `prefix` and Memory's exclusions; the command must be the first line |
| Claude Code sessions do not resume as one chain | Claude Code sends no session header; the fingerprint uses the first message; editing history changes it | Send `x-filament-conversation` from a wrapper, or accept a new chain (linked when it looks like a continuation) |
| A housekeeping request was captured as a session | Its system prompt did not match the detector | Send `x-filament-memory: off` from that client, or exclude the client |
| "could not decrypt message" | `secret.key` changed or is missing | Restore `secret.key` from a backup of the data folder; Filament never regenerates it on its own |
| Memory calls show on Traffic | A record without the purpose tag and without the learner user-agent | Only calls made by memory's model through Filament's `callModel` or under `/memory-engine/` are memory's own; anything else is a client |
| A memory you know is on file is not served | It is held back: a file it names is gone or lost a symbol, or this request's environment says otherwise (its folder, a lockfile, the tools offered, the platform; or it is another project's). Or it is unsure: its confidence is under 0.35 (an old thread, suspicions on it, a finding whose file changed and a session found wrong) | `@mem recall` or the search tool shows it with its label; the trace's `ranked` step counts held back and unsure. Fix the file or the memory (`filament_memory_correct`, or confirm it) |
| A learned memory lost confidence though the session was about something else | The learner found the session showed it wrong, so it cast a suspicion (−0.25, chapter 1.4); your own word never loses any | The curator's next pass judges each suspicion (chapter 9.3, step 7) and clears one about something else; `@mem curate` runs one now. `@mem history <id>` shows *Cleared of a suspicion* |
| A line says *file changed since* | A file the memory names changed after it was recorded | The model is told to read the file first; once the memory proves right, `filament_memory_confirm` anchors it afresh |
| A pitfall is not said on a call that makes the mistake | It is not armed yet (a learned one needs a second session; `@mem history <id>` shows its evidence), it is held back or unsure, it was said once this session already (one with no right way), the call holds its right way, or its words are not on the call (`git push --force` is not `git push`) | Confirm it (`@mem` or the console) to arm it at once; `@mem history <id>` lists each `fired`; the trace's `memory at the moment of action` counts what was said |
| A pitfall is said on calls that are fine | Its trigger is wider than the mistake: in plain words a second subcommand is not kept ("never run docker system prune" fires on every `docker system`) | Say it with the command backticked (`` `docker system prune` ``): then every word of it counts; correct the memory to replace the old words |
| A procedure never comes | The message does not name its goal: at least half of the goal's identifying words must be in it | Name the task as the goal does ("release", "deploy staging"), or search its goal with `filament_memory_search` |
| An open thread keeps coming back | No learning run has seen a session finish it (learning is off, or memory has no model), and the model that finished it did not close it | Retire it with `@mem forget <id>`; with memory's model, the session that finishes it closes it, and a model with the memory tools closes it with `filament_memory_close` |
