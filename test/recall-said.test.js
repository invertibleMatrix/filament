// @ts-check
// filament_recall named only to an agent that has it (the owner's of 11-09, D6). What comes back after a summary is
// kept without the recall words, and the composer says them where the reader has the tool: a model that takes no tools,
// and a coding agent that takes no MCP tools, have none. The block after a summary says them even where it brought
// nothing else back. A switch's handover names the tool in a letter's line only to an agent that has it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compose } from "../src/app/sessions/compose.js";
import { summaryLead } from "../src/app/sessions/compaction.js";
import { backAfterSummary, handoverFor } from "../src/app/sessions/reattach.js";
import { resolveSettings } from "../src/services/session-settings.js";
import { envelopeAnswer, openedText } from "../src/app/agent/envelopes.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { gate, until } from "./helpers/wait.js";

const SENDER = 'the chat "Ops" (c_ops)';
/** A letter that asked no reply, opened as the agent's envelope tool gives it. @param {string} id */
const opened = (id) => ({ text: `the build is green\n\n[Filament: letter ${id}, from ${SENDER}. It asks for no reply.]`, from: "", description: "", sender: SENDER, envelope: 4, kind: /** @type {const} */ ("report"), wrote: false, spentUsd: 0, toolCalls: 0, roundIds: [], opened: true });
/** A finished turn; `work` its calls and their results. @param {number} n @param {any[]} [work] */
const turn = (n, work = []) => ({
  turnId: 100 + n,
  n,
  user: { role: "user", content: [{ type: "text", text: `turn ${n}` }] },
  work,
  final: { role: "assistant", content: [{ type: "text", text: `done ${n}` }] },
  meta: {},
});
/** Turn 2 opens a letter that asked no reply. */
const LETTER_WORK = [
  { role: "assistant", content: [{ type: "tool_use", id: "u1", name: "envelope", input: { all: true } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: envelopeAnswer([/** @type {any} */ (opened("lt_aa11"))], 0) }] },
];
const TURNS = [turn(1), turn(2, LETTER_WORK), turn(3)];
const SETTINGS = resolveSettings({ session: { context: { strategy: "plain" } } }).effective;
const NEW = { role: "user", content: [{ type: "text", text: "next" }] };
const RECALL = "Any of turns 1–2 comes back word for word with filament_recall({ turn: n }), and filament_recall with no arguments lists them, newest first, with how each answer ended.";
const LETTER_RECALL = "; its words come back with filament_recall({ turn: 2 })";

/** The summary's message as the composer sends it, a text block each. @param {any} attached @param {boolean} [recall] */
const headOf = async (attached, recall) => {
  const head = { from_turn: 1, to_turn: 2, kind: "manual", text: "S", attached };
  const c = await compose({ turns: TURNS, compactions: [head], settings: SETTINGS, newUser: NEW, model: "m", window: 200_000, ...(recall === undefined ? {} : { recall }) });
  return c.body.messages[0].content.map((/** @type {any} */ b) => b.text);
};

// (fails before: yes — the block kept its recall words, so a reader with no filament_recall was told to call it)
test("the block after a summary is kept without the recall words; the composer says them where the reader has the tool, and only there", async () => {
  const stored = backAfterSummary({ doc: {}, turns: TURNS.slice(0, 2), toTurn: 2, root: "", window: 200_000 }).text;
  assert.ok(stored.includes("<letters>\n- letter lt_aa11"), stored);
  assert.doesNotMatch(stored, /filament_recall/, "the block as the archive keeps it");
  const bare = await headOf(stored, false);
  assert.deepEqual(bare, [summaryLead(1, 2, "S"), stored], "a reader with no filament_recall: the block as kept");
  const told = await headOf(stored);
  assert.equal(told.length, 2);
  assert.ok(told[1].startsWith("[Filament brought these back after the summary: the letters you opened in those turns, which asked no reply, and your reply that ended turn 2"), told[1]);
  assert.ok(told[1].includes(` ${RECALL}]\n\n<letters>\n`), "the recall line closes the block's lead");
  assert.ok(told[1].includes(`opened in turn 2 — it asked no reply${LETTER_RECALL}\n</letters>`), "a letter's line says the turn that brings its words back");
  assert.equal(told[1].split("filament_recall(").length - 1, 2, "each said once");
  const again = await headOf(stored);
  assert.deepEqual(again, told, "the same bytes on every request");
});

