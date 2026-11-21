// @ts-check
// Reach this machine on my network (the owner's remote Filament of 11-06, Part 2 — the first route): an https listener
// on a port of its own, on every address of this machine, beside the loopback listener, which stays as it is. Its
// certificate is self-signed (core/x509.js), made the first time it is turned on and kept in <dataDir>/lan-tls/ — the
// key readable by this user alone — so its fingerprint stays the same for every device that pinned it, until it is
// renewed a month before its 825 days run out. A browser shows its warning once; the person compares the fingerprint
// it shows with the one Settings › Remote access shows here, and pairs. Over it, Filament's pages, its API, its event
// stream and its sockets answer the devices paired with this machine (and the pairing page anyone); the model
// endpoints, MCP, an app's hooks and an artifact's address answer on this machine alone, so turning it on opens no
// door for a coding agent's folder or an inbound key (front-door.js `lanDoor`; turn.js `exposedListener` reads only
// server.host).
import https from "node:https";
import { execFile, spawnSync } from "node:child_process";
import { X509Certificate, createPrivateKey, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import { selfSigned } from "../core/x509.js";

/** The folder in the data folder its key and certificate are kept in. */
export const LAN_DIR = "lan-tls";
/** The port it listens on unless server.lan.port says another: neither listener's port (20300 installed, 20301 a checkout's), and https's 443 in its last digits. */
export const LAN_PORT = 20343;
/** The highest port server.lan.port names: the artifacts' network address listens at the one after it (http/artifacts.js `artifactsPort`). */
export const LAN_PORT_MAX = 65534;

/**
 * The port server.lan asks the listener for, read here alone — by the listener, by its artifacts' (http/artifacts.js
 * `artifactsPort`) and by config/store.js `validateConfig` — so they never say two: an integer from 0 (any free one) to
 * LAN_PORT_MAX; else, as only a config.json edited by hand holds, LAN_PORT.
 * @param {{ port?: unknown } | undefined} lan  server.lan
 */
export const lanPortOf = (lan) => {
  const p = lan?.port;
  return typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= LAN_PORT_MAX ? p : LAN_PORT;
};
/** A certificate is made anew this long before it runs out. */
const RENEW_MS = 30 * 86_400_000;

/** 100.64.0.0/10: a tailnet's addresses (and a carrier's NAT), never the network the person's machines share. @param {string} ip */
const tailnet = (ip) => {
  const [a, b] = ip.split(".").map(Number);
  return a === 100 && b >= 64 && b < 128;
};

/**
 * A network this machine makes for its own virtual machines and containers — Hyper-V's Default Switch, its NAT and its
 * containers' (HNS), WSL's, Docker's (DockerNAT, docker0, a network's br-<12 hex>, a container's veth), VirtualBox,
 * VMware, libvirt, LXC, Podman — which no other machine on the person's network is on. By the adapter's name. A Hyper-V
 * External switch's adapter (vEthernet (<the name it was given>)) and a bridge of the machine's own (br-lan, br0) carry
 * its address on the network itself: kept.
 */
const VIRTUAL = /^(vethernet \((default switch|wsl\b|nat\)|docker|hns internal)|virtualbox|vboxnet|vmware|vmnet|docker|br-[0-9a-f]{12}$|virbr|veth(?!ernet)|lxcbr|lxdbr|podman|cni)/i;

/**
 * This machine's addresses on its networks: IPv4, none of its own loopback, none a network gave no address
 * (169.254.x.x), none of a tailnet's — Tailscale shares Filament its own way — and none of a network for its own
 * virtual machines (`VIRTUAL`).
 * @param {NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>} [nets]
 */
export const lanIps = (nets = networkInterfaces()) =>
  Object.entries(nets)
    .filter(([name]) => !VIRTUAL.test(name))
    .flatMap(([, list]) => list || [])
    .filter((n) => !n.internal && n.family === "IPv4" && !n.address.startsWith("169.254.") && !tailnet(n.address))
    .map((n) => n.address);

/**
 * Whether a Linux kernel and WSL's networking mode say this is WSL 2 behind its NAT, where its addresses open from the
 * Windows computer it runs in alone: WSL 2's kernel names itself microsoft-standard (WSL 1's, which shares Windows's
 * network, does not), and `wslinfo --networking-mode` says nat, or nothing on a WSL too old to have another mode.
 * Mirrored and bridged networking put it on the network itself.
 * @param {string} release  /proc/sys/kernel/osrelease @param {string | null} mode  wslinfo's answer; null where it gave none
 */
export const wslNat = (release, mode) => /microsoft-standard/i.test(release) && !/^(mirrored|bridged)$/i.test(String(mode ?? "").trim());

/** This machine as `wslNat` reads it, once: false off Linux. @type {boolean | null} */
let natRead = null;
/** Whether this machine is WSL 2 behind its NAT (`wslNat`), read once. */
export const behindWslNat = () => {
  if (natRead !== null) return natRead;
  let release = "";
  try {
    if (process.platform === "linux") release = readFileSync("/proc/sys/kernel/osrelease", "utf8");
  } catch {}
  if (!/microsoft-standard/i.test(release)) return (natRead = false);
  const r = spawnSync("wslinfo", ["--networking-mode"], { encoding: "utf8", timeout: 3000 });
  return (natRead = wslNat(release, r.status === 0 ? String(r.stdout) : null));
};

/** Said beside the network's addresses where this is WSL 2 behind its NAT (`behindWslNat`). */
export const WSL_NAT_WORDS =
  "Filament runs in WSL behind its NAT: these addresses open from this Windows computer alone, never from another machine on your network. For those, turn on WSL's mirrored networking (networkingMode=mirrored under [wsl2] in .wslconfig, in your Windows user folder, then wsl --shutdown), or share Filament on your tailnet.";

/** Where another machine on the network opens Filament: one https address for each of this machine's. @param {number} port @param {NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>} [nets] */
export const lanAddresses = (port, nets) => lanIps(nets).map((ip) => `https://${ip}:${port}`);

/** A host name a certificate may carry: letters, digits and hyphens in dotted labels. @param {string} s */
const hostNameOk = (s) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(s);

/**
 * The names the certificate gives this machine beside localhost: its host name and that name on the local network
 * (.local) — the Host a browser that opens it by name sends (guards.js `hostAllowed`). None where the name is none a
 * certificate may carry.
 * @param {string} [h]
 */
export const lanNames = (h = hostname()) => {
  const n = String(h || "").toLowerCase();
  return hostNameOk(n) ? [n, `${n}.local`] : [];
};

/**
 * The listener's key and certificate: those kept, while they read, belong together and have more than a month left;
 * else a new pair, made and kept (`made`). Its names are this machine's — localhost, its host name and that name on
 * the local network (.local) — and its addresses as they are now: a browser that opens it by another address warns of
 * the name too, and a pinning client never reads names. An address that moves makes none anew: every device pinned the
 * certificate's whole fingerprint (cli/pinned.js), and a browser warns of a self-signed one whatever its names.
 * @param {string} dataDir
 * @param {{ name?: string, now?: number, nets?: NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>, host?: () => string }} [o]  `name`: this machine's, as the certificate says it
 * @returns {{ key: string, cert: string, fingerprint: string, notAfter: number, made: boolean }}
 */
export function lanIdentity(dataDir, { name = hostname(), now = Date.now(), nets, host = hostname } = {}) {
  const dir = join(dataDir, LAN_DIR);
  const keyFile = join(dir, "key.pem");
  const certFile = join(dir, "cert.pem");
  try {
    const key = readFileSync(keyFile, "utf8");
    const cert = readFileSync(certFile, "utf8");
    const x = new X509Certificate(cert);
    const notAfter = Date.parse(x.validTo);
    if (notAfter - now > RENEW_MS && x.checkPrivateKey(createPrivateKey(key))) return { key, cert, fingerprint: x.fingerprint256, notAfter, made: false };
  } catch (/** @type {any} */ e) {
    // Kept, but not read this time (another program holds it, its rights changed): a new pair would change the
    // fingerprint every device pinned, so it is said instead. Missing, or not a pair that belongs: made anew.
    if (e?.syscall && e.code !== "ENOENT") throw e;
  }
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const { pem } = selfSigned({ privateKey, publicKey, name: `Filament on ${name}`, dns: ["localhost", ...lanNames(host())], ips: ["127.0.0.1", ...lanIps(nets)], now });
  const key = /** @type {string} */ (privateKey.export({ type: "pkcs8", format: "pem" }));
  mkdirSync(dir, { recursive: true });
  for (const [file, text] of [[keyFile, key], [certFile, pem]]) {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, file);
    try {
      chmodSync(file, 0o600);
    } catch {}
  }
  const x = new X509Certificate(pem);
  return { key, cert: pem, fingerprint: x.fingerprint256, notAfter: Date.parse(x.validTo), made: true };
}

