// Two harness tabs on one session (HarnessV3-FixRound F7, item 25; decision 22). Both used to send, steer and re-draw
// over each other. Now the session has one writing tab: the first to open it. Another tab on it follows, and its writes
// are refused in words, until the person acts in it: a write made then takes the session over (the owner's of 11-14, his
// PC's chat open in his MacBook's window too: "the Take Over button above the composer keeps hopping around on both
// machines"). A tab counts while its events stream is open, so a tab that closes lets its session go at once, and the
// session is free — no tab takes it until one shows it or writes it. Each tab's place, this computer or a paired machine,
// says where the session is open.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, readEvents, removeDirs } from "./helpers/wait.js";
import { readFileSync } from "node:fs";
import { SessionWriters, READ_ONLY_WORDS, placeOf, readOnlyWords } from "../src/services/session-writers.js";
import { writerClaim, TAB_ID, ACT_MS, acted, acting } from "../src/ui/harness/lib/tab.js";
import { mergedTurns } from "../src/ui/harness/conversation/history.js";

/** A registry with its changes recorded. */
const writers = () => {
  const w = new SessionWriters();
  /** @type {[string, string | null][]} */
  const said = [];
  w.onChange = (chainId, tab) => said.push([chainId, tab]);
  return { w, said };
};
/** An answer as a tab that has no place hears it. @param {string | null} chainId @param {string | null} writer @param {boolean} you */
const answer = (chainId, writer, you) => ({ chainId, writer, you, where: null, here: null });

