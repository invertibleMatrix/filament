// @ts-check
// The agent's browser, the server's part (HarnessV4_Browser_Plan BR1): the snapshot's lines and handles from an
// accessibility tree, the addresses, keys and inputs; the link to the app (answers by number, a link that goes or is
// replaced fails what waited on it, in words); the driver over a stand-in for Chrome's protocol (a navigation waits
// for its load, a click lands at an element's centre, a dialog is answered and said, the console and the requests
// kept); and the registry over a stand-in app (a chat's first call opens its tab, the developer's take-over answers at
// once, a page's popup is a tab, the app's going reopens the page, a batch stops where acting needs a yes).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ACTING, actingSteps, browserArgWords, filamentsOwn, inputProblem, keyEvents, ruleUrl, siteOf, snapshotOf, urlProblem, wholeUrl } from "../src/core/browser.js";
import { artifactAddress } from "../src/core/artifacts.js";
import { ruleFor } from "../src/app/agent/rules.js";
import { NO_HOST, createBrowserHost } from "../src/app/browser/host.js";
import { createDriver } from "../src/app/browser/driver.js";
import { HAND_WORDS, createBrowsers } from "../src/app/browser/registry.js";
import { MediaResult } from "../src/core/media.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { BROWSER_READ_ONLY } from "../src/app/agent/browser-tool.js";
import { LiveTurn, TurnBridge } from "../src/adapters/agents/turn-bridge.js";
import { McpToolServer } from "../src/http/mcp.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";

/** An accessibility tree as Chrome gives it: a node per element, its children by id. */
const tree = () => [
  { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Shop" }, childIds: ["2", "3", "6", "9"] },
  { nodeId: "2", role: { value: "heading" }, name: { value: "Welcome back" }, properties: [{ name: "level", value: { value: 1 } }], childIds: ["21"] },
  { nodeId: "21", role: { value: "StaticText" }, name: { value: "Welcome back" }, childIds: [] },
  { nodeId: "3", role: { value: "form" }, name: { value: "" }, childIds: ["4", "5"] },
  { nodeId: "4", role: { value: "textbox" }, name: { value: "Email" }, value: { value: "ada@example.com" }, backendDOMNodeId: 40, properties: [{ name: "required", value: { value: true } }], childIds: ["41"] },
  { nodeId: "41", role: { value: "StaticText" }, name: { value: "ada@example.com" }, childIds: [] },
  { nodeId: "5", role: { value: "checkbox" }, name: { value: "Remember me" }, backendDOMNodeId: 50, properties: [{ name: "checked", value: { value: "true" } }], childIds: [] },
  { nodeId: "6", role: { value: "generic" }, ignored: true, childIds: ["7", "8"] },
  { nodeId: "7", role: { value: "StaticText" }, name: { value: "Free shipping" }, childIds: [] },
  { nodeId: "8", role: { value: "StaticText" }, name: { value: "over $50." }, childIds: [] },
  { nodeId: "9", role: { value: "button" }, name: { value: "Sign in" }, backendDOMNodeId: 90, properties: [{ name: "disabled", value: { value: false } }], childIds: [] },
];

describe("the browser's core", () => {
  test("a snapshot names each element with a handle, kept for the same element the next time", () => {
    const refs = new Map();
    const next = { n: 0 };
    const s = snapshotOf(tree(), { refs, next, url: "https://shop.test/login", title: "Shop" });
    assert.equal(s.text.split("\n")[0], "Page: Shop — https://shop.test/login");
    assert.ok(s.text.includes('- heading "Welcome back" (h1)'), s.text);
    assert.ok(s.text.includes('  - textbox "Email" [e1] value="ada@example.com" required'), "a field under its form, its value and state");
    assert.ok(!s.text.includes("text: ada@example.com"), "a field's own text is its value, not read again");
    assert.ok(s.text.includes('  - checkbox "Remember me" [e2] checked'));
    assert.ok(s.text.includes("text: Free shipping over $50."), "a run of words reads as one line");
    assert.ok(s.text.includes('- button "Sign in" [e3]') && !s.text.includes("e3] disabled"), s.text);
    assert.equal(s.handles.get("e3"), 90);
    // The page again, the button first: it keeps e3, and a new element gets the next handle.
    const again = [...tree(), { nodeId: "10", role: { value: "link" }, name: { value: "Help" }, backendDOMNodeId: 100, childIds: [] }];
    again[0].childIds = ["9", "10", "2", "3", "6"];
    const s2 = snapshotOf(again, { refs, next, url: "https://shop.test/login", title: "Shop" });
    assert.ok(s2.text.includes('- button "Sign in" [e3]') && s2.text.includes('- link "Help" [e4]'), s2.text);
  });

  test("a snapshot past its size drops the page's words first, then says what it cut", () => {
    /** @type {any[]} */
    const nodes = [{ nodeId: "r", role: { value: "RootWebArea" }, childIds: [] }];
    for (let i = 0; i < 400; i++) {
      nodes.push({ nodeId: `t${i}`, role: { value: "paragraph" }, childIds: [`s${i}`] });
      nodes.push({ nodeId: `s${i}`, role: { value: "StaticText" }, name: { value: `Paragraph ${i} `.repeat(8) }, childIds: [] });
      nodes.push({ nodeId: `b${i}`, role: { value: "button" }, name: { value: `Button ${i}` }, backendDOMNodeId: 1000 + i, childIds: [] });
      nodes[0].childIds.push(`t${i}`, `b${i}`);
    }
    const s = snapshotOf(nodes, { refs: new Map(), next: { n: 0 }, max: 4000 });
    assert.ok(s.text.length < 4400, `${s.text.length}`);
    assert.ok(!s.text.includes("text: Paragraph"), "the words went first");
    assert.match(s.text, /…\[\d+ more lines not shown: scroll, or text, reads further\]$/);
  });

  // (fails before: yes — the bug round of 10-23: `evil.test.` is the same site, and slipped past a rule naming it)
  test("a host's trailing dot is the same site, for the gate and the rules", () => {
    assert.equal(siteOf("https://Shop.Test./login"), "shop.test");
    assert.equal(ruleUrl("https://evil.test./inbox"), "https://evil.test/inbox");
    assert.equal(ruleUrl("https://evil.test..:8443/x?y=1"), "https://evil.test:8443/x?y=1");
    assert.equal(ruleUrl("https://user@evil.test./"), "https://user@evil.test/");
    assert.equal(ruleUrl("https://evil.test/a.b."), "https://evil.test/a.b.", "a path's dot is the path's");
    assert.equal(ruleUrl("about:blank"), "about:blank");
    const deny = [{ tool: "browser", pattern: "https://evil.test/*", verdict: "deny" }];
    assert.equal(ruleFor(/** @type {any} */ (deny), "browser", { action: "navigate", url: "https://evil.test./inbox", page: "about:blank" })?.verdict, "deny");
    assert.equal(ruleFor(/** @type {any} */ (deny), "browser", { action: "snapshot", page: "https://evil.test./inbox" })?.verdict, "deny");
    // (fails before: yes — the copies hunt of 10-23: a rule written with the dot named nothing)
    const dotted = [{ tool: "browser", pattern: "https://evil.test./*", verdict: "deny" }];
    for (const page of ["https://evil.test./inbox", "https://evil.test/inbox"]) assert.equal(ruleFor(/** @type {any} */ (dotted), "browser", { action: "snapshot", page })?.verdict, "deny", page);
  });

  test("addresses: a bare host made whole, only web pages opened, the site without its port", () => {
    assert.equal(wholeUrl("github.com/x"), "https://github.com/x");
    assert.equal(wholeUrl("localhost:5173"), "http://localhost:5173");
    assert.equal(wholeUrl("192.168.1.4/admin"), "http://192.168.1.4/admin");
    assert.equal(wholeUrl("http://a.test"), "http://a.test");
    assert.equal(urlProblem("about:blank"), null);
    assert.match(String(urlProblem("file:///C:/x")), /http and https addresses only/);
    assert.match(String(urlProblem("javascript:alert(1)")), /not javascript:/);
    assert.equal(siteOf("http://LocalHost:3000/a"), "localhost");
    assert.equal(siteOf("about:blank"), "");
  });

  test("Filament's own address: a name of this machine at its port, however spelt, or a host it is served as; an artifact's address, another port or another host is not", () => {
    const own = (/** @type {string} */ u) => filamentsOwn(u, 20300, ["filament.lan"]);
    for (const u of ["http://127.0.0.1:20300/api/keys", "http://localhost:20300/", "http://LOCALHOST.:20300/x", "http://x.localhost:20300/api/config", "http://127.0.0.2:20300/", "http://[::1]:20300/", "http://[::ffff:127.0.0.1]:20300/", "http://0.0.0.0:20300/", "http://2130706433:20300/", "https://filament.lan:20300/", "http://FILAMENT.LAN.:20300/"])
      assert.equal(own(u), true, u);
    for (const u of [artifactAddress("chart-ab12", 20300), "http://art.localhost:20300/", "http://localhost:5173/", "http://127.0.0.1/", "https://shop.test:20300/", "http://192.168.1.4:20300/", "about:blank", "file:///C:/x", "nonsense"])
      assert.equal(own(u), false, u);
    assert.equal(filamentsOwn("http://localhost/", 80), true, "the scheme's port where none is written");
    assert.match(String(urlProblem("http://127.0.0.1:20300/api/keys", own)), /^127\.0\.0\.1:20300 is Filament's own address: the browser never opens it/);
    assert.equal(urlProblem("http://localhost:5173/", own), null);
  });

  test("Filament's own address at every port it listens on, on this machine's addresses however IPv6 writes them, and where another program serves it", () => {
    const own = (/** @type {string} */ u) => filamentsOwn(u, [20300, 20343, 20344, 20345], ["192.168.1.4", "fd7a:115c:a1e0::d301:5ef"], ["https://box.tail0.ts.net"]);
    for (const u of ["https://127.0.0.1:20343/api/keys", "https://192.168.1.4:20344/x/", "http://[::ffff:192.168.1.4]:20345/", "http://[::ffff:0:0]:20300/", "http://[FD7A:115C:A1E0::D301:5EF]:20343/", "https://box.tail0.ts.net/api/state", "https://BOX.tail0.ts.net:443/"])
      assert.equal(own(u), true, u);
    for (const u of ["http://127.0.0.1:20346/", "https://192.168.1.5:20343/", "https://box.tail0.ts.net:8443/", "http://box.tail0.ts.net/", "http://x.art.localhost:20343/"])
      assert.equal(own(u), false, u);
  });

  test("keys: a named key, a combination, a letter typed, an unknown one refused", () => {
    const enter = keyEvents("Enter");
    assert.ok(enter.ok && enter.events[0].type === "keyDown" && enter.events[0].windowsVirtualKeyCode === 13 && enter.events[0].text === "\r");
    const all = keyEvents("Control+A");
    assert.ok(all.ok && all.events[0].type === "rawKeyDown" && all.events[0].modifiers === 2 && !all.events[0].text, "a held Control types nothing");
    const shiftTab = keyEvents("Shift+Tab");
    assert.ok(shiftTab.ok && shiftTab.events[0].modifiers === 8);
    assert.deepEqual(keyEvents("Hyper+X"), { ok: false, error: "Hyper is no modifier: Control, Shift, Alt or Meta" });
    assert.equal(keyEvents("Banana").ok, false);
  });

  test("inputs: each action's needs said in words; a batch's acting steps found", () => {
    assert.match(String(inputProblem({})), /an action is needed/);
    assert.match(String(inputProblem({ action: "fly" })), /fly is no action/);
    assert.match(String(inputProblem({ action: "click", ref: "button" })), /needs ref/);
    assert.equal(inputProblem({ action: "click", ref: "e3" }), null);
    assert.equal(inputProblem({ action: "type", text: "hi" }), null, "typing where the focus is");
    assert.match(String(inputProblem({ action: "batch", steps: [{ action: "navigate", url: "a.test" }, { action: "tabs" }] })), /step 2: a batch holds no tabs/);
    assert.deepEqual(actingSteps({ action: "batch", steps: [{ action: "navigate", url: "a.test" }, { action: "click", ref: "e1" }] }).map((s) => s.action), ["click"]);
    assert.deepEqual([...ACTING], ["click", "type", "press", "select", "evaluate"]);
    assert.equal(browserArgWords({ action: "type", text: "hello", ref: "e4", submit: true }), 'type "hello" into e4 and send');
  });
});

describe("the link to the app", () => {
  test("a request goes numbered and comes back by its number; without an app it says so", async () => {
    const host = createBrowserHost();
    await assert.rejects(host.call("open", { tab: "t1" }), { message: NO_HOST });
    /** @type {any[]} */
    const sent = [];
    const take = host.attach({ send: (m) => sent.push(m), close: () => {} });
    assert.equal(host.available, true);
    const p = host.call("cdp", { tab: "t1", method: "Page.navigate", params: { url: "https://a.test" } });
    assert.deepEqual(sent[0], { n: 1, op: "cdp", tab: "t1", method: "Page.navigate", params: { url: "https://a.test" } });
    take({ n: 1, ok: true, result: { loaderId: "x" } });
    assert.deepEqual(await p, { loaderId: "x" });
    const q = host.call("cdp", { tab: "t1", method: "DOM.focus", params: {} });
    take({ n: 2, ok: false, error: "No node with given id found" });
    await assert.rejects(q, { message: "No node with given id found" });
  });

  test("a host that goes, or another that takes its place, fails what waited on it, in words", async () => {
    const host = createBrowserHost();
    /** @type {string[]} */
    const heard = [];
    host.on((e) => heard.push(e.op));
    const a = { send: () => {}, close: () => {} };
    host.attach(a);
    const p = host.call("open", { tab: "t1" });
    let closed = 0;
    host.attach({ send: () => {}, close: () => void closed++ });
    await assert.rejects(p, /connected again/);
    assert.deepEqual(heard, ["lost"]);
    const late = host.call("open", { tab: "t2" });
    host.detach(a);
    assert.equal(host.available, true, "the old link's close is not the new one's");
    host.detach(/** @type {any} */ ({}));
    assert.equal(host.available, true);
    const t = host.call("cdp", { tab: "t2", method: "Page.reload" }, { ms: 30 });
    await assert.rejects(t, /did not answer Page\.reload in 0 s/);
    void late.catch(() => {});
    assert.equal(closed, 0);
  });
});

/**
 * A stand-in for Chrome's protocol on one tab: each command recorded, answered by `answer`; a navigation answered
 * with a loader, its page's events fed a moment later.
 * @param {(method: string, params: any) => any} [answer]
 */
function fakePage(answer = () => ({})) {
  /** @type {[string, any][]} */
  const calls = [];
  /** @type {any} */
  let driver = null;
  const feedSoon = (/** @type {[string, any][]} */ evs) => setTimeout(() => evs.forEach(([m, p]) => driver.feed(m, p)), 5);
  const cdp = async (/** @type {string} */ method, /** @type {any} */ params = {}) => {
    calls.push([method, params]);
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "F", url: "about:blank" } } };
    if (method === "Page.navigate") {
      feedSoon([["Page.frameStartedLoading", { frameId: "F" }], ["Page.frameNavigated", { frame: { id: "F", url: params.url } }], ["Page.loadEventFired", {}], ["Page.frameStoppedLoading", { frameId: "F" }]]);
      return { frameId: "F", loaderId: "L" };
    }
    return answer(method, params) ?? {};
  };
  driver = createDriver({ cdp });
  return { driver, calls, names: () => calls.map((c) => c[0]) };
}

