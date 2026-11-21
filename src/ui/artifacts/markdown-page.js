// @ts-check
// What Filament's own pages for a Doc and a deck share besides (HarnessV4_Artifacts_Plan E18 step 6, AF-D11): the
// agent's Markdown drawn as HTML — `mdDoc` escapes first (AFC-109) — a mermaid fence drawn as a diagram in the page's
// theme, the library loaded only when one is there; one that does not parse stays as its code with the error under it
// (AFC-110); Copy on each code fence; a link to a heading going to it.
import { mdDoc } from "../lib/md.js";
import { setHtml } from "../lib/dom.js";
import { darkNow, pageContent } from "./type-page.js";

/** The diagram library's name on the page's window, where a page that opens alone holds it (core's MERMAID_GLOBAL). */
export const MERMAID_GLOBAL = "__filamentMermaid";

/** The Markdown Filament wrote into the page. */
export const markdownOf = () => String(pageContent().markdown || "");

/**
 * Markdown as the page's HTML (AFC-109): escaped first, no HTML of its own; each heading's id `h-<its words>`. Its
 * pictures are drawn at once: the page's own policy keeps them to its library hosts, data and itself (AF-D4).
 * @param {string} markdown
 */
export const markdownHtml = (markdown) => mdDoc(markdown, "h", { held: false });

/** @type {Promise<any> | null} */
let library = null;
/** The diagram library: the one inside the page (a download), else Filament's; null where it did not load. */
function diagramLibrary() {
  const inside = /** @type {any} */ (globalThis)[MERMAID_GLOBAL];
  library ??= (inside ? Promise.resolve(inside) : import("../harness/vendor/mermaid/mermaid.mjs").then((m) => /** @type {any} */ (m).default ?? m)).catch(() => {
    library = null;
    return null;
  });
  return library;
}

let drawn = 0;
/** A line under a fence that did not draw. @param {Element} pre @param {string} words */
function undrawn(pre, words) {
  const why = document.createElement("p");
  why.className = "diagram-error";
  why.textContent = words;
  pre.after(why);
}

/**
 * Every mermaid fence under `root` drawn as a diagram, in the page's theme now (AFC-110). A fence that does not parse
 * stays, with the error under it; where the library did not load, every fence stays, said so once.
 * @param {Element} root
 */
export async function drawDiagrams(root) {
  const fences = Array.from(root.querySelectorAll('pre[data-lang="mermaid"]'));
  if (!fences.length) return;
  const lib = await diagramLibrary();
  if (!lib) {
    if (fences[0].isConnected) undrawn(fences[0], "The diagrams did not draw: their library did not load. Each is shown as its text.");
    return;
  }
  lib.initialize({ startOnLoad: false, securityLevel: "strict", theme: darkNow() ? "dark" : "default", fontFamily: getComputedStyle(document.body).fontFamily });
  for (const pre of fences) {
    if (!pre.isConnected) continue;
    const id = `filament-diagram-${++drawn}`;
    try {
      const { svg } = await lib.render(id, pre.textContent || "");
      if (!pre.isConnected) continue;
      const fig = document.createElement("figure");
      fig.className = "diagram";
      // securityLevel "strict" cleans the drawing before it is put in the page.
      setHtml(fig, svg);
      pre.replaceWith(fig);
    } catch (/** @type {any} */ e) {
      document.getElementById(`d${id}`)?.remove();
      if (pre.isConnected) undrawn(pre, `This diagram did not draw: ${String(e?.message || e).split("\n")[0].slice(0, 200)}`);
    }
  }
}

/** A Copy button on each code fence, a diagram's aside (AFC-106). @param {Element} root */
export function copyButtons(root) {
  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    if (pre.getAttribute("data-lang") === "mermaid") continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "copy";
    b.textContent = "Copy";
    b.addEventListener("click", () => {
      const text = pre.querySelector("code")?.textContent || "";
      const said = (/** @type {string} */ w) => {
        b.textContent = w;
        setTimeout(() => (b.textContent = "Copy"), 1500);
      };
      navigator.clipboard?.writeText(text).then(() => said("Copied"), () => said("Not copied"));
    });
    pre.append(b);
  }
}

/**
 * A link to one of the page's headings (`[the risks](#risks)`) goes to it, by its id.
 * @param {Element} root @param {(id: string) => void} go
 */
export function headingLinks(root, go) {
  root.addEventListener("click", (e) => {
    const a = /** @type {Element | null} */ (e.target instanceof Element ? e.target.closest("a[data-doc-link]") : null);
    if (!a) return;
    e.preventDefault();
    go(a.getAttribute("data-doc-link") || "");
  });
}
