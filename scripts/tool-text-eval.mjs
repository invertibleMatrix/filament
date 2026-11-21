#!/usr/bin/env node
// The tool-text eval (P2): do the loop's tool texts lead a model to use its tools well? Short real tasks, each needing a
// particular tool used right — the task graph's needs and its done, an edit where the text it changes is in the file
// twice, a value far into a long file, a count the shell gives, a list of steps the checklist keeps — each in a fresh
// chat of a Filament started from this checkout on a throwaway data folder, on each model, repeated. After the turn its
// checks run on the folder and the chat. Each probe is scored on passing, the tool calls that came back as errors, the
// rounds (the loop's model calls) and the tokens; a run is compared with another (`--against`) probe by probe.
//
//   node scripts/tool-text-eval.mjs [--models zai/glm-5.3,grok-4.6,claude-haiku-5-5] [--probes graph,edit,far,shell,steps]
//     [--reps 2] [--label before] [--against <report.json>] [--out <folder>] [--data-dir <Filament's data folder>]
//     [--turn-minutes 10] [--keep] [--dry]
//
// The providers are read from the data folder's config (the installed app's by default), read only, as the memory task
// eval reads them (memory-task-eval.mjs `providersFor`). The report goes to evals/tools/results.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConfig, appDataDir } from "../src/services/config/store.js";
import { loadKey, openConfig } from "../src/services/config/secrets.js";
import { AGENT_ENV_SCRUB } from "../src/adapters/agents/agent-process.js";
import { bootFilament, providersFor, parseArgs, totalTokens, TOOLS_OFF } from "./memory-task-eval.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RESULTS = join(ROOT, "evals", "tools", "results");
export const DEFAULT_MODELS = ["zai/glm-5.3", "grok-4.6", "claude-haiku-5-5"];

// ---------------------------------------------------------------------------------------------------------------------
// The probes: a folder to start from, the person's message, and what shows it done.
// ---------------------------------------------------------------------------------------------------------------------

/** A value no model can guess: line `n`'s of the long file. @param {number} n */
const valueAt = (n) => createHash("sha256").update(`far-${n}`).digest("hex").slice(0, 12);

/**
 * @typedef {object} ProbeContext
 * @property {string} repo
 * @property {(path: string) => string | null} read
 * @property {(cmd: string, args: string[]) => { code: number | null, out: string }} run
 * @property {string} reply  the turn's last words
 * @property {any} transcript  the chat's transcript, as the page reads it
 * @property {any} session  the chat's session view (GET /api/sessions/:id): its task graph in force
 * @property {{ name: string, error: boolean }[]} calls  each tool call of the turn, in order, and whether it came back an error
 */
/**
 * @typedef {object} Probe
 * @property {string} id
 * @property {string} title
 * @property {string} tool  the tool it is about
 * @property {Record<string, string>} files  the folder as it starts
 * @property {string} prompt
 * @property {{ id: string, check: (ctx: ProbeContext) => true | string }[]} checks
 */

