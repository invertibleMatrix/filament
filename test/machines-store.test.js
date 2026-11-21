// @ts-check
// This Filament's own store of the machines it is paired with (services/machines; the remote-agents plan's f-store):
// the command line's remotes.json, read and written by the server too — list, find, connect, forget, and a client of a
// machine's admin API over https pinned to its certificate. Each device token is sealed with the data folder's
// secret.key: one kept plain, from before, is sealed the first time it is read, and still works; the file never holds
// it plain after.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTwoMachines } from "./helpers/two-machines.js";
import { createMachines } from "../src/services/machines/index.js";
import { EXIT } from "../src/services/machines/client.js";
import { REMOTES_FILE, connectTo, machineAt, readRemotes } from "../src/services/machines/remotes.js";
import { pairLinks } from "../src/http/admin/remote.js";
import { isSealed, seal } from "../src/services/config/secrets.js";

/** The file as it is on disk. @param {string} dataDir */
const fileOf = (dataDir) => readFileSync(join(dataDir, REMOTES_FILE), "utf8");

/** A machine as kept, its token `token`. @param {string} id @param {string} token @param {Record<string, any>} [o] */
const rowOf = (id, token, o = {}) => ({ name: id, url: `https://192.0.2.1:20343`, token, fingerprint: `${"AB:".repeat(31)}AB`, machine: { id, name: id }, device: { id: `d-${id}`, name: "Laptop", scope: "full" }, connectedAt: 1, ...o });

// (fails before: yes — there was no store but the command line's, which src/app may not import, and it kept each token
// plain in the file)
test("the machines store: list and find say a machine without its token; clientOf calls it as the device, pinned; a wrong pin sends nothing; a plain token from before is sealed on first read and still works; connect replaces; forget signs out", async () => {
  const two = await startTwoMachines();
  const { here, there } = two;
  try {
    const machines = createMachines({ dataDir: here.dataDir });
    const token = two.remote.token;
    assert.match(token, /^fdt_/);
    // Paired as `filament connect` pairs: the token sealed in the file.
    assert.ok(!fileOf(here.dataDir).includes(token), "the file never holds the token plain");
    assert.ok(isSealed(JSON.parse(fileOf(here.dataDir)).remotes[0].token));

    const listed = machines.list();
    assert.equal(listed.length, 1);
    assert.deepEqual([listed[0].url, listed[0].fingerprint, listed[0].machine, listed[0].device.name, listed[0].device.scope], [there.far, there.lan.fingerprint, there.machine, "Laptop", "full"]);
    assert.equal("token" in listed[0], false, "the list says no token");
    for (const which of ["workstation", there.machine.id, there.far, listed[0]]) assert.deepEqual(machines.find(which), listed[0], `found by ${typeof which === "string" ? which : "the machine"}`);
    assert.equal(machines.find("nowhere"), null);

    // A call there as the device, over https pinned to its certificate; the client says the machine, not its token.
    const client = await machines.clientOf("Workstation");
    const me = await client.get("/remote/me");
    assert.deepEqual([me.who, me.device?.name, me.machine?.id], ["device", "Laptop", there.machine.id]);
    assert.ok(!JSON.stringify(client.remote).includes(token), "the client hands out no token");
    assert.equal(client.remote?.machine.id, there.machine.id);

    // Another certificate at the address than the one pinned: refused before a byte is sent, the token included.
    const kept = JSON.parse(fileOf(here.dataDir));
    writeFileSync(join(here.dataDir, REMOTES_FILE), JSON.stringify({ remotes: [{ ...kept.remotes[0], fingerprint: `${"00:".repeat(31)}00` }] }));
    await assert.rejects(machines.clientOf(there.machine.id), (/** @type {any} */ e) => {
      assert.equal(e.code, EXIT.noFilament);
      assert.match(e.message, /not the one this command line pinned .*: nothing was sent/);
      return true;
    });

    // As kept before tokens were sealed: plain in the file. The first read seals it, and it still works.
    writeFileSync(join(here.dataDir, REMOTES_FILE), JSON.stringify({ remotes: [{ ...kept.remotes[0], token }] }, null, 2));
    assert.ok(fileOf(here.dataDir).includes(token));
    assert.deepEqual(machines.list(), listed);
    assert.ok(!fileOf(here.dataDir).includes(token), "sealed on its first read");
    assert.ok(isSealed(JSON.parse(fileOf(here.dataDir)).remotes[0].token));
    assert.equal(readRemotes(here.dataDir)[0].token, token, "and opens again as it was");
    assert.equal((await (await machines.clientOf("workstation")).get("/remote/me")).who, "device", "and still works");

    // Connected again through the store, with a new code: the same machine kept once, as the new device, its token
    // sealed; the device it had signs out there.
    const open = await (await there.api("/api/remote/pair", { method: "POST", body: { scope: "view" } })).json();
    const [link] = pairLinks({ listening: { port: there.lan.port }, addresses: [there.far], fingerprint: open.fingerprint }, open.code);
    const again = await machines.connect(link, { name: "Laptop agents" });
    assert.equal("token" in again, false, "connect says no token");
    assert.deepEqual([again.machine, again.device.name, again.device.scope, again.fingerprint], [there.machine, "Laptop agents", "view", there.lan.fingerprint]);
    assert.deepEqual(machines.list(), [again]);
    const newToken = readRemotes(here.dataDir)[0].token;
    assert.ok(newToken !== token && /^fdt_/.test(newToken));
    assert.ok(!fileOf(here.dataDir).includes(newToken), "the file never holds the new token plain");
    const seen = (await (await there.api("/api/remote/devices")).json()).devices;
    assert.deepEqual(seen.map((/** @type {any} */ d) => [d.name, d.scope, d.revokedAt != null]), [["Laptop agents", "view", false], ["Laptop", "full", true]]);
    assert.equal((await (await machines.clientOf(again)).get("/remote/me")).device?.name, "Laptop agents");

    // Forgotten: signed out there, gone here.
    const gone = await machines.forget(again);
    assert.deepEqual([gone.machine.machine.id, gone.signedOut, gone.why], [there.machine.id, true, null]);
    assert.equal("token" in gone.machine, false);
    assert.deepEqual(machines.list(), []);
    assert.ok((await (await there.api("/api/remote/devices")).json()).devices.every((/** @type {any} */ d) => d.revokedAt != null), "signed out there");
    await assert.rejects(machines.clientOf("workstation"), (/** @type {any} */ e) => e.code === EXIT.usage && /no machine "workstation"/.test(e.message));
  } finally {
    await two.stop();
  }
});

