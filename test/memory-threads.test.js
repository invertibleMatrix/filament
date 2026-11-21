// @ts-check
// Open threads (HarnessV3-Memory M5-5, MD-15): the unfinished work a session ends with becomes thread claims; one that
// names its file resurfaces when a later call touches that file, once a session; and a later session that finishes it
// closes it, as the learner judges among the open threads it is shown — the user's own thread is asked about instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { world } from "./fixtures/memory-world.mjs";
import { executeMemoryTool, MEMORY_TOOL_NAMES, MEMORY_TOOL_SCHEMAS } from "../src/app/memory-tools.js";

const CC_UA = { "user-agent": "claude-cli/2.1.258 (external, cli)" };
const DAY = 86400000;

/** A project folder with a guide in it, and a world whose learner answers what the test says. @param {(w: any, o: { dir: string, answer: (a: any) => void, prompts: string[] }) => Promise<void>} body */
async function threadsWorld(body) {
  const dir = mkdtempSync(join(tmpdir(), "filament-threads-"));
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "docs", "migration.md"), "# Migration\n");
  /** @type {any} */
  let answer = {};
  /** @type {string[]} */
  const prompts = [];
  const callModel = async (/** @type {any} */ a) => {
    if (a.purpose === "learn") prompts.push(a.user);
    return JSON.stringify(a.purpose === "learn" ? answer : {});
  };
  try {
    await world({ cwd: dir, models: { summarizer: "learn-1" }, callModel }, (w) => body(w, { dir, answer: (a) => (answer = a), prompts }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a session's unfinished work becomes open threads; one that names its file resurfaces when a call touches it, once a session", () =>
  threadsWorld(async (w, { dir, answer }) => {
    const { prep, sit } = await w.session("a").send("write the migration guide");
    const projectId = sit.project.id;
    answer({ title: "Migration guide", state: { summary: "s", done: ["wrote the intro"], open: ["docs/migration.md still needs a plugins section", "the docs/ folder needs an index page"], next: ["ask the user which plugins to cover"] }, items: [] });
    const out = await w.svc.learner.learnChain(prep.chain, { reason: "manual", force: true });
    assert.equal(out.items, 3);
    const threads = w.svc.archive.items.standing(projectId).filter((/** @type {any} */ it) => it.kind === "thread");
    assert.deepEqual(
      threads.map((/** @type {any} */ t) => [t.text, t.status, t.origin]),
      [
        ["docs/migration.md still needs a plugins section", "inferred", "learner"],
        ["the docs/ folder needs an index page", "inferred", "learner"],
        ["ask the user which plugins to cover", "inferred", "learner"],
      ],
    );
    const [guide, folder, ask] = threads;
    assert.deepEqual(w.svc.archive.anchors.of(guide.id).map((/** @type {any} */ a) => [a.name, a.kind]), [["docs/migration.md", "file"]]);
    assert.deepEqual(w.svc.archive.anchors.of(folder.id).map((/** @type {any} */ a) => [a.name, a.kind]), [["docs/", "folder"]]);
    const remind = (/** @type {string} */ chainId, /** @type {string} */ tool, /** @type {any} */ input) => w.svc.brain.remindersFor({ projectId, chainId, turnId: 3, tool, input });
    const first = remind("b", "Read", { file_path: join(dir, "docs", "migration.md") });
    assert.deepEqual(
      first.map((/** @type {any} */ m) => [m.kind, m.line]),
      [
        ["thread", `[memory i${guide.id} · inferred · open thread on docs/migration.md] docs/migration.md still needs a plugins section`],
        ["thread", `[memory i${folder.id} · inferred · open thread on docs/] the docs/ folder needs an index page`],
      ],
      "the file's thread, and the thread of the folder that holds it",
    );
    assert.deepEqual(remind("b", "Edit", { file_path: "docs/migration.md" }), [], "once a session");
    assert.deepEqual(remind("c", "Bash", { command: "cat docs/migration.md | head -5" }).map((/** @type {any} */ m) => m.id), [`i${guide.id}`, `i${folder.id}`], "a shell command naming the file, in another session");
    assert.deepEqual(remind("d", "Read", { file_path: join(dir, "README.md") }), [], "another file");
    assert.deepEqual(remind("d", "Grep", { path: join(dir, "docs"), pattern: "x" }).map((/** @type {any} */ m) => m.id), [`i${folder.id}`], "the folder is the folder thread's, not the file's");
    assert.deepEqual(remind("e", "Read", { file_path: "C:\\elsewhere\\docs\\migration.md" }), [], "outside the project");
    assert.deepEqual(remind("e", "Read", {}), []);
    assert.deepEqual(
      w.svc.archive.items.events(guide.id).filter((/** @type {any} */ e) => e.action === "fired").map((/** @type {any} */ e) => [e.by, e.detail]),
      [
        ["filament", { chain: "b", turn: 3, file: "docs/migration.md" }],
        ["filament", { chain: "c", turn: 3, file: "docs/migration.md" }],
      ],
    );
    assert.equal(ask.id > 0, true);
    // On a proxied client's leg the thread rides on the result, recorded as an injection of its own kind.
    const leg = {
      format: "anthropic",
      body: {
        model: "claude-x",
        system: `You are Claude Code.\n<env>\nWorking directory: ${dir}\nIs a git repo: yes\n</env>`,
        messages: [
          { role: "user", content: "add the plugins section" },
          { role: "assistant", content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: join(dir, "docs", "migration.md") } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "r1", content: "# Migration" }] },
        ],
      },
      headers: { ...CC_UA, "x-session-id": "leg" },
      model: "claude-x",
    };
    const p = await w.svc.prepare(w.svc.situate(leg), { requestId: "leg-1" });
    assert.deepEqual([p.threads, p.pitfalls], [2, undefined], p.notes.join(" | "));
    assert.match(JSON.stringify(leg.body.messages.at(-1)), /Memory on the tool call the model just made \(Filament\):\\n- \[memory i\d+ · inferred · open thread on docs\/migration\.md\]/);
    assert.deepEqual(w.svc.archive.injections.forRequest("leg-1").map((/** @type {any} */ r) => r.kind), ["thread"]);
  }));

