// @ts-check
// The desktop app's updates (the owner's of 11-05; every system, asked in the app, the owner's of 11-07): the installed
// app finds a newer release on the public repository its releases go to, offers it, fetches the file for how it was
// installed once the person asks, takes it only where it matches the SHA-512 the release's latest*.yml gives, and asks
// again before it installs; a store's build opens its store. Nothing publishes from a build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSETS, createUpdater, fetchInstaller, installArgs, isNewer, kindOf, lookForUpdate, releasesRepoOf, repoOf, shaIn, STORE_PAGES } from "../desktop/lib/updates.js";
import { trayRows } from "../desktop/lib/tray.js";
import { namesPublish } from "../scripts/dist-win.mjs";

const sha = (/** @type {string | Buffer} */ b) => createHash("sha512").update(b).digest("base64");
const EXE = Buffer.from("MZ the installer of 0.9.0");
const yml = (/** @type {string} */ name, /** @type {string} */ sum) =>
  `version: 0.9.0\nfiles:\n  - url: ${name}\n    sha512: ${sum}\n    size: ${EXE.length}\npath: ${name}\nsha512: ${sum}\nreleaseDate: '2026-11-05T00:00:00.000Z'\n`;

/**
 * GitHub, faked: the newest release's JSON, its assets' bytes; every URL asked, in order.
 * @param {{ tag?: string, assets?: string[], yml?: string, exe?: Buffer, status?: number }} [o]
 */
const github = ({ tag = "v0.9.0", assets = ["Filament-0.9.0-setup-x64.exe", "latest.yml"], yml: y = yml("Filament-0.9.0-setup-x64.exe", sha(EXE)), exe = EXE, status = 200 } = {}) => {
  /** @type {string[]} */
  const asked = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url) => {
    const u = String(url);
    asked.push(u);
    if (u.endsWith("/releases/latest"))
      return status !== 200
        ? new Response("{}", { status })
        : Response.json({ tag_name: tag, html_url: "https://github.com/o/r/releases/tag/v0.9.0", assets: assets.map((name) => ({ name, size: exe.length, browser_download_url: `https://dl/${name}` })) });
    if (u === "https://dl/latest.yml") return new Response(y);
    if (u.startsWith("https://dl/")) return new Response(new Uint8Array(exe));
    return new Response("", { status: 404 });
  };
  return { fetchImpl, asked };
};

test("the repository a package.json names, versions compared, and the SHA-512 latest.yml gives a file", () => {
  assert.deepEqual(repoOf({ repository: { type: "git", url: "git+https://github.com/invertibleMatrix/web-shop.git" } }), { owner: "invertibleMatrix", repo: "web-shop" });
  assert.deepEqual(repoOf({ repository: "https://github.com/a/b" }), { owner: "a", repo: "b" });
  assert.deepEqual(repoOf({ repository: "git@github.com:a/b.git" }), { owner: "a", repo: "b" });
  assert.equal(repoOf({ repository: "https://gitlab.com/a/b" }), null);
  assert.equal(repoOf(null), null);
  // (fails before: yes — the owner's of 11-07: the app looked in the code's own repository, which was private then, and a
  // private repository's releases answer 404 to anyone not signed in, so releases went to filament-releases; the code is
  // public since 0.9.83, and its own repository holds the releases again, filament-releases a mirror of them for the apps
  // built before)
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const builder = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
  const publish = /^publish:\n((?: {2}.*\n)+)/m.exec(builder)?.[1] || "";
  const releases = releasesRepoOf(publish.replace(/^ {2}/gm, ""));
  assert.deepEqual(releases, { owner: "invertibleMatrix", repo: "filament" }, "the build names the releases' repository, so latest*.yml and app-update.yml are written");
  assert.deepEqual(releases, repoOf(pkg), "the code's own");
  // what electron-builder writes into the app (resources/app-update.yml), as the app reads it
  assert.deepEqual(releasesRepoOf("owner: invertibleMatrix\nrepo: filament-releases\nprovider: github\nupdaterCacheDirName: filament-updater\n"), { owner: "invertibleMatrix", repo: "filament-releases" });
  assert.equal(releasesRepoOf("provider: generic\nurl: https://x\n"), null);
  assert.equal(releasesRepoOf("provider: github\nowner: a/b\nrepo: c\n"), null, "no path in a name");
  assert.equal(releasesRepoOf(""), null);

  assert.equal(isNewer("0.9.0", "0.8.1"), true);
  assert.equal(isNewer("v0.8.10", "0.8.9"), true, "a v, and numbers, not letters");
  assert.equal(isNewer("0.8.1", "0.8.1"), false);
  assert.equal(isNewer("0.8.0", "0.8.1"), false);
  assert.equal(isNewer("1.0.0", "1.0.0-beta.2"), true, "a release comes after its prerelease");
  assert.equal(isNewer("1.0.0-beta.10", "1.0.0-beta.9"), true);
  assert.equal(isNewer("nightly", "0.8.1"), false);

  const y = yml("Filament-0.9.0-setup-x64.exe", "AbC+/=");
  assert.equal(shaIn(y, "Filament-0.9.0-setup-x64.exe"), "AbC+/=");
  assert.equal(shaIn(y, "other.exe"), null);
  assert.equal(shaIn("path: x.exe\nsha512: 'Zz=='\n", "x.exe"), "Zz==", "the older form, quoted");
  assert.deepEqual([installArgs(true), installArgs(false)], [["/S", "--updated", "--force-run"], ["/S", "--updated"]]);
});

