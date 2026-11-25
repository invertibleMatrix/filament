// @ts-check
// Commands on another machine over SSH, from the desk (s3a): what sets a machine up and keeps it up to date runs there
// as `ssh <alias> <command>` — a batch run, its output read back whole, its code said. The alias is the one an
// ssh:// address names (ssh-route.js `aliasOf`), after `--`; ssh runs in batch mode, its own process, never a master
// your SSH config shares, none of that config's forwards, remote command or agent forwarding, and it checks host keys
// strictly whatever that config says: a key it does not know is never taken silently. What a person must answer — a
// host key to check, a password, a code, sudo — is theirs, in a terminal: `sshTerminal` is that run as a program for
// one (`ssh -t`, ssh asking the host key with its fingerprint shown), and `runSsh` hands it to its caller's
// `interactive` where ssh did not know the host key, then runs the command again. A command reaches the shell there as
// one line every login shell reads alike (sh, bash, zsh, fish, csh): its script encoded, decoded and run by sh there —
// on a Windows host, by its PowerShell — (`commandOf`), saying on its stderr that it began (`BEGAN`) and, ended, its
// code (`ENDED`), each mark the run's own
// (a nonce no login banner or profile there knows) — so ssh's own 255, before
// the command began or as the connection dropped under it, is never read as the command's, and something run in its
// place (a forced command, a login that starts another shell) never as its success. A secret goes to the command on its
// standard input alone, never in its words, which a process list shows; each stream's output is kept to `OUTPUT_MAX`,
// and a run that does not end in `timeoutMs` is let go of — its command there may run on, and is said to. `probeSsh`
// reads what the machine is — its system, processor, C library, word size and the tools setup needs — as
// scripts/install.sh checks it, by sh, else (a Windows host, whose OpenSSH starts cmd or PowerShell) by PowerShell, as
// scripts/install.ps1 does; `runEither` runs a command on a machine whose shell is not known, by sh, else by PowerShell.
// Plain Node; `spawn` and `cli` are seams for its test.
import { spawn as spawnChild } from "node:child_process";
import { randomBytes } from "node:crypto";
import { aliasOf, sshCli, sshWords } from "./ssh-route.js";

/** How long a run is given by default, ssh's sign-in included. */
export const RUN_MS = 60_000;
/** How long a run ended past its time is given to close before it is let go of all the same. */
export const KILL_GRACE_MS = 2_000;
/** The most of each stream a run keeps. */
export const OUTPUT_MAX = 1 << 20;
/** The oldest glibc Filament's server build runs on (Node's own Linux builds). */
export const GLIBC_MIN = "2.28";
/** What a command says on its stderr as it begins there, its run's mark after it: before it, a failure is ssh's. */
export const BEGAN = "filament-ssh-exec-began";
/** What a command for sh says on its stderr as it ends there, its run's mark and its code after it: a run with none was cut under it. */
export const ENDED = "filament-ssh-exec-ended";
/** The most a command for sh there is, encoded: a Windows desk starts ssh with 32,767 characters at most. */
export const SCRIPT_MAX = 30 * 1024;
/** The most a command line for PowerShell is: a Windows host's cmd, which starts it, reads 8,191 characters at most. */
export const PS_LINE_MAX = 8_000;

/**
 * The options every ssh run here takes: a process of its own, none of your SSH config's forwards, remote command,
 * agent or X11 forwarding, errors said whatever log level that config sets.
 */
