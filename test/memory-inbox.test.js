// @ts-check
// Memory's questions (HarnessV3-Memory M4-6, MD-12's guardrail): what the curator would do to the user's own word is asked,
// never done. Accept carries it out as the user's word, with its history; reject closes it for good; the engine rows the
// fence set aside that are word for word old items are offered back; the first reply's cue names open questions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEY_PROMPT, MERGE_PROMPT, ADOPT_PROMPT } from "../src/services/memory/curator.js";
import { cueText } from "../src/services/memory/brain.js";
import { memoryCommand } from "../src/app/commands/mem.js";
import { questionWords } from "../src/ui/lib/claims.js";
import { world } from "./fixtures/memory-world.mjs";

const DAY = 86_400_000;
/** A scripted model that keys every "port" note to the api's port, and judges no pair the same. */
const portKeyer = async (/** @type {any} */ a) => {
  if (a.system === KEY_PROMPT)
    return JSON.stringify({ slots: [...a.user.matchAll(/^(\d+)\. (.*port (\d{4}).*)$/gm)].map((m) => ({ n: Number(m[1]), subject: "api", attribute: "port", value: m[3] })) });
  if (a.system === MERGE_PROMPT) return JSON.stringify({ pairs: [] });
  throw new Error("unexpected prompt");
};
/** A project folder with files, removed after. @param {(dir: string) => Promise<void>} body */
async function inFolder(body) {
  const dir = mkdtempSync(join(tmpdir(), "filament-inbox-"));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** The @mem reply to a command typed in a session. @param {any} w @param {any} sit @param {string} text */
const mem = async (w, sit, text) => (await memoryCommand(w.svc, text, sit))?.text || "";

/**
 * A curator model whose answer to a pattern across sessions is `lesson()`'s, every such question kept; nothing else to do.
 * @param {() => any} lesson
 */
const lessons = (/** @type {(user: string) => any} */ lesson) => {
  /** @type {string[]} */
  const asked = [];
  const fn = async (/** @type {any} */ a) => {
    if (a.system === ADOPT_PROMPT) {
      asked.push(a.user);
      return JSON.stringify(lesson(a.user));
    }
    return JSON.stringify(a.system === KEY_PROMPT ? { slots: [] } : a.system === MERGE_PROMPT ? { pairs: [] } : { sections: [] });
  };
  return Object.assign(fn, { asked });
};
let asks = 0;
/**
 * A session where the user pushed back on a reply: its first turn's outcome, corrected by its second message, as the
 * learner marks it. Each ask is worded anew: the same message sent again in a session is a rewind.
 * @param {any} w @param {string} id @param {string} said
 */
const pushedBack = async (w, id, said) => {
  const s = w.session(id);
  const a = await s.send(`run the tests (${++asks})`, { reply: "Running the tests now." });
  w.svc.archive.outcomes.add({ chain: a.prep.chain, turn: a.prep.turn, request: a.requestId, kind: "turn", agent: null, model: "m", did: "ran", counts: {}, ended: "done", rounds: 1, calls: 1, tokensIn: 1, tokensOut: 1, usd: null, ms: 1 });
  const b = await s.send(said, { reply: "Right, I will." });
  assert.equal(w.svc.archive.outcomes.correctTurn(b.prep.chain, b.prep.turn), 1);
  return b;
};
const LESSON = "Run the tests with pnpm test, not npm test.";

test("two values the user said in one slot: the curator asks, accept replaces the older with its history", () =>
  world({ models: { summarizer: "judge" }, callModel: portKeyer }, async (w) => {
    const { sit } = await w.session("a").remember("the api listens on port 3000");
    await w.session("b").remember("the api listens on port 8080 now");
    const items = w.svc.archive.items.list({});
    const old = items.find((/** @type {any} */ it) => /3000/.test(it.text));
    const now = items.find((/** @type {any} */ it) => /8080/.test(it.text));
    w.svc.archive.db.prepare("UPDATE items SET created_at = created_at - 60000 WHERE id = ?").run(old.id);
    const r = await w.svc.curator.run(sit.project.id);
    assert.equal(r.keyed, 2);
    assert.equal(r.questions, 1);
    assert.equal(w.svc.archive.items.get(old.id).status, "confirmed", "the curator never retires the user's word");
    const qs = w.svc.brain.questions(sit.project.id);
    assert.deepEqual(qs.map((/** @type {any} */ q) => [q.kind, q.proposal.action, q.proposal.id, q.proposal.replacement, q.run]), [["retire", "retire", old.id, now.id, r.run]]);
    assert.match(qs[0].reason, /^a newer value in its slot \(api · port\): i\d+ says 8080$/);
    // The newer word stands meanwhile: its card says what it would replace, and it is not held (M6-7).
    const newer = w.svc.brain.claims(sit.project.id).claims.find((/** @type {any} */ c) => c.id === `i${now.id}`);
    assert.deepEqual([newer.status, newer.asked, newer.flags], ["confirmed", undefined, [`would replace i${old.id} if you say so`]]);
    const listed = await mem(w, sit, "@mem inbox");
    assert.match(listed, new RegExp(`\`${qs[0].id}\` replace \`i${old.id}\` "the api listens on port 3000" with \`i${now.id}\` "the api listens on port 8080 now"`), listed);
    const done = await mem(w, sit, `@mem accept ${qs[0].id}`);
    assert.equal(done, `Done: \`${qs[0].id}\` accepted (\`i${old.id}\`).`);
    const after = w.svc.archive.items.get(old.id);
    assert.deepEqual([after.status, after.superseded_by], ["superseded", now.id]);
    const ev = w.svc.archive.items.events(old.id).at(-1);
    assert.deepEqual([ev.action, ev.by], ["status", "person"], "retired as the user's own word");
    assert.match(ev.reason, new RegExp(`\\(accepted from memory's questions, ${qs[0].id}\\)$`));
    assert.deepEqual(w.svc.brain.questions(sit.project.id), [], "nothing open");
    assert.match(await mem(w, sit, `@mem accept ${qs[0].id}`), /is accepted already/);
  }));

test("a user's claim whose file is gone is asked about; reject is final, and the same question never comes back", () =>
  inFolder(async (dir) => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "legacy.js"), "export function importOld() {}\n");
    await world({ cwd: dir }, async (w) => {
      const { sit } = await w.session("a").remember("the old importer lives in src/legacy.js");
      const claim = w.svc.archive.items.list({}).find((/** @type {any} */ it) => /legacy/.test(it.text));
      assert.equal(w.svc.archive.anchors.of(claim.id).length, 1, "anchored to its file");
      unlinkSync(join(dir, "src", "legacy.js"));
      const fresh = await w.svc.curator.run(sit.project.id);
      assert.deepEqual([fresh.gone, fresh.goneRecently, fresh.questions], [0, 1, 0], "gone an hour is not gone (M4-D9): a branch may be switched away");
      w.svc.archive.db.prepare("UPDATE item_events SET at = at - ? WHERE item_id = ? AND action = 'anchor'").run(2 * DAY, claim.id);
      const r = await w.svc.curator.run(sit.project.id);
      assert.deepEqual([r.gone, r.goneAsked, r.questions], [0, 1, 1]);
      assert.equal(w.svc.archive.items.get(claim.id).status, "confirmed");
      const [q] = w.svc.brain.questions(sit.project.id);
      assert.match(q.reason, /^its file src\/legacy\.js is gone \(since \d{4}-\d{2}-\d{2}\)$/);
      assert.equal(await mem(w, sit, `@mem reject ${q.id}`), `Closed \`${q.id}\`: memory will not ask it again.`);
      const again = await w.svc.curator.run(sit.project.id);
      assert.equal(again.questions, 0, "rejected is final");
      assert.deepEqual(w.svc.brain.questions(sit.project.id), []);
      assert.equal(w.svc.brain.questions(sit.project.id, { status: "rejected" })[0].by, "person");
      assert.equal(w.svc.archive.items.get(claim.id).status, "confirmed", "and the claim stands, held back by its gone file as before");
    });
  }));

