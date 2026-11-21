// @ts-check
// What a coding agent left running when its turn was stopped (HarnessV4_Tasks B13). An agent that runs a command in a
// shell of its own is the only one that can end it, and one that does not — Cursor's CLI, seen live on 2026-10-11: a
// 90 s command ran to its end after the Stop, the turn 0.6 s over — leaves the developer's Stop half done.
// Filament holds the agent's process, so it can see what that process started while the stopped command ran. It reads
// that at the stop, before the agent hears its cancel: Cursor ends the shell it ran the command in and leaves what
// the shell started, which is nobody's child from then and could be told from no other process on the machine. Once
// the cancel is answered, what of it still runs is ended — only where it is surely the command's: the stopped command
// was the one thing the agent's process was doing then, in any session of it. Where the agent did other work
// meanwhile — another call of the turn's, another chat's turn on the same process — a process born then may be that
// work's (a server the agent put in the background), so nothing is ended and the turn says what still runs.
// The processes are read from the system's own table: Windows' through PowerShell, elsewhere through ps.
import { execFile } from "node:child_process";
import { win32 } from "node:path";

/**
 * A process of the system's table. `startedAt`: when it was created, by the machine's clock — to the millisecond on
 * Windows, late by under a second elsewhere (ps says a whole second's age).
 * @typedef {{ pid: number, ppid: number, startedAt: number, name: string }} Proc
 */
/**
 * A process the stopped command started that still runs, its parent of then gone or older than the command: the top
 * of what is left. `under`: how many processes run under it now.
 * @typedef {{ pid: number, name: string, startedAt: number, under: number }} Left
 */

const WINDOWS_ROWS =
  'Get-CimInstance Win32_Process | ForEach-Object { if ($_.CreationDate) { "$($_.ProcessId) $($_.ParentProcessId) $(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()) $($_.Name)" } }';

/** Windows' rows, `pid ppid createdMs name`, as processes. @param {string} text @returns {Proc[]} */
export function readWindowsRows(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => /^(\d+) (\d+) (\d+) (.+)$/.exec(l.trim()))
    .filter((m) => m != null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), startedAt: Number(m[3]), name: m[4] }));
}

/** ps's age of a process, `[[dd-]hh:]mm:ss`, in ms; null where it is none. @param {string} etime */
function ageMs(etime) {
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(etime);
  return m ? (((Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3])) * 60 + Number(m[4])) * 1000 : null;
}

/** ps's rows, `pid ppid etime comm`, as processes: each began its age before `now`. @param {string} text @param {number} now @returns {Proc[]} */
export function readPsRows(text, now) {
  /** @type {Proc[]} */
  const procs = [];
  for (const l of String(text).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(l);
    const age = m ? ageMs(m[3]) : null;
    if (m && age != null) procs.push({ pid: Number(m[1]), ppid: Number(m[2]), startedAt: now - age, name: m[4].trim() });
  }
  return procs;
}

/**
 * How long the system's table is waited for: 15 s. Idle, Windows answers in about half a second; but a Stop often
 * comes on a machine kept busy by the very command being stopped, and beside 64 busy processes PowerShell took
 * 3.6–5.7 s to start and 12–15 s to read the table — a shorter wait there reads nothing, and the Stop ends nothing.
 * A Stop waits for this read before the agent hears its cancel (`startedSince`), so on such a machine the cancel
 * waits as long, the command running on meanwhile: the read must see the command's shell before the cancel ends it.
 * The looks after the cancel (`leftRunning`) hold the turn's end as long each. A system that does not answer even
 * then is given up on: the table is then none, and said so.
 */
export const LIST_WAIT_MS = 15_000;

/**
 * The system's processes now; none where its table cannot be read, said to `log`.
 * @param {{ platform?: string, log?: (level: string, text: string) => void, now?: () => number, waitMs?: number, exec?: typeof execFile }} [o]
 *   `waitMs`: how long the table is waited for; `exec`: what runs the program that reads it
 * @returns {Promise<Proc[]>}
 */
