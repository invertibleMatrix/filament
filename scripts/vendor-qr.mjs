// @ts-check
// Vendors the QR encoder Settings › Remote access draws a pairing link's code with (the remote desk of 11-22, s4e):
// qrcode-generator, Kazuhiko Arase's, MIT, at the exact version below — its ES module copied verbatim into
// `src/ui/harness/vendor/qr/qrcode.mjs`, and its licence beside it (the package ships its MIT notice in the module's
// head, and no LICENSE file: the one written here is that notice's licence, its copyright line as the module says it).
// The served page never reads node_modules. Installs the package into a temporary folder of its own (never the project's
// node_modules), or reads an install already made: `node scripts/vendor-qr.mjs [--from <folder>]`.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src", "ui", "harness", "vendor", "qr");

const PACKAGE = "qrcode-generator";
const VERSION = "2.0.4";
/** The copyright line its module's head says, which its licence carries. */
const COPYRIGHT = "Copyright (c) 2009 Kazuhiko Arase";

const fromAt = process.argv.indexOf("--from");
const named = fromAt < 0 ? "" : String(process.argv[fromAt + 1] || "");
if (fromAt >= 0 && (!named || named.startsWith("--"))) {
  console.error("usage: node scripts/vendor-qr.mjs [--from <folder>] — --from names the folder whose node_modules holds the package");
  process.exit(2);
}
const made = fromAt < 0 ? mkdtempSync(join(tmpdir(), "filament-qr-")) : null;
const from = made || named;
if (made) {
  writeFileSync(join(made, "package.json"), JSON.stringify({ name: "filament-qr", private: true }));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npm, ["install", "--no-audit", "--no-fund", "--ignore-scripts", `${PACKAGE}@${VERSION}`], { cwd: made, stdio: "inherit", shell: process.platform === "win32" });
}
const pkg = join(from, "node_modules", PACKAGE);
const had = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
if (had.version !== VERSION) throw new Error(`${PACKAGE} is ${had.version} in ${pkg}, and Filament vendors ${VERSION}`);
if (had.license !== "MIT") throw new Error(`${PACKAGE} ${VERSION} says its licence is ${had.license}, not MIT`);
const code = readFileSync(join(pkg, "dist", "qrcode.mjs"), "utf8");
if (!code.includes(COPYRIGHT) || !code.includes("Licensed under the MIT license")) throw new Error(`${PACKAGE}'s module no longer says ${COPYRIGHT} under the MIT licence`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync(join(pkg, "dist", "qrcode.mjs"), join(out, "qrcode.mjs"));
writeFileSync(
  join(out, "LICENSE"),
  `The MIT License (MIT)

${COPYRIGHT}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

The word 'QR Code' is a registered trademark of DENSO WAVE INCORPORATED.
`,
);
if (made) rmSync(made, { recursive: true, force: true });
console.log(`${PACKAGE} ${VERSION} → ${out}`);
