// @ts-check
// The admin API's exec area (the remote-agents plan's c-exec): one shell command run on this machine for another
// machine's agent — its bash and bash_background there call it (c-tools) — or for this machine's person. It starts in a
// folder as a chat's command would (the folder rules, and for another machine's agents the fence of a chat they start:
// index.js `agentFolderRefusal`), in this machine's shell with the bash hand's environment (hands.js `safeEnv`), and is
// judged as a chat's bash would be with this machine's rules, in the mode it was sent with — the chat's that sent it —
// else this machine's own — Auto as Edit for another machine's agents, unless their device may run without asking or
// holds Full control —: refused, run, or held on an ask that the device that
// started it — or the person here — answers by a press. Its output streams back as it comes, redacted as this machine's
// privacy.redact says; a capped copy of it, head and tail, is kept for a while after. Each one is written to this
// machine's log: who, where, what, the verdict and how it ended — nothing of its output.
import { randomBytes } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { sendJson, sseHead } from "../../app/pipeline/respond.js";
import { guard } from "./guard.js";
import { agentsDevice, drives } from "../guards.js";
import { agentFolderRefusal } from "./remote.js";
import { SHELL, startCommand } from "../../adapters/tools/shell.js";
import { TIMED_OUT_CEILING_MS, safeEnv } from "../../adapters/tools/hands.js";
import { readOnlyCommand } from "../../adapters/tools/read-only-commands.js";
import { gate, permissionMode, ruled } from "../../app/agent/tools.js";
import { PERMISSION_MODES } from "../../app/agent/prompt.js";
import { describeRule, ruleFor, rulesFrom } from "../../app/agent/rules.js";
import { folderRefusalOf, folderVerdict, loopConfig, outsideRootsWords } from "../../app/agent/turn.js";
import { harnessGlobalLayer, resolveSettings } from "../../services/session-settings.js";
import { projectFolderOf } from "../../services/project-folder.js";
import { projectIdOf } from "../../core/project-id.js";
import { redactSecrets, redactorOf } from "../../core/redact.js";
import { durationWords, headChars } from "../../core/text.js";
import { fullControl, grantEnds, heldGrant } from "../../services/devices.js";
import { folderKeyOf, inFolder } from "../../services/copies.js";

/** How long a command runs when its caller names no timeout: the bash hand's two minutes. */
export const EXEC_TIMEOUT_MS = 120_000;
/** The longest a caller may name: an hour, as long as a command its timeout sent to the background may run (hands.js). */
export const EXEC_TIMEOUT_MAX_MS = TIMED_OUT_CEILING_MS;
/**
 * What of a command's output is kept, in characters: its first and its newest, together the bash hand's 50 KB. What
 * lies between is dropped from the copy, and the copy says how much and where (`cut`); the stream carries all of it.
 */
export const EXEC_KEPT_CHARS = 25 * 1024;
/** How many commands one caller — a device, this computer, the admin token — has here at once, running or asking. */
export const EXEC_LIVE_PER_CALLER = 8;
/** How many all callers together have here at once. */
export const EXEC_LIVE_IN_ALL = 32;
/** How many of one caller's ended commands are kept to be read, its newest: what a caller that hangs up at once leaves. */
export const EXEC_ENDED_PER_CALLER = 32;
/**
 * The longest command taken, in characters: above the 20,000 another machine's Filament sends at most (remote-commands.js
 * JUDGED_COMMAND_CHARS). Each is kept with its exec, ended ones too.
 */
export const EXEC_COMMAND_MAX_CHARS = 32 * 1024;
/** How long an ended command's copy is kept to be read: as long as a background shell's (hands.js). */
const ENDED_KEPT_MS = 5 * 60_000;
/**
 * How long a running command outlives its stream (the review of 11-11): a gap in the network closes the stream of a
 * caller that still wants it, so the command runs on this long for its caller to read it again by its id (GET
 * /exec/:id), each such read giving it this long again. Unread past it, it is stopped: nothing runs here for nobody.
 */
export const EXEC_GRACE_MS = 5 * 60_000;
/** How long its output gets to drain after the shell exits, while a process it started still holds the pipe (hands.js). */
const EXIT_DRAIN_MS = 1000;
/** How long a stop waits for the command's end before it answers: a Windows stop scans for what Git Bash forked (shell.js). */
const STOP_WAIT_MS = 20_000;
/** How often a stream that carries nothing says it is there: an ask can wait for minutes. */
const PING_MS = 15_000;
/**
 * How much of an unfinished line is held back while this machine redacts, as a background shell's read holds it
 * (hands.js BG_HOLD): a secret up to this long is whole in what is held before any of it goes out.
 */
const REDACT_HOLD = 4096;
/** What a line says where its rest past eight holds is held back (`redactedFlow`). */
const LINE_HELD = " [the rest of this line held back: past 32 KB, it may hold what privacy.redact hides]";
/** How much of a command a log line says. */
const LOGGED_COMMAND_CHARS = 300;
/**
 * The fields an exec takes: no stdin, no environment and no shell of the caller's. `mode`: the permission mode it is
 * judged in, the chat's that sent it (the owner's of 11-10), else this machine's.
 */
