// @ts-check
// Vendor on publish, after a review of the Space work (10-29): an import map's prefix is never fetched or rewritten; a
// kept file is the bytes fetched wherever it can be, and a page's `integrity=` is checked, never broken; the fetching
// has a deadline and stops with the turn, and the publish says what stayed on the web.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactStore } from "../src/services/artifacts.js";
import { artifactCall, pinnedFor } from "../src/app/agent/artifacts.js";
import { pinnedText } from "../src/core/web-pins.js";
import { createWebPins } from "../src/services/web-pins.js";
import { createArtifactsHandler } from "../src/http/artifacts.js";
import { createAgentTools } from "../src/app/agent-tools.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-pins-review-"));
  dirs.push(d);
  return d;
};

/** A fetch that answers from `web` alone, and says what it was asked; `hang` lists addresses that never answer until the fetch's signal ends them. @param {Record<string, { type: string, body: string }>} web @param {string[]} [hang] */
function webOf(web, hang = []) {
  /** @type {string[]} */
  const asked = [];
  /** @type {any} */
  const fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
    asked.push(String(url));
    if (hang.includes(String(url)) || hang.includes("*"))
      return new Promise((_, no) => {
        const s = init?.signal;
        if (s?.aborted) return no(s.reason);
        s?.addEventListener("abort", () => no(s.reason), { once: true });
      });
    const it = web[String(url)];
    if (!it) return new Response("nope", { status: 404 });
    return new Response(it.body, { status: 200, headers: { "content-type": it.type } });
  };
  return { fetch, asked };
}

/** What a promise gives, or a failure once `ms` have passed without it. @template T @param {number} ms @param {Promise<T>} p @returns {Promise<T>} */
const within = (ms, p) => {
  /** @type {any} */
  let timer;
  return Promise.race([p, new Promise((_, no) => (timer = setTimeout(() => no(new Error(`still waiting after ${ms} ms`)), ms)))]).finally(() => clearTimeout(timer));
};

/** An SRI hash of a text. @param {"sha256" | "sha384" | "sha512"} alg @param {string} body */
const sri = (alg, body) => `${alg}-${createHash(alg).update(body).digest("base64")}`;

/** A store and a session's place in it; publishes go through `pinnedFor` with the module's fetcher pointed at `web`. @param {Record<string, any>} web @param {string[]} [hang] */
function world(web, hang = []) {
  const root = fresh();
  const store = createArtifactStore({ dataDir: fresh(), log: () => {}, four: () => "k3f9" });
  const at = { who: "c1", by: { chain: "c1", model: "m", folder: root, helper: null }, within: [root], port: 20300, maxBytes: 5_000_000 };
  const net = webOf(web, hang);
  /** @param {any} input @param {AbortSignal} [signal] */
  const publish = async (input, signal) => {
    const call = { action: "publish", ...input };
    const real = globalThis.fetch;
    globalThis.fetch = net.fetch;
    try {
      const pinned = await pinnedFor(call, at, store, signal);
      return artifactCall(call, { ...at, pinned }, store);
    } finally {
      globalThis.fetch = real;
    }
  };
  const answer = createArtifactsHandler({ store, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300 });
  const ask = (/** @type {string} */ name, /** @type {string} */ path) => {
    /** @type {any} */
    const res = { status: 0, headers: {}, body: Buffer.alloc(0), writeHead(/** @type {number} */ s, /** @type {any} */ h) { this.status = s; this.headers = h; }, end(/** @type {any} */ b) { this.body = b ? Buffer.from(b) : Buffer.alloc(0); } };
    answer(/** @type {any} */ ({ method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } }), res, name, new URL(`http://x${path}`));
    return { status: res.status, text: res.body.toString("utf8") };
  };
  /** The paths a version keeps. @param {number} v */
  const paths = (v) => (/** @type {any} */ (store.get("party-k3f9"))?.versions[v - 1].files || []).map((/** @type {any} */ f) => f.path).sort();
  return { root, store, at, net, publish, ask, paths };
}

const THREE = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
const ADDONS = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/";
const KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
const KATEX_FONT = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Main-Regular.woff2";
const KATEX_CSS = '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2")}.katex{font:normal 1.21em KaTeX_Main}';
const ESM = "https://esm.sh/preact@10.19.3";
const ESM_BODY = 'export * from "/stable/preact@10.19.3/es2022/preact.mjs";';
const WEB = {
  [THREE]: { type: "application/javascript; charset=utf-8", body: "export const Scene=class{};" },
  // jsdelivr answers a folder's address with a listing of it.
  [ADDONS]: { type: "text/html; charset=utf-8", body: "<html><body>controls/ loaders/</body></html>" },
  [KATEX]: { type: "text/css; charset=utf-8", body: KATEX_CSS },
  [KATEX_FONT]: { type: "font/woff2", body: "wOF2-katex" },
  [ESM]: { type: "application/javascript; charset=utf-8", body: ESM_BODY },
  "https://esm.sh/stable/preact@10.19.3/es2022/preact.mjs": { type: "application/javascript; charset=utf-8", body: "export const h=()=>1;" },
};

