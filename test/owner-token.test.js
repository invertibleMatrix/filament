// @ts-check
// This computer's owner key (the "same computer = owner" gap, its phase 0: services/owner.js): each start mints a key
// into owner.key, readable by the person's account alone, before listening.json; the command line, the desktop app's
// calls and Filament's calls to itself send it, and the app's windows hold a browser session minted with it. It counts
// over loopback alone, and is taken out of the request as it is read. For now it changes nothing: a call of this
// computer's without it is answered all the same, counted by the program that sent it, which /state, Settings and doctor
// say. Through a real Filament, and the guards on requests made by hand.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "./helpers/app.js";
import { OWNER_COOKIE, OWNER_FILE, OWNER_HEADER, createOwner, ownerAt, ownerHeaders, ownerKeyOf } from "../src/services/owner.js";
import { ownerOf, whoIs } from "../src/http/guards.js";
import { SESSION_REFUSED } from "../src/http/admin/owner.js";
import { loopbackPost } from "../src/services/loopback.js";
import { connect } from "../src/cli/client.js";
import { LISTENING_FILE } from "../src/cli/listening.js";
import { foundAt } from "../desktop/lib/start.js";
import { ownerlessWords } from "../src/ui/harness/settings/remote.js";
import { safeEnv } from "../src/adapters/tools/hands.js";
import { agentEnv } from "../src/adapters/agents/agent-process.js";

/**
 * A request over node:http, so the test sets every header itself.
 * @param {number} port @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, json: any, text: string }>}
 */
const ask = (port, path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...(text ? { "content-type": "application/json" } : {}), ...headers } });
    req.on("response", (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(b);
        } catch {}
        resolve({ status: Number(res.statusCode), headers: res.headers, json, text: b });
      });
    });
    req.on("error", reject);
    req.end(text || undefined);
  });

/** A request as the guards read it: its headers, over loopback at `port`. @param {Record<string, string>} headers @param {number} port */
const fake = (headers, port) => /** @type {any} */ ({ headers, socket: { remoteAddress: "127.0.0.1", localPort: port } });

