// @ts-check
// Run on's host side (the remote desk's s2a): a copy placed for the person's own chat (POST /transfers/place
// `for: "person"`) is never taken again by a launch nor let go for room, and goes a week after its chat last used it;
// the chat their machine's app starts there as its full device is bound to it, works there whatever agentLoop.roots
// lists, and is read back as a launch's; their agents start none there; the grant Copies lets that machine do this
// alone, Agents off; a Clear deletes the person's chats there too, and Settings names them first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleSnapshot, captureCopy, checkoutCopy, importBundle, mirrorHas, mirrorHaves } from "../src/adapters/git/send.js";
import { createTransfers } from "../src/services/transfers.js";
import { createDevices } from "../src/services/devices.js";
import { COPIES, IDLE_MS, createCopies } from "../src/services/copies.js";
import { AGENT_TAKES, COPY_ROUTES, DESK, agentFolderRefusal, agentRefusal, copiesRefusal } from "../src/http/admin/remote.js";
import { endsWithDevice } from "../src/http/guards.js";
import { folderVerdict } from "../src/app/agent/turn.js";
import { startTwoMachines } from "./helpers/two-machines.js";
import { anthropicReply, fakeUpstream } from "./helpers/app.js";
import { pinnedFetch } from "../src/cli/pinned.js";

const JSON_TYPE = { "content-type": "application/json" };
const HOUR = 3600_000;

/** @param {import("node:test").TestContext} t @param {string} name */
const folder = (t, name) => {
  const d = mkdtempSync(join(tmpdir(), `filament-person-copy-${name}-`));
  t.after(() => rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return d;
};
/** @param {string} cwd @param {...string} args */
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
/** A small project: one commit, one file changed after it. @param {string} dir */
const project = (dir) => {
  mkdirSync(join(dir, "src"), { recursive: true });
  gitIn(dir, "init", "-q");
  writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "first");
  writeFileSync(join(dir, "src", "b.js"), "export const b = 2;\n");
  return dir;
};
/** Two machines' apps paired here, each a full device and the agents' device it minted. @param {string} dataDir */
const paired = (dataDir) => {
  const devices = createDevices({ dataDir });
  /** @param {string} name @param {string} machine */
  const of = (name, machine) => {
    const full = devices.claim(devices.startPairing({ scope: "full" }).code, { name: `Filament app on ${name}`, machine });
    assert.ok(full.ok);
    const agents = devices.mintAgents(full.device.id, { from: name });
    assert.ok(agents.ok);
    return { full: full.device.id, agents: agents.device.id };
  };
  return { devices, laptop: of("Laptop", "66666666-6666-4666-8666-666666666666"), studio: of("Studio", "77777777-7777-4777-8777-777777777777") };
};

