// @ts-check
// `filament service` (the remote plan's sv-service): Filament for servers run by systemd's user manager — a unit in the
// user's own folder, no root —, started at boot where lingering is on, and started again 3 s after it ends by itself:
// a crash, or a stop that asks to be restarted (Settings › About's Restart). `filament stop` and `filament restart`
// go through systemctl while it runs Filament, so systemd never starts again what was stopped; with its unit installed,
// `filament start` (and `filament restart`, nothing running) starts it through systemctl too. Linux with systemd
// alone: on macOS and Windows the Filament app runs Filament, and starts it at logon.
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir, userInfo } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isCheckout, portOption } from "../services/config/store.js";
import { CliError, EXIT, clientAt, connect, whereFilament } from "./client.js";
import { listeningUrl } from "./listening.js";
import { pause } from "./flows.js";

/** The unit's name, as `systemctl --user … filament` names it. */
export const UNIT = "filament";

/** Filament's own folder: a server build's (its build-info.json says so), a checkout, or the app's. */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * How long systemd lets a stop take before it kills what is left: Filament ends what is in flight (up to 20 s), then
 * closes its agents, shells and stores, each bounded (src/server.js `stop`) — under a minute at worst.
 */
const STOP_SEC = 60;

/** The folders a PATH holds at least: systemd's own for a user's service. */
const SYSTEM_PATH = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"];

/**
 * How a systemd tool runs: Node's spawn — a test runs its stand-ins through its own, where the OS runs no script by its
 * name —, and the system's own folders it is looked for in after the PATH (`system`): a PATH cut short — cron's, sudo's,
 * a script's — leaves out where systemctl is. `stopMs`: how long a Filament asked to stop is waited for to end — its
 * stop's limit (STOP_SEC), and a little more. `upMs`: how long one systemd started is waited for to answer — the minute
 * its words say.
 */
export const tools = { spawn, system: SYSTEM_PATH, stopMs: (STOP_SEC + 30) * 1000, upMs: 60_000 };

/** The user's home folder, as HOME says. */
const home = () => process.env.HOME || homedir();

/** A tool's first line of words. @param {string} s */
const firstLine = (s) => String(s || "").trim().split("\n")[0].trim();

/** A folder's path to compare by: its real one, links followed; null where there is none. @param {string} p */
const realOf = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/**
 * A program on the PATH, as a shell finds it, then in the system's own folders: the first folder's that holds it,
 * runnable; null where none does.
 * @param {string} name
 */
export function onPath(name) {
  for (const dir of [...String(process.env.PATH || "").split(delimiter), ...tools.system]) {
    if (!dir) continue;
    const file = join(dir, name);
    try {
      if (!statSync(file).isFile()) continue;
      accessSync(file, constants.X_OK);
      return file;
    } catch {}
  }
  return null;
}

/**
 * A systemd tool run to its end: its exit code and what it said. One not on the PATH is code 127, as a shell says.
 * @param {string} name @param {string[]} args @param {AbortSignal} [signal]
 * @returns {Promise<{ code: number, out: string, err: string }>}
 */
export function runTool(name, args, signal) {
  const file = onPath(name);
  if (!file) return Promise.resolve({ code: 127, out: "", err: `${name}: not found` });
  return new Promise((res, rej) => {
    let out = "";
    let err = "";
    const child = tools.spawn(file, args, { stdio: ["ignore", "pipe", "pipe"], signal, windowsHide: true });
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("error", (e) => (e?.name === "AbortError" ? rej(new CliError("Stopped.", EXIT.interrupted)) : res({ code: 127, out, err: e.message })));
    child.on("close", (code) => res({ code: code ?? 1, out: out.trim(), err: err.trim() }));
  });
}

/**
 * `systemctl --user <args>`: its answer, or a CliError in its own words where it fails.
 * @param {string[]} args @param {AbortSignal} [signal]
 */
async function systemctl(args, signal) {
  const done = await runTool("systemctl", ["--user", ...args], signal);
  if (done.code !== 0) throw new CliError(`systemctl --user ${args.join(" ")} failed: ${firstLine(done.err || done.out) || `exit ${done.code}`}`, EXIT.failed);
  return done;
}