describe("the owner key, read by the guards", () => {
  /** A port no Filament listens on in this process: its key is the test's own. */
  const PORT = 1;
  const dir = mkdtempSync(join(tmpdir(), "filament-owner-"));
  /** @type {string[]} */
  const said = [];
  const owner = createOwner({ dataDir: dir, log: (_level, msg) => void said.push(msg) });
  before(() => owner.listen(PORT));
  after(() => {
    owner.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // (fails before: yes — there was no key: services/owner.js and guards.js `ownerOf` were not there)
  test("a call over loopback with the key is the owner's: the header and its session's cookie are taken out of the request, other cookies kept", () => {
    const key = ownerKeyOf(dir);
    assert.match(key, /^fot_[A-Za-z0-9_-]{43}$/);
    const req = fake({ [OWNER_HEADER]: key, cookie: `a=1; ${OWNER_COOKIE}=fos_none; b=2` }, PORT);
    assert.equal(ownerOf(req), "owner");
    assert.equal(req.headers[OWNER_HEADER], undefined, "the header is gone");
    assert.equal(req.headers.cookie, "a=1; b=2", "its cookie is gone, the others stay");
    assert.deepEqual(whoIs(req, {}, null), { kind: "local", owner: true }, "read once: whoIs after it says the same");
    const session = owner.session();
    const viaCookie = fake({ cookie: `${OWNER_COOKIE}=${session}` }, PORT);
    assert.deepEqual(whoIs(viaCookie, {}, null), { kind: "local", owner: true }, "the app's window, by the session minted for it");
    assert.equal(viaCookie.headers.cookie, undefined, "a Cookie header that held it alone is gone");
  });

  test("a key or session that is not this start's is stale; none is none; through a proxy the key counts for nothing, said once", () => {
    const wrong = fake({ [OWNER_HEADER]: `fot_${"A".repeat(43)}` }, PORT);
    assert.equal(ownerOf(wrong), "stale");
    assert.deepEqual(whoIs(wrong, {}, null), { kind: "local" }, "answered all the same");
    assert.equal(ownerOf(fake({ cookie: `${OWNER_COOKIE}=fos_gone` }, PORT)), "stale");
    assert.equal(ownerOf(fake({}, PORT)), "none");
    assert.equal(ownerOf(fake({ [OWNER_HEADER]: ownerKeyOf(dir) }, 2)), "stale", "the key of the Filament at another port is no key there");
    const proxied = fake({ [OWNER_HEADER]: ownerKeyOf(dir), "x-forwarded-for": "100.64.0.9" }, PORT);
    assert.equal(ownerOf(proxied), "none");
    assert.equal(proxied.headers[OWNER_HEADER], undefined, "taken out all the same");
    assert.equal(whoIs(proxied, {}, null), null, "a proxied call is no one Filament knows");
    ownerOf(fake({ [OWNER_HEADER]: ownerKeyOf(dir), via: "1.1 proxy" }, PORT));
    assert.equal(said.filter((l) => /through a proxy/.test(l)).length, 1, said.join("\n"));
  });

  test("each start mints its own key, readable by this account alone; a stop takes away its own file and no other's", () => {
    const first = ownerKeyOf(dir);
    const file = join(dir, OWNER_FILE);
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
    const again = createOwner({ dataDir: dir });
    again.listen(3);
    const second = ownerKeyOf(dir);
    assert.notEqual(second, first, "a start's key is its own");
    assert.equal(ownerAt(3)?.holds(second), true);
    assert.equal(ownerAt(PORT)?.holds(second), false);
    // The earlier start stops: the file is the newer one's now, and stays.
    const before = readFileSync(file, "utf8");
    const other = createOwner({ dataDir: dir });
    other.close();
    assert.equal(readFileSync(file, "utf8"), before);
    again.close();
    assert.equal(ownerKeyOf(dir), "", "its own taken away");
    assert.equal(ownerAt(3), null);
    // The test's own owner writes its key back for the tests after.
    writeFileSync(file, `${first}\n`);
  });

  test("a program without the key is counted by what it calls itself, its first call said in the log; newest first", () => {
    const o = createOwner({ dataDir: dir, log: (_l, msg) => void said.push(msg), now: () => 5 });
    const was = said.length;
    o.tokenless("curl/8.4.0");
    o.tokenless("curl/8.4.0");
    o.tokenless("");
    assert.deepEqual(o.said(), { count: 3, programs: [{ agent: "(no user agent)", count: 1, lastAt: 5 }, { agent: "curl/8.4.0", count: 2, lastAt: 5 }] });
    assert.equal(said.slice(was).length, 2, "one line for each program, at its first call");
    assert.match(said[was], /curl\/8\.4\.0/);
  });

  test("a key that cannot be written takes away the one an earlier start left, so no call carries a stale one", () => {
    const blocked = mkdtempSync(join(tmpdir(), "filament-owner-blocked-"));
    try {
      writeFileSync(join(blocked, OWNER_FILE), `fot_${"D".repeat(43)}\n`);
      // A folder where the key is written first: the write fails.
      mkdirSync(join(blocked, `${OWNER_FILE}.${process.pid}.tmp`, "held"), { recursive: true });
      /** @type {string[]} */
      const told = [];
      const o = createOwner({ dataDir: blocked, log: (_l, msg) => void told.push(msg) });
      o.listen(4);
      assert.equal(existsSync(join(blocked, OWNER_FILE)), false, "the earlier start's key is taken away");
      assert.match(told.join("\n"), /the owner key could not be written/);
      o.close();
    } finally {
      rmSync(blocked, { recursive: true, force: true });
    }
  });

  test("Settings says the calls without the key in words", () => {
    assert.match(ownerlessWords({ count: 0, programs: [] }), /^Every program on this computer that called Filament since it started sent its owner key/);
    assert.match(ownerlessWords({ count: 3, programs: [{ agent: "curl/8.4.0", count: 2 }, { agent: "python-requests/2.32", count: 1 }] }), /^3 calls since Filament started came from a program here without its owner key, answered all the same: curl\/8\.4\.0 \(2\), python-requests\/2\.32 \(1\)\./);
    assert.match(ownerlessWords({ count: 1 }), /^1 call since/);
  });
});

describe("the owner key, through a real Filament", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    shim = await startApp();
  });
  after(async () => {
    await shim?.stop();
  });
  const call = (/** @type {string} */ path, /** @type {any} */ o) => ask(shim.port, path, o);
  /** The calls without the key so far, as /state tells this computer's own read. */
  const counted = async () => {
    const r = await call("/api/state", { headers: ownerHeaders(shim.dataDir, shim.url) });
    assert.equal(r.status, 200, r.text);
    return r.json.ownerless;
  };

  test("minted as Filament listens, never in listening.json, and taken away as it stops", async () => {
    const key = ownerKeyOf(shim.dataDir);
    assert.match(key, /^fot_/);
    assert.ok(!readFileSync(join(shim.dataDir, LISTENING_FILE), "utf8").includes(key));
    assert.equal(ownerAt(shim.port)?.holds(key), true);
    const other = await startApp();
    const theirs = ownerKeyOf(other.dataDir);
    assert.notEqual(theirs, key, "another Filament's is its own");
    await other.stop();
    assert.equal(ownerAt(other.port), null, "known no more once it stopped");
  });

  // (fails before: yes — /state said no `ownerless`, and nothing counted this computer's calls without a key)
  test("a call of this computer's without the key is answered all the same, and counted by its program; one with it is not", async () => {
    const was = await counted();
    const bare = await call("/api/state", { headers: { "user-agent": "curl/8.4.0" } });
    assert.equal(bare.status, 200, "answered all the same");
    const now = await counted();
    assert.equal(now.count, was.count + 1);
    assert.deepEqual(now.programs[0], { agent: "curl/8.4.0", count: (was.programs.find((/** @type {any} */ p) => p.agent === "curl/8.4.0")?.count ?? 0) + 1, lastAt: now.programs[0].lastAt });
    assert.equal((await counted()).count, now.count, "the reads with the key counted nothing");
  });

  test("the command line, Filament's own calls and the app's first question carry the key: none is counted", async () => {
    const was = (await counted()).count;
    const client = await connect(shim.dataDir);
    await client.get("/state");
    await client.get("/remote/me");
    // Filament's call to itself: the row that mints a session answers a call with the key alone.
    const own = await loopbackPost(`${shim.url}/api/owner/session`, { headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(own.status, 200, await own.clone().text());
    assert.equal((await foundAt(shim.port, { dataDir: shim.dataDir })).kind, "attach");
    assert.equal((await counted()).count, was);
  });

  test("the app's windows: a browser session minted for a call with the key alone, no-store; its cookie is the owner's; an earlier start's is stale and not counted", async () => {
    const refused = await call("/api/owner/session", { method: "POST", body: {} });
    assert.equal(refused.status, 403);
    assert.equal(refused.json.error, SESSION_REFUSED);
    const minted = await call("/api/owner/session", { method: "POST", body: {}, headers: ownerHeaders(shim.dataDir, shim.url) });
    assert.equal(minted.status, 200, minted.text);
    assert.equal(minted.json.cookie, OWNER_COOKIE);
    assert.match(minted.json.token, /^fos_/);
    assert.equal(minted.headers["cache-control"], "no-store");
    assert.ok(!minted.text.includes(ownerKeyOf(shim.dataDir)), "never the key itself");
    const was = (await counted()).count;
    const page = await call("/api/state", { headers: { cookie: `${OWNER_COOKIE}=${minted.json.token}` } });
    assert.equal(page.status, 200);
    assert.ok(page.json.ownerless, "the window's read is this computer's own");
    await call("/api/state", { headers: { cookie: `${OWNER_COOKIE}=fos_an-earlier-start` } });
    await call("/api/state", { headers: { [OWNER_HEADER]: `fot_${"B".repeat(43)}` } });
    assert.equal((await counted()).count, was, "the window's session, and an earlier start's, are not counted");
  });

  test("through a proxy, the key opens nothing: refused as any proxied call is", async () => {
    const far = await call("/api/state", { headers: { ...ownerHeaders(shim.dataDir, shim.url), "x-forwarded-for": "100.64.0.9" } });
    assert.equal(far.status, 403);
    const session = await call("/api/owner/session", { method: "POST", body: {}, headers: { ...ownerHeaders(shim.dataDir, shim.url), "x-forwarded-for": "100.64.0.9" } });
    assert.equal(session.status, 403);
  });

  test("the key is in no environment: this process's, an agent's or a shell's", () => {
    const key = ownerKeyOf(shim.dataDir);
    for (const env of [process.env, safeEnv(), agentEnv().env]) assert.ok(!Object.values(env).some((v) => String(v).includes(key)));
  });

  // (fails before: yes — the review of s0a: foundAt, doctor and the service sent the key to whatever answered at the
  // port they asked, before reading whose Filament it was)
  test("the key goes only to this computer's own address at the port the folder's Filament listens on", async () => {
    assert.ok(ownerHeaders(shim.dataDir, shim.url)[OWNER_HEADER], "its own address and port");
    assert.ok(ownerHeaders(shim.dataDir, `http://localhost:${shim.port}/api/state`)[OWNER_HEADER], "by the name localhost too");
    for (const url of [`http://127.0.0.1:${shim.port + 1}`, `https://127.0.0.1:${shim.port}`, `http://192.168.1.20:${shim.port}`, "no address"])
      assert.deepEqual(ownerHeaders(shim.dataDir, url), {}, url);
    // Another program at a port this folder's Filament does not hold — the config's after a move, another account's —
    // is asked without it, whoever it says it is.
    /** @type {http.IncomingHttpHeaders[]} */
    const heard = [];
    const squatter = http.createServer((req, res) => {
      heard.push(req.headers);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ version: "9.9.9", dataDir: shim.dataDir }));
    });
    await new Promise((r) => squatter.listen(0, "127.0.0.1", () => r(undefined)));
    try {
      const port = /** @type {import("node:net").AddressInfo} */ (squatter.address()).port;
      await foundAt(port, { dataDir: shim.dataDir });
      assert.equal(heard.length, 1);
      assert.equal(heard[0][OWNER_HEADER], undefined, "the app's first question");
    } finally {
      await new Promise((r) => squatter.close(() => r(undefined)));
    }
  });

  test("the command line reads the key at each call: a client made before a new start sends the new one", async () => {
    const file = join(shim.dataDir, OWNER_FILE);
    const first = ownerKeyOf(shim.dataDir);
    /** @type {(string | undefined)[]} */
    const sent = [];
    /** @type {typeof fetch} */
    const fetchImpl = async (_url, init) => {
      sent.push(/** @type {any} */ (init?.headers)?.[OWNER_HEADER]);
      return new Response(JSON.stringify({ version: "9.9.9", dataDir: shim.dataDir }), { headers: { "content-type": "application/json" } });
    };
    const client = await connect(shim.dataDir, { fetchImpl });
    await client.get("/state");
    const next = `fot_${"C".repeat(43)}`;
    writeFileSync(file, `${next}\n`);
    try {
      await client.get("/state");
    } finally {
      writeFileSync(file, `${first}\n`);
    }
    assert.deepEqual(sent, [first, first, next]);
  });

  test("a socket of this computer's without the key is counted as its calls are; with it, or a device's token, it is not", async () => {
    /** A WebSocket handshake to the run socket, its answer's status. @param {Record<string, string>} headers */
    const upgrade = (headers) =>
      new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: shim.port, path: "/api/runs/socket", headers: { host: `127.0.0.1:${shim.port}`, connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers } });
        req.on("upgrade", (res, socket) => {
          socket.destroy();
          resolve(res.statusCode);
        });
        req.on("response", (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on("error", reject);
        req.end();
      });
    const was = (await counted()).count;
    assert.equal(await upgrade({ "user-agent": "a-socket-script/1" }), 101, "answered all the same");
    const now = await counted();
    assert.equal(now.count, was + 1);
    assert.equal(now.programs[0].agent, "a-socket-script/1");
    assert.equal(await upgrade(ownerHeaders(shim.dataDir, shim.url)), 101);
    await call("/api/state", { headers: { cookie: "filament_device=fdt_an-ssh-tunnels-page" } });
    assert.equal((await counted()).count, now.count, "with the key, or a device's token, nothing more");
  });
});