test("a newer release is an update only with its installer and that installer's SHA-512; else none, saying why", async () => {
  const at = { owner: "o", repo: "r" };
  const found = await lookForUpdate({ current: "0.8.1", ...at, fetchImpl: github().fetchImpl });
  assert.deepEqual(found, { update: { version: "0.9.0", name: "Filament-0.9.0-setup-x64.exe", url: "https://dl/Filament-0.9.0-setup-x64.exe", size: EXE.length, sha512: sha(EXE), page: "https://github.com/o/r/releases/tag/v0.9.0", kind: "nsis" }, why: "" });
  const none = async (/** @type {any} */ g, current = "0.8.1") => (await lookForUpdate({ current, ...at, fetchImpl: g.fetchImpl })).why;
  assert.equal(await none(github(), "0.9.0"), "0.9.0 is as new as the newest release (0.9.0)");
  assert.equal(await none(github({ assets: ["Filament-0.9.0-setup-x64.exe"] })), "release 0.9.0 carries no latest.yml to check its Filament-0.9.0-setup-x64.exe by");
  assert.equal(await none(github({ assets: ["latest.yml"] })), "release 0.9.0 carries no Filament-0.9.0-setup-x64.exe");
  // (fails before: yes — the review of 85ff00e86: any *-setup-x64.exe was taken, and another version's under the tag
  // installed as a downgrade, again at every Quit)
  assert.equal(await none(github({ assets: ["Filament-0.8.0-setup-x64.exe", "latest.yml"], yml: yml("Filament-0.8.0-setup-x64.exe", sha(EXE)) })), "release 0.9.0 carries no Filament-0.9.0-setup-x64.exe");
  assert.equal(await none(github({ yml: yml("Another-setup-x64.exe", "x") })), "release 0.9.0's latest.yml gives no SHA-512 for Filament-0.9.0-setup-x64.exe");
  assert.equal(await none(github({ status: 404 })), "o/r has no release, or is not public");
  assert.equal(await none(github({ status: 403 })), "GitHub answered HTTP 403");
  assert.equal(await none(github({ tag: "nightly" })), 'the newest release\'s tag ("nightly") is no version');
});

