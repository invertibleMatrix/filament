// @ts-check
// The sessions service's answers to what the sub-agent registry, the graph runner and a team's card ask over and over,
// made cheap without changing an answer: a chat's settings in force (never the Settings page's whole answer), where a
// launch works and on what, a team chat's newest turn, and the texts kept for a chat's agents — each archived once.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveNote } from "../src/core/move-note.js";
import { MemoryService } from "../src/services/memory/index.js";
import { sidecar } from "../src/adapters/sidecar/index.js";
import { createSessions } from "../src/app/sessions/service.js";

const dir = mkdtempSync(join(tmpdir(), "filament-lean-reads-"));
const folder = mkdtempSync(join(dir, "project-"));
let clock = 1_760_000_000_000;
const now = () => (clock += 1000);
/** @type {any} */
const cfg = { server: { host: "127.0.0.1" }, rules: {}, agentLoop: { permissions: "edit" }, memory: { enabled: true }, routes: [], upstreams: [], sessions: { defaults: { "context.compaction.thresholdPercent": 70 } } };
const config = { get: () => cfg };
const memory = new MemoryService(/** @type {any} */ ({ sidecar, getConfig: config.get, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20399", getModelNames: () => ["cheap"], now }));
memory.start();
// The archive is untyped JavaScript: its options read as their defaults, so it is held as any.
const archive = /** @type {any} */ (memory.archive);
const ops = { record: () => {} };
const sessions = createSessions({ memory, config, pipeline: { handle: async () => {} }, ops, log: () => {}, forkSession: async () => ({}), now });
after(async () => {
  await memory.shutdown();
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});

/**
 * Each call of the archive's `names` counted while `fn` runs, as `fn` leaves them.
 * @template T @param {string[]} names @param {() => T} fn @returns {{ out: T, calls: Record<string, any[][]> }}
 */
function counting(names, fn) {
  /** @type {Record<string, any[][]>} */
  const calls = Object.fromEntries(names.map((n) => [n, []]));
  const real = names.map((n) => archive[n]);
  names.forEach((n, i) => (archive[n] = (/** @type {any[]} */ ...args) => (calls[n].push(args), real[i].apply(archive, args))));
  try {
    return { out: fn(), calls };
  } finally {
    for (const n of names) delete archive[n];
  }
}
/** A chat with `n` finished turns. @param {number} n @param {any} [o] */
function chatWith(n, o = {}) {
  const { id } = sessions.create({ cwd: folder, model: "agent/m", preset: "plain", ...o });
  for (let i = 1; i <= n; i++) {
    const t = archive.beginTurn(id, { requestId: `r${i}`, model: "agent/m", client: "harness", userMessage: { role: "user", content: [{ type: "text", text: `turn ${i}` }] } });
    archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: `done ${i}` }] }, requestId: `r${i}` });
  }
  return id;
}

// (fails before: yes — there was no `effectiveOf`: every reader of a knob built the Settings page's whole answer)
test("a chat's settings in force are the Settings page's `effective`, for a chat of Filament's and a client's, and refused alike for none", () => {
  const mine = chatWith(1);
  sessions.patchSettings(mine, { patch: { context: { results: "pointer" } } });
  sessions.patchProjectSettings(archive.getChain(mine).project_id, { patch: { worktree: { copy: [".env"] } } });
  const theirs = archive.chainForKey("client-key-1", { cwd: folder, client: "claude-code", model: "claude-x" }).id;
  for (const id of [mine, theirs]) assert.deepEqual(sessions.effectiveOf(id), sessions.settingsOf(id).effective, id);
  assert.equal(sessions.effectiveOf(mine).context.results, "pointer");
  assert.throws(() => sessions.settingsOf("nope0000"), /no such session/);
  assert.throws(() => sessions.effectiveOf("nope0000"), /no such session/);
  const { calls } = counting(["getChain", "chainHead"], () => sessions.effectiveOf(mine));
  assert.deepEqual([calls.getChain.length, calls.chainHead.length], [0, 1], "the chain's head, never the chain whole");
});

