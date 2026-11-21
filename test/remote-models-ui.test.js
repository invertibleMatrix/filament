// @ts-check
// Another machine's models, switched on here and picked in the composer (the remote-agents plan's m-ui). In the desktop
// app, on each other machine's line, its Models pill, "Use <machine>'s models in this Filament's chats", pressed once
// this Filament's agents' device is kept there: Electron main switches that device's grant `models` there with the
// window's sign-in (lib/machine-agents.js `models`), and the page adds this Filament's upstream of them (POST
// /api/upstreams, type `filament`), or removes it — Forget removes it too. The pill is on where both are so, or where
// the grant cannot be read (the machine does not answer, nothing is kept there) and the upstream is here: a press takes
// it out, and a removal refused here moves nothing there. `/api/models` marks such a machine's rows with it, and why
// it is offline; the picker's tab for them is named for the machine with a dot, green or amber, the words why on its
// title and under its list — before its listing has any model too. The console offers no `filament` type to pick, and
// shows one read-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { startApp } from "./helpers/app.js";
import { renderRemote, modelsLabel, modelsWords } from "../src/ui/harness/settings/remote.js";
import { createMachines } from "../src/services/machines/index.js";
import { createMachineAgents } from "../desktop/lib/machine-agents.js";
import { bindUi, state as runtimeState } from "../src/ui/runtime.js";
import { upstreams as upstreamsPage } from "../src/ui/pages/destinations.js";
import { fmt } from "../src/ui/lib/format.js";

