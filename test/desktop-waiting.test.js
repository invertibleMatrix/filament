// @ts-check
// The desktop app's window while its Filament starts (the owner's of 10-31: after an install "it takes quite a lot of
// time to show up on full screen but the tray icon shows up way before that and in the mean time users will be confused
// nothing happened … so that users don't go over desktop and press double click to double open it"). The harness's
// window shows at the launch, with the app's own page saying Filament is starting; Filament's page comes into the same
// window at its first answer; a second launch meanwhile brings that window forward. Electron itself is driven by
// `npm run test:desktop` (its check 31).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appVersion } from "../desktop/lib/build-info.js";
import { downWords } from "../desktop/lib/card.js";
import { frameOf } from "../desktop/lib/frame.js";
import { underWay, waitPage, waitWords } from "../desktop/lib/waiting.js";

const read = (/** @type {string} */ f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const html = (/** @type {string} */ url) => decodeURIComponent(url.replace(/^data:text\/html;charset=utf-8,/, ""));

// (fails before: yes — no page: the window waited for Filament's answer, unseen)
test("what the window says: Filament is starting and opens there; past that, what holds it, in the card's words", () => {
  assert.deepEqual(waitWords("starting", 20300), { title: "Filament is starting", line: "It opens here as soon as it is ready." });
  for (const s of ["late", "restarting", "stopping", "taken", "failed", "stopped"]) assert.deepEqual(waitWords(s, 20311), downWords(s, 20311), s);
  assert.match(waitWords("late", 1).line, /server\.log/);
  assert.match(waitWords("taken", 20311).line, /Port 20311 is another program's/);
  assert.deepEqual(["starting", "late", "restarting", "stopping"].map(underWay), [true, true, true, true], "on its way: the page spins");
  assert.deepEqual(["up", "taken", "failed", "stopped"].map(underWay), [false, false, false, false], "a start that failed spins no more");
});

// (fails before: yes — no page)
test("the page: Filament's mark, what holds it, a spinner while it is on its way, in the window's own colours, nothing run in it", () => {
  const starting = html(waitPage(waitWords("starting", 1), { dark: true, busy: true, version: "0.6.1" }));
  assert.ok(waitPage({ title: "t", line: "l" }, { dark: true, busy: true }).startsWith("data:text/html;charset=utf-8,"));
  assert.match(starting, /<div class="title">Filament is starting<\/div><div class="line">It opens here as soon as it is ready\.<\/div><div class="spin" aria-hidden="true"><\/div>/);
  assert.match(starting, /role="status" aria-live="polite"/, "a screen reader hears it");
  assert.match(starting, /<span class="tile"[^>]*><svg/, "Filament's mark, as the card draws it");
  assert.match(starting, /<div class="version">Filament 0\.6\.1<\/div>/, "the version just installed");
  assert.match(starting, /@media \(prefers-reduced-motion:reduce\)\{\.spin\{animation-duration:2\.4s\}\}/);
  assert.doesNotMatch(starting, /<script|on[a-z]+=/i, "nothing runs in it");
  const failed = html(waitPage(waitWords("failed", 1), { dark: true, busy: false }));
  assert.doesNotMatch(failed, /class="spin"/, "no spinner once it does not start");
  assert.doesNotMatch(failed, /class="version"/);
  const escaped = html(waitPage({ title: "a <b>", line: 'x & "y"' }, { dark: false, busy: false }));
  assert.match(escaped, /a &lt;b&gt;/);
  assert.match(escaped, /x &amp; &quot;y&quot;/);
  assert.doesNotMatch(escaped, /a <b>/);
  // The window's own ground, as main.js gives it: no flash of another colour as the window shows, nor as Filament's
  // page comes in.
  const ground = /backgroundColor: nativeTheme\.shouldUseDarkColors \? "(#[0-9a-f]{6})" : "(#[0-9a-f]{6})",/.exec(read("desktop/main.js"));
  assert.ok(ground, "the window's background in main.js");
  assert.match(starting, new RegExp(`html,body\\{margin:0;height:100%;background:${ground[1]};`));
  assert.match(escaped, new RegExp(`html,body\\{margin:0;height:100%;background:${ground[2]};`));
});

// (fails before: yes — the drive of 10-31: run from a checkout, Electron's `app.getVersion()` is Electron's own, and the
// page said "Filament 45.0.0")
test("the version under it is Filament's, as its package.json says it; none where that does not read", () => {
  assert.equal(appVersion(fileURLToPath(new URL("..", import.meta.url))), JSON.parse(read("package.json")).version);
  const empty = mkdtempSync(join(tmpdir(), "filament-waiting-"));
  try {
    assert.equal(appVersion(empty), "");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

// (fails before: yes — no page)
test("on Windows its top row is the title bar's: as tall as Filament's, in the colour its controls wear, and it drags the window", () => {
  for (const dark of [true, false]) {
    const bar = /** @type {{ height: number, color: string }} */ (frameOf({ platform: "win32", dark }).titleBarOverlay);
    const page = html(waitPage(waitWords("starting", 1), { dark, busy: true, bar }));
    assert.match(page, new RegExp(`\\.bar\\{height:${bar.height}px;background:${bar.color};-webkit-app-region:drag\\}`), dark ? "dark" : "light");
    assert.match(page, new RegExp(`\\.main\\{box-sizing:border-box;height:calc\\(100% - ${bar.height}px\\);`));
  }
  // Elsewhere, and in the dashboard's window, the system's own frame: no row of the page's.
  assert.match(html(waitPage(waitWords("starting", 1), { dark: true, busy: true })), /\.bar\{height:0px;/);
});

// (fails before: yes — the harness opened at Filament's first answer, and a second launch meanwhile only noted it)
test("the app's main process: the harness shows at the launch, waits with the app's page, takes Filament's in the same window at its answer", () => {
  const main = read("desktop/main.js");
  assert.match(main, /import \{ underWay, waitPage, waitWords \} from "\.\/lib\/waiting\.js";/);
  // At the launch, unless hidden (tray only, as at logon); a second launch brings the window forward whatever the state.
  // Attached at its start: the windows' session first, a few seconds at most (the hunt on x45).
  assert.match(main, /if \(owned\) sup\.start\(\);\n(?: {2}\/\/[^\n]*\n)+ {2}else await Promise\.race\(\[ownerSession\(\), new Promise\(\(r\) => setTimeout\(r, ATTACH_SESSION_MS\)\)\]\);\n(?: {2}\/\/[^\n]*\n)+ {2}if \(!process\.argv\.includes\("--hidden"\)\) openWindow\("harness"\);/);
  assert.match(main, /^const ATTACH_SESSION_MS = 3000;$/m);
  assert.match(main, /launched = \(argv\) => \{\n {4}if \(argv\.includes\("--quit"\)\) return void quit\(\);\n {4}if \(argv\.includes\("--card"\)\) return void openCard\(\);\n(?: {4}[^\n]*\n)*? {4}const w = openWindow\("harness", "", \{ launch: true \}\);\n/);
  assert.doesNotMatch(main, /\bshown = false\b/, "no launch is put off to Filament's answer any more");
  // A window opened while its own Filament gives no page: the app's page in it, a spinner while it is on its way.
  assert.match(main, /if \(owned && sup\.now\(\)\.state !== "up"\) \{\n {6}waiting\.set\(w, \{ name, route \}\);\n {6}paintWait\(w\);\n {4}\} else void w\.loadURL\(`\$\{pageOf\(name\)\}\$\{route\}`\)\.catch\(\(\) => \{\}\);/);
  assert.match(main, /void w\.loadURL\(waitPage\(waitWords\(state, port\), \{ dark, busy: underWay\(state\), bar, version: appVersion\(ROOT\) \}\)\)\.catch\(\(\) => \{\}\);/);
  // As Filament's state moves the waiting windows say it; at its answer each takes its page, at the route it was asked.
  // The windows' browser session first (src/services/owner.js), so the page they load calls with it.
  assert.match(main, /if \(state === "up" \|\| taken\?\.kind === "attach"\) void ownerSession\(\)\.finally\(reload\);\n {4}else for \(const w of waiting\.keys\(\)\) paintWait\(w\);/);
  // (fails before: yes — the hunt on x45: a mint that got no answer stood as done, so no call asked again, and a window
  // that loaded with none sat at the pairing page however late the session came)
  assert.match(main, /const ownerSession = \(\) => \(minting \?\?= mint\(\)\.finally\(\(\) => \(minting = null\)\)\);/, "every asker shares the mint under way");
  assert.match(main, /if \(!refused && sessionFor === key\) sessionFor = "";/, "one that got no answer is asked again by the next call with that key");
  assert.match(main, /windowsSession = j\.token;\n {10}mintFailed = "";\n {10}backFromPairing\(\);\n {10}return true;/);
  assert.match(main, /if \(at\.origin === origin && at\.pathname === PAIR_PAGE\) void w\.loadURL\(pageOf\(name\)\)/, "a window at the pairing page takes its own page once the session lands");
  assert.match(main, /const waited = waiting\.get\(w\);\n {6}if \(waited\) \{\n {8}waiting\.delete\(w\);\n {8}void w\.loadURL\(`\$\{pageOf\(waited\.name\)\}\$\{waited\.route\}`\)/);
  assert.match(main, /if \(route && waited\) waited\.route = route;/, "a chat asked meanwhile opens at the answer");
  assert.match(main, /w\.on\("closed", \(\) => \{\n {6}every\.delete\(w\);\n {6}unloaded\.delete\(w\);\n {6}waiting\.delete\(w\);/);
});

// (fails before: yes — the owner's of 11-17: with Filament running in the tray, a double-click on its launcher showed
// no window in front, and the log said nothing of it. A guess, for the log to tell: the new window waited for its first
// paint, by when Windows no longer let the launch bring it forward — a window kept maximized never waited. And read from
// the code: a Mac heard no `activate`, so once its windows were closed the Dock icon and the Finder brought none back)
test("a later launch shows its window at once on Windows and logs what it found and how the window stands; a Mac's Dock click or reopen with no window showing asks as a second launch does", () => {
  const main = read("desktop/main.js");
  const open = main.slice(main.indexOf("const openWindow = ("), main.indexOf("const openWindow = (") + 6000);
  assert.match(open, /const openWindow = \(name, route = "", \{ launch = false \} = \{\}\) => \{/);
  assert.match(open, /if \(launch && process\.platform === "win32"\) w\.show\(\);\n {4}else w\.once\("ready-to-show", \(\) => w\.show\(\)\);/, "a launch's window at once on Windows; any other at its first paint");
  // Every other opening (the start, the tray, a notification, the card's Now, another machine's chip) waits for its first paint.
  assert.equal((main.match(/\{ launch: true \}/g) || []).length, 1, "a later launch's alone");
  const heard = main.slice(main.indexOf("launched = (argv) => {"), main.indexOf("for (const argv of early.splice(0)) launched(argv);"));
  assert.match(heard, /const found = !!had && !had\.isDestroyed\(\);\n {4}const w = openWindow\("harness", "", \{ launch: true \}\);\n {4}log\.line\(`a launch asked for the harness window: \$\{found \? "found it open" : "made one"\}`\);/);
  assert.match(heard, /w\.isVisible\(\) \? "visible" : "hidden"\}, \$\{w\.isFocused\(\) \? "focused" : "not focused"\}\$\{w\.isMinimized\(\) \? ", minimized" : ""\}\$\{w\.isMaximized\(\) \? ", maximized" : ""\}, its page \$\{w\.webContents\.mainFrame\?\.visibilityState \|\| "unknown"\}`\);\n {4}\}, 1500\)\.unref\?\.\(\);/, "how it stands a moment on, its page's own word too, said for both");
  const end = main.slice(main.indexOf("for (const argv of early.splice(0)) launched(argv);"));
  assert.match(end, /^for \(const argv of early\.splice\(0\)\) launched\(argv\);\n(?: {2}\/\/[^\n]*\n)+ {2}app\.on\("activate", \(_e, hasVisibleWindows\) => \{\n {4}if \(!hasVisibleWindows\) launched\(\[\]\);\n {2}\}\);\n\}/, "heard once the start has opened its window or not, and only with no window showing");
  assert.equal((main.match(/app\.on\("activate"/g) || []).length, 1);
});
