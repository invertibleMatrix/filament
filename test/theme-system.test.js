// @ts-check
// The theme as the system sets it: a page whose theme is System follows the system's dark or light, and its code fences
// restyle with it, as a switch in Settings makes them (the bug round of 10-23). System is the theme until one is chosen
// (the owner's of 11-09), harness.html setting it before the first paint by theme.js's rule; and Appearance as it draws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { stubDocument } from "./helpers/dom-stub.js";
import { prefs } from "../src/ui/harness/prefs.js";
import { watchTheme, applyTheme, themePref } from "../src/ui/harness/theme.js";
import { renderAppearance, SEARCH_ROWS } from "../src/ui/harness/settings/appearance.js";

/**
 * A stub page with a store and the system's scheme, `run` under it.
 * @param {(o: { document: any, kept: Map<string, string>, mq: { matches: boolean } }) => void} run
 */
function withPage(run) {
  const { document, restore } = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const prevMq = g.window.matchMedia;
  /** @type {Map<string, string>} */
  const kept = new Map();
  g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, v) };
  const mq = { matches: true, addEventListener() {} };
  g.window.matchMedia = () => mq;
  try {
    run({ document, kept, mq });
  } finally {
    g.window.matchMedia = prevMq;
    delete g.localStorage;
    restore();
  }
}

// (fails before: yes — the system's switch restyled the page, and every fence kept the old theme's colours)
test("the system's dark or light restyles the code fences on a page whose theme is System", () => {
  const { document, restore } = stubDocument();
  const g = /** @type {any} */ (globalThis);
  const prevMq = g.window.matchMedia;
  /** @type {Map<string, string>} */
  const kept = new Map();
  g.localStorage = { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, v) };
  try {
    /** @type {(() => void)[]} */
    const heard = [];
    const mq = { matches: true, addEventListener: (/** @type {string} */ _k, /** @type {() => void} */ fn) => void heard.push(fn) };
    g.window.matchMedia = () => mq;
    prefs.set("theme", "system");
    watchTheme();
    assert.equal(/** @type {any} */ (document).documentElement.classList.contains("theme-zai-dark"), true);
    // A fence coloured in the dark; still streaming, so nothing paints it again here.
    const fence = document.createElement("div");
    fence.className = "code-block";
    fence.setAttribute("data-hl", "github-dark");
    fence.setAttribute("data-open", "");
    document.body.append(fence);
    mq.matches = false;
    for (const fn of heard) fn();
    assert.equal(/** @type {any} */ (document).documentElement.classList.contains("theme-zai-light"), true, "the page is light now");
    assert.equal(fence.hasAttribute("data-hl"), false, "its fences are coloured again, in the light");
  } finally {
    g.window.matchMedia = prevMq;
    delete g.localStorage;
    restore();
  }
});

// (fails before: yes — the owner's of 11-09, "make the theme default to system": with none chosen the page was dark)
test("with no theme chosen the page follows the system; a theme chosen is kept, and stored prefs nothing reads load as they are", () => {
  withPage(({ document, kept, mq }) => {
    const dark = () => document.documentElement.classList.contains("theme-zai-dark");
    mq.matches = false;
    assert.equal(themePref(), "system");
    applyTheme();
    assert.equal(dark(), false, "a light system: light");
    mq.matches = true;
    applyTheme();
    assert.equal(dark(), true, "a dark system: dark");
    // A browser that chose a theme, and kept line numbers and wrap from an earlier page: its theme stands.
    kept.set("filament.harness.lineNumbers", "off");
    kept.set("filament.harness.wrapLines", "on");
    for (const [chosen, system, isDark] of /** @type {[string, boolean, boolean][]} */ ([["dark", false, true], ["light", true, false], ["sepia", false, false], ["sepia", true, true]])) {
      kept.set("filament.harness.theme", chosen);
      mq.matches = system;
      applyTheme();
      assert.deepEqual([themePref(), dark()], [chosen === "sepia" ? "system" : chosen, isDark], `${chosen} on a ${system ? "dark" : "light"} system`);
    }
    assert.equal(prefs.get("showReasoning"), true, "the other prefs read as before");
  });
});

// (fails before: yes — the page opened with theme-zai-dark until app.js ran, so a light system's page flashed dark)
test("harness.html sets the theme's class before the first paint, as theme.js would, for every theme and system", () => {
  const html = readFileSync("src/ui/harness.html", "utf8");
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(inline, "an inline script");
  assert.ok(html.indexOf(inline[0]) < html.indexOf('<link rel="stylesheet"'), "ahead of the stylesheets");
  for (const chosen of [null, "system", "dark", "light", "sepia"])
    for (const system of [false, true])
      withPage(({ document, kept, mq }) => {
        if (chosen) kept.set("filament.harness.theme", chosen);
        mq.matches = system;
        // The page as the parser has it: its class as harness.html writes it, then the script.
        const classes = new Set(["theme-zai-dark"]);
        const classList = { toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => void (on ? classes.add(c) : classes.delete(c)) };
        vm.runInNewContext(inline[1], { localStorage: /** @type {any} */ (globalThis).localStorage, window: { matchMedia: () => mq }, document: { documentElement: { classList } } });
        const early = [...classes].sort().join(" ");
        applyTheme();
        const late = ["theme-zai-dark", "theme-zai-light"].filter((c) => document.documentElement.classList.contains(c)).join(" ");
        assert.equal(early, late, `${chosen ?? "nothing"} stored on a ${system ? "dark" : "light"} system`);
      });
  // Its storage read failing (a browser's privacy mode), it still follows the system.
  const classes = new Set(["theme-zai-dark"]);
  const classList = { toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => void (on ? classes.add(c) : classes.delete(c)) };
  vm.runInNewContext(inline[1], { localStorage: { getItem: () => { throw new Error("denied"); } }, window: { matchMedia: () => ({ matches: false }) }, document: { documentElement: { classList } } });
  assert.deepEqual([...classes], ["theme-zai-light"]);
});

// (fails before: yes — the owner's of 11-09: Code colors had no control, line numbers and wrap were read by nothing, the
// chat's switches stood under "Code preview", and Performance mode said nothing of what it does)
test("Appearance: the code font size under Code preview, the chat's switches under Chat, and Performance mode in what it does", () => {
  withPage(({ document }) => {
    const body = document.createElement("div");
    renderAppearance(/** @type {any} */ (body));
    const drawn = body.children.map((/** @type {any} */ n) => (n.classList.contains("set-group-doc") ? `# ${n.textContent}` : n.querySelector(".settings-row-label")?.textContent));
    assert.deepEqual(drawn, ["App theme", "Animations", "UI font size", "# Code preview", "Code font size", "# Chat", "Show reasoning", "Show todos", "Group exploration tools", "Group terminal commands", "Group file changes", "Chat status", "Performance mode"]);
    assert.deepEqual(SEARCH_ROWS.map((r) => r.label), drawn.filter((l) => !l.startsWith("# ")), "the search's list is the rows drawn");
    const perf = body.children.find((/** @type {any} */ n) => n.querySelector?.(".settings-row-label")?.textContent === "Performance mode");
    assert.match(perf.querySelector(".settings-row-desc").textContent, /still being written shows as plain text/);
  });
});
