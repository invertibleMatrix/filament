// @ts-check
// An artifact (HarnessV4_Artifacts_Plan, E18): a page an agent makes that lives outside the chat, kept by Filament with
// its versions, under an address of its own on this machine — `http://<name>.art.localhost:<port>/` (AF-D2) — and, for
// a device paired with it, on the network's artifacts address — `https://<host>:<port>/<name>/` (the owner's remote
// Filament of 11-06, Part 4). What is pure about one: its name and addresses, the names its icon may take, a file's path
// inside it, the page as it is served (a fragment wrapped whole, Filament's look and small script first), the page
// Filament draws a typed artifact with from the agent's content (steps 6 and 7), the page and title of one the developer
// keeps from a visual, the sheet its look is (made from the harness's own) and the policy every answer from its address
// carries.
import { isUtf8 } from "node:buffer";
import { DESKTOP_STYLE, FILL_ALPHA, LOOK_TOKENS, VISUAL_HOSTS, VISUAL_HUES, VISUAL_NAMES, desktopNames } from "./visual-look.js";

/** The name every artifact's address sits under; a browser sends any name under `localhost` to this machine. */
export const ART_DOMAIN = "art.localhost";
/**
 * The types a new artifact can be (AF-D11). Page: the agent writes all of it. Doc and Slides: the agent writes
 * Markdown, which a page of Filament's own draws — a document, or a deck (step 6). Dashboard and Design: the agent
 * writes data — tiles and tables, or screens — which a page of Filament's own draws (step 7). App (the owner's of
 * 10-29: "a dynamic dashboard of anything"): a page the agent writes whole, with a dashboard's sources, watches and
 * buttons beside it, which read and run in its project's Space once kept there.
 */
export const ARTIFACT_TYPES = Object.freeze(["page", "doc", "slides", "dashboard", "design", "app"]);
/** The types a project's Space keeps, whose sources read and whose buttons run there once kept: their content.json's. */
export const RUNS_ITSELF = Object.freeze(["dashboard", "app"]);
/** Whether a type reads and runs by itself once kept in a Space. @param {unknown} type */
export const runsItself = (type) => RUNS_ITSELF.includes(String(type));
/**
 * The types made from one of Filament's own pages: the agent writes the content, Filament's page draws it, and no code of
 * the agent's runs on their address — a Design's screens run in frames of no origin of their own.
 */
export const TYPED = Object.freeze(["doc", "slides", "dashboard", "design"]);
/** Whether a type's page is Filament's own. @param {unknown} type */
export const isTyped = (type) => TYPED.includes(String(type));
/** The types whose content is Markdown, which the developer edits beside its page (AFC-115, AFC-144). */
export const EDITABLE = Object.freeze(["doc", "slides"]);
/** Whether a type's content is the developer's to edit as text. @param {unknown} type */
export const isEditable = (type) => EDITABLE.includes(String(type));
/** The file a Doc's or a deck's Markdown is kept as. */
export const CONTENT_FILE = "content.md";
/** The file a Dashboard's tiles and tables, a Design's style and screens, or an App's sources and buttons are kept as (step 7). */
export const CONTENT_JSON = "content.json";
/** The file an app's folder says the app in — its title, reads and buttons —, which a publish by folder reads (10-29). */
export const APP_JSON = "app.json";
/** The file a typed artifact's content is kept as. @param {unknown} type */
export const contentFileOf = (type) => (isEditable(type) ? CONTENT_FILE : CONTENT_JSON);
/** The longest title: two to four words, sentence case. */
export const ARTIFACT_TITLE_MAX = 80;
/** The longest description: one line. */
export const ARTIFACT_DESCRIPTION_MAX = 300;
/** The file a page is kept as, and the one a folder's page is looked for by. */
export const PAGE_FILE = "index.html";
/** Where Filament's own files sit on an artifact's address: no file of a publish may be under it. */
export const OWN_PREFIX = "_filament";
/** Filament's small script, loaded ahead of the page's own code (AF-D7). */
export const PAGE_SCRIPT = `/${OWN_PREFIX}/page.js`;
/** The page's look: the harness's colors and type by the names the guide gives, light and dark. */
export const LOOK_SHEET = `/${OWN_PREFIX}/look.css`;
/**
 * What the harness names an artifact's frame (AF-D33), so its page knows the theme and the Motion before it draws:
 * `filament-look:<light|dark>:<full|reduced|off>`, and `:still` for a card's still preview (AFC-113).
 */
export const LOOK_MARK = "filament-look";
/** Where Filament's own pages for its types are served from, on every artifact's address: `src/ui`'s files. */
export const OWN_UI = `/${OWN_PREFIX}/ui/`;
/**
 * The modules each type's page loads (steps 6 and 7), by their paths under `src/ui`, each after those it imports: the
 * order a download joins them in (AFC-118).
 */
