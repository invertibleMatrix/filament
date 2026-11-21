// @ts-check
// HarnessV3-Launch LD-D9 (2026-10-03): the agent loop's synthetic entry (`__agent__`) is how a turn enters the
// pipeline, not a provider, and a command Filament answers itself calls no model. The tour found Usage listing
// "__agent__ — removed" as an upstream and counting those answers as requests (9 for 6 model calls), and Home's Latest
// showing "__agent__ / null". Now Usage counts model calls alone, and the console names the entries in words.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { UsageStore } from "../src/services/records.js";
import { localDay } from "../src/services/daily-usage.js";
import { upstreamWords } from "../src/ui/lib/format.js";
import { whereWent, turnParentOf, callsByTurn, createRequestsTable } from "../src/ui/components/requests-table.js";

describe("Usage counts model calls, not the loop's way in", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-usage-synthetic-"));
    up = await fakeUpstream((call) => (call.kind === "anthropic" ? anthropicReply("all done", { model: String(call.body?.model || "m"), usage: { input_tokens: 100, output_tokens: 7 } }) : undefined));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "Acme", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  // (fails before: the command's answer was counted as a request — 4 for 3 model calls)
  test("three agent turns and a command: three model calls on the provider's row, no row for the entry or the command", async () => {
    const created = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    const id = String((await created.json()).id);
    up.reset();
    for (const content of ["one", "/help", "two", "three"]) {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(r.status, 200);
      await r.text();
    }
    const calls = up.received.filter((c) => c.kind === "anthropic").length;
    assert.equal(calls, 3, "one model call per model turn; Filament answered /help itself");
    const days = await (await shim.api("/api/usage/days?limit=3")).json();
    const rows = days.total?.rows || [];
    assert.deepEqual(rows.filter((/** @type {any} */ r) => String(r.upstream).startsWith("__")).map((/** @type {any} */ r) => r.upstream), [], "no synthetic upstream is a row of Usage");
    assert.equal(days.total.requests, calls, `Usage counts the model calls (${days.total.requests} counted for ${calls} calls)`);
    const m = rows.find((/** @type {any} */ r) => r.upstream === "m");
    assert.equal(m?.requests, calls);
    assert.equal(m?.output, 21, "and their tokens, once");
  });
});

