#!/usr/bin/env node
// Replay bench for the memory autopilot: replays the archived sessions of a memory folder through the brain, turn by
// turn, without writing anything, and reports how often what it would have injected was actually used by the reply
// that followed, how many tokens it would have spent, and how long it took.
//
//   node scripts/memory-bench.mjs [--folder <memory folder>] [--data-dir <filament data dir>] [--limit 50] [--engine]
//
// Uses the archive alone by default (fast, deterministic); with the managed engine installed and --engine, recall
// goes through Mnemosyne too. Each session replays under a key of its own, as a new session would: what the live run
// stored on it (its briefing, its blocks) is not placed again, so every turn counts what today's brain looks up.
// Content never prints: only counts, ids and timings.
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Archive } from "../src/archive.js";
import { MemoryBrain, usedInReply } from "../src/memory-brain.js";
import { MemoryEngine, sidecarEnv } from "../src/memory-engine.js";
import { engineState } from "../src/memory-install.js";
import { loadKey } from "../src/services/config/secrets.js";
import { appDataDir } from "../src/services/config/store.js";

/**
 * The brain a dry run replays through. Each replayed session runs under a key no chain has (`replaying`), so the dry
 * run finds no session there and keeps none: what a live session is to its briefing and its lookups is kept here, by
 * that key — the session replayed, whose own turns are no past session's to recall and whose lineage is its own; that
 * its briefing was placed or tried on three turns (no later turn builds one); and the ids the briefing showed, which no
 * turn's lookup serves again (the chain's `briefingIds`).
 */
class BenchBrain extends MemoryBrain {
  /** @type {Map<string, { chain: any, tries: number, ids: Set<any> | null }>} */
  sessions = new Map();
  /** A key for `chain`'s replay. @param {any} chain */
  replaying(chain) {
    const key = `n:bench-${randomBytes(6).toString("hex")}`;
    this.sessions.set(key, { chain, tries: 0, ids: null });
    return key;
  }
  /** @param {any} o */
  async buildBriefing(o) {
    const s = this.sessions.get(o.sit.key);
    if (!s) return super.buildBriefing(o);
    if (s.ids || s.tries >= 3) return { text: "", ids: [], listed: [], count: 0, tokens: 0, sources: "" };
    s.tries++;
    const b = await super.buildBriefing({ ...o, chain: s.chain });
    if (b.text) s.ids = new Set(b.ids.filter((id) => !b.listed.includes(id)));
    return b;
  }
  /** @param {any} o */
  buildTurnBlock(o) {
    const s = this.sessions.get(o.sit?.key);
    if (!s) return super.buildTurnBlock(o);
    return super.buildTurnBlock({ ...o, chain: s.chain, excludeIds: new Set([...o.excludeIds, ...(s.ids || [])]) });
  }
}

/**
 * The bench's brain over an archive and the engine (or null): memory on, its autopilot as Memory settings start it.
 * @param {{ archive: any, store?: any }} o
 */
export function benchBrain({ archive, store = null }) {
  return new BenchBrain({ store, archive, getConfig: () => ({ enabled: true, autopilot: { enabled: true, mode: "conservative" } }), log: () => {} });
}

/**
 * Replays the newest `limit` sessions of `archive` through `brain`, dry: the totals, and a row per project.
 * @param {{ archive: any, brain: BenchBrain, limit?: number }} o
 */
