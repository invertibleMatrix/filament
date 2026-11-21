// @ts-check
// The web hands (HarnessV2 §5.7 `plugins.web`): `web_fetch` reads one public page as text, `web_search` asks the
// configured search endpoint and lists the first results. Not rooted like the file hands — they reach out — so
// they are offered only when a session's document switches them on, and they refuse private, loopback and
// link-local addresses unless the operator allows them (`agentLoop.web.allowPrivate`): a page the model is reading
// must not be able to point it at Filament's own admin API or a cloud metadata service. Redirects are followed by
// hand so every hop is judged, and each connection is made to the addresses judged for it (`judgedLookup`). Bounded:
// 20 seconds, 2 MB read, and a result held to 24,000 bytes — or the caller's budget — with its head and its notice
// inside that (the cut is marked, with the next offset).
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { pipeline } from "node:stream";
import { constants as zlibConstants, createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { HandError } from "./fs-fence.js";
import { headBytes } from "../../core/text.js";

/** A web result's budget in UTF-8 bytes when the caller names none, its head and notice included. */
export const WEB_FETCH_MAX_BYTES = 24_000;
/** Room a result keeps for its notice (the continuation offset, the results left out). */
const FETCH_NOTICE_ROOM = 120;
export const WEB_TIMEOUT_MS = 20_000;
export const DEFAULT_SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/?q={query}";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const SEARCH_DEFAULT_LIMIT = 8;
const SEARCH_MAX_LIMIT = 20;
const USER_AGENT = "filament-web-hand/0.1";

export const WEB_FETCH_TOOL = Object.freeze({
  name: "web_fetch",
  description:
    "Fetch a public http(s) page and read it as text: HTML becomes plain text with links as `text <url>`; JSON and plain text come back as they are. At most 24,000 bytes per call, all told, and 20 seconds: a longer page is cut where the bytes run out, and the cut names the character offset to continue from. Private and local addresses are refused.",
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      url: { type: "string", description: "An absolute http(s) URL." },
      offset: { type: "number", description: "Where to continue a long page, in characters of its text (0-based), as the cut names it." },
    },
  },
});
export const WEB_SEARCH_TOOL = Object.freeze({
  name: "web_search",
  description:
    "Search the web: the first results come back as title, URL and snippet. Several searches at once go in queries (up to 5): their results are merged with duplicates removed, a page more of them found ranked higher. Read a result with web_fetch before relying on it.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "One search." },
      queries: { type: "array", items: { type: "string" }, description: "Several searches at once (up to 5), in place of query: other words for the same question, or its parts." },
      limit: { type: "number", description: "Maximum results (default 8, 12 for several searches; at most 20)." },
    },
  },
});

/** The most searches one web_search runs, and how many of them go out together. */
export const SEARCH_MAX_QUERIES = 5;
const SEARCH_AT_ONCE = 2;
const SEARCH_SEVERAL_LIMIT = 12;
/** Reciprocal rank fusion's constant: a page several searches found ranks above one a single search found first. */
const FUSION_K = 60;
/** DuckDuckGo's answer to a search it takes for a bot: a challenge page, with no results on it. */
const BOT_CHECK = /anomaly-modal|bots use DuckDuckGo|challenge-form/i;

/**
 * @typedef {{ label: string, env: string, request: (query: string, n: number, key: string) => { url: string, method?: string, headers: Record<string, string>, body?: string } }} SearchService
 */
/**
 * The search services web_search asks with the person's key (`agentLoop.web.searchProvider` and `searchApiKey`, else
 * the service's own environment variable), each the request for one search of `n` results. The key rides a header,
 * never the URL, so no error and no record carries it.
 * @type {Readonly<Record<string, SearchService>>}
 */
