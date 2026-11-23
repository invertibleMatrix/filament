// @ts-check
// The telemetry service (services/telemetry.js, the owner's of 11-10): armed by bin/filament.js alone; nothing sent off,
// unarmed or before the notice is shown; "app opened" at a start, a day's summary once the day is over, timed at its
// end; its own id; what it counted kept across a restart; a failed send waits for the next look; a long gap sends the
// last few days alone. Every send goes to an injected fetch: no test reaches the network.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTelemetry, TELEMETRY_URL } from "../src/services/telemetry.js";
import { createEventBus } from "../src/services/events.js";
import { PRICING_DEFAULTS } from "../src/core/schema.js";
import { removeDirs } from "./helpers/wait.js";
import { startApp } from "./helpers/app.js";
import { noticeShows } from "../src/ui/harness/lib/telemetry-notice.js";
import { telemetryWords } from "../src/ui/harness/settings/data-privacy.js";

const KNOWN_MODEL = Object.keys(PRICING_DEFAULTS)[0];
const UPSTREAMS = [
  { id: "corp-gateway-secret", type: "anthropic-compatible", baseUrl: "https://llm.internal.example-corp.net/v1", enabled: true },
  { id: "claude-work", type: "acp", acp: { command: "claude-agent-acp" }, enabled: true },
];
/** A local day's noon, as a clock reading. @param {string} day */
const noon = (day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
};

/** @param {{ dir?: string | null, armed?: boolean, telemetry?: any, env?: Record<string, string>, fail?: boolean }} [o] */
function rig({ dir = null, armed = true, telemetry = { enabled: true, noticeSeen: true }, env = {}, fail = false } = {}) {
  const cfg = { upstreams: UPSTREAMS, telemetry };
  const events = createEventBus();
  /** @type {{ url: string, body: any }[]} */
  const sent = [];
  const clock = { t: noon("2026-11-10") };
  const fetcher = { fail };
  const usageDays = /** @type {Record<string, any>} */ ({});
  const t = createTelemetry({
    dataDir: dir,
    armed,
    config: { get: () => cfg },
    usage: { dailyStore: { list: ({ from }) => (usageDays[from] ? [usageDays[from]] : []) } },
    events,
    features: () => ({ memory: true, lan: false, tailscale: false, artifacts: 2, spaces: 1, machines: 0, devices: 1 }),
    context: () => ({ version: "0.9.71", platform: "win32", arch: "x64", install: "desktop", locale: "en-US", timeZone: "Asia/Karachi" }),
    env,
    now: () => clock.t,
    every: () => ({ unref() {} }),
    stopEvery: () => {},
    fetchImpl: /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
      if (fetcher.fail) throw new Error("offline");
      sent.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 204 };
    }),
  });
  return { t, cfg, events, sent, clock, fetcher, usageDays };
}

test("unarmed (a test's or a checkout's Filament), it listens to nothing, keeps nothing and sends nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-telemetry-"));
  try {
    const { t, events, sent } = rig({ dir, armed: false });
    t.start();
    events.publish("run:a", { type: "run-start", kind: "agent-turn", meta: {} });
    await t.look();
    assert.equal(sent.length, 0);
    assert.equal(existsSync(join(dir, "telemetry.json")), false, "no file, no id");
    assert.deepEqual({ on: t.view().on, why: t.view().why }, { on: false, why: "not-armed" });
  } finally {
    removeDirs(dir);
  }
});

test("before the notice is shown nothing is sent, though the day is counted; once shown, the start's event goes (fails before: no service)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-telemetry-"));
  try {
    const { t, cfg, events, sent } = rig({ dir, telemetry: { enabled: true, noticeSeen: false } });
    t.start();
    events.publish("run:a", { type: "run-start", kind: "agent-turn", meta: {} });
    await t.look();
    assert.equal(sent.length, 0, "nothing before the notice");
    assert.equal(t.view().why, "notice");
    cfg.telemetry.noticeSeen = true;
    await t.look();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, TELEMETRY_URL);
    assert.deepEqual(sent[0].body.events.map((/** @type {any} */ e) => e.event), ["app opened"]);
    assert.match(sent[0].body.id, /^[0-9a-f-]{36}$/);
    const kept = JSON.parse(readFileSync(join(dir, "telemetry.json"), "utf8"));
    assert.equal(kept.id, sent[0].body.id, "its own id, kept");
    assert.equal(Object.values(kept.days["2026-11-10"].runs)[0].n, 1, "the run before the notice was counted");
    assert.deepEqual(t.view().last?.body, sent[0].body, "Show what's sent: the body as it went");
  } finally {
    removeDirs(dir);
  }
});

