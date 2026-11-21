#!/usr/bin/env node
// @ts-check
// `npm run dist:win [-- <electron-builder's flags>]`: scripts/dist.mjs for Windows — the installer and the app unpacked
// beside it in dist\windows\<version>\ — kept by its name for the scripts and the Pipeline app that run or import it.
import { join } from "node:path";
import { isMain } from "./check-memory-bundle.mjs";
import { dist } from "./dist.mjs";

export { distDir, namesPublish, versionOf } from "./dist.mjs";

/** The installer electron-builder makes, by electron-builder.yml's artifactName, its blockmap, and the latest.yml the
 *  installed app checks an update by (desktop/lib/updates.js). @param {string} out @param {string} version */
export const installerFiles = (out, version) => {
  const exe = join(out, `Filament-${version}-setup-x64.exe`);
  return [exe, `${exe}.blockmap`, join(out, "latest.yml")];
};

/** scripts/dist.mjs's build for Windows. @param {Parameters<typeof dist>[0]} [o] */
export const distWin = (o = {}) => dist({ machine: "win32", ...o, platform: "win32" });

if (isMain(import.meta.url)) process.exitCode = await dist({ platform: "win32", args: process.argv.slice(2) });
