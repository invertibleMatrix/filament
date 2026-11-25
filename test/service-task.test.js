// @ts-check
// Filament's service on a Windows host (s3f4), its parts that need no Task Scheduler: the task's XML as schtasks /Create
// reads it and /Query gives it back, a Windows command line's words, and the runner (`filament service run`) — run here
// for real, Filament played by a Node script whose control file says whether it runs on, ends at once, or finds another
// Filament of its data folder (exit 6). Each runs on any platform: the runner is Node's own.
// (fails before: yes — there was no service-task.js: a Windows host had no service, `filament service` refused there)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUPERVISOR, TASK, argWord, argWords, askStop, logTail, readTaskXml, runRunner, runnerOf, serviceFiles, taskOf, taskXml, writeTaskXml } from "../src/cli/service-task.js";
import { removeDirs } from "./helpers/wait.js";

/** Whether a process runs. @param {number} pid */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Waited for until `ok` holds, a few seconds at most. @param {() => any} ok @param {string} what */
const until = async (ok, what, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) {
    const v = ok();
    if (v) return v;
  }
  assert.fail(`waited ${ms} ms for ${what}`);
};

/** A data folder, and Filament played by a script whose control file says what it does as it starts. */
const machine = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-runner-"));
  const data = join(dir, "data");
  mkdirSync(data);
  const control = join(dir, "control");
  writeFileSync(control, "run");
  const script = join(dir, "filament.cjs");
  writeFileSync(
    script,
    [
      'const fs = require("fs");',
      `console.log("filament " + process.pid + " " + (process.env.FILAMENT_SUPERVISOR || "-") + " " + process.argv.slice(2).join(" "));`,
      `const mode = fs.readFileSync(${JSON.stringify(control)}, "utf8").trim();`,
      'if (mode === "crash") process.exit(1);',
      'if (mode === "taken") process.exit(6);',
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"),
  );
  const ac = new AbortController();
  return {
    dir,
    data,
    f: serviceFiles(data),
    /** @param {string} mode */
    mode: (mode) => writeFileSync(control, mode),
    ac,
    /** The runner, with a short wait between starts. @param {{ port?: number | null }} [o] */
    run: (o = {}) => runRunner({ dataDir: data, launch: () => ({ command: process.execPath, args: [script] }), againMs: 50, signal: ac.signal, ...o }),
    async close() {
      ac.abort();
      const r = runnerOf(data);
      if (r?.server) process.kill(r.server);
      await removeDirs(dir);
    },
  };
};

test("the task's XML: at boot, as the user without their password (S4U), once at a time, never stopped for its age — and read back whole, its words with spaces, quotes and a trailing backslash", () => {
  const argv = ["C:\\Users\\Ada Lovelace\\AppData\\Local\\filament\\current\\node\\node.exe", "C:\\Users\\Ada Lovelace\\AppData\\Local\\filament\\current\\bin\\filament.js"];
  const dataDir = 'D:\\data & "more"\\';
  const xml = taskXml({ argv, dataDir, port: 20555, user: "HOST\\ada" });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>\r\n'), "CRLF lines, as Task Scheduler writes its own");
  for (const l of ["<BootTrigger>", "<UserId>HOST\\ada</UserId>", "<LogonType>S4U</LogonType>", "<RunLevel>LeastPrivilege</RunLevel>", "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>", "<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>", "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>", "<Interval>PT1M</Interval>", `<URI>${TASK}</URI>`])
    assert.ok(xml.includes(l), l);
  assert.match(xml, /<Arguments>[^<]*&amp; \\&quot;more\\&quot;[^<]*<\/Arguments>/, "& and quotes as XML writes them");
  const t = taskOf(xml);
  assert.deepEqual(t, { command: argv[0], args: [argv[1], "--data-dir", dataDir, "service", "run", "--port", "20555"], dataDir, enabled: true });
  // Task Scheduler's own /Query /XML: its Enabled false where /Change /DISABLE turned it off.
  assert.equal(taskOf(xml.replace("<Enabled>true</Enabled>\r\n    <Hidden>", "<Enabled>false</Enabled>\r\n    <Hidden>"))?.enabled, false);
  assert.equal(taskOf(null), null);
  assert.equal(taskOf(taskXml({ argv, dataDir: "D:\\d", user: "ada" }))?.args.includes("--port"), false, "no --port where none is given");
});

test("a Windows command line's words, as a program's argv reads them back", () => {
  for (const w of ["plain", "with space", 'a"quote', "trail\\", "trail space\\", 'both\\"', "", "C:\\Program Files\\x"]) assert.deepEqual(argWords(argWord(w)), [w], JSON.stringify(w));
  assert.deepEqual(argWords('a "b c" d\\\\"e f"'), ["a", "b c", "d\\e f"]);
});

