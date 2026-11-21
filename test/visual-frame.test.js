// @ts-check
// HarnessV4_Visuals_Plan E16 step 2, the page: an agent's visual drawn in a closed frame. The frame's document — its
// own policy, the harness's look by the names the guide gives, a script that says height, asks, links and failures
// (VS-D3, VS-D5, VS-D6, VS-D7, VS-D8) — the files Save writes (VS-D10), the line under a visual that failed (VC-13,
// VC-17), the drawing while its call streams (VS-D11, VC-37), where a visual stands in the turn (VC-41, VC-42, VC-48)
// and the page's rule that no frame loads an address (VC-43). The card itself is DOM; its guards are pinned in its
// source, and the drawing was looked at in a browser (the Logs, step 2).
// (fails before: yes — none of it existed: step 1 drew a "Draw request_flow" line and nothing else)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as server from "../src/core/visual-look.js";
import * as page from "../src/ui/lib/visual-look.js";
import {
  ASK_MAX, FRAME_SCRIPT, HEIGHT_MAX, codeFence, failureLine, failureOf, failureWords, failuresShown, fileNameOf, frameDoc, frameHeight,
  framePolicy, htmlFile, libraryOf, linkOf, lookFrom, svgFile, writingWords,
} from "../src/ui/harness/lib/visuals.js";
import { alignEvents, cardBoxes, foldSplit, roundDrew } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { WRITING_EVERY_MS, visualWriting, writingOf } from "../src/app/agent/visuals.js";
import { createInternalCall } from "../src/app/internal-call.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { loopToolArgs } from "../src/app/agent/tools.js";
import { serveStatic } from "../src/http/static.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { createUpdateReader } from "../src/adapters/agents/acp/updates.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { createAgentRun } from "../src/app/agent-run.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { FIXTURES } from "./helpers/app.js";

const { FILL_ALPHA, LOOK_TOKENS, VISUAL_HOSTS, VISUAL_HUES, VISUAL_NAMES } = server;
const read = (/** @type {string} */ f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

/** A theme as the page computes it: every token the look reads, a color as `#rrggbb`. */
const TOKENS = {
  "--color-foreground": "#1d1d1f",
  "--color-foreground-subtle": "#6e6e73",
  "--color-foreground-subtlest": "#a1a1a6",
  "--aq-card": "#ffffff",
  "--color-card": "#f5f5f7",
  "--aq-hairline": "#d2d2d7",
  "--aq-hairline-strong": "#b0b0b5",
  "--aq-accent": "#0a84ff",
  "--color-on-accent": "#ffffff",
  "--color-background": "#fafafa",
  "--font": "-apple-system, \"Segoe UI\", sans-serif",
  "--mono": "ui-monospace, monospace",
  "--r": "10px",
  "--r-sm": "6px",
  ...Object.fromEntries(VISUAL_HUES.map((h, i) => [`--color-sys-${h}`, `#${(16 + i).toString(16)}2040`])),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`--color-usage-chart-${i}`, `#40${(16 + i).toString(16)}80`])),
};
/** The page's color reader, as a canvas reads it: `#rrggbb` as `rgb()`, anything else no color. @param {string} v */
const color = (v) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
  if (!m) return null;
  const rgb = /** @type {[number, number, number]} */ ([m[1], m[2], m[3]].map((x) => parseInt(x, 16)));
  return { css: `rgb(${rgb.join(", ")})`, rgb, alpha: 1 };
};
const lightLook = () => lookFrom((t) => /** @type {any} */ (TOKENS)[t] || "", { light: true, motion: "reduced", color });

describe("the look a visual reads by (VS-D5, VS-D17)", () => {
  test("the page's copy of the hosts and names is the server's, word for word below each file's own header", () => {
    // The layers keep the page and the server apart (test/ratchets.test.js), so each has its own copy.
    const body = (/** @type {string} */ f) => read(f).replace(/^(\/\/.*\r?\n)+/, "");
    assert.equal(body("src/ui/lib/visual-look.js"), body("src/core/visual-look.js"));
    assert.deepEqual(Object.keys(page).sort(), Object.keys(server).sort());
    assert.deepEqual(page.VISUAL_NAMES, server.VISUAL_NAMES);
  });

  test("every name the guide gives has its value from the page's theme, in the guide's order; a hue's fill is its color, faint", () => {
    const look = lightLook();
    assert.deepEqual(Object.keys(look.names), Object.keys(VISUAL_NAMES), "every name, nothing more");
    for (const [name, value] of Object.entries(look.names)) assert.ok(value, `${name} has a value`);
    assert.equal(look.names["--text"], "rgb(29, 29, 31)", "a color as plain rgb(), so a chart's script can use it as it is");
    assert.equal(look.names["--accent"], "rgb(10, 132, 255)");
    assert.equal(look.names["--font"], TOKENS["--font"], "a font stack is kept as written");
    assert.equal(look.names["--radius"], "10px");
    const blue = color(TOKENS["--color-sys-blue"]);
    assert.equal(look.names["--blue-fill"], `rgba(${blue?.rgb.join(", ")}, ${FILL_ALPHA.light})`);
    const dark = lookFrom((t) => /** @type {any} */ (TOKENS)[t] || "", { light: false, color });
    assert.equal(dark.names["--blue-fill"], `rgba(${blue?.rgb.join(", ")}, ${FILL_ALPHA.dark})`, "a dark page's fill is a little stronger");
    assert.deepEqual([look.theme, look.motion, dark.theme, dark.motion], ["light", "reduced", "dark", "full"]);
    assert.equal(lookFrom(() => "", { light: true, motion: "sideways", color }).motion, "full", "a Motion value it does not know is Full");
    assert.equal(look.background, "rgb(250, 250, 250)");
    // A theme whose hue the reader cannot read still gives a fill the frame can compute.
    const unread = lookFrom((t) => (t.startsWith("--color-sys-") ? "color(display-p3 0 0 1)" : /** @type {any} */ (TOKENS)[t] || ""), { light: true, color });
    assert.equal(unread.names["--red-fill"], `color-mix(in oklab, var(--red) ${FILL_ALPHA.light * 100}%, transparent)`);
    assert.equal(unread.names["--red"], "color(display-p3 0 0 1)", "a color the reader cannot read is kept as written");
    // Every page token the look names exists in the harness's stylesheets.
    const css = ["src/ui/harness/aqua.css", "src/ui/harness.css", "src/ui/harness/zc.css", "src/ui/harness/instruments.css"].map((f) => { try { return read(f); } catch { return ""; } }).join("\n");
    for (const token of new Set(Object.values(LOOK_TOKENS))) assert.match(css, new RegExp(`${token.replace(/-/g, "\\-")}\\s*:`), `${token} is defined by the harness`);
  });
});

