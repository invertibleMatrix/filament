// @ts-check
// HarnessV4_Artifacts_Plan E18 step 6: a Doc and a deck, the agent's Markdown drawn by Filament's own page on the
// artifact's address (AF-D11). What is pure is tested here — the Markdown Filament draws (AFC-106, AFC-109), a deck's
// slides (AFC-111), the page served and the page written whole for a download (AFC-118), what the address serves, and
// the tool's words for both types (AFC-106 to AFC-108, AFC-119, AFC-120); the pages themselves were driven in a
// browser (the Logs, step 6).
// (fails before: yes — Filament made pages alone: a doc or slides was refused as a type it does not make)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import {
  CONTENT_FILE,
  EDITABLE,
  MERMAID_GLOBAL,
  MERMAID_MODULE,
  OWN_UI,
  OWN_UI_FILES,
  TYPED,
  TYPE_MODULES,
  TYPE_STYLE,
  drawsDiagram,
  joinModules,
  mermaidInline,
  scriptText,
  servedPage,
  typeAlone,
  typeServed,
  typeShell,
} from "../src/core/artifacts.js";
import { VISUAL_HOSTS } from "../src/core/visual-look.js";
import { createArtifactStore } from "../src/services/artifacts.js";
import { createArtifactsHandler } from "../src/http/artifacts.js";
import { artifactView, downloadOf } from "../src/http/admin/artifacts.js";
import { ARTIFACT_GUIDE, ARTIFACT_TOOL, artifactCall } from "../src/app/agent/artifacts.js";
import { mdDoc } from "../src/ui/lib/md.js";
import { slideAt, splitSlides } from "../src/ui/artifacts/deck.js";
import * as markdownPage from "../src/ui/artifacts/markdown-page.js";
import * as harnessLib from "../src/ui/harness/lib/artifacts.js";
import { TILES } from "../src/ui/harness/artifacts-page.js";

/** A moment the words name: 2027-01-15 08:00 UTC. */
const NOW = Date.UTC(2027, 0, 15, 8, 0);
const UI = join(dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..", "src", "ui");
const uiText = (/** @type {string} */ p) => readFileSync(join(UI, ...p.split("/")), "utf8");

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
/** A store in a fresh data folder: the clock moves a minute a call; new names take the four letters given. */
const storeOf = (/** @type {string[]} */ fours = []) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-artifact-types-"));
  dirs.push(dir);
  let t = NOW;
  return createArtifactStore({ dataDir: dir, log: () => {}, now: () => (t += 60_000) - 60_000, four: () => fours.shift() || "zzzz" });
};
/** Where a call of the tool stands. @param {{ chain?: string }} [o] */
const atOf = ({ chain = "c1" } = {}) => ({ who: chain, by: { chain, model: "m-1", folder: "/p", helper: null }, within: [], port: 20300, maxBytes: 1_000_000 });
/** @param {any} store @param {any} input @param {{ chain?: string }} [o] @returns {any} */
const call = (store, input, o) => artifactCall(input, atOf(o), store);
const DOC = "# Release notes\n\n## What changed\n- Faster\n- [x] Shipped\n\n```mermaid\nflowchart LR\n  A --> B\n```\n";
const DECK = "# Q3 review\nJuly to September\n\n---\n\n## What shipped\n- One\n- Two\n";