export function listProcesses({ platform = process.platform, log = () => {}, now = Date.now, waitMs = LIST_WAIT_MS, exec = execFile } = {}) {
  const win = platform === "win32";
  const file = win ? win32.join(process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "ps";
  const args = win ? ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_ROWS] : ["-A", "-o", "pid=,ppid=,etime=,comm="];
  return new Promise((done) => {
    try {
      exec(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: waitMs }, (/** @type {any} */ e, stdout) => {
        if (e) log("warn", `the system's process table could not be read (${e.killed ? `no answer within ${waitMs / 1000} s` : String(e.message).slice(0, 160)})`);
        done(e ? [] : win ? readWindowsRows(stdout) : readPsRows(stdout, now()));
      });
    } catch (/** @type {any} */ e) {
      log("warn", `the system's process table could not be read (${String(e?.message).slice(0, 160)})`);
      done([]);
    }
  });
}

/**
 * A table's processes by id, and what runs under each. A process older than its parent is no child of it — the
 * system gave a dead parent's id to another — and is under nothing.
 * @param {Proc[]} procs
 */
function tree(procs) {
  const by = new Map(procs.map((p) => [p.pid, p]));
  /** @type {Map<number, Proc[]>} */
  const kids = new Map();
  for (const p of procs) {
    const parent = by.get(p.ppid);
    if (!parent || p.pid === p.ppid || p.startedAt < parent.startedAt) continue;
    kids.set(p.ppid, [...(kids.get(p.ppid) || []), p]);
  }
  /** Every process under `pid`. @param {number} pid @returns {Proc[]} */
  const under = (pid) => (kids.get(pid) || []).flatMap((k) => [k, ...under(k.pid)]);
  return { by, kids, under };
}

/**
 * Everything `root` has started since `since`: each process born under it from then on whose parent was there
 * before, with all that runs under it.
 * @param {Proc[]} procs @param {number} root @param {number} since @returns {Proc[]}
 */
export function startedUnder(procs, root, since) {
  const { by, kids, under } = tree(procs);
  /** What is new under `pid`: a process born since, with all under it, else what is new under an older one. @param {number} pid @returns {Proc[]} */
  const fresh = (pid) => (kids.get(pid) || []).flatMap((k) => (k.startedAt >= since ? [k, ...under(k.pid)] : fresh(k.pid)));
  return by.has(root) ? fresh(root) : [];
}

/** One process in two tables: the same id, begun at the same time — to ps's whole second. @param {Proc} a @param {Proc} b */
const same = (a, b) => a.pid === b.pid && Math.abs(a.startedAt - b.startedAt) < 1500;

/**
 * Which of `was` a later table still holds, as the tops of what is left: each one whose parent of then runs no more
 * (the agent ended its shell and left what the shell ran) or was never the command's.
 * @param {Proc[]} procs @param {Proc[]} was @returns {Left[]}
 */
export function stillRunning(procs, was) {
  const { by, under } = tree(procs);
  const alive = was.filter((w) => {
    const now = by.get(w.pid);
    return !!now && same(now, w);
  });
  return alive.filter((w) => !alive.some((a) => a.pid === w.ppid)).map((w) => ({ pid: w.pid, name: w.name, startedAt: w.startedAt, under: under(w.pid).length }));
}

/**
 * What the agent's process has started since a command of its began, read now: at the stop, before the agent hears
 * its cancel. → null where the system's table could not be read.
 * @param {{ agentPid: number, since: number, platform?: string, log?: (level: string, text: string) => void,
 *   list?: typeof listProcesses, waitMs?: number }} o  `since`: when the earliest command still open at the stop began;
 *   `waitMs`: how long the table is waited for
 * @returns {Promise<Proc[] | null>}
 */
export async function startedSince({ agentPid, since, platform = process.platform, log = () => {}, list = listProcesses, waitMs = LIST_WAIT_MS }) {
  const procs = await list({ platform, log, waitMs });
  return procs.length ? startedUnder(procs, agentPid, since) : null;
}

