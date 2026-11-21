// W9 Phase B — the operation log: everything Filament does that is NOT a model call.
//
// The unit tests here matter more than they look, because the log's whole promise is that it is CONTENT-FREE: it is
// written to disk and shown in the UI, so a caller that accidentally passes conversation text into `detail` would turn
// an observability feature into a second copy of your chats. That contract is enforced by sanitizeDetail and pinned
// below rather than left to discipline.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpLog, sanitizeDetail, OP_KIND_KEYS, OP_KINDS, NOISY_OP_KINDS, DEFAULT_OP_KINDS, WIRED_OP_KINDS } from "../src/ops.js";
import { schemaAsJson } from "../src/schema.js";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";

// ---------------------------------------------------------------- the log itself

test("operations are recorded, filtered by kind, searched, counted and bounded", () => {
  const ops = new OpLog({ dataDir: null, options: { ops: { enabled: true, logFile: "" } } });
  ops.record("health", "fake cooled down for 10s", { sub: "cooldown", level: "warn", detail: { upstream: "fake", waitMs: 10000 }, ref: { upstreamId: "fake" } });
  ops.record("config", "configuration saved (2 changes)", { sub: "save", detail: { count: 2 } });
  ops.record("compaction", "/trim wrote 4 summaries", { ms: 178846, ref: { requestId: "r1", jobId: "j1" } });
  ops.record("search", "a memory search", { detail: { n: 3 } });

  assert.equal(ops.list({}).length, 4, "everything, newest first");
  assert.equal(ops.list({})[0].kind, "search", "newest first");
  assert.deepEqual(ops.list({ kinds: "health" }).map((o) => o.title), ["fake cooled down for 10s"], "one kind as a string");
  assert.deepEqual(ops.list({ kinds: ["health", "config"] }).map((o) => o.kind).sort(), ["config", "health"], "several kinds");
  assert.equal(ops.list({ q: "cooled" }).length, 1, "search matches the title");
  assert.equal(ops.list({ q: "10000" }).length, 1, "and a detail value");
  assert.equal(ops.counts().health, 1, "counts per kind, so a chip can say health (4)");
  assert.equal(ops.counts().engine, 0, "including kinds with nothing in them");
  assert.equal(ops.list({ limit: 2 }).length, 2, "limit is respected");

  const one = ops.list({ kinds: "compaction" })[0];
  assert.equal(one.ms, 178846, "duration survives");
  assert.deepEqual(one.ref, { requestId: "r1", jobId: "j1" }, "and the links to the request and job that caused it");
  assert.equal(one.level, "info", "level defaults to info");

  assert.equal(ops.record("nonsense", "x"), null, "an unknown kind is refused rather than stored unlabelled");
  assert.equal(ops.list({ kinds: "nonsense" }).length, 0);
});

test("the ring is bounded and the oldest entries fall off", () => {
  // 10 is the floor: a smaller ask is raised rather than silently honoured, so a typo cannot shrink the audit trail to
  // nothing. The test uses the floor exactly, so it also pins that the floor is not so high that it swallows the setting.
  const ops = new OpLog({ dataDir: null, options: { ops: { enabled: true, keepLast: 10, logFile: "" } } });
  for (let i = 0; i < 14; i++) ops.record("health", `event ${i}`);
  assert.equal(ops.list({ limit: 100 }).length, 10, "only keepLast are held");
  assert.equal(ops.list({ limit: 100 })[0].title, "event 13", "and they are the newest");
  assert.equal(ops.list({ limit: 100 }).at(-1).title, "event 4", "the oldest fell off");
});

test("the log can be switched off, and off means off", () => {
  const ops = new OpLog({ dataDir: null, options: { ops: { enabled: false, logFile: "" } } });
  assert.equal(ops.record("health", "should not be stored"), null);
  assert.equal(ops.list({}).length, 0);
});

