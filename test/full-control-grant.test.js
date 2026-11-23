// @ts-check
// Full control (the owner's "YOLO mode" of 11-09): a sixth grant on another machine's agents' device, on top of
// `agents`. The store keeps it only with `agents` on, a second mint carries it not, and it holds `unasked` and `codingAgents`
// with it while on (`heldGrant`); `fullControl` says a chat's device runs as the person here — never for a revoked one,
// whose grants the store still hands out. The grant route refuses it without Agents, in words; switched off, what the
// device runs here stops, as `agents` off stops it, and another pill moved stops nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTwoMachines } from "./helpers/two-machines.js";
import { anthropicReply, fakeUpstream } from "./helpers/app.js";
import { pinnedFetch } from "../src/cli/pinned.js";
import { GRANTS, UNREAD_DEVICE, createDevices, fullControl, grantEnds, heldGrant } from "../src/services/devices.js";
import { scaledMs } from "./helpers/wait.js";

const JSON_TYPE = { "content-type": "application/json" };
const OFF = { agents: false, copies: false, models: false, browser: false, unasked: false, codingAgents: false, full: false };

// (fails before: yes — there was no grant `full`: GRANTS had five, and fullControl, heldGrant and grantEnds were none)
test("the store: Full control off by default, kept only with Agents, never carried over a second mint; it holds Without asking and Coding agents while on; a revoked device holds no Full control, nor any grant", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-full-store-"));
  try {
    assert.equal(GRANTS.at(-1), "full");
    const devices = createDevices({ dataDir: dir });
    const full = devices.claim(devices.startPairing({ scope: "full" }).code, { name: "Laptop" });
    assert.ok(full.ok);
    const minted = devices.mintAgents(full.device.id);
    assert.ok(minted.ok);
    const id = minted.device.id;
    assert.deepEqual(minted.device.grants, OFF);
    // Without Agents, Full control stays off; on top of it, on.
    assert.deepEqual(devices.grant(id, { full: true })?.grants, OFF);
    assert.deepEqual(devices.grant(id, { agents: true, full: true })?.grants, { ...OFF, agents: true, full: true });
    assert.equal(fullControl(devices, id), true);
    // It holds Without asking and Coding agents while on; Models and the browser are their own.
    const d = devices.get(id);
    assert.deepEqual(["agents", "models", "browser", "unasked", "codingAgents", "full"].map((g) => heldGrant(d, /** @type {any} */ (g))), [true, false, false, true, true, true]);
    // Heard with what it was before.
    /** @type {any[]} */
    const heard = [];
    devices.onGrant((who, now, before) => heard.push([who, now.full, before?.full]));
    // Agents off takes Full control with it.
    assert.deepEqual(devices.grant(id, { agents: false })?.grants, OFF);
    assert.deepEqual(heard, [[id, false, true]]);
    assert.equal(fullControl(devices, id), false);
    assert.equal(heldGrant(devices.get(id), "unasked"), false, "off with it");
    // A second mint carries the other grants, never Full control: a Forget there can leave the first standing here, and
    // Full control is asked for again, with its words.
    devices.grant(id, { agents: true, unasked: true, full: true });
    const again = devices.mintAgents(full.device.id);
    assert.ok(again.ok);
    assert.deepEqual(again.device.grants, { ...OFF, agents: true, unasked: true });
    assert.equal(fullControl(devices, again.device.id), false, "not carried over a second mint");
    devices.grant(again.device.id, { full: true });
    const kept = createDevices({ dataDir: dir });
    assert.equal(fullControl(kept, again.device.id), true, "kept across a restart");
    // No Full control for what is no standing agents' device.
    assert.equal(fullControl(devices, full.device.id), false, "a full device holds no grant");
    assert.equal(fullControl(devices, UNREAD_DEVICE), false, "a chat whose meta could not be read");
    assert.equal(fullControl(devices, "d-none"), false);
    assert.equal(fullControl(devices, null), false);
    assert.equal(fullControl(null, again.device.id), false);
    devices.revoke(again.device.id);
    assert.equal(devices.get(again.device.id)?.grants.full, true, "the store still hands a revoked device's grants");
    assert.equal(fullControl(devices, again.device.id), false, "revoked: no Full control");
    assert.deepEqual(["unasked", "codingAgents", "agents"].map((g) => heldGrant(devices.get(again.device.id), /** @type {any} */ (g))), [false, false, false], "revoked: no grant held");
    assert.equal(heldGrant(null, "unasked"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — grantEnds was none, and each listener ended what a device ran on `agents` off alone)
test("what ends as a device's grants are set: Agents off, or Full control switched off; another pill moved ends nothing", () => {
  const on = { ...OFF, agents: true };
  assert.match(grantEnds(OFF, on), /grant agents was switched off/);
  assert.match(grantEnds(OFF, { ...on, full: true }), /grant agents was switched off/);
  assert.match(grantEnds(on, { ...on, full: true }), /Full control was switched off/);
  assert.equal(grantEnds({ ...on, models: true }, on), "");
  assert.equal(grantEnds({ ...on, full: true, models: true }, { ...on, full: true }), "");
  assert.equal(grantEnds({ ...on, full: true }, on), "", "switched on ends nothing");
  assert.equal(grantEnds({ ...on, models: true }, undefined), "");
});

/**
 * Requests to `m` over the network, pinned to its certificate, with `token` as their Bearer: as another machine's
 * Filament sends them. @param {import("./helpers/two-machines.js").Machine} m @param {string} token
 */
const as = (m, token) => {
  const pinned = pinnedFetch(m.lan.fingerprint);
  /** @param {string} path @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [o] @returns {Promise<Response>} */
  return (path, { method = "GET", body, signal } = {}) =>
    pinned(`${m.far}${path}`, { method, signal, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : JSON_TYPE) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
};

/** @param {() => unknown} fn @param {string} what */
const until = async (fn, what, ms = 15_000) => {
  const wait = scaledMs(ms);
  for (const end = Date.now() + wait; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (fn()) return;
  assert.fail(`waited ${wait} ms for ${what}`);
};

// (fails before: yes — the route took no grant `full`, and nothing ended a device's chats but Agents off and a revoke)
test("the grant route: Full control refused without Agents, in words; switched off, the turn running in the device's chat stops, and Models moved before it stopped nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-full-route-"));
  /** @type {() => void} */
  let open = () => {};
  const slow = new Promise((r) => (open = () => r(undefined)));
  const up = await fakeUpstream(async (/** @type {any} */ call) => {
    if (call.kind !== "anthropic") return undefined;
    if (/SLOW/.test(JSON.stringify(call.body?.messages?.at(-1) ?? ""))) await slow;
    return anthropicReply("MODEL ANSWER", { model: "brain-model" });
  });
  const two = await startTwoMachines({
    there: {
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, permissions: "auto", roots: [root], readerModel: "" };
      },
    },
  });
  const { there } = two;
  try {
    const m = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
    const path = `/api/remote/devices/${encodeURIComponent(m.device.id)}`;
    const agents = as(there, m.token);
    // Without Agents: refused in words, nothing set.
    const early = await there.api(path, { method: "PATCH", body: { grants: { full: true } } });
    assert.equal(early.status, 400);
    assert.match((await early.json()).error, /Full control is on top of Agents/);
    const listed = await (await there.api("/api/remote/devices")).json();
    assert.equal(listed.devices.find((/** @type {any} */ d) => d.id === m.device.id)?.grants.full, false);
    // On top of Agents: on.
    const on = await there.api(path, { method: "PATCH", body: { grants: { agents: true, full: true } } });
    assert.equal(on.status, 200, await on.clone().text());
    assert.deepEqual((await on.json()).device.grants, { ...OFF, agents: true, full: true });
    // A turn of theirs runs.
    const made = await agents("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    const chat = await made.json();
    assert.equal(made.status, 200, JSON.stringify(chat));
    const S = `/api/sessions/${encodeURIComponent(chat.id)}`;
    const going = new AbortController();
    const res = await agents(`${S}/turns`, { method: "POST", body: { content: "SLOW", stream: true }, signal: going.signal });
    assert.equal(res.status, 200);
    const run = String(res.headers.get("x-filament-request-id"));
    await until(() => up.received.some((x) => x.kind === "anthropic" && /SLOW/.test(JSON.stringify(x.body?.messages?.at(-1) ?? ""))), "the slow turn's model call");
    going.abort();
    // Models moved: nothing ends.
    assert.equal((await there.api(path, { method: "PATCH", body: { grants: { models: true } } })).status, 200);
    await new Promise((r) => setTimeout(r, scaledMs(400)));
    assert.equal(there.app.runs.getRun(run)?.endedAt ?? null, null, "its turn runs on");
    // Full control off: the turn stops, Agents stays on, and the chat is theirs still.
    const off = await there.api(path, { method: "PATCH", body: { grants: { full: false } } });
    assert.equal(off.status, 200, await off.clone().text());
    assert.deepEqual((await off.json()).device.grants, { ...OFF, agents: true, models: true });
    await until(() => there.app.runs.getRun(run)?.endedAt != null, "the turn to stop as Full control went off");
    assert.equal((await agents(S)).status, 200);
  } finally {
    open();
    await two.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
