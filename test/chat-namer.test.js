// @ts-check
// Chats named by the side model (Settings › Experimental, `experimental.nameChats`; the owner's of 11-05): as a chat's
// first message is sent (the owner's of 11-06), memory's cheap model reads about 1K tokens of it and names it — only a chat Filament named
// from its first message (the archive's `autoNamed`), and once; a name of the person's stands. The name, the namer over a
// scripted memory, the archive's mark, and end to end through Filament with a fake provider.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Archive } from "../src/services/memory/archive.js";
import { NAME_CHARS, NAME_MAX, NAME_PROMPT, NAME_TRIES, FIRST_TURNS, cleanName, createChatNamer, nameInput } from "../src/app/chat-namer.js";
import { sessionStartBody } from "../src/ui/harness/session-start.js";
import { startApp, fakeUpstream, anthropicReply, anthropicStream, FAKE_ACP_AGENT } from "./helpers/app.js";

const HOOK = `node "${fileURLToPath(new URL("./fixtures/hook.mjs", import.meta.url))}"`;

const user = (/** @type {string} */ text) => ({ role: "user", content: [{ type: "text", text }] });
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

describe("the name", () => {
  // (fails before: yes — no such thing: the owner's of 11-05)
  test("the side model's answer as a name: its first line with words, without a label, quotes, marks or a full stop, cut at a word", () => {
    assert.deepEqual([
      cleanName("Fixing the login bug"),
      cleanName("\n\nTitle: \"Fixing the login bug.\"\nmore"),
      cleanName("**Login bug fix**"),
      cleanName("# Login bug"),
      cleanName("「ログインのバグ」"),
      cleanName(""),
      cleanName("..."),
    ], ["Fixing the login bug", "Fixing the login bug", "Login bug fix", "Login bug", "ログインのバグ", null, null]);
    const long = cleanName("word ".repeat(30)) || "";
    assert.ok(long.length <= NAME_MAX && !long.endsWith(" ") && long.endsWith("word"), long);
    // (fails before: yes — every underscore went, "**Title:**" alone on its line named nothing, a label took a hyphen,
    // and a model's inline thinking was the name; found by the review of 7b4899baa)
    assert.deepEqual([
      cleanName("Fix parse_args crash"),
      cleanName("`parse_args` crash on Windows"),
      cleanName("**Title:**\nLogin bug fix"),
      cleanName("Name-mangling bug"),
      cleanName("<think>The person asks about a login bug.</think>\nLogin bug fix"),
      cleanName("_Login bug_"),
      cleanName("<think>never closed"),
    ], ["Fix parse_args crash", "parse_args crash on Windows", "Login bug fix", "Name-mangling bug", "Login bug fix", "Login bug", null]);
  });

  test("what the side model reads: the first message, then the answer, within about 1K tokens", () => {
    assert.equal(nameInput("fix the login bug", "Done: the token was stale."), "The person's first message:\nfix the login bug\n\nThe answer:\nDone: the token was stale.");
    const big = nameInput("a".repeat(9000), "b".repeat(9000));
    const [asked, answer] = big.split("\n\nThe answer:\n");
    assert.ok(big.length <= NAME_CHARS + 80, String(big.length));
    assert.ok(asked.endsWith(`${"a".repeat(2666)} …`) && answer === `${"b".repeat(1334)} …`, "the message takes two thirds, the answer the rest, each cut");
    assert.ok(nameInput("hi", "b".repeat(9000)).includes("b".repeat(NAME_CHARS - 2)), "the answer takes what the message leaves");
    // (fails before: yes — the owner's of 11-06: a name was read only once there was an answer) As the message is sent,
    // the message alone, the whole room its own.
    assert.equal(nameInput("fix the login bug"), "The person's first message:\nfix the login bug");
    assert.equal(nameInput("a".repeat(9000), ""), `The person's first message:\n${"a".repeat(NAME_CHARS)} …`);
    assert.match(NAME_PROMPT, /the chat's name alone/);
  });
});

describe("the namer", () => {
  /**
   * A memory whose archive holds one chat, `c1`, its first exchange answered — or the turns `turns` names, their messages
   * in `messages`. `kept`: Memory settings leave it out; `learn`: its privacy's `learn`.
   * @param {{ meta?: Record<string, any>, side?: string, answer?: () => Promise<string>, turns?: any[], messages?: Record<string, any>,
   *   kept?: boolean, learn?: boolean, learnFrom?: string, metaThrows?: boolean }} [o]
   */
  const memoryOf = (o = {}) => {
    /** @type {Record<string, any>} */
    const meta = { autoNamed: true, ...(o.meta || {}) };
    /** @type {any[]} */
    const calls = [];
    /** @type {any[]} */
    const titles = [];
    const messages = /** @type {Record<string, any>} */ ({ u1: user("fix the login bug"), f1: { role: "assistant", content: [{ type: "text", text: "Done: the token was stale." }] }, ...(o.messages || {}) });
    const turns = o.turns || [{ n: 1, user_hash: "u1", final_hash: "f1", meta: null }];
    const archive = {
      metaOf: (/** @type {string} */ id, /** @type {string[]} */ keys) => {
        if (o.metaThrows) throw new Error("database is locked");
        return id === "c1" ? Object.fromEntries(keys.filter((k) => k in meta).map((k) => [k, meta[k]])) : null;
      },
      getTurns: (/** @type {string} */ _id, /** @type {any} */ b) => turns.filter((t) => b?.to == null || t.n <= b.to),
      newestTurnN: () => Math.max(0, ...turns.map((t) => t.n)),
      getMessage: (/** @type {string} */ h) => (messages[h] ? { message: messages[h] } : null),
      setTitle: (/** @type {string} */ id, /** @type {string} */ t) => void titles.push([id, t]),
      mergeMeta: (/** @type {string} */ id, /** @type {any} */ patch) => {
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete meta[k]; else meta[k] = v;
      },
    };
    const memory = {
      archive,
      keptToItself: () => !!o.kept,
      // All chats' privacy.learn is memory's learning switch: only the chat's own, or its project's, keeps it private.
      docFor: () => ({ flat: { "privacy.learn": o.learn ?? true }, sources: { "privacy.learn": o.learnFrom || "global" } }),
      modelFor: () => ({ model: o.side ?? "cheap-1", from: "memory" }),
      callModel: async (/** @type {any} */ a) => (calls.push(a), o.answer ? o.answer() : "Fixing the login bug."),
    };
    return { memory, meta, calls, titles };
  };
  /** @param {ReturnType<typeof memoryOf>} m @param {boolean} [on] */
  const namerOf = (m, on = true) => {
    /** @type {any[]} */
    const said = [];
    /** @type {string[]} */
    const logged = [];
    const sw = { on };
    const namer = createChatNamer({ config: () => ({ experimental: { nameChats: sw.on } }), memory: () => m.memory, publish: (msg) => void said.push(msg), log: (_l, s) => void logged.push(s) });
    return { namer, said, logged, sw };
  };

  // (fails before: yes — no such thing: the owner's of 11-05)
  test("on, a chat Filament named from its first message: the side model reads its first exchange and names it, once; the name is said", async () => {
    const m = memoryOf();
    const n = namerOf(m);
    n.namer.turnFinished({ chainId: "c1" });
    await settle();
    assert.deepEqual(m.calls.map((c) => [c.system, c.user, c.purpose, c.chainId]), [[NAME_PROMPT, nameInput("fix the login bug", "Done: the token was stale."), "title", "c1"]]);
    assert.deepEqual([m.titles, m.meta.autoNamed, n.said], [[["c1", "Fixing the login bug"]], undefined, [{ type: "named", chainId: "c1", title: "Fixing the login bug" }]]);
    n.namer.turnFinished({ chainId: "c1" });
    await settle();
    assert.equal(m.calls.length, 1, "named once: the mark is spent");
  });

  // (fails before: yes — the owner's of 11-06: a chat was named only once its turn had ended)
  test("as the first message is sent: named from the message alone, while the turn runs; a try that failed is made again at its end, with the answer", async () => {
    const m = memoryOf({ turns: [{ n: 1, user_hash: "u1", final_hash: null, meta: null }] });
    const n = namerOf(m);
    n.namer.messageSent({ chainId: "c1" });
    await settle();
    assert.deepEqual([m.calls.map((c) => c.user), m.titles], [[nameInput("fix the login bug")], [["c1", "Fixing the login bug"]]]);
    n.namer.turnFinished({ chainId: "c1" });
    await settle();
    assert.equal(m.calls.length, 1, "the turn's end asks nothing more");
    let fail = true;
    const turns = [{ n: 1, user_hash: "u1", final_hash: /** @type {string | null} */ (null), meta: null }];
    const again = memoryOf({ turns, answer: async () => { if (fail) throw new Error("boom"); return "Login bug"; } });
    const a = namerOf(again);
    a.namer.messageSent({ chainId: "c1" });
    await settle();
    fail = false;
    turns[0].final_hash = "f1";
    a.namer.turnFinished({ chainId: "c1" });
    await settle();
    assert.deepEqual([again.calls.map((c) => c.user), again.titles], [[nameInput("fix the login bug"), nameInput("fix the login bug", "Done: the token was stale.")], [["c1", "Login bug"]]]);
  });

  test("never: off, no side model, one the person named, one renamed while the side model wrote, two asks at once", async () => {
    for (const [why, m, on] of /** @type {[string, ReturnType<typeof memoryOf>, boolean][]} */ ([
      ["off", memoryOf(), false],
      ["no side model", memoryOf({ side: "" }), true],
      ["the person's name", memoryOf({ meta: { autoNamed: undefined } }), true],
    ])) {
      namerOf(m, on).namer.turnFinished({ chainId: "c1" });
      await settle();
      assert.deepEqual([m.calls.length, m.titles], [0, []], why);
    }
    /** @type {(s: string) => void} */
    let answer = () => {};
    const m = memoryOf({ answer: () => new Promise((r) => (answer = r)) });
    const n = namerOf(m);
    n.namer.turnFinished({ chainId: "c1" });
    n.namer.turnFinished({ chainId: "c1" });
    await settle();
    assert.equal(m.calls.length, 1, "one ask at a time");
    delete m.meta.autoNamed; // the person renamed it meanwhile (memory's display.title mirror)
    answer("Login bug");
    await settle();
    assert.deepEqual([m.titles, n.said], [[], []], "the person's name stands");
  });

  test("a side model that fails is said in the log, and the chat is named at a later turn's end", async () => {
    let fail = true;
    const m = memoryOf({ answer: async () => { if (fail) throw new Error("boom"); return "Login bug"; } });
    const n = namerOf(m);
    n.namer.turnFinished({ chainId: "c1" });
    await settle();
    assert.deepEqual([m.titles, n.logged], [[], ["chat names: c1 was not named by memory's model (boom)"]]);
    fail = false;
    n.namer.turnFinished({ chainId: "c1" });
    await settle();
    assert.deepEqual(m.titles, [["c1", "Login bug"]]);
  });

  // (fails before: yes — the mark stayed after every failure and every answer that named nothing, so each turn of the
  // chat asked the side model again, a paid call each, for ever; found by the review of 7b4899baa)
  test(`asked ${NAME_TRIES} times at most: past them, failed or named nothing, the chat keeps its name and is asked no more`, async () => {
    let k = 0;
    const m = memoryOf({ answer: async () => { if (k++ === 0) throw new Error("no route"); return "**Title:**"; } });
    const n = namerOf(m);
    for (let i = 0; i < 4; i++) {
      n.namer.turnFinished({ chainId: "c1" });
      await settle();
    }
    assert.equal(m.calls.length, NAME_TRIES);
    assert.deepEqual([m.titles, m.meta.autoNamed, m.meta.nameTries], [[], undefined, undefined], "the mark went");
    assert.deepEqual(n.logged, ["chat names: c1 was not named by memory's model (no route)", `chat names: c1 was not named by memory's model (its answer named nothing): it keeps its name after ${NAME_TRIES} tries`]);
  });

  // (fails before: yes — a chat Memory settings leave out, or kept from learning, had its first exchange sent to the side
  // model, whose provider may be another than the chat's; found by the review of 7b4899baa)
  test("a chat kept from memory is never read: Memory settings leave it out, or it or its project keeps it from learning; memory's learning off is no matter", async () => {
    for (const [why, m] of /** @type {[string, ReturnType<typeof memoryOf>][]} */ ([
      ["left out", memoryOf({ kept: true })],
      ["the chat's privacy.learn off", memoryOf({ learn: false, learnFrom: "session" })],
      ["its project's", memoryOf({ learn: false, learnFrom: "project" })],
    ])) {
      namerOf(m).namer.turnFinished({ chainId: "c1" });
      await settle();
      assert.deepEqual([m.calls.length, m.titles, m.meta.autoNamed], [0, [], undefined], why);
    }
    const learnsNothing = memoryOf({ learn: false, learnFrom: "global" });
    namerOf(learnsNothing).namer.turnFinished({ chainId: "c1" });
    await settle();
    assert.deepEqual(learnsNothing.titles, [["c1", "Fixing the login bug"]], "all chats' value is memory's learning switch: the person's switch here stands beside it");
  });

  // (fails before: yes — the first turn with a message and an answer was read, a command Filament answered too: a chat
  // begun with /mem off was named from it; one whose first message was a file alone was never named; found by the review
  // of 7b4899baa)
  test("the exchange read: the first the person wrote words in — never a command, the agent's own turn, one rewound or kept apart; none in its first turns, it keeps its name", async () => {
    const turn = (/** @type {number} */ n, /** @type {any} */ meta) => ({ n, user_hash: `u${n}`, final_hash: `f${n}`, meta });
    const said = (/** @type {number} */ n, /** @type {string} */ text) => ({ [`u${n}`]: user(text), [`f${n}`]: { role: "assistant", content: [{ type: "text", text: `answer ${n}` }] } });
    const m = memoryOf({
      turns: [turn(1, { command: true }), turn(2, { own: true }), turn(3, { rewound: { line: 1 } }), turn(4, { apart: "left out" }), turn(5, null), turn(6, null)],
      messages: { ...said(1, "/mem off"), ...said(2, "go on"), ...said(3, "undone"), ...said(4, "private"), u5: { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } }] }, f5: { role: "assistant", content: [{ type: "text", text: "a picture" }] } },
    });
    const n = namerOf(m);
    n.namer.turnFinished({ chainId: "c1" });
    await settle();
    assert.deepEqual([m.calls.length, m.meta.autoNamed], [0, undefined], `none among its first ${FIRST_TURNS} turns: the mark goes`);
    const later = memoryOf({ turns: [turn(1, { command: true }), turn(2, null)], messages: { ...said(1, "/mem off"), ...said(2, "fix the signup page") } });
    namerOf(later).namer.turnFinished({ chainId: "c1" });
    await settle();
    assert.equal(later.calls[0]?.user, nameInput("fix the signup page", "answer 2"));
    const early = memoryOf({ turns: [turn(1, { command: true })], messages: said(1, "/mem off") });
    namerOf(early).namer.turnFinished({ chainId: "c1" });
    await settle();
    assert.deepEqual([early.calls.length, early.meta.autoNamed], [0, true], "none yet, within its first turns: the mark stays for the next");
  });

  // (fails before: yes — a switch turned off while the side model wrote still renamed the chat, and a throw before the
  // call was an unhandled rejection; found by the review of 7b4899baa)
  test("the switch turned off while it writes: the chat keeps its name; an archive that throws is said in the log", async () => {
    /** @type {(s: string) => void} */
    let answer = () => {};
    const m = memoryOf({ answer: () => new Promise((r) => (answer = r)) });
    const n = namerOf(m);
    n.namer.turnFinished({ chainId: "c1" });
    await settle();
    n.sw.on = false;
    answer("Login bug");
    await settle();
    assert.deepEqual([m.titles, n.said], [[], []]);
    const broken = namerOf(memoryOf({ metaThrows: true }));
    await broken.namer.name("c1");
    assert.deepEqual(broken.logged, ["chat names: c1 could not be named (database is locked)"]);
  });
});

