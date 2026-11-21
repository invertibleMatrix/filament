// @ts-check
// Flow's pure core (HarnessV4_Flow_Plan F1; HarnessV4_OneAgent_Plan OA3): the shape and its checks (§4.10, OA-D5, OA-D10),
// the steps and gates (§4.1, §4.5), the hand-off of what each box needs (FL-D4, OA-D5), the words a box is sent, the
// verdict and the question read off an answer, the end message, and what the main agent reads of a flow — the flow
// tool's answer, the start's notice (OA-D8) and the line ahead of a /flow message (OA-D6).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  FLOW_LIMITS,
  FLOW_END_HEAD,
  FLOW_START_HEAD,
  FLOW_ASK_HEAD,
  FLOW_NOTE_HEAD,
  REVIEW_NAME,
  VERDICT_RULE,
  TEAM_RULE,
  flowOf,
  checkFlow,
  brokenNeeds,
  strangerWords,
  stepAt,
  passed,
  handOff,
  boxAsk,
  backAsk,
  reviewResult,
  verdictOf,
  endsAsking,
  endMessage,
  isFlowEnd,
  flowText,
  startNotice,
  flowAskLine,
  rosterWords,
  flowLine,
  seatsOf,
  writes,
  boxOf,
  ownName,
  placeLine,
  worksIn,
  newsOf,
  newsMark,
} from "../src/core/flow.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { SHIPPED_TEAMS } from "../src/services/teams.js";
import { createSavedFlows } from "../src/services/saved-flows.js";
import { OWN_CARDS } from "./helpers/flow-cards.js";

/** @type {import("../src/core/flow.js").Roster} */
const ROSTER = {
  cards: [...Object.entries(SHIPPED_CARDS).map(([tag, c]) => ({ tag, name: c.name, goodFor: c.goodFor, may: /** @type {any} */ (c).may })), ...OWN_CARDS.map(({ tag, name, goodFor, may }) => ({ tag, name, goodFor, may }))],
  teams: Object.entries(SHIPPED_TEAMS).map(([key, t]) => ({ key, name: t.name, readOnly: /** @type {any} */ (t).readOnly === true })),
};
/** The roster as the server gives it (server.js): no team's own Lead (OA-D4), none that starts by itself. */
const SERVED = {
  cards: ROSTER.cards.filter((c) => !(/** @type {any} */ (SHIPPED_CARDS)[c.tag]?.partOf) && !(/** @type {any} */ (SHIPPED_CARDS)[c.tag]?.starts)),
  teams: ROSTER.teams,
};
const OWNER =
  "hey pm plan a desktop app for harness and hey architect think of a good architecture as well. hey designer do come up with some design and mocks if needed. hey verifier before the plan goes to builder you need to make sure things are good. hey builder spawn bulders to implement the plan. hey bug hunter once implementation is done check for bugs";

/** The owner's example as the main agent designs it (OA3 case 1): each box with an id and what it needs. */
const example = () =>
  flowOf(
    {
      goal: OWNER,
      title: "Plan a desktop app for the harness",
      steps: [
        { why: "The plan comes first.", boxes: [{ id: "plan", agent: "pm", words: "Plan a desktop app for the harness." }] },
        { why: "Both need only the plan.", boxes: [{ id: "arch", agent: "engineer", words: "A good architecture.", needs: ["plan"] }, { id: "mocks", agent: "designer", words: "Mocks if needed.", needs: ["plan"] }] },
        { why: "Nothing is built before it is checked.", boxes: [{ id: "check", agent: "reviewer", words: "Check the plan before it is built.", gate: true, needs: ["plan", "arch", "mocks"] }] },
        { why: "The build reads it all.", boxes: [{ id: "build", team: "builders", words: "Build it.", needs: ["plan", "arch", "mocks", "check"] }] },
        { why: "The hunt reads the build.", boxes: [{ id: "hunt", team: "bughunters", words: "Hunt for bugs in what was built.", needs: ["build"] }] },
      ],
    },
    ROSTER,
    { id: "f1", chainId: "c1", at: 1, drawn: "agent" },
  );
/** @param {import("../src/core/flow.js").FlowBox} b @param {string} text */
const done = (b, text) => Object.assign(b, { state: "done", result: { text, at: 2 } });
/** @param {import("../src/core/flow.js").Flow} f @param {string} id */
const box = (f, id) => /** @type {import("../src/core/flow.js").FlowBox} */ (boxOf(f, id)?.box);

