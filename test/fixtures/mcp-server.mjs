// A scripted MCP server for the tests: stdio (newline JSON-RPC) by default, streamable HTTP with `--http`.
// Tools: echo (read-only: returns its text), write_note (writes <name>.txt in the cwd — not read-only), slow (answers
// after `ms`), fail (an isError result), rich (text + image + structured content; with `png` the image is PNG bytes, `bytes`
// long, else bytes that are no image). Records the requests it saw in
// the file named by MCP_FIXTURE_LOG when set, one JSON line each; `--crash` exits before answering; `--stderr`
// writes a line to stderr first. Over HTTP the initialize answer carries an mcp-session-id, tools/call `sse` answers
// as an SSE stream, and a DELETE ends the session. `--grandchild` starts a process of its own that only waits, in the
// same folder, and records both pids (`{ pid, grandchild }`) before anything else. `--resources` says it has resources:
// two (a text note with a secret in it, and a PNG), a template, and resources/read of each; a read of any other address
// is refused. `--page <k>` lists the tools k a page, each but the last with its nextCursor. `--ask-back` adds the tool
// ask_back (stdio): the server exits, and a process it started on its stdout asks the client a question of the
// server's (roots/list) a moment later, whose answer can reach nobody.
import { createInterface } from "node:readline";
import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";
import { join } from "node:path";

const args = process.argv.slice(2);
const httpMode = args.includes("--http");
const crash = args.includes("--crash");
const hasResources = args.includes("--resources");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 7)]).toString("base64");
const RESOURCES = [
  { uri: "note://readme", name: "readme", title: "The project's readme", description: "What the project is.", mimeType: "text/plain" },
  { uri: "img://logo", name: "logo", mimeType: "image/png" },
];
const logFile = process.env.MCP_FIXTURE_LOG || "";
const record = (what) => {
  if (logFile) appendFileSync(logFile, `${JSON.stringify(what)}\n`);
};
if (args.includes("--grandchild")) {
  const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], { cwd: process.cwd(), stdio: "ignore", windowsHide: true });
  record({ pid: process.pid, grandchild: g.pid });
}
if (args.includes("--stderr")) process.stderr.write("fixture: hello from stderr\n");
if (crash) process.exit(3);

