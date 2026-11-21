// @ts-check
// HarnessV4_Space_Plan S7, the mock's screen 14: Reproduce it. What an agent asked to reproduce a report says it found —
// a repro's fields, checked (core) —; the store's row, one per chat, and its line in What happened; the agents' space
// tool's `repro`, its refusals and its draft; the page's words — the lane Reproduce… names, the Builder's box, Fix it…'s
// box, a row's lines, a Needs you row handed on —; the Start's lane named by the Space; and end to end: a chat's agent
// reports through a real Filament, the row names the chat's folder as its lane.
// (fails before: yes — there was no Reproduce it)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NEED_KINDS, REPRO_LIMITS, reproFields } from "../src/core/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { SPACE_ACTIONS, SPACE_TOOL, spaceCall } from "../src/app/agent/space.js";
import { REPRO_TIP, reproFixWords, reproLane, reproLines, reproQuestions, reproReportOf, reproduceWords } from "../src/ui/harness/lib/space-view.js";
import { givenWorktreeChoice } from "../src/ui/harness/conversation/works-in.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-space-repro-${tag}-`));
  made.push(d);
  return d;
};

const YES = { title: "PLAY-91 Sign-in loops on Safari", reproduced: true, test: "tests/auth/safari-loop.spec.ts", run: "npx playwright test safari-loop --project=webkit", said: "fails on main, 3 runs of 3" };
const NO = { title: "PLAY-92 Blank page on Edge", reproduced: false, tried: ["a WebKit test with a return URL", "a private window"], questions: ["Which Edge, and which version?"] };

describe("a repro's fields (S7-D3)", () => {
  test("reproduced with its test and how to run it, or not with what it tried; refused in words that name what to add", () => {
    const yes = reproFields(YES);
    assert.ok(yes.ok);
    assert.deepEqual(yes.fields, { title: YES.title, reproduced: true, test: YES.test, run: YES.run, said: YES.said, steps: "", tried: [], questions: [], draft: "" });
    const no = reproFields(NO);
    assert.ok(no.ok);
    assert.deepEqual([no.fields.reproduced, no.fields.tried, no.fields.questions], [false, NO.tried, NO.questions]);
    assert.ok(NEED_KINDS.includes("repro"));
    /** @param {any} input */
    const error = (input) => {
      const r = reproFields(input);
      return r.ok ? "" : r.error;
    };
    assert.match(error({ ...YES, title: " " }), /^a repro needs a title/);
    assert.match(error({ title: "x" }), /^say whether you reproduced it/);
    assert.equal(error({ ...YES, run: "" }), 'a repro that reproduced it names "run" (the command that runs it): the person\'s Fix it… starts from them');
    assert.equal(error({ title: "x", reproduced: true }), 'a repro that reproduced it names "test" (the failing test: its file, or its name) and "run" (the command that runs it): the person\'s Fix it… starts from them');
    assert.match(error({ title: "x", reproduced: false }), /says what you "tried"/);
    assert.match(error({ ...NO, tried: [1] }), /^"tried" lists what you tried/);
    assert.match(error({ ...YES, test: "x".repeat(REPRO_LIMITS.test + 1) }), /^"test" is 300 characters at most/);
  });

  test("forgiving where the meaning is plain: one line where a list was asked, yes and no in words", () => {
    const r = reproFields({ title: "x", reproduced: "no", tried: "a private window", questions: "Which version?" });
    assert.ok(r.ok);
    assert.deepEqual([r.fields.reproduced, r.fields.tried, r.fields.questions], [false, ["a private window"], ["Which version?"]]);
    const y = reproFields({ ...YES, reproduced: "yes" });
    assert.ok(y.ok && y.fields.reproduced === true);
  });
});

