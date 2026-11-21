// @ts-check
// The owner's word of 10-25: "the side agents when they need to compact their context then they should not use any of
// Filament compaction strategy, they should use the usual compaction every model uses and that is self model
// compaction. make sure side agents are not using any of Filament offerd compaction strategies". A sub-agent compacts by
// itself: its own model writes the summary of all of its work — reading its own conversation at the line or on a
// Compact, its transcript after a size refusal — and it goes on from that summary alone. None of Filament's own: no
// rounds kept whole, no old results cleared, no files brought back after the summary, never the session's writer or
// model. (A sub-agent's fold also broke on a provider that binds its thinking — thinking-binding.test.js.)
// (fails before: yes — its fold kept its newest rounds whole, written by the session's writer, files brought back,
// and a size refusal cleared its old results first)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";

const CHILD = "You are a sub-agent run by Filament";
const FOLD_ASK = /^\[Filament: (this turn has reached the compaction line|the developer asked to compact this turn now)\./;
const textOf = (/** @type {any} */ m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n"));
const results = (/** @type {any} */ c) => (c.body?.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).filter((/** @type {any} */ b) => b?.type === "tool_result");
const answersTo = (/** @type {any} */ c) => (Array.isArray(c.body?.messages?.at(-1)?.content) ? c.body.messages.at(-1).content : []).filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => b.tool_use_id);
const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let folder;
const held = deferred();
const heldShell = deferred();
const heldSkill = deferred();
/** The summaries written: by a fork of the agent's own conversation, or over a transcript; with the model asked. @type {{ how: "fork" | "transcript", model: string, ask: string }[]} */
const summaries = [];
let refusedOnce = false;

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-selfc-"));
  up = await fakeUpstream(async (call) => {
    const body = call.body || {};
    const system = JSON.stringify(body.system ?? "");
    const messages = body.messages || [];
    const model = body.model || "m-1";
    const blocks = (/** @type {any[]} */ b, stop = "end_turn") => anthropicReply("", { model, stop, blocks: b, usage: { input_tokens: 5, output_tokens: 3 } });
    const lastText = textOf(messages.at(-1));
    if (FOLD_ASK.test(lastText)) {
      summaries.push({ how: "fork", model, ask: lastText });
      return blocks([{ type: "text", text: "<summary>\nSELF SUMMARY: wrote a.txt, then read it.\n</summary>" }]);
    }
    if (system.includes("compaction summaries")) {
      summaries.push({ how: "transcript", model, ask: lastText.slice(0, 200) });
      return blocks([{ type: "text", text: "<summary>\nTRANSCRIPT SUMMARY: wrote b.txt.\n</summary>" }]);
    }
    if (system.includes(CHILD)) {
      const all = JSON.stringify(messages);
      const brief = textOf(messages[0]);
      if (/compact on the developer's word/.test(brief)) {
        if (all.includes("SELF SUMMARY")) return blocks([{ type: "text", text: "FOLDED BY ITSELF" }]);
        if (!answersTo(call).includes("toolu_s1")) return blocks([{ type: "tool_use", id: "toolu_s1", name: "write", input: { path: "a.txt", content: "a\n" } }], "tool_use");
        await held.promise;
        return blocks([{ type: "tool_use", id: "toolu_s2", name: "read", input: { path: "a.txt" } }], "tool_use");
      }
      if (/compact with a command running/.test(brief)) {
        if (all.includes("SELF SUMMARY")) return blocks([{ type: "text", text: "FOLDED WITH A COMMAND" }]);
        if (!answersTo(call).includes("toolu_b1")) return blocks([{ type: "tool_use", id: "toolu_b1", name: "bash_background", input: { command: 'node -e "setTimeout(()=>{},8000)"', grace: 0.1 } }], "tool_use");
        await heldShell.promise;
        return blocks([{ type: "tool_use", id: "toolu_b2", name: "read", input: { path: "a.txt" } }], "tool_use");
      }
      if (/compact after loading a skill/.test(brief)) {
        if (all.includes("SELF SUMMARY")) return blocks([{ type: "text", text: "FOLDED AFTER A SKILL" }]);
        if (!answersTo(call).includes("toolu_k1")) return blocks([{ type: "tool_use", id: "toolu_k1", name: "skill", input: { name: "deploy" } }], "tool_use");
        await heldSkill.promise;
        return blocks([{ type: "tool_use", id: "toolu_k2", name: "read", input: { path: "a.txt" } }], "tool_use");
      }
      if (/compact past the window/.test(brief)) {
        if (all.includes("TRANSCRIPT SUMMARY")) return blocks([{ type: "text", text: "OVERFLOW FOLDED" }]);
        if (!answersTo(call).includes("toolu_o1")) return blocks([{ type: "tool_use", id: "toolu_o1", name: "write", input: { path: "b.txt", content: "b\n" } }], "tool_use");
        if (!refusedOnce) {
          refusedOnce = true;
          return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000 maximum" } } };
        }
        return blocks([{ type: "text", text: "NOT FOLDED" }]);
      }
      return blocks([{ type: "text", text: "CHILD REPORT" }]);
    }
    return blocks([{ type: "text", text: "PLAIN ANSWER" }]);
  });
  shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000, windows: [200000, 1000000] }, "m-big": { input: 1, output: 1, contextTokens: 1000000 } } }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    },
  });
});
after(async () => {
  held.resolve();
  heldShell.resolve();
  heldSkill.resolve();
  await shim.stop();
  await up.close();
  for (const dir of [shim.dataDir, folder])
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
});

