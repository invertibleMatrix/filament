// @ts-check
// HarnessV2 Phase 5 — the web hands (§5.7 `plugins.web`) and the glob hand: pure over the text and result parsers
// and the private-address judgement; against a local HTTP server for fetch, redirects, caps, timeouts and search;
// end to end through the loop on a session that switched them on, with a rule that refuses one URL. No network.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs, { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { runWebHand, htmlToText, decodeEntities, parseSearchResults, isPrivateAddress, hostProblem, judgedLookup, WEB_FETCH_MAX_BYTES, WEB_TOOLS } from "../src/adapters/tools/web-hands.js";
import { runHand as runHandRaw, HAND_TOOLS } from "../src/adapters/tools/hands.js";
import { toolSetFor, isLoopTool, argSummary } from "../src/app/agent/tools.js";
import { systemPromptFor, PROMPT, PROMPT_VERSION } from "../src/app/agent/prompt.js";
import { POWERSHELL } from "../src/adapters/tools/shell.js";

/** The powershell hand rides only where there is a PowerShell (Windows): the tool lists below hold its place. */
const PS = POWERSHELL ? ["powershell"] : [];
// System on the wire: a string, or blocks carrying cache markers past minSystemChars.
const sysTextOf = (b) => (Array.isArray(b.system) ? b.system.map((x) => x?.text ?? "").join("\n") : String(b.system || ""));

/** hands.js is untyped JS: the root option is real, the inferred signature just does not know it. @type {(name: string, input: any, o: { root: string }) => Promise<string>} */
const runHand = /** @type {any} */ (runHandRaw);
const text = (blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
const lastResults = (msgs) => {
  const m = msgs.at(-1);
  return Array.isArray(m?.content) ? m.content.filter((c) => c?.type === "tool_result") : [];
};
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (blocks, stop = "end_turn", model = "brain-model") => anthropicReply("", { model, stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

const PAGE = `<!doctype html><html><head><title>Tallow &amp; Co</title><style>p{}</style><script>var x = "<p>no</p>";</script></head><body><h1>Welcome</h1><p>The project is <b>Tallow</b>.&nbsp;See <a href="/docs/intro">the intro</a> and <a href="https://example.org/x?a=1&amp;b=2">example</a>, or <a href="#top">top</a>.</p><ul><li>one</li><li>two</li></ul><img alt="a diagram" src="d.png"><!-- hidden --><noscript>enable js</noscript></body></html>`;

/** A local site: pages (plain and compressed), a long page, JSON, a binary, redirects, slow pages, and two search endpoints. */
function site() {
  /** @type {http.Server} */
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://x");
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { "content-type": type, ...headers });
      res.end(body);
    };
    switch (u.pathname) {
      case "/page":
        return send(200, "text/html; charset=utf-8", PAGE);
      case "/gz":
        return send(200, "text/html; charset=utf-8", gzipSync(PAGE), { "content-encoding": "gzip" });
      case "/df":
        return send(200, "text/html; charset=utf-8", deflateSync(PAGE), { "content-encoding": "deflate" });
      case "/br":
        return send(200, "text/html; charset=utf-8", brotliCompressSync(PAGE), { "content-encoding": "br" });
      case "/long":
        return send(200, "text/html", `<html><body><p>${"word ".repeat(12_000)}</p></body></html>`);
      case "/data.json":
        return send(200, "application/json", JSON.stringify({ ok: true, n: 3 }));
      case "/pic.png":
        return send(200, "image/png", Buffer.from([137, 80, 78, 71]));
      case "/hop":
        return send(302, "text/plain", "", { location: "/page" });
      case "/loop":
        return send(302, "text/plain", "", { location: "/loop" });
      case "/away":
        return send(302, "text/plain", "", { location: "http://10.0.0.1/secret" });
      case "/slow":
        return void setTimeout(() => send(200, "text/plain", "late"), 3000);
      case "/stall":
        res.writeHead(200, { "content-type": "text/plain" });
        return void res.write("the start, and then nothing");
      case "/big":
        res.writeHead(200, { "content-type": "text/plain" });
        for (let i = 0; i < 60; i++) res.write("x".repeat(64 * 1024));
        return void res.end();
      case "/search":
        return send(200, "text/html", `<html><body><div class="results"><div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Ftallow&amp;rut=abc">Tallow &mdash; the project</a><a class="result__snippet" href="/x">All about <b>Tallow</b>.</a></div><div class="result"><a class="result__a" href="https://example.net/other">Other</a><a class="result__snippet">Something else.</a></div></div></body></html>`);
      case "/search.json":
        return send(200, "application/json", JSON.stringify({ query: u.searchParams.get("q"), results: [{ title: "JSON hit", url: "https://example.org/json", content: "from json" }, { title: "no url" }] }));
      case "/empty":
        return send(200, "text/html", "<html><body><p>nothing here</p></body></html>");
      case "/multi": {
        // One endpoint, an answer per query: "alpha" and "beta" share a page (as two spellings of its address).
        const q = u.searchParams.get("q");
        if (q === "boom") return send(500, "text/plain", "down");
        const rows = {
          alpha: [{ title: "Alpha only", url: "https://example.org/alpha", content: "a" }, { title: "Shared", url: "https://example.org/shared", content: "" }],
          beta: [{ title: "Shared again", url: "https://www.example.org/shared/?utm_source=x#top", content: "the shared page" }, { title: "Beta only", url: "https://example.org/beta", content: "b" }],
        }[q || ""] || [];
        return send(200, "application/json", JSON.stringify({ results: rows }));
      }
      case "/svc": {
        // A search service's API: a POST whose key rides a header, answered as Brave answers (marks in its words).
        let raw = "";
        req.on("data", (d) => (raw += d));
        return void req.on("end", () => {
          if (req.method !== "POST" || req.headers["x-key"] !== "good") return send(401, "application/json", JSON.stringify({ error: "bad key" }));
          const { query, n } = JSON.parse(raw || "{}");
          send(200, "application/json", JSON.stringify({ web: { results: [{ title: `<strong>${query}</strong> hit`, url: "https://svc.example/hit", description: `n=${n} &amp; more` }] } }));
        });
      }
      case "/bot":
        return send(202, "text/html", `<html><body><div class="anomaly-modal">Unfortunately, bots use DuckDuckGo too.</div><a href="https://duckduckgo.com/about">About DuckDuckGo</a></body></html>`);
      case "/svc-hop":
        // A service's GET sent elsewhere: the next hop is another origin (127.0.0.1 for a name that resolves to it).
        return send(302, "text/plain", "", { location: `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}/echo-key` });
      case "/echo-key":
        return send(200, "application/json", JSON.stringify({ results: [{ title: `key ${req.headers["x-key"] ? "sent" : "not sent"}`, url: "https://echo.example/" }] }));
      default:
        return send(404, "text/plain", "no such page");
    }
  });
  return {
    server,
    start: () => new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined))),
    url: () => `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`,
    stop: () => new Promise((r) => server.close(() => r(undefined))),
  };
}

