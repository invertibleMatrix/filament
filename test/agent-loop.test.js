// WP-F: the D1 agent loop behind `agent/<model>`, against a real app, a fake upstream that plays the backing model
// (and the cheap reader), and real hands in a temp folder. Budgets are events, permissions are modes, a pause waits
// for the developer's next message, a message typed mid-turn lands at the round boundary.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply, parseSse } from "./helpers/app.js";
import { textOpen, textDelta } from "./helpers/sse.js";
import { until } from "./helpers/wait.js";
import { PROMPT_VERSION, systemPromptFor, PROMPT } from "../src/app/agent/prompt.js";
import { RUN_EVENT_TYPE_LIST } from "../src/services/runs.js";
import { argSummary, toolSetFor } from "../src/app/agent/tools.js";
import { underRoots, loopConfig, disabledTools } from "../src/app/agent/turn.js";
import { cutReply, UNPLANNED_LINE } from "../src/app/agent/loop.js";
import { SHELL, POWERSHELL } from "../src/adapters/tools/shell.js";
import { projectIdOf } from "../src/core/project-id.js";
import { houseAuth } from "../src/services/house.js";

/** The powershell hand rides only where there is a PowerShell (Windows): the tool lists below hold its place. */
const PS = POWERSHELL ? ["powershell"] : [];