test("a later session that finishes a thread closes it, as the learner judged among the threads it was shown; the user's own is asked about", () =>
  threadsWorld(async (w, { dir, answer, prompts }) => {
    const { prep, sit } = await w.session("a").send("write the migration guide");
    const projectId = sit.project.id;
    answer({ state: { summary: "s", done: [], open: ["docs/migration.md still needs a plugins section", "decide whether v1 configs keep loading"], next: [] }, items: [{ kind: "fact", text: "The migration guide lives in docs/migration.md.", importance: 0.6, turn: 1 }] });
    await w.svc.learner.learnChain(prep.chain, { reason: "manual", force: true });
    const standing = () => w.svc.archive.items.standing(projectId);
    const [guide, configs] = standing().filter((/** @type {any} */ it) => it.kind === "thread");
    const fact = standing().find((/** @type {any} */ it) => it.kind === "fact");
    const users = (await w.svc.brain.remember("Open: pick the release date for v2.", { kind: "thread", projectId, by: "person" })).itemId;
    // The next session: the learner is shown the open threads, freshest said first, and answers by id.
    const { prep: later } = await w.session("b").send("add the plugins section, and we settled the release date");
    answer({
      state: {
        summary: "s",
        done: ["plugins section written"],
        open: [],
        next: [],
        closed: [
          { id: `i${guide.id}`, because: "the plugins section was written" },
          { id: `i${users}`, because: "the date was settled" },
          { id: `i${fact.id}`, because: "not a thread" },
          { id: "i99999", because: "never shown" },
          `i${guide.id}`,
        ],
        still: [`i${configs.id}`, "i88888"],
      },
      items: [],
    });
    const out = await w.svc.learner.learnChain(later.chain, { reason: "manual", force: true });
    assert.match(prompts.at(-1) ?? "", new RegExp(`The project's open threads, said in earlier sessions or earlier in this one \\(by id\\):\\n- i${users}: Open: pick the release date for v2\\.\\n- i\\d+: (?:docs/migration|decide whether)`));
    assert.deepEqual(out.threads, { closed: 1, asked: 1, still: 1 });
    const g = w.svc.archive.items.get(guide.id);
    assert.equal(g.status, "dismissed");
    assert.deepEqual(
      w.svc.archive.items.events(guide.id).filter((/** @type {any} */ e) => e.action === "status" || e.action === "closed").map((/** @type {any} */ e) => [e.action, e.by, e.reason ?? null, e.detail?.chain ?? null]),
      [
        ["status", "learner", `done: the plugins section was written (session ${later.chain})`, null],
        ["closed", "learner", null, later.chain],
      ],
    );
    assert.equal(w.svc.archive.items.get(fact.id).status, "inferred", "only a thread closes");
    assert.deepEqual(w.svc.archive.items.events(configs.id).filter((/** @type {any} */ e) => e.action === "evidence").map((/** @type {any} */ e) => e.detail.chain), [later.chain], "still open: said again");
    assert.deepEqual(w.svc.brain.remindersFor({ projectId, chainId: "z", tool: "Read", input: { file_path: join(dir, "docs", "migration.md") } }), [], "a closed thread resurfaces no more");
    // The user's own thread is theirs to close.
    assert.equal(w.svc.archive.items.get(users).status, "confirmed");
    const [q] = w.svc.brain.questions(projectId);
    assert.deepEqual([q.kind, q.claims.map((/** @type {any} */ c) => c.id), q.reason], ["close", [`i${users}`], `session ${later.chain} says it is done: the date was settled`]);
    assert.ok(w.svc.brain.openThreads(projectId).some((/** @type {any} */ t) => t.id === `i${users}`), "it stays open until they answer");
    const r = await w.svc.brain.decide(q.id, "accept", { by: "owner" });
    assert.equal(r.status, "accepted");
    assert.equal(w.svc.archive.items.get(users).status, "dismissed");
    assert.deepEqual(w.svc.archive.items.events(users).filter((/** @type {any} */ e) => e.action === "closed").map((/** @type {any} */ e) => [e.by, e.detail]), [["owner", { chain: later.chain }]]);
    // A run read again is shown them as they stand now: the closed one no more.
    await w.svc.learner.learnChain(later.chain, { reason: "manual", force: true });
    assert.match(prompts.at(-1) ?? "", new RegExp(`\\n- i${configs.id}: decide whether v1 configs keep loading`));
    assert.ok(!(prompts.at(-1) ?? "").includes(`i${guide.id}:`), "a closed thread is not shown");
  }));

