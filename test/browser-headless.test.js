// @ts-check
// The agent's browser with no desktop app (b-headless): Chrome or Chromium on this machine, run headless on its protocol
// pipe, holds the pages where no app is connected. Chrome is found where FILAMENT_CHROME says, where it installs itself,
// or on the PATH; a stand-in for it (helpers/fake-chrome.mjs) speaks the pipe, and the registry drives it as it drives
// the app — open, snapshot, click, a screenshot — with Filament's own address refused at every door it listens on, a
// popup held before it loads, a certificate no one vouches for failed and a redirect to an app's address ended; Chrome
// as a script in this process shows a long message read whole and a stop in the middle of a start. With neither app
// nor Chrome a call says how to get Chrome; an app that connects takes the pages over, told where Filament is reached,
// and Chrome holds them again once it goes. Where a real Chrome or Edge is on this machine, two tests drive it.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { spawn as nodeSpawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { createServer as createNetServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { CDP_METHODS, filamentsOwn } from "../src/core/browser.js";
import { CDP_METHODS as APP_CDP_METHODS } from "../desktop/lib/browser-host.js";
import { NO_HOST, createBrowserHost } from "../src/app/browser/host.js";
import { CHROME_ENV, createHeadlessHost, findChrome, profileOf } from "../src/app/browser/headless-host.js";
import { createBrowsers } from "../src/app/browser/registry.js";
import { BROWSER_TOOL } from "../src/app/agent/browser-tool.js";
import { MediaResult } from "../src/core/media.js";
import { selfSigned } from "../src/core/x509.js";
import { startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "helpers", "fake-chrome.mjs");
const OWN = "http://127.0.0.1:20300/";
/** @type {string[]} */
const dirs = [];
after(() => removeDirs(...dirs));
/** A folder of the test's own. */
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-headless-"));
  dirs.push(d);
  return d;
};
/** A file that stands where Chrome is, runnable: the stand-in runs in its place. @param {string} dir @param {string} name */
const chromeFile = (dir, name) => {
  const f = join(dir, process.platform === "win32" ? `${name}.exe` : name);
  writeFileSync(f, "");
  if (process.platform !== "win32") chmodSync(f, 0o755);
  return f;
};

/** The lines the stand-in wrote to its log. @param {string} log */
const linesOf = (log) => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);

/**
 * How "Chrome" starts in a test: the stand-in run by Node in its place, its commands written to `log`.
 * @param {string} log @param {{ command: string, args: string[] }[]} [starts] @param {any[]} [procs]
 */
const fakeSpawn =
  (log, starts = [], procs = []) =>
  (/** @type {string} */ command, /** @type {string[]} */ args, /** @type {any} */ o) => {
    starts.push({ command, args: [...args] });
    const p = nodeSpawn(process.execPath, [FAKE, ...args], { ...o, env: { ...process.env, FAKE_CHROME_LOG: log, FAKE_CHROME_OWN: OWN } });
    procs.push(p);
    return p;
  };

/**
 * A headless host over the stand-in: each start of "Chrome" at the path found is the stand-in run by Node, its
 * commands written to a log the test reads.
 * @param {{ find: () => string, own?: (url: string) => boolean }} o
 */
function fakeChrome({ find, own = (u) => filamentsOwn(u, 20300) }) {
  const dataDir = scratch();
  const log = join(dataDir, "fake-chrome.log");
  /** @type {{ command: string, args: string[] }[]} */
  const starts = [];
  /** @type {any[]} */
  const procs = [];
  const chrome = createHeadlessHost({ dataDir, own, find, spawn: fakeSpawn(log, starts, procs) });
  after(() => chrome.stop());
  return { chrome, dataDir, starts, procs, lines: () => linesOf(log) };
}

/**
 * Chrome as a script in this process, for what the stand-in cannot show: its pipe two streams, each command answered by
 * `answer` (Chrome's plainest answer where it gives none, a promise waited for), each message written in pieces of
 * `piece` bytes. `kill` ends it, said by its signal, a moment later — unless `holdsOn` and the signal is not SIGKILL.
 * @param {{ answer?: (m: any) => any, piece?: number, holdsOn?: boolean }} [o]
 */
function scriptedChrome({ answer = () => undefined, piece = 0, holdsOn = false } = {}) {
  const proc = /** @type {any} */ (new EventEmitter());
  const out = new PassThrough();
  /** @param {any} m */
  const plain = (m) => (m.method === "Target.createTarget" ? { targetId: "T1" } : m.method === "Target.attachToTarget" ? { sessionId: "S1" } : m.method === "Target.getTargets" ? { targetInfos: [] } : {});
  let buf = "";
  const inp = new Writable({
    write(chunk, _enc, done) {
      buf += String(chunk);
      for (let i = buf.indexOf("\0"); i >= 0; i = buf.indexOf("\0")) {
        const m = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        proc.commands.push(m);
        void Promise.resolve(answer(m)).then((result) => {
          if (proc.signalCode) return;
          const bytes = Buffer.from(`${JSON.stringify({ id: m.id, result: result ?? plain(m), ...(m.sessionId ? { sessionId: m.sessionId } : {}) })}\0`);
          const n = piece || bytes.length;
          for (let k = 0; k < bytes.length; k += n) out.write(bytes.subarray(k, k + n));
        });
      }
      done();
    },
  });
  Object.assign(proc, { commands: [], kills: [], stdio: [null, null, null, inp, out], stderr: null, exitCode: null, signalCode: null });
  proc.kill = (/** @type {string} */ signal = "SIGTERM") => {
    proc.kills.push(signal);
    if (proc.signalCode || (holdsOn && signal !== "SIGKILL")) return true;
    setTimeout(() => {
      proc.signalCode = signal;
      proc.emit("exit", null, signal);
    }, 5);
    return true;
  };
  return proc;
}

