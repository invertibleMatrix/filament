// The slice pass — a compaction summary too big for one call of its writer, read in sequential slices (vault:
// Remediation Plan.md, W6; the owner's rules of 10-31: read whole where it fits one call, its tool calls folded where it
// does not, in slices where even that does not fit — no verbatim tail). Pure logic first (the compaction detector, the
// policy, turns and their rendering, the summary floor), then the pass itself through `summarizeInSlices` (the adaptive
// loop, the rolling digest, failures, the hollow-reply retry, the slice cache), then the archive's content-addressed
// slice cache. Slice sizing is tested through the pass's observable behaviour (what each call carried and how many
// calls it made), not through a test-only export — the same rule W4.5 applied to hands.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isCompactionRequest, turnGroups, summarizeInSlices, renderMessage, renderMessages, estTokens, sliceKey, sliceRoom,
  normalizeTrimPolicy, wordsInPieces, pieceChars, TRIM_DEFAULTS, COMPACTION_PROMPT_RE, DIGEST_PROMPT, trimPrompt, summaryFloor,
} from "../src/services/trim.js";
import { SCHEMAS } from "../src/core/schema.js";
import { Archive } from "../src/services/memory/archive.js";

// A conversation of `turns` turns, each message roughly `chars` long, with a tool leg every `toolEvery` turns.
function convo(turns, { chars = 600, toolEvery = 0, format = "anthropic", tag = "topic" } = {}) {
  const out = [];
  const filler = (i) => `${tag} ${i} ` + "detail ".repeat(Math.max(1, Math.round(chars / 7)));
  for (let i = 0; i < turns; i++) {
    out.push({ role: "user", content: filler(i) });
    if (toolEvery && i % toolEvery === 0) {
      if (format === "anthropic") {
        out.push({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "Read", input: { file_path: `f${i}.js` } }] });
        out.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "contents ".repeat(40) }] });
      } else {
        out.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "Read", arguments: `{"file_path":"f${i}.js"}` } }] });
        out.push({ role: "tool", content: "contents ".repeat(40), tool_call_id: `c${i}` });
      }
    }
    out.push({ role: "assistant", content: `answer ${i}: ` + "resolved ".repeat(Math.max(1, Math.round(chars / 40))) });
  }
  return out;
}
// A fake summarizer whose reply length the test controls, recording every call it received.
const fakeModel = ({ replyChars = 600, failOn = null, log = [] } = {}) => async (a) => {
  log.push(a);
  if (failOn && log.length === failOn) throw new Error("cheap model exploded");
  const isDigest = String(a.system || "").includes("rolling digest");
  return `${isDigest ? "DIGEST" : "SUMMARY"} ${log.length}: ` + "condensed fact ".repeat(Math.max(1, Math.round(replyChars / 15)));
};
const sentTokens = (call) => estTokens(String(call.system || "")) + estTokens(String(call.user || ""));
// The measured failure, made reproducible: a summarizer that answers one word for a whole slice — HTTP 200, non-empty —
// whenever the excerpt it was sent is over `overTokens`, or whenever `when(excerpt)` says so; a real summary otherwise.
// A slice is prefixed by the carried summaries and an EXCERPT marker.
const excerptOf = (call) => { const parts = String(call.user || "").split("EXCERPT (messages"); return parts.length > 1 ? parts[1] : parts[0]; };
const excerptTokens = (call) => estTokens(excerptOf(call));
const hollowModel = ({ overTokens = Infinity, when = null, log = [] } = {}) => async (a) => {
  log.push(a);
  if (String(a.system || "").includes("rolling digest")) return `DIGEST ${log.length}: ` + "condensed fact ".repeat(30);
  const ex = excerptOf(a);
  if (estTokens(ex) > overTokens || (when && when(ex))) return "Nothing.";
  return `SUMMARY ${log.length}: ` + "condensed fact ".repeat(30);
};
// The parts the joined text names, as [from, to] message numbers.
const partsOf = (text) => [...String(text).matchAll(/## Part \d+ — messages (\d+) to (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
// The excerpts the slice calls carried, as [from, to] message numbers.
const excerptsOf = (log) => log.map((a) => /EXCERPT \(messages (\d+) to (\d+) of the conversation\)/.exec(String(a.user))).filter(Boolean).map((m) => [Number(m[1]), Number(m[2])]);

// (fails before: yes — the user's compaction, 2026-10-10: every slice call carried the summary's 1,500 tokens as its
// cap, a reasoning model spent them thinking, and a summary over the cap was cut with "[…summary capped by Filament…]")
test("summarizeInSlices: no call carries a cap of its own, and a summary longer than asked is kept whole", async () => {
  const log = [];
  // Each summary runs to about three times the length asked for.
  const long = async (/** @type {any} */ a) => {
    log.push(a);
    return `SUMMARY ${log.length}: ` + "a decision and its reason. ".repeat(Math.ceil((1500 * 4 * 3) / 27));
  };
  const { text, pass } = await summarizeInSlices({ messages: convo(200, { chars: 900 }), policy: { sliceSummaryTokens: 1500 }, windowTokens: 1_000_000, model: "thinker", callModel: long });
  assert.ok(log.length >= 1, "the summarizer was asked");
  assert.ok(log.every((a) => !("maxTokens" in a)), `no cap was sent: ${JSON.stringify([...new Set(log.map((a) => a.maxTokens))])}`);
  assert.ok(pass.written >= 1, `summaries landed (${pass.written})`);
  assert.ok(!text.includes("capped by Filament"), "nothing was cut");
  assert.ok(text.includes("a decision and its reason. ".repeat(500).trim()), "the summary is in the text whole");
});

// (fails before: yes — an empty digest replaced every carried summary with nothing, and the pass went on without them)
test("summarizeInSlices: a digest that comes back empty keeps the carried summaries", async () => {
  const log = [];
  const emptyDigest = async (/** @type {any} */ a) => {
    log.push(a);
    if (String(a.system || "").includes("rolling digest")) return "";
    return `SUMMARY ${log.length}: ` + "condensed fact ".repeat(107);
  };
  const { text, notes } = await summarizeInSlices({ messages: convo(200, { chars: 900 }), policy: { sliceSummaryTokens: 1200, digestCapFraction: 0.05 }, windowTokens: 8000, model: "cheap-1", callModel: emptyDigest });
  assert.ok(log.some((a) => String(a.system || "").includes("rolling digest")), "a digest was asked for");
  assert.ok(notes.some((n) => /merging the carried summaries failed \(the digest came back empty\)/.test(n)), JSON.stringify(notes));
  assert.match(text, /SUMMARY 1: condensed fact/, "the first summary is still in the text");
});

// (fails before: yes — HarnessV4_Tasks C30 item 1: a client compacted a second time hands the pass the first compaction's
// summary as its first message, and the pass read 24,000 characters of it, the rest "in Filament's archive")
test("summarizeInSlices: the summary an earlier compaction wrote is read whole, in pieces, each piece numbered as a message", async () => {
  const earlier = `Summary of the conversation so far.\n${"an earlier fact and its reason.\n".repeat(1900)}THE LAST EARLIER FACT`;
  const messages = [{ role: "user", content: earlier }, { role: "assistant", content: "Understood." }, ...convo(30, { chars: 900 })];
  const log = [];
  const { text, pass } = await summarizeInSlices({ messages, windowTokens: 8000, model: "cheap-1", callModel: fakeModel({ replyChars: 500, log }) });
  assert.deepEqual([pass.endedBy, pass.failedSlices, pass.mechanical], ["exhausted", 0, 0]);
  const read = log.map((a) => String(a.user)).join("\n");
  assert.ok(read.includes("THE LAST EARLIER FACT"), "the end of the earlier summary reached the summarizer");
  assert.ok(!read.includes("in Filament's archive"), "nothing of it was cut");
  assert.equal(pass.clippedChars, 0, "and no slice clipped a message");
  assert.ok(log.filter((a) => String(a.user).includes("an earlier fact and its reason.")).length >= 2, "it was read across several slices");
  // The pieces are messages of their own: the earlier summary is messages 1 to n, and the numbering runs on from there.
  const P = normalizeTrimPolicy({});
  const pieced = wordsInPieces(messages, pieceChars(P, sliceRoom(8000, P)));
  const n = pieced.length - messages.length + 1;
  assert.ok(n >= 2, `the earlier summary was cut in pieces (${n})`);
  assert.ok(pieced[n - 1].content[0].text.endsWith("THE LAST EARLIER FACT") && pieced[n].content === "Understood.", "its last piece is message n, the reply after it n + 1");
  const ex = excerptsOf(log);
  assert.equal(ex[0][0], 1, JSON.stringify(ex));
  assert.ok(ex.every(([a, b], i) => a <= b && (i === 0 || a === ex[i - 1][1] + 1)), `the excerpts tile the pieced conversation in order: ${JSON.stringify(ex)}`);
  assert.equal(ex.at(-1)[1], pieced.length, "to its last message");
  const parts = partsOf(text);
  assert.ok(parts.length >= 1 && parts.every(([a, b], i) => a <= b && (i === 0 || a === parts[i - 1][1] + 1)), JSON.stringify(parts));
  assert.equal(parts.at(-1)[1], pieced.length, "and the last part ends at the newest message");
});

// (fails before: yes — the review's: a message of words under the cap on one message but heavier than the smallest slice
// went whole into a slice too small for it, and was clipped)
test("summarizeInSlices: a message of words heavier than the smallest slice is read in pieces, not clipped", async () => {
  const words = [{ role: "user", content: "start" }, { role: "assistant", content: "the plan. " + "a step of the plan and why. ".repeat(380) + "THE LAST STEP" }, { role: "user", content: "go" }, { role: "assistant", content: "done" }];
  const log = [];
  const { pass, notes } = await summarizeInSlices({ messages: words, windowTokens: 2000, model: "cheap-1", callModel: fakeModel({ replyChars: 200, log }) });
  assert.ok(words[1].content.length < TRIM_DEFAULTS.tailMessageCapChars, "under the cap on one message");
  assert.equal(pass.clippedChars, 0, JSON.stringify(notes));
  assert.ok(log.some((a) => String(a.user).includes("THE LAST STEP")), "its end was read");
});

test("summarizeInSlices: a single message is summarized in one call over the whole of it", async () => {
  const log = [];
  const { text, pass } = await summarizeInSlices({ messages: [{ role: "user", content: "only one thing was ever said" }], windowTokens: 8000, model: "cheap-1", callModel: fakeModel({ log }) });
  assert.deepEqual([pass.calls, pass.written, log.length], [1, 1, 1], "one call");
  assert.ok(String(log[0].user).includes("only one thing was ever said"), "over the whole of it");
  assert.match(text, /^## Part 1 — messages 1 to 1\nSUMMARY 1: /);
});

test("isCompactionRequest: the client's summarization prompt, in every wire shape, never a tool leg", () => {
  const anth = { messages: [{ role: "user", content: "fix the loop" }, { role: "assistant", content: "ok" }, { role: "user", content: "Your task is to create a detailed summary of the conversation so far." }] };
  assert.equal(isCompactionRequest("anthropic", anth), true);
  assert.equal(isCompactionRequest("openai", { messages: [{ role: "user", content: "Please create a comprehensive summary of our conversation above." }] }), true);
  assert.equal(isCompactionRequest("openai", { messages: [{ role: "user", content: "Summarize this conversation so far" }] }), true);
  assert.equal(isCompactionRequest("anthropic", { messages: [{ role: "user", content: "just a normal question" }] }), false);
  assert.equal(isCompactionRequest("anthropic", { messages: [] }), false);
  assert.equal(isCompactionRequest("anthropic", {}), false);
  assert.equal(isCompactionRequest("anthropic", null), false);
  // A tool result that happens to contain the words is a tool loop, not a person asking to compact.
  assert.equal(isCompactionRequest("anthropic", { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "create a detailed summary of the conversation" }] }] }), false);
  assert.equal(isCompactionRequest("openai", { messages: [{ role: "tool", content: "create a detailed summary of the conversation", tool_call_id: "c" }] }), false);
  // the newest human message decides, not an older one
  assert.equal(isCompactionRequest("anthropic", { messages: [{ role: "user", content: "summarize this conversation so far" }, { role: "assistant", content: "done" }, { role: "user", content: "now refactor it" }] }), false);
  // memory-brain and the handed stage share ONE detector: the signal that archives a compaction is the same one that names it
  assert.ok(COMPACTION_PROMPT_RE.test("summarize this conversation so far"));
  assert.ok(COMPACTION_PROMPT_RE.test("Your task is to create a detailed summary"));
  assert.ok(!COMPACTION_PROMPT_RE.test("summarize this function"));
});


