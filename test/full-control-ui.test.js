// @ts-check
// Full control's switches (the owner's YOLO mode of 11-09, fc-ui). On the machine worked on, Settings › Remote access ›
// Machines: a machine's card, its line on this machine has a Full control pill, still until Agents is on, asking first before
// it goes on; while it is on, Without asking and Coding agents show on, and still: it holds them. In the desktop app, on
// each other machine's line: a Full control pill, still until Agents is on there, asking first, which Electron main
// switches as that device's grant `full` there with the window's sign-in (lib/machine-agents.js `full`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { renderRemote, fullConfirmWords, fullLabel, fullWords } from "../src/ui/harness/settings/remote.js";
import { createMachines } from "../src/services/machines/index.js";
import { createMachineAgents } from "../desktop/lib/machine-agents.js";

const T0 = Date.parse("2026-11-09T12:00:00Z");
const PRINT = `${"AB:".repeat(31)}CD`;
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
/** A pill by what it says to a screen reader. @param {any} el @param {string} aria */
const pillOf = (el, aria) => {
  const b = every(el, (n) => hasClass(n, "rset-pill")).find((n) => n.attrs["aria-label"] === aria);
  assert.ok(b, `a pill "${aria}"`);
  return b;
};

// ---- a machine on this one ---------------------------------------------------------------------------------------

/** Another machine's agents' device, its grants given. @param {Record<string, boolean>} grants */
const agentsDevice = (grants) => ({ id: "d-agents", name: "Filament agents on Laptop", scope: "agent", kind: "agents", of: "d-laptop", grants: { agents: false, models: false, browser: false, unasked: false, codingAgents: false, full: false, ...grants }, createdAt: T0, lastSeenAt: null, lastSeenFrom: null, revokedAt: null });
const FULL_DEVICE = { id: "d-laptop", name: "Laptop", scope: "full", kind: "browser", grants: { agents: false, models: false, browser: false, unasked: false, codingAgents: false, full: false }, createdAt: T0 - 9, lastSeenAt: T0, lastSeenFrom: "192.168.1.9", revokedAt: null };
const FULL = "Full control: its agents act here as you (Filament agents on Laptop)";
const ASK = "May run without asking (Filament agents on Laptop)";
const CODERS = "May use coding agents here (Filament agents on Laptop)";

/**
 * The page on this machine over scripted routes: its device list, a grant PATCHed as the server keeps it; the confirm
 * answers `yes` and says what it was asked. @param {any} agents @param {boolean} yes
 */
async function devicesPage(agents, yes) {
  let devices = [agents, FULL_DEVICE];
  /** @type {[string, string, any][]} */
  const sent = [];
  /** @type {any[]} */
  const asked = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    const method = init.method || "GET";
    sent.push([method, path, init.body]);
    if (path === "/schema") return { config: {} };
    if (path === "/state") return { version: "9.9.9", machine: { id: "m-1", name: "Mac mini" }, viewer: "local", device: null, config: {} };
    if (path === "/remote/devices") return structuredClone({ devices, pending: [] });
    const one = /^\/remote\/devices\/([^?]+)$/.exec(path);
    if (one && method === "PATCH") {
      const id = decodeURIComponent(one[1]);
      devices = devices.map((d) => (d.id === id ? { ...d, grants: { ...d.grants, ...init.body.grants } } : d));
      return { device: structuredClone(devices.find((d) => d.id === id)) };
    }
    throw Object.assign(new Error(`no route ${method} ${path}`), { status: 404, body: { error: `no route ${path}` } });
  };
  const body = /** @type {any} */ (fakeH("div", {}));
  const confirm = async (/** @type {any} */ o) => (asked.push(o), yes);
  renderRemote(body, { onToast: () => {} }, { h: fakeH, api, copy: async () => {}, confirm, now: () => T0, every: () => () => {}, go: () => {}, app: null });
  await settle();
  return { body, patches: () => sent.filter(([m]) => m === "PATCH"), asked };
}

