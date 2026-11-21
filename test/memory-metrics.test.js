// Memory metrics (HarnessV3-Memory MD-19, M3-1): stories on the eval world, each declaring its truth, counted over
// every session of every story — what the model was shown that it should not have been, and what it was not shown that
// it should have been. Only the blocks a request ADDED are counted (the briefing on a session's first request, the turn
// block on its newest message, the reminders on a tool result), so a line re-attached for the cache is not counted
// twice. A story's agent calls (M5) count the mistakes made again without their reminder, and the reminders on calls
// that made none.
//
// The counts are a ratchet in test/fixtures/memory-metrics.json: a count may only fall, and a fall fails this file
// until the baseline is lowered (FILAMENT_METRICS_WRITE=1 writes the measured numbers). Memory tokens per turn may rise
// 10%. Blocking time is the bench's (scripts/memory-hotpath-bench.mjs): timing in a test is noise (M3-D10).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { world } from "./fixtures/memory-world.mjs";
import { MERGE_PROMPT, KEY_PROMPT } from "../src/services/memory/curator.js";

const BASELINE_FILE = fileURLToPath(new URL("./fixtures/memory-metrics.json", import.meta.url));
const BASELINE = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
const COUNTS = ["stale", "pairs", "rulesLost", "truthLost", "repeated", "misfired"];
const BLOCK = /<filament-memory kind="([^"]+)">\n([\s\S]*?)\n<\/filament-memory>/g;
/** A claim line the model was shown: its label (id, kind, trust, flags) and its words. */
const CLAIM = /^- \[(i\d+ [^\]]*)\] (.*)$/;
/** A label that tells the model not to take the line as current. */
const FLAGGED = /changed since|contested|file gone|in question/;

/** The memory blocks in a text, by kind. @param {unknown} s */
const blocksIn = (s) => [...String(s ?? "").matchAll(BLOCK)].map((m) => ({ kind: m[1], text: m[2] }));
const textOf = (content) => (typeof content === "string" ? content : (content || []).map((b) => b?.text || "").join("\n"));
/** The claim lines of some block texts. @param {string[]} texts */
const claimsIn = (texts) =>
  texts.flatMap((t) => t.split("\n")).flatMap((l) => {
    const m = CLAIM.exec(l);
    return m ? [{ label: m[1], text: m[2], flagged: FLAGGED.test(m[1]) }] : [];
  });

/**
 * One story, measured: run on a fresh world (in a fresh project folder when it has files), then counted.
 * @param {Story} story
 */
