// @ts-check
// What a view-only device reads (the owner's remote Filament of 11-06, the security review of 882809c20): the folders
// this Filament's chats work in, by the row the admin API matched — never the data folder, whose secret.key and sealed
// config.json open the admin token and every key, a home folder, a drive's root, nor a row that only has a view row's
// shape. Another machine stands here as a request a proxy on this machine handed on (X-Forwarded-For over loopback).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, parse } from "node:path";
import { startApp, fakeUpstream } from "./helpers/app.js";
import { viewFolderRefusal } from "../src/http/admin/remote.js";
import { createRouter } from "../src/http/router.js";
import { memoryRoutes } from "../src/http/admin/memory.js";
import { codingAgentRoutes } from "../src/http/admin/coding-agents.js";
import { upstreamRoutes } from "../src/http/admin/upstreams.js";

const FAR = { "x-forwarded-for": "100.101.102.103" };

/**
 * A request over node:http, so the test sets every header itself.
 * @param {number} port @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
 * @returns {Promise<{ status: number, json: any }>}
 */
const ask = (port, path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...(text ? { "content-type": "application/json" } : {}), ...headers } });
    req.on("response", (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(b);
        } catch {}
        resolve({ status: Number(res.statusCode), json });
      });
    });
    req.on("error", reject);
    req.end(text || undefined);
  });

/** A device paired from this machine and claimed by another machine's page: its headers. @param {number} port @param {"full" | "view"} scope */
const paired = async (port, scope) => {
  const own = { origin: `http://127.0.0.1:${port}` };
  const pair = await ask(port, "/api/remote/pair", { method: "POST", body: { scope } });
  const claimed = await new Promise((resolve, reject) => {
    const text = JSON.stringify({ code: pair.json.code, name: `a ${scope} device` });
    const req = http.request({ host: "127.0.0.1", port, path: "/api/remote/claim", method: "POST", headers: { host: `127.0.0.1:${port}`, "content-type": "application/json", ...FAR, ...own } }, (res) => (res.resume(), resolve(res)));
    req.on("error", reject);
    req.end(text);
  });
  assert.equal(/** @type {any} */ (claimed).statusCode, 200);
  return { ...FAR, cookie: String(/** @type {any} */ (claimed).headers["set-cookie"]?.[0] || "").split(";")[0] };
};

/** A drive's root on another volume than `p`'s, there or not: Windows's alone has one. @param {string} p */
const otherRoot = (p) => (parse(p).root.toUpperCase().startsWith("Z") ? "Y:\\" : "Z:\\");

