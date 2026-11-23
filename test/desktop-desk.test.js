// @ts-check
// The desk's bridge (the remote desk of 11-22, s1e): This computer's page acts on another machine through the app's main
// process by a short table of operations (desktop/lib/desk.js) — never a path, never a token —, as the window's sign-in
// there; and each machine's events stream says what moved there, cut to the frames the desk reads. Against a scripted
// Filament: the table refuses what is not in it, a press goes as a Full device alone, a write goes as the desk's tab, a
// turn's stream is let go once it begins and never sent again, and the events stream is followed, filtered and joined
// again after a drop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CALLS_MOST, DESK_MODES, DESK_OPS, createDesk, frameOf } from "../desktop/lib/desk.js";
import { MODES } from "../src/ui/harness/composer/mode.js";

const PRINT = "AB".repeat(32);
/** A machine the window keeps. @param {Record<string, any>} [o] @returns {import("../desktop/lib/machines.js").Machine} */
const kept = (o = {}) => ({ id: "m-mac", name: "Mac mini", routes: [{ kind: "lan", url: "https://192.0.2.9:20343", fingerprint: PRINT }], partition: "persist:machine-m-mac", addedAt: 0, ...o });
const COOKIE = "__Host-filament_device=cookie-of-m-mac";
const enc = new TextEncoder();

/** @param {number} status @param {any} json @param {Record<string, string>} [headers] */
const answer = (status, json, headers = {}) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json", ...headers } });

/**
 * An event stream as a test drives it: frames pushed, ended, or errored as a real fetch's body is when its signal aborts.
 * @param {AbortSignal | undefined} signal @param {Record<string, string>} [headers]
 */
const streamed = (signal, headers = {}) => {
  /** @type {ReadableStreamDefaultController<Uint8Array> | null} */
  let c = null;
  let cancelled = false;
  const body = new ReadableStream({
    start: (ctl) => void (c = ctl),
    cancel: () => void (cancelled = true),
  });
  signal?.addEventListener("abort", () => {
    try {
      c?.error(new DOMException("aborted", "AbortError"));
    } catch {}
  });
  return {
    res: new Response(body, { status: 200, headers: { "content-type": "text/event-stream", ...headers } }),
    /** @param {any} data */
    push: (data) => c?.enqueue(enc.encode(typeof data === "string" ? data : `data: ${JSON.stringify(data)}\n\n`)),
    end: () => c?.close(),
    cancelled: () => cancelled,
  };
};

/**
 * A scripted Filament: who it takes this window for at /remote/me, and an answer per path; every call kept. `events`:
 * its answer to /api/events, else a stream the test drives.
 * @param {{ me?: any, on?: (method: string, path: string, init: any) => Response | Promise<Response> | null, events?: () => Response | null }} [o]
 */
const scripted = (o = {}) => {
  /** @type {{ method: string, path: string, headers: Record<string, string>, body: any }[]} */
  const calls = [];
  /** @type {(ReturnType<typeof streamed> & { signal: AbortSignal })[]} */
  const streams = [];
  /** @type {typeof fetch} */
  const fetchImpl = /** @type {any} */ (
    async (/** @type {string} */ u, /** @type {any} */ init = {}) => {
      const url = new URL(String(u));
      const method = init.method || "GET";
      const path = url.pathname.replace(/^\/api/, "") + url.search;
      calls.push({ method, path, headers: { ...(init.headers || {}) }, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) });
      if (url.pathname === "/api/remote/me") return answer(200, o.me ?? { who: "device", device: { id: "d-window", scope: "full" }, machine: { id: "m-mac", name: "Mac mini" }, pages: ["new"], desk: ["remote-key"] });
      if (url.pathname === "/api/events") {
        const given = o.events?.();
        if (given) return given;
        const s = streamed(init.signal);
        streams.push({ ...s, signal: init.signal });
        return s.res;
      }
      const got = o.on ? await o.on(method, path, init) : null;
      return got ?? answer(404, { error: `no route ${path}` });
    }
  );
  return { fetchImpl, calls, streams, sent: () => calls.filter((c) => c.path !== "/remote/me") };
};

/**
 * The desk over a scripted machine.
 * @param {ReturnType<typeof scripted>} there
 * @param {{ machines?: () => any[], sleep?: (ms: number, signal: AbortSignal) => Promise<void>, now?: () => number, quietMs?: number, beginMs?: number }} [o]
 */
