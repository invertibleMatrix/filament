// @ts-check
// General's message-box rows and notification switches (HarnessV4_Settings_Plan HS-6, HS-D70 to HS-D73): the composer
// built on the stub document sends with the key Send with sets, never on an input method's Enter, queues what is sent
// while a turn runs when A message while the agent works says Wait for the turn's end — a message to an agent and /btw
// still go at once — and says its keys as they are; a run that ends out of sight notifies only by the switch for how it
// ended, and the browser is asked for permission only when a switch is turned on. And what the
// box holds and takes (the bug hunt of 10-30): the files attached in it are its chat's, a paste keeps its words, a PDF
// is refused in words, a drag keeps its overlay over the box; a shortcut rebound to a key that types leaves it to the
// field, and one that opens a dialog opens none over another.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { createComposer } from "../src/ui/harness/composer/composer.js";
import { prefs } from "../src/ui/harness/prefs.js";
import { comboOf, list, matchShortcut, rebind } from "../src/ui/harness/shortcuts.js";
import { state } from "../src/ui/harness/state.js";
import { notifyRunEnded, ensureNotificationPermission, notifies } from "../src/ui/harness/notify.js";
import { renderGeneral, NOTIFY_ROWS, BLOCKED_WORDS, SEARCH_ROWS, APP_WORDS, APP_SWITCH, APP_SILENT, appSwitch, appNotify } from "../src/ui/harness/settings/general.js";
import * as drafts from "../src/ui/harness/state.js";
import { heldInRow } from "../src/ui/harness/conversation/history.js";
import * as attachments from "../src/ui/harness/composer/attachments.js";
import { lift, NOOP } from "./helpers/app-lift.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {Map<string, string>} */
let kept;
beforeEach(() => {
  doc = stubDocument();
  kept = new Map();
  g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, v), removeItem: (/** @type {string} */ k) => kept.delete(k) };
});
afterEach(() => {
  delete g.localStorage;
  delete g.Notification;
  delete /** @type {any} */ (doc.document).hidden;
  doc.restore();
});

/** A saved agent the box can address. */
const PM = { tag: "pm", name: "PM", kind: "worker", goodFor: "", thinks: "", may: "read", model: null, sees: { view: "none", running: false, changes: null }, shipped: true };