/**
 * systemd's user manager, where it answers here: its environment (`systemctl --user show-environment`), which the unit's
 * folder is found by. Refused in words elsewhere: macOS and Windows, the Filament app's own command line, no systemctl,
 * and a manager that does not answer — WSL without systemd, a container, a login with no user session.
 * @param {import("./commands.js").Run} r
 * @returns {Promise<Record<string, string>>}
 */
async function manager(r) {
  if (r.flags.machine || r.flags.url) throw new CliError("service runs on the machine Filament runs on: run it there (ssh <machine> filament service …)", EXIT.usage);
  if (process.platform === "darwin" || process.platform === "win32")
    throw new CliError(`systemd runs Filament on a Linux server: on ${process.platform === "darwin" ? "a Mac" : "Windows"} the Filament app runs it, and starts it at logon (Start at logon, in its tray's menu).`, EXIT.failed);
  if (process.platform !== "linux") throw new CliError("systemd runs Filament on a Linux server: here, run `filament start` under a supervisor of your own.", EXIT.failed);
  if (process.versions.electron) throw new CliError("The Filament app runs Filament on this computer, and starts it again itself: a systemd service runs Filament for servers, which install.sh installs.", EXIT.failed);
  if (!onPath("systemctl")) throw new CliError("There is no systemctl here, so no systemd to run Filament: run `filament start` under a supervisor of your own (a container's restart policy, tmux).", EXIT.failed);
  const env = await runTool("systemctl", ["--user", "show-environment"], r.signal);
  if (env.code !== 0)
    throw new CliError(
      `systemd's user manager does not answer here (systemctl --user: ${firstLine(env.err || env.out) || `exit ${env.code}`}) — WSL without systemd, a container, or a login with no user session has none. On WSL, [boot] systemd=true in /etc/wsl.conf and \`wsl --shutdown\` turn it on; elsewhere run \`filament start\` under a supervisor of your own.`,
      EXIT.failed,
    );
  return varsOf(env.out);
}

