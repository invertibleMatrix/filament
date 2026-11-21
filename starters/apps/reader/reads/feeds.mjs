// The Reader's rows: each feed's newest posts — RSS or Atom — read from the addresses in the JSON list it is given,
// as one JSON answer on stdout ({ "posts": [{ "id", "feed", "title", "link", "date", "text" }], "failed": [...] }),
// newest first. Filament runs it in the project's folder; it only reads. A feed that fails is named in "failed" and
// the rest still read.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const list = process.argv[2] || "feeds.json";
/** @type {string[]} */
let feeds = [];
try {
  feeds = JSON.parse(readFileSync(list, "utf8")).filter((/** @type {unknown} */ u) => typeof u === "string");
} catch (/** @type {any} */ e) {
  process.stderr.write(`${list} is no JSON list of addresses (${e?.message || e})\n`);
  process.exit(1);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** A numeric entity's character, or the entity as written where it names none (`&#abc;`, past U+10FFFF). @param {string} m @param {string} e */
const charOf = (m, e) => {
  const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : /^#\d+$/.test(e) ? Number(e.slice(1)) : NaN;
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : m;
};
/** A tag's text, its CDATA and entities read, its markup dropped. @param {string} s */
const plain = (s) =>
  String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    // Its entities first, as an RSS description escapes its HTML; then that HTML dropped.
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === "#" ? charOf(m, e) : ENTITIES[e.toLowerCase()] ?? m))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** A post's link as its page may open it: a web address — one relative to its feed read against it —, else none. @param {string} link @param {string} feed */
const webLink = (link, feed) => {
  try {
    const u = new URL(link, feed);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
};
/** The text of the first of these tags in a part. @param {string} part @param {string[]} tags */
const tagOf = (part, tags) => {
  for (const t of tags) {
    const m = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "i").exec(part);
    if (m) return m[1];
  }
  return "";
};
/** An Atom entry's link: its alternate one, else its first. @param {string} part */
const atomLink = (part) => {
  const links = [...part.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const alt = links.find((a) => !/rel=["'](?!alternate)/i.test(a)) || links[0] || "";
  return /href=["']([^"']+)["']/i.exec(alt)?.[1] || "";
};

/** One feed's posts. @param {string} url */
async function postsOf(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Filament Reader", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  const xml = await res.text();
  const feed = plain(tagOf(xml.replace(/<(item|entry)\b[\s\S]*$/i, ""), ["title"])) || new URL(url).host;
  const parts = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return parts.slice(0, 50).map((part) => {
    const atom = /^<entry/i.test(part);
    // A feed's link is the feed's to say: a javascript: one opens nothing (found reviewing the Space work).
    const link = webLink(atom ? atomLink(part) : plain(tagOf(part, ["link"])) || plain(tagOf(part, ["guid"])), url);
    const when = Date.parse(plain(tagOf(part, ["pubDate", "published", "updated", "dc:date"])));
    const id = plain(tagOf(part, ["guid", "id"])) || link || plain(tagOf(part, ["title"]));
    return {
      // Short, so a page keeps it as a record's id: its feed and its own id, hashed.
      id: createHash("sha256").update(`${url}#${id}`).digest("hex").slice(0, 16),
      feed,
      title: plain(tagOf(part, ["title"])) || "(untitled)",
      link,
      date: Number.isFinite(when) ? new Date(when).toISOString() : "",
      text: plain(tagOf(part, ["description", "summary", "content"])).slice(0, 280),
    };
  });
}

const read = await Promise.all(feeds.map((u) => postsOf(u).then((posts) => ({ u, posts }), (e) => ({ u, error: String(e?.message || e) }))));
const posts = read.flatMap((r) => r.posts || []).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300);
const failed = read.filter((r) => r.error).map((r) => ({ feed: r.u, error: r.error }));
if (!posts.length && failed.length) {
  process.stderr.write(failed.map((x) => `${x.feed}: ${x.error}`).join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ posts, failed }));
