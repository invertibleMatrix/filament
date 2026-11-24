// @ts-check
// HarnessV4_Artifacts_Plan E18 step 1, the server: the agent's artifacts. A page an agent makes is kept apart from the
// chat, with every version, under an address of its own on this machine (AF-D2, AF-D5); that address is fenced — it
// answers the artifact's files and nothing else of Filament's, and a request its page sends elsewhere is refused
// (AFC-33, AFC-55); one tool of Filament's own, `artifact`, offered where the harness draws the chat (AF-D1, AF-D3), in
// words the agent acts on; a publish over a version its session has not read is refused with the artifact handed back
// (AFC-31); what memory, a summary and a sub-agent's view read of one — never its page (AFC-52). The loop publishes, a
// helper it sends does, and so does a coding agent over Filament's MCP server.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import vm from "node:vm";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { crc32, inflateRawSync } from "node:zlib";
import { join } from "node:path";
import {
  ARTIFACT_ICONS,
  PAGE_SCRIPT,
  artifactAddress,
  artifactNameOfHost,
  artifactPath,
  artifactPolicy,
  artifactTypeOf,
  cleanTitle,
  deletedPage,
  harnessOrigins,
  isArtifactName,
  isArtifactOrigin,
  isTextFile,
  keptPage,
  keptTitle,
  LOOK_SHEET,
  lookSheet,
  nameFor,
  pageAlone,
  servedPage,
  themeTokens,
} from "../src/core/artifacts.js";
import { DESKTOP_STYLE, FILL_ALPHA, LOOK_TOKENS, VISUAL_HOSTS, VISUAL_HUES, VISUAL_NAMES } from "../src/core/visual-look.js";
import { createArtifactStore, leftWords, readFolder } from "../src/services/artifacts.js";
import { ALONE_ASK_WORDS, AWAY_WORDS, DOWN_WORDS, PAGE_MARK, PAGE_SCRIPT_TEXT, TOKEN_SHEETS, createArtifactsHandler, lookCss } from "../src/http/artifacts.js";
import { artifactView, downloadOf, helpersMade, madeIn } from "../src/http/admin/artifacts.js";
import { zipOf } from "../src/services/zip.js";
import { terminalUpgrade } from "../src/http/admin/terminal.js";
import { ARTIFACTS_OFF, ARTIFACT_ACTIONS, ARTIFACT_GUIDE, ARTIFACT_TOOL, artifactCall, artifactsMakeHere } from "../src/app/agent/artifacts.js";
import { SUBAGENT_OFF, argSummary, isLoopTool, loopToolArgs } from "../src/app/agent/tools.js";
import { disabledTools } from "../src/app/agent/turn.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { KNOBS, LOOP_TOOL_NAMES } from "../src/services/session-settings.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { callLog, inBrief, resultsInBrief, withoutArtifactFiles } from "../src/core/messages.js";
import { messagesTranscript, turnTranscript } from "../src/app/sessions/compaction.js";
import { renderMessage } from "../src/core/trim.js";
import { serverInstructions } from "../src/http/mcp.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** A moment the words name: 2027-01-15 08:00 UTC. */
const NOW = Date.UTC(2027, 0, 15, 8, 0);
/** A page whose text says a word nothing else in a test does: a reader that shows the page shows the word. */
const PAGE = "<h1>Spend</h1><p>IN_THE_PAGE</p>";
const APP = "document.title = 'IN_THE_FILES';";

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
/** A fresh folder, removed after the file's tests. @param {string} tag */
const fresh = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `filament-artifacts-${tag}-`));
  dirs.push(d);
  return d;
};
/**
 * A store in a fresh data folder: the clock moves a minute a call, and new names take the four letters given.
 * @param {string[]} [fours] @param {{ onPublished?: any, onChanged?: any }} [more]  its listeners
 */
const storeOf = (fours = [], more = {}) => {
  let t = NOW;
  /** @type {string[]} */
  const said = [];
  const store = createArtifactStore({ dataDir: fresh("data"), log: (level, msg) => said.push(`${level}: ${msg}`), now: () => (t += 60_000) - 60_000, four: () => fours.shift() || "zzzz", ...more });
  return { store, said };
};
const files = (/** @type {Record<string, string>} */ o) => Object.entries(o).map(([path, text]) => ({ path, data: Buffer.from(text) }));
/** @param {string} chain @param {string} [helper] */
const maker = (chain, helper) => ({ chain, model: helper ? "m-h" : "m-1", folder: "/p", helper: helper ?? null, call: null });
/** Where a call of the tool stands. @param {Partial<import("../src/app/agent/artifacts.js").ArtifactAt> & { chain?: string, helper?: string, model?: string, folder?: string }} [o] */
const atOf = ({ chain = "c1", helper, model = "m-1", folder = "/p", within = [], port = 20300, maxBytes = 1_000_000 } = {}) => ({
  who: helper ? `${chain}/${helper}` : chain,
  by: { chain, model, folder, helper: helper ?? null },
  within,
  port,
  maxBytes,
});

