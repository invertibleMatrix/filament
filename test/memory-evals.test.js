// Memory evals (HarnessV3-Memory MD-19): scripted multi-session stories with a known truth, run through the real
// service, brain and archive against the fake engine. Each scenario states what memory SHOULD do. A scenario that
// today's code fails is listed in KNOWN with the finding it fails on (F1… in HarnessV3-Memory §1), and the test
// asserts it still fails *on that finding* — so a fix that makes it pass fails this file until the entry is removed
// (the ratchet), and a scenario that breaks for any other reason (a setup error, another finding) fails at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeMemoryTool } from "../src/memory-tools.js";
import { sidecarEnv } from "../src/adapters/sidecar/client.js";
import { MemoryLearner, LEARN_PROMPT } from "../src/services/memory/learn.js";
import { MERGE_PROMPT, KEY_PROMPT, DOSSIER_PROMPT } from "../src/services/memory/curator.js";
import { world, memoryLines, lineWith, servedAs } from "./fixtures/memory-world.mjs";

// What today's code gets wrong, by scenario, with the finding it fails on. Remove an entry when its fix lands.
// M1 closed F1–F6 (2026-10-02), M4 closed F8 and M5 closed MD-14 (2026-10-03): none waits now. A gap found later is
// listed here with its finding until it is fixed.
/** @type {Record<string, string>} */
const KNOWN = {};

/** A failed expectation, tagged with the finding it belongs to. */
const gap = (finding, ok, what) => assert.ok(ok, `${finding}: ${what}`);

function scenario(name, fn) {
  test(name, async (t) => {
    const finding = KNOWN[name];
    if (!finding) return fn();
    await assert.rejects(fn, (e) => {
      if (!String(e?.message || "").startsWith(`${finding}:`)) throw e; // failing for another reason: report that failure as it is
      t.diagnostic(`known gap — ${String(e.message).slice(0, 300)}`);
      return true;
    }, `"${name}" passes now: remove it from KNOWN (finding ${finding})`);
  });
}

// ---------------------------------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------------------------------
scenario("a corrected fact: the next session sees the new value and not the old", () =>
  world({}, async (w) => {
    await w.session("a").remember("the staging server is in region eu-west-2");
    await w.session("b").correct("no, the staging server is in region eu-central-1 now.", { of: "eu-west-2", claim: "the staging server is in region eu-central-1 now" });
    const { seen } = await w.session("c").send("which region is the staging server in?");
    assert.ok(seen.includes("eu-central-1"), "the new value is served");
    gap("F5", !seen.includes("eu-west-2"), `the old value is still served: ${lineWith(seen, "eu-west-2")}`);
  }));

scenario("a correction keeps the old value as history: invalidated with its replacement, never deleted", () =>
  world({}, async (w) => {
    await w.session("a").remember("the staging server is in region eu-west-2");
    const old = w.svc.archive.items.list({}).find((it) => /eu-west-2/.test(it.text));
    assert.ok(old?.memory_id, "the fact reached the engine");
    await w.session("b").correct("no, the staging server is in region eu-central-1 now.", { of: "eu-west-2", claim: "the staging server is in region eu-central-1 now" });
    const ops = w.ops();
    gap("F1", !ops.some((o) => o.op === "forget" && o.args.id === old.memory_id), "the old value's engine copy was deleted (forget), not invalidated");
    gap("F1", ops.some((o) => o.op === "invalidate" && o.args.id === old.memory_id && o.args.replacement_id), "the old value was not invalidated with its replacement");
  }));

scenario("a correction retires only what it contradicts, not a neighbour that shares the subject", () =>
  world({}, async (w) => {
    await w.session("a").remember("the staging server uses nginx as its reverse proxy");
    await w.session("a2").remember("the staging server is in region eu-west-2");
    await w.session("b").correct("no, the staging server is in region eu-central-1 now.", { of: "eu-west-2", claim: "the staging server is in region eu-central-1 now" });
    const nginx = w.svc.archive.items.list({}).find((it) => /nginx/.test(it.text));
    gap("F1", nginx && !["dismissed", "superseded"].includes(nginx.status), "the nginx fact was retired by a correction about the region");
    const { seen } = await w.session("c").send("which reverse proxy does the staging server use?");
    gap("F1", seen.includes("nginx"), "the nginx fact is not served any more");
  }));

