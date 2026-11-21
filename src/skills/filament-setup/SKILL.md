---
name: filament-setup
description: Help a person set Filament up, or find what is missing, with Filament's own command line — status, models, coding agents and their sign-in, API keys, memory and its model. Load it when they ask how to connect a key or an agent, why no model answers, or to check their setup.
---

# Setting Filament up with its command line

Filament names its command line (`… --help`) in your Environment section — or, for a coding agent (Claude Code, Codex…),
in what Filament's server tells you as it connects. Every command below is that line with the command after it;
`filament` stands for it here.

## In five lines

1. Look first: `filament status` says what runs, what answers, which keys and coding agents are set up, and memory.
2. A key is the person's to type. Never ask for one in the chat, never put one on a command line: they run
   `filament keys add <provider>` in a terminal of their own, which shows each character as a star.
3. A sign-in is the person's too: `filament agents sign-in <id>` opens their browser, or gives them a line to run.
4. Change nothing the person did not ask for. Say the command, what it will do, and let them say yes.
5. Read the exit code: 0 done, 1 failed, 2 typed wrong, 3 no Filament answers, 4 needs the person, 5 busy.

## What each command is for

| Ask | Command | Reads only? |
| --- | --- | --- |
| Where it stands | `filament status` (`--json` for the fields) | yes |
| The models a chat can run on | `filament models` | yes |
| The coding agents here, each account and who it is signed in as | `filament agents` | yes |
| The providers with a key (masked) | `filament keys` | yes |
| Memory, and the model it learns with | `filament memory` | yes |
| One setting | `filament settings get <path>` | yes |
| A provider's key | `filament keys add <provider>` — the person runs it | no |
| Is that key right | `filament keys test <id>` | no — it calls the provider |
| Connect a coding agent | `filament agents connect <id>`, then `filament agents sign-in <id>` | no |
| Memory on, its model | `filament memory on`, `filament memory model <name, auto or off>` | no |
| A setting changed | `filament settings set <path> <value>` | no |
| The whole walk-through | `filament setup` — the person runs it, at a terminal | no |

In Edit mode the read-only ones run without asking — as Filament's line names them, unless it gives a `--data-dir`. The others ask the person first, and should. What these print never holds a key: a key shows as `set`.

`filament chat` ends with exit 4 where the agent it drives asks the person something: the question waits in the
harness (`filament open`), not here.

## Common cases

- **No model answers** (`status` says none can): the person needs a key (`filament keys add anthropic`, `openai`,
  `openrouter`…) or a coding agent they already use (`filament agents`, then connect and sign in).
- **A key was added and chats fail**: `filament keys test <id>` asks the provider; its words say why (a 401 is a
  wrong key; a 429 a plan's limit).
- **A coding agent says not signed in**: `filament agents sign-in <id>`; `filament agents check <id>` reads it again
  after a sign-in in another terminal. An agent can have several accounts (Settings › Coding agents): `--account <name>`
  picks one. An account that says **off** is the person's choice — Filament does not use it —, never a sign-in missing:
  leave it off, and sign in none they did not ask for.
- **Memory learns with nothing**: `filament memory` says why; `filament memory model <name>` sets the model it
  learns with, first for every memory call. Not set (`auto`), it takes each chat's compaction model, else the chat's own.
- **Exit 3**: no Filament answers where the command looked. You run inside it, so this means the command found
  another data folder: use the line Filament gave you, with its `--data-dir` if it has one.

Never run `filament stop`, and never start a second Filament: your own turn runs inside this one.