describe("the Markdown a Doc and a deck are drawn from (AFC-106, AFC-109)", () => {
  // (fails before: yes — a fence lost its language, and ~~struck~~, pictures and task lists were not drawn)
  test("a fence keeps its language; struck words, task lists, pictures by a web or data address; HTML stays text", () => {
    assert.equal(mdDoc("```JS\nlet a = 1 < 2\n```", "h"), '<pre data-lang="js"><code>let a = 1 &lt; 2</code></pre>');
    assert.equal(mdDoc("```\nplain\n```", "h"), "<pre><code>plain</code></pre>", "no language, no mark");
    assert.equal(mdDoc("~~gone~~ and **bold**", "h"), "<p><s>gone</s> and <b>bold</b></p>");
    assert.equal(mdDoc("- [ ] write\n- [x] ship\n- plain", "h"),
      '<ul><li class="task"><input type="checkbox" disabled> write</li><li class="task"><input type="checkbox" disabled checked> ship</li><li>plain</li></ul>');
    // As the Doc's page draws them (`markdownHtml`): its own policy keeps its pictures to its library hosts.
    const page = { held: false };
    assert.equal(mdDoc("![a cat](https://cdnjs.cloudflare.com/x.png)", "h", page), '<p><img src="https://cdnjs.cloudflare.com/x.png" alt="a cat" loading="lazy"></p>');
    assert.equal(mdDoc("![x](data:image/png;base64,AAA)", "h", page), '<p><img src="data:image/png;base64,AAA" alt="x" loading="lazy"></p>');
    for (const bad of ["javascript:void", "data:text/html,hi", "/local.png", "x.png"]) assert.equal(mdDoc(`![x](${bad})`, "h", page), "<p>x</p>", bad);
    assert.equal(mdDoc('![a"b](https://h/x.png)', "h", page), '<p><img src="https://h/x.png" alt="a&quot;b" loading="lazy"></p>', "its words escaped");
    assert.equal(mdDoc("<img src=x onerror=alert(1)>", "h"), "<p>&lt;img src=x onerror=alert(1)&gt;</p>");
    assert.equal(mdDoc("# Risks\n\nSee [the risks](#risks).", "h"), '<h1 id="h-risks">Risks</h1>\n<p>See <a href="#h:risks" data-doc-link="h-risks">the risks</a>.</p>', "a heading's link finds it by its id");
  });

  // (fails before: yes — there were no slides)
  test("a deck's slides: between lines of --- alone, never inside a fence; with none, each # or ## heading starts one; settings at its top are no slide (AFC-111)", () => {
    const deck = "---\nmarp: true\ntheme: x\n---\n# Deck\nsub\n\n---\n\n## Two\n```\n---\n```\n---\n## Three";
    assert.deepEqual(splitSlides(deck), [
      { text: "# Deck\nsub", start: 28, title: true },
      { text: "## Two\n```\n---\n```", start: 45, title: false },
      { text: "## Three", start: 68, title: false },
    ]);
    assert.deepEqual(splitSlides("# A\nx\n## B\ny\n### c\n```\n# not\n```\n"), [
      { text: "# A\nx", start: 0, title: true },
      { text: "## B\ny\n### c\n```\n# not\n```", start: 6, title: false },
    ], "a ### heading, or a # in a fence, starts none");
    assert.deepEqual(splitSlides("---\n---\n\n"), [], "nothing to show is no slide");
    assert.deepEqual(splitSlides("Words alone").map((s) => s.title), [false]);
    assert.equal(splitSlides("a\r\n---\r\nb").length, 2, "Windows line ends");
    const slides = splitSlides(deck);
    assert.deepEqual([0, 27, 28, 44, 45, 67, 68, 999].map((at) => slideAt(slides, at)), [0, 0, 0, 0, 1, 1, 2, 2], "the slide a caret is in");
    assert.equal(slideAt([], 5), 0);
  });
});

