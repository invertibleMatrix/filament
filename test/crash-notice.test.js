// @ts-check
// A page Filament loaded again because its process went says so, once (lib/crash-notice.js; the owner's of 11-17: a chat
// window following a 22-hour turn reached 13 GB, and a minute later another process stood in its place with nothing
// said): why, in words; the chat the load left out, with a button to open it again; and that queued messages wait,
// paused. It takes what the crash put in its address off it, its own query and route kept, so a reload says nothing.
// (fails before: yes — nothing loaded a crashed page again, and nothing said it had gone)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crashNoticeOf, addressWithoutCrash, CRASH_NOTICE_MS } from "../src/ui/harness/lib/crash-notice.js";

test("an address loaded again after a crash asks for its notice: why in words, the chat left out, the queue's word", () => {
  assert.equal(crashNoticeOf(""), null);
  assert.equal(crashNoticeOf("?pane=agents"), null, "a page's own query asks for nothing");
  const oom = crashNoticeOf("?crashed=oom&away=mb4y2exv");
  assert.equal(oom?.away, "mb4y2exv");
  assert.match(String(oom?.words), /^This window's page ran out of memory, and Filament loaded it again\. It opened without the chat it was showing, so that chat cannot take it down again\. Queued messages wait in their chats, paused: look them over before Continue — one queued in its last moments may be missing\.$/);
  const plain = crashNoticeOf("?pane=agents&crashed=crashed");
  assert.equal(plain?.away, null);
  assert.match(String(plain?.words), /^This window's page crashed, and Filament loaded it again\. Queued/, "no chat left out, none named");
  assert.match(String(crashNoticeOf("?crashed=killed")?.words), /was ended from outside Filament/);
  assert.match(String(crashNoticeOf(`?crashed=${"x".repeat(200)}`)?.words), new RegExp(`ended \\(${"x".repeat(40)}\\)`), "a reason it does not know, said as it came, cut short");
  assert.ok(CRASH_NOTICE_MS >= 20_000, "long enough to read and reach its button");
});

test("the address keeps its own query and route, and loses what the crash put in it", () => {
  assert.equal(addressWithoutCrash("http://127.0.0.1:20300/ui/harness.html?pane=agents&crashed=oom&away=x#/task/y"), "/ui/harness.html?pane=agents#/task/y");
  assert.equal(addressWithoutCrash("http://127.0.0.1:20300/ui/harness.html?crashed=crashed#/task/y"), "/ui/harness.html#/task/y");
});

// (fails before, its second half: yes — Fable 5.2's review of 11-17: a 30-second toast as the page started said nothing to
// a window that went down overnight, and the words stayed on the address while the start ran)
test("the harness takes the words off its address as it starts, and says them as the person is next at it, offering the chat left out", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /async function boot\(\) \{\n {2}sayCrash\(\);/, "the first thing the start does");
  const say = app.slice(app.indexOf("function sayCrash() {"), app.indexOf("async function boot() {"));
  assert.match(say, /const crashed = crashNoticeOf\(location\.search\);\s+if \(!crashed\) return;\s+history\.replaceState\(history\.state, "", addressWithoutCrash\(location\.href\)\);/);
  assert.match(say, /noticeToast\(crashed\.words, "err", \{ ms: CRASH_NOTICE_MS, \.\.\.\(away \? \{ action: \{ label: "Open that chat", onClick: \(\) => void \(location\.hash = routeFor\("task", \{ id: away \}\)\) \} \} : \{\}\) \}\);/);
  assert.match(say, /for \(const type of \["pointerdown", "pointermove", "keydown"\]\) addEventListener\(type, say, \{ capture: true, signal: heard\.signal \}\);/, "at the first key or pointer");
  assert.match(say, /const say = \(\) => \{\s+heard\.abort\(\);/, "once");
  const ui = readFileSync(new URL("../src/ui/harness/lib/ui.js", import.meta.url), "utf8");
  assert.match(ui, /window\.setTimeout\(gone, o\.ms \?\? \(a \? TOAST_ACTION_MS : kind === "err" \? 6000 : 3000\)\);/, "a toast stays as long as it is asked to");
});