// (fails before: yes — a launch's facts read the chain whole and built the Settings page's answer for its model, at
// every launch and every poll of the chat's agents)
test("where a launch works and on what: the chain's head and two keys of its meta; its client read only where it is read", () => {
  const id = chatWith(0);
  const { out, calls } = counting(["getChain"], () => {
    const info = sessions.launchInfo(id);
    return { cwd: info?.cwd, model: info?.model, full: info?.full, projectId: info?.projectId };
  });
  assert.deepEqual(out, { cwd: folder, model: "m", full: "agent/m", projectId: archive.getChain(id).project_id });
  assert.equal(calls.getChain.length, 0, "its place and its model: the chain is not read whole");
  archive.mergeMeta(id, { cwd: join(folder, "sub") });
  assert.equal(sessions.launchInfo(id)?.cwd, join(folder, "sub"), "the chat's own folder");
  archive.mergeMeta(id, { tree: { worktree: join(folder, "wt") } });
  assert.equal(sessions.launchInfo(id)?.cwd, join(folder, "wt"), "its worktree first");
  sessions.patchSettings(id, { patch: { model: { name: "agent/other" } } });
  assert.deepEqual([sessions.launchInfo(id)?.model, sessions.launchInfo(id)?.full], ["other", "agent/other"], "the model its settings name");
  const theirs = archive.chainForKey("client-key-2", { cwd: folder, client: "claude-code", model: "claude-x" }).id;
  assert.deepEqual([sessions.launchInfo(id)?.client, sessions.launchInfo(theirs)?.client], [archive.getChain(id).client, "claude-code"]);
  assert.equal(sessions.launchInfo("nope0000"), null);
});

// (fails before: yes — a team chat's card read the chat whole and every turn of it, to use its newest)
test("a team chat's facts read its newest turn alone and two keys of its meta; how many turns it has, where it is read", () => {
  const id = chatWith(12);
  const { out, calls } = counting(["getChain", "getTurns"], () => {
    const f = sessions.besideFacts(id);
    return { busy: f.busy, asking: f.asking, last: f.last };
  });
  assert.deepEqual([out.busy, out.asking, out.last?.n, out.last?.final, out.last?.text], [false, false, 12, true, "done 12"]);
  assert.equal(calls.getChain.length, 0, "the chain is not read whole");
  assert.deepEqual(calls.getTurns.map((a) => a[1]?.last), [1], "one turn read");
  assert.equal(sessions.besideFacts(id).turns, 12);
  archive.mergeMeta(id, { lastStop: { turn: 12 } });
  assert.equal(sessions.besideFacts(id).last?.stopped, true, "its last stop, read off its meta");
  assert.throws(() => sessions.besideFacts("nope0000"), /no such session/);
});

// (fails before: yes — every keep of a list archived each of its texts again: serialized, hashed and looked up)
test("a list kept again archives only the texts it did not keep last time, under the same hashes", () => {
  const id = chatWith(0);
  /** @type {import("../src/app/agent/subagents.js").SavedDelivery[]} */
  const list = [
    { text: "Subject: one\n\nThe first report.", from: "sa_1", description: "One", kind: "report" },
    { text: "Subject: two\n\nThe second report.", from: "sa_2", description: "Two", kind: "report" },
  ];
  const first = counting(["putMessage"], () => sessions.saveSubagentQueue(id, list));
  assert.equal(first.calls.putMessage.length, 2);
  const again = counting(["putMessage"], () => sessions.saveSubagentQueue(id, [...list, { text: "Subject: three\n\nA third.", from: "sa_3", description: "Three", kind: "report" }]));
  assert.equal(again.calls.putMessage.length, 1, "only the new one");
  assert.deepEqual(sessions.loadSubagentQueue(id).map((d) => d.text), [list[0].text, list[1].text, "Subject: three\n\nA third."], "each text there, as kept");
  const thread = (/** @type {string} */ report) => /** @type {any} */ ({ id: "sa_0000aaaa", origin: "owner", may: "edit", asked: false, card: { tag: "helper", name: "Helper", thinks: "Careful.", may: "edit" }, team: null, model: "m", seat: null, list: "side", description: "Fix", cwd: folder, mode: null, view: "none", running: false, changes: null, start: null, seen: null, memory: false, deliver: false, aside: false, status: "done", startedAt: 1, shares: null, cut: false, thinking: null, opening: [], work: null, exchanges: [{ prompt: "fix the cache", description: "Fix", by: "owner", runId: "run-1", status: "done", startedAt: 1, endedAt: 2, delivery: "held", outcome: { report, error: null, ms: 1, rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, wrote: false, stoppedBy: null } }] });
  assert.equal(counting(["putMessage"], () => sessions.saveSubagentThread(id, thread("Fixed."), 30)).calls.putMessage.length, 3, "its card's words, its prompt, its report");
  assert.equal(counting(["putMessage"], () => sessions.saveSubagentThread(id, thread("Fixed."), 30)).calls.putMessage.length, 0, "kept again as it was");
  assert.equal(counting(["putMessage"], () => sessions.saveSubagentThread(id, thread("Fixed, and tested."), 30)).calls.putMessage.length, 1, "its report moved");
  const [back] = sessions.loadSubagentThreads(id);
  assert.deepEqual([back.card.thinks, back.exchanges[0].prompt, back.exchanges[0].outcome?.report], ["Careful.", "fix the cache", "Fixed, and tested."]);
});

