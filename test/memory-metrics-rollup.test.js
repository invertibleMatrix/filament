// @ts-check
// The memory plan's b4: memory's use judged from what the agent did, not only from what it said, and metrics that last.
// Before, a memory counted as used only when the reply's prose repeated a phrase of it: a rule obeyed in a command
// ("Use pnpm" → `pnpm install`) was never used and faded; a memory the agent went back to search for was not credited;
// and the only figures were the benchmark's, the last requests a process held. Now the turn's tool calls count — a word
// of the memory that is rare across memory, carried by a call — a search that finds a memory the session was shown
// credits that showing, each memory's showings and uses are counted over a window, and a rollup by layer and day is read
// from the injection log on disk, served at GET /api/memory/metrics and drawn on Memory → Activity.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/services/memory/archive.js";
import { MemoryBrain, termsOf, usedInWork, workTermsOf } from "../src/services/memory/brain.js";
import { memoryHandle } from "../src/services/memory/port.js";
import { memoryMetrics, originGroup } from "../src/services/memory/metrics.js";
import { memoryRoutes } from "../src/http/admin/memory.js";
import { createRouter } from "../src/http/router.js";
import { metricsView } from "../src/ui/lib/memory-metrics.js";

const DAY = 86400_000;
const NOW = Date.UTC(2026, 10, 7, 12);

/**
 * An archive and a brain on a fresh folder, on a clock the test holds. @param {(t: { archive: Archive, brain: any, clock: { now: number } }) => Promise<void> | void} body
 */
const withBrain = async (body) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-metrics-"));
  const clock = { now: NOW };
  const archive = new Archive({ file: join(dir, "a.db"), now: () => clock.now });
  const brain = /** @type {any} */ (new MemoryBrain(/** @type {any} */ ({ archive, getConfig: () => ({}), now: () => clock.now })));
  try {
    await body({ archive, brain, clock });
  } finally {
    brain.stop();
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
};
/** A claim filed, and its ref. @param {Archive} archive @param {string} text @param {any} [o] */
const claim = (archive, text, o = {}) => `i${archive.items.add({ projectId: "p", kind: "fact", text, ...o }).id}`;
/** A turn's tool calls, as the loop hands them to memory. @param {...[string, any]} calls */
const work = (...calls) => [{ role: "assistant", content: calls.map(([name, input], i) => ({ type: "tool_use", id: `t${i}`, name, input })) }];
/** A request shown these, judged at its reply. @param {any} brain @param {Archive} archive @param {string} req @param {[string, string][]} pairs @param {{ reply?: string, workMessages?: any[], chain?: string, kind?: string }} [o] */
const shownThenReplied = (brain, archive, req, pairs, { reply = "Done.", workMessages = [], chain = "c", kind = "turn" } = {}) => {
  archive.injections.add({ requestId: req, chainId: chain, turnId: 1, kind, ids: pairs.map(([id]) => id), tokens: 40 });
  brain.noteInjected(req, pairs);
  brain.afterReply({ chainId: chain, turnId: null, requestId: req, replyText: reply, workMessages, injectedIds: pairs.map(([id]) => id) });
  return archive.injections.forRequest(req)[0];
};
/** Whether one id of a request was judged used. @param {Archive} archive @param {string} chain @param {string} ref */
const usedOf = (archive, chain, ref) => archive.injections.ofTurn(chain, 1).flatMap((x) => x.ids).filter((x) => x.ref === ref).map((x) => x.used);

