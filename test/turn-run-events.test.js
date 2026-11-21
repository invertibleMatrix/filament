// @ts-check
// HarnessV3-Responsiveness R3 (2026-10-01): a harness turn took two of the six connections a browser gives Filament —
// its reply, and a second stream for its run's events (the cards) — beside the events feed and the chat's live topic
// that every idle page held. With a sub-agent window or two open, a click on the compaction widget queued behind
// them. The turn's reply carries its run's events itself, and an idle page holds the events feed alone, which says
// what it hears of a chat — its holder, its commands, its agent's tasks: the server keeps no stream of a session's own.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

/** The SSE frames of a reply body: `{ event, data }`, the data parsed. @param {string} body */
const framesOf = (body) =>
  body
    .split(/\n\n/)
    .map((f) => {
      const event = /^event: (.*)$/m.exec(f)?.[1] || null;
      const data = /^data: (.*)$/m.exec(f)?.[1];
      let j = null;
      try {
        j = data ? JSON.parse(data) : null;
      } catch {}
      return { event, data: j };
    })
    .filter((f) => f.data);

describe("the harness turn's reply carries its run's events", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-turn-run-events-"));
    up = await fakeUpstream((call) => {
      if (call.kind !== "anthropic") return undefined;
      const last = (call.body?.messages || []).at(-1);
      const done = Array.isArray(last?.content) && last.content.some((/** @type {any} */ b) => b?.type === "tool_result");
      return done
        ? anthropicReply("all done", { model: "brain-model" })
        : anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "g1", name: "glob", input: { pattern: "*" } }] });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [shim.dataDir, root]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });
  const session = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };

  // (fails before: the reply had no run frames, and the page opened a second stream for them)
  test("run-start to run-end, in order, the same events the run's log serves; the head says so", async () => {
    const id = await session();
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "list the files", stream: true, runEvents: true } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-filament-run-events"), "1", "the head says the reply carries them");
    const runId = String(res.headers.get("x-filament-request-id") || "");
    const frames = framesOf(await res.text());
    const carried = frames.filter((f) => f.event === "filament_run").map((f) => f.data);
    assert.ok(carried.length >= 4, `carried ${carried.length} run events`);
    assert.ok(carried.every((j) => j.type === "filament_run" && j.event?.n > 0), "each frame names itself and wraps one numbered event");
    const evs = carried.map((j) => j.event);
    assert.equal(evs[0].type, "run-start");
    assert.equal(evs[0].kind, "agent-turn");
    assert.equal(evs.at(-1).type, "run-end", "the run's end rides the reply: it is published before the reply closes");
    assert.deepEqual(evs.map((e) => e.n), evs.map((_, i) => i + 1), "every event once, in order, none skipped");
    assert.ok(evs.some((e) => e.type === "tool-start" && e.name === "glob"));
    const logged = (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
    assert.deepEqual(evs, logged, "byte for byte the run's own log");
    // The reply itself is untouched: its own events never carry the side frames' type, and the text is all there.
    const own = frames.filter((f) => f.event !== "filament_run").map((f) => f.data);
    assert.ok(own.every((j) => j.type !== "filament_run"));
    assert.ok(own.some((j) => j.type === "message_stop"));
    const text = own.filter((j) => j.type === "content_block_delta" && j.delta?.type === "text_delta").map((j) => j.delta.text).join("");
    assert.match(text, /all done/);
  });

  // (fails before: yes — the reply serialised each run event again, wrapped in its frame, beside the log's own JSON of it)
  test("the reply writes each run event from the JSON the run's log made of it: it serialises none of its own", async () => {
    const id = await session();
    let wrapped = 0;
    const real = JSON.stringify;
    JSON.stringify = /** @type {any} */ (function (/** @type {any} */ v, /** @type {any[]} */ ...rest) {
      if (v?.type === "filament_run") wrapped++;
      return real.call(JSON, v, ...rest);
    });
    let body = "";
    try {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "list the files", stream: true, runEvents: true } });
      body = await res.text();
    } finally {
      JSON.stringify = real;
    }
    const carried = framesOf(body).filter((f) => f.event === "filament_run");
    assert.ok(carried.length >= 4, `carried ${carried.length} run events`);
    assert.equal(wrapped, 0, "no frame serialised by the reply");
    // Each frame is the bytes the wrapper's own JSON would be.
    for (const f of body.split("\n\n").filter((s) => s.startsWith("event: filament_run\n"))) {
      const data = f.slice("event: filament_run\ndata: ".length);
      assert.equal(data, real({ type: "filament_run", event: JSON.parse(data).event }));
    }
  });

  test("a turn that does not ask, and a front-door reply, carry none — byte for byte as before", async () => {
    const id = await session();
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "list the files", stream: true } });
    assert.equal(res.headers.get("x-filament-run-events"), null);
    const body = await res.text();
    assert.doesNotMatch(body, /filament_run/);
    const front = await fetch(`${shim.url}/v1/messages`, {
      method: "POST",
      headers: { ...shim.headers, "x-filament-cwd": root, "x-session-id": "s-front-run-events", "x-filament-run-events": "1" },
      body: JSON.stringify({ model: "brain-model", max_tokens: 400, stream: true, runEvents: true, messages: [{ role: "user", content: "list the files" }] }),
    });
    assert.equal(front.status, 200);
    assert.equal(front.headers.get("x-filament-run-events"), null, "a client cannot ask for them");
    assert.doesNotMatch(await front.text(), /filament_run/);
  });

  // (fails before: yes — on c97b98c59 every holder change of the turn went out on a topic of the chat's own,
  // `session:<id>`, too, and GET /sessions/:id/live streamed that topic, which no page of Filament's followed)
  test("the server keeps no stream of a session's own: a turn says nothing on a topic of its chat's own, and the session's live address is no route (R3)", async () => {
    const id = await session();
    /** @type {string[]} */
    const own = [];
    /** @type {string[]} */
    const turns = [];
    const off = shim.app.events.subscribe("*", (/** @type {any} */ p, /** @type {any} */ e) => {
      if (String(e.topic).includes(id)) own.push(e.topic);
      else if (e.topic === "turns" && p?.type === "turn" && p.chainId === id) turns.push(p.holder ? "take" : "release");
    });
    try {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "list the files", stream: true, runEvents: true } });
      assert.equal(res.status, 200);
      await res.text();
    } finally {
      off();
    }
    assert.deepEqual(own, [], "nothing on a topic of the chat's own");
    assert.deepEqual([turns[0], turns.at(-1)], ["take", "release"], "its holder rides the feed's `turns`");
    const live = await shim.api(`/api/sessions/${encodeURIComponent(id)}/live`);
    const answer = live.status === 404 ? await live.json() : (await live.body?.cancel(), null);
    assert.deepEqual([live.status, answer], [404, { error: `unknown admin endpoint GET /sessions/${id}/live` }]);
  });
});

