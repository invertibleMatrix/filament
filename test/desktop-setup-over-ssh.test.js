// The desk's setup of a Linux machine over SSH (desktop/lib/setup-over-ssh.js, the remote desk's s3b): each step against
// a fake machine reached by a fake ssh — what it runs there, in order; a set-up machine answering every step with
// nothing to do; what only the person answers going to a terminal; and the words of each refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTALL_PS_URL, INSTALL_URL, STEPS, createSetupOverSsh, feedUrl, installPs, installScript, keyPs, keyScript, publicKeyHere } from "../desktop/lib/setup-over-ssh.js";
import { PAIR_PS, PAIR_SCRIPT } from "../desktop/lib/add-machine.js";
import { commandOf, platformOf, probeSsh, psQuote, runSsh } from "../desktop/lib/ssh-exec.js";
import { findGitBash } from "../src/adapters/tools/shell.js";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn as spawnChild, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

const ALIAS = "me@box";
const ID = "m-box";
const FP = "AB:".repeat(31) + "AB";
const LAN_LINK = `https://192.168.1.20:20343/ui/pair.html#code=ABCD-EFGH&fp=${FP}`;
const TS_LINK = "https://box.tail1234.ts.net/ui/pair.html#code=ABCD-EFGH";
const OK = { code: 0, stdout: "", stderr: "", cut: false, why: null, ask: null, began: true };
const FIREWALL_LINE = "New-NetFirewallRule -DisplayName Filament -Direction Inbound -Protocol TCP -LocalPort 20343-20344 -Action Allow";
/** A Mac's LaunchDaemon's sudo line, as `filament service status --json` says it there (src/cli/service.js `daemonLine`). */
const BOOT_LINE = "sudo launchctl bootout system/com.filamentdev.server 2>/dev/null; sudo install -m 644 -o root -g wheel /Users/me/.config/filament/service/com.filamentdev.server.plist /Library/LaunchDaemons/com.filamentdev.server.plist && sudo launchctl bootstrap system /Library/LaunchDaemons/com.filamentdev.server.plist";
/** The real path of the Node Filament runs on, on a Mac. */
const MAC_NODE = "/Users/me/.local/share/filament/0.9.85/node/bin/node";
/** What a terminal's ssh runs there: its command's script, decoded. @param {any} t */
const scriptOf = (t) => Buffer.from(/printf %s ([A-Za-z0-9+/=]+)/.exec(String(t?.args.at(-1)))?.[1] || "", "base64").toString("utf8");
/** What a terminal's ssh runs there by PowerShell: its script, decoded. @param {any} t */
const psOf = (t) => Buffer.from(/-EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(String(t?.args.at(-1)))?.[1] || "", "base64").toString("utf16le");
/**
 * A POSIX sh here, and the folders of its tools: on Windows Git's dash (else its sh), found as the bash tool finds Git
 * Bash; elsewhere /bin/sh on this PATH. Null where there is none.
 */
const SH = (() => {
  if (process.platform !== "win32") return existsSync("/bin/sh") ? { file: "/bin/sh", tools: String(process.env.PATH || "/usr/bin:/bin").split(delimiter) } : null;
  const bash = findGitBash();
  if (!bash) return null;
  const git = dirname(dirname(bash));
  const file = [join(git, "usr", "bin", "dash.exe"), join(git, "usr", "bin", "sh.exe"), join(git, "bin", "sh.exe")].find((f) => existsSync(f));
  return file ? { file, tools: [join(git, "usr", "bin")] } : null;
})();

/**
 * A machine there, as its commands answer: what is installed, how its service stands, its agents, its settings.
 * @param {any} [o]
 */
