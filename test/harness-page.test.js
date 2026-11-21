// @ts-check
// The harness's pure helpers (WP-B): the SSE parser and the Anthropic accumulator, the streaming markdown
// (block-splitting, escaping, the closed-block cache), the tool label grammar, the follow-scroll rule and the
// run-event aligner; the rich diff and the Changes pane's painter, on a stub document (helpers/dom-stub.js). No
// network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createSseParser, createAnthropicAccumulator } from "../src/ui/harness/lib/stream.js";
import { splitBlocks, renderBlock, mdChat, inline, paintCode, showImage } from "../src/ui/harness/lib/md-stream.js";
import { langOf } from "../src/ui/harness/lib/highlighter.js";
import { toolLabel, shouldFollow, alignEvents, stopReasonText, sessionAge, rowMoment, lastThinkingLine, formatWorkedFor, websiteCardsFrom, fileChangePaths, timelineBucket, greetingAt, workedToday, roundCardAnchor, foldSplit } from "../src/ui/harness/lib/labels.js";
import { h, placeChildren } from "../src/ui/lib/dom.js";
import { parseRoute, routeFor, onScreen, newChatFolder } from "../src/ui/harness/lib/router.js";
import { matchShortcut, comboFromEvent } from "../src/ui/harness/shortcuts.js";
import { groupRuns, familyOf } from "../src/ui/harness/conversation/tools/render.js";
import { stationsFrom } from "../src/ui/harness/panes/run.js";
import { statusLetter, attemptsOf, heldSeries, forecastNext, promptTagOf, isMainRecord, ageOf, crumbsOf } from "../src/ui/harness/panes/pane-data.js";
import { richPainter } from "../src/ui/harness/lib/diff-render.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

test("the SSE parser: whole events across chunk boundaries, multi-line data, ids, comments, the tail", () => {
  const p = createSseParser();
  assert.deepEqual(p.feed('data: {"a":1}\n\nid: 7\ndata: {"b":'), [
    { data: '{"a":1}', id: null },
  ]);
  assert.deepEqual(p.feed('2}\n\n: ping\n\ndata: one\ndata: two\n'), [{ data: '{"b":2}', id: "7" }]);
  assert.deepEqual(p.feed("\n"), [{ data: "one\ntwo", id: null }]);
  assert.deepEqual(p.feed("data: [DONE]"), []);
  assert.deepEqual(p.end(), [{ data: "[DONE]", id: null }]);
});

test("the accumulator: blocks in order, thinking separate, usage grows, the stop reason and the error land", () => {
  const acc = createAnthropicAccumulator();
  acc.push({ type: "message_start", message: { usage: { input_tokens: 42 } } });
  acc.push({ type: "content_block_start", content_block: { type: "thinking", thinking: "" } });
  acc.push({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "let me " } });
  acc.push({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "think" } });
  acc.push({ type: "content_block_start", content_block: { type: "text", text: "Hi" } });
  acc.push({ type: "content_block_delta", delta: { type: "text_delta", text: " there" } });
  acc.push({ type: "content_block_delta", delta: { type: "text_delta", text: "!" } });
  acc.push({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } });
  assert.deepEqual(acc.reply.blocks, [
    { type: "thinking", text: "let me think" },
    { type: "text", text: "Hi there!" },
  ]);
  assert.deepEqual(acc.reply.usage, { input_tokens: 42, output_tokens: 9 });
  assert.equal(acc.reply.stopReason, "end_turn");
  const err = createAnthropicAccumulator();
  err.push({ type: "error", error: { message: "overloaded" } });
  assert.equal(err.reply.error, "overloaded");
});

test("md-stream: blocks split on blank lines, a fence swallows its lines, the tail is open until closed", () => {
  const b = splitBlocks("first para\nline two\n\n```js\nconst x = 1;\n```\n\n- one\n- two");
  assert.deepEqual(b.map((x) => x.kind), ["paragraph", "fence", "list"]);
  assert.equal(b[0].closed, true);
  assert.equal(b[1].closed, true);
  assert.equal(b[2].closed, false, "the last block is open while the stream may append (no trailing newline)");
  const open = splitBlocks("text\n\n```py\nprint(1)\nprint(2)");
  const last = open[open.length - 1];
  assert.equal(last.kind, "fence");
  assert.equal(last.closed, false, "an unclosed fence is the open tail");
  assert.equal(open[0].kind, "paragraph");
});

test("md-stream: escape first, format second — markup in the source is text, never HTML", () => {
  const html = renderBlock({ kind: "paragraph", text: 'a <script>alert(1)</script> and **bold** and `x<y` and [click](javascript:alert(1)) and [ok](https://x.y)', closed: true });
  assert.ok(!html.includes("<script>"), html);
  assert.ok(html.includes("&lt;script&gt;"), html);
  assert.ok(html.includes("<b>bold</b>"));
  assert.ok(html.includes("<code>x&lt;y</code>"));
  assert.ok(!html.includes("javascript:"), "a javascript: link is rendered as plain text");
  assert.ok(html.includes('<a href="https://x.y" target="_blank" rel="noopener">ok</a>'));
  const fence = renderBlock({ kind: "fence", text: "```js\n<img src=x onerror=alert(1)>\n```", closed: true });
  assert.ok(fence.includes("&lt;img"), fence);
  assert.ok(!fence.includes("<img"));
  assert.ok(fence.includes('class="code-block"'));
  assert.ok(fence.includes('class="code-lang">js</span>'));
  assert.ok(fence.includes("code-wrap") && fence.includes("code-copy"));
  assert.ok(!fence.includes("tok-"), "no highlighter until the owner names one");
  assert.equal(inline("**<b>**"), "<b>&lt;b&gt;</b>");
});

// (fails before: yes — fable51's F5, HarnessV4_Tasks U4: `![alt](https://…)` in a reply became an <img> the browser
// fetched from any host as it was drawn: a request nobody clicked, carrying whatever the address held)
test("md-stream: an image from another host waits behind a chip that names the host; Filament's own is its words alone", () => {
  const remote = inline("see ![a chart](https://evil.example/p.png?d=secret&x=1) here");
  assert.ok(!remote.includes("<img"), remote);
  assert.equal(
    remote,
    'see <span class="md-img-held"><button type="button" class="md-img-load" data-src="https://evil.example/p.png?d=secret&amp;x=1" data-alt="a chart" title="Load this image from evil.example">Show image</button><span class="md-img-from">a chart · evil.example</span></span> here',
  );
  // An address with no scheme of its own is another host's all the same.
  const bare = inline("![x](//evil.example/p.png)");
  assert.ok(!bare.includes("<img"), bare);
  assert.match(bare, /data-src="\/\/evil\.example\/p\.png" data-alt="x" title="Load this image from evil\.example"/);
  // The host is the one the request would reach, whatever is written before an @; no alt, no words made up.
  assert.match(inline("![](http://trusted.example@h.example:8080/a.png)"), /title="Load this image from h\.example:8080">Show image<\/button><span class="md-img-from">h\.example:8080<\/span>/);
  // Filament's own (a path on this origin) is its words: nothing a reply shows comes from there.
  assert.equal(inline("![shot](/api/files/view?path=a.png)"), "shot");
  // Any other kind of address stays its alt text, as before.
  assert.equal(inline("![x](data:image/png;base64,AAAA)"), "x");
  // Asked for, that address is drawn at once from then on: a redraw does not hide it again.
  showImage("https://evil.example/p.png?d=secret&x=1");
  assert.equal(inline("![a chart](https://evil.example/p.png?d=secret&x=1)"), '<span class="md-img"><img src="https://evil.example/p.png?d=secret&amp;x=1" alt="a chart" loading="lazy"></span>');
  assert.ok(!inline("![b](https://evil.example/other.png)").includes("<img"), "that address alone");
  showImage("javascript:alert(1)");
  showImage("/api/x.png");
  assert.ok(!inline("![b](https://evil.example/third.png)").includes("<img"), "only another host's address is ever asked for");
  // The chip's look, in a reply and in a skill's file the Library draws (lib/md.js `imageHtml`).
  const css = readFileSync("src/ui/harness.css", "utf8");
  assert.match(css, /:is\(\.a-md, \.skl-md\) \.md-img-held \{/);
  assert.match(css, /:is\(\.a-md, \.skl-md\) \.md-img-load \{/);
});

// (fails before: yes — the bug hunt of 10-30, UIC-6: `/\host`, which a browser reads as `//host`, passed for a path of
// Filament's own, so an image from another host was fetched as it was drawn, unasked)
test("md-stream: a path whose slash a backslash follows is another host's: its image waits behind the chip, and the chip loads it", () => {
  const sly = inline("![x](/\\evil.example/p.png?d=secret)");
  assert.ok(!sly.includes("<img"), sly);
  assert.match(sly, /data-src="\/\\evil\.example\/p\.png\?d=secret" data-alt="x" title="Load this image from evil\.example"/);
  assert.equal(inline("![shot](/api/files/view?path=a.png)"), "shot", "a path of Filament's own is its words");
  showImage("/\\evil.example/asked.png");
  assert.equal(inline("![y](/\\evil.example/asked.png)"), '<span class="md-img"><img src="/\\evil.example/asked.png" alt="y" loading="lazy"></span>', "asked for, it is drawn from then on");
  // A link to either is a link to another host as an https link is: its own tab, no opener.
  assert.equal(inline("[docs](//evil.example/docs)"), '<a href="//evil.example/docs" target="_blank" rel="noopener">docs</a>');
});

// (fails before: yes — the production-readiness bug hunt of 10-30, reply images and ADM-3: a path of Filament's own was
// drawn as an image, so a reply's `![](/api/upstreams/u/test)` had the page ask Filament's API as the person — its own
// origin, which the guard on other sites' requests lets by — and this page's origin written whole waited behind a chip
// whose button asked it all the same)
test("md-stream: an image on Filament's own address is its words, never asked for — a path, or this page's origin written whole", () => {
  const was = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { value: { origin: "http://127.0.0.1:20300" }, configurable: true });
  try {
    for (const src of ["/api/upstreams/u/test", "/api/models?refresh=1", "http://127.0.0.1:20300/api/sdk/status?load=1", "//127.0.0.1:20300/api/x", "/\\127.0.0.1:20300/api/x"])
      assert.equal(inline(`see ![the chart](${src}) here`), "see the chart here", src);
    showImage("http://127.0.0.1:20300/api/x.png");
    assert.equal(inline("![y](http://127.0.0.1:20300/api/x.png)"), "y", "never kept as asked for");
    assert.match(inline("![z](http://localhost:20300/a.png)"), /title="Load this image from localhost:20300">Show image</, "another origin is another host's, behind its chip");
  } finally {
    if (was) Object.defineProperty(globalThis, "location", was);
    else Reflect.deleteProperty(globalThis, "location");
  }
});

// (fails before: yes — the production-readiness bug hunt of 10-30: a reply's link to Filament's own API was a link, so the
// person's click had the page ask it as them — its own origin, which the guard on other sites' requests lets by)
test("md-stream: a reply's link to Filament's own API is its words; Filament's pages and other sites stay links", () => {
  const was = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { value: { origin: "http://127.0.0.1:20300" }, configurable: true });
  try {
    for (const src of ["/api/upstreams/u/test", "/api/models?refresh=1", "/api", "/./api/keys", "http://127.0.0.1:20300/api/keys", "//127.0.0.1:20300/api/x"])
      assert.equal(inline(`see [this](${src}) now`), "see this now", src);
    assert.equal(inline("see http://127.0.0.1:20300/api/keys now"), "see http://127.0.0.1:20300/api/keys now", "a bare address of its API is its words too");
    assert.equal(inline("[open it](#/task/abc)"), '<a href="#/task/abc" target="_blank" rel="noopener">open it</a>');
    assert.equal(inline("[the harness](/ui/harness.html)"), '<a href="/ui/harness.html" target="_blank" rel="noopener">the harness</a>');
    assert.equal(inline("[its API](https://example.com/api/x)"), '<a href="https://example.com/api/x" target="_blank" rel="noopener">its API</a>', "another site's /api is that site's");
    assert.equal(inline("see http://127.0.0.1:20300/ui/harness.html"), 'see <a href="http://127.0.0.1:20300/ui/harness.html" target="_blank" rel="noopener">http://127.0.0.1:20300/ui/harness.html</a>');
  } finally {
    if (was) Object.defineProperty(globalThis, "location", was);
    else Reflect.deleteProperty(globalThis, "location");
  }
});

// (fails before: yes — the bug hunt of 10-30, a Low: any line starting with the fence's mark closed it, so a reply that
// showed a fence inside a longer one — markdown taught — split its block in two at the inner ```js)
test("md-stream: a fence closes on its own run alone, as long or longer and nothing after it; its words read past a longer run", () => {
  const taught = splitBlocks("Write it so:\n\n````markdown\n```js\nconst x = 1;\n```\n````\n\nDone.");
  assert.deepEqual(taught.map((b) => [b.kind, b.closed]), [["paragraph", true], ["fence", true], ["paragraph", false]]);
  assert.equal(taught[1].text, "````markdown\n```js\nconst x = 1;\n```\n````");
  const html = renderBlock(taught[1]);
  assert.ok(html.includes('class="code-lang">markdown</span>'), html);
  assert.ok(html.includes("```js\nconst x = 1;\n```</code>"), "the inner fence is the code's own text");
  assert.deepEqual(splitBlocks("```\nsee ```js below\n```js\nstill code\n```").map((b) => [b.kind, b.closed]), [["fence", true]], "a run with words after it does not close it");
  assert.deepEqual(splitBlocks("~~~\na ``` inside\n~~~~\nafter").map((b) => b.kind), ["fence", "paragraph"], "the same character, as long or longer");
  assert.deepEqual(splitBlocks("```py\nprint(1)\n```   \nafter").map((b) => b.kind), ["fence", "paragraph"], "spaces after the run are no words");
});

test("md-stream: the cache reuses closed blocks; only the open tail re-renders", () => {
  const one = mdChat("# title\n\npara one\n\n```\ncode\n```\n\nopen", null);
  const two = mdChat("# title\n\npara one\n\n```\ncode\n```\n\nopen and more", one);
  assert.equal(two.html[0], one.html[0], "closed blocks are the same string");
  assert.equal(two.html[1], one.html[1]);
  assert.equal(two.html[2], one.html[2]);
  assert.notEqual(two.html[3], one.html[3], "the open tail re-rendered");
  const three = mdChat("# title\n\npara one\n\n```\ncode\n```\n\nopen and more\n\n```\nnew fence", two);
  assert.equal(three.html[3], two.html[3], "once closed, the tail joins the cache");
  assert.ok(three.out.includes("<h4") || three.out.includes("md-h"), "the heading rendered");
});

test("md-stream: headings, lists, quotes, rules, tables", () => {
  const h4 = renderBlock({ kind: "heading", text: "## A heading", closed: true });
  assert.match(h4, /class="md-h md-h2"/);
  const ul = renderBlock({ kind: "list", text: "- one\n- two", closed: true });
  assert.equal(ul, '<ul class="md-list"><li>one</li><li>two</li></ul>');
  const ol = renderBlock({ kind: "list", text: "1. one\n2. two", closed: true });
  assert.equal(ol, '<ol class="md-list"><li>one</li><li>two</li></ol>');
  const q = renderBlock({ kind: "quote", text: "> quoted\n> more", closed: true });
  assert.equal(q, "<blockquote>quoted<br>more</blockquote>");
  assert.equal(renderBlock({ kind: "rule", text: "---", closed: true }), "<hr>");
  const t = renderBlock({ kind: "table", text: "| a | b |\n|---|---|\n| 1 | 2 |", closed: true });
  assert.ok(t.includes("<th>a</th>") && t.includes("<td>2</td>"));
  const streamed = splitBlocks("And a table:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nDone.");
  assert.equal(streamed.map((x) => x.kind).join(","), "paragraph,table,paragraph");
});

test("paintCode: six classes over already-escaped text, never a raw tag", () => {
  const painted = paintCode("const x = 1; // hi");
  assert.ok(painted.includes('class="tok-keyword">const</span>'), painted);
  assert.ok(painted.includes('class="tok-number">1</span>'), painted);
  assert.ok(painted.includes('class="tok-comment">// hi</span>'), painted);
  const tagged = paintCode("&lt;div&gt;ok&lt;/div&gt;");
  assert.ok(tagged.includes("tok-tag"));
  assert.ok(!tagged.includes("<div>"));
  const str = paintCode("&quot;hi&quot;");
  assert.ok(str.includes("tok-string"), str);
  const fn = paintCode("foo(");
  assert.ok(fn.includes("tok-function"), fn);
  assert.ok(!paintCode("myconst").includes("tok-keyword"));
});

