// @ts-check
// An agent's visual as the page draws it (HarnessV4_Visuals_Plan E16, step 2): the closed frame's document — its
// policy, the harness's look by the names the guide gives the agent, a base style, and the small script that says the
// picture's height, its asks, its links and its failures to the page (VS-D3, VS-D5, VS-D6, VS-D7, VS-D8) — and the
// words and files around it. Pure: the card (conversation/visual.js) reads the page and owns the frame.
import { DESKTOP_STYLE, FILL_ALPHA, LOOK_TOKENS, NOT_COLORS, VISUAL_HOSTS, VISUAL_HUES, VISUAL_NAMES, desktopNames, isSvg } from "../../lib/visual-look.js";

/** The tallest a frame is drawn (VC-49): past it the picture scrolls inside, and a line says so. */
export const HEIGHT_MAX = 12000;
/** The longest ask a visual may write into the message box. */
export const ASK_MAX = 4000;

/**
 * The frame's own policy (VS-D3), written ahead of the agent's code: scripts, styles, fonts and pictures from its own
 * code and the library hosts (VS-D4), and nothing else loads or connects — no other site, no form sent, no frame.
 */
export function framePolicy() {
  const hosts = VISUAL_HOSTS.join(" ");
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${hosts}`,
    `style-src 'unsafe-inline' ${hosts}`,
    `font-src data: ${hosts}`,
    `img-src data: blob: ${hosts}`,
    `connect-src ${hosts}`,
    "media-src data: blob:",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}


/**
 * @typedef {{ theme: "light" | "dark", motion: "full" | "reduced" | "off", names: Record<string, string>, background: string }} Look
 *   what a frame is drawn in: the theme and the Motion setting its `<html>` carries, every name of VISUAL_NAMES with
 *   its value, and the page's background (a saved file's)
 */

/**
 * The look of the moment, from the page's theme (VS-D5).
 * @param {(token: string) => string} read  a theme token's value as the page computes it
 * @param {{ light: boolean, motion?: string, color: (value: string) => { css: string, rgb: [number, number, number], alpha: number } | null }} o
 *   `color`: a color's value as plain `rgb()`/`rgba()` and its parts, null where it is no color
 * @returns {Look}
 */
export function lookFrom(read, { light, motion, color }) {
  const theme = light ? "light" : "dark";
  /** @type {Record<string, string>} */
  const names = {};
  for (const [name, token] of Object.entries(LOOK_TOKENS)) {
    const raw = String(read(token) || "").trim();
    // A color is written as plain `rgb()` or `rgba()`, so a chart's script uses it as it is.
    names[name] = NOT_COLORS.includes(name) ? raw : color(raw)?.css || raw;
  }
  for (const hue of VISUAL_HUES) {
    const c = color(String(read(`--color-sys-${hue}`) || "").trim());
    names[`--${hue}-fill`] = c ? `rgba(${c.rgb.join(", ")}, ${+(c.alpha * FILL_ALPHA[theme]).toFixed(3)})` : `color-mix(in oklab, var(--${hue}) ${FILL_ALPHA[theme] * 100}%, transparent)`;
  }
  const ordered = Object.fromEntries(Object.keys(VISUAL_NAMES).map((k) => [k, names[k] ?? ""]));
  return {
    theme,
    motion: motion === "reduced" || motion === "off" ? motion : "full",
    names: ordered,
    background: color(String(read("--color-background") || "").trim())?.css || (light ? "#f8f8f8" : "#161616"),
  };
}

/**
 * The frame's base style (VS-D5, VS-D6): its text in the harness's colors and type on a clear ground, so a visual that
 * names no colors still reads in both themes; pictures held to the column's width; the body a block of its own, which
 * the height is measured by; the developer's Motion setting kept whatever the code animates. Reduced shortens an
 * animation to its end and stops every transition: a short transition on every element would hand a script that sets a
 * style and measures at once the old value (mermaid 11 laid three boxes out 2,074 px wide).
 */
const BASE_STYLE = [
  "html,body{margin:0;padding:0;background:transparent}",
  "body{display:flow-root;color:var(--text);font:14px/1.5 var(--font);-webkit-font-smoothing:antialiased;overflow-wrap:anywhere}",
  "svg,img,canvas,video{max-width:100%}",
  "svg[viewBox]{height:auto}",
  "a{color:var(--accent)}",
  "button,input,select,textarea{font:inherit;color:inherit}",
  "code,pre,kbd{font-family:var(--mono)}",
  ":focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
  'html[data-motion="off"] *,html[data-motion="off"] *::before,html[data-motion="off"] *::after{animation:none!important;transition:none!important}',
  'html[data-motion="reduced"] *,html[data-motion="reduced"] *::before,html[data-motion="reduced"] *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition:none!important}',
].join("");

/**
 * The script a frame runs before the agent's code (VS-D3): it says to the page the picture's height whenever it
 * changes (VS-D6) — a horizontal scrollbar's thickness counted in, and no scrollbar of its own below the cap, which
 * would narrow the picture as it is measured and leave the frame a little short — an ask (`filament.ask`, VS-D7; Claude
 * desktop's `sendPrompt` names the same), a link clicked or opened by a script (VC-26; Claude desktop's `openLink`,
 * VC-81), and what failed — a script's error, a library that did not load, a host the policy refused (VS-D8); never
 * the browser's notice that a ResizeObserver loop held a resize over, which is no failure of anyone's code. The
 * agent's code can say anything with the same messages: the page believes none of them past what they ask, and only
 * from this frame (conversation/visual.js). One line, as the whole head is: the code's lines are the document's.
 */
export const FRAME_SCRIPT = [
  "(function(){",
  'var say=function(m){m.filament="visual";try{parent.postMessage(m,"*")}catch(e){}};',
  "var last=-1,queued=false;",
  'var measure=function(){queued=false;var b=document.body,d=document.documentElement;if(!b)return;',
  "var h=Math.ceil(Math.max(b.scrollHeight,b.getBoundingClientRect().height))+Math.max(0,(innerHeight-d.clientHeight)||0);",
  `var o=h>${HEIGHT_MAX}?"auto":"hidden";if(d.style.overflowY!==o)d.style.overflowY=o;`,
  'if(h!==last){last=h;say({kind:"height",h:h})}};',
  "var soon=function(){if(!queued){queued=true;queueMicrotask(measure)}};",
  `var ask=function(text){say({kind:"ask",text:String(text==null?"":text).slice(0,${ASK_MAX})})};`,
  "window.filament=Object.freeze({ask:ask});",
  "window.sendPrompt=ask;",
  'window.openLink=function(u){say({kind:"link",href:String(u==null?"":u)})};',
  'var watch=function(){if(typeof ResizeObserver==="function"){var r=new ResizeObserver(measure);r.observe(document.documentElement);if(document.body)r.observe(document.body)}',
  "new MutationObserver(soon).observe(document.documentElement,{childList:true,subtree:true,attributes:true,characterData:true});measure()};",
  'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",watch);else watch();',
  'addEventListener("load",measure);',
  "if(document.fonts&&document.fonts.ready)document.fonts.ready.then(measure);",
  'document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a"):null;if(!a)return;',
  'var h=a.href;if(h&&typeof h==="object")h=h.baseVal;h=String(h||a.getAttribute("href")||"");if(!h||h.charAt(0)==="#"||(a.getAttribute("href")||"").charAt(0)==="#")return;',
  'e.preventDefault();say({kind:"link",href:h})},true);',
  'addEventListener("error",function(e){var t=e.target;if(t&&t!==window&&(t.src||t.href)){var u=t.src||t.href;say({kind:"fail",what:"load",url:String(typeof u==="object"?u.baseVal:u)});return}',
  'var f=String(e.filename||""),w=String(e.message||"Script error.");if(/^ResizeObserver loop/.test(w))return;',
  'say({kind:"fail",what:"error",message:w,line:e.lineno|0,url:f===location.href?"":f})},true);',
  'addEventListener("unhandledrejection",function(e){var r=e.reason;say({kind:"fail",what:"error",message:String(r&&r.message?r.message:r)})});',
  'document.addEventListener("securitypolicyviolation",function(e){say({kind:"fail",what:"blocked",url:String(e.blockedURI||""),directive:String(e.effectiveDirective||"")})});',
  "})();",
].join("");

/** A value as an attribute's text. @param {string} s */
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Names as one CSS rule's declarations, on one line: a theme's value may span lines (harness.css's `--mono`). @param {Record<string, string>} names */
const namesCss = (names) => Object.entries(names).map(([k, v]) => `${k}:${String(v).replace(/\s+/g, " ")}`).join(";");

/**
 * Where a visual was drawn, when not in Filament: Claude desktop, for a picture in a chat imported from Claude Code
 * (VS-D15). Its frame then gives Claude desktop's own names Filament's colors (VS-D56).
 * @typedef {{ madeIn?: string | null }} Made
 */

/** Whether a visual was drawn in Claude desktop. @param {Made} [made] */
const fromDesktop = (made) => made?.madeIn === "claude-desktop";
/**
 * Every name a frame defines, its theme's mark on `<html>`, and the style after the base one: Filament's; and for a
 * picture drawn in Claude desktop, its names too, its theme by its own mark (`data-mode`), and its classes.
 * @param {Look} look @param {Made} [made]
 */
const frameLook = (look, made) =>
  fromDesktop(made)
    ? { names: { ...look.names, ...desktopNames(look) }, marks: ` data-mode="${look.theme}"`, style: DESKTOP_STYLE }
    : { names: look.names, marks: "", style: "" };

/**
 * A visual's frame document (VS-D3, VS-D5): the policy, the names, the base style and the frame's script in one head
 * line, then the agent's code as the body — so a script error's line is the code's own line.
 * @param {string} code @param {Look} look @param {Made} [made]
 */
export function frameDoc(code, look, made) {
  const f = frameLook(look, made);
  return `<!doctype html><html data-theme="${look.theme}" data-motion="${look.motion}"${f.marks}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${attr(framePolicy())}"><meta name="referrer" content="no-referrer"><meta http-equiv="x-dns-prefetch-control" content="off"><style>:root{${namesCss(f.names)};color-scheme:${look.theme}}${BASE_STYLE}${f.style}</style><script>${FRAME_SCRIPT}</script></head><body>${code}</body></html>`;
}

