// @ts-check
// No infinite `spin` animation may rotate `linear` (issue #12): a linear rotation produces a new transform on every
// compositor frame, so each spinner repaints at the display's refresh rate — measured ~160 changes/s on a 160 Hz
// display, ≈43 % of one core for the three "Working" sidebar spinners on an otherwise idle app — instead of the few
// steps a second its 1 s duration suggests. The loader glyph (`ICONS.loader`) is 8 spokes at 45°, so `steps(8, end)`
// gives a uniform, visually distinct cadence (45° per step); the `.sc-dot` ring's `border-top-color` highlight is
// 90°-symmetric, so `steps(4, end)` there. Stepping cut the measured cost 13× on the same machine and window. Two
// spinners keep `linear` on purpose: `.sd-enhance.busy .sd-enhance-ic` spins the sparkles glyph and
// `.cag-icon.is-busy svg` spins whatever icon its button carries — neither has a rotation symmetry a step count could
// match, and a stepped rotation there would flicker rather than spin.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI = join(ROOT, "src", "ui");

/** Every stylesheet under src/ui, the vendored ones aside. @param {string} dir @returns {string[]} */
function sheets(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "vendor" ? [] : sheets(p);
    return e.name.endsWith(".css") ? [p] : [];
  });
}

/** A stylesheet read with its comments stripped. @param {string} p */
const sheetText = (p) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** `c` safe inside a RegExp. @param {string} c */
const literal = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The spinners whose glyph the step count must match: the 8-spoke loader (`steps(8, end)`) and the 90°-symmetric
// `.sc-dot` ring (`steps(4, end)`). Each entry is `[file under src/ui, the rule's selector, the animation shorthand]`.
const STEPS = [
  ["harness.css", ".live-spin svg", "spin 1s steps(8, end) infinite"],
  ["harness.css", ".now-gspin svg", "spin 1s steps(8, end) infinite"],
  ["harness.css", ".now-under-spin svg", "spin 1s steps(8, end) infinite"],
  ["harness.css", ".turn-live-spin svg", "spin 1s steps(8, end) infinite"],
  ["harness.css", ".sp-plan-ic.is-live svg", "spin 1s steps(8, end) infinite"],
  ["harness.css", ".plan-ic.doing.is-live svg", "spin 1s steps(8, end) infinite"],
  ["harness.css", ".tk-spin svg", "spin 1s steps(8, end) infinite"],
  ["harness.css", ".ssh-step.is-running .ssh-mark svg", "spin 1s steps(8, end) infinite"],
  ["harness.css", ".status-capsule.is-working .sc-dot, .status-capsule.is-room .sc-dot", "spin 1s steps(4, end) infinite"],
  ["harness/space/space.css", ".sp-spin svg", "spin 1s steps(8, end) infinite"],
  ["harness/panes/panes.css", ".mv-wait-spin svg, .zc-btn .mv-spin svg", "spin 1s steps(8, end) infinite"],
  ["harness/views/side.css", ".sw-spin", "spin 1.4s steps(8, end) infinite"],
  ["harness/views/teams.css", ".bd-spin", "bd-spin 1.4s steps(8, end) infinite"],
];

// The two spinners no step count fits (see the header): they may keep `linear`.
const KEPT_LINEAR = [".sd-enhance.busy .sd-enhance-ic", ".cag-icon.is-busy svg"];

test("the loader spinners turn in steps the glyph's symmetry allows, not linearly", () => {
  for (const [file, selector, animation] of STEPS) {
    const css = sheetText(join(UI, ...file.split("/")));
    const where = `${file}: ${selector}`;
    const block = css.match(new RegExp(`${literal(selector)}\\s*\\{([^}]*)\\}`));
    assert.ok(block, where);
    const declarations = block[1].replace(/\s+/g, " ").trim();
    assert.match(
      declarations,
      new RegExp(`(?:^|; )animation: ${literal(animation).replace(/\\,/g, ",")}(?:;|$)`),
      where,
    );
  }
});

test("no other infinite spin animation rotates linearly", () => {
  const bad = [];
  for (const p of sheets(UI)) {
    const css = sheetText(p);
    for (const m of css.matchAll(/animation\s*:\s*spin\s+[\d.]+s\s+(.*?)\s*infinite/g)) {
      const before = css.slice(0, m.index);
      const open = before.lastIndexOf("{");
      const owner = before.slice(before.lastIndexOf("}") + 1, open);
      const selector = owner.slice(owner.lastIndexOf("{") + 1).replace(/\s+/g, " ").trim();
      const timing = m[1].replace(/\s+/g, " ").trim();
      if (timing === "linear" && KEPT_LINEAR.includes(selector)) continue;
      if (/^steps\(\d+, end\)$/.test(timing)) continue;
      bad.push(`${relative(ROOT, p)}: ${selector} — spin ${timing} infinite`);
    }
  }
  assert.deepEqual(bad, []);
});