test("detail is bounded so the log can never become a second copy of a conversation", () => {
  const long = "x".repeat(5000);
  const d = sanitizeDetail({ text: long, n: 42, ok: true, nil: null, arr: Array.from({ length: 40 }, (_, i) => i), obj: { a: 1 } });
  assert.equal(d.text.length, 161, "a long string is cut to 160 chars plus an ellipsis");
  assert.ok(d.text.endsWith("…"));
  assert.equal(d.n, 42, "numbers pass through");
  assert.equal(d.ok, true, "booleans pass through");
  assert.equal(d.nil, undefined, "nulls are dropped");
  assert.equal(d.arr.length, 12, "arrays are capped");
  assert.equal(d.obj, "[obj]", "nested objects are not serialised into the log");
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
  const capped = sanitizeDetail(many);
  assert.ok(Object.keys(capped).length <= 25, `key count is capped (got ${Object.keys(capped).length})`);
  assert.equal(sanitizeDetail(null), undefined, "and a non-object detail is dropped");
});

test("operations survive a restart via the JSONL log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-ops-"));
  const a = new OpLog({ dataDir: dir, options: { ops: { enabled: true, logFile: "ops.jsonl" } } });
  a.record("config", "configuration saved", { sub: "save", detail: { count: 1 } });
  a.record("health", "upstream cooled down", { level: "warn", ref: { upstreamId: "u1" } });
  await a.flush();
  assert.ok(existsSync(join(dir, "ops.jsonl")), "written to disk");
  const lines = readFileSync(join(dir, "ops.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 2, "one JSON line per operation");

  const b = new OpLog({ dataDir: dir, options: { ops: { enabled: true, logFile: "ops.jsonl" } } });
  const restored = b.list({});
  assert.equal(restored.length, 2, "both came back");
  assert.equal(restored[0].title, "upstream cooled down", "in order, newest first");
  assert.equal(restored[0].level, "warn", "with their level");
  assert.deepEqual(restored[0].ref, { upstreamId: "u1" }, "and their links");
  // A corrupt line must not blank the rest of the log.
  writeFileSync(join(dir, "ops.jsonl"), `${lines[0]}\nnot json at all\n${lines[1]}\n`);
  const c = new OpLog({ dataDir: dir, options: { ops: { enabled: true, logFile: "ops.jsonl" } } });
  assert.equal(c.list({}).length, 2, "a corrupt line is skipped, not fatal");
  rmSync(dir, { recursive: true, force: true });
});

test("the noisy kinds are recorded but hidden by default — the owner's choice, encoded", () => {
  assert.ok(NOISY_OP_KINDS.length >= 4, `the firehose kinds exist: ${NOISY_OP_KINDS}`);
  for (const k of ["search", "engineop", "tool", "stream"]) assert.ok(NOISY_OP_KINDS.includes(k), `${k} is a noisy kind`);
  for (const k of ["health", "config", "job", "compaction", "learner", "engine", "agent", "alert", "log"]) {
    assert.ok(DEFAULT_OP_KINDS.includes(k), `${k} is shown by default`);
  }
  const ops = new OpLog({ dataDir: null, options: { ops: { enabled: true, logFile: "" } } });
  ops.record("search", "a search"); // noisy, but still RECORDED
  assert.equal(ops.list({}).length, 1, "a noisy kind is stored, so switching its chip on shows history rather than nothing");
  assert.deepEqual(ops.shownKinds, DEFAULT_OP_KINDS, "and the default view excludes it");
  // The browser builds its chips from the schema, so the three lists must be one list. A kind the recorder accepts but
  // the schema does not name is a chip the user cannot switch on; the reverse is a dead chip.
  const sch = schemaAsJson();
  assert.deepEqual(Object.keys(sch.opKinds).sort(), OP_KIND_KEYS.slice().sort(), "the schema names exactly the kinds the recorder accepts");
  for (const k of OP_KIND_KEYS) { assert.ok(OP_KINDS[k].label && OP_KINDS[k].hint, `${k} has a label and an explanation`); assert.equal(sch.opKinds[k].noisy, OP_KINDS[k].noisy, `${k}'s noisy flag agrees`); }
  const knob = sch.config?.observability?.ops?.kinds;
  assert.ok(knob, "observability.ops.kinds is in the config schema, so it is editable in the UI and documented");
  assert.deepEqual(knob.options.slice().sort(), OP_KIND_KEYS.slice().sort(), "and the settings list offers the same kinds");
  assert.deepEqual(knob.default.slice().sort(), DEFAULT_OP_KINDS.slice().sort(), "defaulting to the significant ones");
});

