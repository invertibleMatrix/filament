// @ts-check
// A long tool result read whole as its card opens (the owner's of 11-15: "fold the tool calls such that long text is not
// held in memory, and clicking that tool call may simply ask for wait until that part is loaded from disk"): a chat's
// transcript carries the head of each result alone, and the card of an archived call reads the rest from the turn's
// record as it opens, and lets it go as it closes. The text as the transcript reads it, the route over a real archive,
// and the card on the page.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolsOfTurn, resultsOf, RESULT_PREVIEW_CHARS } from "../src/core/tool-vocab.js";
import { archivedRows } from "../src/ui/harness/conversation/tools/render.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { removeDirs } from "./helpers/wait.js";

/** A 50 KB log, each line its own, so a cut shows where it fell. */
const BIG = Array.from({ length: 1000 }, (_, i) => `line ${String(i).padStart(5, "0")} ${"x".repeat(38)}`).join("\n");
/** @param {string} text */
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
/** @param {string} id @param {string} command */
const ran = (id, command) => ({ role: "assistant", content: [{ type: "tool_use", id, name: "bash", input: { command } }] });
/** @param {string} id @param {any} content */
const told = (id, content) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] });
/** @param {string} text */
const said = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

describe("a result as the transcript reads it, and whole", () => {
  // (fails before: yes — no reader gave a result's whole text apart from the transcript's cut one)
  test("the transcript's preview is the head of the whole text, read the same way; a picture is no part of either", () => {
    const work = [ran("big1", "cat big.log"), told("big1", [{ type: "text", text: BIG }, { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }])];
    const [card] = toolsOfTurn(work, "anthropic");
    assert.deepEqual([card.result?.length, card.resultChars], [RESULT_PREVIEW_CHARS, BIG.length]);
    const [whole] = resultsOf(work[1], "anthropic");
    assert.deepEqual([whole.id, whole.text === BIG, whole.isError], ["big1", true, false]);
    assert.equal(card.result, whole.text.slice(0, RESULT_PREVIEW_CHARS));
    assert.deepEqual(resultsOf({ role: "tool", tool_call_id: "c9", content: "out" }, "openai"), [{ id: "c9", text: "out", isError: false }]);
    assert.deepEqual(resultsOf(work[0], "anthropic"), [], "a call is no result");
  });
});

describe("the route: a call's result whole, from the turn's record", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {string} */ let sid;
  /** @type {any} */ let archive;
  /** @type {number} */ let running;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-call-result-"));
    up = await fakeUpstream(() => anthropicReply("A title", { model: "m-1" }));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
        // The archive keeps a message whole up to 1 MiB by default, past which it keeps a marker and no result: room
        // here for one longer than a card is ever sent.
        cfg.memory.capture = { ...cfg.memory.capture, messageCapBytes: 4_000_000 };
      },
    });
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    sid = String((await made.json()).id);
    archive = shim.app.memory.archive;
    // An ended turn that read a 50 KB log and a longer one than a card is ever sent…
    const one = archive.beginTurn(sid, { requestId: "r-1", model: "m-1", upstream: "m", client: "harness", window: "harness", userMessage: user("read the logs") });
    archive.addWork(one.turnId, [ran("big1", "cat big.log"), told("big1", BIG), ran("huge1", "cat huge.log"), told("huge1", "y".repeat(2_000_005)), ran("functions.read:0", "cat big.log"), told("functions.read:0", BIG)]);
    archive.finishTurn(one.turnId, { finalMessage: said("Read them.") });
    // …and one still running, its call made and its result not written yet.
    running = archive.beginTurn(sid, { requestId: "r-2", model: "m-1", upstream: "m", client: "harness", window: "harness", running: true, userMessage: user("read it again") }).turnId;
    archive.addWork(running, [ran("run1", "cat big.log")]);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(root);
  });
  const result = async (/** @type {string} */ call, n = 1) => {
    const r = await shim.api(`/api/sessions/${sid}/turns/${n}/calls/${call}/result`);
    return { status: r.status, json: await r.json() };
  };

  // (fails before: yes — the route did not exist: the rest of a long result could not be read)
  test("the transcript carries 2,000 characters of a 50 KB result; the route answers it whole", async () => {
    const tr = await (await shim.api(`/api/sessions/${sid}/transcript`)).json();
    const card = tr.turns.find((/** @type {any} */ t) => t.n === 1).tools.find((/** @type {any} */ c) => c.id === "big1");
    assert.deepEqual([card.result.length, card.resultChars, card.result === BIG.slice(0, 2000)], [2000, BIG.length, true]);
    const r = await result("big1");
    assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
    assert.deepEqual({ ...r.json, result: r.json.result === BIG }, { n: 1, id: "big1", result: true, chars: BIG.length, cut: false });
    assert.deepEqual(await result("big1"), r, "read again, from where the turn's record holds it");
  });

  // (fails before: yes)
  test("past 2,000,000 characters the answer is cut and says so, with the whole length", async () => {
    const r = await result("huge1");
    assert.deepEqual([r.status, r.json.result.length, r.json.chars, r.json.cut], [200, 2_000_000, 2_000_005, true]);
  });

  // (fails before: yes)
  test("a running turn's call whose result is not written yet: 404, why later; once written, whole", async () => {
    const later = await result("run1", 2);
    assert.deepEqual([later.status, later.json.why, later.json.error], [404, "later", "the turn's record does not hold this call's result"]);
    archive.addWork(running, [told("run1", BIG)]);
    const now = await result("run1", 2);
    assert.deepEqual([now.status, now.json.result === BIG, now.json.chars], [200, true, BIG.length]);
  });

  // The review of 11-16 (Fable 5.2): the router hands params over as sent, and the page sends a call's id encoded.
  // (fails before: yes — `functions.read%3A0` matched no call: 404, "absent")
  test("a call whose id holds a ':', as a Kimi call's does, is found by its id as the page sends it", async () => {
    const r = await result(encodeURIComponent("functions.read:0"));
    assert.deepEqual([r.status, r.json.id, r.json.result === BIG], [200, "functions.read:0", true]);
  });

  // (fails before: yes)
  test("a call an ended turn does not hold, and a turn the chat does not have: 404 in words", async () => {
    const none = await result("nope");
    assert.deepEqual([none.status, none.json.why], [404, "absent"]);
    const turn = await result("big1", 9);
    assert.deepEqual([turn.status, turn.json.error], [404, "no such turn"]);
    const gone = await shim.api(`/api/sessions/nope/turns/1/calls/big1/result`);
    assert.equal(gone.status, 404);
  });
});

