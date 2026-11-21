// @ts-check
// Envelopes for teams and flows (HarnessV4_Envelopes_Plan EN4): a team's result beside the chat, and a flow's end, reach
// the main agent's running turn through the registry, as a sub-agent's report does — sealed while it works, opened while
// it waits — never a note of Filament's under its "Acknowledge" heading (EN-D11). Its envelope names the team and its
// lead's subject line, else Filament's: the findings it counts, or what it was asked (EN-D3). A turn that ends before it
// reads one hands it back, and it goes as a turn of Filament's own once the chat is free; a chat at rest gets it so at
// once, whole (case 8). A turn that reads no inbox of Filament's still takes it as a note (EN-D10).
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { createTeamsBeside } from "../src/app/teams-beside.js";
import { recordBlock, resultSender, resultSubject } from "../src/core/beside.js";
import { endEnvelope } from "../src/core/flow.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const root = tmpdir();
const settled = () => new Promise((r) => setTimeout(r, 20));
/** A team's result as teams-beside hands it in. */
const RESULT = { id: "t1", text: "[Filament: a team beside this chat finished: …]\n\n<team-result team=\"Bug Hunter\">\nSubject: Two found in the parser\nA null read at parse.js:3.\n</team-result>", description: "the Bug Hunter team", sender: "the Bug Hunter team beside this chat", subject: "Two found in the parser" };

/**
 * A registry with no sub-agents of its own: what it keeps of the session's messages goes to `store`, which a registry
 * made on it reads as a restart's next process does; `envelopes`: the session's `subagents.envelopes`.
 * @param {{ store?: Map<string, any[]>, envelopes?: string }} [o]
 */
function made({ store = new Map(), envelopes } = {}) {
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    now: Date.now,
    context: {
      settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }], ...(envelopes ? { envelopes } : {}) }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: root, model: "m", projectId: "p1" }),
      view: async () => ({ text: "", turns: 0 }),
      brief: async () => null,
      modelProblem: () => null,
      mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
      saveQueue: (/** @type {string} */ chain, /** @type {any[]} */ list) => void store.set(chain, JSON.parse(JSON.stringify(list))),
      loadQueue: (/** @type {string} */ chain) => store.get(chain) || [],
    },
    call: async () => {
      throw new Error("no launch here");
    },
  });
  return { registry, store };
}
/** @param {ReturnType<typeof made>["registry"]} registry @param {string} [runId] */
const openDoor = (registry, runId = "turn-1") => registry.openTurn({ chainId: "c1", runId, cwd: root, mode: "edit", model: "m", thinking: null, fork: null });

