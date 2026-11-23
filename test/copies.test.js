// @ts-check
// Copies (the remote plan's cp-root): the folder of Filament's own where another machine's agents work in a copy of
// their project — one folder per sending machine, kept across a second mint; a copy taken, held, let go and taken
// again; the room a machine has; a week idle; Clear; and the fence that lets a machine's agents into their own folder
// alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse, sep } from "node:path";
import { createDevices } from "../src/services/devices.js";
import { COPIES, GRACE_MS, copiesRootOf, createCopies, folderKeyOf, folderName } from "../src/services/copies.js";
import { agentFolderRefusal, copiesRefusal } from "../src/http/admin/remote.js";
import { addedFoldersOf, folderVerdict, newFolderRefusal } from "../src/app/agent/turn.js";

/** @param {import("node:test").TestContext} t @param {string} name */
const folder = (t, name) => {
  const d = mkdtempSync(join(tmpdir(), `filament-copies-${name}-`));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

/**
 * Two machines' agents paired here: a full device each, its machine's id said, and an agents' device minted by it.
 * @param {string} dataDir
 */
const paired = (dataDir) => {
  const devices = createDevices({ dataDir });
  /** @param {string} name @param {string} machine */
  const machineOf = (name, machine) => {
    const full = devices.claim(devices.startPairing({ scope: "full" }).code, { name: `Filament app on ${name}`, machine });
    assert.ok(full.ok);
    const agents = devices.mintAgents(full.device.id, { from: name });
    assert.ok(agents.ok);
    return { full: full.device.id, agents: agents.device.id };
  };
  return { devices, machineOf };
};

// (fails before: yes — there was no copies folder: another machine's agents worked in the person's own clone)
test("a copy is taken in its machine's folder, held, let go and taken again; a second launch while one holds it gets its own; a second mint keeps the machine's folder; two machines of one name each have their own", (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, machineOf } = paired(data);
  const pc = machineOf("DESKTOP-1", "11111111-1111-4111-8111-111111111111");
  let at = 1_000;
  const copies = createCopies({ dataDir: data, root, devices, now: () => at });
  assert.equal(copies.folderOf(pc.agents), "", "no folder is opened before one is made");
  assert.equal(copies.folderOf(pc.full), "", "a full device keeps no copies");

  const first = copies.take(pc.agents, "web-shop");
  assert.ok(first.ok);
  assert.equal(first.copy.folder, join(root, "From DESKTOP-1", "web-shop", "1"));
  assert.ok(existsSync(first.copy.folder));
  assert.equal(copies.folderOf(pc.agents), join(root, "From DESKTOP-1"));
  const second = copies.take(pc.agents, "web-shop");
  assert.ok(second.ok && !second.reused);
  assert.equal(second.copy.folder, join(root, "From DESKTOP-1", "web-shop", "2"), "the first is held: a second gets its own");

  at += 10;
  assert.ok(copies.release(first.copy.id));
  const again = copies.take(pc.agents, "web-shop");
  assert.ok(again.ok && again.reused);
  assert.equal(again.copy.id, first.copy.id, "an idle copy of its project is taken again");

  // A second mint replaces the agents' device: its machine's folder stays theirs.
  const remint = devices.mintAgents(pc.full, { from: "DESKTOP-1" });
  assert.ok(remint.ok);
  assert.equal(copies.folderOf(remint.device.id), join(root, "From DESKTOP-1"));
  assert.deepEqual(copies.usage(remint.device.id), { count: 2, bytes: 0, folder: join(root, "From DESKTOP-1"), chats: [] });

  // Another machine of the same name: its own folder.
  const other = machineOf("DESKTOP-1", "22222222-2222-4222-8222-222222222222");
  const theirs = copies.take(other.agents, "web-shop");
  assert.ok(theirs.ok);
  assert.equal(theirs.copy.folder, join(root, "From DESKTOP-1 (22222222)", "web-shop", "1"));

  // Kept: a new store reads them back.
  const read = createCopies({ dataDir: data, root, devices, now: () => at });
  assert.equal(read.list().length, 3);
  assert.equal(read.folderOf(other.agents), join(root, "From DESKTOP-1 (22222222)"));
  assert.match(readFileSync(join(data, "copies.json"), "utf8"), /From DESKTOP-1 \(22222222\)",/);
});

// (fails before: yes — the security re-read of 11-11: a machine's copies were kept by the id its claim stated, which a
// machine states as it likes: a second machine that stated the first's id was given the first's folder, its idle copy
// and its count, and its Clear took them)
test("copies are kept by the device this Filament issued, never by the id a claim states: machines that state one id each have their own folder, and none takes, reads, counts or clears another's", async (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, machineOf } = paired(data);
  const STATED = "11111111-1111-4111-8111-111111111111";
  const pc = machineOf("DESKTOP-1", STATED);
  const copies = createCopies({ dataDir: data, root, devices });
  const first = copies.take(pc.agents, "web-shop");
  assert.ok(first.ok);
  assert.ok(copies.release(first.copy.id));

  // Another machine whose claim states the same id, under another name and under the same one.
  const box = machineOf("Build box", STATED);
  assert.equal(copies.folderOf(box.agents), "", "the first machine's folder is not opened to it");
  assert.equal(copies.fenceOf(box.agents).copies, "");
  assert.equal(copies.usage(box.agents), null, "nor counted as its own");
  assert.equal(copies.copyAt(box.agents, first.copy.folder), null, "nor its copy found for it");
  const theirs = copies.take(box.agents, "web-shop");
  assert.ok(theirs.ok && !theirs.reused, "the first machine's idle copy is not handed to it");
  assert.equal(theirs.copy.folder, join(root, "From Build box", "web-shop", "1"));
  const twin = machineOf("DESKTOP-1", STATED);
  const twins = copies.take(twin.agents, "web-shop");
  assert.ok(twins.ok && !twins.reused);
  assert.equal(twins.copy.folder, join(root, "From DESKTOP-1 (11111111)", "web-shop", "1"), "one of the same name too: the id it states is in its folder's name, to tell them apart by");
  assert.deepEqual([copies.folderOf(pc.agents), copies.folderOf(box.agents), copies.folderOf(twin.agents)], [join(root, "From DESKTOP-1"), join(root, "From Build box"), join(root, "From DESKTOP-1 (11111111)")]);
  assert.deepEqual([pc, box, twin].map((m) => copies.usage(m.agents)?.count), [1, 1, 1]);

  // A second mint keeps its machine's folder: the app's device that minted both is the one this Filament issued.
  const remint = devices.mintAgents(pc.full, { from: "DESKTOP-1" });
  assert.ok(remint.ok);
  assert.equal(copies.folderOf(remint.device.id), join(root, "From DESKTOP-1"));
  const again = copies.take(remint.device.id, "web-shop");
  assert.ok(again.ok && again.reused && again.copy.id === first.copy.id);

  // Clear takes its own machine's alone.
  assert.deepEqual(await copies.clear(box.agents), { cleared: 1, bytes: 0, failed: [] });
  assert.deepEqual(copies.list().map((c) => c.id).sort(), [first.copy.id, twins.copy.id].sort());
  assert.equal(existsSync(first.copy.folder), true);
});

