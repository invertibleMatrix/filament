// @ts-check
// A worker's brief (HarnessV3-Memory M7-1, M7-D1, M7-D2, M7-D9): what memory hands a sub-agent or an outside agent
// with its task — the session's errata, the user's rules, the dossier, the procedures, pitfalls and threads
// its task and tools call for, and what else the task matches — each line with its id, never what the session's
// briefing riding beside it already says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { world } from "./fixtures/memory-world.mjs";
import { handsIn } from "../src/app/agent/tools.js";
import { POWERSHELL } from "../src/adapters/tools/shell.js";
import { dateOf } from "../src/services/memory/brain.js";

/** A project folder with two files, removed after `body`. @param {(dir: string) => Promise<void>} body */
async function inFolder(body) {
  const dir = mkdtempSync(join(tmpdir(), "filament-brief-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "api.js"), "export const port = 8080;\n");
    writeFileSync(join(dir, "src", "db.js"), "export const db = null;\n");
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The blocks of a brief, split where a layer's head starts a line. @param {string} text */
const heads = (text) => text.split("\n").filter((l) => !l.startsWith("- ") && !l.startsWith("Memory correction:"));

/** The lines of the block whose head starts with `head`. @param {string} text @param {string} head @returns {string[]} */
function layer(text, head) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith(head));
  const out = [];
  if (at >= 0)
    for (const l of lines.slice(at + 1)) {
      if (!l.startsWith("- ")) break;
      out.push(l);
    }
  return out;
}

/** A curator's dossier of one line that cites nothing: the project's claims are not drawn into it. @param {any} w @param {string} projectId */
const plainDossier = (w, projectId) =>
  w.svc.archive.dossiers.add({ projectId, sections: [{ title: "What it is", lines: [{ text: "A small service.", cites: [] }] }], cites: [], basis: "test" });

test("a brief opens with the user's rules, then the project and its dossier, then the procedure its task names, the pitfalls of its tools, the threads on the files it names and what else it matches — each line with its id", () =>
  inFolder((dir) =>
    world({ cwd: dir }, async (w) => {
      const { sit } = await w.session("warm").send("hello");
      const projectId = sit.project.id;
      const owner = w.svc.scope({ role: "owner", project: projectId });
      const said = async (/** @type {string} */ text, /** @type {string} */ kind) => (await owner.remember(text, { kind })).id;
      const rule = await said("Always run the linter before committing.", "rule");
      const port = await said("The API server listens on port 8080.", "fact");
      const trap = await said("Never run `docker compose up` bare here: run it as `docker compose -f dev.yml up`.", "fact");
      const how = await said("How to release: 1. bump the version 2. run `npm run build` 3. tag the commit", "procedure");
      const thread = await said("src/api.js still needs the retry wrapper.", "thread");
      const notes = await said("The release version number lives in package.json.", "fact");
      await w.settle();
      assert.deepEqual(w.svc.archive.triggers.of(Number(trap.slice(1))).map((/** @type {any} */ t) => t.tool), ["bash"]);
      // The curator's dossier cites the port, lists the procedure by its goal, words the pitfall, and words it with the
      // port: the rest, and the pitfall for the hands that walk into it, is the brief's to say.
      w.svc.archive.dossiers.add({
        projectId,
        sections: [
          { title: "Facts", lines: [{ text: "The API listens on 8080.", cites: [port] }] },
          { title: "How to", lines: [{ text: "Release: see its procedure.", cites: [how] }] },
          { title: "Pitfalls", lines: [{ text: "Compose wants the dev file.", cites: [trap] }, { text: "Compose serves the API on 8080.", cites: [trap, port] }] },
        ],
        cites: [Number(port.slice(1)), Number(how.slice(1)), Number(trap.slice(1))],
        basis: "test",
      });
      const brief = (/** @type {string[]} */ tools) => w.svc.scope({ role: "agent", project: projectId }).brief({ purpose: "subagent", task: "Release the new version, and add the retry wrapper to src/api.js.", tools });
      const b = await brief(handsIn("edit"));
      const t = b.text;
      assert.ok(t.startsWith("Memory for your task (Filament), for a sub-agent that starts without the session's conversation: what the user and past sessions established. Each line starts with its id"), t);
      assert.deepEqual(heads(t).slice(1), [
        "The user's rules and preferences (their own word):",
        `Project: ${w.svc.archive.getProject(projectId).name} (${dir}).`,
        heads(t)[3],
        "Facts:",
        "How to:",
        "Pitfalls:",
        "How to do it here (the procedures your task names):",
        "Pitfalls of the tools you have (each is said again at the call that walks into it):",
        "Open threads on the files your task names:",
        "Relevant to your task:",
        'A "How to" line names a procedure kept for this project: its steps come with a message that asks for it, and filament_memory_search gives them (search its goal).',
      ]);
      assert.match(heads(t)[3], /^The project's dossier \(v1, /);
      const line = (/** @type {string} */ id) => t.split("\n").filter((l) => l.startsWith(`- [${id} `) || l.endsWith(`[${id}]`));
      assert.deepEqual(line(rule).map((l) => l.replace(/ · \d{4}-\d\d-\d\d\]/, "]")), [`- [${rule} rule · user said] Always run the linter before committing.`]);
      assert.deepEqual(line(port), ["- The API listens on 8080. [" + port + "]"]);
      assert.deepEqual(line(how).map((l) => l.replace(/ · \d{4}-\d\d-\d\d\]/, "]")), [`- Release: see its procedure. [${how}]`, `- [${how} procedure · user said] How to release: 1. bump the version 2. run \`npm run build\` 3. tag the commit`], "listed by its goal, then whole: the task names it");
      assert.deepEqual(line(trap).map((l) => l.replace(/ · \d{4}-\d\d-\d\d\]/, "]")), [`- [${trap} fact · user said] Never run \`docker compose up\` bare here: run it as \`docker compose -f dev.yml up\`.`]);
      assert.deepEqual(line(thread), [`- [${thread} thread · user said · open thread on src/api.js] src/api.js still needs the retry wrapper.`]);
      assert.equal(line(notes).length, 1, t);
      assert.deepEqual(b.ids, [rule, port, how, trap, thread, notes]);
      assert.deepEqual(b.layers, { errata: 0, rules: 1, dossier: 3, procedures: 1, pitfalls: 1, threads: 1, related: 1 });
      assert.equal(b.count, 8);
      // A line on the pitfall and another claim is the dossier's; the pitfall is said whole too, for the hands.
      assert.deepEqual(layer(t, "Pitfalls:"), [`- Compose serves the API on 8080. [${trap}, ${port}]`]);
      assert.ok(b.tokens > 0);
      // A worker with no shell cannot run a command: the command's pitfall is not its to hear.
      const reader = await brief(["read", "grep", "glob"]);
      assert.deepEqual([reader.layers.pitfalls, reader.text.includes("docker compose"), reader.text.includes("Compose wants")], [0, false, false]);
      assert.deepEqual(layer(reader.text, "Pitfalls:"), [`- Compose serves the API on 8080. [${trap}, ${port}]`], "the line on more than the pitfall stays");
      assert.ok(!t.includes("Compose wants"), "a dossier line on a pitfall alone is the pitfalls layer's to say");
      // An explorer runs the commands that only read (HarnessV3-AtHome AH-F2): a shell's pitfalls are its to hear.
      assert.deepEqual(handsIn("read-only"), ["read", "bash", "bash_output", "bash_kill", ...(POWERSHELL ? ["powershell"] : []), "grep", "glob"], "what the gate lets a read-only worker run");
      assert.equal((await brief(handsIn("read-only"))).layers.pitfalls, 1);
      assert.ok(handsIn("edit").includes("bash"));
    }),
  ));

