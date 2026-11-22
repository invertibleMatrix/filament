// @ts-check
// Another machine's chat shown in place (the remote desk of 11-22, s1j): This computer's page asks the desktop app to
// lay that machine's chat alone over its column beside the left bar (src/ui/harness/lib/desk-guest.js), measures the
// column as it moves, takes it from sight while a menu, a dialog or a screen of its own lies over it, follows it as its
// page goes to another chat, and lets it go as a chat of its own is chosen. A machine whose Filament shows no chat alone
// opens on its whole page, as before. The app's side is desktop-rail.test.js's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GUEST_COVERS, PLACE_MS, chainOfHash, createDeskGuest } from "../src/ui/harness/lib/desk-guest.js";
import { DESK_KEYS } from "../src/ui/harness/lib/chat-only.js";
import { SHORTCUTS } from "../src/ui/harness/shortcuts.js";

const COL = { left: 280, top: 0, width: 1160, height: 920 };
const STUDIO = { id: "m-studio", name: "Studio", flags: ["remote-key", "chat-only"] };
const OLD = { id: "m-old", name: "Old box", flags: ["remote-key"] };

/** A page as the guest reads it: its column, what lies over it, its look; and the app's bridge, as it was asked. @param {{ shows?: (p: any) => any }} [o] */
function page(o = {}) {
  /** @type {any[]} */
  const asked = [];
  /** @type {Function | null} */
  let guestHeard = null;
  const look = new Set(["theme-zai-dark"]);
  /** @type {any[]} */
  let over = [];
  let screen = false;
  let dim = false;
  let col = { ...COL };
  /** Whether the page has the keys, and on what: "body", "stage" (a field of the column's), "bar" (the left bar's). */
  let keys = { has: false, on: "body" };
  /** @type {any} */
  const inStage = { in: "stage" };
  const doc = {
    documentElement: { classList: { contains: (/** @type {string} */ c) => look.has(c) } },
    body: {},
    hasFocus: () => keys.has,
    get activeElement() {
      return keys.on === "body" ? doc.body : keys.on === "stage" ? inStage : { in: "bar" };
    },
    querySelector: (/** @type {string} */ s) => (s === ".coach-dim" && dim ? {} : null),
    querySelectorAll: (/** @type {string} */ s) => (s === GUEST_COVERS ? over.map((r) => ({ getBoundingClientRect: () => r, in: r.inStage ? "stage" : "page" })) : []),
  };
  const stage = /** @type {any} */ ({
    getBoundingClientRect: () => col,
    querySelector: (/** @type {string} */ s) => (s === ".main-frame.screen-on" && screen ? {} : null),
    contains: (/** @type {any} */ el) => el?.in === "stage",
  });
  /** The window's listeners, by event. @type {Map<string, Set<Function>>} */
  const on = new Map([["focus", new Set()], ["blur", new Set()]]);
  const win = {
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => void on.get(t)?.add(fn),
    removeEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => void on.get(t)?.delete(fn),
  };
  const fire = (/** @type {string} */ t) => [...(on.get(t) || [])].forEach((fn) => fn());
  const bridge = {
    showChat: (/** @type {any} */ p) => (asked.push(["show", p]), o.shows ? o.shows(p) : Promise.resolve(true)),
    placeChat: (/** @type {any} */ r, /** @type {any} */ k) => void asked.push(k ? ["place", r, "keys"] : ["place", r]),
    hideChat: () => void asked.push(["hide"]),
    onGuest: (/** @type {Function} */ fn) => void (guestHeard = fn),
  };
  /** @type {any[]} */
  const shownAs = [];
  /** @type {any[]} */
  const moved = [];
  /** @type {any[]} */
  const whole = [];
  /** @type {string[]} */
  const said = [];
  /** @type {any[]} */
  const timers = [];
  const make = (/** @type {any} */ b = bridge) =>
    createDeskGuest({
      bridge: b,
      stage,
      doc,
      win,
      openWhole: (machine, route) => void whole.push([machine, route]),
      onMoved: (g) => void moved.push(g),
      onShown: (s) => void shownAs.push(s),
      say: (w) => void said.push(w),
      every: (fn, ms) => (timers.push({ fn, ms, on: true }), timers.length),
      stopEvery: (t) => void (timers[t - 1].on = false),
    });
  return {
    make,
    asked,
    moved,
    whole,
    said,
    timers,
    shownAs,
    /** The page's keys gone — another machine's page over it — and back: what waited for it is said. */
    back: () => (fire("blur"), fire("focus")),
    /** The page given the keys, as the app does before a key it hands over. */
    focus: () => fire("focus"),
    /** @param {boolean} has @param {"body" | "stage" | "bar"} [on] */
    keys: (has, on = "body") => void (keys = { has, on }),
    guest: (/** @type {any} */ g) => guestHeard?.(g),
    cover: (/** @type {any[]} */ r) => void (over = r),
    screen: (/** @type {boolean} */ on) => void (screen = on),
    dim: (/** @type {boolean} */ on) => void (dim = on),
    column: (/** @type {any} */ r) => void (col = r),
    light: () => void (look.delete("theme-zai-dark"), look.add("theme-zai-light")),
  };
}
const RECT = { x: 280, y: 0, width: 1160, height: 920 };