export const TYPE_MODULES = Object.freeze({
  doc: Object.freeze(["lib/md.js", "lib/dom.js", "artifacts/type-page.js", "artifacts/markdown-page.js", "artifacts/doc.js"]),
  slides: Object.freeze(["lib/md.js", "lib/dom.js", "artifacts/type-page.js", "artifacts/markdown-page.js", "artifacts/deck.js", "artifacts/slides.js"]),
  dashboard: Object.freeze(["lib/dom.js", "artifacts/type-page.js", "artifacts/charts.js", "artifacts/dashboard.js"]),
  design: Object.freeze(["lib/dom.js", "artifacts/type-page.js", "artifacts/design.js"]),
});
/** The sheet every type's page draws with, under `src/ui`. */
export const TYPE_STYLE = "artifacts/types.css";
/** The diagram library a Doc or a deck loads only when it draws a diagram, under `src/ui`. */
export const MERMAID_MODULE = "harness/vendor/mermaid/mermaid.mjs";
/** What a page that holds the diagram library inside it calls it by (a download, AFC-118). */
export const MERMAID_GLOBAL = "__filamentMermaid";
/** Every file of `src/ui` an artifact's address serves under `OWN_UI`: Filament's own, never a page's. */
export const OWN_UI_FILES = Object.freeze([...new Set([...Object.values(TYPE_MODULES).flat(), TYPE_STYLE, MERMAID_MODULE])]);

/**
 * The words an icon may be, each a mark the harness draws: one plain word for what the artifact is. An unknown word
 * falls back to the page's mark (AFC-7).
 */
export const ARTIFACT_ICONS = Object.freeze([
  "page", "doc", "slides", "chart", "dashboard", "design", "table", "list", "check", "calendar", "clock", "calculator",
  "money", "map", "code", "book", "note", "mail", "chat", "game", "music", "photo", "tool", "settings", "star", "heart",
  "home", "person", "team", "folder", "search", "bug", "rocket", "globe", "cart", "recipe", "flag", "bolt",
]);

/** An artifact's name: lower-case letters, digits and hyphens, one DNS label. */
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Whether a string is an artifact's name as its address carries it. @param {unknown} s */
export const isArtifactName = (s) => typeof s === "string" && NAME.test(s);

/**
 * Whether a request's host names an artifact's address, and which: its name, "" for a name under `art.localhost` that
 * is no artifact's (`art.localhost` itself, two labels deep, a spelling no name has) — fenced all the same — or null
 * for any other host. Read from the host as the Host header gives it, its port and brackets gone.
 * @param {string | null | undefined} hostname
 * @returns {string | null}
 */
export function artifactNameOfHost(hostname) {
  const h = String(hostname ?? "").toLowerCase().replace(/\.+$/, "");
  if (h === ART_DOMAIN) return "";
  if (!h.endsWith(`.${ART_DOMAIN}`)) return null;
  const label = h.slice(0, -ART_DOMAIN.length - 1);
  return NAME.test(label) ? label : "";
}

/** The label under an artifact's name that makes its still address: `<name>.still.art.localhost`. */
export const STILL_LABEL = "still";

/**
 * Which artifact a request's host names as a still preview — `<name>.still.art.localhost`, the address the harness's
 * previews frame, an origin of its own so its page's requests say so — or null for any other host. Fenced as every
 * artifact address is: `artifactNameOfHost` reads it as "", no artifact's.
 * @param {string | null | undefined} hostname
 * @returns {string | null}
 */
export function stillNameOfHost(hostname) {
  const h = String(hostname ?? "").toLowerCase().replace(/\.+$/, "");
  const tail = `.${STILL_LABEL}.${ART_DOMAIN}`;
  if (!h.endsWith(tail)) return null;
  const label = h.slice(0, -tail.length);
  return NAME.test(label) ? label : null;
}

/**
 * The network's artifacts address (the owner's remote Filament of 11-06, Part 4): another machine reaches this one by
 * a single name — an address on the network, a tailnet's name — and never by a name under it, so every artifact answers
 * there on one https origin of its own, beside Filament's pages: each under its name (`/<name>/`), its still preview
 * under `/_still/<name>/`, and Filament's own files that are no artifact's (its look, its small script, its types' pages,
 * the shelf) at the top. The page's script reads its data under its name's path; a page's own files sit beside it, so
 * the paths a page gives them, relative, reach them there as at its own address.
 */