test("a brief for a session: what it was shown that was retired since comes first as errata, a merge is no erratum, what its briefing carries is not said twice, and what the brief shows is logged on the turn", () =>
  inFolder((dir) =>
    world({ cwd: dir }, async (w) => {
      const { sit } = await w.session("warm").send("hello");
      const projectId = sit.project.id;
      const owner = w.svc.scope({ role: "owner", project: projectId });
      const said = async (/** @type {string} */ text, /** @type {string} */ kind) => (await owner.remember(text, { kind })).id;
      const lint = await said("Always run the linter before committing.", "rule");
      const region = await said("Deploys go to eu-west-2.", "fact");
      const ttl = await said("The cache TTL is 300 seconds.", "fact");
      const ttl2 = await said("The cache keeps entries for 300 seconds.", "fact");
      const queue = await said("The deploy queue is drained by the night job.", "fact");
      await w.settle();
      // The session's first turn builds its briefing: the rule, and the facts as its dossier.
      const parent = w.session("parent");
      const first = await parent.send("let us deploy the service");
      for (const id of [lint, region, ttl, ttl2, queue]) assert.ok(first.seen.includes(`[${id} `) || first.seen.includes(`${id}]`), `${id} in the briefing: ${first.seen}`);
      const chain = first.prep.chain;
      // Since then: the region corrected, a duplicate merged, the queue retired by an assistant, a rule said.
      const now = (await owner.correct(region, { text: "Deploys go to eu-central-1.", reason: "moved" })).id;
      await w.svc.brain.merge(Number(ttl.slice(1)), [Number(ttl2.slice(1))], { by: "curator" });
      await w.svc.scope({ role: "model", project: projectId }).forget(queue, { reason: "the night job is gone" });
      const push = await said("Never force-push to main.", "rule");
      await w.settle();
      const second = await parent.send("and check the logs");
      const turn = second.prep.turn;
      const b = await w.svc.scope({ role: "agent", project: projectId, chain, turn }).brief({ purpose: "subagent", task: "deploy the service", tools: ["bash"] });
      const lines = b.text.split("\n");
      assert.ok(lines[0].includes("what the user and past sessions established, beyond the session's briefing in your system prompt, which it does not repeat."), lines[0]);
      // The machine's day, as the line writes it (FixRound decision 30): not the UTC day, which is yesterday's or
      // tomorrow's for some hours of every night.
      const day = dateOf(Date.now());
      assert.deepEqual(lines.slice(1, 3), [
        `Memory correction: [${queue}] "The deploy queue is drained by the night job." no longer holds (an assistant, ${day}).`,
        `Memory correction: [${region}] "Deploys go to eu-west-2." no longer holds — now [${now}] "Deploys go to eu-central-1." (the user, ${day}).`,
      ], "the most recently shown first; the merged duplicate is no erratum");
      assert.ok(!b.text.includes(ttl2), "a merge is no erratum");
      assert.ok(!b.text.includes("Always run the linter"), "the briefing riding beside it says that");
      assert.match(b.text, new RegExp(`\\n- \\[${push} rule · user said · [^\\]]+\\] Never force-push to main\\.`), "a rule said since the briefing");
      assert.ok(!b.text.includes(`[${ttl}`) && !b.text.includes(`${ttl}]`), "a claim the briefing shows is not said twice");
      assert.ok(!b.text.includes(`[s:${chain}:`), "its own session's words are the conversation its view setting gives, never quoted (M7-D10)");
      assert.deepEqual(b.layers.errata, 2);
      assert.deepEqual(b.ids.slice(0, 2), [now, push]);
      const logged = w.svc.archive.injections.ofTurn(chain, turn).filter((/** @type {any} */ i) => i.kind === "brief");
      assert.deepEqual(logged.map((/** @type {any} */ i) => i.ids.map((/** @type {any} */ x) => x.ref)), [b.ids]);
      assert.equal(logged[0].tokens, b.tokens);
      // The session's own errata stay its own: its next turn still hears of the correction.
      const third = await parent.send("what changed");
      assert.ok(third.seen.includes(`Memory correction: [${region}]`), third.seen);
    }),
  ));

