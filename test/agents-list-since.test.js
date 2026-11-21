// @ts-check
// The Agents list sent as the rows that moved (the slowness of 11-02): the owner's largest chat's list was 1.1 MB, 65
// agents, read again every few seconds while one ran — by the Agents tab, by Now and by the Teams board — though one or
// two rows moved between reads. The route gives each answer a version; a read that names the version it holds
// (`?since=`) is sent every row's id in order and the rows that moved since, one that names a version not kept every
// row. The page keeps each chat's list whole and draws the same rows; an answer that moved from another version than
// the one it holds — another read landed between — is asked again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listVersions } from "../src/core/list-since.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";
import { readAgents, READ_MOST_MS } from "../src/ui/harness/lib/agents-since.js";

/** @param {string} id @param {string} status @param {number} [round] */
const row = (id, status, round = 0) => ({ id, status, description: `task ${id}`, progress: { round }, exchanges: [{ prompt: "x".repeat(2000), report: "y".repeat(4000) }] });

test("versions: every row at first and for a version not kept; the rows that moved since one kept, every id in order", () => {
  const v = listVersions({ states: 2 });
  const first = v.take("c1", [row("a", "running"), row("b", "done"), row("c", "done")]);
  assert.equal(first.ids, undefined);
  assert.equal(first.rows.length, 3);
  const same = v.take("c1", [row("a", "running"), row("b", "done"), row("c", "done")], first.version);
  assert.equal(same.version, first.version, "nothing moved: the same version");
  assert.deepEqual([same.ids, same.rows], [["a", "b", "c"], []]);
  const moved = v.take("c1", [row("d", "running"), row("a", "running", 1), row("b", "done")], first.version);
  assert.notEqual(moved.version, first.version);
  assert.deepEqual(moved.ids, ["d", "a", "b"], "c gone, d new");
  assert.deepEqual(moved.rows.map((r) => r.id), ["d", "a"]);
  assert.equal(v.take("c1", [row("d", "running")], "elsewhere.1").ids, undefined, "another process's version: every row");
  v.take("c1", [row("d", "done")]);
  v.take("c1", [row("d", "failed")]);
  assert.equal(v.take("c1", [row("d", "failed")], first.version).ids, undefined, "a version long gone: every row");
  assert.equal(v.take("c2", [row("a", "running")], moved.version).ids, undefined, "another chat's version: every row");
});

/** The list route over a registry the test moves. @param {() => any[]} rows */
const route = (rows) => {
  const subagents = { list: rows, settleWaiting: () => {}, seatsNow: () => ({ limit: null, most: null, nextSeat: null }), queued: () => 0, envelopes: () => [], cacheOf: () => ({ state: "cold" }), refusedPictures: () => [] };
  const call = createRouter(sessionRoutes(/** @type {any} */ ({ memory: {}, usage: {}, ops: {}, sessions: {}, subagents, config: { get: () => ({}) } })));
  /** @param {string} path */
  return async (path) => {
    const url = new URL(`http://127.0.0.1${path}`);
    const m = call("GET", url.pathname);
    assert.ok(m, "the route has a row");
    let body = "";
    let status = 0;
    const res = { headersSent: false, writableEnded: false, setHeader() {}, getHeader() {}, writeHead: (/** @type {number} */ s) => void (status = s), write: (/** @type {string} */ c) => void (body += c), end: (/** @type {string} */ c = "") => void (body += c), on() {} };
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url, path: url.pathname, method: "GET", params: m.params }), /** @type {any} */ ({}));
    assert.equal(status, 200, body);
    return { bytes: Buffer.byteLength(body), body: JSON.parse(body) };
  };
};

// (fails before: yes — every read was sent every row, the version it held or not)
test("the route: a read that names its version is sent the rows that moved, and the page draws the list whole", async () => {
  let rows = Array.from({ length: 40 }, (_, i) => row(`sa_${i}`, i < 2 ? "running" : "done"));
  const get = route(() => rows);
  const first = await get("/sessions/c1/subagents");
  assert.equal(first.body.subagents.length, 40);
  assert.ok(first.body.version, "a version");
  rows = rows.map((r, i) => (i === 1 ? row(r.id, "running", 3) : r));
  const next = await get(`/sessions/c1/subagents?since=${encodeURIComponent(first.body.version)}`);
  assert.deepEqual(next.body.subagents.map((/** @type {any} */ r) => r.id), ["sa_1"], "the row that moved alone");
  assert.equal(next.body.ids.length, 40);
  assert.equal(next.body.since, first.body.version);
  assert.ok(next.bytes * 10 < first.bytes, `a tenth or less of the bytes (${next.bytes} of ${first.bytes})`);
  // The page, over the same route: the list whole, the same as a whole read gives.
  const reads = /** @type {string[]} */ ([]);
  /** @param {string} path */
  const read = async (path) => {
    reads.push(path);
    return (await get(path)).body;
  };
  const one = await readAgents("c-page", (p) => read(p.replace("c-page", "c1")));
  rows = rows.map((r, i) => (i === 0 ? row(r.id, "done", 9) : r));
  const two = await readAgents("c-page", (p) => read(p.replace("c-page", "c1")));
  assert.match(reads[1], /[?&]since=/, "the second read names its version");
  const whole = (await get("/sessions/c1/subagents")).body;
  assert.deepEqual(two.subagents, whole.subagents, "drawn the same as a whole read");
  assert.equal(two.ids, undefined);
  assert.deepEqual(two.subagents[5], one.subagents[5], "a row that did not move: as the page held it");
  // A reader writes on its rows — a running agent's progress, heard on the feed —: never the server's word on a row
  // that did not move (the review of 11-02).
  two.subagents[5].progress = { round: 99 };
  const three = await readAgents("c-page", (p) => read(p.replace("c-page", "c1")));
  assert.deepEqual(three.subagents[5].progress, { round: 0 }, "the server's word");
});

