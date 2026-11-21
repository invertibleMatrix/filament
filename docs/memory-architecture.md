# Memory architecture (plan of record)

*Build spec for the memory system approved on 2026-09-15. It settles module boundaries, data shapes, protocols and
the config schema so that pieces can be built independently.*

*A plan of record, kept as written: the modules have since moved into `src/services/memory/` (the paths below still
work through one-line shims), and the memory guide (`docs/memory-guide.md`) describes the code as it is.*

## 1. Principles

1. **Filament owns memory.** Mnemosyne runs as a child process Filament installs, configures and supervises. Agents reach
   memory only through Filament's own MCP tools: the coding agents it spawns, and any other agent at `/mcp/memory`.
2. **Three stores.** The *archive* (Filament's SQLite, byte-exact conversations) holds what happened. The *engine*
   (Mnemosyne) holds what was learned, each item pointing back at archive turns. The *brain* decides what to inject
   and when to ask the engine; it files nothing from a message by its words (the memory plan's d3).
3. **Autopilot first, commands second.** Every request runs through the brain without the user typing anything.
   `@mem` commands exist for searching sessions and memory by hand. Memory is also a *tool* the model can call; Filament
   executes those calls and re-asks the model until it has what it needs.
4. **Conservative by default.** Inject nothing when unsure. Widen with evidence (use tracking).
5. **Cache-stable.** Injections never change a prefix the provider may have cached: one stable briefing per chain in
   the system prompt, per-turn material attached to the newest user message and re-attached identically on replay.
6. **Node built-ins first.** `node:sqlite`, `node:crypto`, `fetch`, `child_process` carry the Node side; Python lives in
   the engine. A library is adopted only when it earns its place, with the owner's agreement (`docs/ARCHITECTURE.md` §6).
7. **Content never leaks.** Request records, logs, telemetry and the events stream carry counts and ids, never memory
   or archive content. Secrets filters run before every write. The archive is encrypted at rest.

## 2. Folders

```
<dataDir>/                          %APPDATA%\Filament (Windows), ~/.config/filament (POSIX); Filament-dev from a checkout
  memory-engine/                    machine-local, never backed up, safe to delete and reinstall
    uv(.exe)                        downloaded static binary
    python/                         uv-managed CPython (uv's UV_PYTHON_INSTALL_DIR)
    venv/                           mnemosyne-memory[embeddings], from Filament's fork at the pinned commit
    cache/fastembed/                embedding model
    engine.json                     { uvVersion, python, mnemosyneVersion, embeddings, embeddingModel, installedAt, log }
<memory folder>/                    default <dataDir>/memory, user-chosen, any drive, adopted on a fresh install
  memory.json                       { version, createdAt, deviceId, archiveSchema, mnemosyneVersion, bank, counts }
  archive.db (+ -wal/-shm)          Filament archive (node:sqlite)
  mnemosyne/                        MNEMOSYNE_DATA_DIR: mnemosyne.db, config.yaml (written by Filament), banks/, blobs/
```

Backups go to a user-chosen folder (typically a Google Drive for Desktop or OneDrive folder), never inside the memory
folder.

## 3. Modules and files

| File | Role |
|---|---|
| `sidecar/mnemosyne_sidecar.py` | Python child: Mnemosyne API + `handle_tool_call` over newline JSON on stdio. Shipped in the npm package (`files` gains `sidecar/`). |
| `src/memory-engine.js` | `MemoryEngine`: spawns the sidecar, request/response over pipes, one call at a time, timeouts, restart with backoff, `hello`/health, writes `config.yaml`, exposes the `MemoryStore` interface. |
| `src/memory-install.js` | `installEngine` (from the bundle that came with Filament alone), `downloadEngine` (what a bundle is built from), `engineState`, `uninstallEngine`: uv → Python → venv → pinned package → model warmup → diagnose, with progress events. No engine is updated: each release brings its own. |
| `src/archive.js` | `Archive`: chains, turns, content-addressed messages, compactions, links, FTS over inputs and final answers, learned-item index, injection log, views, session search, encryption. |
| `src/memory-brain.js` | `MemoryBrain`: situate (the folder a request names asked of the disk only where the folder rules let it — `mayAsk`) → signals → retrieve → budget → place; nothing filed by a message's words (d3); use tracking per memory; the project's dossier; chain end states; the verbs that change what is true (`setItemStatus`, `correct`, `confirm`, `forget`, `remember`, with `resolveRef` for every id a line shows, a session's `s:<chain>` among them) and errata. A refusal says what stands (`#whatStands`, M7-D67). |
| `src/memory-tools.js` | Tool definitions per wire format, server-side loop (execute `filament_memory_*` calls and re-request), stream merging, and the Filament MCP endpoint for agents. |
| `src/memory-learn.js` | Boundary learning with memory's model for the chat: typed items with an optional slot, titles, end states; each item filed through `brain.fileLearned` (§9); caps; the curator poked after each run. A sub-agent's report is read on its own line (`findings`, M7-2, §9). The engine is never asked to consolidate (`sleep`). |
| `src/memory-backup.js` | Consistent backups (archive via `DatabaseSync.backup`, engine via its backup op), manifest, rotation, restore, folder adoption. |
| `src/memory-import.js` | Importers: Hermes Mnemosyne DB, Claude Code session JSONL → archive chains → learning backfill. Background job with progress. |
| `src/memory-service.js` | `MemoryService`: the one object `server.js` talks to. Owns the engine, the archive, brain, tools, learner, backups, importer, and the `/api/memory/*` handlers. |
| `src/services/memory/port.js` | The memory port (HarnessV3-Memory M2-4): `memory.scope({ role, project, chain, turn, conversation, client, finder })` returns a handle, and its role (person, owner, model, agent, learner) is the `by` of every write it makes. The brain refuses a write that does not say who asks. A worker that starts without the session's conversation asks its handle for `brief({ purpose, task, tools, budget })` (M7-1, chapter 6). Every consumer outside the memory service goes through a handle; a ratchet keeps the brain, the items, the injections and the engine store inside `services/memory/`. |
| `src/http/memory-mcp.js` | `/mcp/memory` (M7-6, §7): memory for an agent Filament does not run, over MCP Streamable HTTP. `memoryMcpRefusal` (who may call), `MemoryMcp` (JSON-RPC, sessions kept, adopted after a restart and ended, the folder asked of the client as its roots), `memoryKeys`. |
| `src/app/memory-mcp.js` | The thirteen tools of `/mcp/memory` (`MEMORY_MCP_TOOLS`), `memoryMcpCall` (a call standing as `agent` in its folder's project and its session's chain, what it was shown logged and its errata said first) and `memoryMcpOpening` (the `initialize` instructions). |
| `src/services/memory/outbox.js` | The engine outbox (M2-2): every engine write about an item is a row, written in the same transaction as the archive change, sent in order per item, retried with backoff; a drain never rejects. |
| `src/services/memory/slots.js` | Slots (M2-5): `slotOf` keys the one thing a claim gives a value of ("subject · attribute") and its value; `holdsValue` reads whether a claim holds a value. |
| `src/services/memory/values.js` | Value classes (M3-2): `valuesOf(claim)` reads the typed values a claim's words hold (package manager, working folder, file tools, platform, region, port), each with whether it is this project's; the stored slot first, the words as the fallback; read at use time, never stored. `rivals(cls, a, b)` says whether two values contradict, `withinFolder` whether one folder holds another. |
| `src/services/memory/anchors.js` | Anchors (M3-3): `anchorsFor(text, root)` holds the files and folders a claim names as they were (hash, size, mtime, git HEAD, the symbols the claim names that the file held); `AnchorCheck` re-reads them at recall, one `stat` per file per request and a re-hash only when size or mtime moved; `worstOf` folds the states (ok, changed, gone, symbol). Pure of the archive. |
| `src/services/memory/request-env.js` | The request's environment (M3-4): `requestEnv` reads the project, working folder, platform (the `<env>` line), whether file tools are offered, and the package manager the folder's lockfiles name; `environmentSays(values, env)` is what it contradicts. It speaks for its own project's claims and global ones (M3-D26). Nothing about the environment is recorded. |
| `src/core/package-managers.js` | The package managers Filament knows: `LOCKFILES` (the lockfile that names each, in the Environment's order) and `ECOSYSTEM` (node or python). Shared by the harness's frozen Environment and memory's environment check. |
| `src/services/memory/curator.js` | The curator (M4): memory's sleep, one pass at a time, in the background (a scope due once a learning run lands or a chat of it starts a turn, on demand): threads expire, gone files retire, unused findings lapse, values are keyed, near claims merge onto the survivor the rules pick, changed files are re-verified, suspicions are judged against what cast them, the fence's old items become questions, and the dossier is written; every action an event of its pass (`curator_runs`), so a pass can be undone. The model judges, rules choose. |
| `src/services/memory/triggers.js` | Triggers (M5-1, M5-2, M5-D31): a call's shapes (`callShapes`: each simple command after its setup; any other tool's name), `targetOf` (what a runner runs), `callCarries` (whether a call carries a trigger's words), `holdsWay` (the right way), `sameTrigger`, and `pitfallsOf(text)`: the triggers a claim's words name, deterministic. Pure. |
| `src/services/memory/observe.js` | The observation bus (MD-22, M5-4): in-process, bounded (1,000; drops the oldest), producers never wait; observers read in order. Its first observer, `PitfallMiner`: a failed shell call worked around in the same turn by setup (`fixOf`) is a pitfall seen, filed through `brain.fileSeen`. A second event, `subagent.report` (M7-D17): a sub-agent's exchange that ended done, read by the learner on its findings line. |
| `src/services/memory/procedures.js` | Procedures (M5-6, MD-25): "How to <goal>: 1. … 2. …" read and shaped (`asProcedure`, `stepsOf`, at most 12 steps in 1,200 characters), the goal's slot (`how to · <goal>`), and the dossier's head (`procedureHead`). Pure. |
| `src/services/memory/trace.js` | `MemoryTrace`: the timed, content-free record of everything memory did for one request, carried through the pipeline in an `AsyncLocalStorage` (`currentTrace()`/`withTrace()`), attached to the request record as `memoryTrace` when it finishes. |

### 3.1 `MemoryStore` interface (the engine)

```js
await store.hello()                        // { ok, version, embeddings, vec, dbPath, bank, counts:{working,episodic,canonical,triples} }
await store.recall(query, { topK=8, temporalWeight=0, scope, source, sessionId, fromDate, toDate })
                                            // [{ id, content, score, importance, source, scope, veracity, timestamp, tier, metadata }]
await store.remember({ content, source, importance, scope="global", veracity="stated", memoryType, metadata, pin=false })
                                            // { id, deduped }
await store.get(id) / store.update(id, { content, importance }) / store.forget(id) / store.pin(id, on)
await store.invalidate(id, replacementId?) / store.restore(id)   // retire a row (valid_until, superseded_by) / undo it
await store.fence()                        // { working, episodic, canonical }: the engine's own rows, marked superseded
await store.canonical({ owner="user", category })            // [{ category, name, body, confidence, version }]
await store.canonicalSet({ owner, category, name, body, source, confidence }) / store.canonicalForget(...)
await store.stats() / store.hygiene({ action:"audit"|"clean", limit })
await store.exportTo(path) / store.importFrom(path, { force })
await store.backup(dir)                    // { file, bytes, sha256 }  (engine only)
await store.tool(name, args)               // raw Mnemosyne tool dispatch (engine only)
store.close()
```

## 4. Sidecar protocol

Newline-delimited JSON, UTF-8, one object per line, requests on stdin, responses on stdout, logs on stderr as
`level<TAB>message`. Quick requests are processed **sequentially** (one SQLite connection); stdin is read on its own thread, which answers `ping {}` at once; Filament queues.
The embedding model is most of the engine's RAM (the multilingual one about 530 MB), and a batch of vectors leaves ONNX
Runtime holding what its biggest step asked for (about 440 MB more) until the process ends: the sidecar lets the model
go after a `reindex`, and once no embed has asked for it for `FILAMENT_EMBEDDING_IDLE_S` seconds (600; 0 never), each
embed stamping its use through Mnemosyne's `_get_model`. The next embed loads it again, in under a second.

```
→ {"id": 7, "op": "recall", "args": {"query": "tray restart", "top_k": 8}}
← {"id": 7, "ok": true, "result": [...], "ms": 6}
← {"id": 7, "ok": false, "error": "…", "kind": "mnemosyne|args|internal"}
```

Ops and args: `hello {}` (its `embeddingModel`: the model the engine runs on), `recall {query, top_k, temporal_weight, scope, source, session_id, from_date, to_date}`,
`dense {text, top_k, min_sim}` (Filament's own, beside recall: the working-memory rows nearest the text by meaning, past
recall's lexical gate, each scored by the true cosine of the text's and the row's embeddings, those under `min_sim`
dropped, `dense: true` on each),
`remember {content, source, importance, scope, veracity, memory_type, metadata, pin}`, `get {id}`,
`update {id, content, importance}`, `forget {id}`, `pin {id, on}`, `invalidate {id, replacement_id}` (Mnemosyne's
own: `valid_until` now, `superseded_by` the replacement; recall skips both), `restore {id}` (clears the two),
`fence {}` (every `sleep_*` row not yet fenced: `superseded_by = 'filament:engine-written'`; such canonical facts
expired; returns the ids), `canonical_list {owner, category}`,
`canonical_set {owner, category, name, body, source, confidence}`, `canonical_forget {owner, category, name}`,
`stats {}`, `hygiene {action, limit, min_score}`, `export {path}`,
`import {path, force}`, `backup {dir}`, `reindex {}`, `diagnose {}`, `tool {name, arguments}` (→ `handle_tool_call`), `ping {}`, `shutdown {}`.

Environment set by Filament: `MNEMOSYNE_DATA_DIR`, `MNEMOSYNE_FASTEMBED_CACHE_DIR`, `MNEMOSYNE_BANK`,
`MNEMOSYNE_DEFAULT_SCOPE=global`, `MNEMOSYNE_CROSS_SESSION=1`, `MNEMOSYNE_WM_TTL_HOURS=87600`,
`MNEMOSYNE_LLM_ENABLED`, `MNEMOSYNE_LLM_BASE_URL=<where Filament reaches itself>/memory-engine/v1` (`selfAddress`), `MNEMOSYNE_LLM_API_KEY`,
`MNEMOSYNE_LLM_MODEL`, `MNEMOSYNE_SLEEP_MODEL_REFRESH_ENABLED=false` and `MNEMOSYNE_SLEEP_MODEL_REFRESH_AUTO_APPLY=false`
(the engine proposes no facts of its own), `MNEMOSYNE_NO_EMBEDDINGS` (when embeddings are off), `MNEMOSYNE_EMBEDDING_MODEL` (else, the model `engine.json` says the install warmed), `PYTHONUTF8=1`, `PYTHONUNBUFFERED=1`,
`HF_HUB_DISABLE_TELEMETRY=1`. Because `config.yaml` outranks the environment, Filament writes
`<memory folder>/mnemosyne/config.yaml` with the same values before every start.

The sidecar's `hello` runs at start; Filament considers the engine healthy once `hello` has answered. No call has a
clock (HarnessV3-FailurePoints §4 B): it ends with the engine's answer, its error or its exit. A turn's waits end with "Send without it" or its own minute (`MEMORY_WAIT_MS`), a memory tool call's with the same minute. The client pings an engine silent for 5 s with calls in flight, and restarts one silent for 60 s (`#stalled` → `restart({ why })`), kept on `status().stalled`; a stall within ten minutes of the last stops it with a failure counted, and the fourth in a row leaves it degraded until Restart. A turn shows what it waits
on (recalling), and "Send without it" lets that wait go; the work goes on unwaited. After a crash the
engine is restarted lazily with backoff 1 s, 5 s, 30 s; three failures in a row mark it `degraded` and the brain runs
archive-only until the next successful start.

## 5. Archive schema (`archive.db`, node:sqlite, WAL)

```sql
schema_meta  (key TEXT PK, value TEXT)          -- the version and the encryption mode; the feed's epoch, the engine's
                                                -- fence and adoption, the vectors' model
projects     (id TEXT PK, cwd TEXT, name TEXT, first_seen INT, last_seen INT, settings_json TEXT)
chains       (id TEXT PK, key TEXT UNIQUE, project_id TEXT, client TEXT, model TEXT, title TEXT, started_at INT,
              last_at INT, turns INT, parent_id TEXT, state_json TEXT, briefing TEXT, meta_json TEXT,
              kind TEXT DEFAULT 'interactive', preview TEXT, settings_json TEXT)
local_texts  (chain_id TEXT, hash TEXT, kind TEXT, created_at INT, PK (chain_id, hash))   -- WITHOUT ROWID
turns        (id INTEGER PK, chain_id TEXT, n INT, started_at INT, ended_at INT, request_ids_json TEXT, model TEXT,
              upstream TEXT, user_hash TEXT, final_hash TEXT, work_json TEXT, input_chars INT, output_chars INT,
              summary TEXT, meta_json TEXT)
messages     (hash TEXT PK, role TEXT, kind TEXT, bytes INT, truncated INT, body BLOB, created_at INT)
compactions  (id INTEGER PK, chain_id TEXT, from_turn INT, to_turn INT, summary_hash TEXT, kind TEXT, window TEXT,
              created_at INT, method TEXT, detail_json TEXT)
trim_slices  (hash TEXT PK, summary_hash TEXT, tokens INT, chars INT, model TEXT, created_at INT)   -- WITHOUT ROWID
links        (src TEXT, dst TEXT, type TEXT, weight REAL, created_at INT, PRIMARY KEY (src, dst, type))
items        (id INTEGER PK, project_id TEXT, chain_id TEXT, turn_id INT, kind TEXT, text TEXT, text_norm TEXT,
              status TEXT, importance REAL, memory_id TEXT, created_at INT, updated_at INT, origin TEXT,
              superseded_by INTEGER, invalid_reason TEXT, invalid_at INT, slot TEXT, slot_value TEXT, slot_multi INT)
item_events  (id INTEGER PK, item_id INTEGER, at INT, action TEXT, by TEXT, reason TEXT, detail_json TEXT,
              run_id INTEGER, undone_at INT)                                 -- run_id, undone_at: the curator's pass
item_anchors (item_id INTEGER, path TEXT, name TEXT, kind TEXT, hash TEXT, size INT, mtime INT, head TEXT,
              symbols_json TEXT, state TEXT, at INT, checked_at INT, PK (item_id, path))   -- WITHOUT ROWID
engine_outbox(id INTEGER PK, item_id INTEGER, op TEXT, args_json TEXT, attempts INT, last_error TEXT, next_at INT,
              created_at INT, done_at INT, dead INT)
blocks       (chain_id TEXT, hash TEXT, block TEXT, nth INT, kind TEXT DEFAULT 'turn', created_at INT, PK (chain_id, hash))
injections   (id INTEGER PK, request_id TEXT, chain_id TEXT, turn_id INT, kind TEXT, ids_json TEXT, tokens INT,
              used INT, created_at INT)                                      -- index injections_chain (chain_id, id)
injection_ids(injection_id INTEGER, memory_id TEXT, used INT, PRIMARY KEY (injection_id, memory_id))   -- WITHOUT ROWID
withheld     (anchor TEXT PK, entry TEXT, created_at INT)                    -- memory's withheld exchanges; WITHOUT ROWID
fts_text     FTS5 (chain_id UNINDEXED, turn_id UNINDEXED, role UNINDEXED, text)   -- capped plaintext for search
fts_tri      FTS5 trigram, as fts_text           -- the rows of fts_text in a script written without spaces (c1)
curator_runs (id INTEGER PK, project_id TEXT, reason TEXT, model TEXT, calls INT, actions INT, started_at INT,
              ended_at INT, error TEXT, detail_json TEXT, undone_at INT, undone_by TEXT)
inbox        (id INTEGER PK, project_id TEXT, kind TEXT, key TEXT UNIQUE, item_ids_json TEXT, proposal_json TEXT,
              reason TEXT, run_id INTEGER, status TEXT, created_at INT, decided_at INT, decided_by TEXT,
              outcome_json TEXT)                                             -- memory's questions
dossiers     (id INTEGER PK, project_id TEXT, version INT, sections_json TEXT, cites_json TEXT, basis TEXT,
              model TEXT, run_id INTEGER, created_at INT, undone_at INT)
item_triggers(item_id INTEGER, tool TEXT, shape TEXT, args TEXT DEFAULT '', unless TEXT, source TEXT, at INT,
              PK (item_id, tool, shape, args))                               -- WITHOUT ROWID; index (tool, shape)
claim_feed   (id INTEGER PK AUTOINCREMENT, at INT, item_id INTEGER, action TEXT, project_id TEXT, from_project TEXT,
              chain_id TEXT, by TEXT)                                        -- the claims feed; index (item_id)
outcomes     (id INTEGER PK, at INT, chain_id TEXT, turn_id INT, request_id TEXT, kind TEXT, agent TEXT, model TEXT,
              did TEXT, counts_json TEXT, ended TEXT, corrected TEXT, corrected_at INT, rounds INT, calls INT,
              tokens_in INT, tokens_out INT, usd REAL, ms INT)               -- how models did; index (chain_id, turn_id), (at)
round_changes(chain_id TEXT, turn_id INTEGER, seq INTEGER, place TEXT, round INT, agent TEXT DEFAULT '',
              before_commit TEXT, after_commit TEXT, base TEXT, own_json TEXT DEFAULT '[]', command INT DEFAULT 0,
              at INT, PK (turn_id, seq))             -- what each agent changed; WITHOUT ROWID; index (chain_id, turn_id)
turn_legs    (turn_id INTEGER PK, names TEXT, n INT)  -- an over turn's tool legs, proved by its work's names digested
```

- `messages.body` is the raw message JSON as received or produced, AES-256-GCM with Filament's `secret.key`
  (`privacy.encryptArchive`, on by default); `hash` = sha256 of the plaintext. Bodies over `capture.messageCapBytes`
  (1 MB), the pictures and files they carry in base64 not counted (`mediaBytes`), are stored truncated with `truncated=1`
  and a marker.
- `fts_text` keeps the searchable copy of user inputs and final answers, capped at `capture.inputCapChars` (4,000).
  It is plaintext by design (search needs it); the setting `privacy.searchIndex` can turn it off. `fts_tri` holds the
  same rows where the text holds a script written without spaces (Han, kana, Thai — words.js `hasUnspaced`): fts_text's
  tokenizer reads a run of such a script as one word, so `searchInputs` searches a query's runs there by their trigrams
  (a run of two by its letters) and keeps a turn's better-scored row. A file written before it is filled once as it
  opens (`trigramFilled` in schema_meta); a chain taken out of the index leaves both.
- `engineVectors` in schema_meta records the embedding model the engine's stored vectors were made with
  (`{model, at, rows}`). As the engine starts on another model (or none was recorded), Filament has it `reindex` once,
  `brain.reembedding` set meanwhile so recall leaves the engine out, and records the new model. An engine about to
  give way to this release's bundle (`#givesWay`: another's, the bundle here, `engine.autoInstall` on) makes none: its
  install, armed only once the server listens, would stop it part way; the release's engine makes them at its start.
- `kind` on messages: `text`, `tool_use`, `tool_result`, `thinking`, `image`, `other`. `work_json` on a turn lists the
  hashes of everything between the user message and the final answer, in order (§5.2 says how it fills).
- `kind` on chains (`CHAIN_KINDS`): `interactive` (a person's session), `fork` (a save-state copy, §5.1), `tick` (a
  loop's own housekeeping calls), `subagent` (an imported sub-agent transcript, `parent_id` set), `mcp` (an outside
  agent's session on `/mcp/memory`, keyed `mcp:<session id>`: no turns, only what it was shown, M7-D40). Recall
  quotes `interactive` and `fork` chains only (`QUOTED_KINDS`, `searchInputs({ kinds })`, M7-D22). `preview` is the first user text, capped. `settings_json` is the session's own settings
  layer (HarnessV2 §5); `projects.settings_json` the project's.
- `state_json` on a chain: `{ status: "open"|"done"|"stale", summary, open: [..], done: [..], next: [..], updatedAt }`.
- `briefing` on a chain is the exact string injected into the system prompt for that chain. The per-turn memory
  blocks live in `blocks`, keyed by `(chain_id, user hash)`, so every request re-attaches byte for byte.
- One resolver (`chainIdForKey`, HarnessV3 Step 3 D2) answers a key with the chain whose own key it is, and nothing
  else: an outside client's chat is its own session. An older archive may still hold a `chain_windows` table (the
  chats `@mem attach` filed under another session): nothing reads or writes it (a new archive has none), so such a
  chat's next message opens a session of its own.
- `local_texts`: Filament's own texts in a session (Step 3 D11), each the SHA-256 of the normalized text with its kind:
  `reply` for a whole answer Filament wrote itself, `prefix` for a cue it placed in front of one. Memory leaves them out
  of what the model sees. Hashes only: no text is stored.
- `withheld`: memory's withheld exchanges (BUG-11), one row per anchor (a tool call's id, a thinking signature's hash)
  holding the exchange's fingerprints and its withheld messages' hashes; the messages are rows of `messages`, sealed
  like every other. The `withheld` stage puts them back on the wire, so a signed thinking block is never rearranged.
- `items.kind`: `decision`, `rule`, `convention`, `preference`, `fact`, `thread`, `procedure` (M5-6: its `slot` is
  `how to · <goal>`, single-valued, so one way to a goal stands). `status`: `inferred`, `confirmed`,
  `dismissed`, `superseded` (the last two retired: `isRetired`). An item is a claim: `origin` (person,
  correction, capture, model, learner, import, owner, subagent, agent: its `created` event names the finder, M7-D19, M7-D47), `superseded_by` (the replacing item), `invalid_reason`,
  `invalid_at`, and its history in `item_events` (created, status changes with who, why and the replacement,
  verified, `evidence` when another session said it again, `kind` when a learned rule was filed as a fact, `anchor`
  when a file it names was seen in a new state, `contested` when its project's environment contradicts one of its
  values, `suspected` when a learning pass found a session it was shown in showed it wrong (d4: the session, the turn
  and why), `cleared` and `weighed` when the curator judged those suspicions (M7-D68), `fired` when it was said at
  the moment of action, `followed` and `kept` when a call took its right way after a reminder or with none,
  `closed` when a session finished a thread). Only `brain.setItemStatus`
  changes a status, so the history, the engine copy (invalidated or restored) and the errata move together; nothing
  is deleted. A claim may name the one thing it gives a value of: its `slot`
  ("subject · attribute" within its project, such as `project · package manager`), its `slot_value` (`bun`), and
  `slot_multi` when the slot holds several values at once. Claims a `remember` files are
  unkeyed. A claim about code has anchors (`item_anchors`, M3-3): one row per file or folder it names
  that exists under its project's folder, at most five, with the file's hash (files over 1 MB: size and mtime only; a
  file modified after the claim was said has no baseline and is anchored as `changed`), the git HEAD, the symbols the
  claim names that the file held, and the `state` it was last seen in (`ok`, `changed`, `gone`, `symbol`). A claim
  with none is anchored, as of when it was said, the first time a process looks at it. The `injections_chain` index serves "which claims was this
  session shown": `anchors.shownIn` (their files are checked every turn) and `injections.forChain` (the suspects of a
  correction). `injection_ids.used` judges use per memory id.
  `memory_id` is the engine id when mirrored. `text_norm` backs the per-project dedup index. An item
  whose text reads as code (HTML, operators, a method call, symbol soup — `looksLikeCode` in `core/text.js`) is
  never stored and never shown in a dossier (HarnessV2 F11).
- `item_triggers` (M5-1): a claim's triggers, the tool calls it is about. `tool` is `bash` for every shell, else
  the tool's name; `shape` the command and its subcommand (`git push`); `args` the words that make a call of that shape
  the mistaken one (`--force`; '' for every call of the shape, M5-D31); `unless` the right way; `source` `words` (read
  from the claim's words by `pitfallsOf` as it is filed) or `seen` (the miner's).
- `claim_feed` (HarnessV3-Memory M7-D32): every change a claim's card shows, and a dossier's, in order. The
  archive writes the row at its own write points, in the change's transaction, so no caller forgets one and a
  rolled-back change leaves none:
  - each item event (`#itemEvent`): its action and `by`, with the claim's project and session as it stands, and
    `from_project` on `moved`;
  - an owner's delete (`#dropItems`): the claim's earlier rows go with its record, and `deleted` says it went. Each
    other claim that an open question it was in named is told `decided`;
  - a project's delete (`deleteProject`) also tells each claim elsewhere that one of its open questions named
    (`decided`), never a claim it took, and ends with `deleted` with no claim, in the project: a page that lists the
    project reads its scopes again though it held no claim;
  - `asked` and `decided` (`inbox.add`, `inbox.decide`), once per claim the question names: its `itemIds`, and the
    proposal's claim and replacement;
  - `triggers` (`triggers.set`, only when they changed) and `anchored` (`anchors.add`, a claim's first);
  - `dossier` (`dossiers.add`, `dossiers.undone`), no claim, in its project.

  `id` is AUTOINCREMENT, so it is never reused, even after a delete or a prune. The feed's `epoch` (`schema_meta`
  `feed`, made with the store) names it outside the archive: an id is `<epoch>:<n>`, so another store's id is never
  read as this one's. Rows older than `FEED_DAYS` (30) are pruned when memory opens and once a day. `feedPruned` keeps
  the newest id a prune took: an id at or past it still finds every row after it. After each row the archive calls
  `onClaimChange`; a relay that throws never fails the write.
- `outcomes` (HarnessV3-Memory M7-4, M7-D48..D57): how one finished piece of an agent's work went, as counts,
  never words. `kind` is `turn` (the agent loop's turn) or `subagent` (a sub-agent's exchange; `agent` its type).
  `did` is `didOf(counts)` (`services/memory/outcomes.js`): tests, edited, ran, delegated, read, answered, the most it
  reached. `ended` is done, failed or stopped. Tokens and cost are its own model calls', read off each call's record as
  it returns (`callSpend`), so the records ring's evictions never lose one. The writer is `app/agent/turn.js`, as a
  turn or a sub-agent's exchange ends (`endedOf`; a pause keeps its spend so far on the pending entry and on the
  chain's `meta.paused.spent`, and the resume's end adds the halves, `addSpent`).

  It goes through `memory.recordOutcome` (synchronous; it never throws; nothing while memory is off or closed, or
  for a turn memory stayed out of: the writer's gate is the turn's `prep.chain && !prep.silent`). A row's turn, when
  its writer gives none, is its request's (`turnOfRequest`). Corrections: `outcomes.correctTurn(chain, turnId)` marks
  the turn's outcome on `turnBefore(chain, turnId)`, judged by models, never by a message's words (d4): a learning
  pass's `corrected` turns (`ingest`: a turn of the pass, not `meta.own`, answering no turn kept apart), and
  `brain.correct` when its `quote` is heard in the very turn of the call and the session was shown the claim before it
  (`injections.shownIn(chain, 0, through)`). Rows go
  with their session (`deleteChain`) and their project (`deleteProject`), and are pruned after `OUTCOME_DAYS` (365)
  when memory opens.
  Only memory's service and `GET /api/memory/outcomes` read them; a ratchet keeps any other reader out (M7-D54).
- `round_changes` (HarnessV4_Git_Plan step 1): one writing round of a turn in one place, for one agent — what a
  turn changed is read from these, never from a diff of the whole folder, which counts everyone's edits and sees no
  other folder. `place` is the top folder of a repository or worktree as git spells it ("" for files written outside
  any); `agent` "" for the turn's own agent, a helper's id for one that wrote in a folder it shares; `before_commit`
  and `after_commit` the place's snapshots around the round; `base` what `before_commit` is (`round`: taken just
  before the round's hands ran; `last`: the place's previous snapshot; `head`: its last commit; `none`: outside any
  repository); `own_json` the files the agent's own write and edit calls named there; `command` whether a command of
  its ran in the round. The writer is `app/turn-tree.js` through `memory.recordRoundChange` (it never throws);
  `lastInPlace` is a place's newest `after_commit`, the next snapshot's parent there; `memory.roundsOf` reads a turn's
  or the whole chat's (a fork's own turns only). The places a chat follows besides its folder sit on its
  `meta.places` (`followPlace`, `placesOf`). Rows go with their session (`deleteChain`, `deleteProject`).
