// @ts-check
// The session store's reads and writes, made cheap without changing an answer: what a page that follows a running
// chat asks over and over (its live turn, its goal), the transcript's one-turn read, the settings a turn resolves at
// every tool call, the ledgers a model call's end writes, the sub-agents' writes, the preview a second window asks
// while the first composes it, and the one walk every sessions answer goes through.
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryService } from "../src/services/memory/index.js";
import { sidecar } from "../src/adapters/sidecar/index.js";
import { createSessions } from "../src/app/sessions/service.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";
import { Archive } from "../src/services/memory/archive.js";
import { resolveChainSettings, resolveSettings, harnessGlobalLayer, globalLayer, spaceLayerOf, derivedFor } from "../src/services/session-settings.js";
import { maskAnswer } from "../src/services/mcp-servers.js";
import { createFinish } from "../src/app/finish.js";
import { newGoal } from "../src/services/memory/goal.js";

const dir = mkdtempSync(join(tmpdir(), "filament-store-reads-"));
const folder = mkdtempSync(join(dir, "project-"));
let clock = 1_760_000_000_000;
const now = () => (clock += 1000);
/** @type {any} */
const cfg = { server: { host: "127.0.0.1" }, rules: {}, agentLoop: { permissions: "edit" }, memory: { enabled: true }, routes: [], upstreams: [], sessions: { defaults: { "context.compaction.thresholdPercent": 70 } } };
const config = { get: () => cfg };
const memory = new MemoryService(/** @type {any} */ ({ sidecar, getConfig: config.get, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20399", getModelNames: () => ["cheap"], now }));
memory.start();
// The archive is untyped JavaScript: its options read as their defaults, so it is held as any.
const archive = /** @type {any} */ (memory.archive);
const ops = { record: () => {} };
/** @param {any} [extra] */
const sessionsWith = (extra = {}) => createSessions({ memory, config, pipeline: { handle: async () => {} }, ops, log: () => {}, forkSession: async () => ({}), now, ...extra });
after(async () => {
  await memory.shutdown();
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});

/** A chat with `n` finished turns, each with a tool round, its settings hash and its composed stamp. @param {number} n */
function chatWith(n, sessions = sessionsWith()) {
  const { id } = sessions.create({ cwd: folder, model: "agent/m", preset: "plain" });
  for (let i = 1; i <= n; i++) {
    const t = archive.beginTurn(id, { requestId: `r${i}`, model: "agent/m", client: "harness", userMessage: { role: "user", content: [{ type: "text", text: `turn ${i}` }] } });
    archive.addWork(t.turnId, [
      { role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "read", input: { path: `f${i}` } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `file ${i}` }] },
    ]);
    archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: `done ${i}` }] }, requestId: `r${i}` });
    archive.mergeTurnMeta(t.turnId, { settingsHash: i <= n / 2 ? "h1" : "h2", composed: { form: "plain", turns: i - 1, shapes: Array.from({ length: i - 1 }, (_, k) => [k + 1, "raw"]) } });
  }
  return id;
}

/**
 * Calls of `name` on the archive while `fn` runs, each with what it returned.
 * @template T @param {string} name @param {() => T} fn @returns {{ value: T, calls: any[] }}
 */
function spied(name, fn) {
  /** @type {any} */
  const a = archive;
  const real = a[name];
  /** @type {any[]} */
  const calls = [];
  a[name] = (/** @type {any[]} */ ...args) => {
    const out = real.apply(a, args);
    calls.push({ args, out });
    return out;
  };
  try {
    return { value: fn(), calls };
  } finally {
    a[name] = real;
  }
}

class FakeRes {
  status = 0;
  body = "";
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  setHeader() {}
  getHeader() {}
  /** @param {number} s */
  writeHead(s) {
    this.status = s;
    this.headersSent = true;
    return this;
  }
  /** @param {string} c */
  write(c) {
    this.body += c;
  }
  end(c = "") {
    this.body += c;
    this.writableEnded = true;
  }
  on() {}
  json() {
    return JSON.parse(this.body);
  }
}

/** The sessions area's rows, asked as a page asks them. @param {any} a */
const routesOf = (a) => {
  const route = createRouter(sessionRoutes(a));
  /** @param {string} path */
  return async (path) => {
    const url = new URL(`http://x${path}`);
    const m = route("GET", url.pathname);
    assert.ok(m, `GET ${url.pathname} has a row`);
    const res = new FakeRes();
    await m.handler({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url, path: url.pathname, method: "GET", params: m.params, json: async () => ({}) }, a);
    return { status: res.status, json: res.json() };
  };
};
const usage = { forChain: () => ({ records: [], capped: false }), publicRecord: (/** @type {any} */ r) => r };

