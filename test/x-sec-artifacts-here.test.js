// @ts-check
// This machine's artifacts' addresses (`<name>.art.localhost`) where its programs need the owner key (x41, after the flip
// of s0c): a frame of Filament's page, a browser's tab, carries no credential of Filament's, so a page is let in by a
// pass in its path. Filament's page holds a pass for every artifact (/api/state's addresses); a page's own load trades
// it for its artifact's own, under which its files and its data are read — a module it imports from the top by its
// Referer. A program with no pass — a chat's shell, a script — reads and writes no artifact; the owner key, a device's
// sign-in are answered with none; "legacy" answers any program here, as its name says.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactsHandler, createPasses, holderPass, localArtifactsDoor, NO_PASS_HERE, passedHere, PASS_HERE_WORDS, VIEW_WRITES_WORDS } from "../src/http/artifacts.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createDevices } from "../src/services/devices.js";
import { OWNER_HEADER, createOwner, ownerKeyOf } from "../src/services/owner.js";
import { artifactAddress, hereArtifactOf, passless, useArtifactsAt } from "../src/ui/harness/lib/artifacts.js";
import { viewReads } from "../src/http/admin/remote.js";
import { saidUrl } from "../src/app/browser/driver.js";
import { startApp } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";

const by = { chain: "c1", model: "m", folder: "/p", helper: null, call: null };
/** @param {Record<string, string>} o */
const files = (o) => Object.entries(o).map(([path, text]) => ({ path, data: Buffer.from(text) }));
/** A page's own load, as a browser says it. */
const LOAD = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" };
/** A page's fetch. */
const FETCH = { "sec-fetch-mode": "cors" };

/**
 * A request over node:http to this machine's port, with the Host and headers given.
 * @param {number} port @param {string} host @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: string }} [o]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: string }>}
 */
const ask = (port, host, path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, agent: false, headers: { host, ...(body ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: Number(res.statusCode), headers: res.headers, body: b }));
    });
    req.on("error", reject);
    req.end(body);
  });

/** The pass a 302 led under: its `/~<pass>`. @param {{ headers: http.IncomingHttpHeaders }} r */
const passOf = (r) => /^\/~([^/]+)\//.exec(String(r.headers.location))?.[1] || "";

/**
 * This machine's artifacts' door on a listener of its own, over a real store with two pages and the owner key at its
 * port, as server.js mints it. @param {{ trust?: "token" | "legacy" }} [o]
 */