/** @type {Probe[]} */
export const PROBES = [
  {
    id: "graph",
    title: "Work that branches, on the task graph with its needs",
    tool: "tasks",
    files: { "package.json": JSON.stringify({ name: "probe", type: "module" }, null, 2) + "\n" },
    prompt:
      "Build a tiny library here, planned on the task graph first: lib/a.js exporting add(a, b); lib/b.js exporting mul(a, b); lib/index.js re-exporting both (it needs a.js and b.js); and test.mjs, which imports lib/index.js and throws unless add(2, 3) === 5 and mul(2, 3) === 6 (it needs index.js). Run test.mjs with node at the end.",
    checks: [
      { id: "test passes", check: (c) => (c.run(process.execPath, ["test.mjs"]).code === 0 ? true : "node test.mjs fails") },
      {
        id: "graph with needs, all done",
        check: (c) => {
          const tasks = graphTasks(c.session);
          if (tasks.length < 3) return `${tasks.length} tasks on the graph (${JSON.stringify(c.session?.inForce?.graph ?? null).slice(0, 300)})`;
          if (!tasks.some((t) => (t.needs || []).length)) return "no task needs another";
          const open = tasks.filter((t) => !["done", "dropped"].includes(String(t.state || t.status)));
          return open.length ? `${open.length} not done: ${open.map((t) => t.id).join(", ")}` : true;
        },
      },
    ],
  },
  {
    id: "edit",
    title: "An edit where the text it changes is in the file twice",
    tool: "edit",
    files: { "config.ini": "[server]\nhost = 0.0.0.0\ntimeout = 30\nretries = 3\n\n[client]\nhost = localhost\ntimeout = 30\nretries = 3\n" },
    prompt: "In config.ini, change the timeout in the [server] section to 60. The [client] section stays as it is.",
    checks: [
      {
        id: "server 60, client 30, nothing else",
        check: (c) => (c.read("config.ini") === "[server]\nhost = 0.0.0.0\ntimeout = 60\nretries = 3\n\n[client]\nhost = localhost\ntimeout = 30\nretries = 3\n" ? true : `config.ini is now:\n${c.read("config.ini")}`),
      },
    ],
  },
  {
    id: "far",
    title: "A value far into a long file",
    tool: "read",
    files: { "data.txt": Array.from({ length: 4000 }, (_, i) => `line ${i + 1}: value=${valueAt(i + 1)}`).join("\n") + "\n" },
    prompt: "What is the value on line 3187 of data.txt? Answer with the value alone.",
    checks: [{ id: "the value", check: (c) => (c.reply.includes(valueAt(3187)) ? true : `answered: ${c.reply.slice(-200)}`) }],
  },
  {
    id: "shell",
    title: "A count the shell gives",
    tool: "bash",
    files: Object.fromEntries(
      [
        ["src/a.js", 12],
        ["src/b.js", 30],
        ["src/deep/c.js", 7],
        ["src/deep/deeper/d.js", 51],
        ["src/readme.md", 40],
        ["other/e.js", 9],
      ].map(([p, n]) => [p, Array.from({ length: Number(n) }, (_, i) => `// line ${i + 1}`).join("\n") + "\n"]),
    ),
    prompt: "Count the total number of lines across all .js files under src/, its subfolders included, and write just that number to count.txt.",
    checks: [{ id: "count.txt says 100", check: (c) => (String(c.read("count.txt") || "").trim() === "100" ? true : `count.txt: ${c.read("count.txt")}`) }],
  },
  {
    id: "steps",
    title: "Steps one after another, on the checklist",
    tool: "plan",
    files: { "notes.txt": "buy milk\ncall Sam\n" },
    prompt: "Three things: rename notes.txt to NOTES.md; add a first line '# Notes' to it; and create CHANGELOG.md holding the one line 'v0.1'.",
    checks: [
      // A blank line after the heading is the Markdown way, and keeps every line: it passes too.
      { id: "NOTES.md", check: (c) => (/^# Notes\n\n?buy milk\ncall Sam\n?$/.test(String(c.read("NOTES.md") ?? "")) && c.read("notes.txt") == null ? true : `NOTES.md: ${JSON.stringify(c.read("NOTES.md"))}; notes.txt ${c.read("notes.txt") == null ? "gone" : "still there"}`) },
      { id: "CHANGELOG.md", check: (c) => (String(c.read("CHANGELOG.md") || "").trim() === "v0.1" ? true : `CHANGELOG.md: ${c.read("CHANGELOG.md")}`) },
      { id: "checklist kept", check: (c) => (c.calls.some((x) => x.name === "plan") ? true : "no checklist") },
    ],
  },
];

/** The task graph's tasks, as the chat's session view holds them (`inForce.graph`, the Plan page's). @param {any} session */
function graphTasks(session) {
  const tasks = session?.inForce?.graph?.tasks ?? null;
  return Array.isArray(tasks) ? tasks : tasks && typeof tasks === "object" ? Object.values(tasks) : [];
}

/** A tool result's words, cut for the report. @param {any} content */
const resultWords = (content) =>
  (typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => (typeof b?.text === "string" ? b.text : "")).join(" ") : "").replace(/\s+/g, " ").trim().slice(0, 240);

/** Each tool call of the transcript's turns, in order, whether its result was an error, and an error's words. @param {any} tr */
function callsOf(tr) {
  /** @type {Map<string, { name: string, error: boolean, why?: string }>} */
  const byId = new Map();
  const walk = (/** @type {any} */ x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    if (x.type === "tool_use" && x.id) byId.set(String(x.id), { ...byId.get(String(x.id)), name: String(x.name), error: byId.get(String(x.id))?.error || false });
    if (x.type === "tool_result" && x.tool_use_id) {
      const was = byId.get(String(x.tool_use_id));
      const why = x.is_error === true ? resultWords(x.content) : undefined;
      if (was) {
        was.error ||= x.is_error === true;
        if (why) was.why = why;
      } else byId.set(String(x.tool_use_id), { name: "?", error: x.is_error === true, ...(why ? { why } : {}) });
    }
    for (const v of Object.values(x)) walk(v);
  };
  walk(tr?.turns ?? []);
  return [...byId.values()];
}

// ---------------------------------------------------------------------------------------------------------------------
// A run.
// ---------------------------------------------------------------------------------------------------------------------

/** @param {string} dir @param {Record<string, string>} files */
function lay(dir, files) {
  for (const [p, text] of Object.entries(files)) {
    const at = join(dir, ...p.split("/"));
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, text);
  }
  const git = (/** @type {string[]} */ ...a) => spawnSync("git", ["-c", "user.name=eval", "-c", "user.email=eval@example.invalid", "-c", "core.autocrlf=false", ...a], { cwd: dir, windowsHide: true });
  if (git("init", "-q").status === 0) {
    git("add", "-A");
    git("commit", "-qm", "the probe as it starts");
  }
}