/** What a listen that failed says, in words. @param {any} e @param {number} port */
const listenWords = (e, port) =>
  e?.code === "EADDRINUSE"
    ? `port ${port} is in use by another program: choose another port`
    : e?.code === "EACCES"
      ? `this user may not listen on port ${port}: choose one above 1024`
      : `it could not listen on port ${port}: ${e?.message || e}`;

/**
 * @typedef {{ on: boolean, port: number, listening: { port: number } | null, error: string | null, fingerprint: string | null, notAfter: number | null, addresses: string[], hostOnly: string | null }} LanState
 *   `on`: asked for (server.lan.enabled); `listening`: where it listens now; `error`: why it does not, while it is asked for;
 *   `hostOnly`: while it listens, where its addresses open from this computer alone, why (WSL_NAT_WORDS)
 */

/**
 * The listener, turned on, moved and off as server.lan says (`apply`), one change after another.
 * @param {object} o
 * @param {string} o.dataDir
 * @param {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => unknown} o.handler  the front door, behind
 *   the network's door (front-door.js `lanDoor`)
 * @param {(req: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => unknown} o.upgrade  the sockets it answers
 * @param {() => string} [o.name]  this machine's name, for a certificate made
 * @param {(level: string, msg: string) => void} [o.log]
 * @param {() => NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>} [o.nets]
 * @param {string} [o.host]  the address it listens on: every one of this machine's (tests: loopback)
 * @param {(lan: { enabled?: boolean, port?: number } | undefined) => number} [o.portOf]  the port server.lan gives it:
 *   the network listener's (`lanPortOf`); the artifacts', the one after it (http/artifacts.js `artifactsPort`)
 * @param {() => boolean} [o.hostOnly]  whether its addresses open from this computer alone (`behindWslNat`)
 */
