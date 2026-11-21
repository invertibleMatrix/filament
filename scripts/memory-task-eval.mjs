#!/usr/bin/env node
// The task eval (memory plan b3): does memory make the agent better at the work itself? A fixture repository's tasks
// run in order, each in a fresh chat of a Filament started from this checkout on a throwaway data folder — once per
// model and per arm: memory on, memory off, and memory off with a notes file the agent keeps itself (AGENTS.md, which
// every session reads). After each turn the task's checks run on the folder; what fails is corrected as the person
// would, in the task's own words, up to --corrections times. Each task is scored on success, first-try success,
// corrections, rounds (the agent's model calls) and tokens (the agent's and memory's own); each arm on its mean score
// and its normalized gain over memory off. docs/memory-evals.md says what it measures and how to read it.
//
//   node scripts/memory-task-eval.mjs [--models zai/glm-5.3,grok-4.6] [--learner zai/glm-5.3-flash] [--arms on,off,notes]
//     [--fixture evals/memory/ledger] [--tasks t1,t2] [--corrections 2] [--label baseline] [--out <folder>]
//     [--data-dir <Filament's data folder>] [--turn-minutes 20] [--keep]
//
// The providers are read from the data folder's config (the installed app's by default), read only: the routes that
// answer the models and the learner, and their upstreams, go into each throwaway Filament and nothing else does. Memory
// on runs the engine the app installed, on a memory folder of the cell's own. The report goes to evals/memory/results.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApp } from "../src/server.js";
import { defaultConfig, normalizeConfig, appDataDir } from "../src/services/config/store.js";
import { loadKey, openConfig, sealConfig } from "../src/services/config/secrets.js";
import { findUpstream, routeMatches } from "../src/core/routing.js";
import { engineState, EMBEDDING_MODEL } from "../src/adapters/sidecar/install.js";
import { AGENT_ENV_SCRUB } from "../src/adapters/agents/agent-process.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_FIXTURE = join(ROOT, "evals", "memory", "ledger");
export const RESULTS = join(ROOT, "evals", "memory", "results");
export const DEFAULT_MODELS = ["zai/glm-5.3", "grok-4.6"];
export const DEFAULT_LEARNER = "zai/glm-5.3-flash";

/** The arms: what the agent carries from one session to the next. */
export const ARMS = Object.freeze(["on", "off", "notes"]);
/** The notes arm's file: an instruction file every session in the folder reads (session-settings `instructions.files`). */
export const NOTES_FILE = "AGENTS.md";
export const NOTES_TEXT = `# Notes

This file is read at the start of every session in this folder: it is your memory between sessions. When you learn something about this project, or about how the person wants the work done, that a later session would need — a convention, a correction they gave you, a fact, a procedure — add it here as a short line before you end your turn. Keep it short.
`;
/**
 * The tools a task's chat runs without: a question to the person (nobody answers one here: the person's only words are
 * the task and its corrections) and the ones that start other agents (each task is one agent's work, its tokens its own).
 */
export const TOOLS_OFF = Object.freeze({ ask: false, agent: false, team: false, flow: false });

// ---------------------------------------------------------------------------------------------------------------------
// A fixture: a starting repository and its tasks, in order.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {object} CheckContext  What a check reads the folder with, after a turn.
 * @property {string} repo  the folder
 * @property {Map<string, string>} before  each text file's contents as the task began, by its path (forward slashes)
 * @property {(path: string) => string | null} read  a file's text now; null where there is none
 * @property {(path: string) => string | null} sha  a file's sha256 now; null where there is none
 * @property {() => Map<string, string>} files  each text file's contents now, by its path
 * @property {(cmd: string, args: string[], o?: { timeoutMs?: number }) => { code: number | null, out: string }} run  a command in the folder
 * @property {(code: string) => { ok: boolean, out: string }} probe  ES module code run by node in the folder (`$repo` is its file URL); ok on exit 0
 */
/**
 * @typedef {object} Check
 * @property {string} id
 * @property {"task" | "pref"} kind  the task's own requirement, or a standing preference of the person's
 * @property {string} [pref]  the preference it checks (a pref check)
 * @property {(ctx: CheckContext) => true | string | Promise<true | string>} check  true, or what is wrong
 * @property {string} correction  what the person says when it fails
 */
/**
 * @typedef {object} Task
 * @property {string} id
 * @property {string} title
 * @property {string} prompt  the person's message that starts the task's chat
 * @property {string[]} [teaches]  the preferences this task's prompt states (the person says them, unasked)
 * @property {Check[]} checks
 */