/**
 * A visual as a file of its own (VS-D10): a page that opens alone in a browser, in the colors of the moment, as closed
 * as its frame; its asks do nothing there, and a link a script opens opens.
 * @param {string} code @param {Look} look @param {string} title @param {Made} [made]
 */
export function htmlFile(code, look, title, made) {
  const f = frameLook(look, made);
  return `<!doctype html>
<html lang="en" data-theme="${look.theme}" data-motion="${look.motion}"${f.marks}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${attr(framePolicy())}">
<meta name="referrer" content="no-referrer">
<title>${attr(title)}</title>
<style>:root{${namesCss(f.names)};color-scheme:${look.theme}}${BASE_STYLE}${f.style}html{background:${look.background}}body{max-width:720px;margin:24px auto;padding:0 16px}</style>
<script>window.filament=Object.freeze({ask:function(){}});window.sendPrompt=window.filament.ask;window.openLink=function(u){window.open(String(u),"_blank","noopener")};</script>
</head>
<body>
${code}
</body>
</html>
`;
}

/** A `var(--name)` with or without a fallback, one level of parentheses in it. */
const VAR_USE = /var\(\s*(--[\w-]+)\s*(?:,((?:[^()]|\([^()]*\))*))?\)/g;

/**
 * A visual that is one SVG drawing, as an SVG file (VS-D10): each name it reads its look by written in as its value of
 * the moment, since a drawing program knows none of them; a name it does not know keeps its fallback. Double quotes in
 * a value become single, so a value lands safely inside an attribute. A picture drawn in Claude desktop takes its
 * classes along, as a style of values inside the drawing (VC-80). Null for code that is no SVG.
 * @param {string} code @param {Look} look @param {Made} [made]
 */