describe("the page Filament draws them with (AF-D11, AFC-109, AFC-118)", () => {
  // (fails before: yes — the same)
  test("the Markdown goes in as data, never as HTML: nothing in it ends its script, and it reads back whole", () => {
    const md = "# A </script><script>alert(1)</script> <!-- x -->";
    const page = typeShell("doc", "A <b> & B", { markdown: md }, { head: "<HEAD>", body: "<BODY>" });
    assert.ok(page.startsWith('<!doctype html><html lang="en"><head><meta charset="utf-8">'));
    assert.match(page, /<title>A &lt;b&gt; &amp; B<\/title><HEAD><\/head><body class="filament-type filament-doc">/);
    const data = /** @type {RegExpExecArray} */ (/<script type="application\/json" id="filament-content">([\s\S]*?)<\/script><BODY><\/body><\/html>$/.exec(page));
    assert.ok(data, "the data, then Filament's code, closing the page");
    assert.ok(!data[1].includes("<"), "no < at all in the data");
    assert.deepEqual(JSON.parse(data[1]), { type: "doc", title: "A <b> & B", markdown: md });
    assert.deepEqual(typeServed("slides"), { head: `<link rel="stylesheet" href="${OWN_UI}${TYPE_STYLE}">`, body: `<script type="module" src="${OWN_UI}artifacts/slides.js"></script>` });
  });

  // (fails before: yes — the same)
  test("each type's modules, in their order, each importing only those before it; joined, one script with no name twice", () => {
    for (const [type, mods] of Object.entries(TYPE_MODULES)) {
      const texts = mods.map(uiText);
      mods.forEach((m, i) => {
        const lines = texts[i].split("\n").filter((l) => /^import\b/.test(l));
        for (const l of lines) {
          const from = /** @type {RegExpExecArray} */ (/from\s+"([^"]+)";$/.exec(l));
          assert.ok(from, `${m}: an import on a line of its own: ${l}`);
          assert.doesNotMatch(l, /\sas\s|\*/, `${m}: by its own names, which the joined script keeps`);
          assert.ok(mods.slice(0, i).includes(posix.join(posix.dirname(m), from[1])), `${type}: ${m} imports ${from[1]}, which comes before it`);
        }
      });
      const joined = joinModules(texts);
      assert.doesNotMatch(joined, /^(import|export)\s/m, type);
      assert.doesNotThrow(() => new vm.Script(joined), `${type}: one script, no name declared twice`);
      assert.doesNotMatch(joined, /<script|<\/script|<!--/i, `${type}: nothing in it the page's HTML would read`);
    }
    for (const f of OWN_UI_FILES) assert.ok(existsSync(join(UI, ...f.split("/"))), f);
    assert.deepEqual([...OWN_UI_FILES].sort(), [
      "artifacts/charts.js", "artifacts/dashboard.js", "artifacts/deck.js", "artifacts/design.js", "artifacts/doc.js", "artifacts/markdown-page.js",
      "artifacts/slides.js", "artifacts/type-page.js", "artifacts/types.css", MERMAID_MODULE, "lib/dom.js", "lib/md.js",
    ].sort());
  });

  // (fails before: yes — the same)
  test("the diagram library inside a page that opens alone: its one export kept on the page's window, and nothing in it ends its script", () => {
    const lib = uiText(MERMAID_MODULE);
    assert.doesNotMatch(lib, /<script|<\/script/i, "the vendored library, as a page's script");
    const inside = /** @type {string} */ (mermaidInline(lib));
    assert.ok(inside, "the library exports as one build does");
    assert.ok(inside.includes(`globalThis.${MERMAID_GLOBAL}=`));
    assert.doesNotMatch(inside, /export\s*\{[^}]*as\s+default/);
    assert.deepEqual([mermaidInline("x"), mermaidInline("export{a as default};export{b as default}")], [null, null]);
    assert.equal(mermaidInline("let q=1;export{q as default};"), `let q=1;globalThis.${MERMAID_GLOBAL}=q;`);
    assert.equal(scriptText("a</SCRIPT>b</script"), "a<\\/SCRIPT>b<\\/script");
    const own = typeAlone({ style: "p{}</style>", modules: ["const a = 1;"], mermaid: "M" });
    assert.deepEqual(own, { head: "<style>p{}<\\/style></style>", body: '<script type="module">M</script><script type="module">const a = 1;</script>' }, "the library first");
    assert.equal(typeAlone({ style: "", modules: ["x"], mermaid: null }).body, '<script type="module">x</script>');
    assert.deepEqual(["```mermaid\nA", "  ```Mermaid\n", "x\n```mermaid", "```js", "text ```mermaid"].map(drawsDiagram), [true, true, true, false, false]);
  });

  // (fails before: yes — the same)
  test("the page's copies of the server's words", () => {
    assert.equal(markdownPage.MERMAID_GLOBAL, MERMAID_GLOBAL);
    assert.deepEqual([...harnessLib.TYPED], [...TYPED]);
    assert.deepEqual([...harnessLib.EDITABLE], [...EDITABLE]);
    assert.deepEqual(TYPED.map(harnessLib.isTyped), [true, true, true, true]);
    assert.deepEqual(TYPED.map(harnessLib.isEditable), [true, true, false, false], "a Dashboard's and a Design's text is the agent's (AFC-144)");
    assert.deepEqual(["page", "", undefined].map(harnessLib.isTyped), [false, false, false]);
    assert.equal(harnessLib.lookName("dark", "full", true), "filament-look:dark:full:still", "a card's still preview (AFC-113)");
  });
});