describe("the card on the page", () => {
  /** @type {ReturnType<typeof stubDocument>} */ let doc;
  /** @type {any} */ let real;
  before(() => {
    doc = stubDocument();
    real = globalThis.fetch;
  });
  after(() => {
    globalThis.fetch = real;
    doc.restore();
  });
  /** The transcript's cards of a turn that read the 50 KB log. */
  const tools = () => toolsOfTurn([ran("big1", "cat big.log"), told("big1", BIG)], "anthropic");
  /** An archived turn's card, drawn as the timeline draws one. @param {any[]} list */
  const card = async (list) => {
    const [row] = /** @type {any[]} */ (archivedRows(list, { key: "t1", turnAt: { chain: "c1", n: 1 } }));
    assert.equal(row.tagName, "DETAILS");
    doc.document.body.append(row);
    return row;
  };
  /** A fetch that answers the route with `answer` once `gate` opens, and keeps what was asked.
   *  @param {() => any} answer @param {Promise<void>} [gate] */
  const serve = (answer, gate = Promise.resolve()) => {
    /** @type {string[]} */
    const asked = [];
    globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url) => {
      asked.push(String(url));
      await gate;
      const r = answer();
      return { ok: r.ok, status: r.status ?? 200, json: async () => r.json };
    });
    return asked;
  };
  /** @param {any} row @param {boolean} open */
  const toggle = (row, open) => {
    row.open = open;
    row.dispatch("toggle");
  };
  const shown = (/** @type {any} */ row) => row.querySelector("[data-result]")?.textContent;

  // (fails before: yes — an opened card showed the head of its result alone, "Preview of 50,000 characters", and no
  // way to the rest)
  test("opened, the preview at once with a line that says the whole is read, then the whole; closed, the preview again", async () => {
    /** @type {() => void} */
    let release = () => {};
    const asked = serve(() => ({ ok: true, json: { n: 1, id: "big1", result: BIG, chars: BIG.length, cut: false } }), new Promise((r) => (release = () => r(undefined))));
    const row = await card(tools());
    assert.equal(shown(row), BIG.slice(0, 2000));
    toggle(row, true);
    assert.deepEqual(asked, ["/api/sessions/c1/turns/1/calls/big1/result"]);
    assert.equal(shown(row), BIG.slice(0, 2000), "the preview at once");
    assert.equal(row.querySelector(".tk-wait")?.textContent, "Reading the whole result…");
    assert.ok(row.querySelector(".tk-wait .tk-spin"), "with its spinner");
    release();
    await settle();
    assert.equal(shown(row), BIG, "the whole in the preview's place");
    assert.equal(row.querySelector(".tk-wait"), null);
    toggle(row, false);
    assert.equal(shown(row), BIG.slice(0, 2000), "closed: the preview again");
    assert.ok(!row.textContent.includes(BIG.slice(2000, 2100)), "and nothing of the rest is held by the card");
    toggle(row, true);
    await settle();
    assert.equal(asked.length, 2, "opened again, read again");
    assert.equal(shown(row), BIG);
    toggle(row, false);
  });

  // (fails before: yes)
  test("closed before the read lands: the whole never lands; a result sent whole asks nothing", async () => {
    /** @type {() => void} */
    let release = () => {};
    serve(() => ({ ok: true, json: { n: 1, id: "big1", result: BIG, chars: BIG.length, cut: false } }), new Promise((r) => (release = () => r(undefined))));
    const row = await card(tools());
    toggle(row, true);
    toggle(row, false);
    assert.equal(row.querySelector(".tk-wait"), null, "its line goes as it closes");
    release();
    await settle();
    assert.equal(shown(row), BIG.slice(0, 2000));
    const asked = serve(() => ({ ok: true, json: {} }));
    const short = await card(toolsOfTurn([ran("s1", "echo hi"), told("s1", "hi")], "anthropic"));
    toggle(short, true);
    await settle();
    assert.deepEqual(asked, [], "a whole result is never asked again");
  });

  // (fails before: yes)
  test("a turn whose record does not hold the result yet, or a read that fails: the preview stays and a line says so", async () => {
    serve(() => ({ ok: false, status: 404, json: { error: "the turn's record does not hold this call's result", why: "later" } }));
    const row = await card(tools());
    toggle(row, true);
    await settle();
    assert.equal(shown(row), BIG.slice(0, 2000));
    assert.ok(row.textContent.includes("The rest is not in the turn's record yet: it shows once the turn has written it."), row.textContent.slice(-300));
    toggle(row, false);
    globalThis.fetch = /** @type {any} */ (async () => {
      throw new Error("Failed to fetch");
    });
    toggle(row, true);
    await settle();
    assert.equal(shown(row), BIG.slice(0, 2000));
    assert.ok(row.textContent.includes("The whole result could not be read: Failed to fetch."), row.textContent.slice(-300));
    assert.ok(!row.textContent.includes("not in the turn's record yet"), "the last open's line alone");
  });
});
