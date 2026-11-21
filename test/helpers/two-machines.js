// @ts-check
// Two Filaments on one machine, for the tests of Filament's agents on every paired machine: each in a data folder of its
// own, at ports of its own, a machine of its own name and id, its network listener on loopback with a certificate of its
// own (services/lan-tls.js). `here` pairs with `there` the way `filament connect` does — a code started on `there`, its
// link carrying the certificate's fingerprint, claimed over https pinned to it (services/machines/remotes.js `connectTo`)
// — and keeps the device token in its own remotes.json, sealed, where its own machines store (services/machines) and its
// command line find it. Between them stands the network: a relay on loopback to each listener whose
// connections come from FAR_ADDRESS, never 127.0.0.1, so each takes the other's calls as another machine's — a paired
// device by its token, or nobody — and never as this computer's (guards.js `isLocalCaller`), which it trusts as you.
import net from "node:net";
import { existsSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { startApp } from "./app.js";
import { connectTo } from "../../src/services/machines/remotes.js";
import { pinnedFetch } from "../../src/services/machines/pinned.js";
import { pairLinks } from "../../src/http/admin/remote.js";

/**
 * Where the other machine's connections come from: an address of loopback's own range that is not 127.0.0.1 (guards.js
 * `isLoopback` names 127.0.0.1 and ::1 alone). Windows and Linux answer the whole 127.0.0.0/8 on loopback; macOS
 * answers 127.0.0.1 alone until it is given another (`farUsable`).
 */
export const FAR_ADDRESS = "127.0.0.2";

/** @type {Promise<boolean> | null} */
let farChecked = null;
/** Whether a connection can come from FAR_ADDRESS here, asked once. */
const farUsable = () =>
  (farChecked ??= new Promise((resolve) => {
    const s = net.createServer((c) => c.destroy());
    s.listen(0, "127.0.0.1", () => {
      const c = net.connect({ host: "127.0.0.1", port: /** @type {net.AddressInfo} */ (s.address()).port, localAddress: FAR_ADDRESS });
      /** @param {boolean} ok */
      const done = (ok) => {
        c.destroy();
        s.close();
        resolve(ok);
      };
      c.once("connect", () => done(true));
      c.once("error", () => done(false));
    });
  }));

/**
 * The network to a listener on loopback: each connection taken at a port of its own on 127.0.0.1 is handed on, byte for
 * byte, from FAR_ADDRESS — the TLS is the listener's own, end to end, so its certificate is the one a pin reads.
 * @param {number} port  the listener's
 */
async function relayTo(port) {
  /** @type {Set<net.Socket>} */
  const held = new Set();
  const server = net.createServer((inbound) => {
    const out = net.connect({ host: "127.0.0.1", port, localAddress: FAR_ADDRESS });
    for (const s of [inbound, out]) held.add(s);
    const end = () => {
      for (const s of [inbound, out]) {
        s.destroy();
        held.delete(s);
      }
    };
    for (const s of [inbound, out]) s.once("error", end).once("close", end);
    inbound.pipe(out).pipe(inbound);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  return {
    port: /** @type {net.AddressInfo} */ (server.address()).port,
    close: () =>
      new Promise((r) => {
        server.close(() => r(undefined));
        for (const s of held) s.destroy();
        held.clear();
      }),
  };
}

/** @typedef {NonNullable<Parameters<typeof startApp>[0]> & { name?: string }} MachineOptions  startApp's, and the machine's name */

/**
 * @typedef {Awaited<ReturnType<typeof startApp>> & {
 *   machine: { id: string, name: string },
 *   lan: { port: number, fingerprint: string },
 *   far: string,
 * }} Machine
 *   `machine`: its id and name, as /.well-known/filament says them; `lan`: its network listener, on loopback; `far`: the
 *   https address the other machine reaches it at, through the network between them
 */

/**
 * One Filament as a machine of its own: startApp's, with server.lan on at any free port (a test's `configure` runs after,
 * and may say otherwise), the listener on loopback alone, and `name` kept in its machine.json, made before it starts —
 * left as it is where `dataDir` brings one back.
 * @param {MachineOptions} o
 * @returns {Promise<Machine>}
 */
async function startMachine({ name = "A machine", configure = () => {}, overrides = {}, ...rest }) {
  const app = await startApp({
    ...rest,
    configure: (cfg, ctx) => {
      cfg.server.lan = { enabled: true, port: 0 };
      const file = join(ctx.dataDir, "machine.json");
      if (!existsSync(file)) writeFileSync(file, JSON.stringify({ version: 1, id: randomUUID(), name }));
      configure(cfg, ctx);
    },
    // Loopback alone: on every address, a test's Filament would be open to the network, and Windows Firewall would ask.
    overrides: { lanHost: "127.0.0.1", ...overrides },
  });
  /** @type {{ close: () => Promise<unknown> } | null} */
  let relay = null;
  try {
    const lan = app.started.lan;
    if (!lan?.listening || !lan.fingerprint) throw new Error(`${name}: its network listener is not on (${lan?.error || "server.lan is off"})`);
    const machine = await (await fetch(`${app.url}/.well-known/filament`)).json();
    const r = await relayTo(lan.listening.port);
    relay = r;
    const stop = app.stop;
    return Object.assign(app, {
      machine: { id: String(machine.id), name: String(machine.name) },
      lan: { port: lan.listening.port, fingerprint: lan.fingerprint },
      far: `https://127.0.0.1:${r.port}`,
      async stop() {
        await r.close();
        await stop();
      },
    });
  } catch (e) {
    await relay?.close();
    await app.stop();
    throw e;
  }
}

/**
 * `from` pairs with `to`: a code started on `to` by its own computer, its link — `to`'s address on the network, the code
 * and its certificate's fingerprint, as Settings › Remote access shows it — claimed by `from` over https pinned to it,
 * and the device token kept in `from`'s remotes.json, sealed. `name`: the device's, else `from`'s machine name.
 * @param {Machine} from @param {Machine} to
 * @param {{ scope?: "full" | "view", name?: string }} [o]
 */
export async function pairMachines(from, to, { scope = "full", name = from.machine.name } = {}) {
  const r = await to.api("/api/remote/pair", { method: "POST", body: { scope } });
  const open = await r.json();
  if (r.status !== 200) throw new Error(`${to.machine.name} started no pairing: HTTP ${r.status} ${JSON.stringify(open)}`);
  const [link] = pairLinks({ listening: { port: to.lan.port }, addresses: [to.far], fingerprint: open.fingerprint }, open.code);
  if (!link) throw new Error(`${to.machine.name} gave its pairing no certificate to pin`);
  const remote = await connectTo(from.dataDir, link, { name });
  const pinned = pinnedFetch(remote.fingerprint || "");
  return {
    link,
    /** The machine as `from` keeps it: its address, its fingerprint, the device and its token. */
    remote,
    /**
     * A request from `from` to `to` as the paired device: over the network, pinned, its token as a Bearer.
     * @param {string} path @param {RequestInit} [init]
     */
    ask: (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${remote.token}`);
      return pinned(`${remote.url}${path}`, { ...init, headers });
    },
  };
}

/**
 * Two Filaments on this machine, `here` paired with `there` (`scope`, full by default); `stop()` stops both and removes
 * their data folders. `here` and `there` take startApp's options for each and a machine name. One that fails to start
 * or pair stops what was started.
 * @param {{ here?: MachineOptions, there?: MachineOptions, scope?: "full" | "view" }} [o]
 */
export async function startTwoMachines({ here: hereOptions = {}, there: thereOptions = {}, scope = "full" } = {}) {
  if (!(await farUsable()))
    throw new Error(`no connection comes from ${FAR_ADDRESS} on this machine, so the other Filament's calls would come from 127.0.0.1, which Filament trusts as you: on macOS, \`sudo ifconfig lo0 alias ${FAR_ADDRESS} up\` gives loopback that address`);
  /** @type {Machine[]} */
  const up = [];
  const stopAll = async () => {
    /** @type {unknown[]} */
    const failed = [];
    for (const m of up.splice(0).reverse())
      await m.stop().catch((/** @type {unknown} */ e) => failed.push(e));
    if (failed.length) throw failed[0];
  };
  try {
    const here = await startMachine({ name: "Laptop", ...hereOptions });
    up.push(here);
    const there = await startMachine({ name: "Workstation", ...thereOptions });
    up.push(there);
    const pairing = await pairMachines(here, there, { scope });
    return { here, there, ...pairing, stop: stopAll };
  } catch (e) {
    await stopAll().catch(() => {});
    throw e;
  }
}