test("md-stream: a fence is open until its closing line, and shiki only ever paints closed ones", () => {
  const open = mdChat("```js\nconst x = 1;", null).out;
  assert.ok(open.includes("data-open"), open); // the stream can still append — no highlight, no cache
  const closed = mdChat("```js\nconst x = 1;\n```", null).out;
  assert.ok(!closed.includes("data-open"), closed);
  assert.ok(closed.includes('data-lang="js"'), closed); // paintFences' handle: .code-block[data-lang]:not([data-open])
});

test("md-stream: a closed mermaid fence is a diagram placeholder with its source kept; an open one is just code", () => {
  const done = mdChat("```mermaid\ngraph TD; A-->B\n```", null).out;
  assert.ok(done.includes('class="mermaid-block"'), done);
  assert.ok(done.includes(`data-src="${encodeURIComponent("graph TD; A-->B")}"`), done); // lib/diagrams.js decodes it back
  assert.ok(done.includes('data-lang="mermaid"'), done); // the source stays visible until (and unless) the diagram renders
  const streaming = mdChat("```mermaid\ngraph TD; A--", null).out;
  assert.ok(!streaming.includes("mermaid-block"), streaming);
});

// (fails before: yes — under the system's reduce-motion setting every element had a 0.01 ms transition on every
// property, so a style mermaid set read back as its old value as it measured: in a browser, a three-box ```mermaid
// diagram laid out 4,287 px wide, its boxes specks; 445 px with the setting off. E16 step 2's look found it)
test("reduce motion stops every transition outright, so the chat's mermaid measures what it set", () => {
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const gate = /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{([^}]*)\}/.exec(css)?.[1] || "";
  assert.match(gate, /transition: none !important/);
  assert.match(gate, /animation-duration: 0\.01ms !important/, "an animation still ends, so a wait for its end is answered");
  assert.doesNotMatch(css, /transition-duration:\s*0\.01ms/, "no element is given a transition it did not have");
});

test("md-stream: GFM task lists get checkbox glyphs, the marker text stripped", () => {
  const out = mdChat("- [ ] write the tests\n- [x] pass them\n- plain item", null).out;
  assert.equal((out.match(/md-task/g) || []).length, 2, out);
  assert.equal((out.match(/task-box on/g) || []).length, 1, out); // only the done one
  assert.ok(!out.includes("[ ]") && !out.includes("[x]"), out);
  assert.ok(out.includes("<li>plain item</li>"), out); // a non-task item stays a plain bullet
});

test("md-stream: math renders through katex when present, stays text when absent, never breaks on currency", () => {
  const src = "Inline $x^2$ here, $$y=1$$ there, and $5 vs $10 of prose.";
  const plain = mdChat(src, null).out; // Node has no katex — the honest fallback
  assert.ok(plain.includes("$x^2$") && plain.includes("$5 vs $10"), plain);
  const prev = globalThis.katex;
  globalThis.katex = { renderToString: (tex, o) => `<math data-display="${o.displayMode ? 1 : 0}">${tex}</math>` };
  try {
    const rich = mdChat(src, null).out;
    assert.ok(rich.includes('<math data-display="0">x^2</math>'), rich);
    assert.ok(rich.includes("$5 vs $10"), rich); // no math-ish character — untouched
    const block = mdChat("$$\n\\sum_{i=0}^n i\n$$", null).out;
    assert.ok(block.includes('class="md-math"'), block);
    assert.ok(block.includes('<math data-display="1">\\sum_{i=0}^n i</math>'), block);
  } finally {
    if (prev === undefined) delete globalThis.katex;
    else globalThis.katex = prev;
  }
});

// (fails before: yes — the bug hunt of 10-30, found checking the vendored KaTeX: it writes newlines inside a root sign's
// SVG path, and a paragraph's or a list item's line breaks turned those into <br> too, so an inline \sqrt lost its sign)
test("md-stream: a paragraph's and a list item's line breaks are the text's, never inside the math KaTeX drew", () => {
  const prev = globalThis.katex;
  /** @type {any} */
  const box = {};
  box.self = box;
  vm.runInNewContext(readFileSync(new URL("../src/ui/harness/vendor/katex/katex.min.js", import.meta.url), "utf8"), box);
  globalThis.katex = box.katex;
  try {
    const drawn = box.katex.renderToString("\\sqrt{2}", { displayMode: false, throwOnError: false, output: "html" });
    assert.ok(drawn.includes("\n"), "the vendored KaTeX writes newlines in a root sign's path");
    for (const src of ["A root $\\sqrt{2}$ here\nand the next line", "- a root $\\sqrt{2}$ here\n  and the next line"]) {
      const out = mdChat(src, null).out;
      assert.ok(out.includes(drawn), out);
      assert.equal((out.match(/<br>/g) || []).length, 1, out);
      assert.match(out, /here<br>\s*and the next line/);
    }
  } finally {
    if (prev === undefined) delete globalThis.katex;
    else globalThis.katex = prev;
  }
});

test("highlighter: fence labels map to the vendored grammars, everything else is honestly null", () => {
  assert.equal(langOf("js"), "javascript");
  assert.equal(langOf("TS"), "typescript");
  assert.equal(langOf("c++"), "cpp");
  assert.equal(langOf("ps1"), "powershell");
  assert.equal(langOf("json"), "json");
  assert.equal(langOf("ruby"), null); // not vendored — the fence stays plain, no half-paint
  assert.equal(langOf("mermaid"), null); // diagrams.js owns those
  assert.equal(langOf(""), null);
});

test("the vendored diff renderer: parses a patch and renders word-level lines through our shiki", async () => {
  const [pierre, sh] = await Promise.all([
    import("../src/ui/harness/vendor/pierre/pierre.mjs"),
    import("../src/ui/harness/vendor/shiki/shiki.mjs"),
  ]);
  const hl = await sh.createHighlighterCore({
    themes: Object.values(sh.THEMES),
    langs: Object.values(sh.LANGS),
    engine: sh.createJavaScriptRegexEngine(),
  });
  const patch = [
    "diff --git a/a.ts b/a.ts",
    "index 1111111..2222222 100644",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -1,2 +1,2 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    "",
  ].join("\n");
  const file = pierre.parsePatchFiles(patch)[0].files[0];
  assert.equal(file.type, "change");
  const r = pierre.renderDiffWithHighlighter(file, hl, { theme: "github-dark", renderLineNumbers: false }, /** @type {any} */ ({ collapsedContextThreshold: 4 }));
  const del = r.code.deletionLines.map((l) => pierre.toHtml(l)).join("");
  const add = r.code.additionLines.map((l) => pierre.toHtml(l)).join("");
  assert.ok(del.includes('data-line-type="change-deletion"'), del);
  assert.ok(add.includes('data-line-type="change-addition"'), add);
  assert.ok(add.includes("<span style="), add); // syntax spans, not plain text
  assert.ok(String(r.themeStyles).includes("--diffs-"), String(r.themeStyles).slice(0, 120)); // the wrapper's style attribute
});

// (fails before: yes — a pane too narrow for a diff's two sides still drew them side by side, each a few
// characters wide; the rich diff had no unified drawing)
test("a rich diff in a column too narrow for two sides reads unified: each line in its place, a context line once", async () => {
  const [pierre, sh, { unifiedLines }] = await Promise.all([
    import("../src/ui/harness/vendor/pierre/pierre.mjs"),
    import("../src/ui/harness/vendor/shiki/shiki.mjs"),
    import("../src/ui/harness/lib/diff-render.js"),
  ]);
  const hl = await sh.createHighlighterCore({
    themes: Object.values(sh.THEMES),
    langs: Object.values(sh.LANGS),
    engine: sh.createJavaScriptRegexEngine(),
  });
  const patch = [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -1,4 +1,4 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    " const c = 4;",
    " const d = 5;",
    "",
  ].join("\n");
  const file = pierre.parsePatchFiles(patch)[0].files[0];
  const r = pierre.renderDiffWithHighlighter(file, hl, { theme: "github-dark", renderLineNumbers: false }, /** @type {any} */ ({ collapsedContextThreshold: 4 }));
  const lines = unifiedLines(r.code.deletionLines, r.code.additionLines) || [];
  const text = (/** @type {any} */ l) => pierre.toHtml(l).replace(/<[^>]+>/g, "").trim();
  assert.deepEqual(
    lines.map((l) => [l.properties["data-line-type"], text(l)]),
    [
      ["context", "const a = 1;"],
      ["change-deletion", "const b = 2;"],
      ["change-addition", "const b = 3;"],
      ["context", "const c = 4;"],
      ["context", "const d = 5;"],
    ],
  );
  assert.equal(unifiedLines([{ properties: {} }], []), null, "a line that names no place: the plain renderer's rows stay");
});

