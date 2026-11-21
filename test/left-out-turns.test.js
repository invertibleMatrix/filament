// @ts-check
// A Filament chat keeps its own turns whether or not Memory settings leave it out (the decision of 11-02, after the
// owner's of 11-01: "being left out of memory should mean no recall, capture or briefing"): the archive is that chat's
// own record, which its history is composed from and its page reads. Memory does none of its own work there — no
// briefing, no injected items, no cue, no memory tools, no recall of other sessions, no capture and no learning — and
// memory's reads made for other chats and calls never read its turns. filament_recall rides its requests as any chat's
// (the decision of 11-02): it reads only the chat's own record.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { memoryThreads } from "../src/app/agent/graph-runner.js";
import { anthropicReply, anthropicStream, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const HOOK = `node "${fileURLToPath(new URL("./fixtures/hook.mjs", import.meta.url))}"`;
const MCP_FIXTURE = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
/** The archive of a running Filament, which memory opens. @param {Awaited<ReturnType<typeof startApp>>} shim @returns {any} */
const archiveOf = (shim) => shim.app.memory.archive;
/** A message's words, whatever its shape. @param {any} m */
const wordsOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).map((/** @type {any} */ b) => b?.text || "").join(""));
/** A request's system text. @param {any} body */
const systemOf = (body) => (typeof body?.system === "string" ? body.system : (body?.system || []).map((/** @type {any} */ b) => b?.text || "").join("\n"));
/** The names of the tools a request carries. @param {any} body @returns {string[]} */
const toolsOf = (body) => (body?.tools || []).map((/** @type {any} */ t) => String(t.name));
const OUT = 'model "brain-out" is excluded in Memory settings';

/**
 * A running Filament whose memory leaves model `brain-out` out (or the models `exclude` names), with a fake model
 * behind `brain-*` — its Upstreams rows `pricing` — and the helpers the tests share. `script` answers each call; by
 * default "answer <n>", counting every call.
 * @param {{ loop?: boolean, autopilot?: boolean, exclude?: string[], pricing?: Record<string, any> | null }} o
 */
