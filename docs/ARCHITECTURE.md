# Architecture

The map of the code: the layers and what each may import (§1), the request pipeline (§2), the module maps, one per area
with a row per file (§3), the contracts that cross modules (§4), how a change is verified (§5) and the code standard
(§6). A test (`test/ratchets.test.js`) fails when a source file has no row in a module map, when a module imports
against the layer rules, or when a helper is written twice — so these pages cannot quietly drift from the tree.

## 1. Layers

Dependencies point inward only. In C# terms: projects with one-directional references, ports as interfaces,
adapters as their implementations, one composition root.

| Layer         | Folder (target)                    | Holds                                                                                                                                                                                                                              | May import                                                                                          |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **core**      | `src/core/`                        | pure functions: wire formats and translation, turns, the fold, the slice pass's numbers and rendering, shaping rules, routing, tokens, text, hashes, the record and note shapes, local replies, redaction. No I/O, no clock, no config reads. | `core`, pure `node:*` builtins (`node:crypto` yes; `node:fs`, `node:http`, `node:child_process` no) |
| **services**  | `src/services/`                    | long-lived state that owns its storage: config, records, op log, events, health, daily usage, the memory stack, the trim pass                                                                                                      | `core`, `services`                                                                                  |
| **adapters**  | `src/adapters/`                    | the outside world behind ports: HTTP providers, Qoder, ACP agents, the Cursor SDK, the memory sidecar, the tool hands                                                                                                              | `core`, `adapters` (services arrive through `deps`, never by import)                                |
| **app**       | `src/app/`                         | use cases: the request pipeline as stages, chat commands, the agent loop and sub-agents, memory tools, count-tokens, embeddings, models, the assistant                                                                                             | `core`, `services`, adapters through their ports                                                    |
| **interface** | `src/http/`, `src/cli/`, `src/ui/` | delivery: router and guards, admin API by area, SSE, MCP inbound, static and docs, `Filament doctor`, the console                                                                                                                   | everything below; nothing imports the interface                                                     |
| **root**      | `src/server.js`                    | the composition root: builds services and adapters, assembles `deps`, mounts the interface                                                                                                                                         | everything; imported only by `bin/` and tests                                                       |

Rules the test enforces today: nothing under `src/` imports `server.js`; a file under a layer folder imports only the
layers listed above; no source file is hidden from git by an ignore pattern; `core` imports no impure builtin and
calls no `fetch`; nothing under `app/` asks what kind an
upstream is (`isAgent(`, `bridgeFor(`, `type === "qoder"` / `"cursor-sdk"`) — it holds a `Destination`. All six layer
folders exist; what is left at the top of `src/` is the composition root and the old paths that re-export a module
for the tests, the scripts, `bin/` and the desktop app that still import them ([root.md](architecture/root.md)).

## 2. The request pipeline

What happens to a model request, in order. It is `src/app/pipeline/run.js` (`createPipeline(deps, { agentTurn,
agentLoop })`): one `RequestContext` (`pipeline/context.js`) travels through the stages under
`pipeline/stages/`, each a `Stage = (ctx, deps) => "continue" | "replied"`, and the first stage that answers the client
ends the run. Two stages are factories because they own a turn handler built once per app: `agent(agentLoop)` and
`dispatch(agentTurn)`.

```
parseAndAuthenticate → situate → chatCommand → engine → route → composed → memoryPrepare
→ handed → agent → view → autofit → withheld → dispatch
```

- **parseAndAuthenticate** — the inbound key, the JSON body, the model name, the route.
- **situate** — client, project, session (memory); the view commands' context.
- **chatCommand** — `@mem …`, `/compact` (in a chat Filament runs), `/goal`, `/set`, `/team`, `/graph`, `/status`, `/cost`, `/help` answered
  locally; the request stops here. Each command's answer is one module under `app/commands/`.