// (fails before: yes — the route read no `heads`: the registry was asked its cards' form alone)
test("the route: heads=1 asks the registry for heads, its versions kept apart from the whole form's, which another machine's older page reads", async () => {
  /** @type {(boolean | undefined)[]} */
  const asked = [];
  const rows = [row("a", "running"), row("b", "done")];
  const get = route(/** @type {any} */ ((/** @type {string} */ _id, /** @type {any} */ o) => (asked.push(o?.head), rows)));
  const heads = await get("/sessions/c1/subagents?heads=1");
  const plain = await get(`/sessions/c1/subagents?since=${encodeURIComponent(heads.body.version)}`);
  assert.equal(plain.body.ids, undefined, "a heads version is none of the whole form's: every row");
  const again = await get(`/sessions/c1/subagents?heads=1&since=${encodeURIComponent(heads.body.version)}`);
  assert.deepEqual([again.body.ids, again.body.subagents], [["a", "b"], []], "its own: the rows that moved");
  const back = await get(`/sessions/c1/subagents?heads=1&since=${encodeURIComponent(plain.body.version)}`);
  assert.equal(back.body.ids, undefined, "nor the other way");
  assert.deepEqual(asked, [true, false, true, true]);
});

test("the page: an answer that moved from another version is asked again; a list with no version is read whole", async () => {
  /** @type {string[]} */
  const asked = [];
  /** @type {any[]} */
  const answers = [
    { version: "b.1", subagents: [row("a", "running"), row("b", "done")] },
    // Another read of the chat landed between: this one moved from b.0, not from the version held.
    { version: "b.3", since: "b.0", ids: ["a", "b"], subagents: [row("a", "done")] },
    { version: "b.3", since: "b.1", ids: ["b", "a"], subagents: [row("a", "done")] },
  ];
  /** @param {string} p */
  const read = async (p) => {
    asked.push(p);
    return answers.shift();
  };
  await readAgents("c9", read);
  const got = await readAgents("c9", read);
  assert.deepEqual(asked, ["/sessions/c9/subagents?heads=1", "/sessions/c9/subagents?heads=1&since=b.1", "/sessions/c9/subagents?heads=1&since=b.1"]);
  assert.deepEqual(got.subagents.map((/** @type {any} */ r) => [r.id, r.status]), [["b", "done"], ["a", "done"]]);
  // A stand-in that says no version: never asked by one.
  /** @type {string[]} */
  const plain = [];
  for (let i = 0; i < 2; i++) await readAgents("c10", async (p) => (plain.push(p), { subagents: [row("a", "done")] }));
  assert.deepEqual(plain, ["/sessions/c10/subagents?heads=1", "/sessions/c10/subagents?heads=1"]);
});

/** A stand-in read whose answers the test hands out one by one, in the order asked. */
const held = () => {
  /** @type {{ path: string, signal: AbortSignal | undefined, answer: (v: any) => void, fail: (e: any) => void }[]} */
  const asked = [];
  // How many are on their way now, and the most ever at once.
  let open = 0;
  let most = 0;
  /** @param {string} path @param {{ signal?: AbortSignal }} [init] @returns {Promise<any>} */
  const read = (path, init) =>
    new Promise((answer, fail) => {
      most = Math.max(most, ++open);
      asked.push({ path, signal: init?.signal, answer: (v) => (open--, answer(v)), fail: (e) => (open--, fail(e)) });
    });
  return { asked, read, most: () => most };
};
const turn = () => new Promise((r) => setImmediate(r));

