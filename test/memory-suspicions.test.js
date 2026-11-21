// @ts-check
// The suspicions on a claim (HarnessV3-Memory M7-D68): a learning pass that finds its session showed a claim it was shown
// wrong casts one (the memory plan's d4), and a correction on record may have (M3-5). A suspicion never lowers the
// user's own word, which is changed only by asking; the curator judges each against what cast it — unrelated: cleared;
// wrong: the claim retired, or the user asked; unsure: weighed, and still counted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KEY_PROMPT, MERGE_PROMPT, SUSPECT_PROMPT, ADOPT_PROMPT } from "../src/services/memory/curator.js";
import { LEARN_PROMPT } from "../src/services/memory/learn.js";
import { confidenceOf } from "../src/services/memory/brain.js";
import { eventWords } from "../src/ui/lib/claims.js";
import { memoryCommand } from "../src/app/commands/mem.js";
import { world } from "./fixtures/memory-world.mjs";

const RULE = "Don't run npm test bare: use env -u CLAUDECODE npm test, or the runner hangs on the CLAUDECODE variable.";

/** The numbered pairs of a suspicions prompt: the note's id, the correction's id. @param {string} u */
const pairsOf = (u) => [...u.matchAll(/^(\d+)\. Note \(i(\d+)[^\n]*\n {3}Correction \(i(\d+)/gm)].map((m) => ({ n: Number(m[1]), note: Number(m[2]), correction: Number(m[3]) }));

/**
 * A curator model that answers each suspicion as `verdicts` says — by "<note>:<correction>", else by the note's id; one
 * it has no verdict for is left out of its answer — every call kept. @param {Map<number | string, string>} verdicts
 */
function judge(verdicts) {
  /** @type {{ system: string, user: string }[]} */
  const calls = [];
  const said = (/** @type {{ note: number, correction: number }} */ p) => verdicts.get(`${p.note}:${p.correction}`) ?? verdicts.get(p.note);
  const fn = async (/** @type {any} */ a) => {
    calls.push({ system: a.system, user: a.user });
    if (a.system === SUSPECT_PROMPT) return JSON.stringify({ pairs: pairsOf(a.user).filter((p) => said(p)).map((p) => ({ n: p.n, verdict: said(p), why: `judged ${said(p)}` })) });
    return JSON.stringify(a.system === KEY_PROMPT ? { slots: [] } : a.system === MERGE_PROMPT ? { pairs: [] } : { sections: [] });
  };
  return Object.assign(fn, { calls, asked: () => calls.filter((c) => c.system === SUSPECT_PROMPT) });
}

// (fails before: yes — nothing read a project's corrections across its sessions: each session saw its own alone)
test("a correction given three ways in three sessions is one pattern: a turn the user pushed back on, a claim they corrected, a claim a session showed wrong", () => {
  /** @type {string[]} */
  const asked = [];
  const model = async (/** @type {any} */ a) => {
    if (a.system === ADOPT_PROMPT) {
      asked.push(a.user);
      return JSON.stringify({ rule: "Run the tests with pnpm test, not npm test.", why: "three sessions corrected npm test" });
    }
    return JSON.stringify(a.system === KEY_PROMPT ? { slots: [] } : a.system === MERGE_PROMPT ? { pairs: [] } : a.system === SUSPECT_PROMPT ? { pairs: [] } : { sections: [] });
  };
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    // 1. A turn the user pushed back on.
    const s1 = w.session("one");
    const a = await s1.send("run the tests", { reply: "Running npm test." });
    w.svc.archive.outcomes.add({ chain: a.prep.chain, turn: a.prep.turn, request: a.requestId, kind: "turn", agent: null, model: "m", did: "ran", counts: {}, ended: "done", rounds: 1, calls: 1, tokensIn: 1, tokensOut: 1, usd: null, ms: 1 });
    const b = await s1.send("no, the tests run with pnpm test here, not npm test", { reply: "Right." });
    w.svc.archive.outcomes.correctTurn(b.prep.chain, b.prep.turn);
    const project = a.prep.project;
    // 2. A claim the user corrected, in another session.
    await w.svc.brain.fileLearned({ projectId: project, chainId: "old", kind: "fact", text: "the tests run with npm test", importance: 0.7 });
    await w.settle();
    await w.session("two").correct("the tests run with pnpm test, not npm test", { of: "the tests run with npm test" });
    // 3. A claim a third session showed wrong, as its learner found.
    const shown = Number((await w.svc.brain.fileLearned({ projectId: project, chainId: "old2", kind: "fact", text: "ci calls npm test for the unit tests", importance: 0.7 })).id);
    await w.settle();
    w.svc.archive.items.note(shown, "suspected", { by: "learner", reason: "pnpm test passed, npm test failed", detail: { chain: "three", project, why: "pnpm test passed where npm test failed" } });
    const r = await w.svc.curator.run(project);
    assert.equal(r.adoptAsked, 1, JSON.stringify(r));
    assert.match(asked[0], /^Corrections, from 3 sessions:$/m);
    assert.match(asked[0], /no, the tests run with pnpm test here, not npm test/);
    assert.match(asked[0], /the tests run with pnpm test, not npm test \(it said before: the tests run with npm test\)/);
    assert.match(asked[0], /ci calls npm test for the unit tests \(shown wrong: pnpm test passed where npm test failed\)/);
    const [q] = w.svc.brain.questions(project).filter((/** @type {any} */ x) => x.kind === "adopt");
    assert.equal(q?.proposal.sessions, 3);
  });
});

