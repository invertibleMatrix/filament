// @ts-check
// Share this Filament on my tailnet (the owner's remote Filament of 11-06, Part 2): `tailscale serve` gives this machine
// an https address on the person's tailnet — https://<machine>.<tailnet>.ts.net, its certificate one an authority signs
// — and hands each request on to a door of Filament's on loopback, at a port of its own (`server.tailscale.port`), below
// a path no one else knows (`mark`, new at each start, which tailscale serve's own config alone holds): what comes in
// there with it came through tailscale serve, which says who sent it (its Tailscale-User-* headers, which it alone sets,
// clearing any a caller sent), and by the name it was reached at, its Host, which a door checks — a page another site
// rebound to loopback is refused there, and so is a program here that names the tailnet without the mark, so its
// Tailscale-User-Login is no one's (`servedThrough`). Behind that door is the network's door (front-door.js
// `lanDoor`): Filament's pages, the pairing, the run socket and the terminal — never the model endpoints. The artifacts'
// network address is served too, at https port 8443, from a door of their own at the port after. Turned on, Filament
// asks Tailscale's command line to serve both, and never takes an https port the person serves something else on;
// turned off, it takes back its own alone. Every call to the command line is bounded: one that waits — on the tailnet's
// HTTPS or Serve, which it asks the person to turn on at an address it prints — is ended, and that address said. Filament
// stopping leaves the serve as it is, answering nothing until Filament is back, when it is asked for again; what it
// served is kept (`fileMemo`), so its own entries from before are known for its own. A share that could not start —
// Tailscale not yet running, as at logon — is asked again every `RETRY_MS`.
import http from "node:http";
import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { artifactsOnNetwork } from "../core/artifacts.js";

/** The loopback port tailscale serve hands Filament's pages to (server.tailscale.port); the artifacts' is the one after. */
export const TAILNET_PORT = 20345;
/** Its most: the artifacts' door takes the port after it. */
export const TAILNET_PORT_MAX = 65534;
/** The https ports on the tailnet: Filament's pages, and the artifacts' network address. */
export const SERVE_HTTPS = 443;
export const SERVE_ART_HTTPS = 8443;
/** How long a call to the command line may take: one that waits on the person is ended past it. */
export const CLI_MS = 15_000;
/** How long a read of Tailscale's state stands before a page's look reads it again. */
export const LOOK_MS = 5_000;
/** Where the person turns on HTTPS certificates for their tailnet. */
export const HTTPS_ADMIN = "https://login.tailscale.com/admin/dns";
/** Where Tailscale is installed from. */
export const DOWNLOAD = "https://tailscale.com/download";

/**
 * The port server.tailscale gives the door: a whole number from 0 (any free one) to `TAILNET_PORT_MAX`, else its
 * default. @param {{ port?: unknown } | undefined} ts  server.tailscale
 */
export const tailnetPortOf = (ts) => {
  const p = ts?.port;
  return typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= TAILNET_PORT_MAX ? p : TAILNET_PORT;
};

/**
 * Where Tailscale's command line may be, in the order they are tried: each folder on PATH, then where its installer
 * puts it on this platform. @param {string} platform @param {NodeJS.ProcessEnv} env
 */