// (fails before: yes — the owner's of 11-09: a summary with nothing to bring back after it said nothing of recall)
test("a summary with nothing brought back after it: the recall line alone after it, where the reader has the tool", async () => {
  const stored = backAfterSummary({ doc: {}, turns: [turn(1), turn(2)].map((t) => ({ ...t, final: null })), toTurn: 2, root: "", window: 200_000 }).text;
  assert.equal(stored, "", "nothing to bring back: no block is kept");
  for (const attached of [stored, null]) {
    assert.deepEqual(await headOf(attached), [summaryLead(1, 2, "S"), `[Filament: ${RECALL}]`]);
    assert.deepEqual(await headOf(attached, false), [summaryLead(1, 2, "S")], "a reader with no filament_recall: the summary alone");
  }
  // A summary of one turn names it.
  const one = await compose({ turns: TURNS, compactions: [{ from_turn: 1, to_turn: 1, kind: "manual", text: "S", attached: null }], settings: SETTINGS, newUser: NEW, model: "m", window: 200_000 });
  assert.equal(one.body.messages[0].content[1].text, "[Filament: Turn 1 comes back word for word with filament_recall({ turn: 1 }).]");
});

// (fails before: yes — a block kept before the change carried the words, and they reached a reader with no tool)
test("a block kept with the recall words, as they were kept before: said once where the reader has the tool, left out where it has none", async () => {
  const lead = "[Filament brought these back after the summary: the letters you opened in those turns, which asked no reply.";
  const line = `- letter lt_aa11, from ${SENDER}, opened in turn 2 — it asked no reply`;
  const first = `${lead} ${RECALL}]\n\n<letters>\n${line}${LETTER_RECALL}\n</letters>`;
  // A summary that took the place of one of turn 1 named the turns since it alone: the head stands for all of them.
  const second = `${lead} Turn 2 comes back word for word with filament_recall({ turn: 2 }).]\n\n<letters>\n${line}${LETTER_RECALL}\n</letters>`;
  for (const kept of [first, second]) {
    assert.deepEqual(await headOf(kept, false), [summaryLead(1, 2, "S"), `${lead}]\n\n<letters>\n${line}\n</letters>`]);
    assert.deepEqual(await headOf(kept), [summaryLead(1, 2, "S"), `${lead} ${RECALL}]\n\n<letters>\n${line}${LETTER_RECALL}\n</letters>`]);
  }
});

// (fails before: yes — a switch's handover named filament_recall in a letter's line to an agent that has none)
test("a switch's handover names filament_recall in a letter's line only to an agent that has it", () => {
  const o = { doc: {}, turns: [{ n: 1, work: LETTER_WORK }, { n: 2, work: [] }], root: "", window: 200_000, from: "Claude Code" };
  const line = `\n\n<letters>\n- letter lt_aa11, from ${SENDER}, opened in turn 1 — it asked no reply`;
  assert.ok(handoverFor(o).text.endsWith(`${line}; its words come back with filament_recall({ turn: 1 })\n</letters>`), "an agent that has the tool");
  const bare = handoverFor({ ...o, recall: false }).text;
  assert.ok(bare.endsWith(`${line}\n</letters>`), bare);
  assert.doesNotMatch(bare, /filament_recall/);
});

