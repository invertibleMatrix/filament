// @ts-check
// `npm run dist:server` (scripts/dist-server.mjs): Filament for a server, with no desktop app — a tarball with its own
// Node, its command line, src/ with the harness, the memory sidecar, the production node_modules with node-pty built,
// and the memory engine's bundle, and the -no-engine one beside it without the bundle (that one alone with
// --no-engine); of a git checkout's own files, only what git tracks; build-info.json inside says it is a server's, the
// glibc it was built on, and names the releases' repository; one latest-server.yml beside them gives each one's SHA-512
// as the desktop's latest*.yml do. The tarballs are unpacked by the system's tar here, as a server unpacks them.
// (fails before: yes — there was no server build: dist:server was no script, and Filament came only as a desktop app)
// (fails before, the review of 11-08: yes — a build made one tarball, so the two could not be released together; it
// packed a developer's untracked files; it said nothing of glibc; a smoke test that threw left the tarball and its
// feed; and the smoke test's Filament found its bundle and started an engine install nothing stopped)
// (fails before, the hunt of 11-09: yes — the smoke test's programs kept FILAMENT_MEMORY_SIDECAR, so a stand-in engine
// set where the build runs answered for the tarball's own memory; and a tarball that could not be moved in left its .part)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  distServer,
  FEED,
  feedOf,
  LAUNCHER,
  LAUNCHER_CMD,
  MARKER,
  productionPackages,
  glibcWords,
  ptyKeeps,
  releasesOf,
  serverAnswers,
  serverDir,
  serverEnv,
  sharedLibs,
  smokeEnv,
  smokeTest,
  tarballName,
  tarBin,
  terminalStarts,
  untar,
  ustarName,
  writeTarGz,
} from "../scripts/dist-server.mjs";
import { checkBundle } from "../scripts/check-memory-bundle.mjs";
import { shaIn } from "../desktop/lib/updates.js";
import { DEFAULT_VERSION, EMBEDDING_MODEL, engineSource } from "../src/adapters/sidecar/install.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const tmp = () => mkdtempSync(join(tmpdir(), "filament-distserver-"));
const sha512Of = (/** @type {string} */ file) => createHash("sha512").update(readFileSync(file)).digest("base64");

/** Every file and folder under `dir`, by its path from it (a folder's ends with /), in order. @param {string} dir @returns {string[]} */
function filesUnder(dir, at = "") {
  /** @type {string[]} */
  const out = [];
  for (const n of readdirSync(join(dir, at)).sort()) {
    const rel = at ? `${at}/${n}` : n;
    if (statSync(join(dir, rel)).isDirectory()) out.push(`${rel}/`, ...filesUnder(dir, rel));
    else out.push(rel);
  }
  return out;
}