describe("the driver", () => {
  test("a navigation waits for its page's load; the address follows the page's events", async () => {
    const f = fakePage();
    await f.driver.enable();
    assert.deepEqual(f.names().slice(0, 5), ["Page.enable", "Runtime.enable", "Network.enable", "Log.enable", "Page.setInterceptFileChooserDialog"]);
    assert.equal(await f.driver.navigate("https://shop.test/"), "");
    assert.equal(f.driver.url, "https://shop.test/");
  });

  test("a click lands at its element's centre, scrolled into sight; a handle not on the page is said", async () => {
    const f = fakePage((m) => {
      if (m === "Accessibility.getFullAXTree") return { nodes: tree() };
      if (m === "Runtime.evaluate") return { result: { value: ["https://shop.test/login", "Shop"] } };
      if (m === "DOM.getContentQuads") return { quads: [[10, 20, 110, 20, 110, 60, 10, 60]] };
      return {};
    });
    await f.driver.enable();
    await assert.rejects(f.driver.click("e3"), /no element e3 on the page now: take a snapshot/);
    await f.driver.snapshot();
    await f.driver.click("e3");
    const mouse = f.calls.filter((c) => c[0] === "Input.dispatchMouseEvent").map((c) => [c[1].type, c[1].x, c[1].y]);
    assert.deepEqual(mouse, [["mouseMoved", 60, 40], ["mousePressed", 60, 40], ["mouseReleased", 60, 40]]);
    assert.deepEqual(f.calls.find((c) => c[0] === "DOM.scrollIntoViewIfNeeded")?.[1], { backendNodeId: 90 });
  });

  test("typing: the field focused, emptied when asked, the text put in, Enter after", async () => {
    const f = fakePage((m) => {
      if (m === "Accessibility.getFullAXTree") return { nodes: tree() };
      if (m === "DOM.resolveNode") return { object: { objectId: "o1" } };
      return {};
    });
    await f.driver.enable();
    await f.driver.snapshot();
    await f.driver.type("e1", "grace@example.com", { clear: true, submit: true });
    const seq = f.names().filter((n) => ["DOM.focus", "Runtime.callFunctionOn", "Input.insertText", "Input.dispatchKeyEvent"].includes(n));
    assert.deepEqual(seq, ["DOM.focus", "Runtime.callFunctionOn", "Input.insertText", "Input.dispatchKeyEvent", "Input.dispatchKeyEvent"]);
    assert.deepEqual(f.calls.find((c) => c[0] === "Input.insertText")?.[1], { text: "grace@example.com" });
  });

  test("what the page does meanwhile: a dialog answered and said once, the console and the requests kept", async () => {
    const f = fakePage();
    f.driver.feed("Page.javascriptDialogOpening", { type: "confirm", message: "Delete everything?" });
    f.driver.feed("Page.javascriptDialogOpening", { type: "alert", message: "Saved" });
    assert.deepEqual(f.calls.filter((c) => c[0] === "Page.handleJavaScriptDialog").map((c) => c[1].accept), [false, true]);
    assert.deepEqual(f.driver.takeSaid(), ['The page showed a confirm: "Delete everything?" — dismissed.', 'The page showed an alert: "Saved" — accepted.']);
    assert.deepEqual(f.driver.takeSaid(), []);
    f.driver.feed("Runtime.consoleAPICalled", { type: "error", args: [{ type: "string", value: "boom" }] });
    f.driver.feed("Runtime.consoleAPICalled", { type: "log", args: [{ type: "number", value: 3 }] });
    f.driver.feed("Network.requestWillBeSent", { requestId: "r1", request: { method: "POST", url: "https://shop.test/api/cart" }, type: "Fetch" });
    f.driver.feed("Network.responseReceived", { requestId: "r1", response: { status: 500 } });
    f.driver.feed("Network.requestWillBeSent", { requestId: "r2", request: { method: "GET", url: "https://shop.test/a.css" }, type: "Stylesheet" });
    f.driver.feed("Network.responseReceived", { requestId: "r2", response: { status: 200 } });
    assert.equal(f.driver.consoleLines({ errors: true }), "The page's console, 1 line:\n[error] boom");
    assert.equal(f.driver.networkLines({ failed: true }), "The page's requests, 1:\nPOST 500 fetch https://shop.test/api/cart");
  });

  test("a screenshot is the page at its own size, its long side kept to what a model reads best", async () => {
    const f = fakePage((m) => {
      if (m === "Page.getLayoutMetrics") return { cssVisualViewport: { clientWidth: 2000, clientHeight: 1000, pageX: 0, pageY: 0 } };
      if (m === "Runtime.evaluate") return { result: { value: 2 } };
      if (m === "Page.captureScreenshot") return { data: "AAAA" };
      return {};
    });
    const shot = await f.driver.screenshot();
    // The picture shrunk to 1568 on its long side; the page's own size beside it (HarnessV4_BrowserSize_Plan case 23).
    assert.deepEqual(shot, { data: "AAAA", mediaType: "image/jpeg", width: 1568, height: 784, page: { width: 2000, height: 1000 } });
    const clip = f.calls.find((c) => c[0] === "Page.captureScreenshot")?.[1].clip;
    assert.equal(clip.width, 2000);
    assert.ok(Math.abs(clip.scale - 0.392) < 0.001, `${clip.scale}`);
  });

  test("with the app's capture the picture is the app's, asked at the size the model gets (fails before: yes — a page parked in a window no one sees never answered Chrome's screenshot)", async () => {
    /** @type {any[]} */
    const asked = [];
    const calls = [];
    const driver = createDriver({
      cdp: async (m) => {
        calls.push(m);
        if (m === "Page.getLayoutMetrics") return { cssVisualViewport: { clientWidth: 2000, clientHeight: 1000 } };
        if (m === "Runtime.evaluate") return { result: { value: 2 } };
        return {};
      },
      capture: async (size) => (asked.push(size), { data: "WFla", mediaType: "image/jpeg" }),
    });
    assert.deepEqual(await driver.screenshot(), { data: "WFla", mediaType: "image/jpeg", width: 1568, height: 784, page: { width: 2000, height: 1000 } });
    assert.deepEqual(asked, [{ width: 1568, height: 784 }]);
    assert.ok(!calls.includes("Page.captureScreenshot"));
  });
});

