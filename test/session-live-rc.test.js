// HarnessV3 Step 3, Phase 3E re-checks: the findings of the phase's two reviews that stand, pinned — the harness's own
// stop branch, and the transcript's rewound decorations.
import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, upstreamControls, readEvents } from "./helpers/wait.js";
import { textOpen, textDelta, textsOf } from "./helpers/sse.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";

const SYS = { role: "system", content: "You help." };
const person = (text) => ({ role: "user", content: [{ type: "text", text }] });

describe("the review's re-checks (3E findings)", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root;
  /** @type {any[]} */
  let upstreamCalls = [];
  /** @type {((call: any) => any)[]} */
  let script = [];
  const setScript = (...fns) => {
    script = fns;
    upstreamCalls = [];
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-live3-"));
    up = await fakeUpstream(async (call) => {
      upstreamCalls.push(call);
      const fn = script[Math.min(Math.max(upstreamCalls.length - 1, 0), script.length - 1)];
      return fn ? fn(call) : anthropicReply("ok", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
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
  const { hold, feed, letGo } = upstreamControls();
  afterEach(letGo);
  const archive = () => /** @type {any} */ (shim.app.memory).archive;
  const zc = (path, messages, sid, stream) =>
    shim.post(path, { model: "m-1", max_tokens: 100, stream: !!stream, messages }, { "x-session-id": sid, "x-filament-cwd": root, "user-agent": "opencode/1.0" });
  /** OpenCode opens the session: one turn, answered "a one" — the history every later request of the test resends. */
  const seed = async (sid) => {
    setScript(() => anthropicReply("a one", { model: "m-1" }));
    assert.equal((await zc("/v1/messages", [SYS, person("one")], sid)).status, 200);
    return archive().chainIdForKey(chainKeyForConversationId(sid));
  };
  /** The harness's Stop on the session: 200, and what the route answered. */
  const stopFromHarness = async (chainId) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/stop`, { method: "POST" });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    return JSON.parse(text);
  };
  const transcript = async (chainId) => (await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/transcript`)).json();
  /** A session of the harness's own: its id. */
  const harnessSession = async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    assert.equal(created.status, 200);
    return String((await created.json()).id);
  };

  // (fails before: yes — the stop answered ok and did nothing: a steer that found no run counted as done, and before
  // the reply's head there was no request id to cancel by, so the turn ran on until the model answered)
  test("the harness's own stop ends its turn, before the reply's head and mid-stream, and frees the session", async () => {
    const chainId = await harnessSession();
    const turnsUrl = `/api/sessions/${encodeURIComponent(chainId)}/turns`;
    const free = () => until(async () => (await transcript(chainId)).live === null, "the session to be free again");
    // Before the head: the upstream is silent, so no request id exists yet
    const held = hold(anthropicReply("never sent", { model: "m-1" }));
    setScript(held.script);
    let ended = false;
    const quiet = shim.api(turnsUrl, { method: "POST", body: { content: "harness asks", stream: false } }).finally(() => {
      ended = true;
    });
    await held.arrived;
    const out = await stopFromHarness(chainId);
    assert.ok(out.ok && out.holder?.window === "harness", "the harness branch");
    // Its run exists before its head is out: the session finds it and steers it (HarnessV4_Four_Plan §4.5), as it
    // steers a streamed turn's, so the turn ends stopped with its work instead of cancelled.
    assert.equal(out.stopped, "steered", "the turn's run, found by the session, takes the stop as a steer");
    assert.equal(out.runs?.length, 1, "and is named for Force");
    await until(() => ended, "the turn to end at the stop, its upstream still silent");
    await quiet;
    await free();
    // Mid-stream: the head is written, so the request id is known — and the steer finds no run under it
    const upstream = feed([...textOpen(), textDelta("partial ")]);
    setScript(() => upstream);
    const reply = readEvents(await shim.api(turnsUrl, { method: "POST", body: { content: "harness streams", stream: true } }));
    await until(() => textsOf(reply.events).length === 1, "the turn's first delta");
    assert.equal((await stopFromHarness(chainId)).stopped, "steered", "the loop's run takes the stop as a steer");
    await until(() => reply.ended, "the stream to end at the stop");
    await free();
  });

  test("the transcript decorates a rewound line with its range and client", async () => {
    const sid = "rc-9";
    const chainId = await seed(sid);
    for (const t of ["two", "three", "four"]) assert.equal((await zc("/v1/messages", [SYS, person(t)], sid)).status, 200);
    // rewind: the history holds turn 1 only, plus a new ask (turns 2-4 become the rewound line)
    assert.equal((await zc("/v1/messages", [SYS, person("one"), { role: "assistant", content: "a one" }, person("edited")], sid)).status, 200);
    const tr = await transcript(chainId);
    const marked = tr.turns.filter((t) => t.rewound);
    assert.ok(marked.length >= 2, "the line covers its turns");
    for (const t of marked) {
      assert.equal(t.rewound.from, marked[0].n, "the range's from is on every turn of the line");
      assert.equal(t.rewound.to, marked.at(-1).n, "and its to");
      assert.equal(t.rewound.client, "opencode", "the re-winding window's client is named");
      assert.ok(t.rewound.line, "the line id travels");
    }
  });
});
