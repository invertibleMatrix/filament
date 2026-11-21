// @ts-check
// Settings › Remote access › Machines in the desktop app (b-remote): on each machine's card, its line "What this machine may do on
// <machine>" has a Browser pill, "Let <machine> use this app's browser" — off at first, switched by the app
// (harness-preload.cjs `filamentApp.browserOn`), which keeps it in its own machines.json and makes or lets go the link;
// its link's state a dot on the pill, its words in the pill's title, a refusal said on the line. Switched on where this
// app is a full device there and the machine answers, as the Agents pill is; switched off at any time. What it does said
// whole in its title. Agents, Models and Forget, whose answers carry no browser switch, leave it and its dot as they
// are. A browser, and another machine's page, show nothing new.
// (fails before: yes — the page had no switch for another machine's chats' browser)
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { renderRemote, browserLabel, browserWords } from "../src/ui/harness/settings/remote.js";

const T0 = Date.parse("2026-11-08T12:00:00Z");
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
/** Every node under `el` a test picks. @param {any} el @param {(n: any) => boolean} pick @returns {any[]} */
const every = (el, pick) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (pick(n)) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
/** @param {any} n @param {string} cls */
const hasClass = (n, cls) => String(n.attrs?.class || "").split(/\s+/).includes(cls);
/** The machines' cards, by their names. @param {any} el */
const names = (el) => every(el, (n) => hasClass(n, "rset-card-name")).map((n) => textOf(n));
/** A machine's line "What this machine may do on <name>". @param {any} el @param {string} name */
const itemOf = (el, name) => {
  const r = every(el, (n) => hasClass(n, "rset-item")).find((n) => textOf(every(n, (k) => hasClass(k, "rset-name"))[0]) === `What this machine may do on ${name}`);
  assert.ok(r, `an item "${name}" in: ${names(el).join(", ")}`);
  return r;
};
/** The pills under `el`. @param {any} el */
const pills = (el) => every(el, (n) => hasClass(n, "rset-pill"));
/** A machine's pill by what it says to a screen reader, none where it has none. @param {any} el @param {string} aria */
const pillOf = (el, aria) => pills(el).find((n) => n.attrs["aria-label"] === aria) ?? null;
/** The dot on a pill: its state, none where it has none. @param {any} pill */
const dotOf = (pill) => every(pill, (n) => hasClass(n, "rset-dot"))[0]?.attrs.class.replace(/^rset-dot is-/, "") ?? null;

/** The page, its devices none, the app's bridge as given. @param {{ app?: any, state?: Record<string, any> }} [o] */
async function open(o = {}) {
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** This Filament's upstreams of other machines' models, as Models adds and removes them. @type {any[]} */
  let ups = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    const method = init.method || "GET";
    if (path === "/schema") return { config: {} };
    if (path === "/state") return { version: "9.9.9", machine: { id: "m-1", name: "Laptop" }, viewer: "local", device: null, config: {}, ...(o.state || {}) };
    if (path === "/remote/devices") return { devices: [], pending: [] };
    if (path === "/upstreams" && method === "GET") return { upstreams: structuredClone(ups) };
    if (path === "/upstreams" && method === "POST") {
      const u = { id: "mac-mini", name: "Mac mini", type: "filament", machine: init.body.machine };
      ups.push(u);
      return { upstream: u };
    }
    const one = /^\/upstreams\/([^?]+)$/.exec(path);
    if (one && method === "DELETE") {
      ups = ups.filter((u) => u.id !== decodeURIComponent(one[1]));
      return { removed: decodeURIComponent(one[1]) };
    }
    throw Object.assign(new Error(`no route ${path}`), { status: 404, body: { error: `no route ${path}` } });
  };
  const body = /** @type {any} */ (fakeH("div", {}));
  renderRemote(body, { onToast: (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => void toasts.push([msg, kind]) }, {
    h: fakeH,
    api,
    copy: async () => {},
    confirm: async () => true,
    now: () => T0,
    every: () => () => {},
    go: () => {},
    app: o.app ?? null,
  });
  await settle();
  return { body, toasts };
}

/**
 * The app's bridge over rows main would answer, each with its browser switch: its calls recorded.
 * @param {any[]} rows @param {{ on?: (id: string, on: boolean) => any, hosts?: boolean }} [o]
 */
const bridge = (rows, o = {}) => {
  /** @type {any[][]} */
  const calls = [];
  let list = structuredClone(rows);
  /** @type {any} */
  const app = {
    addMachine: () => {},
    agentMachines: async () => ({ machines: structuredClone(list) }),
    agentsOn: async () => null,
  };
  if (o.hosts !== false)
    app.browserOn = async (/** @type {string} */ id, /** @type {boolean} */ on) => {
      calls.push(["browser", id, on]);
      const x = list.find((y) => y.id === id);
      const got = o.on ? o.on(id, on) : { id, browser: on, browserLink: on ? "connecting" : "off", browserWords: on ? `Connecting to ${x.name}…` : null, said: on ? `The agent's pages for your chats on ${x.name} open in this app` : `The agent's pages for your chats on ${x.name} no longer open in this app` };
      list = list.map((y) => (y.id === id ? { ...y, ...got } : y));
      return got;
    };
  return { calls, app };
};

