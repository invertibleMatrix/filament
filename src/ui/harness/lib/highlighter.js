// @ts-check
// Syntax highlighting for the harness's code fences: the curated shiki bundle under vendor/shiki (MIT), loaded
// lazily — nothing is fetched until a fence actually closes, so a
// chat without code pays nothing. Closed blocks are highlighted in place; an open fence (still streaming) stays
// plain until it closes; the theme follows the page (github-dark / github-light); a highlighter that fails to load
// leaves the escaped plain text in place — the renderer degrades, it never breaks.
// A fence is coloured once for what it holds (HarnessV4_Worktrees_Plan S2): shiki's pre is kept by theme, grammar and
// code, and a block drawn again — a chat switched back to, a turn redrawn — takes a copy of it. shiki is slow (about
// 13 ms for 24 lines), and a switch coloured every fence of the chat again, in one task: half of its half second on
// three short chats. The rest is done in slices of a few milliseconds, the newest fence first (a chat opens on its
// tail), so a chat with many fences never holds the page.
import { prefs } from "../prefs.js";

/** @type {Promise<any> | null} */
let hlPromise = null;
const load = () =>
  (hlPromise ??= import("../vendor/shiki/shiki.mjs")
    .then((m) => m.createHighlighterCore({ themes: Object.values(m.THEMES), langs: Object.values(m.LANGS), engine: m.createJavaScriptRegexEngine() }))
    .catch(() => {
      hlPromise = null;
      return null;
    }));

/** The aliases the fence labels actually arrive as → the vendored grammar names. */
const ALIAS = {
  js: "javascript", mjs: "javascript", cjs: "javascript", "c++": "cpp", cc: "cpp", cxx: "cpp", "c#": "csharp",
  cs: "csharp", ps1: "powershell", psm1: "powershell", pwsh: "powershell", sh: "bash", zsh: "bash", shell: "bash",
  py: "python", rb: null, golang: "go", rs: "rust", yml: "yaml", htm: "html", xhtml: "html", jsonc: "json",
  md: "markdown", "shell-session": "shellscript", console: "shellscript", ts: "typescript", mts: "typescript",
  jsx: "jsx", tsx: "tsx", "objective-c": null, kt: null, swift: null, php: null, lua: null, scala: null,
};

/** The grammar for a fence label, or null when the label is not something we vendored. @param {string} lang */
export function langOf(lang) {
  const l = String(lang || "").toLowerCase();
  if (!l) return null;
  const mapped = ALIAS[l] !== undefined ? ALIAS[l] : l;
  return mapped && VENDORED.has(mapped) ? mapped : null;
}
const VENDORED = new Set([
  "javascript", "typescript", "jsx", "tsx", "json", "css", "html", "markdown", "bash", "shellscript", "powershell",
  "python", "rust", "go", "java", "c", "cpp", "csharp", "yaml", "sql", "diff", "toml", "ini",
]);

/** The page's current shiki theme name. */
const themeNow = () => (document.documentElement.classList.contains("theme-zai-light") ? "github-light" : "github-dark");

/** How long one slice of colouring runs before the page has its turn, in ms. */
export const SLICE_MS = 12;
/** The coloured fences kept: at most this many, holding at most this much code. */
export const KEPT_FENCES = 400;
export const KEPT_CHARS = 4_000_000;

/**
 * A painter of fences: `load` gives shiki's highlighter (null when it cannot load), `parse` turns its HTML into the
 * page's own pre, `theme` reads the page's theme; `now` and `rest` time the slices (a test's own). DOM-free.
 * @param {{ load: () => Promise<any>, parse: (html: string) => any, theme: () => string, now?: () => number, rest?: () => Promise<unknown> }} io
 */
