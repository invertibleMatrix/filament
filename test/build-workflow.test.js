// GitHub's Build workflow (.github/workflows/build.yml) survives being run again: "Re-run failed jobs" or "Re-run all
// jobs" of a tag's run must not die on the draft it made, nor a build by hand's on the artifact the first attempt kept
// (Hunter's of 10-29). A wrong tag stops the run before npm ci spends minutes. It builds every system (the owner's of
// 11-07), drafts the release where the installed apps look for their updates before any build (the code's own
// repository, and the mirror the apps up to 0.9.83 look in, published with it by mirror-release.yml), each build puts its
// files straight into that draft and keeps no artifact on a tag's run (one release's outgrew the account's 2 GB of
// artifact storage: the owner's of 11-16), and every file an installed app fetches from that release is one the run
// builds and checks is there. Filament for servers is built beside them, and its release carries its tarballs,
// latest-server.yml and install.sh (the remote-agents plan's sv-ci) — x64's, and arm64's with latest-server-arm64.yml
// where its job ran (sv-arm).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ASSETS } from "../desktop/lib/updates.js";
import { FEED, feedName, tarballName } from "../scripts/dist-server.mjs";

const yml = () => readFile(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");

/** A job's text: from its key to the next job's. @param {string} text @param {string} name */
const job = (text, name) => {
  const at = text.indexOf(`\n  ${name}:\n`);
  assert.ok(at > 0, `a job ${name}`);
  const next = text.slice(at + 1).search(/\n {2}[\w-]+:\n/);
  return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
};

/** The files a job's artifact keeps: its upload's path lines, without their comments. @param {string} j */
const keeps = (j) =>
  (/\n {10}path: \|\n((?: {12}.*\n)+)/.exec(j)?.[1] || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

/** The files a job puts into the drafts on a tag's run: its upload step's files list, in the artifact's words. @param {string} j */
const sends = (j) =>
  (/\n {10}files=\(\n((?: {12}".*\n)+) {10}\)\n/.exec(j.slice(j.indexOf("- name: Into the draft release")))?.[1] || "")
    .split("\n")
    .map((l) => l.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
    .map((f) => f.replaceAll("$VERSION", "${{ needs.version.outputs.version }}"));

/** The lines that put a files list into both drafts: here with the run's own token, the mirror's with RELEASES_TOKEN. */
const UPLOADS = [
  '\n          GH_TOKEN="$OWN_TOKEN" gh release upload "$GITHUB_REF_NAME" --repo "$RELEASES_REPO" --clobber "${files[@]}"\n',
  '\n          if [ -n "$MIRROR_REPO" ]; then GH_TOKEN="$MIRROR_TOKEN" gh release upload "$GITHUB_REF_NAME" --repo "$MIRROR_REPO" --clobber "${files[@]}"; fi\n',
];

/** A step's env: the run's own token, and the mirror's. */
const TOKENS = /\n {10}OWN_TOKEN: \$\{\{ github\.token \}\}\n {10}MIRROR_TOKEN: \$\{\{ secrets\.RELEASES_TOKEN \}\}\n/;

/** The release's check of the draft's files: the step's text. @param {string} text */
const checkStep = (text) => text.slice(text.indexOf("- name: Every system's files are here"), text.indexOf("- name: The release's notes"));

/** The jobs that build something and put it into the draft (on a tag's run) or keep it as an artifact (by hand). */
const BUILDS = ["windows", "mac", "linux", "server", "server-arm64"];

// (fails before: yes — the release job made the draft from the builds' artifacts, which one release's outgrew the 2 GB of)
test("a tag's run drafts the release here and in the mirror before any build: one there is left as it is, a published one stops the run, and each build puts its files into both", async () => {
  const text = await yml();
  const version = job(text, "version");
  const step = version.slice(version.indexOf("- name: The draft release"));
  assert.ok(step.length < version.length, "the version job makes the drafts");
  assert.ok(version.indexOf("- name: The tag names this version") < version.indexOf("- name: The draft release"), "after the tag's check");
  assert.match(step, /\n {8}if: startsWith\(github\.ref, 'refs\/tags\/v'\)\n/);
  assert.match(step, TOKENS);
  assert.match(step, /if \[ -n "\$MIRROR_REPO" \] && \[ -z "\$MIRROR_TOKEN" \]; then\n[^\n]*No RELEASES_TOKEN secret[^\n]*\n\s+exit 1\n/, "a missing mirror token stops the run before any build");
  assert.match(
    step,
    /if draft=\$\(GH_TOKEN="\$2" gh release view "\$GITHUB_REF_NAME" --repo "\$1" --json isDraft --jq \.isDraft[^\n]*\); then\n\s+if \[ "\$draft" != true \]; then\n[^\n]*\n\s+exit 1\n\s+fi\n[\s\S]*?else\n\s+GH_TOKEN="\$2" gh release create "\$GITHUB_REF_NAME" --repo "\$1" --draft /,
  );
  assert.ok(step.includes('\n          draft "$RELEASES_REPO" "$OWN_TOKEN"\n'), "drafted here with the run's own token");
  assert.ok(step.includes('\n          if [ -n "$MIRROR_REPO" ]; then draft "$MIRROR_REPO" "$MIRROR_TOKEN"; fi\n'), "and in the mirror with its token");
  for (const name of BUILDS) {
    const j = job(text, name);
    const send = j.slice(j.indexOf("- name: Into the draft release"));
    assert.ok(send.length < j.length, `${name} puts its files into the drafts`);
    assert.match(send, /^- name: Into the draft release\n {8}if: startsWith\(github\.ref, 'refs\/tags\/v'\)\n {8}shell: bash\n {8}env:\n/, name);
    assert.match(send, TOKENS, name);
    for (const line of UPLOADS) assert.ok(send.includes(line), `${name}: ${line.trim()}`);
    assert.ok(sends(j).length > 0, `${name}'s files replace one of their names an earlier attempt put there`);
  }
});

// (fails before: yes — the notes were written as the release job made the draft, and the job read the files from artifacts)
test("the release job finds every file whole in both drafts, and writes its notes over the version job's placeholder alone", async () => {
  const text = await yml();
  const release = job(text, "release");
  const check = checkStep(text);
  assert.match(check, TOKENS);
  assert.match(check, /\n {10}for repo in "\$RELEASES_REPO" \$MIRROR_REPO; do\n {12}token="\$OWN_TOKEN"\n {12}if \[ "\$repo" != "\$RELEASES_REPO" \]; then token="\$MIRROR_TOKEN"; fi\n/, "here, then the mirror where there is one");
  assert.match(release, /there=\$\(GH_TOKEN="\$token" gh release view "\$GITHUB_REF_NAME" --repo "\$repo" --json assets \\\n\s+--jq '\.assets\[\] \| select\(\.state == "uploaded" and \.size > 0\) \| \.name'\)\n/);
  assert.match(check, /grep -qxF "\$f" <<< "\$there" \|\| \{ echo "::error::\$f is not in \$repo's draft\."; missing=1; \}/);
  const placeholder = /--notes "(Filament \$VERSION: [^"]+)"/.exec(job(text, "version"))?.[1];
  assert.ok(placeholder, "the version job drafts it with a placeholder");
  const notes = release.slice(release.indexOf("- name: The release's notes"));
  assert.ok(notes.includes(`if [ "$body" != "${placeholder}" ]; then`), "the notes go over that placeholder, never over notes written in the draft");
  assert.match(notes, /\n {10}gh release edit "\$GITHUB_REF_NAME" --repo "\$RELEASES_REPO" --notes-file notes\.md\n/);
  assert.doesNotMatch(text, /download-artifact|gh release create "\$GITHUB_REF_NAME" out/, "the release reads the draft, never an artifact");
});

// (fails before: yes — the release was drafted in invertibleMatrix/filament-releases, apart from the code that is public
// now; before that, in the code's own repository while it was private, where no installed app could read it)
test("the release is drafted in the code's own repository, which electron-builder.yml publishes to and the installed apps look in, with the run's own token", async () => {
  const text = await yml();
  const builder = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
  const publish = /^publish:\n((?: {2}.*\n)+)/m.exec(builder.replace(/\r\n/g, "\n"))?.[1] || "";
  const field = (/** @type {string} */ k) => new RegExp(`^ {2}${k}:\\s*(\\S+)`, "m").exec(publish)?.[1];
  assert.equal(field("provider"), "github");
  const releases = /^ {2}RELEASES_REPO: (\S+)$/m.exec(text)?.[1];
  assert.equal(releases, `${field("owner")}/${field("repo")}`);
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(`github.com/${releases}.git`, /github\.com\/\S+\.git$/.exec(pkg.repository.url)?.[0], "package.json's repository: the code's own");
  // The run's own token writes releases in the jobs that ask for it, and their checkouts leave it nowhere on disk, where
  // an install script of npm ci's could read it.
  for (const name of ["version", ...BUILDS, "release"]) {
    const j = job(text, name);
    assert.match(j, /\n {4}permissions:\n {6}contents: write\n/, `${name} may write the releases`);
    for (const checkout of j.match(/- uses: actions\/checkout@v7\n(?: {8}.*\n)*/g) || []) assert.match(checkout, /\n {10}persist-credentials: false\n/, `${name}'s checkout keeps no credentials`);
  }
  assert.match(text, /^permissions:\n {2}contents: read\n/m, "every other job reads alone");
});

// (fails before: yes — there was no mirror: releases went to invertibleMatrix/filament-releases alone)
test("the mirror the apps up to 0.9.83 look in gets every release: drafted with RELEASES_TOKEN, and published as the release is published here, with its notes", async () => {
  const text = await yml();
  const mirror = (await readFile(new URL("../.github/workflows/mirror-release.yml", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const named = /^ {2}MIRROR_REPO: (\S+)$/m.exec(text)?.[1];
  assert.equal(named, "invertibleMatrix/filament-releases");
  assert.equal(/^ {2}MIRROR_REPO: (\S+)$/m.exec(mirror)?.[1], named, "both workflows name one mirror");
  assert.notEqual(named, /^ {2}RELEASES_REPO: (\S+)$/m.exec(text)?.[1]);
  assert.match(mirror, /\non:\n {2}release:\n {4}types: \[published\]\n/);
  assert.match(mirror, /\n {4}if: github\.repository == 'invertibleMatrix\/filament'\n/, "a fork's releases stay its own");
  assert.match(mirror, /\n {10}GH_TOKEN: \$\{\{ secrets\.RELEASES_TOKEN \}\}\n/);
  // The notes come through the environment: written into the script, a release's words could run as its commands.
  assert.match(mirror, /\n {10}NOTES: \$\{\{ github\.event\.release\.body \}\}\n/);
  const run = mirror.slice(mirror.indexOf("run: |"));
  assert.doesNotMatch(run, /\$\{\{/, "no expression inside the script");
  assert.match(run, /printf '%s\\n' "\$NOTES" > notes\.md\n\s+gh release edit "\$TAG" --repo "\$MIRROR_REPO" --notes-file notes\.md --draft=false --latest="\$LATEST"\n/);
});

// (fails before: yes — a tag's builds were kept as artifacts for 7 days, and one release's filled the 2 GB)
test("a build by hand keeps its files as the run's artifact for a day, replacing one of the same name from an earlier attempt; a tag's run keeps none", async () => {
  const text = await yml();
  for (const name of BUILDS) {
    const j = job(text, name);
    const upload = j.slice(j.indexOf("uses: actions/upload-artifact@v7"));
    assert.ok(upload.length < j.length, `${name} keeps an artifact`);
    assert.match(j, /- uses: actions\/upload-artifact@v7\n {8}if: \$\{\{ !startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}\n/, `${name}'s artifact is a build by hand's alone`);
    assert.match(upload, /\n {10}if-no-files-found: error\n {10}retention-days: 1\n/, name);
    assert.match(upload, /\n\s+overwrite: true\n/, name);
  }
});

test("a tag that is not package.json's version stops the run before npm ci", async () => {
  const text = await yml();
  assert.ok(text.indexOf("- name: The tag names this version") < text.indexOf("run: npm ci"));
  assert.match(job(text, "version"), /- name: The tag names this version/);
  for (const name of BUILDS) assert.match(job(text, name), /\n {4}needs: version\n/, `${name} waits on the version's check`);
  assert.match(job(text, "release"), /\n {4}needs: \[version, windows, mac, linux, server, server-arm64\]\n/);
});

// (fails before: yes — a tag's run typechecked and ran the suite on Windows, and the release waited on it)
test("the typecheck and the tests run on the owner's machine, never in a build: no job runs them and no input asks for them", async () => {
  const text = await yml();
  assert.doesNotMatch(text, /\n {2}tests:\n/);
  assert.doesNotMatch(text, /npm run typecheck|npm test\b|inputs\.tests/);
});

// (fails before: yes — the Windows and Mac builds kept their blockmaps, and every release carried three files nothing reads)
test("no build keeps a blockmap: the installed apps download an update whole, so a release carries none", async () => {
  assert.doesNotMatch(await yml(), /\.blockmap/);
  assert.doesNotMatch(await readFile(new URL("../desktop/lib/updates.js", import.meta.url), "utf8"), /blockmap/i);
});

// (fails before: yes — the server job kept no artifact for the release to merge)
test("each build puts into the draft the files its artifact keeps, from one folder, and no two builds put in a file of the same name", async () => {
  const text = await yml();
  /** @type {Map<string, string>} */
  const kept = new Map();
  for (const name of BUILDS) {
    const j = job(text, name);
    assert.match(j, /\n {10}name: Filament-\$\{\{ needs\.version\.outputs\.version \}\}-\S+\n/, `${name}'s artifact is named for its version`);
    const files = keeps(j);
    assert.ok(files.length > 0, `${name} keeps files`);
    assert.deepEqual(sends(j), files, `${name}'s draft gets what its artifact keeps`);
    // upload-artifact keeps the folders below the one its files share: a build by hand's artifact holds its files alone.
    assert.equal(new Set(files.map((f) => f.slice(0, f.lastIndexOf("/")))).size, 1, `${name}'s files are in one folder: ${files.join(", ")}`);
    for (const f of files) {
      const base = f.slice(f.lastIndexOf("/") + 1);
      assert.ok(!kept.has(base), `${base} is put in by ${kept.get(base)} and by ${name}: one would replace the other in the release`);
      kept.set(base, name);
    }
  }
});

// (fails before: yes — there was no server build: no release carried its tarballs, latest-server.yml or install.sh)
test("the server build: on Ubuntu 22.04 when its system is picked, the linux job's engine bundle before dist:server, and its tarballs, update file and install.sh in the release", async () => {
  const text = await yml();
  const server = job(text, "server");
  const linux = job(text, "linux");
  assert.match(text, /\n {8}options: \[all, windows, mac, linux, server\]\n/);
  assert.match(server, /\n {4}if: \$\{\{ github\.event_name != 'workflow_dispatch' \|\| inputs\.systems == 'all' \|\| inputs\.systems == 'server' \}\}\n/);
  assert.match(server, /\n {4}runs-on: ubuntu-22\.04\n/, "the oldest glibc a hosted runner has: the build's node-pty loads on that one and newer");
  const node = (/** @type {string} */ j) => /- uses: actions\/setup-node@v7\n {8}with:\n(?: {10}.*\n)+/.exec(j)?.[0];
  assert.ok(node(server));
  assert.equal(node(server), node(linux), "the linux job's Node");
  // One bundle under one key: a bundle either job built is the other's cache hit.
  const cache = (/** @type {string} */ j) => /\n {10}path: (vendor\/memory-engine\/\S+)\n {10}key: (.+)\n/.exec(j)?.slice(1);
  assert.deepEqual(cache(server), ["vendor/memory-engine/linux-x64", "memory-engine-linux-x64-${{ hashFiles('src/adapters/sidecar/install.js', 'scripts/build-memory-bundle.mjs') }}"]);
  assert.deepEqual(cache(server), cache(linux));
  assert.match(server, /- name: Build the memory engine bundle\n {8}if: steps\.engine\.outputs\.cache-hit != 'true'\n {8}run: npm run engine:bundle\n/);
  const at = (/** @type {string} */ s) => {
    const i = server.indexOf(s);
    assert.ok(i > 0, `the server job has ${s.trim()}`);
    return i;
  };
  const order = ["run: npm ci\n", "uses: actions/cache@v6\n", "run: npm run engine:bundle\n", "run: npm run dist:server\n", "run: cp scripts/install.sh ", "- name: Into the draft release\n", "uses: actions/upload-artifact@v7\n"];
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) < at(order[i]), `${order[i - 1].trim()} before ${order[i].trim()}`);
  const v = "${{ needs.version.outputs.version }}";
  const files = [tarballName(v), tarballName(v, false), FEED, "install.sh"];
  assert.deepEqual(keeps(server), files.map((f) => `dist/server/${v}/${f}`));
  assert.deepEqual(sends(server), keeps(server));
  const check = checkStep(text);
  for (const f of [tarballName("$VERSION"), tarballName("$VERSION", false), FEED, "install.sh"]) assert.ok(check.includes(` ${f}`) || check.includes(` "${f}"`), `the release checks ${f} is there`);
});

// (fails before: yes — servers were built for x64 alone)
test("the arm64 server build: on ARM64_RUNNER's runner or ubuntu-22.04-arm, skipped where SERVER_ARM64 is off, built as x64's is on glibc 2.35, and its files in the release where it ran — a release without them where it was skipped", async () => {
  const text = await yml();
  const arm = job(text, "server-arm64");
  const server = job(text, "server");
  const ARM = "linux-arm64";
  assert.match(arm, /\n {4}needs: version\n/);
  assert.match(arm, /\n {4}if: \$\{\{ vars\.SERVER_ARM64 != 'off' && \(github\.event_name != 'workflow_dispatch' \|\| inputs\.systems == 'all' \|\| inputs\.systems == 'server'\) \}\}\n/);
  assert.match(arm, /\n {4}runs-on: \$\{\{ vars\.ARM64_RUNNER \|\| 'ubuntu-22\.04-arm' \}\}\n/, "GitHub's free arm64 runner where the repository has it; a variable names another");
  const node = (/** @type {string} */ j) => /- uses: actions\/setup-node@v7\n {8}with:\n(?: {10}.*\n)+/.exec(j)?.[0];
  assert.ok(node(arm));
  assert.equal(node(arm), node(server), "x64's Node");
  const cache = (/** @type {string} */ j) => /\n {10}path: (vendor\/memory-engine\/\S+)\n {10}key: (.+)\n/.exec(j)?.slice(1);
  assert.deepEqual(cache(arm), [`vendor/memory-engine/${ARM}`, `memory-engine-${ARM}-\${{ hashFiles('src/adapters/sidecar/install.js', 'scripts/build-memory-bundle.mjs') }}`]);
  const at = (/** @type {string} */ s) => {
    const i = arm.indexOf(s);
    assert.ok(i > 0, `the arm64 job has ${s.trim()}`);
    return i;
  };
  // A runner the variable names may be on another glibc: anything but 22.04's stops the job before npm ci.
  assert.match(arm, /- name: The runner's glibc is Ubuntu 22\.04's\n {8}shell: bash\n {8}run: \|\n[\s\S]*?getconf GNU_LIBC_VERSION[\s\S]*?"glibc 2\.35"[\s\S]*?exit 1\n/);
  const order = ["getconf GNU_LIBC_VERSION", "run: npm ci\n", "uses: actions/cache@v6\n", "run: npm run engine:bundle\n", "run: npm run dist:server\n", "- name: Into the draft release\n", "uses: actions/upload-artifact@v7\n"];
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) < at(order[i]), `${order[i - 1].trim()} before ${order[i].trim()}`);
  const v = "${{ needs.version.outputs.version }}";
  assert.match(arm, new RegExp(`\\n {10}name: Filament-\\$\\{\\{ needs\\.version\\.outputs\\.version \\}\\}-server-${ARM}\\n`));
  // install.sh goes up with x64's alone: one file of one name in the release
  assert.deepEqual(keeps(arm), [tarballName(v, true, ARM), tarballName(v, false, ARM), feedName(ARM)].map((f) => `dist/server/${v}/${f}`));
  assert.deepEqual(sends(arm), keeps(arm));

  // The release runs with the arm64 job skipped — GitHub skips a job whose need was skipped, unless its `if` says
  // otherwise — and not where any job failed or was cancelled.
  const release = job(text, "release");
  assert.match(release, /\n {4}if: \$\{\{ !cancelled\(\) && startsWith\(github\.ref, 'refs\/tags\/v'\) && !contains\(needs\.\*\.result, 'failure'\) && !contains\(needs\.\*\.result, 'cancelled'\) \}\}\n/);
  const check = checkStep(text);
  assert.match(check, /\n {10}ARM64: \$\{\{ needs\.server-arm64\.result \}\}\n/);
  const armFiles = /\n\s+if \[ "\$ARM64" = success \]; then\n\s+arm64="([^"]+)"\n/.exec(check)?.[1];
  assert.deepEqual(armFiles?.split(" "), [tarballName("$VERSION", true, ARM), tarballName("$VERSION", false, ARM), feedName(ARM)], "arm64's files checked where its job ran");
  const listed = /\n\s+for f in ([\s\S]*?); do\n/.exec(check)?.[1] || "";
  assert.ok(listed.endsWith(" $arm64"), "the list takes arm64's where they are");
  assert.doesNotMatch(listed.replace(/ \$arm64$/, ""), /linux-arm64|latest-server-arm64/, "and asks for none of them otherwise");
  const notes = text.slice(text.indexOf("- name: The release's notes"));
  assert.match(notes, /\n {10}ARM64: \$\{\{ needs\.server-arm64\.result \}\}\n/, "the notes name arm64 where it was built");
});

// (fails before: yes — the run built Windows alone)
test("every system is built on its own machine by its own script, and the release has every file an installed app fetches", async () => {
  const text = await yml();
  /** @type {Record<string, { runner: RegExp, script: string, kinds: (keyof typeof ASSETS)[] }>} */
  const systems = {
    windows: { runner: /runs-on: windows-/, script: "npm run dist:win", kinds: ["nsis"] },
    mac: { runner: /runs-on: macos-/, script: "npm run dist:mac", kinds: ["mac"] },
    linux: { runner: /runs-on: ubuntu-/, script: "npm run dist:linux", kinds: ["appimage", "deb"] },
  };
  const check = checkStep(text);
  for (const [name, s] of Object.entries(systems)) {
    const j = job(text, name);
    assert.match(j, s.runner, name);
    assert.ok(j.includes(`run: ${s.script}\n`), `${name} runs ${s.script}`);
    for (const kind of s.kinds) {
      const file = ASSETS[kind].file("${{ needs.version.outputs.version }}");
      assert.ok(j.includes(`/${file}\n`), `${name} keeps ${file}`);
      assert.ok(j.includes(`/${ASSETS[kind].feed}\n`), `${name} keeps ${ASSETS[kind].feed}`);
      assert.ok(check.includes(ASSETS[kind].file("$VERSION")), `the release checks ${kind}'s file is there`);
      assert.ok(check.includes(` ${ASSETS[kind].feed}`), `the release checks ${ASSETS[kind].feed} is there`);
    }
  }
});

// (fails before: yes — there was no Mac build)
test("the Mac build: its secrets never reach npm ci, a release's app is signed and notarized or there is none, and the keychain goes after", async () => {
  const text = await yml();
  const mac = job(text, "mac");
  assert.doesNotMatch(mac.slice(0, mac.indexOf("steps:")), /secrets\./, "no secret in the job's env");
  const install = mac.indexOf("run: npm ci");
  assert.ok(install > 0 && install < mac.indexOf("- name: The certificate in a keychain of the run's own"), "the certificate comes after npm ci");
  assert.ok(mac.indexOf("- name: The certificate in a keychain of the run's own") < mac.indexOf("run: npm run engine:bundle"), "and before the engine's bundle, which signs its programs with it");
  assert.match(mac, /elif \[\[ "\$GITHUB_REF" == refs\/tags\/v\* \]\]; then\n\s+echo "::error::A release's Mac app must be signed and notarized/);
  assert.match(mac, /key: memory-engine-darwin-arm64-\$\{\{ steps\.signing\.outputs\.with \}\}-/, "a bundle kept signed apart from one kept unsigned");
  assert.match(mac, /- name: The keychain and the key gone\n\s+if: always\(\)/);
  // (fails before: yes — the review of 11-07: a certificate of another kind signed nothing, and electron-builder only warned)
  assert.match(mac, /if ! security find-identity -v -p codesigning "\$KEYCHAIN" \| grep -q '"Developer ID Application: '; then[\s\S]*?exit 1\n\s+fi/);
});