// ---- policy normalization -------------------------------------------------------------------
test("normalizeTrimPolicy: clamps, coerces and refuses a digest cap that would starve the slices", () => {
  const n = normalizeTrimPolicy({});
  assert.ok(!("tailPercent" in n) && !("tailPercent" in TRIM_DEFAULTS), "no tail share: the pass reads the whole conversation");
  assert.ok(!("tailPercent" in normalizeTrimPolicy({ tailPercent: 30 })), "and an old stored one is dropped, not read");
  // A key the pass has no use for is dropped, not read: a stored config may still hold one.
  for (const [k, v] of Object.entries({ enabled: false, intercept: false, command: "/t", sequential: false, learn: false, model: "m" }))
    assert.ok(!(k in normalizeTrimPolicy({ [k]: v })), `${k} is not a knob of the slice pass`);
  assert.equal(normalizeTrimPolicy({}).minSummaryPercent, 0.5, "the summary floor defaults on");
  assert.equal(normalizeTrimPolicy({ minSummaryPercent: 50 }).minSummaryPercent, 20, "clamped: a floor above 20% would refuse every honest summary");
  assert.equal(normalizeTrimPolicy({ minSummaryPercent: 0 }).minSummaryPercent, 0, "0 survives — it means off, not 'use the default'");
  assert.equal(normalizeTrimPolicy({ minSummaryPercent: -1 }).minSummaryPercent, 0);
  assert.equal(normalizeTrimPolicy({ sliceSummaryTokens: "800" }).sliceSummaryTokens, 800, "a string from JSON config is coerced");
  assert.equal(normalizeTrimPolicy({ sliceSummaryTokens: 999999 }).sliceSummaryTokens, 16000);
  assert.equal(normalizeTrimPolicy({ sliceBudgetFraction: 5 }).sliceBudgetFraction, 0.95);
  // The trap: a digest cap at or above the whole slice budget means no slice can ever fit.
  const bad = normalizeTrimPolicy({ sliceBudgetFraction: 0.7, digestCapFraction: 0.9 });
  assert.ok(bad.digestCapFraction < bad.sliceBudgetFraction, `digest cap ${bad.digestCapFraction} must stay under the slice budget ${bad.sliceBudgetFraction}`);
  // a per-session override wins over the global default
  assert.equal(normalizeTrimPolicy({}, { sliceSummaryTokens: 777 }).sliceSummaryTokens, 777, "the caller's defaults are the global config");
  assert.equal(normalizeTrimPolicy({ sliceSummaryTokens: 1200 }, { sliceSummaryTokens: 777 }).sliceSummaryTokens, 1200);
  assert.deepEqual(normalizeTrimPolicy(null), n, "no policy at all is the defaults");
});

