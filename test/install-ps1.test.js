// @ts-check
// scripts/install.ps1: Filament for a Windows host in one command — `irm …/releases/latest/download/install.ps1 | iex`.
// Windows PowerShell 5.1 (and PowerShell 7, where it is installed) runs it here by -File, by `irm … | iex` as a one-shot
// -Command and as a person types it, against a releases folder served from this process: the script itself, as GitHub
// serves a release's asset, latest-server-win32-x64.yml as scripts/dist-server.mjs writes it, and small tarballs by its
// own tar writer, each with a filament.cmd that says its version. LOCALAPPDATA is a throwaway folder, and
// FILAMENT_NO_MODIFY_PATH=1 leaves the user's PATH (the registry's) as it is: OnPath runs against a key of its own.
// Windows alone.
// (fails before: yes — there was no install.ps1: a Windows host had the tarball to fetch, check and unpack by hand)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { feedName, feedOf, MARKER, tarballName, topOf, writeTarGz } from "../scripts/dist-server.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "install.ps1");
const WIN = process.platform === "win32";
const TARGET = "win32-x64";
const FEED = feedName(TARGET);
const SYSTEM = join(process.env.SystemRoot || "C:\\Windows", "System32");
const GITHUB = "https://github.com/invertibleMatrix/filament/releases";

/** The PowerShells that run it here: Windows PowerShell 5.1, and PowerShell 7 where it is installed. */
const SHELLS = WIN
  ? [
      { name: "Windows PowerShell 5.1", file: join(SYSTEM, "WindowsPowerShell", "v1.0", "powershell.exe") },
      ...[join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe")].filter((f) => existsSync(f)).map((file) => ({ name: "PowerShell 7", file })),
    ]
  : [];

/** A throwaway folder. @param {string} [tag] */
const tmp = (tag = "") => mkdtempSync(join(tmpdir(), `filament-install-ps1-${tag}`));

/** A file's SHA-512, base64, as the yml gives it. @param {string | Buffer} body */
const sha512Of = (body) => createHash("sha512").update(body).digest("base64");

/** Windows' line ends made \n, for words compared whole. @param {string} s */
const lf = (s) => s.replace(/\r\n/g, "\n");

/**
 * What is under `dir`, to see a run changed nothing: each entry by its path, a junction with what it points at and
 * when it was made, a file with its size and time. A folder's own time is left out: a refused run's folder came and
 * went in it.
 * @param {string} dir @returns {string[]}
 */
function treeAt(dir, at = "") {
  if (!existsSync(join(dir, at))) return [];
  /** @type {string[]} */
  const out = [];
  for (const n of readdirSync(join(dir, at)).sort()) {
    const rel = at ? `${at}/${n}` : n,
      st = lstatSync(join(dir, rel));
    if (st.isSymbolicLink()) out.push(`${rel} -> ${readlinkSync(join(dir, rel))} ${st.mtimeMs}`);
    else if (st.isDirectory()) out.push(`${rel}/`, ...treeAt(dir, rel));
    else out.push(`${rel} ${st.size} ${st.mtimeMs}`);
  }
  return out;
}

/** A program that keeps `dir` open as its working folder, as a running Filament keeps its version's, until stopped. @param {string} dir */
function holding(dir) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: dir, stdio: "ignore", windowsHide: true });
  return {
    stop: () =>
      new Promise((done) => {
        child.once("exit", () => done(null));
        child.kill();
      }),
  };
}