describe("which tab writes a session", () => {
  // (fails before: n/a — new)
  test("the first open tab writes; another follows and is refused in words; a take swaps them", () => {
    const { w, said } = writers();
    w.connect("A");
    w.connect("B");
    assert.deepEqual(w.open("A", "s1"), answer("s1", "A", true));
    assert.deepEqual(w.open("B", "s1"), answer("s1", "A", false), "B follows");
    assert.equal(w.refusal("s1", "A"), null);
    assert.equal(w.refusal("s1", "B"), READ_ONLY_WORDS);
    assert.equal(READ_ONLY_WORDS, "this chat is open for writing in another window — type or send in this window to take it over");
    assert.equal(w.refusal("s1", ""), null, "a request with no tab is not a harness tab's");
    assert.equal(w.refusal("s2", "B"), null, "a session no tab writes");
    assert.deepEqual(w.open("B", "s1", { take: true }), answer("s1", "B", true));
    assert.equal(w.refusal("s1", "A"), READ_ONLY_WORDS, "the old writer is read-only now");
    assert.equal(w.refusal("s1", "B"), null);
    assert.deepEqual(said, [["s1", "A"], ["s1", "B"]], "each change said once; a follower's open says nothing");
    assert.deepEqual(w.open("B", "s1"), answer("s1", "B", true), "the writer opening it again");
    assert.equal(said.length, 2, "no change, nothing said");
  });

  test("a tab writes the session it shows: another session, or none, lets the first go", () => {
    const { w, said } = writers();
    w.connect("A");
    w.connect("B");
    w.open("A", "s1");
    w.open("B", "s1");
    w.open("A", "s2");
    assert.deepEqual(said, [["s1", "A"], ["s1", null], ["s2", "A"]]);
    assert.equal(w.writerOf("s1"), null, "s1 is free");
    assert.deepEqual(w.open("B", "s1"), answer("s1", "B", true), "the follower takes it");
    assert.deepEqual(w.open("A", null), answer(null, null, false));
    assert.equal(w.writerOf("s2"), null, "a new chat lets s2 go");
    assert.deepEqual(said.at(-1), ["s2", null]);
  });

  test("a tab counts while its events stream is open: its close lets the session go at once", () => {
    const { w, said } = writers();
    const closeA = w.connect("A");
    w.connect("B");
    w.open("A", "s1");
    const closeA2 = w.connect("A");
    assert.deepEqual(said, [["s1", "A"]], "a second stream of a counted tab says nothing");
    closeA();
    closeA();
    assert.equal(w.writerOf("s1"), "A", "one of its two streams still open, however often the other's close is called");
    closeA2();
    closeA2();
    assert.equal(w.writerOf("s1"), null);
    assert.deepEqual(said, [["s1", "A"], ["s1", null]], "said once, however many closes");
    assert.equal(w.refusal("s1", "B"), null);
    assert.equal(w.open("B", "s1").you, true);
  });

  test("a request with no tab id is never a writer and never counted", () => {
    const { w, said } = writers();
    const close = w.connect("");
    assert.equal(w.live(""), false);
    close();
    assert.deepEqual(w.open("", "s1"), answer("s1", null, false));
    w.connect("A");
    assert.equal(w.open("A", "s1").you, true, "the session is still free for a tab");
    assert.deepEqual(said, [["s1", "A"]]);
  });

  test("a claim made before the tab's stream opens is said when it opens; an open tab may claim over an unopened one", () => {
    const { w, said } = writers();
    assert.equal(w.open("A", "s1").you, true, "the page may ask before its stream is up");
    assert.equal(w.writerOf("s1"), null, "not counted yet");
    assert.equal(w.refusal("s1", "B"), null, "it blocks nobody yet");
    w.connect("A");
    assert.equal(w.writerOf("s1"), "A");
    assert.deepEqual(said, [["s1", "A"], ["s1", "A"]], "said again once it counts");
    const { w: w2 } = writers();
    w2.open("A", "s1");
    w2.connect("B");
    assert.equal(w2.open("B", "s1").you, true, "B is open and A is not: B writes");
    w2.connect("A");
    assert.equal(w2.writerOf("s1"), "B", "A's stream opening later does not take it back");
    assert.equal(w2.refusal("s1", "A"), READ_ONLY_WORDS);
  });

  // (fails before: yes — the owner's of 11-14: a send from the window he worked in was refused, "failed", because the
  // other machine's window had taken the chat while this one looked away; only Take over here moved it)
  // A take names the session the tab shows (the review of 11-14: a chat's unread mark, a queued send of one not shown,
  // made as the person pressed something, would take over chats the window does not show and let go the one it does).
  test("a write made as the person acts in a following tab on the session it shows takes it over first; one with no act behind it, or another chat's, is refused", () => {
    const { w, said } = writers();
    w.connect("A");
    w.connect("B");
    w.open("A", "s1");
    w.open("B", "s1");
    assert.equal(w.refusal("s1", "B", { take: "s2" }), READ_ONLY_WORDS, "a take of the chat B shows is none of s1's");
    assert.equal(w.writerOf("s1"), "A");
    assert.equal(w.refusal("s1", "B", { take: "s1" }), null, "the person's write goes");
    assert.equal(w.writerOf("s1"), "B", "and B writes the session now");
    assert.equal(w.refusal("s1", "A"), READ_ONLY_WORDS, "A follows: its write with no act behind it is refused");
    assert.deepEqual(said, [["s1", "A"], ["s1", "B"]]);
    // A take on a session nobody writes claims it, so the other tabs say where it is open.
    w.open("B", "s2");
    assert.equal(w.writerOf("s1"), null);
    assert.equal(w.refusal("s1", "A", { take: "s1" }), null);
    assert.equal(w.writerOf("s1"), "A");
    assert.deepEqual(said.slice(2), [["s1", null], ["s2", "B"], ["s1", "A"]]);
    assert.equal(w.refusal("s1", "", { take: "s1" }), null, "no tab: not governed, and claims nothing");
    assert.equal(w.writerOf("s1"), "A");
  });

  // (fails before: yes — the owner's of 11-14: "even if i press Take over on mac and switch conversation then open it back
  // then Take over shows up again": the PC's idle window took the chat the moment the Mac's let it go)
  test("a session let go stays free: a peek takes it in no case, the tab that shows it again writes it", () => {
    const { w, said } = writers();
    w.connect("A");
    w.connect("B");
    w.open("A", "s1");
    w.open("B", "s1");
    w.open("A", "s2");
    assert.deepEqual(w.open("B", "s1", { peek: true }), answer("s1", null, false), "a peek takes nothing");
    assert.equal(w.writerOf("s1"), null, "s1 waits free");
    assert.deepEqual(w.open("A", "s1"), answer("s1", "A", true), "A comes back to it and writes it");
    assert.deepEqual(w.open("B", "s1", { peek: true }), answer("s1", "A", false), "a peek says who writes it");
    assert.equal(w.open("A", "s1", { peek: true }).you, true, "the writer's own peek says it writes it");
    w.open("A", "s3", { peek: true });
    assert.equal(w.writerOf("s1"), null, "a peek of another session lets the one the tab wrote go, as any open does");
    assert.equal(w.writerOf("s3"), null);
    assert.deepEqual(said, [["s1", "A"], ["s1", null], ["s2", "A"], ["s2", null], ["s1", "A"], ["s1", null]]);
  });

  // (fails before: yes — the words said "another tab" for the owner's MacBook, and nothing said where)
  test("each tab's place comes with its stream: the answers and the changes say where the writer is, and the words name another machine", () => {
    const pc = { key: "local", name: "DESKTOP-1" };
    const mac = { key: "device:d1", name: "MacBook Pro" };
    assert.deepEqual(placeOf({ kind: "local" }, "DESKTOP-1"), pc);
    assert.deepEqual(placeOf({ kind: "device", scope: "full", device: { id: "d1", name: "Filament app on MacBook Pro" } }), mac, "the app's pairing name, its machine's");
    assert.deepEqual(placeOf({ kind: "device", device: { id: "d2", name: "Safari on iPad" } }), { key: "device:d2", name: "Safari on iPad" });
    assert.deepEqual(placeOf({ kind: "device", device: { id: "d3", name: "agents", from: "MacBook Pro" } }), { key: "device:d3", name: "MacBook Pro" }, "an agents' device by its machine");
    assert.deepEqual(placeOf({ kind: "tailnet", login: "me@x" }), { key: "tailnet:me@x", name: null });
    assert.deepEqual(placeOf({ kind: "local" }), { key: "local", name: null });
    assert.equal(placeOf(null), null);

    /** @type {any[]} */
    const heard = [];
    const w = new SessionWriters();
    w.onChange = (chainId, tab, where) => heard.push([chainId, tab, where]);
    w.connect("pc1", pc);
    w.connect("pc2", pc);
    const closeMac = w.connect("mac", mac);
    w.open("mac", "s1");
    assert.deepEqual(w.open("pc1", "s1"), { chainId: "s1", writer: "mac", you: false, where: mac, here: pc });
    assert.equal(w.refusal("s1", "pc1"), "this chat is open for writing on MacBook Pro — type or send in this window to take it over");
    w.open("pc2", "s1", { take: true });
    assert.equal(w.refusal("s1", "pc1"), READ_ONLY_WORDS, "this computer's other window");
    assert.equal(w.refusal("s1", "mac"), readOnlyWords(pc, mac));
    assert.match(readOnlyWords(pc, mac), /on DESKTOP-1/);
    assert.equal(readOnlyWords({ key: "tailnet:me@x", name: null }, pc), READ_ONLY_WORDS, "a place with no name");
    closeMac();
    assert.equal(w.placeOf("mac"), null, "let go with its last stream");
    assert.deepEqual(heard, [["s1", "mac", mac], ["s1", "pc2", pc]]);
  });
});