// ---------------------------------------------------------------- through the server

let app, port, dataDir;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "filament-ops-srv-"));
  const cfg = defaultConfig();
  cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  // An upstream that nothing is listening on, so a request to it fails and the health board cools it down.
  cfg.upstreams = [{ id: "dead", name: "dead", type: "anthropic-compatible", baseUrl: "http://127.0.0.1:1", apiKey: "s", authStyle: "x-api-key" }];
  cfg.routes = [{ match: "dead-*", upstream: "dead", upstreamModel: "{model}" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } });
  port = (await app.start()).port;
});
after(async () => { await app.stop(); rmSync(dataDir, { recursive: true, force: true }); });

const H = { "content-type": "application/json", "x-api-key": "k" };
const getOps = async (qs = "") => (await (await fetch(`http://127.0.0.1:${port}/api/ops?${qs}`, { headers: H })).json());

test("GET /api/ops answers, and kinds=all widens past the configured default", async () => {
  const j = await getOps("limit=50");
  assert.ok(Array.isArray(j.ops), "an ops array");
  assert.ok(j.counts && typeof j.counts === "object", "counts per kind for the chips");
  assert.deepEqual(j.kinds, DEFAULT_OP_KINDS, "the default view is the significant kinds");
  const wide = await getOps("limit=50&kinds=all");
  assert.deepEqual(wide.kinds, OP_KIND_KEYS, "kinds=all asks for every kind, noisy ones included");
  assert.equal(wide.countsAllKinds, true);
  const bogus = await getOps("limit=50&kinds=not-a-kind");
  assert.deepEqual(bogus.kinds, DEFAULT_OP_KINDS, "an unrecognised kind list falls back rather than erroring");
});

test("a failing upstream produces a health operation naming the cooldown", async () => {
  await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "dead-x", max_tokens: 10, stream: false, messages: [{ role: "user", content: "hi" }] }) }).catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
  const health = (await getOps("limit=50&kinds=health")).ops;
  assert.ok(health.length >= 1, `a health event was recorded (${health.length})`);
  const cool = health.find((o) => o.sub === "cooldown");
  assert.ok(cool, `and specifically a cooldown, not just a failure: ${health.map((o) => o.sub).join(",")}`);
  assert.equal(cool.level, "warn");
  assert.equal(cool.ref.upstreamId, "dead", "it names the upstream, which is what the W8 incident lacked");
  assert.ok(cool.detail.failures >= 1 && cool.detail.waitMs > 0, "with the failure count and the wait");
});

test("saving the configuration leaves an audit trail with the redacted diff", async () => {
  const cur = (await (await fetch(`http://127.0.0.1:${port}/api/state`, { headers: H })).json()).config;
  const next = JSON.parse(JSON.stringify(cur));
  next.observability.keepLastRequests = 777;
  const r = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { ...H, "x-filament-ui": "1" }, body: JSON.stringify(next) });
  assert.equal(r.status, 200, await r.text());
  await new Promise((res) => setTimeout(res, 100));
  const saves = (await getOps("limit=50&kinds=config")).ops.filter((o) => o.sub === "save");
  assert.ok(saves.length >= 1, "the save was recorded");
  const s = saves[0];
  assert.ok(s.detail.count >= 1, `it says how many things changed (${s.detail.count})`);
  const flat = JSON.stringify(s.detail.changes || []);
  assert.ok(/keepLastRequests/.test(flat), `and which: ${flat.slice(0, 200)}`);
  assert.ok(/777/.test(flat), "with the new value, so the trail is useful");
  assert.ok(!/\[obj\]/.test(flat), "the diff was flattened to strings, not stored as object placeholders");
  // Restore, so the rest of the file runs on the config it expects.
  next.observability.keepLastRequests = 500;
  await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { ...H, "x-filament-ui": "1" }, body: JSON.stringify(next) });
});