/**
 * End a process with everything under it: Windows' taskkill takes the tree; elsewhere each process under it is
 * killed, the deepest first, then itself. → whether it is gone.
 * @param {number} pid @param {{ platform?: string, procs?: Proc[] }} [o]  `procs`: the table the tree is read from
 * @returns {Promise<boolean>}
 */
export function endTree(pid, { platform = process.platform, procs = [] } = {}) {
  if (platform !== "win32") {
    /** @param {number} of @returns {number[]} */
    const under = (of) => procs.filter((p) => p.ppid === of && p.pid !== of).flatMap((k) => [...under(k.pid), k.pid]);
    let ended = true;
    for (const id of [...under(pid), pid]) {
      try {
        process.kill(id, "SIGKILL");
      } catch (/** @type {any} */ e) {
        if (e?.code !== "ESRCH") ended = false;
      }
    }
    return Promise.resolve(ended);
  }
  const taskkill = win32.join(process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows", "System32", "taskkill.exe");
  return new Promise((done) => {
    try {
      execFile(taskkill, ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, (e) => done(!e));
    } catch {
      done(false);
    }
  });
}

/** How long after a first look the second comes: what an agent was ending as it answered its cancel is gone by then. */
const SECOND_LOOK_MS = 700;

/**
 * What the agent left running of a stopped turn's commands, dealt with: of what they had started at the stop (`was`),
 * what still runs once the cancel is answered, and again a moment later (an agent that ends its own commands may
 * still be ending them), is ended where the command ran `alone`, and named either way.
 * @param {{ was: Proc[] | null, alone: boolean, platform?: string, log?: (level: string, text: string) => void,
 *   list?: typeof listProcesses, end?: typeof endTree, pause?: (ms: number) => Promise<void>, waitMs?: number }} o
 *   `was`: null where the table could not be read at the stop; `waitMs`: how long each look waits for the table
 * @returns {Promise<{ ended: Left[], left: Left[], alone: boolean, unread?: boolean } | null>}  null where nothing
 *   was left running; `unread`: the system's table could not be read, so what was left is not known
 */
export async function leftRunning({ was, alone, platform = process.platform, log = () => {}, list = listProcesses, end = endTree, pause = (ms) => new Promise((r) => setTimeout(r, ms)), waitMs = LIST_WAIT_MS }) {
  const unread = { ended: [], left: [], alone, unread: true };
  if (!was) return unread;
  if (!was.length) return null;
  const first = await list({ platform, log, waitMs });
  if (!first.length) return unread;
  if (!stillRunning(first, was).length) return null;
  await pause(SECOND_LOOK_MS);
  const procs = await list({ platform, log, waitMs });
  if (!procs.length) return unread;
  const still = stillRunning(procs, was);
  if (!still.length) return null;
  if (!alone) return { ended: [], left: still, alone };
  /** @type {Left[]} */
  const ended = [];
  /** @type {Left[]} */
  const left = [];
  for (const b of still) ((await end(b.pid, { platform, procs })) ? ended : left).push(b);
  return { ended, left, alone };
}

/** A process left running in words: its name, its id, and how many run under it. @param {Left} b */
const named = (b) => `${b.name} (process ${b.pid}${b.under ? `, ${b.under} more under it` : ""})`;

/**
 * What became of the stopped turn's commands, for the developer; "" where nothing was left running.
 * @param {{ ended: Left[], left: Left[], alone: boolean, unread?: boolean } | null} found @param {string} agent  the agent's name
 */
export function leftRunningWords(found, agent) {
  if (!found) return "";
  if (found.unread) return `Filament could not read this system's processes, so it cannot tell whether ${agent} left the stopped command running.`;
  const said = [];
  if (found.ended.length) said.push(`${agent} left the stopped command running, so Filament ended it: ${found.ended.map(named).join(", ")}.`);
  if (found.left.length)
    said.push(
      found.alone
        ? `${agent} left the stopped command running, and Filament could not end it: ${found.left.map(named).join(", ")}.`
        : `Something ${agent} started while the stopped command ran is still running: ${found.left.map(named).join(", ")}. Filament ended none of it: ${agent} was doing other work then, and it cannot tell which of these the stopped command started.`,
    );
  return said.join(" ");
}
