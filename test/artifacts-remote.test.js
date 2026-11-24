// @ts-check
// The owner's remote Filament of 11-06, Part 4: artifacts on an origin that works from another machine. A tailnet or an
// address on the network gives one host name, never a name under it, so each machine serves every artifact on one https
// origin of its own — a second listener beside the network's, at the port after its — each under its name's path, its
// still preview under /_still/<name>/. What is pure is tested here — a path's artifact, where a page reads its
// artifacts by the Host it reached Filament at, the port, the frame policies and the origin check while the address
// listens, the harness's addresses once the server said where — and the address itself over real TLS: whom it answers
// (this machine and the devices paired with it, a view-only one as a still preview), what it answers (an artifact's
// files and data under its path, Filament's own files at the top, nothing of Filament's API), and, through the app, that
// the session cookie a device's browser holds is HttpOnly and lets an artifact's page into nothing of Filament's.
// (fails before: yes — none of it existed: an artifact answered on this machine alone, and the frame policies named
// http:// alone)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import vm from "node:vm";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "../src/core/artifacts.js";
import { NO_PASS_WORDS, PASS_KEY_FILE, PASS_MS, PASS_WORDS, PAGE_SCRIPT_TEXT, VIEW_WRITES_WORDS, artifactsListener, artifactsPort, createArtifactsHandler, createPasses, passKeyIn } from "../src/http/artifacts.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createDevices } from "../src/services/devices.js";
import { LAN_PORT, lanIdentity } from "../src/services/lan-tls.js";
import { samePrint } from "../src/core/x509.js";
import { startApp } from "./helpers/app.js";
import {
  NO_NETWORK_WORDS, artifactAddress, artifactOrigin, frameableAt, sentTo, spokenOrigin, stillAddress, stillOrigin, useArtifactsAt, versionAddress,
} from "../src/ui/harness/lib/artifacts.js";

const { NETWORK_SANDBOX, STILL_SANDBOX, artifactOfPath, artifactPath, artifactPolicy, artifactsAt, artifactsOnNetwork, harnessOrigins, isArtifactOrigin, pageFramePolicy, rootedUnder, servedPage } = core;

/** @type {any} */
const NETS = { eth0: [{ address: "192.168.1.20", family: "IPv4", internal: false }] };
/** What makes a request over loopback another machine's, as `tailscale serve` hands one on. */
const FAR = { "x-forwarded-for": "192.168.1.9" };
const scratch = () => mkdtempSync(join(tmpdir(), "filament-art-remote-"));
/** What the stand-in server answers the page's /state with, test by test. @type {(url: string) => Promise<Response>} */
let serveState = async () => new Response("{}", { status: 404 });
/** The page's `fetch` while a test asks where it reads artifacts: its client keeps the one it loaded with, so one stands for all. */
const stateFetch = /** @type {any} */ ((/** @type {string} */ url) => serveState(url));

/**
 * An https request to 127.0.0.1 that takes any certificate and says which it was given.
 * @param {number} port @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
 * @returns {Promise<{ status: number, headers: import("node:http").IncomingHttpHeaders, text: string, json: any, fp: string }>}
 */
const askTls = (port, path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = https.request({ host: "127.0.0.1", port, path, method, agent: false, rejectUnauthorized: false, headers: { host: `127.0.0.1:${port}`, ...(text ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
      const fp = /** @type {any} */ (res.socket).getPeerCertificate().fingerprint256;
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(b);
        } catch {}
        resolve({ status: Number(res.statusCode), headers: res.headers, text: b, json, fp });
      });
    });
    req.on("error", reject);
    req.end(text || undefined);
  });