export function svgFile(code, look, made) {
  if (!isSvg(code)) return null;
  const f = frameLook(look, made);
  const valued = (/** @type {string} */ text) =>
    text.replace(VAR_USE, (whole, name, fallback) => {
      const v = f.names[name];
      if (v) return v.replace(/"/g, "'");
      return fallback != null ? fallback.trim() : whole;
    });
  let own = valued(code);
  if (!/<svg\b[^>]*\bxmlns\s*=/i.test(own)) own = own.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (f.style) own = own.replace(/<svg\b[^>]*>/i, (open) => `${open}<style>${valued(f.style)}</style>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${own.replace(/^\s*(?:<\?xml[^>]*>\s*)?/i, "")}\n`;
}

/** The libraries a visual commonly loads, by the name their address gives them, as people write them. */
const LIBRARY_NAMES = Object.freeze({ "chart.js": "Chart.js", d3: "D3", mermaid: "mermaid", three: "three.js", "three.js": "three.js", "plotly.js": "Plotly", "plotly.js-dist": "Plotly", leaflet: "Leaflet", katex: "KaTeX", "highlight.js": "highlight.js" });

/**
 * What a library's address names: the package from cdnjs's `/ajax/libs/<name>/…`, jsdelivr's `/npm/<name>@…`, or
 * unpkg's and esm.sh's `/<name>@…` (a scope kept), as people write it; the file's name where none of those.
 * @param {string} url
 */
export function libraryOf(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return String(url || "a file");
  }
  const parts = u.pathname.split("/").filter(Boolean);
  let name = "";
  if (u.hostname === "cdnjs.cloudflare.com" && parts[0] === "ajax" && parts[1] === "libs") name = parts[2] || "";
  else {
    const at = u.hostname === "cdn.jsdelivr.net" && parts[0] === "npm" ? 1 : u.hostname === "esm.sh" && /^v\d+$/.test(parts[0] || "") ? 1 : 0;
    const first = parts[at] || "";
    const whole = first.startsWith("@") ? `${first}/${parts[at + 1] || ""}` : first;
    name = whole.replace(/(?!^)@.*$/, "");
  }
  if (u.hostname.startsWith("fonts.")) return "A font";
  return LIBRARY_NAMES[/** @type {keyof typeof LIBRARY_NAMES} */ (name.toLowerCase())] || name || parts.at(-1) || u.hostname;
}

/** A host as a person reads it. @param {string} url */
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/**
 * @typedef {{ what: "load", url: string } | { what: "blocked", url: string, directive?: string } | { what: "error", message: string, line?: number, url?: string }} Failure
 *   what a frame said failed in it; an error's `url` is the file it was thrown in where that is no part of the code
 */

/**
 * What failed and where (`thing`, a visual unless said), and the origin whose files are its own — an artifact's
 * address (`own`). @typedef {{ thing?: "visual" | "artifact", own?: string }} FailedIn
 */

/** A file of the thing's own, by its path on its origin; null for any other address. @param {string} url @param {string} own */
function ownFile(url, own) {
  if (!own) return null;
  try {
    const u = new URL(url);
    return u.origin === own ? decodeURIComponent(u.pathname.replace(/^\/+/, "")) || "its page" : null;
  } catch {
    return null;
  }
}

/**
 * A failure in words, as the line under the visual says it (VS-D8) — or under an artifact's page (AFC-25, AFC-8): a
 * library that did not load names itself and the host it came from (VC-13); a host it may not reach is named; a
 * script's error is its message and the code's line, or the library it was thrown in (VC-17). An artifact's own file
 * is named by its path, and an error thrown in one keeps its line.
 * @param {Failure} f @param {FailedIn} [o]
 */
export function failureWords(f, { thing = "visual", own = "" } = {}) {
  if (f.what === "load") {
    const mine = ownFile(f.url, own);
    if (mine) return `${mine} could not load`;
    const host = hostOf(f.url);
    return `${libraryOf(f.url)} could not load${host ? ` from ${host}` : ""}`;
  }
  if (f.what === "blocked") {
    const host = hostOf(f.url);
    if (host) return `It tried to reach ${host}, which ${thing === "artifact" ? "an artifact" : "a visual"} cannot`;
    return f.url === "eval" ? "It tried to run code the frame does not allow" : `The frame refused part of it (${f.url || f.directive || "its policy"})`;
  }
  const message = String(f.message || "Script error.").replace(/^Uncaught\s+/, "");
  const mine = f.url ? ownFile(f.url, own) : null;
  if (mine) return `Its script failed: ${message} (${mine}${f.line ? `, line ${f.line}` : ""})`;
  return `Its script failed: ${message}${f.url ? ` (in ${libraryOf(f.url)})` : f.line ? ` (line ${f.line})` : ""}`;
}

/**
 * A failure from a frame, as the page keeps it: only the shapes `failureWords` says, their text clipped. Null for
 * anything else.
 * @param {any} m @returns {Failure | null}
 */
export function failureOf(m) {
  if (m?.what === "load") return { what: "load", url: String(m.url ?? "").slice(0, 400) };
  if (m?.what === "blocked") return { what: "blocked", url: String(m.url ?? "").slice(0, 400), ...(m.directive ? { directive: String(m.directive).slice(0, 40) } : {}) };
  if (m?.what === "error")
    return { what: "error", message: String(m.message ?? "").slice(0, 400), ...(Number.isInteger(m.line) && m.line > 0 ? { line: m.line } : {}), ...(m.url ? { url: String(m.url).slice(0, 400) } : {}) };
  return null;
}

/**
 * A visual's or an artifact's failures, one each: a library the policy refused is said once, as the refusal, though
 * its load failed too. @param {Failure[]} list @param {FailedIn} [o] @returns {Failure[]}
 */
export function failuresShown(list, o = {}) {
  const refused = new Set(list.filter((f) => f.what === "blocked").map((f) => /** @type {{ url: string }} */ (f).url));
  /** @type {Set<string>} */
  const seen = new Set();
  return list.filter((f) => {
    if (f.what === "load" && refused.has(f.url)) return false;
    const key = failureWords(f, o);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The line under a visual that failed (VS-D8) — or an artifact's page (AFC-25) — and the words Tell the agent writes
 * into the message box.
 * @param {string} title @param {Failure[]} failures @param {FailedIn} [o]
 * @returns {{ line: string, more: string[], tell: string } | null}
 */
export function failureLine(title, failures, o = {}) {
  const shown = failuresShown(failures, o);
  if (!shown.length) return null;
  const words = shown.map((f) => failureWords(f, o));
  const line = `${words[0]}${words.length > 1 ? ` · and ${words.length - 1} more` : ""}`;
  return { line, more: words, tell: `The ${o.thing || "visual"} ${title} shows ${words.length === 1 ? "an error" : "errors"}: ${words.join("; ")}.` };
}

/**
 * A link a visual asked to open (VC-26, VC-46): only http and https, whole. Null for anything else.
 * @param {unknown} href
 */
export function linkOf(href) {
  try {
    const u = new URL(String(href ?? ""));
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** A frame's height as the page draws it (VS-D6, VC-49): what it said, at most HEIGHT_MAX. @param {unknown} h */
export const frameHeight = (h) => Math.max(0, Math.min(HEIGHT_MAX, Math.ceil(Number(h) || 0)));

/**
 * What the card says while the agent writes a visual (VS-D11, VC-37): "Drawing title…" once the title is there, its
 * lines, and how much is written.
 * @param {{ title?: string, loading?: string[], chars?: number }} w
 * @returns {{ head: string, lines: string[], size: string }}
 */
export function writingWords(w) {
  const chars = Math.max(0, Number(w.chars) || 0);
  const size = chars >= 1000 ? `${(chars / 1000).toFixed(chars >= 10000 ? 0 : 1)}k characters written` : chars ? `${chars} characters written` : "";
  return { head: w.title ? `Drawing ${w.title}…` : "Drawing a visual…", lines: (w.loading || []).filter(Boolean), size };
}

/** A visual's file name: its title, safe on every system. @param {string} title @param {"html" | "svg"} ext */
export const fileNameOf = (title, ext) => `${String(title || "visual").replace(/[^\w.-]+/g, "_").slice(0, 80) || "visual"}.${ext}`;

/**
 * The code fenced for the chat's markdown, with a fence longer than any run of backticks in it, so Code shows the code
 * as it is. @param {string} code
 */
export function codeFence(code) {
  const longest = Math.max(2, ...(String(code).match(/`+/g) || []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}html\n${code}\n${fence}`;
}