for (const shell of SHELLS.length ? SHELLS : [{ name: "PowerShell", file: "" }]) {
  describe(`install.ps1 by ${shell.name}`, { skip: !WIN && "Windows' own installer: Windows PowerShell runs it" }, () => {
    /** The releases folder the server serves: download/v<version>/…, and latest/download/… for the version `latest` names. */
    let rel = "";
    let latest = "";
    /** @type {string[]} */
    const hits = [];
    let url = "";
    /** @type {import("node:http").Server} */
    let server;

    before(async () => {
      rel = tmp("releases-");
      server = createServer((req, res) => {
        const path = decodeURIComponent(String(req.url || "").split("?")[0]);
        hits.push(path);
        // the script as a release's asset, as GitHub serves one; /cut/, a download of it cut short
        if (path.endsWith("/install.ps1")) {
          const text = readFileSync(SCRIPT);
          res.writeHead(200, { "content-type": "application/octet-stream" }).end(path.startsWith("/cut/") ? text.subarray(0, Math.floor(text.length / 2)) : text);
          return;
        }
        const file = path.startsWith("/latest/download/") ? join(rel, "download", `v${latest}`, path.slice("/latest/download/".length)) : join(rel, ...path.split("/").filter((p) => p && p !== ".."));
        if (!existsSync(file) || !statSync(file).isFile()) {
          res.writeHead(404).end("Not Found");
          return;
        }
        res.writeHead(200, { "content-type": "application/octet-stream" }).end(readFileSync(file));
      });
      await new Promise((done) => server.listen(0, "127.0.0.1", () => done(null)));
      url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
    });
    after(async () => {
      await new Promise((done) => server.close(() => done(null)));
      rmSync(rel, { recursive: true, force: true });
    });

    /**
     * The installer run with nothing of this process's environment but what Windows' programs need, and `env`; a PATH
     * of Windows' own folders alone, so no Filament installed here is found on it. `how`: by -File; by
     * `powershell -c "irm … | iex"`, as a script or an SSH session runs it once ("command"); or typed into a PowerShell
     * that goes on ("typed": its lines on stdin, then one saying $LASTEXITCODE). `from`: where irm fetches it.
     * @param {Record<string, string | undefined>} env @param {"file" | "command" | "typed"} [how]
     * @returns {Promise<{ code: number | null, out: string, err: string }>}
     */
    function ps(env, how = "file", from = `${url}/latest/download/install.ps1`) {
      /** @type {Record<string, string>} */
      const base = { PATH: [SYSTEM, join(SYSTEM, "WindowsPowerShell", "v1.0")].join(";"), FILAMENT_NO_MODIFY_PATH: "1" };
      // PATHEXT too: without it PowerShell takes tar.exe for a document, which it will not run in a pipeline.
      for (const k of ["SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec", "PATHEXT", "USERPROFILE", "PROCESSOR_ARCHITECTURE", "PROCESSOR_ARCHITEW6432"]) if (process.env[k]) base[k] = String(process.env[k]);
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete base[k];
        else base[k] = v;
      }
      const line = `irm ${from} | iex`;
      const args = how === "file" ? ["-NonInteractive", "-File", SCRIPT] : how === "command" ? ["-NonInteractive", "-Command", line] : [];
      return new Promise((done, fail) => {
        const child = spawn(shell.file, ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { env: base, stdio: [how === "typed" ? "pipe" : "ignore", "pipe", "pipe"], windowsHide: true });
        let out = "",
          err = "";
        child.stdout?.on("data", (d) => (out += d));
        child.stderr?.on("data", (d) => (err += d));
        child.once("error", fail);
        child.once("close", (code) => done({ code, out: lf(out), err: lf(err) }));
        if (how === "typed") child.stdin?.end(`${line}\n[Console]::Out.WriteLine('still here ' + $LASTEXITCODE)\n`);
      });
    }

    /**
     * A release of `version` for Windows hosts: the whole tarball (with an engine's file in it) and, with `small`, the
     * one without the engine; their latest-server-win32-x64.yml. Each holds a filament.cmd that says its version and
     * engine, and build-info.json as the build writes it. `damaged`: the yml gives the tarball another file's SHA-512;
     * `marker` false, a tarball without build-info.json.
     * @param {string} version @param {{ small?: boolean, damaged?: boolean, marker?: boolean }} [o]
     */
    async function release(version, { small = false, damaged = false, marker: withMarker = true } = {}) {
      const at = join(rel, "download", `v${version}`);
      mkdirSync(at, { recursive: true });
      const made = [];
      for (const engine of small ? [true, false] : [true]) {
        const name = tarballName(version, engine, TARGET);
        const marker = { kind: "server", version, target: TARGET, file: name, feed: FEED, engine, node: "v24.11.0", glibc: null, releases: { provider: "github", owner: "invertibleMatrix", repo: "filament" } };
        const entries = [
          { name: "bin/filament.cmd", mode: 0o755, body: Buffer.from(`@echo off\r\necho ${version}${engine ? "" : " no-engine"}\r\n`) },
          { name: "bin/filament.js", mode: 0o644, body: Buffer.from("console.log('filament');\n") },
          { name: "node/node.exe", mode: 0o755, body: Buffer.from("MZ") },
          ...(withMarker ? [{ name: MARKER, mode: 0o644, body: Buffer.from(`${JSON.stringify(marker, null, 2)}\n`) }] : []),
          ...(engine ? [{ name: "vendor/memory-engine/win32-x64/model.bin", mode: 0o644, body: Buffer.alloc(64 * 1024, 7) }] : []),
        ];
        const { sha512, size } = await writeTarGz(entries, join(at, name), { top: topOf(name), mtime: 1_762_560_000 });
        made.push({ name, sha512: damaged ? sha512Of("another file") : sha512, size });
      }
      writeFileSync(join(at, FEED), feedOf({ version, files: made, at: "2026-11-08T00:00:00.000Z" }));
    }

    /** A user's LOCALAPPDATA, empty, and the environment a run there gets. @param {Record<string, string>} [more] */
    function user(more = {}) {
      const at = tmp("user-");
      return { at, base: join(at, "filament"), env: { LOCALAPPDATA: at, FILAMENT_RELEASES_URL: url, ...more } };
    }

    /** The installed filament.cmd, through current, run as cmd runs it: what it printed. @param {string} base */
    const runs = (base) => {
      const r = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${join(base, "current", "bin", "filament.cmd")}" --version"`], { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };

    test("refuses in words on another machine than Windows x64, without LOCALAPPDATA, or for no version — nothing made, nothing asked for", async () => {
      const u = user();
      try {
        hits.length = 0;
        const arm = await ps({ ...u.env, PROCESSOR_ARCHITECTURE: "ARM64", PROCESSOR_ARCHITEW6432: undefined });
        assert.equal(arm.code, 1, arm.out);
        assert.equal(arm.err, `Filament for Windows hosts is built for x64 (AMD64), and this machine is ARM64: nothing was installed. The Filament app runs here: ${GITHUB}/latest.\n`);
        const none = await ps({ ...u.env, LOCALAPPDATA: undefined });
        assert.equal(none.code, 1, none.out);
        assert.equal(none.err, "LOCALAPPDATA is not set: Filament installs into the user's own folder, and there is none to install into.\n");
        // a path out, and a dot at the end, which Windows drops from a folder's name
        for (const v of ["../1.0.0", "1.0.0."]) {
          const r = await ps({ ...u.env, FILAMENT_VERSION: v });
          assert.equal(r.code, 1, r.out);
          assert.equal(r.err, `FILAMENT_VERSION=${v} is no version: say one like 1.2.3.\n`);
          assert.equal(r.out, "");
        }
        assert.equal(arm.out + none.out, "", "nothing said on stdout");
        assert.deepEqual(readdirSync(u.at), [], "nothing made");
        assert.deepEqual(hits, [], "nothing asked for");
      } finally {
        rmSync(u.at, { recursive: true, force: true });
      }
    });

    test("a release with no feed for Windows hosts, or a FILAMENT_VERSION that is none, is said so with the cause; nothing made", async () => {
      const u = user();
      try {
        latest = "0.1.0";
        const r = await ps(u.env);
        assert.equal(r.code, 1, r.out);
        assert.equal(r.err, `Filament's releases gave no ${FEED} at ${url}/latest/download/${FEED} (The remote server returned an error: (404) Not Found.): nothing was installed.\n`);
        const asked = await ps({ ...u.env, FILAMENT_VERSION: "v0.1.0" });
        assert.equal(asked.code, 1, asked.out);
        assert.equal(asked.err, `Filament's releases gave no ${FEED} at ${url}/download/v0.1.0/${FEED} (The remote server returned an error: (404) Not Found.): nothing was installed. Is 0.1.0 a release of Filament for Windows hosts?\n`);
        assert.deepEqual(readdirSync(u.at), [], "nothing made");
      } finally {
        rmSync(u.at, { recursive: true, force: true });
      }
    });

    test("a download whose SHA-512 is not the yml's is refused on a first install, and leaves nothing — not even the folder made for it", async () => {
      await release("0.9.0", { damaged: true });
      latest = "0.9.0";
      const u = user();
      try {
        hits.length = 0;
        const r = await ps(u.env);
        assert.equal(r.code, 1, r.out);
        assert.match(r.err, /^The download of filament-server-0\.9\.0-win32-x64\.tar\.gz is not the file latest-server-win32-x64\.yml describes: its SHA-512 differs\. Nothing was installed; /m);
        assert.ok(hits.includes("/download/v0.9.0/filament-server-0.9.0-win32-x64.tar.gz"), "downloaded, then refused");
        assert.deepEqual(readdirSync(u.at), [], "nothing under LOCALAPPDATA");
      } finally {
        rmSync(u.at, { recursive: true, force: true });
      }
    });

    test("a tarball with no build-info.json is no server build: refused in words, and nothing left", async () => {
      await release("4.0.0", { marker: false });
      latest = "4.0.0";
      const u = user();
      try {
        const r = await ps(u.env);
        assert.equal(r.code, 1, r.out);
        assert.equal(r.err, "filament-server-4.0.0-win32-x64.tar.gz holds no build-info.json, so it is no build of Filament for Windows hosts: nothing was installed.\n");
        assert.deepEqual(readdirSync(u.at), [], "nothing under LOCALAPPDATA");
      } finally {
        rmSync(u.at, { recursive: true, force: true });
      }
    });

    test("installs the newest release to %LOCALAPPDATA%\\filament\\<version> with current, a junction; the same again changes nothing; a newer one goes beside and keeps the one before; a third removes the oldest; a damaged one leaves all as it was; FILAMENT_VERSION points back at one kept, or fetches one removed", async () => {
      for (const v of ["1.0.0", "1.1.0", "1.2.0"]) await release(v);
      await release("1.3.0", { damaged: true });
      const u = user();
      const current = join(u.base, "current");
      const next = `Next: "${join(current, "bin", "filament.cmd")}" setup`;
      /** current a junction at the version's folder, and the command through it that version's. @param {string} v */
      const at = (v) => {
        assert.ok(lstatSync(current).isSymbolicLink(), "current is a junction");
        assert.equal(realpathSync(current), realpathSync(join(u.base, v)));
        assert.equal(runs(u.base), v, "current\\bin\\filament.cmd is that version's");
      };
      /** The version folders and what else is in Filament's folder (no run's leftovers). */
      const folders = () => readdirSync(u.base).sort();
      try {
        // the first install: the version's folder whole, current, and the next step
        latest = "1.0.0";
        hits.length = 0;
        let r = await ps(u.env);
        assert.equal(r.code, 0, r.err);
        assert.equal(r.err, "");
        assert.deepEqual(folders(), ["1.0.0", "current"]);
        at("1.0.0");
        assert.deepEqual(readdirSync(join(u.base, "1.0.0")).sort(), ["bin", MARKER, "node", "vendor"], "the tarball's top folder, moved into place");
        assert.deepEqual(hits, [`/latest/download/${FEED}`, "/download/v1.0.0/filament-server-1.0.0-win32-x64.tar.gz"], "the newest's yml, then its tarball by its version's tag");
        assert.deepEqual(r.out.trim().split("\n"), [
          "Downloading Filament 1.0.0 (filament-server-1.0.0-win32-x64.tar.gz)...",
          `Filament 1.0.0 is installed in ${join(u.base, "1.0.0")}, and current points at it.`,
          next,
        ]);

        // the same again: the yml read, nothing downloaded, nothing changed
        const was = treeAt(u.base);
        hits.length = 0;
        r = await ps(u.env);
        assert.equal(r.code, 0, r.err);
        assert.deepEqual(hits, [`/latest/download/${FEED}`]);
        assert.deepEqual(r.out.trim().split("\n"), [`Filament 1.0.0 is installed already, in ${join(u.base, "1.0.0")}: nothing changed.`, next]);
        assert.deepEqual(treeAt(u.base), was);

        // a newer release: beside, the one before kept
        latest = "1.1.0";
        r = await ps(u.env);
        assert.equal(r.code, 0, r.err);
        assert.deepEqual(folders(), ["1.0.0", "1.1.0", "current"]);
        at("1.1.0");
        assert.equal(r.out.trim().split("\n")[1], `Filament 1.1.0 is installed in ${join(u.base, "1.1.0")}, and current points at it; 1.0.0 is kept beside it for a roll back.`);

        // a third: the oldest removed, said
        latest = "1.2.0";
        r = await ps(u.env);
        assert.equal(r.code, 0, r.err);
        assert.deepEqual(folders(), ["1.1.0", "1.2.0", "current"]);
        at("1.2.0");
        assert.deepEqual(r.out.trim().split("\n"), [
          "Downloading Filament 1.2.0 (filament-server-1.2.0-win32-x64.tar.gz)...",
          `Removed Filament 1.0.0, not one of the two kept (${join(u.base, "1.0.0")}).`,
          `Filament 1.2.0 is installed in ${join(u.base, "1.2.0")}, and current points at it; 1.1.0 is kept beside it for a roll back.`,
          next,
        ]);

        // a damaged download over an install: refused, and everything as it was
        const before = treeAt(u.base);
        latest = "1.3.0";
        r = await ps(u.env);
        assert.equal(r.code, 1, r.out);
        assert.match(r.err, /its SHA-512 differs/);
        assert.deepEqual(treeAt(u.base), before, "nothing changed, no work folder left");
        at("1.2.0");

        // FILAMENT_VERSION of the one kept: current points back, nothing downloaded, both kept
        hits.length = 0;
        r = await ps({ ...u.env, FILAMENT_VERSION: "1.1.0" });
        assert.equal(r.code, 0, r.err);
        assert.deepEqual(hits, [`/download/v1.1.0/${FEED}`], "that release's yml alone");
        assert.deepEqual(r.out.trim().split("\n"), [`Filament 1.1.0 was installed already, in ${join(u.base, "1.1.0")}: current points at it now, and 1.2.0 is kept beside it for a roll back.`, next]);
        assert.deepEqual(folders(), ["1.1.0", "1.2.0", "current"]);
        at("1.1.0");

        // FILAMENT_VERSION of one removed: fetched again; the newer one current left is not one of the two kept
        r = await ps({ ...u.env, FILAMENT_VERSION: "v1.0.0" });
        assert.equal(r.code, 0, r.err);
        assert.ok(r.out.includes(`Removed Filament 1.2.0, not one of the two kept (${join(u.base, "1.2.0")}).`), r.out);
        assert.deepEqual(folders(), ["1.0.0", "1.1.0", "current"]);
        at("1.0.0");
      } finally {
        rmSync(u.at, { recursive: true, force: true });
      }
    });

    test("FILAMENT_NO_ENGINE=1 installs the tarball without the memory engine where the release has one, and says so where it has none", async () => {
      await release("2.0.0", { small: true });
      await release("2.1.0");
      const u = user({ FILAMENT_NO_ENGINE: "1" });
      try {
        latest = "2.0.0";
        let r = await ps(u.env);
        assert.equal(r.code, 0, r.err);
        assert.equal(runs(u.base), "2.0.0 no-engine");
        assert.ok(!existsSync(join(u.base, "2.0.0", "vendor")), "no engine in it");
        assert.equal(r.out.trim().split("\n")[1], `Filament 2.0.0, without its memory engine, is installed in ${join(u.base, "2.0.0")}, and current points at it.`);
        latest = "2.1.0";
        r = await ps(u.env);
        assert.equal(r.code, 1, r.out);
        assert.equal(r.err, `Filament 2.1.0 is not published without its memory engine: its ${FEED} lists no filament-server-2.1.0-win32-x64-no-engine.tar.gz. Leave FILAMENT_NO_ENGINE out for the whole one.\n`);
        assert.equal(runs(u.base), "2.0.0 no-engine", "the one installed is left");
      } finally {
        rmSync(u.at, { recursive: true, force: true });
      }
    });

    // (fails before, the review of s3f2: yes — a refusal under `powershell -c "irm … | iex"` ended with exit code 0)
    test("irm | iex: a one-shot -Command ends with the run's exit code; typed into a PowerShell, it installs or refuses and that PowerShell goes on, $LASTEXITCODE saying how it went; a download cut short runs nothing", async () => {
      await release("3.0.0");
      latest = "3.0.0";
      const u = user();
      try {
        // one-shot, as a script or an SSH session runs it
        let r = await ps({ ...u.env, FILAMENT_VERSION: "nope" }, "command");
        assert.equal(r.code, 1, r.out);
        assert.equal(r.err, "FILAMENT_VERSION=nope is no version: say one like 1.2.3.\n");
        r = await ps(u.env, "command");
        assert.equal(r.code, 0, r.err);
        assert.equal(r.err, "");
        assert.equal(r.out.trim().split("\n")[1], `Filament 3.0.0 is installed in ${join(u.base, "3.0.0")}, and current points at it.`);
        assert.equal(runs(u.base), "3.0.0");

        // typed: the PowerShell goes on to the next line, whatever the run said
        r = await ps({ ...u.env, FILAMENT_VERSION: "nope" }, "typed");
        assert.equal(r.code, 0, r.err);
        assert.match(r.err, /^FILAMENT_VERSION=nope is no version: say one like 1\.2\.3\.$/m);
        assert.match(r.out, /^still here 1$/m, "the next line ran, and $LASTEXITCODE says the run failed");
        r = await ps(u.env, "typed");
        assert.equal(r.code, 0, r.err);
        assert.match(r.out, /^Filament 3\.0\.0 is installed already, in \S+: nothing changed\.$/m);
        assert.match(r.out, /^still here 0$/m);

        // a download cut short: PowerShell refuses its text whole, and nothing of it runs
        hits.length = 0;
        const v = user();
        try {
          r = await ps(v.env, "typed", `${url}/cut/install.ps1`);
          assert.match(r.err, /Missing closing '\}'/);
          assert.deepEqual(hits, ["/cut/install.ps1"], "no feed asked for");
          assert.deepEqual(readdirSync(v.at), [], "nothing made");
        } finally {
          rmSync(v.at, { recursive: true, force: true });
        }
      } finally {
        rmSync(u.at, { recursive: true, force: true });
      }
    });

    test("Next names filament where PATH finds this one first, and says which runs where another comes first", async () => {
      await release("5.0.0");
      latest = "5.0.0";
      const u = user();
      const other = tmp("other-");
      try {
        let r = await ps(u.env);
        assert.equal(r.code, 0, r.err);
        const bin = join(u.base, "current", "bin");
        const path = [SYSTEM, join(SYSTEM, "WindowsPowerShell", "v1.0")];
        r = await ps({ ...u.env, PATH: [...path, bin].join(";") });
        assert.equal(r.code, 0, r.err);
        assert.equal(r.out.trim().split("\n").at(-1), "Next: filament setup");
        writeFileSync(join(other, "filament.cmd"), "@echo off\r\n");
        r = await ps({ ...u.env, PATH: [...path, other, bin].join(";") });
        assert.equal(r.code, 0, r.err);
        assert.deepEqual(r.out.trim().split("\n").slice(-2), [`${join(other, "filament.cmd")} comes first on your PATH, not this Filament: it runs as ${join(bin, "filament.cmd")}.`, `Next: "${join(bin, "filament.cmd")}" setup`]);
      } finally {
        rmSync(u.at, { recursive: true, force: true });
        rmSync(other, { recursive: true, force: true });
      }
    });

    // (fails before, the review of s3f2: yes — a junction at the version's path was moved and its target's files
    // removed with the work folder by Windows PowerShell 5.1's Remove-Item -Recurse; a pruned version's junction too)
    test("a junction is never followed: one at the version's own path is refused, and one inside a version it removes goes without what it points at", async () => {
      await release("7.0.0");
      await release("7.1.0");
      await release("7.2.0");
      const u = user();
      const outside = tmp("outside-");
      writeFileSync(join(outside, "keep.txt"), "the person's own");
      try {
        mkdirSync(u.base);
        symlinkSync(outside, join(u.base, "7.0.0"), "junction");
        latest = "7.0.0";
        let r = await ps(u.env);
        assert.equal(r.code, 1, r.out);
        assert.equal(r.err, `${join(u.base, "7.0.0")} is a junction or a link, not a folder Filament's installer made: move it away and run it again.\n`);
        assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "the person's own");
        rmdirSync(join(u.base, "7.0.0"));

        latest = "7.1.0";
        r = await ps(u.env);
        assert.equal(r.code, 0, r.err);
        symlinkSync(outside, join(u.base, "7.1.0", "linked"), "junction");
        latest = "7.2.0";
        r = await ps(u.env);
        assert.equal(r.code, 0, r.err);
        // one more, so 7.1.0 is neither installed nor kept
        await release("7.3.0");
        latest = "7.3.0";
        r = await ps(u.env);
        assert.equal(r.code, 0, r.err);
        assert.ok(r.out.includes("Removed Filament 7.1.0, not one of the two kept"), r.out);
        assert.ok(!existsSync(join(u.base, "7.1.0")));
        assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "the person's own", "the junction's target untouched");
      } finally {
        rmSync(u.at, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    });

    // (fails before, the review of s3f2: yes — Prune removed a running version's files until it met one in use, and
    // left the rest without its build-info.json, never removed after)
    test("a version still in use is kept whole, never half removed, and an install over one in use is refused and undone", async () => {
      for (const v of ["8.0.0", "8.1.0", "8.2.0"]) await release(v);
      await release("8.3.0", { small: true });
      const u = user();
      try {
        for (const v of ["8.0.0", "8.1.0"]) {
          latest = v;
          const r = await ps(u.env);
          assert.equal(r.code, 0, r.err);
        }
        // 8.0.0 runs on after current moved: an install of 8.2.0 keeps it whole, and says why
        const was = treeAt(join(u.base, "8.0.0"));
        let hold = holding(join(u.base, "8.0.0", "bin"));
        try {
          latest = "8.2.0";
          const r = await ps(u.env);
          assert.equal(r.code, 0, r.err);
          assert.match(r.out, /^Filament 8\.0\.0 is kept, in use \(.+\): a Filament still runs from it, or a program has a file in it open\. An install of another version removes it\.$/m);
          assert.deepEqual(treeAt(join(u.base, "8.0.0")), was, "whole");
          assert.deepEqual(readdirSync(u.base).sort(), ["8.0.0", "8.1.0", "8.2.0", "current"], "nothing left aside");
        } finally {
          await hold.stop();
        }

        // 8.3.0 runs; its other tarball over it cannot move it: refused, and the run undone
        latest = "8.3.0";
        let r = await ps(u.env);
        assert.equal(r.code, 0, r.err);
        const before = treeAt(u.base);
        hold = holding(join(u.base, "8.3.0", "bin"));
        try {
          r = await ps({ ...u.env, FILAMENT_NO_ENGINE: "1" });
          assert.equal(r.code, 1, r.out);
          const lines = r.err.trim().split("\n");
          assert.match(lines[0], new RegExp(`^${join(u.base, "8.3.0").replace(/[\\.]/g, "\\$&")} is in use \\(.+\\): a Filament still runs from it, or a program has a file in it open\\. Stop it \\(filament stop\\) and run this again\\.$`));
          assert.equal(lines[1], `Filament 8.3.0 could not be put in place, so this run is undone: nothing was installed, and ${u.base} is as it was.`);
          assert.deepEqual(treeAt(u.base), before, "as it was, no work folder left");
        } finally {
          await hold.stop();
        }
        assert.equal(runs(u.base), "8.3.0");
      } finally {
        rmSync(u.at, { recursive: true, force: true });
      }
    });

    // The user's PATH is the registry's (HKCU\Environment): the script's own OnPath is run here against a key of its
    // own under HKCU\Software, taken away after, with Windows' "environment changed" note left out, so this machine's
    // PATH is never touched.
    test("OnPath puts %LOCALAPPDATA%\\filament\\current\\bin on the user's PATH once, as an expandable value that keeps the others' %variables%", async () => {
      const fn = /^ {2}function OnPath\(.*?^ {2}\}$/ms.exec(readFileSync(SCRIPT, "utf8"))?.[0];
      const why = /^ {2}function Why\(.*?^ {2}\}$/ms.exec(readFileSync(SCRIPT, "utf8"))?.[0];
      assert.ok(fn && why, "install.ps1 has its OnPath and Why");
      const key = `Software\\Filament-install-test-${process.pid}`;
      const body = fn
        .replace("OpenSubKey('Environment', $true)", () => `OpenSubKey('${key}', $true)`)
        .replace("CreateSubKey('Environment')", () => `CreateSubKey('${key}')`)
        .replace(/\[Environment\]::SetEnvironmentVariable\([^)]*\)/g, () => "$null = 0");
      assert.ok(!body.includes("'Environment'") && !body.includes("SetEnvironmentVariable"), "nothing of the user's own environment left in it");
      const u = user();
      const bin = join(u.base, "current", "bin");
      const script = [
        "Set-StrictMode -Version 2",
        "$ErrorActionPreference = 'Stop'",
        why,
        body,
        "$reg = [Microsoft.Win32.Registry]::CurrentUser",
        "function Shown { $k = $reg.OpenSubKey($key); try { [Console]::Out.WriteLine($k.GetValue('Path', '', 'DoNotExpandEnvironmentNames') + ' ' + $k.GetValueKind('Path')) } finally { $k.Close() } }",
        `$key = '${key}'`,
        `$bin = '${bin}'`,
        "try {",
        // no Path yet: it is made
        "  $reg.CreateSubKey($key).Close()",
        "  [Console]::Out.WriteLine('1 ' + (OnPath $bin)); Shown",
        // a Path of the user's, with a %variable%: kept, current\bin after it, once however often it runs
        "  $k = $reg.OpenSubKey($key, $true); $k.SetValue('Path', '%USERPROFILE%\\tools;C:\\Tools', 'ExpandString'); $k.Close()",
        "  [Console]::Out.WriteLine('2 ' + (OnPath $bin)); Shown",
        "  [Console]::Out.WriteLine('3 ' + (OnPath $bin)); Shown",
        // there already by its full path, with a \\ at its end: left as it is
        "  $k = $reg.OpenSubKey($key, $true); $k.SetValue('Path', \"C:\\Tools;$bin\\\", 'String'); $k.Close()",
        "  [Console]::Out.WriteLine('4 ' + (OnPath $bin)); Shown",
        "  [Console]::Out.WriteLine('5 ' + @($env:Path -split ';' | Where-Object { $_ -eq $bin }).Count)",
        "} finally { $reg.DeleteSubKeyTree($key, $false) }",
      ].join("\n");
      try {
        const r = spawnSync(shell.file, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", windowsHide: true, env: { ...process.env, LOCALAPPDATA: u.at } });
        assert.equal(r.status, 0, r.stderr);
        const said = "%LOCALAPPDATA%\\filament\\current\\bin is on your PATH now: a new window or SSH session runs Filament as filament.";
        assert.deepEqual(lf(r.stdout).trim().split("\n"), [
          `1 ${said}`,
          "%LOCALAPPDATA%\\filament\\current\\bin ExpandString",
          `2 ${said}`,
          "%USERPROFILE%\\tools;C:\\Tools;%LOCALAPPDATA%\\filament\\current\\bin ExpandString",
          "3 ",
          "%USERPROFILE%\\tools;C:\\Tools;%LOCALAPPDATA%\\filament\\current\\bin ExpandString",
          "4 ",
          `C:\\Tools;${bin}\\ String`,
          "5 1",
        ]);
      } finally {
        spawnSync("reg.exe", ["delete", `HKCU\\${key}`, "/f"], { windowsHide: true });
        rmSync(u.at, { recursive: true, force: true });
      }
    });
  });
}

test("install.ps1's text is ASCII alone: Windows PowerShell 5.1 reads a script without a BOM, and irm a download, in the system's code page", () => {
  const text = readFileSync(SCRIPT, "utf8");
  const off = [...text].findIndex((c) => c.charCodeAt(0) > 0x7e || (c.charCodeAt(0) < 0x20 && c !== "\n" && c !== "\r"));
  assert.equal(off, -1, `a character beyond ASCII at ${off}: ${text.slice(Math.max(0, off - 40), off + 1)}`);
});