function harness({ loop = false, autopilot = true, exclude = ["brain-out"], pricing = null }) {
  const root = mkdtempSync(join(tmpdir(), "filament-left-out-turns-"));
  const h = {
    root,
    /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
    up: /** @type {any} */ (null),
    /** @type {Awaited<ReturnType<typeof startApp>>} */
    shim: /** @type {any} */ (null),
    /** What each call to the model was sent, by the model it named. @type {Map<string, any[]>} */
    bodies: new Map(),
    n: 0,
    /** @type {((call: any) => any) | null} */
    script: null,
    /** @param {string} model @param {any} [settings] */
    async chat(model, settings = undefined) {
      const r = await h.shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain", ...(settings ? { settings } : {}) } });
      assert.equal(r.status, 200, await r.clone().text());
      return String((await r.json()).id);
    },
    /**
     * A turn; `text`: what came back, as the page reads it (a JSON reply's words, a stream's body whole). `asIs`: the
     * card's Send it as it is.
     * @param {string} id @param {string} content @param {boolean} [stream] @param {boolean} [asIs]
     */
    async say(id, content, stream = false, asIs = false) {
      const r = await h.shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream, ...(asIs ? { sendAsIs: true } : {}) } });
      assert.equal(r.status, 200, await r.clone().text());
      const raw = await r.text();
      const text = stream ? raw : wordsOf(JSON.parse(raw));
      return { text, rid: String(r.headers.get("x-filament-request-id")) };
    },
    /** The chat's transcript as its page reads it after a reload. @param {string} id @returns {Promise<any[]>} */
    async transcript(id) {
      return (await (await h.shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=0`)).json()).turns || [];
    },
    /** @param {(capture: any) => any} change */
    async capture(change) {
      const st = await (await h.shim.api("/api/state")).json();
      const memory = { ...st.config.memory, capture: change(st.config.memory.capture) };
      assert.equal((await h.shim.api("/api/config", { method: "PUT", body: { ...st.config, memory } })).status, 200);
    },
  };
  before(async () => {
    h.up = await fakeUpstream(async (call) => {
      const model = String(call.body?.model || "");
      h.bodies.set(model, [...(h.bodies.get(model) || []), call.body]);
      return (h.script && (await h.script(call))) || anthropicReply(`answer ${++h.n}`, { model });
    });
    h.shim = await startApp({
      memory: true,
      configure: (cfg) => {
        const row = (/** @type {string} */ id, on = true) => ({ id, name: id, type: "anthropic", baseUrl: h.up.url, apiKey: "s", enabled: on, ...(pricing ? { pricing } : {}) });
        // Without `loop`, a chat's turn is one request to its model. The loop is always on (the owner's of 11-09) and
        // runs a route whose own upstream is on: that one is off here, and its fallback answers.
        cfg.upstreams = loop ? [row("m")] : [row("m"), row("off", false)];
        cfg.routes = [{ match: "brain-*", upstream: loop ? "m" : "off", upstreamModel: "{model}", ...(loop ? {} : { fallbacks: [{ upstream: "m", upstreamModel: "{model}" }] }), enabled: true }];
        cfg.rules.resilience.failover = true; // the fallback is tried: off until switched on (the owner's of 11-09)
        cfg.memory.autopilot = { enabled: autopilot };
        // Learning on, as a person's memory has it: what memory would learn from a chat it works in.
        cfg.memory.capture = { turns: true, learn: true, excludeModels: exclude };
        if (loop) cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await h.shim.stop();
    await h.up.close();
    await removeDirs(root);
  });
  return h;
}

describe("a Filament chat Memory settings leave out keeps its own turns, and memory does nothing else in it", () => {
  const h = harness({});

  // (fails before: yes — memory's situate left the turn out, so no turn was archived: the third request went with
  // "third message" alone, and the transcript held no turn; and, before filament_recall was offered there, its requests
  // carried no tool at all, `[]`)
  test("each turn goes to the model with the chat's history, and the page shows every turn after a reload; nothing of memory's rides its requests but filament_recall", async () => {
    const took = await h.chat("brain-in");
    await h.say(took, "a message where memory works");
    const id = await h.chat("brain-out");
    const first = await h.say(id, "first message about parsers");
    const second = await h.say(id, "second message about lexers");
    await h.say(id, "third message");
    const sent = h.bodies.get("brain-out") || [];
    assert.equal(sent.length, 3);
    assert.match(first.text, /^answer \d+$/);
    assert.deepEqual(
      sent.at(-1).messages.map((/** @type {any} */ m) => [m.role, wordsOf(m)]),
      [
        ["user", "first message about parsers"],
        ["assistant", first.text],
        ["user", "second message about lexers"],
        ["assistant", second.text],
        ["user", "third message"],
      ],
    );
    const turns = await h.transcript(id);
    assert.equal(turns.length, 3, JSON.stringify(turns).slice(0, 400));
    assert.equal(archiveOf(h.shim).getTurns(id).length, 3);
    // Where memory works in the chat, its tools and filament_recall ride; here filament_recall alone, which reads only the
    // chat's own record (the decision of 11-02: before it, none), and no briefing.
    const inTools = toolsOf((h.bodies.get("brain-in") || [])[0]);
    assert.ok(inTools.includes("filament_memory_search") && inTools.includes("filament_recall"), inTools.join(", "));
    for (const b of sent) {
      assert.deepEqual(toolsOf(b), ["filament_recall"], "no memory tool; filament_recall");
      assert.doesNotMatch(systemOf(b), /Long-term memory \(Filament\)/);
    }
    const rec = await h.shim.record(first.rid);
    assert.equal(rec.memory?.turn, 1, "the record names the turn kept");
    assert.equal(rec.memory?.tools, false);
    assert.ok((rec.changes || []).includes(`memory: ${OUT} — the chat keeps its turns, and memory adds nothing to it`), (rec.changes || []).join("\n"));
  });

  // (fails before: yes — a streamed reply in such a chat was archived nowhere: the next request went without it)
  test("a streamed turn is kept too", async () => {
    const id = await h.chat("brain-out");
    h.script = (call) => (call.body?.stream ? anthropicStream("streamed answer", { model: String(call.body.model) }) : null);
    try {
      await h.say(id, "stream this", true);
    } finally {
      h.script = null;
    }
    await h.say(id, "and then this");
    const sent = h.bodies.get("brain-out") || [];
    assert.deepEqual(sent.at(-1).messages.map((/** @type {any} */ m) => [m.role, wordsOf(m)]).slice(0, 2), [["user", "stream this"], ["assistant", "streamed answer"]]);
    assert.equal((await h.transcript(id)).length, 2);
  });

  // (fails before: yes — a command answered in such a chat was recorded nowhere: the page lost it on a reload)
  test("a command answered in the chat is a turn of its transcript, and no turn of the model's history", async () => {
    const id = await h.chat("brain-out");
    await h.say(id, "plan the parser");
    const goal = await h.say(id, "/goal ship the parser");
    assert.match(goal.text, /a goal rides on memory's work/);
    await h.say(id, "go on");
    const turns = await h.transcript(id);
    assert.equal(turns.length, 3, JSON.stringify(turns).slice(0, 600));
    assert.deepEqual([turns[1].command, wordsOf(turns[1].user)], [true, "/goal ship the parser"], "the command's turn");
    const last = (h.bodies.get("brain-out") || []).at(-1);
    assert.deepEqual(last.messages.map((/** @type {any} */ m) => wordsOf(m)).filter((/** @type {string} */ w) => /goal/.test(w)), [], "the command's exchange reaches no model");
  });

  // (fails before: no — /goal's words said its command turn was none in any chat memory leaves out, and the code was
  // right: a chat Filament composes keeps it, as the test above shows; this pins the other half, an outside client's)
  test("`/goal` in an outside client's chat Memory settings leave out is answered by Filament, and gains no command turn", async () => {
    const r = await h.shim.post("/v1/messages", { model: "brain-out", max_tokens: 20, messages: [{ role: "user", content: "/goal ship the parser" }] }, { "x-session-id": "outside-goal" });
    assert.equal(r.status, 200, await r.clone().text());
    assert.match(wordsOf(await r.json()), /a goal rides on memory's work/);
    const rec = await h.shim.record(String(r.headers.get("x-filament-request-id")));
    assert.deepEqual([rec.memory?.command, rec.memory?.chain, rec.memory?.turn], [true, undefined, undefined], "no session, no command turn");
  });

  // (fails before: yes — such a chat sent `@mem status` to its model as a message, though the sessions service read it as
  // a command: the model answered "answer 8", and nothing said memory leaves the chat out)
  test("`@mem …` is Filament's there: answered in the setting's words on the chat's command turn, nothing reaching the model; an outside client's goes to its model as typed", async () => {
    const id = await h.chat("brain-out");
    const before = (h.bodies.get("brain-out") || []).length;
    const said = await h.say(id, "@mem status");
    assert.equal(said.text, `Memory leaves this chat out (${OUT}), and \`@mem\` is memory's: \`@mem status\` shows, keeps and changes nothing here.`);
    assert.equal((h.bodies.get("brain-out") || []).length, before, "nothing reached the model");
    const turns = await h.transcript(id);
    assert.deepEqual(turns.map((/** @type {any} */ t) => [t.command, wordsOf(t.user)]), [[true, "@mem status"]], "the chat's command turn");
    const client = await h.shim.post("/v1/messages", { model: "brain-out", max_tokens: 20, messages: [{ role: "user", content: "@mem status" }] }, { "x-session-id": "outside-left-out" });
    assert.equal(client.status, 200, await client.clone().text());
    assert.match(wordsOf(await client.json()), /^answer \d+$/, "a plain proxy: its model answers");
  });

  // (fails before: yes — a sub-agent's call on a model Memory settings exclude, made for a chat memory works in, booked
  // its cost on that chat's goal: the goal's totals went from 0 turns to 1, with 10 input and 5 output tokens)
  test("a call on a model Memory settings exclude, made for a chat memory works in, books on the chat's spend and nothing on its goal", async () => {
    const id = await h.chat("brain-in");
    await h.say(id, "warm the chat");
    const { newGoal } = await import("../src/services/memory/goal.js");
    const memory = /** @type {any} */ (h.shim.app.memory);
    memory.setGoal(id, { ...newGoal("ship the parser", { now: Date.now() }), status: "active", slice: "the parser ships" });
    const goal = structuredClone(memory.goalFor(id)?.totals);
    const spent = () => Number(archiveOf(h.shim).getChain(id)?.meta?.spend?.requests) || 0;
    const before = spent();
    const r = await h.shim.house("/v1/messages", { model: "brain-out", max_tokens: 20, messages: [{ role: "user", content: "a worker's call" }] }, { "x-filament-chain": id, "x-filament-subagent-of": "owner", "x-filament-memory": "tools" });
    assert.equal(r.status, 200, await r.clone().text());
    await r.json();
    await until(() => spent() > before || null, "booked on the chat's spend");
    assert.deepEqual(memory.goalFor(id)?.totals, goal, "nothing on its goal");
  });

  // (fails before: yes — a task of such a chat's graph named memory's thread and was given its words, `{ id, text, own }`,
  // and its done closed the thread in memory: `{ how: "closed" }`, the thread dismissed)
  test("a task on its graph names none of memory's threads, and a done one closes none from it", async () => {
    const id = await h.chat("brain-out");
    await h.say(id, "plan the crash work");
    const near = await h.chat("brain-in");
    await h.say(near, "the crash work goes on here too");
    const projectId = archiveOf(h.shim).chainHead(id)?.project_id;
    assert.equal(archiveOf(h.shim).chainHead(near)?.project_id, projectId, "one project");
    const memory = /** @type {any} */ (h.shim.app.memory);
    const t = (await memory.brain.fileLearned({ projectId, chainId: near, kind: "thread", text: "Find the cause of the quetzal crash", importance: 0.6 })).id;
    const threads = memoryThreads(memory);
    const named = threads.of(id, `i${t}`);
    const closed = await threads.close(id, `i${t}`, "the quetzal cache was the cause");
    assert.deepEqual(
      [named, closed, archiveOf(h.shim).items.get(t)?.status === "dismissed"],
      [{ error: `Memory leaves this chat out (${OUT}), so no thread of memory's goes on its graph` }, { how: "not", words: `Memory leaves this chat out (${OUT}): memory closes no thread from it` }, false],
    );
    assert.deepEqual(threads.of(near, `i${t}`), { id: `i${t}`, text: "Find the cause of the quetzal crash", own: false }, "a chat memory works in names it");
  });

  // (fails before: yes — memory's trace of such a turn read its words all the same: the record's "signals read" step said
  // the query "pelican tariffs confidential")
  test("its request's record holds none of its words in memory's trace", async () => {
    const id = await h.chat("brain-out");
    const { rid } = await h.say(id, "the pelican tariffs are confidential");
    const rec = await h.shim.record(rid);
    const steps = rec.memoryTrace?.steps || [];
    assert.ok(steps.some((/** @type {any} */ s) => s.name === "signals read"), JSON.stringify(steps.map((/** @type {any} */ s) => s.name)));
    assert.doesNotMatch(JSON.stringify(rec.memoryTrace), /pelican|tariff/i);
  });

  // (fails before: yes — no request of such a chat booked on its session: its spend read nothing (`meta.spend`
  // undefined), so its Spend, /cost and budget saw none of it; and with its turns kept and spendAdd as it was, a goal
  // its session had from before was booked the call, which /goal there says never happens)
  test("its model calls book on its session's spend, and nothing on a goal its session has from before", async () => {
    const id = await h.chat("brain-out");
    const { newGoal } = await import("../src/services/memory/goal.js");
    const memory = /** @type {any} */ (h.shim.app.memory);
    memory.setGoal(id, { ...newGoal("ship the parser", { now: Date.now() }), status: "active", slice: "the parser ships" });
    const before = structuredClone(memory.goalFor(id)?.totals);
    await h.say(id, "count this");
    assert.equal(archiveOf(h.shim).getChain(id)?.meta?.spend?.requests, 1, "booked on the session");
    assert.deepEqual(memory.goalFor(id)?.totals, before, "nothing on the goal");
  });

  // (fails before: yes — the run read the session as it found it: "nothing new", no word of Memory settings)
  test("memory learns nothing from it, whichever way in, and files nothing it says", async () => {
    const id = await h.chat("brain-out");
    await h.say(id, "remember that we deploy from the main branch");
    const memory = /** @type {any} */ (h.shim.app.memory);
    const run = await memory.learner.learnChain(id, { reason: "manual", force: true });
    assert.equal(run.skipped, `${OUT}: nothing is learned from this chat`);
    assert.deepEqual(archiveOf(h.shim).items.list({ chainId: id, limit: 50 }), [], "nothing filed from its words");
  });
});