- **engine** — a harness session's engine (`engine.mode`, and `engine.team` for a team): its turn goes to a team's
  lead on the agent loop, or on the coding agent the name reaches; an outside client's request goes to the model it
  names, and Filament's own calls, housekeeping and compaction requests are left alone.
- **route** — the failover order (health-sorted), the request record, the client's abort signal.
- **composed** — a native session's turn (`pre.api === "session"`, HarnessV2 §9): the composer's report becomes the record's
  view stamp here, because an `agent/<model>` turn is answered before the view stage.
- **memoryPrepare** — tell what the request comes beside (a new message while its window's own turn is at work is a
  turn of its own, alongside it, which rewinds nothing), mark a client's own rewind, archive the turn, re-attach blocks,
  briefing, related-memory block; a compaction request gets nothing. An outside client's request takes no lock: one
  turn at a time is the harness's own chats' (the sessions service's `SessionTurns`).
- **handed** — whether the client asked its model to summarize the conversation (`askedToCompact`), and the trace's mark
  where the request is handed to the upstream; a client's compaction goes to its own model as it sent it.
- **agent** — the model name is `agent/<model>` (a harness turn's, or a call of Filament's own): the agent loop's turn.
- **view** — an outside client's history is stamped on its record as it was sent (its weight, its turns, its
  composition); nothing folds. A composed session turn is left as the composer shaped it.
- **autofit** — observation only: stamps `rec.context` (window, source, usable, estimate, verdict); nothing is rewritten, retried or refused to fit.
- **withheld** — memory's withheld exchanges put back on the wire: a merged assistant message the store knows goes out
  as the model's true sequence, so a signed thinking block is never rearranged and the cached prefix stays the same.
