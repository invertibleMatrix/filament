// @ts-check
// A machine kept for this Filament's agents is called what it calls itself (the owner's of 11-10: the agent tool knew
// the Mac as "192.168.0.77", the name its hostname gave when its agents' device was kept, while the app's machines
// menu said "Kai’s MacBook Pro"): the name it answers with replaces the one kept, for each device kept for it, and a
// name finds it with either apostrophe, in any case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REMOTES_FILE, connectRemote, keepRemote, readRemotes, remoteNamed } from "../src/services/machines/remotes.js";
import { createMachines } from "../src/services/machines/index.js";
import { EXIT } from "../src/services/machines/client.js";
import { createRemoteAgents } from "../src/app/agent/remote-agents.js";
import { createProviders } from "../src/app/providers.js";

const ID = "1a8abe5b-0000-4000-8000-000000000001";
const URL_THERE = "https://192.168.0.77:20343";

/** A data folder with the Mac kept under its address: the agents' device, and the person's beside it. */
const kept = () => {
  const dataDir = mkdtempSync(join(tmpdir(), "remote-name-"));
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({ server: { encryptSecrets: false } }));
  keepRemote(dataDir, { url: URL_THERE, machine: { id: ID, name: "192.168.0.77" }, device: { id: "dev-agents", name: "DESKTOP-1's agents", scope: "agent" }, token: "tok-agents" });
  keepRemote(dataDir, { url: URL_THERE, machine: { id: ID, name: "192.168.0.77" }, device: { id: "dev-person", name: "DESKTOP-1", scope: "full" }, token: "tok-person" });
  return dataDir;
};

/**
 * The Mac's Filament as a fetch: who it is, under `name`, and its state.
 * @param {string} name @param {{ id?: string }} [o] @returns {typeof fetch}
 */
const theMac = (name, o = {}) =>
  /** @type {any} */ (
    async (/** @type {string} */ url) => {
      const path = new URL(url).pathname;
      if (path === "/.well-known/filament") return new Response(JSON.stringify({ id: o.id ?? ID, name, version: "0.9.73" }), { headers: { "content-type": "application/json" } });
      if (path === "/api/state") return new Response(JSON.stringify({ platform: "darwin" }), { headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 404 });
    }
  );