describe("memory's reads for other chats and calls never read a chat Memory settings leave out", () => {
  const h = harness({});

  // (fails before: yes — a chat Memory settings came to leave out was read for every other chat all the same: memory's
  // search quoted its words, its session list named it with them, a load brought it in, the next chat's briefing named
  // it, and a learning run read it)
  test("its words are found by no search, no session list names it, none loads it, no briefing names it, and nothing is learned from it", async () => {
    const later = await h.chat("brain-later");
    await h.say(later, "the zebrafish parser keeps its own tokens");
    const memory = /** @type {any} */ (h.shim.app.memory);
    await h.capture((c) => ({ ...c, excludeModels: [...(c.excludeModels || []), "brain-later"] }));
    const words = /zebrafish/;
    const port = memory.scope({ role: "model" });
    const found = await port.search("zebrafish parser tokens");
    assert.deepEqual(found.filter((/** @type {any} */ it) => it.chainId === later || words.test(it.text)), []);
    assert.deepEqual(port.sessions("zebrafish").map((/** @type {any} */ s) => s.id), []);
    assert.equal(port.reaches(later), false);
    assert.equal(port.load(later, { view: "chat" }), null);
    assert.ok(memory.sessions("zebrafish").some((/** @type {any} */ s) => s.id === later), "the person's own list names it still");
    const run = await memory.learner.learnChain(later, { reason: "manual", force: true });
    assert.equal(run.skipped, 'model "brain-later" is excluded in Memory settings: nothing is learned from this chat');
    // A chat that opens in the same folder: its briefing names no session of the chat left out.
    const fresh = await h.chat("brain-in");
    await h.say(fresh, "what did we do with the zebrafish parser?");
    const sent = (h.bodies.get("brain-in") || []).at(-1);
    assert.ok(!systemOf(sent).includes(later), systemOf(sent));
    assert.doesNotMatch(JSON.stringify(sent.messages), /keeps its own tokens/, "nothing of its words recalled");
  });
});

