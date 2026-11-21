// @ts-check
// A program Filament starts by a bare name is the PATH's. On Windows a bare name is looked for in the folder the
// program runs in before the PATH (Node's spawn, as cmd.exe): `git`, `rg`, an MCP server's `npx` or a coding agent
// started in a project's folder would start that folder's git.exe, and a name nothing on the PATH answers to would
// start the folder's <name>.exe. A folder Filament opens may be anyone's. Windows has a switch that takes the folder
// out of that search, read from the starting process's own environment: NoDefaultCurrentDirectoryInExePath. It is set
// here, for this process, as the module is first imported: whatever starts Filament imports it before anything else
// (bin/filament.js, src/server.js). A program in a folder is then started only by its path (`./tools/server.cmd`), as
// shell.js `programSpawn` reads one. Where the person's own environment has the switch, it stands as theirs.
// The switch is Filament's own, and known by its value: a process that is handed Filament's whole environment — a
// coding agent, git — is handed it without (`withoutOwnSwitch`), so a shell an agent runs finds a folder's program by
// its name as it does when the person starts that agent themselves. Elsewhere than Windows a bare name is the PATH's
// already, and nothing is set.

/** Windows' switch: with it in a process's environment, a program it starts by a bare name is not looked for in the folder it runs in. */
export const FOLDER_SWITCH = "NoDefaultCurrentDirectoryInExePath";
/** The value Filament sets it to — Windows reads only that it is there —: what tells its own from the person's, in any thread's copy of the environment. */
export const OWN_VALUE = "filament";

/** The key `env` holds the switch under, in any case, as Windows names a variable. @param {Record<string, string | undefined>} env */
const keyIn = (env) => Object.keys(env).find((k) => k.toLowerCase() === FOLDER_SWITCH.toLowerCase());

/**
 * The switch set in `env` where it is Windows' and holds none. → whether it was set here.
 * @param {Record<string, string | undefined>} [env] @param {string} [platform]
 */
export function pathProgramsOnly(env = process.env, platform = process.platform) {
  if (platform !== "win32" || keyIn(env)) return false;
  env[FOLDER_SWITCH] = OWN_VALUE;
  return true;
}

/** Whether the switch was set as this module was first imported: false where the person's environment had it, and elsewhere than Windows. */
export const SET_HERE = pathProgramsOnly();

/**
 * A copy of Filament's environment as a process it starts is handed it: without the switch where it is Filament's own.
 * @template {Record<string, string | undefined>} E
 * @param {E} env @returns {E}
 */
export function withoutOwnSwitch(env) {
  const k = keyIn(env);
  if (k && env[k] === OWN_VALUE) delete env[k];
  return env;
}
