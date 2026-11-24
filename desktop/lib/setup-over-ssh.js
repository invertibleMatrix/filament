// @ts-check
// A Linux machine set up from the desk over SSH (the remote desk's s3b): from user@host — or a Host of your SSH config —
// to Filament installed there, run by systemd, its coding agents connected and memory on, reached over https, and this
// window paired with it as a full device. Each step (`STEPS`) is asked on its own, by the setup sheet of This computer's
// harness (src/ui/harness/ssh-setup.js), so its progress shows step by step and a failed one is tried again alone; each
// reads what stands there first and does only what is missing — a machine set up already answers every step with
// nothing to do. Commands run there in batch mode (ssh-exec.js `runSsh`); what only the person answers — a host key ssh
// does not know, a password, sudo — goes to a terminal of the desk's, ssh's own program in it (`sshTerminal`), the step
// asked again once it ends well. A pairing's code is made there over SSH (`filament pair --json`) and claimed by this
// window itself, as the Add sheet claims one (lib/rail.js `add`): through the https way it answers at — the tailnet's
// first, then the network's, its certificate pinned —, else through an SSH tunnel this computer holds, the SSH way kept
// after an https one on the same machine. Plain Node; every outside reach is a seam for its test.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { FILAMENT_PORT, aliasOf } from "./ssh-route.js";
import { probeSsh, runSsh, shQuote, sshTerminal } from "./ssh-exec.js";
import { PAIR_MS, PAIR_SCRIPT } from "./add-machine.js";
import { isNewer } from "../../src/services/updates.js";

/** Where install.sh is downloaded from: the newest release's, which installs any version asked of it. */
export const INSTALL_URL = "https://github.com/invertibleMatrix/filament/releases/latest/download/install.sh";
/** A release's feed for servers, which install.sh reads first: there, the release is out. @param {string} version */
export const feedUrl = (version) => `https://github.com/invertibleMatrix/filament/releases/download/v${version}/latest-server.yml`;
/** How long the install may take: a release downloaded, checked and unpacked. */
export const INSTALL_MS = 10 * 60_000;
/** How long `filament service install` may take: a Filament started by hand stopped once no turn runs, then systemd's started. */
export const SERVICE_MS = 3 * 60_000;
/** How long one coding agent's connect may take: its adapter fetched, as `filament agents connect` waits (its ssh run a minute more). */
export const CONNECT_MS = 5 * 60_000;
/** How long a look there may take. */
const LOOK_MS = 60_000;
/** How often, and how far apart, Tailscale is asked whether it serves Filament yet, before a pairing's code is made: its serve starting. */
const TAILNET_TRIES = 3;
const TAILNET_GAP_MS = 3_000;
/** Filament as install.sh installed it there. */
const FILAMENT = '"$HOME/.local/bin/filament"';
/** A release's version, as install.sh takes one. */
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
/** A coding agent's id, as `filament agents connect` takes one. */
const AGENT_ID = /^[\w.-]{1,64}$/;

/** The steps, in their order: each asked on its own (`run`). */
export const STEPS = Object.freeze([
  { id: "reach", title: "Reach it over SSH" },
  { id: "install", title: "Install Filament" },
  { id: "service", title: "Run it as a service" },
  { id: "setup", title: "Its coding agents and memory" },
  { id: "route", title: "A way in over https" },
  { id: "pair", title: "Pair this window with it" },
]);
const STEP_IDS = new Set(STEPS.map((s) => s.id));

/**
 * @typedef {import("./ssh-exec.js").SshRun} SshRun
 * @typedef {import("./ssh-exec.js").RunWhat} RunWhat
 * @typedef {import("./ssh-exec.js").Platform} Platform
 * @typedef {import("./machines.js").Machine} Machine
 * @typedef {import("./machines.js").Route} Route
 * @typedef {{ title: string, file: string, args: string[], line: string | null }} StepTerminal  ssh as the program of a
 *   terminal of the desk's, and the line a person types for it in a shell of their own, where there is one
 * @typedef {{ words: string, line: string, terminal: StepTerminal | null }} StepLine  what only the person may do there
 *   (sudo, a password typed once): said, its line shown, and run in a terminal of the desk's where they press it
 * @typedef {{ step: string, state: "done" | "skipped" | "failed" | "ask", words: string, terminal?: StepTerminal,
 *   also?: StepLine[], offer?: { label: string, latest: true }, machine?: { id: string, name: string } }} StepResult
 *   `done`: it did its part; `skipped`: it stood done already, nothing changed; `ask`: the terminal (`terminal`) is the
 *   person's to answer, and the step is asked again once it ends well; `also`: lines only the person may run, the step
 *   done all the same; `offer`: the step asked again so (`latest`: the newest release, this app's version unreleased);
 *   `machine`: the machine paired, or kept already
 */

