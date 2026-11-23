// @ts-check
// Share on my tailnet (the owner's remote Filament of 11-06, Part 2; services/tailscale.js): one switch has Tailscale's
// command line serve this Filament at https://<machine>.<tailnet>.ts.net, to doors of its own on loopback; the guards
// let the tailnet's name in at that door alone, and — where it is trusted — a machine signed in to the tailnet as this
// one is. Tailscale here is a stand-in that keeps a serve config as the real one does, run through the exec seam.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLI_MS,
  DOWNLOAD,
  LOOK_MS,
  SERVE_ART_HTTPS,
  SERVE_HTTPS,
  TAILNET_PORT,
  askedAt,
  cliPlaces,
  createTailnetShare,
  findCli,
  runCli,
  servedAt,
  stateWords,
  statusOf,
  tailnetDoor,
  tailnetPortOf,
} from "../src/services/tailscale.js";
import { drives, hostAllowed, onTailnetDoor, readsEverySession, whoIs } from "../src/http/guards.js";
import { isArtifactOrigin } from "../src/core/artifacts.js";
import { validateConfig } from "../src/services/config/store.js";
import { defaultConfig } from "../src/config.js";
import { startApp } from "./helpers/app.js";

const NAME = "desktop-1.tail5e6f7a.ts.net";
const OWNER = "owner@example.com";
/** What `tailscale status --json` says, cut to what Filament reads — the shape 1.104's prints. */
const STATUS = Object.freeze({
  BackendState: "Running",
  Self: { DNSName: "DESKTOP-1.tail5e6f7a.ts.net.", HostName: "desktop-1", UserID: 111, TailscaleIPs: ["100.127.5.0", "fd7a:115c:a1e0::d301:5ef"] },
  User: { 111: { LoginName: OWNER }, 222: { LoginName: "friend@example.com" } },
  CurrentTailnet: { Name: OWNER, MagicDNSSuffix: "tail5e6f7a.ts.net" },
  CertDomains: [NAME],
  Peer: {
    "nodekey:a": { HostName: "studio", DNSName: "studio.tail5e6f7a.ts.net.", Online: true, OS: "macOS", UserID: 111 },
    "nodekey:b": { HostName: "phone", DNSName: "phone.tail5e6f7a.ts.net.", Online: false, OS: "iOS", UserID: 222 },
    "nodekey:c": { HostName: "no-dns", DNSName: "", Online: true },
  },
});
/** What Tailscale asks of a tailnet whose Serve is not turned on: the address, and a wait. */
const ASKS = "Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nT3st\n\nWaiting...\n";

/**
 * Tailscale's command line, as a stand-in: its status, and a serve config it keeps as the real one does.
 * @param {{ status?: any, cfg?: any }} [o]
 */
const fakeTailscale = ({ status = STATUS, cfg = {} } = {}) => {
  const t = {
    status: /** @type {any} */ (status),
    cfg: /** @type {any} */ (cfg),
    /** Every call: its arguments and the bound it was given. @type {{ args: string[], timeoutMs: number }[]} */
    calls: [],
    /** What serve does when asked to serve: serve it, ask for Serve to be turned on, or fail. */
    serves: /** @type {"yes" | "asks" | "fails" | "refused"} */ ("yes"),
    statusExit: 0,
    /** What `serve status` does: answer, or fail. */
    configExit: 0,
    /** Calls in flight now, and the most at once. */
    busy: 0,
    most: 0,
    /** A call waits on it while it is set: a command line that takes its while. @type {Promise<void> | null} */
    gate: /** @type {Promise<void> | null} */ (null),
    /** @type {import("../src/services/tailscale.js").Exec} */
    exec: async (file, args, { timeoutMs }) => {
      assert.equal(file, "ts");
      t.calls.push({ args, timeoutMs });
      t.most = Math.max(t.most, ++t.busy);
      try {
        if (t.gate) await t.gate;
        return await t.answer(args);
      } finally {
        t.busy--;
      }
    },
    /** @param {string[]} args @returns {Promise<import("../src/services/tailscale.js").Ran>} */
    answer: async (args) => {
      const ok = (/** @type {string} */ out) => ({ code: 0, out, err: "", timedOut: false });
      if (args[0] === "status") return t.statusExit ? { code: 1, out: "", err: "failed to connect to local tailscaled; it doesn't appear to be running", timedOut: false } : ok(JSON.stringify(t.status));
      if (args.join(" ") === "serve status --json") return t.configExit ? { code: 1, out: "", err: "serve status: something broke", timedOut: false } : ok(JSON.stringify(t.cfg));
      const https = Number(/^--https=(\d+)$/.exec(args.find((a) => a.startsWith("--https=")) || "")?.[1]);
      if (args.at(-1) === "off") {
        delete t.cfg.TCP?.[String(https)];
        delete t.cfg.Web?.[`${NAME}:${https}`];
        return ok("");
      }
      if (t.serves === "asks") return { code: null, out: ASKS, err: "", timedOut: true };
      if (t.serves === "fails") return { code: 1, out: "", err: "serve: something broke", timedOut: false };
      if (t.serves === "refused") return { code: 1, out: "", err: "Access denied: serve config denied", timedOut: false };
      ((t.cfg.TCP ||= {})[String(https)] = { HTTPS: true });
      ((t.cfg.Web ||= {})[`${NAME}:${https}`] = { Handlers: { "/": { Proxy: args.at(-1) } } });
      return ok(`Available within your tailnet:\n\nhttps://${NAME}${https === 443 ? "" : `:${https}`}/\n|-- proxy ${args.at(-1)}\n`);
    },
    /** The calls' arguments, each joined. */
    said: () => t.calls.map((c) => c.args.join(" ")),
  };
  return t;
};

/** Every share a test made, its doors closed after it whatever it asserted: one that failed leaves none listening. */
const made = /** @type {ReturnType<typeof createTailnetShare>[]} */ ([]);
/** @param {Parameters<typeof createTailnetShare>[0]} o */
const shareOf = (o) => {
  const share = createTailnetShare(o);
  made.push(share);
  return share;
};
afterEach(async () => {
  for (const share of made.splice(0)) await share.close();
});