test("off by DO_NOT_TRACK, FILAMENT_TELEMETRY=0 or the setting: nothing counted, nothing sent", async () => {
  for (const o of /** @type {any[]} */ ([{ env: { DO_NOT_TRACK: "1" } }, { env: { FILAMENT_TELEMETRY: "0" } }, { telemetry: { enabled: false, noticeSeen: true } }])) {
    const dir = mkdtempSync(join(tmpdir(), "filament-telemetry-"));
    try {
      const { t, events, sent } = rig({ dir, ...o });
      t.start();
      events.publish("run:a", { type: "run-start", kind: "agent-turn", meta: {} });
      await t.look();
      t.stop();
      assert.equal(sent.length, 0, JSON.stringify(o));
      assert.equal(existsSync(join(dir, "telemetry.json")), false, `nothing kept: ${JSON.stringify(o)}`);
      assert.equal(t.view().on, false);
    } finally {
      removeDirs(dir);
    }
  }
});

test("a day's summary goes the next day, timed at its end: runs by engine, sub-agents, task-graph chats, usage by kind, and no id, address or asked name", async () => {
  const { t, events, sent, clock, usageDays } = rig();
  t.start();
  await t.look();
  events.publish("run:1", { type: "run-start", kind: "agent-turn", meta: { model: "x" } });
  events.publish("run:2", { type: "run-start", kind: "coding-agent", meta: { engine: "acp", upstream: "claude-work" } });
  events.publish("run:3", { type: "run-start", kind: "subagent", meta: { upstream: "claude-work", subagent: "sa_1" } });
  events.publish("run:4", { type: "run-start", kind: "agent-turn", meta: { resumed: true } });
  // A sub-agent's turn on another machine, shown here as a run: that machine counts it.
  events.publish("run:5", { type: "run-start", kind: "remote-subagent", meta: { subagent: "sa_2", machine: "Studio" } });
  events.publish("graph", { type: "graph", chainId: "chain-1" });
  events.publish("graph", { type: "graph", chainId: "chain-1" });
  usageDays["2026-11-10"] = {
    day: "2026-11-10", requests: 3, input: 100, output: 50, cost: 0.25, hours: Array.from({ length: 24 }, (_, i) => (i === 14 ? 3 : 0)),
    rows: [
      { upstream: "corp-gateway-secret", model: "ft:gpt-4o:acme-corp:secret-project:abc", requests: 2, input: 80, output: 40, cost: 0.2, asked: [{ name: "my-private-alias", n: 2 }] },
      { upstream: "claude-work", model: KNOWN_MODEL, requests: 1, input: 20, output: 10, cost: 0.05, asked: [] },
    ],
  };
  clock.t = noon("2026-11-11");
  await t.look();
  const body = sent.at(-1)?.body;
  const daily = body.events.find((/** @type {any} */ e) => e.event === "daily summary");
  assert.ok(daily, "the summary went");
  assert.equal(daily.properties.day, "2026-11-10");
  assert.equal(new Date(daily.timestamp).getDate(), 10, "timed at the day's end, on this machine's clock");
  assert.deepEqual(daily.properties.runs, { filament: 1, "claude-code": 2 }, "the resumed turn counted once, when it began; one on another machine, there");
  assert.equal(daily.properties.features.subagents, 1);
  assert.equal(daily.properties.features.graphChats, 1, "a chat counted once a day");
  assert.equal(daily.properties.hours[14], 3);
  assert.deepEqual(daily.properties.rows.map((/** @type {any} */ r) => r.model).sort(), [KNOWN_MODEL, "custom"].sort());
  const words = JSON.stringify(body);
  for (const secret of ["corp-gateway-secret", "example-corp", "acme-corp", "secret-project", "my-private-alias", "claude-work", "chain-1"])
    assert.equal(words.includes(secret), false, `${secret} never leaves the machine`);
  sent.length = 0;
  await t.look();
  assert.equal(sent.length, 0, "a day goes once");
});

test("a failed send waits for the next look; a restart keeps what was counted and the id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-telemetry-"));
  try {
    const a = rig({ dir, fail: true });
    a.t.start();
    a.events.publish("run:1", { type: "run-start", kind: "agent-turn", meta: {} });
    await a.t.look();
    assert.equal(a.sent.length, 0);
    assert.equal(a.t.view().waiting, 1, "the start's event waits");
    a.t.stop();
    const b = rig({ dir });
    b.clock.t = noon("2026-11-11");
    b.t.start();
    await b.t.look();
    const events = b.sent.flatMap((s) => s.body.events.map((/** @type {any} */ e) => e.event));
    assert.deepEqual(events, ["app opened", "app opened", "daily summary"], "the waiting event, this start's, and yesterday's summary");
    assert.equal(b.sent[0].body.events.find((/** @type {any} */ e) => e.event === "daily summary").properties.runs.filament, 1, "the run counted before the restart");
    assert.equal(b.t.view().waiting, 0);
  } finally {
    removeDirs(dir);
  }
});