const MAC = { id: "m-mac", name: "Mac mini", on: false, kept: false, ready: true, words: null, browser: false, browserLink: "off", browserWords: null };
const BOX = { id: "m-box", name: "Build box", on: false, kept: false, ready: false, words: "This app reaches Build box through an SSH tunnel alone, where it is no paired device: turn on Reach this machine on my network or Share on my tailnet there, and add it again by the link it shows.", browser: false, browserLink: "off", browserWords: null };

test("each other machine's line with its Browser pill, off at first; a press sends it to the app, the outcome said and the link's state drawn; off again at a press", async () => {
  const b = bridge([MAC, BOX]);
  const p = await open({ app: b.app });
  assert.deepEqual(names(p.body), ["Mac mini", "Build box"]);
  assert.equal(browserLabel("Mac mini"), "Let Mac mini use this app's browser");
  const pill = pillOf(itemOf(p.body, "Mac mini"), "Let Mac mini use this app's browser");
  assert.equal(pill.attrs.title, browserWords("Mac mini"), "its whole meaning in its title");
  assert.match(browserWords("Mac mini"), /^Web pages agents open for your chats on Mac mini show in this app, signed in to nothing of yours, where you watch them and take them over\. Off, they open in Chrome on Mac mini\.$/);
  assert.deepEqual([textOf(pill), pill.attrs["aria-pressed"], pill.attrs.disabled ?? null, dotOf(pill)], ["Browser", "false", null, null]);

  pill.attrs.onclick();
  await settle();
  assert.deepEqual(b.calls, [["browser", "m-mac", true]]);
  assert.deepEqual(p.toasts.at(-1), ["The agent's pages for your chats on Mac mini open in this app", undefined]);
  const on = pillOf(p.body, "Let Mac mini use this app's browser");
  assert.equal(on.attrs["aria-pressed"], "true");
  assert.equal(dotOf(on), "wait", "its link's state: connecting");
  assert.match(on.attrs.title, /Connecting to Mac mini…$/, "said in its pill's title");
  assert.doesNotMatch(textOf(itemOf(p.body, "Mac mini")), /Connecting/, "its line keeps to what to do");
  assert.equal(pillOf(p.body, "Let this Filament's agents work on Mac mini").attrs["aria-pressed"], "false", "the Agents pill untouched");

  on.attrs.onclick();
  await settle();
  assert.deepEqual(b.calls.at(-1), ["browser", "m-mac", false]);
  assert.deepEqual(p.toasts.at(-1), ["The agent's pages for your chats on Mac mini no longer open in this app", undefined]);
  assert.equal(pillOf(p.body, "Let Mac mini use this app's browser").attrs["aria-pressed"], "false");
  assert.doesNotMatch(textOf(itemOf(p.body, "Mac mini")), /Connecting/);
});

test("where this app is no full device there — an SSH tunnel alone —: the pill stays off, said why; one on, refused there, says so and still switches off", async () => {
  const refused = { ...MAC, ready: false, words: "Mac mini does not know this app's sign-in any more.", browser: true, browserLink: "refused", browserWords: "Mac mini does not know this app's sign-in any more — revoked there, or signed out: pair it again with Add a machine and a code from its Settings › Remote access." };
  const b = bridge([refused, BOX]);
  const p = await open({ app: b.app });
  const box = pillOf(p.body, "Let Build box use this app's browser");
  assert.equal(box.attrs.disabled, "", "no way to switch it on");
  assert.match(textOf(itemOf(p.body, "Build box")), /through an SSH tunnel alone, where it is no paired device/);
  assert.match(box.attrs.title, /through an SSH tunnel alone/, "its title says why");
  const mac = pillOf(p.body, "Let Mac mini use this app's browser");
  assert.equal(mac.attrs["aria-pressed"], "true");
  assert.equal(mac.attrs.disabled ?? null, null, "on: it always switches off");
  assert.equal(dotOf(mac), "bad");
  assert.match(textOf(itemOf(p.body, "Mac mini")), /revoked there, or signed out: pair it again/);
  mac.attrs.onclick();
  await settle();
  assert.deepEqual(b.calls, [["browser", "m-mac", false]]);
});

test("an outcome that went wrong is said as the app said it", async () => {
  const b = bridge([MAC], { on: (id) => ({ id, browser: false, browserLink: "off", browserWords: "This window keeps no such machine now: open Settings › Remote access again.", said: "No such machine in this window", failed: true }) });
  const p = await open({ app: b.app });
  pillOf(p.body, "Let Mac mini use this app's browser").attrs.onclick();
  await settle();
  assert.deepEqual(p.toasts.at(-1), ["No such machine in this window", "err"]);
  assert.equal(pillOf(p.body, "Let Mac mini use this app's browser").attrs["aria-pressed"], "false");
});

