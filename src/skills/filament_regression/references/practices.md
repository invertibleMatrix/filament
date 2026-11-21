# The practices, with examples

## Mutation testing

A test guards a fix only if it fails without it. After the fix passes:

1. Copy the fixed file aside.
2. Put the old code back (`git show HEAD:path/to/file.js > path/to/file.js`), or change the one line the test guards.
3. Run that test alone and see it fail, with the assertion you meant to fail.
4. Copy the fixed file back and see the test pass again.

A test that passes both ways guards nothing: make it ask about the case the bug was in.

## The failing test first

- Write the test from the report's own input: the path that misfired, the order of clicks, the body the server took.
- Name what it guards in a line above it — "(fails before: yes — a path's segment was read as a call)" — so the next
  reader knows why it is there and that it was seen failing.
- Test at the level the bug lives: a pure function's table of inputs; a route through the app's real front door; a
  page on a fake DOM with a recording server.

## Decisions for many users

- A default, a removal, a renamed setting or a changed behaviour reaches everyone who uses the project. Ask its owner
  before you change it, and say what each choice means for the people who will see it.
- Prefer the choice that is safe for the many: off until turned on, kept rather than deleted, said rather than hidden.
- Nothing is written into a person's files, settings or records by a model alone: show what will be written first.

## Checking a claim against the records

- Before you repeat a claim — from memory, a document, a commit message, another agent — check it where it lives: the
  code, the log, the git history, the data on disk.
- A report from a reviewer is verified finding by finding against the code as it is now. Fix the real ones; say why
  the others are not bugs.
- Where the claim and the record disagree, trust the record and correct the claim where it is kept.

## Process safety

- Stop only processes you started, by their id; never by a program's name, and never the person's own running app.
- Start throwaway servers on a port of their own, with a data folder of their own; never on the person's port.
- Delete only folders you made, by their exact name. Never print a secret, a key or a person's private configuration.
- Before a command that is hard to undo (a force push, a reset, a delete), look at what it will touch and ask.

## Git discipline

- Commit when the owner says to; push only when asked. Never skip hooks or signing.
- Other agents may be working in the same folder: stage your own files by name, never everything, and leave changes
  that are not yours alone.
- One commit a milestone, its message saying what changed for the people who use it and why, then how it was checked.
- Never rewrite history that others may have.

## Windows text and encodings

- Line endings: a file's CRLF or LF is kept as it is; check `core.autocrlf` before a tool rewrites a file.
- Windows PowerShell 5.1 writes the ANSI code page with `Set-Content`; pass `-Encoding utf8` for a file another tool
  reads. A BOM at a file's start can break a parser that expects none.
- Paths: quote any path with a space; prefer forward slashes in Git Bash; a drive letter and `\` in a regular
  expression or a JSON string need escaping.
- Shell scripts and heredocs mangle backslashes and quotes: write such content with a file-writing tool.

## Plans and as-built records

- A plan: what it is for, the steps in order, the files each touches, the decisions with their reasons, and what
  waits for someone's word.
- An as-built record, per step: what was built and where; what was checked (commands and results); what changed from
  the plan and why; what is open.
- A plan's status page carries short marks only; the long record goes to the log.

## The lessons list

- Keep a list of mistakes made and the rule each taught: "the screenshot was taken mid-animation — wait for it before
  calling a dialog missing"; "a test fixture's numbers disagreed with each other — check the fixture before the code".
- Read it before similar work. Add to it when a mistake costs time.
