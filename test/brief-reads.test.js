// @ts-check
// The Run pane's request lists, read once a moment (the chat-open audit of 10-29): the run's pulse drew the pane again a
// second or so apart while a turn ran, a turn of any chat's, and each draw read For developers' table and Calls' bars
// anew. One read on its way per path; its answer served again for a moment; a failure kept for nobody.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { briefReads } from "../src/ui/harness/lib/brief-reads.js";
import { stubDocument } from "./helpers/dom-stub.js";

const tick = () => new Promise((r) => setImmediate(r));

test("a path asked again while its read is on its way gets that read", async () => {
  /** @type {string[]} */
  const asked = [];
  const read = briefReads(async (p) => (asked.push(p), { p }), { now: () => 1000 });
  const [a, b] = await Promise.all([read("/x"), read("/x")]);
  assert.equal(a, b);
  assert.deepEqual(asked, ["/x"]);
  await read("/y");
  assert.deepEqual(asked, ["/x", "/y"], "another path is its own read");
});

test("an answer is served again for a moment, then read anew", async () => {
  let t = 1000;
  /** @type {string[]} */
  const asked = [];
  const read = briefReads(async (p) => (asked.push(p), { at: t }), { keepMs: 8000, now: () => t });
  await read("/x");
  await tick();
  t += 7999;
  await read("/x");
  assert.equal(asked.length, 1, "within the moment: the same answer");
  t += 1;
  const fresh = await read("/x");
  assert.equal(asked.length, 2, "past it: read again");
  assert.equal(fresh.at, t);
});

test("a failed read is kept for nobody", async () => {
  let fail = true;
  let n = 0;
  const read = briefReads(async () => {
    n++;
    if (fail) throw new Error("down");
    return { ok: true };
  });
  await assert.rejects(read("/x"));
  await tick();
  fail = false;
  assert.deepEqual(await read("/x"), { ok: true });
  assert.equal(n, 2);
});

/** @type {ReturnType<typeof stubDocument>} */
let dom;
const g = /** @type {any} */ (globalThis);
const fetchWas = g.fetch;
/** @type {string[]} */
const fetched = [];
before(() => {
  dom = stubDocument();
  g.fetch = async (/** @type {string} */ url) => {
    fetched.push(url);
    return { ok: true, status: 200, json: async () => ({ requests: [{ id: "q1", kind: "main", tokens: { input: 10, output: 2 } }] }) };
  };
});
after(() => {
  g.fetch = fetchWas;
  dom.restore();
});

// (fails before: yes — each draw of For developers read the chat's hundred records again)
test("For developers drawn again at the run's pulse reads the chat's records once", async () => {
  const { renderDevtools } = await import("../src/ui/harness/panes/devtools.js");
  const chat = { chainId: "s1" };
  for (let i = 0; i < 3; i++) {
    renderDevtools(/** @type {any} */ (document.createElement("div")), { chat });
    await tick();
  }
  assert.deepEqual(fetched.filter((u) => u.includes("/sessions/s1/requests")), ["/api/sessions/s1/requests?limit=100"]);
});