// The days Usage keeps are counted as each record lands, through the store's filter: what a turn writes besides its
// model calls — its parent, the commands' answers, the doors' errors — is no call.
describe("the days Usage keeps count model calls alone", () => {
  const ts = new Date().toISOString();
  const today = localDay();
  const tick = { id: "t1", ts, status: "ok", model: "brain-model", upstream: "m", upstreamModel: "brain-model", source: "agent-tick", agentOf: "p1", tokens: { input: 100, output: 7 }, cost: 0.001, totalMs: 900 };
  const lines = [
    { id: "p1", ts, status: "ok", model: "agent/brain-model", upstream: "agent-loop", upstreamModel: "brain-model", source: "agent-loop", agent: { status: "done", rounds: 1 }, tokens: { input: 100, output: 7 }, cost: 0.001, totalMs: 1000 },
    tick,
    { id: "h1", ts, status: "ok", model: "agent/brain-model", upstream: "m", upstreamModel: null, memory: { command: true }, tokens: {}, totalMs: 3 },
    { id: "r1", ts, status: "ok", model: "agent/brain-model", upstream: "__agent__", upstreamModel: null, local: true, memory: { command: true }, tokens: {}, totalMs: 4 },
    { id: "e1", ts, status: "error", model: "agent/brain-model", upstream: "__agent__", upstreamModel: "brain-model", tokens: {}, totalMs: 2 },
  ];
  test("a turn's lines count as the one model call they hold: the tick alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-usage-days-"));
    const s = new UsageStore({ dataDir: dir, options: { logFile: "", broadcast: false } });
    try {
      for (const r of lines) s.dailyStore.add(r);
      const day = s.dailyStore.aggregate({ from: today, to: today });
      assert.equal(day.requests, 1, `one model call (${day.requests} counted)`);
      assert.deepEqual(day.rows.map((/** @type {any} */ r) => [r.upstream, r.requests, r.output]), [["m", 1, 7]]);
    } finally {
      await s.flush();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// (fails before: none of these existed — the table printed "__agent__ / null" and "m / null", a row per call)
describe("the console says where a request went, and draws a turn as one row", () => {
  test("Filament's own ids read in words; a provider's stays its id", () => {
    assert.equal(upstreamWords("__agent__"), "Filament agent loop");
    assert.equal(upstreamWords("agent-loop"), "Filament agent loop", "the loop turn's own record");
    assert.equal(upstreamWords("zai"), null);
    assert.equal(upstreamWords("toString"), null, "only the table's own keys");
    assert.equal(upstreamWords(null), null);
  });

  test("the upstream cell: a command went nowhere, the entry in words, a provider with its model", () => {
    assert.equal(whereWent({ upstream: "m", upstreamModel: null, memory: { command: true } }), "answered by Filament");
    assert.equal(whereWent({ upstream: "__agent__", upstreamModel: null, local: true }), "answered by Filament");
    assert.equal(whereWent({ upstream: "__agent__", upstreamModel: "brain-model", status: "error" }), "Filament agent loop / brain-model");
    assert.equal(whereWent({ upstream: "agent-loop", upstreamModel: "brain-model" }), "Filament agent loop / brain-model");
    assert.equal(whereWent({ upstream: "m", upstreamModel: "brain-model" }), "m / brain-model");
    assert.equal(whereWent({ upstream: "m", upstreamModel: null }), "m");
    assert.equal(whereWent({}), "–");
  });

  // (fails before: yes — tour2's Traffic › All still read "__agent__ /" and "agent-loop /" after LD-D9)
  test("Traffic's All view, the Live view and the request drawer say it the same way (pinned in the console's source: its shell builds real DOM)", () => {
    const src = readFileSync(new URL("../src/ui/app.js", import.meta.url), "utf8");
    /** @param {string} name */
    const fn = (name) => new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n}\\n`).exec(src)?.[0] || "";
    const mixed = fn("mixedTable");
    assert.ok(mixed, "the All view's table");
    assert.match(mixed, /it\.r\.upstream \|\| it\.r\.local \|\| it\.r\.memory\?\.command \? whereWent\(it\.r\)/, "its detail cell is the requests table's rule, a command's answer with it");
    assert.doesNotMatch(mixed, /`\$\{it\.r\.upstream\} \//, "never the bare id");
    assert.match(src, /r\.upstream \? `→ \$\{upstreamWords\(r\.upstream\) \|\| r\.upstream\}` : "routing…"/, "a live request names Filament's own way in");
    assert.match(src, /h\("span", \{\}, "upstream"\), h\("code", \{ title: d\.upstream \|\| null \}, whereWent\(d\)\)/, "the drawer says it, the id in its tooltip");
    assert.doesNotMatch(src, /`\$\{d\.upstream \|\| "–"\} \//, "never the bare id in the drawer");
  });

  test("a turn's calls fold under the turn, a sub-agent's under the sub-agent; a call whose turn is gone stands alone", () => {
    const list = [
      { id: "t2", agentOf: "p1" },
      { id: "s1t", agentOf: "s1" },
      { id: "s1", subagentOf: "p1" },
      { id: "own", subagentOf: "owner" },
      { id: "t1", agentOf: "p1" },
      { id: "p1" },
      { id: "lost", agentOf: "gone" },
    ];
    assert.equal(turnParentOf({ subagentOf: "owner" }), null, "a sub-agent launched from the side is its own");
    const kids = callsByTurn(list);
    assert.deepEqual(Object.fromEntries([...kids].map(([k, v]) => [k, v.map((r) => r.id)])), { p1: ["t2", "s1", "t1"], s1: ["s1t"] });
    const home = readFileSync("src/ui/pages/home.js", "utf8");
    assert.ok(/requestsTable\(state\.requests, \{ limit: 8 \}\)/.test(home), "Home's Latest counts turns, not records: the slice came before the fold");
    const app = readFileSync("src/ui/app.js", "utf8");
    assert.ok(/const upDisplay = \(id\) => \{ const words = upstreamWords\(id\); if \(words\) return words;/.test(app), "upDisplay (Usage, the failover trail) says them too");
  });

  // (fails before: yes — every record was a row of its own, and a limit, cut before the table, filled with one turn's calls)
  test("the table draws a turn as one row, its calls folded under it and opened on demand; a limit counts rows of their own", () => {
    const at = (/** @type {number} */ s) => new Date(Date.UTC(2026, 9, 3, 12, 0, s)).toISOString();
    const call = (/** @type {string} */ id, /** @type {number} */ s) => ({ id, ts: at(s), status: "ok", model: "brain-model", upstream: "m", upstreamModel: "brain-model", agentOf: "p1", tokens: { input: 100, output: 7 } });
    const own = (/** @type {string} */ id, /** @type {number} */ s) => ({ id, ts: at(s), status: "ok", model: "brain-model", upstream: "m", upstreamModel: "brain-model", tokens: { input: 50, output: 5 } });
    // Newest first, as the page holds them: the loop turn's two calls, the turn, then two requests of their own.
    const list = [call("t2", 9), call("t1", 8), { ...own("p1", 7), model: "agent/brain-model", upstream: "agent-loop", agent: { status: "done", rounds: 2 } }, own("c1", 6), own("c2", 5)];
    /** @type {any} */
    const state = {};
    const g = /** @type {any} */ (globalThis);
    const had = g.document;
    g.document = recordingDocument();
    try {
      const { requestsTable } = createRequestsTable(/** @type {any} */ ({ state, openRequest() {}, render() {}, api: async () => ({}), toast() {}, upDisplay: (/** @type {string} */ id) => id, empty: () => null }));
      /** The request rows, in order, a call folded under its turn marked so. @param {any} table */
      const rowsOf = (table) => elementsOf(table, (n) => n.tag === "tr" && "data-id" in n.attrs).map((n) => `${n.attrs["data-id"]}${/\bin-turn\b/.test(n.className) ? " (in the turn)" : ""}`);
      const shut = requestsTable(list, { limit: 2 });
      assert.deepEqual(rowsOf(shut), ["p1", "c1"], "two rows of their own: the turn, its calls folded under it, and the next request");
      const pills = elementsOf(shut, (n) => /\bpill\b/.test(n.className)).map(textUnder);
      assert.ok(pills.includes("2 calls"), `the turn's row says what is folded under it: ${JSON.stringify(pills)}`);
      state.foldOpen = new Set(["p1"]);
      assert.deepEqual(rowsOf(requestsTable(list, { limit: 2 })), ["p1", "t2 (in the turn)", "t1 (in the turn)", "c1"], "opened: its calls under it, the turn still one row of the limit");
      assert.deepEqual(rowsOf(requestsTable(list)), ["p1", "t2 (in the turn)", "t1 (in the turn)", "c1", "c2"], "no limit: every row");
    } finally {
      g.document = had;
    }
  });
});

/**
 * A document for ui/lib/dom.js's `h`, enough to draw a table without a browser: elements keep their class, attributes
 * and children; text is a node of its own.
 * @returns {any}
 */
function recordingDocument() {
  return {
    createElement: (/** @type {string} */ tag) => {
      /** @type {any} */
      const el = { nodeType: 1, tag, className: "", attrs: {}, kids: [] };
      el.setAttribute = (/** @type {string} */ k, /** @type {any} */ v) => { el.attrs[k] = String(v); };
      el.addEventListener = () => {};
      el.append = (/** @type {any} */ c) => { el.kids.push(c); };
      return el;
    },
    createTextNode: (/** @type {string} */ text) => ({ nodeType: 3, text }),
  };
}

/** Every element under `el`, itself first, that `ok` takes. @param {any} el @param {(n: any) => boolean} ok @param {any[]} [out] @returns {any[]} */
function elementsOf(el, ok, out = []) {
  if (el?.nodeType !== 1) return out;
  if (ok(el)) out.push(el);
  for (const k of el.kids) elementsOf(k, ok, out);
  return out;
}

/** The text under a node. @param {any} n @returns {string} */
function textUnder(n) {
  return n?.nodeType === 3 ? n.text : (n?.kids || []).map(textUnder).join("");
}
