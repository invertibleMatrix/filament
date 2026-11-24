// @ts-check
// Learned routes (the remote desk's s4b, desktop/lib/learn-routes.js): a machine paired once — over the tailnet, say —
// gains the ways it says it has, its network listener's addresses pinned to the certificate it names and its tailnet
// address, read as this window's full device over a way that proves its word; kept after the person's ways, which are
// never touched, and following what it says as its address moves. The sign-in is given them first (rail.js
// `giveSignIn`), and the best way that answers is taken (machines.js `pickRoute`): at home, its network.
// (fails before: yes — a machine was reached by the ways the person added alone; paired over the tailnet, it stayed on
// the tailnet at home, and a new address on the network was the person's to pair again)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MACHINES_FILE, addMachine, isLearned, pickRoute, readKept, routeOf, setLearnedRoutes, setMachineOff } from "../desktop/lib/machines.js";
import { LAN_MOST, LEARN_MS, createRouteLearner, trusted, waysOf } from "../desktop/lib/learn-routes.js";
import { giveSignIn } from "../desktop/lib/rail.js";
import { FOR, createReach } from "../desktop/lib/reach.js";

/** @type {string[]} */
const made = [];
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-learned-"));
  made.push(d);
  return join(d, "desktop", MACHINES_FILE);
};
const PRINT = `${"AB:".repeat(31)}CD`;
const OTHER = `${"EF:".repeat(31)}01`;
const TAIL = "https://box.tail1234.ts.net";
const HOME = "https://192.168.1.20:20343";
/** @type {any} */
const viaTail = { kind: "url", url: TAIL };
/** @type {any} */
const viaWeb = { kind: "url", url: "https://box.example.com" };
/** /remote/lan's answer while it listens. @param {Record<string, any>} [o] */
const lanSaid = (o = {}) => ({ status: 200, json: { on: true, port: 20343, listening: { port: 20343 }, error: null, fingerprint: PRINT, notAfter: 0, addresses: [HOME], hostOnly: null, ...o } });
const tailSaid = (address = TAIL) => ({ status: 200, json: { installed: true, address } });

test("whose word pins a certificate: the tailnet's, an SSH tunnel this app holds, the network's pinned; never the internet's, nor plain http on this computer", () => {
  assert.equal(trusted(viaTail), true);
  assert.equal(trusted(/** @type {any} */ ({ kind: "ssh", url: "http://127.0.0.1:41000", alias: "box", port: 20300 })), true);
  assert.equal(trusted(/** @type {any} */ ({ kind: "lan", url: HOME, fingerprint: PRINT })), true);
  assert.equal(trusted(viaWeb), false);
  assert.equal(trusted(/** @type {any} */ ({ kind: "url", url: "http://127.0.0.1:20310" })), false);
});

test("the ways an answer says: its network's addresses pinned to its certificate — a network of one's own's alone, LAN_MOST at most —, its tailnet address; none while it listens not, or opens from that machine alone", () => {
  const many = ["https://192.168.1.20:20343", "https://203.0.113.5:20343", "https://10.0.0.4:20343", "https://10.0.0.4:20343", "https://172.16.0.2:20343", "https://192.168.7.7:20343", "https://10.1.1.1:20343"];
  const w = waysOf(viaTail, lanSaid({ addresses: many }), tailSaid());
  assert.deepEqual(w.lan, ["https://192.168.1.20:20343", "https://10.0.0.4:20343", "https://172.16.0.2:20343", "https://192.168.7.7:20343"].map((url) => ({ kind: "lan", url, fingerprint: PRINT, learned: true })), "the internet's is the person's to add; one said twice is one");
  assert.equal(w.lan?.length, LAN_MOST);
  assert.deepEqual(w.tailnet, [{ kind: "url", url: TAIL, learned: true }]);
  assert.deepEqual(waysOf(viaTail, lanSaid({ listening: null, addresses: [] }), tailSaid(/** @type {any} */ (null))), { lan: [], tailnet: [] }, "off: none, so those learned go");
  assert.deepEqual(waysOf(viaTail, lanSaid({ hostOnly: "Filament runs in WSL behind its NAT" }), null).lan, [], "WSL's NAT: its addresses open from its own computer alone");
  assert.deepEqual(waysOf(viaTail, lanSaid({ fingerprint: "nope" }), null).lan, [], "no certificate to pin: none");
  assert.deepEqual(waysOf(viaTail, lanSaid(), tailSaid("https://box.example.com")).tailnet, [], "an address that is not the tailnet's is none");
  assert.deepEqual(waysOf(viaTail, null, { status: 403, json: { error: "no" } }), { lan: null, tailnet: null }, "not read: what was learned stays");
  assert.deepEqual(waysOf(viaWeb, lanSaid(), tailSaid()), { lan: null, tailnet: null }, "over the internet: nothing taken");
  const odd = ["https://box.local:20343", "https://127.0.0.1:20343", "https://169.254.3.4:20343", "https://0.0.0.0:20343", HOME];
  assert.deepEqual(waysOf(viaTail, lanSaid({ addresses: odd }), null).lan?.map((r) => r.url), [HOME], "a name, loopback, a network that gave no address: none");
});

