// @ts-check
// Another machine's agents here (the remote-agents plan's f-grant): a device of their own, minted by a full device for its
// own machine and linked to it, apart from the person's pairing. Its grants { agents, models, browser } are off until this
// machine's managers switch them on — never the device itself. With `agents` on, its agents start and follow chats in the
// folders chats here may use and answer their asks — never Settings, config, keys, pairing or devices; with it off, they
// reach /api/remote/me alone, to say why. Revoked, on its own or with its full device, what it holds ends and its token
// fails; its grants survive a restart. Two real Filaments (helpers/two-machines.js): `here` paired with `there` as a full
// device through the real claim route, `there`'s managers on its own loopback.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { pairMachines, startTwoMachines } from "./helpers/two-machines.js";
import { removeDirs } from "./helpers/wait.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { pinnedFetch } from "../src/cli/pinned.js";
import { createDevices } from "../src/services/devices.js";
import { agentBodyRefusal, agentFolderRefusal } from "../src/http/admin/remote.js";
import { agentsModels } from "../src/http/admin/upstreams.js";

const JSON_TYPE = { "content-type": "application/json" };
const OFF = { agents: false, models: false, browser: false, unasked: false, codingAgents: false, full: false };
const WS = { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" };

/**
 * Requests to `m` over the network, pinned to its certificate, with `token` as their Bearer: as another machine's
 * Filament sends them. A body that is no string goes as JSON.
 * @param {import("./helpers/two-machines.js").Machine} m @param {string} token
 */
const as = (m, token) => {
  const pinned = pinnedFetch(m.lan.fingerprint);
  /** @param {string} path @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [o] @returns {Promise<Response>} */
  return (path, { method = "GET", body, signal } = {}) =>
    pinned(`${m.far}${path}`, {
      method,
      signal,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : JSON_TYPE) },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
};

/**
 * A stream held open — a run's events — and a promise of its end.
 * @param {(path: string, o?: { signal?: AbortSignal }) => Promise<Response>} call @param {string} path
 */
const hold = async (call, path) => {
  const stop = new AbortController();
  const r = await call(path, { signal: stop.signal });
  if (r.status !== 200) return { status: `${r.status} ${await r.text()}`, closed: Promise.resolve(true), end: () => {} };
  const reader = r.body?.getReader();
  const closed = (async () => {
    try {
      while (reader && !(await reader.read()).done);
    } catch {}
    return true;
  })();
  return { status: r.status, closed, end: () => stop.abort() };
};

/** Whether `p` settles within `ms`. @param {Promise<any>} p @param {number} ms */
const within = (p, ms) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);

/** A drive's root on another volume than `p`'s, there or not: Windows's alone has one. @param {string} p */
const otherRoot = (p) => (parse(p).root.toUpperCase().startsWith("Z") ? "Y:\\" : "Z:\\");