test("no brief where memory stays out — memory off, its autopilot off, the session muted — nor where nothing applies; a brief is for a sub-agent or an agent", () =>
  world({}, async (w) => {
    const { sit, prep } = await w.session("a").send("hello");
    const projectId = sit.project.id;
    await w.svc.scope({ role: "owner", project: projectId }).remember("Always run the linter before committing.", { kind: "rule" });
    const brief = (/** @type {any} */ o = {}) => w.svc.scope({ role: "agent", project: projectId, chain: prep.chain }).brief({ purpose: "subagent", task: "lint it", ...o });
    const on = await brief();
    assert.ok(on.text.startsWith("Memory for your task (Filament), for a sub-agent that starts"), on.text);
    w.svc.brain.mute(prep.chain, true);
    assert.deepEqual(await brief(), { text: "", ids: [], count: 0, tokens: 0, layers: {}, why: "memory is off for the session" });
    w.svc.brain.mute(prep.chain, false);
    w.cfg.memory.autopilot.enabled = false;
    assert.equal((await brief()).why, "autopilot is off in Memory settings");
    w.cfg.memory.autopilot.enabled = true;
    w.cfg.memory.enabled = false;
    assert.equal((await brief()).why, "memory is off in Memory settings");
    w.cfg.memory.enabled = true;
    const elsewhere = await w.svc.scope({ role: "agent", project: "nowhere" }).brief({ purpose: "agent", task: "zzz qqq" });
    assert.deepEqual([elsewhere.text, elsewhere.count, elsewhere.why], ["", 0, "nothing in memory applies to the task"]);
    assert.deepEqual(elsewhere.layers, { errata: 0, rules: 0, dossier: 0, procedures: 0, pitfalls: 0, threads: 0, related: 0 });
    await assert.rejects(() => brief({ purpose: "lead" }), /a brief is for subagent, agent; got lead/);
    // An outside agent by default (M7-6): no session's conversation to start without; it corrects with its server's tool.
    const outside = (await w.svc.scope({ role: "agent", project: projectId }).brief({ task: "lint it" })).text;
    assert.ok(outside.startsWith("Memory for your task (Filament): what the user and past sessions established. Each line"), outside);
    assert.ok(outside.includes("trust what you find and correct the memory by its id with `correct`; close an open thread whose work you finished with `close`.") && !outside.includes("filament_memory_"), outside);
  }));

