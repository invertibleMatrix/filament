// @ts-check
// The devices paired with this Filament and the codes that pair them (the owner's remote Filament of 11-06, Part 1):
// a code good for five minutes and one claim, wrong ones counted, and only a token's hash kept, in devices.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODE_ALPHABET, CODE_TTL_MS, GUESS_WINDOW_MS, GUESSES_IN_ALL, GUESSES_PER_SOURCE, OPEN_CODES, TOKEN_PREFIX, createDevices, normalCode } from "../src/services/devices.js";

/** A store on a clock the test moves. @param {string | null} [dataDir] */
const world = (dataDir = null) => {
  const clock = { t: 1_000_000 };
  /** @type {string[]} */
  const said = [];
  const devices = createDevices({ dataDir, now: () => clock.t, log: (level, msg) => said.push(`${level} ${msg}`) });
  return { clock, said, devices };
};
/** @param {(dir: string) => void} fn */
const inDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-devices-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// (fails before: yes — there was no way to pair a device)
test("a code is eight letters and digits that read aloud as meant, good for five minutes and one claim; its token is handed out once and only its hash is kept", () =>
  inDir((dir) => {
    const { clock, devices } = world(dir);
    const open = devices.startPairing({ scope: "full" });
    assert.match(open.code, new RegExp(`^[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{4}$`));
    assert.equal(open.expiresAt, clock.t + CODE_TTL_MS);
    assert.deepEqual(devices.pending(), [{ id: open.id, scope: "full", expiresAt: open.expiresAt, leftMs: CODE_TTL_MS }], "the open codes, never the code");
    // Typed in lower case, without the dash, with spaces: the same code.
    const got = devices.claim(` ${open.code.toLowerCase().replace("-", " ")} `, { name: "  MacBook\tAir ", kind: "browser", from: "100.64.0.7" });
    assert.ok(got.ok);
    assert.ok(got.token.startsWith(TOKEN_PREFIX) && got.token.length > 40);
    assert.deepEqual([got.device.name, got.device.scope, got.device.kind, got.device.createdAt, got.device.revokedAt], ["MacBook Air", "full", "browser", clock.t, null]);
    assert.ok(!("hash" in got.device), "no hash said");
    assert.deepEqual(devices.pending(), [], "used");
    const again = devices.claim(open.code, { from: "100.64.0.7" });
    assert.equal(again.ok, false, "one claim");
    const onDisk = readFileSync(join(dir, "devices.json"), "utf8");
    assert.ok(!onDisk.includes(got.token), "the token is never kept");
    assert.equal(JSON.parse(onDisk).devices[0].hash, createHash("sha256").update(got.token).digest("hex"));
    assert.deepEqual(readdirSync(dir).sort(), ["devices.json"], "nothing in config.json, no temporary file");
    assert.deepEqual(devices.list().map((d) => [d.name, "hash" in d]), [["MacBook Air", false]]);
  }));

test("a code past its five minutes is refused; a view code makes a view device; past OPEN_CODES open, the oldest goes", () => {
  const { clock, devices } = world();
  const late = devices.startPairing();
  clock.t += CODE_TTL_MS;
  assert.equal(devices.claim(late.code).ok, false, "run out");
  const view = devices.startPairing({ scope: "view" });
  const v = devices.claim(view.code, { name: "Phone" });
  assert.ok(v.ok);
  assert.equal(v.device.scope, "view");
  // (fails before: yes — a scope that was neither read as full; the review of 882809c20)
  assert.equal(devices.startPairing({ scope: "anything" }).scope, "view", "a scope that is none of the two reads");
  assert.equal(devices.startPairing({ scope: "View" }).scope, "view");
  devices.cancelPairing();
  const codes = Array.from({ length: OPEN_CODES + 1 }, () => devices.startPairing().code);
  assert.equal(devices.pending().length, OPEN_CODES);
  assert.equal(devices.claim(codes[0]).ok, false, "the oldest went");
  assert.equal(devices.claim(codes[OPEN_CODES]).ok, true);
});

// (fails before: yes — a code had no id: a page could not tell its own claim from another's, and a close closed every code)
test("each open code has an id: its time left said by the store's clock, closed alone by it, and named by the device that claims it", () => {
  const { clock, devices } = world();
  const a = devices.startPairing();
  const b = devices.startPairing({ scope: "view" });
  assert.notEqual(a.id, b.id);
  assert.equal(a.leftMs, CODE_TTL_MS);
  clock.t += 60_000;
  assert.deepEqual(devices.pending().map((c) => [c.id, c.leftMs]), [[a.id, CODE_TTL_MS - 60_000], [b.id, CODE_TTL_MS - 60_000]]);
  assert.equal(devices.cancelPairing(a.id), true, "the one named");
  assert.deepEqual(devices.pending().map((c) => c.id), [b.id], "the other stays open");
  assert.equal(devices.cancelPairing(a.id), false, "gone already");
  assert.equal(devices.claim(a.code).ok, false, "a code closed is refused");
  const got = devices.claim(b.code, { name: "Phone" });
  assert.ok(got.ok);
  assert.equal(got.device.pairing, b.id, "the device names the code it claimed");
  devices.startPairing();
  devices.startPairing();
  assert.equal(devices.cancelPairing(), true, "none named: every code");
  assert.deepEqual(devices.pending(), []);
});

