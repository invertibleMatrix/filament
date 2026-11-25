// @ts-check
// Filament's service on a Windows host (s3f4), as systemd's unit is on a Linux server (service.js): Task Scheduler's
// task \Filament\Filament, registered as the user without their password (S4U) and started at boot with no one logged
// in, runs `filament service run`, the runner. The runner starts Filament with its output kept in the data folder, and
// starts it again 3 s after it ends by itself (a crash, or a stop that asks to be restarted: Settings › About's Restart,
// filament restart, an update's restart), as systemd's Restart=always does; never after a stop `filament stop` asked for,
// which leaves the stop file first. On a Mac host (s3e3) launchd's LaunchAgent runs the same runner, which there stays,
// parked, while the stop file is there, rather than ending: filament start takes the file back, and launchd is asked
// nothing. The runner, the CLI and filament update share the data folder's service folder: runner.json (the runner's pid
// and the Filament it runs), stop, server.log (Filament's output, its runs' lines), task.xml (the task as registered),
// and on a Mac runner.log (what launchd's runner itself says) and the LaunchDaemon's plist that sudo installs.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { processRuns, STARTED_ALREADY } from "./listening.js";
import { pause } from "./flows.js";

/** The task's path in Task Scheduler's library. */
export const TASK = "\\Filament\\Filament";

/** What Filament's state says started it, run by the runner: FILAMENT_SUPERVISOR's value. */
export const SUPERVISOR = "service";

/** How long the runner waits to start Filament again after it ended: systemd's RestartSec. */
export const AGAIN_MS = 3000;

/** The log kept before it is set aside as server.log.1, at a start of Filament's. */
const LOG_MAX = 5 * 1024 * 1024;

/** The files of the data folder's service folder. @param {string} dataDir */
export const serviceFiles = (dataDir) => {
  const dir = join(dataDir, "service");
  return {
    dir,
    runner: join(dir, "runner.json"),
    stop: join(dir, "stop"),
    log: join(dir, "server.log"),
    xml: join(dir, "task.xml"),
    runnerLog: join(dir, "runner.log"),
    daemon: join(dir, "com.filamentdev.server.plist"),
  };
};

/**
 * A file written whole: beside it first, then renamed over it, so a read meanwhile (the CLI's, filament update's) never
 * finds it cut short. Written in place where the rename is refused. @param {string} file @param {string} text
 */
const writeWhole = (file, text) => {
  const part = `${file}.${process.pid}.part`;
  try {
    writeFileSync(part, text);
    renameSync(part, file);
  } catch {
    rmSync(part, { force: true });
    writeFileSync(file, text);
  }
};

/**
 * The runner that runs the data folder's Filament, where one runs: its pid, the Filament it runs now (0 between its
 * starts), how many times it has started one — so a start whose Filament ended at once is seen all the same —, the
 * task's command line it was started by (null where it does not say), when it started (0 where it does not say), and
 * whether it is parked: a Mac's, stopped as asked, waiting for filament start.
 * @param {string} dataDir @returns {{ pid: number, server: number, starts: number, task: string[] | null, since: number, parked: boolean } | null}
 */
export function runnerOf(dataDir) {
  try {
    const r = JSON.parse(readFileSync(serviceFiles(dataDir).runner, "utf8"));
    if (!Number.isInteger(r?.pid) || r.pid <= 0 || !processRuns(r.pid)) return null;
    const server = Number(r.server);
    return {
      pid: r.pid,
      server: Number.isInteger(server) && server > 0 && processRuns(server) ? server : 0,
      starts: Number.isInteger(r.starts) ? r.starts : 0,
      task: Array.isArray(r.task) ? r.task.map(String) : null,
      since: Number.isFinite(r.since) ? r.since : 0,
      parked: r.parked === true,
    };
  } catch {
    return null;
  }
}

