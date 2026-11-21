// HarnessV3-Memory M7-5 (M7-D27, M7-D28, M7-D31), end to end: every compaction a window adopts starts one learning
// run through its door, and the run reads every turn it marks learned, oldest first, first-hand. The harness's doors
// (Compact now, the line) on native sessions; a client's (its own summary) on a client's conversation. /autofit's
// door is in autofit.test.js, where its window is sized. One fake provider answers the loop's turns, the compaction
// summaries and the learning model, which files the user's rule on the turn that said it.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { LEARN_PROMPT } from "../src/services/memory/learn.js";
import { COMPACTION_SYSTEM } from "../src/app/sessions/compaction.js";

const RULE = "From now on, always run the linter before committing.";
const COMPACT_ASK = "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests.";
const sysOf = (/** @type {any} */ call) => JSON.stringify(call.body?.system ?? "");
const isLearnCall = (/** @type {any} */ call) => sysOf(call).includes(LEARN_PROMPT.slice(0, 60));
const isSummaryCall = (/** @type {any} */ call) => sysOf(call).includes(COMPACTION_SYSTEM.slice(0, 40));
const textOf = (/** @type {any} */ m) => (typeof m?.content === "string" ? m.content : [].concat(m?.content || []).map((/** @type {any} */ b) => b.text || "").join(""));
/**
 * The first turn a learning call's reading shows the user saying `words`: its number and the user's words, which the
 * fake learning model files as the rule (each session's own, so no session's rule is another's duplicate). Null when
 * no turn says them.
 * @param {string} reading @param {string} words @returns {{ n: number, said: string } | null}
 */
const turnSaying = (reading, words) => {
  for (const part of reading.split("### Turn ").slice(1)) {
    const said = part.split("\n").find((l) => l.startsWith("User: ") && l.includes(words));
    if (said) return { n: Number.parseInt(part, 10), said: said.slice("User: ".length) };
  }
  return null;
};

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** What each learning call was given to read, in order. @type {string[]} */
const learned = [];
before(async () => {
  up = await fakeUpstream((call) => {
    const model = String(call.body?.model || "m-1");
    const say = (/** @type {string} */ text) => anthropicReply(text, { model, usage: { input_tokens: 10, output_tokens: 5 } });
    if (isLearnCall(call)) {
      const reading = textOf(call.body.messages[0]);
      learned.push(reading);
      const rule = turnSaying(reading, "run the linter");
      return say(JSON.stringify({ title: "The linter rule", state: { summary: "the user set a rule for commits" }, turns: [], items: rule ? [{ kind: "rule", text: rule.said, importance: 0.8, turn: rule.n }] : [] }));
    }
    if (isSummaryCall(call)) return say("SUMMARY: the earlier turns, condensed.");
    const last = call.body?.messages?.at(-1);
    const newest = textOf(last);
    // The harness's loop (it offers its tools): each turn reads the session's config, then answers; the long report
    // answers at once.
    if ((call.body?.tools || []).length) {
      if ([].concat(last?.content || []).some((/** @type {any} */ b) => b.type === "tool_result")) return say("Done.");
      if (newest.includes("print the long report")) return say(`The long report. ${"detail ".repeat(17000)}`);
      return anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "tool_use", id: `r${call.n}`, name: "read", input: { path: "config.json" } }], usage: { input_tokens: 10, output_tokens: 5 } });
    }
    if (newest.includes(COMPACT_ASK.slice(0, 40))) return say("Summary: the user set a linter rule, then read three files.");
    // A client's turn (convo below), answered as its model did: so each leg agrees with the turn as archived, and
    // its work joins the turn.
    const ask = /read file(\d+)\.js$/.exec(newest);
    if (ask) return anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "text", text: `Reading file${ask[1]}.js.` }, { type: "tool_use", id: `t${ask[1]}`, name: "read", input: { path: `file${ask[1]}.js` } }], usage: { input_tokens: 10, output_tokens: 5 } });
    const result = [].concat(last?.content || []).find((/** @type {any} */ b) => b.type === "tool_result");
    if (result) return say(`Done with file${String(result.tool_use_id).slice(1)}.js.`);
    return say("Done.");
  });
  shim = await startApp({
    memory: true,
    summarizer: "m-1",
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 }, "big-1": { input: 10, output: 50, contextTokens: 200000 } } }];
      cfg.routes = [
        { match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true },
        { match: "big-1", upstream: "m", upstreamModel: "{model}", enabled: true },
      ];
      cfg.memory.capture = { ...cfg.memory.capture, learn: true };
      cfg.memory.models = { summarizer: "m-1", curator: "off" };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
});
const mem = () => /** @type {any} */ (shim.app.memory);
const json = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
  const r = await shim.api(path, init);
  if (r.status !== 200) assert.fail(`${path}: HTTP ${r.status}: ${await r.text()}`);
  return r.json();
};
/** The ops of a kind, newest first. @param {string} kind */
const ops = async (kind) => (await json(`/api/ops?limit=200&kinds=${kind}`)).ops;
/** A learning run's start op on a session. @param {string} chainId */
const startsOn = async (chainId) => (await ops("learner")).filter((/** @type {any} */ o) => o.sub === "start" && o.detail?.chain === chainId);
/** Runs `fn` under a changed config, put back afterwards. @param {(cfg: any) => void} change @param {() => Promise<void>} fn */
const withConfig = async (change, fn) => {
  const was = (await json("/api/state")).config;
  const cfg = structuredClone(was);
  change(cfg);
  await json("/api/config", { method: "PUT", body: cfg });
  try {
    await fn();
  } finally {
    await json("/api/config", { method: "PUT", body: was });
  }
};
/** The rule the learning model files, as the session's items hold it. @param {string} chainId */
const ruleOf = (chainId) => mem().archive.items.list({ chainId, limit: 100 }).find((/** @type {any} */ i) => i.kind === "rule");
const turnId = (/** @type {string} */ chainId, /** @type {number} */ n) => mem().archive.getTurns(chainId).find((/** @type {any} */ t) => t.n === n)?.id;

