// @ts-check
// Filament's port at both loopback addresses (x40, the hunt on x38): a browser here is paired at this Filament's own
// name (`filament-….localhost`), which a browser may reach over [::1] first. Filament listens on 127.0.0.1, so it holds
// [::1] at its port too, with the same doors; where another program holds it, that program would answer the name, read
// a pairing page's code and get the browser's cookie — so no browser here is paired, said in words, by /api/state and
// by `filament doctor`.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../src/cli/doctor.js";
import { startApp } from "./helpers/app.js";

/** Whether this system listens at [::1] at all: one with no IPv6 reaches no name over it either. */
const v6 = await new Promise((resolve) => {
  const s = net.createServer();
  s.once("error", () => resolve(false));
  s.listen(0, "::1", () => s.close(() => resolve(true)));
});

/**
 * A GET at an address and port, with the Host given. @param {string} host @param {number} port @param {string} path @param {string} [hostHeader]
 * @returns {Promise<{ status: number, body: string }>}
 */
const get = (host, port, path, hostHeader = `localhost:${port}`) =>
  new Promise((resolve, reject) => {
    http
      .get({ host, port, path, agent: false, headers: { host: hostHeader } }, (res) => {
        let b = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: Number(res.statusCode), body: b }));
      })
      .on("error", reject);
  });

// (fails before: yes — Filament listened on 127.0.0.1 alone: [::1] at its port was any program's to take)
test("Filament answers at [::1] at its port as at 127.0.0.1, the same doors", { skip: !v6 && "this system has no IPv6 loopback" }, async () => {
  const shim = await startApp();
  try {
    const four = await get("127.0.0.1", shim.port, "/health");
    const six = await get("::1", shim.port, "/health");
    assert.deepEqual([four.status, six.status], [200, 200], six.body);
    const st = JSON.parse((await get("::1", shim.port, "/api/state")).body);
    assert.equal(st.loopbackTaken, undefined, "held by Filament: nothing to say");
  } finally {
    await shim.stop();
  }
  // Stopped: let go of too.
  await assert.rejects(get("::1", shim.port, "/health"));
});

test("[::1] at Filament's port held by another program: no browser here is paired, in words; /api/state and doctor say it; the start goes on", { skip: !v6 && "this system has no IPv6 loopback" }, async () => {
  const squatter = net.createServer((s) => s.end("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nno"));
  const port = await new Promise((resolve) => squatter.listen(0, "::1", () => resolve(/** @type {net.AddressInfo} */ (squatter.address()).port)));
  /** @type {Awaited<ReturnType<typeof startApp>> | null} */
  let shim = null;
  try {
    shim = await startApp({ configure: (c) => void (c.server.port = port), overrides: { port } });
    assert.equal(shim.port, port);
    assert.equal((await get("127.0.0.1", port, "/health")).status, 200, "Filament starts all the same");
    const r = await shim.api("/api/remote/pair", { method: "POST", body: { scope: "full", here: true } });
    const body = /** @type {any} */ (await r.json());
    assert.equal(r.status, 409, JSON.stringify(body));
    assert.equal(body.loopbackTaken, true);
    assert.match(body.error, new RegExp(`^No browser on this computer is paired now: \\[::1\\]:${port} is another program's, where a browser on this computer may reach Filament's own name: no browser here is paired until that program lets go of it, or Filament listens at another port \\(server\\.port\\)\\.$`));
    // A code for another machine is made: its browser reaches this one by its network address, not this name.
    const far = await shim.api("/api/remote/pair", { method: "POST", body: { scope: "view" } });
    assert.equal(far.status, 200);
    const st = /** @type {any} */ (await (await shim.api("/api/state")).json());
    assert.match(String(st.loopbackTaken), new RegExp(`^\\[::1\\]:${port} is another program's`));
    const report = /** @type {any} */ (await runDoctor({ dataDir: shim.dataDir, agentFilter: "no-such-agent" }));
    const line = report.sections.flatMap((/** @type {any} */ s) => s.items).find((/** @type {any} */ i) => /other loopback address/.test(i.what));
    assert.ok(line, "doctor says it");
    assert.equal(line.level, "warn");
    assert.match(line.fix, /server\.port/);
  } finally {
    await shim?.stop();
    await new Promise((r) => squatter.close(() => r(undefined)));
  }
});