export const STILL_PATH = "_still";
/** What starts the pass a page carries on the network's artifacts address, its first part after its name. */
export const PASS_MARK = "~";
/** A pass's shape as a part of a path (`~<body>.<signature>`): no file's path starts with one. */
const PASS_PART = /^~[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * Which artifact a path on the network's artifacts address names — `/<name>/…` its page, `/_still/<name>/…` its still
 * preview, either with the pass its page was given after the name (`/<name>/~<pass>/…`, http/artifacts.js
 * `createPasses`) — with the path inside it as its own address would be asked for ("" where the name, or its pass, has
 * no `/` after it); null for any other path, Filament's own files at the top among them. Read as the request gave it,
 * before any decoding.
 * @param {string} pathname
 * @returns {{ name: string, still: boolean, rest: string, pass?: string } | null}
 */
export function artifactOfPath(pathname) {
  const m = /^\/(?:(_still)\/)?([^/]+)(?:\/~([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(?=\/|$))?(\/.*)?$/.exec(String(pathname || ""));
  if (!m || !NAME.test(m[2])) return null;
  return { name: m[2], still: m[1] === STILL_PATH, rest: m[4] || "", ...(m[3] ? { pass: m[3] } : {}) };
}

/**
 * The sandbox every page on the network's artifacts address is put in by its answer (fx-artifacts): it runs its
 * scripts, posts its forms, opens a link's tab and asks — and never `allow-same-origin`, so each page is an origin of
 * none, which reaches no other artifact's page, storage or data: one origin holds them all there, where a name of
 * their own each (`<name>.art.localhost`) is this machine's alone. An app's game locks the pointer, as its frame lets
 * it (harness `APP_FRAME_SANDBOX`). A still preview runs its scripts alone.
 */
export const NETWORK_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock";
export const STILL_SANDBOX = "allow-scripts";

/**
 * A page's or sheet's own addresses from the top — `/style.css`, `url(/img/a.png)`, `srcset="/a.png 2x"` — put under
 * the path its artifact sits at on the network's artifacts address (fx-artifacts): at its own address the top is the
 * artifact's, and so it is there. Another site's (`//host/…`) is left as it is, and so is one under that path already —
 * a library the version kept from the web (`servedFile`). In a page, an address is a tag's: a script's own code, the
 * words a page shows and a picture written into a srcset are left as written. "" for `base` leaves it all.
 * @param {string} text @param {string} base  `/<name>/~<pass>` there @param {"html" | "css"} kind
 */
export function rootedUnder(text, base, kind) {
  if (!base) return text;
  // The top's `/`, but another site's (`//`, `/\`) and one under the path already.
  const under = base.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const top = `/(?![/\\\\]|${under}/)`;
  const css = (/** @type {string} */ s) => s.replace(new RegExp(`(url\\(\\s*["']?)${top}`, "gi"), `$1${base}/`).replace(new RegExp(`(@import\\s+["'])${top}`, "gi"), `$1${base}/`);
  if (kind === "css") return css(text);
  const attributes = (/** @type {string} */ tag) =>
    tag
      .replace(new RegExp(`(\\s(?:src|href|action|formaction|poster|data|background)\\s*=\\s*["']?)${top}`, "gi"), `$1${base}/`)
      .replace(/(\ssrcset\s*=\s*)(["'])([^"']*)\2/gi, (whole, at, q, list) => (/data:/i.test(list) ? whole : `${at}${q}${String(list).replace(new RegExp(`(^\\s*|,\\s*)${top}`, "g"), `$1${base}/`)}${q}`));
  const TAG = /<[a-zA-Z](?:"[^"]*"|'[^']*'|[^'">])*>/g;
  // A script's own words are its code: its tag's addresses alone are put under the path.
  return text
    .split(/(<script\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/script\s*>)/i)
    .map((part, i) => (i % 2 ? part.replace(/^<script\b(?:"[^"]*"|'[^']*'|[^'">])*>/i, attributes) : css(part).replace(TAG, attributes)))
    .join("");
}

/**
 * The ports the network's artifacts address listens on now (http/artifacts.js `artifactsListener` says each as it
 * listens and stops): an https origin at one is an artifact's page, and Filament's pages may frame one.
 * @type {Set<number>}
 */
const networkPorts = new Set();
/** Say a port the network's artifacts address listens on now (`on`), or no longer. @param {number} port @param {boolean} on */
export function artifactsOnNetwork(port, on) {
  if (on) networkPorts.add(port);
  else networkPorts.delete(port);
}

/**
 * A path with each artifact's pass in it (`/~<pass>`, http/artifacts.js) said as `/~…`: a log line or an error read by
 * an agent never carries one, which opens that artifact or every one (the hunt on x41). @param {string} p
 */
export const passHidden = (p) => String(p).replace(/\/~[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?=\/|$)/g, "/~…");

/**
 * Whether a request's Origin is an artifact's page: code a model wrote — at its own address on this machine, or on the
 * network's artifacts address, while it listens.
 * @param {unknown} origin  the Origin header
 */
export function isArtifactOrigin(origin) {
  if (typeof origin !== "string" || !origin) return false;
  try {
    const u = new URL(origin);
    return artifactNameOfHost(u.hostname) !== null || (u.protocol === "https:" && networkPorts.has(Number(u.port || 443)));
  } catch {
    return false;
  }
}

/** An artifact's address on this machine, at the port Filament listens on now (AFC-50). @param {string} name @param {number} port */
export const artifactAddress = (name, port) => `http://${name}.${ART_DOMAIN}:${port}/`;

/** What stands for an artifact's name in the addresses `artifactsAt` gives. */
export const NAME_SLOT = "{name}";
/** Whether a host reached Filament on this machine: a name under localhost, a loopback address. @param {string} h  lower-case */
const isHereHost = (h) => h === "localhost" || h.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/.test(h) || h === "[::1]";
/**
 * Where a page reads its artifacts (AFC-50; the owner's remote Filament of 11-06, Part 4), by the Host it reached
 * Filament at: by a name under localhost or a loopback address — this machine, or another's SSH tunnel to it — each at
 * `<name>.art.localhost` on that port, which leads to this Filament as the page's own address does; by any other name,
 * on the network's artifacts address at that name, where it listens (`artPort`) — none where it does not. Each address
 * has `NAME_SLOT` for the artifact's name: the page's address and its still preview's. This machine's carry `pass`
 * where it is given — the page's pass for every artifact, where its programs need the owner key (http/artifacts.js
 * `holderPass`).
 * @param {string} host  the Host header as the page's request carried it
 * @param {number | null | undefined} artPort  the port the network's artifacts address listens on, if it does
 * @param {() => string} [pass]  asked only for this machine's
 * @returns {{ page: string, still: string } | null}
 */
export function artifactsAt(host, artPort, pass = () => "") {
  let u;
  try {
    u = new URL(`http://${host}`);
  } catch {
    return null;
  }
  const h = u.hostname.toLowerCase();
  if (isHereHost(h)) {
    const port = u.port ? `:${u.port}` : "";
    const p = pass();
    const under = p ? `~${p}/` : "";
    return { page: `http://${NAME_SLOT}.${ART_DOMAIN}${port}/${under}`, still: `http://${NAME_SLOT}.${STILL_LABEL}.${ART_DOMAIN}${port}/${under}` };
  }
  if (!h || !artPort) return null;
  return { page: `https://${h}:${artPort}/${NAME_SLOT}/`, still: `https://${h}:${artPort}/${STILL_PATH}/${NAME_SLOT}/` };
}

/** The longest part of a name taken from its title, so the name and its four letters stay one label. */
const SLUG_MAX = 40;
/**
 * A new artifact's name: its title in lower-case words joined by hyphens, and four letters of its own
 * (`expense-tracker-k3f9`). A title with no Latin letters or digits is named `artifact-…`.
 * @param {string} title @param {string} four  four characters from [a-z0-9]
 */
export function nameFor(title, four) {
  const slug = String(title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  return `${slug || "artifact"}-${four}`;
}

/** Characters no file of an artifact may have in its name: what a Windows folder would refuse, and control codes. */
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f<>:"|?*\\]/;
/** The names Windows keeps for its devices, with any extension: a file so named is no file there. */
export const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
/** The longest a file's path inside an artifact may be. */
const PATH_MAX = 240;

/**
 * A file's path inside an artifact as it is kept and served — forward slashes, no `./` — or what is wrong with it, in
 * words that name it (AFC-57): it must stay inside the artifact, and not under Filament's own `_filament/`.
 * @param {unknown} given
 * @returns {{ ok: true, path: string } | { ok: false, error: string }}
 */
export function artifactPath(given) {
  const raw = typeof given === "string" ? given.trim() : "";
  if (!raw) return { ok: false, error: "a file has no path: give each file a path such as app.js or css/style.css" };
  const slashed = raw.replace(/\\/g, "/");
  if (slashed.startsWith("/") || /^[a-z]:/i.test(slashed)) return { ok: false, error: `${raw} is a path on the disk: a file's path is relative to the page, such as app.js` };
  const parts = slashed.split("/").filter((p) => p !== "" && p !== ".");
  if (!parts.length) return { ok: false, error: `${raw} names no file` };
  if (parts.includes("..")) return { ok: false, error: `${raw} climbs out of the artifact: a file's path stays beside the page, such as css/style.css` };
  if (parts.some((p) => BAD_CHARS.test(p) || /[ .]$/.test(p))) return { ok: false, error: `${raw} has a character a file's name cannot have here` };
  const device = parts.find((p) => DEVICE_NAME.test(p));
  if (device) return { ok: false, error: `${raw} has a name Windows keeps for a device (${device}): name it otherwise` };
  const path = parts.join("/");
  if (parts[0].toLowerCase() === OWN_PREFIX) return { ok: false, error: `${raw} is under ${OWN_PREFIX}/, which is Filament's own on every artifact's address: name the folder otherwise` };
  if (PASS_PART.test(parts[0])) return { ok: false, error: `${raw} starts as a pass does (${PASS_MARK}, then two names joined by a dot), which an artifact's address on the network keeps for itself: name it otherwise` };
  if (path.length > PATH_MAX) return { ok: false, error: `${raw} is longer than a file's path may be (${PATH_MAX} characters)` };
  return { ok: true, path };
}

/** The types a file of an artifact is served as, by its extension; anything else is a plain download. */
const TYPES = Object.freeze({
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  // Its types taken out at publish (10-29): JavaScript under its own name, so its imports keep working.
  ts: "text/javascript; charset=utf-8",
  mts: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
  wasm: "application/wasm",
});
/** A file's extension, lower case. @param {string} path */
const extOf = (path) => (/\.([a-z0-9]+)$/i.exec(path)?.[1] || "").toLowerCase();
/** Whether a file's bytes are text: UTF-8 with no NUL. A `.ts` that is not is a video's segment (MPEG-TS), not TypeScript. @param {Uint8Array} data */
export const isTextData = (data) => isUtf8(data) && !data.includes(0);
/** A file's extension that is TypeScript where its bytes are text. */
const TS_EXT = /^m?ts$/;
/**
 * The type a file of an artifact is served as; by its bytes too where they are given: a `.ts` that is no text is a
 * video's segment. @param {string} path @param {Uint8Array} [data]
 */
export const artifactTypeOf = (path, data) =>
  data && TS_EXT.test(extOf(path)) && !isTextData(data) ? "video/mp2t" : /** @type {Record<string, string>} */ (TYPES)[extOf(path)] || "application/octet-stream";
/** Whether a file is text the agent reads whole (`read`), by its extension. @param {string} path */
export const isTextFile = (path) => /^(?:html?|css|m?js|m?ts|json|map|txt|md|csv|xml|svg)$/.test(extOf(path));

/** A whole document, as against a fragment of one. */
const WHOLE = /<!doctype\b|<html[\s>]/i;
/** Text as HTML text. @param {string} s */
const escaped = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The page as its address serves it (AFC-58): a whole document as written, a fragment wrapped in one with its title,
 * and Filament's look and small script first — after the doctype, so the page keeps its mode; ahead of every style and
 * script of its own, so its own win. The script runs once the look has loaded: it reads the colors the look gives. On
 * the network's artifacts address both are read under the path its artifact sits under (`base`), its pass in it, and
 * the script is told that path, where it reads the page's data.
 * @param {string} html  the page as it was published
 * @param {string} title  the artifact's title
 * @param {string} [base]  `/<name>/~<pass>` or `/_still/<name>/~<pass>` on the network's artifacts address; "" at its own
 */
export const servedPage = (html, title, base = "") =>
  withLook(html, title, `<link rel="stylesheet" href="${escaped(base)}${LOOK_SHEET}"><script src="${escaped(base)}${PAGE_SCRIPT}"${base ? ` data-base="${escaped(base)}"` : ""}></script>`);

/**
 * The page as it opens alone, saved to a file (AF-D13, AFC-82): as served, with Filament's look and small script
 * written inside it in place of their addresses, so it draws in Filament's look with nothing to load from Filament.
 * @param {string} html @param {string} title
 * @param {string} look  the look's sheet @param {string} script  the small script
 */
export const pageAlone = (html, title, look, script) => withLook(html, title, `${ALONE_START}<style>${look}</style><script>${script}</script>${ALONE_END}`);
/** What marks the look and script a page alone was given (Import app…, phase 4): an import takes them out again. */
export const ALONE_START = "<!--filament:alone-->";
export const ALONE_END = "<!--/filament:alone-->";
/** A page alone as it was published: Filament's look and script, written inside it, taken out again. @param {string} html */
export const pageUnalone = (html) => {
  const at = html.indexOf(ALONE_START);
  const end = at < 0 ? -1 : html.indexOf(ALONE_END, at);
  return end < 0 ? html : `${html.slice(0, at)}${html.slice(end + ALONE_END.length)}`;
};

/**
 * The page Filament draws a typed artifact with (AF-D11, AFC-106, AFC-111, AFC-122, AFC-135): its title, the agent's
 * content as data the page reads — never as HTML (AFC-109) — and Filament's own sheet and code (`own`): by their
 * addresses on the artifact's own (`typeServed`), or written inside it for a page that opens alone (`typeAlone`,
 * AFC-118). Its address then puts Filament's look and small script first, as on every page (`servedPage`, `pageAlone`).
 * @param {string} type @param {string} title
 * @param {Record<string, unknown>} data  what the page draws: a Doc's or a deck's `markdown`; a Dashboard's or a
 *   Design's `content`, with what its page needs besides (the version shown, numbers kept for a download, a screen's
 *   look and script)
 * @param {{ head: string, body: string }} own
 */
export function typeShell(type, title, data, own) {
  const content = JSON.stringify({ type, title, ...data }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escaped(title)}</title>${own.head}</head><body class="filament-type filament-${escaped(type)}"><script type="application/json" id="filament-content">${content}</script>${own.body}</body></html>`;
}

/**
 * A type's sheet and code by their addresses on the artifact's own — under its path there on the network's artifacts
 * address (`base`). @param {keyof typeof TYPE_MODULES} type @param {string} [base]
 */
export const typeServed = (type, base = "") => ({
  head: `<link rel="stylesheet" href="${escaped(base)}${OWN_UI}${TYPE_STYLE}">`,
  body: `<script type="module" src="${escaped(base)}${OWN_UI}${TYPE_MODULES[type].at(-1)}"></script>`,
});

/**
 * A type's sheet and code written inside its page (AFC-118), and the diagram library before them where its Markdown
 * draws a diagram: two modules, run in their order once the page is read.
 * @param {{ style: string, modules: readonly string[], mermaid: string | null }} own  the sheet; each module's text, in
 *   `TYPE_MODULES`' order; the library as `mermaidInline` gives it, or null
 */
export const typeAlone = (own) => ({
  head: `<style>${own.style.replace(/<\/(style)/gi, "<\\/$1")}</style>`,
  body: `${own.mermaid ? `<script type="module">${scriptText(own.mermaid)}</script>` : ""}<script type="module">${scriptText(joinModules(own.modules))}</script>`,
});

/** Whether Markdown draws a diagram: a mermaid fence. @param {string} markdown */
export const drawsDiagram = (markdown) => /^\s*```\s*mermaid\b/im.test(markdown);

/** A static import, on a line of its own. */
const IMPORT_LINE = /^import\s[^;\n]*\sfrom\s+["'][^"'\n]+["'];?[ \t]*$/gm;
/** The word that makes a declaration an export, at a line's start. */
const EXPORT_WORD = /^export\s+(?=(?:async\s+)?function\b|const\b|let\b|class\b)/gm;
/**
 * Filament's own modules joined into one (AFC-118): each in its order, its static imports gone — each names a module
 * before it — and its `export` words dropped, so the whole is one script, which a page runs as a module.
 * @param {readonly string[]} sources  each module's text, each after those it imports
 */
export const joinModules = (sources) => sources.map((s) => s.replace(IMPORT_LINE, "").replace(EXPORT_WORD, "")).join("\n;\n");

/** Code as an inline script's text: nothing in it ends the script before its end. @param {string} js */
export const scriptText = (js) => js.replace(/<\/(script)/gi, "<\\/$1");

/**
 * The diagram library as a module inside a page (AFC-118): its one export kept on the page's window as
 * `MERMAID_GLOBAL`, where a type's code finds it. Null where the library does not export as one build does
 * (`export{x as default}`, once).
 * @param {string} src
 */
export function mermaidInline(src) {
  const ends = [...src.matchAll(/export\s*\{\s*([\w$]+)\s+as\s+default\s*\};?/g)];
  if (ends.length !== 1) return null;
  const [whole, name] = /** @type {RegExpExecArray} */ (ends[0]);
  const at = /** @type {number} */ (ends[0].index);
  return `${src.slice(0, at)}globalThis.${MERMAID_GLOBAL}=${name};${src.slice(at + whole.length)}`;
}

/**
 * A page with `tag` first: a whole one after its doctype, a fragment wrapped whole.
 * @param {string} html @param {string} title @param {string} tag
 */
function withLook(html, title, tag) {
  if (!WHOLE.test(html))
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${tag}<title>${escaped(title)}</title></head><body>${html}</body></html>`;
  const doctype = /^\uFEFF?\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i.exec(html);
  return doctype ? `${doctype[0]}${tag}${html.slice(doctype[0].length)}` : `${tag}${html}`;
}

/** Claude desktop's theme by its own mark (`data-mode`), kept the page's (`data-theme`) as Filament's script sets it. */
const MODE_SCRIPT = '(function(){var d=document.documentElement,m=function(){d.setAttribute("data-mode",d.getAttribute("data-theme")==="dark"?"dark":"light")};m();new MutationObserver(m).observe(d,{attributes:true,attributeFilter:["data-theme"]})})();';

/**
 * A visual's code as the page of the artifact the developer keeps from it (AFC-101): as it was drawn, which its
 * address serves whole in Filament's look. One drawn in Claude desktop (VS-D56) takes that app's names along, each the
 * harness's token Filament's name for the same job reads (so its `--text-muted` and `--radius` take its own meaning
 * and name nothing back), its classes, and its theme by its own mark.
 * @param {string} code @param {string | null | undefined} madeIn  where it was drawn: "claude-desktop", or Filament
 */
export function keptPage(code, madeIn) {
  if (madeIn !== "claude-desktop") return code;
  const names = Object.fromEntries(Object.keys(VISUAL_NAMES).map((k) => [k, `var(${LOOK_TOKENS[k] || k})`]));
  const own = Object.entries(desktopNames({ names, background: "var(--color-background)" })).map(([k, v]) => `${k}:${v}`).join(";");
  const tag = `<style>:root{${own}}${DESKTOP_STYLE}</style><script>${MODE_SCRIPT}</script>`;
  return WHOLE.test(code) ? withLook(code, "", tag) : `${tag}${code}`;
}

/**
 * A kept visual's title as an artifact's (AFC-101): its snake_case name in words, the first capital — `compaction_flow`
 * is "Compaction flow" — cut to a title's length; "Kept visual" where it has none.
 * @param {unknown} title
 */
export function keptTitle(title) {
  const words = String(title ?? "").replace(/_+/g, " ").replace(/\s+/g, " ").trim().slice(0, ARTIFACT_TITLE_MAX).trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : "Kept visual";
}

/**
 * What a deleted artifact's address answers (AFC-46, AFC-78), in the look — read under `base` on the network's
 * artifacts address (`servedPage`). @param {string} title @param {string} [base]
 */
export const deletedPage = (title, base = "") => servedPage(`<main><h1>${escaped(title)}</h1><p>This artifact was deleted.</p></main>`, title, base);

/**
 * A title as the developer renames to (AFC-32, AFC-80): its spaces made one, or what is wrong with it, in words.
 * @param {unknown} given @returns {{ ok: true, title: string } | { ok: false, error: string }}
 */
export function cleanTitle(given) {
  const title = typeof given === "string" ? given.trim().replace(/\s+/g, " ") : "";
  if (!title) return { ok: false, error: "A title cannot be empty." };
  if (title.length > ARTIFACT_TITLE_MAX) return { ok: false, error: `A title is ${ARTIFACT_TITLE_MAX} characters at most; this one is ${title.length}.` };
  return { ok: true, title };
}

/** The rules of the harness's sheets that hold its tokens, each as an artifact's page matches it: the root's, and each
 * theme's by the page's `data-theme` in place of the harness's class. */
const TOKEN_RULES = Object.freeze({ ":root": ":root", ".theme-zai-dark": ':root[data-theme="dark"]', ".theme-zai-light": ':root[data-theme="light"]' });
/** @typedef {{ on: string, decls: [string, string][] }} TokenRule  a rule's custom properties, and what it matches on a page */

/**
 * The token rules one of the harness's sheets holds (AF-D32), in its order: each rule at its top for the root or for
 * one of the two themes, with its custom properties. A rule inside another (`@media`) and any other rule are not the
 * theme's.
 * @param {string} css @returns {TokenRule[]}
 */
export function themeTokens(css) {
  /** @type {TokenRule[]} */
  const out = [];
  const text = String(css ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let head = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        const on = /** @type {Record<string, string>} */ (TOKEN_RULES)[head.trim()];
        const decls = on ? declarationsOf(text.slice(start, i)) : [];
        if (decls.length) out.push({ on, decls });
        head = "";
      }
      if (depth < 0) depth = 0;
    } else if (depth === 0) head = c === ";" ? "" : head + c;
  }
  return out;
}

/** A rule's custom properties, its body split at each `;` outside brackets and quotes. @param {string} body @returns {[string, string][]} */
function declarationsOf(body) {
  /** @type {[string, string][]} */
  const out = [];
  let level = 0;
  let quote = "";
  let from = 0;
  const take = (/** @type {string} */ d) => {
    const m = /^\s*(--[\w-]+)\s*:([\s\S]*)$/.exec(d);
    const value = m ? m[2].replace(/\s+/g, " ").trim() : "";
    if (m && value) out.push([m[1], value]);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") level++;
    else if (c === ")") level = Math.max(0, level - 1);
    else if (c === ";" && level === 0) {
      take(body.slice(from, i));
      from = i + 1;
    }
  }
  take(body.slice(from));
  return out;
}

/**
 * An artifact's look (AF-D32): the harness's token rules in its order, each theme's keyed by the page's `data-theme`;
 * the names the guide gives (`--text`, `--surface`, `--blue` and the rest) on them, as a visual's frame has them
 * (AF-D15); each hue's fill; and a quiet base: the page's ground, its text and type at the harness's size, its Motion.
 * Every rule but Motion's weighs nothing (`:where`): among themselves the later wins, as among the harness's own, and
 * every rule of the page's own wins over them all (AFC-69).
 * @param {readonly string[]} sheets  the harness's sheets that define its tokens, in the order the harness loads them
 */
export function lookSheet(sheets) {
  const fills = (/** @type {"dark" | "light"} */ theme) =>
    VISUAL_HUES.map((h) => `--${h}-fill:color-mix(in oklab, var(--${h}) ${Math.round(FILL_ALPHA[theme] * 100)}%, transparent)`).join(";");
  return [
    ...sheets.flatMap(themeTokens).map((r) => `:where(${r.on}){${r.decls.map(([k, v]) => `${k}:${v}`).join(";")}}`),
    ':where(:root[data-theme="dark"]){color-scheme:dark}',
    ':where(:root[data-theme="light"]){color-scheme:light}',
    // A name that is the harness's own token (`--font`) is there already: named again it would name itself.
    `:where(:root){${Object.entries(LOOK_TOKENS).filter(([name, token]) => name !== token).map(([name, token]) => `${name}:var(${token})`).join(";")}}`,
    `:where(:root[data-theme="dark"]){${fills("dark")}}`,
    `:where(:root[data-theme="light"]){${fills("light")}}`,
    ":where(body){background:var(--color-background);color:var(--text);font:var(--ui-font-size)/1.5 var(--font);-webkit-font-smoothing:antialiased}",
    ":where(a){color:var(--accent)}",
    ":where(button,input,select,textarea){font:inherit}",
    ":where(code,pre,kbd){font-family:var(--mono)}",
    ":where(img,svg,canvas,video){max-width:100%}",
    ":where(:focus-visible){outline:2px solid var(--accent);outline-offset:2px}",
    'html[data-motion="off"] *,html[data-motion="off"] *::before,html[data-motion="off"] *::after{animation:none!important;transition:none!important}',
    'html[data-motion="reduced"] *,html[data-motion="reduced"] *::before,html[data-motion="reduced"] *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition:none!important}',
    // A card's still preview is a picture of the page's top: it draws no scrollbar, the page's own or the window's.
    "html[data-still],html[data-still] *{scrollbar-width:none!important}",
    "",
  ].join("\n");
}

/**
 * The rule for frames on every page Filament serves (HarnessV4_Visuals_Plan VC-43, AF-D42): a frame may load an
 * artifact's address at Filament's port, and no other. A visual is a frame of its code (`srcdoc`), which the rule lets
 * draw; what it stops is a frame sent to a site, which would draw inside the chat as if it were Filament's. And the page
 * itself is framed by none but Filament's own pages (`frame-ancestors 'self'`): a site that framed it could lay its
 * own over Filament's buttons and have the person press them. Nothing of Filament's frames one of its pages — the
 * desktop app's windows and the Browser pane hold them whole, and its frames hold artifacts and visuals — so no page
 * of its own is refused. While the network's artifacts address listens, its https origin at its port may be framed
 * too, by whichever name the page was reached at (the owner's remote Filament of 11-06, Part 4).
 * @param {number} port  the port Filament listens on
 */
export const pageFramePolicy = (port) => `frame-src ${[`http://*.${ART_DOMAIN}:${port}`, ...[...networkPorts].map((p) => `https://*:${p}`)].join(" ")}; frame-ancestors 'self'`;

/**
 * The policy every answer from an artifact's address carries (AF-D2), written by Filament: scripts, styles and fonts
 * from the page's own address and the library hosts (AF-D4); pictures from its own address, inline data and those
 * hosts; connections to its own address only; forms posted to its own address only; framed by the harness alone; on
 * the network's artifacts address, in its sandbox (`NETWORK_SANDBOX`).
 * @param {readonly string[]} framers  the harness's own addresses (`http://127.0.0.1:20300` …)
 * @param {string} [sandbox]  the page's sandbox, where it has one
 */
export function artifactPolicy(framers, sandbox = "") {
  const hosts = VISUAL_HOSTS.join(" ");
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${hosts}`,
    `style-src 'self' 'unsafe-inline' ${hosts}`,
    `font-src 'self' data: ${hosts}`,
    `img-src 'self' data: blob: ${hosts}`,
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    `frame-ancestors ${framers.length ? framers.join(" ") : "'none'"}`,
    ...(sandbox ? [`sandbox ${sandbox}`] : []),
  ].join("; ");
}

/**
 * The harness's own addresses at a port, which alone may frame an artifact: this machine by its two names, and the
 * host Filament is set to listen on and the hosts it is told to answer, where those are names of their own. An IPv6
 * address is none of them: a policy cannot name one, and a browser refuses the policy's part that tries. An artifact
 * asked for on the network's artifacts address (`network`) is framed by the harness of the device that asked, on the
 * name it reached this machine by: over https, at whichever port its route gives the harness — the network's listener's,
 * a tailnet's 443 (the owner's remote Filament of 11-06, Part 4). `pageHost`: this Filament's own name under localhost,
 * where a browser on this computer is paired (services/machine.js `pageHost`).
 * @param {number} port @param {{ host?: string, allowedHosts?: readonly string[] }} server  the `server` config section
 * @param {{ host: string } | null} [network]  the name the request reached the network's artifacts address by
 * @param {string} [pageHost]
 */
export function harnessOrigins(port, server, network = null, pageHost = "") {
  const page = String(pageHost || "").toLowerCase();
  const own = /^[a-z0-9-]+\.localhost$/.test(page) ? [page] : [];
  const named = [server.host, ...(server.allowedHosts || [])]
    .map((h) => String(h || "").trim().toLowerCase())
    .filter((h) => h && !h.includes(":") && h !== "0.0.0.0" && h !== "localhost" && h !== "127.0.0.1" && !h.endsWith(`.${ART_DOMAIN}`) && h !== ART_DOMAIN);
  const far = String(network?.host || "").trim().toLowerCase();
  const remote = /^[a-z0-9.-]+$/.test(far) ? [`https://${far}:*`] : [];
  return [...new Set([...["127.0.0.1", "localhost", ...own, ...named].map((h) => `http://${h}:${port}`), ...remote])];
}