const T0 = Date.parse("2026-11-08T12:00:00Z");
const PRINT = `${"AB:".repeat(31)}CD`;
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
/** A data folder of its own, removed after. @param {import("node:test").TestContext} t */
const folder = (t) => {
  const d = mkdtempSync(join(tmpdir(), "filament-models-ui-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
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
const labels = (/** @type {any} */ el) => every(el, (n) => hasClass(n, "settings-row-label")).map((n) => textOf(n));
/** A pill by what it says to a screen reader. @param {any} el @param {string} aria */
const pillOf = (el, aria) => {
  const b = every(el, (n) => hasClass(n, "rset-pill")).find((n) => n.attrs["aria-label"] === aria);
  assert.ok(b, `a pill "${aria}"`);
  return b;
};
/** A listed machine by its name. @param {any} el @param {string} name */
const itemOf = (el, name) => {
  const r = every(el, (n) => hasClass(n, "rset-item")).find((n) => textOf(every(n, (k) => hasClass(k, "rset-name"))[0]) === name);
  assert.ok(r, `an item "${name}"`);
  return r;
};

// ---- main's flow ------------------------------------------------------------------------------------------------

/** A device a machine lists, its grants given. @param {string} id @param {Record<string, boolean>} grants */
const device = (id, grants) => ({ id, name: "Filament agents on Laptop", scope: "agent", kind: "agents", of: "d-window", grants: { agents: false, models: false, browser: false, ...grants }, createdAt: T0, lastSeenAt: null, lastSeenFrom: null, revokedAt: null });

/**
 * A machine's admin API as main reaches it, scripted: `/remote/me` as a full device's, its device list, a grant PATCHed
 * as the server keeps it; every call recorded with the Cookie and the body it carried.
 * @param {any[]} devices
 */
function scripted(devices) {
  /** @type {[string, string, string, any][]} */
  const calls = [];
  /** @param {number} status @param {any} json */
  const answer = (status, json) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = /** @type {typeof fetch} */ (
    async (u, init = {}) => {
      const method = init.method || "GET";
      const path = new URL(String(u)).pathname.replace(/^\/api/, "");
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push([method, path, String(/** @type {any} */ (init.headers)?.cookie || ""), body]);
      if (path === "/remote/me") return answer(200, { who: "device", device: { id: "d-window", scope: "full" }, machine: { id: "m-mac", name: "Mac mini" } });
      if (path === "/remote/devices") return answer(200, { devices });
      const one = /^\/remote\/devices\/(.+)$/.exec(path);
      const d = one ? devices.find((x) => x.id === decodeURIComponent(one[1])) : null;
      if (one && !d) return answer(404, { error: "no such device" });
      if (d && method === "PATCH") {
        Object.assign(d.grants, body.grants);
        return answer(200, { device: d });
      }
      return answer(404, { error: `no route ${path}` });
    }
  );
  return { fetchImpl, calls, devices };
}

/**
 * The flow over a scripted machine, its agents' device kept here where `kept` names it.
 * @param {import("node:test").TestContext} t @param {ReturnType<typeof scripted>} there @param {string | null} kept
 */
const flowOver = (t, there, kept) => {
  const store = createMachines({ dataDir: folder(t) });
  if (kept) store.keep({ url: "https://192.0.2.9:20343", fingerprint: PRINT, machine: { id: "m-mac", name: "Mac mini" }, device: { id: kept, name: "Filament agents on Laptop", scope: "agent" }, token: "fdt_kept" });
  const flow = createMachineAgents({
    machines: () => [{ id: "m-mac", name: "Mac mini", routes: [{ kind: "lan", url: "https://192.0.2.9:20343", fingerprint: PRINT }], partition: "persist:machine-m-mac", addedAt: T0 }],
    cookieOf: async (partition) => `__Host-filament_device=cookie-of-${partition}`,
    store,
    pick: async (m) => ({ route: m.routes[0], name: m.name, version: "9", tried: [] }),
    fetchOf: () => there.fetchImpl,
  });
  return { flow, store };
};

// (fails before: yes — the flow had no `models`, and its rows said nothing of the grant `models`)
test("main's models switch with fakes: on PATCHes the agents' device's grant models there with the window's sign-in, off PATCHes it false; the list carries models; the agents' grant is left as it is", async (t) => {
  const there = scripted([device("d-agents", { agents: true })]);
  const { flow } = flowOver(t, there, "d-agents");
  assert.deepEqual(await flow.list(), [{ id: "m-mac", name: "Mac mini", on: true, models: false, full: false, kept: true, ready: true, words: null }]);

  const on = await flow.models("m-mac", true);
  assert.deepEqual([on.on, on.models, on.kept, on.ready, on.said], [true, true, true, true, undefined]);
  const patches = () => there.calls.filter(([m]) => m === "PATCH");
  assert.deepEqual(patches().map(([m, path, , body]) => [m, path, body]), [["PATCH", "/remote/devices/d-agents", { grants: { models: true } }]], "the grant models alone");
  assert.ok(there.calls.every(([, , cookie]) => cookie === "__Host-filament_device=cookie-of-persist:machine-m-mac"), "every call as the window's sign-in there");
  assert.equal((await flow.list())[0].models, true, "read from the device list there");
  assert.equal(JSON.stringify(on).includes("fdt_"), false, "no token in what the page hears");

  const off = await flow.models("M-MAC", false);
  assert.deepEqual([off.on, off.models], [true, false]);
  assert.deepEqual(patches().at(-1)?.[3], { grants: { models: false } });
  assert.deepEqual(there.devices[0].grants, { agents: true, models: false, browser: false });
  assert.equal((await flow.list())[0].models, false);
  // The agents' switch keeps the models grant as it stands, and says it.
  await flow.models("m-mac", true);
  const agentsOff = await flow.set("m-mac", false);
  assert.deepEqual([agentsOff.on, agentsOff.models], [false, true]);
});

test("main's models switch says what stands in the way, and moves nothing: no device kept here, the one kept revoked there, no such machine", async (t) => {
  const none = scripted([]);
  const unkept = await flowOver(t, none, null).flow.models("m-mac", true);
  assert.deepEqual([unkept.failed, unkept.models, unkept.kept], [true, false, false]);
  assert.match(String(unkept.said), /^Not switched on: this Filament's agents have no device on Mac mini yet\. Let them work there first/);
  assert.equal(none.calls.filter(([m]) => m === "PATCH").length, 0, "nothing PATCHed");

  const gone = scripted([]);
  const revoked = await flowOver(t, gone, "d-gone").flow.models("m-mac", false);
  assert.deepEqual([revoked.failed, revoked.models], [true, false]);
  assert.match(String(revoked.said), /^Not switched off: this Filament's agents' device on Mac mini was revoked there\. Let them work there again, and Mac mini makes a new one\./);

  const unknown = await flowOver(t, scripted([]), null).flow.models("m-elsewhere", true);
  assert.deepEqual([unknown.failed, unknown.ready, unknown.models], [true, false, false]);
});

// ---- the page's pill --------------------------------------------------------------------------------------------

/**
 * The page over scripted routes and the app's bridge: the machines main would answer, this Filament's upstreams.
 * `refuse`: how many removals of an upstream this Filament refuses first, as a route of the person's naming it does.
 * @param {{ rows: any[], ups?: any[], models?: (id: string, on: boolean) => any, postFails?: boolean, refuse?: number }} o
 */
async function open(o) {
  let rows = structuredClone(o.rows);
  let ups = structuredClone(o.ups || []);
  let refuse = o.refuse || 0;
  /** @type {any[][]} */
  const bridge = [];
  /** @type {[string, string, any][]} */
  const calls = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    const method = init.method || "GET";
    calls.push([method, path, init.body]);
    if (path === "/schema") return { config: {} };
    if (path === "/state") return { version: "9.9.9", machine: { id: "m-here", name: "Laptop" }, viewer: "local", device: null, config: {} };
    if (path === "/remote/devices") return { devices: [], pending: [] };
    if (path === "/upstreams" && method === "GET") return { version: 3, upstreams: structuredClone([{ id: "anthropic", name: "Anthropic", type: "anthropic" }, ...ups]) };
    if (path === "/upstreams" && method === "POST") {
      if (o.postFails) throw Object.assign(new Error("refused"), { status: 400, body: { error: "No machine \"m-mac\" is kept for this Filament's agents" } });
      const u = { id: "mac-mini", name: "Mac mini", type: "filament", machine: init.body.machine };
      ups.push(u);
      return { upstream: u, version: 4 };
    }
    const one = /^\/upstreams\/([^?]+)$/.exec(path);
    if (one && method === "DELETE") {
      if (refuse-- > 0) throw Object.assign(new Error("refused"), { status: 409, body: { error: ROUTE_NAMES } });
      ups = ups.filter((u) => u.id !== decodeURIComponent(one[1]));
      return { removed: decodeURIComponent(one[1]), version: 5 };
    }
    throw Object.assign(new Error(`no route ${method} ${path}`), { status: 404, body: { error: `no route ${path}` } });
  };
  const app = {
    addMachine: () => {},
    agentMachines: async () => (bridge.push(["list"]), { machines: structuredClone(rows) }),
    agentsOn: async (/** @type {string} */ id, /** @type {boolean} */ on) => (bridge.push(["on", id, on]), { ...rows.find((x) => x.id === id), on }),
    agentsModels: async (/** @type {string} */ id, /** @type {boolean} */ on) => {
      bridge.push(["models", id, on]);
      const got = o.models ? o.models(id, on) : { ...rows.find((x) => x.id === id), models: on };
      rows = rows.map((x) => (x.id === id ? got : x));
      return got;
    },
    agentsForget: async (/** @type {string} */ id) => {
      bridge.push(["forget", id]);
      const got = { ...rows.find((x) => x.id === id), on: false, models: false, kept: false, said: "Forgotten here, and revoked on Mac mini" };
      rows = rows.map((x) => (x.id === id ? got : x));
      return got;
    },
  };
  const body = /** @type {any} */ (fakeH("div", {}));
  renderRemote(body, { onToast: (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => void toasts.push([msg, kind]) }, {
    h: fakeH, api, copy: async () => {}, confirm: async () => true, now: () => T0, every: () => () => {}, go: () => {}, app,
  });
  await settle();
  return { body, calls, toasts, bridge, ups: () => ups };
}

const MAC = { id: "m-mac", name: "Mac mini", on: true, models: false, kept: true, ready: true, words: null };
const MODELS = modelsLabel("Mac mini");
/** This Filament's upstream of Mac mini's models. */
const UP = { id: "mac-mini", name: "Mac mini", type: "filament", machine: "m-mac" };
/** Why a removal is refused, as the server says it (providers.js `remove`). */
const ROUTE_NAMES = "A route of yours names Mac mini: mac-mini/glm-5.3. Remove it too, or change it in the console first.";

// (fails before: yes — a machine row had the agents' switch alone: nothing used its models here)
test("the page's pill: on a machine whose agents' device is kept, Models; on, the app switches the grant there and this Filament adds its upstream; off, the grant off and the upstream removed; still where nothing is kept, said why", async () => {
  const p = await open({ rows: [MAC, { id: "m-box", name: "Build box", on: false, models: false, kept: false, ready: true, words: null }] });
  assert.ok(labels(p.body).includes("Add a machine"), labels(p.body).join(", "));
  const box = pillOf(itemOf(p.body, "What this machine may do on Build box"), modelsLabel("Build box"));
  assert.deepEqual([box.attrs.disabled, box.attrs["aria-pressed"]], ["", "false"], "nothing kept on Build box: its Models pill still");
  assert.match(box.attrs.title, /^Press Agents first: Build box lends its models to this Filament's agents' device there\./);
  assert.equal(MODELS, "Use Mac mini's models in this Filament's chats");
  assert.equal(textOf(pillOf(p.body, MODELS)), "Models");
  assert.equal(pillOf(p.body, MODELS).attrs.title, modelsWords("Mac mini"), "its whole meaning in its title");
  assert.match(modelsWords("Mac mini"), /^Mac mini's models join the model picker here, on its keys and sign-ins: your conversation goes to Mac mini for each call\. Needs Agents\.$/, "and why it waits for Agents");
  assert.equal(pillOf(p.body, MODELS).attrs["aria-pressed"], "false");

  pillOf(p.body, MODELS).attrs.onclick();
  await settle();
  assert.deepEqual(p.bridge.filter((c) => c[0] === "models"), [["models", "m-mac", true]]);
  assert.deepEqual(p.calls.filter(([m]) => m === "POST"), [["POST", "/upstreams", { type: "filament", machine: "m-mac" }]], "the grant first, then the upstream here");
  assert.deepEqual(p.toasts.at(-1), ["Mac mini's models are in the model picker", undefined]);
  assert.equal(pillOf(p.body, MODELS).attrs["aria-pressed"], "true");

  pillOf(p.body, MODELS).attrs.onclick();
  await settle();
  assert.deepEqual(p.bridge.filter((c) => c[0] === "models").at(-1), ["models", "m-mac", false]);
  assert.deepEqual(p.calls.filter(([m]) => m === "DELETE"), [["DELETE", "/upstreams/mac-mini", undefined]]);
  assert.deepEqual(p.ups(), []);
  assert.deepEqual(p.toasts.at(-1), ["Mac mini's models left the model picker", undefined]);
  assert.equal(pillOf(p.body, MODELS).attrs["aria-pressed"], "false");
});

// (fails before: yes — no switch read the grant beside this Filament's upstream)
test("the page's pill where grant and upstream disagree shows off, and a press makes both so: the grant on with no upstream adds it; an upstream with the grant off adds none again", async () => {
  const lent = await open({ rows: [{ ...MAC, models: true }] });
  assert.equal(pillOf(lent.body, MODELS).attrs["aria-pressed"], "false", "lent there, not added here");
  pillOf(lent.body, MODELS).attrs.onclick();
  await settle();
  assert.deepEqual(lent.bridge.filter((c) => c[0] === "models"), [["models", "m-mac", true]]);
  assert.equal(lent.calls.filter(([m, path]) => m === "POST" && path === "/upstreams").length, 1);
  assert.equal(pillOf(lent.body, MODELS).attrs["aria-pressed"], "true");

  const added = await open({ rows: [MAC], ups: [{ id: "mac", name: "Mac mini", type: "filament", machine: "M-MAC" }] });
  assert.equal(pillOf(added.body, MODELS).attrs["aria-pressed"], "false", "added here, not lent there");
  pillOf(added.body, MODELS).attrs.onclick();
  await settle();
  assert.deepEqual(added.bridge.filter((c) => c[0] === "models"), [["models", "m-mac", true]]);
  assert.equal(added.calls.filter(([m]) => m === "POST").length, 0, "the upstream there already is left");
  assert.equal(pillOf(added.body, MODELS).attrs["aria-pressed"], "true");
});

test("the page's pill: a grant refused is said and nothing is added; an add refused is said; a machine not ready has it still; Forget removes the upstream here", async () => {
  const refused = await open({ rows: [MAC], models: (id) => ({ ...MAC, id, said: "Not switched on: Mac mini does not answer: nothing listens at https://192.0.2.9:20343.", failed: true }) });
  pillOf(refused.body, MODELS).attrs.onclick();
  await settle();
  assert.deepEqual(refused.toasts.at(-1), ["Not switched on: Mac mini does not answer: nothing listens at https://192.0.2.9:20343.", "err"]);
  assert.equal(refused.calls.filter(([m]) => m === "POST").length, 0);

  const noAdd = await open({ rows: [MAC], postFails: true });
  pillOf(noAdd.body, MODELS).attrs.onclick();
  await settle();
  assert.deepEqual(noAdd.toasts.at(-1), ["Mac mini lends its models, and this Filament did not add them: No machine \"m-mac\" is kept for this Filament's agents", "err"]);
  assert.equal(pillOf(noAdd.body, MODELS).attrs["aria-pressed"], "false");

  const still = await open({ rows: [{ ...MAC, ready: false, words: "Mac mini does not answer." }] });
  assert.equal(pillOf(still.body, MODELS).attrs.disabled, "");

  // Forget where the machine cannot be reached by the token kept here.
  const forget = await open({ rows: [{ ...MAC, models: true, ready: false, away: "quiet", words: "Mac mini does not answer." }], ups: [{ id: "mac-mini", name: "Mac mini", type: "filament", machine: "m-mac" }] });
  assert.equal(pillOf(forget.body, MODELS).attrs["aria-pressed"], "true");
  buttonsOf(itemOf(forget.body, "What this machine may do on Mac mini")).find((b) => b.attrs["aria-label"] === "Forget this Filament's agents on Mac mini").attrs.onclick();
  await settle();
  assert.deepEqual(forget.bridge.at(-1), ["forget", "m-mac"]);
  assert.deepEqual(forget.calls.filter(([m]) => m === "DELETE"), [["DELETE", "/upstreams/mac-mini", undefined]]);
  assert.deepEqual(forget.toasts.at(-1), ["Forgotten here, and revoked on Mac mini", undefined]);
  assert.deepEqual([pillOf(forget.body, MODELS).attrs["aria-pressed"], pillOf(forget.body, MODELS).attrs.disabled], ["false", ""], "nothing kept: its Models pill off, and still");
});

// (fails before: yes — the pill was still while the machine did not answer, and showed off: its models stayed in the
// picker, offline, with no way here to take them out)
test("the page's pill while the machine does not answer: on where this Filament has added its models, and a press takes them out of the picker at once, the grant there said not switched off", async () => {
  const away = { ...MAC, ready: false, models: false, words: "Mac mini does not answer: nothing listens at https://192.0.2.9:20343." };
  const p = await open({ rows: [away], ups: [UP], models: (id, on) => ({ ...away, id, said: `Not switched ${on ? "on" : "off"}: ${away.words}`, failed: true }) });
  const pill = () => pillOf(p.body, MODELS);
  assert.deepEqual([pill().attrs["aria-pressed"], pill().attrs.disabled ?? null], ["true", null], "added here: on, and it moves");
  assert.equal(pill().attrs.title, `${modelsWords("Mac mini")} ${away.words} A press takes its models out of the model picker here at once.`);

  pill().attrs.onclick();
  await settle();
  assert.deepEqual(p.calls.filter(([m]) => m === "DELETE"), [["DELETE", "/upstreams/mac-mini", undefined]]);
  assert.deepEqual(p.ups(), []);
  assert.deepEqual(p.bridge.filter((c) => c[0] === "models"), [["models", "m-mac", false]], "the grant asked off there too");
  assert.deepEqual(p.toasts.at(-1), [`Mac mini's models left the model picker. Not switched off: ${away.words}`, "err"]);
  assert.deepEqual([pill().attrs["aria-pressed"], pill().attrs.disabled], ["false", ""], "off, and still until it answers");
});

// (fails before: yes — the grant went off there first, and a removal refused here left the pill off with the models
// still in the picker: a press switched the grant on again; after Forget the pill was off and still)
test("the page's pill: a removal refused here is said and moves nothing there, the pill pressed, so a press asks again; after Forget, one refused leaves it pressed too", async () => {
  const p = await open({ rows: [{ ...MAC, models: true }], ups: [UP], refuse: 1 });
  const pill = () => pillOf(p.body, MODELS);
  assert.equal(pill().attrs["aria-pressed"], "true");
  pill().attrs.onclick();
  await settle();
  assert.deepEqual(p.toasts.at(-1), [`Mac mini's models stay in the model picker: ${ROUTE_NAMES}`, "err"]);
  assert.deepEqual(p.bridge.filter((c) => c[0] === "models"), [], "the grant there left on");
  assert.deepEqual([pill().attrs["aria-pressed"], pill().attrs.disabled ?? null], ["true", null], "pressed: a press asks again");

  pill().attrs.onclick();
  await settle();
  assert.deepEqual(p.calls.filter(([m]) => m === "DELETE").length, 2);
  assert.deepEqual(p.ups(), []);
  assert.deepEqual(p.bridge.filter((c) => c[0] === "models"), [["models", "m-mac", false]]);
  assert.deepEqual(p.toasts.at(-1), ["Mac mini's models left the model picker", undefined]);
  assert.equal(pill().attrs["aria-pressed"], "false");

  const f = await open({ rows: [{ ...MAC, models: true, ready: false, away: "quiet", words: "Mac mini does not answer." }], ups: [UP], refuse: 1 });
  buttonsOf(itemOf(f.body, "What this machine may do on Mac mini")).find((b) => b.attrs["aria-label"] === "Forget this Filament's agents on Mac mini").attrs.onclick();
  await settle();
  assert.deepEqual(f.toasts.at(-1), [`Forgotten here, and revoked on Mac mini. Mac mini's models stay in the model picker: ${ROUTE_NAMES}`, "err"]);
  const left = pillOf(f.body, MODELS);
  assert.deepEqual([left.attrs["aria-pressed"], left.attrs.disabled ?? null], ["true", null], "its models still here: pressed, and it moves");
  assert.match(left.attrs.title, /This Filament keeps no agents' device on Mac mini now: its models answer nothing here, and a press takes them out of the model picker\.$/);
  left.attrs.onclick();
  await settle();
  assert.deepEqual(f.ups(), []);
  assert.deepEqual(f.bridge.filter((c) => c[0] === "models"), [], "nothing kept there to switch");
  assert.deepEqual(f.toasts.at(-1), ["Mac mini's models left the model picker", undefined]);
  assert.deepEqual([pillOf(f.body, MODELS).attrs["aria-pressed"], pillOf(f.body, MODELS).attrs.disabled], ["false", ""]);
});

// ---- the model list and the picker ------------------------------------------------------------------------------

// (fails before: yes — /api/models' rows said nothing of their machine, nor why it was offline)
test("/api/models marks another machine's rows with their machine, and while it is found offline, why", async (t) => {
  const machine = "11111111-1111-4111-8111-111111111111";
  const s = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [...(cfg.upstreams || []), { id: "asleep", name: "Asleep", type: "filament", machine, enabled: true, billing: "plan" }];
      cfg.routes = [{ match: "asleep/m-1", upstream: "asleep", upstreamModel: "m-1", enabled: true }, { match: "asleep/*", upstream: "asleep", upstreamModel: "{1}", enabled: true }, ...(cfg.routes || [])];
    },
  });
  t.after(() => s.stop());
  // Asked anew: its listing finds no machine kept, and says it offline.
  const j = await (await s.api("/api/models?refresh=1")).json();
  const row = j.models.find((/** @type {any} */ m) => m.id === "asleep/m-1");
  assert.ok(row, JSON.stringify(j.models.map((/** @type {any} */ m) => m.id)));
  assert.equal(row.machine, machine);
  assert.match(String(row.offline), /^Asleep: /);
  assert.equal(row.offline, j.upstreams.asleep.offline, "the upstream's own words");
  assert.equal(row.answers, false);
  assert.ok(j.models.filter((/** @type {any} */ m) => m.upstream !== "asleep").every((/** @type {any} */ m) => !("machine" in m) && !("offline" in m)), "no other row is marked");
  // (fails before: yes — its family was billing "plan", and the picker said "On your plan" of a model on another
  // machine's keys)
  const fam = (j.families || []).find((/** @type {any} */ f) => f.members.some((/** @type {any} */ x) => x.id === "asleep/m-1"));
  assert.deepEqual([fam?.onMachine, fam?.billing], ["Asleep", undefined]);
  const { familyFacts } = await import("../src/ui/harness/composer/model.js");
  const { priceLine } = await import("../src/ui/harness/lib/families.js");
  assert.equal(familyFacts(fam).some((f) => f.text === "On Asleep"), true);
  assert.equal(familyFacts(fam).some((f) => /plan/i.test(f.text)), false);
  assert.match(priceLine(fam), /^On Asleep/);
});

// (fails before: yes — a machine's tab was its upstream's name alone: no dot, no word of it offline)
test("the picker: another machine's tab is named for it, with a dot — green while it answers, amber offline with why on its title and under its list —; its models by their own names; a pick is the routed id", async () => {
  const doc = stubDocument();
  try {
    const { createModelSelect, sourceMachine } = await import("../src/ui/harness/composer/model.js");
    const rows = [
      { id: "claude-opus-5-5", upstream: "anthropic", upstreamName: "Anthropic" },
      { id: "workstation/glm-5.3", upstream: "workstation", upstreamName: "Workstation", machine: "m-1" },
      { id: "workstation/claude-sonnet-5", upstream: "workstation", upstreamName: "Workstation", machine: "m-1" },
    ];
    assert.equal(sourceMachine(rows, "anthropic"), null, "no machine's");
    assert.deepEqual(sourceMachine(rows, "workstation"), { offline: null, title: "On Workstation: its models run on its keys and sign-ins, and each call goes there", dot: "ok" });
    /** @type {string[]} */
    const picked = [];
    const sel = createModelSelect({ onChange: (name) => picked.push(name) });
    sel.setModels(rows);
    sel.set("workstation/glm-5.3");
    sel.open();
    const tabs = () => /** @type {any[]} */ (doc.document.querySelectorAll(".mp-source"));
    const tab = () => tabs().find((x) => x.getAttribute("data-key") === "workstation");
    assert.deepEqual(tabs().map((x) => x.querySelector(".mp-source-name")?.textContent), ["Anthropic", "Workstation"]);
    assert.equal(tabs()[0].querySelector(".mp-source-dot"), null, "a provider's tab has none");
    assert.ok(tab().querySelector(".mp-source-dot")?.classList.contains("is-ok"), "green while it answers");
    assert.match(String(tab().getAttribute("title")), /^On Workstation: its models run on its keys and sign-ins/);
    assert.equal(doc.document.querySelector(".mp-source-note"), null, "nothing to say while it answers");
    const names = /** @type {any[]} */ (doc.document.querySelectorAll(".mp-row-name")).map((x) => x.textContent);
    assert.equal(names.length, 2);
    assert.ok(names.every((n) => !n.includes("workstation/")), `named as the machine names them: ${names.join(", ")}`);
    const row = /** @type {any[]} */ (doc.document.querySelectorAll(".mp-row")).find((x) => x.getAttribute("data-key") === "row:workstation:workstation/claude-sonnet-5");
    row.dispatch("click");
    assert.deepEqual(picked, ["workstation/claude-sonnet-5"], "the routed id: the chat runs here, its calls go there");

    // Offline: amber, the words on its title and under its list.
    const why = "Workstation did not answer: ETIMEDOUT";
    sel.setModels(rows.map((r) => (r.machine ? { ...r, offline: why } : r)));
    sel.open();
    assert.ok(tab().querySelector(".mp-source-dot")?.classList.contains("is-off"));
    assert.equal(tab().getAttribute("title"), `Offline: ${why}`);
    assert.equal(doc.document.querySelector(".mp-source-note")?.textContent, `Offline: ${why}`);
    tabs()[0].dispatch("click");
    assert.equal(doc.document.querySelector(".mp-source-note"), null, "another source's list says nothing of it");
  } finally {
    doc.restore();
  }
});

// (fails before: yes — the picker's tabs came from the models listed alone: a machine whose models were switched on here
// and not listed yet, or found offline before any were, had no tab, and nothing said why)
test("the picker: a machine whose models this Filament keeps and whose listing has none yet has its tab all the same, saying why it lists nothing", async () => {
  const doc = stubDocument();
  try {
    const { createModelSelect, machinesOf, sourceMachine } = await import("../src/ui/harness/composer/model.js");
    const ups = [
      { id: "anthropic", name: "Anthropic", type: "anthropic" },
      { id: "mac-mini", name: "Mac mini", type: "filament", machine: "m-mac", enabled: true },
      { id: "box", name: "Build box", type: "filament", machine: "m-box", enabled: false },
    ];
    // What /api/models says of each listing (`upstreams`), as the catalogue's read answers it.
    /** @param {any} mac */
    const machines = (mac) => machinesOf(ups, { anthropic: { count: 1 }, "mac-mini": { count: 0, ...mac } });
    assert.deepEqual(machines({ discovering: true }), [{ upstream: "mac-mini", name: "Mac mini", offline: null, asking: true, unasked: false, error: null, listed: 0 }], "a machine's, switched on");
    const rows = [{ id: "claude-opus-5-5", upstream: "anthropic", upstreamName: "Anthropic" }];
    const sel = createModelSelect({});
    sel.setModels(rows);
    const tabs = () => /** @type {any[]} */ (doc.document.querySelectorAll(".mp-source"));
    const tab = () => tabs().find((x) => x.getAttribute("data-key") === "mac-mini");
    /** The picker opened anew: one open is closed first, as a press on its chip closes it. */
    const show = () => {
      if (doc.document.querySelector(".mp")) sel.open();
      sel.open();
    };
    /** What its list says, its tab pressed. */
    const said = () => {
      tab().dispatch("click");
      return [doc.document.querySelector(".mp-source-note")?.textContent ?? null, doc.document.querySelector(".mp-empty")?.textContent ?? null];
    };

    show();
    assert.equal(tab(), undefined, "a picker told of no machine draws none");

    sel.setMachines(machines({ discovering: true }));
    show();
    assert.deepEqual(tabs().map((x) => x.querySelector(".mp-source-name")?.textContent), ["Anthropic", "Mac mini"], "named for the machine; a machine switched off here has none");
    assert.equal(tab().querySelector(".mp-source-count")?.textContent, "0");
    // (fails before: yes — the review of the m-ui hunt's fix: a machine being asked, or never asked, wore the green dot
    // of one that answers)
    assert.ok(tab().querySelector(".mp-source-dot")?.classList.contains("is-unknown"), "grey: not known to answer yet");
    assert.equal(tab().getAttribute("title"), "Asking Mac mini for its models…");
    assert.deepEqual(said(), [null, "Asking Mac mini for its models…"]);
    assert.equal(doc.document.querySelectorAll(".mp-row").length, 0);

    const why = "Mac mini did not answer: ETIMEDOUT";
    sel.setMachines(machines({ offline: why, error: why }));
    show();
    assert.ok(tab().querySelector(".mp-source-dot")?.classList.contains("is-off"), "amber offline");
    assert.equal(tab().getAttribute("title"), `Offline: ${why}`);
    assert.deepEqual(said(), [`Offline: ${why}`, null], "said once, as a machine with models says it");

    sel.setMachines(machines({ error: "Mac mini's door said 403." }));
    show();
    assert.deepEqual(said(), [null, "Mac mini did not list its models: Mac mini's door said 403."]);
    assert.ok(tab().querySelector(".mp-source-dot")?.classList.contains("is-off"), "amber: its listing failed");

    sel.setMachines(machines({ unasked: true }));
    show();
    assert.deepEqual(said(), [null, "Mac mini has not been asked for its models yet."]);
    assert.ok(tab().querySelector(".mp-source-dot")?.classList.contains("is-unknown"), "grey: never asked");

    // Listed, every name kept out of the picker here (its hidden models).
    sel.setMachines(machines({ count: 2, hidden: 2 }));
    show();
    assert.deepEqual(said(), [null, "Mac mini lists 2 models, and none is in the picker: hidden here, or no route reaches them."]);

    sel.setMachines(machines({}));
    show();
    assert.deepEqual(said(), [null, "Mac mini lists no models: none answers there yet. Connect one in its own Settings › Providers."]);
    assert.ok(tab().querySelector(".mp-source-dot")?.classList.contains("is-ok"), "green: it answered, with no model");
    assert.deepEqual(sourceMachine(rows, "mac-mini", machines({})), { offline: null, title: "Mac mini lists no models: none answers there yet. Connect one in its own Settings › Providers.", dot: "ok", empty: "Mac mini lists no models: none answers there yet. Connect one in its own Settings › Providers." });

    // Listed: its models, one tab, the machine's rows as before.
    sel.setModels([...rows, { id: "mac-mini/glm-5.3", upstream: "mac-mini", upstreamName: "Mac mini", machine: "m-mac" }]);
    show();
    assert.deepEqual(tabs().map((x) => x.getAttribute("data-key")), ["anthropic", "mac-mini"]);
    assert.equal(tab().querySelector(".mp-source-count")?.textContent, "1");
    tab().dispatch("click");
    assert.equal(doc.document.querySelectorAll(".mp-row").length, 1);
    assert.equal(doc.document.querySelector(".mp-empty"), null);
  } finally {
    doc.restore();
  }
});

// ---- the console --------------------------------------------------------------------------------------------------

// (fails before: yes — every card's type list offered `filament`, and its card was a provider's, with an address and a key)
test("the console offers no filament type to pick, and shows a machine's upstream read-only with its machine's name", () => {
  /** @type {any} */
  const state = runtimeState;
  /** @type {any} */ (globalThis).location = { search: "" };
  Object.assign(state, {
    tab: "upstreams", addUp: false, addFlow: null, justAdded: null, dirty: false, requests: [], unreadable: [], _providers: { providers: [] },
    schema: { upstreamTypes: { "openai-compatible": { label: "OpenAI-compatible server (…)", formats: ["openai"] }, filament: { label: "Another machine's Filament (its models, by this machine's agents' device there)", formats: ["anthropic", "openai"], machine: true } }, upstream: {} },
  });
  bindUi({
    h: fakeH, fmt,
    api: async (/** @type {string} */ path) => (path.startsWith("/models") ? { models: [], upstreams: {} } : path.startsWith("/usage") ? { total: { rows: [] } } : {}),
    toast: () => {}, render: () => {}, markDirty: () => {},
    input: (/** @type {any} */ u, /** @type {string} */ k, /** @type {string} */ ph) => fakeH("input", { value: u[k] || "", placeholder: ph, "data-field": k }),
    idInput: () => fakeH("input"), flatten: (/** @type {any} */ o) => o || {}, openRulesDrawer() {}, mergedRules() {}, removeUpstream() {},
    goto: (/** @type {string} */ _t, /** @type {string} */ l) => fakeH("a", {}, l), intro: (/** @type {string} */ _id, /** @type {any[]} */ ...k) => fakeH("div", {}, ...k), md: (/** @type {string} */ s) => s,
    store: { get: () => null, set() {} }, pingResult: () => fakeH("span"),
  });
  const ups = [
    { id: "zai", name: "Z.AI", type: "openai-compatible", baseUrl: "https://example.test/v1" },
    { id: "workstation", name: "Workstation", type: "filament", machine: "11111111-1111-4111-8111-111111111111", enabled: true, billing: "plan" },
  ];
  const routes = [{ match: "zai/*", upstream: "zai", upstreamModel: "{1}", enabled: true }, { match: "workstation/*", upstream: "workstation", upstreamModel: "{1}", enabled: true }];
  /** @param {string} sel */
  const page = (sel) => {
    state.config = { upstreams: structuredClone(ups), routes: structuredClone(routes), rules: {} };
    state.saved = structuredClone(state.config);
    state.selUp = sel;
    return upstreamsPage();
  };
  const zai = page("zai");
  const options = every(zai, (n) => n.tag === "option").map((n) => n.attrs.value);
  assert.ok(options.includes("openai-compatible") && !options.includes("filament"), `no filament to pick: ${options.join(", ")}`);

  const ws = page("workstation");
  const card = every(ws, (n) => hasClass(n, "machine-card"))[0];
  assert.ok(card, "a card of its own");
  assert.equal(every(ws, (n) => hasClass(n, "provider-card")).length, 0, "no provider's card");
  assert.match(textOf(card), /Workstation/);
  assert.match(textOf(card), /Another machine/);
  assert.match(textOf(card), /workstation\//);
  assert.match(textOf(card), /Settings › Remote access › Machines: the Models pill under "What this machine may do on Workstation"\./);
  assert.equal(every(card, (n) => n.tag === "input" || n.tag === "select" || n.tag === "textarea").length, 0, "nothing to edit");
});