// (fails before: yes — a rich diff was drawn in the page's theme of the moment, its colors inline: after a theme
// switch it kept the old theme's, a white box in the dark)
test("a rich diff is drawn in both themes at once, and the page's color-scheme picks one", async () => {
  const [pierre, sh, { DIFF_THEMES, richDiff }] = await Promise.all([
    import("../src/ui/harness/vendor/pierre/pierre.mjs"),
    import("../src/ui/harness/vendor/shiki/shiki.mjs"),
    import("../src/ui/harness/lib/diff-render.js"),
  ]);
  const hl = await sh.createHighlighterCore({
    themes: Object.values(sh.THEMES),
    langs: Object.values(sh.LANGS),
    engine: sh.createJavaScriptRegexEngine(),
  });
  const patch = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,2 +1,2 @@", " const a = 1;", "-const b = 2;", "+const b = 3;", ""].join("\n");
  const file = pierre.parsePatchFiles(patch)[0].files[0];
  const r = pierre.renderDiffWithHighlighter(file, hl, { theme: DIFF_THEMES, renderLineNumbers: false }, /** @type {any} */ ({ collapsedContextThreshold: 4 }));
  const html = [...r.code.deletionLines, ...r.code.additionLines].map((l) => pierre.toHtml(l)).join("");
  const tokens = [...html.matchAll(/<span style="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(tokens.length > 0 && tokens.every((s) => /--diffs-token-light:/.test(s) && /--diffs-token-dark:/.test(s)), html.slice(0, 300));
  assert.match(String(r.themeStyles), /--diffs-light:[^;]+;/);
  assert.match(String(r.themeStyles), /--diffs-dark:[^;]+;/);
  assert.doesNotMatch(String(r.themeStyles), /(^|;)\s*(color|background-color):/, "the wrapper sets no color of its own: the CSS picks");
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  assert.match(css, /\.pierre-diff span \{ color: light-dark\(var\(--diffs-token-light\), var\(--diffs-token-dark\)\); \}/);
  assert.match(css, /html \{ color-scheme: dark; \}\nhtml\.theme-zai-light \{ color-scheme: light; \}/, "the page's theme sets its color-scheme");
  // (fails before: no — a guard the mutation pass asked for: the diff above is drawn with pierre itself, so a page that
  // drew its own in one theme went unseen)
  const doc = stubDocument();
  try {
    const el = await richDiff(patch, { lang: "ts" });
    const drawn = [...String(el?.innerHTML).matchAll(/<span style="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(drawn.length > 0 && drawn.every((s) => /--diffs-token-light:/.test(s) && /--diffs-token-dark:/.test(s)), String(el?.innerHTML).slice(0, 300));
  } finally {
    doc.restore();
  }
});

// (fails before: no — a guard the mutation pass asked for: the pane's painter was never run, so a narrow column
// drawn side by side, and a paint drawn though a newer one overtook it, went unseen)
test("the Changes pane's painter draws a narrow column unified, a wide one side by side, and never a paint a newer one overtook", async () => {
  const doc = stubDocument();
  try {
    const patch = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,2 +1,2 @@", " const a = 1;", "-const b = 2;", "+const b = 3;", ""].join("\n");
    const preview = doc.document.createElement("div");
    doc.document.body.append(preview);
    const paint = richPainter(/** @type {any} */ (preview));
    /** A file's patch box as the pane builds it: the plain diff, which the rich one replaces when it lands. */
    const box = () => {
      const b = h("div", {}, h("div", { class: "diff-view" }, "the plain diff"));
      preview.append(b);
      return b;
    };
    /** The rich diff, once a box holds it. @param {any} b */
    const drawn = (b) => until(() => b.querySelector(".pierre-diff"), "the rich diff to be drawn");
    preview.clientWidth = 500;
    const narrow = box();
    paint(narrow, patch, "a.ts");
    assert.ok((await drawn(narrow)).classList.contains("unified"), "too narrow for two sides: unified");
    preview.clientWidth = 900;
    const wide = box();
    paint(wide, patch, "a.ts");
    assert.ok(!(await drawn(wide)).classList.contains("unified"), "room for two sides: side by side");
    const overtaken = box();
    const newer = box();
    paint(overtaken, patch, "a.ts");
    paint(newer, patch, "a.ts");
    await drawn(newer);
    // Begun first, the overtaken paint landed first: by the time the newer one is drawn, it was dropped.
    assert.deepEqual([!!overtaken.querySelector(".diff-view"), overtaken.querySelector(".pierre-diff")], [true, null]);
  } finally {
    doc.restore();
  }
});

test("the tool label grammar: tense per status, the target clipped, the truth for failures", () => {
  assert.equal(toolLabel("read", { path: "src/x.ts" }, "running"), "Reading src/x.ts");
  assert.equal(toolLabel("read", { path: "src/x.ts" }, "done"), "Read src/x.ts");
  assert.equal(toolLabel("edit", { path: "a.js" }, "failed"), "Edited a.js");
  assert.equal(toolLabel("bash", { command: "npm test -- --watch" }, "done"), "Ran npm test -- --watch");
  assert.equal(toolLabel("bash", { command: "rm -rf /" }, "declined"), "Declined rm -rf /");
  assert.equal(toolLabel("write", { path: "p" }, "vetoed"), "Vetoed p", "a call that never ran is not said to have run");
  assert.equal(toolLabel("plan", {}, "done"), "Todo");
  assert.equal(toolLabel("Read", { file_path: "f" }, "done"), "Read f", "client-shaped names work");
  assert.equal(toolLabel("unknown_tool", { path: "x" }, "done"), "Used x");
  const long = toolLabel("read", { path: "x".repeat(200) }, "done");
  assert.ok(long.length <= 85 && long.endsWith("…"), `the target clips: ${long.length}`);
});

test("the follow rule: the 40px re-arm band, never a yank from mid-transcript", () => {
  assert.equal(shouldFollow(0, false), true, "at the bottom: follow again");
  assert.equal(shouldFollow(30, true), true, "inside the band, still following");
  assert.equal(shouldFollow(30, false), true, "back inside the band: following re-arms (§5.3.2)");
  assert.equal(shouldFollow(400, true), false, "far from the bottom: free");
  assert.equal(shouldFollow(400, false), false);
});

test("the aligner: tool calls paired by id, states by the end event, steers tracked, plan latest, cards by round", () => {
  const al = alignEvents([
    { type: "tool-start", round: 1, name: "read", args: "src/a.ts", id: "t1" },
    { type: "tool-end", round: 1, name: "read", ok: true, ms: 20, id: "t1", chars: 500, preview: "line one\nline two" },
    { type: "tool-start", round: 1, name: "bash", args: "npm test", id: "t2" },
    { type: "tool-end", round: 1, name: "bash", ok: false, ms: 900, id: "t2", chars: 0, exitCode: 2, preview: "not found" },
    { type: "tool-start", round: 2, name: "edit", args: "a.js", id: "t3" },
    { type: "tool-end", round: 2, name: "edit", ok: false, id: "t3", chars: 0, vetoed: true },
    { type: "plan", round: 2, items: [{ text: "a", status: "done" }, { text: "b", status: "pending" }] },
    { type: "steer", id: "s1", kind: "note", text: "hold on", state: "queued" },
    { type: "steer-read", ids: ["s1"], kinds: ["note"] },
    { type: "snapshot", round: 2, place: "C:/p", agent: "", before: "abb", after: "abc", base: "round", own: ["a.js"], command: false, ref: "refs/filament/snapshots/c1/2-2" },
    { type: "hook", round: 2, on: "post-tool", tool: "edit", command: "npm test", ms: 40, exit: 1, verdict: "block", note: "1 failing" },
  ]);
  assert.equal(al.maxRound, 2);
  assert.deepEqual(al.byRound.get(2).hooks.map((k) => `${k.on}(${k.tool}) ${k.verdict}`), ["post-tool(edit) block"], "hook events sit on their round for the cards");
  assert.deepEqual(al.byRound.get(1).hooks, []);
  const r1 = al.byRound.get(1);
  assert.equal(r1.tools.get("t1").state, "done");
  assert.equal(r1.tools.get("t1").preview, "line one\nline two", "the preview rides the tool record");
  assert.equal(r1.tools.get("t2").exitCode, 2);
  assert.equal(r1.tools.get("t2").state, "failed");
  assert.equal(al.byRound.get(2).tools.get("t3").preview, undefined, "a vetoed call carries no preview");
  assert.equal(al.byRound.get(2).tools.get("t3").state, "vetoed");
  assert.equal(al.byRound.get(2).plan.length, 2);
  assert.equal(al.steers.get("s1").read, true);
  assert.equal(al.steers.get("s1").unread, false);
  assert.equal(al.byRound.get(2).snapshots.length, 1);
  const unread = alignEvents([{ type: "steer", id: "s9", kind: "note", text: "late", state: "queued" }, { type: "steer-unread", ids: ["s9"], kinds: ["note"] }]);
  assert.equal(unread.steers.get("s9").unread, true);
});

test("the aligner: a round-start's blocksBefore lands on its round — the cards' placement anchor", () => {
  const al = alignEvents([
    { type: "round-start", round: 1, blocksBefore: 0 },
    { type: "round-start", round: 2, blocksBefore: 2 },
    { type: "round-start", round: 3 }, // an older log's round: no anchor, the counting rule answers
  ]);
  assert.equal(al.byRound.get(1).blocksBefore, 0);
  assert.equal(al.byRound.get(2).blocksBefore, 2);
  assert.equal(al.byRound.get(3).blocksBefore, undefined);
});

test("roundCardAnchor: a round's cards go after its OWN blocks, before the next round's; without an anchor, after text block r", () => {
  const seg = (kind, type) => ({ kind, ...(type ? { block: { type } } : {}) });
  // The wire's chronology: think1, text1 (round 1), think2 (round 2 streaming), text2 (round 2's words).
  const segments = [seg("block", "thinking"), seg("block", "text"), seg("block", "thinking"), seg("block", "text")];
  const byRound = new Map([
    [1, { blocksBefore: 0 }],
    [2, { blocksBefore: 2 }],
  ]);
  assert.equal(roundCardAnchor(segments, byRound, 1), 2, "round 1's cards land after its own thinking and words");
  assert.equal(roundCardAnchor(segments, byRound, 2), 4, "round 2's cards land after the last block — it is the final round");
  // A round whose next round has not streamed yet anchors on the last block that exists.
  assert.equal(roundCardAnchor(segments.slice(0, 2), byRound, 1), 2);
  // No anchors anywhere: the counting rule — after text block r.
  assert.equal(roundCardAnchor(segments, new Map(), 1), 2);
  assert.equal(roundCardAnchor(segments, new Map(), 2), 4);
  assert.equal(roundCardAnchor(segments, new Map(), 5), 4, "rounds past the last text share the last anchor");
  assert.equal(roundCardAnchor([seg("block", "thinking")], new Map(), 1), 0, "a round before any text anchors at the top");
  // A round that streamed no blocks shares its anchor with the next round: its cards still go BETWEEN the rounds —
  // before the next round's first block — not below the next round's words (the chronology says the tools ran first).
  const byShared = new Map([
    [1, { blocksBefore: 0 }],
    [2, { blocksBefore: 2 }],
    [3, { blocksBefore: 2 }],
  ]);
  assert.equal(roundCardAnchor(segments, byShared, 2), 2, "the block-less round 2 lands before round 3's first block");
  assert.equal(roundCardAnchor(segments, byShared, 1), 2);
  assert.equal(roundCardAnchor(segments, byShared, 3), 4, "the last anchored round still takes the tail");
});

// (fails before: yes — a coding agent's archived reply keeps its words without its thinking, and the anchors counted the
// thinking its run streamed: each round's cards, and the messages it read, stood rounds past it, further down the
// longer the turn ran; the owner's of 11-05, a message drawn 50 rounds after it was read)
test("roundCardAnchor: a reply that holds none of the thinking its run said anchors each round at the rounds before it that said words", () => {
  const seg = (/** @type {string} */ type) => ({ kind: "block", block: { type } });
  const al = alignEvents([
    { type: "round-start", round: 1, blocksBefore: 0 },
    { type: "round-thinking", round: 1, thinking: "a" },
    { type: "round-text", round: 1, text: "one" },
    { type: "round-start", round: 2, blocksBefore: 2 },
    { type: "round-thinking", round: 2, thinking: "b" },
    { type: "round-start", round: 3, blocksBefore: 3 },
    { type: "round-thinking", round: 3, thinking: "c" },
    { type: "round-text", round: 3, text: "three" },
    { type: "round-start", round: 4, blocksBefore: 5 },
    { type: "round-text", round: 4, text: "four" },
  ]);
  // The archive's reply: the words of rounds 1, 3 and 4, none of the thinking.
  const kept = [seg("text"), seg("text"), seg("text")];
  assert.equal(roundCardAnchor(kept, al.byRound, 1), 1, "round 1's cards after its words, before round 3's");
  assert.equal(roundCardAnchor(kept, al.byRound, 2), 1, "a round that only thought: before the next words");
  assert.equal(roundCardAnchor(kept, al.byRound, 3), 2, "round 3's after its own words, before round 4's");
  assert.equal(roundCardAnchor(kept, al.byRound, 4), 3, "the final round: after the last block");
  // The reply as it streamed, its thinking among its blocks: the run's anchors as they are.
  const live = [seg("thinking"), seg("text"), seg("thinking"), seg("thinking"), seg("text"), seg("text")];
  assert.equal(roundCardAnchor(live, al.byRound, 1), 2);
  assert.equal(roundCardAnchor(live, al.byRound, 2), 3);
  assert.equal(roundCardAnchor(live, al.byRound, 3), 5);
  assert.equal(roundCardAnchor(live, al.byRound, 4), 6);
  // A run that never thought: its anchors are already the words', and stand.
  const plain = alignEvents([{ type: "round-start", round: 1, blocksBefore: 0 }, { type: "round-text", round: 1, text: "one" }, { type: "round-start", round: 2, blocksBefore: 1 }]);
  assert.equal(roundCardAnchor([seg("text"), seg("text")], plain.byRound, 1), 1);
});

// (fails before: yes — HarnessV3-Views V3 drive 5: a resumed turn's command, run in the round that asked, was drawn
// after the words its own next round wrote)
test("roundCardAnchor: a round with no anchor never lands past a later round's first block — a resumed turn's calls go first", () => {
  const text = { kind: "block", block: { type: "text" } };
  // The resumed turn: round 1's command ran first, its start in the asking turn's run; round 2 wrote and asked.
  const resumed = [text, { ...text }];
  const byRound = new Map([[2, { blocksBefore: 0 }]]);
  assert.equal(roundCardAnchor(resumed, byRound, 1), 0, "before round 2's words");
  assert.equal(roundCardAnchor(resumed, byRound, 2), 2, "round 2's own cards after its blocks");
  // An older log's unanchored rounds keep the counting rule while it stays before the next anchored round's blocks.
  const older = [text, { ...text }, { ...text }];
  const third = new Map([[3, { blocksBefore: 2 }]]);
  assert.equal(roundCardAnchor(older, third, 1), 1);
  assert.equal(roundCardAnchor(older, third, 2), 2);
});

// (fails before: no — a guard the mutation pass asked for: nothing checked that only a later round bounds a round with
// no anchor, and only once that round's first block has streamed)
test("roundCardAnchor: only a later round's first block, once streamed, bounds a round with no anchor", () => {
  const text = { kind: "block", block: { type: "text" } };
  // Live, the resumed turn's next round has started and written nothing yet: the command it ran stands at the top.
  assert.equal(roundCardAnchor([], new Map([[2, { blocksBefore: 0 }]]), 1), 0);
  // An earlier round's anchor never pulls a later round's cards up past that round's own words.
  assert.equal(roundCardAnchor([text, { ...text }], new Map([[1, { blocksBefore: 0 }]]), 2), 2);
});

test("foldSplit: live, everything stands in the order it happened — later work goes BELOW the last text; settled, all the work folds", () => {
  const seg = (kind, type, text) => ({ kind, ...(type ? { block: { type, text } } : {}) });
  const think1 = seg("block", "thinking");
  const text1 = seg("block", "text", "I'll start by looking at the files.");
  const cards = { kind: "cards" };
  const think6 = seg("block", "thinking");
  const text6 = seg("block", "text", "Here is what the project does.");
  const web = { kind: "web" };
  // Live, round 6 thinking while round 1's words are still the newest text: the thinking streams UNDER those words,
  // the order the wire spoke them in — never above a stale sentence (the owner's screenshot, 2026-09-28).
  const live = foldSplit([think1, text1, cards, think6], { live: true });
  assert.equal(live.lastText, text1);
  assert.deepEqual(live.fold, [think1]);
  assert.deepEqual(live.after, [cards, think6], "the newest work is the bottom of the turn");
  // Round 6's words arrive: everything before them folds, and nothing followed them.
  const answered = foldSplit([think1, text1, cards, think6, text6], { live: true });
  assert.equal(answered.lastText, text6);
  assert.deepEqual(answered.fold, [think1, text1, cards, think6]);
  assert.deepEqual(answered.after, []);
  // Settled on its answer: the same split, plus the website cards under the answer — nothing moves at the end.
  const done = foldSplit([think1, text1, cards, think6, text6, web]);
  assert.deepEqual(done.fold, answered.fold);
  assert.deepEqual(done.after, [web]);
  // Settled past its last text (a stopped turn's unfinished round, an archived reply's cards past its merged text):
  // that work folds with the rest; only the website cards stay under the answer.
  const stopped = foldSplit([think1, text1, cards, think6, web]);
  assert.equal(stopped.lastText, text1);
  assert.deepEqual(stopped.fold, [think1, cards, think6]);
  assert.deepEqual(stopped.after, [web]);
});

// (fails before: yes — HarnessV3-Views V3 drive 4: the words a turn said before its question folded alone under a
// "Worked" that held no work)
test("foldSplit: words alone are no work — they stand above the last text, settled or live; with work among them they fold", () => {
  const text = (t) => ({ kind: "block", block: { type: "text", text: t } });
  const lead = text("First I check the runtime.");
  const asked = text("May I run this command?");
  const cards = { kind: "cards" };
  const think = { kind: "block", block: { type: "thinking", text: "" } };
  for (const live of [false, true]) assert.deepEqual(foldSplit([lead, asked], { live }), { lastText: asked, lead: [lead], pictures: [], fold: [], after: [], closing: null }, live ? "live" : "settled");
  assert.deepEqual(foldSplit([lead, cards, asked]), { lastText: asked, lead: [], pictures: [], fold: [lead, cards], after: [], closing: null }, "words with work among them fold with it");
  assert.deepEqual(foldSplit([think, asked]).fold, [think], "a thought is the model's work");
  assert.deepEqual(foldSplit([asked]), { lastText: asked, lead: [], pictures: [], fold: [], after: [], closing: null }, "nothing before the last text: nothing to stand or fold");
});

// (fails before: yes — HarnessV3-Views V3 drive 5: settled, an answered question's lead-in folded under "Worked" with
// the command before it, and the question stood alone below)
test("foldSplit: Filament's note right under the reply's last words closes that reply — the words stand, the note under them", () => {
  const text = (t) => ({ kind: "block", block: { type: "text", text: t } });
  const cards = { kind: "cards" };
  const web = { kind: "web" };
  const words = text("node runs. One question before I write anything:");
  const asked = text("Where should the modulo operator live?");
  const note = { kind: "ask", text: "Where should the modulo operator live?" };
  // Live the note stands under the words; settled it is the turn's last word (HarnessV3-Views V6-14).
  for (const live of [false, true]) assert.deepEqual(foldSplit([cards, words, asked], { live, note }), { lastText: words, lead: [], pictures: [], fold: [cards], after: live ? [asked] : [], closing: live ? null : asked }, live ? "live" : "settled");
  assert.deepEqual(foldSplit([cards, words, asked, web], { note }), { lastText: words, lead: [], pictures: [], fold: [cards], after: [web], closing: asked }, "the website cards under the words, the note last");
  // Work between the words and the note: the words fold with the work, and the note closes the turn.
  assert.deepEqual(foldSplit([words, cards, asked], { note }), { lastText: null, lead: [], pictures: [], fold: [words, cards], after: [], closing: asked });
  assert.deepEqual(foldSplit([cards, words, asked]), { lastText: asked, lead: [], pictures: [], fold: [cards, words], after: [], closing: null }, "no note named: the last text is the answer");
  assert.deepEqual(foldSplit([asked], { note }), { lastText: null, lead: [], pictures: [], fold: [], after: [], closing: asked }, "a note alone closes the turn");
});

// (fails before: no — a guard the mutation pass asked for: nothing checked that only the note's own block closes the
// reply's last words, or that, live, what followed the note stays under it)
test("foldSplit: only the note's own block closes the reply's last words; live, what followed the note stays under it", () => {
  const text = (t) => ({ kind: "block", block: { type: "text", text: t } });
  const cards = { kind: "cards" };
  const words = text("Checking the parser.");
  const said = text("The parser reads the operators first.");
  // A question waiting in the dock: its copy is left out, so the reply's last words are the answer.
  const asking = { kind: "ask", text: "Which parser?" };
  assert.deepEqual(foldSplit([cards, words, said], { note: asking }), { lastText: said, lead: [], pictures: [], fold: [cards, words], after: [], closing: null });
  // The order it happened in, live: the words, the note, then what came after the note.
  const stop = text("(Filament: the developer stopped this turn …)");
  const later = { kind: "cards" };
  const stopped = { kind: "stop", text: stop.block.text };
  assert.deepEqual(foldSplit([cards, words, stop, later], { live: true, note: stopped }).after, [stop, later]);
});

test("placeChildren: only the nodes out of place move — a node put back would restart its arrive animation", () => {
  /** A parent's child list as `placeChildren` uses it, counting every insertion. */
  const parentOf = (kids) => {
    const p = {
      childNodes: [...kids],
      moves: /** @type {string[]} */ ([]),
      removeChild(n) { p.childNodes.splice(p.childNodes.indexOf(n), 1); },
      insertBefore(n, ref) {
        const was = p.childNodes.indexOf(n);
        if (was >= 0) p.childNodes.splice(was, 1);
        p.childNodes.splice(ref ? p.childNodes.indexOf(ref) : p.childNodes.length, 0, n);
        p.moves.push(n.id);
      },
    };
    return p;
  };
  const [a, b, c, x] = /** @type {any[]} */ (["a", "b", "c", "x"].map((id) => ({ id })));
  const same = parentOf([a, b, c]);
  placeChildren(/** @type {any} */ (same), [a, b, c]);
  assert.deepEqual(same.moves, [], "an unchanged list touches nothing");
  const inserted = parentOf([a, b, c]);
  placeChildren(/** @type {any} */ (inserted), [a, x, b, c]);
  assert.deepEqual(inserted.childNodes, [a, x, b, c]);
  assert.deepEqual(inserted.moves, ["x"], "a new card between blocks inserts itself alone");
  const dropped = parentOf([a, b, c]);
  placeChildren(/** @type {any} */ (dropped), [b, c, x]);
  assert.deepEqual(dropped.childNodes, [b, c, x]);
  assert.deepEqual(dropped.moves, ["x"], "a node that left does not shift the survivors");
  const swapped = parentOf([a, b]);
  placeChildren(/** @type {any} */ (swapped), [b, a]);
  assert.deepEqual(swapped.childNodes, [b, a]);
  assert.equal(swapped.moves.length, 1, "a reorder moves one node, not the list");
});

test("sessionAge: a date-only stamp is a calendar day, not UTC midnight", () => {
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = new Date();
  assert.equal(sessionAge(ymd(today)), "today");
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  assert.equal(sessionAge(ymd(yest)), "yesterday");
  const week = new Date(today);
  week.setDate(week.getDate() - 7);
  assert.equal(sessionAge(ymd(week)), "7d");
  assert.equal(sessionAge(null), "");
  assert.equal(sessionAge(new Date(Date.now() - 5_000).toISOString()), "now");
});

// (fails before: yes — a lane and Now's finished row read the list's day alone as UTC midnight: "idle · 14h" for a
// chat that ended its turn a minute before, seen live in E35 S1's look)
test("rowMoment: the list's last moment whole; a time a row names; a day alone is no moment", () => {
  assert.equal(rowMoment({ lastAt: 1_792_849_000_000, when: "2026-10-24" }), 1_792_849_000_000);
  assert.equal(rowMoment({ when: "2026-10-24T13:37:17.000Z" }), Date.parse("2026-10-24T13:37:17.000Z"));
  assert.equal(rowMoment({ when: "2026-10-24" }), 0);
  assert.equal(rowMoment({ lastAt: null, when: "" }), 0);
  assert.equal(rowMoment(null), 0);
});

test("timelineBucket: calendar buckets, not UTC midnight", () => {
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = new Date();
  assert.equal(timelineBucket(ymd(today)), "Today");
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  assert.equal(timelineBucket(ymd(yest)), "Yesterday");
  assert.equal(timelineBucket(null), "Older");
});

test("greetingAt: AgentPlanUX hour windows; the evening praises work only on a day there was some (HarnessV3-Launch LD-D4)", () => {
  assert.equal(greetingAt(6), "Morning, ready when you are");
  assert.equal(greetingAt(10), "Morning, how can I help?");
  assert.equal(greetingAt(13), "Noon break?");
  assert.equal(greetingAt(16), "Good afternoon! Leave the rest to me.");
  // (fails before: yes — every evening said "nice work today", a first evening with nothing done too)
  assert.equal(greetingAt(20, true), "Evening, nice work today");
  assert.equal(greetingAt(20), "Good evening", "no task had a turn today");
  assert.equal(greetingAt(20, false), "Good evening");
  assert.equal(greetingAt(2), "It's late—remember to take care of yourself.");
});

test("workedToday: one of the developer's tasks had a turn today, by the local day (LD-D4)", () => {
  const now = new Date(2026, 9, 3, 20, 0);
  const at = (/** @type {number} */ day, /** @type {number} */ hour) => new Date(2026, 9, day, hour, 0).toISOString();
  assert.equal(workedToday([{ kind: "interactive", turns: 3, when: at(3, 0) }], now), true, "since midnight");
  assert.equal(workedToday([{ kind: "fork", turns: 1, when: at(3, 19) }], now), true, "a fork is the developer's too");
  assert.equal(workedToday([{ kind: "interactive", turns: 3, when: at(2, 23) }], now), false, "yesterday");
  assert.equal(workedToday([{ kind: "tick", turns: 1, when: at(3, 9) }, { kind: "subagent", turns: 2, when: at(3, 9) }], now), false, "Filament's own calls are not the developer's work");
  assert.equal(workedToday([{ kind: "interactive", turns: 0, when: at(3, 9) }], now), false, "a task with no turn yet");
  assert.equal(workedToday([{ kind: "interactive", turns: 2, when: null }], now), false);
  assert.equal(workedToday([], now), false);
});

test("the hash router: every route parses and round-trips through routeFor", () => {
  assert.deepEqual(parseRoute(""), { kind: "home" });
  assert.deepEqual(parseRoute("#/"), { kind: "home" });
  assert.deepEqual(parseRoute("#/kit"), { kind: "home" }, "the dev kit route was removed in UX-11");
  assert.deepEqual(parseRoute("#/task/abc%20def"), { kind: "task", id: "abc def", view: "chat" });
  assert.deepEqual(parseRoute("#/settings"), { kind: "settings", section: "general" });
  assert.deepEqual(parseRoute("#/settings/appearance"), { kind: "settings", section: "appearance" });
  assert.deepEqual(parseRoute("#/control-room/run-7"), { kind: "control-room", id: "run-7" });
  assert.deepEqual(parseRoute("#/unknown/x"), { kind: "home" }, "an unknown route is home, never a crash");
  assert.equal(routeFor("home"), "#/");
  assert.equal(routeFor({ kind: "task", id: "a b", view: "chat" }), "#/task/a%20b");
  assert.equal(routeFor("task", { id: "x" }), "#/task/x");
  assert.equal(routeFor("settings", { section: "s" }), "#/settings/s");
  assert.equal(routeFor("control-room", { id: "r" }), "#/control-room/r");
  assert.equal(routeFor("task"), "#/", "a task route without an id is home");
});

// (fails before: yes — no address opened a new chat in a folder: a machine's page the desktop app opened from this
// computer's new-chat menu could not be told where, pk-list)
test("the hash router: a new chat in a folder has an address of its own, the folder whole in one part", () => {
  assert.deepEqual(parseRoute(`#/new/${encodeURIComponent("/Users/kai/llm shim")}`), { kind: "home", folder: "/Users/kai/llm shim" });
  assert.deepEqual(parseRoute("#/new/C%3A%5Cw%5Capp"), { kind: "home", folder: "C:\\w\\app" });
  assert.deepEqual(parseRoute("#/new"), { kind: "home" }, "no folder: a new chat where the page would open one");
  assert.equal(routeFor("home", { folder: "C:\\w\\app" }), "#/new/C%3A%5Cw%5Capp");
  assert.deepEqual(parseRoute(routeFor("home", { folder: "/a/b c" })), { kind: "home", folder: "/a/b c" });
  assert.equal(routeFor("home"), "#/");
});

// (fails before: yes — the swarm's review of 11-10: a page the desktop app sent to `#/new/<folder>` as it started read the
// address before its projects, said "No project at" and opened a plain new chat)
test("a new chat at an address asked while the page starts waits for its projects: the start applies the address it then finds", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  const heard = app.slice(app.indexOf('window.addEventListener("hashchange"'), app.indexOf("chatLinks(document);"));
  assert.match(heard, /if \(!booted && route\.kind === "home" && route\.folder\) return;\n\s*applyRoute\(route\);/);
  const boot = app.slice(app.indexOf("async function boot()"));
  const read = boot.indexOf("await Promise.all([sessionsReady, stateReady]);");
  const on = boot.indexOf("booted = true;");
  const parsed = boot.indexOf("const initial = parseRoute(location.hash);");
  assert.ok(read > 0 && read < on && on < boot.indexOf("applyRoute(initial);") && read < parsed, "set once the projects are read, as the start reads the address");
});

// (fails before: yes — the review of pk-list: `#/new/<folder>` opened a chat in whatever folder it named, a link in a
// chat's words could name a share, and the page asked that share's computer for its git)
test("a new chat at an address opens only in a project the page knows, as its list names it; never a share, nor a folder no project names", () => {
  const projects = [{ id: "p1", cwd: "C:\\w\\app" }, { id: "p2", cwd: "/Users/kai/llm shim" }, { id: "p3", cwd: "" }];
  assert.equal(newChatFolder("c:/W/app/", projects), "C:\\w\\app", "separators and case aside, the list's own");
  assert.equal(newChatFolder("/Users/kai/llm shim", projects), "/Users/kai/llm shim");
  assert.equal(newChatFolder("/Users/kai/other", projects), null, "no project names it");
  assert.equal(newChatFolder("\\\\attacker\\x", [...projects, { cwd: "\\\\attacker\\x" }]), null, "a share, even one listed");
  assert.equal(newChatFolder("//attacker/x", [...projects, { cwd: "//attacker/x" }]), null);
  assert.equal(newChatFolder("", projects), null);
  assert.equal(newChatFolder("C:\\w\\app", null), null, "no list read: none");
});

// (fails before: yes — the bug hunt of 10-30, UIS-9: `#/task/%` threw URIError out of parseRoute, so the route was never
// applied and the page's boot, which reads the address, broke)
test("the hash router: a part that holds no escape the URI reader takes is read as written, never a throw", () => {
  assert.deepEqual(parseRoute("#/task/%"), { kind: "task", id: "%", view: "chat" });
  assert.deepEqual(parseRoute("#/task/50%off/plan"), { kind: "task", id: "50%off", view: "plan" });
  assert.deepEqual(parseRoute("#/settings/%E0%A4%A"), { kind: "settings", section: "%E0%A4%A" });
  assert.deepEqual(parseRoute("#/context/%zz"), { kind: "context", tab: "%zz" });
  assert.deepEqual(parseRoute("#/control-room/%"), { kind: "control-room", id: "%" });
  assert.deepEqual(parseRoute("#/library/memory/100%"), { kind: "library", page: "memory", scope: "100%" });
  assert.deepEqual(parseRoute("#/space/%/%"), { kind: "space", id: "%", tab: "%" });
  assert.deepEqual(parseRoute("#/task/abc%20def"), { kind: "task", id: "abc def", view: "chat" }, "a good escape is still read");
  assert.equal(onScreen("#/space/%"), true);
});

test("ux-0 token sheets: every colour lives in a token declaration, both themes complete", () => {
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  const dark = css.match(/\.theme-zai-dark \{([\s\S]*?)\n\}/);
  const light = css.match(/\.theme-zai-light \{([\s\S]*?)\n\}/);
  assert.ok(dark && light, "both theme sheets exist");
  for (const tok of ["--color-background", "--color-sidebar", "--color-card", "--color-popover", "--color-input",
    "--color-menu", "--color-primary", "--color-foreground", "--color-foreground-subtlest", "--color-success",
    "--color-warning", "--color-destructive", "--color-diff-added", "--color-diff-removed", "--color-tooltip",
    "--color-tag", "--color-icon-blue", "--color-context-breakdown-7", "--color-trajectory-tool-result"]) {
    assert.ok(dark[1].includes(tok), `dark sheet carries ${tok}`);
    assert.ok(light[1].includes(tok), `light sheet carries ${tok}`);
  }
  // Both sheets declare the identical token-name set — a token added to one theme only is a bug.
  const names = (s) => [...new Set([...s.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))].sort();
  assert.deepEqual(names(dark[1]), names(light[1]), "the two sheets must declare the same tokens");
  // No raw colour outside a token declaration or a comment (AgentPlanUX UX-0 acceptance).
  const lines = css.split("\n");
  const offenders = lines.filter((l) => {
    const s = l.trim();
    if (!/#[0-9a-fA-F]{3,8}\b/.test(s)) return false;
    if (s.startsWith("--color-") || s.startsWith("--animated-")) return false;
    if (s.startsWith("*") || s.startsWith("/*")) return false; // comments
    return true;
  });
  assert.deepEqual(offenders, [], `raw colours outside token sheets: ${offenders.join(" | ")}`);
  // Keyframes are defined once each — a duplicate silently overrides.
  const kf = [...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(kf.filter((n, i) => kf.indexOf(n) !== i))], [], "duplicate keyframes");
  const zc = readFileSync(new URL("../src/ui/harness/zc.css", import.meta.url), "utf8");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(zc), "zc.css references tokens only");
  assert.ok(zc.includes(".text-ui-sm { font-size: var(--text-ui-sm); }"), "zc.css carries the text scale");
  assert.ok(zc.includes(".rounded-lg { border-radius: 8px; }"), "zc.css carries the radius ladder");
  // The page's other sheets carry no colour of their own either.
  for (const rel of ["../src/ui/harness/settings/settings.css", "../src/ui/harness/panes/panes.css", "../src/ui/harness/views/views.css"]) {
    const sheet = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(sheet.replace(/\/\*[\s\S]*?\*\//g, "")), `${rel} references tokens only`);
  }
});

test("every custom property settings.css reads is defined in a harness sheet, or set inline by its page — a var() that resolves to nothing voids its whole declaration", () => {
  const read = (/** @type {string} */ rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const css = read("../src/ui/harness/settings/settings.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const sheets = [css, ...["harness.css", "harness/zc.css", "harness/instruments.css", "harness/aqua.css"].map((f) => read(`../src/ui/${f}`))].join("\n");
  // Set in a style attribute: the Memory section's kind tile (HarnessV3-Memory M6-5); by theme.js: the code size.
  const inline = new Set(["--tile", "--code-font-size"]);
  const used = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
  assert.deepEqual(used.filter((v) => !inline.has(v) && !sheets.includes(`${v}:`)), []);
});

test("ux-0 typography: no font-size literal outside the token sheet (AgentPlanUX §11 item 7)", () => {
  // The scale lives in --text-ui-* / --ui-font-size; a pixel size in a rule is a value the settings cannot move.
  // The greeting's 20–30px fit (§5.3.1) is the one sanctioned literal.
  const sheets = ["../src/ui/harness.css", "../src/ui/harness/zc.css", "../src/ui/harness/settings/settings.css", "../src/ui/harness/panes/panes.css", "../src/ui/harness/views/views.css"];
  const offenders = [];
  for (const rel of sheets) {
    const css = readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const l of css.split("\n")) {
      const s = l.trim();
      if (!/font-size:\s*\d/.test(s)) continue;
      if (s.startsWith("--")) continue; // the token declarations themselves
      if (/font-size:\s*30px/.test(s)) continue; // the greeting fit
      offenders.push(`${rel.split("/").pop()}: ${s}`);
    }
  }
  assert.deepEqual(offenders, [], `font-size literals: ${offenders.join(" | ")}`);
});

test("ux-0 icons: the §3.6 set is present and well-formed", () => {
  const src = readFileSync(new URL("../src/ui/harness/lib/icons.js", import.meta.url), "utf8");
  for (const key of ["messageCirclePlus", "search", "folder", "folderOpen", "clock3", "listFilter", "pin",
    "archive", "ellipsis", "chevronRight", "chevronDown", "chevronLeft", "chevronUp", "panelRightOpen",
    "panelRightClose", "squareTerminal", "circleHelp", "fileDiff", "listTree", "notepadText", "bot",
    "botMessageSquare", "bug", "waypoints", "map", "brain", "arrowUp", "loader", "shieldAlert", "shieldCheck",
    "hand", "eye", "messageSquare", "copy", "check", "pencil", "thumbsUp", "thumbsDown", "trending", "rotateCcw",
    "gitBranch", "goal", "listTodo", "circleCheck", "circle", "arrowRight", "settings", "user", "palette",
    "zoomIn", "zoomOut", "maximize", "maximize2", "gripVertical", "arrowUpFromLine", "trash2", "wrench", "info",
    "pause", "play", "refreshCw", "externalLink", "fileCode2", "fileText", "wandSparkles", "plug", "squareSlash",
    "scrollText", "cable", "sparkles", "package", "terminal", "panelLeftOpen", "chevronsDownUp", "chevronsUpDown"]) {
    assert.ok(src.includes(`${key}:`), `icon ${key} is missing`);
  }
  assert.ok(src.includes("export function icon("), "the icon(name, cls) accessor exists");
});

test("lastThinkingLine: the last non-empty line, never a blank tail", () => {
  assert.equal(lastThinkingLine(""), "");
  assert.equal(lastThinkingLine("one\n\n  two  \n\n"), "two");
  assert.equal(lastThinkingLine("only"), "only");
});

test("formatWorkedFor: Worked-for labels", () => {
  assert.equal(formatWorkedFor(400), "1s");
  assert.equal(formatWorkedFor(12_000), "12s");
  assert.equal(formatWorkedFor(4 * 60_000 + 19_000), "4m 19s");
  assert.equal(formatWorkedFor(2 * 60_000 + 5_000), "2m 5s");
  assert.equal(formatWorkedFor(60_000), "1m");
  assert.equal(formatWorkedFor(2 * 3600_000 + 5 * 60_000), "2h 5m");
  assert.equal(formatWorkedFor(-1), "");
});

test("websiteCardsFrom: unique http(s) URLs, host as title, trailing punctuation stripped", () => {
  const cards = websiteCardsFrom("see https://example.com/docs, and https://www.foo.io/a. also https://example.com/docs again.");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].url, "https://example.com/docs");
  assert.equal(cards[0].title, "example.com");
  assert.equal(cards[0].kind, "Website");
  assert.equal(cards[1].title, "foo.io");
  assert.deepEqual(websiteCardsFrom("no links here"), []);
});

test("fileChangePaths: write/edit that finished, unique, never a running call", () => {
  assert.deepEqual(fileChangePaths([
    { name: "write", state: "done", args: { path: "src/a.js" } },
    { name: "edit", state: "done", args: { path: "src/a.js" } },
    { name: "write", state: "running", args: { path: "src/b.js" } },
    { name: "read", state: "done", args: { path: "src/c.js" } },
    { name: "edit", state: "done", args: { file_path: "docs/NOTES.md" } },
  ]), ["src/a.js", "docs/NOTES.md"]);
});

/** @param {Partial<KeyboardEvent>} o */
const key = (o) => /** @type {KeyboardEvent} */ ({ repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: "", ...o });

test("the shortcut matcher: modifiers match exactly, repeats and IME composition never match", () => {
  assert.equal(matchShortcut(key({ ctrlKey: true, key: "k" })), "command-center");
  assert.equal(matchShortcut(key({ metaKey: true, key: "k" })), "command-center", "Cmd stands in for Ctrl");
  assert.equal(matchShortcut(key({ ctrlKey: true, shiftKey: true, key: "K" })), "", "an extra modifier is a different shortcut");
  assert.equal(matchShortcut(key({ ctrlKey: true, key: "k", repeat: true })), "", "a held key never re-fires");
  assert.equal(matchShortcut(key({ ctrlKey: true, key: "k", isComposing: true })), "", "mid-IME never matches");
  assert.equal(comboFromEvent(key({ key: "Control" })), "", "a bare modifier is not a combo");
  assert.equal(matchShortcut(key({ ctrlKey: true, key: "," })), "settings");
  assert.equal(matchShortcut(key({ key: "k" })), "");
  assert.equal(matchShortcut(key({ ctrlKey: true, shiftKey: true, key: "{", code: "BracketLeft" })), "task-prev", "Shift makes '[' arrive as '{'; the physical key matches");
  assert.equal(matchShortcut(key({ ctrlKey: true, key: "{", code: "BracketLeft" })), "back");
});

test("tool grouping: consecutive completed stubs of one family, a running stub never joins", () => {
  assert.equal(familyOf("grep"), "explore");
  assert.equal(familyOf("ask"), null);
  const runs = groupRuns([
    { name: "read", state: "done" },
    { name: "grep", state: "done" },
    { name: "read", state: "running" },
    { name: "edit", state: "done" },
    { name: "bash", state: "done" },
    { name: "bash", state: "failed" },
  ]);
  assert.deepEqual(runs, [
    { start: 0, length: 2, family: "explore" },
    { start: 4, length: 2, family: "terminal" },
  ], "the running read breaks the explore run, and one edit is not a group");
});

// (fails before: yes — a round was done only once its workers had all finished, so an agent turn's rounds, which have
// none, all stayed lit as running until the run ended, and an error failed every one of them)
test("stationsFrom: a round ends when the next one starts, and the run's end settles the last one", () => {
  const events = [
    { type: "round-start", round: 1 },
    { type: "round-text", round: 1, text: "Looking." },
    { type: "round-start", round: 2 },
    { type: "vetoed", round: 2, text: "not that file" },
    { type: "round-start", round: 3 },
  ];
  const live = stationsFrom(events);
  assert.deepEqual(live.rounds.map((r) => r.state), ["done", "done", "running"]);
  assert.equal(live.ended, false);
  assert.equal(live.rounds[0].text, "Looking.");
  assert.equal(live.rounds[1].bodies[0].text, "Vetoed: not that file");
  const over = stationsFrom([...events, { type: "run-end", status: "error", summary: { inputTokens: 10 } }]);
  assert.deepEqual(over.rounds.map((r) => r.state), ["done", "done", "failed"], "the error fails the round it ended, not the ones before");
  assert.deepEqual([over.ended, over.summary.inputTokens, over.metrics.rounds], [true, 10, 3]);
});

// HarnessV3-TaskGraph-v2 TG2-D62. (fails before: yes — a cut the turn went on from drew nothing in its round)
test("stationsFrom: a reply cut at its ceiling that the turn went on from says what it was cut at, where, and that it went on", () => {
  const view = stationsFrom([
    { type: "round-start", round: 1 },
    { type: "output-cut", round: 1, at: 128000, limit: 128000, by: "ceiling", part: "thinking", chars: 207959, ran: 0 },
    { type: "round-start", round: 2 },
    { type: "output-cut", round: 2, at: 61000, limit: 128000, by: "window", part: "call", tool: "write", ran: 1 },
  ]);
  assert.equal(view.rounds[0].bodies[0].text, "Cut at the output ceiling (128,000 tokens) while thinking — Filament went on.");
  assert.equal(view.rounds[1].bodies[0].text, "Cut at the room its window had left (61,000 tokens) while writing its call to write — Filament went on.");
});

test("stop reasons in words, the cut honestly flagged", () => {
  assert.equal(stopReasonText("end_turn"), "finished");
  assert.match(stopReasonText("max_tokens"), /cut at the output ceiling/);
  assert.equal(stopReasonText("tool_use"), "paused on tools");
  assert.equal(stopReasonText(null), "");
  assert.equal(stopReasonText("something_new"), "something_new");
});

// --- the side panes' pure arithmetic (panes/pane-data.js) -----------------------------------------

test("git status letters: a last-turn word and a porcelain column land on the same letter and colour", () => {
  // B2 rows carry a status word; B5 rows carry the porcelain columns.
  assert.deepEqual(statusLetter({ status: "added" }), { letter: "A", cls: "a" });
  assert.deepEqual(statusLetter({ status: "modified" }), { letter: "M", cls: "m" });
  assert.deepEqual(statusLetter({ status: "deleted" }), { letter: "D", cls: "d" });
  assert.deepEqual(statusLetter({ status: "renamed" }), { letter: "R", cls: "r" });
  assert.deepEqual(statusLetter({ status: "typechange" }), { letter: "M", cls: "m" }, "a typechange has no colour of its own");
  // porcelain: index and worktree columns, "." meaning "no change there"
  assert.deepEqual(statusLetter({ index: " ", worktree: "M" }), { letter: "M", cls: "m" });
  assert.deepEqual(statusLetter({ index: "M", worktree: " " }), { letter: "M", cls: "m" });
  assert.deepEqual(statusLetter({ index: "A", worktree: " " }), { letter: "A", cls: "a" });
  assert.deepEqual(statusLetter({ index: "R", worktree: " " }), { letter: "R", cls: "r" });
  assert.deepEqual(statusLetter({ index: " ", worktree: "?" }), { letter: "A", cls: "a" }, "an untracked file is an addition");
  assert.deepEqual(statusLetter({ index: " ", worktree: "D" }), { letter: "D", cls: "d" });
  // the worktree column wins when both moved
  assert.deepEqual(statusLetter({ index: "M", worktree: "D" }), { letter: "D", cls: "d" });
});

test("network status: a record's failover trail plus the served entry become the attempt rows", () => {
  const rows = attemptsOf({
    model: "m1",
    upstream: "backup-upstream",
    status: "ok",
    totalMs: 1234,
    failover: {
      trail: [
        { upstream: "primary", status: 503, reason: "upstream 503" },
        { upstream: "second", status: null, reason: "timeout" },
      ],
      servedBy: "backup-upstream",
      attempt: 3,
    },
  });
  assert.deepEqual(rows, [
    { provider: "primary", attempt: 1, http: 503, ms: null, error: "upstream 503", served: false },
    { provider: "second", attempt: 2, http: null, ms: null, error: "timeout", served: false },
    { provider: "backup-upstream", attempt: 3, http: null, ms: 1234, error: null, served: true },
  ], "a failed hop has no duration — only what the record carries");
  // (fails before: yes — HarnessV4_Tasks B10: a route nobody answered on drew its last upstream as the one that served)
  assert.deepEqual(attemptsOf({ upstream: "second", status: "error", error: "upstream second unreachable", failover: { trail: [{ upstream: "primary", status: 503, reason: "upstream 503" }, { upstream: "second", status: null, reason: "timeout" }], servedBy: null } }).map((a) => [a.provider, a.served]), [["primary", false], ["second", false]]);
  // no failover data: the one attempt the record names
  assert.deepEqual(attemptsOf({ upstream: "main", totalMs: 10, status: "ok" }), [
    { provider: "main", attempt: 1, http: null, ms: 10, error: null, served: true },
  ]);
  assert.deepEqual(attemptsOf({}), []);
  // an error record names its error on the served row
  assert.equal(attemptsOf({ upstream: "main", status: "error", error: "boom" })[0].error, "boom");
});

test("the context pane's history: held tokens per request and a forecast only when a fit is fundable", () => {
  const rec = (input, cacheRead = 0, cacheWrite = 0) => ({ tokens: { input, cacheRead, cacheWrite } });
  assert.deepEqual(heldSeries([rec(100, 20, 5), rec(120)]), [125, 120]);
  // three priced points fit; fewer do not
  const fit = forecastNext([10, 12, 14, 16]);
  assert.ok(fit != null && Math.abs(fit - 18) < 1e-9, `the line reads 18 at the next index, got ${fit}`);
  assert.equal(forecastNext([10, 12]), null, "two points are not a forecast");
  assert.equal(forecastNext([10, null, 12].filter((x) => x != null)), null, "still too few after the unpriced rows drop");
  assert.equal(forecastNext([10, 10, 10, 10]), 10, "a flat tail still forecasts its own value");
  assert.equal(forecastNext([-5, -6, -7]), 0, "a negative projection clamps to zero, never a promised refund");
});

// (fails before: yes — the tag read the old team engine's fields alone: a sub-agent's call was tagged "Main session")
test("the prompt card's tag comes from what the record itself carries", () => {
  assert.equal(promptTagOf({}), "Main session");
  assert.equal(promptTagOf({ subagentOf: "r1" }), "Sub-agent");
  assert.equal(promptTagOf({ memory: { position: "compaction" } }), "Compaction");
  assert.equal(promptTagOf({ memoryFor: { purpose: "learn" } }), "Memory · learn");
  assert.equal(promptTagOf({ memoryFor: {} }), "Memory");
  assert.equal(promptTagOf({ memoryFor: { purpose: "memory" } }), "Memory · memory", "the tag never invents a nicer word for the default purpose");
});

// (fails before: yes — the cut read the old team engine's fields: a sub-agent's call was listed as the main session's)
test("isMainRecord: the main session's own calls — never a loop's tick, a sub-agent's call or memory's own", () => {
  assert.equal(isMainRecord({ id: "r1" }), true);
  assert.equal(isMainRecord({ id: "r2", agent: { model: "m" } }), true, "the turn's own request");
  for (const rec of [{ agentOf: "r2" }, { subagentOf: "r2" }, { subagentOf: "owner" }, { memoryFor: { purpose: "learn" } }, { memory: { position: "compaction" } }])
    assert.equal(isMainRecord(rec), false, JSON.stringify(rec));
});

test("the tab overview's ages and the viewer's crumbs", () => {
  const now = Date.now();
  assert.equal(ageOf(now - 30_000, now), "just now");
  assert.equal(ageOf(now - 5 * 60_000, now), "5m ago");
  assert.equal(ageOf(now - 3 * 3600_000, now), "3h ago");
  assert.equal(ageOf(now - 2 * 24 * 3600_000, now), "2d ago");
  // a Windows path arrives with backslashes; build one without escape doubts
  const winPath = ["H:", "proj", "app"].join(String.fromCharCode(92));
  assert.deepEqual(crumbsOf(winPath, "src/ui/lib/dom.js"), ["app", "src", "ui", "lib", "dom.js"]);
  assert.deepEqual(crumbsOf(winPath + String.fromCharCode(92), "README.md"), ["app", "README.md"], "a trailing separator does not make an empty crumb");
  assert.deepEqual(crumbsOf("/home/dev/app", "docs/plan.md"), ["app", "docs", "plan.md"]);
});

// ---------------------------------------------------------------------------------------------------
// UX-8, the settings page's pure helpers: the browser prefs' defaults and typing, the schema-leaf →
// control mapping and the schema walk, the shortcut registry's conflicts and reserved
// combinations, the auto-archive candidates, the grouping toggles, and the usage range filter.
// ---------------------------------------------------------------------------------------------------
import { PREF_DEFAULTS, prefs } from "../src/ui/harness/prefs.js";
import { daysInRange } from "../src/ui/harness/settings/rows.js";
import { leafControlKind, walkGroup, getDotted } from "../src/ui/harness/lib/config-rows.js";
import { conflicts, isReserved, comboLabel, list } from "../src/ui/harness/shortcuts.js";
import { autoArchiveCandidates, autoArchiveSweep, startHourlySweep, sweepWords } from "../src/ui/harness/settings/general.js";

test("the browser prefs: §5.10 keys covered, typed defaults, unknown keys fall back", () => {
  for (const k of ["theme", "uiFontSize", "codeFontSize", "showReasoning",
    "showTodos", "groupExplore", "groupTerminal", "groupChanges", "statusPanel", "performanceMode",
    "notifyDone", "notifyFailed", "notifyAsks", "notificationSound", "sendKey", "whileWorking", "shortcuts", "hintsSeen"]) {
    assert.ok(k in PREF_DEFAULTS, `PREF_DEFAULTS names ${k}`);
  }
  // (fails before: yes — the owner's of 11-09: line numbers and wrap were prefs nothing read)
  for (const k of ["lineNumbers", "wrapLines"]) assert.equal(k in PREF_DEFAULTS, false, `no ${k}: nothing reads it`);
  // Nothing stored (node has no localStorage) — every read is its typed default.
  // (fails before: yes — the owner's of 11-09: "make the theme default to system"; it was dark)
  assert.equal(prefs.get("theme"), "system");
  assert.equal(prefs.get("uiFontSize"), 14);
  assert.equal(prefs.get("showReasoning"), true);
  assert.equal(prefs.get("statusPanel"), "composer", "the status capsule under the message box (proposal_ux D3; the owner's word of 10-29)");
  assert.equal(JSON.parse(prefs.get("shortcuts") || "{}") && Object.keys(JSON.parse(prefs.get("shortcuts"))).length, 0,
    "the shortcuts override map starts empty (stored as its JSON text)");
  assert.equal(prefs.get("nothing-uses-this"), undefined, "a key with no default reads as undefined");
});

// (fails before: yes — the mapping had no segment, text, lines, checks or credential kinds, HS-4)
test("the schema leaf → control mapping the Filament pages draw with (HC-68)", () => {
  assert.equal(leafControlKind({ type: "string", default: "x", description: "" }), "text");
  assert.equal(leafControlKind({ type: "string", default: "", description: "", multiline: true }), "area");
  assert.equal(leafControlKind({ type: "boolean", default: true, description: "" }), "switch");
  assert.equal(leafControlKind({ type: "number", default: 4, description: "" }), "number");
  assert.equal(leafControlKind({ type: "array", itemType: "string", default: [], description: "" }), "lines");
  assert.equal(leafControlKind({ type: "string", default: "edit", description: "", options: ["edit", "ask"] }), "segment",
    "a few short options are a segment, whatever the leaf's type");
  assert.equal(leafControlKind({ type: "enum", default: "info", description: "", options: ["error", "warn", "info", "debug", "trace"] }), "select",
    "more than four are a menu");
  assert.equal(leafControlKind({ type: "list", itemType: "enum", default: [], description: "", options: ["a", "b"] }), "checks");
  assert.equal(leafControlKind({ type: "list", default: [{ model: "", seats: 4 }], description: "" }), "json", "a list of objects is its JSON");
  assert.equal(leafControlKind({ type: "secret", default: "", description: "" }), "none", "a credential is never drawn");
  assert.equal(leafControlKind({ type: "array", itemType: "secret", default: [], description: "" }), "none");
  const group = {
    _doc: "The loop.",
    enabled: { type: "boolean", default: false, description: "" },
    learnedPermissions: { _doc: "What it learns.", afterApprovals: { type: "number", default: 5, description: "" } },
  };
  assert.deepEqual(walkGroup(group).map(([p]) => p), ["enabled", "learnedPermissions.afterApprovals"],
    "groups and leaves in document order, `_doc` skipped");
  const doc = { agentLoop: { permissions: "edit", learnedPermissions: { afterApprovals: 5 } } };
  assert.equal(getDotted(doc, "agentLoop.learnedPermissions.afterApprovals"), 5);
  assert.deepEqual(getDotted(doc, "agentLoop.missing.deep"), undefined);
});

test("the shortcut registry: conflicts, browser-reserved combos, the mac labels, the new defaults", () => {
  assert.deepEqual(conflicts("Ctrl+K"), ["command-center"]);
  assert.deepEqual(conflicts("Ctrl+K", "command-center"), [], "the owner of the combo is left out");
  assert.deepEqual(conflicts("Ctrl+Alt+B"), ["pane"]);
  assert.ok(isReserved("Ctrl+W") && isReserved("Ctrl+T") && isReserved("Ctrl+N"), "a browser tab keeps W/T/N");
  assert.ok(!isReserved("Ctrl+Shift+F"), "the fork combo is free");
  const ids = list().map((s) => s.id);
  for (const id of ["open-workspace", "close-context", "zoom-in", "zoom-out", "zoom-reset", "composer-send", "composer-veto"]) {
    assert.ok(ids.includes(id), `${id} is in the table`);
  }
  const composerRows = list().filter((s) => s.scope === "composer");
  assert.ok(composerRows.length >= 3 && composerRows.every((s) => !s.rebindable), "the Composer rows are display-only");
  assert.ok(!ids.includes("composer-stop"), "Esc is not a stop: the Stop button is the only stop");
  assert.equal(comboLabel("Ctrl+Shift+P"), "Ctrl+Shift+P");
  assert.equal(comboLabel("Ctrl+K", true), "⌘K");
  assert.equal(comboLabel("Ctrl+Shift+P", true), "⌘⇧P");
  // The recorder reads a keydown as a combo: bare modifiers name nothing.
  /** @param {Partial<KeyboardEvent>} o */
  const ev = (o) => /** @type {KeyboardEvent} */ ({ repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: "", ...o });
  assert.equal(comboFromEvent(ev({ key: "Shift" })), "");
  assert.equal(comboFromEvent(ev({ key: "0", code: "Digit0", ctrlKey: true })), "Ctrl+0");
  assert.equal(comboFromEvent(ev({ key: "=", code: "Equal", ctrlKey: true })), "Ctrl+=");
  assert.equal(comboFromEvent(ev({ key: "-", code: "Minus", ctrlKey: true })), "Ctrl+-");
  assert.equal(comboFromEvent(ev({ key: "Enter" })), "Enter");
  assert.equal(comboFromEvent(ev({ key: "Escape", code: "Escape" })), "Esc");
});

// (fails before: yes — the owner's settings cleanup of 11-09: New Chat's Ctrl+N and Open Thought Levels' Ctrl+T were the
// defaults in a browser tab, which keeps both for itself, and the recorder refused them as reserved)
test("the shortcut defaults: none a browser tab keeps for itself; the desktop app keeps Ctrl+N and Ctrl+T", async () => {
  const g = /** @type {any} */ (globalThis);
  const was = Object.getOwnPropertyDescriptor(g, "navigator");
  const at = async (/** @type {string} */ agent, /** @type {string} */ tag) => {
    Object.defineProperty(g, "navigator", { value: { userAgent: agent }, configurable: true, writable: true });
    return /** @type {typeof import("../src/ui/harness/shortcuts.js")} */ (await import(`../src/ui/harness/shortcuts.js?${tag}`));
  };
  try {
    const tab = await at("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36", "tab");
    assert.deepEqual(tab.list().filter((s) => tab.isReserved(s.default)).map((s) => s.id), [], "no default the tab keeps");
    assert.equal(tab.comboOf("new-task"), "Ctrl+Shift+O");
    assert.equal(tab.comboOf("effort"), "Alt+T");
    assert.deepEqual(tab.list().filter((s) => s.rebindable && s.combo && tab.conflicts(s.combo, s.id).length).map((s) => s.id), [], "no two share a key");
    const app = await at("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Filament/1.0 Chrome/141.0 Electron/38.2.0 Safari/537.36", "app");
    assert.equal(app.comboOf("new-task"), "Ctrl+N", "the app's page gets Ctrl+N");
    assert.equal(app.comboOf("effort"), "Ctrl+T");
  } finally {
    if (was) Object.defineProperty(g, "navigator", was);
    else delete g.navigator;
  }
  // The section's name in sentence case.
  assert.equal((await import("../src/ui/harness/settings/page.js")).SECTIONS.find((s) => s.id === "shortcuts")?.label, "Keyboard shortcuts");
});

test("auto-archive: only unpinned, unread-free, unarchived tasks older than the window", () => {
  const now = Date.parse("2026-09-22T12:00:00Z");
  const sessions = [
    { when: "2026-08-01", pinned: false, unread: false, archived: false },
    { when: "2026-08-01", pinned: true, unread: false, archived: false },
    { when: "2026-08-01", pinned: false, unread: true, archived: false },
    { when: "2026-08-01", pinned: false, unread: false, archived: true },
    { when: "2026-09-20", pinned: false, unread: false, archived: false },
    { when: "", pinned: false, unread: false, archived: false },
    { pinned: false, unread: false, archived: false },
  ];
  // 30 days from 2026-09-22: only the first row (updated 2026-08-01) is older than the window.
  assert.deepEqual(autoArchiveCandidates(sessions, 30, now), [0]);
  assert.deepEqual(autoArchiveCandidates(sessions, 7, now), [0], "a 7-day window keeps the 2026-09-20 row (it is young)");
  assert.deepEqual(autoArchiveCandidates(sessions, 1, now), [0, 4], "a 1-day window takes the 2026-09-20 row too");
});

// (fails before: yes — the bug hunt of 10-30, UIST-3 and UIST-11: the sweep read the newest 200 chats alone, so an old chat past them was never archived, and a chat it could not archive, or a list it could not read, passed in silence)
test("auto-archive's sweep: every page of the list read, each old chat archived, and what failed said", async () => {
  const g = /** @type {any} */ (globalThis);
  const hadStore = "localStorage" in g;
  const prevStore = g.localStorage;
  g.localStorage = { getItem: (/** @type {string} */ k) => (k === "filament.harness.autoArchive" ? "7" : null), setItem() {}, removeItem() {} };
  try {
    const now = Date.parse("2026-10-30T12:00:00Z");
    // 450 chats, newest first: 300 of this week, then 150 a month old — past the first page.
    const chats = Array.from({ length: 450 }, (_, i) => ({ id: `c${i}`, when: i < 300 ? "2026-10-29" : "2026-09-20", pinned: false, unread: false, archived: false }));
    /** @type {string[]} */
    const reads = [];
    /** @type {string[]} */
    const archived = [];
    const api = async (/** @type {string} */ path) => {
      if (path.startsWith("/memory/sessions?")) {
        reads.push(path);
        const q = new URLSearchParams(path.slice(path.indexOf("?") + 1));
        const offset = Number(q.get("offset") || 0);
        return { sessions: chats.slice(offset, offset + Number(q.get("limit") || 20)) };
      }
      const chat = /^\/sessions\/([^/]+)\/settings$/.exec(path);
      if (!chat) throw new Error(`unscripted ${path}`);
      if (chat[1] === "c449") throw new Error("the archive is refused: its secret.key does not read");
      archived.push(chat[1]);
      return { ok: true };
    };
    /** @type {[string, string | undefined][]} */
    const toasts = [];
    const cb = { onToast: (/** @type {string} */ m, /** @type {string | undefined} */ kind) => void toasts.push([m, kind]) };
    await autoArchiveSweep(cb, { api, now: () => now });
    assert.deepEqual(reads, ["/memory/sessions?limit=200&offset=0", "/memory/sessions?limit=200&offset=200", "/memory/sessions?limit=200&offset=400"], "page after page, until one comes back short");
    assert.equal(archived.length, 149);
    assert.deepEqual([archived[0], archived.at(-1)], ["c300", "c448"], "the old chats past the first page");
    assert.deepEqual(toasts, [["Auto-archived 149 old chats; 1 more could not be: the archive is refused: its secret.key does not read", "err"]]);
    // A list that cannot be read is said as well, at the next sweep a minute on.
    toasts.length = 0;
    await autoArchiveSweep(cb, { api: async () => { throw new Error("Filament is restarting"); }, now: () => now + 61_000 });
    assert.deepEqual(toasts, [["Auto-archive could not read your chats: Filament is restarting", "err"]]);
    await autoArchiveSweep(cb, { api, now: () => now + 62_000 });
    assert.equal(toasts.length, 1, "at most one sweep a minute");
  } finally {
    if (hadStore) g.localStorage = prevStore;
    else delete g.localStorage;
  }
});

// (fails before: yes — the owner's settings cleanup of 11-09: the sweep ran only while Settings was drawn, so one who
// picked "after 7 days" and never opened Settings again had nothing archived)
test("auto-archive sweeps as the app starts and once an hour after, with Settings never opened", async () => {
  const g = /** @type {any} */ (globalThis);
  const was = { store: g.localStorage, doc: g.document, every: g.setInterval };
  g.localStorage = { getItem: (/** @type {string} */ k) => (k === "filament.harness.autoArchive" ? "7" : null), setItem() {}, removeItem() {} };
  // A page with no Settings drawn on it.
  g.document = { querySelector: () => null };
  /** @type {(() => void)[]} */
  const ticks = [];
  g.setInterval = (/** @type {() => void} */ fn, /** @type {number} */ ms) => (assert.equal(ms, 3600_000), ticks.push(fn), ticks.length);
  try {
    let now = Date.parse("2026-11-09T12:00:00Z");
    /** @type {any[]} */
    let chats = [{ id: "old", when: "2026-10-01", pinned: false, unread: false, archived: false }];
    /** @type {string[]} */
    const archived = [];
    const api = async (/** @type {string} */ path) => {
      if (path.startsWith("/memory/sessions?")) return { sessions: chats };
      const chat = /^\/sessions\/([^/]+)\/settings$/.exec(path);
      if (!chat) throw new Error(`unscripted ${path}`);
      archived.push(chat[1]);
      chats = chats.map((c) => (c.id === chat[1] ? { ...c, archived: true } : c));
      return { ok: true };
    };
    /** @type {string[]} */
    const toasts = [];
    const stop = startHourlySweep({ onToast: (/** @type {string} */ m) => void toasts.push(m) }, { api, now: () => now });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(archived, ["old"], "the sweep at the start");
    assert.deepEqual(toasts, ["Auto-archived 1 old chat"]);
    // A chat that grows old while the app stays open goes at the next hour's sweep.
    chats.push({ id: "aged", when: "2026-11-01", pinned: false, unread: false, archived: false });
    now += 3600_000;
    assert.equal(ticks.length, 1, "one hourly timer");
    ticks[0]();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(archived, ["old", "aged"], "the hour's sweep, Settings never drawn");
    stop();
    // The app starts it, and Settings drives it no more.
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app.slice(app.indexOf("async function boot()")), /startHourlySweep\(\{ onToast: toast \}\)/);
    assert.doesNotMatch(readFileSync(new URL("../src/ui/harness/settings/page.js", import.meta.url), "utf8"), /autoArchiveSweep|startHourlySweep\(/);
  } finally {
    for (const [k, v] of /** @type {[string, any][]} */ ([["localStorage", was.store], ["document", was.doc], ["setInterval", was.every]])) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
  }
});

test("a sweep's words: the count, how many could not be archived and the first one's why; nothing for nothing", () => {
  assert.equal(sweepWords(0, []), null);
  assert.deepEqual(sweepWords(1, []), { text: "Auto-archived 1 old chat", kind: "" });
  assert.deepEqual(sweepWords(3, ["refused"]), { text: "Auto-archived 3 old chats; 1 more could not be: refused", kind: "err" });
  assert.deepEqual(sweepWords(0, ["refused", "gone"]), { text: "Auto-archive could not archive 2 old chats: refused", kind: "err" });
});

test("the group toggles turn a family's grouping off; the usage range filters by day", () => {
  const tools = [
    { name: "read", state: "done" },
    { name: "grep", state: "done" },
    { name: "bash", state: "done" },
    { name: "bash", state: "done" },
  ];
  assert.deepEqual(groupRuns(tools, { explore: false, terminal: true, changes: true }), [
    { start: 2, length: 2, family: "terminal" },
  ], "explore off: the reads stay rows, the terminal still groups");
  assert.deepEqual(groupRuns(tools), [
    { start: 0, length: 2, family: "explore" },
    { start: 2, length: 2, family: "terminal" },
  ], "no toggles (the old signature) groups every family");
  const now = Date.parse("2026-09-22T12:00:00Z");
  const days = [{ day: "2026-09-01" }, { day: "2026-09-16" }, { day: "2026-09-21" }, { day: "2026-09-22" }];
  assert.deepEqual(daysInRange(days, 7, now).map((d) => d.day), ["2026-09-16", "2026-09-21", "2026-09-22"], "the 7-day window keeps 7 calendar days (the 16th is day one)");
  assert.deepEqual(daysInRange(days, 0, now), days, "all time keeps everything");
});

// --- ux-3 history-as-turns: the server's transcript as turns, joined to the session's records by request id ----
import { transcriptTurns, placeBoundaries, placeBoundary } from "../src/ui/harness/conversation/history.js";
import { turnsRead, heldTranscript } from "./helpers/held-transcript.js";

test("transcriptTurns: a turn's user text, its work's texts and thinking, its tool calls, its final answer; the join by request id", () => {
  const tr = {
    turns: [
      {
        // `run`: the server keeps a run for the turn's last request (HarnessV3-Launch LD-D13); a row without it has none.
        n: 4, turnId: 44, startedAt: 1000, endedAt: 8000, requestIds: ["r4"], open: false, run: true,
        user: { role: "user", content: [{ type: "text", text: "read the note" }] },
        work: [
          { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: "t1", name: "read", input: { path: "a" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "the note" }] },
        ],
        final: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "Done." }] },
        shape: "fold", settingsHash: "h1",
        // The row carries the turn's facts and a command's card (Facade D2/D4); the page reads them and never
        // re-derives the numbers from records.
        facts: { v: 1, requests: 1, calls: 2, model: "claude-sonnet-4-5", upstream: "m", tokens: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 }, held: 100, costUsd: 0.001, startedAt: 1000, endedAt: 8000, stopReason: "end_turn", memory: {}, view: {}, context: {} },
        card: { kind: "settings-change", v: 1, changes: [{ path: "p", from: 1, to: 2, fromSource: "session", toSource: "session" }] },
      },
      { n: 5, turnId: 45, startedAt: 9000, endedAt: null, requestIds: ["r5"], open: true, user: { role: "user", content: "and now?" }, work: [], final: null, shape: null, settingsHash: "h2" },
    ],
    boundaries: [{ type: "settings", beforeTurn: 5, from: "h1", to: "h2" }],
  };
  // The transcript comes with each turn's work held back: until the work is read the turn is its answer, headed
  // by the archive's counts.
  const held = transcriptTurns(heldTranscript(tr));
  assert.deepEqual(held[0].blocks.map((b) => b.type), ["thinking", "text"]);
  assert.deepEqual([held[0].toolLegs, held[0].toolCalls, held[0].held?.total, held[0].held?.next, held[1].held], [1, 1, 2, 0, null]);
  const turns = turnsRead(tr);
  assert.equal(turns[0].held?.next, null, "all of its work is read");
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((t) => t.n), [4, 5]);
  assert.equal(turns[0].userText, "read the note");
  assert.deepEqual(turns[0].userContent, [{ type: "text", text: "read the note" }]);
  assert.equal(turns[0].toolCalls, 1);
  assert.equal(turns[0].toolLegs, 1, "one round of the tool loop: the call and its result");
  // The work's text, the final's thinking, the final's text — in the order the client saw them.
  assert.deepEqual(turns[0].blocks.map((b) => b.type), ["text", "thinking", "text"]);
  assert.equal(turns[0].blocks[0].text, "Reading.");
  assert.equal(turns[0].blocks[2].text, "Done.");
  assert.equal(turns[0].history, true);
  assert.equal(turns[0].past, true);
  assert.equal(turns[0].status, "done");
  assert.equal(turns[0].requestId, "r4", "the turn's own last request id");
  assert.equal(turns[0].runId, "r4");
  assert.equal(turns[1].runId, null, "a row with no run names none, so the page never asks for one");
  assert.equal(turns[0].startedAt, 1000);
  assert.equal(turns[0].endedAt, 8000);
  assert.equal(turns[0].shape, "fold");
  assert.equal(turns[0].settingsHash, "h1");
  // The numbers and the card come with the row's facts (FB 2, fails before): no records join re-derives them.
  assert.equal(turns[0].facts.model, "claude-sonnet-4-5");
  assert.equal(turns[0].card.kind, "settings-change");
  assert.equal(turns[0].clientLabel, null);
  // An open turn (no final yet) is shown as such; its record is unknown here.
  assert.equal(turns[1].status, "open");
  assert.equal(turns[1].open, true);
  assert.equal(turns[1].userText, "and now?");
  assert.equal(turns[1].rec, null, "the records join is gone (Facade FB): the turn carries no record at all");
  assert.equal(turns[1].requestId, "r5", "the turn's own last request id");
  assert.deepEqual(turns[1].blocks, []);
  // The settings boundary sits before the first turn under the new document.
  assert.equal(turns[0].boundaries.length, 0);
  assert.deepEqual(turns[1].boundaries.map((b) => b.type), ["settings"]);
});

