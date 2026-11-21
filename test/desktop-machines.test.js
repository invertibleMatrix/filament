// @ts-check
// The rail's machines (the owner's remote Filament of 11-06, Part 3): kept in <dataDir>\desktop\machines.json, This
// computer always first and never kept; each machine's routes tried in order, each asked who answers there — cookie-less,
// over its pinned certificate on the network — before a view loads it; each machine online, reconnecting or offline; and
// Ctrl+1..9 to its slot.
// (fails before: yes — the app knew one Filament, its own)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LOCAL_ID, LOCAL_NAME, MACHINES_FILE, RECONNECT_MS, addMachine, machineInSlot, machineWatch, partitionGen, partitionOf, pickRoute, pinsFor, readKept, readMachines, removeMachine, renameMachine, routeOf, setMachineBrowser, setMachineOff, slotOfInput } from "../desktop/lib/machines.js";
import { lanIdentity } from "../src/services/lan-tls.js";

/** @type {string[]} */
const made = [];
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-machines-"));
  made.push(d);
  return join(d, "desktop", MACHINES_FILE);
};
const ORIGIN = "http://127.0.0.1:20300";
const PRINT = `${"AB:".repeat(31)}CD`;
const T0 = Date.UTC(2026, 10, 6, 12, 0);

describe("the list", () => {
  test("This computer first, at the app's own Filament, in the app's own session; the machines kept after it, each in a partition of its own", () => {
    const file = fresh();
    assert.deepEqual(readMachines(file, ORIGIN), [{ id: LOCAL_ID, name: LOCAL_NAME, routes: [{ kind: "url", url: ORIGIN }], partition: "", addedAt: null, local: true }], "nothing kept: This computer alone");
    const box = addMachine(file, { id: "m-box", name: "Workstation", routes: [{ kind: "lan", url: "https://192.168.0.9:20343/ui/pair.html", fingerprint: PRINT.toLowerCase().replace(/:/g, "") }] }, { now: T0 });
    assert.deepEqual(box, { id: "m-box", name: "Workstation", routes: [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: PRINT }], partition: "persist:machine-m-box", addedAt: T0 });
    addMachine(file, { id: "m-mac", name: "Mac mini", routes: [{ kind: "url", url: "http://localhost:20310" }] }, { now: T0 + 1 });
    const rail = readMachines(file, ORIGIN);
    assert.deepEqual(rail.map((m) => [m.id, m.partition]), [[LOCAL_ID, ""], ["m-box", "persist:machine-m-box"], ["m-mac", "persist:machine-m-mac"]]);
    const kept = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(kept.machines.map((/** @type {any} */ m) => Object.keys(m)), [["id", "name", "routes", "partition", "addedAt"], ["id", "name", "routes", "partition", "addedAt"]], "This computer is never kept");
    assert.equal(partitionOf("m-box"), "persist:machine-m-box");
  });

  test("a machine paired again: its name taken, its new route first and the ways it was reached kept after it; renamed; removed", () => {
    const file = fresh();
    addMachine(file, { id: "m-box", name: "Box", routes: [{ kind: "url", url: "http://localhost:20310" }] }, { now: T0 });
    const again = addMachine(file, { id: "m-box", name: "Workstation", routes: [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: PRINT }, { kind: "url", url: "http://localhost:20310/" }] }, { now: T0 + 9 });
    assert.deepEqual([again.name, again.routes.map((r) => r.kind), again.addedAt], ["Workstation", ["lan", "url"], T0], "one route each, the new first; when it was added stays");
    assert.equal(readKept(file).length, 1);
    assert.equal(renameMachine(file, "m-box", "  Studio  ")?.name, "Studio");
    assert.equal(renameMachine(file, "m-none", "x"), null);
    assert.equal(renameMachine(file, "m-box", "  "), null, "no name is none");
    assert.equal(removeMachine(file, "m-box"), true);
    assert.equal(removeMachine(file, "m-box"), false);
    assert.deepEqual(readKept(file), []);
  });

  // (fails before: yes — the owner's of 11-08: a machine could be removed, never only disconnected)
  test("a machine disconnected: kept as it was — its ways, its partition — and read as off, a restart too; renamed, still off; connected again, no mark left; paired again, connected", () => {
    const file = fresh();
    addMachine(file, { id: "m-box", name: "Studio", routes: [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: PRINT }] }, { now: T0 });
    addMachine(file, { id: "m-mac", name: "Mac", routes: [{ kind: "url", url: "https://mac.ts.net" }] }, { now: T0 });
    assert.deepEqual(setMachineOff(file, "m-box", true), { id: "m-box", name: "Studio", routes: [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: PRINT }], partition: "persist:machine-m-box", addedAt: T0, off: true });
    assert.deepEqual(readKept(file).map((m) => [m.id, m.off ?? false]), [["m-box", true], ["m-mac", false]]);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).machines[0].off, true, "in the file: a restart keeps it");
    assert.equal(renameMachine(file, "m-box", "Workstation")?.off, true);
    assert.equal(readKept(file)[0].off, true, "a rename keeps it off");
    assert.equal(setMachineOff(file, "m-box", false)?.off, undefined);
    assert.equal("off" in JSON.parse(readFileSync(file, "utf8")).machines[0], false, "connected: no mark left");
    setMachineOff(file, "m-box", true);
    assert.equal(addMachine(file, { id: "m-box", routes: [{ kind: "url", url: "https://box.ts.net" }] }).off, undefined, "paired again: connected");
    assert.equal(readKept(file)[0].off, undefined);
    assert.equal(setMachineOff(file, "m-none", true), null);
    assert.equal(setMachineOff(file, LOCAL_ID, true), null, "This computer is never off");
    writeFileSync(file, JSON.stringify({ machines: [{ id: "m-a", name: "A", routes: [{ kind: "url", url: "https://a.ts.net" }], off: "yes" }] }));
    assert.equal(readKept(file)[0].off, undefined, "a hand edit's off that is not true is none");
  });

  // (fails before: yes — b-remote: no machine used this app's browser)
  test("a machine let use this app's browser: off until switched on, kept in the file through a rename, a disconnect and a pairing again, and gone with it", () => {
    const file = fresh();
    addMachine(file, { id: "m-box", name: "Studio", routes: [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: PRINT }] }, { now: T0 });
    addMachine(file, { id: "m-mac", name: "Mac", routes: [{ kind: "url", url: "https://mac.ts.net" }] }, { now: T0 });
    assert.deepEqual(readKept(file).map((m) => m.browser ?? false), [false, false], "off at first");
    assert.deepEqual(setMachineBrowser(file, "M-BOX", true), { id: "m-box", name: "Studio", routes: [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: PRINT }], partition: "persist:machine-m-box", addedAt: T0, browser: true });
    assert.deepEqual(readKept(file).map((m) => [m.id, m.browser ?? false]), [["m-box", true], ["m-mac", false]]);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).machines[0].browser, true, "in the file: a restart keeps it");
    assert.equal(renameMachine(file, "m-box", "Workstation")?.browser, true, "a rename keeps it");
    assert.deepEqual(setMachineOff(file, "m-box", true), { ...readKept(file)[0], off: true, browser: true }, "disconnected: kept");
    setMachineOff(file, "m-box", false);
    assert.equal(addMachine(file, { id: "m-box", routes: [{ kind: "url", url: "https://box.ts.net" }] }).browser, true, "paired again: kept");
    assert.equal(readKept(file)[0].browser, true);
    assert.equal(setMachineBrowser(file, "m-box", false)?.browser, undefined);
    assert.equal("browser" in JSON.parse(readFileSync(file, "utf8")).machines[0], false, "off: no mark left");
    setMachineBrowser(file, "m-box", true);
    assert.equal(removeMachine(file, "m-box"), true);
    assert.equal(addMachine(file, { id: "m-box", routes: [{ kind: "url", url: "https://box.ts.net" }] }).browser, undefined, "removed and added anew: off");
    assert.equal(setMachineBrowser(file, "m-none", true), null);
    assert.equal(setMachineBrowser(file, LOCAL_ID, true), null, "This computer's browser is this app's already");
    writeFileSync(file, JSON.stringify({ machines: [{ id: "m-a", name: "A", routes: [{ kind: "url", url: "https://a.ts.net" }], browser: "yes" }] }));
    assert.equal(readKept(file)[0].browser, undefined, "a hand edit's browser that is not true is none");
  });

  // (fails before: yes — a machine's partition was its first alone, whatever the file said)
  test("a machine moved to a partition anew keeps it: paired again, renamed, read again; a partition that is not that machine's is its first", () => {
    const file = fresh();
    addMachine(file, { id: "m-box", name: "Box", routes: [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: PRINT }] }, { now: T0 });
    assert.equal(partitionOf("m-box", 1), "persist:machine-m-box.1");
    assert.deepEqual([partitionGen("m-box", "persist:machine-m-box"), partitionGen("m-box", "persist:machine-m-box.7"), partitionGen("m-box", "persist:machine-m-mac.1"), partitionGen("m-box", "persist:machine-m-box.0"), partitionGen("m-box", "persist:other")], [0, 7, -1, -1, -1]);
    const moved = addMachine(file, { id: "m-box", name: "Box", routes: [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: `${"EF:".repeat(31)}01` }], partition: "persist:machine-m-box.1" });
    assert.equal(moved.partition, "persist:machine-m-box.1");
    assert.equal(readKept(file)[0].partition, "persist:machine-m-box.1", "read again");
    assert.equal(addMachine(file, { id: "m-box", routes: [{ kind: "url", url: "https://box.tail1234.ts.net" }] }).partition, "persist:machine-m-box.1", "paired again by another way: the one it has");
    assert.equal(renameMachine(file, "m-box", "Studio")?.partition, "persist:machine-m-box.1");
    // A hand edit naming another machine's partition, or none of the shape, is never taken: its own first.
    writeFileSync(file, JSON.stringify({ machines: [{ id: "m-box", name: "Box", routes: [{ kind: "url", url: "https://box.tail1234.ts.net" }], partition: "persist:machine-m-mac" }, { id: "m-mac", name: "Mac", routes: [{ kind: "url", url: "https://mac.tail1234.ts.net" }], partition: "persist:../../x" }] }));
    assert.deepEqual(readKept(file).map((m) => m.partition), ["persist:machine-m-box", "persist:machine-m-mac"]);
  });

  test("what is no machine or no route is refused in words, or passed over as the file is read; a route this app does not know is kept as written", () => {
    const file = fresh();
    assert.throws(() => addMachine(file, { id: LOCAL_ID, routes: [{ kind: "url", url: ORIGIN }] }), /named by its Filament's id/, "This computer's slot is no kept machine's");
    assert.throws(() => addMachine(file, { id: "../x", routes: [{ kind: "url", url: ORIGIN }] }), /named by its Filament's id/);
    assert.throws(() => addMachine(file, { id: "m-x", routes: [] }), /needs a way to reach it/);
    assert.throws(() => addMachine(file, { id: "m-x", routes: [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: "AB:CD" }] }), /needs a way to reach it/, "a part of a fingerprint pins nothing");
    assert.throws(() => addMachine(file, { id: "m-x", routes: [{ kind: "lan", url: "http://192.168.0.9:20343", fingerprint: PRINT }] }), /needs a way to reach it/, "the network's route is https");
    assert.equal(routeOf({ kind: "url", url: "https://me:secret@box.ts.net" }), null, "no credentials in an address");
    assert.equal(routeOf({ kind: "url", url: "file:///C:/x" }), null);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ machines: [{ id: "m-a", name: "A", routes: [{ kind: "tailscale", host: "box.tail1234.ts.net", url: "https://box.tail1234.ts.net" }, { kind: "url", url: "nope" }] }, { id: "m-a", name: "A twice" }, { id: "local", name: "Not me" }, { id: 7 }, null] }));
    const kept = readKept(file);
    assert.deepEqual(kept.map((m) => [m.id, m.name, m.routes]), [["m-a", "A", [{ kind: "tailscale", host: "box.tail1234.ts.net", url: "https://box.tail1234.ts.net" }]]], "the first of a machine named twice; none of This computer's id; a newer app's route as written");
    addMachine(file, { id: "m-b", routes: [{ kind: "url", url: "http://localhost:1" }] });
    assert.deepEqual(readKept(file)[0].routes, [{ kind: "tailscale", host: "box.tail1234.ts.net", url: "https://box.tail1234.ts.net" }], "kept through a write");
    writeFileSync(file, "{ not json");
    assert.deepEqual(readMachines(file, ORIGIN).map((m) => m.id), [LOCAL_ID], "a file that does not read: This computer alone");
  });

  // (fails before: yes — the review of p3-machines: plain http to another machine was a route, whoever held that
  // address answered the id; a file that did not read was written over by the next add; ids differing in case alone were
  // two machines sharing one partition's folder)
  test("plain http goes to this machine alone; a file that does not read is set aside, never written over; what an entry holds beyond what this app reads is kept; an id is one in any case", () => {
    for (const url of ["http://192.168.0.9:20300", "http://workstation.local:20300", "http://box.tail1234.ts.net"]) assert.equal(routeOf({ kind: "url", url }), null, url);
    for (const url of ["http://localhost:20310", "http://127.0.0.1:20310", "http://[::1]:20310", "https://box.tail1234.ts.net", "https://192.168.0.9"]) assert.ok(routeOf({ kind: "url", url }), url);
    const file = fresh();
    assert.throws(() => addMachine(file, { id: "m-x", routes: [{ kind: "url", url: "http://192.168.0.9:20300" }] }), /plain http on this machine \(an SSH tunnel\)/);
    mkdirSync(dirname(file), { recursive: true });
    const bad = '{ "machines": [ { "id": "m-old", "name": "Old", "routes": [ { "kind": "url", "url": "https://old.ts.net" } ] }, ] }';
    writeFileSync(file, bad);
    /** @type {string[]} */
    const said = [];
    addMachine(file, { id: "m-new", routes: [{ kind: "url", url: "https://new.ts.net" }] }, { now: T0, log: (l) => void said.push(l) });
    assert.equal(readFileSync(`${file}.unread-${T0}`, "utf8"), bad, "set aside whole, for the person to mend");
    assert.deepEqual(said, [`machines: ${file} did not read; set aside as ${file}.unread-${T0}`]);
    assert.deepEqual(readKept(file).map((m) => m.id), ["m-new"]);
    writeFileSync(file, JSON.stringify({ machines: [{ id: "m-a", name: "A", routes: [{ kind: "url", url: "https://a.ts.net" }], wol: { mac: "00:11:22:33:44:55" } }] }));
    renameMachine(file, "m-a", "Studio");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).machines[0].wol, { mac: "00:11:22:33:44:55" }, "a newer app's field rides through a write");
    const upper = addMachine(file, { id: "M-A", name: "Again", routes: [{ kind: "url", url: "https://a2.ts.net" }] });
    assert.deepEqual([upper.id, upper.partition, readKept(file).length], ["m-a", "persist:machine-m-a", 1], "the same machine, one partition");
  });

  test("the fingerprints a machine pins for a host, for its view's own certificate check", () => {
    /** @type {any} */
    const box = { id: "m-box", routes: [{ kind: "lan", url: "https://192.168.0.9:20343", fingerprint: PRINT }, { kind: "url", url: "https://box.ts.net" }, { kind: "lan", url: "https://[FE80::1]:20343", fingerprint: `${"00:".repeat(31)}00` }] };
    assert.deepEqual(pinsFor(box, "192.168.0.9"), [PRINT]);
    assert.deepEqual(pinsFor(box, "[fe80::1]"), [`${"00:".repeat(31)}00`]);
    assert.deepEqual(pinsFor(box, "box.ts.net"), [], "an authority's certificate is checked as any site's");
  });
});