describe("two tabs against a real app", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */ let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {string} */ let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-two-tabs-"));
    up = await fakeUpstream(() => anthropicReply("ok", { model: "brain-model" }));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });

  /** A request from a harness tab. @param {string} tab @param {string} path @param {{ method?: string, body?: any }} [o] */
  const from = (tab, path, o = {}) => shim.api(path, { ...o, headers: { "x-filament-tab": tab } });
  /** @param {string} tab @param {string | null} chainId @param {boolean} [take] */
  const openWhole = async (tab, chainId, take = false) => (await from(tab, "/api/tabs/open", { method: "PUT", body: { chainId, take } })).json();
  /** The answer's who: where each tab is is the place test's. @param {string} tab @param {string | null} chainId @param {boolean} [take] */
  const open = async (tab, chainId, take = false) => {
    const { chainId: c, writer, you } = await openWhole(tab, chainId, take);
    return { chainId: c, writer, you };
  };

  // (fails before: yes — both tabs' sends went through, and nothing said who writes)
  test("the second tab's send is refused with the words; a take swaps them; a close lets it go free", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    const feedA = readEvents(await shim.api("/api/events?tab=tabA"));
    const feedB = readEvents(await shim.api("/api/events?tab=tabB"));
    const writerSaid = () => feedB.events.filter((e) => e.data?.type === "writer" && e.data.chainId === id).map((e) => e.data.tab);
    try {
      await until(() => feedA.events.some((e) => e.data?.type === "hello") && feedB.events.some((e) => e.data?.type === "hello"), "both feeds to open");
      assert.deepEqual(await open("tabA", id), { chainId: id, writer: "tabA", you: true });
      assert.deepEqual(await open("tabB", id), { chainId: id, writer: "tabA", you: false });
      await until(() => writerSaid().length === 1, "the writer said on the feed");
      assert.deepEqual(writerSaid(), ["tabA"]);

      const turn = (/** @type {string} */ tab, /** @type {string} */ text) => from(tab, `/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: text, stream: false } });
      const refusedB = await turn("tabB", "hello from B");
      assert.equal(refusedB.status, 409);
      const body = await refusedB.json();
      assert.equal(body.error, READ_ONLY_WORDS);
      assert.equal(body.readOnly, true);
      const settingsB = await from("tabB", `/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { subagents: { pool: [{ model: "brain-small", seats: 4 }] } } } });
      assert.equal(settingsB.status, 409, "a settings write is a write");
      const compactB = await from("tabB", `/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: {} });
      assert.equal(compactB.status, 409, "so is a compaction");
      const fitStatus = await from("tabB", `/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: { status: true } });
      assert.notEqual(fitStatus.status, 409, "auto-fit's status is a read");
      const fit = await from("tabB", `/api/sessions/${encodeURIComponent(id)}/autofit`, { method: "POST", body: {} });
      assert.equal(fit.status, 409, "auto-fit's apply is a write");
      const readB = await from("tabB", `/api/sessions/${encodeURIComponent(id)}/transcript`);
      assert.equal(readB.status, 200, "reading is open to every tab");
      const okA = await turn("tabA", "hello from A");
      assert.equal(okA.status, 200, await okA.clone().text());
      const noTab = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "from a script", stream: false } });
      assert.equal(noTab.status, 200, "a request with no tab is not governed");

      assert.deepEqual(await open("tabB", id, true), { chainId: id, writer: "tabB", you: true }, "a take");
      await until(() => writerSaid().length === 2, "the take-over said");
      assert.equal((await turn("tabA", "A again")).status, 409, "A is read-only now");
      assert.equal((await turn("tabB", "B now")).status, 200);
      // Last: with no turn running, a stop reaches none — and the read-only tab may press it all the same.
      const stopA = await from("tabA", `/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" });
      assert.equal(stopA.status, 200, "Stop is open to every tab");

      await feedB.stop();
      await until(async () => (await open("tabA", id)).you === true, "B's tab closed: A takes the session back by asking");
      const seenByA = feedA.events.filter((e) => e.data?.type === "writer" && e.data.chainId === id).map((e) => e.data.tab);
      assert.ok(seenByA.includes(null), `A heard the session let go: ${JSON.stringify(seenByA)}`);
    } finally {
      await feedA.stop();
      await feedB.stop();
    }
  });

  // (fails before: yes — the owner's of 11-14: the send from the window he worked in came back "failed" with the refusal,
  // and the feed said a tab, never where it was)
  test("a send made as the person acts in the following tab goes and takes the session; the feed and the answers say where each tab is", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } });
    const id = String((await r.json()).id);
    const feedA = readEvents(await shim.api("/api/events?tab=actA"));
    const feedB = readEvents(await shim.api("/api/events?tab=actB"));
    try {
      await until(() => feedA.events.some((e) => e.data?.type === "hello") && feedB.events.some((e) => e.data?.type === "hello"), "both feeds to open");
      const first = await openWhole("actA", id);
      assert.deepEqual([first.writer, first.you, first.where?.key, first.here?.key], ["actA", true, "local", "local"], "this computer's tab, in its place");
      const followed = await openWhole("actB", id);
      assert.deepEqual([followed.writer, followed.you, followed.where?.key], ["actA", false, "local"]);
      assert.equal(followed.where.name, first.here.name, "named as the machine names itself");
      const turns = `/api/sessions/${encodeURIComponent(id)}/turns`;
      const elsewhere = await shim.api(turns, { method: "POST", body: { content: "a queued send of B's", stream: false }, headers: { "x-filament-tab": "actB", "x-filament-take": "another-chat" } });
      assert.equal(elsewhere.status, 409, "a take of the chat B shows is none of this one's");
      const typed = await shim.api(turns, { method: "POST", body: { content: "typed in B", stream: false }, headers: { "x-filament-tab": "actB", "x-filament-take": id } });
      assert.equal(typed.status, 200, await typed.clone().text());
      await typed.text();
      const heardByA = () => feedA.events.filter((e) => e.data?.type === "writer" && e.data.chainId === id).map((e) => [e.data.tab, e.data.where?.key ?? null]);
      await until(() => heardByA().some(([tab]) => tab === "actB"), "A hears B took it");
      assert.deepEqual(heardByA(), [["actA", "local"], ["actB", "local"]]);
      const fromA = await from("actA", turns, { method: "POST", body: { content: "A, by itself", stream: false } });
      assert.equal(fromA.status, 409, "A follows now: a write with no act behind it is refused");
      assert.equal((await fromA.json()).error, READ_ONLY_WORDS, "two windows of this computer: another window");
      // B shows another chat: the session is free, and A's peek takes it in no case.
      await openWhole("actB", null);
      const peek = await (await from("actA", "/api/tabs/open", { method: "PUT", body: { chainId: id, peek: true } })).json();
      assert.deepEqual([peek.writer, peek.you, peek.where], [null, false, null], "free");
    } finally {
      await feedA.stop();
      await feedB.stop();
    }
  });

  // (fails before: yes — the 11-01 report: a turn's head named no number; the page that sent it guessed one, which another
  // tab's turn could take first)
  test("a turn's head names the number the session gave it", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } });
    const id = String((await r.json()).id);
    const turn = (/** @type {string} */ text) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: text, stream: false } });
    const first = await turn("hello");
    assert.equal(first.status, 200, await first.clone().text());
    await first.text();
    const second = await turn("again");
    await second.text();
    assert.deepEqual([first.headers.get("x-filament-turn"), second.headers.get("x-filament-turn")], ["1", "2"]);
  });

  // (fails before: yes — no write route knew a tab)
  test("every write route refuses a following tab before it runs; reads, stops and forks do not", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } });
    const id = String((await r.json()).id);
    const feedA = readEvents(await shim.api("/api/events?tab=rtA"));
    const feedB = readEvents(await shim.api("/api/events?tab=rtB"));
    try {
      await until(() => feedA.events.some((e) => e.data?.type === "hello") && feedB.events.some((e) => e.data?.type === "hello"), "both feeds to open");
      await open("rtA", id);
      assert.equal((await open("rtB", id)).you, false);
      const S = `/api/sessions/${encodeURIComponent(id)}`;
      /** @type {[string, string, any?][]} */
      const writes = [
        ["POST", `${S}/turns`, { content: "x", stream: false }],
        ["PATCH", `${S}/settings`, { patch: { subagents: { pool: [{ model: "brain-small", seats: 4 }] } } }],
        ["POST", `${S}/compact`, {}],
        ["POST", `${S}/compactions/c1/undo`, {}],
        ["POST", `${S}/autofit`, {}],
        ["POST", `${S}/subagents`, { prompt: "x" }],
        ["POST", `${S}/subagents/x/detach`, {}],
        ["POST", `${S}/subagents/x/follow-up`, { text: "x" }],
        ["POST", `${S}/subagents/x/answer`, { answer: "yes" }],
        ["POST", `${S}/subagents/x/send`, {}],
        ["POST", `${S}/subagents/x/apply`, {}],
      ];
      for (const [method, path, body] of writes) {
        const res = await from("rtB", path, { method, body });
        const j = await res.json().catch(() => ({}));
        assert.deepEqual([res.status, j.readOnly, j.error], [409, true, READ_ONLY_WORDS], `${method} ${path}`);
      }
      /** @type {[string, string, any?][]} */
      const reads = [
        ["GET", `${S}/transcript`],
        ["GET", `${S}/settings`],
        ["POST", `${S}/autofit`, { status: true }],
        ["POST", `${S}/recall`, { query: "x" }],
        ["POST", `${S}/subagents/x/stop`, {}],
        ["POST", `${S}/fork`, {}],
        ["POST", `${S}/stop`],
      ];
      for (const [method, path, body] of reads) {
        const res = await from("rtB", path, { method, body });
        const j = await res.json().catch(() => ({}));
        assert.notEqual(j.readOnly, true, `${method} ${path} is open to every tab (${res.status} ${JSON.stringify(j).slice(0, 120)})`);
      }
    } finally {
      await feedA.stop();
      await feedB.stop();
    }
  });

  // (fails before: yes — a steer from any tab reached the run)
  test("a steer from a read-only tab is refused; its stop is not", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } });
    const id = String((await r.json()).id);
    const feedA = readEvents(await shim.api("/api/events?tab=steerA"));
    const feedB = readEvents(await shim.api("/api/events?tab=steerB"));
    try {
      await until(() => feedA.events.some((e) => e.data?.type === "hello") && feedB.events.some((e) => e.data?.type === "hello"), "both feeds to open");
      await open("steerA", id);
      await open("steerB", id);
      // A run of this session, as a turn's run names it: its meta's chain.
      shim.app.runs.startRun({ id: "run-two-tabs", kind: "agent-turn", title: "t", meta: { chain: id } });
      const steer = (/** @type {string} */ tab, /** @type {any} */ body) => from(tab, "/api/runs/run-two-tabs/steer", { method: "POST", body });
      const noteB = await steer("steerB", { kind: "note", text: "from B", from: "harness" });
      assert.equal(noteB.status, 409);
      assert.equal((await noteB.json()).readOnly, true);
      const noteA = await steer("steerA", { kind: "note", text: "from A", from: "harness" });
      assert.equal(noteA.status, 200, await noteA.clone().text());
      assert.equal((await noteA.json()).message.text, "from A", "the writer's note reaches the run");
      const stopB = await steer("steerB", { kind: "stop", from: "harness" });
      assert.equal(stopB.status, 200, "a stop is open to every tab");
      assert.equal((await stopB.json()).message.kind, "stop");
    } finally {
      shim.app.runs.endRun("run-two-tabs", { status: "aborted" });
      await feedA.stop();
      await feedB.stop();
    }
  });

  test("an answer to a coding agent's question from a read-only tab is refused; the writer's settles it", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "brain-model" } });
    const id = String((await r.json()).id);
    const feedA = readEvents(await shim.api("/api/events?tab=askA"));
    const feedB = readEvents(await shim.api("/api/events?tab=askB"));
    try {
      await until(() => feedA.events.some((e) => e.data?.type === "hello") && feedB.events.some((e) => e.data?.type === "hello"), "both feeds to open");
      await open("askA", id);
      await open("askB", id);
      shim.app.runs.startRun({ id: "run-two-tabs-ask", kind: "agent-turn", title: "t", meta: { chain: id } });
      const waiting = shim.app.runs.awaitAnswer("run-two-tabs-ask", "q1");
      const answer = (/** @type {string} */ tab) => from(tab, "/api/runs/run-two-tabs-ask/answer", { method: "POST", body: { ask: "q1", outcome: "skipped" } });
      const fromB = await answer("askB");
      assert.equal(fromB.status, 409);
      const body = await fromB.json();
      assert.equal(body.readOnly, true);
      assert.equal(body.error, READ_ONLY_WORDS);
      const fromA = await answer("askA");
      assert.equal(fromA.status, 200, await fromA.clone().text());
      assert.deepEqual(await waiting, { outcome: "skipped", answers: undefined, reason: undefined }, "the writer's answer reaches the run");
    } finally {
      shim.app.runs.endRun("run-two-tabs-ask", { status: "aborted" });
      await feedA.stop();
      await feedB.stop();
    }
  });
});

describe("the page's ask", () => {
  /** A send the test answers by hand. */
  const held = () => {
    /** @type {{ chainId: string | null, how: string, answer: (a: any) => void, fail: () => void }[]} */
    const asks = [];
    const send = (/** @type {string | null} */ chainId, /** @type {string} */ how) =>
      new Promise((answer, reject) => asks.push({ chainId, how, answer, fail: () => reject(new Error("offline")) }));
    return { asks, send };
  };
  const tick = () => new Promise((r) => setImmediate(r));

  // (fails before: n/a — new)
  test("one ask at a time; a newer wish waits, only the newest is sent, and only its answer is heard", async () => {
    const { asks, send } = held();
    /** @type {any[]} */
    const heard = [];
    const ask = writerClaim({ send, onAnswer: (a) => heard.push(a) });
    ask("s1");
    ask("s2");
    ask("s3");
    await tick();
    assert.deepEqual(asks.map((a) => a.chainId), ["s1"], "the first is in flight; the rest wait");
    asks[0].answer({ chainId: "s1", you: true });
    await tick();
    assert.deepEqual(asks.map((a) => a.chainId), ["s1", "s3"], "s2 was overtaken before it was sent");
    assert.deepEqual(heard, [], "s1's answer is stale: the tab shows s3 now");
    asks[1].answer({ chainId: "s3", you: false });
    await tick();
    assert.deepEqual(heard, [{ chainId: "s3", you: false }]);
  });

  // (fails before: yes — an ask was a take or not: a page could not ask who writes a session without taking it)
  test("a stronger ask made while the same session's ask waits is kept; another session's ask drops it", async () => {
    const { asks, send } = held();
    const ask = writerClaim({ send, onAnswer: () => {} });
    ask("s1");
    ask("s2", "take");
    ask("s2");
    await tick();
    assert.deepEqual(asks.map((a) => [a.chainId, a.how]), [["s1", "open"]]);
    asks[0].answer({});
    await tick();
    assert.deepEqual(asks.slice(1).map((a) => [a.chainId, a.how]), [["s2", "take"]], "a take over an open");
    ask("s2", "take");
    ask(null);
    asks[1].answer({});
    await tick();
    assert.deepEqual(asks.slice(2).map((a) => [a.chainId, a.how]), [[null, "open"]], "the tab left s2: no take-over of it");
    ask("s3", "peek");
    ask("s3", "peek");
    ask("s3");
    ask("s3", "peek");
    asks[2].answer({});
    await tick();
    assert.deepEqual(asks.slice(3).map((a) => [a.chainId, a.how]), [["s3", "open"]], "an open over a peek, and kept over a later one");
    asks[3].answer({});
    ask("s3", "peek");
    await tick();
    assert.deepEqual(asks.slice(4).map((a) => [a.chainId, a.how]), [["s3", "peek"]], "a peek alone stays one");
  });

  // (fails before: yes — nothing in the page knew the person was in it)
  test("a press or a key counts as the person acting in this page for ACT_MS", () => {
    acted(1_000_000);
    assert.equal(acting(1_000_000), true);
    assert.equal(acting(1_000_000 + ACT_MS - 1), true);
    assert.equal(acting(1_000_000 + ACT_MS), false);
    assert.ok(ACT_MS >= 2000 && ACT_MS <= 10_000, `long enough for a send's own requests, short enough to mean now: ${ACT_MS}`);
  });

  test("a failed ask is dropped, and the next ask goes", async () => {
    const { asks, send } = held();
    /** @type {any[]} */
    const heard = [];
    const ask = writerClaim({ send, onAnswer: (a) => heard.push(a) });
    ask("s1");
    await tick();
    asks[0].fail();
    await tick();
    ask("s1");
    await tick();
    assert.equal(asks.length, 2);
    asks[1].answer({ chainId: "s1", you: true });
    await tick();
    assert.deepEqual(heard, [{ chainId: "s1", you: true }]);
  });

  test("the tab id is made per load and fits the header", () => {
    assert.ok(TAB_ID.length >= 8 && TAB_ID.length <= 80, TAB_ID);
    assert.match(TAB_ID, /^[\w-]+$/);
  });
});

