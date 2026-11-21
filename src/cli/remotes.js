// @ts-check
// The Filaments on other machines this command line drives (the owner's remote Filament of 11-06, Part 1): kept in
// <dataDir>/remotes.json by services/machines/remotes.js, which this Filament's own agents read too (src/app never
// imports the command line) — said here still for the commands and the desktop app, which import it from here. What is
// the command line's alone stays: which machine a command names.
import { CliError, EXIT } from "./client.js";

export {
  REMOTES_FILE,
  certRefused,
  connectRemote,
  connectTo,
  disconnect,
  machineAt,
  onThisMachine,
  pairingOf,
  plainWords,
  readRemotes,
  remoteNamed,
  shownRemote,
} from "../services/machines/remotes.js";
/** @typedef {import("../services/machines/remotes.js").Remote} Remote */

/** The machine a command line names (`--machine`, `--url`, FILAMENT_MACHINE), or null for this machine's own Filament. @param {Record<string, string | true>} flags */
export function machineOf(flags) {
  for (const k of ["machine", "url"]) {
    if (flags[k] === true) throw new CliError(`--${k} names a connected machine: \`filament machines\` lists them`, EXIT.usage);
    if (typeof flags[k] === "string" && flags[k]) return /** @type {string} */ (flags[k]);
  }
  return process.env.FILAMENT_MACHINE || null;
}