describe("an import map's prefix, as a page writes it", () => {
  const MAP = `{"imports":{"three":"${THREE}","three/addons/":"${ADDONS}"}}`;
  const PAGE = `<script type="importmap">${MAP}</script><script type="module">import { Scene } from "three"; import { OrbitControls } from "three/addons/controls/OrbitControls.js";</script>`;

  // (fails before: yes — found reviewing the Space work: the prefix's address was fetched, kept as …/jsm/index, and the served map's "three/addons/" no longer ended in /, so a browser dropped it and every addons import failed)
  test("a prefix entry is not fetched and stays as written; the map's other entries are still kept", async () => {
    const w = world(WEB);
    const r = await w.publish({ title: "Party", html: PAGE });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.ok(!w.net.asked.includes(ADDONS), `asked: ${w.net.asked.join(", ")}`);
    const page = w.ask("party-k3f9", "/").text;
    assert.ok(page.includes(`"three/addons/":"${ADDONS}"`), page);
    assert.ok(page.includes(`"three":"/_filament/v/1/_filament/web/cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"`), page);
  });

  // (fails before: yes — found reviewing the Space work: a version kept before the fix, its pins naming the prefix, was served with the prefix pointed at a file)
  test("a version that kept a prefix before is served with the prefix as written", () => {
    const out = pinnedText(PAGE, { [ADDONS]: "cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/index", [THREE]: "cdn.jsdelivr.net/x.js" }, (p) => `/k/${p}`);
    assert.ok(out.includes(`"three/addons/":"${ADDONS}"`), out);
    assert.ok(out.includes(`"three":"/k/cdn.jsdelivr.net/x.js"`), out);
  });
});