/** A request to a door: what answers, and the Host it was handed with. */
const heard = () => {
  /** @type {{ host: string | undefined, door: string }[]} */
  const got = [];
  const answer = (/** @type {string} */ door) => (/** @type {any} */ req, /** @type {any} */ res) => {
    got.push({ host: req.headers.host, door });
    res.end(door);
  };
  return {
    got,
    handler: answer("pages"),
    artifacts: answer("artifacts"),
    upgrade: (/** @type {any} */ req, /** @type {any} */ s) => {
      got.push({ host: req.headers.host, door: "upgrade" });
      s.destroy();
    },
  };
};
/** @param {number} port @param {Record<string, string>} [headers] @returns {Promise<{ status: number, body: string }>} */
const get = (port, headers = {}) =>
  new Promise((resolve, reject) => {
    const r = http.get({ host: "127.0.0.1", port, path: "/", headers, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: Number(res.statusCode), body }));
    });
    r.on("error", reject);
  });
/**
 * Two free ports side by side, picked at random below the ephemeral range: Windows gives its free ports one after
 * another, so the port after one it gave is the next it gives — to another test of the suite, mid-pick (the old pick, an
 * ephemeral port and the next, failed 25 times in 30 beside four threads taking ports).
 */
const freePair = async () => {
  const free = (/** @type {number} */ port) =>
    new Promise((r) => {
      const s = createServer();
      s.once("error", () => r(false));
      s.listen(port, "127.0.0.1", () => s.close(() => r(true)));
    });
  for (let i = 0; i < 200; i++) {
    const p = 30000 + 2 * Math.floor(Math.random() * 9000);
    if ((await free(p)) && (await free(p + 1))) return p;
  }
  throw new Error("no two free ports side by side");
};
/** A request as the guards read it, at a local port. @param {Record<string, string>} headers @param {number} localPort @param {string} [remoteAddress] */
const at = (headers, localPort, remoteAddress = "127.0.0.1") => /** @type {any} */ ({ headers, socket: { remoteAddress, localPort } });