- `compactions`: a summary or a fold standing in for turns `from_turn`..`to_turn`. `kind` says what made it
  (`client`: a client's own compaction; `plain`: at the compaction line; `manual`: on request; `autofit`; `brief`: a
  fork's summary; `fork`: a fork's folded copy; `compaction` and `continuation`: imported; older rows may say `trim`),
  `window` who compacted (`harness`, or the compacting window's conversation key; null when unknown),
  `method` how (summary, fold, or own — a coding agent's own compaction; older rows may say trim: every row names
  one), and
  `detail_json` what it did in figures (before → after, who wrote it; `attached`, what came back after a summary). A
  fold row has no `summary_hash`: it lists in the history but never stands for its turns.
- `trim_slices` caches the slice pass's summaries by the hash of the slice they stand for, so a slice read again is
  summarized without another model call.
- `turns.meta_json`: `compacted` (the fold compaction or fork's folded copy that folded the turn: its `shape`, the
  compaction's `id`, `at` — `compactTurns` writes it with the row), `cut` (§5.2).

### 5.2 Turn semantics — what a row in `turns` is

A **turn** is one message from the developer → the work → one final answer. The **work** is every message between
those two, in order: the model's tool calls, their results, its thinking, its interim texts. A **tool leg** is one
round of the turn's tool loop — one assistant message of the work that called tools (kind `tool_use`) together with
the results that answered it. The session truth's `activity.toolLegs` (`truth.js` `toolLegsOf`: the work hashes
whose stored kind is `tool_use`, each turn's count kept between reads by `archive.js` `toolLegs`, and across starts in
`turn_legs` once the turn is over) and the transcript's per-turn count (`ui/harness/conversation/history.js`: the
assistant work messages with a `tool_use` block or `tool_calls`) are the same definition; Phase 6's definition of
done is that they agree.

