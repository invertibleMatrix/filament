// `Filament doctor`: one command that tells a person what works and what does not, in plain words.
// Checks the config, the data folder, the running server, every enabled coding agent (command found, handshake,
// session, capabilities, login; Codex: its app-server, its sign-in, its models), the housekeeping detection, and
// optionally (--turn) one real one-word turn per agent through Filament's own front door. Nothing here costs money
// unless --turn is given.
import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { loadConfig, validateConfig } from "../services/config/store.js";
import { detectedAgentSeed } from "../adapters/agents/acp/detect.js";
import { AcpProcess, clientCapabilitiesFor } from "../adapters/agents/acp/process.js";
import { readProfile } from "../adapters/agents/acp/profile.js";
import { resolveAgentCommand, commandExists } from "../adapters/agents/agent-process.js";
import { CURSOR_SDK_OFF, KNOWN_AGENTS, agentArgs, agentLaunchEnv, cursorSdkOn, installCommand, signInAdvice, viaRegistry } from "../core/catalogues.js";
import { claudeIdentity } from "../core/agent-limits.js";
import { detectHousekeeping } from "../app/housekeeping.js";
import { loadCursorSdk, findSdkDir, SDK_INSTALL_HINT, SDK_KEY_URL } from "../adapters/agents/cursor-sdk.js";
import { CodexBridge } from "../adapters/agents/codex/bridge.js";
import { ownerHeaders } from "../services/owner.js";

const ok = (what, detail = "") => ({ level: "ok", what, detail });
const warn = (what, detail = "", fix = "") => ({ level: "warn", what, detail, fix });
const fail = (what, detail = "", fix = "") => ({ level: "fail", what, detail, fix });

/**
 * Every check, as sections of findings (`formatDoctor` prints them).
 * @param {{ dataDir?: string, turn?: boolean, agentFilter?: string | null, log?: (level: string, msg: string) => void }} [o]
 *   the data folder; `turn`: one real one-word turn per agent; `agentFilter`: that upstream's agent alone; `log`: the
 *   agents' processes' log
 */
