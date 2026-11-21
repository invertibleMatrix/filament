// A Node stand-in for sidecar/mnemosyne_sidecar.py: the same newline-JSON protocol over stdio with an in-memory
// store and keyword scoring, so the engine client, the brain and the API are tested without Python.
// Not a test file: `npm test` runs test/*.test.js only (a bare `node --test` would pick this up and wait on stdin).
// Knobs (environment): FAKE_SIDECAR_HELLO_DELAY_MS, FAKE_SIDECAR_HANG_ON=<op> (never answers that op, and answers
// everything else, pings too: an engine at work on a long call), FAKE_SIDECAR_FREEZE_ON=<op> (when that op arrives,
// answers nothing more, not even a ping, its process alive: an engine that stalled),
// FAKE_SIDECAR_CRASH_ON=<op> (exits 7 when that op arrives), FAKE_SIDECAR_FAIL_HELLO=1 (exit 3 before hello),
// FAKE_SIDECAR_THROW_ON=<op> (an error nobody catches when that op arrives: the fake's own fault, below),
// FAKE_SIDECAR_SLOW_MS (how long reindex, the long op tests hold in flight, takes), FAKE_SIDECAR_STATE=<file> (persist
// the store between runs; a seeded row may carry tier, source, superseded_by and valid_until like the real engine's),
// FAKE_SIDECAR_FAIL_FILE=<file> (while it exists, each op named on a line of it fails as the engine raising),
// FAKE_SIDECAR_NEAR_FILE=<file> (meaning, for `dense`: while it exists, a JSON list of { texts, sim }, each the texts
// that are that near one another; a row whose words are among a list's with the text asked is that near it).
// Like the real engine, remember dedupes on exact content whether or not that row is still valid; `valid: true` makes a
// row it lands on valid again (Filament's mirror of a live claim, HarnessV3-Memory M2-2).
import { readFileSync, writeFileSync, writeSync, appendFileSync, existsSync } from "node:fs";

const env = process.env;
// A fault of the fake's own says so on stderr and ends it with a code of its own, 9. Node would end it with 1, which
// is also what a process ended from outside shows on Windows: the suite's load flakes read "the fake memory engine
// exited 1" and could not tell the two apart (HarnessV4_Tasks C15). With this, an exit 1 is never the fake's doing.
const died = (/** @type {any} */ e) => {
  try { writeSync(2, `critical\tfake sidecar died: ${String(e?.stack || e).split("\n").slice(0, 4).map((l) => l.trim()).join(" | ")}\n`); } catch {}
  process.exit(9);
};
process.on("uncaughtException", died);
process.on("unhandledRejection", died);
// Additive test knob (W9 engine ops): emit extra stderr lines in the sidecar severity<TAB>message format, so the
// error/critical branch can be exercised. Off unless the variable is set, so no existing test is affected.
if (env.FAKE_SIDECAR_STDERR) { for (const l of String(env.FAKE_SIDECAR_STDERR).split(String.fromCharCode(124))) if (l.trim()) process.stderr.write(l + String.fromCharCode(10)); }
if (env.FAKE_SIDECAR_FAIL_HELLO === "1") { process.stdout.write(JSON.stringify({ id: null, ok: false, error: "engine failed to start: boom", kind: "internal" }) + "\n"); process.exit(3); }