const OWN = ["-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "ClearAllForwardings=yes", "-o", "RemoteCommand=none", "-o", "ForwardAgent=no", "-o", "ForwardX11=no"];

/**
 * ssh's arguments for a batch run: no terminal, batch mode, host keys checked strictly, its own options (`OWN`), the
 * alias after `--`, where no word is an option, then the command there.
 * @param {string} alias @param {string} command
 */
export const batchArgs = (alias, command) => [
  "-T",
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=yes",
  "-o", "LogLevel=ERROR",
  ...OWN,
  "-o", "ConnectTimeout=10",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=3",
  "--",
  alias,
  command,
];

/** A word for a POSIX shell, whole: in single quotes, a quote in it closed, escaped and opened again. @param {string} s */
export const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
/**
 * A word for PowerShell, whole: in single quotes, each quote in it doubled — the curly ones too, which PowerShell reads
 * as quotes as well. @param {string} s
 */
export const psQuote = (s) => `'${String(s).replace(/['‘’‚‛]/g, "$&$&")}'`;

/**
 * @typedef {{ argv: string[] } | { script: string, shell?: "sh" | "powershell" }} RunWhat  a command there, for a machine
 *   with sh (a POSIX host): its words, or a script for sh; or, for a Windows host, a script for PowerShell
 */

/**
 * What a marked run's script for PowerShell runs around it: its words in UTF-8, no progress drawn, an error stops it
 * and is said in its own words; its end said with its code (`ENDED`) — `exit` where the script ended PowerShell
 * itself, whose exit code is then the run's (an `exit` in it leaves no code to read). @param {string} mark @param {string} script
 */
const psMarked = (mark, script) =>
  [
    `[Console]::Error.WriteLine('${BEGAN}-${mark}')`,
    "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop'",
    "try{[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false}catch{}",
    "$global:LASTEXITCODE=0;$filamentRan=0",
    "try{& {",
    script,
    `};$filamentRan=1}catch{$filamentRan=2;[Console]::Error.WriteLine($_.Exception.Message)}finally{[Console]::Error.WriteLine('${ENDED}-${mark} '+$(if($filamentRan-eq 2){1}elseif($filamentRan){[int]$global:LASTEXITCODE}else{'exit'}))}`,
    "exit $(if($filamentRan-eq 2){1}else{[int]$global:LASTEXITCODE})",
  ].join("\n");

/**
 * What a run asks the shell there to run, as one line every login shell reads alike: for sh, its script — its words,
 * each quoted for sh, or the script given — in base64, decoded and run by sh there, its standard input left to the
 * command; for PowerShell, encoded as Windows' own PowerShell takes one (`-EncodedCommand`), which no shell there reads
 * into. `marked`: it says first on its stderr that it began (`BEGAN`) and last that it ended, with its code (`ENDED`),
 * each with `mark` after it — the run's own, inside the encoded script, so nothing printed there before it ran (a login
 * banner, a profile) says it —, the command run in a shell of its own (for PowerShell, a script block of its own:
 * `psMarked`), whose `exit` ends it alone.
 * @param {RunWhat} what @param {{ marked?: boolean, mark?: string }} [o]
 */
export function commandOf(what, { marked = false, mark = "" } = {}) {
  if ("script" in what && what.shell === "powershell") {
    const ps = marked ? psMarked(mark, String(what.script)) : String(what.script);
    const line = `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(ps, "utf16le").toString("base64")}`;
    if (line.length > PS_LINE_MAX) throw new Error(`a command line for PowerShell there is kept to ${PS_LINE_MAX} characters encoded`);
    return line;
  }
  if ("argv" in what && (!Array.isArray(what.argv) || !what.argv.length)) throw new Error("a command there needs its words");
  const body = "argv" in what ? what.argv.map((w) => shQuote(String(w))).join(" ") : String(what.script);
  const script = marked ? `printf '%s\\n' ${BEGAN}-${mark} >&2\n(\n${body}\n)\nc=$?\nprintf '%s %s\\n' ${ENDED}-${mark} "$c" >&2\nexit "$c"` : body;
  const sh = Buffer.from(script, "utf8").toString("base64");
  if (sh.length > SCRIPT_MAX) throw new Error(`a command there is kept to ${SCRIPT_MAX / 1024} KiB encoded: send what is longer on its standard input`);
  // Not decoded, it is not run: sh ends with base64's code. A macOS from before 13 decodes with -D alone.
  return `sh -c 's=$(printf %s ${sh} | { base64 -d 2>/dev/null || base64 -D; }) && eval "$s"'`;
}

/**
 * @typedef {"host-key" | "sign-in"} SshAsk  what only the person can answer: a host key ssh does not know, a password or
 *   a code the machine asks for
 * @typedef {{ code: number | null, stdout: string, stderr: string, cut: boolean, why: string | null, ask: SshAsk | null,
 *   began: boolean, timedOut?: boolean }} SshRun
 *   `code`: the command's exit code there, as it said it ended (`ENDED`), else ssh's — 255 where ssh failed —, null
 *   where the run was let go of or never started; `began`: the command began there; `why`: ssh's failure, the shell
 *   there that did not start the command or ran another in its place, the connection that dropped under it, or a run
 *   let go of, in words, else null (a command that failed there says why on its own stderr); `ask`: what a person must
 *   answer in a terminal for it to run; `cut`: a stream gave more than `OUTPUT_MAX`
 * @typedef {{ file: string, args: string[], line: string | null }} SshTerminal  ssh as a terminal's program, and the
 *   line a person types for it in a POSIX shell of their own — none for a script
 */

/**
 * Why a batch run did not reach the command, in words, and what a person must answer for it (`ask`): a host key ssh
 * does not know — never one that changed or was revoked, which are refused —, or a password or a code the machine
 * asks for.
 * @param {string} said  ssh's stderr @param {string} alias @returns {{ why: string, ask: SshAsk | null }}
 */
export function execWords(said, alias) {
  const s = String(said || "");
  if (/REVOKED/.test(s)) return { why: `${alias}'s host key is marked revoked in your known_hosts: nothing was sent.`, ask: null };
  if (/host key verification failed|no .* host key is known/i.test(s) && !/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(s))
    return { why: `ssh does not know ${alias}'s host key yet: check the fingerprint it shows in the terminal and accept it there, or connect once from a terminal yourself (ssh ${alias}).`, ask: "host-key" };
  const denied = /permission denied \(([^)]*)\)/i.exec(s);
  if (denied && /password|keyboard-interactive/i.test(denied[1]))
    return { why: `${alias} asks for a password or a code, which a command from the desk cannot type: add a key it accepts (ssh-copy-id ${alias}), or run this step in a terminal, where you answer it.`, ask: "sign-in" };
  const words = sshWords(s, alias, 0);
  if (!words.startsWith(`ssh to ${alias} ended`) && !/^Port 0 /.test(words)) return { why: words, ask: null };
  const first = s.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return { why: first ? `ssh to ${alias} ended: ${first.slice(0, 200)}` : `ssh to ${alias} ended before the command ran.`, ask: null };
}