describe("Tailscale, as its command line says it", () => {
  // (fails before: yes — the module did not exist)
  test("its command line: each folder on PATH first, then where its installer puts it on each platform; none where it is not", () => {
    const win = cliPlaces("win32", { PATH: "C:\\bin;;C:\\tools", ProgramFiles: "D:\\Programs" });
    assert.deepEqual(win.slice(0, 3), ["C:\\bin\\tailscale.exe", "C:\\tools\\tailscale.exe", "D:\\Programs\\Tailscale\\tailscale.exe"]);
    assert.ok(cliPlaces("darwin", { PATH: "/usr/bin" }).includes("/Applications/Tailscale.app/Contents/MacOS/Tailscale"));
    assert.deepEqual(cliPlaces("linux", { PATH: "" }).slice(0, 2), ["/usr/bin/tailscale", "/usr/local/bin/tailscale"]);
    assert.equal(findCli({ platform: "win32", env: { PATH: "C:\\bin" }, exists: (p) => p === "C:\\Program Files\\Tailscale\\tailscale.exe" }), "C:\\Program Files\\Tailscale\\tailscale.exe");
    assert.equal(findCli({ platform: "linux", env: { PATH: "/opt/x" }, exists: (p) => p === "/opt/x/tailscale" }), "/opt/x/tailscale");
    assert.equal(findCli({ platform: "linux", env: {}, exists: () => false }), null);
  });

  // (fails before: yes — the command line ran in Filament's environment as it was: on a Mac, started from the Finder, it
  // has no SHLVL nor TERM, and Tailscale's executable starts its app instead of answering)
  test("its command line runs as a shell would start it: SHLVL set where Filament has neither SHLVL nor TERM; either set kept as it is", async () => {
    const was = { SHLVL: process.env.SHLVL, TERM: process.env.TERM };
    const says = ["-e", "process.stdout.write(`${process.env.SHLVL ?? '-'} ${process.env.TERM ?? '-'}`)"];
    try {
      delete process.env.SHLVL;
      delete process.env.TERM;
      assert.equal((await runCli(process.execPath, says, { timeoutMs: CLI_MS })).out, "1 -");
      process.env.TERM = "xterm";
      assert.equal((await runCli(process.execPath, says, { timeoutMs: CLI_MS })).out, "- xterm");
      process.env.SHLVL = "3";
      delete process.env.TERM;
      assert.equal((await runCli(process.execPath, says, { timeoutMs: CLI_MS })).out, "3 -");
    } finally {
      for (const [k, v] of Object.entries(was)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  // (fails before: yes — the module did not exist)
  test("its status: running, this machine's name without its last dot, the login it is signed in as, the tailnet's HTTPS, the other machines", () => {
    const s = statusOf(STATUS);
    assert.deepEqual({ ...s, peers: undefined }, { state: "Running", running: true, name: NAME, login: OWNER, tailnet: OWNER, https: true, ips: ["100.127.5.0", "fd7a:115c:a1e0::d301:5ef"], peers: undefined });
    assert.deepEqual(s.peers, [
      { name: "studio", dns: "studio.tail5e6f7a.ts.net", online: true, os: "macOS", login: OWNER },
      { name: "phone", dns: "phone.tail5e6f7a.ts.net", online: false, os: "iOS", login: "friend@example.com" },
    ]);
    const out = statusOf({ BackendState: "NeedsLogin", Self: { DNSName: "" }, CertDomains: null });
    assert.deepEqual([out.running, out.name, out.login, out.https, out.peers], [false, "", "", false, []]);
    assert.deepEqual(statusOf(null).peers, []);
  });

  // (fails before: yes — the module did not exist)
  test("what serve serves at a port: none, Filament's own (one handler at / to its door), or the person's, said", () => {
    const mine = "http://127.0.0.1:20345";
    assert.deepEqual(servedAt({}, NAME, 443, mine), { is: "none" });
    const cfg = { TCP: { 443: { HTTPS: true }, 8443: { HTTPS: true }, 22: { TCPForward: "127.0.0.1:22" } }, Web: { [`${NAME}:443`]: { Handlers: { "/": { Proxy: mine } } }, [`${NAME}:8443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" }, "/docs": { Path: "C:\\docs" } } } }, AllowFunnel: { [`${NAME}:443`]: true } };
    assert.deepEqual(servedAt(cfg, NAME, 443, mine), { is: "mine", funnel: true });
    assert.deepEqual(servedAt(cfg, NAME, 8443, "http://127.0.0.1:20346"), { is: "other", what: "/ → http://127.0.0.1:3000, /docs → C:\\docs" });
    assert.deepEqual(servedAt(cfg, NAME, 22, mine), { is: "other", what: "a TCP forward to 127.0.0.1:22" });
    assert.equal(servedAt({ TCP: { 443: { HTTPS: true } }, Web: { [`${NAME}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:20999" } } } } }, NAME, 443, mine).is, "other", "another port's door is not this one's");
    assert.equal(askedAt(ASKS), "https://login.tailscale.com/f/serve?node=nT3st");
    assert.equal(askedAt("nothing to see"), null);
    assert.deepEqual([tailnetPortOf(undefined), tailnetPortOf({ port: 0 }), tailnetPortOf({ port: 30000 }), tailnetPortOf({ port: 65535 }), tailnetPortOf({ port: "1" })], [TAILNET_PORT, 0, 30000, TAILNET_PORT, TAILNET_PORT]);
  });
});

describe("Filament on the tailnet: one switch", () => {
  // (fails before: yes — the module did not exist)
  test("off from the start, and the same asked again — any other setting saved —: Tailscale is asked nothing", async () => {
    const ts = fakeTailscale();
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec });
    await share.apply(undefined);
    await share.apply({ serve: false });
    assert.deepEqual(ts.calls, []);
    assert.deepEqual([share.state().on, share.state().installed, share.state().listening], [false, null, null]);
    await share.close();
  });

  // (fails before: yes — the module did not exist)
  test("on: its doors listen on loopback and both are served — the pages at 443, the artifacts at 8443 —; a request there is the door's, by the name it was reached at; the guards know the door; off: its own serve taken back, the person's left", async () => {
    const ts = fakeTailscale({ cfg: { TCP: { 10000: { HTTPS: true } }, Web: { [`${NAME}:10000`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:5000" } } } } } });
    const h = heard();
    const share = shareOf({ ...h, cli: () => "ts", exec: ts.exec });
    await share.apply({ serve: true, port: 0 });
    const s = share.state();
    assert.equal(s.error, null);
    const { port, artPort } = /** @type {{ port: number, artPort: number }} */ (s.listening);
    assert.deepEqual(ts.said(), ["status --json", "serve status --json", `serve --bg --yes --https=443 http://127.0.0.1:${port}`, `serve --bg --yes --https=8443 http://127.0.0.1:${artPort}`]);
    assert.ok(ts.calls.every((c) => c.timeoutMs === CLI_MS), "each call bounded");
    assert.deepEqual([s.address, s.artifacts, s.name, s.login, s.https, s.funnel], [`https://${NAME}`, `https://${NAME}:${SERVE_ART_HTTPS}`, NAME, OWNER, true, false]);
    assert.deepEqual(tailnetDoor(), { port, artDoor: artPort, name: NAME, login: OWNER, artPort: SERVE_ART_HTTPS });
    assert.ok(isArtifactOrigin(`https://${NAME}:${SERVE_ART_HTTPS}`), "an artifact's page on the tailnet is no page of Filament's");
    // What tailscale serve hands on: the name it was reached at, as the Host and as X-Forwarded-Host (checked on the
    // real tailnet: a caller's own X-Forwarded-Host replaced). This machine's loopback is let in too.
    assert.deepEqual(await get(port, { host: NAME, "x-forwarded-host": NAME, "x-forwarded-for": "100.101.102.103" }), { status: 200, body: "pages" });
    assert.deepEqual(await get(artPort, { host: `${NAME}:8443`, "x-forwarded-host": `${NAME}:8443` }), { status: 200, body: "artifacts" });
    assert.deepEqual(await get(port, { host: `127.0.0.1:${port}` }), { status: 200, body: "pages" });
    // A page another site rebound to loopback: its own name is its Host, whatever X-Forwarded-Host its script set.
    for (const [at, said] of [[port, NAME], [artPort, `${NAME}:8443`]]) {
      const rebound = await get(/** @type {number} */ (at), { host: `evil.example:${at}`, "x-forwarded-host": String(said), "tailscale-user-login": OWNER });
      assert.equal(rebound.status, 421, "refused at the door");
    }
    // Its socket's upgrade too: the run socket and the terminal answer the name alone.
    /** @param {string} hostHeader @returns {Promise<void>} */
    const upgradeAs = (hostHeader) =>
      new Promise((resolve) => {
        const c = connect(port, "127.0.0.1", () => c.write([`GET /api/runs/socket HTTP/1.1`, `Host: ${hostHeader}`, `X-Forwarded-Host: ${NAME}`, "Connection: Upgrade", "Upgrade: websocket", "", ""].join("\r\n")));
        c.on("close", () => resolve());
        c.on("error", () => resolve());
        c.resume();
      });
    await upgradeAs(`evil.example:${port}`);
    await upgradeAs(NAME);
    assert.deepEqual(h.got.map((g) => `${g.door} ${g.host}`), ["pages " + NAME, `artifacts ${NAME}:8443`, `pages 127.0.0.1:${port}`, `upgrade ${NAME}`], "a rebound page reaches neither door's handler, nor the socket's");
    // Another setting saved: nothing asked.
    ts.calls.length = 0;
    await share.apply({ serve: true, port: 0 });
    assert.deepEqual(ts.calls, []);
    // Off: Filament's own two taken back; the person's at 10000 left as it is.
    await share.apply({ serve: false, port: 0 });
    assert.deepEqual(ts.said(), ["serve status --json", "serve --https=443 off", "serve --https=8443 off"]);
    assert.deepEqual(Object.keys(ts.cfg.TCP), ["10000"]);
    assert.deepEqual([share.state().listening, share.state().address, tailnetDoor()], [null, null, null]);
    assert.equal(isArtifactOrigin(`https://${NAME}:${SERVE_ART_HTTPS}`), false);
    await assert.rejects(get(port), /ECONNREFUSED/, "its door closed");
    await share.close();
  });

  // (fails before: yes — the module did not exist)
  test("the person's serve at its https port is left as it is, and said; off takes nothing of theirs", async () => {
    const ts = fakeTailscale({ cfg: { TCP: { 443: { HTTPS: true } }, Web: { [`${NAME}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } } } });
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec });
    await share.apply({ serve: true, port: 0 });
    assert.match(String(share.state().error), /^https port 443 of desktop-1\.tail5e6f7a\.ts\.net serves \/ → http:\/\/127\.0\.0\.1:3000 here, and Filament leaves it as it is: turn that off \(tailscale serve --https=443 off\)/);
    assert.ok(!ts.said().some((x) => x.startsWith("serve --bg")), "nothing served over it");
    assert.deepEqual([share.state().listening, share.state().address, tailnetDoor()], [null, null, null]);
    await share.apply({ serve: false, port: 0 });
    assert.ok(!ts.said().some((x) => x.endsWith(" off")));
    assert.equal(ts.cfg.Web[`${NAME}:443`].Handlers["/"].Proxy, "http://127.0.0.1:3000");
    await share.close();
    // Theirs at the artifacts' port alone: the pages are served and stay, that port said; off takes back Filament's alone.
    const art = fakeTailscale({ cfg: { TCP: { 8443: { HTTPS: true } }, Web: { [`${NAME}:8443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } } } });
    const half = shareOf({ ...heard(), cli: () => "ts", exec: art.exec });
    await half.apply({ serve: true, port: 0 });
    assert.match(String(half.state().error), /^https port 8443 of desktop-1\.tail5e6f7a\.ts\.net serves \/ → http:\/\/127\.0\.0\.1:3000 here/);
    assert.deepEqual([half.state().address, half.state().artifacts, tailnetDoor()?.artPort], [`https://${NAME}`, null, null]);
    art.calls.length = 0;
    await half.apply({ serve: false, port: 0 });
    assert.deepEqual(art.said(), ["serve status --json", "serve --https=443 off"]);
    assert.equal(art.cfg.Web[`${NAME}:8443`].Handlers["/"].Proxy, "http://127.0.0.1:3000", "theirs left");
  });

  // (fails before: yes — the module did not exist)
  test("Tailscale asks for Serve to be turned on: the wait is ended and its address said; Try again serves it once it is on", async () => {
    const ts = fakeTailscale();
    ts.serves = "asks";
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec });
    await share.apply({ serve: true, port: 0 });
    const s = share.state();
    assert.equal(s.enable, "https://login.tailscale.com/f/serve?node=nT3st");
    assert.match(String(s.error), /^Tailscale asks for it to be turned on for your tailnet first: open https:\/\/login\.tailscale\.com\/f\/serve\?node=nT3st, turn it on, then turn this on again$/);
    assert.deepEqual([s.listening, s.address, tailnetDoor()], [null, null, null]);
    // The same saved again asks nothing; Try again does.
    ts.calls.length = 0;
    await share.apply({ serve: true, port: 0 });
    assert.deepEqual(ts.calls, []);
    ts.serves = "yes";
    await share.retry();
    assert.deepEqual([share.state().error, share.state().enable, share.state().address], [null, null, `https://${NAME}`]);
    // A failure with no address: its first line.
    ts.serves = "fails";
    await share.apply({ serve: false, port: 0 });
    await share.apply({ serve: true, port: 0 });
    assert.equal(share.state().error, "tailscale serve did not serve it: serve: something broke");
    await share.close();
  });

  // (fails before: yes — the module did not exist)
  test("not installed, signed out, or not answering: said, and no door opens", async () => {
    const none = fakeTailscale();
    const share = shareOf({ ...heard(), cli: () => null, exec: none.exec });
    await share.apply({ serve: true, port: 0 });
    assert.deepEqual([share.state().installed, share.state().error, none.calls.length], [false, `Tailscale is not installed on this machine: install it from ${DOWNLOAD} and sign in`, 0]);
    await share.close();
    const out = fakeTailscale({ status: { ...STATUS, BackendState: "NeedsLogin" } });
    const signed = shareOf({ ...heard(), cli: () => "ts", exec: out.exec });
    await signed.apply({ serve: true, port: 0 });
    assert.deepEqual([signed.state().error, signed.state().stateSaid, signed.state().listening], ["Tailscale is signed out here: connect it from its icon, then turn this on again", "signed out", null]);
    await signed.close();
    const down = fakeTailscale();
    down.statusExit = 1;
    const quiet = shareOf({ ...heard(), cli: () => "ts", exec: down.exec });
    await quiet.apply({ serve: true, port: 0 });
    assert.equal(quiet.state().error, "Tailscale does not answer here: failed to connect to local tailscaled; it doesn't appear to be running");
    await quiet.close();
    const nameless = fakeTailscale({ status: { ...STATUS, Self: { ...STATUS.Self, DNSName: "" } } });
    const unnamed = shareOf({ ...heard(), cli: () => "ts", exec: nameless.exec });
    await unnamed.apply({ serve: true, port: 0 });
    assert.deepEqual([unnamed.state().error, unnamed.state().listening], ["Tailscale gives this machine no name on your tailnet: turn on MagicDNS in its admin console, https://login.tailscale.com/admin/dns, then turn this on again", null]);
    assert.deepEqual(
      ["NeedsLogin", "NeedsMachineAuth", "Stopped", "Running", "", "SomethingNew"].map(stateWords),
      ["signed out", "waiting for your tailnet's admin to approve this machine", "turned off", "connected", "not running", "something new"],
    );
    assert.equal(stateWords("toString"), "to string", "none of an object's own");
  });

  // (fails before: yes — the module did not exist)
  test("its door moved: what Tailscale serves of the old one is taken back before the new one is served", async () => {
    const ts = fakeTailscale();
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec });
    const a = await freePair();
    await share.apply({ serve: true, port: a });
    assert.equal(share.state().listening?.port, a);
    let b = await freePair();
    if (b === a || b === a + 1 || b + 1 === a) b = await freePair();
    ts.calls.length = 0;
    await share.apply({ serve: true, port: b });
    assert.deepEqual(ts.said(), ["status --json", "serve status --json", "serve --https=443 off", "serve --https=8443 off", "serve status --json", `serve --bg --yes --https=443 http://127.0.0.1:${b}`, `serve --bg --yes --https=8443 http://127.0.0.1:${b + 1}`]);
    assert.equal(share.state().error, null);
    await share.apply({ serve: false, port: b });
    await share.close();
  });

  // (fails before: yes — the module did not exist)
  test("a page's look: Tailscale read again past LOOK_MS, or fresh; one that fails says why, and serves on", async () => {
    const ts = fakeTailscale();
    let clock = 1_000_000;
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec, now: () => clock });
    const first = await share.look();
    assert.deepEqual([first.installed, first.name, first.on, first.address], [true, NAME, false, null]);
    await share.look();
    clock += LOOK_MS - 1;
    await share.look();
    assert.equal(ts.calls.length, 1);
    clock += 2;
    await share.look();
    await share.look({ fresh: true });
    assert.equal(ts.calls.length, 3);
    ts.statusExit = 1;
    const down = await share.look({ fresh: true });
    assert.match(String(down.unread), /^Tailscale does not answer here/);
    assert.equal(down.error, null);
    await share.close();
  });

  // (fails before: yes — server.tailscale was no setting)
  test("its settings: off by default at its port; a port of another of Filament's listeners refused while it is on", () => {
    const cfg = defaultConfig();
    assert.deepEqual(cfg.server.tailscale, { serve: false, trustOwnLogin: false, port: TAILNET_PORT });
    const with_ = (/** @type {any} */ ts, /** @type {any} */ lan = cfg.server.lan) => validateConfig({ ...cfg, server: { ...cfg.server, lan, tailscale: ts } }).errors.filter((e) => e.startsWith("server.tailscale"));
    assert.deepEqual(with_({ serve: true, port: 30000 }), []);
    assert.equal(with_({ serve: true, port: 70000 }).length, 1);
    assert.equal(with_({ serve: true, port: cfg.server.port }).length, 1);
    assert.equal(with_({ serve: true, port: cfg.server.port - 1 }).length, 1, "its artifacts' door on server.port");
    assert.equal(with_({ serve: true, port: 30000 }, { enabled: true, port: 30001 }).length, 1, "on the network listener's");
    assert.deepEqual(with_({ serve: false, port: cfg.server.port }), [], "off, its port waits");
  });
});

describe("what it served before, and a start before Tailscale", () => {
  /** A memo as a test holds it. @param {any} [v] */
  const memoOf = (v = null) => {
    const m = { v, read: () => m.v, write: (/** @type {any} */ x) => void (m.v = x) };
    return m;
  };
  const proxy = (/** @type {string} */ to) => ({ Handlers: { "/": { Proxy: to } } });

  // (fails before: yes — an earlier run's entry, at another port, was said to be the person's and refused)
  test("its own entry from an earlier run, at another port, is served over and kept; the person's still refused", async () => {
    const was = { TCP: { 443: { HTTPS: true }, 8443: { HTTPS: true } }, Web: { [`${NAME}:443`]: proxy("http://127.0.0.1:41000"), [`${NAME}:8443`]: proxy("http://127.0.0.1:41001") } };
    const ts = fakeTailscale({ cfg: structuredClone(was) });
    const memo = memoOf({ pages: "http://127.0.0.1:41000", art: "http://127.0.0.1:41001" });
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec, memo });
    await share.apply({ serve: true, port: 0 });
    const { port, artPort } = /** @type {{ port: number, artPort: number }} */ (share.state().listening);
    assert.equal(share.state().error, null);
    assert.deepEqual(ts.said().slice(2), ["serve --https=443 off", `serve --bg --yes --https=443 http://127.0.0.1:${port}`, "serve --https=8443 off", `serve --bg --yes --https=8443 http://127.0.0.1:${artPort}`]);
    assert.deepEqual(memo.v, { pages: `http://127.0.0.1:${port}`, art: `http://127.0.0.1:${artPort}` }, "what it serves now, kept");
    await share.close();
    // The same at 443 with no memo of it: the person's.
    const other = fakeTailscale({ cfg: structuredClone(was) });
    const theirs = shareOf({ ...heard(), cli: () => "ts", exec: other.exec, memo: memoOf({ pages: "http://127.0.0.1:41999" }) });
    await theirs.apply({ serve: true, port: 0 });
    assert.match(String(theirs.state().error), /^https port 443 of .* serves \/ → http:\/\/127\.0\.0\.1:41000 here, and Filament leaves it as it is/);
    assert.ok(!other.said().some((x) => x.endsWith(" off")));
  });

  // (fails before: yes — turned off with no door open, an earlier run's entries stayed served)
  test("turned off before any door opened: an earlier run's entries taken back, and the memo with them; the person's left", async () => {
    const ts = fakeTailscale({ cfg: { TCP: { 443: { HTTPS: true }, 8443: { HTTPS: true } }, Web: { [`${NAME}:443`]: proxy("http://127.0.0.1:41000"), [`${NAME}:8443`]: proxy("http://127.0.0.1:3000") } } });
    const memo = memoOf({ pages: "http://127.0.0.1:41000", art: "http://127.0.0.1:41001" });
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec, memo });
    await share.apply({ serve: true, port: 0 });
    await share.close();
    // The next start finds it off, as it is by default: what the memo says it served is taken back.
    const later = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec, memo });
    ts.calls.length = 0;
    await later.apply({ serve: false });
    assert.deepEqual(ts.said(), ["status --json", "serve status --json", "serve --https=443 off"]);
    assert.equal(ts.cfg.Web[`${NAME}:8443`].Handlers["/"].Proxy, "http://127.0.0.1:3000", "the person's left");
    assert.equal(memo.v, null);
    // Off at a start whose Tailscale was not read yet, its doors never opened: the memo's taken back all the same.
    const ts2 = fakeTailscale({ cfg: { TCP: { 443: { HTTPS: true } }, Web: { [`${NAME}:443`]: proxy("http://127.0.0.1:41000") } } });
    const memo2 = memoOf({ pages: "http://127.0.0.1:41000" });
    const cold = shareOf({ ...heard(), cli: () => "ts", exec: ts2.exec, memo: memo2 });
    ts2.status = { ...STATUS, BackendState: "Starting" };
    await cold.apply({ serve: true, port: 0 });
    ts2.status = STATUS;
    await cold.apply({ serve: false, port: 0 });
    assert.deepEqual([ts2.cfg.TCP[443], memo2.v], [undefined, null]);
  });

  // (fails before: yes — a share that found Tailscale not yet running stayed off until someone pressed Try again)
  test("Tailscale not running yet, as at logon: asked again in a while, served once it runs; off or closed, never again", async () => {
    const ts = fakeTailscale({ status: { ...STATUS, BackendState: "Starting" } });
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec, retryMs: 20 });
    await share.apply({ serve: true, port: 0 });
    assert.match(String(share.state().error), /^Tailscale is starting here/);
    await new Promise((r) => setTimeout(r, 60));
    await share.settled();
    assert.match(String(share.state().error), /^Tailscale is starting here/, "asked again, still starting");
    ts.status = STATUS;
    await new Promise((r) => setTimeout(r, 60));
    await share.settled();
    assert.deepEqual([share.state().error, share.state().address], [null, `https://${NAME}`]);
    const n = ts.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(ts.calls.length, n, "served: not asked again");
    // Off while it waits: never asked again.
    const off = fakeTailscale({ status: { ...STATUS, BackendState: "NeedsLogin" } });
    const waiting = shareOf({ ...heard(), cli: () => "ts", exec: off.exec, retryMs: 20 });
    await waiting.apply({ serve: true, port: 0 });
    await waiting.apply({ serve: false, port: 0 });
    const m = off.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(off.calls.length, m);
  });

  // (fails before: yes — Try again cleared the share before its calls, and a failed one closed doors still served)
  test("Try again on a share that works: it stays open while Tailscale is asked, and stays where a call fails", async () => {
    const ts = fakeTailscale();
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec });
    await share.apply({ serve: true, port: 0 });
    const port = /** @type {number} */ (share.state().listening?.port);
    /** @type {() => void} */
    let go = () => {};
    ts.gate = new Promise((r) => (go = r));
    const again = share.retry();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([tailnetDoor()?.port, share.state().address], [port, `https://${NAME}`], "open while it is asked");
    assert.deepEqual(await get(port, { host: NAME }), { status: 200, body: "pages" });
    ts.gate = null;
    go();
    await again;
    ts.configExit = 1;
    await share.retry();
    assert.match(String(share.state().error), /^what tailscale serve serves could not be read/);
    assert.deepEqual([share.state().listening?.port, share.state().address, tailnetDoor()?.port], [port, `https://${NAME}`, port], "still served");
    ts.statusExit = 1;
    await share.retry();
    assert.deepEqual([share.state().listening?.port, tailnetDoor()?.port], [port, port], "Tailscale unread a moment: still served");
  });

  // (fails before: yes — close waited behind a step's calls, and that step then took the serve back at stop)
  test("closed as Filament stops while a change waits on Tailscale: the doors close at once, and the serve is left as it is", async () => {
    const ts = fakeTailscale();
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec });
    await share.apply({ serve: true, port: 0 });
    const port = /** @type {number} */ (share.state().listening?.port);
    /** @type {() => void} */
    let go = () => {};
    ts.gate = new Promise((r) => (go = r));
    void share.retry();
    void share.apply({ serve: false, port: 0 });
    await new Promise((r) => setImmediate(r));
    const t0 = Date.now();
    await share.close();
    assert.ok(Date.now() - t0 < 1000, "at once");
    await assert.rejects(get(port), /ECONNREFUSED/);
    ts.gate = null;
    go();
    await share.settled();
    assert.ok(!ts.said().some((x) => x.endsWith(" off")), "nothing taken back at stop");
    assert.equal(share.state().listening, null, "and nothing opened again");
    // Closed while its very first change reads Tailscale: no door opens, nothing is served.
    const first = fakeTailscale();
    const starting = shareOf({ ...heard(), cli: () => "ts", exec: first.exec });
    /** @type {() => void} */
    let go2 = () => {};
    first.gate = new Promise((r) => (go2 = r));
    const on = starting.apply({ serve: true, port: 0 });
    await new Promise((r) => setImmediate(r));
    await starting.close();
    first.gate = null;
    go2();
    await on;
    assert.deepEqual([starting.state().listening, first.said()], [null, ["status --json"]]);
  });

  // (fails before: yes — a page's look read Tailscale beside a change under way)
  test("a page's look waits for a change under way, and the change for it: never two calls at once", async () => {
    const ts = fakeTailscale();
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec });
    /** @type {() => void} */
    let go = () => {};
    ts.gate = new Promise((r) => (go = r));
    const on = share.apply({ serve: true, port: 0 });
    const looked = share.look({ fresh: true });
    const off = share.apply({ serve: false, port: 0 });
    await new Promise((r) => setImmediate(r));
    ts.gate = null;
    go();
    await Promise.all([on, looked, off]);
    assert.equal(ts.most, 1);
  });

  test("refused its serve — Linux, no operator named —: said how to let it", async () => {
    const ts = fakeTailscale();
    ts.serves = "refused";
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec });
    await share.apply({ serve: true, port: 0 });
    assert.match(String(share.state().error), /^tailscale serve did not serve it: Access denied: serve config denied: Tailscale refuses this user its serve here — let it \(sudo tailscale set --operator=\$USER\), then Try again$/);
  });
});