test("with no open thread nothing is listed, and a closed or still id the learner was not shown is passed over", () =>
  threadsWorld(async (w, { answer, prompts }) => {
    const { prep, sit } = await w.session("a").send("hello");
    answer({ state: { summary: "s", done: [], open: [], next: [], closed: [{ id: "i1", because: "x" }], still: ["i1"] }, items: [] });
    const out = await w.svc.learner.learnChain(prep.chain, { reason: "manual", force: true });
    assert.ok(!(prompts.at(-1) ?? "").includes("open threads"), prompts.at(-1));
    assert.deepEqual(out.threads, { closed: 0, asked: 0, still: 0 });
    assert.deepEqual(w.svc.brain.openThreads(sit.project.id), []);
    assert.deepEqual(w.svc.brain.openThreads("none"), [], "no project, no threads");
  }));

test("a thread a month quiet resurfaces at no call; the one said again is listed first; only a shown thread is settled, and once", () =>
  threadsWorld(async (w, { dir, answer }) => {
    const { prep, sit } = await w.session("a").send("write the migration guide");
    const projectId = sit.project.id;
    answer({ state: { summary: "s", done: [], open: ["docs/migration.md still needs a plugins section", "decide whether v1 configs keep loading"], next: [] }, items: [] });
    await w.svc.learner.learnChain(prep.chain, { reason: "manual", force: true });
    const [guide, configs] = w.svc.archive.items.standing(projectId).filter((/** @type {any} */ it) => it.kind === "thread");
    const read = { tool: "Read", input: { file_path: join(dir, "docs", "migration.md") } };
    // An open thread ages from when a session last said it (M4-5): a month on, the confidence gate holds it at a call too.
    const real = w.svc.brain.now;
    w.svc.brain.now = () => real() + 30 * DAY;
    assert.deepEqual(w.svc.brain.threadsFor({ projectId, chainId: "b", ...read }), [], "a month quiet: under the gate");
    w.svc.brain.now = real;
    assert.deepEqual(w.svc.brain.threadsFor({ projectId, chainId: "b", ...read }).map((/** @type {any} */ m) => m.id), [`i${guide.id}`], "fresh, it resurfaces");
    // A call that walks into a pitfall and touches a thread's file: the pitfall first.
    await w.svc.brain.remember("no, don't run npm test directly inside Claude Code; run it as env -u CLAUDECODE npm test.", { kind: "rule", projectId, by: "person" });
    assert.deepEqual(w.svc.brain.remindersFor({ projectId, chainId: "c", tool: "Bash", input: { command: "npm test docs/migration.md" } }).map((/** @type {any} */ m) => m.kind), ["pitfall", "thread"]);
    // The most recently said first: said alike, the newer; an older one a later session said again, before it.
    assert.deepEqual(w.svc.brain.openThreads(projectId).map((/** @type {any} */ t) => t.id), [`i${configs.id}`, `i${guide.id}`]);
    const clock = w.svc.archive.now;
    w.svc.archive.now = () => clock() + 60000;
    assert.deepEqual(await w.svc.brain.settleThreads({ projectId, chainId: "d", shown: [`i${guide.id}`, `i${configs.id}`], still: [`i${guide.id}`] }), { closed: 0, asked: 0, still: 1 });
    w.svc.archive.now = clock;
    assert.deepEqual(w.svc.brain.openThreads(projectId).map((/** @type {any} */ t) => t.id), [`i${guide.id}`, `i${configs.id}`], "the one said again first");
    // Only a thread the learner was shown, and only a thread, is settled; one it asks about is not also said again.
    const fact = w.svc.archive.items.add({ projectId, kind: "fact", text: "The migration guide lives in docs/migration.md.", status: "inferred", origin: "learner", importance: 0.6 });
    assert.deepEqual(await w.svc.brain.settleThreads({ projectId, chainId: "e", shown: [`i${guide.id}`], closed: [`i${configs.id}`] }), { closed: 0, asked: 0, still: 0 }, "not shown");
    assert.deepEqual(await w.svc.brain.settleThreads({ projectId, chainId: "e", shown: [`i${fact.id}`], closed: [`i${fact.id}`] }), { closed: 0, asked: 0, still: 0 }, "not a thread");
    assert.deepEqual([w.svc.archive.items.get(configs.id).status, w.svc.archive.items.get(fact.id).status], ["inferred", "inferred"]);
    const users = (await w.svc.brain.remember("Open: pick the release date for v2.", { kind: "thread", projectId, by: "person" })).itemId;
    const both = await w.svc.brain.settleThreads({ projectId, chainId: "e", shown: [`i${users}`], closed: [{ id: `i${users}`, because: "the date was settled" }], still: [`i${users}`] });
    assert.deepEqual(both, { closed: 0, asked: 1, still: 0 }, "asked about: not also said again");
    assert.deepEqual(await w.svc.brain.settleThreads({ projectId, chainId: "e", shown: [`i${users}`], closed: [`i${users}`] }), { closed: 0, asked: 0, still: 0 }, "asked once a session");
    const [q] = w.svc.brain.questions(projectId);
    await w.svc.brain.decide(q.id, "reject", { by: "owner" });
    assert.deepEqual(await w.svc.brain.settleThreads({ projectId, chainId: "f", shown: [`i${users}`], closed: [`i${users}`] }), { closed: 0, asked: 1, still: 0 }, "the user kept it open; a later session that says it is done asks again");
    assert.deepEqual(w.svc.archive.items.events(users).filter((/** @type {any} */ e) => e.action === "evidence"), []);
  }));

