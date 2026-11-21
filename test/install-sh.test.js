// @ts-check
// scripts/install.sh: Filament for servers in one command — `curl -fsSL …/releases/latest/download/install.sh | sh`.
// It is run here as that pipe runs it, its text on a POSIX sh's stdin (dash: Linux's /bin/sh, and Git for Windows
// carries one), against a releases folder served from this process: latest-server.yml as scripts/dist-server.mjs
// writes it, and small tarballs by its own tar writer, each with the real launcher and a Node that says its version.
// HOME is a throwaway folder and `uname` a stand-in that says Linux x86_64, so it installs on Windows too. What needs
// links is skipped where the sh can't make real ones (Windows without developer mode).
// (fails before: yes — there was no install.sh: a server had the tarball to fetch, check and unpack by hand)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FEED, feedOf, LAUNCHER, MARKER, tarballName, topOf, writeTarGz } from "../scripts/dist-server.mjs";
import { findGitBash } from "../src/adapters/tools/shell.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = readFileSync(join(ROOT, "scripts", "install.sh"), "utf8");
const WIN = process.platform === "win32";

/**
 * The sh a server would run it with, and the folders its tools are in: on Windows Git's dash (else its sh), found as
 * the bash tool finds Git Bash, with Git's own tools — never Windows' tar or curl; elsewhere dash, else /bin/sh, on
 * this PATH. Null where there is none.
 * @returns {{ file: string, tools: string[] } | null}
 */
function shHere() {
  if (WIN) {
    const bash = findGitBash();
    if (!bash) return null;
    const git = dirname(dirname(bash));
    const file = [join(git, "usr", "bin", "dash.exe"), join(git, "usr", "bin", "sh.exe"), join(git, "bin", "sh.exe")].find((f) => existsSync(f));
    return file ? { file, tools: [join(git, "usr", "bin"), join(git, "mingw64", "bin")] } : null;
  }
  const file = ["/usr/bin/dash", "/bin/dash", "/bin/sh"].find((f) => existsSync(f));
  return file ? { file, tools: String(process.env.PATH || "/usr/bin:/bin").split(delimiter) } : null;
}
const SH = shHere();

/** A path as the sh reads it: on Windows Git's own form (it reads HOME and PATH so itself, not XDG_DATA_HOME). @param {string} p */
const shPath = (p) => (WIN ? execFileSync(join(/** @type {any} */ (SH).tools[0], "cygpath.exe"), ["-u", p], { encoding: "utf8", windowsHide: true }).trim() : p);

/** A throwaway folder. @param {string} [tag] */
const tmp = (tag = "") => mkdtempSync(join(tmpdir(), `filament-install-${tag}`));

/** `uname` saying what UNAME_S and UNAME_M say, Linux x86_64 by default: the installer runs on any machine here. */
const UNAME = `#!/bin/sh
case "$1" in
  -m) echo "\${UNAME_M:-x86_64}" ;;
  *) echo "\${UNAME_S:-Linux}" ;;
esac
`;

/** `getconf` and `ldd` saying the glibc GLIBC says, 2.35 by default; GLIBC=musl, a machine on another C library. */
const GETCONF = `#!/bin/sh
[ "\${GLIBC:-2.35}" != musl ] && [ "$1" = GNU_LIBC_VERSION ] && echo "glibc \${GLIBC:-2.35}" && exit 0
exit 1
`;
const LDD = `#!/bin/sh
if [ "\${GLIBC:-2.35}" = musl ]; then echo "musl libc (x86_64)" >&2; exit 1; fi
echo "ldd (GNU libc) \${GLIBC:-2.35}"
`;

/**
 * `ln` failing, as a folder the user may not write to fails it, for a link whose path matches LN_FAILS; stopping the
 * installer (TERM) as it makes one that matches LN_STOPS; else the system's (the next on the PATH).
 */
const LN = `#!/bin/sh
for a; do last=$a; done
case $last in $LN_FAILS) echo "ln: failed to create symbolic link '$last': Permission denied" >&2; exit 1 ;; esac
case $last in $LN_STOPS) kill -TERM "$PPID" ;; esac
PATH=\${PATH#*:}
export PATH
exec ln "$@"
`;