export function cliPlaces(platform, env) {
  const P = platform === "win32" ? win32 : posix;
  const exe = platform === "win32" ? "tailscale.exe" : "tailscale";
  const onPath = String(env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":").map((d) => d.trim()).filter(Boolean).map((d) => P.join(d, exe));
  const own =
    platform === "win32"
      ? [P.join(env.ProgramFiles || "C:\\Program Files", "Tailscale", exe), P.join(env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Tailscale", exe)]
      : platform === "darwin"
        ? ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale"]
        : ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/usr/sbin/tailscale", "/snap/bin/tailscale"];
  return [...new Set([...onPath, ...own])];
}

/**
 * Tailscale's command line, where it is installed; null where it is not.
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean }} [o]
 */
export const findCli = ({ platform = process.platform, env = process.env, exists = existsSync } = {}) => cliPlaces(platform, env).find((p) => exists(p)) ?? null;

/**
 * The environment Tailscale's command line runs in: Filament's own, with SHLVL where it has neither SHLVL nor TERM. On a
 * Mac the command line is the app's own executable, which acts as one only where either says a shell started it; a
 * Filament the Finder started has neither, and there it starts the app instead, which fails ("The Tailscale GUI failed
 * to start") while Tailscale runs. @param {NodeJS.ProcessEnv} env
 */
const cliEnv = (env) => (env.SHLVL || env.TERM ? env : { ...env, SHLVL: "1" });

/**
 * @typedef {{ code: number | null, out: string, err: string, timedOut: boolean }} Ran  `code`: null where it did not run
 *   or was ended
 * @typedef {(file: string, args: string[], o: { timeoutMs: number }) => Promise<Ran>} Exec
 * @type {Exec}
 */
export const runCli = (file, args, { timeoutMs }) =>
  new Promise((resolve) => {
    execFile(file, args, { env: cliEnv(process.env), timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" }, (e, stdout, stderr) => {
      const x = /** @type {any} */ (e);
      resolve({ code: e ? (typeof x.code === "number" ? x.code : null) : 0, out: String(stdout || ""), err: String(stderr || x?.message || ""), timedOut: !!x?.killed });
    });
  });

/**
 * @typedef {{ name: string, dns: string, online: boolean, os: string, login: string }} Peer
 * @typedef {{ state: string, running: boolean, name: string, login: string, tailnet: string, https: boolean, ips: string[], peers: Peer[] }} Status
 */
/** A name as Tailscale's DNS says it: without its last dot, in lower case. @param {unknown} n */
const dnsOf = (n) => String(n || "").replace(/\.$/, "").toLowerCase();
/**
 * What `tailscale status --json` says: its state, and running, this machine's name on the tailnet, the login it is
 * signed in as, the tailnet's name, whether the tailnet gives certificates (its CertDomains), and the other machines.
 * @param {any} j @returns {Status}
 */
export function statusOf(j) {
  const self = j?.Self && typeof j.Self === "object" ? j.Self : {};
  const users = j?.User && typeof j.User === "object" ? j.User : {};
  const loginOf = (/** @type {unknown} */ id) => String(users[String(id)]?.LoginName || "");
  return {
    state: String(j?.BackendState || ""),
    running: j?.BackendState === "Running",
    name: dnsOf(self.DNSName),
    login: loginOf(self.UserID),
    tailnet: String(j?.CurrentTailnet?.Name || ""),
    https: Array.isArray(j?.CertDomains) && j.CertDomains.length > 0,
    ips: Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs.map(String) : [],
    peers: Object.values(j?.Peer && typeof j.Peer === "object" ? j.Peer : {})
      .filter((p) => p && typeof p === "object" && dnsOf(p.DNSName))
      .map((p) => ({ name: String(p.HostName || ""), dns: dnsOf(p.DNSName), online: p.Online === true, os: String(p.OS || ""), login: loginOf(p.UserID) })),
  };
}

/**
 * What `tailscale serve status --json` serves at an https port of this machine's name: none, Filament's (one handler,
 * at /, to `target`), or something else — the person's, which Filament leaves as it is (`what` says it).
 * @param {any} cfg @param {string} name @param {number} port @param {string} target
 * @returns {{ is: "none" } | { is: "mine", funnel: boolean } | { is: "other", what: string }}
 */
export function servedAt(cfg, name, port, target) {
  const tcp = cfg?.TCP?.[String(port)];
  if (!tcp || typeof tcp !== "object") return { is: "none" };
  const handlers = cfg?.Web?.[`${name}:${port}`]?.Handlers;
  const paths = handlers && typeof handlers === "object" ? Object.keys(handlers) : [];
  if (tcp.HTTPS === true && paths.length === 1 && paths[0] === "/" && handlers["/"]?.Proxy === target) return { is: "mine", funnel: cfg?.AllowFunnel?.[`${name}:${port}`] === true };
  const what = tcp.TCPForward ? `a TCP forward to ${tcp.TCPForward}` : paths.map((p) => `${p} → ${handlers[p]?.Proxy || handlers[p]?.Path || (handlers[p]?.Text != null ? "text" : "something")}`).join(", ") || "something";
  return { is: "other", what };
}

/** The first of Tailscale's own addresses a command said — where it asks the person to turn something on. @param {string} text */
export const askedAt = (text) => /https:\/\/login\.tailscale\.com\/[^\s"'<>]+/.exec(String(text))?.[0] ?? null;

/** Tailscale's states (`status --json`'s BackendState), in words. */
const STATE_WORDS = /** @type {Record<string, string>} */ ({
  NoState: "not running",
  NeedsLogin: "signed out",
  NeedsMachineAuth: "waiting for your tailnet's admin to approve this machine",
  Stopped: "turned off",
  Starting: "starting",
  Running: "connected",
  InUseOtherUser: "in use by another of this computer's users",
});
/** Tailscale's state in words; one this does not know, split into words. @param {string} state */
export const stateWords = (state) =>
  Object.hasOwn(STATE_WORDS, state) ? STATE_WORDS[state] : state ? state.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() : "not running";

/** A command's first line of what it said, for a sentence. @param {Ran} r */
const firstLine = (r) => (r.err || r.out).split(/\r?\n/).map((l) => l.trim()).find(Boolean) || `exit ${r.code}`;

/**
 * The tailnet's door as it is served now, for the guards (http/guards.js): its loopback port and the artifacts' door's
 * (`artDoor`), this machine's name on the tailnet, the login Tailscale here is signed in as, and the https port the
 * artifacts are served at there (`artPort`, null until they are); null while Filament is served on no tailnet.
 * @type {{ port: number, artDoor: number, name: string, login: string, artPort: number | null } | null}
 */
let door = null;
/** The tailnet's door as it is served now (`door`). */
export const tailnetDoor = () => door;

/**
 * @typedef {{ on: boolean, trustOwnLogin: boolean, installed: boolean | null, state: string, stateSaid: string, running: boolean,
 *   name: string, login: string, tailnet: string, https: boolean, listening: { port: number, artPort: number | null } | null,
 *   address: string | null, artifacts: string | null, funnel: boolean, error: string | null, enable: string | null,
 *   unread: string | null }} TailnetState  `stateSaid`: its state in words; `enable`: where Tailscale asked the person to
 *   turn something on; `unread`: why Tailscale could not be read at a page's last look
 */

/**
 * Where Filament keeps what it served on the tailnet — the loopback targets tailscale serve hands 443 and 8443 to —, so
 * an entry of its own from an earlier run, at a port since changed or any free one (port 0), is known for its own:
 * served over and taken back, never said to be the person's. A file in Filament's data folder.
 * @typedef {{ read: () => { pages?: string, art?: string } | null, write: (v: { pages: string, art?: string } | null) => void }} ServeMemo
 * @param {string} file @returns {ServeMemo}
 */
export const fileMemo = (file) => ({
  read() {
    try {
      const v = JSON.parse(readFileSync(file, "utf8"));
      return v && typeof v === "object" ? v : null;
    } catch {
      return null;
    }
  },
  write(v) {
    try {
      if (v) writeFileSync(file, JSON.stringify(v));
      else rmSync(file, { force: true });
    } catch {}
  },
});
/** The memo kept in memory alone: tests, and a Filament with no data folder. @returns {ServeMemo} */
const memoryMemo = () => {
  /** @type {{ pages: string, art?: string } | null} */
  let v = null;
  return { read: () => v, write: (x) => void (v = x) };
};
/** A loopback target as Filament serves one — below its mark, or with none as a build that set none served it —, or "". @param {unknown} t */
const targetIn = (t) => (typeof t === "string" && /^http:\/\/127\.0\.0\.1:\d{1,5}(?:\/[0-9a-f]{32})?$/.test(t) ? t : "");
/** The mark a target Filament served is below, or "". @param {unknown} t */
const markIn = (t) => /\/([0-9a-f]{32})$/.exec(targetIn(t))?.[1] ?? "";
/** A target without its mark: the door it hands on to. @param {string} t */
const doorOf = (t) => t.replace(/\/[0-9a-f]{32}$/, "");
/**
 * Where tailscale serve hands an https port of this machine's name on to, where it serves one handler at / there and
 * nothing more; "" else. @param {any} cfg @param {string} name @param {number} port
 */
const proxiedTo = (cfg, name, port) => {
  const handlers = cfg?.Web?.[`${name}:${port}`]?.Handlers;
  const one = cfg?.TCP?.[String(port)]?.HTTPS === true && handlers && typeof handlers === "object" && Object.keys(handlers).length === 1;
  return one && typeof handlers["/"]?.Proxy === "string" ? handlers["/"].Proxy : "";
};

/** The requests tailscale serve handed on to a door: their path carried the start's mark, which the door took off. */
const handedOn = new WeakSet();
/**
 * Whether tailscale serve handed this request on to a tailnet door: its path began with the mark Filament served the
 * door below this start, which only tailscale serve's own config holds. The guards believe its Tailscale-User-Login on
 * such a request alone: a program here that reaches the door's port and says the header is no one's.
 * @param {import("node:http").IncomingMessage} req
 */
export const servedThrough = (req) => handedOn.has(req);

/** The name a request's Host says, without its port, in lower case. @param {unknown} h */
const hostnameOf = (h) => {
  const s = String(h || "").trim().toLowerCase();
  if (s.startsWith("[")) return s.slice(0, s.indexOf("]") + 1);
  const i = s.indexOf(":");
  return i >= 0 ? s.slice(0, i) : s;
};
/** The names this machine's own loopback is reached by: a tool on this machine, never a page another site rebound. */
const LOOPBACK_NAMES = new Set(["127.0.0.1", "[::1]", "localhost"]);

/** How long a share that could not start — Tailscale not running yet, as at logon — waits before it is asked again. */
export const RETRY_MS = 30_000;

/** The words where Tailscale refuses Filament's user its serve: on Linux, an operator is named once. @param {Ran} r */
const refusedWords = (r) =>
  /access denied|permission denied|must be (run as )?root|operator/i.test(`${r.err}\n${r.out}`)
    ? `: Tailscale refuses this user its serve here — let it (sudo tailscale set --operator=$USER), then Try again`
    : "";

/**
 * Filament on the tailnet: its two doors on loopback, served by `tailscale serve` while server.tailscale.serve says.
 * tailscale serve hands each request on with the Host it was reached by — this machine's name on the tailnet — and
 * sets X-Forwarded-Host to the same, a caller's own replaced: a door answers that Host alone, or this machine's loopback,
 * so a page another site rebound to 127.0.0.1 meets its own name there and is refused before anything is read.
 * @param {object} o
 * @param {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => unknown} o.handler
 *   Filament's pages, behind the network's door
 * @param {(req: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => unknown} o.upgrade
 *   the run socket and the terminal's stream
 * @param {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => unknown} o.artifacts
 *   the artifacts' network address (http/artifacts.js `artifactsDoor`)
 * @param {(level: string, msg: string) => void} [o.log]
 * @param {() => string | null} [o.cli]  where Tailscale's command line is (`findCli`)
 * @param {Exec} [o.exec]  runs it (`runCli`)
 * @param {() => number} [o.now]
 * @param {string} [o.host]  the doors' address: loopback
 * @param {ServeMemo} [o.memo]  what was served, kept across starts (`fileMemo`)
 * @param {number} [o.retryMs]  `RETRY_MS`
 */
export function createTailnetShare({ handler, upgrade, artifacts, log = () => {}, cli = () => findCli(), exec = runCli, now = Date.now, host = "127.0.0.1", memo = memoryMemo(), retryMs = RETRY_MS }) {
  let want = { serve: false, trustOwnLogin: false, port: TAILNET_PORT };
  /**
   * The path tailscale serve hands both doors' requests on below: tailscale serve's config holds it, and the memo in
   * Filament's data folder, so a start serves what the last one did and Tailscale is asked nothing; new where none is
   * kept. A request that carries it came through tailscale serve (`servedThrough`).
   */
  const mark = markIn(memo.read()?.pages) || randomBytes(16).toString("hex");
  /** @type {{ api: http.Server, art: http.Server, port: number, artPort: number } | null} */
  let doors = null;
  /** What Tailscale said when last read: null before any read; `installed` false where its command line is not here. */
  /** @type {(Status & { installed: true }) | { installed: false } | null} */
  let status = null;
  let readAt = 0;
  /** @type {string | null} */
  let error = null;
  /** @type {string | null} */
  let enable = null;
  let served = { pages: false, art: false, funnel: false };
  /** Every connection the doors hold: turned off, none stays open. @type {Set<import("node:stream").Duplex>} */
  const held = new Set();
  /** @type {Promise<void>} */
  let chain = Promise.resolve();
  let closed = false;
  /** The next try of a share that could not start. @type {ReturnType<typeof setTimeout> | null} */
  let again = null;
  /** One change after the one before it; one that throws is said, and the next still runs. @param {() => Promise<unknown>} step */
  const then = (step) =>
    (chain = chain.then(step).then(
      () => {},
      (/** @type {any} */ e) => {
        error = `it could not change: ${e?.message || e}`;
        log("warn", `remote: the tailnet: ${e?.message || e}`);
      },
    ));
  const stopAgain = () => {
    if (again) clearTimeout(again);
    again = null;
  };
  /** A share that could not start — Tailscale not installed, not running, unread — asked again in a while. */
  const later = () => {
    stopAgain();
    if (closed || !want.serve) return;
    again = setTimeout(() => {
      again = null;
      if (!closed && want.serve) void then(step);
    }, retryMs);
    again.unref?.();
  };
  /** @param {string[]} args */
  const run = (args) => {
    const file = cli();
    return file ? exec(file, args, { timeoutMs: CLI_MS }) : Promise.resolve({ code: null, out: "", err: "Tailscale is not installed", timedOut: false });
  };
  /** Tailscale's state, read now; one that cannot be read throws, and what was read before stands. */
  const read = async () => {
    readAt = now();
    if (!cli()) return void (status = { installed: false });
    const r = await run(["status", "--json"]);
    let j = null;
    try {
      j = JSON.parse(r.out);
    } catch {}
    if (!j || typeof j !== "object") throw new Error(`Tailscale does not answer here: ${firstLine(r)}`);
    status = { installed: true, ...statusOf(j) };
    // Signed in as another login now: what the last one opened through the doors ends with it. None read — a moment
    // between two states — changes nothing: signed out, Tailscale serves nothing to the doors.
    if (door && status.login && status.login !== door.login) {
      door = { ...door, login: status.login };
      drop();
    }
  };
  /** The serve's config as Tailscale keeps it. */
  const serveConfig = async () => {
    const r = await run(["serve", "status", "--json"]);
    if (r.code !== 0) throw new Error(`what tailscale serve serves could not be read: ${firstLine(r)}${refusedWords(r)}`);
    try {
      return JSON.parse(r.out || "{}") || {};
    } catch {
      return {};
    }
  };

  /**
   * The mark taken off a request's path where it begins with it, as tailscale serve hands each on (`targetOf`): the
   * request is then known for one it handed on (`servedThrough`). Compared in constant time.
   * @param {import("node:http").IncomingMessage} req
   */
  const unmark = (req) => {
    const u = String(req.url || "");
    const said = u.slice(1, 1 + mark.length);
    const next = u.charAt(1 + mark.length);
    if (u.charAt(0) !== "/" || said.length !== mark.length || !(next === "" || next === "/" || next === "?")) return false;
    if (!timingSafeEqual(Buffer.from(said), Buffer.from(mark))) return false;
    const rest = u.slice(1 + mark.length);
    req.url = rest.startsWith("/") ? rest : `/${rest}`;
    handedOn.add(req);
    return true;
  };
  /**
   * Whether a request reached a door by this machine's name on the tailnet, handed on by tailscale serve (`served`), or
   * by its own loopback. @param {import("node:http").IncomingMessage} req @param {boolean} served
   */
  const reached = (req, served) => {
    const hn = hostnameOf(req.headers.host);
    const name = door?.name || (status && status.installed ? status.name : "");
    return LOOPBACK_NAMES.has(hn) || (served && !!name && hn === name);
  };
  /** @param {http.RequestListener} fn @returns {http.RequestListener} */
  const guarded = (fn) => (req, res) => {
    if (reached(req, unmark(req))) return fn(req, res);
    res.writeHead(421, { "content-type": "text/plain; charset=utf-8" });
    res.end("This door answers this machine's name on the tailnet alone, as tailscale serve hands it on.");
  };
  /** @param {http.Server} s @param {number} port @returns {Promise<http.Server>} */
  const bind = (s, port) =>
    new Promise((resolve, reject) => {
      s.on("connection", (c) => {
        held.add(c);
        c.once("close", () => held.delete(c));
      });
      s.once("error", reject);
      s.listen(port, host, () => {
        s.removeAllListeners("error");
        s.on("error", (e) => log("warn", `remote: the tailnet's door: ${e?.message || e}`));
        resolve(s);
      });
    });
  /** Every connection through the doors ended: those still let in are asked anew as they come back. */
  const drop = () => {
    for (const c of held) c.destroy();
    held.clear();
  };
  const shut = () =>
    new Promise((resolve) => {
      const d = doors;
      doors = null;
      door = null;
      if (served.art) artifactsOnNetwork(SERVE_ART_HTTPS, false);
      served = { pages: false, art: false, funnel: false };
      if (!d) return resolve(undefined);
      let left = 2;
      const one = () => void (--left || resolve(undefined));
      d.api.close(one);
      d.art.close(one);
      drop();
    });
  /** The doors at `port` and the one after; any two free ones for 0. Closed meanwhile: none opened. @param {number} port */
  const open = async (port) => {
    if (doors && (port === 0 || doors.port === port)) return;
    await shut();
    /** @type {http.Server | null} */
    let api = null;
    /** @type {http.Server | null} */
    let art = null;
    try {
      const pages = http.createServer(guarded(handler));
      pages.on("upgrade", (req, socket, head) => (reached(req, unmark(req)) ? upgrade(req, socket, head) : void socket.destroy()));
      api = await bind(pages, port);
      const p = /** @type {import("node:net").AddressInfo} */ (api.address()).port;
      const arts = http.createServer(guarded(artifacts));
      arts.on("upgrade", (_req, socket) => void socket.destroy());
      art = await bind(arts, port === 0 ? 0 : p + 1);
    } catch (/** @type {any} */ e) {
      api?.close();
      throw new Error(e?.code === "EADDRINUSE" ? `port ${port} or ${port + 1} on this machine is taken: choose another port for the tailnet's door` : `its door could not listen: ${e?.message || e}`);
    }
    const a = /** @type {http.Server} */ (api);
    const b = /** @type {http.Server} */ (art);
    if (closed) {
      a.close();
      b.close();
      return;
    }
    doors = { api: a, art: b, port: /** @type {import("node:net").AddressInfo} */ (a.address()).port, artPort: /** @type {import("node:net").AddressInfo} */ (b.address()).port };
  };
  /** Where tailscale serve hands a door's requests on: its port, below this start's mark. @param {number} port */
  const targetOf = (port) => `http://${host}:${port}/${mark}`;
  /** What Filament served before at each https port, as the memo keeps it. */
  const before = () => {
    const m = memo.read();
    return { [SERVE_HTTPS]: targetIn(m?.pages), [SERVE_ART_HTTPS]: targetIn(m?.art) };
  };

  /**
   * Serve a door at an https port of the tailnet, where nothing else is served there: Filament's own entry from before
   * — another port's, an earlier run's — served over; the person's, never. Whether Tailscale serves it now, and whether to
   * the internet too (Funnel, the person's). @param {any} cfg @param {number} https @param {number} local
   */
  const serveOne = async (cfg, https, local) => {
    const name = /** @type {Status} */ (status).name;
    const at = servedAt(cfg, name, https, targetOf(local));
    if (at.is === "mine") return { funnel: at.funnel };
    const was = before()[https];
    // Filament's own from before: as the memo says it served, or to this door's port below another mark, or none (a
    // memo lost, a build that set none): nothing but this door listens at its port.
    const there = targetIn(proxiedTo(cfg, name, https));
    const own = at.is === "other" && ((!!was && was !== targetOf(local) && servedAt(cfg, name, https, was).is === "mine") || (!!there && doorOf(there) === `http://${host}:${local}`));
    if (at.is === "other" && !own) throw new Error(`https port ${https} of ${name} serves ${at.what} here, and Filament leaves it as it is: turn that off (tailscale serve --https=${https} off) to share Filament there`);
    if (own) await run(["serve", `--https=${https}`, "off"]);
    const r = await run(["serve", "--bg", "--yes", `--https=${https}`, targetOf(local)]);
    if (r.code !== 0 || r.timedOut) {
      enable = askedAt(`${r.out}\n${r.err}`);
      throw new Error(enable ? `Tailscale asks for it to be turned on for your tailnet first: open ${enable}, turn it on, then turn this on again` : `tailscale serve did not serve it: ${firstLine(r)}${refusedWords(r)}`);
    }
    return { funnel: false };
  };
  /**
   * Serve both doors: Filament's pages, then the artifacts'. What was served stands until it is served anew — a Try
   * again on a share that works never closes it meanwhile —, and what is served is kept in the memo.
   */
  const serve = async () => {
    const st = /** @type {Status} */ (status);
    const d = /** @type {NonNullable<typeof doors>} */ (doors);
    const cfg = await serveConfig();
    const pages = await serveOne(cfg, SERVE_HTTPS, d.port);
    if (closed || doors !== d) return;
    memo.write({ ...(memo.read() ?? {}), pages: targetOf(d.port) });
    const art = served.art && door?.artPort ? SERVE_ART_HTTPS : null;
    served = { ...served, pages: true, funnel: pages.funnel };
    door = { port: d.port, artDoor: d.artPort, name: st.name, login: st.login, artPort: art };
    log("info", `remote: shared on the tailnet at https://${st.name}`);
    const arts = await serveOne(cfg, SERVE_ART_HTTPS, d.artPort);
    if (closed || doors !== d) return;
    memo.write({ pages: targetOf(d.port), art: targetOf(d.artPort) });
    served = { pages: true, art: true, funnel: pages.funnel || arts.funnel };
    artifactsOnNetwork(SERVE_ART_HTTPS, true);
    door = { ...door, artPort: SERVE_ART_HTTPS };
  };
  /**
   * Take back what Filament serves on the tailnet — its own alone: at its doors' ports, or as the memo says it served
   * before (an earlier run's, the doors never opened since). Tailscale read first where it was not. Filament stopping
   * meanwhile: no more is taken back — the memo has it taken back at the next start.
   */
  const unserve = async () => {
    if (!cli()) return;
    if (!(status && status.installed)) await read().catch(() => {});
    const st = status && status.installed ? status : null;
    if (!st?.name || closed) return;
    const cfg = await serveConfig().catch(() => null);
    if (!cfg) return;
    const was = before();
    let all = true;
    /** @type {[number, number | undefined][]} */
    const ports = [[SERVE_HTTPS, doors?.port], [SERVE_ART_HTTPS, doors?.artPort]];
    for (const [https, local] of ports) {
      const there = targetIn(proxiedTo(cfg, st.name, https));
      const targets = [local ? targetOf(local) : "", was[https], local && there && doorOf(there) === `http://${host}:${local}` ? there : ""].filter(Boolean);
      if (!targets.some((t) => servedAt(cfg, st.name, https, t).is === "mine")) continue;
      if (closed) return;
      const r = await run(["serve", `--https=${https}`, "off"]);
      if (r.code !== 0) all = false;
    }
    if (all) memo.write(null);
    log("info", "remote: no longer shared on the tailnet");
  };

  /** Why Tailscale could not be read at a page's last look; null where it was. @type {string | null} */
  let unread = null;
  /**
   * What server.tailscale asked of Tailscale last — served or not, at which port —: the same asked again changes nothing.
   * Off from the start asks nothing, but where the memo says Filament served something before: that is taken back.
   * @param {typeof want} w
   */
  const askOf = (w) => JSON.stringify({ serve: w.serve, port: w.port });
  let asked = memo.read() ? "" : askOf(want);
  /** @returns {TailnetState} */
  const state = () => {
    const st = status && status.installed ? status : null;
    return {
      on: want.serve,
      trustOwnLogin: want.trustOwnLogin,
      installed: status ? status.installed : null,
      state: st?.state ?? "",
      stateSaid: st ? stateWords(st.state) : "",
      running: !!st?.running,
      name: st?.name ?? "",
      login: st?.login ?? "",
      tailnet: st?.tailnet ?? "",
      https: !!st?.https,
      listening: doors ? { port: doors.port, artPort: doors.artPort } : null,
      address: served.pages && st?.name ? `https://${st.name}` : null,
      artifacts: served.art && st?.name ? `https://${st.name}:${SERVE_ART_HTTPS}` : null,
      funnel: served.funnel,
      error,
      enable,
      unread,
    };
  };
  /**
   * Make it as `want` says: shared — Tailscale read, the doors open, both served — or not, its own serve taken back.
   * One that could not start for Tailscale's state here is asked again in a while (`later`); one that was shared stays
   * open where a read or a serve fails on the way.
   */
  async function step() {
    stopAgain();
    if (closed) return;
    const w = want;
    if (!w.serve) {
      await unserve();
      error = null;
      enable = null;
      return void (await shut());
    }
    error = null;
    enable = null;
    try {
      await read();
    } catch (/** @type {any} */ e) {
      if (!served.pages) await shut();
      error = String(e?.message || e);
      return later();
    }
    const st = status;
    if (!st?.installed) {
      await shut();
      error = `Tailscale is not installed on this machine: install it from ${DOWNLOAD} and sign in`;
      return later();
    }
    if (!st.running) {
      await shut();
      error = `Tailscale is ${stateWords(st.state)} here: connect it from its icon, then turn this on again`;
      return later();
    }
    if (!st.name) {
      await shut();
      error = `Tailscale gives this machine no name on your tailnet: turn on MagicDNS in its admin console, ${HTTPS_ADMIN}, then turn this on again`;
      return later();
    }
    try {
      // Its door moved: what Tailscale serves of the old one is taken back first, or the new one finds it the person's.
      if (doors && w.port !== 0 && doors.port !== w.port) await unserve();
      if (closed) return;
      await open(w.port);
      if (closed) return;
      await serve();
    } catch (/** @type {any} */ e) {
      error = String(e?.message || e);
      log("warn", `remote: the tailnet: ${error}`);
      if (!served.pages) await shut();
    }
  }

  return {
    /**
     * Share as server.tailscale says: on, its doors at its port and tailscale serve asked to serve them; off, its own
     * serve taken back. Off from the start, Tailscale is not asked anything; the same asked again — any other setting
     * saved, Trust my own tailnet login too, which the guards read as it is saved — asks it nothing either, even after a
     * failure: `retry` asks again. A change waits for the one before it. Trust taken back: every connection through the
     * doors ends at once — a page, its events, a terminal your login held open —, those still let in asked anew.
     * @param {{ serve?: boolean, trustOwnLogin?: boolean, port?: number } | undefined} ts  server.tailscale
     */
    apply(ts) {
      if (closed) return chain;
      const was = want;
      want = { serve: ts?.serve === true, trustOwnLogin: ts?.trustOwnLogin === true, port: tailnetPortOf(ts) };
      if (was.trustOwnLogin && !want.trustOwnLogin) drop();
      const asking = askOf(want);
      if (asking === asked) return chain;
      asked = asking;
      return then(step);
    },
    /** Asked again as it stands — after the person turned on what Tailscale asked for: on, it is served again. */
    retry: () => (closed || !want.serve ? chain : then(step)),
    /**
     * What a page shows (Settings › Remote access): Tailscale read again where the last read is older than `LOOK_MS`,
     * or `fresh` — after the changes asked for so far, and before the next, never beside one.
     * @param {{ fresh?: boolean }} [o] @returns {Promise<TailnetState>}
     */
    async look({ fresh = false } = {}) {
      await then(async () => {
        if (closed || !(fresh || !status || now() - readAt > LOOK_MS)) return;
        try {
          await read();
          unread = null;
        } catch (/** @type {any} */ e) {
          unread = String(e?.message || e);
        }
      });
      return state();
    },
    state,
    /** Once the changes asked for so far are made. */
    settled: () => chain,
    /**
     * Its doors closed for good, as Filament stops — at once, not after a change on its way, which then changes nothing:
     * the serve is left as it is, asked for again at the next start.
     */
    close() {
      closed = true;
      stopAgain();
      return shut();
    },
  };
}
