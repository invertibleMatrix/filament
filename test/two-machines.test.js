// @ts-check
// Two Filaments on one machine (helpers/two-machines.js), the ground the tests of Filament's agents on every paired
// machine stand on: each its own data folder, ports, machine and certificate, its network listener on loopback; one
// pairs with the other through the real claim route and keeps the device token as `filament connect` keeps it; the
// other knows it as that device, come from another address — never as this computer — and stopped, both are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { FAR_ADDRESS, pairMachines, startTwoMachines } from "./helpers/two-machines.js";
import { connectRemote, readRemotes } from "../src/cli/remotes.js";
import { certificateAt, pinnedFetch } from "../src/cli/pinned.js";
import { samePrint } from "../src/core/x509.js";
import { lanIps } from "../src/services/lan-tls.js";

// (fails before: yes — there was no helper, and no test started two Filaments side by side)
test("two Filaments on one machine: each its own data folder, ports, machine and certificate, its listener on loopback; here claims there's code through the claim route and keeps its token; there knows here as that device, come from another address; stopped, both are gone", async () => {
  const two = await startTwoMachines();
  const { here, there } = two;
  let stopped = false;
  try {
    assert.notEqual(here.dataDir, there.dataDir);
    const ports = [here.port, there.port, here.lan.port, there.lan.port, new URL(here.far).port, new URL(there.far).port].map(Number);
    assert.equal(new Set(ports).size, ports.length, `ports of their own: ${ports.join(", ")}`);
    assert.deepEqual([here.machine.name, there.machine.name], ["Laptop", "Workstation"]);
    assert.notEqual(here.machine.id, there.machine.id);
    assert.ok(!samePrint(here.lan.fingerprint, there.lan.fingerprint), "a certificate of its own each");
    // Each listener on loopback serves its own certificate, and the network between them hands it on as it is.
    for (const m of [here, there]) {
      assert.ok(samePrint(await certificateAt(`https://127.0.0.1:${m.lan.port}`), m.lan.fingerprint), m.machine.name);
      assert.ok(samePrint(await certificateAt(m.far), m.lan.fingerprint), `${m.machine.name} over the network`);
    }
    // On loopback alone: at this machine's own address on its network, where there is one, nothing answers (asked of
    // both at once — Windows tries a refused connection again for some two seconds).
    const ip = lanIps()[0];
    if (ip) await Promise.all([here, there].map((m) => assert.rejects(certificateAt(`https://${ip}:${m.lan.port}`), Error, `${m.machine.name} at ${ip}`)));
    // The link Settings › Remote access shows there, and the machine as here keeps it.
    const hex = there.lan.fingerprint.replace(/:/g, "");
    assert.match(two.link, new RegExp(`^${there.far}/ui/pair\\.html#code=[A-Z2-9]{4}-[A-Z2-9]{4}&fp=${hex}$`));
    const kept = readRemotes(here.dataDir);
    assert.equal(kept.length, 1);
    assert.deepEqual([kept[0].url, kept[0].fingerprint, kept[0].machine, kept[0].device.name, kept[0].device.scope], [there.far, there.lan.fingerprint, there.machine, "Laptop", "full"]);
    assert.match(kept[0].token, /^fdt_/);
    assert.deepEqual(two.remote, kept[0]);
    assert.deepEqual(readRemotes(there.dataDir), [], "there pairs with nothing");
    // There: the code claimed, a command line's device named for here.
    const listed = await (await there.api("/api/remote/devices")).json();
    assert.deepEqual(listed.pending, [], "the code is used");
    assert.deepEqual(listed.devices.map((/** @type {any} */ d) => [d.name, d.kind, d.scope, d.revokedAt]), [["Laptop", "cli", "full", null]]);
    // As that device there, from the network's address.
    const me = await (await two.ask("/api/remote/me")).json();
    assert.deepEqual([me.who, me.device?.name, me.machine?.id], ["device", "Laptop", there.machine.id]);
    const seen = (await (await there.api("/api/remote/devices")).json()).devices[0];
    assert.equal(seen.lastSeenFrom, FAR_ADDRESS, "come from another machine's address");
    // Over the network with no token, nobody; on there's own loopback, the same listener answers this computer — the
    // trust a call from 127.0.0.1 would have had.
    const stranger = await pinnedFetch(there.lan.fingerprint)(`${there.far}/api/remote/me`);
    assert.equal(stranger.status, 403, await stranger.text());
    const own = await (await pinnedFetch(there.lan.fingerprint)(`https://127.0.0.1:${there.lan.port}/api/remote/me`)).json();
    assert.equal(own.who, "local");
    // The command line's own way there: by the machine's name, pinned, as the device.
    const client = await connectRemote(here.dataDir, "workstation");
    assert.deepEqual([(await client.get("/remote/me")).who, client.remote?.machine.id], ["device", there.machine.id]);
    await two.stop();
    stopped = true;
    for (const m of [here, there]) assert.equal(existsSync(m.dataDir), false, `${m.machine.name}'s data folder is removed`);
    for (const url of [here.url, there.url]) await assert.rejects(fetch(`${url}/health`), Error, `${url} is stopped`);
    for (const m of [here, there]) for (const at of [m.far, `https://127.0.0.1:${m.lan.port}`]) await assert.rejects(certificateAt(at), Error, `${at} is stopped`);
  } finally {
    if (!stopped) await two.stop();
  }
});

test("a view device, and the other way too: there pairs with here as a full device over here's own network address; each keeps its own token, and each is the other's device", async () => {
  const two = await startTwoMachines({ scope: "view", here: { name: "Phone" }, there: { name: "Server" } });
  const { here, there } = two;
  try {
    assert.equal(two.remote.device.scope, "view");
    const me = await (await two.ask("/api/remote/me")).json();
    assert.deepEqual([me.who, me.device?.name, me.device?.scope], ["device", "Phone", "view"]);
    const write = await two.ask("/api/remote/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "full" }) });
    assert.equal(write.status, 403, "a view device only reads");
    assert.match((await write.json()).error, /a view-only device reads/);
    const back = await pairMachines(there, here);
    assert.deepEqual([back.remote.url, back.remote.machine, back.remote.device.name, back.remote.device.scope], [here.far, here.machine, "Server", "full"]);
    assert.notEqual(back.remote.token, two.remote.token);
    const theirs = await (await back.ask("/api/remote/me")).json();
    assert.deepEqual([theirs.who, theirs.device?.name, theirs.machine?.id], ["device", "Server", here.machine.id]);
    assert.deepEqual(readRemotes(there.dataDir).map((r) => r.machine.id), [here.machine.id]);
    assert.deepEqual(readRemotes(here.dataDir).map((r) => r.machine.id), [there.machine.id]);
  } finally {
    await two.stop();
  }
});

test("one that cannot start stops what was started: its words, and both data folders removed", async () => {
  /** @type {string[]} */
  const dirs = [];
  await assert.rejects(
    startTwoMachines({
      here: { configure: (_c, { dataDir }) => void dirs.push(dataDir) },
      there: { configure: (c, { dataDir }) => void (dirs.push(dataDir), (c.server.lan.enabled = false)) },
    }),
    /^Error: Workstation: its network listener is not on/,
  );
  assert.equal(dirs.length, 2);
  for (const d of dirs) assert.equal(existsSync(d), false, `${d} is removed`);
});