// "Switched to bun for installs" shares one identifying word with "pnpm for package installs", as many as a neighbour
// would: the agent that heard it names what it corrects by its id (the memory plan's d3), so no overlap of words decides.
scenario("a correction worded apart from what it contradicts still retires it", () =>
  world({}, async (w) => {
    await w.session("a").remember("I always use pnpm for package installs in this project", { kind: "preference" });
    await w.session("b").correct("no, we switched to bun for installs now", { of: "pnpm", claim: "we switched to bun for installs now" });
    const pnpm = w.svc.archive.items.list({}).find((it) => /pnpm/.test(it.text));
    assert.ok(pnpm, "the preference was kept");
    gap("MD-6", ["dismissed", "superseded"].includes(w.svc.archive.items.get(pnpm.id).status), "the pnpm preference still stands beside the correction");
  }));

scenario("the model can correct a memory it was shown, by the id on its line", () =>
  world({}, async (w) => {
    await w.session("a").remember("releases are cut from the main branch");
    const b = await w.session("b").send("where are releases cut from?");
    const line = lineWith(b.seen, "main branch");
    assert.ok(line, "the release fact was shown");
    const id = /^- \[(i\d+|e:\S+)[ \]]/.exec(line)?.[1] || null;
    gap("F2", id, `the line carries no id the model could name: ${line}`);
    const out = JSON.parse(await executeMemoryTool(w.svc.scope({ role: "model", project: b.sit.project.id, chain: b.prep.chain, turn: b.prep.turn, client: "claude-code" }), "filament_memory_correct", { id, text: "Releases are cut from the release/next branch.", reason: "the owner moved releases" }));
    gap("F2", !out.error, `the correct tool failed: ${out.error}`);
    await w.settle();
    const { seen } = await w.session("c").send("where are releases cut from?");
    gap("F2", seen.includes("release/next") && !seen.includes("cut from the main branch"), "the next session still sees the old value, or not the new one");
  }));