describe("trust taken back", () => {
  /** A connection held open at a door, and whether it has ended. @param {number} port */
  const hold = (port) =>
    new Promise((resolve, reject) => {
      const c = connect(port, "127.0.0.1", () => {
        const held = { ended: false };
        c.on("close", () => void (held.ended = true));
        resolve(held);
      });
      c.on("error", reject);
    });
  const turn = () => new Promise((r) => setTimeout(r, 30));

  // (fails before: yes — a connection your login held open went on after Trust my own tailnet login was turned off)
  test("turned off: every connection through the doors ends at once, Tailscale asked nothing; turned on, or another setting saved, none", async () => {
    const ts = fakeTailscale();
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec });
    await share.apply({ serve: true, trustOwnLogin: false, port: 0 });
    const { port, artPort } = /** @type {{ port: number, artPort: number }} */ (share.state().listening);
    ts.calls.length = 0;
    const first = /** @type {{ ended: boolean }} */ (await hold(port));
    await share.apply({ serve: true, trustOwnLogin: true, port: 0 });
    await share.apply({ serve: true, trustOwnLogin: true, port: 0 });
    await turn();
    assert.equal(first.ended, false, "trust given: nothing ended");
    const page = /** @type {{ ended: boolean }} */ (await hold(port));
    const art = /** @type {{ ended: boolean }} */ (await hold(artPort));
    await share.apply({ serve: true, trustOwnLogin: false, port: 0 });
    await turn();
    assert.deepEqual([first.ended, page.ended, art.ended], [true, true, true]);
    assert.deepEqual(ts.calls, [], "a trust change alone asks Tailscale nothing");
    assert.deepEqual([share.state().address, share.state().trustOwnLogin, tailnetDoor()?.port], [`https://${NAME}`, false, port], "still served");
    const after = /** @type {{ ended: boolean }} */ (await hold(port));
    await share.apply({ serve: true, trustOwnLogin: false, port: 0 });
    await turn();
    assert.equal(after.ended, false, "not trusted before: nothing to end");
  });

  // (fails before: yes — signed in as another login, what the last one held open went on)
  test("Tailscale here signed in as another login: what the last one held open ends, and the door names the new one", async () => {
    const ts = fakeTailscale();
    let clock = 1_000_000;
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec, now: () => clock });
    await share.apply({ serve: true, trustOwnLogin: true, port: 0 });
    const port = /** @type {number} */ (share.state().listening?.port);
    const held = /** @type {{ ended: boolean }} */ (await hold(port));
    await share.look({ fresh: true });
    await turn();
    assert.equal(held.ended, false, "the same login read again: nothing ended");
    ts.status = { ...STATUS, Self: { ...STATUS.Self, UserID: 222 } };
    clock += LOOK_MS + 1;
    await share.look();
    await turn();
    assert.deepEqual([held.ended, tailnetDoor()?.login], [true, "friend@example.com"]);
    // No login read — a moment between two states —: nothing ended, the door's login kept.
    const again = /** @type {{ ended: boolean }} */ (await hold(port));
    ts.status = { ...STATUS, Self: { ...STATUS.Self, UserID: 999 } };
    clock += LOOK_MS + 1;
    await share.look();
    await turn();
    assert.deepEqual([again.ended, tailnetDoor()?.login], [false, "friend@example.com"]);
  });
});

