#!/usr/bin/env node
// Filament CLI: start Filament, and drive the one that runs — set it up, connect keys and coding agents, send a chat
// its message (src/cli/main.js). Only `start` loads the server: every other command answers at once.
// First, before any module that may start a program: on Windows a bare name is the PATH's, never a project folder's.
import "../src/adapters/tools/own-programs.js";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolveDataDir, loadConfig, portOption } from "../src/config.js";
import { frontDoorUrl } from "../src/app/readiness.js";
import { dropElectronVars } from "../src/adapters/agents/agent-process.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(name);
/** The command line past `--data-dir <p>`, which every command takes. */
const commandLine = () => args.filter((a, i) => a !== "--data-dir" && args[i - 1] !== "--data-dir");

// A command other than start ends by itself once its work is done, with its exit code set. `process.exit` there, with
// an agent's process, a call or a timer still closing, can trip libuv's UV_HANDLE_CLOSING assertion on Windows as Node
// tears down (nodejs/node#56645), and the command, its words printed, exits 0xC0000409 in place of its code.
/** The flags of start's and the doctor's that take a value: a value is no command. */
const VALUED = new Set(["--port", "--host", "--agent", "--machine", "--url", "--name", "--code", "--fingerprint"]);
const words = commandLine();
const plain = words.filter((a, i) => !a.startsWith("-") && !VALUED.has(words[i - 1]));
const first = plain[0];
/** bin's own commands: `filament help` names them in the whole help, as --help does. */
const OWN = ["start", "print-key", "where", "doctor"];
if (((has("-h") || has("--help")) && (!first || first === "start")) || (first === "help" && (!plain[1] || OWN.includes(plain[1])))) {
  const { commandsHelp } = await import("../src/cli/main.js");
  console.log(`Filament ${VERSION}

Usage: filament [command] [options]

Run Filament:
  start (default)   Run Filament (model endpoints, the harness and the console)
  print-key         Print the inbound API key agents must use (masked; --reveal at a terminal prints it whole)
  where             Print the data directory and config file path
  doctor            Check the config, the running server and every coding agent; add --turn for one real
                    one-word turn per agent (costs a little), --agent <id> for one agent only

Drive the Filament that runs (filament help <command> says more; --json gives the answer as JSON):
${commandsHelp()}

Options:
  --port <n>        Listen port (overrides config; 0 picks a free port)
  --host <h>        Listen host (overrides config)
  --machine <name>  Drive a connected machine's Filament (filament connect connects one; --url <address> names it by
                    its address; env FILAMENT_MACHINE)
  --data-dir <p>    Data directory (default: a Filament folder under your user profile, Filament-dev when run from a
                    git checkout; env FILAMENT_DATA_DIR)
  --open            Open Filament in the browser after start: the harness once a model can answer, the console before
  -v, --version     Print version

Exit codes: 0 done, 1 failed, 2 typed wrong, 3 no Filament answers, 4 needs you (a terminal, a browser),
5 busy (a turn runs), 6 another Filament of the data folder starts or runs (filament start), 130 stopped.
`);
// `filament update --version <v>` names a release: that --version is update's own.
} else if ((has("-v") || has("--version")) && first !== "update") console.log(VERSION);
else {
  const dataDir = resolveDataDir(opt("--data-dir"));
  const cmd = first || "start";
  if (cmd === "print-key") {
    // The key whole only to a person at a terminal who asks: an agent's run of it, or a log, gets it masked.
    const { config } = loadConfig(dataDir);
    const k = config.server.inboundKeys[0] || "";
    console.log(!k ? "(no key configured)" : has("--reveal") && process.stdout.isTTY ? k : `${k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "…"} (--reveal at a terminal prints it whole)`);
  }
  else if (cmd === "where") { const { file } = loadConfig(dataDir); console.log(`data dir:    ${dataDir}\nconfig file: ${file}`); }
  else if (cmd === "doctor") { const { runDoctor, formatDoctor } = await import("../src/doctor.js"); const report = await runDoctor({ dataDir, turn: has("--turn"), agentFilter: opt("--agent") || null }); console.log(formatDoctor(report)); process.exitCode = report.summary.fail ? 1 : 0; }
  else if (cmd === "start") await start(dataDir);
  else {
    const { runCli } = await import("../src/cli/main.js");
    const code = await runCli(commandLine(), { dataDir });
    if (code == null) { console.error(`filament: no command "${cmd === "help" ? plain[1] : cmd}" — filament --help lists them`); process.exitCode = 2; }
    else process.exitCode = code;
  }
}