test("a credential in a custom HEADER is masked too — the shape redactSecrets cannot catch", async () => {
  // The review proved this one: the old path mask knew only `headers.set.`, so `upstreams.<id>.headers.Authorization`
  // sailed through, and redactSecrets matches value SHAPES (sk-, AIza, Bearer, quoted JSON pairs) — a base64 Basic-auth
  // blob and a raw hex token have no shape at all. Both landed verbatim in a file on disk.
  const cur = (await (await fetch(`http://127.0.0.1:${port}/api/state`, { headers: H })).json()).config;
  const next = JSON.parse(JSON.stringify(cur));
  next.upstreams[0].headers = { ...(next.upstreams[0].headers || {}), Authorization: "Basic YWxhZGRpbjpvcGVuc2VzYW1lMjM0NQ==", "X-Custom-Token": "hexfeed1234567890abcdef1234567890" };
  const r = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { ...H, "x-filament-ui": "1" }, body: JSON.stringify(next) });
  assert.equal(r.status, 200, await r.text());
  await new Promise((res) => setTimeout(res, 120));
  const saves = (await getOps("limit=50&kinds=config")).ops.filter((o) => o.sub === "save");
  const flat = JSON.stringify(saves[0]?.detail || {});
  assert.ok(!/YWxhZGRpbjpvcGVuc2VzYW1l/.test(flat), `the Basic-auth blob is not in the operation: ${flat.slice(0, 300)}`);
  assert.ok(!/hexfeed1234567890/.test(flat), `nor the raw hex token: ${flat.slice(0, 300)}`);
  assert.ok(/headers/.test(flat), "but the fact that a header changed is still visible — masked, not dropped");
  await app.ops.flush();
  const onDisk = existsSync(join(dataDir, "ops.jsonl")) ? readFileSync(join(dataDir, "ops.jsonl"), "utf8") : "";
  assert.ok(!/YWxhZGRpbjpvcGVuc2VzYW1l/.test(onDisk) && !/hexfeed1234567890/.test(onDisk), "and neither reached ops.jsonl, which is the part that persists");
});

test("a non-secret path is NOT masked, so the trail stays useful", async () => {
  // Over-masking is its own failure: an audit trail of •••• everywhere tells you nothing. `sliceSummaryTokens`
  // contains the substring "token", which is exactly why the mask tests whole path segments rather than substrings.
  const cur = (await (await fetch(`http://127.0.0.1:${port}/api/state`, { headers: H })).json()).config;
  const next = JSON.parse(JSON.stringify(cur));
  next.rules.trim = { ...next.rules.trim, sliceSummaryTokens: 4321 };
  const r = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { ...H, "x-filament-ui": "1" }, body: JSON.stringify(next) });
  assert.equal(r.status, 200, await r.text());
  await new Promise((res) => setTimeout(res, 120));
  const saves = (await getOps("limit=50&kinds=config")).ops.filter((o) => o.sub === "save");
  const flat = JSON.stringify(saves[0]?.detail || {});
  assert.ok(/sliceSummaryTokens/.test(flat) && /4321/.test(flat), `an ordinary number is recorded in clear: ${flat.slice(0, 300)}`);
  assert.ok(!/••••/.test(flat), "and was not masked");
});

