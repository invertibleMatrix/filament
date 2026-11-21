// @ts-check
// HarnessV4_Skills_Plan step 2 — a skill's library: books split by chapter or heading into parts with their pages, a
// table of contents, a full-text index the skill tool's find ranks; a folder's text files one book; a scanned PDF, a
// book already there, a file of another kind refused in words; a book taken out with its parts and its copy.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGES_PER_PART, booksIn, bySize, createSkillLibrary, findInLibrary, firstWords, pageRanges, passageOf, pdfChapters, splitPdf, splitText } from "../src/app/skill-library.js";
import { PDFTOTEXT } from "../src/adapters/tools/pdf.js";
import { skillAnswer } from "../src/app/agent/skills.js";

/**
 * A PDF of the pages given, with a true cross-reference table: what pdftotext reads. A line written "# words" is a
 * heading, set large on a line of its own as a book sets one; pdftotext joins the other lines of a page into one.
 * @param {string[][]} pages  each page's lines
 */
function pdfOf(pages) {
  const esc = (/** @type {string} */ s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  /** @type {string[]} */
  const objs = [];
  const n = pages.length;
  const fontId = 3 + n * 2;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`;
  pages.forEach((lines, i) => {
    let y = 720;
    const stream = lines
      .map((l) => {
        const head = l.startsWith("# ");
        const op = `BT /F1 ${head ? 24 : 12} Tf 72 ${y} Td (${esc(head ? l.slice(2) : l)}) Tj ET`;
        y -= head ? 40 : 16;
        return op;
      })
      .join(" ");
    objs[3 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    objs[4 + i * 2] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  objs[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let out = "%PDF-1.4\n";
  /** @type {number[]} */
  const at = [];
  for (let i = 1; i < objs.length; i++) {
    at[i] = Buffer.byteLength(out);
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${at.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("splitting (pure)", () => {
  test("a PDF's chapters by the label heading a page: a running header starts none, a contents page is passed over", () => {
    const pages = [
      "Unity Sprites\nA book",
      "Contents\nChapter 1 Sprites .......... 3\nChapter 2 Atlases .......... 5\nChapter 3 Packing .......... 7",
      "Chapter 1\nSprites\nA sprite is a 2D image.",
      "Chapter 1 Sprites 4\nMore on sprites.",
      "CHAPTER 2: Atlases\nAn atlas packs sprites.",
      "Part 2 of the setup comes later.\nStill atlases.",
      "Appendix A\nTables",
    ];
    assert.deepEqual(pdfChapters(pages), [
      { at: 2, line: 0, title: "Chapter 1 — Sprites" },
      { at: 4, line: 0, title: "Chapter 2 — Atlases" },
      { at: 6, line: 0, title: "Appendix A — Tables" },
    ]);
    const s = splitPdf(pages);
    assert.equal(s.split, "chapters");
    assert.deepEqual(s.parts.map((p) => [p.title, p.pages]), [["Front matter", [1, 2]], ["Chapter 1 — Sprites", [3, 4]], ["Chapter 2 — Atlases", [5, 6]], ["Appendix A — Tables", [7, 7]]]);
    assert.match(s.parts[1].body, /^\[page 3\]\nChapter 1\nSprites\nA sprite is a 2D image\.\n\n\[page 4\]\nChapter 1 Sprites 4/);
    // No chapter headings: every PAGES_PER_PART pages.
    const plain = Array.from({ length: PAGES_PER_PART + 5 }, (_, i) => `page ${i + 1} text that is long enough`);
    assert.deepEqual(splitPdf(plain).parts.map((p) => [p.title, p.pages]), [[`Pages 1–${PAGES_PER_PART}`, [1, PAGES_PER_PART]], [`Pages ${PAGES_PER_PART + 1}–${PAGES_PER_PART + 5}`, [PAGES_PER_PART + 1, PAGES_PER_PART + 5]]]);
    assert.equal(splitPdf(plain).split, "pages");
  });

  // (fails before: yes — a real textbook of 643 pages, laid out again as pages, came out as "Front matter (1 of 9)" to
  // "(9 of 9)": its chapters are headed by their number alone and start mid-page)
  test("a PDF's chapters by their number alone, in order and with their first section; one mid-page split at its line; the index its own part", () => {
    const prose = "A long paragraph of prose that pdftotext joins into one line, as it does every paragraph of a book.";
    const pages = [
      "A Computational Book\nThe Author",
      `Preface\n${prose} Chapter 2 shows how images are read.\n1 Medicine is one use of it.`,
      `1 Introduction 1.1 Images and Pictures\n${prose}`,
      `${prose}\nExercises\n1. Find an image.`,
      `2. Find another.\n\n2 Images, Files and File Types\n2.1 Opening Images\n${prose}`,
      `${prose}\n3 Tables 4 and 5 hold the formats.\n4 Point Processing\n${prose}`,
      `4.1 Introduction\n${prose}`,
      `Appendix A Python\n${prose}`,
      `${prose}\nIndex\nimages, 3\npixels, 5`,
    ];
    assert.deepEqual(pdfChapters(pages), [
      { at: 2, line: 0, title: "Chapter 1 — Introduction" },
      { at: 4, line: 2, title: "Chapter 2 — Images, Files and File Types" },
      { at: 5, line: 2, title: "Chapter 4 — Point Processing" },
      { at: 7, line: 0, title: "Appendix A — Python" },
      { at: 8, line: 1, title: "Index" },
    ], "a numbered list and a sentence's number are no chapter; 3 is skipped where it has no 3.1, and 4 taken after it");
    const s = splitPdf(pages);
    assert.deepEqual(s.parts.map((p) => [p.title, p.pages]), [
      ["Front matter", [1, 2]],
      ["Chapter 1 — Introduction", [3, 5]],
      ["Chapter 2 — Images, Files and File Types", [5, 6]],
      ["Chapter 4 — Point Processing", [6, 7]],
      ["Appendix A — Python", [8, 9]],
      ["Index", [9, 9]],
    ]);
    assert.match(s.parts[1].body, /\[page 5\]\n2\. Find another\.$/, "the page a chapter starts on: the lines above it end the one before");
    assert.match(s.parts[2].body, /^\[page 5\]\n2 Images, Files and File Types\n2\.1 Opening Images/);
    assert.match(s.parts[5].body, /^\[page 9\]\nIndex\nimages, 3/);
    // Where two or more say "Chapter", their numbers alone are not looked for.
    assert.deepEqual(pdfChapters(["Chapter 1\nOne", "1 Introduction 1.1 Start", "Chapter 2\nTwo"]).map((c) => c.title), ["Chapter 1 — One", "Chapter 2 — Two"]);
  });

  test("a text's parts: # where it has two, else ##, else a line that is a chapter's label; a heading in a code fence is text", () => {
    const md = "Intro words.\n\n# Install\nRun it.\n```sh\n# not a heading\n```\n# Use\nCall it.\n";
    assert.deepEqual(splitText(md).parts.map((p) => p.title), ["Before the first heading", "Install", "Use"]);
    assert.match(splitText(md).parts[1].body, /# not a heading/);
    assert.deepEqual(splitText("# Guide\n## A\none\n## B\ntwo").parts.map((p) => p.title), ["Before the first heading", "A", "B"]);
    assert.deepEqual(splitText("CHAPTER I\nThe start.\n\nCHAPTER II\nThe end.").parts.map((p) => p.title), ["CHAPTER I", "CHAPTER II"]);
    assert.deepEqual(splitText("Only words.\nNo headings."), { split: "whole", parts: [{ title: "The whole text", pages: null, body: "Only words.\nNo headings." }] });
  });

  test("a part past its size is split at a paragraph, its pages followed; the summary, the ranges, the passage", () => {
    const body = Array.from({ length: 50 }, (_, i) => `[page ${i + 1}]\n${"word ".repeat(400)}`).join("\n\n");
    const pieces = bySize([{ title: "Chapter 1", pages: /** @type {[number, number]} */ ([1, 50]), body }]);
    assert.ok(pieces.length >= 2);
    assert.equal(pieces[0].title, `Chapter 1 (1 of ${pieces.length})`);
    assert.equal(pieces[0].pages?.[0], 1);
    assert.equal(pieces.at(-1)?.pages?.[1], 50);
    for (let k = 1; k < pieces.length; k++) assert.ok((pieces[k].pages?.[0] ?? 0) >= (pieces[k - 1].pages?.[1] ?? 0), "the pages follow on");
    assert.equal(firstWords("# Head\n[page 3]\none two three"), "one two three");
    assert.equal(pageRanges([7, 3, 8, 9, 1]), "1, 3, 7–9");
    assert.deepEqual(passageOf("# T\n\nFrom x\n\n[page 4]\nalpha\nThe atlas packer pages are 4096 px.\nomega", ["atlases", "packer"]), { line: 7, page: 4, text: "alpha\nThe atlas packer pages are 4096 px.\nomega" });
  });
});

