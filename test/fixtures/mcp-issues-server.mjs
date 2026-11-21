// A scripted MCP server for a board's pull (the Space Apps plan of 10-29), stdio (newline JSON-RPC), shaped as Linear's:
// list_issues (read-only: its issues as JSON text, each its identifier, title, status, url and assignee) and
// update_issue (not read-only: `id` an identifier, `state` a status name — "Nope" is refused, as a strict server's;
// answers its words). The issues live while it runs. Records each tools/call in the file named by MCP_FIXTURE_LOG, one
// JSON line each.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";

const logFile = process.env.MCP_FIXTURE_LOG || "";
const ISSUES = [
  { id: "a1", identifier: "LIN-42", title: "Login redirect loops", status: "In Progress", url: "https://linear.example.invalid/acme/issue/LIN-42", assignee: { name: "Sara" } },
  { id: "a2", identifier: "LIN-43", title: "Retry the flaky upload", status: "Todo", url: "https://linear.example.invalid/acme/issue/LIN-43", assignee: { name: "Ken" } },
  { id: "a3", identifier: "LIN-44", title: "Review the docs", status: "In Review", url: "https://linear.example.invalid/acme/issue/LIN-44", assignee: null },
  { id: "a4", identifier: "LIN-40", title: "An old one", status: "Done", url: "https://linear.example.invalid/acme/issue/LIN-40", assignee: null },
];
const TOOLS = [
  { name: "list_issues", description: "The issues assigned to you.", inputSchema: { type: "object", properties: { assignee: { type: "string" }, limit: { type: "number" } } }, annotations: { readOnlyHint: true } },
  { name: "update_issue", description: "Change an issue.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, state: { type: "string" } } } },
];

async function handle(msg) {
  if (msg.method === "initialize") return { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "issues-fixture", version: "1.0" } };
  if (msg.method === "tools/list") return { tools: TOOLS };
  if (msg.method !== "tools/call") throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
  const { name, arguments: a = {} } = msg.params || {};
  if (logFile) appendFileSync(logFile, `${JSON.stringify({ tool: name, args: a })}\n`);
  switch (name) {
    case "list_issues":
      return { content: [{ type: "text", text: JSON.stringify(ISSUES) }] };
    case "update_issue": {
      const issue = ISSUES.find((x) => x.identifier === a.id || x.id === a.id);
      if (!issue) return { content: [{ type: "text", text: `no issue ${a.id}` }], isError: true };
      if (a.state === "Nope") return { content: [{ type: "text", text: `${a.state} is no state of this team` }], isError: true };
      if (a.state) issue.status = a.state;
      return { content: [{ type: "text", text: `Moved ${issue.identifier} to ${issue.status}.` }] };
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
  if (msg.id === undefined || msg.id === null) return;
  try {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: await handle(msg) })}\n`);
  } catch (e) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: e.code || -32000, message: e.message } })}\n`);
  }
});
rl.on("close", () => process.exit(0));