describe("the network's artifacts address, as pure words", () => {
  test("a path names an artifact under its name, its still preview under /_still/; Filament's own files at the top, and anything else, none", () => {
    assert.deepEqual(artifactOfPath("/notes-ab12/"), { name: "notes-ab12", still: false, rest: "/" });
    assert.deepEqual(artifactOfPath("/notes-ab12/css/a.css"), { name: "notes-ab12", still: false, rest: "/css/a.css" });
    assert.deepEqual(artifactOfPath("/notes-ab12"), { name: "notes-ab12", still: false, rest: "" }, "led to its slash by the door");
    assert.deepEqual(artifactOfPath("/_still/notes-ab12/_filament/v/2/"), { name: "notes-ab12", still: true, rest: "/_filament/v/2/" });
    for (const p of ["/", "", "/_filament/page.js", "/_filament/lib/x.js", "/Notes/", "/no%20name/", "/_still/", "/_still/_x/", "/-a/"]) assert.equal(artifactOfPath(p), null, p);
    // (fails before: yes — fx-artifacts: no path carried a pass) Its page's pass, after its name: the path inside after it.
    assert.deepEqual(artifactOfPath("/notes-ab12/~eyJh.c2ln/css/a.css"), { name: "notes-ab12", still: false, rest: "/css/a.css", pass: "eyJh.c2ln" });
    assert.deepEqual(artifactOfPath("/_still/notes-ab12/~eyJh.c2ln/_filament/v/2/"), { name: "notes-ab12", still: true, rest: "/_filament/v/2/", pass: "eyJh.c2ln" });
    assert.deepEqual(artifactOfPath("/notes-ab12/~eyJh.c2ln"), { name: "notes-ab12", still: false, rest: "", pass: "eyJh.c2ln" });
    assert.deepEqual(artifactOfPath("/notes-ab12/~nodot/x"), { name: "notes-ab12", still: false, rest: "/~nodot/x" }, "no pass's shape: a path like any");
    assert.deepEqual(artifactOfPath("/notes-ab12/~a.b.c/x"), { name: "notes-ab12", still: false, rest: "/~a.b.c/x" });
    assert.match(String(/** @type {any} */ (artifactPath("~ab.cd/a.js")).error), /keeps for itself/, "a file's path never starts as a pass does");
    assert.equal(/** @type {any} */ (artifactPath("a/~x.js")).ok, true, "deeper, it is any name");
    // (fails before: yes — the review of fx-artifacts: any name that started with ~ was refused, an Office lock file's too)
    for (const p of ["~$notes.docx", "~x/a.js", "~notes", "~a.b.c/x.js"]) assert.equal(/** @type {any} */ (artifactPath(p)).ok, true, `${p}: no pass's shape`);
  });

  test("where a page reads its artifacts, by the Host it reached Filament at: this machine's own address on that port — an SSH tunnel's too —, else the network's artifacts address while it listens, else none", () => {
    const own = (/** @type {string} */ p) => ({ page: `http://{name}.art.localhost${p}/`, still: `http://{name}.still.art.localhost${p}/` });
    assert.deepEqual(artifactsAt("127.0.0.1:20300", 20344), own(":20300"));
    assert.deepEqual(artifactsAt("localhost:9000", null), own(":9000"), "a tunnel's port leads to this Filament as the page's own does");
    assert.deepEqual(artifactsAt("llm.localhost", 20344), own(""));
    assert.deepEqual(artifactsAt("192.168.1.20:20343", 20344), { page: "https://192.168.1.20:20344/{name}/", still: "https://192.168.1.20:20344/_still/{name}/" });
    assert.deepEqual(artifactsAt("Workstation.tail1234.ts.net", 20344), { page: "https://workstation.tail1234.ts.net:20344/{name}/", still: "https://workstation.tail1234.ts.net:20344/_still/{name}/" }, "a tailnet's name: tailscale serve serves the same port");
    assert.equal(artifactsAt("192.168.1.20:20343", null), null, "the network's artifacts address does not listen: none");
    assert.equal(artifactsAt("", 20344), null);
    assert.equal(artifactsAt("bad host:x", 20344), null);
  });

  test("its port: the one after the network listener's; any free one where that is", () => {
    assert.deepEqual([artifactsPort(undefined), artifactsPort({ port: 20343 }), artifactsPort({ port: 20400 }), artifactsPort({ port: 0 }), artifactsPort({ port: /** @type {any} */ ("x") }), artifactsPort({ port: 65535 })], [LAN_PORT + 1, 20344, 20401, 0, LAN_PORT + 1, LAN_PORT + 1]);
  });

  test("while it listens, Filament's pages may frame it over https and its origin is an artifact's; off, both as before. An artifact asked for there is framed by the device's harness over https on that name", () => {
    const before = pageFramePolicy(20300);
    assert.equal(before, "frame-src http://*.art.localhost:20300; frame-ancestors 'self'");
    assert.equal(isArtifactOrigin("https://192.168.1.20:20344"), false);
    artifactsOnNetwork(20344, true);
    try {
      assert.equal(pageFramePolicy(20300), "frame-src http://*.art.localhost:20300 https://*:20344; frame-ancestors 'self'");
      assert.equal(isArtifactOrigin("https://192.168.1.20:20344"), true);
      assert.equal(isArtifactOrigin("https://workstation.tail1234.ts.net:20344"), true);
      for (const o of ["https://192.168.1.20:20343", "https://workstation.tail1234.ts.net", "http://192.168.1.20:20344", "http://127.0.0.1:20300"]) assert.equal(isArtifactOrigin(o), false, o);
      assert.ok(isArtifactOrigin("http://notes-ab12.art.localhost:20300"), "its own address still is");
    } finally {
      artifactsOnNetwork(20344, false);
    }
    assert.equal(pageFramePolicy(20300), before);
    assert.equal(isArtifactOrigin("https://192.168.1.20:20344"), false);
    const framers = harnessOrigins(20300, { host: "127.0.0.1" }, { host: "192.168.1.20" });
    assert.deepEqual(framers, ["http://127.0.0.1:20300", "http://localhost:20300", "https://192.168.1.20:*"]);
    assert.ok(artifactPolicy(framers).endsWith("frame-ancestors http://127.0.0.1:20300 http://localhost:20300 https://192.168.1.20:*"));
    // (fails before: yes — fx-artifacts) There, in a sandbox that makes its page an origin of none: never allow-same-origin.
    assert.ok(artifactPolicy(framers, NETWORK_SANDBOX).endsWith(`https://192.168.1.20:*; sandbox ${NETWORK_SANDBOX}`));
    assert.ok(!NETWORK_SANDBOX.includes("allow-same-origin") && !NETWORK_SANDBOX.includes("allow-top-navigation"));
    // (fails before: yes — the review of fx-artifacts: an app's game could not lock the pointer there, as its frame lets it)
    assert.ok(NETWORK_SANDBOX.split(" ").includes("allow-pointer-lock"));
    assert.equal(STILL_SANDBOX, "allow-scripts");
    for (const host of ["[::1]", "fe80::1", "", "a b"]) assert.deepEqual(harnessOrigins(20300, {}, { host }), ["http://127.0.0.1:20300", "http://localhost:20300"], `a policy names no ${host || "empty"} host`);
    assert.deepEqual(harnessOrigins(20300, {}), ["http://127.0.0.1:20300", "http://localhost:20300"], "on its own address, as before");
  });

  // (fails before: yes — fx-artifacts: the look and the script were read from the top, with no pass)
  test("a page served there reads Filament's look and script under the path it sits under, its pass in it, and tells its script that path; at its own address, nothing more than before", () => {
    const page = servedPage("<p>x</p>", "T", "/notes-ab12/~p.q");
    assert.match(page, /<link rel="stylesheet" href="\/notes-ab12\/~p\.q\/_filament\/look\.css"><script src="\/notes-ab12\/~p\.q\/_filament\/page\.js" data-base="\/notes-ab12\/~p\.q"><\/script>/);
    assert.match(servedPage("<p>x</p>", "T", '/a"b'), /data-base="\/a&quot;b"/);
    assert.match(servedPage("<p>x</p>", "T"), /<link rel="stylesheet" href="\/_filament\/look\.css"><script src="\/_filament\/page\.js"><\/script>/);
    assert.match(core.typeServed("doc", "/notes-ab12/~p.q").body, /src="\/notes-ab12\/~p\.q\/_filament\/ui\//);
  });

  // (fails before: yes — the hunt of p4-artifacts: an address from the top went to the address's top, no artifact's)
  test("a page's and a sheet's own addresses from the top are put under its path there; another site's, and every address at its own, as written", () => {
    const html = `<link href="/a.css"><script src='/b.js'></script><img src=/c.png srcset="/d.png 1x, /e.png 2x"><a href="/">top</a><form action="/go"></form><a href="//cdn.example/x">cdn</a><a href="https://site.example/y">site</a><a href="rel.html">rel</a><div style="background:url(/f.png)"></div>`;
    assert.equal(
      rootedUnder(html, "/n-ab12/~p.q", "html"),
      `<link href="/n-ab12/~p.q/a.css"><script src='/n-ab12/~p.q/b.js'></script><img src=/n-ab12/~p.q/c.png srcset="/n-ab12/~p.q/d.png 1x, /n-ab12/~p.q/e.png 2x"><a href="/n-ab12/~p.q/">top</a><form action="/n-ab12/~p.q/go"></form><a href="//cdn.example/x">cdn</a><a href="https://site.example/y">site</a><a href="rel.html">rel</a><div style="background:url(/n-ab12/~p.q/f.png)"></div>`,
    );
    assert.equal(rootedUnder(`@import "/g.css"; .x{background:url("/h.png")} .y{background:url(//cdn.example/i.png)}`, "/n-ab12/~p.q", "css"), `@import "/n-ab12/~p.q/g.css"; .x{background:url("/n-ab12/~p.q/h.png")} .y{background:url(//cdn.example/i.png)}`);
    assert.equal(rootedUnder(html, "", "html"), html, "at its own address the top is its own already");
    // (fails before: yes — the review of fx-artifacts: a library the version kept from the web, already under its path,
    // was put under it twice; a script's own code, the words a page shows and a picture in a srcset were rewritten)
    const kept = `<script src="/n-ab12/~p.q/_filament/v/1/_filament/web/cdn.example/x.js"></script><link href='/n-ab12/~p.q/a.css'>`;
    assert.equal(rootedUnder(kept, "/n-ab12/~p.q", "html"), kept);
    assert.equal(rootedUnder(`.a{background:url(/n-ab12/~p.q/i.png)}`, "/n-ab12/~p.q", "css"), `.a{background:url(/n-ab12/~p.q/i.png)}`);
    const words = `<script type="module">var data = /^[0-9]+$/; var s = "<img src='/z.png'>"; import("/m.js");</script><pre>&lt;img src="/y.png"&gt;</pre><img srcset="data:image/jpeg;base64,/9j/AAA 1x">`;
    assert.equal(rootedUnder(words, "/n-ab12/~p.q", "html"), words);
    assert.equal(rootedUnder(`<script src="/b.js" data-x="a>b">var data = /^x$/;</script>`, "/n-ab12/~p.q", "html"), `<script src="/n-ab12/~p.q/b.js" data-x="a>b">var data = /^x$/;</script>`, "a script's tag alone");
  });

  test("the page's script reads and follows its data under that path, over https too; an old version's from its path there", () => {
    /** @type {string[]} */
    const asked = [];
    /** @type {string[]} */
    const streams = [];
    const media = { matches: false, addEventListener() {} };
    /** @type {any} */
    const win = {
      name: "",
      location: { href: "https://192.168.1.20:20344/pipe-ab12/~p.q/_filament/v/2/", origin: "null", protocol: "https:", host: "192.168.1.20:20344", pathname: "/pipe-ab12/~p.q/_filament/v/2/" },
      fetch: (/** @type {string} */ url) => (asked.push(url), Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ records: [], rows: [] }) })),
      EventSource: function (/** @type {string} */ url) {
        streams.push(url);
        return { close() {} };
      },
      setTimeout: () => 0,
      matchMedia: () => media,
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
      addEventListener() {},
      document: {
        documentElement: { setAttribute() {}, appendChild() {} },
        currentScript: { getAttribute: (/** @type {string} */ k) => (k === "data-base" ? "/pipe-ab12/~p.q" : null), parentNode: { insertBefore() {} } },
        createElement: () => ({ textContent: "", getContext: () => null }),
        addEventListener() {},
      },
      URL,
      Request,
    };
    win.window = win;
    win.parent = win;
    const ctx = vm.createContext(win);
    // An origin of none: its storage and its cookies refused, as a sandboxed page's are — on the context's own global, as
    // a browser's window has them.
    vm.runInContext(
      'const no = () => { throw new Error("SecurityError") }; for (const n of ["localStorage", "sessionStorage"]) Object.defineProperty(globalThis, n, { get: no, configurable: true }); Object.defineProperty(document, "cookie", { get: no, set: no, configurable: true });',
      ctx,
    );
    vm.runInContext(PAGE_SCRIPT_TEXT, ctx);
    void win.filament.db.list("notes");
    win.filament.db.onChange(() => {});
    void win.filament.source("feed");
    void win.filament.sql("select 1");
    assert.deepEqual(asked, ["/pipe-ab12/~p.q/_filament/db/notes", "/pipe-ab12/~p.q/_filament/sources/feed?v=2", "/pipe-ab12/~p.q/_filament/sql"], "under its path; not away over https; its version read from the path after it");
    assert.deepEqual(streams, ["/pipe-ab12/~p.q/_filament/changes"]);
    // (fails before: yes — fx-artifacts) Its own addresses from the top under its path, as at its own address; another
    // site's, and its path's own, as written. Its storage and cookies kept in the page while it stands.
    asked.length = 0;
    for (const u of ["/data.json", "//cdn.example/x", "https://site.example/y", "rel.json", "/pipe-ab12/~p.q/own.json"]) void win.fetch(u);
    void win.fetch(new URL("https://192.168.1.20:20344/top.json"));
    void new win.EventSource("/feed");
    assert.deepEqual(asked.map(String), ["/pipe-ab12/~p.q/data.json", "//cdn.example/x", "https://site.example/y", "rel.json", "/pipe-ab12/~p.q/own.json", "https://192.168.1.20:20344/pipe-ab12/~p.q/top.json"]);
    assert.equal(streams.at(-1), "/pipe-ab12/~p.q/feed");
    // (fails before: yes — the review of fx-artifacts: a Request's address and one written whole on its host went to the
    // top, with no pass; EventSource lost its constants)
    asked.length = 0;
    for (const u of [new Request("https://192.168.1.20:20344/req.json", { headers: { "x-a": "1" } }), "https://192.168.1.20:20344/whole.json", "https://192.168.1.20:20344/pipe-ab12/~p.q/own.json", new Request("https://site.example/r")]) void win.fetch(u);
    const urls = asked.map((/** @type {any} */ u) => (typeof u === "string" ? u : u.url));
    assert.deepEqual(urls, ["https://192.168.1.20:20344/pipe-ab12/~p.q/req.json", "https://192.168.1.20:20344/pipe-ab12/~p.q/whole.json", "https://192.168.1.20:20344/pipe-ab12/~p.q/own.json", "https://site.example/r"]);
    assert.equal(/** @type {any} */ (asked[0]).headers.get("x-a"), "1", "a Request led under its pass keeps what it carries");
    assert.equal(vm.runInContext("[EventSource.CONNECTING, EventSource.OPEN, EventSource.CLOSED].join()", ctx), "0,1,2");
    assert.equal(
      vm.runInContext('localStorage.setItem("k", 1); JSON.stringify([localStorage.getItem("k"), localStorage.length, localStorage.key(0), sessionStorage.getItem("k")])', ctx),
      JSON.stringify(["1", 1, "k", null]),
    );
    assert.equal(vm.runInContext('document.cookie = "a=1; path=/"; document.cookie = "b=2"; document.cookie', ctx), "a=1; b=2");
  });

  test("the harness's addresses: this machine's own until the server says where; then the server's — the network's artifacts address, its still preview's path, framed there —, or none, in words", () => {
    try {
      assert.equal(artifactAddress("x-ab12", "20300"), "http://x-ab12.art.localhost:20300/");
      useArtifactsAt({ page: "https://192.168.1.20:20344/{name}/", still: "https://192.168.1.20:20344/_still/{name}/" });
      assert.equal(artifactAddress("x-ab12", "20343"), "https://192.168.1.20:20344/x-ab12/");
      assert.equal(artifactOrigin("x-ab12", "20343"), "https://192.168.1.20:20344");
      assert.equal(versionAddress("x-ab12", "20343", 2), "https://192.168.1.20:20344/x-ab12/_filament/v/2/");
      assert.equal(stillAddress("x-ab12", "20343", 2), "https://192.168.1.20:20344/_still/x-ab12/_filament/v/2/");
      assert.equal(stillOrigin("x-ab12", "20343"), "https://192.168.1.20:20344");
      assert.deepEqual(frameableAt("192.168.1.20", "20343"), { ok: true }, "another machine's page frames it there");
      useArtifactsAt({ page: "http://{name}.art.localhost:9000/", still: "http://{name}.still.art.localhost:9000/" });
      assert.equal(artifactAddress("x-ab12", "20300"), "http://x-ab12.art.localhost:9000/", "the port the server read from the page's Host");
      assert.equal(/** @type {any} */ (frameableAt("[::1]", "9000")).ok, false, "an IPv6 page still cannot frame its own address");
      assert.deepEqual([spokenOrigin("http://x-ab12.art.localhost:9000"), sentTo("http://x-ab12.art.localhost:9000")], ["http://x-ab12.art.localhost:9000", "http://x-ab12.art.localhost:9000"], "its own address: its origin");
      useArtifactsAt({ page: "https://192.168.1.20:20344/{name}/", still: "https://192.168.1.20:20344/_still/{name}/" });
      // (fails before: yes — fx-artifacts) The network's: its page an origin of none, heard by its frame alone.
      assert.deepEqual([spokenOrigin(artifactOrigin("x-ab12", "20343")), sentTo("null")], ["null", "*"]);
      useArtifactsAt(null);
      assert.deepEqual(frameableAt("192.168.1.20", "20343"), { ok: false, why: NO_NETWORK_WORDS });
      // (fails before: yes — the hunt of p4-artifacts: Open in browser and Copy link led to this machine's own address)
      assert.deepEqual([artifactAddress("x-ab12", "20343"), versionAddress("x-ab12", "20343", 2)], ["", ""], "none: no link");
      useArtifactsAt({ page: "javascript:{name}", still: "x" });
      assert.deepEqual(frameableAt("localhost", "20300"), { ok: false, why: NO_NETWORK_WORDS }, "an address not in its shape is none");
    } finally {
      useArtifactsAt(undefined);
    }
    assert.equal(artifactAddress("x-ab12", "20300"), "http://x-ab12.art.localhost:20300/", "nothing said: this machine's own");
  });
});

