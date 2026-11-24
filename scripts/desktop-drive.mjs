#!/usr/bin/env node
// @ts-check
// The desktop app, driven (HarnessV3-Native NA2 to NA4 and NA3b, HarnessV4_Browser_Plan BR5; the plans' checks): Electron started on the checkout over
// throwaway data folders and ports, a fake model and a stand-in memory engine behind them, its pages read over the
// DevTools protocol. Its notifications are off in the app's own settings (written as a person's choice would be), so
// they are written to the app's log, never shown: your notification centre stays as it was. Nothing here is a test hook in the app: it is started, asked and quit as a person or a script would — a
// launch, a second launch, `--quit`. Every process it starts is ended by its PID (and what that PID started), every
// folder it made is removed; port 20300 and the Filament you run are never touched. Windows only for now: the process
// checks read Windows' process list.
//   npm run test:desktop
//   npm run test:desktop -- --built [exe]   the packaged app (`npm run dist:win`'s
//                                            dist\windows\<version>\win-unpacked\Filament.exe unless named) instead of
//                                            Electron over the checkout: checks 1, 2, 9, 10, 11 and 26–30
//   npm run test:desktop -- --pictures <dir>  what the browser's checks looked like, kept there as PNGs
//   npm run test:desktop -- --desk           the desk's checks (35) alone, over two Filaments of their own
//   npm run test:desktop -- --owner          the windows' owner session's check (36) alone
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { defaultConfig } from "../src/config.js";
import { anthropicReply, FAKE_SIDECAR, fakeUpstream } from "../test/helpers/app.js";
import { RESTART_GAP_MS } from "../desktop/lib/supervisor.js";
import { MACHINES_FILE, addMachine, setMachineOff } from "../desktop/lib/machines.js";
import { distDir, versionOf } from "./dist-win.mjs";
import { OWNER_HEADER, OWNER_SESSION_HEADER, ownerHeaders, ownerKeyOf } from "../src/services/owner.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = join(ROOT, "desktop", "main.js");
const KEY = "drive-key";
const LIVE_PORT = 20300;
const ELECTRON = /** @type {string} */ (/** @type {unknown} */ (electronPath));
// `--built [exe]`: the packaged app, run as the installer leaves it (NA4) — the checks that tell a build apart.
const builtAt = process.argv.indexOf("--built");
const builtArg = builtAt < 0 ? "" : process.argv[builtAt + 1] || "";
const BUILT = builtAt < 0 ? "" : builtArg && !builtArg.startsWith("--") ? resolve(builtArg) : join(distDir(ROOT, "windows", versionOf(ROOT)), "win-unpacked", "Filament.exe");
if (BUILT && !existsSync(BUILT)) {
  console.log(`no packaged app at ${BUILT}: npm run dist:win builds it`);
  process.exit(1);
}
if (BUILT) console.log(`the packaged app: ${BUILT}`);
const DESK_ONLY = process.argv.includes("--desk");
const OWNER_ONLY = process.argv.includes("--owner");
if (process.platform !== "win32") {
  console.log("the desktop drive reads Windows' process list; on this platform it does not run yet");
  process.exit(0);
}

/** @type {{ name: string, ok: boolean, note: string }[]} */
const results = [];
/** @param {string} name @param {boolean} ok @param {string} [note] */
const check = (name, ok, note = "") => {
  results.push({ name, ok, note });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${note ? ` — ${note}` : ""}`);
};
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Wait for `fn` to answer something: the app's start, not a model's work, so a drive that waits past `ms` says so.
 * @template T @param {() => Promise<T | null | undefined | false> | T | null | undefined | false} fn @param {number} ms @param {string} what
 * @returns {Promise<T>}
 */
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await Promise.resolve()
      .then(fn)
      .catch(() => null);
    if (v) return /** @type {T} */ (v);
    if (Date.now() > end) throw new Error(`no ${what} after ${Math.round(ms / 1000)} s`);
    await sleep(200);
  }
}
/** A free port, from the system; never the Filament you run. @returns {Promise<number>} */
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = /** @type {any} */ (s.address()).port;
      s.close(() => resolve(port === LIVE_PORT ? freePort() : port));
    });
  });

// ---- the machine's processes ------------------------------------------------------------------------------------------
/** @returns {{ pid: number, parent: number, name: string, line: string }[]} */
function processes() {
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out).map((/** @type {any} */ p) => ({ pid: p.ProcessId, parent: p.ParentProcessId, name: String(p.Name || ""), line: String(p.CommandLine || "") }));
}
/** Every process under `pid`, it included where it still runs. @param {number} pid */
function treeOf(pid, all = processes()) {
  const out = all.filter((p) => p.pid === pid);
  for (let i = 0; i < out.length; i++) for (const c of all) if (c.parent === out[i].pid && !out.includes(c)) out.push(c);
  return out;
}
/** The PID that listens on `port`, or null. @param {number} port */
function listener(port) {
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`], { encoding: "utf8", windowsHide: true }).trim();
  return out ? Number(out) : null;
}
/** End `pid` and what it started — only a PID this drive started, or one under it. @param {number} pid */
function endTree(pid) {
  for (const p of treeOf(pid).reverse()) {
    try {
      process.kill(p.pid);
    } catch {}
  }
}

// ---- Filament's answers and the app's pages ----------------------------------------------------------------------------
/**
 * The owner key of the Filament this drive runs at `port`, as a script of the person's sends it: read from whichever of
 * the drive's data folders says it listens there (src/services/owner.js `ownerHeaders`); none where none does.
 * @param {number} port @returns {Record<string, string>}
 */
const ownerOfPort = (port) => {
  for (const d of readdirSync(base)) {
    const h = ownerHeaders(join(base, d), `http://127.0.0.1:${port}`);
    if (h[OWNER_HEADER]) return h;
  }
  return {};
};
/** @param {number} port */
const stateAt = (port) =>
  fetch(`http://127.0.0.1:${port}/api/state`, { headers: { "x-filament-ui": "1", ...ownerOfPort(port) }, signal: AbortSignal.timeout(3000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
/** @param {number} port @param {string} path @param {any} [body] @param {string} [method] */
const call = (port, path, body, method = body === undefined ? "GET" : "POST") =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json", "x-api-key": KEY, authorization: `Bearer ${KEY}`, ...(path.startsWith("/api/") ? ownerOfPort(port) : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
/** The app's pages, as its DevTools port lists them; a page keeps its `id` as it loads another address. @param {number} debug @returns {Promise<{ id: string, url: string, webSocketDebuggerUrl: string }[]>} */
const pagesOf = (debug) =>
  fetch(`http://127.0.0.1:${debug}/json/list`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.json())
    .then((all) => all.filter((/** @type {any} */ t) => t.type === "page"))
    .catch(() => []);
/** One DevTools command in a page, its result. @param {{ webSocketDebuggerUrl: string }} page @param {string} method @param {any} params */
function sendIn(page, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => (ws.close(), reject(new Error("the page did not answer"))), 10000);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.addEventListener("message", (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      resolve(d.result);
    });
    ws.addEventListener("error", () => (clearTimeout(timer), reject(new Error("no DevTools connection"))));
  });
}
/** An expression's value in a page. @param {{ webSocketDebuggerUrl: string }} page @param {string} expression */
const evalIn = (page, expression) => sendIn(page, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }).then((/** @type {any} */ r) => r?.result?.value);
// `--pictures <folder>`: what a check looked like, kept there as PNGs (HarnessV4_BrowserSize_Plan BS5); none otherwise.
const picturesAt = process.argv.indexOf("--pictures");
const PICTURES = picturesAt < 0 ? "" : resolve(process.argv[picturesAt + 1] || ".");
/** A page as it paints, kept as `<name>.png` where the drive keeps pictures: its file, or "". @param {{ webSocketDebuggerUrl: string } | null} page @param {string} name */
async function picture(page, name) {
  if (!PICTURES || !page) return "";
  const shot = /** @type {any} */ (await sendIn(page, "Page.captureScreenshot", { format: "png" }).catch(() => null));
  if (!shot?.data) return "";
  mkdirSync(PICTURES, { recursive: true });
  const file = join(PICTURES, `${name}.png`);
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  return file;
}
/** The app's own log in a data folder. @param {string} dataDir */
const appLog = (dataDir) => {
  const file = join(dataDir, "desktop", "server.log");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};
/** When the app's log says it started Filament, in ms. @param {string} text */
const startsIn = (text) => [...text.matchAll(/^\[desktop\] (\S+) Filament started\b/gm)].map((m) => Date.parse(m[1]));

// ---- a throwaway Filament's folder ---------------------------------------------------------------------------------------
/**
 * @param {string} dir @param {number} port @param {string} upstream @param {string} root
 * @param {{ memory?: boolean, failing?: string, loopbackTrust?: string }} [o]  `memory`: on, with the stand-in engine (`FILAMENT_MEMORY_SIDECAR` in the
 *   app's env); `failing`: the route's provider is one that fails there, `upstream` its backup (a failover, an alert);
 *   `loopbackTrust`: its `server.loopbackTrust`, the schema's own unless said
 */
function writeConfig(dir, port, upstream, root, { memory = false, failing = "", loopbackTrust = "" } = {}) {
  if (port === LIVE_PORT) throw new Error("never the Filament you run");
  mkdirSync(dir, { recursive: true });
  const cfg = /** @type {any} */ (defaultConfig());
  cfg.server.port = port;
  cfg.server.inboundKeys = [KEY];
  cfg.observability.logFile = "";
  if (loopbackTrust) cfg.server.loopbackTrust = loopbackTrust;
  cfg.memory = memory
    ? { enabled: true, folder: join(dir, "mem"), models: { summarizer: "" }, autopilot: { enabled: false }, capture: { turns: true, learn: false }, commands: { enabled: true, prefix: "@mem" }, privacy: { encryptArchive: false } }
    : // Memory off: its engine would install itself on a first start.
      { ...cfg.memory, enabled: false };
  cfg.upstreams = [{ id: "anthropic", name: "Anthropic", type: "anthropic", baseUrl: upstream, apiKey: "s", enabled: true, models: ["claude-sonnet-5-5"] }];
  cfg.routes = [{ match: "claude-*", upstream: "anthropic", upstreamModel: "{model}", enabled: true }];
  if (failing) {
    cfg.upstreams.unshift({ id: "down", name: "Down", type: "anthropic", baseUrl: failing, apiKey: "s", enabled: true, models: ["claude-sonnet-5-5"] });
    cfg.routes = [{ match: "claude-*", upstream: "down", upstreamModel: "{model}", fallbacks: [{ upstream: "anthropic" }], enabled: true }];
    // Failover on, which is off by default: a route's backups are tried only while it is.
    cfg.rules = { ...cfg.rules, resilience: { ...cfg.rules?.resilience, failover: true } };
  }
  cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
}

/** @type {{ pid: number, label: string }[]} */
const mine = [];
const plainEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^ELECTRON_/i.test(k)));
/**
 * Start the app over `dataDir` (its port, the folder's config's, unless `args` gives `--port`); `debug`, its DevTools port.
 * @param {string} dataDir @param {{ debug?: number, args?: string[], label: string, env?: Record<string, string> }} o
 */