// (fails before: yes — a copy was a launch's lease alone: placed for no one's own chat, it went idle 15 minutes after
// its checkout and 30 after a turn, and the next launch of its project took it and checked out over it)
test("a copy placed for the person: kept past 2 h idle and a new launch, never let go for room, its chat's to read back; Agents off, the person's alone; gone a week after its chat last used it, the chat with it", async (t) => {
  const dir = project(folder(t, "repo"));
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, laptop, studio } = paired(data);
  let at = Date.now();
  const copies = createCopies({ dataDir: data, root, devices, now: () => at });
  /** @type {import("../src/services/copies.js").Cleared[]} */
  const heard = [];
  copies.onCleared((c) => void heard.push(c));
  const s = createTransfers({ copies, take: importBundle, haves: mirrorHaves, has: mirrorHas, checkout: checkoutCopy, capture: captureCopy });
  const b = await bundleSnapshot(dir, { machine: "m", project: "widgets", haves: [] });
  assert.ok(b.ok && b.file);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  const device = laptop.agents;
  const opened = await s.open(device, { project: "widgets", bytes: b.bytes, sha256: b.sha256 });
  assert.ok("id" in opened);
  await s.part(device, opened.id, { offset: 0, data: readFileSync(String(b.file)).toString("base64") });
  assert.deepEqual(await s.commit(device, opened.id), { commit: b.commit, project: "widgets" });

  assert.deepEqual(await s.place(device, { project: "widgets", commit: b.commit, for: "agents" }), { status: 400, error: 'for is "person", a copy for your own chat, or none' });
  // Agents off (the grant Copies alone): a launch's copy is refused, the person's placed.
  assert.deepEqual(await s.place(device, { project: "widgets", commit: b.commit }, { agents: false }), { status: 403, error: "this machine lets that machine's agents send copies for your own chats alone: Agents is off in Settings › Remote access" });
  const mine = await s.place(device, { project: "widgets", commit: b.commit, for: "person" }, { agents: false });
  assert.ok("copy" in mine, JSON.stringify(mine));
  assert.equal(mine.owned, true);
  assert.equal(mine.folder, join(root, "From Laptop", "widgets", "1"));
  assert.equal(readFileSync(join(mine.folder, "src", "b.js"), "utf8").replace(/\r\n/g, "\n"), "export const b = 2;\n");

  // The full device that minted that machine's agents' device finds it; no other device does.
  assert.equal(copies.ownedAt(laptop.full, join(mine.folder, "src"))?.id, mine.copy);
  assert.equal(copies.ownedAt(laptop.agents, mine.folder), null, "an agents' device starts no chat of the person's");
  assert.equal(copies.ownedAt(studio.full, mine.folder), null, "another machine's app: none of its");
  assert.equal(copies.copyAt(studio.agents, mine.folder), null, "another machine's agents: none of theirs");

  // Its chat bound, a turn run and ended.
  assert.equal(copies.bind(mine.copy, "chat-p"), true);
  assert.equal(copies.lease(mine.copy, "chat-p"), "");
  copies.grace(mine.copy);
  assert.deepEqual(copies.usage(device)?.chats, ["chat-p"]);

  // Two hours idle, then a launch of the same project: a copy of its own, the person's untouched.
  at += 2 * HOUR;
  const launch = await s.place(device, { project: "widgets", commit: b.commit });
  assert.ok("copy" in launch, JSON.stringify(launch));
  assert.notEqual(launch.copy, mine.copy);
  assert.equal(launch.owned, undefined);
  assert.equal(copies.get(mine.copy)?.chat, "chat-p", "still the person's chat's");
  assert.equal(copies.idle(device, "widgets"), null, "the person's copy is no launch's to take again");

  // What its chat changed is read back, Agents on or off; a launch's copy is not, with Agents off.
  writeFileSync(join(mine.folder, "src", "a.js"), "export const a = 3;\n");
  const back = await s.back(device, { copy: mine.copy, chat: "chat-p" }, { agents: false });
  assert.ok(!("status" in back), JSON.stringify(back));
  assert.equal(back.unchanged, false);
  assert.ok(back.files >= 1, JSON.stringify(back));
  assert.deepEqual(await s.back(device, { copy: mine.copy, chat: "another" }), { status: 409, error: "that copy here is another chat's" });
  assert.deepEqual(await s.back(device, { copy: launch.copy, chat: "x" }, { agents: false }), { status: 403, error: "this machine lets that machine's agents read back copies of your own chats alone: Agents is off in Settings › Remote access" });
  // A turn running in it: read once it ends.
  assert.equal(copies.lease(mine.copy, "chat-p"), "");
  assert.equal((/** @type {any} */ (await s.back(device, { copy: mine.copy, chat: "chat-p" }))).status, 409);
  copies.grace(mine.copy);

  // A week after its chat last used it, it goes, and the person's chat with it.
  at += IDLE_MS + HOUR;
  assert.equal(await copies.sweep(), 2);
  await copies.settled();
  assert.equal(copies.get(mine.copy), null);
  assert.equal(existsSync(mine.folder), false);
  assert.deepEqual(heard.flatMap((c) => c.chats), ["chat-p"]);
});