// (fails before: yes — a chat of another machine's opened its machine's whole page over the window, the list with it)
test("a chat of a machine that shows one alone: the app asked to lay it over the column, in the page's look; the list marks it", async () => {
  const p = page();
  const g = p.make();
  assert.equal(await g.open(STUDIO, "#/task/c1"), true);
  assert.deepEqual(p.asked, [["show", { machine: "m-studio", route: "#/task/c1", rect: RECT, theme: "dark", focus: true }]], "the keys its as it shows");
  assert.deepEqual(p.moved, [{ machine: "m-studio", chain: "c1" }]);
  assert.deepEqual(p.shownAs, ["in"], "the shell told it is in sight");
  assert.deepEqual(g.showing(), { machine: "m-studio", chain: "c1" });
  assert.deepEqual(p.whole, []);
  assert.deepEqual(p.timers.map((t) => t.ms), [PLACE_MS], "measured again on its own too");
  g.place();
  assert.equal(p.asked.length, 1, "where it was: nothing told");
});

// (fails before: yes — nothing took the chat's view from over a menu of This computer's page: the menu stood under it)
test("out of sight while a menu, a dialog, a screen or a tip's shade lies over the column, or it is too small; back as it goes, where the column is", () => {
  const p = page();
  const g = p.make();
  return g.open(STUDIO, "#/task/c1").then(() => {
    p.cover([{ left: 1000, top: 40, width: 200, height: 300 }]);
    g.place();
    assert.deepEqual(p.asked.at(-1), ["place", null]);
    p.cover([{ left: 10, top: 40, width: 200, height: 300 }]);
    g.place();
    assert.deepEqual(p.asked.at(-1), ["place", RECT], "a menu over the list alone: back");
    for (const [cover, uncover] of /** @type {[() => void, () => void][]} */ ([[() => p.screen(true), () => p.screen(false)], [() => p.dim(true), () => p.dim(false)], [() => p.column({ ...COL, width: 4 }), () => p.column(COL)]])) {
      cover();
      g.place();
      assert.deepEqual(p.asked.at(-1), ["place", null]);
      uncover();
      g.place();
      assert.deepEqual(p.asked.at(-1), ["place", RECT]);
    }
    p.cover([]);
    p.column({ ...COL, left: 48, width: 1392 });
    g.place();
    assert.deepEqual(p.asked.at(-1), ["place", { x: 48, y: 0, width: 1392, height: 920 }], "the bar folded: the column wider");
    const n = p.asked.length;
    g.place();
    assert.equal(p.asked.length, n, "told only what moved");
    // Tooltips and toasts are not what it goes for.
    assert.doesNotMatch(GUEST_COVERS, /tooltip|toast/);
  });
});

test("the page's look moved: shown again in it, where it is", async () => {
  const p = page();
  const g = p.make();
  await g.open(STUDIO, "#/task/c1");
  p.light();
  g.place();
  assert.deepEqual(p.asked.at(-1), ["show", { machine: "m-studio", route: "#/task/c1", rect: RECT, theme: "light" }]);
});

