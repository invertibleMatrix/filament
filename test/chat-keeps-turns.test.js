// @ts-check
// A Filament chat keeps its own turns whatever memory does in it: the archive is the chat's own record, which its
// model's history is composed from and its page reads after a reload. A muted chat's turns are kept with every reply,
// streamed or not; memory says nothing new into it. Turn capture off governs an outside client's turns: a Filament
// chat keeps its own under it, which memory's search, loads and learning read none of while it is off.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chainRefOf } from "../src/core/conversation.js";
import { houseAuth } from "../src/services/house.js";
import { featureWidget } from "../src/ui/harness/widgets/frame.js";
import { memoryWidget } from "../src/ui/harness/widgets/memory.js";
import { viewSettingsOf } from "../src/ui/harness/view-settings.js";
import { anthropicReply, anthropicStream, fakeUpstream, startApp } from "./helpers/app.js";
import { fakeH, fakeDrawIn, recordingPopover, textOf } from "./helpers/fake-dom.js";
import { removeDirs } from "./helpers/wait.js";

/** A message's words, whatever its shape. @param {any} m */
const wordsOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).map((/** @type {any} */ b) => b?.text || "").join(""));

/**
 * What the harness's Memory pill says of a chat, drawn from its settings as the page reads them: the pill, its
 * popover's words and the status under its head, and its tile's trail on Overview.
 * @param {any} shim @param {string} id
 */