describe("the guards, at the tailnet's door", () => {
  // (fails before: yes — the tailnet's name was refused everywhere, and no caller was let in by their tailnet login)
  test("its name passes at its door alone; your own login, where it is trusted and tailscale serve says it, drives this Filament — another's, a Funnel's, or the same header elsewhere, nothing", async () => {
    const ts = fakeTailscale();
    const share = shareOf({ ...heard(), cli: () => "ts", exec: ts.exec });
    await share.apply({ serve: true, port: 0 });
    const door = /** @type {number} */ (share.state().listening?.port);
    const served = { "x-forwarded-for": "100.101.102.103", "x-forwarded-proto": "https", "x-forwarded-host": NAME };
    const trusting = { host: "127.0.0.1", tailscale: { serve: true, trustOwnLogin: true } };
    // The Host.
    assert.equal(hostAllowed(at({ host: NAME }, door), trusting), true);
    assert.equal(hostAllowed(at({ host: NAME }, door + 7), trusting), false, "at another port of this machine");
    assert.equal(hostAllowed(at({ host: NAME }, door, "192.168.1.9"), trusting), false, "from another machine");
    assert.equal(hostAllowed(at({ host: "studio.tail5e6f7a.ts.net" }, door), trusting), false, "another machine's name");
    assert.equal(onTailnetDoor(at({}, door)), true);
    // Who calls.
    const mine = at({ host: NAME, ...served, "tailscale-user-login": OWNER }, door);
    assert.deepEqual(whoIs(mine, trusting), { kind: "tailnet", login: OWNER });
    assert.equal(drives(whoIs(mine, trusting)), true);
    assert.equal(readsEverySession(mine, trusting), true);
    const artDoor = /** @type {number} */ (share.state().listening?.artPort);
    assert.deepEqual(whoIs(at({ ...served, "tailscale-user-login": OWNER }, artDoor), trusting), { kind: "tailnet", login: OWNER }, "at the artifacts' door too");
    assert.equal(whoIs(mine, { ...trusting, tailscale: { serve: true, trustOwnLogin: false } }), null, "not trusted: it pairs");
    assert.equal(whoIs(at({ ...served, "tailscale-user-login": "friend@example.com" }, door), trusting), null, "another person's login");
    assert.equal(whoIs(at({ ...served }, door), trusting), null, "a tagged machine: no login");
    assert.equal(whoIs(at({ ...served, "tailscale-user-login": OWNER, "tailscale-funnel-request": "?1" }, door), trusting), null, "from the internet");
    assert.equal(whoIs(at({ ...served, "tailscale-user-login": OWNER }, door + 7), trusting), null, "the header at another port: another proxy's");
    assert.equal(whoIs(at({ ...served, "tailscale-user-login": OWNER }, door, "192.168.1.9"), trusting), null);
    // Off: none of it.
    await share.apply({ serve: false, port: 0 });
    assert.equal(hostAllowed(at({ host: NAME }, door), trusting), false);
    assert.equal(whoIs(mine, trusting), null);
    await share.close();
  });
});