// (fails before: yes — nothing followed the chat's page once it went elsewhere)
test("its page went to another chat of its machine's: the list marks that one; it stopped showing there: forgotten, nothing asked of the app", async () => {
  const p = page();
  const g = p.make();
  await g.open(STUDIO, "#/task/c1");
  p.guest({ id: "m-other", hash: "#/task/x" });
  assert.equal(p.moved.length, 1, "another machine's word: not this one's");
  p.guest({ id: "m-studio", hash: "#/task/c9/plan" });
  assert.deepEqual(p.moved.at(-1), { machine: "m-studio", chain: "c9" });
  p.guest({ id: "m-studio", hash: "#/" });
  assert.deepEqual(p.moved.at(-1), { machine: "m-studio", chain: null }, "its Start: no chat of the list's");
  p.guest({ id: "m-studio", hash: null });
  assert.equal(p.moved.at(-1), null);
  assert.equal(g.showing(), null);
  assert.ok(!p.asked.some((a) => a[0] === "hide"), "the app let it go itself");
  assert.equal(p.timers[0].on, false, "no longer measured");
});

test("let go as a chat of this computer's is chosen: the app told, the list's mark gone — once", async () => {
  const p = page();
  const g = p.make();
  g.close();
  assert.deepEqual(p.asked, [], "none shown: nothing to let go");
  await g.open(STUDIO, "#/task/c1");
  g.close();
  g.close();
  assert.deepEqual(p.asked.filter((a) => a[0] === "hide"), [["hide"]]);
  assert.equal(p.moved.at(-1), null);
  assert.deepEqual(p.shownAs, ["in", null]);
});

// (fails before: yes — a close while the open was still asked did nothing: the chat showed over the one chosen, unmarked)
test("let go while its open is still asked: the app told after it, so what it shows goes; its answer opens nothing", async () => {
  /** @type {Function[]} */
  const answers = [];
  const p = page({ shows: () => new Promise((ok) => answers.push(ok)) });
  const g = p.make();
  const asked = g.open(STUDIO, "#/task/c1");
  g.close();
  assert.deepEqual(p.asked.map((a) => a[0]), ["show", "hide"]);
  answers[0](true);
  assert.equal(await asked, false);
  assert.equal(g.showing(), null);
  assert.deepEqual([p.moved, p.shownAs], [[], []]);
  // An older machine's chat pressed while another's open is asked: that one let go before the window goes to the older.
  const q = page({ shows: () => new Promise((ok) => answers.push(ok)) });
  const h = q.make();
  const first = h.open(STUDIO, "#/task/c1");
  await h.open(OLD, "#/task/c2");
  assert.deepEqual(q.asked.map((a) => a[0]), ["show", "hide"]);
  assert.deepEqual(q.whole, [["m-old", "#/task/c2"]]);
  answers[1](true);
  await first;
  assert.equal(h.showing(), null);
});

// (fails before: yes — a permission's choices over this computer's composer counted as over the column: the chat never showed)
test("what stands in the column itself — a permission's choices over this computer's composer — keeps it in sight", async () => {
  const p = page();
  const g = p.make();
  p.cover([{ left: 300, top: 600, width: 800, height: 200, inStage: true }]);
  await g.open(STUDIO, "#/task/c1");
  assert.deepEqual(p.asked[0][1].rect, RECT);
  p.cover([{ left: 300, top: 600, width: 800, height: 200, inStage: true }, { left: 500, top: 100, width: 400, height: 300 }]);
  g.place();
  assert.deepEqual(p.asked.at(-1), ["place", null], "a dialog over the page: out of sight");
  assert.deepEqual(p.shownAs, ["in", "out"]);
});

// (fails before: yes — the keys stayed on this computer's page once Ctrl+K pressed in the chat closed, typing into its hidden box)
test("the keys back in the chat: after a key it handed this page, now or as what that opened goes; from a field of the column's unseen", async () => {
  const p = page();
  const g = p.make();
  await g.open(STUDIO, "#/task/c1");
  // Ctrl+B handed over: nothing comes over the column, the keys go back at once.
  p.keys(true, "bar");
  g.handed();
  assert.deepEqual(p.asked.at(-1), ["place", RECT, "keys"]);
  // Ctrl+K handed over: its dialog lies over the column; Esc puts the keys on the bar's row it was opened from.
  p.cover([{ left: 400, top: 80, width: 640, height: 400 }]);
  g.handed();
  assert.deepEqual(p.asked.at(-1), ["place", null]);
  p.cover([]);
  g.place();
  assert.deepEqual(p.asked.at(-1), ["place", RECT, "keys"]);
  // A menu of the bar's own, closed: the keys stay where the person left them.
  p.cover([{ left: 10, top: 80, width: 300, height: 400 }, { left: 400, top: 80, width: 100, height: 100 }]);
  g.place();
  p.cover([]);
  g.place();
  assert.deepEqual(p.asked.at(-1), ["place", RECT]);
  // A field of the column's took them unseen: they go to the chat.
  p.keys(true, "stage");
  g.place();
  assert.deepEqual(p.asked.at(-1), ["place", RECT, "keys"]);
  // This page without the keys: nothing to give back.
  p.keys(false, "stage");
  const n = p.asked.length;
  g.place();
  g.handed();
  assert.equal(p.asked.length, n);
});