const EXEC_FIELDS = Object.freeze(["cwd", "command", "timeoutMs", "mode"]);
/** A permission's answers, as the asks route's: the press of Allow or of Deny — never its words. */
const PERMIT_OPTIONS = Object.freeze([
  { id: "allow", label: "Allow" },
  { id: "deny", label: "Deny" },
]);

/** @typedef {"stdout" | "stderr"} Stream */
/** @typedef {{ stream: Stream, text: string }} Piece */
/**
 * Why a command ended before it exited on its own: its timeout, a stop, a press of Deny (or a rule or the folder rules
 * that refused it after Allow), its device revoked or its grant switched off, its caller gone, or a shell that would not
 * start.
 * @typedef {"timeout" | "stopped" | "denied" | "revoked" | "closed" | "failed"} Ended
 */

/**
 * A command's output as kept: the first EXEC_KEPT_CHARS characters, then the newest EXEC_KEPT_CHARS, in the order the
 * two streams said them, and how many characters between them were dropped.
 */
const keptOutput = () => {
  /** @type {Piece[]} */
  const head = [];
  /** @type {Piece[]} */
  const tail = [];
  let headChars = 0;
  let tailChars = 0;
  let dropped = 0;
  /** @param {Piece[]} list @param {Stream} stream @param {string} text */
  const push = (list, stream, text) => {
    const last = list[list.length - 1];
    if (last?.stream === stream) last.text += text;
    else list.push({ stream, text });
  };
  return {
    /** @param {Stream} stream @param {string} text */
    add(stream, text) {
      if (headChars < EXEC_KEPT_CHARS) {
        const first = text.slice(0, EXEC_KEPT_CHARS - headChars);
        push(head, stream, first);
        headChars += first.length;
        text = text.slice(first.length);
      }
      if (!text) return;
      push(tail, stream, text);
      tailChars += text.length;
      while (tailChars > EXEC_KEPT_CHARS) {
        const over = tailChars - EXEC_KEPT_CHARS;
        const oldest = tail[0];
        const gone = Math.min(over, oldest.text.length);
        if (gone === oldest.text.length) tail.shift();
        else oldest.text = oldest.text.slice(gone);
        tailChars -= gone;
        dropped += gone;
      }
    },
    /** The copy: its pieces, and `cut` where some were dropped — how many characters, before which piece. */
    view: () => ({ output: [...head, ...tail].map((p) => ({ ...p })), cut: dropped ? { dropped, at: head.length } : null }),
  };
};

/** How many leading characters two texts share (hands.js `sharedHead`). @param {string} a @param {string} b */
const sharedHead = (a, b) => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
};

/**
 * One stream's output on its way out where this machine redacts (privacy.redact), as a background shell's output is
 * read (hands.js `settledEnd`, `outputBetween`): what is held is redacted whole, and goes out up to its last line break —
 * or all but the last REDACT_HOLD characters of an unfinished line — as far as the redaction of that much agrees with
 * the whole's. A secret split across two chunks goes out as its one mark, never its first half bare. What went out is let
 * go only where its redaction and the rest's, apart, read as the whole's: a mark that runs on past it keeps its start held,
 * else the rest of the secret would match nothing once its start was gone. Past eight holds of a line whose mark keeps
 * spanning the end, all that is held goes out redacted whole and is let go, and the rest of that line is held back, said
 * so (`LINE_HELD`): what came after the mark's start would match nothing, and go out bare (the swarm's review of
 * 11-10). `end` sends the rest. No redaction: each piece goes out as it comes.
 * @param {((text: string) => string) | null} redact @param {(text: string) => void} send
 */
const redactedFlow = (redact, send) => {
  if (!redact) return { add: send, end: () => {} };
  let raw = "";
  let sent = 0;
  /** The rest of a line let go of past eight holds, held back up to its break. */
  let holding = false;
  /** @param {boolean} end */
  const flush = (end) => {
    const whole = redact(raw);
    const brk = Math.max(raw.lastIndexOf("\n"), raw.lastIndexOf("\r"));
    const settled = end ? raw.length : Math.max(brk + 1, raw.length - REDACT_HOLD);
    const head = settled === raw.length ? whole : redact(raw.slice(0, settled));
    const upto = settled === raw.length ? whole.length : sharedHead(head, whole);
    if (upto > sent) {
      send(whole.slice(sent, upto));
      sent = upto;
    }
    if (sent === head.length && head + redact(raw.slice(settled)) === whole) {
      raw = raw.slice(settled);
      sent = 0;
    } else if (raw.length > 8 * REDACT_HOLD) {
      send(whole.slice(sent) + LINE_HELD);
      raw = "";
      sent = 0;
      holding = true;
    }
  };
  return {
    /** @param {string} text */
    add(text) {
      if (holding) {
        const brk = text.search(/[\r\n]/);
        if (brk < 0) return;
        holding = false;
        text = text.slice(brk);
      }
      raw += text;
      flush(false);
    },
    end: () => raw && flush(true),
  };
};