test("kept after the person's ways, in the place of those learned before: one no longer said goes; an address the person holds stays theirs; the same ways write nothing; the mark kept as read", () => {
  const file = fresh();
  addMachine(file, { id: "m-box", name: "Box", routes: [{ kind: "url", url: TAIL }, { kind: "lan", url: "https://192.168.1.9:20343", fingerprint: OTHER }] }, { now: 1 });
  setMachineOff(file, "m-box", true);
  setMachineOff(file, "m-box", false);
  const lan = (/** @type {string} */ url) => ({ kind: "lan", url, fingerprint: PRINT });
  const got = setLearnedRoutes(file, "m-box", [lan(HOME), lan("https://192.168.1.9:20343"), { kind: "url", url: TAIL }, { kind: "ssh", url: "http://127.0.0.1:41000", alias: "box", port: 20300 }]);
  assert.equal(got?.changed, true);
  assert.deepEqual(readKept(file)[0].routes, [{ kind: "url", url: TAIL }, { kind: "lan", url: "https://192.168.1.9:20343", fingerprint: OTHER }, { kind: "lan", url: HOME, fingerprint: PRINT, learned: true }], "the person's pin and address stand; an SSH way is never learned");
  const at = statSync(file).mtimeMs;
  assert.equal(setLearnedRoutes(file, "m-box", [lan(HOME)])?.changed, false);
  assert.equal(statSync(file).mtimeMs, at, "nothing written");
  assert.equal(setLearnedRoutes(file, "m-box", [lan("https://192.168.1.21:20343")])?.changed, true);
  assert.deepEqual(readKept(file)[0].routes.map((r) => [r.url, isLearned(r)]), [[TAIL, false], ["https://192.168.1.9:20343", false], ["https://192.168.1.21:20343", true]], "the address it moved to, in the old one's place");
  setLearnedRoutes(file, "m-box", []);
  assert.deepEqual(readKept(file)[0].routes.map((r) => r.url), [TAIL, "https://192.168.1.9:20343"], "none said: none learned");
  assert.equal(setLearnedRoutes(file, "m-none", [lan(HOME)]), null);
  assert.deepEqual(routeOf({ kind: "url", url: TAIL, learned: "yes" }), { kind: "url", url: TAIL }, "learned is true or none");
});

test("paired again at an address it was learned at: the person's now", () => {
  const file = fresh();
  addMachine(file, { id: "m-box", name: "Box", routes: [{ kind: "url", url: TAIL }] }, { now: 1 });
  setLearnedRoutes(file, "m-box", [{ kind: "lan", url: HOME, fingerprint: PRINT }]);
  addMachine(file, { id: "m-box", name: "Box", routes: [{ kind: "lan", url: HOME, fingerprint: OTHER }] });
  assert.deepEqual(readKept(file)[0].routes, [{ kind: "lan", url: HOME, fingerprint: OTHER }, { kind: "url", url: TAIL }]);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(raw.machines[0].routes.some((/** @type {any} */ r) => r.learned), false);
});

