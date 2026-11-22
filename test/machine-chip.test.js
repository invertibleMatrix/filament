// @ts-check
// The machine chip (src/ui/harness/lib/machine-chip.js; the owner's of 11-08, from the Mac over LAN: a dropdown left of
// Changes in the rail's place): none without the app's bridge, hidden until another machine is kept, then the machine
// the page is, its state, how many chats wait on you on the others, and its press the app's popover at its rectangle.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { machineChip } from "../src/ui/harness/lib/machine-chip.js";
import { ICONS } from "../src/ui/harness/lib/icons.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
before(() => {
  doc = stubDocument();
});
after(() => doc.restore());

/** The app's `filamentMachines`, faked: what the chip asked, and the state it is told. */
const fakeBridge = () => {
  /** @type {any[]} */
  const opened = [];
  /** @type {((s: any) => void) | null} */
  let hear = null;
  let stopped = 0;
  return {
    opened,
    tell: (/** @type {any} */ s) => hear?.(s),
    stopped: () => stopped,
    bridge: {
      open: (/** @type {any} */ r) => void opened.push(r),
      onState: (/** @type {(s: any) => void} */ fn) => {
        hear = fn;
        return () => void stopped++;
      },
    },
  };
};

// (fails before: yes — there was no chip: the rail stood at the window's left)
test("no bridge — a browser, or an app too old for it —: no chip", () => {
  assert.equal(machineChip({ bridge: undefined }), null);
  assert.equal(machineChip({ bridge: { onState() {} } }), null, "one that cannot open the popover: none");
});

test("hidden until another machine is kept; then its dot, its name, the others' count, and whether its popover is open", () => {
  const f = fakeBridge();
  /** @type {any[]} */
  const tips = [];
  const chip = /** @type {NonNullable<ReturnType<typeof machineChip>>} */ (machineChip({ bridge: f.bridge, tip: (el, o) => void tips.push([el, o]) }));
  const el = /** @type {any} */ (chip.el);
  assert.ok(el.classList.contains("hidden"), "before the app says anything");
  assert.equal(el.getAttribute("aria-haspopup"), "menu");
  f.tell({ shown: false, name: "This computer", status: "online", waiting: 0, open: false, frame: null });
  assert.ok(el.classList.contains("hidden"), "nothing kept beside this computer");
  f.tell({ shown: true, name: "DESKTOP-1", status: "online", waiting: 0, open: false, frame: null });
  assert.ok(!el.classList.contains("hidden"));
  assert.ok(el.classList.contains("pbtn") && el.classList.contains("hdr-machine"), "as Changes beside it looks");
  const [dot, face, name, chev, count] = el.childNodes;
  assert.equal(face.hidden, true, "an app that says no icon: none");
  assert.equal(dot.className, "mc-dot s-online");
  assert.equal(name.textContent, "DESKTOP-1");
  assert.ok(name.classList.contains("pbtn-label"), "its name gives way as the pane buttons' names do, narrow");
  assert.equal(chev.className, "pbtn-chev");
  assert.equal(count.hidden, true);
  assert.equal(el.getAttribute("aria-expanded"), "false");
  assert.equal(el.getAttribute("aria-label"), "Machine: DESKTOP-1, connected");
  assert.equal(tips.length, 1, "its tooltip given once, its words read as it shows");
  assert.equal(tips[0][1].title(), "DESKTOP-1 — connected. Switch machine");
  f.tell({ shown: true, name: "<b>Studio</b>", status: "offline", waiting: 120, open: true, frame: null });
  assert.equal(name.textContent, "<b>Studio</b>", "a name is text");
  assert.equal(dot.className, "mc-dot s-offline");
  assert.deepEqual([count.hidden, count.textContent], [false, "99+"]);
  assert.ok(el.classList.contains("on"));
  assert.equal(el.getAttribute("aria-expanded"), "true");
  assert.equal(el.getAttribute("aria-label"), "Machine: <b>Studio</b>, offline · 120 chats wait on you on another machine");
  f.tell({ shown: true, name: "Studio", status: "evil\" onclick=x", waiting: 1, open: false });
  assert.equal(dot.className, "mc-dot s-reconnecting", "a state it does not know: reconnecting, never written in");
  assert.equal(tips[0][1].title(), "Studio — reconnecting · 1 chat waits on you on another machine. Switch machine");
  chip.stop();
  assert.equal(f.stopped(), 1);
});

// (fails before: yes — the remote desk of 11-22: every machine's chip looked the same but for its name)
test("its icon in its colour, right of its state's dot, as the app says them; one it does not know is none, never written in", () => {
  const f = fakeBridge();
  const chip = /** @type {NonNullable<ReturnType<typeof machineChip>>} */ (machineChip({ bridge: f.bridge }));
  const el = /** @type {any} */ (chip.el);
  const face = el.childNodes[1];
  f.tell({ shown: true, name: "Studio", status: "online", color: "teal", icon: "server", waiting: 0 });
  assert.deepEqual([face.hidden, face.className, face.innerHTML], [false, "mc-ic c-teal", ICONS.server]);
  f.tell({ shown: true, name: "Studio", status: "online", color: "evil\" x", icon: "laptop", waiting: 0 });
  assert.deepEqual([face.hidden, face.className, face.innerHTML], [false, "mc-ic", ICONS.laptop], "a colour it does not know: the icon's own");
  f.tell({ shown: true, name: "Studio", status: "online", color: "teal", icon: "<img src=x>", waiting: 0 });
  assert.deepEqual([face.hidden, face.innerHTML], [true, ""]);
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  assert.match(css, /\.mc-ic\.c-teal \{ color: var\(--color-sys-teal-text\); \}/);
  assert.match(css, /\.mc-ic\[hidden\] \{ display: none; \}/);
});

test("pressed: the app's popover at its rectangle, the press its alone", () => {
  const f = fakeBridge();
  const chip = /** @type {NonNullable<ReturnType<typeof machineChip>>} */ (machineChip({ bridge: f.bridge }));
  const el = /** @type {any} */ (chip.el);
  el.getBoundingClientRect = () => ({ left: 1210.5, top: 10, width: 118, height: 28, right: 0, bottom: 0 });
  let stopped = 0;
  el.dispatch("click", { stopPropagation: () => void stopped++ });
  assert.deepEqual(f.opened, [{ x: 1210.5, y: 10, width: 118, height: 28 }]);
  assert.equal(stopped, 1, "no menu of the page's under it closes on the same press");
  f.tell({ shown: true, name: "DESKTOP-1", status: "online", waiting: 0 });
  assert.equal(el.title, "DESKTOP-1 — connected. Switch machine", "no tooltip given: its title");
});

test("the header mounts it left of Changes; it looks as the pane buttons do, its dot in the state's colour", () => {
  const header = readFileSync(new URL("../src/ui/harness/header.js", import.meta.url), "utf8");
  assert.match(header, /const machine = machineChip\(\{ tip: tooltip \}\);/);
  assert.match(header, /h\("div", \{ class: "c-right" \}, statusSlot, h\("span", \{ class: "c-sp" \}\), machine\?\.el \?\? null, paneSlot,/);
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  assert.match(css, /\.hdr-machine \{ gap: 7px; max-width: 200px; \}/);
  assert.match(css, /\.mc-dot\.s-online \{ background: var\(--color-sys-green\); \}/);
  assert.match(css, /\.mc-dot\.s-offline \{ background: var\(--color-sys-red\); \}/);
  assert.match(css, /\.mc-count\[hidden\] \{ display: none; \}/);
});
