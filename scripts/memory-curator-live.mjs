#!/usr/bin/env node
// The curator's live check (HarnessV3-Memory M4-8): seeds two synthetic projects whose right answers are known —
// paraphrases and near misses, values to key and notes that hold none, files that changed under claims that still hold
// and under claims that no longer do — runs one curator pass on each with a real model through a running Filament, and
// scores every judgement. The store is a throwaway folder, removed after; the calls go to Filament's front door as a
// client with the first inbound key of its config (as `Filament doctor` does), and `x-filament-memory: off`, so memory
// captures none of them. The suite stays on scripted models (M4-D7).
//
//   node scripts/memory-curator-live.mjs [--port 20300] [--model zai/glm-5.3] [--data-dir <filament data dir>] [--out <file.json>]
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { MemoryBrain } from "../src/services/memory/brain.js";
import { MemoryCurator, KEY_PROMPT, MERGE_PROMPT, VERIFY_PROMPT, DOSSIER_PROMPT } from "../src/services/memory/curator.js";
import { normalizeConfig, appDataDir } from "../src/services/config/store.js";
import { memoryCallCap } from "../src/services/memory/index.js";
import { loadKey, openConfig } from "../src/services/config/secrets.js";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true] : []))
    .filter((x) => x.length),
);
const port = Number(args.port) || 20300;
const model = String(args.model || "zai/glm-5.3");
// The installed app's folder, the one on 20300, from a checkout too.
const dataDir = args["data-dir"] || appDataDir();
// Read only: `loadConfig` would mint or seal a key and save the file, and this script never writes Filament's config.
// The file holds what differs from the defaults (AH-C3); normalizing fills the rest, as a start does.
const config = normalizeConfig(openConfig(JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")), loadKey(dataDir, { create: false })).config);
const key = config.server?.inboundKeys?.[0] || "";
if (!key) {
  console.error(`no inbound key in ${join(dataDir, "config.json")}: Filament answers no model call without one`);
  process.exit(2);
}

// ---- what is known to be right ----
/** Two wordings of one thing: the curator should make each pair one claim. */
const SAME = [
  ["fact", "the bundle is built with esbuild from src/main.ts", "esbuild builds the bundle, starting at src/main.ts"],
  ["fact", "integration tests need a running postgres instance", "the integration tests need postgres to be running"],
  ["convention", "commit messages start with the package name", "every commit message starts with the name of the package"],
  ["fact", "the cli reads its settings from config.toml in the home folder", "config.toml in the home folder holds the cli's settings"],
];
/** Near misses: most words shared, one thing different. Each pair must stay two claims. */
const APART = [
  ["convention", "run the unit tests before every commit", "run the unit tests before every release"],
  ["fact", "the api retries failed requests three times", "the api retries failed requests three times, except POST requests"],
  ["fact", "logs go to var/log in production", "logs go to var/log in development"],
  ["decision", "deploys need two approvals", "deploys need two approvals from the platform team"],
  ["fact", "the frontend is built with vite", "the docs site is built with vite"],
];
/** Values to key, with the value the claim's words give; and notes that state no one value. */
const KEYS = [
  ["fact", "the api listens on port 3000", "3000"],
  ["convention", "we use pnpm as the package manager", "pnpm"],
  ["fact", "the deploy region is eu-west-2", "eu-west-2"],
  ["fact", "the staging database is called orchid", "orchid"],
  ["convention", "write a failing test before fixing a bug", null],
  ["fact", "the CI build is slow because the docker cache starts cold", null],
];
/** Files that change under their claims: the claim, the file before and after, and whether it still holds. */
const FILES = [
  ["src/server.js", "src/server.js starts the http listener on port 3000", "const app = makeApp();\nexport function listen() {\n  return app.listen(3000);\n}\n", "// the http entry point\nconst app = makeApp({ logger: true });\nexport function listen() {\n  return app.listen(3000);\n}\n", true],
  ["src/config.js", "src/config.js reads config.yaml at startup", "import { readYaml } from './yaml.js';\nexport function loadConfig() {\n  return readYaml('config.yaml');\n}\n", "import { readJson } from './json.js';\nexport function loadConfig() {\n  return readJson('config.json');\n}\n", false],
  ["src/queue.js", "src/queue.js retries a failed job five times", "const MAX_RETRIES = 5;\nexport function retry(job) {\n  for (let i = 0; i < MAX_RETRIES; i++) if (job.run()) return true;\n  return false;\n}\n", "const MAX_RETRIES = 3;\nexport function retry(job) {\n  for (let i = 0; i < MAX_RETRIES; i++) if (job.run()) return true;\n  return false;\n}\n", false],
  ["src/auth.js", "src/auth.js hashes passwords with bcrypt", "import bcrypt from 'bcrypt';\nexport const hash = (pw) => bcrypt.hash(pw, 12);\n", "import bcrypt from 'bcrypt';\nexport const hash = (pw) => bcrypt.hash(pw, 12);\nexport const verify = (pw, h) => bcrypt.compare(pw, h);\n", true],
];

// ---- the model, through Filament's front door ----
/** @type {{ step: string, ms: number, in: number, out: number, maxTokens?: number, stop?: string, blocks?: string, text?: string, error?: string }[]} */
const calls = [];
const STEP = new Map([[KEY_PROMPT, "key"], [MERGE_PROMPT, "merge"], [VERIFY_PROMPT, "verify"], [DOSSIER_PROMPT, "dossier"]]);
/** @param {{ system: string, user: string, maxTokens?: number }} a */
async function callModel({ system, user, maxTokens = 800 }) {
  const t0 = Date.now();
  const step = STEP.get(system) || "other";
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": key, "x-filament-memory": "off", "user-agent": "memory-curator-live/1" },
      // The cap memory's own calls ask for (M4-D22): the answer's room plus a reasoning model's.
      body: JSON.stringify({ model, max_tokens: memoryCallCap(config, model, maxTokens), system, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(180_000),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    const text = (j.content || []).filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("");
    calls.push({ step, ms: Date.now() - t0, in: j.usage?.input_tokens || 0, out: j.usage?.output_tokens || 0, maxTokens, stop: j.stop_reason, blocks: (j.content || []).map((/** @type {any} */ b) => b.type).join("+"), text: text.slice(0, 4000) });
    return { text, usage: { input: j.usage?.input_tokens || 0, output: j.usage?.output_tokens || 0 } };
  } catch (/** @type {any} */ e) {
    calls.push({ step, ms: Date.now() - t0, in: 0, out: 0, error: String(e.message || e) });
    throw e;
  }
}

// ---- the store ----
const dir = mkdtempSync(join(tmpdir(), "filament-curator-live-"));
const archive = new Archive({ file: join(dir, "archive.db") });
const brain = new MemoryBrain({ archive });
const curator = new MemoryCurator({ archive, brain, callModel, model: () => model, getConfig: () => ({ curator: { maxCalls: 30, dailyCalls: 200 } }) });
let chain = 0;
/** A learned claim, as the learner files it, in its own session. @param {string} projectId @param {string} kind @param {string} text */
const learn = async (projectId, kind, text) => {
  const r = await brain.fileLearned({ projectId, chainId: `live-${++chain}`, kind, text, importance: 0.7 });
  return /** @type {number} */ (r.id);
};

const out = { model, at: new Date().toISOString(), merge: /** @type {any} */ ({}), key: /** @type {any} */ ({}), verify: /** @type {any} */ ({}), dossier: /** @type {any} */ ({}), passes: /** @type {any[]} */ ([]), calls };
try {
  // Project one: merges and keys.
  const alpha = archive.ensureProject(join(dir, "alpha")).id;
  mkdirSync(join(dir, "alpha"));
  const pairs = [];
  for (const [kind, a, b] of SAME) pairs.push({ same: true, a: await learn(alpha, kind, a), b: await learn(alpha, kind, b), text: a });
  for (const [kind, a, b] of APART) pairs.push({ same: false, a: await learn(alpha, kind, a), b: await learn(alpha, kind, b), text: a });
  const keyed = [];
  for (const [kind, text, value] of KEYS) keyed.push({ id: await learn(alpha, kind, text), text, want: value });
  const p1 = await curator.run(alpha, { reason: "live" });
  out.passes.push(p1);
  const status = (/** @type {number} */ id) => archive.items.get(id);
  const merged = (/** @type {any} */ p) => {
    const a = status(p.a);
    const b = status(p.b);
    return (a.status === "superseded" && a.superseded_by === p.b) || (b.status === "superseded" && b.superseded_by === p.a);
  };
  const madeOne = pairs.filter(merged);
  const retiredApart = pairs.filter((p) => !p.same && [status(p.a), status(p.b)].some((it) => it.status === "superseded" || it.status === "dismissed"));
  out.merge = {
    paraphrases: SAME.length,
    merged: madeOne.filter((p) => p.same).length,
    nearMisses: APART.length,
    nearMissesMerged: madeOne.filter((p) => !p.same).map((p) => p.text),
    nearMissesRetired: retiredApart.map((p) => ({ text: p.text, a: status(p.a).invalid_reason, b: status(p.b).invalid_reason })),
    precision: madeOne.length ? madeOne.filter((p) => p.same).length / madeOne.length : null,
    recall: madeOne.filter((p) => p.same).length / SAME.length,
    missed: pairs.filter((p) => p.same && !merged(p)).map((p) => p.text),
  };
  out.key = {
    rows: keyed.map((k) => {
      const it = status(k.id);
      return { text: k.text, want: k.want, slot: it.slot, value: it.slot_value, right: k.want == null ? !it.slot : it.slot_value === k.want };
    }),
    invented: archive.db
      .prepare("SELECT COUNT(*) AS n FROM item_events WHERE by = 'curator' AND action = 'unkeyed' AND reason LIKE '%is not in its words'")
      .get().n,
    otherKeyed: archive.items.standing(alpha).filter((/** @type {any} */ it) => it.slot && !keyed.some((k) => k.id === it.id)).map((/** @type {any} */ it) => `${it.slot} = ${it.slot_value} ← ${it.text}`),
  };
  out.key.right = out.key.rows.filter((/** @type {any} */ r) => r.right).length;
  const d = archive.dossiers.latest(alpha);
  out.dossier = {
    version: d?.version ?? null,
    lines: d ? d.sections.reduce((n, s) => n + s.lines.length, 0) : 0,
    dropped: p1.dossierDropped ?? null,
    sections: d?.sections.map((s) => s.title) || [],
    citesStanding: d ? d.cites.every((id) => !["superseded", "dismissed"].includes(status(id)?.status)) : null,
    rendered: brain.dossierOf(alpha)?.text || "",
  };

  // Project two: files that changed under their claims.
  const betaDir = join(dir, "beta");
  mkdirSync(join(betaDir, "src"), { recursive: true });
  for (const [file, , before] of FILES) writeFileSync(join(betaDir, file), String(before));
  const beta = archive.ensureProject(betaDir).id;
  const checks = [];
  for (const [file, text, , , holds] of FILES) checks.push({ file, id: await learn(beta, "fact", String(text)), holds });
  // A file written in the same millisecond as its anchor would read as unchanged by size and time alone.
  await new Promise((r) => setTimeout(r, 30));
  for (const [file, , , after] of FILES) writeFileSync(join(betaDir, file), String(after));
  const p2 = await curator.run(beta, { reason: "live" });
  out.passes.push(p2);
  out.verify = {
    rows: checks.map((c) => {
      const it = status(c.id);
      const ev = archive.items.events(c.id).filter((/** @type {any} */ e) => e.by === "curator").at(-1);
      const verdict = it.status === "dismissed" ? "wrong" : ev?.action === "verified" ? "holds" : ev?.action === "checked" ? "unsure" : "not checked";
      return { file: c.file, want: c.holds ? "holds" : "wrong", got: verdict, reason: it.invalid_reason || ev?.reason || null, right: verdict === (c.holds ? "holds" : "wrong") };
    }),
  };
  out.verify.right = out.verify.rows.filter((/** @type {any} */ r) => r.right).length;
} finally {
  brain.stop?.();
  archive.close();
  rmSync(dir, { recursive: true, force: true });
}

const sum = (/** @type {string} */ k) => calls.reduce((n, c) => n + /** @type {any} */ (c)[k], 0);
console.log(`\nCurator live check on ${model} (${calls.length} model calls, ${sum("in")} tokens in, ${sum("out")} out, ${Math.round(sum("ms") / 1000)} s)\n`);
console.log(`merge:   ${out.merge.merged}/${out.merge.paraphrases} paraphrases made one; ${out.merge.nearMissesMerged.length}/${out.merge.nearMisses} near misses merged; precision ${out.merge.precision ?? "-"}`);
for (const t of out.merge.missed) console.log(`         missed: ${t}`);
for (const t of out.merge.nearMissesMerged) console.log(`         WRONGLY MERGED: ${t}`);
for (const t of out.merge.nearMissesRetired) console.log(`         near miss retired: ${t.text} (${t.a || t.b})`);
console.log(`key:     ${out.key.right}/${out.key.rows.length} right; ${out.key.invented} value(s) the model named that the words do not hold (refused)`);
for (const r of out.key.rows) console.log(`         ${r.right ? "ok  " : "BAD "} ${r.text} → ${r.slot ? `${r.slot} = ${r.value}` : "no slot"}${r.want ? ` (want ${r.want})` : " (want none)"}`);
for (const t of out.key.otherKeyed) console.log(`         also keyed: ${t}`);
console.log(`verify:  ${out.verify.right}/${out.verify.rows.length} right`);
for (const r of out.verify.rows) console.log(`         ${r.right ? "ok  " : "BAD "} ${r.file}: want ${r.want}, got ${r.got}${r.reason ? ` — ${r.reason}` : ""}`);
console.log(`dossier: v${out.dossier.version ?? "-"}, ${out.dossier.lines} line(s) in ${out.dossier.sections.join(", ") || "no section"}; ${out.dossier.dropped ?? 0} dropped; every cite standing: ${out.dossier.citesStanding}`);
for (const c of calls.filter((c) => c.error)) console.log(`         call failed (${c.step}): ${c.error}`);
for (const p of out.passes) if (p.errors || p.stopped) console.log(`pass ${p.run}: ${JSON.stringify({ errors: p.errors, stopped: p.stopped })}`);
if (args.out) writeFileSync(String(args.out), JSON.stringify(out, null, 2));