describe("the harness's doors", () => {
  const create = async (/** @type {any} */ settings = {}) => String((await json("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1", settings } })).id);
  const turn = async (/** @type {string} */ id, /** @type {string} */ content) => json(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
  const compact = async (/** @type {string} */ id, /** @type {string} */ method) => json(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: { method } });
  /** A session of `n` finished turns, the first saying the rule. @param {number} n @param {any} [settings] */
  const session = async (n, settings = {}) => {
    const id = await create(settings);
    await turn(id, `${RULE} Then add a test for the parser.`);
    for (let i = 2; i <= n; i++) await turn(id, `Step ${i}: rename helper ${i}.`);
    return id;
  };

  test("Compact now learns every turn it compacted, oldest first, by its door: the user's rule is filed on the turn that said it, the cursor ends at the newest turn, and the note, the answer and the op say so (M7-D27, M7-D28)", async () => {
    const id = await session(3);
    const before = learned.length;
    assert.equal(ruleOf(id), undefined, "nothing is learned while the session runs: its turns wait for idle");
    const out = await compact(id, "fold");
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(out.learning, { learning: true, model: "m-1" });
    assert.match(out.note, /; learning from them now on m-1$/, out.note);
    await mem().learner.settled();
    const read = learned.slice(before);
    assert.equal(read.length, 1, "three short turns: one pass");
    assert.match(read[0], /^Project: [^\n]*Session turns 1 to 3:\n\n### Turn 1 /, read[0].slice(0, 200));
    const at = [1, 2, 3].map((n) => read[0].indexOf(`### Turn ${n} `));
    assert.ok(at[0] < at[1] && at[1] < at[2], `oldest first: ${at}`);
    assert.ok(read[0].includes(RULE), "the turn is read first-hand: the user's own words");
    const rule = ruleOf(id);
    assert.deepEqual([rule?.text, rule?.turn_id], [`${RULE} Then add a test for the parser.`, turnId(id, 1)], "the rule, on the turn that said it");
    assert.equal(mem().archive.getChain(id).meta.learnedThrough, 3, "the cursor at the newest turn the run read");
    const op = (await ops("compaction")).find((/** @type {any} */ o) => o.detail?.chainId === id);
    assert.deepEqual([op?.detail?.trigger, op?.detail?.learning], ["manual", "started"]);
    const starts = await startsOn(id);
    assert.deepEqual(starts.map((/** @type {any} */ o) => [o.detail.reason, o.detail.door, o.detail.fromTurn, o.detail.toTurn]), [["compaction", "manual", 1, 3]], "one run, named by its door");
  });

  test("the line learns too: a turn's start that compacts the turn before it starts a run named by the line's door, which reads the turn that is done and leaves the one starting (M7-D27)", async () => {
    // The line at a tenth of the window: turn 1's long report crosses it, so turn 2's start compacts turn 1 — in a
    // session that makes room by itself (one that asks first stops the message instead, HarnessV4_Tasks C26).
    const id = await create({ context: { compaction: { thresholdPercent: 10, mode: "auto" } } });
    await turn(id, `${RULE} Then print the long report.`);
    const before = learned.length;
    await turn(id, "Now fix the parser.");
    await mem().learner.settled();
    const op = (await ops("compaction")).find((/** @type {any} */ o) => o.detail?.chainId === id);
    assert.ok(op, "the line compacted turn 1");
    assert.deepEqual([op.detail.trigger, op.detail.fromTurn, op.detail.toTurn, op.detail.learning], ["line", 1, 1, "started"]);
    const starts = await startsOn(id);
    assert.deepEqual(starts.map((/** @type {any} */ o) => [o.detail.reason, o.detail.door, o.detail.fromTurn, o.detail.toTurn]), [["compaction", "line", 1, 1]], "turn 2 was running: the run leaves it for later");
    const read = learned.slice(before);
    assert.equal(read.length, 1);
    assert.ok(read[0].includes(RULE), "the long turn's start is read, its rule with it");
    assert.match(read[0], /characters of the middle were left out to fit the model/, "and the turn is clipped at both ends, not read whole");
    assert.deepEqual([ruleOf(id)?.turn_id, mem().archive.getChain(id).meta.learnedThrough], [turnId(id, 1), 1]);
  });

  test("learning off, a muted session, or no learning model: the note, the answer and the op say why, and the learning model is never asked (M7-D27)", async () => {
    const cases = [
      { why: "learning from sessions is off in Memory settings", change: (/** @type {any} */ cfg) => (cfg.memory.capture.learn = false), settings: {} },
      { why: "no learning model: memory's model is off (Settings › Memory › Model)", change: (/** @type {any} */ cfg) => (cfg.memory.models.summarizer = "off"), settings: {} },
      { why: "the session opted out of learning (memory.learn or privacy.learn is off)", change: null, settings: { memory: { learn: false } } },
    ];
    for (const c of cases) {
      const id = await session(2, c.settings);
      const before = learned.length;
      const run = async () => {
        const out = await compact(id, "fold");
        assert.equal(out.ok, true, JSON.stringify(out));
        assert.deepEqual(out.learning, { learning: false, why: c.why });
        assert.ok(out.note.endsWith(`; nothing learned from them now: ${c.why}`), out.note);
        await mem().learner.settled();
      };
      if (c.change) await withConfig(c.change, run);
      else await run();
      assert.equal(learned.length, before, `${c.why}: the learning model was never asked`);
      assert.deepEqual(await startsOn(id), [], "no run started");
      const op = (await ops("compaction")).find((/** @type {any} */ o) => o.detail?.chainId === id);
      assert.equal(op?.detail?.learning, c.why, "the op says why");
      assert.equal(mem().archive.getChain(id).meta.learnedThrough, undefined, "the cursor never moved");
    }
  });
});

