// @ts-check
// A Linux machine or a Windows host set up from the desk over SSH (the remote desk's s3b, s3f5): from user@host — or a
// Host of your SSH config — to Filament installed there, run as a service (systemd's; a Windows host's Task Scheduler),
// its coding agents connected and memory on, reached over https, and this window paired with it as a full device. What
// runs there is sh's on Linux and PowerShell's on a Windows host (`KITS`), as its probe found it. Each step (`STEPS`)
// is asked on its own, by the setup sheet of This computer's
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
import { probeSsh, psQuote, runSsh, shQuote, sshTerminal } from "./ssh-exec.js";
import { PAIR_MS, PAIR_PS, PAIR_SCRIPT } from "./add-machine.js";
import { isNewer, serverFeed } from "../../src/services/updates.js";

/** Where install.sh is downloaded from: the newest release's, which installs any version asked of it. */
export const INSTALL_URL = "https://github.com/invertibleMatrix/filament/releases/latest/download/install.sh";
/** Where a Windows host's install.ps1 is downloaded from: the newest release's, as install.sh's. */
export const INSTALL_PS_URL = "https://github.com/invertibleMatrix/filament/releases/latest/download/install.ps1";
/**
 * A release's feed for the machine's servers, which install.sh reads first: there, the release is out for it — arm64's
 * its own, which a release may be without. @param {string} version @param {string | null} [target]  the probe's
 */
