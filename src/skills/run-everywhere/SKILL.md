---
name: run-everywhere
description: Run the same check on every machine paired for Filament's agents — the test suite, a build, a page's screenshot — in parallel, and answer with one table of what passed where. Load it when the person asks to run something on all their machines, on each OS, or "everywhere", or to find what fails only on one machine.
triggers: run everywhere, every machine, all machines, each machine
---

# One check, every machine

You have other machines where this Filament keeps a device for its agents: your agent tool takes `machine`, and so
does your background command — `bash_background` in Filament's own loop, `background_command` for Claude Code, Codex
and Cursor. This is how to run one check on each of them at once and say plainly what passed where.

## In five lines

1. List the machines first: the agent tool with `list_machines: true`.
2. Make every run test the same code: this machine's commit, reached on each machine and printed by the run.
3. Start every run in one reply, in parallel, this machine's too — never one machine after another.
4. A machine that does not answer, or refuses, is a row of the table, not a stop.
5. Answer with one table, then one line on what differs between machines.

## 1. Which machines

Call the agent tool with `list_machines: true`. Each machine comes with whether it answers, its system, CPUs and
load, memory, GPU, and its clones of this project with their branch and whether they are clean.

- The machines the person named; else every machine that answers and has a clone of this project — and this machine.
- One without a clone gets no command: a sub-agent runs there instead, in its own copy of this folder (section 2);
  where its Filament makes none, the launch says so, and its row does. Do not clone a repository on another machine
  unasked.
- One that does not answer now: its row says why, in the words list_machines gave.

## 2. The same code everywhere

Note this machine's commit and branch, and whether they are pushed: `git rev-parse --short HEAD` and `git status -sb`,
whose first line says `ahead` where commits are not.

- A commit reaches another machine only by a push. One not pushed cannot be fetched there: say so and ask the person to
  push it before the runs. A run started before that cannot reach it there, and its row says so.
  `changes: "uncommitted"` hands a sub-agent this folder's uncommitted files as a patch, never its commits.
- Leave the person's checkout there as it is: its branch, its HEAD and its uncommitted work. A run on a clone goes in a
  worktree of the commit beside it, made for that run and taken away after: `<commit>` is this machine's whole commit
  (`git rev-parse HEAD`), never a branch, whose tip there may be another; `<folder>` a new folder beside the clone, a
  name of its own for each run, always quoted.
- A sub-agent launched with no `cwd` works in its own copy of this folder there, sent as it stands: this commit and
  its uncommitted files, pushed or not, with nothing to reach. What `.gitignore` leaves out is not sent: it installs
  the project's dependencies there before its check. Held back here as well: a secret's file git does not track (by
  its name, or a private key by its first lines), a file over 100 MB, and a link that leads out of the folder. A check
  that needs one of them fails there for want of it, not for the code: the sub-agent is told which stayed, so ask its
  report to name them. In its copy, HEAD is a snapshot Filament made, not this commit: its row's Commit is this
  machine's, with *+ uncommitted* where uncommitted files went.
- Every run prints the commit it ran at (`git rev-parse --short HEAD`) before its check: the table's Commit column is
  what ran, not what was meant.

## 3. Start them all at once

Two ways; pick by what the check needs. Either way this machine's run starts in the same reply, as a command here.

**A command** — when you know what to run and only need its output: the suite, a build, a script. One background
command per machine with `machine` (and `cwd` where its clone is not the one list_machines matched), and one for this
machine without `machine`. Each command does it all, in that machine's shell: reach the commit in a worktree of its
own, print it, run the check —
`git fetch && git worktree add --detach "<folder>" <commit> && cd "<folder>" && git rev-parse --short HEAD`, followed
by the project's install and its check. Once its output is read, one more command there in the clone takes the
worktree away: `git worktree remove --force "<folder>"`.
Each runs in this chat's permission mode there, as far as that machine lets this machine's agents (Auto only where it
lets them work without asking); what it asks comes to the person here. In Filament's loop read each one's output as it
ends (`bash_output`); a coding agent's `background_command` hands its result back whole as it ends.

**A sub-agent** — when the run needs judgment there: a machine with no clone, or uncommitted work to test (with no
`cwd` it works in its own copy, section 2), a clone that must reach the commit through a worktree and an install,
reading a failure, a screenshot of a page that machine serves. In one reply, one agent call per other
machine with `machine`, `run_in_background: true` and `subagent_type: "builder"`, which runs commands and may make a
worktree (`"reviewer"` is for a look that only reads, not a run), and this machine's run beside them as a command.
Brief each the same: the commit, the command, and the report you want back — pass or fail, counts, the first
failure's lines, how long it took, the commit it ran at, and where any file it made (a screenshot) lies there. Its
brief says how its folder reaches your commit, under *Where you run*.

Do not wait idle: start them, then go on or end your turn — each report and each command's end comes back to you.

## 4. One table

| Machine | System | Commit | Result | Time | First failure |
|---|---|---|---|---|---|
| This machine | Windows 11 x64 | a1b2c3d | 12,564 passed | 4 min 30 s | — |
| Studio | macOS 15 arm64 | a1b2c3d | 2 failed of 12,566 | 6 min 10 s | `dist/mac: codesign: no identity` |
| Build box | — | — | did not answer | — | its words from list_machines |

Then one line: what differs, and where to look first ("fails on macOS alone, at signing: the identity is missing
there"). Each row is what that run said, never rounded up: a run that did not start says it did not, and why; one
that ran at another commit says which.

## Examples

- "Run the tests on all my machines" — the suite as a command on each, this machine's with them; one table.
- "Does the Mac build still work?" — the build on the machines whose system is macOS; a sub-agent where the clone must
  first reach the commit through a worktree.
- "Screenshot the login page on each OS" — a sub-agent per machine that serves the page and runs the project's own
  screenshot command there; its report says where the picture lies on that machine.