- **dispatch** — the candidate loop (`pipeline/dispatch/`): one attempt per candidate, the verdict on its reply (wire-api
  detour, failover, the first-event gate; a provider's size refusal reaches the client as it came), then the reply delivered — the memory-tool loop, the
  stream or the JSON branch — and the record finished.

There is no `housekeeping` stage: a housekeeping request (a title, a summary, a probe) is
detected where each stage needs the answer — memory stays out of it, `handed` marks a summary request as a compaction,
the agent turn answers all of them — and the body changes between those
points, so one early detection would be wrong for the later stages. `finish` is not a stage either: every stage that
answers the client closes its record itself (`deps.finish`), because what goes on the record differs per exit.

`docs/CONTEXT.md` explains the same pipeline from the user's side (vocabulary, round trips, what waits on what).
## 3. Module map

Each area of the code has a map of its own under `docs/architecture/`: a table row per file, its path relative to
`src/` (the desktop app's by its whole path) and what the file is and does — its main exports, and who calls it where
that matters — in 500 characters at most. A row says what a file is today, never its history: what changed and why is
in git. `test/ratchets.test.js` holds the maps to the tree: every source file has one row, every row names a file that
is there, and no row runs past 500 characters.

| Area | Map | Holds |
| ---- | --- | ----- |
| root | [root.md](architecture/root.md) | `src/server.js`, the composition root; the other files at the top of `src/`; `cli/` |
| core | [core.md](architecture/core.md) | `src/core/`: the pure functions — wire formats and translation, turns, the fold, tokens, text, routing, shaping, the task graph |
| services | [services.md](architecture/services.md) | `src/services/`: config, records, the op log, events, health, usage, teams, the memory stack |
| adapters | [adapters.md](architecture/adapters.md) | `src/adapters/`: HTTP providers, the coding agents (ACP, which Claude Code speaks; Codex; the Cursor SDK), the memory sidecar, git, the terminal, the tool hands |
| app | [app.md](architecture/app.md) | `src/app/`'s own files, the request pipeline (`pipeline/`), the chat commands (`commands/`) and the browser (`browser/`) |
| the agent | [app-agent.md](architecture/app-agent.md) | `src/app/agent/`: the agent loop, its tools, sub-agents, teams, the Space |
| sessions | [app-sessions.md](architecture/app-sessions.md) | `src/app/sessions/`: the harness's chats — the sessions service, their turns, compaction, what waits on what |
| http | [http.md](architecture/http.md) | `src/http/`: the router and guards, static files and docs, SSE, the front door, MCP inbound, the admin API by area |
| console | [ui.md](architecture/ui.md) | `src/ui/` beside the harness: the console's shell and pages, the shared kit `ui/lib/`, its widgets, artifacts, the tray card |
| harness | [ui-harness.md](architecture/ui-harness.md) | `src/ui/harness/`'s own files and its kit `lib/` |
| the chat | [ui-harness-chat.md](architecture/ui-harness-chat.md) | `src/ui/harness/conversation/`, `composer/` and `views/` |
| panels | [ui-harness-panels.md](architecture/ui-harness-panels.md) | `src/ui/harness/space/`, `widgets/`, `panes/`, `library/` and `settings/` |
| desktop | [desktop.md](architecture/desktop.md) | `desktop/`: the Electron app — its main process, the tray card's bridge and `lib/` |

## 4. Contracts

The shapes that cross module boundaries, declared once as JSDoc `@typedef`s (checked by `tsc --noEmit` in CI as they
are adopted): `WireFormat`, `InboundRequest`, `RequestContext` (named fields, listed exhaustively), `Stage`,
`RequestRecord`, `Note`, `Turn`/`Step`, `TokenEstimator`, `Destination` (one port over HTTP providers, Qoder, ACP
agents and the Cursor SDK; `AgentBridge` and `RequestAnswerer` are its two capabilities), `ConfigStore`, `EventBus`, `LocalReply`, `AppDeps`, `ClientResponse`.

## 5. Verifying a change

Every change, no exceptions:

1. `npm test` green.
2. The golden wire corpus (`test/golden.test.js`) byte-identical — a structural step never changes what reaches the
   provider, what the client gets back, or the record. Key order is part of the wire (bodies and SSE events are pinned
   as serialised); a record is pinned by its fields and values, keys sorted. A fix step regenerates with
   `UPDATE_GOLDEN=1` and the diff is the review.
3. Ratchets (`test/ratchets.test.js`) not worse, and lowered where the step promised (`UPDATE_RATCHETS=1` only lowers).
4. `npm run typecheck` clean. (Formatting is not a gate: the owner's IDE formats the whole tree in one pass.)
5. The console's pages: load every page with the browser's console open — zero errors, the page's primary element present, one knob
   round-trip (Rules → save; a chat's How earlier turns are kept → change The way and see the ring's Makes room by
   name it).
6. Restart the running instance at phase checkpoints only and look at one real request on Traffic.

## 6. Code standard

Rules about meaning, not layout (formatting is the IDE's, in one pass over the whole tree — no step, gate or ratchet
concerns it): functions do one job at one level of abstraction; a decision a reader must unpick gets a name (no
300-character ternaries); one concept, one name — the vocabulary of `docs/CONTEXT.md` is the code's vocabulary; comments say _why_; every exported function has a JSDoc signature;
every object crossing a module boundary has a typedef; time and ids come from `deps.now()` / `deps.id()`.

**Dependencies.** Filament prefers Node's built-ins and owns its core — the wire translation, the fold, the archive — but it does not
reinvent what a maintained library already does well: a dependency is allowed when it makes the product better or saves
building something that exists. Adopting one is the owner's decision, taken in advance: the proposal names the library,
what it replaces or saves, its size, licence and maintenance state, and how it is pinned; nothing is added until they
agree. Every dependency is pinned in `package.json` with the lock file committed, is installed by `npm ci`/`npm install`
and never fetched at runtime, and never sees a secret or a request body it was not adopted to handle. `core/` stays free
of dependencies (it is pure by construction); a library lives in the layer whose job it does.