test("the archive's reads behind a brief: the standing pitfalls on a worker's tools, its project's and everywhere's, never another project's or a retired one; what a session was shown since a time; the turn a request belongs to, in its own session", () =>
  world({}, async (w) => {
    const { sit } = await w.session("warm").send("hello");
    const pid = sit.project.id;
    const trap = async (/** @type {string | null} */ project, /** @type {string} */ text) =>
      (await w.svc.scope({ role: "owner", ...(project ? { project } : {}) }).remember(text, { kind: "fact" })).id;
    const everywhere = await trap(null, "Never run `docker compose up` bare: run it as `docker compose -f dev.yml up`.");
    const here = await trap(pid, "Never run `npm publish` bare here: run it as `npm publish --dry-run` first.");
    const there = await trap("q9", "Never run `make deploy` bare there: run it as `make deploy ENV=staging`.");
    const gone = await trap(pid, "Never run `git push` bare here: run it as `git push origin HEAD`.");
    await w.settle();
    await w.svc.scope({ role: "owner", project: pid }).forget(gone, { reason: "we push freely now" });
    const a = w.svc.archive;
    const toolsOf = (/** @type {string} */ id) => a.triggers.of(Number(id.slice(1))).map((/** @type {any} */ t) => t.tool);
    assert.deepEqual([everywhere, here, there, gone].map(toolsOf), [["bash"], ["bash"], ["bash"], ["bash"]]);
    const refs = (/** @type {any[]} */ rows) => rows.map((it) => `i${it.id}`);
    assert.deepEqual(refs(a.triggers.onTools(pid, ["read", "bash"])), [everywhere, here], "its project's and everywhere's, oldest first; not another project's, not a retired one");
    assert.deepEqual(a.triggers.onTools(pid, ["read"]), []);
    const s = w.session("a");
    const one = await s.send("start the docker compose stack");
    const two = await s.send("and publish the package");
    const other = await w.session("b").send("start the docker compose stack");
    assert.deepEqual([one.requestId, two.requestId, other.requestId].map((r) => a.turnOfRequest(one.prep.chain, r)), [one.prep.turn, two.prep.turn, null], "each request's own turn; another session's request is none of its");
    assert.equal(a.turnOfRequest(other.prep.chain, one.requestId), null);
    assert.equal(a.turnOfRequest(one.prep.chain, null), null);
    const shown = a.injections.shownIn(one.prep.chain, 0);
    assert.ok(shown.includes(everywhere), JSON.stringify(shown));
    assert.deepEqual(a.injections.shownIn(one.prep.chain, Date.now() + 60_000), [], "nothing was shown after now");
  }));

