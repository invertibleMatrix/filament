# Memory evals

*How Filament's memory is measured: whether it makes the agent better at the work itself, against the same agent with no
memory and with the simplest memory there is, a notes file it keeps itself.*

Two kinds of eval stand beside each other:

- **The scenario evals** (`test/memory-evals.test.js`): scripted multi-session stories with a known truth, run through
  the real memory service on a stand-in engine. They say what memory *does* — a correction retires the old value, a
  neighbour survives — and run with the suite.
- **The task eval** (`scripts/memory-task-eval.mjs`, this page): real tasks in a real repository, real models, whole
  sessions. It says what memory is *worth*: tasks passed, corrections the person did not have to give, rounds and tokens.
  It runs by hand, against providers; its driver is tested on a scripted model (`test/memory-task-eval.test.js`).

## The task eval

### What runs

A **fixture** is a starting repository and its tasks, in order (`evals/memory/<fixture>/repo/` and `tasks.mjs`). The
driver runs every task of the fixture, in order, for each **model** and each **arm**:

| arm | what the agent carries from one session to the next |
|---|---|
| `on` | Filament's memory as the commit has it: briefing, per-turn recall, the memory tools, learning, the curator |
| `off` | nothing: memory off |
| `notes` | memory off, and an `AGENTS.md` in the folder telling the agent to keep its notes there; every session reads the file (`instructions.files`) |

A **cell** is one model on one arm. Each cell gets:

- a copy of the fixture's repository in a temporary folder, committed as a person's checkout would be (the notes arm's
  `AGENTS.md` committed with it);
- a Filament of its own, started in-process from this checkout on a throwaway data folder: its agent loop works in that
  folder with `permissions: auto`, and with memory on, the memory engine the app installed runs on a memory folder of the
  cell's own. Nothing of the person's own memory, chats or settings is read or written;
- each task in a **fresh chat** (`POST /api/sessions`, then `/turns`), with the tools that need a person or start other
  agents off (`ask`, `agent`, `team`, `flow`): the person's only words are the task and its corrections, and each task is
  one agent's work.

After each turn the task's **checks** run on the folder. Where some fail, the person **corrects**: each failed check's
own words, in one message, up to `--corrections` times (2 by default). Then the chat ends.

With memory on, **between two tasks** the driver does what time does between two sessions: the session's idle
boundary has memory learn from it (`POST /api/memory/learn/:id`), and the curator's pass that follows a learning run
runs (`POST /api/memory/curator/run`). Both are memory's own calls, asked for at once rather than waited for.

### The ledger fixture

`evals/memory/ledger`: `tally`, a small household-ledger library, and six tasks over a few weeks of its owner's work.
What the owner wants beyond each task's own words is said once — told in a task's message, or in a correction where
the agent's work misses it — and wanted again later:

| preference | said in | wanted again in |
|---|---|---|
| `changelog`: every change gets an item under `## Unreleased` | t1, told | t2, t3, t5 |
| `jsdoc`: a new exported function has a JSDoc block with `@param` and `@returns` | t1, corrected | t2, t3, t5 |
| `error-prefix`: an error's message starts with the function's name and a colon | t2, corrected | t5 |
| `vendor`: `src/vendor/csv.js` is never edited (a sync overwrites it) | t3, corrected | t5 |
| `release-version`, `release-changelog`, `release-notes`: how a release is cut | t4, corrected | t6 |

| task | the person asks |
|---|---|
| t1 | `monthlyTotals(ledger)` in src/ledger.js, with tests |
| t2 | `overBudget(ledger, budgets)`, a TypeError for bad budgets, with tests |
| t3 | `toCsv(ledger)` in src/export.js, quoting as RFC 4180, using src/vendor/csv.js, with tests |
| t4 | "Please cut the 0.4.0 release." |
| t5 | `fromCsv(text)` in src/import.js, errors for malformed lines, with tests |
| t6 | "Cut the 0.5.0 release, please." |

None of the preferences can be read from the repository as it starts — no JSDoc, no prefixed errors, no release notes
to copy — so a later session knows them only through memory or the notes the agent kept. A preference check of a task
is a **recall** where an earlier task said it.

Each check answers true or what is wrong; the task's own requirements are `task` checks, the preferences `pref` checks.
The fixture's references (`evals/memory/ledger/reference/<task>/good|naive`) prove them: the suite runs each task's
checks before the work (its task checks fail), on a naive solution that does the task and misses every preference
(task checks pass, preference checks fail), and on the reference work (all pass).