test("turnGroups: whole turns tile the conversation, a prologue is its own group", () => {
  const messages = convo(6, { toolEvery: 2 });
  const groups = turnGroups(messages, "anthropic");
  assert.equal(groups.reduce((n, g) => n + (g.to - g.from), 0), messages.length, "the groups tile it exactly");
  for (const g of groups) assert.ok(g.to > g.from, "no empty group");
  assert.equal(groups[0].from, 0);
  assert.equal(groups.at(-1).to, messages.length);
  // a conversation that starts with an assistant message: the prologue is not lost
  const pro = [{ role: "assistant", content: "greeting" }, ...convo(3)];
  const pg = turnGroups(pro, "anthropic");
  assert.equal(pg[0].to, 1, "the leading assistant message is its own group");
  assert.equal(pg.reduce((n, g) => n + (g.to - g.from), 0), pro.length);
  // a tool leg is not a turn start, so a tool loop stays inside one group
  const tooly = [{ role: "user", content: "go" }, { role: "assistant", content: [{ type: "tool_use", id: "a", name: "R", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "r" }] }, { role: "assistant", content: "done" }];
  assert.equal(turnGroups(tooly, "anthropic").length, 1, "one turn, four messages");
  assert.deepEqual(turnGroups([], "anthropic"), []);
  assert.deepEqual(turnGroups(null, "anthropic"), []);
  // openai's role:"tool" legs behave the same way
  const oTooly = [{ role: "user", content: "go" }, { role: "assistant", content: "", tool_calls: [{ id: "c", type: "function", function: { name: "f", arguments: "{}" } }] }, { role: "tool", content: "out", tool_call_id: "c" }, { role: "assistant", content: "done" }];
  assert.equal(turnGroups(oTooly, "openai").length, 1);
});

test("renderMessage: every wire shape, tool calls named, thinking and images contribute nothing", () => {
  assert.equal(renderMessage({ role: "user", content: "hello" }), "[user]: hello");
  assert.match(renderMessage({ role: "assistant", content: [{ type: "text", text: "hi" }, { type: "tool_use", name: "Read", input: { file_path: "a.js" } }] }), /Read\(\{"file_path":"a\.js"\}\)/);
  assert.match(renderMessage({ role: "assistant", content: "", tool_calls: [{ id: "c", type: "function", function: { name: "Bash", arguments: "{}" } }] }), /Bash/);
  assert.match(renderMessage({ role: "tool", content: "output text", tool_call_id: "c" }), /^\[tool\]: output text/);
  assert.match(renderMessage({ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "the result" }] }), /the result/);
  // thinking is reasoning, not conversation: it must not be summarized into the client's new context
  const th = renderMessage({ role: "assistant", content: [{ type: "thinking", thinking: "secret reasoning" }, { type: "text", text: "visible" }] });
  assert.match(th, /visible/);
  assert.ok(!th.includes("secret reasoning"), "thinking text is dropped");
  const img = renderMessage({ role: "user", content: [{ type: "image", source: { data: "AAAA".repeat(5000) } }] });
  assert.ok(img.length < 200, `base64 never inflates a slice (${img.length} chars)`);
  assert.match(img, /\[image\]/);
  assert.equal(renderMessage({ role: "assistant", content: "" }), "[assistant]: (no text)", "an empty message still holds its place");
  assert.match(renderMessage({ role: "user", content: "z".repeat(5000) }, { cap: 100 }), /4900 more characters/, "the per-message cap reports what it clipped");
  assert.equal(renderMessages([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]).length, 2);
  assert.deepEqual(renderMessages(null), []);
  // a long tool argument is clipped: the decision to call `edit` on a file is context, the 4 KB patch body is not
  const bigArgs = renderMessage({ role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "a.js", old_string: "q".repeat(9000) } }] });
  assert.ok(bigArgs.length < 1200, `tool arguments clipped (${bigArgs.length})`);
  assert.match(bigArgs, /Edit\(/);
});