/**
 * The document a new chat in the folder `root` would start under — your defaults, then its project's layer (the rules a
 * confirmed learned permission mirrors there among them) — and so what judges a command run in it, and what redacts a
 * file another machine's agents read there (files.js).
 * @param {any} a  the admin context: `config`, `memory` (its archive, for a project's layer) @param {string} root
 */
export const folderDocument = (a, root) => {
  const archive = a.memory?.archive || null;
  let project = {};
  try {
    project = (archive && archive.projectSettings(projectIdOf(projectFolderOf(root)))) || {};
  } catch {}
  return resolveSettings({ global: harnessGlobalLayer(a.config.get()), project }).effective;
};

/** Who started or answered an exec, as its record says it. @param {any} who */
const byOf = (who) => (who?.kind === "device" ? String(who.device.name) : String(who?.kind || "unknown"));
/** Whose commands count together against EXEC_LIVE_PER_CALLER: a device by its id, else the kind of caller. @param {any} who */
const callerOf = (who) => (who?.kind === "device" ? `device ${who.device.id}` : String(who?.kind || "unknown"));

/**
 * @param {any} a  the admin context: `config`, `memory` (its archive, for a project's rules; the person's chats' folders,
 *   for another machine's agents' fence on Allow), `dataDir`, `devices` (a revoke and a grant switched off stop that
 *   device's commands), `sseClients` (the streams the shutdown ends), `log`; `execGraceMs`: how long a running command
 *   outlives its stream, where it is not EXEC_GRACE_MS (tests shorten it)
 * @returns {import("../router.js").RouteRow[]}
 */
