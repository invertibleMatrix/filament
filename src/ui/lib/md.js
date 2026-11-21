// @ts-check
// Markdown renderers for every browser surface. Escape first, format second — no HTML passthrough.
// `md` is inline (code + bold); `mdBlock` is chat-bubble sized; `mdDoc` is the Docs page, a skill's files, and an
// artifact's Doc and Slides (HarnessV4_Artifacts_Plan E18 step 6), whose pages draw a fence by its language
// (`data-lang`). The pictures' rule every surface keeps is here (`imageHtml`): another host's behind a chip, the page's
// own address as words; the harness's streaming Markdown (harness/lib/md-stream.js) draws a reply's by it.

/** @param {any} s */
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** What `esc` wrote, read back. @param {string} s */
export const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/** Images from other hosts the person asked to see, by address: drawn at once for the rest of this page's life. */
const shownImages = new Set();
/** Another host's address: with its scheme, or without as a browser reads it — `//host`, and `/\host`, whose backslash
 *  it reads as a slash. */
const ANOTHER_HOST = /^(?:https?:)?[/\\]{2}/i;
/** A path the page's own server serves: one slash, and after it neither a second nor a backslash (`ANOTHER_HOST`). @param {string} u */
const ownPath = (u) => /^\/(?![/\\])/.test(u);
/** This page's origin; "" where there is none to judge by (no page, or one of no web address). */
const pageOrigin = () => {
  const o = typeof location === "undefined" ? "" : String(location.origin || "");
  return o === "null" ? "" : o;
};
/**
 * Whether an address is the page's own — on Filament's pages, Filament's: a path its server serves, or this page's
 * origin written whole (`http://…`, `//…`, `/\…`), read as the browser reads it. @param {string} u  as written
 */
function ownAddress(u) {
  if (ownPath(u)) return true;
  const here = pageOrigin();
  if (!here) return false;
  try {
    return new URL(u, here).origin === here;
  } catch {
    return false;
  }
}

/**
 * Whether an address is Filament's own API: one of the page's own (`ownAddress`) whose path lies under `/api`, where a
 * read can act for the person — an upstream's paid test, the model lists fetched afresh. @param {string} u  as written
 */
export function ownApi(u) {
  if (!ownAddress(u)) return false;
  try {
    return /^\/api(?:\/|$)/.test(new URL(u, pageOrigin() || "http://page.invalid").pathname);
  } catch {
    return false;
  }
}

/**
 * The person asked for an image from another host (its chip's button): its address is drawn from now on, so a redraw
 * of the text does not hide it again. Only such an address is ever kept, never one of the page's own.
 * @param {string} src  the address, as written
 */
export function showImage(src) {
  if (ANOTHER_HOST.test(String(src)) && !ownAddress(String(src))) shownImages.add(String(src));
}

/**
 * A picture in Markdown a page draws by its address — a reply's, a skill's file's, the Docs': from another host alone,
 * and only behind a chip. Drawing it is a request to that host, carrying whatever its address holds, that nobody
 * clicked — a reply, a tool result the model repeats or a file someone else wrote could call out to any address
 * (fable51's F5). The chip names the host the request would reach; its button loads the image. One on the page's own
 * address — a path, or its origin written whole — is its words alone: on Filament's pages the request would ask
 * Filament's API as the person, where some reads act, and nothing such text shows comes from there. `u` and `alt`
 * arrive escaped.
 * @param {string} u @param {string} alt
 */
export function imageHtml(u, alt) {
  if (ownAddress(unesc(u))) return alt;
  if (shownImages.has(unesc(u))) return `<span class="md-img"><img src="${u}" alt="${alt}" loading="lazy"></span>`;
  const at = (/^(?:https?:)?[/\\]{2}([^/\\?#]*)/i.exec(u) || [])[1] || "";
  const host = at.slice(at.lastIndexOf("@") + 1) || "another site";
  return `<span class="md-img-held"><button type="button" class="md-img-load" data-src="${u}" data-alt="${alt}" title="Load this image from ${host}">Show image</button><span class="md-img-from">${alt ? `${alt} · ` : ""}${host}</span></span>`;
}

// The chip's button, wherever the Markdown was drawn: the image takes the chip's place.
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const btn = /** @type {HTMLElement | null} */ (/** @type {any} */ (e.target)?.closest?.(".md-img-load"));
    const held = btn?.closest(".md-img-held");
    const src = btn?.getAttribute("data-src") || "";
    if (!btn || !held || !ANOTHER_HOST.test(src) || ownAddress(src)) return;
    showImage(src);
    const img = document.createElement("img");
    img.src = src;
    img.alt = btn.getAttribute("data-alt") || "";
    img.loading = "lazy";
    const wrap = document.createElement("span");
    wrap.className = "md-img";
    wrap.append(img);
    held.replaceWith(wrap);
  });
}