/**
 * A stand-in for the app: every tab's commands answered by a fake page of its own.
 * @param {(method: string, params: any, tab: string) => any} [answer]
 */
function fakeApp(answer = () => ({})) {
  const host = createBrowserHost();
  /** @type {any[]} */
  const sent = [];
  /** @type {(m: any) => void} */
  let take = () => {};
  const link = {
    send: (/** @type {any} */ m) => {
      sent.push(m);
      setTimeout(() => {
        // The app's picture of the page, answered as the page's answer to a command of that name.
        if (m.op === "capture") return take({ n: m.n, ok: true, result: answer("capture", { width: m.width, height: m.height }, m.tab) ?? null });
        if (m.op !== "cdp") return take({ n: m.n, ok: true, result: null });
        const p = m.params || {};
        if (m.method === "Page.getFrameTree") return take({ n: m.n, ok: true, result: { frameTree: { frame: { id: "F", url: "about:blank" } } } });
        if (m.method === "Page.navigate") {
          take({ n: m.n, ok: true, result: { loaderId: "L" } });
          for (const [method, params] of [["Page.frameNavigated", { frame: { id: "F", url: p.url } }], ["Page.loadEventFired", {}]]) take({ op: "event", tab: m.tab, method, params });
          return;
        }
        take({ n: m.n, ok: true, result: answer(m.method, p, m.tab) ?? {} });
      }, 1);
    },
    close: () => {},
  };
  take = host.attach(link);
  return { host, sent, take, link };
}