test("the installer is kept only where it matches its SHA-512; one there already that matches is not fetched again; older ones go", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-updates-"));
  try {
    const at = { owner: "o", repo: "r" };
    writeFileSync(join(dir, "Filament-0.8.5-setup-x64.exe"), "an older one");
    const g = github();
    const { update } = await lookForUpdate({ current: "0.8.1", ...at, fetchImpl: g.fetchImpl });
    assert.ok(update);
    const file = await fetchInstaller(update, dir, { fetchImpl: g.fetchImpl });
    assert.equal(file, join(dir, "Filament-0.9.0-setup-x64.exe"));
    assert.deepEqual(readFileSync(file), EXE);
    assert.deepEqual(readdirSync(dir), ["Filament-0.9.0-setup-x64.exe"], "no .part, no older installer");
    const n = g.asked.length;
    await fetchInstaller(update, dir, { fetchImpl: g.fetchImpl });
    assert.equal(g.asked.length, n, "a whole one there is not fetched again");

    rmSync(file);
    const bad = github({ exe: Buffer.from("MZ something else") });
    await assert.rejects(() => fetchInstaller(update, dir, { fetchImpl: bad.fetchImpl }), /the download of Filament 0\.9\.0 does not match the SHA-512 its release gives: it was not kept/);
    assert.deepEqual(readdirSync(dir), [], "nothing of it is left");
    // One there already that does not match is fetched again.
    writeFileSync(file, "tampered");
    await fetchInstaller(update, dir, { fetchImpl: g.fetchImpl });
    assert.deepEqual(readFileSync(file), EXE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the updater: a look offers the update and fetches nothing; asked, it fetches once, its progress said, then ready; off, it asks nothing; a failure tries again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-updater-"));
  try {
    const g = github();
    /** @type {any[]} */
    const moves = [];
    /** @type {string[]} */
    const said = [];
    let on = true;
    const up = createUpdater({ current: "0.8.1", repo: { owner: "o", repo: "r" }, dir, fetchImpl: g.fetchImpl, log: (l) => said.push(l), onChange: (s) => moves.push({ ...s }), enabled: () => on });
    assert.equal(up.state.phase, "none");
    await Promise.all([up.look(), up.look()]);
    // (fails before: yes — the owner's of 11-07: a look fetched the installer unasked)
    assert.deepEqual(moves.map((m) => [m.phase, m.version]), [["available", "0.9.0"]], "two looks at once are one, and nothing is fetched");
    assert.equal(g.asked.filter((u) => u.endsWith(".exe")).length, 0);
    assert.equal(up.available?.version, "0.9.0");
    await up.look();
    assert.equal(moves.length, 1, "the same version is not offered twice");
    await Promise.all([up.fetch(), up.fetch()]);
    assert.equal(g.asked.filter((u) => u.endsWith(".exe")).length, 1, "two asks at once are one download");
    assert.deepEqual([moves[1].phase, moves.at(-1).phase], ["downloading", "ready"]);
    assert.ok(moves.some((m) => m.phase === "downloading" && m.received === EXE.length && m.size === EXE.length), "its progress");
    assert.equal(up.ready?.file, join(dir, "Filament-0.9.0-setup-x64.exe"));
    const n = moves.length;
    await up.fetch();
    assert.equal(moves.length, n, "ready: nothing fetched again");
    on = false;
    const asked = g.asked.length;
    await up.look();
    assert.equal(g.asked.length, asked, "updates off: GitHub is not asked");
    // a download that fails: failed, and why; asked again, it tries again
    rmSync(dir, { recursive: true, force: true });
    const bad = github({ exe: Buffer.from("MZ something else") });
    const once = createUpdater({ current: "0.8.1", repo: { owner: "o", repo: "r" }, dir, fetchImpl: bad.fetchImpl });
    await once.look();
    await once.fetch();
    assert.deepEqual([once.state.phase, once.ready], ["failed", null]);
    assert.match(once.state.why, /does not match the SHA-512/);
    await once.fetch();
    assert.equal(bad.asked.filter((u) => u.endsWith(".exe")).length, 2);
    const broken = createUpdater({ current: "0.8.1", repo: { owner: "o", repo: "r" }, dir, fetchImpl: async () => { throw new Error("offline"); }, log: (l) => said.push(l) });
    await broken.look();
    assert.equal(broken.available, null);
    assert.match(said.at(-1) || "", /^updates: the look failed \(offline\); the next one tries again$/);
    const unnamed = createUpdater({ current: "0.8.1", repo: null, dir, fetchImpl: () => assert.fail("asked") });
    await unnamed.look();
    // (fails before: yes — the same review: the installer of the update it came by stayed in the app's folder until the
    // next release) The build that runs is the newest: the folder empties.
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Filament-0.9.0-setup-x64.exe.part"), "cut");
    const updated = createUpdater({ current: "0.9.0", repo: { owner: "o", repo: "r" }, dir, fetchImpl: github().fetchImpl });
    await updated.look();
    assert.deepEqual(readdirSync(dir), [], "the spent installer and a cut download go");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the review of 11-07: Try again fetched the offer as it was first read, so a release whose files
// were uploaded again failed its SHA-512 at every try until the app restarted; and a release pulled while it was
// offered stayed offered)
test("Try again reads the release as it stands, and a release pulled while it is offered is offered no more", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-updater-"));
  try {
    // the release's installer uploaded again under the same version: the first read's SHA-512 is the old file's
    let rebuilt = false;
    const NEW = Buffer.from("MZ the installer of 0.9.0, built again");
    const first = github({ yml: yml("Filament-0.9.0-setup-x64.exe", sha(EXE)), exe: NEW });
    const then = github({ yml: yml("Filament-0.9.0-setup-x64.exe", sha(NEW)), exe: NEW });
    /** @type {typeof fetch} */
    const fetchImpl = (url, init) => (rebuilt ? then : first).fetchImpl(url, init);
    const up = createUpdater({ current: "0.8.1", repo: { owner: "o", repo: "r" }, dir, fetchImpl });
    await up.look();
    await up.fetch();
    assert.deepEqual([up.state.phase, up.ready], ["failed", null]);
    rebuilt = true;
    await up.fetch();
    assert.equal(up.state.phase, "ready", "the second try checks the file by the SHA-512 the release gives now");
    assert.equal(readFileSync(/** @type {any} */ (up.ready).file, "utf8"), String(NEW));
    // offered, not taken, then the release is pulled: the newest release is the build that runs
    rmSync(dir, { recursive: true, force: true });
    let pulled = false;
    /** @type {typeof fetch} */
    const pulling = (url, init) => (pulled ? github({ tag: "v0.8.1" }) : github()).fetchImpl(url, init);
    /** @type {string[]} */
    const phases = [];
    const offered = createUpdater({ current: "0.8.1", repo: { owner: "o", repo: "r" }, dir, fetchImpl: pulling, onChange: (s) => phases.push(s.phase) });
    await offered.look();
    pulled = true;
    await offered.look();
    assert.deepEqual([phases, offered.available, offered.state.version], [["available", "none"], null, ""]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the owner's of 11-08, Settings › About's Check now: a look said nothing of what it found, and none
// ran while the looking was off)
test("a look says what it found, and one the person asks for looks while the looking is off", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-updater-"));
  const repo = { owner: "o", repo: "r" };
  try {
    const g = github();
    const up = createUpdater({ current: "0.8.1", repo, dir, fetchImpl: g.fetchImpl, enabled: () => false });
    assert.deepEqual(await up.look(), { result: "off" });
    assert.equal(g.asked.length, 0, "off: GitHub is not asked by itself");
    assert.deepEqual(await up.look(true), { result: "out", version: "0.9.0" });
    assert.equal(up.state.phase, "available", "offered as a look by itself offers it");
    assert.deepEqual(await up.look(true), { result: "out", version: "0.9.0" }, "asked again: still out");
    const newest = createUpdater({ current: "0.9.0", repo, dir, fetchImpl: github().fetchImpl });
    assert.deepEqual(await newest.look(true), { result: "newest", version: "0.9.0" });
    const bare = createUpdater({ current: "0.8.1", repo, dir, fetchImpl: github({ assets: ["latest.yml"] }).fetchImpl });
    assert.deepEqual(await bare.look(true), { result: "none", why: "release 0.9.0 carries no Filament-0.9.0-setup-x64.exe" });
    const none = createUpdater({ current: "0.8.1", repo, dir, fetchImpl: github({ status: 404 }).fetchImpl });
    assert.deepEqual(await none.look(true), { result: "none", why: "o/r has no release, or is not public" });
    // (fails before: yes — the review of 11-08: GitHub's refusal read as no update to take)
    const limited = createUpdater({ current: "0.8.1", repo, dir, fetchImpl: github({ status: 403 }).fetchImpl });
    assert.deepEqual(await limited.look(true), { result: "failed", why: "GitHub answered HTTP 403" });
    // (fails before: yes — the same review: a stalled look held every look after it, and Check now's "Checking…")
    /** @type {typeof fetch} */
    const stalls = (_url, init) => new Promise((_, no) => init?.signal?.addEventListener("abort", () => no(init.signal?.reason)));
    const stalled = createUpdater({ current: "0.8.1", repo, dir, fetchImpl: stalls, lookMs: 20 });
    assert.deepEqual(await stalled.look(true), { result: "failed", why: "GitHub didn't answer within 0 seconds" });
    const offline = createUpdater({ current: "0.8.1", repo, dir, fetchImpl: async () => { throw new Error("offline"); } });
    assert.deepEqual(await offline.look(true), { result: "failed", why: "offline" });
    const unnamed = createUpdater({ current: "0.8.1", repo: null, dir, fetchImpl: () => assert.fail("asked") });
    assert.deepEqual(await unnamed.look(true), { result: "none", why: "this build names no repository to look in" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — the owner's of 11-07: the updater knew Windows' installer alone, and a store's build would have
// fetched one)
test("each kind of install: its own file and update file, named as electron-builder.yml names them; a store's build offers its store, and fetches nothing", async () => {
  assert.deepEqual(
    [kindOf({ platform: "win32" }), kindOf({ platform: "darwin" }), kindOf({ platform: "linux", appImage: "/home/a/Filament.AppImage" }), kindOf({ platform: "linux", packageType: "deb\n", execPath: "/opt/Filament/filament-desktop" }), kindOf({ platform: "linux" })],
    ["nsis", "mac", "appimage", "deb", "page"],
  );
  // (fails before: yes — the review of 11-07: electron-builder writes the deb's package-type into the unpacked build's
  // resources too, so the app run from linux-unpacked offered to install a deb system-wide)
  assert.equal(kindOf({ platform: "linux", packageType: "deb", execPath: "/home/a/filament/dist/linux/0.9.0/linux-unpacked/filament-desktop" }), "page");
  assert.deepEqual([kindOf({ platform: "darwin", mas: true }), kindOf({ platform: "win32", windowsStore: true })], ["mac-store", "windows-store"]);
  const builder = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
  // electron-builder spells x64 x86_64 in an AppImage's name and amd64 in a deb's (builder-util's getArtifactArchName)
  const artifact = (/** @type {string} */ section) => new RegExp(`^${section}:\\n(?: {2}.*\\n|\\s*\\n)*? {2}artifactName: (.+)$`, "m").exec(builder)?.[1] || "";
  const named = (/** @type {string} */ pattern, /** @type {string} */ arch, /** @type {string} */ ext) => pattern.replace("${version}", "1.2.3").replace("${arch}", arch).replace("${ext}", ext);
  assert.equal(ASSETS.nsis?.file("1.2.3"), named(artifact("nsis"), "x64", "exe"));
  assert.equal(ASSETS.mac?.file("1.2.3"), named(artifact("mac"), "arm64", "zip"));
  assert.equal(ASSETS.appimage?.file("1.2.3"), named(artifact("linux"), "x86_64", "AppImage"));
  assert.equal(ASSETS.deb?.file("1.2.3"), named(artifact("linux"), "amd64", "deb"));
  assert.deepEqual([ASSETS.nsis?.feed, ASSETS.mac?.feed, ASSETS.appimage?.feed, ASSETS.deb?.feed], ["latest.yml", "latest-mac.yml", "latest-linux.yml", "latest-linux.yml"]);
  // a Mac's update: the zip, by latest-mac.yml
  const zip = Buffer.from("PK the app");
  const mac = github({ assets: ["Filament-0.9.0-mac-arm64.dmg", "Filament-0.9.0-mac-arm64.zip", "latest-mac.yml"], exe: zip, yml: yml("Filament-0.9.0-mac-arm64.zip", sha(zip)) });
  /** @type {typeof fetch} */
  const macFetch = async (url, init) => (String(url) === "https://dl/latest-mac.yml" ? mac.fetchImpl("https://dl/latest.yml", init) : mac.fetchImpl(url, init));
  const got = await lookForUpdate({ current: "0.8.1", owner: "o", repo: "r", kind: "mac", fetchImpl: macFetch });
  assert.deepEqual([got.update?.name, got.update?.sha512, got.update?.kind], ["Filament-0.9.0-mac-arm64.zip", sha(zip), "mac"]);
  assert.equal((await lookForUpdate({ current: "0.8.1", owner: "o", repo: "r", kind: "deb", fetchImpl: github().fetchImpl })).why, "release 0.9.0 carries no Filament-0.9.0-linux-amd64.deb");
  // a store's build: the version and the page, nothing to fetch, its store's updates page
  for (const kind of /** @type {const} */ (["mac-store", "windows-store", "page"])) {
    const g = github();
    const { update } = await lookForUpdate({ current: "0.8.1", owner: "o", repo: "r", kind, fetchImpl: g.fetchImpl });
    assert.deepEqual(update, { version: "0.9.0", name: "", url: "", size: 0, sha512: "", page: "https://github.com/o/r/releases/tag/v0.9.0", kind });
    const up = createUpdater({ current: "0.8.1", repo: { owner: "o", repo: "r" }, dir: join(tmpdir(), "filament-never"), kind, fetchImpl: g.fetchImpl });
    await up.look();
    await up.fetch();
    assert.deepEqual([up.state.phase, up.ready], ["available", null], kind);
    assert.ok(!g.asked.some((u) => u.startsWith("https://dl/")), `${kind} fetches nothing`);
  }
  assert.deepEqual(STORE_PAGES, { "mac-store": "macappstore://showUpdatesPage", "windows-store": "ms-windows-store://downloadsandupdates" });
});

test("the tray: Check for updates where the installed app offers it, and the update's row as its notice has it — Update, its download, Restart to update; a build publishes nothing unless told", () => {
  const ids = (/** @type {any} */ f) => trayRows(f).map((r) => ("type" in r ? "-" : r.id)).join(" ");
  assert.equal(ids({ owned: true, state: "up", port: 1 }), "card harness dashboard - restart - logon notify - quit", "a checkout: neither");
  assert.equal(ids({ owned: true, state: "up", port: 1, updates: true }), "card harness dashboard - restart - logon notify updates - quit");
  const u = (/** @type {any} */ o) => ({ phase: "available", version: "0.9.0", kind: "nsis", page: "", received: 0, size: 100, why: "", ...o });
  const row = (/** @type {any} */ update) => /** @type {any} */ (trayRows({ owned: true, state: "up", port: 1, updates: true, update }).find((r) => "id" in r && r.id.startsWith("update-") || ("id" in r && r.id === "update")));
  assert.equal(ids({ owned: true, state: "up", port: 1, updates: true, update: u({ phase: "ready" }) }), "card harness dashboard - restart update - logon notify updates - quit");
  // (fails before: yes — the owner's of 11-07: the tray's row was Restart to update alone, the installer fetched unasked)
  assert.deepEqual([row(u({})).id, row(u({})).label], ["update-get", "Update to Filament 0.9.0"]);
  assert.deepEqual([row(u({ phase: "downloading", received: 42 })).label, row(u({ phase: "downloading", received: 42 })).enabled], ["Downloading Filament 0.9.0… 42%", false]);
  assert.equal(row(u({ phase: "failed" })).label, "Update to Filament 0.9.0 (try again)");
  assert.deepEqual([row(u({ phase: "ready" })).id, row(u({ phase: "ready" })).label], ["update", "Restart to update to Filament 0.9.0"]);
  assert.equal(row(u({ kind: "mac-store" })).label, "Update to Filament 0.9.0 in the App Store");
  assert.equal(row(u({ kind: "page" })).label, "See Filament 0.9.0's release");
  assert.equal(row(null), undefined);
  assert.equal(/** @type {any} */ (trayRows({ owned: true, state: "up", port: 1, updates: true }).find((r) => "id" in r && r.id === "updates")).label, "Check for updates");
  assert.equal(/** @type {any} */ (trayRows({ owned: true, state: "up", port: 1, updates: false }).find((r) => "id" in r && r.id === "updates")).checked, false);

  assert.equal(namesPublish([]), false);
  assert.equal(namesPublish(["--dir"]), false);
  assert.equal(namesPublish(["--publish", "always"]), true);
  assert.equal(namesPublish(["-p=onTag"]), true);
  assert.match(readFileSync(new URL("../scripts/dist.mjs", import.meta.url), "utf8"), /if \(!namesPublish\(args\)\) args = \[\.\.\.args, "--publish", "never"\];/, "electron-builder is told to publish nothing");
  assert.ok(existsSync(new URL("../desktop/lib/updates.js", import.meta.url)));
});
