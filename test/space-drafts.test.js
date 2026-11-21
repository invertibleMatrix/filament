// @ts-check
// HarnessV4_Space_Plan S5c, the mock's screen 13: drafts — what an agent writes for the person to send. The draft's
// shape and its checks (core); the store's rows — written, rewritten by their own chat while they wait, discarded with
// Bring back, the person's words kept, sent with a line in What happened and no way back —; the agents' space tool's
// `draft` and what its read says of drafts; the sheet's look and the person's Send (app/space-drafts.js) — exactly the
// words where "{words}" stands, the account From picks, a failure that keeps the words, one Send at a time, Stop —; a
// connection's tool sending over a real MCP server; the page's arithmetic of a draft; and end to end: a chat's agent
// writes one, the person sends it.
// (fails before: yes — there were no drafts)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DRAFT_LIMITS, draftFields, draftsWords, fillWords } from "../src/core/space.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { SPACE_TOOL, spaceCall } from "../src/app/agent/space.js";
import { createDrafts, firstLink } from "../src/app/space-drafts.js";
import { createSpaceTools } from "../src/app/space-tools.js";
import { draftAsk, draftCall, draftFrom, linkParts, needGroups } from "../src/ui/harness/lib/space-view.js";
import { FILTERS, filterCounts, todayRows } from "../src/ui/harness/lib/your-space.js";
import { spaceRoutes } from "../src/http/admin/spaces.js";
import { createRouter } from "../src/http/router.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-runs-server.mjs", import.meta.url));
/** @type {string[]} */
const made = [];
after(() => removeDirs(...made));
/** A folder of the test's own. @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-space-drafts-${tag}-`));
  made.push(d);
  return d;
};

/** A reply to Sara, as an agent writes it. */
const SLACK = {
  title: "Reply to Sara in #releases",
  connection: "slack",
  tool: "post_message",
  args: { channel: "releases", thread_ts: "1729.5", text: "{words}" },
  words: "Not today: CI on main is red.",
  to: "#releases, the thread “can we ship 1.8 today?”",
  answers: { who: "Sara", words: "can we ship 1.8 today?" },
  from: ["CI run 8812 https://ci.example.invalid/runs/8812", "PR #412"],
};
/** The fields as core checked them. @param {any} [o] */
const fieldsOf = (o = {}) => {
  const f = draftFields({ ...SLACK, ...o });
  assert.ok(f.ok, JSON.stringify(f));
  return f.fields;
};
const T = new Date(2026, 9, 25, 9, 1).getTime();

