// @ts-check
// A machine reached over SSH (the owner's remote Filament of 11-06, Part 2, p2-ssh): this computer holds the tunnel —
// `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<port> -- <alias>` — and the machine's Filament is at http://127.0.0.1:<local>,
// a caller on its own loopback there, as sshd hands it on: ssh's own sign-in is the pairing, no code made. The alias is
// one of your SSH config's or [user@]host, never an option (a `-` first, a space, a quote: refused), and ssh runs in
// batch mode — your keys and agent alone, never a password or a host key asked —, its own process, never a connection
// your SSH config shares (ControlMaster), so what it cannot do is said in words: a host key not known yet, a key refused,
// a name not found. Each machine's tunnel keeps its local port across starts (the route's url) — picked below the
// dynamic range, where the system's own ports and reserved ranges are —, so its harness's own storage, by origin, stays.
// The tunnel stays up while the machine is kept, is started again when it drops — a sleep, a network change — at the
// next look, waits longer after each failure in a row, and ends with the app; an ssh an earlier run left at its port —
// the app crashed, or was ended — is found by its command line and ended. Plain Node; `spawn`, `probe` and `stale` are
// seams for its test.
import { execFile, spawn as spawnChild } from "node:child_process";
import { connect, createServer } from "node:net";
import { existsSync } from "node:fs";
import { win32 } from "node:path";

/** Filament's own port on a machine, where the address names none. */
export const FILAMENT_PORT = 20300;
/** How long a tunnel is given to come up: ssh's sign-in, the forward bound. */
export const HOLD_MS = 20_000;
/** How long after a tunnel failed it is not started again — doubled at each failure in a row, to `RETRY_MAX_MS`: the window's look and the tray's tick each ask. */
export const RETRY_MS = 10_000;
export const RETRY_MAX_MS = 80_000;
/**
 * Where a tunnel's port on this computer is picked: below the dynamic range, where the system hands out its own ports
 * and Windows reserves ranges as it starts (Hyper-V, WSL, Docker) — a port kept across starts stays one that binds.
 */
export const LOCAL_PORTS = Object.freeze({ from: 40000, to: 48999 });

/**
 * An SSH alias as an address may name one: letters, digits, `.`, `_`, `-`, a `user@` before them at most, never a `-`
 * first — as src/ui/harness/lib/api.js `sshAlias` reads it back from the harness's address. "" for anything else.
 * @param {unknown} text
 */
export const aliasOf = (text) => {
  const s = String(text ?? "").trim();
  return s.length <= 253 && /^(?:\w[\w.-]*@)?\w[\w.-]*$/.test(s) ? s : "";
};

/**
 * The Add sheet's address, where it asks for SSH: `ssh://<alias>` — and Filament's port on that machine after a colon,
 * where it is not `FILAMENT_PORT`: ssh's own port is your SSH config's — or `ssh <alias>`. Null where it asks for none;
 * a refusal's words where it asks for SSH and names no alias one may hold.
 * @param {string} text @returns {{ alias: string, port: number } | { words: string } | null}
 */
export function sshAsked(text) {
  const s = String(text ?? "").trim();
  const m = /^ssh(?::\/\/|\s+)(.*)$/i.exec(s);
  if (!m) return null;
  const rest = m[1].trim().replace(/\/+$/, "");
  const at = /^(.*?)(?::(\d{1,5}))?$/.exec(rest);
  const alias = aliasOf(at?.[1]);
  const port = at?.[2] ? Number(at[2]) : FILAMENT_PORT;
  if (!alias) return { words: `"${rest.slice(0, 80)}" is no SSH host: write ssh://<a Host of your SSH config, or user@host>, and Filament's port on it after a colon where it is not ${FILAMENT_PORT}.` };
  if (!(port >= 1 && port <= 65535)) return { words: `${port} is no port: Filament's port on ${alias} is a number from 1 to 65535.` };
  return { alias, port };
}

/**
 * ssh's arguments for a tunnel: no shell, no terminal, batch mode, a process of its own — never a master your SSH config
 * shares, which would hold the forward past this one's end —, the forward on this computer's loopback alone, kept alive,
 * and the alias after `--`, where no word is an option.
 * @param {string} alias @param {number} port @param {number} local
 */
