// A scripted MCP server for the watchers' tests (the plan of 11-11, its w4): stdio, newline JSON-RPC. Its one read-only
// tool, feed, answers what the file `feed.json` in its working folder holds now — as data where it reads as JSON, as
// words where not —, or fails where the file says FAIL; no content at all where it says EMPTY, a text part of no words
// where it says BLANK. `issues.list` answers the same, under a name the loop cleans (mcp__feed__issues_list). `push`
// writes, and is not read-only. Each tools/call is counted in `calls.txt` beside it, so a test knows how often it was
// asked.
import { createInterface } from "node:readline";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const READS = ["feed", "issues.list"];
const TOOLS = [
  ...READS.map((name) => ({ name, description: "What the feed holds now.", inputSchema: { type: "object", properties: { team: { type: "string" } } }, annotations: { readOnlyHint: true } })),
  { name: "push", description: "Write to the feed.", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
];

/** @param {any} msg */
function handle(msg) {
  if (msg.method === "initialize") return { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "feed", version: "1.0" } };
  if (msg.method === "tools/list") return { tools: TOOLS };
  if (msg.method === "tools/call") {
    appendFileSync("calls.txt", `${JSON.stringify(msg.params?.arguments ?? {})}\n`);
    if (msg.params?.name === "push") {
      writeFileSync("feed.json", String(msg.params?.arguments?.text ?? ""));
      return { content: [{ type: "text", text: "pushed" }] };
    }
    if (!READS.includes(msg.params?.name)) throw Object.assign(new Error(`unknown tool ${msg.params?.name}`), { code: -32602 });
    const held = existsSync("feed.json") ? readFileSync("feed.json", "utf8") : "[]";
    if (held.trim() === "FAIL") return { isError: true, content: [{ type: "text", text: "the feed is down" }] };
    if (held.trim() === "EMPTY") return { content: [] };
    if (held.trim() === "BLANK") return { content: [{ type: "text", text: "" }] };
    return { content: [{ type: "text", text: held }] };
  }
  throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined || msg.id === null) return;
  let out;
  try {
    out = { jsonrpc: "2.0", id: msg.id, result: handle(msg) };
  } catch (/** @type {any} */ e) {
    out = { jsonrpc: "2.0", id: msg.id, error: { code: e.code || -32000, message: e.message } };
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
});
