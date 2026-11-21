// @ts-check
// Coloured words in the light theme (the pass of 10-26): a word in a system colour takes its hue's deep shade
// (`--color-sys-*-text`), which reads at 4.5:1 or more on white, the page and the sidebar; the bright colours stay for
// what is drawn. On dark a deep shade is the colour itself, so dark is as it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SHEETS = [
  "harness.css", "harness/instruments.css", "harness/settings/settings.css", "harness/panes/panes.css", "harness/views/views.css",
  "harness/views/team.css", "harness/views/teams.css", "harness/views/side.css", "harness/views/flow.css",
  "harness/views/overview.css", "harness/library/library.css", "harness/space/space.css", "harness/aqua.css", "tray-card.css",
];
const HUES = ["blue", "indigo", "purple", "green", "orange", "red", "teal", "cyan", "mint", "pink", "yellow", "gray"];
/** The colour variables a rule sets for its words and its drawing alike; each has a `-text` twin for the words. */
const TWINS = ["accent", "st", "pf", "chip", "sc-tone", "tool-tone", "tc-tone"];

/** @param {string} name */
const sheet = (name) => readFileSync(new URL(`../src/ui/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Each rule's selector and declarations, nested blocks flattened. @param {string} css */
function rules(css) {
  /** @type {{ selector: string, decls: [string, string][] }[]} */
  const out = [];
  const re = /([^{};]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const decls = m[2].split(";").map((d) => /^\s*([-\w]+)\s*:\s*([\s\S]+?)\s*$/.exec(d)).filter((x) => !!x).map((x) => /** @type {[string, string]} */ ([x[1], x[2]]));
    out.push({ selector: m[1].trim(), decls });
  }
  return out;
}
/** A theme block's own declarations. @param {string} css @param {"dark" | "light"} theme */
const block = (css, theme) => Object.fromEntries(rules(css).filter((r) => r.selector === `.theme-zai-${theme}`).flatMap((r) => r.decls));

/** @param {string} hex */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
/** @param {number[]} c */
const lum = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
/** @param {number[]} a @param {number[]} b */
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** @param {number[]} c @param {number} alpha @param {number[]} under */
const over = (c, alpha, under) => c.map((v, i) => v * alpha + under[i] * (1 - alpha));

// (fails before: yes — 382 words read the bright accents, #34c759 green at 2.2:1 and #007aff blue at 4.0:1 on white)
test("a word in a system colour reads its hue's deep shade, and so does a word in a colour a rule sets for it", () => {
  const bright = new RegExp(`var\\(--(color-sys-(${HUES.join("|")})|${TWINS.join("|")})[,)]`);
  const found = SHEETS.flatMap((name) => [...sheet(name).matchAll(/(?:^|[{;])\s*color\s*:([^;{}]*)/g)].filter((m) => bright.test(m[1])).map((m) => `${name}: color:${m[1].trim()}`));
  assert.deepEqual(found, []);
});

// (fails before: yes — no twin existed, so a pill's word was its state's bright colour)
test("a rule that sets a colour its words read sets the deep twin beside it", () => {
  const unpaired = SHEETS.flatMap((name) => rules(sheet(name)).flatMap((r) => {
    const props = new Set(r.decls.map(([p]) => p));
    return TWINS.filter((t) => props.has(`--${t}`) !== props.has(`--${t}-text`)).map((t) => `${name}: ${r.selector} --${t}`);
  }));
  assert.deepEqual(unpaired, []);
});

// (fails before: yes — there were no deep shades)
test("the deep shades read at 4.5:1 on white, the page, the sidebar and their own tint in light; on dark they are the colours", () => {
  const css = sheet("harness.css") + sheet("harness/instruments.css");
  const light = block(css, "light"), dark = block(css, "dark");
  const surfaces = { white: rgb("#ffffff"), page: rgb(light["--color-background"]), sidebar: rgb(light["--color-sidebar"]) };
  for (const hue of HUES) {
    const text = rgb(light[`--color-sys-${hue}-text`]);
    for (const [name, s] of Object.entries(surfaces)) assert.ok(ratio(text, s) >= 4.5, `${hue} on ${name}: ${ratio(text, s).toFixed(2)}`);
    const tint = over(rgb(light[`--color-sys-${hue}`]), 0.18, surfaces.white);
    assert.ok(ratio(text, tint) >= 4.5, `${hue} on its own tint: ${ratio(text, tint).toFixed(2)}`);
    assert.equal(dark[`--color-sys-${hue}-text`], `var(--color-sys-${hue})`, `${hue} on dark`);
  }
  // White words on the accent (a button, a selected row) read on its deep blue.
  assert.match(sheet("harness/aqua.css"), /:root \{ --aq-accent: var\(--color-sys-blue-text\);/);
});