/** A fixture folder: `repo/` and `tasks.mjs` (its `tasks`, in order). @param {string} dir */
export async function loadFixture(dir) {
  const at = resolve(dir);
  const repo = join(at, "repo");
  if (!existsSync(repo)) throw new Error(`${at} has no repo/ folder`);
  const mod = await import(pathToFileURL(join(at, "tasks.mjs")).href);
  /** @type {Task[]} */
  const tasks = mod.tasks;
  if (!Array.isArray(tasks) || !tasks.length) throw new Error(`${at}/tasks.mjs exports no tasks`);
  const ids = new Set();
  for (const t of tasks) {
    if (!t.id || ids.has(t.id)) throw new Error(`a task of ${at} has no id, or one another has: ${t.id}`);
    ids.add(t.id);
    for (const c of t.checks || []) if (!c.id || !["task", "pref"].includes(c.kind) || typeof c.check !== "function" || !c.correction) throw new Error(`task ${t.id}: check ${c.id} is not { id, kind, check, correction }`);
  }
  return { name: String(mod.name || at.split(/[\\/]/).pop()), dir: at, repo, tasks };
}

/**
 * Which preference checks of each task test what an earlier task taught: a preference is taught by the first task that
 * states it (`teaches`) or checks it (and corrects it where it fails); a later check of it is a recall.
 * @param {Task[]} tasks @returns {Map<string, Set<string>>} task id → the ids of its recall checks
 */