export const SEARCH_SERVICES = Object.freeze({
  brave: {
    label: "Brave Search",
    env: "BRAVE_API_KEY",
    request: (q, n, key) => ({ url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${n}`, headers: { "x-subscription-token": key } }),
  },
  tavily: {
    label: "Tavily",
    env: "TAVILY_API_KEY",
    request: (q, n, key) => ({ url: "https://api.tavily.com/search", method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ query: q, max_results: n }) }),
  },
  serper: {
    label: "Serper (Google)",
    env: "SERPER_API_KEY",
    request: (q, n, key) => ({ url: "https://google.serper.dev/search", method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ q, num: n }) }),
  },
});
export const WEB_TOOLS = Object.freeze([WEB_FETCH_TOOL, WEB_SEARCH_TOOL]);
/** @param {string} name */
export const isWebTool = (name) => name === "web_fetch" || name === "web_search";

/**
 * A valid IPv6 address as its eight 16-bit groups (`::` expanded, a trailing dotted quad folded in), or null.
 * @param {string} s
 * @returns {number[] | null}
 */
function ipv6Groups(s) {
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const end = tail.length ? tail : head;
  if (end.length && end[end.length - 1].includes(".")) {
    const q = end[end.length - 1].split(".").map(Number);
    end.splice(-1, 1, ((q[0] << 8) | q[1]).toString(16), ((q[2] << 8) | q[3]).toString(16));
  }
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...(halves.length === 2 ? Array(missing).fill("0") : []), ...tail].map((g) => parseInt(g, 16));
  return groups.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? groups : null;
}

/**
 * Whether an address is one the hands must not reach by default: loopback, private, link-local, carrier-grade NAT,
 * multicast, unspecified, and their IPv6 equivalents (mapped IPv4 judged as IPv4). Anything that is not an address
 * counts as private — the caller resolves names first.
 * @param {string} ip
 */
export function isPrivateAddress(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1" || s === "::") return true;
    if (s.startsWith("::ffff:")) return isPrivateAddress(s.slice(7));
    if (/^fe[89ab]/.test(s) || /^f[cd]/.test(s) || s.startsWith("ff")) return true;
    if (/^fe[cdef]/.test(s)) return true; // fec0::/10, the old site-local range
    // NAT64 (64:ff9b::/96): an IPv4 in disguise, judged as the IPv4 it carries — an IPv6-only network reaches every
    // IPv4-only site this way, so a wholesale refusal would cut it off.
    const g = ipv6Groups(s);
    if (g && g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0)
      return isPrivateAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    return false;
  }
  return true;
}

/** The refusal for a name one of whose addresses is private. @param {string} host @param {string} address */
const resolvesPrivate = (host, address) =>
  `${host} resolves to ${address}, a private or local address; the web hands reach public addresses only (agentLoop.web.allowPrivate lifts this)`;

/**
 * Whether a URL's host may be fetched: an http(s) URL whose host resolves to public addresses only (every address,
 * not the first — a name that answers both ways is refused), unless private addresses are allowed.
 * @param {URL} u @param {{ allowPrivate?: boolean, resolve?: (host: string) => Promise<string[]> }} o
 * @returns {Promise<string | null>}  the refusal, or null when the host may be fetched
 */
export async function hostProblem(u, { allowPrivate = false, resolve = defaultResolve } = {}) {
  if (u.protocol !== "http:" && u.protocol !== "https:") return `only http(s) URLs can be fetched, not ${u.protocol.replace(/:$/, "")}`;
  if (u.username || u.password) return "a URL with credentials in it is not fetched";
  if (allowPrivate) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return `${host} is a local name; the web hands reach public addresses only (agentLoop.web.allowPrivate lifts this)`;
  const direct = isIP(host);
  if (direct) return isPrivateAddress(host) ? `${host} is a private or local address; the web hands reach public addresses only (agentLoop.web.allowPrivate lifts this)` : null;
  let addresses;
  try {
    addresses = await resolve(host);
  } catch (/** @type {any} */ e) {
    return `${host} does not resolve (${e?.code || e?.message || "lookup failed"})`;
  }
  if (!addresses.length) return `${host} does not resolve`;
  const bad = addresses.find((a) => isPrivateAddress(a));
  return bad ? resolvesPrivate(host, bad) : null;
}
/** @param {string} host */
const defaultResolve = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** The code a connection refused by `judgedLookup` fails with, so the fetch says it as the refusal it is. */
const REFUSED = "FILAMENT_PRIVATE_ADDRESS";
/**
 * The lookup a fetch connects through (the bug report's L34): the host's addresses from `resolve`, every one judged,
 * and the socket handed exactly those — the address checked is the address connected to. Judged apart from the
 * connection, a name could answer the check one way and the connection's own lookup another: a rebinding name said
 * public, then 127.0.0.1. Node asks for every address (`all`) when it races the two families, else for one.
 * @param {{ allowPrivate: boolean, resolve: (host: string) => Promise<string[]> }} o
 * @returns {import("node:net").LookupFunction}
 */
export function judgedLookup({ allowPrivate, resolve }) {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const bad = allowPrivate ? undefined : addresses.find((a) => isPrivateAddress(a));
        if (bad) return callback(Object.assign(new Error(resolvesPrivate(hostname, bad)), { code: REFUSED }), "");
        const want = options?.family === 6 ? 6 : options?.family === 4 ? 4 : 0;
        const found = addresses.map((address) => ({ address, family: isIP(address) })).filter((a) => a.family && (!want || a.family === want));
        if (!found.length) return callback(Object.assign(new Error(`${hostname} does not resolve`), { code: "ENOTFOUND" }), "");
        if (options?.all) callback(null, found);
        else callback(null, found[0].address, found[0].family);
      },
      (/** @type {any} */ e) => callback(e, ""),
    );
  };
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", copy: "©", reg: "®", trade: "™", laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", middot: "·", bull: "•" };
/** @param {string} s */
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

const BLOCK_TAGS = "p|div|section|article|header|footer|nav|aside|main|h[1-6]|ul|ol|dl|dt|dd|table|thead|tbody|tfoot|tr|blockquote|pre|hr|figure|figcaption|address|form|fieldset|details|summary";

/**
 * A page as text: scripts, styles and hidden machinery gone; block boundaries as line breaks, list items dashed,
 * headings on their own line, links kept as `text <absolute url>` (same-page anchors and javascript: dropped);
 * entities decoded; whitespace folded. The title, when there is one, leads.
 * @param {string} html @param {{ baseUrl?: string }} [o]
 */
export function htmlToText(html, { baseUrl = "" } = {}) {
  let s = String(html);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1];
  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe|object|canvas|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li\s*>/gi, "")
    .replace(/<(h[1-6])\b[^>]*>/gi, "\n\n")
    .replace(/<\/(h[1-6])\s*>/gi, "\n\n")
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
    .replace(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, d, sq, bare, inner) => {
      const href = decodeEntities(String(d ?? sq ?? bare ?? "").trim());
      const text = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (!href || href.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(href)) return text;
      let abs = href;
      try {
        abs = new URL(href, baseUrl || undefined).href;
      } catch {
        return text;
      }
      if (!/^https?:/i.test(abs)) return text;
      // Angle brackets would read as a tag to the stripper below: placeholders until the tags are gone.
      return text ? `${text} \u0001${abs}\u0002` : `\u0001${abs}\u0002`;
    })
    .replace(/<img\b[^>]*\balt\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_m, d, sq) => {
      const alt = String(d ?? sq ?? "").trim();
      return alt ? `[image: ${alt}]` : "";
    })
    .replace(/<[^>]+>/g, "")
    .replace(/\u0001/g, "<")
    .replace(/\u0002/g, ">");
  s = decodeEntities(s)
    .replace(/\r/g, "")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const head = title ? decodeEntities(title).replace(/\s+/g, " ").trim() : "";
  return head && !s.startsWith(head) ? `${head}\n\n${s}` : s;
}

/**
 * The search endpoint's answer as rows: JSON with a results array (SearXNG and the like: title, url|link, content|
 * snippet|description), DuckDuckGo's HTML results page (result__a anchors with result__snippet), or, failing both,
 * every absolute link on the page with visible text.
 * @param {string} body @param {string} contentType
 * @returns {{ title: string, url: string, snippet: string }[]}
 */
export function parseSearchResults(body, contentType = "") {
  const rows = [];
  const seen = new Set();
  const add = (title, url, snippet = "") => {
    const u = String(url || "").trim();
    if (!/^https?:\/\//i.test(u) || seen.has(u)) return;
    seen.add(u);
    rows.push({ title: String(title || "").replace(/\s+/g, " ").trim() || u, url: u, snippet: String(snippet || "").replace(/\s+/g, " ").trim() });
  };
  const looksJson = /json/i.test(contentType) || /^\s*[[{]/.test(body);
  if (looksJson) {
    // A service's words may carry its own marks (Brave's <strong> around the words asked for) and entities.
    const plain = (/** @type {unknown} */ s) => decodeEntities(String(s || "").replace(/<[^>]+>/g, ""));
    try {
      const j = JSON.parse(body);
      const list = Array.isArray(j) ? j : j?.results || j?.items || j?.organic || j?.data || j?.web?.results || [];
      for (const r of Array.isArray(list) ? list : []) if (r && typeof r === "object") add(plain(r.title || r.name), r.url || r.link || r.href, plain(r.snippet || r.content || r.description || r.text));
      return rows;
    } catch {
      /* not JSON after all: read it as a page */
    }
  }
  const ddg = /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [...body.matchAll(/<(?:a|td|div|span)\b[^>]*class="[^"]*\bresult(?:__|-)snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div|span)>/gi)].map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "")));
  let i = 0;
  for (const m of body.matchAll(ddg)) {
    const href = decodeEntities(m[1] || m[3] || "");
    const text = decodeEntities((m[2] || m[4] || "").replace(/<[^>]+>/g, ""));
    add(text, unwrapRedirect(href), snippets[i++] || "");
  }
  if (rows.length) return rows;
  for (const m of body.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, "")).trim();
    if (text.length >= 3) add(text, decodeEntities(m[1]));
  }
  return rows;
}
/** DuckDuckGo's result links go through //duckduckgo.com/l/?uddg=<encoded url>; the page the model wants is inside. */
function unwrapRedirect(href) {
  const h = href.startsWith("//") ? `https:${href}` : href;
  try {
    const u = new URL(h);
    const inner = u.searchParams.get("uddg") || u.searchParams.get("u") || u.searchParams.get("url");
    if (inner && /^https?:\/\//i.test(inner)) return inner;
  } catch {
    /* not a URL: returned as it came */
  }
  return h;
}

/**
 * GET a URL with the host judged on every hop and each connection made to the addresses judged for it, the body read
 * up to the cap, the whole thing under one deadline. `method` and `body` POST instead (a search service's API), and a
 * POST follows no redirect; `headers` ride beside the hand's own.
 * @param {string} url
 * @param {{ allowPrivate: boolean, timeoutMs: number, signal: AbortSignal | null, resolve?: (host: string) => Promise<string[]>, accept?: string, method?: string, headers?: Record<string, string>, body?: string }} o
 * @returns {Promise<{ url: string, status: number, contentType: string, body: string, truncated: boolean }>}
 */
async function getText(url, { allowPrivate, timeoutMs, signal, resolve = defaultResolve, accept, method = "GET", headers, body }) {
  let current;
  try {
    current = new URL(String(url || "").trim());
  } catch {
    throw new HandError(`not a URL: ${String(url || "").slice(0, 200)}`);
  }
  const deadline = Date.now() + timeoutMs;
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const late = () => new HandError(signal?.aborted ? "the fetch was cancelled" : `${current.host} did not answer within ${Math.round(timeoutMs / 1000)} s`);
  const lookup = judgedLookup({ allowPrivate, resolve });
  // The caller's headers (a search service's key) go to the address asked alone: a redirect elsewhere gets none.
  const origin = current.origin;
  try {
    for (let hop = 0; ; hop++) {
      const problem = await hostProblem(current, { allowPrivate, resolve });
      if (problem) throw new HandError(`Not fetched: ${problem}.`);
      if (Date.now() >= deadline) throw new HandError(`${current.host} did not answer within ${Math.round(timeoutMs / 1000)} s`);
      let res;
      try {
        res = await get(current, { lookup, signal: ctl.signal, accept, method, headers: current.origin === origin ? headers : undefined, body });
      } catch (/** @type {any} */ e) {
        if (e?.code === REFUSED) throw new HandError(`Not fetched: ${e.message}.`);
        if (ctl.signal.aborted) throw late();
        throw new HandError(`${current.host} could not be reached (${e?.code || e?.message || "network error"})`);
      }
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const loc = res.headers.location;
        res.destroy();
        if (!loc) throw new HandError(`${current.host} answered ${status} with no location`);
        if (method !== "GET") throw new HandError(`${current.host} answered ${status}, a redirect, which a ${method} does not follow`);
        if (hop >= MAX_REDIRECTS) throw new HandError(`too many redirects (more than ${MAX_REDIRECTS}) from ${url}`);
        try {
          current = new URL(loc, current);
        } catch {
          throw new HandError(`${current.host} redirected to something that is not a URL`);
        }
        continue;
      }
      const contentType = String(res.headers["content-type"] || "").toLowerCase();
      try {
        const { body, truncated } = await readCapped(res, MAX_BODY_BYTES);
        return { url: current.href, status, contentType, body, truncated };
      } catch (/** @type {any} */ e) {
        if (ctl.signal.aborted) throw late();
        throw new HandError(`${current.host} broke off the page (${e?.code || e?.message || "network error"})`);
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * One request (a GET unless `method` says otherwise), connected through `lookup`, on a connection of its own: one kept
 * from another request was connected to an address nobody judged for this one.
 * @param {URL} u @param {{ lookup: import("node:net").LookupFunction, signal: AbortSignal, accept?: string, method?: string, headers?: Record<string, string>, body?: string }} o
 * @returns {Promise<import("node:http").IncomingMessage>}
 */
function get(u, { lookup, signal, accept, method = "GET", headers: extra, body }) {
  return new Promise((done, fail) => {
    const headers = {
      "user-agent": USER_AGENT,
      accept: accept || "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
      "accept-language": "en",
      "accept-encoding": "gzip, deflate, br",
      ...(extra || {}),
      ...(body != null ? { "content-length": String(Buffer.byteLength(body)) } : {}),
    };
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(u, { method, agent: false, lookup, signal, headers }, done);
    req.on("error", fail);
    req.end(body ?? undefined);
  });
}

/**
 * The body as UTF-8 text, read up to `max` bytes as the page has them: decompressed as it was sent (gzip, deflate, br),
 * a stream that ends early read as far as it went, as fetch reads one. Leaving the loop early ends the response, and
 * with it the connection.
 * @param {import("node:http").IncomingMessage} res @param {number} max
 */
async function readCapped(res, max) {
  const enc = String(res.headers["content-encoding"] || "").trim().toLowerCase();
  const sync = { flush: zlibConstants.Z_SYNC_FLUSH, finishFlush: zlibConstants.Z_SYNC_FLUSH };
  const brotli = { flush: zlibConstants.BROTLI_OPERATION_FLUSH, finishFlush: zlibConstants.BROTLI_OPERATION_FLUSH };
  /** @type {import("node:stream").Transform | null} */
  const unzip = enc === "gzip" || enc === "x-gzip" ? createGunzip(sync) : enc === "br" ? createBrotliDecompress(brotli) : enc === "deflate" ? createInflate(sync) : null;
  /** @type {AsyncIterable<Buffer>} */
  const stream = unzip ? pipeline(res, unzip, () => {}) : res;
  /** @type {Buffer[]} */
  const chunks = [];
  let got = 0;
  let truncated = false;
  for await (const chunk of stream) {
    chunks.push(chunk);
    got += chunk.length;
    if (got >= max) {
      truncated = true;
      break;
    }
  }
  return { body: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks).subarray(0, max)), truncated };
}

const BINARY_TYPES = /^(image|audio|video|font)\/|\/(zip|gzip|x-tar|pdf|octet-stream|x-msdownload|wasm|x-7z-compressed)\b/i;

/**
 * Run one web hand. `searchEndpoint` is a URL with `{query}` where the encoded query goes (a bare URL gets `?q=`);
 * `searchProvider` names one of `services` (SEARCH_SERVICES) that web_search asks first, with `searchApiKey` — the
 * endpoint answering where the service has no key or fails, in words that say so. `maxBytes` is the caller's budget
 * for the result, its head and notice included; `redact` (a session's `privacy.redact`) is applied to what the web
 * sent before the result is cut to it — an error's words included.
 * @param {string} name @param {any} input
 * @param {{ searchEndpoint?: string, searchProvider?: string, searchApiKey?: string, services?: Readonly<Record<string, SearchService>>, allowPrivate?: boolean, timeoutMs?: number, signal?: AbortSignal | null, resolve?: (host: string) => Promise<string[]>, maxBytes?: number, redact?: ((text: string) => string) | null }} [o]
 * @returns {Promise<string>}
 */
export async function runWebHand(name, input, { searchEndpoint = DEFAULT_SEARCH_ENDPOINT, searchProvider = "", searchApiKey = "", services = SEARCH_SERVICES, allowPrivate = false, timeoutMs = WEB_TIMEOUT_MS, signal = null, resolve, maxBytes = WEB_FETCH_MAX_BYTES, redact = null } = {}) {
  const clean = redact || ((/** @type {string} */ t) => t);
  const limit = Math.max(2000, Math.floor(Number(maxBytes)) || WEB_FETCH_MAX_BYTES);
  try {
    return await webHand(name, input, { searchEndpoint, searchProvider, searchApiKey, services, allowPrivate, timeoutMs, signal, resolve }, limit, clean);
  } catch (/** @type {any} */ e) {
    if (redact && e instanceof Error) e.message = redact(e.message);
    throw e;
  }
}

/**
 * @param {string} name @param {any} input @param {any} o @param {number} limit  the result's budget in bytes
 * @param {(text: string) => string} clean
 */
async function webHand(name, input, { searchEndpoint, searchProvider, searchApiKey, services, allowPrivate, timeoutMs, signal, resolve }, limit, clean) {
  const budget = Math.max(1000, Math.min(WEB_TIMEOUT_MS, Number(timeoutMs) || WEB_TIMEOUT_MS));
  if (name === "web_fetch") {
    const url = String(input?.url || "").trim();
    if (!url) throw new HandError("web_fetch needs a url");
    const offset = Math.max(0, Math.floor(Number(input?.offset) || 0));
    const r = await getText(url, { allowPrivate, timeoutMs: budget, signal, resolve });
    if (BINARY_TYPES.test(r.contentType)) throw new HandError(`${r.url} is ${r.contentType.split(";")[0] || "binary"}, not text`);
    const isHtml = /html|xml/.test(r.contentType) || (!r.contentType && /^\s*<(!doctype|html)/i.test(r.body));
    // The whole page is redacted before any window is cut from it, so every call's offsets count the same text.
    const text = clean(isHtml ? htmlToText(r.body, { baseUrl: r.url }) : r.body.trim());
    const head = clean(`${r.url}${r.status !== 200 ? ` (HTTP ${r.status})` : ""}${r.contentType ? ` · ${r.contentType.split(";")[0]}` : ""}${r.truncated ? ` · read stopped at ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} MB` : ""}\n\n`);
    if (!text) return `${head}(the page has no text)`;
    if (offset >= text.length) return `${head}(offset ${offset.toLocaleString()} is past the end: the page is ${text.length.toLocaleString()} characters)`;
    const from = offset ? `[from character ${offset.toLocaleString()}]\n` : "";
    // The page's window is what the budget leaves after the head, the offset line and the continuation notice.
    const window = Math.max(1000, limit - Buffer.byteLength(head) - Buffer.byteLength(from) - FETCH_NOTICE_ROOM);
    const slice = headBytes(text.slice(offset, offset + window), window);
    const rest = text.length - offset - slice.length;
    return `${head}${from}${slice}${rest > 0 ? `\n…[Filament: ${rest.toLocaleString()} more characters; continue with offset=${offset + slice.length}]` : ""}`;
  }
  if (name === "web_search") {
    const queries = [...new Set([input?.query, ...(Array.isArray(input?.queries) ? input.queries : [])].map((q) => String(q ?? "").trim()).filter(Boolean))];
    if (!queries.length) throw new HandError("web_search needs a query");
    const run = queries.slice(0, SEARCH_MAX_QUERIES);
    const most = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Math.floor(Number(input?.limit) || (run.length > 1 ? SEARCH_SEVERAL_LIMIT : SEARCH_DEFAULT_LIMIT))));
    const template = String(searchEndpoint || DEFAULT_SEARCH_ENDPOINT).trim() || DEFAULT_SEARCH_ENDPOINT;
    const wanted = String(searchProvider || "").trim().toLowerCase();
    const service = wanted && wanted !== "endpoint" && Object.hasOwn(services, wanted) ? services[wanted] : null;
    const key = service ? String(searchApiKey || process.env[service.env] || "").trim() : "";
    // Said once above the results where the service named cannot be asked: the endpoint answers in its place.
    const unasked = wanted && wanted !== "endpoint" && !service ? `no search service is called "${wanted}"` : service && !key ? `no key is set for ${service.label} (agentLoop.web.searchApiKey, or ${service.env})` : "";
    const net = { allowPrivate, timeoutMs: budget, signal, resolve };
    /** One search: the service with its key, the endpoint where it has none or it fails — that failure said beside. @param {string} query */
    const searchOne = async (query) => {
      if (service && key) {
        try {
          return { ...(await serviceSearch(service, query, most, key, net)), fellBack: "" };
        } catch (/** @type {any} */ e) {
          if (!(e instanceof HandError) || signal?.aborted) throw e;
          const viaEndpoint = await endpointSearch(template, query, most, net).catch((/** @type {any} */ e2) => {
            throw e2 instanceof HandError ? new HandError(`${e.message}; the search endpoint in its place: ${e2.message}`) : e2;
          });
          return { ...viaEndpoint, fellBack: e.message };
        }
      }
      return { ...(await endpointSearch(template, query, most, net)), fellBack: "" };
    };
    if (run.length === 1) {
      const query = run[0];
      const r = await searchOne(query);
      const note = [unasked, r.fellBack].filter(Boolean).join("; ");
      const said = note ? `(${note}; these results are ${r.host}'s)\n` : "";
      if (!r.rows.length) return `No results for "${query}" (${r.host}).${note ? ` (${note})` : ""}`;
      return listResults(`Results for "${query}" (${r.host}):\n${said}\n`, r.rows.map((x) => ({ ...x, from: [] })), limit, clean, "");
    }
    // A few at a time (SEARCH_AT_ONCE): a service's rate limit, or DuckDuckGo's bot check, turns away a burst of them.
    /** @type {PromiseSettledResult<Awaited<ReturnType<typeof searchOne>>>[]} */
    const settled = [];
    for (let i = 0; i < run.length && !signal?.aborted; i += SEARCH_AT_ONCE) settled.push(...(await Promise.allSettled(run.slice(i, i + SEARCH_AT_ONCE).map((q) => searchOne(q)))));
    if (signal?.aborted) throw new HandError("the search was cancelled");
    const failed = settled.flatMap((s, i) => (s.status === "rejected" ? [`[${i + 1}] "${run[i]}" failed: ${s.reason?.message || s.reason}`] : []));
    const answered = settled.flatMap((s, i) => (s.status === "fulfilled" ? [{ i, ...s.value }] : []));
    if (!answered.length) throw new HandError(`every search failed — ${failed.join("; ")}`);
    const hosts = [...new Set(answered.map((a) => a.host))].join(", ");
    const fellBack = [...new Set(answered.map((a) => a.fellBack).filter(Boolean))];
    const note = [unasked, ...fellBack].filter(Boolean).join("; ");
    const lead = `Results for ${run.length} searches (${hosts}): ${run.map((q, i) => `[${i + 1}] "${q}"`).join(" · ")}\n${note ? `(${note}; the endpoint answered in its place)\n` : ""}\n`;
    const tail = [...(queries.length > run.length ? [`[${queries.length - run.length} more searches not run: at most ${SEARCH_MAX_QUERIES} at once]`] : []), ...failed].join("\n");
    const rows = fuse(answered.map((a) => ({ n: a.i + 1, rows: a.rows }))).slice(0, most);
    if (!rows.length) return `No results for ${run.map((q) => `"${q}"`).join(", ")} (${hosts}).${note ? ` (${note})` : ""}${tail ? `\n${tail}` : ""}`;
    return listResults(lead, rows, limit, clean, tail);
  }
  throw new HandError(`unknown web hand ${name}`);
}

/**
 * The search endpoint's results for one query, at most `most`, with the host that answered. A challenge page with no
 * result on it is said as the bot check it is, with the way past it.
 * @param {string} template @param {string} query @param {number} most @param {any} net
 */
async function endpointSearch(template, query, most, net) {
  const url = template.includes("{query}") ? template.replace("{query}", encodeURIComponent(query)) : `${template}${template.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}`;
  let host;
  try {
    host = new URL(url).host;
  } catch {
    throw new HandError(`the search endpoint is not a URL: ${template.slice(0, 200)} (agentLoop.web.searchEndpoint)`);
  }
  const r = await getText(url, { ...net, accept: "application/json,text/html;q=0.9,*/*;q=0.5" });
  if (r.status >= 400) throw new HandError(`the search endpoint answered HTTP ${r.status} (${host})`);
  // A challenge page with no result on it — whatever links it has, which the last-resort read would take for results.
  if (BOT_CHECK.test(r.body) && !/\bresult__a\b/.test(r.body))
    throw new HandError(`${host} refused the search as automated (its bot check): try again later, or have the person set a search service with its key in the console's Settings › Agent loop (agentLoop.web.searchProvider and searchApiKey)`);
  return { rows: parseSearchResults(r.body, r.contentType).slice(0, most), host };
}

/**
 * A search service's results for one query, at most `most`, with its host. Its refusal is said by its name and status
 * only — what it sent back may echo the key.
 * @param {SearchService} service @param {string} query @param {number} most @param {string} key @param {any} net
 */
async function serviceSearch(service, query, most, key, net) {
  const req = service.request(query, most, key);
  const host = new URL(req.url).host;
  const r = await getText(req.url, { ...net, accept: "application/json", method: req.method || "GET", headers: req.headers, body: req.body });
  if (r.status >= 400) throw new HandError(`${service.label} answered HTTP ${r.status}${r.status === 401 || r.status === 403 ? " (the key was refused)" : r.status === 429 || r.status === 432 || r.status === 433 ? " (past its limit of searches)" : ""}`);
  return { rows: parseSearchResults(r.body, r.contentType || "application/json").slice(0, most), host };
}

/**
 * A page's address as two searches would both name it: no fragment, no tracking parameters, no `www.`, no trailing
 * slash, either scheme. @param {string} url
 */
function sameKey(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_.*|fbclid|gclid|ref)$/i.test(k)) u.searchParams.delete(k);
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * Several searches' results as one list: a page found twice is one row naming every search that found it, the rows in
 * reciprocal-rank-fusion order — each search's rank r adds 1/(60 + r), so agreement outranks one search's first place.
 * @param {{ n: number, rows: { title: string, url: string, snippet: string }[] }[]} lists
 * @returns {{ title: string, url: string, snippet: string, from: number[] }[]}
 */
function fuse(lists) {
  /** @type {Map<string, { row: { title: string, url: string, snippet: string }, score: number, from: number[] }>} */
  const merged = new Map();
  for (const { n, rows } of lists) {
    // A page one search lists twice (two spellings of its address) counts once, at its better rank.
    const own = new Set();
    rows.forEach((row, rank) => {
      const k = sameKey(row.url);
      if (own.has(k)) return;
      own.add(k);
      const m = merged.get(k);
      if (!m) return void merged.set(k, { row, score: 1 / (FUSION_K + rank), from: [n] });
      m.score += 1 / (FUSION_K + rank);
      if (!m.from.includes(n)) m.from.push(n);
      if (!m.row.snippet && row.snippet) m.row = { ...m.row, snippet: row.snippet };
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).map((m) => ({ ...m.row, from: m.from }));
}

/**
 * Whole results within the budget, each redacted before it is measured; a row several searches share names them.
 * @param {string} lead @param {{ title: string, url: string, snippet: string, from: number[] }[]} rows @param {number} limit
 * @param {(text: string) => string} clean @param {string} tail  said after the rows (searches left out or failed)
 */
function listResults(lead, rows, limit, clean, tail) {
  const shown = [];
  let bytes = Buffer.byteLength(lead) + FETCH_NOTICE_ROOM + (tail ? Buffer.byteLength(tail) + 1 : 0);
  for (const [i, x] of rows.entries()) {
    const by = x.from.length ? ` [${x.from.join(", ")}]` : "";
    const row = clean(`${i + 1}. ${x.title}${by}\n   ${x.url}${x.snippet ? `\n   ${x.snippet.slice(0, 300)}` : ""}`);
    bytes += Buffer.byteLength(row) + 1;
    if (bytes > limit && shown.length) break;
    shown.push(shown.length ? row : headBytes(row, limit - Buffer.byteLength(lead) - FETCH_NOTICE_ROOM));
  }
  const cut = shown.length < rows.length ? `\n[${shown.length} of ${rows.length} results shown — past this result's budget; ask for fewer (limit) or a narrower query.]` : "";
  return `${lead}${shown.join("\n")}${cut}${tail ? `\n${tail}` : ""}`;
}
