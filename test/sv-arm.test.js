// @ts-check
// Filament for servers on Linux arm64, released beside x64 (the remote plan's sv-arm). `npm run dist:server` builds for
// the machine it runs on — linux-x64 or linux-arm64 — and refuses every other one rather than build a machine's tarball
// on another: the memory engine's bundle and node-pty are built on the machine they are for. arm64's tarballs are named
// -linux-arm64 and listed in latest-server-arm64.yml beside them, as electron-builder's latest-linux-arm64.yml sits
// beside latest-linux.yml; x64's latest-server.yml lists x64's alone, so an x64 install finds its file there by the same
// lines whether a release carries arm64's or not. install.sh picks its tarball and update file by `uname -m` (a
// stand-in here, as install-sh.test.js's), and the updater by the target its install's build-info.json names.
// (fails before: yes — the server build, install.sh and the updater knew linux-x64 alone: an arm64 machine was refused,
// and no release carried a tarball for it)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { distServer, FEED, feedName, feedOf, LAUNCHER, MARKER, SERVER_TARGETS, serverDir, tarballName, topOf, untar, writeTarGz } from "../scripts/dist-server.mjs";
import { findGitBash } from "../src/adapters/tools/shell.js";
import { lookForUpdate, serverAsset, serverFeed, serverTarball, SERVER_TARGETS as UPDATE_TARGETS } from "../src/services/updates.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WIN = process.platform === "win32";
const ARM = "linux-arm64";
/** A throwaway folder. @param {string} [tag] */
const tmp = (tag = "") => mkdtempSync(join(tmpdir(), `filament-svarm-${tag}`));
/** A file's SHA-512, base64, as latest-server*.yml gives it. @param {string | Buffer} body */
const sha512Of = (body) => createHash("sha512").update(body).digest("base64");

/**
 * A checkout with what a server's build packs, small: node-pty built here and prebuilt for both Linux machines, and both
 * machines' engine bundles. @param {string} root
 */
function checkoutAt(root) {
  const files = {
    "package.json": JSON.stringify({ name: "filament", version: "1.2.3", type: "module" }),
    "bin/filament.js": "console.log('filament');",
    "src/server.js": "export {};",
    "sidecar/mnemosyne_sidecar.py": "print('sidecar')",
    "electron-builder.yml": "appId: com.filamentdev.desktop\npublish:\n  provider: github\n  owner: invertibleMatrix\n  repo: filament\n",
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "filament" }, "node_modules/node-pty": {} } }),
    "node_modules/node-pty/package.json": JSON.stringify({ name: "node-pty", main: "./lib/index.js" }),
    "node_modules/node-pty/lib/index.js": "module.exports = {};",
    "node_modules/node-pty/build/Release/pty.node": "the binary npm ci built",
    "node_modules/node-pty/prebuilds/linux-x64/pty.node": "x64's",
    "node_modules/node-pty/prebuilds/linux-arm64/pty.node": "arm64's",
    "vendor/memory-engine/linux-arm64/manifest.json": "{}",
    "vendor/memory-engine/linux-arm64/uv": "arm64's uv",
    "vendor/memory-engine/linux-x64/uv": "x64's uv",
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  // A git checkout, each of its files tracked: dist:server builds from one alone.
  for (const args of [["init", "-q"], ["add", "-A"]]) {
    const r = spawnSync("git", ["-c", "core.autocrlf=false", ...args], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  return root;
}

/** The Node a test's build packs: a small file where nodejs.org's would be. @param {string} at */
function nodeAt(at) {
  const path = join(at, "node-v24", "bin", "node");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "\x7fELF an arm64 Node");
  return { path, version: "v24.11.0", variables: { node_shared: false } };
}

const WHOLE = /** @type {any} */ ({ ok: true, bundle: { manifest: { mnemosyne: "3.15.1", python: "3.12.11", builtAt: "b", files: { uv: "x" } } } });
const FACTS = () => ({ version: "1.2.3", commit: "abc1234567", subject: "a commit", dirty: false, builtAt: "2026-11-08T10:00:00.000Z" });