// (fails before: yes — a coding agent's turn read the chat's meta whole, at every turn, for the moves it had not heard of)
test("a coding agent's turn reads the chat's moves alone of its meta, and says the same note", () => {
  const id = chatWith(0);
  archive.mergeMeta(id, { moves: [{ id: "m1", from: { cwd: "/r" }, to: { cwd: "/r-x", branch: "x" }, files: [{ path: "a.txt" }] }, { id: "m0", told: true, from: { cwd: "/q" }, to: { cwd: "/r" }, files: [] }], other: "x".repeat(2000) });
  assert.deepEqual(moveNote(archive.metaOf(id, ["moves"])), moveNote(archive.getChain(id).meta));
  assert.match(String(moveNote(archive.metaOf(id, ["moves"]))?.text), /moved this chat from \/r to \/r-x \(branch x\)/);
  assert.deepEqual([moveNote(archive.metaOf(chatWith(0), ["moves"])), moveNote(archive.metaOf("nope0000", ["moves"]))], [null, null]);
  const src = readFileSync(new URL("../src/app/acp-turn.js", import.meta.url), "utf8");
  assert.match(src, /moveNote\(memory\.archive\?\.metaOf\(memChain, \["moves"\]\)\)/);
  assert.doesNotMatch(src, /moveNote\(memory\.archive\?\.getChain\(memChain\)\?\.meta\)/);
});

// (fails before: yes — every kept thread was read and decoded, those the registry held already too)
test("the threads a chat kept, less those the registry holds: those are not read", () => {
  const id = chatWith(0);
  const thread = (/** @type {string} */ agent, /** @type {string} */ words) => /** @type {any} */ ({ id: agent, origin: "owner", may: "edit", asked: false, card: { tag: "helper", name: "Helper", thinks: "", may: "edit" }, team: null, model: "m", seat: null, list: "side", description: words, cwd: folder, mode: null, view: "none", running: false, changes: null, start: null, seen: null, memory: false, deliver: false, aside: false, status: "done", startedAt: 1, shares: null, cut: false, thinking: null, opening: [], work: null, exchanges: [{ prompt: words, description: words, by: "owner", runId: null, status: "done", startedAt: 1, endedAt: 2, delivery: "held", outcome: { report: `${words}: done`, error: null, ms: 1, rounds: 1, toolCalls: 0, tokensIn: 1, tokensOut: 1, spentUsd: 0, wrote: false, stoppedBy: null } }] });
  for (const [agent, words] of [["sa_0000000a", "one"], ["sa_0000000b", "two"], ["sa_0000000c", "three"]]) sessions.saveSubagentThread(id, thread(agent, words), 30);
  const all = sessions.loadSubagentThreads(id);
  const { out, calls } = counting(["getMessage", "getChain"], () => sessions.loadSubagentThreads(id, (agent) => agent === "sa_0000000b"));
  assert.deepEqual(out, all.filter((t) => t.id !== "sa_0000000b"), "the others, as ever");
  assert.equal(calls.getMessage.length, 4, "two texts of each of the other two");
  assert.equal(calls.getChain.length, 0, "the chat's threads alone read of its meta");
});
