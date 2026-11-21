// The catalogue of what can be typed into a chat (src/app/commands/registry.js): every group, the configured words, and
// the markdown docs/COMMANDS.md is generated from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { commandCatalog, commandsMarkdown } from "../src/app/commands/registry.js";

// (fails before: yes — d-send's follow-up: `/team`'s own answer says chat since version 123, and its catalogue, which
// the page's list of commands and docs/COMMANDS.md read, still said session)
test("commands catalog: /team's group says chat, as its answer does; docs/COMMANDS.md is generated from it", () => {
  const team = commandCatalog({ experimental: { teams: true } }).groups.find((g) => g.id === "team");
  assert.match(team?.intro || "", /^Which team answers this chat's turns in the harness\. A team is a lead on the chat's model — it plans, briefs and checks — /);
  assert.match(team?.intro || "", / Choosing one writes this chat's settings \(engine\.mode and engine\.team\), so it holds until you give the chat back\. /);
  assert.deepEqual((team?.commands || []).map((c) => c.summary), [
    "The teams — each one's lead in a sentence — which one leads this chat, and the model its workers run on.",
    "Hand this chat's turns to a team from the next message on: its key or its name (`/team BugHunters`). Switching costs one fresh prompt cache, once.",
    "Give the chat back: its turns go to your agent again.",
  ]);
  assert.doesNotMatch(JSON.stringify(team), /session/);
  const docs = readFileSync(new URL("../docs/COMMANDS.md", import.meta.url), "utf8");
  assert.ok(docs.includes("\nWhich team answers this chat's turns in the harness. A team is a lead on the chat's model — "), "docs/COMMANDS.md regenerated");
  for (const row of ["| `/team` | `/team` · `/team help` | api | The teams — each one's lead in a sentence — which one leads this chat, and the model its workers run on. |", "| `/team off` | `/team off` | api | Give the chat back: its turns go to your agent again. |"]) assert.ok(docs.includes(row), row);
});

// (fails before: yes — the owner's rules of 10-31: the catalogue still listed /turns, a command that chose how earlier
// turns are sent, with its configured word, and /trim, which answered a client's compaction)
test("commands catalog: every group, the configured words, and the markdown", () => {
  const cat = commandCatalog({ rules: { trim: { command: "/trim" }, view: { command: "/ctx", enabled: true } }, memory: { commands: { prefix: "@m" } } });
  assert.deepEqual(cat.words, { goal: "/goal", mem: "@m" }, "an old view rule or trim rule names no word");
  const ids = cat.groups.map((g) => g.id);
  for (const id of ["chat", "goal", "compact", "memory", "agent", "model-name"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes("view") && !ids.includes("trim"), "no group chooses how earlier turns are sent, nor answers a client's compaction");
  assert.ok(!cat.groups.some((g) => g.commands.some((c) => /^\/(ctx|turns|view|trim)\b/.test(c.command))), "nor any command");
  for (const g of cat.groups) for (const c of g.commands) { assert.ok(c.forms.length >= 1, c.command); assert.ok(c.where.length >= 1, c.command); assert.ok(c.summary.length > 20, c.command); }
  const md = commandsMarkdown();
  assert.match(md, /^# Commands you can type into a chat/);
  assert.doesNotMatch(md, /\| `\/(turns|view|trim)\b/); assert.match(md, /\| `\/compact` \|/);
  assert.ok(md.split("\n").length > 40);
});

// (fails before: yes — the owner's rule of 10-31: the catalogue offered `@mem attach`, which filed a client's chat under
// another session, and `@mem new` said it detached an attached chat)
test("commands catalog: memory's commands file no chat under another session", () => {
  const memory = commandCatalog({}).groups.find((g) => g.id === "memory");
  const words = (memory?.commands || []).map((c) => c.command);
  assert.ok(words.includes("@mem load") && words.includes("@mem new"), words.join(", "));
  assert.ok(!words.some((w) => /attach/.test(w)), words.join(", "));
  assert.equal(memory?.commands.find((c) => c.command === "@mem new")?.summary, "Start a fresh memory session in this chat: the next message starts a fresh chain with a fresh briefing, linked to a session of the folder its agent loads in that first turn. A chat of the harness's own goes on as itself; New chat starts fresh.");
  assert.doesNotMatch(commandsMarkdown(), /@mem attach|attached chat/);
});

// (fails before: yes — a form's `|` went into the table bare, `view=<none|folded|window|fork>` and `<n|id>` among
// them, so the rows of `/subagent <task>`, `@mem load` and `@mem attach` had more cells than the header's four)
test("commands markdown: a `|` inside a cell is escaped, so every command's row has its table's four cells", () => {
  const rows = commandsMarkdown()
    .split("\n")
    .filter((l) => l.startsWith("| `"));
  assert.ok(rows.length > 40, `${rows.length} rows`);
  const split = rows.filter((row) => row.replace(/\\\|/g, "").split("|").length - 2 !== 4);
  assert.deepEqual(split, []);
});

// (fails before: yes — with memory off the group came back switched off (`enabled` false), its intro "Memory is off;
// turn it on under Memory to use these", while `@mem` is answered memory on or off)
test("commands catalog: memory's commands are switched off by their own switch alone; with memory off they are still answered", () => {
  const memory = (/** @type {any} */ cfg) => commandCatalog(cfg).groups.find((g) => g.id === "memory");
  const off = memory({ memory: { enabled: false } });
  assert.equal(off?.enabled, true, "memory off leaves its commands on");
  assert.match(off?.intro || "", /in every chat — an outside client's included, memory on or off \(it is off now: nothing is recalled or learned\)/);
  assert.doesNotMatch(off?.intro || "", /turn it on/);
  const switched = memory({ memory: { commands: { enabled: false } } });
  assert.equal(switched?.enabled, false);
  assert.match(switched?.intro || "", /Memory commands are switched off under Memory → Settings → commands\./);
});