describe("the project's dossier and a session Memory settings come to leave out", () => {
  const h = harness({});

  // (fails before: yes — a dossier line citing a session Memory settings came to leave out rode every briefing of the
  // project until the curator's next pass: "The pelican ledger closes on Fridays." in the next chat's system prompt)
  test("a dossier line that cites a session Memory settings came to leave out rides no briefing from then on", async () => {
    const cited = await h.chat("brain-ledger");
    await h.say(cited, "the pelican ledger closes on Fridays");
    const project = String(archiveOf(h.shim).chainHead(cited)?.project_id);
    archiveOf(h.shim).dossiers.add({ projectId: project, sections: [{ title: "How the project runs", lines: [{ text: "The pelican ledger closes on Fridays.", cites: [`s:${cited}`], flags: [] }] }], cites: [], basis: "a test's" });
    const first = await h.chat("brain-in");
    await h.say(first, "what closes when?");
    assert.match(systemOf((h.bodies.get("brain-in") || []).at(-1)), /The pelican ledger closes on Fridays\./, "while the session is memory's, its line rides");
    await h.capture((c) => ({ ...c, excludeModels: [...(c.excludeModels || []), "brain-ledger"] }));
    const next = await h.chat("brain-in");
    await h.say(next, "what closes when, again?");
    assert.doesNotMatch(systemOf((h.bodies.get("brain-in") || []).at(-1)), /pelican/i);
  });
});

describe("the turns a chat kept while Memory settings left it out stay apart once they no longer do", () => {
  const h = harness({});

  // (fails before: yes — memory kept a chat to itself only while its settings left it out: once its model was switched,
  // its twenty earlier turns were memory's like any — its search quoted "the quetzal ledger, part …")
  test("twenty turns kept while left out, then the chat's model switched: none reaches another chat or the learner, and the chat itself and the person's own list still read them", async () => {
    const id = await h.chat("brain-out");
    for (let i = 1; i <= 20; i++) await h.say(id, `the quetzal ledger, part ${i}`);
    const switched = await h.shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { model: { name: "brain-in" } } } });
    assert.equal(switched.status, 200, await switched.clone().text());
    const memory = /** @type {any} */ (h.shim.app.memory);
    assert.equal(memory.chatLeftOut(id), null, "memory no longer leaves the chat out");
    await h.say(id, "the heron index, after the switch", false, true);
    // What memory reads for another chat or call.
    const port = memory.scope({ role: "model" });
    const quetzal = /quetzal/i;
    assert.deepEqual((await port.search("quetzal ledger")).filter((/** @type {any} */ it) => quetzal.test(String(it.text))), [], "no search quotes them");
    assert.deepEqual(port.sessions("quetzal").map((/** @type {any} */ s) => s.id), [], "no session list finds the chat by them");
    const row = port.sessions("heron").find((/** @type {any} */ s) => s.id === id);
    assert.ok(row, "the chat is listed by the turn memory reads");
    assert.deepEqual([row.title, row.preview], [null, null], "named by none of the words kept apart");
    assert.doesNotMatch(JSON.stringify(row), quetzal);
    const loaded = port.load(id, { view: "chat" });
    assert.doesNotMatch(String(loaded?.text), quetzal, "a load into another chat");
    assert.match(String(loaded?.text), /heron index/);
    assert.equal(port.grep(id, { text: "quetzal" })?.matches?.length ?? 0, 0, "a grep");
    // A chat that opens in the same folder: its briefing and its recall.
    const fresh = await h.chat("brain-in");
    await h.say(fresh, "what did we do with the quetzal ledger?");
    const sent = JSON.stringify((h.bodies.get("brain-in") || []).at(-1));
    assert.doesNotMatch(sent, /quetzal ledger, part/, "nothing of them recalled or briefed");
    // The learner reads the turn after the switch alone, and moves past the twenty.
    /** @type {any[]} */
    const learned = [];
    const callModel = memory.callModel;
    const model = memory.learner.model;
    memory.callModel = async (/** @type {any} */ a) => {
      learned.push(a);
      return JSON.stringify({ state: { summary: "the heron index", open: [] } });
    };
    memory.learner.model = () => "brain-in";
    try {
      await memory.learner.learnChain(id, { reason: "manual", force: true });
    } finally {
      memory.callModel = callModel;
      memory.learner.model = model;
    }
    assert.ok(learned.length >= 1, "the learner read the chat");
    assert.doesNotMatch(JSON.stringify(learned), quetzal, "no summarizer was sent them");
    assert.match(JSON.stringify(learned), /heron index/);
    assert.equal(archiveOf(h.shim).getChain(id)?.meta?.learnedThrough, 21, "its cursor past them");
    // The chat itself, and the person's own list, still read them.
    await h.say(id, "and on");
    const own = (h.bodies.get("brain-in") || []).at(-1);
    assert.equal(wordsOf(own.messages[0]), "the quetzal ledger, part 1", "its own history carries them");
    assert.ok(memory.sessions("quetzal").some((/** @type {any} */ s) => s.id === id), "the person's own list finds it");
  });
});

