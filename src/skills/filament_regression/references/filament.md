# Working on Filament itself

What the rules in SKILL.md mean in this codebase: its gates, its kinds of test, what breaks quietly, what is never
touched, and where a regression is found. Check each against the code as it is now — a path or a command here can
have moved since.

## The gates

- Types: `npm run typecheck` (`tsc --noEmit`). Plain JavaScript with JSDoc, every source file `// @ts-check`. In a
  worktree with no `node_modules` of its own, run the main checkout's TypeScript on this folder's `tsconfig.json`.
- One file's tests: `node --test --test-timeout=180000 test/<name>.test.js`; one test of it: add
  `--test-name-pattern="<words of its name>"`.
- The whole suite: `node --test --test-timeout=180000 test/*.test.js` — over ten thousand tests, minutes long. Run it
  in the background and keep working. Some tests fail on one machine for its setup alone (a sign-in, a terminal, a
  program not installed): compare the failing set with the same run on main before calling a failure yours.
- The ratchets (`npm run test:ratchets`, part of the suite): every source file typed, no helper defined twice past its
  budget, layers import inward only (`core/` does no I/O, nothing under `src/` imports `server.js`), and app code never
  branches on an upstream's kind. A ratchet that fails names the rule: keep the rule, change the code.
- The golden wire corpus (`test/golden.test.js`): what clients got, what upstreams received and what Filament wrote,
  compared byte for byte. A change meant to keep behaviour leaves it identical; one meant to change it regenerates it
  with `UPDATE_GOLDEN=1` and the diff is reviewed, line by line.

## The kinds of test, and their helpers

- A pure function: a table of inputs and outputs — `core/` is pure, so most of its rules are tested this way.
- A real Filament in the test's process: `startApp` in `test/helpers/app.js`, with `fakeUpstream` recording what each
  model request held and answering a script (`anthropicStream`, `openaiStream`). A temporary data folder each run.
- A coding agent: `test/fixtures/fake-acp-agent.mjs` speaks ACP; words in the prompt pick its script (`~noresult`,
  `~failonce`, `perm` for a permission ask…) — read its file for the one you need, or add one.
  Codex, Cursor's SDK, an LSP server, npm and uv have fakes beside it.
- The command line: a Filament of the test's own that answers as told (`fakeFilament` in `test/cli.test.js`), and
  `runCli` with a terminal of the test's (`tty: false` is how an agent runs it).
- The page: `test/helpers/dom-stub.js` and the harness's modules on it. A stub proves the parts, never the look: see
  "The page" below.
- Mark a bug's test `// (fails before: yes — <what misfired>, <whose report>)` and prove it: put the old code back
  (`git show HEAD:<file> > <file>`), see it fail, restore.

## What breaks quietly

- **Source pins.** Many tests match a regular expression against a source file (`app.js`, `server.js`) or pin a
  prompt's, a tool's or a page's words exactly. An edit that keeps the behaviour can still break them: grep `test/` for
  the words you change and update the pins with them, in the same commit.
- **The prompt cache.** A request's system prompt and tool definitions are cached; changing their bytes rewrites the
  cache (thousands of tokens). Keep them the same within a session: what changes from turn to turn goes in the turn's
  own context, never in a tool's description. When text must change, change it once, in a release — never leave it
  wrong to keep the cache.
- **Tool list size.** Every tool's definition is paid on every request. A new tool or a longer description is weighed:
  say what it adds in tokens and why it is worth it.
- **Another layer's words.** The same fact is often said in four places: the server's answer, the prompt, the page and
  `docs/GUIDE.md`. Change one, find the other three.

## Never touched

- The person's own Filament: the installed app, on its usual port, with its data folder (`config.json`, `secret.key`,
  the archive). Its running copy is the installed build, not this checkout: a fix reaches it only once they build and
  install. Read it only through its loopback API with GET, print no key, and never stop or restart it — your own turn
  may run inside it.
- A second Filament on the person's data: a drive starts one on a temporary data folder and a port of its own, and
  stops it by its own process id.
- Junctions: a worktree's `node_modules` may be a junction to the main checkout's. Never junction one into a temporary
  worktree: removing that worktree with force deletes through the junction and empties the main checkout.
- Git: main is the owner's. Work on a branch; fast-forward main only on their word, after `git log <branch>..main`
  shows whether main moved (rebase onto it first if it did). Never push unless told.

## Edits

- Line endings stay as the file has them: `git ls-files --eol <file>` says which. A script that rewrites a file opens
  it with `newline=""` (Python) so nothing converts them.
- Comments say why, in plain words, and whose decision a rule is ("the owner's of 11-05"). Write like the code around
  you: its naming, its idiom, its comment density.
- When a file gains or loses an export, its row in `docs/architecture/<layer>.md` says so. A setting's schema changed:
  `npm run docs` regenerates `docs/PARAMETERS.md`. A person sees the change: `docs/GUIDE.md` says it.

## The page

- Plain JavaScript under `src/ui/harness`, no framework. Before a page change is done, look at it: a static page that
  mounts the widget or view with made-up data (served from the branch's `src/ui`), opened in the browser tool, and a
  screenshot of each state. Reload the tab after a change — a new address keeps the old script. Wait out an animation
  before judging a dialog: take a second screenshot.
- Never drive the person's own Filament page to look at your change.

## Hunting a regression

1. Pin the symptom in the person's words and their data: which chat, which screen, what it said, what it should have
   said. Read their records before guessing — the data folder's `ops.jsonl` (what Filament did and why), a coding
   agent's own transcript (its `.jsonl` session file), the loopback API's GET answers (filter out anything secret).
2. Find the code that produced the wrong words: grep for the exact text it showed.
3. Make it a test with the person's shape of data (their accounts, their order of rows, their off switches) and watch
   it fail with the same wrong words. A fixture in a state the server never produces proves nothing: check that the
   server can make it.
4. Find when it started where that helps: `git log --oneline <good>..<bad> -- <files>`, or `git bisect run` with the
   test.
5. Fix the cause, not the words. Then look for the same mistake elsewhere: the same helper's other callers, the
   command line beside the page, the coding agent's path beside Filament's own agent.
6. Gates, a reviewer's read of the change (verify each finding against the code before acting), a commit per fix
   whose message says what the person saw and why it happened.