// (fails before: yes — a token was kept plain whatever the data folder's setting, and none could be sealed)
test("a token is sealed as the data folder's secrets are: one plain is sealed on first read, a secret.key made for it; with sealing off it stays plain; one another key sealed stays as it is, through every write, and is sent nowhere", async () => {
  const dirs = [0, 1].map(() => mkdtempSync(join(tmpdir(), "filament-machines-")));
  try {
    const [sealing, plain] = dirs;
    // A data folder that seals (as every new one does), with no secret.key yet: one plain and one sealed with another.
    const other = seal("fdt_other", randomBytes(32));
    writeFileSync(join(sealing, REMOTES_FILE), JSON.stringify({ remotes: [rowOf("box", "fdt_plain"), rowOf("lost", other)] }));
    const machines = createMachines({ dataDir: sealing });
    assert.deepEqual(machines.list().map((m) => m.machine.id), ["box", "lost"]);
    assert.ok(existsSync(join(sealing, "secret.key")), "a secret.key made to seal it");
    // Written again with the plain one sealed, and the one another key sealed kept as it was.
    const file = JSON.parse(fileOf(sealing)).remotes;
    assert.ok(isSealed(file[0].token) && !fileOf(sealing).includes("fdt_plain"), "the plain one sealed");
    assert.equal(file[1].token, other, "the one another key sealed, as it was");
    assert.deepEqual(readRemotes(sealing).map((r) => r.token), ["fdt_plain", other]);
    // That one is sent nowhere: said before anything is asked of its address.
    await assert.rejects(machines.clientOf("lost"), (/** @type {any} */ e) => {
      assert.equal(e.code, EXIT.failed);
      assert.match(e.message, /^lost: its token was sealed with another secret\.key than this data folder's/);
      return true;
    });

    // A data folder whose secrets are not sealed (Settings › Data and privacy › Seal secrets on disk, off): plain.
    writeFileSync(join(plain, "config.json"), JSON.stringify({ server: { encryptSecrets: false } }));
    writeFileSync(join(plain, REMOTES_FILE), JSON.stringify({ remotes: [rowOf("box", "fdt_plain")] }));
    assert.deepEqual(readRemotes(plain).map((r) => r.token), ["fdt_plain"]);
    assert.ok(fileOf(plain).includes("fdt_plain"));
    assert.equal(existsSync(join(plain, "secret.key")), false, "no key made where nothing is sealed");
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

// (fails before: yes — the f-store hunt: a read that sealed a plain token wrote back the rows it had read, so a machine
// another process kept between that read and its write — the desktop app and a command line at once — was gone)
test("a read seals a plain token only where remotes.json is still as it read it: a machine another process kept meanwhile stays, and the next read seals it", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-machines-"));
  const file = join(dir, REMOTES_FILE);
  const real = fs.writeFileSync;
  try {
    writeFileSync(file, JSON.stringify({ remotes: [rowOf("box", "fdt_plain")] }));
    // Another process keeps a machine as this read writes its sealed rows, before they take the file's place.
    let kept = false;
    fs.writeFileSync = (/** @type {any} */ path, /** @type {any} */ data, /** @type {any} */ o) => {
      real(path, data, o);
      if (!kept && String(path).startsWith(`${file}.`)) {
        kept = true;
        real(file, JSON.stringify({ remotes: [rowOf("box", "fdt_plain"), rowOf("desk", "fdt_desk")] }));
      }
    };
    syncBuiltinESMExports();
    let read;
    try {
      read = readRemotes(dir);
    } finally {
      fs.writeFileSync = real;
      syncBuiltinESMExports();
    }
    assert.ok(kept, "the read went to write its sealed rows");
    assert.deepEqual(read.map((r) => [r.machine.id, r.token]), [["box", "fdt_plain"]], "the read says what it read");
    assert.deepEqual(JSON.parse(fileOf(dir)).remotes.map((/** @type {any} */ r) => r.machine.id), ["box", "desk"], "the machine kept meanwhile stays");
    // The next read finds it as it is, and seals both.
    assert.deepEqual(readRemotes(dir).map((r) => [r.machine.id, r.token]), [["box", "fdt_plain"], ["desk", "fdt_desk"]]);
    assert.ok(!fileOf(dir).includes("fdt_plain") && !fileOf(dir).includes("fdt_desk"), "both sealed");
    assert.deepEqual(fs.readdirSync(dir).sort(), [REMOTES_FILE, "secret.key"], "no write left behind");
  } finally {
    fs.writeFileSync = real;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the f-store hunt: who it is, read no further than 64 KB, was said as "No Filament answers at …"
// with bodyText's "more than 0 MB" in brackets)
test("machineAt: an answer of who it is past 64 KB is said as that — something answered, too much — not as no Filament answering", async () => {
  const big = JSON.stringify({ id: "m-box", name: "x".repeat(70 * 1024), version: "1" });
  for (const [how, answer] of /** @type {[string, () => Response][]} */ ([
    ["as it streams", () => new Response(new Blob([big]).stream())],
    ["by its content-length", () => new Response(big, { headers: { "content-length": String(Buffer.byteLength(big)) } })],
  ]))
    await assert.rejects(machineAt("https://box.example", { fetchImpl: /** @type {any} */ (async () => answer()) }), (/** @type {any} */ e) => {
      assert.equal(e.code, EXIT.failed, how);
      assert.doesNotMatch(e.message, /No Filament answers|0 MB/, how);
      assert.match(e.message, /^https:\/\/box\.example answered who it is \(\/\.well-known\/filament\) with more than 64 KB/, how);
      return true;
    });
  // Within it, as before.
  assert.deepEqual(await machineAt("https://box.example", { fetchImpl: /** @type {any} */ (async () => Response.json({ id: "m-box", name: "Box", version: "1" })) }), { id: "m-box", name: "Box", version: "1" });
});

// (fails before: yes — the swarm's review of 11-10: a machine says its id unasked, and connecting to one that said a kept
// machine's id signed that machine's device out and took its place, its address and token, where the kept one did not
// know the device just claimed; and a claim's answer named the device's scope, "agent" among them, as it liked)
test("connectTo: a machine at a new address that says a kept machine's id takes its place only where the kept address knows the device just claimed, or answers as it no more; the scope kept is full or view", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-store-same-id-"));
  const KEPT = "http://127.0.0.1:2222";
  const NEW = "http://127.0.0.1:1111";
  try {
    /**
     * A stub of both addresses: the new one says `m-home` and hands out `tok-new` (its device's scope `scope`); the kept
     * one answers as `keptId` (none: nothing answers there) and knows the tokens in `knows` — to one it knows it lists
     * its devices, the one just claimed (`d-new`) among them where it knows `tok-new`: it is the machine that handed it
     * out. `moved`: the new one is the kept machine, and lists the device kept for it.
     * @param {{ keptId?: string, knows: string[], scope?: string, moved?: boolean }} o
     */
    const stub = ({ keptId, knows, scope = "full", moved = false }) => {
      /** @type {string[]} */
      const sent = [];
      /** @param {string[]} ids */
      const listed = (ids) => Response.json({ devices: ids.map((id) => ({ id, name: "Laptop", scope: "full", revokedAt: null })) });
      /** @type {any} */
      const f = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
        const auth = String(init.headers?.authorization ?? "").replace(/^Bearer /, "");
        sent.push(`${init.method ?? "GET"} ${url}${auth ? ` as ${auth}` : ""}`);
        if (url.startsWith(KEPT)) {
          if (!keptId) throw new TypeError("fetch failed");
          if (url.endsWith("/.well-known/filament")) return Response.json({ id: keptId, name: "Home", version: "1" });
          if (!knows.includes(auth)) return Response.json({ error: "not signed in" }, { status: 401 });
          return url.endsWith("/api/remote/devices") ? listed(["d-m-home", ...(knows.includes("tok-new") ? ["d-new"] : [])]) : Response.json({});
        }
        if (url.endsWith("/.well-known/filament")) return Response.json({ id: "m-home", name: "Home", version: "1" });
        if (url.endsWith("/api/remote/claim")) return Response.json({ token: "tok-new", device: { id: "d-new", name: "Laptop", scope } });
        if (url.endsWith("/api/remote/devices")) return listed(["d-new", ...(moved ? ["d-m-home"] : [])]);
        return Response.json({});
      };
      return { f, sent };
    };
    const keep = () => writeFileSync(join(dir, REMOTES_FILE), JSON.stringify({ remotes: [rowOf("m-home", "tok-old", { name: "Home", url: KEPT, fingerprint: undefined, machine: { id: "m-home", name: "Home" } })] }));
    const link = `${NEW}/ui/pair.html#code=ABCD-EFGH`;

    // Another Filament that says the kept one's id: the kept one answers as itself and does not know the device claimed.
    keep();
    const other = stub({ keptId: "m-home", knows: ["tok-old"] });
    await assert.rejects(connectTo(dir, link, { fetchImpl: other.f }), (/** @type {any} */ e) => {
      assert.equal(e.code, EXIT.failed);
      assert.match(e.message, /two machines say one id/);
      assert.match(e.message, /filament disconnect Home/);
      return true;
    });
    const still = readRemotes(dir);
    assert.equal(still.length, 1);
    assert.equal(still[0].url, KEPT, "the kept machine keeps its address");
    assert.equal(still[0].token, "tok-old", "and its token");
    assert.ok(!other.sent.some((s) => s.includes("sign-out") && s.includes("tok-old")), "its device is not signed out");
    assert.ok(other.sent.includes(`POST ${NEW}/api/remote/sign-out as tok-new`), "the device just claimed lets go there");

    // The same machine at a second address: the kept one knows the device claimed, and the old device signs out there.
    keep();
    const same = stub({ keptId: "m-home", knows: ["tok-old", "tok-new"], scope: "agent" });
    const row = await connectTo(dir, link, { fetchImpl: same.f });
    assert.equal(row.url, NEW);
    assert.equal(row.device.scope, "full", "a scope the claim names past full or view is kept as full");
    assert.ok(same.sent.includes(`POST ${KEPT}/api/remote/sign-out as tok-old`), "the old device signs out");
    assert.deepEqual(readRemotes(dir).map((r) => [r.url, r.token, r.device.scope]), [[NEW, "tok-new", "full"]]);

    // A view device is kept as one.
    keep();
    assert.equal((await connectTo(dir, link, { fetchImpl: stub({ keptId: "m-home", knows: ["tok-old", "tok-new"], scope: "view" }).f })).device.scope, "view");

    // The machine moved: nothing answers at the kept address, or another machine does. It is taken at the new one, which
    // knows the device kept for it (the security re-read of 11-11: before, a machine that said its id was taken so too).
    for (const keptId of [undefined, "m-elsewhere"]) {
      keep();
      const moved = await connectTo(dir, link, { fetchImpl: stub({ keptId, knows: [], moved: true }).f });
      assert.equal(moved.url, NEW, String(keptId));
      assert.deepEqual(readRemotes(dir).map((r) => r.url), [NEW], String(keptId));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the security re-read of 11-11: to learn whether the kept address knew the device just claimed,
// the token just claimed went to it as a Bearer — an address that token was never issued at, which whoever answers
// there now reads, and uses at the machine that issued it; and a kept machine that did not answer was taken at the new
// address with nothing asked of anyone)
test("connectTo: the token a claim hands out goes to the address it was claimed at alone — the kept address is asked with its own token whether it knows the device claimed, and where nothing answers there as it, the new address must know the kept device", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-store-token-"));
  const KEPT = "http://127.0.0.1:2222";
  const NEW = "http://127.0.0.1:1111";
  try {
    /**
     * A stub of both addresses. The new one says `m-home`, hands out `tok-new` for the device `claimed`, and lists the
     * devices `newLists` to it (`newStatus` other than 200: it answers that instead). The kept one answers as `keptId`
     * (none: nothing answers there) and lists `keptLists` to `tok-old` (`keptStatus`, as the new one's).
     * @param {{ keptId?: string, keptLists?: string[], keptStatus?: number, newLists?: string[], newStatus?: number, claimed?: string }} o
     */
    const stub = ({ keptId, keptLists = [], keptStatus = 200, newLists = ["d-new"], newStatus = 200, claimed = "d-new" }) => {
      /** @type {string[]} */
      const sent = [];
      const listed = (/** @type {string[]} */ ids) => Response.json({ devices: ids.map((id) => ({ id, name: "Laptop", scope: "full", revokedAt: null })) });
      /** @type {any} */
      const f = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
        const auth = String(init.headers?.authorization ?? "").replace(/^Bearer /, "");
        sent.push(`${init.method ?? "GET"} ${url}${auth ? ` as ${auth}` : ""}`);
        const [at, own, lists, status] = url.startsWith(KEPT) ? [KEPT, "tok-old", keptLists, keptStatus] : [NEW, "tok-new", newLists, newStatus];
        if (at === KEPT && !keptId) throw new TypeError("fetch failed");
        if (url.endsWith("/.well-known/filament")) return Response.json({ id: at === KEPT ? keptId : "m-home", name: "Home", version: "1" });
        if (url === `${NEW}/api/remote/claim`) return Response.json({ token: "tok-new", device: { id: claimed, name: "Laptop", scope: "full" } });
        // Each knows its own token alone: any other is no device of its.
        if (auth !== own) return Response.json({ error: "not signed in" }, { status: 401 });
        if (url.endsWith("/api/remote/devices")) return status === 200 ? listed(lists) : Response.json({ error: "refused" }, { status });
        return Response.json({});
      };
      return { f, sent };
    };
    const keep = () => writeFileSync(join(dir, REMOTES_FILE), JSON.stringify({ remotes: [rowOf("m-home", "tok-old", { name: "Home", url: KEPT, fingerprint: undefined, machine: { id: "m-home", name: "Home" } })] }));
    const link = `${NEW}/ui/pair.html#code=ABCD-EFGH`;
    /** Whether a call went to an address with a token that address did not issue. @param {string[]} sent */
    const astray = (sent) => sent.filter((s) => (s.includes(KEPT) && s.includes("tok-new")) || (s.includes(NEW) && s.includes("tok-old")));
    /** The kept machine, as it was. */
    const untouched = () => assert.deepEqual(readRemotes(dir).map((r) => [r.url, r.token, r.device.id]), [[KEPT, "tok-old", "d-m-home"]], "the kept machine stays as it was");
    /** A connect refused: the kept machine as it was, the device just claimed let go where it was claimed. @param {ReturnType<typeof stub>} s @param {RegExp} why */
    const refused = async (s, why) => {
      keep();
      await assert.rejects(connectTo(dir, link, { fetchImpl: s.f }), (/** @type {any} */ e) => {
        assert.equal(e.code, EXIT.failed);
        assert.match(e.message, why);
        assert.match(e.message, /Home is kept as it was\. If http:\/\/127\.0\.0\.1:1111 is the one you meant, disconnect the other first \(filament disconnect Home\), then connect again\.$/);
        return true;
      });
      untouched();
      assert.ok(s.sent.includes(`POST ${NEW}/api/remote/sign-out as tok-new`), "the device just claimed lets go there");
      assert.ok(!s.sent.some((x) => x.includes("sign-out") && x.includes("tok-old")), "the kept device is not signed out");
      assert.deepEqual(astray(s.sent), [], "no token went to an address that did not issue it");
    };

    // The same machine at a second address: the kept one, asked with its own token, lists the device just claimed.
    keep();
    const same = stub({ keptId: "m-home", keptLists: ["d-m-home", "d-new"] });
    assert.equal((await connectTo(dir, link, { fetchImpl: same.f })).url, NEW);
    assert.deepEqual(astray(same.sent), [], "no token went to an address that did not issue it");
    assert.ok(same.sent.includes(`GET ${KEPT}/api/remote/devices as tok-old`), "the kept address is asked with the kept token");
    assert.deepEqual(readRemotes(dir).map((r) => [r.url, r.token]), [[NEW, "tok-new"]]);

    // Another machine that says its id: the kept one does not list the device it handed out.
    await refused(stub({ keptId: "m-home", keptLists: ["d-m-home"] }), /does not know the device just claimed: two machines say one id/);
    // One that names the kept device itself as the device it handed out: a device kept already is none just claimed.
    await refused(stub({ keptId: "m-home", keptLists: ["d-m-home"], claimed: "d-m-home" }), /does not know the device just claimed: two machines say one id/);
    // The kept one answers as itself and lists nothing to the kept device (signed out there, or one that only reads):
    // nothing shows the two are one machine.
    for (const keptStatus of [401, 403]) await refused(stub({ keptId: "m-home", keptStatus, newLists: ["d-new", "d-m-home"] }), /did not say whether it knows the device just claimed/);

    // Nothing answers at the kept address, or another machine does: the machine moved where the new address knows the
    // device kept for it…
    for (const keptId of [undefined, "m-elsewhere"]) {
      keep();
      const moved = stub({ keptId, newLists: ["d-new", "d-m-home"] });
      assert.equal((await connectTo(dir, link, { fetchImpl: moved.f })).url, NEW, String(keptId));
      assert.deepEqual(astray(moved.sent), [], String(keptId));
      assert.ok(moved.sent.includes(`GET ${NEW}/api/remote/devices as tok-new`), "the new address is asked with the token it handed out");
      assert.deepEqual(readRemotes(dir).map((r) => [r.url, r.token]), [[NEW, "tok-new"]], String(keptId));
      // …and is no more than a machine that says its id where it does not, or does not say.
      await refused(stub({ keptId }), /does not know the device kept for it/);
      await refused(stub({ keptId, newStatus: 403 }), /does not know the device kept for it/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
