// @ts-check
// What only the page sees, kept with the session (the filament-agent plan's Phase 4b): the page's toasts, the error it
// drew on a turn and its status line (the live view lost) go to the server, which keeps them on the session, each text
// sealed as a message of its own; an agent reads them with a load's `page` view, where the person had to describe
// them or paste a screenshot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keepPageSaid, pageSaid, toastSaid } from "../src/ui/harness/lib/page-said.js";
import { LIVE_LOST_WORDS } from "../src/ui/harness/conversation/timeline.js";
import { executeMemoryTool, memoryToolDefs } from "../src/app/memory-tools.js";
import { startApp } from "./helpers/app.js";
import { gate } from "./helpers/wait.js";

// (fails before: yes — the page kept nothing of what it said; a toast was gone in six seconds)
test("the page's words go with their chat, gathered; while the server can't be reached they wait and go in order; a refusal drops them", async () => {
  /** @type {any[]} */
  const posts = [];
  let tries = 0;
  /** @type {null | "network" | number} */
  let fail = null;
  /** @type {string | null} */
  let open = "c1";
  /** A line the page says while a post is out. @type {string | null} */
  let during = null;
  /** @type {ReturnType<typeof gate> | null} */
  let held = null;
  let clock = 1000;
  const k = keepPageSaid({
    chainNow: () => open,
    post: async (id, lines) => {
      tries++;
      if (during) toastSaid(during);
      during = null;
      if (held) await held.promise;
      if (fail === "network") throw new TypeError("fetch failed");
      if (fail) throw Object.assign(new Error("no such session"), { status: fail });
      posts.push([id, lines.map((l) => `${l.at} ${l.kind}: ${l.text}`)]);
    },
    now: () => clock++,
    wait: 60_000,
    retry: 60_000,
    most: 3,
  });
  const texts = () => k.held.get("c1")?.map((l) => l.text);
  try {
    toastSaid("Task renamed");
    toastSaid("the turn could not be stopped", "err");
    toastSaid("   ");
    pageSaid("status", LIVE_LOST_WORDS, "c2");
    pageSaid("error", "fetch failed", ""); // a chat with no session yet
    open = null;
    toastSaid("no chat open");
    await k.flush();
    assert.deepEqual(posts, [
      ["c1", ["1000 note: Task renamed", "1001 error: the turn could not be stopped"]],
      ["c2", ["1002 status: Live view lost — reconnecting…"]],
    ]);
    posts.length = 0;
    open = "c1";
    fail = "network";
    during = "two";
    toastSaid("one");
    await k.flush();
    assert.deepEqual(texts(), ["one", "two"], "kept, and a line said while it was out after it");
    fail = null;
    await k.flush();
    assert.deepEqual(posts.map((/** @type {any} */ [id, lines]) => [id, lines.map((/** @type {string} */ l) => l.split(" ").at(-1))]), [["c1", ["one", "two"]]], "posted once the server answers, in the order said");
    fail = "network";
    for (const w of ["a", "b", "c", "d"]) toastSaid(w);
    assert.deepEqual(texts(), ["b", "c", "d"], "the newest few of a chat wait");
    during = "e";
    await k.flush();
    assert.deepEqual(texts(), ["c", "d", "e"], "and after a post that failed, still the newest few");
    fail = 404;
    await k.flush();
    assert.equal(k.held.size, 0, "the server read them and said no: dropped");
    // One post at a time: a flush while one is out leaves its lines for after it.
    fail = null;
    held = gate();
    toastSaid("slow");
    const out = k.flush();
    toastSaid("next");
    const before = tries;
    await k.flush();
    assert.equal(tries, before, "nothing posted beside the one out");
    held.open();
    held = null;
    await out;
    await k.flush();
    assert.deepEqual(posts.slice(-2).map((/** @type {any} */ [, lines]) => lines.map((/** @type {string} */ l) => l.split(" ").at(-1))), [["slow"], ["next"]]);
    k.stop();
    toastSaid("after stop");
    assert.equal(k.held.size, 0);
  } finally {
    k.stop();
  }
});