/** What `tar -tv` says of each entry: its mode's letters, by its name. @param {string} file */
function modesIn(file) {
  const r = spawnSync(tarBin(), ["-tvzf", file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return Object.fromEntries(
    r.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => [l.trim().split(/\s+/).pop(), l.slice(0, 10)]),
  );
}

test("the tarball: folders, files, runnable modes and long names come out of the system's tar as they went in; its SHA-512 and size are the file's", async () => {
  const at = tmp();
  try {
    const exe = join(at, "helper");
    writeFileSync(exe, "#!/bin/sh\necho hi\n");
    const block = "x".repeat(512),
      odd = "y".repeat(1025);
    // a cut at a slash fits ustar's prefix and name; one segment too long for either goes in a pax header
    const cut = `node_modules/${"a".repeat(60)}/${"b".repeat(60)}/file.js`;
    const pax = `vendor/${"c".repeat(120)}/${"d".repeat(130)}.whl`;
    assert.ok(cut.length > 100 && ustarName(cut), "split into prefix and name");
    assert.equal(ustarName(pax), null, "no cut fits");
    assert.equal(ustarName("docs/naïve.md"), null, "not ASCII");
    const entries = [
      { name: "empty", mode: 0o755, dir: true },
      { name: "bin/launcher", mode: 0o755, body: Buffer.from("#!/bin/sh\n") },
      { name: "bin/helper", mode: 0o755, from: exe },
      { name: "a/zero.txt", mode: 0o644, body: Buffer.alloc(0) },
      { name: "a/block.txt", mode: 0o644, body: Buffer.from(block) },
      { name: "a/odd.txt", mode: 0o644, body: Buffer.from(odd) },
      { name: cut, mode: 0o644, body: Buffer.from("cut") },
      { name: pax, mode: 0o644, body: Buffer.from("pax") },
    ];
    const file = join(at, "t.tar.gz");
    const made = await writeTarGz(entries, file, { top: "top", mtime: 1_700_000_000 });
    assert.deepEqual(made, { sha512: sha512Of(file), size: statSync(file).size });
    assert.ok(!existsSync(`${file}.part`), "written beside it, then moved in");
    const into = join(at, "out");
    mkdirSync(into);
    assert.equal(untar(file, into), "");
    const top = join(into, "top");
    assert.deepEqual(filesUnder(top).sort(), ["a/", "a/block.txt", "a/odd.txt", "a/zero.txt", "bin/", "bin/helper", "bin/launcher", "empty/", "node_modules/", `node_modules/${"a".repeat(60)}/`, `node_modules/${"a".repeat(60)}/${"b".repeat(60)}/`, cut, "vendor/", `vendor/${"c".repeat(120)}/`, pax].sort());
    assert.equal(readFileSync(join(top, "a", "block.txt"), "utf8"), block);
    assert.equal(readFileSync(join(top, "a", "odd.txt"), "utf8"), odd);
    assert.equal(readFileSync(join(top, "a", "zero.txt"), "utf8"), "");
    assert.equal(readFileSync(join(top, ...cut.split("/")), "utf8"), "cut");
    assert.equal(readFileSync(join(top, ...pax.split("/")), "utf8"), "pax");
    assert.equal(readFileSync(join(top, "bin", "helper"), "utf8"), "#!/bin/sh\necho hi\n");
    const modes = modesIn(file);
    assert.equal(modes["top/bin/launcher"], "-rwxr-xr-x");
    assert.equal(modes["top/bin/helper"], "-rwxr-xr-x");
    assert.equal(modes["top/a/odd.txt"], "-rw-r--r--");
    assert.equal(modes["top/empty/"], "drwxr-xr-x");
    assert.equal(modes["top/bin/"], "drwxr-xr-x", "a folder no entry names is made before its first file");
    // where it can't be moved in (a folder with a file in it is in its place), the move's error, and no .part left
    const taken = join(at, "taken.tar.gz");
    mkdirSync(taken);
    writeFileSync(join(taken, "inside"), "x");
    await assert.rejects(writeTarGz(entries, taken, { top: "top" }), (/** @type {any} */ e) => ["EISDIR", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes(e.code));
    assert.ok(!existsSync(`${taken}.part`), "its .part removed");
    assert.equal(readFileSync(join(taken, "inside"), "utf8"), "x", "what was in its place left as it was");
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});

test("the smoke test's programs run without what would send them elsewhere: another data folder, bundle, machine, supervisor, Node options or a stand-in memory engine", () => {
  const env = smokeEnv({ PATH: "/bin", HOME: "/home/f", FILAMENT_DATA_DIR: "d", FILAMENT_MEMORY_BUNDLE: "b", FILAMENT_SUPERVISOR: "s", FILAMENT_MACHINE: "m", NODE_OPTIONS: "--x", FILAMENT_MEMORY_SIDECAR: JSON.stringify({ command: "node", args: ["fake.js"] }) });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/home/f" });
  const prev = process.env.FILAMENT_MEMORY_SIDECAR;
  process.env.FILAMENT_MEMORY_SIDECAR = JSON.stringify({ command: "node", args: ["fake.js"] });
  try {
    assert.equal(smokeEnv().FILAMENT_MEMORY_SIDECAR, undefined, "this process's, by default");
    assert.equal(serverEnv(tmpdir()).FILAMENT_MEMORY_SIDECAR, undefined, "the smoke test's Filament's too");
  } finally {
    if (prev === undefined) delete process.env.FILAMENT_MEMORY_SIDECAR;
    else process.env.FILAMENT_MEMORY_SIDECAR = prev;
  }
});

test("latest-server.yml gives each tarball's SHA-512 where the updater's shaIn reads it, the first's as path and sha512 too; the releases' repository is electron-builder.yml's publish", () => {
  const files = [
    { name: "filament-server-1.2.3-linux-x64.tar.gz", sha512: "AbC+/=", size: 42 },
    { name: "filament-server-1.2.3-linux-x64-no-engine.tar.gz", sha512: "XyZ=", size: 7 },
  ];
  const yml = feedOf({ version: "1.2.3", files, at: "2026-11-08T00:00:00.000Z" });
  assert.equal(
    yml,
    [
      "version: 1.2.3",
      "files:",
      "  - url: filament-server-1.2.3-linux-x64.tar.gz",
      "    sha512: AbC+/=",
      "    size: 42",
      "  - url: filament-server-1.2.3-linux-x64-no-engine.tar.gz",
      "    sha512: XyZ=",
      "    size: 7",
      "path: filament-server-1.2.3-linux-x64.tar.gz",
      "sha512: AbC+/=",
      "releaseDate: '2026-11-08T00:00:00.000Z'",
      "",
    ].join("\n"),
  );
  assert.equal(shaIn(yml, "filament-server-1.2.3-linux-x64.tar.gz"), "AbC+/=");
  assert.equal(shaIn(yml, "filament-server-1.2.3-linux-x64-no-engine.tar.gz"), "XyZ=");
  const one = feedOf({ version: "1.2.3", files: files.slice(1), at: "2026-11-08T00:00:00.000Z" });
  assert.equal(shaIn(one, "filament-server-1.2.3-linux-x64-no-engine.tar.gz"), "XyZ=");
  assert.equal(shaIn(one, "filament-server-1.2.3-linux-x64.tar.gz"), null);
  assert.match(one, /^path: filament-server-1\.2\.3-linux-x64-no-engine\.tar\.gz$/m);
  assert.deepEqual(releasesOf(readFileSync(join(ROOT, "electron-builder.yml"), "utf8")), { owner: "invertibleMatrix", repo: "filament" });
  assert.equal(releasesOf("appId: x\npublish:\n  provider: generic\n  url: https://example.com\n"), null, "a repository on GitHub alone");
  assert.equal(releasesOf("appId: x\n"), null);
  assert.equal(tarballName("1.2.3"), "filament-server-1.2.3-linux-x64.tar.gz");
  assert.equal(tarballName("1.2.3", false), "filament-server-1.2.3-linux-x64-no-engine.tar.gz", "the small one is never taken for the whole one");
});

/** What nodejs.org's Node 24 says of the libraries it was built with, in process.config.variables: none of the machine's. */
const NODEJS_ORG = { node_shared: false, node_shared_ada: false, node_shared_brotli: false, node_shared_cares: false, node_shared_http_parser: false, node_shared_libuv: false, node_shared_nghttp2: false, node_shared_nghttp3: false, node_shared_ngtcp2: false, node_shared_openssl: false, node_shared_simdjson: false, node_shared_simdutf: false, node_shared_sqlite: false, node_shared_uvwasi: false, node_shared_zlib: false, node_shared_zstd: false };
test("the production packages are package-lock.json's not marked dev — this checkout's node-pty and what it needs; node-pty without its sources or another system's binaries", () => {
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  assert.deepEqual(productionPackages(lock).map((p) => p.path), ["node_modules/node-addon-api", "node_modules/node-pty"]);
  const made = productionPackages({ packages: { "": { name: "x" }, "node_modules/b": {}, "node_modules/a": { dev: true }, "node_modules/c": { devOptional: true }, "node_modules/d": { optional: true }, "node_modules/b/node_modules/e": {}, "node_modules/f": { link: true } } });
  assert.deepEqual(made, [{ path: "node_modules/b", optional: false }, { path: "node_modules/b/node_modules/e", optional: false }, { path: "node_modules/d", optional: true }]);
  const keep = ptyKeeps("linux-x64");
  for (const n of ["node_modules/node-pty/lib/index.js", "node_modules/node-pty/build/Release/pty.node", "node_modules/node-pty/prebuilds/linux-x64/pty.node", "node_modules/node-pty/package.json", "node_modules/other/src/x.js"]) assert.ok(keep(n), n);
  for (const n of ["node_modules/node-pty/src/unix/pty.cc", "node_modules/node-pty/deps/winpty", "node_modules/node-pty/third_party/conpty", "node_modules/node-pty/scripts/post-install.js", "node_modules/node-pty/prebuilds/darwin-arm64", "node_modules/node-pty/build/Release/obj.target/pty/src/unix/pty.o"]) assert.ok(!keep(n), n);
  // A Windows host's: its prebuilt binaries, never their debug symbols (the hunt on s3f1).
  const win = ptyKeeps("win32-x64");
  for (const n of ["node_modules/node-pty/prebuilds/win32-x64/pty.node", "node_modules/node-pty/prebuilds/win32-x64/conpty.node", "node_modules/node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe"]) assert.ok(win(n), n);
  for (const n of ["node_modules/node-pty/prebuilds/win32-x64/pty.pdb", "node_modules/node-pty/prebuilds/win32-x64/conpty.pdb", "node_modules/node-pty/build/Release/pty.PDB", "node_modules/node-pty/prebuilds/win32-arm64/pty.node"]) assert.ok(!win(n), n);
  assert.deepEqual(sharedLibs({ node_shared: true, node_shared_openssl: "true", node_shared_zlib: false, node_use_openssl: true }), ["libnode", "openssl"]);
  assert.deepEqual(sharedLibs(NODEJS_ORG), [], "nodejs.org's Node leans on no library of the machine");
});

const SHARED_HERE = sharedLibs(process.config.variables);
test(
  "the Node running these tests leans on no library of the machine, as nodejs.org's does",
  { skip: SHARED_HERE.length ? `this Node is built on the machine's own ${SHARED_HERE.join(", ")} (Homebrew's or a distribution's), which dist:server refuses to pack` : false },
  () => assert.deepEqual(sharedLibs(process.config.variables), []),
);

/** A checkout with what a server's build packs, small: its files as a path → body. @param {string} root */
function checkoutAt(root, version = "1.2.3") {
  const files = {
    "package.json": JSON.stringify({ name: "filament", version, type: "module" }),
    LICENSE: "Apache License",
    NOTICE: "Filament",
    "THIRD_PARTY_NOTICES.md": "# Third-party notices",
    "README.md": "# Filament",
    "bin/filament.js": "console.log('filament');",
    "src/server.js": "export {};",
    "src/ui/harness.html": "<html></html>",
    "src/__pycache__/x.pyc": "a cache",
    "src/scratch.tmp.mjs": "scratch",
    "docs/GUIDE.md": "# Guide",
    "starters/apps/hello/app.json": "{}",
    "sidecar/mnemosyne_sidecar.py": "print('sidecar')",
    "sidecar/notes.txt": "not the sidecar",
    "electron-builder.yml": "appId: com.filamentdev.desktop\npublish:\n  provider: github\n  owner: invertibleMatrix\n  repo: filament\nfiles:\n  - src/**\n",
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "filament" }, "node_modules/node-pty": { dependencies: { "node-addon-api": "^7.1.0" } }, "node_modules/node-addon-api": {}, "node_modules/node-pty/node_modules/inner": {}, "node_modules/electron": { dev: true }, "node_modules/fsevents": { optional: true, os: ["darwin"] } } }),
    "node_modules/node-pty/package.json": JSON.stringify({ name: "node-pty", main: "./lib/index.js" }),
    "node_modules/node-pty/lib/index.js": "module.exports = {};",
    "node_modules/node-pty/build/Release/pty.node": "the binary npm ci built",
    "node_modules/node-pty/build/Release/obj.target/pty/src/unix/pty.o": "an object",
    "node_modules/node-pty/src/unix/pty.cc": "a source",
    "node_modules/node-pty/deps/x.c": "a source",
    "node_modules/node-pty/scripts/post-install.js": "a script",
    "node_modules/node-pty/prebuilds/darwin-arm64/pty.node": "a Mac's",
    "node_modules/node-pty/prebuilds/win32-x64/pty.node": "Windows' prebuilt",
    "node_modules/node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe": "Windows' console host",
    "node_modules/node-pty/node_modules/inner/index.js": "inner",
    "node_modules/node-addon-api/package.json": JSON.stringify({ name: "node-addon-api" }),
    "node_modules/electron/package.json": JSON.stringify({ name: "electron" }),
    "vendor/memory-engine/linux-x64/manifest.json": "{}",
    "vendor/memory-engine/linux-x64/uv": "the bundle's uv",
    "vendor/memory-engine/linux-x64/wheels/mnemosyne.whl": "a wheel",
    "vendor/memory-engine/win32-x64/uv.exe": "another machine's",
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

/** The Node a test's build packs: a small file where nodejs.org's would be, its LICENSE beside its bin. @param {string} at */
function nodeAt(at) {
  const path = join(at, "node-v24", "bin", "node");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "\x7fELF a Node");
  writeFileSync(join(at, "node-v24", "LICENSE"), "Node's license");
  return { path, version: "v24.11.0", variables: { node_shared: false, node_shared_openssl: false } };
}

