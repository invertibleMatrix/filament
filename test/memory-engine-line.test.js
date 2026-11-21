// @ts-check
// Where memory's engine stands, on the pages (HarnessV3-AtHome AH-D2): the shared words, `followEngine` keeping the
// state off an app's events fan-out, and the console's engine line. DOM-free: the fake `h` and a hand-run timer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engineProgress, engineMissing, followEngine, installWords, otherEngine, uninstallWords, WITHOUT_ENGINE } from "../src/ui/lib/engine.js";
import { engineLine, READY_MS } from "../src/ui/components/engine-line.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";

const settle = () => new Promise((r) => setImmediate(r));

// (fails before: no — written after the words; the mutation pass proves it bites)
test("the engine's words: an install by where it takes its packages from, a missing engine and why, and whether an Install can bring it", () => {
  assert.deepEqual(engineProgress({ state: "installing", percent: 39.6, source: "bundle", auto: true }), {
    percent: 40,
    sub: "getting ready — 40%",
    line: "Memory is getting ready — 40%: installing its engine from the copy that came with Filament",
    meanwhile: `Until it's ready, ${WITHOUT_ENGINE}.`,
  });
  assert.equal(engineProgress({ state: "installing", percent: 140, source: "bundle" })?.line, "Memory is getting ready — 100%: installing its engine from the copy that came with Filament", "never past 100");
  assert.equal(engineProgress({ state: "installing", percent: "x", source: null })?.line, "Memory is getting ready — 0%: installing its engine");
  for (const now of [{ state: "ready", source: "bundle" }, { state: "missing", error: null }, { state: "off" }, null, undefined]) assert.equal(engineProgress(now), null, JSON.stringify(now));
  assert.deepEqual(engineMissing({ state: "missing", error: null }), { short: "its engine isn't installed", note: `Its engine isn't installed, so ${WITHOUT_ENGINE}.`, failed: false, installable: true });
  assert.deepEqual(engineMissing({ state: "missing", error: "no network" }), { short: "its engine didn't install", note: `Its engine didn't install (no network), so ${WITHOUT_ENGINE}.`, failed: true, installable: true });
  // (fails before: yes — the second Hunter's find: a missing engine always offered Install, a bundle here or not)
  const why = "this Filament has no memory engine bundle for win32-x64 in C:\\f: reinstall Filament, or in a checkout build it with npm run engine:bundle";
  assert.deepEqual(engineMissing({ state: "missing", error: null, why }), { short: "it has no engine", note: `Its engine isn't installed, and can't be: ${why}. Meanwhile ${WITHOUT_ENGINE}.`, failed: false, installable: false });
  assert.equal(engineMissing({ state: "installing", percent: 3 }), null);
  assert.equal(engineMissing(null), null);
});

// (fails before: yes — the Memory page said every install downloads, and an Uninstall never said the engine comes back;
// then that one without a bundle downloads, which none does now)
test("the Memory page's Install and Uninstall words: the copy that came with Filament, or why there is none; whether it comes back by itself; another engine than this Filament's", () => {
  const why = "this Filament has no memory engine bundle for win32-x64 in C:\\f: reinstall Filament, or in a checkout build it with npm run engine:bundle";
  assert.equal(installWords({ ready: false, why }), `There is nothing to install it from: ${why}.`);
  assert.equal(installWords(undefined), "There is nothing to install it from: this Filament came without its memory engine.", "a status that says nothing of a bundle");
  assert.equal(installWords({ ready: true, why: null }), "Installing copies uv, a private Python 3.12, Mnemosyne and a 65 MB embedding model into the engine folder from the copy that came with Filament, offline: about 500 MB.");
  assert.equal(otherEngine({ installed: true, bundle: { ready: true, current: false } }), true);
  for (const e of [{ installed: true, bundle: { ready: true, current: true } }, { installed: true, bundle: { ready: false, current: false } }, { installed: false, bundle: { ready: true, current: false } }, { installed: true }, null])
    assert.equal(otherEngine(e), false, JSON.stringify(e));
  assert.equal(uninstallWords({ again: true }), "Remove the engine folder (uv, Python, the Mnemosyne package and the embedding model)? Your memory folder with the archive and the Mnemosyne database is kept. With memory on, Filament installs the engine again by itself when it next starts; Install brings it back now.");
  assert.equal(uninstallWords({ again: false }), "Remove the engine folder (uv, Python, the Mnemosyne package and the embedding model)? Your memory folder with the archive and the Mnemosyne database is kept; Install brings the engine back.");
  // (fails before: yes — the second Hunter's find: with no bundle here it promised an Install that nothing can make)
  assert.equal(uninstallWords({ again: true, bundled: false }), "Remove the engine folder (uv, Python, the Mnemosyne package and the embedding model)? Your memory folder with the archive and the Mnemosyne database is kept, but this Filament came without its engine, so nothing here can install it again: reinstall Filament, or in a checkout build it with npm run engine:bundle (about 500 MB to download).");
});