describe("an artifact's address (AF-D2)", () => {
  // (fails before: yes — there was no artifact's address)
  test("a name under art.localhost is an artifact's, however it is spelled; any other name under it is fenced; every other host is none (AFC-55)", () => {
    assert.equal(artifactNameOfHost("expense-tracker-k3f9.art.localhost"), "expense-tracker-k3f9");
    assert.equal(artifactNameOfHost("Expense-Tracker-K3F9.ART.LocalHost."), "expense-tracker-k3f9", "case and a closing dot");
    for (const h of ["art.localhost", "a.b.art.localhost", "-x.art.localhost", "x_y.art.localhost", `${"a".repeat(64)}.art.localhost`]) assert.equal(artifactNameOfHost(h), "", h);
    for (const h of ["localhost", "127.0.0.1", "::1", "llm.localhost", "xart.localhost", "x.art.localhost.example.com", "", null, undefined]) assert.equal(artifactNameOfHost(h), null, String(h));
    assert.ok(isArtifactOrigin("http://x-ab12.art.localhost:20300") && isArtifactOrigin("http://art.localhost:1"));
    for (const o of ["http://127.0.0.1:20300", "http://localhost:20300", "null", "", "not a url", undefined, 7]) assert.equal(isArtifactOrigin(o), false, String(o));
    assert.equal(artifactAddress("x-ab12", 20300), "http://x-ab12.art.localhost:20300/");
  });

  // (fails before: yes — the same)
  test("a new name is its title's words and four letters of its own, one label whatever the title", () => {
    assert.equal(nameFor("Expense tracker", "k3f9"), "expense-tracker-k3f9");
    assert.equal(nameFor("  Café — Ünïcode!  ", "abcd"), "cafe-unicode-abcd");
    assert.equal(nameFor("日本語のページ", "abcd"), "artifact-abcd");
    assert.equal(nameFor("abc ".repeat(15), "abcd"), `${Array(10).fill("abc").join("-")}-abcd`, "cut at 40, no hyphen left at its end");
    for (const t of ["Expense tracker", "日本語", "a".repeat(200), "--x--"]) assert.ok(isArtifactName(nameFor(t, "abcd")), t);
  });

  // (fails before: yes — the same)
  test("a file's path inside an artifact: slashes made one way; the disk, a climb out, a bad name and Filament's own folder refused in words (AFC-57)", () => {
    const ok = (/** @type {string} */ p) => /** @type {any} */ (artifactPath(p)).path;
    const no = (/** @type {unknown} */ p) => /** @type {any} */ (artifactPath(p)).error;
    assert.deepEqual(["app.js", "./css//style.css", "css\\style.css", " data.json "].map(ok), ["app.js", "css/style.css", "css/style.css", "data.json"]);
    assert.equal(no(""), "a file has no path: give each file a path such as app.js or css/style.css");
    assert.equal(no(undefined), no(""));
    assert.equal(no("/etc/passwd"), "/etc/passwd is a path on the disk: a file's path is relative to the page, such as app.js");
    assert.equal(no("C:\\Users\\x.js"), "C:\\Users\\x.js is a path on the disk: a file's path is relative to the page, such as app.js");
    assert.equal(no("../config.json"), "../config.json climbs out of the artifact: a file's path stays beside the page, such as css/style.css");
    assert.equal(no("a/../../x"), "a/../../x climbs out of the artifact: a file's path stays beside the page, such as css/style.css");
    for (const p of ["a/<b>.js", "ab:c.js", "x?.js", "dot.", "a/trailing /b.js"]) assert.equal(no(p), `${p} has a character a file's name cannot have here`, p);
    assert.equal(no("_filament/page.js"), "_filament/page.js is under _filament/, which is Filament's own on every artifact's address: name the folder otherwise");
    assert.equal(no("_FILAMENT/x.js"), "_FILAMENT/x.js is under _filament/, which is Filament's own on every artifact's address: name the folder otherwise");
    assert.equal(no(`${"a".repeat(241)}`), `${"a".repeat(241)} is longer than a file's path may be (240 characters)`);
    assert.equal(no("./."), "./. names no file");
    assert.equal(artifactTypeOf("app.JS"), "text/javascript; charset=utf-8");
    assert.equal(artifactTypeOf("blob.bin"), "application/octet-stream");
    assert.ok(isTextFile("data.json") && isTextFile("icon.svg") && !isTextFile("logo.png") && !isTextFile("Makefile"));
  });

  // (fails before: yes — the same)
  test("the page as served: a fragment wrapped whole with its title, Filament's look and small script first — after the doctype, ahead of the page's own (AFC-58)", () => {
    // (fails before: yes — step 2 added the look ahead of the script, which reads the colors it gives)
    const tag = `<link rel="stylesheet" href="${LOOK_SHEET}"><script src="${PAGE_SCRIPT}"></script>`;
    assert.equal(servedPage("<p>hi</p>", "A <b> & \"c\""), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${tag}<title>A &lt;b&gt; &amp; &quot;c&quot;</title></head><body><p>hi</p></body></html>`);
    const whole = "<!DOCTYPE html>\n<html><head><script>own()</script></head><body></body></html>";
    assert.equal(servedPage(whole, "t"), `<!DOCTYPE html>${tag}\n<html><head><script>own()</script></head><body></body></html>`);
    assert.equal(servedPage("\uFEFF<!-- a note -->\n<!doctype html><p>x</p>", "t"), `\uFEFF<!-- a note -->\n<!doctype html>${tag}<p>x</p>`);
    assert.equal(servedPage("<html><body>x</body></html>", "t"), `${tag}<html><body>x</body></html>`, "no doctype: the script first all the same");
    assert.match(PAGE_SCRIPT_TEXT, /data-theme/);
    assert.match(PAGE_SCRIPT_TEXT, /data-motion/);
  });

  // (fails before: yes — nothing kept a visual as an artifact)
  test("a kept visual's page: Filament's as drawn; Claude desktop's with that app's names in the harness's tokens, its classes and its theme mark, ahead of its code (AFC-101)", () => {
    assert.equal(keptPage("<p>spend</p>", null), "<p>spend</p>");
    assert.equal(keptPage("<svg></svg>", "filament"), "<svg></svg>");
    const page = keptPage("<svg class=\"c-teal\"></svg>", "claude-desktop");
    const own = /^<style>:root\{([^}]*)\}/.exec(page)?.[1] || "";
    const names = Object.fromEntries(own.split(";").map((d) => [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1)]));
    assert.deepEqual(
      [names["--text-primary"], names["--text-secondary"], names["--text-muted"], names["--radius"], names["--surface-0"], names["--bg-tint-aqua"], names["--font-sans"]],
      ["var(--color-foreground)", "var(--color-foreground-subtle)", "var(--color-foreground-subtlest)", "var(--r-sm)", "var(--color-background)", "var(--teal-fill)", "var(--font)"],
      "its --text-muted and --radius take its own meaning, and name no name of Filament's back");
    assert.ok(Object.values(names).every((v) => /^(?:var\(--[\w-]+\)|transparent|\d+px)$/.test(v)), own);
    assert.ok(page.includes(`}${DESKTOP_STYLE}</style><script>`), "its classes");
    assert.match(page, /setAttribute\("data-mode",d\.getAttribute\("data-theme"\)==="dark"\?"dark":"light"\)/);
    assert.ok(page.endsWith("</script><svg class=\"c-teal\"></svg>"), "its code after them");
    const whole = keptPage("<!doctype html><html><body>x</body></html>", "claude-desktop");
    assert.ok(whole.startsWith("<!doctype html><style>:root{") && whole.endsWith("</script><html><body>x</body></html>"), "a whole page's after its doctype");
    const served = servedPage(page, "t");
    assert.ok(served.indexOf(LOOK_SHEET) < served.indexOf(":root{--text-primary"), "served, the look first: its names win over the look's");
  });

  test("a kept visual's title: its snake_case name in words, the first a capital, cut to a title's length; none is Kept visual (AFC-101)", () => {
    assert.equal(keptTitle("compaction_flow"), "Compaction flow");
    assert.equal(keptTitle("  q4__revenue  by_product "), "Q4 revenue by product");
    assert.equal(keptTitle("Spend by day"), "Spend by day");
    assert.equal(keptTitle(`${"a_".repeat(60)}end`).length, 79, "80 at most, its last space dropped");
    assert.equal(keptTitle(""), "Kept visual");
    assert.equal(keptTitle(undefined), "Kept visual");
    assert.ok(cleanTitle(keptTitle("x".repeat(200))).ok);
  });

  // (fails before: yes — the same)
  test("the policy: libraries from the hosts visuals take, connections and forms to its own address alone, framed by the harness alone", () => {
    const framers = harnessOrigins(20300, { host: "127.0.0.1", allowedHosts: [] });
    assert.deepEqual(framers, ["http://127.0.0.1:20300", "http://localhost:20300"]);
    assert.deepEqual(harnessOrigins(8080, { host: "MyBox.lan", allowedHosts: ["proxy.local", "x.art.localhost", "art.localhost", "0.0.0.0", "LOCALHOST", "fe80::1", "::"] }), ["http://127.0.0.1:8080", "http://localhost:8080", "http://mybox.lan:8080", "http://proxy.local:8080"], "never an artifact's own");
    // (fails before: yes — step 1's live check: Edge refused the policy's http://[::1]:<port>, an error on every page)
    assert.ok(!harnessOrigins(20300, { host: "::1", allowedHosts: ["[fe80::1]"] }).some((o) => o.includes("[") || o.includes("::")), "a policy cannot name an IPv6 address");
    const policy = artifactPolicy(framers).split("; ");
    for (const part of ["default-src 'none'", "connect-src 'self'", "form-action 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors http://127.0.0.1:20300 http://localhost:20300"]) assert.ok(policy.includes(part), part);
    const script = /** @type {string} */ (policy.find((p) => p.startsWith("script-src ")));
    for (const host of VISUAL_HOSTS) assert.ok(script.includes(host), host);
    assert.equal(artifactPolicy([]).split("; ").at(-1), "frame-ancestors 'none'");
  });
});

/**
 * page.js run in a stand-in window: what it marks on the root, writes in its own style, says to its parent and opens,
 * the notes it shows and the streams it opens.
 * @param {{ framed?: boolean, name?: string, dark?: boolean, still?: boolean, values?: Record<string, string>, pixels?: Record<string, number[]>, protocol?: string, fetch?: (url: string, o: any) => Promise<any> }} [o]
 *   `values`: the root's computed custom properties; `pixels`: what a canvas paints each color as; `protocol`: where
 *   the page was opened from; `fetch`: what its requests are answered
 */
function pageIn({ framed = true, name = "", dark = false, still = false, values = {}, pixels = {}, protocol = "http:", fetch = () => Promise.reject(new Error("no fetch here")) } = {}) {
  /** @type {any[]} */
  const notes = [];
  /** @type {{ url: string, closed: boolean, onmessage: ((e: any) => void) | null }[]} */
  const streams = [];
  /** @type {Record<string, string>} */
  const marks = {};
  /** @type {{ m: any, to: string }[]} */
  const said = [];
  /** @type {any[][]} */
  const opened = [];
  /** @type {Record<string, ((e: any) => void)[]>} */
  const on = {};
  const listen = (/** @type {string} */ where) => (/** @type {string} */ type, /** @type {(e: any) => void} */ fn) => void (on[`${where}:${type}`] ||= []).push(fn);
  const own = { textContent: "" };
  const SENTINEL = "#010203";
  const pen = {
    f: SENTINEL,
    set fillStyle(/** @type {string} */ v) {
      if (v === SENTINEL || v in pixels) this.f = v;
    },
    get fillStyle() {
      return this.f;
    },
    clearRect() {},
    fillRect() {},
    getImageData() {
      return { data: pixels[this.f] || [1, 2, 3, 255] };
    },
  };
  const parent = { postMessage: (/** @type {any} */ m, /** @type {string} */ to) => said.push({ m: JSON.parse(JSON.stringify(m)), to }) };
  const document = {
    documentElement: { setAttribute: (/** @type {string} */ k, /** @type {string} */ v) => void (marks[k] = v), appendChild() {} },
    currentScript: { parentNode: { insertBefore: (/** @type {any} */ el) => void (el.placed = true) } },
    createElement: (/** @type {string} */ tag) =>
      tag === "style"
        ? own
        : tag === "div"
          ? { role: "", textContent: "", style: {}, gone: false, setAttribute(/** @type {string} */ k, /** @type {string} */ v) { /** @type {any} */ (this)[k] = v; }, addEventListener() {}, remove() { this.gone = true; } }
          : { width: 0, height: 0, getContext: () => pen },
    addEventListener: listen("document"),
    body: { appendChild: (/** @type {any} */ n) => void notes.push(n) },
  };
  const media = (/** @type {boolean} */ matches, /** @type {string} */ key) => ({ matches, addEventListener: (/** @type {string} */ _t, /** @type {any} */ fn) => void (on[key] ||= []).push(fn) });
  /** @type {any} */
  const win = {
    name,
    location: { href: "http://spend-k3f9.art.localhost:20300/", origin: "http://spend-k3f9.art.localhost:20300", protocol },
    fetch,
    EventSource: function (/** @type {string} */ url) {
      const s = { url, closed: false, onmessage: null, close() { this.closed = true; } };
      streams.push(s);
      return s;
    },
    setTimeout: () => 0,
    matchMedia: (/** @type {string} */ q) => (q.includes("dark") ? media(dark, "dark") : media(still, "still")),
    getComputedStyle: () => ({ getPropertyValue: (/** @type {string} */ n) => values[n] || "" }),
    addEventListener: listen("window"),
    open: (/** @type {any[]} */ ...a) => void opened.push(a),
    document,
    URL,
  };
  win.window = win;
  win.parent = framed ? parent : win;
  vm.runInContext(PAGE_SCRIPT_TEXT, vm.createContext(win));
  const fire = (/** @type {string} */ key, /** @type {any} */ e) => {
    for (const fn of on[key] || []) fn(e);
  };
  return { marks, said, opened, own, fire, parent, on, notes, streams, filament: win.filament, sendPrompt: win.sendPrompt };
}

describe("the harness's look on an artifact's page (AF-D32, AF-D33)", () => {
  // (fails before: yes — there was no look: an artifact's page drew in the browser's own colors)
  test("the look's rules are the harness's token rules at a sheet's top, in its order, each theme's keyed by the page's data-theme", () => {
    const css = [
      "/* :root { --gone: 1px; } */",
      ':root { --a: 1px; --b: url("x;y"); color: red; --c: ; }',
      ".theme-zai-dark{--a:2px;--mix:color-mix(in srgb, red 50%, blue)}",
      "@media (max-width: 9px) { :root { --a: 9px; } }",
      ".theme-zai-light, .other { --a: 8px; }",
      "body { --a: 7px; }",
      ".theme-zai-light {\n  --a:\n    4px;\n}",
    ].join("\n");
    assert.deepEqual(themeTokens(css), [
      { on: ":root", decls: [["--a", "1px"], ["--b", 'url("x;y")']] },
      { on: ':root[data-theme="dark"]', decls: [["--a", "2px"], ["--mix", "color-mix(in srgb, red 50%, blue)"]] },
      { on: ':root[data-theme="light"]', decls: [["--a", "4px"]] },
    ]);
    assert.deepEqual(themeTokens(""), []);
  });

  // (fails before: yes — the same)
  test("the look: each sheet's rules in the harness's order, then the guide's names, each hue's fill and a quiet base — weighing nothing, so the page's own rules win (AFC-69)", () => {
    const sheet = lookSheet([":root{--x:1px}.theme-zai-dark{--x:2px}", ".theme-zai-dark{--x:3px}"]);
    const lines = sheet.trimEnd().split("\n");
    assert.deepEqual(lines.slice(0, 3), [":where(:root){--x:1px}", ':where(:root[data-theme="dark"]){--x:2px}', ':where(:root[data-theme="dark"]){--x:3px}'], "the later sheet after the earlier, as the harness loads them");
    assert.ok(lines.every((l) => l.startsWith(":where(") || l.startsWith("html[data-motion=") || l.startsWith("html[data-still]")), "every rule weighs nothing but Motion's and a still preview's");
    const named = /** @type {string} */ (lines.find((l) => l.includes("--text:")));
    for (const [name, token] of Object.entries(LOOK_TOKENS)) {
      if (name === token) assert.ok(!named.includes(`${name}:var(${token})`), `${name} names no one but itself, so is not named again`);
      else assert.ok(named.includes(`${name}:var(${token})`), name);
    }
    for (const [theme, alpha] of Object.entries(FILL_ALPHA)) {
      const fills = /** @type {string} */ (lines.find((l) => l.startsWith(`:where(:root[data-theme="${theme}"]){--`) && l.includes("-fill:")));
      for (const hue of VISUAL_HUES) assert.ok(fills.includes(`--${hue}-fill:color-mix(in oklab, var(--${hue}) ${Math.round(alpha * 100)}%, transparent)`), `${theme} ${hue}`);
    }
    for (const rule of [':where(:root[data-theme="dark"]){color-scheme:dark}', ':where(:root[data-theme="light"]){color-scheme:light}', ":where(body){background:var(--color-background);color:var(--text);font:var(--ui-font-size)/1.5 var(--font);-webkit-font-smoothing:antialiased}"])
      assert.ok(lines.includes(rule), rule);
    assert.ok(lines.some((l) => l.startsWith('html[data-motion="off"] *') && l.includes("animation:none!important")));
  });

  // (fails before: yes — found driving step 7: a Dashboard's card showed the page's scrollbar in its preview)
  test("a card's still preview draws no scrollbar, the page's own or the window's", () => {
    assert.ok(lookSheet([]).split("\n").includes("html[data-still],html[data-still] *{scrollbar-width:none!important}"));
  });

  // (fails before: yes — the same)
  test("the look is made from the sheets the harness links that hold its themes' tokens, in the order it links them", () => {
    const linked = [...readFileSync("src/ui/harness.html", "utf8").matchAll(/<link rel="stylesheet" href="\/ui\/([^"]+)"/g)].map((m) => join(process.cwd(), "src", "ui", m[1]));
    const themed = linked.filter((f) => themeTokens(readFileSync(f, "utf8")).some((r) => r.on !== ":root"));
    assert.deepEqual(TOKEN_SHEETS, themed);
    const made = lookSheet(TOKEN_SHEETS.map((f) => readFileSync(f, "utf8")));
    for (const token of [...new Set(Object.values(LOOK_TOKENS))]) assert.match(made, new RegExp(`${token}:`), `${token} is defined on the page`);
    assert.match(made, /--ui-font-size:/, "the size the base reads");
  });

  // (fails before: yes — an artifact's page had only the browser's look, and the system's theme)
  test("page.js: framed, the theme and Motion its frame's name hands it; the harness's colors as plain rgb in its own style, after its script; that it is there, to its parent", () => {
    const p = pageIn({ name: "filament-look:light:reduced", dark: true, values: { "--text": "color-mix(in oklab, red 50%, blue)", "--accent": "no-color", "--blue-fill": "#ff000080" }, pixels: { "color-mix(in oklab, red 50%, blue)": [10, 20, 30, 255], "#ff000080": [255, 0, 0, 128] } });
    assert.deepEqual(p.marks, { "data-theme": "light", "data-motion": "reduced" }, "the frame's name over the system's dark");
    assert.equal(p.own.textContent, ":where(:root){--text:rgb(10, 20, 30);--blue-fill:rgba(255, 0, 0, 0.502)}", "a color a canvas cannot read is left out (AFC-70)");
    assert.ok(/** @type {any} */ (p.own).placed, "its style right after its script");
    assert.deepEqual(p.said, [{ m: { kind: "here", filament: "artifact" }, to: "*" }]);
  });

  // (fails before: yes — the same)
  test("page.js: the look its parent sends follows in place; one from elsewhere, or not a look, is not heard (AFC-68, AFC-72)", () => {
    const p = pageIn({ name: "filament-look:light:full" });
    p.fire("window:message", { source: {}, data: { filament: "look", theme: "dark", motion: "off" } });
    p.fire("window:message", { source: p.parent, data: { filament: "look", theme: "sepia", motion: "off" } });
    p.fire("window:message", { source: p.parent, data: { filament: "look", theme: "dark", motion: "fast" } });
    assert.deepEqual(p.marks, { "data-theme": "light", "data-motion": "full" });
    p.fire("window:message", { source: p.parent, data: { filament: "look", theme: "dark", motion: "off" } });
    assert.deepEqual(p.marks, { "data-theme": "dark", "data-motion": "off" });
    p.fire("dark", {});
    assert.deepEqual(p.marks, { "data-theme": "dark", "data-motion": "off" }, "the harness's word over the system's change");
  });

  // (fails before: yes — the guide said nothing of a switch in place, and a page's canvas kept the colors it read)
  test("the guide: a switch is followed in place, so what a script drew with colors it read draws again (AFC-76)", () => {
    assert.match(ARTIFACT_GUIDE.page, /while the page is open, and the page is not loaded again/);
    assert.match(ARTIFACT_GUIDE.page, /draws again when `data-theme` on `<html>` changes/);
  });

  // (fails before: yes — the same)
  test("page.js: unframed, the system's theme and Motion, followed as they change, and nothing said to anyone", () => {
    const p = pageIn({ framed: false, name: "filament-look:light:off", dark: true, still: true });
    assert.deepEqual(p.marks, { "data-theme": "dark", "data-motion": "reduced" }, "a name outside a frame is no harness's");
    assert.deepEqual(p.said, []);
    assert.deepEqual(Object.keys(p.on).sort(), ["dark", "still"], "no ear for a parent's look, no failure said, no link taken");
    p.fire("dark", {});
    assert.equal(p.marks["data-theme"], "dark");
  });

  // (fails before: yes — a failure in an artifact's page was seen by no one)
  test("page.js: what fails in the page is said to its parent — a file that did not load, its scripts' errors, a refusal (AFC-25)", () => {
    const p = pageIn();
    p.fire("window:error", { target: { src: "http://spend-k3f9.art.localhost:20300/app.js" } });
    p.fire("window:error", { target: {}, message: "Uncaught TypeError: x is not a function", lineno: 12, filename: "http://spend-k3f9.art.localhost:20300/" });
    p.fire("window:error", { target: {}, message: "boom", lineno: 3, filename: "http://spend-k3f9.art.localhost:20300/app.js" });
    p.fire("window:error", { target: {}, message: "ResizeObserver loop completed with undelivered notifications." });
    p.fire("window:unhandledrejection", { reason: new Error("nope") });
    p.fire("document:securitypolicyviolation", { blockedURI: "https://evil.example/x", effectiveDirective: "connect-src" });
    assert.deepEqual(p.said.slice(1).map((s) => s.m), [
      { kind: "fail", what: "load", url: "http://spend-k3f9.art.localhost:20300/app.js", filament: "artifact" },
      { kind: "fail", what: "error", message: "Uncaught TypeError: x is not a function", line: 12, url: "", filament: "artifact" },
      { kind: "fail", what: "error", message: "boom", line: 3, url: "http://spend-k3f9.art.localhost:20300/app.js", filament: "artifact" },
      { kind: "fail", what: "error", message: "nope", filament: "artifact" },
      { kind: "fail", what: "blocked", url: "https://evil.example/x", directive: "connect-src", filament: "artifact" },
    ]);
  });

  // (fails before: yes — a link to elsewhere opened inside the frame, where the policy refuses it)
  test("page.js: a link to another address opens in a new tab; its own, another scheme, and one the page handled stay (AFC-73)", () => {
    const p = pageIn();
    /** @type {string[]} */
    const stopped = [];
    const click = (/** @type {string} */ href, defaultPrevented = false) =>
      p.fire("document:click", { defaultPrevented, target: { closest: () => ({ href }) }, preventDefault: () => stopped.push(href) });
    for (const href of ["https://example.com/a?b=1", "http://spend-k3f9.art.localhost:20300/about.html", "mailto:x@example.com", "javascript:void 0"]) click(href);
    click("https://example.com/handled", true);
    assert.deepEqual(p.opened, [["https://example.com/a?b=1", "_blank", "noopener,noreferrer"]]);
    assert.deepEqual(stopped, ["https://example.com/a?b=1"]);
  });

  /** A fetch that answers each request in turn and keeps what was asked. @param {{ status: number, body?: any }[]} answers */
  const fetchOf = (answers) => {
    /** @type {{ url: string, o: any }[]} */
    const asked = [];
    /** @param {string} url @param {any} o */
    const fetch = (url, o) => {
      asked.push({ url, o: JSON.parse(JSON.stringify(o)) });
      const a = answers.shift() || { status: 200, body: {} };
      return Promise.resolve({ status: a.status, ok: a.status >= 200 && a.status < 300, json: () => (a.body === undefined ? Promise.reject(new Error("not JSON")) : Promise.resolve(a.body)) });
    };
    return { asked, fetch };
  };

  // (fails before: yes — a page had no filament.db)
  test("page.js: filament.db asks the page's own address, marked as this page's; a record not there is null; a refusal and Filament not answering fail in words (AF-D7)", async () => {
    const f = fetchOf([{ status: 200, body: { record: { id: "a", amount: 12 } } }, { status: 200, body: { collections: [{ name: "expenses", count: 1 }] } }, { status: 200, body: { collection: "expenses", records: [] } }, { status: 404, body: { error: "x has no record y.", missing: true } }, { status: 200, body: { record: { id: 7, n: 2 } } }, { status: 200, body: { deleted: true } }, { status: 403, body: { error: "Only the artifact's own page writes its data." } }, { status: 500 }]);
    const db = pageIn({ fetch: f.fetch }).filament.db;
    assert.deepEqual(await db.set("expenses", { amount: 12 }), { id: "a", amount: 12 });
    assert.deepEqual(await db.collections(), [{ name: "expenses", count: 1 }]);
    assert.deepEqual(await db.list("expenses"), []);
    assert.equal(await db.get("a b", "x/y"), null);
    assert.deepEqual(await db.update("expenses", 7, { n: 2 }), { id: 7, n: 2 });
    assert.equal(await db.delete("expenses", "a"), true);
    await assert.rejects(db.set("expenses", {}), { message: "Only the artifact's own page writes its data." });
    await assert.rejects(db.list("expenses"), { message: "Filament answered 500" });
    const mine = f.asked[0].o.headers[PAGE_MARK];
    assert.match(mine, /^[a-z0-9]+$/);
    assert.deepEqual(f.asked.slice(0, 6), [
      { url: "/_filament/db/expenses", o: { method: "POST", headers: { [PAGE_MARK]: mine, "content-type": "application/json" }, body: '{"amount":12}' } },
      { url: "/_filament/db", o: { method: "GET", headers: { [PAGE_MARK]: mine } } },
      { url: "/_filament/db/expenses", o: { method: "GET", headers: { [PAGE_MARK]: mine } } },
      { url: "/_filament/db/a%20b/x%2Fy", o: { method: "GET", headers: { [PAGE_MARK]: mine } } },
      { url: "/_filament/db/expenses/7", o: { method: "PATCH", headers: { [PAGE_MARK]: mine, "content-type": "application/json" }, body: '{"n":2}' } },
      { url: "/_filament/db/expenses/a", o: { method: "DELETE", headers: { [PAGE_MARK]: mine } } },
    ]);
    const down = pageIn({ fetch: () => Promise.reject(new TypeError("Failed to fetch")) }).filament.db;
    await assert.rejects(down.list("expenses"), { message: DOWN_WORDS });
    assert.throws(() => /** @type {any} */ (pageIn().filament).db = null, TypeError, "Filament's own, not the page's to replace");
  });

  // (fails before: yes — a page heard of no change made elsewhere)
  test("page.js: onChange opens one stream, hears which collection changed elsewhere — never its own — and closes when the last one stops (AFC-92)", async () => {
    const f = fetchOf([{ status: 200, body: { record: { id: "a" } } }]);
    const p = pageIn({ fetch: f.fetch });
    await p.filament.db.set("expenses", {});
    const mine = f.asked[0].o.headers[PAGE_MARK];
    /** @type {any[]} */
    const one = [];
    /** @type {any[]} */
    const two = [];
    const stopOne = p.filament.db.onChange((/** @type {any} */ n) => one.push(n));
    const stopTwo = p.filament.db.onChange((/** @type {any} */ n) => two.push(n));
    assert.deepEqual(p.streams.map((s) => s.url), ["/_filament/changes"], "one stream for both");
    const hear = (/** @type {string} */ data) => /** @type {any} */ (p.streams[0]).onmessage({ data });
    hear(JSON.stringify({ collection: "expenses", from: mine }));
    hear(JSON.stringify({ collection: "expenses", from: "agent" }));
    hear("not json");
    assert.deepEqual(JSON.parse(JSON.stringify([one, two])), [[{ collection: "expenses" }], [{ collection: "expenses" }]], "the agent's change, not its own");
    stopOne();
    assert.equal(p.streams[0].closed, false);
    stopTwo();
    assert.equal(p.streams[0].closed, true);
    assert.equal(typeof p.filament.db.onChange("not a function"), "function");
    assert.equal(p.streams.length, 1, "nothing opened for what is not a function");
  });

  // (fails before: yes — the same)
  test("page.js: saved to a file and opened from it, filament.db fails in words and follows nothing (AFC-93)", async () => {
    /** @type {string[]} */
    const asked = [];
    const p = pageIn({ framed: false, protocol: "file:", fetch: (url) => (asked.push(url), Promise.resolve({})) });
    for (const call of [() => p.filament.db.list("expenses"), () => p.filament.db.set("expenses", {}), () => p.filament.db.collections()]) await assert.rejects(call(), { message: AWAY_WORDS });
    p.filament.db.onChange(() => {});
    assert.deepEqual([asked, p.streams], [[], []]);
  });

  // (fails before: yes — a page could not ask)
  test("page.js: filament.ask, and sendPrompt, hand the words to the harness in a frame; alone in a browser, a note to open it in Filament; empty words, nothing (AF-D8)", () => {
    const p = pageIn();
    p.filament.ask("Summarize my spending");
    p.sendPrompt("  ");
    p.sendPrompt(42);
    assert.deepEqual(p.said.slice(1).map((s) => s.m), [{ kind: "ask", text: "Summarize my spending", filament: "artifact" }, { kind: "ask", text: "42", filament: "artifact" }]);
    assert.equal(p.sendPrompt, p.filament.ask);
    const alone = pageIn({ framed: false });
    alone.filament.ask("Summarize my spending");
    assert.deepEqual(alone.said, []);
    assert.deepEqual(alone.notes.map((n) => [n.role, n.textContent]), [["status", ALONE_ASK_WORDS]]);
  });
});

describe("the store keeps every version whole (AF-D5)", () => {
  // (fails before: yes — there was no store)
  test("a new artifact, then its next version: each version's files whole in its own folder; the record names who made it; empty fields keep the artifact's", () => {
    const { store } = storeOf(["k3f9"]);
    const one = /** @type {any} */ (store.publish({ title: "Expense tracker", description: "What I spend", icon: "money", type: "page", files: files({ "index.html": PAGE, "app.js": APP }), by: maker("c1"), who: "c1" }));
    assert.ok(one.ok);
    assert.deepEqual(one.version, { v: 1, at: NOW, by: maker("c1"), files: [{ path: "index.html", bytes: Buffer.byteLength(PAGE) }, { path: "app.js", bytes: Buffer.byteLength(APP) }] });
    assert.deepEqual({ ...one.artifact, versions: one.artifact.versions.length }, { name: "expense-tracker-k3f9", title: "Expense tracker", description: "What I spend", icon: "money", type: "page", createdAt: NOW, updatedAt: NOW, versions: 1, seen: { c1: 1 }, pinned: false, viewedAt: 0 });
    const name = one.artifact.name;
    const two = /** @type {any} */ (store.publish({ name, title: "", icon: "", type: "", files: files({ "index.html": "<p>v2</p>" }), by: maker("c1"), who: "c1" }));
    assert.deepEqual([two.version.v, two.artifact.title, two.artifact.description, two.artifact.icon, two.artifact.createdAt, two.artifact.updatedAt], [2, "Expense tracker", "What I spend", "money", NOW, NOW + 60_000]);
    assert.deepEqual(readdirSync(join(store.dir, name)).sort(), ["artifact.json", "v1", "v2"], "nothing written beside it is left");
    assert.equal(JSON.parse(readFileSync(join(store.dir, name, "artifact.json"), "utf8")).version, 1, "the record's shape, by its number");
    assert.equal(String(store.file(name, 1, "app.js")), APP);
    assert.equal(String(store.file(name, 2, "index.html")), "<p>v2</p>");
    assert.equal(store.file(name, 2, "app.js"), null, "a version holds only its own files");
    assert.equal(store.file(name, 3, "index.html"), null);
    assert.equal(store.file("nope-0000", 1, "index.html"), null);
    assert.deepEqual(store.get(name)?.seen, { c1: 2 });
    assert.deepEqual(store.list().map((a) => a.name), [name]);
  });

  // (fails before: yes — the same)
  test("a name already taken is never reused: the four letters are drawn again", () => {
    const { store } = storeOf(["k3f9", "k3f9", "q7w2"]);
    const a = /** @type {any} */ (store.publish({ title: "Expense tracker", files: files({ "index.html": "a" }), by: maker("c1"), who: "c1" }));
    const b = /** @type {any} */ (store.publish({ title: "Expense tracker", files: files({ "index.html": "b" }), by: maker("c1"), who: "c1" }));
    assert.deepEqual([a.artifact.name, b.artifact.name], ["expense-tracker-k3f9", "expense-tracker-q7w2"]);
    assert.deepEqual(store.list().map((x) => x.name), ["expense-tracker-q7w2", "expense-tracker-k3f9"], "the most recently changed first");
  });

  // (fails before: yes — the same)
  test("a publish over a version its session — or a helper of it — has not read is refused with the artifact as it stands, and that refusal is its read (AFC-30, AFC-31)", () => {
    const { store } = storeOf(["k3f9"]);
    const name = /** @type {any} */ (store.publish({ title: "Plan", files: files({ "index.html": "v1" }), by: maker("c1"), who: "c1" })).artifact.name;
    const stale = /** @type {any} */ (store.publish({ name, files: files({ "index.html": "from c2" }), by: maker("c2"), who: "c2" }));
    assert.equal(stale.ok, false);
    assert.equal(stale.stale.versions.length, 1, "handed back as it stands");
    assert.deepEqual(store.get(name)?.seen, { c1: 1, c2: 1 }, "the refusal counts as its read");
    assert.ok(!existsSync(join(store.dir, name, "v2")), "nothing kept of it");
    assert.equal(/** @type {any} */ (store.publish({ name, files: files({ "index.html": "from c2" }), by: maker("c2"), who: "c2" })).version.v, 2, "the next try goes in");
    assert.equal(/** @type {any} */ (store.publish({ name, files: files({ "index.html": "from c1" }), by: maker("c1"), who: "c1" })).ok, false, "now c1 has not read c2's");
    assert.equal(/** @type {any} */ (store.publish({ name, files: files({ "index.html": "a helper's" }), by: maker("c1", "sa_1"), who: "c1/sa_1" })).ok, false, "a helper reads for itself");
    store.seen(name, "c1/sa_1");
    const helper = /** @type {any} */ (store.publish({ name, files: files({ "index.html": "a helper's" }), by: maker("c1", "sa_1"), who: "c1/sa_1" }));
    assert.deepEqual([helper.version.v, helper.version.by.helper], [3, "sa_1"]);
    assert.deepEqual(store.publish({ name: "nope-0000", files: files({ "index.html": "x" }), by: maker("c1"), who: "c1" }), { ok: false, error: "there is no artifact named nope-0000" });
  });

  // (fails before: yes — every publish named a reader, so a kept visual counted as read by a session named "null")
  test("the developer keeps a visual as a new artifact: no reader has seen it, so its chat's agent reads it before it publishes over it (AFC-101)", () => {
    const { store } = storeOf(["k3f9"]);
    const kept = /** @type {any} */ (store.publish({ title: "Flow", files: files({ "index.html": "<p>flow</p>" }), by: { ...maker("c1"), model: "", visual: "v1" }, who: null }));
    assert.deepEqual([kept.ok, kept.artifact.seen, kept.version.by.visual], [true, {}, "v1"]);
    const stale = /** @type {any} */ (store.publish({ name: kept.artifact.name, files: files({ "index.html": "the agent's" }), by: maker("c1"), who: "c1" }));
    assert.equal(stale.ok, false, "its chat has not read it");
    assert.equal(/** @type {any} */ (store.publish({ name: kept.artifact.name, files: files({ "index.html": "the agent's" }), by: maker("c1"), who: "c1" })).version.v, 2);
    assert.equal(artifactView(/** @type {any} */ (store.get(kept.artifact.name)), 20300).versions[0].visual, "v1");
    assert.equal(artifactView(/** @type {any} */ (store.get(kept.artifact.name)), 20300).versions[1].visual, undefined, "a version no visual made names none");
  });

  // (fails before: yes — the same)
  test("a record that does not read is left out and said once, never thrown over; nothing is published over it (AFC-60)", () => {
    const { store, said } = storeOf(["k3f9"]);
    store.publish({ title: "Good", files: files({ "index.html": "x" }), by: maker("c1"), who: "c1" });
    mkdirSync(join(store.dir, "junk-aaaa"), { recursive: true });
    writeFileSync(join(store.dir, "junk-aaaa", "artifact.json"), "{ not json");
    mkdirSync(join(store.dir, "later-bbbb"), { recursive: true });
    writeFileSync(join(store.dir, "later-bbbb", "artifact.json"), JSON.stringify({ version: 2, name: "later-bbbb", title: "From a later Filament", versions: [{ v: 1, files: [] }] }));
    mkdirSync(join(store.dir, "Not_A_Name"), { recursive: true });
    mkdirSync(join(store.dir, "empty-cccc"), { recursive: true });
    assert.deepEqual(store.list().map((a) => a.title), ["Good"]);
    assert.deepEqual(store.list().map((a) => a.title), ["Good"]);
    assert.deepEqual(said.filter((s) => s.startsWith("warn:")).map((s) => s.replace(/ \(.*\)/, "")).sort(), ["warn: artifacts: junk-aaaa could not be read; it is left out", "warn: artifacts: later-bbbb could not be read; it is left out"], "each said once");
    assert.ok(store.broken("junk-aaaa") && store.broken("later-bbbb") && !store.broken("empty-cccc") && !store.broken("nope-0000"));
    assert.equal(store.get("junk-aaaa"), null);
    assert.deepEqual(store.publish({ name: "junk-aaaa", files: files({ "index.html": "x" }), by: maker("c1"), who: "c1" }), { ok: false, error: "junk-aaaa could not be read from Filament's store, so nothing was published over it" });
  });

  // (fails before: yes — a version kept was said nowhere but on the run that kept it)
  test("each version kept is told, new or next; a refused one is not; a listener that fails is logged and keeps the version (AF-D37)", () => {
    /** @type {string[]} */
    const heard = [];
    /** @type {string[]} */
    const said = [];
    let fail = false;
    const store = createArtifactStore({ dataDir: fresh("told"), log: (level, msg) => said.push(`${level}: ${msg}`), now: () => NOW, four: () => "k3f9", onPublished: (a, v) => {
      heard.push(`${a.name} v${v.v} ${a.title}`);
      if (fail) throw new Error("the stream broke");
    } });
    const name = /** @type {any} */ (store.publish({ title: "Board", files: files({ "index.html": "1" }), by: maker("c1"), who: "c1" })).artifact.name;
    store.publish({ name, files: files({ "index.html": "2" }), by: maker("c2"), who: "c2" });
    fail = true;
    const two = /** @type {any} */ (store.publish({ name, title: "Board two", files: files({ "index.html": "2" }), by: maker("c1"), who: "c1" }));
    assert.deepEqual(heard, ["board-k3f9 v1 Board", "board-k3f9 v2 Board two"], "c2's stale publish was not kept, so not told");
    assert.equal(two.ok, true, "kept, and said kept");
    assert.equal(store.get(name)?.versions.length, 2);
    assert.deepEqual(said, ["warn: artifacts: board-k3f9 v2 was kept, but telling the open views failed (the stream broke)"]);
  });

  // (fails before: yes — found reviewing the Space work: Info counted the web's files a version keeps for offline among
  // its own, 14 where its publish said 3)
  test("Info counts a version's own files and bytes, as its publish does: not the web's it keeps for offline", () => {
    const { store } = storeOf(["k3f9"]);
    const pinned = /** @type {any} */ (store.publish({ title: "Charts", files: files({ "index.html": "<p>1</p>", "_filament/web/pins.json": "{}", "_filament/web/cdn.jsdelivr.net/npm/chart.js@4/chart.umd.js": "x".repeat(50) }), by: { ...maker("c1"), call: "toolu_p" }, who: "c1" })).artifact;
    const [v1] = artifactView(pinned, 20300).versions;
    assert.deepEqual([v1.files, v1.bytes], [1, 8]);
  });

  // (fails before: yes — the harness read nothing of an artifact)
  test("what the harness reads of one: its fields, its address at the port now, each version's maker and call — and a chat's own by call, a helper's left to it (AF-D38, AFC-3)", () => {
    const { store } = storeOf(["k3f9", "q7w2"]);
    const name = /** @type {any} */ (store.publish({ title: "Board", description: "d", icon: "chart", files: files({ "index.html": "<p>12345</p>", "a.js": "x" }), by: { ...maker("c1"), call: "toolu_1" }, who: "c1" })).artifact.name;
    store.publish({ name, files: files({ "index.html": "2" }), by: { ...maker("c1", "sa_1"), call: "toolu_h" }, who: "c1" });
    store.publish({ title: "Other", files: files({ "index.html": "o" }), by: { ...maker("c2"), call: "toolu_9" }, who: "c2" });
    const a = /** @type {any} */ (store.get(name));
    assert.deepEqual(artifactView(a, 20300), {
      name, title: "Board", description: "d", icon: "chart", type: "page", createdAt: NOW, updatedAt: NOW + 60_000, pinned: false, viewedAt: 0,
      folder: "/p", model: "m-h", address: `http://${name}.art.localhost:20300/`,
      versions: [
        { v: 1, at: NOW, model: "m-1", chain: "c1", helper: null, call: "toolu_1", from: null, files: 2, bytes: 13 },
        { v: 2, at: NOW + 60_000, model: "m-h", chain: "c1", helper: "sa_1", call: "toolu_h", from: null, files: 1, bytes: 1 },
      ],
      chats: {},
      data: [],
      reads: [],
    });
    // (fails before: yes — it named no chat) Each chat that made a version, once, as the archive finds it.
    /** @type {string[]} */
    const asked = [];
    const chatOf = (/** @type {string} */ chain) => (asked.push(chain), chain === "c1" ? { title: "Spend", gone: false } : null);
    assert.deepEqual(artifactView(a, 20300, chatOf).chats, { c1: { title: "Spend", gone: false } });
    assert.deepEqual(asked, ["c1"], "asked once for the chat both versions were made in");
    assert.deepEqual(madeIn(store, "c1"), [{ call: "toolu_1", name, v: 1, title: "Board", icon: "chart", type: "page" }]);
    assert.deepEqual(madeIn(store, "c3"), []);
    assert.deepEqual(madeIn(null, "c1"), [], "no store: none");
  });

  // (fails before: yes — nothing named what a helper published once Filament had let the helper go)
  test("what a session's helpers published: each artifact once for each helper and exchange, at that exchange's newest version, the first made first (AFC-100)", () => {
    const { store } = storeOf(["k3f9", "q7w2"]);
    const by = (/** @type {string} */ helper, /** @type {number} */ exchange) => ({ ...maker("c1", helper), exchange });
    const name = /** @type {any} */ (store.publish({ title: "Board", files: files({ "index.html": "1" }), by: by("sa_1", 0), who: "c1/sa_1" })).artifact.name;
    store.publish({ name, files: files({ "index.html": "2" }), by: by("sa_1", 0), who: "c1/sa_1" });
    store.publish({ title: "Other", files: files({ "index.html": "o" }), by: by("sa_2", 1), who: "c1/sa_2" });
    store.seen(name, "c1");
    assert.equal(store.publish({ name, files: files({ "index.html": "3" }), by: maker("c1"), who: "c1" }).ok, true);
    store.update(name, { title: "Board two" });
    assert.deepEqual(helpersMade(store, "c1"), [
      { helper: "sa_1", exchange: 0, name, v: 2, title: "Board two" },
      { helper: "sa_2", exchange: 1, name: "other-q7w2", v: 1, title: "Other" },
    ], "the session's own version is no helper's; a title as it stands now");
    assert.deepEqual(helpersMade(store, "c9"), []);
    assert.deepEqual(helpersMade(null, "c1"), []);
  });
});