test("a brief keeps to its room — the budget asked, else the briefing's and the turn block's together — and what does not fit is counted or left out", () =>
  world({}, async (w) => {
    const { sit } = await w.session("warm").send("hello");
    const pid = sit.project.id;
    const owner = w.svc.scope({ role: "owner", project: pid });
    for (const n of [1, 2, 3, 4, 5, 6]) await owner.remember(`Rule ${n} of releases: always tag release candidate ${n} before it goes out to the staging cluster for its smoke run.`, { kind: "rule" });
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
      await owner.remember(`Staging fact ${n}: the smoke run of a release candidate uses node pool ${n}, in region eu-west-${n}, with its own database snapshot.`, { kind: "fact" });
    await w.settle();
    const brief = (/** @type {any} */ o = {}) => w.svc.scope({ role: "agent", project: pid }).brief({ purpose: "subagent", task: "smoke run the release candidate on the staging cluster", ...o });
    /** Its lines between the head and the legend. @param {any} b */
    const body = (b) => b.text.split("\n").slice(1).filter((/** @type {string} */ l) => !l.startsWith("✓n:") && !l.startsWith("A line marked") && !l.startsWith('A "How to"')).join("\n");
    const roomy = await brief();
    assert.equal(roomy.layers.rules, 6, roomy.text);
    const tight = await brief({ budget: 300 });
    assert.ok(tight.layers.rules > 0 && tight.layers.rules < 6, tight.text);
    assert.ok(tight.text.includes(`\n…and ${6 - tight.layers.rules} more; filament_memory_search finds them.`), tight.text);
    assert.ok(tight.layers.related > 0, tight.text);
    assert.ok(body(tight).length <= 300 * 4 + 400, `${body(tight).length} characters in a room of ${300 * 4}, the blocks' heads aside: ${tight.text}`);
    assert.ok(tight.count < roomy.count);
    w.cfg.memory.autopilot.briefingTokens = 100;
    w.cfg.memory.autopilot.turnTokens = 1400;
    assert.equal((await brief()).layers.rules, 6, "the turn block's share is in the room");
  }));

test("a brief's corrections are always said — each once, ten at most, of what the session was shown in the last fourteen days — and so is the first procedure its task names, however full the room", () =>
  world({}, async (w) => {
    const { sit } = await w.session("warm").send("hello");
    const pid = sit.project.id;
    const owner = w.svc.scope({ role: "owner", project: pid });
    /** @type {string[]} */
    const facts = [];
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
      facts.push((await owner.remember(`Staging fact ${n}: the smoke run of a release candidate uses node pool ${n}, in region eu-west-${n}, with its own database snapshot.`, { kind: "fact" })).id);
    const how = (await owner.remember("How to smoke test a release: 1. deploy the candidate 2. run `npm run smoke` 3. read the report", { kind: "procedure" })).id;
    const trap = (await owner.remember("Never run `npm run smoke` bare here: run it as `CI=1 npm run smoke`.", { kind: "fact" })).id;
    await w.settle();
    plainDossier(w, pid);
    // A first message with a task: one with none ("hello") is briefed the procedures whole since 10-29, and a brief
    // leaves out what rides beside it.
    const first = await w.session("parent").send("the staging cluster goes away this week");
    const chain = first.prep.chain;
    // The session was shown every fact, and then the first once more, by its id and by its engine id (an older form).
    const engineId = w.svc.archive.items.get(Number(facts[0].slice(1))).memory_id;
    assert.ok(engineId, "the engine holds the first fact");
    w.svc.archive.injections.add({ requestId: null, chainId: chain, turnId: first.prep.turn, kind: "turn", ids: facts, tokens: 1 });
    w.svc.archive.injections.add({ requestId: null, chainId: chain, turnId: first.prep.turn, kind: "turn", ids: [facts[0], `e:${engineId}`], tokens: 1 });
    for (const id of facts) await owner.forget(id, { reason: "the staging cluster is gone" });
    await w.settle();
    const brief = () => w.svc.scope({ role: "agent", project: pid, chain }).brief({ purpose: "subagent", task: "smoke test a release", tools: ["bash"], budget: 300 });
    const b = await brief();
    const errata = b.text.split("\n").filter((l) => l.startsWith("Memory correction: "));
    assert.equal(b.layers.errata, 10, b.text);
    assert.equal(new Set(errata.map((l) => /^Memory correction: \[(i\d+)\]/.exec(l)?.[1])).size, 10, "each once");
    assert.ok(errata[0].startsWith(`Memory correction: [${facts[0]}] `), "the most recently shown first");
    assert.ok(errata.join("\n").length > 300 * 4, "the corrections alone fill the room");
    assert.match(b.text, new RegExp(`\\nHow to do it here \\(the procedures your task names\\):\\n- \\[${how} procedure · user said`), "the task's procedure shows all the same");
    assert.deepEqual([b.layers.procedures, b.layers.pitfalls, b.text.includes(`[${trap} `)], [1, 0, false], "a pitfall waits for room");
    const now = w.svc.brain.now;
    w.svc.brain.now = () => Date.now() + 15 * 86400000;
    try {
      assert.equal((await brief()).layers.errata, 0, "fourteen days on, what the session was shown then is no correction of its now");
    } finally {
      w.svc.brain.now = now;
    }
  }));

