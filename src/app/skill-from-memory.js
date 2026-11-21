// @ts-check
// The lines a made skill holds from memory (HarnessV4_Skills_Plan step 4, the owner's word of 10-27): Add to a skill…
// writes a memory's words into a section of its SKILL.md, and they are noted here, beside its library, by memory and
// section. Write it from its books… writes the whole SKILL.md again; the lines from memory that still stood in it are
// put back where the new draft dropped them, under their section, so a person's words outlive a model's rewrite. A line
// taken out by hand since is no longer in the SKILL.md, and is not put back.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { holdsLines, withLines } from "../core/skill-sections.js";

/** Where a made skill's lines from memory are noted, in its folder. */
export const FROM_MEMORY_FILE = join(".library", "from-memory.json");
/** The most noted for one skill: the oldest go first. */
const NOTED_MAX = 500;

/** @typedef {{ memory: string, section: string, lines: string[], at: number }} FromMemory */

/** What a made skill holds from memory, oldest first. @param {string} dir @returns {FromMemory[]} */
export function fromMemoryOf(dir) {
  try {
    const got = JSON.parse(readFileSync(join(dir, FROM_MEMORY_FILE), "utf8"));
    return Array.isArray(got) ? got.filter((r) => r && typeof r.section === "string" && Array.isArray(r.lines) && r.lines.length) : [];
  } catch {
    return [];
  }
}

/**
 * Lines added from a memory, noted: the same lines under the same section once.
 * @param {string} dir @param {{ memory: string, section: string, lines: string[] }} rec @param {number} [at]
 */
export function noteFromMemory(dir, { memory, section, lines }, at = Date.now()) {
  const kept = fromMemoryOf(dir).filter((r) => !(r.section.toLowerCase() === section.toLowerCase() && r.lines.join("\n") === lines.join("\n")));
  const all = [...kept, { memory: String(memory), section, lines: lines.map(String), at }].slice(-NOTED_MAX);
  const file = join(dir, FROM_MEMORY_FILE);
  mkdirSync(join(dir, ".library"), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 1));
  renameSync(tmp, file);
}

/**
 * A new draft of a made skill with the lines from memory put back: those that stood in its SKILL.md before (`before`)
 * and that the draft dropped, each at the end of its section. → the draft, and how many were put back.
 * @param {string} dir @param {string} before @param {string} draft
 * @returns {{ text: string, kept: number }}
 */
export function keepFromMemory(dir, before, draft) {
  if (!existsSync(join(dir, FROM_MEMORY_FILE))) return { text: draft, kept: 0 };
  let text = draft;
  let kept = 0;
  for (const r of fromMemoryOf(dir)) {
    if (!holdsLines(before, r.lines) || holdsLines(text, r.lines)) continue;
    const got = withLines(text, r.section, r.lines);
    if (got.already) continue;
    text = got.text;
    kept++;
  }
  return { text, kept };
}
