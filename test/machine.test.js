// @ts-check
// This machine as another Filament knows it (the owner's remote Filament of 11-06, Part 1): its id and name in
// <dataDir>/machine.json, said at /.well-known/filament before any pairing, and in /api/state with who reads it.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computerName, createMachine, cleanName, gapWords, MACHINE_PROTOCOL, MACHINE_PROTOCOL_LOWEST, NAME_MAX, pageLabelOf, protocolGap } from "../src/services/machine.js";
import { harnessOrigins } from "../src/core/artifacts.js";
import { createFrontDoor } from "../src/http/front-door.js";
import { defaultConfig } from "../src/config.js";
import { startApp } from "./helpers/app.js";

const fresh = () => mkdtempSync(join(tmpdir(), "filament-machine-"));

// (fails before: yes — there was no machine id: memory.json's deviceId belongs to the memory folder and is absent with memory off)
test("a machine's id is made once and kept in machine.json; its name is the hostname until the person names it", () => {
  const dir = fresh();
  try {
    const m = createMachine({ dataDir: dir, host: () => "WORKSTATION" });
    const { id, name } = m.get();
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(name, "WORKSTATION");
    const onDisk = JSON.parse(readFileSync(join(dir, "machine.json"), "utf8"));
    assert.deepEqual([onDisk.id, onDisk.name], [id, "WORKSTATION"], "written as it was made");
    assert.deepEqual(createMachine({ dataDir: dir, host: () => "renamed-box" }).get(), { id, name: "WORKSTATION" }, "read again, the same machine");
    assert.deepEqual(m.rename("  Home\tworkstation \n"), { id, name: "Home workstation" });
    assert.equal(createMachine({ dataDir: dir, host: () => "x" }).get().name, "Home workstation", "a name kept");
    assert.deepEqual(m.rename(""), { id, name: "WORKSTATION" }, "an empty name is the machine's own");
    assert.deepEqual(readdirSync(dir).sort(), ["machine.json"], "no temporary file left behind");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the owner's MacBook of 11-09 named itself "192.168.0.77": its hostname is the address its
// network's DNS names, and it was kept so)
test("a Mac's own name is its Computer Name, else its hostname; elsewhere the hostname, and nothing is run", () => {
  /** @type {string[][]} */
  const ran = [];
  const run = (/** @type {string} */ cmd, /** @type {string[]} */ args) => (ran.push([cmd, ...args]), "Kai’s MacBook Air\n");
  assert.equal(computerName({ platform: "darwin", run, host: () => "192.168.0.77" }), "Kai’s MacBook Air");
  assert.deepEqual(ran, [["/usr/sbin/scutil", "--get", "ComputerName"]]);
  assert.equal(computerName({ platform: "darwin", run: () => "  \n", host: () => "mac.local" }), "mac.local", "none set: the hostname");
  assert.equal(computerName({ platform: "darwin", run: () => { throw new Error("no scutil"); }, host: () => "mac.local" }), "mac.local");
  assert.equal(computerName({ platform: "win32", run: () => { throw new Error("never run"); }, host: () => "TOWER" }), "TOWER");
  assert.equal(computerName({ platform: "linux", run: () => { throw new Error("never run"); }, host: () => "box" }), "box");
});

// (fails before: yes — a name kept as an address stayed so, on every machine that paired with it)
test("a kept name that is only an address the machine was named by is its own name again, and kept so; one the person gave stays", () => {
  const dir = fresh();
  const file = join(dir, "machine.json");
  try {
    const id = "1a8abe5b-793a-444b-81d9-f37af35b242e";
    writeFileSync(file, JSON.stringify({ version: 1, id, name: "192.168.0.77" }));
    assert.deepEqual(createMachine({ dataDir: dir, host: () => "Kai’s MacBook Air" }).get(), { id, name: "Kai’s MacBook Air" });
    const { page, ...kept } = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(kept, { version: 1, id, name: "Kai’s MacBook Air" }, "kept anew: the app reads the file");
    assert.match(page, /^filament-[0-9a-f]{12}$/, "its page name made beside it");
    writeFileSync(file, JSON.stringify({ version: 1, id, name: "fe80::1" }));
    assert.equal(createMachine({ dataDir: dir, host: () => "box" }).get().name, "box", "an IPv6 address too");
    writeFileSync(file, JSON.stringify({ version: 1, id, name: "10.0.0.7" }));
    assert.equal(createMachine({ dataDir: dir, host: () => "10.0.0.7" }).get().name, "10.0.0.7", "no better name: the address it has");

    const m = createMachine({ dataDir: dir, host: () => "box" });
    assert.equal(m.rename("10.0.0.8").name, "10.0.0.8");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).named, true);
    assert.equal(createMachine({ dataDir: dir, host: () => "box" }).get().name, "10.0.0.8", "the person's own: kept");
    assert.equal(m.rename("").name, "box");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).named, undefined, "the machine's own name again");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a machine.json that cannot be read is set aside, never overwritten, and said in the log; a new id is made", () => {
  for (const body of ["{ not json", JSON.stringify({ name: "no id" })]) {
    const dir = fresh();
    try {
      writeFileSync(join(dir, "machine.json"), body);
      /** @type {string[]} */
      const said = [];
      const m = createMachine({ dataDir: dir, host: () => "box", log: (level, msg) => said.push(`${level} ${msg}`), now: () => 42 });
      assert.match(m.get().id, /^[0-9a-f-]{36}$/);
      assert.equal(readFileSync(join(dir, "machine.json.unreadable-42"), "utf8"), body, "the old file, as it was");
      assert.equal(said.length, 1);
      assert.match(said[0], /^warn \[machine\] could not read .*machine\.json .*set aside as .*machine\.json\.unreadable-42: this machine has a new id, and a machine paired with the old one asks to pair again$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("a name as kept: no control characters, one space between words, at most NAME_MAX characters; no hostname at all says This machine", () => {
  assert.equal(cleanName("a\u0000b\u001fc\u007fd"), "a b c d");
  assert.equal(cleanName("x".repeat(NAME_MAX + 10)).length, NAME_MAX);
  assert.equal(cleanName(null), "");
  assert.equal(createMachine({ host: () => "  " }).get().name, "This machine");
});

/** A GET over node:http, which sends the Host given (fetch refuses to). @param {number} port @param {string} path @param {Record<string, string>} headers */
const get = (port, path, headers) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on("error", reject);
    req.end();
  });

/** A POST of JSON over node:http, with the Host given. @param {number} port @param {string} path @param {Record<string, string>} headers @param {any} body */
const post = (port, path, headers, body) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });

// (fails before: yes — the plan's s0f: a browser here was paired at 127.0.0.1, whose cookies a browser sends to every
// port of it, a server an agent runs among them)
test("this Filament's own name under localhost: made once and kept, never said to a stranger; a browser here paired at it holds its cookie there alone, and its page frames artifacts", async () => {
  const dir = fresh();
  try {
    const m = createMachine({ dataDir: dir, host: () => "BOX" });
    const host = m.pageHost();
    assert.match(host, /^filament-[0-9a-f]{12}\.localhost$/);
    assert.equal(createMachine({ dataDir: dir }).pageHost(), host, "read again, the same name");
    assert.deepEqual(Object.keys(m.get()), ["id", "name"], "never in what the machine says of itself");
    const { id } = m.get();
    writeFileSync(join(dir, "machine.json"), JSON.stringify({ version: 1, id, name: "BOX", page: "evil.example" }));
    const again = createMachine({ dataDir: dir });
    assert.equal(again.get().id, id, "its id kept");
    assert.match(again.pageHost(), /^filament-[0-9a-f]{12}\.localhost$/, "a label that is none is made anew");
    assert.equal(`${JSON.parse(readFileSync(join(dir, "machine.json"), "utf8")).page}.localhost`, again.pageHost(), "and kept");
    // (fails before: yes — the hunt on s0f: written as any file is, other accounts on a Linux machine read it)
    if (process.platform !== "win32") assert.equal(statSync(join(dir, "machine.json")).mode & 0o777, 0o600, "this account's alone");
    // (fails before: yes — the hunt on x38: one left readable to others — a copy, a restore — stayed so, read as it was)
    if (process.platform !== "win32") {
      chmodSync(join(dir, "machine.json"), 0o644);
      assert.equal(createMachine({ dataDir: dir }).pageHost(), again.pageHost(), "read, nothing made anew");
      assert.equal(statSync(join(dir, "machine.json")).mode & 0o777, 0o600, "made this account's alone as it is read");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const H = "filament-0123456789ab.localhost";
  assert.equal(pageLabelOf(H), "filament-0123456789ab");
  assert.equal(pageLabelOf(H.toUpperCase()), "filament-0123456789ab");
  for (const other of ["evil.example", "filament-0123456789ab", "filament-0123456789ab.localhost.evil", "x.filament-0123456789ab.localhost", "", null]) assert.equal(pageLabelOf(other), "", String(other));
  assert.deepEqual(harnessOrigins(20300, {}, null, H), ["http://127.0.0.1:20300", "http://localhost:20300", `http://${H}:20300`]);
  assert.deepEqual(harnessOrigins(20300, {}, null, "evil.example"), ["http://127.0.0.1:20300", "http://localhost:20300"]);

  const shim = await startApp();
  try {
    const own = `${JSON.parse(readFileSync(join(shim.dataDir, "machine.json"), "utf8")).page}.localhost`;
    const pair = (/** @type {any} */ body) => fetch(`${shim.url}/api/remote/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    const made = await pair({ scope: "full", here: true });
    assert.equal(made.pageHost, own, "said to this computer as it makes a code for a browser here");
    assert.equal((await pair({ scope: "full" })).pageHost, undefined, "not for another machine's code");
    assert.equal((await (await fetch(`${shim.url}/api/remote/pair`)).json()).pageHost, own);
    assert.ok(!(await (await fetch(`${shim.url}/.well-known/filament`)).text()).includes(own.split(".")[0]), "never to a stranger");
    const at = `${own}:${shim.port}`;
    assert.equal(/** @type {any} */ (await get(shim.port, "/ui/pair.html", { host: at })).status, 200, "its pages answered at that name");
    const claimed = /** @type {any} */ (await post(shim.port, "/api/remote/claim", { host: at, origin: `http://${at}` }, { code: made.code, name: "Browser here" }));
    assert.equal(claimed.status, 200, claimed.body);
    const cookie = String(claimed.headers["set-cookie"]);
    assert.match(cookie, /^filament_device=/);
    assert.doesNotMatch(cookie, /domain=/i, "host-only: that name's alone, sent to no other name's server");
    assert.equal(JSON.parse(claimed.body).device.here, true);
  } finally {
    await shim.stop();
  }
  assert.match(readFileSync(new URL("../src/server.js", import.meta.url), "utf8"), /createArtifactsHandler\(\{[^}]*pageHost: \(\) => machine\.pageHost\(\) \}\)/, "artifacts framed by its page");
  assert.match(readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8"), /const label = pageLabelOf\(p\.pageHost\);\n\s+await shell\.openExternal\(`\$\{origin\}\/ui\/pair\.html#code=\$\{encodeURIComponent\(p\.code\)\}\$\{label \? `&name=\$\{label\}` : ""\}`\);/, "the tray's Open in browser: its page moves on to the name");
});

// (fails before: yes — nothing answered /.well-known/filament, and /api/state said neither the machine nor who reads it)
test("/.well-known/filament says who answers — its id, name, wire and version — by any name that reached it; /api/state says the machine and who reads it", async () => {
  /** @type {Awaited<ReturnType<typeof startApp>> | null} */
  let running = await startApp({ configure: (cfg) => (cfg.server.adminToken = "tok-1234"), keep: true });
  const shim = running;
  const dataDir = shim.dataDir;
  try {
    const r = await fetch(`${shim.url}/.well-known/filament`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const said = await r.json();
    assert.deepEqual(Object.keys(said).sort(), ["id", "name", "protocol", "protocolLowest", "version"], "nothing a stranger could use");
    assert.deepEqual([said.protocol, said.protocolLowest], [MACHINE_PROTOCOL, MACHINE_PROTOCOL_LOWEST]);
    assert.equal(said.id, JSON.parse(readFileSync(join(shim.dataDir, "machine.json"), "utf8")).id);
    // A tailnet name no Host check knows yet: who answers is said; the admin API is not reached by it.
    const named = /** @type {any} */ (await get(shim.port, "/.well-known/filament", { host: "box.tail1234.ts.net" }));
    assert.deepEqual([named.status, JSON.parse(named.body).id], [200, said.id]);
    assert.equal(/** @type {any} */ (await get(shim.port, "/api/state", { host: "box.tail1234.ts.net" })).status, 421);
    const state = await (await fetch(`${shim.url}/api/state`)).json();
    assert.deepEqual(state.machine, { id: said.id, name: said.name });
    assert.equal(state.viewer, "local");
    const proxied = await (await fetch(`${shim.url}/api/state`, { headers: { "x-forwarded-for": "100.101.102.103", "x-filament-admin": "tok-1234" } })).json();
    assert.equal(proxied.viewer, "remote", "through a proxy, with the admin token");
    running = null;
    await shim.stop();
    running = await startApp({ dataDir, keep: true });
    assert.equal((await (await fetch(`${running.url}/.well-known/filament`)).json()).id, said.id, "the same machine after a restart");
  } finally {
    // Stopped whatever failed: an app left running holds the test's process open.
    await running?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("/.well-known/filament answers while memory opens, as /health does", async () => {
  const door = createFrontDoor(
    /** @type {any} */ ({
      config: { get: () => defaultConfig() },
      log: () => {},
      deps: {},
      pipeline: {},
      responsesDoor: {},
      mcp: {},
      memoryMcp: {},
      admin: async () => {},
      artifacts: async () => {},
      opening: () => new Promise(() => {}),
      openingWaitMs: 5000,
      isDraining: () => false,
      VERSION: "9.9.9",
      startedAt: 0,
      machine: { get: () => ({ id: "m-1", name: "Box" }) },
    }),
  );
  const server = http.createServer(door);
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  try {
    const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
    const r = /** @type {any} */ (await Promise.race([get(port, "/.well-known/filament", {}), new Promise((res) => setTimeout(() => res(null), 2000))]));
    assert.ok(r, "answered, not held");
    assert.deepEqual([r.status, JSON.parse(r.body)], [200, { id: "m-1", name: "Box", protocol: MACHINE_PROTOCOL, protocolLowest: MACHINE_PROTOCOL_LOWEST, version: "9.9.9" }]);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(() => r(undefined)));
  }
});

// (fails before: yes — the remote desk of 11-22, s4c: a machine on a wire the other did not speak failed oddly, saying
// nothing of which side to update)
test("which side must update for two Filaments to speak: the other below this one's oldest wire, or this one below the other's; one that says no wire speaks 1", () => {
  assert.equal(protocolGap({ protocol: MACHINE_PROTOCOL, protocolLowest: MACHINE_PROTOCOL_LOWEST }), null, "the same Filament speaks with itself");
  assert.equal(protocolGap({}), null, "a Filament from before the wire was said: 1");
  assert.equal(protocolGap({ protocol: "2", protocolLowest: -1 }), null, "what is no whole number from 1 is 1");
  const here = { protocol: 3, lowest: 2 };
  assert.equal(protocolGap({ protocol: 1 }, here), "there");
  assert.equal(protocolGap({ protocol: 2, protocolLowest: 2 }, here), null, "within each other's");
  assert.equal(protocolGap({ protocol: 5, protocolLowest: 3 }, here), null, "a newer one that still speaks this one's");
  assert.equal(protocolGap({ protocol: 5, protocolLowest: 4 }, here), "here");
  assert.equal(gapWords("there", { name: "Studio", version: "0.9.40" }), "Studio runs Filament 0.9.40, too old for this app: update Filament on Studio.");
  assert.equal(gapWords("here", { name: "Studio", version: "0.9.99" }, "this Filament"), "Studio runs Filament 0.9.99, too new for this Filament: update this Filament.");
  assert.equal(gapWords("there", { name: "Studio" }), "Studio runs a Filament, too old for this app: update Filament on Studio.");
});
