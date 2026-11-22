// @ts-check
// Antigravity from Google's own release feed (the owner's of 11-22: a model Google released did not show on Refresh,
// as the 1.4.5 Filament had installed from ACP's registry listed none of Google's newer models, and before 1.5.1 showed
// Filament only its Gemini ones). The feed's answer is checked, kept in the data folder and read again once an hour
// old; laid over the registry's entry, it gives Antigravity's version and its one program for this computer — never
// the older server the registry lists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGY_FEED_URL, AGY_FEED_STALE_MS, agyProgram, checkRelease, createAgyFeed, feedTarget, withAgyFeed } from "../src/adapters/agents/agy-feed.js";

/** Google's answer for Windows as it read on 11-22. */
const RELEASE = {
  version: "1.5.14",
  url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.14-5302690847260672/windows-x64/cli_windows_x64.exe",
  sha512: "785548b23242ec9112759bb4b525d94a3d4d2e9868e5cedb9ea34e5ce01dbb00abf5de66c41d8f4903e8a4379445f685483f999ece91867bfbd9d4812760d835",
};

/**
 * A stand-in for the feed's address: each ask kept, answered with `answer` (a body, or a status).
 * @param {() => any} answer
 */
function feedFetch(answer) {
  /** @type {string[]} */
  const asked = [];
  /** @param {any} url */
  const get = async (url) => {
    asked.push(String(url));
    const a = answer();
    return typeof a === "number" ? new Response("no", { status: a }) : new Response(JSON.stringify(a));
  };
  return { asked, get: /** @type {any} */ (get) };
}

test("each system as the feed names it; one it names none of is null", () => {
  assert.deepEqual(
    [feedTarget("win32", "x64"), feedTarget("win32", "arm64"), feedTarget("darwin", "arm64"), feedTarget("darwin", "x64"), feedTarget("linux", "x64"), feedTarget("linux", "arm64")],
    ["windows_amd64", "windows_arm64", "darwin_arm64", "darwin_amd64", "linux_amd64", "linux_arm64"],
  );
  assert.deepEqual([feedTarget("freebsd", "x64"), feedTarget("linux", "ia32")], [null, null]);
});

test("the feed's answer is checked: three numbers, Google's bucket over https, a SHA-512; anything else refused in words", () => {
  assert.deepEqual(checkRelease({ ...RELEASE, sha512: RELEASE.sha512.toUpperCase(), extra: 1 }), RELEASE);
  for (const [why, raw, said] of /** @type {[string, any, RegExp][]} */ ([
    ["a version that isn't one", { ...RELEASE, version: "1.5.14; rm -rf" }, /version/],
    ["no version", { url: RELEASE.url, sha512: RELEASE.sha512 }, /version/],
    ["plain http", { ...RELEASE, url: RELEASE.url.replace("https:", "http:") }, /bucket/],
    ["another host", { ...RELEASE, url: "https://example.test/antigravity-public/antigravity-cli/agy.exe" }, /bucket/],
    ["another bucket", { ...RELEASE, url: "https://storage.googleapis.com/someone-else/antigravity-cli/agy.exe" }, /bucket/],
    ["credentials in its address", { ...RELEASE, url: RELEASE.url.replace("https://", "https://u:p@") }, /bucket/],
    ["a sha256 for a SHA-512", { ...RELEASE, sha512: "a".repeat(64) }, /SHA-512/],
    ["nothing at all", null, /version/],
  ]))
    assert.throws(() => checkRelease(raw), said, why);
});

test("the program a release installs: agy.exe on Windows, the tarball's one `antigravity` elsewhere; started as an ACP server in its old folder's name, its own updater off", () => {
  const win = agyProgram(RELEASE, "win32");
  assert.deepEqual(win, { archive: RELEASE.url, cmd: "agy.exe", args: ["acp", "--app-data-dir", "antigravity-acp"], env: { AGY_CLI_DISABLE_AUTO_UPDATE: "1" }, sha256: null, sha512: RELEASE.sha512, from: "Google's release feed" });
  assert.equal(agyProgram(RELEASE, "darwin").cmd, "antigravity");
  assert.equal(agyProgram(RELEASE, "linux").cmd, "antigravity");
  win.args.push("x");
  assert.deepEqual(agyProgram(RELEASE, "win32").args, ["acp", "--app-data-dir", "antigravity-acp"], "each its own copy");
});