export async function replay({ archive, brain, limit = 50 }) {
  const chains = archive.recentChains({ limit });
  const totals = { chains: 0, turns: 0, injected: 0, used: 0, tokens: 0, ms: 0, briefings: 0 };
  const byProject = new Map();
  for (const ch of chains) {
    const turns = archive.getTurns(ch.id); if (turns.length < 2) continue; totals.chains++;
    const proj = archive.getProject(ch.project_id) || { name: ch.project_id }; const row = byProject.get(proj.name) || { turns: 0, injected: 0, used: 0, tokens: 0 }; byProject.set(proj.name, row);
    // A key no chain has: nothing the live run stored on the session (its briefing, its blocks) is placed again.
    const key = brain.replaying(ch);
    const history = [];
    for (const t of turns) {
      const user = archive.getMessage(t.user_hash)?.message; const final = t.final_hash ? archive.getMessage(t.final_hash)?.message : null;
      if (!user) continue;
      const body = { model: ch.model || "bench", system: `Working directory: ${proj.cwd || ""}`, messages: [...history, user] };
      const sit = brain.situate({ format: "anthropic", body, headers: { "user-agent": `${ch.client || "bench"}/0`, "x-session-id": `bench-${ch.id}` }, model: body.model });
      if (!sit) continue; sit.key = key;
      const requestId = `bench-${ch.id}-${t.n}`;
      const t0 = Date.now();
      const prep = await brain.prepare(sit, { requestId, dryRun: true });
      const ms = Date.now() - t0; totals.ms += ms; totals.turns++; row.turns++;
      const injected = (prep.injected || 0) + (prep.briefing || 0); totals.injected += injected; row.injected += injected; totals.tokens += prep.tokens || 0; row.tokens += prep.tokens || 0; if (prep.briefing) totals.briefings++;
      const pairs = brain.lastTexts.get(requestId) || []; brain.lastTexts.delete(requestId);
      const replyText = final ? (typeof final.content === "string" ? final.content : (final.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ")) : "";
      const used = replyText ? pairs.filter(([, text]) => usedInReply(text, replyText)).length : 0; totals.used += used; row.used += used;
      history.push(user); if (final) history.push(final);
    }
  }
  return { totals, byProject };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true] : [])).filter((x) => x.length));
  // The sessions it replays are the installed app's, from a checkout too.
  const dataDir = args["data-dir"] || appDataDir();
  const folder = args.folder || join(dataDir, "memory");
  const limit = Number(args.limit) || 50;
  if (!existsSync(join(folder, "archive.db"))) { console.error(`no archive at ${folder}`); process.exit(2); }
  const archive = new Archive({ file: join(folder, "archive.db"), key: loadKey(dataDir, { create: false }) });
  let store = null;
  // Only an engine whose install finished, as the memory service starts it.
  const es = args.engine ? engineState(dataDir) : null;
  if (es?.installed) store = new MemoryEngine({ command: es.venvPython, args: [fileURLToPath(new URL("../sidecar/mnemosyne_sidecar.py", import.meta.url))], env: sidecarEnv({ memoryFolder: folder, engineDir: es.dir }), memoryFolder: folder, writeConfig: false });
  const brain = benchBrain({ archive, store });
  const { totals, byProject } = await replay({ archive, brain, limit });
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-");
  console.log(`\nMemory replay bench: ${totals.chains} sessions, ${totals.turns} turns, engine ${store ? "on" : "off"}\n`);
  console.log("project".padEnd(28), "turns".padStart(6), "injected".padStart(9), "used".padStart(6), "hit rate".padStart(9), "tokens".padStart(8));
  for (const [name, r] of [...byProject.entries()].sort((a, b) => b[1].turns - a[1].turns)) console.log(String(name).slice(0, 28).padEnd(28), String(r.turns).padStart(6), String(r.injected).padStart(9), String(r.used).padStart(6), pct(r.used, r.injected).padStart(9), String(r.tokens).padStart(8));
  console.log("\ntotal".padEnd(28), String(totals.turns).padStart(6), String(totals.injected).padStart(9), String(totals.used).padStart(6), pct(totals.used, totals.injected).padStart(9), String(totals.tokens).padStart(8));
  console.log(`briefings: ${totals.briefings} · average prepare time: ${totals.turns ? Math.round(totals.ms / totals.turns) : 0} ms · tokens per turn: ${totals.turns ? Math.round(totals.tokens / totals.turns) : 0}`);
  brain.stop(); await store?.stop?.(); archive.close();
}