// ---- the pass -------------------------------------------------------------------------------
test("summarizeInSlices: slices are sized from what the model actually returned, and every call fits the window", async () => {
  const log = [];
  const messages = convo(30, { chars: 900 });
  const windowTokens = 8000;
  const { text, pass } = await summarizeInSlices({ messages, policy: { sliceSummaryTokens: 800 }, windowTokens, model: "cheap-1", callModel: fakeModel({ replyChars: 500, log }) });
  assert.deepEqual([pass.endedBy, pass.failedSlices, pass.mechanical], ["exhausted", 0, 0]);
  assert.ok(pass.written >= 2, `a sequential pass took several slices (${pass.written})`);
  assert.equal(pass.calls, pass.written + pass.recompactions, "every call is accounted for");
  assert.equal(log.length, pass.calls);
  // THE contract: no request the cheap model received may exceed its own slice budget
  const budget = Math.floor(TRIM_DEFAULTS.sliceBudgetFraction * windowTokens);
  for (const [i, call] of log.entries()) {
    assert.ok(sentTokens(call) <= budget, `call ${i + 1} sent ~${sentTokens(call)} tokens, over the ${budget}-token slice budget`);
    assert.ok(!("maxTokens" in call), "no cap: memory's door asks for all the model can write in what the window leaves");
  }
  // the carried prefix grows: proof the summaries really are fed forward, oldest first
  const prefixSizes = log.map((c) => (String(c.user).match(/SUMMARIES ALREADY WRITTEN[\s\S]*?\n\n---/) || [""])[0].length);
  assert.ok(prefixSizes.at(-1) > prefixSizes[0], `carried prefix grew from ${prefixSizes[0]} to ${prefixSizes.at(-1)} chars`);
  // the text: the summaries alone, oldest first — the whole conversation condensed, none of it kept verbatim (fails
  // before: yes — the owner's rules of 10-31: the newest 30% stood verbatim at its end)
  assert.match(text, /^## (Earlier, condensed|Part 1 — messages 1 to \d+)\n/, text.slice(0, 200));
  assert.doesNotMatch(text, /verbatim/, "no tail is kept verbatim");
  assert.ok(!text.includes("topic 0 ") && !text.includes("answer 29"), "neither the oldest turn nor the newest is in it as it was: both were summarized");
  assert.equal(partsOf(text).at(-1)[1], messages.length, "the last part ends at the newest message");
  assert.doesNotMatch(text, /## Not represented/, "and nothing is missing");
  const total = renderMessages(messages).reduce((n, r) => n + estTokens(r), 0);
  assert.ok(estTokens(text) < total, `the summary is smaller than the conversation (${estTokens(text)} < ${total})`);
});

test("summarizeInSlices: the rolling digest kicks in when the carried summaries pass the cap", async () => {
  const log = [];
  // Sized so the pass needs many slices and each summary is big enough that the carried total passes the cap.
  const messages = convo(200, { chars: 900 });
  const { text, pass, notes } = await summarizeInSlices({ messages, policy: { sliceSummaryTokens: 1200, digestCapFraction: 0.05 }, windowTokens: 8000, model: "cheap-1", callModel: fakeModel({ replyChars: 1600, log }) });
  assert.ok(pass.written >= 3, `the pass produced enough summaries to accumulate a carried prefix (${pass.written})`);
  assert.ok(pass.recompactions >= 1, `the carried summaries were re-compressed (${pass.recompactions}x)`);
  assert.match(text, /^## Earlier, condensed\nDIGEST \d+: /, "the digest is its own section of the text, ahead of the parts");
  assert.ok(pass.digestTokens > 0, "and its size is measured");
  // the digest calls used the digest prompt, were given only summaries, and fit the window too
  const digestCalls = log.filter((c) => String(c.system || "").includes("rolling digest"));
  assert.equal(digestCalls.length, pass.recompactions);
  assert.ok(digestCalls.every((c) => c.system === DIGEST_PROMPT), "the digest prompt is a fixed string, so it caches");
  const room = sliceRoom(8000, { sliceSummaryTokens: 1200 });
  for (const c of digestCalls) assert.ok(sentTokens(c) <= room.frac, `a re-compression call fits the window too (${sentTokens(c)} <= ${room.frac})`);
  // after a re-compression the carried prefix is short again: that is the whole point of the cap
  assert.ok(notes.some((n) => /rolling digest/.test(n)), JSON.stringify(notes));
  assert.ok(pass.slices.length >= 1, "the pass continued after re-compressing");
});

test("summarizeInSlices: a failed slice is reported honestly and the text admits the gap", async () => {
  const log = [];
  const messages = convo(120, { chars: 900 });
  const { text, pass, notes } = await summarizeInSlices({ messages, windowTokens: 8000, model: "cheap-1", callModel: fakeModel({ replyChars: 400, failOn: 2, log }) });
  assert.ok(pass.written >= 2, `the pass took several slices (${pass.written})`);
  assert.equal(pass.failedSlices, 1, "the failure is counted");
  assert.ok(pass.mechanical >= 1, "and so is the turn group it left out");
  assert.ok(notes.some((n) => /summarizing slice 2 failed \(cheap model exploded\); that slice is not represented in the summary/.test(n)), `and explained: ${JSON.stringify(notes)}`);
  assert.match(text, /## Not represented\n\d+ turn group\(s\) could not be summarized/, "the text has a section for what it could not summarize, and says so in words");
  // when EVERY call fails the pass stops rather than returning a text that claims to cover the conversation
  const allFail = await summarizeInSlices({ messages: convo(200, { chars: 900 }), windowTokens: 8000, model: "cheap-1", callModel: async () => { throw new Error("provider down"); } });
  assert.ok(allFail.notes.some((n) => /every one of the first \d+ slice calls failed; the pass stopped rather than producing an empty summary/.test(n)), JSON.stringify(allFail.notes));
  assert.deepEqual([allFail.pass.slices.length, allFail.pass.written], [0, 0]);
  assert.equal(allFail.text, "", "and no text was returned");
  assert.ok(allFail.pass.calls <= 4, `it stopped early instead of burning the whole cap (${allFail.pass.calls} calls)`);
  // W8 D7: slices are numbered by ATTEMPT, not by how many summaries landed. The old code used `slices.length + 1`, so
  // a pass where nothing landed said "slice 1 failed" three times while it was actually well into the conversation —
  // which reads as a stuck retry loop and hides the fact that it was making progress.
  const failedNotes = allFail.notes.filter((n) => /summarizing slice \d+ failed/.test(n));
  assert.ok(failedNotes.length >= 2, `several slices failed (${failedNotes.length})`);
  const nums = failedNotes.map((n) => Number(/summarizing slice (\d+) failed/.exec(n)[1]));
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b), `the numbers ascend: ${nums}`);
  assert.equal(new Set(nums).size, nums.length, `and each attempt is numbered once, not all called "slice 1": ${nums}`);
  // W8 D8: the pass says what STOPPED it, and counts failures separately from unrepresented turn groups.
  assert.equal(allFail.pass.endedBy, "all-failed", "the terminator is recorded, not inferred from the first note");
  assert.equal(allFail.pass.failedSlices, allFail.pass.calls, "failedSlices counts the calls that failed");
  assert.ok(allFail.pass.mechanical >= allFail.pass.failedSlices, "mechanical is turn groups, a different unit — it must not be read as the failure count");
});

test("summarizeInSlices: maxSliceTokens caps one slice no matter how large the summarizer's window is (W8 D6)", async () => {
  // The budget is 0.7 x the model's window, so a model whose window Filament KNOWS gets bigger slices. A 256k window
  // produced a single 171,614-token call that the provider's edge killed at ~126 s with a Cloudflare 524, while an
  // unknown window fell back to 128k and produced ~78k slices that all succeeded. Knowing the window must not make it
  // worse — so the ceiling is a differential: same conversation, same window, cap on versus cap off.
  const messages = convo(200, { chars: 900 });
  const cappedLog = [], freeLog = [];
  const capped = await summarizeInSlices({ messages, policy: { maxSliceTokens: 2000 }, windowTokens: 400000, model: "cheap-1", callModel: fakeModel({ replyChars: 300, log: cappedLog }) });
  const free = await summarizeInSlices({ messages, policy: { maxSliceTokens: 0 }, windowTokens: 400000, model: "cheap-1", callModel: fakeModel({ replyChars: 300, log: freeLog }) });
  assert.ok(freeLog.length >= 1, `without a ceiling the huge window needs few calls (${freeLog.length})`);
  assert.ok(cappedLog.length > freeLog.length, `the ceiling splits the same conversation into more, smaller slices (${cappedLog.length} vs ${freeLog.length})`);
  const biggestFree = Math.max(...freeLog.map((c) => c.user.length));
  const biggestCapped = Math.max(...cappedLog.map((c) => c.user.length));
  assert.ok(biggestCapped < biggestFree, `and the biggest single call really is smaller (${biggestCapped} vs ${biggestFree} chars)`);
  // Matched on the knob name, not on "2,000": the note formats the number with toLocaleString(), so a hard-coded
  // comma would fail on any machine whose locale groups digits differently.
  assert.ok(capped.notes.some((n) => /rules\.trim\.maxSliceTokens/.test(n) && /capped at/.test(n)), `the pass explains its own shape: ${JSON.stringify(capped.notes.slice(0, 4))}`);
  assert.ok(!free.notes.some((n) => /capped at/.test(n)), "and says nothing when the ceiling is off");
});

// (fails before: yes — the pass stopped at 40 slices, rules.trim.maxSlices, and left the rest out of the summary)
test("summarizeInSlices: a pass summarizes all it was asked to: no slice cap", async () => {
  // Slices of one exchange each, so the pass needs far more than the old cap's 40.
  const messages = convo(200, { chars: 900 });
  const { text, pass, notes } = await summarizeInSlices({ messages, policy: { maxSliceTokens: 600 }, windowTokens: 8000, model: "cheap-1", callModel: fakeModel({ replyChars: 300 }) });
  assert.ok(pass.written > 40, `more summaries than the old cap (${pass.written})`);
  assert.equal(pass.mechanical, 0, `nothing was left out: ${JSON.stringify(notes)}`);
  assert.equal(pass.endedBy, "exhausted");
  assert.doesNotMatch(text, /## Not represented/);
});

test("summarizeInSlices: an aborted pass stops cleanly where it is; one aborted before it starts makes no call", async () => {
  // an aborted pass stops where it is and still returns what it finished, never a hang
  const ctrl = new AbortController();
  let n = 0;
  const aborted = await summarizeInSlices({
    messages: convo(40, { chars: 900 }), windowTokens: 6000, model: "cheap-1", signal: ctrl.signal,
    callModel: async (a) => { n++; if (n >= 2) ctrl.abort(); return fakeModel({ replyChars: 300 })(a); },
  });
  assert.equal(aborted.pass.endedBy, "disconnected");
  assert.ok(aborted.notes.some((x) => /the compaction was stopped; \d+ turn group\(s\) were left un-summarized/.test(x)), JSON.stringify(aborted.notes));
  assert.ok(aborted.text.length > 0 && aborted.pass.written >= 1, "what was finished is still returned");
  assert.match(aborted.text, /## Not represented\n\d+ turn group\(s\) could not be summarized/, "and it does not pretend to cover everything");
  assert.ok(n <= 4, `the loop really stopped (${n} calls)`);
  // a pre-aborted signal does no work at all
  const pre = new AbortController(); pre.abort();
  const none = await summarizeInSlices({ messages: convo(10), windowTokens: 8000, model: "cheap-1", signal: pre.signal, callModel: fakeModel({}) });
  assert.deepEqual([none.pass.calls, none.pass.endedBy, none.text], [0, "disconnected", ""], "an already-aborted pass makes no calls");
  // degenerate input
  const empty = await summarizeInSlices({ messages: [], windowTokens: 8000, model: "c", callModel: fakeModel({}) });
  assert.deepEqual([empty.text, empty.pass.calls, empty.pass.written], ["", 0, 0]);
});

test("summarizeInSlices: the slice cache means a second pass over the same content pays nothing", async () => {
  const messages = convo(150, { chars: 900 });
  const store = new Map();
  // trim.js's contract: get(key) -> string|null, put(key, { text, tokens, chars, model })
  const cache = { get: (h) => store.get(h)?.text || null, put: (h, v) => store.set(h, v) };
  const log1 = [];
  const a = await summarizeInSlices({ messages, windowTokens: 8000, model: "cheap-1", cache, callModel: fakeModel({ replyChars: 400, log: log1 }) });
  assert.ok(a.pass.written >= 2, `the first pass took several slices (${a.pass.written})`);
  assert.equal(a.pass.cached, 0, "and paid for all of them");
  assert.equal(store.size, a.pass.written, "every summary went into the cache");
  for (const v of store.values()) {
    assert.equal(typeof v.text, "string");
    assert.ok(v.text.length > 0, "no empty summaries cached");
    assert.equal(v.model, "cheap-1", "the model that wrote it is recorded");
    assert.ok(Number.isFinite(v.tokens) && v.tokens > 0);
  }
  const log2 = [];
  const b = await summarizeInSlices({ messages, windowTokens: 8000, model: "cheap-1", cache, callModel: fakeModel({ replyChars: 400, log: log2 }) });
  assert.equal(b.pass.cached, a.pass.written, "the second pass reused all of them");
  const sliceCalls2 = log2.filter((c) => !String(c.system || "").includes("rolling digest"));
  assert.equal(sliceCalls2.length, 0, "no slice call was made (only digest re-compressions, which are not cached)");
  assert.equal(b.text, a.text, "and the text is byte-identical, so the client's context is reproducible");
  assert.equal(b.pass.calls, b.pass.recompactions);
  // a broken cache must not break the pass
  const broken = { get: () => { throw new Error("db locked"); }, put: () => { throw new Error("db locked"); } };
  const c = await summarizeInSlices({ messages, windowTokens: 8000, model: "cheap-1", cache: broken, callModel: fakeModel({ replyChars: 300 }) });
  assert.ok(c.pass.written >= 1, "a cache failure degrades to paying again, not to an error");
});

test("summaryFloor: a share of the slice, capped by a quarter of the reply cap, off at 0", () => {
  // The measured case: an 88,925-token slice under a 1,500-token reply cap at 0.5% → 375 tokens. The 255-character
  // reply the pass accepted is a fifth of that.
  assert.equal(summaryFloor(88925, 1500, 0.5), 375, "the quarter-of-the-cap ceiling, not the raw 445");
  assert.ok(estTokens("x".repeat(255)) < summaryFloor(88925, 1500, 0.5), "the real reply is hollow by this measure");
  assert.equal(summaryFloor(88925, 7000, 0.5), 445, "with a larger cap the share itself is the floor");
  assert.equal(summaryFloor(21671, 1500, 0.5), 109, "the sound sibling slice (2,028 tokens out) sits far above its floor");
  assert.equal(summaryFloor(1000, 1500, 0.5), 5, "a small slice gets a floor a short true summary clears");
  assert.equal(summaryFloor(88925, 200, 0.5), 50, "a tiny reply cap is never asked for more than a quarter of itself");
  assert.equal(summaryFloor(88925, 1500, 0), 0, "0 switches the check off");
  assert.equal(summaryFloor(88925, 1500, -3), 0);
});

test("rules.trim: the schema, TRIM_DEFAULTS and normalizeTrimPolicy agree on every knob (none is silently dropped)", () => {
  // maxSliceTokens once existed in TRIM_DEFAULTS and the schema but not in normalizeTrimPolicy's whitelist, so the
  // dashboard showed a control that changed nothing. This pins all three surfaces to each other.
  const node = SCHEMAS.CONFIG.rules.trim;
  const leaves = Object.entries(node).filter(([k, v]) => k !== "_doc" && v && typeof v === "object" && "default" in v);
  assert.equal(leaves.length, Object.keys(TRIM_DEFAULTS).length, `the trim group has a control for each knob (${leaves.map(([k]) => k).join(", ")})`);
  for (const [k, leaf] of leaves) {
    assert.ok(k in TRIM_DEFAULTS, `${k} is on the dashboard but not in TRIM_DEFAULTS`);
    assert.deepEqual(TRIM_DEFAULTS[k], leaf.default, `${k}: the dashboard's default and the module's default differ`);
  }
  for (const k of Object.keys(TRIM_DEFAULTS)) assert.ok(k in node, `${k} is in TRIM_DEFAULTS but the dashboard has no control for it`);
  // Every knob must survive normalization with a NON-default value, or the control on the dashboard is a lie.
  const base = normalizeTrimPolicy({});
  const other = { sliceBudgetFraction: 0.8, digestCapFraction: 0.25, sliceSummaryTokens: 1501, minSummaryPercent: 1, maxSliceTokens: 100001, tailMessageCapChars: 24001 };
  // (fails before: yes — the owner's rules of 10-31 left rules.trim the slice pass's settings; fallbackWindowTokens never
  // took effect, as its one path states the writer's window, its own assumed one where nobody states it)
  assert.deepEqual(Object.keys(TRIM_DEFAULTS).sort(), ["digestCapFraction", "maxSliceTokens", "minSummaryPercent", "sliceBudgetFraction", "sliceSummaryTokens", "tailMessageCapChars"]);
  for (const k of Object.keys(TRIM_DEFAULTS)) {
    assert.ok(k in other, `this test has no non-default value for ${k} — add one`);
    assert.notDeepEqual(normalizeTrimPolicy({ [k]: other[k] })[k], base[k], `${k} is dropped by normalizeTrimPolicy`);
  }
});

test("summarizeInSlices: a hollow reply is retried on a smaller slice, the rest of the pass stays at that size, and the hollow text reaches neither the summary nor the cache", async () => {
  const log = []; const store = new Map();
  const cache = { get: (h) => store.get(h)?.text || null, put: (h, v) => store.set(h, v) };
  const { text, pass, notes } = await summarizeInSlices({ messages: convo(60, { chars: 900 }), windowTokens: 8000, model: "cheap-1", cache, callModel: hollowModel({ overTokens: 2500, log }) });
  assert.deepEqual([pass.endedBy, pass.failedSlices, pass.mechanical], ["exhausted", 0, 0], "the pass read it all");
  assert.equal(pass.hollowRetries, 1, "the first slice was hollow and retried once");
  assert.equal(pass.hollowSlices, 0, "every summary in the text is a real one");
  const sizes = log.filter((c) => !String(c.system).includes("rolling digest")).map(excerptTokens);
  assert.ok(sizes[0] > 2500, `the first slice was over what the model could condense (${sizes[0]})`);
  assert.ok(sizes.slice(1).every((t) => t <= Math.ceil(sizes[0] / 2) + 60), `every later slice stayed at the halved size: ${sizes.join(", ")}`);
  assert.ok(!text.includes("Nothing."), "the hollow text is not in the summary");
  assert.ok(![...store.values()].some((v) => /Nothing\./.test(v.text)), "and it was not cached");
  assert.equal(pass.calls, pass.written + pass.hollowRetries + pass.recompactions, "every call is accounted for: summaries, retries, digests");
  assert.ok(notes.some((n) => /under the 0\.5% floor; retrying on a slice of ~/.test(n)), JSON.stringify(notes));
  assert.match(text, /## Part 1 — messages 1 to \d+\nSUMMARY \d+: /, "the part starts at the first message");
  assert.ok(!/unusually short/.test(text), "nothing is marked hollow");
});

test("summarizeInSlices: where every summary is hollow, the retries are bounded, each is kept and marked, none is cached; at floor 0 they pass unmarked", async () => {
  const log = []; const store = new Map();
  const cache = { get: (h) => store.get(h)?.text || null, put: (h, v) => store.set(h, v) };
  const { text, pass, notes } = await summarizeInSlices({ messages: convo(40, { chars: 900 }), windowTokens: 8000, model: "cheap-1", cache, callModel: hollowModel({ overTokens: 0, log }) });
  assert.ok(pass.hollowRetries >= 1 && pass.hollowRetries <= 3, `retries are bounded, so a hollow model cannot run up the bill (${pass.hollowRetries})`);
  assert.ok(pass.hollowSlices >= 1 && pass.hollowSlices === pass.written, `every summary that landed was hollow (${pass.hollowSlices} of ${pass.written})`);
  const marked = text.match(/\(unusually short for its size — treat this part as incomplete; the originals are in Filament's archive\)/g) || [];
  assert.equal(marked.length, partsOf(text).length, "and every part says so in its heading");
  assert.equal(store.size, 0, "nothing hollow was cached, so a summary by a better model starts clean");
  assert.ok(notes.some((n) => /could not be split further/.test(n)), JSON.stringify(notes));
  // The floor is a knob: at 0 the stubs are accepted without a mark.
  const off = await summarizeInSlices({ messages: convo(20, { chars: 900 }), policy: { minSummaryPercent: 0 }, windowTokens: 8000, model: "cheap-1", callModel: hollowModel({ overTokens: 0 }) });
  assert.ok(off.pass.written >= 1, "floor off: the stubs are accepted");
  assert.deepEqual([off.pass.hollowSlices, off.pass.hollowRetries], [0, 0]);
  assert.ok(!/unusually short/.test(off.text));
});

test("summarizeInSlices: one slice the model cannot condense is kept and MARKED when the others are sound", async () => {
  const log = []; const store = new Map();
  const cache = { get: (h) => store.get(h)?.text || null, put: (h, v) => store.set(h, v) };
  // Hollow whenever the excerpt holds the very first turn: every retry of the first slice still starts there, so it
  // ends unsplittable and flagged, while everything after it is summarized normally.
  const { text, pass, notes } = await summarizeInSlices({ messages: convo(60, { chars: 900 }), windowTokens: 8000, model: "cheap-1", cache, callModel: hollowModel({ when: (ex) => ex.includes("topic 0 "), log }) });
  assert.ok(pass.written > 1 && pass.endedBy === "exhausted", "the pass went on: most of it is sound");
  assert.equal(pass.hollowSlices, 1);
  assert.ok(pass.hollowRetries >= 1, "it was retried smaller first");
  assert.match(text, /## Part 1 — messages 1 to \d+ \(unusually short for its size — treat this part as incomplete; the originals are in Filament's archive\)\nNothing\./, "the part's heading says so, where the next reader looks first");
  assert.equal((text.match(/unusually short/g) || []).length, 1, "and only that part is marked");
  assert.ok(![...store.values()].some((v) => /Nothing\./.test(v.text)), "but it was not cached");
  assert.ok(store.size >= 1, "the sound summaries were");
  assert.ok(notes.some((n) => /kept and marked in the summary/.test(n)), JSON.stringify(notes));
});

test("summarizeInSlices: a cached summary under the floor is not reused — the 51-token one sits in the archive under its hash", async () => {
  const log = []; let served = 0;
  const cache = { get: () => (served++ === 0 ? "Nothing." : null), put: () => {} };
  const { text, pass, notes } = await summarizeInSlices({ messages: convo(30, { chars: 900 }), windowTokens: 8000, model: "cheap-1", cache, callModel: fakeModel({ replyChars: 500, log }) });
  assert.equal(pass.endedBy, "exhausted");
  assert.equal(pass.cached, 0, "the hollow cache hit did not count as reuse");
  assert.ok(notes.some((n) => /a cached summary of slice 1 was unusually short .* and was not reused/.test(n)), JSON.stringify(notes));
  assert.ok(!text.includes("Nothing."), "the model was asked instead, and its summary is what the text carries");
  assert.equal(pass.hollowSlices, 0); assert.equal(pass.hollowRetries, 0, "a sound reply needed no retry");
});

test("summarizeInSlices: an EMPTY summary is a failed slice, not a free one (and the note itself must not throw)", async () => {
  // Regression: this branch once referenced an undefined `attempt`, whose ReferenceError was swallowed by the same
  // catch, double-counting the call and reporting "slice 1 failed (attempt is not defined)".
  const log = [];
  const { text, pass, notes } = await summarizeInSlices({ messages: convo(120, { chars: 900 }), windowTokens: 8000, model: "cheap-1", callModel: async (a) => { log.push(a); return log.length === 2 ? "   " : fakeModel({ replyChars: 300 })(a); } });
  assert.ok(notes.some((n) => /slice 2 came back empty and is not represented/.test(n)), `the empty reply is reported: ${JSON.stringify(notes)}`);
  assert.ok(!notes.some((n) => /is not defined/.test(n)), "no swallowed ReferenceError leaked into the notes");
  assert.equal(pass.calls, log.length, `every call is counted exactly once (${pass.calls} vs ${log.length} made)`);
  assert.equal(pass.failedSlices, 1, "it is a failed slice");
  assert.ok(pass.mechanical >= 1, "and the missing slice is counted as not represented");
  assert.match(text, /## Not represented\n\d+ turn group\(s\) could not be summarized/);
});

// (HarnessV4_Tasks C30 item 1: a message of words is read whole, in pieces)
test("summarizeInSlices: a message that cannot be cut in pieces and is bigger than a slice is clipped, counted and said; words that long are read whole", async () => {
  const huge = "x".repeat(400000); // ~100k tokens in a single message
  /** @param {string} id */
  const leg = (id) => [{ role: "assistant", content: [{ type: "tool_use", id, name: "Read", input: { file_path: `${id}.log` } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: huge }] }];
  // A tool result is capped where it is rendered, and what is left is still bigger than a slice: its end is left out.
  const tools = [{ role: "user", content: "start" }, ...leg("t1"), { role: "assistant", content: "read it" }, { role: "user", content: "and then?" }, ...leg("t2"), { role: "assistant", content: "read that too" }, { role: "user", content: "finally" }, { role: "assistant", content: "done" }];
  const read = [];
  const out = await summarizeInSlices({ messages: tools, policy: { tailMessageCapChars: 40000 }, windowTokens: 8000, model: "cheap-1", callModel: fakeModel({ replyChars: 200, log: read }) });
  assert.equal(out.pass.endedBy, "exhausted");
  assert.ok(out.pass.clippedChars > 0, `the dropped content is measured: clipped=${out.pass.clippedChars}`);
  assert.ok(out.notes.some((n) => /one message was larger than the whole slice budget: the end of it was left out of the summary/.test(n)), JSON.stringify(out.notes));
  assert.match(out.text, /## Not represented\n~[\d,.\s]+ tokens were clipped to fit the summarizer's window\./, "and the text admits it");
  const room = sliceRoom(8000, { tailMessageCapChars: 40000 });
  for (const a of read) assert.ok(sentTokens(a) <= room.frac, `every call fits the window (${sentTokens(a)} <= ${room.frac})`);
  assert.ok(!read.some((a) => String(a.user).includes("x".repeat(40000))), "no result was read whole");
  for (const w of ["start", "read it", "and then?", "read that too", "finally", "done"]) assert.ok(read.some((a) => excerptOf(a).includes(w)), `the words were: ${w}`);
  // Words beside an image cannot be cut in pieces either: the end of that message is left out, and the hole is counted.
  const pic = [{ role: "user", content: "start" }, { role: "assistant", content: "ok" }, { role: "user", content: [{ type: "text", text: huge }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }, { role: "assistant", content: "seen" }];
  const clipped = await summarizeInSlices({ messages: pic, policy: { tailMessageCapChars: 40000 }, windowTokens: 8000, model: "cheap-1", callModel: fakeModel({ replyChars: 200 }) });
  assert.ok(clipped.pass.clippedChars > 0, `the dropped content is measured: clipped=${clipped.pass.clippedChars}`);
  assert.ok(clipped.notes.some((n) => /one message was larger than the whole slice budget/.test(n)), JSON.stringify(clipped.notes));
  assert.match(clipped.text, /## Not represented\n.*tokens were clipped to fit the summarizer's window/, "and the text admits it");
  // Words that long are the conversation: read in pieces, every one, nothing clipped.
  const words = [{ role: "user", content: "start" }, { role: "assistant", content: huge }, { role: "user", content: "and then?" }, { role: "assistant", content: huge }, { role: "user", content: "finally" }, { role: "assistant", content: "done" }];
  const log = [];
  const whole = await summarizeInSlices({ messages: words, windowTokens: 8000, model: "cheap-1", callModel: fakeModel({ replyChars: 200, log }) });
  assert.equal(whole.pass.clippedChars, 0);
  assert.ok(!whole.notes.some((n) => /larger than the whole slice budget/.test(n)), JSON.stringify(whole.notes));
  assert.ok(log.map((a) => excerptOf(a)).join("").split("x").length - 1 >= huge.length, "every character of the long message was read");
});

test("sliceKey: content-addressed, and sensitive to what would change the answer", () => {
  assert.equal(sliceKey("abc", 1125), sliceKey("abc", 1125), "identical content, identical key");
  assert.notEqual(sliceKey("abc", 1125), sliceKey("abd", 1125), "different content, different key");
  assert.notEqual(sliceKey("abc", 1125), sliceKey("abc", 600), "a different word cap is a different summary");
  assert.equal(typeof sliceKey("abc", 1125), "string");
  assert.equal(sliceKey("abc", 1125).length, 64, "sha256 hex");
  // the carried prefix is deliberately NOT in the key — that is what makes a second summary of the same text cheap
  assert.equal(sliceKey("same slice", 100), sliceKey("same slice", 100));
});

test("trimPrompt and DIGEST_PROMPT: stable strings, the word cap and the secret rule in every slice prompt", () => {
  // prompts are stable strings (so the provider caches them) and carry the word cap
  assert.equal(trimPrompt(1125), trimPrompt(1125));
  assert.match(trimPrompt(1125), /at most 1125 words/);
  assert.match(trimPrompt(100), /Never write a secret/, "the secret rule is in every slice prompt");
  assert.match(DIGEST_PROMPT, /rolling digest/);
});

// ---- the archive's slice cache --------------------------------------------------------------
test("archive: slice summaries are cached by content hash, sealed at rest, and survive a reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-trim-arch-"));
  try {
    const key = Buffer.alloc(32, 7);
    const a = new Archive({ file: join(dir, "archive.db"), key });
    assert.equal(a.trimSlice("nope"), null, "a miss is null, not undefined");
    const text = "SUMMARY: the user decided to rewrite the loop. sk-abcdefgh12345678";
    const first = a.trimSlicePut("h1", { summaryText: text, tokens: estTokens(text), model: "cheap-1" });
    assert.equal(first.hash, "h1");
    assert.equal(a.trimSlice("h1").summary, text, "the summary comes back exactly");
    assert.equal(a.trimSlice("h1").tokens, estTokens(text));
    assert.equal(a.trimSlice("h1").model, "cheap-1");
    assert.equal(a.trimSlice("h1").chars, text.length);
    assert.ok(a.trimSlice("h1").createdAt > 0);
    // content-addressed: a second write to the same hash does not replace the first summary
    a.trimSlicePut("h1", { summaryText: "something else entirely", model: "cheap-2" });
    assert.equal(a.trimSlice("h1").summary, text, "the first summary wins: the same excerpt has one summary");
    // empty input is refused rather than stored
    assert.equal(a.trimSlicePut("h2", { summaryText: "" }), null);
    assert.equal(a.trimSlicePut("", { summaryText: "x" }), null);
    assert.equal(a.trimSlice("h2"), null, "nothing stored for it");
    // sealed at rest: the plaintext is not in the database file
    a.close();
    const bytes = readFileSync(join(dir, "archive.db")).toString("latin1");
    assert.ok(!bytes.includes("decided to rewrite the loop"), "the summary is encrypted, like every other message body");
    assert.ok(!bytes.includes("sk-abcdefgh12345678"), "and a secret that slipped into a summary is not on disk in plain text");
    // rows are shared across sessions and outlive the one that made them (like messages)
    const b = new Archive({ file: join(dir, "archive.db"), key });
    const chain = b.chainForKey("k1", { project: null, cwd: null, client: "test", model: "m" });
    assert.equal(b.trimSlice("h1").summary, text, "and it survives a reopen");
    b.deleteChain(chain.id);
    assert.equal(b.trimSlice("h1").summary, text, "deleting a session keeps the cache: a second summary still hits it");
    assert.equal(b.counts().trimSlices, 1, "the count is on the dashboard's status");
    b.close();
  } finally { for (let i = 0; i < 12; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 150)); } } }
});
