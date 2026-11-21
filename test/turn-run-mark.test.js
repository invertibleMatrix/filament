// @ts-check
// HarnessV3-Launch LD-D13 (2026-10-03): a turn Filament answers itself (`/autofit`, `@mem remember`) has no run, yet
// the page looked one up by the turn's request id — twice live, and again from a second tab or after a reload —
// and every lookup was a 404 in the browser's console (the readiness drive rd0c, S8–S10). Now the reply's head says
// when the turn has a run (`x-filament-run: 1`, an agent turn's), each transcript row says it too (`run`),
// and the page asks for a run only where one was said to exist.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { createRunLog } from "../src/services/runs.js";
import { createEventBus } from "../src/services/events.js";

describe("the reply's head and the transcript say which turns have a run", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-turn-run-mark-"));
    up = await fakeUpstream((call) => (call.kind === "anthropic" ? anthropicReply("all done", { model: String(call.body?.model || "m") }) : undefined));
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
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  });
  /** @param {string} model */
  const session = async (model) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content @param {boolean} stream */
  const turn = async (id, content, stream) => {
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream, runEvents: true } });
    assert.equal(res.status, 200);
    await res.text();
    return { run: res.headers.get("x-filament-run"), requestId: String(res.headers.get("x-filament-request-id") || "") };
  };
  /** @param {string} id */
  const rows = async (id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=0`)).json()).turns;

  // (fails before: no head said whether a run exists, and no row did)
  test("an agent turn says it has a run, streamed or not; a command's turn says nothing; the rows agree", async () => {
    const id = await session("agent/brain-model");
    const a = await turn(id, "list the files", true);
    assert.equal(a.run, "1", "the streamed agent turn's head names its run");
    assert.ok((await shim.api(`/api/runs/${encodeURIComponent(a.requestId)}`)).status === 200, "and the run is there");
    const b = await turn(id, "and again", false);
    assert.equal(b.run, "1", "a JSON reply's head names it too");
    const c = await turn(id, "@mem remember The staging deploy region is eu-west-2.", true);
    assert.equal(c.run, null, "Filament answered the command itself: no run to look up");
    assert.equal((await shim.api(`/api/runs/${encodeURIComponent(c.requestId)}`)).status, 404, "and indeed there is none");
    const r = await rows(id);
    const byRequest = (/** @type {string} */ rid) => r.find((/** @type {any} */ t) => (t.requestIds || []).includes(rid));
    assert.equal(byRequest(a.requestId)?.run, true);
    assert.equal(byRequest(b.requestId)?.run, true);
    assert.equal(byRequest(c.requestId)?.run, false, "the command's row says it has none, so a reload asks for nothing");
  });
});

// The transcript asks the run log of every turn it lists whether it has a run: the answer `getRun` would give, read by
// name alone — from memory while the run is there (persistence off, or a file that could not be written), else from its
// file (after a restart), and never from an empty file, which holds no run.
test("the run log has a run exactly where getRun would answer: in memory, on disk after a restart, never an empty file", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-turn-run-mark-log-"));
  /** @param {boolean} persist */
  const open = (persist) => createRunLog({ events: createEventBus(), dataDir: dir, config: () => ({ observability: { runEvents: { persist } } }), ops: { record: () => {} } });
  const logs = [open(false), open(true)];
  try {
    const [memoryOnly, before] = logs;
    memoryOnly.startRun({ id: "run-in-memory", kind: "agent" });
    assert.equal(memoryOnly.hasRun("run-in-memory"), true, "persistence off: the run in memory");
    before.startRun({ id: "run-on-disk", kind: "agent" });
    before.endRun("run-on-disk", { status: "done" });
    // A restart: a new log over the same folder, nothing in memory.
    const after = open(true);
    logs.push(after);
    writeFileSync(join(dir, "runs", "run-empty.jsonl"), "");
    /** @type {[string, boolean][]} */
    const cases = [["run-on-disk", true], ["run-in-memory", false], ["run-empty", false], ["no-such-run", false]];
    for (const [id, has] of cases) {
      assert.equal(after.hasRun(id), has, id);
      assert.equal(after.getRun(id) !== null, has, `getRun agrees on ${id}`);
    }
  } finally {
    for (const l of logs) l.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the page looks a run up only where the head or the row said one exists", () => {
  const api = readFileSync("src/ui/harness/lib/api.js", "utf8");
  assert.ok(/run: res\.headers\.get\("x-filament-run"\) === "1"/.test(api), "postTurn reads the mark");
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.ok(/if \(marks\.runEvents\) carried = true;\s*else if \(marks\.run\) detectRun\(id\);/.test(app), "live: a lookup only when the head names a run");
  assert.ok(/hasRun = marks\.run;[\s\S]*if \(turn\.requestId && hasRun && !detected\) await detectRun\(turn\.requestId\);/.test(app), "and the second chance at the end likewise");
  const history = readFileSync("src/ui/harness/conversation/history.js", "utf8");
  assert.ok(/runId: t\.run \? requestId : null,/.test(history), "a reloaded turn has a run id only when its row says so");
});