// (fails before: yes — the name kept at the agents' device's minting stayed, and only it found the machine)
test("a machine that answers with another name is kept under it, each device of it; its old name finds it no more", async () => {
  const dataDir = kept();
  try {
    assert.throws(() => remoteNamed(dataDir, "Kai's MacBook Pro", { agents: true }), /no machine "Kai's MacBook Pro"/);
    const client = await connectRemote(dataDir, "192.168.0.77", { agents: true, fetchImpl: theMac("Kai’s MacBook Pro") });
    assert.equal(/** @type {any} */ (client).remote?.name, "Kai’s MacBook Pro", "the client says the name it answered with");
    assert.deepEqual(
      readRemotes(dataDir).map((r) => [r.device.scope, r.name, r.machine.name, r.token]),
      [
        ["agent", "Kai’s MacBook Pro", "Kai’s MacBook Pro", "tok-agents"],
        ["full", "Kai’s MacBook Pro", "Kai’s MacBook Pro", "tok-person"],
      ],
      "both devices kept for it take the name; their tokens stay",
    );
    assert.throws(() => remoteNamed(dataDir, "192.168.0.77-old", { agents: true }), /no machine/);
    assert.equal(remoteNamed(dataDir, URL_THERE, { agents: true }).name, "Kai’s MacBook Pro", "its address still finds it");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// (fails before: yes — a name matched only as kept, its curly apostrophe against the straight one typed)
test("a name finds its machine with either apostrophe or quote, in any case, its spaces as one", () => {
  const dataDir = kept();
  try {
    keepRemote(dataDir, { url: URL_THERE, machine: { id: ID, name: "Kai’s MacBook Pro" }, device: { id: "dev-agents", name: "DESKTOP-1's agents", scope: "agent" }, token: "tok-agents" });
    for (const typed of ["Kai’s MacBook Pro", "Kai's MacBook Pro", "kai's macbook pro", "  Kai‘s   MacBook Pro ", "Kaiʼs MacBook Pro"])
      assert.equal(remoteNamed(dataDir, typed, { agents: true }).machine.id, ID, typed);
    assert.throws(() => remoteNamed(dataDir, "MAKs MacBook Pro", { agents: true }), /no machine/, "a letter left out is another name");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// (fails before: yes — the re-read of 11-11, its finding 11: the name answered "names 2 machines — give its address" with
// no id, and the store's `find` kept even that: an agent that named one was told there is no such machine, beside a
// list that named it twice)
test("a name two machines share finds neither, and says each by its id and its address, which do; the store says so too, and to an agent that names one", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "remote-name-"));
  try {
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ server: { encryptSecrets: false } }));
    const [A, B] = ["1a8abe5b-0000-4000-8000-00000000000a", "1a8abe5b-0000-4000-8000-00000000000b"];
    const [atA, atB] = ["https://192.168.0.10:20343", "https://192.168.0.11:20343"];
    keepRemote(dataDir, { url: atA, machine: { id: A, name: "Studio" }, device: { id: "dev-a", name: "DESKTOP-1's agents", scope: "agent" }, token: "tok-a" });
    keepRemote(dataDir, { url: atB, machine: { id: B, name: "Studio" }, device: { id: "dev-b", name: "DESKTOP-1's agents", scope: "agent" }, token: "tok-b" });
    const words = (/** @type {string} */ typed) => `"${typed}" names 2 machines: Studio (${A}, ${atA}) and Studio (${B}, ${atB}) — name the one you mean by its id or its address`;
    assert.throws(() => remoteNamed(dataDir, "studio", { agents: true }), (/** @type {any} */ e) => e.code === EXIT.usage && e.message === words("studio"));
    assert.equal(remoteNamed(dataDir, A, { agents: true }).url, atA, "its id names one");
    assert.equal(remoteNamed(dataDir, atB, { agents: true }).machine.id, B, "its address names one");
    const machines = createMachines({ dataDir });
    assert.throws(() => machines.find("Studio", { agents: true }), (/** @type {any} */ e) => e.message === words("Studio"));
    assert.equal(machines.find("Nowhere", { agents: true }), null, "a name no machine has is still none");
    assert.equal(machines.find("Studio", { agents: false }), null, "none is kept so for the person");
    assert.equal(machines.find(B, { agents: true })?.url, atB);
    await assert.rejects(createRemoteAgents({ machines }).modelsText("Studio"), (/** @type {any} */ e) => e.message === words("Studio"));
    // Its models added by that name: refused as a name that finds no machine is, a 400, in the same words.
    const providers = createProviders({ config: /** @type {any} */ ({ get: () => ({}) }), machines });
    assert.throws(() => providers.add({ type: "filament", machine: "Studio" }), (/** @type {any} */ e) => e.status === 400 && e.message === words("Studio"));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// (fails before: yes — the same finding: the machines were read before the text they are compared by, so a machine
// another process kept between the two reads was in that text, not in the rows written over it)
test("a machine named anew as another process keeps a machine: that process's file stays, its machine with it, and the next answer names this one", async () => {
  const dataDir = kept();
  const file = join(dataDir, REMOTES_FILE);
  const OTHER = "1a8abe5b-0000-4000-8000-0000000000ff";
  const fs = createRequire(import.meta.url)("node:fs");
  const real = fs.readFileSync;
  // The reads of remotes.json once the machine has answered with its name: the rename's own two.
  let reads = -1;
  const mac = theMac("Kai’s MacBook Pro");
  /** @type {typeof fetch} */
  const answering = /** @type {any} */ (
    async (/** @type {string} */ url) => {
      if (new URL(url).pathname === "/.well-known/filament") reads = 0;
      return mac(url);
    }
  );
  fs.readFileSync = (/** @type {any} */ p, /** @type {any[]} */ ...rest) => {
    if (reads >= 0 && String(p) === file && ++reads === 2) {
      // Between the two, the desktop app keeps a machine.
      const j = JSON.parse(real(file, "utf8"));
      j.remotes.push({ name: "Studio", url: "https://192.168.0.11:20343", token: "tok-studio", machine: { id: OTHER, name: "Studio" }, device: { id: "dev-s", name: "DESKTOP-1's agents", scope: "agent" }, connectedAt: 1 });
      writeFileSync(file, `${JSON.stringify(j, null, 2)}\n`);
    }
    return real(p, ...rest);
  };
  syncBuiltinESMExports();
  try {
    const client = await connectRemote(dataDir, "192.168.0.77", { agents: true, fetchImpl: answering });
    assert.equal(/** @type {any} */ (client).remote?.name, "Kai’s MacBook Pro", "this call says the name it heard");
  } finally {
    fs.readFileSync = real;
    syncBuiltinESMExports();
  }
  try {
    assert.equal(reads >= 2, true, "the rename read the file twice");
    assert.deepEqual(readRemotes(dataDir).map((r) => r.machine.id), [ID, ID, OTHER], "the machine the other process kept is still there");
    await connectRemote(dataDir, "192.168.0.77", { agents: true, fetchImpl: mac });
    assert.deepEqual(readRemotes(dataDir).map((r) => r.name), ["Kai’s MacBook Pro", "Kai’s MacBook Pro", "Studio"], "named at the next answer");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("another machine at the address renames nothing: its token is not sent, and the name kept stays", async () => {
  const dataDir = kept();
  try {
    await assert.rejects(connectRemote(dataDir, "192.168.0.77", { agents: true, fetchImpl: theMac("Intruder", { id: "another-id" }) }), /is Intruder \(another-id\), not 192\.168\.0\.77/);
    assert.deepEqual(readRemotes(dataDir).map((r) => r.name), ["192.168.0.77", "192.168.0.77"]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