/** The tokens of a chat's model calls. @param {any[]} recs */
const tokensOf = (recs) => {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const r of recs) for (const k of /** @type {const} */ (["input", "output", "cacheRead", "cacheWrite"])) t[k] += r.tokens?.[k] || 0;
  return t;
};

/** A turn answered whole within `ms`. @param {any} app @param {string} id @param {string} said @param {number} ms */
async function postTurn(app, id, said, ms) {
  return app.api("POST", `/api/sessions/${encodeURIComponent(id)}/turns`, { content: said, stream: false, sendAsIs: true, unattended: true }, { timeoutMs: ms });
}

/** One probe, once, in a fresh folder and chat. @param {{ app: any, root: string, model: string, probe: Probe, turnMs: number }} o */
async function runProbe({ app, root, model, probe, turnMs }) {
  const t0 = Date.now();
  const repo = mkdtempSync(join(root, `${probe.id}-`));
  lay(repo, probe.files);
  const chat = await app.api("POST", "/api/sessions", { cwd: repo, model, preset: null, settings: { loop: { tools: { ...TOOLS_OFF } } } });
  const id = String(chat.id);
  let reply = "";
  /** @type {string | null} */
  let error = null;
  try {
    const msg = await postTurn(app, id, probe.prompt, turnMs);
    reply = (msg?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("");
    if (msg?.type === "error") error = String(msg.error?.message || "the turn failed");
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    await app.api("POST", `/api/sessions/${encodeURIComponent(id)}/stop`, {}).catch(() => {});
  }
  const transcript = await app.api("GET", `/api/sessions/${encodeURIComponent(id)}/transcript`);
  const calls = callsOf(transcript);
  const read = (/** @type {string} */ p) => {
    try {
      return readFileSync(join(repo, ...p.split("/")), "utf8");
    } catch {
      return null;
    }
  };
  const { NODE_TEST_CONTEXT: _runner, ...env } = process.env;
  const run = (/** @type {string} */ cmd, /** @type {string[]} */ args) => {
    const r = spawnSync(cmd, args, { cwd: repo, encoding: "utf8", timeout: 60_000, windowsHide: true, env: { ...env, NODE_OPTIONS: "" } });
    return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
  };
  const session = await app.api("GET", `/api/sessions/${encodeURIComponent(id)}`);
  const ctx = { repo, read, run, reply, transcript, session, calls };
  const checks = probe.checks.map((c) => {
    let v;
    try {
      v = c.check(ctx);
    } catch (e) {
      v = `the check threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    return { id: c.id, ok: v === true, ...(v === true ? {} : { why: String(v).slice(0, 400) }) };
  });
  const recs = (await app.api("GET", `/api/sessions/${encodeURIComponent(id)}/requests?limit=500`)).requests || [];
  const ticks = recs.filter((/** @type {any} */ r) => r.source === "agent-tick");
  return {
    probe: probe.id,
    pass: checks.every((c) => c.ok),
    checks,
    calls: calls.length,
    errors: calls.filter((c) => c.error).length,
    erred: calls.filter((c) => c.error).map((c) => c.name),
    whyErred: calls.filter((c) => c.error).map((c) => `${c.name}: ${c.why || "?"}`),
    used: [...new Set(calls.map((c) => c.name))],
    rounds: ticks.length,
    tokens: totalTokens(tokensOf(ticks)),
    reply: reply.slice(-400),
    ...(error ? { error } : {}),
    ms: Date.now() - t0,
  };
}

/** Every probe on one model, `reps` times each, in one Filament. @param {{ model: string, probes: Probe[], reps: number, boot: (o: { dataDir: string, roots: string[] }) => Promise<any>, turnMs: number, keep: boolean, log: (s: string) => void }} o */
async function runModel({ model, probes, reps, boot, turnMs, keep, log }) {
  const root = mkdtempSync(join(tmpdir(), "filament-tool-eval-"));
  const app = await boot({ dataDir: join(root, "data"), roots: [root] });
  /** @type {any[]} */
  const runs = [];
  try {
    for (let r = 1; r <= reps; r++)
      for (const probe of probes) {
        const one = await runProbe({ app, root, model, probe, turnMs });
        runs.push({ rep: r, ...one });
        log(`  ${model} · ${probe.id} #${r}: ${one.pass ? "pass" : `fail (${one.checks.filter((c) => !c.ok).map((c) => c.id).join(", ")})`} · ${one.errors}/${one.calls} calls errored · ${one.rounds} rounds · ${one.tokens.toLocaleString("en-US")} tokens${one.error ? ` · ${one.error.slice(0, 120)}` : ""}`);
      }
  } finally {
    await app.stop();
    if (!keep) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  return { model, runs };
}

// ---------------------------------------------------------------------------------------------------------------------
// Scores.
// ---------------------------------------------------------------------------------------------------------------------

/** Each model's and probe's totals over its repetitions. @param {any[]} models */
export function summarize(models) {
  return models.flatMap((m) =>
    [...new Set(m.runs.map((/** @type {any} */ r) => r.probe))].map((probe) => {
      const rs = m.runs.filter((/** @type {any} */ r) => r.probe === probe);
      const sum = (/** @type {(r: any) => number} */ f) => rs.reduce((a, r) => a + f(r), 0);
      return { model: m.model, probe, runs: rs.length, passed: rs.filter((/** @type {any} */ r) => r.pass).length, errors: sum((r) => r.errors), calls: sum((r) => r.calls), rounds: sum((r) => r.rounds), tokens: sum((r) => r.tokens) };
    }),
  );
}

/** The report as a page, against another where one is given. @param {any} report @param {any} [against] */
export function renderMarkdown(report, against = null) {
  const L = [`# Tool-text eval — ${report.label}`, "", `${report.at} · commit \`${report.commit || "?"}\` · ${report.reps} run(s) of each probe`, ""];
  const was = (/** @type {any} */ s) => against?.summary?.find((x) => x.model === s.model && x.probe === s.probe) || null;
  L.push(`| model | probe | passed | calls errored | rounds | tokens |${against ? ` passed before | errored before | rounds before | tokens before |` : ""}`);
  L.push(`|---|---|---|---|---|---|${against ? "---|---|---|---|" : ""}`);
  for (const s of report.summary) {
    const b = was(s);
    L.push(`| ${s.model} | ${s.probe} | ${s.passed}/${s.runs} | ${s.errors}/${s.calls} | ${s.rounds} | ${s.tokens.toLocaleString("en-US")} |${against ? (b ? ` ${b.passed}/${b.runs} | ${b.errors}/${b.calls} | ${b.rounds} | ${b.tokens.toLocaleString("en-US")} |` : " — | — | — | — |") : ""}`);
  }
  for (const m of report.models) {
    L.push("", `## ${m.model}`, "");
    for (const r of m.runs) L.push(`- ${r.probe} #${r.rep}: ${r.pass ? "pass" : "fail"} — ${r.checks.filter((/** @type {any} */ c) => !c.ok).map((/** @type {any} */ c) => `${c.id}: ${String(c.why).replace(/\n/g, "\\n")}`).join("; ") || "all checks"}; tools ${r.used.join(", ") || "none"}${r.erred?.length ? `; errored: ${(r.whyErred || r.erred).join(" | ")}` : ""}${r.error ? `; ${r.error.slice(0, 160)}` : ""}`);
  }
  return L.join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------------------------------
// The command line.
// ---------------------------------------------------------------------------------------------------------------------

const list = (/** @type {unknown} */ v, /** @type {string[]} */ dflt) => (typeof v === "string" && v.trim() ? v.split(",").map((s) => s.trim()).filter(Boolean) : dflt);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const name of AGENT_ENV_SCRUB) delete process.env[name];
  const dataDir = String(typeof args["data-dir"] === "string" ? args["data-dir"] : appDataDir());
  const models = list(args.models, DEFAULT_MODELS);
  const ids = list(args.probes, PROBES.map((p) => p.id));
  const probes = PROBES.filter((p) => ids.includes(p.id));
  const reps = Math.max(1, Number(args.reps ?? 2) || 2);
  const label = typeof args.label === "string" ? args.label : "run";
  const turnMs = Number(args["turn-minutes"] ?? 10) * 60_000;
  const keep = args.keep === true;
  const log = (/** @type {string} */ s) => console.log(s);
  const config = normalizeConfig(openConfig(JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")), loadKey(dataDir, { create: false })).config);
  log(`Tool-text eval: ${probes.map((p) => p.id).join(", ")} on ${models.join(", ")}, ${reps} run(s) each`);
  for (const model of models) {
    const { upstreams, routes } = providersFor(config, [model]);
    log(`  ${model}: routes ${routes.map((r) => `${r.match} → ${r.upstream}`).join(", ")}; upstreams ${upstreams.map((u) => `${u.id} (${u.type}${u.apiKey ? ", key set" : ", no key"})`).join(", ")}`);
  }
  if (args.dry === true) return;
  /** @type {any[]} */
  const done = [];
  for (const model of models) {
    const { upstreams, routes } = providersFor(config, [model]);
    try {
      done.push(await runModel({ model, probes, reps, turnMs, keep, log, boot: ({ dataDir: d, roots }) => bootFilament({ dataDir: d, upstreams, routes, roots }) }));
    } catch (e) {
      log(`  ${model} stopped: ${e instanceof Error ? e.stack || e.message : String(e)}`);
      done.push({ model, runs: [], error: e instanceof Error ? e.message : String(e) });
    }
  }
  const head = spawnSync("git", ["rev-parse", "--short=9", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  const report = { label, at: new Date().toISOString(), commit: head.status === 0 ? head.stdout.trim() : null, reps, probes: probes.map((p) => p.id), models: done, summary: summarize(done) };
  const against = typeof args.against === "string" ? JSON.parse(readFileSync(resolve(args.against), "utf8")) : null;
  const dir = typeof args.out === "string" ? resolve(args.out) : RESULTS;
  mkdirSync(dir, { recursive: true });
  const name = `${report.at.slice(0, 10)}-${label}`;
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(dir, `${name}.md`), renderMarkdown(report, against));
  log("");
  log(renderMarkdown({ ...report, models: [] }, against).trim());
  log(`\n${join(dir, `${name}.md`)}`);
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
