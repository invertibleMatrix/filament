// @ts-check
// ```mermaid fences rendered as diagrams: the vendored single-file mermaid dist (MIT), imported ONLY when a diagram
// actually appears — a chat without diagrams never loads the 3.5 MB. A source mermaid cannot parse stays as its code block with the error said under it, never a blank box.
// The theme follows the page; a rendered diagram is cached by its source text.
import { prefs } from "../prefs.js";
import { h, setHtml } from "../../lib/dom.js";

/** @type {Promise<any> | null} */
let mermaidPromise = null;
const load = () =>
  (mermaidPromise ??= import("../vendor/mermaid/mermaid.mjs")
    .then((m) => {
      const mm = /** @type {any} */ (m); // the minified dist's export shape is runtime-checked, not typed
      const mermaid = mm.default ?? mm;
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: themeNow() });
      return mermaid;
    })
    .catch(() => {
      mermaidPromise = null;
      return null;
    }));

const themeNow = () => (document.documentElement.classList.contains("theme-zai-light") ? "default" : "dark");

/** src → rendered svg (or an error string, distinguishable by the sentinel prefix) */
const cache = new Map();
const ERR = "err:";

/**
 * Render every unrendered mermaid placeholder under `root`. Idempotent (`data-done`), source-cached.
 * @param {HTMLElement | Document} root
 */
export async function renderDiagrams(root) {
  const host = /** @type {any} */ (root);
  const targets = Array.from(host.querySelectorAll?.(".mermaid-block:not([data-done])") || []);
  if (!targets.length) return;
  const mermaid = await load();
  for (const el of targets) {
    el.setAttribute("data-done", "1");
    if (!mermaid) continue; // the source code block stays — the honest fallback
    const src = decodeURIComponent(el.getAttribute("data-src") || "");
    if (!src.trim()) continue;
    let out = cache.get(src);
    if (out === undefined) {
      try {
        const { svg } = await mermaid.render(`mmd-${Math.random().toString(36).slice(2, 8)}`, src);
        out = svg;
      } catch (/** @type {any} */ e) {
        out = ERR + String(e?.message || e).slice(0, 200);
      }
      cache.set(src, out);
    }
    if (out.startsWith(ERR)) {
      // h() sets the message as text — a mermaid error echoes source, so it never becomes markup.
      el.querySelector(".code-block")?.after(
        h("p", { class: "pane-note md-mermaid-err" }, `${out.slice(ERR.length)} — the diagram is shown as source above.`),
      );
      continue;
    }
    // securityLevel "strict" sanitizes the svg before it reaches the trusted sink.
    setHtml(el, `<div class="mermaid-svg">${out}</div>`);
  }
}

/** A theme switch re-renders every diagram on screen with the other palette. */
export function repaintDiagrams() {
  cache.clear();
  document.querySelectorAll(".mermaid-block[data-done]").forEach((el) => el.removeAttribute("data-done"));
  document.querySelectorAll(".mermaid-block .mermaid-svg").forEach((el) => el.remove());
  load().then((m) => m?.initialize({ startOnLoad: false, securityLevel: "strict", theme: themeNow() }));
  renderDiagrams(document);
}

prefs.onChange((key) => {
  if (key === "theme") repaintDiagrams();
});
