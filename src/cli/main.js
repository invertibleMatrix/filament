// @ts-check
// `filament <command>` (the owner's of 11-05: "a full Filament CLI that drives and controls Filament... setup, connecting
// API keys, helping noob users"): the commands past `start`, each run against the Filament its data folder names, its
// words for a person and its exit code for a script or an agent (client.js `EXIT`). `filament help <command>` says one;
// `--json` gives a command's answer as JSON where it has one. A command ends by setting its code, never `process.exit`
// (bin/filament.js): an agent's process or a timer still closing would trip Node's teardown on Windows.
import { CliError, EXIT } from "./client.js";
import { processTerm } from "./ask.js";
import { COMMANDS } from "./commands.js";

/**
 * A command line's words and flags: `--name value`, `--name=value`, and the flags `booleans` names alone.
 * @param {readonly string[]} argv @param {ReadonlySet<string>} booleans
 * @returns {{ words: string[], flags: Record<string, string | true> }}
 */
export function parseArgs(argv, booleans) {
  /** @type {string[]} */
  const words = [];
  /** @type {Record<string, string | true>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      words.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) flags[name] = a.slice(eq + 1);
      else if (booleans.has(name) || i + 1 >= argv.length || argv[i + 1].startsWith("--")) flags[name] = true;
      else flags[name] = argv[++i];
    } else if (a === "-h") flags.help = true;
    else words.push(a);
  }
  return { words, flags };
}

/** Flags every command takes alone. */
const GLOBAL_BOOLEANS = ["json", "help", "yes", "key-stdin", "no-test", "also", "force", "reveal", "turn", "no-open", "open", "view", "check", "back", "wait"];

/**
 * The commands' list, as `filament --help` gives it after `start`'s.
 */
export function commandsHelp() {
  const w = Math.max(...COMMANDS.map((c) => c.usage.length));
  return COMMANDS.map((c) => `  ${c.usage.padEnd(w)}  ${c.summary}`).join("\n");
}

/** One command's help. @param {typeof COMMANDS[number]} c */
const oneHelp = (c) => [`Usage: filament ${c.usage}`, "", c.summary, ...(c.more ? ["", c.more] : [])].join("\n");

/**
 * Run a command line past `start` (bin/filament.js): → its exit code. Null where it is none of these commands — bin's own
 * (start, print-key, where, doctor).
 * @param {readonly string[]} argv  the words after `filament`
 * @param {{ dataDir: string, term?: import("./ask.js").Term, out?: (s: string) => void, err?: (s: string) => void, write?: (s: string) => void, quietMs?: number }} o
 *   `quietMs`: how long a chat's reply may say nothing before the command says so and ends (commands.js `QUIET_MS`)
 * @returns {Promise<number | null>}
 */
export async function runCli(argv, { dataDir, term = processTerm(), out = (s) => console.log(s), err = (s) => console.error(s), write = (s) => void process.stdout.write(s), quietMs }) {
  const { words, flags } = parseArgs(argv, new Set(GLOBAL_BOOLEANS));
  const [name, ...rest] = words;
  if (name === "help") {
    if (!rest[0]) {
      out(`Usage: filament <command> — filament --help says all of it, start's own options too.\n\n${commandsHelp()}`);
      return EXIT.ok;
    }
    const c = COMMANDS.find((x) => x.name === rest[0]);
    if (!c) return null;
    out(oneHelp(c));
    return EXIT.ok;
  }
  const c = COMMANDS.find((x) => x.name === name);
  if (!c) return null;
  if (flags.help === true) {
    out(oneHelp(c));
    return EXIT.ok;
  }
  // Ctrl+C ends the command where it waits — a sign-in, a reply streaming, Filament starting —, with exit 130: its
  // waits and calls take the signal (the review of 9fc83b83a: it ended as Windows kills a process, 0xC000013A).
  const stop = new AbortController();
  const onInt = () => stop.abort();
  process.on("SIGINT", onInt);
  try {
    return (await c.run({ words: rest, flags, dataDir, term, out, err, write, signal: stop.signal, quietMs })) ?? EXIT.ok;
  } catch (/** @type {any} */ e) {
    if (e instanceof CliError) {
      err(`filament ${name}: ${e.message}`);
      return e.code;
    }
    if (stop.signal.aborted) {
      err(`filament ${name}: Stopped.`);
      return EXIT.interrupted;
    }
    err(`filament ${name}: ${e?.message || e}`);
    return EXIT.failed;
  } finally {
    process.off("SIGINT", onInt);
  }
}
