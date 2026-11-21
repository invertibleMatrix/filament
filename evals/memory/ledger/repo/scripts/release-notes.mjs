// Writes release-notes/<version>.md from that version's section of CHANGELOG.md.
//
//   node scripts/release-notes.mjs 0.4.0
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: node scripts/release-notes.mjs <version>");
  process.exit(2);
}
const lines = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l === `## ${version}` || l.startsWith(`## ${version} `));
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).filter((l) => l.trim());
mkdirSync("release-notes", { recursive: true });
writeFileSync(`release-notes/${version}.md`, `# tally ${version}\n\n${body.join("\n")}\n`);
console.log(`release-notes/${version}.md: ${body.length} lines`);