export function createLanListener({ dataDir, handler, upgrade, name = () => hostname(), log = () => {}, nets = () => networkInterfaces(), host = "0.0.0.0", portOf = lanPortOf, hostOnly = behindWslNat }) {
  /** @type {https.Server | null} */
  let server = null;
  /** @type {{ port: number } | null} */
  let at = null;
  /** @type {string | null} */
  let error = null;
  /** @type {ReturnType<typeof lanIdentity> | null} */
  let identity = null;
  let want = { enabled: false, port: portOf(undefined) };
  /** Every connection it holds, a socket upgraded included: turned off, none stays open. @type {Set<import("node:stream").Duplex>} */
  const held = new Set();
  /** @type {Promise<void>} */
  let chain = Promise.resolve();
  /** Closed as Filament stops: a config change after that turns it on no more (the review of p2-lan). */
  let closed = false;
  /** One change after the one before it; one that throws is said, and the next still runs. @param {() => Promise<unknown>} step */
  const then = (step) =>
    (chain = chain.then(step).then(
      () => {},
      (/** @type {any} */ e) => {
        error = `it could not change: ${e?.message || e}`;
        log("warn", `remote: the network listener: ${e?.message || e}`);
      },
    ));

  const stop = () =>
    new Promise((resolve) => {
      const s = server;
      server = null;
      at = null;
      if (!s) return resolve(undefined);
      s.close(() => resolve(undefined));
      for (const c of held) c.destroy();
      held.clear();
    });
  /** @param {number} port */
  const start = (port) =>
    new Promise((resolve) => {
      try {
        identity = lanIdentity(dataDir, { name: name(), nets: nets() });
        if (identity.made) log("info", `remote: a certificate for this machine on the network was made — its fingerprint ${identity.fingerprint}`);
      } catch (/** @type {any} */ e) {
        error = `its certificate could not be read or made: ${e?.message || e}`;
        return resolve(undefined);
      }
      // A handshake no one finishes holds a connection no longer than this (Node's own wait is two minutes).
      const s = https.createServer({ key: identity.key, cert: identity.cert, minVersion: "TLSv1.2", handshakeTimeout: 15_000 }, handler);
      s.on("connection", (c) => {
        held.add(c);
        c.once("close", () => held.delete(c));
      });
      s.on("upgrade", upgrade);
      // A browser that has not taken the certificate yet hangs up in the handshake: nothing to say.
      s.on("tlsClientError", () => {});
      s.once("error", (e) => {
        error = listenWords(e, port);
        resolve(undefined);
      });
      s.listen(port, host, () => {
        s.removeAllListeners("error");
        s.on("error", (e) => log("warn", `remote: the network listener: ${e?.message || e}`));
        server = s;
        at = { port: /** @type {import("node:net").AddressInfo} */ (s.address()).port };
        error = null;
        log("info", `remote: reached on the network at ${lanAddresses(at.port, nets()).join(", ") || `port ${at.port} (no network address yet)`}`);
        resolve(undefined);
      });
    });

  return {
    /**
     * Listen as `lan` says: on, on its port (`portOf`; 0: any free one); off. A change waits for the one before it.
     * @param {{ enabled?: boolean, port?: number } | undefined} lan  server.lan
     */
    apply(lan) {
      if (closed) return chain;
      want = { enabled: lan?.enabled === true, port: portOf(lan) };
      return then(async () => {
        const w = want;
        if (!w.enabled || closed) {
          if (server) log("info", "remote: no longer reached on the network");
          error = null;
          return void (await stop());
        }
        if (server && at && (w.port === 0 || at.port === w.port)) return;
        await stop();
        await start(w.port);
      });
    },
    /** @returns {LanState} */
    state: () => ({ on: want.enabled, port: at?.port ?? want.port, listening: at, error: want.enabled ? error : null, fingerprint: identity?.fingerprint ?? null, notAfter: identity?.notAfter ?? null, addresses: at ? lanAddresses(at.port, nets()) : [], hostOnly: at && hostOnly() ? WSL_NAT_WORDS : null }),
    /** The port it listens on now, or null: read for every request of the agent's browser, so it reads no network. */
    port: () => at?.port ?? null,
    /** Once the changes asked for so far are made: a read after a save says what the save did. */
    settled: () => chain,
    /** Off for good, as Filament stops. */
    close() {
      closed = true;
      want = { ...want, enabled: false };
      return then(stop);
    },
  };
}