/** Run Filament from `dataDir` until a signal stops it. @param {string} dataDir */
async function start(dataDir) {
  // The CLI installs memory's engine by itself when memory is on and it is missing (HarnessV3-AtHome AH-D2).
  let port;
  try { port = has("--port") ? portOption(opt("--port")) : undefined; } catch (/** @type {any} */ e) { console.error(`Filament: ${e.message}`); process.exit(2); }
  // Where systemd's unit runs this data folder's Filament (filament service install), it is started through systemctl —
  // not run here beside it, where systemd would not restart it after a crash, nor stop it. Not where systemd or the app
  // runs this very start: FILAMENT_SUPERVISOR says so.
  if (process.platform === "linux" && !process.env.FILAMENT_SUPERVISOR) {
    const { startUnit } = await import("../src/cli/service.js");
    const flags = { ...(has("--port") ? { port: String(opt("--port")) } : {}), ...(has("--host") ? { host: String(opt("--host")) } : {}) };
    try {
      if (await startUnit({ dataDir, flags, out: (s) => console.log(s) })) return;
    } catch (/** @type {any} */ e) {
      console.error(`filament start: ${e?.message || e}`);
      process.exitCode = typeof e?.code === "number" ? e.code : 1;
      return;
    }
  }
  // What starts Filament again once it stops: the tray says so as it starts it. Taken out of the environment here, so a
  // program Filament runs (an agent's shell, a test of its own) never inherits it.
  const supervisor = process.env.FILAMENT_SUPERVISOR || null;
  delete process.env.FILAMENT_SUPERVISOR;
  // One Filament per data folder, from before it opens anything there: a second start while the first still opens memory,
  // before it listens, raced it on the folder's files (the hunt on x46). Its end lets the lock go; one killed leaves a lock
  // whose process is gone, which the next start takes over.
  const { STARTED_ALREADY, takeStartLock } = await import("../src/cli/listening.js");
  const lock = takeStartLock(dataDir);
  if (!lock.ok) {
    console.error(`Filament: another Filament of this data folder ${lock.pid ? `(pid ${lock.pid}) ` : ""}is starting or runs, so this one does not start: \`filament status\` says how it stands. Where no Filament runs, delete ${lock.file} and start again.`);
    process.exit(STARTED_ALREADY);
  }
  process.on("exit", lock.release);
  // What an Electron program sets for itself — the desktop app, or a VS Code or Cursor terminal Filament was started from —
  // goes the same way: a program Filament runs would start as plain Node by it (HarnessV3-Native NA-D5).
  dropElectronVars(process.env);
  const { createApp } = await import("../src/server.js");
  // A config that does not read fails here, before anything listens: said in one line, as a start that fails is, so the
  // desktop app's "could not start" shows the cause and not a stack (HarnessV3-Native NA2).
  /** @type {ReturnType<typeof createApp>} */
  let app;
  try {
    app = createApp({ dataDir, overrides: { port, host: opt("--host") }, autoInstall: true, supervisor, telemetry: true });
  } catch (/** @type {any} */ e) {
    console.error(`Filament failed to start: ${e?.message || e}`);
    process.exit(1);
  }
  // Run by the tray or the desktop app, what it prints is kept in a log nobody reads it from: the key is not written whole
  // there (`print-key` gives it).
  const keyWords = (/** @type {string | undefined} */ k) => (!k ? "(none)" : !supervisor ? k : `${k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "…"} (print-key shows it whole)`);
  app.start().then(({ host, port, created, configFile, answering, engine, lan }) => {
    // A wildcard host is reached as localhost; an IPv6 address goes in brackets, as a URL writes it.
    const url = `http://${host === "0.0.0.0" || host === "::" ? "localhost" : host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;
    console.log(`Filament ${VERSION} listening on ${url}`);
    console.log(`  harness     : ${url}/ui/harness.html`);
    console.log(`  console     : ${url}/`);
    console.log(`  anthropic   : ${url}/v1/messages`);
    console.log(`  openai      : ${url}/v1/chat/completions`);
    console.log(`  inbound key : ${keyWords(app.config.server.inboundKeys[0])}`);
    console.log(`  config      : ${configFile}${created ? " (created with defaults)" : ""}`);
    // Reach this machine on my network (Settings › Remote access): its addresses and the certificate a browser shows.
    if (lan?.listening) console.log(`  network     : ${lan.addresses.join(", ") || `port ${lan.listening.port}, on no network yet`} (certificate ${lan.fingerprint})`);
    else if (lan?.error) console.log(`  network     : not listening: ${lan.error}`);
    if (engine?.state === "installing") console.log("  memory      : installing its engine in the background; the console shows how far it is");
    if (!answering) console.log("  no model can answer yet: run `filament setup`, or open the console and connect one (Home → Get started).");
    // Anonymous usage stats, said once (services/telemetry.js): read in a terminal, this is the notice; run by the
    // desktop app or systemd, nobody reads these lines, and the harness's notice says it instead.
    if (app.telemetry.view().why === "notice" && supervisor !== "desktop") {
      console.log("  telemetry   : anonymous usage stats are on (counts only, never prompts, code, paths or keys; https://filamentdev.com/telemetry). `filament settings set telemetry.enabled false` turns them off.");
      if (!supervisor && process.stdout.isTTY) app.telemetry.told();
    }
    const door = frontDoorUrl(url, answering);
    if (has("--open")) { const c = process.platform === "win32" ? ["cmd", ["/c", "start", "", door]] : process.platform === "darwin" ? ["open", [door]] : ["xdg-open", [door]]; try { spawn(c[0], c[1], { detached: true, stdio: "ignore" }).unref(); } catch {} }
  }).catch((e) => { console.error(`Filament failed to start: ${e.message}`); process.exit(1); });

  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { app.stop().finally(() => process.exit(0)); });
  // A bug in one request must not take every agent session and the dashboard down with it. Log and keep serving.
  process.on("uncaughtException", (e) => { console.error(`[Filament] ${new Date().toISOString()} ERROR uncaught: ${e?.stack || e}`); });
  process.on("unhandledRejection", (e) => { console.error(`[Filament] ${new Date().toISOString()} ERROR unhandled rejection: ${e?.stack || e}`); });
}