/** The last line a stream said, for words. @param {string} s */
const lastLine = (s) =>
  String(s || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1) || "";
/** The JSON a command printed, from the line it starts at: a login's own words may come first. @param {string} out @param {"{" | "["} open */
const jsonIn = (out, open) => {
  const s = String(out || "");
  const at = s.startsWith(open) ? 0 : s.indexOf(`\n${open}`) + 1;
  if (!at && !s.startsWith(open)) return null;
  try {
    return JSON.parse(s.slice(at));
  } catch {
    return null;
  }
};
/** Names said as a list: "a", "a and b", "a, b and c". @param {string[]} names */
const listed = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * This computer's public SSH key, as ssh-keygen makes one — ed25519's first —, or null where it has none. Public: the
 * line any machine that lets it in holds.
 * @param {string} [home]
 */
export function publicKeyHere(home = homedir()) {
  for (const name of ["id_ed25519.pub", "id_ecdsa.pub", "id_rsa.pub"]) {
    const file = join(home, ".ssh", name);
    try {
      if (!existsSync(file)) continue;
      const line = readFileSync(file, "utf8").split(/\r?\n/)[0].trim();
      if (/^(ssh-|ecdsa-|sk-)[\w@.-]+ [A-Za-z0-9+/=]+( .*)?$/.test(line)) return line;
    } catch {}
  }
  return null;
}

/**
 * What adds a public key to the machine's authorized_keys, once and on a line of its own: run in a terminal where ssh
 * asks the password there. @param {string} key
 */
export const keyScript = (key) =>
  [
    "umask 077",
    'mkdir -p "$HOME/.ssh"',
    'f="$HOME/.ssh/authorized_keys"',
    'touch "$f"',
    `k=${shQuote(key)}`,
    // A last line with no newline after it would take the key onto it, and neither would let anyone in.
    `if ! grep -qxF "$k" "$f"; then [ -n "$(tail -c 1 "$f")" ] && echo >> "$f"; printf '%s\\n' "$k" >> "$f"; fi`,
    `echo "This computer's key is added there: back in Filament, the setup goes on."`,
  ].join("\n");

/**
 * What installs Filament there: install.sh downloaded with curl, else wget, and run with the version asked — none, the
 * newest. Its download failing ends it with code 7.
 * @param {string | null} version
 */
export const installScript = (version) =>
  [
    `u=${shQuote(INSTALL_URL)}`,
    'if command -v curl >/dev/null 2>&1; then s=$(curl -fsSL "$u") || exit 7; else s=$(wget -qO- "$u") || exit 7; fi',
    `printf '%s\\n' "$s" | ${version ? `FILAMENT_VERSION=${shQuote(version)} ` : ""}sh`,
  ].join("\n");

/**
 * Whether a release of Filament for servers is out, asked of GitHub from here: none where its feed is not found, null
 * where GitHub did not say. @param {string} version @param {typeof fetch} [fetchImpl]
 */
export async function releasedAt(version, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(feedUrl(version), { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) });
    return r.status === 404 ? false : r.status < 400 ? true : null;
  } catch {
    return null;
  }
}

/**
 * The setup of machines over SSH, step by step.
 * @param {{ ssh?: typeof runSsh, probe?: (alias: string) => ReturnType<typeof probeSsh>, cli?: () => string, version: string,
 *   pair: (link: string, code?: string) => Promise<{ ok: true, id?: string, name: string, note?: string } | { ok: false, words: string }>,
 *   machines: () => Machine[], addWay: (id: string, route: Route) => unknown, routeFor: (alias: string, port: number) => Promise<Route>,
 *   publicKey?: () => string | null, released?: (version: string) => Promise<boolean | null>, wait?: (ms: number) => Promise<void>,
 *   log?: (line: string) => void }} o
 *   `version`: this app's, which it installs there where that release is out; `pair`: a link paired as the Add sheet
 *   pairs it, the window left where it is (lib/rail.js `add`); `machines`: those this window keeps; `addWay`: a way to a
 *   machine kept, put after its others; `routeFor`: the SSH way to a Filament there (ssh-route.js `createTunnels`)
 */
