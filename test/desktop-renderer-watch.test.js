// @ts-check
// A window of Filament's own that loses its page's process says so in the log (the owner's of 11-17: a chat window
// following a 22-hour turn reached 13 GB, a minute later another process stood in its place, and nothing said which it
// was): which window, why, what it showed, how big it was last seen; a page that stops answering is said and never acted
// on; the app's own going, a clean exit and a window already gone say nothing; a handler that throws is logged, never
// thrown. And main watches every window it tracks, samples its processes' memory each minute, and hears the server's
// census over its port.
// (fails before: yes — no window's page was watched: render-process-gone was handled for the agent browser's tabs alone)
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLACE_MAX, placeOf, watchRenderer, crashPlan, CRASH_CAP, CRASH_SPAN_MS, CHAT_CRASH_MS, RELOAD_AFTER_MS, stoppedWords } from "../desktop/lib/renderer-watch.js";

class Contents {
  constructor() {
    /** @type {Record<string, Function[]>} */
    this.l = {};
    this.url = "http://127.0.0.1:20300/ui/harness.html?pane=agents#/c/abc123";
    this.pid = 4242;
    this.destroyed = false;
  }
  /** @param {string} n @param {Function} f */
  on(n, f) {
    (this.l[n] ||= []).push(f);
    return this;
  }
  /** @param {string} n @param {...any} a */
  emit(n, ...a) {
    for (const f of this.l[n] || []) f(...a);
  }
  getURL() {
    return this.url;
  }
  getOSProcessId() {
    return this.pid;
  }
  isDestroyed() {
    return this.destroyed;
  }
}

/** A watched window and what its log said. @param {{ quitting?: boolean, last?: any }} [o] */
function watched({ quitting = false, last = { mb: 13084, peakMB: 13084, at: 1_000_000 } } = {}) {
  const wc = new Contents();
  /** @type {string[]} */
  const lines = [];
  let t = 1_030_000;
  const state = { quitting };
  const w = watchRenderer(wc, { name: () => "the harness window", log: (l) => lines.push(l), quitting: () => state.quitting, lastOf: (pid) => (pid === 4242 ? last : null), now: () => t });
  return { wc, lines, w, state, at: (/** @type {number} */ ms) => void (t = ms) };
}

describe("a window's page process, watched", () => {
  test("its process ending says which window, why, the chat it showed and how big it was last seen", () => {
    const { wc, lines } = watched();
    wc.emit("did-finish-load");
    wc.emit("render-process-gone", {}, { reason: "oom", exitCode: -536870904 });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^the harness window's page process ended: oom, exit code -536870904, pid 4242, showing \/ui\/harness\.html\?pane=agents#\/c\/abc123; last seen at 13,084 MB private 30 s before, 13,084 MB at most/);
  });

  test("every reason is said, killed too, unless the app is going, the exit was clean or the window is gone", () => {
    for (const reason of ["crashed", "killed", "abnormal-exit", "launch-failed", "memory-eviction"]) {
      const { wc, lines } = watched();
      wc.emit("dom-ready");
      wc.emit("render-process-gone", {}, { reason, exitCode: 1 });
      assert.equal(lines.length, 1, reason);
      assert.match(lines[0], new RegExp(`ended: ${reason},`));
    }
    const going = watched({ quitting: true });
    going.wc.emit("render-process-gone", {}, { reason: "killed", exitCode: 1 });
    const clean = watched();
    clean.wc.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 });
    const gone = watched();
    gone.wc.destroyed = true;
    gone.wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
    assert.deepEqual([going.lines, clean.lines, gone.lines], [[], [], []]);
  });

  test("a page that never loaded has no process to name and no memory seen; the sampler reads its id while it lives", () => {
    const { wc, lines, w } = watched();
    wc.pid = 0;
    assert.equal(w.pid(), 0);
    wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
    assert.match(lines[0], /exit code 1, showing .*; no memory seen of it yet; loaded again$/);
    wc.pid = 777;
    assert.equal(w.pid(), 777, "the sampler's reading remembers it");
    wc.pid = 0;
    assert.equal(w.pid(), 777, "and keeps it once the process has none to give");
  });

  test("not answering is said once, and answering again with how long; nothing else is done", () => {
    const { wc, lines, at } = watched();
    at(5_000);
    wc.emit("unresponsive");
    wc.emit("unresponsive");
    at(17_400);
    wc.emit("responsive");
    wc.emit("responsive");
    assert.deepEqual(lines, ["the harness window stopped answering", "the harness window answers again after 12 s"]);
  });

  test("a handler that throws says so in the log and throws nothing", () => {
    const wc = new Contents();
    /** @type {string[]} */
    const lines = [];
    watchRenderer(wc, { name: () => { throw new Error("no name"); }, log: (l) => lines.push(l), quitting: () => false });
    assert.doesNotThrow(() => wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 }));
    assert.doesNotThrow(() => wc.emit("unresponsive"));
    assert.deepEqual(lines, ["a window's ended page could not be said: no name", "a window's stop could not be said: no name"]);
  });

  test("a window's place is its page's path, pane and route, at most 300 characters; the app's waiting page is named, not dumped", () => {
    assert.equal(placeOf("http://127.0.0.1:20300/ui/harness.html#/c/x"), "/ui/harness.html#/c/x");
    assert.equal(placeOf("data:text/html;base64,AAAA"), "Filament's own waiting page");
    assert.equal(placeOf(""), "no page");
    const long = placeOf(`http://127.0.0.1:20300/ui/harness.html?pane=${"f".repeat(2000)}`);
    assert.equal(long.length, PLACE_MAX);
    assert.ok(long.endsWith("…"));
  });

  test("off Windows the memory seen is the working set, and the line says so", () => {
    const { wc, lines } = watched({ last: { mb: 900, peakMB: 1200, at: 1_000_000, measure: "working set" } });
    wc.emit("did-finish-load");
    wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
    assert.match(lines[0], /last seen at 900 MB working set 30 s before, 1,200 MB at most/);
  });
});