export async function runDoctor({ dataDir, turn = false, agentFilter = null, log = () => {} } = {}) {
  const report = { sections: [], startedAt: new Date().toISOString() };
  const section = (title) => { const s = { title, items: [] }; report.sections.push(s); return s; };

  // ---- config and data folder
  const cfgSec = section("Configuration");
  let config = null, file = null;
  try { const l = loadConfig(dataDir, { agents: detectedAgentSeed }); config = l.config; file = l.file; cfgSec.items.push(ok("config loads", file)); }
  catch (e) { cfgSec.items.push(fail("config does not load", e.message, "fix or delete config.json; a broken copy is kept next to it")); return finish(report); }
  const v = validateConfig(config); if (v.ok) cfgSec.items.push(ok("config is valid")); else for (const e of v.errors) cfgSec.items.push(fail("config error", e, "open Destinations / Settings in the console and correct the field"));
  try { accessSync(dataDir, constants.W_OK); cfgSec.items.push(ok("data folder is writable", dataDir)); } catch { cfgSec.items.push(fail("data folder is not writable", dataDir, "check the folder's permissions")); }
  cfgSec.items.push(existsSync(join(dataDir, "secret.key")) ? ok("secret.key present") : warn("secret.key missing", "encrypted values cannot be read", "it is created on first start; if the config has encrypted values, restore the key from a backup"));
  const enabledOf = (type) => (config.upstreams || []).filter((u) => u.type === type && u.enabled !== false && (!agentFilter || u.id === agentFilter));
  const acps = enabledOf("acp"), codexes = enabledOf("codex");
  const routesFor = (id) => (config.routes || []).filter((r) => r.upstream === id && r.enabled !== false);
  for (const u of [...acps, ...codexes]) if (!routesFor(u.id).length) cfgSec.items.push(warn(`${u.id}: no route points at it`, "", "add a route under Destinations → Routes"));

  // ---- running server, at its host: a wildcard (0.0.0.0, ::) or none is this machine's 127.0.0.1, an IPv6 address goes
  // in brackets, as a URL writes it
  const srv = section("Server");
  const host = String(config.server.host || "").trim();
  const base = `http://${!host || host === "0.0.0.0" || host === "::" || host === "[::]" ? "127.0.0.1" : host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${config.server.port}`;
  let running = false, state = null;
  try { const r = await fetch(`${base}/api/state`, { headers: { "x-filament-ui": "1", ...ownerHeaders(dataDir, base) }, signal: AbortSignal.timeout(3000) }); state = await r.json(); running = r.ok; srv.items.push(ok(`Filament ${state.version} answers at ${base}`, `up ${Math.round((state.uptimeMs || 0) / 60000)} min`)); }
  catch (e) { srv.items.push(warn(`no Filament answering at ${base}`, e.message, "start it (the Filament app, `npm run desktop`, or `node bin/filament.js`); the agent checks below still run")); }
  // This computer's calls without its owner key (services/owner.js): answered for now, each program named.
  const ownerless = state?.ownerless;
  if (running && ownerless) srv.items.push(ownerless.count ? warn(`${ownerless.count} call${ownerless.count === 1 ? "" : "s"} from this computer reached Filament without its owner key since it started`, (ownerless.programs || []).slice(0, 5).map((p) => `${p.agent} (${p.count})`).join(", "), "answered all the same: a program here that calls Filament's API sends the key from owner.key in the data folder as x-filament-owner, or uses the `filament` command line") : ok("every call from this computer carried Filament's owner key"));
  if (running) { // the first model list after a start asks every agent for its models, so allow it time
    try { const r = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${config.server.inboundKeys?.[0] || ""}` }, signal: AbortSignal.timeout(90000) }); const j = await r.json(); const n = (j.data || []).length; srv.items.push(r.ok ? ok(`model list works (${n} names)`) : fail(`model list failed (HTTP ${r.status})`, JSON.stringify(j).slice(0, 200), "check the inbound key")); } catch (e) { srv.items.push(fail("model list failed", e.message)); }
  }

  // ---- agents
  for (const u of acps) {
    const s = section(`Agent: ${u.name || u.id}`); const acp = u.acp || {}; const known = KNOWN_AGENTS.find((a) => a.id === u.id || a.command === acp.command);
    const spec = resolveAgentCommand(acp.command || "agent", agentArgs(acp));
    if (!commandExists(acp.command || "agent") && !existsSync(spec.file)) { s.items.push(fail(`command not found: ${acp.command}`, "", known ? (viaRegistry(known) ? "install it again on its card in Settings → Coding agents" : `install it: ${installCommand(known, process.platform)?.line}`) : "install the agent's CLI and make sure it is on PATH")); continue; }
    s.items.push(ok(`command found`, spec.resolved));
    const full = acp.clientBridge === "full" || acp.clientBridge === "native";
    const p = new AcpProcess({ command: acp.command || "agent", args: [...agentArgs(acp)], env: agentLaunchEnv(u), log, clientCapabilities: clientCapabilitiesFor({ full }) }).start();
    const t0 = Date.now();
    try {
      const init = await withTimeout(p.initialize(), 60000, "initialize");
      const caps = init.agentCapabilities || {}; const pc = caps.promptCapabilities || {};
      s.items.push(ok(`handshake ok in ${Date.now() - t0} ms`, `${init.agentInfo?.name || known?.name || acp.command} ${init.agentInfo?.version || ""}`.trim()));
      s.items.push(ok("accepts", [pc.image ? "images" : "no images", pc.embeddedContext ? "attached files" : "no attached files (inlined as text)", caps.loadSession ? "session resume" : "no session resume", caps.sessionCapabilities?.list ? "session list" : "no session list"].join(", ")));
      const auth = (init.authMethods || []).map((a) => a.id);
      if (auth.length) s.items.push(ok(`login methods: ${auth.join(", ")}`, acp.authenticate ? "Filament calls authenticate at start" : "uses the login the CLI already has"));
      let sess = null;
      try { sess = await withTimeout(p.request("session/new", { cwd: process.cwd(), mcpServers: [] }, 120000), 120000, "session/new"); }
      catch (e) {
        const authy = e.code === -32000 || /auth/i.test(e.message);
        s.items.push(authy ? fail("not logged in", e.message.slice(0, 160), signInAdvice(u, process.platform)) : fail("could not open a session", e.message.slice(0, 200)));
      }
      if (sess) {
        const modes = sess.modes?.availableModes?.map((m) => m.id) || []; const opts = sess.configOptions || [];
        const model = opts.find((o) => o.id === "model" || o.category === "model"); const effort = opts.find((o) => o.category === "thought_level" || /effort|reason/i.test(o.id));
        s.items.push(ok("session opens", [modes.length ? `modes ${modes.join("/")}` : "no modes", model ? `${(model.options || []).length} models (current ${model.currentValue})` : sess.models ? `${(sess.models.availableModels || []).length} models` : "no model list", effort ? `effort ${(effort.options || []).map((o) => o.value ?? o).join("/")}` : "no effort setting"].join(" · ")));
        if (acp.mode && modes.length) { const aliases = { agent: ["agent", "yolo", "bypassPermissions", "auto", "acceptEdits", "accept-edits"], plan: ["plan", "dontAsk"], ask: ["ask", "default", "plan"], ...(acp.modeAliases || {}) }; const want = modes.includes(acp.mode) ? acp.mode : (aliases[acp.mode] || []).find((m) => modes.includes(m)); if (!want) s.items.push(warn(`default mode "${acp.mode}" is not one this agent has`, `has ${modes.join("/")}`, "set acp.mode to one of them, or a common word (agent, plan, ask)")); }
        // Who it runs as, where it says it (Claude's adapter, HarnessV3-ACP AC3-6): its first word on it, eight
        // seconds at most. A session opens signed out; its prompts fail.
        const id = claudeIdentity(readProfile(init).account ? await p.heardWho(8000) : null);
        if (id && id.kind !== "none") s.items.push(ok(`signed in: ${id.label}${id.email ? ` (${id.email})` : ""}`, id.detail || ""));
        else if (id) s.items.push(fail("not logged in", "the agent says nobody is signed in", signInAdvice(u, process.platform)));
      }
      const bridge = acp.clientBridge || "prompts"; s.items.push(ok(`permissions ${acp.permissions || "allow-all"} · client bridge ${bridge}`, bridge === "native" && !(acp.nativeTools || known?.nativeTools) ? "native only applies to Claude Code; this agent gets full" : acp.permissions === "ask" && bridge === "off" ? "ask needs the client bridge; with off it behaves as allow-once" : ""));
      if (acp.permissions === "ask" && bridge === "off") s.items[s.items.length - 1] = warn(`permissions ask with client bridge off`, "prompts fall back to allow-once", "set clientBridge to prompts");
      for (const e of acp.cwdAllowlist || []) if (!/^([A-Za-z]:[\\/]|\/)/.test(String(e))) s.items.push(fail(`cwdAllowlist entry "${e}" is not a folder path`, "it blocks every folder", "remove it or list full folder paths"));
    } catch (e) { s.items.push(fail("handshake failed", e.message.slice(0, 200), "run the agent's own CLI once by hand to see its error")); }
    finally { try { p.kill(); } catch {} }
  }

  // ---- Codex over its app-server: the connection test the console's Test button runs
  for (const u of codexes) {
    const s = section(`Codex: ${u.name || u.id}`); const acp = u.acp || {}; const known = KNOWN_AGENTS.find((a) => a.type === "codex");
    if (!commandExists(acp.command || "codex")) { s.items.push(fail(`command not found: ${acp.command || "codex"}`, "", `install it: ${installCommand(known, process.platform)?.line}`)); continue; }
    const cb = new CodexBridge({ log });
    try {
      const r = await cb.test(u);
      if (!r.ok) s.items.push(fail("Codex's app-server did not start", String(r.error).slice(0, 200), "run `codex app-server` once by hand to see its error"));
      else {
        s.items.push(ok(`app-server answers in ${r.ms} ms`, `${r.command} · codex ${r.agent?.version || "?"}`));
        s.items.push(r.signedIn ? ok(`signed in: ${r.auth}`) : fail("not signed in", "", signInAdvice(u, process.platform)));
        s.items.push(ok(`${r.models} models`, [r.sample, r.efforts?.length ? `efforts ${r.efforts.join("/")}` : ""].filter(Boolean).join(" · ")));
      }
    } finally { cb.shutdown(); }
    s.items.push(ok(`permissions ${acp.permissions || "allow-all"} · client bridge ${acp.clientBridge || "prompts"}`, acp.permissions === "allow-all" || !acp.permissions ? "Codex runs without asking, with full access" : "Codex asks Filament before what its sandbox does not allow"));
  }

  // ---- Cursor through the official SDK, where Settings › Experimental's switch for it is on (the owner's of 11-10)
  if (!cursorSdkOn(config) && enabledOf("cursor-sdk").length) section("Cursor SDK").items.push(warn("off", "", `${CURSOR_SDK_OFF}.`));
  for (const u of cursorSdkOn(config) ? enabledOf("cursor-sdk") : []) {
    const s = section(`Cursor SDK: ${u.name || u.id}`); const acp = u.acp || {};
    const found = findSdkDir();
    if (!found) { s.items.push(fail("@cursor/sdk is not installed", "", `run \`${SDK_INSTALL_HINT}\` once (about 50 MB), then restart Filament; or press Install on the upstream's card`)); }
    else { const l = await loadCursorSdk(); s.items.push(l.ok ? ok(`@cursor/sdk ${l.version} loads`, l.path) : fail("@cursor/sdk is installed but does not load", l.error, "reinstall it; Node 22.13 or newer is required")); }
    if (!String(u.apiKey || "").trim()) s.items.push(fail("no Cursor API key", "", `create one at ${SDK_KEY_URL} and paste it under Destinations → Upstreams → ${u.name || u.id}`));
    else if (found) { try { const l = await loadCursorSdk(); if (l.ok) { const me = await withTimeout(l.mod.Cursor.me({ apiKey: u.apiKey }), 20000, "Cursor.me"); s.items.push(ok(`API key works`, `${me.userEmail || ""}${me.apiKeyName ? ` (key “${me.apiKeyName}”)` : ""}`.trim())); const models = await withTimeout(l.mod.Cursor.models.list({ apiKey: u.apiKey }), 20000, "Cursor.models.list"); s.items.push(ok(`${models.length} models`, models.slice(0, 8).map((m) => m.id).join(", "))); } } catch (e) { s.items.push(fail("the API key was refused or Cursor is unreachable", e.message.slice(0, 160), "check the key in the Cursor Dashboard; keys can expire")); } }
    s.items.push(ok(`permissions ${acp.permissions || "allow-all"} · client bridge ${acp.clientBridge || "prompts"}`, (acp.clientBridge === "full" || acp.clientBridge === "native") ? "Cursor's read/edit/write/shell/delete are replaced by Filament's tools (through the client)" : "Cursor runs its own tools, which the SDK approves itself, in a chat set to Auto; any stricter chat runs them off, Filament's checked tools in their place"));
    if (!routesFor(u.id).length) s.items.push(warn("no route points at it", "", "add a route such as cursor-sdk/* under Destinations → Routes"));
  }

  // ---- housekeeping detection (no model involved)
  const hk = section("Housekeeping requests");
  const sample = { messages: [{ role: "system", content: "Generate a concise title for this coding session.\n\nThis is a title-generation task, not a conversation.\nReturn exactly one valid JSON object with no surrounding text: {\"title\":\"...\"}" }, { role: "user", content: "fix the login test" }] };
  hk.items.push(detectHousekeeping("openai", sample)?.kind === "title" ? ok("A client's title request is recognised and answered by Filament") : fail("title requests would reach the agent", "", "update Filament"));

  // ---- one real turn per agent, through the running server
  if (turn && running) {
    const t = section("Live turns (one word each, real cost)"); const key = config.server.inboundKeys?.[0] || "";
    for (const u of [...acps, ...codexes]) {
      const route = routesFor(u.id)[0]; if (!route) continue; const prefix = route.match.replace(/\*.*$/, ""); const model = `${prefix}${u.id === "claude-code" ? "haiku" : u.id === "cursor" ? "composer-2.5" : "auto"}`;
      const t0 = Date.now();
      try { const r = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-session-id": `doctor-${Date.now()}` }, body: JSON.stringify({ model, messages: [{ role: "system", content: `Working directory: ${process.cwd()}` }, { role: "user", content: "Reply with the single word pong and nothing else." }] }), signal: AbortSignal.timeout(180000) }); const j = await r.json(); const text = j.choices?.[0]?.message?.content || JSON.stringify(j).slice(0, 200); t.items.push(r.ok && /pong/i.test(text) ? ok(`${u.id}: answered in ${Math.round((Date.now() - t0) / 1000)} s`, text.replace(/\s+/g, " ").slice(0, 80)) : warn(`${u.id}: unexpected answer (HTTP ${r.status})`, text.replace(/\s+/g, " ").slice(0, 160), "open Traffic in the console for the record")); }
      catch (e) { t.items.push(fail(`${u.id}: turn failed`, e.message.slice(0, 160))); }
    }
  }
  return finish(report);
}

function finish(report) { const all = report.sections.flatMap((s) => s.items); report.summary = { ok: all.filter((i) => i.level === "ok").length, warn: all.filter((i) => i.level === "warn").length, fail: all.filter((i) => i.level === "fail").length }; return report; }
function withTimeout(p, ms, what) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} did not answer within ${Math.round(ms / 1000)} s`)), ms).unref?.())]); }

export function formatDoctor(report) {
  const glyph = { ok: "✓", warn: "!", fail: "✗" }; const lines = [];
  for (const s of report.sections) { lines.push(`\n${s.title}`); for (const i of s.items) { lines.push(`  ${glyph[i.level]} ${i.what}${i.detail ? `  —  ${i.detail}` : ""}`); if (i.fix && i.level !== "ok") lines.push(`      fix: ${i.fix}`); } }
  lines.push(`\n${report.summary.ok} ok, ${report.summary.warn} warning(s), ${report.summary.fail} problem(s)`);
  return lines.join("\n");
}