// (fails before: yes — no Full control pill: their device's grant `full` had no switch here)
test("a machine on this one: Full control waits for Agents, asks first, PATCHes `full` alone, and then shows Without asking and Coding agents on and still", async () => {
  const off = await devicesPage(agentsDevice({ agents: false }), true);
  const waits = pillOf(off.body, FULL);
  assert.equal(textOf(waits), "Full control");
  assert.deepEqual([waits.attrs.disabled, waits.attrs["aria-pressed"]], ["", "false"], "still until Agents is on");
  assert.match(waits.attrs.title, /Turn on Agents first\.$/);

  const no = await devicesPage(agentsDevice({ agents: true }), false);
  assert.equal(pillOf(no.body, FULL).attrs.disabled, undefined);
  pillOf(no.body, FULL).attrs.onclick();
  await settle();
  assert.equal(no.asked.length, 1);
  assert.deepEqual([no.asked[0].title, no.asked[0].description, no.asked[0].confirmLabel], ["Full control for Laptop?", fullConfirmWords("Laptop's agents", "this machine"), "Switch on"], "named for its machine, as its card is");
  assert.match(no.asked[0].description, /can read and change whatever your account on this machine can, Filament's own keys and settings among it, and what it changes stays when you switch Full control off\. Switch it on only for a machine of yours\./);
  assert.deepEqual(no.patches(), [], "declined: nothing PATCHed");

  const yes = await devicesPage(agentsDevice({ agents: true }), true);
  pillOf(yes.body, FULL).attrs.onclick();
  await settle();
  assert.deepEqual(yes.patches(), [["PATCH", "/remote/devices/d-agents", { grants: { full: true } }]]);
  assert.equal(pillOf(yes.body, FULL).attrs["aria-pressed"], "true");
  for (const held of [ASK, CODERS]) {
    const p = pillOf(yes.body, held);
    assert.deepEqual([p.attrs["aria-pressed"], p.attrs.disabled], ["true", ""], held);
    assert.match(p.attrs.title, /On while Full control is on\.$/, held);
    assert.ok(hasClass(p, "is-held") && every(p, (n) => hasClass(n, "rset-pill-lock")).length === 1, `${held}: a lock after its name, never dimmed as one switched off`);
  }
  assert.match(textOf(yes.body), /Full control: Laptop's agents act here as you, in any folder, without asking\./, "said on its line while it is on");
  // Off, at once: no ask.
  pillOf(yes.body, FULL).attrs.onclick();
  await settle();
  assert.equal(yes.asked.length, 1);
  assert.deepEqual(yes.patches().at(-1), ["PATCH", "/remote/devices/d-agents", { grants: { full: false } }]);
  assert.deepEqual([ASK, CODERS].map((a) => [pillOf(yes.body, a).attrs["aria-pressed"], pillOf(yes.body, a).attrs.disabled]), [["false", undefined], ["false", undefined]], "their own pills again");
});

// ---- the app's other machines -----------------------------------------------------------------------------------

/** A device a machine lists, its grants given. @param {string} id @param {Record<string, boolean>} grants */
const listed = (id, grants) => ({ id, name: "Filament agents on Laptop", scope: "agent", kind: "agents", of: "d-window", grants: { agents: false, models: false, browser: false, full: false, ...grants }, createdAt: T0, lastSeenAt: null, lastSeenFrom: null, revokedAt: null });

/**
 * A machine's admin API as main reaches it, scripted: `/remote/me` as a full device's, its device list, a grant PATCHed
 * as the server keeps it — `full` refused without `agents`, as the server refuses it. @param {any[]} devices
 */
function scripted(devices) {
  /** @type {[string, string, any][]} */
  const calls = [];
  /** @param {number} status @param {any} json */
  const answer = (status, json) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = /** @type {typeof fetch} */ (
    async (u, init = {}) => {
      const method = init.method || "GET";
      const path = new URL(String(u)).pathname.replace(/^\/api/, "");
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push([method, path, body]);
      if (path === "/remote/me") return answer(200, { who: "device", device: { id: "d-window", scope: "full" }, machine: { id: "m-mac", name: "Mac mini" } });
      if (path === "/remote/devices") return answer(200, { devices });
      const one = /^\/remote\/devices\/(.+)$/.exec(path);
      const d = one ? devices.find((x) => x.id === decodeURIComponent(one[1])) : null;
      if (one && !d) return answer(404, { error: "no such device" });
      if (d && method === "PATCH") {
        if (body.grants.full === true && d.grants.agents !== true) return answer(400, { error: `Full control is on top of Agents: switch Agents on for ${d.name} first, then Full control` });
        Object.assign(d.grants, body.grants);
        return answer(200, { device: d });
      }
      return answer(404, { error: `no route ${path}` });
    }
  );
  return { fetchImpl, calls, devices };
}

/** The flow over a scripted machine, its agents' device kept here where `kept` names it. @param {import("node:test").TestContext} t @param {ReturnType<typeof scripted>} there @param {string | null} kept */
const flowOver = (t, there, kept) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-full-ui-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createMachines({ dataDir: dir });
  if (kept) store.keep({ url: "https://192.0.2.9:20343", fingerprint: PRINT, machine: { id: "m-mac", name: "Mac mini" }, device: { id: kept, name: "Filament agents on Laptop", scope: "agent" }, token: "fdt_kept" });
  return createMachineAgents({
    machines: () => [{ id: "m-mac", name: "Mac mini", routes: [{ kind: "lan", url: "https://192.0.2.9:20343", fingerprint: PRINT }], partition: "persist:machine-m-mac", addedAt: T0 }],
    cookieOf: async (partition) => `__Host-filament_device=cookie-of-${partition}`,
    store,
    pick: async (m) => ({ route: m.routes[0], name: m.name, version: "9", tried: [] }),
    fetchOf: () => there.fetchImpl,
  });
};

// (fails before: yes — the flow had no `full`, and its rows said nothing of the grant)
test("main's Full control switch: on PATCHes the agents' device's grant `full` alone there, off PATCHes it false; the list carries it; refused without Agents, and said where no device is kept", async (t) => {
  const there = scripted([listed("d-agents", { agents: true })]);
  const flow = flowOver(t, there, "d-agents");
  assert.equal((await flow.list())[0].full, false);
  const on = await flow.full("m-mac", true);
  assert.deepEqual([on.on, on.full, on.said], [true, true, undefined]);
  assert.deepEqual(there.calls.filter(([m]) => m === "PATCH"), [["PATCH", "/remote/devices/d-agents", { grants: { full: true } }]]);
  assert.equal((await flow.list())[0].full, true, "read from the device list there");
  const off = await flow.full("m-mac", false);
  assert.deepEqual([off.on, off.full], [true, false]);

  const bare = scripted([listed("d-agents", { agents: false })]);
  const refused = await flowOver(t, bare, "d-agents").full("m-mac", true);
  assert.deepEqual([refused.failed, refused.full], [true, false]);
  assert.match(String(refused.said), /^Not switched on: Full control is on top of Agents/);

  const unkept = await flowOver(t, scripted([]), null).full("m-mac", true);
  assert.match(String(unkept.said), /^Not switched on: this Filament's agents have no device on Mac mini yet\. Let them work there first, and Full control can be switched on there\.$/);
});

/**
 * The page in the app over the bridge: the machines main would answer; the confirm answers `yes`.
 * @param {any[]} rows @param {boolean} yes
 */
async function machinesPage(rows, yes) {
  /** @type {any[][]} */
  const bridge = [];
  /** @type {any[]} */
  const asked = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    if (path === "/schema") return { config: {} };
    if (path === "/state") return { version: "9.9.9", machine: { id: "m-here", name: "Laptop" }, viewer: "local", device: null, config: {} };
    if (path === "/remote/devices") return { devices: [], pending: [] };
    if (path === "/upstreams") return { version: 3, upstreams: [] };
    throw Object.assign(new Error(`no route ${init.method || "GET"} ${path}`), { status: 404, body: { error: `no route ${path}` } });
  };
  const app = {
    addMachine: () => {},
    agentMachines: async () => ({ machines: structuredClone(rows) }),
    agentsOn: async (/** @type {string} */ id, /** @type {boolean} */ on) => ({ ...rows.find((x) => x.id === id), on }),
    agentsModels: async (/** @type {string} */ id, /** @type {boolean} */ on) => ({ ...rows.find((x) => x.id === id), models: on }),
    agentsFull: async (/** @type {string} */ id, /** @type {boolean} */ on) => (bridge.push(["full", id, on]), { ...rows.find((x) => x.id === id), full: on }),
    agentsForget: async (/** @type {string} */ id) => ({ ...rows.find((x) => x.id === id), on: false, kept: false }),
  };
  const body = /** @type {any} */ (fakeH("div", {}));
  const confirm = async (/** @type {any} */ o) => (asked.push(o), yes);
  renderRemote(body, { onToast: (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => void toasts.push([msg, kind]) }, { h: fakeH, api, copy: async () => {}, confirm, now: () => T0, every: () => () => {}, go: () => {}, app });
  await settle();
  return { body, bridge, asked, toasts };
}

const MAC = { id: "m-mac", name: "Mac mini", on: true, models: false, full: false, kept: true, ready: true, words: null };

// (fails before: yes — the other machines' lines had no Full control)
test("the app's other machines: Full control waits for Agents there, asks first, switches the grant there by the app, and goes off without asking", async () => {
  const waits = await machinesPage([{ ...MAC, on: false, kept: false }], true);
  const still = pillOf(waits.body, fullLabel("Mac mini"));
  assert.deepEqual([textOf(still), still.attrs.disabled, still.attrs["aria-pressed"]], ["Full control", "", "false"]);
  assert.match(still.attrs.title, /^Press Agents first: Full control is on top of it\./);

  const no = await machinesPage([MAC], false);
  assert.equal(pillOf(no.body, fullLabel("Mac mini")).attrs.title, fullWords("Mac mini"));
  pillOf(no.body, fullLabel("Mac mini")).attrs.onclick();
  await settle();
  assert.deepEqual([no.asked[0]?.title, no.asked[0]?.description], ["Full control on Mac mini?", fullConfirmWords("This Filament's agents", "Mac mini")]);
  assert.deepEqual(no.bridge, [], "declined: nothing switched");

  const yes = await machinesPage([MAC], true);
  pillOf(yes.body, fullLabel("Mac mini")).attrs.onclick();
  await settle();
  assert.deepEqual(yes.bridge, [["full", "m-mac", true]]);
  assert.equal(pillOf(yes.body, fullLabel("Mac mini")).attrs["aria-pressed"], "true");
  assert.deepEqual(yes.toasts.at(-1), ["This Filament's agents act on Mac mini as you", undefined]);
  assert.match(textOf(yes.body), /Full control: this machine's agents act on Mac mini as you, in any folder, without asking\./, "said on its line while it is on");
  pillOf(yes.body, fullLabel("Mac mini")).attrs.onclick();
  await settle();
  assert.equal(yes.asked.length, 1, "off asks nothing");
  assert.deepEqual(yes.bridge.at(-1), ["full", "m-mac", false]);
  assert.equal(pillOf(yes.body, fullLabel("Mac mini")).attrs["aria-pressed"], "false");
});