test("placeBoundaries: a compaction sits before the turn after it, or after the last turn when nothing follows yet", () => {
  /** @param {number} n @returns {{ n: number, boundaries: any[], boundariesAfter: any[] }} */
  const mk = (n) => ({ n, boundaries: [], boundariesAfter: [] });
  const a = [mk(1), mk(2), mk(3)];
  placeBoundaries(a, [{ type: "compaction", afterTurn: 2, fromTurn: 1, toTurn: 2 }, { type: "settings", beforeTurn: 3, from: "x", to: "y" }, { type: "settings", beforeTurn: 9, from: "x", to: "y" }]);
  assert.deepEqual(a[2].boundaries.map((b) => b.type), ["compaction", "settings"]);
  assert.equal(a[1].boundariesAfter.length, 0);
  const b = [mk(1), mk(2)];
  placeBoundaries(b, [{ type: "compaction", afterTurn: 2, fromTurn: 1, toTurn: 2 }]);
  assert.deepEqual(b[1].boundariesAfter.map((x) => x.type), ["compaction"]);
  const c = [mk(5)];
  placeBoundaries(c, [{ type: "compaction", afterTurn: 2, fromTurn: 1, toTurn: 2 }]);
  assert.equal(c[0].boundariesAfter.length, 1, "a compaction older than every turn shown lands after the last turn");
});

