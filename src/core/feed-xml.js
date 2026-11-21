// @ts-check
// An RSS or Atom feed read into rows (the Space Apps plan of 10-29, more reads): an app's `fetch` source `as: "rss"`
// answers its items as rows — each its id, its feed's title, its title, link, date and a line of its text —, the newest
// first. Pure: no network, no XML library; a feed's markup is regular enough for a reader that takes what it finds and
// skips what it does not.

/** The most items one feed gives, and how long an item's text and id may be. */
export const FEED_ITEMS_MAX = 200;
export const FEED_TEXT_MAX = 280;
export const FEED_ID_MAX = 200;

/** @typedef {{ id: string, feed: string, title: string, link: string, date: string, text: string }} FeedRow */

/** @type {Record<string, string>} */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** A text's entities read: &amp;, &#8212;, &#x2014; — one that names no character stays as written. @param {string} s */
const entitiesRead = (s) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });

/**
 * A tag's text: its CDATA opened and its entities read first — an RSS description escapes its HTML —, then that HTML
 * dropped, the HTML's own entities read, and its spaces made one. `hide`: an app's secrets hidden at each step, before
 * a tag dropped or a space made one changes one past what is looked for (found reviewing the Space work, 10-29).
 * @param {unknown} s @param {(t: string) => string} [hide]
 */
export function plainText(s, hide = (t) => t) {
  const markup = hide(entitiesRead(hide(String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))));
  // A tag ends at the next < too: run on to the text's end from each < with no > after it, 1 MB of them held the
  // thread for minutes (found reviewing the Space work, 10-29).
  return hide(hide(entitiesRead(markup.replace(/<[^<>]+>/g, " "))).replace(/\s+/g, " ")).trim();
}

/** The inner markup of the first of these tags in a part, or "". @param {string} part @param {string[]} tags */
function tagOf(part, tags) {
  for (const t of tags) {
    const m = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "i").exec(part);
    if (m) return m[1];
  }
  return "";
}

/** An Atom entry's link: its alternate one, else its first. @param {string} part @param {(t: string) => string} hide */
function atomLink(part, hide) {
  const links = [...part.matchAll(/<link\b([^<>]*)\/?>/gi)].map((m) => m[1]);
  const alt = links.find((a) => !/rel=["'](?!alternate)/i.test(a)) || links[0] || "";
  return plainText(/href=["']([^"']+)["']/i.exec(alt)?.[1] || "", hide);
}

/**
 * A feed's items and entries, each whole, in order, the first `FEED_ITEMS_MAX`: read in one pass, each close looked
 * for once — a pattern that ran on from each opened item never closed held the thread for minutes on 1 MB of them
 * (found reviewing the Space work, 10-29). @param {string} text
 */
function partsOf(text) {
  /** @type {string[]} */
  const parts = [];
  const open = /<(item|entry)\b/gi;
  /** The tags with no close after where one was looked for: none comes later either. @type {Set<string>} */
  const unclosed = new Set();
  /** @type {RegExpExecArray | null} */
  let m;
  while (parts.length < FEED_ITEMS_MAX && (m = open.exec(text))) {
    const tag = m[1].toLowerCase();
    if (unclosed.has(tag)) continue;
    const close = new RegExp(`</${tag}>`, "gi");
    close.lastIndex = open.lastIndex;
    const c = close.exec(text);
    if (!c) {
      unclosed.add(tag);
      continue;
    }
    parts.push(text.slice(m.index, c.index + c[0].length));
    open.lastIndex = c.index + c[0].length;
  }
  return parts;
}

/**
 * A feed's items as rows, the newest first, or what is wrong in words where it is no feed.
 * @param {string} xml  what its address answered
 * @param {string} [from]  its address, which names it where it has no title
 * @param {(t: string) => string} [hide]  an app's secrets hidden in each text as it is made plain, before it is cut
 * @returns {{ ok: true, rows: FeedRow[] } | { ok: false, error: string }}
 */
export function feedRows(xml, from = "", hide = (t) => t) {
  const text = String(xml || "");
  if (!/<(rss|feed|rdf:RDF)\b/i.test(text)) {
    // Hidden before it is cut, as every text here is.
    const said = hide(text.trim());
    const head = said.slice(0, 80);
    return { ok: false, error: head ? `it answered no RSS or Atom feed: “${head}${said.length > 80 ? "…" : ""}”` : "it answered nothing" };
  }
  let host = "";
  try {
    host = from ? new URL(from).host : "";
  } catch {}
  const feed = plainText(tagOf(text.replace(/<(item|entry)\b[\s\S]*$/i, ""), ["title"]), hide) || host;
  const parts = partsOf(text);
  const rows = parts.map((part) => {
    const atom = /^<entry/i.test(part);
    const link = atom ? atomLink(part, hide) : plainText(tagOf(part, ["link"]), hide) || plainText(tagOf(part, ["guid"]), hide);
    const when = Date.parse(plainText(tagOf(part, ["pubDate", "published", "updated", "dc:date"])));
    const title = plainText(tagOf(part, ["title"]), hide);
    return {
      id: (plainText(tagOf(part, ["guid", "id"]), hide) || link || title).slice(0, FEED_ID_MAX),
      feed,
      title: title || "(untitled)",
      link,
      date: Number.isFinite(when) ? new Date(when).toISOString() : "",
      text: plainText(tagOf(part, ["description", "summary", "content", "content:encoded"]), hide).slice(0, FEED_TEXT_MAX),
    };
  });
  // Newest first; an item with no date after those with one, in the feed's own order.
  const order = rows.map((r, i) => ({ r, i }));
  order.sort((a, b) => (b.r.date || "").localeCompare(a.r.date || "") || a.i - b.i);
  return { ok: true, rows: order.map((x) => x.r) };
}
