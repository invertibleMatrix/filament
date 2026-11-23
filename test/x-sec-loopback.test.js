// @ts-check
// The loopback door (the remote-agents plan's fc-door): any program on this computer reaches the admin API as `local`
// with no secret — a chat's shell, a script, `filament` run by a model —, and a grant lets another machine's agents run
// commands here as the person. So while the desktop app holds its press key (guards.js `pressRefusal`), a pairing's code
// (POST /remote/pair) and another machine's agents' grants (PATCH /remote/devices/:id with `grants`) come from the app's
// window alone, with the key: this computer's caller without it is refused in words, and so is a tailnet login Filament
// trusts — any program on the person's machines carries it, and one here reaches the tailnet's door over loopback —, and
// the admin token, which a program here reads from the config or sets there. A paired full device — another machine's
// app — opens the door as it did, and a Filament with no app is unchanged.
// Through a real Filament served on a tailnet whose Tailscale is a stand-in.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { PRESS_HEADER, setPressKey } from "../src/http/guards.js";
import { runCli } from "../src/cli/main.js";
import { EXIT } from "../src/cli/client.js";
import { startApp } from "./helpers/app.js";

const KEY = randomBytes(32).toString("base64url");
const PRESS = { [PRESS_HEADER]: KEY };
const FAR = { "x-forwarded-for": "100.101.102.103" };
const ADMIN = randomBytes(24).toString("base64url");
/** The admin token sent as a proxy here hands a request on: a program here that read it from the config, or set it there. */
const AS_ADMIN = { "x-filament-admin": ADMIN, ...FAR };
const NAME = "desktop-1.tail5e6f7a.ts.net";
const OWNER = "owner@example.com";
const REFUSED = /while the Filament app runs, a pairing's code, and what another machine's agents may do here, come from its window/;

/**
 * Tailscale's command line, a stand-in signed in as OWNER: its serve serves what it is asked to, and keeps it as the
 * real one does. @type {import("../src/services/tailscale.js").Exec}
 */
const tailscale = (() => {
  /** @type {any} */
  const cfg = {};
  const ok = (/** @type {string} */ out) => ({ code: 0, out, err: "", timedOut: false });
  const status = {
    BackendState: "Running",
    Self: { DNSName: "DESKTOP-1.tail5e6f7a.ts.net.", HostName: "desktop-1", UserID: 111, TailscaleIPs: ["100.127.5.0"] },
    User: { 111: { LoginName: OWNER } },
    CurrentTailnet: { Name: OWNER, MagicDNSSuffix: "tail5e6f7a.ts.net" },
    CertDomains: [NAME],
  };
  return async (_file, args) => {
    if (args[0] === "status") return ok(JSON.stringify(status));
    if (args.join(" ") === "serve status --json") return ok(JSON.stringify(cfg));
    const https = Number(/^--https=(\d+)$/.exec(args.find((a) => a.startsWith("--https=")) || "")?.[1]);
    if (args.at(-1) === "off") {
      delete cfg.TCP?.[String(https)];
      delete cfg.Web?.[`${NAME}:${https}`];
      return ok("");
    }
    ((cfg.TCP ||= {})[String(https)] = { HTTPS: true });
    ((cfg.Web ||= {})[`${NAME}:${https}`] = { Handlers: { "/": { Proxy: args.at(-1) } } });
    return ok("");
  };
})();

/**
 * A request over node:http to a port of this machine, so the test sets every header itself.
 * @param {number} port @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, json: any, text: string }>}
 */
const ask = (port, path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path, method, agent: false, headers: { host: `127.0.0.1:${port}`, ...(text ? { "content-type": "application/json" } : {}), ...headers } });
    req.on("response", (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(b);
        } catch {}
        resolve({ status: Number(res.statusCode), headers: res.headers, json, text: b });
      });
    });
    req.on("error", reject);
    req.end(text || undefined);
  });

/** Refused at the door, in words, marked as the key's. @param {{ status: number, json: any, text: string }} r @param {string} what */
const shut = (r, what) => {
  assert.equal(r.status, 403, `${what}: ${r.text}`);
  assert.match(String(r.json?.error), REFUSED, what);
  assert.equal(r.json?.press, true, what);
};

