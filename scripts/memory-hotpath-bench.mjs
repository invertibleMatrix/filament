#!/usr/bin/env node
// The memory hot path's blocking time (HarnessV3-Memory M3-1, MD-17): a synthetic store on the fake engine — claims of
// every kind and origin, claims about files of a real project folder, claims about the environment — and a run of
// sessions through `prepare`, the part of a request that runs before the upstream is called. Prints the median, p95
// and worst, for a session's first request (the briefing) and its later ones (the turn block). Writes nothing outside
// its temp folders, which it removes.
//
//   node scripts/memory-hotpath-bench.mjs [--claims 400] [--files 60] [--sessions 100] [--turns 3]
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { world } from "../test/fixtures/memory-world.mjs";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])));
const CLAIMS = Number(args.claims) || 400;
const FILES = Number(args.files) || 60;
const SESSIONS = Number(args.sessions) || 100;
const TURNS = Number(args.turns) || 3;
const CC_UA = { "user-agent": "claude-cli/2.1.258 (external, cli)" };

// Deterministic words: the same store and the same requests on every run.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const NOUNS = ["deploy", "bundle", "server", "cache", "parser", "router", "session", "token", "schema", "worker", "queue", "proxy", "build", "release", "config", "logger", "storage", "index", "client", "migration"];
const VERBS = ["uploads", "reads", "writes", "validates", "retries", "compresses", "signs", "caches", "streams", "splits"];
const KINDS = [["fact", "capture"], ["fact", "learner"], ["decision", "capture"], ["rule", "person"], ["preference", "capture"], ["convention", "learner"], ["thread", "learner"], ["fact", "model"], ["fact", "import"], ["rule", "correction"]];

const proj = mkdtempSync(join(tmpdir(), "filament-bench-proj-"));
try {
  mkdirSync(join(proj, "src"));
  for (let i = 0; i < FILES; i++) writeFileSync(join(proj, "src", `mod${i}.js`), `export function ${pick(VERBS)}${i}() { return ${i}; }\n`.repeat(20));
  writeFileSync(join(proj, "package.json"), "{\"name\":\"bench\"}\n");
  writeFileSync(join(proj, "bun.lock"), "{}\n");
  await world({ cwd: proj }, async (w) => {
    const sit0 = w.svc.situate({ format: "anthropic", body: { model: "m", system: `<env>\nWorking directory: ${proj}\n</env>`, messages: [{ role: "user", content: "hello" }] }, headers: { ...CC_UA, "x-session-id": "seed" }, model: "m" });
    const projectId = sit0.project.id;
    const seedChain = (await w.svc.prepare(sit0, { requestId: "seed" })).chain;
    const brain = w.svc.brain;
    for (let i = 0; i < CLAIMS; i++) {
      const [kind, origin] = KINDS[i % KINDS.length];
      const n = pick(NOUNS), m = pick(NOUNS), v = pick(VERBS);
      let text = `The ${n} ${v} the ${m} before step ${i}.`;
      if (i % 7 === 0) text = `src/mod${i % FILES}.js exports the ${n} helper that ${v} the ${m}.`;
      if (i % 50 === 0) text = `This project uses pnpm as its package manager (${i}).`;
      if (i % 53 === 0) text = `This project is checked out at D:\\old\\bench${i} and builds there.`;
      brain.addItem({ projectId, chainId: seedChain, kind, text, status: origin === "person" ? "confirmed" : "inferred", importance: 0.7, origin });
    }
    await w.settle();
    const times = { briefing: [], turn: [] };
    for (let s = 0; s < SESSIONS; s++) {
      const history = [];
      for (let t = 0; t < TURNS; t++) {
        const text = `how does the ${pick(NOUNS)} ${pick(VERBS)} the ${pick(NOUNS)} in src/mod${Math.floor(rand() * FILES)}.js?`;
        const messages = [...history, { role: "user", content: text }];
        const req = { format: "anthropic", body: { model: "m", max_tokens: 100, system: `You are Claude Code.\n<env>\nWorking directory: ${proj}\nIs a git repo: yes\nPlatform: win32\n</env>`, messages }, headers: { ...CC_UA, "x-session-id": `bench-${s}` }, model: "m" };
        const sit = w.svc.situate(req);
        const t0 = performance.now();
        const prep = await w.svc.prepare(sit, { requestId: `b-${s}-${t}` });
        (t === 0 ? times.briefing : times.turn).push(performance.now() - t0);
        w.svc.afterReply({ chainId: prep.chain, turnId: prep.turn, requestId: `b-${s}-${t}`, finalMessage: { role: "assistant", content: [{ type: "text", text: "Done." }] }, replyText: "Done.", injectedIds: prep.ids, outputChars: 5 });
        history.push({ role: "user", content: text }, { role: "assistant", content: "Done." });
      }
    }
    const stat = (xs) => {
      const a = [...xs].sort((x, y) => x - y);
      const at = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
      return { n: a.length, median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), worst: +a.at(-1).toFixed(2) };
    };
    console.log(JSON.stringify({ claims: CLAIMS, files: FILES, sessions: SESSIONS, turns: TURNS, briefing: stat(times.briefing), turn: stat(times.turn), all: stat([...times.briefing, ...times.turn]) }, null, 1));
  });
} finally {
  rmSync(proj, { recursive: true, force: true });
}
