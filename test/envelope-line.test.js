// @ts-check
// The envelopes' line over the box (the owner's of 11-02: "when an agent receives an envelope it should also show some
// indicator that an unread envelope is there and as soon as an agent opens it then this indicator should simply
// disappear"): how many results wait sealed for the chat's agent and whose the oldest is, gone as it opens them.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";

const g = /** @type {any} */ (globalThis);
const ADDED = ["EventSource", "addEventListener", "requestAnimationFrame", "cancelAnimationFrame"].filter((k) => !(k in g));
const had = { fetch: g.fetch };
/** The feed's stream, as the page opened it. @type {any} */
let feed = null;
/** The list reads asked, each answered when the test says. @type {{ path: string, answer: (body: any) => void }[]} */
const reads = [];
/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {typeof import("../src/ui/harness/conversation/envelope-line.js")} */
let line;
/** @type {typeof import("../src/ui/harness/lib/subagents.js")} */
let store;
before(async () => {
  dom = stubDocument();
  g.EventSource = class {
    constructor() {
      /** @type {((e: { data: string }) => void) | null} */
      this.onmessage = null;
      feed = this;
    }
    close() {}
  };
  g.addEventListener ||= () => {};
  g.requestAnimationFrame = (/** @type {() => void} */ fn) => setTimeout(fn, 0);
  g.cancelAnimationFrame = () => {};
  g.fetch = (/** @type {string} */ path) =>
    new Promise((resolve) => reads.push({ path, answer: (body) => resolve({ ok: true, status: 200, json: async () => body }) }));
  line = await import("../src/ui/harness/conversation/envelope-line.js");
  store = await import("../src/ui/harness/lib/subagents.js");
});
after(() => {
  dom.restore();
  for (const k of ADDED) delete g[k];
  g.fetch = had.fetch;
});

const SCOUT = { n: 3, from: "sa_1", description: "Map the slowness fixes", sender: 'your background sub-agent sa_1 ("Map the slowness fixes")', subject: "Six causes mapped" };
const HUNTER = { n: 4, from: "sa_2", description: "", sender: "Hunter, a saved agent you asked", subject: "two bugs" };
/** Let the answers' promises and the frames settle. */
const settle = () => new Promise((r) => setTimeout(r, 5));

// (fails before: yes — there was no line: no conversation/envelope-line.js)
test("what the line says: how many wait unopened for your agent and whose the oldest is, each one's sender and subject on hover; nothing with none", () => {
  const { envelopeLineOf } = line;
  assert.equal(envelopeLineOf([]), null);
  assert.deepEqual(envelopeLineOf([SCOUT]), {
    words: "An envelope waits unopened for your agent, from “Map the slowness fixes”",
    title: 'Envelope 3, from your background sub-agent sa_1 ("Map the slowness fixes"): Six causes mapped',
  });
  const two = /** @type {any} */ (envelopeLineOf([HUNTER, SCOUT]));
  assert.equal(two.words, "2 envelopes wait unopened for your agent, the oldest from Hunter, a saved agent you asked");
  assert.equal(two.title.split("\n").length, 2);
});

test("the line drawn: hidden with none, its words and hover as they wait, hidden again once opened", () => {
  const l = line.createEnvelopeLine();
  const el = /** @type {any} */ (l.el);
  assert.ok(el.classList.contains("hidden"), "nothing painted yet");
  l.paint(line.envelopeLineOf([SCOUT]));
  assert.ok(!el.classList.contains("hidden"));
  assert.equal(el.getAttribute("role"), "status");
  assert.equal(el.querySelector(".envelope-line-words").textContent, "An envelope waits unopened for your agent, from “Map the slowness fixes”");
  assert.match(el.getAttribute("title"), /^Envelope 3, from /);
  l.paint(line.envelopeLineOf([]));
  assert.ok(el.classList.contains("hidden"));
});

// (fails before: yes — the store kept the sealed envelopes' numbers alone)
test("the store keeps the session's sealed envelopes whole, oldest first, and says them again as one is sealed and as it is opened", async () => {
  const s = store.createSubagentStore();
  let heard = 0;
  s.onChange(() => heard++);
  s.setChain("c1");
  assert.deepEqual(s.envelopes(), [], "none until the list answers");
  const first = reads.shift();
  assert.match(String(first?.path), /\/sessions\/c1\/subagents\?heads=1$/);
  first?.answer({ subagents: [], envelopes: [SCOUT, { n: 0, from: "x" }] });
  await settle();
  assert.deepEqual(s.envelopes(), [SCOUT], "whole, the malformed one left out");
  assert.equal(s.sealed(3), true);
  // Its agent opens it: Filament says the sealed list moved, and the store reads it again.
  const before = heard;
  feed.onmessage({ data: JSON.stringify({ type: "subagent-envelopes", chainId: "c1" }) });
  for (let i = 0; i < 50 && !reads.length; i++) await new Promise((r) => setTimeout(r, 10));
  reads.shift()?.answer({ subagents: [], envelopes: [] });
  await settle();
  assert.deepEqual(s.envelopes(), []);
  assert.equal(s.sealed(3), false);
  assert.ok(heard > before, "its listeners hear it");
  s.setChain(null);
});

test("the page wires it: over the box, painted from the shown chat's list as it moves", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.match(app, /const envelopeLine = createEnvelopeLine\(\);\ncomposer\.asks\.append\(envelopeLine\.el\);\nsubagentStore\.onChange\(\(\) => envelopeLine\.paint\(envelopeLineOf\(subagentStore\.envelopes\(\)\)\)\);/);
});