/** The composer on the stub document, with what reached each of its ways recorded. @param {Record<string, any>} [more] */
function box(more = {}) {
  const host = /** @type {any} */ (doc.document.createElement("div"));
  /** @type {[string, string, any][]} */
  const sent = [];
  /** @type {any[]} */
  const asked = [];
  /** @type {any[]} */
  const side = [];
  const c = createComposer(host, {
    onSend: (text, _files, modifier, o) => { sent.push([text, modifier, o || {}]); return true; },
    onStop: () => {},
    getChat: () => ({ chainId: "c1", turns: [] }),
    onAsk: (o) => { asked.push(o); return true; },
    onSide: (o) => { side.push(o); return true; },
    agentCards: () => /** @type {any} */ ([PM]),
    ...more,
  });
  const ta = host.querySelector(".composer-input");
  /** Type the words, then press a key. @param {string} text @param {Record<string, any>} [key] */
  const press = (text, key = {}) => {
    ta.value = text;
    let prevented = false;
    ta.dispatch("keydown", { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 13, ...key, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  return { c, host, ta, sent, asked, side, press, hint: () => host.querySelector(".composer-hint").textContent, sendBtn: host.querySelector(".send"), pill: host.querySelector(".queue-pill") };
}

// (fails before: yes — U13-D13 of 10-20: "@methodical …" asked the Methodical lead card, or was held as no agent's)
describe("a draft that opens with a team's name (U13-D13)", () => {
  test("Enter opens the team's Brief with the rest as its ask: nothing is sent or asked, and the draft stays in the box", () => {
    /** @type {any[]} */
    const briefs = [];
    const b = box({ teams: () => [{ key: "methodical", name: "Methodical" }], onBrief: (/** @type {any[]} */ ...a) => { briefs.push(a); } });
    assert.equal(b.press("@methodical fix the parser"), true);
    assert.deepEqual(briefs, [["methodical", "fix the parser", "@methodical fix the parser"]]);
    assert.deepEqual([b.sent, b.asked], [[], []]);
    assert.equal(b.ta.value, "@methodical fix the parser", "the draft stays until the team starts");
    b.press("@pm is it sound?");
    assert.equal(b.asked.length, 1, "an agent's tag is still the agent's");
    const shut = box({ teams: () => [{ key: "methodical", name: "Methodical" }], onBrief: () => briefs.push(["no"]), canBrief: () => false });
    shut.press("@methodical fix the parser");
    assert.equal(briefs.length, 1, "where no Brief can open, no team is the draft's");
  });
});

describe("Send with (HS-D70, HS-D71)", () => {
  // (fails before: yes — the box knew one key: Enter sent and Ctrl+Enter vetoed, whatever General said)
  test("Enter sends and Ctrl+Enter vetoes; with Ctrl+Enter, it (or ⌘+Enter) sends, Enter is a new line, and nothing vetoes", () => {
    const b = box();
    assert.equal(b.press("one"), true);
    assert.equal(b.press("two", { ctrlKey: true }), true);
    assert.equal(b.press("three", { shiftKey: true }), false, "Shift+Enter is the box's new line");
    assert.deepEqual(b.sent.map(([t, m]) => [t, m]), [["one", "normal"], ["two", "veto"]]);
    prefs.set("sendKey", "ctrl-enter");
    assert.equal(b.press("four"), false, "Enter is left to the box: a new line");
    assert.equal(b.press("five", { ctrlKey: true }), true);
    assert.equal(b.press("six", { metaKey: true }), true);
    assert.deepEqual(b.sent.slice(2).map(([t, m]) => [t, m]), [["five", "normal"], ["six", "normal"]], "no key vetoes");
  });

  // (fails before: yes — HC-117, found reading the code: the Enter that ends an input method's word sent the message)
  test("the Enter that ends an input method's word never sends, in either mode", () => {
    const b = box();
    assert.equal(b.press("你好", { isComposing: true }), false);
    assert.equal(b.press("にほん", { keyCode: 229 }), false);
    prefs.set("sendKey", "ctrl-enter");
    assert.equal(b.press("你好", { ctrlKey: true, isComposing: true }), false);
    assert.deepEqual(b.sent, []);
  });

  // (fails before: yes — HC-116: the hint, the button and Keyboard Shortcuts said Enter whatever the key was)
  test("the hint under the box and Keyboard Shortcuts say the keys as they are, and follow a change at once", () => {
    const b = box();
    b.c.setLive(false);
    assert.equal(b.hint(), "Enter to send · Shift+Enter for a new line");
    b.c.setLive(true, { kind: "loop" });
    // The ⌄ menu's row the send key does, by its name (the owner's of 11-09).
    assert.equal(b.hint(), "Enter sends at its next step · Ctrl+Enter vetoes · the Stop button stops");
    prefs.set("sendKey", "ctrl-enter");
    assert.equal(b.hint(), "Ctrl+Enter sends at its next step · the Stop button stops", "no veto key: the ⌄ menu has it");
    b.c.setLive(false);
    assert.equal(b.hint(), "Ctrl+Enter to send · Enter for a new line");
    assert.deepEqual([comboOf("composer-send"), comboOf("composer-newline"), comboOf("composer-veto")], ["Ctrl+Enter", "Enter", ""]);
    assert.deepEqual(list().filter((s) => s.scope === "composer").map((s) => s.combo), ["Ctrl+Enter", "Enter", ""]);
    prefs.set("sendKey", "enter");
    assert.deepEqual([comboOf("composer-send"), comboOf("composer-newline"), comboOf("composer-veto")], ["Enter", "Shift+Enter", "Ctrl+Enter"]);
  });
});

describe("A message while the agent works (HS-D72)", () => {
  // (fails before: yes — HC-76: what was sent while a turn ran always went into it)
  test("Wait for the turn's end: the box's send queues it, the words say so, and it goes when the turn ends", async () => {
    prefs.set("whileWorking", "wait");
    const b = box();
    b.c.setLive(true, { kind: "loop" });
    assert.equal(b.hint(), "Enter sends when it's done · Ctrl+Enter vetoes · the Stop button stops");
    assert.equal(b.sendBtn.title, "Send when it's done", "the ⌄ menu's row the send key does (the owner's of 11-09)");
    assert.equal(b.press("after this"), true);
    assert.equal(b.sent.length, 0, "nothing reaches the running turn");
    assert.equal(b.pill.textContent, "1 queued");
    assert.equal(b.ta.value, "", "the box is the queue's now");
    b.c.setLive(false, null, "done");
    await settle();
    assert.deepEqual(b.sent.map(([t, m, o]) => [t, m, o.queued]), [["after this", "normal", true]]);
  });

  // (fails before: yes — HC-140, found in HS-6's drive: a steerable run's box said "Steer the run" while Enter queued)
  test("the box's own words say what waiting does on a run that could be steered, and follow the switch at once", () => {
    prefs.set("whileWorking", "wait");
    const b = box();
    b.c.setLive(true, { kind: "loop" });
    assert.equal(b.ta.placeholder, "A turn is running — what you send now goes out when it ends");
    prefs.set("whileWorking", "steer");
    assert.equal(b.ta.placeholder, "A turn is running — what you send now is read at its next step");
  });

  // (fails before: yes — the review of 11-05: with Wait for the turn's end, /steer-fork joined the queue, and at the
  // turn's end no turn was left to weigh it beside; one with a file the turn cannot take was queued so too)
  test("/steer-fork and Weigh aside first go into the running turn with Wait for the turn's end; with a file the turn cannot take, the message stays in the box", async () => {
    prefs.set("whileWorking", "wait");
    /** @type {string[]} */
    const toasts = [];
    const b = box({ onToast: (/** @type {string} */ w) => void toasts.push(w) });
    b.c.setLive(true, { kind: "loop" });
    assert.equal(b.press("/steer-fork not that file"), true);
    assert.deepEqual(b.sent.map(([t, m]) => [t, m]), [["/steer-fork not that file", "normal"]], "to the page's send, which weighs it");
    assert.equal(b.pill.textContent, "", "nothing queued");
    b.c.attach({ kind: "text", name: "notes.txt", size: 5, text: "hello" });
    b.press("/steer-fork with my notes");
    await settle();
    assert.equal(b.sent.length, 1);
    assert.equal(b.ta.value, "/steer-fork with my notes", "back in the box, its file with it");
    assert.deepEqual(b.c.files().map((/** @type {any} */ f) => f.name), ["notes.txt"]);
    assert.match(toasts.at(-1) || "", /^A message weighed aside takes words, and pictures where the turn reads them/);
  });

  test("Steer it now, the default, steers; a veto steers in either mode", () => {
    const b = box();
    b.c.setLive(true, { kind: "loop" });
    b.press("now");
    prefs.set("whileWorking", "wait");
    b.press("stop that", { ctrlKey: true });
    assert.deepEqual(b.sent.map(([t, m]) => [t, m]), [["now", "normal"], ["stop that", "veto"]]);
  });

  // (fails before: yes — the review of f50fcf6f9: a refused send set the box to its own words, so of two sends the page
  // refused only the second came back, "second", and words typed since a send went were lost to its refusal)
  test("a message the page refuses comes back before what the box holds by then: two refused keep both, and words and files put there since stay", async () => {
    /** @type {((ok: any) => void)[]} */
    const answer = [];
    const b = box({ onSend: () => new Promise((r) => answer.push(r)) });
    b.press("first");
    b.press("second");
    assert.equal(b.ta.value, "", "both went out of the box");
    for (const go of answer.splice(0)) go(false);
    await settle();
    assert.equal(b.ta.value, "second\n\nfirst", "both back, the newest refused first");
    b.ta.value = "";
    b.press("third");
    b.ta.value = "typed since";
    b.c.attach({ kind: "text", name: "notes.txt", size: 5, text: "hello" });
    answer[0](false);
    await settle();
    assert.equal(b.ta.value, "third\n\ntyped since");
    assert.deepEqual(b.c.files().map((/** @type {any} */ f) => f.name), ["notes.txt"], "the file attached since stays");
  });

  // (fails before: yes — the review of f4dc07c45: each set the box to its own words — "/btw what is this file?" and the
  // rest alone — and words typed while it was out were lost)
  test("a /btw, a /compaction card, a /craft and an ask to saved agents the page could not take come back before what the box holds by then", async () => {
    /** @type {((ok: any) => void)[]} */
    const answer = [];
    const later = () => new Promise((r) => answer.push(r));
    const b = box({ onSide: later, onCompactionCard: later, onCraft: later, onAsk: later });
    /** @type {string[]} */
    const got = [];
    for (const said of ["/btw what is this file?", "/compaction make room", "/craft a release-notes tool", "@pm is it sound?"]) {
      b.ta.value = "";
      b.press(said);
      b.ta.value = "typed since";
      answer.shift()?.(false);
      await settle();
      got.push(b.ta.value);
    }
    assert.deepEqual(got, ["/btw what is this file?\n\ntyped since", "/compaction make room\n\ntyped since", "/craft a release-notes tool\n\ntyped since", "@pm is it sound?\n\ntyped since"]);
  });

  // (fails before: no — the guard: a message to an agent and /btw never join the turn, so waiting has nothing to hold)
  test("Wait, and a message to an agent or /btw goes at once", async () => {
    prefs.set("whileWorking", "wait");
    const b = box();
    b.c.setLive(true, { kind: "loop" });
    b.press("/btw what is this file?");
    b.press("@pm look at the plan");
    await settle();
    assert.deepEqual(b.side.map((o) => o.question), ["what is this file?"]);
    assert.deepEqual(b.asked.map((o) => o.tags), [["pm"]]);
    assert.equal(b.sent.length, 0);
    assert.equal(b.pill.classList.contains("hidden"), true, "nothing queued");
  });
});

describe("the notification switches (HS-D73)", () => {
  /** A browser's Notification that records what was raised and asked, and answers the ask with `answer`.
   *  @param {string} permission @param {string} [answer] */
  const browser = (permission, answer = permission) => {
    /** @type {any[]} */
    const raised = [];
    let asked = 0;
    g.Notification = class {
      static permission = permission;
      static requestPermission() {
        asked++;
        g.Notification.permission = answer;
        return Promise.resolve(answer);
      }
      /** @param {string} title @param {any} o */
      constructor(title, o) { raised.push([title, o.body]); }
      close() {}
    };
    return { raised, asked: () => asked };
  };

  // (fails before: yes — HC-77: one switch, off by default, and once on it notified every way a run ended)
  test("each way a run ends has its own switch, all off until turned on; a tab in sight is never notified", () => {
    const n = browser("granted");
    /** @type {any} */ (doc.document).hidden = true;
    for (const status of ["done", "error", "paused", "question"]) notifyRunEnded({ title: "t", status, chainId: `c-${status}` });
    assert.deepEqual(n.raised, [], "nothing switched on");
    assert.ok(state.unreadChains.has("c-done"), "the unread dot comes whatever the switches say");
    prefs.set("notifyFailed", true);
    prefs.set("notifyAsks", true);
    for (const status of ["done", "error", "question"]) notifyRunEnded({ title: status, status });
    assert.deepEqual(n.raised, [["Chat error occurred", "error"], ["Your response is needed", "question"]]);
    assert.deepEqual(["done", "error", "paused", "question"].map(notifies), [false, true, true, true]);
    /** @type {any} */ (doc.document).hidden = false;
    notifyRunEnded({ title: "seen", status: "error" });
    assert.equal(n.raised.length, 2, "HC-123: in sight, no notification");
  });

  // (fails before: yes — HC-122: the browser's prompt came at the first run's end, asked for or not)
  test("a run's end asks the browser nothing while every switch is off", () => {
    const n = browser("default");
    ensureNotificationPermission();
    assert.equal(n.asked(), 0);
    prefs.set("notifyDone", true);
    ensureNotificationPermission();
    assert.equal(n.asked(), 1);
  });

  // (fails before: yes — HC-121: General had no word for a browser that refused)
  test("General: a switch turned on asks the browser once; refused, the page says where to allow it", async () => {
    const n = browser("default", "denied");
    const body = /** @type {any} */ (doc.document.createElement("div"));
    renderGeneral(body);
    const switches = body.querySelectorAll(".set-switch");
    assert.deepEqual(switches.slice(0, 3).map((/** @type {any} */ s) => s.attrs.get("aria-label")), NOTIFY_ROWS.map((r) => r.label));
    assert.ok(switches.slice(0, 3).every((/** @type {any} */ s) => s.attrs.get("aria-checked") === "false"), "each off");
    const note = body.querySelector(".nset-note");
    assert.equal(note.textContent, BLOCKED_WORDS);
    assert.equal(note.classList.contains("hidden"), true);
    switches[0].dispatch("click");
    await settle();
    assert.equal(prefs.get("notifyDone"), true);
    assert.equal(n.asked(), 1);
    assert.equal(note.classList.contains("hidden"), false, "refused: the blocked note shows");
    switches[1].dispatch("click");
    await settle();
    assert.equal(n.asked(), 1, "a browser that answered is not asked again");
    switches[0].dispatch("click");
    switches[1].dispatch("click");
    assert.equal(note.classList.contains("hidden"), true, "every switch off: nothing to say");
  });

  // (fails before: yes — HarnessV3-Native NA3b: in the desktop app's window a chat's end was told twice, by the page and
  // by the app)
  test("in the desktop app's window the page tells nothing and asks nothing; General says the app tells", () => {
    const was = Object.getOwnPropertyDescriptor(g, "navigator");
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) filament/0.1.0 Chrome/140.0.7339.0 Electron/45.0.0 Safari/537.36";
    Object.defineProperty(g, "navigator", { value: { userAgent: ua }, configurable: true, writable: true });
    try {
      prefs.set("notifyFailed", true);
      prefs.set("notifyAsks", true);
      /** @type {any} */ (doc.document).hidden = true;
      const granted = browser("granted");
      notifyRunEnded({ title: "t", status: "error", chainId: "c-app" });
      assert.deepEqual(granted.raised, [], "the app tells it, not the page");
      assert.ok(state.unreadChains.has("c-app"), "the unread dot comes all the same");
      const asking = browser("default");
      ensureNotificationPermission();
      assert.equal(asking.asked(), 0, "the browser's permission is never asked in the app");
      const body = /** @type {any} */ (doc.document.createElement("div"));
      renderGeneral(body);
      const labels = body.querySelectorAll(".set-switch").map((/** @type {any} */ x) => x.attrs.get("aria-label"));
      assert.ok(!NOTIFY_ROWS.some((r) => labels.includes(r.label)), `no page switches in the app: ${labels.join(", ")}`);
      assert.equal(body.querySelector(".nset-note").textContent, APP_WORDS);
    } finally {
      if (was) Object.defineProperty(g, "navigator", was);
      else delete g.navigator;
    }
  });

  // (fails before: yes — the design pass of 10-24, UX8: in the desktop app General only pointed at the tray; its
  // Notifications could not be switched where they are read about)
  test("in a desktop app that answers, General holds the app's own Notifications switch, read from the app and set through it", async () => {
    const was = Object.getOwnPropertyDescriptor(g, "navigator");
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) filament/0.1.0 Chrome/140.0.7339.0 Electron/45.0.0 Safari/537.36";
    Object.defineProperty(g, "navigator", { value: { userAgent: ua }, configurable: true, writable: true });
    /** @type {(boolean | undefined)[]} */
    const asked = [];
    let held = true;
    g.filamentApp = { notify: (/** @type {boolean | undefined} */ on) => { asked.push(on); if (typeof on === "boolean") held = on; return Promise.resolve(held); } };
    try {
      const body = /** @type {any} */ (doc.document.createElement("div"));
      renderGeneral(body);
      const switches = body.querySelectorAll(".set-switch");
      assert.deepEqual(switches.slice(0, 1).map((/** @type {any} */ s) => s.attrs.get("aria-label")), [APP_SWITCH.label], "the app's switch first, and no page switch");
      assert.ok(!switches.some((/** @type {any} */ s) => NOTIFY_ROWS.some((r) => r.label === s.attrs.get("aria-label"))));
      assert.equal(body.querySelector(".nset-note"), null, "no words stand in its place");
      const sw = switches[0];
      assert.equal(sw.hasAttribute("disabled"), true, "held still until the app answers");
      await settle();
      assert.deepEqual(asked, [undefined], "drawn: the app is asked what it holds");
      assert.equal(sw.attrs.get("aria-checked"), "true");
      assert.equal(sw.hasAttribute("disabled"), false);
      sw.dispatch("click");
      assert.equal(sw.hasAttribute("disabled"), true, "held while the app sets it");
      await settle();
      assert.deepEqual(asked, [undefined, false], "the pick goes to the app");
      assert.equal(sw.attrs.get("aria-checked"), "false", "painted from the app's answer");
      assert.equal(sw.hasAttribute("disabled"), false);
    } finally {
      delete g.filamentApp;
      if (was) Object.defineProperty(g, "navigator", was);
      else delete g.navigator;
    }
  });

  test("the app's switch, where the app does not answer, stays still and says where the same switch is", async () => {
    const sw = /** @type {any} */ (appSwitch(() => Promise.resolve(null))).querySelector(".set-switch");
    await settle();
    assert.equal(sw.hasAttribute("disabled"), true);
    assert.equal(sw.attrs.get("aria-checked"), "false");
    assert.equal(sw.title, APP_SILENT);
    const failed = /** @type {any} */ (appSwitch(() => Promise.reject(new Error("gone")))).querySelector(".set-switch");
    await settle();
    assert.equal(failed.title, APP_SILENT, "a failed ask is said the same way");
    assert.equal(appNotify(), null, "in a browser there is no app to ask");
  });

  test("the app's half: its window's bridge asks one handler, which answers the harness's windows alone and sets the tray's own check", () => {
    const preload = readFileSync(new URL("../desktop/harness-preload.cjs", import.meta.url), "utf8");
    assert.match(preload, /exposeInMainWorld\("filamentApp", \{\n[\s\S]*?notify: \(on\) => ipcRenderer\.invoke\("filament:notify", typeof on === "boolean" \? on : null\),\n[\s\S]*?\}\);/);
    const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
    const at = main.indexOf('ipcMain.handle("filament:notify"');
    assert.ok(at > 0, "the app answers it");
    const handler = main.slice(at, main.indexOf("\n  });", at));
    assert.match(handler, /if \(!paneOf\(e\)\) return null;/, "only Filament's own page in a harness window is answered");
    assert.match(handler, /if \(typeof want === "boolean" && want !== settings\.notify\) void act\("notify"\);/, "the tray's own toggle: kept, logged and the tray painted");
    assert.match(main, /if \(id === "notify"\) \{\n\s+settings = keepSettings\(settingsFile, \{ notify: !settings\.notify \}\);/, "the toggle sets the choice before its first wait, so the answer reads it");
  });

  // (fails before: yes — the owner's of 11-05: the welcome tour was hard to find again, from the command center alone)
  test("General opens the welcome tour again: its row first, found by Settings' search, and the page's Settings pass the tour", () => {
    const body = /** @type {any} */ (doc.document.createElement("div"));
    let opened = 0;
    renderGeneral(body, { onWelcome: () => void opened++ });
    assert.deepEqual([body.querySelectorAll(".nset-h")[0]?.textContent, body.querySelectorAll(".settings-row-label")[0]?.textContent], ["Getting started", "Welcome tour"]);
    const open = body.querySelectorAll(".zc-btn").find((/** @type {any} */ b) => b.textContent === "Open the tour");
    open.dispatch("click");
    assert.equal(opened, 1, "the tour opens");
    assert.ok(SEARCH_ROWS.some((r) => r.label === "Welcome tour"), "Settings' search finds it");
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    const at = app.indexOf("renderSettings(frame, route.section, {");
    const mount = app.slice(at, app.indexOf("useResetCredit: (upstream) => useResetCredit(upstream),", at));
    assert.match(mount, /onWelcome: \(\) => openTour\(\),/, "the Settings page is handed the tour");
  });

  test("Settings' search reads General's rows as drawn", () => {
    const body = /** @type {any} */ (doc.document.createElement("div"));
    renderGeneral(body);
    // New chats start on is its card's row (new-chat-model.js), the others General's own.
    const drawn = body.querySelectorAll(".settings-row-label, .prov-crow-label").map((/** @type {any} */ l) => l.textContent);
    assert.deepEqual(drawn, SEARCH_ROWS.map((r) => r.label));
  });
});

/**
 * The page's Start chooser setter (app.js `setChooserFolder`, which the Start board's `setFolder` calls), lifted with its
 * count over the stand-ins given.
 * @param {string} src @param {Record<string, unknown>} scope @returns {(p: string) => void}
 */
function chooserFolder(src, scope) {
  assert.match(src, /  setFolder: \(p\) => setChooserFolder\(p\),/);
  const at = src.indexOf("let chooserSets = 0;");
  const end = src.indexOf("\n}\n", src.indexOf("function setChooserFolder(p) {", at)) + 2;
  assert.ok(at > 0 && end > at, "the setter and its count stand together");
  return new Function(...Object.keys(scope), `${src.slice(at, end)}\nreturn setChooserFolder;`)(...Object.values(scope));
}

describe("the files attached in a chat's box are that chat's", () => {
  /**
   * The page's chats, the box on the stub document, and the page's `selectChat` lifted over them: what each Send carried.
   * @param {any[]} chats
   */
  const page = (/** @type {any[]} */ chats, /** @type {Record<string, unknown>} */ more = {}) => {
    const at = { currentId: /** @type {string | null} */ (null), chats: new Map(chats.map((c) => [c.id, c])) };
    /** @type {[string, string[]][]} */
    const sent = [];
    const b = box({ getChat: () => at.chats.get(at.currentId) || null, onSend: (/** @type {string} */ text, /** @type {any[]} */ files) => { sent.push([text, files.map((f) => f.name)]); return true; } });
    const composer = new Proxy({ setDraft: (/** @type {any[]} */ ...a) => /** @type {any} */ (b.c.setDraft)(...a), meter: () => b.c.meter() }, { get: (t, k) => (k in t ? /** @type {any} */ (t)[k] : NOOP) });
    const { selectChat } = lift(["selectChat"], { state: at, chatOf: (/** @type {string} */ id) => at.chats.get(id) || null, composer, draftFor: drafts.draftFor, draftFilesFor: drafts.draftFilesFor, ...more });
    return { b, sent, show: (/** @type {string} */ id) => selectChat(id) };
  };
  const NOTES = { kind: "text", name: "notes.txt", size: 5, text: "hello" };

  // (fails before: yes — the bug hunt of 10-30, UIS-1 / UIC-1: switching chats brought back the words alone, so a file
  // attached in one chat stayed in the box, its chip showing, and went with the next Send in another)
  test("another chat's box opens without the files attached in this one, and they come back with their chat", () => {
    const p = page([{ id: "a", chainId: "s-files-a", cwd: "C:/work", turns: [] }, { id: "b", chainId: "s-files-b", cwd: "C:/work", turns: [] }]);
    p.show("a");
    p.b.c.attach(NOTES);
    p.show("b");
    p.b.press("in b");
    p.show("a");
    p.b.press("in a");
    assert.deepEqual(p.sent, [["in b", []], ["in a", ["notes.txt"]]]);
    p.show("b");
    p.b.press("in b again");
    assert.deepEqual(p.sent.at(-1), ["in b again", []], "sent with its chat: the box holds them no more");
  });

  // (fails before: yes — the owner's of 11-09: a message the card stopped stood in its row, waiting for room, and the
  // chat shown again put its words, kept as the draft for a refresh, in the box too)
  test("a message a card stopped stays in its row: the chat shown again leaves the box empty; with no row, as after a refresh, its words are back", () => {
    // The tab's own store, where a chat's draft is kept.
    const g = /** @type {any} */ (globalThis);
    const had = Object.getOwnPropertyDescriptor(g, "sessionStorage");
    const store = new Map();
    g.sessionStorage = { getItem: (/** @type {string} */ k) => store.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void store.set(k, String(v)), removeItem: (/** @type {string} */ k) => void store.delete(k) };
    try {
      const held = { n: 3, userText: "the held words", blocks: [], status: "error", reply: { errorBody: { needsCompaction: true } }, makingRoom: true };
      const a = { id: "a", chainId: "s-held-a", cwd: "C:/work", turns: [held] };
      const p = page([a, { id: "b", chainId: "s-held-b", cwd: "C:/work", turns: [] }], { heldInRow, saveDraft: drafts.saveDraft });
      drafts.saveDraft(a, "the held words");
      p.show("b");
      p.show("a");
      assert.equal(p.b.c.draft(), "", "its row holds them");
      assert.equal(drafts.draftFor(a), "the held words", "and the draft keeps them for a refresh");
      a.turns = [];
      p.show("b");
      p.show("a");
      assert.equal(p.b.c.draft(), "the held words", "a page with no row has them in the box");
    } finally {
      if (had) Object.defineProperty(g, "sessionStorage", had);
      else delete g.sessionStorage;
    }
  });

  // (fails before: yes — the bug hunt of 10-30, UIS-1: the Start's files stayed in the box in any folder's Start)
  test("the Start's files come back in the folder they were attached in, as its words do, and never in another's", () => {
    const p = page([
      { id: "n1", chainId: null, cwd: "C:/work", turns: [] },
      { id: "s", chainId: "s-files-s", cwd: "C:/work", turns: [] },
      { id: "n2", chainId: null, cwd: "C:/work/", turns: [] },
      { id: "n3", chainId: null, cwd: "D:/elsewhere", turns: [] },
    ]);
    p.show("n1");
    p.b.c.attach(NOTES);
    p.show("s");
    p.show("n3");
    p.b.press("in another folder");
    p.show("n2");
    p.b.press("in the same folder");
    assert.deepEqual(p.sent, [["in another folder", []], ["in the same folder", ["notes.txt"]]]);
    assert.deepEqual(drafts.draftFilesFor({ chainId: null, cwd: "C:/work" }), [], "sent: the Start keeps nothing");
  });

  // (fails before: yes — the bug hunt of 10-30, UIS-1: a folder chosen on the Start took the words in its box to that
  // folder's Start and left the files attached with them on the other's)
  test("a folder chosen on the Start takes the files in its box with its words", async () => {
    const { APP_SRC } = await import("./helpers/app-lift.js");
    const c = { id: "n", chainId: null, cwd: "C:/one", turns: [] };
    drafts.saveDraftFiles(c, [NOTES]);
    const scope = {
      folderIn: { value: "", dispatchEvent: () => true },
      chatOf: () => c,
      state: { currentId: "n" },
      composer: { draft: () => "", files: () => [NOTES] },
      saveDraft: drafts.saveDraft,
      saveDraftFiles: drafts.saveDraftFiles,
      draftFilesFor: drafts.draftFilesFor,
      headerModule: { refreshGit() {} },
      transcript: { refreshFolder() {} },
    };
    const setFolder = chooserFolder(APP_SRC, scope);
    setFolder("C:/two");
    assert.deepEqual(drafts.draftFilesFor({ chainId: null, cwd: "C:/two" }).map((f) => f.name), ["notes.txt"]);
    drafts.saveDraftFiles({ chainId: null, cwd: "C:/two" }, []);
  });

  // (fails before: yes — the review of f50fcf6f9: the Start's folder took the chat whose session was being made to the
  // folder chosen, ["C:/two", "C:/two", ["C:/two"]], while its session was made in the one it had)
  test("a folder chosen on the Start while the chat's first send makes its session leaves the chat in the folder its session is made in", async () => {
    const { APP_SRC } = await import("./helpers/app-lift.js");
    const c = { id: "n", chainId: null, cwd: "C:/one", turns: [], making: new Promise(() => {}) };
    /** @type {string[]} */
    const read = [];
    const chip = { value: "C:/one", dispatchEvent: () => true };
    const scope = {
      folderIn: chip,
      chatOf: () => c,
      state: { currentId: "n" },
      composer: { draft: () => "", files: () => [] },
      saveDraft: drafts.saveDraft,
      saveDraftFiles: drafts.saveDraftFiles,
      draftFilesFor: drafts.draftFilesFor,
      headerModule: { refreshGit: () => void read.push(c.cwd) },
      transcript: { refreshFolder() {} },
    };
    const setFolder = chooserFolder(APP_SRC, scope);
    setFolder("C:/two");
    assert.deepEqual([c.cwd, chip.value, read], ["C:/one", "C:/two", []], "the chip says the folder chosen, which the box's next message opens a new chat in; the chat stays where its session is made");
  });

  // (fails before: yes — the bug hunt of 10-30, UIS-1: a chat's first send left the files attached while its session
  // was made on the Start, where the next new chat in that folder brought them back)
  test("files attached while a chat's session is made go with the chat to its session", async () => {
    const chat = { id: "n", chainId: /** @type {string | null} */ (null), cwd: "C:/made", turns: [] };
    drafts.saveDraftFiles(chat, [NOTES]);
    const { ensureSession } = lift(["ensureSession", "makeSession?"], { state: { currentId: "other" }, api: async () => ({ id: "s-files-made", cwd: "C:/made" }), draftFor: drafts.draftFor, saveDraft: drafts.saveDraft, draftFilesFor: drafts.draftFilesFor, saveDraftFiles: drafts.saveDraftFiles });
    await ensureSession(chat, "m");
    assert.equal(chat.chainId, "s-files-made");
    assert.deepEqual(drafts.draftFilesFor(chat).map((f) => f.name), ["notes.txt"], "the session's box has them");
    assert.deepEqual(drafts.draftFilesFor({ chainId: null, cwd: "C:/made" }), [], "the Start's does not");
  });
});

describe("the page's shortcuts where you type", () => {
  /** A keydown as the matcher reads it. @param {Record<string, any>} o */
  const ev = (o) => /** @type {any} */ ({ repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: "", code: "", target: null, ...o });

  // (fails before: yes — the bug hunt of 10-30, UIS-7: a shortcut rebound to a key that types — `/`, a letter — fired in
  // the message box and in every other field, and its key never typed)
  test("a shortcut rebound to a key that types is the field's while you type, and the command's elsewhere; the defaults answer in the box", () => {
    rebind("find", "/");
    const box = { tagName: "TEXTAREA" };
    assert.equal(matchShortcut(ev({ key: "/", target: box })), "", "typed in the box");
    assert.equal(matchShortcut(ev({ key: "/", target: { tagName: "INPUT" } })), "");
    assert.equal(matchShortcut(ev({ key: "/", target: { tagName: "DIV", isContentEditable: true } })), "");
    assert.equal(matchShortcut(ev({ key: "/", target: { tagName: "BUTTON" } })), "find", "elsewhere it is the command's");
    assert.equal(matchShortcut(ev({ key: "k", ctrlKey: true, target: box })), "command-center", "Ctrl+K from the box");
    assert.equal(matchShortcut(ev({ key: "F6", code: "F6", target: box })), "focus-next", "a function key");
    assert.equal(matchShortcut(ev({ key: "1", code: "Digit1", altKey: true, target: box })), "view-chat");
  });

  // (fails before: yes — the bug hunt of 10-30, UIS-7: with a dialog open, another's shortcut opened it over the first —
  // Ctrl+Shift+F twice gave two fork dialogs, Ctrl+O two folder pickers, Ctrl+K a command center over either)
  test("a shortcut that opens a dialog opens none over a dialog already open, and keeps its key; with none open, or a sheet, it opens", () => {
    /** @type {string[]} */
    const opened = [];
    /** @type {any} */
    let modal = null;
    /** A sheet open (`.zc-sheet`, aria-modal too): a dialog opens over it, as it always did. */
    let sheet = false;
    const at = { currentId: "c1", chats: new Map([["c1", { id: "c1", turns: [{ n: 1, past: false }] }]]) };
    const { onShortcutKey } = lift(["OPENS_DIALOG?", "VIEW_ONLY_KEYS_OFF?", "onShortcutKey"], {
      matchShortcut, state: at, chatOf: (/** @type {string} */ id) => at.chats.get(id) || null,
      // This computer's page: a view-only device's opens no fork (remote-view-ui.test.js); a whole page, not the chat
      // alone (chat-only-mode.test.js).
      viewOnlyPage: () => false,
      CHAT_ONLY: false,
      CHAT_ONLY_OFF: new Set(),
      document: { querySelector: (/** @type {string} */ s) => (s === '.zc-dialog[aria-modal="true"]' ? modal : s === '[aria-modal="true"]' && sheet ? {} : null) },
      commandCenter: { open: () => opened.push("command center") },
      forkModal: () => opened.push("fork"),
      openFolder: () => opened.push("folder"),
    });
    /** A key pressed: whether the page kept it from the browser. @param {Record<string, any>} o */
    const press = (o) => {
      let kept = false;
      onShortcutKey({ ...ev(o), preventDefault: () => { kept = true; } });
      return kept;
    };
    const keys = [{ key: "k", ctrlKey: true }, { key: "F", code: "KeyF", ctrlKey: true, shiftKey: true }, { key: "o", ctrlKey: true }];
    for (const k of keys) press(k);
    assert.deepEqual(opened, ["command center", "fork", "folder"]);
    sheet = true;
    opened.length = 0;
    for (const k of keys) press(k);
    assert.deepEqual(opened, ["command center", "fork", "folder"], "a sheet open: each opens over it");
    sheet = false;
    modal = {};
    opened.length = 0;
    assert.deepEqual(keys.map(press), [true, true, true], "the keys stay the page's: the browser opens nothing of its own");
    assert.deepEqual(opened, [], "nothing opened over the dialog");
  });
});

describe("what the box takes in", () => {
  // (fails before: yes — the bug hunt of 10-30, UIC-2: a paste that carried a picture was cancelled whole, so the words
  // that came with it — a web page's selection, Word's — never reached the box)
  test("a paste with a picture and words: the picture is attached and the words are left to the box; a picture alone is taken whole", async () => {
    const had = g.FileReader;
    g.FileReader = class {
      /** @type {(() => void) | null} */ onload = null;
      result = "";
      readAsDataURL() { this.result = "data:image/png;base64,AAAA"; setImmediate(() => this.onload?.()); }
    };
    try {
      const b = box();
      const shot = new File(["png"], "shot.png", { type: "image/png" });
      /** A paste of the picture, with the words given. @param {string} words */
      const paste = async (words) => {
        let cancelled = false;
        b.ta.dispatch("paste", {
          clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => shot }], getData: (/** @type {string} */ t) => (t === "text/plain" ? words : "") },
          preventDefault: () => { cancelled = true; },
        });
        await settle();
        return cancelled;
      };
      assert.equal(await paste("the words around the picture"), false, "the box's own paste puts the words in");
      assert.equal(await paste(""), true, "nothing to put in the box: the paste is the picture's");
      assert.equal(b.host.querySelectorAll(".att-name").length, 2, "attached, both times");
    } finally {
      if (had) g.FileReader = had;
      else delete g.FileReader;
    }
  });

  // (fails before: yes — the review of the 10-30 fixes, UIS-1's race: a file still being read as the box went to another
  // chat was added to that chat's box, and went with its Send)
  test("a file still being read as the box goes to another chat joins neither; one read with the box its own is kept", async () => {
    const b = box();
    let release = (/** @type {string} */ _t) => {};
    const slow = { name: "slow.txt", size: 5, type: "text/plain", text: () => new Promise((r) => { release = r; }) };
    b.host.querySelector(".composer-shell").dispatch("drop", { dataTransfer: { files: [slow] } });
    await settle();
    // Another chat chosen: the box is handed its files.
    b.c.setDraft("", [{ kind: "text", name: "theirs.txt", size: 1, text: "b" }]);
    release("hello");
    await settle();
    assert.deepEqual(b.host.querySelectorAll(".att-name").map((/** @type {any} */ n) => n.textContent), ["theirs.txt"]);
    b.host.querySelector(".composer-shell").dispatch("drop", { dataTransfer: { files: [new File(["x"], "mine.txt", { type: "text/plain" })] } });
    await settle();
    assert.deepEqual(b.host.querySelectorAll(".att-name").map((/** @type {any} */ n) => n.textContent), ["theirs.txt", "mine.txt"]);
  });

  // (fails before: yes — the owner's word of 10-30, PDFs in the box: a PDF was refused in words, by its type, its name or
  // its first bytes, and the menu offered images and text alone)
  test("a PDF is taken as a PDF, by its type, its name or its first bytes, its bytes whole; a text file is taken as text; the menu offers PDFs", async () => {
    const had = g.FileReader;
    // A data URL of the file's own bytes, as the browser's reader gives one.
    g.FileReader = class {
      /** @type {(() => void) | null} */ onload = null;
      result = "";
      /** @param {Blob} f */
      readAsDataURL(f) { void f.arrayBuffer().then((b) => { this.result = `data:${f.type || "application/octet-stream"};base64,${Buffer.from(b).toString("base64")}`; this.onload?.(); }); }
    };
    try {
      /** @type {string[]} */
      const said = [];
      /** @type {any[]} */
      let files = [];
      const b = box({ onToast: (/** @type {string} */ m) => said.push(m), onSend: (/** @type {string} */ _t, /** @type {any[]} */ f) => { files = f; return true; } });
      const pdfs = ["%PDF-1.7 binary", "%PDF-1.4 binary", "%PDF-1.5 binary"];
      b.host.querySelector(".composer-shell").dispatch("drop", { dataTransfer: { files: [
        new File([pdfs[0]], "report.pdf", { type: "application/pdf" }),
        new File([pdfs[1]], "scan.PDF", { type: "" }),
        new File([pdfs[2]], "untitled", { type: "" }),
        new File(["plain words"], "notes.txt", { type: "text/plain" }),
      ] } });
      await until(() => b.host.querySelectorAll(".att-name").length === 4, "the four files in the box");
      assert.deepEqual(said, [], "nothing refused");
      b.press("here they are");
      assert.deepEqual(files.map((f) => [f.name, f.kind]), [["report.pdf", "pdf"], ["scan.PDF", "pdf"], ["untitled", "pdf"], ["notes.txt", "text"]]);
      assert.deepEqual(files.slice(0, 3).map((f) => Buffer.from(f.data, "base64").toString()), pdfs, "each PDF's bytes whole");
      // The message carries each as a document, its bytes as they are; the text file fenced under its name.
      assert.deepEqual(attachments.attachmentBlock(files[0]), { type: "document", title: "report.pdf", source: { type: "base64", media_type: "application/pdf", data: files[0].data } });
      assert.equal(attachments.attachmentBlock(files[3]).type, "text");
      const composer = readFileSync(new URL("../src/ui/harness/composer/composer.js", import.meta.url), "utf8");
      assert.match(composer, /label: "Attach files…", [^\n]*desc: "Images, PDFs and text, 20 MB each"/);
      assert.match(String(attachments.createAttachments().input.getAttribute("accept")), /\.pdf,application\/pdf$/);
    } finally {
      if (had) g.FileReader = had;
      else delete g.FileReader;
    }
  });

  // (fails before: yes — the owner's word of 10-30, PDFs in the box: a box whose sends hand an agent pictures alone (the
  // Side tab's) had no way to refuse one, and would read it as noise under its name)
  test("a box that hands agents pictures alone refuses a PDF in words, by its type, its name or its first bytes, and offers none", async () => {
    /** @type {string[]} */
    const said = [];
    const a = attachments.createAttachments({ onReject: (m) => said.push(m) }, { pdfs: false });
    await a.add([
      new File(["%PDF-1.7 binary"], "report.pdf", { type: "application/pdf" }),
      new File(["%PDF-1.5 binary"], "untitled", { type: "" }),
      new File(["plain words"], "notes.txt", { type: "text/plain" }),
    ]);
    assert.deepEqual(a.list().map((f) => f.name), ["notes.txt"]);
    assert.deepEqual(said, ["report.pdf", "untitled"].map((n) => attachments.pdfRefused(n)));
    assert.doesNotMatch(String(a.input.getAttribute("accept")), /pdf/);
  });

  // (fails before: yes — a picture went as it was, however big: past the 5 MB of base64 Anthropic takes in one, its
  // provider refused the message)
  test("a picture past the 3.75 MB a picture may be is drawn smaller to fit, its type kept where a canvas writes it, and its card says so; one that cannot be is refused in words", async () => {
    const had = g.FileReader;
    g.FileReader = class {
      /** @type {(() => void) | null} */ onload = null;
      result = "";
      /** @param {Blob} f */
      readAsDataURL(f) { void f.arrayBuffer().then((b) => { this.result = `data:${f.type || "application/octet-stream"};base64,${Buffer.from(b).toString("base64")}`; this.onload?.(); }); }
    };
    try {
      // The box: what it keeps, and what it says.
      /** @type {string[]} */
      const said = [];
      /** @type {any[]} */
      const asked = [];
      const shrink = async (/** @type {Blob} */ f, /** @type {number} */ most) => {
        asked.push([f.size, most]);
        return { blob: new Blob([new Uint8Array(2_000_000)], { type: "image/jpeg" }), type: "image/jpeg" };
      };
      const a = attachments.createAttachments({ onReject: (m) => said.push(m) }, { shrink });
      await a.add([new File([new Uint8Array(5 * 1024 * 1024)], "photo.jpg", { type: "image/jpeg" }), new File([new Uint8Array(1000)], "small.png", { type: "image/png" })]);
      assert.deepEqual(asked, [[5 * 1024 * 1024, attachments.PICTURE_MAX_BYTES]], "only the big one is drawn smaller");
      const [photo, small] = a.list();
      assert.deepEqual([photo.size, photo.type, Buffer.from(photo.data, "base64").length, photo.smaller], [2_000_000, "image/jpeg", 2_000_000, { from: 5 * 1024 * 1024, type: "image/jpeg" }]);
      assert.equal(small.smaller, undefined);
      const el = /** @type {any} */ (a.el);
      assert.deepEqual(el.querySelectorAll(".att-size").map((/** @type {any} */ n) => n.textContent), ["JPG · 1.9 MB · made smaller", "PNG · 1000 bytes"]);
      assert.match(String(el.querySelectorAll(".att")[0].getAttribute("title")), /made smaller from 5 MB, to fit the 3\.75 MB a picture may be/);
      assert.equal(said.length, 0, said.join("\n"));
      const refused = attachments.createAttachments({ onReject: (m) => said.push(m) }, { shrink: async () => null });
      await refused.add([new File([new Uint8Array(5 * 1024 * 1024)], "huge.heic", { type: "image/heic" })]);
      assert.equal(refused.list().length, 0);
      assert.deepEqual(said, ["huge.heic is a picture of 5 MB, past the 3.75 MB a picture may be, and this browser could not draw it smaller"]);
      // The drawing smaller itself: bytes that go with the area, each try smaller by what the last was over.
      /** @type {[number, number, string][]} */
      const drawn = [];
      const draw = async (/** @type {number} */ w, /** @type {number} */ h, /** @type {string} */ type) => {
        drawn.push([w, h, type]);
        return new Blob([new Uint8Array(Math.round(w * h * 0.6))], { type });
      };
      const fit = await attachments.fitPicture({ width: 4000, height: 3000, type: "image/jpeg", size: 7_200_000 }, draw);
      assert.ok(fit && fit.blob.size <= attachments.PICTURE_MAX_BYTES, `${fit?.blob.size} bytes`);
      assert.deepEqual([fit?.type, drawn.every(([, , t]) => t === "image/jpeg")], ["image/jpeg", true], "a JPEG stays a JPEG");
      assert.ok(fit && fit.width < 4000 && Math.abs(fit.width / fit.height - 4 / 3) < 0.01, "its shape kept");
      const gif = await attachments.fitPicture({ width: 4000, height: 3000, type: "image/gif", size: 7_200_000 }, draw);
      assert.equal(gif?.type, "image/png", "a GIF, which a canvas does not write, is drawn as a PNG");
      assert.equal(await attachments.fitPicture({ width: 10, height: 10, type: "image/png", size: 9_000_000 }, async () => null), null, "a picture that cannot be drawn");
    } finally {
      if (had) g.FileReader = had;
      else delete g.FileReader;
    }
  });

  // (fails before: yes — the box took files past what Filament takes in one request, and the server refused the whole
  // message with a 413 once it was sent)
  test("attachments that together pass what Filament takes in one request are refused in the box in words: the one that would pass it as it comes, the message at Send", async () => {
    /** @type {string[]} */
    const said = [];
    const a = attachments.createAttachments({ onReject: (m) => said.push(m) }, { most: () => 10_000 });
    await a.add([new File(["a".repeat(6000)], "a.txt", { type: "text/plain" }), new File(["b".repeat(6000)], "b.txt", { type: "text/plain" })]);
    assert.deepEqual(a.list().map((f) => f.name), ["a.txt"]);
    assert.deepEqual(said, ["b.txt would take this message to 12 KB, past the 10 KB Filament takes in one request (server.maxBodyBytes)"]);
    assert.equal(a.over(), null);
    a.handOver([{ kind: "text", name: "c.txt", size: 12_000, text: "c".repeat(12_000) }]);
    assert.equal(a.over(), "This message's attachments come to 12 KB, past the 10 KB Filament takes in one request (server.maxBodyBytes): take some out and send again");
    // The chat's box reads what Filament takes from the config the page has, and refuses the message at Send.
    /** @type {string[]} */
    const toasts = [];
    const was = state.config;
    state.config = { server: { maxBodyBytes: 10_000 } };
    try {
      const b = box({ onToast: (/** @type {string} */ m) => toasts.push(m) });
      b.c.setDraft("", [{ kind: "text", name: "big.txt", size: 20_000, text: "x".repeat(20_000) }]);
      b.press("look at this");
      assert.deepEqual(b.sent, [], "nothing sent");
      assert.deepEqual(toasts, ["This message's attachments come to 20 KB, past the 10 KB Filament takes in one request (server.maxBodyBytes): take some out and send again"]);
      assert.equal(b.ta.value, "look at this", "the words stay in the box");
      assert.deepEqual(b.c.files().map((/** @type {any} */ f) => f.name), ["big.txt"], "and the file");
    } finally {
      state.config = was;
    }
  });

  // (fails before: yes — the bug hunt of 10-30, a Low: the drop overlay hid as the drag moved onto the box or a button
  // inside the shell, and showed again at their next dragover — a flicker all across the box)
  test("a drag over the shell keeps its overlay while it moves onto a part of the shell, and loses it as it leaves", () => {
    const b = box();
    const shell = b.host.querySelector(".composer-shell");
    const overlay = b.host.querySelector(".drop-overlay");
    shell.dispatch("dragover");
    assert.equal(overlay.classList.contains("hidden"), false);
    shell.dispatch("dragleave", { relatedTarget: b.ta });
    assert.equal(overlay.classList.contains("hidden"), false, "onto the box, inside the shell");
    shell.dispatch("dragleave", { relatedTarget: null });
    assert.equal(overlay.classList.contains("hidden"), true, "out of the window");
    shell.dispatch("dragover");
    shell.dispatch("dragleave", { relatedTarget: doc.document.body });
    assert.equal(overlay.classList.contains("hidden"), true, "onto the page around it");
  });
});

// (fails before: yes — the bug hunt of 10-30, UIC-5's two boxes the first pass did not reach: the control room's steer
// and the console Assistant's sent on the Enter that ends an input method's word)
test("the control room's and the console Assistant's Enter send nothing as an input method's word ends", () => {
  const ime = /e\.key === "Enter" && !e\.shiftKey && !e\.isComposing && e\.keyCode !== 229\) \{ e\.preventDefault\(\); /;
  const room = readFileSync("src/ui/harness/control-room.js", "utf8");
  assert.match(room.slice(room.indexOf('mail.addEventListener("keydown"')), new RegExp(`^mail\\.addEventListener\\("keydown", \\(e\\) => \\{\\s*(//[^\\n]*\\n\\s*)?if \\(${ime.source}steer\\(\\); \\}`));
  const assistant = readFileSync("src/ui/pages/assistant.js", "utf8");
  assert.match(assistant, new RegExp(`input\\.onkeydown = \\(e\\) => \\{ if \\(${ime.source}send\\(input\\.value\\); \\} \\};`));
});