/** The Windows Firewall rule Filament makes for its port, by its name. */
export const FIREWALL_RULE = "Filament on the network";

/**
 * Runs a PowerShell script and answers its output; throws with its first line of words where it fails. Injected in
 * tests. @typedef {(script: string) => Promise<string>} PowerShell
 */
/** @param {string} script @param {number} [timeout]  a read's 20 s; the rule's two minutes, for the person to answer Windows */
const powershell = (script, timeout = 20_000) =>
  new Promise((resolve, reject) =>
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, timeout }, (e, out, err) =>
      e ? reject(new Error(String(err || e.message).trim().split(/\r?\n/)[0])) : resolve(String(out)),
    ),
  );
/** @type {PowerShell} */
const elevated = (script) => powershell(script, 120_000);
/**
 * A string inside a PowerShell script's single quotes. PowerShell takes the curly ones (‘ ’ ‚ ‛) as quotes too: each is
 * doubled, as `'` is (the review of p2-lan).
 * @param {string} s
 */
export const quoted = (s) => `'${String(s).replace(/['‘’‚‛]/g, (q) => q + q)}'`;

/**
 * What Windows Firewall says of this program and the port, read with no elevation: the category of each network this
 * machine is on, the ports Filament's own rule opens, and the inbound rules on this program — Windows makes them when
 * it asks whether a program may use the network: Allow, or Block where the person said no.
 * @typedef {{ networks: string[], ownPorts: string[], app: { action: string, profile: string }[] }} FirewallRead
 * @param {{ exe?: string, run?: PowerShell }} [o]
 * @returns {Promise<FirewallRead>}
 */