// (fails before: yes — a suspicion the curator had cleared as unrelated still counted as a correction)
test("a suspicion the curator cleared, or one that gives no why, is no correction", () => {
  /** @type {string[]} */
  const asked = [];
  const model = async (/** @type {any} */ a) => {
    if (a.system === ADOPT_PROMPT) {
      asked.push(a.user);
      return JSON.stringify({ rule: null, why: "no lesson" });
    }
    return JSON.stringify(a.system === KEY_PROMPT ? { slots: [] } : a.system === MERGE_PROMPT ? { pairs: [] } : a.system === SUSPECT_PROMPT ? { pairs: [] } : { sections: [] });
  };
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { prep } = await w.session("one").send("hello");
    const project = prep.project;
    const a = Number((await w.svc.brain.fileLearned({ projectId: project, chainId: "old", kind: "fact", text: "ci calls npm test for the unit tests", importance: 0.7 })).id);
    const b = Number((await w.svc.brain.fileLearned({ projectId: project, chainId: "old2", kind: "fact", text: "the unit tests run with npm test in ci", importance: 0.7 })).id);
    await w.settle();
    w.svc.archive.items.note(a, "suspected", { by: "learner", reason: "pnpm test passed", detail: { chain: "two", project, why: "pnpm test passed where npm test failed" } });
    w.svc.archive.items.note(a, "cleared", { by: "curator", reason: "judged unrelated", detail: { corrections: [] } });
    w.svc.archive.items.note(b, "suspected", { by: "learner", reason: "", detail: { chain: "three", project, why: "" } });
    w.svc.archive.items.note(b, "suspected", { by: "learner", reason: "pnpm test passed", detail: { chain: "four", project, why: "npm test failed and pnpm test passed" } });
    await w.svc.curator.run(project);
    assert.deepEqual(asked, [], "one suspicion stands: no pattern");
  });
});

// (fails before: yes — in the live leg "wrong, the runner must keep the last error…" suspected the user's npm test rule on the one word "runner"; each such correction took 0.25 off it, and the third would have silenced it)
// No list of a message's words casts a suspicion any more (the memory plan's d3): the learner's verdict on what a session
// was shown does (d4). However many it casts, the user's rule stays in force.
test("M7-D68: however many suspicions the user's rule draws, it stays in force; a learned claim's confidence falls", () => {
  let rule = 0;
  // The learner's model finds each session showed the rule wrong (d4).
  const learn = async (/** @type {any} */ a) => JSON.stringify(a.system === LEARN_PROMPT ? { title: "", turns: [], items: [], contradicted: [{ id: `i${rule}`, turn: 2, why: "the user said the runner must keep the last error" }] } : {});
  return world({ models: { summarizer: "judge" }, callModel: learn }, async (w) => {
    const { sit } = await w.session("a").send("hello");
    const projectId = sit.project.id;
    rule = (await w.svc.brain.remember(RULE, { kind: "rule", projectId, by: "person" })).itemId;
    for (const s of ["b", "c", "d"]) {
      const x = w.session(s);
      await x.send("how do I run the tests here?");
      const { prep } = await x.send("wrong, the runner must keep the last error and rethrow it after the third failure");
      assert.deepEqual(w.svc.archive.items.events(rule).filter((/** @type {any} */ e) => e.action === "suspected" && e.detail?.chain === prep.chain), [], "nothing suspected by the message's words");
      await w.svc.learner.learnChain(prep.chain, { reason: "manual" });
    }
    const suspected = w.svc.archive.items.events(rule).filter((/** @type {any} */ e) => e.action === "suspected");
    assert.deepEqual([suspected.length, suspected[0].by, suspected[0].detail.why], [3, "learner", "the user said the runner must keep the last error"]);
    assert.equal(w.svc.brain.pitfallsFor({ projectId, chainId: "z", tool: "Bash", input: { command: "npm test" } }).length, 1, "the user's rule is said at the call");
    assert.equal(w.svc.brain.card(`i${rule}`)?.sure, 0.95);
    const c = (/** @type {any} */ it, /** @type {number} */ suspected) => Math.round(confidenceOf({ kind: "fact", created_at: 0, ...it }, { suspected }, 0) * 1000) / 1000;
    assert.deepEqual([c({ origin: "person" }, 3), c({ origin: "correction" }, 2), c({ origin: "learner", status: "confirmed" }, 2), c({ origin: "learner", status: "inferred" }, 1), c({ origin: "subagent" }, 1)], [0.95, 1, 0.9, 0.35, 0.3]);
  });
});