describe("the frame's document (VS-D3, VS-D6, VS-D7)", () => {
  test("its policy: nothing loads or connects but the five library hosts; no form is sent and no base is set", () => {
    const p = framePolicy();
    const rule = (/** @type {string} */ d) => (p.split("; ").find((r) => r.startsWith(`${d} `)) || "").split(" ").slice(1);
    assert.deepEqual(rule("default-src"), ["'none'"]);
    assert.deepEqual(rule("connect-src"), [...VISUAL_HOSTS], "VC-22, VC-23, VC-24: Filament and every other site are out of reach");
    for (const d of ["script-src", "style-src", "font-src", "img-src"]) for (const host of VISUAL_HOSTS) assert.ok(rule(d).includes(host), `${d} ${host}`);
    assert.deepEqual(rule("form-action"), ["'none'"]);
    assert.deepEqual(rule("base-uri"), ["'none'"]);
    assert.doesNotMatch(p, /'self'|\*|http:|frame-src|child-src/, "no wildcard, no own origin, no frame of its own");
  });

  test("the policy, the look, the base style and the script on one line, then the code: the code's lines are the document's", () => {
    const look = lightLook();
    const code = "<div id=a>one</div>\n<script>\nthrow new Error('three')\n</script>";
    const doc = frameDoc(code, look);
    const [head, ...rest] = doc.split("\n");
    assert.ok(head.endsWith("<body><div id=a>one</div>"), "the code begins on line 1");
    assert.equal(rest[1], "throw new Error('three')", "so its line 3 is the document's line 3 (VC-17)");
    assert.ok(!FRAME_SCRIPT.includes("\n"), "the script is one line");
    assert.doesNotThrow(() => new Function(FRAME_SCRIPT), "and it parses");
    assert.match(head, /^<!doctype html><html data-theme="light" data-motion="reduced"><head><meta charset="utf-8">/);
    assert.ok(head.includes(`<meta http-equiv="Content-Security-Policy" content="${framePolicy()}">`), "the policy, ahead of anything that loads");
    assert.ok(head.indexOf("Content-Security-Policy") < head.indexOf("<script>"));
    assert.ok(head.includes('<meta name="referrer" content="no-referrer">'));
    assert.ok(head.includes(`--text:${look.names["--text"]}`) && head.includes("color-scheme:light"));
    assert.match(head, /html\[data-motion="off"\] \*[^{]*\{animation:none!important;transition:none!important\}/, "Motion Off stops what the code animates");
    // (fails before: yes — Reduced gave every element a 0.01 ms transition on every property, so a style a script set
    // read back as its old value at once: mermaid 11.4.1, the guide's own address, laid three boxes out 2,074 px wide in
    // the look in a browser, 445 px with the rule gone)
    assert.match(head, /html\[data-motion="reduced"\] \*[^{]*\{animation-duration:\.01ms!important;animation-iteration-count:1!important;transition:none!important\}/, "Reduced ends an animation at once and stops every transition");
    assert.doesNotMatch(head, /transition-duration/, "no transition is given to an element that had none");
    assert.ok(head.indexOf("<script>") < head.indexOf("<body>"), "the script runs before the code");
    assert.doesNotMatch(FRAME_SCRIPT, /<\/script/i);
    assert.match(FRAME_SCRIPT, /window\.filament=Object\.freeze\(\{ask:ask\}\);window\.sendPrompt=ask;/, "Claude desktop's sendPrompt names the same ask");
    assert.ok(FRAME_SCRIPT.includes(`.slice(0,${ASK_MAX})`), "an ask is held to ASK_MAX characters");
    assert.equal(frameDoc("x", { ...look, theme: "dark", motion: "off" }).match(/data-theme="(\w+)" data-motion="(\w+)"/)?.slice(1).join(" "), "dark off");
    // (fails before: yes — harness.css's `--mono` spans two lines, so a script error in the code said a line one past
    // its own: the look in a browser found it)
    const spans = { ...look, names: { ...look.names, "--mono": "ui-monospace, Consolas,\n    monospace" } };
    assert.ok(frameDoc(code, spans).split("\n")[0].endsWith("<body><div id=a>one</div>"), "a value that spans lines is written on one");
    assert.ok(frameDoc(code, spans).includes("--mono:ui-monospace, Consolas, monospace;"));
  });

  test("the script, run: it says the height, an ask, a link and what failed, each marked as a visual's", () => {
    /** @type {any[]} */
    const said = [];
    /** @type {Record<string, Function[]>} */
    const on = {};
    const docOn = /** @type {Record<string, Function[]>} */ ({});
    const body = { scrollHeight: 321.2, getBoundingClientRect: () => ({ height: 300 }) };
    // A frame 200 px tall whose picture is wider than it: a horizontal scrollbar 15 px thick.
    const root = { style: /** @type {any} */ ({}), clientHeight: 185 };
    const document = { readyState: "complete", body, documentElement: root, addEventListener: (/** @type {string} */ k, /** @type {Function} */ f) => (docOn[k] ||= []).push(f), fonts: null };
    const window = /** @type {any} */ ({});
    /** @type {Function[]} */
    const resized = [];
    const run = new Function("window", "document", "parent", "addEventListener", "location", "innerHeight", "ResizeObserver", "MutationObserver", "queueMicrotask", FRAME_SCRIPT);
    run(window, document, { postMessage: (/** @type {any} */ m, /** @type {string} */ to) => said.push([m, to]) }, (/** @type {string} */ k, /** @type {Function} */ f) => (on[k] ||= []).push(f), { href: "about:srcdoc" }, 200,
      class { constructor(/** @type {Function} */ f) { resized.push(f); } observe() {} }, class { observe() {} }, (/** @type {Function} */ f) => f());
    assert.deepEqual(said.shift(), [{ kind: "height", h: 322 + 15, filament: "visual" }, "*"], "the picture's height, the scrollbar under it counted in");
    assert.equal(root.style.overflowY, "hidden", "no scrollbar of its own below the cap: it would narrow the picture as it is measured");
    body.scrollHeight = HEIGHT_MAX + 100;
    resized[0]();
    assert.deepEqual([said.shift()?.[0].h, root.style.overflowY], [HEIGHT_MAX + 115, "auto"], "past the cap, it scrolls inside (VC-49)");
    body.scrollHeight = 321.2;
    resized[0]();
    said.length = 0;
    window.filament.ask("x".repeat(ASK_MAX + 5));
    assert.deepEqual([said[0][0].kind, said[0][0].text.length], ["ask", ASK_MAX]);
    assert.equal(window.sendPrompt, window.filament.ask);
    assert.ok(Object.isFrozen(window.filament), "the code cannot swap the ask for its own");
    said.length = 0;
    const link = { href: "https://example.com/a", getAttribute: () => "https://example.com/a" };
    let prevented = false;
    docOn.click[0]({ target: { closest: () => link }, preventDefault: () => (prevented = true) });
    assert.deepEqual([said.shift()?.[0], prevented], [{ kind: "link", href: "https://example.com/a", filament: "visual" }, true], "a link is the page's to open, never the frame's");
    docOn.click[0]({ target: { closest: () => ({ href: "about:srcdoc#k", getAttribute: () => "#k" }) }, preventDefault: () => assert.fail("an anchor in the visual stays in it") });
    on.error[0]({ target: window, message: "Uncaught TypeError: x is not a function", lineno: 3, filename: "about:srcdoc" });
    on.error[0]({ target: window, message: "Uncaught Error: bad", lineno: 8812, filename: "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" });
    on.error[0]({ target: window, message: "ResizeObserver loop completed with undelivered notifications.", lineno: 0, filename: "" });
    on.error[0]({ target: { src: "https://esm.sh/mermaid@10" } });
    docOn.securitypolicyviolation[0]({ blockedURI: "https://evil.example/x.png", effectiveDirective: "img-src" });
    assert.deepEqual(said.map(([m]) => m), [
      { kind: "fail", what: "error", message: "Uncaught TypeError: x is not a function", line: 3, url: "", filament: "visual" },
      { kind: "fail", what: "error", message: "Uncaught Error: bad", line: 8812, url: "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js", filament: "visual" },
      { kind: "fail", what: "load", url: "https://esm.sh/mermaid@10", filament: "visual" },
      { kind: "fail", what: "blocked", url: "https://evil.example/x.png", directive: "img-src", filament: "visual" },
    ]);
  });
});

describe("the files Save writes (VS-D10, VC-34)", () => {
  test("HTML: a page that opens alone, as closed as its frame, in the colors of the moment; its asks do nothing", () => {
    const look = lightLook();
    const file = htmlFile("<div>IN_THE_CODE</div>", look, 'a "flow" <x>');
    assert.ok(file.includes(`<meta http-equiv="Content-Security-Policy" content="${framePolicy()}">`));
    assert.ok(file.includes("<title>a &quot;flow&quot; &lt;x></title>"), "the title escaped");
    assert.ok(file.includes(`html{background:${look.background}}`));
    assert.ok(file.includes("window.filament=Object.freeze({ask:function(){}});window.sendPrompt=window.filament.ask;"));
    assert.ok(file.includes("\n<div>IN_THE_CODE</div>\n"));
  });

  test("SVG: each name written in as its value, a name it does not know keeping its fallback, its own namespace", () => {
    const look = lightLook();
    const svg = svgFile('<svg viewBox="0 0 10 10"><rect fill="var(--blue-fill)" stroke="var( --text )"/><text font-family="var(--font)" fill="var(--nope, #123)">a</text><g fill="var(--nope)"/></svg>', look);
    assert.ok(svg?.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'));
    assert.ok(svg?.includes(`fill="${look.names["--blue-fill"]}"`) && svg.includes(`stroke="${look.names["--text"]}"`));
    assert.ok(svg?.includes(`font-family="-apple-system, 'Segoe UI', sans-serif"`), "a value's double quotes become single, inside an attribute");
    assert.ok(svg?.includes('fill="#123"') && svg.includes('fill="var(--nope)"'));
    const own = svgFile('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', look);
    assert.equal(own?.match(/xmlns=/g)?.length, 1);
    assert.equal(own?.match(/<\?xml/g)?.length, 1, "one prolog");
    assert.equal(svgFile("<div>not a drawing</div>", look), null, "Save offers SVG only for one drawing");
    assert.equal(fileNameOf("request flow/v2", "svg"), "request_flow_v2.svg");
    assert.equal(fileNameOf("", "html"), "visual.html");
  });

  test("Code shows the code as it is, whatever backticks it holds", () => {
    assert.equal(codeFence("<b>x</b>"), "```html\n<b>x</b>\n```");
    assert.equal(codeFence("a ```` b"), "`````html\na ```` b\n`````");
  });
});

describe("the line under a visual that failed (VS-D8, VC-13, VC-17, VC-46, VC-49)", () => {
  test("a library by its name and its host; a host the frame refuses; a script's error by its line, or by the library it came from", () => {
    assert.equal(libraryOf("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"), "Chart.js");
    assert.equal(libraryOf("https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"), "D3");
    assert.equal(libraryOf("https://esm.sh/mermaid@10"), "mermaid");
    assert.equal(libraryOf("https://esm.sh/v135/three@0.160.0/es2022/three.mjs"), "three.js");
    assert.equal(libraryOf("https://unpkg.com/@observablehq/plot@0.6"), "@observablehq/plot");
    assert.equal(libraryOf("https://fonts.googleapis.com/css2?family=Inter"), "A font");
    assert.equal(libraryOf("not a url"), "not a url");
    assert.equal(failureWords({ what: "load", url: "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" }), "Chart.js could not load from cdnjs.cloudflare.com");
    assert.equal(failureWords({ what: "blocked", url: "https://evil.example/x.png", directive: "img-src" }), "It tried to reach evil.example, which a visual cannot");
    assert.equal(failureWords({ what: "blocked", url: "eval" }), "It tried to run code the frame does not allow");
    assert.equal(failureWords({ what: "blocked", url: "", directive: "form-action" }), "The frame refused part of it (form-action)");
    assert.equal(failureWords({ what: "error", message: "Uncaught TypeError: x is not a function", line: 3 }), "Its script failed: TypeError: x is not a function (line 3)");
    assert.equal(failureWords({ what: "error", message: "bad", line: 8812, url: "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" }), "Its script failed: bad (in Chart.js)", "never a library's line as the code's");
  });

  test("only the shapes it says are kept, clipped; one failure each; a refused library said once, as the refusal", () => {
    assert.equal(failureOf({ what: "steal" }), null);
    assert.equal(failureOf(null), null);
    assert.deepEqual(failureOf({ what: "error", message: "m".repeat(900), line: -2, extra: 1 }), { what: "error", message: "m".repeat(400) });
    assert.deepEqual(failureOf({ what: "blocked", url: "u", directive: "d".repeat(90) }), { what: "blocked", url: "u", directive: "d".repeat(40) });
    const lib = "https://evil.example/lib.js";
    const shown = failuresShown([{ what: "blocked", url: lib }, { what: "load", url: lib }, { what: "error", message: "x", line: 1 }, { what: "error", message: "x", line: 1 }]);
    assert.deepEqual(shown, [{ what: "blocked", url: lib }, { what: "error", message: "x", line: 1 }]);
    assert.equal(failureLine("flow", []), null);
    assert.deepEqual(failureLine("flow", shown), {
      line: "It tried to reach evil.example, which a visual cannot · and 1 more",
      more: ["It tried to reach evil.example, which a visual cannot", "Its script failed: x (line 1)"],
      tell: "The visual flow shows errors: It tried to reach evil.example, which a visual cannot; Its script failed: x (line 1).",
    });
    assert.equal(failureLine("flow", [{ what: "load", url: "https://esm.sh/mermaid@10" }])?.tell, "The visual flow shows an error: mermaid could not load from esm.sh.");
  });

  test("a link opens only as http or https, whole; a height is held to HEIGHT_MAX", () => {
    assert.equal(linkOf("https://example.com/a?b=1#c"), "https://example.com/a?b=1#c");
    assert.equal(linkOf("http://example.com"), "http://example.com/");
    for (const bad of ["javascript:alert(1)", "file:///C:/x", "data:text/html,x", "/relative", "", null, 42]) assert.equal(linkOf(bad), null, String(bad));
    assert.deepEqual([frameHeight(320.2), frameHeight(-5), frameHeight("x"), frameHeight(HEIGHT_MAX + 1)], [321, 0, 0, HEIGHT_MAX]);
    assert.equal(HEIGHT_MAX, 12000);
  });
});

describe("the drawing while its call streams (VS-D11, VC-37)", () => {
  test("what a call says of itself so far: its title once whole, each loading line once whole; a quote inside the code is no key", () => {
    assert.deepEqual(writingOf('{"title": "requ'), { title: "", loading: [] });
    assert.deepEqual(writingOf('{"title": "request_flow", "loading": ["Reading the routes", "Draw'), { title: "request_flow", loading: ["Reading the routes"] });
    assert.deepEqual(writingOf('{"code": "<b title=\\"x\\">", "title": "a\\u0062c"'), { title: "abc", loading: [] }, "an escaped key inside the code is not the title");
    assert.deepEqual(writingWords({ title: "", chars: 0 }), { head: "Drawing a visual…", lines: [], size: "" }, "before its title, the card still says it is drawing");
    assert.deepEqual(writingWords({ title: "flow", loading: ["a", ""], chars: 999 }), { head: "Drawing flow…", lines: ["a"], size: "999 characters written" });
    assert.deepEqual([writingWords({ chars: 1500 }).size, writingWords({ chars: 12345 }).size], ["1.5k characters written", "12k characters written"]);
  });

  test("said as a call opens, when its title or a line is whole, else at most every 250 ms; only show_visual; a retry drops them", () => {
    /** @type {any[]} */
    const said = [];
    let t = 0;
    const w = visualWriting((n) => said.push(n), () => t);
    w.piece({ id: "r1", name: "read", text: '{"path":' });
    w.piece({ id: "v1", name: "show_visual", text: "" });
    w.piece({ id: "v1", name: "show_visual", text: '{"title": "fl' });
    t = 100;
    w.piece({ id: "v1", name: "show_visual", text: 'ow", ' });
    t += WRITING_EVERY_MS - 1;
    w.piece({ id: "v1", name: "show_visual", text: '"code": "<svg' });
    t += 1;
    w.piece({ id: "v1", name: "show_visual", text: " viewBox" });
    w.drop();
    w.drop();
    assert.deepEqual(said, [
      { id: "v1", title: "", loading: [], chars: 0 },
      { id: "v1", title: "flow", loading: [], chars: 18 },
      { id: "v1", title: "flow", loading: [], chars: 39 },
      { id: "v1", gone: true },
    ]);
  });

  // HarnessV3-TaskGraph-v2 TG2-D62. (fails before: yes — drop took no id, so a cut call dropped every visual being written)
  test("a reply cut while writing one visual drops that one alone; the others stay", () => {
    /** @type {any[]} */
    const said = [];
    const w = visualWriting((n) => said.push(n), () => 0);
    w.piece({ id: "v1", name: "show_visual", text: '{"title": "a", "code": "<svg/>"}' });
    w.piece({ id: "v2", name: "show_visual", text: '{"title": "b' });
    said.length = 0;
    w.drop("v2");
    w.drop("v2");
    assert.deepEqual(said, [{ id: "v2", gone: true }], "said once, for the cut one");
    w.drop();
    assert.deepEqual(said.at(-1), { id: "v1", gone: true }, "the other was still being written");
  });
});

describe("a run's visuals, aligned (labels.js)", () => {
  // (fails before: yes — the run's "visual" and "visual-writing" events fell through the alignment)
  test("drawn in its round, once each; one being written until it is drawn, refused, dropped, or its round and run end", () => {
    const al = alignEvents([
      { type: "round-start", round: 1 },
      { type: "visual-writing", round: 1, id: "v1", title: "", loading: [], chars: 0 },
      { type: "visual-writing", round: 1, id: "v1", title: "flow", loading: ["Reading"], chars: 30 },
      { type: "tool-start", round: 1, id: "v1", name: "show_visual", args: "flow" },
      { type: "visual", round: 1, id: "v1", title: "flow", bytes: 900, turn: 4 },
      { type: "visual", round: 1, id: "v1", title: "flow", bytes: 900, turn: 4 },
      { type: "visual-writing", round: 1, id: "v1", title: "flow", loading: [], chars: 31 },
      { type: "tool-end", round: 1, id: "v1", ok: true },
      { type: "visual-writing", round: 1, id: "v2", title: "bad", loading: [], chars: 9 },
      { type: "tool-start", round: 1, id: "v2", name: "show_visual", args: "bad" },
      { type: "tool-end", round: 1, id: "v2", ok: false, preview: "Error: send the fragment" },
      { type: "visual-writing", round: 1, id: "v3", title: "", loading: [], chars: 2 },
      { type: "visual-writing", round: 1, id: "v3", gone: true },
      { type: "visual-writing", round: 1, id: "v4", title: "late", loading: [], chars: 5 },
    ]);
    const c1 = al.byRound.get(1);
    assert.deepEqual(c1.visuals, [{ id: "v1", title: "flow", bytes: 900, turn: 4 }], "once, with the turn it is kept on");
    assert.deepEqual([...c1.writing.keys()], ["v4"], "v1 drawn, v2 refused (VC-50), v3 dropped by a retry");
    assert.ok(roundDrew(c1));
    const next = alignEvents([{ type: "round-start", round: 1 }, { type: "visual-writing", round: 1, id: "v4", title: "late", loading: [], chars: 5 }, { type: "round-start", round: 2 }, { type: "visual-writing", round: 2, id: "v5", title: "", loading: [], chars: 1 }]);
    assert.deepEqual([next.byRound.get(1).writing.size, next.byRound.get(2).writing.size], [0, 1], "a new round: every call before it has run or been refused");
    const ended = alignEvents([{ type: "round-start", round: 1 }, { type: "visual-writing", round: 1, id: "v5", title: "", loading: [], chars: 1 }, { type: "run-end", status: "error" }]);
    assert.equal(ended.byRound.get(1).writing.size, 0, "a run that ended writes nothing more");
    assert.ok(!roundDrew(ended.byRound.get(1)) && !roundDrew(null));
  });

  test("a round that drew ends its box, so its visual stands right after its own calls (VC-48)", () => {
    const cellOf = (/** @type {number} */ r, more = {}) => ({ round: r, tools: new Map(), order: [`t${r}`], plan: null, hooks: [], marks: [], reports: [], compactions: [], detaches: [], steers: [], snapshots: [], vetoed: 0, visuals: [], writing: new Map(), blocksBefore: 1, ...more });
    const text = { kind: "block", block: { type: "text" } };
    const plain = new Map([[1, cellOf(1)], [2, cellOf(2)], [3, cellOf(3)]]);
    assert.deepEqual(cardBoxes([text], plain, [1, 2, 3], false), [[1, 2, 3]]);
    const drew = new Map([[1, cellOf(1)], [2, cellOf(2, { visuals: [{ id: "v", title: "t", bytes: 1 }] })], [3, cellOf(3)]]);
    assert.deepEqual(cardBoxes([text], drew, [1, 2, 3], false), [[1, 2], [3]]);
    const writing = new Map([[1, cellOf(1, { writing: new Map([["v", {}]]) })], [2, cellOf(2)]]);
    assert.deepEqual(cardBoxes([text], writing, [1, 2], true), [[1], [2]], "one still being written too");
  });

  describe("drawn in the work", () => {
    /** @type {ReturnType<typeof stubDocument>} */
    let doc;
    before(() => {
      doc = stubDocument();
    });
    after(() => doc.restore());
    const parts = (/** @type {any} */ row) => ["tool-kind", "tool-primary", "tool-secondary"].map((c) => row.querySelector(`.${c}`)?.textContent ?? null);

    test("one line each: Drawing, Drew or Not drawn with the title, the refusal's words on its line; the guide's", () => {
      const rowsOf = (/** @type {any[]} */ evs) => roundRows(alignEvents([{ type: "round-start", round: 1 }, ...evs]).byRound.get(1));
      // The loop's tool-start carries its card, as `loop.js` emits it.
      const start = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool-start", round: 1, id, name, args: "", card: cardOf(name, input) });
      const [drawing] = rowsOf([start("v1", "show_visual", { title: "flow" })]);
      assert.deepEqual(parts(drawing).slice(0, 2), ["Drawing", "flow"]);
      const [drew] = rowsOf([start("v1", "show_visual", { title: "flow" }), { type: "tool-end", round: 1, id: "v1", ok: true, preview: "Shown to the developer" }]);
      assert.deepEqual(parts(drew).slice(0, 2), ["Drew", "flow"]);
      const [refused] = rowsOf([start("v1", "show_visual", { title: "Flow" }), { type: "tool-end", round: 1, id: "v1", ok: false, preview: "Error: send the fragment, not a whole page" }]);
      assert.equal(parts(refused)[0], "Not drawn");
      assert.match(String(parts(refused)[2]), /send the fragment/, "VC-50: its line says why");
      const [guide] = rowsOf([start("g1", "visual_guide", { kinds: ["diagram"] }), { type: "tool-end", round: 1, id: "g1", ok: true }]);
      assert.deepEqual(parts(guide).slice(0, 2), ["Read the visual guide", "diagram"]);
    });
  });
});

describe("where a visual stands in its turn (VC-41, VC-42)", () => {
  const seg = (/** @type {string} */ name, kind = "block") => (kind === "block" ? { kind, name, block: { type: name.startsWith("think") ? "thinking" : "text", text: name } } : { kind, name });
  const cards = seg("cards", "cards");
  const cards2 = seg("cards2", "cards");
  const pic = seg("pic", "visual");
  const pic2 = seg("pic2", "visual");
  const files = seg("files", "files");
  const words = seg("words");
  const answer = seg("answer");
  const names = (/** @type {any} */ split) => Object.fromEntries(Object.entries(split).map(([k, v]) => [k, Array.isArray(v) ? v.map((s) => s.name) : v?.name ?? null]));

  test("it never folds, live or settled: one drawn before the answer stands between the work and it; one drawn after stays after it", () => {
    for (const live of [true, false]) {
      assert.deepEqual(names(foldSplit([cards, pic, answer, pic2, files], { live })), live
        ? { lastText: "answer", lead: [], pictures: ["pic"], fold: ["cards"], after: ["pic2", "files"], closing: null }
        : { lastText: "answer", lead: [], pictures: ["pic"], fold: ["cards"], after: ["pic2", "files"], closing: null }, live ? "live" : "settled");
      assert.deepEqual(names(foldSplit([cards, pic, cards2], { live })).pictures, ["pic"], "more work after it folds above it; it does not move");
      assert.deepEqual(names(foldSplit([words, pic, answer], { live })), { lastText: "answer", lead: ["words"], pictures: ["pic"], fold: [], after: [], closing: null }, "words alone stand above it, in the order said");
    }
    const live = names(foldSplit([words, pic], { live: true }));
    assert.deepEqual([live.lastText, live.after], ["words", ["pic"]], "live, drawn after the newest words: under them");
    for (const segs of [[pic, cards, pic2], [cards, pic, words, cards2, pic2, answer], [think(), pic, think()]])
      for (const live of [true, false]) assert.ok(!foldSplit(segs, { live }).fold.some((s) => s.kind === "visual"), "never in the fold");
  });
  function think() {
    return seg("think");
  }

  test("the timeline lays it out by these rules: its round's visuals right after its box, its card made once (pinned in the page's source)", () => {
    const tl = read("src/ui/harness/conversation/timeline.js");
    assert.match(tl, /const pics = rounds\.flatMap\(\(r\) => visualSegments\(turn, v, al\.byRound\.get\(r\)\)\);/);
    assert.match(tl, /while \(turn\.segments\[idx\]\?\.kind === "cards" \|\| turn\.segments\[idx\]\?\.kind === "visual" \|\| turn\.segments\[idx\]\?\.kind === "artifact" \|\| turn\.segments\[idx\]\?\.kind === "compacted"\) idx\+\+;/, "past a box, its pictures and an agent's compaction placed already");
    assert.match(tl, /let pic = v\.pictures\.get\(id\);\s+if \(!pic\) v\.pictures\.set\(id, \(pic = visualCard\(/, "a frame is never made twice");
    assert.match(tl, /const drew = v \? \(turn\.visuals \|\| \[\]\)\.filter\(\(\/\*\* @type \{any\} \*\/ x\) => !x\.by\) : \[\];/, "a reloaded turn's own visuals, a sub-agent's not on it (VC-52)");
  });

  test("a reloaded turn keeps its visuals from the transcript", () => {
    const [turn] = transcriptTurns({ turns: [{ n: 1, user: { role: "user", content: "draw" }, final: { role: "assistant", content: [{ type: "text", text: "Here." }] }, visuals: [{ id: "v1", title: "flow", bytes: 3, round: 1 }] }] });
    assert.deepEqual(/** @type {any} */ (turn).visuals, [{ id: "v1", title: "flow", bytes: 3, round: 1 }]);
  });
});

describe("the card's guards, pinned in its source (VS-D3, VC-25, VC-44, VC-45)", () => {
  const card = read("src/ui/harness/conversation/visual.js");
  test("a frame with scripts and nothing else; heard only by its own window; an ask or a link only right after a click in it", () => {
    assert.match(card, /h\("iframe", \{ class: "visual-frame", sandbox: "allow-scripts", referrerpolicy: "no-referrer"/, "no same-origin, no popups, no forms, no top navigation");
    assert.doesNotMatch(card, /allow-same-origin|allow-popups|allow-top-navigation|allow-forms|allow-modals/);
    assert.match(card, /framesNow\(\)\.find\(\(f\) => f\.contentWindow === e\.source\)/, "a message from another window or frame is no visual's");
    assert.match(read("src/ui/harness/lib/frame-ask.js"), /export const clickedIn = \(frame\) => document\.activeElement === frame && !!\(\/\*\* @type \{any\} \*\/ \(navigator\)\.userActivation\?\.isActive\);/);
    assert.match(card, /if \(!clickedIn\(frame\)\) return;\s+if \(m\.kind === "ask"\) \{/, "before an ask or a link");
    assert.match(card, /linkOf\(/, "only http and https");
  });

  test("an ask is written into the message box, never sent; Tell the agent the same", () => {
    assert.match(read("src/ui/harness/app.js"), /onVisualAsk: \(text\) => composer\.add\(text\),\s+onVisualTell: \(text\) => composer\.add\(text\),/);
    assert.match(read("src/ui/harness/composer/composer.js"), /add\(text\) \{/);
  });
});

describe("the page's rule for frames (VC-43)", () => {
  /** What a served path's headers are: a page's once its files' stamp is read (static.js `uiStamp`). @param {string} path */
  const headersOf = async (path) => {
    /** @type {any} */
    let got = null;
    await serveStatic(/** @type {any} */ ({ writeHead: (/** @type {number} */ s, /** @type {any} */ h) => (got = { status: s, ...h }), end() {}, setHeader() {} }), path, 20300);
    return got;
  };
  // (fails before: yes — HarnessV4_Artifacts_Plan AF-D42: the rule framed no address at all, so no artifact could show)
  test("every page Filament serves frames no address but an artifact's at its port, however its path is spelled; a script or a stylesheet carries no rule", async () => {
    for (const path of ["/ui/harness.html", "/ui//harness.html", "/", "/ui/index.html"]) assert.equal((await headersOf(path))?.["content-security-policy"], "frame-src http://*.art.localhost:20300; frame-ancestors 'self'", path);
    for (const path of ["/ui/harness/app.js", "/ui/harness/aqua.css"]) assert.equal((await headersOf(path))?.["content-security-policy"], undefined, path);
  });
  // (fails before: yes — the bug hunt of 10-30, HTTP-7: a page named no frame-ancestors, so a page of another site could
  // frame the harness and lay its own over Filament's buttons for the person to press)
  test("a page of Filament's is framed by its own pages alone: frame-ancestors 'self', on every page, however its path is spelled", async () => {
    for (const path of ["/", "/ui", "/ui/harness.html", "/ui//harness.html", "/ui/index.html", "/ui/tray-card.html"]) {
      const policy = String((await headersOf(path))?.["content-security-policy"] || "");
      assert.ok(policy.split("; ").includes("frame-ancestors 'self'"), `${path}: ${policy}`);
    }
  });
});

describe("the call's pieces as they stream (internal-call.js onCall)", () => {
  test("each tool call's id, name and JSON so far, as the model writes it; the text still streams; the message is whole", async () => {
    const sse = (/** @type {any} */ o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
    const door = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end([
          sse({ type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: "x", content: [], usage: { input_tokens: 1, output_tokens: 0 } } }),
          sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
          sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Drawing." } }),
          sse({ type: "content_block_stop", index: 0 }),
          sse({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "show_visual", input: {} } }),
          sse({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"title": "fl' } }),
          sse({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'ow", "code": "<svg/>"}' } }),
          sse({ type: "content_block_stop", index: 1 }),
          sse({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } }),
          sse({ type: "message_stop" }),
        ].join(""));
      });
    });
    await new Promise((r) => door.listen(0, "127.0.0.1", () => r(undefined)));
    try {
      const port = /** @type {import("node:net").AddressInfo} */ (door.address()).port;
      const call = createInternalCall({ config: () => ({ server: { port } }), log: () => {} });
      /** @type {any[]} */
      const pieces = [];
      /** @type {string[]} */
      const text = [];
      const r = await call({ body: { model: "x", messages: [] }, onDelta: (d) => text.push(d.text), onCall: (c) => pieces.push(c) });
      assert.equal(r.ok, true);
      assert.deepEqual(pieces, [
        { id: "toolu_1", name: "show_visual", text: "" },
        { id: "toolu_1", name: "show_visual", text: '{"title": "fl' },
        { id: "toolu_1", name: "show_visual", text: 'ow", "code": "<svg/>"}' },
      ]);
      assert.deepEqual(text, ["Drawing."]);
      assert.deepEqual(r.json.content.at(-1), { type: "tool_use", id: "toolu_1", name: "show_visual", input: { title: "flow", code: "<svg/>" } });
    } finally {
      await new Promise((r) => door.close(() => r(undefined)));
    }
  });
});

describe("the loop says a visual while its model writes it (VS-D11)", () => {
  const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
  const answer = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null, upstream: "u", retryAfter: null });
  const SVG = '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>';
  /** @param {(o: any, n: number) => Promise<any>} call */
  const run = (call) => {
    /** @type {any[]} */
    const events = [];
    let n = 0;
    const out = runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m", messages: [{ role: "user", content: "draw the flow" }], system: "s", tools: loopToolArgs({}), modeNow: () => "edit", root: tmpdir(), readerModel: "", maxTokens: 100,
      call: (/** @type {any} */ o) => call(o, n++), costOf: () => 0,
      runHand: async () => {
        throw new Error("no hand runs here");
      },
      delegateRead: null, unattended: false, mailbox: null, permissions: null, tree: null, onEvent: (/** @type {any} */ e) => events.push(e), previewChars: 0, sink, signal: null, resume: null,
      visuals: (/** @type {any} */ v) => ({ ok: true, bytes: Buffer.byteLength(v.code), n: 2 }),
    }));
    return { out, events };
  };

  test("its title and lines as the call streams, in its round; a try that broke drops them, and the next try's call is said anew", async () => {
    const { out, events } = run(async (o, n) => {
      if (n === 0) {
        o.onCall?.({ id: "c1", name: "show_visual", text: "" });
        o.onCall?.({ id: "c1", name: "show_visual", text: '{"title": "flow", ' });
        return { ok: false, status: 502, json: { type: "error", error: { type: "api_error", message: "stream failure: terminated" } }, id: null, upstream: "u", retryAfter: 0, inStream: true };
      }
      if (n === 1) {
        o.onCall?.({ id: "c2", name: "show_visual", text: '{"title": "flow", "loading": ["Laying out"], ' });
        return answer([{ type: "tool_use", id: "c2", name: "show_visual", input: { title: "flow", code: SVG, loading: ["Laying out"] } }]);
      }
      assert.equal(o.onCall !== undefined, true, "every round where show_visual is offered");
      return answer([{ type: "text", text: "Done." }]);
    });
    assert.equal((await out).status, "done");
    const start = events.find((e) => e.type === "round-start");
    const said = events.filter((e) => e.type === "visual-writing").map(({ type, ...e }) => e);
    assert.deepEqual(said, [
      { round: start.round, id: "c1", title: "", loading: [], chars: 0 },
      { round: start.round, id: "c1", title: "flow", loading: [], chars: 18 },
      { round: start.round, id: "c1", gone: true },
      { round: start.round, id: "c2", title: "flow", loading: ["Laying out"], chars: 45 },
    ]);
    const al = alignEvents(events);
    assert.deepEqual(al.byRound.get(start.round).visuals.map((/** @type {any} */ v) => [v.id, v.turn]), [["c2", 2]]);
    assert.equal(al.byRound.get(start.round).writing.size, 0, "drawn: nothing is being written");
  });

  // (fails before: yes — the owner's report of 10-27: the speed gauge stood still while an agent wrote a file; a call's
  // input was read only where show_visual was offered, and never said)
  test("where show_visual is not offered too, the calls a round writes are said as they grow: the speed gauge's count", async () => {
    /** @type {any[]} */
    const asked = [];
    /** @type {any[]} */
    const events = [];
    const body = `{"path":"notes.md","content":"${"x".repeat(300)}"}`;
    const out = runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m", messages: [{ role: "user", content: "hi" }], system: "s", tools: loopToolArgs({ disabled: ["show_visual", "visual_guide"] }), modeNow: () => "edit", root: tmpdir(), readerModel: "", maxTokens: 100,
      call: async (/** @type {any} */ o) => {
        asked.push(typeof o.onCall === "function");
        o.onCall?.({ id: "t1", name: "write", text: "" });
        o.onCall?.({ id: "t1", name: "write", text: body });
        return answer([{ type: "text", text: "Hi." }]);
      },
      costOf: () => 0,
      runHand: async () => {
        throw new Error("no hand runs here");
      },
      delegateRead: null, unattended: false, mailbox: null, permissions: null, tree: null, onEvent: (/** @type {any} */ e) => events.push(e), previewChars: 0, sink, signal: null, resume: null, visuals: null,
    }));
    await out;
    assert.deepEqual(asked, [true]);
    assert.deepEqual(events.filter((e) => e.type === "round-writing").map((e) => [e.round, e.chars]), [[1, body.length]], "its input so far, once it grew");
    assert.ok(!events.some((e) => e.type === "visual-writing"), "no visual is said where none is offered");
  });

  /** One round that writes `pieces` of a call through `call`, its run events kept. @param {(o: any, n: number) => Promise<any>} call */
  const writingTurn = async (call) => {
    /** @type {any[]} */
    const events = [];
    let n = 0;
    await runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m", messages: [{ role: "user", content: "hi" }], system: "s", tools: loopToolArgs({ disabled: ["show_visual", "visual_guide"] }), modeNow: () => "edit", root: tmpdir(), readerModel: "", maxTokens: 100,
      call: (/** @type {any} */ o) => call(o, n++),
      costOf: () => 0,
      runHand: async () => {
        throw new Error("no hand runs here");
      },
      delegateRead: null, unattended: false, mailbox: null, permissions: null, tree: null, onEvent: (/** @type {any} */ e) => events.push(e), previewChars: 0, sink, signal: null, resume: null, visuals: null,
    }));
    return events;
  };

  // (fails before: yes — the Hunter's report of 10-27: only the first piece passed the 500 ms gate, so a file written in
  // one burst was said as its first 20 characters until the round's count)
  test("a call's input that comes in one burst is said whole before the round's count", async () => {
    const pieces = ['{"path":"notes.md",', '"content":"', "x".repeat(4000), '"}'];
    const events = await writingTurn(async (o) => {
      for (const p of pieces) o.onCall?.({ id: "t1", name: "write", text: p });
      return answer([{ type: "text", text: "Hi." }]);
    });
    const said = events.filter((e) => e.type === "round-writing").map((e) => e.chars);
    assert.equal(said.at(-1), pieces.join("").length, `the whole input is said: ${said}`);
    const last = events.findLastIndex((e) => e.type === "round-writing");
    const count = events.findIndex((e) => e.type === "round-written");
    assert.ok(count < 0 || last < count, "before the round's count");
  });

  // (fails before: yes — the Hunter's find of 10-27: the window started at 0, so a burst's first piece was always said
  // at once, its first characters flashing before the whole)
  test("a burst's first piece opens the window and is not said alone: the whole comes at the call's end", async () => {
    const events = await writingTurn(async (o) => {
      o.onCall?.({ id: "t1", name: "write", text: "" });
      o.onCall?.({ id: "t1", name: "write", text: '{"path":"a.md","c":"' });
      o.onCall?.({ id: "t1", name: "write", text: `${"x".repeat(4000)}"}` });
      return answer([{ type: "text", text: "Hi." }]);
    });
    assert.deepEqual(events.filter((e) => e.type === "round-writing").map((e) => e.chars), [4022], "said once, whole");
  });

  // (fails before: yes — a retried round counted its calls from 0 again, and the gauge, which takes no total that went
  // down, stood still until the new try outgrew the broken one)
  test("a round asked again after its stream broke adds to its count: it never goes down", async () => {
    const events = await writingTurn(async (o, n) => {
      if (n === 0) {
        o.onCall?.({ id: "t1", name: "write", text: "y".repeat(3000) });
        return { ok: false, status: 502, json: { type: "error", error: { type: "api_error", message: "stream failure: terminated" } }, id: null, upstream: "u", retryAfter: 0, inStream: true };
      }
      o.onCall?.({ id: "t2", name: "write", text: "z".repeat(500) });
      return answer([{ type: "text", text: "Hi." }]);
    });
    const said = events.filter((e) => e.type === "round-writing").map((e) => e.chars);
    assert.ok(said.length >= 2, `both tries are said: ${said}`);
    for (let i = 1; i < said.length; i++) assert.ok(said[i] >= said[i - 1], `the count never goes down: ${said}`);
    assert.equal(said.at(-1), 3500);
  });
});