// (fails before: yes — the review of s2a: copies were the full device's that minted their agents' device, so the app
// paired again — after a revoke, a pairing that lapsed unused, a new key — found none: Bring back, a new chat's binding
// and Clear failed there, and the week's sweep took the person's chats in them)
test("the app paired again takes its machine's copies and the person's chats in them; never from a pairing that stands", async (t) => {
  const dir = project(folder(t, "repo"));
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  let at = Date.now();
  const devices = createDevices({ dataDir: data, now: () => at });
  const LAPTOP = "66666666-6666-4666-8666-666666666666";
  /** An app's pairing, its claim stating `machine` (none: a claim that stated none). @param {string} [machine] @param {string} [name] */
  const app = (machine, name = "Laptop") => {
    const full = devices.claim(devices.startPairing({ scope: "full" }).code, { name: `Filament app on ${name}`, ...(machine ? { machine } : {}) });
    assert.ok(full.ok);
    return full.device.id;
  };
  /** @param {string} full */
  const mint = (full) => {
    const a = devices.mintAgents(full, { from: "Laptop" });
    assert.ok(a.ok);
    return a.device.id;
  };
  const copies = createCopies({ dataDir: data, root, devices, now: () => at });
  const s = createTransfers({ copies, take: importBundle, haves: mirrorHaves, has: mirrorHas, checkout: checkoutCopy, capture: captureCopy });
  const b = await bundleSnapshot(dir, { machine: "m", project: "widgets", haves: [] });
  assert.ok(b.ok && b.file);
  t.after(() => b.ok && b.dir && rmSync(b.dir, { recursive: true, force: true }));
  const f1 = app(LAPTOP);
  const a1 = mint(f1);
  const opened = await s.open(a1, { project: "widgets", bytes: b.bytes, sha256: b.sha256 });
  assert.ok("id" in opened);
  await s.part(a1, opened.id, { offset: 0, data: readFileSync(String(b.file)).toString("base64") });
  assert.deepEqual(await s.commit(a1, opened.id), { commit: b.commit, project: "widgets" });
  const mine = await s.place(a1, { project: "widgets", commit: b.commit, for: "person" });
  assert.ok("copy" in mine, JSON.stringify(mine));
  assert.equal(copies.bind(mine.copy, "chat-p"), true);
  writeFileSync(join(mine.folder, "src", "a.js"), "export const a = 3;\n");

  // Another app whose claim states that machine's id while its pairing stands takes nothing (the security re-read of 11-11).
  const other = app(LAPTOP, "Elsewhere");
  mint(other);
  assert.equal(copies.repaired(other), 0);
  assert.equal(copies.ownedAt(other, mine.folder), null);
  devices.revoke(other);

  // Revoked, then paired again from that machine: the new app takes them as it runs its machine's agents.
  devices.revoke(f1);
  assert.equal(copies.ownedAt(f1, mine.folder), null, "a revoked app starts nothing");
  const f2 = app(LAPTOP);
  const a2 = mint(f2);
  assert.equal(copies.repaired(f2), 1);
  assert.equal(copies.repaired(f2), 0, "once");
  assert.equal(copies.ownedAt(f2, join(mine.folder, "src"))?.id, mine.copy, "a new chat there binds");
  assert.equal(copies.folderOf(a2), join(root, "From Laptop"));
  const back = await s.back(a2, { copy: mine.copy, chat: "chat-p" }, { agents: false });
  assert.ok(!("status" in back), JSON.stringify(back));
  assert.ok(back.files >= 1, JSON.stringify(back));
  assert.deepEqual(copies.usage(a2)?.chats, ["chat-p"], "Clear names the person's chat there");
  assert.equal(copies.usage(a1), null, "the old pairing's agents keep none");
  assert.equal(createCopies({ dataDir: data, root, devices: { get: devices.get, list: devices.list }, now: () => at }).ownedAt(f2, mine.folder)?.id, mine.copy, "kept");

  // Paired again while the old pairing stands (a window that lost its sign-in): nothing goes until that one is revoked,
  // then its copies go to the app that runs the machine's agents.
  const f3 = app(LAPTOP);
  mint(f3);
  assert.equal(copies.repaired(f3), 0);
  devices.revoke(f2);
  assert.equal(copies.ownedAt(f3, mine.folder)?.id, mine.copy);

  // Lapsed unused: taken by the token of it the claim carried (`from`, the claim route's) alone — its agents' device
  // still works, and a claim states its machine as it likes.
  at += 91 * 24 * HOUR;
  const f4 = app(LAPTOP);
  mint(f4);
  assert.equal(copies.repaired(f4), 0);
  assert.equal(copies.repaired(f4, { from: f3 }), 1);
  assert.equal(copies.ownedAt(f4, mine.folder)?.id, mine.copy);

  // A pairing whose claim stated no machine goes by `from` alone too, once that one is let go.
  const bare = app();
  assert.equal(copies.repaired(bare), 0);
  assert.equal(copies.repaired(bare, { from: f4 }), 0, "it stands");
  devices.revoke(f4);
  assert.equal(copies.repaired(bare, { from: f4 }), 1);
  assert.equal(copies.ownedAt(bare, mine.folder)?.id, mine.copy);

  // (fails before: yes — the review of x17: Forget left the copies no one's) Revoked and forgotten, then paired again:
  // the machine their record keeps takes them to the app paired again.
  devices.revoke(bare);
  assert.ok(devices.forget(bare));
  const f5 = app(LAPTOP);
  mint(f5);
  assert.equal(copies.repaired(f5), 1);
  assert.equal(copies.ownedAt(f5, mine.folder)?.id, mine.copy);
  assert.equal(copies.get(mine.copy)?.chat, "chat-p");
});