describe("the archive", () => {
  // (fails before: yes — the file synced at every commit, `synchronous` FULL)
  test("syncs at WAL checkpoints, not at every commit (synchronous NORMAL)", () => {
    assert.equal(Number(/** @type {any} */ (archive.db.prepare("PRAGMA synchronous").get()).synchronous), 1);
  });

  // (fails before: yes — there was no hasChain, chainHead or metaOf: every check read the chain whole)
  test("hasChain, chainHead and metaOf read a chain without parsing its meta", () => {
    const id = chatWith(1);
    archive.mergeMeta(id, { goal: { status: "active", text: "Ship" }, pinned: true, big: "x".repeat(100_000) });
    const parse = JSON.parse;
    let parses = 0;
    JSON.parse = /** @type {any} */ ((/** @type {any[]} */ ...args) => {
      if (String(args[0]).length > 50_000) parses++;
      return parse.apply(JSON, /** @type {any} */ (args));
    });
    try {
      assert.equal(archive.hasChain(id), true);
      assert.equal(archive.hasChain("nope"), false);
      const head = archive.chainHead(id);
      const chain = archive.getChain(id);
      assert.equal(parses, 1, "only getChain parsed the big meta");
      assert.deepEqual(head, { id, key: chain.key, project_id: chain.project_id, client: chain.client, model: chain.model, kind: "interactive", turns: 1, native: true });
      assert.ok(head?.client, "the client a chain was opened by");
      assert.deepEqual(archive.metaOf(id, ["goal", "pinned", "absent"]), { goal: { status: "active", text: "Ship" }, pinned: true });
      assert.equal(parses, 1);
    } finally {
      JSON.parse = parse;
    }
    assert.equal(archive.chainHead("nope"), null);
    assert.equal(archive.metaOf("nope", ["goal"]), null);
    assert.throws(() => archive.metaOf(id, ["a.b"]), /no meta key/);
  });

  // (fails before: yes — no chainHead)
  test("a chain's head says at once what each writer did to `native`", () => {
    const id = chatWith(0);
    assert.equal(archive.chainHead(id)?.native, true);
    archive.mergeMeta(id, { native: false });
    assert.equal(archive.chainHead(id)?.native, false, "mergeMeta");
    archive.updateMeta(id, (m) => (m.native = true));
    assert.equal(archive.chainHead(id)?.native, true, "updateMeta");
    archive.setMeta(id, { native: "yes" });
    assert.equal(archive.chainHead(id)?.native, false, "setMeta: only JSON's true counts, as `=== true` reads it");
    archive.setMeta(id, { native: true });
    assert.equal(archive.chainHead(id)?.native, true);
    archive.appendMeta(id, "native", 1, 5);
    assert.equal(archive.chainHead(id)?.native, false, "appendMeta");
    archive.mergeMeta(id, { native: true, windows: { harness: { client: "harness" } } });
    archive.beginTurn(id, { window: "h:joined", client: "opencode", userMessage: { role: "user", content: "a window joins" } });
    assert.equal(archive.chainHead(id)?.native, true, "a window's bookkeeping leaves it");
    archive.setChainModel(id, "agent/other");
    assert.equal(archive.chainHead(id)?.model, "agent/other", "the columns are read as they are");
    archive.deleteChain(id);
    assert.equal(archive.chainHead(id), null);
  });

  // (fails before: yes — no turnOutline)
  test("a turn's outline marks read as its meta does, the window by turnWindow's own rule", () => {
    const { id } = sessionsWith().create({ cwd: folder, model: "agent/m", preset: "plain" });
    const odd = [
      { client: "harness" }, { client: "opencode", composed: { a: 1 } }, { client: "opencode", composed: [] }, { client: "opencode", composed: true }, { client: "opencode", composed: false },
      { client: "opencode", composed: null }, { client: "opencode", composed: 0 }, { client: "opencode", composed: 2.5 }, { client: "opencode", composed: "" }, { client: "opencode", composed: "0" },
      { client: 5, composed: 0 }, { client: { harness: true } }, {}, { settingsHash: 7, carried: "no", rewound: "line" }, { settingsHash: "h", carried: [{ agentId: "a", exchange: 1, kind: "report" }], rewound: { line: "L" } },
      { command: true }, { command: false }, { command: 0 }, { command: "" }, { command: "0" }, { command: {} }, { command: [] }, { command: null },
    ];
    for (const meta of odd) {
      const t = archive.beginTurn(id, { userMessage: { role: "user", content: "x" } });
      /** @type {any} */ (archive).db.prepare("UPDATE turns SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), t.turnId);
    }
    const t = archive.beginTurn(id, { userMessage: { role: "user", content: "x" } });
    /** @type {any} */ (archive).db.prepare("UPDATE turns SET meta_json = ? WHERE id = ?").run("{not json", t.turnId);
    // The newest request of each, as the turn's `requestIds` list ends: one, a retry's after it, none, a list that is none.
    archive.beginTurn(id, { requestId: "only", userMessage: { role: "user", content: "only" } });
    const lists = ['["first","retry"]', "[]", "[7]", '"r"', "{not json", null];
    const begun = lists.map((_, i) => archive.beginTurn(id, { requestId: `x${i}`, userMessage: { role: "user", content: `list ${i}` } }).turnId);
    lists.forEach((ids, i) => /** @type {any} */ (archive).db.prepare("UPDATE turns SET request_ids_json = ? WHERE id = ?").run(ids, begun[i]));
    const key = archive.getChain(id).key;
    const whole = archive.getTurns(id);
    const outline = archive.turnOutline(id);
    assert.equal(outline.length, whole.length);
    assert.deepEqual(outline.slice(-7).map((o) => o.request), ["only", "retry", undefined, 7, undefined, undefined, undefined]);
    outline.forEach((o, i) => {
      const w = whole[i];
      const m = w.meta || {};
      assert.deepEqual(
        { n: o.n, startedAt: o.startedAt, endedAt: o.endedAt, request: o.request, command: o.command, settingsHash: o.settingsHash, carried: o.carried, rewoundLine: o.rewoundLine, window: o.window },
        { n: w.n, startedAt: w.started_at, endedAt: w.ended_at, request: Array.isArray(w.requestIds) ? w.requestIds.at(-1) : undefined, command: !!m.command, settingsHash: m.settingsHash, carried: m.carried, rewoundLine: m.rewound?.line, window: Archive.turnWindow(w, { key }) },
        `turn ${w.n}: ${w.meta_json}`,
      );
    });
  });
});

describe("the transcript", () => {
  // (fails before: yes — every turn of the chat was read, and each message opened with its own query)
  test("a page's one-turn read reads that turn alone, its messages in one query, and answers as the whole read does", () => {
    const sessions = sessionsWith();
    const id = chatWith(12, sessions);
    const whole = sessions.transcript(id, { work: false });
    const rows = spied("getTurns", () => spied("getMessage", () => sessions.transcript(id, { work: false, limit: 1 })));
    const one = rows.value.value;
    assert.deepEqual(rows.calls.map((c) => c.out.length), [1], "one turn row read");
    assert.equal(rows.value.calls.length, 0, "no message opened one at a time");
    assert.deepEqual(one.turns, whole.turns.slice(-1));
    const { turns: _a, ...restOne } = one, { turns: _b, ...restWhole } = whole;
    assert.deepEqual(restOne, restWhole, "the rest — total, boundaries, windows, settings — is the whole chat's");
    assert.equal(one.total, 12);
    assert.equal(one.boundaries.filter((/** @type {any} */ b) => b.type === "settings").length, 1);
  });

  // (a pin, as it was before: the query chooses what the array's filter and slice chose)
  test("since and limit choose the turns as the page's numbers always did — fractions, under one, endless", () => {
    const sessions = sessionsWith();
    const id = chatWith(6, sessions);
    const ns = (/** @type {any} */ o) => sessions.transcript(id, { work: false, ...o }).turns.map((/** @type {any} */ t) => t.n);
    // The rule the transcript always kept: past `since`, then the newest `limit` (Array slice's own rounding).
    const rule = (/** @type {any} */ since, /** @type {any} */ limit) => {
      let t = [1, 2, 3, 4, 5, 6];
      if (since != null && Number.isFinite(Number(since))) t = t.filter((n) => n > Number(since));
      if (limit != null && Number(limit) > 0) t = t.slice(-Number(limit));
      return t;
    };
    for (const [since, limit] of [[null, 2], [null, 2.7], [null, 0.5], [null, Infinity], [null, NaN], [null, 0], [null, -2], [3, null], [3.5, null], [3, 1], [NaN, 2], [10, 1], [-Infinity, 2]])
      assert.deepEqual(ns({ since, limit }), rule(since, limit), `since ${since}, limit ${limit}`);
  });

  // (fails before: yes — there was no such row)
  test("GET /sessions/:id/live-state is the transcript's live, read without the turns; 404 for no session", async () => {
    /** @type {any} */
    let held = null;
    const sessions = sessionsWith({ sessionTurns: { holder: () => held } });
    const id = chatWith(3, sessions);
    const get = routesOf({ memory, usage, ops, sessions, config });
    const read = spied("getTurns", () => spied("turnOutline", () => get(`/sessions/${id}/live-state`)));
    const quiet = await read.value.value;
    assert.deepEqual(quiet, { status: 200, json: { live: null } });
    assert.equal(read.calls.length + read.value.calls.length, 0, "no turn read");
    held = { window: "w2", client: "opencode", label: "OpenCode", requestId: "q1", since: 5, idleMs: 9, phase: null, own: null };
    const live = await get(`/sessions/${id}/live-state`);
    assert.deepEqual(live.json, { live: sessions.transcript(id, { work: false, limit: 1 }).live });
    assert.deepEqual(live.json.live, { window: "w2", client: "opencode", label: "OpenCode", requestId: "q1", startedAt: 5, idleMs: 9, phase: null, own: null });
    assert.deepEqual(await get("/sessions/nope/live-state"), await get("/sessions/nope/transcript?work=0&limit=1"));
    assert.equal((await get("/sessions/nope/live-state")).status, 404);
  });

  // (fails before: yes — the artifacts' folder was read twice, once for the agent's, once for the helpers')
  test("the transcript's row reads the artifacts once", async () => {
    const sessions = sessionsWith();
    const id = chatWith(1, sessions);
    let lists = 0;
    const artifacts = {
      list: () => {
        lists++;
        return [
          { name: "page", title: "Page", icon: "i", type: "html", versions: [{ v: 1, at: 1, by: { chain: id, call: "c1" } }, { v: 2, at: 2, by: { chain: id, helper: "h1", exchange: 1 } }] },
        ];
      },
    };
    const r = await routesOf({ memory, usage, ops, sessions, config, artifacts })(`/sessions/${id}/transcript?work=held`);
    assert.equal(lists, 1);
    assert.deepEqual(r.json.artifacts, [{ call: "c1", name: "page", v: 1, title: "Page", icon: "i", type: "html" }]);
    assert.deepEqual(r.json.helpersMade, [{ helper: "h1", exchange: 1, name: "page", v: 2, title: "Page" }]);
  });
});

describe("the goal", () => {
  // (fails before: yes — there was no such row)
  test("GET /sessions/:id/goal is what GET /sessions/:id says in force, read without the statistics; 404 for no session", async () => {
    const sessions = sessionsWith();
    const id = chatWith(2, sessions);
    const get = routesOf({ memory, usage, ops, sessions, config });
    assert.deepEqual((await get(`/sessions/${id}/goal`)).json, { goal: null, pinned: false });
    archive.mergeMeta(id, { goal: { status: "active", text: "Ship it", slice: "s", estimate: { sizeClass: "M" }, totals: { spentUsd: 1.25, turns: 3 }, createdAt: 7, acceptedAt: 8, ledger: [{ usd: 1 }] }, pinned: 1 });
    const truth = (await get(`/sessions/${id}`)).json;
    const real = memory.sessionTruth.bind(memory);
    let truths = 0;
    memory.sessionTruth = (/** @type {any[]} */ ...args) => (truths++, real(...args));
    try {
      const read = spied("getTurns", () => get(`/sessions/${id}/goal`));
      const goal = await read.value;
      assert.deepEqual(goal, { status: 200, json: { goal: truth.inForce.goal, pinned: truth.inForce.pinned } });
      assert.equal(goal.json.goal.text, "Ship it");
      assert.equal(truths + read.calls.length, 0, "no truth built, no turn read");
    } finally {
      memory.sessionTruth = real;
    }
    // The header's Pin reads it there: the whole answer builds the chat's statistics, and its Still open is not waited for.
    const header = readFileSync(new URL("../src/ui/harness/header.js", import.meta.url), "utf8");
    const toggle = header.slice(header.indexOf("async function togglePinned()"), header.indexOf("async function archive()"));
    assert.ok(toggle.includes("api(`/sessions/${encodeURIComponent(chat.chainId)}/goal`)"), "the pin's read");
    assert.ok(toggle.includes("const next = !r?.pinned;"), "what it says, as the route gives it");
    assert.deepEqual(await get("/sessions/nope/goal"), { status: 404, json: { error: "no such session" } });
    assert.deepEqual(await get("/sessions/nope"), { status: 404, json: { error: "no such session" } });
  });
});

describe("the settings a turn resolves", () => {
  /** The layers resolved off the chain read whole, as they always were. @param {string} id */
  const reference = (id) => {
    const chain = archive.getChain(id);
    const native = chain.meta?.native === true;
    return derivedFor(resolveSettings({ global: native ? harnessGlobalLayer(cfg) : globalLayer(cfg), space: spaceLayerOf(archive, chain.project_id), project: chain.project_id ? archive.projectSettings(chain.project_id) : {}, session: archive.chainSettings(chain.id) }), cfg, { model: chain.model });
  };

  // (fails before: yes — every resolution read the chain whole, its meta parsed and its layer opened)
  test("resolveChainSettings never reads the chain whole, and answers as the layers read off it do", () => {
    const id = chatWith(1);
    archive.setChainSettings(id, { context: { results: "pointer" }, plugins: { mcp: [{ name: "gh", command: "x", env: { GITHUB_TOKEN: "s3cret" } }] } });
    const read = spied("getChain", () => resolveChainSettings(archive, cfg, id));
    assert.equal(read.calls.length, 0);
    assert.deepEqual(read.value, reference(id));
    assert.equal(resolveChainSettings(archive, cfg, "nope"), null);
  });

  // (a pin, as it was before: nothing the resolution reads is kept past a write)
  test("a write is seen at once: the chat's layer, its project's, its model, its native mark, the config replaced or changed in place", () => {
    const id = chatWith(1);
    const of = () => /** @type {any} */ (resolveChainSettings(archive, cfg, id));
    assert.equal(of().flat["context.compaction.thresholdPercent"], 70, "your defaults, the harness's chat");
    archive.setChainSettings(id, { context: { compaction: { thresholdPercent: 60 } } });
    assert.equal(of().flat["context.compaction.thresholdPercent"], 60);
    const project = /** @type {string} */ (archive.getChain(id).project_id);
    archive.setProjectSettings(project, { instructions: { files: ["RULES.md"] } });
    assert.deepEqual(of().effective.instructions.files, ["RULES.md"]);
    archive.setChainSettings(id, null);
    archive.mergeMeta(id, { native: false });
    assert.equal(of().flat["context.compaction.thresholdPercent"], 85, "a client's chat: the dashboard's rules, not your defaults");
    archive.mergeMeta(id, { native: true });
    cfg.sessions.defaults["context.compaction.thresholdPercent"] = 65;
    assert.equal(of().flat["context.compaction.thresholdPercent"], 65, "the config changed in place");
    archive.setChainModel(id, "agent/other");
    assert.deepEqual(of(), reference(id));
    cfg.sessions.defaults["context.compaction.thresholdPercent"] = 70;
  });
});

describe("the writers", () => {
  // (fails before: yes — the four writes were four transactions, the spend said between them)
  test("a model call's end writes its ledgers in one transaction, and says the spend once it is written", () => {
    /** @type {string[]} */
    const seen = [];
    let open = false;
    const book = (/** @type {string} */ what) => () => {
      seen.push(`${what}${open ? "" : " (outside)"}`);
      return what === "spend" ? { usd: 1 } : true;
    };
    const fake = {
      archive: {
        transaction: (/** @type {() => any} */ fn) => {
          seen.push("begin");
          open = true;
          try {
            return fn();
          } finally {
            open = false;
            seen.push("commit");
          }
        },
      },
      sessionChainOf: () => "c1",
      spendAdd: book("spend"),
      turnFactsAdd: book("facts"),
      turnStopped: book("stopped"),
    };
    const health = { ok: 0, recordSuccess() { this.ok++; }, recordFailure() {}, recordMeta() {} };
    /** @type {string[]} */
    const logged = [];
    const finish = createFinish({ config: { get: () => ({ upstreams: [] }) }, usage: { finish() {}, byId: new Map() }, health, liveAborts: new Map(), pushAlert() {}, log: (_l, m) => logged.push(m), memory: fake, spent: (chainId, spend) => seen.push(`spent ${chainId} ${JSON.stringify(spend)}`) });
    const rec = () => ({ id: `q${seen.length}`, upstream: "u", memory: { chain: "c1" }, tokens: { input: 1, output: 1 }, cost: 0.5 });
    finish(rec(), { status: "ok" });
    assert.deepEqual(seen, ["begin", "spend", "facts", "stopped", "commit", 'spent c1 {"usd":1}']);
    assert.equal(health.ok, 1);
    // A ledger that throws: what came before it is written, the rest of the ledgers is not run but the turn's running
    // mark, which goes on its own write; the close goes on past it — the health board hears the outcome — and the throw
    // reaches the caller at its end.
    seen.length = 0;
    fake.turnFactsAdd = () => {
      throw new Error("facts broke");
    };
    assert.throws(() => finish(rec(), { status: "ok" }), /facts broke/);
    assert.deepEqual(seen, ["begin", "spend", "commit", "stopped (outside)", 'spent c1 {"usd":1}']);
    assert.equal(health.ok, 2, "the close went on to the health board past the ledger's throw");
    // A transaction that cannot begin costs the close nothing: said in the log, nothing said of the spend, and the
    // turn's running mark goes on its own write.
    seen.length = 0;
    fake.turnFactsAdd = book("facts");
    fake.archive.transaction = () => {
      throw new Error("database is locked");
    };
    finish(rec(), { status: "ok" });
    assert.deepEqual(seen, ["stopped (outside)"]);
    assert.match(logged.at(-1) || "", /were not written \(database is locked\)/);
    assert.equal(health.ok, 3, "the close went on to the health board");
  });

  // (fails before: yes — the turn's running mark went only inside the ledgers' transaction: a commit that failed rolled
  // it back, and nothing wrote it again)
  test("a ledgers' transaction whose commit fails: the turn's running mark goes on a write of its own", () => {
    /** @type {string[]} */
    const seen = [];
    let open = false;
    const fake = {
      archive: {
        transaction: (/** @type {() => any} */ fn) => {
          open = true;
          try {
            fn();
          } finally {
            open = false;
          }
          seen.push("rolled back");
          throw new Error("disk I/O error");
        },
      },
      sessionChainOf: () => "c1",
      spendAdd: () => (seen.push("spend"), { usd: 1 }),
      turnFactsAdd: () => seen.push("facts"),
      turnStopped: () => seen.push(`stopped${open ? "" : " (outside)"}`),
    };
    /** @type {string[]} */
    const logged = [];
    const finish = createFinish({ config: { get: () => ({ upstreams: [] }) }, usage: { finish() {}, byId: new Map() }, health: { recordSuccess() {}, recordFailure() {}, recordMeta() {} }, liveAborts: new Map(), pushAlert() {}, log: (_l, m) => logged.push(m), memory: fake, spent: () => seen.push("spent") });
    finish({ id: "q1", upstream: "u", memory: { chain: "c1" }, tokens: { input: 1, output: 1 }, cost: 0.5 }, { status: "ok" });
    assert.deepEqual(seen, ["spend", "facts", "stopped", "rolled back", "stopped (outside)"], "nothing said of a spend the rollback took back");
    assert.match(logged.at(-1) || "", /were not written \(disk I\/O error\)/);
  });

  // (fails before: yes — the goal's ledger read the chain whole (and, with a goal active, wrote its meta back whole),
  // then the spend read it whole again and merged: a meta that grows with the chat parsed three times a model call. And
  // since the owner's of 11-05 a goal books nothing: no ledger, no totals)
  test("a model call's spend is one read and one write of the meta, no chain read whole; an active goal books nothing", () => {
    const sessions = sessionsWith();
    const id = chatWith(0, sessions);
    const entry = (/** @type {number} */ n) => ({ at: n, requestId: `q${n}`, usd: 0.5, listUsd: 0.5, model: "m", inputTokens: 10, outputTokens: 2 });
    /** @type {string[]} */
    const logged = [];
    // The service's log, heard here (it is untyped JavaScript: held as any).
    const svc = /** @type {any} */ (memory);
    const log = svc.log;
    svc.log = (/** @type {string} */ _l, /** @type {string} */ m) => logged.push(m);
    try {
      // No goal: the spend alone, and no goal made.
      let r = spied("getChain", () => spied("updateMeta", () => memory.spendAdd(id, entry(1))));
      assert.equal(r.calls.length, 0, "no chain read whole");
      assert.equal(r.value.calls.length, 1, "one read-modify-write of the meta");
      assert.equal(r.value.value.requests, 1, "the spend as written");
      assert.equal(archive.getChain(id).meta.goal, undefined);
      // An active goal: the call books nothing to it, in the same one write.
      memory.setGoal(id, { ...newGoal("ship it", { now: 1 }), status: "active", acceptedAt: 2 });
      r = spied("getChain", () => spied("updateMeta", () => memory.spendAdd(id, entry(2))));
      assert.equal(r.calls.length, 0);
      assert.equal(r.value.calls.length, 1);
      const meta = archive.getChain(id).meta;
      assert.deepEqual([meta.goal.totals, meta.goal.ledger], [undefined, undefined], "the goal as it was set");
      assert.deepEqual([meta.spend.requests, meta.spend.usd], [2, 1]);
      assert.deepEqual(r.value.value, meta.spend, "what it says is what it wrote");
      assert.equal(logged.length, 0, "nothing said");
      // No such session: nothing written, and nothing said to be.
      assert.equal(memory.spendAdd("nope", entry(3)), null);
      assert.equal(memory.goalFor(id)?.status, "active", "the goal read as its one key");
      assert.equal(memory.goalFor("nope"), null);
    } finally {
      svc.log = log;
    }
  });

  // (fails before: yes — each write read the chain whole first; a thread's save read it again to merge)
  test("the sub-agents' writers read no chain whole, and a thread's save writes the meta once, the other threads as kept", () => {
    const sessions = sessionsWith();
    const id = chatWith(0, sessions);
    /** @param {string} tid @param {string} prompt */
    const thread = (tid, prompt) => /** @type {any} */ ({ id: tid, status: "done", startedAt: 1, card: { tag: "x", name: "X", thinks: "think" }, team: null, exchanges: [{ startedAt: 2, prompt, outcome: { report: `report of ${prompt}`, tokens: 5 } }] });
    const reads = spied("getChain", () =>
      spied("updateMeta", () => {
        sessions.saveSubagentThread(id, thread("a", "one"), 30);
        sessions.saveSubagentThread(id, thread("b", "two"), 30);
        sessions.saveSubagentQueue(id, [{ text: "q", from: "a", description: "d", kind: "report" }]);
        sessions.saveSubagentHeld(id, [{ text: "h", agentId: "a", exchange: 1, description: "d" }]);
        sessions.subagentMark(id, { event: "sent", agentId: "a", exchange: 1 });
      }),
    );
    assert.equal(reads.calls.length, 0, "no chain read whole");
    assert.equal(reads.value.calls.filter((c) => c.args[0] === id).length, 5, "each write one read-modify-write of the meta");
    const before = archive.getChain(id).meta.subagentThreads;
    const again = spied("updateMeta", () => sessions.saveSubagentThread(id, thread("a", "three"), 30));
    assert.equal(again.calls.length, 1);
    const kept = archive.getChain(id).meta.subagentThreads;
    assert.deepEqual(kept.map((/** @type {any} */ t) => t.id), ["a", "b"], "the thread keeps its place");
    assert.deepEqual(kept[1], before[1], "the other thread as it was kept");
    assert.deepEqual(sessions.loadSubagentThreads(id).map((t) => t.exchanges[0].prompt), ["three", "two"]);
    assert.throws(() => sessions.saveSubagentThread("nope", thread("a", "x"), 30), /no such session/);
  });

  // (fails before: yes — a chat's waiting messages and kept reports held their texts for as long as Filament ran, its
  // lists emptied or the chat deleted, only a thread's let go)
  test("the texts a chat's lists kept are let go of once a list is empty, and all of them once the chat is deleted", () => {
    const sessions = sessionsWith();
    const id = chatWith(0, sessions);
    const at = sessions.keptTextLists();
    const thread = /** @type {any} */ ({ id: "t", status: "done", startedAt: 1, card: { tag: "x", name: "X", thinks: "think" }, team: null, exchanges: [{ startedAt: 2, prompt: "p", outcome: { report: "r", tokens: 5 } }] });
    sessions.saveSubagentQueue(id, [{ text: "q", from: "a", description: "d", kind: "report" }]);
    sessions.saveSubagentHeld(id, [{ text: "h", agentId: "a", exchange: 1, description: "d" }]);
    sessions.saveSubagentThread(id, thread, 30);
    assert.equal(sessions.keptTextLists(), at + 3, "the queue, the reports kept aside and the thread");
    sessions.saveSubagentQueue(id, []);
    sessions.saveSubagentHeld(id, []);
    assert.equal(sessions.keptTextLists(), at + 1, "an emptied list holds no text");
    sessions.saveSubagentQueue(id, [{ text: "q2", from: "a", description: "d", kind: "report" }]);
    assert.equal(sessions.forgetKeptTexts(id), 2, "the deleted chat's queue and thread");
    assert.equal(sessions.keptTextLists(), at);
    assert.equal(sessions.forgetKeptTexts(id), 0);
  });
});

describe("what a request reads of its chain", () => {
  /** The stored texts of a chain's meta, settings and state, as JSON.parse would be handed them. @param {string} id */
  const storedTexts = (id) => Object.values(/** @type {any} */ (archive.db.prepare("SELECT meta_json, settings_json, state_json FROM chains WHERE id = ?").get(id))).filter((v) => v != null).map(String);
  /** The texts JSON.parse is handed while `fn` runs. @template T @param {() => T} fn */
  const parsing = (fn) => {
    const parse = JSON.parse;
    /** @type {string[]} */
    const texts = [];
    JSON.parse = /** @type {any} */ ((/** @type {any[]} */ ...args) => {
      texts.push(String(args[0]));
      return parse.apply(JSON, /** @type {any} */ (args));
    });
    try {
      return { value: fn(), texts };
    } finally {
      JSON.parse = parse;
    }
  };

  // (fails before: yes — every lookup by key read the chain whole: its meta parsed, its settings' credentials opened,
  // for a caller that wanted its id)
  test("a lookup by key opens no meta, state or settings until they are read; read, they are getChain's", () => {
    const sessions = sessionsWith();
    const id = chatWith(2, sessions);
    archive.mergeMeta(id, { big: "x".repeat(50_000) });
    archive.setState(id, { kept: true });
    const key = archive.chainHead(id).key;
    const stored = storedTexts(id);
    assert.equal(stored.length, 3, "a meta, a settings layer and a state to leave unopened");
    const looked = parsing(() => archive.chainForKey(key, { client: "harness" }));
    assert.deepEqual(looked.texts.filter((t) => stored.includes(t)), [], "nothing of the chain's own parsed");
    const row = looked.value;
    assert.equal(row.id, id);
    assert.equal(row.isNew, false);
    assert.equal(row.meta.big.length, 50_000, "the meta, read, is there");
    assert.deepEqual(row, { ...archive.getChain(id), isNew: false }, "the row getChain reads, with isNew");
    assert.deepEqual(Object.keys(row), [...Object.keys(archive.getChain(id)), "isNew"], "in its order");
    // A new key's chain: the same row, made.
    const made = archive.chainForKey("h:store-reads-new", { client: "opencode", cwd: folder });
    assert.equal(made.isNew, true);
    assert.deepEqual(made, { ...archive.getChain(made.id), isNew: true });
  });

  // (fails before: yes — every transcript read took the writer's lock and parsed the whole meta for its window list)
  test("the window list is read without the writer's lock or the whole meta; it is written once, when first built", () => {
    const sessions = sessionsWith();
    const id = chatWith(3, sessions);
    archive.mergeMeta(id, { big: "x".repeat(50_000), windows: undefined });
    const empty = chatWith(0, sessions);
    const db = /** @type {any} */ (archive.db);
    const exec = db.exec;
    /** @type {string[]} */
    const locks = [];
    db.exec = (/** @type {string} */ sql) => {
      if (/BEGIN/i.test(sql)) locks.push(sql);
      return exec.call(db, sql);
    };
    try {
      const first = archive.windowsOf(id);
      assert.deepEqual(first, { harness: { client: "harness" } });
      assert.equal(locks.length, 1, "built from the turns and written, under the lock");
      assert.deepEqual(archive.getChain(id).meta.windows, first);
      locks.length = 0;
      const again = parsing(() => [archive.windowsOf(id), archive.windowsOf(id)]);
      assert.deepEqual(again.value, [first, first]);
      assert.equal(locks.length, 0, "kept: no lock");
      assert.ok(again.texts.every((t) => t.length < 1000), "only the list parsed, not the meta");
      // A chat with no turn has no list to build, and writes nothing.
      assert.deepEqual(archive.windowsOf(empty), {});
      assert.equal(locks.length, 0);
      assert.equal(archive.getChain(empty).meta.windows, undefined);
      assert.deepEqual(archive.windowsOf("nope"), {});
    } finally {
      db.exec = exec;
    }
  });

  // (fails before: yes — each read the chain whole, for its id and its key)
  test("stopping and letting go of a turn read the chain's head alone", async () => {
    const sessions = sessionsWith();
    const id = chatWith(1, sessions);
    const key = archive.chainHead(id).key;
    /** @type {string[]} */
    const held = [];
    const sessionTurns = { holder: (/** @type {string} */ k) => (held.push(k), null) };
    const route = createRouter(sessionRoutes({ memory, usage, ops, sessions, config, sessionTurns }));
    /** @param {string} method @param {string} path */
    const ask = async (method, path) => {
      const url = new URL(`http://x${path}`);
      const m = route(method, url.pathname);
      assert.ok(m, `${method} ${url.pathname} has a row`);
      const res = new FakeRes();
      /** @type {(() => void)[]} */
      const closers = [];
      const on = (/** @type {string} */ ev, /** @type {() => void} */ fn) => void (ev === "close" && closers.push(fn));
      await m.handler({ req: { headers: {}, method, socket: { remoteAddress: "127.0.0.1" }, on }, res, url, path: url.pathname, method, params: m.params, json: async () => ({}) }, {});
      for (const close of closers) close();
      return { status: res.status, body: res.body };
    };
    /** @type {any[]} */
    const reads = [];
    const real = archive.getChain;
    archive.getChain = (/** @type {any[]} */ ...args) => (reads.push(args[0]), real.apply(archive, args));
    try {
      const stop = await ask("POST", `/sessions/${id}/stop`);
      assert.equal(stop.status, 200);
      assert.deepEqual(JSON.parse(stop.body), { ok: true, holder: null, stopped: null }, "no turn holds the session: the stop reached none");
      const skip = await ask("POST", `/sessions/${id}/wait/skip`);
      assert.equal(skip.status, 409);
      assert.deepEqual(held, [key], "the session's key, from its head");
      for (const [method, path] of [["POST", "/stop"], ["POST", "/wait/skip"]]) assert.equal((await ask(method, `/sessions/nope${path}`)).status, 404);
      assert.deepEqual(reads.filter((x) => x === id), [], "no chain read whole");
    } finally {
      archive.getChain = real;
    }
  });
});

describe("the compose preview", () => {
  // (fails before: yes — every asker composed its own, the long chat's compactor plan with it)
  test("one asked again while it composes is that one's answer; one asked after it, or after a write, composes again", async () => {
    const sessions = sessionsWith();
    const id = chatWith(3, sessions);
    let composed = 0;
    const real = archive.turnBodies;
    /** @type {any} */ (archive).turnBodies = (/** @type {any[]} */ ...args) => {
      if (args[1] == null) composed++;
      return real.apply(archive, /** @type {any} */ (args));
    };
    try {
      const [p1, p2] = await Promise.all([sessions.preview(id, {}), sessions.preview(id, {})]);
      assert.equal(composed, 1, "the second asker waited for the first");
      assert.equal(p1, p2);
      const [q1, q2] = await Promise.all([sessions.preview(id, {}), sessions.preview(id, { forms: ["plain"] })]);
      assert.equal(composed, 3, "a different question is its own");
      assert.deepEqual(q1, p1, "and the answer is the same composition");
      assert.notEqual(q2, q1);
      const first = sessions.preview(id, {});
      archive.mergeMeta(id, { touched: true });
      const second = sessions.preview(id, {});
      await Promise.all([first, second]);
      assert.equal(composed, 5, "a write between: composed again");
    } finally {
      /** @type {any} */ (archive).turnBodies = real;
    }
  });
});

describe("the one walk every sessions answer goes through", () => {
  // (fails before: yes — every answer was copied whole before it was written, masked or not)
  test("maskAnswer masks every credential where it sits and copies only what holds one", () => {
    const secret = { name: "gh", command: "x", env: { GITHUB_TOKEN: "s3cret", PATH: "/bin" } };
    const plainServer = { name: "fs", command: "y" };
    const turns = Array.from({ length: 50 }, (_, i) => ({ n: i, user: { role: "user", content: [{ type: "text", text: `t${i}` }] }, meta: { composed: { shapes: [[1, "raw"]] } } }));
    const transcript = { chainId: "c", turns, settings: { effective: { context: { results: "keep" }, plugins: { mcp: [plainServer] } } } };
    assert.equal(maskAnswer(transcript), transcript, "nothing to mask: written as it came");
    const answer = {
      flat: { "plugins.mcp": [secret, plainServer], "context.results": "keep" },
      effective: { plugins: { mcp: [secret], on: ["a@b"] } },
      changes: [{ path: "plugins.mcp", from: [secret], to: [plainServer], value: [secret] }, { path: "context.results", from: "keep", to: "pointer" }],
      turns,
    };
    const snapshot = structuredClone(answer);
    const out = maskAnswer(answer);
    assert.deepEqual(answer, snapshot, "the answer itself is not touched");
    const masked = { ...secret, env: { GITHUB_TOKEN: out.flat["plugins.mcp"][0].env.GITHUB_TOKEN, PATH: "/bin" } };
    assert.notEqual(masked.env.GITHUB_TOKEN, "s3cret");
    assert.deepEqual(out, {
      flat: { "plugins.mcp": [masked, plainServer], "context.results": "keep" },
      effective: { plugins: { mcp: [masked], on: ["a@b"] } },
      changes: [{ path: "plugins.mcp", from: [masked], to: [plainServer], value: [masked] }, { path: "context.results", from: "keep", to: "pointer" }],
      turns,
    });
    assert.equal(out.turns, turns, "what holds no credential is the answer's own");
    assert.equal(out.changes[1], answer.changes[1]);
    assert.equal(out.flat["plugins.mcp"][1], plainServer);
    assert.equal(out.effective.plugins.on, answer.effective.plugins.on);
  });
});