// (fails before: yes — the live leg's agents "corrected" a finished thread to "Done …" and "Resolved …": it stayed open and resurfaced at calls on its file)
test("M7-D64: a model closes a thread whose work is done with filament_memory_close — closed as the learner closes one, said at no call; the user's own is asked about; any other claim refused; a sub-agent's close names it", () =>
  threadsWorld(async (w, { dir, answer }) => {
    const { prep, sit } = await w.session("a").send("write the migration guide");
    const projectId = sit.project.id;
    answer({ state: { summary: "s", done: [], open: ["docs/migration.md still needs a plugins section", "decide whether v1 configs keep loading"], next: [] }, items: [{ kind: "fact", text: "The migration guide lives in docs/migration.md.", importance: 0.6, turn: 1 }] });
    await w.svc.learner.learnChain(prep.chain, { reason: "manual", force: true });
    const standing = () => w.svc.archive.items.standing(projectId);
    const [guide, configs] = standing().filter((/** @type {any} */ it) => it.kind === "thread");
    const fact = standing().find((/** @type {any} */ it) => it.kind === "fact");
    const users = (await w.svc.brain.remember("Open: pick the release date for v2.", { kind: "thread", projectId, by: "person" })).itemId;
    const model = w.svc.scope({ role: "model", project: projectId, chain: "b", turn: 4 });
    const tool = async (/** @type {string} */ name, /** @type {any} */ input, s = model) => JSON.parse(await executeMemoryTool(s, name, input));
    const guideFile = join(dir, "docs", "migration.md");
    assert.equal(w.svc.brain.remindersFor({ projectId, chainId: "y", tool: "Read", input: { file_path: guideFile } }).length, 1, "open, it is said at a call on its file");
    assert.deepEqual(await tool("filament_memory_close", { id: `i${guide.id}`, because: "the plugins section is written" }), { ok: true, id: `i${guide.id}`, status: "dismissed", closed: true });
    assert.deepEqual(
      w.svc.archive.items.events(guide.id).filter((/** @type {any} */ e) => e.action === "status" || e.action === "closed").map((/** @type {any} */ e) => [e.action, e.by, e.reason ?? null, e.detail?.chain ?? null, e.detail?.turn ?? null]),
      [
        ["status", "model", "done: the plugins section is written (session b)", null, null],
        ["closed", "model", null, "b", 4],
      ],
      "closed as the learner closes one",
    );
    assert.deepEqual(w.svc.brain.remindersFor({ projectId, chainId: "z", tool: "Read", input: { file_path: guideFile } }), [], "a closed thread is said at no call");
    assert.ok(!w.svc.brain.openThreads(projectId).some((/** @type {any} */ t) => t.id === `i${guide.id}`));
    assert.deepEqual(await tool("filament_memory_close", { id: `i${guide.id}`, because: "again" }), { ok: true, id: `i${guide.id}`, status: "dismissed", already: true }, "closing it twice is closing it once");
    // The user's own thread is theirs to close: asked, and open until they answer.
    const asked = await tool("filament_memory_close", { id: `i${users}`, because: "the date is set" });
    const [q] = w.svc.brain.questions(projectId);
    assert.deepEqual(asked, { ok: true, id: `i${users}`, asked: q.id, note: "the user's own thread: they are asked to close it, and it stays open until they answer" });
    assert.deepEqual([q.kind, q.reason, w.svc.archive.items.get(users).status], ["close", "session b says it is done: the date is set", "confirmed"]);
    // Anything but an open thread is refused in words; no reason given reads as the session's.
    assert.deepEqual(await tool("filament_memory_close", { id: `i${fact.id}`, because: "x" }), { ok: false, error: `i${fact.id} is a fact, not an open thread: filament_memory_correct changes it` });
    assert.deepEqual(await tool("filament_memory_close", { id: "i99999" }), { ok: false, error: "no memory i99999" });
    // A sub-agent's close is its own, named on the history.
    const finder = { agent: "sa_0000000c", type: "general-purpose", model: "glm-5.3" };
    const sub = w.svc.scope({ role: "model", project: projectId, chain: "b", turn: 4, conversation: "sa_0000000c", finder });
    assert.equal((await tool("filament_memory_close", { id: `i${configs.id}` }, sub)).closed, true);
    // (fails before: yes — its closed event said `chain: null`) With no session, an agent's surface with none, the words name none.
    const bare = w.svc.scope({ role: "agent", project: projectId });
    const loose = (await w.svc.brain.fileLearned({ projectId, chainId: "l9", kind: "thread", text: "src/cache.js still needs an eviction policy", importance: 0.6 })).id;
    assert.equal((await tool("filament_memory_close", { id: `i${loose}`, because: "evicts the oldest" }, bare)).closed, true);
    assert.deepEqual(
      w.svc.archive.items.events(loose).filter((/** @type {any} */ e) => e.action === "status" || e.action === "closed").map((/** @type {any} */ e) => [e.action, e.by, e.reason ?? null, "chain" in (e.detail || {})]),
      [["status", "agent", "done: evicts the oldest", false], ["closed", "agent", null, false]],
    );
    const again = await tool("filament_memory_close", { id: `i${users}`, because: "the date is set" }, bare);
    assert.equal(w.svc.brain.questions(projectId).find((/** @type {any} */ x) => x.id === again.asked)?.reason, "an agent says it is done: the date is set");
    const ev = w.svc.archive.items.events(configs.id).filter((/** @type {any} */ e) => e.action === "status" || e.action === "closed");
    assert.deepEqual(ev.map((/** @type {any} */ e) => [e.action, e.reason ?? null, e.detail?.finder ?? null]), [["status", "done: the session finished it (session b)", finder], ["closed", null, finder]]);
    // The words that teach it.
    assert.ok(MEMORY_TOOL_NAMES.includes("filament_memory_close"));
    assert.deepEqual(Object.keys(MEMORY_TOOL_SCHEMAS.close.schema.properties), ["id", "because"]);
    assert.match(MEMORY_TOOL_SCHEMAS.correct.description, /Not for a finished open thread \(filament_memory_close\) nor for a memory that was never true \(filament_memory_forget\)\./);
    const briefing = (await w.session("c").send("what is left on the migration guide?")).seen;
    // The briefing's tools line is one sentence (the memory plan's d2): the tool's own definition says what close is for.
    assert.match(briefing, /Memory tools \(filament_memory_\*\): .*close, confirm and forget settle a line by its id/);
    const brief = await w.svc.scope({ role: "agent", project: projectId, chain: prep.chain }).brief({ purpose: "subagent", task: "finish docs/migration.md", tools: [] });
    assert.match(brief.text, /an open thread whose work you finished: filament_memory_close\(id, because\)/);
  }));