// (fails before: yes — a list kept before the change named each machine by the id its claim stated, and a second machine
// that stated it read the first's copies from it)
test("copies kept under the id a claim stated are found again by the devices that took them: each machine's folder and copies go to the app's device that minted those, and what no device of this Filament's took stays closed", (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, machineOf } = paired(data);
  const STATED = "11111111-1111-4111-8111-111111111111";
  const GONE = "44444444-4444-4444-8444-444444444444";
  const pc = machineOf("DESKTOP-1", STATED);
  const other = machineOf("Build box", STATED);
  const mine = join(root, "From DESKTOP-1");
  const lost = join(root, "From Old box");
  for (const f of [join(mine, "web-shop", "1"), join(lost, "p", "1")]) mkdirSync(f, { recursive: true });
  const copy = (/** @type {string} */ id, /** @type {string} */ machine, /** @type {string} */ device, /** @type {string} */ project, /** @type {string} */ at) => ({ id, machine, device, by: [device], project, folder: at, madeAt: 1, usedAt: 1, busyUntil: 0, bytes: 0, chat: "" });
  writeFileSync(
    join(data, "copies.json"),
    JSON.stringify({
      version: 1,
      machines: { [STATED]: { folder: mine, name: "DESKTOP-1", store: join(root, ".mirrors", "From DESKTOP-1"), stores: { "web-shop": { usedAt: 1, bytes: 7 } } }, [GONE]: { folder: lost, name: "Old box" } },
      copies: [copy("c-1", STATED, pc.agents, "web-shop", join(mine, "web-shop", "1")), copy("c-2", GONE, "a-device-long-gone", "p", join(lost, "p", "1"))],
      leftovers: [],
    }),
  );
  const copies = createCopies({ dataDir: data, root, devices, now: () => 1_000 });
  assert.equal(copies.folderOf(pc.agents), mine, "found again by the device that took them");
  assert.deepEqual(copies.usage(pc.agents), { count: 1, bytes: 7, folder: mine, chats: [] });
  const again = copies.take(pc.agents, "web-shop");
  assert.ok(again.ok && again.reused && again.copy.id === "c-1", "its idle copy is taken again");
  assert.equal(again.copy.machine, pc.full, "kept by the app's device that minted its agents'");
  // A machine that states the same id reads none of it; what no device here took is no device's.
  assert.equal(copies.folderOf(other.agents), "");
  assert.equal(copies.usage(other.agents), null);
  assert.equal(copies.list().find((c) => c.id === "c-2")?.machine, GONE, "left as it was kept: it goes when idle");
  for (const d of [pc.agents, other.agents]) assert.equal(copies.copyAt(d, join(lost, "p", "1")), null);
  // Kept so: the next read finds it by the device.
  const read = createCopies({ dataDir: data, root, devices, now: () => 1_000 });
  assert.equal(read.folderOf(pc.agents), mine);
  assert.match(readFileSync(join(data, "copies.json"), "utf8"), new RegExp(`"${pc.full}": \\{`));
});