/** A session whose own compactions are written by another model, at half its window — the 1M one its model offers beside
 *  its standard 200k: a sub-agent's are its own all the same. */
const newSession = async () => {
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", settings: { model: { window: 1000000 }, context: { compaction: { model: "m-cheap", writer: "model", thresholdPercent: 50 } } } } });
  assert.equal(s.status, 200, await s.clone().text());
  return String((await s.json()).id);
};
/** @param {string} id @param {string} prompt */
const launch = async (id, prompt) => {
  const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt, description: "Self compaction", deliver: false } });
  assert.equal(spawn.status, 200, await spawn.clone().text());
  return String((await spawn.json()).subagent.id);
};
/** @param {string} id */
const settled = (id) =>
  until(async () => {
    const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
    return subagents.length && subagents.every((/** @type {any} */ s) => s.status !== "running") ? subagents : null;
  }, "its run to end");

test("a sub-agent's Compact: its own model reads all of its work and writes the summary; it goes on from that alone", async () => {
  const id = await newSession();
  const mark = up.received.length;
  const sa = await launch(id, "compact on the developer's word");
  await until(() => up.received.slice(mark).some((c) => answersTo(c).includes("toolu_s1")), "its second round in flight");
  const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
  const runId = String(subagents.find((/** @type {any} */ x) => x.id === sa)?.runId);
  const steer = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "compact", text: "", from: "harness" } });
  assert.equal(steer.status, 200, await steer.clone().text());
  held.resolve();
  const [done] = await settled(id);
  assert.deepEqual([done.status, done.exchanges[0].report], ["done", "FOLDED BY ITSELF"]);
  // Its own model, forking its own conversation, asked for all of it: never the session's writer (m-cheap).
  assert.deepEqual(summaries.map((s) => [s.how, s.model]), [["fork", "m-1"]]);
  assert.match(summaries[0].ask, /your newest tool calls and their results too: nothing of it stays but your summary\. You continue the work from it, as from your brief\./);
  // The round after it: the brief and its summary alone — no round kept whole, no file brought back.
  const after = up.received.slice(mark).filter((c) => JSON.stringify(c.body?.system ?? "").includes(CHILD) && JSON.stringify(c.body?.messages || []).includes("SELF SUMMARY"));
  assert.equal(after.length, 1);
  assert.deepEqual(results(after[0]), [], "every result folded into its summary");
  assert.ok(!JSON.stringify(after[0].body.messages).includes("brought these back after the summary"), "no file brought back");
  assert.equal(after[0].body.messages.at(-1).role, "user");
  const rec = await shim.record(runId);
  assert.ok((rec.changes || []).some((/** @type {string} */ c) => /compacted rounds 1–2 of this turn on the developer's request, summarized by m-1, itself/.test(c)), JSON.stringify(rec.changes));
  // (fails before: yes — its line was its session's, half the window; and, the Hunter's find of 10-27, its window was
  // the session's 1M) The owner's word of 10-25: "they should get the default 85% compaction line threshold of the
  // context window model offers".
  assert.deepEqual([rec.context?.window, rec.context?.usable], [200_000, 170_000], "its line: 85% of its model's standard window, not the session's 50% of 1M");
});

// The owner's word of 11-02: a sub-agent's line is the lower of 400K and 85% of its window — "the sweet spot i have
// found ... is 400K".
// (fails before: yes — its line was 85% of its model's 1M window, 850,000)
test("a sub-agent whose model's window is 1M compacts at 400,000, not at 85% of it", async () => {
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-big" } });
  assert.equal(s.status, 200, await s.clone().text());
  const id = String((await s.json()).id);
  await launch(id, "look aside");
  const [done] = await settled(id);
  assert.equal(done.status, "done", JSON.stringify(done));
  const rec = await shim.record(String(done.runId));
  assert.deepEqual([rec.context?.window, rec.context?.usable], [1_000_000, 400_000]);
});