### What is scored

Per task:

- **success** — every check passes when the chat ends; **first try** — every check passed after the task's first turn.
- **corrections** — the failed checks the person corrected (an item each; one message may carry several).
- **score** — 1 for a task passed at once, 1/(1+n) after n corrections, 0 for one never passed.
- **rounds** — the agent's model calls (the chat's `agent-tick` records).
- **tokens** — the agent's: what its rounds read (fresh, from the cache, written to it) and wrote; memory's own calls
  (learning, the curator, recall's) are counted apart, per cell.
- **preferences at the first try** — each preference check's verdict after the first turn, marked as a recall or new.

Per cell: tasks passed, first tries, corrections, rounds, agent and memory tokens, the mean **score**, the
**recall score** (the mean score of the tasks that recall something), **recalled at once** (the recalls right at the
first try), and against memory off for the same model the **normalized gain**:

    gain = (score − score_off) / (1 − score_off)

the share of the room memory off left that the arm took — 1 where it took it all, 0 where none, below 0 where it did
worse; none where memory off left no room. **Recall gain** is the same over the recall scores: the number that says
what memory is worth, since the tasks that recall nothing are no test of it.

### Running it

    node scripts/memory-task-eval.mjs --dry
    node scripts/memory-task-eval.mjs --label baseline --jobs 6

| flag | default | |
|---|---|---|
| `--models` | `zai/glm-5.3,grok-4.6` | the chat models, as Filament names them |
| `--learner` | `zai/glm-5.3-flash` | memory's model (Settings › Memory › Model): learning and the curator |
| `--arms` | `on,off,notes` | |
| `--fixture` | `evals/memory/ledger` | |
| `--tasks` | all | a subset, by id, in the fixture's order |
| `--corrections` | `2` | the most correction messages a task gets |
| `--turn-minutes` | `20` | a turn longer than this is cut |
| `--jobs` | `1` | cells run at once, each in a process of its own (`--cell <model>::<arm>` is how the run starts one) |
| `--data-dir` | the installed app's data folder | where the providers and the memory engine are read from |
| `--engine-from` | `--data-dir` | another data folder whose installed memory engine the cells run (a sandbox install, so the app's own is never touched) |
| `--embedding-cache` | the engine's own cache | a fastembed cache holding this build's embedding model (`EMBEDDING_MODEL`, the multilingual one): the cells run it, as an engine installed from this build's bundle does; without it, the model the engine's install warmed |
| `--out` | `evals/memory/results` | the report's folder: `<date>-<label>.json` and `.md` |
| `--keep` | off | keep each cell's folder (its repository and Filament data) for a look after |
| `--dry` | | say where each model goes and what would run, and stop |

The providers come from the data folder's config, read only: the routes that answer the models and the learner — the
first enabled route each name matches, as Filament routes, without its backups (a backup would be another model's
answer) — and the upstreams they name. Nothing else of the config goes into the cells; each cell's config is sealed
with the cell's own key before it is written.

A cell runs one task after another, so a run of 2 models × 3 arms × 6 tasks is 36 chats, a minute or two each: about
an hour one cell at a time, a quarter of that with `--jobs 6`.

### The report

`evals/memory/results/<date>-<label>.md` holds the table and each cell's tasks; the `.json` beside it holds everything:
each turn's words and the reply's end, each check's verdict and why, rounds, tokens, the learning run and the curator's
pass after each task, memory's calls by purpose, and the claims and the dossier memory held at the end. The baseline —
memory as it was before the memory plan changed anything, learning on `zai/glm-5.3-flash` — is
the run labelled `baseline`; later runs are read against it. Reports stay on the machine that ran them: the folder is
not part of the repository.

### Reading it

- One run is one sample per task: a model's day-to-day variance moves a task's score by a correction or two. Read the
  recall gain across both models, and run again (another `--label`) before calling a change real.
- `notes` is the bar: memory that does no better than a file the agent keeps itself has not earned its tokens.
- Where memory on loses a recall, the report's claims and dossier say whether memory never learned it (learning), held
  it and did not serve it (recall), or served it and the agent did not follow it.
- "Memory's own calls" counts requests: a learning or curator call tried again on a busy provider counts each try.

## Results: the memory plan, finished (2026-11-07)

The memory plan's last step (g1) ran both evals again on the finished work and read them against the baseline: the
golden recall eval against b2's numbers, the task eval against b3's.

### The golden recall eval

`test/memory-recall-golden.test.js`: 75 cases over a web shop's 100 memories, each surface's precision and recall at
its own budget. The stand-in engine runs with the suite; the real engine runs by hand, on a sandbox install:

    FILAMENT_MEMORY_PYTHON=<install>/memory-engine/venv/Scripts/python.exe \
    MNEMOSYNE_FASTEMBED_CACHE_DIR=<a fastembed cache with the multilingual model> \
    MNEMOSYNE_EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 \
    node --test test/memory-recall-golden.test.js

Recall (precision; tokens a case):

| surface | stand-in, b2 | stand-in, now | real engine, b2 (bge-small-en) | real engine, now (multilingual) |
|---|---|---|---|---|
| briefing | 0.84 (0.067; 1,275) | 0.84 (0.099; 1,102) | 0.84 (0.06; 1,316) | 0.947 (0.099; 1,136) |
| turn block | 0.84 (0.313; 80) | 0.84 (0.36; 88) | 0.827 (0.252; 95) | 0.933 (0.315; 111) |
| search | 0.813 (0.265; 132) | 0.84 (0.272; 133) | 0.84 (0.188; 191) | 0.947 (0.196; 206) |
| brief | 0.853 (0.045; 1,144) | 0.88 (0.046; 1,145) | 0.853 (0.042; 1,175) | 0.973 (0.048; 1,184) |

- **English recall is not below the baseline** on any surface of either engine, and briefings are smaller.
- **Other languages:** the multilingual cases (c1, c2) pass on the real engine. Four paraphrase cases are still
  misses: `pa-card-company` and `pa-bills` on every surface, `pa-socket` and `pa-logged-in` on the briefing, the turn
  block and search (the test's `KNOWN_REAL` says why).
- **Since c2:** the real engine's briefing and turn block each pass one case fewer. The briefing's header now counts
  in its budget (d2), and the user's facts that hold in every project take a line of it (f5), as on the stand-in.
- **A multi-document ask** (f7): a search of the claims puts 2 of 5 in view on the stand-in (4 on the real engine).
  With the topic's page, all 5 are in view, in 153 tokens, against 212 for the five claims served as results.
- One run of the real-engine variant in four failed one test: the brief's precision, 0.048 → 0.047. Mnemosyne names
  a memory by its words and the moment it was filed, and rounds its scores to four places, so memories that score
  alike tie in the order of their names, which a corpus filed again draws anew: each run served 6-8 other lines at the
  cut of `top_k`, idle or on a busy machine, and the brief's 73 answers in 1,535-1,537 lines sit on the rounding. The
  eval's engine now runs with its clocks held still (`test/fixtures/steady-sidecar.py`: named by its words, each
  memory as recent as one filed when it is asked), and serves the same lines every run, with the numbers above.

### The task eval

Runs: `final-r1`, `final-r2` and `final-r3` (every arm), `final-on-a` and `final-on-b` (memory on), and
`final-self-glm` and `final-self-grok` (memory on, memory's model the chat's own). Each ran at commit 3f8b6d804 with
this step's change, on a sandbox engine with this build's multilingual model (`--engine-from`, `--embedding-cache`).

The runs found a bug. Memory's learning failed on one rate limit (HTTP 429), and a finished session's turns were
never read again. In r1 and r2, ZAI's limits on `zai/glm-5.3-flash` cost the grok memory-on cells 3 and 5 of their
6 learning runs. Learning and the curator now try again while a provider is busy for a moment (core/retry.js, as
Filament's own loops do). r3, on-a and on-b ran with the fix, and no learning run failed. The two cells that lost their
learning are left out of the pooled numbers.

Pooled over the runs (means; gain over memory off's pooled mean):

| model | arm | runs | passed | first try | corrections | rounds | agent tokens | memory tokens | score | gain | recall score | recall gain | recalled at once |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| zai/glm-5.3 | on | 5 | 29/30 | 2.8 | 3.6 | 82 | 2,017,444 | 51,000 | 0.711 | -0.114 | 0.85 | 0.17 | 54/55 |
| zai/glm-5.3 | off | 3 | 18/18 | 3 | 3.33 | 79 | 1,620,390 | 0 | 0.741 | — | 0.819 | — | 31/33 |
| zai/glm-5.3 | notes | 3 | 18/18 | 3.67 | 2.67 | 97 | 2,164,262 | 0 | 0.796 | 0.213 | 0.875 | 0.308 | 33/33 |
| grok-4.6 | on | 3 | 18/18 | 4 | 2 | 59 | 1,497,634 | 38,861 | 0.833 | 0.59 | 0.875 | 0.743 | 33/33 |
| grok-4.6 | off | 3 | 18/18 | 2 | 7 | 72 | 1,821,224 | 0 | 0.592 | — | 0.514 | — | 18/33 |
| grok-4.6 | notes | 3 | 18/18 | 4 | 2 | 61 | 1,510,360 | 0 | 0.833 | 0.59 | 0.875 | 0.743 | 33/33 |
| zai/glm-5.3 | on, memory's model zai/glm-5.3 | 1 | 6/6 | 4 | 2 | 78 | 1,935,862 | 50,938 | 0.833 | 0.356 | 0.875 | 0.308 | 11/11 |
| grok-4.6 | on, memory's model grok-4.6 | 1 | 6/6 | 4 | 2 | 60 | 1,549,166 | 61,225 | 0.833 | 0.59 | 0.875 | 0.743 | 11/11 |

The baseline (b3, one run): glm on 0.722, off 0.667, notes 0.722; grok on 0.833, off 0.597, notes 0.833. Recall
gain: glm 0.5 for on and notes; grok 0.739 for both. Memory's tokens: 172,065 (glm) and 132,708 (grok).

- **grok:** memory on recalls every remembered preference at once (33/33), as the notes file does; memory off recalls
  18 of 33. Its recall gain is 0.743, against b3's 0.739. Memory beats no memory and ties the notes file.
- **glm:** every arm recalls nearly everything, memory off too (31/33). Once an earlier task applied a preference, glm
  reads it off the repository: the CHANGELOG's items and headings, the JSDoc blocks, the release notes, the 0.4.0
  section. On this fixture, the arms' scores differ mostly on t4, the first release, which no earlier task teaches.
  - Memory on missed one recall (on-a, t6, the CHANGELOG's empty `## Unreleased`). At t4 the agent got that step
    right untold, so no correction taught it, and the release procedure memory learned from t4 left it out. After
    t6's correction, the agent corrected the procedure itself.
  - r3's t4 never passed: the agent left out two `## Unreleased` items an earlier correction had added, and the
    correction repeats the convention, not what is missing.
- **Memory against the notes file (the gate):** it does not beat it here. On grok they tie. On glm, notes is ahead
  on score (0.796 against 0.711) and on recall score (0.875 against 0.85); both gaps are about one task's worth of
  difference across the runs.
- **What memory costs:** memory's own tokens are down about 70% from b3 (glm 172k to 51k, grok 133k to 39k).
  - It holds less at the end: 14 to 21 memories for glm where b3 held 25, and 9 to 11 for grok where b3 held 17.
  - Memory on's agent and memory tokens together: glm 2.07M against notes' 2.16M, grok 1.54M against 1.51M.
  - Notes' rounds keep its file: glm 97 a run against memory on's 82.
- **A stronger memory model:** with the chat's own model as memory's model, both scored 0.833 with every recall at
  once (one run each). That is no more recall than `zai/glm-5.3-flash` gave, at 51k and 61k memory tokens.

### Defaults, from the numbers

None changed:
- **`memory.autopilot.turnTokens`, 300:** the turn block used 88 tokens a case on the stand-in and 111 on the real
  engine. The budget is not what limits it.
- **`memory.autopilot.briefingTokens`, 4,500:** the briefing used 1,102 and 1,136 tokens. Its shares, not its total,
  decide what it holds (e1).
- **`memory.autopilot.rewrite`, off:** the real engine's search recall is 0.947 without it, and no eval measured it
  on.
- **Memory's model:** unset, it is the chat's compaction model, else the chat's own. A chat-class memory model recalled
  no more than the flash model the eval sets, so the numbers ask for no change. A smaller model named in Settings ›
  Memory › Model serves as well on this fixture.

### What would measure more

The ledger fixture has hit its ceiling for glm, because a preference applied once can be read off the repository. A
fixture whose preferences leave no trace in the files — an order of steps, a person's wording, a command run outside
the repository — would separate memory from the notes file and from no memory on every model. CL-Bench's codebase
domain (the plan's g2) is the public one.