// (fails before: yes — a copy kept no chat: a launch's chat there was refused nothing once a newer launch took its copy,
// and worked in a folder checked out again under it; cp-place)
test("a copy is its launch's chat's: the first chat started in it alone; its turns hold it, it stays a while after for a follow-up, then a newer launch takes the one idle longest and the chat is refused in words", (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, machineOf } = paired(data);
  const pc = machineOf("DESKTOP-1", "55555555-5555-4555-8555-555555555555");
  let at = 1_000;
  const copies = createCopies({ dataDir: data, root, devices, now: () => at });
  const first = copies.take(pc.agents, "widgets");
  const second = copies.take(pc.agents, "widgets");
  assert.ok(first.ok && second.ok);
  assert.equal(copies.bind(first.copy.id, "chat-a"), true);
  // (fails before: yes — the re-review of cp-place: a chat whose name never reached its launch held the copy, and every
  // chat the launch started again there was refused)
  assert.equal(copies.bind(first.copy.id, "chat-lost"), true, "chat-a ran no turn there: a chat started again takes it");
  assert.equal(copies.lease(first.copy.id, "chat-a"), "its copy here went to a newer launch of its project once this chat let it go: a new launch takes a fresh one");
  assert.equal(copies.bind(first.copy.id, "chat-a"), true, "chat-lost ran none either");
  assert.equal(copies.bind("nope", "chat-a"), false);

  // A turn holds it, its end leaves it the chat's a while, past that it is idle and its own chat takes it again.
  assert.equal(copies.lease(first.copy.id, "chat-a"), "");
  assert.equal(copies.bind(first.copy.id, "chat-b"), false, "another chat, once chat-a ran a turn there: not its");
  assert.equal(copies.bind(first.copy.id, "chat-a"), true, "the same chat again");
  assert.equal(copies.lease(first.copy.id, "chat-b"), "its copy here went to a newer launch of its project once this chat let it go: a new launch takes a fresh one");
  assert.ok(copies.grace(first.copy.id));
  at += GRACE_MS - 1;
  const third = copies.take(pc.agents, "widgets");
  assert.ok(third.ok && !third.reused, "within its while: a new launch gets its own");
  assert.ok(copies.release(second.copy.id));
  at += 2;
  assert.equal(copies.lease(first.copy.id, "chat-a"), "", "idle, and still its chat's: a follow-up holds it again");
  assert.ok(copies.grace(first.copy.id));

  // Both let go; a newer launch takes the one idle longest, and the chat whose copy that was is refused.
  at += GRACE_MS + 1;
  const reused = copies.take(pc.agents, "widgets");
  assert.ok(reused.ok && reused.reused);
  assert.equal(reused.copy.id, second.copy.id, "the one idle longest");
  at += 10;
  const next = copies.take(pc.agents, "widgets");
  assert.ok(next.ok && next.reused);
  assert.equal(next.copy.id, first.copy.id);
  assert.equal(copies.lease(first.copy.id, "chat-a"), "its copy here went to a newer launch of its project once this chat let it go: a new launch takes a fresh one");
  assert.equal(copies.bind(first.copy.id, "chat-c"), true, "the newer launch's chat");
  assert.equal(copies.lease("nope", "chat-a"), "its copy here was cleared, or left idle until it went: a new launch takes a fresh one");

  // Kept: a new store reads whose each is.
  const read = createCopies({ dataDir: data, root, devices, now: () => at });
  assert.equal(read.lease(first.copy.id, "chat-c"), "");

  // (fails before: yes — the review of cp-place: a turn that paused on a question let its copy go after half an hour,
  // and a chat's sub-agent or background command at work there past its turn held nothing)
  // A turn that paused on a question keeps it past that question's lapse; a chat whose work still runs there keeps it.
  assert.ok(read.grace(first.copy.id, at + 3 * 3600_000));
  at += 3 * 3600_000 + GRACE_MS - 1;
  const waiting = read.take(pc.agents, "widgets");
  assert.ok(waiting.ok && waiting.copy.id !== first.copy.id, "its question still waits: a newer launch gets another");
  // Its question lapsed and every other copy let go since: a chat whose work still runs there keeps it all the same.
  at += 3600_000;
  for (const c of read.list()) if (c.id !== first.copy.id) read.release(c.id);
  let works = true;
  read.setWorking((chat) => works && chat === "chat-c");
  const working = read.take(pc.agents, "widgets");
  assert.ok(working.ok && working.copy.id !== first.copy.id, "its chat's work runs on: not taken");
  works = false;
  const done = read.take(pc.agents, "widgets");
  assert.deepEqual([done.ok && done.copy.id, read.get(first.copy.id)?.chat], [first.copy.id, ""], "its work done: the one idle longest, taken");
});