describe("a draft's shape (core)", () => {
  test("draftFields: a title, a connection and its tool, args with {words} as a whole value, the words; where, answers and from where given; each refused in words", () => {
    assert.deepEqual(fieldsOf(), { title: SLACK.title, connection: "slack", tool: "post_message", args: SLACK.args, words: SLACK.words, to: SLACK.to, answers: SLACK.answers, from: SLACK.from });
    /** @param {any} o */
    const refused = (o) => {
      const r = draftFields({ ...SLACK, ...o });
      assert.equal(r.ok, false, JSON.stringify(o));
      return /** @type {any} */ (r).error;
    };
    assert.match(refused({ title: "  " }), /^a draft needs a title/);
    assert.match(refused({ connection: "" }), /^a draft names the connection that would send it and its tool/);
    assert.match(refused({ tool: " " }), /^a draft names the connection/);
    assert.match(refused({ args: ["{words}"] }), /^"args" is the tool's arguments as a JSON object/);
    assert.match(refused({ args: { text: "Hi {words}" } }), /as a whole value, where the words go whole/);
    assert.match(refused({ args: { channel: "releases" } }), /^a draft's args say where its words go/);
    assert.match(refused({ args: { text: "{words}", pad: "x".repeat(DRAFT_LIMITS.args) } }), /the words go in "words", not in args$/);
    assert.match(refused({ words: " \n " }), /^a draft needs its words/);
    assert.match(refused({ words: "x".repeat(DRAFT_LIMITS.words + 1) }), /^a draft's words are 10000 characters at most/);
    assert.match(refused({ answers: "Sara" }), /^"answers" is what it answers/);
    assert.match(refused({ from: "PR #412" }), /^"from" lists what it was made from/);
    assert.match(refused({ from: Array(DRAFT_LIMITS.from + 1).fill("x") }), /^"from" lists 10 things at most$/);
    // The words are sent as written: their lines and inner spaces stay, the ends alone are trimmed.
    assert.equal(fieldsOf({ words: "  a\r\n    b  " }).words, "a\n    b");
    // A mark deep in the args counts; none of where, answers and from is needed.
    assert.deepEqual(fieldsOf({ args: { blocks: [{ type: "section", text: "{words}" }] }, to: undefined, answers: undefined, from: undefined }).from, []);
    assert.equal(fieldsOf({ answers: { who: " ", words: "" } }).answers, null, "an empty quote is none");
  });

  test("fillWords: the words exactly where {words} stands, nested too; nothing else changed", () => {
    assert.deepEqual(fillWords({ channel: "releases", text: "{words}", blocks: [{ t: "{words}" }], n: 3, other: "say {words}" }, "Hi $1 {words}"), {
      channel: "releases",
      text: "Hi $1 {words}",
      blocks: [{ t: "Hi $1 {words}" }],
      n: 3,
      other: "say {words}",
    });
  });
});

describe("the store's drafts", () => {
  test("written as a row of Needs you, counted; rewritten by its own chat while it waits; another chat's, a gone one, an unknown id: refused", () => {
    const store = createSpaceStore({ dir: null, now: () => T });
    const n = store.writeDraft("p1", fieldsOf(), { chain: "c1", byName: "login", account: "main" });
    assert.deepEqual(n, {
      id: "n1", kind: "draft", text: SLACK.title, why: "", dashboard: "", title: "Draft",
      draft: { connection: "slack", tool: "post_message", args: SLACK.args, words: SLACK.words, to: SLACK.to, answers: SLACK.answers, from: SLACK.from, chain: "c1", byName: "login", account: "main" },
      at: T, state: "open",
    });
    assert.deepEqual(store.needCounts(T), { p1: 1 });
    assert.equal(store.extended(T), true, "a draft grows Your Space (S5-D6)");
    const again = store.writeDraft("p1", fieldsOf({ words: "Tomorrow, once #412 is in." }), { chain: "c1", byName: "login", account: "main" }, "n1");
    assert.deepEqual([again.id, again.draft?.words, store.get("p1").needs.length], ["n1", "Tomorrow, once #412 is in.", 1]);
    assert.throws(() => store.writeDraft("p1", fieldsOf(), { chain: "c2", byName: "build", account: "" }, "n1"), { status: 409, message: "n1 is login's draft: write one of your own." });
    assert.throws(() => store.writeDraft("p1", fieldsOf(), { chain: "c1", byName: "login", account: "" }, "n9"), { status: 404 });
    store.needChange("p1", "n1", { discard: true });
    assert.throws(() => store.writeDraft("p1", fieldsOf(), { chain: "c1", byName: "login", account: "" }, "n1"), { status: 409, message: "n1 was discarded: write a new draft." });
  });

  test("discarded: Done today with Bring back; the person's words kept; sent: a line in What happened, and no way back", () => {
    let now = T;
    const store = createSpaceStore({ dir: null, now: () => now });
    store.writeDraft("p1", fieldsOf(), { chain: "c1", byName: "login", account: "main" });
    now += 60_000;
    const gone = store.needChange("p1", "n1", { discard: true });
    assert.deepEqual([gone.state, gone.outcome, gone.doneAt], ["done", "discarded", now]);
    assert.throws(() => store.needChange("p1", "n1", { discard: true }), { status: 409, message: "It is discarded already." });
    assert.throws(() => store.needChange("p1", "n1", { words: "x" }), { status: 409, message: "It is discarded: its words stay as they were." });
    const back = store.needChange("p1", "n1", { back: true });
    assert.deepEqual([back.state, "outcome" in back], ["open", false]);
    assert.equal(store.needChange("p1", "n1", { words: "  Shipping tomorrow.\n\n  Once #412 is in.  " }).draft?.words, "Shipping tomorrow.\n\n  Once #412 is in.");
    assert.throws(() => store.needChange("p1", "n1", { words: "  " }), { status: 400, message: "a draft's words cannot be empty: Discard it instead" });
    // Done on a draft is its Discard.
    assert.equal(store.needChange("p1", "n1", { done: true }).outcome, "discarded");
    store.needChange("p1", "n1", { back: true });
    now += 60_000;
    const sent = store.draftSent("p1", "n1", { words: "Shipping tomorrow.", as: "work", link: "https://chat.example.invalid/releases/p1" });
    assert.deepEqual([sent.state, sent.outcome, sent.draft?.words, sent.draft?.sent], ["done", "sent", "Shipping tomorrow.", { as: "work", link: "https://chat.example.invalid/releases/p1" }]);
    assert.deepEqual(store.get("p1").log.at(-1), { id: store.get("p1").log.at(-1)?.id, at: now, by: { kind: "filament" }, text: "You sent “Reply to Sara in #releases” through slack › post_message as work: https://chat.example.invalid/releases/p1", task: null });
    assert.throws(() => store.needChange("p1", "n1", { back: true }), { status: 409, message: "It was sent: what left this machine cannot be brought back from here. Ask its chat for a new draft." });
    assert.throws(() => store.needChange("p1", "n1", { discard: true }), { status: 409, message: "It was sent already." });
    assert.deepEqual(store.needCounts(now), {}, "nothing open");
  });

  // (fails before: yes — found by the Hunter on S2: a row the trim closed was done at the moment it came)
  test("past 100 open rows, the oldest draft goes to Done today as discarded — Bring back puts it back", () => {
    let now = T;
    const store = createSpaceStore({ dir: null, now: () => now });
    store.writeDraft("p1", fieldsOf(), { chain: "c1", byName: "login", account: "main" });
    now += 3_600_000;
    for (let i = 0; i < 100; i++) store.writeDraft("p1", fieldsOf({ title: `run ${i}` }), { chain: "c2", byName: "build", account: "" });
    const d = store.get("p1").needs.find((n) => n.id === "n1");
    assert.deepEqual([d?.state, d?.outcome, d?.doneAt], ["done", "discarded", now]);
    now += 60_000;
    assert.equal(store.needChange("p1", "n1", { back: true }).state, "open");
    const rows = store.get("p1").needs;
    assert.deepEqual([rows.find((n) => n.id === "n1")?.state, rows.filter((n) => n.state === "open").length, rows.find((n) => n.text === "run 0")?.state],
      ["open", 100, "done"], "brought back, it stays: the oldest other row goes instead");
  });

  test("on disk: a draft reads back whole; a row that does not read as a draft is left out, the rest kept", () => {
    const dir = fresh("store");
    const one = createSpaceStore({ dir, now: () => T });
    one.writeDraft("p1", fieldsOf(), { chain: "c1", byName: "login", account: "main" });
    one.draftSent("p1", "n1", { words: SLACK.words, as: "main", link: null });
    const two = createSpaceStore({ dir, now: () => T });
    assert.deepEqual(two.get("p1").needs, one.get("p1").needs);
    const raw = JSON.parse(readFileSync(join(dir, "p1.json"), "utf8"));
    raw.needs.push({ id: "n9", kind: "draft", text: "no args", dashboard: "", draft: { connection: "slack", tool: "post_message", words: "x", chain: "c1" }, at: T, state: "open" });
    writeFileSync(join(dir, "p2.json"), JSON.stringify(raw));
    assert.deepEqual(createSpaceStore({ dir }).get("p2").needs.map((n) => n.id), ["n1"]);
  });
});

describe("the agents' space tool: draft", () => {
  /** @param {import("../src/services/spaces.js").SpaceStore} store @param {any} [o] */
  const atOf = (store, o = {}) => ({
    store,
    project: "p1",
    chain: "c1",
    name: null,
    nameOf: (/** @type {string} */ c) => (/** @type {Record<string, string>} */ ({ c1: "login", c2: "build" }))[c] || c,
    connection: (/** @type {string} */ _p, /** @type {string} */ n) =>
      n === "slack" ? { ok: /** @type {const} */ (true), account: "main" } : n === "off" ? { ok: /** @type {const} */ (false), error: "off is switched off for this project (Library › Plugins & Connectors)" } : { ok: /** @type {const} */ (false), error: `${n} is no MCP server of this project's chats (Library › Plugins & Connectors, for all chats or this project)` },
    ...o,
  });
  const input = { action: "draft", ...SLACK, to: undefined, where: SLACK.to };

  test("written for the person's Send, through a connection of the project; refused in words otherwise; rewritten by id; its read lists them", () => {
    const store = createSpaceStore({ dir: null, now: () => T });
    const at = atOf(store);
    assert.deepEqual(spaceCall(input, at, T), {
      ok: true,
      text: 'Draft n1 "Reply to Sara in #releases" waits in the person\'s Needs you. Nothing is sent: they read it, may change its words and press Send — or discard it, or ask you for a change naming n1.',
    });
    const d = store.get("p1").needs[0].draft;
    assert.deepEqual([d?.to, d?.account, d?.byName, d?.chain], [SLACK.to, "main", "login", "c1"], "where it goes from \"where\"; the account the project picks");
    assert.deepEqual(spaceCall({ ...input, connection: "nope" }, at, T), { ok: false, error: "Not written: nope is no MCP server of this project's chats (Library › Plugins & Connectors, for all chats or this project)." });
    assert.deepEqual(spaceCall({ ...input, connection: "off" }, at, T), { ok: false, error: "Not written: off is switched off for this project (Library › Plugins & Connectors)." });
    assert.match(/** @type {any} */ (spaceCall({ ...input, args: { text: "Hi {words}" } }, at, T)).error, /^Not written: "\{words\}" stands as a whole value/);
    // "to" names a column for add and move: a draft's "to" is not where it goes.
    spaceCall({ ...input, title: "Ping", to: "done", where: undefined }, at, T);
    assert.equal(store.get("p1").needs[1].draft?.to, "");
    assert.equal(store.get("p1").needs.length, 2);
    // Rewritten by its id, by its own chat; another chat's is refused; a helper writes as itself, for its chat.
    assert.equal(/** @type {any} */ (spaceCall({ ...input, id: "n1", words: "Tomorrow." }, at, T)).text.startsWith('Draft n1 "Reply to Sara in #releases" is rewritten and waits'), true);
    assert.equal(store.get("p1").needs[0].draft?.words, "Tomorrow.");
    assert.deepEqual(spaceCall({ ...input, id: "n1" }, atOf(store, { chain: "c2" }), T), { ok: false, error: "n1 is login's draft: write one of your own." });
    spaceCall({ ...input, title: "From the scout" }, atOf(store, { name: "Scout" }), T);
    assert.equal(store.get("p1").needs.at(-1)?.draft?.byName, "Scout (for login)");
    // The read: what waits, what became of each — yours, or another chat's.
    store.draftSent("p1", "n1", { words: "Tomorrow.", as: "main", link: null });
    const read = /** @type {any} */ (spaceCall({ action: "read" }, at, T)).text;
    assert.match(read, /\nDrafts: each leaves only when the person presses Send\. A waiting one of yours is rewritten with its id\.\n- n1 "Reply to Sara in #releases" \(yours\), through slack › post_message: sent as main at 2026-10-25 09:01\n- n\d+ "Ping" \(yours\), through slack › post_message: waits for the person\n/);
    assert.match(/** @type {any} */ (spaceCall({ action: "read" }, atOf(store, { chain: "c2" }), T)).text, /- n1 "Reply to Sara in #releases" \(by login\)/);
    assert.equal(draftsWords([], { nameOf: String, now: T }), "", "none: nothing said");
    // The tool says so: the door names it, its guide gives every field (E39, HarnessV4_SpaceDoor_Plan).
    assert.ok(SPACE_TOOL.input_schema.properties.action.enum.includes("draft"));
    const guide = /** @type {any} */ (spaceCall({ action: "guide", topic: "draft" }, at, T)).text;
    assert.deepEqual(["connection", "tool", "args", "words", "where", "answers", "from"].filter((k) => !new RegExp(`(^|\\n|\\. )- ${k}:|\\. ${k}:`).test(guide)), []);
  });
});

describe("the sheet's look and the person's Send", () => {
  /**
   * A Space with one draft, and the drafts' sheet over stand-in tools.
   * @param {{ accounts?: any, sendable?: { ok: boolean, words: string }, send?: (signal?: AbortSignal) => Promise<any> }} [o]
   */
  const setup = (o = {}) => {
    const store = createSpaceStore({ dir: null, now: () => T });
    store.writeDraft("p1", fieldsOf(), { chain: "c1", byName: "login", account: "main" });
    /** @type {any[]} */
    const calls = [];
    const drafts = createDrafts({
      spaces: store,
      tools: {
        sendable: async (_p, t, a) => {
          calls.push(["sendable", t.name, a]);
          return o.sendable || { ok: true, words: "Sends through slack › post_message" };
        },
        send: async (_p, t, args, a, signal) => {
          calls.push(["send", t, args, a]);
          return o.send ? o.send(signal) : { ok: true, said: "Posted in #releases: https://chat.example.invalid/releases/p1.", args };
        },
      },
      accounts: () => (o.accounts === undefined ? { account: "main", accounts: ["main", "work"] } : o.accounts),
      chatOf: (c) => (c === "c1" ? { name: "login" } : null),
    });
    return { store, drafts, calls };
  };

  test("look: From with the accounts signed in at its address, its tool asked as the one picked, its chat; a gone draft sends nothing", async () => {
    const { store, drafts, calls } = setup();
    const look = await drafts.look("p1", "n1");
    assert.deepEqual([look.from, look.tool, look.chat, look.sending, look.row.id], [{ connection: "slack", account: "main", accounts: ["main", "work"] }, { ok: true, words: "Sends through slack › post_message" }, { name: "login" }, false, "n1"]);
    assert.equal((await drafts.look("p1", "n1", "work")).from.account, "work");
    assert.equal((await drafts.look("p1", "n1", "nobody")).from.account, "main", "an account not signed in there: the draft's own");
    assert.deepEqual(calls.map((c) => c[2]), ["main", "work", "main"]);
    // A server that signs in its own way: From names it alone, its tool asked as it is.
    const own = setup({ accounts: null });
    own.store.writeDraft("p1", fieldsOf(), { chain: "c9", byName: "gone", account: "" });
    const l = await own.drafts.look("p1", "n2");
    assert.deepEqual([l.from, l.chat, own.calls.at(-1)[2]], [{ connection: "slack", account: "", accounts: [] }, null, undefined]);
    store.needChange("p1", "n1", { discard: true });
    const n = calls.length;
    assert.deepEqual((await drafts.look("p1", "n1")).tool, { ok: false, words: "It is discarded: Bring back puts it back." });
    assert.equal(calls.length, n, "no server asked");
    await assert.rejects(drafts.look("p1", "n9"), { status: 404 });
  });

  test("Send: your words kept first, then exactly them where {words} stands, as the account picked; sent: Done today, What happened with its link", async () => {
    const { store, drafts, calls } = setup();
    const out = await drafts.send("p1", "n1", { words: "  Shipping tomorrow, once #412 is in.  ", account: "work" });
    assert.deepEqual([out.sent, /** @type {any} */ (out).link, out.row.state, out.row.outcome], [true, "https://chat.example.invalid/releases/p1", "done", "sent"]);
    assert.deepEqual(calls.at(-1), ["send", { connection: "slack", name: "post_message" }, { channel: "releases", thread_ts: "1729.5", text: "Shipping tomorrow, once #412 is in." }, "work"]);
    assert.equal(store.get("p1").log.at(-1)?.text, "You sent “Reply to Sara in #releases” through slack › post_message as work: https://chat.example.invalid/releases/p1");
    await assert.rejects(drafts.send("p1", "n1", { words: "again" }), { status: 409, message: "It was sent." });
  });

  test("failed: the draft waits with your words; an account not signed in, no words: refused; one Send at a time; Stop before and after it went out", async () => {
    const failing = setup({ send: async () => ({ ok: false, error: "channel_is_archived: #releases takes no messages", said: "" }) });
    assert.deepEqual(await failing.drafts.send("p1", "n1", { words: "Edited." }).then((r) => [r.sent, /** @type {any} */ (r).error, r.row.state, r.row.draft?.words]), [false, "channel_is_archived: #releases takes no messages", "open", "Edited."]);
    await assert.rejects(failing.drafts.send("p1", "n1", { words: "x", account: "nobody" }), { status: 400, message: 'slack has no account "nobody" signed in: From picks one of main, work.' });
    await assert.rejects(failing.drafts.send("p1", "n1", { words: undefined }), { status: 400 });
    // One at a time; Stop once it went out: the service may have it.
    /** @type {(v: any) => void} */
    let release = () => {};
    const held = setup({ send: (signal) => new Promise((r) => { release = r; signal?.addEventListener("abort", () => r({ ok: false, error: "you stopped it", said: "", sent: true })); }) });
    const first = held.drafts.send("p1", "n1", { words: "Edited." });
    await until(() => held.calls.some((c) => c[0] === "send"), "the call made");
    await assert.rejects(held.drafts.send("p1", "n1", { words: "Twice." }), { status: 409, message: "It is being sent: wait for it, or stop it." });
    assert.equal((await held.drafts.look("p1", "n1")).sending, true);
    assert.equal(held.drafts.stop("p1", "n1"), true);
    assert.deepEqual(await first.then((r) => [r.sent, /** @type {any} */ (r).error, r.row.state]), [false, "You stopped it after it went out: slack may have sent it — look there before sending again.", "open"]);
    assert.equal(held.drafts.stop("p1", "n1"), false, "nothing being sent");
    release(null);
    // Stopped before it went out: nothing was sent.
    const early = setup({ send: async (signal) => (signal?.aborted ? { ok: false, error: "you stopped it", said: "", sent: false } : new Promise((r) => signal?.addEventListener("abort", () => r({ ok: false, error: "you stopped it", said: "", sent: false })))) });
    const p = early.drafts.send("p1", "n1", { words: "Edited." });
    await until(() => early.calls.some((c) => c[0] === "send"), "the call begun");
    early.drafts.stop("p1", "n1");
    assert.equal(/** @type {any} */ (await p).error, "You stopped it before it went out: nothing was sent.");
  });

  // Found by the Hunter on S5c: the sheet closed while it sent, the row's Discard ran, and what went out was marked sent
  // over it. (fails before: yes — the row was discarded, then marked sent)
  test("while it is being sent, its row is neither discarded, done, put off nor rewritten; once sent, sent", async () => {
    /** @type {(v: any) => void} */
    let release = () => {};
    const held = setup({ send: () => new Promise((r) => (release = r)) });
    const rows = spaceRoutes({
      config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "app", cwd: "/work/app" } : null) } },
      spaces: held.store,
      spaceDrafts: held.drafts,
    });
    /** @param {string} method @param {string} path @param {any} [json] */
    const call = async (method, path, json) => {
      const m = createRouter(rows)(method, path);
      assert.ok(m, `${method} ${path} matched a row`);
      const got = { status: 0, body: /** @type {any} */ (null) };
      const res = { headersSent: false, writableEnded: false, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void (got.body = JSON.parse(String(b))) };
      await m.handler({ res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => json }, {});
      return got;
    };
    const sending = held.drafts.send("p1", "n1", { words: "Edited." });
    await until(() => held.calls.some((c) => c[0] === "send"), "the call made");
    assert.equal(held.drafts.sending("p1", "n1"), true);
    const busy = { status: 409, body: { error: "It is being sent: wait for it, or stop it from its sheet (Review & send…)." } };
    for (const body of [{ discard: true }, { done: true }, { words: "Other." }, { later: T + 3_600_000 }]) assert.deepEqual(await call("POST", "/space/p1/needs/n1", body), busy, JSON.stringify(body));
    release({ ok: true, said: "Posted: https://chat.example.invalid/releases/p1", args: {} });
    const out = await sending;
    assert.deepEqual([out.sent, out.row.outcome, held.drafts.sending("p1", "n1")], [true, "sent", false]);
    assert.deepEqual(await call("POST", "/space/p1/needs/n1", { discard: true }), { status: 409, body: { error: "It was sent already." } });
  });

  // Found by the Hunter on Space optional (10-29): Delete Space while a draft of it sent — what went out could not be
  // marked sent in a Space that was gone, and the person was told the send failed. (fails before: yes — the delete went
  // through, then the send's end threw)
  test("while a draft of it is being sent, its Space is not deleted; once sent, it is", async () => {
    /** @type {(v: any) => void} */
    let release = () => {};
    const held = setup({ send: () => new Promise((r) => (release = r)) });
    const rows = spaceRoutes({
      config: { get: () => ({ agentLoop: { roots: [tmpdir()] }, server: {} }) },
      memory: { archive: { getProject: (/** @type {string} */ id) => (id === "p1" ? { id, name: "app", cwd: "/work/app" } : null) } },
      spaces: held.store,
      spaceDrafts: held.drafts,
    });
    /** @param {string} method @param {string} path */
    const call = async (method, path) => {
      const m = createRouter(rows)(method, path);
      assert.ok(m, `${method} ${path} matched a row`);
      const got = { status: 0, body: /** @type {any} */ (null) };
      const res = { headersSent: false, writableEnded: false, writeHead: (/** @type {number} */ s) => Object.assign(got, { status: s }), end: (/** @type {string} */ b) => void (got.body = JSON.parse(String(b))) };
      await m.handler({ res, url: new URL(`http://localhost/api${path}`), params: m.params, json: async () => ({}) }, {});
      return got;
    };
    const sending = held.drafts.send("p1", "n1", { words: "Edited." });
    await until(() => held.calls.some((c) => c[0] === "send"), "the call made");
    assert.deepEqual(await call("DELETE", "/space/p1"), { status: 409, body: { error: "A draft of it is being sent: wait for it, or stop it from its sheet (Review & send…)." } });
    assert.equal(held.store.deletedAt("p1"), null);
    release({ ok: true, said: "Posted: https://chat.example.invalid/releases/p1", args: {} });
    const out = await sending;
    assert.deepEqual([out.sent, out.row.outcome], [true, "sent"]);
    assert.equal((await call("DELETE", "/space/p1")).status, 200);
    assert.equal(held.store.deletedAt("p1"), T);
  });

  test("the sheet (found by the Hunter on S5c): open while it sends; on the words the draft keeps; a keep that failed said; another sheet's Send stoppable here", () => {
    const src = readFileSync(new URL("../src/ui/harness/space/draft-sheet.js", import.meta.url), "utf8");
    assert.match(src, /guard: \(\) => \{\n      if \(!sending\) return true;\n      fail\("It is being sent: wait for it, or Stop it\."\);\n      return false;\n    \},/);
    assert.match(src, /const theirs = look\.row\?\.draft\?\.words;\n    if \(typeof theirs === "string" && theirs !== kept && words === kept\) \{\n      words = kept = theirs;\n      box\.value = theirs;\n    \}/);
    assert.match(src, /void request\("POST", path, \{ words \}\)\.then\(\(r\) => \{\n          if \(!r\.ok\) toast\(`Your words for “\$\{row\.text\}” were not kept: \$\{r\.error\}`, "err"\);/);
    assert.match(src, /const elsewhere = !!look\?\.sending && !sending;\n    const ready = !!look\?\.tool\.ok && !!words\.trim\(\) && !sending && !elsewhere;/);
    // The lists draw a draft's row again as its words move, so Review… opens on them.
    assert.match(readFileSync(new URL("../src/ui/harness/space/space.js", import.meta.url), "utf8"), /\[n\.id, n\.text, n\.at, n\.until, n\.doneAt, n\.outcome, n\.draft\?\.words, n\.ask\?\.why, n\.ask\?\.ended\]/);
    assert.match(readFileSync(new URL("../src/ui/harness/space/your-space.js", import.meta.url), "utf8"), /\[r\.need\.id, r\.need\.text, r\.need\.at, r\.need\.project, r\.need\.draft\?\.words\]/);
  });

  test("firstLink: the first link of a tool's answer, its end's stop left off", () => {
    assert.equal(firstLink("Posted in #releases: https://chat.example.invalid/releases/p1."), "https://chat.example.invalid/releases/p1");
    assert.equal(firstLink("ok (see https://x.invalid/a?b=1), and https://y.invalid"), "https://x.invalid/a?b=1");
    assert.equal(firstLink("sent"), null);
  });
});

describe("a draft's tool over a real server", () => {
  const cwd = fresh("tools");
  const log = join(cwd, "calls.log");
  writeFileSync(log, "");
  const spec = { name: "chat", command: process.execPath, args: [FIXTURE], env: { MCP_FIXTURE_LOG: log } };
  const tools = createSpaceTools({ serverFor: (p, n) => (p === "p1" && n === "chat" ? { ok: true, spec, cwd } : { ok: false, error: `${n} is no MCP server of this project's chats (Library › Plugins & Connectors, for all chats or this project)` }) });
  after(() => tools.close());
  const called = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

  test("sendable: a tool there that its server does not mark read-only; send: called with the words, no clock; one that only reads is never called; Stop tells the server", async () => {
    assert.deepEqual(await tools.sendable("p1", { connection: "chat", name: "post_message" }), { ok: true, words: "Sends through chat › post_message" });
    assert.deepEqual(await tools.sendable("p1", { connection: "chat", name: "list_runs" }), { ok: false, words: "chat says list_runs only reads: it sends nothing" });
    assert.deepEqual(await tools.sendable("p1", { connection: "chat", name: "nope" }), { ok: false, words: "chat has no tool nope" });
    assert.deepEqual(await tools.sendable("p1", { connection: "slack", name: "post_message" }), { ok: false, words: "slack is no MCP server of this project's chats (Library › Plugins & Connectors, for all chats or this project)" });
    const sent = await tools.send("p1", { connection: "chat", name: "post_message" }, { channel: "releases", text: "Shipping tomorrow." }, "work");
    assert.deepEqual(sent, { ok: true, said: "Posted in #releases: https://chat.example.invalid/releases/p1.", args: { channel: "releases", text: "Shipping tomorrow." } }, "a server on this computer: the account is not its");
    assert.deepEqual(called().at(-1), { tool: "post_message", args: { channel: "releases", text: "Shipping tomorrow." } });
    assert.deepEqual(await tools.send("p1", { connection: "chat", name: "post_message" }, { channel: "closed", text: "x" }), { ok: false, error: "channel_is_archived: #closed takes no messages", said: "", args: { channel: "closed", text: "x" } }, "the server's words");
    const n = called().length;
    assert.deepEqual(await tools.send("p1", { connection: "chat", name: "list_runs" }, { branch: "x" }), { ok: false, error: "chat says list_runs only reads: it sends nothing", said: "" });
    assert.equal(called().length, n, "never called");
    const ctl = new AbortController();
    const held = tools.send("p1", { connection: "chat", name: "post_message" }, { channel: "releases", text: "slow", ms: 60_000 }, undefined, ctl.signal);
    await until(() => called().at(-1)?.args?.ms === 60_000, "the call made");
    ctl.abort();
    assert.deepEqual(await held, { ok: false, error: "you stopped it", said: "", args: { channel: "releases", text: "slow", ms: 60_000 }, sent: true });
    await until(() => called().some((c) => "cancelled" in c), "the server told");
    assert.deepEqual(await tools.send("p1", { connection: "chat", name: "post_message" }, { channel: "releases", text: "x" }, undefined, AbortSignal.abort()), { ok: false, error: "you stopped it", said: "", sent: false });
  });
});

describe("the page's words of a draft", () => {
  const row = /** @type {any} */ ({ id: "n4", kind: "draft", text: SLACK.title, why: "", dashboard: "", title: "Draft", draft: { ...fieldsOf(), chain: "c1", byName: "login", account: "main" }, at: T, state: "open" });
  test("its From, Ask for a change…'s words, the call with your words marked, Made from's links", () => {
    assert.equal(draftFrom(row.draft), "From: slack · main");
    assert.equal(draftFrom({ ...row.draft, account: "" }), "From: slack");
    assert.equal(draftAsk(row), "About your draft n4 “Reply to Sara in #releases”: ");
    assert.equal(draftCall(row.draft.args), '{\n  "channel": "releases",\n  "thread_ts": "1729.5",\n  "text": "‹your words›"\n}');
    assert.deepEqual(linkParts("CI run 8812 https://ci.example.invalid/runs/8812, then PR #412"), [{ text: "CI run 8812 " }, { href: "https://ci.example.invalid/runs/8812" }, { text: ", then PR #412" }]);
    assert.deepEqual(linkParts("javascript:alert(1) PR #412"), [{ text: "javascript:alert(1) PR #412" }], "http and https alone open");
  });
  test("its place: first of the rows Filament keeps in a Space; in Your Space after the chats' asks, its own filter", () => {
    const watch = { ...row, id: "w1", kind: "watch", at: T + 5 };
    const source = { ...row, id: "s1", kind: "source", at: T + 9 };
    assert.deepEqual(needGroups([watch, source, row], T + 10).open.map((n) => n.id), ["n4", "s1", "w1"]);
    const asks = [/** @type {any} */ ({ chain: "c1", tone: "asks", at: T - 1 }), /** @type {any} */ ({ chain: "c2", tone: "error", at: T + 1 })];
    const rows = todayRows(asks, [watch, source, row]);
    assert.deepEqual(rows.map((r) => (r.kind === "chat" ? r.row.chain : r.need.id)), ["c1", "n4", "s1", "c2", "w1"], "what fails: the newest first");
    assert.deepEqual(filterCounts(rows), { all: 5, chats: 1, drafts: 1, failing: 2, news: 1 });
    assert.deepEqual([...FILTERS], ["all", "chats", "drafts", "failing", "news"]);
  });
});

describe("end to end: a chat's agent writes a draft, the person sends it", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = fresh("e2e");
  const log = join(root, "calls.log");
  before(async () => {
    writeFileSync(log, "");
    up = await fakeUpstream(async (call) => {
      const body = call.body || {};
      if (!body.tools?.length) return anthropicReply("A title", { model: "brain-model" });
      const last = body.messages?.at(-1);
      const parts = Array.isArray(last?.content) ? last.content : [{ type: "text", text: String(last?.content || "") }];
      const result = parts.find((/** @type {any} */ p) => p?.type === "tool_result");
      if (result) return anthropicReply(`Done: ${JSON.stringify(result.content).slice(0, 300)}`, { model: "brain-model" });
      return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: "d1", name: "space", input: { action: "draft", ...SLACK, connection: "chat", to: undefined, where: SLACK.to } }] });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    made.push(shim.dataDir);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  test("the draft waits in Needs you and Your Space; its sheet asks the server; Send posts your words; What happened says so", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", title: "release notes", settings: { loop: { permissions: "auto" } } } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    const { projectId } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();
    assert.equal((await shim.api(`/api/space/${encodeURIComponent(projectId)}`, { method: "POST" })).status, 200, "its Space made from its menu (10-29)");
    const chat = { name: "chat", command: process.execPath, args: [FIXTURE], env: { MCP_FIXTURE_LOG: log } };
    const set = await shim.api(`/api/projects/${encodeURIComponent(projectId)}/settings`, { method: "POST", body: { patch: { plugins: { mcp: [chat] } } } });
    assert.equal(set.status, 200, await set.clone().text());
    const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "draft a reply to Sara", stream: false } });
    assert.equal(t.status, 200, await t.clone().text());
    const base = `/api/space/${encodeURIComponent(projectId)}`;
    const space = async () => (await shim.api(base)).json();
    await until(async () => (await space()).needs?.some((/** @type {any} */ n) => n.kind === "draft"), "the draft in Needs you");
    const n = (await space()).needs.find((/** @type {any} */ x) => x.kind === "draft");
    assert.deepEqual([n.text, n.state, n.draft.connection, n.draft.account, n.draft.byName], [SLACK.title, "open", "chat", "", "release notes"]);
    assert.equal(readFileSync(log, "utf8"), "", "the agent sent nothing");
    const spaces = await (await shim.api("/api/spaces")).json();
    assert.deepEqual([spaces.needs[projectId], spaces.extended], [1, true]);
    assert.ok((await (await shim.api("/api/your-space?glance=0")).json()).needs.some((/** @type {any} */ x) => x.id === n.id));
    const at = `${base}/needs/${encodeURIComponent(n.id)}`;
    const look = await (await shim.api(`${at}/draft`)).json();
    assert.deepEqual([look.from, look.tool, look.chat], [{ connection: "chat", account: "", accounts: [] }, { ok: true, words: "Sends through chat › post_message" }, { name: "release notes" }]);
    const sent = await shim.api(`${at}/send`, { method: "POST", body: { words: "Not today: tomorrow, once #412 is in." } });
    assert.equal(sent.status, 200, await sent.clone().text());
    const out = await sent.json();
    assert.deepEqual([out.sent, out.link, out.row.outcome], [true, "https://chat.example.invalid/releases/p1", "sent"]);
    assert.deepEqual(JSON.parse(readFileSync(log, "utf8").trim()), { tool: "post_message", args: { channel: "releases", thread_ts: "1729.5", text: "Not today: tomorrow, once #412 is in." } });
    assert.ok(out.space.log.some((/** @type {any} */ e) => e.text === "You sent “Reply to Sara in #releases” through chat › post_message: https://chat.example.invalid/releases/p1"));
    assert.equal((await shim.api(`${at}/send`, { method: "POST", body: { words: "again" } })).status, 409);
    assert.equal((await shim.api(`${at}/send/stop`, { method: "POST", body: {} })).status, 409, "nothing being sent");
    const back = await shim.api(at, { method: "POST", body: { back: true } });
    assert.deepEqual([back.status, (await back.json()).error], [409, "It was sent: what left this machine cannot be brought back from here. Ask its chat for a new draft."]);
  });
});