test("M7-D68: the curator judges each suspicion against the correction that cast it — cleared, retired, asked, weighed — once, and undo brings it back", () => {
  /** @type {Map<number, string>} */
  const verdicts = new Map();
  const model = judge(verdicts);
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { sit } = await w.session("a").send("hello");
    const projectId = sit.project.id;
    const learned = async (/** @type {string} */ text, /** @type {string | null} */ project = projectId) => (await w.svc.brain.fileLearned({ projectId: project, chainId: `l${text.length}`, kind: "fact", text, importance: 0.7 })).id;
    const correction = async (/** @type {string} */ text) => (await w.svc.brain.remember(text, { kind: "rule", projectId, by: "person", chainId: "x" })).itemId;
    const suspect = (/** @type {number} */ id, /** @type {number | null} */ corr) => w.svc.archive.items.note(id, "suspected", { by: "person", detail: { chain: "x", ...(corr ? { correction: `i${corr}` } : {}), words: ["deploy"] } });
    const bucket = await learned("the deploy script uploads the bundle to the cdn bucket");
    const port = await learned("the api listens on port 3000");
    const users = (await w.svc.brain.remember("the staging deploy runs from the release branch", { kind: "fact", projectId, by: "person" })).itemId;
    const region = await learned("the deploy region is eu-west-2");
    const moot = await learned("the deploy job retries twice");
    const bare = await learned("the deploy log lives in out/deploy.log");
    const everywhere = await learned("deploys need a signed tag", null);
    const cs = {
      bucket: await correction("no, the deploy script must never upload without a checksum"),
      port: await correction("wrong, the api moved to port 8080 last week"),
      users: await correction("no, staging deploys run from main now"),
      region: await correction("no, deploys wait for the region's quiet hours"),
      moot: await correction("no, the deploy job must log each retry"),
      everywhere: await correction("no, deploys here need no tag at all"),
    };
    suspect(bucket, cs.bucket);
    suspect(port, cs.port);
    suspect(users, cs.users);
    suspect(region, cs.region);
    suspect(moot, cs.moot);
    suspect(bare, null);
    suspect(everywhere, cs.everywhere);
    await w.svc.brain.forget(`i${cs.moot}`, { by: "person", reason: "I take that back" });
    w.svc.archive.items.note(bucket, "evidence", { by: "learner", detail: { chain: "l9" } });
    const counts = () => w.svc.archive.items.eventCounts([bucket, port, users, region, moot, bare, everywhere]);
    assert.deepEqual([...counts().values()].map((c) => c.suspected), [1, 1, 1, 1, 1, 1, 1]);
    for (const [id, v] of /** @type {[number, string][]} */ ([[bucket, "unrelated"], [port, "wrong"], [users, "wrong"], [region, "unsure"], [everywhere, "wrong"]])) verdicts.set(id, v);
    const first = await w.svc.curator.run(projectId);
    const global = await w.svc.curator.run(null);
    // One call a scope; never the suspicion whose correction was retired since, nor one with no correction stored.
    assert.deepEqual(model.asked().map((c) => pairsOf(c.user).map((p) => [p.note, p.correction])), [
      [[bucket, cs.bucket], [port, cs.port], [users, cs.users], [region, cs.region]],
      [[everywhere, cs.everywhere]],
    ]);
    assert.match(model.asked()[0].user, new RegExp(`^1\\. Note \\(i${bucket} · fact · inferred\\): the deploy script uploads the bundle to the cdn bucket\\n {3}Correction \\(i${cs.bucket}, session x\\): no, the deploy script must never upload without a checksum$`, "m"));
    const ev = (/** @type {number} */ id, /** @type {string} */ action) => w.svc.archive.items.events(id).filter((/** @type {any} */ e) => e.action === action && !e.undone_at);
    // unrelated: cleared, by the curator in its pass; the suspicion stops counting.
    assert.deepEqual(ev(bucket, "cleared").map((/** @type {any} */ e) => [e.by, e.run_id, e.reason, e.detail]), [["curator", Number(first.run.slice(1)), "judged unrelated", { corrections: [`i${cs.bucket}`] }]]);
    // wrong, a learned claim of the correction's project: replaced by the correction, with errata.
    assert.deepEqual([w.svc.archive.items.get(port).status, w.svc.archive.items.get(port).superseded_by, w.svc.archive.items.get(port).invalid_reason], ["superseded", cs.port, "a correction in session x said it is wrong: judged wrong"]);
    // wrong, the user's word: asked, and it stands meanwhile.
    const q = w.svc.brain.questions(projectId).find((/** @type {any} */ x) => x.claims.some((/** @type {any} */ c) => c.id === `i${users}`));
    assert.deepEqual([q?.kind, q?.claims.map((/** @type {any} */ c) => c.id), w.svc.archive.items.get(users).status], ["retire", [`i${users}`, `i${cs.users}`], "confirmed"]);
    assert.deepEqual(ev(users, "weighed").map((/** @type {any} */ e) => e.detail), [{ verdict: "wrong", asked: true, corrections: [`i${cs.users}`] }]);
    // unsure: weighed, still counted.
    assert.deepEqual(ev(region, "weighed").map((/** @type {any} */ e) => e.detail), [{ verdict: "unsure", corrections: [`i${cs.region}`] }]);
    // the correction retired since: cleared with no call; no correction stored: left as it is.
    assert.deepEqual(ev(moot, "cleared").map((/** @type {any} */ e) => [e.reason, e.detail]), [[`its correction i${cs.moot} was retired since`, { corrections: [`i${cs.moot}`], retired: true }]]);
    assert.deepEqual([ev(bare, "cleared").length, ev(bare, "weighed").length], [0, 0]);
    // wrong, a claim of every project by one project's correction: it stands, weighed.
    assert.deepEqual([w.svc.archive.items.get(everywhere).status, ev(everywhere, "weighed").map((/** @type {any} */ e) => e.detail)], ["inferred", [{ verdict: "wrong", corrections: [`i${cs.everywhere}`] }]]);
    assert.deepEqual(
      [bucket, users, region, moot, bare, everywhere].map((id) => counts().get(id)?.suspected ?? 0),
      [0, 1, 1, 0, 1, 1],
      "cleared stop counting; weighed and left go on counting",
    );
    assert.equal(counts().get(bucket)?.evidence, 1, "what another session said counts still: a clearing ends only suspicions");
    assert.deepEqual([first.suspicionsCleared, first.suspicionsWrong, first.suspicionsAsked, first.suspicionsWeighed, global.suspicionsWeighed], [2, 1, 1, 1, 1]);
    // Each an event of its pass, so the pass can be undone.
    const [r1, rg] = [Number(first.run.slice(1)), Number(global.run.slice(1))];
    assert.deepEqual(
      [ev(bucket, "cleared"), ev(moot, "cleared"), ev(users, "weighed"), ev(region, "weighed"), ev(everywhere, "weighed")].map((l) => l.map((/** @type {any} */ e) => e.run_id)),
      [[r1], [r1], [r1], [r1], [rg]],
    );
    // Judged once: the next pass asks nothing, until a new suspicion comes.
    await w.svc.curator.run(projectId);
    assert.equal(model.asked().length, 2);
    suspect(region, cs.bucket);
    await w.svc.curator.run(projectId);
    assert.deepEqual(pairsOf(model.asked().at(-1)?.user ?? "").map((p) => [p.note, p.correction]), [[region, cs.bucket]]);
    // Undo: the cleared suspicion counts again, the replaced claim stands again, the question is withdrawn.
    await w.svc.brain.undoRun(Number(first.run.slice(1)), { by: "owner" });
    assert.deepEqual([counts().get(bucket)?.suspected, w.svc.archive.items.get(port).status, w.svc.brain.questions(projectId).some((/** @type {any} */ x) => x.id === q.id)], [1, "inferred", false]);
    assert.equal(counts().get(moot)?.suspected, 1, "the clearing of a retired correction's suspicion undone too");
    // The history in words.
    assert.deepEqual(
      [
        { action: "cleared", by: "curator", detail: {} },
        { action: "cleared", by: "curator", detail: { retired: true } },
        { action: "weighed", by: "curator", detail: { verdict: "unsure" } },
        { action: "weighed", by: "curator", detail: { verdict: "wrong", asked: true } },
        { action: "weighed", by: "curator", detail: { verdict: "wrong" } },
      ].map(eventWords),
      [
        "Cleared of a suspicion: it was about something else by the curator",
        "Cleared of a suspicion: the correction was retired since by the curator",
        "A suspicion weighed: not settled by the curator",
        "Judged wrong: the user is asked by the curator",
        "Judged wrong in one project: a claim of every project stands by the curator",
      ],
    );
  });
});