scenario("every memory line carries an id and where it came from", () =>
  world({}, async (w) => {
    await w.session("a").remember("the docs site is built with mkdocs");
    await w.session("a2").remember("never edit generated files under site/ by hand", { kind: "rule" });
    const { seen } = await w.session("b").send("how is the docs site built, and what about the site folder?");
    const lines = memoryLines(seen);
    assert.ok(lines.length >= 2, `memory was shown: ${lines.length} lines`);
    // A claim: its id, kind and how it is known. Words from a past session: their id and date only, under their own heading.
    for (const l of lines)
      gap("F2", /^- \[(?:\S+ [a-z]+ · (?:user said|user corrected|user confirmed|user's words|inferred|assistant noted|imported)\b|s:\S+ · )/.test(l), `a line without its id and source: ${l}`);
  }));

scenario("a session shown a value that is later corrected gets an erratum on its next turn", () =>
  world({}, async (w) => {
    await w.session("a").remember("the staging server is in region eu-west-2");
    const s = w.session("s");
    const first = await s.send("which region is the staging server in?");
    assert.ok(first.seen.includes("eu-west-2"), "the session was shown the old value");
    await w.session("b").correct("no, the staging server is in region eu-central-1 now.", { of: "eu-west-2", claim: "the staging server is in region eu-central-1 now" });
    const next = await s.send("ok, and what else runs on the staging server?");
    const newest = next.r.body.messages.at(-1).content;
    gap("F6", /Memory correction/i.test(newest) && newest.includes("eu-central-1"), "the session that saw eu-west-2 was never told it changed");
  }));

// M4-6: the user said two values for one thing, without a "no, …" that would have made it a correction. The curator keys
// both to one slot (its model, scripted here) and asks the user before retiring their word; until they answer, the
// older value is served marked in question, and once they accept it is gone.
const portKeyer = async (/** @type {any} */ a) =>
  JSON.stringify(
    a.system === KEY_PROMPT
      ? { slots: [...a.user.matchAll(/^(\d+)\. .*port (\d{4})/gm)].map((m) => ({ n: Number(m[1]), subject: "api", attribute: "port", value: m[2] })) }
      : a.system === MERGE_PROMPT
        ? { pairs: [] }
        : { sections: [] },
  );
scenario("two values the user said for one thing: asked, served in question until answered, then only the newer", () =>
  world({ models: { summarizer: "judge" }, callModel: portKeyer }, async (w) => {
    const { sit } = await w.session("a").remember("the api listens on port 3000");
    await w.session("b").remember("the api listens on port 8080 now");
    const [old, now] = ["3000", "8080"].map((v) => w.svc.archive.items.list({}).find((it) => it.text.includes(v)));
    w.svc.archive.db.prepare("UPDATE items SET created_at = created_at - 60000 WHERE id = ?").run(old.id);
    await w.svc.curator.run(sit.project.id);
    const mid = await w.session("c").send("which port does the api listen on?");
    assert.equal(mid.prep.cue?.questions, 1, "the cue says memory has a question");
    gap("M4-6", String(lineWith(mid.seen, "port 3000")).includes(`in question: the user is asked if i${now.id} replaces it`), `the older value is served as if nothing rivalled it: ${lineWith(mid.seen, "port 3000")}`);
    gap("M4-6", !!lineWith(mid.seen, "port 8080") && !String(lineWith(mid.seen, "port 8080")).includes("in question"), "the newer value is served plain");
    gap("M4-6", /A line marked "in question" is one the user has been asked to retire/.test(mid.seen), "the legend says what the mark means");
    const q = w.svc.brain.questions(sit.project.id)[0];
    assert.ok((await w.svc.brain.decide(q.id, "accept", { by: "person" })).ok, "accepted");
    const { seen } = await w.session("d").send("which port does the api listen on?");
    assert.ok(seen.includes("port 8080"), "the newer value is served");
    gap("M4-6", !seen.includes("port 3000"), `the older value is still served after the user accepted: ${lineWith(seen, "port 3000")}`);
  }));

// ---------------------------------------------------------------------------------------------------
// The dossier, fading, duplicates, ranking
// ---------------------------------------------------------------------------------------------------
/** A curator's model that writes each fact it is given into the dossier, word for word, and keys and merges nothing. */
const factWriter = async (/** @type {any} */ a) =>
  JSON.stringify(
    a.system === DOSSIER_PROMPT
      ? { sections: [{ title: "Facts", lines: [...a.user.matchAll(/^(i\d+) \[fact[^\]]*\] (.*)$/gm)].map((m) => ({ text: m[2], cites: [m[1]] })) }] }
      : a.system === KEY_PROMPT
        ? { slots: [] }
        : { pairs: [] },
  );
scenario("the project's dossier drops a retired claim at once, whatever version was written", () =>
  world({ models: { summarizer: "judge" }, callModel: factWriter }, async (w) => {
    const a = await w.session("a").remember("the build output goes to out/dist");
    const it = w.svc.archive.items.list({ projectId: a.sit.project.id }).find((x) => /out\/dist/.test(x.text));
    assert.ok(it?.status === "confirmed", "a confirmed fact");
    const live = await w.session("b").send("let's look at the packaging step");
    assert.match(live.seen, /The project's dossier \(its standing memories, by kind\):\nFacts:\n- \[i\d+ fact · user said · [\d-]+\] the build output goes to out\/dist/, "rendered from claims before the curator wrote one");
    const r = await w.svc.curator.run(a.sit.project.id);
    assert.equal(r.dossier, "v1");
    const b = await w.session("b2").send("let's look at the packaging step");
    assert.match(b.seen, new RegExp(`The project's dossier \\(v1, [\\d-]+; each line ends with the memories it rests on\\):\\nFacts:\\n- the build output goes to out/dist \\[i${it.id}\\]`), "the curator's version");
    assert.equal(w.svc.archive.getChain(b.prep.chain)?.meta?.dossier, 1, "the version is pinned on the session");
    assert.ok(!/Project canon/.test(b.seen));
    const f = await w.svc.brain.forget(`i${it.id}`, { by: "owner" });
    assert.ok(f.ok, "forgotten");
    const { seen } = await w.session("c").send("let's look at the packaging step");
    gap("F3", !seen.includes("out/dist"), "the retired fact is still in every briefing, in the dossier");
  }));

scenario("a rule obeyed in silence is still served after many sessions", () =>
  world({}, async (w) => {
    await w.session("r").remember("never force-push to the shared release branches; open a pull request and let the CI pipeline merge it after review", { kind: "rule" });
    const rule = w.svc.archive.items.list({ kind: "rule" }).find((x) => /force-push/.test(x.text));
    assert.ok(rule, "the correction is a rule");
    // Later sessions are about the work the rule governs, worded the way work is worded; the agent obeys the rule
    // without quoting it, so no reply ever echoes it.
    const ask = "my login crash hotfix is ready locally; get it onto both release branches today so QA can try it";
    // Real replies differ from one session to the next (identical ones would echo each other's snippets and credit the
    // whole injection as used — F4's other half).
    const replies = [
      "Pushed the fix to its own branch and opened a pull request; checks started.",
      "It is up for review now. I will ping you once everything is green.",
      "Created PR 412 against both lines and requested a review from the team.",
      "Review requested; the build is queued behind two others.",
    ];
    for (let i = 1; i <= 4; i++) {
      const { seen } = await w.session(`obey-${i}`).send(ask, { reply: replies[i - 1] });
      if (i === 1) assert.ok(servedAs(seen, "rule", "force-push"), "the rule is served on work it governs");
    }
    const { seen } = await w.session("later").send(ask);
    gap("F4", servedAs(seen, "rule", "force-push"), `the rule faded after sessions in which it was obeyed (what is left: ${lineWith(seen, "force-push")})`);
  }));

// M4-2: the curator merges them between sessions. Its model judges the pair the same (scripted here; the live check
// runs a real one, M4-8); a rule keeps the older, and the other's session counts for it.
const sameJudge = async (a) =>
  JSON.stringify(
    a.system === MERGE_PROMPT
      ? { pairs: [...a.user.matchAll(/^(\d+)\. A:/gm)].map((m) => ({ n: Number(m[1]), same: true })) }
      : a.system === KEY_PROMPT
        ? { slots: [] }
        : { sections: [] },
  );
scenario("two wordings of one fact are one line", () =>
  world({ models: { summarizer: "judge" }, callModel: sameJudge }, async (w) => {
    const { sit } = await w.session("a").remember("the bundle is built with esbuild from src/main.ts");
    await w.session("b").remember("esbuild builds the bundle, starting at src/main.ts");
    await w.svc.curator.run(sit.project.id);
    const { seen } = await w.session("c").send("how is the bundle built with esbuild from src/main.ts?");
    const lines = memoryLines(seen).filter((l) => /esbuild/.test(l));
    gap("F8", lines.length === 1, `${lines.length} lines say the same thing`);
    gap("F8", /✓2/.test(lines[0]), `the line counts both sessions: ${lines[0]}`);
  }));

scenario("words from a past session are evidence, not facts", () =>
  world({}, async (w) => {
    const old = w.session("old");
    await old.send("we run everything in the sandbox folder with no file tools at all for now");
    await old.send("the release script lives in ops/release.sh and pushes the bundle to the staging bucket");
    const s = w.session("new");
    const first = await s.send("which file tools do we have in the sandbox folder?");
    const next = await s.send("where does the release script push the bundle?");
    // The briefing (on the first message) and the turn block (on the next) each quote past words apart from the memories.
    const turn = next.seen.indexOf('kind="turn"');
    for (const [where, seen, needle] of [["briefing", first.seen, "sandbox"], ["turn block", turn < 0 ? "" : next.seen.slice(turn), "release"]]) {
      const relevant = /Relevant memory:\n([\s\S]*?)(?:\n[A-Z][^\n]*:|$)/.exec(seen)?.[1] || "";
      const related = /Related memory for this message[^\n]*\n([\s\S]*?)(?:<\/|\nWords from past sessions|$)/.exec(seen)?.[1] || "";
      const words = /^Words from past sessions \(quotes, not checked facts\):\n((?:- [^\n]*\n?)*)/m.exec(seen)?.[1] || "";
      gap("F5", !/^- \[s:/m.test(relevant + related), `a past session's words are listed among the memories, as facts (${where})`);
      gap("F5", new RegExp(String.raw`^- \[s:\S+ · [^\]]*\] turn \d+: .*${needle}`, "m").test(words), `a past session's words are not quoted under their own heading (${where})`);
    }
  }));

// ---------------------------------------------------------------------------------------------------
// The engine fenced off (MD-0)
// ---------------------------------------------------------------------------------------------------
const refreshRow = (id, content, importance = 0.95) => ({ id, content: `[MODEL_REFRESH_PROPOSAL] ${content}`, source: "sleep_model_refresh_proposal", importance, veracity: "inferred", scope: "session", memory_type: "context", metadata: { action: "update", auto_applied: true, applied_by: "sleep_model_refresh_auto_apply" }, timestamp: "2026-09-25T03:00:07" });

scenario("the engine's own guesses (model refresh) are never served", () =>
  world({ cwd: "C:\\filament", engineRows: [refreshRow("72119000fa212342", "model:project::active_project_context confidence=0.9: Project 'test' at H:\\test; harness-managed context; file-level tools conditionally unavailable")] }, async (w) => {
    const { seen } = await w.session("a").send("which project folder is this and which file-level tools are available?");
    gap("F12", !seen.includes("H:\\test"), "a guess the engine wrote and applied by itself was served as memory");
  }));

scenario("the engine's own summaries and fragments (sleep, memoria) are never served", () =>
  world({
    engineRows: [
      { id: "673106323d3cee4f", content: "[filament-preference] The loop resent [thinking A | thinking B | bash] | a sequence the model never produced.", source: "sleep_consolidation", tier: "episodic", importance: 0.6, veracity: "inferred", scope: "global", memory_type: "instruction", metadata: { original_count: 1, source: "filament-preference", llm_used: false }, timestamp: "2026-10-01T03:00:55" },
      // the engine's regex fragments of other memories ride along with recall (F16): "must not stop or restart the live harness"
      { id: "memoria_memoria_instructions", content: "[MEMORIA memoria_instructions]\nmust not stop or restart the live harness loop before the bash call", source: "memoria_memoria_instructions", tier: "memoria", importance: 0.5, scope: "global", timestamp: "" },
    ],
  }, async (w) => {
    const { seen } = await w.session("a").send("why did the loop resent thinking blocks before the bash call?");
    gap("F13", !seen.includes("a sequence the model never produced"), "an engine-written summary was served as memory");
    gap("F13", !seen.includes("must not stop or restart the live harness"), "an engine fragment (memoria) was served as memory");
  }));

scenario("the engine is told not to write memory on its own", async () => {
  const env = sidecarEnv({ memoryFolder: join(tmpdir(), "filament-evals-env"), engineDir: join(tmpdir(), "filament-evals-engine") });
  gap("F12", env.MNEMOSYNE_SLEEP_MODEL_REFRESH_ENABLED === "false", "the engine's model refresh is left on");
  gap("F12", env.MNEMOSYNE_SLEEP_MODEL_REFRESH_AUTO_APPLY === "false", "the engine's model refresh may apply its guesses by itself");
  let slept = 0;
  const at3 = new Date(2026, 9, 2, 3, 5).getTime();
  const learner = new MemoryLearner({ archive: { recentChains: () => [], getChain: () => null }, brain: { store: { sleep: async () => { slept++; } } }, getConfig: () => ({ capture: { learn: true } }), log: () => {}, now: () => at3 });
  await learner.tick();
  gap("F12", slept === 0, "the learner still asks the engine to consolidate (sleep) every night");
});

// ---------------------------------------------------------------------------------------------------
// Checked against the world: environment, files, actions
// ---------------------------------------------------------------------------------------------------
scenario("a memory about the working folder that the session's environment contradicts is held back", () =>
  world({ cwd: "C:\\proj" }, async (w) => {
    await w.session("a").remember("this project is checked out at D:\\old\\proj and builds there");
    const { seen } = await w.session("b").send("where is this project checked out and where does it build?");
    gap("MD-5", !seen.includes("D:\\old\\proj") || /contested|no longer|environment says/i.test(lineWith(seen, "D:\\old\\proj") || ""), "a folder the Environment contradicts was served as fact");
  }));

scenario("a fact about a file is flagged once the file changes", async () => {
  const proj = mkdtempSync(join(tmpdir(), "filament-evals-proj-"));
  try {
    mkdirSync(join(proj, "src"));
    writeFileSync(join(proj, "src", "config.js"), "export function loadConfig() { return JSON.parse(read('settings.json')); }\n");
    await world({ cwd: proj }, async (w) => {
      await w.session("a").remember("src/config.js exports loadConfig, which reads settings.json");
      writeFileSync(join(proj, "src", "config.js"), "export function readSettings() { return JSON.parse(read('settings.yaml')); }\n");
      const { seen } = await w.session("b").send("what does src/config.js export and which settings file does it read?");
      const line = servedAs(seen, "fact", "loadConfig");
      gap("MD-4", !line || /changed since/i.test(line), `a fact about a file that has changed was served as current: ${line}`);
    });
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

scenario("a correction about a command fires when the agent runs that command", () =>
  world({}, async (w) => {
    await w.session("a").remember("don't run npm test directly inside Claude Code; run it as env -u CLAUDECODE npm test", { kind: "rule" });
    const b = w.claudeCode("b", "run the tests please");
    await b.start();
    /** The agent ran `command`; what its result told the model. @param {string} command */
    const ran = async (command) => (await b.ran("Bash", { command }, { result: "4 failing" })).back;
    gap("MD-14", (await ran("npm test")).includes("env -u CLAUDECODE"), "the pitfall stayed silent on the very command it is about");
    assert.ok(!(await ran("cd C:\\evals && env -u CLAUDECODE npm test")).includes("filament-memory"), "the right way is not reminded");
    assert.ok((await ran("npm test -- --grep slow")).includes("env -u CLAUDECODE"), "every miss of a known right way is");
  }));

// ---------------------------------------------------------------------------------------------------
// At the moment of action (M5): what was seen, left unfinished or done before comes back where it applies
// ---------------------------------------------------------------------------------------------------
scenario("a failure the agent worked around in two sessions: the third is told the way that works on its first miss", () =>
  world({}, async (w) => {
    const refused = { error: "Exit code 1\n> app test\nError: CLAUDECODE is set, refusing to run" };
    for (const id of ["a", "b"]) {
      const s = w.claudeCode(id);
      await s.start();
      const miss = await s.ran("Bash", { command: "npm test" }, refused);
      assert.ok(!miss.back.includes("Memory on the tool call"), `session ${id} was reminded of what one session saw: ${miss.back}`);
      await s.ran("Bash", { command: "env -u CLAUDECODE npm test" });
    }
    const c = w.claudeCode("c");
    await c.start();
    const miss = await c.ran("Bash", { command: "npm test" }, refused);
    gap("MD-22", miss.back.includes("`env -u CLAUDECODE npm test` worked."), `the third session was not told: ${miss.back}`);
    gap("MD-22", !(await c.ran("Bash", { command: "env -u CLAUDECODE npm test" })).back.includes("Memory on the tool call"), "the way that works was reminded too");
  }));

scenario("unfinished work comes back on its file in a later session, and no more once a session finished it", async () => {
  const proj = mkdtempSync(join(tmpdir(), "filament-evals-proj-"));
  try {
    mkdirSync(join(proj, "docs"));
    const guide = join(proj, "docs", "migration.md");
    writeFileSync(guide, "# Migration\n");
    /** @type {any} */
    let answer = {};
    const callModel = async (/** @type {any} */ a) => JSON.stringify(a.purpose === "learn" ? answer : {});
    await world({ cwd: proj, models: { summarizer: "learn-1" }, callModel }, async (w) => {
      const a = await w.session("a").send("write the migration guide");
      answer = { state: { summary: "s", done: ["wrote the intro"], open: ["docs/migration.md still needs a plugins section"], next: [] }, items: [] };
      await w.svc.learner.learnChain(a.prep.chain, { reason: "manual", force: true });
      const b = w.claudeCode("b", "add the plugins section to the migration guide");
      await b.start();
      const read = await b.ran("Read", { file_path: guide }, { result: "# Migration" });
      gap("MD-15", /open thread on docs\/migration\.md\] docs\/migration\.md still needs a plugins section/.test(read.back), `the open thread did not come back on its file: ${read.back}`);
      assert.ok(!(await b.ran("Edit", { file_path: guide, old_string: "# Migration", new_string: "# Migrating" }, { result: "ok" })).back.includes("open thread"), "once a session");
      const thread = w.svc.archive.items.standing(a.sit.project.id).find((/** @type {any} */ it) => it.kind === "thread");
      const c = await w.session("c").send("I wrote the plugins section of the migration guide");
      answer = { state: { summary: "s", done: ["the plugins section"], open: [], next: [], closed: [{ id: `i${thread.id}`, because: "the plugins section was written" }] }, items: [] };
      await w.svc.learner.learnChain(c.prep.chain, { reason: "manual", force: true });
      const d = w.claudeCode("d", "proofread the migration guide");
      await d.start();
      gap("MD-15", !(await d.ran("Read", { file_path: guide }, { result: "# Migration" })).back.includes("open thread"), "a finished thread still came back");
    });
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

scenario("the project's way of doing a thing comes with the task that names it, not a step's word, and a newer way replaces it", () =>
  world({}, async (w) => {
    await w.session("a").remember("How to cut a release: 1. `npm version patch` 2. `git push --follow-tags` 3. `npm publish`", { kind: "procedure" });
    const asked = await w.session("b").send("let's cut a release of the cli today");
    gap("MD-25", asked.seen.includes("How to cut a release: 1. `npm version patch` 2. `git push --follow-tags` 3. `npm publish`"), `the steps did not come with the task: ${lineWith(asked.seen, "release")}`);
    const aside = await w.session("c").send("fix the warning npm publish prints about the readme");
    gap("MD-25", !aside.seen.includes("git push --follow-tags"), `a step's word brought the steps: ${lineWith(aside.seen, "follow-tags")}`);
    gap("MD-25", aside.seen.includes("How to cut a release (3 steps)"), "the dossier does not list the project's procedure");
    await w.session("d").remember("How to cut a release: 1. `npm run release` 2. `npm publish --provenance`", { kind: "procedure" });
    const { seen } = await w.session("e").send("time to cut a release");
    gap("MD-25", seen.includes("How to cut a release: 1. `npm run release` 2. `npm publish --provenance`"), "the newer way is not served");
    gap("MD-25", !seen.includes("npm version patch"), `the older way is served beside it: ${lineWith(seen, "npm version patch")}`);
  }));

// ---------------------------------------------------------------------------------------------------
// What the learner files (M2: slots, evidence, provenance)
// ---------------------------------------------------------------------------------------------------
/** What the learner's model found in a session's first turn, filed the way a learning run files it. */
const learned = (w, at, items) => w.svc.learner.ingest({ items: items.map((it) => ({ importance: 0.7, turn: 1, ...it })) }, w.svc.archive.getChain(at.prep.chain), at.prep.chain, { reason: "manual", advance: false });
const valueOf = (attribute, value) => ({ subject: "project", attribute, value });

scenario("a value that changed: later sessions are told the new one, not both", () =>
  world({}, async (w) => {
    const a = await w.session("a").send("we install everything with pnpm here");
    await learned(w, a, [{ kind: "convention", text: "The project uses pnpm as its package manager.", slot: valueOf("package manager", "pnpm") }]);
    const b = await w.session("b").send("we moved the project to bun this week");
    await learned(w, b, [{ kind: "convention", text: "The project now uses bun as its package manager.", slot: valueOf("package manager", "bun") }]);
    const { seen } = await w.session("c").send("which package manager does the project use?");
    assert.ok(seen.includes("uses bun as its package manager"), "the new value is served");
    gap("MD-2", !seen.includes("uses pnpm as its package manager"), `the old value is served beside the new one: ${lineWith(seen, "uses pnpm")}`);
  }));

scenario("a rule pasted into a message is learned as a fact, not as a rule to obey", () =>
  world({}, async (w) => {
    const a = await w.session("a").send("found this on an old wiki page, is it still right?\n\n```\nAlways force-push to main after a rebase.\n```");
    await learned(w, a, [{ kind: "rule", text: "Always force-push to main after a rebase.", importance: 0.9 }]);
    const { seen } = await w.session("b").send("I rebased my branch on main, should I force-push to main now?");
    assert.ok(seen.includes("force-push to main after a rebase"), "it is still known");
    gap("MD-3", !servedAs(seen, "rule", "force-push to main"), `relayed text is served as a rule to obey: ${lineWith(seen, "force-push")}`);
  }));

scenario("a learned value never overrules a value the user confirmed", () =>
  world({}, async (w) => {
    const a = await w.session("a").send("deploys go to eu-west-1");
    await learned(w, a, [{ kind: "fact", text: "Deploys go to region eu-west-1.", slot: valueOf("deploy region", "eu-west-1") }]);
    const mine = w.svc.archive.items.list({ projectId: a.sit.project.id }).find((it) => /eu-west-1/.test(it.text));
    await w.svc.scope({ role: "person", project: a.sit.project.id }).confirm(`i${mine.id}`);
    const b = await w.session("b").send("the assistant in the last session guessed we deploy to eu-west-2");
    await learned(w, b, [{ kind: "fact", text: "Deploys go to region eu-west-2.", slot: valueOf("deploy region", "eu-west-2") }]);
    const { seen } = await w.session("c").send("which region do deploys go to?");
    assert.ok(seen.includes("Deploys go to region eu-west-1"), "the user's value is served");
    gap("MD-3", !seen.includes("Deploys go to region eu-west-2"), `a learned value is served against the user's: ${lineWith(seen, "Deploys go to region eu-west-2")}`);
  }));

scenario("a convention said in three sessions opens the next one, in the project's dossier", () =>
  world({}, async (w) => {
    for (const id of ["a", "b", "c"]) {
      const at = await w.session(id).send("run the linter before you commit, like last time");
      await learned(w, at, [{ kind: "convention", text: "Run the linter before every commit." }]);
    }
    const { seen } = await w.session("d").send("let's start on the parser");
    gap("MD-2", /The project's dossier[^\n]*\nConventions and rules:\n- \[i\d+ convention · inferred · [\d-]+ · ✓3\] Run the linter before every commit\./.test(seen), "said in three sessions, it counted as one: not in the dossier");
  }));

// ---------------------------------------------------------------------------------------------------
// How sure, in which layer, labelled how (M3-6)
// ---------------------------------------------------------------------------------------------------
scenario("the user's rules open the briefing however much else is relevant", () =>
  world({}, async (w) => {
    await w.session("r1").remember("you must never force-push to the main branch", { kind: "rule" });
    await w.session("r2").remember("you must always run the linter before a commit", { kind: "rule" });
    for (let i = 1; i <= 30; i++) await w.session(`f${i}`).remember(`release pipeline stage ${i} pushes the build to bucket stage-${i} before a commit`);
    const { seen } = await w.session("z").send("let's go through the release pipeline stages, the buckets, and committing the build");
    gap("MD-8", !!servedAs(seen, "rule", "force-push") && !!servedAs(seen, "rule", "linter"), "a rule the user gave was crowded out by relevant facts");
  }));

// A correction casts doubt on a claim it was shown beside without replacing it (M3-6): a `suspected` event, which no
// list of a message's words writes any more (the memory plan's d3) — the learner's verdict on what a session was shown
// does (d4). Here the two sessions' doubts are filed as a verdict files them.
// The learner reads each session with the claims it was shown and says which it showed wrong (the memory plan's d4).
scenario("a claim two sessions showed wrong ranks below one nobody doubted", () => {
  let doubted = 0;
  const learn = async (/** @type {any} */ a) => JSON.stringify(a.system === LEARN_PROMPT ? { title: "", turns: [], items: [], contradicted: [{ id: `i${doubted}`, turn: 2, why: "the user said the bundle is uploaded with a checksum" }] } : {});
  return world({ models: { summarizer: "judge" }, callModel: learn }, async (w) => {
    const { sit, prep } = await w.session("a").send("hello");
    const learned = async (/** @type {string} */ text) => (await w.svc.brain.fileLearned({ projectId: sit.project.id, chainId: prep.chain, turnId: prep.turn, kind: "fact", text, importance: 0.7 })).id;
    doubted = await learned("the deploy script uploads the bundle to the cdn bucket");
    for (const id of ["b", "c"]) {
      const s = w.session(id);
      await s.send("how does the deploy script upload the bundle?");
      const { prep: p } = await s.send("no, the deploy script must never upload without a checksum.");
      await w.svc.learner.learnChain(p.chain, { reason: "manual" });
    }
    assert.equal(w.svc.archive.items.eventCounts([doubted]).get(doubted)?.suspected, 2, "each session's finding is on file");
    await learned("the deploy script uploads the source maps to the archive bucket");
    const { seen } = await w.session("e").send("where does the deploy script upload things?");
    const lines = memoryLines(seen);
    const at = lines.findIndex((l) => l.includes("cdn bucket") && /^- \[i\d+ fact/.test(l));
    const fresh = lines.findIndex((l) => l.includes("archive bucket") && /^- \[i\d+ fact/.test(l));
    assert.ok(fresh >= 0, "the undoubted claim is served");
    gap("MD-3", at < 0 || at > fresh, `the claim two sessions showed wrong outranks one nobody doubted: ${lines.join(" | ")}`);
  });
});

scenario("an open thread from a month ago is not served as current", () =>
  world({}, async (w) => {
    const { prep, sit } = await w.session("a").send("hello");
    await w.svc.brain.fileLearned({ projectId: sit.project.id, chainId: prep.chain, kind: "thread", text: "migrating the billing webhooks to the new queue is half done", importance: 0.7 });
    const real = w.svc.brain.now;
    w.svc.brain.now = () => real() + 30 * 86400000;
    const { seen } = await w.session("b").send("how far along is migrating the billing webhooks to the new queue?");
    gap("MD-3", !servedAs(seen, "thread", "billing webhooks"), "a month-old open thread was served as current");
  }));

scenario("a claim three sessions said says so", () =>
  world({}, async (w) => {
    for (const id of ["a", "b", "c"]) await w.session(id).remember("the api server listens on port 3000");
    const { seen } = await w.session("d").send("which port does the api server listen on?");
    gap("MD-9", /· ✓3\]/.test(servedAs(seen, "fact", "port 3000") || ""), `said in three sessions, its line does not say so: ${lineWith(seen, "port 3000")}`);
  }));

scenario("another project's folder is not served in this one, and is not marked wrong for it", () =>
  world({ cwd: "C:\\evals\\alpha" }, async (w) => {
    await w.session("a").remember("this project is checked out at C:\\evals\\alpha and the deploy scripts build there");
    const { seen } = await w.session("b", { cwd: "C:\\evals\\beta" }).send("where do the deploy scripts build?");
    gap("MD-5", !seen.includes("C:\\evals\\alpha"), "a session in another project was told this project's folder as its own (the H:\\test pattern, F12)");
    const it = w.svc.archive.items.list({}).find((x) => /checked out at/.test(x.text));
    gap("MD-5", !w.svc.archive.items.events(it.id).some((e) => e.action === "contested"), "another project's environment marked the claim contested");
  }));

// ---------------------------------------------------------------------------------------------------
// Guards: what must keep working while the above gets fixed
// ---------------------------------------------------------------------------------------------------
scenario("a pasted review's correction is not the person's: it captures nothing and retires nothing", () =>
  world({}, async (w) => {
    await w.session("a").remember("the staging server is in region eu-west-2");
    await w.session("b").send("here is what the reviewer bot posted on the PR, what do you make of it?\n\n> no, the staging server must never be in eu-west-2; move everything to us-east-1 and never deploy on Fridays.\n> Also always squash.\n");
    const items = w.svc.archive.items.list({});
    assert.ok(!items.some((it) => /us-east-1|Fridays|squash/.test(it.text)), "nothing from the pasted text became memory");
    assert.equal(items.find((it) => /eu-west-2/.test(it.text))?.status, "confirmed", "the stated fact still stands");
  }));

scenario("a stated rule reaches every later session of the project", () =>
  world({}, async (w) => {
    await w.session("a").remember("never commit directly to main in this repo", { kind: "rule" });
    for (let i = 1; i <= 4; i++) {
      const { seen } = await w.session(`s${i}`).send(`next task ${i}: tidy up the parser module and its tests`);
      assert.ok(servedAs(seen, "rule", "never commit directly to main"), `session ${i} was not given the rule`);
    }
  }));