describe("use judged from what the agent did", () => {
  // (fails before: yes — only the reply's prose was read: a rule obeyed in a command was "not used", and faded)
  test("a rule applied only in a bash command counts as used; a common word in a command does not; memory's own tools never do", async () => {
    await withBrain(({ archive, brain }) => {
      const rule = "Use pnpm, never npm, for this repo's packages.";
      const ref = claim(archive, rule, { kind: "rule" });
      // Five claims that say "tests": a word that common is no evidence a claim was acted on.
      const tests = claim(archive, "Run the tests before every commit.");
      for (let n = 0; n < 4; n++) claim(archive, `The tests of module ${n} run under node --test.`);
      const r = shownThenReplied(brain, archive, "r1", [[ref, rule], [tests, "Run the tests before every commit."]], { reply: "Installed the packages and ran them.", workMessages: work(["bash", { command: "pnpm install && npm run tests" }]) });
      assert.equal(r.used, true, "the request used memory");
      assert.deepEqual(usedOf(archive, "c", ref), [true], "the rule obeyed in the command is used");
      assert.deepEqual(usedOf(archive, "c", tests), [false], "\"tests\" is in five claims: not rare, no use");
      assert.equal(archive.injections.neverUsedCount(ref), 0);
      // A search for it is no use of it: memory's own tools are left out of the work.
      const quiet = shownThenReplied(brain, archive, "r2", [[ref, rule]], { reply: "Nothing to do.", workMessages: work(["filament_memory_search", { query: "pnpm" }]), chain: "c2" });
      assert.equal(quiet.used, false);
      assert.equal(archive.injections.neverUsedCount(ref), 1);
    });
  });

  test("the words of the work: commands, paths and short strings, in any script; a file's body and memory's tools left out", () => {
    assert.deepEqual(termsOf("Use `pnpm` in src/vendor/csv.js — ведомость 帳簿"), ["use", "pnpm", "src", "vendor", "csv", "ведомость", "帳簿"]);
    const terms = workTermsOf([
      ...work(["bash", { command: "pnpm install" }], ["write", { path: "CHANGELOG.md", content: `${"x ".repeat(1500)}secretword` }], ["mcp__filament__filament_memory_search", { query: "zebra" }]),
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t0", content: "added 12 packages" }] },
    ]);
    assert.ok(terms.has("pnpm") && terms.has("changelog"));
    assert.ok(!terms.has("secretword"), "a file's body is no command");
    assert.ok(!terms.has("zebra"), "memory's own tools are left out");
    assert.ok(!terms.has("packages"), "what a call returned is no work of the agent's");
    assert.equal(usedInWork("Use pnpm here", terms, () => true), true);
    assert.equal(usedInWork("Use pnpm here", terms, () => false), false, "a word that is not rare decides nothing");
  });
});

describe("a search that finds what the session was shown", () => {
  // (fails before: yes — only the agent's confirm credited a memory; a search that found it again counted for nothing)
  test("credits that showing in that session alone, and the reply's verdict does not take it back", async () => {
    await withBrain(async ({ archive, brain }) => {
      const a = claim(archive, "The staging server runs in eu-west-2.");
      const b = claim(archive, "The release branch is cut on Thursdays.");
      const elsewhere = claim(archive, "Invoices are numbered per year.");
      archive.injections.add({ requestId: "r1", chainId: "c", turnId: 1, kind: "turn", ids: [a, b], tokens: 30 });
      brain.noteInjected("r1", [[a, "The staging server runs in eu-west-2."], [b, "The release branch is cut on Thursdays."]]);
      archive.injections.add({ requestId: "o1", chainId: "other", turnId: 1, kind: "turn", ids: [elsewhere], tokens: 10 });
      brain.search = async () => /** @type {any} */ ([{ id: a, text: "x" }, { id: elsewhere, text: "y" }, { id: "i999", text: "z" }]);
      const handle = memoryHandle(/** @type {any} */ ({ brain, archive, archiveWhy: () => "" }), { role: "model", project: "p", chain: "c" });
      const found = await handle.search("staging");
      assert.equal(found.length, 3, "the search answers as before");
      assert.deepEqual(usedOf(archive, "c", a), [true], "shown in this session, found again: used");
      assert.deepEqual(usedOf(archive, "c", b), [null], "not found: not judged yet");
      assert.equal(archive.injections.ofTurn("other", 1)[0].ids[0].used, null, "another session's showing is not this one's");
      // The turn ends on a reply that echoes neither: the search's credit stands, and the request used memory.
      brain.afterReply({ chainId: "c", turnId: null, requestId: "r1", replyText: "Done.", injectedIds: [a, b] });
      assert.deepEqual([usedOf(archive, "c", a), usedOf(archive, "c", b)], [[true], [false]]);
      assert.equal(archive.injections.forRequest("r1")[0].used, true);
    });
  });
});