export function createSetupOverSsh({ ssh = runSsh, probe = (a) => probeSsh(a), cli, version, pair, machines, addWay, routeFor, publicKey = () => publicKeyHere(), released = (v) => releasedAt(v), wait =(ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} }) {
  /**
   * What each machine's last look said, by its alias: its platform, its service's state, whether it is shared on the
   * tailnet. @type {Map<string, { platform?: Platform, service?: any, tailnet?: boolean }>}
   */
  const seen = new Map();
  /** The machines a step runs on now: one at a time each. */
  const busy = new Set();
  const seenOf = (/** @type {string} */ a) => {
    let s = seen.get(a);
    if (!s) seen.set(a, (s = {}));
    return s;
  };
  /** ssh in a terminal of the desk's, named. @param {string} a @param {RunWhat | null} what @param {string} title @returns {StepTerminal} */
  const term = (a, what, title) => ({ title, ...sshTerminal(a, what, cli ? { cli } : {}) });
  /** A command there, by sh. @param {string} a @param {string} script @param {number} [timeoutMs] */
  const sh = (a, script, timeoutMs = LOOK_MS) => ssh(a, { script }, { timeoutMs });

  /**
   * A run that did not do its part, said: a host key ssh does not know is the person's, in a terminal, and the step
   * asked again; a password asked for, this computer's key offered there, typed once; else ssh's words, or the command's.
   * @param {string} step @param {string} a @param {SshRun} r @param {string} what @returns {StepResult}
   */
  const trouble = (step, a, r, what) => {
    if (r.ask === "host-key")
      return { step, state: "ask", words: `ssh does not know ${a}'s host key yet: check that the fingerprint it shows in the terminal is the one ${a} has, and answer yes there — or no.`, terminal: term(a, null, `ssh ${a}`) };
    if (r.ask === "sign-in") {
      const key = publicKey();
      return {
        step,
        state: "failed",
        words: `${a} asks for a password or a code, which a setup from here cannot type: it runs with a key the machine accepts.`,
        also: [
          key
            ? { words: "Add this computer's key there: you type the password once, in the terminal, then Retry.", line: `ssh-copy-id ${a}`, terminal: term(a, { script: keyScript(key) }, `Add this computer's key to ${a}`) }
            : { words: "This computer has no SSH key yet: make one, add it there, then Retry.", line: "ssh-keygen -t ed25519", terminal: null },
        ],
      };
    }
    return { step, state: "failed", words: r.why || lastLine(r.stderr) || `${what} ended with code ${r.code}.` };
  };

  /** @param {string} a @returns {Promise<StepResult>} */
  async function reach(a) {
    const p = await probe(a);
    if (!p.ok) return trouble("reach", a, p.run, `ssh ${a}`);
    const pl = p.platform;
    seenOf(a).platform = pl;
    if (pl.refusal) return { step: "reach", state: "failed", words: pl.refusal };
    if (pl.needs) return { step: "reach", state: "failed", words: pl.needs };
    return { step: "reach", state: "done", words: `${a} answers: ${pl.os} on ${pl.arch}, glibc ${pl.libc}${pl.filament ? `, Filament ${pl.filament} installed there` : ""}.` };
  }

  /** The machine's platform as its last look said it, else looked at now. @param {string} step @param {string} a */
  const platformOf = async (step, a) => {
    const had = seen.get(a)?.platform;
    if (had) return { platform: had };
    const r = await reach(a);
    return r.state === "done" ? { platform: /** @type {Platform} */ (seen.get(a)?.platform) } : { stop: { ...r, step } };
  };

  /**
   * Filament installed there: this app's version where that release is out, else — asked so (`latest`), or this app a
   * build of its own — the newest. One there already is left as it is: Update Filament takes it to this app's.
   * @param {string} a @param {boolean} latest @returns {Promise<StepResult>}
   */
  async function install(a, latest) {
    const got = await platformOf("install", a);
    if ("stop" in got) return /** @type {StepResult} */ (got.stop);
    const want = !latest && VERSION.test(version) ? version : null;
    const had = got.platform.filament;
    if (had)
      return {
        step: "install",
        state: "skipped",
        words: want && isNewer(want, had) ? `Filament ${had} is installed there, older than this app's ${want}: once it is in this window, its Update Filament (its ⋯ in the machines menu) takes it to ${want}.` : `Filament ${had} is installed there.`,
      };
    log(`setup over ssh: installing Filament ${want || "(the newest release)"} on ${a}`);
    const r = await sh(a, installScript(want), INSTALL_MS);
    if (r.code === 7 && r.began) return { step: "install", state: "failed", words: `install.sh could not be downloaded there from ${INSTALL_URL}: ${a} reaches no GitHub, or reached it a moment too late.` };
    if (r.code !== 0 || !r.began) {
      // install.sh says so of any feed it could not read: its release is none only where it is none from here too.
      if (want && /gave no .* at /i.test(r.stderr) && (await released(want)) === false)
        return { step: "install", state: "failed", words: `Filament ${want}, this app's version, has no server build released: this app is a build of its own. The newest release installs instead.`, offer: { label: "Install the newest release", latest: true } };
      return trouble("install", a, r, "install.sh");
    }
    // Its version, as it is there now.
    const again = await probe(a);
    if (again.ok) seenOf(a).platform = again.platform;
    const now = (again.ok ? again.platform.filament : null) || want;
    return { step: "install", state: "done", words: `${now ? `Filament ${now}` : "Filament"} is installed there, in ~/.local/share/filament.` };
  }

  /** `filament service status --json` there: its state, or the run that did not say it. @param {string} a */
  const serviceLook = async (a) => {
    const r = await sh(a, `exec ${FILAMENT} service status --json`);
    const st = r.code === 0 ? jsonIn(r.stdout, "{") : null;
    if (st) seenOf(a).service = st;
    return { r, st };
  };

  /**
   * Filament run by systemd there, started at boot: its user unit installed and running; lingering turned on as its user
   * may, else its sudo line said.
   * @param {string} a @returns {Promise<StepResult>}
   */
  async function service(a) {
    const got = await platformOf("service", a);
    if ("stop" in got) return /** @type {StepResult} */ (got.stop);
    if (!got.platform.filament) return { step: "service", state: "failed", words: `Filament is not installed on ${a} yet: Install Filament first.` };
    if (!got.platform.has.includes("systemctl"))
      return { step: "service", state: "failed", words: `${a} has no systemd: Filament is installed there and runs as you start it (filament start, under tmux or screen), and nothing starts it at boot or after a crash.` };
    let { r, st } = await serviceLook(a);
    if (!st) return trouble("service", a, r, "filament service status");
    const stood = st.installed === true && st.active === "active" && st.enabled === "enabled" && !!st.filament;
    if (!stood) {
      log(`setup over ssh: filament service install on ${a}`);
      const ran = await sh(a, `exec ${FILAMENT} service install`, SERVICE_MS);
      if (ran.code !== 0) return trouble("service", a, ran, "filament service install");
      ({ r, st } = await serviceLook(a));
      if (!st) return trouble("service", a, r, "filament service status");
    }
    let changed = !stood;
    /** @type {StepLine[]} */
    const also = [];
    if (st.linger === false) {
      // Its own lingering, as its user may on most systems; where they may not, the line with sudo.
      await sh(a, 'loginctl enable-linger "$(id -un)" >/dev/null 2>&1; true');
      const after = await serviceLook(a);
      if (after.st) st = after.st;
      if (st.linger !== false) changed = true;
      else
        also.push({
          words: "Lingering is off for its user: Filament starts as they log in, and stops as their last session ends. To start it at boot:",
          line: "sudo loginctl enable-linger $USER",
          terminal: term(a, { script: 'sudo loginctl enable-linger "$(id -un)"' }, `Lingering on ${a}`),
        });
    }
    const v = st.filament?.version ? `Filament ${st.filament.version}` : "Filament";
    const when = st.linger === true ? "at boot" : "as its user logs in";
    return { step: "service", state: changed ? "done" : "skipped", words:`${v} runs there under systemd, started ${when}, and again after a crash.`, ...(also.length ? { also } : {}) };
  }

  /**
   * Its coding agents connected — each found installed there that is not off —, and memory on. Their sign-ins are that
   * machine's own (its Settings › Coding agents).
   * @param {string} a @returns {Promise<StepResult>}
   */
  async function setup(a) {
    const look = await sh(a, [`f=${FILAMENT}`, '"$f" agents detect >/dev/null 2>&1', '"$f" agents list --json || exit $?', "echo", "echo filament-memory", '"$f" settings get memory.enabled 2>/dev/null || true'].join("\n"), CONNECT_MS);
    if (look.code !== 0) return trouble("setup", a, look, "filament agents");
    const [list = "", memory = ""] = String(look.stdout).split(/\n?filament-memory\r?\n/);
    const rows = jsonIn(list.trim(), "[");
    if (!Array.isArray(rows)) return { step: "setup", state: "failed", words: `filament agents on ${a} said no list: ${lastLine(look.stdout) || lastLine(look.stderr) || "nothing"}.` };
    const there = rows.filter((x) => x && x.state !== "missing" && AGENT_ID.test(String(x.id)));
    const connect = there.filter((x) => x.state !== "connected" && x.state !== "off");
    /** @type {string[]} */
    const connected = [];
    /** @type {string[]} */
    const failed = [];
    for (const x of connect) {
      log(`setup over ssh: filament agents connect ${x.id} on ${a}`);
      const r = await sh(a, `exec ${FILAMENT} agents connect ${shQuote(String(x.id))}`, CONNECT_MS + 60_000);
      if (r.code === 0) connected.push(String(x.name || x.id));
      else failed.push(`${x.name || x.id} (${lastLine(r.stderr) || r.why || `code ${r.code}`})`);
    }
    const wasOn = lastLine(memory) === "true";
    if (!wasOn) {
      const r = await sh(a, `exec ${FILAMENT} memory on`);
      if (r.code !== 0) return trouble("setup", a, r, "filament memory on");
    }
    const names = there.map((x) => String(x.name || x.id));
    const unsigned = there.filter((x) => x.state !== "off" && !x.signedIn && !failed.some((f) => f.startsWith(String(x.name || x.id)))).map((x) => String(x.name || x.id));
    const words = [
      !there.length
        ? "No coding agent is installed there: its own models, or this computer's lent there, answer its chats."
        : connected.length
          ? `Connected ${listed(connected)}.`
          : `${listed(names)} ${names.length > 1 ? "are" : "is"} connected already.`,
      failed.length ? `Not connected: ${failed.join("; ")} — that machine's Settings › Coding agents connects ${failed.length > 1 ? "them" : "it"}.` : "",
      unsigned.length ? `${listed(unsigned)} ${unsigned.length > 1 ? "are" : "is"} not signed in there: that machine's Settings › Coding agents signs ${unsigned.length > 1 ? "them" : "it"} in.` : "",
      wasOn ? "Memory is on." : "Memory is on now.",
    ].filter(Boolean);
    // One agent that did not connect stops nothing: it is said, and the machine's own Settings connects it later.
    return { step: "setup", state: connected.length || !wasOn ? "done" : "skipped", words: words.join(" ") };
  }

  /**
   * A way in over https: shared on the tailnet where Tailscale runs there, else its network listener on — the lines only
   * the person may run said with it: Tailscale's operator, the firewall's.
   * @param {string} a @returns {Promise<StepResult>}
   */
  async function route(a) {
    const look = await sh(
      a,
      [
        `f=${FILAMENT}`,
        'echo "lan=$("$f" settings get server.lan.enabled 2>/dev/null)"',
        'echo "serve=$("$f" settings get server.tailscale.serve 2>/dev/null)"',
        "command -v ufw >/dev/null 2>&1 && echo ufw=1",
        "command -v tailscale >/dev/null 2>&1 && echo tailscale=1",
        "true",
      ].join("\n"),
    );
    if (look.code !== 0) return trouble("route", a, look, "filament settings");
    /** @type {Record<string, string>} */
    const k = {};
    for (const line of String(look.stdout).split(/\r?\n/)) {
      const m = /^(\w+)=(.*)$/.exec(line.trim());
      if (m && !(m[1] in k)) k[m[1]] = m[2].trim();
    }
    let running = false;
    if (k.tailscale) {
      const st = await sh(a, "tailscale status --json 2>/dev/null");
      running = jsonIn(st.stdout, "{")?.BackendState === "Running";
    }
    seenOf(a).tailnet = running;
    if (running) {
      const was = k.serve === "true";
      if (!was) {
        const r = await sh(a, `exec ${FILAMENT} settings set server.tailscale.serve true`);
        if (r.code !== 0) return trouble("route", a, r, "filament settings set");
      }
      // Its user may serve — root, or Tailscale's operator, as its prefs name one —, or Tailscale refuses it its serve:
      // that operator named once, with sudo. Prefs that do not read say the line all the same.
      const who = await sh(a, "id -un; tailscale debug prefs 2>/dev/null; true");
      const user = String(who.stdout).split(/\r?\n/)[0].trim();
      const prefs = jsonIn(who.stdout, "{");
      const refused = user !== "root" && (!prefs || String(prefs.OperatorUser || "") !== user);
      /** @type {StepLine[]} */
      const also = refused ? [{ words: "Tailscale serves for root and its operator alone: let its user serve, once.", line: "sudo tailscale set --operator=$USER", terminal: term(a, { script: 'sudo tailscale set --operator="$(id -un)"' }, `Tailscale's operator on ${a}`) }] : [];
      return {
        step: "route",
        state: was ? "skipped" : "done",
        words: `Filament is shared on your tailnet there (tailscale serve), at its https address; the tailnet's HTTPS must be on (Tailscale's admin page, DNS).`,
        ...(also.length ? { also } : {}),
      };
    }
    const was = k.lan === "true";
    if (!was) {
      const r = await sh(a, `exec ${FILAMENT} settings set server.lan.enabled true`);
      if (r.code !== 0) return trouble("route", a, r, "filament settings set");
    }
    /** @type {StepLine[]} */
    const also =
      !was && k.ufw
        ? [{ words: "Where its firewall (ufw) is on, open Filament's two ports — and your cloud's security group, where it has one:", line: "sudo ufw allow 20343:20344/tcp", terminal: term(a, { argv: ["sudo", "ufw", "allow", "20343:20344/tcp"] }, `The firewall on ${a}`) }]
        : [];
    return {
      step: "route",
      state: was ? "skipped" : "done",
      words: `Filament listens on ${a}'s network addresses over https, at port 20343, with a certificate of its own.${k.tailscale ? " Tailscale is there, not signed in: signed in (sudo tailscale up), a setup again shares Filament on your tailnet." : ""}`,
      ...(also.length ? { also } : {}),
    };
  }

  /**
   * This window paired with it as a full device: a machine kept already and reached over https has nothing to do; else
   * a code made there over SSH, claimed at its https ways — the tailnet's first, then the network's —, else through an
   * SSH tunnel; the SSH way kept after an https one.
   * @param {string} a @returns {Promise<StepResult>}
   */
  async function pairStep(a) {
    let st = seen.get(a)?.service ?? null;
    if (!st?.dataDir) {
      const look = await serviceLook(a);
      if (!look.st) return trouble("pair", a, look.r, "filament service status");
      st = look.st;
    }
    const port = Number(/:(\d+)\/?$/.exec(String(st?.filament?.url || ""))?.[1]) || FILAMENT_PORT;
    // A machine you disconnected stays so: no way is added to it.
    const sshWay = async (/** @type {string} */ id) => {
      const m = machines().find((x) => x.id === id);
      if (!m || m.off || m.routes.some((r) => r.kind === "ssh" && /** @type {any} */ (r).alias === a)) return;
      try {
        addWay(id, await routeFor(a, port));
      } catch (/** @type {any} */ e) {
        log(`setup over ssh: ${id}'s SSH way not kept (${String(e?.message || e)})`);
      }
    };
    // Its id, as its data folder keeps it: a machine this window keeps over https already is set.
    if (st?.dataDir) {
      const r = await ssh(a, { argv: ["cat", `${st.dataDir}/machine.json`] }, { timeoutMs: LOOK_MS });
      const id = String(jsonIn(r.stdout, "{")?.id || "").toLowerCase();
      const kept = id ? machines().find((m) => m.id === id) : null;
      if (kept && kept.routes.some((x) => x.kind === "lan" || (x.kind === "url" && String(x.url).startsWith("https:")))) {
        await sshWay(kept.id);
        return { step: "pair", state: "skipped", words: `${kept.name} is in this window already, reached over https.`, machine: { id: kept.id, name: kept.name } };
      }
      // Kept through its tunnel already — no https way of it answered here when it was paired —: paired again, it would
      // only sign out the device it has. Removed from the window, a setup again tries its https ways anew.
      if (kept && kept.routes.some((x) => x.kind === "ssh" && /** @type {any} */ (x).alias === a))
        return { step: "pair", state: "skipped", words: `${kept.name} is in this window already, through an SSH tunnel this computer holds.`, machine: { id: kept.id, name: kept.name } };
    }
    // Shared on the tailnet a moment ago: its serve starting, its address comes a little later — waited for before the
    // code is made, so one setup leaves one code open there.
    let served = !seen.get(a)?.tailnet;
    for (let i = 0; !served && i < TAILNET_TRIES; i++) {
      if (i) await wait(TAILNET_GAP_MS);
      served = /127\.0\.0\.1:\d+/.test(String((await sh(a, "tailscale serve status --json 2>/dev/null; true")).stdout));
    }
    const r0 = await ssh(a, { script: PAIR_SCRIPT }, { timeoutMs: PAIR_MS });
    const p = r0.code === 0 ? jsonIn(r0.stdout, "{") : null;
    if (typeof p?.code !== "string" || !p.code) return trouble("pair", a, r0, "filament pair");
    const tailnet = Array.isArray(p.links) ? p.links.map(String).filter((/** @type {string} */ l) => /^https:\/\/[^/:]+\.ts\.net[/:#]/i.test(l)) : [];
    const links = [...tailnet, ...(Array.isArray(p.links) ? p.links.map(String).filter((/** @type {string} */ l) => /^https:/i.test(l) && /[#&]fp=/.test(l)) : [])];
    /** @type {string[]} */
    const whys = [];
    if (seen.get(a)?.tailnet && !tailnet.length) whys.push("its tailnet address did not come: is the tailnet's HTTPS on, and may its user serve?");
    for (const link of links) {
      const r = await pair(link);
      if (r.ok) {
        const id = String(r.id || p.machine?.id || "").toLowerCase();
        if (id) await sshWay(id);
        return { step: "pair", state: "done", words: `Paired with ${r.name} at ${new URL(link).origin}, as a full device: it is in this window, its SSH way kept after it.`, machine: { id, name: r.name } };
      }
      whys.push(r.words);
    }
    // No https way answered here: paired through a tunnel this computer holds, with the code made already.
    const r = await pair(`ssh://${a}:${port}`, p.code);
    const no = whys.length ? `no https way of it answered here (${whys.at(-1)})` : "it has no https way yet";
    if (!r.ok) return { step: "pair", state: "failed", words: `Not paired: ${no}, and through an SSH tunnel: ${r.words}` };
    return {
      step: "pair",
      state: "done",
      words: r.note ? `${r.name} is in this window through an SSH tunnel, with no device there: ${r.note}` : `Paired with ${r.name} through an SSH tunnel this computer holds while it is in this window: ${no}.`,
      machine: { id: String(r.id || p.machine?.id || "").toLowerCase(), name: r.name },
    };
  }

  return {
    /**
     * One step of the setup of the machine at `alias`. `latest`: the install takes the newest release, not this app's.
     * @param {{ alias?: unknown, step?: unknown, latest?: unknown }} input @returns {Promise<StepResult>}
     */
    async run(input) {
      const step = String(input?.step || "");
      if (!STEP_IDS.has(step)) return { step, state: "failed", words: `No setup step "${step.slice(0, 40)}".` };
      const a = aliasOf(String(input?.alias ?? "").trim().replace(/^ssh:\/\//i, ""));
      if (!a) return { step, state: "failed", words: `"${String(input?.alias ?? "").slice(0, 80)}" is no SSH host: user@host, or a Host of your SSH config.` };
      if (busy.has(a)) return { step, state: "failed", words: `A step of ${a}'s setup is under way already — one a sheet closed meanwhile asked goes on until it ends: Retry once it has.` };
      busy.add(a);
      try {
        // The first step looks anew: what the last setup saw there may have changed since.
        if (step === "reach") seen.delete(a);
        const r =
          step === "reach"
            ? await reach(a)
            : step === "install"
              ? await install(a, input?.latest === true)
              : step === "service"
                ? await service(a)
                : step === "setup"
                  ? await setup(a)
                  : step === "route"
                    ? await route(a)
                    : await pairStep(a);
        log(`setup over ssh: ${a} ${step}: ${r.state}`);
        return r;
      } catch (/** @type {any} */ e) {
        return { step, state: "failed", words: String(e?.message || e) };
      } finally {
        busy.delete(a);
      }
    },
  };
}
