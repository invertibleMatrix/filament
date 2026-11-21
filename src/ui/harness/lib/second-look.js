// @ts-check
// A second look on the page (HarnessV4_Space_Plan S3b, SG-D12): the Reviewer's answer as the lines it is asked for —
// from its first numbered line on, each line its own, its numbering and marks of emphasis taken off, its label apart
// ("Production: …") —, what it reads
// while it reads, from its run's calls, and how long it has read. Text, never HTML. Pure, for the permission card and a
// dashboard button's sheet alike (conversation/second-look.js draws them).

/** How much of a call's subject the line "reading …" shows. */
const DOING_CHARS = 90;

/**
 * The Reviewer's answer as lines: each line that says something, its "1." / "**1.**" / "-" / "•" and its `**` and
 * backticks off.
 * @param {string} text
 * @returns {string[]}
 */
export const lookLines = (text) =>
  String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\*\*|__)?(?:\d+[.)]|[-*•])(?:\*\*|__)?\s+/, "").replace(/\*\*|__|`/g, "").trim())
    .filter(Boolean);

/** A line its answer numbers: "1. …", "2) …", "**3.** …". */
const NUMBERED = /^\s*(?:\*\*|__)?\d+[.)]/;

/**
 * The Reviewer's answer: its lines from its first numbered one on — what it says before ("Let me look at what it
 * changes.", a round that reads first) is not its answer. While it comes (`done` false) that is none until a numbered
 * line comes; once it is done, every line where it numbered none.
 * @param {string} text @param {boolean} [done]
 * @returns {string[]}
 */
export function lookAnswer(text, done = false) {
  const all = String(text || "").split(/\r?\n/);
  const first = all.findIndex((l) => NUMBERED.test(l));
  return first >= 0 ? lookLines(all.slice(first).join("\n")) : done ? lookLines(text) : [];
}

/**
 * A line with its label apart, where it starts with one ("Way back: git push --delete …"): a few words before a colon.
 * @param {string} line
 * @returns {{ label: string, text: string }}
 */
export function lookLine(line) {
  const m = /^([A-Z][A-Za-z' ]{0,28}):\s+(.+)$/.exec(line);
  return m ? { label: m[1], text: m[2] } : { label: "", text: line };
}

/**
 * What it reads now, from one of its run's events — a call as it starts —, or null.
 * @param {any} e
 * @returns {string | null}
 */
export function readingWords(e) {
  if (e?.type !== "tool-start") return null;
  const what = `${String(e.name || "")} ${String(e.args || "")}`.trim();
  return what.length > DOING_CHARS ? `${what.slice(0, DOING_CHARS - 1)}…` : what;
}

/**
 * How long it read, in the card's words: "7 s", "1 min 12 s".
 * @param {number} ms
 */
export function lookTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
}

/**
 * The words of the round a reply is in now: the blocks after those that stood before it (`from`, its `round-start`'s
 * `blocksBefore`), text only.
 * @param {{ blocks?: { type: string, text: string }[] } | null} reply @param {number} from
 */
export const roundText = (reply, from) =>
  (reply?.blocks || []).slice(Math.max(0, from)).filter((b) => b.type === "text").map((b) => b.text).join("");