test("engineLive() reports in-flight engine calls without rebuilding the whole memory status", async () => {
  // The Live tab polls this every 1.5 s. `/api/memory/status` would also answer it, but that rebuilds everything
  // including `archive.counts()` — nine COUNT(*)/SUM(bytes) scans — for one small field. This pins the shape the UI
  // renders, which was code-present but unobserved until a stubbed engine proved it.
  const { MemoryService } = await import("../src/memory-service.js");
  const svc = new MemoryService({ getConfig: () => ({ memory: { enabled: false } }), dataDir });

  // No engine installed: honest, and the UI must not render a panel full of zeroes.
  const off = svc.engineLive();
  assert.equal(off.installed, false, "not installed");
  assert.equal(off.pending, 0);
  assert.equal(off.calls, 0);

  // Installed and busy. `status()` is the engine's own cheap in-memory counters — assert we map them, and that a
  // missing counter degrades to 0 rather than undefined (which would render as "NaN" or blank).
  let asked = 0;
  svc.store = { status: () => { asked++; return { state: "ready", pid: 4242, calls: 137, pending: 2, failures: 0, lastError: null }; } };
  const live = svc.engineLive();
  assert.deepEqual({ installed: live.installed, state: live.state, pid: live.pid, calls: live.calls, pending: live.pending, failures: live.failures },
    { installed: true, state: "ready", pid: 4242, calls: 137, pending: 2, failures: 0 }, "the engine's live counters are passed through");
  assert.equal(asked, 1, "and it asks the engine once, not once per field");

  svc.store = { status: () => ({ state: "degraded", lastError: "sidecar exited" }) };
  const bad = svc.engineLive();
  assert.equal(bad.state, "degraded");
  assert.equal(bad.pending, 0, "an absent counter is 0, not undefined");
  assert.equal(bad.lastError, "sidecar exited", "and the last error survives, truncated to something storable");

  // The endpoint the tab actually calls, on the real server: cheap, and shaped the way the UI reads it.
  const j = await (await fetch(`http://127.0.0.1:${port}/api/jobs`, { headers: H })).json();
  assert.ok(j.engine && typeof j.engine === "object", "/api/jobs carries the engine block");
  for (const k of ["installed", "state", "calls", "pending"]) assert.ok(k in j.engine, `/api/jobs engine has \`${k}\`, which the Live tab renders`);
  assert.ok(Array.isArray(j.jobs), "and the running jobs, which is the only reason the tab used to poll the heavy endpoint");
});

test("a secret in the configuration is masked in the audit trail, not written to disk", async () => {
  const cur = (await (await fetch(`http://127.0.0.1:${port}/api/state`, { headers: H })).json()).config;
  const next = JSON.parse(JSON.stringify(cur));
  next.upstreams[0].apiKey = "sk-live-ABCDEFGHIJKLMNOPQRSTUVWX";
  const r = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { ...H, "x-filament-ui": "1" }, body: JSON.stringify(next) });
  assert.equal(r.status, 200, await r.text());
  await new Promise((res) => setTimeout(res, 120));
  const saves = (await getOps("limit=50&kinds=config")).ops.filter((o) => o.sub === "save");
  const flat = JSON.stringify(saves[0]?.detail || {});
  assert.ok(!/ABCDEFGHIJKLMNOP/.test(flat), `the secret value is not in the operation: ${flat.slice(0, 300)}`);
  await app.ops.flush();
  const onDisk = existsSync(join(dataDir, "ops.jsonl")) ? readFileSync(join(dataDir, "ops.jsonl"), "utf8") : "";
  assert.ok(!/ABCDEFGHIJKLMNOP/.test(onDisk), "and not in ops.jsonl either, which is the part that persists");
});