// (fails before: no — written after followEngine; the mutation pass proves it bites)
test("followEngine: read on each hello, kept by the engine messages, and a read older than a message is dropped", async () => {
  /** @type {((msg: any) => void)[]} */
  const subs = [];
  let undone = 0;
  const subscribe = (/** @type {(msg: any) => void} */ fn) => { subs.push(fn); return () => { undone++; }; };
  const hand = (/** @type {any} */ msg) => { for (const fn of subs) fn(msg); };
  /** @type {{ resolve: (v: any) => void, reject: (e: any) => void }[]} */
  const reads = [];
  /** @type {any[]} */
  const said = [];
  const off = followEngine(subscribe, { read: () => new Promise((resolve, reject) => reads.push({ resolve, reject })), onSaid: (now) => said.push(now) });
  assert.equal(reads.length, 0, "nothing read before the stream says hello");
  hand({ type: "hello", version: "x" });
  assert.equal(reads.length, 1);
  reads[0].resolve({ state: "installing", percent: 0, source: null, auto: true });
  await settle();
  assert.deepEqual(said, [{ state: "installing", percent: 0, source: null, auto: true }]);
  hand({ type: "engine", engine: { state: "installing", percent: 15, source: "bundle", auto: true } });
  assert.equal(said.length, 2);
  // A reconnect's read that a message overtakes: the message is newer.
  hand({ type: "hello" });
  hand({ type: "engine", engine: { state: "ready", source: "bundle" } });
  reads[1].resolve({ state: "installing", percent: 15, source: "bundle", auto: true });
  await settle();
  assert.deepEqual(said.at(-1), { state: "ready", source: "bundle" });
  assert.equal(said.length, 3, "the older read is dropped");
  // A read that fails says nothing; other messages and an engine message without its state are not the engine's.
  hand({ type: "hello" });
  reads[2].reject(new Error("offline"));
  hand({ type: "claims", last: "1" });
  hand({ type: "engine" });
  await settle();
  assert.equal(said.length, 3);
  off();
  assert.equal(undone, 1, "the undo is the subscription's");
});

/** A line over the fake `h` with a hand-run timer. */
function line() {
  /** @type {boolean[]} */
  const shows = [];
  /** @type {{ fn: () => void, ms: number, live: boolean }[]} */
  const timers = [];
  let failures = 0;
  const l = engineLine({
    h: fakeH,
    onShown: (on) => shows.push(on),
    onFailed: () => failures++,
    later: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    cancel: (t) => { t.live = false; },
  });
  const fire = () => { for (const t of timers.filter((x) => x.live)) { t.live = false; t.fn(); } };
  const words = () => textOf(l.el.kids[0]);
  const width = () => l.el.kids[1].kids[0].style.width;
  return { l, shows, timers, fire, words, width, failed: () => failures };
}

