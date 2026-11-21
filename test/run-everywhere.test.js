// @ts-check
// The remote-agents plan's p-every: a skill Filament ships, run-everywhere, that runs one check on every machine paired
// for its agents in parallel and answers with one table. It is a SKILL.md alone, loaded on demand (by its description,
// or $run-everywhere); these tests hold it to the tools it names, so a field renamed in tools.js fails here, not in a
// person's chat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillStore } from "../src/app/skill-store.js";
import { parseSkillFile } from "../src/app/agent/skills.js";
import { AGENT_TOOL, COMMAND_MACHINE_FIELDS, loopToolArgs } from "../src/app/agent/tools.js";
import { BACKGROUND_COMMAND_MACHINE_TOOL } from "../src/app/agent/commands.js";
import { RUN_EVERYWHERE_LINE } from "../src/app/agent/remote-agents.js";

const SHIPPED = join(import.meta.dirname, "..", "src", "skills");
const FILE = join(SHIPPED, "run-everywhere", "SKILL.md");

// (fails before: yes — Filament shipped no such skill)
test("run-everywhere is shipped: listed among Filament's own skills, its head read, its triggers said", () => {
  const root = mkdtempSync(join(tmpdir(), "filament-run-everywhere-"));
  try {
    const store = createSkillStore({ dataDir: join(root, "data"), shippedDir: SHIPPED, home: join(root, "home"), env: {} });
    const it = store.list().find((x) => x.name === "run-everywhere");
    assert.ok(it, "listed");
    assert.deepEqual([it.kind, it.from, it.there], ["shipped", "filament", true]);
    assert.match(it.description, /every machine/);
    const { meta, body } = parseSkillFile(readFileSync(FILE, "utf8"));
    assert.equal(meta.name, "run-everywhere");
    assert.match(String(meta.triggers), /every machine/);
    assert.ok(body.length > 500 && body.length < 8000, `a page an agent reads at once: ${body.length} characters`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// (fails before: yes — no skill named these fields)
test("every tool field the skill tells the agent to use is a field of the tool it names, as offered where a machine is kept", () => {
  const body = parseSkillFile(readFileSync(FILE, "utf8")).body;
  const tools = loopToolArgs({ machines: true });
  const agent = /** @type {any} */ (tools.find((t) => t.name === "agent"));
  const bg = /** @type {any} */ (tools.find((t) => t.name === "bash_background"));
  assert.ok(agent && bg, "the agent tool and bash_background, offered where a machine is kept");
  for (const field of ["list_machines", "machine", "run_in_background", "subagent_type", "changes"]) {
    assert.match(body, new RegExp(`\`${field}`), `the skill names ${field}`);
    assert.ok(field in agent.input_schema.properties, `the agent tool takes ${field}`);
  }
  for (const kind of ["reviewer", "builder"]) {
    assert.match(body, new RegExp(`"${kind}"`));
    assert.ok(AGENT_TOOL.input_schema.properties.subagent_type.enum.includes(kind), `subagent_type ${kind}`);
  }
  for (const field of Object.keys(COMMAND_MACHINE_FIELDS)) assert.ok(field in bg.input_schema.properties, `bash_background takes ${field}`);
  assert.match(body, /`bash_background`/);
  assert.match(body, /`bash_output`/);
  assert.match(body, /`background_command`/);
  assert.match(body, /"uncommitted"/);
  assert.ok(/** @type {any} */ (AGENT_TOOL.input_schema.properties.changes).description.includes("uncommitted"), "changes takes uncommitted");
  for (const field of Object.keys(COMMAND_MACHINE_FIELDS)) assert.ok(field in BACKGROUND_COMMAND_MACHINE_TOOL.input_schema.properties, `a coding agent's background_command takes ${field}`);
});

// (fails before: yes — the hunt on p-every: a command ran each clone's own commit, an unpushed commit was handed as a
// patch of uncommitted files, a coding agent was told of loop hands it lacks, the sub-agent way left this machine out,
// and nothing told an agent of the skill, which is on nowhere, where its machines are listed)
test("each run reaches this machine's commit and prints it; a commit not pushed needs a push; this machine runs either way; the machines' list names the skill; the GUIDE says how it loads", () => {
  const { meta, body } = parseSkillFile(readFileSync(FILE, "utf8"));
  /** The skill's words from `from` to `to`. @param {string} from @param {string} to */
  const part = (from, to) => {
    const at = body.indexOf(from);
    assert.ok(at >= 0, from);
    return body.slice(at, body.indexOf(to, at));
  };
  const command = part("**A command**", "**A sub-agent**");
  // (fails before: yes — the swarm's review of 11-10: a pull reached the branch's tip, not this commit, and moved the
  // person's checkout; the folder went unquoted; the worktree was never taken away; the mode was said as that machine's)
  assert.match(command, /`git fetch && git worktree add --detach "<folder>" <commit> && cd "<folder>" && git rev-parse --short HEAD`/, "the command reaches the commit in a worktree of its own and prints it before its check");
  assert.match(command, /`git worktree remove --force "<folder>"`/, "the worktree is taken away after");
  assert.match(command, /Each runs in this chat's permission mode there, as far as that machine lets this machine's agents/);
  assert.doesNotMatch(body, /git pull|own permission mode|<folder> <commit>/, "no pull, no unquoted folder, no mode of that machine's own");
  assert.match(command, /`background_command`/, "a coding agent's own command, where the recipe is");
  assert.match(part("**A sub-agent**", "## 4."), /this machine's run beside them as a command/);
  const same = part("## 2.", "## 3.");
  assert.match(same, /A commit reaches another machine only by a push/);
  assert.match(same, /`changes: "uncommitted"` hands a sub-agent this folder's uncommitted files as a patch, never its commits/);
  // (fails before: yes — the re-read of 11-11, its words: a copy was said to go less what .gitignore leaves out alone)
  assert.match(same, /Held back here as well: a secret's file git does not track \(by\s+its name, or a private key by its first lines\), a file over 100 MB, and a link that leads out of the folder\./);
  assert.match(RUN_EVERYWHERE_LINE, new RegExp(`load the skill ${meta.name} with the skill tool`));
  const guide = readFileSync(join(import.meta.dirname, "..", "docs", "GUIDE.md"), "utf8");
  assert.match(guide, /\*run-everywhere\*\. Like every skill Filament ships it is on nowhere until you turn it on/);
  const shipped = readdirSync(SHIPPED, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const said = /Filament ships (\w+) skills, on nowhere until you turn them on:([^]*?)\*\*Memory\*\*/.exec(guide);
  assert.ok(said, "the GUIDE lists the skills Filament ships");
  assert.equal(said[1], ["", "one", "two", "three", "four", "five"][shipped.length], `as many as ship: ${shipped.join(", ")}`);
  for (const name of shipped) assert.ok(said[2].includes(`**${name}**`), `the GUIDE names ${name}`);
});
