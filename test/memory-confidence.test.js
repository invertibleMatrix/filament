// @ts-check
// Confidence, the constitution and labels (HarnessV3-Memory M3-6, MD-3, M3-D8, M3-D9): how sure memory is of a claim
// weighs its rank and gates the autopilot; the user's own rules open the briefing and are never crowded out; a line says
// how many sessions said it; a turn block carries at most two quotes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confidenceOf } from "../src/services/memory/brain.js";
import { localDay } from "../src/services/daily-usage.js";
import { world, memoryLines, servedAs } from "./fixtures/memory-world.mjs";

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 2);
/** A claim as the archive holds it, said `days` ago. @param {Record<string, any>} o @param {number} [days] */
const claim = (o, days = 0) => ({ kind: "fact", status: "inferred", origin: "learner", ...o, created_at: NOW - days * DAY });
const round = (/** @type {number} */ x) => Math.round(x * 1000) / 1000;
/** The memory block of a kind in a text. @param {string} seen @param {string} kind */
const block = (seen, kind) => new RegExp(`<filament-memory kind="${kind}">\\n([\\s\\S]*?)\\n</filament-memory>`).exec(seen)?.[1] ?? "";

test("confidence: where a claim came from, the sessions that said it, the corrections at it, its files, its age", () => {
  const c = (/** @type {Record<string, any>} */ o, /** @type {number} */ days = 0, /** @type {any} */ rec = {}) => round(confidenceOf(claim(o, days), rec, NOW));
  assert.deepEqual(
    [
      c({ origin: "correction", status: "confirmed" }),
      c({ origin: "person", status: "confirmed" }),
      c({ origin: "owner" }),
      c({ status: "confirmed" }),
      c({ origin: "capture" }),
      c({}),
      c({ origin: "model" }),
      c({ origin: "subagent" }),
      c({ origin: "agent" }),
      c({ origin: "import" }),
    ],
    [1, 0.95, 0.95, 0.9, 0.8, 0.6, 0.6, 0.55, 0.55, 0.4],
    "the user's word, then proved right, then captured, learned and the agent's own note alike (the memory plan's d5), a sub-agent's or an outside agent's finding, imported",
  );
  assert.equal(c({}, 0, { evidence: 2 }), 0.7, "each other session that said it");
  assert.equal(c({}, 0, { evidence: 9 }), 0.75, "at most three of them count");
  assert.equal(c({}, 0, { suspected: 1 }), 0.35, "each suspicion on it");
  assert.equal(c({ origin: "person" }, 0, { suspected: 2 }), 0.95, "never the user's word: it is asked about (M7-D68)");
  assert.equal(c({ origin: "capture" }, 0, { changed: true }), 0.6, "a file it names changed since");
  assert.equal(c({}, 0, { suspected: 9 }), 0, "never below nothing");
  assert.equal(c({ origin: "correction" }, 0, { evidence: 3 }), 1, "never above sure");
  assert.equal(c({ kind: "thread" }, 7), 0.6, "a thread holds its first week");
  assert.equal(c({ kind: "thread" }, 21), 0.4, "then fades a tenth a week");
  assert.equal(c({ kind: "fact" }, 180), 0.6, "a fact holds half a year");
  assert.equal(c({ kind: "decision" }, 270), 0.55, "then fades a twentieth a quarter");
  assert.equal(c({ kind: "fact" }, 5000), 0.4, "by a fifth at most");
  assert.equal(c({ kind: "rule", origin: "person" }, 5000), 0.95, "a rule does not age");
});

