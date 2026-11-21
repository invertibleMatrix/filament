// HarnessV3-Launch RD-D4: `/compact` where Filament composes the turn is the composer's Compact now, inside the
// command's own turn — one row, learned from first, undoable until the next message, answered with the compactor's
// note. Typed by an outside client it is the client's own message: it goes to the client's model and Filament writes
// no compaction (the owner's rule of 10-31: an outside client gets a plain proxy plus memory).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { LEARN_PROMPT } from "../src/services/memory/learn.js";
import { endedCompactions } from "../src/ui/harness/conversation/history.js";

/** A message's text blocks, joined. @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((b) => b?.type === "text").map((b) => b.text).join(""));
/** The newest user message a provider call carries, as text. @param {any} call */
const saidIn = (call) => textOf([...(call.body?.messages || [])].reverse().find((m) => m.role === "user"));
const isLearnCall = (/** @type {any} */ call) => JSON.stringify(call.body?.system ?? "").includes(LEARN_PROMPT.slice(0, 60));
/** The compaction model's call: its summary is short, so the turns it stands for give room (HarnessV4_Tasks C30). */
const isSummaryCall = (/** @type {any} */ call) => JSON.stringify(call.body?.system ?? "").includes("compaction summaries");
/** Every reply is a few hundred words, so two turns give a summary room to make. @param {any} call */
const replyTo = (call) => anthropicReply(`on ${saidIn(call).slice(0, 40)}: ${"detail ".repeat(400)}`, { model: call.body?.model || "m-1" });
/** Two turns a summary stands for: their messages long too, so it gives room beside the last reply, which comes back whole. */
const TWO = ["turn one", "turn two"].map((t) => `${t} ${"context ".repeat(600)}`);
const PRICING = { "m-1": { input: 1, output: 1, contextTokens: 200000 } };

