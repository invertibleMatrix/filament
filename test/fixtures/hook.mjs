// A scripted session hook for the tests (HarnessV2 §5.6): reads the event JSON on stdin, answers per its arguments.
//   node hook.mjs allow                → {"verdict":"allow"}
//   node hook.mjs block <note>         → {"verdict":"block","note":<note>}
//   node hook.mjs note                 → {"note":"saw <event> of <tool>"}
//   node hook.mjs rewrite <path>       → {"args":{...input, path}}   (pre-tool only)
//   node hook.mjs exit <code> <text>   → prints <text>, exits with <code> (no JSON)
//   node hook.mjs record <file> [...]  → appends the stdin JSON as one line to <file>, then behaves as the rest says
//   node hook.mjs sleep <ms>           → waits, then allows
import { appendFileSync } from "node:fs";

let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
let event = {};
try { event = JSON.parse(stdin || "{}"); } catch {}
const args = process.argv.slice(2);
if (args[0] === "record") {
  appendFileSync(args[1], JSON.stringify({ ...event, env: { event: process.env.FILAMENT_HOOK_EVENT || null, tool: process.env.FILAMENT_HOOK_TOOL || null, session: process.env.FILAMENT_SESSION || null, turn: process.env.FILAMENT_TURN || null } }) + "\n");
  args.splice(0, 2);
}
const mode = args[0] || "allow";
if (mode === "block") console.log(JSON.stringify({ verdict: "block", note: args.slice(1).join(" ") || "blocked by the test hook" }));
else if (mode === "note") console.log(JSON.stringify({ note: `saw ${event.event} of ${event.tool}` }));
else if (mode === "rewrite") console.log(JSON.stringify({ args: { ...(event.input || {}), path: args[1] || "rewritten.txt" } }));
else if (mode === "exit") {
  console.log(args.slice(2).join(" ") || `exit ${args[1]}`);
  process.exit(Number(args[1]) || 0);
} else if (mode === "sleep") {
  await new Promise((r) => setTimeout(r, Number(args[1]) || 1000));
  console.log(JSON.stringify({ verdict: "allow" }));
} else console.log(JSON.stringify({ verdict: "allow" }));
