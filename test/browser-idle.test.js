// @ts-check
// A chat's tab nobody has used for half an hour closes (app/browser/registry.js `TAB_IDLE_MS`): the app parks each page
// in a hidden window that keeps it drawing and running its timers, so a page left open there ran at full rate for as
// long as Filament did. It closes as an agent's close does — the app told, the pane's read without it, its agent told
// at its next call — but never while its chat's agents work, while the person holds the browser, or while it is the
// tab a pane shows; an agent's command, the person's act and a pane's read each start its half hour again.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createBrowserHost } from "../src/app/browser/host.js";
import { IDLE_SWEEP_MS, TAB_IDLE_MS, createBrowsers } from "../src/app/browser/registry.js";

const MIN = 60_000;
const settle = () => new Promise((r) => setTimeout(r, 20));

/** A stand-in for the app: every tab's commands answered as a page on shop.test would. */
function fakeApp() {
  const host = createBrowserHost();
  /** @type {any[]} */
  const sent = [];
  /** @type {(m: any) => void} */
  let take = () => {};
  const link = {
    send: (/** @type {any} */ m) => {
      sent.push(m);
      setTimeout(() => {
        if (m.op !== "cdp") return take({ n: m.n, ok: true, result: null });
        const p = m.params || {};
        if (m.method === "Page.getFrameTree") return take({ n: m.n, ok: true, result: { frameTree: { frame: { id: "F", url: "about:blank" } } } });
        if (m.method === "Page.navigate" || m.method === "Page.reload") {
          take({ n: m.n, ok: true, result: { loaderId: "L" } });
          for (const [method, params] of [["Page.frameNavigated", { frame: { id: "F", url: p.url || "https://shop.test/login" } }], ["Page.loadEventFired", {}]]) take({ op: "event", tab: m.tab, method, params });
          return;
        }
        if (m.method === "Runtime.evaluate") return take({ n: m.n, ok: true, result: { result: { value: ["https://shop.test/login", "Shop"] } } });
        if (m.method === "Accessibility.getFullAXTree") return take({ n: m.n, ok: true, result: { nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Shop" }, childIds: [] }] } });
        take({ n: m.n, ok: true, result: {} });
      }, 1);
    },
    close: () => {},
  };
  take = host.attach(link);
  return { host, sent };
}

/** A registry over a fake app, its clock and its chat's work in the test's hands. */
function setUp() {
  const app = fakeApp();
  const clock = { t: 0, busy: false };
  const browsers = createBrowsers({ host: app.host, now: () => clock.t, working: () => clock.busy });
  return { app, clock, browsers };
}

/** The tabs the app was told to close. @param {{ sent: any[] }} app */
const closed = (app) => app.sent.filter((m) => m.op === "close").map((m) => m.tab);

describe("a tab nobody uses", () => {
  test("half an hour and a minute's look", () => {
    assert.equal(TAB_IDLE_MS, 30 * MIN);
    assert.equal(IDLE_SWEEP_MS, MIN);
  });

  test("closes once unused for 30 minutes, the app told; its agent hears it at its next call, and a sub-agent of its own", async () => {
    const { app, clock, browsers } = setUp();
    await browsers.call("c1", { action: "navigate", url: "shop.test/login", snapshot: false });
    await browsers.call("c1", { action: "navigate", url: "shop.test/login", snapshot: false }, { seat: { id: "sa_1", name: "Scout" } });
    const [mine, scouts] = (await browsers.stateOf("c1")).tabs.map((/** @type {any} */ t) => t.id);
    clock.t = 30 * MIN - 1;
    browsers.sweep();
    await settle();
    assert.deepEqual(closed(app), [], "a moment short of the half hour: kept");
    clock.t = 30 * MIN;
    browsers.sweep();
    await settle();
    assert.deepEqual(closed(app).sort(), [mine, scouts].sort(), "both closed in the app");
    assert.deepEqual((await browsers.stateOf("c1")).tabs, [], "the pane reads them gone");
    const told = String(await browsers.call("c1", { action: "snapshot" }));
    assert.match(told, new RegExp(`^Tab ${mine} \\(https://shop\\.test/login\\) closed after 30 minutes unused, and what its page held went with it; sign-ins and cookies stay\\. Open it again if you still need it\\.\\n`));
    assert.ok(!told.includes(scouts), "the chat's agent hears of its own tab alone");
    const scoutTold = String(await browsers.call("c1", { action: "snapshot" }, { seat: { id: "sa_1", name: "Scout" } }));
    assert.match(scoutTold, new RegExp(`^Tab ${scouts} \\(https://shop\\.test/login\\) closed after 30 minutes unused`));
    assert.ok(!String(await browsers.call("c1", { action: "snapshot" })).includes("unused"), "said once");
    browsers.stop();
  });

  test("an agent whose first call after it fails — a click on a handle of the page that went — hears why its tab went", async () => {
    const { clock, browsers } = setUp();
    await browsers.call("c1", { action: "navigate", url: "shop.test/login", snapshot: false });
    const [mine] = (await browsers.stateOf("c1")).tabs.map((/** @type {any} */ t) => t.id);
    clock.t = 30 * MIN;
    browsers.sweep();
    await settle();
    await assert.rejects(
      browsers.call("c1", { action: "click", ref: "e12" }),
      (/** @type {any} */ e) => {
        assert.match(e.message, new RegExp(`^Tab ${mine} \\(https://shop\\.test/login\\) closed after 30 minutes unused[^\\n]*\\n`));
        assert.match(e.message, /no element e12 on the page now/);
        return true;
      },
    );
    assert.ok(!String(await browsers.call("c1", { action: "snapshot" })).includes("unused"), "said once, with the failure");
    browsers.stop();
  });

  test("stays while its chat's agents work, however long, and closes at the first look after they stop", async () => {
    const { app, clock, browsers } = setUp();
    await browsers.call("c1", { action: "navigate", url: "shop.test/login", snapshot: false });
    const [tab] = (await browsers.stateOf("c1")).tabs.map((/** @type {any} */ t) => t.id);
    clock.busy = true;
    clock.t = 90 * MIN;
    browsers.sweep();
    await settle();
    assert.deepEqual(closed(app), [], "the chat works: kept");
    clock.busy = false;
    browsers.sweep();
    await settle();
    assert.deepEqual(closed(app), [tab], "the work over: closed at once");
    browsers.stop();
  });

  test("stays while the person holds the browser", async () => {
    const { app, clock, browsers } = setUp();
    await browsers.call("c1", { action: "navigate", url: "shop.test/login", snapshot: false });
    await browsers.call("c1", { action: "tabs", op: "new", url: "shop.test/login" });
    await browsers.person("c1", { act: "take" });
    clock.t = 45 * MIN;
    browsers.sweep();
    await settle();
    assert.deepEqual(closed(app), [], "taken over: kept");
    // Given back: the tab shown is the person's act's, its half hour starting again; the other one closes.
    await browsers.person("c1", { act: "give" });
    const shown = browsers.shownTab("c1");
    browsers.sweep();
    await settle();
    assert.equal(closed(app).length, 1);
    assert.notEqual(closed(app)[0], shown);
    browsers.stop();
  });

  test("an agent's command, the person's act and a pane's read each start its half hour again", async () => {
    const { app, clock, browsers } = setUp();
    await browsers.call("c1", { action: "navigate", url: "shop.test/login", snapshot: false });
    const [tab] = (await browsers.stateOf("c1")).tabs.map((/** @type {any} */ t) => t.id);
    const look = async () => {
      browsers.sweep();
      await settle();
      return closed(app);
    };
    // The agent's command, at 20 minutes.
    clock.t = 20 * MIN;
    await browsers.call("c1", { action: "snapshot" });
    clock.t = 49 * MIN;
    assert.deepEqual(await look(), [], "29 minutes after the agent's command");
    // The person's reload from the pane, at 49.
    assert.deepEqual(await browsers.person("c1", { act: "reload" }), { ok: true });
    clock.t = 78 * MIN;
    assert.deepEqual(await look(), [], "29 minutes after the person's reload");
    // A pane's read, at 78.
    await browsers.stateOf("c1");
    clock.t = 107 * MIN;
    assert.deepEqual(await look(), [], "29 minutes after a pane read it");
    clock.t = 108 * MIN;
    assert.deepEqual(await look(), [tab], "30 minutes after: closed");
    browsers.stop();
  });

  test("the tab a page watches live stays while it watches; another tab of the chat closes; its half hour starts as the watcher goes", async () => {
    const { app, clock, browsers } = setUp();
    await browsers.call("c1", { action: "navigate", url: "shop.test/login", snapshot: false });
    await browsers.call("c1", { action: "tabs", op: "new", url: "shop.test/login" });
    const shown = browsers.shownTab("c1");
    const other = (await browsers.stateOf("c1")).tabs.map((/** @type {any} */ t) => t.id).find((/** @type {string} */ id) => id !== shown);
    const stopWatching = browsers.watch("c1", { frame: () => {}, state: () => {} });
    clock.t = 60 * MIN;
    browsers.sweep();
    await settle();
    assert.deepEqual(closed(app), [other], "the shown tab, watched, stays");
    stopWatching();
    clock.t = 89 * MIN;
    browsers.sweep();
    await settle();
    assert.deepEqual(closed(app), [other], "29 minutes after its last look while watched");
    clock.t = 90 * MIN;
    browsers.sweep();
    await settle();
    assert.deepEqual(closed(app), [other, shown]);
    browsers.stop();
  });

  test("the server asks whether a chat works by its turn and its sub-agents, and stops the look with Filament", () => {
    const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
    const made = server.slice(server.indexOf("const browsers = createBrowsers({"), server.indexOf("const pluginSources ="));
    assert.match(made, /working: \(chain\) => chatBusy\(chain\) \|\| subagents\.atWork\(\)\.includes\(String\(chain\)\)/);
    assert.match(server, /\n\s+browsers\.stop\(\);\n\s+browserHost\.stop\(\);/);
  });
});