describe("a team's result and a flow's end, in an envelope's words", () => {
  // (fails before: yes — a team's result had no sender or subject to say, and its lead was never asked for one)
  test("from the team beside the chat, in its lead's subject line — asked of it in its record — else its findings, else its ask; a flow's from the developer's flow, how its boxes ended", () => {
    assert.equal(resultSender({ name: "Bug Hunter" }), "the Bug Hunter team beside this chat");
    assert.equal(resultSender({ name: "Verifier", checked: { name: "Bug Hunter" } }), "the Verifier team beside this chat, which checked the Bug Hunter team's result");
    const listed = "Two found.\n\nFindings:\n- Found | A null read | parse.js:3 | a test\n- Found | A double send | send.js:8 | read it\n- Plausible | Off by one | lex.js:9 | no test\n- Not covered | the CLI | - | no slot";
    assert.equal(resultSubject({ ask: "find bugs", result: listed }), "4 findings: 2 found, 1 plausible, 1 not covered");
    assert.equal(resultSubject({ ask: "find bugs in the parser", result: "It looked." }), 'its result to "find bugs in the parser"; its lead wrote no subject line');
    const record = recordBlock({ team: "Bug Hunter", title: "x", turns: 1, text: "User: hi", form: "plain", cut: false, running: null, waiting: null });
    assert.match(record, /Start it with one line, "Subject: " and what you found or did in under 20 words: the main agent may read that line before the rest\./);
    const flow = /** @type {any} */ ({ title: "Ship it", steps: [{ boxes: [{ state: "done" }, { state: "failed" }] }, { boxes: [{ state: "skipped" }] }] });
    assert.deepEqual(endEnvelope(flow), { description: 'the flow "Ship it"', sender: 'the developer\'s flow "Ship it"', subject: "it is done, 2 steps: 1 of 3 boxes done, 1 failed, 1 skipped", via: "flow" });
    // The runner sends a flow's end with its envelope's words.
    assert.match(readFileSync(new URL("../src/app/flow-runner.js", import.meta.url), "utf8"), /deliverOwn\(flow\.chainId, \{\s+id: flow\.id,\s+text: flow\.end\.text,\s+envelope: endEnvelope\(flow\),/);
  });
});

describe("the registry takes a result handed in (hand)", () => {
  // (fails before: yes — nothing outside the registry could reach a turn's inbox: a team's result went in as a note)
  test("into the running turn, sealed while it works: its line in the team's words, its result kept until the envelope opens it; with no turn, refused", () => {
    const { registry } = made();
    assert.deepEqual(registry.hand("c1", RESULT), { ok: false, sealed: false }, "no turn reads the session's inbox");
    const door = openDoor(registry);
    let backs = 0;
    assert.deepEqual(registry.hand("c1", { ...RESULT, back: () => backs++ }), { ok: true, sealed: true });
    const [line, ...more] = door.inbox.take({ seal: true });
    assert.equal(more.length, 0);
    assert.equal(line.kind, "envelope");
    assert.match(line.text, /^\[Filament: envelope 1, sealed — from the Bug Hunter team beside this chat: Two found in the parser\. Finish what you are doing first, then open it with Filament's envelope tool/);
    assert.deepEqual(registry.envelopes("c1").map((e) => [e.n, e.sender, e.subject]), [[1, RESULT.sender, RESULT.subject]]);
    const [opened] = door.inbox.open({});
    assert.deepEqual([opened.kind, opened.opened, opened.text, opened.sender], ["result", true, RESULT.text, RESULT.sender]);
    door.close();
    assert.equal(backs, 0, "it was read: nothing goes back");
  });

  // (fails before: yes — EN5: the page's card of a team's or a flow's envelope had no way to tell it from a sub-agent's)
  test("who it came through rides with it, sealed and opened: the page's card opens the team's chat or the flow", () => {
    const { registry } = made();
    const door = openDoor(registry);
    registry.hand("c1", { ...RESULT, via: "team" });
    registry.hand("c1", { ...RESULT, id: "f1", text: "the flow's end", description: 'the flow "Ship it"', via: "flow" });
    const lines = door.inbox.take({ seal: true });
    assert.deepEqual(lines.map((l) => [l.kind, l.via]), [["envelope", "team"], ["envelope", "flow"]]);
    const opened = door.inbox.open({ all: true });
    assert.deepEqual(opened.map((d) => [d.kind, d.via, d.from]), [["result", "team", "t1"], ["result", "flow", "f1"]]);
    door.close();
  });

  test("a turn that waits takes it opened, the sealed ones first; a session set to Whole takes it whole at work", () => {
    const { registry } = made();
    const door = openDoor(registry);
    registry.hand("c1", RESULT);
    door.inbox.take({ seal: true });
    registry.hand("c1", { ...RESULT, id: "t2", text: "the second result", subject: "The tests pass" });
    const waited = door.inbox.take({});
    assert.deepEqual(waited.map((d) => [d.kind, !!d.opened, d.text]), [["result", true, RESULT.text], ["result", false, "the second result"]]);
    door.close();
    const whole = made({ envelopes: "whole" }).registry;
    const at = openDoor(whole);
    assert.deepEqual(whole.hand("c1", RESULT), { ok: true, sealed: false });
    assert.deepEqual(at.inbox.take({ seal: true }).map((d) => [d.kind, d.text]), [["result", RESULT.text]]);
    at.close();
  });

  // (fails before: yes — a result the turn never read went to the session's queue, for the developer's next message)
  test("a turn that ends before it reads one hands it back, never to the queue; a pause keeps it for the resume, whose end hands it back", () => {
    const { registry } = made();
    let backs = 0;
    const door = openDoor(registry);
    registry.hand("c1", { ...RESULT, back: () => backs++ });
    door.close();
    assert.equal(backs, 1);
    assert.equal(registry.queued("c1"), 0, "nothing waits for the developer's next message");
    const paused = openDoor(registry, "turn-2");
    registry.hand("c1", { ...RESULT, back: () => backs++ });
    paused.close({ paused: true });
    assert.equal(backs, 1, "a pause hands nothing back");
    const resumed = openDoor(registry, "turn-3");
    resumed.close();
    assert.equal(backs, 2, "the resume never read it: back it goes");
    // One with no way back waits for the next turn, as any message does.
    const third = openDoor(registry, "turn-4");
    registry.hand("c1", RESULT);
    third.close();
    assert.deepEqual(registry.peekQueued("c1").map((d) => d.kind), ["result"]);
  });

  test("kept through a restart: a sealed one stays sealed in its number; one never read waits for the next turn, its way back gone with the process", () => {
    const { registry, store } = made();
    const door = openDoor(registry);
    registry.hand("c1", RESULT);
    door.inbox.take({ seal: true });
    registry.hand("c1", { ...RESULT, id: "t2", text: "unread", back: () => {} });
    const kept = store.get("c1") || [];
    assert.deepEqual(kept.map((d) => [d.kind, d.envelope ?? null, "handed" in d]), [["result", null, false], ["result", 1, false]]);
    const next = made({ store }).registry;
    assert.deepEqual(next.envelopes("c1").map((e) => [e.n, e.sender]), [[1, RESULT.sender]]);
    assert.deepEqual(next.peekQueued("c1").map((d) => [d.kind, d.text]), [["result", "unread"]]);
  });
});

/**
 * Teams beside with a registry that takes results handed in (`hand`): the chat busy or at rest, its turn taking notes
 * or not; `post`: how a turn of Filament's own is answered, where not at once.
 * @param {{ busy?: boolean, steers?: boolean, hand?: ((chain: string, r: any) => { ok: boolean, sealed: boolean }) | null, post?: ((chain: string, text: string) => Promise<{ status: number, body: any }>) | null }} [o]
 */
function world({ busy = true, steers = true, hand = null, post = null } = {}) {
  const w = {
    busy,
    /** @type {any[]} */ handed: [],
    /** @type {{ chain: string, text: string }[]} */ steered: [],
    /** @type {{ chain: string, text: string }[]} */ sent: [],
    /** @type {ReturnType<typeof createTeamsBeside>} */ beside: /** @type {any} */ (null),
  };
  const chains = new Map([["c1", { id: "c1", kind: "harness", meta: {} }]]);
  w.beside = createTeamsBeside({
    archive: () => ({ getChain: (/** @type {string} */ id) => chains.get(id) || null, mergeMeta: () => {}, mainOf: () => null, besideOf: () => [] }),
    sessions: { settingsOf: () => ({ effective: { subagents: {} }, sources: {} }), besideFacts: () => ({ busy: false, asking: false, turns: 1, last: null }) },
    teams: /** @type {any} */ ({ find: () => null, list: () => [] }),
    registry: () => ({
      list: () => [],
      ...(hand
        ? {
            hand: (/** @type {string} */ chain, /** @type {any} */ r) => {
              w.handed.push({ chain, ...r });
              return hand(chain, r);
            },
          }
        : {}),
    }),
    postTurn: async () => ({ status: 200, body: null }),
    reach: {
      busy: () => w.busy,
      post: async (chain, text) => {
        w.sent.push({ chain, text });
        return post ? post(chain, text) : { status: 200, body: null };
      },
      steer: (chain, text) => {
        if (!steers) return { ok: false, error: "no" };
        w.steered.push({ chain, text });
        return { ok: true };
      },
    },
    remove: async () => {},
    events: { publish: () => {} },
    settleMs: 0,
  });
  return w;
}
const END = { id: "f1", text: "the end", envelope: { description: 'the flow "Ship it"', sender: 'the developer\'s flow "Ship it"', subject: "it is done" } };

describe("teams beside hand a result to the registry first (EN4)", () => {
  // (fails before: yes — a busy chat's result went in as a note, under "Acknowledge what you heard")
  test("a busy chat whose turn reads Filament's inbox takes it there — sealed, or whole where the session says so; no note; one that reads none takes the note", async () => {
    const sealing = world({ hand: () => ({ ok: true, sealed: true }) });
    assert.equal(await sealing.beside.deliverOwn("c1", { ...END, sent: () => {} }), "envelope");
    assert.deepEqual(sealing.handed.map((h) => [h.chain, h.id, h.text, h.description, h.sender, h.subject, typeof h.back]), [["c1", "f1", "the end", END.envelope.description, END.envelope.sender, "it is done", "function"]]);
    assert.deepEqual([sealing.steered, sealing.sent], [[], []]);
    const whole = world({ hand: () => ({ ok: true, sealed: false }) });
    assert.equal(await whole.beside.deliverOwn("c1", { ...END, sent: () => {} }), "steered");
    assert.deepEqual(whole.steered, [], "whole, through the inbox all the same");
    const none = world({ hand: () => ({ ok: false, sealed: false }) });
    assert.equal(await none.beside.deliverOwn("c1", { ...END, sent: () => {} }), "steered");
    assert.deepEqual(none.steered, [{ chain: "c1", text: "the end" }], "a turn that reads no inbox of Filament's: the note, as before");
    const unnamed = world({ hand: () => ({ ok: true, sealed: true }) });
    assert.equal(await unnamed.beside.deliverOwn("c1", { id: "f2", text: "no words", sent: () => {} }), "steered", "a message with no envelope's words is no result");
    assert.equal(unnamed.handed.length, 0);
  });

  test("a chat at rest gets it as a turn of Filament's own, whole; one its turn handed back goes so once the chat is free, and whoever sent it hears so", async () => {
    const free = world({ busy: false, hand: () => ({ ok: true, sealed: true }) });
    assert.equal(await free.beside.deliverOwn("c1", { ...END, sent: () => {} }), "sent");
    assert.deepEqual([free.handed.length, free.sent], [0, [{ chain: "c1", text: "the end" }]]);
    const w = world({ hand: () => ({ ok: true, sealed: true }) });
    /** @type {any[]} */
    const heard = [];
    assert.equal(await w.beside.deliverOwn("c1", { ...END, sent: (how, why) => heard.push([how, why]) }), "envelope");
    w.handed[0].back();
    assert.deepEqual(w.sent, [], "held while the turn still holds the chat");
    w.busy = false;
    w.beside.released("c1");
    await until(() => w.sent.length === 1, "the result as a turn of its own");
    await settled();
    assert.deepEqual(w.sent, [{ chain: "c1", text: "the end" }]);
    assert.deepEqual(heard, [["sent", undefined]]);
  });

  // (fails before: yes — the bug hunt of 10-30, SVC-13: a turn took the chat as a waiting result was sent, and let go of it
  // while that send was refused: the let-go found a send under way and went unheard, and the result waited for some
  // later turn of the chat to end)
  test("a result refused by a turn that let go of the chat while it was sent goes once that send is done", async () => {
    /** @type {any[]} */
    const heard = [];
    let n = 0;
    /** @type {any} */
    let w = null;
    w = world({
      busy: false,
      post: async () => {
        n += 1;
        // The first meets a turn at work; the second, one that lets go of the chat as it refuses it.
        if (n === 2) w.beside.released("c1");
        return n <= 2 ? { status: 409, body: { holder: { window: "harness" } } } : { status: 200, body: null };
      },
    });
    assert.equal(await w.beside.deliverOwn("c1", { ...END, sent: (/** @type {any} */ how, /** @type {any} */ why) => heard.push([how, why]) }), "waits");
    await until(() => w.sent.length === 3, "sent again once the chat was let go", { timeoutMs: 2000 });
    await settled();
    assert.deepEqual(heard, [["sent", undefined]]);
  });
});

describe("a team's result reaches a main agent at work sealed, through a throwaway Filament", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let dir;
  /** @type {string} */ let sid;
  /** The main agent's requests in its long turn, in order: their messages as JSON, and their tool names. @type {{ text: string, tools: string[] }[]} */
  const main = [];
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((r) => (release = () => r(undefined)));
  const LEAD = "Subject: Two found in the parser\n\nA null read and a double send.\n\nFindings:\n- Found | A null read | parse.js:3 | shown by a test\n- Found | A double send | send.js:8 | read it";
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "filament-envelopes-teams-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const text = JSON.stringify(call.body?.messages || []);
      if (text.includes("<main-chat")) return anthropicReply(LEAD, { model: "m-1" });
      if (!text.includes("work on the long task")) return anthropicReply("Hi.", { model: "m-1" });
      main.push({ text, tools: (call.body.tools || []).map((/** @type {any} */ t) => String(t.name)) });
      const k = main.length;
      if (k === 1) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "r1", name: "read", input: { path: "a.js" } }] });
      if (k === 2) {
        await held;
        return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "r2", name: "read", input: { path: "b.js" } }] });
      }
      if (k === 3) return anthropicReply("The task is done; now the envelope.", { model: "m-1", stop: "tool_use", blocks: [{ type: "text", text: "The task is done; now the envelope." }, { type: "tool_use", id: "e1", name: "envelope", input: {} }] });
      return anthropicReply("Read it: I will fix parse.js:3 next.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [dir], readerModel: "" };
      },
    });
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: dir, model: "m-1", preset: "plain" } });
    sid = String((await r.json()).id);
    const first = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(first.status, 200, await first.clone().text());
  });
  after(async () => {
    release();
    await shim?.stop();
    await up?.close();
    // Under the full suite's load a stopped worker's process can hold the folder past rmSync's own retries (Windows:
    // EPERM, as the run of 10-25 found): waited for until it goes, as the helpers do.
    await removeDirs(dir);
  });

  // (fails before: yes — the Bug Hunters' results of 10-23 landed whole in the middle of the main agent's work, under
  // "Acknowledge what you heard in your next reply before acting on it")
  test("Notify while it works: its line at the next step, in the team's words and its lead's subject; the agent finishes, opens it with its envelope tool, and reads it whole; no turn added", async () => {
    const fired = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "find bugs in the parser", model: "m-1" } });
    const team = (await fired.json()).team;
    assert.equal(fired.status, 200);
    await until(async () => ((await (await shim.api(`/api/sessions/${sid}/beside`)).json()).teams || []).find((/** @type {any} */ t) => t.id === team.id && t.state === "done") || null, "the hunt's result");
    const res = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "work on the long task", stream: true, runEvents: true } });
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id"));
    await until(() => main.length === 2, "the main agent at work, its second step held");
    const r = await shim.api(`/api/sessions/${sid}/beside/${team.id}/notify`, { method: "POST", body: {} });
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    assert.equal(out.how, "envelope");
    const row = ((await (await shim.api(`/api/sessions/${sid}/beside`)).json()).teams || []).find((/** @type {any} */ t) => t.id === team.id);
    assert.equal(row.notified.how, "envelope");
    release();
    await res.text();
    assert.equal(main.length, 4, main.map((m) => m.text.slice(-200)).join("\n---\n"));
    assert.ok(main[0].tools.includes("envelope"), main[0].tools.join(", "));
    const line = "[Filament: envelope 1, sealed — from the BugHunters team beside this chat: Two found in the parser. Finish what you are doing first";
    assert.ok(main[2].text.includes(line), main[2].text.slice(-1500));
    assert.ok(!main[2].text.includes("A double send"), "its result waits sealed");
    assert.ok(!main[2].text.includes("Acknowledge what you heard"), "no note of Filament's (EN-D11)");
    assert.ok(main[3].text.includes("[Filament: envelope 1, opened — from the BugHunters team beside this chat]"), main[3].text.slice(-1500));
    assert.ok(main[3].text.includes("A double send"), "opened whole");
    // The run says each; the main chat keeps its two turns: no turn of Filament's own for it.
    const events = ((await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || []);
    const sealed = events.find((/** @type {any} */ e) => e.type === "envelope-sealed");
    assert.deepEqual([sealed?.envelope, sealed?.agentId, sealed?.sender, sealed?.subject], [1, team.id, "the BugHunters team beside this chat", "Two found in the parser"]);
    assert.ok(events.some((/** @type {any} */ e) => e.type === "envelope-opened" && e.by === "tool" && e.envelope === 1));
    assert.ok(events.some((/** @type {any} */ e) => e.type === "subagent-report" && e.kind === "result" && e.agentId === team.id && e.description === "the BugHunters team"));
    const t = await (await shim.api(`/api/sessions/${sid}/transcript`)).json();
    assert.equal(t.turns.length, 2);
  });
});
