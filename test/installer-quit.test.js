// @ts-check
// The installer asks a running Filament to quit before it installs over it (the owner's of 10-28): as the tray's Quit
// does — Filament stops its server, and asks the person while a turn runs — and only one still running a minute later
// meets electron-builder's own close (source contract: the NSIS script is run by the installer alone; the drive of
// 10-28 installed over a running test install with it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// (fails before: yes — there was no build/installer.nsh, and electron-builder's own check killed a running Filament)
test("the installer asks a running Filament to quit, waits up to a minute, and only then falls back to electron-builder's close", () => {
  const yml = read("electron-builder.yml");
  assert.match(yml, /^nsis:\n(?: {2}.*\n|\s*\n)*? {2}include: build\/installer\.nsh$/m, "electron-builder.yml's nsis includes it");
  assert.doesNotMatch(yml, /^ {2}- build\//m, "the installer's script is not packed into the app");
  const nsh = read("build/installer.nsh");
  const body = nsh.slice(nsh.indexOf("!macro customCheckAppRunning"), nsh.indexOf("!macroend"));
  assert.ok(body, "it defines customCheckAppRunning, which electron-builder's CHECK_APP_RUNNING runs in its place");
  // electron-builder includes its process-info library and declares $pid only when no custom check is defined
  assert.match(nsh, /^!include "getProcessInfo\.nsh"$/m);
  assert.match(nsh, /^Var pid$/m);
  const steps = [
    "!insertmacro IS_POWERSHELL_AVAILABLE",
    '!insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0',
    "nsExec::Exec `\"$INSTDIR\\${APP_EXECUTABLE_FILENAME}\" --quit`",
    "${Do}",
    "Sleep 500",
    '!insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0',
    "${if} $R3 >= 60000",
    "${Loop}",
    "!insertmacro _CHECK_APP_RUNNING",
  ];
  let at = 0;
  for (const s of steps) {
    const i = body.indexOf(s, at);
    assert.ok(i >= 0, `in order: ${s}`);
    at = i + s.length;
  }
  assert.doesNotMatch(body, /KILL_PROCESS/, "it never closes Filament by force itself");
});

// (fails before: yes — an install over one keeps the shortcuts that stand, stamped with the app id they were made with
// (filament.desktop), while the app now sets com.filamentdev.desktop: the taskbar's pin opened a second button)
test("an install stamps the Start menu's, the desktop's and the taskbar pin's shortcut with the app's id, where each is there", () => {
  const nsh = read("build/installer.nsh");
  const body = nsh.slice(nsh.indexOf("!macro customInstall"), nsh.indexOf("!macroend", nsh.indexOf("!macro customInstall")));
  for (const link of ["$newStartMenuLink", "$newDesktopLink", "$APPDATA\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\\${SHORTCUT_NAME}.lnk"]) {
    const esc = link.replace(/[$\\{}.]/g, (c) => `\\${c}`);
    assert.match(body, new RegExp(`\\$\\{if\\} \\$\\{FileExists\\} "${esc}"\\n\\s+WinShell::SetLnkAUMI "${esc}" "\\$\\{APP_ID\\}"\\n\\s+\\$\\{endIf\\}`), link);
  }
  assert.match(read("electron-builder.yml"), /^appId: com\.filamentdev\.desktop$/m, "the id the app sets (logon.js appIdOf)");
});

test("the app the installer asks: a --quit launch tells the running one to quit, and with none running does nothing and ends", () => {
  const main = read("desktop/main.js");
  assert.match(main, /if \(!app\.requestSingleInstanceLock\(\)\) \{\n[^\n]*\n {2}app\.quit\(\);\n\} else if \(process\.argv\.includes\("--quit"\)\) \{\n[^\n]*\n {2}app\.exit\(0\);/);
  assert.match(main, /if \(argv\.includes\("--quit"\)\) return void quit\(\);/);
});
