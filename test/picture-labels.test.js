// @ts-check
// The four picture types in words, said in one place (core/media.js IMAGE_LABELS): `read`'s line naming a picture, the
// words a left-out picture leaves, and a kept picture's entry (services/run-images.js), which a call's card shows as it
// comes — the page holds no table of its own (it imports nothing from the server's folders: ratchets.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunImages } from "../src/services/run-images.js";
import { readFacts } from "../src/ui/harness/conversation/tools/render.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** @param {string} at @returns {string[]} */
const walk = (at) => readdirSync(at, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(at, e.name)) : [join(at, e.name)]));

// (fails before: yes — adapters/tools/hands.js and the card's render.js each kept their own table of the four)
test("the four picture types are said in words in one file of src, core/media.js; the card's pattern names none of them", () => {
  const sayers = walk(join(ROOT, "src"))
    .filter((f) => f.endsWith(".js") && /["']image\/png["']\s*:\s*["']PNG["']/.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f).split("\\").join("/"));
  assert.deepEqual(sayers, ["src/core/media.js"]);
  assert.doesNotMatch(readFileSync(join(ROOT, "src/ui/harness/conversation/tools/render.js"), "utf8"), /PNG\|JPEG\|GIF\|WebP/);
});

// (fails before: yes — a kept picture's entry named its type by its MIME type alone, and the card said it from a table
// of its own)
test("a kept picture's entry carries its type in words, and the card says the type as the entry does", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-picture-labels-"));
  try {
    const store = createRunImages({ dir, knobs: () => ({ persist: true, retentionDays: 7, imagesMaxMB: 500 }) });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]), Buffer.alloc(2000, 7)]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
    const { images } = store.keep([{ data: png.toString("base64") }, { data: jpeg.toString("base64") }]);
    assert.deepEqual(images.map((i) => [i.type, i.label]), [["image/png", "PNG"], ["image/jpeg", "JPEG"]]);
    assert.equal(readFacts({ images: [images[0]] }), "PNG image, 2 KB");
    assert.equal(readFacts({ images: [{ ...images[0], label: "Portable Network Graphics" }] }), "Portable Network Graphics image, 2 KB", "the entry's word, whatever it is");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