export const feedUrl = (version, target) => `https://github.com/invertibleMatrix/filament/releases/download/v${version}/${serverFeed(target || undefined)}`;
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
/** Filament as install.ps1 installed it on a Windows host, in `$f`: its current version's launcher, in the user's own folder. */
const PS_FILAMENT = "$f = Join-Path $env:LOCALAPPDATA 'filament\\current\\bin\\filament.cmd'";
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
 * @typedef {{ words: string, line: string | null, terminal: StepTerminal | null }} StepLine  what only the person may do
 *   there (sudo, a password typed once): said, its line shown where it has one, and run in a terminal of the desk's
 *   where they press it
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
 * What adds a public key to the machine's authorized_keys, once and on a line of its own, its folder and file left
 * writable by its user alone (sshd's StrictModes): run in a terminal where ssh asks the password there. A write that
 * fails ends it with code 1 and its words, never with the line that says the key is added (the hunt on s3b).
 * @param {string} key
 */
export const keyScript = (key) =>
  [
    "umask 077",
    'f="$HOME/.ssh/authorized_keys"',
    `k=${shQuote(key)}`,
    `fail() { echo "This computer's key is not added there: $f could not be $1." >&2; exit 1; }`,
    'mkdir -p "$HOME/.ssh" || fail made',
    'touch "$f" || fail made',
    // A last line with no newline after it would take the key onto it, and neither would let anyone in.
    `if ! grep -qxF "$k" "$f"; then { [ -z "$(tail -c 1 "$f")" ] || echo; printf '%s\\n' "$k"; } >> "$f" || fail written; fi`,
    'grep -qxF "$k" "$f" || fail "read back with the key in it"',
    'chmod go-w "$HOME/.ssh" "$f" 2>/dev/null',
    `echo "This computer's key is added there: back in Filament, the setup goes on."`,
  ].join("\n");

/** Whether the user there is an administrator, as Windows' OpenSSH reads their keys: the Administrators group's SID, in any language. */
const PS_ADMIN = "[bool]((whoami /groups) -match 'S-1-5-32-544')";

/**
 * What adds a public key on a Windows host, by its PowerShell: an administrator's to
 * %ProgramData%\ssh\administrators_authorized_keys, the file Windows' OpenSSH reads for them, its access then
 * Administrators' and SYSTEM's alone (by their SIDs) as OpenSSH requires; another user's to .ssh\authorized_keys in
 * their profile. Once and on a line of its own; a write that fails ends it with code 1 and its words.
 * @param {string} key @param {string} [admin]  whether its user is an administrator, as PowerShell says it
 */
export const keyPs = (key, admin = PS_ADMIN) =>
  [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    `  $k = ${psQuote(key)}`,
    `  $admin = ${admin}`,
    "  if ($admin) { $f = Join-Path $env:ProgramData 'ssh\\administrators_authorized_keys' }",
    "  else { $d = Join-Path $env:USERPROFILE '.ssh'; New-Item -ItemType Directory -Force -Path $d | Out-Null; $f = Join-Path $d 'authorized_keys' }",
    "  $t = if (Test-Path -LiteralPath $f) { [IO.File]::ReadAllText($f) } else { '' }",
    "  if (-not (($t -split '\\r?\\n') -ccontains $k)) {",
    '    $nl = if ($t.Length -and -not $t.EndsWith("`n")) { "`r`n" } else { \'\' }',
    '    [IO.File]::AppendAllText($f, "$nl$k`r`n", (New-Object Text.UTF8Encoding $false))',
    "  }",
    "  if ($admin) { icacls $f /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null; if ($LASTEXITCODE) { throw \"icacls could not set its access (code $LASTEXITCODE)\" } }",
    "  if (-not (([IO.File]::ReadAllText($f) -split '\\r?\\n') -ccontains $k)) { throw \"$f does not hold it\" }",
    "  \"This computer's key is added there: back in Filament, the setup goes on.\"",
    "} catch { [Console]::Error.WriteLine(\"This computer's key is not added there: $($_.Exception.Message)\"); exit 1 }",
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
 * What installs Filament on a Windows host, by its PowerShell: install.ps1 downloaded and run with the version asked —
 * none, the newest —, as its one-command install runs it (irm | iex); its download failing ends it with code 7.
 * @param {string | null} version @param {string} [url]  where install.ps1 is
 */
export const installPs = (version, url = INSTALL_PS_URL) =>
  [
    "try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}",
    `try { $s = (New-Object Net.WebClient).DownloadString(${psQuote(url)}) } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 7 }`,
    version ? `$env:FILAMENT_VERSION = ${psQuote(version)}` : "Remove-Item Env:FILAMENT_VERSION -ErrorAction SilentlyContinue",
    "iex $s",
    "exit $LASTEXITCODE",
  ].join("\n");

/**
 * What each step runs there, by the shell the machine runs commands in (ssh-exec.js `Platform.shell`): sh, where
 * install.sh installed Filament in ~/.local; a Windows host's PowerShell, where install.ps1 installed it in
 * %LOCALAPPDATA%\filament. `filament`: Filament there with words (each plain, or quoted by `quote`); `agents`: its
 * coding agents found and listed as JSON, then a `filament-memory` line and whether memory is on; `ways`: its settings
 * of the network listener and the tailnet's share, whether Tailscale is there, and the firewall a network listener needs
 * opened (ufw; Windows Firewall); `read`: a file's text.
 * @typedef {{ shell: "sh" | "powershell", where: string, quote: (s: string) => string, filament: (words: string) => string,
 *   install: (version: string | null) => string, agents: string, ways: string, tailnet: string, served: string,
 *   read: (path: string) => import("./ssh-exec.js").RunWhat, pair: string }} Kit
 * @type {Record<"sh" | "powershell", Kit>}
 */
const KITS = {
  sh: {
    shell: "sh",
    where: "~/.local/share/filament",
    quote: shQuote,
    filament: (words) => `exec ${FILAMENT} ${words}`,
    install: installScript,
    agents: [`f=${FILAMENT}`, '"$f" agents detect >/dev/null 2>&1', '"$f" agents list --json || exit $?', "echo", "echo filament-memory", '"$f" settings get memory.enabled 2>/dev/null || true'].join("\n"),
    ways: [
      `f=${FILAMENT}`,
      'echo "lan=$("$f" settings get server.lan.enabled 2>/dev/null)"',
      'echo "serve=$("$f" settings get server.tailscale.serve 2>/dev/null)"',
      // ufw on, as its own conf says it to any user (its rules are root's to read); a conf that does not read, on.
      'if [ -r /etc/ufw/ufw.conf ]; then grep -q "^ENABLED=yes" /etc/ufw/ufw.conf && echo ufw=1; elif [ -e /etc/ufw/ufw.conf ]; then echo ufw=1; fi',
      "command -v tailscale >/dev/null 2>&1 && echo tailscale=1",
      "true",
    ].join("\n"),
    tailnet: "tailscale status --json 2>/dev/null",
    served: "tailscale serve status --json 2>/dev/null; true",
    read: (path) => ({ argv: ["cat", path] }),
    pair: PAIR_SCRIPT,
  },
  // A native program's stderr is left to it (a redirected line of one stops Windows PowerShell 5.1's script).
  powershell: {
    shell: "powershell",
    where: "%LOCALAPPDATA%\\filament",
    quote: psQuote,
    filament: (words) => `${PS_FILAMENT}\n& $f ${words}\nexit $LASTEXITCODE`,
    install: (version) => installPs(version),
    agents: [PS_FILAMENT, "& $f agents detect | Out-Null", "& $f agents list --json", "if ($LASTEXITCODE) { exit $LASTEXITCODE }", "''", "'filament-memory'", "& $f settings get memory.enabled", "exit 0"].join("\n"),
    ways: [
      PS_FILAMENT,
      '"lan=$(& $f settings get server.lan.enabled)"',
      '"serve=$(& $f settings get server.tailscale.serve)"',
      "if (Get-Command tailscale -ErrorAction SilentlyContinue) { 'tailscale=1' }",
      // Windows Firewall on for any of its profiles, or not read: on, as Windows has it — and a rule of the firewall
      // line's own (`WINDOWS_FIREWALL`), on and letting in, leaves nothing to open.
      "$on = $true",
      "try { $on = [bool]@(Get-NetFirewallProfile | Where-Object { [string]$_.Enabled -ne 'False' }).Count } catch {}",
      "try { if (@(Get-NetFirewallRule -DisplayName Filament -ErrorAction Stop | Where-Object { [string]$_.Enabled -eq 'True' -and [string]$_.Direction -eq 'Inbound' -and [string]$_.Action -eq 'Allow' }).Count) { $on = $false } } catch {}",
      "if ($on) { 'firewall=1' }",
      "exit 0",
    ].join("\n"),
    tailnet: "tailscale status --json\nexit 0",
    served: "tailscale serve status --json\nexit 0",
    read: (path) => ({ script: `Get-Content -Raw -LiteralPath ${psQuote(path)}`, shell: "powershell" }),
    pair: PAIR_PS,
  },
};
/** The line that opens Filament's two ports in Windows Firewall, in an administrator's PowerShell. */
const WINDOWS_FIREWALL = "New-NetFirewallRule -DisplayName Filament -Direction Inbound -Protocol TCP -LocalPort 20343-20344 -Action Allow";

/**
 * Whether a release of Filament for servers is out for the machine (`target`), asked of GitHub from here: none where its
 * feed is not found, null where GitHub did not say. @param {string} version @param {string | null} [target]
 * @param {typeof fetch} [fetchImpl]
 */
export async function releasedAt(version, target, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(feedUrl(version, target), { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) });
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
 *   publicKey?: () => string | null, released?: (version: string, target: string | null) => Promise<boolean | null>, wait?: (ms: number) => Promise<void>,
 *   log?: (line: string) => void }} o
 *   `version`: this app's, which it installs there where that release is out; `pair`: a link paired as the Add sheet
 *   pairs it, the window left where it is (lib/rail.js `add`); `machines`: those this window keeps; `addWay`: a way to a
 *   machine kept, put after its others; `routeFor`: the SSH way to a Filament there (ssh-route.js `createTunnels`)
 */