describe("the agent loop in a chat Memory settings leave out", () => {
  const h = harness({ loop: true, autopilot: false });

  // (fails before: yes — the session-start hook keyed on memory's turn number, which a turn memory left out never had:
  // it never ran there)
  test("its session-start hook runs at its first turn, as in any chat", async () => {
    const seen = join(h.root, "hooks-seen.jsonl");
    const id = await h.chat("agent/brain-out", { hooks: [{ on: "session-start", command: `${HOOK} record "${seen}" allow` }] });
    await h.say(id, "hello");
    await h.say(id, "again");
    assert.ok(existsSync(seen), "the hook ran");
    const ran = readFileSync(seen, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(ran.length, 1, "at the first turn alone");
    assert.equal(ran[0].env.turn, "1");
  });

  // (fails before: yes — the note keyed on memory's turn number too: the first turn after a change carried none)
  test("the first turn after its MCP servers change carries the note", async () => {
    const NOTES = { name: "notes", command: process.execPath, args: [MCP_FIXTURE], load: "core" };
    const PAD = { name: "pad", command: process.execPath, args: [MCP_FIXTURE], load: "core" };
    const id = await h.chat("agent/brain-out", { plugins: { mcp: [NOTES] } });
    await h.say(id, "hello");
    const r = await h.shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { plugins: { mcp: [PAD] } } } });
    assert.equal(r.status, 200, await r.text());
    // The message asks first (the owner's of 11-06: what the chat sends ahead changed); sent as it is, it carries the note.
    await h.say(id, "which servers now?", false, true);
    const last = (h.bodies.get("brain-out") || []).at(-1);
    const asked = last.messages.findLast((/** @type {any} */ m) => m.role === "user");
    assert.match(wordsOf(asked), /\[Filament: the MCP servers changed since your last turn\./);
  });

  // (fails before: yes — the lead's turns were archived nowhere: its second turn went without its first)
  test("its team's lead keeps its turns, stamped as the team's", async () => {
    const id = await h.chat("brain-out");
    const set = await h.say(id, "/team Builders");
    assert.match(set.text, /Team \*\*Builders\*\* answers this chat's turns from the next message on/);
    await h.say(id, "plan the parser");
    await h.say(id, "now the lexer");
    const last = (h.bodies.get("brain-out") || []).at(-1);
    assert.deepEqual(last.messages.map((/** @type {any} */ m) => wordsOf(m)).filter((/** @type {string} */ w) => /^(plan the parser|now the lexer)$/.test(w)), ["plan the parser", "now the lexer"]);
    const turns = archiveOf(h.shim).getTurns(id);
    assert.equal(turns.length, 3, "the command's turn and the lead's two");
    assert.deepEqual(turns.slice(1).map((/** @type {any} */ t) => t.meta?.engine?.kind), ["team", "team"]);
  });

  // (fails before: yes — the chats another chat's agent may tell, which its refusal lists to its model, were every chat
  // of the project by its title or first message: "the cormorant ledger stays private" among them)
  test("the chats another chat's agent is told it may tell name no chat Memory settings leave out, nor one by words a turn kept apart gave it", async () => {
    const out = await h.chat("agent/brain-out");
    await h.say(out, "the cormorant ledger stays private");
    const other = await h.chat("agent/brain-in");
    const project = String(archiveOf(h.shim).chainHead(other)?.project_id);
    const made = await h.shim.api(`/api/space/${encodeURIComponent(project)}`, { method: "POST", body: {} });
    assert.equal(made.status, 200, await made.clone().text());
    /** What the Space tool answered the other chat's agent, asked to tell a chat that is none. */
    const told = async () => {
      /** @type {string | null} */
      let answer = null;
      h.script = (call) => {
        if (String(call.body?.model) !== "brain-in" || !toolsOf(call.body).includes("space")) return null;
        const last = call.body.messages.at(-1)?.content;
        const r = Array.isArray(last) ? last.find((/** @type {any} */ b) => b?.type === "tool_result") : null;
        if (!r) return anthropicReply("", { model: "brain-in", stop: "tool_use", blocks: [{ type: "tool_use", id: "s1", name: "space", input: { action: "needs", with: { ask: "tell", chats: ["Nobody"], words: "hi" } } }] });
        answer = typeof r.content === "string" ? r.content : wordsOf({ content: r.content });
        return anthropicReply("Noted.", { model: "brain-in" });
      };
      try {
        await h.say(other, "tell nobody");
      } finally {
        h.script = null;
      }
      return String(answer);
    };
    const first = await told();
    assert.match(first, /is no chat of this project; its chats:/, first);
    assert.doesNotMatch(first, /cormorant/, "the chat left out is not named");
    // No longer left out, it is named again — by no words of the turn kept apart, which gave it its name.
    const switched = await h.shim.api(`/api/sessions/${encodeURIComponent(out)}/settings`, { method: "PATCH", body: { patch: { model: { name: "agent/brain-in" } } } });
    assert.equal(switched.status, 200, await switched.clone().text());
    await h.say(out, "on with the gannet tables", false, true);
    const second = await told();
    assert.match(second, /an untitled chat/, second);
    assert.doesNotMatch(second, /cormorant/);
  });

  // (fails before: yes — memory's prepare of such a chat's tick ended before it read what the tick before left: a
  // filament_recall call made beside the loop's own was answered on no request, its result dropped)
  test("a filament_recall call made beside the loop's own tools is answered on the next tick, and its answer rides on, byte for byte", async () => {
    writeFileSync(join(h.root, "a.txt"), "alpha\n");
    writeFileSync(join(h.root, "b.txt"), "beta\n");
    const id = await h.chat("agent/brain-out");
    /** Each tick's messages as they went out. @type {any[][]} */
    const ticks = [];
    h.script = (call) => {
      if (String(call.body?.model) !== "brain-out" || !toolsOf(call.body).includes("read")) return null;
      const asked = wordsOf(call.body.messages.findLast((/** @type {any} */ m) => m.role === "user" && typeof m.content === "string" || (Array.isArray(m.content) && m.content.some((/** @type {any} */ b) => b?.type === "text" && !String(b.text).startsWith("<filament")))));
      if (/^hello there/.test(asked)) return anthropicReply("Hi, the heron says hello.", { model: "brain-out" });
      ticks.push(structuredClone(call.body.messages));
      if (ticks.length === 1)
        return anthropicReply("", { model: "brain-out", stop: "tool_use", blocks: [{ type: "tool_use", id: "r1", name: "read", input: { path: join(h.root, "a.txt") } }, { type: "tool_use", id: "rc1", name: "filament_recall", input: { turn: 1 } }] });
      if (ticks.length === 2) return anthropicReply("", { model: "brain-out", stop: "tool_use", blocks: [{ type: "tool_use", id: "r2", name: "read", input: { path: join(h.root, "b.txt") } }] });
      return anthropicReply("Read both.", { model: "brain-out" });
    };
    try {
      await h.say(id, "hello there");
      await h.say(id, "read a and b");
    } finally {
      h.script = null;
    }
    assert.equal(ticks.length, 3);
    const leg = ticks[1].length - 1;
    /** A message's bytes but the cache marker, which moves to each request's newest message. @param {any} m */
    const bytes = (m) => JSON.stringify(m, (k, v) => (k === "cache_control" ? undefined : v));
    const answer = bytes(ticks[1][leg]);
    assert.match(answer, /<filament-memory kind=\\"recall\\">\\nResults of the memory tools the model called in its previous reply \(Filament\):/, answer.slice(0, 400));
    assert.match(answer, /the heron says hello/, "turn 1, brought back");
    assert.equal(bytes(ticks[2][leg]), answer, "the next tick sends that message as it went out");
  });

  // (fails before: yes — the result went whole, 607 characters with the file's 600, and no tick carried filament_recall:
  // the chat was offered none, so its loop capped nothing there)
  test("its loop keeps its turn's work, and a result past the cap reaches the model as its head and a pointer, which filament_recall brings back whole", async () => {
    const big = join(h.root, "big.txt");
    writeFileSync(big, "x".repeat(600));
    const id = await h.chat("agent/brain-out", { loop: { resultCapChars: 100 } });
    /** What each tool result said, by the call it answered. @type {Map<string, string>} */
    const results = new Map();
    /** Each call's tools. @type {string[][]} */
    const offered = [];
    h.script = (call) => {
      if (String(call.body?.model) !== "brain-out" || !toolsOf(call.body).includes("read")) return null;
      offered.push(toolsOf(call.body));
      for (const m of call.body.messages)
        for (const b of Array.isArray(m.content) ? m.content : [])
          if (b?.type === "tool_result") results.set(String(b.tool_use_id), typeof b.content === "string" ? b.content : wordsOf({ content: b.content }));
      if (!results.has("r1")) return anthropicReply("", { model: "brain-out", stop: "tool_use", blocks: [{ type: "tool_use", id: "r1", name: "read", input: { path: big } }] });
      const ref = /r:[0-9a-f]{8}/.exec(results.get("r1") || "")?.[0];
      if (ref && !results.has("rc1")) return anthropicReply("", { model: "brain-out", stop: "tool_use", blocks: [{ type: "tool_use", id: "rc1", name: "filament_recall", input: { result: ref } }] });
      return anthropicReply("Read it.", { model: "brain-out" });
    };
    /** @type {string} */
    let rid;
    try {
      ({ rid } = await h.say(id, "read big.txt"));
    } finally {
      h.script = null;
    }
    const said = results.get("r1") || "";
    assert.ok(!said.includes("x".repeat(600)), `its head: ${said.length} characters`);
    assert.match(said, /\n…\[Filament: \d+ more characters archived, not shown \(loop\.resultCapChars 100\); filament_recall\(\{ result: "r:[0-9a-f]{8}" \}\) brings the whole result back\]$/);
    assert.ok((results.get("rc1") || "").includes("x".repeat(600)), `brought back whole: ${(results.get("rc1") || "").slice(0, 200)}`);
    assert.ok(offered.length >= 3, `the ticks and the recall's follow-up: ${offered.length}`);
    for (const t of offered) assert.ok(t.includes("filament_recall"), t.join(", "));
    // Each tick sits on the chat, memory-quiet as a tick is in any chat; the recall ran inside the second.
    const ticks = ((await (await h.shim.api("/api/requests?limit=50&scope=all")).json()).requests || []).filter((/** @type {any} */ x) => x.agentOf === rid);
    assert.deepEqual(ticks.map((/** @type {any} */ t) => [t.memory?.chain, t.memory?.quiet, t.memory?.recalls ?? 0]).sort((a, b) => a[2] - b[2]), [[id, true, 0], [id, true, 1]]);
    const [turn] = archiveOf(h.shim).getTurns(id);
    assert.ok(turn, "the turn is kept");
    const row = archiveOf(h.shim).getTurn(turn.id);
    assert.equal(row?.meta?.capped?.length, 1, "the whole result, named on its turn");
    assert.ok((row?.work || []).length >= 2, "with its work: the call and its result");
  });
});