describe("the loopback door, on a Filament served on the tailnet", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** The tailnet's door: the port tailscale serve hands requests on to. */
  let door = 0;
  /** A full device another machine's app paired from the app's window: its headers there, and its cookie. */
  let full = { far: /** @type {Record<string, string>} */ ({}), cookie: "" };
  /** The agents' device that full device minted for its machine: its id. */
  let agents = "";
  /** @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o] */
  const call = (path, o) => ask(shim.port, path, o);
  /**
   * A request at the tailnet's door as tailscale serve hands one on from a machine signed in as OWNER — and as any
   * program here that connects to that port and says so itself.
   * @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
   */
  const viaTailnet = (path, { method = "GET", headers = {}, body } = {}) =>
    ask(door, path, { method, body, headers: { host: NAME, "x-forwarded-for": "100.101.102.103", "x-forwarded-proto": "https", "x-forwarded-host": NAME, "tailscale-user-login": OWNER, ...(method === "GET" ? {} : { origin: `https://${NAME}` }), ...headers } });
  /** The agents' device's grants, as this machine lists them. */
  const grants = async () => {
    const r = await call("/api/remote/devices", { headers: PRESS });
    assert.equal(r.status, 200, r.text);
    return r.json.devices.find((/** @type {any} */ d) => d.id === agents)?.grants;
  };
  /** The codes open now. */
  const pending = async () => (await call("/api/remote/pair")).json.pending;

  before(async () => {
    shim = await startApp({
      configure: (c) => {
        c.server.tailscale = { serve: true, trustOwnLogin: true, port: 0 };
        c.server.adminToken = ADMIN;
      },
      overrides: { tailnet: { cli: () => "ts", exec: tailscale } },
    });
    const look = await call("/api/remote/tailscale");
    assert.equal(look.json?.address, `https://${NAME}`, look.text);
    door = look.json.listening.port;
    setPressKey(KEY);
    const own = { origin: `http://127.0.0.1:${shim.port}` };
    const pair = await call("/api/remote/pair", { method: "POST", headers: PRESS, body: { scope: "full" } });
    assert.equal(pair.status, 200, pair.text);
    const claimed = await call("/api/remote/claim", { method: "POST", headers: { ...FAR, ...own }, body: { code: pair.json.code, name: "Filament app on Studio" } });
    assert.equal(claimed.status, 200, claimed.text);
    const cookie = String(claimed.headers["set-cookie"]?.[0] || "").split(";")[0];
    full = { far: { ...FAR, ...own, cookie }, cookie };
    const minted = await call("/api/remote/agent-device", { method: "POST", headers: full.far, body: {} });
    assert.equal(minted.status, 200, minted.text);
    agents = String(minted.json.device.id);
  });
  after(async () => {
    setPressKey("");
    await shim.stop();
  });

  // (fails before: yes — a program here made a pairing's code with no key, and switched another machine's agents' grant on)
  test("this computer's caller without the key — a chat's shell, a script, a page in a browser — makes no code and sets no grant, told in words; a rename is no door; the app's page does both", async () => {
    await call("/api/remote/pair", { method: "DELETE" });
    shut(await call("/api/remote/pair", { method: "POST", body: { scope: "full" } }), "a pairing, by a program");
    shut(await call("/api/remote/pair", { method: "POST", headers: { origin: `http://127.0.0.1:${shim.port}` }, body: { scope: "view" } }), "a pairing, by a browser's page");
    shut(await call("/api/remote/pair", { method: "POST", headers: { [PRESS_HEADER]: "x".repeat(KEY.length) }, body: { scope: "full" } }), "a pairing, with another key");
    assert.deepEqual(await pending(), [], "no code was made");
    shut(await call(`/api/remote/devices/${agents}`, { method: "PATCH", body: { grants: { agents: true, unasked: true } } }), "a grant");
    shut(await call(`/api/remote/devices/${agents}`, { method: "PATCH", body: { name: "Mine now", grants: { agents: false } } }), "a grant with a name");
    assert.deepEqual(await grants(), { agents: false, copies: false, models: false, browser: false, unasked: false, codingAgents: false, full: false }, "no grant was set");
    const renamed = await call(`/api/remote/devices/${agents}`, { method: "PATCH", body: { name: "Studio's agents" } });
    assert.equal(renamed.status, 200, renamed.text);
    // The app's page: its writes carry the key.
    const code = await call("/api/remote/pair", { method: "POST", headers: PRESS, body: { scope: "view" } });
    assert.equal(code.status, 200, code.text);
    assert.match(String(code.json.code), /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const set = await call(`/api/remote/devices/${agents}`, { method: "PATCH", headers: PRESS, body: { grants: { agents: true } } });
    assert.equal(set.status, 200, set.text);
    assert.equal((await grants())?.agents, true);
    await call(`/api/remote/devices/${agents}`, { method: "PATCH", headers: PRESS, body: { grants: { agents: false } } });
    await call("/api/remote/pair", { method: "DELETE" });
  });

  // (fails before: yes — a tailnet login Filament trusts switched a grant on with no key, and was refused a pairing in
  // other words, as a machine that is not this one)
  test("a tailnet login Filament trusts — from the person's other machine, or a program here at the tailnet's door — sets no grant and makes no code without the key; it drives the rest as before", async () => {
    assert.equal((await viaTailnet("/api/remote/me")).json?.who, "tailnet");
    shut(await viaTailnet(`/api/remote/devices/${agents}`, { method: "PATCH", body: { grants: { agents: true } } }), "a grant over the tailnet");
    assert.equal((await grants())?.agents, false, "no grant was set");
    shut(await viaTailnet("/api/remote/pair", { method: "POST", body: { scope: "full" } }), "a pairing over the tailnet");
    assert.deepEqual(await pending(), []);
    const renamed = await viaTailnet(`/api/remote/devices/${agents}`, { method: "PATCH", body: { name: "Studio's agents" } });
    assert.equal(renamed.status, 200, renamed.text);
    const st = await viaTailnet("/api/state");
    assert.equal(st.status, 200, st.text);
  });

  // (fails before: yes — a tailnet login pressed with no key: a program here at the tailnet's door, saying the login
  // itself, answered an ask as the person)
  test("a tailnet login Filament trusts presses nothing without the key — an ask's answer, a rule, a turn's Allow — told in its own words; a full device paired over the tailnet presses there", async () => {
    for (const [what, path, body] of /** @type {const} */ ([
      ["an ask's answer", "/api/sessions/c1/asks/r1/answer", { allow: true }],
      ["an always rule", "/api/sessions/c1/rules/always", { rule: "Bash(ls)" }],
      ["a turn's Allow", "/api/sessions/c1/turns", { allow: true }],
    ])) {
      const r = await viaTailnet(path, { method: "POST", body });
      assert.equal(r.status, 403, `${what}: ${r.text}`);
      assert.match(String(r.json?.error), /a tailnet login presses nothing while it runs/, what);
      assert.match(String(r.json?.error), /Settings › Remote access/, `${what}: where to pair`);
      assert.equal(r.json?.press, true, what);
    }
    const paired = await viaTailnet("/api/sessions/c1/asks/r1/answer", { method: "POST", headers: { cookie: full.cookie }, body: { allow: true } });
    assert.equal(paired.json?.press, undefined, `the full device's cookie over the tailnet: ${paired.text}`);
    const grant = await viaTailnet(`/api/remote/devices/${agents}`, { method: "PATCH", headers: { cookie: full.cookie }, body: { grants: { models: true } } });
    assert.equal(grant.status, 200, `the full device sets a grant over the tailnet as from anywhere: ${grant.text}`);
    await call(`/api/remote/devices/${agents}`, { method: "PATCH", headers: PRESS, body: { grants: { models: false } } });
  });

  // (fails before: yes — a program here that read the admin token, and sent it as a proxy would, switched a grant on)
  test("the admin token — a program here reads it from the config, or sets it there — sent as a proxy would sets no grant without the key", async () => {
    assert.equal((await call("/api/remote/me", { headers: AS_ADMIN })).json?.who, "admin");
    shut(await call(`/api/remote/devices/${agents}`, { method: "PATCH", headers: AS_ADMIN, body: { grants: { agents: true } } }), "a grant with the admin token");
    assert.equal((await grants())?.agents, false, "no grant was set");
  });

  // (fails before: yes, its pairing — s0b: a device through a tunnel was this computer itself, and started a pairing)
  test("a paired full device — another machine's app — sets grants with no key, from the network and through an SSH tunnel's loopback; it starts no pairing from either", async () => {
    const far = await call(`/api/remote/devices/${agents}`, { method: "PATCH", headers: full.far, body: { grants: { models: true } } });
    assert.equal(far.status, 200, far.text);
    const tunnel = await call(`/api/remote/devices/${agents}`, { method: "PATCH", headers: { cookie: full.cookie }, body: { grants: { models: false } } });
    assert.equal(tunnel.status, 200, tunnel.text);
    assert.equal((await grants())?.models, false);
    const me = await call("/api/remote/me", { headers: { cookie: full.cookie } });
    assert.deepEqual([me.json?.who, me.json?.device?.scope, me.json?.desk?.includes("tunnel-device")], ["device", "full", true], "through the tunnel, its device");
    const code = await call("/api/remote/pair", { method: "POST", headers: { cookie: full.cookie }, body: { scope: "view" } });
    assert.equal(code.status, 403, "through the tunnel, the device is that machine's, not this computer");
    assert.equal(code.json?.press, undefined, code.text);
    const there = await call("/api/remote/pair", { method: "POST", headers: full.far, body: { scope: "view" } });
    assert.equal(there.status, 403, "from another machine, a pairing starts on the machine it pairs with");
    assert.equal(there.json?.press, undefined, there.text);
    await call("/api/remote/pair", { method: "DELETE" });
  });

  // (fails before: yes — `filament pair` run by a program here made a code with no key)
  test("`filament pair` while the app holds a key makes no code, and says to make it in the app", async () => {
    /** @type {string[]} */
    const err = [];
    /** @type {string[]} */
    const out = [];
    const code = await runCli(["pair"], { dataDir: shim.dataDir, out: (s) => out.push(s), err: (s) => err.push(s), write: () => {} });
    assert.equal(code, EXIT.failed, `${out.join("\n")}\n${err.join("\n")}`);
    assert.match(err.join("\n"), /the Filament app runs here, and makes the code while it runs: in it, Settings › Remote access › Pair with a code › Make a code/);
    assert.deepEqual(out, []);
    assert.deepEqual(await pending(), []);
  });

  // (fails before: yes — s0b: `filament open` opened the harness unpaired, saying nothing of the app's own way in)
  test("`filament open` while the app holds a key makes no code: the page opens unpaired, and the tray's Open in browser is named", async () => {
    /** @type {string[]} */
    const out = [];
    const code = await runCli(["open", "--no-open"], { dataDir: shim.dataDir, out: (s) => out.push(s), err: () => {}, write: () => {} });
    assert.equal(code, EXIT.ok, out.join("\n"));
    assert.match(out[0], /\/ui\/harness\.html$/);
    assert.equal(out[1], "The Filament app runs here, and pairs a browser with its tray's Open in browser: this page opens unpaired.");
    assert.deepEqual(await pending(), []);
  });

  // (fails before: yes — the review of s0b: a browser here paired by `filament open` or the tray was a full device that
  // pressed with no key, and its cookie, which a browser sends to every port of 127.0.0.1, was a dev server's there to
  // press with, and to take to the network)
  test("a browser here — the tray's code, claimed on loopback alone — is this computer itself: no press, nothing from the network; paired again, its old pairing goes", async () => {
    const own = { origin: `http://127.0.0.1:${shim.port}` };
    const made = await call("/api/remote/pair", { method: "POST", headers: PRESS, body: { scope: "full", here: true } });
    assert.equal(made.status, 200, made.text);
    assert.deepEqual([made.json.links, made.json.fingerprint], [[], null], "no link for the network");
    const afar = await call("/api/remote/claim", { method: "POST", headers: { ...FAR, ...own }, body: { code: made.json.code, name: "Far browser" } });
    assert.equal(afar.status, 403, afar.text);
    assert.equal((await pending()).length, 1, "refused from afar, the code still open");
    const claimed = await call("/api/remote/claim", { method: "POST", headers: own, body: { code: made.json.code, name: "Chrome here" } });
    assert.equal(claimed.status, 200, claimed.text);
    const cookie = String(claimed.headers["set-cookie"]?.[0] || "").split(";")[0];
    assert.equal((await call("/api/remote/me", { headers: { cookie } })).json?.who, "local", "this computer itself");
    /** This browser's pairings, as this machine lists them. */
    const mine = async () => (await call("/api/remote/devices", { headers: PRESS })).json.devices.filter((/** @type {any} */ d) => d.name === "Chrome here" && d.revokedAt == null);
    const first = await mine();
    assert.deepEqual(first.map((/** @type {any} */ d) => d.here), [true]);
    // No press with it while the app holds its key, as this computer's own browser never had; nor with its token as a
    // Bearer, as a program at another port that read the cookie would send it.
    shut(await call("/api/remote/pair", { method: "POST", headers: { ...own, cookie }, body: { scope: "view" } }), "a browser here's pairing");
    shut(await call(`/api/remote/devices/${agents}`, { method: "PATCH", headers: { authorization: `Bearer ${cookie.slice(cookie.indexOf("=") + 1)}` }, body: { grants: { agents: true } } }), "its token as a Bearer");
    assert.equal((await grants())?.agents, false);
    assert.equal((await call("/api/state", { headers: { ...FAR, cookie } })).status, 403, "from the network, its token is no one's");
    // Paired again — `filament open` once more —: one pairing for one browser.
    const again = await call("/api/remote/pair", { method: "POST", headers: PRESS, body: { scope: "full", here: true } });
    const second = await call("/api/remote/claim", { method: "POST", headers: { ...own, cookie }, body: { code: again.json.code, name: "Chrome here" } });
    assert.equal(second.status, 200, second.text);
    const now = await mine();
    assert.equal(now.length, 1);
    assert.notEqual(now[0].id, first[0].id, "the old pairing gone for good");
    assert.ok(!(await call("/api/remote/devices", { headers: PRESS })).json.devices.some((/** @type {any} */ d) => d.id === first[0].id));
    await call("/api/remote/pair", { method: "DELETE" });
  });

  // (fails before: no — with no key nothing changed; it guards that it still does not)
  test("with no app — a server, the CLI —, this computer, a trusted tailnet login and the admin token pair and set grants as before, and `filament pair` makes a code", async () => {
    setPressKey("");
    try {
      const code = await call("/api/remote/pair", { method: "POST", body: { scope: "view" } });
      assert.equal(code.status, 200, code.text);
      const set = await call(`/api/remote/devices/${agents}`, { method: "PATCH", body: { grants: { browser: true } } });
      assert.equal(set.status, 200, set.text);
      const tailnet = await viaTailnet(`/api/remote/devices/${agents}`, { method: "PATCH", body: { grants: { browser: false } } });
      assert.equal(tailnet.status, 200, tailnet.text);
      assert.equal((await grants())?.browser, false);
      const admin = await call(`/api/remote/devices/${agents}`, { method: "PATCH", headers: AS_ADMIN, body: { grants: { browser: true } } });
      assert.equal(admin.status, 200, admin.text);
      assert.equal((await grants())?.browser, true);
      /** @type {string[]} */
      const out = [];
      /** @type {string[]} */
      const err = [];
      assert.equal(await runCli(["pair"], { dataDir: shim.dataDir, out: (s) => out.push(s), err: (s) => err.push(s), write: () => {} }), EXIT.ok, err.join("\n"));
      assert.match(out.join("\n"), /^Code [A-Z0-9]{4}-[A-Z0-9]{4} — a full device/);
    } finally {
      await call("/api/remote/pair", { method: "DELETE" });
      setPressKey(KEY);
    }
  });
});