describe("a client's doors", () => {
  /** `n` turns of a client's conversation, each a question, a read and its answer; turn 1 says the rule. @param {number} n @param {string} tag */
  const convo = (n, tag) => {
    /** @type {any[]} */
    const m = [];
    for (let i = 1; i <= n; i++) {
      m.push({ role: "user", content: `${i === 1 ? `${RULE} ` : ""}Ask ${i} ${tag}: read file${i}.js` });
      m.push({ role: "assistant", content: [{ type: "text", text: `Reading file${i}.js.` }, { type: "tool_use", id: `t${i}`, name: "read", input: { path: `file${i}.js` } }] });
      m.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `contents of file${i}.js ` + "const x = 1;\n".repeat(300) }] });
      m.push({ role: "assistant", content: `Done with file${i}.js.` });
    }
    return m;
  };
  // Each conversation in a project of its own: the same rule said twice in one project is one memory, deduplicated.
  const post = (/** @type {any[]} */ messages, /** @type {string} */ sid) =>
    shim.post("/v1/messages", { model: "big-1", max_tokens: 4096, system: `You are a coding assistant.\nWorking directory: C:\\demo\\${sid}`, messages }, { "x-session-id": sid });
  /** The conversation as a client sends it: every request ends on the person's newest message. */
  const play = async (/** @type {any[]} */ messages, /** @type {string} */ sid) => {
    for (let i = 0; i < messages.length; i++) if (messages[i].role === "user") assert.equal((await post(messages.slice(0, i + 1), sid)).status, 200);
  };
  /** The client compacts: its request, the answer it adopts, and that request's memory trace. */
  const compactNow = async (/** @type {any[]} */ messages, /** @type {string} */ sid) => {
    const r = await post([...messages, { role: "user", content: COMPACT_ASK }], sid);
    assert.equal(r.status, 200);
    const answer = textOf(await r.json());
    const rid = String(r.headers.get("x-filament-request-id"));
    await mem().learner.settled();
    const rec = shim.app.usage.detail(rid);
    return { answer, rec, steps: /** @type {any[]} */ (rec?.memoryTrace?.steps || []) };
  };
  const chainOf = (/** @type {any} */ rec) => String(rec?.memory?.chain || "");
  /** A client's turn that said the rule is filed with it, first-hand, and the run read every turn oldest first. */
  const learnedFirstHand = (/** @type {string} */ chainId, /** @type {string[]} */ read, /** @type {number} */ turns) => {
    assert.equal(read.length, 1, "one pass");
    assert.match(read[0], new RegExp(`Session turns 1 to ${turns}:\\n\\n### Turn 1 `), read[0].slice(0, 200));
    assert.ok(read[0].includes(RULE), "the turns themselves are read, not the summary the client was given");
    assert.ok(read[0].includes("Calls, oldest first"), `with the calls each turn made: ${read[0]}`);
    const rule = ruleOf(chainId);
    assert.deepEqual([rule?.kind, rule?.turn_id], ["rule", turnId(chainId, 1)], "the user's rule, filed as a rule on its turn");
    assert.equal(mem().archive.getChain(chainId).meta.learnedThrough, turns);
  };

  test("a client's own summary is its door: the compaction its own model writes learns once the row is written (M7-D27)", async () => {
    const sid = "cl-own-1";
    const messages = convo(3, "the own lamp");
    await play(messages, sid);
    const before = learned.length;
    const { answer, rec, steps } = await compactNow(messages, sid);
    assert.equal(answer, "Summary: the user set a linter rule, then read three files.", "the client's model wrote it");
    const chainId = chainOf(rec);
    assert.ok(steps.some((s) => s.name === "compaction archived"), "the row is written");
    assert.deepEqual(steps.filter((s) => /^learning/.test(s.name)).map((s) => [s.name, s.session]), [["learning starts now", chainId]]);
    assert.deepEqual((await startsOn(chainId)).map((/** @type {any} */ o) => [o.detail.reason, o.detail.door]), [["compaction", "client"]]);
    learnedFirstHand(chainId, learned.slice(before), 3);
  });
});