const state = { memories: [], canonical: [], seq: 0 };
if (env.FAKE_SIDECAR_STATE) { try { Object.assign(state, JSON.parse(readFileSync(env.FAKE_SIDECAR_STATE, "utf8"))); } catch {} }
const persist = () => { if (env.FAKE_SIDECAR_STATE) writeFileSync(env.FAKE_SIDECAR_STATE, JSON.stringify(state)); };
// A lexical engine's words in any script, as Mnemosyne's search reads them: ASCII runs as they always were, each other
// word whole, and a run of a script written without spaces as its pairs of characters.
const UNSPACED = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}]/u;
const tokens = (s) => {
  const low = String(s || "").toLowerCase();
  const out = low.match(/[a-z0-9_./:-]{2,}/g) || [];
  for (const w of low.split(/[^\p{L}\p{M}\p{N}]+/u)) {
    if (!/[^\x00-\x7f]/.test(w)) continue;
    if (!UNSPACED.test(w)) { if (w.length >= 2) out.push(w); continue; }
    const c = [...w];
    for (let i = 0; i + 1 < c.length; i++) out.push(c[i] + c[i + 1]);
  }
  return out;
};
const score = (q, content) => { const qt = new Set(tokens(q)); const ct = new Set(tokens(content)); let hit = 0; for (const t of qt) if (ct.has(t)) hit++; return qt.size ? hit / qt.size : 0; };
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const logOp = (op, args) => { if (env.FAKE_SIDECAR_LOG) { try { appendFileSync(env.FAKE_SIDECAR_LOG, JSON.stringify({ op, args }) + "\n"); } catch {} } }; // what Filament asked, for tests
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ops = {
  hello: () => ({ protocol: 1, version: "fake-3.15.1", python: "3.12.0", sqlite: "3.49.1", embeddings: env.FAKE_SIDECAR_EMBEDDINGS !== "0", embeddingModel: env.MNEMOSYNE_EMBEDDING_MODEL || "BAAI/bge-small-en-v1.5", vec: true, dbPath: env.MNEMOSYNE_DATA_DIR ? env.MNEMOSYNE_DATA_DIR + "/mnemosyne.db" : ":memory:", bank: env.MNEMOSYNE_BANK || "default", sessionId: env.FILAMENT_MEMORY_SESSION || "filament", counts: { working: state.memories.length, episodic: 0, triples: 0, canonical: state.canonical.length } }),
  recall: (a) => {
    if (!a.query) throw Object.assign(new Error("query is required"), { kind: "args" });
    const scored = state.memories.filter((m) => !m.forgotten && !m.superseded_by && !m.valid_until).map((m) => ({ ...m, score: env.FAKE_SIDECAR_RECALL_ALL === "1" && typeof m.fixedScore === "number" ? m.fixedScore : Math.round(score(a.query, m.content) * (0.5 + 0.5 * (m.importance ?? 0.5)) * 1000) / 1000 })).filter((m) => m.score > 0);
    scored.sort((x, y) => y.score - x.score);
    return scored.slice(0, a.top_k || 8).map((m) => ({ id: m.id, content: m.content, score: m.score, importance: m.importance, source: m.source, scope: m.scope, veracity: m.veracity, timestamp: m.timestamp, tier: m.tier || "working", metadata: m.metadata || null, memory_type: m.memory_type || null }));
  },
  // Meaning as FAKE_SIDECAR_NEAR_FILE scripts it: nothing near anything without it.
  dense: (a) => {
    if (!a.text) throw Object.assign(new Error("text is required"), { kind: "args" });
    const near = env.FAKE_SIDECAR_NEAR_FILE && existsSync(env.FAKE_SIDECAR_NEAR_FILE) ? JSON.parse(readFileSync(env.FAKE_SIDECAR_NEAR_FILE, "utf8")) : [];
    const sim = (m) => Math.max(0, ...near.filter((g) => g.texts.includes(a.text) && g.texts.includes(m.content)).map((g) => g.sim));
    return state.memories.filter((m) => !m.forgotten && !m.superseded_by && !m.valid_until).map((m) => ({ ...m, score: sim(m), dense: true })).filter((m) => m.score >= (a.min_sim || 0) && m.score > 0).sort((x, y) => y.score - x.score).slice(0, a.top_k || 8);
  },
  remember: (a) => {
    if (!a.content) throw Object.assign(new Error("content is required"), { kind: "args" });
    if (a.dedupe !== false) {
      const dup = state.memories.find((m) => !m.forgotten && m.content === a.content);
      if (dup && a.valid && (dup.superseded_by || dup.valid_until)) { delete dup.superseded_by; delete dup.valid_until; persist(); return { id: dup.id, deduped: true, revived: true }; }
      if (dup) return { id: dup.id, deduped: true };
    }
    const id = `m${++state.seq}`;
    state.memories.push({ id, content: a.content, source: a.source || "filament", importance: a.importance ?? 0.6, scope: a.scope || "global", veracity: a.veracity || "stated", memory_type: a.memory_type || null, metadata: a.metadata || null, pinned: !!a.pin, timestamp: new Date().toISOString() });
    persist(); return { id };
  },
  get: (a) => state.memories.find((m) => m.id === a.id && !m.forgotten) || null,
  update: (a) => { const m = state.memories.find((x) => x.id === a.id); if (!m) return { ok: false }; if (a.content != null) m.content = a.content; if (a.importance != null) m.importance = a.importance; persist(); return { ok: true }; },
  forget: (a) => { const m = state.memories.find((x) => x.id === a.id); if (!m) return { ok: false }; m.forgotten = true; persist(); return { ok: true }; },
  // Mnemosyne's invalidate: superseded_by when a replacement is named, else valid_until now; recall skips both.
  invalidate: (a) => { const m = state.memories.find((x) => x.id === a.id && !x.forgotten); if (!m) return { ok: false }; if (a.replacement_id) m.superseded_by = a.replacement_id; m.valid_until = new Date().toISOString(); persist(); return { ok: true }; },
  restore: (a) => { const m = state.memories.find((x) => x.id === a.id && !x.forgotten); if (!m) return { ok: false }; delete m.superseded_by; delete m.valid_until; persist(); return { ok: true }; },
  fence: () => { const out = { working: [], episodic: [], canonical: [] }; for (const m of state.memories) if (!m.forgotten && !m.superseded_by && /^sleep_/.test(m.source || "")) { m.superseded_by = "filament:engine-written"; m.valid_until = new Date().toISOString(); out[m.tier === "episodic" ? "episodic" : "working"].push(m.id); } persist(); return out; },
  rows: (a) => { const tier = a.table === "episodic" ? "episodic" : "working"; const limit = Number(a.limit) || 500; const page = state.memories.map((m, i) => [i + 1, m]).filter(([n, m]) => n > (Number(a.after) || 0) && !m.forgotten && !m.superseded_by && !m.valid_until && (m.tier === "episodic" ? "episodic" : "working") === tier).slice(0, limit); return { rows: page.map(([, m]) => ({ id: m.id, content: m.content, source: m.source, importance: m.importance, memory_type: m.memory_type, veracity: m.veracity, timestamp: m.timestamp, metadata: m.metadata })), next: page.length === limit ? page.at(-1)[0] : null }; },
  pin: (a) => { const m = state.memories.find((x) => x.id === a.id); if (!m) throw new Error("no such memory"); m.pinned = a.on !== false; return { ok: true }; },
  canonical_list: (a) => state.canonical.filter((c) => ((a.owner || "user") === "*" || c.owner_id === (a.owner || "user")) && (!a.category || c.category === a.category)),
  canonical_set: (a) => { const cur = state.canonical.find((c) => c.owner_id === (a.owner || "user") && c.category === a.category && c.name === a.name); if (cur) { if (cur.body === a.body) return { ...cur, status: "unchanged" }; cur.body = a.body; cur.version += 1; persist(); return { ...cur, status: "updated" }; } const row = { owner_id: a.owner || "user", category: a.category, name: a.name, body: a.body, source: a.source || "filament", confidence: a.confidence ?? 1, version: 1 }; state.canonical.push(row); persist(); return { ...row, status: "created" }; },
  canonical_forget: (a) => { const i = state.canonical.findIndex((c) => c.owner_id === (a.owner || "user") && c.category === a.category && c.name === a.name); if (i < 0) return { ok: false }; state.canonical.splice(i, 1); persist(); return { ok: true }; },
  stats: () => ({ total_memories: state.memories.filter((m) => !m.forgotten).length, beam: { working_memory: { total: state.memories.filter((m) => !m.forgotten).length }, episodic_memory: { total: 0 }, triples: { total: 0 } } }),
  hygiene_audit: () => ({ candidates: [], scanned: state.memories.length }),
  tool: (a) => ({ tool: a.name, arguments: a.arguments || {}, ok: true }),
  // long ops
  export: async (a) => { writeFileSync(a.path, JSON.stringify({ mnemosyne_export: { version: "1.3" }, working_memory: state.memories })); return { working_memory_count: state.memories.length }; },
  import: async (a) => { const j = JSON.parse(readFileSync(a.path, "utf8")); let n = 0; for (const m of j.working_memory || []) if (!state.memories.find((x) => x.id === m.id)) { state.memories.push(m); n++; } persist(); return { imported: n }; },
  backup: async (a) => ({ backup_path: a.dir + "/mnemosyne_backup_fake.db.gz", size_bytes: 1234, checksum: "deadbeef" }),
  reindex: async () => { await sleep(Number(env.FAKE_SIDECAR_SLOW_MS || 20)); return { reindexed: state.memories.length }; },
  diagnose: async () => ({ checks_total: 1, checks_passed: 1, checks_failed: 0, key_findings: [] }),
  hygiene_clean: async () => ({ processed: 0 }),
};
const LONG = new Set(["export", "import", "backup", "reindex", "diagnose", "hygiene_clean"]);

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
    let req; try { req = JSON.parse(line); } catch { emit({ id: null, ok: false, error: "not JSON", kind: "args" }); continue; }
    // A ping is answered at once and never reaches the ops, as the real sidecar's stdin thread answers it.
    if (req?.op === "ping") { emit({ id: req.id, ok: true, result: {} }); continue; }
    const { id, op, args = {} } = req; logOp(op, args);
    // Frozen for good, without a cycle spent: nothing more is read or answered until the process is killed.
    if (env.FAKE_SIDECAR_FREEZE_ON === op) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    if (env.FAKE_SIDECAR_CRASH_ON === op) process.exit(7);
    if (env.FAKE_SIDECAR_THROW_ON === op) throw new Error(`thrown on ${op}`);
    if (env.FAKE_SIDECAR_HANG_ON === op) continue;
    if (env.FAKE_SIDECAR_FAIL_FILE && existsSync(env.FAKE_SIDECAR_FAIL_FILE) && readFileSync(env.FAKE_SIDECAR_FAIL_FILE, "utf8").split(/\r?\n/).includes(op)) { emit({ id, ok: false, error: `${op} failed (FAKE_SIDECAR_FAIL_FILE)`, kind: "mnemosyne" }); continue; }
    if (op === "shutdown") { emit({ id, ok: true, result: { bye: true } }); process.exit(0); }
    if (op === "hello" && env.FAKE_SIDECAR_HELLO_DELAY_MS) await sleep(Number(env.FAKE_SIDECAR_HELLO_DELAY_MS));
    const fn = ops[op];
    if (!fn) { emit({ id, ok: false, error: `unknown op '${op}'`, kind: "args" }); continue; }
    const t0 = Date.now();
    const run = async () => { try { const result = await fn(args); emit({ id, ok: true, result, ms: Date.now() - t0 }); } catch (e) { emit({ id, ok: false, error: e.message, kind: e.kind || "mnemosyne" }); } };
    if (LONG.has(op)) run(); else await run();
  }
});
process.stdin.on("end", () => process.exit(0));
process.stderr.write("info\tfake sidecar ready\n");