test("the feed read for this computer, kept in the data folder and read back; stale once an hour old; a failed read keeps the copy and says why", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agy-feed-"));
  try {
    let now = 1_000;
    /** @type {any} */
    let answer = RELEASE;
    const f = feedFetch(() => answer);
    const feed = createAgyFeed({ dir, fetch: f.get, now: () => now, platform: "win32", arch: "x64" });
    assert.deepEqual([feed.view().release, feed.stale()], [null, true], "nothing read yet");
    await feed.refresh();
    assert.deepEqual(f.asked, [`${AGY_FEED_URL}/windows_amd64.json`]);
    assert.deepEqual([feed.view().release, feed.view().at, feed.view().error, feed.stale()], [RELEASE, 1_000, null, false]);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "agy-feed.json"), "utf8")), { at: 1_000, target: "windows_amd64", release: RELEASE });
    // Read back by the next start; a copy kept for another system is not this one's.
    assert.deepEqual(createAgyFeed({ dir, fetch: f.get, now: () => now, platform: "win32", arch: "x64" }).view().release, RELEASE);
    assert.equal(createAgyFeed({ dir, fetch: f.get, now: () => now, platform: "linux", arch: "x64" }).view().release, null);
    now += AGY_FEED_STALE_MS + 1;
    assert.equal(feed.stale(), true, "an hour old");
    answer = 503;
    await feed.refresh();
    assert.deepEqual([feed.view().release, feed.view().error], [RELEASE, "it answered 503"], "the copy stays; why is said");
    answer = { ...RELEASE, url: "https://example.test/agy.exe" };
    await feed.refresh();
    assert.deepEqual([feed.view().release, feed.view().error], [RELEASE, "its download isn't in Google's bucket for the CLI"]);
    answer = { ...RELEASE, version: "1.5.15" };
    await feed.refresh();
    assert.deepEqual([feed.view().release?.version, feed.view().error], ["1.5.15", null]);
    // A system the feed names none of asks nothing, and is never stale.
    const none = feedFetch(() => RELEASE);
    const other = createAgyFeed({ dir, fetch: none.get, platform: "freebsd", arch: "x64" });
    await other.refresh();
    assert.deepEqual([none.asked, other.stale(), other.view().release], [[], false, null]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A registry stand-in listing `agents`; each read kept. @param {any[]} agents @param {{ stale?: boolean }} [o] */
function registryOf(agents, { stale = false } = {}) {
  const r = { reads: 0, view: () => ({ at: 1, agents, asking: false, error: null }), refresh: async () => void r.reads++, stale: () => stale, iconOf: (/** @type {string} */ id) => `/icons/${id}.svg` };
  return r;
}
/** The registry's entry for Antigravity: Google's older server, at the registry's version. */
const LISTED = {
  id: "antigravity-acp", name: "Google Antigravity", version: "1.5.2", description: "Google's agent", authors: ["Google"], license: "proprietary", licenseUrl: null, website: "https://antigravity.google", repository: null, icon: "https://cdn.agentclientprotocol.com/icons/antigravity.svg",
  npx: null, uvx: null, binary: { "windows-x86_64": { archive: "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.5.2-windows-x86_64.zip", cmd: "./agy_acp_server.exe", args: [], env: {}, sha256: null } },
};
const OTHER = { ...LISTED, id: "other-agent", name: "Other", version: "2.0.0" };

test("laid over the registry: Antigravity's words and icon the registry's, its version and program the feed's for this computer alone; before the feed is read, no program at all", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agy-over-"));
  try {
    const f = feedFetch(() => RELEASE);
    const feed = createAgyFeed({ dir, fetch: f.get, platform: "win32", arch: "x64" });
    const reg = registryOf([LISTED, OTHER]);
    const over = withAgyFeed(reg, feed, { platform: "win32", arch: "x64" });
    const before = /** @type {any} */ (over.view().agents.find((a) => a.id === "antigravity-acp"));
    assert.deepEqual([before.version, before.binary, before.name, before.waiting], ["", null, "Google Antigravity", "Google's release feed hasn't been read yet: Refresh"], "never the registry's older server, nor its version");
    await over.refresh();
    const v = over.view();
    assert.equal(/** @type {any} */ (v.agents.find((x) => x.id === "antigravity-acp")).waiting, undefined, "read, nothing to wait for");
    assert.equal(v.error, null);
    const a = /** @type {any} */ (v.agents.find((x) => x.id === "antigravity-acp"));
    assert.deepEqual([a.name, a.description, a.website, a.icon, a.version, Object.keys(a.binary)], [LISTED.name, LISTED.description, LISTED.website, LISTED.icon, "1.5.14", ["windows-x86_64"]]);
    assert.deepEqual(a.binary["windows-x86_64"], agyProgram(RELEASE, "win32"));
    assert.deepEqual(v.agents.find((x) => x.id === "other-agent"), OTHER, "the rest are the registry's");
    assert.equal(over.iconOf("antigravity-acp"), "/icons/antigravity-acp.svg");
    // A feed that can't be read, on a fresh install: the entry says why, and so does the registry's line.
    const down = withAgyFeed(registryOf([LISTED]), createAgyFeed({ dir: join(dir, "down"), fetch: feedFetch(() => 503).get, platform: "win32", arch: "x64" }), { platform: "win32", arch: "x64" });
    await down.refresh();
    const unread = /** @type {any} */ (down.view().agents[0]);
    assert.deepEqual([unread.binary, unread.waiting, down.view().error], [null, "Google's release feed couldn't be read (it answered 503): Refresh to try again", "Google's release feed for Antigravity: it answered 503"]);
    // A system the feed names none of waits for nothing: no build for it.
    assert.equal(/** @type {any} */ (withAgyFeed(registryOf([LISTED]), createAgyFeed({ dir, fetch: f.get, platform: "freebsd", arch: "x64" }), { platform: "freebsd", arch: "x64" }).view().agents[0]).waiting, undefined);
    // A registry that lists no Antigravity: the entry is the feed's alone.
    const bare = withAgyFeed(registryOf([OTHER]), feed, { platform: "win32", arch: "x64" });
    const made = /** @type {any} */ (bare.view().agents.find((x) => x.id === "antigravity-acp"));
    assert.deepEqual([made.name, made.version, made.binary?.["windows-x86_64"]?.cmd], ["Google Antigravity", "1.5.14", "agy.exe"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Refresh reads both; a stale-only read reads the feed each hour and the registry only once it is a day old", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agy-stale-"));
  try {
    let now = 0;
    const f = feedFetch(() => RELEASE);
    const feed = createAgyFeed({ dir, fetch: f.get, now: () => now, platform: "linux", arch: "x64" });
    const reg = registryOf([LISTED]);
    const over = withAgyFeed(reg, feed, { platform: "linux", arch: "x64" });
    assert.equal(over.stale(), true, "the feed never read");
    await over.refresh({ staleOnly: true });
    assert.deepEqual([f.asked.length, reg.reads], [1, 0], "the registry is fresh: only the feed is read");
    assert.equal(over.stale(), false);
    now += AGY_FEED_STALE_MS + 1;
    assert.equal(over.stale(), true, "the feed an hour old");
    await over.refresh();
    assert.deepEqual([f.asked.length, reg.reads], [2, 1], "Refresh reads both");
    // Off Windows, the program is the tarball's `antigravity`.
    assert.equal(/** @type {any} */ (over.view().agents[0]).binary["linux-x86_64"].cmd, "antigravity");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