/** A word of a Windows command line, as a program's argv reads it back: quoted where it holds a space or a quote. @param {string} w */
export const argWord = (w) => (w && !/[\s"]/.test(w) ? w : `"${w.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`);

/**
 * The words of a Windows command line, as a program's argv reads them (CommandLineToArgvW's rules: backslashes double
 * before a quote, a quote of its own in quotes is "\"").
 * @param {string} line
 */
export function argWords(line) {
  /** @type {string[]} */
  const words = [];
  let w = "";
  let quoted = false;
  let any = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      let n = 0;
      while (line[i] === "\\") n++, i++;
      if (line[i] === '"') {
        w += "\\".repeat(Math.floor(n / 2));
        if (n % 2) w += '"';
        else quoted = !quoted;
      } else {
        w += "\\".repeat(n);
        i--;
      }
      any = true;
    } else if (c === '"') {
      quoted = !quoted;
      any = true;
    } else if (!quoted && /\s/.test(c)) {
      if (any) words.push(w);
      w = "";
      any = false;
    } else {
      w += c;
      any = true;
    }
  }
  if (any) words.push(w);
  return words;
}

/** Text as an XML element's or attribute's. @param {string} s */
const xmlText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An XML element's text taken back. @param {string} s */
const fromXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * The task, as schtasks /Create /XML registers it: at boot, as `user` without their password (S4U: no one logged in,
 * nothing stored), its runner `argv` with the data folder and the port, run once at a time, never stopped for its age,
 * a battery or idleness, and started again a minute on where it ends in failure (the runner ends in failure only where
 * it cannot run at all).
 * @param {{ argv: string[], dataDir: string, port?: number | null, user: string }} o
 */
export function taskXml({ argv, dataDir, port = null, user }) {
  const args = [...argv.slice(1), "--data-dir", dataDir, "service", "run", ...(port != null ? ["--port", String(port)] : [])];
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    "    <Description>Filament, run at boot: written by filament service install, removed by filament service uninstall.</Description>",
    `    <URI>${xmlText(TASK)}</URI>`,
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <BootTrigger>",
    "      <Enabled>true</Enabled>",
    "    </BootTrigger>",
    "  </Triggers>",
    "  <Principals>",
    '    <Principal id="Author">',
    `      <UserId>${xmlText(user)}</UserId>`,
    "      <LogonType>S4U</LogonType>",
    "      <RunLevel>LeastPrivilege</RunLevel>",
    "    </Principal>",
    "  </Principals>",
    "  <Settings>",
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
    "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
    "    <AllowHardTerminate>true</AllowHardTerminate>",
    "    <StartWhenAvailable>true</StartWhenAvailable>",
    "    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>",
    "    <IdleSettings>",
    "      <StopOnIdleEnd>false</StopOnIdleEnd>",
    "      <RestartOnIdle>false</RestartOnIdle>",
    "    </IdleSettings>",
    "    <AllowStartOnDemand>true</AllowStartOnDemand>",
    "    <Enabled>true</Enabled>",
    "    <Hidden>false</Hidden>",
    "    <RunOnlyIfIdle>false</RunOnlyIfIdle>",
    "    <WakeToRun>false</WakeToRun>",
    "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
    "    <Priority>5</Priority>",
    "    <RestartOnFailure>",
    "      <Interval>PT1M</Interval>",
    "      <Count>999</Count>",
    "    </RestartOnFailure>",
    "  </Settings>",
    '  <Actions Context="Author">',
    "    <Exec>",
    `      <Command>${xmlText(argv[0])}</Command>`,
    `      <Arguments>${xmlText(args.map(argWord).join(" "))}</Arguments>`,
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    "",
  ].join("\r\n");
}

/**
 * What a task's XML says (ours, or schtasks /Query's): the command line it runs, the data folder and port it names,
 * and whether it is enabled. @param {string | null} xml
 * @returns {{ command: string, args: string[], dataDir: string | null, enabled: boolean } | null}
 */
export function taskOf(xml) {
  if (!xml) return null;
  const el = (/** @type {string} */ name, /** @type {string} */ within = xml) => {
    const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(within);
    return m ? fromXml(m[1].trim()) : null;
  };
  const settings = /<Settings>([\s\S]*?)<\/Settings>/.exec(xml)?.[1] || "";
  const args = argWords(el("Arguments") || "");
  const at = args.indexOf("--data-dir");
  return { command: el("Command") || "", args, dataDir: at >= 0 && args[at + 1] ? args[at + 1] : null, enabled: el("Enabled", settings) !== "false" };
}

/** The XML written where schtasks reads it: UTF-16 with its mark, as its first line says. @param {string} file @param {string} xml */
export function writeTaskXml(file, xml) {
  writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]));
}

/** A task's XML read back, from the UTF-16 file writeTaskXml wrote; null where there is none. @param {string} file */
export function readTaskXml(file) {
  try {
    const b = readFileSync(file);
    return b[0] === 0xff && b[1] === 0xfe ? b.subarray(2).toString("utf16le") : b.toString("utf8");
  } catch {
    return null;
  }
}

/** The log's last `n` lines. @param {string} dataDir @param {number} n */
export function logTail(dataDir, n) {
  try {
    return readFileSync(serviceFiles(dataDir).log, "utf8").split(/\r?\n/).filter(Boolean).slice(-n);
  } catch {
    return [];
  }
}

/**
 * `filament service run`, the task's runner: Filament started (`launch()` says how, at each start: `current`, which an
 * update moved, is followed), its output appended to server.log (set aside as server.log.1 past 5 MB), and started
 * again `againMs` after it ends by itself; longer where it ended as it started (doubled each time, a minute at most),
 * and half a minute where another Filament of the data folder runs (exit 6: started by hand). It ends once the stop file
 * is there as Filament ends, or while it waits, or where another runner runs the data folder already. With `park`
 * (launchd's, on a Mac) it stays instead while the stop file is there, marked parked, and starts Filament again once the
 * file is taken back; a stop of its own (`signal`: launchd's SIGTERM) asks the Filament it runs to end, and waits for it.
 * Its pid and Filament's are in runner.json while it runs, with `task`, the task's command line that started it (an
 * install of another one starts it again on the new one), and `since`, when it started.
 * @param {{ dataDir: string, launch: () => { command: string, args: string[] }, port?: number | null, againMs?: number, signal?: AbortSignal, env?: NodeJS.ProcessEnv, task?: string[] | null, park?: boolean }} o
 * @returns {Promise<void>}
 */
export async function runRunner({ dataDir, launch, port = null, againMs = AGAIN_MS, signal, env = process.env, task = null, park = false }) {
  const f = serviceFiles(dataDir);
  mkdirSync(f.dir, { recursive: true });
  const other = runnerOf(dataDir);
  if (other && other.pid !== process.pid) return;
  /** A line of the runner's own in the log. @param {string} s */
  const note = (s) => {
    try {
      writeFileSync(f.log, `[service] ${new Date().toISOString()} ${s}\n`, { flag: "a" });
    } catch {}
  };
  let starts = 0;
  const since = Date.now();
  /** @param {number} server @param {boolean} [parked] */
  const mark = (server, parked = false) => writeWhole(f.runner, JSON.stringify({ pid: process.pid, server, starts, task, since, ...(parked ? { parked } : {}), startedAt: Date.now() }));
  // A start of the task's own (at boot, filament start) is asked for: a stop asked before it stands no more.
  rmSync(f.stop, { force: true });
  mark(0);
  let wait = againMs;
  /** @type {import("node:child_process").ChildProcess | null} */
  let running = null;
  const forward = () => running?.kill("SIGTERM");
  if (park) signal?.addEventListener("abort", forward);
  try {
    while (!signal?.aborted) {
      if (existsSync(f.stop)) {
        if (!park) break;
        // Parked: launchd would start a runner that ended again, so this one waits for the stop to be taken back.
        mark(0, true);
        note("Filament stays stopped, as asked, until filament start");
        while (existsSync(f.stop) && !signal?.aborted) await pause(250, signal).catch(() => {});
        if (signal?.aborted) break;
        wait = againMs;
        mark(0);
      }
      try {
        if (statSync(f.log).size > LOG_MAX) renameSync(f.log, `${f.log}.1`);
      } catch {}
      const { command, args } = launch();
      const out = openSync(f.log, "a");
      const began = Date.now();
      /** @type {number | null} */
      let code = null;
      try {
        const child = spawn(command, [...args, "start", "--data-dir", dataDir, ...(port != null ? ["--port", String(port)] : [])], {
          stdio: ["ignore", out, out],
          windowsHide: true,
          env: { ...env, FILAMENT_SUPERVISOR: SUPERVISOR },
        });
        running = child;
        code = await new Promise((done) => {
          child.once("error", (e) => {
            starts++;
            note(`Filament could not be started (${e.message})`);
            done(1);
          });
          child.once("spawn", () => {
            starts++;
            mark(child.pid || 0);
            note(`Filament started (process ${child.pid})`);
          });
          child.once("exit", (c) => done(c ?? 1));
        });
      } finally {
        running = null;
        closeSync(out);
      }
      mark(0);
      if (existsSync(f.stop) || signal?.aborted) {
        note(`Filament ended (exit code ${code}), stopped as asked`);
        continue;
      }
      // One that ran a while is started again soon; one that ends as it starts, less and less often.
      wait = code === STARTED_ALREADY ? 30_000 : Date.now() - began > 10_000 ? againMs : Math.min(wait * 2, 60_000);
      note(code === STARTED_ALREADY ? `another Filament of this data folder runs (exit code ${code}): tried again in 30 s` : `Filament ended (exit code ${code}): started again in ${Math.round(wait / 1000)} s`);
      for (const end = Date.now() + wait; Date.now() < end && !existsSync(f.stop) && !signal?.aborted; ) await pause(Math.min(250, Math.max(1, end - Date.now())), signal).catch(() => {});
    }
  } finally {
    signal?.removeEventListener("abort", forward);
    try {
      if (JSON.parse(readFileSync(f.runner, "utf8"))?.pid === process.pid) rmSync(f.runner, { force: true });
    } catch {}
    rmSync(f.stop, { force: true });
  }
}

/** A note of the stop asked for, which the runner reads as Filament ends: it starts Filament no more. @param {string} dataDir */
export function askStop(dataDir) {
  const f = serviceFiles(dataDir);
  mkdirSync(f.dir, { recursive: true });
  writeFileSync(f.stop, String(Date.now()));
}

/** The stop asked for, taken back. @param {string} dataDir */
export const unaskStop = (dataDir) => rmSync(serviceFiles(dataDir).stop, { force: true });
