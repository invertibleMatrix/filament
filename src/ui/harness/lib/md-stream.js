// @ts-check
// The harness's streaming markdown: escape first, format second, no HTML passthrough — the same posture as
// `ui/lib/md.js`, but block-splittable, so a streaming reply re-renders only its open tail. A closed block's HTML is
// stable (its text never changes again), so `mdChat` caches rendered blocks by their exact text and reuses them;
// the stream's per-token cost is the open block, never the transcript. Fences are a card
// (language · Wrap · Copy) over a plain <pre>; the vendored shiki bundle (lib/highlighter.js) paints the closed
// ones in place afterwards. Math reaches KaTeX (vendored); ```mermaid fences become diagrams
// (lib/diagrams.js, vendored mermaid); task lists render as checkboxes.

import { esc, imageHtml, ownApi, showImage, unesc } from "../../lib/md.js";
import { prefs } from "../prefs.js";
import { ICONS } from "./icons.js";
import { CHAT_LINK } from "./labels.js";
import { chatLinkHtml } from "./chat-link.js";

/**
 * @typedef {object} MdBlock
 * @property {"paragraph"|"fence"|"heading"|"list"|"quote"|"rule"|"table"} kind
 * @property {string} text  the block's exact source (its cache key)
 * @property {boolean} closed  false while the stream can still append to this block
 */

/**
 * KaTeX over raw TeX, or null when katex is not loaded / the input is not really math. The caller extracted the
 * span before escaping, so the TeX arrives raw; throwOnError off means a bad formula renders as red source, never
 * a broken reply.
 * @param {string} tex @param {boolean} display
 */
function katexHtml(tex, display) {
  const k = /** @type {any} */ (globalThis).katex;
  if (!k) return null;
  try {
    return k.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
  } catch {
    return null;
  }
}

/** A picture's rule is every surface's (lib/md.js `imageHtml`): the person's ask to see one, kept for the page's life. */
export { showImage };

/**
 * Inline formatting with math pulled aside: $...$ pairs that look like math (no edge spaces, not a bare currency
 * amount) and the rare inline $...$. Everything else goes through the escape-first pipeline untouched. With `breaks`,
 * the text's own line breaks become <br> before the math goes back in, so none lands inside what KaTeX drew (its SVG
 * paths hold newlines).
 * @param {string} s @param {boolean} [breaks]
 */
export function inline(s, breaks = false) {
  /** @type {string[]} */
  const maths = [];
  const src = String(s).replace(/\$\$([^$]+)\$\$|\$(?![\s$])([^$]*[^\s$])\$/g, (whole, dd, d) => {
    const tex = dd != null ? dd : d;
    // A "$5 and $10" false positive: the captured span has no math-ish character at all — leave it as text.
    if (!/[=^_\\{}]|\\[a-zA-Z]+|[a-zA-Z]\s*[=<>]/.test(tex)) return whole;
    const html = katexHtml(tex, dd != null);
    if (!html) return whole;
    maths.push(html);
    return `\u0001${maths.length - 1}\u0001`;
  });
  const plain = inlinePlain(src);
  return (breaks ? plain.replace(/\n/g, "<br>") : plain).replace(/\u0001(\d+)\u0001/g, (_, i) => maths[Number(i)]);
}