// (fails before: yes — the review of s2a: a copy held one chat, so a fork, a thread or a replay of the person's chat in it
// was bound to nothing, two turns in it at once left it unheld when the first ended, and a chat moved out went with a Clear)
test("chats made from the person's chat in its copy: bound beside it, each turn holds it, a Clear takes them all; one moved out leaves it, back is its again", async (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, laptop } = paired(data);
  const copies = createCopies({ dataDir: data, root, devices });
  const taken = copies.take(laptop.agents, "widgets", { owned: true, fresh: true });
  assert.ok(taken.ok);
  const c = taken.copy;
  assert.equal(copies.bind(c.id, "chat-p"), true);
  assert.equal(copies.adopt(c.id, "fork-1", "nobody", c.folder), false, "made from no chat of its");
  assert.equal(copies.adopt(c.id, "fork-1", "chat-p", join(tmpdir(), "elsewhere")), false, "a folder out of it: its own worktree");
  assert.equal(copies.adopt(c.id, "fork-1", "chat-p", join(c.folder, "src")), true);
  assert.equal(copies.ownFolder(c.id, "fork-1"), c.folder, "it works there whatever agentLoop.roots lists");
  assert.equal(copies.ownFolder(c.id, "stranger"), "");
  // Two turns at once: the one that ends first leaves the copy held, and half written, for the other.
  assert.equal(copies.lease(c.id, "chat-p"), "");
  assert.equal(copies.lease(c.id, "fork-1"), "");
  copies.grace(c.id, 0, "chat-p");
  assert.equal(copies.get(c.id)?.turn, true, "the fork's turn still runs there");
  copies.grace(c.id, 0, "fork-1");
  assert.equal(copies.get(c.id)?.turn, false);
  assert.equal(copies.lease(c.id, "stranger", true), "its copy here went to another chat started there: Run on sends a fresh one with your next new chat there");
  // Its chat moved out leaves it, the fork its chat now; moved back in, it is the copy's again.
  assert.equal(copies.leave(c.id, "chat-p"), true);
  assert.equal(copies.get(c.id)?.chat, "fork-1");
  assert.equal(copies.ownFolder(c.id, "chat-p"), "");
  assert.equal(copies.rejoin(c.id, "chat-p", join(tmpdir(), "elsewhere")), false);
  assert.equal(copies.rejoin(c.id, "chat-p", c.folder), true);
  assert.deepEqual(copies.get(c.id)?.also, ["chat-p"]);
  // Kept across a restart; a Clear takes every one of them.
  const again = createCopies({ dataDir: data, root, devices });
  assert.deepEqual(again.usage(laptop.agents)?.chats, ["fork-1", "chat-p"]);
  /** @type {import("../src/services/copies.js").Cleared[]} */
  const heard = [];
  again.onCleared((x) => void heard.push(x));
  await again.clear(laptop.agents);
  assert.deepEqual(heard.flatMap((x) => x.chats), ["fork-1", "chat-p"]);
});

