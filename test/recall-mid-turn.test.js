// filament_recall across a fold in the middle of a turn (HarnessV4_Tasks C33; the owner's rules of 10-31: prompt
// caching stays intact). The tool rides every request of Filament's own chats, so a fold of the earlier turns while the
// turn runs changes the messages and leaves the tools section as it was.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeUpstream, startApp, anthropicReply } from "./helpers/app.js";

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let root;
/** @type {(call: any) => any} */
let brain = () => undefined;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-recall-mid-"));
  // Files whose reads come back at the read tool's cap, about 8K tokens each: two earlier turns hold two of them, and
  // the third turn's first read takes the chat past its line at half of an 89K window, the earlier turns the bigger part.
  // The tools and the system prompt weigh about 25K of it: the third turn opens near 41K and its read takes it near 49K,
  // the line between with room on both sides (at 80K it stood under the turn's start once the thread tool came).
  for (const name of ["one", "two", "three"]) writeFileSync(join(root, `${name}.txt`), Array.from({ length: 2400 }, (_, i) => `${name} line ${i}: some words to read`).join("\n"));
  up = await fakeUpstream(async (call) => brain(call));
  shim = await startApp({
    memory: true,
    keep: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-small": { input: 1, output: 1, contextTokens: 89_000 } } }];
      cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.memory.autopilot = { enabled: false };
      cfg.memory.capture = { turns: true, learn: false };
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
    },
  });
});
after(async () => {
  await shim.stop();
  await up.close();
  for (const dir of [shim.dataDir, root]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

/** The tools a call offered, by name. @param {any} body */
const toolNames = (body) => (body.tools || []).map((/** @type {any} */ t) => t.name);

// (fails before: the tool came with the fold — the turn's first round went without it and its second round carried it,
// so the tools section changed under the conversation the provider caches)
test("a fold of the earlier turns in the middle of a turn leaves the tools as they were: filament_recall rode every round from the session's first", async () => {
  const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-small", preset: "plain", settings: { context: { compaction: { method: "fold", mode: "auto", thresholdPercent: 50 } } } } });
  if (made.status !== 200) assert.fail(await made.text());
  const id = (await made.json()).id;
  /** @type {any[]} */
  const bodies = [];
  let file = "one";
  brain = (call) => {
    bodies.push(call.body);
    const last = call.body.messages.at(-1);
    const answered = Array.isArray(last?.content) && last.content.some((/** @type {any} */ b) => b.type === "tool_result");
    return answered
      ? anthropicReply(`Read ${file}.txt.`, { model: "brain-small", usage: { input_tokens: 5, output_tokens: 3 } })
      : anthropicReply("", { model: "brain-small", stop: "tool_use", blocks: [{ type: "tool_use", id: `r-${file}`, name: "read", input: { path: `${file}.txt` } }], usage: { input_tokens: 5, output_tokens: 3 } });
  };
  const turn = async (/** @type {string} */ content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return r.json();
  };
  await turn("read one.txt");
  file = "two";
  await turn("read two.txt");
  file = "three";
  const first = bodies[0];
  const from = bodies.length;
  await turn("read three.txt");
  const third = bodies.slice(from);
  assert.equal(third.length, 2, `the third turn's two rounds: ${third.length}`);
  const said = (/** @type {any} */ b) => JSON.stringify(b.messages);
  assert.ok(!said(third[0]).includes("Filament folded this turn"), "the turn began with every earlier turn whole");
  assert.ok(said(third[1]).includes("Filament folded this turn"), `its second round carries the earlier turns folded: ${said(third[1]).slice(0, 400)}`);
  assert.ok(toolNames(first).includes("filament_recall"), `the session's first round offers the tool that brings results back: ${toolNames(first).join(", ")}`);
  assert.deepEqual([JSON.stringify(third[0].tools), JSON.stringify(third[1].tools)], [JSON.stringify(first.tools), JSON.stringify(first.tools)], "every round offers the same tools, the fold's round among them");
});
