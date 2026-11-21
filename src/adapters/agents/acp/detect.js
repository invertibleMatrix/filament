// Which of the known agents are installed on this machine and, where their CLI or their files can say, signed in — and as
// whom; and a visible console opened on an agent's login command so the person can follow the browser or code prompts.
import { spawn } from "node:child_process";
import { CANNOT_TELL, statusReading } from "../../../core/agent-limits.js";
import { CURSOR_SDK, KNOWN_AGENTS, agentKey, agentLaunchEnv, agentUpstream, agentRoute, commandLine, seededOn, viaRegistry } from "../../../core/catalogues.js";
import { agentEnv, commandExists, packageVersion, resolveAgentCommand } from "../agent-process.js";
import { killTree } from "../../tools/kill-tree.js";
import { findSdkDir, resetSdkCache } from "../cursor-sdk.js";

/** The known agents found on this computer's PATH: not one ACP's registry installs (`viaRegistry`), which no PATH holds. */
export function detectAgents() {
  return KNOWN_AGENTS.filter((a) => !viaRegistry(a)).map((a) => ({ ...a, installed: commandExists(a.command), loggedIn: null }));
}
/**
 * Whether an agent of Settings → Coding agents' catalogue is on this computer (HarnessV3-ACP AC3-8): a known agent's
 * program, or Cursor's SDK package.
 * @param {{ id: string, command?: string }} a
 */
export function catalogueInstalled(a) {
  return a.id === CURSOR_SDK.id ? !!findSdkDir() : commandExists(a.command);
}
/**
 * Whether the program an agent upstream runs is on this computer (HarnessV3-ACP AC3-8): Cursor's SDK package for its
 * SDK route; else the command it starts, its own or `command`, the catalogue's name for it.
 * @param {{ type?: string, acp?: { command?: string } }} u @param {string} [command]
 */
export function programHere(u, command) {
  return u.type === CURSOR_SDK.type ? !!findSdkDir() : commandExists(u.acp?.command || command);
}
/**
 * The version of an agent of the catalogue that npm installs, as installed here (HarnessV3-ACP AF3): its package's own,
 * above the script `command` (else the catalogue's name for it) starts; Cursor's SDK's where it is found. What its next
 * start runs: the version an agent declared when it last started is older once it was updated since. Null for one its
 * maker's script installs, and for one not here.
 * @param {{ id: string, command?: string, install?: { npm: string } | { script: any } }} a @param {string} [command]
 * @returns {string | null}
 */
export function catalogueVersion(a, command) {
  const pkg = a.install && "npm" in a.install ? a.install.npm : null;
  if (!pkg) return null;
  if (a.id === CURSOR_SDK.id) {
    const sdk = findSdkDir();
    return sdk && sdk.version !== "?" ? sdk.version : null;
  }
  return packageVersion(command || a.command, pkg);
}
/**
 * After an agent of the catalogue was installed: Cursor's SDK is looked for afresh at its next use, where a failed
 * look was kept (HarnessV3-ACP AC3-8).
 * @param {{ id: string }} a
 */
export function catalogueInstalledNow(a) {
  if (a.id === CURSOR_SDK.id) resetSdkCache();
}
// The first-run seed: the upstream and route each detected agent gets — on where `seededOn` says, its route on either
// way. The config store takes it as a parameter (a service may not import an adapter); the composition root, the
// doctor and the config.js shim all hand in this one.
export const detectedAgentSeed = () =>
  detectAgents().map((a) => ({ upstream: agentUpstream(a, { enabled: seededOn(a) }), route: agentRoute(a, { enabled: true }) }));
// Same, plus each agent's login state (asked asynchronously, cached a minute): the dashboard's agents table.
const loginCache = new Map(); // agent id -> { at, value }
export async function detectAgentsWithStatus({ ttlMs = 60000 } = {}) {
  const base = detectAgents();
  return Promise.all(
    base.map(async (a) => {
      if (!a.installed || !a.status) return a;
      const c = loginCache.get(a.id);
      if (c && Date.now() - c.at < ttlMs) return { ...a, loggedIn: c.value };
      const value = await loginStatus(a);
      loginCache.set(a.id, { at: Date.now(), value });
      return { ...a, loggedIn: value };
    }),
  );
}
// true / false where the agent's CLI or its files can tell, null where they cannot. Never synchronous: this proxy
// streams other people's requests while it asks.
export function loginStatus(a, o = {}) {
  return readLogin(a, o).then((r) => r.signedIn);
}
/**
 * An agent of the catalogue's sign-in, read without a turn (the owner's of 10-30: the picker offers an agent only while
 * someone is signed in to it): its CLI's status command, run with the agent's own variables (Qoder CN's site) and the
 * ones its upstream starts it with (`env`: an account's folder) — someone, as whom where they say,
 * nobody, or null where they can't tell (core/agent-limits.js `SignInReading`). `command`: the program its upstream runs,
 * where the status is that program's own. A CLI that fails to start, hangs past `timeoutMs` or prints nothing it can
 * read can't tell. Never synchronous.
 * @param {{ env?: Record<string, string>, status?: { cmd?: string, args?: string[], parse: string } }} a
 * @param {{ timeoutMs?: number, env?: Record<string, unknown>, envRemove?: unknown, command?: string }} [o]
 * @returns {Promise<import("../../../core/agent-limits.js").SignInReading>}
 */
