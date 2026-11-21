// @ts-check
// A commit's guard against private words: names, machines, accounts and addresses that must never reach the published
// source or its history. The words live outside the repository — in the file `FILAMENT_PRIVATE_TERMS` names, else
// `~/.filament-private-terms`, one per line, `#` for a comment, matched without regard to case — so the list itself is
// never published. No file, nothing is checked.
//
//   node scripts/privacy-check.mjs --staged          the lines a commit adds, and the paths it adds (pre-commit)
//   node scripts/privacy-check.mjs --message <file>  a commit's message (commit-msg)
//   node scripts/privacy-check.mjs --install         puts both into this clone's hooks, beside what is there
//
// A hit names the file, the line and the word, and the commit stops: say it another way, or (for a false hit)
// commit with --no-verify.
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The words of a terms file: one per line, trimmed; blank lines and `#` comments left out. @param {string} text */
export function termsFrom(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** Where the terms are kept. @param {NodeJS.ProcessEnv} [env] */
export const termsPath = (env = process.env) => env.FILAMENT_PRIVATE_TERMS || join(homedir(), ".filament-private-terms");

/**
 * The lines a staged diff adds, each with its file and line number: from `git diff --cached -U0`'s text. A new file's
 * path counts as a line of its own (line 0): a name can be private too.
 * @param {string} diff
 * @returns {{ file: string, line: number, text: string }[]}
 */
export function addedLines(diff) {
  /** @type {{ file: string, line: number, text: string }[]} */
  const out = [];
  let file = "";
  let at = 0;
  for (const l of String(diff || "").split("\n")) {
    if (l.startsWith("+++ ")) {
      file = l.startsWith("+++ b/") ? l.slice(6) : "";
      if (file) out.push({ file, line: 0, text: file });
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (hunk) {
      at = Number(hunk[1]);
      continue;
    }
    if (!file || l.startsWith("--- ")) continue;
    if (l.startsWith("+")) out.push({ file, line: at++, text: l.slice(1) });
    else if (!l.startsWith("-") && !l.startsWith("\\")) at++;
  }
  return out;
}

/**
 * Each line that holds a term, with the term it holds, without regard to case.
 * @param {{ file: string, line: number, text: string }[]} lines @param {string[]} terms
 */
export function hitsIn(lines, terms) {
  const low = terms.map((t) => [t, t.toLowerCase()]);
  /** @type {{ file: string, line: number, term: string }[]} */
  const out = [];
  for (const l of lines) {
    const text = l.text.toLowerCase();
    for (const [t, lt] of low) if (text.includes(lt)) out.push({ file: l.file, line: l.line, term: t });
  }
  return out;
}

/** The hook blocks `--install` adds, between markers so a second install replaces its own. */
const BLOCK = (/** @type {string} */ args) => `# BEGIN Filament privacy check
root="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -f "$root/scripts/privacy-check.mjs" ]; then node "$root/scripts/privacy-check.mjs" ${args} || exit 1; fi
# END Filament privacy check
`;

/** Adds the block to a hook file, keeping what it holds; a block from before is replaced. @param {string} file @param {string} args */
export function withBlock(file, args) {
  const was = existsSync(file) ? readFileSync(file, "utf8") : "#!/bin/sh\n";
  const kept = was.replace(/# BEGIN Filament privacy check[\s\S]*?# END Filament privacy check\n?/, "");
  return `${kept.endsWith("\n") ? kept : `${kept}\n`}${BLOCK(args)}`;
}

/** @param {string[]} argv */
function main(argv) {
  if (argv[0] === "--install") {
    const hooks = resolve(execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim(), "hooks");
    for (const [name, args] of [["pre-commit", "--staged"], ["commit-msg", '--message "$1"']]) {
      const file = join(hooks, name);
      writeFileSync(file, withBlock(file, args));
      try { chmodSync(file, 0o755); } catch {}
      console.log(`privacy check: ${file}`);
    }
    return 0;
  }
  const path = termsPath();
  if (!existsSync(path)) return 0;
  const terms = termsFrom(readFileSync(path, "utf8"));
  if (!terms.length) return 0;
  /** @type {{ file: string, line: number, text: string }[]} */
  let lines = [];
  if (argv[0] === "--staged") lines = addedLines(execFileSync("git", ["diff", "--cached", "-U0", "--no-color", "--no-ext-diff"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
  else if (argv[0] === "--message" && argv[1]) lines = readFileSync(argv[1], "utf8").split(/\r?\n/).filter((l) => !l.startsWith("#")).map((text, i) => ({ file: "the commit message", line: i + 1, text }));
  else {
    console.error("usage: privacy-check.mjs --staged | --message <file> | --install");
    return 2;
  }
  const hits = hitsIn(lines, terms);
  if (!hits.length) return 0;
  console.error(`Private words in this commit (the list in ${path}):`);
  for (const h of hits.slice(0, 50)) console.error(`  ${h.file}${h.line ? `:${h.line}` : " (its path)"}: "${h.term}"`);
  if (hits.length > 50) console.error(`  …and ${hits.length - 50} more`);
  console.error("Say it another way; for a false hit, commit with --no-verify.");
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