// (fails before: yes — a window whose page's process went stayed blank until the person reloaded it, its queued
// messages gone, and nothing told the page it had crashed)
describe("a window whose page's process went is loaded again, without looping", () => {
  const HARNESS = "http://127.0.0.1:20300/ui/harness.html#/task/abc123";
  /** A watched harness window showing a chat, its plans heard. */
  function recovering() {
    const wc = new Contents();
    wc.url = HARNESS;
    /** @type {string[]} */
    const lines = [];
    /** @type {any[]} */
    const plans = [];
    let t = 1_000_000;
    watchRenderer(wc, { name: () => "the harness window", log: (l) => lines.push(l), quitting: () => false, now: () => t, recover: (p) => plans.push(p) });
    /** Its process goes, at `ms`, for `reason`. @param {number} ms @param {string} [reason] */
    const crash = (ms, reason = "crashed") => {
      t = ms;
      wc.emit("render-process-gone", {}, { reason, exitCode: 1 });
      return plans[plans.length - 1];
    };
    return { wc, lines, plans, crash };
  }

  test("a crash loads the page again where it was, its address saying why; the line says so", () => {
    const { lines, crash } = recovering();
    const plan = crash(1_000_000);
    assert.deepEqual(plan, { do: "again", url: "http://127.0.0.1:20300/ui/harness.html?crashed=crashed#/task/abc123", chat: "abc123" });
    assert.match(lines[0], /; loaded again$/);
  });

  test("out of memory, the chat it showed is left out of the load and named for the page to offer", () => {
    const { lines, crash } = recovering();
    assert.deepEqual(crash(1_000_000, "oom"), { do: "without", url: "http://127.0.0.1:20300/ui/harness.html?crashed=oom&away=abc123", chat: "abc123" });
    assert.match(lines[0], /; loaded again without chat abc123 \(its memory\)$/);
    assert.equal(crashPlan([], { reason: "memory-eviction", url: HARNESS, now: 0 }).do, "without", "ended to free memory: its memory too");
    assert.deepEqual(crashPlan([], { reason: "oom", url: "http://127.0.0.1:20300/ui/harness.html#/", now: 0 }), { do: "again", url: "http://127.0.0.1:20300/ui/harness.html?crashed=oom#/", chat: null }, "a page showing no chat has none to leave out");
  });

  test("a second crash on one chat within 30 minutes leaves it out; one later loads it again", () => {
    const { lines, crash } = recovering();
    crash(1_000_000);
    assert.equal(crash(1_000_000 + 20 * 60_000).do, "without");
    assert.match(lines[1], /without chat abc123 \(its second time in 30 minutes\)$/);
    const later = recovering();
    later.crash(1_000_000);
    assert.equal(later.crash(1_000_000 + CHAT_CRASH_MS + 1).do, "again");
    // Another chat's crash is not this chat's.
    assert.equal(crashPlan([{ at: 0, chat: "other" }], { reason: "crashed", url: HARNESS, now: 1000 }).do, "again");
  });

  test(`the ${CRASH_CAP}rd crash within 10 minutes loads it no more; a crash past that span starts over`, () => {
    const { lines, crash, wc } = recovering();
    crash(1_000_000);
    wc.url = "http://127.0.0.1:20300/ui/harness.html#/task/other1";
    crash(1_000_000 + 60_000);
    wc.url = "http://127.0.0.1:20300/ui/harness.html#/";
    assert.deepEqual(crash(1_000_000 + 120_000), { do: "stop", url: null, chat: null });
    assert.match(lines[2], /; loaded no more: 3 times in 10 minutes$/);
    assert.equal(crash(1_000_000 + 120_000 + CRASH_SPAN_MS).do, "again", "the earlier ones are past the span: loaded again");
  });

  // (fails before: yes — Fable 5.2's review of 11-17: past the cap every crash loaded the app's own page again, which
  // going down too would load and go down for ever; the dashboard kept `?crashed=` it never says; a page going down
  // before it took its words off its address lost the chat it offered)
  test("past the cap, the app's own page going down too is left as it is; Filament's other pages are loaded as they were", () => {
    const { crash, wc } = recovering();
    crash(1_000_000);
    crash(1_000_060);
    assert.equal(crash(1_000_120).do, "stop");
    wc.url = "data:text/html,stopped";
    assert.deepEqual(crash(1_000_200), { do: "leave", url: null, chat: null }, "the app's own page, past the cap: nothing loaded");
    assert.deepEqual(crashPlan([], { reason: "crashed", url: "data:text/html,waiting", now: 0 }), { do: "again", url: "data:text/html,waiting", chat: null }, "the waiting page, under it: as it was");
    assert.deepEqual(crashPlan([], { reason: "crashed", url: "", now: 0 }), { do: "again", url: null, chat: null });
    assert.deepEqual(crashPlan([], { reason: "oom", url: "http://127.0.0.1:20300/ui/#/requests", now: 0 }), { do: "again", url: "http://127.0.0.1:20300/ui/#/requests", chat: null }, "the dashboard: as it was, hearing nothing");
    assert.equal(crashPlan([], { reason: "oom", url: "http://127.0.0.1:20300/artifacts/a1/#/task/x", now: 0 }).chat, null, "a route like a chat's on another page is none");
    assert.deepEqual(crashPlan([{ at: 0, chat: "abc123" }], { reason: "crashed", url: "http://127.0.0.1:20300/ui/harness.html?crashed=oom&away=abc123", now: 5000 }), { do: "again", url: "http://127.0.0.1:20300/ui/harness.html?crashed=crashed&away=abc123", chat: null }, "down again before its start: the chat it left out is still offered");
  });

  test("never on a page that stops answering, the app's going, a clean exit or a window gone; always where the line cannot be said", () => {
    const { wc, plans } = recovering();
    wc.emit("unresponsive");
    wc.emit("responsive");
    assert.deepEqual(plans, []);
    for (const o of [{ quitting: true, reason: "killed" }, { quitting: false, reason: "clean-exit" }]) {
      const w = new Contents();
      /** @type {any[]} */
      const got = [];
      watchRenderer(w, { name: () => "w", log: () => {}, quitting: () => o.quitting, recover: (p) => got.push(p) });
      w.emit("render-process-gone", {}, { reason: o.reason, exitCode: 0 });
      assert.deepEqual(got, [], o.reason);
    }
    const w = new Contents();
    /** @type {any[]} */
    const got = [];
    /** @type {string[]} */
    const lines = [];
    watchRenderer(w, { name: () => { throw new Error("no name"); }, log: (l) => lines.push(l), quitting: () => false, recover: (p) => got.push(p) });
    w.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
    assert.equal(got.length, 1, "loaded again all the same");
    assert.deepEqual(lines, ["a window's ended page could not be said: no name"]);
  });

  test("main loads what the plan says a moment after — once, into a window still down, never one gone or an app going; loaded no more, its own page says why", () => {
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    const rec = main.slice(main.indexOf("const recoverPage = (w, plan) => {"), main.indexOf("const track = (w) => {"));
    assert.match(rec, /^const recoverPage = \(w, plan\) => \{\s+pages\.forgetWindow\(w\);\s+for \(const x of machineBrowsers\.all\(\)\) x\.forgetWindow\(w\);\s+clearTimeout\(recovering\.get\(w\)\);\s+recovering\.delete\(w\);\s+if \(plan\.do === "leave"\) return;/, "its Browser pages parked, one load a window, none to leave");
    assert.match(rec, /if \(w\.isDestroyed\(\) \|\| quitting \|\| !w\.webContents\.isCrashed\(\)\) return;/, "loaded meanwhile by something else: left as it is");
    assert.match(rec, /if \(plan\.do === "stop"\) \{[^]*?void w\.loadURL\(waitPage\(stoppedWords\(\[\.\.\.popped\.values\(\)\]\.includes\(w\)\), \{ dark, busy: false, bar, version: appVersion\(ROOT\) \}\)\)\.catch\(\(\) => \{\}\);\s+\} else if \(plan\.url\) void w\.loadURL\(plan\.url\)\.catch\(\(\) => \{\}\);\s+else w\.webContents\.reload\(\);\s+\}, RELOAD_AFTER_MS\);\s+later\.unref\?\.\(\);\s+recovering\.set\(w, later\);/);
    assert.ok(RELOAD_AFTER_MS > 0 && RELOAD_AFTER_MS <= 2000);
    assert.match(stoppedWords(false).line, /went 3 times in 10 minutes, so Filament stopped loading it\. Choose Filament's icon to load it once more\.$/);
    assert.match(stoppedWords(true).line, /Close this window to bring its pane back to the main one\.$/);
  });

  // (fails before: yes — Fable 5.2's review of 11-17: the icon only showed a window on the app's own page, so the words
  // sent the person to close it, and a new window has none of the old one's queues; Filament coming back loaded the
  // failed page bare, its chat and its crash's words gone)
  test("Filament's icon loads a window off its page again in place; Filament's answer keeps a failed page's place and words", () => {
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    const open = main.slice(main.indexOf("const openWindow = ("), main.indexOf("const main = screen.getPrimaryDisplay();"));
    assert.match(open, /if \(route && waited\) waited\.route = route;\s+else if \(!waited\) \{[^]*?if \(onPage && route\) void had\.webContents\.executeJavaScript[^\n]*\n(\s*\/\/[^\n]*\n)*\s*else if \(!onPage && !had\.webContents\.isLoadingMainFrame\(\)\) void had\.loadURL\(`\$\{pageOf\(name\)\}\$\{route\}`\)\.catch\(\(\) => \{\}\);/, "a window whose first load is under way is left to it");
    const reload = main.slice(main.indexOf("const reload = () => {"));
    assert.match(reload, /const kept = name && at && !left && at\.pathname === PAGES\[name\] \? `\$\{at\.search\}\$\{at\.hash\}` : "";\s+const page = name \? `\$\{pageOf\(name\)\}\$\{kept\}`/);
  });
});

describe("main watches its windows and its memory", () => {
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  test("every window it tracks is watched, and let go of as it closes", () => {
    const track = main.slice(main.indexOf("const track = (w) => {"), main.indexOf("const paintWait"));
    assert.match(track, /watched\.set\(w, watchRenderer\(w\.webContents, \{ name: \(\) => windowName\(w\), log: \(line\) => log\.line\(line\), quitting: \(\) => quitting, lastOf: \(pid\) => sampler\.lastOf\(pid\), recover: \(plan\) => recoverPage\(w, plan\) \}\)\)/);
    assert.match(track, /watched\.delete\(w\)/);
  });
  test("its processes are read each minute on a timer that holds no process open, into memory.log, a file of its own", () => {
    assert.match(main, /const memLog = createLog\(join\(own, "memory\.log"\)\)/);
    assert.match(main, /metrics: \(\) => app\.getAppMetrics\(\)/);
    assert.match(main, /setInterval\(\(\) => \{\s*try \{\s*sampler\.sample\(\);\s*\} catch \{\}\s*\}, SAMPLE_EVERY_MS\);\s*sampling\.unref\?\.\(\);/);
  });
  test("the server's census, posted over its port, is heard for the next line; its process is the fork's, and its end is written", () => {
    assert.match(main, /c\.on\("message", \(\/\*\* @type \{any\} \*\/ m\) => \{\s*try \{\s*sampler\.heard\(m\?\.census\);/);
    assert.match(main, /sampler\.serverStarted\(Number\(c\.pid\)\)/);
    assert.match(main, /c\.on\("exit", \(\/\*\* @type \{number\} \*\/ code\) => \{\s*try \{\s*sampler\.serverEnded\(code\);/);
  });
  test("a pane's window is named by its place's short name, never its tab's path; the sampler stops as the app goes", () => {
    assert.match(main, /the popped-out \$\{popPlaceName\(tab\)\} pane/);
    assert.match(main.slice(main.indexOf("async function leave()")), /clearInterval\(sampling\);/);
  });
});