/** @param {any} s */
export function md(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

/**
 * Full markdown for the Docs page: headings with ids, paragraphs, nested lists and task lists, tables, fenced code
 * with its language, quotes, rules, links (internal ones jump inside the page), pictures by a reply's rule (`imageHtml`),
 * inline code / bold / italic / struck. Deliberately small; no HTML passthrough.
 * @param {any} src
 * @param {string} [idPrefix]
 * @param {{ held?: boolean }} [o]  `held` false: every picture by a web or data address is drawn at once — an
 *   artifact's page, whose own policy keeps its pictures to its library hosts and itself
 */
export function mdDoc(src, idPrefix = "docs", { held = true } = {}) {
  const slug = (t) =>
    t
      .toLowerCase()
      .replace(/`/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section";
  const inline = (t) => {
    const codes = [];
    let s = esc(t).replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = s
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>")
      .replace(/(^|[\s("“])\*([^*\s][^*]*?)\*(?=[\s).,;:!?"”]|$)/g, "$1<i>$2</i>")
      .replace(/(^|[\s("“])_([^_\s][^_]*?)_(?=[\s).,;:!?"”]|$)/g, "$1<i>$2</i>");
    // A picture by a web address waits behind its chip, and one of the page's own address is its words (`imageHtml`, the
    // rule a reply's pictures keep); one by data is its words, as a reply's is. Where the page's own policy keeps its
    // pictures to its hosts and itself (`held` false), one by a web or data address is drawn at once. Any other address
    // leaves its words.
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) =>
      !held && /^(https?:\/\/|data:image\/)/i.test(url)
        ? `<img src="${url}" alt="${alt}" loading="lazy">`
        : held && /^(https?:\/\/|\/)/i.test(url)
          ? imageHtml(url, alt)
          : alt);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => {
      if (url.startsWith("#")) {
        const id = `${idPrefix}-${url
          .slice(1)
          .replace(/^\d+-/, "")
          .replace(/[^a-z0-9-]/g, "")}`;
        return `<a href="#${idPrefix}:${url.slice(1)}" data-doc-link="${id}">${txt}</a>`;
      }
      return /^(https?:\/\/|\/)/.test(url)
        ? `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`
        : txt;
    });
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  };
  const lines = String(src || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const out = [];
  const used = new Map();
  const uniq = (id) => {
    const n = used.get(id) || 0;
    used.set(id, n + 1);
    return n ? `${id}-${n + 1}` : id;
  };
  let i = 0,
    para = [];
  const flush = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const cells = (line) =>
    line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.replace(/\\\|/g, "|").trim());
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const lang = (/^\s*```\s*([\w+#.-]+)/.exec(line)?.[1] || "").toLowerCase();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(lang ? `<pre data-lang="${esc(lang)}"><code>${esc(buf.join("\n"))}</code></pre>` : `<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      flush();
      const lvl = hm[1].length;
      const text = hm[2].trim();
      const id = uniq(`${idPrefix}-${slug(text.replace(/^\d+(\.\d+)*\.?\s+/, ""))}`);
      out.push(`<h${lvl} id="${id}">${inline(text)}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      const th = head.map((c) => `<th>${inline(c)}</th>`).join("");
      const td = (r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`;
      out.push(
        `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${rows.map(td).join("")}</tbody></table></div>`,
      );
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }
    const lm = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (lm) {
      flush();
      const items = []; // [indent, ordered, text]
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m) {
          items.push([m[1].length, /\d/.test(m[2]), m[3]]);
          i++;
          continue;
        }
        if (items.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*```/.test(lines[i])) {
          items[items.length - 1][2] += " " + lines[i].trim();
          i++;
          continue;
        }
        break;
      }
      const render = (start, indent) => {
        const tag = items[start][1] ? "ol" : "ul";
        let html = `<${tag}>`;
        let k = start;
        while (k < items.length && items[k][0] >= indent) {
          if (items[k][0] > indent) {
            const sub = render(k, items[k][0]);
            html = html.replace(/<\/li>$/, `${sub.html}</li>`);
            k = sub.next;
            continue;
          }
          const task = /^\[([ xX])\]\s+(.*)$/.exec(items[k][2]);
          html += task
            ? `<li class="task"><input type="checkbox" disabled${task[1] === " " ? "" : " checked"}> ${inline(task[2])}</li>`
            : `<li>${inline(items[k][2])}</li>`;
          k++;
        }
        return { html: html + `</${tag}>`, next: k };
      };
      out.push(render(0, items[0][0]).html);
      continue;
    }
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join("\n");
}

/**
 * Small markdown for chat bubbles: fenced code, paragraphs, bullet lists, inline code/bold.
 * @param {any} s
 */
export function mdBlock(s) {
  const parts = String(s || "").split(/```/);
  let out = "";
  parts.forEach((p, i) => {
    if (i % 2 === 1) {
      out += `<pre>${esc(p.replace(/^[a-z]*\n/, ""))}</pre>`;
      return;
    }
    const lines = p.split(/\r?\n/);
    let list = null;
    for (const line of lines) {
      const li = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
      if (li) {
        if (!list) {
          list = true;
          out += "<ul>";
        }
        out += `<li>${md(li[1])}</li>`;
        continue;
      }
      if (list) {
        out += "</ul>";
        list = null;
      }
      if (line.trim()) out += `<p>${md(line)}</p>`;
    }
    if (list) out += "</ul>";
  });
  return out;
}