/**
 * The installer run as `curl … | sh` runs it — its text on the sh's stdin — with nothing of this process's environment
 * but what Windows' programs need: `env`'s HOME, PATH and options.
 * @param {Record<string, string>} env @returns {Promise<{ code: number | null, out: string, err: string }>}
 */
function sh(env, script = SCRIPT, args = /** @type {string[]} */ ([])) {
  const keep = WIN ? ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"] : ["TMPDIR"];
  /** @type {Record<string, string>} */
  const base = { LANG: "C", MSYS: "winsymlinks:nativestrict" };
  for (const k of keep) if (process.env[k]) base[k] = String(process.env[k]);
  return new Promise((done, fail) => {
    const child = spawn(/** @type {any} */ (SH).file, args, { env: { ...base, ...env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.once("error", fail);
    child.once("close", (code) => done({ code, out, err }));
    child.stdin.end(script);
  });
}

/** Whether this sh makes real links (Git's on Windows needs developer mode): a folder linked, and Node sees a link. */
async function linksHere() {
  const at = tmp("links-");
  try {
    mkdirSync(join(at, "d"));
    const r = await sh({ PATH: (SH?.tools || []).join(delimiter), HOME: at }, 'cd "$HOME" && ln -s d l && [ -L l ]');
    return r.code === 0 && lstatSync(join(at, "l")).isSymbolicLink();
  } catch {
    return false;
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
}

/**
 * What is under `dir`, to see a run changed nothing: each entry by its path, a link with what it points at and when it
 * was made, a file with its size and time. A folder's own time is left out: a refused run's folder came and went in it.
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


/** A file's SHA-512, base64, as latest-server.yml gives it. @param {string | Buffer} body */
const sha512Of = (body) => createHash("sha512").update(body).digest("base64");

describe("install.sh", { skip: !SH && "no POSIX sh on this machine (on Windows, Git for Windows carries one)" }, () => {
  /** The releases folder the server serves: download/v<version>/…, and latest/download/… for the version `latest` names. */
  let rel = "";
  let latest = "";
  /** @type {string[]} */
  const hits = [];
  let url = "";
  let links = false;
  /** @type {import("node:http").Server} */
  let server;

  before(async () => {
    rel = tmp("releases-");
    server = createServer((req, res) => {
      const path = decodeURIComponent(String(req.url || "").split("?")[0]);
      hits.push(path);
      const file = path.startsWith("/latest/download/") ? join(rel, "download", `v${latest}`, path.slice("/latest/download/".length)) : join(rel, ...path.split("/").filter((p) => p && p !== ".."));
      if (!existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404).end("Not Found");
        return;
      }
      res.writeHead(200, { "content-type": "application/octet-stream" }).end(readFileSync(file));
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", () => done(null)));
    url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
    links = await linksHere();
  });
  after(async () => {
    await new Promise((done) => server.close(() => done(null)));
    rmSync(rel, { recursive: true, force: true });
  });

  /**
   * A release of `version`: the whole tarball (with an engine's file in it) and, with `small`, the one without the
   * engine; their latest-server.yml. Each holds dist-server.mjs's launcher, a Node that says its version and engine,
   * and build-info.json as the build writes it. `damaged`: the yml gives the tarball another file's SHA-512; `glibc`:
   * the one the build says it was built on; `marker` false, a tarball without build-info.json.
   * @param {string} version @param {{ small?: boolean, damaged?: boolean, glibc?: string, marker?: boolean }} [o]
   */
  async function release(version, { small = false, damaged = false, glibc = "2.35", marker: withMarker = true } = {}) {
    const at = join(rel, "download", `v${version}`);
    mkdirSync(at, { recursive: true });
    const made = [];
    for (const engine of small ? [true, false] : [true]) {
      const name = tarballName(version, engine);
      const marker = { kind: "server", version, target: "linux-x64", file: name, feed: FEED, engine, node: "v24.11.0", glibc, releases: { provider: "github", owner: "invertibleMatrix", repo: "filament-releases" } };
      const entries = [
        { name: "bin/filament", mode: 0o755, body: Buffer.from(LAUNCHER) },
        { name: "bin/filament.js", mode: 0o755, body: Buffer.from("console.log('filament');\n") },
        { name: "node/bin/node", mode: 0o755, body: Buffer.from(`#!/bin/sh\necho "${version}${engine ? "" : " no-engine"}"\n`) },
        ...(withMarker ? [{ name: MARKER, mode: 0o644, body: Buffer.from(`${JSON.stringify(marker, null, 2)}\n`) }] : []),
        ...(engine ? [{ name: "vendor/memory-engine/linux-x64/model.bin", mode: 0o644, body: Buffer.alloc(64 * 1024, 7) }] : []),
      ];
      const { sha512, size } = await writeTarGz(entries, join(at, name), { top: topOf(name), mtime: 1_762_560_000 });
      made.push({ name, sha512: damaged ? sha512Of("another file") : sha512, size });
    }
    // dist-server.mjs's own feed: each tarball a `files` entry, the first the older path/sha512 pair too.
    writeFileSync(join(at, FEED), feedOf({ version, files: made, at: "2026-11-08T00:00:00.000Z" }));
  }

  /** A server's HOME, empty, and the environment a run there gets. @param {Record<string, string>} [more] */
  function home(more = {}) {
    const at = tmp("home-");
    const fake = join(at, "fake-bin");
    mkdirSync(fake);
    for (const [n, body] of [["uname", UNAME], ["getconf", GETCONF], ["ldd", LDD]]) {
      writeFileSync(join(fake, n), body);
      chmodSync(join(fake, n), 0o755);
    }
    const h = join(at, "home");
    mkdirSync(h);
    const env = { HOME: h, PATH: [fake, ...(/** @type {any} */ (SH).tools)].join(delimiter), FILAMENT_RELEASES_URL: url, ...more };
    return { at, home: h, fake, env, data: join(h, ".local", "share", "filament"), bin: join(h, ".local", "bin", "filament") };
  }

  /** Filament's command at `bin` run, as a server runs it from ~/.local/bin: what it printed. @param {Record<string, string>} env */
  const runs = async (/** @type {Record<string, string>} */ env) => {
    const r = await sh(env, '"$HOME/.local/bin/filament" --version');
    assert.equal(r.code, 0, r.err);
    return r.out.trim();
  };

  test("refuses in words on anything but Linux x86_64 or arm64, and names what it needs where the machine lacks it — nothing made", async () => {
    const h = home();
    try {
      for (const [os, arch] of [["Darwin", "arm64"], ["Linux", "riscv64"], ["FreeBSD", "x86_64"]]) {
        const r = await sh({ ...h.env, UNAME_S: os, UNAME_M: arch });
        assert.equal(r.code, 1, `${os} ${arch}: ${r.out}`);
        assert.match(r.err, new RegExp(`^Filament for servers is built for Linux on x86_64 and on arm64 \\(aarch64\\), and this machine is ${os} on ${arch}: nothing was installed\\. On a Mac or Windows, install the desktop app from https://github\\.com/invertibleMatrix/filament-releases/releases/latest\\.\\n$`));
      }
      // another C library than glibc, or a glibc older than Node's own builds need
      const musl = await sh({ ...h.env, GLIBC: "musl" });
      assert.equal(musl.code, 1, musl.out);
      assert.equal(musl.err, "Filament for servers runs on glibc, and this machine's C library is another (Alpine's musl?): nothing was installed. A Debian, Ubuntu, Fedora or RHEL server runs it.\n");
      const old = await sh({ ...h.env, GLIBC: "2.27" });
      assert.equal(old.code, 1, old.out);
      assert.equal(old.err, "Filament for servers needs glibc 2.28 or newer, and this machine has 2.27: nothing was installed.\n");
      // a PATH with nothing on it but the stand-ins: every tool missing, named
      const bare = await sh({ ...h.env, PATH: h.fake });
      assert.equal(bare.code, 1, bare.out);
      assert.equal(bare.err, "Filament's installer needs curl or wget, tar, gzip, sha512sum or openssl, base64, od, mktemp, readlink, ln, which this machine does not have: install them with its package manager and run it again. Nothing was installed.\n");
      assert.deepEqual(readdirSync(h.home), [], "nothing made");
      assert.deepEqual(hits, [], "nothing asked for");
    } finally {
      rmSync(h.at, { recursive: true, force: true });
    }
  });

  test("a glibc older than the build's: installed, and said that its terminals don't open; the build's own or newer says nothing of it", async (t) => {
    if (!links) return t.skip("this sh makes no real links (Git for Windows without developer mode): the install's current and ~/.local/bin/filament are links");
    await release("0.8.0", { glibc: "2.35" });
    latest = "0.8.0";
    for (const [glibc, says] of /** @type {[string, boolean][]} */ ([["2.31", true], ["2.35", false], ["2.39", false]])) {
      const h = home({ GLIBC: glibc });
      try {
        const r = await sh(h.env);
        assert.equal(r.code, 0, r.err);
        assert.equal(r.out.includes(`This machine has glibc ${glibc}, older than the 2.35 Filament 0.8.0 was built on: Filament runs, but its terminals don't open here.`), says, `${glibc}: ${r.out}`);
        assert.equal(await runs(h.env), "0.8.0");
      } finally {
        rmSync(h.at, { recursive: true, force: true });
      }
    }
  });

  test("a download whose SHA-512 is not the yml's is refused on a first install, and leaves nothing — not even the folders made for it", async () => {
    await release("0.9.0", { damaged: true });
    latest = "0.9.0";
    const h = home();
    try {
      const r = await sh(h.env);
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, /^The download of filament-server-0\.9\.0-linux-x64\.tar\.gz is not the file latest-server\.yml describes: its SHA-512 differs\. Nothing was installed; /m);
      assert.ok(hits.includes("/download/v0.9.0/filament-server-0.9.0-linux-x64.tar.gz"), "downloaded, then refused");
      assert.deepEqual(treeAt(h.home), [], "nothing under HOME");
    } finally {
      rmSync(h.at, { recursive: true, force: true });
    }
  });

  // (fails before: yes — glibc_built read the missing file: the sh's own "cannot open", and a folder that no run knows
  // as installed or prunes)
  test("a tarball with no build-info.json is no server build: refused in words, and nothing left", async () => {
    await release("4.0.0", { marker: false });
    latest = "4.0.0";
    const h = home();
    try {
      const r = await sh(h.env);
      assert.equal(r.code, 1, r.out);
      assert.equal(r.err, "filament-server-4.0.0-linux-x64.tar.gz holds no filament-server-4.0.0-linux-x64/build-info.json, so it is no build of Filament for servers: nothing was installed.\n");
      assert.deepEqual(treeAt(h.home), [], "nothing under HOME");
    } finally {
      rmSync(h.at, { recursive: true, force: true });
    }
  });

  test("installs the newest release to ~/.local/share/filament/<version>, current and ~/.local/bin/filament; the same again changes nothing; a newer one goes beside and keeps the one before; a third removes the oldest; a damaged one leaves all as it was; FILAMENT_VERSION picks an older one, or points back at one kept", async (t) => {
    if (!links) return t.skip("this sh makes no real links (Git for Windows without developer mode): the install's current and ~/.local/bin/filament are links");
    for (const v of ["1.0.0", "1.1.0", "1.2.0"]) await release(v);
    await release("1.3.0", { damaged: true });
    const h = home();
    const current = join(h.data, "current");
    /** Where current points, and ~/.local/bin/filament through it: the version's folder and its launcher. @param {string} v */
    const at = (v) => {
      assert.ok(lstatSync(current).isSymbolicLink(), "current is a link");
      assert.equal(readlinkSync(current).split(/[\\/]/).pop(), v, "current points at the version's folder, by its name");
      assert.equal(realpathSync(current), realpathSync(join(h.data, v)));
      assert.ok(lstatSync(h.bin).isSymbolicLink(), "~/.local/bin/filament is a link");
      assert.equal(realpathSync(h.bin), realpathSync(join(h.data, v, "bin", "filament")), "through current to the version's launcher");
    };
    /** The version folders and what else is in Filament's folder (no run's leftovers). */
    const folders = () => readdirSync(h.data).sort();
    try {
      // the first install: the version's folder whole, current, the command, and the next step
      latest = "1.0.0";
      hits.length = 0;
      let r = await sh(h.env);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(folders(), ["1.0.0", "current"]);
      at("1.0.0");
      assert.deepEqual(readdirSync(join(h.data, "1.0.0")).sort(), ["bin", MARKER, "node", "vendor"], "the tarball's top folder, renamed into place");
      assert.equal(await runs(h.env), "1.0.0", "the launcher, by its link, runs the Node inside");
      assert.deepEqual(hits, ["/latest/download/latest-server.yml", "/download/v1.0.0/filament-server-1.0.0-linux-x64.tar.gz"], "the newest's yml, then its tarball by its version's tag");
      assert.equal(r.err, "");
      const lines = r.out.trim().split("\n");
      assert.equal(lines[0], "Downloading Filament 1.0.0 (filament-server-1.0.0-linux-x64.tar.gz)...");
      assert.match(lines[1], /^\S+\/\.local\/bin is not on your PATH: add it to run Filament as filament - echo 'export PATH="\$HOME\/\.local\/bin:\$PATH"' >> ~\/\.profile, then open a new shell\.$/);
      assert.match(lines[2], /^Filament 1\.0\.0 is installed in \S+\/\.local\/share\/filament\/1\.0\.0, and current points at it\.$/);
      assert.match(lines[3], /^Next: \S+\/\.local\/bin\/filament setup$/);
      assert.equal(lines.length, 4);

      // again, the same version: nothing changed, nothing downloaded but the yml
      const tree = treeAt(h.home);
      hits.length = 0;
      r = await sh(h.env);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /^Filament 1\.0\.0 is installed already, in \S+\/filament\/1\.0\.0: nothing changed\.$/m);
      assert.deepEqual(treeAt(h.home), tree, "nothing changed");
      assert.deepEqual(hits, ["/latest/download/latest-server.yml"]);

      // a newer release: beside it, current swapped, the one before kept for a roll back
      latest = "1.1.0";
      r = await sh(h.env);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(folders(), ["1.0.0", "1.1.0", "current"]);
      at("1.1.0");
      assert.equal(await runs(h.env), "1.1.0");
      assert.match(r.out, /^Filament 1\.1\.0 is installed in \S+\/filament\/1\.1\.0, and current points at it; 1\.0\.0 is kept beside it for a roll back\.$/m);

      // a third: the oldest goes, the last two stay
      latest = "1.2.0";
      r = await sh(h.env);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(folders(), ["1.1.0", "1.2.0", "current"]);
      at("1.2.0");
      assert.match(r.out, /^Removed Filament 1\.0\.0, older than the two kept \(\S+\/filament\/1\.0\.0\)\.$/m);

      // a damaged download: refused, and the install is as it was
      latest = "1.3.0";
      const kept = treeAt(h.home);
      r = await sh(h.env);
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, /^The download of filament-server-1\.3\.0-linux-x64\.tar\.gz is not the file latest-server\.yml describes: its SHA-512 differs\. Nothing was installed; run it again, and if it says so again, the release or a mirror on the way is damaged\.$/m);
      assert.deepEqual(treeAt(h.home), kept, "the install as it was, and no run's folder left");
      assert.equal(await runs(h.env), "1.2.0");

      // FILAMENT_VERSION: an older release, by its own tag — current points at it, the one it replaced is kept
      hits.length = 0;
      r = await sh({ ...h.env, FILAMENT_VERSION: "1.0.0" });
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(hits, ["/download/v1.0.0/latest-server.yml", "/download/v1.0.0/filament-server-1.0.0-linux-x64.tar.gz"]);
      assert.deepEqual(folders(), ["1.0.0", "1.2.0", "current"]);
      at("1.0.0");
      assert.equal(await runs(h.env), "1.0.0");

      // and back to the one kept (a v before it is taken too): nothing downloaded, current points at it again
      hits.length = 0;
      r = await sh({ ...h.env, FILAMENT_VERSION: "v1.2.0" });
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(hits, ["/download/v1.2.0/latest-server.yml"]);
      assert.match(r.out, /^Filament 1\.2\.0 was installed already, in \S+\/filament\/1\.2\.0: current points at it now, and 1\.0\.0 is kept beside it for a roll back\.$/m);
      assert.deepEqual(folders(), ["1.0.0", "1.2.0", "current"]);
      at("1.2.0");

      // a version that is not published, and one that is no version
      r = await sh({ ...h.env, FILAMENT_VERSION: "9.9.9" });
      assert.equal(r.code, 1);
      assert.match(r.err, /Filament's releases gave no latest-server\.yml at http:\/\/127\.0\.0\.1:\d+\/download\/v9\.9\.9\/latest-server\.yml \(is 9\.9\.9 a release of Filament for servers\?\): nothing was installed\.$/m);
      r = await sh({ ...h.env, FILAMENT_VERSION: "../1.0.0" });
      assert.equal(r.code, 1);
      assert.equal(r.err, "FILAMENT_VERSION=../1.0.0 is no version: say one like 1.2.3.\n");
      at("1.2.0");
    } finally {
      rmSync(h.at, { recursive: true, force: true });
    }
  });

  // (fails before: yes — a link at ~/.local/bin/filament to anything but this install's current was replaced)
  test("a link of the person's at ~/.local/bin/filament, to anything but Filament's current, is left as it is and said, pointing nowhere too: Filament runs as current's", async (t) => {
    if (!links) return t.skip("this sh makes no real links (Git for Windows without developer mode)");
    await release("5.0.0");
    latest = "5.0.0";
    const h = home();
    const bin = join(h.home, ".local", "bin");
    try {
      // theirs, to a command of their own, made by the sh as a server's links are
      let r = await sh(h.env, 'mkdir -p "$HOME/.local/bin" && printf "#!/bin/sh\\necho mine\\n" > "$HOME/mine" && chmod +x "$HOME/mine" && ln -s "$HOME/mine" "$HOME/.local/bin/filament"');
      assert.equal(r.code, 0, r.err);
      const theirs = treeAt(bin);
      r = await sh(h.env);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /^\S+\/\.local\/bin\/filament is a link of yours, to \S+\/mine, not to Filament: it is left as it is, and Filament runs as \S+\/\.local\/share\/filament\/current\/bin\/filament\.$/m);
      assert.equal(r.out.trim().split("\n").at(-1)?.replace(/\S+(?=\/\.local\/share)/, "~"), "Next: ~/.local/share/filament/current/bin/filament setup");
      assert.doesNotMatch(r.out, /not on your PATH/);
      assert.deepEqual(treeAt(bin), theirs, "their link as it was");
      assert.equal((await sh(h.env, '"$HOME/.local/bin/filament"')).out, "mine\n");
      assert.equal(await sh(h.env, '"$HOME/.local/share/filament/current/bin/filament" --version').then((x) => x.out.trim()), "5.0.0");

      // what it links to gone: still theirs, left, on a run that finds Filament installed already
      rmSync(join(h.home, "mine"));
      r = await sh(h.env);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /^\S+\/\.local\/bin\/filament is a link of yours, to \S+\/mine, not to Filament: it is left as it is, /m);
      assert.match(r.out, /^Filament 5\.0\.0 is installed already, in \S+\/filament\/5\.0\.0: nothing changed\.$/m);
      assert.deepEqual(treeAt(bin), theirs);
    } finally {
      rmSync(h.at, { recursive: true, force: true });
    }
  });

  // (fails before: yes — ~/.local/bin was HOME's "…//.local/bin", which the PATH never names: "not on your PATH", and
  // the command's link changed with how HOME was written)
  test("a HOME ending in a slash is the same folder: ~/.local/bin on the PATH runs Filament as filament, and the command's link is the one a HOME without it makes", async (t) => {
    if (!links) return t.skip("this sh makes no real links (Git for Windows without developer mode)");
    await release("6.0.0");
    latest = "6.0.0";
    const h = home();
    const env = { ...h.env, PATH: `${h.env.PATH}${delimiter}${join(h.home, ".local", "bin")}` };
    try {
      let r = await sh({ ...env, HOME: `${h.home}/` });
      assert.equal(r.code, 0, r.err);
      assert.doesNotMatch(r.out, /not on your PATH|\/\//);
      assert.equal(r.out.trim().split("\n").at(-1), "Next: filament setup");
      const to = (await sh(h.env, 'readlink "$HOME/.local/bin/filament"')).out.trim();
      assert.match(to, /[^/]\/\.local\/share\/filament\/current\/bin\/filament$/);
      assert.doesNotMatch(to, /\/\//);

      const tree = treeAt(h.home);
      r = await sh(env);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /^Filament 6\.0\.0 is installed already, in \S+: nothing changed\.$/m);
      assert.deepEqual(treeAt(h.home), tree, "the same link, left");
    } finally {
      rmSync(h.at, { recursive: true, force: true });
    }
  });

  // (fails before: yes — current went to the new version, then the command's ln failed: current stayed there, the version
  // before the one kept was removed already, the first install's folders stayed, and the build a same version's other
  // tarball replaced went with the run's folder)
  test("a run that fails once its version's folder is in is undone: the folder taken out and the build it replaced back, current and ~/.local/bin/filament as they were, nothing older removed", async (t) => {
    if (!links) return t.skip("this sh makes no real links (Git for Windows without developer mode)");
    await release("3.0.0");
    await release("3.1.0", { small: true });
    await release("3.2.0");
    const h = home();
    const fail = join(h.at, "fail-bin");
    mkdirSync(fail);
    writeFileSync(join(fail, "ln"), LN);
    chmodSync(join(fail, "ln"), 0o755);
    /** The environment of a run whose ln fails for a link matching `pattern`. @param {string} pattern @param {Record<string, string>} [more] */
    const failing = (pattern, more = {}) => ({ ...h.env, PATH: [fail, h.env.PATH].join(delimiter), LN_FAILS: pattern, ...more });
    /** That Filament `v` is not installed and all is as it was. @param {string} v */
    const words = (v) => `Filament ${v.replace(/\./g, "\\.")} could not be put in place, so this run is undone: nothing was installed, and \\S+/\\.local/share/filament and \\S+/\\.local/bin/filament are as they were\\.\\n$`;
    /** What a run whose ln fails says: ln's own words for `link`, then `words`. @param {string} link @param {string} v */
    const undone = (link, v) => new RegExp(`^ln: failed to create symbolic link '\\S+/${link.replace(/\./g, "\\.")}\\.new-\\d+': Permission denied\\n${words(v)}`);
    try {
      // a first install whose command can't be made, then one whose current can't: nothing under HOME, as before it ran
      latest = "3.0.0";
      let r = await sh(failing("*/.local/bin/*"));
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, undone(".local/bin/filament", "3.0.0"));
      assert.deepEqual(treeAt(h.home), [], "nothing under HOME");
      r = await sh(failing("*/current.new-*"));
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, undone(".local/share/filament/current", "3.0.0"));
      assert.deepEqual(treeAt(h.home), [], "the command made is taken back, and its folder");
      // stopped (TERM) with the command made, as current's link is: undone the same
      r = await sh(failing("", { LN_STOPS: "*/current.new-*" }));
      assert.equal(r.code, 143, r.out);
      assert.match(r.err, new RegExp(`^${words("3.0.0")}`));
      assert.deepEqual(treeAt(h.home), [], "nothing under HOME");

      // installed, a newer one beside it, and the command removed by the person
      r = await sh(h.env);
      assert.equal(r.code, 0, r.err);
      latest = "3.1.0";
      r = await sh(h.env);
      assert.equal(r.code, 0, r.err);
      rmSync(h.bin);
      const was = treeAt(h.home);

      // a newer one still, whose command can't be made: its folder taken out, current at 3.1.0, and 3.0.0 not removed
      latest = "3.2.0";
      r = await sh(failing("*/.local/bin/*"));
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, undone(".local/bin/filament", "3.2.0"));
      assert.deepEqual(treeAt(h.home), was, "all as it was");

      // the same version's other tarball over the build there: that build back in its place
      r = await sh(failing("*/.local/bin/*", { FILAMENT_VERSION: "3.1.0", FILAMENT_NO_ENGINE: "1" }));
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, undone(".local/bin/filament", "3.1.0"));
      assert.deepEqual(treeAt(h.home), was, "the whole build back, as it was");
      assert.equal(JSON.parse(readFileSync(join(h.data, "3.1.0", MARKER), "utf8")).engine, true);

      // and with ln working, 3.2.0 goes in as any does: nothing of the runs undone in its way
      r = await sh(h.env);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(readdirSync(h.data).sort(), ["3.1.0", "3.2.0", "current"]);
      assert.equal(await runs(h.env), "3.2.0");
    } finally {
      rmSync(h.at, { recursive: true, force: true });
    }
  });

  test("FILAMENT_NO_ENGINE takes the small tarball where the release lists one, and says so where it doesn't; XDG_DATA_HOME is where it goes; ~/.local/bin on the PATH is run as filament", async (t) => {
    if (!links) return t.skip("this sh makes no real links (Git for Windows without developer mode)");
    await release("2.0.0", { small: true });
    await release("2.1.0");
    const h = home();
    const xdg = join(h.at, "xdg");
    const env = { ...h.env, XDG_DATA_HOME: shPath(xdg), FILAMENT_NO_ENGINE: "1" };
    try {
      latest = "2.1.0";
      let r = await sh(env);
      assert.equal(r.code, 1, r.out);
      assert.equal(r.err, "Filament 2.1.0 is not published without its memory engine: its latest-server.yml lists no filament-server-2.1.0-linux-x64-no-engine.tar.gz. Leave FILAMENT_NO_ENGINE out for the whole one.\n");
      assert.ok(!existsSync(xdg), "nothing made");

      latest = "2.0.0";
      hits.length = 0;
      // ~/.local/bin on the PATH (Git's sh on Windows reads a Windows PATH into its own form of it)
      r = await sh({ ...env, PATH: `${env.PATH}${delimiter}${join(h.home, ".local", "bin")}` });
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(hits, ["/latest/download/latest-server.yml", "/download/v2.0.0/filament-server-2.0.0-linux-x64-no-engine.tar.gz"], "the small one alone downloaded");
      const dir = join(xdg, "filament", "2.0.0");
      assert.equal(JSON.parse(readFileSync(join(dir, MARKER), "utf8")).engine, false);
      assert.ok(!existsSync(join(dir, "vendor")), "no engine");
      assert.ok(!existsSync(h.data), "not in ~/.local/share where XDG_DATA_HOME is set");
      assert.equal(realpathSync(h.bin), realpathSync(join(dir, "bin", "filament")));
      assert.equal(await runs(env), "2.0.0 no-engine");
      assert.deepEqual(r.out.trim().split("\n").slice(-2), [`Filament 2.0.0, without its memory engine, is installed in ${r.out.match(/installed in (\S+), and/)?.[1]}, and current points at it.`, "Next: filament setup"]);
      assert.doesNotMatch(r.out, /not on your PATH/);

      // the whole one of the same version, asked for after: it replaces the small one in place
      r = await sh({ ...h.env, XDG_DATA_HOME: env.XDG_DATA_HOME });
      assert.equal(r.code, 0, r.err);
      assert.equal(JSON.parse(readFileSync(join(dir, MARKER), "utf8")).engine, true);
      assert.ok(existsSync(join(dir, "vendor", "memory-engine", "linux-x64", "model.bin")));
      assert.deepEqual(readdirSync(join(xdg, "filament")).sort(), ["2.0.0", "current"]);
      assert.equal(await runs(env), "2.0.0");
    } finally {
      rmSync(h.at, { recursive: true, force: true });
    }
  });
});

test("install.sh is a POSIX sh script with LF line endings, run whole or not at all (source contract)", () => {
  assert.ok(!SCRIPT.includes("\r"), "LF alone: a CR would break every line on a server");
  assert.match(SCRIPT, /^#!\/bin\/sh\n/);
  assert.match(SCRIPT, /^set -eu$/m);
  assert.match(SCRIPT, /\nmain "\$@"\n$/, "a download cut short runs nothing: everything is in main, run by the last line");
  assert.doesNotMatch(SCRIPT, /\bsudo\b|\[\[|^\s*(?:local|function|source)\s|\$\{[^}]*\/\/|<<<|\bpipefail\b/m, "nothing bash's alone, and no root");
});