export async function readFirewall({ exe = process.execPath, run = powershell } = {}) {
  const out = await run(
    [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "$networks = @(Get-NetConnectionProfile | ForEach-Object { [string]$_.NetworkCategory })",
      `$own = @(Get-NetFirewallRule -DisplayName ${quoted(FIREWALL_RULE)} | Where-Object { [string]$_.Enabled -eq 'True' } | Get-NetFirewallPortFilter | ForEach-Object { [string]$_.LocalPort })`,
      `$app = @(Get-NetFirewallApplicationFilter -Program ${quoted(exe)} | Get-NetFirewallRule | Where-Object { [string]$_.Enabled -eq 'True' -and [string]$_.Direction -eq 'Inbound' } | ForEach-Object { @{ action = [string]$_.Action; profile = [string]$_.Profile } })`,
      "@{ networks = $networks; ownPorts = $own; app = $app } | ConvertTo-Json -Compress -Depth 4",
    ].join("\n"),
  );
  const j = JSON.parse(out.trim() || "{}");
  /** @param {any} v @returns {any[]} */
  const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  return { networks: list(j.networks).map(String), ownPorts: list(j.ownPorts).map(String), app: list(j.app).map((a) => ({ action: String(a?.action || ""), profile: String(a?.profile || "") })) };
}

/** A rule's profiles ("Private, Public", "Any") cover a network of this category ("Private", "DomainAuthenticated"). @param {string} profile @param {string} network */
const covers = (profile, network) => /\bany\b/i.test(profile) || profile.toLowerCase().split(/,\s*/).includes(network.toLowerCase().replace(/authenticated$/, ""));

/** Ports in words: "port 20343", "ports 20343 and 20344". @param {readonly number[]} ports */
const portWords = (ports) => (ports.length === 1 ? `port ${ports[0]}` : `ports ${ports.slice(0, -1).join(", ")} and ${ports.at(-1)}`);

/**
 * Whether another machine on the network gets through Windows Firewall to the ports — the listener's, and its
 * artifacts' (http/artifacts.js) —, in words, and whether Allow here would let it (`fix`), network by network: on a
 * network, a rule that blocks this program wins over any that allows, and Filament's rule opens it only where it names
 * every port and Windows calls it Private or Domain. One network let in, its machines reach Filament; none, Allow
 * (`allowThroughFirewall`) is offered only where what it leaves opens one: a block on a Public network alone it neither
 * turns off nor opens past.
 * @param {FirewallRead} f @param {number | readonly number[]} port
 * @returns {{ open: boolean, fix: boolean, words: string }}
 */
