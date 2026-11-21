// @ts-check
// The shared dashboard kit (`src/ui/lib`). These helpers are the seam the harness page and a future
// Electron shell import; a silent change here is a silent change on every surface.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { esc, md, mdDoc, mdBlock } from "../src/ui/lib/md.js";
import { fmt, serverBase } from "../src/ui/lib/format.js";
import { createApi } from "../src/ui/lib/api.js";
import { commitFocused } from "../src/ui/lib/dom.js";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("ui/lib/md", () => {
  test("escapes before it formats, and never passes HTML through", () => {
    assert.equal(esc("<script>"), "&lt;script&gt;");
    assert.equal(esc('say "hi" & x'), "say &quot;hi&quot; &amp; x");
    assert.equal(md("use `code` and **bold**"), "use <code>code</code> and <b>bold</b>");
    assert.equal(md("<b>raw</b>"), "&lt;b&gt;raw&lt;/b&gt;");
    assert.equal(mdDoc("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });
  test("mdDoc builds headings, fences, tables, quotes and safe links", () => {
    const html = mdDoc(
      "# Title\n\nA paragraph with `x`.\n\n- one\n- two\n\n```js\n<>&\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> quote\n\n[out](https://example.com)\n[jump](#section)\n\n---\n",
      "docs",
    );
    assert.match(html, /<h1 id="docs-title">Title<\/h1>/);
    assert.match(html, /<code>x<\/code>/);
    assert.match(html, /<li>one<\/li>/);
    assert.match(html, /<pre data-lang="js"><code>&lt;&gt;&amp;<\/code><\/pre>/, "a fence keeps its language (E18 step 6)");
    assert.match(html, /<th>a<\/th>/);
    assert.match(html, /<blockquote>quote<\/blockquote>/);
    assert.match(html, /href="https:\/\/example.com" target="_blank" rel="noopener"/);
    assert.match(html, /data-doc-link="docs-section"/);
    assert.match(html, /<hr>/);
  });
  // (fails before: yes — the production-readiness bug hunt of 10-30: a skill's file, drawn in the Library on Filament's own
  // page, loaded any web picture as it was drawn — a tracker, or Filament's own API asked as the person)
  test("mdDoc draws a picture by a reply's rule: another host's behind its chip, Filament's own address and data as words; an artifact's page draws its own at once", () => {
    const chip = mdDoc("![chart](https://evil.example/p.png?d=1)", "skill");
    assert.ok(!chip.includes("<img"), chip);
    assert.match(chip, /<button type="button" class="md-img-load" data-src="https:\/\/evil\.example\/p\.png\?d=1" data-alt="chart" title="Load this image from evil\.example">Show image<\/button>/);
    assert.equal(mdDoc("![test it](/api/upstreams/u/test)", "skill"), "<p>test it</p>");
    assert.equal(mdDoc("![x](data:image/png;base64,AAA)", "skill"), "<p>x</p>", "data is its words, as in a reply");
    const was = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", { value: { origin: "http://127.0.0.1:20300" }, configurable: true });
    try {
      assert.equal(mdDoc("![keys](http://127.0.0.1:20300/api/keys)", "skill"), "<p>keys</p>", "this page's origin written whole");
    } finally {
      if (was) Object.defineProperty(globalThis, "location", was);
      else Reflect.deleteProperty(globalThis, "location");
    }
    assert.equal(mdDoc("![a cat](https://cdnjs.cloudflare.com/x.png)", "h", { held: false }), '<p><img src="https://cdnjs.cloudflare.com/x.png" alt="a cat" loading="lazy"></p>', "an artifact's page, whose policy keeps its pictures to its hosts");
    assert.equal(mdDoc("![x](data:image/png;base64,AAA)", "h", { held: false }), '<p><img src="data:image/png;base64,AAA" alt="x" loading="lazy"></p>', "and its pictures by data");
  });
  test("mdBlock is the chat-bubble subset", () => {
    assert.equal(
      mdBlock("```\n<>\n```\n\n- item\n\npara"),
      "<pre>&lt;&gt;\n</pre><ul><li>item</li></ul><p>para</p>",
    );
  });
  test("the console's pages write no single-asterisk italics: md() draws code and bold only, so a *word* prints its asterisks", () => {
    assert.equal(md("*same*"), "*same*", "the rule the scan below holds the pages to");
    /** @type {string[]} */
    const found = [];
    const dir = join(ROOT, "src/ui/pages");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
      for (const [, lit] of readFileSync(join(dir, f), "utf8").matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
        const prose = lit.replace(/`[^`]*`/g, "").replace(/\*\*[^*]+\*\*/g, "");
        const m = prose.match(/(?:^|[^\w*])\*[A-Za-z][^*]*\*(?!\*)/);
        if (m) found.push(`${f}: ${m[0].trim()}`);
      }
    }
    assert.deepEqual(found, []);
  });
});

describe("ui/lib/format", () => {
  test("missing numbers are an en-dash, never 0 or undefined", () => {
    assert.equal(fmt.n(null), "–");
    assert.equal(fmt.ms(undefined), "–");
    assert.equal(fmt.usd(null), "–");
    assert.equal(fmt.ms(250), "250 ms");
    assert.equal(fmt.usd(1.5), "$1.5000");
    assert.equal(fmt.pct(0.42), "42%");
  });
  // (fails before: the ping chip showed `failed (404): {"timestamp":"…","status":404,"error":"Not Found","path":"/v4/` —
  // 90 characters of a JSON body, cut before the useful part; BUG-03)
  test("errorGist: a JSON error body reads as its message (and a gateway's path), plain text as itself", () => {
    assert.equal(
      fmt.errorGist('{"timestamp":"2026-09-30T12:26:15.776+00:00","status":404,"error":"Not Found","path":"/v4/v1/responses"}'),
      "Not Found — /v4/v1/responses",
      "a Spring-style gateway 404 (z.ai)",
    );
    assert.equal(fmt.errorGist('{"error":{"message":"model not found: glm-9","type":"invalid_request_error"}}'), "model not found: glm-9");
    assert.equal(fmt.errorGist('upstream zai returned 404: {"error":{"message":"no such model"}}'), "upstream zai returned 404: no such model", "a prefix before the body stays");
    assert.equal(fmt.errorGist('{"detail":"Unauthorized"}'), "Unauthorized");
    assert.equal(fmt.errorGist("no answer within 3 minutes"), "no answer within 3 minutes");
    assert.equal(fmt.errorGist('{"weird":1}'), '{"weird":1}', "a body with nothing to say stays as it is");
    assert.equal(fmt.errorGist("{not json"), "{not json");
    assert.equal(fmt.errorGist(null), "");
  });
  // (fails before: yes — the owner's look of 10-25: a side agent's card read "Claude Opus 5.5 · 9762k · $6.6163")
  test("k: a token count in a word's room, millions in M as the Brief says them", () => {
    assert.deepEqual([840, 4_100, 82_400, 999_499, 999_500, 1_000_000, 1_240_000, 9_762_000, 12_400_000].map(fmt.k), ["840", "4.1k", "82k", "999k", "1M", "1M", "1.2M", "9.8M", "12M"]);
  });
});

describe("ui/lib/api", () => {
  test("createApi prefixes the path, sends the UI header, and surfaces the error body", async () => {
    /** @type {any[]} */
    const calls = [];
    const api = createApi({
      base: "http://shim/api",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          json: async () => ({ ok: true, url }),
        };
      },
    });
    const j = await api("/state", { body: { a: 1 } });
    assert.equal(j.ok, true);
    assert.equal(calls[0].url, "http://shim/api/state");
    assert.equal(calls[0].init.headers["x-filament-ui"], "1");
    assert.equal(calls[0].init.headers["content-type"], "application/json");
    assert.equal(calls[0].init.body, JSON.stringify({ a: 1 }));

    const failing = createApi({
      fetchImpl: async () => ({ ok: false, statusText: "Nope", json: async () => ({ error: "nope" }) }),
    });
    await assert.rejects(() => failing("/x"), { message: "nope" });
  });
});

describe("ui/lib/dom", () => {
  // (fails before: yes — the bug hunt of 10-30, UIST-1: Ctrl+S saved without the edit in the field being typed in, whose change waits for a blur that a key press never makes)
  test("commitFocused: the field being typed in gives up the focus, its change firing on the way, before Ctrl+S saves", () => {
    /** A field as a browser keeps one: its edit reaches the form at its change, which its blur fires. @param {string} tagName */
    const field = (tagName) => {
      /** @type {any} */
      const el = { tagName, value: "", committed: "", blurred: 0, onchange: null };
      el.blur = () => {
        el.blurred++;
        if (el.value !== el.committed) {
          el.committed = el.value;
          el.onchange?.();
        }
      };
      return el;
    };
    const draft = { baseUrl: "" };
    const input = field("INPUT");
    input.onchange = () => { draft.baseUrl = input.value; };
    input.value = "https://api.example/v1";
    commitFocused({ activeElement: input });
    assert.equal(draft.baseUrl, "https://api.example/v1", "the edit is the draft's before the save reads it");
    for (const tag of ["TEXTAREA", "SELECT"]) {
      const f = field(tag);
      commitFocused({ activeElement: f });
      assert.equal(f.blurred, 1, `a ${tag.toLowerCase()} gives the focus up too`);
    }
    const button = field("BUTTON");
    commitFocused({ activeElement: button });
    assert.equal(button.blurred, 0, "anything else keeps it");
    assert.doesNotThrow(() => commitFocused({ activeElement: null }));
    // The console's Ctrl+S calls it before it reads whether there is anything to save.
    assert.match(
      readFileSync(join(ROOT, "src/ui/app.js"), "utf8"),
      /e\.key\.toLowerCase\(\) === "s"\) \{ e\.preventDefault\(\); commitFocused\(\); if \(state\.dirty && !\$\("#save"\)\.disabled\) \$\("#save"\)\.click\(\); return; \}/,
    );
  });
});

// (fails before: yes — the bug hunt of 10-30, DESK-9's siblings: the console's Copy base URL, Home and Docs wrote
// `http://::1:20300` and `http://:::20300` for an IPv6 host, addresses no client can read)
test("serverBase: the console's address for every host a server listens on", () => {
  assert.equal(serverBase({ host: "127.0.0.1", port: 20300 }), "http://127.0.0.1:20300");
  assert.equal(serverBase({ host: "0.0.0.0", port: 20300 }), "http://localhost:20300");
  assert.equal(serverBase({ host: "::", port: 20300 }), "http://localhost:20300");
  assert.equal(serverBase({ host: "::1", port: 20300 }), "http://[::1]:20300");
  assert.equal(serverBase({ host: "fe80::1", port: 8 }), "http://[fe80::1]:8");
  assert.equal(serverBase({ host: "box.lan", port: 8 }), "http://box.lan:8");
  for (const host of ["::1", "fe80::1"]) assert.doesNotThrow(() => new URL(serverBase({ host, port: 1 })));
});