// (fails before: yes — nothing sent the page's words)
test("the lines go by themselves: a moment after they are said, and a while after the server could not be reached", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  /** @type {string[]} */
  const got = [];
  let tries = 0;
  let down = true;
  const k = keepPageSaid({
    chainNow: () => "c1",
    post: async (_id, lines) => {
      tries++;
      if (down) {
        down = false;
        throw new TypeError("fetch failed");
      }
      got.push(...lines.map((l) => l.text));
    },
    wait: 1000,
    retry: 5000,
  });
  const settle = () => new Promise((r) => setImmediate(r));
  try {
    toastSaid("by itself");
    t.mock.timers.tick(999);
    await settle();
    assert.equal(tries, 0, "not before a moment has passed");
    t.mock.timers.tick(1);
    await settle();
    assert.equal(tries, 1, "a moment after");
    t.mock.timers.tick(4999);
    await settle();
    assert.equal(tries, 1, "not again before the retry's while");
    t.mock.timers.tick(1);
    await settle();
    assert.deepEqual([tries, got], [2, ["by itself"]]);
  } finally {
    k.stop();
  }
});

// (fails before: yes — a reload lost every line still waiting for the server)
test("lines still waiting when the page reloads are kept in the tab's store, and the reloaded page posts them", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  /** @type {Map<string, string>} */
  const m = new Map();
  const store = {
    getItem: (/** @type {string} */ k) => m.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => void m.set(k, String(v)),
    removeItem: (/** @type {string} */ k) => void m.delete(k),
  };
  /** @type {any[]} */
  const posts = [];
  let down = true;
  const post = async (/** @type {string} */ id, /** @type {any[]} */ lines) => {
    if (down) throw new TypeError("fetch failed");
    posts.push([id, lines.map((l) => [l.kind, l.text])]);
  };
  const settle = () => new Promise((r) => setImmediate(r));
  const before = keepPageSaid({ chainNow: () => "c1", post, wait: 1000, retry: 5000, store });
  try {
    toastSaid("could not reach Filament", "err");
    t.mock.timers.tick(1000);
    await settle();
    toastSaid("said just before the reload");
  } finally {
    before.stop(); // the page goes: reloaded
  }
  assert.equal(m.size, 1, "kept in the tab's store");
  down = false;
  const after = keepPageSaid({ chainNow: () => "c1", post, wait: 1000, retry: 5000, store });
  try {
    t.mock.timers.tick(1000);
    await settle();
    assert.deepEqual(posts, [["c1", [["error", "could not reach Filament"], ["note", "said just before the reload"]]]], "the reloaded page posts them by itself");
    assert.equal(m.size, 0, "and the store is cleared");
  } finally {
    after.stop();
  }
  for (const junk of ["{not json", "[1, [\"c1\"]]"]) {
    m.set("filament.pageSaid", junk);
    const odd = keepPageSaid({ chainNow: () => "c1", post, store });
    try {
      assert.equal(odd.held.size, 0, "a store it can't read starts it empty");
    } finally {
      odd.stop();
    }
  }
  const full = keepPageSaid({ chainNow: () => "c1", post, store: { ...store, setItem: () => { throw new Error("QuotaExceededError"); } } });
  try {
    toastSaid("a full store");
    assert.deepEqual(full.held.get("c1")?.map((l) => l.text), ["a full store"], "a store that refuses: the line stays in the page");
  } finally {
    full.stop();
  }
});

