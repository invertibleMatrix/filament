// @ts-check
// A hunt's range (the plan's p6): what BugHunters hunts in — a diff (what is uncommitted, or everything since a ref), a
// commit range (`a..b`) or a list of files; none named, what is uncommitted and what the chat's turns changed — as a
// person's Brief, the main agent's team tool or the Plan's hunt names it, and the block a lead's opening carries it in:
// its files, each with the lines its diff changes and how to read that diff, never the diff itself. Pure:
// app/hunt-range.js reads it from git.

/**
 * How much of a range is taken and said: the characters a range's words take, the paths a list names, and the files a
 * lead's opening lists — the rest counted, with how to list them.
 */
export const RANGE_LIMITS = Object.freeze({ words: 2000, paths: 200, files: 40 });

/** The card that leads a hunt: BugHunters' own Lead, which a copy of the team keeps. */
export const HUNT_LEAD = "huntlead";
/** Whether a team hunts — its lead is BugHunters' — and so takes a range. @param {{ lead?: { tag?: string } } | null | undefined} team */
export const huntsIn = (team) => team?.lead?.tag === HUNT_LEAD;

/**
 * A range as it was named: none (`chat`, the default); what is uncommitted; everything since a ref; a commit range;
 * words that name files or folders — or one ref; a list of files a caller knows (`files`, the Plan's hunt: its task's).
 * @typedef {{ kind: "chat" } | { kind: "uncommitted" } | { kind: "diff", ref: string } | { kind: "commits", from: string, to: string }
 *   | { kind: "words", words: string[] } | { kind: "files", files: string[] }} RangeSpec
 */

/**
 * One file of a range: its path as git names it from the repository's top (a place apart says which first), the lines
 * its diff adds and removes — null where it is no diff's —, a word on it, and the command that reads its diff where it
 * reads otherwise than the range's own (`HuntRange.read`).
 * @typedef {{ path: string, added: number | null, removed: number | null, binary?: boolean, note?: string, read?: string }} RangeFile
 */

/**
 * A range read from git: what it names, in words; its files; how to read a file's diff, in a sentence (`<file>` stands
 * for each); how to list every file, where the opening lists only the first; and where the paths start from, where that
 * is not the chat's folder.
 * @typedef {{ kind: "chat" | "uncommitted" | "diff" | "commits" | "files", label: string, files: RangeFile[], read: string,
 *   list: string, top?: string | null }} HuntRange
 */

/**
 * A range as it was named, read: a string as a person or the team tool writes it, or a list of files. Plain words —
 * "uncommitted"; "since <ref>" or "diff <ref>"; "a..b"; else files and folders, by commas, spaces or lines — a path
 * with spaces in quotes, double, single or back — of which one alone may be a ref instead. Nothing named is the
 * default. An `error` says in words what cannot be one.
 * @param {unknown} v @returns {RangeSpec | { error: string }}
 */
export function parseRange(v) {
  if (Array.isArray(v)) {
    const files = [...new Set(v.map((s) => String(s ?? "").trim()).filter(Boolean))];
    if (files.length > RANGE_LIMITS.paths) return { error: `a range names up to ${RANGE_LIMITS.paths} files; this one names ${files.length}` };
    return files.length ? { kind: "files", files } : { kind: "chat" };
  }
  if (v != null && typeof v !== "string") return { error: "a range is words: a diff (uncommitted, or since a ref), a commit range (a..b), or files" };
  const s = String(v ?? "").replace(/\r\n?/g, "\n").trim();
  if (!s) return { kind: "chat" };
  if (s.length > RANGE_LIMITS.words) return { error: `a range is ${RANGE_LIMITS.words} characters at most; this is ${s.length}` };
  if (/^uncommitted$/i.test(s)) return { kind: "uncommitted" };
  const since = /^(?:since|diff)(?::\s*|\s+)(\S+)$/i.exec(s);
  if (since) return { kind: "diff", ref: since[1] };
  const span = /^(\S*?)(\.{2,})(\S*)$/.exec(s);
  if (span) {
    if (span[2].length > 2) return { error: `\`${s}\`: a commit range is two commits with two dots between them, as in main..HEAD` };
    if (!span[1]) return { error: `\`${s}\` names no commit to start from: a commit range is a..b, as in main..HEAD` };
    return { kind: "commits", from: span[1], to: span[3] || "HEAD" };
  }
  const words = [...s.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s,"'`]+)/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim()).filter(Boolean);
  if (words.length > RANGE_LIMITS.paths) return { error: `a range names up to ${RANGE_LIMITS.paths} files; this one names ${words.length}` };
  return { kind: "words", words };
}

/**
 * A path as a suggested command names it: in double quotes, which bash and PowerShell both read as one word.
 * @param {string} path
 */
export const quoted = (path) => `"${path}"`;
/** How Filament suggests a read of git: never a refresh of the repository's index. */
export const GIT_READ = "git --no-optional-locks";

/** A count with its noun. @param {number} n @param {string} one */
const counted = (n, one) => `${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`;

/** The lines a file's diff changes, in a few words; "" where it is no diff's. @param {RangeFile} f */
export const linesOf = (f) => (f.binary ? "binary" : f.added == null && f.removed == null ? "" : `+${f.added ?? 0} −${f.removed ?? 0}`);

/**
 * What a range's reader does with its files: a lead splits the hunt by them among its Hunters; a Reviewer sent alone
 * (the Plan's hunt from a node) hunts them itself.
 */
const RANGE_DOES = Object.freeze({ lead: "Split the hunt by these files: give each Hunter its own, a large one alone.", alone: "Hunt in these files yourself, the riskiest first." });

/**
 * The block a hunt's reader reads its range in, ahead of the words it is given: what it names, how many files and
 * lines, how to read a file's diff, and its files — the first RANGE_LIMITS.files, each with its lines and a word, the
 * rest counted with how to list them. `reader`: a lead, told to split the hunt by them, or one hunting alone. No diff is
 * pasted. @param {HuntRange} r @param {keyof typeof RANGE_DOES} [reader]
 */
export function rangeBlock(r, reader = "lead") {
  const shown = r.files.slice(0, RANGE_LIMITS.files);
  const rest = r.files.length - shown.length;
  const added = r.files.reduce((n, f) => n + (f.added ?? 0), 0);
  const removed = r.files.reduce((n, f) => n + (f.removed ?? 0), 0);
  const sized = r.files.some((f) => f.added != null || f.removed != null) ? `, +${added.toLocaleString("en-US")} −${removed.toLocaleString("en-US")} lines` : "";
  return [
    `<hunt-range files="${r.files.length}">`,
    `What to hunt in: ${r.label} — ${counted(r.files.length, "file")}${sized}. ${RANGE_DOES[reader]} ${r.read}${r.top ? ` — the paths from the repository's top, ${r.top}` : ""}. No diff is pasted here: read what you need.`,
    "",
    ...shown.map((f) => {
      const parts = [linesOf(f), f.note || ""].filter(Boolean).join(", ");
      return `- ${f.path}${parts ? ` (${parts})` : ""}${f.read ? ` — ${f.read}` : ""}`;
    }),
    ...(rest ? [`- and ${counted(rest, "more file")}: ${r.list} lists them all`] : []),
    "</hunt-range>",
  ].join("\n");
}

/** Whether a content block is a hunt's range. @param {any} b */
export const isRangeBlock = (b) => b?.type === "text" && String(b.text || "").startsWith("<hunt-range ");