describe("the page names its tab and follows read-only (source contract: the page boots a DOM at import)", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
  // (fails before: yes — no request named a tab)
  test("every admin request, the turn and the events stream carry the tab", () => {
    const api = readFileSync("src/ui/harness/lib/api.js", "utf8");
    assert.match(api, /createApi\(\{ headers: \{ "x-filament-tab": TAB_ID \}, fetchImpl: \(url, init\) => pressFetch\(url, taking\(init\)\) \}\)/);
    assert.match(api, /"x-filament-sent-at": String\(Date\.now\(\)\), "x-filament-tab": TAB_ID, \.\.\.\(take \? \{ "x-filament-take": chainId \} : \{\}\)/, "the turn's request");
    assert.match(api, /if \(\/\*\* @type \{any\} \*\/ \(e\)\?\.body\?\.readOnly === true\) onReadOnly\(\);/, "a refusal heard anywhere asks again");
    assert.match(readFileSync("src/ui/harness/lib/bus.js", "utf8"), /new EventSource\(`\/api\/events\?tab=\$\{encodeURIComponent\(TAB_ID\)\}`\)/);
    assert.match(readFileSync("src/ui/lib/api.js", "utf8"), /\{ status: r\.status, body: j \}/, "the error carries its body");
  });

  // (fails before: yes — the owner's of 11-14: a send from the window he worked in was refused, and nothing in the page
  // knew he was in it)
  test("a write made as the person acts in the page names the chat on screen: its writes, never its reads nor a chat's mark, and its turn as it goes", () => {
    const api = readFileSync("src/ui/harness/lib/api.js", "utf8");
    assert.match(api, /const \{ take, \.\.\.rest \} = init;\n  const chain = take === false \|\| String\(rest\.method \|\| "GET"\)\.toUpperCase\(\) === "GET" \? "" : takeNow\(\);\n  return chain \? \{ \.\.\.rest, headers: \{ [^\n]*"x-filament-take": chain \} \} : rest;/);
    assert.match(api, /thread = false, via = null, take = !!chainId && takeNow\(\) === chainId, signal,/, "a turn reads it as it goes: a queued send of a chat not shown takes nothing");
    const tab = readFileSync("src/ui/harness/lib/tab.js", "utf8");
    assert.match(tab, /for \(const type of \["pointerdown", "keydown", "paste", "drop"\]\) \{\n[^\n]*addEventListener\?\.\(type, \(\/\*\* @type \{Event\} \*\/ e\) => e\.isTrusted && acted\(\), \{ capture: true, passive: true \}\);/, "the person's own events, before the page's handlers");
    assert.match(tab, /export const takeNow = \(now = Date\.now\(\)\) => \(acting\(now\) \? shown\(\) \|\| "" : ""\);/);
    assert.match(app, /whenShown\(\(\) => chatOf\(state\.currentId\)\?\.chainId \|\| null\);/);
    // A chat's read and unread marks: opening or seeing a chat is no act of writing it.
    const sidebar = readFileSync("src/ui/harness/sidebar.js", "utf8");
    assert.equal((sidebar.match(/\{ patch: \{ display: \{ unread: (?:true|false) \} \} \}, take: false \}/g) || []).length, 2, "the left bar's two marks");
    assert.match(app, /\{ patch: \{ display: \{ unread: false \} \} \}, take: false \}/, "and the page's");
  });

  // (fails before: yes — found on F7's hand test: a page navigated from sat in the back/forward cache with its stream
  // open, and the session stayed held by the frozen page — a probe write was still refused 300 ms after)
  // (fails before: yes — HarnessV3-Views V3's drive: the bus listened for the page's events itself and opened the
  // stream again when the page came back, while the page's other streams stayed open in the cache; the page's streams
  // are let go together now, and a page brought back loads afresh — put-away.test.js)
  test("a page put away lets its stream go with the page's others; one brought back loads afresh", () => {
    const bus = readFileSync("src/ui/harness/lib/bus.js", "utf8");
    const open = bus.slice(bus.indexOf("function open() {"), bus.indexOf("source.onmessage"));
    assert.match(open, /holdWhileShown\(\(\) => \{\s*source\?\.close\(\);\s*source = null;\s*\}\);/, "held with the stream: nothing listens at import");
    assert.doesNotMatch(bus, /addEventListener/, "the page's events are put-away.js's to hear");
  });

  // (fails before: yes — the owner's of 11-14: a let-go session was taken by the first tab to ask, the PC's idle window
  // the moment his MacBook's left it, and every reconnect claimed the chat it showed)
  test("the page asks on a switch, a birth and a (re)opened stream; a let-go session is free; a refusal only asks who writes", () => {
    // A chat being opened asks once its transcript has landed: the transcript is the first request out (chat-open-path).
    assert.match(app, /refreshStatus\(chat\);\n  \/\/ This tab now shows this chat's session \(or none\)[^\n]*\n(  \/\/[^\n]*\n)*  if \(!opening\.has\(chat\)\) claimWriting\(\);\n  paintWriting\(\);/);
    assert.match(app, /opening\.delete\(chat\);\n[^\n]*\n  if \(chatOf\(state\.currentId\) === chat\) \{\n    refreshStatus\(chat\);\n    claimWriting\(\);\n/);
    assert.match(app, /chat\.chainId = row\.id;\n  chat\.model = model;\n  if \(chat\.id === state\.currentId\) claimWriting\(\);/);
    assert.match(app, /const wrote = !feedHeard \|\| \(writing\.you && writing\.chainId === \(chatOf\(state\.currentId\)\?\.chainId \|\| null\)\);\n    if \(feedHeard\) afterFeedGap\(\);\n    feedHeard = true;\n    return claimWriting\(wrote \? "open" : "peek"\);/, "the start asks; a reconnect asks again only for a chat this window wrote");
    assert.doesNotMatch(app, /if \(!msg\.tab\) return claimWriting/, "a let-go session is taken by no tab that only shows it");
    assert.match(app, /writing = \{ chainId, you: !!msg\.tab && msg\.tab === TAB_ID, writer: msg\.tab \|\| null, where: msg\.tab \? msg\.where \?\? null : null \};\n  paintWriting\(\);/);
    assert.match(app, /return !!chainId && writing\.chainId === chainId && !writing\.you && !!writing\.writer;/, "a free session is no one's to follow");
    assert.match(app, /whenReadOnly\(\(\) => claimWriting\("peek"\)\);/);
    assert.match(app, /if \(r\.reply\.errorBody\?\.readOnly === true\) claimWriting\("peek"\);/);
    assert.match(app, /onTakeOver: \(\) => claimWriting\("take"\),/);
  });

  // (fails before: yes — every write of a following tab was refused in the page, the person's own included)
  test("in a following tab the person's own writes take the session over; what the page does by itself waits", () => {
    assert.match(app, /function followsStill\(\) \{\n  if \(!readOnlyNow\(\)\) return false;\n  if \(!acting\(\)\) return true;\n  claimWriting\("take"\);\n  return false;\n\}/);
    assert.match(app, /if \(!away && followsStill\(\)\) return refuse\(readOnlyWords\(\)\);/, "a send");
    assert.match(app, /if \(!chat\) chat = newChat\(\{ cwd: folderIn\.value\.trim\(\) \}\);\n  if \(followsStill\(\)\) return refuse\(readOnlyWords\(\)\);/, "an ask of saved agents");
    // A write it refuses says so (false): the permission switch sends no answer from a following tab (AH-F1).
    // A view-only device's page refuses it as well, in its own words (remote-view-ui.test.js).
    assert.match(app, /if \(!chat\.chainId\) return false;\n[^\n]*\n  if \(followsStill\(\) \|\| viewOnlyPage\(\)\) \{\n    toast\(viewOnlyPage\(\) \? VIEW_ONLY_WORDS : readOnlyWords\(\), "err"\);\n    applySessionView\(chat, \{ settings: \{\} \}\);[^\n]*\n    return false;/);
    assert.match(app, /if \(readOnlyNow\(\)\) return holder;/, "a waiting send waits quietly");
    // What the page does by itself goes from the tab that writes the chat alone: a free chat's windows send nothing twice
    // (the review of 11-14).
    assert.match(app, /\(writing\.chainId === chat\.chainId && !writing\.you\)\) return;/, "a note the turn left unread goes from the tab that writes it");
    assert.doesNotMatch(app, /READ_ONLY_WORDS/, "the words say where it is open");
    assert.match(app, /const openWhere = \(\) => \(writing\.where\?\.name && writing\.where\.key !== writingHere\?\.key \? `on \$\{writing\.where\.name\}` : "in another window"\);/);
    assert.match(app, /composer\.setReadOnly\(readOnlyNow\(\), `Open \$\{openWhere\(\)\} — type here to take it over`\);/);
  });

  // (fails before: yes — the bar's Take over here was the one way across, and the send stood down beside it)
  test("the composer's following face: a quiet line, no button, the send and its menu standing, Stop untouched", () => {
    assert.doesNotMatch(composer, /Take over here/);
    assert.doesNotMatch(composer, /sendBtn\.disabled = on;/);
    assert.match(composer, /modBtn\.classList\.toggle\("hidden", !on\);/, "the steer menu as in any tab: a send takes over");
    assert.match(composer, /if \(readOnly && !viewOnly && e\.isTrusted\) cb\.onTakeOver\?\.\(\);/, "typing takes it over");
    const setReadOnly = composer.slice(composer.indexOf("const setReadOnly"), composer.indexOf("\n  };\n", composer.indexOf("const setReadOnly")));
    assert.match(setReadOnly, /readOnlyBar\.classList\.toggle\("hidden", !on \|\| viewOnly\);/, "the slice is the function's own body");
    assert.doesNotMatch(setReadOnly, /stopBtn|forceBtn|sendBtn/, "Stop is open to every tab, and so is Send");
  });

  // (fails before: yes — found on F7's hand test: the hydrate appended the page's own turns after the server's, so a
  // turn another tab sent after one of this page's drew above it, and was never the open tail to follow)
  test("a hydrate keeps the turns in order when another tab's turn follows this page's", () => {
    const page = [{ n: 1, past: true }, { n: 2, mine: true }];
    const server = [{ n: 1 }, { n: 2 }, { n: 3, open: true }];
    const turns = mergedTurns(page, server);
    assert.deepEqual(turns.map((t) => t.n), [1, 2, 3]);
    assert.equal(turns[1].mine, true, "this page's own copy of turn 2 is kept");
    assert.equal(turns.at(-1).open, true, "the other tab's open turn is the tail");
  });

  // HarnessV3-FixRound decision 23. (fails before: yes — the page's copy of a turn it sent kept its empty boundary list,
  // and the server's copy of the turn before had let the row go, so the row vanished on Reload session or a catch-up)
  test("a hydrate gives a turn this page sent the server's boundary rows, and keeps its own the server has no copy of yet", () => {
    const arrival = { type: "subagent", event: "arrival", agentId: "sa_1", exchange: 0, afterTurn: 1, carriedBy: 2 };
    const ran = { type: "settings", beforeTurn: 3, from: "a", to: "b", at: 1 };
    const page = [
      { n: 1, past: true, boundaries: [], boundariesAfter: [{ ...arrival, carriedBy: undefined }] },
      { n: 2, mine: true, boundaries: [], boundariesAfter: [] },
      { n: 3, mine: true, boundaries: [ran], boundariesAfter: [] },
    ];
    const server = [{ n: 1, boundaries: [], boundariesAfter: [] }, { n: 2, boundaries: [arrival], boundariesAfter: [] }, { n: 3, open: true, boundaries: [], boundariesAfter: [] }];
    const turns = mergedTurns(page, server);
    assert.deepEqual(turns.map((t) => [t.n, t.boundaries.length, t.boundariesAfter.length]), [[1, 0, 0], [2, 1, 0], [3, 1, 0]]);
    assert.equal(turns[1].mine, true, "this page's copy of turn 2 is kept");
    assert.equal(turns[1].boundaries[0], arrival, "with the server's row, and what it learned");
    assert.equal(turns[2].boundaries[0], ran, "a running turn's settings change is stamped when it ends: the page's row stands");
    const again = mergedTurns(turns, [...server.slice(0, 2), { n: 3, boundaries: [{ ...ran, at: 2 }], boundariesAfter: [] }]);
    assert.deepEqual(again[2].boundaries.map((/** @type {any} */ b) => b.at), [2], "once the server has it, one row: the server's");
    // The rows after the newest turn are the server's too: a report that arrived after the page's own last turn.
    const after = { type: "subagent", event: "arrival", agentId: "sa_2", exchange: 0, afterTurn: 2 };
    const tail = mergedTurns([{ n: 2, mine: true, boundaries: [], boundariesAfter: [] }], [{ n: 2, boundaries: [], boundariesAfter: [after] }]);
    assert.equal(tail[0].boundariesAfter[0], after, "the server's row after the page's own last turn");
    // Two rows of one sub-agent are one row only when they are the same exchange's same event.
    const launch = { type: "subagent", event: "dispatch", agentId: "sa_4", exchange: 0, afterTurn: 2 };
    const followUp = { type: "subagent", event: "arrival", agentId: "sa_4", exchange: 1, afterTurn: 2 };
    const both = mergedTurns([{ n: 2, mine: true, boundaries: [], boundariesAfter: [launch, followUp] }], [{ n: 2, boundaries: [], boundariesAfter: [{ ...launch }] }]);
    assert.deepEqual(both[0].boundariesAfter.map((/** @type {any} */ b) => `${b.event}:${b.exchange}`), ["dispatch:0", "arrival:1"], "the page's row the server has no copy of stays");
    // A row the page placed after its turn as it ended is the server's before the next turn once there is one: one row.
    // (A `/trim now` inside turn 174; a coding agent's own compaction in the middle of a turn stays on that turn.)
    const trimmed = { type: "compaction", method: "summary", afterTurn: 174, fromTurn: 1, toTurn: 170, detail: null };
    const moved = mergedTurns(
      [{ n: 174, mine: true, boundaries: [], boundariesAfter: [trimmed] }, { n: 175, mine: true, boundaries: [], boundariesAfter: [] }],
      [{ n: 174, boundaries: [], boundariesAfter: [] }, { n: 175, boundaries: [{ ...trimmed }], boundariesAfter: [] }],
    );
    assert.deepEqual(moved.map((t) => [t.n, t.boundaries.length, t.boundariesAfter.length]), [[174, 0, 0], [175, 1, 0]]);
  });

  // (fails before: yes — another tab's turn was drawn only on a reload)
  test("another tab's turn is drawn as it runs, onto its own row", () => {
    assert.match(app, /if \(msg\.holder\?\.window === "harness" && !chat\.live\) followElsewhere\(chat\);/);
    assert.match(app, /if \(following && \(!tr\.live\.window \|\| tr\.live\.window === "harness"\)\) followLiveTurn\(chat, tr\.live\);/, "only the open tail is followed");
    assert.match(app, /if \(chat\.live \|\| chat\.view\?\.holder\?\.window !== "harness"\) return;/, "reads until the turn is followed or over");
  });
});
