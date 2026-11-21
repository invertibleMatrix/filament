// @ts-check
// The login shell's PATH for the app a Finder or a desktop launcher started (desktop/lib/shell-path.js): read between
// its marks whatever a profile prints, merged in front of the app's own, never on Windows, and a shell that fails or
// hangs leaves the app's own. The real shell's read runs where there is one (macOS, Linux).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loginShell, mergedPath, pathBetween, readShellPath, SHELL_PATH_MS } from "../desktop/lib/shell-path.js";

const MARK = "__FILAMENT_PATH__";

// (fails before: yes — the owner's of 11-08: the Mac app opened from the Finder said every coding agent "needs npm",
// which ran in the Terminal: the app had launchd's PATH, not the shell's)
test("the login shell's PATH: asked interactive and as a login, read between its marks past what a profile prints, its folders first", async () => {
  /** @type {any[]} */
  const asked = [];
  const r = await readShellPath({
    env: { SHELL: "/bin/zsh", PATH: "/usr/bin:/bin", HOME: "/Users/ada" },
    platform: "darwin",
    run: async (file, args, o) => (asked.push({ file, args, o }), `Welcome back, Ada!\n\u001b[1m%\u001b[0m ${MARK}/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin\n${MARK}bye\n`),
  });
  assert.deepEqual(r, { path: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", shell: "/bin/zsh" });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].file, "/bin/zsh");
  assert.equal(asked[0].args[0], "-ilc");
  assert.match(asked[0].args[1], /\/usr\/bin\/printenv PATH/);
  assert.equal(asked[0].o.timeout, SHELL_PATH_MS);
  assert.deepEqual([asked[0].o.env.DISABLE_AUTO_UPDATE, asked[0].o.env.ZSH_TMUX_AUTOSTART, asked[0].o.env.HOME], ["true", "false", "/Users/ada"], "its profile can't stop to ask, and is the person's");
  // merged: the shell's first, in its order, then the app's own it lacks; each folder once
  assert.equal(mergedPath(r.path, "/usr/bin:/bin:/usr/sbin:/sbin::/usr/bin"), "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  assert.equal(mergedPath("/a:/b", undefined), "/a:/b");
});

test("no PATH read on Windows, nor kept from a shell that fails, hangs or prints none: the app's own stands, and why is said", async () => {
  assert.deepEqual(await readShellPath({ platform: "win32", run: () => assert.fail("a shell was run") }), { path: "", shell: "", why: "Windows hands an app the whole PATH" });
  const linux = { env: { SHELL: "/bin/bash" }, platform: /** @type {NodeJS.Platform} */ ("linux") };
  assert.deepEqual(await readShellPath({ ...linux, run: async () => "no marks here\n" }), { path: "", shell: "/bin/bash", why: "it printed no PATH" });
  assert.deepEqual(await readShellPath({ ...linux, run: async () => `${MARK}  ${MARK}` }), { path: "", shell: "/bin/bash", why: "it printed no PATH" });
  const hung = Object.assign(new Error("Command failed"), { killed: true, signal: "SIGKILL" });
  assert.deepEqual(await readShellPath({ ...linux, timeoutMs: 2000, run: async () => { throw hung; } }), { path: "", shell: "/bin/bash", why: "it took over 2 s" });
  assert.deepEqual(await readShellPath({ ...linux, run: async () => { throw new Error("spawn /bin/bash ENOENT\nmore"); } }), { path: "", shell: "/bin/bash", why: "spawn /bin/bash ENOENT" });
  assert.equal(pathBetween(`${MARK}/a:/b`), "", "one mark is no answer");
});

test("the shell asked: SHELL where it is a path, else the account's, else the system's", () => {
  const none = () => "";
  assert.equal(loginShell({ SHELL: "/opt/homebrew/bin/fish" }, "darwin", none), "/opt/homebrew/bin/fish");
  assert.equal(loginShell({ SHELL: "zsh" }, "darwin", () => "/bin/bash"), "/bin/bash", "a bare name is not a shell to start");
  assert.equal(loginShell({}, "darwin", none), "/bin/zsh");
  assert.equal(loginShell({}, "linux", () => { throw new Error("no passwd entry"); }), "/bin/sh");
});

// (fails before: yes — the server and what it runs inherit the app's environment at its start)
test("the app reads the shell's PATH as it starts and puts it in place before the server starts", () => {
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  const body = main.slice(main.indexOf("async function run()"));
  const read = body.indexOf("readShellPath()"), ready = body.indexOf("await app.whenReady()"), put = body.indexOf("process.env.PATH = mergedPath("), server = body.indexOf("createSupervisor(");
  assert.ok(read > 0 && read < ready, "read while Electron gets ready");
  assert.ok(put > ready && put < server, "in place before the server's supervisor");
});

const bash = ["/bin/bash", "/usr/bin/bash"].find((f) => existsSync(f));
test("a real login shell: its profile's PATH read past what the profile prints", { skip: process.platform === "win32" || !bash ? "no POSIX login shell here" : false }, async () => {
  const home = mkdtempSync(join(tmpdir(), "filament-shell-path-"));
  try {
    writeFileSync(join(home, ".bash_profile"), 'echo "Welcome to the test profile"\nexport PATH="/opt/filament-test/bin:$PATH"\n');
    const r = await readShellPath({ env: { SHELL: bash, HOME: home, PATH: "/usr/bin:/bin" }, platform: process.platform });
    assert.equal(r.shell, bash);
    assert.match(r.path, /^\/opt\/filament-test\/bin:/, r.why);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