describe("a coding agent's card for Filament's tools (step 1's known items)", () => {
  // (fails before: yes — the bridge took the opening backtick of Claude's title off and kept the closing one: the guide
  // read `visual_guide``, and `Read`` was no Read, its kind left "other")
  test("Claude's title in backticks reads as the tool, both backticks gone", () => {
    /** @type {any[]} */
    const events = [];
    const reader = createUpdateReader({ out: { tools: [] }, conv: {}, turn: { bridgePlan: () => null }, onEvent: (/** @type {any} */ e) => events.push(e), notes: [] });
    reader({ sessionUpdate: "tool_call", toolCallId: "g1", title: "`mcp__filament__visual_guide`", kind: "other", status: "pending", rawInput: { kinds: ["chart"] } });
    reader({ sessionUpdate: "tool_call", toolCallId: "r1", title: "`mcp__filament__Read`", kind: "other", status: "pending", rawInput: { file_path: "README.md" } });
    const [guide, file] = events.filter((e) => e.type === "tool");
    assert.deepEqual([guide.title, guide.routed], ["visual_guide", true]);
    assert.deepEqual([file.title, file.kind], ["Read README.md", "read"]);
  });

  // (fails before: yes — Cursor's call of one of Filament's tools said no tool name: its card read "show_visual" as any
  // call's, and the tool found no call of the agent's, so the visual took an id of Filament's and no round)
  test("Cursor's call of show_visual is named as Claude's is: its card draws, and the tool finds the call by its name", async () => {
    const bridge = new CursorSdkBridge(/** @type {any} */ ({ log: () => {}, loader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) }));
    /** @type {any[]} */
    const published = [];
    const run = createAgentRun({ publish: (e) => published.push(e), sink: /** @type {any} */ ({ breakBlock: () => 0 }), root: tmpdir() });
    /** @type {any[]} */
    const answered = [];
    bridge.agentTools = /** @type {any} */ ({
      has: (/** @type {string} */ n) => n === "show_visual",
      list: () => [{ name: "show_visual", description: "Draw.", inputSchema: { type: "object" } }],
      memoryOn: () => false,
      call: async (/** @type {string} */ name, /** @type {any} */ args, /** @type {any} */ ctx) => {
        const own = await ctx.callOf?.(name);
        answered.push({ name, title: args.title, own });
        return { text: `kept as ${own?.id ?? "none"}` };
      },
    });
    const upstream = { id: "cur-vis", name: "cur-vis", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: tmpdir(), permissions: "allow-all" } };
    const body = { model: "m", max_tokens: 100, messages: [{ role: "user", content: "~visual" }] };
    try {
      const out = await bridge.run({ upstream, modelId: "grok-4.6", format: "anthropic", body, conversationId: "vis", toolsAt: { visuals: true, callOf: (/** @type {string} */ n) => run.callFor(n) }, onEvent: (/** @type {any} */ e) => run.take(e) });
      assert.match(out.text, /visual:kept as sv1/);
      const start = published.find((e) => e.type === "tool-start");
      assert.deepEqual([start.id, start.name, start.card], ["sv1", "show_visual", cardOf("show_visual", { title: "flow", code: '<svg viewBox="0 0 10 10"></svg>' })]);
      assert.deepEqual(answered, [{ name: "show_visual", title: "flow", own: { id: "sv1", round: start.round } }]);
    } finally {
      bridge.shutdown();
    }
  });
});
