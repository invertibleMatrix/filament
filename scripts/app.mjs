#!/usr/bin/env node
// Open the harness as its own window (tray/filament-app.ps1): a Chromium app window over the running server — the same
// page the browser tab shows, so a fix in the tree is live there on the next reload. Windows-only (Edge/Chrome app
// mode); elsewhere this prints the URL to open in a browser and starts nothing.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32") {
  console.error("The app window is Windows-only (it drives Edge/Chrome app mode through PowerShell).");
  console.error("Open http://127.0.0.1:<port>/ui/harness.html in a browser instead (`npm start` first; the port is server.port in your config, 20300 by default).");
  process.exit(0);
}
const ps = process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : "powershell.exe";
const p = spawn(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "tray", "filament-app.ps1"), ...process.argv.slice(2)], { stdio: "inherit" });
p.on("error", (e) => { console.error(`could not open the app window: ${e.message}`); process.exit(1); });
p.on("exit", (code) => process.exit(code ?? 0));