function fakeMachine(o = {}) {
  const m = {
    filament: o.filament ?? null,
    release: o.release ?? true,
    systemd: o.systemd ?? true,
    service: o.service ?? { installed: false, active: "inactive", enabled: "disabled" },
    /** Lingering: on, off, or null where loginctl cannot say. */
    linger: "linger" in o ? o.linger : false,
    lingerMay: o.lingerMay ?? true,
    /** Its CPU, as uname says it. */
    arch: o.arch ?? "x86_64",
    /** The network listener comes up once asked: its port is free. */
    lanUp: o.lanUp ?? true,
    agents: o.agents ?? [
      { id: "claude-code", name: "Claude Code", state: "ready", signedIn: "" },
      { id: "codex", name: "Codex", state: "missing", signedIn: "" },
    ],
    memory: o.memory ?? false,
    lan: o.lan ?? false,
    serve: o.serve ?? false,
    tailscale: o.tailscale ?? null,
    operator: o.operator ?? true,
    /** Tailscale serves Filament once asked: its serve took. */
    served: o.served ?? true,
    /** An agent whose connect fails there. */
    noConnect: o.noConnect ?? null,
    /** Its firewall on: ufw, or Windows Firewall. */
    ufw: o.ufw ?? true,
    /** Windows Firewall's rule of the setup's line there, on and letting in. */
    rule: o.rule ?? false,
    /** A Windows host: its commands PowerShell's, Filament as install.ps1 installs it, run by Task Scheduler. */
    windows: o.windows ?? false,
    /** A Mac with Apple silicon: Filament as install.sh installs it, run by launchd's LaunchAgent. */
    mac: o.mac ?? false,
    /** A Mac's LaunchDaemon installed, the one its service install wrote: it starts Filament at boot. */
    boot: o.boot ?? false,
    /** @type {string[]} */ codes: [],
    links: o.links ?? null,
    /** @type {string[]} */ ran: [],
  };
  const platform = () =>
    m.windows
      ? platformOf(["os=Windows", "arch=AMD64", "bits=64", "home=C:\\Users\\me\\AppData\\Local", "has=winget", "has=tar", ...(m.tailscale ? ["has=tailscale"] : []), ...(m.filament ? [`filament=${m.filament}`] : [])].join("\r\n"), "powershell")
      : m.mac
        ? platformOf(["os=Darwin", "arch=arm64", "bits=64", "libc=", "macos=14.5", "arm64=1", "home=/Users/me", "has=launchctl", "has=sudo", ...["curl", "tar", "gzip", "openssl", "base64", "od", "mktemp", "readlink", "ln"].map((t) => `has=${t}`), ...(m.filament ? [`filament=${m.filament}`] : [])].join("\n"), "sh")
        : platformOf(
            ["os=Linux", `arch=${m.arch}`, "bits=64", "libc=glibc 2.35", "home=/home/me", ...(m.systemd ? ["has=systemctl", "has=loginctl"] : []), ...["curl", "tar", "gzip", "sha512sum", "base64", "od", "mktemp", "readlink", "ln"].map((t) => `has=${t}`), ...(m.tailscale ? ["has=tailscale"] : []), ...(m.filament ? [`filament=${m.filament}`] : [])].join("\n"),
            "sh",
          );
  const dataDir = m.windows ? "C:\\Users\\me\\AppData\\Roaming\\filament" : m.mac ? "/Users/me/.config/filament" : "/home/me/.local/share/filament/data";
  const status = () => ({
    ...m.service,
    linger: m.windows ? (m.service.installed ? true : null) : m.mac ? (m.service.installed ? m.boot : null) : m.linger,
    ...(m.mac ? { bootLine: m.service.installed && !m.boot ? BOOT_LINE : null } : {}),
    dataDir: m.service.installed ? dataDir : null,
    filament: m.service.active === "active" ? { version: m.filament, url: "http://127.0.0.1:20300", supervisor: m.windows || m.mac ? "service" : "systemd" } : null,
  });
  /** @param {string} alias @param {any} what @param {any} [opt] */
  const ssh = async (alias, what, opt = {}) => {
    assert.equal(alias, ALIAS);
    // A Windows host's commands are PowerShell's, and each fits the command line its cmd starts.
    if (m.windows) {
      assert.equal(what.shell, "powershell", `PowerShell runs ${JSON.stringify(what).slice(0, 80)}`);
      assert.doesNotThrow(() => commandOf(what, { marked: true, mark: "0123456789abcdef" }));
    } else assert.equal(what.shell, undefined);
    const s = "argv" in what ? what.argv.join(" ") : String(what.script);
    m.ran.push(s);
    if ("argv" in what && what.argv[0] === "cat") return { ...OK, stdout: JSON.stringify({ version: 1, id: ID, name: "Box" }) };
    if (s.startsWith("Get-Content -Raw -LiteralPath ")) {
      assert.equal(s, `Get-Content -Raw -LiteralPath '${dataDir}\\machine.json'`);
      return { ...OK, stdout: `${JSON.stringify({ version: 1, id: ID, name: "Box" })}\r\n` };
    }
    if (s.includes(INSTALL_URL) || s.includes(INSTALL_PS_URL)) {
      assert.ok(opt.timeoutMs >= 600_000, "the install is given its time");
      const v = /FILAMENT_VERSION(?: = |=)'([^']+)'/.exec(s)?.[1] || "0.9.90";
      const feed = m.windows ? "latest-server-win32-x64.yml" : m.mac ? "latest-server-darwin-arm64.yml" : "latest-server.yml";
      if (/FILAMENT_VERSION = '|FILAMENT_VERSION='/.test(s) && !m.release)
        return { ...OK, code: 1, stderr: `${m.windows ? "" : "install.sh: "}Filament's releases gave no ${feed} at https://github.com/x/releases/download/v${v}/${feed} (is ${v} a release of Filament for servers?): nothing was installed.\n` };
      m.filament = v;
      return { ...OK, stdout: `Filament ${v} is installed.\n` };
    }
    if (s.includes("service status --json")) return { ...OK, stdout: `${JSON.stringify(status(), null, 2)}\n` };
    // Its ways in over https as they stand: asked for, and listening or served — or why not.
    if (s.includes('filament" status --json') || s.includes("& $f status --json"))
      return {
        ...OK,
        stdout: `${JSON.stringify({
          version: m.filament,
          network: { on: m.lan, listening: m.lan && m.lanUp ? 20343 : null, error: m.lan && !m.lanUp ? "port 20343 is in use by another program: choose another port" : null },
          tailnet: { on: m.serve, served: m.serve && m.served, error: m.serve && !m.served ? "Tailscale's HTTPS is off for this tailnet." : null },
        })}\n`,
      };
    if (s.includes("service install")) {
      m.service = { installed: true, active: "active", enabled: "enabled" };
      return { ...OK, stdout: m.windows ? "Wrote C:\\Users\\me\\AppData\\Roaming\\filament\\service\\task.xml.\r\n" : m.mac ? "Wrote ~/Library/LaunchAgents/com.filamentdev.server.plist.\n" : "Wrote ~/.config/systemd/user/filament.service.\n" };
    }
    if (s.includes("loginctl enable-linger") && !s.includes("sudo")) {
      if (m.lingerMay) m.linger = true;
      return OK;
    }
    if (s.includes("agents list --json")) return { ...OK, stdout: `${JSON.stringify(m.agents, null, 2)}\n\nfilament-memory\n${m.memory}\n` };
    const connect = /agents connect '([^']+)'/.exec(s);
    if (connect) {
      if (connect[1] === m.noConnect) return { ...OK, code: 1, stderr: "filament agents: its adapter could not be fetched\n" };
      m.agents = m.agents.map((x) => (x.id === connect[1] ? { ...x, state: "connected" } : x));
      return OK;
    }
    if (s.includes("memory on")) return ((m.memory = true), OK);
    if (s.includes("settings get server.lan.enabled") && m.mac)
      return { ...OK, stdout: `lan=${m.lan}\nserve=${m.serve}\n${m.tailscale ? "tailscale=1\n" : ""}${m.ufw ? "macfw=1\n" : ""}node=${MAC_NODE}\n` };
    if (s.includes("settings get server.lan.enabled"))
      return { ...OK, stdout: `lan=${m.lan}\nserve=${m.serve}\n${m.ufw && !(m.windows && m.rule) ? (m.windows ? "firewall=1\n" : "ufw=1\n") : ""}${m.tailscale ? "tailscale=1\n" : ""}` };
    if (s.includes("tailscale status --json") || s.includes('"$t" status --json')) return { ...OK, stdout: JSON.stringify({ BackendState: m.tailscale }) };
    // Its prefs read by any user; its serve's config too.
    if (s.includes("tailscale debug prefs")) return { ...OK, stdout: `me\n${JSON.stringify({ OperatorUser: m.operator ? "me" : "" }, null, 2)}\n` };
    if (s.includes("tailscale serve status --json") || s.includes('"$t" serve status --json')) return { ...OK, stdout: m.serve && m.served ? JSON.stringify({ Web: { "box.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:20345" } } } } }) : "{}" };
    if (s.includes("settings set server.tailscale.serve true")) return ((m.serve = true), OK);
    if (s.includes("settings set server.lan.enabled true")) return ((m.lan = true), OK);
    if (s === (m.windows ? PAIR_PS : PAIR_SCRIPT)) {
      m.codes.push("ABCD-EFGH");
      return { ...OK, stdout: JSON.stringify({ code: "ABCD-EFGH", links: m.links ?? [...(m.serve && m.served ? [TS_LINK] : []), ...(m.lan && m.lanUp ? [LAN_LINK] : [])], fingerprint: FP, machine: { id: ID, name: "Box" } }) };
    }
    throw new Error(`the fake machine runs no ${s.slice(0, 80)}`);
  };
  return { m, ssh, probe: async () => ({ ok: /** @type {const} */ (true), platform: platform() }) };
}

/** The setup over a fake machine, and what it asked of this window. @param {any} machine @param {any} [o] */
function rig(machine, o = {}) {
  /** @type {any[]} */
  const kept = o.kept ?? [];
  /** @type {string[]} */
  const paired = [];
  /** @type {(string | undefined)[]} */
  const made = [];
  /** @type {any[]} */
  const ways = [];
  const setup = createSetupOverSsh({
    ssh: machine.ssh,
    probe: o.probe ?? machine.probe,
    cli: () => "ssh",
    version: o.version ?? "0.9.85",
    released: o.released ?? (async () => false),
    pair: async (link, code) => {
      paired.push(link);
      made.push(code);
      const ok = o.answers ? o.answers(link) : true;
      if (!ok) return { ok: false, words: `No Filament answers at ${new URL(link.replace(/^ssh:/, "http:")).host}` };
      kept.push({ id: ID, name: "Box", routes: [{ kind: link.startsWith("ssh:") ? "ssh" : "lan", url: link.replace(/\/ui.*$/, ""), ...(link.startsWith("ssh:") ? { alias: ALIAS } : {}) }], partition: "p" });
      return { ok: true, id: ID, name: "Box" };
    },
    machines: () => kept,
    addWay: (id, route) => {
      ways.push([id, route]);
      const k = kept.find((x) => x.id === id);
      if (k) k.routes = [...k.routes, route];
    },
    routeFor: async (alias, port) => ({ kind: "ssh", url: "http://127.0.0.1:41000", alias, port }),
    publicKey: () => (o.key === undefined ? "ssh-ed25519 AAAAC3Nza me@desk" : o.key),
    wait: async () => {},
  });
  /** Every step in order, as the sheet asks them, stopping at the first that does not go on. @param {any} [x] */
  const all = async (x = {}) => {
    /** @type {any[]} */
    const out = [];
    for (const s of STEPS) {
      const r = await setup.run({ alias: ALIAS, step: s.id, ...x });
      out.push(r);
      if (r.state === "failed" || r.state === "ask") break;
    }
    return out;
  };
  return { setup, all, kept, paired, made, ways };
}