/**
 * The entries of a .zip, read by its central directory as an unzipper reads it: each one's name, method, flags, time
 * and date, and its data inflated and checked against its size and CRC-32. @param {Buffer} zip
 */
const unzip = (zip) => {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50, "it ends in the end record");
  let at = zip.readUInt32LE(end + 16);
  return Array.from({ length: zip.readUInt16LE(end + 10) }, () => {
    assert.equal(zip.readUInt32LE(at), 0x02014b50, "a central entry");
    const [flags, method, time, date] = [8, 10, 12, 14].map((o) => zip.readUInt16LE(at + o));
    const [crc, packed, size] = [16, 20, 24].map((o) => zip.readUInt32LE(at + o));
    const [n, extra, note] = [28, 30, 32].map((o) => zip.readUInt16LE(at + o));
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + n).toString("utf8");
    assert.equal(zip.readUInt32LE(local), 0x04034b50, `${name}'s local header`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + packed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.deepEqual([data.length, crc32(data) >>> 0], [size, crc], name);
    at += 46 + n + extra + note;
    return { name, method, flags, time, date, data: data.toString("utf8") };
  });
};

describe("the developer's hand on an artifact (step 4)", () => {
  // (fails before: yes — an artifact could not be renamed or pinned)
  test("a rename or a pin keeps its address, versions and times, and is told; one not there is null (AFC-13, AFC-32)", () => {
    /** @type {string[]} */
    const heard = [];
    const { store } = storeOf(["k3f9"], { onChanged: (/** @type {string} */ n, /** @type {string} */ c) => heard.push(`${n} ${c}`) });
    const name = /** @type {any} */ (store.publish({ title: "Board", files: files({ "index.html": "1" }), by: maker("c1"), who: "c1" })).artifact.name;
    const renamed = /** @type {any} */ (store.update(name, { title: "Board two" }));
    const pinned = /** @type {any} */ (store.update(name, { pinned: true }));
    assert.equal(renamed.pinned, false);
    assert.deepEqual([pinned.name, pinned.title, pinned.pinned, pinned.versions.length, pinned.updatedAt], [name, "Board two", true, 1, NOW]);
    const kept = /** @type {any} */ (store.get(name));
    assert.deepEqual([kept.title, kept.pinned, kept.updatedAt, kept.seen], ["Board two", true, NOW, { c1: 1 }], "kept so");
    assert.equal(store.update(name, { pinned: false })?.pinned, false);
    assert.equal(store.update("nope-0000", { pinned: true }), null);
    assert.deepEqual(heard, [`${name} renamed`, `${name} pinned`, `${name} pinned`]);
  });

  // (fails before: yes — nothing kept when an artifact was last opened)
  test("opened: when is kept, its changes' time left alone (AFC-14)", () => {
    const { store } = storeOf(["k3f9"]);
    const name = /** @type {any} */ (store.publish({ title: "Board", files: files({ "index.html": "1" }), by: maker("c1"), who: "c1" })).artifact.name;
    assert.equal(store.get(name)?.viewedAt, 0, "never opened");
    store.viewed(name);
    assert.deepEqual([store.get(name)?.viewedAt, store.get(name)?.updatedAt], [NOW + 60_000, NOW]);
    store.viewed("nope-0000");
    assert.deepEqual(readdirSync(store.dir), [name], "nothing made for a name not there");
  });

  // (fails before: yes — an old version could not be made the newest)
  test("an old version made the newest again: its files whole as the next version, made by the developer; a chat that read the newest is behind it and told who made it (AFC-28, AFC-79)", () => {
    /** @type {string[]} */
    const heard = [];
    const { store } = storeOf(["k3f9"], { onPublished: (/** @type {any} */ a, /** @type {any} */ v) => heard.push(`v${v.v}${v.by.from ? ` from v${v.by.from}` : ""}`) });
    const name = /** @type {any} */ (store.publish({ title: "Plan", files: files({ "index.html": "one", "a.js": APP }), by: maker("c1"), who: "c1" })).artifact.name;
    store.publish({ name, files: files({ "index.html": "two" }), by: maker("c1"), who: "c1" });
    const back = /** @type {any} */ (store.restore(name, 1));
    assert.deepEqual(back.version, { v: 3, at: NOW + 120_000, by: { chain: null, model: "", folder: "", helper: null, call: null, from: 1 }, files: [{ path: "index.html", bytes: 3 }, { path: "a.js", bytes: Buffer.byteLength(APP) }] });
    assert.deepEqual([String(store.file(name, 3, "index.html")), String(store.file(name, 3, "a.js"))], ["one", APP]);
    assert.deepEqual([store.get(name)?.updatedAt, store.get(name)?.seen], [NOW + 120_000, { c1: 2 }], "no session has read it");
    const view = artifactView(/** @type {any} */ (store.get(name)), 20300);
    assert.deepEqual([view.model, view.folder, view.versions.map((v) => [v.chain, v.from])], ["m-1", "/p", [["c1", null], ["c1", null], [null, 1]]], "made by the newest a session made");
    const stale = /** @type {any} */ (artifactCall({ action: "publish", id: name, html: "<p>mine</p>" }, atOf(), store)).error;
    assert.ok(stale.startsWith("Not published: Plan is at version 3, made by the developer, who made version 1 the newest again, at 2027-01-15 08:02 UTC, which this session has not read."), stale);
    assert.deepEqual(store.restore(name, 3), { ok: false, error: "v3 is Plan's newest already" });
    assert.deepEqual(store.restore(name, 4), { ok: false, error: "Plan has no version 4: it has 1 to 3" });
    assert.deepEqual(store.restore(name, 1.5), { ok: false, error: "Plan has no version 1.5: it has 1 to 3" });
    assert.deepEqual(store.restore("nope-0000", 1), { ok: false, error: "there is no artifact named nope-0000" });
    assert.deepEqual(heard, ["v1", "v2", "v3 from v1"]);
  });

  // (fails before: yes — an artifact could not be deleted)
  test("deleted: every version, file and record gone, its title and when kept, so its name is never made again; a record that does not read goes too (AF-D14, AFC-46, AFC-78)", () => {
    /** @type {string[]} */
    const heard = [];
    const { store } = storeOf(["k3f9", "k3f9", "q7w2"], { onChanged: (/** @type {string} */ n, /** @type {string} */ c) => heard.push(`${n} ${c}`) });
    const name = /** @type {any} */ (store.publish({ title: "Board", files: files({ "index.html": "1", "a.js": APP }), by: maker("c1"), who: "c1" })).artifact.name;
    store.publish({ name, files: files({ "index.html": "2" }), by: maker("c1"), who: "c1" });
    assert.equal(store.remove(name), true);
    assert.deepEqual(readdirSync(join(store.dir, name)), ["deleted.json"]);
    assert.deepEqual([store.get(name), store.list(), store.file(name, 1, "index.html"), store.files(name, 1), store.broken(name)], [null, [], null, null, false]);
    assert.deepEqual(store.deleted(name), { title: "Board", deletedAt: NOW + 120_000 });
    assert.deepEqual([store.deleted("nope-0000"), store.deleted("../x")], [null, null]);
    assert.equal(store.remove(name), false, "once");
    assert.deepEqual(store.publish({ name, files: files({ "index.html": "3" }), by: maker("c1"), who: "c1" }), { ok: false, error: `there is no artifact named ${name}` });
    assert.equal(/** @type {any} */ (store.publish({ title: "Board", files: files({ "index.html": "b" }), by: maker("c1"), who: "c1" })).artifact.name, "board-q7w2", "its name is never made again");
    mkdirSync(join(store.dir, "junk-aaaa"), { recursive: true });
    writeFileSync(join(store.dir, "junk-aaaa", "artifact.json"), "{ not json");
    assert.equal(store.remove("junk-aaaa"), true);
    assert.deepEqual([store.broken("junk-aaaa"), store.deleted("junk-aaaa")?.title], [false, "junk-aaaa"]);
    assert.deepEqual(heard, [`${name} deleted`, "junk-aaaa deleted"]);
  });

  // (fails before: yes — the same) AF-D20
  test("a title as renamed to: its spaces made one; empty or too long refused in words (AFC-80)", () => {
    assert.deepEqual(cleanTitle("  Board \n two  "), { ok: true, title: "Board two" });
    assert.deepEqual(cleanTitle("   "), { ok: false, error: "A title cannot be empty." });
    assert.deepEqual(cleanTitle(7), { ok: false, error: "A title cannot be empty." });
    assert.deepEqual(cleanTitle("x".repeat(80)), { ok: true, title: "x".repeat(80) });
    assert.deepEqual(cleanTitle("x".repeat(81)), { ok: false, error: "A title is 80 characters at most; this one is 81." });
  });

  // (fails before: yes — there was no download)
  test("a .zip of a version's files: each entry by its UTF-8 path, deflated where that makes it smaller, else stored; each reads back whole (AF-D13)", () => {
    const big = "spend ".repeat(200);
    const read = unzip(zipOf([{ path: "index.html", data: Buffer.from(big) }, { path: "img/café.svg", data: Buffer.from("<svg/>") }, { path: "empty.txt", data: Buffer.alloc(0) }], new Date(2027, 0, 15, 8, 30, 10)));
    assert.deepEqual(read.map((e) => [e.name, e.method, e.flags, e.data]), [["index.html", 8, 0x0800, big], ["img/café.svg", 0, 0x0800, "<svg/>"], ["empty.txt", 0, 0x0800, ""]]);
    assert.deepEqual([read[0].time, read[0].date], [(8 << 11) | (30 << 5) | 5, ((2027 - 1980) << 9) | (1 << 5) | 15], "its time, this machine's");
    assert.deepEqual(unzip(zipOf([])), []);
  });

  // (fails before: yes — the same)
  test("a download: a page alone as its own HTML, in Filament's look with nothing of Filament's to load; with files beside it, a .zip whose pages are so too (AF-D13, AFC-48, AFC-82)", () => {
    const { store } = storeOf(["k3f9"]);
    const name = /** @type {any} */ (store.publish({ title: "Spend", files: files({ "index.html": PAGE }), by: maker("c1"), who: "c1" })).artifact.name;
    store.publish({ name, files: files({ "index.html": "<p>two</p>", "about.html": "<!doctype html><p>about</p>", "a.js": APP }), by: maker("c1"), who: "c1" });
    const a = /** @type {any} */ (store.get(name));
    const alone = (/** @type {string} */ html) => pageAlone(html, "Spend", lookCss(), PAGE_SCRIPT_TEXT);
    const one = downloadOf(a, 1, /** @type {any} */ (store.files(name, 1)));
    assert.deepEqual([one.file, one.type, one.data.toString("utf8")], [`${name}-v1.html`, "text/html; charset=utf-8", alone(PAGE)]);
    assert.ok(!one.data.includes(LOOK_SHEET) && !one.data.includes(PAGE_SCRIPT), "nothing of Filament's to load");
    const two = downloadOf(a, 2, /** @type {any} */ (store.files(name, 2)));
    assert.deepEqual([two.file, two.type], [`${name}.zip`, "application/zip"]);
    assert.deepEqual(unzip(two.data).map((e) => [e.name, e.data]), [["index.html", alone("<p>two</p>")], ["about.html", alone("<!doctype html><p>about</p>")], ["a.js", APP]]);
  });

  // (fails before: yes — the same)
  test("a page alone: the look and small script written where served pages link them, and neither ends its tag early", () => {
    const linked = `<link rel="stylesheet" href="${LOOK_SHEET}"><script src="${PAGE_SCRIPT}"></script>`;
    for (const html of [PAGE, "<!doctype html><html><p>x</p></html>"]) assert.equal(pageAlone(html, "A & B", "L", "S"), servedPage(html, "A & B").replace(linked, "<!--filament:alone--><style>L</style><script>S</script><!--/filament:alone-->"));
    assert.ok(!/<\/style/i.test(lookCss()) && !/<\/script/i.test(PAGE_SCRIPT_TEXT));
  });

  // (fails before: yes — a deleted artifact's address said none was there; nothing kept when one was opened)
  test("its address: a deleted one's says so by its title (410); its page opened marks it viewed, an old version, a HEAD or another file does not (AFC-14, AFC-78, AFC-81)", () => {
    const { store } = storeOf(["k3f9"]);
    const name = /** @type {any} */ (store.publish({ title: "Spend", files: files({ "index.html": PAGE, "a.js": APP }), by: maker("c1"), who: "c1" })).artifact.name;
    store.publish({ name, files: files({ "index.html": "<p>two</p>" }), by: maker("c1"), who: "c1" });
    const answer = createArtifactsHandler({ store, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300 });
    const ask = (/** @type {string} */ n, /** @type {string} */ path, method = "GET") => {
      /** @type {any} */
      const res = { status: 0, headers: {}, body: "", writeHead(/** @type {number} */ s, /** @type {any} */ h) { this.status = s; this.headers = h; }, end(/** @type {any} */ b) { this.body = b ? String(b) : ""; } };
      answer(/** @type {any} */ ({ method, headers: {}, socket: { remoteAddress: "127.0.0.1" } }), res, n, new URL(`http://x${path}`));
      return res;
    };
    for (const [path, method, status] of /** @type {const} */ ([["/_filament/v/1/", "GET", 200], ["/_filament/v/1/a.js", "GET", 200], ["/", "HEAD", 200], ["/?v=1", "GET", 302], ["/?v=2", "GET", 302]])) {
      assert.equal(ask(name, path, method).status, status, `${method} ${path}`);
      assert.equal(store.get(name)?.viewedAt, 0, `${method} ${path}`);
    }
    assert.equal(ask(name, "/").body, servedPage("<p>two</p>", "Spend"));
    assert.equal(store.get(name)?.viewedAt, NOW + 120_000);
    store.remove(name);
    const gone = ask(name, "/a.js");
    assert.deepEqual([gone.status, gone.headers["content-type"], gone.body], [410, "text/html; charset=utf-8", deletedPage("Spend")]);
    assert.match(gone.headers["content-security-policy"], /^default-src 'none'; /);
    assert.match(deletedPage("A & B"), /<h1>A &amp; B<\/h1><p>This artifact was deleted\.<\/p>/);
    assert.equal(ask("nope-0000", "/").status, 404);
  });
});