/**
 * A partition's cookies as Electron's session holds them, by origin. @param {Record<string, any[]>} [jar]
 */
const sessionWith = (jar = {}) => ({
  jar,
  cookies: {
    get: async (/** @type {{ url: string }} */ q) => jar[new URL(q.url).origin] || [],
    set: async (/** @type {any} */ c) => void (jar[new URL(c.url).origin] = [...(jar[new URL(c.url).origin] || []).filter((k) => k.name !== c.name), c]),
  },
});

test("the sign-in at the way it was read by, given the network's and the tailnet's addresses; the internet's only where one stood; plain http never", async () => {
  const ses = sessionWith({ [TAIL]: [{ name: "__Host-filament_device", value: "tok", expirationDate: 99 }], "https://box.example.com": [{ name: "__Host-filament_device", value: "old" }] });
  const routes = /** @type {any[]} */ ([
    { kind: "lan", url: HOME, fingerprint: PRINT, learned: true },
    { kind: "url", url: "https://box.example.com" },
    { kind: "url", url: "https://other.example.com" },
    { kind: "url", url: "http://127.0.0.1:20310" },
    { kind: "lan", url: HOME, fingerprint: PRINT },
  ]);
  const gave = await giveSignIn(ses, `${TAIL}/`, routes);
  assert.deepEqual(gave, [HOME, "https://box.example.com"]);
  assert.deepEqual(ses.jar[HOME], [{ url: HOME, name: "__Host-filament_device", value: "tok", path: "/", secure: true, httpOnly: true, sameSite: "strict", expirationDate: 99 }]);
  assert.equal(ses.jar["https://box.example.com"][0].value, "tok", "one that stood there is the one standing now");
  assert.equal(ses.jar["https://other.example.com"], undefined);
  assert.equal(ses.jar["http://127.0.0.1:20310"], undefined);
  assert.deepEqual(await giveSignIn(ses, `${TAIL}/`, routes), [], "given already: nothing set again");
  assert.deepEqual(await giveSignIn(sessionWith(), `${TAIL}/`, routes), [], "none there: none given");
});

/**
 * A learner over a machines file, its machine reached as `who` by `via`, its answers `said` (a path → its answer, or a
 * throw); `give`: the sign-in's giving, recorded unless said.
 * @param {string} file @param {{ who?: string, via?: any, said?: Record<string, any>, now?: () => number, give?: (partition: string, url: string, routes: any[]) => Promise<unknown> }} [o]
 */
const learnerOver = (file, o = {}) => {
  /** @type {any[]} */
  const reads = [];
  /** @type {string[]} */
  const order = [];
  /** @type {any[]} */
  const told = [];
  const learner = createRouteLearner({
    machines: () => readKept(file),
    keep: (id, routes) => (order.push("keep"), setLearnedRoutes(file, id, routes)),
    giveSignIn: o.give ?? (async (partition, url, routes) => void order.push(`sign-in ${partition} ${url} ${routes.map((r) => r.url).join(",")}`)),
    changed: (m) => void told.push(m.routes.map((r) => r.url)),
    ...(o.now ? { now: o.now } : {}),
  });
  /** @param {any} [via] @param {string} [who] @returns {any} */
  const reached = (via = o.via ?? viaTail, who = o.who ?? "device") => ({
    who,
    route: via,
    origin: new URL(via.url).origin,
    send: async (/** @type {string} */ path, /** @type {any} */ init) => {
      reads.push([path, init?.ms]);
      const a = (o.said || {})[path];
      if (a instanceof Error) throw a;
      return a ?? { status: 404, json: null };
    },
  });
  return { learner, reads, order, told, reached };
};
const LAN_PATH = "/remote/lan?firewall=0";
const TAIL_PATH = "/remote/tailscale";
/** @type {any} */
const viaSsh = { kind: "ssh", url: "http://127.0.0.1:41000", alias: "box", port: 20300 };