test("a fresh machine: installed at this app's version, run by systemd at boot, its agents connected and memory on, its network's https way, paired there — the SSH way kept after it", async () => {
  const f = fakeMachine();
  const t = rig(f);
  const out = await t.all();
  assert.deepEqual(out.map((r) => [r.step, r.state]), STEPS.map((s) => [s.id, "done"]));
  assert.match(out[0].words, /^me@box answers: Linux on x86_64, glibc 2\.35\.$/);
  assert.ok(f.m.ran.some((s) => s.includes("FILAMENT_VERSION='0.9.85' sh")), "this app's version asked of install.sh");
  assert.match(out[1].words, /Filament 0\.9\.85 is installed there/);
  assert.equal(f.m.service.enabled, "enabled");
  assert.equal(f.m.linger, true, "lingering turned on as its user may");
  assert.equal(out[2].also, undefined, "no line left for the person");
  assert.match(out[2].words, /started at boot/);
  assert.deepEqual(f.m.agents.map((x) => [x.id, x.state]), [["claude-code", "connected"], ["codex", "missing"]], "the agent installed there connected, the missing one left");
  assert.match(out[3].words, /^Connected Claude Code\. Claude Code is not signed in there: that machine's Settings › Coding agents signs it in\. Memory is on now\.$/);
  assert.equal(f.m.memory, true);
  assert.equal(f.m.lan, true, "its network listener on");
  assert.deepEqual(out[4].also?.map((l) => l.line), ["sudo ufw allow 20343:20344/tcp"], "the firewall's line said");
  assert.equal(scriptOf(out[4].also?.[0].terminal), "'sudo' 'ufw' 'allow' '20343:20344/tcp'", "and run there in a terminal, where sudo asks");
  assert.deepEqual(t.paired, [LAN_LINK], "the network's link, its certificate pinned by it");
  assert.deepEqual(t.ways, [[ID, { kind: "ssh", url: "http://127.0.0.1:41000", alias: ALIAS, port: 20300 }]], "its SSH way kept after it");
  assert.deepEqual(out[5].machine, { id: ID, name: "Box" });
  assert.match(out[5].words, /^Paired with Box at https:\/\/192\.168\.1\.20:20343, as a full device/);
});

test("run again on the machine it set up: every step after the first has nothing to do, and nothing is changed or paired", async () => {
  const f = fakeMachine();
  const t = rig(f);
  await t.all();
  const ran = f.m.ran.length;
  const paired = t.paired.length;
  const again = await t.all();
  assert.deepEqual(again.map((r) => [r.step, r.state]), [["reach", "done"], ...STEPS.slice(1).map((s) => [s.id, "skipped"])]);
  assert.match(again[0].words, /Filament 0\.9\.85 installed there/);
  assert.equal(t.paired.length, paired, "no code claimed again");
  const changes = f.m.ran.slice(ran).filter((s) => / install|agents connect|memory on|settings set|enable-linger|filament" pair/.test(s));
  assert.deepEqual(changes, [], "nothing run there that changes it");
  assert.match(again[5].words, /^Box is in this window already, reached over https\.$/);
  assert.equal(t.ways.length, 1, "its SSH way kept once");
});

test("a host key ssh does not know: the person meets it in a terminal — ssh's own question, its fingerprint shown —, the step asked again after", async () => {
  const f = fakeMachine();
  let known = false;
  const t = rig(f, {
    probe: async () => (known ? f.probe() : { ok: false, run: { ...OK, code: 255, began: false, ask: "host-key", why: "ssh does not know me@box's host key yet" } }),
  });
  const r = await t.setup.run({ alias: "ssh://me@box", step: "reach" });
  assert.equal(r.state, "ask");
  assert.match(r.words, /check that the fingerprint it shows in the terminal is the one me@box has/);
  assert.equal(r.terminal?.file, "ssh");
  assert.ok(r.terminal?.args.includes("StrictHostKeyChecking=ask"), "ssh asks, never takes it");
  assert.deepEqual(r.terminal?.args.slice(-2), ["me@box", "exit"]);
  assert.equal(r.terminal?.line, "ssh -t me@box exit");
  known = true;
  assert.equal((await t.setup.run({ alias: ALIAS, step: "reach" })).state, "done");
});

test("a machine that asks for a password: this computer's key offered there, added in a terminal where the password is typed once — or, with no key here, how to make one", async () => {
  const run = { ...OK, code: 255, began: false, ask: "sign-in", why: "me@box asks for a password" };
  const f = fakeMachine();
  const r = await rig(f, { probe: async () => ({ ok: false, run }) }).setup.run({ alias: ALIAS, step: "reach" });
  assert.equal(r.state, "failed");
  assert.match(r.words, /asks for a password or a code, which a setup from here cannot type: it runs with a key the machine accepts/);
  assert.equal(r.also?.[0].line, "ssh-copy-id me@box");
  const script = scriptOf(r.also?.[0].terminal);
  assert.equal(script, keyScript("ssh-ed25519 AAAAC3Nza me@desk"));
  // (the hunt on s3b) A machine that lets no one in says not what it is: a Windows host's way is said too, its
  // PowerShell's, with no line of sh's.
  assert.deepEqual(r.also?.map((l) => [l.words.replace(/,.*/, ""), l.line]), [["On Linux or a Mac", "ssh-copy-id me@box"], ["On a Windows host", null]]);
  assert.equal(psOf(r.also?.[1].terminal), keyPs("ssh-ed25519 AAAAC3Nza me@desk"));
  const none = await rig(f, { probe: async () => ({ ok: false, run }), key: null }).setup.run({ alias: ALIAS, step: "reach" });
  assert.deepEqual(none.also?.map((l) => [l.line, l.terminal]), [["ssh-keygen -t ed25519", null]]);
  // One a look read before, asking at a later step: its own way alone.
  for (const windows of [false, true]) {
    const g = fakeMachine({ windows });
    let asks = false;
    const t = rig({ ...g, ssh: async (/** @type {any[]} */ ...x) => (asks ? run : g.ssh(x[0], x[1], x[2])) });
    await t.setup.run({ alias: ALIAS, step: "reach" });
    asks = true;
    const again = await t.setup.run({ alias: ALIAS, step: "install" });
    assert.deepEqual(again.also?.map((l) => l.line), [windows ? null : "ssh-copy-id me@box"], windows ? "a Windows host's" : "sh's");
    assert.match(again.also?.[0].words || "", /^Add this computer's key there/);
  }
});

test("refused as install.sh refuses: another system, or what its installer needs missing", async () => {
  const mac = { ok: true, platform: platformOf("os=Darwin\narch=x86_64\nbits=64\nmacos=14.5\narm64=", "sh") };
  const r = await rig(fakeMachine(), { probe: async () => mac }).setup.run({ alias: ALIAS, step: "reach" });
  assert.deepEqual([r.state, r.words], ["failed", "Filament for servers runs on a Mac with Apple silicon, and this Mac's chip is Intel's (x86_64)."]);
  const bare = { ok: true, platform: platformOf("os=Linux\narch=x86_64\nbits=64\nlibc=glibc 2.35\nhome=/root\nhas=tar\nhas=gzip", "sh") };
  const r2 = await rig(fakeMachine(), { probe: async () => bare }).setup.run({ alias: ALIAS, step: "reach" });
  assert.equal(r2.state, "failed");
  assert.match(r2.words, /^Filament's installer needs curl or wget, sha512sum or openssl, base64/);
});

test("this app a build of its own, its version unreleased: said, and the newest release offered — which installs with no version asked", async () => {
  const f = fakeMachine({ release: false });
  const t = rig(f);
  await t.setup.run({ alias: ALIAS, step: "reach" });
  const r = await t.setup.run({ alias: ALIAS, step: "install" });
  assert.equal(r.state, "failed");
  assert.match(r.words, /^Filament 0\.9\.85, this app's version, has no server build released: this app is a build of its own\. The newest release installs instead\.$/);
  assert.deepEqual(r.offer, { label: "Install the newest release", latest: true });
  const r2 = await t.setup.run({ alias: ALIAS, step: "install", latest: true });
  assert.equal(r2.state, "done");
  assert.match(r2.words, /^Filament 0\.9\.90 is installed there/);
  assert.ok(!f.m.ran.filter((s) => s.includes(INSTALL_URL)).at(-1)?.includes("FILAMENT_VERSION"), "no version asked: the newest");
  // A version no release's is no version to ask for: the newest.
  assert.ok(!installScript(null).includes("FILAMENT_VERSION"));
  const g = fakeMachine();
  const t2 = rig(g, { version: "36.0.0-electron x" });
  await t2.setup.run({ alias: ALIAS, step: "reach" });
  assert.equal((await t2.setup.run({ alias: ALIAS, step: "install" })).state, "done");
  assert.ok(!g.m.ran.filter((s) => s.includes(INSTALL_URL))[0].includes("FILAMENT_VERSION"));
});

test("one installed there already is left as it is: an older one said, Update Filament named", async () => {
  const t = rig(fakeMachine({ filament: "0.9.80" }));
  await t.setup.run({ alias: ALIAS, step: "reach" });
  const r = await t.setup.run({ alias: ALIAS, step: "install" });
  assert.equal(r.state, "skipped");
  assert.match(r.words, /^Filament 0\.9\.80 is installed there, older than this app's 0\.9\.85: once it is in this window, its Update Filament/);
});

test("lingering its user may not turn on: the sudo line said, and run in a terminal of the desk's", async () => {
  const f = fakeMachine({ filament: "0.9.85", lingerMay: false });
  const t = rig(f);
  await t.setup.run({ alias: ALIAS, step: "reach" });
  const r = await t.setup.run({ alias: ALIAS, step: "service" });
  assert.equal(r.state, "done");
  assert.match(r.words, /started as its user logs in/);
  assert.equal(r.also?.[0].line, "sudo loginctl enable-linger $USER");
  assert.match(r.also?.[0].words || "", /^Lingering is off for its user/);
  assert.ok(r.also?.[0].terminal?.args.includes("-t"), "in a terminal: sudo asks its password there");
  // Again, nothing changed there: nothing to do, the line said still.
  const again = await t.setup.run({ alias: ALIAS, step: "service" });
  assert.equal(again.state, "skipped");
  assert.equal(again.also?.length, 1);
});

test("no systemd there: said, nothing started", async () => {
  const t = rig(fakeMachine({ filament: "0.9.85", systemd: false }));
  await t.setup.run({ alias: ALIAS, step: "reach" });
  const r = await t.setup.run({ alias: ALIAS, step: "service" });
  assert.equal(r.state, "failed");
  assert.match(r.words, /^me@box has no systemd: Filament is installed there and runs as you start it/);
});

test("Tailscale running there: shared on the tailnet, its link claimed first — the operator's line said where Tailscale refuses its user", async () => {
  const f = fakeMachine({ tailscale: "Running", operator: false });
  const t = rig(f);
  const out = await t.all();
  assert.deepEqual(out.map((r) => r.state), STEPS.map(() => "done"));
  assert.equal(f.m.serve, true);
  assert.equal(f.m.lan, false, "the network listener left off");
  assert.match(out[4].words, /shared on your tailnet/);
  assert.deepEqual(out[4].also?.map((l) => l.line), ["sudo tailscale set --operator=$USER"]);
  assert.deepEqual(t.paired, [TS_LINK], "the tailnet's link, no pin needed");
  const ok = rig(fakeMachine({ tailscale: "Running" }));
  const out2 = await ok.all();
  assert.equal(out2[4].also, undefined, "its user serves already: no line");
});

test("no https way answers here: the tunnel's way, as an ssh:// machine pairs — and words for each", async () => {
  const f = fakeMachine();
  const t = rig(f, { answers: (/** @type {string} */ link) => link.startsWith("ssh:") });
  const out = await t.all();
  assert.equal(out[5].state, "done");
  assert.deepEqual(t.paired, [LAN_LINK, "ssh://me@box:20300"]);
  assert.match(out[5].words, /^Paired with Box through an SSH tunnel this computer holds while it is in this window: no https way of it answered here \(No Filament answers at 192\.168\.1\.20:20343\)\.$/);
  assert.deepEqual(t.ways, [], "the tunnel is its way already");
  assert.deepEqual([f.m.codes.length, t.made], [1, [undefined, "ABCD-EFGH"]], "one code made there, claimed through the tunnel");
  // Again: kept through its tunnel, nothing paired anew — no code made, its device not signed out.
  const again = await t.all();
  assert.deepEqual(again.map((r) => r.state), ["done", ...STEPS.slice(1).map(() => "skipped")]);
  assert.match(again[5].words, /^Box is in this window already, through an SSH tunnel this computer holds\.$/);
  assert.deepEqual([f.m.codes.length, t.paired.length], [1, 2]);
  const none = rig(fakeMachine(), { answers: () => false });
  const out2 = await none.all();
  assert.equal(out2[5].state, "failed");
  assert.match(out2[5].words, /^Not paired: no https way of it answered here .*, and through an SSH tunnel: No Filament answers at box:20300$/);
});

test("an agent that does not connect is said, and stops nothing: the way in and the pairing go on", async () => {
  const f = fakeMachine({ noConnect: "claude-code" });
  const out = await rig(f).all();
  assert.deepEqual(out.map((r) => r.state), STEPS.map(() => "done"));
  assert.match(out[3].words, /Not connected: Claude Code \(filament agents: its adapter could not be fetched\) — that machine's Settings › Coding agents connects it\./);
  assert.doesNotMatch(out[3].words, /not signed in/, "one not connected is not said unsigned too");
});

test("Tailscale's serve not up yet: waited for before the code is made — one code; never up, said, and the network's way or the tunnel's taken", async () => {
  const f = fakeMachine({ tailscale: "Running", served: false });
  const t = rig(f, { answers: (/** @type {string} */ link) => link.startsWith("ssh:") });
  const out = await t.all();
  assert.equal(f.m.ran.filter((s) => s.includes("tailscale serve status --json")).length, 3, "asked three times");
  assert.equal(f.m.codes.length, 1, "one code");
  assert.deepEqual(t.paired, ["ssh://me@box:20300"]);
  assert.match(out[5].words, /its tailnet address did not come: is the tailnet's HTTPS on, and may its user serve\?/);
});

// (fails before: yes — a write that failed was said as the key added, with code 0)
test("authorized_keys, by a real sh: the key added once, on a line of its own after a last line with no newline; a write that fails said with code 1, never as added", { skip: SH ? false : "no POSIX sh here (on Windows, Git for Windows carries one)" }, () => {
  const home = mkdtempSync(join(tmpdir(), "filament-ssh-keys-"));
  try {
    const key = "ssh-ed25519 AAAAC3Nza me@desk";
    assert.match(keyScript(key), /^k='ssh-ed25519 AAAAC3Nza me@desk'$/m);
    /** @type {Record<string, string>} */
    const env = { LANG: "C", HOME: home, PATH: (/** @type {any} */ (SH).tools).join(delimiter) };
    for (const k of ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR"]) if (process.env[k]) env[k] = String(process.env[k]);
    const run = () => spawnSync(/** @type {any} */ (SH).file, ["-c", keyScript(key)], { env, encoding: "utf8", windowsHide: true });
    const file = join(home, ".ssh", "authorized_keys");
    const first = run();
    assert.deepEqual([first.status, first.stdout, readFileSync(file, "utf8")], [0, "This computer's key is added there: back in Filament, the setup goes on.\n", `${key}\n`]);
    writeFileSync(file, "ssh-rsa AAAAB3Nza other");
    assert.deepEqual([run().status, run().status], [0, 0]);
    assert.equal(readFileSync(file, "utf8"), `ssh-rsa AAAAB3Nza other\n${key}\n`, "after a last line with no newline, once");
    // A file that takes no write: a folder in its place.
    rmSync(file);
    mkdirSync(file);
    const failed = run();
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, "", "never said added");
    assert.match(failed.stderr, /This computer's key is not added there: .*authorized_keys could not be written\./);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install.sh not reading this app's release's feed: the newest offered only where that release is none from here too", async () => {
  for (const [released, offered] of /** @type {const} */ ([[false, true], [true, false], [null, false]])) {
    const f = fakeMachine({ release: false });
    const t = rig(f, { released: async () => released });
    await t.setup.run({ alias: ALIAS, step: "reach" });
    const r = await t.setup.run({ alias: ALIAS, step: "install" });
    assert.equal(r.state, "failed");
    assert.equal(!!r.offer, offered, `released ${released}`);
    if (!offered) assert.match(r.words, /^install\.sh: Filament's releases gave no latest-server\.yml at /, "install.sh's own words: GitHub not reached there");
  }
  // (the hunt on s3b) An arm64 machine: its own feed asked, which a release with x64's alone is without — the newest
  // offered there too.
  /** @type {[string, string | null][]} */
  const asked = [];
  const arm = rig(fakeMachine({ release: false, arch: "aarch64" }), { released: async (/** @type {string} */ v, /** @type {string | null} */ target) => (asked.push([v, target]), target !== "linux-arm64") });
  await arm.setup.run({ alias: ALIAS, step: "reach" });
  const r = await arm.setup.run({ alias: ALIAS, step: "install" });
  assert.deepEqual([r.state, !!r.offer, asked], ["failed", true, [["0.9.85", "linux-arm64"]]]);
  assert.equal(feedUrl("0.9.85", "linux-arm64"), "https://github.com/invertibleMatrix/filament/releases/download/v0.9.85/latest-server-arm64.yml");
  assert.equal(feedUrl("0.9.85", "linux-x64"), "https://github.com/invertibleMatrix/filament/releases/download/v0.9.85/latest-server.yml");
  assert.equal(feedUrl("0.9.85", null), feedUrl("0.9.85", "linux-x64"));
});

test("lingering loginctl cannot say: turned on as its user may, else the sudo line said — never nothing to do for a machine that may not start it at boot", async () => {
  const f = fakeMachine({ filament: "0.9.85", linger: null, lingerMay: false });
  const t = rig(f);
  await t.setup.run({ alias: ALIAS, step: "reach" });
  const r = await t.setup.run({ alias: ALIAS, step: "service" });
  assert.equal(r.state, "done");
  assert.ok(f.m.ran.some((s) => s.startsWith("loginctl enable-linger")), "asked as its user may");
  assert.match(r.words, /started at boot where lingering is on, else as its user logs in/);
  assert.equal(r.also?.[0].line, "sudo loginctl enable-linger $USER");
  assert.match(r.also?.[0].words || "", /^Whether lingering is on for its user could not be read there \(loginctl\)/);
  const again = await t.setup.run({ alias: ALIAS, step: "service" });
  assert.deepEqual([again.state, again.also?.length], ["skipped", 1], "the line said still");
  // One its user may turn on: on, and said at boot.
  const may = rig(fakeMachine({ filament: "0.9.85", linger: null }));
  await may.setup.run({ alias: ALIAS, step: "reach" });
  const on = await may.setup.run({ alias: ALIAS, step: "service" });
  assert.deepEqual([on.state, on.also], ["done", undefined]);
  assert.match(on.words, /started at boot, and again after a crash\.$/);
});

test("a way in asked for that does not come up: said with why — never as listening or served, nor nothing to do —, and the pairing goes through the tunnel", async () => {
  const f = fakeMachine({ lanUp: false });
  const t = rig(f);
  const out = await t.all();
  assert.equal(out[4].state, "done");
  assert.equal(out[4].words, "Filament is asked to listen on me@box's network addresses over https, and does not: port 20343 is in use by another program: choose another port. Until it does, the pairing goes through an SSH tunnel.");
  assert.deepEqual(t.paired, ["ssh://me@box:20300"]);
  const again = await t.all();
  assert.equal(again[4].state, "done", "a second run says it again, never nothing to do");
  assert.match(again[4].words, /^Filament is asked to listen on .* and does not: port 20343 is in use/);
  // Tailscale's share asked for by a run before, and not served.
  const g = fakeMachine({ tailscale: "Running", served: false });
  const ts = rig(g, { answers: (/** @type {string} */ link) => link.startsWith("ssh:") });
  await ts.all();
  const twice = await ts.all();
  assert.equal(twice[4].state, "done");
  assert.equal(twice[4].words, "Filament is asked to share itself on your tailnet there, and Tailscale does not serve it: Tailscale's HTTPS is off for this tailnet. Until it does, the pairing goes through an SSH tunnel.");
});

// (fails before: yes — the look from before the install was kept, and the service step said Filament not installed)
test("the look after the install not answered, its connection dropped: the next step looks again, never says Filament is not installed", async () => {
  const f = fakeMachine();
  let drop = false;
  const t = rig(f, { probe: async () => (drop ? ((drop = false), { ok: false, run: { ...OK, code: 255, began: false, why: "ssh to me@box ended: Connection reset by peer" } }) : f.probe()) });
  assert.equal((await t.setup.run({ alias: ALIAS, step: "reach" })).state, "done");
  drop = true;
  const installed = await t.setup.run({ alias: ALIAS, step: "install" });
  assert.deepEqual([installed.state, installed.words], ["done", "Filament 0.9.85 is installed there, in ~/.local/share/filament."]);
  const service = await t.setup.run({ alias: ALIAS, step: "service" });
  assert.equal(service.state, "done", service.words);
  assert.match(service.words, /^Filament 0\.9\.85 runs there under systemd/);
});

// (fails before: yes — a second run, its listener on already, said no firewall line)
test("the firewall's line on every run it may close the ports — ufw on; Windows Firewall on with no rule of the line's —, none where it is off or the rule stands", async () => {
  /** The way-in step of a machine whose listener is on already. @param {any} o */
  const route = async (o) => {
    const f = fakeMachine({ lan: true, ...o });
    const t = rig(f);
    await t.setup.run({ alias: ALIAS, step: "reach" });
    return { f, t, r: await t.setup.run({ alias: ALIAS, step: "route" }) };
  };
  const ufw = await route({});
  assert.deepEqual([ufw.r.state, ufw.r.also?.map((l) => l.line)], ["skipped", ["sudo ufw allow 20343:20344/tcp"]]);
  assert.match(ufw.r.also?.[0].words || "", /^Its firewall \(ufw\) is on: unless it lets Filament's two ports in already \(its rules are root's to read\), open them/);
  assert.match(ufw.f.m.ran.find((s) => s.includes("settings get server.lan.enabled")) || "", /grep -q "\^ENABLED=yes" \/etc\/ufw\/ufw\.conf && echo ufw=1/, "ufw read as on by its conf, which any user reads");
  const off = await route({ ufw: false });
  assert.deepEqual([off.r.state, off.r.also], ["skipped", undefined]);
  const win = await route({ windows: true });
  assert.deepEqual([win.r.state, win.r.also?.map((l) => l.line)], ["skipped", [FIREWALL_LINE]]);
  assert.ok((win.f.m.ran.find((s) => s.includes("Get-NetFirewallProfile")) || "").includes("Get-NetFirewallRule -DisplayName Filament -ErrorAction Stop"), "the line's own rule looked for");
  win.f.m.rule = true;
  const ruled = await win.t.setup.run({ alias: ALIAS, step: "route" });
  assert.deepEqual([ruled.state, ruled.also], ["skipped", undefined]);
});

test("a machine you disconnected gets no way added: it stays disconnected", async () => {
  const f = fakeMachine();
  const kept = [{ id: ID, name: "Box", routes: [{ kind: "lan", url: "https://192.168.1.20:20343", fingerprint: FP }], partition: "p", off: true }];
  const t = rig(f, { kept });
  const out = await t.all();
  assert.equal(out[5].state, "skipped");
  assert.deepEqual(t.ways, []);
});

test("a step's input checked: an alias that is none, a step that is none; one step of a machine at a time", async () => {
  const f = fakeMachine();
  const t = rig(f);
  assert.deepEqual(await t.setup.run({ alias: "-oProxyCommand=x", step: "reach" }), { step: "reach", state: "failed", words: '"-oProxyCommand=x" is no SSH host: user@host, or a Host of your SSH config.' });
  assert.deepEqual(await t.setup.run({ alias: ALIAS, step: "rm" }), { step: "rm", state: "failed", words: 'No setup step "rm".' });
  const first = t.setup.run({ alias: ALIAS, step: "reach" });
  assert.match((await t.setup.run({ alias: ALIAS, step: "reach" })).words, /under way already/);
  assert.equal((await first).state, "done");
});

test("this computer's public key, ed25519's first, read as a line", () => {
  const home = mkdtempSync(join(tmpdir(), "filament-ssh-key-"));
  try {
    assert.equal(publicKeyHere(home), null);
    mkdirSync(join(home, ".ssh"));
    writeFileSync(join(home, ".ssh", "id_rsa.pub"), "ssh-rsa AAAAB3Nza me@desk\n");
    assert.equal(publicKeyHere(home), "ssh-rsa AAAAB3Nza me@desk");
    writeFileSync(join(home, ".ssh", "id_ed25519.pub"), "ssh-ed25519 AAAAC3Nza me@desk\r\n");
    assert.equal(publicKeyHere(home), "ssh-ed25519 AAAAC3Nza me@desk");
    writeFileSync(join(home, ".ssh", "id_ed25519.pub"), "-----BEGIN OPENSSH PRIVATE KEY-----\n");
    assert.equal(publicKeyHere(home), "ssh-rsa AAAAB3Nza me@desk", "a file that holds no public key is none");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a fresh Windows host: every command PowerShell's — install.ps1 at this app's version, Task Scheduler's task, its agents and memory, Windows Firewall's line, paired; then nothing to do", async () => {
  const f = fakeMachine({ windows: true });
  const t = rig(f);
  const out = await t.all();
  assert.deepEqual(out.map((r) => [r.step, r.state]), STEPS.map((s) => [s.id, "done"]));
  assert.equal(out[0].words, "me@box answers: Windows on AMD64.");
  assert.ok(f.m.ran.some((s) => s.includes(INSTALL_PS_URL) && s.includes("$env:FILAMENT_VERSION = '0.9.85'")), "this app's version asked of install.ps1");
  assert.equal(out[1].words, "Filament 0.9.85 is installed there, in %LOCALAPPDATA%\\filament.");
  assert.equal(out[2].words, "Filament 0.9.85 runs there under Task Scheduler (its task \\Filament\\Filament), started at boot with no one logged in, and again after a crash.");
  assert.equal(out[2].also, undefined);
  assert.equal(f.m.ran.some((s) => /loginctl|systemctl/.test(s)), false, "no lingering, no systemd");
  assert.match(out[3].words, /^Connected Claude Code\..* Memory is on now\.$/);
  assert.deepEqual(out[4].also?.map((l) => l.line), [FIREWALL_LINE], "Windows Firewall's line said");
  const line = String(out[4].also?.[0].terminal?.args.at(-1));
  assert.match(line, /^powershell -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/, "and run there by PowerShell in a terminal");
  assert.equal(Buffer.from(line.split(" ").at(-1) || "", "base64").toString("utf16le"), FIREWALL_LINE);
  assert.deepEqual(t.paired, [LAN_LINK]);
  assert.deepEqual(out[5].machine, { id: ID, name: "Box" });
  const again = await t.all();
  assert.deepEqual(again.map((r) => [r.step, r.state]), [["reach", "done"], ...STEPS.slice(1).map((s) => [s.id, "skipped"])]);
  assert.equal(again[0].words, "me@box answers: Windows on AMD64, Filament 0.9.85 installed there.");
});

// (fails before: yes — a Mac was refused at its first step)
test("a fresh Mac: install.sh at this app's version, launchd's LaunchAgent and its LaunchDaemon's sudo line, its agents and memory, macOS's firewall line for its Node, paired; then nothing to do but what sudo does", async () => {
  const f = fakeMachine({ mac: true });
  const t = rig(f);
  const out = await t.all();
  assert.deepEqual(out.map((r) => [r.step, r.state]), STEPS.map((s) => [s.id, "done"]));
  assert.equal(out[0].words, "me@box answers: macOS 14.5 on arm64.");
  assert.ok(f.m.ran.some((s) => s.includes(INSTALL_URL) && s.includes("FILAMENT_VERSION='0.9.85' sh")), "install.sh at this app's version");
  assert.equal(out[1].words, "Filament 0.9.85 is installed there, in ~/.local/share/filament.");
  assert.equal(out[2].words, "Filament 0.9.85 runs there under launchd (its LaunchAgent), started as its user logs in at the Mac, and again after a crash.");
  assert.deepEqual(out[2].also?.map((l) => l.line), [BOOT_LINE], "its LaunchDaemon's sudo line, as its status says it");
  assert.equal(scriptOf(out[2].also?.[0].terminal), BOOT_LINE, "and run there in a terminal, where sudo asks");
  assert.equal(f.m.ran.some((s) => /loginctl|systemctl/.test(s)), false, "no lingering, no systemd");
  assert.match(out[3].words, /^Connected Claude Code\..* Memory is on now\.$/);
  const fw = `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add '${MAC_NODE}' && sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp '${MAC_NODE}'`;
  assert.deepEqual(out[4].also?.map((l) => l.line), [fw], "macOS's firewall lets its Node in");
  assert.equal(scriptOf(out[4].also?.[0].terminal), fw);
  const ways = f.m.ran.find((s) => s.includes("settings get server.lan.enabled")) || "";
  assert.ok(ways.includes("socketfilterfw --getglobalstate") && ways.includes('readlink -f "$HOME/.local/bin/filament"'), "its firewall read, and its Node's real path");
  assert.deepEqual(t.paired, [LAN_LINK]);
  assert.deepEqual(out[5].machine, { id: ID, name: "Box" });
  // Its LaunchDaemon installed (the sudo line run): at boot, its line said no more.
  f.m.boot = true;
  const again = await t.all();
  assert.deepEqual(again.map((r) => [r.step, r.state]), [["reach", "done"], ...STEPS.slice(1).map((s) => [s.id, "skipped"])]);
  assert.deepEqual([again[2].words, again[2].also], ["Filament 0.9.85 runs there under launchd (its LaunchAgent), started at boot, and again after a crash.", undefined]);
  assert.deepEqual(again[4].also?.map((l) => l.line), [fw], "the firewall's line while it is on");
  // Its firewall off: no line.
  f.m.ufw = false;
  assert.equal((await t.setup.run({ alias: ALIAS, step: "route" })).also, undefined);
});

test("a Mac with Tailscale: found where its app keeps it, shared on the tailnet, no operator to name", async () => {
  const f = fakeMachine({ mac: true, tailscale: "Running" });
  const out = await rig(f).all();
  assert.deepEqual(out.map((r) => r.state), STEPS.map(() => "done"));
  assert.equal(out[4].also, undefined, "a Mac's Tailscale names no operator");
  assert.equal(f.m.ran.some((s) => s.includes("tailscale debug prefs")), false);
  const look = f.m.ran.find((s) => s.includes('"$t" status --json')) || "";
  assert.ok(look.includes("/Applications/Tailscale.app/Contents/MacOS/Tailscale") && look.includes("/opt/homebrew/bin/tailscale"), "its app's and Homebrew's, which an SSH session's PATH does not hold");
  assert.deepEqual(f.m.ran.filter((s) => s.includes("settings set")).map((s) => s.split("\n").at(-1)), ['exec "$HOME/.local/bin/filament" settings set server.tailscale.serve true']);
});

test("a Windows host with Tailscale: shared on the tailnet, no operator to name; its release not out for Windows, the newest offered — its own feed asked", async () => {
  const f = fakeMachine({ windows: true, tailscale: "Running" });
  const out = await rig(f).all();
  assert.deepEqual(out.map((r) => r.state), STEPS.map(() => "done"));
  assert.equal(out[4].also, undefined, "Windows' Tailscale names no operator");
  assert.equal(f.m.ran.some((s) => s.includes("tailscale debug prefs")), false);
  /** @type {[string, string | null][]} */
  const asked = [];
  const t = rig(fakeMachine({ windows: true, release: false }), { released: async (/** @type {string} */ v, /** @type {string | null} */ target) => (asked.push([v, target]), false) });
  await t.setup.run({ alias: ALIAS, step: "reach" });
  const r = await t.setup.run({ alias: ALIAS, step: "install" });
  assert.deepEqual([r.state, r.offer, asked], ["failed", { label: "Install the newest release", latest: true }, [["0.9.85", "win32-x64"]]]);
  assert.equal(feedUrl("0.9.85", "win32-x64"), "https://github.com/invertibleMatrix/filament/releases/download/v0.9.85/latest-server-win32-x64.yml");
  assert.match(installPs(null), /Remove-Item Env:FILAMENT_VERSION/, "no version asked: the newest");
  assert.match(installPs("1.2.3"), /^\$env:FILAMENT_VERSION = '1\.2\.3'$/m);
});

// A Windows host set up for real: a Windows PowerShell started by cmd, as a Windows host's OpenSSH starts one, runs
// each step's script against a Filament that stands in for install.ps1's — a filament.cmd whose fake answers as the real
// one's words do — in a LOCALAPPDATA of its own, with no sh on its PATH; the install.ps1 it downloads is a server's here.
const realPs = process.platform === "win32" && spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { stdio: "ignore", windowsHide: true }).status === 0;
test("a Windows host, its scripts run by a real Windows PowerShell: every step done, then every step after the first with nothing to do", { skip: realPs ? false : "no Windows PowerShell on this computer", timeout: 300_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "filament-win-setup-"));
  const server = createServer();
  try {
    const local = join(home, "Local");
    const kit = join(home, "kit");
    const data = join(home, "data");
    const state = join(home, "state.json");
    mkdirSync(local);
    mkdirSync(kit);
    writeFileSync(state, JSON.stringify({ installed: false, codes: 0, agents: [{ id: "claude-code", name: "Claude Code", state: "ready", signedIn: "me" }], settings: { "server.lan.enabled": "false", "server.tailscale.serve": "false", "memory.enabled": "false" } }));
    writeFileSync(join(kit, "filament.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0fake.cjs" %*\r\nexit /b %ERRORLEVEL%\r\n`);
    writeFileSync(
      join(kit, "fake.cjs"),
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        `const STATE = ${JSON.stringify(state)};`,
        `const DATA = ${JSON.stringify(data)};`,
        'const s = JSON.parse(fs.readFileSync(STATE, "utf8"));',
        "const save = () => fs.writeFileSync(STATE, JSON.stringify(s));",
        'const version = fs.readFileSync(path.join(__dirname, "version.txt"), "utf8").trim();',
        "const a = process.argv.slice(2);",
        'const w = a.join(" ");',
        'const out = (x) => process.stdout.write(typeof x === "string" ? x : `${JSON.stringify(x, null, 2)}\\n`);',
        'const lan = () => s.settings["server.lan.enabled"] === "true";',
        'if (w === "--version") out(`${version}\\n`);',
        'else if (w === "service status --json") out({ installed: s.installed, active: s.installed ? "active" : "inactive", enabled: s.installed ? "enabled" : "not-found", dataDir: s.installed ? DATA : null, linger: s.installed ? true : null, filament: s.installed ? { version, url: "http://127.0.0.1:20300", supervisor: "service" } : null });',
        'else if (w === "service install") { s.installed = true; save(); fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(path.join(DATA, "machine.json"), JSON.stringify({ version: 1, id: "m-box", name: "Box" })); out("Wrote its task.\\n"); }',
        // A program's words on stderr, as a real one says them: no error of the script's.
        'else if (w === "agents detect") process.stderr.write("looked for coding agents\\n");',
        'else if (w === "agents list --json") out(s.agents);',
        'else if (a[0] === "agents" && a[1] === "connect") { s.agents = s.agents.map((x) => (x.id === a[2] ? { ...x, state: "connected" } : x)); save(); }',
        'else if (a[0] === "settings" && a[1] === "get") out(`${s.settings[a[2]] ?? ""}\\n`);',
        'else if (a[0] === "settings" && a[1] === "set") { s.settings[a[2]] = a[3]; save(); }',
        'else if (w === "memory on") { s.settings["memory.enabled"] = "true"; save(); }',
        'else if (w === "status --json") out({ version, network: { on: lan(), listening: lan() ? 20343 : null, error: null }, tailnet: { on: false, served: false, error: null } });',
        `else if (w === "pair --json") { s.codes++; save(); out({ code: "ABCD-EFGH", links: lan() ? [${JSON.stringify(LAN_LINK)}] : [], fingerprint: ${JSON.stringify(FP)}, machine: { id: "m-box", name: "Box" } }); }`,
        'else { process.stderr.write(`fake filament: no ${w}\\n`); process.exit(2); }',
      ].join("\n"),
    );
    // install.ps1's part: the version asked (else the newest) put in place, its words said, its code 0.
    const installer = [
      "& {",
      "  $v = if ($env:FILAMENT_VERSION) { $env:FILAMENT_VERSION } else { '0.9.90' }",
      "  $bin = Join-Path $env:LOCALAPPDATA 'filament\\current\\bin'",
      "  New-Item -ItemType Directory -Force -Path $bin | Out-Null",
      `  Copy-Item -Path (Join-Path ${psQuote(kit)} '*') -Destination $bin`,
      "  Set-Content -LiteralPath (Join-Path $bin 'version.txt') -Value $v",
      '  $Host.UI.WriteLine("Filament $v is installed in $bin.")',
      "  $global:LASTEXITCODE = 0",
      "}",
    ].join("\r\n");
    server.on("request", (req, res) => (req.url === "/install.ps1" ? res.end(installer) : ((res.statusCode = 404), res.end())));
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
    const url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}/install.ps1`;
    const root = String(process.env.SystemRoot || "C:\\Windows");
    /** @type {Record<string, string | undefined>} */
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^path$/i.test(k)));
    env.Path = [`${root}\\System32`, root, `${root}\\System32\\Wbem`, `${root}\\System32\\WindowsPowerShell\\v1.0`].join(";");
    env.LOCALAPPDATA = local;
    const spawn = (/** @type {string} */ _f, /** @type {string[]} */ args, /** @type {any} */ o) => spawnChild(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", String(args.at(-1))], { ...o, env });
    /** @type {any[]} */
    const runs = [];
    const machine = {
      /** @param {string} alias @param {any} what @param {any} [opt] */
      ssh: async (alias, what, opt = {}) => {
        const r = await runSsh(alias, "script" in what ? { ...what, script: String(what.script).split(INSTALL_PS_URL).join(url) } : what, { ...opt, spawn });
        runs.push([what, r]);
        return r;
      },
      probe: (/** @type {string} */ a) => probeSsh(a, { spawn }),
    };
    const t = rig(machine);
    const out = await t.all();
    assert.deepEqual(out.map((r) => [r.step, r.state, r.state === "done" ? "" : r.words]), STEPS.map((s) => [s.id, "done", ""]));
    assert.equal(out[0].words, "me@box answers: Windows on AMD64.");
    assert.equal(out[1].words, "Filament 0.9.85 is installed there, in %LOCALAPPDATA%\\filament.");
    assert.match(out[2].words, /^Filament 0\.9\.85 runs there under Task Scheduler/);
    assert.equal(out[3].words, "Connected Claude Code. Memory is on now.");
    assert.deepEqual(out[4].also?.map((l) => l.line) ?? [], runs.some(([w, r]) => String(w.script || "").includes("Get-NetFirewallProfile") && /firewall=1/.test(r.stdout)) ? [FIREWALL_LINE] : []);
    assert.deepEqual([t.paired, out[5].machine], [[LAN_LINK], { id: ID, name: "Box" }]);
    const st = JSON.parse(readFileSync(state, "utf8"));
    assert.deepEqual([st.installed, st.agents[0].state, st.settings["memory.enabled"], st.settings["server.lan.enabled"], st.codes], [true, "connected", "true", "true", 1]);
    assert.equal(runs.every(([w]) => w.shell === "powershell"), true, "every command PowerShell's");
    const again = await t.all();
    assert.deepEqual(again.map((r) => [r.step, r.state]), [["reach", "done"], ...STEPS.slice(1).map((s) => [s.id, "skipped"])]);
    assert.equal(JSON.parse(readFileSync(state, "utf8")).codes, 1, "no code made again");
  } finally {
    server.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// A Windows host's key, by a real Windows PowerShell as its terminal runs it (-EncodedCommand), for a user who is no
// administrator, in a profile of its own (USERPROFILE); an administrator's file and its access are the script's words.
// (fails before: yes — there was no Windows key script: a Windows host was offered sh's)
test("a Windows host's key, by a real Windows PowerShell: added once, on a line of its own; a write that fails said with code 1, never as added", { skip: realPs ? false : "no Windows PowerShell on this computer", timeout: 120_000 }, () => {
  const home = mkdtempSync(join(tmpdir(), "filament-ps-keys-"));
  try {
    const key = "ssh-ed25519 AAAAC3Nza me@desk";
    const ps = keyPs(key);
    assert.ok(ps.includes("$admin = [bool]((whoami /groups) -match 'S-1-5-32-544')"), "an administrator known by the group's SID");
    assert.ok(ps.includes("Join-Path $env:ProgramData 'ssh\\administrators_authorized_keys'"));
    assert.ok(ps.includes("icacls $f /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F'"), "its access Administrators' and SYSTEM's alone");
    assert.doesNotThrow(() => commandOf({ script: ps, shell: "powershell" }), "it fits the command line its cmd starts");
    const run = () => spawnSync("powershell", commandOf({ script: keyPs(key, "$false"), shell: "powershell" }).split(" ").slice(1), { env: { ...process.env, USERPROFILE: home }, encoding: "utf8", windowsHide: true });
    const file = join(home, ".ssh", "authorized_keys");
    const first = run();
    assert.deepEqual([first.status, first.stdout.trim(), readFileSync(file, "utf8")], [0, "This computer's key is added there: back in Filament, the setup goes on.", `${key}\r\n`]);
    writeFileSync(file, "ssh-rsa AAAAB3Nza other");
    assert.deepEqual([run().status, run().status], [0, 0]);
    assert.equal(readFileSync(file, "utf8"), `ssh-rsa AAAAB3Nza other\r\n${key}\r\n`, "after a last line with no newline, once");
    rmSync(file);
    mkdirSync(file);
    const failed = run();
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout.trim(), "", "never said added");
    assert.match(failed.stderr, /This computer's key is not added there: /);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