describe("a kept file and the page's integrity", () => {
  // (fails before: yes — found reviewing the Space work: the sheet's url(fonts/…) was written url(./fonts/…), so its bytes changed and KaTeX's own snippet, with integrity=, had its sheet blocked)
  test("a sheet's relative fonts stay as written: the kept sheet is the bytes fetched, and the page's integrity holds", async () => {
    const w = world(WEB);
    const hash = sri("sha384", KATEX_CSS);
    const html = `<link rel="stylesheet" href="${KATEX}" integrity="${hash}" crossorigin="anonymous"><p class="katex">x</p>`;
    const r = await w.publish({ title: "Party", html });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    const kept = String(w.store.file("party-k3f9", 1, "_filament/web/cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"));
    assert.equal(kept, KATEX_CSS);
    assert.ok(w.paths(1).includes("_filament/web/cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Main-Regular.woff2"), "its font is kept beside it");
    const page = w.ask("party-k3f9", "/").text;
    assert.ok(page.includes(`href="/_filament/v/1/_filament/web/cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" integrity="${hash}" crossorigin="anonymous"`), page);
  });

  // (fails before: yes — found reviewing the Space work: Filament never checked a fetched file against the page's integrity, so a file that did not match was kept and served)
  test("a file whose bytes do not match the page's integrity stays on the web, and the publish says why", async () => {
    const w = world(WEB);
    const html = `<link rel="stylesheet" href="${KATEX}" integrity="${sri("sha384", "something else")}" crossorigin="anonymous">`;
    const r = await w.publish({ title: "Party", html });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.match(r.ok ? r.text : "", /Not kept, so it loads from the web: https:\/\/cdn\.jsdelivr\.net\/npm\/katex@0\.16\.9\/dist\/katex\.min\.css \(its bytes do not match the integrity hash the page gives it\)\./);
    assert.ok(w.ask("party-k3f9", "/").text.includes(`href="${KATEX}"`));
    assert.deepEqual(w.paths(1), ["index.html"], "nothing of it is kept");
  });

  // (fails before: yes — found reviewing the Space work: a module with integrity= had its imports rewritten, so its kept bytes no longer matched and the browser refused it)
  test("a file with integrity that Filament would have to change stays on the web, and what it names is not kept", async () => {
    const w = world(WEB);
    const hash = `sha256-bogus ${sri("sha512", ESM_BODY)}`;
    const html = `<script type="module" src="${ESM}" integrity="${hash}"></script>`;
    const r = await w.publish({ title: "Party", html });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.match(r.ok ? r.text : "", /Not kept, so it loads from the web: https:\/\/esm\.sh\/preact@10\.19\.3 \(Filament would have to change it to keep it, and the page's integrity hash would then fail\)\./);
    assert.ok(w.ask("party-k3f9", "/").text.includes(`src="${ESM}" integrity="${hash}"`));
    assert.deepEqual(w.paths(1), ["index.html"]);
  });
});

describe("how long a publish waits for the web", () => {
  // (fails before: yes — found reviewing the Space work: pinning had no deadline of its own, so a host that never answered held the publish for each file's 20 s, round after round)
  test("pinning stops at its deadline: what was not fetched in time stays on the web, and is counted", async () => {
    const net = webOf(WEB, [ESM]);
    const pins = createWebPins({ dir: fresh(), fetch: net.fetch, limits: { ms: 10_000, total: 300 } });
    const r = await within(3_000, pins.pin([THREE, ESM]));
    assert.deepEqual(Object.keys(r.pins), [THREE]);
    assert.deepEqual(r.failed, [{ address: ESM, why: "it was not fetched in 0.3 s, the most a publish waits for the web" }]);
    assert.equal(r.late, 1);
  });

  // (fails before: yes — found reviewing the Space work: a kept module's /npm/… import of a file not fetched in time stayed as written, so it asked the app's own address, which has no such file, and the page's whole module graph failed)
  test("a kept file's reference to a file not kept is written as its address on the web", async () => {
    const A = "https://cdn.jsdelivr.net/npm/a@1/+esm";
    const B = "https://cdn.jsdelivr.net/npm/b@1/+esm";
    const C = "https://cdn.jsdelivr.net/npm/c@1/dist/c.css";
    const web = {
      [A]: { type: "application/javascript; charset=utf-8", body: 'import "/npm/b@1/+esm"; import "https://cdn.jsdelivr.net/npm/b@1/+esm#x"; export const a = 1;' },
      [C]: { type: "text/css; charset=utf-8", body: "@font-face{src:url(fonts/x.woff2)}" },
    };
    const pins = createWebPins({ dir: fresh(), fetch: webOf(web, [B]).fetch, limits: { total: 300 } });
    const r = await within(3_000, pins.pin([A, C]));
    const text = (/** @type {string} */ address) => String(r.files.find((f) => f.path === `_filament/web/${r.pins[address]}`)?.data);
    assert.equal(text(A), `import "${B}"; import "${B}#x"; export const a = 1;`, "B was late; an address written whole stays as it is");
    assert.equal(text(C), "@font-face{src:url(https://cdn.jsdelivr.net/npm/c@1/dist/fonts/x.woff2)}", "its font was not found");
  });

  // (fails before: yes — found reviewing the Space work: the publish's answer did not say that files stayed on the web because time ran out)
  test("the publish's answer says how many files stayed on the web", async () => {
    const w = world(WEB);
    const html = `<script type="module">import "${THREE}"; import "${ESM}";</script>`;
    const pins = createWebPins({ dir: fresh(), fetch: webOf(WEB, [ESM]).fetch, limits: { total: 300 } });
    const pinned = await within(3_000, pins.pin([THREE, ESM], { texts: [html] }));
    const r = artifactCall({ action: "publish", title: "Party", html }, { ...w.at, pinned }, w.store);
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.match(r.ok ? r.text : "", / 1 file it names was not fetched in time, so it loads from the web\.$/);
  });

  // (fails before: yes — found reviewing the Space work: Stop did not reach the fetching, which went on for each file's 20 s)
  test("a stopped turn stops the fetching: what was not fetched stays on the web", async () => {
    const w = world(WEB, ["*"]);
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 50);
    const real = globalThis.fetch;
    globalThis.fetch = w.net.fetch;
    try {
      const r = await within(3_000, pinnedFor({ action: "publish", title: "Party", html: `<script src="${THREE}"></script>` }, w.at, w.store, stop.signal));
      assert.deepEqual(r?.failed, [{ address: THREE, why: "the turn was stopped before it was fetched" }]);
    } finally {
      globalThis.fetch = real;
    }
  });

  // (fails before: yes — found reviewing the Space work: a coding agent's Stop left the publish waiting on the web, and it was published after the stop)
  test("a coding agent's publish stopped while it fetches is not published", async () => {
    const store = createArtifactStore({ dataDir: fresh(), log: () => {}, four: () => "k3f9" });
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: /** @type {any} */ ({ get: () => null }), subagents: /** @type {any} */ (() => null), membersOf: /** @type {any} */ (() => null), artifacts: store, port: () => 4321, maxBytes: () => 1_000_000 });
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 50);
    const real = globalThis.fetch;
    globalThis.fetch = webOf(WEB, ["*"]).fetch;
    try {
      const ctx = { cwd: fresh(), upstream: "cli", chain: "c1", turn: null, graph: false, artifacts: true, model: "m", signal: stop.signal };
      const r = await within(3_000, tools.call("artifact", { action: "publish", title: "Party", html: `<script src="${THREE}"></script>` }, /** @type {any} */ (ctx)));
      assert.deepEqual(r, { text: "Not published: the turn was stopped while Filament fetched what its page names from the web.", isError: true });
      assert.equal(store.get("party-k3f9"), null);
    } finally {
      globalThis.fetch = real;
    }
  });
});