test("opened out of sight — a screen leaving for it —: the keys its as it comes in sight", async () => {
  const p = page();
  const g = p.make();
  p.screen(true);
  await g.open(STUDIO, "#/task/c1");
  assert.equal(p.asked[0][1].rect, null);
  p.screen(false);
  p.keys(true, "bar");
  g.place();
  assert.deepEqual(p.asked.at(-1), ["place", RECT, "keys"]);
  assert.deepEqual(p.shownAs, ["out", "in"]);
});

// (fails before: yes — the column measured as the open was asked alone: a screen gone meanwhile showed it at the next look)
test("the column measured again as the open is answered: a screen that left meanwhile, in sight at once", async () => {
  /** @type {Function[]} */
  const answers = [];
  const p = page({ shows: () => new Promise((ok) => answers.push(ok)) });
  const g = p.make();
  p.screen(true);
  const asked = g.open(STUDIO, "#/task/c1");
  p.screen(false);
  answers[0](true);
  assert.equal(await asked, true);
  assert.deepEqual(p.asked.map((a) => [a[0], a[0] === "show" ? a[1].rect : a[1]]), [["show", null], ["place", RECT]]);
  assert.deepEqual(p.shownAs, ["out", "in"]);
});

// (fails before: yes — the fallback the plan asks for: a machine whose Filament is older opens as it always did)
test("a machine whose Filament shows no chat alone, or an app that would not lay it: its whole page at the chat, said once a machine; a browser's page says nothing", async () => {
  const p = page();
  const g = p.make();
  assert.equal(await g.open(OLD, "#/task/c1"), false);
  assert.equal(await g.open(OLD, "#/task/c2"), false);
  assert.deepEqual(p.whole, [["m-old", "#/task/c1"], ["m-old", "#/task/c2"]]);
  assert.deepEqual(p.said, [], "not while that machine's whole page lies over this one");
  p.focus();
  assert.deepEqual(p.said, [], "nor at the focus the app gave this page a moment before it went");
  p.back();
  p.back();
  assert.deepEqual(p.said, ["Old box's Filament shows its chats beside this list once it is updated: its whole page opened"], "said as the person is back, once");
  assert.ok(!p.asked.some((a) => a[0] === "show"), "the app not asked to lay it");
  const no = page({ shows: () => Promise.resolve(false) });
  assert.equal(await no.make().open(STUDIO, "#/task/c1"), false);
  assert.deepEqual(no.whole, [["m-studio", "#/task/c1"]]);
  const bare = page();
  assert.equal(await bare.make(null).open(STUDIO, "#/task/c1"), false);
  assert.deepEqual([bare.whole, bare.said], [[["m-studio", "#/task/c1"]], []]);
});

test("two opens close together: the later one's chat is the one marked, whatever answer comes first", async () => {
  /** @type {Function[]} */
  const answers = [];
  const p = page({ shows: () => new Promise((ok) => answers.push(ok)) });
  const g = p.make();
  const first = g.open(STUDIO, "#/task/c1");
  const second = g.open(STUDIO, "#/task/c2");
  answers[1](true);
  await second;
  answers[0](true);
  await first;
  assert.deepEqual(g.showing(), { machine: "m-studio", chain: "c2" });
  assert.deepEqual(p.moved, [{ machine: "m-studio", chain: "c2" }]);
});

test("the chat an address names", () => {
  assert.equal(chainOfHash("#/task/abc"), "abc");
  assert.equal(chainOfHash("#/task/a%20b/side"), "a b");
  for (const h of ["#/", "#/settings", "", null, undefined, "#/new/x"]) assert.equal(chainOfHash(h), null, String(h));
});