// (fails before: yes — the swarm's review of 11-10: a single command another machine's agents ran in a copy, bound to no
// chat, held nothing: past its chat's while, a newer launch took the copy and checked out over the running command)
test("a single command running in a copy holds it: no newer launch takes it until the command ends", (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, machineOf } = paired(data);
  const pc = machineOf("DESKTOP-1", "66666666-6666-4666-8666-666666666666");
  let at = 1_000;
  const copies = createCopies({ dataDir: data, root, devices, now: () => at });
  const one = copies.take(pc.agents, "widgets");
  assert.ok(one.ok);
  assert.ok(copies.release(one.copy.id));
  at += 10;
  /** @type {string[]} */
  let running = [join(one.copy.folder, "src")];
  copies.holdWhile((f) => running.some((cwd) => folderKeyOf(cwd).startsWith(folderKeyOf(f))));
  const next = copies.take(pc.agents, "widgets");
  assert.ok(next.ok && next.copy.id !== one.copy.id, "its command runs there: a newer launch gets its own");
  assert.ok(copies.release(next.copy.id));
  running = [];
  at += 10;
  const again = copies.take(pc.agents, "widgets");
  assert.ok(again.ok && again.reused && again.copy.id === one.copy.id, "its command ended: the one idle longest is taken");
});

// (fails before: yes — nothing kept another machine's copies in bounds)
test("a machine's room: past its copies, the oldest idle one goes and its chats are told; with every one held, a make is refused in words; past its bytes, the same", async (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, machineOf } = paired(data);
  const pc = machineOf("DESKTOP-1", "11111111-1111-4111-8111-111111111111");
  let at = 1_000;
  const copies = createCopies({ dataDir: data, root, devices, now: () => at, maxCopies: 2, maxBytes: 1024 ** 2 });
  /** @type {any[]} */
  const heard = [];
  copies.onCleared((c) => heard.push(c));
  const a = copies.take(pc.agents, "a");
  const b = copies.take(pc.agents, "b");
  assert.ok(a.ok && b.ok);
  const c = copies.take(pc.agents, "c");
  assert.deepEqual(c, { ok: false, why: "DESKTOP-1's agents have 2 copies in use on this machine, the most it keeps for them: no more is made until one is let go" });

  at += 10;
  copies.release(a.copy.id);
  const aKey = folderKeyOf(a.copy.folder);
  const c2 = copies.take(pc.agents, "c");
  assert.ok(c2.ok);
  await copies.settled();
  assert.equal(existsSync(a.copy.folder), false, "the oldest idle copy went");
  assert.deepEqual(heard, [{ machine: pc.full, devices: [pc.agents], folders: [a.copy.folder], keys: [aKey], chats: [], why: "room" }], "told by the device this Filament issued, never by the id its claim stated");

  // Its bytes as measured: the copies in use past them, a make is refused, and the idle one is not let go for nothing.
  writeFileSync(join(b.copy.folder, "big.bin"), Buffer.alloc(2 * 1024 ** 2));
  assert.equal(await copies.measure(b.copy.id), 2 * 1024 ** 2);
  at += 10;
  copies.release(c2.copy.id);
  const d = copies.take(pc.agents, "d");
  assert.deepEqual(d, { ok: false, why: "DESKTOP-1's copies in use take 2 MB on this machine, past the 1 MB kept for them: clear them in Settings › Remote access" });
  assert.equal(copies.list().length, 2, "nothing let go for a make refused");
  at += 10;
  copies.release(b.copy.id);
  const e = copies.take(pc.agents, "e");
  assert.ok(e.ok, "both idle: they go for room, by count and by bytes");
  await copies.settled();
  assert.deepEqual(copies.list().map((x) => x.project), ["e"]);
  assert.deepEqual(heard.slice(1).map((h) => h.folders), [[c2.copy.folder, b.copy.folder]]);
});

// (fails before: yes — nothing let another machine's copies go)
test("a copy idle a week goes, one held stays; Clear takes a machine's copies, held ones too, and its folder, and tells whose devices they were", async (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, machineOf } = paired(data);
  const pc = machineOf("DESKTOP-1", "11111111-1111-4111-8111-111111111111");
  const box = machineOf("Build box", "33333333-3333-4333-8333-333333333333");
  let at = 1_000;
  const copies = createCopies({ dataDir: data, root, devices, now: () => at, idleMs: 100 });
  /** @type {any[]} */
  const heard = [];
  copies.onCleared((c) => heard.push(c));
  const idle = copies.take(pc.agents, "a");
  const held = copies.take(pc.agents, "b", { leaseMs: 10_000 });
  const theirs = copies.take(box.agents, "a");
  assert.ok(idle.ok && held.ok && theirs.ok);
  copies.release(idle.copy.id);
  copies.release(theirs.copy.id);
  at += 50;
  assert.equal(await copies.sweep(), 0, "idle less than its time");
  at += 100;
  assert.equal(await copies.sweep(), 2);
  assert.deepEqual(copies.list().map((c) => c.id), [held.copy.id]);
  assert.deepEqual(heard.map((h) => [h.machine, h.why]).sort(), [[pc.full, "idle"], [box.full, "idle"]].sort());
  assert.equal(existsSync(idle.copy.folder), false);

  heard.length = 0;
  const remint = devices.mintAgents(pc.full, { from: "DESKTOP-1" });
  assert.ok(remint.ok);
  const keys = [folderKeyOf(held.copy.folder), folderKeyOf(join(root, "From DESKTOP-1"))];
  assert.deepEqual(await copies.clear(remint.device.id), { cleared: 1, bytes: 0, failed: [] });
  assert.equal(existsSync(join(root, "From DESKTOP-1")), false, "its folder went with them");
  assert.equal(existsSync(root), true, "the copies folder stays");
  assert.equal(heard.length, 1);
  assert.deepEqual({ ...heard[0], devices: [...heard[0].devices].sort() }, { machine: pc.full, devices: [pc.agents, remint.device.id].sort(), folders: [held.copy.folder, join(root, "From DESKTOP-1")], keys, chats: [], why: "cleared" }, "the device a second mint replaced is told too: its chats there are its own");
  assert.equal(copies.folderOf(remint.device.id), "", "nothing of theirs is opened after a Clear");
  assert.deepEqual(await copies.clear(pc.full), { cleared: 0, bytes: 0, failed: [] }, "a full device has none");
});