async function pillOf(shim, id) {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`);
  assert.equal(r.status, 200, await r.clone().text());
  const settings = viewSettingsOf(await r.json());
  const ctx = /** @type {any} */ ({ view: () => ({ settings }), hasSession: () => true, memoryEngine: () => null, write: () => {}, command: () => {}, openPage: () => {}, toast: () => {}, memory: {} });
  const spec = memoryWidget(ctx, { h: fakeH, drawIn: fakeDrawIn });
  const { popover, pops } = recordingPopover();
  /** @type {any} */ (featureWidget(spec, { h: fakeH, drawIn: fakeDrawIn, popover }).el).dispatch("click");
  const text = textOf(pops[0].body);
  return { state: spec.state(), text, status: text.split("|")[1], trail: textOf(fakeH("div", {}, /** @type {any} */ (spec).tileTrail(fakeH))) };
}

/**
 * A running Filament with a fake model behind `brain-*` that answers "answer <n>", streamed where it is asked to stream,
 * and the helpers the tests share. `capture`: memory's capture settings; `loop`: the agent loop on; `autopilot`: memory's.
 * @param {{ capture?: any, loop?: boolean, autopilot?: boolean }} [o]
 */
function harness({ capture = { turns: true, learn: false }, loop = false, autopilot = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "filament-keeps-turns-"));
  const h = {
    root,
    /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
    up: /** @type {any} */ (null),
    /** @type {Awaited<ReturnType<typeof startApp>>} */
    shim: /** @type {any} */ (null),
    /** What each call to the model was sent, oldest first. @type {any[]} */
    bodies: [],
    n: 0,
    /** @param {any} [settings] */
    async chat(settings = undefined) {
      const r = await h.shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model", preset: "plain", ...(settings ? { settings } : {}) } });
      assert.equal(r.status, 200, await r.clone().text());
      return String((await r.json()).id);
    },
    /**
     * A turn; `text`: what came back, as the page reads it (a JSON reply's words, a stream's body whole).
     * @param {string} id @param {string} content @param {boolean} [stream]
     */
    async say(id, content, stream = false) {
      const r = await h.shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream } });
      assert.equal(r.status, 200, await r.clone().text());
      const raw = await r.text();
      return { rid: String(r.headers.get("x-filament-request-id")), text: stream ? raw : wordsOf(JSON.parse(raw)) };
    },
    /** The chat's transcript as its page reads it after a reload. @param {string} id @returns {Promise<any[]>} */
    async transcript(id) {
      return (await (await h.shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=0`)).json()).turns || [];
    },
    /** The newest request the model was sent, as role and words. */
    lastSent: () => (h.bodies.at(-1)?.messages || []).map((/** @type {any} */ m) => [m.role, wordsOf(m)]),
  };
  before(async () => {
    h.up = await fakeUpstream(async (call) => {
      h.bodies.push(call.body);
      const model = String(call.body?.model || "");
      return call.body?.stream ? anthropicStream(`answer ${++h.n}`, { model }) : anthropicReply(`answer ${++h.n}`, { model });
    });
    h.shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: h.up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: autopilot };
        cfg.memory.capture = capture;
        cfg.agentLoop = loop ? { enabled: true, permissions: "edit", roots: [root], readerModel: "" } : { ...cfg.agentLoop, enabled: false };
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

describe("a muted Filament chat keeps its turns, its streamed replies among them", () => {
  const h = harness();

  // (fails before: yes — the stream folded its reply for the archive only while memory was on for the request: a
  // muted chat's streamed turns opened and never finished, so its next request went with "second muted" alone, and
  // its page showed both turns unanswered)
  test("each streamed reply finishes its turn, and the next request carries it", async () => {
    const id = await h.chat({ memory: { enabled: false } });
    await h.say(id, "first muted", true);
    await h.say(id, "second muted", true);
    assert.deepEqual(h.lastSent(), [["user", "first muted"], ["assistant", "answer 1"], ["user", "second muted"]]);
    const turns = await h.transcript(id);
    assert.deepEqual(turns.map((/** @type {any} */ t) => [wordsOf(t.user), wordsOf(t.final)]), [["first muted", "answer 1"], ["second muted", "answer 2"]]);
  });
});

describe("with turn capture off, a Filament chat keeps its own turns, which memory reads for nothing else", () => {
  const h = harness({ capture: { turns: false, learn: true } });

  // (fails before: yes — turn capture off kept a Filament chat's turns out of the archive as it keeps an outside
  // client's: its second request went with "second about parsers" alone, and its page showed no turn; with its turns
  // kept and memory's reads as they were, memory's search quoted "first about the quokka parser")
  test("each turn goes with the chat's history and shows after a reload; memory's search and session list find none of its words, and nothing is learned from it", async () => {
    const id = await h.chat();
    await h.say(id, "first about the quokka parser");
    await h.say(id, "second about parsers");
    assert.deepEqual(h.lastSent(), [["user", "first about the quokka parser"], ["assistant", "answer 1"], ["user", "second about parsers"]]);
    assert.equal((await h.transcript(id)).length, 2);
    const memory = /** @type {any} */ (h.shim.app.memory);
    const port = memory.scope({ role: "model" });
    const found = await port.search("quokka parser");
    assert.deepEqual(found.filter((/** @type {any} */ it) => it.chainId === id || /quokka/.test(it.text)), []);
    assert.deepEqual(port.sessions("quokka").map((/** @type {any} */ s) => s.id), []);
    assert.equal(port.load(id, { view: "chat" }), null);
    const run = await memory.learner.learnChain(id, { reason: "manual", force: true });
    assert.equal(run.skipped, "turn capture is off in Memory settings: nothing is learned from this chat");
  });

  // (fails before: yes — memory kept the chat's turns to itself only while capture was off: once it was on again, its
  // search quoted "first about the osprey parser")
  test("its turns kept while capture was off stay apart once it is on again: memory's search, session list and learner read none of them", async () => {
    const id = await h.chat();
    await h.say(id, "first about the osprey parser");
    await h.say(id, "second about the osprey lexer");
    const st = await (await h.shim.api("/api/state")).json();
    const on = { ...st.config, memory: { ...st.config.memory, capture: { ...st.config.memory.capture, turns: true } } };
    assert.equal((await h.shim.api("/api/config", { method: "PUT", body: on })).status, 200);
    try {
      const memory = /** @type {any} */ (h.shim.app.memory);
      const port = memory.scope({ role: "model" });
      assert.deepEqual((await port.search("osprey parser")).filter((/** @type {any} */ it) => it.chainId === id || /osprey/.test(String(it.text))), []);
      assert.deepEqual(port.sessions("osprey").map((/** @type {any} */ s) => s.id), []);
      assert.equal(port.load(id, { view: "chat" }), null, "a chat every turn of which was kept apart is no other's to load");
      const run = await memory.learner.learnChain(id, { reason: "manual", force: true });
      assert.equal(run.skipped, "nothing new");
      assert.equal(memory.archive.getChain(id)?.meta?.learnedThrough, 2, "its cursor past them");
    } finally {
      assert.equal((await h.shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });

  // (fails before: yes — the Memory pill said "On · learning from this session" and its tile "on · learns from this
  // chat", though the learner skips the chat)
  test("the Memory pill says memory learns nothing from it, and why", async () => {
    const id = await h.chat();
    await h.say(id, "a turn the pill reads");
    const pill = await pillOf(h.shim, id);
    assert.deepEqual(
      [pill.status, pill.text.includes("|Turn capture is off in Memory settings: nothing is learned from this chat.|"), pill.trail],
      ["On · learning nothing from this session", true, "on · learns nothing from this chat"],
    );
  });
});

describe("the Memory pill on an outside client's chat says what memory does there", () => {
  const h = harness({ capture: { turns: true, learn: true } });

  // (fails before: yes — the settings' engine asked Memory settings of a harness chat alone: for a chat its client's
  // own requests made, the pill said "On · learning from this session" with turn capture off, and "0" with "On · …"
  // once its client was excluded)
  test("turn capture off: memory learns nothing from it, keeping none of its new turns; its client excluded: Left out, and why", async () => {
    const r = await h.shim.post("/v1/messages", { model: "brain-model", max_tokens: 20, messages: [{ role: "user", content: "an outside client's turn" }] }, { "user-agent": "claude-cli/2.0.0", "x-session-id": "outside-pill" });
    assert.equal(r.status, 200, await r.clone().text());
    await r.json();
    const id = String((await h.shim.record(String(r.headers.get("x-filament-request-id"))))?.memory?.chain || "");
    assert.ok(id, "memory keeps the chat of it");
    const st = await (await h.shim.api("/api/state")).json();
    /** @param {any} capture */
    const put = async (capture) => assert.equal((await h.shim.api("/api/config", { method: "PUT", body: { ...st.config, memory: { ...st.config.memory, capture: { ...st.config.memory.capture, ...capture } } } })).status, 200);
    try {
      await put({ turns: false });
      const off = await pillOf(h.shim, id);
      await put({ excludeClients: ["claude-code"] });
      const out = await pillOf(h.shim, id);
      assert.deepEqual(
        [off.status, off.text.includes("|Turn capture is off in Memory settings: none of its new turns is kept.|"), out.state, out.status],
        ["On · learning nothing from this session", true, "Left out", 'Left out · client "claude-code" is excluded in Memory settings'],
      );
    } finally {
      assert.equal((await h.shim.api("/api/config", { method: "PUT", body: st.config })).status, 200);
    }
  });
});

describe("with turn capture off and memory's autopilot on, memory captures nothing from a Filament chat's messages", () => {
  const h = harness({ capture: { turns: false, learn: true }, autopilot: true });

  // (fails before: yes — memory captured from such a chat's messages all the same: it filed "we deploy from the main
  // branch" and "Correction from the user: no, that's wrong: the api listens on port 4000, not 3000")
  test("memory captures nothing from its messages: no claim filed, no call of the cheap model", async () => {
    const id = await h.chat();
    const memory = /** @type {any} */ (h.shim.app.memory);
    /** @type {any[]} */
    const calls = [];
    const callModel = memory.callModel;
    memory.callModel = async (/** @type {any} */ a) => {
      calls.push(a);
      return "{}";
    };
    try {
      await h.say(id, "remember that we deploy from the main branch");
      await h.say(id, "no, that's wrong: the api listens on port 4000, not 3000");
      await h.say(id, "Nein, benutze nicht npm für dieses Projekt");
    } finally {
      memory.callModel = callModel;
    }
    assert.deepEqual(memory.archive.items.list({ chainId: id, limit: 50 }).map((/** @type {any} */ it) => it.text), [], "no claim filed from its words");
    assert.deepEqual(calls.filter((a) => a?.purpose === "signal").map((a) => a.user), [], "no call of the cheap model");
  });

});

/**
 * Memory fails the turns of the chat `id` before they open, `times` times: its situate (the brain's throws), a check of
 * memory's own in its prepare (the files' check, `anchorCheck`: no part of the archive), or the archive's write of the
 * turn (`beginTurn`, as a busy or broken file would). Everything else goes as it does.
 * @param {Awaited<ReturnType<typeof startApp>>} shim @param {"situate" | "check" | "write"} where @param {string} id
 * @param {number} [times]
 * @returns {{ back: () => void, broke: () => number }}  `back` puts it back; `broke`, how many times it failed
 */
function failing(shim, where, id, times = 1) {
  const memory = /** @type {any} */ (shim.app.memory);
  const [owner, name] = where === "situate" ? [memory.brain, "situate"] : where === "check" ? [memory.brain.anchorCheck, "run"] : [memory.archive, "beginTurn"];
  const real = owner[name];
  let n = 0;
  const back = () => {
    owner[name] = real;
  };
  /** @this {any} @param {any[]} a */
  owner[name] = function (...a) {
    const named = where === "situate" ? chainRefOf(a[0]?.headers) === id : where === "write" ? a[0] === id : true;
    if (!named || n >= times) return real.apply(this, a);
    n++;
    throw new Error(`the ${where} broke`);
  };
  return { back, broke: () => n };
}

describe("a Filament chat whose memory fails a request sends memory's tools and filament_recall as its other requests send them (t420)", () => {
  const h = harness({ autopilot: true });
  const names = (/** @type {any} */ b) => (b?.tools || []).map((/** @type {any} */ t) => String(t.name));

  // (fails before: yes — the review of 2d1f6d72e: a turn whose situate failed went with filament_recall first and memory's
  // tools after it, and a tick whose prepare failed before its turn opened went with no filament_recall, so the tools
  // section under the conversation changed as it did when memory's tools went missing)
  test("a turn whose situate fails, and a loop's tick whose prepare fails before its turn opens, send the tools in the order every request of the chat sends them", async () => {
    const id = await h.chat();
    const first = await h.say(id, "first about lexers");
    const asRead = names(h.bodies.at(-1));
    assert.ok(asRead.includes("filament_recall") && asRead.some((n) => n.startsWith("filament_memory_")), asRead.join(", "));
    const trap = failing(h.shim, "situate", id);
    try {
      await h.say(id, "second, its situate failing");
    } finally {
      trap.back();
    }
    assert.equal(trap.broke(), 1, "its situate failed");
    assert.deepEqual(names(h.bodies.at(-1)), asRead, "a turn whose situate failed");
    // A tick of its loop: Filament's own call on the chat, quiet but for the tools, naming the turn it runs for.
    const tick = () =>
      fetch(`${h.shim.url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...houseAuth(), "x-filament-memory": "tools", "x-filament-chain": id, "x-filament-agent-of": first.rid },
        body: JSON.stringify({ model: "brain-model", max_tokens: 64, messages: [{ role: "user", content: "a tick" }] }),
      });
    const r1 = await tick();
    assert.equal(r1.status, 200, await r1.text());
    const tickRead = names(h.bodies.at(-1));
    assert.ok(tickRead.includes("filament_recall") && tickRead.some((n) => n.startsWith("filament_memory_")), tickRead.join(", "));
    const check = failing(h.shim, "check", id);
    try {
      const r2 = await tick();
      assert.equal(r2.status, 200, await r2.text());
    } finally {
      check.back();
    }
    assert.equal(check.broke(), 1, "its prepare failed");
    assert.deepEqual(names(h.bodies.at(-1)), tickRead, "a tick whose prepare failed before its turn opened");
  });
});

describe("a Filament chat whose memory fails a turn keeps it where the archive can write it, and memory does nothing else for it", () => {
  const h = harness();

  /**
   * Three turns, the second's memory failing as `where` says, `times` times: what the third went with, the transcript,
   * and the second's record and reply.
   * @param {"situate" | "check" | "write"} where @param {number} [times] @param {string} [second]
   */
  const threeTurns = async (where, times = 1, second = `second, its ${where} failing`) => {
    const id = await h.chat();
    const n0 = h.n;
    await h.say(id, "first about lexers");
    const trap = failing(h.shim, where, id, times);
    let said;
    try {
      said = await h.say(id, second);
    } finally {
      trap.back();
    }
    assert.ok(trap.broke() >= 1, `its ${where} failed`);
    await h.say(id, "third");
    return { id, n0, said, rec: await h.shim.record(said.rid), sent: h.lastSent(), turns: await h.transcript(id) };
  };

  // (fails before: yes — a session turn whose situate failed was situated nowhere, so memory kept no turn of it: the
  // third request went without the second's exchange, and the page showed two turns)
  test("a turn whose situate failed is kept: the next request carries it, and the page shows it after a reload", async () => {
    const t = await threeTurns("situate");
    const second = "second, its situate failing";
    assert.deepEqual(t.sent, [["user", "first about lexers"], ["assistant", `answer ${t.n0 + 1}`], ["user", second], ["assistant", `answer ${t.n0 + 2}`], ["user", "third"]]);
    assert.deepEqual(t.turns.map((/** @type {any} */ x) => wordsOf(x.user)), ["first about lexers", second, "third"]);
    assert.ok((t.rec.priorChanges || []).some((/** @type {string} */ c) => c.startsWith("memory: skipped (the situate broke) — the chat keeps the turn, and memory adds nothing to it")), (t.rec.priorChanges || []).join("\n"));
  });

  // (fails before: yes — a prepare that failed before it opened the turn ran it without memory and kept no row of it,
  // though the archive could write one: the third request went without the second's exchange)
  test("a turn whose prepare failed before it opened, the archive still writing, is kept: memory's own check failing, or the archive's write failing once", async () => {
    for (const where of /** @type {const} */ (["check", "write"])) {
      const t = await threeTurns(where);
      const second = `second, its ${where} failing`;
      assert.deepEqual(t.sent, [["user", "first about lexers"], ["assistant", `answer ${t.n0 + 1}`], ["user", second], ["assistant", `answer ${t.n0 + 2}`], ["user", "third"]], where);
      assert.equal(t.turns.length, 3, where);
      assert.ok((t.rec.priorChanges || []).some((/** @type {string} */ c) => c.startsWith(`memory: skipped (the ${where} broke) — the chat keeps the turn, and memory adds nothing to it`)), (t.rec.priorChanges || []).join("\n"));
    }
  });

  // (fails before: yes — the record said "memory: skipped (the write broke)" alone, never that the turn is not kept; the
  // turn itself was lost then too, as it is now: the archive is what failed)
  test("a turn the archive cannot write is kept nowhere: the next request goes without it, and its record says why", async () => {
    const t = await threeTurns("write", 2, "second, the archive refusing it");
    assert.deepEqual(t.sent, [["user", "first about lexers"], ["assistant", `answer ${t.n0 + 1}`], ["user", "third"]]);
    assert.equal(t.turns.length, 2);
    assert.ok((t.rec.priorChanges || []).includes("memory: skipped (the write broke); the turn is not kept: the archive could not write it (the write broke)"), (t.rec.priorChanges || []).join("\n"));
  });

  // (fails before: yes — `@mem` in a turn whose situate failed was no command there: the model answered it, "answer 10")
  test("`@mem …` in a turn whose situate failed is Filament's: it says memory could not read the chat for this message, on the chat's command turn, nothing reaching the model", async () => {
    const id = await h.chat();
    const before = h.bodies.length;
    const trap = failing(h.shim, "situate", id);
    let said;
    try {
      said = await h.say(id, "@mem status");
    } finally {
      trap.back();
    }
    assert.equal(said.text, "Memory could not read this chat for this message, and `@mem` is memory's: `@mem status` shows, keeps and changes nothing — send it again.");
    assert.equal(h.bodies.length, before, "nothing reached the model");
    assert.deepEqual((await h.transcript(id)).map((/** @type {any} */ t) => [t.command, wordsOf(t.user)]), [[true, "@mem status"]]);
  });
});