test("wrong codes are counted: five from one address hold that address, the right code too, till the window passes; others go on", () => {
  const { clock, devices } = world();
  const open = devices.startPairing();
  for (let i = 0; i < GUESSES_PER_SOURCE; i++) assert.equal(devices.claim("AAAA-AAAA", { from: "10.0.0.9" }).ok, false);
  const held = devices.claim(open.code, { from: "10.0.0.9" });
  assert.equal(held.ok, false);
  assert.ok(!held.ok && held.retryAt === 1_000_000 + GUESS_WINDOW_MS && /too many wrong codes/i.test(held.why));
  assert.deepEqual(devices.pending().length, 1, "the code stays open for the rest");
  clock.t += GUESS_WINDOW_MS;
  const after = devices.startPairing();
  assert.equal(devices.claim(after.code, { from: "10.0.0.9" }).ok, true, "the window passed");
  assert.equal(devices.claim(open.code, { from: "10.0.0.10" }).ok, false, "the first code ran out meanwhile");
});

test("twenty wrong codes from anywhere drop every open code and hold every claim till the window passes", () => {
  const { clock, devices } = world();
  const open = devices.startPairing();
  for (let i = 0; i < GUESSES_IN_ALL; i++) devices.claim("BBBB-BBBB", { from: `10.0.1.${i}` });
  assert.deepEqual(devices.pending(), [], "the open codes went");
  const fresh = devices.startPairing();
  assert.equal(devices.claim(fresh.code, { from: "10.0.2.1" }).ok, false, "held, a new code too");
  assert.equal(devices.claim(open.code, { from: "10.0.2.1" }).ok, false);
  clock.t += GUESS_WINDOW_MS;
  assert.equal(devices.claim(devices.startPairing().code, { from: "10.0.2.1" }).ok, true);
});

test("a token finds its device until it is revoked; last seen moves, written once a minute; rename, revoke and forget are kept", () =>
  inDir((dir) => {
    const { clock, devices } = world(dir);
    const got = devices.claim(devices.startPairing().code, { name: "Laptop", from: "192.168.1.20" });
    assert.ok(got.ok);
    const id = got.device.id;
    assert.equal(devices.any(), true);
    assert.equal(devices.verify("nope"), null);
    assert.equal(devices.verify(`${TOKEN_PREFIX}wrong`), null);
    assert.equal(devices.verify(got.token.slice(TOKEN_PREFIX.length)), null, "the prefix is part of it");
    clock.t += 61_000;
    assert.deepEqual([devices.verify(got.token, "192.168.1.20")?.id, devices.get(id)?.lastSeenAt], [id, clock.t]);
    const kept = () => JSON.parse(readFileSync(join(dir, "devices.json"), "utf8")).devices[0];
    assert.equal(kept().lastSeenAt, clock.t, "a minute since: written");
    const at = clock.t;
    clock.t += 5_000;
    devices.verify(got.token, "192.168.1.21");
    assert.deepEqual([devices.get(id)?.lastSeenAt, devices.get(id)?.lastSeenFrom], [clock.t, "192.168.1.21"]);
    assert.equal(kept().lastSeenAt, at, "five seconds later: not written again");
    assert.equal(devices.rename(id, "Work laptop")?.name, "Work laptop");
    assert.equal(devices.rename(id, "   ")?.name, "Work laptop", "an empty name keeps the one it had");
    assert.equal(devices.forget(id), false, "a device in use is revoked first");
    assert.equal(devices.revoke(id)?.revokedAt, clock.t);
    assert.equal(devices.verify(got.token), null, "revoked: at once");
    assert.equal(devices.any(), false);
    const reread = createDevices({ dataDir: dir, now: () => clock.t });
    assert.deepEqual([reread.get(id)?.name, reread.get(id)?.revokedAt], ["Work laptop", clock.t], "kept across a restart");
    assert.equal(reread.verify(got.token), null);
    assert.equal(reread.forget(id), true);
    assert.deepEqual(createDevices({ dataDir: dir }).list(), []);
    // A scope written as neither — by hand, by a later Filament — reads (the review of 882809c20).
    const odd = devices.claim(devices.startPairing({ scope: "full" }).code, { name: "Odd" });
    assert.ok(odd.ok);
    const j = JSON.parse(readFileSync(join(dir, "devices.json"), "utf8"));
    writeFileSync(join(dir, "devices.json"), JSON.stringify({ ...j, devices: j.devices.map((/** @type {any} */ d) => ({ ...d, scope: "admin" })) }));
    assert.equal(createDevices({ dataDir: dir, now: () => clock.t }).verify(odd.token)?.scope, "view");
    assert.equal(devices.rename("no-such", "x"), null);
    assert.equal(devices.revoke("no-such"), null);
  }));