// (fails before: no — written after the line; the mutation pass proves it bites)
test("the console's engine line: shown while the engine installs, the percent a bar changed in place, 'ready' for a while once it ends well", () => {
  const { l, shows, timers, fire, words, width } = line();
  assert.equal(l.el.attrs.role, "status");
  l.set({ state: "ready", source: "bundle" });
  assert.deepEqual(shows, [], "an engine that was ready already is never said");
  l.set({ state: "installing", percent: 0, source: null, auto: true });
  assert.deepEqual([l.shown(), shows, words(), width()], [true, [true], "Memory is getting ready — 0%: installing its engine", "0%"]);
  const el = l.el;
  l.set({ state: "installing", percent: 40, source: "bundle", auto: true });
  assert.equal(l.el, el, "the same element, changed in place");
  assert.deepEqual([shows, words(), width()], [[true], "Memory is getting ready — 40%: installing its engine from the copy that came with Filament", "40%"]);
  l.set({ state: "ready", source: "bundle" });
  assert.deepEqual([l.shown(), words(), width(), l.el.classList.contains("is-ready")], [true, "Memory is ready: its engine is installed.", "100%", true]);
  assert.equal(timers.at(-1)?.ms, READY_MS);
  // A read on a reconnect that says "ready" again keeps the line saying so until its time is up.
  l.set({ state: "ready", source: "bundle" });
  assert.equal(l.shown(), true);
  fire();
  assert.deepEqual([l.shown(), shows], [false, [true, false]]);
  // A new install, then one more while its "ready" line shows: the timer is let go and the line stays.
  l.set({ state: "installing", percent: 55, source: "bundle", auto: true });
  l.set({ state: "ready", source: "bundle" });
  assert.equal(words(), "Memory is ready: its engine is installed.");
  l.set({ state: "installing", percent: 5, source: "bundle", auto: false });
  fire();
  assert.deepEqual([l.shown(), words()], [true, "Memory is getting ready — 5%: installing its engine from the copy that came with Filament"]);
});

// (fails before: no — written after the line; the mutation pass proves it bites)
test("the console's engine line: an install that fails, memory switched off, or an engine taken away goes at once", () => {
  for (const after of [{ state: "missing", error: "memory engine uv: download failed" }, { state: "off" }, { state: "missing", error: null }]) {
    const { l, shows } = line();
    l.set({ state: "installing", percent: 60, source: "download", auto: true });
    l.set(after);
    assert.deepEqual([l.shown(), shows], [false, [true, false]], JSON.stringify(after));
  }
  // While "ready" shows, anything but "ready" takes it away at once.
  const { l, timers } = line();
  l.set({ state: "installing", percent: 90, source: "bundle", auto: true });
  l.set({ state: "ready", source: "bundle" });
  l.set({ state: "off" });
  assert.equal(l.shown(), false);
  assert.equal(timers.at(-1)?.live, false, "its timer let go");
});

// (fails before: yes — the line had no onFailed: the console kept the last state itself, in its entry file, untested)
test("the console's engine line: an install that ends without the engine is told once, so the page reads its alerts now; nothing else is", () => {
  const a = line();
  a.l.set({ state: "installing", percent: 60, source: "download", auto: true });
  assert.equal(a.failed(), 0);
  a.l.set({ state: "missing", error: "memory engine uv: download failed" });
  assert.equal(a.failed(), 1);
  a.l.set({ state: "missing", error: "memory engine uv: download failed" });
  assert.equal(a.failed(), 1, "a read that says missing again is no new failure");
  // An engine missing all along, memory switched off mid-install, an install that ends well: none is told.
  const b = line();
  b.l.set({ state: "missing", error: null });
  b.l.set({ state: "installing", percent: 10, source: null, auto: true });
  b.l.set({ state: "off" });
  b.l.set({ state: "missing", error: "memory engine verify: mnemosyne could not be imported" });
  b.l.set({ state: "installing", percent: 10, source: "bundle", auto: false });
  b.l.set({ state: "ready", source: "bundle" });
  assert.equal(b.failed(), 0);
  // (fails before: yes — the second Hunter's find: an install over an engine that did not go in said "ready: installed"
  // for six seconds, the old engine running on) Ended as a failure: gone at once, told, never "installed".
  const c = line();
  c.l.set({ state: "installing", percent: 0, source: "bundle", auto: true });
  c.l.set({ state: "ready", source: "download", kept: true });
  assert.deepEqual([c.l.shown(), c.shows, c.failed()], [false, [true, false], 1]);
  assert.notEqual(c.words(), "Memory is ready: its engine is installed.");
});