// (fails before: yes — a pass that only judged suspicions said "nothing needed changing", above its own undo)
test("M7-D68: @mem curate says what the pass judged of the suspicions", () => {
  /** @type {Map<number, string>} */
  const verdicts = new Map();
  return world({ models: { summarizer: "judge" }, callModel: judge(verdicts) }, async (w) => {
    const { sit } = await w.session("a").send("hello");
    const projectId = sit.project.id;
    const learned = async (/** @type {string} */ text) => (await w.svc.brain.fileLearned({ projectId, chainId: `l${text.length}`, kind: "fact", text, importance: 0.7 })).id;
    const correction = async (/** @type {string} */ text) => (await w.svc.brain.remember(text, { kind: "rule", projectId, by: "person", chainId: "x" })).itemId;
    const doubted = [
      [await learned("the deploy script uploads the bundle to the cdn bucket"), await correction("no, the deploy script must never upload without a checksum"), "unrelated"],
      [await learned("the api listens on port 3000"), await correction("wrong, the api moved to port 8080 last week"), "wrong"],
      [await learned("the deploy region is eu-west-2"), await correction("no, deploys wait for the region's quiet hours"), "unsure"],
      [(await w.svc.brain.remember("the staging deploy runs from the release branch", { kind: "fact", projectId, by: "person" })).itemId, await correction("no, staging deploys run from main now"), "wrong"],
    ];
    for (const [id, corr, v] of /** @type {[number, number, string][]} */ (doubted)) {
      w.svc.archive.items.note(id, "suspected", { by: "person", detail: { chain: "x", correction: `i${corr}`, words: ["deploy"] } });
      verdicts.set(id, v);
    }
    const reply = (await memoryCommand(w.svc, "@mem curate", sit))?.text || "";
    assert.match(reply, /^- judged 4 memories sessions found may be wrong: 1 cleared, 1 retired, 1 asked about, 1 left standing$/m, reply);
    assert.match(reply, /^- 1 question for you: `@mem inbox`$/m);
    assert.doesNotMatch(reply, /nothing needed changing/);
    // Judged already, nothing new: the next pass says nothing of them.
    const again = (await memoryCommand(w.svc, "@mem curate", sit))?.text || "";
    assert.match(again, /^- nothing needed changing$/m, again);
    assert.doesNotMatch(again, /judged/);
  });
});