describe("which route a view loads", () => {
  /** @type {import("../desktop/lib/machines.js").Machine} */
  const BOX = { id: "m-box", name: "Workstation", partition: "persist:machine-m-box", addedAt: T0, routes: [
    { kind: "url", url: "http://localhost:20310" },
    { kind: "lan", url: "https://192.168.0.7:20343", fingerprint: PRINT },
    { kind: "tailscale", url: "https://box.tail1234.ts.net" },
    { kind: "url", url: "http://localhost:20311" },
    { kind: "lan", url: "https://192.168.0.9:20343", fingerprint: PRINT },
  ] };

  test("each route in order, asked who answers there: nothing listening, another machine, no Filament and a kind this app does not know are passed over and said why; the machine's own id is taken", async () => {
    /** @type {string[]} */
    const asked = [];
    const answers = /** @type {Record<string, any>} */ ({
      "http://localhost:20310": () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })),
      "https://192.168.0.7:20343": () => ({ status: 200, json: { id: "m-other", name: "Laptop" } }),
      "http://localhost:20311": () => ({ status: 404, json: null }),
      "https://192.168.0.9:20343": () => ({ status: 200, json: { id: "m-box", name: "DESKTOP-1", version: "0.9.0" } }),
    });
    const got = await pickRoute(BOX, { ask: async (route, path) => (asked.push(`${route.kind} ${route.url}${path}`), answers[String(route.url)]()) });
    assert.deepEqual(got.route, BOX.routes[4]);
    assert.deepEqual([got.name, got.version], ["DESKTOP-1", "0.9.0"]);
    assert.deepEqual(got.tried, [
      { url: "http://localhost:20310", why: "nothing listens at http://localhost:20310" },
      { url: "https://192.168.0.7:20343", why: "https://192.168.0.7:20343 is Laptop (m-other), not Workstation: nothing was sent there", wrong: true },
      { url: "https://box.tail1234.ts.net", why: "this app does not know a tailscale route: update it" },
      { url: "http://localhost:20311", why: "what answers at http://localhost:20311 is no Filament (HTTP 404)" },
    ]);
    assert.deepEqual(asked, ["url http://localhost:20310/.well-known/filament", "lan https://192.168.0.7:20343/.well-known/filament", "url http://localhost:20311/.well-known/filament", "lan https://192.168.0.9:20343/.well-known/filament"], "a route the app does not know is never asked");
    const none = await pickRoute(BOX, { ask: async () => Promise.reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })) });
    assert.equal(none.route, null);
    assert.equal(none.tried.length, 5);
    assert.equal(none.tried[0].why, "no answer from http://localhost:20310 in 5 s");
    const quick = await pickRoute(BOX, { timeoutMs: 2000, ask: async () => Promise.reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })) });
    assert.equal(quick.tried[0].why, "no answer from http://localhost:20310 in 2 s", "the wait it was given");
    const shouted = await pickRoute(BOX, { ask: async () => ({ status: 200, json: { id: "M-BOX", name: "DESKTOP-1" } }) });
    assert.deepEqual(shouted.route, BOX.routes[0], "an id is one in any case");
    const local = await pickRoute(readMachines(fresh(), ORIGIN)[0], { ask: async () => ({ status: 200, json: { id: "m-whatever", name: "Here" } }) });
    assert.deepEqual(local.route, { kind: "url", url: ORIGIN }, "This computer is whichever Filament the app runs");
  });

  test("on the network: asked over the pinned certificate alone, cookie-less — another certificate ends it before a byte is sent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-machines-tls-"));
    made.push(dir);
    const id = lanIdentity(dir, { name: "Workstation" });
    /** @type {string[]} */
    const seen = [];
    const server = https.createServer({ key: id.key, cert: id.cert }, (req, res) => {
      seen.push(String(req.url));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "m-box", name: "Workstation", version: "0.9.0" }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
    try {
      const url = `https://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
      /** @type {import("../desktop/lib/machines.js").Machine} */
      const box = { id: "m-box", name: "Workstation", partition: partitionOf("m-box"), addedAt: T0, routes: [{ kind: "lan", url, fingerprint: id.fingerprint }] };
      const got = await pickRoute(box);
      assert.deepEqual(got.route, box.routes[0], JSON.stringify(got.tried));
      assert.deepEqual(seen, ["/.well-known/filament"]);
      const wrong = await pickRoute({ ...box, routes: [{ kind: "lan", url, fingerprint: PRINT }] });
      assert.equal(wrong.route, null);
      assert.deepEqual(wrong.tried, [{ url, why: `${url} answered with another certificate than the one paired: nothing was sent` }]);
      assert.equal(seen.length, 1, "nothing reached it");
      const plain = await pickRoute({ ...box, routes: [{ kind: "url", url }] });
      assert.equal(plain.route, null, "a direct route trusts what an authority signed: this certificate is none's");
    } finally {
      server.close();
    }
  });
});

describe("each machine's state", () => {
  test("online while it answers; reconnecting for a while once it stops, then offline with the last why; an address that answers as another machine is offline at once", () => {
    let w = machineWatch(null, { answered: false, why: "nothing listens at http://localhost:20310" }, T0);
    assert.deepEqual(w, { status: "reconnecting", silentSince: T0, why: "nothing listens at http://localhost:20310" }, "a first look that finds none tries again before it says offline");
    w = machineWatch(w, { answered: false }, T0 + RECONNECT_MS - 1);
    assert.deepEqual([w.status, w.why], ["reconnecting", "nothing listens at http://localhost:20310"], "the last why stands");
    w = machineWatch(w, { answered: false }, T0 + RECONNECT_MS);
    assert.equal(w.status, "offline");
    w = machineWatch(w, { answered: true }, T0 + RECONNECT_MS + 5);
    assert.deepEqual(w, { status: "online", silentSince: null, why: null });
    assert.equal(machineWatch(w, { answered: false, why: "another machine", wrong: true }, T0 + RECONNECT_MS + 6).status, "offline");
  });

  test("Ctrl+1..9 — ⌘ on a Mac — name the rail's slots; any other press none", () => {
    assert.equal(slotOfInput({ type: "keyDown", key: "1", control: true }, "win32"), 1);
    assert.equal(slotOfInput({ type: "keyDown", key: "9", control: true }, "linux"), 9);
    assert.equal(slotOfInput({ type: "keyDown", key: "3", meta: true }, "darwin"), 3);
    // (fails before: yes — the review of p3-machines: read by its key, Ctrl+1 on a French keyboard is "&")
    assert.equal(slotOfInput({ type: "keyDown", key: "&", code: "Digit1", control: true }, "win32"), 1);
    assert.equal(slotOfInput({ type: "keyDown", key: "4", code: "Numpad4", control: true }, "win32"), 4);
    assert.equal(slotOfInput({ type: "keyDown", key: "1", code: "KeyQ", control: true }, "win32"), null, "the place wins over the letter");
    for (const [input, platform] of /** @type {[any, string][]} */ ([
      [{ type: "keyDown", key: "0", control: true }, "win32"],
      [{ type: "keyDown", key: "1", control: true, shift: true }, "win32"],
      [{ type: "keyDown", key: "1", control: true, alt: true }, "win32"],
      [{ type: "keyUp", key: "1", control: true }, "win32"],
      [{ type: "keyDown", key: "1", control: true }, "darwin"],
      [{ type: "keyDown", key: "1", meta: true }, "win32"],
      [{ type: "keyDown", key: "a", control: true }, "win32"],
    ]))
      assert.equal(slotOfInput(input, platform), null, JSON.stringify([input, platform]));
    const rail = readMachines(fresh(), ORIGIN);
    assert.equal(machineInSlot(rail, 1)?.id, LOCAL_ID);
    assert.equal(machineInSlot(rail, 2), null);
    assert.equal(machineInSlot(rail, 0), null);
  });
});