export const sshArgs = (alias, port, local) => [
  "-N",
  "-T",
  "-o", "BatchMode=yes",
  "-o", "ExitOnForwardFailure=yes",
  "-o", "ControlMaster=no",
  "-o", "ControlPath=none",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=3",
  "-o", "ConnectTimeout=10",
  "-L", `127.0.0.1:${local}:127.0.0.1:${port}`,
  "--",
  alias,
];

/**
 * ssh, as this computer has it: Windows' own OpenSSH where it is there, else `ssh` on PATH.
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean }} [o]
 */
export const sshCli = ({ platform = process.platform, env = process.env, exists = existsSync } = {}) => {
  if (platform !== "win32") return "ssh";
  const own = win32.join(env.SystemRoot || env.windir || "C:\\Windows", "System32", "OpenSSH", "ssh.exe");
  return exists(own) ? own : "ssh";
};

/**
 * What ssh said, in words: why a tunnel did not come up. A port it could not listen at is said first — its refusal
 * reads "Permission denied" too, where the system keeps the port —, and by the port: this tunnel's, or one your SSH
 * config forwards for that Host. @param {string} said  its stderr @param {string} alias @param {number} local
 */
export function sshWords(said, alias, local) {
  const s = String(said || "");
  if (/host key verification failed|no .* host key is known|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(s))
    return /CHANGED/i.test(s)
      ? `${alias}'s host key is not the one your known_hosts has: nothing was sent. If that machine was set up anew, check its key, then remove the old one (ssh-keygen -R <host>).`
      : `ssh does not know ${alias}'s host key yet: connect once from a terminal (ssh ${alias}), check and accept it, then try again.`;
  const bound = /cannot listen to port:\s*(\d+)|bind \[[^\]]*\]:(\d+)/i.exec(s);
  if (bound || /address already in use/i.test(s)) {
    const at = Number(bound?.[1] || bound?.[2]) || local;
    return at === local
      ? `Port ${local} on this computer cannot be listened at — something holds it, or the system keeps it —: the tunnel to ${alias} cannot start there. Remove the machine from this window (its ⋯ in the machines menu) and add it again: it gets another port.`
      : `Your SSH config forwards port ${at} for ${alias}, and this computer cannot listen there — something holds it —, so ssh ends: take that forward out of its Host, or end what holds the port.`;
  }
  if (/permission denied|too many authentication failures/i.test(s)) return `${alias} refused your SSH keys: Filament signs in with your keys and ssh-agent alone, never a password — add a key that machine accepts (ssh-copy-id), or your key to the agent.`;
  if (/could not resolve hostname|name or service not known|no such host/i.test(s)) return `${alias} is not found: is it a Host of your SSH config, or a name this computer resolves?`;
  if (/connection refused/i.test(s)) return `${alias} refuses SSH: is its SSH server on (on Windows, OpenSSH Server in Settings › Optional features)?`;
  if (/timed out|no route to host|network is unreachable/i.test(s)) return `${alias} does not answer: is it on, and on a network this computer reaches?`;
  if (/\bENOENT\b/.test(s)) return "This computer has no ssh: on Windows, add OpenSSH Client in Settings › System › Optional features; elsewhere, install OpenSSH.";
  const first = s.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return first ? `ssh to ${alias} ended: ${first.slice(0, 200)}` : `ssh to ${alias} ended before its tunnel came up.`;
}

/**
 * @typedef {{ kind: "ssh", url: string, alias: string, port: number }} SshRoute  `url`: the tunnel's end on this
 *   computer, http://127.0.0.1:<local>; `alias`: the SSH host; `port`: Filament's port on it
 */

/** The port a tunnel's route listens at on this computer — its url's —, or 0 where it names none. @param {{ url?: unknown }} route */
export const localOf = (route) => {
  try {
    const u = new URL(String(route?.url));
    const p = Number(u.port);
    return u.protocol === "http:" && u.hostname === "127.0.0.1" && Number.isInteger(p) && p > 0 ? p : 0;
  } catch {
    return 0;
  }
};