describe("a project's folder as a publish (AFC-6, AFC-63)", () => {
  /** @type {string} */
  let root;
  before(() => {
    root = fresh("project");
    const put = (/** @type {string} */ p, /** @type {string} */ text) => {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), text);
    };
    put("site/index.html", PAGE);
    put("site/app.js", APP);
    put("site/css/a.css", "body{}");
    put("site/.env", "SECRET=1");
    put("site/.git/HEAD", "ref");
    put("site/node_modules/x/index.js", "x");
    put("noindex/b.js", "b");
    put("noindex/page.html", "p");
    mkdirSync(join(root, "empty"));
    put("own/index.html", "x");
    put("own/_filament/page.js", "x");
  });

  // (fails before: yes — a folder could not be published)
  test("every file under it by its path, the page first; hidden entries, node_modules and links left out and named", () => {
    try {
      symlinkSync(join(root, "noindex"), join(root, "site", "linked"), "junction");
    } catch {}
    const r = /** @type {any} */ (readFolder("site", { within: [root], maxBytes: 1_000_000 }));
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.files.map((/** @type {any} */ f) => f.path), ["index.html", "app.js", "css/a.css"]);
    assert.equal(String(r.files[1].data), APP);
    const left = existsSync(join(root, "site", "linked")) ? [".env", ".git/", "linked (a link)", "node_modules/"] : [".env", ".git/", "node_modules/"];
    assert.deepEqual([...r.left].sort(), left);
    assert.equal(r.where, realpathSync(join(root, "site")));
    assert.equal(leftWords(Array.from({ length: 12 }, (_, i) => `f${i}`)), "f0, f1, f2, f3, f4, f5, f6, f7, f8, f9 and 2 more");
    const added = fresh("added");
    mkdirSync(join(added, "web"));
    writeFileSync(join(added, "web", "index.html"), "x");
    assert.ok(/** @type {any} */ (readFolder(join(added, "web"), { within: [root, added], maxBytes: 1_000_000 })).ok, "a folder the chat adds is the session's too");
  });

  // (fails before: yes — the same)
  test("refused in words: no index.html, nothing in it, outside the session's folders, a file, not there, too big, under Filament's own folder", () => {
    const no = (/** @type {string} */ f, /** @type {any} */ o = {}) => /** @type {any} */ (readFolder(f, { within: [root], maxBytes: 1_000_000, ...o })).error;
    assert.equal(no("noindex"), "noindex has no index.html at its top, which is the page: it holds b.js, page.html");
    assert.equal(no("empty"), "empty has no index.html at its top, which is the page: it holds no files of its own");
    const elsewhere = fresh("elsewhere");
    assert.equal(no(elsewhere), `${elsewhere} is outside this session's folders (${root}): only a folder inside them can be published`);
    assert.equal(no(".."), `.. is outside this session's folders (${root}): only a folder inside them can be published`);
    assert.equal(no("site/index.html"), "site/index.html is a file, not a folder: publish its page by html, or name the folder that holds it");
    assert.equal(no("nope"), "nope is not a folder on this machine");
    assert.equal(no("site", { maxBytes: 10 }), "site holds more than Filament takes in one publish (0 MB, server.maxBodyBytes): publish the folder that holds only the built page");
    assert.equal(no("own"), "_filament/page.js is under _filament/, which is Filament's own on every artifact's address: name the folder otherwise");
    assert.equal(no("site", { within: [] }), "this session has no project folder to publish from");
  });
});