// (fails before: yes — the folders were removed before what worked in them was told, and a removal that failed was
// forgotten, its name given again to the machine's next folder)
test("a let-go: what works in a copy is told and waited for while its folder is still there, then the folder goes; one that cannot be removed is said, kept, never handed out again, and removed at the next sweep", async (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, machineOf } = paired(data);
  const pc = machineOf("DESKTOP-1", "11111111-1111-4111-8111-111111111111");
  /** A file held open in it: it, and what holds it, cannot be removed. */
  let held = "";
  /** @type {string[]} */
  const tried = [];
  const copies = createCopies({
    dataDir: data,
    root,
    devices,
    removeFolder: async (f) => {
      tried.push(f);
      if (held && (held === f || held.startsWith(`${f}${sep}`))) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      rmSync(f, { recursive: true, force: true });
    },
  });
  /** @type {string[]} */
  const seen = [];
  copies.onCleared(async (c) => {
    await new Promise((r) => setTimeout(r, 30));
    for (const f of c.folders) seen.push(`${existsSync(f)}`);
  });
  const one = copies.take(pc.agents, "p");
  assert.ok(one.ok);
  held = one.copy.folder;
  const mine = join(root, "From DESKTOP-1");
  const out = await copies.clear(pc.agents);
  assert.deepEqual(seen, ["true", "true"], "told while the folders were still there, and waited for");
  assert.deepEqual(out, { cleared: 1, bytes: 0, failed: [one.copy.folder, mine] });
  assert.equal(existsSync(one.copy.folder), true, "held open: it stays");
  assert.match(readFileSync(join(data, "copies.json"), "utf8"), /"leftovers": \[/);

  // The machine's next folder is never the one a removal left.
  const next = copies.take(pc.agents, "p");
  assert.ok(next.ok);
  assert.equal(next.copy.folder, join(root, "From DESKTOP-1 (11111111)", "p", "1"));

  held = "";
  tried.length = 0;
  await copies.sweep();
  assert.deepEqual(tried, [one.copy.folder, mine], "the sweep removes what was left");
  assert.equal(existsSync(mine), false);
  const read = createCopies({ dataDir: data, root, devices });
  tried.length = 0;
  await read.sweep();
  assert.deepEqual(tried, [], "nothing is left to remove");
});

// (fails before: yes — the review of cp-fix: a let-go was kept nowhere until its removal failed, so a Filament stopped
// in between left its folders on disk for good, its chats untold; and a folder a let-go was about to remove was given
// to a new copy, which the removal then took)
test("a let-go is kept from its start: a Filament stopped before its folders went tells and removes them at its next sweep; while it goes, its folders are given to no new copy", async (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, machineOf } = paired(data);
  const pc = machineOf("DESKTOP-1", "11111111-1111-4111-8111-111111111111");
  const mine = join(root, "From DESKTOP-1");
  // What works in it never ends its stop: Filament stops in the middle of the Clear.
  const first = createCopies({ dataDir: data, root, devices });
  first.onCleared(() => new Promise(() => {}));
  const a = first.take(pc.agents, "p");
  assert.ok(a.ok);
  void first.clear(pc.agents);
  assert.deepEqual(first.gone(), [a.copy.folder, mine], "named as going from its start");
  assert.equal(first.usage(pc.agents), null);
  assert.match(String(agentFolderRefusal(a.copy.folder, { dataDir: data, folders: [a.copy.folder], ...first.fenceOf(pc.agents) })), /a copy let go/, "the fence lets none of theirs in");

  const next = createCopies({ dataDir: data, root, devices });
  /** @type {any[]} */
  const heard = [];
  next.onCleared((c) => void heard.push(c));
  await next.sweep();
  assert.deepEqual(heard.map((h) => [h.folders, h.devices, h.why]), [[[a.copy.folder, mine], [pc.agents], "again"]], "its chats told at the next start");
  assert.equal(existsSync(mine), false);
  assert.deepEqual(next.gone(), []);

  // A copy's folder removed by hand while its let-go is under way: the next copy of its project is given another.
  const data2 = folder(t, "data2");
  const root2 = join(folder(t, "root2"), COPIES);
  const two = paired(data2);
  const box = two.machineOf("Build box", "33333333-3333-4333-8333-333333333333");
  const copies = createCopies({ dataDir: data2, root: root2, devices: two.devices, maxCopies: 1 });
  /** @type {() => void} */
  let stopped = () => {};
  copies.onCleared(() => new Promise((r) => (stopped = () => r(undefined))));
  const one = copies.take(box.agents, "p");
  assert.ok(one.ok);
  copies.release(one.copy.id);
  rmSync(one.copy.folder, { recursive: true, force: true });
  const again = copies.take(box.agents, "p", { fresh: true });
  assert.ok(again.ok);
  assert.equal(again.copy.folder, join(root2, "From Build box", "p", "2"));
  stopped();
  await copies.settled();
  assert.equal(existsSync(again.copy.folder), true, "the new copy's folder stays");
});

