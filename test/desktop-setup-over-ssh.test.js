// The desk's setup of a Linux machine over SSH (desktop/lib/setup-over-ssh.js, the remote desk's s3b): each step against
// a fake machine reached by a fake ssh — what it runs there, in order; a set-up machine answering every step with
// nothing to do; what only the person answers going to a terminal; and the words of each refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTALL_URL, STEPS, createSetupOverSsh, installScript, keyScript, publicKeyHere } from "../desktop/lib/setup-over-ssh.js";
import { PAIR_SCRIPT } from "../desktop/lib/add-machine.js";
import { platformOf } from "../desktop/lib/ssh-exec.js";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ALIAS = "me@box";
const ID = "m-box";
const FP = "AB:".repeat(31) + "AB";
const LAN_LINK = `https://192.168.1.20:20343/ui/pair.html#code=ABCD-EFGH&fp=${FP}`;
const TS_LINK = "https://box.tail1234.ts.net/ui/pair.html#code=ABCD-EFGH";
const OK = { code: 0, stdout: "", stderr: "", cut: false, why: null, ask: null, began: true };
/** What a terminal's ssh runs there: its command's script, decoded. @param {any} t */
const scriptOf = (t) => Buffer.from(/printf %s ([A-Za-z0-9+/=]+)/.exec(String(t?.args.at(-1)))?.[1] || "", "base64").toString("utf8");

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
    linger: o.linger ?? false,
    lingerMay: o.lingerMay ?? true,
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
    ufw: o.ufw ?? true,
    /** @type {string[]} */ codes: [],
    links: o.links ?? null,
    /** @type {string[]} */ ran: [],
  };
  const platform = () =>
    platformOf(
      ["os=Linux", "arch=x86_64", "bits=64", "libc=glibc 2.35", "home=/home/me", ...(m.systemd ? ["has=systemctl", "has=loginctl"] : []), ...["curl", "tar", "gzip", "sha512sum", "base64", "od", "mktemp", "readlink", "ln"].map((t) => `has=${t}`), ...(m.tailscale ? ["has=tailscale"] : []), ...(m.filament ? [`filament=${m.filament}`] : [])].join("\n"),
      "sh",
    );
  const status = () => ({ ...m.service, linger: m.linger, dataDir: m.service.installed ? "/home/me/.local/share/filament/data" : null, filament: m.service.active === "active" ? { version: m.filament, url: "http://127.0.0.1:20300", supervisor: "systemd" } : null });
  /** @param {string} alias @param {any} what @param {any} [opt] */
  const ssh = async (alias, what, opt = {}) => {
    assert.equal(alias, ALIAS);
    const s = "argv" in what ? what.argv.join(" ") : String(what.script);
    m.ran.push(s);
    if ("argv" in what && what.argv[0] === "cat") return { ...OK, stdout: JSON.stringify({ version: 1, id: ID, name: "Box" }) };
    if (s.includes(INSTALL_URL)) {
      assert.ok(opt.timeoutMs >= 600_000, "the install is given its time");
      const v = /FILAMENT_VERSION='([^']+)'/.exec(s)?.[1] || "0.9.90";
      if (/FILAMENT_VERSION/.test(s) && !m.release) return { ...OK, code: 1, stderr: `install.sh: Filament's releases gave no latest-server.yml at https://github.com/x/releases/download/v${v}/latest-server.yml (is ${v} a release of Filament for servers?): nothing was installed.\n` };
      m.filament = v;
      return { ...OK, stdout: `Filament ${v} is installed.\n` };
    }
    if (s.includes("service status --json")) return { ...OK, stdout: `${JSON.stringify(status(), null, 2)}\n` };
    if (s.includes("service install")) {
      m.service = { installed: true, active: "active", enabled: "enabled" };
      return { ...OK, stdout: "Wrote ~/.config/systemd/user/filament.service.\n" };
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
    if (s.includes("settings get server.lan.enabled")) return { ...OK, stdout: `lan=${m.lan}\nserve=${m.serve}\n${m.ufw ? "ufw=1\n" : ""}${m.tailscale ? "tailscale=1\n" : ""}` };
    if (s.includes("tailscale status --json")) return { ...OK, stdout: JSON.stringify({ BackendState: m.tailscale }) };
    // Its prefs read by any user; its serve's config too.
    if (s.includes("tailscale debug prefs")) return { ...OK, stdout: `me\n${JSON.stringify({ OperatorUser: m.operator ? "me" : "" }, null, 2)}\n` };
    if (s.includes("tailscale serve status --json")) return { ...OK, stdout: m.serve && m.served ? JSON.stringify({ Web: { "box.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:20345" } } } } }) : "{}" };
    if (s.includes("settings set server.tailscale.serve true")) return ((m.serve = true), OK);
    if (s.includes("settings set server.lan.enabled true")) return ((m.lan = true), OK);
    if (s === PAIR_SCRIPT) {
      m.codes.push("ABCD-EFGH");
      return { ...OK, stdout: JSON.stringify({ code: "ABCD-EFGH", links: m.links ?? [...(m.serve && m.served ? [TS_LINK] : []), ...(m.lan ? [LAN_LINK] : [])], fingerprint: FP, machine: { id: ID, name: "Box" } }) };
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
  const none = await rig(f, { probe: async () => ({ ok: false, run }), key: null }).setup.run({ alias: ALIAS, step: "reach" });
  assert.deepEqual(none.also?.map((l) => [l.line, l.terminal]), [["ssh-keygen -t ed25519", null]]);
});

test("refused as install.sh refuses: another system, or what its installer needs missing", async () => {
  const mac = { ok: true, platform: platformOf("os=Darwin\narch=arm64\nbits=64", "sh") };
  const r = await rig(fakeMachine(), { probe: async () => mac }).setup.run({ alias: ALIAS, step: "reach" });
  assert.deepEqual([r.state, r.words], ["failed", "Filament for servers is built for Linux on x86_64 and on arm64 (aarch64), and this machine is Darwin on arm64."]);
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

test("authorized_keys: the key added once, on a line of its own after a last line with no newline", () => {
  const s = keyScript("ssh-ed25519 AAAAC3Nza me@desk");
  assert.match(s, /^k='ssh-ed25519 AAAAC3Nza me@desk'$/m);
  assert.match(s, /if ! grep -qxF "\$k" "\$f"; then \[ -n "\$\(tail -c 1 "\$f"\)" \] && echo >> "\$f"; printf '%s\\n' "\$k" >> "\$f"; fi/);
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