test("after a long gap only the last few days' summaries go, and days before telemetry began never", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-telemetry-"));
  try {
    const day = (/** @type {string} */ d) => ({ [d]: { runs: { "|0": { upstream: null, sub: false, n: 1 } }, graphChats: [] } });
    const days = { ...day("2026-10-30"), ...day("2026-11-01"), ...day("2026-11-02"), ...day("2026-11-03"), ...day("2026-11-04"), ...day("2026-11-05") };
    writeFileSync(join(dir, "telemetry.json"), JSON.stringify({ version: 1, id: "11111111-2222-3333-4444-555555555555", since: "2026-11-01", sentThrough: null, days, pending: [], last: null }));
    const { t, clock, sent } = rig({ dir });
    clock.t = noon("2026-11-09");
    await t.look();
    const summaries = sent.flatMap((x) => x.body.events).filter((/** @type {any} */ e) => e.event === "daily summary").map((/** @type {any} */ e) => e.properties.day);
    assert.deepEqual(summaries, ["2026-11-03", "2026-11-04", "2026-11-05"]);
    assert.equal(sent[0].body.id, "11111111-2222-3333-4444-555555555555", "the id kept");
  } finally {
    removeDirs(dir);
  }
});

test("told: a terminal's start lines said the notice, so it is kept as shown and the start's event goes", async () => {
  const { t, cfg, sent } = rig({ telemetry: { enabled: true, noticeSeen: false } });
  let marked = 0;
  const u = createTelemetry({
    armed: true,
    config: { get: () => cfg },
    usage: { dailyStore: { list: () => [] } },
    events: createEventBus(),
    context: () => ({ version: "0.9.71", platform: "linux", arch: "x64", install: "server", locale: "en-US", timeZone: "UTC" }),
    markSeen: () => {
      marked++;
      cfg.telemetry.noticeSeen = true;
    },
    every: () => ({ unref() {} }),
    stopEvery: () => {},
    fetchImpl: /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => (sent.push({ url, body: JSON.parse(init.body) }), { ok: true, status: 204 })),
  });
  assert.equal(u.view().why, "notice");
  u.told();
  await u.look();
  assert.equal(marked, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.events[0].properties.install, "server");
  void t;
});

test("the notice and Settings' words: shown only while Filament would send and has not said so; why it is off, in words", () => {
  assert.equal(noticeShows({ armed: true, why: "notice" }), true);
  for (const v of [null, { armed: false, why: "not-armed" }, { armed: true, why: null, on: true }, { armed: true, why: "setting" }, { armed: true, why: "DO_NOT_TRACK" }]) assert.equal(noticeShows(v), false, JSON.stringify(v));
  assert.match(String(telemetryWords({ why: "DO_NOT_TRACK" })), /DO_NOT_TRACK/);
  assert.match(String(telemetryWords({ why: "FILAMENT_TELEMETRY" })), /FILAMENT_TELEMETRY=0/);
  assert.match(String(telemetryWords({ why: "not-armed" })), /sends nothing/);
  assert.equal(telemetryWords({ why: "setting" }), null, "the switch says it itself");
});

describe("the telemetry door in a running Filament (a test's: never armed)", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let s;
  before(async () => {
    s = await startApp({ supervisor: "desktop" });
  });
  after(async () => {
    await s?.stop();
  });

  // (fails before: no such route)
  test("GET /telemetry says a test's Filament sends nothing; the notice's Turn off keeps it shown and switched off", async () => {
    const v = await (await s.api("/api/telemetry")).json();
    assert.deepEqual({ on: v.on, why: v.why, armed: v.armed, last: v.last }, { on: false, why: "not-armed", armed: false, last: null });
    const r = await s.api("/api/telemetry/notice-seen", { method: "POST", body: { off: true } });
    assert.equal(r.status, 200);
    const disk = JSON.parse(readFileSync(join(s.dataDir, "config.json"), "utf8"));
    assert.deepEqual(disk.telemetry, { enabled: false, noticeSeen: true });
  });

  // (fails before: telemetry was no section the harness writes)
  test("the switch is written as Settings writes it", async () => {
    const base = (await (await s.api("/api/state")).json()).configVersion;
    const r = await s.api("/api/config/fields", { method: "PATCH", body: { set: { "telemetry.enabled": true }, base } });
    assert.equal(r.status, 200, await r.text());
    assert.equal((await (await s.api("/api/state")).json()).config.telemetry.enabled, true);
  });
});
