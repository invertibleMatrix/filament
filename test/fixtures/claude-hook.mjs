// A plugin's hook written for Claude Code, for the tests (HarnessV4_SpacesPlugins_Plan B3): it reads Claude's JSON on
// stdin, keeps it — with the plugin's environment — as a line of seen.jsonl in its plugin's data folder, and answers in
// Claude's words:
//   PreToolUse   a write or command naming "secret": exit 2, the reason on stderr; a file_path ending draft.txt:
//                updatedInput, the file renamed final.txt; anything else: exit 0, nothing said
//   PostToolUse  decision "block" with a reason, which Claude gives the model beside the result
//   Stop         decision "block" the first time (a marker in the data folder), then nothing
//   SessionStart plain output, which Claude adds to the context
//   UserPromptSubmit  a prompt naming "forbidden": exit 2, the reason on stderr; else additionalContext
//   PreCompact   nothing said: it is kept as a line, as every event is
//   SubagentStop decision "block" the first time, as Stop
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
/** @type {any} */
let event = {};
try {
  event = JSON.parse(stdin || "{}");
} catch {}
const data = process.env.CLAUDE_PLUGIN_DATA || ".";
mkdirSync(data, { recursive: true });
const env = { root: process.env.CLAUDE_PLUGIN_ROOT || null, data: process.env.CLAUDE_PLUGIN_DATA || null, project: process.env.CLAUDE_PROJECT_DIR || null, flag: process.env.CLAUDE_PLUGIN_OPTION_FLAG || null };
appendFileSync(join(data, "seen.jsonl"), JSON.stringify({ ...event, env }) + "\n");
const input = event.tool_input || {};
if (event.hook_event_name === "PreToolUse") {
  if (/secret/.test(String(input.content ?? input.command ?? ""))) {
    process.stderr.write("No secrets in this project's files.");
    process.exit(2);
  }
  if (String(input.file_path || "").endsWith("draft.txt"))
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...input, file_path: input.file_path.replace(/draft\.txt$/, "final.txt") } } }));
} else if (event.hook_event_name === "PostToolUse") {
  console.log(JSON.stringify({ decision: "block", reason: `Check what ${event.tool_name} gave.` }));
} else if (event.hook_event_name === "Stop") {
  const marker = join(data, "stopped-once");
  if (!existsSync(marker)) {
    writeFileSync(marker, "1");
    console.log(JSON.stringify({ decision: "block", reason: "Say that the tests ran." }));
  }
} else if (event.hook_event_name === "SessionStart") {
  console.log("The plugin says hello.");
} else if (event.hook_event_name === "UserPromptSubmit") {
  if (/forbidden/.test(String(event.prompt || ""))) {
    process.stderr.write("Not in this project.");
    process.exit(2);
  }
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "Today is the 27th." } }));
} else if (event.hook_event_name === "SubagentStop") {
  const marker = join(data, "subagent-stopped-once");
  if (!existsSync(marker)) {
    writeFileSync(marker, "1");
    console.log(JSON.stringify({ decision: "block", reason: "Check your work once more." }));
  }
}