test("placeBoundary: a sub-agent mark the turns already hold is not placed twice (the bus announcing what a hydrate read)", () => {
  /** @param {number} n @returns {{ n: number, boundaries: any[], boundariesAfter: any[] }} */
  const mk = (n) => ({ n, boundaries: [], boundariesAfter: [] });
  const arrival = { type: "subagent", event: "arrival", agentId: "sa_1", exchange: 0, afterTurn: 1, delivery: "held" };
  const turns = [mk(1)];
  placeBoundaries(turns, [{ type: "subagent", event: "dispatch", agentId: "sa_1", exchange: 0, afterTurn: 1 }, arrival]);
  assert.equal(placeBoundary(turns, { ...arrival }), null, "the same mark again: nothing placed, nothing to redraw");
  turns.push(mk(2));
  assert.equal(placeBoundary(turns, { ...arrival }), null, "held after turn 1 while turn 2 has arrived since: still the same mark");
  assert.deepEqual(turns[0].boundariesAfter.map((b) => b.event), ["dispatch", "arrival"]);
  assert.equal(placeBoundary(turns, { ...arrival, exchange: 1 }), turns[1], "a follow-up's arrival is its own mark");
});

test("dry-run turn: a composed message reads as text — strings as they are, tool calls by name and input, results by size then text, thinking by size", async () => {
  const { dryRunText } = await import("../src/ui/lib/settings/knobs.js");
  assert.equal(dryRunText("plain"), "plain");
  assert.equal(dryRunText([{ type: "text", text: "Reading." }, { type: "tool_use", name: "read", input: { path: "a.txt" } }]), 'Reading.\n⚙ read({"path":"a.txt"})');
  assert.equal(dryRunText([{ type: "tool_result", tool_use_id: "t1", content: "the note" }]), "↳ tool_result · 8 chars\nthe note");
  assert.equal(dryRunText([{ type: "tool_result", is_error: true, content: [{ type: "text", text: "no such file" }, { type: "image" }] }]), "↳ tool_result (error) · 20 chars\nno such file\n[image]");
  assert.equal(dryRunText([{ type: "thinking", thinking: "hmm hmm" }, { type: "text", text: "Done." }]), "(thinking · 7 chars)\nDone.");
  assert.equal(dryRunText(null), "");
  assert.equal(dryRunText([{ type: "odd" }]), "[odd]");
  // The draft is cut to what fits the query string once URL-encoded — by bytes, not characters (CJK encodes 9:1).
  const { dryRunDraft } = await import("../src/ui/lib/settings/knobs.js");
  assert.equal(dryRunDraft("hi"), "hi"); assert.equal(dryRunDraft(""), "");
  const ascii = dryRunDraft("a".repeat(20000)); assert.ok(ascii.length < 20000 && encodeURIComponent(ascii).length <= 12000);
  const cjk = dryRunDraft("漢".repeat(4000)); assert.ok(cjk.length < 4000 && encodeURIComponent(cjk).length <= 12000, `cjk ${cjk.length} chars encode to ${encodeURIComponent(cjk).length}`);
  assert.equal(dryRunDraft("漢".repeat(1000)).length, 1000, "a draft that fits is kept whole");
});

