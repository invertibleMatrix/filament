// @ts-check
// A SKILL.md's `## ` sections, and lines added at the end of one (HarnessV4_Skills_Plan step 4): what Add to a skill…
// writes a memory's words with, and what the crafter puts lines added from memory back with when it writes a skill
// again from its books (the owner's word of 10-27: they are kept). The page's Add has the same reading
// (ui/harness/library/skill-add.js); the layers keep the page and the server apart, so each has its own.

/**
 * A SKILL.md's `## ` headings, past its front matter and outside its code fences, each with its line.
 * @param {string[]} lines @returns {{ title: string, at: number }[]}
 */
function headings(lines) {
  /** @type {{ title: string, at: number }[]} */
  const out = [];
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++;
  }
  let fence = false;
  for (; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    else if (!fence) {
      const m = /^##\s+(.+?)\s*#*\s*$/.exec(lines[i]);
      if (m) out.push({ title: m[1], at: i });
    }
  }
  return out;
}

/**
 * A SKILL.md with lines added at the end of the section titled `title`, one missing made at the end of the file; its
 * line ends kept. → the new text, and whether the section says those lines already (then the text is as it was).
 * @param {string} text @param {string} title @param {string[]} add
 * @returns {{ text: string, already: boolean }}
 */
export function withLines(text, title, add) {
  const src = String(text || "");
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  const heads = headings(lines);
  const i = heads.findIndex((x) => x.title.toLowerCase() === title.toLowerCase());
  if (i < 0) {
    let end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) end--;
    return { text: [...lines.slice(0, end), "", `## ${title}`, "", ...add].join(eol) + eol, already: false };
  }
  const start = heads[i].at;
  let end = heads[i + 1]?.at ?? lines.length;
  while (end > start + 1 && !lines[end - 1].trim()) end--;
  const said = new Set(lines.slice(start + 1, end).map((l) => l.trim()));
  if (add.every((l) => said.has(l.trim()))) return { text: src, already: true };
  const gap = end === start + 1 || add[0].startsWith("### ") ? [""] : [];
  return { text: [...lines.slice(0, end), ...gap, ...add, ...lines.slice(end)].join(eol), already: false };
}

/** Whether a text holds every one of these lines, each as a line of its own. @param {string} text @param {readonly string[]} lines */
export const holdsLines = (text, lines) => {
  const has = new Set(String(text || "").split(/\r?\n/).map((l) => l.trim()));
  return lines.length > 0 && lines.every((l) => has.has(String(l).trim()));
};