test("the keys the chat alone hands the desk are shortcuts of the page's own, each run by the page's key handler", () => {
  const ids = new Set(SHORTCUTS.map((s) => s.id));
  for (const k of DESK_KEYS) assert.ok(ids.has(k), k);
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const runs = app.slice(app.indexOf("function onShortcutKey("), app.indexOf("}[id];", app.indexOf("function onShortcutKey(")));
  for (const k of DESK_KEYS) assert.ok(runs.includes(/^[a-z]+$/.test(k) ? `    ${k}: ` : `    "${k}": `), `${k} runs here`);
});

test("app.js: the desk's guest made on This computer's own page alone, over the shell's column; a chat of its own chosen lets it go; a key handed over is run", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  for (const said of [
    'import { createDeskGuest } from "./lib/desk-guest.js";',
    "if (!CHAT_ONLY && !POPPED) {\n  const machines = /** @type {any} */ (globalThis).filamentMachines;\n  deskGuest = createDeskGuest({\n    bridge: machines,\n    stage: shell.contentCol,",
    "    onMoved: (g) => sidebar.showingThere(g),",
    "    onShown: (s) => shell.setGuest(s),",
    // A key handed over is run, and the keys go back to the chat (`handed`).
    "    if (!DESK_KEYS.includes(id)) return;\n    onShortcutKey(null, id);\n    deskGuest?.handed();",
    "function selectChat(id, opts = {}) {\n  // A chat of this computer's chosen: another machine's shown in place beside the bar goes (lib/desk-guest.js).\n  deskGuest?.close();\n  state.currentId = id;",
    // A full-frame screen leaves for it, as for a chat of this computer's.
    "    leaveScreen();\n    if (deskGuest) void deskGuest.open(m, route);",
    "  onOpenThere: (machine, chain) => sidebar.openOnMachine(",
    // The chat alone hands its list's keys to the desk, before it drops them.
    "  e?.preventDefault();\n  // The chat alone another machine's desk shows hands it the keys of the list beside it.\n  if (toDesk && DESK_KEYS.includes(id)) return void toDesk(id);",
    "const toDesk = CHAT_ONLY ? deskKeyOf() : null;",
  ])
    assert.ok(app.includes(said), said.slice(0, 70));
  const shell = readFileSync("src/ui/harness/shell.js", "utf8");
  assert.match(shell, /\n {4}contentCol,\n/, "the shell gives its column");
  // In sight, the column under it inert; standing at all, this computer's chat's crumb in the bar's row off.
  for (const said of ['root.classList.toggle("guest-up", !!s);', 'contentCol.inert = s === "in";', "if (crumbSlot) crumbSlot.inert = crumbOff();", 'return root.classList.contains("screen-up") || root.classList.contains("guest-up");'])
    assert.ok(shell.includes(said), said);
  assert.ok(readFileSync("src/ui/harness.css", "utf8").includes(".app-shell.screen-up .sess-top-crumb, .app-shell.guest-up .sess-top-crumb { visibility: hidden; }"));
});

test("sidebar.js: its rows of another machine's open through the page's guest; the chat shown in place is the one row marked", () => {
  const bar = readFileSync("src/ui/harness/sidebar.js", "utf8");
  for (const said of [
    "    openOnMachine(r.machine, deskRoute(r.there));",
    "    const open = () => openOnMachine(c.machine, deskRoute(c.there));",
    "    if (cb.openThere) return cb.openThere({ id: m.id, name: m.name, flags }, route);",
    "marked: () => (spaceAt ? null : guestAt ? `m:${guestAt.machine}/chat:${guestAt.chain}` : ",
    "const current = !spaceAt && !guestAt && !!chat && chat.id === state.currentId;",
    "const current = !spaceAt && !!guestAt && c.key === `m:${guestAt.machine}/chat:${guestAt.chain}`;",
  ])
    assert.ok(bar.includes(said), said.slice(0, 70));
  assert.equal(bar.split("const current = !spaceAt && !guestAt && !!chat && chat.id === state.currentId;").length - 1, 2, "its chats' rows and its side rows");
  assert.ok(!bar.includes("filamentApp?.openOn?.(c.machine.id"), "no row opens past the guest");
  // Ctrl+Shift+[ and ] step through another machine's rows too, in Now and under Projects, from the one shown in place.
  assert.ok(bar.includes(`const inNow = [...now.el.querySelectorAll('.now-row[data-chain], .now-row.is-there[data-key*="/chat:"]:not(.is-away)')];`));
  assert.ok(bar.includes('const inList = [...list.querySelectorAll(".sess-row:not(.desk-row.is-away)")];'));
});
