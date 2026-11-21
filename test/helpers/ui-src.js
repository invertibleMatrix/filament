// Concatenate every dashboard module. The five text-reading pins used to open app.js alone;
// after the page split they must see the same strings wherever they live.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "ui");

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.js$/.test(e.name)) out.push(p);
  }
  return out;
};

export function uiSrc() {
  return walk(UI)
    .sort()
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
}