// (fails before: yes — with agentLoop.roots empty, the default, a view device's cwd was any folder: the data folder's
// config.json read whole, its secret.key too)
test("a view device reads the folders its chats work in, and never the data folder nor a folder no chat works in", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-view-"));
  const other = mkdtempSync(join(tmpdir(), "filament-view-other-"));
  writeFileSync(join(root, "readme.txt"), "the project's own words");
  writeFileSync(join(other, "private.txt"), "no chat's");
  const up = await fakeUpstream(() => undefined);
  const shim = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { ...cfg.agentLoop, enabled: true, roots: [] };
    },
  });
  try {
    const { port } = shim;
    const made = await ask(port, "/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const view = await paired(port, "view");
    /** @param {string} cwd @param {string} path */
    const read = (cwd, path) => ask(port, `/api/files/read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`, { headers: view });
    const mine = await read(root, "readme.txt");
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    assert.match(JSON.stringify(mine.json), /the project's own words/);
    assert.equal((await ask(port, `/api/files/tree?cwd=${encodeURIComponent(root)}`, { headers: view })).status, 200);
    for (const [cwd, path, words] of [
      [shim.dataDir, "config.json", /never reads Filament's data folder/],
      [shim.dataDir, "secret.key", /never reads Filament's data folder/],
      [other, "private.txt", /reads the folders this Filament's chats work in/],
      // The temp folder holds this test's data folder too: refused either way.
      [join(root, ".."), `${basename(root)}/readme.txt`, /view-only device (reads the folders this Filament's chats work in|never reads Filament's data folder)/],
    ]) {
      const r = await read(String(cwd), String(path));
      assert.equal(r.status, 403, `${cwd} ${path}: ${JSON.stringify(r.json)}`);
      assert.match(r.json.error, /** @type {RegExp} */ (words));
    }
    for (const row of ["/files/tree", "/git/status", "/git/log", "/git/branches", `/memory/sessions/${encodeURIComponent(made.json.id)}/changes`])
      assert.equal((await ask(port, `/api${row}?cwd=${encodeURIComponent(shim.dataDir)}`, { headers: view })).status, 403, row);
    // A row shaped like a view row is its own: /flows/uncommitted walks the chat's folder with git.
    const flows = await ask(port, `/api/sessions/${encodeURIComponent(made.json.id)}/flows/uncommitted`, { headers: view });
    assert.equal(flows.status, 403, JSON.stringify(flows.json));
    assert.match(flows.json.error, /a view-only device reads/);
    assert.equal((await ask(port, `/api/sessions/${encodeURIComponent(made.json.id)}/flows`, { headers: view })).status, 200);
    // A full device and this computer read as the folder rules let anyone: the fence is a view device's.
    const full = await paired(port, "full");
    assert.equal((await ask(port, `/api/files/read?cwd=${encodeURIComponent(other)}&path=private.txt`, { headers: full })).status, 200);
    assert.equal((await ask(port, `/api/files/read?cwd=${encodeURIComponent(other)}&path=private.txt`)).status, 200);
  } finally {
    await shim.stop();
    await up.close();
    for (const d of [root, other]) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("viewFolderRefusal: a chat's folder and inside it; never the data folder, inside or around it, a home folder or what holds it, a drive's root, a share", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-view-fence-"));
  try {
    const home = join(base, "home");
    const proj = join(home, "proj");
    const data = join(home, ".filament");
    for (const d of [join(proj, "src"), join(home, ".ssh"), data]) mkdirSync(d, { recursive: true });
    const drive = parse(base).root;
    const o = { folders: [proj, home, drive, data, base], dataDir: data, home };
    assert.equal(viewFolderRefusal(proj, o), null);
    assert.equal(viewFolderRefusal(join(proj, "src"), o), null, "inside a chat's folder");
    assert.equal(viewFolderRefusal("", o), null, "none asked: the row says one is required");
    for (const [cwd, why] of [
      [home, "a chat in the home folder opens nothing"],
      [join(home, ".ssh"), "under a home folder, in no other chat's folder"],
      [base, "around the data folder"],
      [drive, "a drive's root"],
      [data, "the data folder"],
    ])
      assert.match(String(viewFolderRefusal(cwd, o)), /view-only device/, why);
    // A chat at another volume's root opens nothing on it, though no data or home folder is there (Windows's).
    if (process.platform === "win32")
      for (const cwd of [otherRoot(base), join(otherRoot(base), "proj")]) assert.match(String(viewFolderRefusal(cwd, { ...o, folders: [proj, otherRoot(base)] })), /is none of them$/, cwd);
    assert.match(String(viewFolderRefusal(proj, { ...o, folders: [] })), /is none of them/, "no chat: nothing");
    assert.match(String(viewFolderRefusal("\\\\server\\share\\proj", { ...o, folders: ["\\\\server\\share\\proj"] })), /is none of them/, "another computer's share, never asked");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// (fails before: yes — "H:\" was keyed "h:", that drive's current folder, so a chat at a drive's root on another volume
// than the home and data folders passed as a folder like any other and opened the whole volume)
test("viewFolderRefusal: a drive's root on another volume than the home and data folders is refused, and what is under it", { skip: process.platform === "win32" ? false : "a drive's root on another volume is Windows's" }, (t) => {
  const base = mkdtempSync(join(tmpdir(), "filament-view-root-"));
  try {
    const drive = parse(process.cwd()).root;
    if (drive.toLowerCase() === parse(base).root.toLowerCase()) return t.skip("this folder and the temporary one are on one volume");
    const o = { folders: [drive], dataDir: join(base, "data"), home: join(base, "home") };
    assert.match(String(viewFolderRefusal(process.cwd(), o)), /is none of them/, "under another volume's root");
    assert.match(String(viewFolderRefusal(drive, o)), /is none of them/, "another volume's root");
    assert.equal(viewFolderRefusal(process.cwd(), { ...o, folders: [process.cwd()] }), null, "a chat's own folder there is read");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// (fails before: yes — a view-only device's GET /agent-accounts asked each agent's CLI afresh, and /coding-agents fetched
// the registry: reads that act on this machine)
test("a view-only device's reads of the accounts and the coding agents start nothing; a full device's and this computer's do", async () => {
  let refreshed = 0;
  let fetched = 0;
  const route = createRouter([
    ...codingAgentRoutes(/** @type {any} */ ({ codingAgents: { refreshIfStale: () => void fetched++, list: () => ({ agents: [] }) } })),
    ...upstreamRoutes(/** @type {any} */ ({ config: { get: () => ({ upstreams: [] }) }, logins: { refresh: () => void refreshed++ } })),
  ]);
  const res = () => ({ writableEnded: false, destroyed: false, writeHead() {}, end() {} });
  for (const [who, n] of /** @type {[any, number][]} */ ([[{ kind: "device", scope: "view" }, 0], [{ kind: "device", scope: "full" }, 1], [{ kind: "local" }, 2]])) {
    for (const path of ["/agent-accounts", "/coding-agents"]) {
      const m = route("GET", path);
      assert.ok(m, path);
      await m.handler(/** @type {any} */ ({ req: {}, res: res(), url: new URL(`http://x${path}`), path, method: "GET", params: m.params, who }), {});
    }
    assert.deepEqual([refreshed, fetched], [n, n], JSON.stringify(who));
  }
});

// (fails before: yes — /memory/status?probe=1 started the engine for any caller the list let read it)
test("memory's status: a view device's probe starts nothing; this computer's does", async () => {
  /** @type {boolean[]} */
  const probes = [];
  const route = createRouter(memoryRoutes(/** @type {any} */ ({ memory: { status: async (/** @type {any} */ o) => (probes.push(!!o?.probe), { ok: true }) }, config: { get: () => ({}) } })));
  const m = route("GET", "/memory/status");
  assert.ok(m);
  const res = () => /** @type {any} */ ({ writeHead() {}, setHeader() {}, end() {}, headersSent: false });
  const url = new URL("http://x/api/memory/status?probe=1");
  await m.handler({ url, res: res(), params: {}, who: { kind: "device", scope: "view", device: {} } });
  await m.handler({ url, res: res(), params: {}, who: { kind: "device", scope: "full", device: {} } });
  await m.handler({ url, res: res(), params: {}, who: { kind: "local" } });
  assert.deepEqual(probes, [false, true, true]);
});