// (fails before: yes — a Dashboard on the network's address said it was away and asked Filament's paths at the top; the
// side pane's arrow kept this machine's own address)
test("a Dashboard there reads its feeds and sources under its path, over https too; the side pane's arrow follows where the page reads artifacts (pinned in the source)", () => {
  const read = (/** @type {string} */ p) => readFileSync(new URL(`../src/ui/${p}`, import.meta.url), "utf8");
  const dash = read("artifacts/dashboard.js");
  assert.match(dash, /const away = location\.protocol !== "http:" && location\.protocol !== "https:";/);
  assert.match(dash, /const base = document\.querySelector\("script\[data-base\]"\)\?\.getAttribute\("data-base"\) \|\| "";/);
  const asks = [...dash.matchAll(/(?:fetch|EventSource)\(`([^`]*)/g)].map((m) => m[1]);
  assert.equal(asks.length, 4);
  for (const a of asks) assert.ok(a.startsWith("${base}/_filament/"), a);
  const pane = read("harness/panes/artifact.js");
  assert.match(pane, /void artifactsPlaced\(\)\?\.then\(\(\) => linkOut\(out, frame\.address\)\);/);
});

// (fails before: yes — fx-artifacts: there were no passes)
test("a pass: its artifact's, still or not, writing or not, whom it was given; good for the address it was given to until it ends; signed — another key's, a changed one, none", () => {
  let t = 1_000;
  const passes = createPasses({ now: () => t });
  const pass = passes.give({ name: "notes-ab12", still: false, writes: true, who: "dv_1", from: "192.168.1.9" });
  assert.match(pass, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "a pass's shape: one path part");
  assert.deepEqual(passes.read(pass, "192.168.1.9"), { name: "notes-ab12", still: false, writes: true, who: "dv_1" });
  assert.equal(passes.read(pass, "192.168.1.77"), null, "another address");
  assert.equal(createPasses({ now: () => t }).read(pass, "192.168.1.9"), null, "another run's key");
  const [body, mac] = pass.split(".");
  const forged = Buffer.from(JSON.stringify(["other-cd34", 0, 1, "dv_1", t + PASS_MS])).toString("base64url");
  assert.equal(passes.read(`${forged}.${mac}`, "192.168.1.9"), null, "another artifact's name under its signature");
  // Another signature, whatever this one is: its first character changed, which carries six of its bits.
  assert.equal(passes.read(`${body}.${mac[0] === "A" ? "B" : "A"}${mac.slice(1)}`, "192.168.1.9"), null);
  assert.equal(passes.read("x.y", "192.168.1.9"), null);
  t += PASS_MS;
  assert.equal(passes.read(pass, "192.168.1.9"), null, "ended");
});