// (fails before: yes — the remote access redesign: a full device forgotten left its agents' device, revoked with it, on
// the list, where Settings › Remote access shows it on no card)
test("a full device forgotten takes its machine's agents' device, revoked with it, off the list too; another device's stays", () =>
  inDir((dir) => {
    const { devices } = world(dir);
    const pair = (/** @type {string} */ name) => {
      const got = devices.claim(devices.startPairing({ scope: "full" }).code, { name });
      assert.ok(got.ok);
      const agents = devices.mintAgents(got.device.id, { from: name });
      assert.ok(agents.ok);
      return [got.device.id, agents.device.id];
    };
    const [mac, macAgents] = pair("Mac");
    const [pc, pcAgents] = pair("PC");
    devices.revoke(mac);
    devices.revoke(pc);
    assert.equal(devices.forget(mac), true);
    assert.deepEqual(devices.list().map((d) => d.id).sort(), [pc, pcAgents].sort());
    assert.equal(devices.get(macAgents), null);
    assert.deepEqual(createDevices({ dataDir: dir }).list().map((d) => d.id).sort(), [pc, pcAgents].sort(), "kept so");
  }));

test("a devices.json that cannot be read lets no device in, is set aside and said; the next pairing writes a new one", () =>
  inDir((dir) => {
    writeFileSync(join(dir, "devices.json"), "{ torn");
    const { said, devices } = world(dir);
    assert.deepEqual(devices.list(), []);
    assert.equal(readFileSync(join(dir, "devices.json.unreadable-1000000"), "utf8"), "{ torn");
    assert.equal(said.length, 1);
    assert.match(said[0], /^warn \[devices\] could not read .*devices\.json .*set aside as .*devices\.json\.unreadable-1000000: every device paired before pairs again$/);
    assert.ok(devices.claim(devices.startPairing().code).ok);
    assert.ok(existsSync(join(dir, "devices.json")));
  }));

// (fails before: yes — the code's id was dropped on reading devices.json, and a claim or a revoke whose file could not
// be written was answered as kept: the claimed token died at the next restart, the revoked one came back)
test("a device keeps its code's id across a restart; a claim the file cannot keep is undone, the code still open; a revoke it cannot keep is said, and kept by the next save", () =>
  inDir((dir) => {
    const w = world(dir);
    const open = w.devices.startPairing({ scope: "full" });
    const got = w.devices.claim(open.code, { name: "Laptop" });
    assert.ok(got.ok);
    assert.equal(createDevices({ dataDir: dir }).get(got.device.id)?.pairing, open.id, "the code's id read back");
    // The file cannot be written: its stand-in beside it is a folder.
    const tmp = join(dir, "devices.json.tmp");
    mkdirSync(tmp);
    const second = w.devices.startPairing({ scope: "view" });
    const refused = w.devices.claim(second.code, { name: "Phone" });
    assert.equal(refused.ok, false);
    assert.equal(/** @type {any} */ (refused).unsaved, true);
    assert.match(/** @type {any} */ (refused).why, /could not keep this device/);
    assert.equal(w.devices.list().length, 1, "no device kept in memory either");
    assert.deepEqual(w.devices.pending().map((c) => c.id), [second.id], "the code is still open");
    const revoked = w.devices.revoke(got.ok ? got.device.id : "");
    assert.ok(revoked?.unsaved, "the revoke says it is not kept");
    assert.equal(w.devices.verify(got.ok ? got.token : ""), null, "revoked now all the same");
    rmSync(tmp, { recursive: true, force: true });
    const again = w.devices.claim(second.code, { name: "Phone" });
    assert.ok(again.ok, "the code claimed once the file is written");
    const after = createDevices({ dataDir: dir });
    assert.equal(after.verify(got.ok ? got.token : ""), null, "the revoke kept by the next save");
    assert.equal(after.list().length, 2);
  }));

// (fails before: yes — a device kept no machine, so Settings › Remote access could not show a machine's app and its
// agents on one card)
test("a claim from a machine's app keeps that machine's id, lowercased, across a restart; anything that is no id is kept as none", () =>
  inDir((dir) => {
    const w = world(dir);
    const ID = "1A8ABE5B-793A-444B-81D9-F37AF35B242E";
    const app = w.devices.claim(w.devices.startPairing({ scope: "full" }).code, { name: "Filament app on MacBook", machine: ` ${ID} ` });
    assert.ok(app.ok);
    assert.equal(app.device.machine, ID.toLowerCase());
    for (const machine of ["", "m-box", "1a8abe5b-793a-444b-81d9-f37af35b242", 42, { id: ID }, null]) {
      const got = w.devices.claim(w.devices.startPairing({ scope: "view" }).code, { name: "Phone", machine });
      assert.ok(got.ok);
      assert.equal("machine" in got.device, false, JSON.stringify(machine));
    }
    assert.equal(createDevices({ dataDir: dir }).get(app.device.id)?.machine, ID.toLowerCase(), "read back");
  }));

test("a code as typed: upper case, letters and digits alone", () => {
  assert.equal(normalCode(" ab cd-23 4x "), "ABCD234X");
  assert.equal(normalCode(null), "");
});
