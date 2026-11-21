// A scripted MCP server for a Space's dashboards (HarnessV4_Space_Plan S4a), stdio (newline JSON-RPC). Its runs are
// `runs.json` in its working folder where that is there, else two of its own. Tools: list_runs (read-only: the runs as
// structured content, `branch` keeps one branch's, after `ms` where it names one), list_text (read-only: the runs as JSON text), chatter (read-only:
// words, no data), broken (read-only: an error result), rerun (not read-only: run `run_id` queued again, in runs.json
// where there is one; answers its words; a run_id that is no number is refused, as a strict server's), hold (not
// read-only: answers after `ms`, a minute when it names none), post_message (not read-only: a draft's send — answers
// "Posted in #<channel>" and the message's link; a channel "closed" is refused; after `ms` where it names one).
// Records each tools/call in the file named by MCP_FIXTURE_LOG, one JSON line each, and each cancellation it is sent
// (`{"cancelled":<request id>}`). A file `list_runs.acts` in its working folder makes list_runs one it does not say
// only reads, from the next tools/list on; a file `rerun.gone`, a list without rerun.
import { createInterface } from "node:readline";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const logFile = process.env.MCP_FIXTURE_LOG || "";
const RUNS = [
  { id: 8812, run_number: 412, head_branch: "main", head_commit: { message: "Fix login redirect" }, conclusion: "failure", created_at: "2026-10-24T13:46:00Z" },
  { id: 8807, run_number: 411, head_branch: "main", head_commit: { message: "Add PLAY-88 retry" }, conclusion: "success", created_at: "2026-10-24T12:00:00Z" },
];
const file = join(process.cwd(), "runs.json");
const runs = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : RUNS);
const READ = { readOnlyHint: true };
const TOOLS = [
  { name: "list_runs", description: "The workflow runs.", inputSchema: { type: "object", properties: { branch: { type: "string" } } }, annotations: READ },
  { name: "list_text", description: "The workflow runs, as JSON text.", inputSchema: { type: "object", properties: {} }, annotations: READ },
  { name: "chatter", description: "Words about the runs.", inputSchema: { type: "object", properties: {} }, annotations: READ },
  { name: "broken", description: "Fails.", inputSchema: { type: "object", properties: {} }, annotations: READ },
  { name: "rerun", description: "Re-run a run's failed jobs.", inputSchema: { type: "object", required: ["run_id"], properties: { run_id: { type: "number" } } } },
  { name: "hold", description: "Answers after ms.", inputSchema: { type: "object", properties: { ms: { type: "number" } } } },
  { name: "post_message", description: "Post a message in a channel.", inputSchema: { type: "object", required: ["channel", "text"], properties: { channel: { type: "string" }, text: { type: "string" }, ms: { type: "number" } } } },
];
let posts = 0;

async function handle(msg) {
  if (msg.method === "initialize") return { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "runs-fixture", version: "1.0" } };
  if (msg.method === "tools/list") {
    const listed = existsSync(join(process.cwd(), "list_runs.acts")) ? TOOLS.map((t) => (t.name === "list_runs" ? { ...t, annotations: {} } : t)) : TOOLS;
    return { tools: existsSync(join(process.cwd(), "rerun.gone")) ? listed.filter((t) => t.name !== "rerun") : listed };
  }
  if (msg.method !== "tools/call") throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
  const { name, arguments: a = {} } = msg.params || {};
  if (logFile) appendFileSync(logFile, `${JSON.stringify({ tool: name, args: a })}\n`);
  switch (name) {
    case "list_runs": {
      if (Number(a.ms) > 0) await new Promise((r) => setTimeout(r, Number(a.ms)));
      const list = runs().filter((r) => !a.branch || r.head_branch === a.branch);
      return { content: [{ type: "text", text: `${list.length} runs` }], structuredContent: { total_count: list.length, workflow_runs: list } };
    }
    case "list_text":
      return { content: [{ type: "text", text: JSON.stringify(runs()) }] };
    case "chatter":
      return { content: [{ type: "text", text: "Here are your runs: two of them, one red." }] };
    case "broken":
      return { content: [{ type: "text", text: "the API said 502" }], isError: true };
    case "rerun": {
      if (typeof a.run_id !== "number") return { content: [{ type: "text", text: `run_id must be a number, not ${JSON.stringify(a.run_id)}` }], isError: true };
      const list = runs();
      const r = list.find((x) => x.id === Number(a.run_id));
      if (!r) return { content: [{ type: "text", text: `no run ${a.run_id}` }], isError: true };
      r.conclusion = "queued";
      if (existsSync(file)) writeFileSync(file, JSON.stringify(list, null, 1));
      return { content: [{ type: "text", text: `Queued run ${r.run_number} again.\nIts failed jobs re-run.` }] };
    }
    case "hold":
      await new Promise((r) => setTimeout(r, Number(a.ms) || 60_000));
      return { content: [{ type: "text", text: "held" }] };
    case "post_message": {
      if (Number(a.ms) > 0) await new Promise((r) => setTimeout(r, Number(a.ms)));
      if (a.channel === "closed") return { content: [{ type: "text", text: "channel_is_archived: #closed takes no messages" }], isError: true };
      posts++;
      return { content: [{ type: "text", text: `Posted in #${a.channel}: https://chat.example.invalid/${a.channel}/p${posts}.` }] };
    }
    default:
      throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined || msg.id === null) {
    if (msg.method === "notifications/cancelled" && logFile) appendFileSync(logFile, `${JSON.stringify({ cancelled: msg.params?.requestId ?? null })}\n`);
    return;
  }
  try {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: await handle(msg) })}\n`);
  } catch (e) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: e.code || -32000, message: e.message } })}\n`);
  }
});
rl.on("close", () => process.exit(0));