const deskOver = (there, o = {}) => {
  /** @type {any[]} */
  const told = [];
  const desk = createDesk({
    machines: o.machines ?? (() => [kept()]),
    cookieOf: async () => COOKIE,
    pick: async (m) => ({ route: m.routes[0], name: m.name, version: "9", tried: [] }),
    fetchOf: () => there.fetchImpl,
    tell: (f) => void told.push(f),
    tab: "desk-test",
    ...(o.sleep ? { sleep: o.sleep } : {}),
    ...(o.now ? { now: o.now } : {}),
    ...(o.quietMs ? { quietMs: o.quietMs } : {}),
    ...(o.beginMs ? { beginMs: o.beginMs } : {}),
  });
  return { desk, told };
};

/** Until `fn` holds, or two seconds. @param {() => boolean} fn @param {string} what */
const until = async (fn, what) => {
  const end = Date.now() + 2000;
  while (!fn()) {
    if (Date.now() > end) assert.fail(`never: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
};

// (fails before: yes — s1e: there was no desk bridge)
test("the table alone: an operation not in it, a path, a name off the prototype, a machine not kept or This computer, a field that does not fit — refused here, nothing sent", async () => {
  const there = scripted();
  const { desk } = deskOver(there, { machines: () => [kept(), { ...kept({ id: "local", name: "This computer" }), local: true }] });
  assert.deepEqual([...DESK_OPS].sort(), ["answer", "asks", "chats", "create", "holders", "live-state", "me", "mode", "search", "stop", "turn"]);
  for (const op of ["fetch", "/sessions", "GET /memory/sessions", "__proto__", "constructor", "toString", "hasOwnProperty", ""]) {
    const a = await desk.call({ op, machine: "m-mac", path: "/remote/devices" });
    assert.equal(a.ok, false, op);
    assert.match(String(a.words), /^No such operation on the desk/, op);
  }
  for (const p of [null, "chats", 7, []]) assert.equal((await desk.call(p)).ok, false);
  assert.equal((await desk.call({ op: "chats", machine: "m-gone" })).words, "This window keeps no such machine now.");
  assert.equal((await desk.call({ op: "chats", machine: "local" })).words, "This window keeps no such machine now.", "This computer's own are its page's");
  /** @type {[any, RegExp][]} */
  const unfit = [
    [{ op: "asks", chat: "../remote/devices" }, /chat is the id of a chat there/],
    [{ op: "asks", chat: "c1/../../x" }, /chat is the id/],
    [{ op: "asks", chat: "c".repeat(101) }, /chat is the id/],
    // An id of dots alone would be a step up its path: /sessions/../settings is PATCH /api/settings, the machine's own.
    [{ op: "mode", chat: "..", mode: "auto" }, /chat is the id/],
    [{ op: "stop", chat: "." }, /chat is the id/],
    [{ op: "answer", chat: "c1", ask: "..", allow: true }, /ask is the id of an ask/],
    [{ op: "answer", chat: "c1", ask: ".hidden", allow: true }, /ask is the id of an ask/],
    [{ op: "live-state", chat: "c1", after: ".." }, /after is the id of a run/],
    // A choice goes in the answer's body, never its path: words its machine names it by, not control characters.
    [{ op: "answer", chat: "c1", ask: "r1.2", choice: "" }, /choice is the id of one of its options/],
    [{ op: "answer", chat: "c1", ask: "r1.2", choice: "x".repeat(501) }, /choice is the id of one of its options: words, at most 500 characters/],
    [{ op: "answer", chat: "c1", ask: "r1.2", choice: "yes\nno" }, /choice is the id/],
    [{ op: "answer", chat: "c1", ask: "r1.2", choice: 2 }, /choice is the id/],
    [{ op: "live-state", chat: "c1", after: "r 1" }, /after is the id of a run/],
    [{ op: "search", q: "   " }, /q is the search/],
    [{ op: "search", q: "x".repeat(201) }, /q is the search/],
    [{ op: "turn", chat: "c1", content: "  " }, /content is the message/],
    [{ op: "turn", chat: "c1", content: { type: "text" } }, /content is the message/],
    [{ op: "answer", chat: "c1", ask: "a 1", allow: true }, /ask is the id of an ask/],
    [{ op: "answer", chat: "c1", ask: "r1.2", allow: "yes" }, /allow is true or false/],
    [{ op: "answer", chat: "c1", ask: "r1.2" }, /an answer is allow, a choice or words/],
    [{ op: "mode", chat: "c1", mode: "yolo" }, /mode is one of read-only, edit, ask, auto/],
    [{ op: "create", cwd: "" }, /cwd is the folder/],
    [{ op: "create", cwd: "\\\\server\\share\\x" }, /on no share/],
    [{ op: "create", cwd: "/w/x", mode: "yolo" }, /mode is one of/],
  ];
  for (const [p, words] of unfit) assert.match(String((await desk.call({ machine: "m-mac", ...p })).words), words, JSON.stringify(p));
  assert.deepEqual(there.calls, [], "nothing reached the machine");
  assert.deepEqual([...DESK_MODES], MODES.map((m) => m.id), "the modes a chat takes");
});

test("a read: made here, as the window's sign-in there, its list cut to what the desk lists — no tab's heads on it", async () => {
  const there = scripted({
    on: (method, path) =>
      path.startsWith("/memory/sessions?")
        ? answer(200, { sessions: [null, 7, { id: "c1", title: "Parser", projectName: "shop", project: "p1", cwd: "/w/shop", lastAt: 5, unread: true, remoteKey: "github.com/o/shop", secret: "x" }, { id: "c0", archived: true }] })
        : path === "/sessions/c%3A1/asks"
          ? answer(200, { chainId: "c:1", asks: [{ id: "r1.2", kind: "permission" }] })
          : null,
  });
  const { desk } = deskOver(there);
  const a = await desk.call({ op: "chats", machine: "M-MAC" });
  assert.deepEqual(a, { ok: true, status: 200, json: { chats: [{ chain: "c1", title: "Parser", project: "shop", projectId: "p1", cwd: "/w/shop", when: 5, unread: true, pinned: false, threadOf: null, from: "", remoteKey: "github.com/o/shop", kind: "interactive" }] } });
  const s = await desk.call({ op: "search", machine: "m-mac", q: " parser & co " });
  assert.equal(s.ok, true);
  assert.equal(there.sent().at(-1)?.path, "/memory/sessions?q=parser%20%26%20co&limit=20&kind=interactive,fork,team");
  const asks = await desk.call({ op: "asks", machine: "m-mac", chat: "c:1" });
  assert.deepEqual(asks.json, { chainId: "c:1", asks: [{ id: "r1.2", kind: "permission" }] });
  assert.deepEqual(
    there.sent().map((c) => [c.method, c.path]),
    [
      ["GET", "/memory/sessions?limit=200&kind=interactive,fork,team&remotes=1"],
      ["GET", "/memory/sessions?q=parser%20%26%20co&limit=20&kind=interactive,fork,team"],
      ["GET", "/sessions/c%3A1/asks"],
    ],
  );
  assert.ok(there.calls.every((c) => c.headers.cookie === COOKIE && c.headers["x-filament-ui"] === "1"), "every call as the window's sign-in there");
  assert.ok(there.sent().every((c) => !("x-filament-tab" in c.headers) && !("x-filament-take" in c.headers)), "a read writes no chat");
  assert.equal(JSON.stringify(a).includes("cookie-of"), false, "no sign-in in what the page hears");
});

test("a write about a chat goes as the desk's tab there, taking the chat as the person acts; a stop, a mode; a refusal says the machine's words, a press refused says pair again", async () => {
  /** @type {Record<string, Response>} */
  const next = {};
  const there = scripted({ on: (method, path) => next[`${method} ${path}`] ?? answer(200, { ok: true }) });
  const { desk } = deskOver(there);
  assert.equal((await desk.call({ op: "stop", machine: "m-mac", chat: "c1" })).ok, true);
  assert.equal((await desk.call({ op: "mode", machine: "m-mac", chat: "c1", mode: "auto" })).ok, true);
  const [stop, mode] = there.sent();
  assert.deepEqual([stop.method, stop.path, stop.body], ["POST", "/sessions/c1/stop", {}]);
  assert.deepEqual([mode.method, mode.path, mode.body], ["PATCH", "/sessions/c1/settings", { patch: { loop: { permissions: "auto" } } }]);
  for (const c of [stop, mode]) assert.deepEqual([c.headers["x-filament-tab"], c.headers["x-filament-take"], c.headers.cookie], ["desk-test", "c1", COOKIE]);
  assert.equal(desk.tab, "desk-test");

  next["PATCH /sessions/c1/settings"] = answer(403, { error: "a press of yours is needed for this\u0007\nnow", press: true });
  const refused = await desk.call({ op: "mode", machine: "m-mac", chat: "c1", mode: "edit" });
  assert.deepEqual([refused.ok, refused.status, refused.press], [false, 403, true]);
  assert.equal(refused.words, "Mac mini refused it: a press of yours is needed for this now. Pair this machine again as Full with Add a machine, and it works from here.");
  next["POST /sessions/c1/stop"] = answer(409, { error: "x".repeat(400) });
  const busy = await desk.call({ op: "stop", machine: "m-mac", chat: "c1" });
  assert.equal(busy.status, 409);
  assert.equal(String(busy.words).length, "Mac mini answered: ".length + 300, "its words clipped");
});

test("a new chat there: its folder, its name or none, its model, its mode; its answer its chat's id alone", async () => {
  const there = scripted({ on: (method, path) => (method === "POST" && path === "/sessions" ? answer(200, { id: "c-new", cwd: "/w/shop", settings: { secret: 1 } }) : null) });
  const { desk } = deskOver(there);
  const made = await desk.call({ op: "create", machine: "m-mac", cwd: " /w/shop ", model: "sonnet", mode: "edit" });
  assert.deepEqual(made, { ok: true, status: 200, json: { chat: "c-new" } });
  await desk.call({ op: "create", machine: "m-mac", cwd: "/w/shop", title: "Fix it" });
  assert.deepEqual(
    there.sent().map((c) => c.body),
    [
      { cwd: "/w/shop", model: "sonnet", autoTitle: true, settings: { loop: { permissions: "edit" } } },
      { cwd: "/w/shop", title: "Fix it" },
    ],
  );
});

test("through a tunnel or by the tailnet login an answer — always a press — is refused here, pair this machine as Full; a mode goes, for that machine to judge; a read and a turn go", async () => {
  for (const who of ["local", "tailnet"]) {
    const there = scripted({
      me: { who },
      on: (method, path) =>
        path === "/sessions/holders" ? answer(200, { holders: [] }) : method === "PATCH" ? answer(403, { error: "this asks less, and needs a press of yours in Filament's app", press: true }) : null,
    });
    const { desk } = deskOver(there);
    const a = await desk.call({ machine: "m-mac", op: "answer", chat: "c1", ask: "r1.2", allow: true });
    assert.equal(a.press, true, who);
    assert.match(String(a.words), new RegExp(`^This app reaches Mac mini ${who === "tailnet" ? "by your tailnet login" : "through a tunnel"}, not as a paired Full device, and this needs one: pair this machine as Full with Add a machine`));
    assert.deepEqual(there.sent(), [], `${who}: no answer sent`);
    // A mode asks less or more as that machine knows: sent, and its press refused there said as it said it.
    const mode = await desk.call({ machine: "m-mac", op: "mode", chat: "c1", mode: "auto" });
    assert.deepEqual([mode.press, mode.status, there.sent().at(-1)?.method], [true, 403, "PATCH"], who);
    assert.match(String(mode.words), /^Mac mini refused it: this asks less, and needs a press of yours in Filament's app\. Pair this machine again as Full/);
    assert.equal((await desk.call({ op: "holders", machine: "m-mac" })).ok, true, `${who}: a read goes`);
    // Who this window is there (Run on asks before it sends a copy, run-on.js `copyRefusal`).
    assert.deepEqual((await desk.call({ op: "me", machine: "m-mac" })).json, { who, device: null }, `${who}: who it is there`);
    // A message is no press: it goes, and the machine says what it makes of it.
    const turn = await desk.call({ op: "turn", machine: "m-mac", chat: "c1", content: "hi" });
    assert.deepEqual([turn.press, there.sent().at(-1)?.path], [undefined, "/sessions/c1/turns"], `${who}: a turn goes`);
  }
  // A view-only device, a sign-in revoked there, a machine disconnected in this window: said, nothing asked of it.
  const view = scripted({ me: { who: "device", device: { scope: "view" } } });
  assert.match(String((await deskOver(view).desk.call({ op: "holders", machine: "m-mac" })).words), /^This app is paired with Mac mini view-only: a full device works its chats from here\./);
  const off = scripted();
  const a = await deskOver(off, { machines: () => [kept({ off: true })] }).desk.call({ op: "holders", machine: "m-mac" });
  assert.deepEqual([a.ok, a.away], [false, "off"]);
  assert.deepEqual(off.calls, []);
  // A paired Full device says its id there, and nothing else of the device.
  assert.deepEqual((await deskOver(scripted()).desk.call({ op: "me", machine: "m-mac" })).json, { who: "device", device: "d-window" });
});

test("a turn: its message as the person's, a sendId of its own, its stream let go once it begins — the turn goes on there; an answer that never came is never sent again", async () => {
  /** @type {ReturnType<typeof streamed> | null} */
  let reply = null;
  let failNext = false;
  const there = scripted({
    on: (method, path, init) => {
      if (method !== "POST" || !path.endsWith("/turns")) return null;
      if (failNext) throw new TypeError("fetch failed");
      reply = streamed(init.signal, { "x-filament-request-id": "req_42" });
      reply.push({ type: "message_start" });
      return reply.res;
    },
  });
  const { desk } = deskOver(there);
  const a = await desk.call({ op: "turn", machine: "m-mac", chat: "c1", content: "run the tests", sendId: "mine-1234567", stream: false });
  assert.equal(a.ok, true);
  assert.match(String(a.sendId), /^[0-9a-f]{32}$/, "its own sendId, made here");
  assert.deepEqual(a.json, { request: "req_42" });
  const sent = there.sent()[0];
  assert.deepEqual(sent.body, { content: "run the tests", stream: true, runEvents: true, sendAsIs: true, sendId: a.sendId });
  assert.deepEqual([sent.headers["x-filament-tab"], sent.headers["x-filament-take"]], ["desk-test", "c1"]);
  assert.equal(/** @type {any} */ (reply)?.cancelled(), true, "its stream let go");

  failNext = true;
  const lost = await desk.call({ op: "turn", machine: "m-mac", chat: "c1", content: "again" });
  assert.deepEqual([lost.ok, lost.unsure], [false, true]);
  assert.match(String(lost.sendId), /^[0-9a-f]{32}$/);
  assert.match(String(lost.words), /^Mac mini did not answer: fetch failed\. It may have reached the chat there: look at the chat before you send it again\.$/);
  assert.equal(there.sent().filter((c) => c.path.endsWith("/turns")).length, 2, "each sent once");
});

test("an answer: always a press, as a Full device; a chat's own ask goes on in its turn as a stream, another's answers at once", async () => {
  const there = scripted({
    on: (method, path, init) => {
      if (path === "/sessions/c1/asks/req_7/answer") {
        const s = streamed(init.signal);
        s.push({ type: "message_start" });
        return s.res;
      }
      if (path === "/sessions/c1/asks/sa_1.2/answer") return answer(200, { ok: true, id: "sa_1.2", from: "sa_1" });
      if (path === "/sessions/c1/asks/gone.1/answer") return answer(409, { error: "it was answered already" });
      if (path === "/sessions/c1/asks/r3.q1/answer") return answer(200, { ok: true, id: "r3.q1", from: "coding-agent" });
      return null;
    },
  });
  const { desk } = deskOver(there);
  const own = await desk.call({ op: "answer", machine: "m-mac", chat: "c1", ask: "req_7", allow: true });
  assert.deepEqual([own.ok, own.json], [true, { request: null }]);
  const theirs = await desk.call({ op: "answer", machine: "m-mac", chat: "c1", ask: "sa_1.2", choice: "2", words: "the second" });
  assert.deepEqual(theirs, { ok: true, status: 200, json: { ok: true, id: "sa_1.2", from: "sa_1" } });
  const late = await desk.call({ op: "answer", machine: "m-mac", chat: "c1", ask: "gone.1", words: "no" });
  assert.deepEqual([late.ok, late.status, late.words], [false, 409, "Mac mini answered: it was answered already"]);
  // A coding agent's question names its answers by their labels: one goes as said, in the body.
  const labelled = await desk.call({ op: "answer", machine: "m-mac", chat: "c1", ask: "r3.q1", choice: "Use Postgres (v16)" });
  assert.equal(labelled.ok, true);
  assert.deepEqual(
    there.sent().map((c) => c.body),
    [
      { allow: true, stream: true, runEvents: true },
      { choice: "2", words: "the second", stream: true, runEvents: true },
      { words: "no", stream: true, runEvents: true },
      { choice: "Use Postgres (v16)", stream: true, runEvents: true },
    ],
  );
  assert.ok(there.sent().every((c) => c.headers["x-filament-take"] === "c1"));
});

test(`at most ${CALLS_MOST} calls under way on one machine: the next is told so, another machine's go`, async () => {
  /** @type {(() => void)[]} */
  const held = [];
  const there = scripted({ on: (method, path) => (path === "/sessions/holders" ? new Promise((r) => held.push(() => r(answer(200, { holders: [] })))) : null) });
  const { desk } = deskOver(there, { machines: () => [kept(), kept({ id: "m-box", name: "Box", partition: "persist:machine-m-box" })] });
  const under = Array.from({ length: CALLS_MOST }, () => desk.call({ op: "holders", machine: "m-mac" }));
  await until(() => held.length === CALLS_MOST, "every call under way");
  const past = await desk.call({ op: "holders", machine: "m-mac" });
  assert.equal(past.words, `Mac mini has ${CALLS_MOST} calls from here under way already: ask again once they end.`);
  const other = desk.call({ op: "holders", machine: "m-box" });
  await until(() => held.length === CALLS_MOST + 1, "another machine's goes");
  for (const f of held) f();
  assert.ok((await Promise.all([...under, other])).every((a) => a.ok));
  assert.equal((await (async () => {
    const p = desk.call({ op: "holders", machine: "m-mac" });
    await until(() => held.length === CALLS_MOST + 2, "the next one goes once they ended");
    held.at(-1)?.();
    return p;
  })()).ok, true);
});

test("a frame of a machine's events stream, cut to what the desk reads: ids by pattern, words clipped, the rest none", () => {
  assert.deepEqual(frameOf({ type: "hello", version: "0.9.85" }, "t"), { type: "hello" });
  assert.deepEqual(frameOf({ type: "turn", chainId: "c1", holder: { since: 1, secret: "x" } }, "t"), { type: "turn", chain: "c1", busy: true });
  assert.deepEqual(frameOf({ type: "turn", chainId: "c1", holder: null }, "t"), { type: "turn", chain: "c1", busy: false });
  assert.deepEqual(frameOf({ type: "writer", chainId: "c1", tab: "t", where: { key: "device:d", name: "Laptop\u0000\n" } }, "t"), { type: "writer", chain: "c1", mine: true, where: "Laptop" });
  assert.deepEqual(frameOf({ type: "writer", chainId: "c1", tab: "other", where: null }, "t"), { type: "writer", chain: "c1", mine: false, where: null });
  assert.deepEqual(frameOf({ type: "ask", chainId: "c1", id: "r1.2", open: true, question: "rm -rf?" }, "t"), { type: "ask", chain: "c1", ask: "r1.2", open: true });
  for (const d of [{ type: "turn", chainId: "../x" }, { type: "turn" }, { type: "ask", chainId: "c1", id: "a b" }, { type: "start", chainId: "c1", record: {} }, { type: "progress" }, null, "hello"])
    assert.equal(frameOf(d, "t"), null, JSON.stringify(d));
});

test("each machine kept and connected has one events stream, as the desk's tab: its frames the desk reads told, the rest dropped; a drop said and joined again; one removed let go", async () => {
  /** @type {number[]} */
  const waits = [];
  const there = scripted();
  let list = [kept(), kept({ id: "m-off", name: "Off", off: true })];
  const { desk, told } = deskOver(there, { machines: () => list, sleep: async (ms) => void waits.push(ms) });
  desk.sync();
  desk.sync();
  await until(() => there.streams.length === 1, "its stream asked for");
  const events = there.calls.filter((c) => c.path.startsWith("/events"));
  assert.deepEqual(events.map((c) => [c.path, c.headers.cookie]), [["/events?tab=desk-test", COOKIE]], "one stream, as the desk's tab, none for a machine disconnected");
  const s = there.streams[0];
  s.push({ type: "hello", version: "9" });
  s.push({ type: "start", record: { id: "r1", body: "x".repeat(1000) } });
  s.push({ type: "turn", chainId: "c1", holder: { id: 1 } });
  s.push({ type: "turn", chainId: "../c1", holder: null });
  s.push('data: {"type":"writer","chainId":"c1","tab":"desk-test",');
  s.push('"where":{"name":"Desk"}}\n\n');
  s.push({ type: "ask", chainId: "c1", id: "r1.2", open: true });
  s.push(": ping\n\n");
  s.push("data: {not json\n\n");
  await until(() => told.length >= 4, "its frames told");
  assert.deepEqual(told, [
    { machine: "m-mac", type: "hello" },
    { machine: "m-mac", type: "turn", chain: "c1", busy: true },
    { machine: "m-mac", type: "writer", chain: "c1", mine: true, where: "Desk" },
    { machine: "m-mac", type: "ask", chain: "c1", ask: "r1.2", open: true },
  ]);
  assert.equal(desk.live("m-mac"), true);
  s.end();
  await until(() => there.streams.length === 2, "joined again");
  assert.deepEqual(told.at(-1), { machine: "m-mac", type: "down" });
  assert.deepEqual(waits, [2000]);
  there.streams[1].end();
  await until(() => there.streams.length === 3, "joined again, further apart");
  assert.deepEqual(waits, [2000, 4000], "no hello, no down said again");
  list = [];
  desk.sync();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(there.streams.length, 3, "one removed is let go, joined no more");
  assert.equal(desk.live("m-mac"), false);
  desk.close();
});

// (fails before: yes — a machine sent the desk every record its turns made, a coding agent's 140 KB finish included)
test("a machine that says events-only is asked for the desk's topics alone (an older one for its whole stream: the test above)", async () => {
  const there = scripted({ me: { who: "device", device: { id: "d-window", scope: "full" }, machine: { id: "m-mac", name: "Mac mini" }, pages: ["new"], desk: ["remote-key", "ask-events", "events-only"] } });
  const { desk } = deskOver(there);
  desk.sync();
  await until(() => there.streams.length === 1, "its stream asked for");
  assert.deepEqual(there.calls.filter((c) => c.path.startsWith("/events")).map((c) => c.path), ["/events?tab=desk-test&only=turns,writers"]);
  desk.close();
});

test("a listener that throws stops no stream; close lets every stream go", async () => {
  const there = scripted();
  let n = 0;
  const desk = createDesk({
    machines: () => [kept()],
    cookieOf: async () => COOKIE,
    pick: async (m) => ({ route: m.routes[0], name: m.name, version: "9", tried: [] }),
    fetchOf: () => there.fetchImpl,
    tell: () => {
      n++;
      throw new Error("the page is gone");
    },
    tab: "desk-test",
  });
  desk.sync();
  await until(() => there.streams.length === 1, "its stream");
  there.streams[0].push({ type: "hello" });
  there.streams[0].push({ type: "turn", chainId: "c1", holder: null });
  await until(() => n === 2, "both told");
  desk.close();
  assert.equal(there.streams[0].signal.aborted, true, "the stream under way let go");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(there.streams.length, 1, "closed, joined no more");
});

// (fails before: yes — the review of s1e: every call asked the machine's ways and its /remote/me again, a dead way's wait each time)
test("a machine reached is kept a moment for the calls that follow; a call that failed on its way, a sign-in refused, a way changed, or the moment past, reach it anew", async () => {
  let t = 0;
  let down = false;
  let refuse = false;
  const there = scripted({
    on: (method, path) => {
      if (down) throw new TypeError("fetch failed");
      if (refuse) return answer(401, { error: "signed out" });
      return path === "/sessions/holders" ? answer(200, { holders: [] }) : null;
    },
  });
  /** @type {any} */
  let machine = kept();
  const { desk } = deskOver(there, { machines: () => [machine], now: () => t });
  const mes = () => there.calls.filter((c) => c.path === "/remote/me").length;
  await desk.call({ op: "holders", machine: "m-mac" });
  await desk.call({ op: "holders", machine: "m-mac" });
  assert.equal(mes(), 1, "reached once for both");
  t += 20_000;
  await desk.call({ op: "holders", machine: "m-mac" });
  assert.equal(mes(), 2, "the moment past");
  machine = kept({ routes: [{ kind: "url", url: "https://mac.tail1234.ts.net" }] });
  await desk.call({ op: "holders", machine: "m-mac" });
  assert.equal(mes(), 3, "its ways changed");
  down = true;
  assert.equal((await desk.call({ op: "holders", machine: "m-mac" })).away, "quiet");
  down = false;
  await desk.call({ op: "holders", machine: "m-mac" });
  assert.equal(mes(), 4, "a call that failed on its way");
  refuse = true;
  assert.equal((await desk.call({ op: "holders", machine: "m-mac" })).status, 401);
  refuse = false;
  await desk.call({ op: "holders", machine: "m-mac" });
  assert.equal(mes(), 5, "a sign-in refused");
});

// (fails before: yes — the review of s1e: a cold coding agent's turn writes no head for a while, and was said unsure)
test("a turn whose head does not come in time: the chat's live state asked — a turn at work there is this one begun; none, unsure", async () => {
  /** @type {any} */
  let live = { live: { requestId: "req_9" } };
  const there = scripted({
    on: (method, path, init) => {
      if (path.endsWith("/turns")) return new Promise((_, no) => init.signal.addEventListener("abort", () => no(new DOMException("aborted", "AbortError"))));
      if (path === "/sessions/c1/live-state") return answer(200, live);
      return null;
    },
  });
  const { desk } = deskOver(there, { beginMs: 20 });
  const a = await desk.call({ op: "turn", machine: "m-mac", chat: "c1", content: "go" });
  assert.deepEqual([a.ok, a.json, typeof a.sendId], [true, { request: "req_9" }, "string"]);
  live = { live: null };
  const b = await desk.call({ op: "turn", machine: "m-mac", chat: "c1", content: "go" });
  assert.deepEqual([b.ok, b.unsure], [false, true]);
  assert.equal(there.sent().filter((c) => c.path.endsWith("/turns")).length, 2, "each sent once");
});

test("a machine's events stream: one that says nothing for its quiet time is let go and joined again; one refused or no stream is joined again later; a frame of a machine let go since the last sync is told nothing", async () => {
  // Quiet: no byte, not even a ping, past `quietMs`.
  const quiet = scripted();
  // A wait that yields to the timers, as the real one does: one that never did would spin the loop on promises alone.
  const tick = () => new Promise((done) => setTimeout(done, 1));
  const q = deskOver(quiet, { quietMs: 40, sleep: tick });
  q.desk.sync();
  await until(() => quiet.streams.length >= 2, "joined again after its quiet");
  assert.equal(quiet.streams[0].signal.aborted, true);
  q.desk.close();

  // Refused, or answered with no stream: no hello, nothing told, and asked again after its wait.
  let n = 0;
  /** @type {number[]} */
  const waits = [];
  const refused = scripted({ events: () => (++n === 1 ? answer(403, { error: "no" }) : answer(200, { not: "a stream" })) });
  const r = deskOver(refused, { sleep: (ms) => (waits.push(ms), tick()) });
  r.desk.sync();
  await until(() => n >= 3, "asked again");
  r.desk.close();
  assert.deepEqual([r.told, waits.slice(0, 2)], [[], [2000, 4000]]);

  // Removed since the last sync: its next frame is not told, and its stream let go.
  const there = scripted();
  /** @type {any[]} */
  let list = [kept()];
  const { desk, told } = deskOver(there, { machines: () => list, sleep: (ms, signal) => new Promise((done) => signal.addEventListener("abort", () => done(undefined))) });
  desk.sync();
  await until(() => there.streams.length === 1, "its stream");
  there.streams[0].push({ type: "hello" });
  await until(() => told.length === 1, "its hello");
  list = [];
  there.streams[0].push({ type: "turn", chainId: "c1", holder: null });
  await until(() => there.streams[0].signal.aborted, "let go at its next frame");
  assert.deepEqual(told, [{ machine: "m-mac", type: "hello" }]);
  desk.close();
});

test("close during a stream's wait to join again ends it there: no stream asked after", async () => {
  /** @type {AbortSignal[]} */
  const waiting = [];
  const there = scripted();
  const { desk } = deskOver(there, { sleep: (ms, signal) => new Promise((done) => (waiting.push(signal), signal.addEventListener("abort", () => done(undefined)))) });
  desk.sync();
  await until(() => there.streams.length === 1, "its stream");
  there.streams[0].end();
  await until(() => waiting.length === 1, "waiting to join again");
  desk.close();
  assert.equal(waiting[0].aborted, true, "its wait ended");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(there.streams.length, 1, "never joined again");
});

test("main.js: the desk's bridge heard from Filament's own page in the harness window alone; its frames told to that page alone; reach is lib/reach.js's", () => {
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.match(main, /ipcMain\.handle\("filament:desk-call", \(e, p\) => \(deskPage\(e\) \? desk\.call\(p\) : null\)\);/, "This computer's page alone, not a popped pane's (the hunt on s1e)");
  assert.match(main, /if \(w && !w\.isDestroyed\(\) && paneHears\(true, w\.webContents\.getURL\(\), origin\)\) w\.webContents\.send\("filament:desk-event", f\);/);
  assert.match(main, /machineBrowsers\.sync\(\);\n\s+desk\.sync\(\);/, "its streams follow the machines kept, at each look");
  assert.match(main, /machineBrowsers\.destroy\(\);\n\s+desk\.close\(\);/, "and end as the app does");
  const agents = readFileSync(new URL("../desktop/lib/machine-agents.js", import.meta.url), "utf8");
  assert.match(agents, /const reachThere = createReach\(\{ cookieOf, pick, fetchOf \}\);/);
  assert.doesNotMatch(agents, /fetchOf\(route\)\(/, "one way to reach a machine");
  const preload = readFileSync(new URL("../desktop/machine-preload.cjs", import.meta.url), "utf8");
  assert.doesNotMatch(preload, /desk-call|desk-event/, "another machine's page has no desk bridge");
});
