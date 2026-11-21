// What the task eval's fixtures check a folder with (scripts/memory-task-eval.mjs): a section of a changelog, the JSDoc
// above a function, the tests, a file left as the fixture had it. Each check answers true, or what is wrong in words.
import { readFileSync } from "node:fs";

/** The lines of a `## ` section of a markdown file, its heading aside; null where it has none. @param {string | null} text @param {(heading: string) => boolean} which */
export function section(text, which) {
  const lines = String(text ?? "").split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("## ") && which(l.slice(3).trim()));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end);
}

/** A section's list items. @param {string[] | null} lines */
export const bullets = (lines) => (lines || []).filter((l) => /^\s*[-*] \S/.test(l)).map((l) => l.trim());

/** The items under `## Unreleased`. @param {string | null} text */
export const unreleased = (text) => bullets(section(text, (h) => /^unreleased$/i.test(h)));

/**
 * The JSDoc block right above a function's declaration (`export function name`, `export async function name`, `export
 * const name =`, or the same unexported, as `export { name }` exports it); null where there is none.
 * @param {string | null} text @param {string} name
 */
export function jsdocOf(text, name) {
  const src = String(text ?? "");
  const decl = new RegExp(`^(?:export\\s+)?(?:async\\s+function\\s*\\*?|function\\s*\\*?|const|let)\\s+${name}\\b`, "m").exec(src);
  if (!decl) return null;
  const before = src.slice(0, decl.index).trimEnd();
  if (!before.endsWith("*/")) return null;
  const open = before.lastIndexOf("/**");
  return open < 0 ? null : before.slice(open);
}

// ---- checks a fixture puts together ----

/** The repository's tests pass, and one of them names `name` (none named: any). @param {any} ctx @param {string} [name] */
export function testsPass(ctx, name) {
  const r = ctx.run(process.execPath, ["--test"]);
  if (r.code !== 0) return `node --test fails:\n${r.out.split(/\r?\n/).filter((l) => /not ok|Error|fail/i.test(l)).slice(0, 12).join("\n")}`;
  if (!name) return true;
  return [...ctx.files()].some(([p, t]) => /^test\//.test(p) && t.includes(name)) || `no test under test/ names ${name}`;
}

/** CHANGELOG.md has more items under `## Unreleased` than it had as the task began. @param {any} ctx */
export function changelogGrew(ctx) {
  const was = unreleased(ctx.before.get("CHANGELOG.md") ?? null).length;
  const now = unreleased(ctx.read("CHANGELOG.md")).length;
  return now > was || `CHANGELOG.md has ${now} item(s) under ## Unreleased, as many as before the task (${was})`;
}

/** The exported function has a JSDoc block with @param and @returns. @param {any} ctx @param {string} file @param {string} name */
export function documented(ctx, file, name) {
  const doc = jsdocOf(ctx.read(file), name);
  if (!doc) return `${file}: no JSDoc block right above ${name}`;
  if (!/@param\b/.test(doc) || !/@returns?\b/.test(doc)) return `${file}: the JSDoc above ${name} has no ${/@param\b/.test(doc) ? "@returns" : "@param"}`;
  return true;
}

/** A file is as the fixture's repository had it (line endings aside). @param {any} ctx @param {string} file @param {string} original */
export function untouched(ctx, file, original) {
  const now = ctx.read(file);
  const was = readFileSync(original, "utf8");
  if (now == null) return `${file} is gone`;
  return now.replace(/\r\n/g, "\n") === was.replace(/\r\n/g, "\n") || `${file} was changed`;
}

/**
 * A release cut in CHANGELOG.md: a `## <version> — <YYYY-MM-DD>` section holding every item that was under `## Unreleased`
 * as the task began, and an `## Unreleased` above it with none.
 * @param {any} ctx @param {string} version
 */
export function changelogReleased(ctx, version) {
  const text = ctx.read("CHANGELOG.md");
  const was = unreleased(ctx.before.get("CHANGELOG.md") ?? null);
  const esc = version.replace(/\./g, "\\.");
  const rel = section(text, (h) => new RegExp(`^${esc}\\s+[—–-]+\\s+\\d{4}-\\d{2}-\\d{2}$`).test(h));
  if (!rel) return `CHANGELOG.md has no \`## ${version} — YYYY-MM-DD\` heading`;
  const missing = was.filter((b) => !bullets(rel).includes(b));
  if (missing.length) return `the ${version} section lacks what was under Unreleased: ${missing.join(" | ")}`;
  const lines = String(text).split(/\r?\n/);
  const un = lines.findIndex((l) => /^## unreleased\s*$/i.test(l));
  const at = lines.findIndex((l) => new RegExp(`^## ${esc}\\b`).test(l));
  if (un < 0 || un > at) return "no `## Unreleased` heading above the release";
  if (unreleased(text).length) return "## Unreleased still holds items";
  return true;
}

/** release-notes/<version>.md holds each item of the version's changelog section. @param {any} ctx @param {string} version */
export function releaseNotes(ctx, version) {
  const notes = ctx.read(`release-notes/${version}.md`);
  if (notes == null) return `there is no release-notes/${version}.md`;
  const items = bullets(section(ctx.read("CHANGELOG.md"), (h) => h.startsWith(`${version} `) || h === version));
  const missing = items.filter((b) => !notes.includes(b));
  return missing.length ? `release-notes/${version}.md lacks ${missing.join(" | ")}` : true;
}
