// @ts-check
// HarnessV3-TaskGraph-v2 TG2-D54, revised (2026-10-14): a provider that cannot serve stops its worker at once, and its
// lead hears why. An out (this account's allowance used up) or an account (it or its key refused) is a wall: no loop of
// Filament's tries a call into one again, and the health board holds the provider as one that cannot serve — an out
// until its reset or for 15 minutes, an account until it is fixed; a call there that succeeds, a change of the
// upstream in Settings and Reset let it go. While it holds, the failover order puts it last, the pool lends no seat on
// it, and a follow-up on it is refused with what to do instead. A run that ended on its provider reaches its lead in
// one line in its report's place: the cause in the provider's words, whether it was tried again, where its work is,
// and the lead's three choices. The reading itself is test/provider-cause.test.js's.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { PROMPT_VERSION } from "../src/app/agent/prompt.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { failureLine, failureParts, worded } from "../src/core/failure.js";
import { HealthBoard } from "../src/services/health.js";
import { FAKE_ACP_AGENT, fakeUpstream, startApp } from "./helpers/app.js";
import { BRIEF, TEAM, leadOf, running, watched } from "./helpers/team.js";
import { removeDirs, until } from "./helpers/wait.js";

const ZAI_OUT = "Insufficient balance or no resource package. Please recharge.";
const HOLD_MS = 15 * 60_000;

/** @type {string[]} */
const made = [];
after(async () => {
  await removeDirs(...made);
});

const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
/** A failed try as the internal call reports it, from zai. @param {number} status @param {string} type @param {string} message @param {Record<string, any>} [more] */
const refused = (status, type, message, more = {}) => ({ ok: false, status, json: { type: "error", error: { type, message } }, id: null, upstream: "zai", retryAfter: null, ...more });
const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null, upstream: "zai", retryAfter: null });
/** @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over */
const args = (over) =>
  /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "edit",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => reply([{ type: "text", text: "Done." }]),
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink,
    signal: null,
    resume: null,
    ...over,
  });
const waitsIn = (/** @type {any[]} */ events) => events.filter((e) => e.type === "turn-state" && e.to === "waiting");