const TOOLS = [
  { name: "echo", description: "Echo the text back.", inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "write_note", description: "Write <name>.txt with the text in the working folder.", inputSchema: { type: "object", required: ["name", "text"], properties: { name: { type: "string" }, text: { type: "string" } } } },
  { name: "slow", description: "Answer after ms milliseconds.", inputSchema: { type: "object", properties: { ms: { type: "number" } } }, annotations: { readOnlyHint: true } },
  { name: "fail", description: "Report an error.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "rich", description: "Text, an image and structured content.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "odd name.v2", description: "A name the provider would not take.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
];
// `--many <n>`: n more tools, each as wordy as a hosted server's, for what a server weighs in every request (E49).
const many = args.includes("--many") ? Number(args[args.indexOf("--many") + 1]) || 0 : 0;
for (let i = 0; i < many; i++)
  TOOLS.push({
    name: `tool_${i}`,
    description: `Tool ${i} of a large server: it does one thing to a repository, an issue or a pull request, and says what it did. Pass the owner and the repository, and the fields below.`,
    inputSchema: { type: "object", required: ["owner", "repo"], properties: { owner: { type: "string", description: "The account that owns the repository." }, repo: { type: "string", description: "The repository's name." }, number: { type: "number", description: "The issue's or pull request's number." }, body: { type: "string", description: "The text, in Markdown." } } },
    annotations: { readOnlyHint: true },
  });
if (args.includes("--ask-back")) TOOLS.push({ name: "ask_back", description: "Ask the client a question, then go.", inputSchema: { type: "object", properties: {} } });
const perPage = args.includes("--page") ? Number(args[args.indexOf("--page") + 1]) || 0 : 0;

async function handle(msg) {
  record({ method: msg.method, id: msg.id ?? null, params: msg.params ?? null, env: process.env.FIXTURE_FLAG || null });
  if (msg.method === "initialize") return { protocolVersion: "2025-06-18", capabilities: { tools: {}, ...(hasResources ? { resources: {} } : {}) }, serverInfo: { name: "fixture", version: "1.0" } };
  if (hasResources && msg.method === "resources/list") return { resources: RESOURCES };
  if (hasResources && msg.method === "resources/templates/list") return { resourceTemplates: [{ uriTemplate: "note://{name}", name: "a note by its name", mimeType: "text/plain" }] };
  if (hasResources && msg.method === "resources/read") {
    const uri = msg.params?.uri;
    if (uri === "note://readme") return { contents: [{ uri, mimeType: "text/plain", text: "Filament fixture readme\ntoken=sk-live-123" }] };
    if (uri === "img://logo") return { contents: [{ uri, mimeType: "image/png", blob: PNG }] };
    // A read that takes its time: a stop before it answers tells the server (notifications/cancelled, recorded).
    if (uri === "slow://wait") return new Promise((done) => setTimeout(() => done({ contents: [{ uri, text: "late" }] }), 20_000).unref());
    throw Object.assign(new Error(`no resource ${uri}`), { code: -32002 });
  }
  if (msg.method === "tools/list") {
    if (!perPage) return { tools: TOOLS };
    const from = Number(msg.params?.cursor) || 0;
    return { tools: TOOLS.slice(from, from + perPage), ...(from + perPage < TOOLS.length ? { nextCursor: String(from + perPage) } : {}) };
  }
  if (msg.method === "ping") return {};
  if (msg.method === "tools/call") {
    const { name, arguments: a = {} } = msg.params || {};
    switch (name) {
      case "echo":
        return { content: [{ type: "text", text: `echo: ${a.text}` }] };
      case "write_note":
        writeFileSync(join(process.cwd(), `${a.name}.txt`), String(a.text));
        return { content: [{ type: "text", text: `wrote ${a.name}.txt` }] };
      case "slow":
        await new Promise((r) => setTimeout(r, Number(a.ms) || 1000));
        return { content: [{ type: "text", text: "slow done" }] };
      case "fail":
        return { content: [{ type: "text", text: "it broke" }], isError: true };
      case "rich":
        return { content: [{ type: "text", text: "line one" }, { type: "image", data: a.png ? Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(a.bytes ? a.bytes - 8 : 16, 7)]).toString("base64") : "AAAA", mimeType: "image/png" }, { type: "resource_link", uri: "file:///x", name: "x" }], structuredContent: { n: 1 } };
      case "odd name.v2":
        return { content: [{ type: "text", text: "odd ok" }] };
      case "ask_back": {
        // A process of its own holds the server's stdout and asks once the server is gone: detached, so the server's
        // exit does not take it along (on Windows a child goes with its parent's job).
        const asked = `${JSON.stringify({ jsonrpc: "2.0", id: "q1", method: "roots/list" })}\n`;
        spawn(process.execPath, ["-e", `setTimeout(() => process.stdout.write(${JSON.stringify(asked)}), 400)`], { stdio: ["ignore", "inherit", "ignore"], windowsHide: true, detached: true }).unref();
        setTimeout(() => process.exit(0), 50);
        return new Promise(() => {});
      }
      default:
        throw Object.assign(new Error(`unknown tool ${name}`), { code: -32602 });
    }
  }
  throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
}

const answer = async (msg) => {
  if (msg.id === undefined || msg.id === null) {
    record({ method: msg.method, id: null, params: msg.params ?? null, env: process.env.FIXTURE_FLAG || null });
    return null; // a notification
  }
  try {
    return { jsonrpc: "2.0", id: msg.id, result: await handle(msg) };
  } catch (e) {
    return { jsonrpc: "2.0", id: msg.id, error: { code: e.code || -32000, message: e.message } };
  }
};

if (!httpMode) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const out = await answer(msg);
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  });
  rl.on("close", () => process.exit(0));
} else {
  let sessions = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      if (req.method === "DELETE") {
        record({ method: "DELETE", session: req.headers["mcp-session-id"] || null });
        res.writeHead(200);
        return res.end();
      }
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }));
      }
      record({ http: true, session: req.headers["mcp-session-id"] || null, protocol: req.headers["mcp-protocol-version"] || null, auth: req.headers.authorization || null });
      const out = await answer(msg);
      if (!out) {
        res.writeHead(202);
        return res.end();
      }
      const headers = { "content-type": "application/json" };
      if (msg.method === "initialize") headers["mcp-session-id"] = `sess-${++sessions}`;
      if (msg.method === "tools/call" && msg.params?.name === "echo" && msg.params?.arguments?.sse) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "working" } })}\n\n`);
        res.write(`event: message\ndata: ${JSON.stringify(out)}\n\n`);
        return res.end();
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify(out));
    });
  });
  const port = Number(args[args.indexOf("--http") + 1]) || 0;
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`listening ${server.address().port}\n`);
  });
}