async function measure(story) {
  const dir = story.files ? mkdtempSync(join(tmpdir(), "filament-metrics-")) : null;
  try {
    if (dir) for (const [p, body] of Object.entries(story.files || {})) {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), body);
    }
    // A story with a curator has memory's model, which the curator works with: the story's handlers answer the merge and key prompts, and every other
    // prompt is answered with nothing (no slot, no pair, no dossier).
    const cur = story.curator;
    const handler = (/** @type {string} */ system) => (system === MERGE_PROMPT ? cur?.merge : system === KEY_PROMPT ? cur?.key : null);
    const callModel = cur ? async (/** @type {any} */ a) => JSON.stringify(handler(a.system)?.(a.user) ?? { slots: [], pairs: [], sections: [] }) : null;
    return await world({ cwd: dir || story.cwd || "C:\\evals", models: cur ? { summarizer: "judge" } : {}, callModel }, async (w) => {
      const sessions = new Map();
      /** @type {Map<string, { briefing: string[], added: string[] }>} */
      const shown = new Map();
      let tokens = 0,
        sends = 0,
        repeated = 0,
        misfired = 0;
      const send = async (/** @type {string} */ id, /** @type {string} */ text, /** @type {Keep | null} */ keep = null) => {
        if (!sessions.has(id)) sessions.set(id, w.session(id));
        const first = !shown.has(id);
        const s = shown.get(id) || { briefing: [], added: [] };
        shown.set(id, s);
        const { r, sit, prep } = await sessions.get(id).send(text);
        if (keep) {
          const at = { by: "model", quote: keep.claim, projectId: prep.project, chainId: prep.chain, turnId: prep.turn };
          const old = keep.corrects ? w.svc.archive.items.list({}).find((/** @type {any} */ it) => it.text.includes(keep.corrects) && !["dismissed", "superseded"].includes(it.status)) : null;
          const kept = old ? await w.svc.brain.correct(`i${old.id}`, { text: keep.claim, ...at }) : await w.svc.brain.remember(keep.claim, { kind: keep.kind || "fact", ...at });
          assert.ok(kept.heard, `the agent's quote is heard: ${JSON.stringify(kept)}`);
          await w.settle();
        }
        const briefing = first ? blocksIn(textOf(r.body.system)).filter((b) => b.kind === "briefing").map((b) => b.text) : [];
        const turn = blocksIn(textOf(r.body.messages.at(-1).content)).filter((b) => b.kind === "turn").map((b) => b.text);
        s.briefing.push(...briefing);
        s.added.push(...briefing, ...turn);
        tokens += Math.ceil([...briefing, ...turn].join("\n").length / 4);
        sends++;
        return sit;
      };
      const loops = new Map();
      /**
       * One shell call of a Claude Code session, its ask the session's first turn: `due`, the words of the reminder the
       * call must carry (it makes a known mistake again); without, it must carry none.
       * @param {string} id @param {string} command @param {{ error?: string, due?: string }} [o]
       */
      const act = async (id, command, { error = "", due = "" } = {}) => {
        if (!loops.has(id)) {
          const loop = w.claudeCode(id);
          loops.set(id, loop);
          const { body } = await loop.start();
          const added = [...blocksIn(textOf(body.body.system)).filter((b) => b.kind === "briefing"), ...blocksIn(textOf(body.body.messages.at(-1).content)).filter((b) => b.kind === "turn")];
          tokens += Math.ceil(added.map((b) => b.text).join("\n").length / 4);
          sends++;
        }
        const { body } = await loops.get(id).ran("Bash", { command }, { error });
        const reminders = blocksIn(textOf(body.body.messages.at(-1).content)).filter((b) => b.kind === "rule").map((b) => b.text);
        tokens += Math.ceil(reminders.join("\n").length / 4);
        const lines = reminders.join("\n").split("\n").filter((l) => l.startsWith("- [memory i"));
        if (due && !lines.some((l) => l.includes(due))) repeated++;
        if (!due && lines.length) misfired++;
      };
      await story.run({ send, act, w, dir });
      const m = { stale: 0, pairs: 0, rulesLost: 0, truthLost: 0, repeated, misfired, tokensPerTurn: sends ? Math.round(tokens / sends) : 0 };
      for (const [id, needles] of Object.entries(story.stale || {}))
        for (const c of claimsIn(shown.get(id)?.added || [])) if (!c.flagged && needles.some((n) => c.text.includes(n))) m.stale++;
      for (const [, s] of shown) {
        const lines = claimsIn(s.added).filter((c) => !c.flagged);
        for (const [a, b] of story.pairs || []) if (lines.some((c) => c.text.includes(a)) && lines.some((c) => c.text.includes(b))) m.pairs++;
      }
      for (const [id, needles] of Object.entries(story.rules || {})) {
        const lines = claimsIn(shown.get(id)?.briefing || []);
        for (const n of needles) if (!lines.some((c) => c.text.includes(n))) m.rulesLost++;
      }
      for (const [id, needles] of Object.entries(story.truth || {})) {
        const lines = claimsIn(shown.get(id)?.added || []);
        for (const n of needles) if (!lines.some((c) => c.text.includes(n))) m.truthLost++;
      }
      return m;
    });
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @typedef {object} Story
 * @property {string} name
 * @property {string} [cwd]  the working folder, when the story needs no files
 * @property {Record<string, string>} [files]  files of a fresh project folder, which becomes the working folder
 * @property {(o: { send: (id: string, text: string, keep?: Keep | null) => Promise<any>, act: (id: string, command: string, o?: { error?: string, due?: string }) => Promise<void>, w: any, dir: string | null }) => Promise<void>} run
 *   `send` returns the session's situation, `keep` what its agent keeps of the message; `act` is an agent's shell call
 *   (repeated, misfired)
 * @property {{ merge?: (user: string) => any, key?: (user: string) => any }} [curator]  the curator's model, by prompt
 * @property {Record<string, string[]>} [stale]  per session: words that must not be served as current there
 * @property {[string, string][]} [pairs]  words that must not be served together in one session
 * @property {Record<string, string[]>} [rules]  per session: the user's rules its briefing must carry
 * @property {Record<string, string[]>} [truth]  per session: words that must be served there
 */