// The acceptance: paired over the tailnet, it gains its network's way, is reached there at home, and the way follows a
// new address on the network.
test("paired over the tailnet: its network's way learned and taken at home; a new address on the network followed at its next read", async () => {
  const file = fresh();
  addMachine(file, { id: "m-box", name: "Box", routes: [{ kind: "url", url: TAIL }] }, { now: 1 });
  let t = 0;
  const said = { [LAN_PATH]: lanSaid(), [TAIL_PATH]: tailSaid() };
  const l = learnerOver(file, { said, now: () => t });
  assert.equal(await l.learner.learn(readKept(file)[0], l.reached()), true);
  assert.deepEqual(l.reads.sort(), [[LAN_PATH, 15_000], [TAIL_PATH, 15_000]], "its firewall not read; each read given the time a PowerShell run takes on a machine that reads it all the same");
  assert.deepEqual(l.order, [`sign-in persist:machine-m-box ${TAIL} ${HOME}`, "keep"], "the sign-in given the way learned first — none of the person's —, then it kept");
  assert.deepEqual(readKept(file)[0].routes, [{ kind: "url", url: TAIL }, { kind: "lan", url: HOME, fingerprint: PRINT, learned: true }], "its tailnet address is the person's already");
  assert.deepEqual(l.told, [[TAIL, HOME]]);

  // At home: both answer as the machine, and its network's is the better way.
  /** @param {string[]} urls @returns {import("../desktop/lib/machines.js").Ask} */
  const answersAt = (urls) => async (route) => {
    if (!urls.includes(String(route.url))) throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    return { status: 200, json: { id: "m-box", name: "Box", protocol: 1, version: "1" } };
  };
  const home = await pickRoute(readKept(file)[0], { ask: answersAt([TAIL, HOME]), betterMs: 50 });
  assert.equal(home.route?.url, HOME);

  // Its address moved (DHCP): the network's way answers no more, so the tailnet is taken, and the desk, joined by it,
  // reads its ways again at the next read.
  said[LAN_PATH] = lanSaid({ addresses: ["https://192.168.1.31:20343"] });
  const away = await pickRoute(readKept(file)[0], { ask: answersAt([TAIL, "https://192.168.1.31:20343"]), betterMs: 50 });
  assert.equal(away.route?.url, TAIL);
  t += LEARN_MS;
  assert.equal(await l.learner.learn(readKept(file)[0], l.reached()), true);
  assert.deepEqual(readKept(file)[0].routes.map((r) => r.url), [TAIL, "https://192.168.1.31:20343"]);
  const back = await pickRoute(readKept(file)[0], { ask: answersAt([TAIL, "https://192.168.1.31:20343"]), betterMs: 50 });
  assert.equal(back.route?.url, "https://192.168.1.31:20343", "home again on its new address");
});