describe("per-memory counts and the rollup", () => {
  // (fails before: yes — nothing counted a memory's showings and uses over a window)
  test("each memory's showings, judged and used, over a window", async () => {
    await withBrain(({ archive, brain, clock }) => {
      const a = claim(archive, "The staging server runs in eu-west-2.");
      clock.now = NOW - 40 * DAY;
      shownThenReplied(brain, archive, "old", [[a, "The staging server runs in eu-west-2."]], { reply: "It runs in eu-west-2." });
      clock.now = NOW;
      shownThenReplied(brain, archive, "r1", [[a, "The staging server runs in eu-west-2."]], { reply: "Yes: the staging server runs in eu-west-2." });
      shownThenReplied(brain, archive, "r2", [[a, "The staging server runs in eu-west-2."]], { reply: "Done." });
      archive.injections.add({ requestId: "r3", chainId: "c", turnId: 2, kind: "turn", ids: [a], tokens: 5 });
      assert.deepEqual(Object.fromEntries(brain.useCounts([a, "i999"], 30)), { [a]: { shown: 3, judged: 2, used: 1 } });
      assert.deepEqual(brain.useCounts([a], 60).get(a), { shown: 4, judged: 3, used: 2 });
    });
  });

  // (fails before: yes — there was no rollup: the benchmark read the last requests a process held, gone at a restart)
  test("by layer and day from the log on disk: used rates, tokens a turn, showings again, whose memories, corrected, fading", async () => {
    await withBrain(async ({ archive, brain, clock }) => {
      const person = claim(archive, "Deploys go through the release checklist.", { origin: "person", kind: "rule" });
      const learned = claim(archive, "The ledger exports CSV with a header row.", { origin: "learner" });
      const found = claim(archive, "Fixtures live under test/fixtures.", { origin: "subagent" });
      const wrong = claim(archive, "The API server listens on port 3000.", { origin: "learner" });
      const quietFact = claim(archive, "The logo is blue.", { origin: "learner" });
      const quietRule = claim(archive, "Write commit messages in English.", { origin: "person", kind: "rule" });
      archive.items.setStatus(Number(wrong.slice(1)), "superseded", { by: "person", reason: "port 4000 now" });
      clock.now = NOW - 2 * DAY;
      const day1 = archive.injections.add({ requestId: "b1", chainId: "c1", turnId: 1, kind: "briefing", ids: [person, learned, wrong], tokens: 300 });
      archive.injections.markUsed("b1", 1, [person]);
      archive.injections.add({ requestId: "t1", chainId: "c1", turnId: 2, kind: "turn", ids: [learned, found], tokens: 60 });
      archive.injections.markUsed("t1", 1, [found]);
      clock.now = NOW - DAY;
      archive.injections.add({ requestId: "t2", chainId: "c1", turnId: 3, kind: "turn", ids: [learned], tokens: 40 });
      archive.injections.markUsed("t2", 0, []);
      archive.injections.add({ requestId: "p1", chainId: "c1", turnId: 3, kind: "pitfall", ids: [found], tokens: 20 });
      // Three judged showings unused in a row: the fact fades, the rule never does.
      for (const [n, ref] of /** @type {string[]} */ ([quietFact, quietFact, quietFact, quietRule, quietRule, quietRule]).entries()) {
        archive.injections.add({ requestId: `q${n}`, chainId: `cq${n}`, turnId: 1, kind: "turn", ids: [ref], tokens: 10 });
        archive.injections.markUsed(`q${n}`, 0, []);
      }
      clock.now = NOW;
      assert.ok(day1 > 0);
      const m = brain.metrics(30);
      const layer = (/** @type {string} */ k) => /** @type {any} */ (m.layers.find((L) => L.layer === k));
      assert.deepEqual(m.layers.map((L) => L.layer), ["briefing", "turn", "pitfall"], "in the page's order");
      assert.deepEqual(layer("briefing"), { layer: "briefing", injections: 1, shown: 3, judged: 3, used: 1, tokens: 300, again: 0, usedRate: 0.333, turns: 1, tokensPerTurn: 300 });
      // Turn blocks: t1 (learned shown again after the briefing, found used), t2 (learned again, unused), and the six quiet ones.
      assert.deepEqual(layer("turn"), { layer: "turn", injections: 8, shown: 9, judged: 9, used: 1, tokens: 160, again: 2, usedRate: 0.111, turns: 8, tokensPerTurn: 20 });
      assert.deepEqual(layer("pitfall"), { layer: "pitfall", injections: 1, shown: 1, judged: 0, used: 0, tokens: 20, again: 1, usedRate: null, turns: 1, tokensPerTurn: 20 });
      assert.deepEqual(m.daily.map((d) => [d.shown, d.used]), [[5, 2], [8, 0]]);
      assert.deepEqual(
        m.origins.map((o) => [o.origin, o.shown, o.judged, o.used]),
        [["person", 4, 4, 1], ["finding", 2, 1, 1], ["learner", 7, 7, 0]],
      );
      assert.deepEqual(m.corrected, { shown: 6, corrected: 1, rate: 0.167 }, "the port claim was served, then corrected");
      assert.equal(m.faded, 2, "the quiet fact fades, and the ledger's (unused in the briefing, t1 and t2); the rule stands");
      // Served from disk: a new brain on the same archive reads the same.
      const again = /** @type {any} */ (new MemoryBrain(/** @type {any} */ ({ archive, getConfig: () => ({}), now: () => clock.now })));
      assert.deepEqual(again.metrics(30), m);
      again.stop();
      // The window keeps to its days: yesterday's turn block, pitfall and quiet showings, not the briefing before them.
      assert.deepEqual(brain.metrics(1).layers.map((L) => [L.layer, L.shown]), [["turn", 7], ["pitfall", 1]]);
      // The route, as the console reads it.
      const route = createRouter(memoryRoutes(/** @type {any} */ ({ memory: { isOpen: () => true, metrics: (/** @type {any} */ o) => brain.metrics(o.days), archiveWhy: () => "" }, usage: {} })));
      const call = async (/** @type {string} */ q) => {
        const url = new URL(`http://x/api/memory/metrics${q}`);
        const hit = /** @type {any} */ (route("GET", "/memory/metrics"));
        const out = { status: 0, body: /** @type {any} */ (null) };
        await hit.handler({ res: { writableEnded: false, destroyed: false, writeHead: (/** @type {number} */ s) => (out.status = s), end: (/** @type {string} */ b) => (out.body = JSON.parse(b)) }, url, path: url.pathname, params: hit.params, json: async () => null }, {});
        return out;
      };
      assert.deepEqual((await call("?days=30")).body, JSON.parse(JSON.stringify(m)));
      assert.deepEqual(await call("?days=0"), { status: 400, body: { error: "days is a whole number from 1 to 365" } });
    });
  });

  test("whose memories, by origin; the panel's words", () => {
    assert.deepEqual(["person", "owner", "correction", "model", "agent", "subagent", "learner", "import", null].map(originGroup), ["person", "person", "person", "agent", "finding", "finding", "learner", "other", "other"]);
    const v = metricsView({
      days: 30,
      layers: [{ layer: "briefing", shown: 1200, judged: 1000, used: 250, usedRate: 0.25, tokens: 41000, tokensPerTurn: 820, again: 0 }, { layer: "pitfall", shown: 3, judged: 0, used: 0, usedRate: null, tokens: 60, tokensPerTurn: 20, again: 1 }],
      origins: [{ origin: "person", shown: 10, judged: 8, used: 6, usedRate: 0.75 }, { origin: "finding", shown: 2, judged: 0, used: 0, usedRate: null }],
      corrected: { shown: 40, corrected: 2, rate: 0.05 },
      faded: 1,
    });
    assert.deepEqual(v.rows, [
      { layer: "Briefing", shown: "1,200", used: "250 of 1,000", rate: "25%", tokens: "41,000", perTurn: "820", again: "–" },
      { layer: "Pitfall on a tool call", shown: "3", used: "not judged", rate: "–", tokens: "60", perTurn: "20", again: "1" },
    ]);
    assert.deepEqual(v.lines, [
      "Used, by whose memory it is: your word 75% of 8",
      "Served, then corrected: 2 of the 40 memories shown (5%)",
      "Fading now: 1 memory whose last three showings went unused, left out of turn blocks until one is used",
    ]);
    assert.equal(metricsView({ days: 7, layers: [] }).empty, "Memory showed nothing in the last 7 days.");
    assert.deepEqual(memoryMetrics({ injections: [], ids: [], items: [] }, { since: 0, days: 30 }), { since: 0, days: 30, layers: [], daily: [], origins: [], corrected: { shown: 0, corrected: 0, rate: null }, faded: 0 });
  });
});