// (fails before: yes — the review of cp-fix: any error reading the list set it aside, and the copies it named were
// forgotten; a machine's folder outside a changed copies folder was still given out, and never removed)
test("a copies.json that cannot be read for another reason than its words is left as it is: nothing written over it, no copy made, until a sweep reads it; a machine's folder outside the copies folder now is let go of", async (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, machineOf } = paired(data);
  const pc = machineOf("DESKTOP-1", "11111111-1111-4111-8111-111111111111");
  mkdirSync(join(data, "copies.json"));
  /** @type {string[]} */
  const said = [];
  const copies = createCopies({ dataDir: data, root, devices, log: (_, line) => void said.push(line) });
  const no = copies.take(pc.agents, "p");
  assert.equal(no.ok, false);
  assert.match(no.ok ? "" : no.why, /the copies' list could not be read/);
  assert.equal(readdirSync(data).some((n) => n.startsWith("copies.json.unreadable")), false, "not set aside");
  rmSync(join(data, "copies.json"), { recursive: true });
  await copies.sweep();
  const yes = copies.take(pc.agents, "p");
  assert.ok(yes.ok, "read again at the sweep");

  // FILAMENT_COPIES_DIR changed: the machine's old folder is no longer its.
  const elsewhere = join(folder(t, "moved"), COPIES);
  const moved = createCopies({ dataDir: data, root: elsewhere, devices, log: (_, line) => void said.push(line) });
  assert.deepEqual(moved.list(), []);
  assert.equal(moved.folderOf(pc.agents), "");
  const there = moved.take(pc.agents, "p");
  assert.ok(there.ok);
  assert.equal(there.copy.folder, join(elsewhere, "From DESKTOP-1", "p", "1"));
  assert.match(said.join("\n"), /not in .*: left on disk/);
});