// (fails before: yes, for each of these, under m78_mut3's mutants U10–U12, U14, U18 and U20 — no test held the pass to its room, judged a claim in part, offered a verdict the prompt does not, or corrected the user's word of every project)
test("M7-D68: a pass weighs two calls of twelve suspicions at most; the rest wait for the next pass", () => {
  /** @type {Map<number | string, string>} */
  const verdicts = new Map();
  const model = judge(verdicts);
  return world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { sit } = await w.session("a").send("hello");
    const projectId = sit.project.id;
    const W = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey", "xray", "yankee"];
    for (const [i, word] of W.entries()) {
      const id = (await w.svc.brain.fileLearned({ projectId, chainId: `l${i}`, kind: "fact", text: `${word} ${W[(i + 3) % 25]} ${W[(i + 11) % 25]} logs rotate nightly`, importance: 0.6 })).id;
      const c = (await w.svc.brain.remember(`no, ${word} ${W[(i + 5) % 25]} ${W[(i + 13) % 25]} must stay`, { kind: "rule", projectId, by: "person", chainId: "x" })).itemId;
      w.svc.archive.items.note(id, "suspected", { by: "person", detail: { chain: "x", correction: `i${c}`, words: ["logs"] } });
      verdicts.set(id, "unrelated");
    }
    const first = await w.svc.curator.run(projectId);
    assert.deepEqual([model.asked().map((c) => pairsOf(c.user).length), first.suspicionsCleared], [[12, 12], 24]);
    const second = await w.svc.curator.run(projectId);
    assert.deepEqual([model.asked().slice(2).map((c) => pairsOf(c.user).length), second.suspicionsCleared], [[1], 1]);
  });
});

