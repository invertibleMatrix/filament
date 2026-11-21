// @ts-check
// The chat's status capsule under the message box (the owner's word of 10-29: "when background commands are running
// this pill is shown on the title bar and easy to miss"). It stands first in the composer's strip — the composer gives
// it a slot of its own, apart from the widget slots — Appearance names that place first and the pref's default is it,
// and its popover opens above it, from its left edge, as a capsule at the window's foot needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { createComposer } from "../src/ui/harness/composer/composer.js";
import { CAPSULE_POP, STATUS_PLACES, createStatusCapsule, floats } from "../src/ui/harness/conversation/status-panel.js";
import { PREF_DEFAULTS } from "../src/ui/harness/prefs.js";
import { renderAppearance } from "../src/ui/harness/settings/appearance.js";

/** One background command at work, as lib/commands.js hands it. @type {import("../src/ui/harness/lib/commands.js").CommandRow} */
const COMMAND = { id: "b1", command: "npm test", cwd: "H:\\p", startedAt: Date.now() - 5000, agent: null, line: "", logPath: null };

// (fails before: yes — the composer had no `status` slot, and the app mounted the capsule in the header's)
test("the composer's strip begins with the status capsule's slot, which no widget is mounted in; the app mounts the capsule there, not in the header", () => {
  const d = stubDocument();
  try {
    const host = /** @type {any} */ (d.document.createElement("div"));
    const c = /** @type {any} */ (createComposer(host, { onSend: () => true, onStop: () => {}, getChat: () => ({ chainId: "c1", turns: [] }) }));
    const strip = host.querySelector(".composer-strip");
    assert.ok(c.status, "the composer hands the app the capsule's slot");
    assert.equal(c.status.parentNode, strip);
    assert.equal(strip.firstElementChild, c.status, "first in the strip, before Session");
    assert.ok(!Object.values(c.slots).includes(c.status), "not a widget slot: mountWidgets never reaches it");
  } finally {
    d.restore();
  }
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.match(app, /\ncomposer\.status\.append\(statusCapsule\.el\);\n/);
  assert.doesNotMatch(app, /statusSlot\.append\(statusCapsule\.el\)/, "the header holds it no more");
  const css = readFileSync("src/ui/harness.css", "utf8");
  assert.match(css, /\.composer-strip \.slot-status \{ display: contents; \}/, "a hidden capsule leaves no gap in the strip");
});

// (fails before: yes — the first place was "In the header", the default "header")
test("Appearance names the place under the message box first, and it is the default; it never floats", () => {
  assert.deepEqual({ ...STATUS_PLACES[0] }, { value: "composer", label: "Under the message box" });
  assert.equal(STATUS_PLACES.some((p) => p.value === "header"), false);
  assert.equal(PREF_DEFAULTS.statusPanel, "composer");
  assert.equal(floats(PREF_DEFAULTS.statusPanel), false, "the capsule says the status, not the floating panel");
});

// (fails before: yes — the bug hunt of 10-30, Appearance's Low: Chat status's line still put the capsule in the header, which holds it no more)
test("Appearance's Chat status row says where the capsule stands: under the message box", () => {
  const d = stubDocument();
  // The Animations row reads the system's reduced-motion preference.
  /** @type {any} */ (globalThis).window.matchMedia = () => ({ matches: false });
  try {
    const body = /** @type {any} */ (d.document.createElement("div"));
    renderAppearance(body);
    const row = body.querySelectorAll(".settings-row").find((/** @type {any} */ r) => r.querySelector(".settings-row-label")?.textContent === "Chat status");
    const said = row.querySelector(".settings-row-desc").textContent;
    assert.equal(said, "Where what the chat is doing shows: the capsule under the message box, or a panel floating over the chat.");
    assert.equal(said.includes(STATUS_PLACES[0].label.toLowerCase()), true, "in the words of the place it names first");
  } finally {
    d.restore();
  }
});

// (fails before: yes — the popover opened under the capsule from its right edge, as the header's did)
test("a background command shows the capsule, and a press opens its popover above it from its left edge", () => {
  const d = stubDocument();
  try {
    const c = createStatusCapsule({ onOpenPlan: () => {}, onGoal: () => {}, onStopCommand: () => {}, onCommandsTick: () => {} });
    const el = /** @type {any} */ (c.el);
    // Where the strip puts it: near the window's foot (the stub's window is 1440 × 900), at the composer's left.
    el.getBoundingClientRect = () => ({ top: 850, bottom: 876, left: 200, right: 330, width: 130, height: 26 });
    d.document.body.append(el);
    c.set({ turn: { phase: "ended", startedAt: null, round: 0, error: "" }, commands: [COMMAND] });
    assert.equal(el.classList.contains("hidden"), false, "a command at work shows it");
    assert.deepEqual([el.querySelector(".sc-lead").textContent, el.querySelector(".sc-more").textContent], ["Working", "1 command"]);
    el.dispatch("click");
    try {
      const pop = d.document.body.querySelector(".zc-popover");
      assert.ok(pop, "its popover");
      assert.equal(pop.getAttribute("data-side"), "top", "above the capsule");
      assert.equal(pop.style.left, "200px", "from the capsule's left edge");
    } finally {
      el.dispatch("click");
    }
    assert.deepEqual({ ...CAPSULE_POP }, { side: "top", align: "start", width: 340 });
  } finally {
    d.restore();
  }
});