test("inspector knobs: sections cover every knob once in §5's order; editors by type; values print; input parses or refuses in words", async () => {
  const { SECTIONS, HIDDEN_KNOBS, knobsOf, sectionLive, labelOf, editorFor, formatValue, parseInput, mapCells, ruleLine, hookLine, parseHookLine } = await import("../src/ui/lib/settings/knobs.js");
  const rules = await import("../src/app/agent/rules.js");
  const { KNOBS, BUILT_PHASE } = await import("../src/services/session-settings.js");
  const knobs = Object.fromEntries(Object.entries(KNOBS).map(([p, k]) => [p, { ...k, live: k.phase <= BUILT_PHASE }]));
  const seen = new Map();
  for (const s of SECTIONS) for (const p of knobsOf(s, knobs)) seen.set(p, (seen.get(p) || 0) + 1);
  assert.deepEqual([...seen.keys()].sort(), Object.keys(KNOBS).filter((p) => !HIDDEN_KNOBS.includes(p)).sort(), "every knob belongs to a section, but those no editor offers");
  // (fails before: yes — the owner's plan of 11-05: three places at most; a chat's agents' and teams' models were set in
  // its settings' editors too, Who runs this chat among them)
  assert.deepEqual([...HIDDEN_KNOBS], ["subagents.pool", "subagents.byCard", "subagents.byTeam", "engine.teamWorkers", "engine.teamEffort"]);
  assert.ok(HIDDEN_KNOBS.every((p) => p in KNOBS), "each a knob the session has");
  assert.ok([...seen.values()].every((n) => n === 1), "no knob in two sections");
  assert.deepEqual(SECTIONS.map((s) => s.id), ["model", "loop", "agents", "context", "memory", "instructions", "fork", "privacy", "display"]);
  const section = (id) => /** @type {any} */ (SECTIONS.find((s) => s.id === id));
  assert.equal(sectionLive(section("agents"), knobs), true, "agents landed in phase 5");
  assert.equal(sectionLive(section("instructions"), knobs), true);
  assert.equal(sectionLive(section("loop"), knobs), true);
  assert.equal(labelOf("context.compaction.model"), "compaction.model"); assert.equal(labelOf("hooks"), "hooks");
  assert.equal(editorFor("loop.tools", knobs["loop.tools"]), "tools");
  assert.equal(editorFor("memory.enabled", knobs["memory.enabled"]), "bool");
  assert.equal(editorFor("context.results", knobs["context.results"]), "enum");
  assert.equal(editorFor("loop.resultCapChars", knobs["loop.resultCapChars"]), "number");
  assert.equal(editorFor("memory.loads", knobs["memory.loads"]), "text-list");
  assert.equal(editorFor("instructions.files", knobs["instructions.files"]), "text-list");
  assert.equal(editorFor("plugins.mcp", knobs["plugins.mcp"]), "json");
  assert.equal(formatValue("loop.tools", knobs["loop.tools"], { bash: false, write: false }), "off: bash, write");
  assert.equal(formatValue("loop.tools", knobs["loop.tools"], {}), "all on");
  assert.equal(formatValue("memory.enabled", knobs["memory.enabled"], false), "off");
  assert.equal(formatValue("loop.resultCapChars", knobs["loop.resultCapChars"], null), "–");
  assert.equal(formatValue("model.maxTokens", knobs["model.maxTokens"], 16384), (16384).toLocaleString());
  assert.equal(formatValue("memory.loads", knobs["memory.loads"], []), "none");
  assert.equal(formatValue("hooks", knobs.hooks, [{ on: "turn-end", command: "npm test" }]), "turn-end npm test");
  assert.equal(formatValue("loop.rules", knobs["loop.rules"], [{ tool: "bash", pattern: "rm *", verdict: "deny" }, { tool: "write", pattern: "*.md", verdict: "allow", learned: true }]), "bash(rm *) deny; write(*.md) allow · learned");
  assert.equal(formatValue("loop.rules", knobs["loop.rules"], Array.from({ length: 5 }, (_, i) => ({ tool: "bash", pattern: `c${i}`, verdict: "ask" }))), "bash(c0) ask; bash(c1) ask; bash(c2) ask; +2 more");
  assert.equal(formatValue("plugins.mcp", knobs["plugins.mcp"], [{ name: "notes" }]), "1 item");
  // The rules are shown, never typed (HarnessV3-AtHome AH-D7), each printed as the server describes it; the hooks'
  // line editor (§5.6): one item per line, the short form round-trips, a bad line is refused in words.
  assert.equal(editorFor("loop.rules", knobs["loop.rules"]), "rules");
  assert.equal(editorFor("hooks", knobs.hooks), "hooks");
  for (const r of /** @type {const} */ ([{ tool: "bash", pattern: "rm *", verdict: "deny" }, { tool: "write", pattern: "*.md", verdict: "allow", learned: true }, { tool: "*", pattern: "anything", verdict: "ask" }]))
    assert.equal(ruleLine(r), rules.describeRule(r), "the page prints a rule as the server describes it");
  assert.deepEqual(parseInput("hooks", knobs.hooks, "post-tool(edit) npm test\nturn-end npm run typecheck timeout=120000\nsession-start git status", "hooks"), { value: [{ on: "post-tool", tool: "edit", command: "npm test" }, { on: "turn-end", command: "npm run typecheck", timeoutMs: 120000 }, { on: "session-start", command: "git status" }] });
  assert.deepEqual(parseInput("hooks", knobs.hooks, "turn-end(edit) npm test", "hooks"), { error: "turn-end hooks take no tool" });
  assert.deepEqual(parseInput("hooks", knobs.hooks, "pre-tool npm test timeout=5", "hooks"), { error: "timeout= must be 100 to 600000 milliseconds" });
  assert.match(String(/** @type {any} */ (parseInput("hooks", knobs.hooks, "sometimes npm test", "hooks")).error), /^"sometimes npm test" is not a hook: write on\(tool\) command/);
  for (const k of [{ on: "post-tool", tool: "edit", command: "npm test" }, { on: "turn-end", command: "npm run typecheck", timeoutMs: 120000 }]) assert.deepEqual(parseHookLine(hookLine(k)), { value: k }, "hook lines round-trip");
  assert.deepEqual(parseInput("loop.resultCapChars", knobs["loop.resultCapChars"], " 12 ", "number"), { value: 12 });
  assert.deepEqual(parseInput("loop.resultCapChars", knobs["loop.resultCapChars"], "1.5", "number"), { error: "Result cap characters must be a whole number" }); // in words since HarnessV3-Launch LD-D10
  assert.deepEqual(parseInput("memory.minScore", knobs["memory.minScore"], " 0.35 ", "number"), { value: 0.35 });
  assert.deepEqual(parseInput("loop.resultCapChars", knobs["loop.resultCapChars"], "", "number"), { unset: true });
  assert.deepEqual(parseInput("memory.loads", knobs["memory.loads"], "a, b ,,c", "text-list"), { value: ["a", "b", "c"] });
  assert.deepEqual(parseInput("plugins.mcp", knobs["plugins.mcp"], "[{\"name\":\"notes\"}]", "json"), { value: [{ name: "notes" }] });
  assert.deepEqual(parseInput("plugins.mcp", knobs["plugins.mcp"], "{}", "json"), { error: "MCP must be a JSON list" });
  assert.deepEqual(parseInput("plugins.mcp", knobs["plugins.mcp"], "{nope", "json"), { error: "MCP is not valid JSON" });
  // The context map: cells in turn order, widths by tokens with a floor, the head's turns hatched, the boundary marked.
  const cells = mapCells({ current: { perTurn: [{ n: 3, shape: "fold", tokens: 100 }, { n: 4, shape: "raw", tokens: 900 }], head: { fromTurn: 1, toTurn: 2 }, underSummary: 2 } });
  assert.deepEqual(cells.map((c) => [c.n, c.shape, c.under, c.boundaryBefore]), [[1, "compacted", true, false], [2, "compacted", true, false], [3, "fold", false, true], [4, "raw", false, false]]);
  assert.ok(Math.abs(cells.reduce((n, c) => n + c.pct, 0) - 100) < 1e-6, "widths sum to 100%");
  assert.ok(cells[3].pct > cells[2].pct * 5, "width follows tokens");
  assert.ok(cells[0].pct > 0, "a turn under the summary keeps a visible sliver");
  assert.deepEqual(mapCells({ current: { perTurn: [] } }), []);
  assert.deepEqual(mapCells(null), []);
});