/** The variables `systemctl --user show-environment` says, one NAME=value a line. @param {string} out */
const varsOf = (out) => {
  /** @type {Record<string, string>} */
  const vars = {};
  for (const line of out.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) vars[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return vars;
};

/**
 * Where the unit goes: the user's systemd folder, as the manager reads it — under its XDG_CONFIG_HOME where it has one,
 * else its HOME's .config.
 * @param {Record<string, string>} env  the manager's environment
 */
export const unitFile = (env) => join(env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(env.HOME || home(), ".config"), "systemd", "user", `${UNIT}.service`);

/**
 * What the unit runs, its words, and the folder its Node is in. The installed Filament by its stable path — `current`,
 * which an update points at its new version, so a restart runs that — where this is one install.sh installed, known by
 * its layout as filament update knows it (update.js `installOf`): `current` beside its version's folder, pointing at it,
 * wherever XDG_DATA_HOME put it; else this server build's own launcher, where it is; else this Node with this Filament's
 * bin/filament.js (a checkout: its code as it stands).
 * @param {string} [root]  Filament's own folder
 * @returns {{ argv: string[], nodeBin: string, words: string }}
 */
export function launcherOf(root = ROOT) {
  const own = join(root, "bin", "filament");
  let server = false;
  try {
    server = JSON.parse(readFileSync(join(root, "build-info.json"), "utf8"))?.kind === "server" && existsSync(own);
  } catch {}
  if (server) {
    const current = join(dirname(resolve(root)), "current");
    const here = realOf(root);
    if (here && realOf(current) === here && existsSync(join(current, "bin", "filament")))
      return { argv: [join(current, "bin", "filament")], nodeBin: join(current, "node", "bin"), words: `the installed Filament, by its stable path (${current}): an update points it at the new version, which starts at the next restart` };
    return { argv: [own], nodeBin: join(root, "node", "bin"), words: `this Filament's launcher, where it is (${own}): install.sh did not install it, so an update does not reach it` };
  }
  return {
    argv: [process.execPath, join(root, "bin", "filament.js")],
    nodeBin: dirname(process.execPath),
    words: isCheckout(root) ? `this checkout, with this Node (${process.execPath}): its code as it stands — git pull, then filament restart, updates it` : `this Filament, with this Node (${process.execPath})`,
  };
}

/** A word of a unit's line in quotes, where it holds a space, a quote, a backslash or a semicolon. @param {string} s */
const quoted = (s) => (!s || /[\s"'\\;]/.test(s) ? `"${s.replace(/[\\"]/g, "\\$&")}"` : s);
/** A word of ExecStart as systemd reads it back: `%` (a specifier) and `$` (a variable) doubled. @param {string} w */
export const execWord = (w) => quoted(w.replace(/%/g, "%%").replace(/\$/g, "$$$$"));
/** An Environment= assignment as systemd reads it back: `%` doubled; `$` means nothing there. @param {string} w */
const envWord = (w) => quoted(w.replace(/%/g, "%%"));

/**
 * The words of a unit's line as systemd reads them: quoted or not, its escapes and doubled `%` and `$` taken back.
 * @param {string} line
 */
export function unitWords(line) {
  /** @type {string[]} */
  const words = [];
  let w = "";
  let quote = "";
  let any = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length) {
      w += line[++i];
      any = true;
    } else if (quote ? c === quote : c === '"' || c === "'") {
      quote = quote ? "" : c;
      any = true;
    } else if (!quote && /\s/.test(c)) {
      if (any) words.push(w);
      w = "";
      any = false;
    } else {
      w += c;
      any = true;
      if ((c === "%" || c === "$") && line[i + 1] === c) i++;
    }
  }
  if (any) words.push(w);
  return words;
}

/**
 * The unit's PATH, which takes the place of the manager's: ~/.local/bin (where install.sh puts `filament`, and many a
 * tool its own) in the manager's HOME, the folder Filament's Node is in (an npm there installs coding agents that need
 * it), then this shell's PATH — what finds a coding agent here finds it there too —, the manager's own PATH (what its
 * environment.d adds, /snap/bin) and systemd's folders.
 * @param {string} nodeBin @param {Record<string, string | undefined>} env  the manager's environment
 */
const pathFor = (nodeBin, env) =>
  [...new Set([join(env.HOME || home(), ".local", "bin"), nodeBin, ...String(process.env.PATH || "").split(delimiter), ...String(env.PATH || "").split(":"), ...SYSTEM_PATH].filter(Boolean))].join(":");

/**
 * The unit's text. It starts Filament with the data folder always — the manager's environment is not this shell's:
 * FILAMENT_DATA_DIR or XDG_CONFIG_HOME set here would not reach it — and the port where one was given.
 * @param {{ argv: string[], nodeBin: string, dataDir: string, port?: number | null, env?: Record<string, string | undefined> }} o  `env`: the manager's
 */
export function unitText({ argv, nodeBin, dataDir, port = null, env = {} }) {
  const exec = [...argv, "start", "--data-dir", dataDir, ...(port != null ? ["--port", String(port)] : [])];
  return [
    "# Filament, run by systemd's user manager: written by `filament service install`, removed by `filament service uninstall`.",
    "[Unit]",
    "Description=Filament",
    "",
    "[Service]",
    `ExecStart=${exec.map(execWord).join(" ")}`,
    "Environment=FILAMENT_SUPERVISOR=systemd",
    `Environment=${envWord(`PATH=${pathFor(nodeBin, env)}`)}`,
    "# Started again 3 s after it ends by itself - a crash, or a stop that asks for a restart (Settings › About's Restart);",
    "# never after a stop of systemctl's (filament stop).",
    "Restart=always",
    "RestartSec=3",
    "# SIGTERM to Filament alone: it ends what is in flight (up to 20 s), stops its agents and shells, then exits.",
    "KillMode=mixed",
    "KillSignal=SIGTERM",
    `TimeoutStopSec=${STOP_SEC}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/** The ExecStart line of a unit's text, as written; "" where it has none. @param {string | null} text */
const execLine = (text) => /^ExecStart=(.*)$/m.exec(String(text || ""))?.[1] || "";

/** The data folder a unit's ExecStart names; null where it names none. @param {string | null} text */
const dataDirOf = (text) => {
  const words = unitWords(execLine(text));
  const i = words.indexOf("--data-dir");
  return i >= 0 && words[i + 1] ? words[i + 1] : null;
};

/** Whether systemd keeps the user's manager with no one logged in — what starts Filament at boot; null where loginctl cannot say. @param {string} user @param {AbortSignal} [signal] */
async function lingerOf(user, signal) {
  const l = await runTool("loginctl", ["show-user", user, "-p", "Linger"], signal);
  const m = l.code === 0 ? /^Linger=(yes|no)$/m.exec(l.out) : null;
  return m ? m[1] === "yes" : null;
}

/** Lingering, in words: on, it starts at boot; off or not read, how to turn it on. @param {boolean | null} on @param {string} user */
const lingerWords = (on, user) =>
  on
    ? `Lingering is on for ${user}: Filament starts at boot, with no one logged in.`
    : `${on === false ? `Lingering is off for ${user}` : `loginctl could not say whether lingering is on for ${user}`}: Filament starts as ${user} logs in, and stops as their last session ends (the last SSH session, or WSL's last window, closed), a turn that runs then with it. To start it at boot with no one logged in, run: loginctl enable-linger ${user} (some systems ask for sudo: sudo loginctl enable-linger ${user}).`;

/** Who the unit is for: the manager's user, as its environment says. @param {Record<string, string>} env */
const userOf = (env) => {
  if (env.USER) return env.USER;
  try {
    return userInfo().username;
  } catch {
    return process.env.USER || "";
  }
};

/** A path to compare by. @param {string} p */
const pathKey = (p) => resolve(p);

/** The Filament at `url`, where one answers: its /api/state; null where none does. @param {string} url */
async function stateAt(url) {
  try {
    const res = await fetch(`${url}/api/state`, { headers: { "x-filament-ui": "1" }, signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** The unit's main process now: its pid, 0 where none runs, null where systemd cannot say. @param {AbortSignal} [signal] */
const mainPid = async (signal) => {
  const p = await runTool("systemctl", ["--user", "show", UNIT, "-p", "MainPID", "--value"], signal);
  return p.code === 0 && /^\d+$/.test(p.out) ? Number(p.out) : null;
};

/**
 * Whether something takes a connection at `url`'s address within 1.5 s — a program of any kind, HTTP or not.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
const listensAt = (url) =>
  new Promise((res) => {
    const u = new URL(url);
    const socket = createConnection({ host: u.hostname.replace(/^\[|\]$/g, ""), port: Number(u.port) });
    const done = (/** @type {boolean} */ v) => (socket.destroy(), res(v));
    socket.setTimeout(1500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });

/**
 * Filament under systemd asked to stop once no turn runs (/api/shutdown's ifIdle: refused while one runs, said, exit 5),
 * and waited for until its process has ended — the moment systemd would start it again, 3 s on. → whether it ended: one
 * whose stop hangs runs on past the wait, and systemd takes a start of its unit as done. Where systemd cannot say its
 * process, nothing shows it ended: not ended, so it is restarted, which starts one that has ended too.
 * @param {import("./commands.js").Run} r @param {import("./client.js").Client} client
 */
async function endWhenIdle(r, client) {
  const pid = await mainPid(r.signal);
  await client.post("/shutdown", { ifIdle: true });
  for (const end = Date.now() + tools.stopMs; pid && Date.now() < end; await pause(250, r.signal)) {
    const now = await mainPid(r.signal);
    if (now !== null && now !== pid) return true;
  }
  return pid === 0;
}

/**
 * The Filament systemd runs, once it has started it, waited for up to a minute: `client` where it answers; else `ended`
 * where it ended by itself as it started — its main process gone, or another in its place: systemd starts it again
 * every 3 s, and it ends again —, or neither, where it runs and did not answer in that minute.
 * @param {Pick<import("./commands.js").Run, "signal">} r @param {string} dataDir
 * @returns {Promise<{ client: import("./client.js").Client | null, ended: boolean }>}
 */
async function upOf(r, dataDir) {
  /** @type {number | null} */
  let first = null;
  for (const end = Date.now() + tools.upMs; Date.now() < end; ) {
    try {
      const client = await connect(dataDir, { timeoutMs: 1500, signal: r.signal });
      // One started by hand answers in its place where systemd's could not take the port: not it.
      if (client.state?.supervisor === "systemd") return { client, ended: false };
    } catch (/** @type {any} */ e) {
      if (e?.code === EXIT.interrupted || r.signal?.aborted) throw e;
    }
    const pid = await mainPid(r.signal);
    if (pid === 0 || (pid && first && pid !== first)) return { client: null, ended: true };
    first ||= pid;
    await pause(500, r.signal);
  }
  return { client: null, ended: false };
}

/** What a Filament systemd started did, where it did not come up: ended as it started, or no answer in a minute. @param {boolean} ended */
const upWords = (ended) => (ended ? "systemd started Filament, and it ended as it started" : "systemd started Filament, and it did not answer within a minute");

/**
 * A start or restart whose Filament did not come up, refused in words; the unit stays as it is — systemd starts one that
 * ended again every 3 s, as after a crash, which may pass (a port free again, `filament update --back`, which its words
 * name). Its `notUp` says which of the two it was (`upWords`), for a caller that does more than say it: filament update
 * goes back to the version before.
 * @param {boolean} ended
 */
const notUp = (ended) =>
  Object.assign(
    new CliError(
      `${upWords(ended)}: ${ended ? `systemd starts it again every 3 s — filament service status shows its log, systemctl --user stop ${UNIT} stops it` : "filament service status shows its log"}; after an update, filament update --back goes back to the version before.`,
      EXIT.failed,
    ),
    { notUp: upWords(ended) },
  );

/**
 * `filament stop` and `filament restart` where systemd runs this machine's Filament: through systemctl, so systemd never
 * starts again what was stopped. Once no turn runs, unless --force: Filament is asked to stop where it is idle, and once
 * its process has ended systemd stops the unit (which also takes back the start Restart= would make) or starts it now.
 * --force: `systemctl --user stop|restart filament` at once — SIGTERM, and what is in flight gets up to 20 s.
 * `version`: the one a restart is to bring up (filament update's, which `current` points at now) — another that answers
 * in its place is refused in words, its `another` that version: the unit starts a Filament `current` does not lead to.
 * @param {import("./commands.js").Run} r @param {import("./client.js").Client} client @param {"stop" | "restart"} verb
 * @param {string} [version]
 */
export async function underSystemd(r, client, verb, version) {
  if (!onPath("systemctl")) throw new CliError(`systemd runs this Filament, and there is no systemctl here to ${verb} it with.`, EXIT.failed);
  if (r.flags.force === true) await systemctl([verb, UNIT], r.signal);
  else {
    // Idle, and its stop hung: restarted as --force would (SIGTERM), where a start would leave it running.
    const ended = await endWhenIdle(r, client);
    await systemctl([verb === "stop" ? "stop" : ended ? "start" : "restart", UNIT], r.signal);
  }
  if (verb === "stop") return void r.out("Filament is stopped, and its systemd service with it: it starts again at the next boot or login, or now with filament start.");
  const again = await upOf(r, String(client.state?.dataDir || r.dataDir));
  if (!again.client) throw notUp(again.ended);
  if (version && again.client.version && again.client.version !== version)
    throw Object.assign(
      new CliError(
        `systemd started Filament again, and Filament ${again.client.version} answers at ${again.client.url}, not ${version}: its unit starts another than current leads to — filament service install writes it again, and starts ${version}.`,
        EXIT.failed,
      ),
      { another: again.client.version },
    );
  r.out(`Filament ${again.client.version} runs again at ${again.client.url}, under systemd.`);
}

/**
 * The unit `filament service install` wrote for the data folder `dataDir`, where systemd's user manager runs here and
 * has it enabled; null elsewhere — not Linux, the app's command line, no systemctl or no manager, no unit, another data
 * folder's, or one disabled (an install whose Filament did not come up leaves it so).
 * @param {string} dataDir @param {AbortSignal} [signal]
 */
async function unitFor(dataDir, signal) {
  if (process.platform !== "linux" || process.versions.electron || !onPath("systemctl")) return null;
  const env = await runTool("systemctl", ["--user", "show-environment"], signal);
  if (env.code !== 0) return null;
  const file = unitFile(varsOf(env.out));
  const dir = dataDirOf(existsSync(file) ? readFileSync(file, "utf8") : null);
  if (!dir || pathKey(dir) !== pathKey(dataDir)) return null;
  return (await runTool("systemctl", ["--user", "is-enabled", UNIT], signal)).out === "enabled" ? { file, dataDir: dir } : null;
}

/**
 * `filament start`, and `filament restart` with nothing running, where systemd's unit runs this data folder's Filament:
 * `systemctl --user start filament`, and its answer waited for — so the one that runs is the one systemd runs, its
 * restart after a crash and its stop with it, never one by hand beside it. → false where no such unit is here: the
 * caller starts Filament its own way.
 * @param {Pick<import("./commands.js").Run, "dataDir" | "flags" | "out" | "signal">} r
 * @returns {Promise<boolean>}
 */
export async function startUnit(r) {
  const unit = await unitFor(resolve(r.dataDir), r.signal);
  if (!unit) return false;
  await systemctl(["start", UNIT], r.signal);
  const up = await upOf(r, unit.dataDir);
  if (!up.client) throw notUp(up.ended);
  r.out(`Filament ${up.client.version} runs at ${up.client.url}, under systemd: filament stop stops it, filament service status says how it runs.`);
  if (r.flags.port !== undefined || r.flags.host !== undefined) r.out(`Its port and host are its unit's (${unit.file}): filament service install --port <n> writes it again with another.`);
  return true;
}

/**
 * The way cleared for the service: the Filament this data folder runs now, and the one at the port the service listens
 * on. One systemd runs stays (a new unit restarts it); one run by hand is stopped once no turn runs; the app's, another
 * data folder's at that port, or a program other than Filament listening there, is refused in words. → the client of the
 * one systemd runs, where it does.
 * @param {import("./commands.js").Run} r @param {string} dataDir @param {number | null} port
 */
async function clearWay(r, dataDir, port) {
  const where = whereFilament(dataDir);
  const own = where.url;
  const at = port != null ? listeningUrl("", port) : own;
  /** @type {import("./client.js").Client | null} */
  let systemd = null;
  for (const url of [...new Set([at, own])]) {
    const state = await stateAt(url);
    if (!state) {
      // No Filament answers at the service's port, and something listens there all the same — not this data folder's own
      // Filament, whose listening.json says its live process listens there: the service would fail at each start, and
      // systemd start it again every 3 s.
      if (url === at && !(where.from === "listening" && at === own) && (await listensAt(at)))
        throw new CliError(`Something other than Filament listens at ${at}: the service would find its port taken, and fail at each start. Stop it, or give --port with a port nothing holds.`, EXIT.failed);
      continue;
    }
    if (typeof state.dataDir === "string" && pathKey(state.dataDir) !== pathKey(dataDir)) {
      if (url !== at) continue;
      throw new CliError(`The Filament at ${url} runs from ${state.dataDir}, and the service would find its port taken: stop that one, or give --port.`, EXIT.failed);
    }
    if (state.supervisor === "systemd") {
      systemd = clientAt(url, state);
      continue;
    }
    if (state.supervisor === "desktop") throw new CliError(`The Filament app runs this data folder's Filament (at ${url}), and starts it again when it stops: quit the app (its tray's Quit) first.`, EXIT.failed);
    // One run by hand — `filament start` in a terminal, tmux: the service takes its place, once no turn runs.
    await clientAt(url, state).post("/shutdown", { ifIdle: true });
    for (const end = Date.now() + (STOP_SEC + 30) * 1000; Date.now() < end && (await stateAt(url)); ) await pause(500, r.signal);
    if (await stateAt(url)) throw new CliError(`The Filament at ${url} was asked to stop, and still answers: stop it (filament stop --force), then run this again.`, EXIT.failed);
    r.out(`Stopped the Filament that ran at ${url}, started by hand: systemd runs it from now on.`);
  }
  return systemd;
}

/** `filament service install`. @param {import("./commands.js").Run} r */
async function install(r) {
  const env = await manager(r);
  let port = null;
  if (r.flags.port !== undefined) {
    try {
      port = portOption(r.flags.port === true ? undefined : r.flags.port);
    } catch (/** @type {any} */ e) {
      throw new CliError(e.message, EXIT.usage);
    }
    if (!port) throw new CliError("--port 0 picks another port at each start: a service takes one from 1 to 65535.", EXIT.usage);
  }
  const dataDir = resolve(r.dataDir);
  const file = unitFile(env);
  const launcher = launcherOf(ROOT);
  const text = unitText({ ...launcher, dataDir, port, env });
  const was = existsSync(file) ? readFileSync(file, "utf8") : null;
  const running = await clearWay(r, dataDir, port);
  const active = (await runTool("systemctl", ["--user", "is-active", UNIT], r.signal)).out === "active";
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  r.out(`Wrote ${file}${was === null ? "" : was === text ? " (as it was)" : " (in place of the one there)"}. It runs ${launcher.words}; its data folder is ${dataDir}${port != null ? `, its port ${port}` : ""}.`);
  await systemctl(["daemon-reload"], r.signal);
  await systemctl(["enable", "--now", UNIT], r.signal);
  if (active && was !== text) {
    // The one systemd runs goes on with the unit it started with: restarted on the new one, once no turn runs.
    const old = running || (await connect(dataDirOf(was) || dataDir, { timeoutMs: 1500 }).catch(() => null));
    if (!old) await systemctl(["restart", UNIT], r.signal);
    else
      try {
        await systemctl([(await endWhenIdle(r, old)) ? "start" : "restart", UNIT], r.signal);
      } catch (/** @type {any} */ e) {
        if (e?.code !== EXIT.busy) throw e;
        throw new CliError(`The unit is written; the Filament systemd runs goes on with the old one, as ${e.message.replace(/^not stopped: /, "")} — filament restart, once it ends, starts it on the new one.`, EXIT.busy);
      }
  }
  const { client, ended } = await upOf(r, dataDir);
  if (!client) {
    // Left enabled, systemd would start it again every 3 s from now on, and at each boot: stopped and disabled, its unit
    // kept for status to show, and its log said.
    await systemctl(["disable", "--now", UNIT], r.signal);
    const journal = await runTool("journalctl", ["--user", "-u", UNIT, "-n", "10", "--no-pager"], r.signal);
    const log = journal.code === 0 && journal.out ? `\nIts log's last lines (journalctl --user -u ${UNIT}):\n${journal.out.split("\n").map((l) => `  ${l}`).join("\n")}` : "";
    throw new CliError(`${upWords(ended)} — so it is stopped and disabled, and systemd does not start it again and again; its unit stays in ${file}. Once its cause is fixed, filament service install starts it again.${log}`, EXIT.failed);
  }
  const user = userOf(env);
  // At boot where lingering is on alone: off, the last session's end stops it (the sv-live hunt's).
  const linger = await lingerOf(user, r.signal);
  r.out(`Filament ${client.version} runs at ${client.url} under systemd: started ${linger ? "at boot" : `as ${user} logs in`}, and again 3 s after it ends by itself.`);
  r.out(lingerWords(linger, user));
  r.out("filament service status says how it runs, filament service logs follows its log, filament service uninstall removes it.");
}

/**
 * `filament service uninstall`: stopped as `filament stop` stops it, then disabled and its unit removed. A Filament of
 * its data folder's that still answers then — started by hand, or by the app — is said, with how it stops.
 * @param {import("./commands.js").Run} r
 */
async function uninstall(r) {
  const file = unitFile(await manager(r));
  if (!existsSync(file)) return void r.out(`No Filament service is installed here: there is no ${file}.`);
  const dataDir = dataDirOf(readFileSync(file, "utf8")) || r.dataDir;
  const url = whereFilament(dataDir).url;
  const state = r.flags.force === true ? null : await stateAt(url);
  if (state?.supervisor === "systemd") await endWhenIdle(r, clientAt(url, state));
  await systemctl(["disable", "--now", UNIT], r.signal);
  rmSync(file, { force: true });
  await systemctl(["daemon-reload"], r.signal);
  const at = whereFilament(dataDir).url;
  const still = await stateAt(at);
  if (!still || (typeof still.dataDir === "string" && pathKey(still.dataDir) !== pathKey(dataDir)))
    return void r.out(`Removed ${file}: Filament is stopped, and starts no more at boot or after a crash. filament start runs it by hand.`);
  const by =
    still.supervisor === "desktop"
      ? "run by the Filament app: quit the app (its tray's Quit) to stop it"
      : still.supervisor === "systemd"
        ? "run by systemd from a unit not this one: systemctl status (or systemctl --user status) says which"
        : "started by hand: filament stop stops it";
  r.out(`Removed ${file}: systemd starts Filament no more, at boot or after a crash. A Filament of its data folder still runs at ${at}, ${by}.`);
}

/** `filament service status`. @param {import("./commands.js").Run} r */
async function status(r) {
  const env = await manager(r);
  const file = unitFile(env);
  const text = existsSync(file) ? readFileSync(file, "utf8") : null;
  const user = userOf(env);
  const [active, enabled, linger, journal] = await Promise.all([
    runTool("systemctl", ["--user", "is-active", UNIT], r.signal),
    runTool("systemctl", ["--user", "is-enabled", UNIT], r.signal),
    lingerOf(user, r.signal),
    runTool("journalctl", ["--user", "-u", UNIT, "-n", "20", "--no-pager"], r.signal),
  ]);
  const dataDir = dataDirOf(text) || r.dataDir;
  const answers = text ? await connect(dataDir, { timeoutMs: 1500 }).catch(() => null) : null;
  const s = {
    installed: !!text,
    unit: file,
    active: active.out || "unknown",
    enabled: enabled.out || "unknown",
    execStart: execLine(text) || null,
    dataDir: text ? dataDir : null,
    linger,
    filament: answers ? { version: answers.version, url: answers.url, supervisor: answers.state?.supervisor ?? null } : null,
    journal: journal.code === 0 ? journal.out.split("\n").filter(Boolean) : [],
    journalError: journal.code === 0 ? null : firstLine(journal.err || journal.out) || `exit ${journal.code}`,
  };
  if (r.flags.json === true) return void r.out(JSON.stringify(s, null, 2));
  if (!s.installed) {
    r.out(`No Filament service is installed here (no ${file}): filament service install runs Filament under systemd — started at boot, and again after a crash.`);
    if (s.active === "active") r.out(`systemd runs a ${UNIT} unit from elsewhere all the same: systemctl --user status ${UNIT} says which.`);
    return;
  }
  r.out(
    [
      `Filament's service: ${s.active}, ${s.enabled}`,
      `  unit     : ${file}`,
      `  runs     : ${s.execStart}`,
      `  filament : ${s.filament ? `${s.filament.version} answers at ${s.filament.url}${s.filament.supervisor === "systemd" ? "" : `, started by ${s.filament.supervisor || "hand"}, not by systemd`}` : "does not answer"}`,
      `  linger   : ${linger === null ? "not read (loginctl)" : linger ? "on — it starts at boot" : `off — it starts as ${user} logs in (loginctl enable-linger ${user} starts it at boot)`}`,
    ].join("\n"),
  );
  r.out(s.journalError ? `Its log could not be read (journalctl: ${s.journalError}).` : s.journal.length ? `Its log's last lines (journalctl --user -u ${UNIT}):\n${s.journal.map((l) => `  ${l}`).join("\n")}` : "Its log holds nothing yet.");
}

/** `filament service logs`: the unit's log followed (journalctl -f) until Ctrl+C. @param {import("./commands.js").Run} r */
async function logs(r) {
  await manager(r);
  const file = onPath("journalctl");
  if (!file) throw new CliError("There is no journalctl here to read Filament's log with.", EXIT.failed);
  return new Promise((res, rej) => {
    const child = tools.spawn(file, ["--user", "-u", UNIT, "-f"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stop = () => child.kill("SIGTERM");
    r.signal?.addEventListener("abort", stop, { once: true });
    child.stdout?.on("data", (d) => r.write(String(d)));
    child.stderr?.on("data", (d) => r.err(String(d).trimEnd()));
    child.on("error", (e) => rej(new CliError(`journalctl: ${e.message}`, EXIT.failed)));
    child.on("close", (code) => {
      r.signal?.removeEventListener("abort", stop);
      if (code && !r.signal?.aborted) rej(new CliError(`journalctl ended: exit ${code}`, EXIT.failed));
      else res(EXIT.ok);
    });
  });
}

/** `filament service <install | uninstall | status | logs>`. @param {import("./commands.js").Run} r @returns {Promise<number | void>} */
export async function runService(r) {
  const [sub = "status"] = r.words;
  if (sub === "install") return install(r);
  if (sub === "uninstall") return uninstall(r);
  if (sub === "status") return status(r);
  if (sub === "logs") return logs(r);
  throw new CliError(`no service command "${sub}" — filament help service`, EXIT.usage);
}