describe("the archive: Filament's mark on a name it gave", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-namer-"));
  /** @type {Archive[]} */
  const opened = [];
  after(() => {
    for (const a of opened) a.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // (fails before: yes — nothing told a name Filament gave from one the person gave)
  test("a title the first message gave is marked Filament's; one given at the making is not", () => {
    let clock = 1_758_000_000_000;
    const made = new Archive({ file: join(dir, "a.db"), now: () => (clock += 1000) });
    opened.push(made);
    // Its turns' user messages, which beginTurn's options type leaves out.
    const a = /** @type {any} */ (made);
    const c = a.chainForKey("n:t1", { client: "harness" });
    a.mergeMeta(c.id, { autoTitle: true });
    a.beginTurn(c.id, { userMessage: user("fix the login bug") });
    assert.deepEqual(a.metaOf(c.id, ["autoNamed", "autoTitle"]), { autoNamed: true });
    const named = a.chainForKey("n:t2", { client: "harness" });
    a.setTitle(named.id, "Mine");
    a.mergeMeta(named.id, { autoTitle: true });
    a.beginTurn(named.id, { userMessage: user("hello") });
    assert.deepEqual(a.metaOf(named.id, ["autoNamed"]), {});
  });
});

describe("the page: the name written in", () => {
  // (fails before: yes — no such thing: the owner's of 11-05)
  test("the sidebar's row and the shown chat's header take the name from the feed and write it in; still where motion is reduced", () => {
    const read = (/** @type {string} */ p) => readFileSync(new URL(`../src/ui/${p}`, import.meta.url), "utf8");
    const sidebar = read("harness/sidebar.js");
    assert.match(sidebar, /if \(msg\?\.type === "named" && msg\.chainId && msg\.title\) \{[\s\S]*?if \(s\) s\.title = String\(msg\.title\);\n\s*justNamed\.set\(chain, \{ title: String\(msg\.title\), at: Date\.now\(\) \}\);\n\s*patchChats\(\[chain\]\);/);
    // (fails before: yes — a draw within the writing set a later delay on the row it patched in place, which set the
    // writing ahead, and a list read asked before the name came put the old name back; found by the review of 7b4899baa)
    assert.match(sidebar, /const since = namedSince\(String\(s\.id\), label\);\n\s*const title = h\("span", \{ class: `sess-title\$\{since != null \? " is-named" : ""\}` \}/, "a draw patches the row as it writes");
    assert.doesNotMatch(read("harness/now-list.js") + sidebar, /animation-delay/);
    assert.match(sidebar, /const askedAt = Date\.now\(\);[\s\S]*?state\.sessions = r\.sessions \|\| \[\];\n[^\n]*\n\s*for \(const s of state\.sessions\) \{\n\s*const n = justNamed\.get\(String\(s\.id\)\);\n\s*if \(n && n\.at >= askedAt\) s\.title = n\.title;/, "a read asked before the name keeps it");
    assert.match(sidebar, /named: namedSince,\n\s*\}\);/, "Now's rows, where a chat just finished stands, too");
    const app = read("harness/app.js");
    assert.match(app, /if \(msg\?\.type !== "named" \|\| !msg\.chainId \|\| !msg\.title\) return;[\s\S]*?chat\.title = String\(msg\.title\);\n\s*if \(chat !== chatOf\(state\.currentId\)\) return;\n\s*setTitle\(chat\);\n\s*titleEl\.classList\.add\("is-named"\);/);
    const css = read("harness.css");
    assert.ok(css.includes(".sess-title.is-named, .now-title.is-named, .c-title.is-named { animation: title-named 900ms"), "900 ms: sidebar.js NAMED_MS");
    assert.ok(css.includes("@media (prefers-reduced-motion: reduce) { .sess-title.is-named, .now-title.is-named, .c-title.is-named { animation: none; } }"));
  });
});

describe("end to end: a chat named by the side model", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */ let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */ let shim;
  /** @type {string} */ let root;
  /** While set, the chat's own model answers once it settles: its turn runs meanwhile. @type {Promise<void> | null} */
  let hold = null;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-namer-e2e-"));
    up = await fakeUpstream(async (call) => {
      const system = JSON.stringify(call.body?.system || "");
      if (system.includes("You name chats")) return anthropicStream("Fixing the login bug", { model: call.body?.model });
      if (hold) await hold;
      return call.body?.stream ? anthropicStream("on it", { model: call.body?.model }) : anthropicReply("on it", { model: call.body?.model });
    });
    shim = await startApp({
      memory: true,
      summarizer: "brain-side",
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "ag", name: "ag", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], cwdDefault: root, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }, { match: "ag/*", upstream: "ag", upstreamModel: "{1}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true });
  });
  const create = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: sessionStartBody({}, root, "brain-model") });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    await r.text();
  };
  const titleOf = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}`)).json()).identity?.title ?? null;
  /** The title once it is `want`, or as it stands after two seconds. @param {string} id @param {string} want */
  const titleComes = async (id, want) => {
    for (let i = 0; i < 40; i++) {
      const t = await titleOf(id);
      if (t === want) return t;
      await new Promise((r) => setTimeout(r, 50));
    }
    return titleOf(id);
  };
  /** @param {boolean} on */
  const nameChats = async (on) => {
    const r = await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "experimental.nameChats": on } } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  const asks = () => up.received.filter((c) => JSON.stringify(c.body?.system || "").includes("You name chats"));

  // (fails before: yes — no such thing: the owner's of 11-05)
  test("off, its first line names it; on, the side model names it at its next message; a name of the person's stands", async () => {
    const id = await create();
    await turn(id, "fix the login bug\nand add a test");
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual([await titleOf(id), asks().length], ["fix the login bug", 0], "off: the first line, and no ask");
    await nameChats(true);
    await turn(id, "and the signup page");
    assert.equal(await titleComes(id, "Fixing the login bug"), "Fixing the login bug");
    const [ask] = asks();
    assert.deepEqual([ask.body.model, ask.headers["x-filament-memory-purpose"] ?? null], ["brain-side", null], "on the side model; the purpose rides Filament's own door, not the provider's");
    assert.match(JSON.stringify(ask.body.messages), /fix the login bug\\nand add a test[\s\S]*on it/, "its first exchange");
    await turn(id, "one more");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(asks().length, 1, "named once");
    // The person's name, given before the side model could: it stands.
    const mine = await create();
    await nameChats(false);
    await turn(mine, "hello there");
    const r = await shim.api(`/api/sessions/${encodeURIComponent(mine)}/settings`, { method: "PATCH", body: { patch: { display: { title: "Mine" } } } });
    assert.equal(r.status, 200, await r.clone().text());
    await nameChats(true);
    await turn(mine, "again");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual([await titleOf(mine), asks().length], ["Mine", 1]);
  });

  // (fails before: yes — the owner's of 11-06: the side model named a chat only once its turn had ended)
  test("on: named as its first message is sent, while the turn still runs, from the message alone", async () => {
    await nameChats(true);
    const id = await create();
    /** @type {() => void} */
    let release = () => {};
    hold = new Promise((r) => (release = r));
    const sending = turn(id, "rework the parser for the new grammar");
    try {
      assert.equal(await titleComes(id, "Fixing the login bug"), "Fixing the login bug", "named while the turn runs");
      const sent = JSON.stringify(asks().at(-1)?.body?.messages);
      assert.match(sent, /rework the parser for the new grammar/);
      assert.doesNotMatch(sent, /The answer/, "no answer yet");
    } finally {
      hold = null;
      release();
      await sending;
    }
  });

  // (fails before: yes — the review of e031f8597: named as its turn began, a message a prompt-submit hook then refused had
  // gone to the side model, maybe another provider's)
  test("on: a message a hook refuses never reaches the side model", async () => {
    await nameChats(true);
    const r = await shim.api("/api/sessions", { method: "POST", body: { ...sessionStartBody({}, root, "brain-model"), settings: { hooks: [{ on: "prompt-submit", command: `${HOOK} block no secrets here` }] } } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    const before = asks().length;
    await turn(id, "my key is sk-live-123");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(asks().length, before, "the side model read nothing");
  });

  // (fails before: yes — the review of e031f8597: a coding agent's chat begun with a command Filament answers, /sessions,
  // was named from it as its turn began, the mark spent)
  test("on: a coding agent's command Filament answers never names its chat; its next message does", async () => {
    await nameChats(true);
    const r = await shim.api("/api/sessions", { method: "POST", body: sessionStartBody({}, root, "ag/fake-a") });
    assert.equal(r.status, 200, await r.clone().text());
    const id = String((await r.json()).id);
    const before = asks().length;
    await turn(id, "/sessions");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(asks().length, before, "the command named nothing");
    await turn(id, "fix the signup page");
    assert.equal(await titleComes(id, "Fixing the login bug"), "Fixing the login bug");
    const sent = JSON.stringify(asks().at(-1)?.body?.messages);
    assert.match(sent, /fix the signup page/);
    assert.doesNotMatch(sent, /\/sessions/);
  });

  // (fails before: yes — a chat begun with a command was named from it and Filament's answer, and one kept from learning
  // was read by the side model; found by the review of 7b4899baa)
  test("on: a command first is never what names it; a chat kept from learning is never read", async () => {
    await nameChats(true);
    const id = await create();
    await turn(id, "/status");
    await turn(id, "fix the signup page");
    assert.equal(await titleComes(id, "Fixing the login bug"), "Fixing the login bug");
    const sent = JSON.stringify(asks().at(-1)?.body?.messages);
    assert.match(sent, /fix the signup page/);
    assert.doesNotMatch(sent, /\/status/, "never the command");
    const before = asks().length;
    const kept = await create();
    const r = await shim.api(`/api/sessions/${encodeURIComponent(kept)}/settings`, { method: "PATCH", body: { patch: { privacy: { learn: false } } } });
    assert.equal(r.status, 200, await r.clone().text());
    await turn(kept, "the secret plans");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual([await titleOf(kept), asks().length], ["the secret plans", before]);
  });
});