// (fails before: yes — a failed turn read "no reply was recorded" after a reload: its failure's words were lost)
test("transcriptTurns: a turn with no reply whose newest request failed is drawn failed, its words the banner's", () => {
  const row = (/** @type {number} */ n, /** @type {any} */ facts) => ({ n, turnId: n, requestIds: [`r${n}`], user: { role: "user", content: "go" }, work: [], final: null, open: true, facts });
  const answered = { ...row(3, { error: "an earlier leg's" }), final: { role: "assistant", content: [{ type: "text", text: "ok" }] }, open: false };
  const [failed, open, done] = transcriptTurns({ turns: [row(1, { error: "Internal error: API Error: overloaded" }), row(2, { error: null }), answered] });
  assert.deepEqual([failed.status, failed.error], ["error", "Internal error: API Error: overloaded"]);
  assert.deepEqual([open.status, open.error], ["open", undefined]);
  assert.deepEqual([done.status, done.error], ["done", undefined], "a turn with its reply recorded is answered");
});

test("transcriptTurns: tool legs are rounds of the loop (one per assistant work message that called tools), tool calls the calls in them", () => {
  const tr = {
    turns: [{
      n: 1, turnId: 1, startedAt: 1, endedAt: 9, requestIds: ["r1"], open: false,
      user: { role: "user", content: "fix it" },
      work: [
        { role: "assistant", content: [{ type: "tool_use", id: "a", name: "read", input: {} }, { type: "tool_use", id: "b", name: "read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "x" }, { type: "tool_result", tool_use_id: "b", content: "y" }] },
        { role: "assistant", content: [{ type: "text", text: "Now the edit." }, { type: "tool_use", id: "c", name: "edit", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c", content: "ok" }] },
        { role: "assistant", content: "thinking aloud, no tools" },
      ],
      final: { role: "assistant", content: "Fixed." },
    }, {
      // An OpenAI-shaped leg (tool_calls on the message) counts the same way, its calls included.
      n: 2, turnId: 2, startedAt: 10, endedAt: 12, requestIds: ["r2"], open: false,
      user: { role: "user", content: "and run it" },
      work: [{ role: "assistant", content: null, tool_calls: [{ id: "d", type: "function", function: { name: "bash", arguments: "{}" } }] }, { role: "tool", tool_call_id: "d", content: "ran" }],
      final: { role: "assistant", content: "Ran." },
    }, {
      // A provider-run call (server_tool_use) is a leg too — the archive files it as kind tool_use, so the pane counts it.
      n: 3, turnId: 3, startedAt: 13, endedAt: 15, requestIds: ["r3"], open: false,
      user: { role: "user", content: "search the web" },
      work: [{ role: "assistant", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } }] }, { role: "user", content: [{ type: "web_search_tool_result", tool_use_id: "s1", content: [] }] }],
      final: { role: "assistant", content: "Found it." },
    }],
  };
  // The archive's count of a turn's work (what heads the turn before its work is read) and the page's own count
  // of the work once read are one count.
  const counts = (/** @type {any[]} */ turns) => turns.map((t) => [t.toolLegs, t.toolCalls]);
  assert.deepEqual(counts(transcriptTurns(heldTranscript(tr))), [[2, 3], [1, 1], [1, 1]]);
  assert.deepEqual(counts(turnsRead(tr)), [[2, 3], [1, 1], [1, 1]]);
  // Work the archive never counted says nothing until it is read whole; then the page counts it.
  assert.deepEqual(counts(transcriptTurns(heldTranscript(tr, { counted: false }))), [[undefined, undefined], [undefined, undefined], [undefined, undefined]]);
  assert.deepEqual(counts(turnsRead(tr, "anthropic", { counted: false })), [[2, 3], [1, 1], [1, 1]]);
});

// (fails before: yes — a turn's texts across its work messages were one block, so after a reload a round's cards landed
// after all the turn's words, not after its own)
test("transcriptTurns: each message's words are a block of their own; two texts of one message are one", () => {
  const tr = {
    turns: [{
      n: 1, turnId: 1, startedAt: 1, endedAt: 9, requestIds: ["r1"], open: false,
      user: { role: "user", content: "fix it" },
      work: [
        { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "text", text: "Both files." }, { type: "tool_use", id: "a", name: "read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "x" }] },
        { role: "assistant", content: [{ type: "text", text: "Now the edit." }, { type: "tool_use", id: "c", name: "edit", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c", content: "ok" }] },
      ],
      final: { role: "assistant", content: [{ type: "text", text: "Fixed." }] },
    }],
  };
  const [turn] = turnsRead(tr);
  assert.deepEqual(turn.blocks.map((b) => [b.type, b.text]), [["text", "Reading.\n\nBoth files."], ["text", "Now the edit."], ["text", "Fixed."]]);
  // The work in the order it happened: each message's words, then the calls it made.
  assert.deepEqual(turn.held.parts.map((/** @type {any} */ p) => (p.block ? p.block.text : p.tools.map((/** @type {any} */ c) => `${c.name}:${c.result}`))), ["Reading.\n\nBoth files.", ["read:x"], "Now the edit.", ["edit:ok"]]);
});

// HarnessV3-Facade Phase FB (D3, D4, D5, D13): the page draws facts and cards. DOM-free — factsLine is pure,
// cardEl/memoryNoteEl take the `h` injectable, and the client-name table test greps the tree.

/** A fake h() that records what was built: { tag, attrs, kids } */
const fakeH = (tag, attrs = {}, ...kids) => ({ tag, attrs, kids });
/** Flatten the fake tree to find rows/buttons by class. */
const flattenEl = (el) => {
  const out = [];
  const walk = (node) => {
    if (node == null) return;
    if (typeof node !== "object") {
      out.push(node);
      return;
    }
    out.push(node);
    for (const k of node.kids || []) walk(k);
  };
  walk(el);
  return out;
};
const buttonsOf = (el) => flattenEl(el).filter((x) => x.tag === "button");
const textOfEl = (el) => flattenEl(el).filter((x) => typeof x === "string").join("|");

import { factsLine, sourceWords } from "../src/ui/harness/lib/labels.js";
import { cardEl, memoryNoteEl } from "../src/ui/harness/conversation/cards.js";
import { sourceWord } from "../src/app/commands/settings.js";
import { commandAnswer, footerEl } from "../src/ui/harness/conversation/turn.js";

test("factsLine: the segments in order, each only when the turn has it (FB 1)", () => {
  const zc = factsLine({
    v: 1, requests: 2, calls: 3, model: "claude-sonnet-4-5", upstream: "m",
    tokens: { input: 4340, output: 120, cacheRead: 43870, cacheWrite: 1200 }, held: 48210,
    costUsd: 0.042, startedAt: 1000, endedAt: 39000, stopReason: "end_turn",
    memory: { injected: 3, tokens: 900, briefing: 1, related: null },
    view: { form: "plain", savedTokens: 41000, foldedTurns: 2 },
    context: { window: 200000, usable: 180000, verdict: "fits", source: "provider" },
  });
  assert.deepEqual(zc.map((s) => s.id), ["model", "sent", "cost", "time", "memory", "view", "fit", "stop"]);
  assert.equal(zc[1].text, "sent 48,210 (cache 91%)", `"sent" is the prompt as the provider counted it (held), not the fresh tokens`);
  assert.equal(zc[1].title.includes("48,210 tokens went out"), true);
  assert.equal(zc[2].text, "$0.042");
  assert.equal(zc[3].text, "38 s");
  assert.equal(zc[4].text, "memory 3");
  assert.equal(zc[5].text, "2 folded −41,000");
  assert.equal(zc[6].text, "fits");
  assert.ok(zc.every((s) => s.title), "every segment carries its tooltip");
  const agent = factsLine({ model: "x", tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: "end_turn", costUsd: null });
  assert.deepEqual(agent.map((s) => s.id), ["model", "stop"], "nothing for a turn that has only a model and a stop reason");
  assert.deepEqual(factsLine(null), [], "a turn without facts draws no line");
  const over = factsLine({ model: "m", tokens: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 }, context: { window: 200000, usable: 180000, verdict: "over", source: "provider" } });
  assert.equal(over.find((s) => s.id === "fit")?.tone, "warn", "an over-the-window verdict warns");
  // (fails before: yes — the footer printed the server's one word: a turn that ended past its line showed "edge" in
  // amber under its reply, in the live drive of 2026-10-11)
  const fitOf = (/** @type {string} */ verdict) => factsLine({ model: "m", tokens: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 }, context: { window: 200000, usable: 90000, verdict, source: "operator" } }).find((s) => s.id === "fit");
  assert.deepEqual(["tight", "edge", "over"].map((v) => fitOf(v)?.text), ["near the compaction line", "past the compaction line", "over the window"], "a warning under a reply is said in words");
  assert.deepEqual(["tight", "edge", "over"].map((v) => fitOf(v)?.tone), ["warn", "warn", "warn"]);
  assert.equal(fitOf("edge")?.title, "the turn's request was past the compaction line (compacts at 90,000) — window 200,000, from its upstream's model card");
  assert.equal(fitOf("fits")?.title, "the turn's request fits (compacts at 90,000) — window 200,000, from its upstream's model card");
  assert.ok(!/\b(edge|tight)\b/.test(`${fitOf("edge")?.title} ${fitOf("tight")?.title}`), "nor does the hint say the server's word");
});

test("factsLine: the warnings ride after the facts (FB 1)", () => {
  const cut = factsLine({ model: "m", tokens: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: "max_tokens", failovers: 1, errors: 0 });
  assert.deepEqual(cut.slice(-2).map((s) => s.id), ["cut", "failover"]);
  assert.equal(cut.at(-2)?.tone, "warn");
  const err = factsLine({ model: "m", tokens: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 }, errors: 2, error: "overloaded" });
  assert.equal(err.at(-1)?.id, "errors");
  assert.equal(err.at(-1)?.tone, "err");
});

// (fails before: yes — AC3's drive, run 3: Continue on the agent's other account answered, and under the answer the
// turn said "an error occurred in this turn" in red: the try its spent account failed, which the archive keeps as the
// same turn's)
test("factsLine: a turn answered after a failed request warns as a failover does; one whose newest request failed is an error", () => {
  const facts = { model: "m", tokens: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 } };
  assert.deepEqual(factsLine({ ...facts, errors: 1 }).at(-1), { id: "errors", text: "↻ answered after a failed request", title: "1 of the turn's requests ended in an error before one answered", tone: "warn" });
  assert.equal(factsLine({ ...facts, errors: 3 }).at(-1)?.text, "↻ answered after 3 failed requests");
  assert.deepEqual(factsLine({ ...facts, errors: 1, error: "You've hit your 5-hour limit" }).at(-1), { id: "errors", text: "an error occurred in this turn", title: "1 of the turn's requests ended in an error", tone: "err" });
});

// (fails before: yes — a failed turn's footer said its failure twice more: the flag in its whole words, and "an error
// occurred in this turn")
test("footerEl: a failed turn is flagged once, \"failed\", its words on hover; one that ended well after a failure says so", () => {
  const doc = stubDocument();
  try {
    const cb = { onCopy() {}, onFork() {}, onRetry() {}, onWatchRun() {} };
    const facts = { model: "m", tokens: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 }, errors: 1 };
    const flags = (/** @type {any} */ turn) => /** @type {any} */ (footerEl(turn, cb)).querySelectorAll(".a-flag").map((/** @type {any} */ f) => [f.textContent, f.getAttribute("title")]);
    assert.deepEqual(flags({ n: 1, status: "error", error: "Internal error: API Error: overloaded", facts }), [["failed", "Internal error: API Error: overloaded"]]);
    assert.deepEqual(flags({ n: 1, status: "done", facts }), [["↻ answered after a failed request", "1 of the turn's requests ended in an error before one answered"]]);
    // (fails before: yes — a message stopped to ask how to make room was flagged "failed", in red, under its question;
    // then, the owner's report of 10-17, "not sent" in yellow, which read as a failure too: HarnessV4_Tasks U11)
    const asked = /** @type {any} */ (footerEl({ n: 0, status: "error", error: "past the line" }, cb, "waits for room")).querySelectorAll(".a-flag");
    assert.deepEqual(asked.map((/** @type {any} */ f) => [f.textContent, f.classList.contains("ask"), f.classList.contains("warn"), f.classList.contains("err")]), [["waits for room", true, false, false]]);
  } finally {
    doc.restore();
  }
});

test("cardEl: each kind draws from its data; a button yields its command; an unknown kind is null (FB 3)", () => {
  const change = cardEl({
    kind: "settings-change", v: 1,
    changes: [{ path: "context.view.stubChars", from: 160, to: 200, fromSource: "global", toSource: "session" }],
    actions: [{ label: "Undo", command: "/unset context.view.stubChars" }],
  }, {}, { h: fakeH });
  assert.ok(change, "the change card draws");
  assert.ok(textOfEl(change).includes("was your global settings"), textOfEl(change));
  assert.ok(textOfEl(change).includes("now this session"));
  const undo = buttonsOf(change)[0];
  assert.equal(undo.attrs.class, "ghost sm");
  /** @type {any[]} */
  const sent = [];
  cardEl({
    kind: "settings-change", v: 1,
    changes: [{ path: "p", from: 1, to: 2, fromSource: "session", toSource: "session" }],
    actions: [{ label: "Undo", command: "/unset p" }],
  }, { onCommand: (c) => sent.push(c) }, { h: fakeH });
  // The action's onclick yields the command to the callback.
  const withCb = cardEl({
    kind: "settings-change", v: 1,
    changes: [{ path: "p", from: 1, to: 2, fromSource: "session", toSource: "session" }],
    actions: [{ label: "Undo", command: "/unset p" }],
  }, { onCommand: (c) => sent.push(c) }, { h: fakeH });
  buttonsOf(withCb)[0].attrs.onclick();
  assert.deepEqual(sent, ["/unset p"], "the button sends its command as chat text");

  const list = cardEl({
    kind: "settings-list", v: 1, title: "Settings in force",
    rows: [
      { path: "loop.permissions", value: "ask", valueText: "ask", source: "session", sourceText: "this session", reach: "filament", isDefault: false },
      { path: "model.name", value: "m", valueText: "m", source: "default", sourceText: "the built-in default", reach: "filament", isDefault: true },
    ],
  }, {}, { h: fakeH });
  assert.ok(list, "the list card draws");
  const resets = buttonsOf(list).filter((b) => b.kids.at(-1) === "Reset");
  assert.equal(resets.length, 1, "only a session-set row gets Reset");

  // (the owner's of 11-07: there are no presets) A preset list kept from before is drawn as its text.
  assert.equal(cardEl({ kind: "preset-list", v: 1, title: "Presets", presets: [{ name: "balanced", line: "fold but the last turn", shipped: true }] }, {}, { h: fakeH }), null);

  const goal = cardEl({ kind: "goal", v: 1, state: "proposed", title: "Goal proposed", text: "x", estimate: { sizeClass: "days", achievableSlice: "s", assumptions: [], firstStep: "f" }, actions: [{ label: "Accept", command: "/goal accept" }] }, {}, { h: fakeH });
  assert.ok(goal, "the goal card draws");
  assert.equal(buttonsOf(goal)[0].kids.at(-1), "Accept");

  assert.equal(cardEl({ kind: "chart", v: 1 }, {}, { h: fakeH }), null, "a kind the page doesn't know falls back to the text");
  assert.equal(cardEl(null), null);
});

// (fails before: yes — the owner's word of 10-27: "i don't know the purpose of it … not sure what does that memory
// contain at all": it said "Memory found 1 earlier session here:", a title and Load, in a pink band)
test("the memory note is one quiet line saying what memory told the agent, opening to each chat's date and summary and the memories' words (FB 5)", async () => {
  // A fake element that can be refilled, as the note's memories are once read.
  const fillH = (/** @type {any[]} */ ...a) => {
    const el = /** @type {any} */ (fakeH(...a));
    el.replaceChildren = (/** @type {any[]} */ ...k) => { el.kids = k; };
    return el;
  };
  /** @type {number} */
  let reads = 0;
  const note = memoryNoteEl({ items: 2, told: 3, sessions: [{ id: "s1", title: "Refactor auth", date: "2026-10-25" }, { id: "s2", title: "Fix CI" }] }, {
    chatOf: (id) => (id === "s1" ? { state: "Moved the token check into the gateway." } : null),
    told: async () => (reads++, ["Tests run with node --test.", "Never push.", "Answer from the code."]),
  }, { h: fillH });
  assert.ok(note);
  assert.equal(note.tag, "details", "closed until the person opens it");
  assert.equal(note.kids[0].tag, "summary");
  assert.equal(textOfEl(note.kids[0]), "Memory briefed the agent: your 2 latest chats here, 3 memories");
  const text = textOfEl(note);
  for (const w of ["Refactor auth", " · 2026-10-25", "Moved the token check into the gateway.", "Fix CI"]) assert.ok(text.includes(w), `${w} in ${text}`);
  assert.ok(!/found|Load\b/.test(text), "no search's words, no bare Load: " + text);
  assert.equal(reads, 0, "the memories' words are read when it opens, not before");
  note.attrs.ontoggle({ target: { open: true } });
  await new Promise((r) => setImmediate(r));
  note.attrs.ontoggle({ target: { open: true } });
  assert.equal(reads, 1, "once");
  for (const w of ["Tests run with node --test.", "Never push.", "Answer from the code."]) assert.ok(textOfEl(note).includes(w), `${w} once opened`);
  assert.equal(textOfEl(memoryNoteEl({ sessions: [{ id: "s1", title: "Auth" }] }, {}, { h: fakeH }).kids[0]), "Memory briefed the agent: your latest chat here");
  const bare = memoryNoteEl({ items: 1 }, {}, { h: fakeH });
  assert.equal(bare.tag, "div", "nothing to open, a line alone");
  assert.equal(textOfEl(bare), "Memory briefed the agent: 1 memory");
  const loads = buttonsOf(note).filter((b) => b.kids.at(-1) === "Add to next message");
  assert.equal(loads.length, 2);
  /** @type {any[]} */
  const sent = [];
  // (fails before: yes — the bug hunt of 10-27: the press sent `@mem load`, which a running turn took as a note to its
  // agent) The press puts the line in the box: nothing is sent.
  const note2 = memoryNoteEl({ sessions: [{ id: "s1", title: "Auth" }] }, { addLine: (c) => sent.push(c) }, { h: fakeH });
  buttonsOf(note2)[0].attrs.onclick();
  assert.deepEqual(sent, ["@mem load s1"]);
  assert.match(buttonsOf(note2)[0].attrs.title, /at the top of your message/);
  // (fails before: yes) The chats it continues are named first; an untitled one by the page's own list, as the sidebar
  // names it — the record carries no first words.
  const arc = memoryNoteEl({ told: 2, sessions: [{ id: "p1", title: "", continues: true }, { id: "s2", title: "Billing" }] },
    { chatOf: (id) => (id === "p1" ? { title: null, preview: "rename the tables" } : null) }, { h: fakeH });
  assert.equal(textOfEl(arc.kids[0]), "Memory briefed the agent: the chat this continues, your latest chat here, 2 memories");
  assert.ok(textOfEl(arc).includes("rename the tables"), textOfEl(arc));
  assert.ok(textOfEl(memoryNoteEl({ sessions: [{ id: "p2", title: "" }] }, {}, { h: fakeH })).includes("an untitled chat"));
  assert.equal(memoryNoteEl(null), null);
  assert.equal(memoryNoteEl({ sessions: [] }), null, "nothing to show, nothing drawn");
});

test("no client table in the harness page: no harness file maps a client id to words (FB 6, fails before: waiting.js held the table)", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const walk = (dir) => {
    const out = [];
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = dir + "/" + f.name;
      if (f.isDirectory()) out.push(...walk(p));
      else if (f.name.endsWith(".js")) out.push(p);
    }
    return out;
  };
  // The harness page (the dashboard's setup templates are another thing — D12 keeps every dashboard screen as it is).
  const files = walk("src/ui/harness");
  // The name table's signature: an id key whose value is the words for a person ("harness": "the harness", ...).
  const named = files.filter((f) => /(["]?(?:harness|claude-code|cursor|opencode|codex)["]?)\s*:\s*["'](the harness|Claude Code|Cursor|OpenCode|Codex)["']/.test(readFileSync(f, "utf8")));
  assert.deepEqual(named, [], `no harness file holds the client-name table; found in: ${named.join(", ")}`);
});

test("sourceWords' layer words equal the server's sourceWord for every layer (D6's pin)", () => {
  for (const layer of ["session", "project", "global", "default"]) {
    assert.equal(sourceWords(layer), sourceWord(layer), layer);
  }
  assert.equal(sourceWords("preset"), "the applied preset");
  assert.equal(sourceWords("preset", "max"), "preset Max", "the card's preset names it (D6), in words (HarnessV3-Launch F14)");
});

test("a local answer with a drawn card paints the card, never the text; without one, the text (FB 4)", () => {
  const withCard = commandAnswer(
    "the raw answer text",
    { kind: "settings-change", v: 1, changes: [{ path: "p", from: 1, to: 2, fromSource: "session", toSource: "session" }] },
    {},
    { h: fakeH },
  );
  assert.ok(textOfEl(withCard).includes("Filament answered this"));
  assert.ok(textOfEl(withCard).includes("Setting changed"), "the card draws inside the shim answer");
  assert.equal(textOfEl(withCard).includes("the raw answer text"), false, "the card carries the content; the raw text stays out");
  const noCard = commandAnswer("plain answer text", null, {}, { h: fakeH });
  const body = flattenEl(noCard).find((n) => typeof n === "object" && n?.attrs?.class === "shim-answer-text a-md");
  assert.ok(String(body?.innerHTML || "").includes("plain answer text"), "a failed record fetch (no card) paints the text");
});

// (fails before: yes — found by hand on HarnessV4_Tasks E15 step 2: a toast that had faded stayed in the corner at
// opacity 0 and took the click meant for Settings' Save under it)
test("a toast that has faded takes no click and is read by nobody; shown, it is there", () => {
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  const rule = (/** @type {string} */ sel) => (new RegExp(`\\n${sel.replace(/\./g, "\\.")} \\{([^}]*)\\}`).exec(css) || [])[1] || "";
  assert.match(rule(".toast"), /opacity: 0;[\s\S]*pointer-events: none; visibility: hidden;/);
  assert.match(rule(".toast.show"), /opacity: 1;[^}]*pointer-events: auto; visibility: visible;/);
});