const text = (blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
const lastResults = (msgs) => {
  const m = msgs.at(-1);
  return Array.isArray(m?.content) ? m.content.filter((c) => c?.type === "tool_result") : [];
};
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
/** Status check that does not consume the body on the happy path. */
const expectOk = async (r) => {
  if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
};
const reply = (blocks, stop = "end_turn", model = "brain-model") =>
  anthropicReply("", { model, stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });

describe("the loop's knobs from the session document (HarnessV2 P3)", () => {
  test("loopConfig: the document over the global config in the config's names; null leaves the global; learned permissions off is whole", () => {
    const g = { permissions: "edit", readerModel: "cheap", treeSnapshots: true, learnedPermissions: { afterApprovals: 5 }, roots: ["x"] };
    assert.equal(loopConfig(g, null), g, "no document: the config object itself");
    const c = loopConfig(g, { permissions: "ask", readerModel: null, treeSnapshots: false, learnedPermissions: { enabled: false, afterApprovals: 2 }, tools: { bash: false } });
    assert.deepEqual({ ...c, learnedPermissions: undefined, tools: undefined }, { ...g, permissions: "ask", readerModel: "cheap", treeSnapshots: false, learnedPermissions: undefined, tools: undefined, resultCapChars: 0 });
    assert.deepEqual(c.learnedPermissions, { afterApprovals: 2, enabled: false });
    assert.deepEqual(c.tools, { bash: false });
    assert.equal(loopConfig(g, { resultCapChars: 4000 }).resultCapChars, 4000, "P4: the result cap is the document's alone (no global)");
    assert.deepEqual(loopConfig(g, { learnedPermissions: { enabled: true } }).learnedPermissions, { afterApprovals: 5, enabled: true });
    assert.equal(loopConfig(g, {}).tools, null);
  });
  test("disabledTools and toolSetFor: the switched-off names in schema order; the set is one frozen constant per choice", () => {
    assert.deepEqual(disabledTools(null), []);
    assert.deepEqual(disabledTools({ plan: false, bash: false, read: true, nope: false }), ["bash", "plan"]);
    const base = toolSetFor({ delegateRead: false });
    const off = toolSetFor({ delegateRead: false, disabled: ["bash", "plan"] });
    assert.deepEqual(base.map((t) => t.name), ["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", ...PS, "grep", "glob", "lsp", "ask", "plan", "agent", "wait", "envelope", "visual_guide", "show_visual", "artifact", "space", "team", "flow", "thread"]);
    assert.deepEqual(off.map((t) => t.name), ["read", "write", "edit", "bash_background", "bash_output", "bash_kill", ...PS, "grep", "glob", "lsp", "ask", "agent", "wait", "envelope", "visual_guide", "show_visual", "artifact", "space", "team", "flow", "thread"]);
    assert.equal(toolSetFor({ delegateRead: false, disabled: ["plan", "bash"] }), off, "same choice, same frozen array");
    assert.equal(toolSetFor({ delegateRead: false, disabled: [] }), base, "no switches: the pre-Phase-3 set");
    assert.ok(Object.isFrozen(off));
    // Every mode offers every hand — read-only included; the gate refuses, the list never shrinks, so a mid-task
    // mode flip changes nothing the provider cached.
    assert.deepEqual(toolSetFor({ delegateRead: true, disabled: ["delegate_read", "ask"] }).map((t) => t.name), ["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", ...PS, "grep", "glob", "lsp", "plan", "agent", "wait", "envelope", "visual_guide", "show_visual", "artifact", "space", "team", "flow", "thread"]);
    // Visuals switched off (HarnessV4_Visuals_Plan E16, VC-9) take their guide with them; with artifacts (HarnessV4_
    // Artifacts_Plan E18, AFC-5), the Space (proposal_ux §4.14), the team tool (team_v2_plan §5.5), the flow tool
    // (HarnessV4_OneAgent_Plan OA3) and the thread tool (th3) off too, the set before E16.
    assert.deepEqual(toolSetFor({ delegateRead: false, disabled: ["show_visual"] }).map((t) => t.name), ["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", ...PS, "grep", "glob", "lsp", "ask", "plan", "agent", "wait", "envelope", "artifact", "space", "team", "flow", "thread"]);
    assert.deepEqual(toolSetFor({ delegateRead: false, disabled: ["show_visual", "artifact", "space", "team", "flow", "thread"] }).map((t) => t.name), ["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", ...PS, "grep", "glob", "lsp", "ask", "plan", "agent", "wait", "envelope"]);
  });
  test("systemPromptFor: nothing switched off = the old bytes; hands off named in one line; plan/ask sentences go with their tools", () => {
    const before = systemPromptFor({ root: "R", delegateRead: false });
    assert.equal(systemPromptFor({ root: "R", delegateRead: false, toolsOff: [] }), before);
    const off = systemPromptFor({ root: "R", delegateRead: true, toolsOff: ["bash", "plan", "delegate_read"] });
    assert.ok(off.includes(`${PROMPT.toolsOff} bash.`), off);
    assert.ok(!off.includes(PROMPT.plan)); assert.ok(off.includes(PROMPT.ask)); assert.ok(!off.includes(PROMPT.delegateRead));
    const ro = systemPromptFor({ root: "R", delegateRead: false, toolsOff: ["bash", "write", "grep"] });
    assert.ok(ro.includes(`${PROMPT.toolsOff} write, bash, grep.`), "every switched-off hand is named, read-only or not");
    assert.equal(systemPromptFor({ root: "R", delegateRead: false, toolsOff: ["ask"] }).includes(PROMPT.ask), false);
  });
});

// System on the wire is a string, or blocks carrying cache markers once it crosses rules.cache.minSystemChars.
const sysOf = (b) => (Array.isArray(b.system) ? b.system.map((x) => x?.text ?? "").join("\n") : String(b.system || ""));

// HarnessV3-TaskGraph-v2 TG2-D62. The request's shaping strips an unsigned thinking block before an Anthropic model sees
// it, so only the conversation itself shows a cut one kept: the archive, and a provider of another wire.
test("cutReply: only the last block is cut — a thinking block or a call there is dropped, a text block kept", () => {
  const text1 = { type: "text", text: "a" };
  const signed = { type: "thinking", thinking: "whole", signature: "s" };
  const call = toolUse("c1", "write", { path: "x" });
  assert.deepEqual(cutReply([text1, { type: "thinking", thinking: "cut off" }]), { kept: [text1], part: "thinking", chars: 7, tool: null, id: null });
  assert.deepEqual(cutReply([signed, text1, call, toolUse("c2", "write", {})]), { kept: [signed, text1, call], part: "call", chars: 0, tool: "write", id: "c2" });
  assert.deepEqual(cutReply([signed, { type: "text", text: "half a sen" }]).kept.map((b) => b.type), ["thinking", "text"]);
  assert.deepEqual(cutReply([]), { kept: [], part: "nothing", chars: 0, tool: null, id: null });
});

describe("the agent loop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string} */
  let outside;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  /** The key this file's Filament calls its upstream with: a call without it is no call of this Filament's. */
  const UP_KEY = "s-agent-loop";
  // System on the wire is a string, or blocks carrying cache markers once it crosses rules.cache.minSystemChars.
  const sysOf = (b) => (Array.isArray(b.system) ? b.system.map((x) => x?.text ?? "").join("\n") : String(b.system || ""));
  /** @type {(call: any) => any} */
  let reader = (call) => anthropicReply("the reader's answer", { model: call.body.model, usage: { input_tokens: 500, output_tokens: 20 } });
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-root-"));
    outside = mkdtempSync(join(tmpdir(), "filament-agent-outside-"));
    up = await fakeUpstream(async (call) => {
      // Only this Filament asking a model reaches the brain and the reader, each test's count of rounds with them. Under
      // a parallel run another file's Filament, stopped, still sends to its own port — a chat's wake, "connect
      // ECONNREFUSED" while nothing listens there — and Windows may since have handed that port to this upstream: each
      // such send was a round of the test running (11-10: the background shell's id never came back, a parked reply was
      // counted as re-asked).
      if (call.path.split("?")[0] !== "/v1/messages" || call.headers["x-api-key"] !== UP_KEY)
        return { status: 404, json: { type: "error", error: { type: "not_found_error", message: "not a call of this test's Filament" } } };
      const b = call.body || {};
      if (String(b.model).startsWith("reader")) return reader(call);
      return brain(call);
    });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: UP_KEY, enabled: true }];
        cfg.routes = [
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "reader-*", upstream: "m", upstreamModel: "{model}", enabled: true },
        ];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "reader-model" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const H = (extra = {}) => ({ "x-filament-cwd": root, "x-session-id": `s-${Math.random().toString(36).slice(2, 8)}`, ...extra });
  const ask = (body, headers = H()) => shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, ...body }, headers);
  const eventsOf = async (runId) => (await (await shim.api(`/api/runs/${runId}/events?since=0&limit=5000`)).json()).events;
  const setConfig = async (patch) => {
    const st = await (await shim.api("/api/state")).json();
    const r = await shim.api("/api/config", { method: "PUT", body: { ...st.config, agentLoop: { ...st.config.agentLoop, ...patch } } });
    await expectOk(r);
  };

  test("a text reply is done in one round: one text block, the prompt version on the record, the run logged with its states", async () => {
    brain = (call) => {
      const b = call.body;
      assert.equal(b.model, "brain-model", "the tick names the backing model");
      assert.ok(Array.isArray(b.tools) && b.tools.some((t) => t.name === "edit") && b.tools.some((t) => t.name === "plan") && b.tools.some((t) => t.name === "delegate_read"));
      const sys = Array.isArray(b.system) ? b.system.map((x) => x?.text ?? "").join("\n") : String(b.system || "");
      assert.ok(/Working folder: /.test(sys), "the system prompt names the folder");
      assert.ok(/edit \(exact replacements\)/.test(sys), "the hands paragraph is there in edit mode");
      return reply([{ type: "text", text: "Nothing to do here." }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "hello" }] });
    await expectOk(r);
    const j = await r.json();
    assert.deepEqual(j.content, [{ type: "text", text: "Nothing to do here." }]);
    assert.equal(j.stop_reason, "end_turn");
    assert.equal(j.model, "agent/brain-model");
    assert.equal(j.usage.input_tokens, 30);
    const id = r.headers.get("x-filament-request-id");
    assert.ok(id);
    const rec = await shim.record(id);
    assert.equal(rec.agent.promptVersion, PROMPT_VERSION);
    assert.equal(rec.agent.mode, "edit");
    assert.equal(rec.agent.status, "done");
    assert.equal(rec.agent.rounds, 1);
    assert.equal(rec.cost, 0, "the parent carries no cost");
    assert.equal(rec.upstream, "agent-loop");
    const run = (await (await shim.api(`/api/runs/${id}`)).json()).run;
    assert.equal(run.kind, "agent-turn");
    assert.equal(run.status, "done");
    const evts = await eventsOf(id);
    const types = evts.map((e) => e.type);
    assert.deepEqual(types, ["run-start", "window", "turn-state", "round-start", "round-cache", "round-written", "round-text", "turn-state", "run-end"]);
    assert.deepEqual(evts.filter((e) => e.type === "turn-state").map((e) => e.to), ["planning", "done"]);
    assert.equal(evts.find((e) => e.type === "round-text").block, 0);
    assert.ok(types.every((t) => RUN_EVENT_TYPE_LIST.includes(t)), "every emitted type is in the registry");
    // The tick is its own record, under the client's request.
    const recs = await shim.records(20);
    const tick = recs.find((x) => x.agentOf === id);
    assert.ok(tick, "the tick record hangs off the parent");
    assert.equal(tick.model, "brain-model");
    // (fails before: yes — the owner's report of 10-26: the Cache said the last turn's figure all through a running turn)
    // The round's prompt as its provider counted it, said as the round's reply came: its own record's columns.
    const said = evts.find((e) => e.type === "round-cache");
    assert.deepEqual([said.round, said.input, said.cacheRead, said.cacheWrite], [1, tick.tokens.input, tick.tokens.cacheRead || 0, tick.tokens.cacheWrite || 0]);
    assert.ok(said.input + said.cacheRead + said.cacheWrite > 0);
    // (fails before: yes — the owner's report of 10-27: the speed gauge had no round's own count, so a turn that streamed
    // few words read no figure) What the round wrote as its provider counted it, and the time it wrote: its record's.
    const wrote = evts.find((e) => e.type === "round-written");
    assert.deepEqual([wrote.round, wrote.output], [1, tick.tokens.output]);
    assert.ok(wrote.ms === null || wrote.ms >= 200, "the writing time by computeTps's rule, or none where too short to rate");
  });

  // (a mutant that left the request's system text out of the loop's prompt survived every test before this one)
  test("the request's own system text leads the loop's system prompt, then Filament's — memory's briefing and the goal ride in it", async () => {
    /** @type {string[]} */
    const systems = [];
    brain = (call) => {
      systems.push(sysOf(call.body));
      return reply([{ type: "text", text: "Haiku." }]);
    };
    up.reset();
    const r = await ask({ system: [{ type: "text", text: "BRIEFING: answer in haiku." }], messages: [{ role: "user", content: "hello" }] });
    await expectOk(r);
    assert.equal(systems.length, 1);
    assert.ok(systems[0].startsWith("BRIEFING: answer in haiku.\n\n"), systems[0].slice(0, 200));
    assert.match(systems[0], /Working folder: /, "Filament's own prompt follows it");
  });

  test("tool calls run for real: write, edit with string-shaped edits (shimmed), grep and read — results appended, the next tick sees them, one text block per model call", async () => {
    let round = 0;
    brain = (call) => {
      round++;
      const b = call.body;
      if (round === 1)
        return reply(
          [
            { type: "text", text: "I will create the file." },
            toolUse("t1", "write", { path: "notes/a.txt", content: "alpha\nbeta\n" }),
            toolUse("t2", "edit", { path: "notes/a.txt", edits: JSON.stringify([{ oldText: "beta", newText: "gamma" }]) }),
          ],
          "tool_use",
        );
      if (round === 2) {
        const res = lastResults(b.messages);
        assert.equal(res.length, 2, "both tools answered in one user message");
        assert.ok(res.every((c) => !c.is_error), JSON.stringify(res));
        return reply([toolUse("t3", "grep", { pattern: "gamma", path: "notes" }), toolUse("t4", "read", { path: "notes/a.txt" })], "tool_use");
      }
      const res = lastResults(b.messages);
      assert.match(res[0].content, /a\.txt:2:gamma/);
      assert.match(res[1].content, /gamma/);
      return reply([{ type: "text", text: "Done: notes/a.txt says gamma." }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "make a file" }] });
    await expectOk(r);
    const j = await r.json();
    assert.deepEqual(j.content, [
      { type: "text", text: "I will create the file." },
      { type: "text", text: "Done: notes/a.txt says gamma." },
    ]);
    assert.equal(readFileSync(join(root, "notes", "a.txt"), "utf8"), "alpha\ngamma\n");
    const evts = await eventsOf(r.headers.get("x-filament-request-id"));
    const starts = evts.filter((e) => e.type === "tool-start");
    assert.deepEqual(starts.map((e) => e.name), ["write", "edit", "grep", "read"]);
    assert.equal(starts[0].args, "notes/a.txt");
    assert.ok(!JSON.stringify(starts).includes("alpha\\nbeta"), "what the model wrote never rides tool-start: the target only");
    const ends = evts.filter((e) => e.type === "tool-end");
    assert.ok(ends.every((e) => e.ok === true));
    // The result's head rides tool-end as a preview (the viewer's card), the way round-text carries the reply.
    assert.match(ends.find((e) => e.name === "read").preview, /^ {5}1\talpha\n {5}2\tgamma/);
    assert.match(ends.find((e) => e.name === "grep").preview, /a\.txt:2:gamma/);
    assert.ok(ends.every((e) => e.preview.length === e.chars), "a short result is carried whole");
    assert.ok(ends.every((e) => !("exitCode" in e)), "exit codes are the shell's alone");
    assert.deepEqual(evts.filter((e) => e.type === "round-text").map((e) => e.block), [0, 1], "text blocks are numbered by the rounds that produced them");
    assert.deepEqual(
      evts.filter((e) => e.type === "turn-state").map((e) => e.to),
      ["planning", "acting", "observing", "planning", "acting", "observing", "planning", "done"],
    );
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.equal(rec.agent.toolCalls, 4);
  });

  // HarnessV3-Tools TL3 (TL-D7). (fails before: the developer's file was overwritten unread)
  test("write overwrites an existing file only as this session's agent last saw it — and what it saw outlives the turn", async () => {
    writeFileSync(join(root, "guarded.md"), "the developer's draft\n");
    let round = 0;
    /** @type {any[][]} */
    const results = [];
    brain = (call) => {
      round++;
      const res = lastResults(call.body.messages);
      if (res.length) results.push(res);
      if (round === 1) return reply([toolUse("g1", "write", { path: "guarded.md", content: "mine\n" })], "tool_use");
      if (round === 2) return reply([toolUse("g2", "read", { path: "guarded.md" })], "tool_use");
      if (round === 3) return reply([toolUse("g3", "write", { path: "guarded.md", content: "mine\n" })], "tool_use");
      return reply([{ type: "text", text: "Written." }]);
    };
    up.reset();
    const sess = H();
    await expectOk(await ask({ messages: [{ role: "user", content: "rewrite guarded.md" }] }, sess));
    assert.equal(results[0][0].is_error, true);
    assert.match(String(results[0][0].content), /guarded\.md already exists and you have not read it in this session: read it first/);
    assert.ok(!results[1][0].is_error && !results[2][0].is_error, JSON.stringify(results));
    assert.equal(readFileSync(join(root, "guarded.md"), "utf8"), "mine\n");

    round = 2; // the next turns write straight away
    results.length = 0;
    up.reset();
    await expectOk(await ask({ messages: [{ role: "user", content: "rewrite guarded.md" }, { role: "assistant", content: "Written." }, { role: "user", content: "once more" }] }, sess));
    assert.equal(results.length, 1);
    assert.ok(!results[0][0].is_error, JSON.stringify(results));
    round = 2;
    results.length = 0;
    up.reset();
    await expectOk(await ask({ messages: [{ role: "user", content: "rewrite guarded.md" }] }));
    assert.match(String(results[0][0].content), /have not read it/, "another session's agent has seen nothing");
  });

  test("a long read reaches the model cut by the hand itself — whole lines inside one result's budget and the offset to continue — never by a later slice", async () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `entry ${i + 1} ${"e".repeat(30)}`);
    writeFileSync(join(root, "big.log"), `${lines.join("\n")}\n`);
    /** @type {string[]} */
    const got = [];
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("b1", "read", { path: "big.log" })], "tool_use");
      got.push(String(lastResults(call.body.messages)[0].content));
      return reply([{ type: "text", text: "Read it." }]);
    };
    up.reset();
    await expectOk(await ask({ messages: [{ role: "user", content: "read the log" }] }));
    const out = got[0];
    assert.ok(Buffer.byteLength(out) <= 24_000, `${Buffer.byteLength(out)} bytes`);
    const m = /\n\[Showing lines 1-(\d+) of 2000\. Use offset=(\d+) to continue\.\]$/.exec(out);
    assert.ok(m, out.slice(-160));
    assert.equal(out.slice(0, -m[0].length), lines.slice(0, Number(m[1])).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join("\n"), "whole lines, numbered");
    assert.ok(!out.includes("result truncated"), "the loop's last guard never had to cut");
  });

  test("streaming: text and thinking arrive as deltas, one text block per model call, the same bytes as the JSON message", async () => {
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([{ type: "thinking", thinking: "let me see" }, { type: "text", text: "Looking." }, toolUse("t1", "read", { path: "notes/a.txt" })], "tool_use");
      return reply([{ type: "text", text: "It says gamma." }]);
    };
    up.reset();
    const r = await ask({ stream: true, messages: [{ role: "user", content: "what does the file say" }] });
    assert.equal(r.status, 200);
    assert.ok(String(r.headers.get("content-type")).startsWith("text/event-stream"));
    const frames = parseSse(await r.text());
    const types = frames.map((f) => f.event);
    assert.equal(types[0], "message_start");
    const starts = frames.filter((f) => f.event === "content_block_start").map((f) => [f.data.index, f.data.content_block.type]);
    assert.deepEqual(starts, [
      [0, "thinking"],
      [1, "text"],
      [2, "text"],
    ]);
    const textOf = (idx) =>
      frames
        .filter((f) => f.event === "content_block_delta" && f.data.index === idx && f.data.delta.type === "text_delta")
        .map((f) => f.data.delta.text)
        .join("");
    assert.equal(textOf(1), "Looking.");
    assert.equal(textOf(2), "It says gamma.");
    assert.equal(frames.find((f) => f.event === "message_delta").data.delta.stop_reason, "end_turn");
    assert.equal(types.at(-1), "message_stop");
    const stops = frames.filter((f) => f.event === "content_block_stop").length;
    assert.equal(stops, 3, "every block is closed");
  });

  test("background shells and live output: a long command starts at once and is polled, kill stops it, and a sync command's output streams while it runs", async () => {
    await setConfig({ permissions: "auto" });
    try {
      const wait = SHELL.kind === "cmd"
        ? (ms, what) => `node -e "setTimeout(()=>console.log('${what}'),${ms})"`
        : (ms, what) => `sleep ${Math.round(ms / 1000)} && echo ${what}`;
      /** @type {string[]} */
      const results = [];
      let bgId = "";
      let round = 0;
      brain = (call) => {
        round++;
        if (round === 1) return reply([toolUse("bg1", "bash_background", { command: `echo started && ${wait(2500, "LATE")}` })], "tool_use");
        if (round === 2) {
          const r = lastResults(call.body.messages).at(-1)?.content || "";
          results.push(String(r));
          bgId = (/bg_[0-9a-z]+/.exec(String(r)) || [""])[0];
          // The read waits for the late line itself: a shell started slowly under load prints "started" after the
          // start's early output, and a read waiting for any output would end on it.
          return reply([toolUse("o1", "bash_output", { id: bgId, until: "LATE", wait: 20 })], "tool_use");
        }
        if (round === 3) {
          results.push(String(lastResults(call.body.messages).at(-1)?.content || ""));
          // Nothing more to print: the poll ends on the exit, or at once where the read before saw it.
          return reply([toolUse("o2", "bash_output", { id: bgId, wait: 20 })], "tool_use");
        }
        if (round === 4) {
          results.push(String(lastResults(call.body.messages).at(-1)?.content || ""));
          return reply([toolUse("k1", "bash_kill", { id: bgId })], "tool_use");
        }
        if (round === 5) {
          results.push(String(lastResults(call.body.messages).at(-1)?.content || ""));
          return reply([toolUse("s1", "bash", { command: `echo one && ${wait(400, "two")}` })], "tool_use");
        }
        results.push(String(lastResults(call.body.messages).at(-1)?.content || ""));
        return reply([{ type: "text", text: "done with shells" }], "end_turn");
      };
      const r = await ask({ messages: [{ role: "user", content: "run things in the background" }] });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.match(text(j.content), /done with shells/);
      assert.ok(bgId, "the background shell's id came back to the model");
      assert.match(results[0], /started/, "the early output rides the start");
      assert.match(results[0], /bash_output/, "the model is told how to follow it");
      assert.match(results[1], /LATE/, "waiting read the late output");
      // With its last line, or by the poll after it (the exit's settle with the last line is bash-output-exit.test.js's).
      assert.match(results[2], /exited with code 0/, "the shell's exit is reported: a second poll sees it");
      assert.match(results[3], new RegExp(`Background shell ${bgId} stopped`), "kill stops it");
      assert.match(results[4], /one/, "the sync command's result carries its output");
      assert.match(results[4], /two/);
      const evts = await eventsOf(r.headers.get("x-filament-request-id"));
      const lives = evts.filter((e) => e.type === "tool-output");
      assert.ok(lives.some((e) => String(e.text || "").includes("one")), "the sync command streamed its output while running");
      const endAt = evts.findIndex((e) => e.type === "tool-end" && e.id === "s1");
      const liveAt = lives.findIndex((e) => String(e.text || "").includes("one"));
      assert.ok(endAt > liveAt && liveAt >= 0, "the live output arrived before the call finished");
    } finally {
      await setConfig({ permissions: "edit" });
    }
  });

  test("the compaction line folds mid-turn: the oldest rounds become one summary, the loop keeps running inside the window", async () => {
    // A tiny window on the fake upstream: the compaction line is 85% of it (≈13,600), so rounds of a 20k-char read
    // (≈5k tokens each) cross it by the third round. The window itself stays above the system prompt + tools + the
    // post-fold remainder (the hard-window fail-fast refuses, in words, a request the estimate says cannot fit —
    // without uploading it to hear the same from the provider); the agent tool's model fields (HarnessV4_Tasks E23)
    // took 15,000 past that, and the Space's tool in every project's chat from its first message (team_v2_plan TV2-D7)
    // 16,000, Team v2's tools 17,000, the Space's routines (HarnessV4_Space_Plan S6, ≈150 tokens once trimmed) 18,000,
    // the shell tools' sentence on the filtered environment (version 123, ≈130 past it) 18,500, the agent tools' attach
    // (version 127, ≈90 past it) 19,000. Restored to a big window afterwards.
    const setWindow = async (contextTokens) => {
      const st = await (await shim.api("/api/state")).json();
      const upstreams = st.config.upstreams.map((u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens } } } : u));
      const r = await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams } });
      await expectOk(r);
    };
    writeFileSync(join(root, "big.txt"), `MARKER-START ${"z".repeat(20000)}`);
    let round = 0;
    let summaries = 0;
    /** @type {string[]} */
    const seen = [];
    /** @type {string[]} */
    const transcripts = [];
    /** @type {number[]} */
    const caps = [];
    brain = (call) => {
      const b = call.body;
      if ((Array.isArray(b.system) ? b.system.map((x) => x?.text ?? "").join("\n") : String(b.system || "")).includes("compaction summaries")) {
        summaries++;
        transcripts.push(String(b.messages?.[0]?.content?.[0]?.text || b.messages?.[0]?.content || ""));
        return reply([{ type: "text", text: `SUMMARY-OF-WORK: big.txt was read, the plan was set, the open item stands. ${"detail ".repeat(600)}END-OF-SUMMARY` }], "end_turn");
      }
      caps.push(Number(b.max_tokens) || 0);
      seen.push(JSON.stringify(b.messages));
      round++;
      if (round <= 5) return reply([toolUse(`t${round}`, "read", { path: "big.txt" })], "tool_use");
      return reply([{ type: "text", text: "done after compaction" }], "end_turn");
    };
    await setWindow(19000);
    try {
      const r = await ask({ max_tokens: 8000, messages: [{ role: "user", content: "read big.txt over and over, then finish" }] });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.stop_reason, "end_turn");
      assert.match(text(j.content), /done after compaction/);
      assert.ok(caps.some((c) => c >= 1024 && c < 8000), `the reply's room: a round near the line had its max_tokens clamped to what remains of the window (${caps.join(", ")})`);
      assert.ok(caps.every((c) => c >= 1024), "the clamp never goes under the reply floor");
      assert.ok(summaries >= 2, `the summarizer ran (${summaries} times) — the compaction line was crossed and folded`);
      assert.match(transcripts[0], /Tool call read/, "the transcript carries the calls");
      assert.match(transcripts[0], /Result:/, "the transcript carries the results");
      assert.match(seen.at(-1), /\[Filament compacted rounds? /, "the post-compaction rounds continue from the summary block");
      // The next fold's transcript carries the earlier summary whole, past the 4,000 characters it was once cut at, and
      // says it for what it is: not under the lead the continuing model reads (HarnessV3-AtHome AH-D9 c).
      // (fails before: yes — it was a "Note:" cut at 4,000 characters, the lead included)
      assert.match(transcripts[1], /Summary of earlier rounds:\nSUMMARY-OF-WORK: /);
      assert.ok(transcripts[1].includes("END-OF-SUMMARY"), "the earlier summary, whole");
      assert.doesNotMatch(transcripts[1], /without recapping/);
      assert.equal((seen.at(-1).match(/MARKER-START/g) || []).length, 1, "the folded rounds' bulk left the live context — only the kept newest round's result remains");
      assert.ok(seen.at(-1).includes("SUMMARY-OF-WORK"), "the summary itself rides in place of the bulk");
      const evts = await eventsOf(r.headers.get("x-filament-request-id"));
      assert.ok(evts.some((e) => e.type === "compaction"), "the run's timeline says the compaction line was folded");
      const rec = await shim.record(r.headers.get("x-filament-request-id"));
      assert.match((rec.changes || []).join(" "), /compacted rounds/, "the record's changes note the compaction");
      assert.equal(rec.status, "ok", "a compaction is a normal turn event, not an error");
    } finally {
      await setWindow(200000);
    }
  });

  // (fails before: yes — a fold brought nothing back: the files the folded rounds read had to be read again)
  test("each fold brings back the files its rounds used, a later fold those an earlier one brought back — and that fold's summarizer reads the summary, not the files (HarnessV3-AtHome AH-D9 b)", async () => {
    const setWindow = async (/** @type {number} */ contextTokens) => {
      const st = await (await shim.api("/api/state")).json();
      const upstreams = st.config.upstreams.map((u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens } } } : u));
      await expectOk(await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams } }));
    };
    writeFileSync(join(root, "big.txt"), `MARKER-START ${"z".repeat(20000)}`);
    writeFileSync(join(root, "small.txt"), "SMALL-NOTES: the one line that matters\n");
    let round = 0;
    /** @type {string[]} */
    const transcripts = [];
    /** @type {any[][]} */
    const seen = [];
    brain = (call) => {
      const b = call.body;
      if (sysOf(b).includes("compaction summaries")) {
        transcripts.push(String(b.messages?.[0]?.content?.[0]?.text || b.messages?.[0]?.content || ""));
        return reply([{ type: "text", text: `SUMMARY-${transcripts.length}: small.txt was read, then big.txt again and again.` }], "end_turn");
      }
      seen.push(b.messages);
      round++;
      if (round === 1) return reply([toolUse("t1a", "read", { path: "small.txt" }), toolUse("t1b", "read", { path: "big.txt" })], "tool_use");
      if (round <= 5) return reply([toolUse(`t${round}`, "read", { path: "big.txt" })], "tool_use");
      return reply([{ type: "text", text: "done after the folds" }], "end_turn");
    };
    // The window of the fold test above: every second read of big.txt crosses the line, and each fold keeps the newest
    // round — round 1, with small.txt, goes first. 15,000 until the Space's tool rode from the first message (TV2-D7),
    // 16,000 until its drafts (HarnessV4_Space_Plan S5c), 16,500 until its repro (S7), 17,000 until the agent tool's
    // stop (ag-stop: the request with nothing left to fold came to ≈17,034 tokens), 17,500 until the tools outgrew it
    // (version 126's failed it, its turn never ending) and the agent tools' attach (version 127: ≈17,696).
    await setWindow(18000);
    try {
      const r = await ask({ max_tokens: 8000, messages: [{ role: "user", content: "read small.txt, then big.txt over and over" }] });
      assert.equal(r.status, 200);
      assert.match(text((await r.json()).content), /done after the folds/);
      assert.ok(transcripts.length >= 2, `two folds or more: ${transcripts.length}`);
      const last = seen.at(-1) || [];
      const heads = last.filter((m) => m.role === "user" && Array.isArray(m.content) && /^\[Filament compacted rounds? /.test(String(m.content[0]?.text || "")));
      assert.equal(heads.length, 1, "one summary stands for every folded round");
      const block = String(heads[0].content[1]?.text || "");
      assert.ok(block.includes('<file path="small.txt">\n     1\tSMALL-NOTES: the one line that matters\n</file>'), block);
      assert.ok(!block.includes("big.txt"), "the kept round shows big.txt itself");
      assert.equal((JSON.stringify(last).match(/SMALL-NOTES/g) || []).length, 1, "once: an earlier fold's block went with the rounds it followed");
      assert.ok(!transcripts.slice(1).some((t) => t.includes("SMALL-NOTES") || t.includes("brought these back")), transcripts[1]);
    } finally {
      await setWindow(200000);
    }
  });

  // (fails before: yes — the block's room was the window's tenth whatever the fold freed. In the live drive of 2026-10-11
  // a turn begun near its line folded three rounds of reads and brought the three files back: 83,999 → 83,952 tokens, and
  // the loop stood down for the rest of the turn, which ran on to 79% of the window)
  test("what comes back after a fold never undoes it: the block takes at most half of what the fold freed, and a file past that is named", async () => {
    const setWindow = async (/** @type {number} */ contextTokens) => {
      const st = await (await shim.api("/api/state")).json();
      const upstreams = st.config.upstreams.map((u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens } } } : u));
      await expectOk(await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams } }));
    };
    const WORDS = "harbor lantern maple quiet river stone ledger copper window meadow signal anchor paper winter garden bridge".split(" ");
    const words = (/** @type {number} */ chars, /** @type {number} */ from) => {
      let s = "";
      for (let i = from; s.length < chars; i++) s += `${WORDS[i % WORDS.length]} `;
      return s;
    };
    for (let i = 1; i <= 10; i++) writeFileSync(join(root, `note${i}.txt`), `NOTE-${i}: ${words(1800, i)}\n`);
    // What a request of this app weighs before any work (its prompt and tools), and what a character of these words
    // adds to it: two turns that end at once, on the loop's own measure.
    const startOf = async (/** @type {string} */ content) => {
      brain = () => reply([{ type: "text", text: "ok" }], "end_turn");
      const r = await ask({ messages: [{ role: "user", content }] });
      await expectOk(r);
      return Number((await eventsOf(r.headers.get("x-filament-request-id"))).find((e) => e.type === "round-start")?.context) || 0;
    };
    const WINDOW = 20000;
    await setWindow(WINDOW);
    try {
      const bare = await startOf("x");
      const padded = await startOf(words(8000, 0));
      const perChar = (padded - bare) / 8000;
      assert.ok(bare > 0 && perChar > 0, `the loop measured its own start: ${bare}, ${padded}`);
      assert.ok(bare < WINDOW * 0.6, `the prompt and tools leave room in this window: ${bare}`);
      // The turn begins at seven tenths of the window: the line (85%) is some six reads off, and the block's own room,
      // a tenth of the window, would hold every file those rounds read.
      const filler = words(Math.round((WINDOW * 0.7 - bare) / perChar), 3);
      let round = 0;
      /** @type {any[][]} */
      const seen = [];
      brain = (call) => {
        const b = call.body;
        if (sysOf(b).includes("compaction summaries")) return reply([{ type: "text", text: "SUMMARY: the notes were read one by one; nothing in them asks for anything." }], "end_turn");
        seen.push(b.messages);
        round++;
        if (round <= 10) return reply([toolUse(`n${round}`, "read", { path: `note${round}.txt` })], "tool_use");
        return reply([{ type: "text", text: "done after the notes" }], "end_turn");
      };
      const r = await ask({ messages: [{ role: "user", content: `${filler}\nNow read note1.txt to note10.txt, one at a time.` }] });
      assert.equal(r.status, 200);
      assert.match(text((await r.json()).content), /done after the notes/);
      const evts = await eventsOf(r.headers.get("x-filament-request-id"));
      const folds = evts.filter((e) => e.type === "compaction" && e.toRound);
      assert.ok(folds.length >= 1, "the line was crossed and the oldest rounds folded");
      assert.ok(!evts.some((e) => e.type === "compaction" && e.stoodDown), "a fold that makes room is no reason to stand down");
      const first = folds[0];
      const rounds = first.toRound - first.fromRound + 1;
      const folded = Math.round(rounds * 1800 * perChar);
      assert.ok(rounds >= 2, `the first fold took rounds ${first.fromRound}–${first.toRound}`);
      const saved = first.tokensBefore - first.tokensAfter;
      assert.ok(saved >= folded * 0.4, `the fold of ${rounds} reads (≈${folded} tokens) freed ${saved}: ${first.tokensBefore} → ${first.tokensAfter}`);
      // The first request after that fold: its block names what it had no room for, so the model can read it again.
      const after = seen.find((m) => m.some((x) => x.role === "user" && Array.isArray(x.content) && /^\[Filament compacted rounds? /.test(String(x.content[0]?.text || "")))) || [];
      const block = String(after.find((x) => x.role === "user" && Array.isArray(x.content) && /^\[Filament compacted rounds? /.test(String(x.content[0]?.text || "")))?.content[1]?.text || "");
      assert.match(block, /^\[Filament brought these back after the summary: /, "something came back, or was named");
      assert.match(block, /shown="no">no room /, block.slice(0, 600));
      assert.equal(first.attached.shown + first.attached.named, Math.min(rounds, 5), "each folded file is shown or named, five at most");
      assert.ok(first.attached.named >= 1, "and one or more only named");
    } finally {
      await setWindow(200000);
    }
  });

  // (fails before: yes — the fold at the line always summarized a clipped transcript of the work, read as plain input,
  // however warm the loop's own cache was)
  test("the fold at the line forks the live conversation while the cache is warm: the loop's own request and one instruction, the prefix byte for byte, no transcript call", async () => {
    const setWindow = async (contextTokens) => {
      const st = await (await shim.api("/api/state")).json();
      const upstreams = st.config.upstreams.map((u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens } } } : u));
      await expectOk(await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams } }));
    };
    // Every reply read and wrote the provider's cache: the loop's newest request is warm when the line is crossed. The
    // counts stay under the token calibration's 40-token floor, so these replies teach the estimator nothing that
    // would scale the next tests' figures.
    const cached = (blocks, stop) => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } });
    for (let i = 1; i <= 16; i++) writeFileSync(join(root, `big${i}.txt`), `MARKER-START ${"z".repeat(20000)}`);
    let round = 0;
    /** @type {{ kind: "round" | "fork" | "transcript", body: any }[]} */
    const calls = [];
    const lastText = (/** @type {any} */ m) => (Array.isArray(m?.content) ? m.content.filter((x) => x?.type === "text").map((x) => x.text).join("\n") : String(m?.content || ""));
    brain = (call) => {
      const b = call.body;
      if ((Array.isArray(b.system) ? b.system.map((x) => x?.text ?? "").join("\n") : String(b.system || "")).includes("compaction summaries")) {
        calls.push({ kind: "transcript", body: b });
        return reply([{ type: "text", text: "TRANSCRIPT-SUMMARY" }], "end_turn");
      }
      if (lastText(b.messages.at(-1)).includes("this turn has reached the compaction line")) {
        calls.push({ kind: "fork", body: b });
        return cached([{ type: "text", text: "FORK-SUMMARY: the big files were read one by one; nothing new in them." }], "end_turn");
      }
      calls.push({ kind: "round", body: b });
      round++;
      if (round <= 16) return cached([toolUse(`t${round}`, "read", { path: `big${round}.txt` })], "tool_use");
      return cached([{ type: "text", text: "done after the fork" }], "end_turn");
    };
    // An 80,000-token window: the line is at 68,000, and rounds of ≈5,000 tokens cross it with room left for a summary.
    await setWindow(80000);
    try {
      const r = await ask({ max_tokens: 32000, messages: [{ role: "user", content: "read big1.txt to big16.txt, then finish" }] });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.match(text(j.content), /done after the fork/);
      const at = calls.findIndex((c) => c.kind === "fork");
      assert.ok(at > 0, `the fold forked: ${calls.map((c) => c.kind).join(" ")}`);
      assert.equal(calls.filter((c) => c.kind === "transcript").length, 0, "no transcript summary: the conversation itself was read");
      const fork = calls[at].body;
      const prev = calls[at - 1].body;
      const bare = (/** @type {any} */ v) => JSON.stringify(v, (k, x) => (k === "cache_control" ? undefined : x));
      assert.equal(bare(fork.messages.slice(0, prev.messages.length)), bare(prev.messages), "every message the last round sent, byte for byte, leads the fork");
      assert.deepEqual([bare(fork.system), bare(fork.tools), fork.model], [bare(prev.system), bare(prev.tools), prev.model], "the loop's own system prompt, tools and model");
      assert.match(lastText(fork.messages.at(-1)), /except your last 3 rounds of tool calls/);
      // The loop asks for 32,000; past the 68,000-token line an 80,000-token window leaves under 12,000 for the reply.
      assert.ok(fork.max_tokens >= 2048 && fork.max_tokens < 80000 - 68000, `the reply fitted to what the window leaves: ${fork.max_tokens}`);
      const after = calls.slice(at + 1).find((c) => c.kind === "round").body;
      assert.match(JSON.stringify(after.messages), /\[Filament compacted rounds? 1(–\d+)? of this turn into the summary below/);
      assert.ok(JSON.stringify(after.messages).includes("FORK-SUMMARY"), "the fork's summary rides in place of the rounds");
      const rec = await shim.record(r.headers.get("x-filament-request-id"));
      assert.match((rec.changes || []).join(" "), /compacted rounds 1–\d+ of this turn at the compaction line, summarized by brain-model, from its warm cache/);
      const evts = await eventsOf(r.headers.get("x-filament-request-id"));
      assert.ok(evts.some((e) => e.type === "compaction" && e.fork === true), "the run's timeline says the fold was the fork's");
    } finally {
      await setWindow(200000);
    }
  });

  test("a round refused for size is recovered in the loop: cleared, compacted, retried once", async () => {
    // The loop owns its window; the pipeline's auto-fit stands down on its rounds. A provider refusal for
    // size is therefore handled here — clear what clearing can, fold what folding can, retry the round once.
    let modelCalls = 0;
    brain = (call) => {
      if (sysOf(call.body).includes("compaction summaries"))
        return reply([{ type: "text", text: "SUMMARY: the work so far." }]);
      modelCalls++;
      if (modelCalls === 1)
        return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 99999 tokens > 5000 maximum" } } };
      return reply([{ type: "text", text: "recovered after the refusal" }]);
    };
    const r = await ask({ messages: [{ role: "user", content: "do the thing" }] });
    assert.equal(r.status, 200, "the turn recovered instead of failing");
    const j = await r.json();
    assert.equal(j.stop_reason, "end_turn");
    assert.match(text(j.content), /recovered after the refusal/);
    assert.equal(modelCalls, 2, "the refused round was retried exactly once");
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.match((rec.changes || []).join(" "), /refused for size/, "the record's changes say what happened");
    assert.match((rec.changes || []).join(" "), /retrying once/);
    assert.equal(rec.status, "ok", "a recovered refusal is a normal turn, not an error");
  });

  // (fails before: n/a — the fork is new; this pins its fallback)
  test("a fork that answers with a tool call writes no summary: the fold falls back to the transcript on the same writer", async () => {
    const setWindow = async (contextTokens) => {
      const st = await (await shim.api("/api/state")).json();
      const upstreams = st.config.upstreams.map((u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens } } } : u));
      await expectOk(await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams } }));
    };
    // Warm replies whose counts stay under the calibration's floor (see the fork test above).
    const cached = (blocks, stop) => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } });
    const lastText = (/** @type {any} */ m) => (Array.isArray(m?.content) ? m.content.filter((x) => x?.type === "text").map((x) => x.text).join("\n") : String(m?.content || ""));
    for (let i = 1; i <= 16; i++) writeFileSync(join(root, `big${i}.txt`), `MARKER-START ${"z".repeat(20000)}`);
    let round = 0;
    /** @type {string[]} */
    const kinds = [];
    /** @type {{ kind: string, body: any }[]} */
    const calls = [];
    brain = (call) => {
      const b = call.body;
      calls.push({ kind: sysOf(b).includes("compaction summaries") ? "transcript" : lastText(b.messages.at(-1)).includes("this turn has reached the compaction line") ? "fork" : "round", body: b });
      if (sysOf(b).includes("compaction summaries")) {
        kinds.push("transcript");
        return reply([{ type: "text", text: "TRANSCRIPT-SUMMARY: the big files were read." }], "end_turn");
      }
      if (lastText(b.messages.at(-1)).includes("this turn has reached the compaction line")) {
        kinds.push("fork");
        // Some words, then a tool call: the words are no summary — the model stopped to work, not to write it.
        return cached([{ type: "text", text: "LET-ME-LOOK-FIRST" }, toolUse("f1", "read", { path: "big1.txt" })], "tool_use");
      }
      kinds.push("round");
      round++;
      if (round <= 16) return cached([toolUse(`t${round}`, "read", { path: `big${round}.txt` })], "tool_use");
      return cached([{ type: "text", text: "done after the fallback" }], "end_turn");
    };
    await setWindow(80000);
    try {
      const r = await ask({ max_tokens: 8000, messages: [{ role: "user", content: "read big1.txt to big16.txt, then finish" }] });
      assert.match(text((await r.json()).content), /done after the fallback/);
      const at = kinds.indexOf("fork");
      assert.ok(at > 0, kinds.join(" "));
      assert.equal(kinds[at + 1], "transcript", "the transcript wrote the summary right after the fork declined");
      const after = calls.slice(at + 2).find((c) => c.kind === "round").body;
      assert.ok(JSON.stringify(after.messages).includes("TRANSCRIPT-SUMMARY"), "the transcript's summary replaced the rounds");
      assert.ok(!JSON.stringify(after.messages).includes("LET-ME-LOOK-FIRST"), "the fork's half-answer never became the summary");
      const rec = await shim.record(r.headers.get("x-filament-request-id"));
      assert.match((rec.changes || []).join(" "), /compacted rounds 1–\d+ of this turn at the compaction line, summarized by brain-model \(/, "the transcript's writer, not the cache");
    } finally {
      await setWindow(200000);
    }
  });

  // (fails before: n/a — the fork is new; this pins that the overflow door never takes it)
  test("the overflow recovery never forks: its conversation is the one the provider just refused, so the fold reads the transcript even with the cache warm", async () => {
    const cached = (blocks, stop) => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } });
    const lastText = (/** @type {any} */ m) => (Array.isArray(m?.content) ? m.content.filter((x) => x?.type === "text").map((x) => x.text).join("\n") : String(m?.content || ""));
    for (let i = 1; i <= 4; i++) writeFileSync(join(root, `small${i}.txt`), `small file ${i}`);
    let rounds = 0, forks = 0, transcripts = 0;
    /** @type {any} */
    let retried = null;
    brain = (call) => {
      if (sysOf(call.body).includes("compaction summaries")) {
        transcripts++;
        return reply([{ type: "text", text: "SUMMARY: the small files were read." }]);
      }
      if (lastText(call.body.messages.at(-1)).includes("this turn has reached the compaction line")) {
        forks++;
        return cached([{ type: "text", text: "FORK-SUMMARY" }], "end_turn");
      }
      rounds++;
      if (rounds <= 4) return cached([toolUse(`s${rounds}`, "read", { path: `small${rounds}.txt` })], "tool_use");
      if (rounds === 5) return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 99999 tokens > 5000 maximum" } } };
      retried = call.body;
      return cached([{ type: "text", text: "recovered without a fork" }], "end_turn");
    };
    const r = await ask({ messages: [{ role: "user", content: "read small1.txt to small4.txt" }] });
    assert.equal(r.status, 200);
    assert.match(text((await r.json()).content), /recovered without a fork/);
    assert.equal(forks, 0, "no fork of a conversation the provider refused for size");
    assert.equal(transcripts, 1, "the fold read the transcript");
    // (fails before: no — written with the files that come back after a fold (AH-D9 b); it pins the door that brings none)
    const sent = JSON.stringify(retried?.messages || []);
    assert.ok(sent.includes("SUMMARY: the small files were read."), "the retry carries the summary");
    assert.ok(!sent.includes("brought these back"), "and nothing after it: the provider just refused this conversation for size");
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.match((rec.changes || []).join(" "), /summarizing the oldest rounds into one/);
  });

  // (fails before: yes — the owner's plan of 11-02, Phase 4: the fold took the round that started a server, the overflow
  // recovery brought nothing back, and an agent past it started the server again)
  test("after the overflow fold the command the turn started comes back by its id as still open, and nothing else does", async () => {
    await setConfig({ permissions: "auto" });
    const long = SHELL.kind === "cmd" ? `node -e "setInterval(()=>{},1000)"` : "sleep 120";
    for (let i = 1; i <= 4; i++) writeFileSync(join(root, `open${i}.txt`), `open file ${i}`);
    let rounds = 0;
    let bgId = "";
    /** @type {any} */
    let retried = null;
    try {
      brain = (call) => {
        if (sysOf(call.body).includes("compaction summaries")) return reply([{ type: "text", text: "SUMMARY: a server was started and four files were read." }]);
        rounds++;
        if (rounds === 1) return reply([toolUse("bg1", "bash_background", { command: long })], "tool_use");
        if (rounds === 2) bgId = (/bg_[0-9a-z]+/.exec(String(lastResults(call.body.messages).at(-1)?.content || "")) || [""])[0];
        if (rounds <= 5) return reply([toolUse(`o${rounds}`, "read", { path: `open${rounds - 1}.txt` })], "tool_use");
        if (rounds === 6) return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 99999 tokens > 5000 maximum" } } };
        if (rounds === 7) {
          retried = call.body;
          return reply([toolUse("k1", "bash_kill", { id: bgId })], "tool_use");
        }
        return reply([{ type: "text", text: "the server was running already" }]);
      };
      const r = await ask({ messages: [{ role: "user", content: "start the dev server, then read open1.txt to open4.txt" }] });
      assert.equal(r.status, 200);
      assert.match(text((await r.json()).content), /the server was running already/);
      assert.ok(bgId, "the start told the model its id");
      const sent = JSON.stringify(retried?.messages || []);
      assert.ok(sent.includes("SUMMARY: a server was started"), "the retry carries the summary");
      assert.match(sent, new RegExp(`<open>\\\\n- background command ${bgId}: \`[^\`]+\` in [^,]+, running for \\d+ s \\[command:[^\\]]+\\]\\\\n</open>`), sent);
      assert.ok(!sent.includes("<file path="), "no file: the provider just refused this conversation for size");
    } finally {
      await setConfig({ permissions: "edit" });
    }
  });

  test("past the hard window the turn stops in words instead of uploading a doomed request", async () => {
    const setWindow = async (contextTokens) => {
      const st = await (await shim.api("/api/state")).json();
      const upstreams = st.config.upstreams.map((u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens } } } : u));
      const r = await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams } });
      await expectOk(r);
    };
    let modelCalls = 0;
    brain = (call) => {
      if (sysOf(call.body).includes("compaction summaries"))
        return reply([{ type: "text", text: "SUMMARY: the work so far." }]);
      modelCalls++;
      return reply([{ type: "text", text: "should never be reached" }]);
    };
    await setWindow(9000);
    try {
      // One message whose bulk alone (plus the system prompt and tools) is past the window: nothing to clear,
      // nothing to fold — the turn refuses locally, in words, with the sizes named.
      const r = await ask({ messages: [{ role: "user", content: `HUGE ${"h".repeat(60000)}` }] });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.match(text(j.content), /cannot make the request fit/);
      assert.match(text(j.content), /9,000-token/);
      assert.equal(modelCalls, 0, "no request was uploaded for the provider to refuse");
      const rec = await shim.record(r.headers.get("x-filament-request-id"));
      assert.equal(rec.status, "ok", "a stop in words is an answered turn, not an error record");
      assert.equal(rec.agent?.status, "stopped", "the agent bookkeeping names the stop");
      assert.match((rec.changes || []).join(" "), /cannot fit the 9,000-token window/);
    } finally {
      await setWindow(200000);
    }
  });

  // (fails before: yes — the next fold waited for 2,000 tokens of growth and nothing else: a turn begun just under its
  // line on a long history folded one round every round, each fold landing within a round of the line. Ten summarizer
  // calls in thirteen rounds in the live drive of 2026-10-12, 50 s each)
  test("a turn that begins just under its line on a long history folds once at the line, not every round; a fold that lands past the line stands the line down; at the window a fold is still asked for", async () => {
    const setWindow = async (/** @type {number} */ contextTokens) => {
      const st = await (await shim.api("/api/state")).json();
      const upstreams = st.config.upstreams.map((u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens } } } : u));
      await expectOk(await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams } }));
    };
    const WORDS = "harbor lantern maple quiet river stone ledger copper window meadow signal anchor paper winter garden bridge".split(" ");
    const words = (/** @type {number} */ chars, /** @type {number} */ from) => {
      let s = "";
      for (let i = from; s.length < chars; i++) s += `${WORDS[i % WORDS.length]} `;
      return s;
    };
    // Each read adds more than the 2,000 tokens the fold once waited for.
    for (let i = 1; i <= 8; i++) writeFileSync(join(root, `long${i}.txt`), `LONG-${i}: ${words(10000, i)}\n`);
    const startOf = async (/** @type {string} */ content) => {
      brain = () => reply([{ type: "text", text: "ok" }], "end_turn");
      const r = await ask({ messages: [{ role: "user", content }] });
      await expectOk(r);
      return Number((await eventsOf(r.headers.get("x-filament-request-id"))).find((e) => e.type === "round-start")?.context) || 0;
    };
    const WINDOW = 60000;
    const LINE = Math.floor(WINDOW * 0.85);
    await setWindow(WINDOW);
    try {
      const bare = await startOf("x");
      const perChar = ((await startOf(words(8000, 0))) - bare) / 8000;
      assert.ok(bare > 0 && perChar > 0 && bare < WINDOW * 0.5, `the loop measured its own start: ${bare}`);
      /**
       * One turn that begins at `share` of the window, on words the turn cannot fold, and reads `reads` long notes.
       * @param {number} share @param {number} reads
       */
      const turn = async (share, reads) => {
        const filler = words(Math.round((WINDOW * share - bare) / perChar), 3);
        let round = 0;
        let summaries = 0;
        brain = (call) => {
          if (sysOf(call.body).includes("compaction summaries")) {
            summaries++;
            return reply([{ type: "text", text: "SUMMARY: the long notes were read one by one." }], "end_turn");
          }
          round++;
          if (round <= reads) return reply([toolUse(`l${round}`, "read", { path: `long${round}.txt` })], "tool_use");
          return reply([{ type: "text", text: "done after the long notes" }], "end_turn");
        };
        const r = await ask({ messages: [{ role: "user", content: `${filler}\nNow read long1.txt to long${reads}.txt, one at a time.` }] });
        assert.equal(r.status, 200);
        const j = await r.json();
        assert.match(text(j.content), /done after the long notes/, JSON.stringify(j).slice(0, 400));
        const evts = await eventsOf(r.headers.get("x-filament-request-id"));
        const fixed = Number(evts.find((e) => e.type === "window")?.fixed) || 0;
        return {
          // Each fold with what the request weighed as it was asked for and as it landed: the prompt and tools counted.
          folds: evts.filter((e) => e.type === "compaction" && e.toRound).map((e) => ({ before: e.tokensBefore + fixed, after: e.tokensAfter + fixed })),
          marks: evts.filter((e) => e.type === "compaction").map((e) => (e.stoodDown ? "down" : e.toRound ? "fold" : "other")),
          summaries,
          last: Number(evts.filter((e) => e.type === "round-start").at(-1)?.context) || 0,
          changes: ((await shim.record(r.headers.get("x-filament-request-id"))).changes || []).join(" "),
        };
      };
      // 79% of the window, four reads: the line (85%) is crossed after the second, the fold lands just under it, and
      // the two reads after it grow the turn by far less than the room a compaction is for (the line less the
      // 40% target, 27,000 tokens). The window is not reached.
      const under = await turn(0.79, 4);
      assert.equal(under.folds.length, 1, `one fold at the line, not one a round: ${JSON.stringify(under.folds)}`);
      assert.equal(under.summaries, 1, "one summarizer call in the turn");
      assert.ok(under.folds[0].before >= LINE && under.folds[0].after < LINE, JSON.stringify(under.folds));
      assert.deepEqual(under.marks, ["fold"], "it landed under the line: nothing stood down");
      assert.ok(under.last > LINE && under.last < WINDOW, `the turn went on whole past the line: ${under.last}`);
      // 84.8% of the window: the one fold lands past the line still, and the line stands down, saying why.
      const pinned = await turn(0.848, 3);
      assert.deepEqual(pinned.marks, ["fold", "down"]);
      assert.ok(pinned.folds[0].after >= LINE, JSON.stringify(pinned.folds));
      assert.match(pinned.changes, /folding this turn's rounds left the conversation at ≈[\d,]+ tokens, still past the 51,000-token compaction line \(the rest is the earlier turns', out of this turn's reach\); standing down for the rest of this turn — the next message makes room in the whole session/);
      // (fails before: no — a guard for the rule above: with the line stood down, a turn that reached its window ended
      // there unless a fold is still asked for at the window itself) The same start and eight reads, more than the
      // window holds whole: after the line's fold each fold waits for the window, and the turn ends done.
      const edge = await turn(0.848, 8);
      assert.deepEqual(edge.marks.slice(0, 2), ["fold", "down"]);
      const later = edge.folds.slice(1);
      assert.ok(later.length >= 1, "a fold was asked for again, at the window");
      assert.ok(later.every((f) => f.before > WINDOW), `each only once the request no longer fitted the window: ${JSON.stringify(later)}`);
      assert.equal(edge.marks.filter((m) => m === "down").length, 1, "the line stood down once");
    } finally {
      await setWindow(200000);
    }
  });

  test("a compaction that saves almost nothing stands the machinery down for the rest of the turn", async () => {
    // The window event and the record's context stamp ride the same turn: window, source, usable, fixed.
    const setWindow = async (contextTokens) => {
      const st = await (await shim.api("/api/state")).json();
      const upstreams = st.config.upstreams.map((u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens } } } : u));
      const r = await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams } });
      await expectOk(r);
    };
    writeFileSync(join(root, "spam.txt"), `MARKER-START ${"z".repeat(20000)}`);
    let round = 0;
    let compactions = 0;
    brain = (call) => {
      if (sysOf(call.body).includes("compaction summaries")) {
        compactions++;
        // A summary as heavy as the bulk it replaces: the fold saves nothing, and the spam guard must stand
        // the machinery down instead of paying this summarizer call every remaining round.
        return reply([{ type: "text", text: "S".repeat(40000) }]);
      }
      round++;
      if (round <= 5) return reply([toolUse(`t${round}`, "read", { path: "spam.txt" })], "tool_use");
      return reply([{ type: "text", text: "done after the guard" }], "end_turn");
    };
    // Five reads of the spam overrun this window and the heavy summary still fits it beside the loop's furniture (its
    // prompt, tools and Environment), which grew with the tools (HarnessV3-Tools): 35,000 left the summary ~240 short,
    // and 37,000 ~220 short once the agent tool took its model fields (HarnessV4_Tasks E23); 38,000 ~250 short once the
    // Space's tool rode in every project's chat from its first message (team_v2_plan TV2-D7); 39,000 until its drafts
    // (HarnessV4_Space_Plan S5c); 39,500 until its repro (S7); 40,000, under 100 short, until the checklist's task and
    // the tools' words of version 120; 40,500 until the shell tools' sentence on the filtered environment (version 123);
    // 41,000 until the agent tools' attach (version 127).
    const WINDOW = 41500;
    await setWindow(WINDOW);
    try {
      const r = await ask({ messages: [{ role: "user", content: "read spam.txt over and over, then finish" }] });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.stop_reason, "end_turn");
      assert.match(text(j.content), /done after the guard/);
      assert.equal(compactions, 1, "the summarizer ran once, then the guard stood it down");
      const rec = await shim.record(r.headers.get("x-filament-request-id"));
      assert.match((rec.changes || []).join(" "), /standing down for the rest of this turn/, "the stand-down is said in words");
      assert.ok(rec.context, "the parent record carries the context stamp");
      assert.equal(rec.context.window, WINDOW);
      assert.equal(rec.context.source, "operator", "the window came from its upstream's model card");
      assert.equal(rec.context.usable, Math.floor(WINDOW * 0.85), "the line is the percentage of the window");
      assert.ok(rec.context.estimate > 0, "the start-of-turn estimate is on the same scale the edge measures");
      const evts = await eventsOf(r.headers.get("x-filament-request-id"));
      const win = evts.find((e) => e.type === "window");
      assert.ok(win, "the run's timeline carries the window event");
      assert.equal(win.window, WINDOW);
      assert.equal(win.source, "operator");
      assert.ok(win.fixed > 0, "the furniture's cost is named");
      assert.equal(evts.filter((e) => e.type === "compacting").length, 1, "one compacting, then the guard");
    } finally {
      await setWindow(200000);
      rmSync(join(root, "spam.txt"), { force: true });
    }
  });

  test("permission modes: edit lets a write through and asks for bash; the pause ends the reply with the question; yes resumes and runs it; a refusal reaches the model in the developer's words", async () => {
    const sess = H();
    let round = 0;
    /** @type {any[]} */
    const seen = [];
    // Commands that do more than read (HarnessV3-Launch LD-D11: in Edit mode `echo` runs without asking).
    brain = (call) => {
      round++;
      seen.push(call.body.messages);
      if (round === 1) return reply([{ type: "text", text: "Writing, then testing." }, toolUse("w1", "write", { path: "b.txt", content: "b" }), toolUse("c1", "bash", { command: `node -e "console.log('hello-from-bash')"` })], "tool_use");
      if (round === 2) {
        const res = lastResults(call.body.messages);
        assert.equal(res.length, 2, "the parked write result and the command's result ride together");
        assert.equal(res[0].tool_use_id, "w1");
        assert.equal(res[1].tool_use_id, "c1");
        assert.match(res[1].content, /hello-from-bash/);
        return reply([toolUse("c2", "bash", { command: `node -e "console.log('second')"` })], "tool_use");
      }
      const res = lastResults(call.body.messages);
      assert.equal(res[0].is_error, true);
      assert.match(res[0].content, /the developer declined — "no, that one is dangerous"/);
      return reply([{ type: "text", text: "Understood, skipped it." }]);
    };
    up.reset();
    const r1 = await ask({ messages: [{ role: "user", content: "write and test" }] }, sess);
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.content.length, 2, "the round's text, then the question");
    assert.match(j1.content[1].text, /May I run this command\? `node -e "console\.log\('hello-from-bash'\)"`/);
    assert.equal(existsSync(join(root, "b.txt")), true, "the write ran free in edit mode before the pause");
    let evts = await eventsOf(r1.headers.get("x-filament-request-id"));
    const askEvt = evts.find((e) => e.type === "ask");
    assert.equal(askEvt.kind, "permission");
    assert.equal(askEvt.tool, "bash");
    assert.equal(evts.at(-1).status, "paused");
    assert.equal(round, 1, "the model was not called again while waiting");
    // The developer says yes: the command runs, the loop continues with the same conversation.
    const r2 = await ask({ messages: [{ role: "user", content: "write and test" }, { role: "assistant", content: j1.content }, { role: "user", content: "/allow" }] }, sess);
    assert.equal(r2.status, 200);
    const j2 = await r2.json();
    assert.match(j2.content.at(-1).text, /May I run this command\? `node -e "console\.log\('second'\)"`/);
    assert.equal(round, 2);
    assert.ok(seen[1].some((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((c) => c.id === "w1")), "the resumed conversation is the parked one");
    // The developer refuses in their own words.
    const r3 = await ask({ messages: [{ role: "user", content: "write and test" }, { role: "assistant", content: j1.content }, { role: "user", content: "/allow" }, { role: "assistant", content: j2.content }, { role: "user", content: "no, that one is dangerous" }] }, sess);
    assert.equal(r3.status, 200);
    const j3 = await r3.json();
    assert.equal(text(j3.content), "Understood, skipped it.");
    evts = await eventsOf(r3.headers.get("x-filament-request-id"));
    assert.ok(evts.some((e) => e.type === "tool-end" && e.name === "bash" && e.declined === true), "the refusal is on the timeline");
    const rec = await shim.record(r3.headers.get("x-filament-request-id"));
    assert.ok(rec.changes.some((c) => /resumed after the developer answered/.test(c)));
  });

  test("read-only refuses a write in words though every hand is offered; ask asks for a write; auto asks for nothing", async () => {
    await setConfig({ permissions: "read-only" });
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) {
        // The mode never shapes the tool list: read-only offers the writing hands too, and the gate refuses them.
        assert.deepEqual(call.body.tools.map((t) => t.name), ["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", ...PS, "grep", "glob", "lsp", "ask", "plan", "agent", "wait", "envelope", "delegate_read", "filament_recall"]);
        assert.match(sysOf(call.body), /Tools run behind the developer's permission mode/);
        return reply([toolUse("w", "write", { path: "c.txt", content: "c" })], "tool_use");
      }
      const res = lastResults(call.body.messages);
      assert.equal(res[0].is_error, true);
      assert.match(res[0].content, /this session is read-only, so write is not available/);
      return reply([{ type: "text", text: "I would create c.txt with 'c'." }]);
    };
    up.reset();
    let r = await ask({ messages: [{ role: "user", content: "write c" }] });
    assert.equal(r.status, 200);
    assert.equal(existsSync(join(root, "c.txt")), false, "nothing was written");
    let evts = await eventsOf(r.headers.get("x-filament-request-id"));
    assert.ok(evts.some((e) => e.type === "tool-end" && e.refused === true));
    // ask: a write pauses on a question.
    await setConfig({ permissions: "ask" });
    round = 0;
    brain = () => reply([toolUse("w", "write", { path: "d.txt", content: "d" })], "tool_use");
    r = await ask({ messages: [{ role: "user", content: "write d" }] });
    const j = await r.json();
    assert.match(text(j.content), /May I write d\.txt\?/);
    assert.equal(existsSync(join(root, "d.txt")), false);
    // auto: bash runs without asking.
    await setConfig({ permissions: "auto" });
    round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("c", "bash", { command: "echo auto-ran" })], "tool_use");
      assert.match(lastResults(call.body.messages)[0].content, /auto-ran/);
      return reply([{ type: "text", text: "ran" }]);
    };
    r = await ask({ messages: [{ role: "user", content: "run it" }] });
    assert.equal(text((await r.json()).content), "ran");
    evts = await eventsOf(r.headers.get("x-filament-request-id"));
    assert.ok(!evts.some((e) => e.type === "ask"), "nothing asked");
    const ran = evts.find((e) => e.type === "tool-end" && e.name === "bash");
    assert.equal(ran.exitCode, 0, "the shell's exit code rides tool-end");
    assert.match(ran.preview, /auto-ran/);
    await setConfig({ permissions: "edit" });
  });

  test("tool previews: a failing command carries its exit code and output head; the preview is clipped at observability.runEvents.toolPreviewChars and 0 carries none", async () => {
    await setConfig({ permissions: "auto" });
    const setPreview = async (n) => {
      const st = await (await shim.api("/api/state")).json();
      await expectOk(await shim.api("/api/config", { method: "PUT", body: { ...st.config, observability: { ...st.config.observability, runEvents: { ...st.config.observability.runEvents, toolPreviewChars: n } } } }));
    };
    writeFileSync(join(root, "long.txt"), Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
    const fail = SHELL.kind === "cmd" ? "echo boom & exit /b 3" : "echo boom; exit 3";
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("c", "bash", { command: fail }), toolUse("r", "read", { path: "long.txt" })], "tool_use");
      const res = lastResults(call.body.messages);
      assert.equal(res[0].is_error, true);
      return reply([{ type: "text", text: "saw it" }]);
    };
    try {
      await setPreview(40);
      let r = await ask({ messages: [{ role: "user", content: "fail on purpose" }] });
      assert.equal(text((await r.json()).content), "saw it");
      let ends = (await eventsOf(r.headers.get("x-filament-request-id"))).filter((e) => e.type === "tool-end");
      const sh = ends.find((e) => e.name === "bash");
      assert.equal(sh.ok, false);
      assert.equal(sh.exitCode, 3);
      assert.match(sh.preview, /boom/);
      const rd = ends.find((e) => e.name === "read");
      assert.ok(rd.chars > 40, "the result is longer than the preview");
      assert.match(rd.preview, /^ {5}1\tline 1\n {5}2\tline 2/);
      assert.match(rd.preview, new RegExp(`\\[Filament: preview cut at 40 of ${rd.chars} characters\\]$`), "the cut is marked, with the whole size");
      assert.ok(!("exitCode" in rd));
      await setPreview(0);
      round = 0;
      r = await ask({ messages: [{ role: "user", content: "again" }] });
      assert.equal(text((await r.json()).content), "saw it");
      ends = (await eventsOf(r.headers.get("x-filament-request-id"))).filter((e) => e.type === "tool-end");
      assert.ok(ends.every((e) => !("preview" in e)), "0 carries no preview");
      assert.equal(ends.find((e) => e.name === "bash").exitCode, 3, "the exit code is not a preview");
    } finally {
      await setPreview(2000);
      await setConfig({ permissions: "edit" });
    }
  });

  // (fails before: there was no powershell hand — HarnessV3-Tools TL-D4 — and the loop's command sites knew bash alone)
  test("the powershell hand runs like bash: edit mode asks in its own words; run, its output streams to the card and its exit code is the card's", { skip: !POWERSHELL && "no PowerShell on this machine" }, async () => {
    let round = 0;
    let result = null;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("p1", "powershell", { command: "'from-ps héllo'\nexit 4" })], "tool_use");
      result = lastResults(call.body.messages)[0];
      return reply([{ type: "text", text: "ps seen" }]);
    };
    try {
      await setConfig({ permissions: "edit" });
      let r = await ask({ messages: [{ role: "user", content: "run it" }] });
      assert.match(text((await r.json()).content), /May I run this PowerShell script\? `'from-ps héllo' exit 4`/, "a command asks in edit mode, in PowerShell's words");
      await setConfig({ permissions: "auto" });
      round = 0;
      r = await ask({ messages: [{ role: "user", content: "run it" }] });
      assert.equal(text((await r.json()).content), "ps seen");
      assert.equal(result?.is_error, true);
      assert.match(JSON.stringify(result?.content), /from-ps héllo[\s\S]*Command exited with code 4/, "UTF-8 output and the exit code reach the model");
      const evts = await eventsOf(r.headers.get("x-filament-request-id"));
      const end = evts.find((e) => e.type === "tool-end" && e.name === "powershell");
      assert.equal(end?.exitCode, 4, "the card's exit code");
      assert.ok(evts.some((e) => e.type === "tool-output" && e.id === "p1" && e.text.includes("from-ps")), "the output streamed to the card as it ran");
    } finally {
      await setConfig({ permissions: "edit" });
    }
  });

  test("the request is mode-invariant: all four permission modes send the same system prompt and the same tools", async () => {
    const seen = [];
    brain = (call) => {
      seen.push([sysOf(call.body), call.body.tools]);
      return reply([{ type: "text", text: "ok" }]);
    };
    up.reset();
    for (const mode of ["read-only", "edit", "ask", "auto"]) {
      await setConfig({ permissions: mode });
      const r = await ask({ messages: [{ role: "user", content: "hi" }] });
      assert.equal(r.status, 200);
    }
    await setConfig({ permissions: "edit" });
    assert.equal(seen.length, 4);
    for (const [system, tools] of seen.slice(1)) {
      assert.deepEqual(system, seen[0][0], "the system prompt is the same bytes in every mode");
      assert.deepEqual(tools, seen[0][1], "the tools array is the same in every mode");
    }
    assert.match(seen[0][0], /Tools run behind the developer's permission mode/);
  });

  test("x-filament-permissions on the request overrides agentLoop.permissions for that turn", async () => {
    await setConfig({ permissions: "edit" });
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) {
        assert.deepEqual(call.body.tools.map((t) => t.name), ["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", ...PS, "grep", "glob", "lsp", "ask", "plan", "agent", "wait", "envelope", "delegate_read", "filament_recall"]);
        assert.match(sysOf(call.body), /Tools run behind the developer's permission mode/);
        return reply([toolUse("w", "write", { path: "header.txt", content: "no" })], "tool_use");
      }
      const res = lastResults(call.body.messages);
      assert.equal(res[0].is_error, true);
      return reply([{ type: "text", text: "refused under the header." }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "write it" }] }, H({ "x-filament-permissions": "read-only" }));
    assert.equal(r.status, 200);
    assert.equal(existsSync(join(root, "header.txt")), false);
    const evts = await eventsOf(r.headers.get("x-filament-request-id"));
    assert.ok(evts.some((e) => e.type === "tool-end" && e.refused === true));
    await setConfig({ permissions: "edit" });
  });

  test("the model's own question pauses the turn and the next message is its answer; the plan tool publishes the checklist as an event", async () => {
    const sess = H();
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1)
        return reply(
          [
            toolUse("p1", "plan", { items: [{ text: "decide the name", status: "doing" }, { text: "write it", status: "pending" }] }),
            toolUse("q1", "ask", { question: "Should the file be called x or y? I recommend x." }),
          ],
          "tool_use",
        );
      const res = lastResults(call.body.messages);
      assert.equal(res.length, 2);
      assert.match(res[0].content, /Plan recorded: 2 items/);
      assert.equal(res[1].tool_use_id, "q1");
      assert.equal(res[1].content, "call it y");
      return reply([{ type: "text", text: "y it is." }]);
    };
    up.reset();
    const r1 = await ask({ messages: [{ role: "user", content: "start" }] }, sess);
    const j1 = await r1.json();
    assert.equal(text(j1.content), "Should the file be called x or y? I recommend x.");
    const evts = await eventsOf(r1.headers.get("x-filament-request-id"));
    const plan = evts.find((e) => e.type === "plan");
    assert.deepEqual(plan.items, [{ text: "decide the name", status: "doing" }, { text: "write it", status: "pending" }]);
    assert.equal(evts.find((e) => e.type === "ask").kind, "question");
    const r2 = await ask({ messages: [{ role: "user", content: "start" }, { role: "assistant", content: j1.content }, { role: "user", content: "call it y" }] }, sess);
    assert.equal(text((await r2.json()).content), "y it is.");
  });

  // (fails before: yes — the options were dropped: the run's ask carried the question only, the reply named none)
  test("a question with options (TL-D11): the run's ask carries them for the harness, the reply lists them for any client, and a chosen label is the answer", async () => {
    const sess = H();
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1)
        return reply(
          [
            toolUse("q1", "ask", {
              question: "Which name for the file?",
              options: [
                { label: "notes.md (recommended)", description: "matches the other files" },
                { label: "NOTES.txt", description: "what the old script expects" },
              ],
            }),
          ],
          "tool_use",
        );
      const res = lastResults(call.body.messages);
      assert.equal(res[0].tool_use_id, "q1");
      assert.equal(res[0].content, "notes.md (recommended)", "the chosen label is the answer, as it was sent");
      return reply([{ type: "text", text: "notes.md it is." }]);
    };
    up.reset();
    const r1 = await ask({ messages: [{ role: "user", content: "start" }] }, sess);
    const j1 = await r1.json();
    assert.equal(
      text(j1.content),
      "Which name for the file?\n\n1. notes.md (recommended) — matches the other files\n2. NOTES.txt — what the old script expects\n\nAnswer with one of these, or in your own words.",
    );
    const evt = (await eventsOf(r1.headers.get("x-filament-request-id"))).find((e) => e.type === "ask");
    assert.equal(evt.question, "Which name for the file?", "the harness draws the question and the choices apart");
    assert.deepEqual(evt.options, [
      { label: "notes.md (recommended)", description: "matches the other files" },
      { label: "NOTES.txt", description: "what the old script expects" },
    ]);
    const r2 = await ask({ messages: [{ role: "user", content: "start" }, { role: "assistant", content: j1.content }, { role: "user", content: "notes.md (recommended)" }] }, sess);
    assert.equal(text((await r2.json()).content), "notes.md it is.");
  });

  // (fails before: yes — a picture attached while a turn ran waited for the turn's end: the run's mailbox took words
  // only, so the model never saw the screenshot while it could still act on it)
  test("a picture sent while the loop works reaches the model at the next round boundary, after the words it came with; the run's log names it without its bytes", async () => {
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    let round = 0;
    /** @type {any} */
    const saw = {};
    brain = async (call) => {
      round++;
      if (round === 1) {
        const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
        const live = runs.find((/** @type {any} */ x) => x.status === "running");
        saw.meta = live?.meta;
        /** @param {any} body */
        const send = async (body) => {
          const res = await shim.api(`/api/runs/${live?.id}/steer`, { method: "POST", body: { kind: "note", from: "harness", ...body } });
          return [res.status, await res.json()];
        };
        saw.withWords = await send({ text: "the button is the red one here", images: [{ name: "shot.png", mediaType: "image/png", data: PNG }] });
        saw.bare = await send({ text: "", images: [{ name: "two.png", mediaType: "image/png", data: PNG }] });
        saw.noPicture = await send({ text: "x", images: [{ name: "a.txt", mediaType: "text/plain", data: PNG }] });
        return reply([toolUse("r1", "read", { path: "notes/a.txt" })], "tool_use");
      }
      saw.last ??= call.body.messages.at(-1);
      return reply([{ type: "text", text: "Seen: the red one." }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "go" }] });
    assert.equal(saw.meta?.steerImages, true, "the session's own turn says it reads pictures");
    // Each kept beside the run's log, named by its ref (V4-D303; transcript-pictures.test.js draws it).
    const named = (/** @type {any[]} */ list) => list.map(({ ref, ...p }) => (assert.match(String(ref), /^[0-9a-f]{32}\.png$/), p));
    assert.deepEqual([saw.withWords[0], named(saw.withWords[1].message?.images || [])], [200, [{ name: "shot.png", mediaType: "image/png", bytes: 70 }]], JSON.stringify(saw.withWords));
    assert.equal(saw.bare[0], 200, "a picture needs no words");
    assert.deepEqual([saw.noPicture[0], saw.noPicture[1].error], [400, "image 1 is no picture: its mediaType must be an image's (image/png, image/jpeg…)"]);
    assert.deepEqual(saw.last.content.map((/** @type {any} */ b) => b.type), ["tool_result", "text", "image", "image"], "results, then the words, then the pictures in the order sent");
    assert.equal(
      saw.last.content[1].text,
      "Message from the developer, relayed by Filament (2 messages). Acknowledge what you heard in your next reply before acting on it:\n- the button is the red one here [with a picture, after these messages, in the order sent]\n- (no words) [with a picture, after these messages, in the order sent]",
    );
    for (const b of saw.last.content.slice(2)) assert.deepEqual(b.source, { type: "base64", media_type: "image/png", data: PNG });
    assert.equal(text((await r.json()).content), "Seen: the red one.");
    const events = await eventsOf(r.headers.get("x-filament-request-id"));
    assert.deepEqual(events.filter((/** @type {any} */ e) => e.type === "steer").map((/** @type {any} */ e) => named(e.images)), [[{ name: "shot.png", mediaType: "image/png", bytes: 70 }], [{ name: "two.png", mediaType: "image/png", bytes: 70 }]]);
    assert.ok(!JSON.stringify(events).includes(PNG), "no event carries the picture's bytes");
    const rec = await shim.record(String(r.headers.get("x-filament-request-id")));
    assert.ok((rec.changes || []).includes("agent: 2 steering message(s) delivered at the round boundary, with 2 pictures"), (rec.changes || []).join("\n"));
  });

  // (fails before: yes — found in stage C's live drive on a model that reads text only: the round the picture rode
  // was refused, the turn failed there, and the work kept of it held the picture, so the session's later turns
  // failed the same way)
  test("a picture sent into a turn whose model reads none: the round goes again without it, the refusal quoted; the run says which message lost its picture, and a later one goes as words", async () => {
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const refusal = "messages.content.type is invalid, allowed values: ['text']";
    let calls = 0;
    /** @type {any} */
    const saw = { imagesLater: false };
    /** @param {string} text */
    const send = async (text) => {
      const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
      const live = runs.find((/** @type {any} */ x) => x.status === "running");
      const res = await shim.api(`/api/runs/${live?.id}/steer`, { method: "POST", body: { kind: "note", from: "harness", text, images: [{ name: "shot.png", mediaType: "image/png", data: PNG }] } });
      return (await res.json()).message?.id;
    };
    brain = async (call) => {
      calls++;
      const last = call.body.messages.at(-1);
      if (calls === 1) {
        saw.first = await send("look at this");
        return reply([toolUse("r1", "read", { path: "notes/a.txt" })], "tool_use");
      }
      if (calls === 2) {
        saw.tried = last.content.map((/** @type {any} */ b) => b.type);
        return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: refusal } } };
      }
      saw.imagesLater ||= JSON.stringify(call.body.messages).includes(PNG);
      if (calls === 3) {
        saw.again = last.content;
        saw.second = await send("and this");
        return reply([toolUse("r2", "read", { path: "notes/a.txt" })], "tool_use");
      }
      saw.later ??= last.content;
      return reply([{ type: "text", text: "No picture reached me." }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "go" }] });
    assert.deepEqual(saw.tried, ["tool_result", "text", "image"], "the first try carries the picture");
    assert.deepEqual(saw.again.map((/** @type {any} */ b) => b.type), ["tool_result", "text", "text"], "the round again, the picture's place taken by words");
    assert.equal(saw.again[2].text, `[the image was not sent: the provider refused the request with it: "${refusal}"]`);
    assert.match(saw.again[1].text, /- look at this \[with a picture, after these messages\]$/, "the developer's words stay as sent");
    assert.deepEqual(saw.later.map((/** @type {any} */ b) => b.type), ["tool_result", "text"], "a later picture of the turn is not sent");
    assert.match(saw.later[1].text, /- and this \[with a picture, not sent: this turn's provider refused a request with images\]$/);
    assert.equal(saw.imagesLater, false, "no request after the refusal carries the picture");
    assert.equal(text((await r.json()).content), "No picture reached me.", "the turn goes on to its answer");
    assert.equal(calls, 4);
    const events = await eventsOf(r.headers.get("x-filament-request-id"));
    assert.deepEqual(events.filter((/** @type {any} */ e) => e.type === "steer-pictures").map((/** @type {any} */ e) => [e.ids, e.refused]), [[[saw.first], refusal], [[saw.second], refusal]], "the run names the messages whose pictures did not reach the model, with the provider's words");
    const rec = await shim.record(String(r.headers.get("x-filament-request-id")));
    const changes = (rec.changes || []).join("\n");
    assert.ok(changes.includes(`agent: round 2 was refused with 1 image the developer sent while the turn ran (${refusal}) — retrying once without it; the turn's later images are sent as words`), changes);
    assert.ok(changes.includes("agent: 1 steering message(s) delivered at the round boundary, its picture not sent (the provider refused images this turn)"), changes);
  });

  test("interrupt-and-redirect: a message typed while the loop works lands at the next round boundary, after the tool results, never mid-tool", async () => {
    let round = 0;
    brain = async (call) => {
      round++;
      if (round === 1) {
        // The developer types while the model is still deciding: the note queues on the run.
        const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
        const live = runs.find((x) => x.status === "running");
        assert.ok(live);
        const s = await shim.api(`/api/runs/${live.id}/steer`, { method: "POST", body: { kind: "note", text: "use the notes folder", from: "chat" } });
        assert.equal(s.status, 200);
        return reply([toolUse("r1", "read", { path: "notes/a.txt" })], "tool_use");
      }
      const last = call.body.messages.at(-1);
      assert.equal(last.role, "user");
      assert.equal(last.content[0].type, "tool_result", "results first");
      assert.equal(last.content.at(-1).type, "text");
      assert.match(last.content.at(-1).text, /Message from the developer, relayed by Filament \(1 message\)[\s\S]*- use the notes folder/);
      return reply([{ type: "text", text: "Heard: notes folder." }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "go" }] });
    assert.equal(text((await r.json()).content), "Heard: notes folder.");
    const types = (await eventsOf(r.headers.get("x-filament-request-id"))).map((e) => e.type);
    // The note arrived before the tool ran (read at the pre-tools check), and was still delivered after the results.
    assert.ok(types.indexOf("steer") < types.indexOf("tool-start") && types.indexOf("steer-read") < types.indexOf("tool-start"), types.join(","));
  });

  test("veto and stop typed while the model decides act before the tools run: a veto refuses the round's calls in words, a stop ends the turn", async () => {
    let round = 0;
    const steerLive = async (kind, textMsg) => {
      const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
      const live = runs.find((x) => x.status === "running");
      assert.ok(live);
      const s = await shim.api(`/api/runs/${live.id}/steer`, { method: "POST", body: { kind, text: textMsg, from: "chat" } });
      assert.equal(s.status, 200);
    };
    brain = async (call) => {
      round++;
      if (round === 1) {
        await steerLive("veto", "not the notes, look at src");
        return reply([toolUse("v1", "write", { path: "notes/x.txt", content: "NEVER-WRITTEN" }), toolUse("v2", "read", { path: "notes/a.txt" })], "tool_use");
      }
      const last = call.body.messages.at(-1);
      assert.equal(last.content.length, 2, "both refusals, no steering block: the veto is the results");
      assert.equal(last.content[0].is_error, true);
      assert.match(last.content[0].content, /Not run: the developer objected before it ran — "not the notes, look at src"/);
      assert.equal(last.content[1].tool_use_id, "v2");
      await steerLive("stop", "enough");
      return reply([toolUse("v3", "read", { path: "notes/a.txt" })], "tool_use");
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "go" }] });
    const j = await r.json();
    assert.match(text(j.content), /the developer stopped this turn after 0 tool calls — "enough"/);
    assert.ok(!existsSync(join(root, "notes", "x.txt")), "nothing vetoed ran");
    const evts = await eventsOf(r.headers.get("x-filament-request-id"));
    const vetoed = evts.find((e) => e.type === "vetoed");
    assert.deepEqual({ round: vetoed.round, tasks: vetoed.tasks, text: vetoed.text }, { round: 1, tasks: 2, text: "not the notes, look at src" });
    assert.equal(evts.filter((e) => e.type === "tool-end" && e.vetoed).length, 2);
    assert.ok(!evts.some((e) => e.type === "tool-start" && e.id === "v3"), "the stop landed before round 2's tool ran");
    assert.equal(evts.at(-1).summary.rounds, 2);
    assert.equal(evts.at(-1).status, "stopped");
  });

  // (fails before: the round answered with text only, the turn ended, and the note died unread — the developer's
  // message never reached the model; HarnessV3-CodebasePass decision 3)
  test("a message typed while the model writes its final reply is heard: the turn goes one more round with it", async () => {
    let round = 0;
    /** @type {any} */
    let second = null;
    const steerLive = async (kind, textMsg) => {
      const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
      const live = runs.find((x) => x.status === "running");
      assert.ok(live);
      const s = await shim.api(`/api/runs/${live.id}/steer`, { method: "POST", body: { kind, text: textMsg, from: "chat" } });
      assert.equal(s.status, 200);
    };
    brain = async (call) => {
      round++;
      if (round === 1) {
        await steerLive("note", "also mention the tests");
        await steerLive("veto", "not in bullet points");
        return reply([{ type: "text", text: "All done: the file is written." }]);
      }
      second = call.body;
      return reply([{ type: "text", text: "Heard: the tests pass too, said in prose." }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "go" }] });
    const j = await r.json();
    assert.match(text(j.content), /Heard: the tests pass too/);
    assert.equal(round, 2, "one more round, for the message");
    const msgs = second.messages;
    assert.deepEqual(msgs.at(-2).content, [{ type: "text", text: "All done: the file is written." }], "the reply the message came after stays in the conversation");
    const said = msgs.at(-1).content.at(-1).text;
    assert.match(said, /Message from the developer, relayed by Filament \(2 messages\)/);
    assert.match(said, /- also mention the tests/);
    assert.match(said, /- \(objection, arrived after your reply\) not in bullet points/, "a veto after a reply with no tool calls objects to the reply");
    const evts = await eventsOf(r.headers.get("x-filament-request-id"));
    assert.deepEqual(evts.filter((e) => e.type === "steer-read").flatMap((e) => e.kinds), ["note", "veto"], "both read");
    assert.ok(!evts.some((e) => e.type === "steer-unread"), "nothing left unread");
    assert.equal(evts.at(-1).status, "done");
    assert.equal(evts.at(-1).summary.rounds, 2);
  });

  test("a stop typed while the model writes its final reply still ends the turn as stopped, with no extra round", async () => {
    let round = 0;
    brain = async () => {
      round++;
      const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
      const live = runs.find((x) => x.status === "running");
      await shim.api(`/api/runs/${live.id}/steer`, { method: "POST", body: { kind: "note", text: "and one more thing", from: "chat" } });
      await shim.api(`/api/runs/${live.id}/steer`, { method: "POST", body: { kind: "stop", text: "enough", from: "chat" } });
      return reply([{ type: "text", text: "Finished." }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "go" }] });
    await r.json();
    assert.equal(round, 1, "no round for a message that came with a stop");
    const evts = await eventsOf(r.headers.get("x-filament-request-id"));
    assert.equal(evts.at(-1).status, "stopped");
    assert.ok(evts.some((e) => e.type === "steer-unread" && e.kinds.includes("note")), "the note that came with the stop is said unread, never heard");
  });

  // (fails before: yes — the empty reply went into the conversation as `content: []`, which the next request carried;
  // the API refuses it: "all messages must have non-empty content except for the optional final assistant message")
  test("a model that ends a round with nothing, while a message waits, goes one more round on a request the API takes", async () => {
    let round = 0;
    /** @type {any} */
    let second = null;
    brain = async (call) => {
      round++;
      if (round === 1) {
        const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
        const live = runs.find((/** @type {any} */ x) => x.status === "running");
        await shim.api(`/api/runs/${live.id}/steer`, { method: "POST", body: { kind: "note", text: "and say hello", from: "chat" } });
        return reply([]);
      }
      second = call.body;
      return reply([{ type: "text", text: "Hello." }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "go" }] });
    assert.equal(text((await r.json()).content), "Hello.");
    assert.equal(round, 2);
    const empty = second.messages.filter((/** @type {any} */ m) => Array.isArray(m.content) && !m.content.some((/** @type {any} */ b) => b.type !== "text" || b.text));
    assert.deepEqual(empty, [], "no message without content, nor an empty text block");
    assert.match(JSON.stringify(second.messages.at(-1).content), /and say hello/);
  });

  // (fails before: yes — a message typed while a round's tools ran stayed in the run's mailbox when a later call of the
  // round paused; the run ended "paused" and marked it unread, and the answer's round never carried it)
  test("a message typed while a round's tools run, in a round a later call pauses, reaches the model with the answer", async () => {
    const sess = H();
    writeFileSync(join(root, "msg-notes.txt"), "some notes\n");
    let round = 0;
    /** @type {any} */
    let second = null;
    reader = async (call) => {
      const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
      const live = runs.find((/** @type {any} */ x) => x.status === "running");
      const s = await shim.api(`/api/runs/${live.id}/steer`, { method: "POST", body: { kind: "note", text: "use tabs, not spaces", from: "chat" } });
      assert.equal(s.status, 200);
      return anthropicReply("the notes say nothing of names", { model: call.body.model, usage: { input_tokens: 9, output_tokens: 5 } });
    };
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("d1", "delegate_read", { paths: ["msg-notes.txt"], question: "any name?" }), toolUse("q1", "ask", { question: "x or y?" })], "tool_use");
      second = call.body;
      return reply([{ type: "text", text: "y, with tabs." }]);
    };
    up.reset();
    const r1 = await ask({ messages: [{ role: "user", content: "start" }] }, sess);
    const j1 = await r1.json();
    assert.equal(text(j1.content), "x or y?");
    const r2 = await ask({ messages: [{ role: "user", content: "start" }, { role: "assistant", content: j1.content }, { role: "user", content: "y" }] }, sess);
    assert.equal(text((await r2.json()).content), "y, with tabs.");
    assert.ok(second, "the answer's round ran");
    assert.match(JSON.stringify(second.messages.at(-1).content), /use tabs, not spaces/, "the message rides with the answer's results");
    const evts = await eventsOf(r1.headers.get("x-filament-request-id"));
    assert.ok(!evts.some((e) => e.type === "steer-unread"), "never said unread: it was taken, to be heard with the answer");
  });

  test("delegate_read: the cheap reader sees the files and the question; the main context only ever sees its answer", async () => {
    mkdirSync(join(root, "big"), { recursive: true });
    writeFileSync(join(root, "big", "one.txt"), "THE-SECRET-INGREDIENT is paprika\n".repeat(50));
    writeFileSync(join(root, "big", "two.txt"), "nothing here\n");
    /** @type {any} */
    let readerCall = null;
    reader = (call) => {
      readerCall = call.body;
      return anthropicReply("one.txt: the ingredient is paprika (line 1).", { model: call.body.model, usage: { input_tokens: 900, output_tokens: 15 } });
    };
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("d1", "delegate_read", { paths: ["big/one.txt", "big/two.txt"], question: "what is the ingredient?" })], "tool_use");
      const res = lastResults(call.body.messages)[0];
      assert.match(res.content, /^\[read by reader-model, 2 files\]\none\.txt: the ingredient is paprika/);
      assert.ok(!JSON.stringify(call.body.messages).includes("THE-SECRET-INGREDIENT"), "the files never reach the main context");
      return reply([{ type: "text", text: "Paprika." }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "find the ingredient" }] });
    assert.equal(text((await r.json()).content), "Paprika.");
    assert.ok(readerCall, "the reader was called");
    assert.equal(readerCall.model, "reader-model");
    // (fails before: yes — the reader asked for 1,500 tokens, all a reasoning model's thinking: HarnessV3-FailurePoints §13)
    assert.ok(readerCall.max_tokens >= 32_000, `the reader asks for the most its model can write (got ${readerCall.max_tokens})`);
    const prompt = typeof readerCall.messages[0].content === "string" ? readerCall.messages[0].content : text(readerCall.messages[0].content);
    assert.match(prompt, /### big\/one\.txt[\s\S]*THE-SECRET-INGREDIENT[\s\S]*### big\/two\.txt[\s\S]*Question: what is the ingredient\?/);
    const id = r.headers.get("x-filament-request-id");
    const evts = await eventsOf(id);
    const end = evts.find((e) => e.type === "tool-end" && e.name === "delegate_read");
    assert.ok(end.requestId, "the reader's own record is linked from the event");
    const recs = await shim.records(30);
    const readerRec = recs.find((x) => x.id === end.requestId);
    assert.equal(readerRec.agentOf, id, "the reader hangs off the turn");
    assert.equal(readerRec.source, "agent-tick", "Traffic calls it the loop's own call");
    assert.equal(readerRec.memory, undefined, "memory stays out of the reader entirely");
    assert.equal(recs.find((x) => x.id === id).source, "agent-loop");
    assert.ok(recs.filter((x) => x.agentOf === id && x.model === "brain-model").every((x) => x.source === "agent-tick"));
  });

  // The permission answer's words were read for a yes here until the memory plan's a1 and a2: the press alone decides
  // now (permission-answers.test.js, worker-answer-field.test.js).
  test("the bash summary on the timeline carries no credential the command quoted", () => {
    assert.equal(argSummary("bash", { command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123" https://x' }), 'curl -H "Authorization: Bearer [redacted]" https://x');
    assert.equal(argSummary("bash", { command: "export KEY=sk-abcd1234efgh5678ijkl && npm test" }), "export KEY=sk-abcd… && npm test");
  });

  test("roots: a filesystem root is a legal root, a link is judged by where it points, prefixes are whole path segments", () => {
    const fsRoot = process.platform === "win32" ? "C:\\" : "/";
    assert.equal(underRoots(root, [fsRoot]), true, "everything lies under the filesystem root");
    assert.equal(underRoots(root, [root]), true);
    assert.equal(underRoots(join(root, "sub"), [root]), true, "a folder that does not exist yet keeps its lexical place");
    assert.equal(underRoots(root + "2", [root]), false, "a sibling that merely shares the prefix");
    assert.equal(underRoots(outside, [root]), false);
    // A junction (Windows) or symlink under the root that points outside: judged by its target.
    const link = join(root, "escape-hatch");
    try {
      symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch (e) {
      return; // no link privilege on this machine: the lexical cases above still stand
    }
    try {
      assert.equal(underRoots(link, [root]), false, "the link points outside the root");
      assert.equal(underRoots(link, [outside]), true, "and is under where it points");
    } finally {
      rmSync(link, { recursive: true, force: true });
    }
  });

  test("a misconfigured reader (the loop itself, an unknown route) leaves delegate_read out, said on the record; a plain route keeps it", async () => {
    for (const [bad, why] of [
      ["agent/brain-model", /agent loop itself/],
      ["nope-model", /no route matches/],
    ]) {
      await setConfig({ readerModel: bad });
      brain = (call) => {
        assert.ok(!call.body.tools.some((t) => t.name === "delegate_read"), `delegate_read is not offered with readerModel=${bad}`);
        assert.ok(!/delegate_read/.test(sysOf(call.body)), "and the prompt does not mention it");
        return reply([{ type: "text", text: "no reader" }]);
      };
      up.reset();
      const r = await ask({ messages: [{ role: "user", content: "x" }] });
      await expectOk(r);
      assert.equal(text((await r.json()).content), "no reader");
      const rec = await shim.record(r.headers.get("x-filament-request-id"));
      const note = (rec.changes || []).find((c) => /delegate_read not offered/.test(c));
      assert.ok(note, JSON.stringify(rec.changes));
      assert.match(note, why);
    }
    await setConfig({ readerModel: "reader-model" });
  });

  // HarnessV3-TaskGraph-v2 TG2-D62: a reply cut at its output ceiling goes on by itself. (fails before: yes — the first
  // cut ended the turn budget-stopped, its finished calls dropped with the cut one, until the developer sent a message)
  test("a reply cut in its thinking goes on: the thinking is dropped, the model hears what was cut, and the turn finishes", async () => {
    /** @type {any[]} */
    const calls = [];
    brain = (call) => {
      calls.push(call.body);
      if (calls.length === 1) return reply([{ type: "thinking", thinking: "t".repeat(300) }], "max_tokens");
      return reply([{ type: "text", text: "finished after the cut" }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "build it" }], max_tokens: 50 });
    await expectOk(r);
    const j = await r.json();
    assert.equal(j.stop_reason, "end_turn");
    assert.match(text(j.content), /finished after the cut/);
    assert.match(text(j.content), /\(Filament: the reply was cut here at its output ceiling; Filament goes on\.\)/, "the reply says where the cut came");
    assert.equal(calls.length, 2);
    const second = calls[1].messages;
    assert.equal(second.length, 1, "nothing of the cut reply joins the conversation, so its roles still alternate");
    const told = text(second[0].content);
    assert.ok(told.includes("build it"), "the developer's message stays");
    assert.ok(
      told.includes("[Filament: your reply was cut at the 50-token output ceiling while thinking: its 300 characters are not kept. Go on from where you were. Keep each reply well short of the ceiling: put what you work out into files as you go, and write a long file in parts.]"),
      told,
    );
    const evts = await eventsOf(r.headers.get("x-filament-request-id"));
    const cut = evts.filter((e) => e.type === "output-cut");
    assert.deepEqual(cut.map(({ round, at, limit, by, part, chars, ran }) => ({ round, at, limit, by, part, chars, ran })), [{ round: 1, at: 50, limit: 50, by: "ceiling", part: "thinking", chars: 300, ran: 0 }]);
    assert.ok(!evts.some((e) => e.type === "budget"), "no budget stop: the turn went on");
    assert.ok(RUN_EVENT_TYPE_LIST.includes("output-cut"), "the event is in the vocabulary");
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.equal(rec.agent.status, "done");
    assert.ok((rec.changes || []).some((c) => c === "agent: round 1's reply was cut at the 50-token output ceiling while thinking — Filament went on"), (rec.changes || []).join("\n"));
  });

  test("a cut reply's finished calls run and its cut call does not; the note follows their results", async () => {
    /** @type {any[]} */
    const calls = [];
    brain = (call) => {
      calls.push(call.body);
      if (calls.length === 1) return reply([{ type: "text", text: "writing both" }, toolUse("w1", "write", { path: "cut-one.txt", content: "ONE" }), toolUse("w2", "write", {})], "max_tokens");
      return reply([{ type: "text", text: "the second goes now" }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "write two files" }], max_tokens: 50 });
    await expectOk(r);
    const j = await r.json();
    assert.match(text(j.content), /the second goes now/);
    assert.equal(readFileSync(join(root, "cut-one.txt"), "utf8"), "ONE", "the finished call ran");
    const msgs = calls[1].messages;
    const asked = msgs.at(-2);
    assert.equal(asked.role, "assistant");
    assert.deepEqual(asked.content.filter((b) => b.type === "tool_use").map((b) => b.id), ["w1"], "the cut call is not in the conversation");
    assert.equal(text(asked.content), "writing both", "the reply's text before the cut stays");
    const res = lastResults(msgs);
    assert.deepEqual(res.map((x) => x.tool_use_id), ["w1"]);
    assert.ok(!res[0].is_error);
    const after = msgs.at(-1).content.filter((b) => b.type === "text").map((b) => b.text);
    assert.ok(
      after.includes("[Filament: your reply was cut at the 50-token output ceiling while writing its call to write: that call did not run. Its other calls ran: their results are above. Go on from where you were. Keep each reply well short of the ceiling: put what you work out into files as you go, and write a long file in parts.]"),
      JSON.stringify(after),
    );
    const evts = await eventsOf(r.headers.get("x-filament-request-id"));
    const cut = evts.find((e) => e.type === "output-cut");
    assert.deepEqual({ part: cut.part, tool: cut.tool, ran: cut.ran }, { part: "call", tool: "write", ran: 1 });
    assert.ok(!evts.some((e) => e.type === "tool-start" && e.id === "w2"), "the cut call never started");
  });

  test("two cuts in a row with nothing run between end the turn budget-stopped, both said; a budget stop is a normal reply, not an error", async () => {
    let n = 0;
    brain = () => {
      n++;
      return reply([{ type: "text", text: `I started to say ${n}` }], "max_tokens");
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "talk" }], max_tokens: 50 });
    const j = await r.json();
    assert.equal(n, 2, "one more round after the first cut, and no third");
    const all = text(j.content);
    assert.match(all, /I started to say 1/, "each cut's text is kept");
    assert.match(all, /I started to say 2/);
    assert.equal(
      j.content.at(-1).text,
      "(Filament: the reply was cut at the 50-token output ceiling twice in a row, in its text both times, and nothing ran between: the model did not fit its next step in one reply. What was finished is above. Send another message to continue; asking for the work in smaller steps helps.)",
    );
    const evts = await eventsOf(r.headers.get("x-filament-request-id"));
    assert.deepEqual(evts.filter((e) => e.type === "output-cut").map((e) => e.round), [1], "the first cut went on");
    const b = evts.find((e) => e.type === "budget");
    assert.deepEqual({ which: b.which, at: b.at, limit: b.limit }, { which: "output", at: 50, limit: 50 });
    assert.equal(evts.at(-1).status, "budget-stopped");
    assert.equal(evts.filter((e) => e.type === "turn-state").at(-1).to, "budget-stopped");
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.equal(rec.status, "ok", "a budget stop is a normal reply, not an error");
    assert.equal(rec.agent.status, "budget-stopped");
  });

  test("a cut, a round that runs a call, then cuts again: the turn goes on — a round between, or a cut whose calls ran, starts the count again", async () => {
    let n = 0;
    brain = () => {
      n++;
      const thinkingCut = reply([{ type: "thinking", thinking: "x".repeat(40) }], "max_tokens");
      if (n === 1 || n === 4) return thinkingCut;
      if (n === 2) return reply([toolUse("g1", "glob", { pattern: "*.nothing-here" })], "tool_use");
      if (n === 3) return reply([toolUse("g2", "glob", { pattern: "*.nothing-either" }), toolUse("g3", "glob", {})], "max_tokens");
      return reply([{ type: "text", text: "through" }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "go" }], max_tokens: 50 });
    await expectOk(r);
    const j = await r.json();
    assert.equal(j.stop_reason, "end_turn");
    assert.match(text(j.content), /through/);
    assert.equal(n, 5);
    const evts = await eventsOf(r.headers.get("x-filament-request-id"));
    assert.deepEqual(evts.filter((e) => e.type === "output-cut").map((e) => [e.round, e.ran]), [[1, 0], [3, 1], [4, 0]], "round 4's cut came straight after one whose call ran: it went on");
    assert.ok(!evts.some((e) => e.type === "budget"));
  });

  test("a thinking block cut after the reply's text is not sent back: the text is", async () => {
    /** @type {any[]} */
    const calls = [];
    brain = (call) => {
      calls.push(call.body);
      if (calls.length === 1) return reply([{ type: "text", text: "first the plan" }, { type: "thinking", thinking: "and then a long thought" }], "max_tokens");
      return reply([{ type: "text", text: "done" }]);
    };
    up.reset();
    await expectOk(await ask({ messages: [{ role: "user", content: "plan" }], max_tokens: 50 }));
    const asked = calls[1].messages.at(-2);
    assert.deepEqual(asked.content.map((b) => b.type), ["text"], "the cut thinking block, unsigned, never goes back to the provider");
    assert.equal(asked.content[0].text, "first the plan");
    assert.match(text(calls[1].messages.at(-1).content), /while thinking: its 23 characters are not kept/);
  });

  // (fails before: yes — with the window known, the reply floor raised a client's max_tokens of 50 to 1,024)
  test("the window's clamp never raises a client's max_tokens: one under the reply floor is sent as asked", async () => {
    const setWindow = async (/** @type {number} */ contextTokens) => {
      const st = await (await shim.api("/api/state")).json();
      const upstreams = st.config.upstreams.map((u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens } } } : u));
      await expectOk(await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams } }));
    };
    /** @type {number[]} */
    const caps = [];
    brain = (call) => {
      caps.push(Number(call.body.max_tokens));
      return reply([{ type: "text", text: "short" }]);
    };
    await setWindow(200000);
    try {
      up.reset();
      await expectOk(await ask({ messages: [{ role: "user", content: "hi" }], max_tokens: 50 }));
      assert.deepEqual(caps, [50]);
    } finally {
      await setWindow(200000);
    }
  });

  test("a cut at the window's clamp names the room the window had left, and goes on", async () => {
    const setWindow = async (/** @type {number} */ contextTokens) => {
      const st = await (await shim.api("/api/state")).json();
      const upstreams = st.config.upstreams.map((u) => (u.id === "m" ? { ...u, pricing: { "brain-model": { input: 1, output: 1, contextTokens } } } : u));
      await expectOk(await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams } }));
    };
    /** @type {any[]} */
    const calls = [];
    brain = (call) => {
      calls.push(call.body);
      if (calls.length === 1) return reply([{ type: "text", text: "part of it" }], "max_tokens");
      return reply([{ type: "text", text: "the rest" }]);
    };
    await setWindow(15000);
    try {
      up.reset();
      const r = await ask({ messages: [{ role: "user", content: "write a lot" }], max_tokens: 14000 });
      await expectOk(r);
      const j = await r.json();
      assert.match(text(j.content), /the rest/);
      const cap = Number(calls[0].max_tokens);
      assert.ok(cap >= 1024 && cap < 14000, `the round's room was the window's (${cap})`);
      const after = calls[1].messages.at(-1).content.filter((b) => b.type === "text").map((b) => b.text);
      assert.ok(after.includes(`[Filament: your reply was cut at ${cap.toLocaleString()} tokens, the room the context window had left, in its text: what was written is kept. Go on from where you were. Keep each reply well short of the ceiling: put what you work out into files as you go, and write a long file in parts.]`), JSON.stringify(after));
      assert.match(text(j.content), /\(Filament: the reply was cut here at the room its context window had left; Filament goes on\.\)/);
      const evts = await eventsOf(r.headers.get("x-filament-request-id"));
      const cut = evts.find((e) => e.type === "output-cut");
      assert.deepEqual({ at: cut.at, limit: cut.limit, by: cut.by }, { at: cap, limit: 14000, by: "window" });
    } finally {
      await setWindow(200000);
    }
  });

  test("two permissions in one reply: the first answer runs its tool and pauses again on the second; every tool_use is answered exactly once", async () => {
    await setConfig({ permissions: "ask" });
    const sess = H();
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1)
        return reply([toolUse("w1", "write", { path: "two.txt", content: "one" }), toolUse("w2", "write", { path: "three.txt", content: "two" }), toolUse("rd", "read", { path: "two.txt" })], "tool_use");
      const res = lastResults(call.body.messages);
      assert.deepEqual(res.map((x) => x.tool_use_id), ["w1", "w2", "rd"], "all three answered, in order, once");
      assert.ok(!res[0].is_error, "the first write ran on the first yes");
      assert.equal(res[1].is_error, true, "the second was declined");
      assert.match(res[1].content, /the developer declined — "no, leave three alone"/);
      assert.equal(res[2].content, "     1\tone", "the read ran after the decline and saw the first write");
      return reply([{ type: "text", text: "Two written, three left alone." }]);
    };
    up.reset();
    const r1 = await ask({ messages: [{ role: "user", content: "write both" }] }, sess);
    const j1 = await r1.json();
    assert.match(text(j1.content), /May I write two\.txt\?/);
    const convo = [{ role: "user", content: "write both" }, { role: "assistant", content: j1.content }];
    const r2 = await ask({ messages: [...convo, { role: "user", content: "/allow" }] }, sess);
    const j2 = await r2.json();
    assert.match(text(j2.content), /May I write three\.txt\?/, "paused again on the second permission");
    assert.equal(readFileSync(join(root, "two.txt"), "utf8"), "one");
    assert.equal(existsSync(join(root, "three.txt")), false);
    const r3 = await ask({ messages: [...convo, { role: "user", content: "/allow" }, { role: "assistant", content: j2.content }, { role: "user", content: "no, leave three alone" }] }, sess);
    assert.equal(text((await r3.json()).content), "Two written, three left alone.");
    assert.equal(existsSync(join(root, "three.txt")), false);
    assert.equal(round, 2, "one model call before the pauses, one after: the parked reply was never re-asked");
    await setConfig({ permissions: "edit" });
  });

  // (fails before: yes — a turn that failed after doing work archived nothing of it: HarnessV3-FailurePoints §6 item 1)
  test("a turn that fails after doing work keeps it: its work and why it failed are archived with it", async () => {
    let rounds = 0;
    brain = () => (++rounds === 1 ? reply([toolUse("k1", "read", { path: "kept.txt" })], "tool_use") : { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "messages: a bad block" } } });
    writeFileSync(join(root, "kept.txt"), "kept contents");
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "read kept.txt" }] });
    assert.equal(r.status, 502);
    const rec = await shim.record(String(r.headers.get("x-filament-request-id")));
    const [t] = shim.app.memory.archive.turnBodies(rec.memory.chain);
    assert.ok(!t.final, "no reply was written");
    assert.deepEqual(t.work.map((/** @type {any} */ m) => m.role), ["assistant", "user"], "round 1's read and its result are kept");
    assert.equal(t.meta.failed.cause, "round 2's model call to brain-model at m failed: messages: a bad block (HTTP 400). 1 finished round is kept.");
    assert.deepEqual([t.meta.failed.failure.what, t.meta.failed.failure.status], ["round 2's model call", 400]);
    assert.equal(rec.agent.failure.what, "round 2's model call", "the record carries the failure's fields");
    const run = (await (await shim.api(`/api/runs/${encodeURIComponent(rec.id)}`)).json()).run;
    assert.equal(run.summary?.failure?.what, "round 2's model call", "and so does the run's end");
  });

  // (fails before: yes — what the failed round had said was lost with it: HarnessV3-FailurePoints §6 item 1)
  // The call fails mid-reply with a 4xx inside its stream: the request's own fault, so the round is not asked again
  // (FP-D6), and the turn fails with what it had said.
  test("a turn whose call fails mid-reply keeps what it had said; one that failed before any work keeps nothing", async () => {
    const enc = new TextEncoder();
    let rounds = 0;
    brain = () => {
      if (++rounds === 1) return reply([toolUse("k2", "read", { path: "kept.txt" })], "tool_use");
      const refused = `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Output blocked by content filtering policy" } })}\n\n`;
      const parts = [...textOpen(), textDelta("Half a thought"), refused];
      let i = 0;
      const body = new ReadableStream({
        pull(c) {
          if (i < parts.length) c.enqueue(enc.encode(parts[i++]));
          else c.close();
        },
      });
      return /** @type {any} */ ({ status: 200, headers: { "content-type": "text/event-stream" }, body });
    };
    writeFileSync(join(root, "kept.txt"), "kept contents");
    up.reset();
    let r = await ask({ messages: [{ role: "user", content: "read kept.txt once more" }] });
    const rec = await shim.record(String(r.headers.get("x-filament-request-id")));
    const [t] = shim.app.memory.archive.turnBodies(rec.memory.chain);
    assert.equal(t.meta.failed.text, "Half a thought", "what the broken call had said rides with why it failed");
    assert.match(t.meta.failed.cause, /^round 2's model call to brain-model at m failed: .*It had streamed about 4 tokens of text\. 1 finished round is kept\.$/);
    // Failed in its first call, a turn did nothing: none of it is kept, and Retry sends it again.
    brain = () => ({ status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "messages: a bad block" } } });
    up.reset();
    r = await ask({ messages: [{ role: "user", content: "fail at once" }] });
    const quick = await shim.record(String(r.headers.get("x-filament-request-id")));
    const [q] = shim.app.memory.archive.turnBodies(quick.memory.chain);
    assert.deepEqual([q?.meta?.failed, q?.work?.length ?? 0], [undefined, 0]);
    assert.equal(rounds, 2, "the refused round was asked once");
  });

  // (fails before: yes — a round whose stream broke part-way failed the turn, however healthy its provider's next
  // answer would have been: HarnessV3-FailurePoints FP-D6)
  test("a round whose stream breaks part-way is asked again: the turn's answer is the next try's; the page keeps what it saw, closed by a line", async () => {
    const enc = new TextEncoder();
    let calls = 0;
    brain = () => {
      if (++calls > 1) return reply([{ type: "text", text: "A whole thought." }]);
      const parts = [...textOpen(), textDelta("Half a thought")];
      let i = 0;
      const body = new ReadableStream({
        pull(c) {
          if (i < parts.length) c.enqueue(enc.encode(parts[i++]));
          else c.error(new Error("the socket closed"));
        },
      });
      return /** @type {any} */ ({ status: 200, headers: { "content-type": "text/event-stream" }, body });
    };
    up.reset();
    const r = await ask({ stream: true, messages: [{ role: "user", content: "think it through" }] });
    const frames = parseSse(await r.text());
    const texts = frames
      .filter((f) => f.event === "content_block_start" && f.data.content_block.type === "text")
      .map((s) =>
        frames
          .filter((f) => f.event === "content_block_delta" && f.data.index === s.data.index && f.data.delta.type === "text_delta")
          .map((f) => f.data.delta.text)
          .join(""),
      );
    assert.deepEqual(texts, ["Half a thought", "(Filament: the provider's stream broke off here; the round is asked again.)", "A whole thought."]);
    assert.equal(calls, 2);
    const rec = await shim.record(String(r.headers.get("x-filament-request-id")));
    assert.equal(rec.status, "ok");
    const evts = await eventsOf(rec.id);
    // The run log numbers the round's text by the client's blocks: the broken try's words and the line came first.
    assert.deepEqual(evts.filter((/** @type {any} */ e) => e.type === "round-text").map((/** @type {any} */ e) => [e.block, e.text]), [[2, "A whole thought."]]);
    const waits = evts.filter((/** @type {any} */ e) => e.type === "turn-state" && e.retry).map((/** @type {any} */ e) => e.why);
    assert.equal(waits.length, 1, JSON.stringify(waits));
    assert.match(waits[0], /^m's stream broke off \(.+\) — trying again in 1 s \(try 2 of 10\); what it had streamed \(14 characters of text\) is dropped$/);
    const [t] = shim.app.memory.archive.turnBodies(rec.memory.chain);
    assert.equal(t.meta?.failed, undefined, "the turn did not fail");
    assert.ok(!JSON.stringify(t).includes("Half a thought"), "the broken try left the turn");
  });

  // (fails before: yes — a provider that stopped sending mid-reply, its connection still open, held the round forever:
  // the owner's Hunter of 10-29 on ZAI waited at round 104 for as long as Filament ran, "Working" in Now)
  test("a round whose stream goes silent is cut once it has sent nothing for the silence limit, and asked again", async () => {
    const enc = new TextEncoder();
    let calls = 0;
    /** @type {string[]} */
    const gone = [];
    brain = () => {
      if (++calls > 1) return reply([{ type: "text", text: "A whole thought." }]);
      const parts = [...textOpen(), textDelta("Half a thought")];
      let i = 0;
      const body = new ReadableStream({
        // Its last part sent, the provider says nothing more and keeps the connection open.
        pull(c) {
          if (i < parts.length) c.enqueue(enc.encode(parts[i++]));
          else return new Promise(() => {});
        },
        cancel() {
          gone.push("cancelled");
        },
      });
      return /** @type {any} */ ({ status: 200, headers: { "content-type": "text/event-stream" }, body });
    };
    process.env.FILAMENT_SILENT_REPLY_MS = "300";
    try {
      up.reset();
      const r = await ask({ messages: [{ role: "user", content: "think it through" }] });
      assert.equal(text((await r.json()).content).endsWith("A whole thought."), true);
      assert.equal(calls, 2, "the silent round was asked again");
      const rec = await shim.record(String(r.headers.get("x-filament-request-id")));
      assert.equal(rec.status, "ok");
      const waits = (await eventsOf(rec.id)).filter((/** @type {any} */ e) => e.type === "turn-state" && e.retry).map((/** @type {any} */ e) => e.why);
      assert.equal(waits.length, 1, JSON.stringify(waits));
      assert.match(waits[0], /^m's stream broke off \(it sent nothing for 0\.3 s mid-reply\) — trying again in 1 s \(try 2 of 10\)/);
      await until(() => gone.length > 0, "the silent reply's connection to be closed");
    } finally {
      delete process.env.FILAMENT_SILENT_REPLY_MS;
    }
  });

  test("guards: a folder outside roots or missing is refused in words; the loop behind the loop or an unknown model is refused; a config that still says the loop is off is taken, and the loop answers", async () => {
    brain = () => reply([{ type: "text", text: "should not run" }]);
    up.reset();
    let r = await ask({ messages: [{ role: "user", content: "x" }] }, H({ "x-filament-cwd": outside }));
    assert.equal(r.status, 200);
    assert.match(text((await r.json()).content), /is not under any folder listed in agentLoop\.roots, so nothing ran/);
    // The refusal is the turn's archived answer, marked as Filament's own (memory is off here: recording only).
    const refused = await shim.record(String(r.headers.get("x-filament-request-id")));
    assert.equal(refused.memory?.command, true, "the record says Filament answered");
    const turns = shim.app.memory.archive.getTurns(refused.memory.chain);
    assert.equal(turns.length, 1); assert.ok(turns[0].final_hash, "the refusal is the final"); assert.equal(turns[0].meta?.command, true);
    assert.match(text(shim.app.memory.archive.getMessage(turns[0].final_hash).message.content), /so nothing ran/);
    r = await ask({ messages: [{ role: "user", content: "x" }] }, H({ "x-filament-cwd": join(root, "does-not-exist") }));
    assert.match(text((await r.json()).content), /does not exist on this machine/);
    r = await shim.house("/v1/messages", { model: "agent/agent/brain-model", max_tokens: 10, messages: [{ role: "user", content: "x" }] }, H());
    assert.equal(r.status, 400);
    r = await shim.house("/v1/messages", { model: "agent/nope-model", max_tokens: 10, messages: [{ role: "user", content: "x" }] }, H());
    assert.equal(r.status, 404);
    assert.equal(up.received.length, 0, "no model was called");
    // The loop is Filament's own, and no switch turns it off (the owner's of 11-09): a config that still says
    // `enabled: false` is taken, the word dropped, and agent/… stays the loop's.
    await setConfig({ enabled: false });
    assert.equal("enabled" in (await (await shim.api("/api/state")).json()).config.agentLoop, false, "the old switch is dropped");
    brain = () => reply([{ type: "text", text: "still the loop" }]);
    r = await ask({ messages: [{ role: "user", content: "x" }] });
    assert.equal(r.status, 200, "agent/… is still the loop's");
    assert.match(text((await r.json()).content), /still the loop/);
  });

  test("a client that hangs up mid-turn ends the run aborted, never error", async () => {
    let release = () => {};
    brain = async (call) => {
      if (lastResults(call.body.messages).length) return reply([{ type: "text", text: "late" }]);
      await new Promise((r) => (release = r));
      return reply([{ type: "text", text: "too late" }]);
    };
    up.reset();
    // The records before this turn: an earlier test's failed turn on the same model is not this one's (it was taken
    // for it under load, while this one's was still pending).
    const before = new Set((await shim.records(50)).map((x) => x.id));
    const ctl = new AbortController();
    const p = fetch(`${shim.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", ...houseAuth(), ...H() },
      body: JSON.stringify({ model: "agent/brain-model", max_tokens: 100, messages: [{ role: "user", content: "slow" }] }),
      signal: ctl.signal,
    });
    await new Promise((r) => setTimeout(r, 150));
    ctl.abort();
    await p.catch(() => null);
    release();
    // The parent record settles as aborted; the run ends aborted.
    let rec = null;
    for (let i = 0; i < 50 && !rec; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const recs = await shim.records(20);
      rec = recs.find((x) => !before.has(x.id) && x.model === "agent/brain-model" && x.status !== "pending");
    }
    assert.ok(rec, "the parent record finished");
    assert.equal(rec.status, "aborted");
    const run = (await (await shim.api(`/api/runs/${rec.id}`)).json()).run;
    assert.equal(run.status, "aborted");
  });

  // (fails before: yes — the loop translated a Chat Completions request on entry, for the outside clients that sent one)
  test("the loop's door is /v1/messages, the one Filament's own calls take: on Chat Completions `agent/<model>` is no model", async () => {
    brain = () => reply([{ type: "text", text: "hi from the loop" }]);
    up.reset();
    const r = await shim.house("/v1/chat/completions", { model: "agent/brain-model", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }, H());
    assert.equal(r.status, 404, await r.clone().text());
    assert.match((await r.json()).error.message, /no route matches model "agent\/brain-model"/);
    assert.equal(up.received.length, 0, "no model was called");
  });
});

describe("the agent loop with memory on", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-mem-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      summarizer: "",
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("memory tools ride every tick, scoped to the developer's own session; the ticks archive nothing and open no session of their own", async () => {
    const sessions = async () => (await (await shim.api("/api/memory/sessions?limit=50")).json()).sessions;
    const before = (await sessions()).length;
    let round = 0;
    brain = (call) => {
      round++;
      const names = call.body.tools.map((t) => t.name);
      assert.ok(names.includes("read") && names.includes("edit"), "the hands");
      assert.ok(names.filter((n) => n.startsWith("filament_memory_")).length >= 3, `memory's tools ride the tick: ${names.join(",")}`);
      assert.ok(names.indexOf("read") < names.indexOf(names.find((n) => n.startsWith("filament_memory_"))), "hands first, memory's tools after: the frozen prefix stays");
      if (round === 1) return reply([toolUse("m1", "filament_memory_remember", { text: "The agent-mem project uses tabs.", kind: "preference" })], "tool_use");
      return reply([{ type: "text", text: "Remembered." }]);
    };
    up.reset();
    const sess = { "x-filament-cwd": root, "x-session-id": "agent-mem-session" };
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 200, messages: [{ role: "user", content: "remember that we use tabs" }] }, sess);
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    assert.equal(text((await r.json()).content), "Remembered.");
    const id = r.headers.get("x-filament-request-id");
    const parent = await shim.record(id);
    assert.ok(parent.memory?.chain, "the developer's request has its chain");
    const all = (await (await shim.api("/api/requests?limit=50&scope=all")).json()).requests;
    const ticks = all.filter((x) => x.agentOf === id);
    // The memory tool round happens inside the tick's own request (the pipeline's memory loop answers and asks the
    // upstream again), so the loop saw one round while the upstream saw two calls.
    assert.equal(ticks.length, 1, "one tick record");
    assert.equal(round, 2, "two upstream calls inside it");
    assert.equal(parent.agent.rounds, 1);
    const t = ticks[0];
    assert.equal(t.source, "agent-tick");
    assert.equal(t.memory?.chain, parent.memory.chain, "the tick sits on the developer's chain");
    assert.equal(t.memory?.quiet, true, "and is quiet there");
    assert.equal(t.memory?.tools, true);
    assert.equal(t.memory?.toolRounds, 1);
    assert.ok(/the model used memory tools \(remember\)/.test((t.changes || []).join("\n")), "the memory tool ran inside the tick");
    assert.equal((await sessions()).length, before + 1, "one new session: the developer's; none for the ticks");
    const detail = await (await shim.api(`/api/memory/sessions/${parent.memory.chain}`)).json();
    assert.equal(detail.turns.length, 1, "one archived turn: the developer's message and the loop's reply, not the ticks");
    assert.equal(detail.turns[0].outputChars, "Remembered.".length, "the reply archived is the one the developer saw");
    const truth = await (await shim.api(`/api/sessions/${parent.memory.chain}`)).json();
    const inForce = truth.inForce || truth.truth?.inForce;
    assert.equal(inForce.permissions, "edit", "the inspector names the permission mode the loop ran under here");
  });

  test("a memory call Filament runs inside a tick is a call on the turn's run — what it was asked, what came back — a round's that rode beside the loop's own call too (the owner's of 10-29)", async () => {
    writeFileSync(join(root, "pill-notes.txt"), "the notes");
    let round = 0;
    brain = () => {
      round++;
      // The first upstream call asks memory alone: Filament answers inside the tick and asks again. The second asks
      // memory beside a call of the loop's: memory's runs now, its result rides the next request.
      if (round === 1) return reply([{ type: "text", text: "Noting it." }, toolUse("mr1", "filament_memory_remember", { text: "The pill project keeps its notes in pill-notes.txt.", kind: "fact" })], "tool_use");
      if (round === 2) return reply([toolUse("ms1", "filament_memory_search", { query: "pill project notes" }), toolUse("rd1", "read", { path: "pill-notes.txt" })], "tool_use");
      return reply([{ type: "text", text: "Done." }]);
    };
    up.reset();
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 200, messages: [{ role: "user", content: "remember where the notes are, then read them" }] }, { "x-filament-cwd": root, "x-session-id": "agent-mem-pill" });
    await expectOk(r);
    assert.match(text((await r.json()).content), /Done\.$/);
    const id = r.headers.get("x-filament-request-id");
    const events = (await (await shim.api(`/api/runs/${id}/events?since=0&limit=5000`)).json()).events;
    const starts = events.filter((e) => e.type === "tool-start");
    const ends = new Map(events.filter((e) => e.type === "tool-end").map((e) => [e.id, e]));
    const remember = starts.find((e) => e.id === "mr1");
    assert.ok(remember, `the remember Filament ran is on the run: ${starts.map((e) => `${e.id}:${e.name}`).join(", ")}`);
    assert.equal(remember.name, "filament_memory_remember");
    assert.equal(remember.round, 1, "in the round whose model call made it");
    assert.equal(remember.card?.whole, "The pill project keeps its notes in pill-notes.txt.", "what it was asked to keep, whole");
    assert.equal(remember.card?.given, "kind: fact");
    assert.equal(ends.get("mr1")?.ok, true);
    assert.match(String(ends.get("mr1")?.preview), /"stored":true/, "what came back");
    const search = starts.find((e) => e.id === "ms1");
    assert.ok(search, "the search that rode beside the loop's read: run then, shown all the same");
    assert.equal(search.card?.whole, "pill project notes");
    assert.ok(String(ends.get("ms1")?.preview || "").length > 0, "what it found");
    assert.ok(starts.some((e) => e.id === "rd1" && e.round === 1), "the loop's own call");
    assert.equal((await shim.record(id)).agent.toolCalls, 1, "the loop's count is its own calls: memory's ran in the request");
  });

  // A chat on your defaults, and one whose tool results go as one line each (what the Balanced preset set, while there were presets).
  const CHATS = /** @type {const} */ ([["plain", {}], ["balanced", { context: { results: "status" } }]]);
  for (const [preset, own] of CHATS)
    test(`a memory call in a ${preset} chat of Filament's own is run, never refused as a tool not offered (the owner's of 10-28)`, async () => {
      const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", settings: own } })).json()).id);
      /** @type {any[]} */
      const calls = [];
      brain = (call) => {
        calls.push(call);
        if (calls.length === 1) return reply([toolUse(`pm-${preset}`, "filament_memory_remember", { text: `The ${preset} chat keeps its notes in notes-${preset}.md.`, kind: "fact" })], "tool_use");
        return reply([{ type: "text", text: "Kept." }]);
      };
      up.reset();
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "remember where the notes are", stream: false } });
      assert.equal(r.status, 200);
      assert.match(text((await r.json()).content), /Kept\.$/);
      const answer = calls[1]?.body.messages.at(-1).content.find((/** @type {any} */ b) => b.type === "tool_result");
      assert.ok(answer, "the model heard back");
      assert.doesNotMatch(String(typeof answer.content === "string" ? answer.content : JSON.stringify(answer.content)), /not available here/, "run, not refused");
      assert.match(String(typeof answer.content === "string" ? answer.content : JSON.stringify(answer.content)), /stored/);
    });

  for (const [preset, own] of CHATS)
    test(`a memory call in a ${preset} chat whose memory tools are off is answered in those words and never runs, whatever else the tick offers; its briefing names none of them (the owner's of 10-28)`, async () => {
      // A rule of the project's, so the chat has a briefing to read.
      const kept = await shim.api("/api/memory/remember", { method: "POST", body: { text: "Run the linter before every commit here.", kind: "rule", project: projectIdOf(root) } });
      assert.equal(kept.status, 200, await kept.clone().text());
      const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", settings: { ...own, memory: { tools: false } } } })).json()).id);
      /** @type {any[]} */
      const calls = [];
      brain = (call) => {
        calls.push(call);
        if (calls.length === 1) return reply([toolUse(`off-${preset}`, "filament_memory_remember", { text: `The ${preset} chat with tools off keeps notes in off-${preset}.md.`, kind: "fact" })], "tool_use");
        return reply([{ type: "text", text: "Understood." }]);
      };
      up.reset();
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "remember where the notes are", stream: false } });
      assert.equal(r.status, 200);
      await r.json();
      assert.ok(!calls[0].body.tools.some((/** @type {any} */ t) => String(t.name).startsWith("filament_memory_")), "memory's tools are not offered");
      const system = JSON.stringify(calls[0].body.system);
      assert.match(system, /Long-term memory \(Filament\)/, "the briefing rides");
      assert.match(system, /Run the linter before every commit here/);
      assert.doesNotMatch(system, /filament_memory_/, "and names none of the tools it was not given");
      const answer = calls[1]?.body.messages.flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).find((/** @type {any} */ b) => b.type === "tool_result" && b.tool_use_id === `off-${preset}`);
      assert.ok(answer, "the model heard back");
      const said = typeof answer.content === "string" ? answer.content : JSON.stringify(answer.content);
      assert.match(said, /memory's tools are off in this chat/i, `said why: ${said}`);
      assert.doesNotMatch(said, /"stored":true/, "and it did not run");
    });

  test("a loop turn of Filament's own call, no harness session's, under a global result cap: the capped result's pointer resolves — filament_recall rides the ticks", async () => {
    writeFileSync(join(root, "long-plain.txt"), `${"line of the long file\n".repeat(120)}THE LAST LINE`);
    shim.app.config.agentLoop.resultCapChars = 400;
    try {
      let round = 0;
      /** @type {string[][]} */
      const toolNames = [];
      brain = (call) => {
        round++;
        toolNames.push(call.body.tools.map((t) => t.name));
        if (round === 1) return reply([toolUse("l1", "read", { path: "long-plain.txt" })], "tool_use");
        if (round === 2) {
          const res = lastResults(call.body.messages)[0];
          assert.match(res.content, /filament_recall\(\{ result: "r:[0-9a-f]{8}" \}\) brings the whole result back\]$/, "capped, with a pointer");
          return reply([toolUse("rc", "filament_recall", { result: `r:${res.content.match(/r:([0-9a-f]{8})/)[1]}` })], "tool_use");
        }
        const res = lastResults(call.body.messages)[0];
        assert.equal(res.tool_use_id, "rc");
        assert.ok(res.content.includes("THE LAST LINE"), `the whole result came back: ${res.content.slice(0, 120)}`);
        return reply([{ type: "text", text: "It ends with THE LAST LINE." }]);
      };
      up.reset();
      const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 200, messages: [{ role: "user", content: "read long-plain.txt and tell me its last line" }] }, { "x-filament-cwd": root, "x-session-id": "agent-cap-plain" });
      if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
      assert.equal(text((await r.json()).content), "It ends with THE LAST LINE.");
      assert.equal(round, 3, "read, recall (answered inside the tick), answer");
      assert.ok(toolNames.every((names) => names.includes("filament_recall")), `the tool rides every tick of the turn, so the tools section is stable: ${toolNames.map((n) => n.includes("filament_recall")).join(",")}`);
      const parent = await shim.record(r.headers.get("x-filament-request-id"));
      assert.equal(parent.agent.cappedResults, 1);
    } finally {
      shim.app.config.agentLoop.resultCapChars = 0;
    }
  });

  test("P3: the ticks read the session document by its chain header — memory.tools off takes memory's tools off every tick; unset brings them back", async () => {
    const api = async (path, body, method = "POST") => {
      const r = await shim.api(path, body ? { method, body } : {});
      if (r.status !== 200) assert.fail(`${path}: HTTP ${r.status}: ${await r.text()}`);
      return { headers: r.headers, json: await r.json() };
    };
    const settings = (change) => api(`/api/sessions/${id}/settings`, change, "PATCH");
    const id = (await api("/api/sessions", { cwd: root, model: "agent/brain-model", preset: "plain" })).json.id;
    /** @type {string[][]} */
    const toolNames = [];
    brain = (call) => {
      toolNames.push(call.body.tools.map((t) => t.name));
      return reply([{ type: "text", text: `Reply ${toolNames.length}.` }]);
    };
    up.reset();
    const turn = async (content) => (await api(`/api/sessions/${id}/turns`, { content, stream: false })).headers.get("x-filament-request-id");
    const memoryTools = (names) => names.filter((n) => n.startsWith("filament_memory_"));
    const tickOf = async (parentId) => {
      const all = (await (await shim.api("/api/requests?limit=50&scope=all")).json()).requests;
      const ticks = all.filter((x) => x.agentOf === parentId);
      assert.equal(ticks.length, 1, `one tick under ${parentId}`);
      return ticks[0];
    };
    const p1 = await turn("one");
    assert.ok(toolNames[0].includes("read"), "the hands ride the tick");
    assert.ok(memoryTools(toolNames[0]).length >= 3, `memory's tools ride the tick by default: ${toolNames[0].join(",")}`);
    assert.equal((await tickOf(p1)).memory?.tools, true, "the first tick offered memory's tools");
    const patched = (await settings({ patch: { memory: { tools: false } } })).json;
    assert.equal(patched.sources["memory.tools"], "session");
    const p2 = await turn("two");
    assert.ok(toolNames[1].includes("read") && toolNames[1].includes("edit"), "the hands are untouched");
    assert.deepEqual(memoryTools(toolNames[1]), [], `the tick carries no memory tools once the document says memory.tools: false: ${toolNames[1].join(",")}`);
    assert.equal((await tickOf(p2)).memory?.tools, false, "the second tick did not — its record says so");
    await settings({ unset: ["memory.tools"] });
    await turn("three");
    assert.ok(memoryTools(toolNames[2]).length >= 3, `unset: memory's tools are back on the tick: ${toolNames[2].join(",")}`);
    const t = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
    assert.equal(t.boundaries.length, 2, "two settings boundaries: the knob went off before turn 2 and back before turn 3");
    assert.deepEqual(t.boundaries.map((b) => b.beforeTurn), [2, 3]);
  });
});

