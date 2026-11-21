// @ts-check
// What an app's sources reach, found reviewing the Space work (10-29): a fetch never reads Filament's own address nor
// sets the headers its connection does; a secret is hidden in every form an answer may hold it — escaped in JSON,
// encoded in an address, escaped in XML — and in the rows read from it; and a folder's pattern is matched in a time
// that grows with the name, never one that stops Filament.
import { test, describe, after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { rowsFrom, sourcesOf } from "../src/core/dashboard-sources.js";
import { hider } from "../src/core/app-secrets.js";
import { feedRows, plainText } from "../src/core/feed-xml.js";
import { fetchSource } from "../src/adapters/tools/source-fetch.js";
import { runActionCommand, runCommand } from "../src/adapters/tools/source-command.js";
import { FILAMENT_MARK } from "../src/core/headers.js";
import { listFolder } from "../src/services/source-folder.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createSpaceStore } from "../src/services/spaces.js";
import { createAppSecrets } from "../src/services/app-secrets.js";
import { createDashboardRunner } from "../src/services/dashboard-runner.js";
import { artifactCall } from "../src/app/agent/artifacts.js";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function fresh() {
  const d = mkdtempSync(join(tmpdir(), "filament-reach-review-"));
  dirs.push(d);
  return d;
}

/** A source's fault in words, or "" where it reads. @param {any} s */
const fault = (s) => {
  const r = sourcesOf({ sources: { s } });
  return r.ok ? "" : r.error;
};

describe("a fetch never reaches Filament itself", () => {
  /** A server on this computer that stands in for a person's own dev server. @type {import("node:http").Server} */
  let other;
  let otherPort = 0;
  before(async () => {
    other = createServer((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end('[{"ok":true}]'));
    await new Promise((r) => other.listen(0, "127.0.0.1", () => r(null)));
    otherPort = /** @type {any} */ (other.address()).port;
  });
  after(() => {
    other.closeAllConnections?.();
    other.close();
  });

  // (fails before: yes — found reviewing the Space work: a fetch of http://127.0.0.1:<Filament's port>/api/... was sent,
  // and Filament's admin API let this computer in with no token, so an app's page read other projects' chats as rows)
  test("an address on this computer at Filament's own port is refused in words and never asked; another port still reads", async () => {
    const OWN = 41234;
    /** @type {string[]} */
    const asked = [];
    /** @param {string} url */
    const stub = async (url) => (asked.push(url), new Response("[]", { status: 200 }));
    for (const url of [`http://127.0.0.1:${OWN}/api/sessions/c1/transcript`, `http://localhost:${OWN}/api/memory`, `http://[::1]:${OWN}/api/sessions`, `http://127.1:${OWN}/x`, `https://localhost:${OWN}/x`]) {
      const got = /** @type {any} */ (await fetchSource({ url, headers: {}, as: "text" }, { fetch: stub, port: () => OWN }));
      assert.equal(got.ok, false, url);
      assert.match(got.error, /is Filament's own address: a fetch never reads it/, url);
    }
    assert.deepEqual(asked, [], "nothing was asked of Filament");
    // A person's own dev server on another port reads as before.
    assert.deepEqual(await fetchSource({ url: `http://127.0.0.1:${otherPort}/x`, headers: {}, as: "json" }, { port: () => OWN }), { ok: true, out: '[{"ok":true}]' });
  });

  // (fails before: yes — another Filament on this computer, the installed one on 20300 while a checkout runs on another
  // port, answered a fetch of its admin API with this computer let in, so its chats came back as an app's rows)
  test("another Filament on this computer, at any port, is known by the mark on its answers and never read", async () => {
    const { startApp } = await import("./helpers/app.js");
    const another = await startApp();
    try {
      const got = /** @type {any} */ (await fetchSource({ url: `http://127.0.0.1:${another.port}/api/state`, headers: {}, as: "json" }, { port: () => another.port + 1 }));
      assert.equal(got.ok, false);
      assert.equal(got.error, `127.0.0.1:${another.port} is a Filament's address: a fetch never reads one — a filament source reads this Filament's own rows`);
      assert.equal(got.out, undefined, "nothing of its answer comes back");
      // Every answer of its own bears it: a 404 too, so a redirect to it is refused as well.
      assert.equal((await fetch(`${another.url}/nowhere`)).headers.get(FILAMENT_MARK), "1");
      assert.equal((await fetch(`${another.url}/health`)).headers.get(FILAMENT_MARK), "1");
      // The model endpoints' answers are the wire a client speaks, as they were: no mark (the goldens hold them).
      for (const path of ["/v1/models", "/models", "/v1/models/"]) assert.equal((await fetch(`${another.url}${path}`)).headers.get(FILAMENT_MARK), null, path);
      assert.equal((await another.post("/v1/messages", { model: "nowhere/none", max_tokens: 1, messages: [{ role: "user", content: "hi" }] })).headers.get(FILAMENT_MARK), null);
    } finally {
      await another.stop();
    }
  });

  // (fails before: yes — found reviewing the Space work: a fetch could send a host header, and cookie, origin and the
  // connection's own headers, which Filament's guards read to tell who asks)
  test("a fetch may not set host, cookie, origin or its connection's headers: at publish, and at its read for one kept before", async () => {
    for (const k of ["host", "Host", "connection", "content-length", "transfer-encoding", "cookie", "origin"])
      assert.match(fault({ fetch: { url: "https://example.com/x", headers: { [k]: "x" } } }), new RegExp(`has the header ${k}, which a fetch may not send`), k);
    assert.equal(fault({ fetch: { url: "https://example.com/x", headers: { authorization: "Bearer x", accept: "application/json" } } }), "");
    /** @type {string[]} */
    const asked = [];
    const got = await fetchSource({ url: "https://example.com/x", headers: { Host: "localhost" }, as: "json" }, { fetch: async (url) => (asked.push(url), new Response("[]")) });
    assert.deepEqual(got, { ok: false, error: "it sets the header Host, which a fetch may not send" });
    assert.deepEqual(asked, []);
  });
});

/** A secret with a character each form escapes: JSON's quote, XML's & and >, an address's @ and /. */
const SECRET = 'p@ss"w&rd/1>';

describe("a secret is hidden in every form it comes back in", () => {
  // (fails before: yes — found reviewing the Space work: a secret was looked for as typed alone, so JSON's p@ss\"w&rd,
  // an address's p%40ss%22w and a feed's p@ss&quot;w&amp;rd came out whole)
  test("as typed, escaped in JSON, encoded in an address, escaped in XML or HTML: in a whole text and in a stream", () => {
    const h = hider({ API_TOKEN: SECRET });
    const forms = [SECRET, JSON.stringify(SECRET).slice(1, -1), encodeURIComponent(SECRET), "p@ss&quot;w&amp;rd/1&gt;", 'p@ss"w&amp;rd/1&gt;'];
    for (const f of forms) assert.equal(h.text(`a ${f} b`), "a [API_TOKEN hidden] b", f);
    // A stream cut inside the longest form still hides it whole.
    const long = encodeURIComponent(SECRET);
    for (let cut = 1; cut < long.length; cut++) {
      /** @type {string[]} */
      const said = [];
      const s = h.stream((x) => said.push(x));
      s.push(`GET /q?key=${long.slice(0, cut)}`);
      s.push(`${long.slice(cut)} 403`);
      s.end();
      assert.equal(said.join(""), "GET /q?key=[API_TOKEN hidden] 403", `cut at ${cut}`);
    }
  });

  /** A runner whose app reads JSON and a feed with its secret, published by c1 and kept in p1. @param {string} [value]  its secret */
  async function world(value = SECRET) {
    const now = () => Date.UTC(2026, 9, 29, 16, 0);
    const artifacts = createArtifactStore({ dataDir: fresh(), log: () => {}, now, four: () => "ab12" });
    const spaces = createSpaceStore({ dir: null, now });
    const secrets = createAppSecrets({ dataDir: null, now });
    const answers = /** @type {Record<string, import("../src/core/dashboard-sources.js").CommandOut>} */ ({});
    const runner = createDashboardRunner({
      spaces,
      artifacts,
      folderOf: () => fresh(),
      projectOfChain: () => "p1",
      now,
      secrets,
      run: async () => ({ ok: false, error: "no commands here" }),
      fetch: async (f) => answers[f.url] || { ok: false, error: "nothing" },
    });
    const at = { who: "c1", by: { chain: "c1", model: "m", folder: "/work/app", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 };
    const app = {
      type: "app",
      title: "Desk",
      html: "<!doctype html><title>Desk</title><main></main>",
      sources: {
        api: { fetch: { url: "https://api.example.test/me", headers: { authorization: "Bearer {secret.API_TOKEN}" } }, rows: "items" },
        feed: { fetch: { url: "https://api.example.test/feed", headers: { authorization: "Bearer {secret.API_TOKEN}" }, as: "rss" }, key: "id" },
      },
      secrets: { API_TOKEN: "Reads the API" },
    };
    assert.ok(artifactCall(/** @type {any} */ ({ action: "publish", ...app }), /** @type {any} */ (at), artifacts).ok);
    assert.equal(runner.keep("p1", "desk-ab12", 1).ok, true);
    secrets.set("desk-ab12", "API_TOKEN", value);
    return { runner, answers };
  }

  // (fails before: yes — found reviewing the Space work, 10-29: a feed's text had its tags dropped and its spaces made
  // one before its rows were hidden, and an entity no form knows (&#60;, &#x9;, &nbsp;) was read first, so a secret came
  // out changed — pa ss1234 — where no form of it was looked for)
  test("a feed's rows: a secret escaped as no form is, or holding a tag, a tab or a no-break space, is hidden before its text is made plain", async () => {
    /** @param {string} value @param {string} written  the secret as the feed writes it */
    const feedSays = async (value, written) => {
      const w = await world(value);
      w.answers["https://api.example.test/feed"] = {
        ok: true,
        out: `<rss version="2.0"><channel><title>T</title><item><guid>g1</guid><title>key ${written}</title><description>${"x".repeat(270)} ${written}</description></item></channel></rss>`,
      };
      const feed = /** @type {any} */ (await w.runner.read("desk-ab12", 1, "feed", { force: true })).state;
      assert.equal(feed.error, null);
      return feed.rows[0];
    };
    for (const [value, written] of [
      ["pa<b>ss1234", "pa&lt;b>ss1234"],
      ["pa<b>ss1234", "pa&#60;b&#62;ss1234"],
      ["pa<b>ss1234", "pa&#x3C;b&#x3E;ss1234"],
      ["ab\tcd1234", "ab&#x9;cd1234"],
      ["pass word", "pass&nbsp;word"],
      ["x&lt;y1234", "x&#38;lt;y1234"],
      // A no-break space escaped twice, as RSS often writes one: read at the second reading of entities.
      ["pass word", "pass&amp;nbsp;word"],
    ]) {
      const row = await feedSays(value, written);
      assert.equal(row.title, "key [API_TOKEN hidden]", `${written}: its title`);
      // Its text is cut after it is hidden: no start of it is left at the cut.
      assert.ok(row.text.endsWith(" [API_TOKEN hidden]".slice(0, 280 - 270)),`${written}: its text ends ${JSON.stringify(row.text.slice(-12))}`);
      assert.ok(!/ss1234|cd1234|word|y1234/.test(JSON.stringify(row)), `${written}: ${JSON.stringify(row)}`);
    }
  });

  // (fails before: yes — found reviewing the Space work, 10-29: a value of JSON's was written for its cell and cut at
  // 500 before its row was hidden, so a secret escaped as PHP writes it, astride the cut, left its start in the cell)
  test("a value of JSON's written for its cell: hidden before it is cut", async () => {
    const w = await world();
    const php = 'p@ss\\"w&rd\\/1\\u003e';
    // Its cell, {"pad":"…","token":"…"}, puts the secret at 491: the cut at 500 falls inside it.
    w.answers["https://api.example.test/me"] = { ok: true, out: `{"items":[{"id":1,"deep":{"pad":"${"x".repeat(472)}","token":"${php}"}}]}` };
    const api = /** @type {any} */ (await w.runner.read("desk-ab12", 1, "api", { force: true })).state;
    assert.equal(api.error, null);
    const deep = String(api.rows[0].deep);
    assert.equal(deep.length, 500);
    assert.ok(deep.endsWith('","token":"[API_TOKE') && !deep.includes("p@ss"), JSON.stringify(deep.slice(-24)));
  });

  // (fails before: yes — found by the review of 10-29: a row's numbers were never looked at, so a secret of digits an
  // answer wrote as another number, 1.2345678e7 for 12345678, stood in its row whole once parsed)
  test("a secret of digits an answer writes as another number: hidden in its row", async () => {
    const w = await world("12345678");
    w.answers["https://api.example.test/me"] = { ok: true, out: '{"items":[{"id":1,"n":1.2345678e7,"m":12345678.0,"deep":{"k":1.2345678E7},"other":42}]}' };
    const api = /** @type {any} */ (await w.runner.read("desk-ab12", 1, "api", { force: true })).state;
    assert.equal(api.error, null);
    // 12345678.0 is hidden as it was written, before it is read.
    assert.deepEqual(api.rows[0], { id: 1, n: "[API_TOKEN hidden]", m: "[API_TOKEN hidden].0", deep: '{"k":[API_TOKEN hidden]}', other: 42 });
  });

  // (fails before: yes — found by the review of 10-29: past 2^53, or below 1e-6, a number read is no longer its digits
  // — 1234567890123456789 reads as 1234567890123456800 —, so 17 of a secret's 19 digits stood in its row)
  test("a secret of more digits than a number keeps: hidden as the answer wrote it, before it is read", async () => {
    const w = await world("1234567890123456789");
    w.answers["https://api.example.test/me"] = {
      ok: true,
      out: '{"items":[{"id":1,"big":1234567890123456789,"neg":-1234567890123456789,"tiny":0.0000001234567890123456789,"deep":{"k":1234567890123456789},"s":"a \\"1234567890123456789\\" b","other":42,"pi":3.14}]}',
    };
    const api = /** @type {any} */ (await w.runner.read("desk-ab12", 1, "api", { force: true })).state;
    assert.equal(api.error, null);
    assert.deepEqual(api.rows[0], { id: 1, big: "[API_TOKEN hidden]", neg: "-[API_TOKEN hidden]", tiny: "0.000000[API_TOKEN hidden]", deep: '{"k":"[API_TOKEN hidden]"}', s: 'a "[API_TOKEN hidden]" b', other: 42, pi: 3.14 });
    assert.ok(!JSON.stringify(api.rows).includes("12345678901234"), "no run of its digits");
  });

  // (fails before: yes — found reviewing the Space work, 10-29: an answer of 400 or more had its tags dropped and its
  // spaces made one before the runner hid it, so a sign-in it echoed came out changed, or escaped as no form is)
  test("an answer of 400 or more echoing a secret: its words hidden before they are made plain", async () => {
    /** @param {string} body */
    const said = (body) =>
      fetchSource({ url: "https://api.example.test/me", headers: { authorization: "Bearer {secret.K}" }, as: "json" }, {
        secrets: { K: "pa<b>ss1234" },
        fetch: async () => new Response(body, { status: 401, statusText: "Unauthorized" }),
      });
    for (const body of ["<p>Invalid token pa<b>ss1234</p>", "<p>Invalid token pa&#60;b&#62;ss1234</p>", "Invalid token pa&lt;b&gt;ss1234"])
      assert.deepEqual(await said(body), { ok: false, error: "api.example.test answered 401 Unauthorized: Invalid token [K hidden]" }, body);
  });

  // (fails before: yes — found reviewing the Space work, 10-29: the host was read as the text before its first slash,
  // where an address's parser skips every slash and backslash after https:, so https:/{secret.K}.example.com put the
  // secret in the host — out in the name looked up, and in a failure's words, lowercased past every form of it)
  test("a fetch's host never names a secret, however its slashes are written: refused at publish, and at its read", async () => {
    /** @param {string} url */
    const fault = (url) => {
      const r = sourcesOf({ sources: { s: { fetch: { url }, rows: "items" } } });
      return r.ok ? "" : r.error;
    };
    for (const url of ["https:/{secret.K}.example.com/x", "https:///{secret.K}.example.com/x", "https://\\/{secret.K}.example.com/x", "https:\\\\{secret.K}.example.com/x"]) {
      assert.match(fault(url), /has a fetch whose host names a secret/, url);
      /** @type {string[]} */
      const asked = [];
      const r = await fetchSource({ url, headers: {}, as: "json" }, { secrets: { K: "MySecretToken" }, fetch: async (u) => (asked.push(u), new Response("[]")) });
      assert.deepEqual([r.ok, asked], [false, []], `${url}: nothing went out`);
      assert.match(/** @type {any} */ (r).error, /^its host names a secret/);
      assert.ok(!/mysecrettoken/i.test(JSON.stringify(r)), url);
    }
    assert.equal(fault("https://example.com/x?k={secret.K}"), "", "in its query: as before");
    assert.equal(fault("https://example.com/{secret.K}/x"), "", "in its path: as before");
  });

  // (fails before: yes — found reviewing the Space work: the answer was hidden before it was parsed, so JSON.parse and
  // the feed's entities turned p@ss\"w and p@ss&quot;w back into the secret, whole in the rows the page reads)
  test("the rows read from JSON or a feed, and a failure echoing its address, never hold it", async () => {
    const w = await world();
    // Escaped as PHP writes JSON (\/ and > as a \u escape) and as a feed may (&#34;): no form looked for in the answer is these.
    const php = 'p@ss\\"w&rd\\/1\\u003e';
    w.answers["https://api.example.test/me"] = { ok: true, out: `{"items":[{"id":1,"said":"your token is ${php}","deep":{"token":"${php}"}}]}` };
    w.answers["https://api.example.test/feed"] = {
      ok: true,
      out: `<rss version="2.0"><channel><title>T</title><item><guid>g1</guid><title>key p@ss&#34;w&#38;rd/1&gt;</title><description><![CDATA[${SECRET}]]></description></item></channel></rss>`,
    };
    const api = /** @type {any} */ (await w.runner.read("desk-ab12", 1, "api", { force: true })).state;
    assert.equal(api.error, null);
    assert.equal(api.rows[0].said, "your token is [API_TOKEN hidden]");
    assert.ok(!JSON.stringify(api.rows).includes("w&rd"), JSON.stringify(api.rows));
    const feed = /** @type {any} */ (await w.runner.read("desk-ab12", 1, "feed", { force: true })).state;
    assert.equal(feed.error, null);
    assert.equal(feed.rows[0].title, "key [API_TOKEN hidden]");
    assert.equal(feed.rows[0].text, "[API_TOKEN hidden]");
    w.answers["https://api.example.test/me"] = { ok: false, error: `api.example.test answered 404 Not Found: no /me?key=${encodeURIComponent(SECRET)} here` };
    const failed = /** @type {any} */ (await w.runner.read("desk-ab12", 1, "api", { force: true })).state;
    assert.equal(failed.error, "api.example.test answered 404 Not Found: no /me?key=[API_TOKEN hidden] here");
  });
});

// The review of the secret-hiding fix (10-29): what was still said of a secret, and an answer that held Filament up.
describe("a secret is hidden in what fails too, and a hostile answer reads in time", () => {
  /** A failed answer, as fetchSource says it. @param {string} body @param {Record<string, string>} secrets */
  const failedWith = (body, secrets) =>
    fetchSource({ url: "https://api.example.test/me", headers: { authorization: "Bearer {secret.K}" }, as: "json" }, {
      secrets,
      fetch: async () => new Response(body, { status: 401, statusText: "Unauthorized" }),
    });

  // (fails before: yes — its words were made plain as HTML, never read as JSON, so a server's own escapes — PHP's \/,
  // .NET's + — spelled the secret past every form)
  test("an answer of 400 or more in JSON: its escapes read before its words are hidden", async () => {
    const K = "q9/Zx+Tk7Lm2";
    for (const body of ['{"error":"invalid key q9\\/Zx+Tk7Lm2"}', '{"error":"invalid key q9/Zx\\u002BTk7Lm2"}'])
      assert.deepEqual(await failedWith(body, { K }), { ok: false, error: 'api.example.test answered 401 Unauthorized: {"error":"invalid key [K hidden]"}' }, body);
    assert.deepEqual(await failedWith('{"message":"Bad credentials"}', { K }), { ok: false, error: 'api.example.test answered 401 Unauthorized: {"message":"Bad credentials"}' }, "one with none, as before");
  });

  // (fails before: yes — the host it was sent on to was named, lowercased by the address's parser past every form)
  test("a redirect to another host whose name holds a secret: refused without naming it", async () => {
    const r = await fetchSource({ url: "https://api.example.test/me", headers: { authorization: "Bearer {secret.K}" }, as: "json" }, {
      secrets: { K: "MySecretToken" },
      fetch: async () => new Response(null, { status: 302, headers: { location: "https://MySecretToken.other.example/x" } }),
    });
    assert.deepEqual(r, { ok: false, error: "api.example.test sent it on to another host, which is not the host kept: Filament goes no further" });
  });

  // (fails before: yes — a command's last lines were cut to 400, and its stderr to its last 4000, before they were
  // hidden, so a secret astride a cut left its start, and no form matched it)
  test("a command's failure and a button's words: hidden before they are cut", async () => {
    const K = "abcdefgh12345678";
    const say = (/** @type {number} */ pad) => ["node", "-e", `process.stderr.write("x".repeat(${pad}) + " " + process.env.K); process.exit(1)`];
    const read = /** @type {any} */ (await runCommand(say(390), tmpdir(), undefined, { K }));
    assert.equal(read.ok, false);
    assert.ok(!/abcd/.test(read.error), read.error.slice(-40));
    const pressed = /** @type {any} */ (await runActionCommand(say(390), tmpdir(), undefined, undefined, { K }));
    assert.equal(pressed.ok, false);
    assert.ok(!/abcd/.test(pressed.error) && !/abcd/.test(pressed.said), `${pressed.error.slice(-40)} · ${pressed.said.slice(-40)}`);
  });

  // (fails before: yes — PHP's &#039;, Python's &#x27; and Go's &#34; were no form looked for)
  test("escaped as PHP, Python and Go write HTML", () => {
    const h = hider({ K: `it's-a-"key"1` });
    for (const f of ["it&#039;s-a-&quot;key&quot;1", "it&#x27;s-a-&quot;key&quot;1", "it&#39;s-a-&#34;key&#34;1"]) assert.equal(h.text(`a ${f} b`), "a [K hidden] b", f);
  });

  // (fails before: yes — two excerpts of what was said, cut before the hide their function takes)
  test("a feed that is none, and words that are no JSON: hidden before they are cut", () => {
    const hide = (/** @type {string} */ t) => t.split("secret-1234").join("[K hidden]");
    const feed = feedRows(`${"x".repeat(75)} secret-1234 and more`, "", hide);
    assert.ok(!feed.ok && !/secr/.test(feed.error), JSON.stringify(feed));
    const json = rowsFrom(`${"y".repeat(115)} secret-1234 and more`, /** @type {any} */ ({}), hide);
    assert.ok(!json.ok && !/secr/.test(json.error), JSON.stringify(json));
    // Tab-separated lines, a secret holding a tab: hidden before the line is cut at its tabs (10-29: the runner no
    // longer hides what a source said before it is read).
    const tabbed = (/** @type {string} */ t) => t.split("ab\tcd1234").join("[K hidden]");
    const lines = rowsFrom("one\tab\tcd1234\ttwo\n", /** @type {any} */ ({ fields: ["a", "b", "c"] }), tabbed);
    assert.deepEqual(lines, { ok: true, rows: [{ a: "one", b: "[K hidden]", c: "two" }] });
  });

  // (fails before: yes — a tag's pattern ran on to the end of the text from each "<" with no ">", and a feed's items
  // and Atom links the same: 1 MB of them held Filament's one thread for minutes)
  test("a hostile answer reads in time: no > after a <, no close to an item, a link that never ends", () => {
    const within = (/** @type {string} */ what, /** @type {() => unknown} */ f) => {
      const t = Date.now();
      f();
      assert.ok(Date.now() - t < 1000, `${what}: ${Date.now() - t} ms`);
    };
    within("plain text of &lt;", () => plainText("&lt;".repeat(100_000)));
    within("an error page of <", () => plainText("<".repeat(400_000)));
    within("items never closed", () => feedRows(`<rss>${"<item".repeat(80_000)}`));
    within("Atom links never ended", () => feedRows(`<feed><entry><title>t</title>${"<link a".repeat(60_000)}</entry></feed>`));
    // A feed as before.
    const ok = /** @type {any} */ (feedRows('<feed><entry><id>e1</id><title>T</title><link rel="alternate" href="https://x.test/1"/></entry><entry><id>e2</id><title>U</title></entry></feed>'));
    assert.deepEqual(ok.rows.map((/** @type {any} */ r) => [r.id, r.title, r.link]), [["e1", "T", "https://x.test/1"], ["e2", "U", ""]]);
  });
});

describe("a folder's pattern", () => {
  /**
   * A folder listed in a worker of its own, stopped at `ms`: a pattern that never ends fails the test, not the run.
   * @param {any} f @param {string} root @param {number} ms
   */
  const listedWithin = (f, root, ms) =>
    new Promise((resolve) => {
      const url = pathToFileURL(join(import.meta.dirname, "..", "src", "services", "source-folder.js")).href;
      const w = new Worker(`import(${JSON.stringify(url)}).then(async (m) => require("node:worker_threads").parentPort.postMessage(await m.listFolder(${JSON.stringify(f)}, ${JSON.stringify(root)})))`, { eval: true });
      const timer = setTimeout(() => (w.terminate(), resolve({ ok: false, error: `it did not end in ${ms} ms` })), ms);
      w.once("message", (m) => (clearTimeout(timer), w.terminate(), resolve(m)));
      w.once("error", (e) => (clearTimeout(timer), resolve({ ok: false, error: String(e) })));
    });

  // (fails before: yes — found reviewing the Space work: each * became .* in a regular expression, run in a synchronous
  // walk, so *a*a*…*b against a long name of a's backtracked for ever and stopped every chat and app with it)
  test("a pattern of many stars against a long name ends at once", async () => {
    const root = fresh();
    writeFileSync(join(root, "a".repeat(150)), "");
    writeFileSync(join(root, `${"a".repeat(149)}b`), "");
    const got = /** @type {any} */ (await listedWithin({ path: ".", match: `${"*a".repeat(18)}*b`, depth: 1 }, root, 3000));
    assert.equal(got.error, undefined, got.error);
    assert.deepEqual(JSON.parse(got.out).map((/** @type {any} */ r) => r.name), [`${"a".repeat(149)}b`]);
  });

  // (fails before: no — a guard found reviewing the Space work: the matcher that replaced the regular expression means
  // what it did)
  test("its meaning is as before: * any run, ? one character, case aside, every other character itself", async () => {
    const root = fresh();
    for (const n of ["App.EXE", "app.exe.bak", "report-01.csv", "report-1.csv", "a+b (1).[x]$", "notes.txt", "x-y"]) writeFileSync(join(root, n), "");
    /** @param {string} match */
    const names = async (match) => JSON.parse(/** @type {any} */ (await listFolder({ path: ".", match, depth: 1 }, root)).out).map((/** @type {any} */ r) => r.name);
    assert.deepEqual(await names("*.exe"), ["App.EXE"]);
    assert.deepEqual(await names("report-??.csv"), ["report-01.csv"]);
    assert.deepEqual(await names("a+b (?).[x]$"), ["a+b (1).[x]$"]);
    assert.deepEqual(await names("*"), ["a+b (1).[x]$", "App.EXE", "app.exe.bak", "notes.txt", "report-01.csv", "report-1.csv", "x-y"]);
    assert.deepEqual(await names("APP*"), ["App.EXE", "app.exe.bak"]);
    assert.deepEqual(await names("x*y"), ["x-y"]);
    assert.deepEqual(await names("*.t?t"), ["notes.txt"]);
    assert.deepEqual(await names("notes"), []);
  });
});