test("the XML file: UTF-16 with its mark, as schtasks reads it, and read back; none, null", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-task-xml-"));
  try {
    const file = join(dir, "task.xml");
    const xml = taskXml({ argv: ["n.exe", "f.js"], dataDir: "D:\\Café", user: "ada" });
    writeTaskXml(file, xml);
    const b = readFileSync(file);
    assert.deepEqual([b[0], b[1]], [0xff, 0xfe]);
    assert.equal(readTaskXml(file), xml);
    assert.equal(readTaskXml(join(dir, "none.xml")), null);
  } finally {
    await removeDirs(dir);
  }
});

test("the runner: Filament started with its supervisor said and its output in server.log, started again after it ends by itself, and no more once a stop is asked — runner.json then gone, the stop file too", async () => {
  const m = machine();
  try {
    const done = m.run({ port: 20555 });
    const first = await until(() => runnerOf(m.data)?.server, "Filament started");
    assert.deepEqual(runnerOf(m.data), { pid: process.pid, server: first, starts: 1, task: null });
    await until(() => logTail(m.data, 5).some((l) => l.startsWith(`filament ${first} `)), "its output in the log");
    assert.ok(logTail(m.data, 5).includes(`filament ${first} ${SUPERVISOR} start --data-dir ${m.data} --port 20555`), logTail(m.data, 5).join("\n"));
    process.kill(first);
    const second = await until(() => runnerOf(m.data)?.server !== first && runnerOf(m.data)?.server, "started again");
    assert.equal(runnerOf(m.data)?.starts, 2);
    assert.ok(logTail(m.data, 10).some((l) => /^\[service\] \S+ Filament ended \(exit code \d+\): started again in 0 s$/.test(l)), logTail(m.data, 10).join("\n"));
    askStop(m.data);
    process.kill(second);
    await done;
    assert.ok(!existsSync(m.f.runner) && !existsSync(m.f.stop), "nothing left behind");
    assert.match(logTail(m.data, 1)[0], /Filament ended \(exit code \d+\), stopped as asked$/);
  } finally {
    await m.close();
  }
});

test("the runner: one that ends as it starts is started less and less often, each start counted; one that finds another Filament of its data folder (exit 6) waits half a minute; a stop asked while it waits ends it", async () => {
  const m = machine();
  try {
    m.mode("crash");
    const done = m.run();
    await until(() => (runnerOf(m.data)?.starts ?? 0) >= 3, "three starts");
    const waits = logTail(m.data, 50)
      .map((l) => /started again in (\d+) s$/.exec(l)?.[1])
      .filter(Boolean);
    assert.ok(waits.length >= 2, logTail(m.data, 50).join("\n"));
    // A start under way may read the new mode yet: the count from here on is at least the one now.
    const crashed = /** @type {number} */ (runnerOf(m.data)?.starts);
    m.mode("taken");
    await until(() => logTail(m.data, 1)[0]?.endsWith("another Filament of this data folder runs (exit code 6): tried again in 30 s"), "exit 6 said");
    const starts = runnerOf(m.data)?.starts;
    askStop(m.data);
    await done;
    assert.ok(!existsSync(m.f.runner));
    assert.ok(starts && starts >= crashed, `${starts}\n${logTail(m.data, 50).join("\n")}`);
  } finally {
    await m.close();
  }
});

test("the runner: a stop asked before it starts stands no more (a start is asked for); another runner of the data folder that runs, it leaves alone; its signal ends it", async () => {
  const m = machine();
  const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    askStop(m.data);
    const done = m.run();
    await until(() => runnerOf(m.data)?.server, "Filament started, the old stop taken back");
    const server = /** @type {number} */ (runnerOf(m.data)?.server);
    m.ac.abort();
    process.kill(server);
    await done;
    assert.ok(!existsSync(m.f.runner));
    writeFileSync(m.f.runner, JSON.stringify({ pid: other.pid, server: 0, starts: 3 }));
    await runRunner({ dataDir: m.data, launch: () => assert.fail("not started: another runner runs it"), againMs: 50 });
    assert.equal(JSON.parse(readFileSync(m.f.runner, "utf8")).pid, other.pid, "its runner.json stays");
  } finally {
    other.kill();
    await until(() => !alive(/** @type {number} */ (other.pid)), "the other gone");
    await m.close();
  }
});

test("the runner: a log past 5 MB is set aside as server.log.1 at a start", async () => {
  const m = machine();
  try {
    mkdirSync(m.f.dir, { recursive: true });
    writeFileSync(m.f.log, "x".repeat(5 * 1024 * 1024 + 1));
    const done = m.run();
    const server = await until(() => runnerOf(m.data)?.server, "Filament started");
    assert.ok(existsSync(`${m.f.log}.1`));
    await until(() => readFileSync(m.f.log, "utf8").length > 0, "a new log begun");
    assert.ok(readFileSync(m.f.log, "utf8").length < 1000);
    askStop(m.data);
    process.kill(server);
    await done;
  } finally {
    await m.close();
  }
});
