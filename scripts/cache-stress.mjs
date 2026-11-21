#!/usr/bin/env node
// Cache-stability stress for the memory autopilot's block re-attachment.
//
// Plays a stateless client at scale: every turn resends the WHOLE clean history (as a real client does),
// memory prepares it, and the exact bytes the provider would see are hashed per message. The property under
// test: the provider-visible conversation may only grow append-only. Any change to an already-sent message
// (a lost re-attached block, a regenerated briefing) breaks the provider's prompt cache from that point on.
//
//   node scripts/cache-stress.mjs [--turns 400] [--msg-kb 4] [--tool-leg-every 25] [--dup-probe] [--quiet]
//        [--model-switch [turn]] [--mute-probe [turn]] [--off-probe [turn]] [--defer-probe]
//
// Transition probes (2026-09-19 cache audit): --model-switch changes the model name mid-run (the chain key must
// not care); --mute-probe mutes the chain mid-run (@mem off); --off-probe sends one x-filament-memory: off request;
// --defer-probe parks deferred memory-tool results right before a tool leg. The same append-only property must
// hold across each transition, or the fix it pins (P1.1-P1.3) has regressed.
//
// Scenarios: a long run with a block on (almost) every message, tool-result legs mid-conversation, an
// optional duplicate-content probe, and per-request timing so cost at multi-million-token depth is visible.
// Everything runs in a throwaway temp folder with the fake sidecar engine; nothing of the real memory is read.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryService } from "../src/memory-service.js";
import { MemoryEngine } from "../src/memory-engine.js";
import { attachMemoryTools } from "../src/memory-tools.js";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true] : [])).filter((x) => x.length));
if (args.help) { console.log("node scripts/cache-stress.mjs [--turns 400] [--msg-kb 4] [--tool-leg-every 25] [--dup-probe] [--quiet] [--model-switch [turn]] [--mute-probe [turn]] [--off-probe [turn]] [--defer-probe]"); process.exit(0); }
const TURNS = Number(args.turns) || 400;
const MSG_KB = Number(args["msg-kb"]) || 4;
const TOOL_EVERY = Number(args["tool-leg-every"]) || 25;
const DUP_PROBE = !!args["dup-probe"];
const QUIET = !!args.quiet;
const probeTurn = (v, dflt) => (v === true ? dflt : Number.isFinite(Number(v)) ? Number(v) : dflt);
const MODEL_SWITCH_AT = args["model-switch"] ? probeTurn(args["model-switch"], Math.floor(TURNS * 0.4)) : -1;
const MUTE_AT = args["mute-probe"] ? probeTurn(args["mute-probe"], Math.floor(TURNS * 0.5)) : -1;
const OFF_AT = args["off-probe"] ? probeTurn(args["off-probe"], Math.floor(TURNS * 0.6)) : -1;
const DEFER_PROBE = !!args["defer-probe"];