describe("flowOf: a flow's shape", () => {
  test("boxes keep their ids and needs, take names from the roster and a waiting state; the steps their why", () => {
    const f = example();
    assert.equal(f.state, "draft");
    assert.equal(f.tell, true);
    assert.equal(f.drawn, "agent");
    assert.equal(f.steps.length, 5);
    assert.deepEqual(f.steps[1].boxes.map((b) => [b.id, b.name, b.kind, b.state, b.needs]), [["arch", "Engineer", "agent", "waits", ["plan"]], ["mocks", "Designer", "agent", "waits", ["plan"]]]);
    assert.equal(f.steps[3].boxes[0].name, "Builders");
    assert.equal(f.steps[3].boxes[0].kind, "team");
    assert.equal(f.steps[1].why, "Both need only the plan.");
    assert.equal(f.title, "Plan a desktop app for the harness");
  });
  test("a box that names no needs needs the step before's; one with none of its own gets an id; names and tags both read", () => {
    const g = flowOf({ goal: "x", steps: [{ boxes: [{ agent: "PM", words: "a" }, { agent: "@designer", words: "b" }] }, { boxes: [{ agent: "checker", words: "c" }, { agent: "scout", words: "d", needs: [] }] }] }, ROSTER, { id: "f", chainId: "c", at: 0 });
    assert.deepEqual(g.steps[0].boxes.map((b) => [b.id, b.agent]), [["b1", "pm"], ["b2", "designer"]]);
    assert.deepEqual(g.steps[1].boxes[0].needs, ["b1", "b2"]);
    assert.deepEqual(g.steps[1].boxes[1].needs, [], "an empty list is its own: it needs nothing");
    // An id it may not take is made fresh; a kind it does not know is an agent; an agent box may read only.
    const h = flowOf({ goal: "x", steps: [{ boxes: [{ id: "Has Spaces", kind: "nope", agent: "pm", words: "a", readOnly: true }] }] }, ROSTER, { id: "f", chainId: "c", at: 0 });
    assert.deepEqual([h.steps[0].boxes[0].id, h.steps[0].boxes[0].kind, h.steps[0].boxes[0].readOnly], ["b1", "agent", true]);
  });
  test("the person's review: no agent, its own name, never a gate or a reader", () => {
    const f = flowOf({ goal: "x", steps: [{ boxes: [{ id: "a", agent: "pm", words: "p" }] }, { boxes: [{ id: "you", review: true, gate: true, readOnly: true, model: "m" }] }] }, ROSTER, { id: "f", chainId: "c", at: 0 });
    const r = f.steps[1].boxes[0];
    assert.deepEqual([r.kind, r.agent, r.name, r.gate, r.readOnly, r.model, r.needs], ["review", "", REVIEW_NAME, false, false, null, ["a"]]);
    assert.equal(checkFlow(f, ROSTER), null, "a review needs no words");
  });
  // (fails before: yes — Hunter's of 10-31: a box naming a view it is not offered read as null, its card's own view,
  // where a saved card naming one reads as nothing)
  test("what a box sees: nothing or the chat folded as named; a view it is not offered is nothing, in a draft and in a saved flow; none named is its card's", () => {
    const boxes = [
      { id: "a", agent: "pm", words: "w", sees: "folded" },
      { id: "b", agent: "pm", words: "w", sees: "window" },
      { id: "c", agent: "pm", words: "w", sees: "light" },
      { id: "d", agent: "pm", words: "w" },
      { id: "e", team: "builders", words: "w", sees: "words" },
      { id: "f", team: "builders", words: "w", sees: "fork" },
    ];
    const f = flowOf({ goal: "g", steps: [{ boxes }] }, ROSTER, { id: "f", chainId: "c", at: 0 });
    const want = [["a", "folded"], ["b", "none"], ["c", "none"], ["d", null], ["e", "words"], ["f", null]];
    assert.deepEqual(f.steps[0].boxes.map((b) => [b.id, b.sees]), want, "a draft");
    const dir = mkdtempSync(join(tmpdir(), "flows-sees-"));
    try {
      const kept = boxes.map(({ team, ...b }) => (team ? { ...b, kind: "team", agent: team } : { ...b, kind: "agent" }));
      writeFileSync(join(dir, "flows-saved.json"), JSON.stringify({ version: 1, flows: { mine: { name: "Mine", steps: [{ why: "", boxes: kept }], at: 1 } } }));
      const saved = createSavedFlows({ dataDir: dir }).find("mine");
      assert.deepEqual(saved?.steps[0].boxes.map((/** @type {any} */ b) => [b.id, b.sees]), want, "a saved flow, as it is read");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("checkFlow: the refusals, in words", () => {
  test("the owner's example passes", () => assert.equal(checkFlow(example(), ROSTER), null));
  test("a team chat draws no flow", () => assert.match(String(checkFlow(example(), ROSTER, { teamChat: true })), /a team's own chat draws no flow/));
  test("a flow of one box points at the Brief, an ask, or what a review needs", () => {
    const team = flowOf({ goal: "g", steps: [{ boxes: [{ team: "builders", words: "w" }] }] }, ROSTER, { id: "f", chainId: "c", at: 0 });
    assert.match(String(checkFlow(team, ROSTER)), /Builders team's Brief/);
    const ask = flowOf({ goal: "g", steps: [{ boxes: [{ agent: "pm", words: "w" }] }] }, ROSTER, { id: "f", chainId: "c", at: 0 });
    assert.match(String(checkFlow(ask, ROSTER)), /ask PM instead/);
  });
  // (OA3 case 2, L4: "@qa" where no QA exists)
  test("an agent or a team nobody has is refused with who there is", () => {
    const f = example();
    f.steps[0].boxes[0].agent = "qa";
    const said = String(checkFlow(f, SERVED));
    assert.match(said, /^no agent of the person's is called "qa": theirs are product \(Product\), enduser \(End user\), builder \(Builder\), reviewer \(Reviewer\), pm \(PM\), designer \(Designer\)/);
    assert.match(said, /and their teams [^—]*bughunters \(BugHunters\)[^—]*— pick one of them, or ask the person$/);
    const g = example();
    g.steps[3].boxes[0].agent = "ghosts";
    assert.match(String(checkFlow(g, ROSTER)), /no team of the person's is called "ghosts": theirs are /);
    assert.equal(strangerWords("team", "x", { cards: [], teams: [] }), 'no team of the person\'s is called "x": theirs are none — pick one, or ask the person');
  });
  test("a gate is an agent box past the first step that needs what it checks; it may share its step", () => {
    const f = example();
    f.steps[3].boxes[0].gate = true;
    assert.match(String(checkFlow(f, ROSTER)), /a gate is an agent box/);
    const g = example();
    g.steps[0].boxes[0].gate = true;
    assert.match(String(checkFlow(g, ROSTER)), /a gate checks what came before it, so it cannot be the first step/);
    const h = example();
    box(h, "check").needs = [];
    assert.match(String(checkFlow(h, ROSTER)), /a gate checks what it needs — name the boxes it checks/);
    const k = example();
    box(k, "arch").gate = true;
    assert.equal(checkFlow(k, ROSTER), null, "a gate beside another box");
  });
  test("your review: not the first step, and it names what you review", () => {
    const f = example();
    f.steps[0].boxes.push({ ...box(f, "plan"), id: "you", kind: "review", agent: "", name: REVIEW_NAME, words: "", needs: [] });
    assert.match(String(checkFlow(f, ROSTER)), /your review looks at what came before it, so it cannot be the first step/);
    const g = example();
    g.steps[2].boxes.push({ ...box(g, "check"), id: "you", kind: "review", agent: "", name: REVIEW_NAME, gate: false, words: "", needs: [] });
    assert.match(String(checkFlow(g, ROSTER)), /name the boxes you review/);
    box(g, "you").needs = ["arch", "mocks"];
    assert.equal(checkFlow(g, ROSTER), null);
  });
  // (OA3 case 5: a box moved below one it needs, or a need that is no box)
  test("needs: only boxes of earlier steps, each one there, never itself; each id once", () => {
    const f = example();
    box(f, "arch").needs = ["plan", "mocks"];
    assert.match(String(checkFlow(f, ROSTER)), /Engineer \(step 2\) needs Designer \(step 2\): a box reads only the results of the steps before its own — move Designer up, or Engineer down/);
    assert.deepEqual([...brokenNeeds(f)], [["arch", ["Designer"]]]);
    const g = example();
    box(g, "hunt").needs = ["ghost"];
    assert.match(String(checkFlow(g, ROSTER)), /BugHunters \(step 5\) needs "ghost", which is no box of this flow/);
    assert.deepEqual([...brokenNeeds(g)], [["hunt", ["ghost"]]]);
    const h = example();
    box(h, "hunt").needs = ["hunt"];
    assert.match(String(checkFlow(h, ROSTER)), /needs itself/);
    const k = example();
    box(k, "mocks").id = "arch";
    assert.match(String(checkFlow(k, ROSTER)), /two boxes share the id arch/);
    assert.equal(brokenNeeds(example()).size, 0);
  });
  test("two writers in one step; one drawn Reads only passes", () => {
    const f = example();
    f.steps[3].boxes.push({ ...f.steps[3].boxes[0], id: "b9", agent: "builders", name: "Builders" });
    assert.match(String(checkFlow(f, ROSTER)), /step 4 has 2 boxes that write \(Builders, Builders\): two writers side by side change the same files/);
    f.steps[3].boxes[1].readOnly = true;
    assert.equal(checkFlow(f, ROSTER), null);
    // A team that reads only as it ships never writes, whatever the box says; an agent box writes in no folder.
    assert.equal(writes(f.steps[4].boxes[0], ROSTER), false);
    assert.equal(writes(f.steps[3].boxes[0], ROSTER), true);
    assert.equal(writes(box(f, "arch"), ROSTER), false);
  });
  test("an empty step, no words, no goal, too many steps", () => {
    const f = example();
    f.steps.splice(1, 0, { why: "", boxes: [] });
    assert.match(String(checkFlow(f, ROSTER)), /step 2 has no box/);
    const g = example();
    g.steps[0].boxes[0].words = " ";
    assert.match(String(checkFlow(g, ROSTER)), /PM \(step 1\): say what it is asked/);
    const h = example();
    h.goal = "";
    assert.match(String(checkFlow(h, ROSTER)), /say what the flow is for/);
    const k = example();
    k.steps = Array.from({ length: FLOW_LIMITS.steps + 1 }, (_, i) => ({ why: "", boxes: [{ ...k.steps[0].boxes[0], id: `x${i}`, needs: [] }] }));
    assert.match(String(checkFlow(k, ROSTER)), /10 steps at most/);
  });
});

describe("steps and gates", () => {
  test("a step passes once each box is done or skipped; a gate only on go or Go on anyway", () => {
    const f = example();
    assert.equal(stepAt(f), 0);
    done(f.steps[0].boxes[0], "the plan");
    assert.equal(stepAt(f), 1);
    done(f.steps[1].boxes[0], "the architecture");
    assert.equal(stepAt(f), 1, "its neighbour still works");
    f.steps[1].boxes[1].state = "skipped";
    assert.equal(stepAt(f), 2);
    const gate = f.steps[2].boxes[0];
    done(gate, "Verdict: not yet — the tray is NA3's");
    gate.verdict = verdictOf(gate.result?.text);
    assert.equal(passed(gate), false);
    assert.equal(stepAt(f), 2, "not yet holds the gate's step");
    gate.goneOn = true;
    assert.equal(stepAt(f), 3);
    gate.goneOn = false;
    gate.verdict = { go: true, why: "" };
    assert.equal(stepAt(f), 3);
    for (const s of f.steps.slice(3)) done(s.boxes[0], "r");
    assert.equal(stepAt(f), -1);
  });
});

describe("handOff: the results of the boxes a box needs (FL-D4, OA-D5)", () => {
  test("a box that needs none is handed nothing; the others each result they need in its block, a skipped box said", () => {
    const f = example();
    assert.equal(handOff(f, box(f, "plan")), null);
    done(box(f, "plan"), "PLAN");
    done(box(f, "arch"), "ARCH");
    box(f, "mocks").state = "skipped";
    const a = handOff(f, box(f, "arch"));
    assert.equal(a?.count, 1);
    assert.doesNotMatch(String(a?.text), /ARCH/);
    const h = handOff(f, box(f, "check"));
    assert.ok(h);
    assert.equal(h.count, 3);
    assert.match(h.text, /^<flow-results count="3">\nThe results of the boxes your part needs/);
    assert.match(h.text, /<flow-result step="1" box="PM" kind="agent">\nPLAN\n<\/flow-result>/);
    assert.match(h.text, /<flow-result step="2" box="Engineer" kind="agent">\nARCH/);
    assert.match(h.text, /<flow-result step="2" box="Designer" kind="agent" skipped="yes">\nThe person skipped this box/);
    assert.ok(h.text.indexOf("PLAN") < h.text.indexOf("ARCH"), "earliest first");
    assert.deepEqual(h.cut, []);
  });
  // (OA3 case 1: "only the needs' results go to each box")
  test("the hunt needs the build alone: nothing of the plan reaches it", () => {
    const f = example();
    for (const s of f.steps.slice(0, 4)) for (const b of s.boxes) done(b, `${b.name.toUpperCase()} RESULT`);
    box(f, "check").verdict = { go: true, why: "" };
    const h = handOff(f, box(f, "hunt"));
    assert.equal(h?.count, 1);
    assert.match(String(h?.text), /BUILDERS RESULT/);
    assert.doesNotMatch(String(h?.text), /PM RESULT|ENGINEER RESULT/);
  });
  test("an agent's artifacts by title and address, its changes in its own copy said; a gate's verdict on its block", () => {
    const f = example();
    done(box(f, "plan"), "p");
    Object.assign(box(f, "arch"), { state: "done", result: { text: "a", at: 1, wrote: true } });
    Object.assign(box(f, "mocks"), { state: "done", result: { text: "two mocks", at: 1, made: [{ title: "Tray card", address: "http://tray.art.localhost:20300/" }, { title: "Alerts", address: "http://alerts.art.localhost:20300/" }] } });
    const gate = done(box(f, "check"), "Verdict: go");
    gate.verdict = { go: true, why: "" };
    const h = handOff(f, box(f, "build"));
    assert.match(String(h?.text), /It published 2 artifacts[^\n]*\n- Tray card — http:\/\/tray\.art\.localhost:20300\/\n- Alerts — /);
    assert.match(String(h?.text), /box="Engineer" kind="agent">\na\n\nIt changed files in its own copy of the project; they wait on its thread/);
    assert.match(String(h?.text), /box="Reviewer" kind="gate" verdict="go"/);
  });
  test("each result whole up to 60,000; past 120,000 together the earliest are cut first, each said", () => {
    const f = example();
    done(box(f, "plan"), "P".repeat(70_000));
    done(box(f, "arch"), "A".repeat(50_000));
    done(box(f, "mocks"), "D".repeat(50_000));
    const h = handOff(f, box(f, "check"));
    assert.ok(h);
    // P is cut to 60,000 first; then 60k + 50k + 50k is 40k over, which comes off P, the earliest.
    assert.equal((h.text.match(/P/g) || []).length - (h.text.match(/PM/g) || []).length, 20_000);
    assert.equal((h.text.match(/A{1000}/g) || []).length, 50);
    assert.equal((h.text.match(/D{1000}/g) || []).length, 50);
    assert.deepEqual(h.cut, ["PM"]);
    assert.match(h.text, /left out to fit every result/);
  });
});

describe("boxAsk and backAsk: the words a box is sent", () => {
  test("an agent box's prompt holds the note with its step's why and its needs, the goal, the results and its part; a gate's ends on the verdict rule", () => {
    const f = example();
    done(box(f, "plan"), "THE PLAN");
    const a = boxAsk(f, box(f, "arch"), 1);
    assert.ok(a.prompt.startsWith(FLOW_NOTE_HEAD));
    assert.match(a.prompt, /You are Engineer, in step 2 of 5, placed there because: Both need only the plan\. Your part needs PM: their results are below\./);
    assert.match(a.prompt, /<flow-goal title="Plan a desktop app for the harness">[\s\S]*hey pm plan a desktop app/);
    assert.match(a.prompt, /THE PLAN/);
    assert.match(a.prompt, /Your part: A good architecture\.$/);
    assert.match(boxAsk(f, box(f, "plan"), 0).prompt, /Your part needs no box's result: the person's words are your start\./);
    const g = boxAsk(f, box(f, "check"), 2);
    assert.ok(g.prompt.endsWith(VERDICT_RULE));
    assert.match(g.prompt, /the flow's gate/);
    assert.match(g.prompt, /Your part needs PM, Engineer and Designer/);
  });
  test("a team box's ask is its part alone, under a Brief's 4,000; the rest rides apart", () => {
    const f = example();
    done(box(f, "plan"), "X".repeat(30_000));
    const t = boxAsk(f, box(f, "build"), 3);
    assert.equal(t.ask, `Your part: Build it.\n\n${TEAM_RULE}`);
    assert.ok(t.ask.length < 4000);
    assert.match(t.handoff, /X{30000}/);
    assert.doesNotMatch(t.ask, /flow-results/);
  });
  test("a box sent back reads the gate's answer and the person's line, or that the person reviewed it; a team's says its changes stay", () => {
    const f = example();
    const w = backAsk(box(f, "build"), { gate: "Reviewer", answer: "Verdict: not yet — two files do not exist", line: "keep the tray out" });
    assert.match(w, /<flow-gate box="Reviewer">\nVerdict: not yet — two files do not exist\n<\/flow-gate>/);
    assert.match(w, /The person's line: keep the tray out/);
    assert.match(w, /What you already changed stays: go on from it/);
    assert.doesNotMatch(backAsk(box(f, "arch"), { gate: "V", answer: "a", line: "" }), /person's line|already changed/);
    const r = backAsk(box(f, "arch"), { gate: REVIEW_NAME, review: true, answer: "", line: "smaller" });
    assert.match(r, /the person reviewed it and sent it back with a line of their own\. Do your part again with it in mind: your new final reply replaces your last result, and the person reviews it again\./);
    assert.doesNotMatch(r, /<flow-gate/);
    assert.match(r, /The person's line: smaller/);
  });
  test("what your review hands on when you go on", () => {
    assert.equal(reviewResult(""), "The person reviewed the work before this point and went on.");
    assert.equal(reviewResult("  ship it "), "The person reviewed the work before this point and went on, with a line of theirs: ship it");
  });
});

describe("verdictOf and endsAsking", () => {
  test("the last Verdict line wins; go, not yet with its why, markdown around it", () => {
    assert.deepEqual(verdictOf("Verdict: go\n\nall good"), { go: true, why: "" });
    assert.deepEqual(verdictOf("**Verdict:** not yet — two files it names do not exist"), { go: false, why: "two files it names do not exist" });
    assert.deepEqual(verdictOf("Verdict: go\n…on second thought\n> Verdict: Not yet: the tray is NA3's"), { go: false, why: "the tray is NA3's" });
    assert.deepEqual(verdictOf("## Verdict: GO."), { go: true, why: "" });
    assert.deepEqual(verdictOf("Verdict: no - missing tests"), { go: false, why: "missing tests" });
  });
  test("no verdict line, or one that says neither, is no verdict", () => {
    assert.equal(verdictOf("It looks fine to me."), null);
    assert.equal(verdictOf("Verdict: maybe"), null);
    assert.equal(verdictOf(""), null);
  });
  test("a reply whose last paragraph ends on a question asks", () => {
    assert.equal(endsAsking("Done the plan.\n\nShould I use NSIS or MSI?"), true);
    assert.equal(endsAsking("Which one?**"), true);
    assert.equal(endsAsking("Is it worth it? Yes.\n\nHere is the plan."), false);
    assert.equal(endsAsking(""), false);
  });
});

describe("the end message (FL-D11)", () => {
  test("a line per box, the last step's results whole, one block Filament's", () => {
    const f = example();
    for (const s of f.steps) for (const b of s.boxes) done(b, `${b.name} result`);
    box(f, "check").verdict = { go: true, why: "" };
    /** @type {any} */ (box(f, "mocks").result).wrote = true;
    const m = endMessage(f);
    assert.ok(m.startsWith(FLOW_END_HEAD));
    assert.match(m, /^3\. Reviewer \(gate\) — go$/m);
    assert.match(m, /^2\. Engineer \(agent\) — done; Designer \(agent\) — done, changes in its own copy$/m);
    assert.match(m, /what its agents changed in their own copies waits on their threads/);
    assert.match(m, /<flow-result step="5" box="BugHunters">\nBugHunters result\n<\/flow-result>/);
    assert.doesNotMatch(m, /PM result/, "only the last step's results go whole");
    assert.equal(isFlowEnd({ content: [{ type: "text", text: m }] }), true);
    assert.equal(isFlowEnd({ content: "hello" }), false);
  });
});

describe("what the main agent reads of a flow (OA-D6, OA-D8)", () => {
  test("flowText: each step with its why, each box with its id, who it is, its needs and its part", () => {
    const t = flowText(example(), ROSTER);
    assert.match(t, /^<flow id="f1" title="Plan a desktop app for the harness" state="draft">\nWhat it is for: hey pm plan/);
    assert.match(t, /^Step 2 — why here: Both need only the plan\.$/m);
    assert.match(t, /^- arch: Engineer \(agent\) · needs plan \(PM\) · "A good architecture\."$/m);
    assert.match(t, /^- check: Reviewer \(gate\) · needs plan \(PM\), arch \(Engineer\), mocks \(Designer\) · /m);
    assert.match(t, /^- build: Builders \(team, writes\) · needs /m);
    assert.match(t, /^- hunt: BugHunters \(team, reads only\) · needs build \(Builders\)/m);
    assert.match(t, /<\/flow>$/);
    const f = example();
    f.state = "running";
    done(box(f, "plan"), "p");
    assert.match(flowText(f, ROSTER), /^- plan: PM \(agent\) · needs nothing · done · /m);
  });
  test("the start's notice: the flow as it stands, who drew it, where its end goes; it says not to start its boxes", () => {
    const f = example();
    const n = startNotice(f, ROSTER);
    assert.ok(n.startsWith(FLOW_START_HEAD));
    assert.match(n, /the draft you drew, with any change of theirs in it/);
    assert.match(n, /its end comes to you as one message\. Do not start its boxes yourself/);
    assert.match(n, /<flow id="f1"/);
    f.tell = false;
    f.drawn = "hand";
    assert.match(startNotice(f), /drawn by them[\s\S]*its end waits for the person, who left Tell my agent when done off/);
  });
  test("the line ahead of a /flow message: the rules of a flow and the person's agents and teams; or that the tool is off", () => {
    const l = flowAskLine(SERVED);
    assert.ok(l.startsWith(FLOW_ASK_HEAD));
    assert.match(l, /with Filament's flow tool, action "draft"/);
    assert.match(l, /only boxes of earlier steps/);
    assert.match(l, /^- pm: PM, edits in its own copy — Is it worth building/m);
    assert.match(l, /^- reviewer: Reviewer, reads only — /m);
    assert.match(l, /^- builder: Builder, edits in its own copy — /m);
    assert.match(l, /^- bughunters: BugHunters, reads only$/m, "no line, no dash");
    assert.match(l, /^- builders: Builders, writes$/m);
    assert.match(l, /Two boxes that write never share a step\. In a git project the flow works in a worktree of its own from its first team box that writes on, never in this chat's folder/);
    assert.doesNotMatch(l, /^- buildlead: Builders, (reads|edits|runs)/m, "a team's own Lead is its team's (OA-D4)");
    assert.match(l, /\n\]$/);
    assert.match(flowAskLine(SERVED, { off: true }), /Filament's flow tool is off in this chat, so you cannot draw it/);
    // (fails before: yes — the bug round of 10-23: a coding agent Filament's tools do not reach was told of a switch
    // that could not help)
    assert.match(flowAskLine(SERVED, { off: "switch" }), /the chat's settings turn it on \(its Tools, Flows\); you may describe/);
    const agent = flowAskLine(SERVED, { off: "agent" });
    assert.match(agent, /this chat's coding agent takes no MCP server over HTTP, and Filament's tools reach a coding agent that way alone, so you cannot draw it\. Say so: the person draws it by hand in the Agents tab, under Flows; you may describe the steps you would draw\.\]$/);
    assert.match(flowAskLine(SERVED, { off: "plain" }), /this chat is a plain chat, whose model runs no tools, so you cannot draw it\. Say so: the person draws it by hand in the Agents tab, under Flows, or runs this chat on Filament's agent loop; you may describe/);
    assert.doesNotMatch(agent, /settings turn it on/);
    assert.match(flowAskLine(SERVED, { off: "none" }), /Filament keeps no flows here, so you cannot draw it\. Say so; you may describe/);
    assert.match(rosterWords({ cards: [], teams: [] }), /Their agents \(a box's "agent"\):\n\(none\)\nTheir teams \(a box's "team"\):\n\(none\)/);
  });
});

describe("where a flow works (OA5)", () => {
  /** @type {import("../src/core/flow.js").BoxPlace} */
  const TREE = { kind: "worktree", name: "flow-plan-a-desktop-app", branch: "flow-plan-a-desktop-app", folder: "H:/filament-flow-plan-a-desktop-app", cwd: "H:/filament-flow-plan-a-desktop-app" };
  test("its worktree's name: its title as a branch takes it, cut to 24, else its id", () => {
    assert.equal(ownName({ id: "f1", title: "Plan a desktop app for the harness" }), "flow-plan-a-desktop-app-for");
    assert.equal(ownName({ id: "f1", title: "Ship it!! (v2)" }), "flow-ship-it-v2");
    assert.equal(ownName({ id: "fl-9", title: "…" }), "flow-fl-9");
  });
  test("its lines: where a box's changes are, and where the flow works — a worktree, or the folder and why", () => {
    assert.equal(placeLine(TREE), "its changes are on branch flow-plan-a-desktop-app, in the worktree H:/filament-flow-plan-a-desktop-app");
    assert.equal(placeLine({ kind: "folder", folder: "H:/x", why: "it is not in a git repository" }), "its changes are in the folder");
    assert.equal(placeLine(null), "");
    assert.match(worksIn(TREE), /^Works in: the worktree H:\/filament-flow-plan-a-desktop-app, on branch flow-plan-a-desktop-app — made from the folder's last commit when its first team box that writes started; every box after it works there, never in your folder, and nothing of it is merged\.$/);
    assert.equal(worksIn({ kind: "folder", folder: "H:/x", why: "its git repository has no commit yet" }), "Works in: the folder — its git repository has no commit yet, so its boxes that write change your folder's files.");
    assert.equal(worksIn(undefined), "");
  });
  test("what the main agent reads: the flow's place under its goal, a writing team's branch on its line, the news once it is made, the end", () => {
    const f = example();
    f.state = "running";
    done(box(f, "plan"), "p");
    assert.doesNotMatch(flowText(f, ROSTER), /Works in/, "none before a team that writes started");
    const mark = newsMark(f);
    f.place = TREE;
    box(f, "build").place = TREE;
    box(f, "build").state = "working";
    box(f, "build").startedAt = 5;
    const t = flowText(f, ROSTER);
    assert.match(t, /^What it is for: .*\nWorks in: the worktree H:\/filament-flow-plan-a-desktop-app/m);
    assert.match(t, /^- build: Builders \(team, writes in the flow's worktree on branch flow-plan-a-desktop-app\) · /m);
    const n = newsOf(mark, f);
    assert.match(String(n?.text), /- Works in: the worktree H:\/filament-flow-plan-a-desktop-app/);
    assert.match(String(n?.short), /works on branch flow-plan-a-desktop-app/);
    assert.equal(newsOf(newsMark(f), f), null, "said once");
    assert.equal(newsOf({ ...newsMark(f), place: undefined }, f)?.short.includes("works on branch"), true, "a mark kept before OA5 has none: it is told");
    for (const s of f.steps) for (const b of s.boxes) done(b, `${b.name} result`);
    box(f, "check").verdict = { go: true, why: "" };
    const m = endMessage(f);
    assert.match(m, /<flow-end title="Plan a desktop app for the harness">\nWorks in: the worktree/);
    assert.match(m, /^4\. Builders \(team, writes in the flow's worktree on branch flow-plan-a-desktop-app\) — done; its changes are on branch flow-plan-a-desktop-app, in the worktree H:\/filament-flow-plan-a-desktop-app$/m);
    assert.match(m, /on the flow's own branch, in its worktree, or in the folder[\s\S]*Nothing of it is merged/);
  });
  // (fails before: yes — HarnessV4_DesignPass_Plan, case 13: neither said a box's pictures)
  test("a box's pictures: its news names them and how to open one; the end counts them on its line and names them, in the registry's words where given", () => {
    const f = example();
    f.state = "running";
    const mark = newsMark(f);
    done(box(f, "plan"), "p");
    box(f, "plan").result = { text: "p", at: 2, drew: [{ title: "plan_map", bytes: 1500 }] };
    assert.match(String(newsOf(mark, f)?.text), /is done, with 1 picture \(plan_map: open one by its name with Filament's envelope tool\)\./);
    for (const s of f.steps) for (const b of s.boxes) if (b.id !== "plan") done(b, `${b.name} result`);
    box(f, "check").verdict = { go: true, why: "" };
    assert.match(endMessage(f), /^1\. PM \(agent\) — done, 1 picture$/m);
    assert.match(endMessage(f), /\n\nIts boxes drew plan_map, shown to the developer\.\n<\/flow-end>$/, "its names, where no words are given");
    assert.match(endMessage(f, null, (drew) => `OPEN ${drew.map((d) => d.title).join("+")}`), /\n\nOPEN plan_map\n<\/flow-end>$/);
    box(f, "plan").state = "failed";
    assert.doesNotMatch(endMessage(f), /plan_map/, "a box that did not end done names none");
  });
});

describe("the status line and the seats", () => {
  test("where the flow is and what it waits for", () => {
    const f = example();
    assert.equal(flowLine(f), "Flow · drawn, not started");
    f.state = "running";
    assert.equal(flowLine(f), "Flow · step 1 of 5");
    f.steps[0].boxes[0].state = "seat";
    assert.equal(flowLine(f), "Flow · step 1 of 5 · waits for a seat");
    done(f.steps[0].boxes[0], "p");
    for (const b of f.steps[1].boxes) done(b, "x");
    const gate = done(f.steps[2].boxes[0], "Verdict: not yet");
    gate.verdict = { go: false, why: "" };
    Object.assign(f, { state: "holds", hold: { kind: "gate", box: gate.id } });
    assert.equal(flowLine(f), "Flow · step 3 of 5 · Reviewer asks you");
    f.state = "cut";
    assert.equal(flowLine(f), "Flow · step 3 of 5 · stopped by a restart");
    assert.equal(boxOf(f, gate.id)?.step, 2);
    // Your review, when its step comes.
    const g = example();
    g.steps[2].boxes.push({ ...box(g, "check"), id: "you", kind: "review", agent: "", name: REVIEW_NAME, gate: false, state: "asking", needs: ["arch"] });
    g.state = "running";
    done(box(g, "plan"), "p");
    for (const b of g.steps[1].boxes) done(b, "x");
    assert.equal(flowLine(g), "Flow · step 3 of 5 · your review");
  });
  test("the widest step's agent boxes", () => assert.equal(seatsOf(example()), 2));
});