test("a sub-agent refused for size: no results cleared; its own model summarizes its transcript, all of it", async () => {
  summaries.length = 0;
  const id = await newSession();
  const mark = up.received.length;
  await launch(id, "compact past the window");
  const [done] = await settled(id);
  assert.deepEqual([done.status, done.exchanges[0].report], ["done", "OVERFLOW FOLDED"]);
  assert.deepEqual(summaries.map((s) => [s.how, s.model]), [["transcript", "m-1"]], "no fork of a conversation the provider refused for size; its own model, not m-cheap");
  const retried = up.received.slice(mark).filter((c) => JSON.stringify(c.body?.system ?? "").includes(CHILD) && JSON.stringify(c.body?.messages || []).includes("TRANSCRIPT SUMMARY"));
  assert.equal(retried.length, 1);
  assert.deepEqual(results(retried[0]), [], "nothing kept whole, nothing cleared in place");
  assert.ok(!JSON.stringify(retried[0].body.messages).includes("[Filament cleared"), "no result was cleared");
});

// (fails before: yes — the review of 11-09: a sub-agent's block after its fold asked it to dismiss lines with Filament's
// envelope tool, whose dismiss only the chat's main agent has, and its call was refused)
test("a sub-agent's fold with its command still running: the block asks it to go through what was open, never to dismiss", async () => {
  // Its command runs without asking the person.
  const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", settings: { loop: { permissions: "auto" } } } });
  assert.equal(s.status, 200, await s.clone().text());
  const id = String((await s.json()).id);
  const mark = up.received.length;
  const sa = await launch(id, "compact with a command running");
  await until(() => up.received.slice(mark).some((c) => answersTo(c).includes("toolu_b1")), "its second round in flight");
  const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
  const runId = String(subagents.find((/** @type {any} */ x) => x.id === sa)?.runId);
  const steer = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "compact", text: "", from: "harness" } });
  assert.equal(steer.status, 200, await steer.clone().text());
  heldShell.resolve();
  const [done] = await settled(id);
  assert.deepEqual([done.status, done.exchanges[0].report], ["done", "FOLDED WITH A COMMAND"]);
  // The round after the fold (another follows it: Filament reminds it at its end of the command that still runs).
  const after = up.received.slice(mark).filter((c) => JSON.stringify(c.body?.system ?? "").includes(CHILD) && JSON.stringify(c.body?.messages || []).includes("SELF SUMMARY"));
  assert.ok(after.length >= 1);
  const block = (after[0].body.messages || []).map(textOf).find((/** @type {string} */ t) => t.includes("<open>")) || "";
  assert.match(block, /Go through what was open now: apply a change that waits or leave it, follow up a sub-agent or leave it\./);
  assert.match(block, /\n<open>\n- background command bg_\w+: `node -e/);
  assert.doesNotMatch(block, /dismiss/);
});

// (fails before: yes — the re-review of 11-11, finding 4: the fold named a skill by the turn it was loaded in, so a run
// with no turn of its own, a sub-agent's, was handed none — and followed one whose text went with its folded rounds)
test("a sub-agent's fold names the skill its folded rounds loaded, to load again", async () => {
  // The Library holds one from here on: the skill tool is offered, a sub-agent's run too.
  assert.equal((await shim.api("/api/skills", { method: "POST", body: { make: "deploy", description: "Ship a release." } })).status, 200);
  const id = await newSession();
  const mark = up.received.length;
  const sa = await launch(id, "compact after loading a skill");
  const second = await until(() => up.received.slice(mark).find((c) => answersTo(c).includes("toolu_k1")) || null, "its second round in flight");
  assert.ok(results(second).some((/** @type {any} */ r) => r.tool_use_id === "toolu_k1" && !r.is_error), `the skill loaded: ${JSON.stringify(results(second))}`);
  const { subagents } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json();
  const runId = String(subagents.find((/** @type {any} */ x) => x.id === sa)?.runId);
  const steer = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "compact", text: "", from: "harness" } });
  assert.equal(steer.status, 200, await steer.clone().text());
  heldSkill.resolve();
  const [done] = await settled(id);
  assert.deepEqual([done.status, done.exchanges[0].report], ["done", "FOLDED AFTER A SKILL"]);
  const after = up.received.slice(mark).filter((c) => JSON.stringify(c.body?.system ?? "").includes(CHILD) && JSON.stringify(c.body?.messages || []).includes("SELF SUMMARY"));
  assert.ok(after.length >= 1);
  const block = (after[0].body.messages || []).map(textOf).find((/** @type {string} */ t) => t.includes("<skills>")) || "";
  assert.match(block, /\n<skills>\n- deploy\n<\/skills>/, JSON.stringify(after[0].body.messages).slice(0, 3000));
  assert.ok(block.includes("A skill named was loaded in the turns the summary stands for, and its text went with them: load it again with Filament's `skill` tool before you follow it."), block);
});
