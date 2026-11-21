// @ts-check
// HarnessV4_Tasks C33 step 3, small truths on the card that asks before a message is sent. What a coding agent holds
// after a way of Filament's says both parts: Filament's copy, and the agent's own share (its prompt and tools), which a
// turn measures where it begins a session new to the agent. A line under that share says so. A message a card stopped
// is kept as its session's draft, which a refresh brings back. And the time said for a summary is that writer's past
// summaries, the whole call.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { foldTurnFacts } from "../src/core/turn-facts.js";
import { ownShare } from "../src/app/sessions/agent-line.js";
import { afterWords, askChoices, shareLine } from "../src/ui/harness/widgets/compaction.js";
import { stoppedToAsk } from "../src/ui/harness/conversation/history.js";
import { draftFor, saveDraft, startKept } from "../src/ui/harness/state.js";
import { UsageStore } from "../src/services/records.js";

describe("what a coding agent holds after a way: Filament's copy, where it was measured", () => {
  // (fails before: yes — the owner's words of 10-24: "no need to show the claude code's own system prompt and tools",
  // and "you can drop the token counter on compaction if you think that is just an estimate": a summary not yet written
  // said "≈4.3K after, plus its own ≈78.6K")
  test("a way says what it leaves only where that was measured, and nothing of the agent's own share", () => {
    assert.equal(afterWords({ after: 1800, exact: false }, { share: 33_000 }), "", "a summary not yet written is a guess");
    assert.equal(afterWords({ after: 1800, exact: true }, { share: 33_000 }), "1.8K after");
    assert.equal(afterWords({ after: 1800, exact: false }), "");
    assert.equal(afterWords({ after: 130_000, exact: true }, null, 120_000), "130K after · no smaller than now");
    const plan = { native: true, methods: { summary: { possible: true, after: 9000, exact: false }, fold: { possible: true, instant: true, earlier: 3000, after: 4000, exact: true, cost: 0, calls: 0 } }, agent: { own: null, self: "fork", opens: false, share: 33_000, warmUntil: Date.now() + 60_000, held: 120_000 } };
    const rows = askChoices({ plan, agent: true, agentName: "Claude Code", now: Date.now() });
    assert.equal(rows.find((r) => r.id === "way:self")?.sub, "In a fork, read-only");
    assert.match(String(rows.find((r) => r.id === "fold")?.sub), /^4K after · /);
  });

  // (fails before: yes — a line under the agent's own share asked at every message, and nothing said why)
  test("a line at or under the share says so; one that clears it, or a share nobody measured, says nothing", () => {
    assert.equal(
      shareLine({ who: "Claude Code", share: 33_000, line: 30_000 }),
      "The line (30K) is under what Claude Code holds before any of the chat (≈33K, its own prompt and tools): no way gets under it, so every message asks",
    );
    assert.equal(shareLine({ who: "Claude Code", share: 33_000, line: 400_000 }), null);
    assert.equal(shareLine({ who: "Claude Code", share: null, line: 30_000 }), null);
    assert.equal(shareLine({ who: "Claude Code", share: 33_000, line: 0 }), null, "nobody knows the window: no line to weigh");
  });

  test("a turn's facts keep the share its record measured, and the session reads its newest on that agent", () => {
    const rec = { id: "r1", ts: new Date(1000).toISOString(), totalMs: 50, status: "ok", upstream: "claude", model: "claude/a", tokens: { input: 10, output: 5 }, context: { window: 200_000, source: "agent", last: { held: 40_000 }, own: 33_100 } };
    const facts = foldTurnFacts(null, rec, { own: true });
    assert.equal(facts.context.own, 33_100);
    assert.equal(foldTurnFacts(null, { ...rec, context: { ...rec.context, own: undefined } }, { own: true }).context.own, undefined);
    const turn = (/** @type {string} */ upstream, /** @type {number | null} */ own) => ({ meta: { facts: { upstream, context: own ? { own } : {} } } });
    assert.equal(ownShare([turn("claude", 30_000), turn("claude", null), turn("codex", 12_000)], "claude"), 30_000);
    assert.equal(ownShare([turn("claude", 30_000), turn("claude", 33_000)], "claude"), 33_000, "the newest");
    assert.equal(ownShare([turn("codex", 12_000)], "claude"), null);
  });
});

