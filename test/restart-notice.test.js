// BUG-26's crash case (HarnessV3-FixRound F4 item 19). A graceful stop cuts every running sub-agent and leaves its
// session a notice; a process that died (a crash, a kill) ran no stop, so its sub-agents vanished unannounced and their
// runs stayed open on disk for ever. The next start reads the runs a process left open: each sub-agent's session hears
// it once, in a restart's words, and the run's end is written, so a later start finds nothing to tell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const knobs = () => ({ observability: { runEvents: { persist: true, retentionDays: 7, maxPerRun: 1000, keepRuns: 50 } } });

test("the run log names the sub-agent runs an earlier process left open, and writes their end once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-runs-"));
  try {
    const bus = createEventBus();
    const first = createRunLog({ events: bus, dataDir: dir, config: knobs });
    const brief = { agentId: "sa_00000001", exchange: 0, description: "Audit", task: "audit it", by: "owner", deliver: true };
    first.startRun({ id: "sub-open", kind: "subagent", meta: { chain: "c1", subagent: "sa_00000001" }, brief });
    bus.publish("run:sub-open", { type: "round-start", round: 1 });
    bus.publish("run:sub-open", { type: "round-start", round: 2 });
    first.startRun({ id: "sub-done", kind: "subagent", meta: { chain: "c1", subagent: "sa_00000002" } });
    first.endRun("sub-done", { status: "done" });
    first.startRun({ id: "turn-open", kind: "agent-turn", meta: { chain: "c1" } });
    assert.ok(!("brief" in /** @type {any} */ (first.getRun("sub-open"))), "the brief rides the start event, never the meta the runs list carries");
    assert.deepEqual(await first.openOnDisk("subagent"), [], "a run live in this process is not left open");
    assert.equal(first.closeOnDisk("sub-open", { status: "aborted" }), false, "nor ended from its file while it runs");
    assert.equal(first.getRun("sub-open")?.status, "running");
    first.close();

    /** @type {any[]} */
    const ops = [];
    const second = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs, ops: { record: (kind, title, o) => ops.push({ kind, title, ...o }) } });
    const open = await second.openOnDisk("subagent");
    assert.deepEqual(open.map((o) => [o.id, o.rounds, o.brief?.task, o.meta?.chain, o.meta?.subagent]), [["sub-open", 2, "audit it", "c1", "sa_00000001"]], "only the sub-agent run with no end — not an ended one, not an agent turn");
    assert.equal(second.closeOnDisk("sub-open", { status: "aborted", summary: { error: "Filament stopped before it finished" } }), true);
    assert.equal(second.closeOnDisk("sub-open", { status: "aborted" }), false, "once");
    assert.equal(second.closeOnDisk("sub-done", { status: "aborted" }), false, "an ended run is left as it ended");
    assert.equal(second.getRun("sub-open")?.status, "aborted");
    assert.ok(ops.some((o) => o.kind === "run" && /sub-open ended: aborted — left open by the last stop/.test(o.title) && o.level === "warn"), JSON.stringify(ops));
    second.close();

    const third = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs });
    assert.deepEqual(await third.openOnDisk("subagent"), [], "a later start finds nothing to tell");
    assert.equal(third.getRun("sub-open")?.status, "aborted", "the run reads as ended, from its file");
    third.close();
  } finally {
    await removeDirs(dir);
  }
});