describe("the tool, in words the agent acts on", () => {
  // (fails before: yes — there was no artifact tool)
  test("six actions, none of them deletes an artifact (AFC-47); any other is refused naming them (AFC-62); the guide is the page's, in Filament's words", () => {
    const { store } = storeOf();
    assert.deepEqual([...ARTIFACT_ACTIONS], ["guide", "publish", "read", "list", "read_db", "write_db"]);
    assert.deepEqual(ARTIFACT_TOOL.input_schema.properties.action.enum, [...ARTIFACT_ACTIONS]);
    const all = "guide, publish, read, list, read_db, write_db";
    assert.deepEqual(artifactCall({}, atOf(), store), { ok: false, error: `artifact takes an action: ${all}.` });
    assert.deepEqual(artifactCall({ action: "delete", id: "x" }, atOf(), store), { ok: false, error: `artifact takes an action: ${all}; delete is none of them.` });
    assert.deepEqual(artifactCall({ action: "guide" }, atOf(), store), { ok: true, text: ARTIFACT_GUIDE.page });
    assert.deepEqual(artifactCall({ action: " Guide ", type: "PAGE" }, atOf(), store), { ok: true, text: ARTIFACT_GUIDE.page });
    assert.deepEqual(artifactCall({ action: "guide", type: "chart" }, atOf(), store), { ok: false, error: "artifact's guide has a part for page, doc, slides, dashboard, design, app; chart is none of them." });
    for (const name of Object.keys(VISUAL_NAMES)) assert.ok(ARTIFACT_GUIDE.page.includes(`\`${name}\``), `the visuals' look (AF-D15): ${name}`);
    for (const host of VISUAL_HOSTS) assert.ok(ARTIFACT_GUIDE.page.includes(host.replace("https://", "")), host);
    for (const icon of ARTIFACT_ICONS) assert.ok(ARTIFACT_GUIDE.page.includes(icon) && ARTIFACT_TOOL.input_schema.properties.icon.description.includes(icon), icon);
    assert.doesNotMatch([ARTIFACT_GUIDE.page, ARTIFACT_TOOL.description].join("\n"), /claude|anthropic|show_widget|read_me|window\.claude/i, "nothing of another product's");
  });

  // (fails before: yes — the same)
  test("a publish refused in words: its title, description, type, page and files (AFC-7)", () => {
    const { store } = storeOf();
    const within = [fresh("w")];
    const no = (/** @type {any} */ input) => /** @type {any} */ (artifactCall({ action: "publish", ...input }, atOf({ within }), store)).error;
    assert.equal(no({ html: PAGE }), "Not published: a new artifact needs a title — two to four words, sentence case, such as Expense tracker.");
    assert.equal(no({ title: "x".repeat(81), html: PAGE }), "Not published: the title is 81 characters; a title is two to four words (80 characters at most). Say the rest in the description.");
    assert.equal(no({ title: "T", description: "d".repeat(301), html: PAGE }), "Not published: the description is 301 characters; it is one line (300 at most).");
    assert.equal(no({ title: "T", type: "chart", html: PAGE }), "Not published: Filament makes these types: page, doc, slides, dashboard, design, app.");
    assert.equal(no({ title: "T", html: "  " }), "Not published: the page is empty. Give html — a whole HTML document, or what goes inside its <body> — or a folder whose index.html is the page.");
    assert.equal(no({ title: "T", html: PAGE, folder: "site" }), "Not published: give the page by html or by folder, not both.");
    assert.equal(no({ title: "T", folder: "site", files: [{ path: "a.js", content: "" }] }), "Not published: a folder brings its own files; leave files out, or publish by html with them.");
    assert.equal(no({ title: "T", html: PAGE, files: "app.js" }), "Not published: files is a list of { path, content }.");
    assert.equal(no({ title: "T", html: PAGE, files: [{ path: "../x.js", content: "" }] }), "Not published: ../x.js climbs out of the artifact: a file's path stays beside the page, such as css/style.css.");
    assert.equal(no({ title: "T", html: PAGE, files: [{ path: "app.js" }] }), "Not published: app.js has no content: each file is { path, content } with its text.");
    assert.equal(no({ title: "T", html: PAGE, files: [{ path: "Index.html", content: "x" }] }), "Not published: Index.html is given twice (index.html is the page itself, given by html).");
    assert.equal(no({ title: "T", html: PAGE, files: [{ path: "App.js", content: "x" }, { path: "app.js", content: "y" }] }), "Not published: app.js is given twice.");
    assert.equal(no({ id: "https://example.com/", html: PAGE }), "Not published: id is an artifact's name, as list gives it (expense-tracker-k3f9), or its address.");
    assert.equal(no({ id: "nope-0000", html: PAGE }), "Not published: there is no artifact named nope-0000.");
    assert.match(no({ title: "T", folder: "elsewhere-entirely" }), /^Not published: elsewhere-entirely is not a folder on this machine\.$/);
    assert.deepEqual(store.list(), [], "a refusal keeps nothing");
  });

  // (fails before: yes — the same)
  test("published: said at its address, at the port Filament listens on (AFC-50), and on the run; read whole, by its name or its address; an unknown icon is the page's mark, said", () => {
    const { store } = storeOf(["k3f9"]);
    const r = /** @type {any} */ (artifactCall({ action: "publish", title: " Expense   tracker ", description: "What I spend", icon: "Money", html: PAGE, files: [{ path: "app.js", content: APP }] }, atOf({ port: 4321 }), store));
    const address = "http://expense-tracker-k3f9.art.localhost:4321/";
    const bytes = Buffer.byteLength(PAGE) + Buffer.byteLength(APP);
    assert.equal(r.text, `Published Expense tracker v1 at ${address} (2 files, ${bytes} bytes). The developer sees it in the chat and can open it; you are told only that it was published.`);
    assert.deepEqual(r.event, { type: "artifact", name: "expense-tracker-k3f9", v: 1, title: "Expense tracker", address });
    const read = /** @type {any} */ (artifactCall({ action: "read", id: "expense-tracker-k3f9" }, atOf({ port: 4321 }), store)).text;
    assert.equal(read, [
      "Expense tracker — expense-tracker-k3f9, a page, version 1 of 1 (the newest), made by m-1 in this session at 2027-01-15 08:00 UTC.",
      `Address: ${address}`,
      "Description: What I spend",
      "Icon: money",
      "Data: none kept yet",
      "",
      `--- index.html (${PAGE.length} characters) ---`,
      PAGE,
      "",
      `--- app.js (${APP.length} characters) ---`,
      APP,
    ].join("\n"));
    for (const id of [address, "EXPENSE-TRACKER-K3F9.art.localhost:4321", `${address}?v=1`]) assert.equal(/** @type {any} */ (artifactCall({ action: "read", id }, atOf({ port: 4321 }), store)).text, read, id);
    assert.deepEqual(artifactCall({ action: "read" }, atOf(), store), { ok: false, error: "read needs id: the artifact's name, as list gives it, or its address." });
    assert.deepEqual(artifactCall({ action: "read", id: "nope-0000" }, atOf(), store), { ok: false, error: "There is no artifact named nope-0000: list shows them." });
    assert.deepEqual(artifactCall({ action: "read", id: "expense-tracker-k3f9", version: 2 }, atOf(), store), { ok: false, error: "Expense tracker has no version 2: it has 1 to 1." });
    const odd = /** @type {any} */ (artifactCall({ action: "publish", title: "Odd", icon: "unicorn", html: "<p>1</p>" }, atOf(), store));
    assert.equal(odd.text, `Published Odd v1 at http://odd-zzzz.art.localhost:20300/ (8 bytes). The developer sees it in the chat and can open it; you are told only that it was published. The icon "unicorn" is not one Filament draws, so it shows the page mark; it draws ${ARTIFACT_ICONS.join(", ")}.`);
    assert.equal(store.get("odd-zzzz")?.icon, "page");
  });

  // (fails before: yes — the same)
  test("a folder in the project, with what it left out said; a picture beside the page reads by its size", () => {
    const { store } = storeOf(["k3f9"]);
    const root = fresh("folder");
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist", "index.html"), PAGE);
    writeFileSync(join(root, "dist", "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(root, "dist", ".env"), "SECRET=1");
    const r = /** @type {any} */ (artifactCall({ action: "publish", title: "Built", folder: "dist" }, atOf({ within: [root] }), store));
    assert.match(r.text, /^Published Built v1 at http:\/\/built-k3f9\.art\.localhost:20300\/ \(2 files, \d+ bytes\)\. .* Left out of dist: \.env\.$/);
    const read = /** @type {any} */ (artifactCall({ action: "read", id: "built-k3f9" }, atOf(), store)).text;
    assert.ok(read.endsWith("\n\n--- logo.png (4 bytes; not text, kept as it is) ---"), read);
  });

  // (fails before: yes — the same) AFC-31 in the agent's words; AFC-61: a worker's version names it and its session.
  test("a publish over a version this session has not read hands it back whole, saying who made it; then it goes in", () => {
    const { store } = storeOf(["k3f9"]);
    artifactCall({ action: "publish", title: "Plan", html: "<p>v1</p>" }, atOf(), store);
    const stale = /** @type {any} */ (artifactCall({ action: "publish", id: "plan-k3f9", html: "<p>mine</p>" }, atOf({ chain: "c2", model: "m-2" }), store)).error;
    assert.equal(stale, [
      "Not published: Plan is at version 1, made by m-1 in another session at 2027-01-15 08:00 UTC, which this session has not read. Here it is whole: make your change on it, and publish it with id plan-k3f9.",
      "",
      "Plan — plan-k3f9, a page, version 1 of 1 (the newest), made by m-1 in another session at 2027-01-15 08:00 UTC.",
      "Address: http://plan-k3f9.art.localhost:20300/",
      "Description: none",
      "Icon: page",
      "Data: none kept yet",
      "",
      "--- index.html (9 characters) ---",
      "<p>v1</p>",
    ].join("\n"));
    assert.match(/** @type {any} */ (artifactCall({ action: "publish", id: "plan-k3f9", html: "<p>mine</p>" }, atOf({ chain: "c2", model: "m-2" }), store)).text, /^Published Plan v2 at /);
    const helper = atOf({ chain: "c2", helper: "sa_7", model: "m-h" });
    artifactCall({ action: "read", id: "plan-k3f9" }, helper, store);
    assert.ok(/** @type {any} */ (artifactCall({ action: "publish", id: "plan-k3f9", html: "<p>the helper's</p>" }, helper, store)).ok);
    const head = (/** @type {any} */ at) => /** @type {any} */ (artifactCall({ action: "read", id: "plan-k3f9" }, at, store)).text.split("\n")[0];
    assert.equal(head(atOf({ chain: "c2" })), "Plan — plan-k3f9, a page, version 3 of 3 (the newest), made by m-h, a helper (sa_7), in this session at 2027-01-15 08:02 UTC.");
    assert.equal(head(atOf({ chain: "c1" })), "Plan — plan-k3f9, a page, version 3 of 3 (the newest), made by m-h, a helper (sa_7), in another session at 2027-01-15 08:02 UTC.");
    assert.match(/** @type {any} */ (artifactCall({ action: "read", id: "plan-k3f9", version: 1 }, atOf(), store)).text, /^Plan — plan-k3f9, a page, version 1 of 3, made by m-1 in this session at .*\nAddress: http:\/\/plan-k3f9\.art\.localhost:20300\/ \(this version: http:\/\/plan-k3f9\.art\.localhost:20300\/_filament\/v\/1\/\)\n/);
  });

  // (fails before: yes — the same)
  test("the list: those made in this project first, then the rest, each the newest first; words find them (AFC-53)", () => {
    const { store } = storeOf(["aaaa", "bbbb", "cccc"]);
    artifactCall({ action: "publish", title: "Expense tracker", description: "What I spend", html: "x" }, atOf({ folder: "H:\\proj" }), store);
    artifactCall({ action: "publish", title: "Elsewhere page", html: "x" }, atOf({ folder: "H:\\other" }), store);
    artifactCall({ action: "publish", title: "Burn chart", html: "x" }, atOf({ folder: "H:\\proj" }), store);
    const line = (/** @type {string} */ title, /** @type {string} */ name, /** @type {number} */ min, /** @type {string} */ more = "") => `- ${title} (${name}): a page, v1, changed 2027-01-15 08:0${min} UTC — http://${name}.art.localhost:20300/${more}`;
    assert.equal(/** @type {any} */ (artifactCall({ action: "list" }, atOf({ folder: "h:/PROJ/" }), store)).text, [
      "3 artifacts.",
      "",
      "Made in this project (h:/PROJ/):",
      line("Burn chart", "burn-chart-cccc", 2),
      line("Expense tracker", "expense-tracker-aaaa", 0, "\n  What I spend"),
      "",
      "Elsewhere:",
      line("Elsewhere page", "elsewhere-page-bbbb", 1),
    ].join("\n"));
    assert.equal(/** @type {any} */ (artifactCall({ action: "list", query: "SPEND" }, atOf({ folder: "/x" }), store)).text, `1 artifact holding "SPEND".\n\nMade in other projects:\n${line("Expense tracker", "expense-tracker-aaaa", 0, "\n  What I spend")}`);
    assert.equal(/** @type {any} */ (artifactCall({ action: "list", query: "zzz" }, atOf(), store)).text, 'No artifact\'s title or description holds "zzz".');
    assert.equal(/** @type {any} */ (artifactCall({ action: "list" }, atOf(), storeOf().store)).text, "No artifacts yet.");
  });
});

describe("what a reader of the session reads of an artifact: never its page or files (AFC-52)", () => {
  const publish = { action: "publish", title: "Spend", html: PAGE, files: [{ path: "app.js", content: APP }] };
  const read = ["Spend — spend-k3f9, a page, version 1 of 1 (the newest), made by m-1 in this session at 2027-01-15 08:00 UTC.", "Address: http://spend-k3f9.art.localhost:20300/", "Description: none", "Icon: page", "Data: none kept yet", "", `--- index.html (${PAGE.length} characters) ---`, PAGE, "", `--- app.js (${APP.length} characters) ---`, APP].join("\n");
  const head = read.split("\n\n--- ")[0];

  // (fails before: yes — memory, a summary's writer and a sub-agent's view read a publish's input and a read's whole)
  test("a publish's input by its sizes, a read's answer without its files, in every wire shape", () => {
    assert.deepEqual(inBrief("artifact", publish), { action: "publish", title: "Spend", html: `a page of ${PAGE.length} characters`, files: [`app.js (${APP.length} characters)`] });
    assert.deepEqual(inBrief("mcp__filament__artifact", JSON.stringify(publish)), inBrief("artifact", publish), "a coding agent's, and OpenAI's string");
    const plain = { action: "read", id: "spend-k3f9" };
    assert.equal(inBrief("artifact", plain), plain, "a call with no page is itself");
    assert.equal(withoutArtifactFiles(read), `${head}\n\n[its files, ${read.length - head.length - 2} characters, are left out here]`);
    const stale = `Not published: Spend is at version 1, made by m-1 in another session at x UTC, which this session has not read. Here it is whole: make your change on it, and publish it with id spend-k3f9.\n\n${read}`;
    assert.ok(!withoutArtifactFiles(stale).includes("IN_THE_PAGE") && withoutArtifactFiles(stale).startsWith("Not published: Spend is at version 1"));
    for (const other of ["Published Spend v1 at http://spend-k3f9.art.localhost:20300/ (9 bytes).", "--- a.txt ---\nno address before it", "Address: https://example.com/\n\n--- x"]) assert.equal(withoutArtifactFiles(other), other);
  });

  // (fails before: yes — the same)
  test("memory's call log, the summary's transcript, a sub-agent's view of the session and a slice's text", () => {
    const call = { role: "assistant", content: [{ type: "text", text: "Making it." }, { type: "tool_use", id: "a1", name: "artifact", input: publish }, { type: "tool_use", id: "a2", name: "artifact", input: { action: "read", id: "spend-k3f9" } }] };
    const results = { role: "user", content: [{ type: "tool_result", tool_use_id: "a1", content: "Published Spend v1 at http://spend-k3f9.art.localhost:20300/ (40 bytes)." }, { type: "tool_result", tool_use_id: "a2", content: [{ type: "text", text: read }] }] };
    const convo = [{ role: "user", content: "make it" }, call, results];
    const log = callLog(convo);
    assert.equal(log.length, 2);
    assert.ok(log[0].input.includes(`"html":"a page of ${PAGE.length} characters"`) && !log[0].input.includes("IN_THE_PAGE"), log[0].input);
    const summary = turnTranscript({ n: 1, user: convo[0], work: [convo[1], convo[2]], final: { role: "assistant", content: [{ type: "text", text: "Done." }] } });
    assert.ok(summary.includes('"title":"Spend"') && summary.includes("http://spend-k3f9.art.localhost:20300/"), summary);
    assert.ok(!summary.includes("IN_THE_PAGE") && !summary.includes("IN_THE_FILES"), summary);
    const view = messagesTranscript(convo);
    assert.ok(!view.includes("IN_THE_PAGE") && !view.includes("IN_THE_FILES") && view.includes("[its files,"), view);
    for (const m of convo) assert.ok(!renderMessage(m).includes("IN_THE_PAGE") && !renderMessage(m).includes("IN_THE_FILES"), JSON.stringify(m).slice(0, 80));
    // OpenAI's result message carries its text whole.
    const tool = { role: "tool", tool_call_id: "a2", content: read };
    assert.equal(/** @type {any} */ (resultsInBrief(tool)).content, withoutArtifactFiles(read));
    const other = { role: "tool", tool_call_id: "x", content: "plain" };
    assert.equal(resultsInBrief(other), other, "anything else is itself");
    assert.equal(resultsInBrief(convo[0]), convo[0]);
  });
});

describe("the tool in every agent's set (AF-D1, AF-D3)", () => {
  // (fails before: yes — no set had it)
  test("defined once, after the visuals, for the agent, a lead in its seat, a helper and over the task graph; its switch takes it alone (AFC-5)", () => {
    for (const args of [{}, { lead: true }, { disabled: SUBAGENT_OFF }, { graph: true }]) {
      const set = loopToolArgs(/** @type {any} */ (args));
      const at = set.findIndex((t) => t.name === "artifact");
      assert.equal(set[at], ARTIFACT_TOOL, JSON.stringify(args));
      assert.equal(set[at - 1].name, "show_visual");
    }
    const off = loopToolArgs({ disabled: ["artifact"] });
    assert.deepEqual(off, loopToolArgs({}).filter((t) => t.name !== "artifact"), "nothing else moves");
    assert.ok(LOOP_TOOL_NAMES.includes("artifact") && /** @type {any} */ (KNOBS["loop.tools"]).options.includes("artifact"));
    assert.deepEqual(disabledTools({ artifact: false, show_visual: true }), ["artifact"]);
    assert.ok(isLoopTool("artifact"));
  });

  // (fails before: yes — there was no rule)
  // (OA1: an agent asked by its tag makes them too — "PM can write its own files in form of notes or even mocks or
  // artifacts", the owner's words)
  test("offered where the harness draws the chat: its own agent and every agent it sends or asks; never an agent that started by itself (AFC-4)", () => {
    assert.equal(artifactsMakeHere({ composed: true, host: null }), true);
    assert.equal(artifactsMakeHere({ composed: true, host: {} }), true, "any agent it sends or asks by its tag");
    assert.equal(artifactsMakeHere({ composed: true, host: { self: true } }), false);
    assert.equal(artifactsMakeHere({ composed: false, host: null }), false, "an outside client's request");
  });

  // (fails before: yes — it read as a tool of no kind)
  test("its card and argument line: what the call does, and the artifact by its title or its name — never its page", () => {
    assert.equal(argSummary("artifact", { action: "publish", title: "Expense tracker", html: PAGE }), "publish Expense tracker");
    assert.equal(argSummary("artifact", { action: "publish", id: "plan-k3f9", html: PAGE }), "publish plan-k3f9");
    assert.equal(argSummary("artifact", { action: "read", id: "plan-k3f9" }), "read plan-k3f9");
    assert.equal(argSummary("artifact", { action: "guide" }), "guide page");
    assert.equal(argSummary("artifact", { action: "list", query: "spend" }), "list spend");
    assert.equal(argSummary("artifact", { action: "list" }), "list");
    assert.deepEqual(cardOf("artifact", { action: "publish", title: "Expense tracker", html: PAGE }), { kind: "artifact", title: "Publish", subject: "Expense tracker" });
    assert.deepEqual(cardOf("artifact", { action: "read", id: "plan-k3f9" }), { kind: "artifact", title: "Read an artifact", subject: "plan-k3f9" });
    assert.deepEqual(cardOf("artifact", { action: "guide" }), { kind: "artifact", title: "Read the artifact guide", subject: "page" });
    assert.deepEqual(cardOf("artifact", { action: "list" }), { kind: "artifact", title: "List artifacts", subject: "" });
  });
});

describe("the loop publishes", () => {
  const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
  const answer = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  /** @param {any[][]} replies @param {any} artifacts */
  const run = (replies, artifacts) => {
    let n = 0;
    /** @type {any[][]} */
    const seen = [];
    /** @type {any[]} */
    const events = [];
    const out = runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m",
      messages: [{ role: "user", content: "make a tracker" }],
      system: "s",
      tools: loopToolArgs({}),
      modeNow: () => "edit",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async (/** @type {any} */ { body }) => {
        seen.push(structuredClone(body.messages));
        return answer(replies[n++] || [{ type: "text", text: "Done." }]);
      },
      costOf: () => 0,
      runHand: async () => {
        throw new Error("no hand runs here");
      },
      delegateRead: null,
      unattended: false,
      mailbox: null,
      permissions: null,
      tree: null,
      onEvent: (/** @type {any} */ e) => events.push(e),
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
      visuals: null,
      artifacts,
    }));
    return { out, seen, events };
  };
  const resultsOf = (/** @type {any[]} */ msgs) => msgs.at(-1).content.filter((/** @type {any} */ c) => c?.type === "tool_result");

  // (fails before: yes — the loop answered artifact as no tool of its own)
  test("the guide answers; a publish is kept and said on the run under its call; a stale one hands the artifact back whole to the model; a refusal is the call's error", async () => {
    const { store } = storeOf(["k3f9"]);
    store.publish({ title: "Theirs", files: files({ "index.html": "<p>IN_THEIRS</p>" }), by: maker("c9"), who: "c9" });
    const { out, seen, events } = run(
      [
        [toolUse("g1", "artifact", { action: "guide" })],
        [toolUse("p1", "artifact", { action: "publish", title: "Spend", html: PAGE }), toolUse("p2", "artifact", { action: "publish", id: "theirs-k3f9", html: "<p>mine</p>" }), toolUse("p3", "artifact", { action: "publish", html: PAGE })],
      ],
      { store, at: atOf() },
    );
    assert.equal((await out).status, "done");
    assert.equal(resultsOf(seen[1])[0].content, ARTIFACT_GUIDE.page);
    const [ok, stale, bad] = resultsOf(seen[2]);
    assert.equal(ok.is_error, undefined);
    assert.match(ok.content, /^Published Spend v1 at http:\/\/spend-zzzz\.art\.localhost:20300\/ \(\d+ bytes\)\./);
    assert.equal(stale.is_error, true);
    assert.ok(stale.content.startsWith("Error: Not published: Theirs is at version 1, made by m-1 in another session") && stale.content.includes("<p>IN_THEIRS</p>"), "the model is handed it whole, to build on");
    assert.deepEqual([bad.is_error, bad.content], [true, "Error: Not published: a new artifact needs a title — two to four words, sentence case, such as Expense tracker."]);
    const start = events.find((e) => e.type === "tool-start" && e.id === "p1");
    assert.deepEqual(events.filter((e) => e.type === "artifact"), [{ type: "artifact", name: "spend-zzzz", v: 1, title: "Spend", address: "http://spend-zzzz.art.localhost:20300/", round: start.round, id: "p1" }]);
    assert.deepEqual(events.filter((e) => e.type === "tool-start").map((e) => e.args), ["guide page", "publish Spend", "publish theirs-k3f9", "publish"]);
  });

  // (fails before: yes — the same)
  test("where nothing makes artifacts, the call is off, in words", async () => {
    const { out, seen } = run([[toolUse("p1", "artifact", { action: "list" })]], null);
    await out;
    const [r] = resultsOf(seen[1]);
    assert.deepEqual([r.is_error, r.content], [true, `Error: ${ARTIFACTS_OFF}`]);
    assert.equal(ARTIFACTS_OFF, "Not run: artifacts are off in this session.");
  });
});