test("M7-D68: a claim's suspicions are judged whole and in the prompt's words; the user's word of every project is asked about, once a correction", () => {
  /** @type {Map<number | string, string>} */
  const verdicts = new Map();
  return world({ models: { summarizer: "judge" }, callModel: judge(verdicts) }, async (w) => {
    const { sit } = await w.session("a").send("hello");
    const projectId = sit.project.id;
    const learned = async (/** @type {string} */ text) => (await w.svc.brain.fileLearned({ projectId, chainId: `l${text.length}`, kind: "fact", text, importance: 0.7 })).id;
    const correction = async (/** @type {string} */ text) => (await w.svc.brain.remember(text, { kind: "rule", projectId, by: "person", chainId: "x" })).itemId;
    const suspect = (/** @type {number} */ id, /** @type {number} */ corr) => w.svc.archive.items.note(id, "suspected", { by: "person", detail: { chain: "x", correction: `i${corr}`, words: ["build"] } });
    const ev = (/** @type {number} */ id, /** @type {string} */ action) => w.svc.archive.items.events(id).filter((/** @type {any} */ e) => e.action === action && !e.undone_at);
    // Two corrections doubt one claim, and the model answers for one: it waits whole. A verdict the prompt does not offer is none.
    const cache = await learned("the build cache lives in .cache/build");
    const [c1, c2] = [await correction("no, the build must run clean on ci"), await correction("no, the cache key must include the lockfile")];
    suspect(cache, c1);
    suspect(cache, c2);
    verdicts.set(`${cache}:${c1}`, "unrelated");
    const maps = await learned("the build emits source maps next to the bundle");
    const c3 = await correction("no, the build must fail on warnings");
    suspect(maps, c3);
    verdicts.set(maps, "maybe");
    await w.svc.curator.run(projectId);
    assert.deepEqual([ev(cache, "cleared").length, ev(maps, "cleared").length, ev(maps, "weighed").length], [0, 0, 0], "judged in part, or in words the prompt does not offer: it waits");
    verdicts.set(`${cache}:${c2}`, "unrelated");
    verdicts.set(maps, "unsure");
    await w.svc.curator.run(projectId);
    assert.deepEqual([ev(cache, "cleared").map((/** @type {any} */ e) => e.detail.corrections), ev(maps, "weighed").map((/** @type {any} */ e) => e.detail.verdict)], [[[`i${c1}`, `i${c2}`]], ["unsure"]]);
    // The user's word of every project, said wrong by one project's correction: asked about, as their word always is.
    const signed = (await w.svc.brain.remember("deploys need a signed tag", { kind: "rule", projectId: null, by: "person" })).itemId;
    const c4 = await correction("no, deploys here need no tag at all");
    suspect(signed, c4);
    verdicts.set(signed, "wrong");
    await w.svc.curator.run(null);
    const asked = () => w.svc.brain.questions(null).filter((/** @type {any} */ q) => q.claims.some((/** @type {any} */ c) => c.id === `i${signed}`));
    assert.deepEqual(asked().map((/** @type {any} */ q) => q.claims.map((/** @type {any} */ c) => c.id)), [[`i${signed}`, `i${c4}`]]);
    // Rejected: that correction is never asked about again; a new one that says it is wrong is.
    await w.svc.brain.decide(asked()[0].id, "reject", { by: "owner" });
    suspect(signed, c4);
    await w.svc.curator.run(null);
    assert.equal(asked().length, 0, "the same correction is not asked about again");
    const c5 = await correction("no, tags are optional for deploys now");
    suspect(signed, c5);
    await w.svc.curator.run(null);
    assert.deepEqual(asked().map((/** @type {any} */ q) => q.claims.map((/** @type {any} */ c) => c.id)), [[`i${signed}`, `i${c5}`]]);
    assert.equal(w.svc.archive.items.get(signed).status, "confirmed", "it stands meanwhile");
  });
});