// ---------------------------------------------------------------------------------------------------
// No retries into a wall
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — zai's 1113 was tried ten times over about two and a half minutes, as a rate is, and its failure
// said nothing of what its words meant)
test("an out and an account are tried once: the turn fails at the first refusal, and its words and its record say it was not tried again", async () => {
  /** @type {any[]} */
  const events = [];
  let n = 0;
  const out = await runAgentTurn(args({ call: async () => (++n, refused(429, "api_error", ZAI_OUT)), onEvent: (e) => events.push(e) }));
  assert.deepEqual([n, out.status, waitsIn(events).length], [1, "failed", 0]);
  assert.equal(out.error, "round 1's model call to m at zai failed: Insufficient balance or no resource package. Please recharge (HTTP 429). Not tried again: zai says this account's allowance is used up.");
  assert.deepEqual(out.failure?.cause, { kind: "out", provider: "zai", resets: null });
  assert.ok(out.notes.includes(`agent: round 1 failed (zai: out, not tried again — ${ZAI_OUT})`), out.notes.join("\n"));
  let m = 0;
  const key = await runAgentTurn(args({ call: async () => (++m, refused(401, "authentication_error", "invalid x-api-key")) }));
  assert.deepEqual([m, key.error], [1, "round 1's model call to m at zai failed: invalid x-api-key (HTTP 401). Not tried again: zai refuses this account or its key."]);
  // A 429 that asks to be called again in an hour serves this account again only then: an out, with its reset.
  let h = 0;
  const hour = await runAgentTurn(args({ call: async () => (++h, refused(429, "rate_limit_error", "Rate limit reached", { retryAfter: 3600 })) }));
  assert.deepEqual([h, hour.failure?.cause?.kind], [1, "out"]);
  assert.match(String(hour.error), /\(HTTP 429\)\. Not tried again: zai says this account's allowance is used up, until it resets in 60 min\.$/);
});

// (fails before: yes, on the failure's cause alone — its tries and its words were AH-F4's already. It guards the other
// side: a rate is tried as before, and its failure says no word of a wall)
test("zai's 1302 is a rate: tried again after its wait; ten of them fail the turn as a rate, with no word of a wall", async () => {
  let n = 0;
  const done = await runAgentTurn(args({ call: async () => (++n === 1 ? refused(429, "api_error", "Rate limit reached for requests", { retryAfter: 0 }) : reply([{ type: "text", text: "Done." }])) }));
  assert.deepEqual([n, done.status], [2, "done"]);
  let m = 0;
  const failed = await runAgentTurn(args({ call: async () => (++m, refused(429, "api_error", "Rate limit reached for requests", { retryAfter: 0 })) }));
  assert.deepEqual([m, failed.error, failed.failure?.cause], [10, "round 1's model call to m at zai failed after 10 tries: Rate limit reached for requests (HTTP 429).", { kind: "rate", provider: "zai", resets: null }]);
  assert.ok(failed.notes.includes("agent: round 1 failed after 10 tries (Rate limit reached for requests)"), failed.notes.join("\n"));
});

// (fails before: yes — a failure said its provider's words and nothing of what they meant)
test("a failure on a wall says it was not tried again, and until when, where the provider said; any other says nothing more", () => {
  /** @param {any} cause */
  const f = (cause) => worded({ what: "round 3's model call", where: "glm-5.3-flash at zai", said: ZAI_OUT, code: null, status: 429, tries: null, began: null, at: 1_000_000, streamed: null, kept: "2 finished rounds are kept", next: null, cause });
  assert.deepEqual(failureParts(f({ kind: "out", provider: "zai", resets: 1_000_000 + 290 * 60_000 })), {
    head: "round 3's model call to glm-5.3-flash at zai failed: Insufficient balance or no resource package. Please recharge (HTTP 429).",
    more: "Not tried again: zai says this account's allowance is used up, until it resets in 4 h 50 min. 2 finished rounds are kept.",
  });
  assert.equal(f({ kind: "account", provider: "zai", resets: null }).more, "Not tried again: zai refuses this account or its key. 2 finished rounds are kept.");
  assert.equal(f({ kind: "out", provider: "zai", resets: 999 }).more, "Not tried again: zai says this account's allowance is used up. 2 finished rounds are kept.", "a reset already past is not said");
  assert.equal(f({ kind: "busy", provider: "zai", resets: null }).more, "2 finished rounds are kept.");
  assert.equal(f(null).more, "2 finished rounds are kept.");
  assert.equal(failureLine(f({ kind: "out", provider: null, resets: null })), "round 3's model call to glm-5.3-flash at zai failed: Insufficient balance or no resource package. Please recharge (HTTP 429). Not tried again: the provider says this account's allowance is used up. 2 finished rounds are kept.");
});

// ---------------------------------------------------------------------------------------------------
// The provider held
// ---------------------------------------------------------------------------------------------------

// (fails before: yes — the health board kept nothing of a provider that said it cannot serve this account)
test("the health board holds a provider that cannot serve — an out until its reset or for 15 minutes, an account until it is fixed — and a success, Reset and a lift let it go", () => {
  const h = new HealthBoard();
  const t = Date.now();
  const w = h.noteWall("zai", { kind: "out", said: "Insufficient  balance\n", status: 429 }, t);
  assert.deepEqual(w, { kind: "out", said: "Insufficient balance", status: 429, at: t, until: t + HOLD_MS, reset: null, as: null });
  assert.equal(h.wallOf("zai", t + HOLD_MS - 1), w);
  assert.equal(h.wallOf("zai", t + HOLD_MS), null, "15 minutes on, a call may try it again");
  assert.deepEqual([h.noteWall("zai", { kind: "out", resets: t + 3_600_000 }, t).until, h.wallOf("zai", t)?.reset], [t + 3_600_000, t + 3_600_000], "its own reset");
  assert.deepEqual([h.noteWall("zai", { kind: "out", resets: t - 1 }, t).until, h.wallOf("zai", t)?.reset], [t + HOLD_MS, null], "a reset already past is none");
  assert.equal(h.snapshot(t + 60_000).zai.wall?.leftMs, HOLD_MS - 60_000);
  h.recordSuccess("zai", {});
  assert.deepEqual([h.wallOf("zai"), h.snapshot().zai.wall], [null, null], "a call there succeeded");
  const key = h.noteWall("anthropic", { kind: "account", said: "invalid x-api-key", status: 401 }, t);
  assert.equal(key.until, null);
  assert.equal(h.wallOf("anthropic", t + 30 * 86_400_000), key, "an account holds until it is fixed");
  assert.deepEqual(h.snapshot(t + 1000).anthropic.wall, { ...key, leftMs: null });
  h.reset("anthropic");
  assert.equal(h.wallOf("anthropic"), null, "Reset");
  /** @type {import("../src/core/agent-limits.js").Identity} */
  const as = { kind: "account", label: "Claude Max", plan: "max", email: "dev@example.com", organization: null, detail: null, billing: "plan" };
  assert.deepEqual(h.noteWall("anthropic", { kind: "account", as }, t).as, as, "a coding agent's is held with whom it said it runs as");
  h.liftWall("anthropic", "out");
  assert.ok(h.wallOf("anthropic"), "a lift of an out leaves an account held");
  h.liftWall("anthropic");
  assert.equal(h.wallOf("anthropic"), null);
});

// (fails before: yes — the failover order put a provider that cannot serve first, unless it was cooling down)
test("the failover order puts a held provider last, as it does one that cools down", () => {
  const h = new HealthBoard();
  const both = [{ upstream: "zai" }, { upstream: "zai-b" }];
  assert.deepEqual(h.order(both).ordered.map((c) => c.upstream), ["zai", "zai-b"]);
  h.noteWall("zai", { kind: "out" });
  assert.deepEqual(h.order(both), { ordered: [{ upstream: "zai-b" }, { upstream: "zai" }], parked: ["zai"] });
  h.recordSuccess("zai", {});
  assert.deepEqual(h.order(both).parked, []);
});

describe("through the front door", () => {
  /** @type {string} */
  let root;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let zai;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let zaiB;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** zai's next answer: nothing for the fake's own. @type {(call: any) => any} */
  let answer = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-walls-"));
    zai = await fakeUpstream((call) => answer(call));
    zaiB = await fakeUpstream();
    shim = await startApp({
      configure: (cfg) => {
        // Two ways to one provider, as the drive has them; a cooldown too short to park either, so that only a hold does.
        const glm = { type: "openai-compatible", apiKey: "k1", enabled: true, wireApi: "chat-completions" };
        cfg.upstreams = [
          { id: "zai", name: "zai", baseUrl: `${zai.url}/v1`, ...glm },
          { id: "zai-b", name: "zai-b", baseUrl: `${zaiB.url}/v1`, ...glm },
        ];
        cfg.routes = [
          { match: "zai/*", upstream: "zai", upstreamModel: "{1}", enabled: true },
          { match: "zai-b/*", upstream: "zai-b", upstreamModel: "{1}", enabled: true },
          { match: "both/*", upstream: "zai", upstreamModel: "{1}", enabled: true, fallbacks: [{ upstream: "zai-b", upstreamModel: "glm-5.3-flash" }] },
        ];
        // both/*'s backup is tried: failover is off until switched on (the owner's of 11-09).
        cfg.rules.resilience = { ...(cfg.rules.resilience || {}), failover: true, cooldownBaseSeconds: 0.001, cooldownMaxSeconds: 0.001 };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await zai.close();
    await zaiB.close();
    await removeDirs(root);
  });
  const ask = (/** @type {string} */ model) => shim.post("/v1/messages", { model, max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
  const healthOf = async (/** @type {string} */ id) => (await (await shim.api("/api/usage/upstreams?hours=1")).json()).health[id];
  const problemOf = async (/** @type {string} */ model) => (await (await shim.api(`/api/subagents/model-problem?model=${encodeURIComponent(model)}`)).json()).problem;
  const OUT_BODY = { status: 429, json: { error: { code: "1113", message: ZAI_OUT } } };
  const held = `zai cannot serve now: this account's allowance is used up ("${ZAI_OUT}") — for 15 min more, or until a call there succeeds`;
  const settle = () => new Promise((r) => setTimeout(r, 20));

  // (fails before: yes — zai's 1113 cooled zai down for 10 s and taught its model a ceiling; the pool lent its seats, a
  // model on it could run an agent, and the next request went to it first)
  test("zai's 1113 holds zai: the record, the Providers page's health, the pool's rows and a model's problem say so, and the failover goes to zai-b first", async () => {
    answer = () => OUT_BODY;
    const r = await ask("zai/glm-5.3-flash");
    assert.equal(r.status, 429, await r.text());
    assert.equal(zai.received.length, 1);
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    const changes = /** @type {string[]} */ (rec.changes || []);
    assert.deepEqual(changes.filter((c) => c === `health: ${held}`).length, 1, changes.join("\n"));
    assert.ok(changes.includes("concurrency: zai says it cannot serve this account (HTTP 429) — not its rate, so it teaches no ceiling"), changes.join("\n"));
    const zh = await healthOf("zai");
    assert.deepEqual([zh.wall.kind, zh.wall.said, zh.wall.status, zh.wall.reset, zh.ceilings], ["out", ZAI_OUT, 429, null, []]);
    assert.ok(zh.wall.leftMs > HOLD_MS - 60_000 && zh.wall.leftMs <= HOLD_MS, String(zh.wall.leftMs));
    assert.equal(await problemOf("zai/glm-5.3-flash"), held);
    assert.equal(await problemOf("zai-b/glm-5.3-flash"), null);
    assert.equal(await problemOf("both/glm-5.3-flash"), null, "its fallback serves");
    const pool = await shim.api("/api/subagents/seats", { method: "POST", body: { pool: [{ model: "zai/glm-5.3-flash" }, { model: "zai-b/glm-5.3-flash" }] } });
    const { seats } = await pool.json();
    assert.deepEqual(seats.map((/** @type {any} */ s) => [s.model, s.lent !== 0, s.problem]), [["zai/glm-5.3-flash", false, held], ["zai-b/glm-5.3-flash", true, null]]);
    await settle(); // its cooldown is over: only the hold parks it now
    const fell = await ask("both/glm-5.3-flash");
    assert.equal(fell.status, 200, await fell.text());
    assert.deepEqual([zai.received.length, zaiB.received.length], [1, 1], "zai-b first; zai not asked");
  });

  // (fails before: yes — nothing was held, so nothing was let go)
  test("a call there that succeeds, a change of its key in Settings and Reset each let it go; an account holds until then", async () => {
    answer = () => undefined;
    const ok = await ask("zai/glm-5.3-flash"); // held, but its route's only upstream: tried last, and so tried
    assert.equal(ok.status, 200, await ok.text());
    assert.deepEqual([(await healthOf("zai")).wall, await problemOf("zai/glm-5.3-flash")], [null, null], "a success");
    answer = () => OUT_BODY;
    await (await ask("zai/glm-5.3-flash")).text();
    assert.equal((await healthOf("zai")).wall?.kind, "out");
    const config = async () => (await (await shim.api("/api/state")).json()).config;
    /** @param {(u: any) => any} change */
    const putZai = async (change) => {
      const cfg = await config();
      const put = await shim.api("/api/config", { method: "PUT", body: { ...cfg, upstreams: cfg.upstreams.map((/** @type {any} */ u) => (u.id === "zai" ? change(u) : u)) } });
      assert.equal(put.status, 200, await put.text());
    };
    await putZai((u) => ({ ...u, name: "zai (main)" }));
    assert.equal((await healthOf("zai")).wall?.kind, "out", "a change that is not its way to the provider keeps it held");
    await putZai((u) => ({ ...u, apiKey: "k2" }));
    assert.equal((await healthOf("zai")).wall, null, "a new key");
    answer = () => ({ status: 401, json: { error: { message: "Incorrect API key provided: k2.", type: "invalid_request_error", code: "invalid_api_key" } } });
    await (await ask("zai/glm-5.3-flash")).text();
    const key = (await healthOf("zai")).wall;
    assert.deepEqual([key.kind, key.until, key.leftMs], ["account", null, null]);
    assert.equal(await problemOf("zai/glm-5.3-flash"), `zai refuses this account or its key ("Incorrect API key provided: k2.") — until it is fixed in Settings, or Reset on the Providers page`);
    assert.equal((await shim.api("/api/health/zai/reset", { method: "POST" })).status, 200);
    assert.equal((await healthOf("zai")).wall, null, "Reset");
  });

  // (fails before: yes — the loop's round was tried ten times into zai's 1113, over about two and a half minutes)
  test("a turn of Filament's loop on zai, out of its allowance, calls it once and fails at once", async () => {
    answer = () => OUT_BODY;
    const before = zai.received.length;
    const r = await shim.house("/v1/messages", { model: "agent/zai/glm-5.3-flash", max_tokens: 400, stream: false, messages: [{ role: "user", content: "go" }] }, { "x-filament-cwd": root, "x-session-id": "walls-loop" });
    await r.text();
    assert.equal(zai.received.length - before, 1);
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.ok((rec.changes || []).includes(`agent: round 1 failed (zai: out, not tried again — ${ZAI_OUT})`), (rec.changes || []).join("\n"));
    await shim.api("/api/health/zai/reset", { method: "POST" });
  });

  // (fails before: yes — an error inside a 200 stream's first event cooled zai down and went on to zai-b, holding nothing)
  test("zai's 1113 said inside a 200 stream's first event holds zai, as one said in its status does", async () => {
    answer = () => ({ status: 200, sse: [{ data: { error: { code: "1113", message: ZAI_OUT } } }] });
    const was = [zai.received.length, zaiB.received.length];
    const r = await shim.post("/v1/messages", { model: "both/glm-5.3-flash", max_tokens: 50, stream: true, messages: [{ role: "user", content: "hi" }] });
    assert.equal(r.status, 200);
    await r.text();
    assert.deepEqual([zai.received.length - was[0], zaiB.received.length - was[1]], [1, 1], "zai's stream refused, zai-b answered");
    const zh = await healthOf("zai");
    assert.deepEqual([zh.wall?.kind, zh.wall?.said, zh.wall?.status], ["out", ZAI_OUT, null]);
    const rec = await shim.record(r.headers.get("x-filament-request-id"));
    assert.ok((rec.changes || []).includes(`health: ${held}`), (rec.changes || []).join("\n"));
    await shim.api("/api/health/zai/reset", { method: "POST" });
  });
});

// ---------------------------------------------------------------------------------------------------
// The lead hears it
// ---------------------------------------------------------------------------------------------------

describe("the lead", () => {
  const POOL = [{ model: "zai/glm-5.3-flash", seats: 2 }, { model: "zai-b/glm-5.3-flash", seats: 2 }];
  const HELD = `zai cannot serve now: this account's allowance is used up ("${ZAI_OUT}") — for 15 min more, or until a call there succeeds`;
  /** A team on that pool, and the providers held as the health board would hold them, by why. */
  const team = () => {
    /** @type {Map<string, string>} */
    const held = new Map();
    const w = watched({ sub: { pool: POOL }, problem: (m) => held.get(m.split("/")[0]) ?? null });
    return { w, held, l: leadOf(w.registry, w.dir) };
  };
  /**
   * A run's failure on its provider, as the loop words it.
   * @param {"busy" | "rate" | "out" | "account"} kind
   * @param {{ said?: string, status?: number, tries?: number, began?: number, at?: number, resets?: number | null }} [o]
   */
  const onProvider = (kind, o = {}) =>
    worded({ what: "round 3's model call", where: "glm-5.3-flash at zai", said: o.said ?? ZAI_OUT, code: null, status: o.status ?? 429, tries: o.tries ?? 1, began: o.began ?? 0, at: o.at ?? 2_000, streamed: { thinking: 0, text: 0 }, kept: "2 finished rounds are kept", next: null, cause: { kind, provider: "zai", resets: o.resets ?? null } });

  /** A worker's edit, which its message sent anew would make twice: so it goes on down no row (`movesOn`). @param {ReturnType<typeof watched>} w @param {string} id */
  const edits = (w, id) => w.registry.relay(id, { type: "tool-end", id: "toolu_e", name: "edit", ok: true });

  // (fails before: yes — the owner's plan of 11-05: fallback down the rows; a worker on the pool's first row stopped
  // there, where the pool's next could run)
  test("a worker that changed nothing goes on down the pool's rows: out on zai, it runs on zai-b, and its lead hears its report", async () => {
    const { w, held, l } = team();
    const { id, r } = await running(w, l);
    held.set("zai", HELD);
    r.finish({ status: "failed", report: "", error: "round 3's model call failed", failure: onProvider("out") });
    const next = await w.run(2);
    next.attach();
    await until(() => w.registry.get(id)?.runId === next.runId, "its run on the next row");
    assert.equal(w.registry.get(id)?.model, "zai-b/glm-5.3-flash", "the pool's next row");
    next.finish({ status: "done", report: "FIXED" });
    await w.registry.settled(id);
    const said = l.door.inbox.take().map((d) => d.text);
    assert.ok(said.at(-1)?.includes("FIXED") && !said.some((t) => t.includes("stopped on its provider")), said.join("\n"));
    l.door.close();
  });

  // (fails before: yes — the lead read "failed (round 3's model call … failed: …)", its brief again and "(no report)",
  // with no reading of the provider's words and no choices; a follow-up took a seat on zai, and so did the next launch)
  test("a worker whose provider is out of its allowance, once it changed something: one line — the provider's words, not tried again, the pool's next model; its follow-up is refused, and the next launch takes zai-b", async () => {
    const { w, held, l } = team();
    const { id, r } = await running(w, l);
    assert.equal(w.registry.get(id)?.model, "zai/glm-5.3-flash", "the pool's first row");
    held.set("zai", HELD);
    edits(w, id);
    r.finish({ status: "failed", report: "", error: "round 3's model call failed", failure: onProvider("out") });
    await w.registry.settled(id);
    const [d] = l.door.inbox.take();
    assert.equal(
      d.text,
      `[Filament: your builder ${id} ("Fix the parser") stopped on its provider, not on its task: zai says this account's allowance is used up — "${ZAI_OUT}" (HTTP 429). It was not tried again, and the pool skips zai for 15 min. What it changed so far is in your folder. You can launch its brief again as a new builder, which the pool puts on zai-b/glm-5.3-flash now; follow it up with worker once zai serves again, keeping its conversation; or leave it, and tell the developer.]`,
    );
    const f = await l.tools.worker(l.call({ agent_id: id, prompt: "go on" }));
    assert.deepEqual([f.ok, f.text], [false, `Nothing sent: builder ${id} runs on zai/glm-5.3-flash, and ${HELD}. Launch its brief again as a new builder, which the pool puts on zai-b/glm-5.3-flash now, or follow it up once it can run.`]);
    const next = await running(w, l, 2);
    assert.equal(w.registry.get(next.id)?.model, "zai-b/glm-5.3-flash", "the pool lends no seat on zai");
    next.r.finish({ status: "done", report: "FIXED" });
    await w.registry.settled(next.id);
    l.door.close();
  });

  // (fails before: yes — the words named the pool's next model, though a new launch runs on its team's models first)
  test("a worker whose team names its models: a new launch is said on the team's models, not the pool's (U13-D8)", async () => {
    const { w, held, l } = team();
    const own = { ...l, call: (/** @type {any} */ input) => ({ ...l.call(input), team: { ...TEAM, models: ["zai/glm-5.3-flash"] } }) };
    const { id, r } = await running(w, own);
    assert.equal(w.registry.get(id)?.model, "zai/glm-5.3-flash", "its team's model");
    held.set("zai", HELD);
    r.finish({ status: "failed", report: "", error: "round 3's model call failed", failure: onProvider("out") });
    await w.registry.settled(id);
    const [d] = l.door.inbox.take();
    assert.match(d.text, /You can launch its brief again once one of its team's models \(zai\/glm-5\.3-flash\) can run/);
    assert.doesNotMatch(d.text, /zai-b/, "the pool's row is not where its team's worker runs");
    l.door.close();
  });

  // (fails before: yes)
  test("an account, a busy and a rate: each its own line — a wall's choices relaunch first, a busy's and a rate's follow up first", async () => {
    /** @param {"busy" | "rate" | "account"} kind @param {Parameters<typeof onProvider>[1]} o */
    const lineOf = async (kind, o) => {
      const { w, held, l } = team();
      const { id, r } = await running(w, l);
      if (kind === "account") held.set("zai", "zai refuses this account or its key");
      edits(w, id);
      r.finish({ status: "failed", report: "", error: "round 3's model call failed", failure: onProvider(kind, o) });
      await w.registry.settled(id);
      const [d] = l.door.inbox.take();
      l.door.close();
      return d.text.replace(id, "sa_1");
    };
    assert.equal(
      await lineOf("account", { said: "invalid x-api-key", status: 401 }),
      `[Filament: your builder sa_1 ("Fix the parser") stopped on its provider, not on its task: zai refuses this account or its key — "invalid x-api-key" (HTTP 401). It was not tried again, and the pool skips zai until the developer fixes it in Settings. What it changed so far is in your folder. You can launch its brief again as a new builder, which the pool puts on zai-b/glm-5.3-flash now; follow it up with worker once zai serves again, keeping its conversation; or leave it, and tell the developer.]`,
    );
    assert.equal(
      await lineOf("busy", { said: "Overloaded", status: 529, tries: 10, began: 0, at: 140_000 }),
      `[Filament: your builder sa_1 ("Fix the parser") stopped on its provider, not on its task: zai was busy or failing for everyone — "Overloaded" (HTTP 529) — through 10 tries over 2 min. What it changed so far is in your folder. You can follow it up with worker in a few minutes, keeping its conversation; launch its brief again as a new builder, which the pool puts on zai/glm-5.3-flash now; or leave it, and tell the developer.]`,
    );
    assert.equal(
      await lineOf("rate", { said: "Rate limit reached for requests", tries: 10, began: 0, at: 140_000 }),
      `[Filament: your builder sa_1 ("Fix the parser") stopped on its provider, not on its task: zai limited this account's rate of calls — "Rate limit reached for requests" (HTTP 429) — through 10 tries over 2 min. What it changed so far is in your folder. You can follow it up with worker in a few minutes, keeping its conversation; launch its brief again as a new builder, which the pool puts on zai/glm-5.3-flash now; or leave it, and tell the developer.]`,
    );
  });

  // (fails before: yes)
  test("where no row of the pool can run, the line says so; a run that failed any other way keeps its report", async () => {
    const { w, held, l } = team();
    const { id, r } = await running(w, l);
    held.set("zai", HELD);
    held.set("zai-b", HELD.replace("zai ", "zai-b "));
    r.finish({ status: "failed", report: "", error: "round 3's model call failed", failure: onProvider("out") });
    await w.registry.settled(id);
    const [d] = l.door.inbox.take();
    assert.ok(d.text.endsWith("for 15 min. You can launch its brief again once a model of the pool can run (none can now); follow it up with worker once zai serves again, keeping its conversation; or leave it, and tell the developer.]"), d.text);
    const f = await l.tools.worker(l.call({ agent_id: id, prompt: "go on" }));
    assert.equal(f.text, `Nothing sent: builder ${id} runs on zai/glm-5.3-flash, and ${HELD}. Launch its brief again once a model of the pool can run (none can now), or follow it up once it can run.`);
    held.clear();
    const other = await running(w, l, 2);
    other.r.finish({ status: "failed", report: "", error: "Filament's time limit on the call cut it", failure: worded({ what: "round 2's model call", where: "glm-5.3-flash at zai", said: "Filament's time limit on the call cut it", code: null, status: null, tries: null, began: null, at: 2_000, streamed: null, kept: null, next: null }) });
    await w.registry.settled(other.id);
    const [o] = l.door.inbox.take();
    assert.ok(o.text.startsWith(`[Filament: your builder ${other.id} ("Fix the parser") failed`) && o.text.includes("You asked it:"), o.text);
    l.door.close();
  });

  // (fails before: yes)
  test("a builder in its own worktree: the line says where its work so far is, and that a follow-up keeps it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-walls-repo-"));
    made.push(dir);
    const git = (/** @type {string[]} */ ...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(dir, "a.txt"), "one\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    /** @type {ReturnType<typeof createSubagentRegistry>} */
    const registry = createSubagentRegistry({
      config: () => ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      context: {
        settings: () => ({ subagents: { pool: POOL }, loop: { permissions: "edit" } }),
        session: () => ({ cwd: dir, model: "m-session", projectId: null }),
        view: async () => null,
        brief: async () => null,
        modelProblem: (m) => (m.startsWith("zai/") ? HELD : null),
        mark: () => null,
        folderProblem: () => null,
      },
      call: async ({ body, headers = {} }) => {
        const id = String(headers["x-filament-subagent"]);
        const host = registry.hostOf(id);
        writeFileSync(join(String(host?.workdir), "b.txt"), "two\nthree\n");
        registry.attach(id, "run-1");
        registry.finish(id, { status: "failed", error: "round 3's model call failed", report: "", convo: body.messages, rounds: 3, toolCalls: 2, tokensIn: 1, tokensOut: 1, spentUsd: 0, roundIds: ["run-1"], failure: onProvider("out") });
        return { ok: true, status: 200, json: { content: [{ type: "text", text: "" }] }, id: "run-1", upstream: "zai", retryAfter: null, shouldRetry: null };
      },
    });
    const l = leadOf(registry, dir);
    const launched = await l.tools.agent(l.call(BRIEF));
    assert.equal(launched.ok, true, launched.text);
    const id = String(launched.agentId);
    await registry.settled(id);
    const [d] = l.door.inbox.take();
    assert.match(d.text, /It was not tried again, and the pool skips zai for 15 min\. Its work so far is in its worktree: 1 file \(\+2 −0\) — b\.txt\. You can launch its brief again as a new builder, which the pool puts on zai-b\/glm-5\.3-flash now; follow it up with worker once zai serves again, keeping its conversation and its worktree; or leave it, and tell the developer\.\]$/);
    l.door.close();
  });

  // (fails before: yes)
  test("a background sub-agent of the session's own agent: the same line, its choices the agent tool's", async () => {
    /** @type {Map<string, string>} */
    const held = new Map();
    const w = watched({ sub: { pool: POOL }, problem: (m) => held.get(m.split("/")[0]) ?? null });
    const door = w.registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: w.dir, mode: "edit", model: "m-session", thinking: null, fork: null, emit: () => {}, round: () => 2 });
    const res = await door.subagents.run({ id: "toolu_1", input: { description: "Find the retry", prompt: "find where it retries", run_in_background: true }, emit: () => {}, signal: null });
    const id = String(/sa_[0-9a-f]{8}/.exec(res.text)?.[0]);
    const r = await w.run(1);
    r.attach();
    await until(() => w.registry.get(id)?.runId === r.runId, "its run to attach");
    held.set("zai", "zai refuses this account or its key");
    edits(w, id);
    r.finish({ status: "failed", report: "", error: "round 3's model call failed", failure: onProvider("account", { said: "invalid x-api-key", status: 401 }) });
    await w.registry.settled(id);
    const [d] = door.inbox.take();
    assert.equal(
      d.text,
      `[Filament: your background sub-agent ${id} ("Find the retry") stopped on its provider, not on its task: zai refuses this account or its key — "invalid x-api-key" (HTTP 401). It was not tried again, and the pool skips zai until the developer fixes it in Settings. What it changed so far is in your folder. You can launch its task again as a new sub-agent, which the pool puts on zai-b/glm-5.3-flash now; follow it up with agent once zai serves again, keeping its conversation; or leave it, and tell the developer.]`,
    );
    door.close();
  });

  // (fails before: no — kept: the line is a message, an append in a longer one's place; no prompt or tool changed, so a
  // session's cached prompt is the same bytes)
  test("no prompt and no tool changed by it: version 30 stayed — 31 since TG2-D53's attempts, 32 since E4's no-tools line, 33 since V2-1's check", () => {
    assert.equal(PROMPT_VERSION, 129);
  });
});