describe("the lanes another chat's agent reads, where Memory settings leave a chat of the project out", () => {
  const h = harness({ loop: true, autopilot: false });

  // (fails before: yes — lead 3 of the 11-02 privacy round: the lanes named every chat of a place by its title or first
  // words, the one left out among them: "chats: the osprey ledger stays private — idle since …" in the other chat's
  // tool result, and once it was no longer left out, by those words still)
  test("they name no chat Memory settings leave out, nor one by words a turn kept apart gave it; the asking chat is there as ever", async () => {
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: h.root, stdio: "ignore" });
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "start");
    const out = await h.chat("agent/brain-out");
    await h.say(out, "the osprey ledger stays private");
    const other = await h.chat("agent/brain-in");
    await h.say(other, "the public tables");
    const project = String(archiveOf(h.shim).chainHead(other)?.project_id);
    const made = await h.shim.api(`/api/space/${encodeURIComponent(project)}`, { method: "POST", body: {} });
    assert.equal(made.status, 200, await made.clone().text());
    /** What the Space tool's lanes told the other chat's agent. */
    const lanes = async () => {
      /** @type {string | null} */
      let answer = null;
      h.script = (call) => {
        if (String(call.body?.model) !== "brain-in" || !toolsOf(call.body).includes("space")) return null;
        const last = call.body.messages.at(-1)?.content;
        const r = Array.isArray(last) ? last.find((/** @type {any} */ b) => b?.type === "tool_result") : null;
        if (!r) return anthropicReply("", { model: "brain-in", stop: "tool_use", blocks: [{ type: "tool_use", id: "l1", name: "space", input: { action: "lanes" } }] });
        answer = typeof r.content === "string" ? r.content : wordsOf({ content: r.content });
        return anthropicReply("Read them.", { model: "brain-in" });
      };
      try {
        await h.say(other, "read the lanes");
      } finally {
        h.script = null;
      }
      return String(answer);
    };
    const first = await lanes();
    assert.match(first, /chats: .*the public tables \(you\)/, first);
    assert.doesNotMatch(first, /osprey/, "the chat left out is not named");
    // No longer left out, it is named again — by no words of the turn kept apart, which gave it its name.
    const switched = await h.shim.api(`/api/sessions/${encodeURIComponent(out)}/settings`, { method: "PATCH", body: { patch: { model: { name: "agent/brain-in" } } } });
    assert.equal(switched.status, 200, await switched.clone().text());
    await h.say(out, "on with the gannet tables", false, true);
    const second = await lanes();
    assert.match(second, /an untitled chat/, second);
    assert.doesNotMatch(second, /osprey/);
  });
});