/** Two free ports, one after the other: the network's door asks for the first, and the artifacts' takes the next. */
async function twoFreePorts() {
  /** @param {number} port @returns {Promise<import("node:net").Server | null>} */
  const hold = (port) =>
    new Promise((resolve) => {
      const s = createNetServer();
      s.once("error", () => resolve(null));
      s.listen(port, "127.0.0.1", () => resolve(s));
    });
  for (let i = 0; i < 20; i++) {
    const a = await hold(0);
    const port = Number(/** @type {any} */ (a?.address())?.port);
    const b = port && port < 65535 ? await hold(port + 1) : null;
    await Promise.all([a, b].map((s) => s && new Promise((r) => s.close(() => r(null)))));
    if (b) return port;
  }
  throw new Error("no two free ports, one after the other");
}

/**
 * Tailscale's command line, as a stand-in: running, signed in, and serving what it is asked to.
 * @param {string} name  this machine's name on the tailnet
 */
function tailscale(name) {
  /** @type {any} */
  const cfg = {};
  /** @type {import("../src/services/tailscale.js").Exec} */
  const exec = async (_file, args) => {
    const ok = (/** @type {string} */ out) => ({ code: 0, out, err: "", timedOut: false });
    if (args[0] === "status")
      return ok(JSON.stringify({ BackendState: "Running", Self: { DNSName: `${name}.`, HostName: "box", UserID: 1, TailscaleIPs: ["100.64.0.9"] }, User: { 1: { LoginName: "me@example.com" } }, CurrentTailnet: { Name: "me@example.com", MagicDNSSuffix: name.split(".").slice(1).join(".") }, CertDomains: [name], Peer: {} }));
    if (args.join(" ") === "serve status --json") return ok(JSON.stringify(cfg));
    const https = Number(/^--https=(\d+)$/.exec(args.find((a) => a.startsWith("--https=")) || "")?.[1]);
    if (args.at(-1) === "off") {
      delete cfg.TCP?.[String(https)];
      delete cfg.Web?.[`${name}:${https}`];
      return ok("");
    }
    (cfg.TCP ||= {})[String(https)] = { HTTPS: true };
    (cfg.Web ||= {})[`${name}:${https}`] = { Handlers: { "/": { Proxy: args.at(-1) } } };
    return ok("");
  };
  return { cli: () => "ts", exec };
}

describe("finding Chrome", () => {
  test("by the path FILAMENT_CHROME names, before any other", () => {
    const dir = scratch();
    const mine = chromeFile(dir, "my-chrome");
    assert.equal(findChrome({ env: { [CHROME_ENV]: mine }, exists: (p) => p === mine || existsSync(p) }), mine);
    // A path that is not there is passed over for the next place.
    const onPath = chromeFile(dir, "chromium");
    assert.equal(findChrome({ env: { [CHROME_ENV]: join(dir, "nowhere"), PATH: dir, PATHEXT: ".EXE" }, exists: (p) => p.startsWith(dir) && existsSync(p) }), onPath);
  });

  test("where it installs itself, on each OS", () => {
    const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    assert.equal(findChrome({ env: {}, platform: "darwin", exists: (p) => p === mac }), mac);
    assert.equal(findChrome({ env: {}, platform: "linux", exists: (p) => p === "/usr/bin/chromium" }), "/usr/bin/chromium");
    const win = join("C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe");
    assert.equal(findChrome({ env: { "PROGRAMFILES(X86)": "C:\\Program Files (x86)" }, platform: "win32", exists: (p) => p === win }), win);
  });

  test("on the PATH: google-chrome, chromium or chromium-browser", () => {
    const dir = scratch();
    const other = join(dir, "other");
    mkdirSync(other);
    const found = chromeFile(other, "chromium-browser");
    assert.equal(findChrome({ env: { PATH: [join(dir, "empty"), other].join(delimiter), PATHEXT: ".EXE" }, exists: (p) => p.startsWith(dir) && existsSync(p) }), found);
  });

  test("none: an empty path", () => {
    assert.equal(findChrome({ env: { PATH: "" }, exists: () => false }), "");
  });

  // (fails before: yes — the review of b-headless: Ubuntu's Chromium is a snap, which may write in no hidden folder of
  // the home, so a profile in the data folder (~/.config/filament) kept it from starting)
  test("a snap's Chromium runs on a profile in the snap's own folder of the home, one per data folder, emptied as it starts", async () => {
    const home = scratch();
    const dir = scratch();
    // Ubuntu's chromium-browser: a script that runs the snap.
    const script = join(dir, "chromium-browser");
    writeFileSync(script, '#!/bin/sh\nexec /snap/bin/chromium "$@"\n');
    for (const found of ["/snap/bin/chromium", script]) {
      const dataDir = scratch();
      const log = join(dataDir, "fake-chrome.log");
      /** @type {{ command: string, args: string[] }[]} */
      const starts = [];
      /** @type {any[]} */
      const procs = [];
      const chrome = createHeadlessHost({ dataDir, home, find: () => found, spawn: fakeSpawn(log, starts, procs) });
      try {
        await chrome.call("open", { tab: "t1" });
        const profile = String(starts[0].args.find((a) => a.startsWith("--user-data-dir="))).slice("--user-data-dir=".length);
        assert.equal(dirname(profile), join(home, "snap", "chromium", "common"), found);
        assert.match(basename(profile), /^filament-headless-chrome-[0-9a-f]{8}$/);
        assert.ok(existsSync(profile));
        writeFileSync(join(profile, "left"), "");
        chrome.stop();
        await until(() => procs[0].exitCode !== null || procs[0].signalCode !== null, "Chrome stopped");
        await chrome.call("open", { tab: "t2" });
        assert.equal(starts[1].args.find((a) => a.startsWith("--user-data-dir=")), `--user-data-dir=${profile}`, "the same folder");
        assert.ok(!existsSync(join(profile, "left")), "emptied as it starts");
      } finally {
        chrome.stop();
      }
    }
    // Another Chrome's profile stays in the data folder.
    const dataDir = scratch();
    /** @type {{ command: string, args: string[] }[]} */
    const starts = [];
    const chrome = createHeadlessHost({ dataDir, home, find: () => "/usr/bin/google-chrome", spawn: fakeSpawn(join(dataDir, "fake-chrome.log"), starts) });
    try {
      await chrome.call("open", { tab: "t1" });
      assert.ok(starts[0].args.includes(`--user-data-dir=${profileOf(dataDir)}`));
    } finally {
      chrome.stop();
    }
  });
});