// (fails before: yes — no route took them, and the session kept no word of the page's)
test("the session keeps what the page said, sealed; a load's page view reads it oldest first, the oldest dropped to fit", async () => {
  const shim = await startApp({ memory: true });
  try {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir } });
    assert.equal(s.status, 200, await s.clone().text());
    const id = String((await s.json()).id);
    const memory = /** @type {any} */ (shim.app).memory;
    const scope = memory.scope({ role: "model", chain: id });
    assert.equal(await executeMemoryTool(scope, "filament_memory_load", { session: "current", view: "page" }), "(nothing the page said is kept for this session)");

    const at = Date.UTC(2026, 9, 9, 14, 2, 11);
    const before = Date.now();
    const page = (/** @type {any} */ body) => shim.api(`/api/sessions/${id}/page`, { method: "POST", body });
    const r = await page({
      lines: [
        { at, kind: "status", text: LIVE_LOST_WORDS },
        { at: at + 1000, kind: "error", text: "fetch failed" },
        { at: at + 2000, kind: "shout", text: "no such kind" },
        { at: at + 3000, kind: "note", text: "   " },
        { at: "2026-10-09T14:00:00Z", kind: "note", text: "a time as words" },
        { at: 1e20, kind: "note", text: "a time no date holds" },
      ],
    });
    assert.deepEqual(await r.json(), { kept: 4 });
    const kept = memory.archive.getChain(id).meta.pageSaid;
    assert.deepEqual(kept.slice(0, 2).map((/** @type {any} */ l) => [l.at, l.kind]), [[at, "status"], [at + 1000, "error"]]);
    assert.ok(kept.slice(2).every((/** @type {any} */ l) => l.at >= before && l.at <= Date.now()), "a time the page gave wrong is the server's");
    assert.ok(!JSON.stringify(memory.archive.getChain(id).meta).includes("fetch failed"), "the words are messages of their own, never the session's plain meta");

    const out = await executeMemoryTool(scope, "filament_memory_load", { session: "current", view: "page" });
    const lines = out.split("\n");
    assert.deepEqual(lines.slice(0, 3), ["### What the page told the user (UTC, oldest first)", "- 2026-10-09 14:02:11 status: Live view lost — reconnecting…", "- 2026-10-09 14:02:12 error: fetch failed"]);
    assert.match(lines[3], /^- \d{4}-\d\d-\d\d \d\d:\d\d:\d\d note: a time as words$/);

    const long = "x".repeat(1500);
    assert.deepEqual(await (await page({ lines: [{ at, kind: "note", text: long }, ...Array.from({ length: 104 }, (_, i) => ({ at: at + i * 1000, kind: "note", text: `line ${i}` }))] })).json(), { kept: 100 });
    const all = memory.archive.render(id, { view: "page", budgetTokens: 100_000 });
    assert.deepEqual([all.total, all.text.split("\n")[1]], [100, "- 2026-10-09 14:02:15 note: line 4"], "a post's newest 100, and the session's newest 100");
    await page({ lines: [{ at, kind: "note", text: long }] });
    const after = memory.archive.render(id, { view: "page", budgetTokens: 100_000 });
    assert.deepEqual([after.total, after.text.split("\n")[1], after.text.split("\n").at(-1)], [100, "- 2026-10-09 14:02:16 note: line 5", `- 2026-10-09 14:02:11 note: ${"x".repeat(1000)}`], "the oldest go first; a line's first 1000 characters");
    const tight = memory.archive.render(id, { view: "page", budgetTokens: 300 });
    assert.equal(tight.lines + tight.dropped, 100);
    assert.ok(tight.dropped > 0 && tight.text.includes(`(${tight.dropped} earlier lines omitted)`) && tight.text.endsWith("x".repeat(1000)), "the newest kept, the oldest dropped to fit");

    assert.equal((await shim.api("/api/sessions/nope/page", { method: "POST", body: { lines: [] } })).status, 404);
    assert.equal((await page({ text: "no list" })).status, 400);
    const load = memoryToolDefs("anthropic").find((d) => d.name === "filament_memory_load");
    assert.ok(load?.input_schema.properties.view.enum.includes("page"));
    assert.match(String(load?.input_schema.properties.view.description), /page: what Filament's page told the user/);
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — nothing on the page said its words anywhere but the screen)
test("the harness says its words where they are shown: every toast, the error drawn on a turn, the live view lost once", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const ui = readFileSync("src/ui/harness/lib/ui.js", "utf8");
  const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  assert.match(app, /toastTimer = setTimeout\(\(\) => \(toastEl\.className = "toast"\), kind === "err" \? 6000 : 3200\);\n  toastSaid\(msg, kind\);\n\}/);
  // A toast with an action (S5d) stays longer; it says its words the same.
  assert.match(ui, /window\.setTimeout\(gone, o\.ms \?\? \(a \? TOAST_ACTION_MS : kind === "err" \? 6000 : 3000\)\);\n  toastSaid\(msg, kind\);\n\}/);
  assert.match(app, /keepPageSaid\(\{[\s\S]{0,200}chatOf\(state\.currentId\)\?\.chainId[\s\S]{0,120}post: \(chainId, lines\) => api\(`\/sessions\/\$\{encodeURIComponent\(chainId\)\}\/page`, \{ method: "POST", body: \{ lines \} \}\),\n  store: sessionStorage,\n\}\);/);
  assert.equal(app.match(/if \(!turn\.liveLost\) pageSaid\("status", LIVE_LOST_WORDS, String\(chat\.chainId \|\| ""\)\);\n\s+transcript\.liveLost\(turn, true\);/g)?.length, 2, "both watchdogs, on the loss");
  assert.match(app, /\} finally \{\n    letGo\(\);\n  \}\n.*\n  if \(turn\.status === "error" && turn\.error\) pageSaid\("error", turn\.error, String\(chat\.chainId \|\| ""\)\);/);
  assert.match(timeline, /h\("span", \{\}, LIVE_LOST_WORDS\)/);
});
