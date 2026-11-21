// @ts-check
// BUG-21 (FILAMENT Bug Tracker, 2026-09-30): the harness's Compact during a running agent turn was refused — "a turn
// is running in this session; compact when it ends" — while the loop already compacts its own rounds mid-turn at
// the compaction line. The owner expected it at the loop's next step. Compact now posts a `compact` steer to the
// run; the loop takes it off the mailbox (never a note to the model) and folds the turn's older rounds at the top
// of the next round, by the line's own machinery, the newest rounds whole.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply, parseSse } from "./helpers/app.js";
import { until, gate, removeDirs } from "./helpers/wait.js";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const sysOf = (b) => (Array.isArray(b.system) ? b.system.map((x) => x?.text ?? "").join("\n") : String(b.system || ""));
const lastText = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((c) => c?.type === "text").map((c) => c.text).join("\n"));
const SUMMARY = "SUMMARY-OF-EARLIER-ROUNDS: read a.txt and b.txt, both hold markers.";
// The writer thinks in notes first (HarnessV3-AtHome AH-D9 a); only the summary reaches the next round.
const REPLY = `<analysis>\nNOTES-ON-ROUNDS: a.txt, then b.txt\n</analysis>\n<summary>\n${SUMMARY}\n</summary>`;

describe("the compact steer", () => {
  test("an agent run takes it without text and it never fires the stop signal; a team run refuses it", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-compact-steer-"));
    const runs = createRunLog({ events: createEventBus(), dataDir: dir, config: () => ({ observability: { runEvents: { persist: false } } }), ops: { record: () => {} } });
    try {
      runs.startRun({ id: "a1", kind: "agent-turn" });
      const box = runs.mailbox("a1");
      assert.equal(runs.steer("a1", { kind: "compact", text: "", from: "harness" }).ok, true);
      assert.equal(box.stopSignal.aborted, false, "a compact is no stop");
      assert.deepEqual(box.read().map((m) => m.kind), ["compact"]);
      runs.startRun({ id: "rc1", kind: "replay-compare" });
      const refused = runs.steer("rc1", { kind: "compact", text: "", from: "harness" });
      assert.equal(refused.ok, false);
      assert.match(String(refused.error), /agent turn/);
    } finally {
      runs.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Cold, the session's writer summarizes the transcript; warm, the loop's own model forks its conversation from the
// provider's cache — and that fork is told the developer asked, never that the turn "reached the compaction line".
for (const warm of [false, true])
describe(`Compact during a running agent turn (${warm ? "warm: the fork" : "cold: the transcript"})`, () => {
  /** @param {any[]} blocks @param {string} [stop] */
  const answer = (blocks, stop = "end_turn") =>
    anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7, ...(warm ? { cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } : {}) } });
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {any[]} */
  const rounds = [];
  let summarized = 0;
  /** @type {string[]} the instruction each fork of the loop's own conversation was given */
  const forkAsks = [];
  const hold = gate();
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-compact-mid-"));
    for (const f of ["a", "b", "c"]) writeFileSync(join(root, `${f}.txt`), `MARKER-${f.toUpperCase()} ${"words ".repeat(800)}`);
    up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      // The summarizer: the session's writer (a transcript) or a fork of the loop's own conversation.
      const newest = lastText(b.messages?.at(-1));
      const fork = /^\[Filament: (this turn has reached the compaction line|the developer asked to compact this turn now)\./.test(newest);
      if (sysOf(b).includes("compaction summaries") || fork) {
        summarized++;
        if (fork) forkAsks.push(newest);
        return answer([{ type: "text", text: REPLY }]);
      }
      rounds.push(b);
      const n = rounds.length;
      if (n === 1) return answer([{ type: "text", text: "Reading." }, toolUse("r1", "read", { path: "a.txt" })], "tool_use");
      if (n === 2) return answer([toolUse("r2", "read", { path: "b.txt" })], "tool_use");
      if (n === 3) {
        await hold.promise; // the developer presses Compact while round 3 is being decided
        return answer([toolUse("r3", "read", { path: "c.txt" })], "tool_use");
      }
      return answer([{ type: "text", text: "Done." }]);
    });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-model": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    hold.open();
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });

  // (fails before: the steer was refused — "kind must be one of note, veto, stop" — and nothing was folded)
  test("the loop folds the older rounds at its next step; the newest round and the turn go on", async () => {
    const res = await shim.house(
      "/v1/messages",
      { model: "agent/brain-model", max_tokens: 400, stream: true, messages: [{ role: "user", content: "read a, b and c" }] },
      { "x-filament-cwd": root, "x-session-id": `compact-mid-${warm ? "warm" : "cold"}` },
    );
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id"));
    const body = res.text();
    await until(() => rounds.length === 3, "round 3's model call to be in flight");
    const s = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "compact", text: "", from: "harness" } });
    assert.equal(s.status, 200, await s.text());
    hold.open();
    const raw = await body;
    const text = parseSse(raw).map((f) => f.data).filter((d) => d?.delta?.type === "text_delta").map((d) => d.delta.text).join("");
    assert.match(text, /Done\./, "the turn went on to its end");
    assert.equal(summarized, 1, "one summary, written when round 4 began");
    assert.equal(rounds.length, 4);
    const r4 = JSON.stringify(rounds[3].messages);
    assert.ok(r4.includes("SUMMARY-OF-EARLIER-ROUNDS"), "round 4 carries the summary");
    // (fails before: yes — the writer's notes and tags rode into round 4 with the summary)
    assert.ok(!r4.includes("NOTES-ON-ROUNDS") && !r4.includes("<summary>"), "and not the notes the writer thought in");
    const results = rounds[3].messages.flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).filter((/** @type {any} */ b) => b?.type === "tool_result");
    assert.deepEqual(results.map((/** @type {any} */ b) => b.tool_use_id), ["r3"], "rounds 1–2's results were folded into it");
    assert.ok(r4.includes("MARKER-C"), "the newest round stays whole");
    // The files rounds 1–2 read come back after the summary, as they are on disk, the newest first; round 3's own call
    // shows c.txt (HarnessV3-AtHome AH-D9 b).
    // (fails before: yes — the files went with their results, to be read again)
    // They take at most half of what the fold freed: two reads were folded, so the newer file comes back and the older
    // is named. (fails before: yes — both came back whole, and the Compact the developer asked for freed nothing)
    const head = rounds[3].messages.find((/** @type {any} */ m) => m.role === "user" && /^\[Filament compacted rounds 1–2 of this turn/.test(String(m.content?.[0]?.text || "")));
    const block = String(head?.content?.[1]?.text || "");
    assert.match(block, /^\[Filament brought these back after the summary: the files the work used most recently, as they are on disk now\. A file only named was not brought back; read it again if you need it\.\]/);
    const [b, a] = [block.indexOf('<file path="b.txt">\n     1\tMARKER-B words'), block.indexOf('<file path="a.txt" shown="no">no room left after the files above</file>')];
    assert.ok(b > 0 && a > b, block.slice(0, 200));
    assert.ok(!block.includes("MARKER-A"), "the older file is named, not read back");
    assert.ok(!block.includes("c.txt"), "round 3 shows c.txt itself");
    assert.ok(!rounds.some((b) => JSON.stringify(b.messages).includes('"kind":"compact"')), "the request never reached the model as a note");
    const evts = (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=500`)).json()).events;
    const comp = evts.find((e) => e.type === "compaction");
    assert.ok(comp?.manual, `a manual compaction on the run: ${JSON.stringify(comp)}`);
    assert.equal(comp.fromRound, 1);
    assert.equal(comp.toRound, 2);
    // (fails before: yes — the event said nothing of what came back, so the run's row could not say it)
    assert.deepEqual(comp.attached, { shown: 1, named: 1, plan: false });
    assert.ok(comp.tokensBefore - comp.tokensAfter > 0.3 * comp.tokensBefore, `the Compact made room: ${comp.tokensBefore} → ${comp.tokensAfter}`);
    const rec = await shim.record(runId);
    assert.ok((rec.changes || []).some((c) => /compacted rounds 1–2 of this turn on the developer's request/.test(c)), JSON.stringify(rec.changes));
    // (fails before: yes — the fork was told "this turn has reached the compaction line"; HarnessV3-FixRound F1 item 9)
    assert.equal(forkAsks.length, warm ? 1 : 0, warm ? "the loop's own model wrote it from its warm cache" : "cold: the transcript");
    if (warm) {
      assert.match(forkAsks[0], /^\[Filament: the developer asked to compact this turn now\. /);
      assert.doesNotMatch(forkAsks[0], /compaction line/);
      assert.ok((rec.changes || []).some((c) => /on the developer's request, summarized by brain-model, from its warm cache/.test(c)), JSON.stringify(rec.changes));
    }
    // (fails before: yes — the fork's record read as the developer's sub-agent; HarnessV3-FixRound decision 27)
    const forks = (await (await shim.api("/api/requests?limit=50&source=compaction")).json()).requests;
    assert.deepEqual(forks.map((/** @type {any} */ r) => [r.source, r.parentRequest, r.subagentOf]), warm ? [["compaction", runId, "owner"]] : [], "the fork is a Compaction fork, caused by the turn it compacted");
  });
});