/** The escape-first inline pipeline, unchanged. @param {string} s */
function inlinePlain(s) {
  const codes = [];
  let out = esc(s).replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // A tagged chat (`chatTag`'s `[title](chat:<id>)`, its title's brackets escaped): the chat's link, as your bubble
  // draws it — its title as written, no emphasis or code in it — and a press opens the chat, or says it is no longer
  // kept (chat-open.js).
  /** @type {string[]} */
  const chats = [];
  out = out.replace(CHAT_LINK, (_, title, id) => {
    const words = title.replace(/\u0000(\d+)\u0000/g, (/** @type {string} */ _c, /** @type {string} */ i) => `\`${codes[Number(i)]}\``);
    chats.push(chatLinkHtml(words.replace(/\\(.)/g, "$1"), id));
    return `\u0002${chats.length - 1}\u0002`;
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s("“])\*([^*\s][^*]*?)\*(?=[\s).,;:!?”»]|$)/g, "$1<i>$2</i>")
    .replace(/(^|[\s("“])_([^_\s][^_]*?)_(?=[\s).,;:!?”»]|$)/g, "$1<i>$2</i>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>");
  // Images before links: the link rule would otherwise swallow `![alt](url)` as a link.
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
    const u = esc(url).replace(/&amp;/g, "&");
    return /^(https?:\/\/|\/)/.test(u) ? imageHtml(u, esc(alt).replace(/&amp;/g, "&")) : esc(alt);
  });
  // A link to Filament's own API is its words (`ownApi`): a click would have the page ask it as the person, and a reply
  // links nothing there. Filament's pages (`#/…`, `/ui/…`) stay links.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => {
    const u = esc(url).replace(/&amp;/g, "&");
    return /^(https?:\/\/|\/|#)/.test(u) && !ownApi(unesc(u)) ? `<a href="${u}" target="_blank" rel="noopener">${txt}</a>` : txt;
  });
  // A bare URL on its own words is a link too, but for one of Filament's own API.
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, u) => (ownApi(unesc(u)) ? `${pre}${u}` : `${pre}<a href="${u}" target="_blank" rel="noopener">${u}</a>`));
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`).replace(/\u0002(\d+)\u0002/g, (_, i) => chats[Number(i)]);
}

const KW = /^(?:if|else|for|while|return|function|const|let|var|class|async|await|import|export|from|new|try|catch|throw|switch|case|break|continue|default|typeof|instanceof|in|of|void|this|super|extends|static|yield|delete|true|false|null|undefined|def|elif|pass|None|True|False|fn|mut|pub|use|mod|impl|struct|enum|match|package|func|type|interface|map|chan|go|defer|select|range)$/;

/**
 * Paint already-escaped fence text with six classes (comment/string/number/keyword/function/tag).
 * Operates on escaped HTML so a token can never become a tag.
 * @param {string} escaped
 */
export function paintCode(escaped) {
  const src = String(escaped || "");
  let out = "";
  let i = 0;
  const n = src.length;
  const push = (cls, s) => {
    out += cls ? `<span class="tok-${cls}">${s}</span>` : s;
  };
  while (i < n) {
    const rest = src.slice(i);
    const line = rest.match(/^(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))/);
    if (line && src[i] === "/") {
      push("comment", line[1]);
      i += line[1].length;
      continue;
    }
    const str = rest.match(/^(&quot;(?:(?!&quot;).)*&quot;|'(?:\\.|[^'\\])*'|`(?:\\.|[^`])*`)/);
    if (str) {
      push("string", str[1]);
      i += str[1].length;
      continue;
    }
    if (src[i] === "&" && rest.startsWith("&lt;/")) {
      const tag = rest.match(/^&lt;\/?[A-Za-z][\w:-]*[^&]*&gt;/);
      if (tag) {
        push("tag", tag[0]);
        i += tag[0].length;
        continue;
      }
    }
    if (src[i] === "&" && rest.startsWith("&lt;")) {
      const tag = rest.match(/^&lt;\/?[A-Za-z][\w:-]*[^&]*&gt;/);
      if (tag) {
        push("tag", tag[0]);
        i += tag[0].length;
        continue;
      }
    }
    const num = rest.match(/^\d+(?:\.\d+)?/);
    if (num && (i === 0 || !/[A-Za-z_$]/.test(src[i - 1] || ""))) {
      push("number", num[0]);
      i += num[0].length;
      continue;
    }
    const word = rest.match(/^[A-Za-z_$][\w$]*/);
    if (word) {
      const next = src.slice(i + word[0].length).trimStart();
      if (KW.test(word[0])) push("keyword", word[0]);
      else if (next.startsWith("(")) push("function", word[0]);
      else out += word[0];
      i += word[0].length;
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

/** A fence's opening run: three or more backticks, or tildes. */
const FENCE_OPEN = /^(`{3,}|~{3,})/;
/**
 * Whether a line closes the fence a run opened, as CommonMark has it: that run's character alone, at least as many of
 * it, nothing after — so a shorter run, or one with words after it (```js), is the fence's own text, as in a reply
 * that shows a fence inside a longer one.
 * @param {string} line @param {string} mark  the run that opened the fence
 */
const closesFence = (line, mark) => {
  const t = line.trim();
  return t.length >= mark.length && t === mark[0].repeat(t.length);
};

/**
 * Split source into top-level blocks. A fence is one block from its opening line to its closing line (or EOF, open);
 * everything else ends at a blank line. The LAST block is open; a fence that has no closing line yet is open too.
 * @param {string} src
 * @returns {MdBlock[]}
 */
export function splitBlocks(src) {
  const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
  /** @type {MdBlock[]} */
  const blocks = [];
  /** @type {string[]} */
  let cur = [];
  /** @type {MdBlock["kind"]} */
  let kind = "paragraph";
  let fence = false;
  let fenceMark = "";
  const flush = (closed) => {
    const text = cur.join("\n");
    cur = [];
    if (!text.trim()) return;
    blocks.push({ kind, text, closed });
    kind = "paragraph";
  };
  const classify = (ls) => {
    const first = ls[0] || "";
    if (/^#{1,6}\s/.test(first)) return "heading";
    if (/^\s*([-*+] |\d+[.)] )/.test(first)) return "list";
    if (/^>\s?/.test(first)) return "quote";
    if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(first)) return "rule";
    if (/^\s*\|.*\|\s*$/.test(first) && ls.length > 1 && /^\s*\|[\s:|-]+\|\s*$/.test(ls[1] || "")) return "table";
    return "paragraph";
  };
  for (const line of lines) {
    if (fence) {
      cur.push(line);
      if (closesFence(line, fenceMark)) {
        blocks.push({ kind: "fence", text: cur.join("\n"), closed: true });
        cur = [];
        fence = false;
      }
      continue;
    }
    const t = line.trim();
    const opened = FENCE_OPEN.exec(t);
    if (opened) {
      flush(true);
      fence = true;
      fenceMark = opened[1];
      cur = [line];
      continue;
    }
    if (!t) {
      flush(true);
      continue;
    }
    if (!cur.length) kind = classify([line]);
    else {
      // A table's first line looks like a paragraph until the separator arrives (streamed markdown).
      if (kind === "paragraph" && cur.length === 1 && /^\s*\|.*\|\s*$/.test(cur[0]) && /^\s*\|[\s:|-]+\|\s*$/.test(line)) kind = "table";
      // A list/quote/table swallows only its own lines; anything else closes it.
      const want = kind === "list" ? /^\s*([-*+] |\d+[.)] |  +\S)/ : kind === "quote" ? /^>\s?/ : kind === "table" ? /^\s*\|/ : kind === "rule" || kind === "heading" ? /^$/ : /./;
      if (kind !== "paragraph" && !want.test(line)) flush(true), (kind = classify([line]));
      if (kind === "rule" || kind === "heading") flush(true), (kind = "paragraph");
    }
    cur.push(line);
  }
  // The tail is open: the stream may add to it (or close the fence).
  if (cur.length || fence) {
    if (fence) blocks.push({ kind: "fence", text: cur.join("\n"), closed: false });
    else flush(false);
  }
  return blocks;
}

/** The current theme's name, for elements whose paint depends on it (math is theme-agnostic; kept for symmetry). */
function themeStamp() {
  return document.documentElement.classList.contains("theme-zai-light") ? "light" : "dark";
}

/**
 * A list's items: consecutive markers, a continuation indented under one. A "[ ]"/"[x]" lead token makes the item
 * a task — carried as a \u0002 marker for the renderer, stripped from the body.
 * @param {string} text
 */
function listItems(text) {
  /** @type {string[]} */
  const items = [];
  let ordered = /^\s*\d/.test(text);
  for (const line of text.split("\n")) {
    const m = /^\s*(?:[-*+] |\d+[.)] )(.*)$/.exec(line);
    if (m) items.push(m[1]);
    else if (items.length && /^\s+\S/.test(line)) items[items.length - 1] += "\n" + line.trim();
    else items.push(line.trim());
  }
  return { items, ordered };
}

/** A table's rows (the separator line dropped), each a list of cells. @param {string} text */
function tableRows(text) {
  return text
    .split("\n")
    .filter((l, i) => i !== 1)
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
}

/**
 * One block as HTML. Everything went through `esc` before any tag is added.
 * @param {MdBlock} b
 */
export function renderBlock(b) {
  switch (b.kind) {
    case "fence": {
      const lines = b.text.split("\n");
      // The words after the opening run, however long it is.
      const info = (lines[0] || "").trim().replace(FENCE_OPEN, "").trim();
      const end = b.closed && lines.length > 1 ? lines.length - 1 : lines.length;
      const code = lines.slice(1, end).join("\n");
      const lang = /^[A-Za-z0-9_+-]{1,20}$/.test(info) ? info.toLowerCase() : "";
      if (lang === "mermaid" && b.closed) {
        // The diagram replaces the source once lib/diagrams.js runs; until then the source is what shows, which is
        // also the honest fallback when mermaid cannot load or cannot parse it.
        return `<div class="mermaid-block" data-src="${esc(encodeURIComponent(code))}"><div class="code-block" data-lang="mermaid"><div class="code-head"><span class="code-lang">mermaid</span><span class="grow"></span><button type="button" class="code-copy" aria-label="Copy source">${ICONS.copy}</button></div><pre class="code"><code>${esc(code)}</code></pre></div></div>`;
      }
      const head = `<div class="code-head"><span class="code-lang">${esc(lang)}</span><span class="grow"></span><button type="button" class="code-wrap" aria-label="Wrap lines">${ICONS.wrap}</button><button type="button" class="code-copy" aria-label="Copy code">${ICONS.copy}</button></div>`;
      return `<div class="code-block"${lang ? ` data-lang="${esc(lang)}"` : ""}${b.closed ? "" : " data-open=\"\""}>${head}<pre class="code"><code>${esc(code)}</code></pre></div>`;
    }
    case "heading": {
      const m = /^(#{1,6})\s+(.*)$/.exec(b.text.trim());
      if (!m) return `<p>${inline(b.text)}</p>`;
      const depth = m[1].length;
      const lvl = Math.min(6, depth + 2);
      return `<h${lvl} class="md-h md-h${depth}">${inline(m[2])}</h${lvl}>`;
    }
    case "list": {
      const { items, ordered } = listItems(b.text);
      const tag = ordered ? "ol" : "ul";
      return `<${tag} class="md-list">${items
        .map((i) => {
          // A task item's "[ ]"/"[x]" lead becomes a checkbox glyph before the body is formatted.
          const task = /^\[([ xX])\]\s+/.exec(i);
          const body = inline(task ? i.slice(task[0].length) : i, true);
          const box = task ? `<span class="task-box${task[1] === " " ? "" : " on"}" aria-hidden="true"></span>` : "";
          return task ? `<li class="md-task">${box}${body}</li>` : `<li>${body}</li>`;
        })
        .join("")}</${tag}>`;
    }
    case "quote":
      return `<blockquote>${b.text.split("\n").map((l) => inline(l.replace(/^>\s?/, ""))).join("<br>")}</blockquote>`;
    case "rule":
      return `<hr>`;
    case "table": {
      const rows = tableRows(b.text);
      const head = rows[0] || [];
      const body = rows.slice(1);
      // The toolbar (Copy Markdown · Download CSV) rides the table on hover.
      const bar = `<div class="table-bar"><button type="button" class="table-copy" aria-label="Copy Markdown">${ICONS.copy}</button><button type="button" class="table-csv" aria-label="Download CSV">${ICONS.download}</button></div>`;
      return `<div class="table-wrap">${bar}<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    default: {
      // A paragraph that is exactly one $$...$$ span is display math; katex absent or a parse miss leaves text.
      const t = b.text.trim();
      const dm = /^\$\$([\s\S]+?)\$\$$/.exec(t);
      const math = dm ? katexHtml(dm[1].trim(), true) : null;
      if (math) return `<div class="md-math">${math}</div>`;
      return `<p>${inline(b.text, true)}</p>`;
    }
  }
}

/** The performance-mode paint of one block: the source as plain (still escaped) text, no markdown structure. @param {MdBlock} b */
function renderPlain(b) {
  return `<p class="md-plain">${esc(b.text).replace(/\n/g, "<br>")}</p>`;
}

/**
 * Render chat markdown with a cache: `prev` is the result of the previous call (or null); blocks whose exact text
 * already rendered are reused, only the changed tail re-renders. `html` is what the caller assigns through setHtml.
 * With the Appearance "Performance mode" switch on, the streaming (open) tail paints as plain text — a closed
 * block's markdown is never discarded, and a plain paint never enters the cache, so switching the mode back
 * re-renders it as markdown.
 * @param {string} src
 * @param {{ blocks: MdBlock[], html: string[], plain?: boolean[] } | null} prev
 * @returns {{ blocks: MdBlock[], html: string[], plain: boolean[], out: string }}
 */
export function mdChat(src, prev) {
  const blocks = splitBlocks(src);
  const plainMode = prefs.get("performanceMode") === true;
  /** @type {string[]} */
  const html = [];
  /** @type {boolean[]} */
  const plain = [];
  const prevHtml = prev?.html || [];
  const prevPlain = prev?.plain || [];
  /** @type {Map<string, string>} */
  const cache = new Map();
  (prev?.blocks || []).forEach((b, i) => {
    if (!prevPlain[i]) cache.set(b.text, prevHtml[i]);
  });
  for (const b of blocks) {
    // Only a CLOSED block may come from the cache: an open one may still grow.
    const isPlain = plainMode && !b.closed;
    const hit = !isPlain && b.closed ? cache.get(b.text) : undefined;
    plain.push(isPlain);
    html.push(hit !== undefined ? hit : isPlain ? renderPlain(b) : renderBlock(b));
  }
  return { blocks, html, plain, out: html.join("") };
}
