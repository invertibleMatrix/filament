// @ts-check
// When a loop's park ends with no answer's turn, its in-process work ends with it (the decision of 11-02). A rewind that
// takes the turn that asked away ends its question, and so do the person's message to a coding agent and a lapse: the
// park the loop keeps in this process went on all the same — the Skeptic's second look its card waited with read on with no one to read it — until the loop's next
// turn or the six-hour sweep let it go. The park is let go as the question ends, its second look stopped.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, removeDirs } from "./helpers/wait.js";
import { PAUSE_TTL_MS } from "../src/app/agent/turn.js";

/** @param {any[]} blocks @param {string} [stop] */
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** The forced push a rule asks a second look for. */
const PUSH = { type: "tool_use", id: "b1", name: "bash", input: { command: "git push --force origin main" } };

describe("a loop's park whose question ended with no answer's turn", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** The Skeptic reads on until this is let go: its answer waits for it. @type {(() => void)[]} */
  const reading = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-park-let-go-"));
    writeFileSync(join(root, "notes.txt"), "hello\n");
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (JSON.stringify(call.body?.messages ?? "").includes("This is a second look, for Filament")) {
        await new Promise((r) => reading.push(() => r(undefined)));
        return reply([{ type: "text", text: "5. Verdict: wait." }]);
      }
      return /push it/.test(JSON.stringify(call.body?.messages?.at(-1) ?? "")) ? reply([PUSH], "tool_use") : reply([{ type: "text", text: "Fresh words." }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    for (const go of reading.splice(0)) go();
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });

  /** A chat whose turn paused on the push, its second look reading: its address and the look's. */
  const pausedWithLook = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { loop: { secondLook: true } } } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    const at = `/api/sessions/${encodeURIComponent(id)}`;
    const t = await shim.api(`${at}/turns`, { method: "POST", body: { content: "push it", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const p = (await (await shim.api(`${at}/transcript?limit=5&work=0`)).json()).paused;
    assert.equal(p?.kind, "permission", JSON.stringify(p ?? null));
    assert.match(String(p.look?.agent), /\S/, JSON.stringify(p?.look ?? null));
    const look = `${at}/second-looks/${encodeURIComponent(p.look.agent)}`;
    assert.equal((await (await shim.api(look)).json()).status, "running", "the Skeptic reads while the card waits");
    return { id, at, look };
  };
  /** @param {string} look */
  const statusOf = async (look) => (await (await shim.api(look)).json()).status;

  // (fails before: yes — the Skeptic read on after the rewind took its question away: status "running")
  test("a rewind takes the question away: the park goes, its second look stopped", async () => {
    const { at, look } = await pausedWithLook();
    const back = await shim.api(`${at}/rewind`, { method: "POST", body: { turn: 1, what: "conversation" } });
    assert.equal(back.status, 200, await back.clone().text());
    await until(async () => (await statusOf(look)) !== "running", "the look's end", { timeoutMs: 5000 });
    assert.equal(await statusOf(look), "stopped");
  });

  // (fails before: yes — the Skeptic read on after its question lapsed: status "running" until the loop's next turn or
  // the sweep)
  test("the question lapses: the park goes, its second look stopped", async () => {
    const { id, look } = await pausedWithLook();
    // Asked six hours ago but a moment, and looked at as a side run asked meanwhile would.
    const archive = /** @type {any} */ (shim.app).memory.archive;
    const stored = archive.metaOf(id, ["paused"]).paused;
    archive.mergeMeta(id, { paused: { ...stored, at: Date.now() - PAUSE_TTL_MS + 300, expires: Date.now() + 300 } });
    assert.equal(/** @type {any} */ (shim.app).sessions.asking(id), true);
    await until(async () => (await statusOf(look)) !== "running", "the look's end", { timeoutMs: 5000 });
    assert.equal(await statusOf(look), "stopped");
  });
});
