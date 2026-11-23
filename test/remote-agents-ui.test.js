// @ts-check
// Settings › Remote access: agents' pills on both machines (the remote-agents plan's f-ui), on one card per machine (the
// owner's redesign of 11-09). On the machine worked on, another machine's agents' device is on that machine's card, as
// what it may do here — never listed as Full —, with a pill for each thing they may do here, each PATCHing its grant,
// its whole meaning in its title; a browser or a command line is listed apart, with none. In the desktop app, each card
// has a line "What this machine may do on <machine>" with its Agents pill, "Let this Filament's agents work on <machine>": Electron
// main mints the agents' device there with the window's sign-in, keeps its token in this Filament's machine store
// (services/machines `keep`), switches its grant there, and the page hears the outcome alone. A browser shows nothing new.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { startTwoMachines } from "./helpers/two-machines.js";
import { renderRemote, deviceWords, machinesOf, FILTER_FROM, GRANT_ROWS, thereWords, fullLabel } from "../src/ui/harness/settings/remote.js";
import { createMachines } from "../src/services/machines/index.js";
import { REMOTES_FILE, readRemotes } from "../src/services/machines/remotes.js";
import { isSealed } from "../src/services/config/secrets.js";
import { createMachineAgents } from "../desktop/lib/machine-agents.js";

