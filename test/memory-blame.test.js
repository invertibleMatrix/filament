// @ts-check
// What a session showed of the claims memory showed it (the memory plan's d4): the learner reads the session with those
// claims by id and says which it showed wrong (`contradicted`: a `suspected` event with the turn and why, once a
// session) and which it relied on and found true (`held`: said again, an `evidence` event, never by its own session).
// No overlap of words casts a doubt. The curator judges each finding against the claim — wrong: a learned claim retired,
// the user's word asked about; unrelated: cleared — and the history says it in words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEARN_PROMPT } from "../src/services/memory/learn.js";
import { KEY_PROMPT, MERGE_PROMPT, SUSPECT_PROMPT } from "../src/services/memory/curator.js";
import { SHOWN_CLAIMS } from "../src/services/memory/brain.js";
import { eventWords } from "../src/ui/lib/claims.js";
import { world } from "./fixtures/memory-world.mjs";

/** The notes a learning prompt lists, by id. @param {string} user */
const notesOf = (user) => [...user.matchAll(/^- i(\d+) \((\w+)\): /gm)].map((m) => Number(m[1]));
/** The numbered pairs of a suspicions prompt: the note's id and what it is judged against. @param {string} u */
const pairsOf = (u) => [...u.matchAll(/^(\d+)\. Note \(i(\d+)[^\n]*\n {3}(Correction|Found) \(([^)]*)\): (.*)$/gm)].map((m) => ({ n: Number(m[1]), note: Number(m[2]), as: m[3], from: m[4], text: m[5] }));

/**
 * A scripted memory model: a learning call is answered by `learn(user)`, a suspicions call by `verdicts` (by the note's
 * id), the curator's other steps with nothing; every call kept.
 * @param {(user: string) => any} learn @param {Map<number, string>} [verdicts]
 */
function model(learn, verdicts = new Map()) {
  /** @type {{ system: string, user: string }[]} */
  const calls = [];
  const fn = async (/** @type {any} */ a) => {
    calls.push({ system: a.system, user: a.user });
    if (a.system === LEARN_PROMPT) return JSON.stringify({ title: "", turns: [], items: [], ...learn(a.user) });
    if (a.system === SUSPECT_PROMPT) return JSON.stringify({ pairs: pairsOf(a.user).filter((p) => verdicts.has(p.note)).map((p) => ({ n: p.n, verdict: verdicts.get(p.note), why: `judged ${verdicts.get(p.note)}` })) });
    return JSON.stringify(a.system === KEY_PROMPT ? { slots: [] } : a.system === MERGE_PROMPT ? { pairs: [] } : { sections: [] });
  };
  return Object.assign(fn, { calls, of: (/** @type {string} */ system) => calls.filter((c) => c.system === system) });
}

// (fails before: yes — the learner was shown no claims and filed no verdict on them)
test("the learner reads the claims its session was shown and says which it showed wrong and which held: a suspicion with the turn and why, said again — the listed ones alone, once a session", () => {
  /** @type {{ wrong: number[], held: number[], turn: number }} */
  const say = { wrong: [], held: [], turn: 2 };
  /** A claim on file the session was never shown, which the model names anyway. */
  let unshown = 0;
  const m = model(() => ({ contradicted: [...say.wrong.map((id) => ({ id: `i${id}`, turn: say.turn, why: "the user said the cdn upload moved to the archive bucket" })), { id: `i${unshown}`, turn: 2, why: "not shown" }, { id: "i999", turn: 2, why: "no such claim" }], held: [...say.held.map((id) => `i${id}`), `i${unshown}`] }));
  return world({ models: { summarizer: "judge" }, callModel: m }, async (w) => {
    const { sit, prep } = await w.session("a").send("hello");
    const projectId = sit.project.id;
    const learned = async (/** @type {string} */ text) => (await w.svc.brain.fileLearned({ projectId, chainId: prep.chain, kind: "fact", text, importance: 0.7 })).id;
    const bucket = await learned("the deploy script uploads the bundle to the cdn bucket");
    const port = await learned("the api listens on port 3000");
    const quiet = await learned("the linter config lives in eslint.config.js");
    const s = w.session("b");
    await s.send("where does the deploy script upload the bundle, and which port does the api listen on?");
    const corrected = await s.send("no, the bundle goes to the archive bucket now");
    const shown = w.svc.brain.shownClaims(corrected.prep.chain);
    assert.ok([bucket, port].every((id) => shown.some((c) => c.id === id)), JSON.stringify(shown));
    assert.ok(!shown.some((c) => c.id === quiet), "the linter's claim was never shown this session");
    unshown = quiet;
    say.wrong = [bucket];
    say.held = [port, bucket];
    await w.svc.learner.learnChain(corrected.prep.chain, { reason: "manual" });
    const asked = m.of(LEARN_PROMPT).at(-1)?.user ?? "";
    assert.deepEqual(notesOf(asked).sort(), shown.map((c) => c.id).sort(), "the notes the session was shown, by id");
    assert.match(asked, new RegExp(`^- i${bucket} \\(fact\\): the deploy script uploads the bundle to the cdn bucket$`, "m"));
    assert.ok(!notesOf(asked).includes(quiet), "a claim the session was never shown is not listed");
    const ev = (/** @type {number} */ id, /** @type {string} */ action) => w.svc.archive.items.events(id).filter((/** @type {any} */ e) => e.action === action && !e.undone_at);
    const turn2 = w.svc.archive.getTurns(corrected.prep.chain).find((/** @type {any} */ t) => t.n === 2);
    assert.deepEqual(ev(bucket, "suspected").map((/** @type {any} */ e) => [e.by, e.detail]), [["learner", { chain: corrected.prep.chain, project: projectId, turn: turn2.id, n: 2, why: "the user said the cdn upload moved to the archive bucket" }]]);
    assert.deepEqual(ev(port, "evidence").map((/** @type {any} */ e) => e.detail.chain), [corrected.prep.chain], "the claim it relied on and found true is said again");
    assert.deepEqual(ev(bucket, "evidence"), [], "never held and contradicted at once");
    assert.deepEqual([ev(quiet, "suspected"), ev(quiet, "evidence")], [[], []], "a claim it was not shown gets no verdict, whatever the model says");
    assert.equal(eventWords({ action: "suspected", by: "learner", detail: ev(bucket, "suspected")[0].detail }), `Session ${corrected.prep.chain} showed it wrong at turn 2: the user said the cdn upload moved to the archive bucket`);
    // Once a session: read again, nothing more is filed — and a session that found a claim wrong never says it held.
    say.wrong = [];
    say.held = [bucket, port];
    await w.svc.learner.learnChain(corrected.prep.chain, { reason: "manual", force: true });
    assert.deepEqual([ev(bucket, "suspected").length, ev(bucket, "evidence").length, ev(port, "evidence").length], [1, 0, 1]);
    // Its own session's claim is never said again by it.
    say.wrong = [];
    say.held = [port];
    const own = w.session("a");
    await own.send("which port does the api listen on?");
    await w.svc.learner.learnChain(prep.chain, { reason: "manual", force: true });
    assert.deepEqual(ev(port, "evidence").map((/** @type {any} */ e) => e.detail.chain), [corrected.prep.chain]);
    assert.ok(SHOWN_CLAIMS >= 10);
  });
});