// (fails before: yes — the Agents tab's store and Now each read the chat's list on their own, at once, from the version
// each held; their answers crossed, and the later was sent every row)
test("the page: asks while a read is on its way share the one read after it, from the version it left, each handed rows of its own", { timeout: 5000 }, async () => {
  const { asked, read } = held();
  const first = readAgents("c12", read);
  await turn();
  // Asked after the read left — woken by the feed, say: its answer may say the list as it stood before what woke them.
  const later = [readAgents("c12", read), readAgents("c12", read), readAgents("c12", read)];
  await turn();
  assert.equal(asked.length, 1, "nothing more asked while one is on its way");
  asked[0].answer({ version: "v.1", subagents: [row("a", "running"), row("b", "done")] });
  assert.equal((await first).subagents[0].status, "running");
  await turn();
  assert.deepEqual(asked.map((x) => x.path), ["/sessions/c12/subagents?heads=1", "/sessions/c12/subagents?heads=1&since=v.1"], "one read behind it, for the three, from the version the first left");
  asked[1].answer({ version: "v.2", since: "v.1", ids: ["a", "b"], subagents: [row("a", "done")], own: [{ id: "g1", state: "idle" }], queued: 2 });
  const got = await Promise.all(later);
  for (const g of got) assert.deepEqual([g.subagents.map((/** @type {any} */ r) => r.status), g.queued], [["done", "done"], 2]);
  got[0].subagents[1].progress = { round: 7 };
  got[0].own[0].state = "busy";
  assert.deepEqual([got[1].subagents[1].progress, got[1].own[0].state], [{ round: 0 }, "idle"], "what one writes on its rows, another never sees");
  // Nothing on its way: the next ask reads at once.
  const again = readAgents("c12", read);
  await turn();
  assert.equal(asked.length, 3);
  asked[2].answer({ version: "v.2", since: "v.2", ids: ["a", "b"], subagents: [] });
  assert.deepEqual((await again).subagents[1].progress, { round: 0 }, "nor the list kept");
});

// (fails before the guard: yes — an ask between a read's end and the start of the one behind it began a read beside it)
test("the page: one read of a chat on its way at a time — an ask in the same tick as the read waits for one of its own; asks while a read ends and the one behind it starts share that one", { timeout: 5000 }, async () => {
  const { asked, read, most } = held();
  const first = readAgents("c14", read);
  // The first request left already (readWhole asks before it returns): an ask in the same tick reads after it.
  const same = readAgents("c14", read);
  await turn();
  assert.equal(asked.length, 1);
  asked[0].answer({ version: "v.1", subagents: [row("a", "running")] });
  // Asks a microtask apart while the read ends and the one behind it starts, and after.
  /** @type {Promise<any>[]} */
  const between = [];
  for (let i = 0; i < 8; i++) {
    await null;
    between.push(readAgents("c14", read));
  }
  await first;
  await turn();
  assert.equal(asked[1]?.path, "/sessions/c14/subagents?heads=1&since=v.1", "the one behind, from the version the first left");
  // Each read answered as it comes, from the version before it.
  for (let k = 1; k < asked.length; k++) {
    asked[k].answer({ version: `v.${k + 1}`, since: `v.${k}`, ids: ["a"], subagents: [row("a", "done")] });
    await turn();
  }
  for (const got of await Promise.all([same, ...between])) assert.equal(got.subagents[0].status, "done");
  assert.equal(most(), 1, "never two reads of the chat on their way at once");
});

test("the page: a read that fails fails every ask that shares it, the list held as it was; the read behind a failed one still goes", { timeout: 5000 }, async () => {
  const { asked, read } = held();
  const first = readAgents("c13", read);
  await turn();
  asked[0].answer({ version: "v.1", subagents: [row("a", "running")] });
  await first;
  const x = readAgents("c13", read);
  await turn();
  const [y, z] = [readAgents("c13", read), readAgents("c13", read)];
  asked[1].fail(new Error("unreachable"));
  await assert.rejects(x, /unreachable/);
  await turn();
  assert.equal(asked[2]?.path, "/sessions/c13/subagents?heads=1&since=v.1", "behind the failed read, one from the version held");
  asked[2].fail(new Error("unreachable again"));
  await assert.rejects(y, /unreachable again/);
  await assert.rejects(z, /unreachable again/);
  const after = readAgents("c13", read);
  await turn();
  assert.equal(asked[3]?.path, "/sessions/c13/subagents?heads=1&since=v.1", "the list held as it was");
  asked[3].answer({ version: "v.2", since: "v.1", ids: ["a"], subagents: [row("a", "done")] });
  assert.equal((await after).subagents[0].status, "done");
});

// (fails before: yes — the review of 11-19: a read that never answered held every later ask of the chat behind it)
test("the page: a read that never answers is let go after READ_MOST_MS and fails every ask that shares it; the one behind it goes, and answers", { timeout: 5000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { asked, read } = held();
  const stuck = readAgents("c15", read);
  await turn();
  const behind = readAgents("c15", read);
  await turn();
  assert.equal(asked.length, 1, "behind the read on its way");
  assert.equal(asked[0].signal?.aborted, false, "its request's signal, handed the reader");
  t.mock.timers.tick(READ_MOST_MS - 1);
  await turn();
  assert.equal(asked.length, 1, "not before its time");
  t.mock.timers.tick(1);
  await assert.rejects(stuck, /not read in 30 s/);
  assert.equal(asked[0].signal?.aborted, true, "its request let go");
  await turn();
  assert.equal(asked.length, 2, "the read behind it went");
  asked[1].answer({ version: "v.1", subagents: [row("a", "done")] });
  assert.equal((await behind).subagents[0].status, "done");
  assert.equal(asked[1].signal?.aborted, false, "an answered read's time is let go with it");
  t.mock.timers.tick(READ_MOST_MS);
  assert.equal(asked[1].signal?.aborted, false);
});