function launch(dataDir, { debug, args = [], label, env = {} }) {
  const p = spawn(BUILT || ELECTRON, [...(BUILT ? [] : [MAIN]), "--data-dir", dataDir, ...(debug ? [`--remote-debugging-port=${debug}`] : []), ...args], { env: { ...plainEnv(), ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let said = "";
  p.stdout?.on("data", (d) => (said += d));
  p.stderr?.on("data", (d) => (said += d));
  /** @type {number | null | undefined} */
  let exit;
  p.on("exit", (code) => (exit = code));
  if (p.pid) mine.push({ pid: p.pid, label });
  return { pid: /** @type {number} */ (p.pid), exited: () => exit !== undefined, code: () => exit, said: () => said };
}

/** What the model answers a call, where a check gives it a turn of its own (25); else it says the parser is built. @type {((c: any) => any) | null} */
let brain = null;
const up = await fakeUpstream((c) => brain?.(c) ?? (c.kind === "anthropic" ? anthropicReply("The parser is built.", { model: "claude-sonnet-5-5" }) : undefined));
// A provider that fails: the turn of check 2 goes to its backup, and Filament raises a failover's alert.
const down = await fakeUpstream(() => ({ status: 500, json: { type: "error", error: { type: "api_error", message: "the provider is down" } } }));
const base = mkdtempSync(join(tmpdir(), "filament-native-drive-"));
const root = join(base, "root");
mkdirSync(root);
// The data folder the app must never write into: Electron's own files there, and when each last changed.
const ELECTRON_FILES = ["Local State", "Preferences", "Network", "GPUCache", "Code Cache", "Session Storage", "Local Storage", "Crashpad", "blob_storage", "DawnGraphiteCache", "DawnWebGPUCache", "GrShaderCache", "ShaderCache", "Shared Dictionary", "SharedStorage", "Cookies", "DIPS", "lockfile", "windows.json", "desktop", "server.log"];
const appData = join(process.env.APPDATA || "", "filament");
/** @returns {Map<string, number>} */
const electronThere = () => new Map((existsSync(appData) ? readdirSync(appData) : []).filter((n) => ELECTRON_FILES.includes(n)).map((n) => [n, statSync(join(appData, n)).mtimeMs]));
const appDataBefore = electronThere();
/** @type {import("node:http").Server | null} */
let squatter = null;

/** Every process the drive started ended, the fake models closed, its folders removed. */
async function cleanUp() {
  if (squatter) await new Promise((r) => /** @type {any} */ (squatter).close(() => r(undefined)));
  for (const p of mine) if (processes().some((x) => x.pid === p.pid)) endTree(p.pid);
  await up.close();
  await down.close();
  await sleep(1000);
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch((e) => console.log(`left ${base}: ${e.message}`));
}
/** The tally said, and the drive's end: 1 where a check failed. @returns {never} */
function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks pass`);
  process.exit(failed.length ? 1 : 0);
}

// ---- 35: the desk (the remote desk of 11-22) ----------------------------------------------------------------------------
/**
 * Another Filament, Studio, on the network, paired as a Full device from the Add sheet as check 33 pairs one. Its chats
 * in this computer's Now, each with its machine's name; one pressed shows in place — Studio's own page of the chat beside
 * this computer's left bar, its row marked —, and this computer's Ctrl+K opens over it, the view out of sight meanwhile
 * and in sight after (a key pressed in the view itself goes through Electron's own input, which no DevTools key reaches:
 * test/desktop-rail.test.js tries those); its ask answered from Needs you, the window staying where it was; and Run on:
 * a new chat of a project here started on Studio in a copy of it, what it wrote there brought back as an uncommitted
 * edit, HEAD and the index as they were.
 */
async function driveDesk() {
  const dataS = join(base, "s");
  const portS = await freePort();
  const lanS = await freePort();
  writeConfig(dataS, portS, up.url, root);
  const cfgS = JSON.parse(readFileSync(join(dataS, "config.json"), "utf8"));
  cfgS.server.lan = { enabled: true, port: lanS };
  writeFileSync(join(dataS, "config.json"), JSON.stringify(cfgS));
  // Named before its first start, as its Settings would name it: else it takes this computer's name.
  const idS = randomUUID();
  writeFileSync(join(dataS, "machine.json"), JSON.stringify({ version: 1, id: idS, name: "Studio", named: true }));
  // Its copies under the drive's folder, never the person's own Filament copies.
  const S = spawn(process.execPath, [join(ROOT, "bin", "filament.js"), "--data-dir", dataS, "--port", String(portS)], { env: { ...plainEnv(), FILAMENT_COPIES_DIR: join(base, "copies") }, stdio: "ignore", windowsHide: true });
  if (S.pid) mine.push({ pid: S.pid, label: "Studio's Filament" });
  await until(() => stateAt(portS), 60000, "answer from Studio's Filament");
  const pairS = /** @type {any} */ (await until(async () => {
    const r = await fetch(`http://127.0.0.1:${portS}/api/remote/pair`, { method: "POST", headers: { "content-type": "application/json", ...ownerOfPort(portS) }, body: JSON.stringify({ scope: "full" }) }).catch(() => null);
    const j = r?.ok ? await r.json() : null;
    return j?.links?.length ? j : null;
  }, 20000, "Studio's pairing link").catch(() => null));
  const linkS = String(pairS?.links?.[0] || "");
  if (!linkS) {
    check("35. the desk: Studio paired", false, "no pairing link: this machine is on no network");
    endTree(/** @type {number} */ (S.pid));
    return;
  }
  const atS = new URL(linkS).origin;
  const kept = idS.toLowerCase();

  // The app, paired with Studio from its Add sheet.
  const dataD = join(base, "d");
  const portD = await freePort();
  const debugD = await freePort();
  writeConfig(dataD, portD, up.url, root);
  mkdirSync(join(dataD, "desktop"), { recursive: true });
  writeFileSync(join(dataD, "desktop", "settings.json"), JSON.stringify({ notify: false }));
  const D = launch(dataD, { debug: debugD, label: "app at the desk" });
  const harnessD = await until(async () => (await pagesOf(debugD)).find((p) => p.url.startsWith(`http://127.0.0.1:${portD}/ui/harness.html`)), 60000, "the desk's harness");
  await until(() => evalIn(harnessD, `!!document.querySelector(".app-shell")`), 30000, "the desk's harness drawn");
  /** An expression in the desk's page, null where it threw. @param {string} js */
  const inD = (js) => evalIn(harnessD, js).catch(() => null);
  // A first start's welcome tour and tips, skipped as a person would: over the chat's column, each hides what shows in
  // place.
  /** @param {string} words @param {number} ms */
  const skipped = async (words, ms) => {
    const b = `[...document.querySelectorAll("button, [role=button], a")].find((b) => b.textContent.trim() === ${JSON.stringify(words)})`;
    await until(() => inD(`!!${b} || null`), ms, words).catch(() => null);
    await inD(`(${b}?.click(), true)`);
    await until(() => inD(`!${b} || null`), 5000, `${words} pressed`).catch(() => null);
  };
  await skipped("Skip for now", 10000);
  await skipped("Skip tips", 5000);
  await inD(`(window.filamentApp.addMachine(), true)`);
  const railD = await until(async () => (await pagesOf(debugD)).find((p) => p.url.endsWith("/desktop/rail.html")), 20000, "the app's page for the sheet");
  /** @param {string} js */
  const inRail = (js) => evalIn(railD, js).catch(() => null);
  await until(() => inRail(`document.body.classList.contains("adding") || null`), 10000, "the Add sheet open");
  await inRail(`(() => { const l = document.getElementById("add-link"); l.value = ${JSON.stringify(linkS)}; l.dispatchEvent(new Event("input")); document.getElementById("add-go").click(); return true })()`);
  await until(() => inRail(`!document.getElementById("add-who").hidden || null`), 20000, "who answers, in the sheet");
  await inRail(`(document.getElementById("add-go").click(), true)`);
  const rowsOf = () => inRail(`({ adding: document.body.classList.contains("adding"), pop: document.body.classList.contains("pop"), rows: [...document.querySelectorAll(".row")].map((r) => r.querySelector("[data-machine]").dataset.machine + ":" + [...r.classList].filter((c) => c.startsWith("s-") || c === "on").join("+")) })`);
  const paired = /** @type {any} */ (await until(async () => {
    const r = /** @type {any} */ (await rowsOf());
    return r && !r.adding && r.rows.includes(`${kept}:s-online+on`) ? r : null;
  }, 30000, "Studio kept, shown").catch(() => rowsOf()));
  // Studio shown whole once paired: This computer picked from its chip, as check 32 does.
  const whole = await until(async () => (await pagesOf(debugD)).find((p) => p.url.startsWith(`${atS}/ui/harness.html`) && !p.url.includes("only=chat")), 30000, "Studio's page").catch(() => null);
  if (whole) await until(() => evalIn(whole, `!!document.querySelector(".hdr-machine:not(.hidden)") || null`), 30000, "Studio's chip").catch(() => null);
  if (whole) await evalIn(whole, `(document.querySelector(".hdr-machine").click(), true)`).catch(() => null);
  await until(() => inRail(`document.body.classList.contains("pop") || null`), 10000, "the popover").catch(() => null);
  await inRail(`(document.querySelector('[data-machine="local"]').click(), true)`);
  const home = await until(() => inRail(`!document.body.classList.contains("pop") || null`), 10000, "this computer again").catch(() => false);
  check("35. the desk: Studio paired as a Full device from the Add sheet, this computer shown again", !!paired?.rows?.includes(`${kept}:s-online+on`) && home === true, `${(paired?.rows || []).join(", ") || "no machines"}`);

  // Studio's chats: one that answered, one whose command waits for a yes (Ask mode, as check 25's), and Run on's, whose
  // turn writes a file.
  const own = join(root, "studio-own");
  mkdirSync(own, { recursive: true });
  brain = (c) => {
    if (c.kind !== "anthropic") return undefined;
    const last = c.body?.messages?.at(-1);
    // A tool's result: the turn ends in the default words.
    if (Array.isArray(last?.content) && last.content.some((/** @type {any} */ b) => b?.type === "tool_result")) return undefined;
    const said = JSON.stringify(last ?? "");
    if (said.includes("DESK-ASK")) return anthropicReply("", { model: "claude-sonnet-5-5", stop: "tool_use", blocks: [{ type: "tool_use", id: "da1", name: "bash", input: { command: "echo desk > desk-ask.txt" } }] });
    if (said.includes("write from-studio.txt")) return anthropicReply("", { model: "claude-sonnet-5-5", stop: "tool_use", blocks: [{ type: "tool_use", id: "ws1", name: "write", input: { path: "from-studio.txt", content: "made on Studio\n" } }] });
    return undefined;
  };
  /** A chat on Studio with one turn, its id. @param {string} content @param {any} [settings] */
  const chatOn = async (content, settings) => {
    const made = await call(portS, "/api/sessions", { cwd: own, model: "claude-sonnet-5-5", preset: "plain", ...(settings ? { settings } : {}) });
    const id = String((await made.json()).id);
    await (await call(portS, `/api/sessions/${encodeURIComponent(id)}/turns`, { content, stream: false })).text();
    return id;
  };
  const doneS = await chatOn("DESK-HELLO");
  const askS = await chatOn("DESK-ASK", { loop: { permissions: "ask" } });

  // Every machine in one list: the one that asks in Now's Needs you, the one that answered (seen: no row of Now's) under
  // Projects, Studio's name on each.
  const nowOpen = `(() => { const h = document.querySelector("button.lb-sec.now-head"); if (h && h.getAttribute("aria-expanded") !== "true") h.click(); return true })()`;
  const key = (/** @type {string} */ id) => `[data-machine="${kept}"][data-key="m:${kept}/chat:${id}"]`;
  const nowSel = (/** @type {string} */ id) => `.now-row.is-there${key(id)}`;
  const listSel = (/** @type {string} */ id) => `.sess-row.desk-row${key(id)}`;
  const rowsNow = () =>
    inD(`(() => { ${nowOpen}; const of = (s, name) => { const e = document.querySelector(s); return e ? { cls: [...e.classList].filter((c) => c.startsWith("is-")).join(" "), machine: e.querySelector(name)?.textContent || "" } : null }; return { done: of(${JSON.stringify(listSel(doneS))}, ".row-where-text"), ask: of(${JSON.stringify(nowSel(askS))}, ".now-machine-name") } })()`);
  const now34 = /** @type {any} */ (await until(async () => {
    const r = /** @type {any} */ (await rowsNow());
    return r?.done && r?.ask ? r : null;
  }, 90000, "Studio's chats in the left bar").catch(() => rowsNow()));
  await picture(harnessD, "35-now");
  check(
    "35. every machine in one list: Studio's chat that asks in Now's Needs you, the one that answered under Projects, its name on each",
    !!now34?.done && !!now34?.ask && now34.done.machine === "Studio" && now34.ask.machine === "Studio" && /\bis-needs\b/.test(now34.ask.cls),
    `answered: ${now34?.done ? `under Projects, "${now34.done.machine}"` : "no row"}; asking: ${now34?.ask ? `${now34.ask.cls}, "${now34.ask.machine}"` : "no row"}`,
  );

  // One pressed: Studio's own page of the chat in place, this computer's left bar beside it, the row marked.
  const rowSel = listSel;
  await inD(`(document.querySelector(${JSON.stringify(rowSel(doneS))}).click(), true)`);
  const hashS = `#/task/${encodeURIComponent(doneS)}`;
  const inPlaceOf = async () => (await pagesOf(debugD)).find((p) => p.url.startsWith(`${atS}/ui/harness.html?only=chat`) && p.url.endsWith(hashS)) ?? null;
  const place34 = await until(inPlaceOf, 20000, "Studio's chat in place").catch(() => null);
  const drawn34 = place34 ? await until(() => evalIn(place34, `!!document.querySelector(".app-shell.chat-only") || null`), 20000, "its page drawn").catch(() => false) : false;
  // What takes the view from sight, named where it is out (lib/desk-guest.js `GUEST_COVERS`, a screen, a tip's shade).
  const covers = `[...document.querySelectorAll(".zc-menu, .zc-popover, .zc-dialog-overlay, .zc-sheet, [role='menu'], [role='dialog'], [role='listbox'], .main-frame.screen-on, .coach-dim")].filter((e) => !document.querySelector(".content-col").contains(e) || e.matches(".main-frame")).map((e) => e.tagName.toLowerCase() + "." + [...e.classList].join(".") + (e.getAttribute("aria-label") ? "[" + e.getAttribute("aria-label") + "]" : "")).join(" ")`;
  const sight = () => inD(`({ up: !!document.querySelector(".app-shell.guest-up"), inert: !!document.querySelector(".content-col")?.inert, marked: !!document.querySelector(${JSON.stringify(`${rowSel(doneS)}.current`)}), cc: !!document.querySelector(".zc-dialog.is-cc"), covers: ${covers} })`);
  const shown34 = /** @type {any} */ (await until(async () => {
    const s = /** @type {any} */ (await sight());
    return s?.up && s.inert ? s : null;
  }, 10000, "the view in sight").catch(() => sight()));
  await picture(harnessD, "35-in-place");
  await picture(place34, "35-in-place-view");
  check(
    "35. a press on Studio's chat: its own page of the chat in place, beside this computer's left bar, its row marked",
    !!place34 && drawn34 === true && shown34?.up === true && shown34.inert === true && shown34.marked === true,
    `${place34 ? `in place at ${place34.url.replace(atS, "")}${drawn34 ? "" : ", not drawn"}` : "no view"}; ${shown34 ? `in sight ${shown34.up && shown34.inert}${shown34.covers ? ` (over it: ${shown34.covers})` : ""}, row ${shown34.marked ? "marked" : "not marked"}` : "?"}`,
  );
  // This computer's Ctrl+K over it: the view out of sight while it is open, in sight again once it closes.
  await inD(`(window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true })), true)`);
  const over34 = /** @type {any} */ (await until(async () => {
    const s = /** @type {any} */ (await sight());
    return s?.cc && s.up && !s.inert ? s : null;
  }, 10000, "Ctrl+K over it").catch(() => sight()));
  await picture(harnessD, "35-ctrl-k-over");
  await inD(`(document.querySelector(".zc-dialog-overlay .zc-dialog-x")?.click(), true)`);
  const back34 = /** @type {any} */ (await until(async () => {
    const s = /** @type {any} */ (await sight());
    return s && !s.cc && s.up && s.inert ? s : null;
  }, 10000, "the view in sight again").catch(() => sight()));
  check(
    "35. this computer's Ctrl+K over the chat in place: the view out of sight while it is open, in sight again once it closes",
    over34?.cc === true && over34.inert === false && back34?.cc === false && back34.inert === true && !!(await inPlaceOf()),
    `open: ${over34 ? `Ctrl+K ${over34.cc ? "up" : "not up"}, view ${over34.inert ? "still in sight" : "out of sight"}` : "?"}; closed: ${back34 ? `view ${back34.inert ? "in sight" : `out of sight${back34.covers ? ` (over it: ${back34.covers})` : ""}`}` : "?"}`,
  );

  // Its ask answered from Needs you: the question and the command on the card, Allow runs it there, the window stays.
  const askSel = `.desk-ask[data-key^="ask:${kept}/${askS}/"]`;
  const card34 = /** @type {any} */ (await until(
    () => inD(`(() => { ${nowOpen}; const c = document.querySelector(${JSON.stringify(askSel)}); return c ? { q: c.querySelector(".desk-ask-q")?.textContent || "", cmd: c.querySelector(".desk-ask-cmd")?.textContent || "", go: c.querySelector(".desk-ask-btn.is-go")?.textContent || "" } : null })()`),
    30000,
    "Studio's ask in Needs you",
  ).catch(() => null));
  await picture(harnessD, "35-ask");
  await inD(`(document.querySelector(${JSON.stringify(`${askSel} .desk-ask-btn.is-go`)})?.click(), true)`);
  const asksOf = async () => /** @type {any} */ (await (await call(portS, `/api/sessions/${encodeURIComponent(askS)}/asks`)).json().catch(() => null));
  const ran34 = await until(async () => ((await asksOf())?.asks?.length === 0 && existsSync(join(own, "desk-ask.txt")) ? true : null), 30000, "the command run on Studio").catch(() => false);
  const refused34 = String((await inD(`document.querySelector(${JSON.stringify(`${askSel} .desk-ask-said`)})?.textContent || ""`)) ?? "");
  const stayed34 = !!(await inPlaceOf());
  check(
    "35. Studio's ask answered from Needs you: its question and command on the card, Allow runs it there, the chat in place stays",
    /^May I run this command\?/.test(String(card34?.q)) && /echo desk > desk-ask\.txt/.test(card34.cmd) && ran34 === true && !refused34 && stayed34,
    `${card34 ? `"${card34.q.slice(0, 40)}…" ${card34.cmd.trim()} [${card34.go}]` : "no card"}; ${ran34 === true ? "run there" : refused34 || "not run there"}; ${stayed34 ? "the view where it was" : "the view moved"}`,
  );

  // Run on: a project here (a repository with no remote, so Studio has no clone and a copy goes), this Filament's
  // agents' device on Studio (Settings' Agents, which holds Run on), a new chat started there from the Start's chip.
  const repo = join(root, "widgets");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "README.md"), "# widgets\n");
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=Drive", "-c", "user.email=drive@example.invalid", "commit", "-q", "-m", "widgets");
  const head34 = git("rev-parse", "HEAD");
  const agents34 = /** @type {any} */ (await inD(`window.filamentApp.agentsOn(${JSON.stringify(kept)}, true)`));
  await inD(`(document.querySelector(".sess-new").click(), true)`);
  const start34 = await until(() => inD(`(!!document.querySelector(".empty-chat") && !document.querySelector(".app-shell.guest-up")) || null`), 10000, "a new chat's Start, the view gone").catch(() => false);
  /** A dialog's foot button pressed by its words. @param {string} dialog @param {string} label */
  const pressIn = (dialog, label) =>
    inD(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${dialog} .zc-dialog-foot button`)})].find((x) => (x.querySelector(".zc-btn-label")?.textContent || x.textContent).trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`);
  await inD(`(document.querySelector(".empty-chat .chooser-chip:not(.run-on-chip)").click(), true)`);
  await until(() => inD(`!!document.querySelector('.zc-menu .zc-menu-item[data-key="open"]') || null`), 5000, "the project menu").catch(() => null);
  await inD(`(document.querySelector('.zc-menu .zc-menu-item[data-key="open"]').click(), true)`);
  const openSel = `.zc-dialog[aria-label="Open folder"]`;
  await until(() => inD(`!!document.querySelector(${JSON.stringify(`${openSel} input.zc-input`)}) || null`), 5000, "Open folder").catch(() => null);
  await inD(`(() => { const i = document.querySelector(${JSON.stringify(`${openSel} input.zc-input`)}); i.value = ${JSON.stringify(repo)}; i.dispatchEvent(new Event("input", { bubbles: true })); return true })()`);
  await pressIn(openSel, "Open");
  await until(() => inD(`!!document.querySelector(".run-on-chip") || null`), 10000, "the Run on chip").catch(() => null);
  await inD(`(document.querySelector(".run-on-chip").click(), true)`);
  const studioItem = `.zc-menu .zc-menu-item[data-key="m:${idS}"]:not([disabled])`;
  await until(() => inD(`!!document.querySelector(${JSON.stringify(studioItem)}) || null`), 20000, "Studio in the chip's menu").catch(() => null);
  await inD(`(document.querySelector(${JSON.stringify(studioItem)})?.click(), true)`);
  const chip34 = String((await inD(`document.querySelector(".run-on-chip .chooser-label")?.textContent || ""`)) ?? "");
  await picture(harnessD, "35-run-on-start");
  await inD(`(() => { const b = document.querySelector(".composer-input"); b.value = "write from-studio.txt"; b.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector('button.send[aria-label="Send"]').click(); return true })()`);
  const sendSel = `.zc-dialog[aria-label="Send widgets to Studio?"]`;
  const asked34 = await until(() => inD(`!!document.querySelector(${JSON.stringify(sendSel)}) || null`), 30000, "Send widgets to Studio?").catch(() => false);
  await picture(harnessD, "35-run-on-send");
  await pressIn(sendSel, "Send");
  const worksOf = async () => /** @type {any[]} */ ((await (await call(portD, "/api/remote-work")).json().catch(() => null))?.works || []);
  const work34 = /** @type {any} */ (await until(async () => (await worksOf()).find((w) => w.chat && w.cwd) ?? null, 60000, "Run on's chat started on Studio").catch(() => null));
  const runOnPlace = work34 ? await until(async () => (await pagesOf(debugD)).find((p) => p.url.startsWith(`${atS}/ui/harness.html?only=chat`) && p.url.endsWith(`#/task/${encodeURIComponent(String(work34.chat))}`)), 20000, "Run on's chat in place").catch(() => null) : null;
  const wrote34 = work34 ? await until(() => existsSync(join(String(work34.cwd), "from-studio.txt")) || null, 30000, "the file written in Studio's copy").catch(() => false) : false;
  check(
    "35. Run on: Agents on for Studio, Studio picked on the Start's chip, the copy asked first, the chat started there in place, its turn writing in the copy",
    agents34?.on === true && start34 === true && chip34 === "Studio" && asked34 === true && !!work34 && !!runOnPlace && wrote34 === true,
    `agents ${agents34?.on === true ? "on" : JSON.stringify(agents34)}; Start ${start34 === true ? "up" : "not up"}; chip "${chip34}"; ${asked34 === true ? "asked" : "not asked"}; ${work34 ? `chat ${work34.state}` : "no chat there"}; ${runOnPlace ? "in place" : "not in place"}; ${wrote34 === true ? "written there" : "nothing written there"}`,
  );

  // Bring back: the card (or the project's pill) says what changed there; its dialog lists the file; it comes in as an
  // uncommitted edit, HEAD and the index as they were.
  const backSel = `.desk-back .desk-ask-btn.is-go, .desk-back-pill`;
  const offer34 = await until(() => inD(`(() => { ${nowOpen}; const b = document.querySelector(${JSON.stringify(backSel)}); return b ? (b.closest(".desk-back")?.querySelector(".desk-ask-q")?.textContent || b.getAttribute("aria-label") || b.textContent) : null })()`), 150000, "Bring back offered").catch(() => null);
  await picture(harnessD, "35-bring-back-offered");
  await inD(`(document.querySelector(${JSON.stringify(backSel)})?.click(), true)`);
  const backDialog = `.zc-dialog[aria-label="Bring back 1 file from Studio?"]`;
  const files34 = /** @type {any} */ (await until(() => inD(`(() => { const d = document.querySelector(${JSON.stringify(backDialog)}); return d ? [...d.querySelectorAll("ul.desk-work-files li .desk-work-path")].map((x) => x.textContent) : null })()`), 30000, "the Bring back dialog").catch(() => null));
  await picture(harnessD, "35-bring-back-dialog");
  await pressIn(backDialog, "Bring back");
  const came34 = await until(() => existsSync(join(repo, "from-studio.txt")) || null, 30000, "the file here").catch(() => false);
  const toast34 = String((await until(() => inD(`[...document.querySelectorAll(".zc-toast-stack .zc-toast")].map((t) => t.textContent).find((t) => /came back from Studio/.test(t)) || null`), 10000, "its toast").catch(() => "")) ?? "");
  const status34 = git("status", "--porcelain");
  const staged34 = git("diff", "--cached", "--name-only");
  // Its words as written there; its line ends as git here writes a file (core.autocrlf).
  const content34 = came34 === true ? readFileSync(join(repo, "from-studio.txt"), "utf8").replace(/\r\n/g, "\n") : "";
  const headKept34 = git("rev-parse", "HEAD") === head34;
  check(
    "35. Bring back: offered once its turn ended, the file listed, brought in as an uncommitted edit — HEAD and the index as they were",
    !!offer34 && Array.isArray(files34) && files34.includes("from-studio.txt") && came34 === true && content34 === "made on Studio\n" && headKept34 && staged34 === "" && /^\?\? from-studio\.txt$/m.test(status34) && !!toast34,
    `${offer34 ? `"${String(offer34).trim()}"` : "never offered"}; dialog: ${Array.isArray(files34) ? files34.join(", ") || "no files" : "none"}; ${came34 === true ? `here: ${JSON.stringify(content34)}` : "not here"}; HEAD ${headKept34 ? "kept" : "moved"}; status: ${status34.replace(/\n/g, ", ") || "clean"}${staged34 ? `; staged: ${staged34}` : ""}${toast34 ? `; "${toast34.trim()}"` : ""}`,
  );
  if (!offer34) console.log(`     Run on's records here: ${JSON.stringify(await worksOf())}`);

  brain = null;
  const QD = launch(dataD, { args: ["--quit"], label: "quit the app at the desk" });
  await until(() => QD.exited(), 20000, "end of its quitting launch");
  await until(() => D.exited(), 30000, "the app at the desk's end");
  endTree(/** @type {number} */ (S.pid));
}