// ---- M7-D65: a thread is near only to a thread ----
// (fails before: yes — the live leg's first session left "The retry logic in src/runner.js drops the last error…" open; it was filed as evidence for the model's note of the bug, and no thread was left to resurface at the file or to close)
test("M7-D65: an open line near a fact in words is a thread of its own; near a thread it is said again; a fact near a thread is a fact", () =>
  threadsWorld(async (w, { answer }) => {
    const a = await w.session("a").send("look at the retry logic and the docs");
    const projectId = a.sit.project.id;
    const bug = (await w.svc.brain.fileLearned({ projectId, chainId: "l0", kind: "fact", text: "run() in src/runner.js drops the last error on the third retry attempt.", importance: 0.6 })).id;
    await w.settle();
    answer({ state: { summary: "s", done: [], open: ["run() in src/runner.js still drops the last error on the third retry attempt", "the docs/ folder needs an index page"], next: [] }, items: [] });
    const first = await w.svc.learner.learnChain(a.prep.chain, { reason: "manual", force: true });
    await w.settle();
    const threads = () => w.svc.archive.items.standing(projectId).filter((/** @type {any} */ it) => it.kind === "thread");
    const [retry, index] = threads();
    assert.deepEqual([first.items, first.dedupedItems, retry?.text], [2, 0, "run() in src/runner.js still drops the last error on the third retry attempt"], "the open line is a thread, not the fact's evidence");
    assert.deepEqual(w.svc.archive.items.events(bug).filter((/** @type {any} */ e) => e.action === "evidence"), []);
    // Another session's open line in near words is the same work: said again.
    const b = await w.session("b").send("is the retry fix done yet?");
    answer({ state: { summary: "s", done: [], open: ["src/runner.js: run() still drops the last error on the third retry attempt"], next: [] }, items: [] });
    const second = await w.svc.learner.learnChain(b.prep.chain, { reason: "manual", force: true });
    await w.settle();
    assert.deepEqual([second.items, second.dedupedItems, threads().length], [0, 1, 2]);
    assert.deepEqual(w.svc.archive.items.events(retry.id).filter((/** @type {any} */ e) => e.action === "evidence").map((/** @type {any} */ e) => e.detail.chain), [b.prep.chain]);
    // A fact in the words of an open thread is something true, filed as a fact.
    const c = await w.session("c").send("what does the site generator need?");
    answer({ state: { summary: "s", done: [], open: [], next: [] }, items: [{ kind: "fact", text: "The docs/ folder needs an index page for the site generator.", importance: 0.6, turn: 1 }] });
    const third = await w.svc.learner.learnChain(c.prep.chain, { reason: "manual", force: true });
    assert.deepEqual([third.items, third.dedupedItems], [1, 0]);
    assert.deepEqual(w.svc.archive.items.events(index.id).filter((/** @type {any} */ e) => e.action === "evidence"), []);
  }));