test("what rides beside a brief is what the session's own settings place, and is said neither as a rule, nor as a pitfall, nor as a dossier line on it alone; a session with no briefing has nothing riding", () =>
  inFolder((dir) =>
    world({ cwd: dir }, async (w) => {
      const { sit } = await w.session("warm").send("hello");
      const pid = sit.project.id;
      const owner = w.svc.scope({ role: "owner", project: pid });
      const said = async (/** @type {string} */ text, /** @type {string} */ kind) => (await owner.remember(text, { kind })).id;
      const lint = await said("Always run the linter before committing.", "rule");
      const trap = await said("Never run `docker compose up` bare here: run it as `docker compose -f dev.yml up`.", "fact");
      const port = await said("The API server listens on port 8080.", "fact");
      await w.settle();
      const task = "start the docker compose stack and lint the API server";
      const first = await w.session("parent").send(task);
      const chain = first.prep.chain;
      for (const id of [lint, trap, port]) assert.ok(first.seen.includes(`[${id} `) || first.seen.includes(`${id}]`), `${id} in the briefing: ${first.seen}`);
      const push = await said("Never force-push to main.", "rule");
      const db = await said("The database listens on port 5432.", "fact");
      await w.settle();
      w.svc.archive.dossiers.add({
        projectId: pid,
        sections: [{ title: "Facts", lines: [{ text: "The API is on 8080.", cites: [port] }, { text: "The API is on 8080, the database on 5432.", cites: [port, db] }] }],
        cites: [Number(port.slice(1)), Number(db.slice(1))],
        basis: "test",
      });
      const brief = () => w.svc.scope({ role: "agent", project: pid, chain }).brief({ purpose: "subagent", task, tools: ["bash"] });
      const b = await brief();
      assert.ok(b.text.includes("beyond the session's briefing"), b.text);
      assert.deepEqual(layer(b.text, "The user's rules and preferences").map((l) => l.replace(/ · \d{4}-\d\d-\d\d\]/, "]")), [`- [${push} rule · user said] Never force-push to main.`], "the rule said since");
      assert.ok(!b.text.includes(" more; filament_memory_search finds them."), `no count of the one that rides: ${b.text}`);
      assert.ok(!b.text.includes(`[${trap} `), "nor the pitfall it carries");
      assert.deepEqual(layer(b.text, "Facts:"), [`- The API is on 8080, the database on 5432. [${port}, ${db}]`], "a dossier line on what it carries alone is not said; one on what came since is");
      const rides = async () => {
        const t = (await brief()).text;
        return [t.includes("Always run the linter"), t.includes(`[${trap} `), t.includes("beyond the session's briefing")];
      };
      // The briefing is a mode setting: a project's mode is its default preset, so a project row naming it (no writer
      // puts it there) is not read (HarnessV3-AtHome AH-C1). (fails before: yes — the row was read whole, and the
      // project turned every session's briefing off)
      w.svc.archive.setProjectSettings(pid, { memory: { briefing: false } });
      assert.deepEqual(await rides(), [false, false, true], "a project row does not turn the briefing off");
      w.svc.archive.setProjectSettings(pid, { memory: {} });
      w.svc.archive.setChainSettings(chain, { memory: { briefing: false } });
      assert.deepEqual(await rides(), [true, true, false], "the session turns it off: nothing rides");
      w.svc.archive.setChainSettings(chain, { memory: { briefing: true } });
      assert.deepEqual(await rides(), [false, false, true], "and on again");
      // A session whose first request was quiet has no briefing: nothing rides, whatever the settings say.
      w.svc.archive.setChainSettings(chain, null);
      const bare = await w.session("bare").send(task, { headers: { "x-filament-memory": "off" } });
      assert.equal(w.svc.archive.getChain(bare.prep.chain).briefing, null);
      const unbriefed = (await w.svc.scope({ role: "agent", project: pid, chain: bare.prep.chain }).brief({ purpose: "subagent", task })).text;
      assert.ok(unbriefed.includes("Always run the linter") && !unbriefed.includes("beyond the session's briefing"), unbriefed);
    }),
  ));

