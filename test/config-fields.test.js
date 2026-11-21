// @ts-check
// Filament's own settings as the harness's Filament pages write them (HarnessV4_Settings_Plan HS-4): a write names the
// fields it changes, checked by the schema's type for each, against the configuration as it stands. A page read before
// another window's change is refused only when that change touched a field it names. A port or host saved away from
// where Filament listens waits for a restart, and Filament's own calls keep going where it listens until then.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startApp, fakeUpstream } from "./helpers/app.js";
import { systemRoutes } from "../src/http/admin/system.js";
import { defaultConfig } from "../src/config.js";
import { houseAuth } from "../src/services/house.js";

/** A port nothing listens on: one the system handed out and took back. @returns {Promise<number>} */
const freePort = () =>
  new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (srv.address());
      srv.close(() => resolve(port));
    });
  });

describe("PATCH /api/config/fields", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let s;
  before(async () => {
    up = await fakeUpstream();
    s = await startApp({
      supervisor: "desktop",
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m/*", upstream: "m", upstreamModel: "{1}" }];
      },
    });
  });
  after(async () => {
    await s?.stop();
    await up?.close();
  });
  /** @param {any} body */
  const patch = async (body) => {
    const r = await s.api("/api/config/fields", { method: "PATCH", body });
    return { status: r.status, json: await r.json() };
  };
  const state = async () => (await s.api("/api/state")).json();
  const onDisk = () => JSON.parse(readFileSync(join(s.dataDir, "config.json"), "utf8"));

  // (fails before: yes — no such route; a harness page could only save the whole configuration)
  test("a set saves the fields named, says each change in a line, moves the version on and leaves an op", async () => {
    const v0 = (await state()).configVersion;
    const r = await patch({ set: { "server.logLevel": "debug", "observability.storeBodies": "none" }, base: v0 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.changes, ["server.logLevel: info → debug", "observability.storeBodies: summary → none"]);
    assert.deepEqual(r.json.values, { "server.logLevel": "debug", "observability.storeBodies": "none" });
    assert.equal(r.json.restartNeeded, false);
    assert.equal(r.json.version, v0 + 1);
    assert.deepEqual([onDisk().server.logLevel, onDisk().observability.storeBodies], ["debug", "none"]);
    const ops = (await (await s.api("/api/ops?kinds=config&limit=20")).json()).ops;
    const op = ops.find((/** @type {any} */ o) => o.sub === "fields");
    assert.ok(op, "an op for the change");
    assert.equal(op.title, "settings changed in the harness (2 changes)");
    assert.deepEqual(op.detail.changes, r.json.changes);
  });

  // (fails before: yes — no such route)
  test("a value of the wrong type is refused with what the setting takes, and nothing is saved", async () => {
    const v0 = (await state()).configVersion;
    const cases = [
      [{ "server.requireAuth": "yes" }, "server.requireAuth is true or false"],
      [{ "server.maxBodyBytes": -1 }, "server.maxBodyBytes is a number, 0 or more"],
      [{ "server.maxBodyBytes": "big" }, "server.maxBodyBytes is a number, 0 or more"],
      [{ "server.logLevel": "loud" }, "server.logLevel is one of error, warn, info, debug"],
      [{ "server.allowedHosts": "a.test" }, "server.allowedHosts is a list"],
      [{ "server.allowedHosts": [1] }, "server.allowedHosts is a list of text"],
      [{ "server.advertiseEffortSuffixes": ["huge"] }, 'server.advertiseEffortSuffixes takes only low, medium, high, xhigh, max: not "huge"'],
    ];
    for (const [set, words] of cases) {
      const r = await patch({ set });
      assert.deepEqual([r.status, r.json.error], [400, words], JSON.stringify(set));
    }
    assert.equal((await state()).configVersion, v0, "nothing saved");
  });

  // (fails before: yes — no such route)
  test("only the sections the harness draws take writes, never a credential, and a write must name something", async () => {
    const cases = [
      [{ set: { "routes": [] } }, "routes is not one of the settings set here (server, agentLoop, observability, alerts, memory, ui, telemetry, experimental)"],
      [{ set: { "server": {} } }, "server is not a setting"],
      [{ set: { "server.nothing": 1 } }, "server.nothing is not a setting"],
      [{ set: { "server.inboundKeys": ["k"] } }, "server.inboundKeys holds credentials, which are not set here"],
      [{ set: { "server.adminToken": "t" } }, "server.adminToken holds credentials, which are not set here"],
      [{ unset: ["server.adminToken"] }, "server.adminToken holds credentials, which are not set here"],
      [{}, "name a setting to change: { set: { path: value } } or { unset: [path] }"],
      [{ set: { "server.logLevel": "warn" }, unset: ["server.logLevel"] }, "server.logLevel is both set and put back"],
      [{ set: [] }, "set is an object of { path: value }"],
      [{ unset: "server.logLevel" }, "unset is a list of paths"],
    ];
    for (const [body, words] of cases) {
      const r = await patch(body);
      assert.deepEqual([r.status, r.json.error], [400, words], JSON.stringify(body));
    }
  });

  // (fails before: yes — "sessions.resumeAfterRestart is not one of the settings set here": the Agent loop page's two
  // rows of `sessions` toasted an error at every change, the owner's of 11-09)
  test("the Agent loop page's two rows of sessions take writes, and no other setting of sessions does", async () => {
    const r = await patch({ set: { "sessions.resumeAfterRestart": false, "sessions.idleWakeMinutes": 12 } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.values, { "sessions.resumeAfterRestart": false, "sessions.idleWakeMinutes": 12 });
    assert.deepEqual([onDisk().sessions.resumeAfterRestart, onDisk().sessions.idleWakeMinutes], [false, 12]);
    const back = await patch({ unset: ["sessions.resumeAfterRestart", "sessions.idleWakeMinutes"] });
    assert.deepEqual([back.status, back.json.values], [200, { "sessions.resumeAfterRestart": true, "sessions.idleWakeMinutes": 5 }]);
    const map = await patch({ set: { "sessions.defaults": { context: {} } } });
    assert.equal(map.status, 400, "your defaults for sessions are Settings › New chats', never a field here");
    assert.match(map.json.error, /^sessions\.defaults is not one of the settings set here/);
  });

  // (fails before: yes — "sessions.commitTrailer is not one of the settings set here": the page's Filament as co-author
  // on commits toasted an error at every flip)
  test("the Agent loop page's co-author line takes writes too, on by default", async () => {
    const r = await patch({ set: { "sessions.commitTrailer": false } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.values, onDisk().sessions.commitTrailer], [{ "sessions.commitTrailer": false }, false]);
    const back = await patch({ unset: ["sessions.commitTrailer"] });
    assert.deepEqual([back.status, back.json.values], [200, { "sessions.commitTrailer": true }]);
  });

  // (fails before: yes — no such route)
  test("unset puts a field back to Filament's default; a write that moves nothing saves nothing", async () => {
    await patch({ set: { "server.requireAuth": false } });
    const v0 = (await state()).configVersion;
    const back = await patch({ unset: ["server.requireAuth"] });
    assert.deepEqual([back.status, back.json.values, back.json.changes], [200, { "server.requireAuth": true }, ["server.requireAuth: false → true"]]);
    assert.equal(back.json.version, v0 + 1);
    const same = await patch({ set: { "server.requireAuth": true } });
    assert.deepEqual([same.status, same.json.changes, same.json.version], [200, [], v0 + 1], "no save, no new version");
  });

  // (fails before: yes — no such route)
  test("lists are kept trimmed, without empty lines or repeats", async () => {
    const r = await patch({ set: { "server.allowedHosts": [" a.test ", "", "b.test", "a.test"], "server.advertiseEffortSuffixes": ["max", "max"] } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.values, { "server.allowedHosts": ["a.test", "b.test"], "server.advertiseEffortSuffixes": ["max"] });
    await patch({ unset: ["server.allowedHosts", "server.advertiseEffortSuffixes"] });
  });

  // (fails before: yes — no such route; HS-D3 for one field)
  test("a page read before another change is refused only for a field that change touched", async () => {
    const read = (await state()).configVersion;
    await patch({ set: { "server.logLevel": "warn" } });
    const touched = await patch({ set: { "server.logLevel": "error" }, base: read });
    assert.equal(touched.status, 409);
    assert.equal(touched.json.error, "This setting changed since the page read it: read it again");
    assert.deepEqual([touched.json.stale, touched.json.changes], [true, ["server.logLevel: debug → warn"]]);
    const other = await patch({ set: { "server.requireAuth": false }, base: read });
    assert.equal(other.status, 200, "a field the change did not touch is written");
    assert.deepEqual([onDisk().server.logLevel, onDisk().server.requireAuth], ["warn", false], "both changes stand");
    const ancient = await patch({ set: { "server.logLevel": "info" }, base: 0 });
    assert.deepEqual([ancient.status, ancient.json.error], [409, "These settings were read too long ago to tell what changed since: read them again"]);
    await patch({ set: { "server.logLevel": "info", "server.requireAuth": true } });
  });

  // (fails before: yes — /state did not say where Filament listens, nor what starts it again)
  test("/state says where Filament listens and what restarts it; a port saved away waits for a restart, set back it does not", async () => {
    const st = await state();
    assert.deepEqual(st.listening, { host: "127.0.0.1", port: s.port });
    assert.equal(st.supervisor, "desktop");
    const away = await freePort();
    const moved = await patch({ set: { "server.port": away } });
    assert.deepEqual([moved.status, moved.json.restartNeeded], [200, true]);
    const ops = (await (await s.api("/api/ops?kinds=config&limit=20")).json()).ops;
    assert.equal(ops.find((/** @type {any} */ o) => o.sub === "fields").level, "warn");
    const after = await state();
    assert.deepEqual([after.config.server.port, after.listening.port], [away, s.port], "saved, and still listening where it started");
    assert.equal(after.endpoints.openai, `http://127.0.0.1:${s.port}/v1`, "apps reach it where it listens");
    const back = await patch({ set: { "server.port": s.port } });
    assert.deepEqual([back.status, back.json.restartNeeded], [200, false], "back where it listens: nothing to wait for");
  });

  // (fails before: yes — Filament's own calls went to the port saved, where nothing listens until a restart)
  test("with a port saved away, Filament's own calls still go where it listens", async () => {
    const away = await freePort();
    assert.equal((await patch({ set: { "server.port": away } })).status, 200);
    const ping = await (await s.post("/api/models/ping", { model: "m/m-1" })).json();
    assert.equal(ping.ok, true, JSON.stringify(ping));
    assert.equal(ping.upstream, "m");
    await patch({ set: { "server.port": s.port } });
  });

  // (fails before: yes — the console's save judged a restart against the port saved, not the one Filament listens on)
  test("the console's whole save asks for no restart when it puts the port back where Filament listens", async () => {
    const away = await freePort();
    await patch({ set: { "server.port": away } });
    const cfg = (await state()).config;
    cfg.server.port = s.port;
    const r = await s.api("/api/config", { method: "PUT", body: cfg });
    const j = await r.json();
    assert.deepEqual([r.status, j.restartNeeded], [200, false], JSON.stringify(j).slice(0, 300));
  });
});

describe("/state with no supervisor", () => {
  // (fails before: yes — /state did not say what starts Filament again)
  test("says none, so the About page offers a stop, not a restart", async () => {
    const s = await startApp();
    try {
      const st = await (await s.api("/api/state")).json();
      assert.equal(st.supervisor, null);
    } finally {
      await s.stop();
    }
  });
});

describe("/state over a listener's host, read in a context of its own (nothing listens)", () => {
  /**
   * The row's answer for a configuration and where Filament listens.
   * @param {(cfg: any) => void} edit @param {{ host: string, port: number } | null} at
   */
  const stateOf = async (edit, at) => {
    const cfg = /** @type {any} */ (defaultConfig());
    edit(cfg);
    const a = {
      config: { get: () => cfg, loaded: { file: "config.json" }, version: () => 1, unreadable: () => [] },
      usage: { summary: () => ({}), logReach: () => null },
      listening: () => at,
      VERSION: "9.9.9",
      startedAt: 0,
      dataDir: "data",
    };
    const row = systemRoutes(a).find(([method, path]) => method === "GET" && path === "/state");
    assert.ok(row);
    const res = { status: 0, text: "", writableEnded: false, destroyed: false, writeHead(/** @type {number} */ s) { this.status = s; }, end(/** @type {string} */ t) { this.text = t; } };
    await /** @type {any} */ (row)[2]({ res, url: new URL("http://x/state") });
    return JSON.parse(res.text);
  };

  // (fails before: yes — the production-readiness bug hunt of 10-30, DESK-9's siblings: the endpoints wrote
  // `http://::1:20300/v1` and `http://0.0.0.0:20300/v1`, addresses no app reaches Filament at)
  test("the endpoints write a wildcard host as localhost and an IPv6 host in brackets, each an address that reads", async () => {
    for (const [host, at] of [["127.0.0.1", "http://127.0.0.1:20300"], ["::1", "http://[::1]:20300"], ["fe80::1", "http://[fe80::1]:20300"], ["0.0.0.0", "http://localhost:20300"], ["::", "http://localhost:20300"], ["box.lan", "http://box.lan:20300"]]) {
      const st = await stateOf(() => {}, { host, port: 20300 });
      assert.deepEqual(st.endpoints, { anthropic: `${at}/v1`, openai: `${at}/v1` }, host);
      assert.equal(new URL(st.endpoints.openai).port, "20300", host);
    }
  });

  // (fails before: yes — the production-readiness bug hunt of 10-30, the roots' decision: nothing said that Filament
  // listened beyond this machine with no folder in agentLoop.roots)
  test("a listener open beyond this machine with no agentLoop.roots is said plainly; this machine's alone, or roots listed, says nothing", async () => {
    const open = await stateOf((c) => { c.server.host = "0.0.0.0"; c.agentLoop.roots = []; }, null);
    assert.equal(open.exposed, "Filament listens on 0.0.0.0, beyond this machine, and agentLoop.roots lists no folder: a coding agent works in whatever folder a request names, another computer's request too, and Filament's own agent works in none. List the folders agents may work in under agentLoop.roots (Settings → Agent loop).");
    assert.equal((await stateOf((c) => { c.server.host = "0.0.0.0"; c.agentLoop.roots = [join("C:", "work")]; }, null)).exposed, null, "roots listed");
    for (const host of ["127.0.0.1", "localhost", "::1"]) assert.equal((await stateOf((c) => { c.server.host = host; c.agentLoop.roots = []; }, null)).exposed, null, host);
  });

  // (fails before: yes — the production-readiness bug hunt of 10-30, the loopback rule: only 127.0.0.1, localhost and ::1
  // read as this machine's own, so another loopback address was said to listen beyond it)
  test("every loopback address is this machine's own, however it is spelled; a network address with no roots is said", async () => {
    for (const host of ["127.0.0.2", "127.1", "::ffff:127.0.0.1", "[::1]", "LOCALHOST"]) assert.equal((await stateOf((c) => { c.server.host = host; c.agentLoop.roots = []; }, null)).exposed, null, host);
    assert.match((await stateOf((c) => { c.server.host = "192.168.1.5"; c.agentLoop.roots = []; }, null)).exposed, /^Filament listens on 192\.168\.1\.5, beyond this machine, and agentLoop\.roots lists no folder: /);
    const { loopbackHost } = await import("../src/services/config/store.js");
    for (const host of ["0.0.0.0", "::", "", "192.168.1.5", "fe80::1", "box.lan", "::ffff:10.0.0.1", "128.0.0.1"]) assert.equal(loopbackHost(host), false, host);
  });
});

describe("where Filament reaches itself", () => {
  // (fails before: yes — the production-readiness bug hunt of 10-30: Filament's calls to itself, and the addresses it hands
  // out for its own doors, named 127.0.0.1 whatever it listened on)
  test("the address it listens on: a wildcard as the loopback of its family, an IPv6 address in brackets, any other as it is", async () => {
    const { selfAddress } = await import("../src/services/config/store.js");
    /** @type {[any, string][]} */
    const cases = [
      [{ address: "127.0.0.1", port: 20300 }, "http://127.0.0.1:20300"],
      [{ address: "0.0.0.0", port: 1 }, "http://127.0.0.1:1"],
      [{ address: "::", port: 2 }, "http://[::1]:2"],
      [{ address: "::1", port: 3 }, "http://[::1]:3"],
      [{ address: "192.168.1.5", port: 4 }, "http://192.168.1.5:4"],
      [{ host: "", port: 5 }, "http://127.0.0.1:5"],
      [{ host: "localhost", port: 6 }, "http://localhost:6"],
      [{ host: "[::1]", port: 7 }, "http://[::1]:7"],
    ];
    for (const [at, want] of cases) assert.equal(selfAddress(at), want, JSON.stringify(at));
  });

  // (fails before: yes — the same: on an IPv6 address Filament's own agent called 127.0.0.1, where nothing listened, and
  // /status named that address as the console's)
  test("listening on ::1, Filament's own agent reaches its door there, and /status names the console there", async () => {
    const up = await fakeUpstream();
    const s = await startApp({
      configure: (cfg) => {
        cfg.server.host = "::1";
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}" }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, roots: [], readerModel: "" };
      },
    });
    try {
      const at = `http://[::1]:${s.port}`;
      const ask = (/** @type {string} */ model, /** @type {string} */ words) =>
        fetch(`${at}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", ...houseAuth(), "x-filament-cwd": s.dataDir }, body: JSON.stringify({ model, max_tokens: 100, messages: [{ role: "user", content: words }] }) });
      const turn = await ask("agent/m-1", "say hello");
      const said = await turn.json();
      assert.equal(turn.status, 200, JSON.stringify(said));
      assert.match(JSON.stringify(said.content), /MODEL ANSWER/, "the loop's call came back through its own door");
      // Asked on the loop's name, a chat Filament runs: one of Filament's own calls on a plain model is no chat.
      const status = await (await ask("agent/m-1", "/status")).json();
      assert.match(JSON.stringify(status.content), new RegExp(`Console: http://\\[::1\\]:${s.port}/`));
    } finally {
      await s.stop();
      await up.close();
    }
  });
});