/** Whether a port of this computer's loopback can be listened at now. @param {number} port @returns {Promise<boolean>} */
const binds = (port) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });

/**
 * A port free on this computer's loopback now, picked at random in `LOCAL_PORTS`; the system's own pick where none of
 * a hundred binds. @returns {Promise<number>}
 */
export const freePort = async () => {
  for (let i = 0; i < 100; i++) {
    const p = LOCAL_PORTS.from + Math.floor(Math.random() * (LOCAL_PORTS.to - LOCAL_PORTS.from + 1));
    if (await binds(p)) return p;
  }
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = /** @type {import("node:net").AddressInfo} */ (s.address()).port;
      s.close(() => resolve(p));
    });
  });
};

/** Whether something listens at a port of this computer's loopback. @param {number} port @param {number} [timeoutMs] @returns {Promise<boolean>} */
export const probePort = (port, timeoutMs = 1000) =>
  new Promise((resolve) => {
    const c = connect(port, "127.0.0.1");
    const done = (/** @type {boolean} */ ok) => {
      c.destroy();
      resolve(ok);
    };
    c.once("connect", () => done(true));
    c.once("error", () => done(false));
    c.setTimeout(timeoutMs, () => done(false));
  });

/**
 * The ssh processes an earlier run of this app left holding a tunnel at `local`, from the process list — a pid and its
 * command line a line —: this app's own options and that very forward, never another ssh of yours.
 * @param {string} listed @param {number} local @returns {number[]}
 */
export function staleOf(listed, local) {
  /** @type {number[]} */
  const pids = [];
  for (const line of String(listed || "").split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    const cmd = m?.[2] || "";
    if (m && /\bssh(?:\.exe)?\b/i.test(cmd) && cmd.includes("BatchMode=yes") && cmd.includes("ExitOnForwardFailure=yes") && cmd.includes(` -L 127.0.0.1:${local}:127.0.0.1:`)) pids.push(Number(m[1]));
  }
  return pids;
}

/** The process list's ssh lines, a pid and its command line each: PowerShell's on Windows, ps's elsewhere. */
const WIN_LIST = `Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`;
/**
 * Every ssh process's pid and command line, a line each; "" where the list cannot be read.
 * @param {{ platform?: string, exec?: typeof execFile }} [o] @returns {Promise<string>}
 */
export const listSsh = ({ platform = process.platform, exec = execFile } = {}) =>
  new Promise((resolve) => {
    const [file, args] =
      platform === "win32"
        ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(WIN_LIST, "utf16le").toString("base64")]]
        : ["ps", ["-axo", "pid=,command="]];
    exec(file, args, { windowsHide: true, timeout: 10_000, maxBuffer: 4 << 20 }, (err, out) => resolve(err ? "" : String(out)));
  });

/**
 * @typedef {{ route: SshRoute, child: any, exited: boolean, err: string, pending: Promise<string | null> | null,
 *   failedAt: number, fails: number, why: string | null, heldAt: number, upAt: number, chosenAt: number }} Tunnel
 *   `upAt`: when it last came up; `chosenAt`: when a pick last took its route (`chosen`)
 */

/**
 * This computer's SSH tunnels, one per route (by its url). `hold` brings a route's tunnel up — started where none runs,
 * started again where it dropped — and says null, or why not, in words; two asks at once share one start, and one that
 * failed is not started again for `retryMs`, doubled at each failure in a row to `retryMaxMs` — but for a `fresh` ask,
 * the Add sheet's. Closed, or its place taken by another route's, a start under way stops: no ssh is left behind it.
 * `routeFor` makes a route for an alias and a port, at the local port a tunnel or a kept machine has for them already,
 * else a free one no kept route has. `only` ends the tunnels of routes no longer kept, but one held in the last
 * `graceMs` — an Add sheet's check, not kept yet —, and a kept route's that no pick took (`chosen`) and none asked for
 * in `graceMs`: a better way answers, one its machine's ways were asked for or one its page and watch moved off.
 * `close` ends them all, as the app quits.
 * @param {{ spawn?: (file: string, args: string[], o: object) => any, probe?: (port: number) => Promise<boolean>,
 *   cli?: () => string, log?: (line: string) => void, now?: () => number, holdMs?: number, retryMs?: number,
 *   retryMaxMs?: number, every?: number, wait?: (ms: number) => Promise<void>, free?: () => Promise<number>,
 *   kept?: () => any[], stale?: (local: number) => Promise<number[]>, kill?: (pid: number) => void }} [o]
 *   `kept`: the routes the machines kept have; `stale`: the pids of an earlier run's ssh at a port (`staleOf`)
 */