export function readLogin(a, { timeoutMs = 12000, env = {}, envRemove = [], command = "" } = {}) {
  const status = a?.status;
  if (!status) return Promise.resolve(CANNOT_TELL);
  const vars = agentEnv({ NO_COLOR: "1", ...(a.env || {}), ...env }, envRemove).env;
  if (!status.cmd) return Promise.resolve(CANNOT_TELL);
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    try {
      const spec = resolveAgentCommand(command || status.cmd, status.args || []);
      const child = spawn(spec.file, spec.args, { windowsHide: true, env: vars, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.stdout.on("error", () => {});
      child.stderr.on("error", () => {});
      // With what it started: a `cmd /c` that runs the CLI ends with it.
      const t = setTimeout(() => {
        void killTree(child);
        resolve(CANNOT_TELL);
      }, timeoutMs);
      child.on("error", () => {
        clearTimeout(t);
        resolve(CANNOT_TELL);
      });
      child.on("close", () => {
        clearTimeout(t);
        resolve(statusReading(status.parse, out, err));
      });
    } catch {
      resolve(CANNOT_TELL);
    }
  });
}
/**
 * An agent upstream's sign-in, read as its catalogue agent's is (`readLogin`): with the program it runs where the status
 * is that program's (a full path, `cursor-agent`), and the variables it starts with. Can't tell for an agent the
 * catalogue reads no sign-in of (one of ACP's registry, Cursor's SDK route), and for one whose program isn't here.
 * @param {any} u @param {{ timeoutMs?: number }} [o]
 */
export function upstreamLogin(u, o = {}) {
  const known = KNOWN_AGENTS.find((a) => a.id === agentKey(u) && (a.type || "acp") === u?.type);
  if (!known?.status || !programHere(u, known.command)) return Promise.resolve(CANNOT_TELL);
  return readLogin(known, { ...o, env: agentLaunchEnv(u), envRemove: u.acp?.envRemove, command: known.status.cmd === known.command ? u.acp?.command || "" : "" });
}
/**
 * How an agent's sign-in opens in a console of its own on `platform`: its catalogue command (`signIn`) with the
 * agent's own variables (Qoder CN's site) — a cmd window on Windows, given them as its environment; Terminal on macOS,
 * which starts its own shell, set in the line —, and the line a person runs in a terminal of their own. No program
 * elsewhere; null where the catalogue names no sign-in command.
 * @param {any} a  a catalogue agent @param {string} platform  `process.platform`
 * @returns {{ program: string, args: string[], vars: Record<string, string>, line: string } | null}
 */
export function loginLaunch(a, platform) {
  const argv = Array.isArray(a?.signIn) ? a.signIn.map(String) : [];
  if (!argv.length) return null;
  /** @type {Record<string, string>} */
  const vars = Object.fromEntries(Object.entries(a.env || {}).map(([k, v]) => [k, String(v)]));
  const line = commandLine(argv, vars, platform);
  const title = `Filament: log in to ${String(a.name || a.id).replace(" (agent via ACP)", "")}`;
  if (platform === "win32") return { program: "cmd.exe", args: ["/c", "start", title, "cmd", "/k", argv.join(" ")], vars, line };
  if (platform === "darwin") return { program: "osascript", args: ["-e", `tell application "Terminal" to activate do script (${JSON.stringify(line)})`], vars: {}, line };
  return { program: "", args: [], vars, line };
}
// Open a visible console running the agent's sign-in so the user can follow the browser / code prompts; elsewhere the
// line is returned for the user to run.
export function startAgentLogin(a) {
  const how = loginLaunch(a, process.platform);
  if (!how) throw new Error(`${a?.id || "agent"} has no login command`);
  if (!how.program) return { ok: false, command: how.line, note: `run this in a terminal yourself: ${how.line}` };
  const child = spawn(how.program, how.args, { detached: true, stdio: "ignore", windowsHide: false, shell: false, env: agentEnv(how.vars).env });
  child.on("error", () => {});
  child.unref();
  return { ok: true, command: how.line };
}
