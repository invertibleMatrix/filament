// @ts-check
// A Doc (HarnessV4_Artifacts_Plan E18 step 6, AF-D11, AFC-106): the agent's Markdown as a document in the harness's
// type, with an outline of its headings — beside it where the page is wide, behind a button where it is narrow — whose
// part in view is marked as the page scrolls. Its diagrams draw in its theme and draw again when the theme changes;
// each code fence has Copy. Inside the harness it follows the text being edited beside it (AFC-115), where it stands.
import { setHtml } from "../lib/dom.js";
import { framed, hear, mark, onTheme, part, still } from "./type-page.js";
import { copyButtons, drawDiagrams, headingLinks, markdownHtml, markdownOf } from "./markdown-page.js";

/** The headings the outline lists. */
const LISTED = "h1, h2, h3";
/** The fewest headings worth an outline. */
const OUTLINE_MIN = 2;

function start() {
  const body = /** @type {HTMLElement} */ (part("article", "doc-body"));
  const outline = /** @type {HTMLElement} */ (part("nav", "doc-outline"));
  outline.setAttribute("aria-label", "Outline");
  const list = part("ol", "doc-outline-list");
  outline.append(part("p", "doc-outline-h", "On this page"), list);
  const toggle = /** @type {HTMLButtonElement} */ (part("button", "doc-outline-btn"));
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  setHtml(toggle, `${mark('<path d="M3 6h18M3 12h12M3 18h15"/>')}<span>Outline</span>`);
  toggle.addEventListener("click", () => {
    const open = !document.body.classList.contains("outline-open");
    document.body.classList.toggle("outline-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });
  const page = part("div", "doc");
  page.append(body, outline);
  document.body.append(page, toggle);

  /** @type {IntersectionObserver | null} */
  let spy = null;
  /** Mark the part in view in the outline; nothing where there is no outline. */
  let markNow = () => {};
  addEventListener("scroll", () => markNow(), { passive: true });
  const go = (/** @type {string} */ id) => {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    document.body.classList.remove("outline-open");
    toggle.setAttribute("aria-expanded", "false");
  };
  headingLinks(body, go);
  headingLinks(outline, go);

  /** The outline of the headings drawn, and the part in view marked as the page scrolls. */
  const outlineOf = () => {
    spy?.disconnect();
    const heads = /** @type {HTMLElement[]} */ (Array.from(body.querySelectorAll(LISTED)));
    document.body.classList.toggle("has-outline", heads.length >= OUTLINE_MIN && !still());
    list.replaceChildren(...heads.map((hd) => {
      const li = part("li", `doc-outline-${hd.tagName.toLowerCase()}`);
      const a = /** @type {HTMLAnchorElement} */ (part("a", "", hd.textContent || ""));
      a.href = `#${hd.id}`;
      a.setAttribute("data-doc-link", hd.id);
      li.append(a);
      return li;
    }));
    markNow = () => {};
    if (heads.length < OUTLINE_MIN) return;
    /** @type {Set<HTMLElement>} */
    const seen = new Set();
    // The heading in the top part of the page, else the last one above it; scrolled to its end, the last part.
    markNow = () => {
      const end = scrollY > 0 && innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
      const at = (end && heads[heads.length - 1]) || heads.find((hd) => seen.has(hd)) || [...heads].reverse().find((hd) => hd.getBoundingClientRect().top < 0) || heads[0];
      for (const a of Array.from(list.querySelectorAll("a"))) a.classList.toggle("on", a.getAttribute("data-doc-link") === at.id);
    };
    spy = new IntersectionObserver((entries) => {
      for (const x of entries) x.isIntersecting ? seen.add(/** @type {HTMLElement} */ (x.target)) : seen.delete(/** @type {HTMLElement} */ (x.target));
      markNow();
    }, { rootMargin: "0px 0px -60% 0px" });
    heads.forEach((hd) => spy?.observe(hd));
  };

  /** Draw the Markdown, where the page stands. @param {string} markdown */
  const draw = (markdown) => {
    const y = scrollY;
    if (markdown.trim()) setHtml(body, markdownHtml(markdown));
    else body.replaceChildren(part("p", "doc-empty", "This doc is empty."));
    copyButtons(body);
    outlineOf();
    scrollTo(0, y);
    void drawDiagrams(body);
  };

  let markdown = markdownOf();
  draw(markdown);
  onTheme(() => draw(markdown));
  hear("draft", (m) => {
    if (typeof m.markdown !== "string") return;
    markdown = m.markdown;
    draw(markdown);
  });
  if (framed()) document.body.classList.add("is-framed");
}

start();