describe("the agent loop on a native session (HarnessV2 Phase 2)", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string} */
  let firstDataDir;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  const configure = (cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.memory.autopilot = { enabled: false };
    cfg.memory.capture = { turns: true, learn: false };
    cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-agent-native-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({ memory: true, configure, keep: true });
    firstDataDir = shim.dataDir;
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [firstDataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
  const create = async (preset = "plain") => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()).id;
  };
  const turn = async (id, content, extra = {}) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...extra } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return { headers: r.headers, json: await r.json() };
  };
  const transcript = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();

  test("D7: a turn's tool rounds are archived as its work and the closing reply as its final; under plain, turn 3's upstream body carries turn 1's tool_result verbatim", async () => {
    writeFileSync(join(root, "note.txt"), "the note: use tabs\n");
    const id = await create("plain");
    /** @type {any[][]} */
    const bodies = [];
    let round = 0;
    brain = (call) => {
      round++;
      bodies.push(structuredClone(call.body.messages));
      if (round === 1) return reply([{ type: "text", text: "Reading the note." }, toolUse("r1", "read", { path: "note.txt" })], "tool_use");
      if (round === 2) {
        assert.match(lastResults(call.body.messages)[0].content, /use tabs/);
        return reply([{ type: "text", text: "The note says: use tabs." }]);
      }
      return reply([{ type: "text", text: `Reply ${round}.` }]);
    };
    up.reset();
    const r1 = await turn(id, "read note.txt");
    assert.equal(r1.headers.get("x-filament-session"), id);
    assert.ok(r1.headers.get("x-filament-settings-hash"));
    assert.equal(text(r1.json.content), "Reading the note.The note says: use tabs.", "the client's reply is every round's text, as before");
    const t1 = await transcript(id);
    assert.equal(t1.turns.length, 1);
    const first = t1.turns[0];
    assert.deepEqual(first.user.content, [{ type: "text", text: "read note.txt" }]);
    assert.equal(first.open, false);
    assert.equal(first.work.length, 2, "the tool_use reply and its results are the turn's work");
    assert.equal(first.work[0].role, "assistant");
    assert.deepEqual(first.work[0].content.map((b) => b.type), ["text", "tool_use"]);
    assert.equal(first.work[1].role, "user");
    assert.equal(first.work[1].content[0].type, "tool_result");
    assert.equal(first.work[1].content[0].tool_use_id, "r1");
    assert.match(first.work[1].content[0].content, /use tabs/);
    assert.deepEqual(first.final.content, [{ type: "text", text: "The note says: use tabs." }], "the final is the reply that closed the turn — the first round's words live in the work, not twice");
    assert.equal(first.composed.form, "plain");
    assert.equal(first.settingsHash, r1.headers.get("x-filament-settings-hash"));
    assert.equal(t1.paused, null);
    assert.equal(t1.live, null);
    // Turns 2 and 3: plain sends the archive raw, so the model in turn 3 reads turn 1's result exactly as the tool wrote it.
    await turn(id, "thanks");
    const r3 = await turn(id, "what did the note say?");
    assert.equal(text(r3.json.content), "Reply 4.");
    assert.equal(round, 4);
    const body3 = bodies[3];
    assert.deepEqual(body3.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user"], "turn 1 (user, tool round, final), turn 2, the new message");
    assert.deepEqual(body3[1], first.work[0]);
    assert.deepEqual(body3[2], first.work[1], "the tool_result rides raw");
    assert.deepEqual(body3[3], first.final);
    assert.equal(body3[6].content[0].text, "what did the note say?", "the new message closes the body (the shim's cache breakpoint rides on it)");
    const t3 = await transcript(id);
    assert.equal(t3.turns.length, 3);
    assert.deepEqual(t3.turns.map((t) => t.settingsHash), [first.settingsHash, first.settingsHash, first.settingsHash], "one settings document, one hash");
    assert.deepEqual(t3.boundaries, []);
    assert.equal(t3.turns[2].composed.turns, 2, "two completed turns were composed for turn 3");
  });

  test("the pause outlives the process: the parked question is on the chain; a restarted Filament resumes it from the archive when the answer comes", async () => {
    const id = await create("plain");
    let round = 0;
    /** @type {any[][]} */
    const seen = [];
    brain = (call) => {
      round++;
      seen.push(structuredClone(call.body.messages));
      if (round === 1) return reply([{ type: "text", text: "I will list the folder." }, toolUse("c1", "bash", { command: `node -e "console.log('from-the-shell')"` })], "tool_use");
      const res = lastResults(call.body.messages);
      assert.equal(res.length, 1);
      assert.equal(res[0].tool_use_id, "c1");
      assert.match(res[0].content, /from-the-shell/);
      return reply([{ type: "text", text: "It printed from-the-shell." }]);
    };
    up.reset();
    const r1 = await turn(id, "list the folder");
    assert.match(r1.json.content.at(-1).text, /May I run this command\? `node -e "console\.log\('from-the-shell'\)"`/);
    const askedBy = r1.headers.get("x-filament-request-id");
    let t = await transcript(id);
    assert.equal(t.turns.length, 1);
    assert.equal(t.paused?.kind, "permission", "the parked question is on the chain");
    assert.equal(t.paused?.requestId, askedBy);
    assert.ok(t.paused.expires > Date.now());
    assert.deepEqual(t.turns[0].work, [], "the reply whose call is waiting is parked with the pause, not archived as work yet");
    assert.match(t.turns[0].final.content[0].text, /May I run this command/);
    // The process that asked is gone: same data dir, a fresh Filament.
    await shim.stop();
    shim = await startApp({ memory: true, configure, dataDir: firstDataDir, keep: true });
    t = await transcript(id);
    assert.equal(t.paused?.requestId, askedBy, "the archive remembers the pause across the restart");
    const r2 = await turn(id, "yes", { allow: true });
    assert.equal(text(r2.json.content), "It printed from-the-shell.");
    assert.equal(round, 2, "the model was called once more: with the command's result");
    const rec = await shim.record(r2.headers.get("x-filament-request-id"));
    assert.ok(rec.changes.some((c) => /resumed from the archived pause/.test(c)), rec.changes.join("\n"));
    // The resumed conversation: turn 1's message, then the parked reply (its tool_use) and the command's result.
    const resumed = seen[1];
    assert.equal(resumed[0].content[0].text, "list the folder");
    assert.ok(resumed.some((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((c) => c.id === "c1")), "the parked reply is back in the conversation");
    t = await transcript(id);
    assert.equal(t.paused, null, "answered: nothing is parked");
    assert.equal(t.turns.length, 2);
    assert.deepEqual(t.turns[1].user.content, [{ type: "text", text: "yes" }]);
    assert.equal(t.turns[1].work.length, 2, "the parked reply and the result are the resumed turn's work");
    assert.ok(t.turns[1].work[0].content.some((c) => c.type === "tool_use" && c.id === "c1"));
    assert.equal(t.turns[1].work[1].content[0].tool_use_id, "c1");
    assert.deepEqual(t.turns[1].final.content, [{ type: "text", text: "It printed from-the-shell." }]);
  });

  // (fails before: yes — the archived pause carried nothing of what the turn wrote, so the turn resumed after a restart
  // asked for no read-back of the file written before the pause (the bug report's H7))
  test("the archived pause keeps what the turn wrote: after a restart the resumed turn still asks for the file read back", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { verify: { readBackBeforeDone: true } } } } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    /** @type {any[][]} */
    const seen = [];
    brain = (call) => {
      seen.push(structuredClone(call.body.messages));
      if (seen.length === 1) return reply([toolUse("w1", "write", { path: "kept.txt", content: "kept\n" }), toolUse("c1", "bash", { command: `node -e "console.log('built')"` })], "tool_use");
      return reply([{ type: "text", text: seen.length === 2 ? "Built." : "Read it back: as intended." }]);
    };
    up.reset();
    const r1 = await turn(id, "write kept.txt, then build");
    assert.match(r1.json.content.at(-1).text, /May I run this command\?/);
    const stored = /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.paused;
    assert.deepEqual([stored.kind, stored.wrote, stored.unread], ["permission", true, ["kept.txt"]], "the pause on the chain carries the write");
    await shim.stop();
    shim = await startApp({ memory: true, configure, dataDir: firstDataDir, keep: true });
    const r2 = await turn(id, "yes", { allow: true });
    assert.deepEqual(r2.json.content.map((/** @type {any} */ b) => b.text), ["Built.", "Read it back: as intended."]);
    assert.equal(seen.length, 3, "the resumed turn went back once, for the read-back");
    assert.match(JSON.stringify(seen[2].at(-1)), /Read these files back before you finish and confirm they are as intended: kept\.txt/);
  });

  // (fails before: yes — the archived pause carried nothing of the files the turn changed, so after a restart the
  // turn's second file counted as its first and no line came)
  test("the archived pause keeps the files the turn changed: after a restart the turn's second file still gets the checklist line", async () => {
    const id = await create("plain");
    /** @type {any[][]} */
    const seen = [];
    brain = (call) => {
      seen.push(structuredClone(call.body.messages));
      if (seen.length === 1) {
        const tools = (call.body.tools || []).map((/** @type {any} */ t) => t.name);
        assert.ok(tools.includes("plan") && tools.includes("tasks"), tools.join(", "));
        return reply([toolUse("w1", "write", { path: "first.txt", content: "first\n" }), toolUse("c1", "bash", { command: `node -e "console.log('built')"` })], "tool_use");
      }
      if (seen.length === 2) return reply([toolUse("w2", "write", { path: "second.txt", content: "second\n" })], "tool_use");
      return reply([{ type: "text", text: "Both written." }]);
    };
    up.reset();
    const r1 = await turn(id, "write two files, a build between");
    assert.match(r1.json.content.at(-1).text, /May I run this command\?/);
    const stored = /** @type {any} */ (shim.app).memory.archive.getChain(id).meta.paused;
    assert.equal(stored.changed?.length, 1, "the pause on the chain carries the file the turn changed");
    await shim.stop();
    shim = await startApp({ memory: true, configure, dataDir: firstDataDir, keep: true });
    const r2 = await turn(id, "yes", { allow: true });
    assert.equal(text(r2.json.content), "Both written.");
    assert.equal(seen.length, 3);
    const second = lastResults(seen[2]).find((/** @type {any} */ b) => b.tool_use_id === "w2");
    assert.ok(String(second?.content).endsWith(UNPLANNED_LINE), String(second?.content));
  });

  test("P3: the loop reads its knobs from the session document — tools switched off leave the set and the prompt, learned permissions can be off", async () => {
    const id = await create("plain");
    const patch = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { loop: { tools: { bash: false, plan: false }, learnedPermissions: { enabled: false } } } } });
    assert.equal(patch.status, 200);
    /** @type {any[]} */
    const seen = [];
    brain = (call) => {
      seen.push({ tools: (call.body.tools || []).map((t) => t.name), system: sysOf(call.body) });
      if (seen.length === 1) return reply([{ type: "text", text: "Looking." }, toolUse("r1", "read", { path: "note.txt" })], "tool_use");
      return reply([{ type: "text", text: "It says note." }]);
    };
    up.reset();
    writeFileSync(join(root, "note.txt"), "note\n");
    const r = await turn(id, "read the note, then run the tests");
    assert.equal(seen.length, 2, "the read, then the answer");
    assert.deepEqual(seen[0].tools.filter((n) => ["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", "grep", "ask", "plan"].includes(n)), ["read", "write", "edit", "bash_background", "bash_output", "bash_kill", "grep", "ask"], "bash and plan are not offered");
    assert.ok(seen[0].system.includes("Not offered in this session (the developer switched them off): bash."), "the prompt names the missing hand");
    assert.ok(!seen[0].system.includes("publish a checklist with the plan tool"), "the plan sentence went with its tool");
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.deepEqual(rec.agent.toolsOff, ["bash", "plan"]);
    assert.equal(rec.agent.rounds, 2);
    assert.ok(rec.changes.some((c) => /2 tools switched off by the session \(loop\.tools\): bash, plan/.test(c)), rec.changes.join(" | "));
    assert.ok(rec.changes.some((c) => /learned permissions are off for this session/.test(c)), rec.changes.join(" | "));
    // Back to the defaults: the next turn offers everything again.
    await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { unset: ["loop.tools", "loop.learnedPermissions.enabled"] } });
    brain = (call) => { seen.push({ tools: (call.body.tools || []).map((t) => t.name), system: sysOf(call.body) }); return reply([{ type: "text", text: "Done." }]); };
    const r2 = await turn(id, "and now?");
    assert.ok(seen[2].tools.includes("bash") && seen[2].tools.includes("plan"));
    assert.ok(!seen[2].system.includes("Not offered in this session"));
    assert.ok(r2.headers.get("x-filament-settings-boundary"), "the knobs changed between the turns: a boundary");
  });

  test("a native turn belongs to the server: the harness hanging up mid-turn (a reload) leaves it running, archived and ok — not aborted", async () => {
    writeFileSync(join(root, "note.txt"), "the note: use tabs\n");
    const id = await create("plain");
    let round = 0;
    brain = async (call) => {
      round++;
      if (round === 1) return reply([toolUse("r1", "read", { path: "note.txt" })], "tool_use");
      await new Promise((r) => setTimeout(r, 400)); // the client is long gone by the time the closing reply comes
      return reply([{ type: "text", text: "Finished after the client left." }]);
    };
    up.reset();
    // A streaming turn over a raw socket, destroyed as soon as the first bytes of the reply arrive.
    const http = await import("node:http");
    const u = new URL(`${shim.url}/api/sessions/${encodeURIComponent(id)}/turns`);
    await new Promise((resolve, reject) => {
      const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { ...shim.headers, "x-filament-ui": "1" } }, (res) => {
        res.once("data", () => { req.destroy(); resolve(undefined); });
        res.on("error", () => {});
      });
      req.on("error", (e) => (/aborted|socket hang up|ECONNRESET/i.test(String(e.message)) ? resolve(undefined) : reject(e)));
      req.end(JSON.stringify({ content: "read note.txt slowly", stream: true }));
    });
    let t = await transcript(id);
    const deadline = Date.now() + 10_000;
    while (t.live && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      t = await transcript(id);
    }
    assert.equal(t.live, null, "the turn ended on its own");
    assert.equal(round, 2, "the model was called again after the hang-up");
    assert.equal(t.turns.length, 1);
    assert.equal(t.turns[0].open, false);
    assert.deepEqual(t.turns[0].final.content, [{ type: "text", text: "Finished after the client left." }]);
    assert.equal(t.turns[0].work.length, 2);
    const rec = await shim.record(t.turns[0].requestIds[0]);
    assert.equal(rec.status, "ok", `the record is a success, not aborted: ${rec.status} ${rec.error || ""}`);
    assert.equal(rec.agent.status, "done");
  });

  // (fails before: filament_recall came with the fold — turn 1's ticks went without it and turn 2's carried it, so the
  // tools section changed under the conversation the provider caches.)
  test("P4: filament_recall rides every tick from the session's first (memory's tools off here), so a fold compaction leaves the tools as they were; the model asks for turn 1 and gets its tool result back verbatim, inside the tick", async () => {
    writeFileSync(join(root, "recall.txt"), "the recall note: use spaces, two of them\n");
    const id = await create("plain");
    const settings = (change) => shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: change });
    await settings({ patch: { context: { compaction: { keepWhole: 0 } }, model: { thinking: { budget: 2048 } } } });
    /** @type {string[][]} */
    const toolNames = [];
    /** @type {any[][]} */
    const bodies = [];
    /** @type {any[]} */
    const thinkingParams = [];
    let round = 0;
    brain = (call) => {
      round++;
      toolNames.push(call.body.tools.map((t) => t.name));
      bodies.push(structuredClone(call.body.messages));
      thinkingParams.push(call.body.thinking ?? null);
      if (round === 1) return reply([{ type: "text", text: "Reading." }, toolUse("r1", "read", { path: "recall.txt" })], "tool_use");
      if (round === 2) return reply([{ type: "text", text: "Read it." }]);
      if (round === 3) return reply([toolUse("rc1", "filament_recall", { turn: 1 })], "tool_use");
      const res = lastResults(call.body.messages);
      assert.equal(res.length, 1); assert.equal(res[0].tool_use_id, "rc1");
      assert.match(res[0].content, /^## Turn 1\n/);
      assert.match(res[0].content, /the recall note: use spaces, two of them/, "the archived result, verbatim");
      return reply([{ type: "text", text: "In turn 1 I read recall.txt: use spaces, two of them." }]);
    };
    up.reset();
    const r1 = await turn(id, "read recall.txt");
    assert.equal(text(r1.json.content), "Reading.Read it.");
    assert.ok(toolNames[0].includes("filament_recall"), `the tool rides the session's first tick: ${toolNames[0].join(", ")}`);
    assert.deepEqual(thinkingParams.slice(0, 2), [{ type: "enabled", budget_tokens: 2048 }, { type: "enabled", budget_tokens: 2048 }], "model.thinking.budget rides every round of the loop's ticks, not only the composed body");
    assert.ok(!toolNames[0].some((n) => n.startsWith("filament_memory_")), "memory's own tools stay off (autopilot off)");
    const folded = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: { method: "fold" } })).json();
    assert.equal(folded.compaction?.method, "fold", JSON.stringify(folded));
    const r2 = await turn(id, "what did you read in turn 1?");
    assert.equal(text(r2.json.content), "In turn 1 I read recall.txt: use spaces, two of them.");
    assert.equal(round, 4, "the recall round happened inside the tick");
    assert.deepEqual([toolNames[1], toolNames[2], toolNames[3]], [toolNames[0], toolNames[0], toolNames[0]], "every tick, before the fold and after, offers the same tools");
    // Turn 2's history: turn 1 folded (a stub line for the read, no tool_result), so the model needed the tool.
    const hist = bodies[2];
    assert.equal(hist.filter((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b?.type === "tool_result")).length, 0, "no raw tool_result in the folded history");
    assert.ok(hist.some((m) => m.role === "assistant" && /Filament folded this turn/.test(text(m.content))), "the fold's head line");
    const rec = await shim.record(r2.headers.get("x-filament-request-id"));
    const all = (await (await shim.api("/api/requests?limit=50&scope=all")).json()).requests;
    const tick = all.find((x) => x.agentOf === rec.id);
    assert.ok(tick, "the tick record");
    assert.equal(tick.memory?.recalls, 1);
    assert.ok((tick.changes || []).some((c) => /context: the model brought 1 archived turn or result back through filament_recall/.test(c)), (tick.changes || []).join("\n"));
    assert.ok((tick.priorChanges || tick.changes || []).some((c) => /filament_recall offered/.test(c)) || (rec.priorChanges || []).some((c) => /filament_recall offered/.test(c)));
    assert.equal(rec.agent?.recalls, 1, "the turn's own record rolls the ticks' recalls up (the footer reads this one)");
    assert.ok((rec.changes || []).some((c) => /context: the model brought 1 archived turn or result back through filament_recall during this turn/.test(c)), (rec.changes || []).join("\n"));
    const t = await transcript(id);
    assert.equal(t.turns[1].work.length, 0, "the recall exchange is Filament's, not the turn's work");
    assert.deepEqual(t.turns[1].final.content, [{ type: "text", text: "In turn 1 I read recall.txt: use spaces, two of them." }]);
    // The row answers the same question for the inspector.
    const row = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/recall`, { method: "POST", body: { turn: 1 } })).json();
    assert.match(row.text, /the recall note: use spaces/);
  });

  test("P4: loop.resultCapChars — a long tool result reaches the model as its head plus a pointer, is archived whole, and filament_recall({ result }) brings it back", async () => {
    const long = `${"line of the long file\n".repeat(120)}THE LAST LINE`;
    writeFileSync(join(root, "long.txt"), long);
    const id = await create("plain");
    await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { loop: { resultCapChars: 400 } } } });
    /** @type {any[][]} */
    const bodies = [];
    let round = 0;
    brain = (call) => {
      round++;
      bodies.push(structuredClone(call.body.messages));
      if (round === 1) return reply([toolUse("l1", "read", { path: "long.txt" })], "tool_use");
      if (round === 2) {
        const res = lastResults(call.body.messages)[0];
        assert.ok(res.content.length < 700, `capped: ${res.content.length} chars`);
        assert.match(res.content, /more characters archived, not shown \(loop.resultCapChars 400\); filament_recall\(\{ result: "r:[0-9a-f]{8}" \}\) brings the whole result back\]$/);
        assert.ok(!res.content.includes("THE LAST LINE"), "the tail is not in the window");
        const ref = res.content.match(/r:([0-9a-f]{8})/)[1];
        return reply([toolUse("rc", "filament_recall", { result: `r:${ref}` })], "tool_use");
      }
      const res = lastResults(call.body.messages)[0];
      assert.equal(res.tool_use_id, "rc");
      assert.match(res.content, /^Result of read in turn 1:\n/);
      assert.ok(res.content.includes("THE LAST LINE"), "the whole result came back");
      return reply([{ type: "text", text: "The file ends with THE LAST LINE." }]);
    };
    up.reset();
    const r = await turn(id, "read long.txt and tell me its last line");
    assert.equal(text(r.json.content), "The file ends with THE LAST LINE.");
    assert.equal(round, 3);
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.equal(rec.agent.cappedResults, 1);
    assert.ok(rec.changes.some((c) => /1 tool result longer than 400 characters reached the model as head \+ pointer/.test(c)), rec.changes.join("\n"));
    const t = await transcript(id);
    assert.equal(t.turns[0].capped, 1);
    const archivedResult = t.turns[0].work.find((m) => m.role === "user")?.content[0];
    assert.ok(archivedResult.content.length < 700, "the turn's work holds what the model saw");
    const row = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/recall`, { method: "POST", body: { result: archivedResult.content.match(/r:([0-9a-f]{8})/)[1] } })).json();
    assert.ok(row.text.includes("THE LAST LINE") && row.text.length > 2500, "the whole result is in the archive");
  });
});