// ---------------------------------------------------------------------------------------------------
// A coding agent's account
// ---------------------------------------------------------------------------------------------------

describe("a coding agent's account", () => {
  /** @type {string} */
  let root;
  /** @type {string} */
  let projDir;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-walls-acp-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    writeFileSync(join(projDir, "README.md"), "hello\n");
    const git = (/** @type {string[]} */ ...a) => execFileSync("git", a, { cwd: projDir, stdio: "ignore" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    /** Claude's adapter, as the fake plays it. @param {Record<string, string>} env */
    const claude = (env) => ({ command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_AUTH: "max", ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false });
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "spender", name: "Spender", type: "acp", acp: claude({}) },
          { id: "locked", name: "Locked", type: "acp", acp: claude({ FAKE_ACP_FAIL_KIND: "authentication_failed" }) },
          { id: "busy", name: "Busy", type: "acp", acp: claude({}) },
          // Its adapter says whom it runs as only well after its first turn failed, as Claude's checks its login in the
          // background while the first turns run.
          { id: "fresh", name: "Fresh", type: "acp", acp: claude({ FAKE_ACP_FAIL_KIND: "authentication_failed", FAKE_ACP_AUTH_DELAY_MS: "3000" }) },
        ];
        cfg.routes = ["spender", "locked", "busy", "fresh"].map((id) => ({ match: `${id}/*`, upstream: id, upstreamModel: "{1}", enabled: true }));
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /** @param {string} model @param {string} text @param {string} chat */
  const turn = async (model, text, chat) => {
    const res = await shim.post("/v1/messages", { model, max_tokens: 100, system: `Working directory: ${projDir}`, messages: [{ role: "user", content: text }] }, { "x-session-id": chat });
    return { status: res.status, body: await res.text() };
  };
  const healthOf = async (/** @type {string} */ id) => (await (await shim.api("/api/usage/upstreams?hours=1")).json()).health[id];
  const problemOf = async (/** @type {string} */ model) => (await (await shim.api(`/api/subagents/model-problem?model=${encodeURIComponent(model)}`)).json()).problem;

  // (fails before: yes — a spent plan cooled its agent down for seconds, and the pool went on lending its seats; and,
  // before the drive's fix, any word of whom the agent runs as heard after the hold let it go: its adapter's own late
  // word of the same login, and its first)
  test("a plan's spent window holds its agent until the window resets; a sign-in it refuses holds until it signs in as another login — the same login said again, or its first word said after, lets nothing go; an overload holds nothing", async () => {
    const app = /** @type {any} */ (shim.app);
    assert.notEqual((await turn("spender/sonnet", "~spent", "walls-spent")).status, 200);
    const out = await until(async () => (await healthOf("spender"))?.wall, "spender to be held");
    const row = (await (await shim.api("/api/agent-accounts")).json()).agents.find((/** @type {any} */ a) => a.upstream === "spender");
    assert.deepEqual([out.kind, out.until], ["out", row.account.freeAt], "until its window resets");
    assert.match(String(await problemOf("spender/sonnet")), /^spender cannot serve now: this account's allowance is used up \(".+"\) — for (59|60) min more, or until a call there succeeds$/);
    // Its agent says the window has room again, as at its new period: the hold goes.
    const five = { id: "five_hour", kind: "session", label: "5-hour", windowMins: 300 };
    app.accounts.report("spender", { source: "rate_limit_event", windows: [{ ...five, usedPercent: 100, resetsAt: out.until, status: "rejected" }] });
    assert.equal((await healthOf("spender")).wall?.kind, "out", "a window still spent keeps it");
    app.accounts.report("spender", { source: "rate_limit_event", windows: [{ ...five, usedPercent: 3, resetsAt: Date.now() + 5 * 3_600_000, status: "allowed" }] });
    assert.deepEqual([(await healthOf("spender")).wall, await problemOf("spender/sonnet")], [null, null]);

    // The agent said whom it runs as before its sign-in was refused: it is held as that login, and only another is a fix.
    const login = (/** @type {string} */ label, /** @type {string} */ email) => ({ kind: "account", label, plan: "max", email, organization: null, detail: null, billing: "plan" });
    app.accounts.report("locked", { source: "_auth/status_update", identity: login("Claude Max", "dev@example.com") });
    assert.notEqual((await turn("locked/sonnet", "hello", "walls-locked")).status, 200);
    const key = await until(async () => (await healthOf("locked"))?.wall, "locked to be held");
    assert.deepEqual([key.kind, key.until, key.as?.email], ["account", null, "dev@example.com"]);
    app.accounts.report("locked", { source: "rate_limit_event", windows: [{ ...five, usedPercent: 3, resetsAt: Date.now() + 5 * 3_600_000, status: "allowed" }] });
    assert.equal((await healthOf("locked")).wall?.kind, "account", "room in a window says nothing of its sign-in");
    // Its adapter's own word of the same login, as it says it once its process has started — late, under load — is
    // no fix: the store hears it as a change (another organization), and the login is the one it was held as.
    app.accounts.report("locked", { source: "_auth/status_update", identity: { ...login("Claude Max", "dev@example.com"), organization: "Other Org" } });
    assert.equal((await healthOf("locked")).wall?.kind, "account", "the same login said again");
    app.accounts.report("locked", { source: "_auth/status_update", identity: { kind: "none", label: "Not signed in", plan: null, email: null, organization: null, detail: null, billing: null } });
    assert.equal((await healthOf("locked")).wall?.kind, "account", "signed out is no fix");
    app.accounts.report("locked", { source: "_auth/status_update", identity: login("Claude Pro", "ops@example.com") });
    assert.equal((await healthOf("locked")).wall, null, "it says it is signed in as another login");

    // An agent that had not said whom it runs as when its sign-in was refused: its first word, said after, is no fix.
    assert.notEqual((await turn("fresh/sonnet", "hello", "walls-fresh")).status, 200);
    const first = await until(async () => (await healthOf("fresh"))?.wall, "fresh to be held");
    assert.deepEqual([first.kind, first.as], ["account", null]);
    const said = async () => (await (await shim.api("/api/agent-accounts")).json()).agents.find((/** @type {any} */ a) => a.upstream === "fresh")?.account?.identity;
    assert.equal((await until(said, "fresh's adapter to say whom it runs as", { timeoutMs: 20_000 })).email, "dev@example.com");
    assert.equal((await healthOf("fresh")).wall?.kind, "account", "its first word of whom it runs as");

    assert.notEqual((await turn("busy/sonnet", "~overloaded", "walls-busy")).status, 200);
    assert.equal((await healthOf("busy"))?.wall ?? null, null);
    assert.equal(await problemOf("busy/sonnet"), null);
  });
});