// ---- 36: the windows' owner session (the plan's s0e) ------------------------------------------------------------------
/**
 * The app's windows call Filament as its owner, by the session the app adds to their calls to Filament's own origin
 * alone: none of their calls is counted as one without the key (their user agent among the programs Filament counted),
 * and a server at another port of this computer's address — one an agent runs — gets no session from them, as a header
 * or a cookie, by a call or an image.
 * @param {number} port @param {string} dataDir @param {{ webSocketDebuggerUrl: string }} page
 */
async function ownerSessionCheck(port, dataDir, page) {
  /** @type {import("node:http").IncomingHttpHeaders[]} */
  const heard = [];
  const other = createServer((req, res) => {
    heard.push(req.headers);
    res.end("x");
  });
  await new Promise((r) => other.listen(0, "127.0.0.1", () => r(undefined)));
  const at = /** @type {any} */ (other.address()).port;
  const agent = String((await evalIn(page, "navigator.userAgent").catch(() => "")) || "").trim().slice(0, 120);
  const own = await evalIn(page, `fetch("/api/state", { headers: { "x-filament-ui": "1" } }).then((r) => r.status)`).catch(() => 0);
  await evalIn(page, `(fetch("http://127.0.0.1:${at}/probe", { mode: "no-cors" }).catch(() => null), (new Image().src = "http://127.0.0.1:${at}/img.png"), true)`).catch(() => null);
  await until(() => heard.length >= 2, 10000, "the other port's two calls").catch(() => null);
  await new Promise((r) => other.close(() => r(undefined)));
  const said = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { "x-filament-ui": "1", [OWNER_HEADER]: ownerKeyOf(dataDir) }, signal: AbortSignal.timeout(3000) })
    .then((r) => r.json())
    .catch(() => null);
  const windows = /** @type {{ agent: string, count: number }[]} */ (said?.ownerless?.programs || []).filter((p) => p.agent === agent);
  const leaked = heard.filter((h) => h[OWNER_SESSION_HEADER] || /fos_/.test(String(h.cookie || "")));
  check(
    "36. the app's windows call Filament as its owner, by a session no other port of this computer's address gets",
    !!agent && own === 200 && !!said?.ownerless && windows.length === 0 && heard.length >= 2 && leaked.length === 0,
    `${windows.length ? `${windows[0].count} of the windows' calls counted without the key` : "none of the windows' calls counted without the key"}; another port heard ${heard.length} call(s)${leaked.length ? `, ${leaked.length} with a session` : ", none with a session"}`,
  );
}

/** `--owner`: check 36 alone, over an app of its own. */
async function driveOwner() {
  const dataO = join(base, "o");
  const portO = await freePort();
  const debugO = await freePort();
  writeConfig(dataO, portO, up.url, root);
  const O = launch(dataO, { debug: debugO, label: "the app (owner)" });
  await until(() => stateAt(portO), 60000, "answer from the app's Filament");
  const page = await until(async () => (await pagesOf(debugO)).find((p) => p.url.startsWith(`http://127.0.0.1:${portO}/ui/harness.html`)), 30000, "harness window");
  await until(() => evalIn(page, `!!document.querySelector(".app-shell")`), 30000, "harness drawn");
  await ownerSessionCheck(portO, dataO, page);
  const QO = launch(dataO, { args: ["--quit"], label: "quit the app (owner)" });
  await until(() => QO.exited(), 20000, "end of its quitting launch");
  await until(() => O.exited(), 30000, "the app's end");
}

// `--desk`: the desk's checks alone; `--owner`, the windows' owner session's.
if (OWNER_ONLY) {
  try {
    await driveOwner();
  } catch (/** @type {any} */ e) {
    check("the drive ran to its end", false, String(e?.message || e));
  } finally {
    await cleanUp();
  }
  finish();
}
if (DESK_ONLY) {
  try {
    await driveDesk();
  } catch (/** @type {any} */ e) {
    check("the drive ran to its end", false, String(e?.message || e));
  } finally {
    await cleanUp();
  }
  finish();
}