describe("a coding agent's artifact tool (agent-tools.js)", () => {
  const ctx = { cwd: "/p", upstream: "cli", chain: "c1", turn: null, graph: false };
  /** @param {any} store */
  const toolsOver = (store) => createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null, artifacts: store, port: () => 4321, maxBytes: () => 1_000_000 });

  // (fails before: yes — a coding agent had no artifact tool)
  test("listed where its chat makes artifacts; a publish is the session's — or its helper's — at Filament's port, said on the run under the agent's own call (AFC-2, AFC-61)", async () => {
    const { store } = storeOf(["k3f9"]);
    const tools = toolsOver(store);
    assert.ok(!tools.list(ctx).some((t) => t.name === "artifact"));
    assert.deepEqual(tools.list({ ...ctx, artifacts: true }).map((t) => [t.name, t.inputSchema]), [["artifact", ARTIFACT_TOOL.input_schema]]);
    assert.ok(!toolsOver(null).list({ ...ctx, artifacts: true }).some((t) => t.name === "artifact"), "no store, no tool");
    assert.ok(tools.has("artifact"));
    assert.deepEqual(await tools.call("artifact", { action: "list" }, ctx), { text: ARTIFACTS_OFF, isError: true }, "switched off since the session was given it");
    assert.deepEqual(await tools.call("artifact", { action: "list" }, { ...ctx, chain: null, artifacts: true }), { text: ARTIFACTS_OFF, isError: true }, "no session to stand in");
    /** @type {any[]} */
    const said = [];
    /** @type {string[]} */
    const asked = [];
    const on = { ...ctx, artifacts: true, model: "gpt-x", emit: (/** @type {any} */ e) => said.push(e), callOf: async (/** @type {string} */ name) => (asked.push(name), { id: "toolu_9", round: 3 }) };
    const r = await tools.call("artifact", { action: "publish", title: "Spend", html: PAGE }, on);
    assert.match(r.text, /^Published Spend v1 at http:\/\/spend-k3f9\.art\.localhost:4321\/ /);
    assert.deepEqual(asked, ["artifact"]);
    assert.deepEqual(said, [{ type: "artifact", name: "spend-k3f9", v: 1, title: "Spend", address: "http://spend-k3f9.art.localhost:4321/", id: "toolu_9", round: 3 }]);
    assert.deepEqual(store.get("spend-k3f9")?.versions[0].by, { chain: "c1", model: "gpt-x", folder: "/p", helper: null, call: "toolu_9" }, "the version names the call");
    // A helper of the session reads for itself, and its version names it.
    const helper = { ...on, by: { id: "sa_2", exchange: 0 }, callOf: null };
    assert.match((await tools.call("artifact", { action: "publish", id: "spend-k3f9", html: "<p>2</p>" }, helper)).text, /^Not published: Spend is at version 1, made by gpt-x in this session/);
    said.length = 0;
    assert.match((await tools.call("artifact", { action: "publish", id: "spend-k3f9", html: "<p>2</p>" }, helper)).text, /^Published Spend v2 /);
    assert.deepEqual(said, [{ type: "artifact", name: "spend-k3f9", v: 2, title: "Spend", address: "http://spend-k3f9.art.localhost:4321/" }], "no call of the agent's found: no id or round");
    assert.deepEqual(store.get("spend-k3f9")?.versions[1].by, { chain: "c1", model: "gpt-x", folder: "/p", helper: "sa_2", exchange: 0, call: null }, "and its exchange (AFC-100)");
    assert.deepEqual(await tools.call("artifact", { action: "publish", title: "", html: PAGE }, on), { text: "Not published: a new artifact needs a title — two to four words, sentence case, such as Expense tracker.", isError: true });
  });

  // (fails before: yes — the same)
  test("a folder from the agent's folder or one its chat adds, and none from elsewhere", async () => {
    const { store } = storeOf(["k3f9", "q7w2"]);
    const cwd = fresh("coder");
    const added = fresh("coder-added");
    for (const d of [cwd, added]) {
      mkdirSync(join(d, "site"));
      writeFileSync(join(d, "site", "index.html"), PAGE);
    }
    const tools = toolsOver(store);
    const on = { ...ctx, cwd, dirs: [added], artifacts: true };
    assert.match((await tools.call("artifact", { action: "publish", title: "Here", folder: "site" }, on)).text, /^Published Here v1 /);
    assert.match((await tools.call("artifact", { action: "publish", title: "Added", folder: join(added, "site") }, on)).text, /^Published Added v1 /);
    const elsewhere = fresh("coder-elsewhere");
    assert.deepEqual(await tools.call("artifact", { action: "publish", title: "No", folder: elsewhere }, on), { text: `Not published: ${elsewhere} is outside this session's folders (${cwd}, ${added}): only a folder inside them can be published.`, isError: true });
  });

  // (fails before: yes — the server's words said nothing of artifacts)
  test("Filament's MCP server names artifact as the agent connects, where its chat makes them", () => {
    assert.match(serverInstructions({ cwd: "/p", artifacts: true }), / Its `artifact` makes a page the person keeps apart from the chat \(a tracker, a report, a small tool\) in their Artifacts list, under an address of its own\. The project folder is \/p\.$/);
    assert.ok(!serverInstructions({ cwd: "/p" }).includes("artifact"));
  });
});