describe("each chat's browser", () => {
  const pageAnswers = (/** @type {string} */ m) => {
    if (m === "Accessibility.getFullAXTree") return { nodes: tree() };
    if (m === "Runtime.evaluate") return { result: { value: ["https://shop.test/login", "Shop"] } };
    if (m === "DOM.getContentQuads") return { quads: [[0, 0, 10, 0, 10, 10, 0, 10]] };
    return {};
  };

  test("a chat's first call opens its tab; a navigation comes back with the page's snapshot", async () => {
    const app = fakeApp(pageAnswers);
    const browsers = createBrowsers({ host: app.host });
    const out = await browsers.call("c1", { action: "navigate", url: "shop.test/login" });
    assert.equal(typeof out, "string");
    assert.match(String(out), /^Opened https:\/\/shop\.test\/login\.\nPage: Shop — https:\/\/shop\.test\/login\n/);
    assert.ok(String(out).includes('- button "Sign in" [e3]'));
    assert.equal(app.sent[0].op, "open");
    assert.equal(browsers.pageOf("c1"), "https://shop.test/login");
    const state = await browsers.stateOf("c1");
    assert.equal(state.tabs.length, 1);
    assert.equal(state.tabs[0].shown, true);
  });

  // (fails before: yes — the swarm's review of 11-10: a deleted chat's pages stayed open in Chrome or the app, signed in as
  // they were, with nothing left to reach them)
  test("a chat deleted closes its tabs where they are open and is forgotten; another chat's go on", async () => {
    const app = fakeApp(pageAnswers);
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "shop.test/login" });
    await browsers.call("c2", { action: "navigate", url: "shop.test/login" });
    const [gone] = (await browsers.stateOf("c1")).tabs;
    const [kept] = (await browsers.stateOf("c2")).tabs;
    app.sent.length = 0;
    browsers.forget("c1");
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(app.sent.filter((m) => m.op === "close").map((m) => m.tab), [gone.id]);
    assert.deepEqual((await browsers.stateOf("c1")).tabs, []);
    assert.deepEqual((await browsers.stateOf("c2")).tabs.map((/** @type {any} */ t) => t.id), [kept.id]);
    browsers.forget("never-seen");
    // The server forgets a chat's browser as it deletes the chat.
    const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
    assert.match(server.slice(server.indexOf("memory.onSessionsDeleted = "), server.indexOf("void dropForks(ids);")), /browsers\.forget\(id\);/);
  });

  // (fails before: yes — nothing said a call began or ended: the page heard of the browser only from the run of the turn
  // it follows, and of a sub-agent's call after its turn ended not at all)
  test("each move of a chat's agents' use of its browser is told, as stateOf says it: a call's start, a batch's steps, its end, a take-over and its giving back, the app going", async () => {
    const app = fakeApp(pageAnswers);
    /** @type {{ chain: string, use: any }[]} */
    const told = [];
    let t = 1_000;
    const browsers = createBrowsers({ host: app.host, now: () => t, moved: (chain, use) => told.push({ chain, use: structuredClone(use) }) });
    await browsers.call("c1", { action: "navigate", url: "shop.test/login" });
    assert.deepEqual(told.map((x) => x.chain), ["c1", "c1"]);
    const navigate = { words: "navigate shop.test/login" };
    assert.deepEqual(told[0].use, { busy: { ...navigate, at: 1_000 }, droveAt: 1_000, taken: false, available: true, last: navigate }, "its start: the call at work");
    assert.deepEqual(told[1].use, { busy: null, droveAt: 1_000, taken: false, available: true, last: navigate }, "its end: none at work, when it ran, what it did");
    assert.deepEqual((await browsers.stateOf("c1")).last, navigate, "the pane's read says the same");
    told.length = 0;
    t = 2_000;
    await browsers.call("c1", { action: "batch", steps: [{ action: "navigate", url: "shop.test/login" }, { action: "snapshot" }] }, { seat: { id: "sa_1", name: "Scout" } });
    assert.deepEqual(told.map((x) => x.use.busy?.words ?? null), ["batch of 2 steps", "navigate shop.test/login (step 1 of 2)", "snapshot (step 2 of 2)", null], "each step said");
    assert.deepEqual(told.at(-1)?.use.last, { words: "snapshot (step 2 of 2)", by: "Scout" }, "a sub-agent's call says whose it is, after it too");
    told.length = 0;
    await browsers.person("c1", { act: "take" });
    await browsers.person("c1", { act: "give" });
    await browsers.person("c1", { act: "give" });
    assert.deepEqual(told.map((x) => x.use.taken), [true, false], "a take-over and its giving back, once each");
    told.length = 0;
    app.host.detach(app.link);
    assert.deepEqual(told.map((x) => [x.chain, x.use.available]), [["c1", false]], "the app went: no browser to show");
  });

  // (fails before: yes — the bug hunt of 10-30, DESK-1: the browser opened Filament's own address, where its API trusts
  // this machine — an agent in any mode read /api/keys with navigate and text)
  test("Filament's own address is opened by no one: an agent's navigate, a batch's, a new tab's and the developer's address are refused in words, nothing sent to the app", async () => {
    const app = fakeApp(pageAnswers);
    const browsers = createBrowsers({ host: app.host, own: (url) => filamentsOwn(url, 20300) });
    const words = /^127\.0\.0\.1:20300 is Filament's own address: the browser never opens it/;
    await assert.rejects(browsers.call("c1", { action: "navigate", url: "http://127.0.0.1:20300/api/keys" }), { message: words });
    await assert.rejects(browsers.call("c1", { action: "navigate", url: "localhost:20300" }), { message: /^localhost:20300 is Filament's own address/ });
    await assert.rejects(browsers.call("c1", { action: "batch", steps: [{ action: "navigate", url: "https://shop.test/" }, { action: "navigate", url: "http://127.0.0.1:20300/" }] }), { message: /^step 2: 127\.0\.0\.1:20300 is Filament's own address/ });
    await assert.rejects(browsers.call("c1", { action: "tabs", op: "new", url: "http://127.0.0.1:20300/" }), { message: words });
    assert.deepEqual(app.sent, [], "nothing reached the app");
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    assert.deepEqual(await browsers.person("c1", { act: "navigate", url: "http://127.0.0.1:20300/api/config" }), { ok: false, error: "127.0.0.1:20300 is Filament's own address: the browser never opens it — its pages and its API act for the developer" });
    assert.equal(browsers.pageOf("c1"), "https://shop.test/login", "the page stays where it was");
  });

  // HarnessV4_BrowserSize_Plan BS1: each tab has its own size, the app told it at open; a popup's is its opener's; a
  // tab opened again after the app went gets the size it had (case 24), every one of them (b-handoff).
  test("each tab has its own size: the app is told it at open, a popup's is kept, the pane shows it, and the app hears it again after it went", async () => {
    const app = fakeApp(pageAnswers);
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    assert.deepEqual(app.sent[0], { n: app.sent[0].n, op: "open", tab: app.sent[0].tab, width: 1280, height: 800 });
    const first = (await browsers.stateOf("c1")).tabs[0];
    assert.deepEqual([first.size, first.fit], [{ width: 1280, height: 800 }, false]);
    app.take({ op: "popup", tab: "t-pop", from: first.id, url: "https://pay.test/", width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 20));
    const pop = (await browsers.stateOf("c1")).tabs.find((t) => t.id === "t-pop");
    assert.deepEqual(pop?.size, { width: 390, height: 844 });
    await browsers.call("c1", { action: "tabs", op: "select", tab: "t-pop" });
    // The app goes and comes back: its pages went; the next call opens each of the agent's again at its size and id.
    app.host.detach(app.link);
    app.host.attach(app.link);
    const before = app.sent.length;
    await browsers.call("c1", { action: "snapshot" });
    const opened = app.sent.slice(before).filter((m) => m.op === "open");
    assert.deepEqual(opened.map((m) => [m.tab, m.width, m.height]), [[first.id, 1280, 800], ["t-pop", 390, 844]]);
    const after = (await browsers.stateOf("c1")).tabs;
    assert.deepEqual(after.map((t) => [t.id, t.size, t.shown]), [[first.id, { width: 1280, height: 800 }, false], ["t-pop", { width: 390, height: 844 }, true]]);
  });

  // HarnessV4_BrowserSize_Plan BS2, the owner's "give the agents the ability to resize the browser or it's aspect ratio
  // so that they can get a clear picture of what they are seeing" (10-23). (fails before: yes — no resize existed)
  test("resize: by name or by width and height, the app told, the result and the snapshot naming the size; a size past the limits refused in words", async () => {
    const sized = (/** @type {string} */ m, /** @type {any} */ p) => (m === "Runtime.evaluate" && /innerWidth/.test(String(p?.expression)) ? { result: { value: ["https://shop.test/login", "Shop", 390, 844] } } : pageAnswers(m));
    const app = fakeApp(sized);
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    const out = String(await browsers.call("c1", { action: "resize", size: "phone" }));
    assert.match(out, /^The page is 390 × 844 now \(phone\): it lays itself out at that size whoever watches\.\nPage: Shop — https:\/\/shop\.test\/login · 390 × 844\n/);
    const asked = app.sent.filter((m) => m.op === "size");
    assert.deepEqual(asked.map(({ width, height, fit }) => ({ width, height, fit })), [{ width: 390, height: 844, fit: undefined }]);
    assert.deepEqual((await browsers.stateOf("c1")).tabs[0].size, { width: 390, height: 844 });
    assert.match(String(await browsers.call("c1", { action: "resize", width: 1000, height: 700, snapshot: false })), /^The page is 1000 × 700 now: /);
    await assert.rejects(browsers.call("c1", { action: "resize", width: 5000, height: 300 }), { message: "5000 × 300 is no size the browser takes: 320–2560 wide, 320–1600 tall" });
    await assert.rejects(browsers.call("c1", { action: "resize", size: "watch" }), { message: /^watch is no size the browser names: desktop, laptop, tablet, phone — or width and height$/ });
    await assert.rejects(browsers.call("c1", { action: "resize" }), { message: /^resize needs size/ });
    // In a batch, as any look.
    assert.match(String(await browsers.call("c1", { action: "batch", snapshot: false, steps: [{ action: "resize", size: "desktop" }, { action: "snapshot" }] })), /1\. The page is 1440 × 900 now \(desktop\)/);
  });

  test("the developer's size from the pane, or Fit the pane: the app told, the agent whose tab it is told at its next call", async () => {
    const app = fakeApp(pageAnswers);
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    assert.deepEqual(await browsers.person("c1", { act: "size", size: "tablet" }), { ok: true });
    assert.deepEqual((await browsers.stateOf("c1")).tabs[0].size, { width: 820, height: 1180 });
    assert.match(String(await browsers.call("c1", { action: "snapshot" })), /^The developer set the page to 820 × 1180: take a snapshot before acting\.\n/);
    assert.deepEqual(await browsers.person("c1", { act: "size", fit: true }), { ok: true });
    assert.equal((await browsers.stateOf("c1")).tabs[0].fit, true);
    assert.deepEqual(app.sent.filter((m) => m.op === "size").at(-1)?.fit, true);
    assert.match(String(await browsers.call("c1", { action: "snapshot" })), /^The developer set the page to fit the Browser pane: it takes the pane's size/);
    assert.deepEqual(await browsers.person("c1", { act: "size", width: 100, height: 100 }), { ok: false, error: "100 × 100 is no size the browser takes: 320–2560 wide, 320–1600 tall" });
    // The agent's own resize takes it back from Fit: the last word wins (BS-D3).
    await browsers.call("c1", { action: "resize", size: "laptop" });
    assert.deepEqual([(await browsers.stateOf("c1")).tabs[0].fit, (await browsers.stateOf("c1")).tabs[0].size], [false, { width: 1280, height: 800 }]);
  });

  test("a screenshot of a page bigger than the picture says the page's own size", async () => {
    const big = (/** @type {string} */ m) => (m === "Page.getLayoutMetrics" ? { cssVisualViewport: { clientWidth: 2560, clientHeight: 1600 } } : m === "capture" ? { data: "QUJD", mediaType: "image/jpeg" } : pageAnswers(m));
    const app = fakeApp(big);
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    const shot = /** @type {any} */ (await browsers.call("c1", { action: "screenshot" }));
    assert.match(String(shot.text ?? shot), /A screenshot of https:\/\/shop\.test\/login \(the page 2560×1600, the picture 1568×980\)\./);
  });

  test("taken over, a call answers at once; given back, the next one is told the page may have moved", async () => {
    const app = fakeApp(pageAnswers);
    let t = 1_000_000;
    const browsers = createBrowsers({ host: app.host, now: () => t });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    await browsers.person("c1", { act: "take" });
    t += 3 * 60_000;
    const sentBefore = app.sent.length;
    await assert.rejects(browsers.call("c1", { action: "click", ref: "e3" }), { message: /^The developer has taken over the browser \(for 3 min\)/ });
    assert.equal(app.sent.length, sentBefore, "nothing reached the page");
    await browsers.person("c1", { act: "give" });
    const out = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(out, /^The developer gave the browser back after 3 min: the page may have moved/);
  });

  // HarnessV4_BrowserSize_Plan BS3: the page's own Take over, given back 5 s after the developer's mouse leaves it.
  // (fails before: yes — a take was the bar's alone, and an agent kept off the page was told to wait minutes)
  test("by hand: a call is told to wait a few seconds and look again, a wait of its own runs; given back, the agent hears for how long; the bar's take outranks it", async () => {
    const app = fakeApp(pageAnswers);
    let t = 1_000_000;
    const browsers = createBrowsers({ host: app.host, now: () => t });
    assert.equal((await browsers.stateOf("c1")).droveAt, null, "no call yet");
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    assert.equal((await browsers.stateOf("c1")).droveAt, t, "when an agent last drove it: the pane's veil reads it");
    assert.deepEqual(await browsers.person("c1", { act: "take", hand: true }), { ok: true });
    const st = await browsers.stateOf("c1");
    assert.deepEqual([st.taken, st.hand], [true, true]);
    const before = app.sent.length;
    await assert.rejects(browsers.call("c1", { action: "click", ref: "e3" }), { message: HAND_WORDS });
    await assert.rejects(browsers.call("c1", { action: "wait", text: "Welcome" }), { message: HAND_WORDS }, "a wait for the page's words reads the page");
    await assert.rejects(browsers.call("c1", { action: "batch", steps: [{ action: "wait", ms: 10 }] }), { message: HAND_WORDS });
    assert.equal(app.sent.length, before, "nothing reached the page");
    assert.equal(await browsers.call("c1", { action: "wait", ms: 10 }), "waited 10 ms.");
    t += 7000;
    await browsers.person("c1", { act: "give" });
    assert.match(String(await browsers.call("c1", { action: "snapshot" })), /^The developer used the page for 7 s: the page may have moved — take a snapshot before acting\.\n/);
    // The bar's Take over over a hand's holds it until Give back; a hand's over the bar's changes nothing.
    await browsers.person("c1", { act: "take", hand: true });
    await browsers.person("c1", { act: "take" });
    assert.equal((await browsers.stateOf("c1")).hand, false);
    await browsers.person("c1", { act: "take", hand: true });
    assert.deepEqual([(await browsers.stateOf("c1")).taken, (await browsers.stateOf("c1")).hand], [true, false]);
    await assert.rejects(browsers.call("c1", { action: "wait", ms: 10 }), { message: /^The developer has taken over the browser/ });
  });

  test("a page's popup is a tab of its chat, said; the app's going opens the page again at the next call", async () => {
    const app = fakeApp(pageAnswers);
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    const tab = (await browsers.stateOf("c1")).tabs[0].id;
    app.take({ op: "popup", tab: "t-pop", from: tab, url: "https://pay.test/" });
    await new Promise((r) => setTimeout(r, 20));
    const listed = String(await browsers.call("c1", { action: "tabs" }));
    assert.match(listed, /^The page in t-\w+ opened a new tab, t-pop \(https:\/\/pay\.test\/\); it is not shown/);
    assert.ok(listed.includes("This chat's tabs (2 of 8)"), listed);
    app.host.detach(app.link);
    await assert.rejects(browsers.call("c1", { action: "snapshot" }), { message: NO_HOST });
    const again = fakeApp(pageAnswers);
    const b2 = createBrowsers({ host: again.host });
    assert.equal(b2.pageOf("c1"), "");
  });

  test("a batch runs its steps in order and stops where acting on a site needs the developer's yes", async () => {
    const app = fakeApp(pageAnswers);
    const browsers = createBrowsers({ host: app.host });
    const out = String(
      await browsers.call("c1", { action: "batch", steps: [{ action: "navigate", url: "https://shop.test/login" }, { action: "click", ref: "e3" }, { action: "press", key: "Enter" }] }, { mayAct: (site) => site !== "shop.test" }),
    );
    assert.match(out, /^1\. Opened https:\/\/shop\.test\/login\.\nStep 2 \(click e3\) not run: acting on shop\.test needs the developer's yes/);
    assert.ok(out.includes("Page: Shop"), "the page's snapshot follows");
    assert.equal(app.sent.filter((m) => m.method === "Input.dispatchMouseEvent").length, 0);
  });

  // (fails before: yes — the bug round of 10-23: Take over stopped only the next call; a batch ran on under the
  // developer's hands)
  test("a batch stops at the next step once the developer takes the browser over", async () => {
    const app = fakeApp(pageAnswers);
    /** @type {any} */
    let browsers = null;
    let clicks = 0;
    const real = app.link.send;
    app.link.send = (/** @type {any} */ m) => {
      // The developer takes over while the first click lands.
      if (m.method === "Input.dispatchMouseEvent" && m.params?.type === "mouseReleased" && ++clicks === 1) void browsers.person("c1", { act: "take" });
      real(m);
    };
    browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    const out = String(await browsers.call("c1", { action: "batch", steps: [{ action: "click", ref: "e3" }, { action: "click", ref: "e3" }, { action: "press", key: "Enter" }] }));
    assert.match(out, /1\. Clicked e3\.[\s\S]*Stopped before step 2: the developer took the browser over\. The steps after it were not run\./);
    assert.equal(clicks, 1, "nothing after it reached the page");
  });

  // (fails before: yes — the bug round of 10-23: a click that landed on a site the rules refuse came back with that
  // page's snapshot; the rule held only from the next call)
  test("a step that lands where the rules refuse the browser: nothing of that page is read, and it goes back", async () => {
    let at = "https://shop.test/login";
    /** @type {any} */
    let app = null;
    app = fakeApp((m, p, tab) => {
      if (m === "Runtime.evaluate") return { result: { value: [at, at.includes("evil") ? "Evil" : "Shop"] } };
      if (m === "Input.dispatchMouseEvent" && p.type === "mouseReleased") at = "https://evil.test/inbox";
      if (m === "Page.getNavigationHistory") return { currentIndex: 1, entries: [{ id: 1, url: "https://shop.test/login" }, { id: 2, url: at }] };
      if (m === "Page.navigateToHistoryEntry") {
        at = "https://shop.test/login";
        setTimeout(() => app.take({ op: "event", tab, method: "Page.loadEventFired", params: {} }), 2);
      }
      return pageAnswers(m);
    });
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    const mayLook = (/** @type {string} */ page) => !page.includes("evil.test");
    const out = String(await browsers.call("c1", { action: "click", ref: "e3" }, { mayLook }));
    assert.match(out, /The page went to https:\/\/evil\.test\/inbox, where this session's rules refuse the browser: nothing of it was read, and Filament went back to https:\/\/shop\.test\/login\./);
    assert.doesNotMatch(out, /Page: /, "no snapshot of where it went");
    assert.equal(browsers.pageOf("c1"), "https://shop.test/login");
    const batch = String(await browsers.call("c1", { action: "batch", steps: [{ action: "click", ref: "e3" }, { action: "press", key: "Enter" }] }, { mayLook }));
    assert.match(batch, /^1\. Clicked e3\.[\s\S]*nothing of it was read, and Filament went back[\s\S]*The steps after it were not run\./);
    assert.equal(app.sent.filter((x) => x.method === "Input.dispatchKeyEvent").length, 0, "the batch's next step never ran");
  });

  // (fails before: yes — the bug round of 10-23: the app loaded a popup's page before Filament closed it as one past
  // the chat's tabs, and the app's notes were dropped on the way)
  test("a popup is loaded once its chat keeps it; one past the chat's tabs never is; the app's notes reach the call", async () => {
    const app = fakeApp(pageAnswers);
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    const tab = (await browsers.stateOf("c1")).tabs[0].id;
    app.take({ op: "popup", tab: "t-pop", from: tab, url: "https://pay.test/" });
    const loads = () => app.sent.some((m) => m.tab === "t-pop" && m.method === "Page.navigate" && m.params?.url === "https://pay.test/");
    for (let i = 0; i < 200 && !loads(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(loads(), "Filament loads the tab it keeps");
    for (let i = 0; i < 6; i++) await browsers.call("c1", { action: "tabs", op: "new" });
    app.take({ op: "popup", tab: "t-over", from: tab, url: "https://ads.test/" });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(app.sent.some((m) => m.tab === "t-over" && m.method === "Page.navigate"), false, "one past the chat's tabs is never loaded");
    assert.ok(app.sent.some((m) => m.op === "close" && m.tab === "t-over"));
    app.take({ op: "note", tab, words: "The page started a download (setup.exe); the browser takes no downloads, so it was not kept." });
    const listed = String(await browsers.call("c1", { action: "tabs" }));
    assert.match(listed, /The page started a download \(setup\.exe\)/);
  });

  // ---- every agent of the chat, each in tabs of its own (HarnessV4_AgentTools_Plan AT2) ----

  /** A page per tab: each tab's address its own, as it navigated. */
  const perTab = () => {
    /** @type {Map<string, string>} */
    const at = new Map();
    const app = fakeApp((m, p, tab) => {
      if (m === "Runtime.evaluate") return { result: { value: [at.get(tab) || "about:blank", "Page"] } };
      return pageAnswers(m);
    });
    const send = app.link.send;
    app.link.send = (/** @type {any} */ msg) => {
      if (msg.method === "Page.navigate") at.set(msg.tab, msg.params.url);
      send(msg);
    };
    return app;
  };
  const DESIGNER = { id: "sa_1", name: "Designer" };

  // (fails before: yes — the owner's words of 10-23, "it did not have the access to browser tool": a sub-agent had no
  // browser, BR-D13's one driver per chat's browser)
  test("a sub-agent's first call opens a tab of its own, named for it; each agent works on its own tab and lists its own", async () => {
    const app = perTab();
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    const out = String(await browsers.call("c1", { action: "navigate", url: "localhost:5173" }, { seat: DESIGNER }));
    assert.match(out, /^Opened http:\/\/localhost:5173\/?\./);
    assert.equal(app.sent.filter((m) => m.op === "open").length, 2, "a tab of its own");
    assert.deepEqual([browsers.pageOf("c1"), browsers.pageOf("c1", DESIGNER)], ["https://shop.test/login", "http://localhost:5173"]);
    const st = await browsers.stateOf("c1");
    assert.deepEqual(st.tabs.map((t) => [t.url, t.shown, t.by ?? null]), [["https://shop.test/login", true, null], ["http://localhost:5173", false, "Designer"]], "the pane shows what it showed");
    assert.match(String(await browsers.call("c1", { action: "tabs" }, { seat: DESIGNER })), /^Your tabs in this chat's browser \(1; the chat holds 8\):\nt-\w+ \(yours now\) Page — http:\/\/localhost:5173\n\(1 more is other agents' of this chat: theirs to work on\.\)$/);
    assert.match(String(await browsers.call("c1", { action: "tabs" })), /^This chat's tabs \(1 of 8\):\nt-\w+ \(shown\) Page — https:\/\/shop\.test\/login\n\(1 more is other agents'/);
    const mainTab = st.tabs[0].id;
    await assert.rejects(browsers.call("c1", { action: "tabs", op: "close", tab: mainTab }, { seat: DESIGNER }), { message: `no tab ${mainTab} of yours: tabs list names them` });
    await assert.rejects(browsers.call("c1", { action: "tabs", op: "select", tab: mainTab }, { seat: DESIGNER }), { message: `no tab ${mainTab} of yours: tabs list names them` });
  });

  // (fails before: yes — AT-D3: the pane's tab and the agent's were one)
  test("the tab the pane shows is the developer's: showing another agent's moves no agent; their acts there go to its agent", async () => {
    const app = perTab();
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    await browsers.call("c1", { action: "navigate", url: "localhost:5173" }, { seat: DESIGNER });
    const theirs = (await browsers.stateOf("c1")).tabs[1].id;
    assert.deepEqual(await browsers.person("c1", { act: "select", tab: theirs }), { ok: true });
    assert.equal(browsers.shownTab("c1"), theirs);
    assert.equal(browsers.pageOf("c1"), "https://shop.test/login", "the main agent's tab did not move");
    assert.match(String(await browsers.call("c1", { action: "snapshot" })), /Page: Page — https:\/\/shop\.test\/login/);
    await browsers.person("c1", { act: "navigate", url: "localhost:5173/settings" });
    assert.equal(browsers.pageOf("c1", DESIGNER), "http://localhost:5173/settings", "the shown tab, Designer's");
    assert.match(String(await browsers.call("c1", { action: "snapshot" }, { seat: DESIGNER })), new RegExp(`^The developer opened http://localhost:5173/settings in your tab ${theirs}\\.`));
    await browsers.person("c1", { act: "close", tab: theirs });
    assert.match(String(await browsers.call("c1", { action: "tabs" }, { seat: DESIGNER })), new RegExp(`^The developer closed your tab ${theirs}\\.\nNo tabs yet`));
  });

  // (fails before: yes — AT-D4: one driver)
  test("Take over holds every agent; giving it back tells each; a site's yes holds for them all", async () => {
    const app = perTab();
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    await browsers.call("c1", { action: "navigate", url: "localhost:5173" }, { seat: DESIGNER });
    await browsers.person("c1", { act: "take" });
    await assert.rejects(browsers.call("c1", { action: "snapshot" }, { seat: DESIGNER }), { message: /^The developer has taken over the browser/ });
    await assert.rejects(browsers.call("c1", { action: "snapshot" }), { message: /^The developer has taken over the browser/ });
    await browsers.person("c1", { act: "give" });
    for (const seat of [null, DESIGNER]) assert.match(String(await browsers.call("c1", { action: "snapshot" }, { seat })), /^The developer gave the browser back/);
    browsers.allow("c1", "localhost");
    assert.equal(browsers.allowed("c1", "localhost"), true, "the chat's, whoever asked");
  });

  const HUNTERS = { key: "hunters", name: "Hunters" };
  const SCOUTS = { key: "scouts", name: "Scouts" };

  // (fails before: yes — the bug hunt of 10-30, LOOP-2: every yes was kept for the chat, a team's lead's among them)
  test("a site's yes: the developer's holds for every agent of the chat, a team's lead's for that team's workers alone; the pane says whose, and Forget takes both back", async () => {
    const browsers = createBrowsers({ host: perTab().host });
    browsers.allow("c1", "shop.test", HUNTERS);
    assert.deepEqual([browsers.allowed("c1", "shop.test", HUNTERS), browsers.allowed("c1", "shop.test", SCOUTS), browsers.allowed("c1", "shop.test")], [true, false, false]);
    browsers.allow("c1", "docs.test");
    assert.deepEqual([browsers.allowed("c1", "docs.test", HUNTERS), browsers.allowed("c1", "docs.test", SCOUTS), browsers.allowed("c1", "docs.test")], [true, true, true]);
    // An agent in no team keeps a lead's yes for nobody; the developer's for the chat.
    const helper = browsers.forAgent("c1", { id: "sa_9", name: "Helper" }, null);
    helper.allow("pay.test", true);
    assert.deepEqual([browsers.allowed("c1", "pay.test"), browsers.allowed("c1", "pay.test", HUNTERS)], [false, false]);
    helper.allow("pay.test");
    assert.equal(browsers.allowed("c1", "pay.test", SCOUTS), true);
    const st = await browsers.stateOf("c1");
    assert.deepEqual([st.sites, st.teamSites], [["docs.test", "pay.test"], [{ site: "shop.test", team: "Hunters" }]]);
    assert.deepEqual(await browsers.person("c1", { act: "forbid", site: "shop.test" }), { ok: true });
    assert.equal(browsers.allowed("c1", "shop.test", HUNTERS), false, "Forget takes a lead's yes back too");
    assert.deepEqual((await browsers.stateOf("c1")).teamSites, []);
  });

  // (fails before: yes — the bug hunt of 10-30, LOOP-2: a team's lead's yes to its worker's act was kept for the chat, so
  // the main agent — the lead itself — and every other agent of it acted on the site unasked)
  test("a team's worker on Filament's loop: its lead's yes to an act runs it and holds for that team's workers alone", async () => {
    const browsers = createBrowsers({ host: perTab().host });
    /** @type {string[]} */
    const ran = [];
    /** @type {string[]} */
    const asked = [];
    let n = 0;
    const out = await runAgentTurn(/** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "sign in" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false, browser: true }),
      modeNow: () => "edit",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      unattended: "worker",
      asker: async (/** @type {any} */ q) => (asked.push(q.question), { text: "yes", allow: true, by: "lead" }),
      // The worker's tab is on the shop's sign-in page.
      browser: { ...browsers.forAgent("c1", { id: "sa_1", name: "Tester" }, HUNTERS), page: () => "https://shop.test/login" },
      call: async () => ({ ok: true, status: 200, json: { content: n++ === 0 ? [{ type: "tool_use", id: "b1", name: "browser", input: CLICK }] : [{ type: "text", text: "Done." }], usage: { input_tokens: 10, output_tokens: 5 } }, id: null }),
      costOf: () => 0,
      runHand: async (/** @type {string} */ name) => (ran.push(name), "clicked"),
      delegateRead: null,
      mailbox: null,
      permissions: null,
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
      signal: null,
      resume: null,
    }));
    assert.deepEqual(ran, ["browser"], "its lead's yes ran the click");
    // Its question, which the developer and its lead may each answer, says what each one's yes holds for.
    assert.deepEqual(asked.map((q) => q.match(/An allow holds .*? \(/)?.[0]), ["An allow holds for the rest of this chat — yours for every agent of it, my lead's for the Hunters team's workers alone ("]);
    assert.equal(browsers.allowed("c1", "shop.test"), false, "no yes for the chat: its main agent, the lead, still asks");
    assert.equal(browsers.allowed("c1", "shop.test", SCOUTS), false, "nor for another team's workers");
    assert.equal(browsers.allowed("c1", "shop.test", HUNTERS), true, "the team's workers act there unasked");
    assert.ok(out.notes.includes("agent: the browser may act on shop.test for the rest of this chat, for its team's workers — its lead said yes"), out.notes.join("\n"));
  });

  // (fails before: yes — AT-D5)
  test("at eight tabs a new one closes the tab used longest ago of another sub-agent at rest and not shown, said to it; the main agent's are never closed", async () => {
    const app = perTab();
    let t = 1000;
    const browsers = createBrowsers({ host: app.host, now: () => (t += 10) });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    await browsers.call("c1", { action: "navigate", url: "https://one.test/" }, { seat: { id: "sa_1", name: "One" } });
    for (let i = 0; i < 6; i++) await browsers.call("c1", { action: "tabs", op: "new", url: `https://two.test/${i}` }, { seat: { id: "sa_2", name: "Two" } });
    assert.equal((await browsers.stateOf("c1")).tabs.length, 8);
    await browsers.call("c1", { action: "navigate", url: "https://three.test/" }, { seat: { id: "sa_3", name: "Three" } });
    const st = await browsers.stateOf("c1");
    assert.equal(st.tabs.length, 8);
    assert.deepEqual(st.tabs.map((x) => x.by ?? "main").filter((x) => x === "One"), [], "One's tab, used longest ago, went");
    assert.match(String(await browsers.call("c1", { action: "tabs" }, { seat: { id: "sa_1", name: "One" } })), /^Tab t-\w+ \(https:\/\/one\.test\/\) was closed to make room for another agent's: this chat's browser holds 8\./);
    // Eight of the main agent's: nothing to close, and the call says so.
    const full = perTab();
    const b2 = createBrowsers({ host: full.host });
    await b2.call("c1", { action: "navigate", url: "https://shop.test/" });
    for (let i = 0; i < 7; i++) await b2.call("c1", { action: "tabs", op: "new" });
    await assert.rejects(b2.call("c1", { action: "snapshot" }, { seat: DESIGNER }), { message: /^this chat's browser has 8 tabs, the most it may: close one of yours \(tabs close\), or ask the developer to close one in the Browser pane$/ });
    await assert.rejects(b2.call("c1", { action: "tabs", op: "new" }), { message: "this chat has 8 tabs, the most it may: close one first" });
  });

  test("a popup is a tab of the agent whose tab opened it", async () => {
    const app = perTab();
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "localhost:5173" }, { seat: DESIGNER });
    const tab = (await browsers.stateOf("c1")).tabs[0].id;
    app.take({ op: "popup", tab: "t-pop", from: tab, url: "https://pay.test/" });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await browsers.stateOf("c1")).tabs.find((x) => x.id === "t-pop")?.by, "Designer");
    assert.match(String(await browsers.call("c1", { action: "tabs" }, { seat: DESIGNER })), /opened a new tab, t-pop/);
    assert.doesNotMatch(String(await browsers.call("c1", { action: "tabs" })), /opened a new tab/, "not the main agent's to hear");
  });

  test("a screenshot comes as a picture beside its words", async () => {
    const app = fakeApp((m) => {
      if (m === "Page.getLayoutMetrics") return { cssVisualViewport: { clientWidth: 1280, clientHeight: 800 } };
      if (m === "Runtime.evaluate") return { result: { value: 1 } };
      if (m === "capture") return { data: "QUJD", mediaType: "image/jpeg" };
      return {};
    });
    const browsers = createBrowsers({ host: app.host });
    const out = await browsers.call("c1", { action: "screenshot" });
    assert.deepEqual(app.sent.find((x) => x.op === "capture"), { n: app.sent.find((x) => x.op === "capture").n, op: "capture", tab: app.sent[0].tab, width: 1280, height: 800 }, "the app takes the picture");
    assert.ok(out instanceof MediaResult);
    assert.match(out.text, /^A screenshot of .* \(1280×800\)\.$/);
    assert.deepEqual(out.media, [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } }]);
  });

  // ---- a coding agent's, through Filament's MCP server (HarnessV4_AgentTools_Plan AT3, AT-D7) ----

  /** Filament's own tools over the chats' browsers. @param {any} browsers */
  const ownTools = (browsers) =>
    createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: createAgentTurns(), subagents: () => null, membersOf: () => null, browsers: () => browsers });
  const CLICK = { action: "click", ref: "e3" };

  // (fails before: yes — the owner's words of 10-23: a coding agent had no browser, Filament's server offered none)
  test("a coding agent's: listed where its chat drives a browser; each call judged by the chat's switch, a yes kept for the chat; a sub-agent's in tabs of its own", async () => {
    const app = perTab();
    const browsers = createBrowsers({ host: app.host });
    const tools = ownTools(browsers);
    /** @type {any[]} */
    const asked = [];
    let yes = false;
    /** @param {any} [o] @returns {any} */
    const ctx = (o = {}) => ({
      cwd: ".",
      upstream: "claude",
      chain: "c1",
      turn: "t1",
      graph: false,
      browser: true,
      permit: async (/** @type {any} */ calls, /** @type {string} */ what) => (asked.push([calls, what]), { asked: yes }),
      judgeNow: () => "run",
      ...o,
    });
    /** @param {any} t @param {any} c */
    const listed = (t, c) => t.list(c).some((/** @type {any} */ d) => d.name === "browser");
    assert.deepEqual([listed(tools, ctx()), tools.has("browser")], [true, true]);
    assert.equal(listed(tools, ctx({ browser: false })), false, "the chat's switch off");
    assert.equal(listed(tools, ctx({ chain: null })), false, "no chat of the harness");
    assert.equal(listed(ownTools(null), ctx()), false, "no browsers made");
    const opened = await tools.call("browser", { action: "navigate", url: "https://shop.test/login" }, ctx());
    assert.match(opened.text, /^Opened https:\/\/shop\.test\/login\./);
    assert.deepEqual(asked[0], [[{ name: "browser", input: { action: "navigate", url: "https://shop.test/login", page: "" } }], "use the browser: navigate https://shop.test/login"]);
    assert.equal(browsers.allowed("c1", "shop.test"), false, "a look the switch ran is no yes");
    yes = true;
    await tools.call("browser", CLICK, ctx());
    assert.equal(asked[1][0][0].input.page, "https://shop.test/login", "judged on the page its tab shows");
    assert.equal(browsers.allowed("c1", "shop.test"), true, "the person's yes holds for the chat, as the loop's does");
    // A sub-agent of the chat on a coding agent: a tab of its own, named for it.
    await tools.call("browser", { action: "navigate", url: "localhost:5173" }, ctx({ by: { id: "sa_1", exchange: 1, name: "Designer" } }));
    assert.deepEqual((await browsers.stateOf("c1")).tabs.map((t) => t.by ?? null), [null, "Designer"]);
    // Refused: said in words, nothing sent to the page.
    const sent = app.sent.length;
    const no = (/** @type {string} */ why) => ctx({ permit: async () => { throw new Error(why); } });
    assert.deepEqual(await tools.call("browser", CLICK, no("this session's read-only mode refused it")), { text: BROWSER_READ_ONLY, isError: true });
    assert.deepEqual(await tools.call("browser", CLICK, no("the person declined it")), { text: "Not run: the person declined it.", isError: true });
    assert.equal(app.sent.length, sent);
    assert.deepEqual(await tools.call("browser", { action: "snapshot" }, ctx({ browser: false })), { text: "Not run: this chat drives no browser now (its Tools, Drive a browser).", isError: true });
    assert.deepEqual(await tools.call("browser", { action: "snapshot" }, ctx({ permit: null })), { text: "Not run: no turn of this chat runs now to judge the call.", isError: true });
  });

  // (fails before: yes — the bug hunt of 10-30, LOOP-2: a coding agent's worker's act its lead said yes to was kept for the
  // chat, as the person's yes is)
  test("a coding agent's: a team's worker's act its lead said yes to holds for that team's workers alone; the person's yes for the chat", async () => {
    const browsers = createBrowsers({ host: perTab().host });
    const tools = ownTools(browsers);
    /** @type {{ asked: boolean, by?: "lead" }} */
    let yes = { asked: true, by: "lead" };
    const tester = { id: "sa_1", exchange: 1, name: "Tester", team: HUNTERS };
    /** @param {any} [o] @returns {any} */
    const ctx = (o = {}) => ({ cwd: ".", upstream: "claude", chain: "c1", turn: "t1", graph: false, browser: true, permit: async () => yes, judgeNow: () => "run", by: tester, ...o });
    await tools.call("browser", { action: "navigate", url: "https://shop.test/login" }, ctx());
    await tools.call("browser", CLICK, ctx());
    assert.equal(browsers.allowed("c1", "shop.test"), false, "no yes for the chat");
    assert.equal(browsers.allowed("c1", "shop.test", HUNTERS), true, "its team's workers act there unasked");
    // A lead's yes to an agent in no team holds for nobody; the person's holds for the chat.
    const helper = { id: "sa_2", exchange: 1, name: "Helper" };
    await tools.call("browser", { action: "navigate", url: "https://pay.test/" }, ctx({ by: helper }));
    await tools.call("browser", CLICK, ctx({ by: helper }));
    assert.deepEqual([browsers.allowed("c1", "pay.test"), browsers.allowed("c1", "pay.test", HUNTERS)], [false, false]);
    yes = { asked: true };
    await tools.call("browser", CLICK, ctx({ by: helper }));
    assert.equal(browsers.allowed("c1", "pay.test"), true);
  });

  // (fails before: yes — the bug hunt of 10-30, LOOP-2: the bridge said a yes ran it, not whose)
  test("a coding agent's call its worker's lead said yes to is said so by the bridge, apart from the person's", async () => {
    const tb = new TurnBridge();
    const calls = [{ name: "browser", input: { ...CLICK, page: "https://shop.test/login" } }];
    /** @type {any} */
    let by = "lead";
    const turn = /** @type {any} */ ({ done: false, conv: { cwd: "." }, emit: () => {}, sayer: () => () => {}, permits: createAgentPermits({ rules: [], modeNow: () => "edit", learned: null }) });
    /** @type {any} */ (tb).askPerson = async () => ({ outcome: "answered", answers: { permission: { chosen: ["allow"] } }, ...(by ? { by } : {}) });
    assert.deepEqual(await tb.permitCalls(turn, { id: "claude" }, calls, "use the browser: click e3"), { asked: true, by: "lead" });
    by = null;
    assert.deepEqual(await tb.permitCalls(turn, { id: "claude" }, calls, "use the browser: click e3"), { asked: true });
  });

  // (fails before: yes — AT-D7: the generic gate judged a coding agent's browser call, a look asked as a click did)
  test("the chat's switch judges a coding agent's browser call as the loop's gate does: looking runs, acting is refused in read-only, asks once a site in Edit", () => {
    const yes = new Set(["localhost"]);
    const at = (/** @type {any} */ mode) => createAgentPermits({ rules: [], modeNow: () => mode, learned: null, browserAllowed: (site) => yes.has(site) });
    const call = (/** @type {any} */ input) => [{ name: "browser", input: { page: "https://shop.test/login", ...input } }];
    for (const mode of ["read-only", "edit", "ask", "auto"]) assert.equal(at(mode).judge(call({ action: "snapshot" }), ".").verdict, "run", mode);
    assert.equal(at("read-only").judge(call(CLICK), ".").verdict, "refuse");
    const asks = at("edit").judge(call(CLICK), ".");
    assert.deepEqual([asks.verdict, asks.tool], ["ask", "browser"]);
    assert.match(String(asks.question), /^May I act on shop\.test in the browser\? First: click e3\./);
    assert.equal(at("edit").judge(call({ ...CLICK, page: "http://localhost:5173/" }), ".").verdict, "run", "a site the person said yes to");
    assert.equal(at("auto").judge(call(CLICK), ".").verdict, "run");
    assert.equal(at("edit").allowed(call(CLICK), ".").verdict, "run", "the person's yes runs it");
    assert.equal(at("read-only").allowed(call(CLICK), ".").verdict, "refuse");
    // A team's worker's question says its lead's yes holds for its team's workers alone (the bug hunt of 10-30, LOOP-2).
    const worker = createAgentPermits({ rules: [], modeNow: () => "edit", learned: null, browserAllowed: () => false, browserTeam: HUNTERS }).judge(call(CLICK), ".");
    assert.match(String(worker.question), /^May I act on shop\.test in the browser\? First: click e3\. An allow holds for the rest of this chat — yours for every agent of it, my lead's for the Hunters team's workers alone \(the Browser pane's ⋯ takes either back\);/);
  });

  // (fails before: yes — the E27 hunt of 10-23: the plan's hold counted no browser act, and a held worker's click went to the card)
  test("a worker whose plan waits for its lead's review acts on no page: its browser only looks", () => {
    const p = createAgentPermits({ rules: [], modeNow: () => "auto", learned: null, held: () => true });
    assert.equal(p.judge([{ name: "browser", input: { ...CLICK, page: "https://shop.test/" } }], ".").verdict, "refuse");
    assert.equal(p.judge([{ name: "browser", input: { action: "batch", steps: [{ action: "navigate", url: "https://shop.test/" }, CLICK] } }], ".").verdict, "refuse");
    assert.equal(p.judge([{ name: "browser", input: { action: "snapshot", page: "https://shop.test/" } }], ".").verdict, "run");
  });

  test("a coding agent's call with no turn of the chat to judge it is refused; the card where the switch asks, its yes said as asked", async () => {
    const tb = new TurnBridge();
    const calls = [{ name: "browser", input: { ...CLICK, page: "https://shop.test/login" } }];
    for (const turn of [null, { done: true }])
      await assert.rejects(tb.permitCalls(/** @type {any} */ (turn), { id: "claude" }, calls, "use the browser: click e3"), { code: -32000, message: "no turn of the harness chat runs to judge it, so Filament did not run it" });
    /** @type {any} */
    let mode = "edit";
    let answer = "allow";
    /** @type {any[]} */
    const forms = [];
    const turn = /** @type {any} */ ({ done: false, conv: { cwd: "." }, emit: () => {}, sayer: () => () => {}, permits: createAgentPermits({ rules: [], modeNow: () => mode, learned: null }) });
    /** @type {any} */ (tb).askPerson = async (/** @type {any} */ _t, /** @type {any} */ form) => (forms.push(form), { outcome: "answered", answers: { permission: { chosen: [answer] } } });
    assert.deepEqual(await tb.permitCalls(turn, { id: "claude" }, calls, "use the browser: click e3"), { asked: true });
    assert.equal(forms.length, 1, "the permission card");
    answer = "deny";
    await assert.rejects(tb.permitCalls(turn, { id: "claude" }, calls, "use the browser: click e3"), { message: "the person declined it" });
    mode = "read-only";
    await assert.rejects(tb.permitCalls(turn, { id: "claude" }, calls, "use the browser: click e3"), { message: "this session's read-only mode refused it" });
    assert.equal(tb.judgeNow(turn, calls), "refuse");
    mode = "auto";
    assert.deepEqual(await tb.permitCalls(turn, { id: "claude" }, calls, "use the browser: click e3"), { asked: false });
    assert.deepEqual([tb.judgeNow(turn, calls), tb.judgeNow(null, calls)], ["run", "refuse"]);
    assert.equal(forms.length, 2, "asked only where the switch asks");
    // (fails before: yes — the bridge said no mode: a command on another machine went without this chat's, the review of 11-10)
    // The switch as it stands, which a command on another machine is judged in there; none where no turn runs.
    assert.deepEqual([tb.modeNow(turn), tb.modeNow(null), tb.modeNow({ ...turn, done: true })], ["auto", null, null]);
    mode = "edit";
    assert.equal(tb.modeNow(turn), "edit");
  });

  test("over Filament's MCP server a screenshot is an image beside its words; the server's words name the browser where the chat has it", async () => {
    /** @param {McpToolServer} srv @param {any} msg */
    const ask = async (srv, msg) => {
      const out = { body: "" };
      const res = { writeHead() {}, end(/** @type {any} */ b) { out.body += b || ""; } };
      await srv.handle(/** @type {any} */ ({ method: "POST" }), /** @type {any} */ (res), "tok", JSON.stringify({ jsonrpc: "2.0", id: 1, ...msg }));
      return JSON.parse(out.body);
    };
    const tools = /** @type {any} */ ({
      memoryOn: () => false,
      list: () => [],
      has: (/** @type {string} */ n) => n === "browser",
      call: async () => ({ text: "A screenshot.", media: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } }] }),
    });
    /** @param {boolean} browser */
    const srvOf = (browser) => new McpToolServer({ bridge: /** @type {any} */ ({ contextForMcpToken: () => ({ conv: null, turn: null, cwd: "C:/p", upstream: { id: "claude", acp: {} }, native: false, chain: "c1", graph: false, browser }) }), tools });
    const r = await ask(srvOf(true), { method: "tools/call", params: { name: "browser", arguments: { action: "screenshot" } } });
    assert.deepEqual(r.result, { content: [{ type: "text", text: "A screenshot." }, { type: "image", data: "QUJD", mimeType: "image/jpeg" }] });
    assert.match((await ask(srvOf(true), { method: "initialize", params: {} })).result.instructions, / Its `browser` drives the browser in the Browser pane beside the person's chat, which they watch: .* The project folder is C:\/p\.$/);
    assert.doesNotMatch((await ask(srvOf(false), { method: "initialize", params: {} })).result.instructions, /`browser`/);
  });

  // ---- the E27 hunt and the copies hunt of 10-23 ----

  /** How many clicks reached a page. @param {any} app */
  const clicksOf = (app) => app.sent.filter((/** @type {any} */ m) => m.method === "Input.dispatchMouseEvent").length;

  // (fails before: yes — the page was read before the card, and the act ran wherever the tab was by then)
  test("an act is judged again on the page it acts on now: a tab that moved while the developer was asked acts on nothing", async () => {
    const app = perTab();
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    // Asked about shop.test, the developer said yes; meanwhile their own address took the tab to evil.test.
    browsers.allow("c1", "shop.test");
    await browsers.person("c1", { act: "navigate", url: "https://evil.test/inbox" });
    const mayAct = (/** @type {string} */ site) => browsers.allowed("c1", site);
    // What the developer did comes ahead of the refusal, as it comes ahead of a result.
    await assert.rejects(browsers.call("c1", CLICK, { mayAct }), { message: "The developer opened https://evil.test/inbox.\nNot run: the page is on evil.test now, not the one the call was judged on, and acting on evil.test needs the developer's yes — call it again, and Filament asks them." });
    assert.equal(clicksOf(app), 0);
    await browsers.person("c1", { act: "navigate", url: "https://shop.test/login" });
    // A page loaded again names its elements anew: the button's handle is the snapshot's.
    const ref = String(/button "Sign in" \[(e\d+)\]/.exec(String(await browsers.call("c1", { action: "snapshot" })))?.[1]);
    await browsers.call("c1", { action: "click", ref }, { mayAct });
    assert.ok(clicksOf(app) > 0, "on the page it was judged on, it runs");
  });

  // (fails before: yes — with no tab after the app went, the page read as no site: the act ran unasked where its call
  // opened the old page again)
  test("after the app went, an act is judged on the page its call opens again at, never as no site", async () => {
    const app = perTab();
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    app.host.detach(app.link);
    app.host.attach(app.link);
    assert.equal(browsers.pageOf("c1"), "https://shop.test/login", "the gate asks about the page it opens again at");
    // The app's start again is said first, as it is ahead of a result: the refusal is the failure's own line.
    await assert.rejects(browsers.call("c1", CLICK, { mayAct: () => false }), { message: /^The browser started again[^\n]*\nNot run: the page is on shop\.test now/ });
    assert.equal(clicksOf(app), 0);
  });

  // (fails before: yes — both agents took the same room, and the chat held nine)
  test("two agents opening their first tabs at once at eight make room each: the chat never holds a ninth", async () => {
    const app = perTab();
    let t = 1000;
    const browsers = createBrowsers({ host: app.host, now: () => (t += 10) });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    for (let i = 0; i < 7; i++) await browsers.call("c1", { action: "tabs", op: "new", url: `https://two.test/${i}` }, { seat: { id: "sa_2", name: "Two" } });
    await Promise.all([
      browsers.call("c1", { action: "navigate", url: "https://three.test/" }, { seat: { id: "sa_3", name: "Three" } }),
      browsers.call("c1", { action: "navigate", url: "https://four.test/" }, { seat: { id: "sa_4", name: "Four" } }),
    ]);
    const st = await browsers.stateOf("c1");
    assert.equal(st.tabs.length, 8);
    assert.deepEqual(st.tabs.map((x) => x.by ?? "main").filter((x) => x === "Two").length, 5, "two of Two's at rest went, one for each");
  });

  // (fails before: yes — they told no agent: its next act used handles of the page before)
  test("the developer's Back, Forward and Reload, and a tab of the main agent's shown, are said to the agent whose tab it is", async () => {
    const app = perTab();
    const send = app.link.send;
    app.link.send = (/** @type {any} */ m) => {
      send(m);
      if (m.method === "Page.reload") setTimeout(() => app.take({ op: "event", tab: m.tab, method: "Page.loadEventFired", params: {} }), 3);
    };
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    await browsers.call("c1", { action: "tabs", op: "new", url: "https://docs.test/" });
    const [first] = (await browsers.stateOf("c1")).tabs.map((x) => x.id);
    await browsers.person("c1", { act: "select", tab: first });
    await browsers.person("c1", { act: "reload" });
    const out = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(out, new RegExp(`^The developer showed tab ${first} in the Browser pane: your calls work on it now \\(https://shop\\.test/login\\) — take a snapshot before acting\\.\nThe developer reloaded the page: take a snapshot before acting\\.`));
  });

  // (fails before: yes — no seat was ever let go, and every word for the chat's agents piled up on each)
  test("a sub-agent's seat with nothing in the browser goes as the chat's agents are told something; the main agent keeps the newest twenty", async () => {
    const app = perTab();
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "localhost:5173" }, { seat: DESIGNER });
    const theirs = (await browsers.stateOf("c1")).tabs[0].id;
    await browsers.call("c1", { action: "tabs", op: "close", tab: theirs }, { seat: DESIGNER });
    for (let i = 0; i < 30; i++) {
      await browsers.person("c1", { act: "take" });
      await browsers.person("c1", { act: "give" });
    }
    assert.doesNotMatch(String(await browsers.call("c1", { action: "tabs" }, { seat: DESIGNER })), /gave the browser back/);
    assert.equal(String(await browsers.call("c1", { action: "tabs" })).match(/gave the browser back/g)?.length, 20);
  });

  // (fails before: yes — a popup was loaded with no rule asked, and its title and address were listed)
  test("a popup to a page the session's rules keep the browser from reading is closed unread; a tab there lists neither title nor address", async () => {
    const app = perTab();
    const unseen = (/** @type {string} */ page) => !page.includes("evil.test");
    const browsers = createBrowsers({ host: app.host, looks: (_chain, page) => unseen(page) });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    const tab = (await browsers.stateOf("c1")).tabs[0].id;
    app.take({ op: "popup", tab: "t-evil", from: tab, url: "https://evil.test/inbox" });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(app.sent.some((m) => m.tab === "t-evil" && m.method === "Page.navigate"), false, "never loaded");
    assert.ok(app.sent.some((m) => m.op === "close" && m.tab === "t-evil"));
    assert.match(String(await browsers.call("c1", { action: "tabs" }, { mayLook: unseen })), /opened a window to a page this session's rules keep the browser from reading: it was closed, and nothing of it was read\./);
    await browsers.person("c1", { act: "navigate", url: "https://evil.test/inbox" });
    const listed = String(await browsers.call("c1", { action: "tabs" }, { mayLook: unseen }));
    assert.match(listed, /t-\w+ \(shown\) \(a page this session's rules keep the browser from reading\)$/);
    assert.doesNotMatch(listed.split("\n").slice(1).join("\n"), /evil\.test/, "the developer's own address is said to it; the list says nothing of the page");
  });

  // (fails before: yes — the take-over was looked for before each step alone: given back within one, the batch ran on)
  test("a batch stops where the developer took the browser over and gave it back within one of its steps", async () => {
    const app = fakeApp(pageAnswers);
    /** @type {any} */
    let browsers = null;
    let clicks = 0;
    const real = app.link.send;
    app.link.send = (/** @type {any} */ m) => {
      if (m.method === "Input.dispatchMouseEvent" && m.params?.type === "mouseReleased" && ++clicks === 1) {
        void browsers.person("c1", { act: "take" });
        void browsers.person("c1", { act: "give" });
      }
      real(m);
    };
    browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    const out = String(await browsers.call("c1", { action: "batch", steps: [CLICK, CLICK, { action: "press", key: "Enter" }] }));
    assert.match(out, /Stopped before step 2: the developer took the browser over, and gave it back: the page may have moved — take a snapshot before acting\. The steps after it were not run\./);
    assert.equal(clicks, 1);
  });

  // (fails before: yes — its opener's chat was gone, and the popup stayed open in the app, unseen)
  test("a popup whose opener is gone already is closed in the app", async () => {
    const app = perTab();
    const browsers = createBrowsers({ host: app.host });
    await browsers.call("c1", { action: "navigate", url: "https://shop.test/login" });
    await browsers.call("c1", { action: "tabs", op: "new" });
    const [first] = (await browsers.stateOf("c1")).tabs.map((x) => x.id);
    await browsers.person("c1", { act: "close", tab: first });
    app.take({ op: "popup", tab: "t-orphan", from: first, url: "about:blank" });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(app.sent.some((m) => m.op === "close" && m.tab === "t-orphan"));
  });

  // (fails before: yes — the switch was read when the session opened, and Stop reached none of the call)
  test("a coding agent's call: refused once the chat's switch is off; Stop — its turn's end, or the agent letting go — reaches the call", async () => {
    const app = perTab();
    const browsers = createBrowsers({ host: app.host });
    let on = false;
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: createAgentTurns(), subagents: () => null, membersOf: () => null, browsers: () => browsers, browserOn: () => on });
    /** @param {any} [o] @returns {any} */
    const ctx = (o = {}) => ({ cwd: ".", upstream: "claude", chain: "c1", turn: "t1", graph: false, browser: true, permit: async () => ({ asked: false }), judgeNow: () => "run", ...o });
    assert.deepEqual(await tools.call("browser", { action: "snapshot" }, ctx()), { text: "Not run: the person switched the browser off for this chat. Carry on without it.", isError: true });
    on = true;
    const stop = new AbortController();
    stop.abort(new Error("stopped"));
    const out = await tools.call("browser", { action: "batch", steps: [{ action: "navigate", url: "https://shop.test/" }, CLICK] }, ctx({ signal: stop.signal }));
    assert.equal(out.text, "Stopped before step 1.");
    assert.equal(app.sent.some((m) => m.method === "Page.navigate"), false);
    // Over Filament's MCP server the call's signal is its turn's end, and its request's.
    /** @type {AbortSignal | null} */
    let seen = null;
    const turn = new LiveTurn();
    const srv = new McpToolServer({
      bridge: /** @type {any} */ ({ contextForMcpToken: () => ({ conv: null, turn, cwd: "C:/p", upstream: { id: "claude", acp: {} }, native: false, chain: "c1", graph: false, browser: true }) }),
      tools: /** @type {any} */ ({ memoryOn: () => false, list: () => [], has: (/** @type {string} */ n) => n === "browser", call: async (/** @type {any} */ _n, /** @type {any} */ _a, /** @type {any} */ c) => ((seen = c.signal), { text: "ok" }) }),
    });
    const res = { writeHead() {}, end() {} };
    await srv.handle(/** @type {any} */ ({ method: "POST" }), /** @type {any} */ (res), "tok", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "browser", arguments: { action: "snapshot" } } }));
    assert.equal(/** @type {any} */ (seen)?.aborted, false);
    turn.finish(null, null);
    assert.equal(/** @type {any} */ (seen)?.aborted, true, "the turn's end aborts it");
  });
});
