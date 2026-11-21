// @ts-check
// The instrument kit (HarnessV3 Step 6 design): the figures every popover prints, the SVG ring, the bar charts and the
// system controls — drawn on the fake DOM, so the rules the eye relies on (a sliver is never 0%, a tiny cost is never
// $0.00, a chart always shows its turns-to-come, an arrow key moves a segmented choice) are pinned without a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tok, usd, pct, clock, ago, ringSvg, kids, stackBar, barStrip, row, actions, segStep, segmented, switchRow, slider } from "../src/ui/harness/widgets/kit.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

const mk = /** @type {any} */ (fakeH);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (/** @type {string} */ f) => readFileSync(join(ROOT, f), "utf8");

test("every custom property instruments.css reads is defined in a harness sheet or set inline by the kit — a var() that resolves to nothing voids its whole declaration (the popover's entrance once played no animation at all)", () => {
  const css = read("src/ui/harness/instruments.css");
  const sheets = [css, read("src/ui/harness.css"), read("src/ui/harness/zc.css")].join("\n");
  // Set in a style attribute by the builders: the ring's circumference, the slider's fill, the bar strip's column
  // index and count, the preset face's color.
  const inline = new Set(["--c", "--fill", "--i", "--n", "--preset-color"]);
  const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
  const undefinedVars = used.filter((v) => !inline.has(v) && !sheets.includes(`${v}:`));
  assert.deepEqual(undefinedVars, []);
});

test("tok: chip-sized token counts — one decimal under 100K and 10M, none above, never negative", () => {
  assert.deepEqual([0, 830, 1000, 12_400, 99_950, 100_000, 1_200_000, 10_000_000, -5, NaN].map(tok), ["0", "830", "1K", "12.4K", "100K", "100K", "1.2M", "10M", "0", "0"]);
});

test("usd: cents from a dime up, more places below; a trailing zero past the cents dropped; a real sliver is never $0.00", () => {
  assert.equal(usd(0), "$0.00");
  assert.equal(usd(0.5), "$0.50");
  assert.equal(usd(12.345), "$12.35");
  assert.equal(usd(0.1), "$0.10");
  assert.equal(usd(0.08), "$0.08", "0.080 drops its trailing zero");
  assert.equal(usd(0.099), "$0.099");
  assert.equal(usd(0.0123), "$0.012");
  assert.equal(usd(0.005), "$0.005");
  assert.equal(usd(0.00004), "<$0.0001", "a cost too small to print is still not free");
  assert.equal(usd(Number.NaN), "$0.00");
  assert.deepEqual([usd(-1.5), usd(-0.05), usd(-0.00004)], ["-$1.50", "-$0.05", "-<$0.0001"], "the sign before the dollar, never $-0.05");
});

test("pct: a whole percent, <1% for a sliver that is not nothing, a dash with no whole", () => {
  assert.equal(pct(50, 200), "25%");
  assert.equal(pct(0.5, 100), "<1%");
  assert.equal(pct(0, 100), "0%");
  assert.equal(pct(3, 0), "–");
});

test("clock and ago: minutes and seconds left (an hour as h and mm); the age in a clock's words, never 60 min", () => {
  assert.deepEqual([0, 1, 4000, 245_000, 3_600_000, 3_725_000, -9].map(clock), ["0:00", "0:01", "0:04", "4:05", "1h 00m", "1h 02m", "0:00"]);
  const now = 1_000_000_000;
  assert.equal(ago(now - 10_000, now), "just now");
  assert.equal(ago(now - 5 * 60_000, now), "5 min ago");
  assert.equal(ago(now - 3580_000, now), "1 h ago", "59:40 rounds to the hour, not to 60 min");
  assert.equal(ago(now - 2 * 3_600_000, now), "2 h ago");
  assert.equal(ago(now - 3 * 86_400_000, now), "3 d ago");
});