test("the user's rules open the briefing, oldest first, the owner's global ones with them, and only theirs", () =>
  world({}, async (w) => {
    const { sit } = await w.session("r1").remember("you must never force-push to the main branch", { kind: "rule" });
    await w.session("r2").remember("you must never force-push to the main branch", { kind: "rule" });
    await w.svc.brain.remember("always answer in British English", { kind: "preference", projectId: null, by: "owner" });
    await w.svc.brain.remember("always run the deploy pipeline tests twice", { kind: "rule", projectId: sit.project.id, by: "model" });
    // The agent keeps what the person says with its tools (the memory plan's d3): their preference, quoting them, is their
    // words; their rule, by their own word.
    const r3 = w.session("r3");
    const pref = "I prefer short commit messages in this project";
    const { prep } = await r3.send(pref);
    assert.equal((await w.svc.brain.remember(pref, { kind: "preference", projectId: sit.project.id, chainId: prep.chain, turnId: prep.turn, by: "model", quote: pref })).heard, true);
    await r3.remember("you must never squash the release commits", { kind: "rule" });
    const learned = await w.svc.brain.fileLearned({ projectId: sit.project.id, chainId: prep.chain, kind: "convention", text: "release branches are named release/<version>", importance: 0.7 });
    await w.svc.brain.fileLearned({ projectId: sit.project.id, chainId: prep.chain, kind: "convention", text: "hotfix branches are named hotfix/<ticket>", importance: 0.7 });
    await w.svc.brain.confirm(`i${learned.id}`, { by: "person" });
    const kinds = w.svc.archive.items.list({}).map((it) => [it.text.slice(0, 22), it.kind, it.origin, it.status]);
    for (let i = 1; i <= 14; i++) await w.session(`f${i}`).remember(`deploy pipeline step ${i} uploads the bundle to bucket deploy-${i}`);
    const { seen } = await w.session("z").send("let's work on the deploy pipeline steps, where each uploads the bundle, and push to the main branch");
    const briefing = block(seen, "briefing");
    const [, rules = ""] = /The user's rules and preferences \(their own word\):\n((?:- .*\n?)*)/.exec(briefing) || [];
    assert.deepEqual(
      memoryLines(rules).map((l) => l.replace(/^- \[i\d+ /, "- [")),
      [
        "- [rule · user said · 2026-10-02 · ✓2] you must never force-push to the main branch",
        "- [preference · user said · 2026-10-02] always answer in British English",
        "- [preference · user's words · 2026-10-02] I prefer short commit messages in this project",
        "- [rule · user said · 2026-10-02] you must never squash the release commits",
        "- [convention · user confirmed · 2026-10-02] release branches are named release/<version>",
      ].map((l) => l.replace("2026-10-02", localDay())),
      `${briefing}\n${JSON.stringify(kinds)}`,
    );
    assert.ok(briefing.indexOf("The user's rules") < briefing.indexOf("Project: "), "before the project");
    assert.equal(memoryLines(briefing).filter((l) => l.includes("force-push")).length, 1, "said once: recall does not repeat it");
    assert.ok(!rules.includes("tests twice"), "an assistant's note is not the user's rule");
    assert.ok(!rules.includes("hotfix"), "nor is a convention learned and never confirmed");
    // (fails before: yes — their words an agent quoted were filed "user's words" and left out of the constitution, so a
    // rule told to the agent once reached later sessions only by recall: the memory plan's d3)
  }));

test("the user's own word opens the briefing whatever status the dashboard set on it", () =>
  world({}, async (w) => {
    await w.session("r1").remember("you must never force-push to the main branch", { kind: "rule" });
    await w.svc.brain.remember("always answer in British English", { kind: "preference", projectId: null, by: "owner" });
    const owner = w.svc.scope({ role: "owner" });
    for (const it of w.svc.archive.items.list({})) await owner.setStatus(it.id, "inferred");
    assert.deepEqual(w.svc.archive.items.list({}).map((it) => [it.origin, it.status]).sort(), [["owner", "inferred"], ["person", "inferred"]]);
    const { seen } = await w.session("z").send("let's push the branch to main");
    const [, rules = ""] = /The user's rules and preferences \(their own word\):\n((?:- .*\n?)*)/.exec(block(seen, "briefing")) || [];
    assert.ok(rules.includes("never force-push"), `the person said it: ${rules}`);
    assert.ok(rules.includes("British English"), `the owner said it: ${rules}`);
  }));

test("a rule the user retired is no rule: the briefing leaves it out", () =>
  world({}, async (w) => {
    await w.session("r1").remember("you must never force-push to the main branch", { kind: "rule" });
    await w.session("r2").remember("you must always sign the release tags", { kind: "rule" });
    const it = w.svc.archive.items.list({}).find((x) => /force-push/.test(x.text));
    await w.svc.scope({ role: "person" }).forget(`i${it.id}`, { reason: "main is ours alone now" });
    const briefing = block((await w.session("z").send("let's push the branch to main and tag the release")).seen, "briefing");
    assert.ok(briefing.includes("sign the release tags"), briefing);
    assert.ok(!briefing.includes("force-push"), briefing);
  }));

test("rules past a quarter of the briefing are counted, never dropped in silence", () =>
  world({}, async (w) => {
    const topics = ["tabs", "semicolons", "var", "any", "console.log", "default exports", "nested ternaries", "magic numbers", "global state", "sync fs calls", "eval", "with statements", "labels", "void", "bitwise flags", "getters with effects", "prototype edits", "empty catches", "floating promises", "long params"];
    for (const [i, t] of topics.entries()) await w.session(`r${i}`).remember(`you must never use ${t} anywhere in the source code of this project`, { kind: "rule" });
    const { seen } = await w.session("z").send("hello");
    const briefing = block(seen, "briefing");
    const rules = briefing.slice(briefing.indexOf("The user's rules"), briefing.indexOf("\nProject: "));
    const shown = memoryLines(rules).length;
    const more = Number(/…and (\d+) more; filament_memory_search finds them\./.exec(briefing)?.[1]);
    assert.ok(shown > 0 && shown < topics.length, `${shown} shown`);
    assert.equal(shown + more, topics.length, briefing);
    assert.ok(rules.length <= 1200 * 4 * 0.25 + 120, `a quarter of the briefing and its two lines of frame: ${rules.length}`);
    assert.ok(briefing.includes("never use tabs"), "the oldest first");
  }));

test("the first rule always shows, however long its line against the smallest briefing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-confidence-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "schema.js"), "export const schema = {};\n");
    await world({ cwd: dir }, async (w) => {
      w.cfg.memory.autopilot.briefingTokens = 300;
      const rule = `you must always regenerate src/schema.js with the generator, ${"because a hand edit drifts from the database and the drift only shows in production, ".repeat(3)}so never edit it by hand`;
      for (const s of ["a", "b"]) await w.session(s).remember(rule, { kind: "rule" });
      appendFileSync(join(dir, "src", "schema.js"), "// regenerated\n");
      const briefing = block((await w.session("c").send("hello")).seen, "briefing");
      const line = memoryLines(briefing).find((l) => l.includes("regenerate src/schema.js")) || "";
      assert.match(line, /^- \[i\d+ rule · user said · \d{4}-\d\d-\d\d · ✓2 · file changed since\] /, briefing);
      assert.ok(line.length > 1200 * 0.25, `longer than its quarter (${line.length}), and shown`);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a rule held back by its files stays out of the constitution; search still shows it, labelled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-confidence-"));
  try {
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "release.sh"), "echo release\n");
    await world({ cwd: dir }, async (w) => {
      const { sit } = await w.session("a").remember("you must always run scripts/release.sh from the repo root", { kind: "rule" });
      assert.ok(block((await w.session("b").send("hello")).seen, "briefing").includes("scripts/release.sh"), "in the constitution while the file is there");
      unlinkSync(join(dir, "scripts", "release.sh"));
      assert.ok(!memoryLines((await w.session("c").send("hello")).seen).some((l) => l.includes("release.sh")), "its file is gone");
      const hit = (await w.svc.brain.search("run the release script", { projectId: sit.project.id })).find((it) => /release\.sh/.test(it.text));
      assert.deepEqual([hit?.held, hit?.flags], [true, ["file gone"]]);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a learned claim corrections pointed at ranks below one nobody doubted; doubted enough, the autopilot leaves it out", () =>
  world({}, async (w) => {
    const { sit } = await w.session("a").send("the deploy script uploads the bundle to the cdn bucket.");
    await w.session("b").send("the deploy script uploads the source maps to the archive bucket.");
    // Learned, and said again by a second session: 0.65 each. The user's word is never lowered by a suspicion (M7-D68).
    for (const text of ["the deploy script uploads the bundle to the cdn bucket.", "the deploy script uploads the source maps to the archive bucket."])
      for (const chainId of ["l1", "l2"]) await w.svc.brain.fileLearned({ projectId: sit.project.id, chainId, kind: "fact", text, importance: 0.7 });
    await w.settle();
    const search = () => w.svc.brain.search("where does the deploy script upload things?", { projectId: sit.project.id });
    const claims = async () => (await search()).filter((it) => /^i\d+$/.test(it.id) && /bucket/.test(it.text));
    const before = await claims();
    assert.equal(before.length, 2);
    assert.match((await search())[0].id, /^i\d+$/, "a quote of the same words ranks below the claim: nobody checked it");
    const top = before[0];
    const id = Number(top.id.slice(1));
    const doubt = () => w.svc.archive.items.note(id, "suspected", { by: "person", reason: "a correction named its words", detail: { chain: "x" } });
    doubt();
    const after = await claims();
    assert.deepEqual(
      after.map((it) => [it.id, it.confidence]),
      [
        [before[1].id, 0.65],
        [top.id, 0.4],
      ],
    );
    assert.deepEqual((await search()).slice(0, 2).map((it) => it.id), [before[1].id, top.id], "doubted, the claim still ranks above the quotes that said it");
    assert.deepEqual(
      (await w.svc.brain.search("where does the deploy script upload things?", { projectId: sit.project.id, limit: 1 })).map((it) => it.id),
      [before[1].id],
      "the limit takes the surest first",
    );
    const needle = top.text.slice(-20);
    assert.ok(servedAs((await w.session("c").send("where does the deploy script upload the bundle and the maps?")).seen, "fact", needle), "still shown: 0.4 is over the gate");
    doubt();
    assert.equal(servedAs((await w.session("d").send("where does the deploy script upload the bundle and the maps?")).seen, "fact", needle), null, "0.15: under the gate");
    assert.equal((await search()).find((it) => it.id === top.id)?.confidence, 0.15, "an explicit search still finds it");
  }));

test("a claim whose file changed since ranks below one whose file did not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-confidence-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "alpha.js"), "export const alpha = 1;\n");
    writeFileSync(join(dir, "src", "beta.js"), "export const beta = 1;\n");
    await world({ cwd: dir }, async (w) => {
      const { sit } = await w.session("a").remember("src/alpha.js exports alpha for the parser");
      await w.session("b").remember("src/beta.js exports beta for the parser");
      const search = async () =>
        (await w.svc.brain.search("what does the parser get from its modules?", { projectId: sit.project.id })).filter((it) => /^i\d+$/.test(it.id)).map((it) => [it.text.split(" ")[0], it.confidence]);
      const first = (await search())[0][0];
      appendFileSync(join(dir, first), "// edited: its symbol stays\n");
      assert.deepEqual((await search()).map(([t, c]) => [t === first ? "changed" : "kept", c]), [
        ["kept", 0.95],
        ["changed", 0.75],
      ]);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an open thread fades: shown while fresh, left out a month on, still found by a search", () =>
  world({}, async (w) => {
    const { prep, sit } = await w.session("a").send("hello");
    await w.svc.brain.fileLearned({ projectId: sit.project.id, chainId: prep.chain, kind: "thread", text: "migrating the billing webhooks to the new queue is half done", importance: 0.7 });
    const ask = "how far along is migrating the billing webhooks to the new queue?";
    assert.ok(servedAs((await w.session("b").send(ask)).seen, "thread", "billing webhooks"), "fresh");
    const real = w.svc.brain.now;
    w.svc.brain.now = () => real() + 14 * DAY;
    assert.ok(servedAs((await w.session("c").send(ask)).seen, "thread", "billing webhooks"), "two weeks on: 0.5");
    w.svc.brain.now = () => real() + 30 * DAY;
    assert.equal(servedAs((await w.session("d").send(ask)).seen, "thread", "billing webhooks"), null, "a month on: under the gate");
    const hit = (await w.svc.brain.search(ask, { projectId: sit.project.id })).find((it) => /billing webhooks/.test(it.text));
    assert.ok(hit && hit.confidence < 0.35, JSON.stringify(hit));
  }));

test("a line says how many sessions said it, and the block says what the mark means", () =>
  world({}, async (w) => {
    for (const s of ["a", "b", "c"]) await w.session(s).remember("the api server listens on port 3000");
    await w.session("c").remember("the api server listens on port 3000");
    await w.session("e").remember("the api server writes its logs to stdout");
    const { prep, sit } = await w.session("d").send("hello");
    await w.svc.brain.remember("the api server listens on port 3000", { projectId: sit.project.id, chainId: prep.chain, by: "model" });
    await w.svc.brain.remember("the api server listens on port 3000", { projectId: sit.project.id, by: "owner" });
    const id = Number(w.svc.archive.items.list({}).find((it) => /port 3000/.test(it.text)).id);
    assert.deepEqual(
      w.svc.archive.items.events(id).filter((e) => e.action === "evidence").map((e) => e.by),
      ["person", "person", "model"],
      "captured again, then an assistant's remember in another session; the dashboard's, in none, is no session",
    );
    const { seen } = await w.session("z").send("which port does the api server listen on, and where do its logs go?");
    assert.match(servedAs(seen, "fact", "port 3000") || "", /· ✓4\] /, "four sessions, its own and three more; a session saying it twice counts once");
    assert.match(servedAs(seen, "fact", "stdout") || "", /· 2026-\d\d-\d\d\] /, "said once: no mark");
    assert.ok(block(seen, "briefing").includes("✓n: n separate sessions said it."));
    // The fact four sessions said opens every session here, in the project's dossier (M4-7), and its mark is explained there too.
    const { seen: here } = await w.session("x").send("hello");
    assert.match(block(here, "briefing"), /The project's dossier[^\n]*\nFacts:\n- \[i\d+ fact · user said · [\d-]+ · ✓4\] the api server listens on port 3000/);
    assert.ok(block(here, "briefing").includes("✓n: n separate sessions said it."));
    const { seen: once } = await w.session("y", { cwd: "C:\\elsewhere" }).send("hello");
    assert.ok(!block(once, "briefing").includes("✓n"), "no mark, no legend");
  }));

test("a turn block carries at most two quotes", () =>
  world({}, async (w) => {
    const said = ["failed again this morning", "was restarted after the timeout", "took nine minutes today", "is slow and we should look at why", "finally passed after a retry"];
    for (const [i, t] of said.entries()) await w.session(`q${i}`).send(`the deploy pipeline upload step ${t}`);
    const z = w.session("z");
    await z.send("hello, let's start on something.");
    const { r } = await z.send("what happened with the deploy pipeline upload step?");
    const turn = block(String(r.body.messages.at(-1).content), "turn");
    assert.equal(turn.split("\n").filter((l) => /^- \[s:/.test(l)).length, 2, turn);
  }));