How `work_json` fills depends on who runs the loop:

- **The harness's own loop** (`POST /api/sessions/:id/turns`, agent mode): the loop knows every round and hands the
  work to `finishTurn` in one go.
- **A proxied client's loop** (Claude Code, Codex — any client that resends the whole conversation on every leg;
  HarnessV2 F6): the first request of a turn carries the developer's message; the brain opens the turn (`beginTurn`,
  deduped by the user hash) and the reply — usually a tool call — is written as its final, so a client that stops
  after any answered leg leaves a finished turn (a leg whose upstream call fails leaves it open, as any failed
  request does). Each later leg carries no new person-speaking message (`sit.newestIndex < 0`, position `toolLeg`);
  the brain finds the turn again by the hash of the newest person-speaking message (`turnForUser` — the window's newest turn qualifies, and past it the window's newest with that message while its loop is still open (its newest reply called a tool, or it has none yet), so a leg finds its turn whatever turns opened since and a look-alike text never reopens a turn that answered), takes the messages after it as
  the loop so far (`legWork`), and after the reply `addWork` lays them onto the turn (deduped by hash, so a retried
  leg adds nothing twice) and `finishTurn` re-finishes it with the newer reply as the final; the chain's turn count
  moves once. The leg must agree with the archived loop (`contradiction`: its messages match the turn's work then
  its final, by content hash, as far as both go) — a client that edited a tool result or rewound the loop is on a
  branch, and that leg archives nothing, with a note on its record saying where the histories part. A quiet request
  (a loop's own tick, `x-filament-memory: off`) still archives nothing.
  `request_ids_json` lists every leg's request. Every client is covered: Anthropic and OpenAI chat bodies as they
  come, and a Responses-API client (Codex) because `http/responses.js` turns its `input` into an OpenAI chat body
  (`tool_calls`, `role: tool`) before the pipeline sees it.
- **The importer** (`memory/import.js`, Claude Code's JSONL): the final is the last assistant message of the turn,
  a text or a tool call; when tool results trail it (the session ended mid-loop) they stay in the work and the turn
  carries `meta.cut = true`. A re-import lays a cut turn's work out again in order (`setWork`) and re-finishes it
  when the final changed. A sub-agent's file imports as a chain of kind `subagent` under its parent; an existing
  chain's kind is corrected on re-import (`setChainKind`).

A request that runs a turn marks it running as it opens or goes on with it (`meta.running`, when it began); the
request's record closing clears the mark (`turnStopped`). A turn still marked after a restart ran at it: the sessions
service shows it cut off (`cutOffBefore`, HarnessV3-FailurePoints finding 3).

### 5.1 Archive API

```js
const a = new Archive({ file, key /* Buffer|null */, caps: { messageBytes, inputChars } });
a.chainForKey(key, { project, cwd, client, model })           // creates on first sight → chain row
a.beginTurn(chainId, { requestId, model, upstream, userMessage })   // joins the newest turn when it is open with the same pin, or — a second send of a running request's message, which memory tells (`joinsRunning`, alignHistory) — the window's newest on the line a request runs now (`meta.running`) with it; a mark alone joins nothing → { turnId, n, isNew }
a.turnForUser(chainId, userMessage)                           // the window's newest turn this message opened, or past it the newest whose loop is still open → { turnId, n, endedAt } | null
a.loopsWaiting(chainId, window, pin)                          // the window's turns of that message whose newest reply called a tool and past which the conversation has not gone on (memory's `alongside`) → [{ n, legs }]
a.addWork(turnId, messages[])                                  // tool calls, tool results, thinking, in order (hash-deduped)
a.setWork(turnId, messages[])                                  // replace the work (the importer's cut turns)
a.finishTurn(turnId, { finalMessage, requestId, outputChars })  // a re-finish swaps the final; the turn is counted once
a.getTurn(turnId) ; a.getTurns(chainId, { from, to }) ; a.turnBodies(chainId, { from, to })
a.messageKinds(hashes[])                                       // Map hash → kind (tool legs are counted from this)
a.mergeTurnMeta(turnId, patch) ; a.mergeMeta(chainId, patch) ; a.setChainKind(chainId, kind)
a.chainSettings(chainId) / a.setChainSettings ; a.projectSettings(projectId) / a.setProjectSettings
a.addCompaction(chainId, { fromTurn, toTurn, summaryText, kind, method }) ; a.compactTurns(chainId, { turnIds, shape, kind, method, fromTurn, toTurn })
a.link(src, dst, type, weight)
a.setState(chainId, state) / a.setTitle / a.setBriefing / a.setBlocks
a.searchInputs(query, { project, limit })                      // FTS → [{ chainId, turnId, n, snippet, at }]
a.chainsForProject(projectId, { limit })                       // newest first with state
a.render(chainId, { view: "full"|"chat"|"summary"|"compact", budgetTokens, fromTurn, toTurn })
                                                               // → { text?, messages?, turns, tokens }; a turn the budget leaves out is never read
a.items.add / list / get / setStatus / events / note        // a claim, its standing, its history
a.items.withText(projectId, kind, text) ; a.items.inSlot(projectId, slot) ; a.items.setSlot(id, { slot, value, multi })
a.items.evidenceChains(projectId)                              // Map item id → the chains that said it again
a.items.eventCounts(ids)                                       // Map item id → { evidence, suspected (since its last cleared) }, one GROUP BY per 500 ids
a.items.usersWord(projectId, kinds)                            // the user's rules: { count, rows() } — rows decoded lazily, id order
a.anchors.add / replace / of / setState / shownIn(chainId)     // a claim's anchors; the anchored claims a session was shown, read from the rows its log gained since its last check (kept for the 256 most recently checked sessions)
a.triggers.set / of / matching / onTools(projectId, tools)    // a claim's triggers; onTools: the standing claims with a
                                                               // trigger on any of the tools, each once, oldest first
a.inbox.add / get / has / list / count / decide / byRun(runId) // memory's questions: one per key, ever ({ raised })
a.inbox.asking() / awaiting() / about(itemId)                  // open ones by the claim they would retire or correct, by
                                                               // the claim that would come in, and every one about a claim
a.feed.position()                                              // the claims feed: { epoch, last, pruned }
a.feed.after({ after, limit, project })                        // the rows after `after`, oldest first → { rows, through }
a.feed.prune(before) ; a.feedEpoch ; a.onClaimChange           // the rows before `before` taken; told after each row
a.injections.add / markUsed / recent / forRequest / forChain(chainId, limit) / chainsShown / creditLatest /
  creditShownIn(chainId, refs, kind?) / useCounts(refs, since) / recentUse(refs, kind, last) / briefedSinceUse(refs) /
  usedNow(refs) / rollupRows(since)
a.injections.shownIn(chainId, since)                           // the memory ids a session was shown since, newest first
a.turnOfRequest(chainId, requestId)                            // the turn whose request ids hold it (a sub-agent's launcher)
a.forkChain(chainId, { atTurn, key, title? })                  // the save-state fork → the new chain row + { forkedFrom, atTurn, copied }
a.backupTo(file) ; a.counts() ; a.chainCounts() ; a.close()    // chainCounts → { byKind, withSettings, compactionsByKind }
a.messagesCounted()                                            // settles when a file's first count of its messages ends;
                                                               // until then counts() has messages/bytes null, counting: true
```

**The fork** (`forkChain`, WP-J.1). A fork is a new chain that is the source through turn `atTurn`. Messages are
content-addressed, so the fork's turn rows point at the *same* message hashes — nothing is copied but rows. It
inherits: the turns ≤ `atTurn` (search-index rows too), the memory blocks attached to those messages (so the
fork re-attaches byte for byte and the provider's cached prefix survives), the compactions that end within the
kept turns, the briefing, and the meta the fork can honestly carry — mute and the privacy flags, the briefing's
item ids, the learner's cursor clamped to `atTurn` (the session's settings layer travels whole); a state learned from
turns the fork does not have is *not* inherited. The fork gets a `forked` link to its source and **no parent_id and
no `continues` link** — those make the source an ancestor and recall would walk into the turns the fork rewound
away from. Its meta also carries `fork: { from, atTurn, at }` and `tree: { snapshotRef: null }`, the field the
working-tree fork (WP-J.2) fills. The façade's `forkSession(chainId, { atTurn })` keys the fork under a name no
client conversation reaches (`n:`) and returns `{ chainId, … }`: a fork is the harness's own chat, made by the sessions
route, `POST /api/sessions/:id/fork { atTurn }`, which keys it as a new chat is keyed; no client continues it. The
lineage graph draws `forked` edges with `atTurn`.

## 6. The brain (autopilot)

Runs inside `handleModelRequest` after routing, before shaping, for every non-housekeeping, non-internal request
unless `x-filament-memory: off`, the model or client is excluded, or the chain is muted. With `memory.enabled: false`
the archive still opens and the brain still situates and records every turn — it reads the switch as autopilot off
(nothing recalled, no cue, no tools, no learning, no engine), the same state a muted chain is in.

**Trace.** Each request gets a `MemoryTrace` (`memory.trace()`), handed to `situate()` and stored on the situation
(`sit.trace`); `prepare`, `runTools`, `defer`, `afterReply` and `command` run inside `withTrace(sit.trace, …)`, so
the brain and the engine add steps through `currentTrace()` without extra parameters. Steps carry `at` (ms from the
record's start), `phase` (`before` the upstream call, `upstream`, `after` the reply, `later` for background work),
`depth`, `ms` for spans, and details: counts, ids, scores, reasons, the search words (filtered by `safeQuery`, never
memory content). The engine records every call (`engine <op>`, rows, cold start, errors). The server marks
`handed` (the upstream call starts) and `firstByte`, and attaches `trace.toJSON()` to the record through the usage
store's `_onFinish` hook; the list view only flags `hasMemoryTrace`, the detail carries the steps. Memory's own model
calls are tagged `rec.memoryFor = { purpose, chain }` (`x-filament-memory-purpose` / `-for` headers from
`callModel`; the engine's LLM base URL is `/memory-engine/v1`, which the dispatcher serves as `/v1` with the
opt-out and the `engine` purpose set). `GET /api/memory/benchmark` aggregates the traces on the records in memory.

1. **Situate**: `project` from the working directory (system prompt "Working directory:" line, `x-filament-cwd`
   header, or ACP cwd), `client` from user-agent prefix and headers, `chainKey` from `clientConversationId(headers)`
   else `sha1(project cwd + first user text[:2000])`, `position` ∈ first, mid, afterCompaction, toolLeg.
2. **Signals** (deterministic, `signalsOf(message)`): `keywords` (the words to search by, any script; none means no
   lookup for the message), `afterCompaction` and `compactionRequest` (a client's fixed machine text), `entities`
   (code-shaped keywords: file names, identifiers), `correction` (no/don't/never/stop/wrong/I told you), `preference`
   (I prefer/I use/we always/from now on), `decision` (let's go with/we'll drop/decided/instead of), `explicit`. How
   much is looked up is never read from the words (the memory plan's c3): no past-reference, continuation, greeting
   or topic-shift signal.
3. **Retrieve**: `keywords(message)` (stop words removed, code tokens kept) → `store.recall` with temporalWeight 0
   for briefings and 0.1 for turns; the user's facts and decisions of no project (`#everywhereLines`, f5); archive: last chains in the
   project with states, `searchInputs` on the keywords, links from hit turns. Results are deduplicated and scored:
   engine score, entity overlap bonus, project match bonus, recency as a tiebreaker only; then every claim's score is
   weighed by how sure memory is of it (below), and its standing is read in that order until the limit is filled.
4. **Budget**: first turn `autopilot.briefingTokens` (4,500, the whole briefing: header, tools' line and legends counted, d2; each block in its share of what the rules and the header leave), later `autopilot.turnTokens` (300), ×1.5 after
   a compaction and on a first message no briefing was built on (one built on it recalls on the same words, e2), 0 on
   `toolLeg` or a message with no keyword. A turn block leaves out what is in view (e2): the briefing's ids and what
   the blocks placed again on the messages still sent show (`reattachBlocks`' `placedOut`, `idsInView`) — a turn
   block's or a reminder's line by the id at its head (`i<n>`, `s:<chain>:<n>`), a memory call's results by their
   `id`; an id a line only names (an erratum's replacement) is not. A compaction that took a message takes its block's
   memories out of view, and they may be said again. Score gate: nothing below `autopilot.minScore` unless
   within 60% of the best hit; in `conservative` mode at most 3 items per turn and no items that were injected and
   never used three times running. Confidence gate: no claim under 0.35 reaches the autopilot (search keeps it). A
   briefing gives its first quarter to the user's rules and a tenth, six lines at most, to identity; what can be read
   is small (e1: `standingBlock`'s three lines — this folder, the other worktrees in one, its newest commit — and a
   session's row its summary cut to 160 with its open items counted); a turn block quotes at most two past sessions.
5. **Place**: briefing → end of the system prompt inside `<filament-memory kind="briefing">…</filament-memory>`,
   stored on the chain and re-applied byte-identically on every request of that chain. Turn block → appended to the
   newest user message text inside `<filament-memory kind="turn">…</filament-memory>`, stored in `blocks_json` by user
   hash and re-appended on replay. Tools → appended to `tools` when `autopilot.tools` is on (see §7). Records get
   `rec.memory = { chain, turn, briefing: n, injected: n, tokens, ids, tools: n, toolCalls: n }`.
6. **No capture by words** (the memory plan's d3): no list of a message's words files a claim, retires one or casts a
   doubt on one. What the person says reaches `items` as the agent's `filament_memory_remember`/`correct` (its `quote`
   heard in the chat, d1: origin `capture`, *user's words*, or `correction`), as the person's `@mem remember|rule|
   prefer|procedure|correct` (the command names the kind) or as the learner's reading at a boundary. Whether the turn
   corrects the reply before is the learner's verdict, or the agent's quoted correct's (d4).
7. **Observe** (after the reply): each injected item is judged on its own. It is used when five consecutive
   normalised words of it appear in the reply (`usedInReply`), else when its words overlap the reply's by more than
   70% (60% for an item too short for five); or when the turn's tool calls carry a word of it that is rare across
   memory (`usedInWork` over `workTermsOf`: commands, paths, patterns and other strings up to 2,000 characters, memory's
   own tools left out; rare = held by at most 2% of the standing claims, two where there are few, counted by
   `rareTerms` and kept until a claim changes), so a rule obeyed in a command counts. A model's
   `filament_memory_confirm` also counts as a use, credited where the item was last shown (`injections.creditLatest`),
   and a memory search whose results hold a memory the session was shown credits its latest showing there
   (`port.search` → `brain.creditShown` → `injections.creditShownIn`); a credit given while the turn ran stands at its
   reply (`markUsed` never takes one back). What the session's briefing showed is judged on every later reply too (f3,
   `#judgeBriefing`), its use credited to the briefing's own showing (`creditShownIn(…, "briefing")`), once a session,
   and every use kept as the claim's last (`usedNow` where there is no showing to credit: a fork's briefing is its
   parent's): the briefing is judged on the first reply as it is built, and a claim it shows is not shown again that
   session. Misses (an item available but not injected) are not judged, and no gate
   moves. Items ignored three times are demoted.
8. **The dossier** (HarnessV3-Memory M4-7, replacing canon): every briefing of a project carries its dossier after
   the user's rules: the curator's version, or, until one is written, the standing claims that earned a place by
   kind. A chain that said a claim again counts for it (its `evidence` event): the claim itself is filed once.

**Precision (HarnessV3-Memory M3).** What the autopilot shows is read against the world as it is now, and weighed by
how sure memory is of it:

- **The user's rules (L0).** `#constitution` puts the user's own rules, preferences and conventions first in every
  briefing: the standing kinds said by the person, the owner or a correction, their words an agent quoted (`capture`,
  d3), or confirmed (`items.usersWord`, read
  lazily in id order). They take up to a quarter of the briefing budget; the first always shows, the rest are counted
  ("…and N more; filament_memory_search finds them."). A rule held back (below) is left out. The ids join the
  briefing's, so `retrieve` (`excludeIds`) never shows them twice. The model's own unquoted rules and an unconfirmed
  learned convention are not the user's word and are recalled like any claim.
- **Confidence.** `confidenceOf(claim, { evidence, suspected, grounded, changed })` starts from who said it (a correction 1, the
  person or owner 0.95, confirmed 0.9, the user's words quoted (`capture`) 0.8, a sub-agent's or an outside agent's
  finding 0.55, an import 0.4, otherwise — learned, or the agent's own note (`model`, the memory plan's d5: as many of
  each used of those shown) — 0.6), adds 0.05 per
  `evidence` event (at most 0.15) and 0.05 for a `grounded` one that holds (f2), takes 0.25 per `suspected` event since the claim was last `cleared` (never from the
  user's word, their words quoted, a correction or a confirmed claim — `userBacked` — which a correction changes only
  by asking: M7-D68) and 0.2 for a
  changed file, and lets a thread fade
  after a week (0.1 a week) and a fact or decision after half a year (at most 0.2). The weighed score is
  `relevance × (0.5 + 0.5 × confidence)`; quotes of past sessions count as 0.5. The counts come in one query
  (`items.eventCounts`).
- **Standing** (`#standing`): a claim's anchors are checked (`AnchorCheck`, one `stat` per file per request) and its
  values (`valuesOf`) compared with the request's environment (`requestEnv`). A gone file or a symbol gone from a
  changed one holds the claim back; a changed file is a label and a lower confidence. A value the environment
  contradicts holds it back as *contested* (one `contested` event per class and value); the environment speaks only
  for its own project and global claims (M3-D26), so another project's claim whose folder differs is held back as
  *of another project* with no event. Explicit search keeps what is held back, flagged.
- **What a correction retires** is the claim it names by id (`brain.correct`): superseded, its engine copy
  invalidated, errata to the sessions shown it. No overlap of words retires anything or casts a doubt (d3). A learning
  pass is given the claims its session was shown up to its last turn (`brain.shownClaims`: its injections' `i<n>`, the
  most recently shown first, at most `SHOWN_CLAIMS` 30, threads and always-allow offers left out) and says which it showed wrong and which
  held (`brain.judgeShown`, d4): a `suspected` event `{ chain, project, turn, n, why }` once a session, which lowers
  confidence and goes to the curator, and an `evidence` event (`#evidence`: once a session, never its own).
- **Labels.** A line shows `✓n` when n ≥ 2 sessions said it, and *file changed since* when a file it names moved; a
  legend under the lines explains the marks shown.

**At the moment of action (HarnessV3-Memory M5).** What memory knows of a tool call is said on its result:
- **Where:** on a proxied client's tool-result leg, the calls of the assistant message before it (the block is kind
  `rule`, kept by the leg's hash); in the harness loop, each hand, web or MCP call's own result (`reminders` in the
  loop's options, from the session's memory handle).
- **What:** `brain.remindersFor` = `pitfallsFor` (the triggers on the call's shapes whose words it carries
  (`callCarries`) and whose right way it lacks (`holdsWay`); armed by the user's word or a second session's evidence;
  standing and above the gate; a trigger with no right way once a conversation, M7-D25; a `fired` event each time;
  a call that holds the right way notes `followed` when the conversation's last act on that trigger was a `fired`,
  and `kept` when it had none and the trigger is in force, M7-D63: neither is evidence)
  then `threadsFor` (standing threads anchored to a file the call names, or a folder holding one; once a
  conversation). The
  rules that act follow on proxy legs.
- **Observation:** the same leg (`toolResultsOf`) and the loop's call ends are pushed to the observation bus
  (`memory.observe`); the pitfall miner files what it sees through `brain.fileSeen` (the same trigger on file: evidence;
  else a learned fact with the trigger, whose near claims in words count only when they have no trigger of their own).
- **Threads:** the learner is shown the project's open threads by id and the goals of its procedures; a thread a
  session finished is closed by `brain.settleThreads` (a learned one dismissed, the user's own asked about as an inbox
  `close` question); a model closes one itself with `filament_memory_close` (`brain.closeThread`, M7-D64), through the
  same `#closeThread`, the finder of a sub-agent or agent named on both events; `state.open` and `state.next` lines
  become threads.
- **Procedures:** served when a task names their goal (`goalCover`), first and whole in a turn block; listed by goal in
  the dossier's "How to"; a claim with a trigger goes under "Pitfalls".
- **Silence (M6-7):** where the brain's `prepare` stops (a muted chain, the autopilot off, a capture-only or quiet
  request) its prep carries `silent: true`, and the harness loop that request starts takes no memory handle: no
  reminders on its calls and nothing pushed to the bus.
- **A sub-agent's run (M7-D3)** is quiet but not silent: a request with `x-filament-subagent` in a session whose memory
  and autopilot are on gets its reminders and teaches the miner, as the session's own loop does. Its calls belong to
  the turn that launched it (`prep.launchTurn`, read by `turnOfRequest` from `x-filament-subagent-of`); a developer's
  launch has no launching request, so its calls belong to no turn.
- **A loop's tick (M7-D20):** a quiet request with `x-filament-agent-of` is a round of the loop that request started.
  Its prep carries `loopTurn`, the turn of that request, so what its memory tools write is on the loop's turn. When
  the run is a sub-agent's (`runOf`, the request records), `loopTurn` is the turn that launched it and `finder` names
  the sub-agent (its id and the model), so its `remember` and `correct` are its findings (origin `subagent`).
- **A conversation (M7-D25)** is the model context a handle speaks for when it is not the session's own: a sub-agent's
  `sa_` id (`prep.conversation`). A reminder is said once per conversation (the `fired`
  detail's `conversation`, read by `lastAct` (the newest of `fired`, `followed` and `kept`) and the once checks as
  `conversation ?? chain`), the miner keys on it,
  and the handle's deferral and recall are its own.

**A worker's brief (HarnessV3-Memory M7-1).** `brain.brief({ projectId, chainId, turnId, purpose, task, tools, budget })`
is what memory hands a worker that starts without the session's conversation: a sub-agent (`purpose: "subagent"`) or an
outside agent (`purpose: "agent"`). The sub-agent registry opens a sub-agent's first message with it, as
`<memory>…</memory>` after the conversation view, whenever the session's memory is on: no switch turns it off (the
owner's of 11-09; `subagents.memory`, M7-D11, is gone, and a session that still holds it is read without it).
- **The layers,** in the briefing's line format, each line with its id: the session's errata (what it was shown in the
  last 14 days that was retired or corrected since, newest first, up to 10; a merge is none, M7-D13); the user's rules;
  the project and its dossier, without the lines that rest only on pitfalls (M7-D15); the procedures the task names,
  whole; the pitfalls of the tools the worker may use (`handsIn(mode)`, M7-D14; armed, standing and above the gate,
  from `triggers.onTools`; one a dossier line cites beside other claims is said whole here too); the open threads on
  the files the task names; what
  else the task matches, with quotes of other sessions only (M7-D10). The room is the budget, else the briefing's and
  the turn block's together.
- **Not twice (M7-D9):** a sub-agent's requests carry the session's briefing where it has one and its settings keep
  it on, read through the one resolver (`settingsOf`, M7-D16), so the brief skips what it showed (`meta.briefingIds`)
  and says so in its head.
- **Refused:** memory or its autopilot off, or the session muted, gives no brief and says why; so does a task nothing
  applies to.
- **Logged (M7-D12):** as an injection of kind `brief` on the launching turn, with no request id, so a claim it showed
  that is retired later reaches the session as an erratum.

**What a sub-agent found (HarnessV3-Memory M7-2).** What a sub-agent establishes goes back into its session's memory.
- **The event (M7-D17):** an exchange that ended done with a report (`ok`, a report that is not blank) calls the
  registry context's `reported`. The server pushes `{ type: "subagent.report", chain, turn, id, agentType, model,
  task, report, calls }` onto the observation bus, `turn` being the launching turn (`turnOfRequest`); the project is
  the session's, read from its chain.
  `calls` is `callLog(convo)` (`core/messages.js`): each tool use, its input JSON redacted and cut to 200 characters, and `ok: false` for a
  result that was an error. A `reported` that throws is logged and never fails the exchange.
- **The line (M7-D17):** the bus's observer hands the event to `learner.findings(e)` and does not wait on it, since the
  bus awaits its observers. The learner reads reports one at a time on a promise chain; `settled()` resolves when
  every report handed over has been read.
- **The reading (M7-D18):** skipped for no chain, `capture.learn` off, `learningOptOut` (muted, no-learn), no learning
  model (`summarizerModel()`), or an empty report. `FINDINGS_PROMPT` asks for facts, conventions and procedures only,
  opening with what memory is for: what a later session could not re-read from the code or git. The user text is from
  `findingsText`: the task (4,000 characters), the newest 40 calls, the report (16,000, both ends), redacted, then the
  procedure goals. One retry; `bad json`. The items go in the order of their importance, and at most `FINDINGS_MAX` (3,
  the memory plan's d5) are filed; the rest count as `over`. A kind outside `FINDING_KINDS` is refused, junk, code
  and a one-step procedure are junk, a secret's shape is counted, the daily cap applies.
- **Filed (M7-D19):** `brain.fileLearned(..., { via: "filament-subagent", origin: "subagent", finder })` on the
  launching turn: inferred, labelled "a sub-agent found", confidence 0.55; the finder `{ agent, type, model }` is on
  the item's `created` event, and `claim()`, `history()` and the claim browser's card carry it. The brief's legend
  explains the label when a line has it. Evidence still counts only from another session.
- **The trace (M7-D21):** a learning op per report (`reason: "subagent"`, the agent named): start, the proposed count,
  then done with the counts (filed, deduped, refused, junk, secrets, over) or skip with why; a `recent` row; the curator
  is told (`onLearned`) when anything was filed.

**Sleep (HarnessV3-Memory M4).** Between sessions the curator (`services/memory/curator.js`) consolidates a project's
memory. The model judges, rules choose:
- **The passes:** memory pokes the curator as a learning run lands in a project and as a chat of it starts a turn
  (`curator.poke`); a scope — the project, and the global claims — runs a pass in the background where it is due
  (`curator.due`: a claim filed, said again or reworded since its last pass began, that pass `curator.everyHours` old,
  before the first its first claim; `items.changedSince`, `items.firstStandingAt`), never queued twice. No clock, no
  day's budget. And on demand.
- **The steps:** threads under the confidence gate expire; a claim whose file has been gone a day is retired; a
  finding (origin `subagent` or `agent`, a fact or a convention) lapses — dismissed by `#lapse`, quiet: no erratum, no
  brief's line (`#retiredSince` skips a status event's `quiet`) — once `injections.judged` counts `LAPSE_SHOWINGS` (3)
  judged showings in turn blocks (a briefing's dossier line is judged in its own words) in `LAPSE_SESSIONS` (2)
  sessions, none used, and no `evidence` event says another session said it (d5); unkeyed values are keyed from their
  own words, the keyer shown the scope's slots in use, the user's word first, at most `SLOTS_SHOWN` (`#keyText`, M7-D71), and a note given more than one slot left `unkeyed` ("it names several
  values"); claims that say the same thing merge onto the survivor the rules pick
  (the user's word first), their pairs found by shared words and by meaning (`#nearPairs`, f6: each standing claim
  of the project not in `item_near` (`curator.nearLooked`) with a copy in the engine (`memory_id`), the oldest first —
  one whose lookup failed in this process (`#nearFailed`) last —, `NEAR_QUERIES` 100 a pass (`NEAR_QUERIES_SLOW` 20
  where hello says no `vec`), none where the merge has no call left (`#room`), looked up by
  `store.dense(…, { strict: true })` on its words, `NEAR_CHARS` 500 — strict, an engine that could not embed fails the
  call instead of finding nothing; of the `NEAR_SCAN` 16 nearest rows, every project's, the first `NEAR_TOP_K` 3 from
  `NEAR_MIN_SIM` 0.75 whose claim (`items.byMemoryId`, indexed by `items_memory`) is another standing one of the
  project that `mayMerge` and no word pair; a pair is both its claims', whichever found it; once judged and merged, a
  claim whose pairs are all settled — known or judged distinct, or merged into one group — is marked (`lookedNear`,
  with the run; `undoRun` deletes the run's rows; `item_near.item_id` references items `ON DELETE CASCADE`, so a
  claim deleted by any build takes its row, and `#dropItems` deletes it too; `curator.forgetNear` unmarks a claim that
  stands again (`setItemStatus`'s revive) and both claims of a `distinct` verdict undone (`#undo`)); none while
  `brain.reembedding` (set by `MemoryService.reindex` — a new model's, the console's — and around an import's) or
  with an engine whose hello says no embeddings; a failed lookup is skipped, `NEAR_FAILS` 3 in a row stop the pass's
  lookups), each pair judged in the same batches (`MERGE_PROMPT`); a claim whose file changed is checked against the file; each claim's suspicions since it
  was last judged go to the model beside what cast them (`SUSPECT_PROMPT`, M7-D68): a learning pass's finding ("Found
  (session, turn): why", d4) or a correction on record (`detail.correction`); unrelated is `cleared`, wrong retires a
  learned claim — dismissed for a finding, onto the correction for one (`#retire`, so the user's word is asked about) —
  unsure is `weighed`, and one project's word only weighs a global claim; a claim the dossier is about to be written
  from (`#dossierSource`) — not the user's word, a thread or a finding (origin `subagent`/`agent`) — with a turn of its
  own that can be shown (finished, not rewound nor a command, not kept apart, its chat not kept to itself) and no
  standing `grounded` event is checked against that turn (`#ground`, `GROUND_PROMPT`, f2), six to a call, the most
  shown first, each turn shown once in a call for its notes there (`#turnView`: the person's words, the calls that name
  the notes with their results — `callsWithResults`, a result's hits ranked before an input's, a failed one marked,
  memory's own tools left out (`MEMORY_TOOL`: Filament's and `/mcp/memory`'s) and its reminders and Filament's notices
  stripped from a result (`REMINDER_LINE`), at most `GROUND_RESULTS` — and the answer, each cut around the notes' words
  by `excerptIn`, the notes' terms `interleaved`; every part `blanked` before it is cut: `redactSecrets` and
  `MORE_SECRETS` — env and config lines, URL credentials, private keys, live and test keys — then
  `redactUnterminatedSecretTail`) — holds a `grounded` event (verdict holds: +0.05 in
  `confidenceOf`, read by `eventCounts`; no `evidence`, so `✓n` and `#lapse` count sessions alone), wrong `#retire`,
  unsure a `grounded` event that counts nothing, no answer nothing (asked next pass); the fence's verbatim old items
  become restore questions; the project's dossier is written, its open work from thread claims alone (a session gives its title,
  date and summary, M7-D66).
- **Patterns across sessions (f4):** after the dossier, a project's corrections of the last `ADOPT_DAYS` 90
  (`#corrections`: a turn the user corrected, `outcomes.correctedSince`, read as the message after it,
  `archive.turnAfter`; the claims of origin `correction` made in a turn, with what they replaced,
  `items.correctionsSince`, a claim on file the user was heard correcting to placed by its `heard` event's chain and
  time; the learner's `suspected` events with a why that no `cleared` followed, `items.suspicionsSince`; each
  `blanked` and cut to `ADOPT_CHARS` 300, one a ref, the newest `ADOPT_MOST` 500; a turn kept apart or a chat kept to
  itself gives none; each counted by its session's lineage, a fork its parent's through `forked` links) become
  patterns (`#patterns`, each pair compared once: two are alike where they share `ADOPT_SHARED` 2 identifying words
  and half the fewer's; the correction alike to the most of other sessions is a centre, and one joins it where it is
  alike to every member already there, so every two of a pattern share words). A pattern of `ADOPT_SESSIONS` 2
  sessions or more that holds no correction one of this step's questions was drawn from (any status) and a session
  none of whose corrections was judged lessonless is put to the model (`ADOPT_PROMPT`, at most `ADOPT_SHOWN` 8 lines,
  the newest of each session first), beside the user's rules, preferences and conventions (`items.usersWord`) and the
  lessons of this step's rejected questions that share its words (`ADOPT_NEAR` 3 of each, R1… and D1…). The model's
  `same` drops it; its `replaces` raises a question of kind `retire` naming that rule (`proposal { action: "correct",
  id, text, sessions, from, reason }`, `itemIds [id]`: the rule stands flagged through `inbox.asking`, as M6-D16's
  later value does, and `decide` corrects it); else a rule `grounded` in its lines raises one of kind `adopt`
  (`{ action: "adopt", kind: "rule", text, sessions, from }`, no `itemIds`) - `from` the corrections' refs, by which
  `inbox.ofKinds(["adopt", "retire"])` finds this step's questions. No lesson, one the model calls the same
  or an ungrounded rule keeps its corrections' refs (`schema_meta.curatorAdoptNone`, the newest 1,000). `brain.decide`
  accepts an adopt through `remember(text, { kind: "rule", by })`: the user's rule. The pass reports `adoptAsked`,
  `adoptChange`, `adoptDropped`, `adoptLeft` (the patterns due that the budget left).
- **About the user, everywhere (f5):** after it, the slots of subject `user` (slots.js `aboutUser`) this project's
  standing claims hold (`items.inUserSlots`: every standing claim in them, of any project or none), grouped into
  things: a single-valued slot, or a multi-valued slot's value (`slotNorm`). A thing of this project's, whose claims
  are of `EVERYWHERE_PROJECTS` 2 projects or more, held by no claim of no project (a single-valued slot by any; a
  multi-valued one's value by one that holds it, `holdsValue`, so one set on the Memory page holds what its words name), asked by no open `everywhere`
  question, and with a claim of a project none of whose claims was judged (in a question's `proposal.from`, any
  status, or in `schema_meta.curatorEverywhereNone`, the newest 1,000) is put to the model (`EVERYWHERE_PROMPT`, at
  most `EVERYWHERE_SHOWN` 6, the newest of each project first, each with its project's name), which answers `{ keep,
  same, why }`: the one true of the user in every project and the shown claims that say the same, or null. Its pick
  becomes a question of no project, kind `everywhere` (`proposal { action: "everywhere", kind, text, slot, value,
  multi, pick, from, projects }`, `from` the pick and its `same`, `itemIds` the pick, key `everywhere:<slot>=<value>`:
  rejected, never again for that value); the thing's other claims, and all of them where no question was raised (none
  picked, or a key asked before), go to the none-list. `inbox.about` finds a question by its `pick`, so the pick
  retired or corrected withdraws it. `brain.decide` withdraws one whose pick no longer stands, else remembers its
  text as the accepter's, of no project, in its slot — or corrects the claim of no project a single-valued slot holds
  already, or takes the claim of no project that holds a multi-valued slot's value — and supersedes each standing
  claim of `from` by it. `fileLearned` reads a user slot's claims of no project beside the project's: the same value is
  evidence for it, the project's own learned single-valued values of the slot superseded by it first; another value
  in a single-valued slot is dismissed for the user's word and asked later (M2-6), the user's line flagged and the
  legend explaining it in this block too. A confined handle (port.js, `brain.questionReaches`) neither lists nor
  answers an `everywhere` question, nor one about another project's claim, and a confined session's cue counts only
  the questions it reaches. The pass reports `everywhereAsked`, `everywhereLeft`. The briefing's
  `#everywhereLines` shows the user's facts and decisions of no project (`items.usersWord(null, EVERYWHERE_KINDS)`)
  under "What holds in every project (the user's own word):", one in a user slot first, `IDENTITY_LINES` 6 in
  `IDENTITY_SHARE` 0.1; the engine's canonical facts are no longer read.
- **Topic pages (f7):** last, `#page`: `#topics` groups the project's standing claims that clear the gate (no thread, none
  whose file or symbol is gone) by their slot's subject (not `project`, a user slot or a procedure's goal: `about:<subject>`)
  and by the folder in the project (`ctx.root`) of each anchor (a folder anchor is its own; none for the top folder:
  `dir:<folder>`); a topic of `PAGE_MIN_CLAIMS` 3 claims or more keeps its `PAGE_CLAIMS` 30 surest and most important
  (`sources`: each `brain.pageSource` - `[id, a hash of its words]` - and `basis` their hash). A topic with no page
  first, the larger first; else the one that moved most since its latest page (ids in or out, a hash changed), once
  `PAGE_REWRITE` a third of its sources moved; one whose basis is its page's or in `schema_meta.curatorPagesNone`
  (`<project>:<topic>` → basis, the newest 500) is skipped. With no call left (`#room`, before the topics are read) none.
  The pick is put to the model (`PAGE_PROMPT`, the dossier's claim lines); `groundDossier(sections, sources,
  PAGE_SECTIONS)` grounds it (`SECTION_LINES` 6 a section), `capPage` keeps it to `PAGE_LINES` 10, no more characters
  than its cited claims' and `PAGE_MIN_CLAIMS` cited (lines dropped from the end), else the none-list; an answer with no
  JSON goes on none. `archive.pages.add` writes a version (its `slug` the topic's first, `pages.slugFor`).
  `brain.pageBlock` renders a page live (a line while every claim it cites stands, is not held, is of the page's project
  and hashes as its source: an id SQLite gave again, or words changed in place, is not the claim; `PAGE_SHOWN` 2 lines
  or none); `brain.search` answers `page:<slug>` alone before `retrieve` (`#namedPage`), else adds pages (`#withPages`,
  the asker's project or the one searched): a page whose live cites hold `PAGE_HITS` 2 of the hits or more, `PAGE_SHARE`
  a third of them or the page no longer than they, in the first's place, those hits dropped (`covers`: port.js credits
  them; `shows`, every claim its lines carry: memory-mcp.js logs them shown; `idsInView` reads a page result's cites,
  `PAGE_CITES`), `PAGE_SERVED` 2 at most; `#dossierBlock` links the first placed line a
  page's live lines rest on (`#pageLinker`, `→ page:<slug>`, each page once) and `legendOf` explains it. `undoRun`
  marks a pass's pages undone; `deleteProject` deletes them. `GET /api/memory/pages?project=` (`brain.pagesOf`).
- **Each step's calls** are capped (`STEP_CALLS`: key 2, merge 4, re-verify 4, suspicions 2, ground 2, dossier 1, adopt 2, everywhere 2, page 1), so one step
  never spends another's, and the dossier's call is kept from the steps before it (`#left`, f1) where it will write
  (`#keepsCall`: its basis moved since its last version; read once, where a step would take the last call): that step
  stops a call short. A dossier that would stand keeps none; where the step's last call then moves the basis, the
  dossier is owed (`dossierOwed` on the run) and `due` holds the project due on its next poke. A step the budget stops ends its loop where it stands (`#room`), its counts
  kept, and `ctx.stopped` says so. Re-verify takes a claim not checked in 7 days (`RECHECK_AFTER`) before one checked
  since, then the claims the dossier cites, then the most shown in 30 days (`injections.useCounts`), then by id; the
  rest wait (`reverifyLeft`).
- **Undo:** every action is an `item_events` row of its pass (`curator_runs`), so a pass can be undone, marked, never
  deleted.
- **The user's word:** what would retire it goes to the `inbox` as a question, and is served marked *in question*
  until answered. A learned value said after the user's in its slot (M6-D16) is held off (`dismissed`) and
  `brain.askLater` asks whether it replaces theirs: a `correct` proposal keyed by the user's claim and the value, so
  the same value is asked once. The user's line says *said otherwise later: <value>*; accepting runs `brain.correct`
  with `answering`, so the question it answers is not withdrawn by the retirement it causes. Its three callers:
  `fileLearned` (a value learned at filing), the curator's `#settleSlot`, and `#oneWay` (a learned procedure for the
  user's goal).
- **Withdrawal:** when a claim is retired, by anyone, the open questions about it (`inbox.about`: what they would
  retire or correct, or what would replace it) are withdrawn at once, with the reason.
- **The dossier:** versioned in `dossiers`, a new version only when its `basis` moved: the claim ids it is written
  from, sorted (f1: the same claims ranked anew write none), and its sessions as the model reads them, each its id and
  the hash of its text (`#dossierSource`). Its claims rank by confidence × importance × `useWeight` (f3, brain.js
  `dossierUse`: the use rate over `injections.recentUse(refs, "turn", USE_LAST)`, a claim's last 9 judged turn
  showings — turn showings alone, a briefing's verdicts weighing a claim down for being in the dossier; the last few, not
  a window of days, which would let a claim in the dossier, shown in no turn, lapse as days pass — in thirds once
  `USE_JUDGED` 3 were judged: 1, 1.15, 1.3), for the curator's candidates and `#dossierClaims` alike; a claim is `unused` where
  `injections.briefedSinceUse` counts `DOSSIER_UNUSED_SESSIONS` 5 sessions whose briefing showed it, judged and not
  used, after its last use (`memory_last_used`: when a use was judged, written by `markUsed`, `creditShownIn` and
  `usedNow`; a use judged before that table was kept counts at its showing's time; each claim's last use materialized
  once a query), unless it
  keeps its place (`keepsItsPlace`: `NEVER_FADES` kinds, a thread, `userBacked`, a pitfall). No window: a claim left
  out is in no briefing's dossier (a briefing's recall may still show it, and that counts). An unused claim is passed
  over by the curator's 80 (`dossierUnused`: those that would have been among them, said by `@mem curate` beside a
  version), by `#dossierClaims`, and by a written version's render (a line whose claims are all unused), the last two
  counting it in "…and N more". A briefing's showing is judged on its session's every reply (`#judgeBriefing`: a
  request after the one that built it is `#briefingDue`; its reply and calls are judged against the briefing's pairs,
  kept by chain, else its claims' texts, the reply's five-word runs built once; a use credits the briefing's showing
  through `creditShownIn`, once a session, and every use sets the last use). A written version's line held back is
  hidden before it is asked whether it went unused. Each line cites its claims, and a line shows only while every claim it
  cites stands. The version is pinned on the chain with the briefing (`meta.dossier`).
- **Model calls:** they go through `callModel` as purpose `curate`, on memory's model for the project
  (`memory.curatorModel`: the one set, else its newest chat's compaction or own model; "" where `curator.usesModel` is
  off), at memory's effort, within `memory.curator.maxCalls` a pass. Each asks for the most its model can write inside its window (`callRoom`, HarnessV3-FailurePoints
  §13), so a reasoning model's thinking never eats the answer's room; no answer is asked again for its length. A
  provider busy for a moment is, as for learning (`RETRIED`: purposes `learn`, `curate`; `withRetries`, core/retry.js,
  an HTTP failure or an error inside a 200 stream, a wait memory closing ends); `maxCalls` counts the call once, however
  many tries. A call someone waits on, and a chat's name, fail at once.
- **Memory closing (M7-D70):**
  - **The curator:** `MemoryCurator.stop()` cuts the pass going (`#current`). It aborts the pass's `AbortController`,
    whose signal its `callModel` calls carry. It ends the run through `#finish` while the archive is still open, with
    `detail.cut`. `#step` and `#ask` write nothing once `ctx.cut` is set.
  - **The calls:** each call is written on the run as it is made (`curator.count`), so `callsSince`, the day's budget,
    counts passes still going and passes a killed process left open.
  - **The learner:** `MemoryLearner.stop()` is final. It aborts the signal its calls carry, and a run or reading that
    then fails ends `skipped: "memory closed"`, never an error. The service builds a new learner when memory opens.

The one-line visible cue (`autopilot.cue`): on the first reply of a chain, when the brain found related chains or
items, Filament prefixes the assistant text with one line naming up to three of them and how to load one.

## 7. Memory as a tool

Tool names and schemas (Anthropic `input_schema`, converted to OpenAI function and Responses tool shapes):

| Tool | Input | Returns |
|---|---|---|
| `filament_memory_search` | `{ query, limit?, project_only? }` | memories and turn summaries with ids (`i<n>` for a claim, `s:<chain>:<n>` for a past session's words), trust, scores, chain and turn refs; flags for what the autopilot would hold back or mark (*file gone*, *contested: the environment says …*, *of another project: here …*, *file changed since*, `✓n`) |
| `filament_memory_sessions` | `{ query, limit? }` | chains matching your past inputs: id, title, project, client, when, state |
| `filament_memory_load` | `{ session, view?: "chat"|"summary"|"full"|"compact", from_turn?, to_turn?, budget_tokens? }` | the rendered session material |
| `filament_memory_remember` | `{ text, kind?: "fact"|"rule"|"preference"|"decision", importance?, quote? }` | `{ stored, id, quote? }` — the model's note: inferred, unpinned; never revives a retired text. `quote` found in the person's own words of this chat's turns (brain.js `#heard`: folded case and spaces, `typedWords` — text blocks that are no Filament notice, then `ownWords` — of `archive.personTurns`, no apart, rewound, command, `own` or brief turn nor one Filament began (`by`, core/turn-by.js), no compaction summary, no sub-agent's or MCP agent's call, the call on a turn) and saying the claim (`quoteSays`: half its identifying words and numbers found in it): origin `capture`, the created event's `quote`, `turn`, `filedBy`; a note on file with its words takes origin `capture` and a `heard` event |
| `filament_memory_correct` | `{ id, text?, reason, quote? }` | `{ ok, id, replaces, quote? }` — the new text supersedes the old item (kept); without text, the item is retired. `quote` heard as for remember, from a turn no older than the claim it replaces: origin `correction` (a text on file takes it, with a `heard` event), and the user's word it replaces is not asked about |
| `filament_memory_close` | `{ id, because }` | `{ ok, id, closed }` — an open thread whose work is done, dismissed with `done: <because>` and a `closed` event; the user's own is asked about (`{ asked }`); any other kind refused (M7-D64) |
| `filament_memory_confirm` | `{ id }` | `{ ok }` — counts as a use; only the user makes an item confirmed |
| `filament_memory_forget` | `{ id, reason? }` | `{ ok }` — retires (dismissed, kept, engine copy invalidated) |

Briefing text tells the model these tools exist and when to use them (references to past work, starting on a
project, missing context, before repeating a mistake, a thread whose work is done). The **server-side loop**: when the upstream reply contains a
`filament_memory_*` call, Filament executes it against the brain, appends the assistant message and a tool result to
the outbound body, and re-requests the same upstream; at most `autopilot.toolIterations` (4) rounds. The client sees
one message: for non-streaming replies the final response is returned with usage summed; for streams, text deltas
flow through until a memory tool block starts, that block and its stop events are withheld, the follow-up reply's
content blocks continue with renumbered indices, and a single terminal event is sent at the end. Tool calls and
results are recorded on the request by count and ids only. Client-defined tools are untouched and returned as usual.

Agents Filament runs (ACP) get the same eight tools through an filament-hosted MCP endpoint `POST /mcp/<token>`
(streamable HTTP, JSON-RPC: `initialize`, `tools/list`, `tools/call`, `ping`), the token a per-process 24-hex secret
in the server definition Filament gives the agent. This replaces passing Mnemosyne's own MCP server.

**Memory for any agent (M7-6, M7-D38..D47).** An agent Filament does not run adds `/mcp/memory` once
(`claude mcp add --transport http filament-memory http://127.0.0.1:20300/mcp/memory`, with its inbound key as a Bearer
header). `src/http/memory-mcp.js` is the door:
- **Who may call (D39):** a foreign `Origin` 403, the house key, else an inbound key when any is set (401), else
  loopback only.
- **The protocol (D38):** JSON-RPC over POST, single or batch; 202 for notifications and answers; DELETE ends a
  session; GET 405.
- **Sessions (D40, D41):** an `Mcp-Session-Id`, adopted after a restart, 404 once ended.
- **The folder (D42):** the call's `cwd`, the `x-filament-cwd` header or `?cwd=`, else the client's first `file://`
  root, asked with `roots/list` on an SSE answer.

`src/app/memory-mcp.js` holds the thirteen tools by short names (D44):
- the reads `brief`, `search`, `claim`, `history`, `pitfalls`, `questions`, `sessions` and `load`;
- the writes `remember`, `correct`, `close`, `confirm` and `forget`, which run `executeMemoryTool` and so answer as the
  models' tools do.

A session's chain:
- **When it is made.** It is memory's, of kind `mcp` and keyed `mcp:<id>`, made on the session's first call that
  reads or writes memory (`memory.mcpStand`).
- **What it is shown is logged** (`handle.shown` → `brain.noteShown`), so a claim retired later opens its next answer
  as an erratum (`handle.errata` → `brain.sayErrata`), once.
- **The opening.** `initialize`'s `instructions` carry a guide and, when the folder is known, a 600-token brief (D45).
  Settings → Memory writes the command (D46, `GET /api/memory/mcp`: the path and whether a key is asked, never a
  key).

The whole contract is in memory-guide chapter 10.1.

**Who asks.** Every write goes through a handle from the memory port (§3, `port.js`), and the handle's role is its
`by`. A request's tools ask as the `model`, filed in that session and turn. An agent over MCP asks as the `agent`, in
its folder's project. `@mem` asks as the `person`, and the dashboard and its assistant as the `owner`. The person's
and the owner's word stands: it is confirmed and can bring back what was retired. A model's or an agent's write is a
note: inferred, labelled "assistant noted". An agent's over `/mcp/memory` is its finding, named for its client (origin
`agent`, "an agent found", 0.55, M7-D47). Only the owner sets a status directly. Since M2-3 every line memory serves is
a claim (`i<n>`): an engine row with no claim behind it is adopted as an `imported` one when first seen.

## 8. Commands

Messages whose first line starts with `@mem` (configurable `commands.prefix`) are answered by Filament without
forwarding. `status`, `recall <words>`, `remember <text>`, `forget <id>`, `sessions <words>`, `load <n|id> [view]`
(injects into the next turn of this chain), `off` / `on` (mute this chain), `new` (split the chain here), `curate`
and `undo <r>` (a curator pass), `inbox`, `accept <q>` and `reject <q>` (memory's questions), `help`.
Headers: `x-filament-memory: off|on|tools`, `x-filament-memory-load: <chain>[:<view>]`. Admin API: `/api/memory/*`.
`tools` is `off` (quiet: nothing archived, captured or injected; earlier injections kept byte-identical) plus the seven
memory tools whatever the chain's age — what an agent-loop tick sends on the developer's own conversation, so the
tools the model uses mid-loop are scoped to that session while the tick itself leaves no trace of its own.

## 9. Learning at boundaries (`memory-learn.js`)

Triggers: a compaction a window adopted (below), a chain idle for `capture.idleMinutes` (30), an import. Work: memory's model for the chat (`memory.modelFor`, `services/memory/model-choice.js`: the model set in Settings › Memory, else the chat's compaction model, else its own — a sub-agent's chat's, the chat that launched it —, else the most recently active chat's; a coding agent's model through a provider's route only; never the cheapest; low effort unless `models.effort` says) reads the finished turns since the
cursor (`meta.learnedThrough`), in passes, and returns JSON: `{ title, state: { summary, done, open, next },
items: [{ kind, text, importance, turn, slot? }] }`, where `slot` is `{ subject, attribute, value, multi }` for an
item that states the current value of one thing. Each item is filed against the record by `brain.fileLearned`
(HarnessV3-Memory M2-5, M2-6), in this order:
   - **The same words, or the same value in its slot, already standing:** an `evidence` event on that claim, once per
     session, not a second claim. The same words retired are left as they are: the learner never brings back what was
     retired.
   - **Near-duplicate words the engine serves** (0.8 word overlap) of a claim in this project or a global one: evidence
     when that claim stands. When it was retired, the new claim is filed dismissed, naming it. Another project's
     claim, a quote of a past session and what an ability held are not duplicates. For a keyed claim the near one
     must hold the same value: "uses pnpm" and "uses bun" share every other word. A thread is near only to a thread
     (M7-D65): open work and a fact in the same words are two claims.
   - **Otherwise a new claim,** `inferred`, mirrored to the engine with turn metadata, capped at `capture.dailyCap`
     (200). In a single-valued slot the newer word wins, by when it was said (the turn's start), not when it was
     learned. The values said before it are superseded by it, with history and errata. When one was said after it, it
     is filed superseded by that one.
   - **The user's word holds its slot.** A learned value never supersedes a claim the user said, corrected or
     confirmed: it is filed dismissed, naming that claim.
   - **Authority needs the person's own words.** A learned `rule`, `preference` or `decision` is filed as a `fact` unless the
     person's own words of its turn say it: a third of its key words among theirs, with pasted, quoted and
     filament-written text left out. The claim's history says why. Compaction summaries become a `compactions` row. The engine is never asked to `sleep`:
what it would write by itself is fenced off on every start and never served (HarnessV3-Memory MD-0). Memory's model is called through
Filament's own front door with `user-agent: filament-memory/0.1`, `x-filament-memory: off`, `x-session-id: memory-<id>`,
so its cost appears in Usage and it is never captured.

A sub-agent's report is read the same way, on its own line and with its own prompt (`findings`, §6, *What a sub-agent
found*): what it establishes is the sub-agent's finding (origin `subagent`), never the user's word.

**A compaction learns now (HarnessV3-Memory M7-5).**
- **One door (M7-D27):** `memory.compacted(chainId, { door })`, called right after a compaction's row is written,
  starts `learnChain(chainId, { reason: "compaction", door })` off the hot path. The doors: the compactor's `run`
  (`line`, `manual`) and `/autofit` (`autofit`) in the sessions service; `afterReply` for a client's own summary
  (`client`, once `brain.afterReply` answers the chain whose row it wrote: an empty reply writes none). It answers
  `{ learning: true, model }` or `{ learning: false, why }` (`#learningOff`, the widest switch first). The compactor
  puts the answer in its note (`learningWords`) and op detail (`learningDetail`), as `/autofit` does; `afterReply`
  traces `learning starts now` or `learning off`. Not a loop's round fold or a fork's brief. Undo does not undo
  learning.
- **Passes (M7-D28):** `archive.turnsToRead(chainId, { fromTurn, calls })` gives the turns past the cursor (from 1 when
  forced) up to the newest finished one, command and rewound turns left out, and `through`, the newest finished turn.
  `passesOf` groups them: PASS_TOKENS 12,000, PASS_TURNS 16, each turn kept to TURN_CHARS 24,000 (both ends); a run
  reads MAX_PASSES 12 and notes the session for the rest. `#readSpan` reads one pass: the user text is
  `Project: <name>.[ The session so far, as learned from its earlier turns: <state summary>] Session turns a to b:` and
  the turns, redacted — after how the reply before the pass's first turn ended (`#replyBefore`, its last
  `REPLY_BEFORE_CHARS` 400; none for turn 1) — then the threads, the goals and the claims the session was shown
  (`noteList`), read again per pass; output 3,000 tokens; one firmer retry. Then
  `ingest(..., { through: last, span, notes })`: its `corrected` turns mark the replies they answer (d4), its
  `contradicted` and `held` go to `brain.judgeShown`; the span's last turn settles threads, is a thread's turn and an item's
  said-at fallback; the cursor moves there (`#advance`: never back) unless the pass was capped, which stops the run.
  No JSON: split the pass, or pass over a single turn (a warning milestone, the cursor past it), only once the model
  has answered JSON (`#answered`); before that, `bad json` and the cursor stays. A model error rejects the run: what
  landed stays, the totals return with `error`. The ops: one start (door, passes, left), a milestone per pass, one end
  (advanced, door, passes, passedOver, left); `meta.lastLearn` carries passes and through.
- **The calls (M7-D29):** each turn reads with its newest 40 calls (`callLog`: Anthropic `tool_use`, OpenAI
  `tool_calls`, Responses `function_call`; `is_error` marks a failure), through `callsRead`, between the person's words
  and the answer. `LEARN_PROMPT`'s rules for calls and for the end state say how to read them.
- **One run a session (M7-D30):** a compaction's run that comes while one is going (`running`) waits in `#again` and
  starts when that one ends; any other gets `{ skipped: "running" }`. `settled()` waits for the findings line and
  every run.
- **First-hand (M7-D31):** a run reads the session's own archived turns. The history of a conversation Filament
  joined midway, never archived, is not learned.

## 10. Config schema (`memory` group)

```
enabled: true
folder: ""                                       ("" = <dataDir>/memory)
engine: { autoInstall: true, python: "", version: "3.15.1", embeddings: true, bank: "default" }
autopilot: { enabled: true, mode: "conservative"|"eager", briefingTokens: 4500, turnTokens: 300, minScore: 0.2,
             tools: true, toolIterations: 4, loadBudgetTokens: 30000, cue: true, rewrite: false }
capture: { turns: true, learn: true, idleMinutes: 30, dailyCap: 200, messageCapBytes: 1048576,
           inputCapChars: 4000, excludeClients: [], excludeModels: [], excludeFolders: [] }
models: { summarizer: "", effort: "" }             ("" = not set: services/memory/model-choice.js; effort "" = low)
curator: { enabled: true, usesModel: true, maxCalls: 20, everyHours: 6 }
commands: { enabled: true, prefix: "@mem" }
backups: { enabled: false, folder: "", hour: 3, keep: 14 }
privacy: { encryptArchive: true, searchIndex: true }
rules: { act: [] }                                (ids of learned rules allowed to attach reminders to tool results)
```

The abilities are gone (HarnessV4_Skills_Plan S1-7: skills took their place). What one held stays in the archive as
it was, under kind `ability:<name>`, but is recalled nowhere, briefed nowhere and matched by no new claim.

`normalizeConfig` fills every field from the schema's default; a key the schema does not know drops on load.

## 11. Admin API

`GET /api/memory/status` (engine, archive counts, folder, backups, install state), `POST /api/memory/install`
(SSE progress), `POST /api/memory/recall`, `POST /api/memory/remember`,
`POST /api/memory/forget` (retire), `GET /api/memory/items?status=`, `POST /api/memory/items/:id` (confirm/dismiss/restore, through `brain.setItemStatus` as the owner),
`GET /api/memory/items/:id/history` (a claim's events, slot and replacements; takes `<n>` or any line id),
`GET`/`POST`/`DELETE /api/memory/identity` (the user's facts of no project in a user slot: listed and set by name, deleted by id: `brain.identityFacts`, `setIdentity`, `forgetIdentity`), `GET /api/memory/sessions?q=&limit=&offset=`,
`GET /api/memory/sessions/:id?view=`, `GET /api/memory/activity`, `GET /api/memory/benchmark` (memory cost per
request from the traces, learning runs), `GET /api/memory/traffic` (memory's own model calls as request records),
`GET /api/memory/usage[.csv]?from=&to=` (their per-day totals from `memory-usage.json`, rows split by purpose:
learn / engine; `isMemoryRecord` in `daily.js` decides which store a record belongs to, and the general store excludes
them from the Usage rollups, timeline and upstream stats — but **not** from Traffic, which lists every model call and
labels each row with its `source`),
`POST /api/memory/hygiene`, `POST /api/memory/backup`, `GET /api/memory/backups`, `POST /api/memory/restore`,
`POST /api/memory/import` (SSE progress), `GET /api/memory/changes?since=`. All behind the existing origin guard.

The claims, the questions and the curator (HarnessV3-Memory M4, M6), for the console's and the harness's pages:
- `GET /api/memory/claims/scopes`: where claims live (everywhere and each project), with counts.
- `GET /api/memory/claims?project=&state=standing|review|retired&kind=&q=&limit=` (`limit` a whole number, 200 when
  none, at most 1000; a bad state, kind or limit is refused in words; `q` is words the claim holds, each anywhere in
  it, or its id): `brain.claims`, each a card
  (`#card`): the claim's view, `sure`, `backed`, `flags`, `held`, `replacedBy`, its triggers with how often each was
  said, followed and kept, and `asked` (`q<n>`) on a retired claim an open question would put in another's place (it is
  held for the user's answer, not untrue). `inbox.awaiting` and `inbox.asking` are read once a view.
- `GET /api/memory/claims/:id` (M7-D34): one claim's card, `brain.card`, by any id a line shows (`i12`, `12`, an engine
  twin's id). The router hands params undecoded, so the route decodes the id. The refusals, in words, are 404: no
  such claim, words from a past session, or an item that is no claim (an always-allow offer, what an ability held). Memory not
  started is 503. The scopes and stream routes come before it in the table: the first match wins.
- `GET /api/memory/claims/stream?project=` (M7-D35): the claims feed as server-sent events.
  - **Its start:** `hello` `{ last, gap }`, its `id:` the position it starts from. It resumes after `Last-Event-ID`,
    else `?since=`, when the epoch is this store's and `pruned <= n <= last`; anything else is a gap, and it starts
    after the newest.
  - **Each change:** `id: <epoch>:<n>`, from `claimChange`: `{ type: "change", id, claim, action, at, by, project,
    session, from? }`, never words.
  - **Its reading:** each stream reads the feed from its own cursor, a page of `FEED_PAGE` (200) at a time, and waits
    for `drain` before each write, so a reader that is behind holds the read back rather than growing the stream's
    queue (`writeSse` queues what the socket cannot take yet, and closes a stream backed up past 8 MB). A wake during
    a read sets `again`, so the read goes on rather than starting a second. Memory reopened on
    another epoch sends `reset` and goes on from the newest.
  - **Its lifetime:** a heartbeat every 25 s; the stream sits in `sseClients`, so shutdown ends it. Closing it
    unwatches the service and stops the ping. A read that throws ends the stream with an `error` frame.
- `POST /api/memory/items/:id/correct { text, reason, session }`: new words replace the claim.
- `GET /api/memory/sessions/:id/turns/:n/memory`: `brain.turnMemory`, what memory did for one turn: what it showed and
  where, the reminders at its calls and whether each was followed, what it filed and what that replaced, and the
  questions waiting.
- `GET|POST /api/memory/models`: the models memory learns and curates with; a POST sets `summarizer` and `curator`
  alone, each a model a route answers, `auto`, or (the curator's) `off`.
- `GET /api/memory/mcp`: `{ path: "/mcp/memory", keyed }`, where memory's door for other agents is and whether it
  asks an inbound key (M7-D46); never a key.
- `GET /api/memory/inbox?project=&status=` and `POST /api/memory/inbox/:id { answer: accept|reject }`.
- `GET /api/memory/dossier?project=`, `GET /api/memory/pages?project=`, `POST /api/memory/curator/run { project }`, `GET /api/memory/curator/runs`,
  `POST /api/memory/curator/runs/:id/undo`.
- `GET /api/memory/outcomes?project=&days=&kind=` (M7-D52): how models did, `memory.outcomes` over `outcomeTable`.
- `GET /api/memory/metrics?days=` (the memory plan's b4): what each layer showed over the last `days` (1 to 365, 30
  by default) and what of it the work used, by day, from the injection log on disk (`injections.rollupRows` →
  `services/memory/metrics.js` `memoryMetrics`): shown, judged, used and the rate, tokens and tokens a turn, showings a
  session had been shown already, use by whose memory it is (the person's word, the agent's notes, sub-agents'
  findings, the learner's), the memories shown then corrected, and how many fade now. Drawn on Memory → Activity.
  `days` is a whole number from 1 to 365 (30 by default), `kind` one of `OUTCOME_KINDS`, `project` one that exists
  (404 otherwise; none is everywhere). 400 for a bad `days` or `kind`, 503 before memory has started.

A page acts as the owner. One that names the session it shows (`session`) is scoped to it (M6-D2): that session's
errata spare it, and the history names it.

**The claims feed's readers** (M7-D35..D37):
- **The wake.** The service is the stable object; the archive is rebuilt on every open. The service sets
  `archive.onClaimChange` before anything writes. Its `#claimsChanged` coalesces a burst into one `setImmediate`,
  which runs once the writer's transaction is over, so a rolled-back row is never read. It then publishes, and tells
  each watcher (`watchClaims`, a stream's wake). A watcher that throws is logged.
- **The fan-out** (`#fan`, `{ epoch, read }`). Every open puts it at the newest row and says
  `{ type: "claims", reset: true, last }`, with a wake, so every page reads all it shows again and every stream on
  another epoch says `reset` at once. Another store shows other claims; the same one, reopened after an open that
  failed, answered nothing meanwhile, and a page that read then shows the failure. An open is rare (the switch, the
  folder, the engine or privacy changed), and a page's read of all it shows is cheap.

  `#publishClaims` reads pages from `read` and sends each as `{ type: "claims", prev, last, changes }` (`onClaims`,
  which `server.js` publishes on the events fan-out as `claims`). `prev` is where the read began, which is the `last`
  the message before said: a read that finds no row moves nothing (a rollback takes its ids back, and a delete that
  takes rows writes its `deleted` after them). A fan-out that throws is logged; the watchers are still told, and a
  page that missed the message hears a `prev` it did not and reads all.
- **The prune** runs at open and on a daily unref'd interval, by the archive's clock; `stop()` clears it.
- **The pages** (`ui/lib/claims.js`) follow it on the events stream they hold: the harness's `onBus`, and the
  console's `onEvents` (`app.js` hands every message to the pages' listeners before its own handler). Both hold their
  listeners in `listenerSet` (`ui/lib/listeners.js`): a message goes to the listeners there when it came, and one's
  failure is reported, never keeping it from the others.
  - **`followClaims`** collects changes for 250 ms. It says read everything again instead on a missed `prev`, a
    reset or the stream's `hello`, and lets go once its page is gone (`alive`).
  - **`claimsTouched`** decides what a claim browser reads: the scopes on `created`, `status`, `deleted`, `moved`
    and `dossier`; the list on a claim in the scope or one it shows; the questions; the open histories; the dossier
    shown.
  - **`turnTouched`** decides when the harness reads a turn's memory again, through `followTurnMemory`.
  - **A page waits for the owner's hands:** while a correction is written (or, in Settings, a claim added), a change
    to the list, a history or a read-all is owed (`owed`), and read once they save or cancel.
  - **A project gone.** A claim browser whose project is no longer among the scopes it reads goes where it opens
    (`firstScope`: the project with the most claims, else everywhere), once the owner's hands are free. Its questions'
    read, like its list's, drops one overtaken by a newer (another scope picked). The console's Projects card says its
    project went, on the project's `deleted` or a 404 on its read, and lets go.

## 12. Tests

- Unit tests never need Python: `test/fixtures/fake-sidecar.mjs` speaks the sidecar protocol in Node with an
  in-memory store (keyword scoring), so `MemoryEngine`, the brain, tools loop, commands, learning and the API are
  tested end to end with `npm test`.
- `test/archive.test.js` covers schema, dedupe by hash, caps, encryption round trip, views and budgets, FTS.
- `test/memory-engine.test.js`'s real-sidecar round trip runs only when the managed engine's install finished or
  `FILAMENT_MEMORY_PYTHON` names a Python with Mnemosyne: real sidecar, remember, recall, canonical, stats.
- The streaming tool loop is tested with a fake upstream that emits a `filament_memory_search` call mid-stream.
- The replay bench (`scripts/memory-bench.mjs`) replays archived chains through the brain offline, dry, each under a
  key of its own so every turn is looked up afresh, and reports per project the items injected, how many the reply
  that followed used (hit rate), the tokens memory added, the briefings built and the average prepare time.
  `test/memory-bench.test.js` runs it on a seeded archive.