test("the agent lifecycle has a recorder, and calling it lands as an `agent` operation", async () => {
  // `agent` was declared in OP_KINDS from the start but nothing emitted it, so its chip sat dimmed and the Agents tab
  // had a snapshot with no history. The producer is injected exactly like `memory.onJobEvent`: the server assigns
  // `bridge.onOp`, and acp.js/cursor-sdk.js stay independent of the op log. This pins BOTH halves of that contract —
  // the injection existing (server side) and an injected call reaching /api/ops (recorder side). Either half alone
  // leaves the feature silently dead, and no other test can see it: `#op` is private and only fires on a real turn.
  assert.equal(typeof app.acp.onOp, "function", "the bridge was given a recorder, so agent events have somewhere to go");
  assert.ok(WIRED_OP_KINDS.includes("agent"), "`agent` is declared wired, so its chip is not dimmed");
  assert.ok(DEFAULT_OP_KINDS.includes("agent"), "and shown by default, so the Agents tab history is not empty on arrival");

  app.acp.onOp("started an agent session on fake (abc123def456)", {
    sub: "new", detail: { upstream: "fake", method: "session/new", sessionId: "abc123def456" },
    ref: { upstreamId: "fake", sessionId: "abc123def456" },
  });
  await new Promise((r) => setTimeout(r, 80));
  const agents = (await getOps("limit=50&kinds=agent")).ops;
  assert.ok(agents.length >= 1, "and calling the recorder produces an operation the API serves");
  const op = agents.find((o) => /abc123def456/.test(o.title));
  assert.ok(op, `the recorded operation is retrievable: ${JSON.stringify(agents.map((o) => o.title)).slice(0, 300)}`);
  assert.equal(op.kind, "agent");
  assert.equal(op.sub, "new");
  assert.equal(op.detail.bridge, "acp", "tagged with the bridge that produced it — two bridges share this one kind");
  assert.equal(op.ref.upstreamId, "fake", "and carrying the upstream, which is how the Agents tab groups it");
  await app.ops.flush();
  const onDisk = existsSync(join(dataDir, "ops.jsonl")) ? readFileSync(join(dataDir, "ops.jsonl"), "utf8") : "";
  assert.ok(/"kind":"agent"/.test(onDisk), "an agent operation persists, so the history survives a restart");
});

test("both agent bridges were given a recorder, and a recorder that throws cannot break a turn", async () => {
  // Two bridges share the one `agent` kind — the ACP process bridge and the in-process Cursor SDK one — so each
  // operation is tagged with which produced it. Without the tag the Agents tab cannot say whether a session was
  // started by a subprocess or by the SDK, and the two fail in completely different ways.
  const { AcpBridge } = await import("../src/acp.js");
  const { CursorSdkBridge } = await import("../src/cursor-sdk.js");
  const seen = [];
  const b = new AcpBridge({ log: () => {}, stateFile: null });
  b.onOp = (title, opts) => seen.push({ title, ...(opts || {}) });

  // A kill from the dashboard: the one agent event a user causes deliberately, and until now it left no trace.
  const fakeProc = { killed: false, kill() { this.killed = true; } };
  b.procs.set("fake|sonnet", fakeProc);
  assert.equal(b.killProcess("fake|sonnet"), true, "the process was killed");
  assert.equal(fakeProc.killed, true);
  assert.equal(seen.length, 1, "and the kill was recorded");
  assert.equal(seen[0].sub, "kill");
  assert.equal(seen[0].level, "warn", "a kill is a warning: it interrupts a turn");
  assert.match(seen[0].title, /killed from the console/);
  assert.equal(seen[0].ref.upstreamId, "fake", "the upstream is in the ref, which is what the Agents tab groups by");
  assert.equal(b.killProcess("not-a-process"), false, "an unknown key is a no-op");
  assert.equal(seen.length, 1, "and a no-op records nothing, so the log is not padded with non-events");

  // The SDK bridge has the same hook and the same swallow-on-throw guarantee.
  const sdk = new CursorSdkBridge({ log: () => {}, stateFile: null });
  const sdkSeen = [];
  sdk.onOp = (title, opts) => sdkSeen.push({ title, ...(opts || {}) });
  assert.equal(sdk.killProcess(), false, "the SDK bridge cannot kill an in-process agent, and says so");
  assert.equal(sdkSeen.length, 0, "so it records nothing — an impossible action is not an event");
  assert.equal(typeof sdk.killProcess, "function");

  // A throwing recorder must not break an agent turn: observability is never load-bearing.
  const b2 = new AcpBridge({ log: () => {}, stateFile: null });
  let calls = 0;
  b2.onOp = () => { calls++; throw new Error("disk on fire"); };
  b2.procs.set("fake|abc", { kill() {} });
  assert.equal(b2.killProcess("fake|abc"), true, "the kill still succeeds when the recorder throws");
  assert.equal(calls, 1, "the recorder was still called once");
  // And with observability off entirely — no recorder injected — everything must keep working.
  const b3 = new AcpBridge({ log: () => {}, stateFile: null });
  b3.procs.set("x|y", { kill() {} });
  assert.equal(b3.killProcess("x|y"), true, "a bridge with no recorder injected still kills and still reports it");
});

