// @ts-check
// The `browser` tool (HarnessV4_Browser_Plan BR2): its gate — looking runs in every mode, acting asks once per site in
// Edit, runs in Full access, is refused in read-only — the rules' subject, the tool set's and the prompt's bytes with the
// switch off and on, a fork's copy, whole turns through the loop against a stand-in for the desktop app on the real
// socket (`/api/browser/host`), and a coding agent's calls over Filament's MCP server (HarnessV4_AgentTools_Plan AT3).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { BROWSER_READ_ONLY, BROWSER_TOOL, actingSite, browserGate, browserOffered } from "../src/app/agent/browser-tool.js";
import { FORK_REFUSALS, argSummary, isLoopTool, loopToolArgs, toolSetFor } from "../src/app/agent/tools.js";
import { ruleFor, subjectsOf } from "../src/app/agent/rules.js";
import { PROMPT, systemPromptFor } from "../src/app/agent/prompt.js";
import { NO_HOST } from "../src/app/browser/host.js";

describe("the browser tool's gate and words", () => {
  test("looking runs in every mode; acting is refused in read-only, runs in Full access, and asks once per site in Edit", () => {
    const page = "https://shop.test/login";
    for (const mode of /** @type {const} */ (["read-only", "edit", "ask", "auto"]))
      for (const input of [{ action: "navigate", url: "https://shop.test/" }, { action: "snapshot" }, { action: "screenshot" }, { action: "scroll" }, { action: "tabs" }])
        assert.deepEqual(browserGate(mode, input, { page }), { verdict: "run" }, `${mode} ${input.action}`);
    const click = { action: "click", ref: "e3" };
    assert.deepEqual(browserGate("read-only", click, { page }), { verdict: "refuse", text: BROWSER_READ_ONLY });
    assert.deepEqual(browserGate("auto", click, { page }), { verdict: "run" });
    const asked = browserGate("edit", click, { page });
    assert.equal(asked.verdict, "ask");
    assert.equal(/** @type {any} */ (asked).question, "May I act on shop.test in the browser? First: click e3. An allow lets me act on shop.test for the rest of this chat (the Browser pane's ⋯ takes it back); looking needs none. Answer /allow, or say what to do instead.");
    assert.deepEqual(browserGate("edit", click, { page, allowed: (s) => s === "shop.test" }), { verdict: "run" }, "a yes holds for the site");
    assert.equal(browserGate("edit", click, { page: "https://pay.test/", allowed: (s) => s === "shop.test" }).verdict, "ask", "and for that site alone");
    assert.deepEqual(browserGate("edit", click, { page: "about:blank" }), { verdict: "run" }, "no web page to act on yet");
  });

  // (fails before: yes — the bug hunt of 10-30, LOOP-2's words: a team's worker asked as if any yes held for the chat, and
  // its lead's holds for its team alone)
  test("a team's worker asks in words that say what each yes holds for: the developer's every agent of the chat, its lead's its team's workers", () => {
    const click = { action: "click", ref: "e3" };
    const asked = /** @type {any} */ (browserGate("edit", click, { page: "https://shop.test/login", team: { key: "hunters", name: "Hunters" } }));
    assert.equal(asked.question, "May I act on shop.test in the browser? First: click e3. An allow holds for the rest of this chat — yours for every agent of it, my lead's for the Hunters team's workers alone (the Browser pane's ⋯ takes either back); looking needs none. Answer /allow, or say what to do instead.");
    assert.deepEqual(browserGate("edit", click, { page: "https://shop.test/login", team: { key: "hunters", name: "Hunters" }, allowed: (s) => s === "shop.test" }), { verdict: "run" });
  });

  test("a batch acts on the site its navigations reach first", () => {
    const steps = [{ action: "navigate", url: "pay.test/checkout" }, { action: "type", ref: "e1", text: "4" }, { action: "navigate", url: "https://shop.test/" }, { action: "click", ref: "e2" }];
    assert.equal(actingSite({ action: "batch", steps }, "https://news.test/"), "pay.test");
    assert.equal(actingSite({ action: "batch", steps: [{ action: "snapshot" }] }, "https://news.test/"), "");
    assert.equal(actingSite({ action: "press", key: "Enter" }, "http://localhost:5173/"), "localhost");
    const g = /** @type {any} */ (browserGate("edit", { action: "batch", steps }, { page: "https://news.test/" }));
    assert.match(g.question, /^May I act on pay\.test in the browser\? First: type "4" into e1\./);
  });

  test("a rule reads the page a call works on and every address it goes to", () => {
    assert.deepEqual(subjectsOf("browser", { action: "snapshot", page: "https://bank.test/home" }), ["https://bank.test/home"]);
    assert.deepEqual(subjectsOf("browser", { action: "navigate", url: "evil.test", page: "https://shop.test/" }), ["https://shop.test/", "https://evil.test"]);
    assert.deepEqual(subjectsOf("browser", { action: "batch", steps: [{ action: "navigate", url: "localhost:5173" }, { action: "tabs", op: "new", url: "b.test" }], page: "" }), ["", "http://localhost:5173", "https://b.test"]);
    const deny = [{ tool: "browser", pattern: "*bank.test*", verdict: /** @type {const} */ ("deny") }];
    assert.equal(ruleFor(deny, "browser", { action: "text", page: "https://bank.test/home" })?.verdict, "deny", "looking on the site");
    assert.equal(ruleFor(deny, "browser", { action: "navigate", url: "bank.test", page: "https://shop.test/" })?.verdict, "deny", "going there");
    assert.equal(ruleFor(deny, "browser", { action: "text", page: "https://shop.test/" }), null);
    const allow = [{ tool: "browser", pattern: "https://shop.test/*", verdict: /** @type {const} */ ("allow") }];
    assert.equal(ruleFor(allow, "browser", { action: "click", ref: "e1", page: "https://shop.test/cart" })?.verdict, "allow");
  });

  test("the switch alone offers it: off, the set and the prompt are the bytes they were; on, the tool rides last of the loop's own and the prompt says one line", () => {
    const off = loopToolArgs({});
    assert.equal(JSON.stringify(loopToolArgs({ browser: false })), JSON.stringify(off));
    assert.ok(!off.some((t) => t.name === "browser"));
    const on = loopToolArgs({ browser: true, web: { fetch: true, search: true } });
    assert.deepEqual(on.slice(-3).map((t) => t.name), ["web_fetch", "web_search", "browser"]);
    assert.equal(on.at(-1), BROWSER_TOOL, "one frozen tool");
    assert.equal(toolSetFor({ delegateRead: false, browser: true }), toolSetFor({ delegateRead: false, browser: true }), "one frozen set per choice");
    assert.ok(!loopToolArgs({ browser: true, disabled: ["browser"] }).some((t) => t.name === "browser"));
    assert.ok(loopToolArgs({ browser: true, lead: true }).some((t) => t.name === "browser"), "a team's lead has every hand");
    const base = { root: "/w", delegateRead: false };
    assert.equal(systemPromptFor({ ...base, browser: false }), systemPromptFor(base));
    const said = systemPromptFor({ ...base, browser: true });
    assert.ok(said.includes(PROMPT.browser) && !systemPromptFor(base).includes(PROMPT.browser));
    assert.ok(!systemPromptFor({ ...base, browser: true, toolsOff: ["browser"] }).includes(PROMPT.browser));
    assert.equal(browserOffered({ plugins: { browser: true } }), true);
    assert.equal(browserOffered({ plugins: { browser: true } }, ["browser"]), false);
    assert.equal(browserOffered({ plugins: {} }), false);
    assert.equal(browserOffered(null), false);
  });

  // (fails before: yes — the owner's words of 10-23, "access to everything … at least the same as the main agent": a
  // fork's call was answered in words, BR-D13)
  test("a fork's copy of the tool runs, in tabs of its own; the record names what a call does", () => {
    assert.equal("browser" in FORK_REFUSALS, false);
    assert.equal(isLoopTool("browser"), true);
    assert.equal(argSummary("browser", { action: "navigate", url: "shop.test" }), "navigate shop.test");
    assert.equal(argSummary("browser", { action: "type", ref: "e1", text: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" }).includes("abcdefghijklmnop"), false, "a secret typed is not on the record");
  });
});

/** An accessibility tree as Chrome gives it. */
const tree = () => [
  { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Shop" }, childIds: ["2", "9"] },
  { nodeId: "2", role: { value: "textbox" }, name: { value: "Email" }, backendDOMNodeId: 40, childIds: [] },
  { nodeId: "9", role: { value: "button" }, name: { value: "Sign in" }, backendDOMNodeId: 90, childIds: [] },
];

/**
 * A stand-in for the desktop app on the real socket: it connects with the inbound key, opens tabs, and answers the
 * page's commands as a page would; `calls` keeps what reached the page.
 * @param {string} url  Filament's address @param {string} key
 */
async function fakeAppOn(url, key) {
  /** @type {{ tab: string, method: string, params: any }[]} */
  const calls = [];
  /** @type {Map<string, string>} */
  const at = new Map();
  const ws = new WebSocket(`${url.replace(/^http/, "ws")}/api/browser/host`, /** @type {any} */ ({ headers: { authorization: `Bearer ${key}` } }));
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("the app's socket did not open"));
  });
  const send = (/** @type {any} */ m) => ws.send(JSON.stringify(m));
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.op !== "cdp") {
      if (m.op === "open") at.set(m.tab, "about:blank");
      return send({ n: m.n, ok: true, result: null });
    }
    const p = m.params || {};
    calls.push({ tab: m.tab, method: m.method, params: p });
    const reply = (/** @type {any} */ result) => send({ n: m.n, ok: true, result });
    if (m.method === "Page.getFrameTree") return reply({ frameTree: { frame: { id: "F", url: at.get(m.tab) || "about:blank" } } });
    if (m.method === "Page.navigate") {
      at.set(m.tab, p.url);
      reply({ frameId: "F", loaderId: "L" });
      for (const [method, params] of [["Page.frameNavigated", { frame: { id: "F", url: p.url } }], ["Page.loadEventFired", {}]]) send({ op: "event", tab: m.tab, method, params });
      return;
    }
    if (m.method === "Accessibility.getFullAXTree") return reply({ nodes: tree() });
    if (m.method === "Runtime.evaluate") return reply({ result: { value: [at.get(m.tab) || "about:blank", "Shop"] } });
    if (m.method === "DOM.getContentQuads") return reply({ quads: [[0, 0, 100, 0, 100, 40, 0, 40]] });
    return reply({});
  };
  return { calls, clicks: () => calls.filter((c) => c.method === "Input.dispatchMouseEvent" && c.params.type === "mousePressed").length, close: () => ws.close() };
}