test("a learned claim whose file has been gone a day is retired by the pass, and undo brings it back", () =>
  inFolder(async (dir) => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "legacy.js"), "export function importOld() {}\n");
    await world({ cwd: dir }, async (w) => {
      const { sit } = await w.session("a").send("hello");
      const f = await w.svc.brain.fileLearned({ projectId: sit.project.id, chainId: "c1", kind: "fact", text: "the old importer lives in src/legacy.js", importance: 0.7 });
      unlinkSync(join(dir, "src", "legacy.js"));
      w.svc.brain.filesOf(w.svc.archive.items.get(f.id));
      w.svc.archive.db.prepare("UPDATE item_events SET at = at - ? WHERE item_id = ? AND action = 'anchor'").run(2 * DAY, f.id);
      const r = await w.svc.curator.run(sit.project.id);
      assert.equal(r.gone, 1);
      const it = w.svc.archive.items.get(f.id);
      assert.equal(it.status, "dismissed");
      assert.match(it.invalid_reason, /^its file src\/legacy\.js is gone/);
      await w.svc.scope({ role: "person", project: sit.project.id }).undo(r.run);
      assert.equal(w.svc.archive.items.get(f.id).status, "inferred");
    });
  }));

test("the fenced engine rows that are word for word old items are offered back; a model's rewrite never is", () =>
  world(
    {
      engineRows: [
        { id: "m1", content: "[filament-convention] tests run with vitest, never jest", source: "sleep_consolidation", importance: 0.6, metadata: { llm_used: false } },
        { id: "m2", content: "The user seems to enjoy refactoring on Fridays.", source: "sleep_consolidation", importance: 0.6, metadata: { llm_used: true } },
        { id: "m3", content: "[filament-fact] the bundle size budget is 200 kB", source: "sleep_consolidation", importance: 0.6, metadata: { llm_used: true } },
      ],
    },
    async (w) => {
      const { sit } = await w.session("a").send("hello");
      assert.deepEqual(w.svc.archive.schemaMetaGet("engineFence").working.sort(), ["m1", "m2", "m3"], "the engine's own rows were fenced at start");
      const r = await w.svc.curator.run(sit.project.id);
      assert.equal(r.restoreAsked, 1);
      const [q] = w.svc.brain.questions(sit.project.id);
      assert.deepEqual([q.kind, q.project, q.proposal], ["restore", null, { action: "restore", engine: "m1", kind: "convention", text: "tests run with vitest, never jest" }]);
      assert.match(await mem(w, sit, "@mem inbox"), /bring back, as a convention: "tests run with vitest, never jest"/);
      assert.equal((await w.svc.curator.run(sit.project.id)).restoreAsked, undefined, "each row is read once");
      await mem(w, sit, `@mem accept ${q.id}`);
      const back = w.svc.archive.items.list({}).find((/** @type {any} */ it) => /vitest/.test(it.text));
      assert.deepEqual([back.kind, back.origin, back.status, back.project_id], ["convention", "person", "confirmed", null]);
    },
  ));