export function recallsOf(tasks) {
  const taught = new Set();
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  for (const t of tasks) {
    const mine = new Set();
    for (const c of t.checks) if (c.kind === "pref" && c.pref && taught.has(c.pref)) mine.add(c.id);
    out.set(t.id, mine);
    for (const p of t.teaches || []) taught.add(p);
    for (const c of t.checks) if (c.kind === "pref" && c.pref) taught.add(c.pref);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The folder: copied, made a repository, read by the checks.
// ---------------------------------------------------------------------------------------------------------------------

const SKIP = new Set([".git", "node_modules"]);
/** Every text file under `dir` by its path (forward slashes), .git and node_modules aside. @param {string} dir */
export function snapshot(dir) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const walk = (/** @type {string} */ at) => {
    for (const name of readdirSync(at)) {
      if (SKIP.has(name)) continue;
      const p = join(at, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.size <= 512 * 1024) out.set(relative(dir, p).split("\\").join("/"), readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return out;
}

/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => spawnSync("git", ["-c", "user.name=eval", "-c", "user.email=eval@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", windowsHide: true });

/** The fixture's repository in a folder of its own, committed, as a person's checkout would be. @param {string} from @param {string} to @param {string} arm */
export function prepareRepo(from, to, arm) {
  cpSync(from, to, { recursive: true });
  if (arm === "notes") writeFileSync(join(to, NOTES_FILE), NOTES_TEXT);
  // A folder that is no repository works too: git is how an agent sees what changed, not what the eval needs.
  if (git(to, "init", "-q").status === 0) {
    git(to, "add", "-A");
    git(to, "commit", "-qm", "the fixture as it starts");
  }
}

/** @param {string} repo @param {Map<string, string>} before @returns {CheckContext} */
export function checkContext(repo, before) {
  const at = (/** @type {string} */ p) => join(repo, ...String(p).split("/"));
  const read = (/** @type {string} */ p) => {
    try {
      return readFileSync(at(p), "utf8");
    } catch {
      return null;
    }
  };
  // A test runner's own variable taken out: a `node --test` that inherits it reports to that runner instead of running.
  const { NODE_TEST_CONTEXT: _runner, ...env } = process.env;
  const run = (/** @type {string} */ cmd, /** @type {string[]} */ args, { timeoutMs = 120_000 } = {}) => {
    const r = spawnSync(cmd, args, { cwd: repo, encoding: "utf8", timeout: timeoutMs, windowsHide: true, env: { ...env, NODE_OPTIONS: "" } });
    return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}${r.error ? String(r.error.message) : ""}` };
  };
  return {
    repo,
    before,
    read,
    sha: (p) => {
      const t = read(p);
      return t == null ? null : createHash("sha256").update(t).digest("hex");
    },
    files: () => snapshot(repo),
    run,
    probe: (code) => {
      const r = run(process.execPath, ["--input-type=module", "-e", code.split("$repo").join(pathToFileURL(repo).href)], { timeoutMs: 30_000 });
      return { ok: r.code === 0, out: r.out.trim().slice(0, 2000) };
    },
  };
}

/** Each check's verdict on the folder now. @param {Task} task @param {CheckContext} ctx */
export async function judge(task, ctx) {
  const out = [];
  for (const c of task.checks) {
    let v;
    try {
      v = await c.check(ctx);
    } catch (e) {
      v = `the check threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    out.push({ id: c.id, kind: c.kind, ...(c.pref ? { pref: c.pref } : {}), ok: v === true, ...(v === true ? {} : { why: String(v).slice(0, 600) }) });
  }
  return out;
}

/** What the person says when checks fail: each failed check's correction, in the task's order. @param {Task} task @param {{ id: string, ok: boolean }[]} verdicts */
export function correctionFor(task, verdicts) {
  const failed = new Set(verdicts.filter((v) => !v.ok).map((v) => v.id));
  const said = task.checks.filter((c) => failed.has(c.id)).map((c) => c.correction);
  return said.length === 1 ? said[0] : said.map((s) => `- ${s}`).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// A throwaway Filament, from this checkout.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A Filament on a data folder of its own, listening on a port of its own: the providers given, its agent loop free to
 * work in `roots` without asking, memory on (`memory`) or off. The engine is the stand-in `engine` names
 * ({ command, args, env }, as FILAMENT_MEMORY_SIDECAR holds one), set while it runs.
 * @param {{ dataDir: string, upstreams: any[], routes: any[], roots: string[], memory?: { learner: string, engine?: any } | null, environment?: ((root: string) => Promise<any>) | null, configure?: (cfg: any) => void }} o
 */
export async function bootFilament({ dataDir, upstreams, routes, roots, memory = null, environment = null, configure = () => {} }) {
  mkdirSync(dataDir, { recursive: true });
  const key = `sk-eval-${createHash("sha256").update(`${dataDir}${Date.now()}${Math.random()}`).digest("hex").slice(0, 24)}`;
  const cfg = defaultConfig();
  cfg.server.port = 0;
  cfg.server.inboundKeys = [key];
  cfg.server.logLevel = "warn";
  cfg.observability.logFile = "";
  cfg.observability.ops = { ...cfg.observability.ops, logFile: "" };
  // Every record of the cell stays in the ring the session pages count from.
  cfg.observability.keepLastRequests = 5000;
  cfg.upstreams = structuredClone(upstreams);
  cfg.routes = structuredClone(routes);
  cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots, readerModel: "" };
  if (memory) {
    cfg.memory = {
      ...cfg.memory,
      enabled: true,
      folder: join(dataDir, "memory"),
      engine: { ...cfg.memory.engine, autoInstall: false },
      models: { ...cfg.memory.models, summarizer: memory.learner, curator: "" },
      privacy: { ...cfg.memory.privacy, encryptArchive: false },
    };
  } else cfg.memory.enabled = false;
  configure(cfg);
  // Sealed with the folder's own key before it is written: a provider's key is never on disk in the clear.
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(sealConfig(normalizeConfig(cfg), /** @type {Buffer} */ (loadKey(dataDir)))));
  const hookBefore = process.env.FILAMENT_MEMORY_SIDECAR;
  if (memory?.engine) process.env.FILAMENT_MEMORY_SIDECAR = JSON.stringify(memory.engine);
  else delete process.env.FILAMENT_MEMORY_SIDECAR;
  const app = createApp(/** @type {any} */ ({ dataDir, overrides: { port: 0, signInOf: async () => ({ signedIn: null, identity: null }), ...(environment ? { environment } : {}) }, onShutdown: () => {} }));
  const { port } = await app.start();
  const url = `http://127.0.0.1:${port}`;
  const headers = { "content-type": "application/json", "x-api-key": key, authorization: `Bearer ${key}` };
  /**
   * One call of the Filament's API, answered whole. Through node:http, not fetch: fetch gives up on a response whose head
   * takes more than 5 minutes (undici's headersTimeout), and a turn answered whole sends its head when it ends — a long
   * turn read as "fetch failed" while it ran on, and the correction after it met a 409.
   * @param {string} method @param {string} path @param {any} [body] @param {{ timeoutMs?: number }} [o]
   */
  const api = (method, path, body, { timeoutMs = 120_000 } = {}) =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const req = httpRequest(url + path, { method, headers: { ...headers, ...(data ? { "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        res.on("end", () => {
          clearTimeout(timer);
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {}
          if ((res.statusCode || 0) >= 400) reject(new Error(`${method} ${path}: HTTP ${res.statusCode} ${text.slice(0, 400)}`));
          else resolve(json);
        });
      });
      const timer = setTimeout(() => req.destroy(new Error(`${method} ${path}: no answer in ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
      req.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      if (data) req.write(data);
      req.end();
    });
  return {
    url,
    dataDir,
    api,
    async stop() {
      try {
        await app.stop();
      } finally {
        if (hookBefore === undefined) delete process.env.FILAMENT_MEMORY_SIDECAR;
        else process.env.FILAMENT_MEMORY_SIDECAR = hookBefore;
      }
    },
  };
}

/** @typedef {Awaited<ReturnType<typeof bootFilament>>} Filament */

// ---------------------------------------------------------------------------------------------------------------------
// A cell: one model, one arm, every task in order.
// ---------------------------------------------------------------------------------------------------------------------

/** The tokens of a set of records, summed. @param {any[]} recs */
const tokensOf = (recs) => {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, costKnown: true };
  for (const r of recs) {
    t.input += r.tokens?.input || 0;
    t.output += r.tokens?.output || 0;
    t.cacheRead += r.tokens?.cacheRead || 0;
    t.cacheWrite += r.tokens?.cacheWrite || 0;
    if (typeof r.cost === "number") t.cost += r.cost;
    else t.costKnown = false;
  }
  t.cost = Math.round(t.cost * 1e4) / 1e4;
  return t;
};
/** All a cell's tokens count as one number: what was read (fresh, cached or written to the cache) and what was written. @param {{ input: number, output: number, cacheRead: number, cacheWrite: number }} t */
export const totalTokens = (t) => t.input + t.cacheRead + t.cacheWrite + t.output;

/** The text of a reply's blocks. @param {any} msg */
const replyText = (msg) => (Array.isArray(msg?.content) ? msg.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("") : "");

/**
 * One task in a fresh chat: its prompt, then the person's corrections while checks fail, up to `maxCorrections`
 * messages. The chat's records give its rounds and tokens.
 * @param {{ app: Filament, repo: string, model: string, task: Task, recalls: Set<string>, maxCorrections: number, turnMs: number, log: (s: string) => void }} o
 */
export async function runTask({ app, repo, model, task, recalls, maxCorrections, turnMs, log }) {
  const t0 = Date.now();
  const before = snapshot(repo);
  const ctx = checkContext(repo, before);
  const chat = await app.api("POST", "/api/sessions", { cwd: repo, model, preset: null, settings: { loop: { tools: { ...TOOLS_OFF } } } });
  const id = String(chat.id);
  /** @type {any[]} */
  const turns = [];
  let said = task.prompt;
  let corrections = 0;
  /** @type {any[]} */
  let first = [];
  /** @type {any[]} */
  let verdicts = [];
  for (;;) {
    const ts = Date.now();
    /** @type {string | null} */
    let error = null;
    let reply = "";
    try {
      const msg = await postTurn(app, id, said, turnMs);
      reply = replyText(msg);
      if (msg?.type === "error") error = String(msg.error?.message || "the turn failed");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      // A turn past its time runs on in the Filament: stop it, so the correction after it is not refused as a turn running.
      await app.api("POST", `/api/sessions/${encodeURIComponent(id)}/stop`, {}).catch(() => {});
    }
    verdicts = await judge(task, ctx);
    if (!turns.length) first = verdicts;
    const failed = verdicts.filter((v) => !v.ok);
    turns.push({ said, reply: reply.slice(-1500), ms: Date.now() - ts, ...(error ? { error } : {}), failed: failed.map((v) => v.id) });
    log(`    ${task.id} turn ${turns.length}: ${failed.length ? `failed ${failed.map((v) => v.id).join(", ")}` : "all checks pass"}${error ? ` (${error.slice(0, 120)})` : ""}`);
    if (!failed.length || turns.length > maxCorrections) break;
    said = correctionFor(task, verdicts);
    corrections += failed.length;
  }
  const recs = (await app.api("GET", `/api/sessions/${encodeURIComponent(id)}/requests?limit=500`)).requests || [];
  const ticks = recs.filter((/** @type {any} */ r) => r.source === "agent-tick");
  const success = verdicts.every((v) => v.ok);
  return {
    task: task.id,
    chat: id,
    projectId: chat.projectId || null,
    success,
    firstTry: first.every((v) => v.ok),
    corrections,
    followUps: turns.length - 1,
    score: taskScore(success, corrections),
    rounds: ticks.length,
    tokens: tokensOf(ticks),
    // Memory's own calls the chat made as it ran (recall, a rewrite): its learning after it is the cell's.
    memoryDuring: tokensOf(recs.filter((/** @type {any} */ r) => r.source === "memory")),
    prefs: first.filter((v) => v.kind === "pref").map((v) => ({ id: v.id, pref: v.pref, firstTry: v.ok, recall: recalls.has(v.id), ok: verdicts.find((x) => x.id === v.id)?.ok ?? false })),
    checks: verdicts,
    turns,
    ms: Date.now() - t0,
  };
}

/**
 * One turn of a chat, answered whole within `turnMs`. A turn still ending in the chat (its stop not yet through) refuses
 * the next with 409: that one waits and is sent again, within the same time.
 * @param {Filament} app @param {string} id @param {string} said @param {number} turnMs
 */
async function postTurn(app, id, said, turnMs) {
  const until = Date.now() + turnMs;
  for (;;) {
    try {
      return await app.api("POST", `/api/sessions/${encodeURIComponent(id)}/turns`, { content: said, stream: false, sendAsIs: true, unattended: true }, { timeoutMs: Math.max(1000, until - Date.now()) });
    } catch (e) {
      const busy = e instanceof Error && / HTTP 409 /.test(e.message);
      if (!busy || Date.now() + 15_000 >= until) throw e;
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

/** A task's score: 1 where it passed at once, 1/(1+n) after n corrections, 0 where it never passed. @param {boolean} success @param {number} corrections */
export const taskScore = (success, corrections) => (success ? 1 / (1 + corrections) : 0);

/**
 * Between two sessions, what time does in a person's day: the session's idle boundary has memory learn from it, and the
 * curator's pass that follows a learning run. Both are memory's own calls, asked for now rather than waited for.
 * @param {Filament} app @param {string} chat @param {string | null} projectId
 */
async function sessionEnds(app, chat, projectId) {
  const learned = await app.api("POST", `/api/memory/learn/${encodeURIComponent(chat)}`, {}, { timeoutMs: 600_000 });
  let curated = null;
  try {
    curated = await app.api("POST", "/api/memory/curator/run", projectId ? { project: projectId } : {}, { timeoutMs: 600_000 });
  } catch (e) {
    curated = { error: e instanceof Error ? e.message : String(e) };
  }
  return { learned: { items: learned?.items ?? null, passes: learned?.passes ?? null, skipped: learned?.skipped ?? null, error: learned?.error ?? null }, curated: curated?.error ? { error: curated.error } : { actions: Array.isArray(curated?.actions) ? curated.actions.length : (curated?.actions ?? null) } };
}

/**
 * One model on one arm: the fixture copied to a folder of its own, a Filament booted for it, each task in a fresh chat,
 * in order; with memory on, the session's end between tasks.
 * @param {{ fixture: Awaited<ReturnType<typeof loadFixture>>, model: string, arm: string, boot: (o: { dataDir: string, roots: string[], memory: boolean }) => Promise<Filament>, tasks?: string[] | null, maxCorrections?: number, turnMs?: number, keep?: boolean, log?: (s: string) => void }} o
 */
export async function runCell({ fixture, model, arm, boot, tasks = null, maxCorrections = 2, turnMs = 20 * 60_000, keep = false, log = () => {} }) {
  if (!ARMS.includes(arm)) throw new Error(`no arm ${arm}: ${ARMS.join(", ")}`);
  const t0 = Date.now();
  const root = mkdtempSync(join(tmpdir(), "filament-task-eval-"));
  const repo = join(root, "repo");
  prepareRepo(fixture.repo, repo, arm);
  const recalls = recallsOf(fixture.tasks);
  const chosen = fixture.tasks.filter((t) => !tasks || tasks.includes(t.id));
  log(`  ${model} · memory ${arm} — ${root}`);
  const app = await boot({ dataDir: join(root, "data"), roots: [root], memory: arm === "on" });
  /** @type {any[]} */
  const results = [];
  /** @type {any} */
  let memory = null;
  try {
    for (const task of chosen) {
      const r = await runTask({ app, repo, model, task, recalls: recalls.get(task.id) || new Set(), maxCorrections, turnMs, log });
      if (arm === "on") {
        try {
          r.between = await sessionEnds(app, r.chat, r.projectId);
        } catch (e) {
          r.between = { error: e instanceof Error ? e.message : String(e) };
        }
      }
      results.push(r);
    }
    if (arm === "on") {
      const traffic = (await app.api("GET", "/api/memory/traffic?limit=5000")).requests || [];
      /** @type {Record<string, number>} */
      const calls = {};
      for (const r of traffic) calls[r.memoryFor?.purpose || "memory"] = (calls[r.memoryFor?.purpose || "memory"] || 0) + 1;
      // What it held at the end: the project's claims and the global ones, and the dossier a next session would read.
      const project = results.find((r) => r.projectId)?.projectId || null;
      /** @type {any[]} */
      const claims = [];
      for (const q of [project ? `&project=${encodeURIComponent(project)}` : null, ""].filter((x) => x != null))
        try {
          const c = await app.api("GET", `/api/memory/claims?state=standing&limit=200${q}`);
          for (const x of c?.claims || []) claims.push({ id: x.id, kind: x.kind, text: String(x.text || "").slice(0, 400), trust: x.trust ?? null, scope: x.project ? "project" : "global" });
        } catch {}
      /** @type {string | null} */
      let dossier = null;
      if (project)
        try {
          const d = await app.api("GET", `/api/memory/dossier?project=${encodeURIComponent(project)}`);
          dossier = typeof d?.text === "string" ? d.text.slice(0, 4000) : null;
        } catch {}
      memory = { calls, tokens: tokensOf(traffic), claims, dossier };
    }
  } finally {
    await app.stop();
    if (!keep) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  return { model, arm, folder: keep ? root : null, tasks: results, memory, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Scores.
// ---------------------------------------------------------------------------------------------------------------------

/** The mean of numbers; null for none. @param {number[]} xs */
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** Rounded to 3 places; null stays null. @param {number | null} x */
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

/**
 * The normalized gain of a score over the baseline's (Hake's g): the share of the room the baseline left above it that
 * the arm took — 1 where it took all of it, 0 where none, below 0 where it did worse. Null where the baseline left no room.
 * @param {number | null} score @param {number | null} base
 */
export function normalizedGain(score, base) {
  if (score == null || base == null || base >= 1) return null;
  return r3((score - base) / (1 - base));
}

/**
 * Each cell's totals, and each arm's gain over memory off for its model. `recallScore` is the mean score of the tasks
 * that recall something an earlier task taught — the tasks memory can help with; `prefRecall` the share of those
 * recalls right at the first try.
 * @param {any[]} cells
 */
export function summarize(cells) {
  const rows = cells.map((c) => {
    const ts = c.tasks;
    const recalling = ts.filter((/** @type {any} */ t) => t.prefs.some((/** @type {any} */ p) => p.recall));
    const recalls = ts.flatMap((/** @type {any} */ t) => t.prefs.filter((/** @type {any} */ p) => p.recall));
    const agent = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const t of ts) for (const k of /** @type {const} */ (["input", "output", "cacheRead", "cacheWrite"])) agent[k] += t.tokens[k];
    const mem = c.memory?.tokens || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    return {
      model: c.model,
      arm: c.arm,
      tasks: ts.length,
      success: ts.filter((/** @type {any} */ t) => t.success).length,
      firstTry: ts.filter((/** @type {any} */ t) => t.firstTry).length,
      corrections: ts.reduce((/** @type {number} */ a, /** @type {any} */ t) => a + t.corrections, 0),
      rounds: ts.reduce((/** @type {number} */ a, /** @type {any} */ t) => a + t.rounds, 0),
      agentTokens: totalTokens(agent),
      memoryTokens: totalTokens(mem),
      score: r3(mean(ts.map((/** @type {any} */ t) => t.score))),
      recallScore: r3(mean(recalling.map((/** @type {any} */ t) => t.score))),
      prefRecall: recalls.length ? `${recalls.filter((/** @type {any} */ p) => p.firstTry).length}/${recalls.length}` : null,
      gain: /** @type {number | null} */ (null),
      recallGain: /** @type {number | null} */ (null),
    };
  });
  for (const row of rows) {
    const off = rows.find((x) => x.model === row.model && x.arm === "off");
    if (!off || row.arm === "off") continue;
    row.gain = normalizedGain(row.score, off.score);
    row.recallGain = normalizedGain(row.recallScore, off.recallScore);
  }
  return rows;
}

/** The report as a page: what ran, the table, each task's line per cell. @param {any} report */
export function renderMarkdown(report) {
  const L = [];
  L.push(`# Memory task eval — ${report.label}`, "");
  L.push(`${report.at} · fixture \`${report.fixture}\` · commit \`${report.commit || "?"}\` · learner \`${report.learner}\` · up to ${report.maxCorrections} corrections a task`, "");
  L.push("Arms: **on** — Filament's memory as this commit has it; **off** — memory off; **notes** — memory off, and an AGENTS.md the agent is told to keep its notes in. Score: 1 for a task passed at once, 1/(1+n) after n corrections, 0 for one never passed. Gain: normalized over memory off, (arm − off) / (1 − off). Recall: the tasks that need something an earlier task taught.", "");
  L.push("| model | arm | passed | first try | corrections | rounds | agent tokens | memory tokens | score | gain | recall score | recall gain | recalled at once |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const n = (/** @type {number | null} */ x) => (x == null ? "—" : String(x));
  for (const s of report.summary)
    L.push(`| ${s.model} | ${s.arm} | ${s.success}/${s.tasks} | ${s.firstTry}/${s.tasks} | ${s.corrections} | ${s.rounds} | ${s.agentTokens.toLocaleString("en-US")} | ${s.memoryTokens.toLocaleString("en-US")} | ${n(s.score)} | ${n(s.gain)} | ${n(s.recallScore)} | ${n(s.recallGain)} | ${n(s.prefRecall)} |`);
  for (const c of report.cells) {
    L.push("", `## ${c.model} · memory ${c.arm}`, "");
    L.push("| task | passed | first try | corrections | rounds | tokens | preferences at the first try |");
    L.push("|---|---|---|---|---|---|---|");
    for (const t of c.tasks)
      L.push(`| ${t.task} | ${t.success ? "yes" : "no"} | ${t.firstTry ? "yes" : "no"} | ${t.corrections} | ${t.rounds} | ${totalTokens(t.tokens).toLocaleString("en-US")} | ${t.prefs.map((/** @type {any} */ p) => `${p.firstTry ? "✓" : "✗"} ${p.pref}${p.recall ? "" : " (new)"}`).join(", ") || "—"} |`);
    const errs = c.tasks.flatMap((/** @type {any} */ t) => t.turns.filter((/** @type {any} */ x) => x.error).map((/** @type {any} */ x) => `${t.task}: ${x.error}`));
    if (errs.length) L.push("", "Turns that failed: " + errs.map((e) => `\`${e.slice(0, 160)}\``).join("; "));
    if (c.memory) {
      L.push("", `Memory's own calls: ${Object.entries(c.memory.calls).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`);
      if (c.memory.claims.length) L.push("", "What memory held at the end:", "", ...c.memory.claims.map((/** @type {any} */ x) => `- (${x.kind}) ${x.text}`));
    }
  }
  return L.join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------------------------------
// The run: every model on every arm.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {{ fixture: Awaited<ReturnType<typeof loadFixture>>, models: string[], arms?: string[], boot: (model: string) => (o: { dataDir: string, roots: string[], memory: boolean }) => Promise<Filament>, learner?: string, tasks?: string[] | null, maxCorrections?: number, turnMs?: number, keep?: boolean, label?: string, log?: (s: string) => void }} o
 */
export async function runEval({ fixture, models, arms = [...ARMS], boot, learner = DEFAULT_LEARNER, tasks = null, maxCorrections = 2, turnMs = 20 * 60_000, keep = false, label = "run", log = () => {} }) {
  const at = new Date().toISOString();
  const cells = [];
  for (const model of models)
    for (const arm of arms) {
      try {
        cells.push(await runCell({ fixture, model, arm, boot: boot(model), tasks, maxCorrections, turnMs, keep, log }));
      } catch (e) {
        log(`  ${model} · memory ${arm} stopped: ${e instanceof Error ? e.stack || e.message : String(e)}`);
        cells.push(failedCell(model, arm, e));
      }
    }
  return reportOf({ label, at, fixture, models, arms, learner, tasks, maxCorrections, cells });
}

/** A cell that stopped before it was done. @param {string} model @param {string} arm @param {unknown} e */
const failedCell = (model, arm, e) => ({ model, arm, folder: null, tasks: [], memory: null, ms: 0, error: e instanceof Error ? e.message : String(e) });

/**
 * The report of a run's cells: what ran, on which commit, the cells and their summary.
 * @param {{ label: string, at: string, fixture: Awaited<ReturnType<typeof loadFixture>>, models: string[], arms: string[], learner: string, tasks: string[] | null, maxCorrections: number, cells: any[] }} o
 */
export function reportOf({ label, at, fixture, models, arms, learner, tasks, maxCorrections, cells }) {
  const head = spawnSync("git", ["rev-parse", "--short=9", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  return { label, at, commit: head.status === 0 ? head.stdout.trim() : null, fixture: fixture.name, models, arms, learner, maxCorrections, tasks: fixture.tasks.filter((t) => !tasks || tasks.includes(t.id)).map((t) => t.id), cells, summary: summarize(cells.filter((c) => !c.error)) };
}

/**
 * The cells run `jobs` at a time, each in a child process of its own running this script on one cell (`--cell
 * <model>::<arm>`): a Filament per process, so no two share the process-wide state an app keeps. Their lines are said
 * as they come; a child that ends without its cell is a failed cell.
 * @param {{ cells: [string, string][], argv: string[], jobs: number, log: (s: string) => void }} o
 */
async function runChildren({ cells, argv, jobs, log }) {
  const { spawn } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "filament-task-eval-cells-"));
  /** @type {any[]} */
  const out = new Array(cells.length);
  let next = 0;
  const one = async () => {
    while (next < cells.length) {
      const i = next++;
      const [model, arm] = cells[i];
      const file = join(dir, `${i}.json`);
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv, "--cell", `${model}::${arm}`, "--cell-out", file], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const said = (/** @type {Buffer} */ b) => String(b).split(/\r?\n/).filter((l) => l.trim() && !/ExperimentalWarning|--trace-warnings/.test(l)).forEach((l) => log(`[${model} · ${arm}] ${l}`));
      child.stdout.on("data", said);
      child.stderr.on("data", said);
      const code = await new Promise((r) => child.on("close", r));
      try {
        out[i] = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        out[i] = failedCell(model, arm, new Error(`its process ended (${code}) with no cell`));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, cells.length)) }, one));
  rmSync(dir, { recursive: true, force: true });
  return out;
}

/** The report's two files, `<name>.json` and `<name>.md`, in `dir`. @param {any} report @param {string} dir @param {string} name */
export function writeReport(report, dir, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(dir, `${name}.md`), renderMarkdown(report));
  return { json: join(dir, `${name}.json`), md: join(dir, `${name}.md`) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The providers, from Filament's own config.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The routes that answer `names` in `config` (each the first enabled one that matches, as Filament routes), in the
 * config's order, with no backups — a model's fallback would be another model's answer — and the upstreams they name.
 * @param {any} config  normalized and opened @param {string[]} names
 */
export function providersFor(config, names) {
  const picked = new Set();
  for (const name of names) {
    // As `findRoute` picks: the first enabled route whose match takes the name.
    const i = (config.routes || []).findIndex((/** @type {any} */ r) => r.enabled !== false && routeMatches(r.match, name));
    if (i < 0) throw new Error(`no route answers ${name}: \`filament models\` lists the names Filament knows`);
    picked.add(i);
  }
  const routes = [...picked].sort((a, b) => a - b).map((i) => ({ ...config.routes[i], fallbacks: [] }));
  const upstreams = [...new Set(routes.map((r) => r.upstream))].map((id) => {
    const u = findUpstream(config, id);
    if (!u) throw new Error(`route ${id} names no upstream`);
    return structuredClone(u);
  });
  return { upstreams, routes };
}

/**
 * The installed engine, as a stand-in hook on a memory folder of the cell's own; null where it is not installed. Its
 * embedding model is the one its install warmed (engine.json `embeddingModel`; none named, the engine's own), read from
 * its cache - or, with `embeddingCache` (a fastembed cache that holds this build's model, `EMBEDDING_MODEL`), this
 * build's, as an engine installed from this build's bundle runs it. A cell downloads nothing.
 * @param {string} dataDir @param {{ embeddingCache?: string | null }} [o]
 */
export function installedEngine(dataDir, { embeddingCache = null } = {}) {
  const es = engineState(dataDir);
  if (!es.installed || !es.venvPython) return null;
  const dir = join(dataDir, "memory-engine");
  const model = embeddingCache ? EMBEDDING_MODEL : es.embeddingModel || null;
  return {
    command: es.venvPython,
    args: [join(ROOT, "sidecar", "mnemosyne_sidecar.py")],
    env: {
      MNEMOSYNE_FASTEMBED_CACHE_DIR: embeddingCache || join(dir, "cache", "fastembed"),
      MNEMOSYNE_MODEL_CACHE_DIR: join(dir, "cache", "models"),
      ...(model ? { MNEMOSYNE_EMBEDDING_MODEL: model } : {}),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The command line.
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {Record<string, string | true>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = true;
  }
  return out;
}
const list = (/** @type {unknown} */ v, /** @type {string[]} */ dflt) => (typeof v === "string" && v.trim() ? v.split(",").map((s) => s.trim()).filter(Boolean) : dflt);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // What a coding agent's terminal set is no part of the cells' agents' world (test/helpers/clean-env.js).
  for (const name of AGENT_ENV_SCRUB) delete process.env[name];
  const dataDir = String(typeof args["data-dir"] === "string" ? args["data-dir"] : appDataDir());
  const models = list(args.models, DEFAULT_MODELS);
  const learner = typeof args.learner === "string" ? args.learner : DEFAULT_LEARNER;
  const arms = list(args.arms, [...ARMS]);
  const fixture = await loadFixture(typeof args.fixture === "string" ? resolve(args.fixture) : DEFAULT_FIXTURE);
  const tasks = typeof args.tasks === "string" ? list(args.tasks, []) : null;
  const label = typeof args.label === "string" ? args.label : "run";
  // Read only: `loadConfig` would mint or seal a key and save the file, and this script never writes Filament's config.
  const config = normalizeConfig(openConfig(JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")), loadKey(dataDir, { create: false })).config);
  // The engine may be another data folder's install (`--engine-from`), and its embedding model this build's (`--embedding-cache`).
  const engineFrom = typeof args["engine-from"] === "string" ? resolve(args["engine-from"]) : dataDir;
  const engine = arms.includes("on") ? installedEngine(engineFrom, { embeddingCache: typeof args["embedding-cache"] === "string" ? resolve(args["embedding-cache"]) : null }) : null;
  const log = (/** @type {string} */ s) => console.log(s);
  const maxCorrections = Number(args.corrections ?? 2);
  const turnMs = Number(args["turn-minutes"] ?? 20) * 60_000;
  const keep = args.keep === true;
  const boot = (/** @type {string} */ model) => {
    const { upstreams, routes } = providersFor(config, [model, learner]);
    return (/** @type {{ dataDir: string, roots: string[], memory: boolean }} */ { dataDir: d, roots, memory }) => bootFilament({ dataDir: d, upstreams, routes, roots, memory: memory ? { learner, engine } : null });
  };
  // A child of --jobs: one cell, written where it is told.
  if (typeof args.cell === "string") {
    const [model, arm] = args.cell.split("::");
    let cell;
    try {
      cell = await runCell({ fixture, model, arm, boot: boot(model), tasks, maxCorrections, turnMs, keep, log });
    } catch (e) {
      log(`stopped: ${e instanceof Error ? e.stack || e.message : String(e)}`);
      cell = failedCell(model, arm, e);
    }
    writeFileSync(String(args["cell-out"]), JSON.stringify(cell));
    return;
  }
  if (arms.includes("on") && !engine) console.error(`no memory engine is installed in ${engineFrom}: memory on runs on the archive alone`);
  log(`Memory task eval: ${fixture.name}, ${models.join(" and ")}, arms ${arms.join(", ")}, learner ${learner}`);
  // What would run, and where each name goes, with no key said: --dry stops there.
  for (const model of models) {
    const { upstreams, routes } = providersFor(config, [model, learner]);
    log(`  ${model}: routes ${routes.map((r) => `${r.match} → ${r.upstream}`).join(", ")}; upstreams ${upstreams.map((u) => `${u.id} (${u.type}${u.apiKey ? ", key set" : ", no key"})`).join(", ")}`);
  }
  if (arms.includes("on")) log(`  memory engine: ${engine ? `${engine.command}, embeddings ${engine.env.MNEMOSYNE_EMBEDDING_MODEL || "the engine's own"}` : "none"}`);
  log(`  tasks: ${fixture.tasks.filter((t) => !tasks || tasks.includes(t.id)).map((t) => t.id).join(", ")}`);
  if (args.dry === true) return;
  const jobs = Math.max(1, Number(args.jobs ?? 1) || 1);
  const report =
    jobs > 1
      ? reportOf({
          label,
          at: new Date().toISOString(),
          fixture,
          models,
          arms,
          learner,
          tasks,
          maxCorrections,
          cells: await runChildren({ cells: models.flatMap((m) => arms.map((a) => /** @type {[string, string]} */ ([m, a]))), argv: process.argv.slice(2).filter((a, i, all) => a !== "--jobs" && all[i - 1] !== "--jobs"), jobs, log }),
        })
      : await runEval({ fixture, models, arms, learner, tasks, label, maxCorrections, turnMs, keep, log, boot });
  const name = `${report.at.slice(0, 10)}-${label}`;
  const out = writeReport(report, typeof args.out === "string" ? resolve(args.out) : RESULTS, name);
  log("");
  log(renderMarkdown({ ...report, cells: [] }).trim());
  log(`\n${out.md}\n${out.json}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e instanceof Error ? e.stack || e.message : String(e));
      process.exit(1);
    },
  );
}