test("a real sub-agent's run carries its brief; a start after a crash tells its session once and ends the run", async () => {
  /** @type {() => void} */
  let release = () => {};
  const gate = new Promise((r) => (release = () => r(undefined)));
  const up = await fakeUpstream(async (/** @type {any} */ req) => {
    const last = req.body?.messages?.at(-1);
    const text = typeof last?.content === "string" ? last.content : (last?.content || []).map((/** @type {any} */ b) => b?.text || "").join("");
    if (/audit slowly/.test(text)) await gate;
    return anthropicReply("DONE", { model: "m-1" });
  });
  const folder = mkdtempSync(join(tmpdir(), "filament-restart-cwd-"));
  const configure = (/** @type {any} */ cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
    cfg.memory.autopilot = { enabled: false };
  };
  let shim = await startApp({ memory: true, keep: true, configure });
  const dataDir = shim.dataDir;
  try {
    const session = async () => String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1" } })).json()).id);
    const a = await session();
    const b = await session();
    // A real host run: its start line is what a crash leaves on disk.
    const spawn = await (await shim.api(`/api/sessions/${a}/subagents`, { method: "POST", body: { prompt: "audit slowly", description: "Slow audit" } })).json();
    const sa = spawn.subagent;
    const runId = await until(async () => {
      const { subagents } = await (await shim.api(`/api/sessions/${a}/subagents`)).json();
      return subagents.find((/** @type {any} */ s) => s.id === sa.id)?.runId || null;
    }, "the sub-agent's run");
    const startLine = readFileSync(join(dataDir, "runs", `${runId}.jsonl`), "utf8").split("\n")[0];
    const start = JSON.parse(startLine);
    assert.equal(start.type, "run-start");
    assert.deepEqual(start.brief, { agentId: sa.id, exchange: 0, description: "Slow audit", task: "audit slowly", by: "owner", deliver: true }, "what a restart notice needs, on the start event");
    const { run } = await (await shim.api(`/api/runs/${encodeURIComponent(runId)}`)).json();
    assert.ok(!("brief" in run) && !("brief" in (run.meta || {})), "not in the run's meta: the runs list stays small");
    release();
    await until(async () => (await (await shim.api(`/api/sessions/${a}/subagents`)).json()).subagents.every((/** @type {any} */ s) => s.status !== "running"), "the sub-agent to finish");
    await shim.stop();

    // What a crash leaves: that start line, under another run and sub-agent of session b, a round in, and no end — and
    // one more whose session is gone.
    const left = (/** @type {string} */ id, /** @type {string} */ agentId, /** @type {string} */ chain, /** @type {any[]} */ more = []) => {
      const s = { ...start, runId: id, meta: { ...start.meta, chain, subagent: agentId }, brief: { ...start.brief, agentId, task: "audit the cache layer" } };
      const rest = more.map((e, i) => ({ n: i + 3, seq: 0, ts: s.ts + 6 + i, runId: id, round: 1, ...e }));
      writeFileSync(join(dataDir, "runs", `${id}.jsonl`), [s, { n: 2, seq: 0, ts: s.ts + 5, runId: id, type: "round-start", round: 1 }, ...rest].map((e) => JSON.stringify(e)).join("\n") + "\n");
    };
    mkdirSync(join(dataDir, "runs"), { recursive: true });
    // (the transcript audit, 2026-10-23) It had said something and begun a call.
    left("crashed-run", "sa_0c0ffee1", b, [
      { type: "round-text", text: "The keys go stale in the cache layer." },
      { type: "tool-start", id: "c1", name: "read", args: "src/cache.js", card: { kind: "read", subject: "src/cache.js" } },
    ]);
    left("orphan-run", "sa_0c0ffee2", "no-such-session");

    shim = await startApp({ memory: true, keep: true, dataDir, configure });
    const listed = await (await shim.api(`/api/sessions/${b}/subagents`)).json();
    assert.equal(listed.queued, 1, "the session hears it once, with its next turn");
    const tr = await (await shim.api(`/api/sessions/${b}/transcript`)).json();
    const rows = tr.boundaries.filter((/** @type {any} */ x) => x.type === "subagent" && x.agentId === "sa_0c0ffee1");
    assert.deepEqual(rows.map((/** @type {any} */ x) => [x.event, x.status, x.delivery, x.error]), [["arrival", "aborted", "auto", "Filament stopped before it finished"]], "the developer's launch gets its row");
    for (const id of ["crashed-run", "orphan-run"]) {
      const { run: ended } = await (await shim.api(`/api/runs/${id}`)).json();
      assert.equal(ended.status, "aborted", `${id}: its end is written, the session gone or not`);
    }
    // The next turn opens with it, in a restart's words.
    const mark = up.received.length;
    const t = await shim.api(`/api/sessions/${b}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const first = up.received.slice(mark)[0];
    const opened = JSON.stringify(first.body.messages.at(-1));
    assert.match(opened, /sub-agent sa_0c0ffee1 \(\\"Slow audit\\"\) was cut by a Filament restart before it finished, after 1 round\. /);
    assert.match(opened, /Its task:\\naudit the cache layer/);
    // (fails before: yes — the transcript audit, 2026-10-23: the notice said what it had not reported was lost, whatever
    // its run's log held)
    assert.match(opened, /What its run's log shows of its work is below; the rest is lost; launch it anew/);
    assert.match(opened, /Before the cut:\\n\(It ended before it sent a report\. From its run's log, what it had written and the calls it made:\)\\n\\nThe keys go stale in the cache layer\.\\n\\nIts call:\\n- read src\/cache\.js: still running when its run ended/);
    await shim.stop();

    // A later start: nothing left open, nothing told again.
    shim = await startApp({ memory: true, keep: true, dataDir, configure });
    assert.equal((await (await shim.api(`/api/sessions/${b}/subagents`)).json()).queued, 0, "no second notice");
    const again = await (await shim.api(`/api/sessions/${b}/transcript`)).json();
    assert.equal(again.boundaries.filter((/** @type {any} */ x) => x.type === "subagent" && x.agentId === "sa_0c0ffee1").length, 1, "no second row");
  } finally {
    release();
    await shim.stop();
    await up.close();
    await removeDirs(dataDir, folder);
  }
});

test("the server settles the runs left open as memory opens, before a request that reads a session goes on", () => {
  const src = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const scan = src.indexOf('runs.openOnDisk("subagent")');
  assert.ok(scan > src.indexOf("subagents.setContext("), "after the registry can read the sessions");
  assert.ok(scan > src.indexOf("const openMemory = async () => {") && scan < src.indexOf("const afterListening = "), "in memory's open");
  assert.match(src, /wentOver = await \(openingNow = openMemory\(\)\);\s*\} finally \{\s*opened = true;\s*openedNow\(wentOver\);/, "the requests waiting at the front door go on once it has ended");
  assert.match(src.slice(scan, src.indexOf("keepCutTurns(", scan)), /subagents\.orphaned\([\s\S]*runs\.closeOnDisk\(/, "told, then ended, in the step's own lines");
});

// BUG-26's check: a report kept for the developer lived only in the registry, so a restart lost it while its row still
// said "report kept for you", with no Send. The session keeps it now, and the transcript says which still wait.
test("a report kept for the developer survives a server restart: the transcript keeps its Send, and Send passes it on", async () => {
  const up = await fakeUpstream(async () => anthropicReply("THE KEPT REPORT", { model: "m-1" }));
  const folder = mkdtempSync(join(tmpdir(), "filament-restart-cwd-"));
  const configure = (/** @type {any} */ cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
    cfg.memory.autopilot = { enabled: false };
  };
  let shim = await startApp({ memory: true, keep: true, configure });
  const dataDir = shim.dataDir;
  try {
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1" } })).json()).id);
    const { subagent } = await (await shim.api(`/api/sessions/${id}/subagents`, { method: "POST", body: { prompt: "look aside", description: "Aside", deliver: false } })).json();
    await until(async () => (await (await shim.api(`/api/sessions/${id}/subagents`)).json()).subagents.every((/** @type {any} */ s) => s.status !== "running"), "the sub-agent to finish");
    const key = `${subagent.id}:0`;
    assert.deepEqual((await (await shim.api(`/api/sessions/${id}/transcript`)).json()).subagentHeld, [key]);
    await shim.stop();

    shim = await startApp({ memory: true, keep: true, dataDir, configure });
    assert.deepEqual((await (await shim.api(`/api/sessions/${id}/transcript`)).json()).subagentHeld, [key], "still kept after the restart");
    const sent = await shim.api(`/api/sessions/${id}/subagents/${subagent.id}/send`, { method: "POST", body: { exchange: 0 } });
    assert.equal(sent.status, 200, await sent.clone().text());
    const tr = await (await shim.api(`/api/sessions/${id}/transcript`)).json();
    assert.deepEqual([tr.subagentHeld, tr.subagentSent], [[], [key]], "sent: its row reads so");
    const mark = up.received.length;
    await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    const opened = JSON.stringify(up.received.slice(mark)[0].body.messages.at(-1));
    assert.match(opened, /the developer is passing you the report of sub-agent sa_[0-9a-f]{8} \(\\"Aside\\"\)[\s\S]*THE KEPT REPORT/);
    // (fails before: yes — HarnessV4_Tasks E15 step 5, 5b: a thread stays across a restart, so its report names the way on;
    // its conversation stays too since 10-26, so the way on is the same context)
    assert.match(opened, /To ask it more in the same context, call agent with agent_id \\"sa_[0-9a-f]{8}\\"\./, "the thread is back with its conversation: a follow-up goes on in it");
  } finally {
    await shim.stop();
    await up.close();
    await removeDirs(dataDir, folder);
  }
});

test("the page keeps a kept report's Send after a restart, from the transcript's list of the ones still kept", () => {
  const src = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("chipActions.subagentDelivery = "), src.indexOf("chipActions.sendSubagent = "));
  assert.match(fn, /subagentSent\?\.has\(key\) \? "sent" : chat\?\.subagentHeld\?\.has\(key\) \? "held" : undefined/);
  assert.match(src, /chat\.subagentHeld = new Set\(Array\.isArray\(tr\.subagentHeld\) \? tr\.subagentHeld : \[\]\);/);
  const send = src.slice(src.indexOf("chipActions.sendSubagent = "), src.indexOf("chipActions.watchSubagents"));
  assert.match(send, /chat\.subagentHeld\?\.delete\(`\$\{id\}:\$\{exchange\}`\)/, "a sent one is no longer kept");
});