test("main.js: the desk learns each machine's ways as it reaches it; kept in the machines file, the sign-in given in its partition, the window and this Filament's agents reading them at once, nothing once the app quits", () => {
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.match(main, /keep: \(id, routes\) => setLearnedRoutes\(machinesFile, id, routes,/);
  assert.match(main, /giveSignIn: \(partition, url, routes\) => giveSignIn\(session\.fromPartition\(partition\), url, routes\),/);
  assert.match(main, /changed: \(\) => \{\n\s+if \(quitting\) return;\n\s+rail\?\.refresh\(\);\n\s+machineBrowsers\.sync\(\);\n\s+keepAgentsWays\(\);/);
  assert.match(main, /learn: learner\.learn,/);
  // (fails before: yes — s4d) The agents' devices take the window's ways as the app starts, and as a machine is added.
  assert.match(main, /const keepAgentsWays = \(\) => \{\n\s+try \{\n\s+agentsThere\.keepWays\(\);/);
  assert.match(main, /\n {2}keepAgentsWays\(\);\n/);
  assert.match(main, /const got = addMachine\(machinesFile, m, \{ log: \(line\) => log\.line\(line\) \}\);\n\s+machineBrowsers\.sync\(\);\n\s+keepAgentsWays\(\);/);
});

test("read as a full device alone, over a way that proves its word; once each LEARN_MS by one way, at once by another; a part not read keeps what it learned; one disconnected meanwhile keeps nothing", async () => {
  const file = fresh();
  addMachine(file, { id: "m-box", name: "Box", routes: [{ kind: "url", url: "https://box.example.com" }] }, { now: 1 });
  let t = 0;
  const said = /** @type {Record<string, any>} */ ({ [LAN_PATH]: lanSaid(), [TAIL_PATH]: tailSaid() });
  const l = learnerOver(file, { said, now: () => t });
  const m = () => readKept(file)[0];
  assert.equal(await l.learner.learn(m(), l.reached(viaTail, "tailnet")), false, "by the tailnet login: no device's to read");
  assert.equal(await l.learner.learn(m(), l.reached(viaWeb)), false, "over the internet: nothing read");
  assert.deepEqual(l.reads, []);
  assert.equal(await l.learner.learn(m(), l.reached()), true);
  assert.deepEqual(m().routes.map((r) => r.url), ["https://box.example.com", HOME, TAIL]);
  said[LAN_PATH] = lanSaid({ addresses: ["https://192.168.1.40:20343"] });
  t += LEARN_MS - 1;
  assert.equal(await l.learner.learn(m(), l.reached()), false, "read a moment ago by the same way");
  assert.equal(l.reads.length, 2);
  assert.equal(await l.learner.learn(m(), l.reached(viaSsh)), true, "by another way: at once");
  assert.deepEqual(m().routes.map((r) => r.url), ["https://box.example.com", "https://192.168.1.40:20343", TAIL]);
  said[LAN_PATH] = lanSaid({ addresses: ["https://192.168.1.41:20343"] });
  said[TAIL_PATH] = new Error("no answer");
  t += LEARN_MS;
  assert.equal(await l.learner.learn(m(), l.reached(viaSsh)), true);
  assert.deepEqual(m().routes.map((r) => r.url), ["https://box.example.com", "https://192.168.1.41:20343", TAIL], "the tailnet's not read: kept as learned");
  said[LAN_PATH] = { status: 503, json: { error: "not wired" } };
  said[TAIL_PATH] = tailSaid(/** @type {any} */ (null));
  t += LEARN_MS;
  assert.equal(await l.learner.learn(m(), l.reached(viaSsh)), true);
  assert.deepEqual(m().routes.map((r) => r.url), ["https://box.example.com", "https://192.168.1.41:20343"], "no tailnet address now: it goes; the network's not read: kept");
  said[LAN_PATH] = new Error("no answer");
  said[TAIL_PATH] = { status: 403, json: { error: "no" } };
  t += LEARN_MS;
  const n = l.order.length;
  assert.equal(await l.learner.learn(m(), l.reached(viaSsh)), false, "nothing read: nothing given, nothing kept");
  assert.equal(l.order.length, n);
  setMachineOff(file, "m-box", true);
  said[LAN_PATH] = lanSaid({ addresses: [] });
  t += LEARN_MS;
  assert.equal(await l.learner.learn(m(), l.reached(viaSsh)), false, "disconnected meanwhile");
  assert.deepEqual(m().routes.map((r) => r.url), ["https://box.example.com", "https://192.168.1.41:20343"]);
});

// (fails before: yes — the review of s4b: a tailnet served anew says no address a moment, and one read then dropped the
// learned tailnet way the desk was joined by, its only way from away)
test("the way it was read by stays, said or not: it answered as the machine just now", async () => {
  const file = fresh();
  addMachine(file, { id: "m-box", name: "Box", routes: [{ kind: "lan", url: "https://192.168.1.9:20343", fingerprint: OTHER }] }, { now: 1 });
  const said = /** @type {Record<string, any>} */ ({ [LAN_PATH]: lanSaid({ addresses: [] }), [TAIL_PATH]: tailSaid() });
  let t = 0;
  const l = learnerOver(file, { said, now: () => t, via: { kind: "lan", url: "https://192.168.1.9:20343", fingerprint: OTHER } });
  assert.equal(await l.learner.learn(readKept(file)[0], l.reached()), true);
  assert.deepEqual(readKept(file)[0].routes.map((r) => r.url), ["https://192.168.1.9:20343", TAIL]);
  said[TAIL_PATH] = tailSaid(/** @type {any} */ (null));
  const learnedTail = readKept(file)[0].routes[1];
  t += LEARN_MS;
  assert.equal(await l.learner.learn(readKept(file)[0], l.reached(learnedTail)), false, "read by its learned tailnet way, which says none a moment: kept");
  assert.deepEqual(readKept(file)[0].routes.map((r) => r.url), ["https://192.168.1.9:20343", TAIL]);
});

// (fails before: yes — the review of s4b: a way was kept whose sign-in was never given, and a learned way holding no
// sign-in that stands was the one the window took, said signed out)
test("a sign-in not given: none of the ways kept", async () => {
  const file = fresh();
  addMachine(file, { id: "m-box", name: "Box", routes: [{ kind: "url", url: TAIL }] }, { now: 1 });
  const l = learnerOver(file, { said: { [LAN_PATH]: lanSaid() }, give: async () => Promise.reject(new Error("the partition is gone")) });
  assert.equal(await l.learner.learn(readKept(file)[0], l.reached()), false);
  assert.deepEqual(readKept(file)[0].routes, [{ kind: "url", url: TAIL }]);
});

test("reach: a learned way where this window is no device — its sign-in there ended, or none —: the ways the person added asked instead; none of them answering, what the learned way said stands", async () => {
  const learnedHome = { kind: "lan", url: HOME, fingerprint: PRINT, learned: true };
  const m = /** @type {any} */ ({ id: "m-box", name: "Box", routes: [{ kind: "url", url: TAIL }, learnedHome], partition: "persist:machine-m-box", addedAt: 1 });
  let tailUp = true;
  let revoked = false;
  /** @type {string[]} */
  const picked = [];
  const reach = createReach({
    cookieOf: async () => "__Host-filament_device=tok",
    pick: async (x) => {
      const r = x.routes.find(isLearned) ?? (tailUp ? x.routes[0] : null);
      picked.push(r ? String(r.url) : "none");
      return r ? { route: r, name: "Box", version: "1", tried: [] } : { route: null, name: null, version: null, tried: [{ url: TAIL, why: `nothing listens at ${TAIL}` }] };
    },
    fetchOf: (route) => /** @type {any} */ (async () =>
      revoked && route.url === HOME
        ? new Response(JSON.stringify({ error: "revoked" }), { status: 401, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify(route.url === HOME ? { who: "tailnet", login: "a@b" } : { who: "device", device: { id: "d", scope: "full" }, machine: { id: "m-box" } }), { status: 200, headers: { "content-type": "application/json" } })),
  });
  const got = /** @type {any} */ (await reach(m, FOR.desk));
  assert.deepEqual([got.who, got.origin, picked], ["device", TAIL, [HOME, TAIL]], "the person's way, where it is the device");
  tailUp = false;
  picked.length = 0;
  const only = /** @type {any} */ (await reach(m, FOR.desk));
  assert.deepEqual([only.who, only.origin, picked], ["tailnet", HOME, [HOME, "none"]], "theirs not answering: the learned way's login, as it was");
  const settings = /** @type {any} */ (await reach(m, FOR.switch));
  assert.match(settings.words, /by your tailnet login, not as a paired device/, "Settings' switch: what the learned way said, not that the person's ways did not answer");
  revoked = true;
  const gone = /** @type {any} */ (await reach(m, FOR.desk));
  assert.match(gone.words, /sign-in on Box is gone/, "revoked there: said so, its ways away or not");
  assert.equal(gone.away, undefined);
});