test("the pitfalls a brief gives are those a call would hear — armed by the user's word or a second session, standing, sure enough — with their marks, for a shell by any name", () =>
  inFolder((dir) =>
    world({ cwd: dir }, async (w) => {
      writeFileSync(join(dir, "package.json"), '{"name":"x"}');
      writeFileSync(join(dir, "bun.lock"), "{}");
      const { sit } = await w.session("warm").send("hello");
      const pid = sit.project.id;
      const owner = w.svc.scope({ role: "owner", project: pid });
      const said = async (/** @type {any} */ scope, /** @type {string} */ text) => (await scope.remember(text, { kind: "fact" })).id;
      const users = await said(owner, "Never run `docker compose up` bare here: run it as `docker compose -f dev.yml up`.");
      const learned = await said(w.svc.scope({ role: "model", project: pid }), "Never run `make test` bare here: run it as `make test CI=1`.");
      // A model's note another session said again: armed, and a suspicion lowers it (never the user's word: M7-D68).
      const doubted = await said(w.svc.scope({ role: "model", project: pid }), "Never run `npm audit` bare here: run it as `npm audit --omit=dev`.");
      w.svc.archive.items.note(Number(doubted.slice(1)), "evidence", { by: "learner", detail: { chain: "c0" } });
      const changed = await said(owner, "Never run `node src/api.js` bare here: run it as `node src/api.js --port 8080`.");
      const gone = await said(owner, "Never run `node src/db.js` bare here: run it as `node src/db.js --dry`.");
      const contested = await said(owner, "This project uses pnpm as its package manager. Never run `pnpm install` bare here: run it as `pnpm install --frozen-lockfile`.");
      await w.settle();
      for (const id of [users, learned, doubted, changed, gone, contested]) assert.deepEqual(w.svc.archive.triggers.of(Number(id.slice(1))).map((/** @type {any} */ t) => t.tool), ["bash"], id);
      // A dossier rendered from the claims says no pitfall in a brief: a worker with no shell hears none, a worker with
      // a shell hears its own in their layer.
      const brief = async (/** @type {string[]} */ tools) => (await w.svc.scope({ role: "agent", project: pid }).brief({ purpose: "subagent", task: "start the stack", tools })).text;
      const reader = await brief(["read", "grep", "glob"]);
      assert.ok(!reader.includes("Never run"), reader);
      const worker = await brief(handsIn("edit"));
      assert.ok(!worker.includes("\nPitfalls:\n") && layer(worker, "Pitfalls of the tools you have").length > 0, worker);
      plainDossier(w, pid);
      for (const n of [1, 2, 3]) w.svc.archive.items.note(Number(doubted.slice(1)), "suspected", { by: "learner", detail: { chain: `c${n}` } });
      writeFileSync(join(dir, "src", "api.js"), "export const port = 9090;\n");
      rmSync(join(dir, "src", "db.js"));
      const traps = async (/** @type {string[]} */ tools) => layer(await brief(tools), "Pitfalls of the tools you have");
      const t = await traps(["Bash"]);
      const of = (/** @type {string} */ id) => t.filter((l) => l.startsWith(`- [${id} `));
      assert.equal(of(users).length, 1, `Claude Code's Bash is the shell: ${t}`);
      assert.deepEqual(of(learned), [], "learned, and said by one session: not armed");
      assert.deepEqual(of(doubted), [], "under the confidence gate");
      assert.match(of(changed)[0] ?? "", / · file changed since\] /);
      assert.deepEqual(of(gone), [], "its file is gone: held back");
      assert.deepEqual(of(contested), [], "the environment says otherwise: held back");
      assert.equal(t.length, 2, t.join("\n"));
      w.svc.archive.items.note(Number(learned.slice(1)), "evidence", { by: "learner", detail: { chain: "another" } });
      assert.match((await traps(["bash"])).join("\n"), new RegExp(`^- \\[${learned} fact · assistant noted · [^\\]]*✓2[^\\]]*\\] Never run`, "m"), "a second session arms it");
      assert.deepEqual(await traps(["read", "grep"]), []);
    }),
  ));