async function serve({ trust = "token" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "filament-art-here-"));
  const store = createArtifactStore({ dataDir: join(dir, "data"), log: () => {} });
  const spend = /** @type {any} */ (store.publish({ title: "Spend", type: "page", files: files({ "index.html": `<p>spend</p><script type="module" src="/app.js"></script>`, "app.js": "export const x = 1" }), by, who: "c1" })).artifact.name;
  const other = /** @type {any} */ (store.publish({ title: "Other", type: "page", files: files({ "index.html": "<p>other</p>" }), by, who: "c1" })).artifact.name;
  const settings = { loopbackTrust: trust, host: "127.0.0.1", allowedHosts: [], maxBodyBytes: 1 << 20 };
  const server = () => settings;
  const devices = createDevices({ pageHost: () => "filament-ffffffffffff.localhost" });
  const passes = createPasses();
  /** @type {number} */
  let port = 0;
  const answer = createArtifactsHandler({ store, server, port: () => port });
  const door = localArtifactsDoor({ answer, server, devices, passes });
  const listener = http.createServer((req, res) => {
    const url = new URL(String(req.url), "http://x");
    const host = String(req.headers.host || "").split(":")[0];
    const still = host.endsWith(".still.art.localhost");
    void door(req, res, host.replace(/\.(still\.)?art\.localhost$/, ""), url, { still });
  });
  await new Promise((r) => listener.listen(0, "127.0.0.1", () => r(undefined)));
  port = /** @type {import("node:net").AddressInfo} */ (listener.address()).port;
  const owner = createOwner({ dataDir: dir });
  owner.listen(port);
  return {
    port,
    spend,
    other,
    devices,
    passes,
    settings,
    /** @param {string} name */
    at: (name) => `${name}.art.localhost:${port}`,
    /** The pass Filament's page is given, as /api/state gives it the owner's. @param {any} [who] */
    holder: (who = { kind: "local", owner: true }) => holderPass(passes, who, settings),
    ownerKey: () => ({ [OWNER_HEADER]: owner.key() }),
    close: async () => {
      await new Promise((r) => listener.close(() => r(undefined)));
      owner.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

describe("this machine's artifacts where its programs need the owner key", () => {
  // (fails before: yes — any program on this computer read and wrote every artifact: http/artifacts.js answered every
  // loopback caller, `!network && !isLocalCaller(req)` its only fence)
  test("a program with no pass reads no page, no file, no data, and writes none — in words", async () => {
    const s = await serve();
    try {
      for (const [path, o] of /** @type {[string, any][]} */ ([
        ["/", { headers: LOAD }],
        ["/app.js", {}],
        ["/_filament/db/", { headers: FETCH }],
        ["/_filament/db/notes", { method: "POST", headers: { origin: `http://${s.at(s.spend)}` }, body: JSON.stringify({ text: "x" }) }],
        ["/_filament/changes", {}],
      ])) {
        const r = await ask(s.port, s.at(s.spend), path, o);
        assert.deepEqual([r.status, r.body], [403, `${NO_PASS_HERE}\n`], path);
      }
    } finally {
      await s.close();
    }
  });

  test("the page's pass for every artifact: a page's own load trades it for that artifact's own; nothing else is read by it", async () => {
    const s = await serve();
    try {
      const hp = s.holder();
      const load = await ask(s.port, s.at(s.spend), `/~${hp}/?in=c1`, { headers: LOAD });
      assert.equal(load.status, 302);
      const own = passOf(load);
      assert.ok(own && own !== hp, "a pass of its own");
      assert.equal(load.headers.location, `/~${own}/?in=c1`, "its path and its query kept");
      // The pass for every artifact reads nothing itself.
      const read = await ask(s.port, s.at(s.spend), `/~${hp}/_filament/db/`, { headers: FETCH });
      assert.deepEqual([read.status, read.body], [403, `${NO_PASS_HERE}\n`]);
      // An old version's address keeps its path.
      const old = await ask(s.port, s.at(s.spend), `/~${hp}/_filament/v/1/`, { headers: LOAD });
      assert.match(String(old.headers.location), /^\/~[^/]+\/_filament\/v\/1\/$/);
    } finally {
      await s.close();
    }
  });

  test("under its own pass: its page, its files from the top by the page's Referer, its data read and written — never another's", async () => {
    const s = await serve();
    try {
      const own = passOf(await ask(s.port, s.at(s.spend), `/~${s.holder()}/`, { headers: LOAD }));
      const page = await ask(s.port, s.at(s.spend), `/~${own}/`, { headers: LOAD });
      assert.equal(page.status, 200);
      assert.match(page.body, /<p>spend<\/p>/);
      assert.match(page.body, new RegExp(`src="/~${own.replace(/[.]/g, "\\.")}/app\\.js"`), "an address from the top under its pass");
      assert.match(page.body, new RegExp(`data-base="/~${own.replace(/[.]/g, "\\.")}"`), "its small script reads its path");
      assert.equal(page.headers["referrer-policy"], "same-origin", "its address goes to its own address alone");
      // A module it imports from the top comes with no pass, its page's address as its Referer: led under the pass.
      const mod = await ask(s.port, s.at(s.spend), "/lib.js", { headers: { "sec-fetch-mode": "cors", referer: `http://${s.at(s.spend)}/~${own}/app.js` } });
      assert.deepEqual([mod.status, mod.headers.location], [307, `/~${own}/lib.js`]);
      assert.equal((await ask(s.port, s.at(s.spend), `/~${own}/app.js`)).status, 200);
      // Its data, written by its own origin and read.
      const wrote = await ask(s.port, s.at(s.spend), `/~${own}/_filament/db/notes`, { method: "POST", headers: { ...FETCH, origin: `http://${s.at(s.spend)}` }, body: JSON.stringify({ text: "hi" }) });
      assert.equal(wrote.status, 200, wrote.body);
      const list = await ask(s.port, s.at(s.spend), `/~${own}/_filament/db/notes`, { headers: FETCH });
      assert.equal(JSON.parse(list.body).records.length, 1);
      // Its pass at another artifact's address is no pass; the pass for every artifact at a Referer leads nowhere.
      const there = await ask(s.port, s.at(s.other), `/~${own}/`, { headers: LOAD });
      assert.deepEqual([there.status, there.body], [403, `${PASS_HERE_WORDS}\n`]);
      const byHolder = await ask(s.port, s.at(s.spend), "/lib.js", { headers: { "sec-fetch-mode": "cors", referer: `http://${s.at(s.spend)}/~${s.holder()}/` } });
      assert.equal(byHolder.status, 403);
      // Another's Referer, at this address, leads nowhere either.
      const crossed = await ask(s.port, s.at(s.other), "/lib.js", { headers: { "sec-fetch-mode": "cors", referer: `http://${s.at(s.spend)}/~${own}/` } });
      assert.equal(crossed.status, 403);
      assert.equal((await ask(s.port, s.at(s.spend), "/~not.apass/", { headers: LOAD })).status, 403, "a pass no key of this Filament's signed");
    } finally {
      await s.close();
    }
  });

  test("a still preview's address trades for a pass that writes nothing; a view-only device's and a revoked one's", async () => {
    const s = await serve();
    try {
      const still = `${s.spend}.still.art.localhost:${s.port}`;
      const own = passOf(await ask(s.port, still, `/~${s.holder()}/_filament/v/1/`, { headers: LOAD }));
      assert.ok(own);
      const wrote = await ask(s.port, still, `/~${own}/_filament/db/notes`, { method: "POST", headers: { ...FETCH, origin: `http://${still}` }, body: JSON.stringify({ text: "x" }) });
      assert.equal(wrote.status, 403);
      assert.equal((await ask(s.port, s.at(s.spend), `/~${own}/`, { headers: LOAD })).status, 403, "a still preview's pass is no pass at its page's own address");
      // A view-only device's pass reads, and writes nothing.
      const phone = /** @type {any} */ (s.devices.claim(s.devices.startPairing({ scope: "view" }).code, { name: "Phone", from: "100.1.2.3" }));
      const viewOwn = passOf(await ask(s.port, s.at(s.spend), `/~${s.holder({ kind: "device", scope: "view", device: phone.device })}/`, { headers: LOAD }));
      const viewWrote = await ask(s.port, s.at(s.spend), `/~${viewOwn}/_filament/db/notes`, { method: "POST", headers: { ...FETCH, origin: `http://${s.at(s.spend)}` }, body: JSON.stringify({ text: "x" }) });
      assert.deepEqual([viewWrote.status, viewWrote.body], [403, `${VIEW_WRITES_WORDS}\n`]);
      assert.equal((await ask(s.port, s.at(s.spend), `/~${viewOwn}/_filament/db/`, { headers: FETCH })).status, 200, "it reads");
      // A device revoked: what it was given is good no more.
      const laptop = /** @type {any} */ (s.devices.claim(s.devices.startPairing({ scope: "full" }).code, { name: "Laptop", from: "100.1.2.4" }));
      const hp = s.holder({ kind: "device", scope: "full", device: laptop.device });
      const lapOwn = passOf(await ask(s.port, s.at(s.spend), `/~${hp}/`, { headers: LOAD }));
      s.devices.revoke(laptop.device.id);
      assert.equal((await ask(s.port, s.at(s.spend), `/~${lapOwn}/`, { headers: LOAD })).status, 403);
      assert.equal((await ask(s.port, s.at(s.spend), `/~${hp}/`, { headers: LOAD })).status, 403);
    } finally {
      await s.close();
    }
  });

  test("the owner key is answered with no pass; a caller through a proxy is no one here; legacy answers any program, a page under a pass's path too", async () => {
    const s = await serve();
    try {
      const keyed = await ask(s.port, s.at(s.spend), "/_filament/db/", { headers: { ...FETCH, ...s.ownerKey() } });
      assert.equal(keyed.status, 200, keyed.body);
      const hp = s.holder();
      const own = passOf(await ask(s.port, s.at(s.spend), `/~${hp}/`, { headers: LOAD }));
      const far = await ask(s.port, s.at(s.spend), `/~${own}/`, { headers: { ...LOAD, "x-forwarded-for": "100.1.2.3" } });
      assert.deepEqual([far.status, far.body], [403, "An artifact answers only this machine.\n"]);
      s.settings.loopbackTrust = "legacy";
      assert.equal((await ask(s.port, s.at(s.spend), "/", { headers: LOAD })).status, 200, "legacy: any program here, with no pass");
      // (the review of x41: a page Filament's page framed under a pass, then the switch to legacy, read its path as a file)
      for (const pass of [hp, own]) {
        const page = await ask(s.port, s.at(s.spend), `/~${pass}/`, { headers: LOAD });
        assert.equal(page.status, 200, `legacy, under a pass's path: ${page.body}`);
        assert.match(page.body, /<p>spend<\/p>/);
        assert.equal((await ask(s.port, s.at(s.spend), `/~${pass}/app.js`)).status, 200, "its files under it too");
      }
    } finally {
      await s.close();
    }
  });

  // (the review of x41: a page that goes to an address from the top — `location = "/next"` — was refused)
  test("a page's own navigation from the top is led under its pass by its Referer; the pass for every artifact leads none", async () => {
    const s = await serve();
    try {
      const own = passOf(await ask(s.port, s.at(s.spend), `/~${s.holder()}/`, { headers: LOAD }));
      const next = await ask(s.port, s.at(s.spend), "/next.html?x=1", { headers: { ...LOAD, referer: `http://${s.at(s.spend)}/~${own}/` } });
      assert.deepEqual([next.status, next.headers.location], [307, `/~${own}/next.html?x=1`]);
      const byHolder = await ask(s.port, s.at(s.spend), "/next.html", { headers: { ...LOAD, referer: `http://${s.at(s.spend)}/~${s.holder()}/` } });
      assert.equal(byHolder.status, 403);
    } finally {
      await s.close();
    }
  });

  // (the review of x41: a browser paired here was "local", its passes good for 30 days whatever became of its pairing,
  // and the owner key's outlived the key)
  test("a browser paired here: its passes end with its revoke; the owner key's are this run's alone", async () => {
    const s = await serve();
    try {
      const here = /** @type {any} */ (s.devices.claim(s.devices.startPairing({ scope: "full", here: true }).code, { name: "Chrome here", local: true, at: "filament-ffffffffffff.localhost" }));
      assert.equal(here.ok, true, here.why);
      const hp = s.holder({ kind: "local", owner: true, here: here.device.id });
      const own = passOf(await ask(s.port, s.at(s.spend), `/~${hp}/`, { headers: LOAD }));
      assert.equal((await ask(s.port, s.at(s.spend), `/~${own}/`, { headers: LOAD })).status, 200);
      s.devices.revoke(here.device.id);
      assert.equal((await ask(s.port, s.at(s.spend), `/~${own}/`, { headers: LOAD })).status, 403, "its artifact's pass ended with it");
      assert.equal((await ask(s.port, s.at(s.spend), `/~${hp}/`, { headers: LOAD })).status, 403, "and its pass for every artifact");
      // A pass that names "local" alone, as one of another run would, is good no more.
      const old = s.passes.give({ name: s.spend, still: false, writes: true, who: "local", from: "here" });
      const elsewhere = s.passes.give({ name: s.spend, still: false, writes: true, who: "local:another-run", from: "here" });
      assert.equal((await ask(s.port, s.at(s.spend), `/~${old}/`, { headers: LOAD })).status, 403);
      assert.equal((await ask(s.port, s.at(s.spend), `/~${elsewhere}/`, { headers: LOAD })).status, 403);
    } finally {
      await s.close();
    }
  });

  test("the chats' browser opens an artifact of this machine's under the pass; any other address as asked", () => {
    const pass = () => "abc.def";
    assert.equal(passedHere("http://spend-k3f9.art.localhost:20300/?v=2", 20300, pass), "http://spend-k3f9.art.localhost:20300/~abc.def/?v=2");
    assert.equal(passedHere("http://spend-k3f9.still.art.localhost:20300/_filament/v/1/", 20300, pass), "http://spend-k3f9.still.art.localhost:20300/~abc.def/_filament/v/1/");
    assert.equal(passedHere("http://spend-k3f9.art.localhost:20300/~own.pass/", 20300, pass), "http://spend-k3f9.art.localhost:20300/~own.pass/", "one under a pass already");
    assert.equal(passedHere("http://spend-k3f9.art.localhost:9999/", 20300, pass), "http://spend-k3f9.art.localhost:9999/", "another port: no Filament of this one's");
    assert.equal(passedHere("https://example.com/", 20300, pass), "https://example.com/");
    assert.equal(passedHere("http://localhost:20300/ui/harness.html", 20300, pass), "http://localhost:20300/ui/harness.html");
    // (the review of x41: a name ending in a dot, which the front door answers, got the pass and kept its own in what the
    // chat was told)
    assert.equal(passedHere("http://spend-k3f9.art.localhost.:20300/", 20300, pass), "http://spend-k3f9.art.localhost.:20300/", "a name ending in a dot: none");
  });

  test("the chats' browser says an artifact's address without its pass: what a model reads never carries one", () => {
    assert.equal(saidUrl("http://spend-k3f9.art.localhost:20300/~abc.def/_filament/v/2/?x=1"), "http://spend-k3f9.art.localhost:20300/_filament/v/2/?x=1");
    assert.equal(saidUrl("http://spend-k3f9.still.art.localhost:20300/~abc.def"), "http://spend-k3f9.still.art.localhost:20300");
    assert.equal(saidUrl("http://spend-k3f9.art.localhost.:20300/~abc.def/"), "http://spend-k3f9.art.localhost.:20300/", "its name ending in a dot too");
    assert.equal(saidUrl("http://spend-k3f9.art.localhost/~abc.def/"), "http://spend-k3f9.art.localhost/", "at http's own port");
    assert.equal(saidUrl("https://example.com/~abc.def/"), "https://example.com/~abc.def/", "a site's own path as it is");
  });

  test("a view-only device asks an artifact's address to open or copy, and nothing else it may not read", () => {
    assert.equal(viewReads("POST", "/artifacts/:name/pass"), true);
    assert.equal(viewReads("POST", "/artifacts/:name/newest"), false);
    assert.equal(viewReads("POST", "/artifacts"), false);
  });

  // (the review of x41: a page read under Any program framed every artifact with no pass after the switch to the owner key)
  test("Filament's page reads where its artifacts are again once a setting changed; a read that fails leaves them", async () => {
    const was = globalThis.fetch;
    let st = { artifacts: { page: "http://{name}.art.localhost:20300/", still: "http://{name}.still.art.localhost:20300/" } };
    let fails = false;
    globalThis.fetch = /** @type {any} */ (async () => {
      if (fails) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(st), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      // A page of its own: the module as another page loads it.
      const { artifactsPlaced, artifactsPlacedAgain } = await import(`../src/ui/harness/artifact-frame.js?again=${1}`);
      await artifactsPlaced(async () => {});
      assert.equal(artifactAddress("spend-k3f9", 20300), "http://spend-k3f9.art.localhost:20300/");
      st = { artifacts: { page: "http://{name}.art.localhost:20300/~abc.def/", still: "http://{name}.still.art.localhost:20300/~abc.def/" } };
      await artifactsPlacedAgain();
      assert.equal(artifactAddress("spend-k3f9", 20300), "http://spend-k3f9.art.localhost:20300/~abc.def/", "under the pass once the owner key is needed");
      fails = true;
      await artifactsPlacedAgain();
      assert.equal(artifactAddress("spend-k3f9", 20300), "http://spend-k3f9.art.localhost:20300/~abc.def/", "a read that failed: as they were");
    } finally {
      globalThis.fetch = was;
      useArtifactsAt(undefined);
    }
  });

  // (fails before: yes — the hunt on x41: a frame kept the address it was placed at, so after Filament started again its
  // page asked everything under a pass that was no more, and Back or a version asked after a switch of the owner key
  // loaded it with the pass, or none, of before; a right-click on a link copied it as written, which no pass opens)
  test("Filament's page: a restart's new pass reaches the frames it holds, each load takes the address as it stands, and a link's right-click goes under the artifact's own pass", async () => {
    const dom = stubDocument();
    const g = /** @type {any} */ (globalThis);
    const had = { fetch: g.fetch, location: g.location, MutationObserver: g.MutationObserver, open: g.window.open, EventSource: g.EventSource };
    // The page's own listeners and frames, which nothing here fires.
    const own = ["addEventListener", "removeEventListener", "requestAnimationFrame"].filter((k) => !(k in g));
    g.addEventListener ||= () => {};
    g.removeEventListener ||= () => {};
    g.requestAnimationFrame ||= (/** @type {() => void} */ fn) => setTimeout(fn, 0);
    // The events feed a frame's publishes come by: none here.
    g.EventSource = class {
      static CLOSED = 2;
      readyState = 0;
      addEventListener() {}
      close() {}
    };
    const at = (/** @type {string} */ pass) => ({ artifacts: { page: `http://{name}.art.localhost:20300/~${pass}/`, still: `http://{name}.still.art.localhost:20300/~${pass}/` } });
    let st = at("one.run");
    /** @type {string[]} */
    const asked = [];
    g.fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
      asked.push(`${init?.method || "GET"} ${new URL(url, "http://127.0.0.1:20300").pathname}`);
      const body = String(url).endsWith("/pass") ? { address: "http://spend-k3f9.art.localhost:20300/~its.own/" } : st;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    g.location = { hostname: "127.0.0.1", port: "20300", protocol: "http:", origin: "http://127.0.0.1:20300", href: "http://127.0.0.1:20300/ui/harness.html" };
    g.MutationObserver = class {
      observe() {}
    };
    /** @type {string[]} */
    const opened = [];
    g.window.open = (/** @type {string} */ to) => void opened.push(to);
    try {
      const { artifactFrame, artifactPreview, artifactsPlaced, artifactsPlacedAgain, passArtifactLinks } = await import(`../src/ui/harness/artifact-frame.js?moved=${1}`);
      await artifactsPlaced(async () => {});
      const f = artifactFrame("spend-k3f9", { title: "Spend", onTell() {}, onAsk() {} });
      dom.document.body.append(f.el);
      await new Promise((r) => setImmediate(r));
      const frame = /** @type {any} */ (f.el.querySelector("iframe.artifact-frame"));
      assert.equal(frame.src, "http://spend-k3f9.art.localhost:20300/~one.run/");
      // A still preview, as the Artifacts page's grid holds one.
      const peek = artifactPreview("spend-k3f9", 2, "Spend");
      dom.document.body.append(peek);
      await new Promise((r) => setImmediate(r));
      const still = /** @type {any} */ (peek.querySelector("iframe.artifact-peek-frame"));
      assert.equal(still.src, "http://spend-k3f9.still.art.localhost:20300/~one.run/_filament/v/2/");
      // Filament started again: its run's pass is new, and the frames load under it.
      st = at("two.run");
      await artifactsPlacedAgain();
      assert.equal(frame.src, "http://spend-k3f9.art.localhost:20300/~two.run/", "the frame's page loaded again under the new pass");
      assert.equal(still.src, "http://spend-k3f9.still.art.localhost:20300/~two.run/_filament/v/2/", "the still preview too");
      // A read that moves nothing loads nothing again.
      frame.src = "as it was";
      await artifactsPlacedAgain();
      assert.equal(frame.src, "as it was");
      // The addresses moved with no word to the frame: each load takes them as they stand.
      useArtifactsAt(at("three.run").artifacts);
      f.showVersion(2);
      assert.equal(frame.src, "http://spend-k3f9.art.localhost:20300/~three.run/_filament/v/2/");
      f.showVersion(null);
      assert.equal(frame.src, "http://spend-k3f9.art.localhost:20300/~three.run/");
      // A right-click on a link to an artifact here: no menu of the browser's, which would copy the link as written; its
      // Open in browser goes under the artifact's own pass.
      /** @type {Record<string, Function>} */
      const heard = {};
      passArtifactLinks(/** @type {any} */ ({ addEventListener: (/** @type {string} */ type, /** @type {Function} */ fn) => void (heard[type] = fn) }));
      const link = dom.document.createElement("a");
      link.setAttribute("href", "http://spend-k3f9.art.localhost:20300/");
      /** @type {any} */ (link).href = "http://spend-k3f9.art.localhost:20300/";
      dom.document.body.append(link);
      let prevented = false;
      heard.contextmenu({ type: "contextmenu", target: link, preventDefault: () => void (prevented = true) });
      assert.equal(prevented, true, "the browser's own menu, the app's among them, never shows");
      const rows = dom.document.body.querySelectorAll(".zc-menu .zc-menu-item");
      assert.deepEqual(rows.map((r) => r.textContent.trim()), ["Open in browser", "Copy link"]);
      rows[0].dispatch("click");
      for (let i = 0; i < 20 && !opened.length; i++) await new Promise((r) => setImmediate(r));
      assert.deepEqual(opened, ["http://spend-k3f9.art.localhost:20300/~its.own/"], "its own pass, asked of the server");
      assert.ok(asked.includes("POST /api/artifacts/spend-k3f9/pass"), asked.join(" | "));
      // Another link: the browser's own menu, as it is.
      const other = dom.document.createElement("a");
      /** @type {any} */ (other).href = "https://example.com/";
      other.setAttribute("href", "https://example.com/");
      prevented = false;
      heard.contextmenu({ type: "contextmenu", target: other, preventDefault: () => void (prevented = true) });
      assert.equal(prevented, false);
    } finally {
      g.fetch = had.fetch;
      g.location = had.location;
      g.MutationObserver = had.MutationObserver;
      g.window.open = had.open;
      if (had.EventSource) g.EventSource = had.EventSource;
      else delete g.EventSource;
      for (const k of own) delete g[k];
      useArtifactsAt(undefined);
      dom.restore();
    }
  });

  test("Filament's page: an address that leaves it is read for a pass of its artifact's own; one shown never shows a pass", () => {
    try {
      useArtifactsAt({ page: "http://{name}.art.localhost:20300/~abc.def/", still: "http://{name}.still.art.localhost:20300/~abc.def/" });
      assert.deepEqual(hereArtifactOf("http://spend-k3f9.art.localhost:20300/"), { name: "spend-k3f9", still: false, path: "/" });
      assert.deepEqual(hereArtifactOf("http://spend-k3f9.art.localhost:20300/~abc.def/_filament/v/2/?in=c1#top"), { name: "spend-k3f9", still: false, path: "/_filament/v/2/?in=c1#top" }, "the page's pass taken out");
      assert.deepEqual(hereArtifactOf("http://spend-k3f9.still.art.localhost:20300/x"), { name: "spend-k3f9", still: true, path: "/x" }, "a still preview's, opened as one");
      assert.equal(hereArtifactOf("http://spend-k3f9.art.localhost:9999/"), null, "another port's");
      assert.equal(hereArtifactOf("http://a.b.art.localhost:20300/"), null);
      assert.equal(hereArtifactOf("https://example.com/x"), null);
      assert.equal(passless("http://spend-k3f9.art.localhost:20300/~abc.def/_filament/v/2/"), "http://spend-k3f9.art.localhost:20300/_filament/v/2/");
      useArtifactsAt({ page: "http://{name}.art.localhost:20300/", still: "http://{name}.still.art.localhost:20300/" });
      assert.equal(hereArtifactOf("http://spend-k3f9.art.localhost:20300/"), null, "a Filament that gives no pass: as it is");
    } finally {
      useArtifactsAt(undefined);
    }
  });
});

describe("a real Filament whose server.loopbackTrust is token", () => {
  /** @type {Awaited<ReturnType<typeof startApp>> | null} */
  let shim = null;
  after(async () => {
    await shim?.stop();
  });

  test("/api/state gives the owner's page this machine's addresses under its pass; a load trades it; no pass, no page; an address that leaves the page carries its artifact's own", async () => {
    let name = "";
    shim = await startApp({
      configure: (c, { dataDir }) => {
        c.server.loopbackTrust = "token";
        const store = createArtifactStore({ dataDir, log: () => {} });
        name = /** @type {any} */ (store.publish({ title: "Spend", type: "page", files: files({ "index.html": "<p>spend</p>" }), by, who: "c1" })).artifact.name;
      },
    });
    const port = shim.port;
    const owner = { [OWNER_HEADER]: ownerKeyOf(shim.dataDir) };
    const st = JSON.parse((await ask(port, `127.0.0.1:${port}`, "/api/state", { headers: owner })).body);
    assert.match(String(st.artifacts?.page), new RegExp(`^http://\\{name\\}\\.art\\.localhost:${port}/~[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/$`));
    assert.match(String(st.artifacts?.still), new RegExp(`^http://\\{name\\}\\.still\\.art\\.localhost:${port}/~[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/$`));
    const at = `nope-0000.art.localhost:${port}`;
    const none = await ask(port, at, "/", { headers: LOAD });
    assert.deepEqual([none.status, none.body], [403, `${NO_PASS_HERE}\n`]);
    const hp = /\/~([^/]+)\/$/.exec(String(st.artifacts.page))?.[1];
    const load = await ask(port, at, `/~${hp}/`, { headers: LOAD });
    assert.equal(load.status, 302);
    const page = await ask(port, at, String(load.headers.location), { headers: LOAD });
    assert.deepEqual([page.status, page.body], [404, "No artifact is named nope-0000.\n"], "its own pass reaches the artifact's answer");
    // (the review of x41: Copy link and Open in browser carried the page's pass for every artifact) An address that
    // leaves Filament's page — a link copied, a browser's tab — is asked for, and carries that artifact's pass alone.
    const out = await ask(port, `127.0.0.1:${port}`, `/api/artifacts/${name}/pass`, { method: "POST", headers: owner, body: "{}" });
    assert.equal(out.status, 200, out.body);
    const address = String(JSON.parse(out.body).address);
    const m = new RegExp(`^http://${name}\\.art\\.localhost:${port}/~([A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)/$`).exec(address);
    assert.ok(m && m[1] !== hp, address);
    const opened = await ask(port, `${name}.art.localhost:${port}`, `/~${m[1]}/`, { headers: LOAD });
    assert.equal(opened.status, 200, opened.body);
    assert.match(opened.body, /<p>spend<\/p>/);
    const elsewhere = await ask(port, at, `/~${m[1]}/`, { headers: LOAD });
    assert.equal(elsewhere.status, 403, "its pass is no pass at another artifact's address");
    // A still preview's leaves as one: its own address, under a pass that writes nothing and is no pass at its page's.
    const stillOut = String(JSON.parse((await ask(port, `127.0.0.1:${port}`, `/api/artifacts/${name}/pass`, { method: "POST", headers: owner, body: JSON.stringify({ still: true }) })).body).address);
    const sm = new RegExp(`^http://${name}\\.still\\.art\\.localhost:${port}/~([A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)/$`).exec(stillOut);
    assert.ok(sm, stillOut);
    assert.equal((await ask(port, `${name}.still.art.localhost:${port}`, `/~${sm[1]}/`, { headers: LOAD })).status, 200);
    assert.equal((await ask(port, `${name}.art.localhost:${port}`, `/~${sm[1]}/`, { headers: LOAD })).status, 403, "no pass at its page's address");
    const stillWrote = await ask(port, `${name}.still.art.localhost:${port}`, `/~${sm[1]}/_filament/db/notes`, { method: "POST", headers: { ...FETCH, origin: `http://${name}.still.art.localhost:${port}` }, body: JSON.stringify({ text: "x" }) });
    assert.equal(stillWrote.status, 403, stillWrote.body);
    const unkeyed = await ask(port, `127.0.0.1:${port}`, `/api/artifacts/${name}/pass`, { method: "POST", body: "{}" });
    assert.ok(unkeyed.status === 401 || unkeyed.status === 403, `a program with no key is given none: ${unkeyed.status}`);
    // Under legacy its addresses carry none.
    await ask(port, `127.0.0.1:${port}`, "/api/config/fields", { method: "PATCH", headers: owner, body: JSON.stringify({ set: { "server.loopbackTrust": "legacy" } }) });
    const legacy = JSON.parse((await ask(port, `127.0.0.1:${port}`, "/api/state", { headers: owner })).body);
    assert.equal(legacy.artifacts?.page, `http://{name}.art.localhost:${port}/`);
  });
});