// (fails before: yes — nothing read a project's corrections across its sessions)
test("the same correction in two sessions becomes one question; accept keeps its lesson as the user's rule; the cluster grown is asked no more", () => {
  const model = lessons(() => ({ rule: LESSON, why: "each session corrected npm test to pnpm test" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const one = await pushedBack(w, "s1", "no, the tests run with pnpm test here, not npm test");
    await pushedBack(w, "s2", "use pnpm test for the tests, npm test is wrong in this repo");
    await pushedBack(w, "s3", "the staging host is kestrel, not falcon");
    const project = one.prep.project;
    const r = await w.svc.curator.run(project);
    assert.equal(r.adoptAsked, 1, JSON.stringify(r));
    assert.equal(model.asked.length, 1, "one call: the other correction is no pattern");
    assert.match(model.asked[0], /^Corrections, from 2 sessions:\n1\. \(session \S+\) use pnpm test for the tests, npm test is wrong in this repo\n2\. \(session \S+\) no, the tests run with pnpm test here, not npm test$/, model.asked[0]);
    const [q] = w.svc.brain.questions(project);
    const { from, ...proposal } = q.proposal;
    assert.deepEqual([q.kind, proposal, q.claims], ["adopt", { action: "adopt", kind: "rule", text: LESSON, sessions: 2 }, []]);
    assert.equal(from.length, 2, "it keeps the corrections it was drawn from");
    assert.match(await mem(w, one.sit, "@mem inbox"), /keep as your rule: "Run the tests with pnpm test, not npm test\." — the same correction in 2 sessions: each session corrected npm test to pnpm test/);
    assert.match((await mem(w, one.sit, "@mem curate")) || "", /^- nothing needed changing$/m, "asked once");
    await pushedBack(w, "s4", "pnpm test, not npm test, for the tests please");
    assert.equal((await w.svc.curator.run(project)).adoptAsked, undefined, "grown, the same cluster: asked once");
    assert.equal(model.asked.length, 1);
    await mem(w, one.sit, `@mem accept ${q.id}`);
    const rule = w.svc.archive.items.list({}).find((/** @type {any} */ it) => it.text === LESSON);
    assert.deepEqual([rule?.kind, rule?.origin, rule?.status, rule?.project_id], ["rule", "person", "confirmed", project]);
    assert.ok(w.svc.brain.questions(project).every((/** @type {any} */ x) => x.id !== q.id), "answered");
  });
});

// (fails before: yes — the same)
test("a lesson rejected is never asked again; one the model finds none in is asked again once more sessions give it; a rule its lines do not bear out is no question", () => {
  /** @type {any} */
  let answer = { rule: null, why: "they differ" };
  const model = lessons(() => answer);
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const one = await pushedBack(w, "s1", "no, the tests run with pnpm test here, not npm test");
    await pushedBack(w, "s2", "use pnpm test for the tests, npm test is wrong in this repo");
    const project = one.prep.project;
    await w.svc.curator.run(project);
    await w.svc.curator.run(project);
    assert.equal(model.asked.length, 1, "no lesson: not asked again while it holds the same sessions");
    assert.equal(w.svc.brain.questions(project).length, 0);
    answer = { rule: "Deploy to production with kubectl apply on fridays.", why: "made up" };
    await pushedBack(w, "s3", "pnpm test, not npm test, for the tests please");
    const r = await w.svc.curator.run(project);
    assert.deepEqual([model.asked.length, r.adoptDropped, r.adoptAsked], [2, 1, undefined], "a third session: asked again; the rule its lines do not hold dropped");
    answer = { rule: LESSON, why: "npm test corrected to pnpm test" };
    await pushedBack(w, "s4", "the tests need pnpm test, never npm test");
    assert.equal((await w.svc.curator.run(project)).adoptAsked, 1);
    const [q] = w.svc.brain.questions(project);
    await mem(w, one.sit, `@mem reject ${q.id}`);
    await pushedBack(w, "s5", "again: pnpm test for the tests, not npm test");
    assert.equal((await w.svc.curator.run(project)).adoptAsked, undefined);
    assert.equal(model.asked.length, 3, "rejected: never asked again, however it grows");
    assert.equal(w.svc.archive.items.list({}).some((/** @type {any} */ it) => it.text === LESSON), false, "only a text the person accepts becomes a claim");
  });
});