test("the learner's recorder is injected on the service, and calling it lands as a `learner` operation", async () => {
  // `learner` was declared in OP_KINDS with nothing emitting it, so its chip sat dimmed and the only record of a
  // learning run was `learner.recent` — in-RAM, capped at 100, gone on restart. This pins the server half of the
  // contract; memory-learn.test.js pins the producer half against a real archive.
  assert.equal(typeof app.memory.onLearnerOp, "function", "the memory service was given a recorder for learning runs");
  assert.ok(WIRED_OP_KINDS.includes("learner"), "`learner` is declared wired, so its chip is not dimmed");
  assert.ok(DEFAULT_OP_KINDS.includes("learner"), "and shown by default, so the history is there on arrival");

  app.memory.onLearnerOp("learned from session ch_abc123 (idle): 2 notes", {
    sub: "done", ms: 1200, detail: { reason: "idle", items: 2, deduped: 0, advanced: true }, ref: { chainId: "ch_abc123" },
  });
  await new Promise((r) => setTimeout(r, 80));
  const runs = (await getOps("limit=50&kinds=learner")).ops;
  const op = runs.find((o) => /ch_abc123/.test(o.title));
  assert.ok(op, `the recorded operation is retrievable: ${JSON.stringify(runs.map((o) => o.title)).slice(0, 300)}`);
  assert.equal(op.kind, "learner");
  assert.equal(op.sub, "done");
  assert.equal(op.ms, 1200, "the duration survives, which is how a slow summarizer shows up");
  assert.equal(op.detail.items, 2);
  assert.equal(op.ref.chainId, "ch_abc123", "linked to the session, so the row can deep-link like the others");
  await app.ops.flush();
  const onDisk = existsSync(join(dataDir, "ops.jsonl")) ? readFileSync(join(dataDir, "ops.jsonl"), "utf8") : "";
  assert.ok(/"kind":"learner"/.test(onDisk), "a learning run persists, which is the entire point — `recent` does not");
});

test("the learner hook is forwarded by the service, so it survives a memory close and reopen", async () => {
  // The reason the recorder is assigned to `memory.onLearnerOp` and forwarded, rather than straight to
  // `memory.learner.onOp` from server.js: the learner is constructed inside start() when a memory folder is opened
  // and nulled by stop(). A direct assignment at boot would attach to null, and then to a dead object after the
  // first reopen — the chip would work in the test that never reopens memory and go silently dead in production.
  const { MemoryService } = await import("../src/memory-service.js");
  const dir = mkdtempSync(join(tmpdir(), "filament-learnfwd-"));
  let memCfg = { enabled: true, folder: join(dir, "m1") };
  const svc = new MemoryService({ getConfig: () => ({ memory: memCfg }), dataDir: dir, log: () => {} });
  const seen = [];
  svc.onLearnerOp = (title, opts) => seen.push({ title, ...(opts || {}) });
  try {
    svc.start();
    assert.ok(svc.learner, "memory opened, so there is a learner");
    assert.equal(typeof svc.learner.onOp, "function", "and it was given a recorder at construction, by the service");
    svc.learner.onOp("learned from session x (idle): 1 note", { sub: "done" });
    assert.equal(seen.length, 1, "which routes to the hook the server assigned");

    const first = svc.learner;
    memCfg = { enabled: true, folder: join(dir, "m2") }; // a different folder changes the signature, forcing a reopen
    svc.start();
    assert.ok(svc.learner && svc.learner !== first, "the learner was rebuilt by the reopen");
    svc.learner.onOp("learned from session y (idle): 3 notes", { sub: "done" });
    assert.equal(seen.length, 2, "and the rebuilt learner still routes to the same hook — this is what a boot-time assignment would lose");
  } finally { await svc.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