describe("a harness chat on a coding agent", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-c33-truths-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello agent\n");
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{
          id: "claude",
          name: "claude",
          type: "acp",
          acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: projDir, permissions: "allow-all" },
        }];
        cfg.routes = [{ match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /** @param {string} id */
  const at = (id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** @param {string} id @param {string} content */
  const say = async (id, content) => {
    const res = await shim.api(`${at(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(res.status, 200, await res.clone().text());
  };
  /** The plan's word on the session's agent. @param {string} id */
  const agentOf = async (id) => (await (await shim.api(`${at(id)}/compose?dry=1&compaction=1`)).json()).compaction?.agent;

  // (fails before: yes — nothing measured what the agent holds beyond what Filament sent it)
  test("its first turn measures the agent's own share: its first count, less what Filament sent; a later turn in the same session measures nothing", async () => {
    const id = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model: "claude/fake-a", preset: "plain" } })).json()).id);
    // The agent's context holds 40,000 tokens as its first turn ends, of which Filament sent this one short message.
    await say(id, "hello ~holds 40000");
    const first = await agentOf(id);
    assert.ok(first.share > 39_000 && first.share < 40_000, `its own share, ${first.share}, is its first count less the message`);
    // The session goes on: its count grows with the chat, and says nothing new of the agent's own share.
    await say(id, "and again ~holds 90000");
    const second = await agentOf(id);
    assert.equal(second.share, first.share);
    assert.equal(second.held, 90_000);
  });
});

describe("a message a card stopped", () => {
  /** @type {Map<string, string>} */
  const kept = new Map();
  const was = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  before(() => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) },
    });
  });
  after(() => {
    if (was) Object.defineProperty(globalThis, "sessionStorage", was);
    else delete (/** @type {any} */ (globalThis).sessionStorage);
  });

  // (fails before: yes — the draft was kept under the page's own id for the chat, made anew at every load: a refresh
  // never found it)
  test("a draft is kept under the chat's session, so a chat the page makes anew after a refresh finds it", () => {
    saveDraft({ chainId: "s1" }, "the words I typed");
    assert.equal(draftFor({ chainId: "s1" }), "the words I typed", "another chat object of the same session");
    assert.equal(draftFor({ chainId: "s2" }), "");
    saveDraft({ chainId: null }, "typed on the Start board");
    assert.equal(draftFor({}), "typed on the Start board", "a chat with no session yet");
    saveDraft({ chainId: "s1" }, "");
    assert.equal(draftFor({ chainId: "s1" }), "", "a sent one is forgotten");
    assert.deepEqual([...kept.keys()], ["filament.harness.draft.new"]);
  });

  // (fails before: yes — found by the Designer walking a first Space, 10-29: the Start's words were kept without their
  // folder, so after a reload New app's words for a Space of your own came back in the last folder sent from, and New
  // chat here… on another project showed them too: sent, the app was made in the wrong place)
  test("the Start's words are kept with the folder they were typed for: they come back there, never in another folder's Start", () => {
    saveDraft({ chainId: null, cwd: "C:\\Spaces\\Northwind" }, "Make an app for Northwind");
    assert.deepEqual(startKept(), { text: "Make an app for Northwind", cwd: "C:\\Spaces\\Northwind" });
    assert.equal(draftFor({ cwd: "c:/spaces/northwind/" }), "Make an app for Northwind", "the same folder, however it is spelled");
    assert.equal(draftFor({ cwd: "C:\\proj" }), "", "never in another folder's Start");
    assert.equal(draftFor({ chainId: null, cwd: "" }), "", "nor in a Start with no folder");
    // Another folder's Start opens with its box empty, which the composer saves as it draws: the words stay their folder's.
    saveDraft({ chainId: null, cwd: "C:\\proj" }, "");
    assert.equal(draftFor({ cwd: "C:\\Spaces\\Northwind" }), "Make an app for Northwind", "an empty box elsewhere erases nothing");
    saveDraft({ chainId: null, cwd: "C:\\proj" }, "moved with its folder");
    assert.equal(draftFor({ cwd: "C:\\proj" }), "moved with its folder");
    // A draft kept before this change was its words alone: it reads as before, in any Start.
    kept.set("filament.harness.draft.new", "typed before the update");
    assert.deepEqual(startKept(), { text: "typed before the update", cwd: "" });
    assert.equal(draftFor({ cwd: "C:\\anywhere" }), "typed before the update");
    saveDraft({ chainId: null }, "");
    assert.equal(startKept(), null);
    assert.deepEqual([...kept.keys()], [], "one key, as before");
  });

  // The page's load makes its Start in the folder its kept words were typed for (app.js boot).
  test("the page's load makes the Start in the kept words' folder", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /const kept = startKept\(\);\n\s+if \(!chatOf\(state\.currentId\)\) newChat\(kept\?\.cwd \? \{ cwd: kept\.cwd \} : \{\}\);/);
  });

  test("Filament's question before a send is told from a turn its agent refused, which is on record", () => {
    assert.equal(stoppedToAsk({ errorBody: { needsCompaction: true, why: "past the line", sentTokens: 9 } }), true);
    assert.equal(stoppedToAsk({ errorBody: { resumeQuestion: { why: "cold", held: 9 } } }), true);
    assert.equal(stoppedToAsk({ errorBody: { error: "the model is overloaded" } }), false);
    assert.equal(stoppedToAsk({}), false);
    assert.equal(stoppedToAsk(null), false);
  });
});

describe("about how long a summary takes", () => {
  // (fails before: yes — the time was the writer's first byte and its rate alone: 21 s said, 57 s taken, as it thought first)
  test("the request log says how long a model's summaries took, whole: its calls over a transcript, its slices, a fork of the session's request; its other calls apart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-c33-time-"));
    const ts = new Date().toISOString();
    const call = (/** @type {any} */ o) => JSON.stringify({ ts, status: "ok", model: "zai/glm", upstream: "zai", upstreamModel: "glm-5.3", tokens: { input: 5, output: 500 }, ttftMs: 900, tps: 50, ...o });
    writeFileSync(join(dir, "requests.jsonl"), [
      call({ id: "1", totalMs: 50_000, memoryFor: { purpose: "compact" } }),
      call({ id: "2", totalMs: 60_000, forkFor: "compaction" }),
      call({ id: "3", totalMs: 57_000, memoryFor: { purpose: "compact" } }),
      call({ id: "4", totalMs: 4_000, memoryFor: { purpose: "learn" } }),
      call({ id: "5", totalMs: 9_000 }),
      call({ id: "6", status: "error", totalMs: 10, memoryFor: { purpose: "compact" } }),
      call({ id: "7", model: "other", upstreamModel: "other", totalMs: 1_000, memoryFor: { purpose: "compact" } }),
      "",
    ].join("\n"));
    const store = new UsageStore({ dataDir: dir, options: { logFile: "requests.jsonl", broadcast: false } });
    try {
      assert.deepEqual(store.callTimeOf("zai/glm", "compact"), { ms: 57_000, calls: 3 }, "the median; a turn's own call, a failed one and another model's are not counted");
      assert.deepEqual(store.callTimeOf("glm-5.3", "compact"), { ms: 57_000, calls: 3 }, "by the name its upstream knows it by");
      assert.equal(store.callTimeOf("nobody", "compact"), null);
    } finally {
      await store.flush();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