try {
  // ---- A: the app starts its own Filament, memory's engine under it ------------------------------------------------------
  const dataA = join(base, "a");
  let portA = await freePort();
  const debugA = await freePort();
  writeConfig(dataA, portA, up.url, root, { memory: true, failing: down.url });
  // The app's own choice, as a person's: notifications off — written to its log, never shown.
  mkdirSync(join(dataA, "desktop"), { recursive: true });
  writeFileSync(join(dataA, "desktop", "settings.json"), JSON.stringify({ notify: false }));
  const engineState = join(dataA, "fake-engine-state.json");
  writeFileSync(engineState, JSON.stringify({ memories: [], canonical: [], seq: 1 }));
  const engine = { FILAMENT_MEMORY_SIDECAR: JSON.stringify({ command: process.execPath, args: [FAKE_SIDECAR], env: { FAKE_SIDECAR_STATE: engineState } }) };
  let originA = `http://127.0.0.1:${portA}`;
  const A = launch(dataA, { debug: debugA, label: "app A", env: engine });
  await until(() => stateAt(portA), 60000, "answer from the app's Filament");
  const serverA = /** @type {number} */ (listener(portA));
  check("1. the app starts Filament in a child process", treeOf(A.pid).some((p) => p.pid === serverA) && serverA !== A.pid, `server pid ${serverA} under the app's ${A.pid}`);
  const engineA = await until(() => treeOf(serverA).find((p) => p.line.includes("fake-sidecar")), 30000, "memory's engine under Filament").catch(() => null);
  check("1. memory's engine runs under it", !!engineA, engineA ? `pid ${engineA.pid}` : "not found");
  const harnessA = await until(async () => (await pagesOf(debugA)).find((p) => p.url.startsWith(`${originA}/ui/harness.html`)), 30000, "harness window");
  const shell = await until(() => evalIn(harnessA, `!!document.querySelector(".app-shell")`), 30000, "harness drawn");
  check("1. its window shows the harness", shell === true, harnessA.url);
  await ownerSessionCheck(portA, dataA, harnessA);
  const stateA = await stateAt(portA);
  check("1. Filament says the app starts it again", stateA?.supervisor === "desktop", `supervisor: ${stateA?.supervisor}`);

  // 2. A turn with the fake model, through the app's server.
  const made = await call(portA, "/api/sessions", { cwd: root, model: "claude-sonnet-5-5", preset: "plain" });
  const sid = String((await made.json()).id);
  const turn = await call(portA, `/api/sessions/${sid}/turns`, { content: "build the parser", stream: true });
  const reply = await turn.text();
  check("2. a turn goes through the app's Filament", turn.status === 200 && reply.includes("The parser is built.") && up.received.some((c) => c.kind === "anthropic"), `HTTP ${turn.status}`);

  if (BUILT) {
    // 11. The packaged app keeps no archive: Filament, the memory engine's Python, its docs are plain files in the app's
    // folder, and Filament runs from there under the app's own runtime; node-pty's native module loads under it (a
    // terminal opens its shell, then is closed).
    const app11 = join(dirname(BUILT), "resources", "app");
    const missing11 = ["bin/filament.js", "src/server.js", "sidecar/mnemosyne_sidecar.py", "docs/GUIDE.md", "desktop/card-preload.cjs", "tray/filament.ico", "node_modules/node-pty/package.json"].filter((f) => !existsSync(join(app11, f)));
    const archive11 = existsSync(join(dirname(BUILT), "resources", "app.asar"));
    const runtime11 = (processes().find((p) => p.pid === serverA)?.line || "").toLowerCase().includes(BUILT.toLowerCase());
    const doc11 = await fetch(`${originA}/docs/GUIDE.md`)
      .then(async (r) => r.ok && (await r.text()) === readFileSync(join(app11, "docs", "GUIDE.md"), "utf8"))
      .catch(() => false);
    // A terminal opened is a press (r-doors, 11-12): asked from the app's own page, with the key its bridge hands it
    // there — the key never leaves the page.
    const open11 = `(async () => { const r = await fetch("/api/terminal", { method: "POST", headers: { "content-type": "application/json", "x-filament-ui": "1", "x-filament-press": await filamentApp.pressKey() }, body: ${JSON.stringify(JSON.stringify({ cwd: root, cols: 80, rows: 24 }))} }); return { status: r.status, json: await r.json().catch(() => ({})) }; })()`;
    const term11 = /** @type {{ status: number, json: any }} */ ((await evalIn(harnessA, open11).catch(() => null)) || { status: 0, json: {} });
    const made11 = term11.json;
    const id11 = made11?.terminal?.id;
    const shell11 = id11 ? await until(() => treeOf(serverA).find((p) => /^powershell\.exe$/i.test(p.name)), 15000, "the terminal's shell").catch(() => null) : null;
    if (id11) await call(portA, `/api/terminal/${id11}/kill`, {});
    check(
      "11. the packaged app keeps no archive: Filament, memory's Python and the docs are files there, run there; node-pty loads",
      !archive11 && missing11.length === 0 && runtime11 && doc11 === true && term11.status === 200 && !!shell11,
      `${archive11 ? "app.asar there; " : ""}${missing11.length ? `missing ${missing11.join(", ")}; ` : ""}Filament ${runtime11 ? "under the app's runtime" : "not under the app's runtime"}; docs ${doc11 ? "served" : "not served"}; terminal ${term11.status}${shell11 ? `, its shell ${shell11.pid}` : made11?.error ? `: ${made11.error}` : ", no shell"}`,
    );
    await until(() => !treeOf(serverA).some((p) => /^powershell\.exe$/i.test(p.name)), 10000, "the terminal's end").catch(() => null);
  } else {
    // 19. The card: a second launch with --card shows it — Filament's page in the card's own window, the bridge there alone.
    const C19 = launch(dataA, { args: ["--card"], label: "show the card" });
    await until(() => C19.exited(), 20000, "end of the --card launch");
    const cardA = await until(async () => (await pagesOf(debugA)).find((p) => p.url.startsWith(`${originA}/ui/tray-card.html`)), 20000, "the card's page");
    const card19 = await until(() => evalIn(cardA, `(() => { const p = document.querySelector(".tc-pill"); return p && document.querySelector(".tc-day") ? { pill: p.textContent, bridge: typeof window.filamentDesktop?.act, w: innerWidth, h: innerHeight } : null; })()`), 20000, "the card drawn").catch(async () => ({ pill: `not drawn: ${await evalIn(cardA, `document.visibilityState + " | " + document.body.innerText.replace(/\\s+/g, " ").slice(0, 300)`).catch((e) => e.message)}`, bridge: "", w: 0, h: 0 }));
    const bridgeInHarness = await evalIn(harnessA, "typeof window.filamentDesktop");
    // 420 × 600, but for a point: Windows 11 keeps one of a frameless window's for its border at some scales (419 wide at
    // 200 %, probed); without that frame the card loses its shadow and its rounded corners.
    const sized19 = Math.abs(card19.w - 420) <= 1 && Math.abs(card19.h - 600) <= 1;
    check("19. --card shows the card, on Now: Filament's page in its own window, the bridge there alone", card19.bridge === "function" && bridgeInHarness === "undefined" && sized19, `${card19.pill}; ${card19.w}×${card19.h}; in the harness: ${bridgeInHarness}`);

    // 20. The failover of check 2 raised an alert after the app started: one notification, once — written to the log (they
    // are off), and on the card. Its title is the alert's kind, as notes.js gives it since fa9a0374f (the notification
    // wears Filament's name and logo).
    const failoverSaid = /not shown \(notifications are off\): Failover — a request was served by anthropic after 1 failover/;
    const said20 = await until(() => failoverSaid.test(appLog(dataA)), 15000, "the failover's alert in the app's log").catch(() => false);
    await sleep(6000);
    const times20 = (appLog(dataA).match(/: Failover —/g) || []).length;
    await evalIn(cardA, `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Today")?.click(); true`).catch(() => null);
    const onCard20 = await until(() => evalIn(cardA, `(document.querySelector(".tc-alerts")?.textContent || "").includes("served by anthropic")`), 10000, "the alert on the card's Today").catch(() => false);
    check("20. an alert raised after the app started: one notification, once, written as they are off; on the card too", said20 === true && times20 === 1 && onCard20 === true, `${times20} in the log`);

    // 21. The card's Restart: Filament started again by the app, said as it takes it and once it is back, the card running again.
    const before21 = listener(portA);
    await evalIn(cardA, `[...document.querySelectorAll(".inst-btn")].find((b) => b.textContent.includes("Restart")).click(); true`);
    const server21 = await until(
      async () => {
        const pid = listener(portA);
        return pid && pid !== before21 && (await stateAt(portA)) ? pid : null;
      },
      45000,
      "Filament after the card's Restart",
    );
    const said21 = await until(() => /not shown \(notifications are off\): Restarting Filament — Nothing in flight/.test(appLog(dataA)) && /not shown \(notifications are off\): Filament is back — Filament \S+ runs again on port \d+\./.test(appLog(dataA)), 15000, "the restart's notifications").catch(() => false);
    const running21 = await until(() => evalIn(cardA, `document.querySelector(".tc-pill")?.textContent === "Running"`), 20000, "the card running again").catch(() => false);
    check("21. the card's Restart: Filament started again, its two notifications, the card running again", !!server21 && treeOf(A.pid).some((p) => p.pid === server21) && said21 === true && running21 === true, `pid ${server21}`);

    // 22. The card opened while Filament gives none: the app's own page, in the card's look; Filament's card at its answer.
    // Its window closed first; Filament ended at once after an answer, so the five seconds' gap is still to run.
    await evalIn(cardA, "window.close(); true").catch(() => null);
    await until(async () => !(await pagesOf(debugA)).some((p) => p.url.includes("tray-card")), 10000, "the card's window closed");
    if (!treeOf(A.pid).some((p) => p.pid === server21)) throw new Error(`pid ${server21} is not the app's: not ended`);
    process.kill(server21);
    const fresh22 = await until(
      async () => {
        const pid = listener(portA);
        return pid && pid !== server21 && (await stateAt(portA)) ? pid : null;
      },
      45000,
      "Filament started again",
    );
    if (!treeOf(A.pid).some((p) => p.pid === fresh22)) throw new Error(`pid ${fresh22} is not the app's: not ended`);
    process.kill(fresh22);
    await until(async () => !(await stateAt(portA)), 3000, "the server's end").catch(() => null);
    const C22 = launch(dataA, { args: ["--card"], label: "the card while Filament is down" });
    await until(() => C22.exited(), 20000, "end of that --card launch");
    const down22 = await until(async () => (await pagesOf(debugA)).find((p) => p.url.startsWith("data:text/html")), 10000, "the app's own page in the card").catch(() => null);
    const words22 = down22 ? String(await evalIn(down22, "document.body.innerText").catch(() => "")) : "";
    const back22 = await until(async () => (await pagesOf(debugA)).find((p) => p.url.startsWith(`${originA}/ui/tray-card.html`)), 45000, "the card again at Filament's answer").catch(() => null);
    check("22. the card shown while Filament gives none: the app's own page, then Filament's card at its answer", !!down22 && /Filament is (re)?starting/.test(words22) && !!back22, words22.replace(/\s+/g, " ").slice(0, 90));
    await until(() => stateAt(portA), 45000, "Filament after check 22");
    // The card put away: the checks that follow count the app's other windows.
    if (back22) await evalIn(back22, "window.close(); true").catch(() => null);
    await until(async () => !(await pagesOf(debugA)).some((p) => p.url.includes("tray-card")), 10000, "the card's window closed again");

    // 25. A chat that comes to need you (a command that writes, in Ask mode, which this computer's caller sets without
    // the app's key where Edit would be a press): the app tells it (written: notifications are off), the card's Now lists
    // it first, and its row opens that chat in the harness's window without loading the page again. Then a "no" lets
    // the turn end, as the checks after it want nothing running.
    brain = (c) => (c.kind === "anthropic" && JSON.stringify(c.body?.messages?.at(-1) ?? "").includes("write one.txt") ? anthropicReply("", { model: "claude-sonnet-5-5", stop: "tool_use", blocks: [{ type: "tool_use", id: "w1", name: "bash", input: { command: "echo one > one.txt" } }] }) : undefined);
    const made25 = await call(portA, "/api/sessions", { cwd: root, model: "claude-sonnet-5-5", preset: "plain", settings: { loop: { permissions: "ask" } } });
    const sid25 = String((await made25.json()).id);
    const asked25 = await call(portA, `/api/sessions/${encodeURIComponent(sid25)}/turns`, { content: "write one.txt", stream: false });
    await asked25.text();
    const runsOf25 = async () => /** @type {any[]} */ (((await (await call(portA, "/api/runs?limit=50")).json()).runs || []).filter((/** @type {any} */ r) => r.meta?.chain === sid25));
    const paused25 = await until(async () => (await runsOf25()).some((r) => r.status === "paused"), 15000, "the turn waiting for a yes").catch(() => false);
    const told25 = await until(() => /not shown \(notifications are off\): .+ — Waits for your yes\./.test(appLog(dataA)), 30000, "the app's word on the chat").catch(() => false);
    const C25 = launch(dataA, { args: ["--card"], label: "the card, a chat waiting" });
    await until(() => C25.exited(), 20000, "end of that --card launch");
    const card25 = await until(async () => (await pagesOf(debugA)).find((p) => p.url.startsWith(`${originA}/ui/tray-card.html`)), 20000, "the card's page");
    await evalIn(card25, `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Now")?.click(); true`).catch(() => null);
    const row25 = await until(() => evalIn(card25, `(() => { const r = document.querySelector(".now-row.is-needs"); const p = document.querySelector(".tc-pill"); return r && p ? { row: r.textContent.replace(/\\s+/g, " "), pill: p.textContent } : null; })()`), 20000, "the chat on the card's Now").catch(() => null);
    const harness25 = (await pagesOf(debugA)).find((p) => p.url.startsWith(`${originA}/ui/harness.html`));
    if (harness25) await evalIn(harness25, "window.__drive25 = 1; true").catch(() => null);
    if (row25) await evalIn(card25, `document.querySelector(".now-row.is-needs").click(); true`).catch(() => null);
    const route25 = `#/task/${encodeURIComponent(sid25)}`;
    const opened25 = harness25 ? await until(() => evalIn(harness25, `location.hash === ${JSON.stringify(route25)} && window.__drive25 === 1`), 10000, "the chat in the harness").catch(() => false) : false;
    check(
      "25. a chat that needs you: told, first on the card's Now, its row opening that chat in the harness without a reload",
      paused25 === true && told25 === true && !!row25 && /waits for your yes/.test(row25.row) && row25.pill === "1 needs you" && opened25 === true,
      `${row25 ? `${row25.pill} · ${row25.row.slice(0, 70)}` : "no row on the card"}; ${opened25 ? `the harness at ${route25}` : "the harness not at the chat"}`,
    );
    await call(portA, `/api/sessions/${encodeURIComponent(sid25)}/turns`, { content: "no", stream: false }).then((r) => r.text()).catch(() => null);
    brain = null;
    await until(async () => (await runsOf25()).every((r) => r.status !== "paused" && r.status !== "running"), 30000, "the turn's end after the no").catch(() => null);
    await evalIn(card25, "window.close(); true").catch(() => null);
    await until(async () => !(await pagesOf(debugA)).some((p) => p.url.includes("tray-card")), 10000, "the card's window closed after check 25");

    // 10. The window stays on Filament's pages; Electron's files are the app's, under its data folder.
    await evalIn(harnessA, `location.href = "file:///C:/Windows/win.ini"; true`).catch(() => null);
    await sleep(800);
    const still = (await pagesOf(debugA)).find((p) => p.url.startsWith(originA));
    check("10. a window does not leave Filament's pages", !!still && !(await pagesOf(debugA)).some((p) => p.url.startsWith("file:")), still?.url || "no page");
    const profile = join(dataA, "desktop");
    const inProfile = existsSync(profile) ? readdirSync(profile) : [];
    // What Chromium holds while it runs ("Local State" and "Preferences" are written at its end).
    check("10. Electron's profile is under the data folder", ["lockfile", "Network", "Local Storage"].every((n) => inProfile.includes(n)), profile);

    // 13. A page opening an address outside with no press of the person's (a script's, as an artifact's could be): asked
    // first, never opened unbidden, the window where it was; a second ask while the question is up is dropped, never
    // stacked. (An editor's link takes the same road; not driven here, so no editor of yours opens.) The question stays
    // up until Quit.
    await evalIn(harnessA, `location.href = "https://example.invalid/away"; true`).catch(() => null);
    await evalIn(harnessA, `window.open("https://example.invalid/popup"); true`).catch(() => null);
    const asks = () => [(appLog(dataA).match(/an address in the browser with no press of the person's: asked first/g) || []).length, (appLog(dataA).match(/an address in the browser while a question was up: dropped/g) || []).length];
    const askedFirst = await until(() => asks()[0] === 1 && asks()[1] === 1, 10000, "the ask and the dropped one in the log").catch(() => false);
    const pages12 = await pagesOf(debugA);
    check("13. a page's open of an address outside, with no press: asked first, once, the window stays", askedFirst === true && pages12.length === 1 && pages12[0].url.startsWith(originA), `asked ${asks()[0]}, dropped ${asks()[1]}; ${pages12.length} page, at ${pages12[0]?.url}`);

    // 6. A second launch opens the first's window: no second app, no second server.
    const serving6 = listener(portA);
    const B6 = launch(dataA, { label: "second launch" });
    await until(() => B6.exited(), 20000, "end of the second launch");
    await sleep(500);
    const harnessPages = (await pagesOf(debugA)).filter((p) => p.url.startsWith(`${originA}/ui/harness.html`)).length;
    check("6. a second launch ends and opens the first's harness", B6.code() === 0 && listener(portA) === serving6 && harnessPages === 1, `exit ${B6.code()}, ${harnessPages} harness window`);

    // 3. Every window closed: Filament serves on; a launch brings the harness back.
    for (const p of await pagesOf(debugA)) await evalIn(p, "window.close(); true").catch(() => null);
    await until(async () => (await pagesOf(debugA)).length === 0, 10000, "windows closed");
    const serving = await stateAt(portA);
    const B3 = launch(dataA, { label: "reopen" });
    await until(() => B3.exited(), 20000, "end of the reopening launch");
    const back = await until(async () => (await pagesOf(debugA)).find((p) => p.url.startsWith(`${originA}/ui/harness.html`)), 20000, "harness again");
    check("3. every window closed, Filament still answers; a launch opens the harness again", !!serving && !!back && !A.exited());

    // 4. Restart, as the page's Restart button asks it: a new server, answering — not the one asked to stop (checks 21
    // and 22 have started others since check 1's), which answers a moment after it is asked.
    const before4 = listener(portA);
    const stop4 = await call(portA, "/api/shutdown", { ifIdle: true });
    const t4 = Date.now();
    const server4 = await until(
      async () => {
        const pid = listener(portA);
        return pid && pid !== before4 && (await stateAt(portA)) ? pid : null;
      },
      45000,
      "restarted Filament",
    );
    check("4. the page's Restart: the app starts Filament again", stop4.status === 200 && treeOf(A.pid).some((p) => p.pid === server4), `new pid ${server4} in ${((Date.now() - t4) / 1000).toFixed(1)} s`);

    // 5. The server ended from outside, at once after its start: started again, and not sooner than 5 s after that start.
    if (!treeOf(A.pid).some((p) => p.pid === server4)) throw new Error(`pid ${server4} is not the app's: not ended`);
    process.kill(server4);
    const server5 = await until(
      async () => {
        const pid = listener(portA);
        return pid && pid !== server4 && (await stateAt(portA)) ? pid : null;
      },
      45000,
      "Filament after its end",
    );
    const starts = startsIn(appLog(dataA));
    const gap = starts.length >= 2 ? starts[starts.length - 1] - starts[starts.length - 2] : 0;
    check("5. ended from outside, it is started again, the five seconds kept", gap >= 4950 && treeOf(A.pid).some((p) => p.pid === server5), `pid ${server5}, ${(gap / 1000).toFixed(2)} s between the two starts in the app's log`);

    // 18. Its window loads again (Ctrl+R, say) while nothing answers: Chromium's error page, which Electron says "finished
    // loading" too — the app loads the harness again at Filament's next answer. The server is ended at once after its first
    // answer, so the five seconds' gap is still to run: its PID from the app's own log line, written by the app this drive
    // started (no process list: it takes seconds).
    const pid18 = Number([...appLog(dataA).matchAll(/Filament's process: pid (\d+)/g)].at(-1)?.[1]);
    const page18 = (await pagesOf(debugA)).find((p) => p.url.startsWith(`${originA}/ui/harness.html`));
    let reloaded18 = false;
    if (pid18 === server5 && page18) {
      process.kill(pid18);
      await until(async () => !(await stateAt(portA)), 3000, "the server's end").catch(() => null);
      reloaded18 = !(await stateAt(portA)) && (await evalIn(page18, "location.reload(); true").catch(() => false)) === true;
    }
    const drawn18 = await until(
      async () => {
        const p = (await pagesOf(debugA)).find((x) => x.url.startsWith(`${originA}/ui/harness.html`));
        return p && (await evalIn(p, `!!document.querySelector(".app-shell")`).catch(() => false));
      },
      30000,
      "the harness drawn again",
    ).catch(() => false);
    check("18. a window that loaded while Filament was down: the harness again at its answer", reloaded18 && drawn18 === true, reloaded18 ? "reloaded while nothing answered" : `not reloaded in the gap (pid ${pid18}, server ${server5})`);
    await until(() => stateAt(portA), 45000, "Filament after check 18");

    // 14. The port changed in Settings, then Restart: the app follows Filament to it, its window too.
    const portA2 = await freePort();
    const moved = await call(portA, "/api/config/fields", { set: { "server.port": portA2 } }, "PATCH");
    const movedBody = await moved.json();
    await call(portA, "/api/shutdown", { ifIdle: true });
    const server13 = await until(async () => (listener(portA2) && (await stateAt(portA2)) ? listener(portA2) : null), 45000, "Filament on its new port");
    portA = portA2;
    originA = `http://127.0.0.1:${portA}`;
    const harness13 = await until(async () => (await pagesOf(debugA)).find((p) => p.url.startsWith(`${originA}/ui/harness.html`)), 20000, "the harness on the new port").catch(() => null);
    check("14. a port changed in Settings: after Restart Filament listens there, the app's window with it", movedBody.restartNeeded === true && !!server13 && treeOf(A.pid).some((p) => p.pid === server13) && !!harness13, `port ${portA2}, ${harness13?.url || "no window there"}`);
  }

  // 26. The agent's browser (HarnessV4_Browser_Plan BR5): a chat with the browser switched on, a model that browses a
  // page of this drive's own (a sign-in form on 127.0.0.1) — navigate, snapshot, type, click, a screenshot — in the
  // app's Chromium, which holds the page over Filament's socket. Then the chat in the harness's window, its Browser pane
  // opened from the panes' ⋯ as a person would: the page placed over the pane's stage, parked while a menu covers it
  // (its picture standing in), placed again. Then Take over: the agent's next call answered at once, in words. Then
  // HarnessV4_BrowserSize_Plan's proof (BS5): the page keeps its own size over the pane (27) and the agent's click lands
  // on it scaled; the agent's resize and the size chip (28); the veil while it drives, its Take over, the page back by
  // itself 5 s after the pointer is off it (29); the Browser popped out into a window of its own and brought back (30).
  const SHOP = `<!doctype html><title>Sign in · Drive shop</title><h1 id="h">Sign in</h1><label>Email <input id="e" aria-label="Email"></label><button id="b" onclick="document.title = 'Signed in as ' + document.getElementById('e').value; document.getElementById('h').textContent = document.title">Sign in</button><p><button id="c" onclick="window.n = (window.n || 0) + 1; this.textContent = 'Count ' + window.n">Count</button></p>`;
  const shop = createServer((_req, res) => (res.writeHead(200, { "content-type": "text/html; charset=utf-8" }), res.end(SHOP)));
  await new Promise((r) => shop.listen(0, "127.0.0.1", () => r(null)));
  const shopBase = `http://127.0.0.1:${/** @type {any} */ (shop.address()).port}`;
  try {
    /** A message's words, its tool results' too ([image] for a picture). @param {any} m */
    const wordsOf = (m) =>
      typeof m?.content === "string"
        ? m.content
        : (m?.content || []).map((/** @type {any} */ b) => (b.type === "text" ? b.text : b.type === "tool_result" ? (typeof b.content === "string" ? b.content : (b.content || []).map((/** @type {any} */ x) => (x.type === "text" ? x.text : `[${x.type}]`)).join("\n")) : "")).join("\n");
    /** The result the model was given for one call. @param {any[]} msgs @param {string} id */
    const resultOf = (msgs, id) => msgs.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === "tool_result" && b.tool_use_id === id);
    const use = (/** @type {string} */ id, /** @type {any} */ input) => anthropicReply("", { model: "claude-sonnet-5-5", stop: "tool_use", blocks: [{ type: "tool_use", id, name: "browser", input }] });
    /** @type {any[] | null} */
    let seen26 = null;
    brain = (c) => {
      if (c.kind !== "anthropic" || !Array.isArray(c.body?.tools) || !c.body.tools.some((/** @type {any} */ t) => t.name === "browser")) return undefined;
      const msgs = /** @type {any[]} */ (c.body.messages || []);
      // Where this turn's prompt stands: the newest user message that is words, not a tool's result.
      const at = msgs.findLastIndex((m) => m.role === "user" && !(Array.isArray(m.content) && m.content.some((/** @type {any} */ b) => b.type === "tool_result")));
      const asked = wordsOf(msgs[at]);
      const n = msgs.slice(at).filter((m) => m.role === "assistant").length;
      const all = msgs.map(wordsOf).join("\n");
      if (asked.includes("check the shop's sign-in")) {
        if (n === 0) return use("b1", { action: "navigate", url: `${shopBase}/login` });
        if (n === 1) return use("b2", { action: "snapshot" });
        if (n === 2) return use("b3", { action: "type", ref: /textbox "Email" \[(e\d+)\]/.exec(all)?.[1] || "e0", text: "ada@example.com" });
        if (n === 3) return use("b4", { action: "click", ref: /button "Sign in" \[(e\d+)\]/.exec(all)?.[1] || "e0" });
        if (n === 4) return use("b5", { action: "screenshot" });
        seen26 = msgs;
        return anthropicReply("Signed in as ada@example.com: the page says so.", { model: "claude-sonnet-5-5" });
      }
      if (asked.includes("look at the page again")) return n === 0 ? use("t1", { action: "snapshot" }) : anthropicReply("You have the browser; I wait.", { model: "claude-sonnet-5-5" });
      // The newest snapshot's handle for the Count button.
      const count = [...all.matchAll(/button "Count(?: \d+)?" \[(e\d+)\]/g)].at(-1)?.[1] || "e0";
      if (asked.includes("press the shop's count button")) {
        if (n === 0) return use("c1", { action: "snapshot" });
        if (n === 1) return use("c2", { action: "click", ref: count });
        return anthropicReply("Pressed it.", { model: "claude-sonnet-5-5" });
      }
      if (asked.includes("make the page a phone")) return n === 0 ? use("r1", { action: "resize", size: "phone" }) : anthropicReply("It is a phone now.", { model: "claude-sonnet-5-5" });
      if (asked.includes("press it while I watch")) {
        if (n === 0) return use("w1", { action: "click", ref: count });
        // The turn stays at work here while the drive takes the page by hand and it goes back by itself.
        if (n === 1) return held29.then(() => use("w2", { action: "snapshot" }));
        return anthropicReply("Seen.", { model: "claude-sonnet-5-5" });
      }
      return undefined;
    };
    /** @type {() => void} */
    let release29 = () => {};
    const held29 = new Promise((r) => (release29 = () => r(null)));
    const linked26 = await until(async () => (await (await call(portA, "/api/browser")).json()).available === true, 30000, "the app's browser on Filament's socket").catch(() => false);
    const made26 = await call(portA, "/api/sessions", { cwd: root, model: "claude-sonnet-5-5", preset: "plain", settings: { plugins: { browser: true } } });
    const sid26 = String((await made26.json()).id);
    const turn26 = await call(portA, `/api/sessions/${encodeURIComponent(sid26)}/turns`, { content: "check the shop's sign-in works", stream: false });
    const reply26 = await turn26.text();
    const msgs26 = /** @type {any[]} */ (seen26 || []);
    const went26 = wordsOf({ content: [resultOf(msgs26, "b1")].filter(Boolean) });
    const after26 = wordsOf({ content: [resultOf(msgs26, "b4")].filter(Boolean) });
    const picture26 = (resultOf(msgs26, "b5")?.content || []).some((/** @type {any} */ x) => x.type === "image" && /^image\//.test(x.source?.media_type || ""));
    const view26 = await until(async () => (await pagesOf(debugA)).find((p) => p.url.startsWith(shopBase)), 10000, "the agent's page among the app's").catch(() => null);
    const title26 = view26 ? await evalIn(view26, "document.title").catch(() => "") : "";
    check(
      "26. the agent browses a page in the app: navigate, snapshot, type, click, a screenshot — the page signed in, the model given its picture",
      linked26 === true && turn26.status === 200 && reply26.includes("Signed in as ada@example.com") && went26.includes("Drive shop") && after26.includes('heading "Signed in as ada@example.com"') && picture26 && title26 === "Signed in as ada@example.com",
      `${linked26 ? "linked" : "no link"}; HTTP ${turn26.status}; the page: ${title26 || "not found"}; picture ${picture26 ? "given" : "missing"}`,
    );

    // The pane: the chat shown, its Browser pane opened from the panes' ⋯.
    const harness26 = await until(async () => (await pagesOf(debugA)).find((p) => p.url.startsWith(`${originA}/ui/harness.html`)), 20000, "the harness's window");
    await evalIn(harness26, `location.hash = ${JSON.stringify(`#/task/${encodeURIComponent(sid26)}`)}; true`);
    await until(() => evalIn(harness26, `!!document.querySelector(".pbtn-more")`), 10000, "the panes' buttons");
    const opened26 = await until(
      () =>
        evalIn(
          harness26,
          `(async () => { if (document.querySelector(".brw-stage")) return true; document.querySelector(".pbtn-more").click(); await new Promise((r) => setTimeout(r, 300)); const row = [...document.querySelectorAll(".zc-menu-item")].find((r) => r.textContent.trim() === "Browser"); if (row) row.click(); await new Promise((r) => setTimeout(r, 300)); return !!document.querySelector(".brw-stage"); })()`,
        ),
      15000,
      "the Browser pane",
    ).catch(() => false);
    const stageOf = () => evalIn(harness26, `(() => { const s = document.querySelector(".brw-stage"); if (!s) return null; const r = s.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), address: document.querySelector(".brw-address")?.value || "", picture: !document.querySelector(".brw-picture")?.classList.contains("hidden"), chip: document.querySelector(".brw-size .zc-btn-label")?.textContent || "", line: document.querySelector(".brw-line")?.textContent || "" }; })()`);
    const sizeOf = async () => (view26 ? String(await evalIn(view26, "innerWidth + 'x' + innerHeight").catch(() => "")) : "");
    // Placed over a pane, the page is in a window that shows: its document visible; parked, in the hidden one.
    const shownOf = async () => (view26 ? String(await evalIn(view26, "document.visibilityState").catch(() => "")) : "");
    // (HarnessV4_BrowserSize_Plan BS1: the page keeps its own 1280 × 800 over the pane, whatever the stage's shape —
    // before it, it took the stage's size.)
    const placedAt = async () => (await sizeOf()) === "1280x800" && (await shownOf()) === "visible" && (await stageOf())?.picture === false;
    const placed26 = opened26 === true ? await until(placedAt, 10000, "the page over the pane's stage").catch(() => false) : false;
    const stage26 = await stageOf().catch(() => null);
    await picture(harness26, "26-harness-pane");
    await picture(view26, "26-the-page-own-size");
    // A menu of the harness's own over the stage (the panes' ⋯ again, at the window's right, where the pane is): the
    // page parks and its picture stands in; the menu closed, the page comes back.
    await evalIn(harness26, `document.querySelector(".pbtn-more").click(); true`).catch(() => null);
    const covered26 = await evalIn(harness26, `(() => { const m = document.querySelector(".zc-menu")?.getBoundingClientRect(); const s = document.querySelector(".brw-stage")?.getBoundingClientRect(); return !!m && !!s && m.left < s.right && s.left < m.right && m.top < s.bottom && s.top < m.bottom; })()`).catch(() => false);
    const parked26 = covered26 === true ? await until(async () => (await sizeOf()) === "1280x800" && (await stageOf())?.picture === true, 10000, "the page parked under the menu").catch(() => false) : null;
    await evalIn(harness26, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); true`).catch(() => null);
    await until(() => evalIn(harness26, `!document.querySelector(".zc-menu")`), 5000, "the menu closed").catch(() => null);
    const back26 = await until(placedAt, 10000, "the page over the stage again").catch(() => false);
    check(
      "26. its Browser pane: the page placed over the stage at its own 1280 × 800, parked while a menu covers it (its picture standing in), placed again",
      placed26 === true && parked26 !== false && back26 === true && stage26?.address === `${shopBase}/login` && stage26?.chip === "1280 × 800",
      `stage ${stage26 ? `${stage26.w}×${stage26.h}` : "none"}, the page ${await sizeOf()} (${await shownOf()}); ${parked26 === null ? "the menu missed the stage, parking not seen" : parked26 ? "parked under the menu" : "not parked under the menu"}`,
    );

    // Take over: the agent's next call is answered at once, in words; the pane says who has it. Given back after.
    const take26 = await call(portA, `/api/sessions/${encodeURIComponent(sid26)}/browser`, { act: "take" });
    const t26 = Date.now();
    const turnB26 = await call(portA, `/api/sessions/${encodeURIComponent(sid26)}/turns`, { content: "look at the page again", stream: false });
    await turnB26.text();
    const tookMs26 = Date.now() - t26;
    const refusedWords26 = /** @type {any[]} */ (up.received.filter((c) => c.kind === "anthropic").map((c) => c.body?.messages || []).reverse().find((m) => resultOf(m, "t1")) || []);
    const refused26 = wordsOf({ content: [resultOf(refusedWords26, "t1")].filter(Boolean) });
    const line26 = await until(() => evalIn(harness26, `(document.querySelector(".brw-line")?.textContent || "").startsWith("You have the browser") && document.querySelector(".brw-take .zc-btn-label")?.textContent === "Give back"`), 10000, "the pane saying you have it").catch(() => false);
    const give26 = await call(portA, `/api/sessions/${encodeURIComponent(sid26)}/browser`, { act: "give" });
    check(
      "26. Take over: the agent's next call answered at once that you have the browser; the pane says so; given back",
      take26.status === 200 && turnB26.status === 200 && /^Error: The developer has taken over the browser \(for \d+ min\)/.test(refused26) && line26 === true && give26.status === 200,
      `the turn took ${(tookMs26 / 1000).toFixed(1)} s; ${refused26.slice(0, 80) || "no answer to the call"}`,
    );

    // 27. The agent's click on the page drawn small in the pane: its own point times the scale (BS1), and it lands.
    const countOf = async () => (view26 ? String(await evalIn(view26, "document.getElementById('c')?.textContent || ''").catch(() => "")) : "");
    const stage27 = await stageOf().catch(() => null);
    const turn27 = await call(portA, `/api/sessions/${encodeURIComponent(sid26)}/turns`, { content: "press the shop's count button", stream: false });
    await turn27.text();
    const count27 = await countOf();
    check(
      "27. the page keeps its own size over the pane, and the agent's click on it, drawn small, lands where it aimed",
      turn27.status === 200 && count27 === "Count 1" && (await sizeOf()) === "1280x800" && !!stage27 && stage27.w < 1280,
      `the pane's stage ${stage27 ? `${stage27.w}×${stage27.h}` : "none"} (scale ${stage27 ? (stage27.w / 1280).toFixed(2) : "?"}), the page ${await sizeOf()}; the button: ${count27 || "not found"}`,
    );

    // 28. The agent's resize, then the developer's size chip: the page lays itself out at each, the chip says it.
    const turn28 = await call(portA, `/api/sessions/${encodeURIComponent(sid26)}/turns`, { content: "make the page a phone", stream: false });
    await turn28.text();
    const resized28 = wordsOf({ content: [resultOf(up.received.filter((c) => c.kind === "anthropic").map((c) => c.body?.messages || []).reverse().find((m) => resultOf(m, "r1")) || [], "r1")].filter(Boolean) });
    const phone28 = await until(async () => (await sizeOf()) === "390x844" && (await stageOf())?.chip === "390 × 844", 10000, "the page at a phone's size").catch(() => false);
    await picture(view26, "28-the-page-a-phone");
    await picture(harness26, "28-harness-phone");
    // The chip's menu, as a person: Laptop.
    const chose28 = await evalIn(
      harness26,
      `(async () => { document.querySelector(".brw-size").click(); await new Promise((r) => setTimeout(r, 300)); const row = [...document.querySelectorAll(".zc-menu-item")].find((r) => (r.querySelector(".zc-menu-label-line") || r).textContent.trim().startsWith("Laptop")); if (!row) return false; row.click(); return true; })()`,
    ).catch(() => false);
    const laptop28 = chose28 === true ? await until(async () => (await sizeOf()) === "1280x800" && (await stageOf())?.chip === "1280 × 800", 10000, "the page at a laptop's size again").catch(() => false) : false;
    check(
      "28. the agent's resize makes the page a phone, said in its result; the size chip's Laptop makes it a laptop again",
      turn28.status === 200 && /^The page is 390 × 844 now \(phone\)/.test(resized28) && phone28 === true && laptop28 === true,
      `${resized28.split("\n")[0].slice(0, 90) || "no result"}; the chip's menu ${chose28 === true ? "chosen" : "not found"}; the page ${await sizeOf()}`,
    );

    // 29. While the agent drives, the veil lies over its page; its Take over gives the page to the developer by hand;
    // with the pointer off the page 5 s, it goes back by itself, and the agent's next result says so. The drive never
    // moves the pointer: wherever yours is, it is off this window's page unless you hold it there.
    const browserOf = async () => /** @type {any} */ (await (await call(portA, `/api/sessions/${encodeURIComponent(sid26)}/browser`)).json());
    const turn29 = call(portA, `/api/sessions/${encodeURIComponent(sid26)}/turns`, { content: "press it while I watch", stream: false });
    const pressed29 = await until(async () => (await countOf()) === "Count 2", 20000, "the agent's second press").catch(() => false);
    const veil29 = pressed29 ? await until(async () => (await pagesOf(debugA)).find((p) => p.url.startsWith("data:text/html")), 10000, "the veil over the page").catch(() => null) : null;
    const veilSize29 = veil29 ? String(await evalIn(veil29, "innerWidth + 'x' + innerHeight").catch(() => "")) : "";
    const took29 = veil29 ? await evalIn(veil29, `(() => { const b = document.getElementById("take"); if (!b) return false; b.click(); return true; })()`).catch(() => false) : false;
    const hand29 = took29 === true ? await until(async () => ((await browserOf()).hand === true ? await stageOf() : null), 10000, "the page in the developer's hand").catch(() => null) : null;
    await picture(harness26, "29-harness-by-hand");
    const t29 = Date.now();
    const back29 = hand29 ? await until(async () => (await browserOf()).taken === false, 40000, "the page back with the agent").catch(() => false) : false;
    const after29 = (Date.now() - t29) / 1000;
    release29();
    const reply29 = await turn29;
    await reply29.text();
    const note29 = wordsOf({ content: [resultOf(up.received.filter((c) => c.kind === "anthropic").map((c) => c.body?.messages || []).reverse().find((m) => resultOf(m, "w2")) || [], "w2")].filter(Boolean) });
    check(
      "29. while the agent drives, a veil over its page; its Take over gives it to you by hand, and it goes back by itself 5 s after the pointer leaves",
      !!veil29 && took29 === true && !!hand29 && /^You have the browser — it goes back to the agent/.test(hand29.line) && back29 === true && /^The developer used the page for \d+ s: the page may have moved/.test(note29),
      `${veil29 ? `the veil ${veilSize29}` : "no veil"}; ${hand29 ? `"${hand29.line}"` : "not taken by hand"}; back after ${after29.toFixed(1)} s; the agent read: ${note29.split("\n")[0].slice(0, 80) || "nothing"}`,
    );

    // 30. Pop out: the Browser in a window of its own — the page drawn there, the tile it left saying so; Bring back.
    // Pop out puts the pane in a tab on top (UX10); that tab's Own window puts it in a window of its own.
    const popped30 = await evalIn(
      harness26,
      `(async () => { const b = document.querySelector(".brw-stage")?.closest(".tile")?.querySelector(".tile-btn[aria-label='Pop out']"); if (!b) return false; b.click(); let own = null; for (let i = 0; i < 30 && !own; i++) { await new Promise((r) => setTimeout(r, 100)); own = document.querySelector(".tile-btn[aria-label='Own window']:not(.is-off)"); } if (!own) return false; own.click(); return true; })()`,
    ).catch(() => false);
    const win30 = popped30 === true ? await until(async () => (await pagesOf(debugA)).find((p) => p.url.startsWith(`${originA}/ui/harness.html?pane=browser`)), 20000, "the popped window").catch(() => null) : null;
    const drawn30 = win30 ? await until(() => evalIn(win30, `!!document.querySelector(".app-shell.pane-window .brw-stage") && !document.querySelector(".conv-frame")?.offsetWidth`), 20000, "the Browser alone in it").catch(() => false) : false;
    const away30 = await until(() => evalIn(harness26, `document.querySelector(".tile-away .tile-away-words")?.textContent || ""`), 10000, "the tile saying where it is").catch(() => "");
    const there30 = win30 && drawn30 ? await until(async () => (await sizeOf()) === "1280x800" && (await shownOf()) === "visible" && (await evalIn(win30, `document.querySelector(".brw-picture")?.classList.contains("hidden")`)) === true, 15000, "the page over the popped window's stage").catch(() => false) : false;
    const stage30 = win30 ? await evalIn(win30, `(() => { const r = document.querySelector(".brw-stage")?.getBoundingClientRect(); return r ? Math.round(r.width) + "×" + Math.round(r.height) : ""; })()`).catch(() => "") : "";
    if (win30) await picture(win30, "30-popped-window");
    await picture(harness26, "30-harness-tile-away");
    const brought30 = win30 ? await evalIn(win30, `(() => { const b = document.querySelector(".tile-btn[aria-label='Bring back']"); if (!b) return false; b.click(); return true; })()`).catch(() => false) : false;
    const gone30 = brought30 === true ? await until(async () => !(await pagesOf(debugA)).some((p) => p.url.includes("?pane=")), 15000, "the popped window closed").catch(() => false) : false;
    const home30 = gone30 ? await until(async () => (await evalIn(harness26, `!document.querySelector(".tile-away") && !!document.querySelector(".brw-stage")`)) === true && (await placedAt()), 15000, "the page over the main window's pane again").catch(() => false) : false;
    const kept30 = /** @type {any} */ (JSON.parse(existsSync(join(dataA, "desktop", "windows.json")) ? readFileSync(join(dataA, "desktop", "windows.json"), "utf8") : "{}"))["pop:browser"];
    check(
      "30. Pop out: the Browser alone in a window of its own, its page drawn there; the tile it left says so; Bring back puts it back, its place kept",
      !!win30 && drawn30 === true && away30 === "Browser is in a window of its own" && there30 === true && gone30 === true && home30 === true && !!kept30?.width,
      `${win30 ? `a window, its stage ${stage30}` : "no window"}; the tile: ${away30 || "nothing"}; the page ${there30 ? "drawn there" : "not drawn there"}; ${home30 ? "back in the main window" : "not back"}; kept ${kept30 ? `${kept30.width}×${kept30.height}` : "nothing"}`,
    );

    // ---- 34: the page live where no app of its own shows it (the owner's remote Filament of 11-06, Part 4): the same
    // chat's harness in a plain window — no bridge of the app's, as a browser's tab or another machine's page is — opens
    // its Browser pane, where the app's cast of the page comes live on the run socket; Take over there, and a press on
    // the cast's Count lands on the page itself, at its own point; Give back.
    // The browser the agent's again, whatever check 29 left it as (its take-over by hand waits on your pointer).
    await call(portA, `/api/sessions/${encodeURIComponent(sid26)}/browser`, { act: "give" }).catch(() => null);
    await until(async () => (await (await call(portA, `/api/sessions/${encodeURIComponent(sid26)}/browser`)).json())?.taken === false, 10000, "the browser the agent's").catch(() => null);
    const plainDebug = await freePort();
    const plainMain = join(base, "plain-page.cjs");
    // The address comes in the environment: Electron ends at once with a web address among its arguments.
    writeFileSync(plainMain, `const { app, BrowserWindow } = require("electron");\napp.whenReady().then(() => new BrowserWindow({ x: 40, y: 40, width: 1400, height: 900, webPreferences: { backgroundThrottling: false } }).loadURL(process.env.FILAMENT_PLAIN_URL));\n`);
    const P = spawn(ELECTRON, [plainMain, `--remote-debugging-port=${plainDebug}`, `--user-data-dir=${join(base, "plain-profile")}`], { env: { ...plainEnv(), FILAMENT_PLAIN_URL: `${originA}/ui/harness.html#/task/${encodeURIComponent(sid26)}` }, stdio: "ignore", windowsHide: true });
    if (P.pid) mine.push({ pid: P.pid, label: "a plain window over Filament" });
    try {
      const plain34 = await until(async () => (await pagesOf(plainDebug).catch(() => [])).find((p) => p.url.startsWith(`${originA}/ui/harness.html`)), 30000, "the plain window's harness").catch(() => null);
      const bridgeless34 = plain34 ? await until(() => evalIn(plain34, `!!document.querySelector(".pbtn-more") && typeof window.filamentApp === "undefined"`), 30000, "its panes' buttons, no bridge").catch(() => false) : false;
      const pane34 = bridgeless34 === true
        ? await until(
            () =>
              evalIn(
                /** @type {any} */ (plain34),
                `(async () => { if (document.querySelector(".brw-stage")) return true; document.querySelector(".pbtn-more").click(); await new Promise((r) => setTimeout(r, 300)); const row = [...document.querySelectorAll(".zc-menu-item")].find((r) => r.textContent.trim() === "Browser"); if (row) row.click(); await new Promise((r) => setTimeout(r, 300)); return !!document.querySelector(".brw-stage"); })()`,
              ),
            15000,
            "its Browser pane",
          ).catch(() => false)
        : false;
      /** The cast as the plain page draws it: its line, and the picture's box and source. */
      const liveOf = () => evalIn(/** @type {any} */ (plain34), `(() => { const p = document.querySelector(".brw-picture"); const r = p?.getBoundingClientRect(); return { line: document.querySelector(".brw-line")?.textContent || "", jpeg: !!p && !p.classList.contains("hidden") && (p.src || "").startsWith("data:image/jpeg"), w: p?.naturalWidth || 0, h: p?.naturalHeight || 0, box: r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null }; })()`);
      // A cast's frame is drawn from its data; the 2 s picture is read from its address.
      const live34 = pane34 === true ? await until(async () => { const l = await liveOf(); return l?.jpeg && l.w > 0 ? l : null; }, 20000, "the page live in the plain window").catch(() => null) : null;
      const said34 = live34 ? String((await liveOf())?.line || "") : "";
      await picture(plain34, "34-plain-window-live");
      // Take over, as a person: the pane's button. The Count button's point on the cast, as the page lays it out.
      const before34 = await countOf();
      const took34 = live34 ? await evalIn(/** @type {any} */ (plain34), `(() => { const b = document.querySelector(".brw-take"); if (!b) return false; b.click(); return true; })()`).catch(() => false) : false;
      const yours34 = took34 === true ? await until(async () => ((await liveOf())?.line || "").startsWith("You have the browser: click and type on the page"), 10000, "the plain window's take-over").catch(() => false) : false;
      const at34 = /** @type {any} */ (view26 ? await evalIn(view26, `(() => { const r = document.getElementById("c").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, W: innerWidth, H: innerHeight }; })()`).catch(() => null) : null);
      const box34 = /** @type {any} */ (await liveOf().catch(() => null));
      let pressed34 = "";
      if (yours34 === true && at34 && box34?.box?.width) {
        // The picture is drawn whole and centred in its box (pagePoint's inverse).
        const k = Math.min(box34.box.width / at34.W, box34.box.height / at34.H);
        const cx = box34.box.x + (box34.box.width - at34.W * k) / 2 + at34.x * k;
        const cy = box34.box.y + (box34.box.height - at34.H * k) / 2 + at34.y * k;
        await sendIn(/** @type {any} */ (plain34), "Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy }).catch(() => null);
        await sendIn(/** @type {any} */ (plain34), "Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", buttons: 1, clickCount: 1 }).catch(() => null);
        await sendIn(/** @type {any} */ (plain34), "Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", buttons: 0, clickCount: 1 }).catch(() => null);
        pressed34 = String(await until(async () => { const c = await countOf(); return c !== before34 ? c : null; }, 10000, "the press on the cast landing on the page").catch(() => ""));
      }
      await picture(plain34, "34-plain-window-pressed");
      const gave34 = took34 === true ? await evalIn(/** @type {any} */ (plain34), `(() => { const b = document.querySelector(".brw-take"); if (!b) return false; b.click(); return true; })()`).catch(() => false) : false;
      const back34 = gave34 === true ? await until(async () => (await (await call(portA, `/api/sessions/${encodeURIComponent(sid26)}/browser`)).json())?.taken === false, 10000, "the browser given back").catch(() => false) : false;
      const want34 = `Count ${Number(String(before34).replace(/\D/g, "") || 0) + 1}`;
      check(
        "34. a window with no app of its own: the page live in its Browser pane by the app's cast; taken over there, a press on the cast lands on the page; given back",
        bridgeless34 === true && !!live34 && live34.w === 1280 && live34.h === 800 && said34.startsWith("The page, live") && yours34 === true && pressed34 === want34 && back34 === true,
        `${live34 ? `live, ${live34.w}×${live34.h} frames, "${said34.slice(0, 40)}"` : bridgeless34 === true ? `never live (${pane34 === true ? "its pane open" : "no pane"})` : "no plain window"}; ${yours34 === true ? "taken" : "not taken"}; the button ${before34 || "?"} → ${pressed34 || "unchanged"}; ${back34 === true ? "given back" : "not given back"}`,
      );
    } finally {
      if (P.pid) endTree(P.pid);
    }
  } finally {
    brain = null;
    shop.close();
  }

  // 9. Quit (a launch with --quit): Filament stops, the app ends, nothing it started is left — memory's engine neither.
  const tree9 = treeOf(A.pid);
  const Q = launch(dataA, { args: ["--quit"], label: "quit" });
  await until(() => Q.exited(), 20000, "end of the quitting launch");
  const t9 = Date.now();
  await until(() => A.exited(), 40000, "the app's end");
  const left = processes().filter((p) => tree9.some((t) => t.pid === p.pid && t.line === p.line));
  check(
    "9. Quit stops Filament and the app, and leaves nothing running",
    A.code() === 0 && listener(portA) === null && !(await stateAt(portA)) && left.length === 0 && tree9.some((p) => p.line.includes("fake-sidecar")),
    `ended in ${((Date.now() - t9) / 1000).toFixed(1)} s; ${tree9.length} processes in its tree; left: ${left.map((p) => `${p.name} ${p.pid}`).join(", ") || "none"}`,
  );
  const log = appLog(dataA);
  // (A port moved is check 14's, which a packaged app's drive leaves out.)
  check("the server's log holds Filament's lines and the app's", /Filament .* listening on/.test(log) && /\[desktop\] .* Filament stopped/.test(log) && (BUILT !== "" || /Filament is now at /.test(log)));

  if (!BUILT) {
    // ---- 7: a port another program holds ----------------------------------------------------------------------------------
    const portB = await freePort();
    squatter = createServer((_q, s) => s.end("<html>someone else</html>"));
    await new Promise((r) => /** @type {any} */ (squatter).listen(portB, "127.0.0.1", () => r(undefined)));
    const dataB = join(base, "b");
    writeConfig(dataB, portB, up.url, root);
    const B = launch(dataB, { label: "app on a taken port" });
    await sleep(6000);
    check("7. a port another program holds: the app says so and starts nothing", !B.exited() && listener(portB) === process.pid && /refused: another program answers on port/.test(appLog(dataB)) && !treeOf(B.pid).some((p) => p.line.includes("filament.js")), "its dialog is up; ended by its pid");
    endTree(B.pid);
    await until(() => B.exited(), 10000, "end of the refusing app");
    await new Promise((r) => /** @type {any} */ (squatter).close(() => r(undefined)));
    squatter = null;

    // ---- 15: a Filament that cannot start (its config.json does not read): said once, not tried again and again --------------
    const dataE = join(base, "e");
    const portE = await freePort();
    mkdirSync(dataE, { recursive: true });
    writeFileSync(join(dataE, "config.json"), `{ "server": { "port": ${portE} }, `);
    // --port: a config that does not read gives the app the default port, which is the Filament you run.
    const E = launch(dataE, { args: ["--port", String(portE)], label: "app that cannot start Filament" });
    await until(() => /Filament ended before it answered/.test(appLog(dataE)), 30000, "the failed start in the log").catch(() => null);
    await sleep(RESTART_GAP_MS * 3);
    const startsE = startsIn(appLog(dataE)).length;
    const asideE = readdirSync(dataE).filter((n) => n.startsWith("config.json.broken-")).length;
    check("15. a Filament that cannot start: said, and not started again by itself", !E.exited() && startsE === 1 && asideE === 1 && /not started again/.test(appLog(dataE)) && !treeOf(E.pid).some((p) => p.line.includes("filament.js")), `${startsE} start, ${asideE} copy of the config set aside, in ${RESTART_GAP_MS * 3 / 1000} s`);
    endTree(E.pid);
    await until(() => E.exited(), 10000, "end of the failed app");

    // ---- 8: a Filament already running: attached, and left running on Quit --------------------------------------------------
    const dataC = join(base, "c");
    const portC = await freePort();
    const debugC = await freePort();
    writeConfig(dataC, portC, up.url, root);
    const S = spawn(process.execPath, [join(ROOT, "bin", "filament.js"), "--data-dir", dataC, "--port", String(portC)], { env: plainEnv(), stdio: "ignore", windowsHide: true });
    if (S.pid) mine.push({ pid: S.pid, label: "a Filament of its own" });
    await until(() => stateAt(portC), 60000, "answer from the Filament run beside");
    const C = launch(dataC, { debug: debugC, label: "app attached" });
    const harnessC = await until(async () => (await pagesOf(debugC)).find((p) => p.url.startsWith(`http://127.0.0.1:${portC}/ui/harness.html`)), 30000, "harness of the attached app");
    const attachedLog = await until(() => /attached to Filament/.test(appLog(dataC)), 10000, "attach in the log");
    check("8. a Filament already running: the app attaches and shows its harness", !!harnessC && attachedLog === true && listener(portC) === S.pid, `its server pid ${S.pid}`);
    const QC = launch(dataC, { args: ["--quit"], label: "quit attached" });
    await until(() => QC.exited(), 20000, "end of the quitting launch");
    await until(() => C.exited(), 30000, "the attached app's end");
    check("8. Quit leaves that Filament running", !!(await stateAt(portC)) && listener(portC) === S.pid);

    // ---- 24: attached again, and that Filament goes (its terminal quit, say): after 45 s with no answer the app starts
    // its own on the folder, as at a launch that finds nothing there; Quit then stops it ------------------------------------
    const C24 = launch(dataC, { label: "app attached, then on its own" });
    await until(() => (appLog(dataC).match(/attached to Filament/g) || []).length >= 2, 30000, "the second attach");
    await call(portC, "/api/shutdown", {}).catch(() => null);
    await until(() => listener(portC) === null, 30000, "end of the Filament run beside").catch(() => endTree(/** @type {number} */ (S.pid)));
    const t24 = Date.now();
    const own24 = await until(
      async () => {
        const pid = listener(portC);
        return pid && treeOf(C24.pid).some((p) => p.pid === pid) && (await stateAt(portC)) ? pid : null;
      },
      120000,
      "the app's own Filament",
    ).catch(() => null);
    const waited24 = (Date.now() - t24) / 1000;
    check("24. attached, and that Filament goes: the app starts its own after 45 s without an answer", !!own24 && waited24 >= 40 && /gave no answer for 45 s: the app starts its own/.test(appLog(dataC)), `pid ${own24} after ${waited24.toFixed(0)} s`);
    const Q24 = launch(dataC, { args: ["--quit"], label: "quit the app that took over" });
    await until(() => Q24.exited(), 20000, "end of the quitting launch");
    await until(() => C24.exited(), 40000, "the app's end");
    check("24. Quit then stops the Filament it started", listener(portC) === null && !(await stateAt(portC)));

    // ---- 12: its Filament ends and, inside the five seconds, another Filament takes the port (one started in a terminal,
    // say): the app shows that one and starts nothing on it, again and again or once ------------------------
    const dataD = join(base, "d");
    const portD = await freePort();
    writeConfig(dataD, portD, up.url, root);
    const D = launch(dataD, { label: "app whose port is taken" });
    await until(() => stateAt(portD), 60000, "answer from the app's Filament");
    const serverD = /** @type {number} */ (listener(portD));
    if (!treeOf(D.pid).some((p) => p.pid === serverD)) throw new Error(`pid ${serverD} is not the app's: not ended`);
    // A stand-in for that other Filament: it answers /api/state as Filament does, and counts any stop asked of it.
    let stopsAsked = 0;
    const other = createServer((q, s) => {
      if (q.url?.startsWith("/api/shutdown")) stopsAsked++;
      s.setHeader("content-type", "application/json");
      s.end(JSON.stringify({ version: "0.0.0-tray", dataDir: dataD, supervisor: "tray" }));
    });
    process.kill(serverD);
    await until(
      () =>
        /** @type {Promise<boolean>} */ (
          new Promise((resolve) => {
            other.once("error", () => resolve(false));
            other.listen(portD, "127.0.0.1", () => resolve(true));
          })
        ),
      5000,
      "the port, free",
    );
    const tookOver = await until(() => /port taken by a Filament started by the tray/.test(appLog(dataD)), 15000, "the app's word on the taken port").catch(() => false);
    await sleep(6000);
    const forks = startsIn(appLog(dataD)).length;
    check("12. its port taken by another Filament in the gap: the app attaches to that one and starts nothing", tookOver === true && forks === 1 && !D.exited() && !treeOf(D.pid).some((p) => p.line.includes("filament.js")), `${forks} start in its log`);
    const QD = launch(dataD, { args: ["--quit"], label: "quit the attached app" });
    await until(() => QD.exited(), 20000, "end of the quitting launch");
    await until(() => D.exited(), 30000, "the app's end");
    check("12. Quit then leaves that Filament alone", stopsAsked === 0 && listener(portD) === process.pid, `stops asked of it: ${stopsAsked}`);
    other.closeAllConnections();
    await new Promise((r) => other.close(() => r(undefined)));

    // ---- 16: `--quit` with no app running starts nothing -------------------------------------------------------------------
    const dataF = join(base, "f");
    const portF = await freePort();
    writeConfig(dataF, portF, up.url, root);
    const F = launch(dataF, { args: ["--quit"], label: "quit with none running" });
    await until(() => F.exited(), 20000, "end of the lone --quit");
    check("16. --quit with no app running: nothing starts", F.code() === 0 && listener(portF) === null && !existsSync(join(dataF, "desktop", "server.log")), `exit ${F.code()}`);

    // ---- 31: the window shows at once while Filament starts (the owner's of 10-31: after an install the tray icon showed
    // long before the window, and "users will be confused nothing happened"): the app's own page in it; a second launch
    // meanwhile — a double-click on the desktop's icon — brings that window forward and opens no other; Filament's page
    // comes into the same window at its answer. Its server is held 4 s by a preload of the drive's own, through
    // NODE_OPTIONS, in the app's one utility process: nothing of the app's.
    const dataG = join(base, "g");
    const portG = await freePort();
    const debugG = await freePort();
    writeConfig(dataG, portG, up.url, root);
    mkdirSync(join(dataG, "desktop"), { recursive: true });
    writeFileSync(join(dataG, "desktop", "settings.json"), JSON.stringify({ notify: false }));
    const hold = join(base, "hold-start.cjs");
    writeFileSync(hold, 'if (process.type === "utility") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000);\n');
    // NODE_OPTIONS reads a backslash in quotes as an escape: the path with forward slashes, as Windows takes it too.
    const G = launch(dataG, { debug: debugG, label: "a held start", env: { NODE_OPTIONS: `--require "${hold.replace(/\\/g, "/")}"` } });
    // The window's page once it is in it: Chromium lists a window before its first page, and a page still being read
    // has no body for a moment.
    const wait31 = await until(async () => (await pagesOf(debugG)).find((p) => p.url.startsWith("data:text/html")), 20000, "the app's page in its first window").catch(() => null);
    const words31 = wait31 ? String(await until(async () => String((await evalIn(wait31, "document.body ? document.body.innerText : ''")) ?? "").trim(), 5000, "its words").catch(() => "")) : "";
    const early31 = !(await stateAt(portG));
    const B31 = launch(dataG, { label: "a launch while it starts" });
    await until(() => B31.exited(), 20000, "end of the launch while it starts");
    const during31 = await pagesOf(debugG);
    const harness31 = await until(async () => (await pagesOf(debugG)).find((p) => p.url.startsWith(`http://127.0.0.1:${portG}/ui/harness.html`)), 45000, "the harness at Filament's answer").catch(() => null);
    check(
      "31. the window shows at once while Filament starts: the app's page, a second launch meanwhile no other window, Filament's page in the same window at its answer",
      !!wait31 && wait31.url.startsWith("data:text/html") && /Filament is starting/.test(words31) && early31 && B31.code() === 0 && during31.length === 1 && !!harness31 && harness31.id === wait31.id,
      `${words31.replace(/\s+/g, " ").slice(0, 60)}; ${during31.length} window(s) after the second launch; the harness ${harness31 ? (harness31.id === wait31?.id ? "in the same window" : "in another window") : "never"}`,
    );
    const QG = launch(dataG, { args: ["--quit"], label: "quit the held start's app" });
    await until(() => QG.exited(), 20000, "end of its quitting launch");
    await until(() => G.exited(), 30000, "the held start's app's end");

    // ---- 32: the machines of one window (the owner's remote Filament of 11-06, Part 3; a switcher in the top bar in the
    // rail's place since the owner's of 11-08): two machines kept beside this computer — another Filament run beside,
    // reached at its loopback address as an SSH tunnel's would be, and one where nothing listens. No rail: this computer's
    // page as it always was, a chip left of Changes saying which machine it is; pressed, the app's popover under it lists
    // the machines; one picked shows its harness in a view over the whole window, its top row the title bar from the room
    // the app lends it, with its one bridge alone; its own chip brings this computer back; one that cannot be reached
    // shows the app's page with why and Switch machine; the other Filament gone, the popover says it is reconnecting.
    const dataH = join(base, "h");
    const portH = await freePort();
    const debugH = await freePort();
    writeConfig(dataH, portH, up.url, root);
    mkdirSync(join(dataH, "desktop"), { recursive: true });
    writeFileSync(join(dataH, "desktop", "settings.json"), JSON.stringify({ notify: false }));
    const dataR = join(base, "r");
    const portR = await freePort();
    // Another machine stood in for by a Filament on this computer, opened with no pairing: any program here is let in
    // there (`server.loopbackTrust` "legacy"), as this check is of the window, not of the way in — a pairing, check 35's.
    writeConfig(dataR, portR, up.url, root, { loopbackTrust: "legacy" });
    // Named Studio there too: the window takes the name a machine answers by (lib/rail.js), else this computer's.
    writeFileSync(join(dataR, "machine.json"), JSON.stringify({ version: 1, id: randomUUID(), name: "Studio", named: true }));
    const R = spawn(process.execPath, [join(ROOT, "bin", "filament.js"), "--data-dir", dataR, "--port", String(portR)], { env: plainEnv(), stdio: "ignore", windowsHide: true });
    if (R.pid) mine.push({ pid: R.pid, label: "the other machine's Filament" });
    await until(() => stateAt(portR), 60000, "answer from the other machine's Filament");
    const whoR = /** @type {any} */ (await fetch(`http://127.0.0.1:${portR}/.well-known/filament`).then((r) => r.json()));
    const nobody = await freePort();
    const machinesH = join(dataH, "desktop", MACHINES_FILE);
    addMachine(machinesH, { id: String(whoR.id), name: "Studio", routes: [{ kind: "url", url: `http://127.0.0.1:${portR}` }] });
    addMachine(machinesH, { id: "m-laptop", name: "Laptop", routes: [{ kind: "url", url: `http://127.0.0.1:${nobody}` }] });
    // A machine kept disconnected (the owner's of 11-08): its address counts what reaches it — nothing, while it is off.
    let oldHits = 0;
    const oldBox = createServer((_req, res) => {
      oldHits++;
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => oldBox.listen(0, "127.0.0.1", () => r(null)));
    const oldPort = /** @type {import("node:net").AddressInfo} */ (oldBox.address()).port;
    addMachine(machinesH, { id: "m-oldbox", name: "Old box", routes: [{ kind: "url", url: `http://127.0.0.1:${oldPort}` }] });
    setMachineOff(machinesH, "m-oldbox", true);
    const H = launch(dataH, { debug: debugH, label: "app driving machines" });
    const harnessH = await until(async () => (await pagesOf(debugH)).find((p) => p.url.startsWith(`http://127.0.0.1:${portH}/ui/harness.html`)), 60000, "the harness of the app driving machines");
    await until(() => evalIn(harnessH, `!!document.querySelector(".app-shell")`), 30000, "its harness drawn");
    /** A page's machine chip: shown, its name, its dot, and whether Changes stands right after it. @param {any} page */
    const chipOf = (page) =>
      page
        ? evalIn(page, `(() => { const c = document.querySelector(".hdr-machine"); return c ? { shown: !c.classList.contains("hidden"), name: c.querySelector(".mc-name")?.textContent || "", dot: c.querySelector(".mc-dot")?.className || "", open: c.getAttribute("aria-expanded"), beforePanes: !!c.nextElementSibling?.classList.contains("hdr-panes") } : null })()`).catch(() => null)
        : Promise.resolve(null);
    const chip32 = /** @type {any} */ (await until(async () => ((await chipOf(harnessH))?.shown ? chipOf(harnessH) : null), 20000, "this computer's chip").catch(() => chipOf(harnessH)));
    const room32 = await evalIn(harnessH, `getComputedStyle(document.documentElement).paddingLeft`).catch(() => "");
    const sizeH = /** @type {any} */ (await evalIn(harnessH, `({ w: innerWidth, h: innerHeight })`).catch(() => null));
    const railAt = async () => (await pagesOf(debugH)).find((p) => p.url.endsWith("/desktop/rail.html")) ?? null;
    const noRail32 = !(await railAt());
    await picture(harnessH, "32-this-computer-page");
    check(
      "32. machines kept: no rail and no room taken — this computer's page as it was, a chip left of Changes saying which machine it is",
      noRail32 && room32 === "0px" && chip32?.shown === true && chip32.name === "This computer" && /s-online/.test(chip32.dot) && chip32.beforePanes === true,
      `${noRail32 ? "no rail" : "a rail's page stands"}; this computer's page padded ${room32 || "?"}; its chip ${chip32 ? `${chip32.shown ? "shown" : "hidden"}, "${chip32.name}", ${chip32.dot}${chip32.beforePanes ? ", left of Changes" : ""}` : "none"}`,
    );
    // The chip pressed: the app's popover under it, each machine with its state.
    /** @type {any} */
    let railH = null;
    const railOf = () => (railH ? evalIn(railH, `({ pop: document.body.classList.contains("pop"), rows: [...document.querySelectorAll(".row")].map((r) => r.querySelector("[data-machine]").dataset.machine + ":" + [...r.classList].filter((c) => c.startsWith("s-") || c === "on").join("+")), top: document.getElementById("pop").style.top })`).catch(() => null) : Promise.resolve(null));
    /** A chip pressed in a page, and the popover waited for. @param {any} page */
    const popFrom = async (page) => {
      await evalIn(page, `(document.querySelector(".hdr-machine").click(), true)`).catch(() => null);
      railH ??= await until(railAt, 10000, "the app's popover page").catch(() => null);
      return until(async () => ((await railOf())?.pop ? railOf() : null), 10000, "the popover open").catch(() => railOf());
    };
    /** A machine picked in the popover. @param {string} id */
    const pickIn = (id) => (railH ? evalIn(railH, `(document.querySelector('[data-machine="${id}"]').click(), true)`).catch(() => null) : null);
    const pop32 = /** @type {any} */ (await popFrom(harnessH));
    const online32 = railH ? await until(async () => ((await railOf())?.rows || []).includes(`${whoR.id}:s-online`), 20000, "the other machine connected in the popover").catch(() => false) : false;
    const open32 = await chipOf(harnessH);
    await picture(railH, "32-popover-page");
    check(
      "32. the chip pressed: the app's popover under it, each machine with its state, this computer ticked",
      pop32?.pop === true && online32 === true && (await railOf())?.rows?.[0] === "local:s-online+on" && pop32?.rows?.length === 4 && open32?.open === "true",
      `${railH ? `popover ${pop32?.pop ? "open" : "closed"} at top ${pop32?.top || "?"}: ${((await railOf())?.rows || []).join(", ")}` : "no popover page"}; the chip ${open32?.open === "true" ? "says it is open" : "says nothing"}`,
    );
    // Studio picked: its harness in a view over the whole window, its top row the title bar, its one bridge alone.
    await pickIn(String(whoR.id));
    const studio32 = await until(async () => (await pagesOf(debugH)).find((p) => p.url.startsWith(`http://127.0.0.1:${portR}/ui/harness.html`)), 20000, "Studio's harness in its view").catch(() => null);
    const drawn32 = studio32 ? await until(() => evalIn(studio32, `!!document.querySelector(".app-shell")`), 30000, "Studio's harness drawn").catch(() => false) : false;
    const framed32 = studio32 ? await until(() => evalIn(studio32, `document.documentElement.classList.contains("app-frame") || null`), 10000, "its title bar lent").catch(() => false) : false;
    // The controls' room: the window's own overlay's where it reaches the view (Windows'), else the room the app lends —
    // and the header's last control short of it.
    const studioAt = /** @type {any} */ (
      studio32
        ? await evalIn(
            studio32,
            `(() => { const o = navigator.windowControlsOverlay, r = o?.visible ? o.getTitlebarAreaRect() : null, ends = [...document.querySelectorAll(".c-right > *")].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0).map((b) => b.right); return { w: innerWidth, h: innerHeight, bridges: ["filamentBrowser", "filamentApp", "filamentPanes", "filamentRail", "filamentDesktop", "filamentMachines"].filter((k) => k in window), how: r ? "its own overlay" : "lent", right: r ? innerWidth - r.x - r.width : parseFloat(document.documentElement.style.getPropertyValue("--wco-r")) || 0, free: Math.round(innerWidth - Math.max(0, ...ends)), headerTop: Math.round(document.querySelector(".c-bar")?.getBoundingClientRect().top ?? -1) }; })()`,
          ).catch(() => null)
        : null
    );
    const chipR = /** @type {any} */ (await until(async () => ((await chipOf(studio32))?.shown ? chipOf(studio32) : null), 10000, "Studio's chip").catch(() => chipOf(studio32)));
    const closed32 = await until(async () => ((await railOf())?.pop === false ? true : null), 5000, "the popover closed").catch(() => false);
    await sleep(800);
    await picture(studio32, "32-studio-view");
    check(
      "32. a machine picked: its harness over the whole window, its top row the title bar short of the window's controls, its two bridges alone (the machines' and its Browser pane's), its chip saying it",
      drawn32 === true && framed32 === true && closed32 === true && !!sizeH && studioAt?.w === sizeH.w && studioAt?.h === sizeH.h && studioAt?.headerTop === 0 && studioAt?.right > 90 && studioAt?.right < 200 && studioAt?.free >= studioAt?.right && studioAt?.bridges?.join() === "filamentBrowser,filamentMachines" && chipR?.name === "Studio" && /s-online/.test(chipR?.dot || ""),
      `${studio32 ? `Studio's page ${studioAt?.w}×${studioAt?.h} in a window of ${sizeH?.w}×${sizeH?.h}, its header at ${studioAt?.headerTop}, the controls' room ${studioAt?.right ? `${Math.round(studioAt.right)}px (${studioAt.how}), ${studioAt.free}px left free` : "none"}${framed32 ? "" : ", no title bar"}, bridges: ${studioAt?.bridges?.join(", ") || "none"}` : "no view"}; its chip ${chipR ? `"${chipR.name}" ${chipR.dot}` : "none"}; the popover ${closed32 ? "closed" : "open"}`,
    );
    // Its own chip pressed, This computer picked: this computer's page again, Studio's kept live behind it. (Ctrl+1..9 are
    // tried in test/desktop-rail.test.js: a key sent over DevTools never reaches Electron's before-input-event, and the
    // drive types nothing into the person's own focused window.)
    const popR = /** @type {any} */ (await popFrom(studio32));
    // Its 120 ms entrance played out first (rail.html `pop-in`).
    await sleep(250);
    await picture(railH, "32-popover-over-studio");
    await pickIn("local");
    const back32 = await until(async () => {
      const s = await railOf();
      return s && !s.pop ? true : null;
    }, 10000, "this computer shown again").catch(() => false);
    const kept32 = studio32 ? (await pagesOf(debugH)).some((p) => p.id === studio32.id) : false;
    check("32. this computer picked from another machine's chip: its page again, the other machine's kept live behind it", popR?.pop === true && back32 === true && kept32, back32 === true ? `Studio's page ${kept32 ? "kept" : "gone"}` : JSON.stringify(await railOf()));
    // Laptop, where nothing listens: the app's own page, with why, and Switch machine.
    await popFrom(harnessH);
    await pickIn("m-laptop");
    const laptop32 = await until(async () => {
      for (const p of await pagesOf(debugH)) if (p.url.startsWith("data:text/html") && /Laptop cannot be reached/.test(String(await evalIn(p, "document.body ? document.body.innerText : ''").catch(() => "")))) return p;
      return null;
    }, 20000, "Laptop's page").catch(() => null);
    const laptopWords = laptop32 ? String(await evalIn(laptop32, "document.body.innerText").catch(() => "")) : "";
    const switch32 = laptop32 ? await evalIn(laptop32, `!document.getElementById("switch").hidden`).catch(() => false) : false;
    await sleep(500);
    await picture(laptop32, "32-laptop-view");
    check(
      "32. a machine that cannot be reached: the app's own page in its view, saying why, Switch machine on it",
      !!laptop32 && laptopWords.includes(`nothing listens at http://127.0.0.1:${nobody}`) && switch32 === true,
      `${laptopWords.replace(/\s+/g, " ").slice(0, 120) || "no page"}${switch32 ? "; Switch machine" : "; no way to another machine"}`,
    );
    if (laptop32) await evalIn(laptop32, `(document.getElementById("switch").click(), true)`).catch(() => null);
    const popL = /** @type {any} */ (await until(async () => ((await railOf())?.pop ? railOf() : null), 10000, "the popover from Switch machine").catch(() => railOf()));
    await pickIn("local");
    check("32. Switch machine there: the app's popover, this computer picked from it", popL?.pop === true, JSON.stringify(popL));
    // Studio's Filament goes: the popover says it is reconnecting at its next look.
    endTree(/** @type {number} */ (R.pid));
    await until(() => listener(portR) === null, 20000, "the other machine's Filament gone").catch(() => null);
    await popFrom(harnessH);
    const lost32 = await until(async () => ((await railOf())?.rows || []).includes(`${whoR.id}:s-reconnecting`), 25000, "Studio reconnecting in the popover").catch(() => false);
    await picture(railH, "32-popover-reconnecting");
    check("32. a machine that stops answering: reconnecting in the popover", lost32 === true, ((await railOf())?.rows || []).join(", "));
    // The machine kept disconnected the whole while: said so, nothing asked of it, no page of it; picked, connected again.
    const off32 = ((await railOf())?.rows || []).includes("m-oldbox:s-disconnected");
    const quiet32 = oldHits;
    const oldPage32 = (await pagesOf(debugH)).some((p) => p.url.includes(`127.0.0.1:${oldPort}`));
    await pickIn("m-oldbox");
    const asked32 = await until(() => (oldHits > 0 ? true : null), 15000, "the old box asked once connected").catch(() => false);
    const oldKept32 = /** @type {any} */ (JSON.parse(readFileSync(machinesH, "utf8")).machines.find((/** @type {any} */ m) => m.id === "m-oldbox"));
    check(
      "32. a machine kept disconnected: said so in the popover, nothing asked of it, no page of it; picked, connected again",
      off32 && quiet32 === 0 && !oldPage32 && asked32 === true && !!oldKept32 && !("off" in oldKept32),
      `${off32 ? "disconnected in the popover" : "not said disconnected"}; ${quiet32} request(s) reached it while off; ${oldPage32 ? "a page of it open" : "no page of it"}; picked: ${asked32 === true ? "asked at once" : "not asked"}, ${oldKept32 && !("off" in oldKept32) ? "kept connected" : "still off"}`,
    );
    oldBox.close();
    if (railH) await evalIn(railH, `(document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })), true)`).catch(() => null);
    const QH = launch(dataH, { args: ["--quit"], label: "quit the app driving machines" });
    await until(() => QH.exited(), 20000, "end of its quitting launch");
    await until(() => H.exited(), 30000, "the app driving machines' end");
    check("32. Quit with machines kept: the app ends, its Filament stopped", listener(portH) === null && !(await stateAt(portH)));

    // ---- 33: Add a machine (the owner's remote Filament of 11-06, Part 3): another Filament reached on the network over
    // https, its certificate pinned by the fingerprint its pairing link carries. The app with no machine kept opens the Add
    // sheet from Settings › Remote access's bridge, takes the link that Filament's own pairing made, says who answers, and
    // pairs: the claim is made from that machine's own page in its view, so the cookie lands in its partition — its harness
    // opens there paired, never at the pairing page —, the machine shows with its chip and is kept with its pinned way, and
    // that Filament lists this window as a browser device.
    const dataW = join(base, "w");
    const portW = await freePort();
    const lanW = await freePort();
    writeConfig(dataW, portW, up.url, root);
    const cfgW = JSON.parse(readFileSync(join(dataW, "config.json"), "utf8"));
    cfgW.server.lan = { enabled: true, port: lanW };
    writeFileSync(join(dataW, "config.json"), JSON.stringify(cfgW));
    const W = spawn(process.execPath, [join(ROOT, "bin", "filament.js"), "--data-dir", dataW, "--port", String(portW)], { env: plainEnv(), stdio: "ignore", windowsHide: true });
    if (W.pid) mine.push({ pid: W.pid, label: "the Filament on the network" });
    await until(() => stateAt(portW), 60000, "answer from the Filament on the network");
    const whoW = /** @type {any} */ (await fetch(`http://127.0.0.1:${portW}/.well-known/filament`).then((r) => r.json()));
    const pairW = /** @type {any} */ (await until(async () => {
      const r = await fetch(`http://127.0.0.1:${portW}/api/remote/pair`, { method: "POST", headers: { "content-type": "application/json", ...ownerOfPort(portW) }, body: JSON.stringify({ scope: "full" }) }).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      return j?.links?.length ? j : null;
    }, 20000, "a pairing link on the network").catch(() => null));
    const link33 = String(pairW?.links?.[0] || "");
    const at33 = link33 ? new URL(link33).origin : "";
    const dataH2 = join(base, "h2");
    const portH2 = await freePort();
    const debugH2 = await freePort();
    writeConfig(dataH2, portH2, up.url, root);
    mkdirSync(join(dataH2, "desktop"), { recursive: true });
    writeFileSync(join(dataH2, "desktop", "settings.json"), JSON.stringify({ notify: false }));
    const H2 = launch(dataH2, { debug: debugH2, label: "app adding a machine" });
    const harnessH2 = await until(async () => (await pagesOf(debugH2)).find((p) => p.url.startsWith(`http://127.0.0.1:${portH2}/ui/harness.html`)), 60000, "the harness of the app adding a machine");
    await until(() => evalIn(harnessH2, `!!document.querySelector(".app-shell")`), 30000, "its harness drawn");
    const bridge33 = await evalIn(harnessH2, `typeof window.filamentApp?.addMachine === "function" && (window.filamentApp.addMachine(), true)`).catch(() => false);
    const railH2 = await until(async () => (await pagesOf(debugH2)).find((p) => p.url.endsWith("/desktop/rail.html")), 20000, "the app's page for the sheet").catch(() => null);
    const open33 = railH2 ? await until(() => evalIn(railH2, `document.body.classList.contains("adding") || null`), 10000, "the Add sheet open").catch(() => false) : false;
    const noChip33 = await evalIn(harnessH2, `!!document.querySelector(".hdr-machine.hidden")`).catch(() => false);
    await picture(railH2, "33-sheet");
    check("33. Add a machine from Settings: the sheet over the window, no machine kept yet — the chip hidden", bridge33 === true && open33 === true && noChip33 === true, `bridge ${bridge33}, sheet ${open33}, chip ${noChip33 ? "hidden" : "shown"}`);
    const sheet33 = (/** @type {string} */ js) => (railH2 ? evalIn(railH2, js).catch(() => null) : Promise.resolve(null));
    await sheet33(`(() => { const l = document.getElementById("add-link"); l.value = ${JSON.stringify(link33)}; l.dispatchEvent(new Event("input")); document.getElementById("add-go").click(); return true })()`);
    const who33 = /** @type {any} */ (await until(async () => {
      const s = /** @type {any} */ (await sheet33(`({ who: !document.getElementById("add-who").hidden, name: document.getElementById("add-who-name").textContent, print: document.getElementById("add-who-print").textContent, said: document.getElementById("add-said").textContent, go: document.getElementById("add-go").textContent })`));
      return s?.who || /not|No /.test(String(s?.said || "")) ? s : null;
    }, 20000, "who answers, in the sheet").catch(() => null));
    await picture(railH2, "33-sheet-who");
    const hexW = String(pairW?.fingerprint || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
    check(
      "33. the link read: who answers there, over the certificate its fingerprint pins",
      !!link33 && who33?.who === true && who33.name === `${whoW.name} answers at ${at33}` && String(who33.print).replace(/[^0-9A-F]/g, "") === hexW && who33.go === "Pair",
      link33 ? `${who33?.name || who33?.said || "nothing said"} · ${who33?.print || ""}` : "no pairing link: this machine is on no network",
    );
    await sheet33(`(document.getElementById("add-go").click(), true)`);
    const view33 = at33 ? await until(async () => (await pagesOf(debugH2)).find((p) => p.url.startsWith(`${at33}/ui/harness.html`)), 30000, "the machine's harness in its view").catch(() => null) : null;
    const drawn33 = view33 ? await until(() => evalIn(view33, `!!document.querySelector(".app-shell") && location.pathname`), 30000, "its harness drawn, paired").catch(() => false) : false;
    const rail33 = await until(async () => {
      const r = /** @type {any} */ (await sheet33(`({ adding: document.body.classList.contains("adding"), rows: [...document.querySelectorAll(".row")].map((r) => r.querySelector("[data-machine]").dataset.machine + ":" + [...r.classList].filter((c) => c.startsWith("s-") || c === "on").join("+")) })`));
      return r && !r.adding && r.rows.includes(`${String(whoW.id).toLowerCase()}:s-online+on`) ? r : null;
    }, 15000, "the machine kept, shown").catch(async () => sheet33(`({ said: document.getElementById("add-said").textContent })`));
    await picture(railH2, "33-sheet-closed");
    await picture(view33, "33-machine-view");
    const kept33 = (() => {
      try {
        return JSON.parse(readFileSync(join(dataH2, "desktop", MACHINES_FILE), "utf8")).machines?.[0] ?? null;
      } catch {
        return null;
      }
    })();
    const devices33 = /** @type {any} */ (await fetch(`http://127.0.0.1:${portW}/api/remote/devices`, { headers: ownerOfPort(portW) }).then((r) => r.json()).catch(() => null));
    const device33 = (devices33?.devices || []).find((/** @type {any} */ d) => d.name === `Filament app on ${hostname()}`);
    check(
      "33. paired: the cookie in the machine's partition — its harness opens there, not the pairing page —, shown, kept with its pinned way, its Filament lists this window",
      drawn33 === "/ui/harness.html" && !!rail33?.rows && kept33?.id === String(whoW.id).toLowerCase() && kept33?.routes?.[0]?.kind === "lan" && kept33.routes[0].url === at33 && String(kept33.routes[0].fingerprint).replace(/:/g, "") === hexW && device33?.kind === "browser",
      `view ${drawn33 || "none"}; machines ${(rail33?.rows || []).join(", ") || rail33?.said || "?"}; kept ${kept33 ? JSON.stringify(kept33.routes?.[0]) : "nothing"}; device ${device33 ? `${device33.name} (${device33.kind})` : "none"}`,
    );
    // Paired again (the review of p3-add): that Filament's certificate made anew while its page stands here — the page
    // refuses it, a verdict Chromium keeps —, and its new link pairs all the same, the partition's check set anew; this
    // window's old device there is signed out first, one sign-in left standing.
    endTree(/** @type {number} */ (W.pid));
    await until(() => listener(portW) === null, 20000, "the Filament on the network gone").catch(() => null);
    rmSync(join(dataW, "lan-tls"), { recursive: true, force: true });
    const W2 = spawn(process.execPath, [join(ROOT, "bin", "filament.js"), "--data-dir", dataW, "--port", String(portW)], { env: plainEnv(), stdio: "ignore", windowsHide: true });
    if (W2.pid) mine.push({ pid: W2.pid, label: "the Filament on the network, its certificate made anew" });
    await until(() => stateAt(portW), 60000, "answer from the Filament on the network again");
    const fetchIn = (/** @type {any} */ page) => (page ? evalIn(page, `fetch("/api/state").then((r) => (r.status === 200 ? "taken" : "HTTP " + r.status), () => "refused")`).catch(() => "no page") : Promise.resolve("no page"));
    const refused33 = await until(async () => ((await fetchIn(view33)) === "refused" ? "refused" : null), 20000, "the new certificate refused in its page").catch(() => fetchIn(view33));
    const pair2 = /** @type {any} */ (await until(async () => {
      const r = await fetch(`http://127.0.0.1:${portW}/api/remote/pair`, { method: "POST", headers: { "content-type": "application/json", ...ownerOfPort(portW) }, body: JSON.stringify({ scope: "full" }) }).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      return j?.links?.length ? j : null;
    }, 20000, "a new pairing link").catch(() => null));
    const link2 = String(pair2?.links?.[0] || "");
    await sheet33(`(document.querySelector("[data-add]").click(), true)`);
    await until(() => sheet33(`document.body.classList.contains("adding") || null`), 10000, "the sheet open again").catch(() => null);
    await sheet33(`(() => { const l = document.getElementById("add-link"); l.value = ${JSON.stringify(link2)}; l.dispatchEvent(new Event("input")); document.getElementById("add-go").click(); return true })()`);
    const who2 = /** @type {any} */ (await until(async () => {
      const s = /** @type {any} */ (await sheet33(`({ who: !document.getElementById("add-who").hidden, kept: !document.getElementById("add-who-kept").hidden, said: document.getElementById("add-said").textContent })`));
      return s?.who || /not|No /.test(String(s?.said || "")) ? s : null;
    }, 20000, "who answers, again").catch(() => null));
    await sheet33(`(document.getElementById("add-go").click(), true)`);
    const back33 = /** @type {any} */ (await until(async () => {
      const r = /** @type {any} */ (await sheet33(`({ adding: document.body.classList.contains("adding"), said: document.getElementById("add-said").textContent })`));
      return r && !r.adding ? r : null;
    }, 30000, "paired again").catch(() => sheet33(`({ adding: true, said: document.getElementById("add-said").textContent })`)));
    const view2 = link2 ? await until(async () => (await pagesOf(debugH2)).find((p) => p.url.startsWith(`${new URL(link2).origin}/ui/harness.html`)), 30000, "its harness again").catch(() => null) : null;
    const taken33 = await until(async () => ((await fetchIn(view2)) === "taken" ? "taken" : null), 20000, "the new certificate taken").catch(() => fetchIn(view2));
    await picture(railH2, "33-sheet-repaired");
    await picture(view2, "33-machine-view-repaired");
    const devices2 = /** @type {any} */ (await fetch(`http://127.0.0.1:${portW}/api/remote/devices`, { headers: ownerOfPort(portW) }).then((r) => r.json()).catch(() => null));
    const ours2 = (devices2?.devices || []).filter((/** @type {any} */ d) => d.name === `Filament app on ${hostname()}`);
    check(
      "33. paired again after its certificate was made anew: refused in its page before, taken after; this window's old device there signed out, one left",
      refused33 === "refused" && who2?.who === true && who2.kept === true && back33?.adding === false && taken33 === "taken" && ours2.length === 2 && ours2.filter((/** @type {any} */ d) => d.revokedAt == null).length === 1,
      `before: ${refused33}; sheet: ${who2?.who ? `who answers${who2.kept ? ", in this window already" : ""}` : who2?.said || "?"}${back33?.adding ? `; ${back33.said}` : ""}; after: ${taken33}; its devices there: ${ours2.map((/** @type {any} */ d) => (d.revokedAt == null ? "signed in" : "signed out")).join(", ") || "none"}`,
    );
    const QH2 = launch(dataH2, { args: ["--quit"], label: "quit the app that added a machine" });
    await until(() => QH2.exited(), 20000, "end of its quitting launch");
    await until(() => H2.exited(), 30000, "the app that added a machine's end");
    endTree(/** @type {number} */ (W2.pid));

    await driveDesk();

    // ---- 17: the folder deletions that meet read-only files, under Electron's own Node (the suite runs on plain Node,
    // whose sync form takes them: there those tests prove nothing) ---------------------------------------------------------
    const suite = spawn(ELECTRON, ["--test", "test/git-places.test.js", "test/subagent-worktree.test.js", "test/memory-install.test.js"], { cwd: ROOT, env: { ...plainEnv(), ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    if (suite.pid) mine.push({ pid: suite.pid, label: "the delete tests under Electron's Node" });
    let suiteSaid = "";
    suite.stdout?.on("data", (d) => (suiteSaid += d));
    suite.stderr?.on("data", (d) => (suiteSaid += d));
    const suiteCode = await new Promise((r) => suite.on("exit", (code) => r(code)));
    const tally = (/** @type {string} */ k) => Number(suiteSaid.match(new RegExp(`^ℹ ${k} (\\d+)`, "m"))?.[1] ?? NaN);
    check("17. the folder deletions with read-only files, under Electron's Node", suiteCode === 0 && tally("fail") === 0 && tally("pass") > 0, `${tally("pass")} pass, ${tally("fail")} fail`);
  }

  // The data folder the app would have written into, left alone.
  const after = electronThere();
  const touched = [...after].filter(([n, at]) => appDataBefore.get(n) !== at).map(([n]) => n);
  check("10. nothing of Electron's in %APPDATA%\\filament", touched.length === 0, touched.join(", ") || (appDataBefore.size ? `untouched (there before: ${[...appDataBefore.keys()].join(", ")})` : "untouched"));
} catch (/** @type {any} */ e) {
  check("the drive ran to its end", false, String(e?.message || e));
} finally {
  await cleanUp();
}
finish();