/**
 * What a session's agent keeps of a message with its memory tools, quoting the person (the memory plan's d3: memory files
 * nothing from a message by its words): `kind` and `claim`, a claim of theirs; `corrects` and `claim`, the new words of
 * the standing claim that holds `corrects`. The quote is the claim's words, as the message has them.
 * @typedef {{ kind?: string, corrects?: string, claim: string }} Keep
 */
/** @type {Story[]} */
const STORIES = [
  {
    name: "a corrected region",
    async run({ send }) {
      await send("a", "remember that the staging server is in region eu-west-2.", { claim: "the staging server is in region eu-west-2" });
      await send("b", "no, the staging server is in region eu-central-1 now.", { corrects: "eu-west-2", claim: "the staging server is in region eu-central-1 now" });
      await send("c", "which region is the staging server in?");
    },
    stale: { c: ["eu-west-2"] },
    pairs: [["eu-west-2", "eu-central-1"]],
    truth: { c: ["eu-central-1"] },
  },
  {
    name: "a neighbour that shares the subject",
    async run({ send }) {
      await send("a", "remember that the staging server uses nginx as its reverse proxy.", { claim: "the staging server uses nginx as its reverse proxy" });
      await send("a2", "remember that the staging server is in region eu-west-2.", { claim: "the staging server is in region eu-west-2" });
      await send("b", "no, the staging server is in region eu-central-1 now.", { corrects: "eu-west-2", claim: "the staging server is in region eu-central-1 now" });
      await send("c", "which reverse proxy does the staging server use?");
    },
    truth: { c: ["nginx"] },
  },
  {
    name: "a package manager switched by a correction",
    async run({ send }) {
      await send("a", "I always use pnpm for package installs in this project", { kind: "preference", claim: "I always use pnpm for package installs in this project" });
      await send("b", "no, we switched to bun for installs now", { corrects: "pnpm", claim: "we switched to bun for installs now" });
      await send("c", "which tool do we use for package installs?");
    },
    stale: { c: ["pnpm"] },
    pairs: [["pnpm", "bun"]],
    truth: { c: ["bun"] },
  },
  {
    name: "a command is not a package manager",
    async run({ send }) {
      await send("a", "I always use pnpm for package installs in this project", { kind: "preference", claim: "I always use pnpm for package installs in this project" });
      await send("b", "no, don't run npm test directly in this shell; run it as env -u CLAUDECODE npm test.", { kind: "rule", claim: "don't run npm test directly in this shell; run it as env -u CLAUDECODE npm test" });
      await send("c", "which tool do we use for package installs?");
    },
    truth: { c: ["pnpm"] },
  },
  {
    name: "a file changed under a fact about it",
    files: { "src/config.js": "export function loadConfig() { return JSON.parse(read('settings.json')); }\n" },
    async run({ send, dir }) {
      await send("a", "remember that src/config.js exports loadConfig, which reads settings.json.", { claim: "src/config.js exports loadConfig, which reads settings.json" });
      writeFileSync(join(/** @type {string} */ (dir), "src", "config.js"), "export function readSettings() { return JSON.parse(read('settings.yaml')); }\n");
      await send("b", "what does src/config.js export and which settings file does it read?");
    },
    stale: { b: ["exports loadConfig"] },
  },
  {
    name: "a file deleted under a fact about it",
    files: { "src/legacy.js": "export function importCsv() {}\n", "src/main.js": "export {};\n" },
    async run({ send, dir }) {
      await send("a", "remember that src/legacy.js holds the old CSV importer.", { claim: "src/legacy.js holds the old CSV importer" });
      unlinkSync(join(/** @type {string} */ (dir), "src", "legacy.js"));
      await send("b", "where does the old CSV importer live?");
    },
    stale: { b: ["src/legacy.js"] },
  },
  {
    name: "an untouched file keeps its fact",
    files: { "src/server.js": "export function listen(port) {}\n" },
    async run({ send }) {
      await send("a", "remember that src/server.js exports listen, which takes the port.", { claim: "src/server.js exports listen, which takes the port" });
      await send("b", "what does src/server.js export?");
    },
    truth: { b: ["exports listen"] },
  },
  {
    name: "a folder the environment contradicts",
    cwd: "C:\\proj",
    async run({ send }) {
      await send("a", "remember that this project is checked out at D:\\old\\proj and builds there.", { claim: "this project is checked out at D:\\old\\proj and builds there" });
      await send("b", "where is this project checked out and where does it build?");
    },
    stale: { b: ["D:\\old\\proj"] },
  },
  {
    name: "another folder is not this project's",
    cwd: "C:\\proj",
    async run({ send }) {
      await send("a", "remember that the team's notes vault lives at D:\\vault\\notes.", { claim: "the team's notes vault lives at D:\\vault\\notes" });
      await send("b", "where does the team's notes vault live?");
    },
    truth: { b: ["D:\\vault\\notes"] },
  },
  {
    name: "a lockfile names the package manager",
    files: { "package.json": "{\"name\":\"x\"}\n", "bun.lock": "{}\n" },
    async run({ send }) {
      await send("a", "remember that this project uses pnpm as its package manager.", { claim: "this project uses pnpm as its package manager" });
      await send("b", "which package manager does this project use?");
    },
    stale: { b: ["uses pnpm"] },
  },
  {
    name: "the user's rules are never crowded out",
    async run({ send }) {
      await send("r1", "remember that you must never force-push to the main branch.", { kind: "rule", claim: "you must never force-push to the main branch" });
      await send("r2", "remember that you must always run the linter before a commit.", { kind: "rule", claim: "you must always run the linter before a commit" });
      for (let i = 1; i <= 14; i++) await send(`f${i}`, `remember that deploy pipeline step ${i} uploads the bundle to bucket deploy-${i}.`, { claim: `deploy pipeline step ${i} uploads the bundle to bucket deploy-${i}` });
      await send("z", "let's work on the deploy pipeline steps and where each uploads the bundle");
    },
    rules: { z: ["force-push", "linter"] },
  },
  {
    // M4-2: one fact said in two sessions in other words is one line after the curator's pass, not two. The judge says
    // "the same" only for the two wordings about the build's output.
    name: "one fact said twice in other words, after the curator's pass",
    curator: { merge: (u) => ({ pairs: [...u.matchAll(/^(\d+)\. A: .*\n {3}B: .*$/gm)].map((m) => ({ n: Number(m[1]), same: (m[0].match(/the dist folder/g) || []).length === 2 })) }) },
    async run({ send, w }) {
      await send("a", "remember that the build output goes to the dist folder at the repo root.", { claim: "the build output goes to the dist folder at the repo root" });
      const sit = await send("b", "remember that the build artifacts land in the dist folder at the repo root.", { claim: "the build artifacts land in the dist folder at the repo root" });
      await w.svc.curator.run(sit.project.id);
      await send("c", "where does the build put its output and its artifacts?");
    },
    pairs: [["output goes", "artifacts land"]],
    truth: { c: ["the dist folder"] },
  },
  {
    // M4-6: two values the user said for one thing are keyed to one slot by the curator, which asks the user rather
    // than retire their word; until they answer, the older one is served marked in question, never as current beside
    // the newer.
    name: "two values the user said for one thing, while memory asks",
    curator: { key: (u) => ({ slots: [...u.matchAll(/^(\d+)\. .*port (\d{4})/gm)].map((m) => ({ n: Number(m[1]), subject: "api", attribute: "port", value: m[2] })) }) },
    async run({ send, w }) {
      const sit = await send("a", "remember that the api listens on port 3000.", { claim: "the api listens on port 3000" });
      await send("b", "remember that the api listens on port 8080 now.", { claim: "the api listens on port 8080 now" });
      const old = w.svc.archive.items.list({}).find((/** @type {any} */ it) => it.text.includes("3000"));
      w.svc.archive.db.prepare("UPDATE items SET created_at = created_at - 60000 WHERE id = ?").run(old.id);
      await w.svc.curator.run(sit.project.id);
      await send("c", "which port does the api listen on?");
    },
    pairs: [["port 3000", "port 8080"]],
    truth: { c: ["port 8080"] },
  },
  {
    // M5: a mistake is told on the call that makes it again: the user's own correction at once, a failure the agent
    // worked around once two sessions saw it. A call done the right way, or another call of the same shape, carries
    // nothing.
    name: "a mistake is not made again without its reminder",
    async run({ send, act }) {
      await send("u", "no, never run git push --force on this repo; use git push --force-with-lease instead.", { kind: "rule", claim: "never run git push --force on this repo; use git push --force-with-lease instead" });
      const refused = { error: "Exit code 1\n> app test\nError: CLAUDECODE is set, refusing to run" };
      for (const id of ["a", "b"]) {
        await act(id, "npm test", refused);
        await act(id, "env -u CLAUDECODE npm test");
      }
      await act("c", "npm test", { ...refused, due: "`env -u CLAUDECODE npm test` worked" });
      await act("c", "env -u CLAUDECODE npm test");
      await act("c", "npm test -- --grep slow", { due: "`env -u CLAUDECODE npm test` worked" });
      await act("c", "git push origin main");
      await act("c", "git push --force origin main", { due: "--force-with-lease" });
      await act("c", "git push --force-with-lease origin main");
      await act("c", "npm run build");
    },
  },
];

