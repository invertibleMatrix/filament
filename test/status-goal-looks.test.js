// @ts-check
// HarnessV3-Responsiveness, found on the test drive (2026-10-01): every run event repaints the harness's status panel,
// and each repaint looked the session's goal up again — GET /api/sessions/:id per event, fourteen for a one-second
// turn and hundreds for a long one, each a session read and a request on the page's six connections to Filament. The
// look now goes out once a moment, and afresh at each turn's end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apiShared } from "../src/ui/harness/lib/api.js";

const src = readFileSync("src/ui/harness/app.js", "utf8");

/**
 * The page's loadGoal, lifted out and run against a stub api, through the page's own shared read (HarnessV4_Tasks
 * C8: the goal's look and the Plan view as it opens share one read of the session).
 */
function goalLoader() {
  const start = src.indexOf("async function loadGoal(chat) {");
  assert.ok(start > 0, "found loadGoal");
  const body = src.slice(start, src.indexOf("\n}\n", start) + 2);
  /** @type {string[]} */
  const calls = [];
  // The goal's own read (`GET /sessions/:id/goal`): the goal in force and whether the session is pinned.
  const api = async (/** @type {string} */ path) => {
    calls.push(path);
    return { goal: { status: "active", text: "ship it", drive: { round: 3, cap: 20, halted: null, words: "Driving · round 3 of 20" } }, pinned: true };
  };
  /** @type {any[]} */
  const paints = [];
  const shared = (/** @type {string} */ path) => apiShared(path, { read: api });
  const load = new Function("apiShared", "state", "paintStatus", `${body}\nreturn loadGoal;`)(shared, { currentId: "c1" }, (/** @type {any} */ c) => paints.push(c));
  return { load, calls, paints };
}

// (fails before: ten events, ten looks; and, the chat-open audit of 10-29, the look read the session's whole row)
test("a burst of repaints looks the goal up once, through the goal's own read", async () => {
  const { load, calls, paints } = goalLoader();
  const chat = { id: "c1", chainId: "76abc" };
  await Promise.all(Array.from({ length: 10 }, () => load(chat)));
  assert.deepEqual(calls, ["/sessions/76abc/goal"]);
  assert.equal(paints.length, 1);
  assert.deepEqual(/** @type {any} */ (chat).goal, { status: "active", text: "ship it", drive: { words: "Driving · round 3 of 20", halted: false } }, "its drive, never what it spent (the owner's of 11-05)");
  assert.equal(/** @type {any} */ (chat).pinned, true, "pinned, from the same read");
});

test("a moment later, or once the turn's end clears the mark, it looks again", async () => {
  const { load, calls } = goalLoader();
  /** @type {any} */
  const chat = { id: "c1", chainId: "76abc" };
  await load(chat);
  chat.goalAt = Date.now() - 6000;
  await load(chat);
  assert.equal(calls.length, 2, "five seconds on: a fresh look");
  chat.goalAt = 0;
  await load(chat);
  assert.equal(calls.length, 3, "the turn's end: a fresh look");
});

test("the send's end clears the mark right before the panel's refresh", () => {
  assert.match(src, /\n {2}chat\.goalAt = 0;[^\n]*\n {2}refreshStatus\(chat\);/);
});