export function firewallVerdict(f, port) {
  const ports = Array.isArray(port) ? [...port] : [/** @type {number} */ (port)];
  const networks = f.networks.length ? f.networks : ["Public"];
  // A rule of several ports says them in one, "20343 20344" or "20343,20344".
  const opened = f.ownPorts.flatMap((p) => String(p).split(/[\s,]+/)).filter(Boolean);
  const ruleOpens = opened.some((p) => /^any$/i.test(p)) || ports.every((n) => opened.includes(String(n)));
  /** @param {FirewallRead["app"]} app @param {string} action @param {string} n */
  const ruled = (app, action, n) => app.some((a) => a.action.toLowerCase() === action && covers(a.profile, n));
  /** Whether a network of this kind lets another machine in, under these rules on this program and Filament's rule or none. @param {FirewallRead["app"]} app @param {boolean} rule @param {string} n */
  const lets = (app, rule, n) => !ruled(app, "block", n) && (ruled(app, "allow", n) || (rule && !/^public$/i.test(n)));
  // What Allow leaves: Filament's rule, and none of the blocks on this program whose profiles name Any, Private or Domain.
  const left = f.app.filter((a) => !(/^block$/i.test(a.action) && /any|private|domain/i.test(a.profile)));
  if (networks.some((n) => lets(f.app, ruleOpens, n))) return { open: true, fix: false, words: `Windows Firewall lets the machines on this network reach ${portWords(ports)}.` };
  const fixes = networks.filter((n) => lets(left, true, n));
  if (fixes.some((n) => ruled(f.app, "block", n)))
    return { open: false, fix: true, words: "Windows Firewall blocks Filament on this network: someone said no when Windows asked whether it may use the network. Allow it here — Windows asks you to confirm — and that block is turned off." };
  if (fixes.length)
    return { open: false, fix: true, words: `Windows Firewall lets no other machine reach ${portWords(ports)} yet. Allow it here — Windows asks you to confirm — and a rule opens ${ports.length === 1 ? "the port" : "the ports"} to your Private network alone; or answer Allow when Windows asks.` };
  // Shut, and Allow opens none: every one of them is Public (Allow opens every Private and Domain network).
  return { open: false, fix: false, words: `Windows calls this network Public, so it lets no other machine reach ${portWords(ports)}. If it is your home or office network, make it Private (Windows Settings › Network & internet › your network › Private network), then allow Filament here.` };
}

/**
 * Filament's rule for the ports, made with elevation — Windows asks the person to confirm (UAC): TCP in on `port` and
 * `also` (the artifacts' address), on
 * Private and Domain networks, from the local subnet alone. A rule of the same name goes first, and the inbound rules
 * that block this program on a Private or Domain network are turned off, not removed. Throws in words where the
 * person said no.
 * @param {{ port: number, also?: readonly number[], exe?: string, run?: PowerShell }} o
 */
export async function allowThroughFirewall({ port, also = [], exe = process.execPath, run = elevated }) {
  const ports = [...new Set([port, ...also])];
  for (const p of ports) if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`no port to open: ${p}`);
  const inner = [
    "$ErrorActionPreference = 'Stop'",
    `Get-NetFirewallRule -DisplayName ${quoted(FIREWALL_RULE)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,
    `New-NetFirewallRule -DisplayName ${quoted(FIREWALL_RULE)} -Description ${quoted("Filament's https listener, for the devices paired with it (Settings › Remote access)")} -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${ports.join(",")} -Profile Private,Domain -RemoteAddress LocalSubnet | Out-Null`,
    `Get-NetFirewallApplicationFilter -Program ${quoted(exe)} -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { [string]$_.Direction -eq 'Inbound' -and [string]$_.Action -eq 'Block' -and [string]$_.Enabled -eq 'True' -and [string]$_.Profile -match 'Any|Private|Domain' } | Disable-NetFirewallRule`,
  ].join("\n");
  const encoded = Buffer.from(inner, "utf16le").toString("base64");
  try {
    await run(`$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'\nexit $p.ExitCode`);
  } catch (/** @type {any} */ e) {
    throw new Error(/cancel/i.test(String(e?.message)) ? "Windows asked to confirm, and was told no: nothing changed" : `the rule could not be made: ${e?.message || e}`);
  }
}