describe("the Space another chat's agent reads, where Memory settings leave a chat of the project out", () => {
  const h = harness({ loop: true, autopilot: false });
  /**
   * One call of a tool by a chat's agent, on its model: what it answered.
   * @param {string} id @param {string} model @param {string} tool @param {any} input
   */
  const toolBy = async (id, model, tool, input) => {
    /** @type {string | null} */
    let answer = null;
    h.script = (call) => {
      if (String(call.body?.model) !== model || !toolsOf(call.body).includes(tool)) return null;
      const last = call.body.messages.at(-1)?.content;
      const r = Array.isArray(last) ? last.find((/** @type {any} */ b) => b?.type === "tool_result") : null;
      if (!r) return anthropicReply("", { model, stop: "tool_use", blocks: [{ type: "tool_use", id: "s1", name: tool, input }] });
      answer = typeof r.content === "string" ? r.content : wordsOf({ content: r.content });
      return anthropicReply("Done.", { model });
    };
    try {
      await h.say(id, `${tool}: ${input.action}`);
    } finally {
      h.script = null;
    }
    return String(answer);
  };
  /** One call of the space tool by a chat's agent. @param {string} id @param {string} model @param {any} input */
  const spaceBy = (id, model, input) => toolBy(id, model, "space", input);
  /** A chat left out, titled, and one memory works in, in a project with a Space. */
  const chats = async () => {
    const out = await h.chat("agent/brain-out");
    archiveOf(h.shim).setTitle(out, "Osprey ledger");
    const other = await h.chat("agent/brain-in");
    const project = String(archiveOf(h.shim).chainHead(other)?.project_id);
    const made = await h.shim.api(`/api/space/${encodeURIComponent(project)}`, { method: "POST", body: {} });
    assert.ok(made.status === 200 || made.status === 409, await made.clone().text());
    return { out, other };
  };

  // (fails before: yes — round 5's lead 2 of the 11-02 privacy round: the Space named every chat by its title to every
  // chat's agent: the board the other chat's agent read said `t2 "count the ledger" — Osprey ledger has it`)
  test("the board and a task taken name the chat left out as an untitled chat; its own agent reads its own name", async () => {
    const { out, other } = await chats();
    const added = await spaceBy(out, "brain-out", { action: "add", title: "count the ledger", to: "doing" });
    const task = /\bt\d+\b/.exec(added)?.[0];
    assert.ok(task, added);
    const read = await spaceBy(other, "brain-in", { action: "read" });
    const board = read.slice(0, read.indexOf("The logbook"));
    assert.match(board, /an untitled chat has it/, board);
    assert.doesNotMatch(board, /Osprey/);
    assert.match(await spaceBy(other, "brain-in", { action: "take", id: task }), /It was an untitled chat's/);
    assert.match(await spaceBy(out, "brain-out", { action: "read" }), /Your chat is "Osprey ledger"/, "its own agent reads its own name");
  });

  // (fails before: yes — round 5's lead 1 of the 11-02 privacy round: Filament's line on the chat's turns named it by its
  // first words in the logbook the other chat's agent read: `Filament: “the cormorant tables stay ours” finished a turn`)
  test("Filament's line on the chat's turns names it as an untitled chat to the other chat's agent, and by its words on the person's page", async () => {
    const out = await h.chat("agent/brain-out");
    await h.say(out, "the cormorant tables stay ours");
    const other = await h.chat("agent/brain-in");
    const project = String(archiveOf(h.shim).chainHead(other)?.project_id);
    const made = await h.shim.api(`/api/space/${encodeURIComponent(project)}`, { method: "POST", body: {} });
    assert.ok(made.status === 200 || made.status === 409, await made.clone().text());
    await h.say(out, "and the next table");
    /** The person's Space page: Filament's line on the chat. */
    const page = async () => ((await (await h.shim.api(`/api/space/${encodeURIComponent(project)}`)).json()).log || []).filter((/** @type {any} */ e) => e.key === `finished:${out}`);
    await until(async () => (await page()).length > 0, "Filament's line on the chat's turn");
    const read = await spaceBy(other, "brain-in", { action: "read" });
    assert.doesNotMatch(read, /cormorant/, read);
    assert.match(read, /Filament: “an untitled chat” finished (a turn|\d+ turns)/);
    assert.match((await page())[0].text, /^“the cormorant tables stay ours” finished /, "the person's page names it by its words");
  });

  // (fails before: yes — round 6's lead 2 of the 11-02 privacy round: the ask kept its asker's title as it was asked, and
  // the other chat's agent read Needs you by it: `Osprey ledger's ask, for the person's press`)
  test("an ask the chat left out made is named to the other chat's agent as an untitled chat's, and its own agent reads it as its own", async () => {
    const { out, other } = await chats();
    archiveOf(h.shim).setTitle(other, "Public tables");
    const asked = await spaceBy(out, "brain-out", { action: "needs", with: { ask: "tell", chats: ["Public tables"], words: "the ledger moved" } });
    assert.doesNotMatch(asked, /no chat of this project/, asked);
    const read = await spaceBy(other, "brain-in", { action: "needs" });
    assert.match(read, /an untitled chat's ask, for the person's press/, read);
    assert.doesNotMatch(read, /Osprey/);
    assert.match(await spaceBy(out, "brain-out", { action: "needs" }), /your ask, for the person's press/);
  });

  // (fails before: yes — round 7's lead 2 of the 11-02 privacy round: the store refused the other chat's rewrite naming
  // the chat left out by its title: "r1 is Osprey ledger's routine: propose one of your own.")
  test("a refusal to the other chat's agent names the chat left out as an untitled chat: its routine, which that agent may not rewrite", async () => {
    const { out, other } = await chats();
    const proposed = await spaceBy(out, "brain-out", { action: "routine", with: { title: "Ledger brief", when: "weekdays 09:00", text: "Count the ledger." } });
    const id = /\br\d+\b/.exec(proposed)?.[0];
    assert.ok(id, proposed);
    const refused = await spaceBy(other, "brain-in", { action: "routine", with: { id, title: "Ledger brief", when: "weekdays 10:00", text: "Count it later." } });
    assert.match(refused, new RegExp(`${id} is an untitled chat's routine: propose one of your own`), refused);
    assert.doesNotMatch(refused, /Osprey/);
  });

  // (fails before: yes — round 6's lead 3 of the 11-02 privacy round: an app's `filament` source named every chat of the
  // project by its title or first words, and the other chat's agent read the app's rows whole: `title: Osprey ledger`)
  test("an app reading Filament's chats names the chat left out as an untitled chat in the rows another chat's agent reads", async () => {
    const { out, other } = await chats();
    const project = String(archiveOf(h.shim).chainHead(other)?.project_id);
    const APP = { type: "app", title: "Chats", html: "<!doctype html><title>Chats</title><main></main>", sources: { chats: { filament: "chats", key: "id" } } };
    const published = await toolBy(other, "brain-in", "artifact", { action: "publish", ...APP });
    assert.match(published, /Chats/, published);
    const base = `/api/space/${encodeURIComponent(project)}`;
    const app = await until(async () => ((await (await h.shim.api(base)).json()).dashboards || []).find((/** @type {any} */ d) => d.title === "Chats"), "the app on the Space");
    const kept = await h.shim.api(`${base}/dashboards/${encodeURIComponent(app.name)}/keep`, { method: "POST", body: { v: 1 } });
    assert.equal(kept.status, 200, await kept.clone().text());
    const read = await spaceBy(other, "brain-in", { action: "app", with: { name: app.name, read: true } });
    assert.match(read, new RegExp(out), read);
    assert.doesNotMatch(read, /Osprey/);
    assert.match(read, /an untitled chat/);
  });
});

describe("a sub-agent's picture in a chat Memory settings leave out", () => {
  const h = harness({ loop: true, autopilot: false });
  const SVG = '<svg viewBox="0 0 80 40"><rect x="4" y="4" width="40" height="20"/></svg>';
  const HELPER = "You are a sub-agent run by Filament";
  /** The text of the newest message's tool result, or null where it carries none. @param {any} call */
  const resultOf = (call) => {
    const last = (call.body.messages || []).at(-1);
    const r = Array.isArray(last?.content) ? last.content.find((/** @type {any} */ b) => b?.type === "tool_result") : null;
    return r ? (typeof r.content === "string" ? r.content : wordsOf({ content: r.content })) : null;
  };

  // (fails before: yes — lead 4 of the 11-02 privacy round: memory's prepare of the helper's calls returned for the chat
  // left out before it named the turn that launched it (`launchTurn`), so the picture was kept on the session as a helper's
  // no turn launched: the launching turn listed none, and the helper's thread said it drew on no turn)
  test("a helper the chat's agent launched keeps its picture on the turn that launched it, as in any chat", async () => {
    const id = await h.chat("agent/brain-out");
    h.script = (call) => {
      if (String(call.body?.model) !== "brain-out") return null;
      const result = resultOf(call);
      const tool = (/** @type {string} */ tid, /** @type {string} */ name, /** @type {any} */ input) => anthropicReply("", { model: "brain-out", stop: "tool_use", blocks: [{ type: "tool_use", id: tid, name, input }] });
      if (JSON.stringify(call.body.system ?? "").includes(HELPER)) return result == null ? tool("toolu_hv", "show_visual", { title: "helper flow", code: SVG }) : anthropicReply("HELPER REPORT", { model: "brain-out" });
      return result == null ? tool("toolu_ag", "agent", { run_in_background: false, description: "draw the flow", prompt: "Draw the flow." }) : anthropicReply("MAIN DONE", { model: "brain-out" });
    };
    try {
      assert.equal((await h.say(id, "launch the drawer")).text, "MAIN DONE");
    } finally {
      h.script = null;
    }
    const t = (await (await h.shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).turns.at(-1);
    const [sa] = (await (await h.shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents;
    assert.deepEqual(
      [(t.visuals || []).map((/** @type {any} */ v) => [v.id, v.title, v.by, v.exchange]), sa?.exchanges?.[0]?.drew?.map((/** @type {any} */ d) => [d.id, d.turn])],
      [[["toolu_hv", "helper_flow", sa?.id, 0]], [["toolu_hv", t.n]]],
    );
  });
});

describe("a chat Memory settings leave out, on a model that takes no tools", () => {
  const h = harness({ exclude: ["brain-out", "brain-bare-out", "brain-refuses-out"], pricing: { "brain-bare-out": { tools: false } } });
  /** Each model's requests as they went out: their tools. @param {string} model */
  const toolsSent = (model) => (h.bodies.get(model) || []).map(toolsOf);
  /** A request carrying tools is refused whole, as Ollama refuses a model without a tool template. @param {any} call */
  const refusing = (call) =>
    (call.body?.tools || []).length ? { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: `registry.ollama.ai/library/${call.body.model} does not support tools` } } } : null;
  /** @param {string} rid */
  const notes = async (rid) => [...((await h.shim.record(rid)).priorChanges || []), ...((await h.shim.record(rid)).changes || [])].map(String);

  // (fails before: yes — the model's "no tools" mark was read only where memory situated the request, so the turn of a
  // chat it leaves out went with [filament_recall], and the model refused it whole: the turn failed)
  test("one whose row says it takes no tools is offered no filament_recall: its turns go without tools, and its model answers them", async () => {
    h.script = refusing;
    try {
      const id = await h.chat("brain-bare-out");
      const first = await h.say(id, "hello there");
      const second = await h.say(id, "and again");
      assert.match(first.text, /^answer \d+$/);
      assert.match(second.text, /^answer \d+$/);
      assert.deepEqual(toolsSent("brain-bare-out"), [[], []], "no tools on either");
      assert.ok((await notes(first.rid)).includes("memory: tools not offered — brain-bare-out at m takes no tools (its row on the Upstreams page says so)"), (await notes(first.rid)).join("\n"));
    } finally {
      h.script = null;
    }
  });

  // (fails before: yes — the request went again without the tools Filament added only where memory's own tools rode it:
  // filament_recall alone stayed on, and the model's 400 failed the turn)
  test("one that refuses tools gets its turn again without filament_recall, and is offered none after", async () => {
    h.script = refusing;
    try {
      const id = await h.chat("brain-refuses-out");
      const first = await h.say(id, "hello there");
      assert.match(first.text, /^answer \d+$/);
      assert.deepEqual(toolsSent("brain-refuses-out"), [["filament_recall"], []], "refused with it, answered without it");
      const said = await notes(first.rid);
      assert.ok(said.some((n) => /^memory: brain-refuses-out at m refused the request for filament_recall \(HTTP 400: .*does not support tools.*\); it was sent again without it$/.test(n)), said.join("\n"));
      assert.ok(said.includes("memory: brain-refuses-out at m answered without it — it takes no tools; Filament offers it none of its tools until this upstream's address or type changes, or a restart"), said.join("\n"));
      const second = await h.say(id, "and again");
      assert.match(second.text, /^answer \d+$/);
      assert.deepEqual(toolsSent("brain-refuses-out"), [["filament_recall"], [], []], "the next turn: none offered, one call");
    } finally {
      h.script = null;
    }
  });
});
