// @ts-check
// The desktop app's update at the sidebar's foot (src/ui/harness/lib/update-notice.js; the owner's of 11-07: a small
// notice in Filament itself — pressed, the update downloads, and it installs once the person says so): what it says
// for each phase and kind, its buttons asking the app through the window's bridge, Later, and none in a browser.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { noticeOf, updateNotice } from "../src/ui/harness/lib/update-notice.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
beforeEach(() => {
  doc = stubDocument();
});
afterEach(() => doc.restore());

const at = (/** @type {any} */ o) => ({ phase: "available", version: "0.9.1", kind: "nsis", page: "https://p", received: 0, size: 254_000_000, why: "", ...o });

// (fails before: yes — there was no notice: the tray alone offered an update, and fetched it unasked)
test("what the notice says: out with Update, its download's share, ready with Restart to update, a failure with Try again; a store's opens its store", () => {
  assert.equal(noticeOf(null), null);
  assert.equal(noticeOf(at({ phase: "none" })), null);
  assert.deepEqual(noticeOf(at({})), { phase: "available", title: "Filament 0.9.1 is out", sub: "It downloads while you work, then asks before it installs.", button: { label: "Update", act: "get" }, icon: "download", progress: null });
  const down = noticeOf(at({ phase: "downloading", received: 106_680_000 }));
  assert.deepEqual([down?.title, down?.sub, down?.button, down?.progress], ["Downloading Filament 0.9.1…", "42% of 254 MB", null, 0.42]);
  assert.equal(noticeOf(at({ phase: "downloading", size: 0, received: 3_000_000 }))?.sub, "3 MB so far", "a size the release did not give");
  const ready = noticeOf(at({ phase: "ready" }));
  assert.deepEqual([ready?.title, ready?.button], ["Filament 0.9.1 is ready", { label: "Restart to update", act: "restart" }]);
  assert.equal(ready?.sub, "Filament restarts to install it. If a chat is working, you're asked first.");
  const failed = noticeOf(at({ phase: "failed", why: "the download answered HTTP 404" }));
  assert.deepEqual([failed?.title, failed?.sub, failed?.button], ["Filament 0.9.1 didn't download", "The download answered HTTP 404.", { label: "Try again", act: "get" }]);
  assert.deepEqual([noticeOf(at({ kind: "mac-store" }))?.sub, noticeOf(at({ kind: "mac-store" }))?.button], ["The App Store updates it.", { label: "Open the App Store", act: "get" }]);
  assert.deepEqual(noticeOf(at({ kind: "windows-store" }))?.button, { label: "Open the Microsoft Store", act: "get" });
  assert.deepEqual(noticeOf(at({ kind: "page" }))?.button, { label: "See the release", act: "get" });
});

test("the notice: hidden until the app offers one, its buttons ask the app, its bar moves in place, Later hides it until it moves on; a browser shows none", async () => {
  /** @type {((s: any) => void)[]} */
  const heard = [];
  /** @type {string[]} */
  const asked = [];
  let kept = "";
  const app = { update: async () => at({}), updateAct: async (/** @type {string} */ a) => (asked.push(a), true), onUpdate: (/** @type {any} */ f) => heard.push(f) };
  const n = updateNotice({ app, later: { get: () => kept, set: (k) => (kept = k) } });
  const el = /** @type {any} */ (n.el);
  assert.equal(el.hidden, true, "nothing yet");
  await new Promise((r) => setImmediate(r));
  assert.equal(el.hidden, false);
  assert.match(String(el.textContent), /^Filament 0\.9\.1 is outIt downloads while you work, then asks before it installs\.UpdateLater$/);
  el.querySelector(".upd-go").dispatch("click");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked, ["get"]);
  heard[0](at({ phase: "downloading", received: 25_400_000 }));
  const bar = el.querySelector(".upd-bar span");
  assert.ok(bar, "a bar while it downloads");
  heard[0](at({ phase: "downloading", received: 127_000_000 }));
  assert.equal(el.querySelector(".upd-bar span"), bar, "the same bar, moved");
  assert.equal(bar.style.width, "50%");
  assert.equal(String(el.querySelector(".upd-sub").textContent), "50% of 254 MB");
  assert.equal(el.querySelector(".upd-go"), null, "no button while it downloads");
  heard[0](at({ phase: "ready" }));
  el.querySelector(".upd-go").dispatch("click");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked, ["get", "restart"]);
  // Later: hidden for this version where it stands; back once it moves on
  el.querySelector(".upd-later").dispatch("click");
  assert.equal(el.hidden, true);
  assert.equal(kept, "0.9.1:ready");
  heard[0](at({ phase: "ready" }));
  assert.equal(el.hidden, true, "the same, still hidden");
  heard[0](at({ phase: "available", version: "0.9.2" }));
  assert.equal(el.hidden, false, "a newer one shows");
  heard[0](null);
  assert.equal(el.hidden, true, "none to offer: hidden");
  // a browser, or an app with no such bridge: no notice, nothing asked
  const none = /** @type {any} */ (updateNotice({ app: undefined }).el);
  assert.equal(none.hidden, true);
  assert.equal(/** @type {any} */ (updateNotice({ app: { notify: () => {} } }).el).hidden, true);
});

test("the notice stands above the Library, the bridge carries it from the app's own page alone, and the tray says the same", () => {
  const side = readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8");
  assert.match(side, /scrollRegion,\n\s+\/\/ The desktop app's update[^\n]*\n\s+updateNotice\(\)\.el,\n(?:\s+\/\/[^\n]*\n\s+telemetryNotice\([^\n]*\)\.el,\n)?\s+library,/);
  const preload = readFileSync(new URL("../desktop/harness-preload.cjs", import.meta.url), "utf8");
  assert.match(preload, /update: \(\) => ipcRenderer\.invoke\("filament:update"\),/);
  assert.match(preload, /updateAct: \(what\) => ipcRenderer\.invoke\("filament:update-act", what === "restart" \? "restart" : "get"\),/);
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.match(main, /ipcMain\.handle\("filament:update", \(e\) => \(paneOf\(e\) \? updateView\(\) : null\)\);/);
  assert.match(main, /ipcMain\.handle\("filament:update-act", \(e, what\) => \{\n\s+if \(!paneOf\(e\)\) return false;\n\s+void \(what === "restart" \? restartToUpdate\(\) : getUpdate\(\)\);/);
  assert.match(main, /const updateView = \(\) => \(updater && owned && updater\.state\.phase !== "none" \? updater\.state : null\);/, "none where the app runs another's Filament");
  // (fails before: yes — the owner's of 11-08: Settings › About's Check now had no way to the app)
  assert.match(preload, /checkUpdates: \(\) => ipcRenderer\.invoke\("filament:update-check"\),/);
  assert.match(main, /ipcMain\.handle\("filament:update-check", async \(e\) => \{\n\s+if \(!paneOf\(e\)\) return null;\n\s+if \(!updater\) return \{ result: "checkout" \};\n\s+if \(!owned\) return \{ result: "attached" \};\n\s+return updater\.look\(true\);/, "the app's own page alone; a look the person asked for");
});