// (fails before: yes — an idle copy of any kind went for room, the person's chat's among them; then, the review of s2a:
// one whose chat never came, or was deleted, held its place for a week, and their agents ran commands in it)
test("room: the person's copy is never let go for it while its chat is there, and the words say so; one whose chat never came or was deleted is any idle copy; their agents are fenced out of it", async (t) => {
  const data = folder(t, "data");
  const root = join(folder(t, "root"), COPIES);
  const { devices, laptop } = paired(data);
  let at = Date.now();
  const copies = createCopies({ dataDir: data, root, devices, maxCopies: 1, now: () => at });
  /** @type {Set<string>} */
  const deleted = new Set();
  copies.setChatThere((chat) => !deleted.has(chat));
  const own = copies.take(laptop.agents, "widgets", { owned: true, fresh: true });
  assert.ok(own.ok);
  assert.equal(copies.bind(own.copy.id, "chat-p"), true);
  copies.release(own.copy.id);
  const next = copies.take(laptop.agents, "widgets");
  assert.deepEqual(next, { ok: false, why: "Laptop has 1 copies on this machine, 1 of them your own chats', the most it keeps: no more is made until one goes, or they are cleared in Settings › Remote access" });
  assert.equal(copies.get(own.copy.id)?.owned, true);
  // Kept: read back as the person's.
  assert.equal(createCopies({ dataDir: data, root, devices }).get(own.copy.id)?.owned, true);

  // Their agents, their own machine's too, start, run and read nothing in it.
  const fence = copies.fenceOf(laptop.agents);
  assert.match(copiesRefusal(join(own.copy.folder, "src"), { ...fence, doing: "run a command" }), /never run a command in a copy placed for a chat of the person's own/);
  assert.equal(agentFolderRefusal(own.copy.folder, { dataDir: data, roots: [], ...fence }), `another machine's agents never start a chat in a copy placed for a chat of the person's own; ${own.copy.folder} is in one`);

  // Its chat deleted: a chat started there next is bound to it, and with none, it is an idle copy as any.
  deleted.add("chat-p");
  assert.equal(copies.bind(own.copy.id, "chat-q"), true, "a deleted chat gives way");
  assert.equal(copies.get(own.copy.id)?.ran, false);
  deleted.add("chat-q");
  const taken = copies.take(laptop.agents, "widgets");
  assert.ok(taken.ok && taken.reused && taken.copy.id === own.copy.id, JSON.stringify(taken));
  assert.equal(taken.copy.owned, undefined, "a launch's now");

  // None came: the person's while its placement holds it, any launch's after.
  copies.release(taken.copy.id);
  const placed = copies.take(laptop.agents, "widgets", { owned: true, leaseMs: 15 * 60_000 });
  assert.ok(placed.ok && placed.copy.owned);
  copies.release(placed.copy.id);
  copies.hold(placed.copy.id, 15 * 60_000);
  at += 10 * 60_000;
  assert.equal(copies.take(laptop.agents, "widgets").ok, false, "held for the chat to start");
  at += 10 * 60_000;
  const late = copies.take(laptop.agents, "widgets");
  assert.ok(late.ok && late.reused && late.copy.owned === undefined, JSON.stringify(late));

  // Disowned (its checkout failed): an idle copy as any, taken again by the next launch.
  copies.release(late.copy.id);
  const failed = copies.take(laptop.agents, "widgets", { owned: true });
  assert.ok(failed.ok && failed.copy.owned);
  copies.release(failed.copy.id, { disown: true });
  const again = copies.take(laptop.agents, "widgets");
  assert.ok(again.ok && again.reused && again.copy.id === own.copy.id);
  assert.equal(again.copy.owned, undefined);
});

// (fails before: yes — the review of s2a: a request let in by Run on alone was cut as any grant of its device changed)
test("a request let in by Run on alone ends as Run on goes off, never as another grant changes", (t) => {
  const { devices, laptop } = paired(folder(t, "data"));
  assert.ok(devices.grant(laptop.agents, { copies: true }));
  const who = /** @type {any} */ ({ kind: "device", scope: "agent", device: devices.get(laptop.agents) });
  let ended = 0;
  const off = endsWithDevice(devices, who, () => void ended++);
  devices.grant(laptop.agents, { models: true });
  assert.equal(ended, 0, "Models switched: it goes on");
  devices.grant(laptop.agents, { copies: false });
  assert.equal(ended, 1, "Run on off: it ends");
  off();
  // Let in by Agents, it ends as Agents goes off, Run on or not.
  devices.grant(laptop.agents, { agents: true, copies: true });
  let ended2 = 0;
  const off2 = endsWithDevice(devices, /** @type {any} */ ({ kind: "device", scope: "agent", device: devices.get(laptop.agents) }), () => void ended2++);
  devices.grant(laptop.agents, { agents: false });
  assert.equal(ended2, 1);
  off2();
});

// (fails before: yes — there was no grant Copies: Run on needed Agents, which lets that machine's agents work here)
test("the grant Copies: the transfers' rows and what Filament is, nothing else; Agents reaches all of them; the person's copy is a root for its own chat alone", (t) => {
  const copiesOnly = { name: "Laptop", grants: { agents: false, copies: true } };
  for (const row of COPY_ROUTES) {
    const [method, pattern] = row.split(" ");
    assert.equal(agentRefusal(method, pattern, pattern, copiesOnly), null, row);
  }
  for (const row of ["POST /sessions", "POST /exec", "GET /models", "GET /files/read", "GET /clones"]) {
    const [method, pattern] = row.split(" ");
    assert.match(String(agentRefusal(method, pattern, pattern, copiesOnly)), /may not run agents here/, row);
  }
  assert.match(String(agentRefusal("POST", "/transfers/place", "/transfers/place", { name: "Laptop", grants: { agents: false, copies: false } })), /may not run agents here/);
  assert.equal(agentRefusal("POST", "/transfers/place", "/transfers/place", { name: "Laptop", grants: { agents: true, copies: false } }), null);
  assert.ok(AGENT_TAKES.includes("person-copy") && DESK.includes("person-copy"));

  const base = folder(t, "verdict");
  const work = join(base, "work");
  const copy = join(base, "copies", "From Laptop", "widgets", "1");
  const beside = join(base, "copies", "From Laptop", "widgets", "2");
  for (const f of [work, copy, beside]) mkdirSync(f, { recursive: true });
  const cfg = { agentLoop: { roots: [work] } };
  assert.equal(folderVerdict(cfg, copy, { person: true }).why, "outside", "a person's chat: no copy is a root for it");
  assert.equal(folderVerdict(cfg, copy, { person: true, copy }).ok, true, "but the one placed for it");
  assert.equal(folderVerdict(cfg, beside, { person: true, copy }).why, "outside", "that one alone");
  assert.equal(folderVerdict({ server: { host: "127.0.0.1" }, agentLoop: { roots: [] } }, beside, { person: true, copy }).ok, true, "with no roots listed, any folder all the same");
});

/**
 * Requests to `m` over the network, pinned, with `token` as their Bearer: as another machine's Filament sends them.
 * @param {import("./helpers/two-machines.js").Machine} m @param {string} token
 */
const as = (m, token) => {
  const pinned = pinnedFetch(m.lan.fingerprint);
  /** @param {string} path @param {{ method?: string, body?: unknown }} [o] @returns {Promise<Response>} */
  return (path, { method = "GET", body } = {}) =>
    pinned(`${m.far}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : JSON_TYPE) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
};

// (fails before: yes — only an agents' device's chat was bound to a copy, and with roots listed no chat of the person's
// was made in one)
test("between two Filaments: the app's full device starts its chat in the copy placed for it, roots listed elsewhere, and it runs there bound; their agents start none there; the device list names it, and Clear takes it", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "filament-person-copy-route-"));
  const was = process.env.FILAMENT_COPIES_DIR;
  process.env.FILAMENT_COPIES_DIR = join(base, "copies");
  t.after(() => {
    if (was === undefined) delete process.env.FILAMENT_COPIES_DIR;
    else process.env.FILAMENT_COPIES_DIR = was;
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const up = await fakeUpstream((/** @type {any} */ call) => (call.kind === "anthropic" ? anthropicReply("ok", { model: "brain-model" }) : undefined));
  const two = await startTwoMachines({
    there: {
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, permissions: "auto", roots: [join(base, "work")], readerModel: "" };
      },
    },
  });
  const { there } = two;
  try {
    const m = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ from: "Laptop" }) })).json();
    const id = String(m.device.id);
    assert.equal((await there.api(`/api/remote/devices/${encodeURIComponent(id)}`, { method: "PATCH", body: { grants: { copies: true } } })).status, 200);
    const agents = as(there, m.token);
    /** @param {string} path @param {any} [body] */
    const app = (path, body) => two.ask(path, body === undefined ? {} : { method: "POST", headers: JSON_TYPE, body: JSON.stringify(body) });

    // The grant Copies alone: what Filament takes, and the transfers' rows; no chat of theirs.
    const state = await (await agents("/api/state")).json();
    assert.ok(state.takes.includes("person-copy"), JSON.stringify(state.takes));
    assert.ok((await (await app("/api/remote/me")).json()).desk.includes("person-copy"));
    assert.equal((await agents("/api/sessions", { method: "POST", body: { cwd: join(base, "work"), model: "agent/brain-model" } })).status, 403);
    const launch = await agents("/api/transfers/place", { method: "POST", body: { project: "widgets", commit: "a".repeat(40) } });
    assert.equal(launch.status, 403, await launch.clone().text());

    const taken = there.app.remoteCopies.take(id, "widgets", { owned: true, fresh: true });
    assert.ok(taken.ok);
    const cwd = taken.copy.folder;
    // Their agents start none there, Agents on too.
    assert.equal((await there.api(`/api/remote/devices/${encodeURIComponent(id)}`, { method: "PATCH", body: { grants: { agents: true, copies: true } } })).status, 200);
    const theirs = await agents("/api/sessions", { method: "POST", body: { cwd, model: "agent/brain-model", preset: "plain" } });
    assert.equal(theirs.status, 403, await theirs.clone().text());
    assert.match(String((await theirs.json()).error), /placed for a chat of the person's own/);
    const ran = await agents("/api/exec", { method: "POST", body: { cwd, command: "node -e 1" } });
    assert.equal(ran.status, 403, await ran.clone().text());
    // This computer's own chat is not made there: the copies folder is no root for it.
    assert.equal((await there.api("/api/sessions", { method: "POST", body: { cwd, model: "agent/brain-model" } })).status, 403);

    // The app's full device: weighed, made, bound, and its turn runs there. A start asked again before the first chat
    // ran a turn takes the copy, and that first chat, empty, goes.
    assert.equal((await app("/api/sessions/draft-start", { cwd, model: "agent/brain-model" })).status, 200);
    const first = await (await app("/api/sessions", { cwd, model: "agent/brain-model", title: "Fix the widgets" })).json();
    assert.equal(there.app.remoteCopies.get(taken.copy.id)?.chat, first.id);
    const made = await app("/api/sessions", { cwd, model: "agent/brain-model", title: "Fix the widgets" });
    const chat = await made.json();
    assert.equal(made.status, 200, JSON.stringify(chat));
    assert.equal(there.app.remoteCopies.get(taken.copy.id)?.chat, chat.id);
    assert.equal((await there.api(`/api/sessions/${encodeURIComponent(first.id)}`)).status, 404, "the start it took over, never run, is gone");
    // (fails before: yes — the review of s2a: the copy's folder made a project here named "1", its number folder)
    assert.equal(there.app.memory.archive?.getProject(chat.projectId)?.name, "widgets (from Laptop)", "its project is called for the project it is a copy of, and the machine it came from");
    assert.equal((await (await there.api("/api/memory/projects")).json()).projects.find((/** @type {any} */ p) => p.id === chat.projectId)?.name, "widgets (from Laptop)", "so the list says");
    const turn = await app(`/api/sessions/${encodeURIComponent(chat.id)}/turns`, { content: "hello", stream: false });
    assert.equal(turn.status, 200, await turn.clone().text());
    assert.match(await turn.text(), /"ok"|\bok\b/);
    assert.equal(there.app.remoteCopies.get(taken.copy.id)?.ran, true, "its turn held the copy");
    const second = await app("/api/sessions", { cwd, model: "agent/brain-model" });
    assert.equal(second.status, 409, await second.clone().text());

    const listed = await (await there.api("/api/remote/devices")).json();
    assert.deepEqual(listed.devices.find((/** @type {any} */ d) => d.id === id)?.copies?.chats, [{ id: chat.id, title: "Fix the widgets" }]);

    // (fails before: yes — the review of s2a: a fork of it, or a thread it started, was bound to nothing, and its turns
    // were refused for agentLoop.roots) Made from it, each works in the copy too, and its turns run there.
    const forked = await app(`/api/sessions/${encodeURIComponent(chat.id)}/fork`, { atTurn: 1 });
    const fork = await forked.json();
    assert.equal(forked.status, 200, JSON.stringify(fork));
    assert.deepEqual(there.app.remoteCopies.get(taken.copy.id)?.also, [fork.chainId]);
    const forkTurn = await app(`/api/sessions/${encodeURIComponent(fork.chainId)}/turns`, { content: "and again", stream: false });
    assert.equal(forkTurn.status, 200, await forkTurn.clone().text());
    const thread = there.app.sessions.create({ cwd, model: "agent/brain-model", title: "A thread", thread: chat.id });
    assert.deepEqual(there.app.remoteCopies.get(taken.copy.id)?.also, [fork.chainId, thread.id]);

    const cleared = await there.api(`/api/remote/devices/${encodeURIComponent(id)}/copies/clear`, { method: "POST" });
    assert.equal(cleared.status, 200);
    assert.equal(existsSync(cwd), false);
    assert.equal((await there.api(`/api/sessions/${encodeURIComponent(chat.id)}`)).status, 404, "the person's chat in it went with it");
    for (const made of [fork.chainId, thread.id]) assert.equal((await there.api(`/api/sessions/${encodeURIComponent(made)}`)).status, 404, "and those made from it");
    // (fails before: yes — the review of s2a: the project stayed in the list after its copy went)
    assert.ok(there.app.memory.archive && !there.app.memory.archive.getProject(chat.projectId), "and its project, which held no other chat");
    assert.ok(!(await (await there.api("/api/memory/projects")).json()).projects?.some((/** @type {any} */ p) => p.id === chat.projectId), "none in the list");
  } finally {
    await two.stop();
    await up.close();
  }
});

// (fails before: yes — the review of s2a: the app paired again after a revoke found none of its Run on copies)
test("between two Filaments: the app paired again after a revoke takes its machine's copies as it mints its agents' device", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "filament-person-copy-again-"));
  const was = process.env.FILAMENT_COPIES_DIR;
  process.env.FILAMENT_COPIES_DIR = join(base, "copies");
  t.after(() => {
    if (was === undefined) delete process.env.FILAMENT_COPIES_DIR;
    else process.env.FILAMENT_COPIES_DIR = was;
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const two = await startTwoMachines();
  const { there } = two;
  try {
    // The app's claim states its machine's id, as the desktop app's does (desktop/lib/add-machine.js `claimScript`).
    const claim = async () => {
      const open = await (await there.api("/api/remote/pair", { method: "POST", body: { scope: "full" } })).json();
      const r = await pinnedFetch(there.lan.fingerprint)(`${there.far}/api/remote/claim`, { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ code: open.code, name: "Filament app on Laptop", machine: two.here.machine.id }) });
      const j = await r.json();
      assert.equal(r.status, 200, JSON.stringify(j));
      const agents = await (await as(there, j.token)("/api/remote/agent-device", { method: "POST", body: { from: "Laptop" } })).json();
      assert.ok(agents.device?.id, JSON.stringify(agents));
      return { full: String(j.device.id), agents: String(agents.device.id) };
    };
    const first = await claim();
    const taken = there.app.remoteCopies.take(first.agents, "widgets", { owned: true, fresh: true });
    assert.ok(taken.ok);
    assert.equal(there.app.remoteCopies.bind(taken.copy.id, "chat-p"), true);
    assert.equal((await there.api(`/api/remote/devices/${encodeURIComponent(first.full)}`, { method: "DELETE" })).status, 200);
    const again = await claim();
    assert.equal(there.app.remoteCopies.ownedAt(again.full, taken.copy.folder)?.id, taken.copy.id);
    const listed = await (await there.api("/api/remote/devices")).json();
    assert.equal(listed.devices.find((/** @type {any} */ d) => d.id === again.agents)?.copies?.count, 1, "Settings lists them under the app paired again");
    assert.equal(listed.devices.find((/** @type {any} */ d) => d.id === first.agents)?.copies, undefined);
  } finally {
    await two.stop();
  }
});