describe("the agent's browser in Chrome on this machine", () => {
  test("found by its path, Chrome runs headless on its pipe with a profile of its own; the registry opens, reads, clicks and takes a picture with no app", async () => {
    const dir = scratch();
    const exe = chromeFile(dir, "chrome");
    const f = fakeChrome({ find: () => findChrome({ env: { [CHROME_ENV]: exe }, exists: (p) => p === exe }) });
    const host = createBrowserHost({ chrome: f.chrome });
    assert.equal(host.available, true, "Chrome found: the browser is there before it starts");
    assert.equal(f.starts.length, 0, "Chrome starts at the first page, not before");
    const browsers = createBrowsers({ host });

    const opened = String(await browsers.call("c1", { action: "navigate", url: "shop.test/" }));
    assert.match(opened, /^Opened https:\/\/shop\.test\/\.\nPage: Shop — https:\/\/shop\.test\//);
    assert.ok(opened.includes('- button "Buy" [e1]'), opened);
    assert.equal(f.starts.length, 1);
    assert.equal(f.starts[0].command, exe);
    const args = f.starts[0].args;
    for (const a of ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profileOf(f.dataDir)}`]) assert.ok(args.includes(a), `${a} in ${args.join(" ")}`);
    assert.ok(!args.some((a) => a.startsWith("--remote-debugging-port")), "no port: the pipe alone");
    assert.ok(profileOf(f.dataDir).startsWith(f.dataDir), "the profile is in the data folder");

    const clicked = String(await browsers.call("c1", { action: "click", ref: "e1" }));
    assert.match(clicked, /^Clicked e1\./);
    assert.ok(clicked.includes('- heading "Bought"'), clicked);

    const shot = await browsers.call("c1", { action: "screenshot" });
    assert.ok(shot instanceof MediaResult, "a picture beside its words");
    assert.match(shot.text, /^A screenshot of https:\/\/shop\.test\/ \(1280×800\)\.$/);
    const asked = JSON.parse(Buffer.from(shot.media[0].source.data, "base64").toString("utf8"));
    assert.equal(asked.shot.format, "jpeg");
    assert.deepEqual({ ...asked.shot.clip, scale: Math.round(asked.shot.clip.scale * 1000) / 1000 }, { x: 0, y: 0, width: 1280, height: 800, scale: 1 });

    const lines = f.lines();
    // The browser's profile denies what a page asks for, takes no downloads, and every request passes Filament first.
    assert.ok(lines.some((l) => l.startsWith("B Fetch.enable ") && l.includes('"urlPattern":"*"')), "every request held for Filament");
    assert.ok(lines.some((l) => l.startsWith("B Browser.setDownloadBehavior ") && l.includes('"behavior":"deny"')));
    assert.ok(lines.includes('B Browser.grantPermissions {"permissions":[]}'), "every permission this Chrome knows refused: the grant of none");
    assert.ok(lines.some((l) => l.startsWith("B Target.createTarget ") && l.includes('"newWindow":true')), "each tab a window of its own: none hidden behind another");
    // The driver's commands reach the page; nothing else of its.
    const sent = lines.filter((l) => l.startsWith("S ")).map((l) => l.split(" ")[1]);
    const own = new Set(["Emulation.setDeviceMetricsOverride", "Emulation.setFocusEmulationEnabled", "Security.enable", "Security.setOverrideCertificateErrors"]);
    assert.deepEqual([...new Set(sent.filter((m) => !CDP_METHODS.has(m) && !own.has(m)))], [], "commands past the allowlist");
  });

  test("found on the PATH; a command past the allowlist refused in words, the allowlist the app's own", async () => {
    assert.equal(CDP_METHODS, APP_CDP_METHODS, "one allowlist, shared");
    const dir = scratch();
    const exe = chromeFile(dir, "google-chrome");
    const f = fakeChrome({ find: () => findChrome({ env: { PATH: dir, PATHEXT: ".EXE" }, exists: (p) => p.startsWith(dir) && existsSync(p) }) });
    const host = createBrowserHost({ chrome: f.chrome });
    await host.call("open", { tab: "t1", width: 820, height: 1180 });
    assert.equal(f.starts[0].command, exe);
    await assert.rejects(host.call("cdp", { tab: "t1", method: "Browser.close" }), /Browser\.close is no command the agent's browser takes/);
    await assert.rejects(host.call("cdp", { tab: "t9", method: "Page.reload", params: {} }), /no tab t9/);
    assert.deepEqual(await host.call("size", { tab: "t1", width: 390, height: 844 }), { width: 390, height: 844, fit: false });
    assert.ok(f.lines().some((l) => l.startsWith("S Emulation.setDeviceMetricsOverride ") && l.includes('"width":390')));
  });

  test("Filament's own address: a page's request to it fails, and a page's own load there is said to its agent", async () => {
    const f = fakeChrome({ find: () => "chrome" });
    const browsers = createBrowsers({ host: createBrowserHost({ chrome: f.chrome }), own: (u) => filamentsOwn(u, 20300) });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/calls-home" });
    await until(() => f.lines().some((l) => l.startsWith("own request ")), "the page's request to Filament answered");
    assert.ok(f.lines().includes(`own request fail BlockedByClient ${OWN}api/keys`), f.lines().join("\n"));
    assert.match(String(await browsers.call("c1", { action: "console" })), /\[error\] Failed to fetch/);
    await browsers.call("c1", { action: "snapshot" });
    const clicked = String(await browsers.call("c1", { action: "click", ref: "e3" }));
    await until(() => f.lines().some((l) => l.startsWith("home load ")), "the page's load of Filament answered");
    assert.ok(f.lines().includes(`home load fail BlockedByClient ${OWN}settings`));
    // Said at the agent's next result: the click's own, where the refusal came while it settled.
    const next = `${clicked}\n${await browsers.call("c1", { action: "snapshot" })}`;
    assert.match(next, /The page tried to go to http:\/\/127\.0\.0\.1:20300\/settings, Filament's own address; the browser never opens it\./);
  });

  // (fails before: yes — the review of b-headless: headless Chrome showed its certificate warning, a way on with it,
  // where the app's browser fails the load outright)
  test("a certificate no one vouches for fails the page's load, as in the app: no warning with a way on", async () => {
    const f = fakeChrome({ find: () => "chrome" });
    const browsers = createBrowsers({ host: createBrowserHost({ chrome: f.chrome }) });
    const went = await browsers.call("c1", { action: "navigate", url: "https://bad-cert.test/" }).then(String, (e) => String(e?.message || e));
    assert.ok(f.lines().includes("certificate cancel"), f.lines().join("\n"));
    const seen = `${went}\n${await browsers.call("c1", { action: "snapshot" })}`;
    assert.doesNotMatch(seen, /Proceed|Privacy error/, seen);
  });

  // (fails before: yes — the review of b-headless: the app refuses an address that is no web page's, and headless Chrome
  // let a page's redirect hand one to the OS and said nothing of a link to one)
  test("an address that is no web page's: a page's redirect there is ended before any app is handed it, and a link to one is said to its agent, as in the app", async () => {
    const f = fakeChrome({ find: () => "chrome" });
    const browsers = createBrowsers({ host: createBrowserHost({ chrome: f.chrome }) });
    const went = await browsers.call("c1", { action: "navigate", url: `https://shop.test/out?to=${encodeURIComponent("zoommtg://join?id=1")}` }).then(String, (e) => String(e?.message || e));
    assert.ok(!f.lines().some((l) => l.startsWith("handed to the OS")), f.lines().join("\n"));
    const redirected = `${went}\n${await browsers.call("c1", { action: "snapshot" })}`;
    assert.ok(redirected.includes("The page tried to go to zoommtg://join?id=1; the browser opens web pages alone."), redirected);
    const opened = String(await browsers.call("c1", { action: "navigate", url: "https://shop.test/?mail" }));
    assert.match(opened, /Page: Shop/, "a web page's load let through once it is answered");
    const mail = /link "Mail us" \[(e\d+)\]/.exec(opened)?.[1];
    assert.ok(mail, opened);
    const clicked = String(await browsers.call("c1", { action: "click", ref: mail }));
    await until(() => f.lines().includes("asked for mailto:sales@shop.test"), "the link pressed");
    const linked = `${clicked}\n${await browsers.call("c1", { action: "snapshot" })}`;
    assert.ok(linked.includes("The page tried to go to mailto:sales@shop.test; the browser opens web pages alone."), linked);
  });

  test("a page's popup is a tab of its chat, held before anything of it reaches its site", async () => {
    const f = fakeChrome({ find: () => "chrome" });
    const browsers = createBrowsers({ host: createBrowserHost({ chrome: f.chrome }) });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/" });
    const clicked = String(await browsers.call("c1", { action: "click", ref: "e2" }));
    await until(() => f.lines().some((l) => l.startsWith("popup load ")), "the popup's load answered");
    assert.ok(f.lines().includes("popup load fail Aborted"), "the popup's own load never went out");
    await until(async () => (await browsers.stateOf("c1")).tabs.length === 2, "the popup a tab of the chat");
    const tabs = `${clicked}\n${await browsers.call("c1", { action: "tabs" })}`;
    assert.match(tabs, /The page in t-[\w-]+ opened a new tab, t-[\w-]+ \(https:\/\/shop\.test\/pricing\)/);
    assert.match(tabs, /\nt-[\w-]+ Shop — https:\/\/shop\.test\/pricing/);
    // Chrome's own popup window closed; the tab is one the host opened, its page loaded once the chat kept it.
    assert.ok(f.lines().some((l) => l.startsWith("B Target.closeTarget ")));
    await until(() => f.lines().some((l) => l.startsWith("S Page.navigate ") && l.includes("https://shop.test/pricing")), "the chat's tab loaded the popup's page");
  });

  test("with neither app nor Chrome, a call says how to get Chrome; the tool's words name both", async () => {
    let finds = 0;
    const f = fakeChrome({ find: () => (finds++, "") });
    const host = createBrowserHost({ chrome: f.chrome });
    assert.equal(host.available, false);
    const browsers = createBrowsers({ host });
    await assert.rejects(browsers.call("c1", { action: "navigate", url: "shop.test" }), { message: NO_HOST });
    assert.match(NO_HOST, /desktop app/);
    assert.match(NO_HOST, /Chrome or Chromium/);
    assert.match(NO_HOST, /apt install chromium/);
    assert.match(NO_HOST, new RegExp(CHROME_ENV));
    assert.equal(f.starts.length, 0);
    assert.ok(finds >= 1);
    // Looked for again only now and then: a read of `available` costs no search of the disk.
    const before = finds;
    for (let i = 0; i < 50; i++) void host.available;
    assert.equal(finds, before);
    assert.match(BROWSER_TOOL.description, /the Filament desktop app's Chromium, or Chrome on this machine/);
  });

  test("an app that connects takes the pages over: Chrome's tabs go, and each agent's page opens again in the app; once it goes, Chrome holds them again", async () => {
    const f = fakeChrome({ find: () => "chrome" });
    const host = createBrowserHost({ chrome: f.chrome });
    const browsers = createBrowsers({ host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/" });
    assert.equal(f.procs.length, 1);

    /** @type {any[]} */
    const sent = [];
    /** @type {(m: any) => void} */
    let take = () => {};
    const link = {
      send: (/** @type {any} */ m) => {
        sent.push(m);
        setTimeout(() => {
          if (m.op !== "cdp") return take({ n: m.n, ok: true, result: null });
          if (m.method === "Page.getFrameTree") return take({ n: m.n, ok: true, result: { frameTree: { frame: { id: "F", url: "about:blank" } } } });
          if (m.method === "Page.navigate") {
            take({ n: m.n, ok: true, result: { loaderId: "L" } });
            for (const [method, params] of [["Page.frameNavigated", { frame: { id: "F", url: m.params.url } }], ["Page.loadEventFired", {}]]) take({ op: "event", tab: m.tab, method, params });
            return;
          }
          if (m.method === "Accessibility.getFullAXTree") return take({ n: m.n, ok: true, result: { nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "In the app" }, childIds: [] }] } });
          take({ n: m.n, ok: true, result: {} });
        }, 1);
      },
      close: () => {},
    };
    take = host.attach(link);
    // The chat is this machine's (no device drives it): Chrome closes its page for the app (b-hosts).
    assert.deepEqual((await browsers.stateOf("c1")).tabs, [], "Chrome's tabs went as the app connected");
    await until(() => f.procs[0].exitCode !== null || f.procs[0].signalCode !== null, "Chrome stopped: the app holds the browser");
    const inApp = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(inApp, /The browser moved to this machine's desktop app \(the app of whoever drives this chat connected, and holds its pages now\): tab t-\w+ \(https:\/\/shop\.test\/\) opened again there at its address, with the same ids\./);
    assert.equal(sent[0].op, "open", "the agent's page opened again, in the app");
    assert.ok(sent.some((m) => m.op === "cdp" && m.method === "Page.navigate" && m.params.url === "https://shop.test/"), "at the page it was on");
    assert.equal(f.procs.length, 1, "Chrome not started while the app is there");

    host.detach(link);
    const back = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(back, /The browser moved to Chrome on this machine \(the desktop app quit, or connected again\)/);
    assert.match(back, /Page: Shop — https:\/\/shop\.test\//, "Chrome holds the page again");
    assert.equal(f.procs.length, 2);
  });

  test("a long message in many small pieces is read whole: a page's tree of megabytes, its letters split across pieces", { timeout: 60_000 }, async () => {
    const nodes = Array.from({ length: 12_000 }, (_, i) => ({ nodeId: String(i), role: { value: "StaticText" }, name: { value: `Zeile ${i} — é漢字 ${"x".repeat(40)}` }, childIds: [] }));
    const proc = scriptedChrome({ answer: (m) => (m.method === "Accessibility.getFullAXTree" ? { nodes } : undefined), piece: 13 });
    const chrome = createHeadlessHost({ dataDir: scratch(), find: () => "chrome", spawn: () => proc });
    after(() => chrome.stop());
    await chrome.call("open", { tab: "t1", width: 800, height: 600 });
    const got = await chrome.call("cdp", { tab: "t1", method: "Accessibility.getFullAXTree", params: {} });
    assert.ok(Buffer.byteLength(JSON.stringify(got)) > 1_000_000, "megabytes, in pieces of 13 bytes");
    assert.deepEqual(got.nodes, nodes);
    assert.deepEqual(await chrome.call("cdp", { tab: "t1", method: "Page.getFrameTree", params: {} }), {}, "and a short one after it");
  });

  // (fails before: yes — the review of b-headless: a stop while Chrome started stopped nothing, and the next start went
  // on the same profile beside it)
  test("a stop while Chrome starts ends that start and its Chrome — asked, then made to; the next start waits for it to go before it empties the profile", { timeout: 30_000 }, async () => {
    const dataDir = scratch();
    const marker = join(profileOf(dataDir), "the-first-chrome's");
    /** @type {string[]} */
    const order = [];
    // The first holds on past its ask to end, and never answers as it starts.
    const first = scriptedChrome({ holdsOn: true, answer: (m) => (m.method === "Browser.getVersion" ? new Promise(() => {}) : undefined) });
    first.once("exit", () => order.push("first ended"));
    const second = scriptedChrome();
    const procs = [first, second];
    const chrome = createHeadlessHost({
      dataDir,
      find: () => "chrome",
      spawn: () => {
        const p = procs.shift();
        if (p === first) writeFileSync(marker, "");
        order.push(p === first ? "first started" : `second started${existsSync(marker) ? " on the first's profile" : ""}`);
        return p;
      },
    });
    after(() => chrome.stop());
    const opening = chrome.call("open", { tab: "t1" });
    await until(() => first.commands.some((/** @type {any} */ m) => m.method === "Browser.getVersion"), "Chrome asked as it starts");
    chrome.stop("the desktop app connected: its browser holds the pages");
    assert.deepEqual(first.kills, ["SIGTERM"], "the start's Chrome asked to end at once");
    await assert.rejects(opening, /stopped as it started/);
    await chrome.call("open", { tab: "t2" });
    assert.deepEqual(first.kills, ["SIGTERM", "SIGKILL"], "made to end once it held on");
    assert.deepEqual(order, ["first started", "first ended", "second started"]);
  });

  // (fails before: yes — the review of b-headless: clearing emptied only the origins a page reached, and left partitioned
  // storage and HTTP sign-ins)
  test("clearing the browser's data stops Chrome: its tabs go, said, and the next call starts it on an emptied profile", async () => {
    const f = fakeChrome({ find: () => "chrome" });
    const host = createBrowserHost({ chrome: f.chrome });
    /** @type {string[]} */
    const heard = [];
    host.on((e) => heard.push(e.op));
    const browsers = createBrowsers({ host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/" });
    const kept = join(profileOf(f.dataDir), "Cookies");
    writeFileSync(kept, "a sign-in");
    assert.deepEqual(await browsers.person("c1", { act: "clear" }), { ok: true });
    assert.deepEqual(heard.filter((op) => op === "lost"), ["lost"], "its tabs went, said");
    await until(() => f.procs[0].exitCode !== null || f.procs[0].signalCode !== null, "Chrome stopped");
    const again = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(again, /sign-ins and cookies are gone/);
    assert.match(again, /Page: Shop — https:\/\/shop\.test\//, "the agent's page open again");
    assert.equal(f.procs.length, 2);
    assert.ok(!existsSync(kept), "the profile emptied as Chrome started again");
    // With no Chrome running there is nothing to clear: none is started for it.
    f.chrome.stop();
    assert.equal(await host.call("clear", {}), null);
    assert.equal(f.procs.length, 2);
  });

  test("Chrome that ends with pages open: they go, said, and the next call starts it again", async () => {
    const f = fakeChrome({ find: () => "chrome" });
    const host = createBrowserHost({ chrome: f.chrome });
    /** @type {string[]} */
    const heard = [];
    host.on((e) => heard.push(e.op));
    const browsers = createBrowsers({ host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/" });
    f.procs[0].kill();
    await until(() => heard.includes("lost"), "the pages' end heard");
    const again = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(again, /Page: Shop — https:\/\/shop\.test\//);
    assert.equal(f.procs.length, 2);
  });
});

describe("Filament's every door", () => {
  // (fails before: yes — the review of b-headless: the app built its own check from Filament's main port, and was told
  // nothing of its doors)
  test("the app is told where Filament is reached as it connects, again before a call once that changed, and as the doors move", async () => {
    /** @type {{ ports: number[], names: string[], origins: string[] }} */
    let places = { ports: [20300], names: ["filament.lan"], origins: [] };
    const host = createBrowserHost({ places: () => places });
    /** @type {any[]} */
    const sent = [];
    /** @type {(m: any) => void} */
    let take = () => {};
    const link = { send: (/** @type {any} */ m) => void (sent.push(m), setTimeout(() => take({ n: m.n, ok: true, result: null }), 1)), close: () => {} };
    take = host.attach(link);
    assert.deepEqual(sent.map((m) => [m.op, m.ports]), [["own", [20300]]], "told as it connects");
    await host.call("open", { tab: "t1" });
    assert.deepEqual(sent.splice(0).map((m) => m.op), ["own", "open"], "nothing changed: not told again");
    places = { ports: [20300, 20343], names: ["filament.lan"], origins: [] };
    await host.call("close", { tab: "t1" });
    assert.deepEqual(sent.splice(0).map((m) => [m.op, m.ports]), [["own", [20300, 20343]], ["close", undefined]], "told before the next call");
    places = { ports: [20300, 20343, 20345], names: ["filament.lan"], origins: ["https://box.tail0.ts.net"] };
    host.placesMoved();
    assert.deepEqual(sent.splice(0).map((m) => [m.op, m.origins]), [["own", ["https://box.tail0.ts.net"]]], "told as the doors move");
    // An app that knows no `own` refuses it, and nothing of Filament's waits on that.
    take = host.attach({ ...link, send: (/** @type {any} */ m) => void (sent.push(m), setTimeout(() => take(m.op === "own" ? { n: m.n, ok: false, error: "own is nothing the app's browser does" } : { n: m.n, ok: true, result: null }), 1)) });
    await host.call("open", { tab: "t2" });
    assert.deepEqual(sent.splice(0).map((m) => m.op), ["own", "open"]);
  });

  // (fails before: yes — the review of b-headless: Filament's own address was its main port alone, so a page reached the
  // network's door, the artifacts' beside it and the tailnet's, which hand their paths to the front door with this
  // machine's trust)
  test("the network's door, the artifacts' beside it, the tailnet's two and the addresses Tailscale serves are Filament's own: the agent's navigation, a page's load and a page's request to each are refused, the load said to its agent", { timeout: 90_000 }, async () => {
    const name = "box.tail0.ts.net";
    const log = join(scratch(), "fake-chrome.log");
    let lanPort = 0;
    /** @type {any} */
    let shim = null;
    // Both doors at the two ports asked, or two others: `twoFreePorts` lets them go for Filament to take, and another
    // test's process may take one first — the artifacts' door then listens nowhere, and its port is no one's of
    // Filament's. Five tries, and a door that is Filament's yet not refused fails below all the same.
    for (let tries = 1; ; tries++) {
      lanPort = await twoFreePorts();
      const port = lanPort;
      shim = await startApp({
        configure: (c) => {
          c.server.lan = { enabled: true, port };
          c.server.tailscale = { serve: true, trustOwnLogin: false, port: 0 };
        },
        overrides: { lanHost: "127.0.0.1", tailnet: tailscale(name), findChrome: () => "chrome", chromeSpawn: fakeSpawn(log) },
      });
      const art = await shim.app.browsers.call("c1", { action: "navigate", url: `https://127.0.0.1:${lanPort + 1}/api/state` }).then(
        () => false,
        (/** @type {any} */ e) => /Filament's own address/.test(String(e?.message)),
      );
      if ((Number(shim.started.lan?.listening?.port) === lanPort && art) || tries === 5) break;
      await shim.stop();
    }
    try {
      assert.equal(Number(shim.started.lan?.listening?.port), lanPort, "the network's door at the port asked");
      const look = await (await shim.api("/api/remote/tailscale")).json();
      assert.deepEqual([look.address, look.artifacts], [`https://${name}`, `https://${name}:8443`]);
      const browsers = shim.app.browsers;
      const doors = [`https://127.0.0.1:${lanPort}`, `https://127.0.0.1:${lanPort + 1}`, `http://127.0.0.1:${look.listening.port}`, `http://127.0.0.1:${look.listening.artPort}`];
      for (const door of doors) {
        await assert.rejects(browsers.call("c1", { action: "navigate", url: `${door}/api/state` }), /Filament's own address/, door);
        const to = `${door}/api/keys`;
        const opened = String(await browsers.call("c1", { action: "navigate", url: `https://shop.test/calls-home?home=${encodeURIComponent(to)}` }));
        await until(() => linesOf(log).some((l) => l.startsWith("own request ") && l.endsWith(` ${to}`)), `the page's request to ${door} answered`);
        assert.ok(linesOf(log).includes(`own request fail BlockedByClient ${to}`), door);
        const home = /link "Home" \[(e\d+)\]/.exec(opened)?.[1];
        assert.ok(home, opened);
        const clicked = String(await browsers.call("c1", { action: "click", ref: home }));
        await until(() => linesOf(log).some((l) => l.startsWith("home load ") && l.endsWith(` ${to}`)), `the page's load of ${door} answered`);
        assert.ok(linesOf(log).includes(`home load fail BlockedByClient ${to}`), door);
        const next = `${clicked}\n${await browsers.call("c1", { action: "snapshot" })}`;
        assert.ok(next.includes(`The page tried to go to ${to}, Filament's own address; the browser never opens it.`), next);
      }
      // The network's door by this machine's own address, and Filament where Tailscale serves it.
      const mine = Object.values(networkInterfaces()).flatMap((l) => l || []).find((n) => !n.internal && n.family === "IPv4")?.address;
      for (const url of [...(mine ? [`https://${mine}:${lanPort}/api/state`] : []), `${look.address}/api/state`, `${look.artifacts}/x/`])
        await assert.rejects(browsers.call("c1", { action: "navigate", url }), /Filament's own address/, url);
    } finally {
      await shim.stop();
    }
  });
});

// A real Chrome or Edge, where this machine has one: the page served here, Filament's own address another server here.
const REAL = findChrome();
describe("a real Chrome", () => {
  // (fails before: yes — the review of b-headless: some permissions read as granted, and a redirect to an app's address
  // was said to no one)
  test("drives a page: open, snapshot, click, a screenshot, Filament's own address refused, no permission granted, a target=_blank popup a tab of the chat, a redirect to an app's address ended", { skip: REAL ? false : "no Chrome, Chromium or Edge on this machine", timeout: 90_000 }, async () => {
    let ownHits = 0;
    const ownServer = createServer((_q, r) => {
      ownHits++;
      r.end("keys");
    });
    await new Promise((r) => ownServer.listen(0, "127.0.0.1", () => r(null)));
    const ownPort = /** @type {any} */ (ownServer.address()).port;
    // Every permission a page may read, refused: none reads as granted.
    const asks = ["geolocation", "notifications", "camera", "microphone", "midi", "clipboard-read", "clipboard-write", "background-sync", "background-fetch", "periodic-background-sync", "persistent-storage", "screen-wake-lock", "accelerometer", "gyroscope", "magnetometer", "keyboard-lock", "pointer-lock", "payment-handler", "idle-detection", "local-fonts", "window-management", "display-capture", "captured-surface-control", "local-network-access"];
    const site = createServer((q, r) => {
      if (q.url === "/out") {
        r.writeHead(302, { location: "filament-test-nowhere://open" });
        return void r.end();
      }
      r.setHeader("content-type", "text/html");
      if (q.url === "/pricing") return void r.end("<!doctype html><title>Real pricing</title><h1>Pricing</h1>");
      r.end(
        `<!doctype html><title>Real shop</title><h1 id=h>Welcome</h1><button onclick="document.getElementById('h').textContent='Bought'">Buy</button><a href="/pricing" target="_blank">Pricing</a><p id=p></p>` +
          `<script>fetch('http://127.0.0.1:${ownPort}/api/keys').then(()=>console.log('reached Filament'),()=>console.error('own address refused'));` +
          `Promise.all(${JSON.stringify(asks)}.map((n)=>navigator.permissions.query({name:n}).then((s)=>n+'='+s.state,()=>n+'=unknown'))).then((a)=>{const p=document.getElementById('p');for(const s of a){const i=document.createElement('li');i.textContent=s;p.append(i)}})</script>`,
      );
    });
    await new Promise((r) => site.listen(0, "127.0.0.1", () => r(null)));
    const base = `http://127.0.0.1:${/** @type {any} */ (site.address()).port}`;
    const chrome = createHeadlessHost({ dataDir: scratch(), own: (u) => filamentsOwn(u, ownPort) });
    try {
      const browsers = createBrowsers({ host: createBrowserHost({ chrome }), own: (u) => filamentsOwn(u, ownPort) });
      const opened = String(await browsers.call("c1", { action: "navigate", url: `${base}/` }));
      assert.match(opened, /Page: Real shop/);
      const ref = /button "Buy" \[(e\d+)\]/.exec(opened)?.[1];
      assert.ok(ref, opened);
      const clicked = String(await browsers.call("c1", { action: "click", ref }));
      assert.match(clicked, /heading "Bought"/);
      const shot = await browsers.call("c1", { action: "screenshot" });
      assert.ok(shot instanceof MediaResult);
      assert.equal(shot.media[0].source.media_type, "image/jpeg");
      assert.ok(Buffer.from(shot.media[0].source.data, "base64").subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), "a JPEG");
      await until(async () => /own address refused/.test(String(await browsers.call("c1", { action: "console" }))), "the page's request to Filament refused");
      assert.equal(ownHits, 0, "nothing reached Filament's own address");
      /** @type {string} */
      let read = "";
      await until(async () => (read = String(await browsers.call("c1", { action: "snapshot" }))).includes(`${asks.at(-1)}=`), "the page read its permissions");
      const states = asks.map((n) => new RegExp(`${n}=(\\w+)`).exec(read)?.[0] || `${n}: not read`);
      assert.deepEqual(states.filter((s) => !/=(denied|unknown)$/.test(s)), [], read);
      // A target=_blank link: the popup held before it loads, and a tab of the chat at its address.
      const pricing = /link "Pricing" \[(e\d+)\]/.exec(read)?.[1];
      assert.ok(pricing, read);
      await browsers.call("c1", { action: "click", ref: pricing });
      await until(async () => /Real pricing — http:\/\/127\.0\.0\.1:\d+\/pricing/.test(String(await browsers.call("c1", { action: "tabs" }))), "the popup a tab of the chat");
      assert.equal((await browsers.stateOf("c1")).tabs.length, 2);
      // A redirect to an app's address: ended before any app is handed it, and said.
      const out = await browsers.call("c1", { action: "navigate", url: `${base}/out` }).then(String, (e) => String(e?.message || e));
      const redirected = `${out}\n${await browsers.call("c1", { action: "snapshot" })}`;
      assert.ok(redirected.includes("The page tried to go to filament-test-nowhere://open; the browser opens web pages alone."), redirected);
    } finally {
      chrome.stop();
      ownServer.close();
      site.close();
    }
  });

  test("a certificate no one vouches for fails the load: Chrome's warning, with its way on, never shows", { skip: REAL ? false : "no Chrome, Chromium or Edge on this machine", timeout: 60_000 }, async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const { pem } = selfSigned({ privateKey, publicKey, name: "Unvouched", dns: ["localhost"], ips: ["127.0.0.1"] });
    const site = createTlsServer({ key: privateKey.export({ type: "pkcs8", format: "pem" }), cert: pem }, (_q, r) => {
      r.setHeader("content-type", "text/html");
      r.end("<!doctype html><title>Unvouched</title><h1>Behind a bad certificate</h1>");
    });
    await new Promise((r) => site.listen(0, "127.0.0.1", () => r(null)));
    const chrome = createHeadlessHost({ dataDir: scratch() });
    try {
      const browsers = createBrowsers({ host: createBrowserHost({ chrome }) });
      const url = `https://127.0.0.1:${/** @type {any} */ (site.address()).port}/`;
      const went = await browsers.call("c1", { action: "navigate", url }).then(String, (e) => String(e?.message || e));
      const seen = `${went}\n${await browsers.call("c1", { action: "snapshot" })}`;
      assert.doesNotMatch(seen, /Proceed|Advanced|not private|Behind a bad certificate/i, seen);
    } finally {
      chrome.stop();
      site.close();
    }
  });
});
