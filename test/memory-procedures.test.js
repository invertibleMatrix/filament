// @ts-check
// Procedures (HarnessV3-Memory M5-6, MD-25): how a thing is done in a project, kept as one claim — "How to <goal>: 1. …
// 2. …". Kept by the user (@mem procedure, or the agent's remember quoting them: nothing is read from a message by its
// words, the memory plan's d3) or learned from a session that did it; offered when a task names its
// goal, never for a word one of its steps shares; listed by goal in the dossier, under "How to"; one way standing a goal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { world, servedAs, memoryLines } from "./fixtures/memory-world.mjs";
import { asProcedure, procedureSlot, procedureHead, stepsOf, PROCEDURE_CHARS, PROCEDURE_FORM } from "../src/services/memory/procedures.js";
import { goalCover } from "../src/services/memory/brain.js";
import { memoryCommand } from "../src/app/commands/mem.js";
import { executeMemoryTool, memoryToolDefs } from "../src/app/memory-tools.js";

const RELEASE_TEXT = "How to cut a release: 1. `npm version patch` 2. `git push --follow-tags` 3. `npm publish`";

/** A project folder, and a world whose learner answers what the test says. @param {(w: any, o: { answer: (a: any) => void, prompts: string[] }) => Promise<void>} body */
async function proceduresWorld(body) {
  const dir = mkdtempSync(join(tmpdir(), "filament-procedures-"));
  /** @type {any} */
  let answer = {};
  /** @type {string[]} */
  const prompts = [];
  const callModel = async (/** @type {any} */ a) => {
    if (a.purpose === "learn") prompts.push(a.user);
    return JSON.stringify(a.purpose === "learn" ? answer : {});
  };
  try {
    await world({ cwd: dir, models: { summarizer: "learn-1" }, callModel }, (w) => body(w, { answer: (a) => (answer = a), prompts }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a procedure reads as one: numbered, a line a step, or one line split at '; ' and ', then'; never a step cut in two", () => {
  const steps = (/** @type {string} */ t) => asProcedure(t)?.steps ?? null;
  assert.deepEqual(steps("How to cut a release: 1. npm version patch 2. git push --follow-tags 3. npm publish"), ["npm version patch", "git push --follow-tags", "npm publish"]);
  assert.deepEqual(steps("How to upgrade node: 1. install node 20. Then reopen the shell 2. run npm ci"), ["install node 20. Then reopen the shell", "run npm ci"], "counted from 1: a 20. inside a step is no step");
  assert.deepEqual(steps("How to deploy:\n- docker build -t app .\n- docker push app"), ["docker build -t app .", "docker push app"], "a line a step, its trailing dot kept");
  assert.deepEqual(steps("How to deploy:\n```bash\ndocker build -t app .\ndocker push app\n```"), ["docker build -t app .", "docker push app"], "a fence's lines are no steps");
  assert.deepEqual(steps("How to test: 1. npm ci, 2. npm test;"), ["npm ci", "npm test"], "a step's trailing comma or semicolon is the sentence's");
  assert.deepEqual(steps("How to reset the db: stop the server; delete data/dev.sqlite; run npm run seed"), ["stop the server", "delete data/dev.sqlite", "run npm run seed"]);
  assert.deepEqual(steps("How to release: run npm version patch, then push the tags, and then npm publish"), ["run npm version patch", "push the tags", "npm publish"]);
  assert.deepEqual(steps("How to cut a release: from main: 1. npm version patch 2. npm publish"), ["from main", "npm version patch", "npm publish"], "what precedes 1. is a step of its own");
  assert.deepEqual(steps("How to run tests in C:\\repo: 1. cd C:\\repo 2. npm test"), ["cd C:\\repo", "npm test"], "a colon a space does not follow stays in the goal");
  assert.equal(asProcedure("How to run tests in C:\\repo: 1. a 2. b")?.goal, "run tests in C:\\repo");
  assert.deepEqual(steps("How to release: run ./release.sh"), ["run ./release.sh"]);
  assert.equal(asProcedure("How to release: run ./release.sh", { least: 2 }), null, "the learner's needs two");
  assert.equal(asProcedure("Releases are cut with npm version."), null);
  assert.equal(asProcedure("How to: a; b"), null, "no goal");
  assert.equal(asProcedure("How to ?: a; b"), null, "a goal of no words");
  assert.equal(asProcedure("How to 2.0.1: 1. npm ci 2. npm test"), null, "a version is no goal");
  assert.deepEqual(stepsOf(""), []);
  // Long: the last steps are left out, whole, and counted.
  const long = asProcedure(`How to big: ${Array.from({ length: 20 }, (_, i) => `${i + 1}. ${"step words ".repeat(10)}${i}`).join(" ")}`);
  assert.ok(long && long.text.length <= PROCEDURE_CHARS && long.steps.length === 10 && long.cut === 10, JSON.stringify(long && { n: long.steps.length, cut: long.cut }));
  assert.ok(long.steps.every((s, i) => s === `${"step words ".repeat(10)}${i}`), "no step cut in two");
  assert.equal(asProcedure(`How to x y: 1. ${"z".repeat(PROCEDURE_CHARS)} 2. b`), null, "a first step too long to keep");
  assert.equal(asProcedure(`How to do many things: ${Array.from({ length: 15 }, (_, i) => `${i + 1}. s${i}`).join(" ")}`)?.cut, 3, "at most 12 steps");
  // One goal, whatever its case, quotes or articles; its value is its steps.
  assert.deepEqual(procedureSlot(/** @type {any} */ (asProcedure("How to Cut the Release: 1. `npm version patch` 2. npm publish"))), { slot: "how to · cut release", value: "1. `npm version patch` 2. npm publish", multi: false });
  assert.equal(procedureSlot(/** @type {any} */ (asProcedure("How to cut a release: 1. a 2. b"))).slot, "how to · cut release");
  assert.equal(procedureHead(RELEASE_TEXT), "How to cut a release (3 steps)");
  assert.equal(procedureHead("How to release: run it"), "How to release (1 step)");
  assert.equal(procedureHead("not one"), "not one");
});

test("a task offers a procedure by its goal: half the goal's words named, lightly stemmed; a step's word is not its goal", () => {
  assert.equal(goalCover("cut a release", "cut release v2"), 1);
  assert.equal(goalCover("cut a release", "releases for v2"), 0.5, "releases and release are one");
  assert.equal(goalCover("cut a release", "release notes"), 0.5);
  assert.equal(goalCover("cut a release", "fix npm publish warning"), 0);
  assert.equal(goalCover("run the e2e tests on windows", "e2e tests fail"), 0.5);
  assert.equal(goalCover("run the e2e tests on windows", "windows"), 0, "a quarter is not half");
  assert.equal(goalCover("do it", "do it now"), 0, "a goal of stop words names nothing");
});

test("the user's procedure is kept, served whole when a task names its goal, listed by goal in the dossier, never for a step's word", () =>
  proceduresWorld(async (w) => {
    const { prep, sit } = await w.session("a").remember(RELEASE_TEXT, { kind: "procedure" });
    const projectId = sit.project.id;
    assert.ok(!prep.notes.some((/** @type {string} */ n) => /captured/.test(n)), "the message itself files nothing");
    const all = w.svc.archive.items.standing(projectId);
    assert.deepEqual(
      all.map((/** @type {any} */ it) => [it.kind, it.text, it.status, it.origin, it.slot, it.slot_value]),
      [["procedure", RELEASE_TEXT, "confirmed", "person", "how to · cut release", "1. `npm version patch` 2. `git push --follow-tags` 3. `npm publish`"]],
      "one claim: not a fact, preference or decision of the same words besides",
    );
    const id = `i${all[0].id}`;
    // A session whose task is the goal: the dossier lists it by goal, and the briefing's recall serves its steps, once.
    const b = w.session("b");
    const { seen, r } = await b.send("let's cut a release for v2.1");
    const lines = memoryLines(seen).filter((l) => l.includes(id));
    assert.equal(lines.length, 2, lines.join("\n"));
    assert.ok(memoryLines(JSON.stringify(r.body.system).replaceAll("\\n", "\n")).some((l) => l.includes(id) && l.endsWith(RELEASE_TEXT)), "in the briefing, beside the line that lists it");
    assert.match(lines[0], new RegExp(`^- \\[${id} procedure · user said · [\\d-]+\\] How to cut a release \\(3 steps\\)$`));
    assert.match(seen, /How to:\n- \[i\d+ procedure/, "under How to");
    assert.ok(seen.includes('A "How to" line names a procedure kept for this project'), "the legend says how to get the steps");
    assert.ok(lines[1].endsWith(RELEASE_TEXT), lines[1]);
    assert.equal(servedAs(seen, "fact", "cut a release"), null, "never a fact");
    // A later turn of the same session that names it again is not served it twice.
    const again = await b.send("ok, cut the release now");
    assert.equal(memoryLines(again.seen).filter((l) => l.endsWith(RELEASE_TEXT)).length, 1, "only the briefing's");
    // A task that shares a step's words but not the goal: listed by goal in the dossier, its steps not served.
    const { seen: other } = await w.session("c").send("fix the warning that npm publish prints");
    assert.ok(!other.includes("`git push --follow-tags`"), memoryLines(other).join("\n"));
    assert.ok(other.includes(`[${id} procedure · user said`), "the dossier still lists it");
    // An explicit search finds it by any of its words.
    const found = await w.svc.brain.search("npm publish", { projectId });
    assert.ok(found.some((/** @type {any} */ r) => r.id === id && r.text === RELEASE_TEXT), JSON.stringify(found.map((/** @type {any} */ r) => r.id)));
  }));

test("one way to a goal stands: the user's newer way replaces theirs, with errata; a learned or a model's way never replaces the user's", () =>
  proceduresWorld(async (w, { answer, prompts }) => {
    const { sit } = await w.session("a").remember(RELEASE_TEXT, { kind: "procedure" });
    const projectId = sit.project.id;
    const [first] = w.svc.archive.items.standing(projectId);
    const b = w.session("b");
    await b.send("let's cut a release for v2.1");
    // The learner learns another way to the same goal, in other words: the user's holds it.
    const { prep: d } = await w.session("d").send("we cut the release by hand today");
    answer({ state: { summary: "s", done: [], open: [], next: [] }, items: [{ kind: "procedure", text: "How to cut the release: 1. npm version minor 2. npm publish", importance: 0.7, turn: 1 }] });
    const learned = await w.svc.learner.learnChain(d.chain, { reason: "manual", force: true });
    assert.deepEqual([learned.items, learned.dedupedItems], [0, 1]);
    const other = w.svc.archive.items.list({ projectId, limit: 50 }).find((/** @type {any} */ it) => it.text.startsWith("How to cut the release"));
    assert.deepEqual([other.status, other.slot], ["dismissed", "how to · cut release"]);
    assert.match(other.invalid_reason ?? w.svc.archive.items.events(other.id).find((/** @type {any} */ e) => e.action === "status")?.reason, /the user's word holds its slot \(how to · cut release\): i\d+/);
    // A model's remember of another way: filed dismissed, naming the user's.
    const tool = JSON.parse(await executeMemoryTool(w.svc.scope({ role: "model", project: projectId }), "filament_memory_remember", { kind: "procedure", text: "How to cut a release: 1. make release 2. make publish" }));
    assert.equal(tool.stored, false);
    assert.equal(tool.note, `the user's own way to cut a release stands (i${first.id}); this one was filed dismissed`);
    // Each later way is asked about, whether it replaces the user's (M6-D16); the user's stands meanwhile.
    const made = w.svc.archive.items.list({ projectId, limit: 50 }).find((/** @type {any} */ it) => it.text.startsWith("How to cut a release: 1. make release"));
    assert.deepEqual(w.svc.brain.questions(projectId).map((/** @type {any} */ q) => [q.proposal.action, q.proposal.id, q.proposal.replacement]), [["correct", first.id, other.id], ["correct", first.id, made.id]]);
    // The user's newer way replaces their older one: kept, superseded by it, and the session shown it is told.
    const { item: e } = await w.session("e").remember("How to cut a release:\n- npm run release\n- check the release page", { kind: "procedure" });
    assert.deepEqual(e.replaced, [`i${first.id}`], JSON.stringify(e));
    const now = w.svc.archive.items.standing(projectId).filter((/** @type {any} */ it) => it.kind === "procedure");
    assert.deepEqual(now.map((/** @type {any} */ it) => it.text), ["How to cut a release: 1. npm run release 2. check the release page"]);
    const old = w.svc.archive.items.get(first.id);
    assert.deepEqual([old.status, old.superseded_by], ["superseded", now[0].id]);
    // What memory asked about the way they replaced is moot: withdrawn, saying why.
    assert.deepEqual(w.svc.brain.questions(projectId), []);
    assert.deepEqual(w.svc.brain.questions(projectId, { status: "withdrawn" }).map((/** @type {any} */ q) => [q.proposal.replacement, q.by]), [[other.id, "person"], [made.id, "person"]]);
    const { seen } = await b.send("and the changelog?");
    assert.match(seen, new RegExp(`Memory correction: \\[i${first.id}\\] "How to cut a release: 1\\. \`npm version patch\`[^"]*" no longer holds — now \\[i${now[0].id}\\]`));
    // A learned procedure: two steps at least, under its goal; the goals are shown to the next run.
    const { prep: f } = await w.session("f").send("deploy to staging please");
    answer({
      state: { summary: "s", done: [], open: [], next: [] },
      items: [
        { kind: "procedure", text: "How to deploy to staging: 1. `docker build -t app .` 2. `docker push registry/app` 3. `kubectl rollout restart deploy/app`", importance: 0.7, turn: 1 },
        { kind: "procedure", text: "How to lint: run npm run lint", importance: 0.5, turn: 1 },
        { kind: "procedure", text: "Deploys go through kubectl.", importance: 0.5, turn: 1 },
      ],
    });
    const out = await w.svc.learner.learnChain(f.chain, { reason: "manual", force: true });
    assert.deepEqual([out.items, out.junk], [1, 2], "one step, or no procedure's form, is junk");
    const staging = w.svc.archive.items.standing(projectId).find((/** @type {any} */ it) => it.slot === "how to · deploy to staging");
    assert.deepEqual([staging.kind, staging.status, staging.origin], ["procedure", "inferred", "learner"]);
    // The next run is shown the goals, newest first, and a newer learned way replaces the older learned one.
    const { prep: g } = await w.session("g").send("deploy to staging again");
    answer({ state: { summary: "s", done: [], open: [], next: [] }, items: [{ kind: "procedure", text: "How to deploy to staging: 1. `make image` 2. `make rollout`", importance: 0.7, turn: 1 }] });
    await w.svc.learner.learnChain(g.chain, { reason: "manual", force: true });
    assert.ok((prompts.at(-1) ?? "").includes("\n\nThe project's procedures, by goal: deploy to staging; cut a release.\n\nThe notes memory showed this session"), prompts.at(-1));
    const newer = w.svc.archive.items.standing(projectId).find((/** @type {any} */ it) => it.slot === "how to · deploy to staging");
    assert.equal(newer.text, "How to deploy to staging: 1. `make image` 2. `make rollout`");
    assert.deepEqual([w.svc.archive.items.get(staging.id).status, w.svc.archive.items.get(staging.id).superseded_by], ["superseded", newer.id]);
  }));

test("remember refuses a procedure that does not read as one; @mem procedure and the tool file one; the learner's prompt asks for them", () =>
  proceduresWorld(async (w, { prompts, answer }) => {
    const { sit, prep } = await w.session("a").send("hello there, starting work");
    const projectId = sit.project.id;
    await assert.rejects(w.svc.brain.remember("cut it with npm", { kind: "procedure", projectId, by: "owner" }), new RegExp(`memory: ${PROCEDURE_FORM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    const said = await memoryCommand(w.svc, "@mem procedure How to reset the db: stop the server; delete data/dev.sqlite; npm run seed", sit);
    assert.match(said.text, /^Stored as a procedure \(`i\d+`\)\.$/m);
    const kept = w.svc.archive.items.standing(projectId).find((/** @type {any} */ it) => it.kind === "procedure");
    assert.deepEqual([kept.text, kept.origin], ["How to reset the db: 1. stop the server 2. delete data/dev.sqlite 3. npm run seed", "person"]);
    const long = `How to big: ${Array.from({ length: 14 }, (_, i) => `${i + 1}. s${i}`).join(" ")}`;
    const r = JSON.parse(await executeMemoryTool(w.svc.scope({ role: "model", project: projectId }), "filament_memory_remember", { kind: "procedure", text: long }));
    assert.deepEqual([r.stored, r.note], [true, `its first 12 steps were kept: 2 more did not fit in a procedure's ${PROCEDURE_CHARS} characters`]);
    const def = /** @type {any} */ (memoryToolDefs("anthropic").find((/** @type {any} */ t) => t.name === "filament_memory_remember"));
    assert.ok(def.input_schema.properties.kind.enum.includes("procedure"));
    answer({ state: { summary: "s", done: [], open: [], next: [] }, items: [] });
    await w.svc.learner.learnChain(prep.chain, { reason: "manual", force: true });
    assert.ok((prompts.at(-1) ?? "").endsWith("\n\nThe project's procedures, by goal: big; reset the db."), prompts.at(-1));
  }));

test("a procedure never fades for going unused: a task that needs it is rarer than one that does not", () =>
  proceduresWorld(async (w) => {
    // A global one, a model's note: only the engine serves it here, and an unconfirmed claim the replies ignore fades.
    const r = await w.svc.brain.remember(RELEASE_TEXT, { kind: "procedure", projectId: null, by: "model" });
    await w.settle();
    for (const s of ["p1", "p2", "p3", "p4"]) {
      const { seen } = await w.session(s).send("cut a release for the next version");
      assert.ok(memoryLines(seen).some((l) => l.startsWith(`- [${r.id} procedure · assistant noted`) && l.endsWith(RELEASE_TEXT)), `${s}:\n${memoryLines(seen).join("\n")}`);
    }
  }));

test("a turn gives a procedure its room first, shows its first line however long, and passes over what does not fit for what does", () =>
  proceduresWorld(async (w) => {
    const { sit } = await w.session("z").send("hello, what is this project");
    const projectId = sit.project.id;
    await w.svc.brain.remember("The project ships from the main branch.", { kind: "fact", projectId, by: "owner" });
    // The session's briefing is built on its first message, so what is said after it comes in the turns' blocks (1200
    // characters each).
    const a = w.session("a");
    await a.send("hello, starting the week");
    const steps = (/** @type {number} */ n, /** @type {string} */ what) => Array.from({ length: n }, (_, i) => `${i + 1}. run the ${what} step number ${i + 1} with its checks and wait for it to finish`).join(" ");
    const release = `How to cut a release: ${steps(11, "release")}`;
    const index = `How to rebuild the full-text search index from scratch after a schema change: ${Array.from({ length: 12 }, (_, i) => `${i + 1}. run indexing step ${i + 1} with its checks, its logs and its alerts, and wait for it to finish`).join(" ")}`;
    assert.ok(index.length <= PROCEDURE_CHARS && index.length + 48 > 1200, String(index.length));
    const checklist =
      "The checklist for a cut release lives in the wiki under Releases; it names who signs off, which dashboards to watch for an hour after the cut, how to roll back a bad release, which channels get the notes, and who to page when it stalls overnight or a migration fails halfway through the run.";
    const changelog = "Every release gets a short entry in CHANGELOG.md.";
    // An assistant's procedures rank below the owner's facts: room, not rank, puts them first.
    await w.svc.brain.remember(release, { kind: "procedure", projectId, by: "model" });
    await w.svc.brain.remember(index, { kind: "procedure", projectId, by: "model" });
    await w.svc.brain.remember(checklist, { kind: "fact", projectId, by: "owner" });
    await w.svc.brain.remember(changelog, { kind: "fact", projectId, by: "owner" });
    await w.settle();
    const block = (/** @type {any} */ r) => {
      const last = r.body.messages.at(-1).content;
      return memoryLines(typeof last === "string" ? last : JSON.stringify(last).replaceAll("\\n", "\n"));
    };
    const sent = await a.send("cut a release now please");
    const first = block(sent.r);
    assert.ok(first[0]?.endsWith(release) && first[0].length + 345 > 1200, first.join("\n"));
    assert.ok(!first.some((l) => l.includes("The checklist for a cut release")), `the long fact does not fit after it: ${first.map((l) => l.length).join(", ")}`);
    assert.ok(first.some((l) => l.endsWith(changelog)), "the short one after it does");
    // A session's second message (a third would read as a new topic, and be given twice the room).
    const c = w.session("c");
    await c.send("hello again");
    const second = block((await c.send("rebuild the full-text search index from scratch after the schema change")).r);
    assert.ok(second[0]?.endsWith(index) && second[0].length > 1200, `the first line shows, however long: ${second.join("\n")}`);
  }));