describe("the fence where an upgrade passes no front door, and another machine (AFC-56)", () => {
  /** A raw socket that keeps what is written to it. */
  const socketOf = () => ({ written: /** @type {string[]} */ ([]), destroyed: false, write(/** @type {any} */ b, /** @type {any} */ cb) { this.written.push(String(b)); cb?.(); return true; }, destroy() { this.destroyed = true; }, end() {}, on() {} });
  // A program here is let in with no key (`server.loopbackTrust` "legacy"): these are about the page that asks.
  const trust = { loopbackTrust: "legacy" };
  const upgrade = terminalUpgrade({ config: { get: () => ({ server: { host: "127.0.0.1", allowedHosts: [], ...trust } }) }, terminal: { attach: () => () => {}, input() {}, resize() {} } });
  const ask = (/** @type {Record<string, string>} */ headers) => {
    const socket = socketOf();
    upgrade(/** @type {any} */ ({ url: "/api/terminal/t1/stream", headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers }, socket: { remoteAddress: "127.0.0.1" } }), socket, Buffer.alloc(0));
    return socket.written[0]?.split("\r\n")[0];
  };

  // (fails before: yes — a terminal's stream opened for any name under localhost, whatever page asked)
  test("a terminal's stream is refused on an artifact's address and to an artifact's page", () => {
    assert.equal(ask({ host: "127.0.0.1:20300" }), "HTTP/1.1 101 Switching Protocols", "the harness's own");
    assert.equal(ask({ host: "spend-k3f9.art.localhost:20300" }), "HTTP/1.1 404 Not Found");
    assert.equal(ask({ host: "127.0.0.1:20300", origin: "http://spend-k3f9.art.localhost:20300" }), "HTTP/1.1 403 Forbidden");
  });

  // (fails before: yes — the bug hunt of 10-30, ADM-1: any page in the person's browser opened a terminal's stream on
  // 127.0.0.1, read its backlog and typed into it; the run socket refused it, the terminal did not)
  test("a terminal's stream is refused to a page of another site; the harness's own page, on either loopback name, opens it", () => {
    assert.equal(ask({ host: "127.0.0.1:20300", origin: "https://evil.example" }), "HTTP/1.1 403 Forbidden");
    assert.equal(ask({ host: "127.0.0.1:20300", origin: "http://127.0.0.1:9999" }), "HTTP/1.1 403 Forbidden", "another port is another site");
    assert.equal(ask({ host: "127.0.0.1:20300", origin: "null" }), "HTTP/1.1 403 Forbidden", "a sandboxed frame or a file");
    assert.equal(ask({ host: "127.0.0.1:20300", origin: "http://127.0.0.1:20300" }), "HTTP/1.1 101 Switching Protocols");
    assert.equal(ask({ host: "127.0.0.1:20300", origin: "http://localhost:20300" }), "HTTP/1.1 101 Switching Protocols");
  });

  // (fails before: yes — s0c: any program on this computer opened a terminal's stream with no key)
  test("a terminal's stream with no owner key, window session or pairing is refused where server.loopbackTrust is token, the schema's own", () => {
    trust.loopbackTrust = "token";
    try {
      assert.equal(ask({ host: "127.0.0.1:20300" }), "HTTP/1.1 403 Forbidden");
      assert.equal(ask({ host: "127.0.0.1:20300", origin: "http://127.0.0.1:20300" }), "HTTP/1.1 403 Forbidden", "the harness's page with no session");
    } finally {
      trust.loopbackTrust = "legacy";
    }
  });

  // (fails before: yes — there was no artifact's address)
  test("an artifact answers this machine alone, and GET alone", () => {
    const { store } = storeOf(["k3f9"]);
    store.publish({ title: "Spend", files: files({ "index.html": PAGE }), by: maker("c1"), who: "c1" });
    const answer = createArtifactsHandler({ store, server: () => ({ host: "127.0.0.1", allowedHosts: [] }), port: () => 20300 });
    const ask = (/** @type {string} */ remoteAddress, method = "GET") => {
      /** @type {any} */
      const res = { status: 0, headers: {}, body: "", writeHead(/** @type {number} */ s, /** @type {any} */ h) { this.status = s; this.headers = h; }, end(/** @type {any} */ b) { this.body = b ? String(b) : ""; } };
      answer(/** @type {any} */ ({ method, headers: {}, socket: { remoteAddress } }), res, "spend-k3f9", new URL("http://x/"));
      return res;
    };
    assert.equal(ask("127.0.0.1").status, 200);
    const far = ask("192.168.1.5");
    assert.deepEqual([far.status, far.body], [403, "An artifact answers only this machine.\n"]);
    assert.ok(far.headers["content-security-policy"], "its refusal carries the policy too");
    const post = ask("127.0.0.1", "POST");
    assert.deepEqual([post.status, post.headers.allow], [405, "GET, HEAD"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Through the app: the fence on every path; a harness chat's loop, a helper it sends and a coding agent publish; the
// address serves each version
// ---------------------------------------------------------------------------------------------------

describe("through the app", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string} */
  let logs;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-artifacts-app-"));
    logs = mkdtempSync(join(tmpdir(), "filament-artifacts-logs-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg, { dataDir }) => {
        const cli = { id: "cli", name: "cli", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http" }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" } };
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }, cli];
        cfg.routes = [
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
        ];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root, logs);
  });
  /**
   * A request over node:http with the Host, headers and body given — fetch sets its own Host.
   * @param {string} path @param {{ host?: string, method?: string, headers?: Record<string, string>, body?: string }} [o]
   * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: string }>}
   */
  const raw = (path, { host, method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: shim.port, path, method, headers: { ...(host ? { host } : {}), ...headers } }, (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end(body);
    });
  const at = (/** @type {string} */ name) => `${name}.art.localhost:${shim.port}`;
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  const say = (/** @type {any} */ json) => (json.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("");
  /** @param {string} model @param {any} [settings] */
  const create = async (model, settings = {}) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain", settings } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200);
    return { runId: String(r.headers.get("x-filament-request-id")), text: say(await r.json()) };
  };
  const runEvents = async (/** @type {string} */ runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
  const toolNames = (/** @type {any} */ call) => (call.body.tools || []).map((/** @type {any} */ t) => t.name);
  /** What the events stream says from now on, as the harness's tab hears it; `stop` closes it. */
  const hear = async () => {
    /** @type {any[]} */
    const heard = [];
    const stream = http.get({ host: "127.0.0.1", port: shim.port, path: "/api/events?tab=t-artifacts" }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (d) => {
        buf += d;
        for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
          const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
          buf = buf.slice(i + 2);
          if (line) heard.push(JSON.parse(line.slice(6)));
        }
      });
    });
    stream.on("error", () => {});
    await until(() => heard.some((m) => m.type === "hello"), "the stream opened");
    return { heard, stop: () => stream.destroy() };
  };
  /** The text of the newest message's tool result, or null where it carries none. @param {any} call */
  const resultOf = (call) => {
    const last = (call.body.messages || []).at(-1);
    const r = Array.isArray(last?.content) ? last.content.find((/** @type {any} */ b) => b?.type === "tool_result") : null;
    return r ? (typeof r.content === "string" ? r.content : (r.content || []).map((/** @type {any} */ b) => b.text || "").join("")) : null;
  };

  // (fails before: yes — every path answered Filament's own on any name under localhost: /api/state gave its state)
  test("an artifact's address reaches nothing of Filament's, on any path, by any method (AFC-33, AFC-55)", async () => {
    assert.equal((await raw("/api/state", { host: `llm.localhost:${shim.port}` })).status, 200, "a name of this machine's own still reaches Filament");
    for (const path of ["/api/state", "/api/sessions", "/ui/harness.html", "/", "/v1/models", "/health", "/docs/GUIDE.md", "/mcp/memory", "/memory-engine/v1/models", "/config.json"]) {
      const r = await raw(path, { host: at("nope-0000") });
      assert.deepEqual([r.status, r.body], [404, "No artifact is named nope-0000.\n"], path);
      assert.match(String(r.headers["content-security-policy"]), /^default-src 'none'; /, path);
      assert.equal(r.headers["set-cookie"], undefined);
    }
    const post = await raw("/v1/messages", { host: at("nope-0000"), method: "POST" });
    assert.deepEqual([post.status, post.headers.allow], [405, "GET, HEAD"]);
    for (const host of [`art.localhost:${shim.port}`, `a.b.art.localhost:${shim.port}`, `Bad_Name.art.localhost:${shim.port}`]) {
      const r = await raw("/api/state", { host });
      assert.deepEqual([r.status, r.body], [404, `No artifact has this address. An artifact's address is <name>.art.localhost:${shim.port}.\n`], host);
    }
    assert.match((await raw("/_filament/page.js", { host: `art.localhost:${shim.port}` })).body, /data-theme/, "Filament's small script on any of them");
  });

  // (fails before: yes — a page on another origin of this machine was answered: /api/state gave Filament's state)
  test("a request an artifact's page sends to Filament's own address is refused, whatever its path", async () => {
    const origin = `http://spend-k3f9.art.localhost:${shim.port}`;
    for (const [path, method] of [["/api/state", "GET"], ["/api/sessions", "POST"], ["/v1/models", "GET"], ["/v1/messages", "POST"], ["/ui/harness.html", "GET"], ["/mcp/memory", "POST"]]) {
      const r = await raw(path, { method, headers: { origin } });
      assert.deepEqual([r.status, JSON.parse(r.body)], [403, { error: "an artifact's page reaches nothing of Filament's" }], `${method} ${path}`);
    }
    assert.equal((await raw("/api/state", { headers: { origin: `http://127.0.0.1:${shim.port}` } })).status, 200, "the harness's own page");
  });

  // (fails before: yes — the loop had no artifact tool, and no address served one)
  test("the loop in a harness chat publishes; its address serves the page, its files and each version, at Filament's port (AFC-50, AFC-59)", async () => {
    const id = await create("agent/brain-model");
    /** @type {string[]} */
    let offered = [];
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) {
        offered = toolNames(call);
        return reply([toolUse("p1", "artifact", { action: "publish", title: "Spend", icon: "money", html: PAGE, files: [{ path: "app.js", content: APP }, { path: "css/style.css", content: "body{}" }, { path: "data.json", content: "[1,2]" }] })], "tool_use");
      }
      return reply([{ type: "text", text: "Made." }]);
    };
    const first = await turn(id, "make a spend page");
    assert.equal(first.text, "Made.");
    assert.ok(offered.includes("artifact"), offered.join(", "));
    const said = (await runEvents(first.runId)).find((/** @type {any} */ e) => e.type === "artifact");
    assert.ok(said, "said on the run");
    const name = said.name;
    assert.deepEqual([said.v, said.title, said.address, said.id], [1, "Spend", `http://${name}.art.localhost:${shim.port}/`, "p1"]);
    const page = await raw("/", { host: at(name) });
    assert.equal(page.status, 200);
    assert.equal(page.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(page.body, servedPage(PAGE, "Spend"));
    // And this Filament's own name under localhost, where a browser here is paired (services/machine.js `pageHost`).
    assert.match(String(page.headers["content-security-policy"]), new RegExp(`frame-ancestors http://127\\.0\\.0\\.1:${shim.port} http://localhost:${shim.port} http://filament-[0-9a-f]{12}\\.localhost:${shim.port}$`));
    assert.deepEqual([page.headers["x-content-type-options"], page.headers["referrer-policy"], page.headers["set-cookie"]], ["nosniff", "no-referrer", undefined]);
    assert.deepEqual([(await raw("/app.js", { host: at(name) })).body, (await raw("/css/style.css", { host: at(name) })).headers["content-type"], (await raw("/data.json", { host: at(name) })).body], [APP, "text/css; charset=utf-8", "[1,2]"]);
    const head = await raw("/", { host: at(name), method: "HEAD" });
    assert.deepEqual([head.status, head.body, head.headers["content-length"]], [200, "", page.headers["content-length"]]);
    for (const path of ["/nope.js", "/..%2fconfig.json", "/%2e%2e/%2e%2e/config.json", "/_filament/other", "/_filament"]) assert.equal((await raw(path, { host: at(name) })).status, 404, path);
    // (fails before: yes — a browser tab's ask for its icon was a 404 in its console; found in step 8's drive)
    const icon = await raw("/favicon.ico", { host: at(name) });
    assert.deepEqual([icon.status, icon.body], [204, ""], "a page that keeps no icon");
    // A next version: the loop published the first, so it has read it.
    round = 0;
    brain = (call) => (++round === 1 ? reply([toolUse("p2", "artifact", { action: "publish", id: name, html: "<p>v2</p>" })], "tool_use") : reply([{ type: "text", text: "Changed." }]));
    assert.equal((await turn(id, "change it")).text, "Changed.");
    assert.equal((await raw("/", { host: at(name) })).body, servedPage("<p>v2</p>", "Spend"));
    assert.equal((await raw("/app.js", { host: at(name) })).status, 404, "v2 has no app.js");
    const back = await raw("/?v=1", { host: at(name) });
    assert.deepEqual([back.status, back.headers.location], [302, "/_filament/v/1/"]);
    assert.deepEqual([(await raw("/_filament/v/1", { host: at(name) })).headers.location, (await raw("/?v=2", { host: at(name) })).headers.location], ["/_filament/v/1/", "/"]);
    assert.equal((await raw("/_filament/v/1/", { host: at(name) })).body, servedPage(PAGE, "Spend"));
    assert.equal((await raw("/_filament/v/1/app.js", { host: at(name) })).body, APP, "an old version's page reaches its own files");
    for (const path of ["/?v=9", "/?v=0", "/?v=x", "/_filament/v/9/"]) {
      const r = await raw(path, { host: at(name) });
      assert.deepEqual([r.status, r.body], [404, `Spend has no version ${path.includes("?v=") ? path.split("=")[1] : "9"}: it has 1 to 2.\n`], path);
    }
  });

  // (fails before: yes — the same: AF-D3, AFC-5)
  test("a chat that switched artifacts off is not offered the tool, nor an outside client's request, proxied as sent", async () => {
    /** @type {string[][]} */
    const offered = [];
    brain = (call) => (offered.push(toolNames(call)), reply([{ type: "text", text: "No page." }]));
    const id = await create("agent/brain-model", { loop: { tools: { artifact: false } } });
    assert.equal((await turn(id, "make nothing")).text, "No page.");
    const outside = await shim.post("/v1/messages", { model: "brain-model", max_tokens: 100, messages: [{ role: "user", content: "hello from a client" }] }, { "x-filament-cwd": root });
    assert.equal(outside.status, 200, await outside.clone().text());
    assert.equal(offered.length, 2);
    const [chat, client] = offered;
    assert.ok(chat.includes("ask") && !chat.includes("artifact"), chat.join(", "));
    assert.ok(!client.includes("ask") && !client.includes("artifact"), client.join(", "));
  });

  // (fails before: yes — a helper had no artifact tool)
  test("a helper the agent launches publishes as itself: its version names it and the session (AFC-61)", async () => {
    const HELPER = "You are a sub-agent run by Filament";
    const id = await create("agent/brain-model");
    /** @type {string[]} */
    let helperTools = [];
    /** @type {string} */
    let published = "";
    /** @type {string | null} */
    let toldMain = null;
    brain = (call) => {
      const result = resultOf(call);
      if (JSON.stringify(call.body.system ?? "").includes(HELPER)) {
        if (result == null) {
          helperTools = toolNames(call);
          return reply([toolUse("toolu_ha", "artifact", { action: "publish", title: "Helper page", html: "<p>by a helper</p>" })], "tool_use");
        }
        published = result;
        return reply([{ type: "text", text: "HELPER REPORT" }]);
      }
      if (result == null) return reply([toolUse("toolu_ag", "agent", { run_in_background: false, description: "make the page", prompt: "Make the page." })], "tool_use");
      toldMain = result;
      return reply([{ type: "text", text: "MAIN DONE" }]);
    };
    assert.equal((await turn(id, "launch the maker")).text, "MAIN DONE");
    assert.ok(helperTools.includes("artifact"), helperTools.join(", "));
    const name = /http:\/\/([a-z0-9-]+)\.art\.localhost/.exec(published)?.[1] || "";
    assert.ok(name, published);
    const [sa] = (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents;
    const record = JSON.parse(readFileSync(join(shim.dataDir, "artifacts", name, "artifact.json"), "utf8"));
    assert.deepEqual([record.versions[0].by.chain, record.versions[0].by.helper, record.versions[0].by.folder, record.versions[0].by.exchange], [id, sa.id, root, 0]);
    assert.deepEqual(record.seen, { [`${id}/${sa.id}`]: 1 }, "it read for itself, not for the session");
    // (fails before: yes — nothing listed what a helper published, and its report said nothing of it) AFC-100: its
    // exchange lists it, its report names it and where, and the chat's transcript keeps it once the helper is let go.
    const address = `http://${name}.art.localhost:${shim.port}/`;
    assert.deepEqual(sa.exchanges[0].made, [{ name, v: 1, title: "Helper page", address }]);
    // HarnessV4_DesignPass_Plan UX1: and how its agent reads it, with the artifact tool it has.
    assert.ok(String(toldMain).startsWith(`HELPER REPORT\n\nIt made Helper page (v1) at ${address}, shown to the developer. Read it with Filament's artifact tool, {"action": "read", "id": "${name}"}.\n\n[Filament: sub-agent `), String(toldMain));
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.deepEqual(tr.helpersMade, [{ helper: sa.id, exchange: 0, name, v: 1, title: "Helper page" }]);
    assert.equal(tr.artifacts, undefined, "a helper's version is no card of the chat's own");
  });

  // (fails before: yes — a coding agent had no artifact tool)
  test("a coding agent publishes over Filament's MCP server: said on the run under its own call; its address serves it (AFC-2)", async () => {
    const id = await create("coder-1");
    const { runId, text } = await turn(id, `~mcpcall artifact ${JSON.stringify({ action: "publish", title: "Coder page", html: PAGE })}`);
    assert.match(text, new RegExp(`mcp:Published Coder page v1 at http://coder-page-[a-z0-9]{4}\\.art\\.localhost:${shim.port}/ `));
    const events = await runEvents(runId);
    const said = events.find((/** @type {any} */ e) => e.type === "artifact");
    const card = events.find((/** @type {any} */ e) => e.type === "tool-start" && e.id === said?.id);
    assert.ok(card, `said under the id of the agent's own call: ${JSON.stringify(said)}`);
    assert.equal(said.round, card.round);
    assert.equal((await raw("/", { host: at(said.name) })).body, servedPage(PAGE, "Coder page"));
    const record = JSON.parse(readFileSync(join(shim.dataDir, "artifacts", said.name, "artifact.json"), "utf8"));
    assert.deepEqual([record.versions[0].by.chain, record.versions[0].by.helper], [id, null]);
  });

  // (fails before: yes — the harness read nothing of an artifact, and heard of none published)
  test("the harness reads them: each version on the events stream, the list, one, a chat's by call, its transcript's; every page of one in the look (AF-D37, AF-D38, AFC-75)", async () => {
    const { heard, stop } = await hear();
    try {
      const id = await create("agent/brain-model");
      let round = 0;
      brain = () => (++round === 1 ? reply([toolUse("b1", "artifact", { action: "publish", title: "Board", icon: "chart", html: "<p>board</p>", files: [{ path: "about.html", content: "<p>about</p>" }, { path: "a.js", content: "x" }] })], "tool_use") : reply([{ type: "text", text: "Made." }]));
      assert.equal((await turn(id, "make a board")).text, "Made.");
      await until(() => heard.some((m) => m.type === "artifact"), "the version heard on the stream");
      const told = heard.find((m) => m.type === "artifact");
      const name = told.name;
      assert.deepEqual(told, { type: "artifact", name, v: 1, title: "Board" });
      const listed = (await (await shim.api("/api/artifacts")).json()).artifacts;
      const one = listed.find((/** @type {any} */ a) => a.name === name);
      assert.deepEqual([one.title, one.icon, one.address, one.versions.map((/** @type {any} */ v) => [v.v, v.chain, v.helper, v.call, v.files])], ["Board", "chart", `http://${name}.art.localhost:${shim.port}/`, [[1, id, null, "b1", 3]]]);
      assert.deepEqual((await (await shim.api(`/api/artifacts?chain=${encodeURIComponent(id)}`)).json()).artifacts.map((/** @type {any} */ a) => a.name), [name], "a chat's own, and no other's");
      assert.deepEqual(await (await shim.api(`/api/artifacts/${name}`)).json(), one);
      const none = await shim.api("/api/artifacts/nope-0000");
      assert.deepEqual([none.status, await none.json()], [404, { error: "No artifact is named nope-0000." }]);
      const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=held`)).json();
      assert.deepEqual(tr.artifacts, [{ call: "b1", name, v: 1, title: "Board", icon: "chart", type: "page" }]);
      const other = await create("agent/brain-model");
      assert.equal((await (await shim.api(`/api/sessions/${encodeURIComponent(other)}/transcript?work=held`)).json()).artifacts, undefined, "a chat that made none lists none");
      const about = await raw("/about.html", { host: at(name) });
      assert.deepEqual([about.status, about.body], [200, servedPage("<p>about</p>", "Board")], "its other page draws in the look and says what fails in it");
      assert.equal((await raw("/a.js", { host: at(name) })).body, "x", "a script is its own");
      const look = await raw("/_filament/look.css", { host: at(name) });
      assert.deepEqual([look.status, look.headers["content-type"]], [200, "text/css; charset=utf-8"]);
      assert.match(String(look.headers["content-security-policy"]), /^default-src 'none'; /);
      assert.equal(look.body, lookSheet(TOKEN_SHEETS.map((f) => readFileSync(f, "utf8"))));
    } finally {
      stop();
    }
  });

  // (fails before: yes — the harness could not rename, pin, delete, make an old version the newest or download one)
  test("the developer's hand through the API: rename, pin, an old version the newest, download, delete — each told on the events stream, a refusal in words (AFC-78 to AFC-83)", async () => {
    const { heard, stop } = await hear();
    try {
      const id = await create("agent/brain-model");
      let name = "";
      let round = 0;
      brain = () => {
        round += 1;
        if (round === 1) return reply([toolUse("d1", "artifact", { action: "publish", title: "Ledger", html: "<p>one</p>", files: [{ path: "a.js", content: "x" }] })], "tool_use");
        if (round === 3) return reply([toolUse("d2", "artifact", { action: "publish", id: name, html: "<p>two</p>" })], "tool_use");
        return reply([{ type: "text", text: "Done." }]);
      };
      await turn(id, "make a ledger");
      await until(() => heard.some((m) => m.type === "artifact" && m.title === "Ledger"), "v1 heard");
      name = heard.find((m) => m.type === "artifact" && m.title === "Ledger").name;
      await turn(id, "change it");
      const api = async (/** @type {string} */ path, /** @type {string} */ method, /** @type {any} */ body = undefined) => {
        const r = await shim.api(`/api/artifacts/${name}${path}`, { method, body });
        return [r.status, await r.json()];
      };
      const patched = await api("", "PATCH", { title: "  Ledger   two " });
      assert.deepEqual([patched[0], patched[1].title, patched[1].name, patched[1].versions.length], [200, "Ledger two", name, 2]);
      assert.deepEqual(await api("", "PATCH", { title: "" }), [400, { error: "A title cannot be empty." }]);
      assert.deepEqual(await api("", "PATCH", { pinned: "yes" }), [400, { error: "pinned is true or false." }]);
      assert.deepEqual(await api("", "PATCH", {}), [400, { error: "Give a title or pinned to change." }]);
      assert.equal((await api("", "PATCH", { pinned: true }))[1].pinned, true);
      assert.deepEqual(await (await shim.api("/api/artifacts/nope-0000", { method: "PATCH", body: { pinned: true } })).json(), { error: "No artifact is named nope-0000." });
      const newest = await shim.api(`/api/artifacts/${name}/download`);
      const page = await newest.text();
      assert.deepEqual([newest.status, newest.headers.get("content-disposition"), newest.headers.get("content-type"), newest.headers.get("x-content-type-options")], [200, `attachment; filename="${name}.html"`, "text/html; charset=utf-8", "nosniff"]);
      assert.ok(page.includes("<p>two</p>") && page.includes("<style>") && !/(?:href|src)="\/_filament\//.test(page), "alone in the look, nothing loaded from Filament");
      const old = await shim.api(`/api/artifacts/${name}/download?v=1`);
      assert.deepEqual([old.headers.get("content-disposition"), old.headers.get("content-type")], [`attachment; filename="${name}-v1.zip"`, "application/zip"]);
      assert.deepEqual(unzip(Buffer.from(await old.arrayBuffer())).map((e) => e.name), ["index.html", "a.js"]);
      assert.deepEqual(await api("/download?v=9", "GET"), [404, { error: "Ledger two has no version 9: it has 1 to 2." }]);
      assert.deepEqual(await api("/newest", "POST", { v: 2 }), [400, { error: "v2 is Ledger two's newest already." }]);
      const back = await api("/newest", "POST", { v: 1 });
      assert.deepEqual([back[0], back[1].versions.map((/** @type {any} */ v) => v.from)], [200, [null, null, 1]]);
      assert.equal((await raw("/", { host: at(name) })).body, servedPage("<p>one</p>", "Ledger two"), "its address serves the version made the newest");
      assert.ok((await api("", "GET"))[1].viewedAt > 0, "and that opening is a view");
      assert.deepEqual(await api("", "DELETE"), [200, { deleted: true, name }]);
      const gone = await api("", "GET");
      assert.deepEqual([gone[0], gone[1].error, gone[1].deleted, gone[1].title, typeof gone[1].deletedAt], [410, "Ledger two was deleted.", true, "Ledger two", "number"]);
      assert.deepEqual(await api("", "DELETE"), [410, { error: `${name} was deleted already.`, deleted: true }]);
      assert.deepEqual((await api("/download", "GET"))[0], 410);
      const address = await raw("/", { host: at(name) });
      assert.deepEqual([address.status, address.body], [410, deletedPage("Ledger two")]);
      assert.ok(!(await (await shim.api("/api/artifacts")).json()).artifacts.some((/** @type {any} */ a) => a.name === name), "the list leaves it out");
      assert.equal((await shim.api("/api/artifacts/nope-0000", { method: "DELETE" })).status, 404);
      await until(() => heard.some((m) => m.name === name && m.change === "deleted"), "the delete heard");
      assert.deepEqual(heard.filter((m) => m.type === "artifact" && m.name === name).map((m) => m.change || `v${m.v} ${m.title}`), ["v1 Ledger", "v2 Ledger", "renamed", "pinned", "v3 Ledger two", "deleted"]);
    } finally {
      stop();
    }
  });

  // (fails before: yes — a doc could not be made, nor its text edited)
  test("a doc's text edited through the API: its Markdown read, the next version made by the developer; one that came since refused with it, kept over it by force; the same text keeps nothing; a page has no text (AFC-115, AFC-116, AFC-120)", async () => {
    const { heard, stop } = await hear();
    try {
      const id = await create("agent/brain-model");
      let name = "";
      let read = "";
      let round = 0;
      brain = (call) => {
        round += 1;
        if (round === 1) return reply([toolUse("e1", "artifact", { action: "publish", type: "doc", title: "Plan", markdown: "# Plan\n" })], "tool_use");
        if (round === 3) return reply([toolUse("e2", "artifact", { action: "publish", id: name, markdown: "# Plan\n\nAgent's.\n" })], "tool_use");
        if (round === 4) read = String(resultOf(call));
        if (round === 5) return reply([toolUse("e3", "artifact", { action: "publish", title: "Site", html: "<p>s</p>" })], "tool_use");
        return reply([{ type: "text", text: "Done." }]);
      };
      await turn(id, "make a plan");
      await until(() => heard.some((m) => m.type === "artifact" && m.title === "Plan"), "v1 heard");
      name = heard.find((m) => m.type === "artifact" && m.title === "Plan").name;
      const api = async (/** @type {string} */ path, /** @type {string} */ method, /** @type {any} */ body = undefined) => {
        const r = await shim.api(`/api/artifacts/${name}${path}`, { method, body });
        return [r.status, await r.json()];
      };
      assert.deepEqual(await api("/text", "GET"), [200, { v: 1, markdown: "# Plan\n" }]);
      const saved = await api("/versions", "POST", { markdown: "# Plan\n\nMine.\n", base: 1 });
      assert.deepEqual([saved[0], saved[1].versions.map((/** @type {any} */ v) => [v.v, v.chain, v.edited])], [200, [[1, id, undefined], [2, null, 1]]]);
      assert.deepEqual(await api("/text?v=1", "GET"), [200, { v: 1, markdown: "# Plan\n" }]);
      assert.deepEqual(await api("/text?v=3", "GET"), [404, { error: "Plan has no version 3: it has 1 to 2." }]);
      const stale = await api("/versions", "POST", { markdown: "# Plan\n\nAgain.\n", base: 1 });
      assert.deepEqual([stale[0], stale[1].error, stale[1].stale, stale[1].versions.length], [409, "Plan changed while you edited it: v2 came since your v1.", true, 2], "the artifact handed back with it");
      const same = await api("/versions", "POST", { markdown: "# Plan\n\nMine.\n", base: 2 });
      assert.deepEqual([same[0], same[1].unchanged, same[1].versions.length], [200, true, 2]);
      const forced = await api("/versions", "POST", { markdown: "# Plan\n\nAgain.\n", base: 1, force: true });
      assert.deepEqual([forced[0], forced[1].versions.at(-1).edited], [200, 1], "kept over it, from the version begun from");
      assert.deepEqual(await api("/versions", "POST", { markdown: "  ", base: 3 }), [400, { error: "The text is empty: give the Markdown to keep." }]);
      assert.deepEqual(await api("/versions", "POST", { markdown: "x", base: 4 }), [400, { error: "Give base: the version you began from, 1 to 3." }]);
      assert.deepEqual(await api("/versions", "POST", { markdown: "x" }), [400, { error: "Give base: the version you began from, 1 to 3." }]);
      assert.equal((await raw("/", { host: at(name) })).body.includes(JSON.stringify("# Plan\n\nAgain.\n")), true, "its address draws the newest text");
      await turn(id, "change it");
      assert.match(read, /Not published: Plan is at version 3, made by the developer, who edited version 1 in Filament, at .*, which this session has not read\. Here it is whole/, "the agent is told who changed it");
      assert.ok(read.endsWith("--- content.md (15 characters) ---\n# Plan\n\nAgain.\n"), read);
      await turn(id, "make a site");
      await until(() => heard.some((m) => m.type === "artifact" && m.title === "Site"), "the page heard");
      const site = heard.find((m) => m.type === "artifact" && m.title === "Site").name;
      const page = async (/** @type {string} */ path, /** @type {any} */ o = undefined) => {
        const r = await shim.api(`/api/artifacts/${site}${path}`, o);
        return [r.status, await r.json()];
      };
      assert.deepEqual(await page("/text"), [400, { error: "Site is a page its agent writes: it has no text to edit." }]);
      assert.deepEqual(await page("/versions", { method: "POST", body: { markdown: "x", base: 1 } }), [400, { error: "Site is a page its agent writes: ask for a change in its chat. A Doc or a deck is edited here." }]);
      assert.equal((await shim.api("/api/artifacts/nope-0000/text")).status, 404);
      await until(() => heard.filter((m) => m.type === "artifact" && m.name === name).length >= 3, "each version told");
      assert.deepEqual(heard.filter((m) => m.type === "artifact" && m.name === name).map((m) => m.v), [1, 2, 3]);
    } finally {
      stop();
    }
  });

  // (fails before: yes — a page kept nothing, and the agent had no write_db)
  test("a page's data through the front door: its own page writes it, the harness's page cannot; the agent's write_db in the loop; each told on the events stream; the harness reads the counts (AFC-90, AFC-92, AFC-95, AFC-97)", async () => {
    const { heard, stop } = await hear();
    try {
      const id = await create("agent/brain-model");
      let name = "";
      let wrote = "";
      let round = 0;
      brain = (call) => {
        round += 1;
        if (round === 1) return reply([toolUse("t1", "artifact", { action: "publish", title: "Tracker", html: "<p>t</p>" })], "tool_use");
        if (round === 3) return reply([toolUse("t2", "artifact", { action: "write_db", id: name, collection: "expenses", set: [{ id: "b", amount: 5 }] })], "tool_use");
        if (round === 4) wrote = String(resultOf(call));
        return reply([{ type: "text", text: "Done." }]);
      };
      await turn(id, "make a tracker");
      await until(() => heard.some((m) => m.type === "artifact" && m.title === "Tracker"), "v1 heard");
      name = heard.find((m) => m.type === "artifact" && m.title === "Tracker").name;
      const write = (/** @type {string} */ origin) => raw("/_filament/db/expenses", { host: at(name), method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ id: "a", amount: 12 }) });
      const refused = await write(`http://127.0.0.1:${shim.port}`);
      assert.deepEqual([refused.status, JSON.parse(refused.body)], [403, { error: "Only the artifact's own page writes its data." }]);
      const kept = await write(`http://${at(name)}`);
      assert.deepEqual([kept.status, JSON.parse(kept.body)], [200, { record: { id: "a", amount: 12 } }]);
      await turn(id, "add one");
      assert.equal(wrote, 'Kept in expenses of Tracker: set 1 record ("b"). Its page shows it at its next read, and at once where it follows changes.');
      const listed = await raw("/_filament/db/expenses", { host: at(name) });
      assert.deepEqual(JSON.parse(listed.body).records, [{ id: "a", amount: 12 }, { id: "b", amount: 5 }]);
      await until(() => heard.filter((m) => m.name === name && m.change === "data").length === 2, "both changes heard");
      assert.deepEqual(heard.filter((m) => m.name === name && m.change === "data"), [
        { type: "artifact", name, change: "data", collection: "expenses" },
        { type: "artifact", name, change: "data", collection: "expenses" },
      ]);
      assert.deepEqual((await (await shim.api(`/api/artifacts/${name}`)).json()).data, [{ name: "expenses", count: 2 }]);
    } finally {
      stop();
    }
  });

  // (fails before: yes — the bug hunt of 10-30, UISP-3: the Artifacts grid's previews ran each version's page on the
  // artifact's own address, so an old version's code wrote the live data and the app's database just by being shown)
  test("an app's still address, which the previews frame, reads its data and its database and changes neither; its own address writes as before", async () => {
    const { heard, stop } = await hear();
    try {
      const id = await create("agent/brain-model");
      let round = 0;
      brain = () => {
        round += 1;
        if (round === 1) return reply([toolUse("t1", "artifact", { action: "publish", type: "app", title: "Ledger", html: "<main></main>" })], "tool_use");
        return reply([{ type: "text", text: "Done." }]);
      };
      await turn(id, "make a ledger");
      await until(() => heard.some((m) => m.type === "artifact" && m.title === "Ledger"), "the app heard");
      const name = heard.find((m) => m.type === "artifact" && m.title === "Ledger").name;
      const still = `${name}.still.art.localhost:${shim.port}`;
      /** @param {string} host @param {string} path @param {any} body */
      const send = async (host, path, body) => {
        const r = await raw(path, { host, method: "POST", headers: { origin: `http://${host}`, "content-type": "application/json" }, body: JSON.stringify(body) });
        return [r.status, JSON.parse(r.body)];
      };
      const records = async (/** @type {string} */ host) => JSON.parse((await raw("/_filament/db/rows", { host })).body).records;
      assert.equal((await send(at(name), "/_filament/db/rows", { id: "a", n: 1 }))[0], 200);
      assert.equal((await send(at(name), "/_filament/sql", { sql: "CREATE TABLE t (x)" }))[0], 200);
      assert.equal((await send(at(name), "/_filament/sql", { sql: "INSERT INTO t VALUES (1)" }))[0], 200);
      assert.deepEqual(await records(still), [{ id: "a", n: 1 }]);
      assert.deepEqual((await send(still, "/_filament/sql", { sql: "SELECT x FROM t" }))[1].rows, [{ x: 1 }]);
      assert.equal((await raw("/_filament/v/1/", { host: still })).status, 200, "its page is served there");
      assert.deepEqual(await send(still, "/_filament/db/rows", { id: "b", n: 2 }), [403, { error: "A still preview of the artifact writes nothing: open it to change its data." }]);
      for (const sql of ["INSERT INTO t VALUES (2)", "DELETE FROM t", "CREATE TEMP TABLE z (y)", "PRAGMA user_version = 3"])
        assert.deepEqual(await send(still, "/_filament/sql", { sql }), [400, { error: "Not run: a still preview of the app reads its database and changes nothing." }], sql);
      assert.deepEqual((await send(at(name), "/_filament/sql", { sql: "SELECT count(*) AS n FROM t" }))[1].rows, [{ n: 1 }]);
      assert.deepEqual((await send(at(name), "/_filament/sql", { sql: "PRAGMA user_version" }))[1].rows, [{ user_version: 0 }]);
      assert.deepEqual(await records(at(name)), [{ id: "a", n: 1 }]);
    } finally {
      stop();
    }
  });

  // (fails before: yes — a visual stayed in its chat: nothing kept one as an artifact)
  test("a visual kept as an artifact: its code the page, its title in words, made by the developer in the chat's folder; kept once, then answered with it; the agent reads who made it (AFC-101, AFC-102)", async () => {
    const { heard, stop } = await hear();
    try {
      const id = await create("agent/brain-model");
      let name = "";
      let read = "";
      let round = 0;
      brain = (call) => {
        round += 1;
        if (round === 1) return reply([toolUse("k1", "show_visual", { title: "spend_by_month", code: "<p>spend</p>" })], "tool_use");
        if (round === 3) return reply([toolUse("k2", "artifact", { action: "read", id: name })], "tool_use");
        if (round === 4) read = String(resultOf(call));
        return reply([{ type: "text", text: "Done." }]);
      };
      const drawn = await turn(id, "draw my spend");
      const n = (await runEvents(drawn.runId)).find((/** @type {any} */ e) => e.type === "visual").turn;
      const keep = async (/** @type {any} */ body) => {
        const r = await shim.api("/api/artifacts", { method: "POST", body });
        return [r.status, await r.json()];
      };
      const looked = async () => (await (await shim.api(`/api/artifacts?chain=${encodeURIComponent(id)}&visual=k1`)).json()).artifacts;
      assert.deepEqual(await looked(), [], "none kept yet");
      const [status, kept] = await keep({ visual: { chain: id, turn: n, id: "k1" } });
      assert.equal(status, 200, JSON.stringify(kept));
      name = kept.name;
      assert.deepEqual([kept.title, kept.icon, kept.folder, kept.model, kept.already], ["Spend by month", "page", root, "", undefined]);
      assert.deepEqual(kept.versions.map((/** @type {any} */ v) => [v.v, v.chain, v.helper, v.call, v.from, v.visual, v.model]), [[1, id, null, null, null, "k1", ""]]);
      assert.equal((await raw("/", { host: at(name) })).body, servedPage("<p>spend</p>", "Spend by month"), "its address serves the visual's code");
      await until(() => heard.some((m) => m.type === "artifact" && m.name === name), "told on the events stream");
      assert.deepEqual((await looked()).map((/** @type {any} */ a) => a.name), [name], "found by its visual");
      const again = await keep({ visual: { chain: id, turn: n, id: "k1" } });
      assert.deepEqual([again[0], again[1].name, again[1].already], [200, name, true], "one visual keeps one artifact");
      assert.equal((await (await shim.api("/api/artifacts")).json()).artifacts.filter((/** @type {any} */ a) => a.versions.some((/** @type {any} */ v) => v.visual === "k1")).length, 1);
      assert.deepEqual((await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?work=held`)).json()).artifacts, undefined, "no card in the chat: no call published it");
      await turn(id, "read it");
      assert.match(read, /^Spend by month — [a-z0-9-]+, a page, version 1 of 1 \(the newest\), made by the developer, from a visual drawn in this session, at /);
      assert.deepEqual(await keep({}), [400, { error: "Give the visual to keep: { visual: { chain, turn, id } }." }]);
      assert.deepEqual(await keep({ visual: { chain: id, turn: n, id: "nope" } }), [404, { error: "Not kept: no such visual in this turn." }]);
      assert.deepEqual(await keep({ visual: { chain: id, turn: null, id: "nope" } }), [404, { error: "Not kept: no such visual in this session." }]);
    } finally {
      stop();
    }
  });

  // (fails before: yes — there was no store to break)
  test("a record that does not read: its address says so, and the list leaves it out (AFC-60)", async () => {
    mkdirSync(join(shim.dataDir, "artifacts", "broken-aaaa"), { recursive: true });
    writeFileSync(join(shim.dataDir, "artifacts", "broken-aaaa", "artifact.json"), "{ not json");
    const r = await raw("/", { host: at("broken-aaaa") });
    assert.deepEqual([r.status, r.body], [500, "The artifact broken-aaaa could not be read from Filament's store.\n"]);
    let listed = "";
    let round = 0;
    brain = (call) => (++round === 1 ? reply([toolUse("l1", "artifact", { action: "list" })], "tool_use") : ((listed = String(resultOf(call))), reply([{ type: "text", text: "Listed." }])));
    const id = await create("agent/brain-model");
    await turn(id, "list them");
    assert.match(listed, /^(\d+ artifacts?\.|No artifacts yet\.)/);
    assert.ok(!listed.includes("broken-aaaa"), listed);
    assert.ok(!(await (await shim.api("/api/artifacts")).json()).artifacts.some((/** @type {any} */ a) => a.name === "broken-aaaa"), "nor the harness's list");
    const one = await shim.api("/api/artifacts/broken-aaaa");
    assert.deepEqual([one.status, await one.json()], [500, { error: "The artifact broken-aaaa could not be read from Filament's store." }]);
  });
});