/** A word with nothing in it a POSIX shell reads, nor zsh (`=word`). @param {string} w */
const plain = (w) => /^[\w@%+:,./-][\w@%+=:,./-]*$/.test(w);

/**
 * ssh as a terminal's program, for what a person answers: a terminal there (`-t`), the host key asked with its
 * fingerprint shown whatever your SSH config says — never taken unasked —, its own options (`OWN`); the command after
 * the alias, else `exit`: the host key met, nothing run. `line`: what a person types for it in a POSIX shell of their
 * own — words as they read, `exit` for the host key; none for a script.
 * @param {string} alias @param {RunWhat | null} what @param {{ cli?: () => string }} [o]
 * @returns {SshTerminal}
 */
export function sshTerminal(alias, what, { cli = () => sshCli() } = {}) {
  const a = aliasOf(alias);
  if (!a) throw new Error(`"${String(alias).slice(0, 80)}" is no SSH host`);
  const words = what && "argv" in what ? what.argv.map(String) : null;
  return {
    file: cli(),
    args: ["-t", "-o", "StrictHostKeyChecking=ask", ...OWN, "--", a, what ? commandOf(what) : "exit"],
    // ssh joins its words for the shell there, which reads them again: plain words read alike in both, others are
    // quoted for each.
    line: !what ? `ssh -t ${a} exit` : !words ? null : words.every(plain) ? `ssh -t ${a} ${words.join(" ")}` : `ssh -t ${a} ${shQuote(words.map(shQuote).join(" "))}`,
  };
}

/** A stream's bytes as words; one cut at the bound loses the character it split. @param {Buffer[]} parts @param {boolean} cut */
const textOf = (parts, cut) => {
  const s = Buffer.concat(parts).toString("utf8");
  return cut ? s.replace(/\uFFFD+$/, "") : s;
};
/**
 * A run's marks as its stderr says them (`commandOf`): `BEGAN`'s line, wherever what the login there printed first with
 * no newline put it; `ENDED`'s and the code in it — a Windows one may be below zero, or `exit` (`psMarked`) —, after
 * whatever the command said last. Each holds the run's own mark, so a line no run of this one said — a banner's, a
 * profile's, an echo of another run's — is none of them.
 * @param {string} mark
 */