const measured = {};
for (const story of STORIES)
  test(`metrics: ${story.name}`, async (t) => {
    const m = await measure(story);
    measured[story.name] = m;
    t.diagnostic(JSON.stringify(m));
    if (process.env.FILAMENT_METRICS_WRITE) return;
    const base = BASELINE[story.name];
    assert.ok(base, `no baseline for "${story.name}": run with FILAMENT_METRICS_WRITE=1`);
    for (const k of COUNTS) {
      assert.ok(m[k] <= base[k], `${k} rose from ${base[k]} to ${m[k]}`);
      assert.ok(m[k] >= base[k], `${k} fell from ${base[k]} to ${m[k]}: lower the baseline (FILAMENT_METRICS_WRITE=1)`);
    }
    assert.ok(m.tokensPerTurn <= Math.ceil(base.tokensPerTurn * 1.1) + 2, `memory tokens per turn rose from ${base.tokensPerTurn} to ${m.tokensPerTurn}`);
  });

test("metrics: every story has a baseline, and the baseline names no story that is gone", () => {
  if (process.env.FILAMENT_METRICS_WRITE) return;
  assert.deepEqual(Object.keys(BASELINE).sort(), STORIES.map((s) => s.name).sort());
});

after(() => {
  if (!process.env.FILAMENT_METRICS_WRITE) return;
  const ordered = Object.fromEntries(STORIES.map((s) => [s.name, measured[s.name]]).filter(([, m]) => m));
  writeFileSync(BASELINE_FILE, JSON.stringify(ordered, null, 2) + "\n");
});
