// @ts-check
// Commands on another machine over SSH, from the desk (desktop/lib/ssh-exec.js, s3a): ssh's arguments for a batch run
// and for a terminal, the command line as every login shell there reads it — run through each real shell this
// computer has —, ssh's failures in words, and runs through a fake ssh — a real process, its streams, its code, a
// secret on its standard input, its output kept to a bound, a run let go of past its time, a code of 255 that is the
// command's own and one that is a connection dropped under it, something run in its place — with a host key the person
// meets in a terminal; and the look at what a machine is.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn as spawnChild, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BEGAN, ENDED, KILL_GRACE_MS, OUTPUT_MAX, PROBE_PS, PS_LINE_MAX, SCRIPT_MAX, batchArgs, commandOf, execWords, platformOf, probeSsh, runSsh, shQuote, sshTerminal } from "../desktop/lib/ssh-exec.js";

/** What a marked script for sh says around its command: that it began, then the command in a shell of its own, then its end and code. */
const SH_HEAD = `printf '%s\\n' ${BEGAN} >&2\n(\n`;
const SH_TAIL = `\n)\nc=$?\nprintf '%s %s\\n' ${ENDED} "$c" >&2\nexit "$c"`;

/** The script a command line for sh carries. @param {string} line */
const scriptOf = (line) => {
  const m = /^sh -c 's=\$\(printf %s ([A-Za-z0-9+/=]+) \| \{ base64 -d 2>\/dev\/null \|\| base64 -D; \}\) && eval "\$s"'$/.exec(line);
  assert.ok(m, `a command line for sh: ${line.slice(0, 120)}`);
  return Buffer.from(m[1], "base64").toString("utf8");
};
const OWN = ["-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "ClearAllForwardings=yes", "-o", "RemoteCommand=none", "-o", "ForwardAgent=no", "-o", "ForwardX11=no"];

describe("ssh's words", () => {
  // (fails before: yes — the desk ran no command over SSH: ssh-route.js held tunnels alone)
  test("a batch run: no terminal, batch mode, host keys checked strictly, errors said, a process of its own with none of the config's forwards or remote command, the alias after --", () => {
    assert.deepEqual(batchArgs("me@box", "uname"), [
      "-T",
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=yes",
      "-o", "LogLevel=ERROR",
      ...OWN,
      "-o", "ConnectTimeout=10",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=3",
      "--", "me@box", "uname",
    ]);
  });

  test("a command line every login shell reads alike: sh's script in base64, its words each quoted for sh; PowerShell's encoded", () => {
    assert.equal(shQuote("it's $(rm -rf ~) `x` \"y\""), `'it'\\''s $(rm -rf ~) \`x\` "y"'`);
    const line = commandOf({ argv: ["filament", "keys", "add", "anthropic", "--key-stdin"] });
    // One pair of single quotes, and nothing in them fish or csh reads: no backslash, no quote, no newline, no !.
    assert.match(line, /^sh -c '[^'\\\n!]*'$/);
    assert.equal(scriptOf(line), "'filament' 'keys' 'add' 'anthropic' '--key-stdin'");
    assert.equal(scriptOf(commandOf({ script: "echo a; echo 'b'\nexit 3" })), "echo a; echo 'b'\nexit 3");
    assert.equal(scriptOf(commandOf({ argv: ["true"] }, { marked: true })), `${SH_HEAD}'true'${SH_TAIL}`, "marked: it says that it began, then its end and code");
    const ps = commandOf({ script: "\"os=Windows\"", shell: "powershell" });
    assert.match(ps, /^powershell -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/);
    assert.equal(Buffer.from(ps.split(" ").at(-1) || "", "base64").toString("utf16le"), "\"os=Windows\"");
    const marked = commandOf({ script: "1", shell: "powershell" }, { marked: true });
    assert.equal(Buffer.from(marked.split(" ").at(-1) || "", "base64").toString("utf16le"), `[Console]::Error.WriteLine('${BEGAN}')\n1`);
    assert.throws(() => commandOf({ argv: [] }), /needs its words/);
    assert.throws(() => commandOf({ script: "x".repeat(SCRIPT_MAX) }), /standard input/, "a Windows desk starts no longer command line");
    assert.equal(commandOf({ script: "x".repeat(20 * 1024) }).length < 32_000, true);
    assert.throws(() => commandOf({ script: "x".repeat(PS_LINE_MAX), shell: "powershell" }), /kept to 8000 characters/, "nor does a Windows host's cmd");
  });

  // Each shell here reads the line as a login shell there does (`<shell> -c <line>`), and the sh it starts runs it.
  const shells = ["sh", "dash", "bash", "zsh", "fish", "csh", "tcsh"].filter((s) => spawnSync(s, ["-c", "exit 0"], { stdio: "ignore", windowsHide: true }).status === 0);
  const decodes = shells.includes("sh") && spawnSync("sh", ["-c", "command -v base64"], { stdio: "ignore", windowsHide: true }).status === 0;
  test(`the line runs in a real shell: words whole, its input the command's, its code said (${shells.join(", ") || "none here"})`, { skip: decodes ? false : "no sh with base64 on this computer" }, () => {
    const words = ["printf", "%s|", "it's", "$HOME", "a\\b", "two\nlines", "`x`", "!1", "*"];
    for (const shell of shells) {
      /** @param {import("../desktop/lib/ssh-exec.js").RunWhat} what @param {string} [input] */
      const run = (what, input) => spawnSync(shell, ["-c", commandOf(what, { marked: true })], { input, encoding: "utf8", windowsHide: true });
      const said = run({ argv: words });
      assert.deepEqual([shell, said.status, said.stdout, said.stderr], [shell, 0, "it's|$HOME|a\\b|two\nlines|`x`|!1|*|", `${BEGAN}\n${ENDED} 0\n`]);
      assert.equal(run({ argv: ["cat"] }, "a secret\n").stdout, "a secret\n", `${shell}: its standard input is the command's`);
      const seven = run({ script: "echo out; exit 7" });
      assert.deepEqual([seven.status, seven.stdout, seven.stderr], [7, "out\n", `${BEGAN}\n${ENDED} 7\n`], `${shell}: its code, said as it ended, its exit its own shell's alone`);
    }
  });

  test("a terminal for what the person answers: -t, the host key asked with its fingerprint shown — never accepted unasked —, the command, else exit; the line a person types", () => {
    const t = sshTerminal("me@box", null, { cli: () => "ssh" });
    assert.deepEqual(t, { file: "ssh", args: ["-t", "-o", "StrictHostKeyChecking=ask", ...OWN, "--", "me@box", "exit"], line: "ssh -t me@box exit" });
    assert.equal(t.args.some((a) => /accept-new|StrictHostKeyChecking=no|BatchMode/i.test(a)), false);
    const linger = sshTerminal("box", { argv: ["sudo", "loginctl", "enable-linger", "me"] }, { cli: () => "ssh" });
    assert.equal(scriptOf(linger.args.at(-1) || ""), "'sudo' 'loginctl' 'enable-linger' 'me'");
    assert.equal(linger.line, "ssh -t box sudo loginctl enable-linger me");
    assert.equal(sshTerminal("box", { argv: ["echo", "a b"] }, { cli: () => "ssh" }).line, `ssh -t box ${shQuote("'echo' 'a b'")}`, "quoted for the shell here and the one there");
    assert.equal(sshTerminal("box", { argv: ["echo", "=x"] }, { cli: () => "ssh" }).line, `ssh -t box ${shQuote("'echo' '=x'")}`, "a word zsh reads (=word) is quoted too");
    assert.equal(sshTerminal("box", { script: "echo a" }, { cli: () => "ssh" }).line, null, "a script is no line to type");
    assert.throws(() => sshTerminal("-oProxyCommand=calc", null), /is no SSH host/);
  });

  test("why ssh did not reach the command, in words, and what only the person can answer", () => {
    const w = (/** @type {string} */ said) => execWords(said, "box");
    assert.deepEqual(w("No ED25519 host key is known for box and you have requested strict checking.\r\nHost key verification failed.\r\n"), { why: "ssh does not know box's host key yet: check the fingerprint it shows in the terminal and accept it there, or connect once from a terminal yourself (ssh box).", ask: "host-key" });
    const changed = w("@@@@\r\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\nHost key verification failed.");
    assert.equal(changed.ask, null, "a key that changed is refused, never offered to accept");
    assert.match(changed.why, /^box's host key is not the one your known_hosts has: nothing was sent/);
    assert.deepEqual(w("@@@\r\n@       WARNING: REVOKED HOST KEY DETECTED!               @\r\nHost key verification failed."), { why: "box's host key is marked revoked in your known_hosts: nothing was sent.", ask: null });
    assert.deepEqual(w("me@box: Permission denied (publickey,password)."), { why: "box asks for a password or a code, which a command from the desk cannot type: add a key it accepts (ssh-copy-id box), or run this step in a terminal, where you answer it.", ask: "sign-in" });
    assert.equal(w("me@box: Permission denied (publickey,keyboard-interactive).").ask, "sign-in");
    assert.deepEqual([w("me@box: Permission denied (publickey).").ask, w("me@box: Permission denied (publickey).").why.startsWith("box refused your SSH keys")], [null, true]);
    assert.match(w("ssh: connect to host box port 22: Connection refused").why, /^box refuses SSH: is its SSH server on/);
    assert.match(w("ENOENT spawn ssh ENOENT").why, /^This computer has no ssh/);
    assert.equal(w("kex_exchange_identification: read: Connection reset").why, "ssh to box ended: kex_exchange_identification: read: Connection reset");
    assert.equal(w("").why, "ssh to box ended before the command ran.");
  });
});

describe("what a machine is", () => {
  const TOOLS = "has=systemctl\nhas=curl\nhas=tar\nhas=gzip\nhas=sha512sum\nhas=base64\nhas=od\nhas=mktemp\nhas=readlink\nhas=ln\n";
  test("Linux on x86_64 or arm64, 64-bit, glibc 2.28 or newer has a server build; anything else is said as install.sh says it", () => {
    const linux = platformOf(`os=Linux\narch=x86_64\nbits=64\nlibc=glibc 2.35\nldd=ldd (Ubuntu GLIBC 2.35-0ubuntu3) 2.35\nhome=/home/me\n${TOOLS}filament=0.9.84\n`, "sh");
    assert.deepEqual(linux, { os: "Linux", arch: "x86_64", bits: 64, libc: "2.35", has: ["systemctl", "curl", "tar", "gzip", "sha512sum", "base64", "od", "mktemp", "readlink", "ln"], shell: "sh", filament: "0.9.84", target: "linux-x64", refusal: null, missing: [], needs: null });
    assert.equal(platformOf("os=Linux\narch=aarch64\nbits=64\nlibc=glibc 2.36", "sh").target, "linux-arm64");
    assert.equal(platformOf("os=Linux\narch=aarch64\nbits=64\nlibc=\nldd=ldd (GNU libc) 2.31", "sh").libc, "2.31", "ldd's word where getconf says none");
    assert.match(String(platformOf("os=Linux\narch=aarch64\nbits=32\nlibc=glibc 2.36", "sh").refusal), /^Filament for servers runs 64-bit programs, and this machine's are 32-bit, on its aarch64 kernel/);
    assert.match(String(platformOf("os=Linux\narch=x86_64\nbits=64\nlibc=\nldd=musl libc (x86_64)", "sh").refusal), /C library is another \(Alpine's musl\?\)/);
    assert.equal(platformOf("os=Linux\narch=x86_64\nbits=64\nlibc=glibc 2.27", "sh").refusal, "Filament for servers needs glibc 2.28 or newer, and this machine has 2.27.");
    assert.equal(platformOf("os=Linux\narch=x86_64\nbits=64\nlibc=glibc 2.28", "sh").target, "linux-x64");
    assert.equal(platformOf("os=Darwin\narch=arm64\nbits=64", "sh").refusal, "Filament for servers is built for Linux on x86_64 and on arm64 (aarch64), and this machine is Darwin on arm64.");
    assert.deepEqual([platformOf("os=MINGW64_NT-10.0-26100\narch=x86_64", "sh").os, platformOf("os=Windows\narch=AMD64\nbits=64\nhas=winget", "powershell").target], ["Windows", null]);
    assert.match(PROBE_PS, /\[Environment\]::Is64BitOperatingSystem/);
  });

  test("what install.sh needs that is not there is said, as it would say it; a user with no HOME too", () => {
    const bare = platformOf("os=Linux\narch=x86_64\nbits=64\nlibc=glibc 2.35\nhome=/home/me\nhas=wget\nhas=openssl\nhas=tar\n", "sh");
    assert.deepEqual(bare.missing, ["gzip", "base64", "od", "mktemp", "readlink", "ln"]);
    assert.equal(bare.needs, "Filament's installer needs gzip, base64, od, mktemp, readlink, ln, which this machine does not have: install them with its package manager.");
    assert.equal(bare.target, "linux-x64", "a build it has, once they are there");
    assert.deepEqual(platformOf("os=Linux\narch=x86_64\nbits=64\nlibc=glibc 2.35\nhas=tar", "sh").missing.slice(0, 2), ["curl or wget", "gzip"]);
    assert.match(String(platformOf(`os=Linux\narch=x86_64\nbits=64\nlibc=glibc 2.35\nhome=\n${TOOLS}`, "sh").needs), /^HOME is not set there/);
    assert.deepEqual([platformOf("os=Darwin\narch=arm64\nbits=64", "sh").missing, platformOf("os=Windows\narch=AMD64", "powershell").needs], [[], null], "one refused needs nothing more");
  });
});

describe("runs through a fake ssh", () => {
  /** @type {string} */
  let dir = "";
  /** @type {string} */
  let fake = "";
  /** What each run was started with. @type {string[][]} */
  const started = [];
  // A real process for ssh: the alias and the command line after `--`, as ssh takes them; the script in it read as the
  // shell there reads it, saying on stderr that it began and, ended, its code; what it does by its words. ssh's own
  // failures (`fail`) say neither; something run in the command's place runs none of it.
  const FAKE = String.raw`
const { existsSync, writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const [dir, ...args] = process.argv.slice(2);
const at = args.indexOf("--");
const alias = args[at + 1];
const command = args[at + 2] || "";
const fail = (said, code = 255) => { process.stderr.write(said); process.exit(code); };
if (alias === "slowbox") setInterval(() => {}, 1000);
else {
if (alias === "newbox" && !existsSync(join(dir, "met"))) fail("No ED25519 host key is known for newbox and you have requested strict checking.\r\nHost key verification failed.\r\n");
if (alias === "pwbox") fail("me@pwbox: Permission denied (publickey,password).\r\n");
if (alias === "forcedbox") { process.stdout.write("This service allows sftp connections only.\n"); process.exit(0); }
if (alias === "zshbox") {
  let input = "";
  process.stdin.on("data", (d) => (input += d));
  process.stdin.on("end", () => fail("zsh: command not found: " + input.trim() + "\n", 127));
} else {
const ps = /^powershell -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(command);
const sh = /^sh -c 's=\$\(printf %s ([A-Za-z0-9+/=]+) \| \{ base64 -d 2>\/dev\/null \|\| base64 -D; \}\) && eval "\$s"'$/.exec(command);
if (!ps && !sh) fail("not a command line of the desk's: " + command + "\n", 127);
if (sh && alias === "winbox") fail("'sh' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n", 1);
let script = ps ? Buffer.from(ps[1], "base64").toString("utf16le") : Buffer.from(sh[1], "base64").toString("utf8");
const head = ps ? "[Console]::Error.WriteLine('filament-ssh-exec-began')\n" : ${JSON.stringify(SH_HEAD)};
const tail = ps ? "" : ${JSON.stringify(SH_TAIL)};
const marked = script.startsWith(head) && script.endsWith(tail);
if (marked) {
  if (alias === "noisybox") process.stderr.write("a login banner with no newline");
  process.stderr.write(ps ? "filament-ssh-exec-began\r\n" : "filament-ssh-exec-began\n");
  script = script.slice(head.length, script.length - tail.length);
}
const done = (code) => { if (marked && !ps) process.stderr.write("filament-ssh-exec-ended " + code + "\n"); process.exit(code); };
const quit = (said, code) => { process.stderr.write(said); done(code); };
if (ps) {
  if (!script.includes('"os=Windows"')) quit("unknown script\n", 1);
  process.stdout.write("os=Windows\r\narch=AMD64\r\nbits=64\r\nhas=winget\r\n");
  done(0);
}
if (script.startsWith('echo "os=')) {
  process.stdout.write("os=Linux\narch=x86_64\nbits=64\nlibc=glibc 2.35\nldd=ldd (GNU libc) 2.35\nhome=/home/me\nhas=systemctl\nhas=curl\n");
  done(0);
}
if (script === "'uname' '-s'") { process.stdout.write("Linux\n"); done(0); }
if (script === "'cat'") { process.stdin.pipe(process.stdout); process.stdin.on("end", () => done(0)); }
else if (script === "'big'") { process.stdout.write("x" + "é".repeat((${OUTPUT_MAX} + 4097) / 2 | 0), () => done(0)); }
else if (script === "'hang'") setInterval(() => {}, 1000);
else if (script === "'fail'") quit("nope\n", 3);
else if (script === "'own255'") quit("it said 255 itself\n", 255);
else if (script === "'drop'") { process.stdout.write("half\n"); fail("client_loop: send disconnect: Broken pipe\r\n", 255); }
else if (script === "'linger'") {
  const held = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
  writeFileSync(join(dir, "linger.pid"), String(held.pid));
  process.stdout.write("done\n", () => done(0));
}
else fail("unknown command " + script + "\n", 127);
}
}
`;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-ssh-exec-"));
    fake = join(dir, "fake-ssh.cjs");
    writeFileSync(fake, FAKE);
  });
  after(() => {
    const pid = join(dir, "linger.pid");
    if (existsSync(pid))
      try {
        process.kill(Number(readFileSync(pid, "utf8")));
      } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  /** ssh, as the fake: the app's own arguments after its folder. */
  const spawn = (/** @type {string} */ _file, /** @type {string[]} */ args, /** @type {any} */ o) => {
    started.push(args);
    return spawnChild(process.execPath, [fake, dir, ...args], o);
  };

  test("a command there: its output and code come back; a secret goes on its standard input, never in its words", async () => {
    const r = await runSsh("me@box", { argv: ["uname", "-s"] }, { spawn });
    assert.deepEqual(r, { code: 0, stdout: "Linux\n", stderr: "", cut: false, why: null, ask: null, began: true });
    started.length = 0;
    const secret = "sk-ant-not-a-real-key-0123";
    const fed = await runSsh("box", { argv: ["cat"] }, { spawn, stdin: secret });
    assert.equal(fed.stdout, secret, "the command read it");
    assert.equal(JSON.stringify(started).includes(secret), false, "never among ssh's arguments");
    const failed = await runSsh("box", { argv: ["fail"] }, { spawn });
    assert.deepEqual([failed.code, failed.stderr, failed.why], [3, "nope\n", null], "a command that failed there says why on its own");
    const noisy = await runSsh("noisybox", { argv: ["uname", "-s"] }, { spawn });
    assert.deepEqual([noisy.began, noisy.stderr], [true, "a login banner with no newline"], "what the login printed first is the stderr's, its mark taken out");
  });

  test("a code of 255 the command gave is its own: no ssh failure said, no terminal, not run again", async () => {
    let runs = 0;
    let opened = 0;
    const counted = (/** @type {string} */ f, /** @type {string[]} */ a, /** @type {any} */ o) => (runs++, spawn(f, a, o));
    const r = await runSsh("box", { argv: ["own255"] }, { spawn: counted, interactive: async () => (opened++, 0) });
    assert.deepEqual([r.code, r.began, r.why, r.ask, r.stderr, runs, opened], [255, true, null, null, "it said 255 itself\n", 1, 0]);
  });

  test("a connection that dropped under the command is said as one, never as its code; not run again", async () => {
    let runs = 0;
    let opened = 0;
    const counted = (/** @type {string} */ f, /** @type {string[]} */ a, /** @type {any} */ o) => (runs++, spawn(f, a, o));
    const r = await runSsh("box", { argv: ["drop"] }, { spawn: counted, interactive: async () => (opened++, 0) });
    assert.deepEqual([r.code, r.began, r.ask, r.stdout, runs, opened], [255, true, null, "half\n", 1, 0]);
    assert.equal(r.why, "the connection to box ended while the command ran there (client_loop: send disconnect: Broken pipe): it may still be running there.");
  });

  test("a shell there that did not start the command says so: a Windows host's cmd has no sh; something run in its place is no success, and what it echoed of the input is taken out", async () => {
    const r = await runSsh("winbox", { argv: ["uname", "-s"] }, { spawn });
    assert.deepEqual([r.code, r.began, r.ask], [1, false, null]);
    assert.equal(r.why, "winbox did not start the command: 'sh' is not recognized as an internal or external command, operable program or batch file.");
    const forced = await runSsh("forcedbox", { argv: ["uname", "-s"] }, { spawn });
    assert.deepEqual([forced.code, forced.began], [0, false]);
    assert.equal(forced.why, "forcedbox ran something else in the command's place: a command its SSH server or your key forces (ForceCommand, command= in authorized_keys), or a login that starts another shell.");
    const secret = "sk-ant-not-a-real-key-4567";
    const echoed = await runSsh("zshbox", { argv: ["filament", "keys", "add", "anthropic", "--key-stdin"] }, { spawn, stdin: secret });
    assert.deepEqual([echoed.code, echoed.began, echoed.stderr, JSON.stringify(echoed).includes(secret)], [127, false, "zsh: command not found: [its input]\n", false]);
    assert.equal(echoed.why, "zshbox did not start the command: zsh: command not found: [its input]");
    await assert.rejects(runSsh("box", { argv: [] }, { spawn }), /needs its words/, "a command line that cannot be made is the caller's error, no ssh failure");
  });

  test("its output is kept to a bound, no character split; a run past its time is let go of, said as it stands there", async () => {
    const big = await runSsh("box", { argv: ["big"] }, { spawn });
    assert.deepEqual([big.code, big.cut, big.stdout.length, /\uFFFD/.test(big.stdout)], [0, true, OUTPUT_MAX / 2, false]);
    // Time enough for a new process to start and say it began, under a loaded suite too.
    const hung = await runSsh("box", { argv: ["hang"] }, { spawn, timeoutMs: 3_000 });
    assert.deepEqual([hung.code, hung.timedOut, hung.began, hung.why], [null, true, true, "ssh to box was ended after 3 s: the command there did not end by then, and may still be running there."]);
    const slow = await runSsh("slowbox", { argv: ["uname", "-s"] }, { spawn, timeoutMs: 400 });
    assert.deepEqual([slow.code, slow.began, slow.why], [null, false, "ssh to slowbox did not reach the command in 400 ms, and was ended."]);
  });

  test("ssh ended, a process that holds its streams open does not hold the run", async () => {
    // A real one (on Windows its pipes are not held, and it closes at once).
    const t0 = Date.now();
    const r = await runSsh("box", { argv: ["linger"] }, { spawn, timeoutMs: 30_000 });
    assert.deepEqual([r.code, r.stdout, r.timedOut], [0, "done\n", undefined]);
    assert.ok(Date.now() - t0 < KILL_GRACE_MS + 5_000, `it ended in ${Date.now() - t0} ms`);
    // One whose streams never close, on every system: it exited, or it was ended past its time and never closed.
    /** @param {boolean} exits */
    const held = (exits) => {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
      setTimeout(() => {
        child.stderr.write(`${BEGAN}\n`);
        child.stdout.write("done\n");
        if (exits) setTimeout(() => child.emit("exit", 0, null), 20);
      }, 10);
      return child;
    };
    /** @type {any[]} */
    const kids = [];
    // The run's own timers keep no process alive: this one does, while it waits.
    const alive = setInterval(() => {}, 1000);
    try {
      const exited = await runSsh("box", { argv: ["linger"] }, { spawn: () => (kids.push(held(true)), kids.at(-1)), timeoutMs: 30_000 });
      assert.deepEqual([exited.code, exited.stdout, exited.why, kids[0].stdout.destroyed], [0, "done\n", null, true]);
      const stuck = await runSsh("box", { argv: ["hang"] }, { spawn: () => (kids.push(held(false)), kids.at(-1)), timeoutMs: 200 });
      assert.deepEqual([stuck.code, stuck.timedOut, stuck.stdout, kids[1].stderr.destroyed], [null, true, "done\n", true]);
    } finally {
      clearInterval(alive);
    }
  });

  test("an unknown host key is the person's, in a terminal: the command runs once they accepted it there, never before; refused there, it stays refused", async () => {
    // No terminal: said, nothing accepted.
    const bare = await runSsh("newbox", { argv: ["uname", "-s"] }, { spawn });
    assert.deepEqual([bare.code, bare.ask, bare.began], [255, "host-key", false]);
    assert.match(String(bare.why), /^ssh does not know newbox's host key yet/);
    // The terminal the person meets it in: ssh asking, its fingerprint shown; they accept, it ends 0.
    /** @type {any[]} */
    const asked = [];
    const met = await runSsh("newbox", { argv: ["uname", "-s"] }, {
      spawn,
      cli: () => "ssh",
      interactive: async (t) => {
        asked.push(t);
        writeFileSync(join(dir, "met"), "");
        return 0;
      },
    });
    assert.deepEqual([met.code, met.stdout], [0, "Linux\n"]);
    assert.equal(asked.length, 1);
    assert.deepEqual([asked[0].file, asked[0].args, asked[0].ask, asked[0].line], ["ssh", ["-t", "-o", "StrictHostKeyChecking=ask", ...OWN, "--", "newbox", "exit"], "host-key", "ssh -t newbox exit"]);
    assert.match(asked[0].why, /host key yet/);
    rmSync(join(dir, "met"));
    // Refused in the terminal (it ended otherwise): the refusal stands, the command not run again.
    let runs = 0;
    const counted = (/** @type {string} */ f, /** @type {string[]} */ a, /** @type {any} */ o) => (runs++, spawn(f, a, o));
    const no = await runSsh("newbox", { argv: ["uname", "-s"] }, { spawn: counted, interactive: async () => 1 });
    assert.deepEqual([no.ask, runs], ["host-key", 1]);
  });

  test("a password or a code the machine asks for is said, for a terminal or a key; a bad alias and no ssh are said before anything runs", async () => {
    let opened = 0;
    const pw = await runSsh("pwbox", { argv: ["uname", "-s"] }, { spawn, interactive: async () => (opened++, 0) });
    assert.deepEqual([pw.ask, opened], ["sign-in", 0], "the step itself is the caller's to run in a terminal");
    started.length = 0;
    const bad = await runSsh("-oProxyCommand=calc", { argv: ["uname"] }, { spawn });
    assert.deepEqual([bad.code, started.length], [null, 0]);
    assert.match(String(bad.why), /is no SSH host/);
    const none = await runSsh("box", { argv: ["uname", "-s"] }, { spawn: (_f, a, o) => spawnChild(join(dir, "no-such-ssh"), a, o) });
    assert.match(String(none.why), /^This computer has no ssh/);
  });

  test("what a machine is: read by sh; a Windows host's shell, which has none, by PowerShell; one not reached, by neither", async () => {
    const linux = await probeSsh("box", { spawn });
    assert.equal(linux.ok, true);
    assert.deepEqual(linux.ok && [linux.platform.target, linux.platform.has, linux.platform.shell], ["linux-x64", ["systemctl", "curl"], "sh"]);
    const win = await probeSsh("winbox", { spawn });
    assert.deepEqual(win.ok && [win.platform.os, win.platform.arch, win.platform.shell, win.platform.target], ["Windows", "AMD64", "powershell", null]);
    assert.match(String(win.ok && win.platform.refusal), /this machine is Windows on AMD64/);
    started.length = 0;
    const refused = await probeSsh("pwbox", { spawn });
    assert.deepEqual([refused.ok ? null : refused.run.ask, started.length], ["sign-in", 1], "ssh's own failure: no PowerShell asked after it");
  });
});