const FAKE = fileURLToPath(new URL("../test/fixtures/fake-sidecar.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "filament-cachestress-"));
const cfg = {
  server: { port: 20399, inboundKeys: ["k"] },
  memory: {
    enabled: true, folder: join(dir, "memory"),
    engine: { embeddings: true, bank: "default" },
    autopilot: { enabled: true, mode: "conservative", briefingTokens: 1200, turnTokens: 300, minScore: 0.2, tools: true, cue: true },
    capture: { turns: true, learn: false }, commands: { enabled: true, prefix: "@mem" }, privacy: { encryptArchive: true },
  },
};
const svc = new MemoryService({ getConfig: () => cfg, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20399", getInboundKey: () => "k", getModelNames: () => ["m"] });
svc.start();
svc.store = new MemoryEngine({ command: process.execPath, args: [FAKE], env: { FAKE_SIDECAR_STATE: join(dir, "fake-state.json") }, writeConfig: false });
svc.brain.store = svc.store;

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const filler = (kb, seed) => ("lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(Math.ceil((kb * 1024) / 55)) + `seed-${seed} `).slice(0, kb * 1024);

// Seed one memory per theme so recall finds a strong keyword match on (almost) every turn.
const themes = [];
for (let i = 0; i < TURNS + 10; i++) {
  const t = `gizmo-${i} rev ${1000 + i} calibration tolerance jig voltage margin ${i}`;
  themes.push(t);
  await svc.store.remember({ content: `${t} notes: always reseat gizmo-${i} before recalibrating the voltage margin jig`, source: "fact", importance: 0.9 });
}

const CC_UA = { "user-agent": "claude-cli/2.1.258 (external, cli)", "x-session-id": "stress-1" };
const SYS = `You are Claude Code.\n<env>\nWorking directory: C:\\stress\nIs a git repo: yes\n</env>`;
const history = [];          // the CLIENT's clean copy — what a stateless client resends every turn
let prevWire = [];           // [{ role, hash }] of what the provider saw last request
let prevSys = null;
let prevTools = null;
let blocksOnWire = 0, turns = 0, legs = 0, breaks = 0, firstBreak = null;
const timings = [];          // { turn, msgs, mb, ms }

const userText = (i) => `about ${themes[i]} again like we discussed before: ${themes[i]} proceed with the recalibration. ${filler(1, i)}`;

let modelName = "claude-x";
let offNext = false;
async function sendAndCheck(extra) {
  const body = { model: modelName, max_tokens: 100, system: SYS, messages: structuredClone(history) };
  const t0 = Date.now();
  const headers = offNext ? { ...CC_UA, "x-filament-memory": "off" } : CC_UA;
  const sit = svc.situate({ format: "anthropic", body, headers, model: modelName });
  const prep = await svc.prepare(sit, { requestId: `stress-${turns}` });
  // The server attaches the tools whenever prep allows (server.js:863); the tools section is part of the
  // provider-visible prefix, so a flip (mute, engine health, quiet) counts as a cache break here.
  if (prep.tools) attachMemoryTools("anthropic", body);
  const ms = Date.now() - t0;
  // hash what the provider would actually receive, per message, plus the system prompt and the tools section
  const wire = body.messages.map((m) => ({ role: m.role, hash: sha(JSON.stringify(m.content)) }));
  const sys = sha(String(body.system));
  const tools = sha(JSON.stringify(body.tools || []));
  // ---- the cache property: everything already sent must come back byte-identical ----
  for (let j = 0; j < prevWire.length; j++) {
    if (!wire[j] || wire[j].hash !== prevWire[j].hash || wire[j].role !== prevWire[j].role) {
      breaks++;
      if (!firstBreak) firstBreak = { atRequest: turns, msgIndex: j, prev: prevWire[j], now: wire[j] || null };
      if (!QUIET) console.log(`  ✗ CACHE BREAK at request ${turns}, message index ${j} (role ${prevWire[j].role}): provider-visible bytes changed`);
    }
  }
  if (prevSys && sys !== prevSys) { breaks++; if (!QUIET) console.log(`  ✗ CACHE BREAK at request ${turns}: the system prompt changed`); }
  if (prevTools && tools !== prevTools) { breaks++; if (!QUIET) console.log(`  ✗ CACHE BREAK at request ${turns}: the tools section changed`); }
  prevTools = tools;
  offNext = false;
  blocksOnWire += body.messages.filter((m) => m.role === "user" && JSON.stringify(m.content).includes("<filament-memory")).length;
  timings.push({ turn: turns, msgs: body.messages.length, mb: JSON.stringify(body).length / 1048576, ms });
  prevWire = wire; prevSys = sys;
  return { prep, ms };
}

console.log(`cache-stress: ${TURNS} turns, ${MSG_KB} KB user messages, tool leg every ${TOOL_EVERY}${DUP_PROBE ? ", duplicate probe on" : ""}${MODEL_SWITCH_AT >= 0 ? `, model switch at turn ${MODEL_SWITCH_AT}` : ""}${MUTE_AT >= 0 ? `, mute at turn ${MUTE_AT}` : ""}${OFF_AT >= 0 ? `, memory-off request at turn ${OFF_AT}` : ""}${DEFER_PROBE ? ", deferred-results probe on" : ""}, fake engine, temp folder ${dir}`);

// --- optional duplicate-content probe: an early message that gets NO block, whose exact text returns later
//     once a matching memory exists ---
if (DUP_PROBE) {
  history.push({ role: "user", content: `the orphan protocol handshake sequence alpha-beta-gamma-delta-epsilon needs review` });
  await sendAndCheck();
  history.push({ role: "assistant", content: "noted, no context found" });
  await svc.store.remember({ content: "orphan protocol handshake sequence alpha-beta-gamma-delta-epsilon requires the beta guard", source: "fact", importance: 0.95 });
}

let lastMs = 0;
for (let i = 0; i < TURNS; i++) {
  if (i === MODEL_SWITCH_AT) { modelName = "glm-worker-9"; if (!QUIET) console.log(`  — model switch at turn ${i}: claude-x -> ${modelName} (chain must not care)`); }
  if (i === MUTE_AT) { const c = svc.archive.recentChains({ limit: 1 })[0]; svc.archive.setMeta?.(c.id, { ...(c.meta || {}), muted: true }); if (!QUIET) console.log(`  — chain muted at turn ${i} (@mem off); history must stay byte-identical, tools must stay`); }
  if (i === OFF_AT) { offNext = true; if (!QUIET) console.log(`  — x-filament-memory: off on the next request (quiet mode)`); }
  turns++;
  history.push({ role: "user", content: userText(i) + (MSG_KB > 1 ? filler(MSG_KB - 1, i) : "") });
  const r = await sendAndCheck();
  lastMs = r.ms;
  history.push({ role: "assistant", content: `ok ${i}` });
  if (i > 0 && i % TOOL_EVERY === 0) { // a tool leg: assistant tool_use + user tool_result, same newest user text hash logic as real clients
    turns++; legs++;
    if (DEFER_PROBE) { const c = svc.archive.recentChains({ limit: 1 })[0]; svc.brain.setDeferred(c.id, `deferred memory tool results for leg ${i}: the model mixed memory tools with client tools`); }
    const before = history.length;
    history.splice(before - 1, 0, { role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "Read", input: { file: `src/mod${i}.js` } }] });
    history.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "file contents" }] });
    await sendAndCheck();
    history.splice(before - 1, 0); // keep the client copy clean of the injected pair for the next turn's resend
    history.push({ role: "assistant", content: "done reading" });
  }
  if (DUP_PROBE && i === Math.floor(TURNS / 2)) { // the duplicate returns: same text as the orphan, now a memory matches it
    turns++;
    history.push({ role: "user", content: `the orphan protocol handshake sequence alpha-beta-gamma-delta-epsilon needs review` });
    await sendAndCheck();
    history.push({ role: "assistant", content: "reviewed with the beta guard" });
  }
  if (!QUIET && i % 50 === 49) console.log(`  turn ${i + 1}/${TURNS}: ${history.length} messages, ${timings.at(-1).mb.toFixed(1)} MB context, prepare ${timings.at(-1).ms} ms`);
}