// (fails before: yes — a finding with no correction on record was left unjudged)
test("the curator judges a learning pass's finding as a correction is: wrong retires a learned claim with nothing in its place, the user's word is asked about, unrelated clears", () => {
  const verdicts = new Map();
  const m = model(() => ({}), verdicts);
  return world({ models: { summarizer: "judge" }, callModel: m }, async (w) => {
    const { sit, prep } = await w.session("a").send("hello");
    const projectId = sit.project.id;
    const learned = async (/** @type {string} */ text) => (await w.svc.brain.fileLearned({ projectId, chainId: prep.chain, kind: "fact", text, importance: 0.7 })).id;
    const bucket = await learned("the deploy script uploads the bundle to the cdn bucket");
    const port = await learned("the api listens on port 3000");
    const users = (await w.svc.brain.remember("the staging deploy runs from the release branch", { kind: "fact", projectId, by: "person" })).itemId;
    const found = (/** @type {number} */ id, /** @type {string} */ why) => w.svc.brain.judgeShown({ chainId: "s9", projectId, notes: [id], contradicted: [{ id: `i${id}`, turn: 4, why }], held: [], turnOf: () => ({ id: 77, n: 4 }) });
    found(bucket, "the bundle goes to the archive bucket now");
    found(port, "the person asked about the port and moved on");
    found(users, "the person said staging deploys run from main now");
    const region = await learned("the deploy region is eu-west-2");
    found(region, "the person asked whether the region still holds");
    w.svc.brain.judgeShown({ chainId: "s10", projectId, notes: [region], contradicted: [{ id: `i${region}`, turn: 2, why: "the region came up again, unsettled" }], held: [], turnOf: () => null });
    verdicts.set(bucket, "wrong").set(port, "unrelated").set(users, "wrong").set(region, "unsure");
    const run = await w.svc.curator.run(projectId);
    const [asked] = m.of(SUSPECT_PROMPT);
    assert.deepEqual(pairsOf(asked.user).map((p) => [p.note, p.as, p.from, p.text]), [
      [bucket, "Found", "session s9, turn 4", "the bundle goes to the archive bucket now"],
      [port, "Found", "session s9, turn 4", "the person asked about the port and moved on"],
      [users, "Found", "session s9, turn 4", "the person said staging deploys run from main now"],
      [region, "Found", "session s9, turn 4", "the person asked whether the region still holds"],
      [region, "Found", "session s10", "the region came up again, unsettled"],
    ]);
    const it = (/** @type {number} */ id) => w.svc.archive.items.get(id);
    assert.deepEqual([it(bucket).status, it(bucket).superseded_by, it(bucket).invalid_reason], ["dismissed", null, "session s9 showed it wrong: judged wrong"]);
    const ev = (/** @type {number} */ id, /** @type {string} */ action) => w.svc.archive.items.events(id).filter((/** @type {any} */ e) => e.action === action && !e.undone_at);
    assert.deepEqual(ev(port, "cleared").map((/** @type {any} */ e) => e.detail), [{ corrections: ["s:s9"] }]);
    const q = w.svc.brain.questions(projectId).find((/** @type {any} */ x) => x.claims.some((/** @type {any} */ c) => c.id === `i${users}`));
    assert.deepEqual([q?.kind, it(users).status], ["retire", "confirmed"], "the user's word is asked about, and stands meanwhile");
    assert.deepEqual([run.suspicionsWrong, run.suspicionsCleared, run.suspicionsAsked, run.suspicionsWeighed], [1, 1, 1, 1]);
    // Two findings both unsettled: weighed once, and asked about no more until a new one comes.
    assert.deepEqual(ev(region, "weighed").map((/** @type {any} */ e) => e.detail), [{ verdict: "unsure", corrections: ["s:s9", "s:s10"] }]);
    const calls = m.of(SUSPECT_PROMPT).length;
    await w.svc.curator.run(projectId);
    assert.equal(m.of(SUSPECT_PROMPT).length, calls, "judged once");
  });
});