// (fails before: yes — there was no agents' device: POST /api/remote/agent-device answered 404, a device held no grants)
test("another machine's agents: a full device mints them a device here, off until there's managers switch `agents` on; then they start and follow a chat in a folder chats here may use, and reach nothing else; revoked on their own or with the full device, their streams end and their token fails; their grants survive a restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-agents-"));
  const phoneDir = mkdtempSync(join(tmpdir(), "filament-agents-phone-"));
  writeFileSync(join(root, "readme.txt"), "the project's own words");
  const up = await fakeUpstream((/** @type {any} */ call) => (call.kind === "anthropic" ? anthropicReply("Done on the workstation.", { model: "m-1" }) : undefined));
  const two = await startTwoMachines({
    there: {
      keep: true,
      // A stop asked for over the API ends the app, never this test's process.
      onShutdown: () => {},
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        // The temp folder is a root: the test's own folder and there's data folder lie under it, this repository not.
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [tmpdir()], readerModel: "" };
      },
    },
  });
  const { there } = two;
  const dataDir = there.dataDir;
  /** @type {{ end: () => void }[]} */
  const open = [];
  /** @type {Awaited<ReturnType<typeof startApp>> | null} */
  let again = null;
  let stopped = false;
  try {
    // Minted by here's full device: the token this once, the device linked to it and named for it, its grants off.
    const minted = await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" });
    assert.equal(minted.status, 200, await minted.clone().text());
    const first = await minted.json();
    assert.match(first.token, /^fdt_/);
    assert.notEqual(first.token, two.remote.token);
    assert.deepEqual([first.device.name, first.device.scope, first.device.kind, first.device.of, first.device.grants], ["Filament agents on Laptop", "agent", "agents", two.remote.device.id, OFF]);
    assert.equal(first.device.hash, undefined, "its hash stays there");
    let agents = as(there, first.token);
    // Its grants off: /remote/me alone, which says who it is and its grants; everything else a 403 in words.
    const me = await (await agents("/api/remote/me")).json();
    assert.deepEqual([me.who, me.device?.scope, me.device?.grants, me.machine?.id], ["device", "agent", OFF, there.machine.id]);
    for (const [method, path, body] of [
      ["GET", "/api/state"],
      ["POST", "/api/sessions", { cwd: root, model: "m-1" }],
      ["GET", `/api/files/read?cwd=${encodeURIComponent(root)}&path=readme.txt`],
      ["GET", "/api/runs/r-none/events"],
      ["GET", "/api/config"],
    ]) {
      const r = await agents(String(path), { method: String(method), body });
      assert.equal(r.status, 403, `${method} ${path}`);
      assert.match((await r.json()).error, /Filament agents on Laptop may not run agents here/, `${method} ${path}`);
    }
    // There's own computer — a manager — switches `agents` on.
    const id = encodeURIComponent(first.device.id);
    const on = await there.api(`/api/remote/devices/${id}`, { method: "PATCH", body: { grants: { agents: true } } });
    assert.equal(on.status, 200, await on.clone().text());
    assert.deepEqual((await on.json()).device.grants, { ...OFF, agents: true });
    assert.equal((await there.api(`/api/remote/devices/${id}`, { method: "PATCH", body: { grants: { agents: "yes" } } })).status, 400, "a grant is true or false");
    assert.equal((await there.api(`/api/remote/devices/${id}`, { method: "PATCH", body: { grants: { keys: true } } })).status, 400, "a grant it names is one there is");
    // A file is read in a folder a chat here works in, and before one does, not.
    const readme = `/api/files/read?cwd=${encodeURIComponent(root)}&path=readme.txt`;
    assert.equal((await agents(readme)).status, 403, "no chat works in it yet");
    // A chat in a folder chats here may use: made, its turn answered by there's model, followed.
    const made = await agents("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    const chat = await made.json();
    assert.equal(made.status, 200, JSON.stringify(chat));
    const turn = await agents(`/api/sessions/${encodeURIComponent(chat.id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    const said = await turn.json();
    assert.equal(turn.status, 200, JSON.stringify(said));
    assert.match(JSON.stringify(said.content), /Done on the workstation\./);
    assert.equal((await agents(`/api/sessions/${encodeURIComponent(chat.id)}`)).status, 200);
    assert.equal((await agents(`/api/sessions/${encodeURIComponent(chat.id)}/subagents`)).status, 200);
    assert.equal((await agents("/api/state")).status, 200);
    const read = await agents(readme);
    assert.equal(read.status, 200);
    assert.match(await read.text(), /the project's own words/);
    // Never a folder outside the roots, nor there's data folder (under a root), to start a chat in or to read.
    const outside = await agents("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model: "m-1" } });
    assert.equal(outside.status, 403);
    assert.match((await outside.json()).error, /not under any folder listed in agentLoop\.roots/);
    const data = await agents("/api/sessions", { method: "POST", body: { cwd: dataDir, model: "m-1" } });
    assert.equal(data.status, 403);
    assert.match((await data.json()).error, /never start a chat in Filament's data folder/);
    const secret = await agents(`/api/files/read?cwd=${encodeURIComponent(dataDir)}&path=secret.key`);
    assert.equal(secret.status, 403);
    assert.match((await secret.json()).error, /never reads Filament's data folder/);
    // Never Settings, config, keys, providers, pairing, devices — its own grants among them —, another mint, or a stop.
    for (const [method, path, body] of [
      ["GET", "/api/config"],
      ["PUT", "/api/config", {}],
      ["GET", "/api/keys"],
      ["GET", "/api/upstreams"],
      ["GET", "/api/defaults/settings"],
      ["POST", "/api/remote/pair", { scope: "full" }],
      ["GET", "/api/remote/devices"],
      ["PATCH", `/api/remote/devices/${id}`, { grants: { models: true, browser: true } }],
      ["DELETE", `/api/remote/devices/${encodeURIComponent(two.remote.device.id)}`],
      ["POST", "/api/remote/agent-device", {}],
      ["POST", "/api/remote/sign-out", {}],
      ["GET", "/api/events"],
      ["POST", "/api/shutdown", {}],
    ]) {
      const r = await agents(String(path), { method: String(method), body });
      assert.equal(r.status, 403, `${method} ${path}`);
      assert.match((await r.json()).error, /another machine's agents start and follow chats here/, `${method} ${path}`);
    }
    assert.deepEqual((await (await agents("/api/remote/me")).json()).device.grants, { ...OFF, agents: true }, "its grants as there's computer set them");
    // A view-only device holds no grant, and neither does a full one: theirs is no agents' device. The view device is a
    // third machine's — here connecting again would sign its full device out, and its agents' device with it.
    const phone = await pairMachines(/** @type {any} */ ({ dataDir: phoneDir, machine: { name: "Phone" } }), there, { scope: "view" });
    for (const [device, words] of [
      [phone.remote.device.id, /a view-only device holds no grant/],
      [two.remote.device.id, /a full device drives this Filament as you do and holds no grant/],
    ]) {
      const r = await there.api(`/api/remote/devices/${encodeURIComponent(String(device))}`, { method: "PATCH", body: { grants: { agents: true } } });
      assert.ok(r.status === 403 || r.status === 400, `${device}: ${r.status}`);
      assert.match((await r.json()).error, /** @type {RegExp} */ (words));
    }
    // A second mint replaces the first: its token stops, what it held ends, and its grants carry over. A run they follow
    // is one of a chat they started: another's is not found (the remote-agents plan's f-answer).
    /** @type {any} */ (there.app.runs).startRun({ id: "r-agents", kind: "test", meta: { chain: chat.id } });
    const firstHeld = await hold(agents, "/api/runs/r-agents/events?stream=1");
    open.push(firstHeld);
    assert.equal(firstHeld.status, 200);
    const second = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
    assert.notEqual(second.token, first.token);
    assert.deepEqual([second.device.of, second.device.grants], [two.remote.device.id, { ...OFF, agents: true }]);
    assert.equal(await within(firstHeld.closed, 3000), true, "the first token's stream ends");
    assert.equal((await agents("/api/remote/me")).status, 403, "the first token fails");
    agents = as(there, second.token);
    assert.equal((await agents("/api/state")).status, 200);
    const listed = (await (await there.api("/api/remote/devices")).json()).devices.filter((/** @type {any} */ d) => d.scope === "agent");
    assert.deepEqual(listed.map((/** @type {any} */ d) => [d.id, d.name, d.revokedAt]), [[second.device.id, "Filament agents on Laptop", null]], "listed once");
    // Revoked on its own: its stream ends, its token fails; here's full device goes on. What it follows is a run of a chat
    // it started itself: the first device's are none of its own.
    const secondChat = await (await agents("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } })).json();
    /** @type {any} */ (there.app.runs).startRun({ id: "r-agents-2", kind: "test", meta: { chain: secondChat.id } });
    const secondHeld = await hold(agents, "/api/runs/r-agents-2/events?stream=1");
    open.push(secondHeld);
    assert.equal(secondHeld.status, 200);
    assert.equal((await there.api(`/api/remote/devices/${encodeURIComponent(second.device.id)}`, { method: "DELETE" })).status, 200);
    assert.equal(await within(secondHeld.closed, 3000), true, "its stream ends");
    assert.equal((await agents("/api/remote/me")).status, 403, "its token fails");
    assert.equal((await two.ask("/api/remote/me")).status, 200, "the full device goes on");
    // Minted again after a revoke: its grants start off — a mint undoes no revoke. Switched on, with `models` too, by
    // here's full device: a manager there. Minted with here's own name, as its Settings › Remote access › This machine
    // says it: the device is named for it, not for the full device ("Filament app on …" for the desktop app's).
    const third = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ from: " Studio\n" }) })).json();
    assert.deepEqual(third.device.grants, OFF);
    assert.deepEqual([third.device.name, third.device.from], ["Filament agents on Studio", "Studio"]);
    const set = await two.ask(`/api/remote/devices/${encodeURIComponent(third.device.id)}`, { method: "PATCH", headers: JSON_TYPE, body: JSON.stringify({ grants: { agents: true, models: true } }) });
    assert.equal(set.status, 200, await set.clone().text());
    // A chat it starts is said to be from that name, not from the full device's — after the restart too.
    const studioChat = await (await as(there, third.token)("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain", title: "Run the suite" } })).json();
    assert.equal(typeof studioChat.id, "string", JSON.stringify(studioChat));
    // There restarted on its data folder: the grants as they were set. Another machine stands as a request a proxy on
    // this machine handed on (X-Forwarded-For over loopback), the way the other remote tests stand it.
    await two.stop();
    stopped = true;
    again = await startApp({ dataDir });
    const kept = (await (await again.api("/api/remote/devices")).json()).devices.find((/** @type {any} */ d) => d.id === third.device.id);
    assert.deepEqual([kept?.scope, kept?.of, kept?.grants, kept?.name, kept?.from], ["agent", two.remote.device.id, { ...OFF, agents: true, models: true }, "Filament agents on Studio", "Studio"]);
    const far = { "x-forwarded-for": "100.101.102.103", authorization: `Bearer ${third.token}` };
    assert.equal((await fetch(`${again.url}/api/state`, { headers: far })).status, 200, "its token, and its grant, after the restart");
    const listedChats = (await (await again.api("/api/memory/sessions?limit=100&kind=interactive,fork")).json()).sessions ?? [];
    assert.deepEqual(listedChats.find((/** @type {any} */ s) => s.id === studioChat.id)?.fromAgents, { name: "Studio" }, "its chat, from the name it was minted with");
    // The run socket follows every run and serves the person's pages: refused it, its grant on.
    const socket = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: again?.port, path: "/api/runs/socket", headers: { host: `127.0.0.1:${again?.port}`, ...WS, ...far } });
      req.on("response", (res) => (res.resume(), resolve(res.statusCode)));
      req.on("upgrade", (_res, s) => (s.destroy(), resolve(101)));
      req.on("error", reject);
      req.end();
    });
    assert.equal(socket, 403, "no run socket");
    // Here's full device revoked: its agents' device goes with it.
    assert.equal((await again.api(`/api/remote/devices/${encodeURIComponent(two.remote.device.id)}`, { method: "DELETE" })).status, 200);
    const gone = (await (await again.api("/api/remote/devices")).json()).devices.find((/** @type {any} */ d) => d.id === third.device.id);
    assert.ok(gone?.revokedAt, "revoked with the full device");
    assert.equal((await fetch(`${again.url}/api/remote/me`, { headers: far })).status, 403, "its token fails");
    // Its grants are set no more: no token of theirs comes in, and a mint carries none of a revoked one's.
    const late = await again.api(`/api/remote/devices/${encodeURIComponent(third.device.id)}`, { method: "PATCH", body: { grants: { agents: false, models: true } } });
    assert.equal(late.status, 409, await late.clone().text());
    assert.match((await late.json()).error, /^Filament agents on Studio is revoked: no token of theirs comes in, and its grants are set no more/);
    assert.deepEqual((await (await again.api("/api/remote/devices")).json()).devices.find((/** @type {any} */ d) => d.id === third.device.id)?.grants, gone.grants, "nothing set");
  } finally {
    for (const x of open) x.end();
    if (!stopped) await two.stop();
    if (again) await again.stop();
    else await removeDirs(dataDir);
    await up.close();
    // A stopped app's processes may hold a folder past two seconds on a loaded machine (EPERM): removed once they let go.
    await removeDirs(root, phoneDir);
  }
});

// (fails before: yes — a device kept no grants, and `scopeOf` read "agent" as view)
test("the store: grants off by default and kept across a restart; an old devices.json reads as it did; a full device's revoke takes its agents' device, each heard by its id", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agent-store-"));
  try {
    // A devices.json written before grants: its devices read as they did — full, view, a scope that is neither as view —
    // with every grant off.
    const old = (/** @type {string} */ id, /** @type {unknown} */ scope, /** @type {string} */ hex) => ({ id, name: id, scope, kind: "cli", hash: hex.repeat(64), createdAt: 1, lastSeenAt: null, lastSeenFrom: null, revokedAt: null });
    writeFileSync(join(dir, "devices.json"), JSON.stringify({ version: 1, devices: [old("full", "full", "a"), old("view", "view", "b"), old("typo", "fulll", "c")] }));
    const read = createDevices({ dataDir: dir });
    assert.deepEqual(read.list().map((d) => [d.id, d.scope, d.grants]).sort(), [["full", "full", OFF], ["typo", "view", OFF], ["view", "view", OFF]]);
    // A code pairs a full or a view device alone: an agents' device is minted, never claimed.
    assert.equal(read.startPairing({ scope: "agent" }).scope, "view");
    // Minted for a full device; a view device has none minted.
    const devices = createDevices({ dataDir: dir });
    const code = devices.startPairing({ scope: "full" });
    const full = devices.claim(code.code, { name: "Laptop" });
    assert.ok(full.ok);
    assert.equal(devices.mintAgents("view").ok, false, "a view device has no agents' device minted");
    const minted = devices.mintAgents(full.device.id);
    assert.ok(minted.ok);
    assert.deepEqual([minted.device.scope, minted.device.of, minted.device.grants], ["agent", full.device.id, OFF]);
    assert.equal(devices.grant("view", { agents: true }), null, "a view device holds no grant");
    assert.equal(devices.grant(full.device.id, { agents: true }), null, "a full device holds no grant");
    assert.deepEqual(devices.grant(minted.device.id, { browser: true })?.grants, { ...OFF, browser: true });
    // What it is handed is a copy: changing it changes nothing kept.
    const seen = /** @type {any} */ (devices.verify(minted.token));
    seen.grants.agents = true;
    assert.equal(devices.get(minted.device.id)?.grants.agents, false);
    // Kept across a restart.
    const back = createDevices({ dataDir: dir });
    assert.deepEqual([back.get(minted.device.id)?.scope, back.get(minted.device.id)?.of, back.get(minted.device.id)?.grants], ["agent", full.device.id, { ...OFF, browser: true }]);
    assert.equal(back.verify(minted.token)?.id, minted.device.id);
    // The full device revoked: its agents' device with it, each heard by its id — the hook that stops the runs it started.
    /** @type {string[]} */
    const heard = [];
    back.onRevoke((gone) => heard.push(gone));
    back.revoke(full.device.id);
    assert.deepEqual(heard.sort(), [full.device.id, minted.device.id].sort());
    assert.equal(back.verify(minted.token), null);
    assert.ok(back.get(minted.device.id)?.revokedAt);
    assert.equal(back.grant(minted.device.id, { agents: true }), null, "a revoked device's grants are set no more");
    assert.deepEqual(back.get(minted.device.id)?.grants, { ...OFF, browser: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — any value passed as their effort: a number, a word no level is)
test("another machine's agents set their chat's effort by a level's name, or none, at its start and in a turn", () => {
  for (const effort of ["high", "max", "model", null]) assert.equal(agentBodyRefusal("POST /sessions", { cwd: "x", settings: { model: { effort } } }), null, String(effort));
  for (const effort of [42, "turbo", true]) assert.match(String(agentBodyRefusal("POST /sessions", { cwd: "x", settings: { model: { effort } } })), /^another machine's agents set a chat's effort by a level's name, model, low, medium, high, xhigh, max; settings: model.effort is /, JSON.stringify(effort));
  assert.match(String(agentBodyRefusal("POST /sessions/:id/turns", { content: "hi", settingsPatch: { model: { effort: 7 } } })), /settingsPatch: model.effort is 7$/);
});

// (fails before: yes — every coding agent's model that answered was listed to them, whatever their grant: a sub-agent
// sent here with no model named could be put on one, and every message of it refused — the review of 11-10)
test("another machine's agents are listed the models that answer, a coding agent's only while they may use the coding agents here", () => {
  const cfg = { upstreams: [{ id: "m", type: "anthropic" }, { id: "cc", type: "acp", acp: { command: "claude" } }, { id: "far", type: "filament", machine: { id: "x" } }] };
  const models = [
    { id: "m-1", label: "M one", upstream: "m", answers: true },
    { id: "m-2", upstream: "m", answers: false },
    { id: "cc/opus", label: "Opus", upstream: "cc", answers: true },
    { id: "far/m-9", upstream: "far", answers: true },
  ];
  const device = (/** @type {any} */ grants) => ({ revokedAt: null, grants: { ...OFF, agents: true, ...grants } });
  assert.deepEqual(agentsModels(models, cfg, device({})), [{ id: "m-1", label: "M one", answers: true }]);
  for (const grants of [{ codingAgents: true }, { full: true }])
    assert.deepEqual(agentsModels(models, cfg, device(grants)).map((m) => m.id), ["m-1", "cc/opus"], JSON.stringify(grants));
});

// (fails before: yes — their chat's mode was refused whatever it was, so a sub-agent from a chat in Full access started in
// this machine's own mode and asked; the owner's of 11-10. Their grants cap it at each call: turn.js `sessionMode`)
test("another machine's agents set their chat's mode by its name, at its start and in a turn; nothing else of the loop", () => {
  for (const mode of ["read-only", "edit", "ask", "auto", null]) assert.equal(agentBodyRefusal("POST /sessions", { cwd: "x", settings: { loop: { permissions: mode } } }), null, String(mode));
  for (const mode of ["bypass", 1, true])
    assert.match(String(agentBodyRefusal("POST /sessions", { cwd: "x", settings: { loop: { permissions: mode } } })), /^another machine's agents set a chat's mode by its name, read-only, edit, ask, auto; settings: loop.permissions is /, JSON.stringify(mode));
  assert.match(String(agentBodyRefusal("POST /sessions/:id/turns", { content: "hi", settingsPatch: { loop: { permissions: "yolo" } } })), /settingsPatch: loop.permissions is "yolo"$/);
  assert.equal(String(agentBodyRefusal("POST /sessions", { cwd: "x", settings: { loop: { tools: { show_visual: true } } } })), "another machine's agents set a chat's model.name, model.effort and loop.permissions alone; settings: loop.tools is more than that");
});

test("where another machine's agents may start a chat: a folder of this machine's own, never the data folder, in it or around it, a home folder, what holds one, or a drive's root", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-agent-folders-"));
  try {
    const dataDir = join(base, "data");
    const home = join(base, "home");
    const project = join(home, "code", "project");
    for (const d of [dataDir, project]) mkdirSync(d, { recursive: true });
    // The project is one the person's chats work in (remote-agent-fence.test.js: with no roots, the fence's one way in).
    const o = { dataDir, home, folders: [project] };
    assert.equal(agentFolderRefusal(project, o), null);
    assert.equal(agentFolderRefusal("", o), null, "the route says a folder is required");
    assert.match(String(agentFolderRefusal(dataDir, o)), /never start a chat in Filament's data folder; .* is in it/);
    assert.match(String(agentFolderRefusal(join(dataDir, "mem"), o)), /is in it/);
    assert.match(String(agentFolderRefusal(base, o)), /is around it/);
    assert.match(String(agentFolderRefusal(home, o)), /a home folder, or holds one/);
    assert.match(String(agentFolderRefusal(parse(base).root, o)), /never start a chat in Filament's data folder; .* is around it$/);
    if (process.platform === "win32") assert.match(String(agentFolderRefusal(otherRoot(base), { ...o, folders: [project, otherRoot(base)] })), /is a drive's root$/);
    if (process.platform === "win32") assert.match(String(agentFolderRefusal("\\\\server\\share\\project", o)), /another computer's share/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