export function createSetupOverSsh({ ssh = runSsh, probe = (a) => probeSsh(a), cli, version, pair, machines, addWay, routeFor, publicKey = () => publicKeyHere(), released = (v, t) => releasedAt(v, t), wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} }) {
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
  /** A command there, by the shell of its kit. @param {string} a @param {Kit} kit @param {string} script @param {number} [timeoutMs] */
  const sh = (a, kit, script, timeoutMs = LOOK_MS) => ssh(a, kit.shell === "powershell" ? { script, shell: "powershell" } : { script }, { timeoutMs });

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
      // Its shell as a look before this one read it; a machine that lets no one in says none, and both ways are said:
      // sh's, and a Windows host's PowerShell's (the hunt on s3b).
      const shell = seen.get(a)?.platform?.shell;
      /** @type {StepLine[]} */
      const add = !key
        ? [{ words: "This computer has no SSH key yet: make one, add it there, then Retry.", line: "ssh-keygen -t ed25519", terminal: null }]
        : [
            ...(shell === "powershell" ? [] : [{ words: `${shell ? "Add" : "On Linux or a Mac, add"} this computer's key there: you type the password once, in the terminal, then Retry.`, line: `ssh-copy-id ${a}`, terminal: term(a, { script: keyScript(key) }, `Add this computer's key to ${a}`) }]),
            ...(shell === "sh"
              ? []
              : [{ words: `${shell ? "Add" : "On a Windows host, add"} this computer's key there — an administrator's in C:\\ProgramData\\ssh\\administrators_authorized_keys, as its OpenSSH reads it: you type the password once, in the terminal, then Retry.`, line: null, terminal: term(a, { script: keyPs(key), shell: "powershell" }, `Add this computer's key to ${a}`) }]),
          ];
      return { step, state: "failed", words: `${a} asks for a password or a code, which a setup from here cannot type: it runs with a key the machine accepts.`, also: add };
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
    return { step: "reach", state: "done", words: `${a} answers: ${pl.os} on ${pl.arch}${pl.libc ? `, glibc ${pl.libc}` : ""}${pl.filament ? `, Filament ${pl.filament} installed there` : ""}.` };
  }

  /**
   * The machine's platform as its last look said it, else looked at now, and the kit its steps run there.
   * @param {string} step @param {string} a @returns {Promise<{ platform: Platform, kit: Kit } | { stop: StepResult }>}
   */
  const platformOf = async (step, a) => {
    let pl = seen.get(a)?.platform;
    if (!pl) {
      const r = await reach(a);
      if (r.state !== "done") return { stop: { ...r, step } };
      pl = /** @type {Platform} */ (seen.get(a)?.platform);
    }
    return { platform: pl, kit: KITS[pl.shell === "powershell" ? "powershell" : "sh"] };
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
    const kit = got.kit;
    const installer = kit.shell === "powershell" ? "install.ps1" : "install.sh";
    log(`setup over ssh: installing Filament ${want || "(the newest release)"} on ${a}`);
    const r = await sh(a, kit, kit.install(want), INSTALL_MS);
    if (r.code === 7 && r.began)
      return { step: "install", state: "failed", words: `${installer} could not be downloaded there from ${kit.shell === "powershell" ? INSTALL_PS_URL : INSTALL_URL}: ${a} reaches no GitHub, or reached it a moment too late.` };
    if (r.code !== 0 || !r.began) {
      // The installer says so of any feed it could not read: its release is none only where it is none from here too —
      // the feed of the machine's own build (arm64's, which a release may be without; the hunt on s3b).
      if (want && /gave no .* at /i.test(r.stderr) && (await released(want, got.platform.target)) === false)
        return { step: "install", state: "failed", words: `Filament ${want}, this app's version, has no server build released: this app is a build of its own. The newest release installs instead.`, offer: { label: "Install the newest release", latest: true } };
      return trouble("install", a, r, installer);
    }
    // Its version, as it is there now. A look that does not answer (the connection dropped just after) leaves no look
    // kept: the next step looks again, never at what stood before the install (the hunt on s3b).
    const again = await probe(a);
    if (again.ok) seenOf(a).platform = again.platform;
    else delete seenOf(a).platform;
    const now = (again.ok ? again.platform.filament : null) || want;
    return { step: "install", state: "done", words: `${now ? `Filament ${now}` : "Filament"} is installed there, in ${kit.where}.` };
  }

  /** `filament service status --json` there: its state, or the run that did not say it. @param {string} a @param {Kit} kit */
  const serviceLook = async (a, kit) => {
    const r = await sh(a, kit, kit.filament("service status --json"));
    const st = r.code === 0 ? jsonIn(r.stdout, "{") : null;
    if (st) seenOf(a).service = st;
    return { r, st };
  };

  /**
   * Filament run as a service there, started at boot: on Linux by systemd, its user unit installed and running,
   * lingering turned on as its user may, else its sudo line said; on a Windows host by Task Scheduler, its task
   * (\Filament\Filament) installed and its runner running Filament, at boot with no one logged in.
   * @param {string} a @returns {Promise<StepResult>}
   */
  async function service(a) {
    const got = await platformOf("service", a);
    if ("stop" in got) return /** @type {StepResult} */ (got.stop);
    const kit = got.kit;
    const windows = kit.shell === "powershell";
    if (!got.platform.filament) return { step: "service", state: "failed", words: `Filament is not installed on ${a} yet: Install Filament first.` };
    if (!windows && !got.platform.has.includes("systemctl"))
      return { step: "service", state: "failed", words: `${a} has no systemd: Filament is installed there and runs as you start it (filament start, under tmux or screen), and nothing starts it at boot or after a crash.` };
    let { r, st } = await serviceLook(a, kit);
    if (!st) return trouble("service", a, r, "filament service status");
    const stood = st.installed === true && st.active === "active" && st.enabled === "enabled" && !!st.filament;
    if (!stood) {
      log(`setup over ssh: filament service install on ${a}`);
      const ran = await sh(a, kit, kit.filament("service install"), SERVICE_MS);
      if (ran.code !== 0) return trouble("service", a, ran, "filament service install");
      ({ r, st } = await serviceLook(a, kit));
      if (!st) return trouble("service", a, r, "filament service status");
    }
    if (windows) {
      const v = st.filament?.version ? `Filament ${st.filament.version}` : "Filament";
      return { step: "service", state: stood ? "skipped" : "done", words: `${v} runs there under Task Scheduler (its task \\Filament\\Filament), started at boot with no one logged in, and again after a crash.` };
    }
    let changed = !stood;
    /** @type {StepLine[]} */
    const also = [];
    // Lingering off, or not read (loginctl could not say): turned on as its user may on most systems; where it is not
    // on after, the line with sudo — never "nothing to do" for a machine that may not start Filament at boot (the hunt
    // on s3b).
    if (st.linger !== true) {
      await sh(a, kit, 'loginctl enable-linger "$(id -un)" >/dev/null 2>&1; true');
      const after = await serviceLook(a, kit);
      if (after.st) st = after.st;
      if (st.linger === true) changed = true;
      else
        also.push({
          words:
            st.linger === false
              ? "Lingering is off for its user: Filament starts as they log in, and stops as their last session ends. To start it at boot:"
              : "Whether lingering is on for its user could not be read there (loginctl): off, Filament starts as they log in, and stops as their last session ends. To be sure it starts at boot:",
          line: "sudo loginctl enable-linger $USER",
          terminal: term(a, { script: 'sudo loginctl enable-linger "$(id -un)"' }, `Lingering on ${a}`),
        });
    }
    const v = st.filament?.version ? `Filament ${st.filament.version}` : "Filament";
    const when = st.linger === true ? "at boot" : st.linger === false ? "as its user logs in" : "at boot where lingering is on, else as its user logs in";
    return { step: "service", state: changed ? "done" : "skipped", words:`${v} runs there under systemd, started ${when}, and again after a crash.`, ...(also.length ? { also } : {}) };
  }

  /**
   * Its coding agents connected — each found installed there that is not off —, and memory on. Their sign-ins are that
   * machine's own (its Settings › Coding agents).
   * @param {string} a @returns {Promise<StepResult>}
   */
  async function setup(a) {
    const got = await platformOf("setup", a);
    if ("stop" in got) return /** @type {StepResult} */ (got.stop);
    const kit = got.kit;
    const look = await sh(a, kit, kit.agents, CONNECT_MS);
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
      const r = await sh(a, kit, kit.filament(`agents connect ${kit.quote(String(x.id))}`), CONNECT_MS + 60_000);
      if (r.code === 0) connected.push(String(x.name || x.id));
      else failed.push(`${x.name || x.id} (${lastLine(r.stderr) || r.why || `code ${r.code}`})`);
    }
    const wasOn = lastLine(memory) === "true";
    if (!wasOn) {
      const r = await sh(a, kit, kit.filament("memory on"));
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
   * Its ways in over https as `filament status --json` says them there: its network listener (asked for, the port it
   * listens on, why not) and its tailnet share (asked for, served, why not); null each where it says none.
   * @param {string} a @param {Kit} kit
   * @returns {Promise<{ network: { on: boolean, listening: number | null, error: string | null } | null, tailnet: { on: boolean, served: boolean, error: string | null } | null }>}
   */
  const waysThere = async (a, kit) => {
    const r = await sh(a, kit, kit.filament("status --json"));
    const s = r.code === 0 ? jsonIn(r.stdout, "{") : null;
    return { network: s?.network ?? null, tailnet: s?.tailnet ?? null };
  };

  /**
   * A way in over https: shared on the tailnet where Tailscale runs there, else its network listener on — the lines only
   * the person may run said with it: Tailscale's operator, the firewall's. What was asked for is said as it stands
   * there — listening, served, or why not (the hunt on s3b) —; one that does not come up stops nothing, as the pairing
   * goes through an SSH tunnel then.
   * @param {string} a @returns {Promise<StepResult>}
   */
  async function route(a) {
    const got = await platformOf("route", a);
    if ("stop" in got) return /** @type {StepResult} */ (got.stop);
    const kit = got.kit;
    const windows = kit.shell === "powershell";
    const look = await sh(a, kit, kit.ways);
    if (look.code !== 0) return trouble("route", a, look, "filament settings");
    /** @type {Record<string, string>} */
    const k = {};
    for (const line of String(look.stdout).split(/\r?\n/)) {
      const m = /^(\w+)=(.*)$/.exec(line.trim());
      if (m && !(m[1] in k)) k[m[1]] = m[2].trim();
    }
    let running = false;
    if (k.tailscale) {
      const st = await sh(a, kit, kit.tailnet);
      running = jsonIn(st.stdout, "{")?.BackendState === "Running";
    }
    seenOf(a).tailnet = running;
    if (running) {
      const was = k.serve === "true";
      if (!was) {
        const r = await sh(a, kit, kit.filament("settings set server.tailscale.serve true"));
        if (r.code !== 0) return trouble("route", a, r, "filament settings set");
      }
      /** @type {StepLine[]} */
      const also = [];
      // On Linux its user may serve — root, or Tailscale's operator, as its prefs name one —, or Tailscale refuses it its
      // serve: that operator named once, with sudo. Prefs that do not read say the line all the same. Windows' Tailscale
      // names no operator: what it refuses is said as it stands (`waysThere`).
      if (!windows) {
        const who = await sh(a, kit, "id -un; tailscale debug prefs 2>/dev/null; true");
        const user = String(who.stdout).split(/\r?\n/)[0].trim();
        const prefs = jsonIn(who.stdout, "{");
        if (user !== "root" && (!prefs || String(prefs.OperatorUser || "") !== user))
          also.push({ words: "Tailscale serves for root and its operator alone: let its user serve, once.", line: "sudo tailscale set --operator=$USER", terminal: term(a, { script: 'sudo tailscale set --operator="$(id -un)"' }, `Tailscale's operator on ${a}`) });
      }
      // Asked for before this run, and not served: said with why. Asked for just now, Tailscale takes its moment, which
      // the pairing waits for.
      const t = was ? (await waysThere(a, kit)).tailnet : null;
      if (t && !t.served)
        return {
          step: "route",
          state: "done",
          words: `Filament is asked to share itself on your tailnet there, and Tailscale does not serve it${t.error ? `: ${t.error.replace(/[.\s]+$/, "")}` : ""}. Until it does, the pairing goes through an SSH tunnel.`,
          ...(also.length ? { also } : {}),
        };
      return {
        step: "route",
        state: was ? "skipped" : "done",
        words: `Filament is shared on your tailnet there (tailscale serve), at its https address; the tailnet's HTTPS must be on (Tailscale's admin page, DNS).`,
        ...(also.length ? { also } : {}),
      };
    }
    const was = k.lan === "true";
    if (!was) {
      const r = await sh(a, kit, kit.filament("settings set server.lan.enabled true"));
      if (r.code !== 0) return trouble("route", a, r, "filament settings set");
    }
    // The firewall's line on every run where it may close the ports, not on the run that turned the listener on alone:
    // ufw on, or Windows Firewall on with no rule of the line's (the hunt on s3b).
    /** @type {StepLine[]} */
    const also =
      windows && k.firewall
        ? [{ words: "Windows Firewall lets no one in to Filament's two ports until a rule does — and your cloud's security group, where it has one. In an administrator's PowerShell there:", line: WINDOWS_FIREWALL, terminal: term(a, { script: WINDOWS_FIREWALL, shell: "powershell" }, `The firewall on ${a}`) }]
        : k.ufw
          ? [{ words: "Its firewall (ufw) is on: unless it lets Filament's two ports in already (its rules are root's to read), open them — and your cloud's security group, where it has one:", line: "sudo ufw allow 20343:20344/tcp", terminal: term(a, { argv: ["sudo", "ufw", "allow", "20343:20344/tcp"] }, `The firewall on ${a}`) }]
          : [];
    const tail = k.tailscale ? ` Tailscale is there, not signed in: signed in (${windows ? "its app, or tailscale up" : "sudo tailscale up"}), a setup again shares Filament on your tailnet.` : "";
    // The listener as it stands once the setting is saved: one that could not listen (its port another program's) is
    // said with why, never as listening.
    const n = (await waysThere(a, kit)).network;
    if (n && !n.listening)
      return {
        step: "route",
        state: "done",
        words: `Filament is asked to listen on ${a}'s network addresses over https, and does not${n.error ? `: ${n.error.replace(/[.\s]+$/, "")}` : ""}. Until it does, the pairing goes through an SSH tunnel.${tail}`,
        ...(also.length ? { also } : {}),
      };
    return {
      step: "route",
      state: was ? "skipped" : "done",
      words: `Filament listens on ${a}'s network addresses over https, at port ${n?.listening || 20343}, with a certificate of its own.${tail}`,
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
    const got = await platformOf("pair", a);
    if ("stop" in got) return /** @type {StepResult} */ (got.stop);
    const kit = got.kit;
    let st = seen.get(a)?.service ?? null;
    if (!st?.dataDir) {
      const look = await serviceLook(a, kit);
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
      const r = await ssh(a, kit.read(`${st.dataDir}${kit.shell === "powershell" ? "\\" : "/"}machine.json`), { timeoutMs: LOOK_MS });
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
      served = /127\.0\.0\.1:\d+/.test(String((await sh(a, kit, kit.served)).stdout));
    }
    const r0 = await sh(a, kit, kit.pair, PAIR_MS);
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