describe("the store's repro (S7-D3, D4)", () => {
  test("a row of Needs you and a line in What happened; the chat's second report takes its row, open again; kept across a restart", () => {
    const dir = fresh("store");
    let now = 1000;
    const store = createSpaceStore({ dir, now: () => now });
    const f = /** @type {any} */ (reproFields(YES)).fields;
    const n = store.writeRepro("p1", f, { chain: "c1", byName: "Tester (for Repro)", cwd: "/r-wt/repro-play-91" });
    assert.deepEqual([n.kind, n.text, n.title, n.state, n.repro?.cwd, n.repro?.chain], ["repro", "Reproduced: PLAY-91 Sign-in loops on Safari", YES.title, "open", "/r-wt/repro-play-91", "c1"]);
    assert.deepEqual(store.get("p1").log.at(-1)?.text, "Tester (for Repro) reproduced “PLAY-91 Sign-in loops on Safari”: tests/auth/safari-loop.spec.ts fails (npx playwright test safari-loop --project=webkit).");
    store.needChange("p1", n.id, { done: true });
    assert.equal(store.get("p1").needs[0].state, "done");
    now = 2000;
    const again = store.writeRepro("p1", /** @type {any} */ (reproFields({ ...NO, title: YES.title })).fields, { chain: "c1", byName: "Tester (for Repro)", cwd: "/r-wt/repro-play-91" });
    assert.equal(again.id, n.id, "one row per chat");
    assert.deepEqual([again.text, again.state, again.at], ["Couldn't reproduce: PLAY-91 Sign-in loops on Safari", "open", 2000]);
    assert.equal(store.get("p1").needs.filter((x) => x.kind === "repro").length, 1);
    assert.equal(store.get("p1").log.at(-1)?.text, "Tester (for Repro) could not reproduce “PLAY-91 Sign-in loops on Safari”: it tried 2 ways, with 1 question for the reporter.");
    store.writeRepro("p1", f, { chain: "c2", byName: "Other", cwd: "/r" });
    assert.equal(store.get("p1").needs.filter((x) => x.kind === "repro").length, 2, "another chat's is its own");
    const back = createSpaceStore({ dir, now: () => now }).get("p1").needs.filter((x) => x.kind === "repro");
    assert.deepEqual(back.map((x) => [x.id, x.repro?.reproduced, x.repro?.tried.length]), [[n.id, false, 2], [back[1].id, true, 0]]);
    // A row whose repro does not read as one is left out as it is read.
    const file = join(dir, "p1.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.needs.push({ ...doc.needs[0], id: "n99", repro: { reproduced: "maybe" } });
    writeFileSync(file, JSON.stringify(doc));
    assert.equal(createSpaceStore({ dir, now: () => now }).get("p1").needs.some((x) => x.id === "n99"), false);
  });
});

describe("the agents' space tool: repro", () => {
  test("its row waits in Needs you, its lane the chat's folder; a helper writes as one; a draft it names must be its own; refused in words", () => {
    const store = createSpaceStore({ dir: null, now: () => 1000 });
    const where = { store, project: "p1", chain: "c1", name: null, nameOf: (/** @type {string} */ c) => (c === "c1" ? "Repro PLAY-91" : "Other"), cwdOf: () => "/r-wt/repro-play-91" };
    assert.ok(SPACE_ACTIONS.includes("repro") && /whose fields go in with: [\w, ]*\brepro\b[\w, ]*;/.test(SPACE_TOOL.description), "the door names it; its guide gives it whole (E39)");
    const r = spaceCall({ action: "repro", ...YES }, where);
    assert.deepEqual(r, { ok: true, text: 'n1 "Reproduced: PLAY-91 Sign-in loops on Safari" waits in the person\'s Needs you: Fix it… there starts a chat in this lane\'s folder with your test and how to run it. Say the same in your answer, and fix nothing.' });
    assert.deepEqual([store.get("p1").needs[0].repro?.cwd, store.get("p1").needs[0].repro?.byName], ["/r-wt/repro-play-91", "Repro PLAY-91"]);
    const helper = spaceCall({ action: "repro", ...NO }, { ...where, name: "Tester" });
    assert.ok(helper.ok && helper.text.includes("replaces your earlier report") && helper.text.includes("Copy the questions there"), JSON.stringify(helper));
    assert.equal(store.get("p1").needs[0].repro?.byName, "Tester (for Repro PLAY-91)");
    assert.deepEqual(spaceCall({ action: "repro", title: "x" }, where), { ok: false, error: 'Not written: say whether you reproduced it: "reproduced": true, with the failing "test" and how to "run" it — or false, with what you "tried". The call: {"action":"repro","with":{"title":"PLAY-91 Safari loops","reproduced":true,"test":"tests/safari.spec.ts","run":"npx playwright test safari","said":"12 redirects, then a blank page"}} — {"action":"guide","topic":"repro"} gives every field.' });
    // Its draft: one of its own, waiting in this Space — named by "id", the schema's field (S7-D6), or "draft".
    assert.deepEqual(spaceCall({ action: "repro", ...NO, id: "n7" }, where), { ok: false, error: 'Not written: n7 is no draft of yours in this Space — write the questions as one first ({"action":"draft",…}), or leave "id" out.' });
    const d = store.writeDraft("p1", { title: "Questions on PLAY-92", connection: "linear", tool: "create_comment", args: { body: "{words}" }, words: "Which Edge?", to: "PLAY-92", answers: null, from: [] }, { chain: "c1", byName: "Tester", account: "" });
    const drafted = spaceCall({ action: "repro", ...NO, id: d.id }, where);
    assert.ok(drafted.ok && drafted.text.includes(`Review & send… there opens your draft ${d.id}`), JSON.stringify(drafted));
    assert.equal(store.get("p1").needs.find((n) => n.kind === "repro")?.repro?.draft, d.id);
    assert.ok(spaceCall({ action: "repro", ...NO, draft: d.id }, where).ok, '"draft" is read too');
    assert.equal(spaceCall({ action: "repro", ...NO, id: d.id }, { ...where, chain: "c2" }).ok, false, "another chat's draft is not its own");
    assert.ok(!("draft" in SPACE_TOOL.input_schema.properties), "one field fewer in every chat's request");
    // (fails before: yes — found by the Hunter on S7: a draft already sent or discarded was answered as one that opens in
    // Review & send…, and its row offered it in place of Copy)
    store.draftSent("p1", d.id, { words: "Which Edge?", as: "", link: null });
    const sent = spaceCall({ action: "repro", ...NO, id: d.id }, where);
    assert.ok(sent.ok && sent.text.includes(`your draft ${d.id} was sent already, so Copy the questions there gives the person your questions`), JSON.stringify(sent));
    const d2 = store.writeDraft("p1", { title: "Questions again", connection: "linear", tool: "create_comment", args: { body: "{words}" }, words: "Which build?", to: "PLAY-92", answers: null, from: [] }, { chain: "c1", byName: "Tester", account: "" });
    store.needChange("p1", d2.id, { discard: true });
    const discarded = spaceCall({ action: "repro", ...NO, id: d2.id }, where);
    assert.ok(discarded.ok && discarded.text.includes(`your draft ${d2.id} was discarded, so Copy the questions there`), JSON.stringify(discarded));
  });
});

describe("the page's words (S7-D2, D4)", () => {
  test("the lane: repro/ and the issue key, else the first words", () => {
    assert.deepEqual(
      ["PLAY-91 Sign-in loops on Safari", "#482 Crash on save", "Sign-in loops on Safari, and the redirect never ends for anyone at all", "!!!", "CI failed on main: run 8812 (Fix login redirect)"].map(reproLane),
      ["repro/play-91", "repro/482", "repro/sign-in-loops-on-safari-and-the-redirect", "repro/report", "repro/ci-failed-on-main-run-8812-fix-login"]);
  });

  // (fails before: yes — "Teams, improved and kept" of 11-03: the box was the Tester's, a card Filament does not ship)
  test("the Builder's box: addressed where Agents has it, the report and where it came from, what to do and how to say it", () => {
    const r = { title: "PLAY-91 Sign-in loops on Safari", text: "Assigned to you, High", from: "Issues, a dashboard of app's Space" };
    const w = reproduceWords(r, { builder: true });
    assert.equal(w, "@builder Reproduce this — don't fix it: PLAY-91 Sign-in loops on Safari\n\nAssigned to you, High\n(Issues, a dashboard of app's Space.)\n\nReproduce it with a failing test, or in the Browser pane for a web app; don't fix it. Then say what you found with the space tool's repro: reproduced, with the failing test and how to run it — or not, with what you tried and your questions for the reporter.");
    assert.ok(reproduceWords(r, { builder: false }).startsWith("Reproduce this — don't fix it: "), "no Builder: the chat's own agent");
    assert.ok(!reproduceWords({ ...r, text: r.title }, { builder: true }).includes(`${r.title}\n\n${r.title}`), "its title once");
  });

  // (fails before: yes — the docs of 11-03: Reproduce…'s tooltip said the Tester was asked, a card Filament does not ship)
  test("Reproduce…'s tooltip names the Builder its box addresses, wherever the Space offers it", () => {
    assert.match(REPRO_TIP, /the Builder asked to reproduce it with a failing test and fix nothing: nothing runs until you send$/);
    for (const f of ["board.js", "needs-rows.js", "space.js"]) {
      const src = readFileSync(new URL(`../src/ui/harness/space/${f}`, import.meta.url), "utf8");
      assert.ok(src.includes("REPRO_TIP"), `${f} says it in REPRO_TIP's words`);
      assert.ok(!src.includes("the Tester"), `${f} names no Tester`);
    }
  });

  test("Fix it…'s box, a row's lines, the questions to copy, a row of Needs you handed on", () => {
    const repro = { reproduced: true, test: "t.spec.ts", run: "npm test -- t", said: "fails 3 of 3", steps: "", tried: [], questions: [], draft: "", chain: "c1", byName: "Tester", cwd: "/w" };
    assert.equal(reproFixWords({ title: "PLAY-91 x", repro }), "Fix “PLAY-91 x”. The failing test t.spec.ts shows it — run it with: npm test -- t. It said: fails 3 of 3. Make it pass without weakening it, and say what you changed: ");
    assert.deepEqual(reproLines(repro), ["A failing test: t.spec.ts — fails 3 of 3.", "Run: npm test -- t"]);
    const not = { ...repro, reproduced: false, tried: ["one"], questions: ["Which?", "When?"], draft: "n4" };
    assert.deepEqual(reproLines(not), ["Tried 1 way: one.", "2 questions for the reporter, drafted: “Which?” · “When?”"]);
    // (fails before: yes — found by the Hunter on S7: its draft sent or discarded still read "drafted")
    assert.deepEqual([reproLines(not, "sent")[1], reproLines(not, "")[1]], ["2 questions for the reporter, sent: “Which?” · “When?”", "2 questions for the reporter: “Which?” · “When?”"]);
    assert.equal(reproQuestions(not), "- Which?\n- When?");
    const watch = { id: "w1", kind: /** @type {const} */ ("watch"), text: "CI failed on main: run 8812", why: "a watch of Deploys", dashboard: "deploys", title: "Deploys", at: 0, state: /** @type {const} */ ("open") };
    assert.deepEqual(reproReportOf(watch, "app"), { title: "CI failed on main: run 8812", text: "", from: "Deploys, a dashboard in app's Space, put it in Needs you — a watch of Deploys" });
  });

  test("the Start's lane given by the Space: kept as the message moves, Filament's own so a taken name gives way", () => {
    const c = givenWorktreeChoice("/r", "repro/play-91");
    assert.deepEqual(c, { make: true, name: "repro/play-91", fromMessage: "repro/play-91", given: "repro/play-91", typed: false, folder: "/r" });
  });
});

describe("end to end: a chat's agent reports what it found", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = fresh("e2e");
  before(async () => {
    up = await fakeUpstream(async (call) => {
      const body = call.body || {};
      if (!body.tools?.length) return anthropicReply("A title", { model: "brain-model" });
      const last = body.messages?.at(-1);
      const parts = Array.isArray(last?.content) ? last.content : [];
      if (parts.some((/** @type {any} */ p) => p?.type === "tool_result")) return anthropicReply("Reproduced: the test fails. Fix it… waits in Needs you.", { model: "brain-model" });
      return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "r1", name: "space", input: { action: "repro", ...YES } }] });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    made.push(shim.dataDir);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  test("its row in the project's Space names the chat and the chat's folder; What happened says it", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", title: "Repro PLAY-91", settings: { loop: { permissions: "auto" } } } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    const { projectId } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
    assert.equal((await shim.api(`/api/space/${encodeURIComponent(projectId)}`, { method: "POST" })).status, 200, "its Space made from its menu (10-29)");
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "reproduce PLAY-91", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const space = async () => (await shim.api(`/api/space/${encodeURIComponent(projectId)}`)).json();
    await until(async () => (await space()).needs?.some((/** @type {any} */ n) => n.kind === "repro"), "the repro's row");
    const got = await space();
    const n = got.needs.find((/** @type {any} */ x) => x.kind === "repro");
    assert.deepEqual([n.text, n.repro.chain, n.repro.byName, n.repro.test], ["Reproduced: PLAY-91 Sign-in loops on Safari", id, "Repro PLAY-91", YES.test]);
    assert.equal(String(n.repro.cwd).replace(/\\/g, "/").toLowerCase(), root.replace(/\\/g, "/").toLowerCase(), "the chat's folder: its lane");
    assert.ok(got.log.some((/** @type {any} */ e) => e.text.startsWith("Repro PLAY-91 reproduced “PLAY-91 Sign-in loops on Safari”")));
  });
});