describe("a Doc and a deck from the tool (AFC-106 to AFC-108, AFC-119, AFC-120)", () => {
  // (fails before: yes — Filament made these types: page)
  test("published by its Markdown alone, kept as content.md, its mark its type's unless another is given", () => {
    const store = storeOf(["k3f9", "q7w2"]);
    const doc = call(store, { action: "publish", type: "doc", title: "Release notes", description: "What changed", markdown: DOC });
    assert.equal(doc.text, `Published Release notes v1 at http://release-notes-k3f9.art.localhost:20300/ (${Buffer.byteLength(DOC)} bytes). The developer sees it in the chat and can open it; you are told only that it was published.`);
    const a = /** @type {any} */ (store.get("release-notes-k3f9"));
    assert.deepEqual([a.type, a.icon, a.versions[0].files], ["doc", "doc", [{ path: CONTENT_FILE, bytes: Buffer.byteLength(DOC) }]]);
    assert.equal(String(store.file(a.name, 1, CONTENT_FILE)), DOC);
    call(store, { action: "publish", type: " Slides ", title: "Q3 review", icon: "chart", markdown: DECK, files: [] });
    assert.deepEqual([store.get("q3-review-q7w2")?.type, store.get("q3-review-q7w2")?.icon], ["slides", "chart"], "an empty files is no files");
  });

  // (fails before: yes — the same)
  test("refused in words: a page's parts for a doc or slides, no Markdown, Markdown for a page (AFC-107)", () => {
    const store = storeOf();
    const no = (/** @type {any} */ input) => call(store, { action: "publish", title: "T", ...input }).error;
    for (const [k, v] of /** @type {const} */ ([["html", "<p>x</p>"], ["files", [{ path: "a.js", content: "" }]], ["folder", "site"]])) {
      assert.equal(no({ type: "doc", markdown: DOC, [k]: v }), `Not published: a doc is given by markdown alone — Filament draws the page — so leave ${k} out. A page or an app of your own HTML is type "page" or "app".`);
      assert.equal(no({ type: "slides", markdown: DECK, [k]: v }), `Not published: slides are given by markdown alone — Filament draws the page — so leave ${k} out. A page or an app of your own HTML is type "page" or "app".`);
    }
    assert.equal(no({ type: "doc", markdown: "  \n" }), "Not published: a doc needs markdown — the whole of it, in Markdown.");
    assert.equal(no({ type: "slides" }), "Not published: slides need markdown — the whole of it, in Markdown.");
    assert.equal(no({ markdown: DOC }), 'Not published: a page is given by html or folder; markdown is for a doc or slides — a new one names its type ("doc" or "slides").');
    assert.equal(no({ type: "page", html: "<p>x</p>", markdown: DOC }), 'Not published: a page is given by html or folder; markdown is for a doc or slides — a new one names its type ("doc" or "slides").');
    assert.deepEqual(store.list(), [], "a refusal keeps nothing");
  });

  // (fails before: yes — a next version could be published as another type)
  test("a next version keeps its type: given by its Markdown with or without the type, refused as another (AFC-108)", () => {
    const store = storeOf(["k3f9", "p4ge"]);
    call(store, { action: "publish", type: "doc", title: "Notes", markdown: "# Notes\n" });
    const next = call(store, { action: "publish", id: "notes-k3f9", markdown: "# Notes\n\nMore.\n" });
    assert.match(next.text, /^Published Notes v2 at /);
    assert.equal(call(store, { action: "publish", id: "notes-k3f9", type: "page", html: "<p>x</p>" }).error, "Not published: Notes is a doc, and a next version keeps its type. Make a new artifact for a page.");
    assert.equal(call(store, { action: "publish", id: "notes-k3f9", html: "<p>x</p>" }).error, 'Not published: a doc is given by markdown alone — Filament draws the page — so leave html out. A page or an app of your own HTML is type "page" or "app".');
    assert.equal(call(store, { action: "publish", id: "notes-k3f9", type: "doc", markdown: "# Three\n" }).ok, true, "its own type, named");
    call(store, { action: "publish", title: "Board", html: "<p>b</p>" });
    assert.equal(call(store, { action: "publish", id: "board-p4ge", type: "slides", markdown: DECK }).error, "Not published: Board is a page, and a next version keeps its type. Make a new artifact for a slides.");
    assert.equal(call(store, { action: "publish", id: "board-p4ge", markdown: DECK }).error, 'Not published: a page is given by html or folder; markdown is for a doc or slides — a new one names its type ("doc" or "slides").');
    assert.deepEqual([store.get("notes-k3f9")?.type, store.get("notes-k3f9")?.versions.length, store.get("board-p4ge")?.type], ["doc", 3, "page"]);
  });

  // (fails before: yes — nothing but a session's agent made a version)
  test("read: its Markdown whole; a version the developer edited says so, and a publish over it is refused with it whole (AFC-119, AFC-120)", () => {
    const store = storeOf(["k3f9"]);
    call(store, { action: "publish", type: "doc", title: "Notes", markdown: "# Notes\n" });
    const read = call(store, { action: "read", id: "notes-k3f9" }).text;
    assert.equal(read, [
      "Notes — notes-k3f9, a doc, version 1 of 1 (the newest), made by m-1 in this session at 2027-01-15 08:00 UTC.",
      "Address: http://notes-k3f9.art.localhost:20300/",
      "Description: none",
      "Icon: doc",
      "Content: its Markdown, content.md below, which Filament draws; publish the next version whole by markdown.",
      "",
      "--- content.md (8 characters) ---",
      "# Notes\n",
    ].join("\n"));
    const by = { chain: null, model: "", folder: "", helper: null, call: null, edited: 1 };
    store.publish({ name: "notes-k3f9", files: [{ path: CONTENT_FILE, data: Buffer.from("# Notes\n\nMine.\n") }], by, who: null });
    const stale = call(store, { action: "publish", id: "notes-k3f9", markdown: "# Notes\n\nTheirs.\n" }).error;
    assert.ok(stale.startsWith("Not published: Notes is at version 2, made by the developer, who edited version 1 in Filament, at 2027-01-15 08:01 UTC, which this session has not read. Here it is whole:"), stale);
    assert.ok(stale.endsWith("--- content.md (15 characters) ---\n# Notes\n\nMine.\n"), "the developer's text, whole");
    assert.match(call(store, { action: "publish", id: "notes-k3f9", markdown: "# Notes\n\nMine. Theirs.\n" }).text, /^Published Notes v3 /, "read, then published over");
    const view = artifactView(/** @type {any} */ (store.get("notes-k3f9")), 20300);
    assert.deepEqual([view.model, view.versions.map((v) => [v.chain, v.edited])], ["m-1", [["c1", undefined], [null, 1], ["c1", undefined]]], "made by the newest a session made");
  });

  // (fails before: yes — there were no guides but the page's)
  test("a guide for each: the call, the Markdown Filament draws, what loads; the tool says the types and takes markdown", () => {
    for (const type of ["doc", "slides"]) {
      const g = /** @type {string} */ (/** @type {any} */ (ARTIFACT_GUIDE)[type]);
      assert.equal(call(storeOf(), { action: "guide", type }).text, g);
      assert.ok(g.includes(`"type":"${type}"`) && g.includes("```mermaid") && g.includes("HTML is shown as text"), type);
      for (const host of VISUAL_HOSTS) assert.ok(g.includes(host.replace("https://", "")), `${type}: ${host}`);
      assert.doesNotMatch(g, /claude|anthropic|show_widget|window\.claude|marp/i, type);
    }
    assert.match(ARTIFACT_GUIDE.slides, /A line of `---` alone between slides/);
    const props = /** @type {any} */ (ARTIFACT_TOOL.input_schema.properties);
    assert.deepEqual(props.type.enum, ["page", "doc", "slides", "dashboard", "design", "app"]);
    assert.match(props.markdown.description, /^publish, a doc or slides:/);
    // The tool names the types; what each is rides its type field (the tool plan).
    assert.match(ARTIFACT_TOOL.description, /^Make a page, doc, slides, dashboard, design or app the person keeps/);
    assert.match(ARTIFACT_TOOL.description, /markdown for a doc or slides/);
    assert.match(props.type.description, /doc or slides \(you write Markdown; Filament draws a document or a deck\)/);
  });
});

