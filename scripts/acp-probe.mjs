// Probe an ACP agent over stdio: initialize -> session/new -> session/prompt, printing every message.
// Usage: node scripts/acp-probe.mjs [command] [args...]   (default: agent acp)
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const withTools = process.argv.includes("--tools");
const argv = process.argv.slice(2).filter((a) => a !== "--tools");
const cmd = argv[0] || "agent";
const args = argv.length > 1 ? argv.slice(1) : ["acp"];
const isCmd = process.platform === "win32" && !/\.exe$/i.test(cmd);
const child = isCmd ? spawn("cmd.exe", ["/c", cmd, ...args], { stdio: ["pipe", "pipe", "pipe"] }) : spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", (d) => process.stderr.write(`[stderr] ${d}`));
let id = 0; const pending = new Map(); let buf = "";
const send = (method, params) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject, method }); const msg = JSON.stringify({ jsonrpc: "2.0", id: i, method, params }); console.log(`>> ${msg.slice(0, 400)}`); child.stdin.write(msg + "\n"); });
const reply = (i, result) => { const msg = JSON.stringify({ jsonrpc: "2.0", id: i, result }); console.log(`>> ${msg.slice(0, 300)}`); child.stdin.write(msg + "\n"); };
child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let nl; while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { console.log(`<< (non-json) ${line.slice(0, 300)}`); continue; }
    console.log(`<< ${line.slice(0, 700)}`);
    if (m.id != null && (m.result !== undefined || m.error)) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } }
    else if (m.method === "session/request_permission") { const opts = m.params?.options || []; const allow = opts.find((o) => /allow/i.test(o.kind || o.optionId || "")) || opts[0]; reply(m.id, { outcome: { outcome: "selected", optionId: allow?.optionId } }); }
    else if (m.method && m.id != null) { console.log(`   (unhandled request ${m.method})`); reply(m.id, {}); }
  }
});
const dir = mkdtempSync(join(tmpdir(), "acp-probe-")); writeFileSync(join(dir, "README.md"), "# Probe project\n\nThis project prints hello.\n");
try {
  const init = await send("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "filament-probe", version: "0.1" } });
  console.log("INIT RESULT:", JSON.stringify(init, null, 1).slice(0, 2000));
  const sess = await send("session/new", { cwd: dir, mcpServers: [] });
  console.log("SESSION RESULT:", JSON.stringify(sess, null, 1).slice(0, 2000));
  const prompt = withTools ? "Read README.md in this folder and tell me in one sentence what it says." : "Reply with the single word: pong";
  const res = await send("session/prompt", { sessionId: sess.sessionId, prompt: [{ type: "text", text: prompt }] });
  console.log("PROMPT RESULT:", JSON.stringify(res));
} catch (e) { console.error("PROBE ERROR:", e.message); }
finally { setTimeout(() => { child.kill(); process.exit(0); }, 500); }