export function execRoutes(a) {
  /** @type {Map<string, any>} the execs, running or ended a while, by id */
  const execs = new Map();
  const graceMs = Number(a.execGraceMs) > 0 ? Number(a.execGraceMs) : EXEC_GRACE_MS;

  /**
   * The verdict on `command` in `root`, as the loop's gate gives a chat's bash (loop.js `judge`): the mode it was sent
   * with (`sent`, the chat's that sent it), else this machine's (agentLoop.permissions, or your defaults'
   * loop.permissions), a command read as only reading run in every mode, then the rules — `privacy.bashDeny`,
   * `loop.rules`, the second look's — over that. No learned permission is asked for one not confirmed: a confirmed one
   * is a rule. With it, the redaction its output goes out under (privacy.redact). `device`: the id of another machine's
   * agents' device it runs for, for whom Filament's own command line is no read, and Auto is Edit unless their grant
   * `unasked` is on as it stands now, or Full control, which holds it and runs as the person (services/devices.js
   * `heldGrant`, `fullControl`); null for this machine's person.
   * @param {string} root @param {string} command @param {string | null} device @param {string | null} [sent]
   */
  const judged = (root, command, device, sent = null) => {
    const doc = folderDocument(a, root);
    const set = permissionMode(sent || loopConfig(a.config.get().agentLoop || {}, doc?.loop || null).permissions);
    const mode = set === "auto" && device !== null && !heldGrant(a.devices?.get?.(device), "unasked") ? "edit" : set;
    const input = { command };
    const fenced = device !== null && !fullControl(a.devices, device);
    const readsOnly = (/** @type {string} */ c) => readOnlyCommand(c, { root, shell: SHELL, env: safeEnv(), agentsDevice: fenced });
    const g = gate(mode, "bash", input, null, undefined, readsOnly, root);
    return { mode, redact: redactorOf(doc?.privacy?.redact), ...ruled(g, ruleFor(rulesFrom(doc), "bash", input, { root, shell: SHELL.kind }), "bash", input, root, (c) => !!readsOnly(c)?.ok) };
  };

  /**
   * Why no command runs in the folder `cwd` now, by the folder rules as a chat's folder is judged (sessions' `draftOf`)
   * and as Filament's own agent works — none on a listener open beyond this machine with no roots listed (turn.js
   * `folderRefusalOf`) —, with the status that says it; null where one may, with the folder as it resolves.
   * @param {string} cwd
   * @returns {{ status: number, error: string, root?: undefined } | { root: string, status?: undefined, error?: undefined }}
   */
  const folderNow = (cwd) => {
    const cfg = a.config.get();
    const verdict = folderVerdict(cfg, cwd);
    if (verdict.why === "missing") return { status: 400, error: `the folder does not exist on this machine: ${cwd}` };
    if (verdict.why === "outside") return { status: 403, error: outsideRootsWords(cwd) };
    if (!verdict.ok) return { status: 403, error: folderRefusalOf(cfg, cwd, verdict)?.text || `no command runs in ${cwd}` };
    return { root: verdict.root };
  };

  /**
   * An exec as a caller reaches it: another machine's agents' device its own alone, this machine's person — this
   * computer, the admin token, a full device — any; one it may not reach answers as one not there.
   * @param {any} r
   */
  const execOf = (r) => {
    const x = execs.get(decodeURIComponent(r.params.id));
    if (!x) return null;
    if (agentsDevice(r.who)) return x.device === r.who.device.id ? x : null;
    return drives(r.who) ? x : null;
  };

  /** How many commands are here, running or asking: one caller's, or everyone's. @param {string} [caller] */
  const liveCount = (caller) => [...execs.values()].filter((x) => x.state !== "ended" && (caller === undefined || x.caller === caller)).length;

  /** A command as a log line says it: on one line, redacted, its head alone. @param {string} command @param {((t: string) => string) | null} redact */
  const loggedCommand = (command, redact) => JSON.stringify(headChars(String(redactSecrets(redact ? redact(command) : command)), LOGGED_COMMAND_CHARS));

  /** An exec as its answers show it. @param {any} x */
  const viewOf = (x) => {
    const kept = x.kept.view();
    return {
      id: x.id,
      state: x.state,
      by: x.by,
      cwd: x.cwd,
      command: x.command,
      timeoutMs: x.timeoutMs,
      mode: x.mode,
      startedAt: x.startedAt,
      ranAt: x.ranAt,
      endedAt: x.endedAt,
      ask: x.ask,
      answer: x.answer,
      code: x.code,
      signal: x.signal,
      ended: x.ended,
      reason: x.reason,
      ms: x.ms,
      output: kept.output,
      cut: kept.cut,
      ...(x.unread ? { unread: x.unread } : {}),
    };
  };

  /** What a command printed, redacted where this machine redacts: kept, and told to its stream. @param {any} x @param {Stream} stream @param {string} text */
  const said = (x, stream, text) => {
    x.kept.add(stream, text);
    x.hear?.({ type: "output", stream, text });
  };

  /** Its pipes read on whatever its reader's pace: once the shell has exited, or a stop has come. @param {any} x */
  const readOn = (x) => {
    x.paused = false;
    x.proc?.stdout?.resume();
    x.proc?.stderr?.resume();
  };

  /**
   * Stop its process tree (shell.js `startCommand`'s stop: on POSIX its process group — a child that left the group by
   * setsid, or daemonized, is out of its reach —; on Windows every process MSYS started that carries the shell's tag,
   * found by Git Bash, with what it started, and taskkill /T over the shell while it lives — a program another Windows
   * program started detached once the shell had exited, or with no Git Bash anything that outlived the shell, is out of
   * its reach). Once: an exec's end and its stop each ask for it.
   * @param {any} x
   */
  const stopTree = (x) => {
    if (!x.stop || x.treeStopped) return Promise.resolve();
    x.treeStopped = true;
    return x.stop().catch(() => {});
  };

  /** Its clock, from now: the ask's while it asks, the command's own once it runs. @param {any} x @param {string} words */
  const clock = (x, words) => {
    clearTimeout(x.timer);
    x.timer = setTimeout(() => void halt(x, "timeout", words), x.timeoutMs);
    x.timer.unref?.();
  };

  /**
   * An exec ends, once: its clock stops, what its streams held goes out, its end is told to its stream and its answer
   * and written to the log, its copy is kept a while — its caller's newest EXEC_ENDED_PER_CALLER ended ones, the oldest
   * ended let go first — and its process tree is stopped, after the end is told: what it left running in the background
   * (`nohup … &`), which held none of its output, ends with it. `unread`: the bytes a stop left in its pipes, never read.
   * @param {any} x @param {{ code?: number | null, signal?: string | null, ended?: Ended | null, reason?: string | null }} end
   */
  const finish = (x, { code = null, signal = null, ended = null, reason = null }) => {
    if (x.state === "ended") return;
    clearTimeout(x.timer);
    clearTimeout(x.grace);
    if (x.held) a.sseClients?.delete(x.held);
    for (const stream of /** @type {const} */ (["stdout", "stderr"])) {
      const rest = x.decoders[stream].end();
      if (rest) x.flows[stream].add(rest);
      x.flows[stream].end();
    }
    const unread = (x.proc?.stdout?.readableLength || 0) + (x.proc?.stderr?.readableLength || 0);
    Object.assign(x, { state: "ended", ask: null, code, signal, ended, reason, unread, endedAt: Date.now() });
    x.ms = x.ranAt ? x.endedAt - x.ranAt : 0;
    const cut = x.kept.view().cut;
    x.hear?.({ type: "exit", code, signal, ms: x.ms, ...(ended ? { ended } : {}), ...(reason ? { reason } : {}), ...(cut ? { cut } : {}), ...(unread ? { unread } : {}) });
    x.hear = null;
    a.log?.(
      "info",
      `exec ${x.id}: ${x.by} in ${x.cwd}: ${loggedCommand(x.command, x.redact)} — ${x.verdict} — ended: code ${code ?? "none"}${signal ? `, ${signal}` : ""}${ended ? `, ${ended}` : ""}, ${x.ms} ms`,
    );
    x.settle();
    void stopTree(x);
    x.forget = setTimeout(() => execs.delete(x.id), ENDED_KEPT_MS);
    x.forget.unref?.();
    const over = [...execs.values()].filter((e) => e.state === "ended" && e.caller === x.caller).sort((p, q) => p.endedAt - q.endedAt);
    for (const old of over.slice(0, Math.max(0, over.length - EXEC_ENDED_PER_CALLER))) {
      clearTimeout(old.forget);
      execs.delete(old.id);
    }
  };

  /**
   * Stop an exec that has not ended: one still asking ends there; a running one is stopped with everything it started
   * (`stopTree`), its pipes read on meanwhile, and ends as its process closes — or, where that never comes, a moment
   * after the stop.
   * @param {any} x @param {Ended} ended @param {string} reason
   */
  const halt = async (x, ended, reason) => {
    if (x.state === "ended" || x.halting) return;
    x.halting = { ended, reason };
    if (!x.stop) return finish(x, { ended, reason });
    readOn(x);
    await stopTree(x);
    setTimeout(() => finish(x, { code: x.proc?.exitCode ?? null, signal: x.proc?.signalCode ?? null, ended, reason }), EXIT_DRAIN_MS).unref?.();
  };

  /**
   * A running command whose stream is gone waits for its caller to read it again by its id: `graceMs` from now, each
   * read of its caller's starting that over (GET /exec/:id); unread past it, it is stopped as one whose caller hung up.
   * Its pipes are read on meanwhile — no reader paces it now, and its copy is bounded. The shutdown stops it as it
   * ends the streams it holds (server.js): with its stream gone, it is held among them by its own end (`x.held`).
   * @param {any} x
   */
  const graced = (x) => {
    if (x.state !== "running" || x.halting) return;
    x.hear = null;
    readOn(x);
    if (!x.held) {
      x.held = { end: () => void halt(x, "closed", "Filament here shut down while it ran on with its stream gone") };
      a.sseClients?.add(x.held);
    }
    clearTimeout(x.grace);
    x.grace = setTimeout(() => void halt(x, "closed", `its caller hung up, and did not read it again within ${durationWords(graceMs)}`), graceMs);
    x.grace.unref?.();
  };

  /**
   * Run an exec's command in this machine's shell, in its folder, with the bash hand's environment and stdin closed, on
   * its own clock from now. Its end is its process's close. Once the shell exits, its pipes are read on whatever the
   * reader's pace — what is left in them is bounded —, and where a process it started still holds them a moment after,
   * the exec ends then, with what was read; its end stops that process (`finish`).
   * @param {any} x
   */
  const run = (x) => {
    /** @type {any} */
    let started;
    try {
      started = startCommand(SHELL, x.command, { cwd: x.cwd, env: safeEnv() });
    } catch (/** @type {any} */ e) {
      return finish(x, { ended: "failed", reason: `could not start the shell: ${e?.message || e}` });
    }
    const { proc, stop } = started;
    Object.assign(x, { proc, stop, state: "running", ranAt: Date.now() });
    clock(x, `it ran past its timeout of ${x.timeoutMs} ms`);
    for (const stream of /** @type {const} */ (["stdout", "stderr"]))
      proc[stream]?.on("data", (/** @type {Buffer} */ d) => {
        if (x.state === "ended") return;
        const text = x.decoders[stream].write(d);
        if (text) x.flows[stream].add(text);
      });
    proc.on("close", (/** @type {number | null} */ code, /** @type {string | null} */ signal) => finish(x, { code, signal, ...(x.halting || {}) }));
    proc.on("exit", (/** @type {number | null} */ code, /** @type {string | null} */ signal) => {
      x.exited = true;
      readOn(x);
      setTimeout(() => {
        if (x.state === "running" && !x.halting) finish(x, { code, signal });
      }, EXIT_DRAIN_MS).unref?.();
    });
    proc.on("error", (/** @type {Error} */ e) => finish(x, { ended: "failed", reason: `the shell failed: ${e?.message || e}` }));
  };

  // Another machine's agents' device revoked — by a manager here, with the full device it came in by, or replaced by a
  // second mint — or its grant `agents` or Full control switched off (devices.js `grantEnds`): what it runs here stops
  // at once, its asks with it.
  /** @param {string} device @param {string} reason */
  const haltDevice = (device, reason) => {
    for (const x of execs.values()) if (x.device === device) void halt(x, "revoked", reason);
  };
  a.devices?.onRevoke?.((/** @type {string} */ gone) => haltDevice(gone, "the agents' device that started it was revoked"));
  a.devices?.onGrant?.((/** @type {string} */ id, /** @type {any} */ grants, /** @type {any} */ before) => {
    const ends = grantEnds(grants, before);
    if (ends) haltDevice(id, `its device's ${ends}`);
  });
  // …and so does what runs in a copy let go (services/copies.js), its stop waited for before the folder is removed.
  a.remoteCopies?.onCleared?.(async (/** @type {import("../../services/copies.js").Cleared} */ { keys }) => {
    const inside = (/** @type {string} */ cwd) => !!cwd && keys.some((f) => inFolder(folderKeyOf(cwd), f));
    const there = [...execs.values()].filter((x) => x.state !== "ended" && inside(x.cwd));    await Promise.all(there.map((x) => halt(x, "stopped", "the copy it ran in was let go")));
  });
  // A command in a copy, asking or running, holds that copy while it goes on (services/copies.js `holdWhile`).
  a.remoteCopies?.holdWhile?.((/** @type {string} */ folder) => {
    const k = folderKeyOf(folder);
    return [...execs.values()].some((x) => x.state !== "ended" && !!x.cwd && inFolder(folderKeyOf(x.cwd), k));
  });

  return [
    [
      // `{ cwd, command, timeoutMs?, mode? }`: the command started in `cwd`, judged in `mode` where one is sent — or held
      // on an ask — and followed. As an SSE stream
      // (the default): `{ type: "exec", id, state, … }` first — `state` running, or asking —, `{ type: "ask", ask }` while it waits on one, each
      // `{ type: "output", stream, text }` as it comes — paced by the reader while the shell runs, so a slow one slows
      // the command rather than filling memory —, then `{ type: "exit", code, signal, ms, ended?, reason?, cut?, unread? }`.
      // With `?stream=0`, the whole of it as JSON once it ends, as GET /exec/:id answers. Either way its id is the
      // X-Filament-Exec header, sent at once, for its stop and its answer. Its caller hanging up stops it: nothing runs
      // here for nobody — a running one's stream gone, once its caller has not read it again for EXEC_GRACE_MS. A caller with EXEC_LIVE_PER_CALLER here already, or all with EXEC_LIVE_IN_ALL, is answered 429; a
      // command longer than EXEC_COMMAND_MAX_CHARS, 413.
      "POST",
      "/exec",
      guard(async (r) => {
        if (!drives(r.who) && !agentsDevice(r.who)) return sendJson(r.res, 403, { error: "a command runs here for this machine's person, or for another machine's agents with their grant on" });
        const b = await r.json();
        if (!b || typeof b !== "object" || Array.isArray(b)) return sendJson(r.res, 400, { error: "a JSON object is required: { cwd, command, timeoutMs?, mode? }" });
        const more = Object.keys(b).find((k) => !EXEC_FIELDS.includes(k));
        if (more) return sendJson(r.res, 400, { error: `a command takes ${EXEC_FIELDS.join(", ")} alone — this machine's shell and its environment, no stdin: ${more} is more than that` });
        if (typeof b.cwd !== "string" || !b.cwd.trim()) return sendJson(r.res, 400, { error: "cwd is required: the folder the command runs in" });
        if (typeof b.command !== "string" || !b.command.trim()) return sendJson(r.res, 400, { error: "command is required: what the shell runs" });
        if (b.command.length > EXEC_COMMAND_MAX_CHARS)
          return sendJson(r.res, 413, { error: `the command is ${b.command.length} characters: a command here is ${EXEC_COMMAND_MAX_CHARS} characters at most — a longer script goes in a file the command runs` });
        if (b.timeoutMs != null && !(typeof b.timeoutMs === "number" && Number.isFinite(b.timeoutMs) && b.timeoutMs > 0))
          return sendJson(r.res, 400, { error: `timeoutMs is a number of milliseconds above 0 (${EXEC_TIMEOUT_MS} when none is named, ${EXEC_TIMEOUT_MAX_MS} at most)` });
        if (b.mode != null && !PERMISSION_MODES.includes(/** @type {any} */ (b.mode)))
          return sendJson(r.res, 400, { error: `a command's mode is a permission mode by its name, ${PERMISSION_MODES.join(", ")} (the chat's that sent it); mode is ${JSON.stringify(b.mode)}` });
        // Sent by another machine's agents alone, the mode of their chat, capped by their grants: this machine's person
        // is judged by this machine's mode, which only a press of theirs moves (the review of 11-10).
        if (b.mode != null && !agentsDevice(r.who))
          return sendJson(r.res, 400, { error: "a command's mode comes from another machine's agents, the mode of the chat that sent it: this machine's own mode judges yours" });
        const sent = b.mode == null ? null : String(b.mode);
        const by = byOf(r.who);
        const caller = callerOf(r.who);
        if (liveCount(caller) >= EXEC_LIVE_PER_CALLER)
          return sendJson(r.res, 429, { error: `${by} has ${EXEC_LIVE_PER_CALLER} commands here already, running or asking — the most one caller has at once: wait for one to end, or stop one` });
        if (liveCount() >= EXEC_LIVE_IN_ALL) return sendJson(r.res, 429, { error: `${EXEC_LIVE_IN_ALL} commands are here already, running or asking — the most this machine runs at once for every caller: wait for one to end` });
        const folder = folderNow(b.cwd);
        if (folder.error) return sendJson(r.res, folder.status, { error: folder.error });
        const root = /** @type {string} */ (folder.root);
        // Refused by its mode or a rule: the words a chat's agent would read.
        const v = judged(root, b.command, agentsDevice(r.who) ? String(r.who.device.id) : null, sent);
        if (v.verdict === "refuse") {
          a.log?.("info", `exec: ${by} in ${root}: ${loggedCommand(b.command, v.redact)} — refused (${v.mode} mode${v.rule ? `, the rule ${describeRule(v.rule)}` : ""})`);
          return sendJson(r.res, 403, { error: v.text, mode: v.mode, ...(v.rule ? { rule: describeRule(v.rule) } : {}) });
        }
        /** @type {() => void} */
        let settle = () => {};
        const done = new Promise((resolve) => (settle = () => resolve(undefined)));
        const x = {
          id: `ex_${randomBytes(8).toString("hex")}`,
          device: agentsDevice(r.who) ? String(r.who.device.id) : null,
          caller,
          by,
          cwd: root,
          command: b.command,
          timeoutMs: Math.max(1, Math.min(EXEC_TIMEOUT_MAX_MS, Math.round(b.timeoutMs ?? EXEC_TIMEOUT_MS))),
          mode: v.mode,
          /** The mode it was sent with, judged in again at an Allow; null where this machine's judges it. */
          sent,
          /** How it was judged, as its log line says it: run, or asked and answered by whom. */
          verdict: v.verdict === "ask" ? "asked" : "run",
          redact: v.redact,
          state: "asking",
          startedAt: Date.now(),
          ranAt: /** @type {number | null} */ (null),
          endedAt: /** @type {number | null} */ (null),
          /** @type {any} */ ask: null,
          /** @type {any} */ answer: null,
          code: /** @type {number | null} */ (null),
          signal: /** @type {string | null} */ (null),
          ended: /** @type {Ended | null} */ (null),
          reason: /** @type {string | null} */ (null),
          ms: 0,
          unread: 0,
          kept: keptOutput(),
          decoders: { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") },
          /** @type {{ stdout: ReturnType<typeof redactedFlow>, stderr: ReturnType<typeof redactedFlow> }} */ flows: /** @type {any} */ (null),
          /** @type {((event: any) => void) | null} */ hear: null,
          /** @type {any} */ proc: null,
          /** @type {(() => Promise<void>) | null} */ stop: null,
          treeStopped: false,
          exited: false,
          /** @type {{ ended: Ended, reason: string } | null} */ halting: null,
          /** @type {any} */ timer: null,
          /** @type {any} the timer that stops it where its stream is gone and its caller reads it no more (`graced`) */ grace: null,
          /** @type {{ end: () => void } | null} what the shutdown ends to stop it, once its stream is gone (`graced`) */ held: null,
          /** @type {any} the timer that lets its copy go once it has ended */ forget: null,
          paused: false,
          done,
          settle: () => settle(),
        };
        x.flows = { stdout: redactedFlow(x.redact, (t) => said(x, "stdout", t)), stderr: redactedFlow(x.redact, (t) => said(x, "stderr", t)) };
        execs.set(x.id, x);
        const res = r.res;
        const stream = r.url.searchParams.get("stream") !== "0";
        res.writeHead(200, stream ? sseHead({ "x-filament-exec": x.id }) : { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-filament-exec": x.id });
        res.flushHeaders?.();
        // The shutdown ends what it holds (server.js), and so stops the command.
        a.sseClients?.add(res);
        const ping = stream ? setInterval(() => res.writableEnded || res.write(": ping\n\n"), PING_MS) : null;
        ping?.unref?.();
        res.on("close", () => {
          if (ping) clearInterval(ping);
          a.sseClients?.delete(res);
          // A stream gone while its command runs, by no doing of this side, may be a gap in the network: the command runs
          // on for its caller to read again (`graced`). One that still asks, a ?stream=0 caller's — which reads nothing
          // by its id —, and one this side ended (the shutdown) stop at once.
          if (stream && x.state === "running" && !x.halting && !res.writableEnded) return graced(x);
          void halt(x, "closed", "its caller hung up");
        });
        if (stream) {
          /** @param {any} event */
          const send = (event) => res.writableEnded || res.destroyed || res.write(`data: ${JSON.stringify(event)}\n\n`);
          x.hear = (event) => {
            // A reader behind while the shell runs: its pipes wait for it, as a pipe to a slow reader does. Once the shell
            // has exited, or a stop has come, they are read on (`readOn`), and the rest waits in the stream instead.
            if (send(event) || event.type !== "output" || !x.proc || x.paused || x.exited || x.halting) return;
            x.paused = true;
            x.proc.stdout?.pause();
            x.proc.stderr?.pause();
            res.once("drain", () => readOn(x));
          };
          // Whether it runs or asks first, said at once: a caller waits on no read of it to know.
          send({ type: "exec", id: x.id, state: v.verdict === "ask" ? "asking" : "running", cwd: x.cwd, command: x.command, timeoutMs: x.timeoutMs, mode: x.mode, by: x.by, ...(v.verdict === "ask" && v.rule ? { rule: describeRule(v.rule) } : {}) });
        }
        // An ask waits out the timeout, and is never allowed by itself; Allow gives the command its whole timeout.
        if (v.verdict === "ask") {
          x.ask = { id: x.id, kind: "permission", from: "exec", runId: null, tool: "bash", question: v.question, command: x.command, options: PERMIT_OPTIONS.map((o) => ({ ...o })), words: true, at: Date.now() };
          clock(x, `nobody answered its ask within ${x.timeoutMs} ms`);
          x.hear?.({ type: "ask", ask: x.ask });
        } else run(x);
        await done;
        // Ended by the shutdown, or its caller gone: nothing more is written.
        if (res.writableEnded || res.destroyed) return;
        if (stream) res.end();
        else res.end(JSON.stringify(viewOf(x)));
      }),
    ],
    // How an exec stands, with its ask while it waits on one and its kept output (`cut`: what was dropped, and where).
    // Read by the caller that started it after its stream went, it runs on for another EXEC_GRACE_MS (`graced`).
    ["GET", "/exec/:id", guard((r) => {
      const x = execOf(r);
      if (x?.grace && callerOf(r.who) === x.caller) graced(x);
      return x ? sendJson(r.res, 200, viewOf(x)) : sendJson(r.res, 404, { error: "no such exec" });
    })],
    [
      // Stop it, with everything it started; answered once it has ended, or after STOP_WAIT_MS with its state as it
      // stands (`state` still "running": its stop goes on).
      "POST",
      "/exec/:id/stop",
      guard(async (r) => {
        const x = execOf(r);
        if (!x) return sendJson(r.res, 404, { error: "no such exec" });
        if (x.state === "ended") return sendJson(r.res, 409, { error: `exec ${x.id} has ended`, exec: viewOf(x) });
        void halt(x, "stopped", `stopped by ${byOf(r.who)}`);
        await Promise.race([x.done, new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS).unref?.())]);
        return sendJson(r.res, 200, viewOf(x));
      }),
    ],
    [
      // Its ask answered, as the asks route answers a permission (sessions.js): `{ allow?, choice?, words? }` — its press,
      // `allow` or `choice` allow | deny; words alone never allow, and go with Deny as its why. 409 once it asks nothing.
      // Allow runs it under this machine's folder rules, its mode — the one it was sent with, capped by their grants
      // as they stand, else this machine's — and its rules as they stand now: a folder gone or outside the roots,
      // another machine's agents' fence, a deny rule added, a grant switched off, or, where none was sent, read-only
      // switched on while it waited wins over the yes. The device that started it answers, or this machine's person.
      "POST",
      "/exec/:id/answer",
      guard(async (r) => {
        const x = execOf(r);
        if (!x) return sendJson(r.res, 404, { error: "no such exec" });
        const b = await r.json();
        if (!b || typeof b !== "object" || Array.isArray(b) || (b.choice != null && typeof b.choice !== "string") || (b.words != null && typeof b.words !== "string") || (b.allow != null && typeof b.allow !== "boolean"))
          return sendJson(r.res, 400, { error: "a JSON object is required: { allow?, choice?, words? } — allow or a choice of allow | deny answers it" });
        const choice = b.choice == null ? null : PERMIT_OPTIONS.find((o) => o.id === b.choice) || null;
        if (b.choice != null && !choice) return sendJson(r.res, 400, { error: `choice is the id of one of its options: ${PERMIT_OPTIONS.map((o) => o.id).join(", ")}` });
        const allow = typeof b.allow === "boolean" ? b.allow : choice ? choice.id === "allow" : null;
        if (allow === null) return sendJson(r.res, 400, { error: `a permission is answered by its press: allow true or false, or choice ${PERMIT_OPTIONS.map((o) => o.id).join(" | ")} — words alone never allow` });
        if (x.state !== "asking" || x.halting) return sendJson(r.res, 409, { error: `exec ${x.id} asks nothing now: it ${x.state === "running" ? "runs" : "has ended"}` });
        const words = String(b.words ?? "").trim();
        const by = byOf(r.who);
        x.answer = { allow, words: words || null, by, at: Date.now() };
        if (!allow) {
          x.verdict = `asked, denied by ${by}`;
          finish(x, { ended: "denied", reason: words ? `denied: ${words}` : "denied" });
          return sendJson(r.res, 200, { ok: true, id: x.id, ran: false });
        }
        // The folder as it stands — and for another machine's agents, their fence — then the mode and the rules.
        const folder = folderNow(x.cwd);
        let no = folder.error || null;
        if (!no && x.device) {
          let folders = [];
          try {
            folders = a.memory?.chatFolders?.({ person: true }) || [];
          } catch {}
          no = agentFolderRefusal(x.cwd, { dataDir: a.dataDir, roots: a.config.get().agentLoop?.roots || [], folders, doing: "run a command", full: fullControl(a.devices, x.device), ...a.remoteCopies?.fenceOf(x.device) });
        }
        const now = no ? null : judged(x.cwd, x.command, x.device, x.sent);
        if (now?.verdict === "refuse") no = now.text;
        if (no) {
          x.verdict = `asked, allowed by ${by}, then refused as things stand now`;
          finish(x, { ended: "denied", reason: no });
          return sendJson(r.res, 200, { ok: true, id: x.id, ran: false, reason: no });
        }
        x.verdict = `asked, allowed by ${by}`;
        x.ask = null;
        x.hear?.({ type: "answer", allow: true, by });
        run(x);
        return sendJson(r.res, 200, { ok: true, id: x.id, ran: x.state === "running" });
      }),
    ],
  ];
}
