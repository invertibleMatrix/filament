// A stand-in for npm's `install --global|-g [--prefix <folder>] <package>[@<version>]` (HarnessV3-ACP AC3-8's tests
// and looks). It lays the folder out as npm does — on Windows `<prefix>/<command>.cmd`, npm's shim, beside
// `<prefix>/node_modules/<package>`; elsewhere `<prefix>/bin/<command>` beside `<prefix>/lib/node_modules/<package>` —
// and the package's one command runs the fake ACP agent, with this Node: its script in `dist/`, under a package.json of
// the build's own without a name, as a package's build often is. Without --prefix it installs into
// FAKE_NPM_PREFIX, the test's folder on the PATH, as npm's global folder. It says what it does as npm does, a little
// at a time.
// FAKE_NPM_BIN: the command's name (the package's name without its scope otherwise). FAKE_NPM_FAIL: it says npm's 404
// and ends with code 1. FAKE_NPM_WAIT: it waits, its install half done, until it's stopped. FAKE_NPM_LOG: a JSONL file
// each run appends its arguments and the variables an install reads to.
import { appendFileSync, chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AGENT = join(dirname(fileURLToPath(import.meta.url)), "fake-acp-agent.mjs");
const argv = process.argv.slice(2);
const win = process.platform === "win32";
const say = (/** @type {string} */ s) => process.stdout.write(`${s}\r\n`);
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
if (process.env.FAKE_NPM_LOG) appendFileSync(process.env.FAKE_NPM_LOG, `${JSON.stringify({ argv, cwd: process.cwd(), pid: process.pid })}\n`);

if (argv[0] !== "install" || !(argv.includes("--global") || argv.includes("-g"))) {
  say(`npm ERR! the stand-in installs with install --global only, not: ${argv.join(" ")}`);
  process.exit(1);
}
const at = argv.indexOf("--prefix");
const prefix = at >= 0 ? argv[at + 1] : process.env.FAKE_NPM_PREFIX;
const spec = argv.filter((a, i) => !a.startsWith("-") && (at < 0 || i !== at + 1) && i > 0).at(-1) || "";
const m = /^((?:@[^/@]+\/)?[^@]+)(?:@(.+))?$/.exec(spec);
if (!prefix || !m) {
  say(`npm ERR! nothing to install: ${argv.join(" ")}`);
  process.exit(1);
}
const [, pkg, version = "1.0.0"] = m;
say(`npm http fetch GET 200 https://registry.npmjs.org/${pkg} 12ms`);
await sleep(150);
if (process.env.FAKE_NPM_FAIL) {
  say(`npm ERR! code E404`);
  say(`npm ERR! 404 Not Found - GET https://registry.npmjs.org/${pkg} - Not found`);
  process.exit(1);
}
const root = win ? join(prefix, "node_modules", pkg) : join(prefix, "lib", "node_modules", pkg);
mkdirSync(root, { recursive: true });
if (process.env.FAKE_NPM_WAIT) {
  say("npm http fetch GET 200 https://registry.npmjs.org/ (waiting)");
  setInterval(() => {}, 60_000);
  await new Promise(() => {});
}
const bin = process.env.FAKE_NPM_BIN || pkg.split("/").pop() || pkg;
writeFileSync(join(root, "package.json"), JSON.stringify({ name: pkg, version, bin: { [bin]: "dist/bin.mjs" } }, null, 2));
mkdirSync(join(root, "dist"));
writeFileSync(join(root, "dist", "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(join(root, "dist", "bin.mjs"), `#!${process.execPath}\nimport ${JSON.stringify(pathToFileURL(AGENT).href)};\n`);
if (win) {
  // npm's own shim, cut to the line its readers read: the script it runs with Node, under `%dp0%`.
  const rel = join("node_modules", pkg, "dist", "bin.mjs").replace(/\//g, "\\");
  writeFileSync(join(prefix, `${bin}.cmd`), `@ECHO off\r\nSETLOCAL\r\nSET dp0=%~dp0\r\nnode  "%dp0%\\${rel}" %*\r\n`);
} else {
  mkdirSync(join(prefix, "bin"), { recursive: true });
  chmodSync(join(root, "dist", "bin.mjs"), 0o755);
  symlinkSync(join(root, "dist", "bin.mjs"), join(prefix, "bin", bin));
}
await sleep(100);
say(`added 1 package in 0.3s`);