export function createTunnels({
  spawn = spawnChild,
  probe = probePort,
  cli = () => sshCli(),
  log = () => {},
  now = Date.now,
  holdMs = HOLD_MS,
  retryMs = RETRY_MS,
  retryMaxMs = RETRY_MAX_MS,
  every = 200,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  free = freePort,
  kept = () => [],
  stale = (local) => listSsh().then((l) => staleOf(l, local)),
  kill = (pid) => void process.kill(pid),
} = {}) {
  /** @type {Map<string, Tunnel>} */
  const tunnels = new Map();
  let gone = false;

  /** @param {Tunnel} t */
  const stop = (t) => {
    const c = t.child;
    t.child = null;
    if (c && !t.exited) {
      try {
        c.kill();
      } catch {}
    }
  };
  /** @param {Tunnel} t @param {string} why */
  const fail = (t, why) => {
    t.failedAt = now();
    t.fails++;
    t.why = why;
    log(`ssh: the tunnel to ${t.route.alias}: ${why}`);
    return why;
  };
  /** @param {Tunnel} t @param {number} local */
  const start = (t, local) => {
    const child = spawn(cli(), sshArgs(t.route.alias, t.route.port, local), { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    t.child = child;
    t.exited = false;
    t.err = "";
    const mine = () => t.child === child;
    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (/** @type {string} */ d) => void (mine() && (t.err = (t.err + d).slice(-4000))));
    // Ended once what it said is read whole: "close" comes after its stderr's end, "exit" may come before.
    const ended = () => {
      if (mine()) t.exited = true;
    };
    child.on?.("close", ended);
    child.on?.("error", (/** @type {any} */ e) => {
      if (mine()) t.err += `\n${e?.message || e}`;
      ended();
    });
    log(`ssh: a tunnel to ${t.route.alias} at 127.0.0.1:${local}`);
  };
  /** @param {Tunnel} t @param {boolean} fresh @returns {Promise<string | null>} */
  const bringUp = async (t, fresh) => {
    const { alias } = t.route;
    const local = localOf(t.route);
    // Closed, or its place taken by another route's tunnel, meanwhile: nothing more is started for it, and what it
    // started is ended.
    const left = () => gone || tunnels.get(t.route.url) !== t;
    const leave = () => {
      stop(t);
      return gone ? "The app is closing." : "Another tunnel took its place.";
    };
    if (t.child && !t.exited) {
      if (await probe(local)) return left() ? leave() : null;
      // Ours, but its forward is gone: ended, and started anew.
      stop(t);
    }
    if (!fresh && t.failedAt && now() - t.failedAt < Math.min(retryMs * 2 ** Math.max(0, t.fails - 1), retryMaxMs)) return t.why;
    if (await probe(local)) {
      // An ssh an earlier run of this app left — it crashed, or was ended — may hold it: found by its command line and
      // ended, never another program.
      const ours = new Set([...tunnels.values()].map((x) => x.child?.pid).filter(Boolean));
      const pids = (await stale(local).catch(() => [])).filter((pid) => !ours.has(pid));
      for (const pid of pids) {
        try {
          kill(pid);
          log(`ssh: an earlier run's tunnel to 127.0.0.1:${local} ended (pid ${pid})`);
        } catch {}
      }
      let held = true;
      for (let i = 0; i < 20 && pids.length && held; i++) {
        await wait(100);
        held = await probe(local);
      }
      if (left()) return leave();
      if (held) return fail(t, `Port ${local} on this computer is taken by another program: the tunnel to ${alias} cannot listen there. Remove the machine from this window (its ⋯ in the machines menu) and add it again: it gets another port.`);
    }
    if (left()) return leave();
    start(t, local);
    const until = now() + holdMs;
    for (;;) {
      await wait(every);
      if (left()) return leave();
      if (t.exited || !t.child) {
        t.child = null;
        return fail(t, sshWords(t.err, alias, local));
      }
      if (await probe(local)) {
        if (left()) return leave();
        t.failedAt = 0;
        t.fails = 0;
        t.why = null;
        t.upAt = now();
        t.chosenAt = 0;
        return null;
      }
      if (now() >= until) {
        stop(t);
        return fail(t, `ssh to ${alias} did not come up in ${Math.round(holdMs / 1000)} s: does it wait on something — a key's passphrase your agent does not hold?`);
      }
    }
  };

  return {
    /**
     * @param {any} route @param {{ fresh?: boolean }} [o]  `fresh`: started whatever failed a moment ago — a person asks
     * @returns {Promise<string | null>}
     */
    hold(route, { fresh = false } = {}) {
      if (gone) return Promise.resolve("The app is closing.");
      const alias = aliasOf(route?.alias);
      const port = Number(route?.port);
      if (route?.kind !== "ssh" || !alias || !localOf(route) || !Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve("This is no SSH route this app reads.");
      const key = String(route.url);
      let t = tunnels.get(key);
      if (!t || t.route.alias !== alias || t.route.port !== port) {
        if (t) stop(t);
        t = { route: { kind: "ssh", url: key, alias, port }, child: null, exited: false, err: "", pending: null, failedAt: 0, fails: 0, why: null, heldAt: 0, upAt: 0, chosenAt: 0 };
        tunnels.set(key, t);
      }
      t.heldAt = now();
      const tt = t;
      return (tt.pending ??= bringUp(tt, fresh).finally(() => void (tt.pending = null)));
    },
    /**
     * The route for an alias and Filament's port on it: the local port a tunnel or a kept machine has for them, else a
     * free one no kept route has — free now is not enough: a kept machine whose tunnel is down has its port.
     * @param {string} alias @param {number} port @returns {Promise<SshRoute>}
     */
    async routeFor(alias, port) {
      const same = (/** @type {any} */ r) => r?.kind === "ssh" && r.alias === alias && Number(r.port) === port && localOf(r);
      const had = [...tunnels.values()].map((t) => t.route).find(same) || kept().find(same);
      if (had) return { kind: "ssh", url: String(had.url), alias, port };
      const used = new Set([...[...tunnels.values()].map((t) => localOf(t.route)), ...kept().map(localOf)]);
      for (let i = 0; i < 50; i++) {
        const p = await free();
        if (!used.has(p)) return { kind: "ssh", url: `http://127.0.0.1:${p}`, alias, port };
      }
      throw new Error("No port on this computer is free for a tunnel.");
    },
    /**
     * A pick took the route (machines.js `pickRoute`): its tunnel is one a page, a look or a link goes through.
     * @param {any} route
     */
    chosen(route) {
      const t = tunnels.get(String(route?.url ?? ""));
      if (t) t.chosenAt = now();
    },
    /** @param {string[]} urls  the kept routes' @param {{ graceMs?: number }} [o] */
    only(urls, { graceMs = 120_000 } = {}) {
      const keep = new Set(urls);
      for (const [key, t] of tunnels) {
        if (t.pending) continue;
        if (!keep.has(key) && now() - t.heldAt > graceMs) {
          stop(t);
          tunnels.delete(key);
          log(`ssh: the tunnel to ${t.route.alias} ended: no machine kept goes through it`);
        } else if (keep.has(key) && t.child && t.upAt && [t.upAt, t.heldAt, t.chosenAt].every((at) => now() - at > graceMs)) {
          // Asked for of late — its machine's ways still weighed through it, its Filament there down — or taken by a
          // pick of late — a page or the watch on it, which ask it every few seconds —, it stays.
          stop(t);
          tunnels.delete(key);
          log(`ssh: the tunnel to ${t.route.alias} ended: no pick has taken it of late`);
        }
      }
    },
    /** Every tunnel ended, as the app quits; a start under way stops at its next step. */
    close() {
      gone = true;
      for (const t of tunnels.values()) stop(t);
      tunnels.clear();
    },
  };
}
