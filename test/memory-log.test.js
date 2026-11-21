// @ts-check
// The server's census of its own memory (the owner's of 11-17: its floor climbed to 1.9 GB and nothing in the installed
// app could say what held it): Node's figures, what the run store holds, and the sub-agent registry's conversations,
// counted from their blocks' lengths without serialising them, posted to the desktop app over its port each minute —
// nothing where there is no port, an error posted as one, and the timer holding no process open.
// (fails before: yes — the server said nothing of its memory)
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { CENSUS_EVERY_MS, censusOf, convoChars, postCensus, registryCensus } from "../src/services/memory-log.js";
import { startApp } from "./helpers/app.js";

describe("the server's memory census", () => {
  test("a conversation's characters: words, thinking, a call's input strings, results and pictures, never serialised", () => {
    const big = "x".repeat(50_000);
    const convo = [
      { role: "user", content: "brief of 20 chars...".slice(0, 20) },
      { role: "assistant", content: [{ type: "thinking", thinking: "abc" }, { type: "text", text: "hello" }, { type: "tool_use", id: "t1", name: "Write", input: { file_path: "a.txt", content: big, opts: { mode: "w" } } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "done" }, { type: "image", source: { type: "base64", data: "QUJD" } }] }, { type: "tool_result", tool_use_id: "t2", content: "plain" }] },
    ];
    assert.equal(convoChars(convo), 20 + 3 + 5 + (5 + 50_000 + 1) + 4 + 4 + 5);
    assert.equal(convoChars(null), 0);
    assert.equal(convoChars([{ role: "user" }, null, { content: [null, 7] }]), 0);
    const before = JSON.stringify;
    let serialised = 0;
    JSON.stringify = /** @type {any} */ ((/** @type {any[]} */ ...a) => (serialised++, before.apply(JSON, /** @type {any} */ (a))));
    try {
      convoChars(convo);
    } finally {
      JSON.stringify = before;
    }
    assert.equal(serialised, 0);
  });

  // (fails before: yes — the review of step 1: a document's data and an edit list's texts were not counted)
  test("a document's data and an input's strings four levels down count too; data that is no string counts its bytes", () => {
    const convo = [
      { role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "P".repeat(900) } }] },
      { role: "assistant", content: [{ type: "tool_use", id: "e", name: "MultiEdit", input: { file_path: "f.js", edits: [{ old_string: "aaaa", new_string: "bbbbbb" }] } }] },
      { role: "user", content: [{ type: "image", source: { type: "base64", data: new Uint8Array(64) } }] },
    ];
    assert.equal(convoChars(convo), 900 + 4 + 4 + 6 + 64);
  });

  // (fails before: yes — the review of step 1: the registry's count was untested and missed a running follow-up's kept conversation)
  test("the registry's census: a kept conversation counted once by its array, a new one counted anew, a live one read each time", () => {
    /** @type {WeakMap<object, number>} */
    const cache = new WeakMap();
    const text = (/** @type {string} */ s) => [{ role: "user", content: s }];
    const keptOne = text("12345");
    const live = text("abc");
    const followUp = { status: "running", convo: text("kept!!"), run: { convo: live } };
    const loopOwn = text("same array");
    const entries = [{ status: "done", convo: keptOne }, followUp, { status: "running", convo: loopOwn, run: { convo: loopOwn } }, { status: "failed" }];
    assert.deepEqual(registryCensus(entries, cache), { kept: 2, keptChars: 5 + 6, running: 2, runningChars: 3 + 10 });
    keptOne.push({ role: "assistant", content: "not read again" });
    /** @type {any} */ (live[0]).content = "abcdefg";
    /** @type {any} */ (loopOwn[0]).content = "the same array grew";
    assert.deepEqual(registryCensus(entries, cache), { kept: 2, keptChars: 5 + 6, running: 2, runningChars: 7 + 19 }, "a kept array is read once; the live ones each time");
    /** @type {any} */ (entries[0]).convo = text("1234567");
    assert.equal(registryCensus(entries, cache).keptChars, 7 + 6, "an exchange's new conversation is counted anew");
  });

  test("the census: Node's figures in MB, the run store's and the registry's in millions of characters; a part that throws says so", () => {
    const c = /** @type {any} */ (censusOf({ runs: { memory: () => ({ runs: 3, events: 1200, chars: 4_250_000, asSent: 2, indexes: 1 }) }, subagents: { census: () => ({ kept: 12, keptChars: 135_400_000, running: 2, runningChars: 9_000_000 }) } }));
    for (const k of ["rssMB", "heapUsedMB", "heapTotalMB", "heapLimitMB", "externalMB", "arrayBuffersMB"]) assert.ok(Number.isInteger(c[k]) && c[k] >= 0, k);
    assert.deepEqual(c.runs, { runs: 3, events: 1200, charsM: 4.3, asSent: 2, indexes: 1 });
    assert.deepEqual(c.subagents, { kept: 12, keptCharsM: 135.4, running: 2, runningCharsM: 9 });
    const broken = /** @type {any} */ (censusOf({ runs: { memory: () => { throw new Error("ring"); } }, subagents: { census: () => { throw new Error("reg"); } } }));
    assert.deepEqual([broken.runs, broken.subagents], ["unread: ring", "unread: reg"]);
    assert.ok(broken.heapUsedMB >= 0, "the rest stands");
  });

  test("posted at once and each minute over the port, on a timer that holds no process open; none without a port", () => {
    /** @type {any[]} */
    const posted = [];
    const timer = { fn: () => {}, ms: 0, unref: false };
    let cleared = false;
    let n = 0;
    const stop = postCensus({ postMessage: (m) => posted.push(m) }, () => ({ n: ++n }), {
      setInterval: (fn, ms) => (Object.assign(timer, { fn, ms }), { unref: () => void (timer.unref = true) }),
      clearInterval: () => void (cleared = true),
    });
    assert.deepEqual(posted, [{ census: { n: 1 } }]);
    assert.equal(timer.ms, CENSUS_EVERY_MS);
    assert.equal(timer.unref, true);
    timer.fn();
    assert.deepEqual(posted[1], { census: { n: 2 } });
    stop();
    assert.equal(cleared, true);
    /** @type {any[]} */
    const failing = [];
    postCensus({ postMessage: (m) => failing.push(m) }, () => { throw new Error("boom"); }, { setInterval: () => ({}), clearInterval: () => {} });
    assert.deepEqual(failing, [{ census: { error: "the census could not be read: boom" } }]);
    assert.doesNotThrow(() => postCensus(undefined, () => ({}))());
    assert.doesNotThrow(() => postCensus({ postMessage: () => { throw new Error("port closed"); } }, () => ({}), { setInterval: () => ({}), clearInterval: () => {} }));
  });
});

describe("the registry's census on a real server", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  after(async () => shim?.stop());
  test("the registry's census and the run store's figures are read on a real server: an empty registry counts nothing", async () => {
    shim = await startApp({});
    const app = /** @type {any} */ (shim.app);
    assert.deepEqual(app.subagents.census(), { kept: 0, keptChars: 0, running: 0, runningChars: 0 });
    const c = /** @type {any} */ (censusOf({ runs: app.runs, subagents: app.subagents }));
    assert.deepEqual(c.subagents, { kept: 0, keptCharsM: 0, running: 0, runningCharsM: 0 });
    assert.ok(c.runs && typeof c.runs === "object", "the run store's figures are read");
  });
});