const T0 = Date.parse("2026-11-08T12:00:00Z");
const PRINT = `${"AB:".repeat(31)}CD`;
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
/** A data folder of its own, removed after. @param {import("node:test").TestContext} t */
const folder = (t) => {
  const d = mkdtempSync(join(tmpdir(), "filament-agents-ui-"));
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
/** The machines' cards, by their names. @param {any} el */
const cards = (el) => every(el, (n) => hasClass(n, "rset-card-name")).map((n) => textOf(n));
/** A machine's card by its key. @param {any} el @param {string} key */
const cardOf = (el, key) => {
  const c = every(el, (n) => n.attrs?.["data-card"] === key)[0];
  assert.ok(c, `a card "${key}"`);
  return c;
};
/** The listed lines' titles: each card's ways, and the browsers and command lines. @param {any} el */
const names = (el) => every(el, (n) => hasClass(n, "rset-name")).map((n) => textOf(n));
/** A listed line by its title. @param {any} el @param {string} name */
const itemOf = (el, name) => {
  const r = every(el, (n) => hasClass(n, "rset-item")).find((n) => textOf(every(n, (k) => hasClass(k, "rset-name"))[0]) === name);
  assert.ok(r, `an item "${name}" in: ${names(el).join(", ")}`);
  return r;
};
/** The pills under `el`. @param {any} el */
const pills = (el) => every(el, (n) => hasClass(n, "rset-pill"));
/** A pill by what it says to a screen reader. @param {any} el @param {string} aria */
const pillOf = (el, aria) => {
  const b = pills(el).find((n) => n.attrs["aria-label"] === aria);
  assert.ok(b, `a pill "${aria}" in: ${pills(el).map((n) => n.attrs["aria-label"]).join(", ")}`);
  return b;
};
/** A line's own words, under its title. @param {any} el */
const lines = (el) => every(el, (n) => hasClass(n, "rset-line"));

/**
 * The page over scripted routes: the devices as the server lists them, a grant PATCHed as it keeps it, a device revoked.
 * `held.on`: each read of the list is the list as it is when asked, its answer held until the test lets it go;
 * `patchHeld.on` holds a grant's answer so, the grant kept at once; `readFails.on` fails each read of the list.
 * @param {{ devices?: any[], state?: Record<string, any>, app?: any, confirm?: boolean, patchFails?: boolean, held?: { on: boolean, out: (() => void)[] }, patchHeld?: { on: boolean, out: (() => void)[] }, readFails?: { on: boolean } }} [o]
 */
async function open(o = {}) {
  /** @type {any[]} */
  let devices = structuredClone(o.devices || []);
  /** @type {[string, string, any][]} */
  const calls = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** @type {any[]} */
  const asked = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    const method = init.method || "GET";
    calls.push([method, path, init.body]);
    if (path === "/schema") return { config: {} };
    if (path === "/state") return { version: "9.9.9", machine: { id: "m-1", name: "Workstation" }, viewer: "local", device: null, config: {}, ...(o.state || {}) };
    if (path === "/remote/devices") {
      if (o.readFails?.on) throw Object.assign(new Error("refused"), { status: 502, body: { error: "the network went away" } });
      const now = structuredClone({ devices, pending: [] });
      const held = o.held;
      return held?.on ? new Promise((resolve) => held.out.push(() => resolve(now))) : now;
    }
    const clear = /^\/remote\/devices\/([^/?]+)\/copies\/clear$/.exec(path);
    if (clear && method === "POST") {
      const d = devices.find((x) => x.id === decodeURIComponent(clear[1]));
      const out = { cleared: d?.copies?.count ?? 0, bytes: d?.copies?.bytes ?? 0 };
      devices = devices.map((x) => (x === d ? (({ copies: _c, ...rest }) => rest)(x) : x));
      return out;
    }
    const one = /^\/remote\/devices\/([^?]+)$/.exec(path);
    if (one && method === "PATCH") {
      if (o.patchFails) throw Object.assign(new Error("refused"), { status: 500, body: { error: "the device list could not be saved" } });
      const id = decodeURIComponent(one[1]);
      devices = devices.map((d) => (d.id === id ? { ...d, grants: { ...d.grants, ...init.body.grants } } : d));
      const answer = { device: structuredClone(devices.find((d) => d.id === id)) };
      // Kept on the server at once, its answer held for the test to let go (`patchHeld`).
      const held = o.patchHeld;
      return held?.on ? new Promise((resolve) => held.out.push(() => resolve(answer))) : answer;
    }
    if (one && method === "DELETE") {
      const id = decodeURIComponent(one[1]);
      devices = devices.map((d) => (d.id === id || d.of === id ? { ...d, revokedAt: T0 } : d));
      return { ok: true };
    }
    const gone = /^\/remote\/devices\/([^?]+)\?forget=1$/.exec(path);
    if (gone && method === "DELETE") {
      const id = decodeURIComponent(gone[1]);
      devices = devices.filter((d) => d.id !== id && !(d.of === id && d.revokedAt));
      return { ok: true };
    }
    throw Object.assign(new Error(`no route ${method} ${path}`), { status: 404, body: { error: `no route ${path}` } });
  };
  const body = /** @type {any} */ (fakeH("div", {}));
  renderRemote(body, { onToast: (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => void toasts.push([msg, kind]) }, {
    h: fakeH,
    api,
    copy: async () => {},
    confirm: async (/** @type {any} */ q) => (asked.push(q), o.confirm ?? true),
    now: () => T0 + 120_000,
    every: () => () => {},
    go: () => {},
    app: o.app ?? null,
  });
  await settle();
  return { body, calls, toasts, asked, devices: () => devices };
}

const FULL = { id: "d-laptop", name: "Laptop", scope: "full", kind: "browser", grants: { agents: false, models: false, browser: false }, createdAt: T0 - 9, lastSeenAt: T0, lastSeenFrom: "192.168.1.9", revokedAt: null };
const VIEW = { id: "d-phone", name: "Phone", scope: "view", kind: "browser", grants: { agents: false, models: false, browser: false }, createdAt: T0 - 8, lastSeenAt: null, lastSeenFrom: null, revokedAt: null };
const AGENTS = { id: "d-agents", name: "Filament agents on Laptop", scope: "agent", kind: "agents", of: "d-laptop", grants: { agents: true, models: false, browser: false }, createdAt: T0, lastSeenAt: null, lastSeenFrom: null, revokedAt: null };

// (fails before: yes — every device not view-only was listed as full, an agents' device among them, with no grant to switch)
test("on the machine worked on: another machine's agents' device is on its machine's card, as what it may do here, a pill for each grant that PATCHes it, its whole meaning in its title; a view-only browser is listed apart, with none", async () => {
  // Listed newest first, as the server lists them: the agents' device still goes with its full device.
  const p = await open({ devices: [AGENTS, VIEW, FULL] });
  assert.deepEqual(labels(p.body), ["This machine", "New code"], "no row of its own for a device or a grant");
  assert.deepEqual(cards(p.body), ["Laptop"]);
  assert.deepEqual(names(p.body), ["What Laptop may do on this machine", "Phone"], "the card's one way here, then the browser apart");
  assert.deepEqual(GRANT_ROWS.map((g) => [g.short, g.label]), [["Agents", "Agents may work here"], ["Models", "Its chats may use this machine's models"], ["Without asking", "May run without asking"], ["Coding agents", "May use coding agents here"], ["Full control", "Full control: its agents act here as you"]], "browser gets its pill once something reads it");
  assert.equal(deviceWords(AGENTS, T0), "Agents · not seen yet", "never said full");
  const laptop = itemOf(p.body, "What Laptop may do on this machine");
  assert.match(textOf(laptop), /^What Laptop may do on this machine\|Laptop's app opens this machine in its window · seen 2 min ago\|/);
  assert.equal(lines(laptop)[0].attrs.title, "Its agents have not worked here yet.");
  // A pill each, for the agents' device alone, named short; its whole meaning in its title. None for the view-only one.
  assert.deepEqual(pills(p.body).map((s) => [textOf(s), s.attrs["aria-label"], s.attrs["aria-pressed"]]), [
    ["Agents", "Agents may work here (Filament agents on Laptop)", "true"],
    ["Models", "Its chats may use this machine's models (Filament agents on Laptop)", "false"],
    ["Without asking", "May run without asking (Filament agents on Laptop)", "false"],
    ["Coding agents", "May use coding agents here (Filament agents on Laptop)", "false"],
    ["Full control", "Full control: its agents act here as you (Filament agents on Laptop)", "false"],
  ]);
  assert.equal(pillOf(p.body, "Its chats may use this machine's models (Filament agents on Laptop)").attrs.title, "Laptop's chats may use the API models set up here, on this machine's keys. Usage counts what they spend.");
  assert.equal(pillOf(p.body, "Agents may work here (Filament agents on Laptop)").attrs.title, "Laptop's agents may start chats here and run commands as you, in your project folders. What they ask comes to you on Laptop.");
  assert.equal(pills(itemOf(p.body, "Phone")).length, 0);

  // A pill pressed: its grant PATCHed alone, and the pill says what the server kept.
  const agents = "Agents may work here (Filament agents on Laptop)";
  pillOf(p.body, agents).attrs.onclick();
  await settle();
  assert.deepEqual(p.calls.filter(([m]) => m === "PATCH"), [["PATCH", "/remote/devices/d-agents", { grants: { agents: false } }]]);
  assert.equal(pillOf(p.body, agents).attrs["aria-pressed"], "false");
  pillOf(p.body, agents).attrs.onclick();
  await settle();
  assert.deepEqual(p.calls.filter(([m]) => m === "PATCH").at(-1), ["PATCH", "/remote/devices/d-agents", { grants: { agents: true } }]);
  assert.equal(pillOf(p.body, agents).attrs["aria-pressed"], "true");
  // Its models: a pill of their own, PATCHed alone (the remote-agents plan's m-door).
  pillOf(p.body, "Its chats may use this machine's models (Filament agents on Laptop)").attrs.onclick();
  await settle();
  assert.deepEqual(p.calls.filter(([m]) => m === "PATCH").at(-1), ["PATCH", "/remote/devices/d-agents", { grants: { models: true } }]);
  assert.equal(pillOf(p.body, "Its chats may use this machine's models (Filament agents on Laptop)").attrs["aria-pressed"], "true");

  // Revoke, the card's one: its window and its agents both, said so; once revoked its pills go, and Forget stands.
  buttonsOf(itemOf(p.body, "What Laptop may do on this machine")).find((b) => textOf(b) === "Revoke").attrs.onclick();
  await settle();
  assert.equal(p.asked[0].title, "Revoke Laptop?");
  assert.equal(p.asked[0].description, "Its app and its agents are signed out of this machine at once. To undo, pair it again with a code.");
  assert.deepEqual(p.calls.filter(([m]) => m === "DELETE"), [["DELETE", "/remote/devices/d-laptop", undefined]]);
  assert.deepEqual(p.toasts.at(-1), ["Laptop is revoked", undefined]);
  assert.equal(pills(p.body).length, 0);
  assert.match(textOf(itemOf(p.body, "What Laptop may do on this machine")), /Revoked 2 min ago · pair it again with a code to undo/);
  // Forgotten: its agents' device, revoked with it, goes from the list with it.
  buttonsOf(itemOf(p.body, "What Laptop may do on this machine")).find((b) => textOf(b) === "Forget").attrs.onclick();
  await settle();
  assert.deepEqual(cards(p.body), []);
  assert.deepEqual(names(p.body), ["Phone"]);
});

// (fails before: yes — the card said nothing of the copies another machine's agents work in here, and nothing cleared them)
test("on the machine worked on: the copies its agents work in here are on its card, how many, their size and their folder; Clear copies asks, clears, and the line goes", async () => {
  const folder = "/Users/kai/Filament copies/From Laptop";
  const p = await open({ devices: [{ ...AGENTS, copies: { count: 3, bytes: 1.25 * 1024 ** 3, folder } }, FULL] });
  const laptop = itemOf(p.body, "What Laptop may do on this machine");
  assert.ok(textOf(laptop).includes(`Copies from Laptop: 3, 1.3 GB, in ${folder}`), textOf(laptop));
  const button = buttonsOf(laptop).find((b) => textOf(b) === "Clear copies");
  assert.ok(button, "Clear copies on the card");
  button.attrs.onclick();
  await settle();
  assert.deepEqual([p.asked[0].title, p.asked[0].description, p.asked[0].confirmLabel], ["Clear Laptop's copies?", "Its 3 copies on this machine are deleted, with the chats its agents worked in there: one at work there stops. The next time they work here, Laptop sends a new copy.", "Clear copies"]);
  assert.deepEqual(p.calls.filter(([m]) => m === "POST"), [["POST", "/remote/devices/d-agents/copies/clear", undefined]]);
  assert.deepEqual(p.toasts.at(-1), ["Laptop's copies are cleared: 1.3 GB freed", undefined]);
  assert.doesNotMatch(textOf(itemOf(p.body, "What Laptop may do on this machine")), /Copies from/);
  assert.equal(buttonsOf(itemOf(p.body, "What Laptop may do on this machine")).some((b) => textOf(b) === "Clear copies"), false);
  // Asked and not confirmed: nothing cleared. None kept: no line, no button.
  const kept = await open({ confirm: false, devices: [{ ...AGENTS, copies: { count: 1, bytes: 5 * 1024 ** 2, folder } }, FULL] });
  assert.match(textOf(itemOf(kept.body, "What Laptop may do on this machine")), /Copies from Laptop: 1, 5 MB, in /);
  buttonsOf(itemOf(kept.body, "What Laptop may do on this machine")).find((b) => textOf(b) === "Clear copies").attrs.onclick();
  await settle();
  assert.equal(kept.asked[0].description, "Its copy on this machine is deleted, with the chats its agents worked in there: one at work there stops. The next time they work here, Laptop sends a new copy.");
  assert.deepEqual(kept.calls.filter(([m]) => m === "POST"), []);
  const none = await open({ devices: [AGENTS, FULL] });
  assert.doesNotMatch(textOf(itemOf(none.body, "What Laptop may do on this machine")), /Copies from/);
});

test("a grant the server would not keep is said, and the list read again", async () => {
  const p = await open({ devices: [FULL, AGENTS], patchFails: true });
  const reads = p.calls.filter(([, path]) => path === "/remote/devices").length;
  pillOf(p.body, "Agents may work here (Filament agents on Laptop)").attrs.onclick();
  await settle();
  assert.deepEqual(p.toasts.at(-1), ["Not changed: the device list could not be saved", "err"]);
  assert.equal(p.calls.filter(([, path]) => path === "/remote/devices").length, reads + 1);
  assert.equal(pillOf(p.body, "Agents may work here (Filament agents on Laptop)").attrs["aria-pressed"], "true");
});

// (fails before: yes — the f-ui hunt's: a read of the list begun before a grant's save, landing after it, put the pill back)
test("a grant's save outranks a read of the list begun before its answer: the pill stays as the server keeps it, and what else that read says stands", async () => {
  /** @type {{ on: boolean, out: (() => void)[] }} */
  const held = { on: false, out: [] };
  const p = await open({ devices: [FULL, VIEW, AGENTS], held });
  const agents = "Agents may work here (Filament agents on Laptop)";
  // Phone revoked: the list read again, its answer held; the pill pressed meanwhile.
  held.on = true;
  buttonsOf(itemOf(p.body, "Phone")).find((b) => textOf(b) === "Revoke").attrs.onclick();
  await settle();
  assert.equal(held.out.length, 1, "the read is out");
  pillOf(p.body, agents).attrs.onclick();
  await settle();
  assert.equal(pillOf(p.body, agents).attrs["aria-pressed"], "false");
  /** @type {() => void} */ (held.out.shift())();
  await settle();
  assert.equal(pillOf(p.body, agents).attrs["aria-pressed"], "false", "the read from before the save holds its grant no more");
  assert.ok(buttonsOf(itemOf(p.body, "Phone")).some((b) => textOf(b) === "Forget"), "Phone revoked, as that read says");
  // A read begun after the save: the list as the server has it, the save's answer let go.
  held.on = false;
  p.devices().find((d) => d.id === "d-agents").grants.agents = true;
  buttonsOf(itemOf(p.body, "Phone")).find((b) => textOf(b) === "Forget").attrs.onclick();
  await settle();
  assert.equal(pillOf(p.body, agents).attrs["aria-pressed"], "true", "pressed elsewhere since: the server's word");
});

// (fails before: yes — the swarm's review of 11-10: a read of the list that failed after one that worked drew no machine
// and no device, as if none were paired)
test("a read of the list that fails after one that worked keeps the cards as last read, and says so; the next that works says the list again", async () => {
  const readFails = { on: false };
  const p = await open({ devices: [FULL, VIEW, AGENTS], readFails });
  assert.deepEqual(cards(p.body), ["Laptop"]);
  readFails.on = true;
  buttonsOf(itemOf(p.body, "Phone")).find((b) => textOf(b) === "Revoke").attrs.onclick();
  await settle();
  assert.deepEqual(cards(p.body), ["Laptop"], "the cards stay");
  assert.ok(itemOf(p.body, "Phone"), "and the browsers");
  assert.match(textOf(p.body), /The machines and devices paired here could not be read again just now: the network went away. They show as last read./);
  readFails.on = false;
  // As last read, Phone is not revoked: pressed again, the list read anew says it is.
  buttonsOf(itemOf(p.body, "Phone")).find((b) => textOf(b) === "Revoke").attrs.onclick();
  await settle();
  assert.doesNotMatch(textOf(p.body), /could not be read/);
  assert.ok(buttonsOf(itemOf(p.body, "Phone")).some((b) => textOf(b) === "Forget"));
  // The first read failing: nothing was read, and that is said as before.
  const first = await open({ devices: [FULL, AGENTS], readFails: { on: true } });
  assert.deepEqual(cards(first.body), []);
  assert.match(textOf(first.body), /The machines and devices paired here could not be read: the network went away/);
});

// (fails before: yes — the swarm's review of 11-10: two grants pressed together were sent together, and the answer of the
// first, read after the second's, put the second's pill back while the server kept it on)
test("two grants of one device pressed together are saved one after the other: each pill as the server keeps it, whatever order the answers come in", async () => {
  /** @type {{ on: boolean, out: (() => void)[] }} */
  const patchHeld = { on: true, out: [] };
  const p = await open({ devices: [FULL, AGENTS], patchHeld });
  const models = "Its chats may use this machine's models (Filament agents on Laptop)";
  const unasked = "May run without asking (Filament agents on Laptop)";
  pillOf(p.body, models).attrs.onclick();
  await settle();
  pillOf(p.body, unasked).attrs.onclick();
  await settle();
  // The newest answer out let go first, each time.
  while (patchHeld.out.length) {
    /** @type {() => void} */ (patchHeld.out.pop())();
    await settle();
  }
  const kept = p.devices().find((d) => d.id === "d-agents").grants;
  assert.deepEqual([kept.models, kept.unasked], [true, true], "the server keeps both");
  assert.deepEqual([pillOf(p.body, models).attrs["aria-pressed"], pillOf(p.body, unasked).attrs["aria-pressed"]], ["true", "true"]);
  assert.equal(p.calls.filter(([m]) => m === "PATCH").length, 2);
});

// (fails before: yes — the remote access redesign: a machine's app device, its agents' device and this window's line to
// it were three lines in three places)
test("one card per machine: its app's device and its agents' on one card, by the machine's id where its claim kept one, else by name; this window's line to it on the same card; a second app device of one machine, a browser, a command line and an agents' device revoked alone listed apart", async () => {
  const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const app = { ...FULL, id: "d-mbp", name: "Filament app on MacBook Pro", machine: ID };
  const old = { ...app, id: "d-mbp-old", createdAt: T0 - 50, revokedAt: T0 - 5 };
  const mbpAgents = { ...AGENTS, id: "d-mbp-agents", name: "Filament agents on MacBook Pro", of: "d-mbp", from: "MacBook Pro" };
  // No id from its claim (an app before rd-id): its card by its name.
  const ubuntu = { ...FULL, id: "d-ubu", name: "Filament app on Ubuntu desktop" };
  // Its full device forgotten already: a card by the name its machine gave.
  const pi = { ...AGENTS, id: "d-pi-agents", name: "Filament agents on Raspberry Pi", of: "d-gone", from: "Raspberry Pi" };
  const cli = { ...FULL, id: "d-cli", name: "Command line on build-box", kind: "cli" };
  const alone = { ...AGENTS, id: "d-alone", name: "Filament agents on Studio", of: "d-studio-gone", from: "Studio", revokedAt: T0 - 7 };
  const rows = [
    { id: ID.toUpperCase(), name: "MBP", on: true, kept: true, ready: true, words: null },
    { id: "m-ubu", name: "ubuntu DESKTOP", on: false, kept: false, ready: true, words: null },
    { id: "m-box", name: "Build box", on: false, kept: false, ready: false, away: "quiet", words: "Build box does not answer." },
  ];
  const devices = [old, app, mbpAgents, ubuntu, pi, cli, VIEW, alone];
  const { cards: got, loose } = machinesOf(devices, rows);
  assert.deepEqual(got.map((c) => [c.key, c.name, c.app?.id ?? null, c.agents?.id ?? null, c.row?.id ?? null]), [
    [ID, "MBP", "d-mbp", "d-mbp-agents", ID.toUpperCase()],
    ["name:ubuntu desktop", "ubuntu DESKTOP", "d-ubu", null, "m-ubu"],
    ["name:raspberry pi", "Raspberry Pi", null, "d-pi-agents", null],
    ["m-box", "Build box", null, null, "m-box"],
  ]);
  assert.deepEqual(loose.map((d) => d.id), ["d-cli", "d-phone", "d-mbp-old", "d-alone"]);
  // Two rows of one name, or a card its claim named by id: no match by name.
  assert.equal(machinesOf([ubuntu], [rows[1], { ...rows[1], id: "m-ubu-2" }]).cards.filter((c) => c.app).at(0)?.row, null);
  assert.equal(machinesOf([app], [{ ...rows[0], id: "m-other", name: "MacBook Pro" }]).cards[0].row, null);

  const p = await open({ devices, app: bridge(rows).app });
  assert.deepEqual(cards(p.body), ["MBP", "ubuntu DESKTOP", "Raspberry Pi", "Build box"]);
  const mbp = cardOf(p.body, ID);
  assert.deepEqual(names(mbp), ["What MBP may do on this machine", "What this machine may do on MBP"], "what it may do here, what this machine may do there");
  assert.match(textOf(mbp), /^MBP\|Connected\|/);
  assert.equal(pills(itemOf(mbp, "What MBP may do on this machine")).length, GRANT_ROWS.length);
  assert.equal(pillOf(mbp, "Let this Filament's agents work on MBP").attrs["aria-pressed"], "true");
  const ubu = cardOf(p.body, "name:ubuntu desktop");
  assert.match(textOf(itemOf(ubu, "What ubuntu DESKTOP may do on this machine")), /Its agents can't work here yet: on ubuntu DESKTOP, press Agents under "What this machine may do on Workstation"\./);
  assert.match(textOf(cardOf(p.body, "m-box")), /^Build box\|Not reachable: Build box doesn't answer\. Check it's on, with Filament open\.\|/);
  assert.ok(hasClass(itemOf(cardOf(p.body, "m-box"), "What Build box may do on this machine"), "is-muted"), "paired here no way: said so, quietly");
  assert.deepEqual(names(p.body).slice(-4), ["Command line on build-box", "Phone", "Filament app on MacBook Pro", "Filament agents on Studio"]);
  assert.ok(buttonsOf(itemOf(p.body, "Filament agents on Studio")).some((b) => textOf(b) === "Forget"), "revoked alone: forgotten from here");

  // A card of its agents alone: Revoke says so, and signs out its agents' device.
  const raspberry = itemOf(cardOf(p.body, "name:raspberry pi"), "What Raspberry Pi may do on this machine");
  assert.match(textOf(raspberry), /Its agents' own sign-in here · not seen yet/);
  buttonsOf(raspberry).find((b) => textOf(b) === "Revoke").attrs.onclick();
  await settle();
  assert.equal(p.asked.at(-1).description, "Its agents are signed out of this machine at once, and what they have open here ends. They come back when Agents is turned on again on Raspberry Pi.");
  assert.deepEqual(p.calls.filter(([m]) => m === "DELETE").at(-1), ["DELETE", "/remote/devices/d-pi-agents", undefined]);
  assert.ok(buttonsOf(itemOf(p.body, "Filament agents on Raspberry Pi")).some((b) => textOf(b) === "Forget"), "revoked: listed apart, to forget");
});

// (fails before: yes — the review of rd-ui: a machine paired again from a window that kept its old sign-in had its card
// take the new device, the agents that came in by the old one shown nowhere, and an app paired before rd-id beside one
// after it was two cards)
test("one machine's two app devices: the card takes the one its agents came in by, the other listed apart with its own agents' pills; one paired before the claim named the machine joins its card's leftovers; Revoke says what it signs out; a view-only window's hint; the window's own card says so", async () => {
  const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const older = { ...FULL, id: "d-old-app", name: "Filament app on Mac mini", machine: ID, createdAt: T0 - 90 };
  const newer = { ...FULL, id: "d-new-app", name: "Filament app on Mac mini", machine: ID, createdAt: T0 - 10 };
  const olderAgents = { ...AGENTS, id: "d-old-agents", name: "Filament agents on Mac mini", of: "d-old-app", from: "Mac mini", grants: { agents: true, full: true } };
  // Listed newest first, as the server lists them.
  const p = await open({ devices: [newer, olderAgents, older] });
  assert.deepEqual(cards(p.body), ["Mac mini"]);
  assert.deepEqual(machinesOf([newer, olderAgents, older]).cards.map((c) => [c.app.id, c.agents?.id]), [["d-old-app", "d-old-agents"]]);
  assert.equal(pills(itemOf(p.body, "What Mac mini may do on this machine")).length, GRANT_ROWS.length, "its agents' pills on the card");
  assert.match(textOf(itemOf(p.body, "What Mac mini may do on this machine")), /Full control: Mac mini's agents act here as you/);
  assert.equal(pills(itemOf(p.body, "Filament app on Mac mini")).length, 0, "the new one, apart, has none of its own");
  // The new one's Revoke: its window alone.
  buttonsOf(itemOf(p.body, "Filament app on Mac mini")).find((b) => textOf(b) === "Revoke").attrs.onclick();
  await settle();
  assert.equal(p.asked.at(-1).description, "Its token stops now, and what it has open here — a terminal, the live view — closes. It pairs again with a new code.");

  // Both with agents: the card takes the newest, the window's sign-in now; the one apart shows its own, and its Revoke
  // says both go.
  const newerAgents = { ...olderAgents, id: "d-new-agents", of: "d-new-app", grants: { agents: true } };
  const two = await open({ devices: [newerAgents, newer, olderAgents, older] });
  const apart = itemOf(two.body, "Filament app on Mac mini");
  assert.match(textOf(apart), /Mac mini's agents work here by this sign-in too: Revoke signs both out\./);
  assert.equal(pillOf(apart, "Agents may work here (Filament agents on Mac mini)").attrs["data-grant"], "agents");
  assert.equal(pills(apart).length, GRANT_ROWS.length);
  buttonsOf(apart).find((b) => textOf(b) === "Revoke").attrs.onclick();
  await settle();
  assert.equal(two.asked.at(-1).title, "Revoke Mac mini?");
  assert.equal(two.asked.at(-1).description, "Its app and its agents are signed out of this machine at once. To undo, pair it again with a code.");
  assert.deepEqual(two.calls.filter(([m]) => m === "DELETE").at(-1), ["DELETE", "/remote/devices/d-old-app", undefined]);

  // Paired before the claim named the machine, revoked, beside one after: one card.
  const before = { ...FULL, id: "d-before", name: "Filament app on Mac mini", createdAt: T0 - 200, revokedAt: T0 - 100 };
  const one = await open({ devices: [newer, before] });
  assert.deepEqual(cards(one.body), ["Mac mini"]);
  assert.match(textOf(itemOf(one.body, "Filament app on Mac mini")), /revoked/);
  // A card with no agents: its Revoke signs its window out, said so.
  buttonsOf(itemOf(one.body, "What Mac mini may do on this machine")).find((b) => textOf(b) === "Revoke").attrs.onclick();
  await settle();
  assert.equal(one.asked.at(-1).description, "Its app is signed out of this machine at once. To undo, pair it again with a code.");

  // A view-only window: no press there lets its agents in.
  const view = await open({ devices: [{ ...newer, scope: "view" }] });
  assert.match(textOf(itemOf(view.body, "What Mac mini may do on this machine")), /Its agents can't work here: its app is paired view-only\. Pair it again with a full code to let them\./);
  assert.doesNotMatch(textOf(view.body), /press Agents/);

  // Opened from that machine's window: its own card says so.
  const far = await open({ devices: [newer], state: { viewer: "remote", device: { id: "d-new-app", name: newer.name, scope: "full" } } });
  assert.deepEqual(names(far.body), ["What Mac mini (this device) may do on Workstation"]);
});

// (fails before: yes — the owner's of 11-08: a switch row for each thing on each machine, two hundred for a hundred
// machines; no filter)
test("a long list: from FILTER_FROM machines, or browsers and command lines, a filter by name over each, typed into, the list alone drawn again; none matching, said; a list made short again filters by nothing", async () => {
  const many = Array.from({ length: FILTER_FROM }, (_, i) => ({ ...FULL, id: `d-${i}`, name: i === 3 ? "Studio" : `Laptop ${i}` }));
  const p = await open({ devices: many });
  const field = every(p.body, (n) => n.attrs?.["data-filter"] === "devices")[0];
  assert.ok(field, "a filter over the devices");
  assert.equal(field.attrs.placeholder, `Filter ${FILTER_FROM} devices`);
  const asked = p.calls.length;
  field.attrs.oninput({ target: { value: "stud" } });
  assert.deepEqual(names(p.body), ["Studio"]);
  assert.equal(every(p.body, (n) => n.attrs?.["data-filter"] === "devices")[0], field, "the field itself stays");
  assert.equal(p.calls.length, asked, "nothing read again: the list alone drawn");
  field.attrs.oninput({ target: { value: "nothing like it" } });
  assert.deepEqual(names(p.body), []);
  assert.match(textOf(p.body), /No devices named so\./);
  // Fewer: no filter.
  const few = await open({ devices: many.slice(0, FILTER_FROM - 1) });
  assert.equal(every(few.body, (n) => n.attrs?.["data-filter"]).length, 0);

  // (fails before: yes — the review of ui-machines: a list made short with a filter typed kept filtering, its field
  // gone, "No devices named so." with nothing to clear it)
  const short = await open({ devices: many });
  every(short.body, (n) => n.attrs?.["data-filter"] === "devices")[0].attrs.oninput({ target: { value: "Laptop 7" } });
  assert.deepEqual(names(short.body), ["Laptop 7"]);
  buttonsOf(itemOf(short.body, "Laptop 7")).find((b) => textOf(b) === "Revoke").attrs.onclick();
  await settle();
  buttonsOf(itemOf(short.body, "Laptop 7")).find((b) => textOf(b) === "Forget").attrs.onclick();
  await settle();
  assert.equal(every(short.body, (n) => n.attrs?.["data-filter"]).length, 0, "too few for a field");
  assert.equal(names(short.body).length, FILTER_FROM - 1, "and none filtered out");

  // The machines, the same: found by a card's name, a pill pressed draws it again with what was typed kept.
  const apps = Array.from({ length: FILTER_FROM }, (_, i) => ({ ...FULL, id: `d-${i}`, name: `Filament app on ${i === 3 ? "Workbench" : `Box ${i}`}` }));
  const m = await open({ devices: [...apps, { ...AGENTS, of: "d-3", name: "Filament agents on Workbench" }] });
  const cardsField = every(m.body, (n) => n.attrs?.["data-filter"] === "machines")[0];
  assert.equal(cardsField.attrs.placeholder, `Filter ${FILTER_FROM} machines`);
  cardsField.attrs.oninput({ target: { value: "WORK" } });
  assert.deepEqual(cards(m.body), ["Workbench"]);
  pillOf(m.body, "Agents may work here (Filament agents on Workbench)").attrs.onclick();
  await settle();
  assert.equal(every(m.body, (n) => n.attrs?.["data-filter"] === "machines")[0].attrs.value, "WORK");
  assert.deepEqual(cards(m.body), ["Workbench"]);
  // The window's own machines count among them.
  const rows = Array.from({ length: FILTER_FROM }, (_, i) => ({ id: `m-${i}`, name: i === 5 ? "Mac mini" : `Box ${i}`, on: false, kept: false, ready: true, words: null }));
  const app = await open({ app: bridge(rows).app });
  every(app.body, (n) => n.attrs?.["data-filter"] === "machines")[0].attrs.oninput({ target: { value: "MAC" } });
  assert.deepEqual(cards(app.body), ["Mac mini"]);
});

/**
 * The app's bridge as the page sees it, over rows main would answer: its calls recorded.
 * @param {any[]} rows @param {{ on?: (id: string, on: boolean) => any }} [o]
 */
const bridge = (rows, o = {}) => {
  /** @type {any[][]} */
  const calls = [];
  let list = structuredClone(rows);
  return {
    calls,
    app: {
      addMachine: () => void calls.push(["add"]),
      agentMachines: async () => (calls.push(["list"]), { machines: structuredClone(list) }),
      agentsOn: async (/** @type {string} */ id, /** @type {boolean} */ on) => {
        calls.push(["on", id, on]);
        const got = o.on ? o.on(id, on) : { ...list.find((x) => x.id === id), on, kept: true };
        list = list.map((x) => (x.id === id ? got : x));
        return got;
      },
      agentsForget: async (/** @type {string} */ id) => {
        calls.push(["forget", id]);
        const got = { ...list.find((x) => x.id === id), on: false, kept: false, said: "Forgotten here, and revoked on Mac mini" };
        list = list.map((x) => (x.id === id ? got : x));
        return got;
      },
    },
  };
};

// (fails before: yes — the app's page had Add a machine alone: no switch let this Filament's agents work on another machine)
test("in the desktop app: each machine's card has a line for this machine there, its Agents pill moved by the app; Forget where a token is kept and the machine does not answer; what stands in the way said, the pill still; a browser shows nothing new", async () => {
  const b = bridge([
    { id: "m-mac", name: "Mac mini", on: false, kept: false, ready: true, words: null },
    { id: "m-box", name: "Build box", on: false, kept: false, ready: false, words: "Build box does not answer: nothing listens at https://10.0.0.5:20343." },
  ]);
  const p = await open({ app: b.app });
  assert.deepEqual(labels(p.body), ["This machine", "Add a machine", "New code"]);
  assert.deepEqual(cards(p.body), ["Mac mini", "Build box"]);
  assert.deepEqual(names(cardOf(p.body, "m-mac")), ["What Mac mini may do on this machine", "What this machine may do on Mac mini"]);
  assert.match(textOf(itemOf(p.body, "What Mac mini may do on this machine")), /Not paired with this machine/);
  const agents = "Let this Filament's agents work on Mac mini";
  const mac = itemOf(p.body, "What this machine may do on Mac mini");
  assert.equal(pillOf(mac, agents).attrs.title, thereWords("Mac mini"), "its whole meaning in its title");
  assert.equal(thereWords("Mac mini"), "This machine's agents may start chats on Mac mini and run commands there as you. What they ask comes to you here.");
  assert.equal(textOf(pillOf(mac, agents)), "Agents");
  assert.ok(!buttonsOf(mac).some((x) => String(x.attrs["aria-label"]).startsWith("Forget")), "nothing kept: nothing to forget");
  const box = itemOf(p.body, "What this machine may do on Build box");
  assert.match(textOf(box), /Build box does not answer: nothing listens at/);
  assert.equal(pillOf(box, "Let this Filament's agents work on Build box").attrs.disabled, "", "a machine that does not answer: its pill stays");
  assert.match(pillOf(box, "Let this Filament's agents work on Build box").attrs.title, /Build box does not answer/, "and its title says why");

  pillOf(mac, agents).attrs.onclick();
  await settle();
  assert.deepEqual(b.calls.filter((c) => c[0] === "on"), [["on", "m-mac", true]]);
  assert.deepEqual(p.toasts.at(-1), ["This Filament's agents may work on Mac mini", undefined]);
  const on = itemOf(p.body, "What this machine may do on Mac mini");
  assert.equal(pillOf(on, agents).attrs["aria-pressed"], "true");
  assert.ok(!buttonsOf(on).some((x) => String(x.attrs["aria-label"]).startsWith("Forget")), "kept and answering: Agents switches it off");

  // Kept, and not answering: Forget, asked first, by the app.
  const quiet = bridge([{ id: "m-mac", name: "Mac mini", on: false, kept: true, ready: false, away: "quiet", words: "Mac mini does not answer." }]);
  const q = await open({ app: { ...quiet.app, agentsFull: async () => ({}) } });
  // (fails before: yes — the swarm's review of 11-10: a machine that does not answer drew its Agents and Full control off,
  // where each may still be on there, and Forget beside them read as letting go of nothing live)
  for (const label of [agents, fullLabel("Mac mini")]) {
    const unknown = pillOf(q.body, label);
    assert.equal(unknown.attrs["aria-pressed"], "mixed", label);
    assert.match(String(unknown.attrs.class), /\bis-unknown\b/, label);
    assert.equal(unknown.attrs.title, "Mac mini does not answer. Whether it is on there is unknown until it answers.", label);
  }
  const notKept = await open({ app: { ...bridge([{ id: "m-mac", name: "Mac mini", on: false, kept: false, ready: false, away: "quiet", words: "Mac mini does not answer." }]).app, agentsFull: async () => ({}) } });
  assert.equal(pillOf(notKept.body, agents).attrs["aria-pressed"], "false", "no device kept here: off, as it is");
  buttonsOf(itemOf(q.body, "What this machine may do on Mac mini")).find((x) => x.attrs["aria-label"] === "Forget this Filament's agents on Mac mini").attrs.onclick();
  await settle();
  assert.match(q.asked.at(-1).title, /Forget this Filament's agents on Mac mini\?/);
  assert.deepEqual(quiet.calls.at(-1), ["forget", "m-mac"]);
  assert.deepEqual(q.toasts.at(-1), ["Forgotten here, and revoked on Mac mini", undefined]);
  assert.equal(pillOf(q.body, agents).attrs["aria-pressed"], "false");

  // A browser, and another machine's page: nothing new.
  const plain = await open();
  assert.ok(!labels(plain.body).includes("Add a machine") && !pills(plain.body).length, "a browser has no app");
  const far = await open({ app: bridge([{ id: "m-mac", name: "Mac mini", on: false, kept: false, ready: true, words: null }]).app, state: { viewer: "remote", device: { id: "d9", name: "Laptop", scope: "full" } } });
  assert.ok(!labels(far.body).includes("Add a machine") && !pills(far.body).length, "another machine's page drives no window of this one's");
});

// (fails before: yes — the review of ui-machines: with its Browser on, a machine's line said the link alone, and what
// the machine said of this Filament's device there — revoked there — was said nowhere)
test("a machine's own words are on its line and in its Agents pill's title, its browser link's in its Browser pill's; a line that warns is said so", async () => {
  const revoked = "Its agents' device on Mac mini was revoked there: switched on, Mac mini makes a new one.";
  const linked = "Connected: Mac mini's chats open their pages in this app.";
  const p = await open({ app: { ...bridge([
    { id: "m-mac", name: "Mac mini", on: false, kept: true, ready: true, words: revoked, browser: true, browserLink: "connected", browserWords: linked },
    { id: "m-box", name: "Build box", on: false, kept: false, ready: false, words: "Build box does not answer: nothing listens at https://10.0.0.5:20343." },
  ]).app, browserOn: async () => null } });
  const mac = itemOf(p.body, "What this machine may do on Mac mini");
  assert.equal(textOf(lines(mac)[0]), revoked);
  assert.ok(pillOf(mac, "Let this Filament's agents work on Mac mini").attrs.title.endsWith(revoked));
  assert.ok(pillOf(mac, "Let Mac mini use this app's browser").attrs.title.endsWith(linked));
  assert.equal(hasClass(lines(mac)[0], "is-warn"), false);
  assert.equal(hasClass(lines(itemOf(p.body, "What this machine may do on Build box"))[0], "is-warn"), true);
});

test("an outcome that went wrong is said as the app said it", async () => {
  const b = bridge([{ id: "m-mac", name: "Mac mini", on: false, kept: false, ready: true, words: null }], {
    on: (id) => ({ id, name: "Mac mini", on: false, kept: false, ready: false, words: "This app's sign-in on Mac mini is gone.", said: "Not switched on: This app's sign-in on Mac mini is gone.", failed: true }),
  });
  const p = await open({ app: b.app });
  pillOf(p.body, "Let this Filament's agents work on Mac mini").attrs.onclick();
  await settle();
  assert.deepEqual(p.toasts.at(-1), ["Not switched on: This app's sign-in on Mac mini is gone.", "err"]);
  assert.match(textOf(itemOf(p.body, "What this machine may do on Mac mini")), /sign-in on Mac mini is gone/);
});

// (fails before: yes — the store kept a machine only by claiming a pairing's code)
test("the machines store keeps a machine with a token it was given: sealed, said without it, the agents' device kept beside the person's; plain http to another machine and a short fingerprint refused; an agents' device forgotten asks nothing there", async (t) => {
  const dataDir = folder(t);
  const machines = createMachines({ dataDir });
  const token = "fdt_given-by-the-mint";
  const kept = machines.keep({ url: "https://192.0.2.7:20343/ui/harness.html", fingerprint: PRINT.toLowerCase().replace(/:/g, ""), machine: { id: "m-box", name: "Workstation" }, device: { id: "d-agents", name: "Filament agents on Laptop", scope: "agent" }, token });
  assert.equal("token" in kept, false, "said without its token");
  assert.deepEqual([kept.url, kept.fingerprint, kept.machine, kept.device], ["https://192.0.2.7:20343", PRINT, { id: "m-box", name: "Workstation" }, { id: "d-agents", name: "Filament agents on Laptop", scope: "agent" }]);
  assert.deepEqual(machines.list(), [kept]);
  assert.deepEqual(machines.find("workstation", { agents: true }), kept);
  assert.equal(machines.find("workstation"), null, "a name alone says the person's device, and none is kept");
  const file = readFileSync(join(dataDir, REMOTES_FILE), "utf8");
  assert.ok(!file.includes(token), "the file never holds the token plain");
  assert.ok(isSealed(JSON.parse(file).remotes[0].token));
  assert.equal(readRemotes(dataDir)[0].token, token);

  // Kept again: the one machine, as the new device.
  machines.keep({ url: "https://192.0.2.7:20343", machine: { id: "m-box", name: "Workstation" }, device: { id: "d-agents-2", name: "Filament agents on Laptop", scope: "agent" }, token: "fdt_second" });
  assert.deepEqual(machines.list().map((m) => [m.machine.id, m.device.id, m.fingerprint]), [["m-box", "d-agents-2", undefined]]);

  assert.throws(() => machines.keep({ url: "http://192.0.2.7:20300", machine: { id: "m-x" }, device: { id: "d" }, token: "fdt_x" }), /plain http to another machine/);
  assert.throws(() => machines.keep({ url: "https://192.0.2.7", fingerprint: "AB:CD", machine: { id: "m-x" }, device: { id: "d" }, token: "fdt_x" }), /64 hex digits/);
  assert.throws(() => machines.keep({ url: "https://192.0.2.7", machine: { id: "m-x" }, device: { id: "d" }, token: "" }), /no token/);
  assert.equal(machines.list().length, 1, "nothing refused is kept");

  // Forgotten: an agents' device signs nothing out there, so nothing is asked of an address that would not answer.
  const at = Date.now();
  const gone = await machines.forget("m-box", { agents: true });
  assert.ok(Date.now() - at < 2000, "nothing waited on the machine");
  assert.deepEqual([gone.signedOut, gone.machine.device.id], [false, "d-agents-2"]);
  assert.match(String(gone.why), /does not sign itself out: it stays listed on Workstation until it is revoked/);
  assert.deepEqual(machines.list(), []);
});

/**
 * A machine's admin API as main reaches it, scripted: `/remote/me`'s answer, its device list, the mint, a grant and a
 * revoke as the server answers them; every call recorded with the Cookie it carried.
 * @param {{ me?: { status: number, json: any }, mint?: () => { status: number, json: any }, projects?: { status: number, json: any } }} [o]
 */
function scripted(o = {}) {
  /** @type {any[]} */
  const devices = [{ ...FULL, id: "d-window" }];
  /** @type {[string, string, string][]} */
  const calls = [];
  /** The bodies the mint was sent. @type {any[]} */
  const mints = [];
  let minted = 0;
  /** @param {number} status @param {any} json */
  const answer = (status, json) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = /** @type {typeof fetch} */ (
    async (u, init = {}) => {
      const url = new URL(String(u));
      const method = init.method || "GET";
      const path = url.pathname.replace(/^\/api/, "");
      calls.push([method, path, String(/** @type {any} */ (init.headers)?.cookie || "")]);
      if (path === "/remote/me") return o.me ? answer(o.me.status, o.me.json) : answer(200, { who: "device", device: devices[0], machine: { id: "m-mac", name: "Mac mini" }, pages: ["new"] });
      if (path === "/remote/devices") return answer(200, { devices });
      if (path === "/memory/projects" && method === "GET") return o.projects ? answer(o.projects.status, o.projects.json) : answer(200, { projects: [] });
      if (path === "/remote/agent-device" && method === "POST") {
        mints.push(JSON.parse(String(init.body ?? "null")));
        if (o.mint) {
          const r = o.mint();
          return answer(r.status, r.json);
        }
        const was = devices.find((d) => d.scope === "agent" && d.revokedAt == null);
        const d = { ...AGENTS, id: `d-agents-${++minted}`, of: "d-window", grants: { ...(was?.grants ?? { agents: false, models: false, browser: false }) } };
        if (was) devices.splice(devices.indexOf(was), 1);
        devices.push(d);
        return answer(200, { device: d, machine: { id: "m-mac", name: "Mac mini" }, token: `fdt_minted-${minted}` });
      }
      const one = /^\/remote\/devices\/(.+)$/.exec(path);
      const d = one ? devices.find((x) => x.id === decodeURIComponent(one[1])) : null;
      if (one && !d) return answer(404, { error: "no such device" });
      // A revoked device's grants are set no more, as the server answers (http/admin/remote.js).
      if (d && method === "PATCH" && d.revokedAt != null) return answer(409, { error: `${d.name} is revoked: no token of theirs comes in, and its grants are set no more` });
      if (d && method === "PATCH") {
        Object.assign(d.grants, JSON.parse(String(init.body)).grants);
        return answer(200, { device: d });
      }
      if (d && method === "DELETE") {
        d.revokedAt = T0;
        return answer(200, { device: d });
      }
      return answer(404, { error: `no route ${path}` });
    }
  );
  return { fetchImpl, calls, devices, minted: () => minted, mints };
}

/** A machine the window keeps, reached at `routes`. @param {Record<string, any>} [o] @returns {import("../desktop/lib/machines.js").Machine} */
const kept = (o = {}) => ({ id: "m-mac", name: "Mac mini", routes: [{ kind: "lan", url: "https://192.0.2.9:20343", fingerprint: PRINT }], partition: "persist:machine-m-mac", addedAt: T0, ...o });

/**
 * The flow over a scripted machine: `pick` answers as the machine at its first route, or as no one where `answers` is off.
 * @param {import("node:test").TestContext} t @param {ReturnType<typeof scripted>} there
 * @param {{ machine?: Record<string, any>, answers?: boolean, ownName?: () => string }} [o]
 */
const flowOver = (t, there, o = {}) => {
  const store = createMachines({ dataDir: folder(t) });
  /** @type {string[]} */
  const picked = [];
  const flow = createMachineAgents({
    machines: () => [kept(o.machine)],
    cookieOf: async (partition) => `__Host-filament_device=cookie-of-${partition}`,
    store,
    pick: async (m) => {
      picked.push(...m.routes.map((r) => String(r.url)));
      return o.answers === false ? { route: null, name: null, version: null, tried: [{ url: String(m.routes[0]?.url), why: `nothing listens at ${m.routes[0]?.url}` }] } : { route: m.routes[0], name: m.name, version: "9", tried: [] };
    },
    fetchOf: () => there.fetchImpl,
    ...(o.ownName ? { ownName: o.ownName } : {}),
  });
  return { flow, store, picked };
};

// (fails before: yes — no flow minted another machine's agents' device or kept its token)
test("main's switch with fakes: on mints the agents' device with the window's sign-in, keeps its token here, switches its grant there; off keeps the token; on again mints nothing; two presses mint once; Forget revokes there and lets the token go", async (t) => {
  const there = scripted();
  const { flow, store } = flowOver(t, there);
  assert.deepEqual(await flow.list(), [{ id: "m-mac", name: "Mac mini", on: false, models: false, full: false, kept: false, ready: true, words: null }]);

  const [a, b] = await Promise.all([flow.set("m-mac", true), flow.set("M-MAC", true)]);
  assert.equal(there.minted(), 1, "two presses at once mint one device");
  assert.deepEqual([a.on, a.kept, a.ready, b.on], [true, true, true, true]);
  assert.ok(there.calls.every(([, , cookie]) => cookie === "__Host-filament_device=cookie-of-persist:machine-m-mac"), "every call as the window's sign-in there");
  const row = store.list()[0];
  assert.deepEqual([row.url, row.fingerprint, row.machine, row.device], ["https://192.0.2.9:20343", PRINT, { id: "m-mac", name: "Mac mini" }, { id: "d-agents-1", name: "Filament agents on Laptop", scope: "agent" }]);
  assert.equal(there.devices.find((d) => d.id === "d-agents-1")?.grants.agents, true);
  assert.equal(JSON.stringify(a).includes("fdt_"), false, "no token in what the page hears");

  const off = await flow.set("m-mac", false);
  assert.deepEqual([off.on, off.kept], [false, true]);
  assert.equal(there.devices.find((d) => d.id === "d-agents-1")?.grants.agents, false);
  assert.equal(store.list().length, 1, "the token kept");
  const again = await flow.set("m-mac", true);
  assert.deepEqual([again.on, there.minted()], [true, 1], "on again: no new mint");

  // Revoked there meanwhile: said, and on again makes a new one.
  /** @type {any} */ (there.devices.find((d) => d.id === "d-agents-1")).revokedAt = T0;
  const revoked = (await flow.list())[0];
  assert.deepEqual([revoked.on, revoked.kept, revoked.ready], [false, true, true]);
  assert.match(String(revoked.words), /was revoked there: switched on, Mac mini makes a new one/);
  const anew = await flow.set("m-mac", true);
  assert.deepEqual([anew.on, there.minted(), store.list()[0].device.id], [true, 2, "d-agents-2"]);

  const forgot = await flow.forget("m-mac");
  assert.deepEqual([forgot.on, forgot.kept, forgot.said], [false, false, "Forgotten here, and revoked on Mac mini"]);
  assert.ok(there.calls.some(([m, path]) => m === "DELETE" && path === "/remote/devices/d-agents-2"));
  assert.equal(there.devices.find((d) => d.id === "d-agents-2")?.revokedAt, T0);
  assert.deepEqual(store.list(), []);
  assert.deepEqual(there.mints, [{}, {}], "with no name of its own, the mint is sent none");
});

// (fails before: yes — the mint was sent no name, so the machine named this Filament's agents for the app's device there,
// "Filament agents on Filament app on DESKTOP-1", and their chats "From Filament app on DESKTOP-1's agents")
test("main's switch sends this machine's own name with the mint, as its Settings › Remote access › This machine says it", async (t) => {
  const there = scripted();
  const { flow } = flowOver(t, there, { ownName: () => " DESKTOP-1 " });
  assert.equal((await flow.set("m-mac", true)).on, true);
  assert.deepEqual(there.mints, [{ from: "DESKTOP-1" }]);
});

// (fails before: yes — the f-ui hunt's: a keep that failed threw out of the switch, which the page said as a bare
// "Not switched on")
test("main's switch: a device minted there whose token cannot be kept here is said so, its grant left off there; on again mints another", async (t) => {
  const there = scripted();
  const { flow, store } = flowOver(t, there);
  const keep = store.keep;
  store.keep = () => {
    throw new Error("EACCES: permission denied, open 'remotes.json'");
  };
  const row = await flow.set("m-mac", true);
  assert.deepEqual([row.on, row.kept, row.failed], [false, false, true]);
  assert.equal(row.said, "Mac mini made this Filament's agents a device, and its token could not be kept here: EACCES: permission denied, open 'remotes.json'. Switch it on again, and Mac mini makes another.");
  assert.equal(there.devices.find((d) => d.id === "d-agents-1")?.grants.agents, false, "its grant never switched on there");
  store.keep = keep;
  const again = await flow.set("m-mac", true);
  assert.deepEqual([again.on, there.minted(), store.list()[0].device.id], [true, 2, "d-agents-2"]);
});

// (fails before: yes — the f-ui hunt's: the kept row's name stayed the one it was minted under, after the window renamed it)
test("main's switch on again: the kept row takes the machine's name as this window has it now", async (t) => {
  const there = scripted();
  /** @type {Record<string, any>} */
  const machine = {};
  const store = createMachines({ dataDir: folder(t) });
  const flow = createMachineAgents({
    machines: () => [kept(machine)],
    cookieOf: async () => "__Host-filament_device=c",
    store,
    pick: async (m) => ({ route: m.routes[0], name: m.name, version: "9", tried: [] }),
    fetchOf: () => there.fetchImpl,
  });
  assert.equal((await flow.set("m-mac", true)).on, true);
  assert.equal(store.list()[0].machine.name, "Mac mini");
  machine.name = "Studio";
  assert.equal((await flow.set("m-mac", false)).on, false);
  assert.equal((await flow.set("m-mac", true)).on, true);
  assert.deepEqual([there.minted(), store.list()[0].machine], [1, { id: "m-mac", name: "Studio" }]);
});

// (fails before: yes — the swarm's review of 11-10, the owner's own of 11-10: the kept row took the window's way to the
// machine at Agents on alone, so a machine that moved was called at its old address by sub-agents, commands and models
// while Settings read it at its new one)
test("the kept agents' device follows the way this window reaches its machine by, at each read and each switch, its token kept", async (t) => {
  const there = scripted();
  const machine = /** @type {Record<string, any>} */ ({});
  const store = createMachines({ dataDir: folder(t) });
  const flow = createMachineAgents({
    machines: () => [kept(machine)],
    cookieOf: async () => "__Host-filament_device=c",
    store,
    pick: async (m) => ({ route: m.routes[0], name: m.name, version: "9", tried: [] }),
    fetchOf: () => there.fetchImpl,
  });
  assert.equal((await flow.set("m-mac", true)).on, true);
  const wayOf = () => store.list().map((r) => [r.url, r.fingerprint ?? null, r.device.id]);
  assert.deepEqual(wayOf(), [["https://192.0.2.9:20343", PRINT, "d-agents-1"]]);
  const OTHER = PRINT.replace(/^../, "CD");
  machine.routes = [{ kind: "lan", url: "https://192.0.2.77:20343", fingerprint: OTHER }];
  await flow.list();
  assert.deepEqual(wayOf(), [["https://192.0.2.77:20343", OTHER, "d-agents-1"]], "a read of the list");
  machine.routes = [{ kind: "url", url: "https://mac.tail1234.ts.net" }];
  assert.equal((await flow.models("m-mac", true)).models, true);
  assert.deepEqual(wayOf(), [["https://mac.tail1234.ts.net", null, "d-agents-1"]], "a grant's switch; a tailnet's needs no pin");
  machine.routes = [{ kind: "lan", url: "https://192.0.2.9:20343", fingerprint: PRINT }];
  assert.equal((await flow.set("m-mac", false)).on, false);
  assert.deepEqual(wayOf(), [["https://192.0.2.9:20343", PRINT, "d-agents-1"]], "Agents off");
  assert.equal(there.minted(), 1, "nothing minted");
  // Revoked there: the row stays as it was, for Forget or a new mint to take its place.
  /** @type {any} */ (there.devices.find((d) => d.id === "d-agents-1")).revokedAt = T0;
  machine.routes = [{ kind: "lan", url: "https://192.0.2.200:20343", fingerprint: OTHER }];
  await flow.list();
  assert.deepEqual(wayOf(), [["https://192.0.2.9:20343", PRINT, "d-agents-1"]]);
});

test("main's switch says what stands in the way, and moves nothing: no answer, the sign-in gone, view-only, a tailnet login, an SSH tunnel alone, disconnected; a mint refused; a command line's device kept beside it", async (t) => {
  const quiet = scripted();
  const none = await flowOver(t, quiet, { answers: false }).flow.set("m-mac", true);
  assert.deepEqual([none.ready, none.on, none.failed], [false, false, true]);
  assert.equal(none.said, "Not switched on: Mac mini does not answer: nothing listens at https://192.0.2.9:20343.");
  assert.equal(quiet.calls.length, 0, "nothing sent where the machine did not answer as itself");

  const gone = (await flowOver(t, scripted({ me: { status: 401, json: { error: "pair this device" } } })).flow.list())[0];
  assert.match(String(gone.words), /This app's sign-in on Mac mini is gone — revoked there, or signed out: pair it again with Add a machine/);
  // (fails before: yes — s4f: one that lapsed unused there was said revoked)
  const lapsed = (await flowOver(t, scripted({ me: { status: 403, json: { error: "this device went unused here for 90 days…", lapsed: true, pair: "/ui/pair.html" } } })).flow.list())[0];
  assert.equal(lapsed.words, "This app's sign-in on Mac mini ran out: it went unused there for 90 days. Pair it again with Add a machine and a code from its Settings › Remote access.");
  assert.equal(lapsed.ready, false);
  const view = (await flowOver(t, scripted({ me: { status: 200, json: { who: "device", device: { ...VIEW } } } })).flow.list())[0];
  assert.match(String(view.words), /paired with Mac mini view-only: a full device lets this Filament's agents in/);
  const tail = (await flowOver(t, scripted({ me: { status: 200, json: { who: "tailnet", login: "me@example.com" } } })).flow.list())[0];
  assert.match(String(tail.words), /by your tailnet login, not as a paired device/);
  for (const r of [gone, view, tail]) assert.equal(r.ready, false);

  const ssh = flowOver(t, scripted(), { machine: { routes: [{ kind: "ssh", url: "http://127.0.0.1:41000", alias: "mac", port: 20300 }, { kind: "url", url: "http://localhost:20310" }] } });
  const sshRow = (await ssh.flow.list())[0];
  assert.match(String(sshRow.words), /through an SSH tunnel alone, where it is no paired device/);
  assert.deepEqual(ssh.picked, [], "no way asked: none is https");
  const mixed = flowOver(t, scripted(), { machine: { routes: [{ kind: "ssh", url: "http://127.0.0.1:41000", alias: "mac", port: 20300 }, { kind: "url", url: "https://mac.tail0.ts.net" }] } });
  await mixed.flow.list();
  assert.deepEqual(mixed.picked, ["https://mac.tail0.ts.net"], "the https way alone");

  const off = (await flowOver(t, scripted(), { machine: { off: true } }).flow.list())[0];
  assert.match(String(off.words), /disconnected in this window/);

  const refused = scripted({ mint: () => ({ status: 403, json: { error: "a full device paired with this Filament mints its machine's agents a device here; this is none" } }) });
  const r = flowOver(t, refused);
  const no = await r.flow.set("m-mac", true);
  assert.equal(no.said, "Mac mini made no device for this Filament's agents: a full device paired with this Filament mints its machine's agents a device here; this is none");
  assert.deepEqual([no.on, no.kept, r.store.list().length], [false, false, 0]);

  // The command line connected to it already: the agents' device is kept beside its device, never in its place.
  const cli = flowOver(t, scripted());
  // Kept as `filament connect` keeps a full device (connectTo writes the same row).
  cli.store.keep({ url: "https://192.0.2.9:20343", machine: { id: "m-mac", name: "Mac mini" }, device: { id: "d-cli", name: "Laptop (command line)", scope: "full" }, token: "fdt_cli" });
  assert.deepEqual((await cli.flow.list())[0].kept, false, "a command line's device is no agents' device");
  const took = await cli.flow.set("m-mac", true);
  assert.deepEqual([took.on, took.said], [true, undefined]);
  assert.deepEqual(cli.store.list().map((m) => m.device.scope), ["full", "agent"]);
  assert.equal(cli.store.find("Mac mini")?.device.id, "d-cli", "a name says the person's");
  assert.equal(cli.store.find("Mac mini", { agents: true })?.device.scope, "agent");

  const unknown = await cli.flow.set("m-gone", true);
  assert.deepEqual([unknown.failed, unknown.ready], [true, false]);
});

// Two Filaments: main's flow against a real one, its sign-in a full device's token as the window's partition sends it.
test("main's switch against another Filament: the agents' device minted there and kept here, sealed, reaching it as itself; off and on again; Forget revokes it there", async (t) => {
  const two = await startTwoMachines();
  t.after(() => two.stop());
  const { there } = two;
  // This Filament's data folder, as the desktop app's: its window's sign-in on `there` is the partition's, not in it.
  const here = folder(t);
  const store = createMachines({ dataDir: here });
  const machine = { id: there.machine.id.toLowerCase(), name: there.machine.name, routes: [{ kind: "lan", url: there.far, fingerprint: there.lan.fingerprint }], partition: "persist:machine-x", addedAt: T0 };
  const flow = createMachineAgents({ machines: () => [machine], cookieOf: async () => `filament_device=${two.remote.token}`, store });
  /** The device list as `there` keeps it. */
  const listed = async () => (await (await there.api("/api/remote/devices")).json()).devices;

  assert.deepEqual(await flow.list(), [{ id: machine.id, name: "Workstation", on: false, models: false, full: false, kept: false, ready: true, words: null }]);
  const on = await flow.set(machine.id, true);
  assert.deepEqual([on.on, on.kept, on.said], [true, true, undefined]);
  const agents = (await listed()).filter((/** @type {any} */ d) => d.scope === "agent");
  assert.equal(agents.length, 1);
  assert.deepEqual([agents[0].name, agents[0].grants.agents, agents[0].of], ["Filament agents on Laptop", true, two.remote.device.id]);
  assert.ok(isSealed(JSON.parse(readFileSync(join(here, REMOTES_FILE), "utf8")).remotes[0].token), "its token sealed");
  const kept = store.list()[0];
  assert.deepEqual([kept.device.id, kept.device.scope, kept.url, kept.fingerprint], [agents[0].id, "agent", there.far, there.lan.fingerprint]);
  // This Filament's own agents reach it now with that token, as its agents' device.
  const client = await store.clientOf(machine.id, { agents: true });
  const me = await client.get("/remote/me");
  assert.deepEqual([me.who, me.device?.scope, me.device?.name], ["device", "agent", "Filament agents on Laptop"]);

  const off = await flow.set(machine.id, false);
  assert.deepEqual([off.on, off.kept], [false, true]);
  assert.equal((await listed()).find((/** @type {any} */ d) => d.id === agents[0].id)?.grants.agents, false);
  const again = await flow.set(machine.id, true);
  assert.equal(again.on, true);
  assert.deepEqual((await listed()).filter((/** @type {any} */ d) => d.scope === "agent").map((/** @type {any} */ d) => d.id), [agents[0].id], "on again: the same device, none minted");

  // (fails before: yes — the review of rd-ui: revoked there, its grant was refused (409) and on again minted nothing,
  // the row saying it would)
  assert.equal((await there.api(`/api/remote/devices/${agents[0].id}`, { method: "DELETE" })).status, 200);
  assert.match(String((await flow.list())[0].words), /was revoked there: switched on, Workstation makes a new one/);
  const anew = await flow.set(machine.id, true);
  assert.deepEqual([anew.on, anew.failed], [true, undefined]);
  const now = (await listed()).filter((/** @type {any} */ d) => d.scope === "agent" && d.revokedAt == null);
  assert.equal(now.length, 1);
  assert.notEqual(now[0].id, agents[0].id, "a new device minted there");
  assert.equal(store.list()[0].device.id, now[0].id);

  const forgot = await flow.forget(machine.id);
  assert.deepEqual([forgot.kept, forgot.on, forgot.said], [false, false, "Forgotten here, and revoked on Workstation"]);
  assert.ok((await listed()).find((/** @type {any} */ d) => d.id === now[0].id)?.revokedAt, "revoked there");
  assert.deepEqual(store.list(), []);
  assert.equal((await flow.list())[0].kept, false);
});

// (fails before: yes — the new-chat menu read no other machine's projects)
test("the new-chat menu's machines: each one's projects read there as the window's sign-in, newest first, the archived and folderless left out; a tailnet login reads them too; one that does not answer, a view-only pairing and a refusal each say why", async (t) => {
  const there = scripted({
    projects: {
      status: 200,
      json: {
        projects: [
          { id: "p1", cwd: "/Users/kai/web-shop", name: "web-shop", archived: false },
          { id: "p2", cwd: "/Users/kai/old", name: "old", archived: true },
          { id: "p3", cwd: "", name: "none" },
          { id: "p4", cwd: "/Users/kai/scratch", name: null, archived: false },
          // (fails before: yes — the swarm's review of 11-10: a project on a share was listed, and its page refused it)
          { id: "p5", cwd: "\\\\wsl$\\Ubuntu\\home\\kai\\app", name: "wsl app" },
          { id: "p6", cwd: "//nas/projects/site", name: "nas site" },
        ],
      },
    },
  });
  const { flow } = flowOver(t, there);
  assert.deepEqual(await flow.projects(), [
    { id: "m-mac", name: "Mac mini", projects: [{ cwd: "/Users/kai/web-shop", name: "web-shop" }, { cwd: "/Users/kai/scratch", name: "" }], words: null },
  ]);
  assert.ok(there.calls.some(([m, path, cookie]) => m === "GET" && path === "/memory/projects" && cookie === "__Host-filament_device=cookie-of-persist:machine-m-mac"), "read as the window's sign-in there");

  const tailnet = scripted({ me: { status: 200, json: { who: "tailnet", machine: { id: "m-mac", name: "Mac mini" }, pages: ["new"] } }, projects: { status: 200, json: { projects: [{ id: "p1", cwd: "/Users/kai/a", name: "a" }] } } });
  assert.deepEqual((await flowOver(t, tailnet).flow.projects())[0].projects, [{ cwd: "/Users/kai/a", name: "a" }]);

  const quiet = flowOver(t, scripted(), { answers: false });
  assert.deepEqual(await quiet.flow.projects(), [{ id: "m-mac", name: "Mac mini", projects: null, words: "Mac mini does not answer: nothing listens at https://192.0.2.9:20343." }]);

  const viewOnly = scripted({ me: { status: 200, json: { who: "device", device: { ...FULL, scope: "view" }, machine: { id: "m-mac", name: "Mac mini" } } } });
  assert.equal((await flowOver(t, viewOnly).flow.projects())[0].words, "This app is paired with Mac mini view-only: a full device starts chats there. Pair it again as Full with Add a machine.");

  const off = flowOver(t, scripted(), { machine: { off: true } });
  assert.equal((await off.flow.projects())[0].words, "Mac mini is disconnected in this window: connect it again from the machines list, and its projects show here.");

  const refused = scripted({ projects: { status: 503, json: { error: "no archive: memory is off" } } });
  assert.deepEqual((await flowOver(t, refused).flow.projects())[0], { id: "m-mac", name: "Mac mini", projects: null, words: "Mac mini's projects could not be read: no archive: memory is off." });
});

// (fails before: no — it pins Settings' words, which the new-chat menu's reach leaves as they were)
test("Settings' switch keeps its own words for a tailnet login and a view-only pairing", async (t) => {
  const tailnet = scripted({ me: { status: 200, json: { who: "tailnet", machine: { id: "m-mac", name: "Mac mini" } } } });
  assert.match(String((await flowOver(t, tailnet).flow.list())[0].words), /by your tailnet login, not as a paired device: pair it with a code from its Settings › Remote access, and this switch moves\.$/);
  const viewOnly = scripted({ me: { status: 200, json: { who: "device", device: { ...FULL, scope: "view" }, machine: { id: "m-mac", name: "Mac mini" } } } });
  assert.match(String((await flowOver(t, viewOnly).flow.list())[0].words), /view-only: a full device lets this Filament's agents in\./);
});

// (fails before: yes — the review of pk-list: a Filament from before was offered, whose page starts a chat in another
// folder; a machine reached through an SSH tunnel alone was greyed; a long folder was cut, opening a chat in another;
// one machine's throw hid every machine; and the menu had no names to draw at the press)
test("the new-chat menu's machines: one whose page opens no new chat at an address is greyed, to update; a tunnel reads as its page does; a folder too long is left out, never cut; one that throws is said and the rest listed; their names at once, nothing asked", async (t) => {
  const old = scripted({ me: { status: 200, json: { who: "device", device: { ...FULL, id: "d-window" }, machine: { id: "m-mac", name: "Mac mini" } } }, projects: { status: 200, json: { projects: [{ id: "p1", cwd: "/a", name: "a" }] } } });
  const before = flowOver(t, old);
  assert.deepEqual(await before.flow.projects(), [{ id: "m-mac", name: "Mac mini", projects: null, words: "Filament on Mac mini opens no new chat from here yet: update it there, and its projects show here." }]);
  assert.equal(old.calls.some(([, path]) => path === "/memory/projects"), false, "nothing more asked of it");

  const tunnel = scripted({ me: { status: 200, json: { who: "local", machine: { id: "m-mac", name: "Mac mini" }, pages: ["new"] } }, projects: { status: 200, json: { projects: [{ id: "p1", cwd: "/a", name: "a" }, { id: "p2", cwd: `/${"x".repeat(450)}`, name: "long" }] } } });
  const through = flowOver(t, tunnel, { machine: { routes: [{ kind: "ssh", url: "http://127.0.0.1:20391", alias: "mac" }] } });
  assert.deepEqual((await through.flow.projects())[0], { id: "m-mac", name: "Mac mini", projects: [{ cwd: "/a", name: "a" }], words: null }, "the long folder left out");
  // Settings' switch still takes no tunnel.
  assert.match(String((await through.flow.list())[0].words), /through an SSH tunnel alone/);

  const store = createMachines({ dataDir: folder(t) });
  const flow = createMachineAgents({
    // A machine kept with no ways to it, as a hand-edited file might: its read throws.
    machines: () => [kept(), kept({ id: "m-box", name: "Build box", partition: "persist:machine-m-box", routes: null })],
    cookieOf: async () => "",
    store,
    pick: async (m) => ({ route: m.routes[0], name: m.name, version: "9", tried: [] }),
    fetchOf: () => scripted({ projects: { status: 200, json: { projects: [{ id: "p1", cwd: "/a", name: "a" }] } } }).fetchImpl,
  });
  assert.deepEqual(flow.names(), [{ id: "m-mac", name: "Mac mini" }, { id: "m-box", name: "Build box" }]);
  const both = await flow.projects();
  assert.deepEqual(both[0].projects, [{ cwd: "/a", name: "a" }]);
  assert.deepEqual([both[1].id, both[1].projects], ["m-box", null]);
  assert.match(String(both[1].words), /^Build box's projects could not be read: .+\.$/);
});