// ---- M7-D67: a refusal says what stands, and what to do ----
// (fails before: yes — GLM closed "s:bv48vg7r", the dossier's cite of a session, and heard "no memory s:bv48vg7r"; two workers spent six calls correcting a chain whose end the curator had retired, and one gave up without storing what it had verified)
test("M7-D67: a session's id is its words for every verb; close says what an open thread is; correct names the standing end of a chain, or says nothing of it stands and why", () =>
  threadsWorld(async (w) => {
    const { prep, sit } = await w.session("a").send("set up the test script");
    const projectId = sit.project.id;
    const model = w.svc.scope({ role: "model", project: projectId, chain: "m", turn: 2 });
    const tool = async (/** @type {string} */ name, /** @type {any} */ input) => JSON.parse(await executeMemoryTool(model, name, input));
    // A session, as the dossier cites it, and a turn of it, as a search shows it: words, never a stored memory.
    const words = "that id is a quote from a past session, not a stored memory; store what holds now with filament_memory_remember";
    for (const id of [`s:${prep.chain}`, `s:${prep.chain}:1`]) {
      assert.deepEqual(await tool("filament_memory_close", { id, because: "fixed" }), { ok: false, error: `${id} is a past session's words, not an open thread: an open thread is a memory with an i-number, as its line or a search result shows it (kind thread)` });
      assert.deepEqual(await tool("filament_memory_correct", { id, text: "x", reason: "y" }), { ok: false, error: words });
      assert.deepEqual(await tool("filament_memory_forget", { id }), { ok: false, error: words });
    }
    assert.deepEqual(w.svc.brain.namedItem(`s:${prep.chain}`), { error: "that id is a quote from a past session, not a stored memory" });
    // A chain of replacements: correcting an old link names the one that stands now, with its words.
    const stub = (await w.svc.brain.fileLearned({ projectId, chainId: "l1", kind: "fact", text: "The test script in package.json is a stub that never runs the suite.", importance: 0.6 })).id;
    const fixed = await tool("filament_memory_correct", { id: `i${stub}`, text: "The test script runs node --test test/runner.test.js.", reason: "replaced the stub" });
    const both = await tool("filament_memory_correct", { id: fixed.id, text: "The test script runs node --test test/runner.test.js and passes.", reason: "ran it" });
    const end = Number(both.id.slice(1));
    assert.deepEqual(await tool("filament_memory_correct", { id: fixed.id, text: "z", reason: "z" }), {
      ok: false,
      error: `${fixed.id} was replaced by i${end}, which stands: "The test script runs node --test test/runner.test.js and passes."; correct i${end} if it is wrong too`,
    });
    assert.deepEqual(await tool("filament_memory_correct", { id: `i${stub}`, text: "z", reason: "z" }), {
      ok: false,
      error: `i${stub} was replaced by ${fixed.id}, then i${end}, which stands: "The test script runs node --test test/runner.test.js and passes."; correct i${end} if it is wrong too`,
    });
    // Its end retired too: nothing of it stands, and why; what is true now is a new memory.
    await w.svc.brain.forget(`i${end}`, { by: "curator", reason: "checked against package.json: the script is a stub again" });
    const gone = "nothing of it stands; store what is true now with filament_memory_remember";
    assert.deepEqual(await tool("filament_memory_correct", { id: `i${stub}`, text: "z", reason: "z" }), {
      ok: false,
      error: `i${stub} was replaced by ${fixed.id}, then i${end}, retired since (dismissed: checked against package.json: the script is a stub again): ${gone}`,
    });
    assert.deepEqual(await tool("filament_memory_correct", { id: `i${end}`, text: "z", reason: "z" }), { ok: false, error: `i${end} is retired (dismissed: checked against package.json: the script is a stub again): ${gone}` });
    // Said to the user in their words.
    assert.deepEqual(await w.svc.brain.correct(`i${end}`, { text: "z", by: "person" }), {
      ok: false,
      error: `i${end} is retired (dismissed: checked against package.json: the script is a stub again): nothing of it stands; keep what is true now as a new memory (\`@mem remember …\`, or tell the agent)`,
    });
  }));

// (fails before: yes — a claim whose replacement was replaced by it again was said to be "replaced by iB, then iA")
test("M7-D67: a cycle of replacements is followed once, never back to the claim itself", () =>
  threadsWorld(async (w) => {
    const { sit } = await w.session("a").send("hello");
    const projectId = sit.project.id;
    const learned = async (/** @type {string} */ text) => (await w.svc.brain.fileLearned({ projectId, chainId: `l${text.length}`, kind: "fact", text, importance: 0.6 })).id;
    const a = await learned("the api listens on port 3000 behind the proxy");
    const b = await learned("the api listens on port 8080 behind the proxy");
    w.svc.archive.items.setStatus(a, "superseded", { by: "curator", replacement: b, reason: "merged" });
    w.svc.archive.items.setStatus(b, "superseded", { by: "curator", replacement: a, reason: "merged back" });
    assert.deepEqual(await w.svc.brain.correct(`i${a}`, { text: "the api listens on port 9090", by: "model" }), {
      ok: false,
      error: `i${a} was replaced by i${b}, retired since (superseded: merged back): nothing of it stands; store what is true now with filament_memory_remember`,
    });
  }));
