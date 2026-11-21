// @ts-check
// WP-I: the goal layer v1. `/goal <text>` spends exactly one estimate call and proposes a slice; nothing is active
// until `/goal accept`; the accepted slice is said on the person's next message and rides the end of the system prompt
// from the chat's next compaction on, so no change of the goal rewrites a byte the provider cached; close and reopen keep
// the goal on the session. It counts no money (the owner's of 11-05: "drop the whole spend tracking"): no request books to
// it. An outside client's goal is not driven: core/goal-drive.js and test/goal-drive.test.js drive a Filament chat's.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { parseGoalCommand as parseGoal } from "../src/app/commands/parse.js";

/** The grammar, typed loosely for the assertions. @param {string} t @returns {any} */
const parseGoalCommand = (t) => parseGoal(t);
import { parseEstimateReply, goalBlockText, newGoal } from "../src/services/memory/goal.js";

const text = (blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");

test("grammar: set (with a multi-line wish), accept, slice, status, done, abandon, help; any other first word is the goal's", () => {
  assert.deepEqual(parseGoalCommand("/goal"), { action: "show", raw: "/goal", command: "/goal" });
  assert.deepEqual(parseGoalCommand("/goal status").action, "show");
  assert.deepEqual(parseGoalCommand("/goal accept").action, "accept");
  assert.deepEqual(parseGoalCommand("/goal done").action, "done");
  assert.deepEqual(parseGoalCommand("/goal abandon").action, "abandon");
  assert.deepEqual(parseGoalCommand("/goal help").action, "help");
  const set = parseGoalCommand("/goal Beat Unity at 2D tooling\nStart with the sprite editor.");
  assert.deepEqual(set, { action: "set", text: "Beat Unity at 2D tooling\nStart with the sprite editor.", raw: "/goal Beat Unity at 2D tooling", command: "/goal" });
  assert.deepEqual(parseGoalCommand("/goal ship the login page").action, "set");
  assert.deepEqual(parseGoalCommand("/goal slice only the sprite editor's import path"), { action: "slice", text: "only the sprite editor's import path", raw: "/goal slice only the sprite editor's import path", command: "/goal" });
  // (fails before: yes — `budget` answered that goal budgets were gone, and a trailing `budget <usd>` was cut from the goal)
  assert.deepEqual(parseGoalCommand("/goal budget the release work"), { action: "set", text: "budget the release work", raw: "/goal budget the release work", command: "/goal" });
  assert.equal(parseGoalCommand("/goal ship the sprite editor on budget 40")?.["text"], "ship the sprite editor on budget 40", "the goal's words, as typed");
  assert.equal(parseGoalCommand("/goals are nice"), null, "another word");
  assert.equal(parseGoalCommand("please /goal x"), null, "not at the head");
});

test("the estimate reply is read conservatively; the block is fields only; a goal has no ledger", () => {
  assert.deepEqual(parseEstimateReply('Here: {"sizeClass": "Weeks", "achievableSlice": "A sprite importer for one format.", "assumptions": ["Unity-like scene graph exists"], "firstStep": "Read the asset pipeline."}'), {
    sizeClass: "weeks",
    achievableSlice: "A sprite importer for one format.",
    assumptions: ["Unity-like scene graph exists"],
    firstStep: "Read the asset pipeline.",
  });
  assert.equal(parseEstimateReply('{"sizeClass": "epic", "achievableSlice": "something"}'), null, "an unknown size class is no estimate");
  assert.equal(parseEstimateReply('{"sizeClass": "days", "achievableSlice": "x"}'), null, "a slice too short to mean anything");
  assert.equal(parseEstimateReply("I think about a week"), null);
  let g = newGoal("beat unity", { now: 1000 });
  g = { ...g, status: "active", slice: "one importer", estimate: { sizeClass: "weeks", achievableSlice: "one importer", assumptions: [], firstStep: "read", at: 1, model: "m", requestId: null } };
  const block = goalBlockText(g);
  assert.equal(block, "Goal for this session (set by the developer through Filament; work against this slice, not the wider wish):\none importer\nSized weeks. First step: read");
  // (fails before: yes — every goal carried totals and a ledger its requests booked to)
  assert.deepEqual(Object.keys(newGoal("x", { now: 1 })).sort(), ["acceptedAt", "closedAt", "createdAt", "estimate", "slice", "status", "text"]);
});

describe("the goal layer end to end", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {any[]} */
  const estimateCalls = [];
  /** @type {any[]} */
  const modelCalls = [];
  let badEstimate = false;
  before(async () => {
    up = await fakeUpstream((call) => {
      const b = call.body || {};
      const sys = typeof b.system === "string" ? b.system : JSON.stringify(b.system || "");
      if (/You size a software goal/.test(sys)) {
        estimateCalls.push(call);
        if (badEstimate) return anthropicReply("I think about a week", { model: b.model, usage: { input_tokens: 200, output_tokens: 6 } });
        return anthropicReply('{"sizeClass": "weeks", "achievableSlice": "A working sprite importer for PNG sheets with a golden test.", "assumptions": ["the editor has an asset pipeline to hook"], "firstStep": "Read the asset pipeline entry points."}', {
          model: b.model,
          usage: { input_tokens: 200, output_tokens: 60 },
        });
      }
      modelCalls.push(call);
      return anthropicReply("MODEL ANSWER", { model: b.model, usage: { input_tokens: 100, output_tokens: 10 } });
    });
    shim = await startApp({
      memory: true,
      summarizer: "cheap-model",
      configure: (cfg) => {
        cfg.upstreams = [
          {
            id: "m",
            name: "m",
            type: "anthropic",
            baseUrl: up.url,
            apiKey: "s",
            enabled: true,
            pricing: { "big-model": { input: 10, output: 30 }, "cheap-model": { input: 1, output: 1 } },
          },
        ];
        cfg.routes = [
          { match: "big-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "cheap-*", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.capture = { turns: true, learn: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });
  const SESSION = { "x-session-id": "goal-session-1", "x-filament-cwd": "C:\\demo\\goal" };
  /** A request of the session with these messages. @param {any[]} messages */
  const sayAll = async (messages, headers = SESSION) => {
    const r = await shim.post("/v1/messages", { model: "big-model", max_tokens: 100, system: "You are helping.", messages }, headers);
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return { text: text(j.content), id: r.headers.get("x-filament-request-id"), rec: await shim.record(r.headers.get("x-filament-request-id")) };
  };
  const say = async (content, headers = SESSION) => sayAll([{ role: "user", content }], headers);
  /** A system prompt or a message's content, as text. @param {any} s */
  const asText = (s) => (typeof s === "string" ? s : s.map((b) => b.text).join("\n"));
  /** The chat's newest compaction, made as a client's summary is archived. @param {string} chain */
  const compact = (chain) => /** @type {any} */ (shim.app).memory.archive.addCompaction(chain, { fromTurn: 1, toTurn: 1, summaryText: "the work so far", kind: "client", method: "summary" });
  const GOAL_BLOCK = `<filament-memory kind="goal">\nGoal for this session (set by the developer through Filament; work against this slice, not the wider wish):\nA working sprite importer for PNG sheets with a golden test.\nSized weeks. First step: Read the asset pipeline entry points.\n</filament-memory>`;
  const goalOf = () => {
    const chainId = /** @type {any} */ (shim.app).memory.chainIdFor({ key: "h:" + "", project: {} }) && null;
    void chainId;
    const chains = /** @type {any} */ (shim.app).memory.archive.recentChains({ limit: 20 });
    const ch = chains.find((c) => c.client === "node" && c.meta?.goal) || chains[0];
    return /** @type {any} */ (shim.app).memory.goalFor(ch.id);
  };

  test("setting a goal spends one tagged estimate call and proposes a slice; nothing is active; a second set is refused while one is open", async () => {
    await say("hello there, we are starting");
    const before = modelCalls.length;
    const r = await say("/goal Beat Unity at 2D tooling");
    assert.match(r.text, /^Goal noted: “Beat Unity at 2D tooling”\.\n/);
    assert.match(r.text, /this is a \*\*weeks\*\*-sized goal/);
    assert.match(r.text, /achievable slice: A working sprite importer for PNG sheets with a golden test\./);
    assert.match(r.text, /Nothing is active yet/);
    assert.equal(r.rec.card?.notes, undefined, "a goal sized at once leaves the card nothing to add");
    assert.equal(estimateCalls.length, 1, "exactly one estimate call");
    assert.equal(estimateCalls[0].body.model, "big-model", "the chat's own model sizes it — the best the route allows");
    assert.equal(modelCalls.length, before, "no other model call");
    assert.equal(r.rec.local, true, "answered by Filament");
    assert.ok((r.rec.changes || []).some((c) => /goal: proposed and sized weeks \(one estimate call\)/.test(c)), JSON.stringify(r.rec.changes));
    const tagged = (await (await shim.api("/api/requests?purpose=estimate")).json()).requests;
    assert.equal(tagged.length, 1, "the estimate is memory traffic under its purpose");
    assert.equal(tagged[0].memoryFor.chain, r.rec.memory.chain);
    const g = goalOf();
    assert.equal(g.status, "proposed");
    assert.equal(g.slice, "A working sprite importer for PNG sheets with a golden test.");
    assert.equal(g.estimate.requestId, tagged[0].id, "the estimate knows its own record");
    const again = await say("/goal something else");
    assert.match(again.text, /already has a proposed goal/);
    // (fails before: yes — a refusal carried the goal's card, which the harness draws in the refusal's place; backlog 17)
    assert.ok(!again.rec.card, "a refusal answers in words, with no card to hide them");
    assert.equal(estimateCalls.length, 1, "no second estimate while a goal is open");
    // A plain request now: no goal block yet (not accepted), and nothing booked.
    const plain = await say("carry on");
    assert.ok(!/Goal for this session/.test(JSON.stringify(modelCalls.at(-1).body.system)), "a proposed goal rides nothing");
    void plain;
  });

  test("accept activates the slice: the person's next message says it, the system prompt keeps every byte until the next compaction; status says no spend, and an outside client's goal drives no rounds", async () => {
    const sys0 = modelCalls.at(-1).body.system;
    const acc = await say("/goal accept");
    assert.match(acc.text, /^Goal active: “A working sprite importer/);
    assert.match(acc.text, /said on your next message, at the end of the system prompt from the next compaction on/);
    assert.equal(goalOf().status, "active");
    const twice = await say("/goal accept");
    assert.match(twice.text, /^The goal is already active/);
    assert.ok(!twice.rec.card, "already active: words, no card");
    const r1 = await say("first step please");
    const call1 = modelCalls.at(-1).body;
    // (fails before: yes — the accepted goal went to the end of the system prompt, which the provider had cached)
    assert.deepEqual(call1.system, sys0, "the system prompt keeps every byte it went out with");
    assert.ok(asText(call1.messages.at(-1).content).endsWith(GOAL_BLOCK), `the person's message says the goal: ${JSON.stringify(call1.messages.at(-1).content)}`);
    // The record says what the goal weighs (harness B8): its estimated tokens, no briefing.
    assert.ok(r1.rec.memory.composition.goal > 10, JSON.stringify(r1.rec.memory.composition));
    assert.equal("abilities" in r1.rec.memory.composition, false);
    assert.equal(typeof r1.rec.memory.composition.briefing, "number");
    // The history sent again: the message that said the goal goes out as it did, and the goal is said once.
    await sayAll([{ role: "user", content: "first step please" }, { role: "assistant", content: "MODEL ANSWER" }, { role: "user", content: "and the next" }]);
    const call2 = modelCalls.at(-1).body;
    assert.deepEqual(call2.system, sys0);
    assert.deepEqual(call2.messages[0].content, call1.messages.at(-1).content, "the message that said the goal goes out again byte for byte");
    assert.doesNotMatch(asText(call2.messages[2].content), /Goal for this session/, "said once");
    // A compaction: from there on the system prompt carries the goal, and no message says it again.
    compact(r1.rec.memory.chain);
    const r3 = await say("after the compaction");
    const sys3 = modelCalls.at(-1).body.system;
    assert.match(asText(sys3), /Goal for this session \(set by the developer through Filament; work against this slice, not the wider wish\):\nA working sprite importer for PNG sheets with a golden test\.\nSized weeks\. First step: Read the asset pipeline entry points\.\n<\/filament-memory>\s*$/, "the block closes the system prompt");
    assert.match(asText(sys3), /^You are helping\./, "the client's own prompt stays first");
    assert.doesNotMatch(asText(modelCalls.at(-1).body.messages.at(-1).content), /Goal for this session/);
    const r4 = await say("and the next");
    assert.deepEqual(modelCalls.at(-1).body.system, sys3, "byte-identical system prompt across requests: the block is cache-stable");
    assert.ok(r4.rec.memory.composition.goal > 10, JSON.stringify(r4.rec.memory.composition));
    void r3;
    const g = goalOf();
    assert.deepEqual([g.totals, g.ledger, g.drive], [undefined, undefined, undefined], "no request books to it, and an outside client's goal has no drive");
    const st = await say("/goal status");
    assert.match(st.text, /status: \*\*active\*\*/);
    assert.match(st.text, /estimate \(big-model, [\d-]+ [\d:]+\): \*\*weeks\*\*/);
    assert.doesNotMatch(st.text, /spend|\$\d|requests? (?:into|booked)/, "no money, no requests counted");
    assert.match((await say("/goal go")).text, /^Only a goal of a chat Filament runs is driven/);
    // The session inspector sees the goal, its drive none.
    const truth = await (await shim.api(`/api/sessions/${st.rec.memory.chain}`)).json();
    const slot = truth.inForce?.goal || truth.truth?.inForce?.goal;
    assert.equal(slot.status, "active");
    assert.equal(slot.sizeClass, "weeks");
    assert.deepEqual([slot.drive, "spentUsd" in slot, "requests" in slot], [null, false, false]);
  });

  test("slice and done are said on the person's next message, the system prompt keeping its block until the next compaction; the goal stays on the session; a new goal can then be proposed", async () => {
    const sys0 = modelCalls.at(-1).body.system;
    const sl = await say("/goal slice PNG sheet import only, no atlas packing");
    assert.match(sl.text, /Slice rewritten for the active goal/);
    const go = await say("go");
    const call = modelCalls.at(-1).body;
    // (fails before: yes — the rewritten slice replaced the block at the end of the system prompt)
    assert.deepEqual(call.system, sys0, "a slice rewritten leaves the system prompt as it went out");
    assert.match(asText(call.messages.at(-1).content), /<filament-memory kind="goal">\nThe session's goal changed: the one below stands in place of the goal given earlier\.\nGoal for this session [^\n]*\nPNG sheet import only, no atlas packing\nSized weeks\./);
    const done = await say("/goal done");
    assert.match(done.text, /^Goal done: “PNG sheet import only, no atlas packing”, sized weeks\. The next message says so, the block leaves the system prompt at the next compaction/);
    await say("after the goal");
    const after = modelCalls.at(-1).body;
    assert.deepEqual(after.system, sys0, "a goal closed leaves the system prompt as it went out");
    assert.match(asText(after.messages.at(-1).content), /<filament-memory kind="goal">\nThe session's goal is done \(closed by the developer through Filament\): the goal given earlier, in the system prompt or on an earlier message, no longer stands\.\n<\/filament-memory>$/);
    compact(go.rec.memory.chain);
    await say("after its compaction");
    assert.ok(!/Goal for this session/.test(JSON.stringify(modelCalls.at(-1).body.system)), "the block left at the compaction");
    assert.doesNotMatch(asText(modelCalls.at(-1).body.messages.at(-1).content), /kind=\"goal\"/);
    const g = goalOf();
    assert.equal(g.status, "done");
    for (const [words, said] of /** @type {[string, RegExp][]} */ ([["/goal done", /^The goal is already done/], ["/goal accept", /^The goal is done;/], ["/goal slice atlas too", /its slice cannot change/]])) {
      const w = await say(words);
      assert.match(w.text, said);
      assert.ok(!w.rec.card, `${words} on a closed goal is refused in words, with no card`);
    }
    const st = await say("/goal");
    assert.match(st.text, /status: \*\*done\*\* \(closed/);
    assert.equal(st.rec.card?.kind, "goal", "the status is the goal: it draws as the card");
    // (fails before: yes — every /goal answer carried the session's goal card, which the harness draws in the text's place)
    for (const words of ["/goal help", "/goal slice"]) {
      const w = await say(words);
      assert.ok(!w.rec.card, `${words} answers in words, with no card to hide them`);
    }
    // A new goal after the old one closed: another estimate.
    badEstimate = true;
    const n = await say("/goal Ship the atlas packer");
    badEstimate = false;
    assert.match(n.text, /Goal noted: “Ship the atlas packer”\. The intake estimate could not be made \(the model's reply was not an estimate\)/);
    assert.deepEqual(n.rec.card?.notes, ["The intake estimate could not be made (the model's reply was not an estimate): /goal slice <text> writes the slice, then /goal accept."], "the card says why it has no estimate");
    assert.equal(estimateCalls.length, 2);
    assert.equal(goalOf().status, "proposed");
    const noSlice = await say("/goal accept");
    assert.match(noSlice.text, /^There is no slice to accept/);
    assert.ok(!noSlice.rec.card, "no slice to accept: words, no card");
    // (fails before: yes — a /goal that failed still carried the goal's card, which the harness draws in the failure's place)
    const mem = /** @type {any} */ (shim.app).memory;
    mem.setGoal = () => { throw new Error("the archive is read-only"); };
    try {
      const f = await say("/goal abandon");
      assert.match(f.text, /^\/goal failed: the archive is read-only/);
      assert.ok(!f.rec.card, "a failed command answers in words, with no card to hide them");
    } finally {
      delete mem.setGoal; // the class's own method again
    }
    assert.match((await say("/goal abandon")).text, /^Goal abandoned/);
  });

  test("a chat with no session yet, and a goal on an agent-loop model, fall back honestly", async () => {
    const r = await shim.post("/v1/messages", { model: "big-model", max_tokens: 50, messages: [{ role: "user", content: "/goal accept" }] }, {});
    assert.equal(r.status, 200);
    const j = await r.json();
    // Without a conversation header memory still fingerprints a session, so the command has a chain; what it says is
    // that there is nothing to accept.
    assert.match(text(j.content), /No goal in this session to accept|no session yet/);
  });
});