describe("dist:server on linux-arm64", () => {
  test("arm64's tarballs, named so, with arm64's bundle and node-pty, and latest-server-arm64.yml beside them — no latest-server.yml, which is x64's", async () => {
    const at = tmp("dist-");
    try {
      const root = checkoutAt(join(at, "checkout"));
      /** @type {string[]} */
      const said = [];
      /** @type {string[]} */
      const checked = [];
      /** @type {any[]} */
      const smoked = [];
      const io = {
        machine: ARM, root, vendor: join(root, "vendor", "memory-engine"), node: nodeAt(at), glibc: () => "2.35", facts: FACTS, ptyHelpers: () => [],
        check: async (/** @type {any} */ o) => (checked.push(o.target), WHOLE),
        smoke: async (/** @type {any} */ { log, ...o }) => (smoked.push(o), ""),
        log: (/** @type {string} */ l) => said.push(l),
        error: (/** @type {string} */ l) => said.push(`! ${l}`),
      };
      assert.equal(await distServer(io), 0, said.join("\n"));
      const out = serverDir(root, "1.2.3");
      const whole = "filament-server-1.2.3-linux-arm64.tar.gz",
        small = "filament-server-1.2.3-linux-arm64-no-engine.tar.gz",
        feed = "latest-server-arm64.yml";
      assert.deepEqual([tarballName("1.2.3", true, ARM), tarballName("1.2.3", false, ARM), feedName(ARM)], [whole, small, feed]);
      assert.deepEqual([tarballName("1.2.3"), feedName(), feedName("linux-x64")], ["filament-server-1.2.3-linux-x64.tar.gz", FEED, FEED], "x64's names, where none is given");
      assert.deepEqual(SERVER_TARGETS, ["linux-x64", ARM, "win32-x64", "darwin-arm64"]);
      assert.deepEqual(readdirSync(out).sort(), [feed, small, whole].sort());
      assert.deepEqual(checked, [ARM], "arm64's bundle checked whole before anything is packed");
      const releases = { owner: "invertibleMatrix", repo: "filament" };
      assert.deepEqual(smoked, [
        { file: join(out, whole), version: "1.2.3", engine: true, releases, target: ARM },
        { file: join(out, small), version: "1.2.3", engine: false, releases, target: ARM },
      ]);
      const listed = [whole, small].map((name) => ({ name, sha512: sha512Of(readFileSync(join(out, name))), size: statSync(join(out, name)).size }));
      assert.equal(readFileSync(join(out, feed), "utf8"), feedOf({ version: "1.2.3", files: listed, at: FACTS().builtAt }));
      assert.equal(said.at(-2), `Its update file: ${join(out, feed)} — a release of invertibleMatrix/filament offers them to servers with the tarballs beside it.`);
      // inside: arm64's bundle and node-pty's arm64 binary, none of x64's; the marker says arm64, and names its update file
      const into = join(at, "unpacked");
      mkdirSync(into);
      assert.equal(untar(join(out, whole), into), "");
      const top = join(into, topOf(whole));
      assert.deepEqual(readdirSync(join(top, "vendor", "memory-engine")), [ARM]);
      assert.deepEqual(readdirSync(join(top, "node_modules", "node-pty", "prebuilds")), [ARM]);
      const marker = JSON.parse(readFileSync(join(top, MARKER), "utf8"));
      assert.deepEqual([marker.kind, marker.target, marker.file, marker.feed, marker.engine], ["server", ARM, whole, feed, true]);
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });

  test("it builds on the machine it is for alone: any other — Windows on arm64, an Intel Mac, 32-bit Linux — is refused in words with nothing made, and arm64 without node-pty built for it too", async () => {
    const at = tmp("refuse-");
    try {
      const root = checkoutAt(join(at, "checkout"));
      /** @type {string[]} */
      const said = [];
      const io = {
        machine: ARM, root, vendor: join(root, "vendor", "memory-engine"), node: nodeAt(at), facts: FACTS, ptyHelpers: () => [],
        check: async () => WHOLE, smoke: async () => assert.fail("nothing to smoke-test"),
        log: () => {}, error: (/** @type {string} */ l) => said.push(l),
      };
      for (const machine of ["win32-arm64", "darwin-x64", "linux-ia32", "linux-arm"]) {
        assert.equal(await distServer({ ...io, machine }), 1, machine);
        assert.equal(said.at(-1), `Filament's server build is for linux-x64, linux-arm64, win32-x64 and darwin-arm64, each built on the machine it is for: the memory engine's bundle is built there, and npm ci builds node-pty there, so no machine builds another's. This machine is ${machine}; build it on Linux x64 or arm64, on Windows x64, or on a Mac with Apple silicon.`);
      }
      // node-pty with x64's prebuilt binary alone: none for arm64
      rmSync(join(root, "node_modules", "node-pty", "build"), { recursive: true });
      rmSync(join(root, "node_modules", "node-pty", "prebuilds", ARM), { recursive: true });
      assert.equal(await distServer(io), 1);
      assert.match(said.at(-1) || "", /^node-pty is not built for linux-arm64 in this checkout: npm ci builds it/);
      assert.ok(!existsSync(join(root, "dist")), "nothing made");
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });
});

/**
 * A release of 1.1.0 as GitHub's API gives it: x64's tarballs and latest-server.yml, as x64's build writes them, and
 * with `arm64` arm64's and latest-server-arm64.yml as arm64's does; install.sh beside. Its files are fetched by
 * `fetchImpl`, each noted in `hits`.
 * @param {boolean} arm64
 */
function releaseOf(arm64) {
  /** @type {Record<string, string>} */
  const bodies = {};
  for (const target of arm64 ? ["linux-x64", ARM] : ["linux-x64"]) {
    const files = [true, false].map((engine) => {
      const name = tarballName("1.1.0", engine, target),
        body = `${name}'s bytes`;
      bodies[name] = body;
      return { name, sha512: sha512Of(body), size: body.length };
    });
    bodies[feedName(target)] = feedOf({ version: "1.1.0", files, at: "2026-11-08T00:00:00.000Z" });
  }
  bodies["install.sh"] = "#!/bin/sh\n";
  const assets = Object.entries(bodies).map(([name, body]) => ({ name, size: body.length, browser_download_url: `https://releases.invalid/download/v1.1.0/${name}` }));
  /** @type {string[]} */
  const hits = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url) => {
    hits.push(String(url));
    if (String(url).startsWith("https://api.github.com/")) return new Response(JSON.stringify({ tag_name: "v1.1.0", html_url: "https://releases.invalid/tag/v1.1.0", assets }));
    const name = String(url).split("/").pop() || "";
    return name in bodies ? new Response(bodies[name]) : new Response("Not Found", { status: 404 });
  };
  return { bodies, hits, fetchImpl };
}

describe("the updater on arm64 and on x64, from one release carrying both", () => {
  /** @param {ReturnType<typeof releaseOf>} rel @param {import("../src/services/updates.js").Asset} asset */
  const look = (rel, asset) => lookForUpdate({ current: "1.0.0", owner: "o", repo: "r", kind: "server", asset, fetchImpl: rel.fetchImpl });

  test("an arm64 server takes arm64's tarball of its kind, checked by latest-server-arm64.yml", async () => {
    const rel = releaseOf(true);
    for (const engine of [true, false]) {
      rel.hits.length = 0;
      const { update, why } = await look(rel, serverAsset(engine, ARM));
      const name = tarballName("1.1.0", engine, ARM);
      assert.equal(why, "");
      assert.deepEqual(update, { version: "1.1.0", name, url: `https://releases.invalid/download/v1.1.0/${name}`, size: rel.bodies[name].length, sha512: sha512Of(rel.bodies[name]), page: "https://releases.invalid/tag/v1.1.0", kind: "server" });
      assert.deepEqual(rel.hits, ["https://api.github.com/repos/o/r/releases/latest", "https://releases.invalid/download/v1.1.0/latest-server-arm64.yml"]);
    }
  });

  test("an x64 install reads latest-server.yml, which lists x64's tarballs alone, the whole one as its path, and takes its own from a release carrying arm64's too", async () => {
    const rel = releaseOf(true);
    const yml = rel.bodies[FEED];
    assert.deepEqual([...yml.matchAll(/^ {2}- url: (.+)$/gm)].map((m) => m[1]), [tarballName("1.1.0"), tarballName("1.1.0", false)]);
    assert.match(yml, /^path: filament-server-1\.1\.0-linux-x64\.tar\.gz$/m);
    assert.equal(yml, releaseOf(false).bodies[FEED], "the same file whether the release carries arm64's or not");
    for (const engine of [true, false]) {
      rel.hits.length = 0;
      const { update } = await look(rel, serverAsset(engine));
      const name = tarballName("1.1.0", engine);
      assert.deepEqual([update?.name, update?.sha512], [name, sha512Of(rel.bodies[name])]);
      assert.deepEqual(rel.hits.slice(1), ["https://releases.invalid/download/v1.1.0/latest-server.yml"]);
    }
  });

  test("a release built without arm64's (SERVER_ARM64 off) offers an arm64 server nothing, in words, and x64's its own", async () => {
    const rel = releaseOf(false);
    assert.deepEqual(await look(rel, serverAsset(true, ARM)), { update: null, why: "release 1.1.0 carries no filament-server-1.1.0-linux-arm64.tar.gz" });
    assert.equal((await look(rel, serverAsset(true))).update?.name, tarballName("1.1.0"));
  });

  test("the updater names each target's files as dist:server does", () => {
    assert.deepEqual(UPDATE_TARGETS, SERVER_TARGETS);
    for (const target of SERVER_TARGETS) {
      assert.equal(serverFeed(target), feedName(target));
      for (const engine of [true, false]) assert.equal(serverTarball("1.2.3", engine, target), tarballName("1.2.3", engine, target));
      assert.deepEqual([serverAsset(true, target).file("1.2.3"), serverAsset(true, target).feed], [tarballName("1.2.3", true, target), feedName(target)]);
    }
    assert.deepEqual([serverTarball("1.2.3"), serverFeed()], [tarballName("1.2.3"), FEED], "x64's, where none is given");
  });
});

/**
 * The sh a server would run install.sh with, and the folders its tools are in (install-sh.test.js's): on Windows Git's
 * dash (else its sh), with Git's own tools; elsewhere dash, else /bin/sh, on this PATH. Null where there is none.
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
const SCRIPT = readFileSync(join(ROOT, "scripts", "install.sh"), "utf8");

/** `uname` saying what UNAME_S and UNAME_M say, Linux x86_64 by default. */
const UNAME = `#!/bin/sh
case "$1" in
  -m) echo "\${UNAME_M:-x86_64}" ;;
  *) echo "\${UNAME_S:-Linux}" ;;
esac
`;
/** `getconf`: glibc 2.35, and the width of the machine's programs LONG_BIT says, 64 by default. */
const GETCONF = `#!/bin/sh
case "$1" in
  GNU_LIBC_VERSION) echo "glibc 2.35" ;;
  LONG_BIT) echo "\${LONG_BIT:-64}" ;;
  *) exit 1 ;;
esac
`;

/**
 * install.sh run as `curl … | sh` runs it, its text on the sh's stdin, with `env` and what Windows' programs need.
 * @param {Record<string, string>} env @returns {Promise<{ code: number | null, out: string, err: string }>}
 */
function sh(env, script = SCRIPT) {
  const keep = WIN ? ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"] : ["TMPDIR"];
  /** @type {Record<string, string>} */
  const base = { LANG: "C", MSYS: "winsymlinks:nativestrict" };
  for (const k of keep) if (process.env[k]) base[k] = String(process.env[k]);
  return new Promise((done, fail) => {
    const child = spawn(/** @type {any} */ (SH).file, [], { env: { ...base, ...env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.once("error", fail);
    child.once("close", (code) => done({ code, out, err }));
    child.stdin.end(script);
  });
}

describe("install.sh on arm64", { skip: !SH && "no POSIX sh on this machine (on Windows, Git for Windows carries one)" }, () => {
  /** The releases folder: download/v<version>/…, and latest/download/… for the version `latest` names. */
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
      if (!existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end("Not Found");
      res.writeHead(200, { "content-type": "application/octet-stream" }).end(readFileSync(file));
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", () => done(null)));
    url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
    // Whether this sh makes real links (Git's on Windows needs developer mode): an install's current is one.
    const at = tmp("links-");
    mkdirSync(join(at, "d"));
    const r = await sh({ PATH: (SH?.tools || []).join(delimiter), HOME: at }, 'cd "$HOME" && ln -s d l && [ -L l ]');
    links = r.code === 0 && lstatSync(join(at, "l")).isSymbolicLink();
    rmSync(at, { recursive: true, force: true });
  });
  after(async () => {
    await new Promise((done) => server.close(() => done(null)));
    rmSync(rel, { recursive: true, force: true });
  });

  /**
   * A release of `version`: each target's whole tarball, as its build makes it, and its update file; `damaged`, each
   * yml giving another file's SHA-512. Each tarball's Node says its version and target.
   * @param {string} version @param {{ targets?: string[], damaged?: boolean }} [o]
   */
  async function release(version, { targets = SERVER_TARGETS.filter((t) => t.startsWith("linux-")), damaged = false } = {}) {
    const at = join(rel, "download", `v${version}`);
    mkdirSync(at, { recursive: true });
    for (const target of targets) {
      const name = tarballName(version, true, target);
      const marker = { kind: "server", version, target, file: name, feed: feedName(target), engine: true, node: "v24.11.0", glibc: "2.35", releases: { provider: "github", owner: "invertibleMatrix", repo: "filament" } };
      const entries = [
        { name: "bin/filament", mode: 0o755, body: Buffer.from(LAUNCHER) },
        { name: "bin/filament.js", mode: 0o755, body: Buffer.from("console.log('filament');\n") },
        { name: "node/bin/node", mode: 0o755, body: Buffer.from(`#!/bin/sh\necho "${version} ${target}"\n`) },
        { name: MARKER, mode: 0o644, body: Buffer.from(`${JSON.stringify(marker, null, 2)}\n`) },
      ];
      const { sha512, size } = await writeTarGz(entries, join(at, name), { top: topOf(name), mtime: 1_762_560_000 });
      writeFileSync(join(at, feedName(target)), feedOf({ version, files: [{ name, sha512: damaged ? sha512Of("another file") : sha512, size }], at: "2026-11-08T00:00:00.000Z" }));
    }
  }

  /** A server's HOME, empty, with `uname` and `getconf` standing in, and the environment a run there gets. @param {Record<string, string>} [more] */
  function home(more = {}) {
    const at = tmp("home-");
    const fake = join(at, "fake-bin");
    mkdirSync(fake);
    for (const [n, body] of [["uname", UNAME], ["getconf", GETCONF]]) {
      writeFileSync(join(fake, n), body);
      chmodSync(join(fake, n), 0o755);
    }
    const h = join(at, "home");
    mkdirSync(h);
    return { at, home: h, env: { HOME: h, PATH: [fake, ...(/** @type {any} */ (SH).tools)].join(delimiter), FILAMENT_RELEASES_URL: url, ...more } };
  }

  test("it picks by uname -m: x86_64 reads latest-server.yml and fetches x64's tarball, aarch64 and arm64 latest-server-arm64.yml and arm64's", async () => {
    // Each yml gives another file's SHA-512: the run downloads the tarball it picked, then refuses it — no links needed.
    await release("0.9.0", { damaged: true });
    latest = "0.9.0";
    for (const [arch, target] of [["x86_64", "linux-x64"], ["aarch64", ARM], ["arm64", ARM]]) {
      const h = home({ UNAME_M: arch });
      try {
        hits.length = 0;
        const r = await sh(h.env);
        assert.equal(r.code, 1, `${arch}: ${r.out}`);
        const name = tarballName("0.9.0", true, target);
        assert.deepEqual(hits, [`/latest/download/${feedName(target)}`, `/download/v0.9.0/${name}`], arch);
        assert.match(r.err, new RegExp(`^The download of ${name.replace(/\./g, "\\.")} is not the file ${feedName(target).replace(/\./g, "\\.")} describes: its SHA-512 differs\\. Nothing was installed; `, "m"), arch);
      } finally {
        rmSync(h.at, { recursive: true, force: true });
      }
    }
  });

  test("on aarch64 it installs arm64's tarball, whose Filament runs from ~/.local/bin", async (t) => {
    if (!links) return t.skip("this sh makes no real links (Git for Windows without developer mode): the install's current and ~/.local/bin/filament are links");
    await release("1.0.0");
    latest = "1.0.0";
    const h = home({ UNAME_M: "aarch64" });
    try {
      const r = await sh(h.env);
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /^Downloading Filament 1\.0\.0 \(filament-server-1\.0\.0-linux-arm64\.tar\.gz\)\.\.\.$/m);
      const dir = join(h.home, ".local", "share", "filament", "1.0.0");
      assert.equal(JSON.parse(readFileSync(join(dir, MARKER), "utf8")).target, ARM);
      const ran = await sh(h.env, '"$HOME/.local/bin/filament" --version');
      assert.equal(ran.code, 0, ran.err);
      assert.equal(ran.out.trim(), `1.0.0 ${ARM}`);
    } finally {
      rmSync(h.at, { recursive: true, force: true });
    }
  });

  test("a release built without arm64's gives an arm64 server no update file: refused in words, nothing made", async () => {
    await release("0.8.0", { targets: ["linux-x64"] });
    latest = "0.8.0";
    const h = home({ UNAME_M: "aarch64" });
    try {
      hits.length = 0;
      const r = await sh(h.env);
      assert.equal(r.code, 1, r.out);
      // after what curl says of the 404
      assert.equal(r.err.split(/\r?\n/).filter(Boolean).at(-1), `Filament's releases gave no latest-server-arm64.yml at ${url}/latest/download/latest-server-arm64.yml: nothing was installed.`);
      assert.deepEqual(hits, ["/latest/download/latest-server-arm64.yml"]);
      assert.deepEqual(readdirSync(h.home), [], "nothing made");
    } finally {
      rmSync(h.at, { recursive: true, force: true });
    }
  });

  test("refused in words, nothing asked of the releases: another arch or system, and 32-bit programs on a 64-bit kernel", async () => {
    const h = home();
    try {
      hits.length = 0;
      for (const [os, arch] of [["Linux", "riscv64"], ["Linux", "armv7l"], ["Darwin", "arm64"], ["FreeBSD", "amd64"]]) {
        const r = await sh({ ...h.env, UNAME_S: os, UNAME_M: arch });
        assert.equal(r.code, 1, `${os} ${arch}: ${r.out}`);
        assert.equal(r.err, `Filament for servers is built for Linux on x86_64 and on arm64 (aarch64), and this machine is ${os} on ${arch}: nothing was installed. On a Mac, install the desktop app from https://github.com/invertibleMatrix/filament/releases/latest. On Windows, install the desktop app, or Filament for Windows hosts in PowerShell: irm https://github.com/invertibleMatrix/filament/releases/latest/download/install.ps1 | iex\n`);
      }
      // Raspberry Pi OS's 32-bit release on a Pi's 64-bit kernel: uname says aarch64, and its programs are 32-bit
      for (const arch of ["aarch64", "x86_64"]) {
        const r = await sh({ ...h.env, UNAME_M: arch, LONG_BIT: "32" });
        assert.equal(r.code, 1, `${arch}: ${r.out}`);
        assert.equal(r.err, `Filament for servers runs 64-bit programs, and this machine's are 32-bit, on its ${arch} kernel: nothing was installed. Its system's 64-bit release runs it.\n`);
      }
      assert.deepEqual(hits, []);
      assert.deepEqual(readdirSync(h.home), [], "nothing made");
    } finally {
      rmSync(h.at, { recursive: true, force: true });
    }
  });
});