test("the open threads a brief gives are on the files its task names, standing and sure enough, with their marks", () =>
  inFolder((dir) =>
    world({ cwd: dir }, async (w) => {
      writeFileSync(join(dir, "src", "cli.js"), "export {};\n");
      writeFileSync(join(dir, "src", "old.js"), "export {};\n");
      const { sit } = await w.session("warm").send("hello");
      const pid = sit.project.id;
      const owner = w.svc.scope({ role: "owner", project: pid });
      const thread = async (/** @type {string} */ text) => (await owner.remember(text, { kind: "thread" })).id;
      const api = await thread("src/api.js still needs the retry wrapper.");
      await thread("src/db.js still needs the pool limit.");
      // A learned thread: a suspicion lowers it (never the user's word: M7-D68).
      const cli = `i${(await w.svc.brain.fileLearned({ projectId: pid, chainId: "l1", kind: "thread", text: "src/cli.js still needs its help text.", importance: 0.6 })).id}`;
      await thread("src/old.js still needs its last caller removed.");
      await w.settle();
      plainDossier(w, pid);
      for (const n of [1, 2, 3]) w.svc.archive.items.note(Number(cli.slice(1)), "suspected", { by: "learner", detail: { chain: `c${n}` } });
      writeFileSync(join(dir, "src", "api.js"), "export const port = 9090;\n");
      rmSync(join(dir, "src", "old.js"));
      const b = await w.svc.scope({ role: "agent", project: pid }).brief({ purpose: "subagent", task: "Work on src/api.js, src/cli.js and src/old.js.", tools: [] });
      assert.deepEqual(
        layer(b.text, "Open threads on the files your task names"),
        [`- [${api} thread · user said · open thread on src/api.js · file changed since] src/api.js still needs the retry wrapper.`],
        "not one on a file it does not name, one under the gate, or one whose file is gone",
      );
    }),
  ));

test("a brief quotes another session's words under their own head, never as a claim", () =>
  world({}, async (w) => {
    await w.session("other").send("the blue-green switch on staging drains for five minutes before the cutover");
    const { sit, prep } = await w.session("parent").send("hello");
    const pid = sit.project.id;
    const brief = (/** @type {string} */ task) => w.svc.scope({ role: "agent", project: pid, chain: prep.chain }).brief({ purpose: "subagent", task });
    const b = await brief("the blue-green switch drains before the cutover");
    assert.ok(layer(b.text, "Words from past sessions (quotes, not checked facts):").some((l) => /^- \[s:[^\]]+\] turn 1: .*\[blue-green\] \[switch\]/.test(l)), b.text);
    assert.deepEqual(layer(b.text, "Relevant to your task:"), []);
  }));

test("a brief's search leaves out what rides beside it, so what came since is not crowded out of its twelve", () =>
  world({}, async (w) => {
    const { sit } = await w.session("warm").send("hello");
    const pid = sit.project.id;
    const owner = w.svc.scope({ role: "owner", project: pid });
    w.cfg.memory.autopilot.briefingTokens = 8000;
    /** @type {string[]} */
    const strong = [];
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
      strong.push((await owner.remember(`Kafka consumer lag alert threshold ${n}: the orders consumer group ${n} pages when its lag passes ${n}000 messages.`, { kind: "fact" })).id);
    await w.settle();
    const task = "kafka consumer lag alert threshold for the orders consumer group";
    const first = await w.session("parent").send(task);
    const riding = strong.filter((id) => first.seen.includes(`[${id} `));
    assert.ok(riding.length >= 12, `${riding.length} ride`);
    const weak = (await owner.remember("The alert threshold file is alerts.yml.", { kind: "fact" })).id;
    await w.settle();
    plainDossier(w, pid);
    const b = await w.svc.scope({ role: "agent", project: pid, chain: first.prep.chain }).brief({ purpose: "subagent", task });
    assert.ok(layer(b.text, "Relevant to your task:").some((l) => l.startsWith(`- [${weak} `)), b.text);
  }));