// (fails before: yes — the newest of each session was the oldest: a Map set again keeps its place and takes the later value)
test("two corrections in one session: the model is shown the newest of each session first", () => {
  const model = lessons(() => ({ rule: LESSON, why: "npm test corrected" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const one = await pushedBack(w, "s1", "no, the tests run with pnpm test here, not npm test");
    await pushedBack(w, "s2", "use pnpm test for the tests, npm test is wrong in this repo");
    await pushedBack(w, "s1", "pnpm test, not npm test, for the tests please");
    assert.equal((await w.svc.curator.run(one.prep.project)).adoptAsked, 1);
    assert.match(
      model.asked[0],
      /^Corrections, from 2 sessions:\n1\. \(session (\S+)\) pnpm test, not npm test, for the tests please\n2\. \(session (?!\1)\S+\) use pnpm test for the tests, npm test is wrong in this repo\n3\. \(session \1\) no, the tests run with pnpm test here, not npm test$/,
      model.asked[0],
    );
  });
});

// (fails before: yes — a question was keyed by its two earliest corrections, so one aged out past 90 days made the rest a new key)
test("a lesson rejected stays rejected when its first correction ages out of the 90 days", () => {
  const model = lessons(() => ({ rule: LESSON, why: "npm test corrected" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const one = await pushedBack(w, "s1", "no, the tests run with pnpm test here, not npm test");
    await pushedBack(w, "s2", "use pnpm test for the tests, npm test is wrong in this repo");
    const project = one.prep.project;
    assert.equal((await w.svc.curator.run(project)).adoptAsked, 1);
    const [q] = w.svc.brain.questions(project);
    await mem(w, one.sit, `@mem reject ${q.id}`);
    w.svc.archive.db.prepare("UPDATE outcomes SET at = at - ? WHERE chain_id = ?").run(91 * DAY, one.prep.chain);
    await pushedBack(w, "s3", "pnpm test, not npm test, for the tests please");
    assert.equal((await w.svc.curator.run(project)).adoptAsked, undefined);
    assert.equal(model.asked.length, 1, "the corrections a question was drawn from stay asked");
  });
});

// (fails before: yes — corrections were joined through any chain of look-alikes, so one short line made two patterns one)
test("a short correction alike to two patterns joins one of them, never both into one", () => {
  const model = lessons(() => ({ rule: LESSON, why: "npm test corrected" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const one = await pushedBack(w, "s1", "no, the tests run with pnpm test here, not npm test");
    await pushedBack(w, "s2", "pnpm test on kestrel staging");
    await pushedBack(w, "s3", "the staging host is kestrel, not falcon");
    await pushedBack(w, "s4", "deploy staging to kestrel, falcon is gone");
    await pushedBack(w, "s5", "the tests need pnpm test, never npm test");
    await w.svc.curator.run(one.prep.project);
    assert.equal(model.asked.length, 2, model.asked.join("\n---\n"));
    for (const asked of model.asked) assert.ok(!(/\bnpm test/.test(asked) && /falcon/.test(asked)), asked);
  });
});

// (fails before: yes — a rule the user had already was put to them again)
test("a lesson the user's own rule already says is no question", () => {
  const model = lessons((user) => ({ rule: LESSON, why: "npm test corrected", same: /^R1\. /m.test(user) ? "R1" : null }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    await w.session("s0").remember("the tests run with pnpm, never npm test", { kind: "rule" });
    const one = await pushedBack(w, "s1", "no, the tests run with pnpm test here, not npm test");
    await pushedBack(w, "s2", "use pnpm test for the tests, npm test is wrong in this repo");
    const r = await w.svc.curator.run(one.prep.project);
    assert.deepEqual([r.adoptAsked, r.adoptDropped, model.asked.length], [undefined, 1, 1], JSON.stringify(r));
    assert.match(model.asked[0], /\n\nThe user's own rules:\nR1\. \(rule\) the tests run with pnpm, never npm test$/, model.asked[0]);
    assert.deepEqual(w.svc.brain.questions(one.prep.project), []);
    await w.svc.curator.run(one.prep.project);
    assert.equal(model.asked.length, 1, "and not put again for the same sessions");
  });
});

// (fails before: yes — word overlap took a rule the corrections contradict for one they repeat, and dropped the lesson)
test("corrections that say the user's own rule is out of date ask whether its words change; accepted, the rule is corrected", () => {
  const model = lessons((user) => ({ rule: LESSON, why: "each session corrected npm test to pnpm test", replaces: /^R1\. /m.test(user) ? "R1" : null }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { item } = await w.session("s0").remember("Run the tests with npm test.", { kind: "rule" });
    const one = await pushedBack(w, "s1", "no, the tests run with pnpm test here, not npm test");
    await pushedBack(w, "s2", "use pnpm test for the tests, npm test is wrong in this repo");
    const project = one.prep.project;
    const r = await w.svc.curator.run(project);
    assert.deepEqual([r.adoptChange, r.adoptAsked], [1, undefined], JSON.stringify(r));
    const [q] = w.svc.brain.questions(project);
    assert.deepEqual([q.kind, q.proposal.action, q.proposal.id, q.proposal.text, q.claims.map((/** @type {any} */ c) => c.id)], ["retire", "correct", Number(item.id.slice(1)), LESSON, [item.id]]);
    // Their rule stands meanwhile, flagged with the words it would take.
    const card = w.svc.brain.claims(project).claims.find((/** @type {any} */ c) => c.id === item.id);
    assert.deepEqual([card?.status, card?.flags], ["confirmed", [`said otherwise later: ${LESSON}`]]);
    assert.equal(questionWords(q), `Change “Run the tests with npm test.” to “${LESSON}”`);
    assert.match(await mem(w, one.sit, "@mem inbox"), new RegExp(`change \`${item.id}\` "Run the tests with npm test\\." to: "Run the tests with pnpm test, not npm test\\." — the same correction in 2 sessions says otherwise: each session corrected npm test to pnpm test`));
    assert.match((await mem(w, one.sit, "@mem curate")) || "", /^- nothing needed changing$/m, "asked once");
    await mem(w, one.sit, `@mem accept ${q.id}`);
    const all = w.svc.archive.items.list({});
    assert.equal(all.find((/** @type {any} */ it) => it.id === Number(item.id.slice(1)))?.status, "superseded");
    const now = all.find((/** @type {any} */ it) => it.text === LESSON);
    assert.deepEqual([now?.kind, now?.status], ["rule", "confirmed"], "the user's rule, in the words they accepted");
  });
});

// (fails before: yes — a lesson's question kept only the corrections it was drawn from, so once they aged out the same lesson was asked anew)
test("a lesson turned down is not asked again once every correction it was drawn from ages out: the model weighs it against what was turned down", () => {
  const model = lessons((user) => ({ rule: LESSON, why: "npm test corrected", same: /^D1\. /m.test(user) ? "D1" : null }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const one = await pushedBack(w, "s1", "no, the tests run with pnpm test here, not npm test");
    const two = await pushedBack(w, "s2", "use pnpm test for the tests, npm test is wrong in this repo");
    const project = one.prep.project;
    assert.equal((await w.svc.curator.run(project)).adoptAsked, 1);
    const [q] = w.svc.brain.questions(project);
    await mem(w, one.sit, `@mem reject ${q.id}`);
    for (const c of [one.prep.chain, two.prep.chain]) w.svc.archive.db.prepare("UPDATE outcomes SET at = at - ? WHERE chain_id = ?").run(91 * DAY, c);
    await pushedBack(w, "s3", "pnpm test, not npm test, for the tests please");
    await pushedBack(w, "s4", "the tests need pnpm test, never npm test");
    const r = await w.svc.curator.run(project);
    assert.deepEqual([r.adoptAsked, r.adoptDropped, model.asked.length], [undefined, 1, 2], JSON.stringify(r));
    assert.match(model.asked[1], new RegExp(`\\n\\nLessons the user turned down:\\nD1\\. ${LESSON.replace(/\./g, "\\.")}$`), model.asked[1]);
    assert.deepEqual(w.svc.brain.questions(project), []);
  });
});

// (fails before: yes — a claim on file the user was heard correcting to kept the session it was first said in, so one correction counted two sessions)
test("a correction to words already on file is the session's that heard it: one correction is one session", () => {
  const model = lessons(() => ({ rule: LESSON, why: "npm test corrected" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const a = await w.session("a").send("hello");
    const project = a.prep.project;
    const old = await w.svc.brain.fileLearned({ projectId: project, chainId: a.prep.chain, turnId: a.prep.turn, kind: "fact", text: "the tests run with npm test", importance: 0.7 });
    await w.svc.brain.fileLearned({ projectId: project, chainId: a.prep.chain, turnId: a.prep.turn, kind: "fact", text: "the tests run with pnpm test, not npm test", importance: 0.7 });
    await w.settle();
    const b = await pushedBack(w, "b", "no, the tests run with pnpm test, not npm test");
    const fixed = await w.svc.brain.correct(`i${old.id}`, { text: "the tests run with pnpm test, not npm test", by: "model", quote: "the tests run with pnpm test, not npm test", chainId: b.prep.chain, turnId: b.prep.turn });
    assert.equal(fixed.heard, true, JSON.stringify(fixed));
    await w.svc.curator.run(project);
    assert.deepEqual(model.asked, [], "the turn pushed back on and the claim it corrected to are one session's");
  });
});

// (fails before: yes — a secret set mid-line, as a message says it, was blanked only at a line's start; a turn kept apart was left out already)
test("a correction in a turn kept apart is not read; a secret in one is blanked before the model sees it", () => {
  const model = lessons(() => ({ rule: null, why: "no lesson" }));
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const one = await pushedBack(w, "s1", "no, the tests run with pnpm test here, not npm test, NPM_TOKEN=npm_a1b2c3d4e5f6g7h8i9j0");
    await pushedBack(w, "s2", "use pnpm test for the tests, npm test is wrong in this repo");
    const apart = await pushedBack(w, "s3", "pnpm test, not npm test, for the tests please, it is private");
    w.svc.archive.mergeTurnMeta(apart.prep.turn, { apart: true });
    await w.svc.curator.run(one.prep.project);
    assert.equal(model.asked.length, 1);
    assert.match(model.asked[0], /^Corrections, from 2 sessions:/);
    assert.doesNotMatch(model.asked[0], /private|a1b2c3d4e5f6/, model.asked[0]);
  });
});

test("the first reply's cue names memory's open questions; with none it is the sentence it always was", () => {
  const sessions = [{ id: "abc", title: "deploy work" }];
  assert.equal(cueText({ items: 2, sessions }), 'Memory: 2 related items, 1 earlier session here (abc deploy work). Say "@mem load <session>" to bring one in.');
  assert.equal(cueText({ items: 2, sessions, questions: 1 }), 'Memory: 2 related items, 1 earlier session here (abc deploy work). Say "@mem load <session>" to bring one in. 1 question for you: say "@mem inbox" to see it.');
  assert.equal(cueText({ items: 0, sessions: [], questions: 3 }), 'Memory: 3 questions for you: say "@mem inbox" to see them.');
  return world({ models: { summarizer: "judge" }, callModel: portKeyer }, async (w) => {
    const { sit } = await w.session("a").remember("the api listens on port 3000");
    await w.session("b").remember("the api listens on port 8080 now");
    await w.svc.curator.run(sit.project.id);
    const { prep } = await w.session("c").send("let's look at the deploy scripts");
    assert.equal(prep.cue?.questions, 1, JSON.stringify(prep.cue));
  });
});

test("undoing a pass withdraws the questions it raised; a question its claim outran is withdrawn when answered", () =>
  world({ models: { summarizer: "judge" }, callModel: portKeyer }, async (w) => {
    const { sit } = await w.session("a").remember("the api listens on port 3000");
    await w.session("b").remember("the api listens on port 8080 now");
    const r = await w.svc.curator.run(sit.project.id);
    const [q] = w.svc.brain.questions(sit.project.id);
    await w.svc.brain.undoRun(Number(r.run.slice(1)), { by: "owner" });
    assert.deepEqual(w.svc.brain.questions(sit.project.id), []);
    assert.equal(w.svc.brain.questions(sit.project.id, { status: "withdrawn" })[0].id, q.id);
    // Asked again by a later pass? No: the key was raised once. A fresh conflict gets a fresh question.
    await w.svc.curator.run(sit.project.id);
    assert.deepEqual(w.svc.brain.questions(sit.project.id).map((/** @type {any} */ x) => x.id), [], "the undone question is not raised again");
    // A question whose claim is retired meanwhile is withdrawn then, saying why (M6-D16): never listed as if it were open.
    const id = w.svc.archive.inbox.add({ projectId: sit.project.id, kind: "retire", key: "test:1", itemIds: [q.proposal.id], proposal: { action: "retire", id: q.proposal.id, reason: "test" }, reason: "test" }).id;
    await w.svc.scope({ role: "owner" }).forget(`i${q.proposal.id}`, { reason: "gone" });
    const moot = w.svc.archive.inbox.get(id);
    assert.deepEqual([moot.status, moot.decided_by, moot.outcome], ["withdrawn", "owner", { why: `i${q.proposal.id} was dismissed meanwhile` }]);
    const out = await w.svc.brain.decide(`q${id}`, "accept", { by: "owner" });
    assert.deepEqual([out.ok, out.error], [false, `q${id} is withdrawn already`]);
  }));

test("a question is withdrawn when the claim that would replace the one it asks about is retired meanwhile (M6-D16)", () =>
  world({ models: { summarizer: "judge" }, callModel: portKeyer }, async (w) => {
    const { sit } = await w.session("a").remember("the api listens on port 3000");
    await w.session("b").remember("the api listens on port 8080 now");
    await w.svc.curator.run(sit.project.id);
    const [q] = w.svc.brain.questions(sit.project.id);
    assert.ok(q?.proposal.replacement, JSON.stringify(q));
    await w.svc.scope({ role: "owner" }).forget(`i${q.proposal.replacement}`, { reason: "not true either" });
    assert.deepEqual(w.svc.brain.questions(sit.project.id), []);
    assert.deepEqual(w.svc.archive.inbox.get(Number(q.id.slice(1))).outcome, { why: `i${q.proposal.replacement} was dismissed meanwhile` });
  }));

// The mark a question puts on the line of the claim it would retire ("in question", brain #standing) lives exactly as
// long as the question: rejected, its pass undone, the claims it cites deleted, or its project deleted (whose claims'
// ids a new claim can take), the line is plain again.
test("a claim is served marked in question while its question is open, and plain once it is closed or gone", async () => {
  const twoPorts = async (/** @type {any} */ w, /** @type {string} */ cwd = "C:\\evals") => {
    const a = await w.session(`a${cwd}`, { cwd }).remember("the api listens on port 3000");
    const b = await w.session(`b${cwd}`, { cwd }).remember("the api listens on port 8080 now");
    const old = w.svc.archive.items.list({ projectId: a.sit.project.id }).find((/** @type {any} */ it) => /3000/.test(it.text));
    w.svc.archive.db.prepare("UPDATE items SET created_at = created_at - 60000 WHERE id = ?").run(old.id);
    const r = await w.svc.curator.run(a.sit.project.id);
    return { project: a.sit.project.id, old, r, said8080: b.prep.chain };
  };
  let n = 0;
  /** The line serving port 3000 in a fresh session. @param {any} w @param {string} [cwd] */
  const line3000 = async (w, cwd = "C:\\evals") => (await w.session(`ask${++n}`, { cwd }).send("which port does the api listen on?")).seen.split("\n").find((/** @type {string} */ l) => l.includes("port 3000")) || "";
  await world({ models: { summarizer: "judge" }, callModel: portKeyer }, async (w) => {
    const { project } = await twoPorts(w);
    assert.match(await line3000(w), /· in question: the user is asked if i\d+ replaces it\]/);
    const [q] = w.svc.brain.questions(project);
    assert.ok((await w.svc.brain.decide(q.id, "reject", { by: "person" })).ok);
    const after = await line3000(w);
    assert.ok(after && !after.includes("in question"), `rejected: ${after}`);
  });
  await world({ models: { summarizer: "judge" }, callModel: portKeyer }, async (w) => {
    const { r } = await twoPorts(w);
    assert.match(await line3000(w), /in question/);
    await w.svc.brain.undoRun(Number(r.run.slice(1)), { by: "owner" });
    const after = await line3000(w);
    assert.ok(after && !after.includes("in question"), `its pass undone: ${after}`);
  });
  await world({ models: { summarizer: "judge" }, callModel: portKeyer }, async (w) => {
    const { said8080 } = await twoPorts(w);
    assert.match(await line3000(w), /in question/);
    await w.svc.deleteSession(said8080);
    const after = await line3000(w);
    assert.ok(after && !after.includes("in question"), `the replacement's session deleted: ${after}`);
  });
  await world({ models: { summarizer: "judge" }, callModel: portKeyer }, async (w) => {
    await w.session("here").remember("the db listens on port 5432");
    const { project, old } = await twoPorts(w, "C:\\other");
    assert.match(await line3000(w, "C:\\other"), /in question/);
    await w.svc.deleteProject(project);
    await w.session("here2").remember("the api listens on port 3000 in this project too");
    const reused = w.svc.archive.items.list({}).find((/** @type {any} */ it) => /in this project too/.test(it.text));
    assert.equal(reused.id, old.id, "the new claim took the deleted claim's id");
    const after = await line3000(w);
    assert.ok(after && !after.includes("in question"), `its project deleted: ${after}`);
  });
});