describe("a skill's books", () => {
  /** @type {string} */
  let root;
  /** @type {string} */
  let skill;
  before(() => {
    root = mkdtempSync(join(tmpdir(), "filament-skill-library-"));
    skill = join(root, "skill");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "---\nname: unity-books\ndescription: Unity's manuals\n---\nLook it up.\n");
    writeFileSync(join(root, "atlas-guide.md"), "# Packing\nThe SpriteAtlas packer pages are 4096 px by default.\n\n# Loading\nLoad an atlas with Addressables.\n");
    writeFileSync(join(root, "notes.txt"), "Use the profiler to find texture memory.\n");
    mkdirSync(join(root, "docs", "deep"), { recursive: true });
    writeFileSync(join(root, "docs", "intro.md"), "Welcome to the docs about tilemaps.\n");
    writeFileSync(join(root, "docs", "deep", "rules.md"), "# Rule tiles\nA rule tile picks its sprite by its neighbours.\n\n# Animated tiles\nThey loop frames.\n");
    writeFileSync(join(root, "empty.md"), "   \n");
    writeFileSync(join(root, "photo.png"), "x");
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("added from paths: a file a book, a folder's text files one book; INDEX.md a line a part; refused in words; find ranks the parts", async () => {
    const lib = createSkillLibrary({ now: () => 1 });
    const r = await lib.add(skill, "unity-books", { paths: [join(root, "atlas-guide.md"), `"${join(root, "notes.txt")}"`, join(root, "docs"), join(root, "empty.md"), join(root, "nowhere")] });
    assert.deepEqual(r.added.map((b) => [b.name, b.kind, b.split, b.parts.length, b.files]), [["atlas-guide.md", "md", "headings", 2, 1], ["notes.txt", "txt", "whole", 1, 1], ["docs", "folder", "files", 3, 2]]);
    assert.deepEqual(r.skipped.map((s) => [s.name.replace(root, "<root>"), s.why]), [["<root>\\nowhere".replace(/\\/g, process.platform === "win32" ? "\\" : "/"), "not a file or folder on this computer"], ["empty.md", "it is empty"]]);
    const docs = r.added[2];
    assert.deepEqual(docs.parts.map((p) => p.title), ["deep/rules › Rule tiles", "deep/rules › Animated tiles", "intro"]);
    assert.ok(existsSync(join(skill, "sources", "docs", "deep", "rules.md")), "a folder's files kept under one folder of their own");
    assert.ok(existsSync(join(skill, "sources", "atlas-guide.md")));
    const part = readFileSync(join(skill, r.added[0].parts[0].file), "utf8");
    assert.equal(part, "# Packing\n\nFrom atlas-guide (sources/atlas-guide.md)\n\n# Packing\nThe SpriteAtlas packer pages are 4096 px by default.\n");
    const index = readFileSync(join(skill, "references", "INDEX.md"), "utf8");
    assert.match(index, /^# unity-books's library\n/);
    assert.match(index, /## atlas-guide\n\nsources\/atlas-guide\.md · split by headings\n\n- references\/atlas-guide\/01-packing\.md — Packing — The SpriteAtlas packer pages are 4096 px by default\.\n/);
    assert.match(index, /## docs\n\nsources\/docs · 2 files · split by its files, and a long one by its headings\n/);
    assert.equal(booksIn(skill).length, 3);

    // Refused: the same book again, a file of another kind.
    const again = await lib.add(skill, "unity-books", { paths: [join(root, "notes.txt"), join(root, "photo.png")] });
    assert.deepEqual(again.skipped.map((s) => s.why), ["it is in the books already: remove it first to add it again", "Filament reads PDF, Markdown and text files only"]);

    // Found by any of the words, the best first, the passage and the line to read from.
    const found = findInLibrary(skill, "atlas packer pages");
    assert.equal(found?.books, 3);
    assert.equal(found?.hits[0].file, "references/atlas-guide/01-packing.md");
    assert.deepEqual([found?.hits[0].line, found?.hits[0].book, found?.hits[0].title], [6, "atlas-guide", "Packing"]);
    assert.match(String(found?.hits[0].passage), /4096 px/);
    assert.equal(findInLibrary(skill, "rule tile neighbours")?.hits[0].title, "deep/rules › Rule tiles", "stemmed: neighbours, tile");
    assert.deepEqual(findInLibrary(skill, "zebra")?.hits, []);
    assert.equal(findInLibrary(root, "atlas"), null, "a folder with no books carries no library");
    // The index is the library's own: gone, a find builds it again from the parts.
    rmSync(join(skill, ".library", "index.sqlite"), { force: true });
    assert.equal(findInLibrary(skill, "profiler texture")?.hits[0].book, "notes");

    // The skill tool: load names the library; find ranks its parts above the lines of its other files.
    const s = { name: "unity-books", description: "Unity's manuals", triggers: [], path: join(skill, "SKILL.md"), folder: skill, body: "Look it up.", chars: 11, plugin: "", kind: /** @type {const} */ ("skill") };
    assert.match(skillAnswer([s], { name: "unity-books" }).text, /Its library: 3 books in 6 parts — references\/INDEX\.md lists them/);
    const answer = skillAnswer([s], { name: "unity-books", action: "find", words: "atlas packer" }).text;
    assert.match(answer, /^unity-books's library \(3 books, 6 parts\): the parts that best match your words, best first/);
    assert.match(answer, /- references\/atlas-guide\/01-packing\.md:6 — atlas-guide › Packing\n {2}/);
    assert.match(answer, /The lines of unity-books's other files that hold "atlas" and "packer"[^\n]*\nreferences\/INDEX\.md:/, "INDEX.md is no part: its lines are found as a file's");

    // Taken out: its parts and its copy go; INDEX.md and the index follow.
    const gone = await lib.remove(skill, "unity-books", "atlas-guide");
    assert.equal(gone.removed, "atlas-guide.md");
    assert.ok(!existsSync(join(skill, "references", "atlas-guide")) && !existsSync(join(skill, "sources", "atlas-guide.md")));
    assert.doesNotMatch(readFileSync(join(skill, "references", "INDEX.md"), "utf8"), /atlas-guide/);
    assert.ok(!findInLibrary(skill, "packer")?.hits.length);
    await assert.rejects(lib.remove(skill, "unity-books", "atlas-guide"), /unity-books's books hold none called atlas-guide/);
  });

  test("sent from the page: base64, one file a book; over the size or of another kind, refused", async () => {
    const dir = join(root, "sent");
    mkdirSync(dir);
    const lib = createSkillLibrary();
    const r = await lib.add(dir, "sent", { files: [{ name: "C:\\fake\\guide.md", data: Buffer.from("# A\none\n# B\ntwo").toString("base64") }, { name: "x.exe", data: "AA==" }, { name: "nodata.md" }] });
    assert.deepEqual(r.added.map((b) => [b.name, b.parts.length]), [["guide.md", 2]]);
    assert.deepEqual(r.skipped.map((s) => s.why), ["Filament reads PDF, Markdown and text files only", "it came with no name or no data"]);
    assert.deepEqual(readFileSync(join(dir, "sources", "guide.md"), "utf8"), "# A\none\n# B\ntwo");
    await assert.rejects(lib.add(dir, "sent", {}), /say the books/);
    // The last book gone, its empty folders go with it; one that holds the skill's own file stays.
    writeFileSync(join(dir, "references", "own.md"), "mine");
    await lib.remove(dir, "sent", "guide");
    assert.deepEqual([existsSync(join(dir, "sources")), existsSync(join(dir, "references", "INDEX.md")), readFileSync(join(dir, "references", "own.md"), "utf8")], [false, false, "mine"]);
  });

  test("a PDF read through pdftotext: split by its chapters, its pages named; a scanned one refused; no pdftotext, said", { skip: !PDFTOTEXT && "no pdftotext on this computer" }, async () => {
    const dir = join(root, "pdf");
    mkdirSync(dir);
    writeFileSync(join(root, "sprites.pdf"), pdfOf([["# Unity Sprites", "A short book"], ["# Chapter 1 Sprites", "A sprite is a 2D image drawn by the renderer."], ["# Chapter 2 Atlases", "The SpriteAtlas packer pages are 4096 px by default."], ["More about atlases and their padding settings."]]));
    writeFileSync(join(root, "scan.pdf"), pdfOf([[], [], []]));
    const lib = createSkillLibrary();
    const r = await lib.add(dir, "pdf", { paths: [join(root, "sprites.pdf"), join(root, "scan.pdf")] });
    assert.deepEqual(r.skipped, [{ name: "scan.pdf", why: "no text: a scanned PDF needs OCR, which Filament does not do" }]);
    const b = r.added[0];
    assert.deepEqual([b.kind, b.pages, b.split, b.noText], ["pdf", 4, "chapters", []]);
    assert.deepEqual(b.parts.map((p) => [p.title, p.pages]), [["Front matter", [1, 1]], ["Chapter 1 — Sprites", [2, 2]], ["Chapter 2 — Atlases", [3, 4]]]);
    const hit = findInLibrary(dir, "padding atlases")?.hits[0];
    assert.deepEqual([hit?.title, hit?.page], ["Chapter 2 — Atlases", 4]);
    const none = createSkillLibrary({ pdftotext: null });
    const n = await none.add(join(root, "skill"), "x", { paths: [join(root, "sprites.pdf")] });
    assert.match(n.skipped[0].why, /^Filament reads a PDF with pdftotext, and this computer has none/);
    assert.equal(none.readsPdf(), false);
  });
});