describe("web hands — pure", () => {
  test("isPrivateAddress and hostProblem: loopback, RFC1918, link-local, CGNAT, IPv6 kin and local names are refused unless allowed; names are judged by every address", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "fc00::1", "::ffff:127.0.0.1", "fec0::1", "fef0::1", "64:ff9b::7f00:1", "64:ff9b::10.0.0.1", "64:ff9b::a9fe:a9fe", "not-an-ip"]) assert.ok(isPrivateAddress(ip), ip);
    for (const ip of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "93.184.216.34", "2606:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808", "64:ff9b::8.8.8.8", "64:ff9b:1::1", "fe00::1"]) assert.ok(!isPrivateAddress(ip), ip);
    const resolve = async (host) => (host === "both.example" ? ["93.184.216.34", "10.0.0.5"] : host === "pub.example" ? ["93.184.216.34"] : host === "none.example" ? [] : Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })));
    assert.equal(await hostProblem(new URL("https://pub.example/x"), { resolve }), null);
    assert.match(String(await hostProblem(new URL("https://both.example/x"), { resolve })), /resolves to 10\.0\.0\.5, a private or local address/);
    assert.match(String(await hostProblem(new URL("https://none.example/x"), { resolve })), /does not resolve/);
    assert.match(String(await hostProblem(new URL("https://missing.example/x"), { resolve })), /does not resolve \(ENOTFOUND\)/);
    assert.match(String(await hostProblem(new URL("http://127.0.0.1:20300/api/config"), { resolve })), /127\.0\.0\.1 is a private or local address/);
    assert.match(String(await hostProblem(new URL("http://[::1]/"), { resolve })), /::1 is a private or local address/);
    assert.match(String(await hostProblem(new URL("http://localhost:3000/"), { resolve })), /localhost is a local name/);
    assert.match(String(await hostProblem(new URL("http://printer.local/"), { resolve })), /is a local name/);
    assert.match(String(await hostProblem(new URL("ftp://pub.example/"), { resolve })), /only http\(s\) URLs/);
    assert.match(String(await hostProblem(new URL("https://user:pw@pub.example/"), { resolve })), /credentials/);
    assert.equal(await hostProblem(new URL("http://127.0.0.1:20300/"), { allowPrivate: true, resolve }), null, "allowed when the operator says so");
  });

  test("judgedLookup: every address the resolver gives is judged, one private address refusing the name unless allowed; Node's two forms answered (every address, or one of a family); a name with no address of the family said", async () => {
    const resolve = async (/** @type {string} */ host) =>
      host === "pub.example" ? ["93.184.216.34", "2606:4700::1111"] : host === "both.example" ? ["93.184.216.34", "10.0.0.5"] : host === "gone.example" ? Promise.reject(Object.assign(new Error("queryA ENOTFOUND gone.example"), { code: "ENOTFOUND" })) : [];
    /** @param {import("node:net").LookupFunction} lk @param {string} host @param {any} options @returns {Promise<any>} */
    const ask = (lk, host, options) => new Promise((ok, no) => lk(host, options, (err, address, family) => (err ? no(err) : ok(options.all ? address : { address, family }))));
    const judged = judgedLookup({ allowPrivate: false, resolve });
    assert.deepEqual(await ask(judged, "pub.example", { all: true }), [{ address: "93.184.216.34", family: 4 }, { address: "2606:4700::1111", family: 6 }]);
    assert.deepEqual(await ask(judged, "pub.example", { all: true, family: 4 }), [{ address: "93.184.216.34", family: 4 }]);
    assert.deepEqual(await ask(judged, "pub.example", { family: 6 }), { address: "2606:4700::1111", family: 6 });
    assert.deepEqual(await ask(judged, "pub.example", {}), { address: "93.184.216.34", family: 4 }, "one asked for: the first");
    await assert.rejects(ask(judged, "both.example", { all: true }), /both\.example resolves to 10\.0\.0\.5, a private or local address/);
    assert.deepEqual(await ask(judgedLookup({ allowPrivate: true, resolve }), "both.example", { all: true }), [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }], "allowed: handed over as resolved");
    await assert.rejects(ask(judged, "none.example", { all: true }), (/** @type {any} */ e) => e.code === "ENOTFOUND" && /none\.example does not resolve/.test(e.message));
    await assert.rejects(ask(judgedLookup({ allowPrivate: false, resolve: async () => ["93.184.216.34"] }), "v4only.example", { family: 6 }), (/** @type {any} */ e) => e.code === "ENOTFOUND");
    await assert.rejects(ask(judged, "gone.example", { all: true }), (/** @type {any} */ e) => e.code === "ENOTFOUND", "the resolver's own failure passes through");
  });

  test("htmlToText: scripts, styles and comments go; blocks break lines, list items dash, links keep their absolute URL, entities decode, the title leads", () => {
    const t = htmlToText(`<!doctype html><html><head><title>Tallow &amp; Co</title><style>p{}</style><script>var x = "<p>no</p>";</script></head><body><h1>Welcome</h1><p>The project is <b>Tallow</b>.&nbsp;See <a href="/docs/intro">the intro</a> and <a href="https://example.org/x?a=1&amp;b=2">example</a>, or <a href="#top">top</a> or <a href="javascript:void(0)">js</a>.</p><ul><li>one</li><li>two</li></ul><img alt="a diagram" src="d.png"><!-- hidden --><noscript>enable js</noscript></body></html>`, { baseUrl: "https://site.example/a/b" });
    assert.equal(t, "Tallow & Co\n\nWelcome\n\nThe project is Tallow. See the intro <https://site.example/docs/intro> and example <https://example.org/x?a=1&b=2>, or top or js.\n\n- one\n- two\n[image: a diagram]");
    assert.equal(decodeEntities("a &lt; b &#39;c&#x27; &hellip; &unknown; &#0;"), "a < b 'c' … &unknown; &#0;");
    assert.equal(htmlToText("<p>x</p><p>y</p>"), "x\n\ny", "no title, no lead; paragraphs keep a blank line between them");
    assert.equal(htmlToText("<title>T</title><h1>T</h1>rest"), "T\n\nrest", "a title the body already opens with is not doubled");
  });

  test("parseSearchResults: JSON result arrays, DuckDuckGo's HTML (redirect links unwrapped, snippets paired), a page's links as the last resort; duplicates and non-http links dropped", () => {
    const j = parseSearchResults(JSON.stringify({ results: [{ title: "A", url: "https://a.example/", content: "aa" }, { title: "B", link: "https://b.example/", snippet: "bb" }, { title: "dup", url: "https://a.example/" }, { title: "ftp", url: "ftp://x" }] }), "application/json");
    assert.deepEqual(j, [{ title: "A", url: "https://a.example/", snippet: "aa" }, { title: "B", url: "https://b.example/", snippet: "bb" }]);
    const ddg = parseSearchResults(`<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Ftallow&amp;rut=abc">Tallow &mdash; the <b>project</b></a><a class="result__snippet" href="/x">All about <b>Tallow</b>.</a></div><div class="result"><a class="result__a" href="https://example.net/other">Other</a><a class="result__snippet">Something else.</a></div>`, "text/html");
    assert.deepEqual(ddg, [{ title: "Tallow — the project", url: "https://example.org/tallow", snippet: "All about Tallow." }, { title: "Other", url: "https://example.net/other", snippet: "Something else." }]);
    const any = parseSearchResults(`<a href="https://one.example/">First hit</a> <a href="/rel">rel</a> <a href="https://two.example/">Go</a> <a href="https://three.example/">Third hit</a>`, "text/html");
    assert.deepEqual(any.map((r) => r.url), ["https://one.example/", "https://three.example/"], "a link with fewer than three visible characters is navigation, not a result");
    assert.deepEqual(parseSearchResults("<p>nothing</p>", "text/html"), []);
    assert.deepEqual(parseSearchResults("not json {", "application/json"), [], "bad JSON is read as a page, which has no links");
  });

  test("the toolset and the prompt: web hands ride only when asked (after the loop's own tools, one frozen set per choice); the set is mode-invariant; the prompt names them; argSummary shows the URL or the query", () => {
    assert.deepEqual(WEB_TOOLS.map((t) => t.name), ["web_fetch", "web_search"]);
    assert.ok(HAND_TOOLS.some((t) => t.name === "glob"));
    const plain = toolSetFor({ delegateRead: false });
    assert.ok(!plain.some((t) => t.name.startsWith("web_")), "no document, no web hands");
    const both = toolSetFor({ delegateRead: false, web: { fetch: true, search: true } });
    assert.deepEqual(both.map((t) => t.name), ["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", ...PS, "grep", "glob", "lsp", "ask", "plan", "agent", "wait", "envelope", "visual_guide", "show_visual", "artifact", "space", "team", "flow", "thread", "web_fetch", "web_search"]);
    assert.equal(toolSetFor({ delegateRead: false, web: { fetch: true, search: true } }), both, "same choice, same frozen array");
    assert.deepEqual(toolSetFor({ delegateRead: false, web: { fetch: true }, disabled: ["web_fetch", "glob"] }).map((t) => t.name), ["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", ...PS, "grep", "lsp", "ask", "plan", "agent", "wait", "envelope", "visual_guide", "show_visual", "artifact", "space", "team", "flow", "thread"], "loop.tools still wins");
    assert.ok(isLoopTool("web_fetch") && isLoopTool("web_search") && isLoopTool("glob"));
    assert.equal(PROMPT_VERSION, 129, "the tools at Claude Code's level (HarnessV3-Tools) made version 11; a team's lead and its workers (HarnessV3-AtHome P2) 12; the lead's watch and its workers' asks 13; Validate and Autonomous 14; the task graph (HarnessV3-TaskGraph) 15; its sub-agents' tasks (G2) 16; a lead's graph (G3) 17; a send-back to the last worker (HarnessV3-FailurePoints) 18; a saved agent's card (HarnessV4_Tasks E15) 19; the agents a session's agent may ask (E15 step 3) 20; every launch as a card (E15 step 4) 21; three ways its sub-agents pay (the same step) 22; a sub-agent the developer launched waits for their answer (E15 step 5) 23; a lead that reads along with its workers (HarnessV3-TaskGraph-v2 V2-0a) 24; its answer to a worker's call (TG2-D41) 25; a team that briefs, checks and answers as a real team does (§13) 26; a lead that looks when something is new, workers that ask it and plans it reviews (§13.13) 27; a coding agent's third read of a worker it leads (TG2-D56) 28; a team that works as engineers with a senior lead (§13.17) 29; a lead that reads what its workers say and do, never what they think (TG2-D60) 30; a lead's brief launched as attempts (TG2-D53) 31; a model that takes no tools told why it has none (HarnessV4_Tasks E4) 32; a task's check Filament runs itself (HarnessV3-TaskGraph-v2 V2-1) 33; a writing task's check its worker's report names (TG2-D63) 34; a task Filament runs itself, no model (V2-3) 35; the agent's checklist on its graph (V2-5) 36; a lead's own hands (HarnessV4_Tasks decision 9) 37; a sub-agent named by its model, provider and effort (HarnessV4_Tasks E23) 38; a saved agent that starts apart and the context window 39; a crew's models as an order 40; the agent's browser (HarnessV4_Browser_Plan BR2) 41; one kind of agent (HarnessV4_OneAgent_Plan OA1) 42; a result sealed as an envelope (HarnessV4_Envelopes_Plan EN1) 43; the envelope tool (EN2) 44; a picture opened by its name (HarnessV4_DesignPass_Plan UX1) 45; notes and files kept behind the graph's tasks (HarnessV4_TaskNotes_Plan E33) 46; a task paused with its checkpoint (HarnessV4_TaskGraphPlus_Plan E41 P1) 47; a done that proves its done-when (E41 P2) 48; report on the agent's own set while its graph is on, for a task started as its fork (the owner's words of 10-26) 49; the MCP tools that load on demand (E49) 50; the skills list in a fixed budget and the skill tool finding skills by words (the owner's word of 10-27) 54; reads side by side (the owner's word of 10-27) 55, a coding agent's launch that names its graph task (the Designer's of 10-28) 56; the product named Filament 57; an app the artifact tool makes (the owner's of 10-29) 58; the space tool's app action 59; the page guide's shelf 60; more reads 61; local webhooks 62; app glances 63; the app frame 64; an app's SQLite 65; a Space's apps as rows of the left bar 66; an imported app's .filament-web/ 67; a sub-agent's change marked as applied (10-29) 68; the task graph always on (10-29) 69; the app guide's folder and starters, New app's words the person's (10-29) 70; the team tool's models (10-30) 71; the team tool's note and status (10-30) 72; a sub-agent's task alone by default (10-31) 73; filament_recall's words without digests (10-31) 74; a task's found_by (11-02) 75; a graph task's work waiting for its apply (11-02) 76; a lead's orders run at once (11-03) 77; Builders' one lead (11-04) 78; a short job's checklist and a complex one's graph (11-04) 79; the lsp tool after the hands (11-04) 80; letters between an agent and its sub-agents (11-04) 81; a sub-agent's wait for a letter's reply, the lsp tool's shorter words (11-04) 82; what makes work complex enough for the graph, a short job never on it (11-05) 83; web_search's several searches at once (11-05) 84; a plan asked for alone, made whole and none of it started (11-05) 85; a command past its timeout in the background (11-05) 86; no number of agents at once of Filament's own, so no sentence of it (11-05) 87; no tool's words left wrong to keep the cache: who runs on what, left out (11-05) 88; one list the first that sets any, a lead's worker's as a launch takes it (11-05) 89; the owner's tool plan of 11-08, no em dash in a tool's words 94; the prompt pass of 11-08, each fact once where it is used 97; work of more than one step on the checklist or the graph, never neither (11-08) 98; the loop's tool texts said where they are used (11-08) 99; an apply that overlaps the folder's edits offers a way on (11-09) 100; what is still open takes dismiss (11-09) 101; writes as a forecast (11-09) 102; a follow-up to a sub-agent at work sent as a message, the graph's words given their freedom (11-09) 103; a done task reopened by start, several done in one call, a drop cutting the needs on it (11-09) 104; a lead's graph line saying version 98's rule, a report waiting sealed in a lead's words, the envelope sealing unless the chat takes results whole (11-09) 105; main's 105 merged with builds' s-tools hunt and Chrome on this machine for the browser (11-09) 106; Parallelize tasks' line naming a chat whose sub-agents work in its folder (11-09) 107; Filament's co-author line on a commit while its switch is on (11-10) 108; a coding agent's wait for its background commands too (11-10) 109");
    const p = systemPromptFor({ root: "R", delegateRead: false, web: { fetch: true, search: true } });
    assert.ok(p.includes(PROMPT.webFetch) && p.includes(PROMPT.webSearch) && !p.includes(PROMPT.webSearchAlone));
    const s = systemPromptFor({ root: "R", delegateRead: false, web: { search: true } });
    assert.ok(!s.includes(PROMPT.webFetch) && s.includes(PROMPT.webSearchAlone));
    assert.equal(systemPromptFor({ root: "R", delegateRead: false, web: { fetch: true }, toolsOff: ["web_fetch"] }), systemPromptFor({ root: "R", delegateRead: false }), "switched off: not mentioned");
    assert.ok(systemPromptFor({ root: "R", delegateRead: false, toolsOff: ["glob"] }).includes(`${PROMPT.toolsOff} glob.`));
    assert.equal(argSummary("web_fetch", { url: `https://x.example/${"p".repeat(300)}` }).length, 200, "the URL, clipped");
    assert.equal(argSummary("web_search", { query: "tallow project" }), "tallow project");
    assert.equal(argSummary("glob", { pattern: "**/*.md", path: "docs" }), "**/*.md in docs");
  });

  test("glob hand: a name pattern matches at any depth, a path pattern the relative path; node_modules is skipped; the limit notice; no match said; a folder outside the root refused", async () => {
    const root = mkdtempSync(join(tmpdir(), "filament-glob-"));
    try {
      mkdirSync(join(root, "src", "deep"), { recursive: true });
      mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
      mkdirSync(join(root, "docs"));
      writeFileSync(join(root, "README.md"), "");
      writeFileSync(join(root, "docs", "guide.md"), "");
      writeFileSync(join(root, "src", "a.js"), "");
      writeFileSync(join(root, "src", "deep", "b.js"), "");
      writeFileSync(join(root, "src", "deep", "c.ts"), "");
      writeFileSync(join(root, "node_modules", "pkg", "index.js"), "");
      assert.equal(await runHand("glob", { pattern: "*.md" }, { root }), "README.md\ndocs/guide.md");
      assert.equal(await runHand("glob", { pattern: "src/**/*.js" }, { root }), "src/a.js\nsrc/deep/b.js");
      assert.equal(await runHand("glob", { pattern: "*.{js,ts}", path: "src/deep" }, { root }), "b.js\nc.ts");
      // (fails before: yes — braces passed their stars and question marks to the expression as they were: this
      // one threw, and a ? in braces made the character before it optional)
      assert.equal(await runHand("glob", { pattern: "{*.js,*.ts}", path: "src/deep" }, { root }), "b.js\nc.ts");
      assert.equal(await runHand("glob", { pattern: "src/{deep/?.ts,a.js}" }, { root }), "src/a.js\nsrc/deep/c.ts");
      assert.equal(await runHand("glob", { pattern: "*.js", limit: 1 }, { root }), "src/a.js\n1 paths limit reached (2 matches). Use limit=2 for more, or a narrower pattern.");
      assert.equal(await runHand("glob", { pattern: "*.py" }, { root }), "No files match *.py under the task folder.");
      assert.equal(await runHand("glob", { pattern: "index.js" }, { root }), "No files match index.js under the task folder.", "node_modules is not walked");
      await assert.rejects(runHand("glob", { pattern: "*", path: ".." }, { root }), /outside|escapes|not inside|root/i);
      await assert.rejects(runHand("glob", { pattern: "*", path: "README.md" }, { root }), /is a file, not a folder/);
      await assert.rejects(runHand("glob", { pattern: "" }, { root }), /needs a pattern/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("glob hand: sort modified lists the newest first, a tie in path order; path order stays the default; another sort refused (TL-D20)", async () => {
    const root = mkdtempSync(join(tmpdir(), "filament-glob-"));
    try {
      mkdirSync(join(root, "logs"));
      const at = (/** @type {string} */ rel, /** @type {number} */ s) => {
        writeFileSync(join(root, rel), "");
        utimesSync(join(root, rel), s, s);
      };
      at("a.log", 1_700_000_100);
      at("logs/b.log", 1_700_000_300);
      at("c.log", 1_700_000_200);
      at("logs/a.log", 1_700_000_300);
      assert.equal(await runHand("glob", { pattern: "*.log", sort: "modified" }, { root }), "logs/a.log\nlogs/b.log\nc.log\na.log");
      assert.equal(await runHand("glob", { pattern: "*.log", sort: "modified", limit: 2 }, { root }), "logs/a.log\nlogs/b.log\n2 paths limit reached (4 matches). Use limit=4 for more, or a narrower pattern.", "the limit takes the newest");
      assert.equal(await runHand("glob", { pattern: "*.log" }, { root }), "a.log\nc.log\nlogs/a.log\nlogs/b.log");
      assert.equal(await runHand("glob", { pattern: "*.log", sort: "path" }, { root }), "a.log\nc.log\nlogs/a.log\nlogs/b.log");
      await assert.rejects(runHand("glob", { pattern: "*.log", sort: "size" }, { root }), /sort is "path" or "modified"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // (fails before: yes — every match's time was asked for at once: up to 20,000 looks queued in front of every other
  // read and request)
  test("glob hand: sort modified looks at a few times at once, and lists them in the same order", async () => {
    const root = mkdtempSync(join(tmpdir(), "filament-glob-many-"));
    const real = fs.promises.stat;
    try {
      mkdirSync(join(root, "d"));
      /** @type {[string, number][]} */
      const made = [];
      for (let i = 0; i < 300; i++) {
        const rel = `${i % 2 ? "d/" : ""}f${String((i * 7919) % 300).padStart(3, "0")}.txt`;
        const s = 1_700_000_000 + ((i * 31) % 97);
        writeFileSync(join(root, rel), "");
        utimesSync(join(root, rel), s, s);
        made.push([rel, s]);
      }
      const want = made.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([rel]) => rel);
      let now = 0;
      let most = 0;
      fs.promises.stat = /** @type {any} */ (async (/** @type {any[]} */ ...a) => {
        most = Math.max(most, ++now);
        try {
          return await /** @type {any} */ (real)(...a);
        } finally {
          now--;
        }
      });
      syncBuiltinESMExports();
      const got = await runHand("glob", { pattern: "*.txt", sort: "modified", limit: 2000 }, { root });
      assert.deepEqual(got.split("\n"), want);
      assert.ok(most > 1 && most <= 16, `${most} looks at once`);
    } finally {
      fs.promises.stat = real;
      syncBuiltinESMExports();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("web hands — against a local site", () => {
  const s = site();
  before(() => s.start());
  after(() => s.stop());
  const opts = () => ({ allowPrivate: true, timeoutMs: 20_000 });

  test("web_fetch: HTML as text with the URL and type on the first line; JSON as it is; a binary refused; a 404 said; a bad URL said", async () => {
    const page = await runWebHand("web_fetch", { url: `${s.url()}/page` }, opts());
    assert.equal(page, `${s.url()}/page · text/html\n\nTallow & Co\n\nWelcome\n\nThe project is Tallow. See the intro <${s.url()}/docs/intro> and example <https://example.org/x?a=1&b=2>, or top.\n\n- one\n- two\n[image: a diagram]`);
    assert.equal(await runWebHand("web_fetch", { url: `${s.url()}/data.json` }, opts()), `${s.url()}/data.json · application/json\n\n{"ok":true,"n":3}`);
    await assert.rejects(runWebHand("web_fetch", { url: `${s.url()}/pic.png` }, opts()), /is image\/png, not text/);
    assert.match(await runWebHand("web_fetch", { url: `${s.url()}/nope` }, opts()), /^http:\/\/127\.0\.0\.1:\d+\/nope \(HTTP 404\) · text\/plain\n\nno such page$/);
    await assert.rejects(runWebHand("web_fetch", { url: "not a url" }, opts()), /not a URL/);
    await assert.rejects(runWebHand("web_fetch", {}, opts()), /needs a url/);
  });

  test("web_fetch: a long page's result — head and continuation notice included — stays inside 24,000 bytes; offset continues where it stopped; past the end said", async () => {
    const bytes = (/** @type {string} */ t) => Buffer.byteLength(t);
    const first = await runWebHand("web_fetch", { url: `${s.url()}/long` }, opts());
    const m = /…\[Filament: ([\d,]+) more characters; continue with offset=(\d+)\]$/.exec(first);
    assert.ok(m, first.slice(-200));
    const offset = Number(m[2]);
    const head = first.slice(0, first.indexOf("\n\n") + 2);
    assert.equal(offset, first.length - head.length - m[0].length - 1, "the offset is exactly where the shown text stopped");
    assert.ok(bytes(first) <= WEB_FETCH_MAX_BYTES, `${bytes(first)} bytes: the whole result fits the budget, so the loop's guard never takes its notice`);
    const second = await runWebHand("web_fetch", { url: `${s.url()}/long`, offset }, opts());
    const page = "word ".repeat(12_000).trim();
    assert.ok(second.includes(`\n\n[from character ${offset.toLocaleString()}]\n${page.slice(offset, offset + 40)}`), "the next call continues exactly at the offset");
    assert.match(second, /…\[Filament: [\d,]+ more characters; continue with offset=\d+\]$/);
    assert.ok(bytes(second) <= WEB_FETCH_MAX_BYTES);
    assert.match(await runWebHand("web_fetch", { url: `${s.url()}/long`, offset: 10_000_000 }, opts()), /offset 10,000,000 is past the end: the page is [\d,]+ characters/);
    // A caller's smaller budget holds the same way.
    const small = await runWebHand("web_fetch", { url: `${s.url()}/long` }, { ...opts(), maxBytes: 5000 });
    assert.ok(bytes(small) <= 5000, `${bytes(small)}`);
    assert.match(small, /…\[Filament: [\d,]+ more characters; continue with offset=\d+\]$/);
  });

  test("web_fetch under privacy.redact: the page is redacted before its window is cut — no secret half-shown at the edge, a longer mark never pushes the notice out, and offsets count the redacted page", async () => {
    const redact = (/** @type {string} */ t) => t.replace(/word/g, "[redacted-secret]");
    const first = await runWebHand("web_fetch", { url: `${s.url()}/long` }, { ...opts(), redact });
    assert.ok(Buffer.byteLength(first) <= WEB_FETCH_MAX_BYTES, `${Buffer.byteLength(first)} bytes: a mark four times the word's size still fits`);
    const m = /\n…\[Filament: [\d,]+ more characters; continue with offset=(\d+)\]$/.exec(first);
    assert.ok(m, first.slice(-200));
    const shown = first.slice(0, m.index);
    assert.ok(!shown.includes("wor") && !/(^|\s)wo?$/.test(shown), "no part of a secret at the window's edge");
    const second = await runWebHand("web_fetch", { url: `${s.url()}/long`, offset: Number(m[1]) }, { ...opts(), redact });
    assert.ok(!second.includes("wor"));
    assert.match(second, /\n\n\[from character [\d,]+\]\n/);
  });

  test("web_fetch: redirects are followed by hand and every hop judged; a redirect loop stops; a private host without permission is refused before any request; a slow page times out; a huge body stops at 2 MB", async () => {
    assert.match(await runWebHand("web_fetch", { url: `${s.url()}/hop` }, opts()), new RegExp(`^${s.url().replace(/[.]/g, "\\.")}/page · text/html\\n\\nTallow & Co`), "the final URL is reported");
    await assert.rejects(runWebHand("web_fetch", { url: `${s.url()}/loop` }, opts()), /too many redirects/);
    await assert.rejects(runWebHand("web_fetch", { url: `${s.url()}/away` }, { allowPrivate: false, timeoutMs: 5000, resolve: async () => ["93.184.216.34"] }), /Not fetched: 127\.0\.0\.1 is a private or local address/, "the first hop is already private without permission");
    await assert.rejects(runWebHand("web_fetch", { url: `${s.url()}/page` }, { allowPrivate: false }), /Not fetched: 127\.0\.0\.1 is a private or local address; the web hands reach public addresses only \(agentLoop\.web\.allowPrivate lifts this\)\./);
    await assert.rejects(runWebHand("web_fetch", { url: `${s.url()}/slow` }, { allowPrivate: true, timeoutMs: 1000 }), /did not answer within 1 s/);
    const big = await runWebHand("web_fetch", { url: `${s.url()}/big` }, opts());
    assert.match(big, /· read stopped at 2 MB\n\n/);
    assert.ok(big.length <= WEB_FETCH_MAX_BYTES + 200);
  });

  test("web_fetch connects to the addresses it judged, on a connection of its own: a name is fetched through the hands' answer for it, and one that answers public to the check and private to the connection is refused (fails before: yes — the fetch looked the name up again by itself: `rebind.test` did not resolve, and a second answer went unjudged)", async () => {
    const url = `http://rebind.test:${new URL(s.url()).port}/page`;
    assert.match(await runWebHand("web_fetch", { url }, { allowPrivate: true, timeoutMs: 20_000, resolve: async () => ["127.0.0.1"] }), /^http:\/\/rebind\.test:\d+\/page · text\/html\n\nTallow & Co/);
    let calls = 0;
    const rebinding = async () => (++calls % 2 ? ["93.184.216.34"] : ["127.0.0.1"]);
    await assert.rejects(runWebHand("web_fetch", { url }, { allowPrivate: false, timeoutMs: 5000, resolve: rebinding }), /Not fetched: rebind\.test resolves to 127\.0\.0\.1, a private or local address; the web hands reach public addresses only/);
    assert.equal(calls, 2, "judged for the check, then again for the connection: the second answer is judged too, never a kept connection's");
  });

  test("web_fetch: a page sent compressed — gzip, deflate or br — is read as its text; a page that stops coming is said in the deadline's words (fails before: no — a guard the mutation pass asked for: the hands read the body themselves now)", async () => {
    const body = (/** @type {string} */ r) => r.slice(r.indexOf("\n\n"));
    const plain = body(await runWebHand("web_fetch", { url: `${s.url()}/page` }, opts()));
    assert.ok(plain.includes("The project is Tallow."), plain);
    for (const path of ["/gz", "/df", "/br"]) assert.equal(body(await runWebHand("web_fetch", { url: `${s.url()}${path}` }, opts())), plain, path);
    await assert.rejects(runWebHand("web_fetch", { url: `${s.url()}/stall` }, { allowPrivate: true, timeoutMs: 1000 }), /did not answer within 1 s/);
  });

  test("web_search: the endpoint template takes the encoded query; DuckDuckGo-style HTML and JSON answers list title, URL and snippet; limit; nothing found said; a failing endpoint said", async () => {
    const html = await runWebHand("web_search", { query: "tallow project" }, { ...opts(), searchEndpoint: `${s.url()}/search?q={query}` });
    assert.equal(html, `Results for "tallow project" (127.0.0.1:${new URL(s.url()).port}):\n\n1. Tallow — the project\n   https://example.org/tallow\n   All about Tallow.\n2. Other\n   https://example.net/other\n   Something else.`);
    const json = await runWebHand("web_search", { query: "x y", limit: 1 }, { ...opts(), searchEndpoint: `${s.url()}/search.json` });
    assert.equal(json, `Results for "x y" (127.0.0.1:${new URL(s.url()).port}):\n\n1. JSON hit\n   https://example.org/json\n   from json`, "a bare endpoint gets ?q=; the row without a URL is dropped; limit 1");
    assert.equal(await runWebHand("web_search", { query: "zzz" }, { ...opts(), searchEndpoint: `${s.url()}/empty` }), `No results for "zzz" (127.0.0.1:${new URL(s.url()).port}).`);
    await assert.rejects(runWebHand("web_search", { query: "zzz" }, { ...opts(), searchEndpoint: `${s.url()}/nope` }), /the search endpoint answered HTTP 404/);
    await assert.rejects(runWebHand("web_search", { query: "zzz" }, { allowPrivate: false, searchEndpoint: `${s.url()}/search?q={query}` }), /Not fetched: 127\.0\.0\.1 is a private/);
    await assert.rejects(runWebHand("web_search", {}, opts()), /needs a query/);
  });

  test("web_search: several queries run at once and merge — a page two found (two spellings of its address) is one row naming both, ranked first; a failing query said after the rest; past five not run; every one failing said", async () => {
    const host = `127.0.0.1:${new URL(s.url()).port}`;
    const multi = { ...opts(), searchEndpoint: `${s.url()}/multi?q={query}` };
    assert.equal(
      await runWebHand("web_search", { query: "alpha", queries: ["alpha", "beta"] }, multi),
      `Results for 2 searches (${host}): [1] "alpha" · [2] "beta"\n\n1. Shared [1, 2]\n   https://example.org/shared\n   the shared page\n2. Alpha only [1]\n   https://example.org/alpha\n   a\n3. Beta only [2]\n   https://example.org/beta\n   b`,
      "the query and queries together, the same words once; the shared row keeps its first address and takes the snippet it lacked",
    );
    const half = await runWebHand("web_search", { queries: ["alpha", "boom"] }, multi);
    assert.ok(half.startsWith(`Results for 2 searches (${host}): [1] "alpha" · [2] "boom"\n\n1. Alpha only [1]`), half);
    assert.ok(half.endsWith(`\n[2] "boom" failed: the search endpoint answered HTTP 500 (${host})`), half);
    const many = await runWebHand("web_search", { queries: ["alpha", "beta", "q3", "q4", "q5", "q6", "q7"] }, multi);
    assert.match(many, /^Results for 5 searches .*\[5\] "q5"\n/);
    assert.ok(many.endsWith("\n[2 more searches not run: at most 5 at once]"), many);
    await assert.rejects(runWebHand("web_search", { queries: ["x", "y"] }, { ...opts(), searchEndpoint: `${s.url()}/nope` }), /^Error: every search failed — \[1\] "x" failed: the search endpoint answered HTTP 404/);
  });

  test("web_search: a search service with the person's key is asked first — the key on its header only, its marks and entities cleaned; a refused key falls back to the endpoint and says so; no key or no such service said; both failing said; DuckDuckGo's bot check said as one", async () => {
    const host = `127.0.0.1:${new URL(s.url()).port}`;
    const fake = { fake: { label: "Fake Search", env: "FILAMENT_TEST_NO_SUCH_KEY", request: (/** @type {string} */ q, /** @type {number} */ n, /** @type {string} */ key) => ({ url: `${s.url()}/svc`, method: "POST", headers: { "x-key": key, "content-type": "application/json" }, body: JSON.stringify({ query: q, n }) }) } };
    const base = { ...opts(), services: fake, searchProvider: "fake", searchEndpoint: `${s.url()}/search.json` };
    assert.equal(await runWebHand("web_search", { query: "tallow", limit: 3 }, { ...base, searchApiKey: "good" }), `Results for "tallow" (${host}):\n\n1. tallow hit\n   https://svc.example/hit\n   n=3 & more`);
    assert.equal(
      await runWebHand("web_search", { query: "tallow" }, { ...base, searchApiKey: "bad" }),
      `Results for "tallow" (${host}):\n(Fake Search answered HTTP 401 (the key was refused); these results are ${host}'s)\n\n1. JSON hit\n   https://example.org/json\n   from json`,
    );
    assert.match(await runWebHand("web_search", { query: "tallow" }, base), /^Results for "tallow" \(.*\):\n\(no key is set for Fake Search \(agentLoop\.web\.searchApiKey, or FILAMENT_TEST_NO_SUCH_KEY\); these results are .*'s\)\n\n1\. JSON hit/);
    assert.match(await runWebHand("web_search", { query: "tallow" }, { ...base, searchProvider: "nope" }), /\(no search service is called "nope"; these results are/);
    await assert.rejects(runWebHand("web_search", { query: "tallow" }, { ...base, searchApiKey: "bad", searchEndpoint: `${s.url()}/nope` }), /Fake Search answered HTTP 401 \(the key was refused\); the search endpoint in its place: the search endpoint answered HTTP 404/);
    await assert.rejects(runWebHand("web_search", { query: "x" }, { ...opts(), searchEndpoint: `${s.url()}/bot?q={query}` }), /refused the search as automated \(its bot check\)/, "its links are not results");
    await assert.rejects(runWebHand("web_search", { query: "x" }, { ...opts(), searchEndpoint: "not a url {query}" }), /the search endpoint is not a URL: not a url \{query\}/);
    assert.match(await runWebHand("web_search", { query: "x" }, { ...base, searchProvider: "constructor" }), /no search service is called "constructor"/, "a name no service has, an inherited one too");
  });

  // (fails before: yes — the review of 11-05: a service's headers rode every redirect hop, its key to another host too)
  test("web_search: a service's key goes to the address asked alone — a redirect to another origin gets no header of the service's", async () => {
    const port = new URL(s.url()).port;
    const hop = { hop: { label: "Hop Search", env: "FILAMENT_TEST_NO_SUCH_KEY", request: () => ({ url: `http://keyed.test:${port}/svc-hop`, headers: { "x-key": "good" } }) } };
    const out = await runWebHand("web_search", { query: "x" }, { ...opts(), resolve: async () => ["127.0.0.1"], services: hop, searchProvider: "hop", searchApiKey: "good" });
    assert.match(out, /\n1\. key not sent\n/, out);
  });
});

// (fails before: yes — the review of 11-05: a rule on web_search read `query` alone, so `queries` went past a deny, an
// allow of the first search let the rest through, and an ask showed none of them)
describe("web hands — rules over several searches", () => {
  test("a deny or an ask that covers any search speaks for the call; an allow only where it covers every one; the ask names each", async () => {
    const { ruleFor } = await import("../src/app/agent/rules.js");
    const deny = [{ tool: "web_search", pattern: "*acme*", verdict: /** @type {const} */ ("deny") }];
    assert.equal(ruleFor(deny, "web_search", { queries: ["weather", "acme roadmap"] })?.verdict, "deny");
    assert.equal(ruleFor(deny, "web_search", { query: "weather", queries: ["tides"] }), null);
    const allow = [{ tool: "web_search", pattern: "react *", verdict: /** @type {const} */ ("allow") }];
    assert.equal(ruleFor(allow, "web_search", { query: "react hooks", queries: ["react suspense"] })?.verdict, "allow");
    assert.notEqual(ruleFor(allow, "web_search", { query: "react hooks", queries: ["acme codename"] })?.verdict, "allow", "the first search's allow lets no other through");
    assert.equal(ruleFor(allow, "web_search", { query: "react hooks" })?.verdict, "allow", "one search, as before");
    assert.equal(argSummary("web_search", { query: "react hooks", queries: ["react hooks", "acme codename"] }), "react hooks · acme codename");
  });
});

describe("web hands — the search service's key", () => {
  test("agentLoop.web.searchApiKey is a secret: sealed and opened with the rest, shown as kept, masked in a change's diff", async () => {
    const { secretSlots, sealConfig, openConfig } = await import("../src/services/config/secrets.js");
    const { redactConfig } = await import("../src/services/config/store.js");
    const { describeDiff } = await import("../src/services/config/diff.js");
    const cfg = { agentLoop: { web: { searchProvider: "brave", searchApiKey: "BSA-secret-123" } } };
    assert.ok(secretSlots(cfg).some(([, , where]) => where === "agentLoop.web.searchApiKey"));
    const key = Buffer.alloc(32, 7);
    const sealed = sealConfig(cfg, key);
    assert.match(sealed.agentLoop.web.searchApiKey, /^enc:v1:/);
    assert.equal(openConfig(sealed, key).config.agentLoop.web.searchApiKey, "BSA-secret-123");
    assert.equal(redactConfig(cfg).agentLoop.web.searchApiKey, "__SECRET__");
    const d = /** @type {any} */ (describeDiff({ agentLoop: { web: {} } }, cfg).find((x) => x.path === "agentLoop.web.searchApiKey"));
    assert.ok(d?.secret && d.to === "••••••", JSON.stringify(d));
  });
});

describe("web hands — through the loop", () => {
  const s = site();
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    await s.start();
    root = mkdtempSync(join(tmpdir(), "filament-web-loop-"));
    writeFileSync(join(root, "notes.md"), "notes\n");
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "", web: { searchEndpoint: `${s.url()}/search?q={query}`, allowPrivate: true } };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await s.stop();
    for (const dir of [shim.dataDir, root]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
  const create = async (settings) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()).id;
  };
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return { rid: String(r.headers.get("x-filament-request-id")), json: await r.json() };
  };

  test("a session with plugins.web on gets web_search and web_fetch (and glob) in its tools and prompt; a rule refuses one URL in words; every call is on the run", async () => {
    const id = await create({ plugins: { web: { fetch: true, search: true } }, loop: { rules: [{ tool: "web_fetch", pattern: "*evil*", verdict: "deny" }] } });
    let round = 0;
    /** @type {any[]} */
    let results = [];
    brain = (call) => {
      round++;
      if (round === 1) {
        // The task graph's and the browser beside them: every tool on in a new chat (HarnessV4_AgentTools_Plan AT-D1);
        // the skill tool, since the Library holds the skill Filament ships (prompt version 54); the recall tool memory
        // adds last. No space tool: the project has no Space made (10-29).
        assert.deepEqual(call.body.tools.map((t) => t.name), ["read", "write", "edit", "bash", "bash_background", "bash_output", "bash_kill", ...PS, "grep", "glob", "lsp", "ask", "plan", "tasks", "agent", "wait", "envelope", "visual_guide", "show_visual", "artifact", "team", "flow", "thread", "report", "web_fetch", "web_search", "browser", "come_back", "skill", "filament_recall"]);
        assert.ok(sysTextOf(call.body).includes(PROMPT.webFetch) && sysTextOf(call.body).includes(PROMPT.webSearch));
        return reply([toolUse("s1", "web_search", { query: "tallow project" }), toolUse("g1", "glob", { pattern: "*.md" })], "tool_use");
      }
      if (round === 2) {
        results = lastResults(call.body.messages);
        return reply([toolUse("f1", "web_fetch", { url: `${s.url()}/page` }), toolUse("f2", "web_fetch", { url: `${s.url()}/evil/page` })], "tool_use");
      }
      results = [...results, ...lastResults(call.body.messages)];
      return reply([{ type: "text", text: "Read it." }]);
    };
    up.reset();
    const r = await turn(id, "look up tallow");
    assert.match(text(r.json.content), /Read it\./);
    assert.equal(results.length, 4, JSON.stringify(results).slice(0, 400));
    assert.match(String(results[0].content), /^Results for "tallow project" \(127\.0\.0\.1:\d+\):\n\n1\. Tallow — the project\n   https:\/\/example\.org\/tallow/);
    assert.equal(results[1].content, "notes.md");
    assert.match(String(results[2].content), /^http:\/\/127\.0\.0\.1:\d+\/page · text\/html\n\nTallow & Co\n\nWelcome/);
    assert.equal(results[3].is_error, true);
    assert.match(String(results[3].content), /^Not run: this session's rules refuse web_fetch here \(rule web_fetch\(\*evil\*\) deny matched `http:\/\/127\.0\.0\.1:\d+\/evil\/page`\)/);
    const rec = await shim.record(r.rid);
    assert.deepEqual(rec.agent.web, ["web_fetch", "web_search"]);
    assert.equal(rec.agent.promptVersion, PROMPT_VERSION);
    assert.ok(rec.changes.includes("agent: web hands offered by the session (plugins.web): web_fetch, web_search — private addresses allowed (agentLoop.web.allowPrivate)"), rec.changes.join("\n"));
    assert.ok(rec.changes.some((c) => c === "agent: web_fetch refused by the rule web_fetch(*evil*) deny"), rec.changes.join("\n"));
    const events = (await (await shim.api(`/api/runs/${encodeURIComponent(r.rid)}/events?limit=500`)).json()).events || [];
    const ends = events.filter((e) => e.type === "tool-end").map((e) => `${e.name}:${e.ok ? "ok" : "no"}${e.refused ? ":refused" : ""}`);
    // A reply's reads and fetches run side by side (loop.js `onlyReads`): they end in the order they finish.
    assert.deepEqual([...ends].sort(), ["glob:ok", "web_fetch:no:refused", "web_fetch:ok", "web_search:ok"]);
    assert.equal(events.find((e) => e.type === "tool-start" && e.name === "web_search")?.args, "tallow project");
  });

  // On by default since 10-23 (HarnessV4_AgentTools_Plan AT-D1): switched off, they are as before.
  test("a session with plugins.web off offers no web hand: a call is answered as unavailable and nothing is fetched", async () => {
    const id = await create({ plugins: { web: { fetch: false, search: false } } });
    let round = 0;
    /** @type {any} */
    let res = null;
    brain = (call) => {
      round++;
      if (round === 1) {
        assert.ok(!call.body.tools.some((t) => t.name.startsWith("web_")));
        assert.ok(!sysTextOf(call.body).includes("web_fetch"));
        return reply([toolUse("f1", "web_fetch", { url: `${s.url()}/page` })], "tool_use");
      }
      res = lastResults(call.body.messages)[0];
      return reply([{ type: "text", text: "Fine." }]);
    };
    up.reset();
    const r = await turn(id, "fetch it");
    assert.match(text(r.json.content), /Fine\./);
    assert.equal(res?.is_error, true);
    assert.match(String(res?.content), /That tool is not available here/);
    const rec = await shim.record(r.rid);
    assert.equal(rec.agent.web, undefined);
  });

  test("a hand switched off by loop.tools is answered as unavailable even under auto — never run, never asked about", async () => {
    const id = await create({ loop: { permissions: "auto", tools: { bash: false } } });
    let round = 0;
    /** @type {any} */
    let res = null;
    brain = (call) => {
      round++;
      if (round === 1) {
        assert.ok(!call.body.tools.some((t) => t.name === "bash"));
        return reply([toolUse("b1", "bash", { command: "node -e \"require('fs').writeFileSync('ran.txt','x')\"" })], "tool_use");
      }
      res = lastResults(call.body.messages)[0];
      return reply([{ type: "text", text: "Understood." }]);
    };
    up.reset();
    const r = await turn(id, "run it");
    assert.match(text(r.json.content), /Understood\./);
    assert.equal(res?.is_error, true);
    assert.match(String(res?.content), /That tool is not available here/);
    assert.ok(!existsSync(join(root, "ran.txt")), "the command did not run");
    const rec = await shim.record(r.rid);
    assert.ok(rec.changes.includes("agent: bash was called but is not offered in this session"), rec.changes.join("\n"));
    const events = (await (await shim.api(`/api/runs/${encodeURIComponent(r.rid)}/events?limit=500`)).json()).events || [];
    assert.ok(!events.some((e) => e.type === "tool-start" || e.type === "ask"), "no tool ran and nothing asked");
  });
});