test("the page asks for the run events and draws the turn from them", () => {
  const api = readFileSync("src/ui/harness/lib/api.js", "utf8");
  assert.match(api, /stream: true,\s*runEvents: true,/, "postTurn asks");
  assert.match(api, /if \(j\?\.type === "filament_run"\) \{\s*if \(j\.event\) onRunEvent\?\.\(j\.event\);\s*return;/, "readReply hands them over, past the accumulator");
  assert.match(api, /runEvents: res\.headers\.get\("x-filament-run-events"\) === "1"/);
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  // A lookup otherwise only where the head names a run (HarnessV3-Launch LD-D13, test/turn-run-mark.test.js).
  assert.match(app, /if \(marks\.runEvents\) carried = true;\s*else if \(marks\.run\) detectRun\(id\);/, "no run lookup or second stream while the reply carries the events");
  assert.match(app, /onRunEvent: carriedEvent,/);
});

// (fails before: yes — on e7f453755 app.js `hearAgentTasks` followed the chat shown's live topic at all times, for its
// agent's tasks: two long-lived streams on an idle page, three during its own turn, and the main window with two popped
// panes at the six a browser gives this host; on c97b98c59 live-topic.js's `followSession` still asked for the address)
test("an idle page holds the events feed alone, which carries a chat's agent tasks: no page asks for a stream of a session's own (R3)", () => {
  const pages = readdirSync("src/ui", { recursive: true })
    .map((p) => `src/ui/${String(p).replaceAll("\\", "/")}`)
    .filter((p) => /\.(js|mjs)$/.test(p) && !p.includes("/vendor/"));
  assert.ok(pages.includes("src/ui/harness/app.js") && pages.includes("src/ui/app.js"), "the harness page and the console are read");
  const read = (/** @type {string} */ p) => readFileSync(p, "utf8");
  const liveViews = pages.filter((p) => /sessions\/\$\{[^}]*\}\/live[`"'?]/.test(read(p)));
  assert.deepEqual(liveViews, [], "no page asks for a session's live stream by its address");
  // What the page hears of a chat rides the feed: the chat's agent tasks, with its id, on `turns`
  // (agent-tasks-feed.test.js drives how often).
  assert.match(read("src/server.js"), /tasksOnFeed\(chain, \{ type: "agent-tasks", chainId: chain, sessionId, tasks \}\);/);
  assert.match(read("src/server.js"), /const tasksOnFeed = \(chain, msg\) => \{[\s\S]*?events\.publish\("turns", msg\);/);
  assert.match(read("src/ui/harness/app.js"), /if \(msg\?\.type === "agent-tasks" && msg\.chainId\) setAgentTasks\(String\(msg\.chainId\), msg\.tasks\);/);
});