describe("/compact where Filament composes the turn: Compact now, by the session's own way", () => {
  /** @type {any} */ let shim;
  /** @type {any} */ let up;
  before(async () => {
    up = await fakeUpstream(async (/** @type {any} */ call) =>
      isLearnCall(call) ? anthropicReply(JSON.stringify({ title: "Two turns", state: { summary: "two turns" }, turns: [], items: [] }), { model: "m-1" }) : isSummaryCall(call) ? anthropicReply("SUMMARY: turn one, condensed.", { model: "m-1" }) : replyTo(call),
    );
    shim = await startApp({
      memory: true,
      summarizer: "m-1",
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: PRICING }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.capture = { ...cfg.memory.capture, learn: true };
        cfg.memory.models = { summarizer: "m-1", curator: "off" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  const create = async () => (await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1" } })).json()).id;
  /** @param {string} id @param {string} text */
  const send = async (id, text) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: text, stream: false } });
    return { status: r.status, body: await r.text() };
  };
  /** @param {string} id */
  const transcript = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  /** The newest command's turn and the answer it kept. @param {any} tr */
  const lastCommand = (tr) => {
    const turn = [...tr.turns].reverse().find((/** @type {any} */ t) => t.command);
    return { turn, text: textOf(turn?.final) };
  };

  // (fails before: yes — `/compact` was no command of a chat Filament runs: it went to the model as a message)
  for (const [typed, untold] of [["/compact", ""], ["/compact keep the API notes", " Filament's compaction takes no instructions: what you asked it to keep was not passed on."]])
    test(`"${typed}" in the harness compacts by the session's way inside its own turn: one row, the compactor's note, learned first, and Undo until the next message`, async () => {
      const id = await create();
      for (const t of TWO) assert.equal((await send(id, t)).status, 200);
      const r = await send(id, typed);
      assert.equal(r.status, 200, r.body);
      const tr = await transcript(id);
      const { turn, text } = lastCommand(tr);
      // One summary by default (the owner's rules of 10-31: no newest 30% kept whole), from the warm cache the turns left.
      assert.equal(text, `/compact — compaction: turns 1–2 summarized on request by m-1, from its warm cache; learning from them now on m-1. Undo is on its row until you send.${untold}`);
      const rows = shim.app.memory.archive.getCompactions(id);
      assert.deepEqual(
        rows.map((/** @type {any} */ c) => [c.kind, c.method, c.window, c.from_turn, c.to_turn, c.detail?.door ?? null]),
        [["manual", "summary", "harness", 1, 2, null]],
        "one row, the composer's own — no preview row beside it",
      );
      const b = tr.boundaries.filter((/** @type {any} */ x) => x.type === "compaction");
      assert.deepEqual(b.map((/** @type {any} */ x) => [x.kind, x.method, x.fromTurn, x.toTurn, x.undoable]), [["manual", "summary", 1, 2, true]], "its boundary, with its Undo");
      assert.ok(turn.startedAt <= b[0].at, `the command's turn started when it was typed, before the compaction it wrote (${turn.startedAt} > ${b[0].at})`);
      await shim.app.memory.learner.settled();
      const ops = (await (await shim.api("/api/ops?limit=200&kinds=learner")).json()).ops;
      assert.deepEqual(
        ops.filter((/** @type {any} */ o) => o.sub === "start" && o.detail?.chain === id).map((/** @type {any} */ o) => [o.detail.reason, o.detail.door]),
        [["compaction", "manual"]],
        "learned from, as Compact now's compaction is",
      );
      const u = await shim.api(`/api/sessions/${encodeURIComponent(id)}/compactions/${b[0].id}/undo`, { method: "POST", body: {} });
      assert.equal(u.status, 200, await u.text());
      assert.deepEqual(shim.app.memory.archive.getCompactions(id), [], "undone");
    });

  // (fails before: yes — `/compact` was no command of a chat Filament runs)
  test("a compaction that frees nothing: the answer says why, and nothing is written", async () => {
    const id = await create();
    assert.equal((await send(id, "turn one")).status, 200);
    assert.equal((await send(id, "/compact")).status, 200);
    assert.match(lastCommand(await transcript(id)).text, /^\/compact did not compact the session — the compaction model \(m-1\) wrote a summary that leaves the chat no smaller — ≈[\d,]+ tokens with it, ≈[\d,]+ as it is — so nothing was written\.$/);
    assert.deepEqual(shim.app.memory.archive.getCompactions(id), [], "nothing written");
  });

  // (fails before: no — a guard: the next message ends the Undo, the command's own included)
  test("the next message ends the Undo, a command's too", async () => {
    const id = await create();
    for (const t of [...TWO, "/compact"]) assert.equal((await send(id, t)).status, 200);
    assert.equal((await send(id, "/help")).status, 200);
    const b = (await transcript(id)).boundaries.filter((/** @type {any} */ x) => x.type === "compaction");
    assert.deepEqual(b.map((/** @type {any} */ x) => x.undoable), [false]);
  });
});

// (fails before: yes — a compaction a typed command wrote showed only after a reload, so its Undo was out of reach)
test("the page places a compaction a command wrote in its own turn as soon as the turn ends, with its Undo, as Compact now's", () => {
  const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  assert.match(timeline, /if \(row\) turn\.compactions = endedCompactions\(tr\.boundaries, row, isCommand\);/);
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const settled = app.indexOf("composer.settled(turn.status);");
  const ended = app.slice(settled, app.indexOf("if (chat.hydrateAfterSend)", settled));
  assert.match(ended, /if \(turn\.compactions\?\.length\) \{\s*for \(const b of turn\.compactions\) placeCompaction\(chat, sentSince && b\.undoable \? \{ \.\.\.b, undoable: false \} : b\);\s*widgets\.paint\(\);\s*\}/);
  const button = app.slice(app.indexOf("async function compactSession("), app.indexOf("function placeCompaction("));
  assert.match(button, /placeCompaction\(chat, r\.boundary\);/, "one placing for both");
});

// (fails before: yes — the owner's screenshot of 10-18: "Claude Code · Northwind compacted its own context during turn
// 174" came in only when the next message was sent, above it, as if the send had made it; the server wrote it as turn
// 174 ended, and the page took a row at a turn's end from a command's turn alone)
test("an ended turn places a coding agent's own compaction made during it, as a command's turn places its own", () => {
  const row = { n: 174, startedAt: 1000 };
  const own = { type: "compaction", method: "own", afterTurn: 174, fromTurn: 1, toTurn: 173, at: 2000, detail: { during: 174, by: "Claude Code · Northwind" } };
  const older = { type: "compaction", method: "own", afterTurn: 120, fromTurn: 1, toTurn: 119, at: 500, detail: { during: 120 } };
  // Placed their own ways: Filament's copy's summary on the feed, the composer's from the turn's record.
  const copy = { type: "compaction", method: "summary", afterTurn: 173, fromTurn: 1, toTurn: 173, at: 2100, detail: { copy: "line" } };
  const composed = { type: "compaction", method: "fold", afterTurn: 173, fromTurn: 1, toTurn: 173, at: 1500 };
  const boundaries = [older, { type: "settings", beforeTurn: 174, at: 1000 }, composed, own, copy];
  assert.deepEqual(endedCompactions(boundaries, row, false), [own]);
  // A command's turn takes every compaction written since it began, as before.
  assert.deepEqual(endedCompactions(boundaries, row, true), [composed, own, copy]);
  assert.deepEqual(endedCompactions(boundaries, null, false), [], "no row of the turn read: nothing");
});

describe("/compact typed by an outside client: its own message, and no compaction of Filament's", () => {
  /** @type {any} */ let shim;
  /** @type {any} */ let up;
  /** @type {any[]} */ const calls = [];
  before(async () => {
    up = await fakeUpstream(async (/** @type {any} */ call) => {
      calls.push(call);
      return replyTo(call);
    });
    shim = await startApp({
      memory: true,
      summarizer: "m-1",
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: PRICING }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  // (fails before: no — a guard: Filament answers `/compact` only in a chat it composes)
  test("an outside client's /compact goes to its model as typed, and nothing is compacted", async () => {
    const sid = "compact-zc";
    /** @type {any[]} */
    const history = [];
    for (const t of ["one", "two", "/compact"]) {
      const before = calls.length;
      const r = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [...history, { role: "user", content: t }] }, { "x-session-id": sid });
      assert.equal(r.status, 200);
      const reply = textOf(await r.json());
      assert.equal(calls.length, before + 1, `"${t}" reached the model`);
      assert.equal(saidIn(calls.at(-1)), t, "as typed");
      history.push({ role: "user", content: t }, { role: "assistant", content: reply });
    }
    const chainId = (await (await shim.api("/api/requests?limit=10")).json()).requests.find((/** @type {any} */ x) => x.memory?.chain)?.memory?.chain;
    assert.ok(chainId, "the session exists");
    assert.deepEqual(shim.app.memory.archive.getCompactions(chainId), [], "no compaction of Filament's");
  });
});