// The chain's block map at the end: uncapped, straight from the blocks table.
const chains = svc.archive.recentChains({ limit: 1 });
const mapSize = chains[0] ? Object.keys(svc.archive.blocksFor(chains[0].id)).length : 0;

const depth = timings.at(-1);
const halfIdx = Math.floor(timings.length / 2);
const failed = breaks !== 0;
console.log(`\nverdict: ${!failed ? "PASS — provider-visible prefix stayed byte-identical for every resend" : `FAIL — ${breaks} divergence(s), first at request ${firstBreak?.atRequest}, message index ${firstBreak?.msgIndex}`}`);
console.log(`scale: ${turns} requests (${legs} tool legs), final context ${depth.msgs} messages / ${depth.mb.toFixed(1)} MB (~${Math.round((depth.mb * 1048576) / 4)} tokens est.), ${blocksOnWire} user messages carried memory blocks on the wire`);
console.log(`block map at the end: ${mapSize} entries stored on the chain${mapSize === 60 ? " (hit the 60-entry cap — older blocks were evicted)" : ""}`);
console.log(`prepare cost: ${timings[halfIdx].msgs} msgs → ${timings[halfIdx].ms} ms · ${depth.msgs} msgs → ${lastMs} ms · worst ${Math.max(...timings.map((t) => t.ms))} ms`);
console.log(`temp folder ${dir}`);
await svc.store?.stop?.(); svc.stop();
for (let i = 0; i < 10; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
process.exit(failed ? 1 : 0);
