---
name: filament_regression
description: How to change Filament, or hunt a regression in it — read before deciding, a plan with its reasons, a failing test before the fix, Filament's gates and quiet breakers (source pins, the prompt cache), a drive that never touches the person's own Filament, honest status. Load it for a change to Filament that matters, a regression or bug hunt, or a review.
triggers: regression, bug hunt, filament bug
---

# Filament's working rules

## In five lines

1. Read the code before you decide. Where a document, a memory or a report disagrees with the code, the code wins.
2. Write the plan down before the change — each decision with its reason — and keep it true as the work moves.
3. A bug gets a test that fails before the fix and passes after it. Run it both ways.
4. Done means the gates pass and the change was driven against the real thing, not only its tests.
5. Say what is so: what ran, what passed, what failed, what was not done. Nothing rounded up.

## The guides

### Read before deciding

- Open the files the change touches and the code that calls them, before you propose anything. Name the file and line
  a claim rests on.
- A plan, a summary or another agent's report is a lead, not a fact: check it against the code as it is now.
- Look for the project's own conventions — how errors are said, how tests are built, what a comment explains — and
  write like the code around you.

### Plan in a document

- For anything bigger than a small fix: a short plan with the steps, the files each touches, and the decisions taken
  with their reasons. A decision someone else must make (a default, a removal, a design) is asked, not assumed.
- Keep the plan's status true as you go. A step dropped is dropped in writing, with why.

### A failing test first, then the fix

- Reproduce the bug as a test before touching the fix. Watch it fail for the reason you expect.
- Fix, then watch it pass. Then check it guards the fix: undo the fix (or change the line it guards), see the test
  fail, put the fix back. See references/practices.md, Mutation testing.
- Mark the test with what it guards and that it fails before, so a reader knows why it exists.

### The gates

- The type check, the full test suite and the project's ratchets (checks that keep a map, a fixture or a rule true)
  pass before you call it done. Known failures are named, with why they are not yours.
- A test that fails only in the full run is rerun alone before it is called a flake.

### A drive against the real thing

- Run the change the way its user will: start a throwaway copy of the app (its own port, its own data folder), use the
  feature, look at what it shows and what it writes. Tests prove the parts; a drive proves they meet.
- Clean up what the drive started: its processes by their own ids, its folders by their exact names.

### An as-built record

- When a step lands, write what was built, where, what was checked (the commands and their results), what changed
  from the plan and why, and what is still open.

### Honest status

- Report the result first, in plain words. If tests fail, say so with the output. If a step was skipped, say that.
  When something is done and verified, say it plainly.

## In Filament

- The gates: `npm run typecheck`, then the test files you touched (`node --test --test-timeout=180000 test/<name>.test.js`),
  then the whole suite in the background. Compare its failures with main's before calling one yours.
- Words are pinned: tests match a prompt's, a tool's or a page's exact text, and regular expressions against source.
  Grep `test/` for the words you change and update the pins in the same commit.
- A prompt's and a tool's text are cached: change them on purpose, once, never per turn.
- The person's own Filament — the installed app, its port, its data folder — is read through GET at most, never
  stopped, never driven. A drive runs a Filament of its own on a temporary data folder.
- A regression: the person's exact words and data first, then the code that said them, then a test in their shape of
  data that fails the same way, then the fix, then the same mistake's other places.

## Where to look

`references/filament.md`: Filament's gates (types, tests, ratchets, the golden corpus), its kinds of test and their
helpers (`startApp`, the fake coding agents, the CLI's fake Filament), what breaks quietly, what is never touched,
edits and docs, looking at a page, and hunting a regression step by step.

`references/practices.md` has one section per practice, with examples: mutation testing; the failing test first;
decisions for many users; checking a claim against the records; process safety; git discipline; Windows text and
encodings; plans and as-built records; the lessons list.