export function createFencePainter(io) {
  const now = io.now || (() => performance.now());
  const rest = io.rest || (() => new Promise((r) => setTimeout(r, 0)));
  /** shiki's pre by theme, grammar and code, the one used longest ago first. @type {Map<string, any>} */
  const kept = new Map();
  let chars = 0;
  /** A copy of the fence's coloured pre: kept, else made and kept. @param {any} hl @param {string} code @param {string} lang @param {string} theme */
  const shinyOf = (hl, code, lang, theme) => {
    const key = `${theme}\n${lang}\n${code}`;
    let pre = kept.get(key);
    if (pre) kept.delete(key);
    else {
      pre = io.parse(hl.codeToHtml(code, { lang, theme }));
      if (!pre) return null;
      chars += key.length;
    }
    kept.set(key, pre);
    for (const k of kept.keys()) {
      if (kept.size <= KEPT_FENCES && chars <= KEPT_CHARS) break;
      kept.delete(k);
      chars -= k.length;
    }
    return pre.cloneNode(true);
  };
  return {
    kept,
    /**
     * Colour every closed fence under `root` not coloured yet. Idempotent per block (a `data-hl` stamp with the theme
     * name), so a streaming repaint costs nothing extra; on a theme change everything restamps.
     * @param {any} root
     */
    async paint(root) {
      const targets = Array.from(root?.querySelectorAll?.(".code-block") || []).filter((/** @type {any} */ c) => !c.hasAttribute("data-hl") && !c.hasAttribute("data-open"));
      if (!targets.length) return;
      const hl = await io.load();
      if (!hl) return; // the plain escaped text stays — the honest fallback
      let began = now();
      for (const card of targets.reverse()) {
        // Drawn away while a slice before it waited, coloured by another pass, or still streaming: left as it is.
        if (card.isConnected === false || card.hasAttribute("data-hl") || card.hasAttribute("data-open")) continue;
        // Read the theme at each fence, after the load: a theme flip applies its class synchronously while the bundle
        // loads or a slice waits, and a theme captured before it would paint the old palette and stamp it as new.
        const theme = io.theme();
        const pre = card.querySelector("pre.code");
        const code = pre?.querySelector("code");
        const lang = langOf(card.getAttribute("data-lang") || "");
        if (code && lang) {
          try {
            const shiny = shinyOf(hl, code.textContent || "", lang, theme);
            if (shiny) pre.replaceWith(shiny);
          } catch {
            // one attempt per block, even a failed one
          }
        }
        card.setAttribute("data-hl", theme);
        if (now() - began >= SLICE_MS) {
          await rest();
          began = now();
        }
      }
    },
  };
}

/** shiki's HTML as the page's pre: the card's own surface, not github's page background. @param {string} html */
const pageShiny = (html) => {
  const shiny = new DOMParser().parseFromString(html, "text/html").querySelector("pre");
  if (!shiny) return null;
  shiny.removeAttribute("style");
  shiny.classList.add("code");
  return document.importNode(shiny, true);
};
const painter = createFencePainter({ load, parse: pageShiny, theme: themeNow });

/**
 * Highlight every closed, unhighlighted fence under `root`, the newest first, in slices (`createFencePainter`).
 * @param {HTMLElement | Document} root
 */
export function paintFences(root) {
  return painter.paint(root);
}

/** A theme switch restyles every highlighted fence: drop the stamps and repaint what is on screen. */
export function repaintFences() {
  document.querySelectorAll(".code-block[data-hl]").forEach((el) => el.removeAttribute("data-hl"));
  paintFences(document);
}

/**
 * A whole file as a highlighted pre (the code viewer): shiki's own pre with its page background stripped (the
 * pane's surface shows through) and line numbers left to the CSS counter. Null when shiki cannot load or the
 * extension is not vendored — the caller's plain pre stays.
 * @param {string} code @param {string} lang  a fence-style label or a bare file extension
 */
export async function highlightCode(code, lang) {
  const grammar = langOf(lang);
  if (!grammar) return null;
  const hl = await load();
  if (!hl) return null;
  try {
    const html = hl.codeToHtml(String(code), { lang: grammar, theme: themeNow() });
    const pre = new DOMParser().parseFromString(html, "text/html").querySelector("pre");
    if (!pre) return null;
    pre.removeAttribute("style"); // github's page background is not the pane's surface
    pre.classList.add("code-pre", "shiki");
    return pre;
  } catch {
    return null;
  }
}

prefs.onChange((key) => {
  if (key === "theme") repaintFences();
});