/**
 * A POST at an address and port, with the Host and Origin given. @param {number} port @param {string} path @param {string} at @param {any} body
 * @returns {Promise<{ status: number, body: string }>}
 */
const postAt = (port, path, at, body) =>
  new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path, method: "POST", agent: false, headers: { host: at, origin: `http://${at}`, "content-type": "application/json", "content-length": Buffer.byteLength(text) } }, (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: Number(res.statusCode), body: b }));
    });
    req.on("error", reject);
    req.end(text);
  });

// (fails before: yes — x51, the hunt on x40: a browser here paired before another program took [::1] at Filament's port
// kept its pairing, and its cookie, sent to that program at Filament's name, opened Filament)
test("a browser here paired before another program takes [::1] at Filament's port is let go as Filament starts", { skip: !v6 && "this system has no IPv6 loopback" }, async () => {
  let shim = await startApp({ keep: true });
  const { port, dataDir } = shim;
  /** @type {net.Server | null} */
  let squatter = null;
  try {
    const own = `${JSON.parse(readFileSync(join(dataDir, "machine.json"), "utf8")).page}.localhost`;
    const made = /** @type {any} */ (await (await shim.api("/api/remote/pair", { method: "POST", body: { scope: "full", here: true } })).json());
    const claimed = await postAt(port, "/api/remote/claim", `${own}:${port}`, { code: made.code, name: "Browser here" });
    assert.equal(claimed.status, 200, claimed.body);
    const id = String(JSON.parse(claimed.body).device.id);
    await shim.stop();
    const taker = net.createServer((s) => s.end("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nno"));
    squatter = taker;
    await new Promise((resolve) => taker.listen(port, "::1", () => resolve(undefined)));
    shim = await startApp({ dataDir, keep: true, configure: (c) => void (c.server.port = port), overrides: { port } });
    // A connection of its own: fetch's pool still holds one to the Filament stopped above, at the same port.
    const { devices } = JSON.parse((await get("127.0.0.1", port, "/api/remote/devices")).body);
    const was = devices.find((/** @type {any} */ d) => d.id === id);
    assert.ok(was?.revokedAt, `its pairing let go: ${JSON.stringify(was)}`);
  } finally {
    await shim.stop();
    if (squatter) {
      const s = squatter;
      await new Promise((r) => s.close(() => r(undefined)));
    }
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// (fails before: yes — x51: a code for a browser here was decided as soon as it was asked, and the desktop app asks once
// /api/state answers, before Filament knows whether [::1] at its port is another program's)
test("a code for a browser here waits until Filament knows whose [::1] at its port is; doctor names a loopback host it cannot hold", async () => {
  const remote = readFileSync(new URL("../src/http/admin/remote.js", import.meta.url), "utf8");
  assert.match(remote, /if \(here\) await a\.loopbackSettled\?\.\(\);\n\s+const taken = here \? String\(a\.loopbackTaken\?\.\(\) \|\| ""\) : "";/);
  assert.match(readFileSync(new URL("../src/server.js", import.meta.url), "utf8"), /const twinUp = holdTwin\(boundAt\.address, port\);\n\s+twinSettled = twinUp;/);
  const dataDir = mkdtempSync(join(tmpdir(), "filament-twin-doctor-"));
  try {
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ server: { host: "127.0.0.2", port: 1 } }));
    const report = /** @type {any} */ (await runDoctor({ dataDir, agentFilter: "no-such-agent" }));
    const line = report.sections.flatMap((/** @type {any} */ s) => s.items).find((/** @type {any} */ i) => /server\.host is 127\.0\.0\.2/.test(i.what));
    assert.ok(line, "doctor says it");
    assert.equal(line.level, "warn");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