const marksOf = (mark) => ({
  began: new RegExp(`${BEGAN}-${mark}\\r?\\n`),
  ended: new RegExp(`${ENDED}-${mark} (-?\\d+|exit)\\r?\\n`),
  /** Every one of its lines, taken out of the words: a trace there (set -x) says them twice. */
  all: new RegExp(`(?:${BEGAN}-${mark}|${ENDED}-${mark} (?:-?\\d+|exit))\\r?\\n`, "g"),
});
/** XML's own escapes, and PowerShell's for a character (`_x000D_`), read back. @param {string} s */
const xmlText = (s) =>
  s
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[/** @type {"lt"} */ (e)]);
/**
 * What Windows PowerShell said on its stderr as words: run with `-EncodedCommand`, it says its errors as CLIXML
 * (`#< CLIXML` and an `<Objs>` of them), read back here to their lines — where the error came from in the script
 * (`At line:`, `+ ...`) left out —, and its other records (progress) dropped. @param {string} s
 */
export const clixmlWords = (s) =>
  String(s).replace(/#< CLIXML\r?\n(<Objs\b[\s\S]*?<\/Objs>)?/g, (_, objs) =>
    [...String(objs || "").matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)]
      .map((m) => xmlText(m[1]))
      .join("")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !/^At line:\d+/.test(l) && !/^\s*\+ /.test(l))
      .map((l) => `${l.replace(/^\s+:\s+/, "").trimEnd()}\n`)
      .join(""),
  );
/** A stream's last lines in a line, for words: what failed is said last. @param {string} s */
const lastSaid = (s) => {
  const said = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" ");
  return said.length > 200 ? `…${said.slice(-199)}` : said;
};
/**
 * What a shell there that ran something else in the command's place may have echoed of its input, taken out: a line of
 * it, a secret, is never in a run's words. @param {string} s @param {string} input
 */
const unsaid = (s, input) =>
  String(input)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 6)
    .reduce((t, l) => t.split(l).join("[its input]"), s);

/**
 * One batch run: the command there, `stdin` written to it and closed, its streams kept to `OUTPUT_MAX`, let go of past
 * `timeoutMs` — ssh ended, then, a moment later (`KILL_GRACE_MS`), whether or not it closed —; ssh ended, its streams
 * are given that moment to close (a proxy command of your SSH config may hold them). A command line that cannot be
 * made (no words, too long) throws. @param {string} alias checked already @param {RunWhat} what @param {RunOptions} o
 * @returns {Promise<SshRun>}
 */
