// A stand-in for uv's `tool install --force <package>==<version>` (HarnessV3-ACP AC3-8's tests and looks). It makes the
// tool's folder in UV_TOOL_DIR and its command in UV_TOOL_BIN_DIR, named as the package: Node under that name — on
// Windows `<package>.exe`, a hard link to Node's own program (a copy where a link can't be made), elsewhere a link —
// so the arguments the registry gives the agent name the script it runs. It says what it does as uv does.
// FAKE_UV_FAIL: it says uv's refusal and ends with code 2. FAKE_UV_LOG: a JSONL file each run appends its arguments and
// its tool folders to.
import { appendFileSync, copyFileSync, linkSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const say = (/** @type {string} */ s) => process.stdout.write(`${s}\r\n`);
const { UV_TOOL_DIR: tools = "", UV_TOOL_BIN_DIR: bin = "" } = process.env;
if (process.env.FAKE_UV_LOG) appendFileSync(process.env.FAKE_UV_LOG, `${JSON.stringify({ argv, tools, bin, pid: process.pid })}\n`);

const spec = argv.at(-1) || "";
const m = /^([A-Za-z0-9][\w.-]*)(?:==|@)v?(.+)$/.exec(spec);
if (argv[0] !== "tool" || argv[1] !== "install" || !m || !tools || !bin) {
  say(`error: the stand-in installs a tool, at a version, into UV_TOOL_DIR and UV_TOOL_BIN_DIR only: ${argv.join(" ")}`);
  process.exit(2);
}
const [, pkg, version] = m;
say(`Resolved 1 package in 12ms`);
if (process.env.FAKE_UV_FAIL) {
  say(`error: No solution found when resolving dependencies:`);
  say(`  Because ${pkg} was not found in the package registry and you require ${pkg}==${version}, we can conclude that your requirements are unsatisfiable.`);
  process.exit(2);
}
mkdirSync(join(tools, pkg), { recursive: true });
writeFileSync(join(tools, pkg, "uv-receipt.toml"), `[tool]\nrequirements = [{ name = "${pkg}", specifier = "==${version}" }]\n`);
mkdirSync(bin, { recursive: true });
const command = join(bin, process.platform === "win32" ? `${pkg}.exe` : pkg);
if (process.platform === "win32") {
  try {
    linkSync(process.execPath, command);
  } catch {
    copyFileSync(process.execPath, command);
  }
} else symlinkSync(process.execPath, command);
say(`Installed 1 executable: ${pkg}`);