describe("Filament served on the tailnet, end to end", () => {
  // (fails before: yes — server.tailscale was no setting, and nothing served a tailnet)
  test("its door answers Filament's pages to your own login where trusted, a pairing to anyone else, never the model endpoints; /state names the artifacts' tailnet address; a pairing's code links it; Settings reads it all", async () => {
    const ts = fakeTailscale();
    const shim = await startApp({ configure: (c) => void (c.server.tailscale = { serve: true, trustOwnLogin: false, port: 0 }), overrides: { tailnet: { cli: () => "ts", exec: ts.exec } } });
    try {
      const look = await (await fetch(`${shim.url}/api/remote/tailscale`)).json();
      assert.deepEqual([look.on, look.address, look.artifacts, look.error], [true, `https://${NAME}`, `https://${NAME}:8443`, null]);
      const door = look.listening.port;
      const served = { host: NAME, "x-forwarded-for": "100.101.102.103", "x-forwarded-proto": "https", "x-forwarded-host": NAME, "tailscale-user-login": OWNER };
      /** @param {string} path @param {Record<string, string>} [more] @param {string} [method] */
      const viaTailnet = (path, more = {}, method = "GET") =>
        new Promise((resolve, reject) => {
          const r = http.request({ host: "127.0.0.1", port: door, path, method, headers: { ...served, ...more }, agent: false }, (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
          });
          r.on("error", reject);
          r.end();
        });
      // Not trusted: your own login pairs as anyone does.
      const refused = /** @type {any} */ (await viaTailnet("/api/state"));
      assert.ok(refused.status === 401 || refused.status === 403, String(refused.status));
      const me = /** @type {any} */ (await viaTailnet("/api/remote/me"));
      assert.notEqual(me.status, 200);
      // Trusted.
      const st = await (await shim.api("/api/state")).json();
      const put = await shim.api("/api/config", { method: "PUT", body: { ...st.config, server: { ...st.config.server, tailscale: { serve: true, trustOwnLogin: true, port: 0 } } } });
      assert.equal(put.status, 200, await put.clone().text());
      const state = /** @type {any} */ (await viaTailnet("/api/state"));
      assert.equal(state.status, 200);
      assert.equal(state.body.viewer, "remote");
      assert.deepEqual(state.body.artifacts, { page: `https://${NAME}:8443/{name}/`, still: `https://${NAME}:8443/_still/{name}/` });
      assert.deepEqual(/** @type {any} */ (await viaTailnet("/api/remote/me")).body?.who, "tailnet");
      // A write from the page on the tailnet: its Origin is the name it reached.
      const wrote = /** @type {any} */ (await viaTailnet("/api/remote/tailscale/retry", { origin: `https://${NAME}`, "content-type": "application/json" }, "POST"));
      assert.equal(wrote.status, 200);
      // Another person's login: refused; the model endpoints: never, whoever asks.
      const friend = /** @type {any} */ (await viaTailnet("/api/state", { "tailscale-user-login": "friend@example.com" }));
      assert.ok(friend.status === 401 || friend.status === 403);
      assert.equal(/** @type {any} */ (await viaTailnet("/v1/models")).status, 404);
      // The artifacts' door: a page's load is led under a pass given to your login, good while it is trusted.
      const art = look.listening.artPort;
      /** @param {string} path @returns {Promise<{ status: number, location: string }>} */
      const viaArt = (path) =>
        new Promise((resolve, reject) => {
          const r = http.get({ host: "127.0.0.1", port: art, path, headers: { ...served, host: `${NAME}:8443`, "x-forwarded-host": `${NAME}:8443` }, agent: false }, (res) => {
            res.resume();
            res.on("end", () => resolve({ status: Number(res.statusCode), location: String(res.headers.location || "") }));
          });
          r.on("error", reject);
        });
      const led = await viaArt("/no-such/");
      assert.equal(led.status, 302);
      assert.match(led.location, /^\/no-such\/~[\w-]+\.[\w-]+\/$/);
      assert.equal((await viaArt(led.location)).status, 404, "its pass good: the artifact's own answer, none named so");
      const st2 = await (await shim.api("/api/state")).json();
      await shim.api("/api/config", { method: "PUT", body: { ...st2.config, server: { ...st2.config.server, tailscale: { serve: true, trustOwnLogin: false, port: 0 } } } });
      assert.deepEqual(await viaArt(led.location), { status: 302, location: "/no-such/" }, "trusted no more: its pass ends, led to be given one");
      assert.equal((await viaArt("/no-such/")).status, 403);
      await shim.api("/api/config", { method: "PUT", body: { ...st2.config, server: { ...st2.config.server, tailscale: { serve: true, trustOwnLogin: true, port: 0 } } } });
      // A code made here links the tailnet too, with no fingerprint.
      const pair = await (await fetch(`${shim.url}/api/remote/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "view" }) })).json();
      assert.deepEqual(pair.links, [`https://${NAME}/ui/pair.html#code=${encodeURIComponent(pair.code)}`]);
    } finally {
      await shim.stop();
    }
  });

  // (fails before: yes — x11: a browser your trusted login let in was taken by its login alone, so the device it was
  // paired as never moved its day — Settings said it expired while in use — and its cookie was never sent again)
  test("your own login carrying a device's cookie keeps that device in use: its day moves on, its cookie is sent again, and it is still your login", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "filament-tailnet-device-"));
    const token = `fdt_${randomBytes(32).toString("base64url")}`;
    const seen = Date.now() - 50 * 86_400_000;
    const row = { id: randomUUID(), name: "Laptop", scope: "full", kind: "browser", hash: createHash("sha256").update(token).digest("hex"), grants: {}, createdAt: seen, lastSeenAt: seen, lastSeenFrom: null, revokedAt: null };
    writeFileSync(join(dataDir, "devices.json"), JSON.stringify({ version: 1, devices: [row] }));
    const ts = fakeTailscale();
    const shim = await startApp({ dataDir, configure: (c) => void (c.server.tailscale = { serve: true, trustOwnLogin: true, port: 0 }), overrides: { tailnet: { cli: () => "ts", exec: ts.exec } } });
    try {
      const door = (await (await fetch(`${shim.url}/api/remote/tailscale`)).json()).listening.port;
      const served = { host: NAME, "x-forwarded-for": "100.101.102.103", "x-forwarded-proto": "https", "x-forwarded-host": NAME, "tailscale-user-login": OWNER, cookie: `__Host-filament_device=${token}` };
      /** @param {string} path @returns {Promise<{ status: number, cookie: string[] | undefined, body: any }>} */
      const viaTailnet = (path) =>
        new Promise((resolve, reject) => {
          const r = http.get({ host: "127.0.0.1", port: door, path, headers: served, agent: false }, (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () => resolve({ status: Number(res.statusCode), cookie: res.headers["set-cookie"], body: body.startsWith("{") ? JSON.parse(body) : null }));
          });
          r.on("error", reject);
        });
      const me = await viaTailnet("/api/remote/me");
      assert.deepEqual([me.status, me.body?.who], [200, "tailnet"], "your login still");
      assert.deepEqual(me.cookie, [`__Host-filament_device=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000; Secure`], "its cookie sent again");
      assert.equal((await viaTailnet("/ui/harness.html")).cookie, undefined, "a day apart at the most, the pages' and the API's one count");
      const listed = (await (await shim.api("/api/remote/devices")).json()).devices.find((/** @type {any} */ d) => d.name === "Laptop");
      assert.ok(listed.lastSeenAt > seen + 49 * 86_400_000, "its day moved on");
      assert.ok(listed.expiresAt > Date.now() + 89 * 86_400_000, "so it lapses 90 days from now");
    } finally {
      await shim.stop();
    }
  });
});