function once(alias, what, { stdin = "", timeoutMs = RUN_MS, spawn = spawnChild, cli = () => sshCli() }) {
  const mark = randomBytes(8).toString("hex");
  const marks = marksOf(mark);
  const line = commandOf(what, { marked: true, mark });
  const ps = "script" in what && what.shell === "powershell";
  return new Promise((resolve) => {
    /** @type {any} */
    let child;
    try {
      child = spawn(cli(), batchArgs(alias, line), { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (/** @type {any} */ e) {
      const { why, ask } = execWords(`${e?.code || ""} ${e?.message || e}`, alias);
      return resolve({ code: null, stdout: "", stderr: "", cut: false, why, ask, began: false });
    }
    /** @type {Buffer[]} */
    const out = [];
    /** @type {Buffer[]} */
    const err = [];
    // stderr's last bytes, past the bound too: where `ENDED` is.
    let errTail = Buffer.alloc(0);
    const size = { out: 0, err: 0 };
    const cut = { out: false, err: false };
    let done = false;
    let exited = false;
    let timedOut = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let grace = null;
    /** @param {Buffer[]} into @param {"out" | "err"} k @param {Buffer} d */
    const keep = (into, k, d) => {
      const room = OUTPUT_MAX - size[k];
      if (room <= 0) return void (cut[k] = true);
      const part = d.length > room ? d.subarray(0, room) : d;
      if (part.length < d.length) cut[k] = true;
      into.push(part);
      size[k] += part.length;
    };
    child.stdout?.on("data", (/** @type {Buffer} */ d) => keep(out, "out", Buffer.from(d)));
    child.stderr?.on("data", (/** @type {Buffer} */ d) => {
      keep(err, "err", Buffer.from(d));
      errTail = Buffer.concat([errTail, Buffer.from(d)]).subarray(-256);
    });
    // A command that reads no input closes it: what is written then is let go of, not an error of the run.
    child.stdin?.on("error", () => {});
    child.stdin?.end(stdin ? String(stdin) : undefined);
    const secs = timeoutMs < 1000 ? `${timeoutMs} ms` : `${Math.round(timeoutMs / 1000)} s`;
    /** @param {number | null} code */
    const soon = (code) => {
      if (grace) return;
      grace = setTimeout(() => end(code), KILL_GRACE_MS);
      grace.unref?.();
    };
    const timer = setTimeout(() => {
      // ssh exited as the time ran out: it is not ended, and its close comes (or the grace after its exit ends it).
      if (exited) return;
      timedOut = true;
      try {
        child.kill();
      } catch {}
      soon(null);
    }, timeoutMs);
    timer.unref?.();
    /** @param {number | null} code @param {string} [failed]  why it did not start */
    const end = (code, failed) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      // Let go of what another process there may hold open still.
      child.stdout?.destroy?.();
      child.stderr?.destroy?.();
      const raw = textOf(err, cut.err);
      const began = marks.began.test(raw);
      const ended = marks.ended.exec(raw) || marks.ended.exec(errTail.toString("utf8"));
      let stdout = textOf(out, cut.out);
      let stderr = raw.replace(marks.all, "");
      if (ps) stderr = clixmlWords(stderr);
      if (!began && stdin) {
        stdout = unsaid(stdout, stdin);
        stderr = unsaid(stderr, stdin);
      }
      const base = { stdout, stderr, cut: cut.out || cut.err, began };
      if (failed != null) return resolve({ code: null, ...base, ...execWords(failed, alias) });
      // The command's own code, whatever ssh's: the connection may drop once it said it, and the time run out as ssh
      // was ending — it ended there. One that ended PowerShell by its `exit` says its code by PowerShell's: ssh's.
      if (ended && ended[1] !== "exit") return resolve({ code: Number(ended[1]), ...base, why: null, ask: null });
      if (ended)
        return resolve(
          code === null
            ? { code, ...base, why: `the command on ${alias} ended, and ssh was ended before it said its code.`, ask: null }
            : { code, ...base, why: null, ask: null },
        );
      if (timedOut)
        return resolve({
          code: null,
          ...base,
          why: began
            ? `ssh to ${alias} was ended after ${secs}: the command there did not end by then, and may still be running there.`
            : `ssh to ${alias} did not reach the command in ${secs}, and was ended.`,
          ask: null,
          timedOut: true,
        });
      if (code === null) return resolve({ code, ...base, why: `ssh to ${alias} was stopped before it ended.`, ask: null });
      if (!began) {
        if (code === 255) return resolve({ code, ...base, ...execWords(stderr, alias) });
        const said = lastSaid(stderr);
        // Something ran in its place and ended well: a command its SSH server or your key forces, a login that starts
        // another shell.
        if (code === 0)
          return resolve({ code, ...base, why: `${alias} ran something else in the command's place${said ? ` (${said})` : ""}: a command its SSH server or your key forces (ForceCommand, command= in authorized_keys), or a login that starts another shell.`, ask: null });
        // No sh to run it (a Windows host's cmd), no base64 to read it with.
        return resolve({ code, ...base, why: `${alias} did not start the command${said ? `: ${said}` : "."}`, ask: null });
      }
      // It began and said no end: ssh's own 255 as the connection dropped under it, ended by a signal there.
      if (code !== 0) {
        const said = lastSaid(stderr.split(/\r?\n/).slice(-3).join("\n"));
        return resolve({ code, ...base, why: `the connection to ${alias} ended while the command ran there${said ? ` (${said})` : ""}: it may still be running there.`, ask: null });
      }
      resolve({ code, ...base, why: null, ask: null });
    };
    child.once("error", (/** @type {any} */ e) => end(null, `${e?.code || ""} ${e?.message || e}`));
    child.once("exit", (/** @type {number | null} */ code) => {
      exited = true;
      soon(code);
    });
    child.once("close", (/** @type {number | null} */ code) => end(code));
  });
}

/**
 * @typedef {{ stdin?: string, timeoutMs?: number, spawn?: (file: string, args: string[], o: object) => any, cli?: () => string,
 *   interactive?: ((t: SshTerminal & { ask: SshAsk, why: string }) => Promise<number | null>) | null }} RunOptions
 *   `stdin`: what the command reads — a secret goes here alone; `interactive`: a terminal for what only the person can
 *   answer, running `sshTerminal`'s program — resolved with its exit code once it ends
 */

/**
 * A command on the machine at `alias`, over SSH, in batch mode. Where ssh did not know the host key and the caller has a
 * terminal (`interactive`), the person meets it there — ssh shows its fingerprint and asks —, and the command runs
 * again once that terminal ends well; a password or a code the machine asks for is said (`ask: "sign-in"`), for the
 * caller to run the step in a terminal (`sshTerminal`) or the person to add a key.
 * @param {string} alias @param {RunWhat} what @param {RunOptions} [o] @returns {Promise<SshRun>}
 */
export async function runSsh(alias, what, o = {}) {
  const a = aliasOf(alias);
  if (!a) return { code: null, stdout: "", stderr: "", cut: false, why: `"${String(alias).slice(0, 80)}" is no SSH host: a Host of your SSH config, or user@host.`, ask: null, began: false };
  const r = await once(a, what, o);
  if (r.ask !== "host-key" || !o.interactive) return r;
  const met = await o.interactive({ ...sshTerminal(a, null, o.cli ? { cli: o.cli } : {}), ask: "host-key", why: /** @type {string} */ (r.why) });
  return met === 0 ? once(a, what, o) : r;
}

/**
 * Whether a run that did not begin failed in ssh itself — as ssh says in words of its own (a host key, a sign-in, a
 * refusal, no such host) —, so another shell's command would fail alike: a Windows host's cmd, which reads no single
 * quotes, ends sh's command line by its own failure with ssh's 255 too. @param {SshRun} r @param {string} alias
 */
const sshFailed = (r, alias) => r.code === null || !!r.ask || (r.code === 255 && !r.began && !execWords(r.stderr, aliasOf(alias) || alias).why.startsWith(`ssh to ${aliasOf(alias) || alias} ended`));

/**
 * A command on a machine whose shell is not known here: its script for sh, else — a shell there that did not start it
 * (a Windows host's cmd or PowerShell), or a sh there that found no such command (127: a Windows host's Git sh, where
 * Filament is no command of its own) — its script for PowerShell. → the PowerShell run where it began, else sh's.
 * @param {string} alias @param {{ sh: string, powershell: string }} scripts @param {RunOptions} [o] @param {typeof runSsh} [run]  a seam
 * @returns {Promise<SshRun>}
 */
export async function runEither(alias, scripts, o = {}, run = runSsh) {
  const r = await run(alias, { script: scripts.sh }, o);
  if (sshFailed(r, alias) || r.code === 0 || (r.began && r.code !== 127)) return r;
  const ps = await run(alias, { script: scripts.powershell, shell: "powershell" }, { ...o, interactive: null });
  return ps.began ? ps : r;
}

/**
 * @typedef {{ os: string, arch: string, bits: number | null, libc: string | null, has: string[], shell: "sh" | "powershell",
 *   filament: string | null, target: string | null, refusal: string | null, missing: string[], needs: string | null }} Platform
 *   `libc`: glibc's version, null where the C library is another; `has`: of the tools setup needs, those there;
 *   `filament`: the version of Filament its install.sh put there, else null; `target`: Filament's server build for it
 *   (linux-x64, linux-arm64), else null and `refusal` says why, as install.sh would; `missing`: what install.sh needs
 *   that is not there (a package manager adds it), and `needs` says so, as install.sh would
 */

/** The tools install.sh and setup look for, by name: each there is said `has=<name>`. */
const TOOLS = ["systemctl", "loginctl", "tailscale", "sudo", "curl", "wget", "tar", "gzip", "sha512sum", "openssl", "base64", "od", "mktemp", "readlink", "ln"];

/** sh's look at the machine, a `key=value` a line. */
export const PROBE_SH = [
  'echo "os=$(uname -s 2>/dev/null)"',
  'echo "arch=$(uname -m 2>/dev/null)"',
  'echo "bits=$(getconf LONG_BIT 2>/dev/null </dev/null)"',
  'echo "libc=$(getconf GNU_LIBC_VERSION 2>/dev/null </dev/null)"',
  'echo "ldd=$(ldd --version 2>&1 </dev/null | head -n 1)"',
  'echo "home=${HOME:-}"',
  `for c in ${TOOLS.join(" ")}; do command -v "$c" >/dev/null 2>&1 && echo "has=$c"; done`,
  'f="$HOME/.local/bin/filament"; [ -x "$f" ] && echo "filament=$("$f" --version 2>/dev/null </dev/null | head -n 1)"',
  "true",
].join("\n");

/**
 * PowerShell's look at a Windows machine, in sh's words: its processor as the system's (a 32-bit PowerShell says its
 * own), the folder install.ps1 installs into, Windows' own tar.exe it unpacks with, and the version of Filament it put
 * there.
 */
export const PROBE_PS = [
  '"os=Windows"',
  '"arch=$(if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE })"',
  '"bits=" + $(if ([Environment]::Is64BitOperatingSystem) { 64 } else { 32 })',
  '"home=$env:LOCALAPPDATA"',
  "foreach ($c in 'tailscale','curl.exe','winget') { if (Get-Command $c -ErrorAction SilentlyContinue) { \"has=$($c -replace '\\.exe$','')\" } }",
  "if (Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32\\tar.exe')) { 'has=tar' }",
  "if ($env:LOCALAPPDATA) { $f = Join-Path $env:LOCALAPPDATA 'filament\\current\\bin\\filament.cmd'; if (Test-Path -LiteralPath $f) { \"filament=$(& $f --version)\" } }",
].join("\n");

/** A version as numbers, for comparing. @param {string} v */
const parts = (v) => String(v).split(".").map((n) => Number.parseInt(n, 10) || 0);
/** Whether version `a` is older than `b`. @param {string} a @param {string} b */
const older = (a, b) => {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};

/**
 * What a probe's lines say of the machine, and Filament's server build for it — or why it has none, as
 * scripts/install.sh refuses: Linux on x86_64 or arm64, 64-bit programs, glibc 2.28 or newer; as scripts/install.ps1
 * does: Windows on x64, read by PowerShell —, and what its installer needs there that is missing (`missing`, `needs`).
 * @param {string} said  the probe's output @param {"sh" | "powershell"} shell @returns {Platform}
 */
export function platformOf(said, shell) {
  /** @type {Record<string, string>} */
  const k = {};
  /** @type {string[]} */
  const has = [];
  for (const line of String(said || "").split(/\r?\n/)) {
    const m = /^(\w+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    if (m[1] === "has") has.push(m[2].trim());
    else if (!(m[1] in k)) k[m[1]] = m[2].trim();
  }
  // A Windows host whose sh is Git's, MSYS2's or Cygwin's says so in its own words.
  const os = /^(MINGW|MSYS|CYGWIN)/i.test(k.os || "") ? "Windows" : k.os || "unknown";
  const arch = k.arch || "unknown";
  const bits = Number(k.bits) || null;
  const glibc = /^glibc\s+([\d.]+)/i.exec(k.libc || "")?.[1] || (/GLIBC|GNU libc/i.test(k.ldd || "") ? /([\d.]+)\s*$/.exec(k.ldd || "")?.[1] : null) || null;
  const cpu = /^(x86_64|amd64)$/i.test(arch) ? "x64" : /^(aarch64|arm64)$/i.test(arch) ? "arm64" : null;
  const windows = os === "Windows";
  const refusal = windows
    ? cpu !== "x64"
      ? `Filament for Windows hosts is built for x64 (AMD64), and this machine is Windows on ${arch}.`
      : shell !== "powershell"
        ? "This Windows host runs commands in a sh of its own (Git's, MSYS2's or Cygwin's), and its PowerShell did not answer: Filament is set up on a Windows host by PowerShell."
        : null
    : os !== "Linux" || !cpu
      ? `Filament for servers is built for Linux on x86_64 and on arm64 (aarch64), and for Windows on x64: this machine is ${os} on ${arch}.`
      : bits === 32
        ? `Filament for servers runs 64-bit programs, and this machine's are 32-bit, on its ${arch} kernel: its system's 64-bit release runs it.`
        : !glibc
          ? "Filament for servers runs on glibc, and this machine's C library is another (Alpine's musl?): a Debian, Ubuntu, Fedora or RHEL server runs it."
          : older(glibc, GLIBC_MIN)
            ? `Filament for servers needs glibc ${GLIBC_MIN} or newer, and this machine has ${glibc}.`
            : null;
  const there = (/** @type {string} */ t) => has.includes(t);
  /** @type {string[]} */
  const missing = refusal
    ? []
    : windows
      ? there("tar")
        ? []
        : ["tar.exe"]
      : [
          ...(there("curl") || there("wget") ? [] : ["curl or wget"]),
          ...["tar", "gzip"].filter((t) => !there(t)),
          ...(there("sha512sum") || there("openssl") ? [] : ["sha512sum or openssl"]),
          ...["base64", "od", "mktemp", "readlink", "ln"].filter((t) => !there(t)),
        ];
  const needs = refusal
    ? null
    : windows
      ? missing.length
        ? "Filament's installer unpacks with Windows' own tar.exe, which this Windows does not have (Windows 10 1803 and Windows Server 2019 have it, and newer)."
        : !k.home
          ? "LOCALAPPDATA is not set there: Filament installs into the user's own folder, and there is none to install into."
          : null
      : missing.length
        ? `Filament's installer needs ${missing.join(", ")}, which this machine does not have: install them with its package manager.`
        : !k.home
          ? "HOME is not set there: Filament installs into the user's own folder, and there is none to install into."
          : null;
  const version = /(\d+\.\d+\.\d+[\w.-]*)/.exec(k.filament || "")?.[1] || null;
  return { os, arch, bits, libc: glibc, has, shell, filament: version, target: refusal ? null : windows ? "win32-x64" : `linux-${cpu}`, refusal, missing, needs };
}

/**
 * What the machine at `alias` is (`platformOf`): read by sh, else — a shell there that runs no sh, a Windows host's cmd
 * or PowerShell, in whatever language it says so — by Windows' own PowerShell. → its platform, or the run that could
 * not read it: the sh one, where PowerShell could not either.
 * @param {string} alias @param {RunOptions} [o]
 * @returns {Promise<{ ok: true, platform: Platform } | { ok: false, run: SshRun }>}
 */
export async function probeSsh(alias, o = {}) {
  const r = await runSsh(alias, { script: PROBE_SH }, { timeoutMs: 30_000, ...o });
  const bySh = r.began && r.code === 0 && /^os=/m.test(r.stdout) ? platformOf(r.stdout, "sh") : null;
  // A Windows host whose sh is Git's, MSYS2's or Cygwin's: Filament is set up there by its PowerShell.
  if (bySh && bySh.os !== "Windows") return { ok: true, platform: bySh };
  // Not reached, or let go of: PowerShell has nothing to add. A sh there that began and failed, or said no system — a
  // Windows host's sh that is no POSIX one —, or a shell that did not start it (a Windows host's cmd, with whatever
  // code), is asked again as a shell that runs none.
  if (!bySh && sshFailed(r, alias)) return { ok: false, run: r };
  const ps = await runSsh(alias, { script: PROBE_PS, shell: "powershell" }, { timeoutMs: 30_000, ...o, interactive: null });
  if (ps.began && ps.code === 0 && /^os=/m.test(ps.stdout)) return { ok: true, platform: platformOf(ps.stdout, "powershell") };
  if (bySh) return { ok: true, platform: bySh };
  // A sh there with no base64 to read the probe with: install.sh needs one too.
  if (/base64/.test(r.stderr) && /not found|no such file/i.test(r.stderr)) return { ok: false, run: { ...r, why: `${aliasOf(alias)} has no base64, which Filament's installer needs too: install coreutils with its package manager.` } };
  return { ok: false, run: r };
}