// (fails before: yes — an unreadable list was written over at the next save, and its machines' folders named again)
test("an unreadable copies.json is set aside, never written over, and the folders it named are not handed out again; a copies folder in or around the data folder makes no copy", (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, machineOf } = paired(data);
  const pc = machineOf("DESKTOP-1", "11111111-1111-4111-8111-111111111111");
  mkdirSync(join(root, "From DESKTOP-1", "p", "1"), { recursive: true });
  writeFileSync(join(data, "copies.json"), "{ not json");
  /** @type {string[]} */
  const said = [];
  const copies = createCopies({ dataDir: data, root, devices, now: () => 42, log: (_, line) => said.push(line) });
  assert.equal(readFileSync(join(data, "copies.json.unreadable-42"), "utf8"), "{ not json");
  assert.match(said.join("\n"), /set aside as .*copies\.json\.unreadable-42/);
  const taken = copies.take(pc.agents, "p");
  assert.ok(taken.ok);
  assert.equal(taken.copy.folder, join(root, "From DESKTOP-1 (11111111)", "p", "1"));

  const inData = createCopies({ dataDir: data, root: join(data, "copies"), devices });
  const no = inData.take(pc.agents, "p");
  assert.equal(no.ok, false);
  assert.match(no.ok ? "" : no.why, /is in Filament's data folder/);
  const around = createCopies({ dataDir: data, root: join(data, ".."), devices }).take(pc.agents, "p");
  assert.equal(around.ok, false);
  assert.match(around.ok ? "" : around.why, /is around Filament's data folder/);
});

// (fails before: yes — agentFolderRefusal took no copies folder: a copy of theirs was in none of the person's folders)
test("the fence: a machine's agents work in their own copies folder without Full control, whatever roots are listed; never in another machine's, a credentials folder in theirs, or through a copies folder that is itself closed", (t) => {
  const base = folder(t, "fence");
  const data = join(base, "data");
  const home = join(base, "home");
  const mine = join(home, COPIES, "From DESKTOP-1");
  const other = join(home, COPIES, "From Build box");
  for (const f of [data, join(mine, "web-shop", "1", ".ssh"), join(other, "x", "1")]) mkdirSync(f, { recursive: true });
  const o = { dataDir: data, home, folders: [], copies: mine, copiesRoot: join(home, COPIES) };
  assert.equal(agentFolderRefusal(join(mine, "web-shop", "1"), o), null);
  assert.equal(agentFolderRefusal(join(mine, "web-shop", "1"), { ...o, roots: [join(base, "elsewhere")] }), null, "listed roots do not hold Filament's copies");
  assert.match(String(agentFolderRefusal(join(other, "x", "1"), o)), /in their own machine's copies alone/);
  assert.match(String(agentFolderRefusal(join(mine, "web-shop", "1", ".ssh"), o)), /a credentials folder \(\.ssh\)/);
  assert.match(String(agentFolderRefusal(join(mine, "web-shop", "1"), { ...o, copies: "" })), /in their own machine's copies alone/, "without their copies folder, a copy is none of theirs");
  assert.match(String(agentFolderRefusal(join(home, "projects"), { ...o, copies: home })), /in none of them|a home folder/, "a copies folder that is a home folder opens nothing");
  assert.match(String(agentFolderRefusal(join(data, "Everything"), { ...o, copies: data })), /never start a chat in Filament's data folder/);
});

// (fails before: yes — a copy let go kept its folder in a chat's row, which counted it among the person's folders: the
// next machine given that path, or any other's agents, started a chat in it)
test("the fence keeps the copies folder whole: nothing in it but their own machine's folder, whatever lists it — a chat's row, agentLoop.roots —, never the copies folder itself or what holds it", (t) => {
  const base = folder(t, "fence-root");
  const data = join(base, "data");
  const home = join(base, "home");
  const root = join(base, "work", "copies");
  const a = join(root, "From DESKTOP-1");
  const b = join(root, "From Build box");
  for (const f of [data, home, join(a, "p", "1"), join(b, "p", "1")]) mkdirSync(f, { recursive: true });
  const listed = [join(a, "p", "1"), join(base, "work")];
  const o = { dataDir: data, home, folders: listed, copies: b, copiesRoot: root };
  assert.equal(agentFolderRefusal(join(b, "p", "1"), o), null, "their own");
  assert.match(String(agentFolderRefusal(join(a, "p", "1"), o)), /in their own machine's copies alone; .* is in Filament's copies folder/, "A's copy, though a chat's row names it");
  assert.match(String(agentFolderRefusal(join(a, "p", "1"), { ...o, folders: [], roots: [base] })), /copies alone/, "A's copy, though a listed root holds it");
  assert.match(String(agentFolderRefusal(root, o)), /copies alone/, "the copies folder itself");
  assert.match(String(agentFolderRefusal(join(base, "work"), o)), /is around Filament's copies folder/, "a project that holds the copies folder");
  assert.match(String(agentFolderRefusal(join(a, "p", "1"), { ...o, copies: root })), /copies alone/, "a machine's folder that is the copies folder opens none of it");
  assert.equal(agentFolderRefusal(join(a, "p", "1"), { ...o, full: true }), null, "Full control runs as the person");
  assert.match(String(agentFolderRefusal(join(b, "p", "1"), { ...o, copiesGone: [join(b, "p", "1")] })), /a copy let go/, "their own copy, let go");

  // A file read in a chat of theirs (index.js): the copies folder the same way.
  const read = { copies: b, copiesRoot: root, doing: "read" };
  assert.equal(copiesRefusal(join(b, "p", "1"), read), "");
  assert.equal(copiesRefusal(join(base, "elsewhere"), read), "", "outside the copies folder: their chats' folders judge it");
  assert.match(copiesRefusal(join(a, "p", "1"), read), /read in their own machine's copies alone/);
  assert.match(copiesRefusal(join(b, "p", "1"), { ...read, copiesGone: [join(b, "p")] }), /a copy let go/);
});

// (fails before: yes — with agentLoop.roots listed, a copy was outside every root)
test("the folder rules: with roots listed, Filament's copies folder is one more root; FILAMENT_COPIES_DIR names it, else ~/Filament copies", (t) => {
  const base = folder(t, "roots");
  const copy = join(base, "copies", "From DESKTOP-1", "p", "1");
  mkdirSync(copy, { recursive: true });
  const was = process.env.FILAMENT_COPIES_DIR;
  t.after(() => {
    if (was === undefined) delete process.env.FILAMENT_COPIES_DIR;
    else process.env.FILAMENT_COPIES_DIR = was;
  });
  const cfg = { agentLoop: { roots: [join(base, "work")] } };
  delete process.env.FILAMENT_COPIES_DIR;
  assert.equal(folderVerdict(cfg, copy).why, "outside");
  process.env.FILAMENT_COPIES_DIR = join(base, "copies");
  assert.deepEqual([folderVerdict(cfg, copy).ok, folderVerdict(cfg, copy).why], [true, null]);
  assert.equal(newFolderRefusal(cfg, join(copy, "..", "2"), { from: copy }), null, "a folder made in the copies folder (a worktree of a copy's) is under a root too");
  assert.equal(copiesRootOf({ FILAMENT_COPIES_DIR: " " }, base), join(base, COPIES));
  assert.equal(copiesRootOf({ FILAMENT_COPIES_DIR: join(base, "c") }, homedir()), join(base, "c"));
  assert.equal(copiesRootOf({}, homedir()), join(homedir(), COPIES));
});

// (fails before: yes — the security re-read of 11-11: where roots are listed, Filament's copies folder was one more root
// for every chat, the person's own among them: one was judged workable there, added it for reading, and had a folder
// made in it from a folder of the person's)
test("the folder rules: Filament's copies folder is a root for what another machine's agents' chats do alone — never for a chat of this machine's person, a folder it adds, or a folder made from one of the person's", (t) => {
  const base = folder(t, "roots-person");
  const copy = join(base, "copies", "From DESKTOP-1", "p", "1");
  const work = join(base, "work", "mine");
  for (const f of [copy, work]) mkdirSync(f, { recursive: true });
  const was = process.env.FILAMENT_COPIES_DIR;
  t.after(() => {
    if (was === undefined) delete process.env.FILAMENT_COPIES_DIR;
    else process.env.FILAMENT_COPIES_DIR = was;
  });
  process.env.FILAMENT_COPIES_DIR = join(base, "copies");
  const cfg = { agentLoop: { roots: [join(base, "work")] } };
  assert.equal(folderVerdict(cfg, copy, { person: true }).why, "outside", "a chat of the person's is not judged under the copies folder");
  assert.equal(folderVerdict(cfg, work, { person: true }).ok, true);
  assert.equal(folderVerdict(cfg, copy).ok, true, "another machine's agents' chat's folder is");
  const added = addedFoldersOf(cfg, [copy, work], { person: true });
  assert.deepEqual([added.folders.length, added.left], [1, [`${copy} (it is not under any folder agentLoop.roots lists)`]], "nor a folder the person's chat adds");
  assert.equal(addedFoldersOf(cfg, [copy, work]).folders.length, 2);
  // A folder made in the copies folder is under a root where it is made from a copy, and from nothing else.
  for (const from of [work, "", undefined]) assert.equal(newFolderRefusal(cfg, join(copy, "..", "2"), from === undefined ? undefined : { from }), `${join(copy, "..", "2")} would not be under any folder listed in agentLoop.roots`, String(from));
  assert.equal(newFolderRefusal(cfg, join(work, "..", "theirs"), { from: copy }), null, "under a listed root, whatever it is made from");
  // With no roots listed, any folder is the person's to pick, as before.
  assert.equal(folderVerdict({ agentLoop: { roots: [] }, server: { host: "127.0.0.1" } }, copy, { person: true }).ok, true);
});

// (fails before: yes — FILAMENT_COPIES_DIR was taken as written, a home folder or a drive's root too, which a Clear empties)
test("FILAMENT_COPIES_DIR never names a drive's root, a home folder, what holds one or one beside it: ~/Filament copies stands in", (t) => {
  const home = join(folder(t, "home-of"), "me");
  mkdirSync(home, { recursive: true });
  const own = join(home, COPIES);
  for (const set of [home, dirname(home), join(dirname(home), "someone"), parse(home).root]) assert.equal(copiesRootOf({ FILAMENT_COPIES_DIR: set }, home), own, set);
  assert.equal(copiesRootOf({ FILAMENT_COPIES_DIR: join(home, "copies") }, home), join(home, "copies"), "a folder in the home folder is one");
});

// (fails before: yes — there was no folderName)
test("a project's or a machine's name as a folder's on every system", () => {
  assert.equal(folderName("web-shop"), "web-shop");
  assert.equal(folderName("a/b\\c:d*e?"), "a-b-c-d-e-");
  assert.equal(folderName("trailing. "), "trailing");
  assert.equal(folderName("CON"), "CON-");
  assert.equal(folderName("   "), "");
  assert.equal(folderName("x".repeat(80)).length, 60);
  assert.equal(folderName("SSH~1"), "SSH-1", "no short name's `~`, which the fence refuses");
});

// (fails before: yes — the swarm's review of 11-10: a copy held for a turn or a launch's checkout kept its six hours'
// hold across a restart, which ended that work: held for nothing)
test("after a restart, a copy held for work the restart ended is its chat's a while alone; one a paused question holds keeps its hold", (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, machineOf } = paired(data);
  const pc = machineOf("DESKTOP-1", "11111111-1111-4111-8111-111111111111");
  let at = 1_000;
  const copies = createCopies({ dataDir: data, root, devices, now: () => at });
  const turned = copies.take(pc.agents, "web-shop");
  const asked = copies.take(pc.agents, "web-shop");
  const taken = copies.take(pc.agents, "web-shop");
  assert.ok(turned.ok && asked.ok && taken.ok);
  assert.ok(copies.bind(turned.copy.id, "chat-a") && copies.bind(asked.copy.id, "chat-b"));
  assert.equal(copies.lease(turned.copy.id, "chat-a"), "");
  assert.equal(copies.lease(asked.copy.id, "chat-b"), "");
  assert.ok(copies.grace(asked.copy.id, at + 3 * 3600_000), "paused on a question for three hours");
  at += 60_000;
  const again = createCopies({ dataDir: data, root, devices, now: () => at });
  assert.equal(again.get(turned.copy.id)?.busyUntil, at + GRACE_MS, "its turn ended with the restart");
  assert.equal(again.get(taken.copy.id)?.busyUntil, at + GRACE_MS, "its launch's checkout too");
  assert.equal(again.get(asked.copy.id)?.busyUntil, 1_000 + 3 * 3600_000 + GRACE_MS, "its question still waits");
});