// (fails before: yes — the app's answer to Agents, Models and Forget carries no browser switch, and the machine's row was
// taken whole from it: the Browser pill showed off, its dot gone, while the app kept the link on)
test("Agents, Models and Forget keep the Browser pill's state and its dot: the app's answer to each says nothing of the browser", async () => {
  const linked = { ...MAC, on: true, models: false, kept: true, browser: true, browserLink: "connected", browserWords: "The agent's pages for your chats on Mac mini open in this app." };
  const b = bridge([linked]);
  /** The machine as main answers Agents, Models and Forget (machine-agents.js `AgentsRow`): no browser switch in it. @param {any} o */
  const row = (o) => ({ id: "m-mac", name: "Mac mini", on: true, models: false, kept: true, ready: true, words: null, ...o });
  b.app.agentsOn = async (/** @type {string} */ _id, /** @type {boolean} */ on) => row({ on });
  // It stops answering as Models is switched: Forget shows on its line.
  b.app.agentsModels = async (/** @type {string} */ _id, /** @type {boolean} */ on) => row({ models: on, ready: false, away: "quiet", words: "Mac mini does not answer." });
  b.app.agentsForget = async () => row({ on: false, models: false, kept: false, said: "Forgotten here, and revoked on Mac mini" });
  const p = await open({ app: b.app });
  const browser = () => pillOf(p.body, "Let Mac mini use this app's browser");
  const kept = () => [browser().attrs["aria-pressed"], dotOf(browser()), /open in this app\./.test(browser().attrs.title)];
  assert.deepEqual(kept(), ["true", "ok", true]);

  pillOf(p.body, "Let this Filament's agents work on Mac mini").attrs.onclick();
  await settle();
  assert.equal(pillOf(p.body, "Let this Filament's agents work on Mac mini").attrs["aria-pressed"], "false", "Agents switched off");
  assert.deepEqual(kept(), ["true", "ok", true], "after Agents");

  pillOf(p.body, "Use Mac mini's models in this Filament's chats").attrs.onclick();
  await settle();
  assert.equal(pillOf(p.body, "Use Mac mini's models in this Filament's chats").attrs["aria-pressed"], "true", "Models switched on");
  assert.deepEqual(kept(), ["true", "ok", true], "after Models");

  every(itemOf(p.body, "Mac mini"), (n) => n.attrs?.["aria-label"] === "Forget this Filament's agents on Mac mini")[0].attrs.onclick();
  await settle();
  assert.deepEqual(p.toasts.at(-1), ["Forgotten here, and revoked on Mac mini", undefined]);
  assert.deepEqual(kept(), ["true", "ok", true], "after Forget");
  assert.deepEqual(b.calls, [], "the browser's switch never asked");
});

test("an app that lends no browser, a browser, and another machine's page: no Browser pill", async () => {
  const older = await open({ app: bridge([MAC], { hosts: false }).app });
  assert.ok(pillOf(older.body, "Let this Filament's agents work on Mac mini"));
  assert.equal(pillOf(older.body, "Let Mac mini use this app's browser"), null, "an app with no browserOn");
  assert.doesNotMatch(textOf(older.body), /Browser: /, "nor said over the list");
  assert.equal(pills((await open()).body).length, 0, "a browser has no app");
  const far = await open({ app: bridge([MAC]).app, state: { viewer: "remote", device: { id: "d9", name: "Laptop", scope: "full" } } });
  assert.equal(pills(far.body).length, 0, "another machine's page drives no window of this one's");
});

// (fails before: yes — the owner's of 11-09: a press drew Connecting… and it stayed so, the link up 34 ms later, until
// Settings was opened again)
test("a link's state as it moves is said on its machine's line, without the page read again; a machine not listed is left; a page left stops hearing it", async () => {
  const b = bridge([MAC, BOX]);
  /** @type {((row: any) => void)[]} */
  const hears = [];
  let unheard = 0;
  b.app.onBrowserLink = (/** @type {(row: any) => void} */ fn) => (hears.push(fn), () => void unheard++);
  const p = await open({ app: b.app });
  assert.equal(hears.length, 1, "heard from the start");
  pillOf(itemOf(p.body, "Mac mini"), "Let Mac mini use this app's browser").attrs.onclick();
  await settle();
  assert.equal(dotOf(pillOf(p.body, "Let Mac mini use this app's browser")), "wait");
  hears[0]({ id: "m-mac", browser: true, browserLink: "connected", browserWords: "Connected: the agent's pages for your chats on Mac mini open in this app." });
  await settle();
  const on = pillOf(p.body, "Let Mac mini use this app's browser");
  assert.equal(dotOf(on), "ok", "connected");
  assert.match(on.attrs.title, /Connected: the agent's pages for your chats on Mac mini open in this app\.$/);
  assert.doesNotMatch(on.attrs.title, /Connecting to/);
  assert.equal(on.attrs["aria-pressed"], "true");
  hears[0]({ id: "m-gone", browser: true, browserLink: "connected", browserWords: "Connected." });
  await settle();
  assert.deepEqual(names(p.body), ["Mac mini", "Build box"], "one not listed: nothing added");
  /** @type {any} */ (p.body).isConnected = false;
  hears[0]({ id: "m-mac", browser: true, browserLink: "connecting", browserWords: "Connecting to Mac mini…" });
  assert.equal(unheard, 1, "the page left: no longer heard");
});