const WHOLE = /** @type {any} */ ({ ok: true, bundle: { manifest: { mnemosyne: "3.15.1", python: "3.12.11", builtAt: "b", files: { uv: "x" } } } });
const FACTS = () => ({ version: "1.2.3", commit: "abc1234567", subject: "a commit", dirty: false, builtAt: "2026-11-08T10:00:00.000Z" });

/** The files and folders of the -no-engine tarball, as filesUnder gives them: the whole one's without the bundle. @param {string[]} whole */
const withoutEngine = (whole) => whole.filter((n) => !n.startsWith("vendor/"));

test("dist:server: dist/server/<version>/ holds the tarball — Node, bin, src, the sidecar, production node_modules, the engine — the -no-engine one beside it, and one latest-server.yml with both SHA-512s, the whole one's first; each is smoke-tested; --no-engine makes the small one alone", async () => {
  const at = tmp();
  try {
    const root = checkoutAt(join(at, "checkout"));
    const node = nodeAt(at);
    /** @type {string[]} */
    const said = [];
    /** @type {any[]} */
    const smoked = [];
    /** @type {any[]} */
    const checked = [];
    const io = {
      machine: "linux-x64",
      root,
      vendor: join(root, "vendor", "memory-engine"),
      node,
      glibc: () => "2.35",
      facts: FACTS,
      ptyHelpers: () => [],
      check: async (/** @type {any} */ o) => (checked.push([o.root, o.target]), WHOLE),
      smoke: async (/** @type {any} */ o) => (smoked.push({ ...o, exists: existsSync(o.file) }), ""),
      log: (/** @type {string} */ l) => said.push(l),
      error: (/** @type {string} */ l) => said.push(`! ${l}`),
    };
    const out = serverDir(root, "1.2.3");
    assert.equal(out, join(root, "dist", "server", "1.2.3"));
    assert.equal(await distServer(io), 0, said.join("\n"));
    const file = join(out, "filament-server-1.2.3-linux-x64.tar.gz"),
      small = join(out, "filament-server-1.2.3-linux-x64-no-engine.tar.gz"),
      feed = join(out, FEED);
    assert.deepEqual(readdirSync(out).sort(), ["filament-server-1.2.3-linux-x64-no-engine.tar.gz", "filament-server-1.2.3-linux-x64.tar.gz", "latest-server.yml"]);
    assert.deepEqual(checked, [[join(root, "vendor", "memory-engine"), "linux-x64"]], "the bundle checked whole before anything is packed");
    // each one's SHA-512 as the updater reads it, and as the file's bytes give it; the whole one's first, and as path
    const yml = readFileSync(feed, "utf8");
    assert.equal(shaIn(yml, "filament-server-1.2.3-linux-x64.tar.gz"), sha512Of(file));
    assert.equal(shaIn(yml, "filament-server-1.2.3-linux-x64-no-engine.tar.gz"), sha512Of(small));
    assert.equal(
      yml,
      feedOf({
        version: "1.2.3",
        files: [
          { name: "filament-server-1.2.3-linux-x64.tar.gz", sha512: sha512Of(file), size: statSync(file).size },
          { name: "filament-server-1.2.3-linux-x64-no-engine.tar.gz", sha512: sha512Of(small), size: statSync(small).size },
        ],
        at: "2026-11-08T10:00:00.000Z",
      }),
    );
    assert.ok(statSync(small).size < statSync(file).size, `${statSync(small).size} < ${statSync(file).size}`);
    const releases = { owner: "invertibleMatrix", repo: "filament" };
    assert.deepEqual(smoked.map(({ log, ...o }) => o), [
      { file, version: "1.2.3", engine: true, releases, target: "linux-x64", exists: true },
      { file: small, version: "1.2.3", engine: false, releases, target: "linux-x64", exists: true },
    ]);
    assert.match(said.at(-4) || "", /^Filament 1\.2\.3 for servers: .*filament-server-1\.2\.3-linux-x64\.tar\.gz \(\d+\.\d MB\) — tar -xzf it where it is to live, then filament-server-1\.2\.3-linux-x64\/bin\/filament start\.$/);
    assert.match(said.at(-3) || "", /^Filament 1\.2\.3 for servers, without its memory engine: .*filament-server-1\.2\.3-linux-x64-no-engine\.tar\.gz \(\d+\.\d MB\) — tar -xzf it where it is to live, then filament-server-1\.2\.3-linux-x64-no-engine\/bin\/filament start\.$/);
    assert.equal(said.at(-2), `Its update file: ${feed} — a release of invertibleMatrix/filament offers them to servers with the tarballs beside it.`);
    assert.equal(said.at(-1), "Built on glibc 2.35: its node-pty loads on a server with glibc 2.35 or newer — on an older one Filament starts, but no terminal does.");
    // what is inside, as tar unpacks it
    const into = join(at, "unpacked");
    mkdirSync(into);
    assert.equal(untar(file, into), "");
    assert.deepEqual(readdirSync(into), ["filament-server-1.2.3-linux-x64"], "one folder, named as the tarball is");
    const top = join(into, "filament-server-1.2.3-linux-x64");
    const inside = filesUnder(top);
    assert.deepEqual(inside, [
      "LICENSE", "NOTICE", "README.md", "THIRD_PARTY_NOTICES.md",
      "bin/", "bin/filament", "bin/filament.js",
      MARKER,
      "docs/", "docs/GUIDE.md",
      "node/", "node/LICENSE", "node/bin/", "node/bin/node",
      "node_modules/",
      "node_modules/node-addon-api/", "node_modules/node-addon-api/package.json",
      "node_modules/node-pty/",
      "node_modules/node-pty/build/", "node_modules/node-pty/build/Release/", "node_modules/node-pty/build/Release/pty.node",
      "node_modules/node-pty/lib/", "node_modules/node-pty/lib/index.js",
      "node_modules/node-pty/node_modules/", "node_modules/node-pty/node_modules/inner/", "node_modules/node-pty/node_modules/inner/index.js",
      "node_modules/node-pty/package.json",
      "package.json",
      "sidecar/", "sidecar/mnemosyne_sidecar.py",
      "src/", "src/server.js", "src/ui/", "src/ui/harness.html",
      "starters/", "starters/apps/", "starters/apps/hello/", "starters/apps/hello/app.json",
      "vendor/", "vendor/memory-engine/", "vendor/memory-engine/linux-x64/", "vendor/memory-engine/linux-x64/manifest.json", "vendor/memory-engine/linux-x64/uv", "vendor/memory-engine/linux-x64/wheels/", "vendor/memory-engine/linux-x64/wheels/mnemosyne.whl",
    ].sort());
    assert.equal(readFileSync(join(top, "node", "bin", "node"), "utf8"), "\x7fELF a Node");
    assert.equal(readFileSync(join(top, "bin", "filament"), "utf8"), LAUNCHER);
    assert.match(LAUNCHER, /^exec "\$here\/\.\.\/node\/bin\/node" "\$here\/filament\.js" "\$@"$/m, "the launcher runs the command line by the Node inside");
    const modes = modesIn(file);
    for (const f of ["bin/filament", "bin/filament.js", "node/bin/node"]) assert.equal(modes[`filament-server-1.2.3-linux-x64/${f}`], "-rwxr-xr-x", f);
    // the marker: a server's build, the glibc it was built on, the repository its updates come from, and the build's facts
    const marker = {
      kind: "server", version: "1.2.3", target: "linux-x64", file: "filament-server-1.2.3-linux-x64.tar.gz", feed: "latest-server.yml", engine: true, node: "v24.11.0", glibc: "2.35",
      releases: { provider: "github", owner: "invertibleMatrix", repo: "filament" },
      commit: "abc1234567", subject: "a commit", dirty: false, builtAt: "2026-11-08T10:00:00.000Z",
    };
    assert.deepEqual(JSON.parse(readFileSync(join(top, MARKER), "utf8")), marker);
    // the -no-engine one: the same files without the bundle, named so, its marker saying so
    const into2 = join(at, "unpacked-small");
    mkdirSync(into2);
    assert.equal(untar(small, into2), "");
    const top2 = join(into2, "filament-server-1.2.3-linux-x64-no-engine");
    assert.deepEqual(filesUnder(top2), withoutEngine(inside));
    assert.ok(!existsSync(join(top2, "vendor")), "no engine inside");
    assert.deepEqual(JSON.parse(readFileSync(join(top2, MARKER), "utf8")), { ...marker, file: "filament-server-1.2.3-linux-x64-no-engine.tar.gz", engine: false });

    // --no-engine: the version's folder replaced by the small one alone, its feed listing it alone, and the engine not
    // asked for; where no glibc is known, the marker says null and the build says so
    said.length = 0;
    smoked.length = 0;
    assert.equal(await distServer({ ...io, args: ["--no-engine"], glibc: () => null }), 0, said.join("\n"));
    assert.deepEqual(readdirSync(out).sort(), ["filament-server-1.2.3-linux-x64-no-engine.tar.gz", "latest-server.yml"], "the last build of the version replaced");
    assert.ok(said.includes(`Replacing the server build of 1.2.3 at ${out}.`));
    assert.equal(checked.length, 1, "no bundle to check");
    const alone = readFileSync(feed, "utf8");
    assert.deepEqual([...alone.matchAll(/^ {2}- url: (.+)$/gm)].map((m) => m[1]), ["filament-server-1.2.3-linux-x64-no-engine.tar.gz"]);
    assert.equal(shaIn(alone, "filament-server-1.2.3-linux-x64-no-engine.tar.gz"), sha512Of(small));
    assert.match(alone, /^path: filament-server-1\.2\.3-linux-x64-no-engine\.tar\.gz$/m);
    assert.deepEqual(smoked.map((o) => o.engine), [false]);
    const into3 = join(at, "unpacked-alone");
    mkdirSync(into3);
    assert.equal(untar(small, into3), "");
    const top3 = join(into3, "filament-server-1.2.3-linux-x64-no-engine");
    assert.deepEqual(filesUnder(top3), withoutEngine(inside));
    assert.equal(JSON.parse(readFileSync(join(top3, MARKER), "utf8")).glibc, null);
    assert.match(said.at(-3) || "", /^Filament 1\.2\.3 for servers, without its memory engine: .*filament-server-1\.2\.3-linux-x64-no-engine\.tar\.gz \(\d+\.\d MB\) — tar -xzf it where it is to live, then filament-server-1\.2\.3-linux-x64-no-engine\/bin\/filament start\.$/);
    assert.equal(said.at(-2), `Its update file: ${feed} — a release of invertibleMatrix/filament offers it to servers with the tarball beside it.`);
    assert.equal(said.at(-1), glibcWords(null));
    assert.match(glibcWords(null), /^The glibc it was built on is not known/);

    // where one fails its smoke test — the small one, after the whole one passed — both go with the update file, in words
    said.length = 0;
    assert.equal(await distServer({ ...io, smoke: async (/** @type {any} */ o) => (o.engine ? "" : "Filament ended (exit code 1): Error: Cannot find module") }), 1);
    assert.deepEqual(readdirSync(out), [], "nothing left to hand on");
    assert.equal(said.filter((l) => l.startsWith("! Removed ")).length, 3);
    assert.equal(said.at(-1), "! The server build can't be handed on: filament-server-1.2.3-linux-x64-no-engine.tar.gz failed its smoke test: Filament ended (exit code 1): Error: Cannot find module.");

    // a smoke test that throws: the same, in words, not a stack
    said.length = 0;
    assert.equal(await distServer({ ...io, smoke: async () => assert.fail("spawn EACCES") }), 1);
    assert.deepEqual(readdirSync(out), [], "nothing left to hand on");
    assert.equal(said.at(-1), "! The server build can't be handed on: the build broke off: spawn EACCES.");
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});

// (fails before, s3f: yes — Windows x64 was refused: no server build was made there, so no Windows PC could be a host)
test("dist:server on Windows x64: its tarballs carry node\\node.exe with its LICENSE and bin\\filament.cmd, node-pty's Windows binaries and the win32-x64 engine; their feed is latest-server-win32-x64.yml; no glibc said", async () => {
  const at = tmp();
  try {
    const root = checkoutAt(join(at, "checkout"));
    const exe = join(at, "node-v24-win-x64", "node.exe");
    mkdirSync(dirname(exe), { recursive: true });
    writeFileSync(exe, "MZ a Node");
    writeFileSync(join(dirname(exe), "LICENSE"), "Node's license");
    /** @type {string[]} */
    const said = [];
    /** @type {string[]} */
    const platforms = [];
    /** @type {string[]} */
    const smoked = [];
    const io = {
      machine: "win32-x64", root, vendor: join(root, "vendor", "memory-engine"), node: { path: exe, version: "v24.11.0", variables: {} }, glibc: () => null, facts: FACTS,
      ptyHelpers: (/** @type {string} */ _root, /** @type {string} */ platform) => (platforms.push(platform), []),
      check: async () => WHOLE, smoke: async (/** @type {any} */ o) => (smoked.push(o.target), ""),
      log: (/** @type {string} */ l) => said.push(l), error: (/** @type {string} */ l) => said.push(`! ${l}`),
    };
    assert.equal(await distServer(io), 0, said.join("\n"));
    assert.deepEqual(platforms, ["win32"], "node-pty's helpers made runnable as Windows' are (none to make)");
    assert.deepEqual(smoked, ["win32-x64", "win32-x64"]);
    const out = serverDir(root, "1.2.3");
    const feed = join(out, "latest-server-win32-x64.yml");
    assert.deepEqual(readdirSync(out).sort(), ["filament-server-1.2.3-win32-x64-no-engine.tar.gz", "filament-server-1.2.3-win32-x64.tar.gz", "latest-server-win32-x64.yml"]);
    const file = join(out, "filament-server-1.2.3-win32-x64.tar.gz");
    assert.equal(shaIn(readFileSync(feed, "utf8"), "filament-server-1.2.3-win32-x64.tar.gz"), sha512Of(file));
    const into = join(at, "unpacked");
    mkdirSync(into);
    assert.equal(untar(file, into), "");
    const top = join(into, "filament-server-1.2.3-win32-x64");
    const inside = filesUnder(top);
    for (const f of ["bin/filament.cmd", "bin/filament.js", "node/node.exe", "node/LICENSE", "node_modules/node-pty/prebuilds/win32-x64/pty.node", "node_modules/node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe", "vendor/memory-engine/win32-x64/uv.exe"])
      assert.ok(inside.includes(f), f);
    for (const f of ["bin/filament", "node/bin/", "node_modules/node-pty/prebuilds/darwin-arm64/", "vendor/memory-engine/linux-x64/"]) assert.ok(!inside.includes(f), `no ${f}`);
    assert.equal(readFileSync(join(top, "bin", "filament.cmd"), "utf8"), LAUNCHER_CMD);
    assert.match(LAUNCHER_CMD, /^"%~dp0\.\.\\node\\node\.exe" "%~dp0filament\.js" %\*\r$/m, "the launcher runs the command line by the Node inside");
    assert.ok(!/[^\r]\n/.test(LAUNCHER_CMD), "each of its lines ended as cmd reads them");
    assert.equal(readFileSync(join(top, "node", "LICENSE"), "utf8"), "Node's license", "nodejs.org's LICENSE, from beside node.exe");
    const marker = JSON.parse(readFileSync(join(top, MARKER), "utf8"));
    assert.deepEqual([marker.target, marker.feed, marker.glibc], ["win32-x64", "latest-server-win32-x64.yml", null]);
    assert.match(said.at(-3) || "", /— scripts\/install\.ps1 installs it, or tar\.exe -xzf it where it is to live, then filament-server-1\.2\.3-win32-x64\\bin\\filament\.cmd start\.$/);
    assert.equal(said.at(-1), `Its update file: ${feed} — a release of invertibleMatrix/filament offers them to servers with the tarballs beside it.`);
    assert.ok(!said.some((l) => /glibc/.test(l)), "no glibc said of a Windows build");
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});

test("dist:server packs of a git checkout's src, docs, starters and sidecar only what git tracks — a developer's .env, config.json, logs and screenshots stay out; a .git git can't list, or none, is refused", async () => {
  const at = tmp();
  try {
    const root = checkoutAt(join(at, "checkout"));
    const git = (/** @type {string[]} */ ...args) => {
      const r = spawnSync("git", ["-c", "core.autocrlf=false", ...args], { cwd: root, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
    };
    git("init", "-q");
    git("add", "-A");
    const untracked = ["src/.env", "src/config.json", "src/ui/shot.png", "docs/session.jsonl", "starters/apps/hello/.env", "sidecar/scratch.py", "src/notes/todo.md"];
    for (const rel of untracked) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), "the developer's own");
    }
    /** @type {string[]} */
    const said = [];
    const io = {
      machine: "linux-x64", root, vendor: join(root, "vendor", "memory-engine"), node: nodeAt(at), glibc: () => "2.35", facts: FACTS, ptyHelpers: () => [],
      check: async () => WHOLE, smoke: async () => "", args: ["--no-engine"],
      log: () => {}, error: (/** @type {string} */ l) => said.push(l),
    };
    assert.equal(await distServer(io), 0, said.join("\n"));
    const into = join(at, "unpacked");
    mkdirSync(into);
    assert.equal(untar(join(serverDir(root, "1.2.3"), tarballName("1.2.3", false)), into), "");
    const inside = filesUnder(join(into, "filament-server-1.2.3-linux-x64-no-engine"));
    assert.deepEqual(inside.filter((n) => /^(src|docs|starters|sidecar)\//.test(n)), [
      "docs/", "docs/GUIDE.md",
      "sidecar/", "sidecar/mnemosyne_sidecar.py",
      "src/", "src/server.js", "src/ui/", "src/ui/harness.html",
      "starters/", "starters/apps/", "starters/apps/hello/", "starters/apps/hello/app.json",
    ]);
    // a .git that git can't read: no build, rather than one that might carry what is not tracked
    rmSync(join(root, ".git"), { recursive: true, force: true });
    writeFileSync(join(root, ".git"), "gitdir: ../nowhere\n");
    assert.equal(await distServer(io), 1);
    assert.match(said.at(-1) || "", /^git can't list the checkout's files \(.+\): a build of a git checkout packs only the files git tracks, never a developer's own beside them\.$/);
    // (fails before: yes — the swarm's review of 11-10: a folder with no .git was built whole, the .env beside its files among them)
    rmSync(join(root, ".git"), { force: true });
    assert.equal(await distServer(io), 1);
    assert.equal(said.at(-1), `dist:server builds from a git checkout, and ${root} is none (no .git): git says which files are the checkout's, and a developer's own beside them never go in.`);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});

test("dist:server refuses, in words and with nothing made: another machine, a flag it doesn't take, no whole engine, a Node leaning on this machine's libraries, node-pty not built, a package not installed", async () => {
  const at = tmp();
  try {
    const root = checkoutAt(join(at, "checkout"));
    /** @type {string[]} */
    const said = [];
    const io = {
      machine: "linux-x64", root, vendor: join(root, "vendor", "memory-engine"), node: nodeAt(at), facts: FACTS, ptyHelpers: () => [],
      check: async () => WHOLE, smoke: async () => assert.fail("nothing to smoke-test"),
      log: () => {}, error: (/** @type {string} */ l) => said.push(l),
    };
    const nothing = () => assert.ok(!existsSync(join(root, "dist")), "nothing made");
    assert.equal(await distServer({ ...io, machine: "darwin-arm64" }), 1);
    assert.equal(said.at(-1), "Filament's server build is for linux-x64, linux-arm64 and win32-x64, each built on the machine it is for: the memory engine's bundle is built there, and npm ci builds node-pty there, so no machine builds another's. This machine is darwin-arm64; build it on Linux x64 or arm64, or on Windows x64.");
    assert.equal(await distServer({ ...io, args: ["--publish"] }), 2);
    assert.equal(said.at(-1), "npm run dist:server takes --no-engine alone (a tarball without the memory engine), not --publish.");
    assert.equal(await distServer({ ...io, check: async () => ({ ok: false, why: "none here" }) }), 1);
    assert.equal(said.at(-1), "No server build without the memory engine: none here — or npm run dist:server -- --no-engine for one without it.");
    assert.equal(await distServer({ ...io, node: { ...io.node, variables: { node_shared: true } } }), 1);
    assert.match(said.at(-1) || "", /uses this machine's own libnode: in the tarball it would not start on a server without the same\. Build with Node from nodejs\.org/);
    rmSync(join(root, "node_modules", "node-addon-api"), { recursive: true });
    assert.equal(await distServer(io), 1);
    assert.equal(said.at(-1), "node_modules/node-addon-api is not installed: run npm ci, then build again.");
    rmSync(join(root, "node_modules", "node-pty", "build"), { recursive: true });
    assert.equal(await distServer(io), 1);
    assert.match(said.at(-1) || "", /^node-pty is not built for linux-x64 in this checkout: npm ci builds it/);
    // a prebuilt binary for the machine serves as well as one built here
    mkdirSync(join(root, "node_modules", "node-pty", "prebuilds", "linux-x64"), { recursive: true });
    writeFileSync(join(root, "node_modules", "node-pty", "prebuilds", "linux-x64", "pty.node"), "prebuilt");
    assert.equal(await distServer(io), 1);
    assert.equal(said.at(-1), "node_modules/node-addon-api is not installed: run npm ci, then build again.", "past node-pty");
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "../1.2.3" }));
    assert.equal(await distServer(io), 1);
    assert.match(said.at(-1) || "", /^package\.json's version is no version to build: "\.\.\/1\.2\.3"/);
    nothing();
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});

test("the smoke test's Filament: this checkout's, started on a throwaway data folder and port, answers /health with its version and serves the harness; a terminal starts through its node-pty", async () => {
  const at = tmp();
  try {
    const data = join(at, "data");
    // No bundle to install memory's engine from, as the smoke test starts it: a checkout with one would start an
    // install nothing stops, left running in the throwaway folder.
    const env = serverEnv(at);
    assert.equal(env.FILAMENT_MEMORY_BUNDLE, join(at, "no-bundle"));
    assert.ok(!existsSync(env.FILAMENT_MEMORY_BUNDLE));
    assert.equal(env.FILAMENT_DATA_DIR, undefined, "smokeEnv's, besides");
    assert.equal(await serverAnswers({ command: process.execPath, args: [join(ROOT, "bin", "filament.js")], version: VERSION, dataDir: data, env }), "");
    assert.ok(existsSync(data), "its data in the throwaway folder");
    const wrong = await serverAnswers({ command: process.execPath, args: [join(ROOT, "bin", "filament.js")], version: "0.0.0-not", dataDir: data, env });
    assert.match(wrong, /^Filament's \/health answered HTTP 200 with .*"version":"[^"]+".*, not version 0\.0\.0-not$/);
    const none = await serverAnswers({ command: process.execPath, args: [join(at, "nothing.js")], version: VERSION, dataDir: data, env });
    assert.match(none, /^Filament ended \(exit code 1\): .*Cannot find module/);
    assert.equal(terminalStarts({ node: process.execPath, pty: join(ROOT, "node_modules", "node-pty") }), "");
    assert.match(terminalStarts({ node: process.execPath, pty: join(at, "no-pty") }), /^node-pty started no terminal \(exit code 1\): .*Cannot find module/);
  } finally {
    rmSync(at, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

// (fails before: no — the sv-dist hunt read a throw from its cleanup where its program never started, hiding why; Node
// lets go of a kill of a child that never ran, and the reason is said, on Linux as here)
test("the smoke test's Filament that never starts, missing or not runnable, is said as that: its cleanup throws nothing", async () => {
  const at = tmp();
  try {
    for (const command of [join(at, "no-such-filament"), at])
      assert.match(await serverAnswers({ command, version: VERSION, dataDir: join(at, "data"), timeoutMs: 10_000 }), /^Filament did not start: spawn .+: it said nothing$/);
  } finally {
    rmSync(at, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

test("the smoke test reads the build-info.json it unpacks: one that is not this build's fails it", async () => {
  const at = tmp();
  try {
    const file = join(at, tarballName("1.2.3"));
    const marker = { kind: "server", version: "1.2.2", engine: true, releases: { owner: "invertibleMatrix", repo: "filament" } };
    await writeTarGz([{ name: MARKER, mode: 0o644, body: Buffer.from(JSON.stringify(marker)) }], file, { top: "filament-server-1.2.3-linux-x64" });
    assert.equal(await smokeTest({ file, version: "1.2.3", engine: true, releases: { owner: "invertibleMatrix", repo: "filament" } }), `its ${MARKER} is not this build's: ${JSON.stringify(marker)}`);
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("filament-server-smoke-")).length;
    await smokeTest({ file, version: "1.2.2", engine: false, releases: { owner: "invertibleMatrix", repo: "filament" } });
    assert.equal(readdirSync(tmpdir()).filter((n) => n.startsWith("filament-server-smoke-")).length, before, "its throwaway folder gone");
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});

const HERE = `${process.platform}-${process.arch}`;
test("a bundle unpacked from the tarball that is not whole says so as the tarball's", async () => {
  const root = tmp();
  try {
    const dir = join(root, HERE);
    mkdirSync(join(dir, "wheels"), { recursive: true });
    const files = { [process.platform === "win32" ? "uv.exe" : "uv"]: "uv", "python/p.tar.gz": "py", "wheels/m.whl": "m", "requirements.txt": "r", "fastembed/model.onnx": "w" };
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    const sha = (/** @type {string} */ b) => createHash("sha256").update(b).digest("hex");
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: 1, platform: process.platform, arch: process.arch, builtAt: "b", uv: "0.8.17", python: "3.12.11", mnemosyne: DEFAULT_VERSION, source: engineSource(DEFAULT_VERSION), embeddings: true, model: EMBEDDING_MODEL, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])) }));
    assert.equal((await checkBundle({ root, machine: HERE, target: HERE, inTarball: true })).ok, true);
    writeFileSync(join(dir, "requirements.txt"), "changed");
    assert.deepEqual(await checkBundle({ root, machine: HERE, target: HERE, inTarball: true }), { ok: false, why: "the memory engine bundle inside the server's tarball is not whole: requirements.txt differs from its manifest; scripts/dist-server.mjs left it out or changed it" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dist:server is the script, run by its real path (source contract)", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["dist:server"], "node scripts/dist-server.mjs");
  const src = readFileSync(join(ROOT, "scripts", "dist-server.mjs"), "utf8");
  assert.match(src, /^if \(isMain\(import\.meta\.url\)\) process\.exitCode = await distServer\(\{ args: process\.argv\.slice\(2\) \}\);$/m);
  // the smoke test's Filament starts with no bundle to install its engine from (serverEnv), and its own is tried apart
  assert.match(src, /return await serverAnswers\(\{ \.\.\.started, [^\n]*env: serverEnv\(at\)/);
});