// (fails before: yes — the hunt of p4-artifacts: a failed read of /state left each address this machine's own)
test("where the page reads its artifacts: a read that fails is tried again, waiting longer each time, and nothing waiting on it goes on before the server says", async () => {
  /** @type {number[]} */
  const waited = [];
  let tries = 0;
  const was = globalThis.fetch;
  globalThis.fetch = stateFetch;
  serveState = async (/** @type {string} */ url) => {
    assert.match(String(url), /\/api\/state$/);
    tries++;
    if (tries < 3) throw new TypeError("Failed to fetch");
    // The server's own trouble is tried again too.
    if (tries === 3) return new Response(JSON.stringify({ error: "busy" }), { status: 503, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ artifacts: { page: "https://192.168.1.20:20344/{name}/", still: "https://192.168.1.20:20344/_still/{name}/" } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const { artifactsPlaced, PLACE_RETRY_MAX_MS } = await import("../src/ui/harness/artifact-frame.js");
    let placed = false;
    await artifactsPlaced(async (ms) => {
      waited.push(ms);
      assert.equal(placed, false);
    }).then(() => (placed = true));
    assert.deepEqual(waited, [1000, 2000, 4000]);
    assert.equal(tries, 4);
    assert.equal(artifactAddress("x-ab12", "20343"), "https://192.168.1.20:20344/x-ab12/", "the server's, once it said");
    assert.equal(PLACE_RETRY_MAX_MS, 30_000);
  } finally {
    globalThis.fetch = was;
    useArtifactsAt(undefined);
  }
});

// (fails before: yes — the review of fx-artifacts: a /state the server refused was asked again for good, its clock
// holding the page open — a test's process with it)
test("where the page reads its artifacts: a /state the server refuses is asked no more, and the page links none", async () => {
  const was = globalThis.fetch;
  for (const status of [401, 403, 404]) {
    let tries = 0;
    /** @type {number[]} */
    const waited = [];
    globalThis.fetch = stateFetch;
    serveState = async () => {
      tries++;
      return new Response(JSON.stringify({ error: "no" }), { status, headers: { "content-type": "application/json" } });
    };
    try {
      // A page of its own: the module as another page loads it.
      const { artifactsPlaced } = await import(`../src/ui/harness/artifact-frame.js?refused=${status}`);
      await artifactsPlaced(async (ms) => {
        waited.push(ms);
        if (waited.length > 2) throw new Error("asked again");
      });
      assert.deepEqual([tries, waited], [1, []], String(status));
      assert.equal(artifactAddress("x-ab12", "20343"), "", `${status}: no link of this machine's own`);
    } finally {
      globalThis.fetch = was;
      useArtifactsAt(undefined);
    }
  }
});

// (fails before: yes — the review of fx-artifacts: where the server said none, the card's arrow stood again once its
// record was read, with no address, and one read after a failed read stood with none)
test("an artifact's card in the chat stands its arrow only with an address, and only while its record reads (pinned in the source)", () => {
  const card = readFileSync(new URL("../src/ui/harness/conversation/artifact.js", import.meta.url), "utf8");
  assert.match(card, /const out = h\("a", \{ class: "visual-act visual-copy hidden",/, "none until the server has said");
  assert.match(card, /const linked = \(\) => linkOut\(out, open\.disabled \? "" : address\);/);
  assert.match(card, /void artifactsPlaced\(\)\.then\(\(\) => \{\n    address = artifactAddress\(at\.name, portOf\(location\)\);\n    linked\(\);\n  \}\);/);
  assert.match(card, /open\.disabled = true;\n    linked\(\);/, "a record that cannot be read: none");
  assert.match(card, /open\.disabled = false;\n    linked\(\);/, "read: its address, if it has one");
  assert.doesNotMatch(card, /out\.classList\.remove\("hidden"\)/);
});

describe("the network's artifacts address, over TLS", () => {
  // (fails before: yes — fx-artifacts: every artifact's page read and wrote every other's data on the one origin, a still
  // preview wrote, a view-only device's open counted as a view, an address from the top went to no artifact)
  test("it answers this machine and the devices paired with it, each page's load led under a pass of its own; under it alone its files and data, in a sandbox; another's pass, an ended one, none, refused", async () => {
    const dir = scratch();
    const store = createArtifactStore({ dataDir: join(dir, "data"), log: () => {}, four: () => "ab12" });
    const by = { chain: "c1", model: "m", folder: "/p", helper: null, call: null };
    const files = (/** @type {Record<string, string>} */ o) => Object.entries(o).map(([path, text]) => ({ path, data: Buffer.from(text) }));
    const one = /** @type {any} */ (store.publish({ title: "Notes", type: "page", files: files({ "index.html": "<p>one</p>", "app.js": "1" }), by, who: "c1" }));
    const name = one.artifact.name;
    store.publish({ name, title: "", files: files({ "index.html": `<p>two</p><link href="/s.css"><script src="/app.js"></script>`, "app.js": "2", "s.css": "a{background:url(/i.png)}" }), by, who: "c1" });
    const other = /** @type {any} */ (createArtifactStore({ dataDir: join(dir, "data"), log: () => {}, four: () => "cd34" }).publish({ title: "Other", type: "page", files: files({ "index.html": "<p>other</p>" }), by, who: "c1" })).artifact.name;
    const doc = /** @type {any} */ (createArtifactStore({ dataDir: join(dir, "data"), log: () => {}, four: () => "ef56" }).publish({ title: "Plan", type: "doc", files: files({ "content.md": "# Plan\n" }), by, who: "c1" })).artifact.name;
    const devices = createDevices();
    const full = /** @type {any} */ (devices.claim(devices.startPairing({ scope: "full" }).code, { name: "Laptop" }));
    const view = /** @type {any} */ (devices.claim(devices.startPairing({ scope: "view" }).code, { name: "Phone" }));
    // This machine with no key is let in where any program here is (`server.loopbackTrust` "legacy"): this is about the passes.
    const server = { port: 20300, loopbackTrust: "legacy" };
    const answer = createArtifactsHandler({ store, server: () => server, port: () => 20300 });
    const net = artifactsListener({ dataDir: dir, answer, server: () => server, devices, host: "127.0.0.1", nets: () => NETS, name: () => "Workstation" });
    try {
      await net.apply({ enabled: true, port: 0 });
      const port = Number(net.state().listening?.port);
      assert.ok(port > 0);
      assert.ok(samePrint(net.state().fingerprint || "", lanIdentity(dir, { nets: NETS }).fingerprint), "the certificate the network's listener keeps: a pinned fingerprint holds");
      assert.equal(isArtifactOrigin(`https://127.0.0.1:${port}`), true, "listening: its origin is an artifact's");
      assert.ok(pageFramePolicy(20300).includes(`https://*:${port}`));
      const as = (/** @type {any} */ d) => ({ ...FAR, cookie: `__Host-filament_device=${d.token}` });
      /** A frame's load, as the harness's page asks it: the same site, a navigation. */
      const LOAD = { "sec-fetch-mode": "navigate", "sec-fetch-site": "same-site", "sec-fetch-dest": "iframe" };
      /** What its sandboxed page asks: no cookie, an origin of none. */
      const PAGE = { ...FAR, origin: "null", "sec-fetch-mode": "cors", "sec-fetch-site": "cross-site" };
      /** A page's load: led under its pass. @param {string} path @param {Record<string, string>} headers */
      const passOf = async (path, headers) => {
        const led = await askTls(port, path, { headers: { ...headers, ...LOAD } });
        assert.equal(led.status, 302, `${path}: ${led.text}`);
        const m = /^(\/(?:_still\/)?[a-z0-9-]+\/~[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(\/.*)$/.exec(String(led.headers.location));
        assert.ok(m, String(led.headers.location));
        return { base: m[1], to: String(led.headers.location) };
      };

      const stranger = await askTls(port, `/${name}/`, { headers: { ...FAR, ...LOAD } });
      assert.deepEqual([stranger.status, stranger.text], [403, "An artifact answers this machine and the devices paired with it: pair this one from Filament's page here.\n"]);
      assert.equal((await askTls(port, `/${name}/`, { headers: { ...FAR, cookie: "__Host-filament_device=fdt_nope" } })).status, 403, "a token no device holds");
      assert.equal((await passOf(`/${name}/`, {})).base.startsWith(`/${name}/~`), true, "this machine, through no proxy");

      const led = await askTls(port, `/${name}?v=1`, { headers: as(full) });
      assert.deepEqual([led.status, led.headers.location], [302, `/${name}/?v=1`], "led to its slash, so its page's own paths reach its files");
      const { base, to } = await passOf(`/${name}/`, as(full));
      assert.equal(to, `${base}/`);
      const page = await askTls(port, to, { headers: PAGE });
      assert.equal(page.status, 200, page.text);
      assert.match(page.text, /<p>two<\/p>/);
      assert.ok(page.text.includes(`<link rel="stylesheet" href="${base}/_filament/look.css"><script src="${base}/_filament/page.js" data-base="${base}"></script>`), "Filament's look and script under its pass");
      assert.ok(page.text.includes(`<link href="${base}/s.css"><script src="${base}/app.js"></script>`), "its own addresses from the top under its pass");
      const csp = String(page.headers["content-security-policy"]);
      assert.match(csp, /frame-ancestors http:\/\/127\.0\.0\.1:20300 http:\/\/localhost:20300 https:\/\/127\.0\.0\.1:\*; sandbox /);
      assert.ok(csp.endsWith(`sandbox ${NETWORK_SANDBOX}`), "an origin of none");
      assert.deepEqual([page.headers["access-control-allow-origin"], page.headers["referrer-policy"], page.headers["set-cookie"]], ["*", "same-origin", undefined]);
      assert.equal((await askTls(port, `${base}/app.js`, { headers: PAGE })).text, "2", "its files under its pass, with no cookie");
      assert.equal((await askTls(port, `${base}/s.css`, { headers: PAGE })).text, `a{background:url(${base}/i.png)}`, "a sheet's addresses from the top under it too");
      assert.equal((await askTls(port, `${base}/?v=1`, { headers: PAGE })).headers.location, `${base}/_filament/v/1/`);
      assert.equal((await askTls(port, `${base}/_filament/v/1`, { headers: PAGE })).headers.location, `${base}/_filament/v/1/`);
      assert.equal((await askTls(port, `${base}/_filament/v/1/app.js`, { headers: PAGE })).text, "1");
      assert.equal((await askTls(port, `${base}/_filament/page.js`, { headers: PAGE })).status, 200);
      for (const p of ["/_filament/page.js", "/_filament/look.css"]) assert.equal((await askTls(port, p, { headers: as(full) })).status, 200, p);
      for (const p of ["/", "/api/state", "/api/keys", "/ui/harness.html", "/v1/models"]) {
        const r = await askTls(port, p, { headers: { ...as(full), ...LOAD } });
        const end = r.status === 302 ? await askTls(port, String(r.headers.location), { headers: PAGE }) : r;
        assert.equal(end.status, 404, `${p}: nothing of Filament's`);
      }
      // Without its pass: nothing but its page's load, which is led under one; not from a page of another site.
      const bare = await askTls(port, `/${name}/app.js`, { headers: { ...as(full), "sec-fetch-mode": "no-cors", "sec-fetch-site": "same-site" } });
      assert.deepEqual([bare.status, bare.text], [403, `${NO_PASS_WORDS}\n`]);
      assert.equal((await askTls(port, `/${name}/`, { headers: { ...as(full), ...LOAD, "sec-fetch-site": "cross-site" } })).status, 403, "a page of another site, or a sandboxed page here, is given none");
      // A preflight reads nothing, for any page.
      const pre = await askTls(port, `${base}/_filament/db/notes`, { method: "OPTIONS", headers: { ...PAGE, "access-control-request-method": "POST" } });
      assert.equal(pre.status, 204);
      assert.deepEqual([pre.headers["access-control-allow-origin"], pre.headers["access-control-allow-headers"]], ["*", "content-type, x-filament-page"]);
      assert.match(String(pre.headers["access-control-allow-methods"]), /POST, PATCH, DELETE/);
      // A module its page imports from the top comes with its page's address as Referer: led under its pass.
      const lib = await askTls(port, "/_filament/lib/x.js", { headers: { ...PAGE, "sec-fetch-dest": "script", referer: `https://127.0.0.1:${port}${base}/` } });
      assert.deepEqual([lib.status, lib.headers.location], [307, `${base}/_filament/lib/x.js`]);
      assert.equal((await askTls(port, "/app.js", { headers: { ...PAGE, referer: `https://127.0.0.1:${port}${base}/` } })).headers.location, `${base}/app.js`);
      assert.equal((await askTls(port, "/app.js", { headers: { ...PAGE, referer: `https://127.0.0.1:${port}/${name}/~e30.AAAA/` } })).status, 403, "a Referer with no good pass leads nowhere");

      // Its data: written under its pass, from its page — an origin of none.
      const wrote = await askTls(port, `${base}/_filament/db/notes`, { method: "POST", headers: PAGE, body: { id: "a", text: "hi" } });
      assert.equal(wrote.status, 200, wrote.text);
      assert.deepEqual((await askTls(port, `${base}/_filament/db/notes`, { headers: PAGE })).json.records.map((/** @type {any} */ r) => r.id), ["a"]);
      // Another artifact's data with this page's pass: refused, read or write; with none: refused.
      for (const method of ["GET", "POST"]) {
        const cross = await askTls(port, `/${other}/~${base.split("/~")[1]}/_filament/db/notes`, { method, headers: PAGE, ...(method === "POST" ? { body: { id: "x" } } : {}) });
        assert.deepEqual([cross.status, cross.text], [403, `${PASS_WORDS}\n`], method);
        assert.equal((await askTls(port, `/${other}/_filament/db/notes`, { method, headers: { ...PAGE, ...as(full) }, ...(method === "POST" ? { body: { id: "x" } } : {}) })).status, 403, `${method} with no pass`);
      }
      const theirs = await passOf(`/${other}/`, as(full));
      assert.deepEqual((await askTls(port, `${theirs.base}/_filament/db/notes`, { headers: PAGE })).json.records, [], "nothing of this one's written there");
      // A pass given to another address is good nowhere else.
      assert.equal((await askTls(port, `${base}/_filament/db/notes`, { headers: { ...PAGE, "x-forwarded-for": "192.168.1.77" } })).status, 403);
      // An ended one, or another's, loaded again: led to its address with none, to be given another.
      const again = await askTls(port, `/${name}/~e30.AAAA/x.html?y=1`, { headers: { ...FAR, ...LOAD } });
      assert.deepEqual([again.status, again.headers.location], [302, `/${name}/x.html?y=1`]);

      // Its still preview: under /_still/ and its own pass, its scripts alone, reading alone, never a view.
      const was = store.get(name)?.viewedAt;
      const still = await passOf(`/_still/${name}/_filament/v/1/`, as(full));
      const preview = await askTls(port, still.to, { headers: PAGE });
      assert.equal(preview.status, 200);
      assert.ok(preview.text.includes(`data-base="${still.base}"`));
      assert.ok(String(preview.headers["content-security-policy"]).endsWith(`sandbox ${STILL_SANDBOX}`));
      assert.equal((await askTls(port, `${still.base}/_filament/db/notes`, { method: "POST", headers: PAGE, body: { id: "c" } })).status, 403);
      assert.equal((await askTls(port, `/${name}/~${still.base.split("/~")[1]}/_filament/db/notes`, { method: "POST", headers: PAGE, body: { id: "c" } })).status, 403, "a still preview's pass is no page's");
      assert.deepEqual([(await askTls(port, `/${name}/~${still.base.split("/~")[1]}/app.js`, { headers: PAGE })).status], [403], "…to read either");
      assert.equal((await askTls(port, `${still.base}/`, { headers: PAGE })).status, 200);
      assert.equal(store.get(name)?.viewedAt, was, "a still preview is no view");

      // A view-only device reads it, changes nothing, and its open is no view.
      const seen = await passOf(`/${name}/`, as(view));
      assert.equal((await askTls(port, `${seen.base}/`, { headers: PAGE })).status, 200);
      assert.equal(store.get(name)?.viewedAt, was, "a view-only device's open is no view");
      assert.equal((await askTls(port, `${seen.base}/_filament/db/notes`, { headers: PAGE })).json.records.length, 1);
      const refused = await askTls(port, `${seen.base}/_filament/db/notes`, { method: "POST", headers: PAGE, body: { id: "d" } });
      assert.deepEqual([refused.status, refused.text], [403, `${VIEW_WRITES_WORDS}\n`]);
      assert.equal((await askTls(port, `${seen.base}/_filament/db/notes/a`, { method: "DELETE", headers: PAGE })).status, 403);
      // A full device's open is one.
      assert.equal((await askTls(port, `${base}/`, { headers: PAGE })).status, 200);
      assert.notEqual(store.get(name)?.viewedAt, was, "a full device's open is a view");
      // A typed one's the same: drawn by Filament's page under its pass, a view-only device's open no view.
      const docWas = store.get(doc)?.viewedAt;
      const docSeen = await passOf(`/${doc}/`, as(view));
      const drawn = await askTls(port, `${docSeen.base}/`, { headers: PAGE });
      assert.equal(drawn.status, 200, drawn.text);
      assert.ok(drawn.text.includes(`src="${docSeen.base}/_filament/ui/`), "its page's code under its pass");
      assert.equal(store.get(doc)?.viewedAt, docWas, "a view-only device's open of a typed one is no view");
      assert.equal((await askTls(port, `${(await passOf(`/${doc}/`, as(full))).base}/`, { headers: PAGE })).status, 200);
      assert.notEqual(store.get(doc)?.viewedAt, docWas);

      // Revoked: its pass is good no more, and what its page follows ends.
      const follow = await new Promise((resolve, reject) => {
        const req = https.request({ host: "127.0.0.1", port, path: `${base}/_filament/changes`, agent: false, rejectUnauthorized: false, headers: { host: `127.0.0.1:${port}`, ...PAGE } }, (res) => resolve(res));
        req.on("error", reject);
        req.end();
      });
      assert.equal(/** @type {any} */ (follow).statusCode, 200);
      const ended = new Promise((resolve) => /** @type {any} */ (follow).on("close", () => resolve(true)).on("end", () => resolve(true)).resume());
      devices.revoke(full.device.id);
      assert.equal(await Promise.race([ended, new Promise((r) => setTimeout(() => r(false), 3000))]), true, "what its page follows ends at its revoke");
      assert.equal((await askTls(port, `/${name}/`, { headers: { ...as(full), ...LOAD } })).status, 403);
      assert.deepEqual([(await askTls(port, `${base}/app.js`, { headers: PAGE })).status], [403]);

      await net.apply({ enabled: false });
      assert.equal(isArtifactOrigin(`https://127.0.0.1:${port}`), false, "off: its origin is no artifact's");
      assert.equal(pageFramePolicy(20300), "frame-src http://*.art.localhost:20300; frame-ancestors 'self'");
      await assert.rejects(askTls(port, `/${name}/`), /ECONNREFUSED|ECONNRESET/);
    } finally {
      await net.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the review of fx-artifacts: a library its version kept from the web was put under its pass twice
  // and not found; a deleted one's page read its look from the top, with no pass; a preflight refused a library's own
  // header; a module's Referer on an IPv6 address led nowhere; a pass given under the admin token outlived the token; a
  // restart ended every page's pass)
  test("under a page's pass: the libraries its version kept, a deleted one's look, a library's header, a Referer on IPv6; a pass ends with the admin token it was given under, and outlives a restart", async () => {
    const dir = scratch();
    const store = createArtifactStore({ dataDir: join(dir, "data"), log: () => {}, four: () => "ab12" });
    const by = { chain: "c1", model: "m", folder: "/p", helper: null, call: null };
    const files = (/** @type {Record<string, string>} */ o) => Object.entries(o).map(([path, text]) => ({ path, data: Buffer.from(text) }));
    const lib = "https://cdn.jsdelivr.net/npm/tiny@1/x.js";
    const kept = "cdn.jsdelivr.net/npm/tiny@1/x.js";
    const name = /** @type {any} */ (store.publish({ title: "Charts", type: "page", files: files({ "index.html": `<script src="${lib}"></script><p>c</p>`, "_filament/web/pins.json": JSON.stringify({ pins: { [lib]: kept } }), [`_filament/web/${kept}`]: "window.tiny=1" }), by, who: "c1" })).artifact.name;
    const gone = /** @type {any} */ (createArtifactStore({ dataDir: join(dir, "data"), log: () => {}, four: () => "cd34" }).publish({ title: "Old", type: "page", files: files({ "index.html": "<p>old</p>" }), by, who: "c1" })).artifact.name;
    store.remove(gone);
    const server = { port: 20300, adminToken: "tok-1" };
    const answer = createArtifactsHandler({ store, server: () => server, port: () => 20300 });
    const listen = () => artifactsListener({ dataDir: dir, answer, server: () => server, devices: createDevices(), host: "127.0.0.1", nets: () => NETS });
    let net = listen();
    try {
      await net.apply({ enabled: true, port: 0 });
      let port = Number(net.state().listening?.port);
      const ADMIN = { ...FAR, authorization: "Bearer tok-1", "sec-fetch-mode": "navigate", "sec-fetch-site": "same-site", "sec-fetch-dest": "iframe" };
      const PAGE = { ...FAR, origin: "null", "sec-fetch-mode": "cors", "sec-fetch-site": "cross-site" };
      /** A page's load under the admin token: led under its pass. @param {string} path */
      const passOf = async (path) => {
        const led = await askTls(port, path, { headers: ADMIN });
        assert.equal(led.status, 302, `${path}: ${led.text}`);
        const m = /^(\/[a-z0-9-]+\/~[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\/$/.exec(String(led.headers.location));
        assert.ok(m, String(led.headers.location));
        return m[1];
      };
      const base = await passOf(`/${name}/`);
      const page = await askTls(port, `${base}/`, { headers: PAGE });
      assert.ok(page.text.includes(`<script src="${base}/_filament/v/1/_filament/web/${kept}"></script>`), page.text);
      const got = await askTls(port, `${base}/_filament/v/1/_filament/web/${kept}`, { headers: PAGE });
      assert.deepEqual([got.status, got.text], [200, "window.tiny=1"], "the library its version kept, there");
      const tombBase = await passOf(`/${gone}/`);
      const tomb = await askTls(port, `${tombBase}/`, { headers: PAGE });
      assert.equal(tomb.status, 410);
      assert.ok(tomb.text.includes(`href="${tombBase}/_filament/look.css"`) && tomb.text.includes(`data-base="${tombBase}"`), "a deleted one's look and script under its pass");
      const pre = await askTls(port, `${base}/_filament/db/x`, { method: "OPTIONS", headers: { ...PAGE, "access-control-request-method": "POST", "access-control-request-headers": "X-Requested-With, content-type, bad header" } });
      assert.equal(pre.headers["access-control-allow-headers"], "content-type, x-filament-page, x-requested-with", "what the page asks to send, a name of a header alone");
      const v6 = await askTls(port, "/_filament/lib/x.js", { headers: { ...PAGE, host: `[::1]:${port}`, "sec-fetch-dest": "script", referer: `https://[::1]:${port}${base}/` } });
      assert.deepEqual([v6.status, v6.headers.location], [307, `${base}/_filament/lib/x.js`], "a module's Referer on an IPv6 address");

      // Filament restarts: its key kept in its data folder, the page reads on under its pass.
      await net.close();
      net = listen();
      await net.apply({ enabled: true, port: 0 });
      port = Number(net.state().listening?.port);
      assert.equal(readFileSync(join(dir, PASS_KEY_FILE)).length, 32);
      assert.deepEqual(passKeyIn(dir), readFileSync(join(dir, PASS_KEY_FILE)));
      assert.equal((await askTls(port, `${base}/_filament/v/1/_filament/web/${kept}`, { headers: PAGE })).status, 200, "a pass outlives a restart");
      // The admin token changed: the passes given under it end.
      server.adminToken = "tok-2";
      assert.equal((await askTls(port, `${base}/_filament/v/1/_filament/web/${kept}`, { headers: PAGE })).status, 403);
    } finally {
      await net.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the session cookie a device's browser holds is HttpOnly, and an artifact's page cannot use it: Filament's own address refuses a request from the network's artifacts origin, the cookie with it", async () => {
    const shim = await startApp({ configure: (c) => void (c.server.lan = { enabled: true, port: 0 }), overrides: { lanHost: "127.0.0.1" } });
    const dir = scratch();
    const net = artifactsListener({ dataDir: dir, answer: createArtifactsHandler({ store: createArtifactStore({ dataDir: join(dir, "data"), log: () => {} }), server: () => ({}), port: () => 0 }), server: () => ({}), host: "127.0.0.1", nets: () => NETS });
    try {
      const lan = Number(shim.started.lan?.listening?.port);
      const pair = await (await shim.api("/api/remote/pair", { method: "POST", body: { scope: "full" } })).json();
      const claimed = await askTls(lan, "/api/remote/claim", { method: "POST", headers: { ...FAR, origin: `https://127.0.0.1:${lan}` }, body: { code: pair.code, name: "Laptop" } });
      const set = String(claimed.headers["set-cookie"]?.[0]);
      assert.match(set, /; HttpOnly;/, "no script reads it");
      const cookie = set.split(";")[0];
      await net.apply({ enabled: true, port: 0 });
      const art = Number(net.state().listening?.port);
      const ask = (/** @type {string} */ path, /** @type {string} */ origin) => askTls(lan, path, { headers: { ...FAR, cookie, origin } });
      for (const path of ["/api/state", "/ui/harness.html"]) {
        assert.equal((await ask(path, `https://127.0.0.1:${lan}`)).status, 200, `${path}: the harness's own page, with the cookie`);
        const from = await ask(path, `https://127.0.0.1:${art}`);
        assert.deepEqual([from.status, from.json?.error], [403, "an artifact's page reaches nothing of Filament's"], `${path}: an artifact's page, the same cookie with it, is refused at the front door, whatever its path`);
      }
      await net.apply({ enabled: false });
      assert.equal((await ask("/ui/harness.html", `https://127.0.0.1:${art}`)).status, 200, "its port is an artifact's only while it listens");
    } finally {
      await net.close();
      await shim.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — nothing in Filament started it: /state said no artifacts address, and none listened)
  test("Filament runs it with the network's listener, on its certificate: /state names it to a device that reached Filament by a network address, the device's cookie gets in, a stranger does not; off with server.lan, it closes", async () => {
    const shim = await startApp({ configure: (c) => void (c.server.lan = { enabled: true, port: 0 }), overrides: { lanHost: "127.0.0.1" } });
    try {
      const lan = Number(shim.started.lan?.listening?.port);
      const pair = await (await shim.api("/api/remote/pair", { method: "POST", body: { scope: "full" } })).json();
      const claimed = await askTls(lan, "/api/remote/claim", { method: "POST", headers: { ...FAR, origin: `https://127.0.0.1:${lan}` }, body: { code: pair.code, name: "Laptop" } });
      const cookie = String(claimed.headers["set-cookie"]?.[0]).split(";")[0];
      const st = await askTls(lan, "/api/state", { headers: { ...FAR, cookie, host: `192.168.1.20:${lan}` } });
      assert.match(String(st.json.artifacts?.page), /^https:\/\/192\.168\.1\.20:\d+\/\{name\}\/$/);
      assert.match(String(st.json.artifacts?.still), /^https:\/\/192\.168\.1\.20:\d+\/_still\/\{name\}\/$/);
      const art = Number(new URL(String(st.json.artifacts.page).replace("{name}", "x")).port);
      assert.ok(art > 0 && art !== lan);
      const stranger = await askTls(art, "/no-such-artifact/", { headers: FAR });
      assert.equal(stranger.status, 403);
      assert.ok(samePrint(stranger.fp, String(shim.started.lan.fingerprint)), "the network listener's certificate: a pinned fingerprint holds there too");
      const device = await askTls(art, "/no-such-artifact/", { headers: { ...FAR, cookie } });
      assert.notEqual(device.status, 403, "the device's cookie gets in");
      const api = await askTls(art, "/api/state", { headers: { ...FAR, cookie } });
      assert.equal(api.status, 302, "a page's load: led under a pass");
      assert.equal((await askTls(art, String(api.headers.location), { headers: FAR })).status, 404, "nothing of Filament's API there");
      // Turned off in the configuration: it closes with the network's listener.
      const cfg = (await (await shim.api("/api/state")).json()).config;
      cfg.server.lan.enabled = false;
      assert.equal((await shim.api("/api/config", { method: "PUT", body: cfg })).status, 200);
      await assert.rejects(askTls(art, "/no-such-artifact/", { headers: FAR }), /ECONNREFUSED|ECONNRESET/);
    } finally {
      await shim.stop();
    }
  });
});