describe("the address of a Doc or a deck, and its download", () => {
  const store = storeOf(["k3f9"]);
  call(store, { action: "publish", type: "doc", title: "Release notes", markdown: "# One\n" });
  call(store, { action: "publish", id: "release-notes-k3f9", markdown: DOC });
  const answer = createArtifactsHandler({ store, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300 });
  /** @param {string} path @param {string} [name] */
  const ask = (path, name = "release-notes-k3f9") => {
    /** @type {any} */
    const res = { status: 0, headers: {}, body: "", writeHead(/** @type {number} */ s, /** @type {any} */ h) { this.status = s; this.headers = h; }, end(/** @type {any} */ b) { this.body = b ? String(b) : ""; } };
    answer(/** @type {any} */ ({ method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } }), res, name, new URL(`http://x${path}`));
    return res;
  };

  // (fails before: yes — a doc's address served its index.html, which it has none of)
  test("its page: Filament's own, its Markdown inside, the newest's or an old version's; viewed only at the newest (AFC-106, AFC-119)", () => {
    const now = ask("/");
    assert.deepEqual([now.status, now.headers["content-type"]], [200, "text/html; charset=utf-8"]);
    assert.equal(now.body, servedPage(typeShell("doc", "Release notes", { markdown: DOC }, typeServed("doc")), "Release notes"));
    assert.match(now.headers["content-security-policy"], /script-src 'self'/);
    const viewed = store.get("release-notes-k3f9")?.viewedAt;
    assert.ok(viewed);
    assert.equal(ask("/_filament/v/1/").body, servedPage(typeShell("doc", "Release notes", { markdown: "# One\n" }, typeServed("doc")), "Release notes"), "drawn by today's page");
    assert.equal(store.get("release-notes-k3f9")?.viewedAt, viewed, "an old version is no view");
    assert.equal(ask(`/${CONTENT_FILE}`).body, DOC, "its Markdown by its own name");
  });

  // (fails before: yes — nothing of src/ui was served on an artifact's address)
  test("Filament's own files for it, by their paths, and no other file of Filament's (AFC-55)", () => {
    for (const f of OWN_UI_FILES) {
      const r = ask(`${OWN_UI}${f}`);
      assert.equal(r.status, 200, f);
      assert.equal(r.headers["content-type"], f.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8", f);
    }
    assert.equal(ask(`${OWN_UI}artifacts/doc.js`).body, uiText("artifacts/doc.js"));
    for (const p of ["harness/app.js", "harness.html", "../http/artifacts.js", "%2e%2e/server.js", "lib/md.js/", "LIB/md.js", ""]) assert.equal(ask(`${OWN_UI}${p}`).status, 404, p);
    assert.equal(ask(`${OWN_UI}lib/md.js`, "").status, 200, "the same on any artifact's address");
  });

  // (fails before: yes — a doc downloaded as its content.md beside nothing that draws it)
  test("downloaded: one page that opens alone, Filament's code written inside it; the diagram library only where it draws one (AFC-118)", () => {
    const a = /** @type {any} */ (store.get("release-notes-k3f9"));
    const one = downloadOf(a, 1, /** @type {any} */ (store.files(a.name, 1)));
    const two = downloadOf(a, 2, /** @type {any} */ (store.files(a.name, 2)));
    assert.deepEqual([one.file, one.type, two.file], ["release-notes-k3f9-v1.html", "text/html; charset=utf-8", "release-notes-k3f9.html"]);
    for (const [d, md] of /** @type {const} */ ([[one, "# One\n"], [two, DOC]])) {
      const page = d.data.toString("utf8");
      assert.doesNotMatch(page, /(?:href|src)="\/_filament\//, "nothing to load from Filament");
      assert.ok(page.includes(JSON.stringify({ type: "doc", title: "Release notes", markdown: md }).replace(/</g, "\\u003c")));
      const scripts = [...page.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      assert.equal(scripts.length, md === DOC ? 2 : 1, "the library, then the page's code");
      assert.doesNotThrow(() => new vm.Script(/** @type {string} */ (scripts.at(-1))));
      assert.equal(page.includes(`globalThis.${MERMAID_GLOBAL}=`), md === DOC);
    }
  });
});

describe("in the harness (AFC-115, AFC-121)", () => {
  // (fails before: yes — found in the live drive: a draft sent as the page beside it loaded again was lost, the page
  // saying it was there before its module listened; at 420 px Edit stayed side by side, a container query styling its
  // own container; a deck did not follow a caret its textarea moved)
  test("the page beside the text is sent the draft once it listens; Edit stacks on a narrow view; a deck follows the caret (pinned in the source)", () => {
    const read = (/** @type {string} */ p) => readFileSync(join(UI, ...p.split("/")), "utf8");
    assert.match(read("artifacts/type-page.js"), /addEventListener\("message", [\s\S]{0,160}?\}\);\s+if \(kind === "draft"\) tell\(\{ kind: "ready" \}\);/, "said once it listens");
    assert.match(read("harness/artifact-frame.js"), /if \(m\.kind === "ready"\) return o\.onReady\?\.\(\);/);
    assert.match(read("harness/artifact-view.js"), /onReady: \(\) => editor\.again\(\),/);
    const css = read("harness/aqua.css");
    assert.match(css, /\n\.artifact-view \{ container-type: inline-size; \}/, "the view is the container");
    assert.match(css, /@container \(max-width: 760px\) \{\s+\.artifact-view\.is-editing \.artifact-view-body \{ grid-template-columns: minmax\(0, 1fr\); grid-template-rows:/, "its body, inside it, stacks");
    assert.doesNotMatch(css, /\.artifact-view-body \{[^}]*container-type/);
    assert.match(read("harness/artifact-edit.js"), /for \(const kind of \["selectionchange", "select", "keyup", "click"\]\) text\.addEventListener\(kind, onCaret\);/);
  });

  // (fails before: yes — an edited version had no words, and the tiles were Page alone)
  test("an edited version said as yours; the tiles start each type in words that name it", () => {
    const chats = { c1: { title: "Spend", gone: false } };
    const edited = { v: 3, at: 7, model: "", chain: null, edited: 2 };
    assert.equal(harnessLib.versionBy(edited, chats), "by you, edited from v2");
    assert.equal(harnessLib.madeWhere(edited, chats), "edited by you");
    assert.equal(harnessLib.madeLine({ versions: [edited], chats }, (ms) => `d${ms}`), "v3 · d7 · edited by you");
    assert.equal(harnessLib.askingChat({ versions: [{ v: 1, at: 0, model: "", chain: "c1" }, edited], chats }), "c1", "a change is asked where it was made");
    assert.deepEqual(TILES.map((t) => [t.type, t.label, t.words]), [
      ["page", "Page", "Make a Page artifact: "],
      ["doc", "Doc", "Make a Doc artifact: "],
      ["slides", "Slides", "Make a Slides artifact: "],
      ["dashboard", "Dashboard", "Make a Dashboard artifact: "],
      ["design", "Design", "Make a Design artifact: "],
    ]);
    assert.deepEqual(TILES.map((t) => harnessLib.typeWord(t.type)), ["Page", "Doc", "Slides", "Dashboard", "Design"]);
  });
});