// The loop's own fold inside a turn names the letters its folded rounds opened (turn.js `reattach`). Its block is kept
// in the turn's work, which every later request reads: a model that takes no tools reads it too.
describe("a fold of the loop's, read back in a later turn", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** The loop's rounds, each request's body. @type {any[]} */
  const rounds = [];
  const hold = gate();
  const answer = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-ok", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const lastText = (/** @type {any} */ m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ c) => c?.type === "text").map((/** @type {any} */ c) => c.text).join("\n"));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-recall-fold-"));
    writeFileSync(join(root, "mail.txt"), `${openedText(/** @type {any} */ ({ envelope: 3, sender: SENDER, text: `the build is green\n\n[Filament: letter lt_aa11, from ${SENDER}. It asks for no reply.]` }))}\n`);
    for (const f of ["a", "b"]) writeFileSync(join(root, `${f}.txt`), `MARKER-${f} ${"words ".repeat(400)}`);
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      const b = call.body || {};
      const sys = Array.isArray(b.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b.system || "");
      if (sys.includes("compaction summaries") || /^\[Filament: (this turn has reached the compaction line|the developer asked to compact this turn now)\./.test(lastText(b.messages?.at(-1))))
        return answer([{ type: "text", text: "<summary>\nRead the mail, then a.txt.\n</summary>" }]);
      rounds.push(b);
      const n = rounds.length;
      if (n === 1) return answer([toolUse("c1", "bash", { command: "cat mail.txt" })], "tool_use");
      if (n === 2) return answer([toolUse("r1", "read", { path: "a.txt" })], "tool_use");
      if (n === 3) {
        await hold.promise; // the developer presses Compact while round 3 is being decided
        return answer([toolUse("r2", "read", { path: "b.txt" })], "tool_use");
      }
      return answer([{ type: "text", text: "Done." }]);
    });
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "brain-none": { tools: false } } }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: true, tools: true, cue: false, rewrite: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "allow-all", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    hold.open();
    await shim?.stop();
    await up?.close();
    for (const dir of [shim?.dataDir, root]) {
      try {
        if (dir) rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  // (fails before: yes — the owner's of 11-09, D6: the fold kept its letter's recall words in the turn's work, and a
  // model that takes no tools was told to call filament_recall)
  test("its letter's line says filament_recall to a model that takes tools, and never to one that takes none", async () => {
    const created = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-ok", preset: "plain", settings: {} } })).json();
    const path = `/api/sessions/${encodeURIComponent(created.id)}`;
    const first = shim.api(`${path}/turns`, { method: "POST", body: { content: "read the mail, a and b", stream: false } });
    await until(() => rounds.length === 3, "round 3's model call to be in flight");
    const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
    const live = runs.find((/** @type {any} */ x) => x.status === "running");
    const asked = await shim.api(`/api/runs/${encodeURIComponent(live?.id)}/steer`, { method: "POST", body: { kind: "compact", text: "", from: "harness" } });
    assert.equal(asked.status, 200, await asked.clone().text());
    hold.open();
    const one = await first;
    assert.equal(one.status, 200, await one.clone().text());
    const folded = JSON.stringify(rounds[3].messages);
    assert.ok(folded.includes(`<letters>\\n- letter lt_aa11, from the chat \\"Ops\\" (c_ops), opened in turn 1 — it asked no reply`), folded.slice(0, 2000));
    /** The first request of a turn sent on `model`. @param {string} model @param {string} content */
    const next = async (model, content) => {
      const before = rounds.length;
      const r = await shim.api(`${path}/turns`, { method: "POST", body: { content, stream: false, settingsPatch: { model: { name: model } } } });
      assert.equal(r.status, 200, await r.clone().text());
      return JSON.stringify(rounds[before].messages);
    };
    const tools = await next("agent/brain-ok", "and now?");
    assert.match(tools, /opened in turn 1 — it asked no reply; its words come back with filament_recall\(\{ turn: 1 \}\)/, "a model that takes tools");
    const none = await next("agent/brain-none", "and then?");
    assert.match(none, /opened in turn 1 — it asked no reply/);
    assert.doesNotMatch(none, /filament_recall/, "a model that takes none");
  });
});