/** An upgrade asked for by hand: the status Filament answered it with. @param {string} url @param {Record<string, string>} headers */
const upgradeStatus = (url, headers) =>
  new Promise((resolve, reject) => {
    const req = http.request(`${url}/api/browser/host`, { headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers } });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end();
  });

const sysTextOf = (/** @type {any} */ b) => (Array.isArray(b.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b.system || ""));
const text = (/** @type {any[]} */ blocks) => (blocks || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
const lastResults = (/** @type {any[]} */ msgs) => {
  const last = msgs[msgs.length - 1];
  return Array.isArray(last?.content) ? last.content.filter((/** @type {any} */ b) => b.type === "tool_result") : [];
};
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** A result's words. @param {any} r */
const words = (r) => (Array.isArray(r?.content) ? r.content.filter((/** @type {any} */ b) => b.type === "text").map((/** @type {any} */ b) => b.text).join("") : String(r?.content ?? ""));

describe("the browser tool through the loop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-browser-loop-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  });
  /** @param {any} settings */
  const create = async (settings) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return (await r.json()).id;
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content, extra = {}) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...extra } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return { rid: String(r.headers.get("x-filament-request-id")), json: await r.json() };
  };

  test("the app's socket takes Filament's own key, from this machine, and no page", async () => {
    assert.equal(await upgradeStatus(shim.url, {}), 403, "no key");
    assert.equal(await upgradeStatus(shim.url, { authorization: "Bearer not-the-key" }), 403, "another key");
    assert.equal(await upgradeStatus(shim.url, { authorization: `Bearer ${shim.key}`, origin: "http://127.0.0.1:1" }), 403, "a page always sends its origin");
    assert.equal(await upgradeStatus(shim.url, { authorization: `Bearer ${shim.key}` }), 101);
    const state = await (await shim.api("/api/browser")).json();
    assert.equal(typeof state.available, "boolean");
  });

  test("Edit mode: the agent looks freely, asks once to act on a site, and its yes holds for the chat", async () => {
    const app = await fakeAppOn(shim.url, shim.key);
    try {
      const id = await create({ plugins: { browser: true } });
      let round = 0;
      /** @type {any[]} */
      let results = [];
      brain = (call) => {
        round++;
        if (round === 1) {
          const names = call.body.tools.map((/** @type {any} */ t) => t.name);
          assert.deepEqual(names.slice(-4), ["browser", "come_back", "skill", "filament_recall"], names.join(","));
          assert.ok(sysTextOf(call.body).includes(PROMPT.browser));
          return reply([toolUse("n1", "browser", { action: "navigate", url: "shop.test/login" })], "tool_use");
        }
        if (round === 2) {
          results = lastResults(call.body.messages);
          return reply([toolUse("c1", "browser", { action: "click", ref: "e2" })], "tool_use");
        }
        if (round === 3) {
          results = [...results, ...lastResults(call.body.messages)];
          return reply([toolUse("c2", "browser", { action: "click", ref: "e1" })], "tool_use");
        }
        results = [...results, ...lastResults(call.body.messages)];
        return reply([{ type: "text", text: "Signed in." }]);
      };
      up.reset();
      const first = await turn(id, "sign in to the shop");
      assert.equal(round, 2);
      assert.match(words(results[0]), /^Opened https:\/\/shop\.test\/login\.\nPage: Shop — https:\/\/shop\.test\/login\n/);
      assert.ok(words(results[0]).includes('- button "Sign in" [e2]'), words(results[0]));
      assert.match(text(first.json.content), /May I act on shop\.test in the browser\? First: click e2\./);
      assert.equal(app.clicks(), 0, "nothing pressed before the yes");
      const rec = await shim.record(first.rid);
      assert.equal(rec.agent.browser, true);
      assert.ok(rec.changes.includes("agent: the browser offered by the session (plugins.browser)"), rec.changes.join("\n"));
      const second = await turn(id, "yes", { allow: true });
      assert.match(text(second.json.content), /Signed in\./);
      assert.equal(app.clicks(), 2, "the yes ran the click, and the next ran without asking");
      assert.equal(results.length, 3);
      assert.ok(!results[1].is_error && !results[2].is_error, JSON.stringify(results).slice(0, 600));
      const rec2 = await shim.record(second.rid);
      assert.ok(rec2.changes.includes("agent: the browser may act on shop.test for the rest of this chat"), rec2.changes.join("\n"));
      const state = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/browser`)).json();
      assert.deepEqual(state.sites, ["shop.test"]);
      assert.equal(state.tabs[0].url, "https://shop.test/login");
    } finally {
      app.close();
    }
  });

  test("read-only looks but does not act; a rule on a site stops even the looking; no app connected is said", async () => {
    const app = await fakeAppOn(shim.url, shim.key);
    /** @type {any[]} */
    let results = [];
    try {
      const id = await create({ plugins: { browser: true }, loop: { permissions: "read-only", rules: [{ tool: "browser", pattern: "*bank.test*", verdict: "deny" }] } });
      let round = 0;
      brain = (call) => {
        round++;
        if (round === 1) return reply([toolUse("n1", "browser", { action: "navigate", url: "https://shop.test/" }), toolUse("c1", "browser", { action: "click", ref: "e2" }), toolUse("n2", "browser", { action: "navigate", url: "bank.test" })], "tool_use");
        results = lastResults(call.body.messages);
        return reply([{ type: "text", text: "Looked." }]);
      };
      up.reset();
      const r = await turn(id, "look at the shop");
      assert.match(text(r.json.content), /Looked\./);
      assert.equal(results.length, 3);
      assert.ok(!results[0].is_error);
      assert.equal(results[1].is_error, true);
      assert.equal(words(results[1]), BROWSER_READ_ONLY);
      assert.equal(results[2].is_error, true);
      assert.match(words(results[2]), /^Not run: this session's rules refuse browser here \(rule browser\(\*bank\.test\*\) deny matched `https:\/\/bank\.test`\)/);
      assert.equal(app.clicks(), 0);
    } finally {
      app.close();
    }
    await new Promise((res) => setTimeout(res, 50));
    const id = await create({ plugins: { browser: true } });
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("n1", "browser", { action: "snapshot" })], "tool_use");
      results = lastResults(call.body.messages);
      return reply([{ type: "text", text: "No browser." }]);
    };
    up.reset();
    await turn(id, "look");
    assert.equal(results[0].is_error, true);
    assert.equal(words(results[0]), `Error: ${NO_HOST}`);
  });

  test("a rule on a site reads the page the browser shows: the developer went there, the agent's look is refused", async () => {
    const app = await fakeAppOn(shim.url, shim.key);
    try {
      const id = await create({ plugins: { browser: true }, loop: { permissions: "auto", rules: [{ tool: "browser", pattern: "*bank.test*", verdict: "deny" }] } });
      const went = await shim.api(`/api/sessions/${encodeURIComponent(id)}/browser`, { method: "POST", body: { act: "navigate", url: "https://bank.test/" } });
      assert.equal(went.status, 200, await went.clone().text());
      let round = 0;
      /** @type {any[]} */
      let results = [];
      brain = (call) => {
        round++;
        if (round === 1) return reply([toolUse("s1", "browser", { action: "snapshot" })], "tool_use");
        results = lastResults(call.body.messages);
        return reply([{ type: "text", text: "Refused." }]);
      };
      up.reset();
      await turn(id, "what is on the page");
      assert.equal(results[0].is_error, true);
      assert.match(words(results[0]), /^Not run: this session's rules refuse browser here \(rule browser\(\*bank\.test\*\) deny matched `https:\/\/bank\.test/);
      assert.ok(!app.calls.some((c) => c.method === "Accessibility.getFullAXTree"), "nothing of the page was read");
    } finally {
      app.close();
    }
  });

  test("Edit mode: a batch that reaches another site stops before acting there, said in its result", async () => {
    const app = await fakeAppOn(shim.url, shim.key);
    try {
      const id = await create({ plugins: { browser: true } });
      let round = 0;
      /** @type {any[]} */
      let results = [];
      brain = (call) => {
        round++;
        if (round === 1) return reply([toolUse("n1", "browser", { action: "navigate", url: "shop.test/login" })], "tool_use");
        if (round === 2) return reply([toolUse("c1", "browser", { action: "click", ref: "e2" })], "tool_use");
        if (round === 3) return reply([toolUse("b1", "browser", { action: "batch", steps: [{ action: "click", ref: "e2" }, { action: "navigate", url: "pay.test" }, { action: "click", ref: "e2" }] })], "tool_use");
        results = lastResults(call.body.messages);
        return reply([{ type: "text", text: "Stopped at pay.test." }]);
      };
      up.reset();
      const first = await turn(id, "sign in, then pay");
      assert.match(text(first.json.content), /May I act on shop\.test in the browser\?/);
      await turn(id, "yes", { allow: true });
      assert.equal(app.clicks(), 2, "the yes's click and the batch's on shop.test; none on pay.test");
      assert.ok(!results[0].is_error, words(results[0]));
      assert.ok(words(results[0]).includes("Step 3 (click e2) not run: acting on pay.test needs the developer's yes"), words(results[0]));
    } finally {
      app.close();
    }
  });

  // (fails before: yes — the owner's words of 10-23, "it did not have the access to browser tool": a sub-agent had no
  // browser, BR-D13)
  test("a sub-agent drives the chat's browser in a tab of its own, named for it; the main agent's tab stays shown", async () => {
    const app = await fakeAppOn(shim.url, shim.key);
    try {
      const id = await create({ plugins: { browser: true } });
      /** @type {any[]} */
      let subResults = [];
      /** @type {string[]} */
      let subNames = [];
      let mainRound = 0;
      let subRound = 0;
      brain = (call) => {
        if (sysTextOf(call.body).includes("You are a sub-agent")) {
          subRound++;
          if (subRound === 1) {
            subNames = call.body.tools.map((/** @type {any} */ t) => t.name);
            return reply([toolUse("s1", "browser", { action: "navigate", url: "localhost:5173" })], "tool_use");
          }
          subResults = lastResults(call.body.messages);
          return reply([{ type: "text", text: "Seen the page." }]);
        }
        mainRound++;
        if (mainRound === 1) return reply([toolUse("n1", "browser", { action: "navigate", url: "shop.test/login" })], "tool_use");
        if (mainRound === 2) return reply([toolUse("a1", "agent", { run_in_background: false, description: "Look at the dev server", prompt: "Open the dev server and look at it", subagent_type: "reviewer" })], "tool_use");
        return reply([{ type: "text", text: "done" }]);
      };
      up.reset();
      await turn(id, "look at both");
      assert.ok(subNames.includes("browser"), subNames.join(","));
      assert.match(words(subResults[0]), /^Opened http:\/\/localhost:5173\./);
      const st = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/browser`)).json();
      assert.deepEqual(st.tabs.map((/** @type {any} */ t) => [t.url, t.by ?? null, t.shown]), [["https://shop.test/login", null, true], ["http://localhost:5173", "Reviewer", false]]);
    } finally {
      app.close();
    }
  });

  // The switch is on by default since 10-23 (HarnessV4_AgentTools_Plan AT-D1): off, it is as before.
  test("with the switch off the tool is not offered, and a call to it is answered as not available", async () => {
    const id = await create({ plugins: { browser: false } });
    let round = 0;
    /** @type {any[]} */
    let results = [];
    brain = (call) => {
      round++;
      if (round === 1) {
        assert.ok(!call.body.tools.some((/** @type {any} */ t) => t.name === "browser"));
        assert.ok(!sysTextOf(call.body).includes(PROMPT.browser));
        return reply([toolUse("n1", "browser", { action: "navigate", url: "https://shop.test/" })], "tool_use");
      }
      results = lastResults(call.body.messages);
      return reply([{ type: "text", text: "ok" }]);
    };
    up.reset();
    await turn(id, "go");
    assert.equal(results[0].is_error, true);
    assert.match(words(results[0]), /That tool is not available here/);
  });
});

// A coding agent's: Claude Code's (a stand-in) calls Filament's `browser` over its MCP server, judged by the chat's
// switch as the loop's calls are (HarnessV4_AgentTools_Plan AT-D7, case 7). The ask on the permission card and a
// sub-agent's own tab are browser.test.js's.
describe("the browser tool through a coding agent", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string} */
  let logs;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-browser-coder-"));
    logs = mkdtempSync(join(tmpdir(), "filament-browser-coder-logs-"));
    up = await fakeUpstream(async () => undefined);
    shim = await startApp({
      memory: true,
      configure: (cfg, { dataDir }) => {
        const cli = { id: "cli", name: "cli", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_LOG: join(logs, "prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http" }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" } };
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }, cli];
        cfg.routes = [{ match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const d of [root, logs])
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
  });
  /** @param {any} settings */
  const create = async (settings) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "coder-1", preset: "plain", settings } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return String((await r.json()).id);
  };
  /** The agent's words of one turn. @param {string} id @param {string} content */
  const turn = async (id, content, extra = {}) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false, ...extra } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return text((await r.json()).content);
  };
  /** A call of the browser over the MCP server, as the agent's prompt asks it. @param {any} input */
  const call = (input) => `~mcpcall browser ${JSON.stringify(input)}`;

  // (fails before: yes — the owner's words of 10-23, "it did not have the access to browser tool": Designer ran on
  // Claude Code, and Filament's server listed no browser)
  test("a Claude Code chat: Filament's server lists the browser; a look runs, a click is refused in read-only and runs in Full access", async () => {
    const app = await fakeAppOn(shim.url, shim.key);
    try {
      const ro = await create({ loop: { permissions: "read-only" } });
      const looked = await turn(ro, call({ action: "navigate", url: "shop.test/login" }));
      assert.match(looked, /mcp:Opened https:\/\/shop\.test\/login\.\nPage: Shop — https:\/\/shop\.test\/login\n/);
      assert.ok(looked.includes('- button "Sign in" [e2]'), looked);
      const prompts = readFileSync(join(logs, "prompts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      const mcpUrl = String(prompts.at(-1).mcpUrl);
      const listed = await (await fetch(mcpUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).json();
      assert.ok(listed.result.tools.some((/** @type {any} */ t) => t.name === "browser"), listed.result.tools.map((/** @type {any} */ t) => t.name).join(","));
      assert.match(await turn(ro, call({ action: "click", ref: "e2" })), new RegExp(`mcp:error:${BROWSER_READ_ONLY.slice(0, 40)}`));
      assert.equal(app.clicks(), 0, "nothing pressed");
      const full = await create({ loop: { permissions: "auto" } });
      await turn(full, call({ action: "navigate", url: "shop.test/login" }));
      assert.doesNotMatch(await turn(full, call({ action: "click", ref: "e2" })), /mcp:error|mcperr/);
      assert.equal(app.clicks(), 1, "Full access pressed it");
      const state = await (await shim.api(`/api/sessions/${encodeURIComponent(full)}/browser`)).json();
      assert.deepEqual(state.tabs.map((/** @type {any} */ t) => [t.url, t.by ?? null]), [["https://shop.test/login", null]], "the chat's own agent's tab");
      // The switch off: not listed, a call told.
      const off = await create({ plugins: { browser: false } });
      assert.match(await turn(off, call({ action: "snapshot" })), /mcp(err|:error):/);
    } finally {
      app.close();
    }
  });
});