test("ringSvg: parts clockwise from the top in their own colors (on style, never a presentation attribute), gaps only between neighbours, the notch only inside the ring", () => {
  const one = ringSvg({ size: 100, width: 10, parts: [{ f: 0.5, color: "var(--color-sys-blue)" }] });
  const c = 2 * Math.PI * 45;
  assert.equal((one.match(/class="inst-arc/g) || []).length, 1);
  assert.match(one, new RegExp(`stroke-dasharray="${Math.round(c * 0.5 * 100) / 100} `), "a single part has no gap: its dash is its share of the circle");
  assert.match(one, /style="--c:[\d.]+;stroke:var\(--color-sys-blue\)"/, "the color rides style");
  assert.doesNotMatch(one, /stroke="var\(/, "a custom property in a presentation attribute is not honored");
  assert.match(one, /class="inst-track"/);
  assert.doesNotMatch(one, /inst-notch|inst-draw/);

  const three = ringSvg({ size: 100, width: 10, parts: [{ f: 0.3, color: "a" }, { f: 0, color: "zero" }, { f: 0.2, color: "b" }, { f: 0.1, color: "c" }], notch: 0.85, notchColor: "var(--x)", draw: true, track: false });
  assert.equal((three.match(/class="inst-arc inst-draw"/g) || []).length, 3, "a zero part draws nothing; draw marks every arc");
  assert.doesNotMatch(three, /zero/);
  assert.doesNotMatch(three, /inst-track/, "track: false leaves the ring bare");
  const dashes = [...three.matchAll(/stroke-dasharray="([\d.]+) /g)].map((m) => Number(m[1]));
  assert.ok(dashes.reduce((a, b) => a + b, 0) < c * 0.6, "the caps and gaps come out of the parts — the arcs never overrun their share");
  assert.match(three, /<line class="inst-notch"[^>]*style="stroke:var\(--x\)"/, "the notch, in its own color");
  for (const bad of [0, 1, null, 1.2]) assert.doesNotMatch(ringSvg({ size: 20, width: 3, parts: [], notch: bad }), /inst-notch/, `no notch at ${bad}`);
  assert.match(ringSvg({ size: 20, width: 3, parts: [{ f: 4, color: "a" }] }), new RegExp(`stroke-dasharray="${Math.round(2 * Math.PI * 8.5 * 100) / 100} `), "a part over the whole is clamped to the circle");
});

test("stackBar: each part its share, a zero part named but not drawn; a total leaves room", () => {
  const bar = stackBar(mk, [{ value: 30, color: "a", label: "Read" }, { value: 0, color: "b", label: "Written" }, { value: 10, color: "c", label: "New" }], { total: 80 });
  assert.equal(bar.attrs["aria-label"], "Read 38%, Written 0%, New 13%");
  assert.equal(bar.kids.length, 2);
  assert.match(bar.kids[0].attrs.style, /flex-basis:37\.5%;background:a/, "against the total, not the sum");
});

test("stackBar (HarnessV3-NewTask): a ceiling is striped in its color through --c, and the notch marks a fraction of the whole — never at either end", () => {
  const bar = stackBar(mk, [{ value: 50, color: "a", label: "Fixed" }, { value: 25, color: "b", label: "Memory", hatch: true }], { total: 200, notch: 0.85 });
  assert.equal(bar.kids.length, 3);
  assert.equal(bar.kids[1].classList.contains("is-hatch"), true);
  assert.match(bar.kids[1].attrs.style, /flex-basis:12\.5%;--c:b$/, "the stripes take the color from --c, not a background");
  assert.equal(bar.kids[0].classList.contains("is-hatch"), false);
  assert.equal(bar.kids[2].attrs.class, "inst-stack-notch");
  assert.equal(bar.kids[2].attrs.style, "left:85%");
  for (const notch of [null, 0, 1, 1.2]) assert.equal(stackBar(mk, [{ value: 1, color: "a", label: "x" }], { notch }).kids.length, 1, `no notch at ${notch}`);
});

test("barStrip: a column per turn by value, the newest marked, an empty turn a stub, and the turns to come as ghost dots up to the slots", () => {
  const strip = barStrip(mk, [{ value: 2, label: "t1" }, { value: 0, label: "t2" }, { value: 4, label: "t3", mark: true }], { ariaLabel: "By turn", slots: 12 });
  assert.equal(strip.kids.length, 12, "a short session still draws the calendar's twelve");
  assert.equal(strip.kids.filter((/** @type {any} */ k) => k.classList.contains("is-ghost")).length, 9);
  assert.match(strip.attrs.style, /--n:12/);
  assert.match(strip.kids[0].attrs.style, /^height:50%/);
  assert.match(strip.kids[1].attrs.style, /^height:4%/, "an empty turn keeps its column as a stub");
  assert.equal(strip.kids[1].classList.contains("is-empty"), true);
  assert.equal(strip.kids[2].classList.contains("is-mark"), true);
  assert.equal(strip.kids[2].attrs.title, "t3");
  const capped = barStrip(mk, [{ value: 0.5, label: "half" }], { ariaLabel: "Hit rate", max: 1 });
  assert.match(capped.kids[0].attrs.style, /^height:50%/, "max sets the scale — a 50% hit rate is half a column, not a full one");
  const long = barStrip(mk, Array.from({ length: 20 }, (_, i) => ({ value: i + 1, label: `t${i}` })), { ariaLabel: "x", slots: 12 });
  assert.equal(long.kids.length, 20, "more turns than slots: every turn, no ghosts");
});

test("row and actions: a clickable row is a button with a chevron unless it has a control; a disabled action never fires; an empty footer is nothing", () => {
  let hits = 0;
  const plain = row(mk, { label: "Label", value: "7" });
  assert.equal(plain.tag, "div");
  const click = row(mk, { label: "Open", onClick: () => hits++ });
  assert.equal(click.tag, "button");
  assert.ok(click.kids.some((/** @type {any} */ k) => k.attrs?.class === "inst-row-chev"), "a button row shows where it goes");
  click.dispatch("click");
  assert.equal(hits, 1);
  const ctl = row(mk, { label: "With control", onClick: () => {}, trailing: mk("span", { class: "ctl" }) });
  assert.equal(ctl.kids.some((/** @type {any} */ k) => k.attrs?.class === "inst-row-chev"), false, "the control is the affordance");
  assert.equal(row(mk, { label: "No chev", onClick: () => {}, chevron: false }).kids.some((/** @type {any} */ k) => k.attrs?.class === "inst-row-chev"), false);

  let fired = 0;
  const foot = actions(mk, [null, { label: "Go", onClick: () => fired++, primary: true }, false, { label: "Off", onClick: () => fired++, disabled: true }]);
  const [go, off] = buttonsOf(foot);
  assert.equal(buttonsOf(foot).length, 2, "the empty entries are left out");
  assert.equal(go.classList.contains("is-primary"), true);
  go.dispatch("click");
  off.dispatch("click");
  assert.equal(fired, 1, "the disabled one does nothing");
  assert.equal(off.attrs["aria-disabled"], "true");
  assert.equal(actions(mk, [null, false]), null);
  assert.deepEqual(kids([null, "a", [undefined, "b", ["", false, "c"]]]), ["a", "b", "c"]);
});

test("segmented: a radiogroup; a click chooses, the arrow keys step and wrap and carry the focus, an unknown value starts from the end", () => {
  const options = [{ id: "auto", label: "Automatic" }, { id: "ask", label: "Ask first" }, { id: "off", label: "Off" }];
  assert.equal(segStep(options, "auto", 1), "ask");
  assert.equal(segStep(options, "auto", -1), "off", "left from the first wraps to the last");
  assert.equal(segStep(options, "off", 1), "auto");
  assert.equal(segStep(options, "gone", 1), "auto", "from nowhere, right is the first");
  assert.equal(segStep(options, "gone", -1), "off", "and left the last");

  let value = "auto";
  /** @type {string[]} */
  const changes = [];
  const seg = segmented(mk, { options, value: () => value, onChange: (id) => { changes.push(id); value = id; }, ariaLabel: "When to compact" });
  assert.equal(seg.el.attrs.role, "radiogroup");
  const btns = buttonsOf(seg.el);
  assert.deepEqual(btns.map((b) => b.attrs["aria-checked"]), ["true", "false", "false"]);
  assert.deepEqual(btns.map((b) => b.attrs.tabindex), ["0", "-1", "-1"], "one tab stop: the chosen one");
  btns[1].dispatch("click");
  assert.deepEqual(btns.map((b) => b.classList.contains("is-on")), [false, true, false]);
  seg.el.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(value, "off");
  assert.equal(btns[2].focused, true, "the focus follows the choice");
  seg.el.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(value, "auto", "and wraps");
  seg.el.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(changes, ["ask", "off", "auto"], "any other key is the browser's");
  assert.equal(textOf(seg.el), "Automatic|Ask first|Off");
});

test("switchRow and slider: the switch reports its new state; the slider fills to the thumb while it moves and writes once let go", () => {
  /** @type {boolean[]} */
  const flips = [];
  const sw = switchRow(mk, { label: "Recall into each turn", sub: "Relevant memories", checked: true, onChange: (on) => flips.push(on) });
  const input = sw.kids.find((/** @type {any} */ k) => k.tag === "input");
  assert.equal(input.attrs.role, "switch");
  assert.equal(input.attrs["aria-label"], "Recall into each turn");
  assert.equal(input.checked, true);
  input.dispatch("change", { target: { checked: false } });
  assert.deepEqual(flips, [false]);
  assert.match(textOf(sw), /Recall into each turn\|Relevant memories/);
  const locked = switchRow(mk, { label: "x", checked: false, disabled: true, onChange: () => {} });
  assert.ok("disabled" in locked.kids.find((/** @type {any} */ k) => k.tag === "input").attrs);

  /** @type {number[]} */
  const live = [];
  /** @type {number[]} */
  const wrote = [];
  const s = slider(mk, { min: 50, max: 95, value: 85, ariaLabel: "Compaction line", onInput: (v) => live.push(v), onChange: (v) => wrote.push(v) });
  assert.match(s.attrs.style, /--fill:77\.78%/, "85 on 50–95 fills 78% of the track");
  s.value = "70";
  s.dispatch("input", { target: s });
  assert.match(s.attrs.style, /--fill:44\.44%/, "the fill follows the thumb");
  assert.deepEqual([live, wrote], [[70], []], "moving writes nothing");
  s.dispatch("change", { target: s });
  assert.deepEqual(wrote, [70]);
});
