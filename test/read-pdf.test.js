// @ts-check
// HarnessV3-Tools TL10 (TL-D26): read takes a PDF's text, page by page, through pdftotext — Git for Windows ships it
// beside the Git Bash the bash tool runs. pages picks them, at most 20 a call; without it, as many as the result's
// budget holds, and a note names the next range. (fails before: read refused every PDF)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32, posix } from "node:path";
import { runHand as runHandRaw, HAND_TOOLS } from "../src/adapters/tools/hands.js";
import { HandError } from "../src/adapters/tools/fs-fence.js";
import { PDFTOTEXT, resolvePdftotext, pageRange, PDF_PAGES_MAX } from "../src/adapters/tools/pdf.js";
import { makePdf } from "./helpers/pdf.js";
import { readFacts } from "../src/ui/harness/conversation/tools/render.js";
import { removeDirs } from "./helpers/wait.js";

/** hands.js is untyped JS: its options are real, the inferred signature just does not know them. @type {(name: string, input: any, o: any) => Promise<string>} */
const runHand = /** @type {any} */ (runHandRaw);
const root = mkdtempSync(join(tmpdir(), "filament-read-pdf-"));
test.after(() => removeDirs(root));
/** @param {string} name @param {string[]} pages @param {{ pad?: number }} [o] */
const pdf = (name, pages, o) => (writeFileSync(join(root, name), makePdf(pages, o)), name);
const numbered = (/** @type {number} */ n, /** @type {string} */ word = "Body") => Array.from({ length: n }, (_, i) => `${word} of page ${i + 1}`);

test("the PDF reader is found where Git keeps it, else on the PATH; none is null", () => {
  const files = (/** @type {string[]} */ list) => (/** @type {string} */ p) => list.includes(p);
  const env = { PATH: "C:\\Program Files\\Git\\cmd;C:\\Tools", ProgramFiles: "C:\\Program Files" };
  const git = ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files\\Git\\bin\\bash.exe"];
  assert.equal(resolvePdftotext({ platform: "win32", env, isFile: files([...git, "C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe", "C:\\Tools\\pdftotext.exe"]) }), win32.join("C:\\Program Files\\Git", "mingw64", "bin", "pdftotext.exe"), "Git's own first");
  assert.equal(resolvePdftotext({ platform: "win32", env, isFile: files([...git, "C:\\Tools\\pdftotext.exe"]) }), "C:\\Tools\\pdftotext.exe", "the PATH's without Git's");
  assert.equal(resolvePdftotext({ platform: "win32", env: { Path: "C:\\Tools" }, isFile: files(["C:\\Tools\\pdftotext.exe"]) }), "C:\\Tools\\pdftotext.exe", "Windows' Path in any case");
  assert.equal(resolvePdftotext({ platform: "linux", env: { PATH: "/usr/local/bin:/usr/bin" }, isFile: files(["/usr/bin/pdftotext"]) }), posix.join("/usr/bin", "pdftotext"));
  assert.equal(resolvePdftotext({ platform: "linux", env: { PATH: "/usr/bin" }, isFile: files([]) }), null);
  assert.equal(resolvePdftotext({ platform: "win32", env, isFile: files(git) }), null);
});

test("pages is a page or a range; anything else is refused in words", () => {
  assert.equal(pageRange(undefined), null);
  assert.equal(pageRange(""), null);
  assert.deepEqual(pageRange("3"), { from: 3, to: 3 });
  assert.deepEqual(pageRange(" 3 - 7 "), { from: 3, to: 7 });
  assert.deepEqual(pageRange(4), { from: 4, to: 4 });
  for (const bad of ["0", "7-3", "3-", "a", "1,2", "-2"])
    assert.throws(() => pageRange(bad), (e) => e instanceof HandError && /pages is a page or a range of them, like "3" or "3-7"/.test(e.message), bad);
});

test("the read tool says a PDF comes as its text, page by page, and takes pages", () => {
  const read = /** @type {any} */ (HAND_TOOLS.find((t) => t.name === "read"));
  assert.match(read.description, /A PDF comes as its text, page by page, without its pictures; pages picks them, at most 20 a call\./);
  assert.equal(read.input_schema.properties.pages.type, "string");
});

describe("a PDF read through the real pdftotext", { skip: !PDFTOTEXT && "needs pdftotext" }, () => {
  test("each page under its own line, a page without text said so, no line numbers, no note when all is shown", async () => {
    pdf("three.pdf", ["Hello page one", "", "Third (page) here"]);
    assert.equal(
      await runHand("read", { path: "three.pdf" }, { root }),
      "--- page 1 ---\nHello page one\n\n--- page 2 (no text: a scan or a picture, which read can't see) ---\n\n--- page 3 ---\nThird (page) here",
    );
  });

  test("pages picks one page or a range; a range past the end stops at the last; a first page past it is said", async () => {
    pdf("five.pdf", numbered(5));
    assert.equal(await runHand("read", { path: "five.pdf", pages: "4" }, { root }), "--- page 4 ---\nBody of page 4\n\n[Showing pages 4-4 of 5. Use pages: \"5-5\" to continue.]");
    assert.equal(await runHand("read", { path: "five.pdf", pages: "4-9" }, { root }), "--- page 4 ---\nBody of page 4\n\n--- page 5 ---\nBody of page 5");
    assert.equal(await runHand("read", { path: "five.pdf", pages: "6" }, { root }), "[five.pdf has 5 pages; page 6 is past its end.]");
    await assert.rejects(() => runHand("read", { path: "five.pdf", pages: "x" }, { root }), /pages is a page or a range/);
  });

  test("at most 20 pages a call; the note names the next range", async () => {
    pdf("long.pdf", numbered(45));
    const all = await runHand("read", { path: "long.pdf" }, { root });
    assert.equal((all.match(/^--- page \d+ ---$/gm) || []).length, PDF_PAGES_MAX);
    assert.match(all, /--- page 20 ---\nBody of page 20\n\n\[Showing pages 1-20 of 45\. Use pages: "21-40" to continue\.\]$/);
    const tail = await runHand("read", { path: "long.pdf", pages: "30-60" }, { root });
    assert.match(tail, /^--- page 30 ---/);
    assert.match(tail, /--- page 45 ---\nBody of page 45$/, "the rest, when it is under 20 pages");
  });

  test("the result's budget holds whole pages; a page past the whole budget shows its head and the way to the rest", async () => {
    // The smallest budget is 512 bytes: two of these ~215-byte pages fit it, a third does not.
    const lines = (/** @type {number} */ page, /** @type {number} */ n) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of page ${page}, with words to give it some width`).join("\n");
    pdf("dense.pdf", [lines(1, 4), lines(2, 4), lines(3, 12), lines(4, 4)]);
    const two = await runHand("read", { path: "dense.pdf" }, { root, maxBytes: 1024 });
    assert.match(two, /^--- page 1 ---\nLine 1 of page 1,[^]*Line 4 of page 1, with words to give it some width\n\n--- page 2 ---\nLine 1 of page 2,[^]*Line 4 of page 2, with words to give it some width\n\n\[Showing pages 1-2 of 4\. Use pages: "3-4" to continue\.\]$/);
    const head = await runHand("read", { path: "dense.pdf", pages: "3" }, { root, maxBytes: 1024 });
    assert.match(head, /^--- page 3 ---\nLine 1 of page 3,/);
    const m = /\n\[Page 3 of 4 is (\d+) bytes of text; its first (\d+) are shown\. For the rest, take that page with bash: pdftotext -f 3 -l 3 "dense\.pdf" - and search it\. Use pages: "4-4" to continue\.\]$/.exec(head);
    assert.ok(m, head);
    assert.ok(Number(m[1]) > 512 && Number(m[2]) <= 512, "the head is the budget's, the page more");
  });

  test("the session's redaction runs over the text; a read is a sighting for the write guard", async () => {
    pdf("keys.pdf", ["token sk-live-123456", "nothing"]);
    const seen = new Map();
    const out = await runHand("read", { path: "keys.pdf" }, { root, seen, redact: (/** @type {string} */ t) => t.replace(/sk-live-\d+/g, "[redacted]") });
    assert.match(out, /--- page 1 ---\ntoken \[redacted\]\n/);
    assert.equal(seen.size, 1);
    assert.match(await runHand("write", { path: "keys.pdf", content: "x" }, { root, seen }), /Successfully wrote/, "the guard lets the agent replace what it read");
  });

  test("a PDF past the 10 MB text cap is read all the same: its bytes never load", async () => {
    pdf("big.pdf", ["Small text in a big file"], { pad: 11 * 1024 * 1024 });
    assert.ok(statSync(join(root, "big.pdf")).size > 10 * 1024 * 1024);
    assert.equal(await runHand("read", { path: "big.pdf" }, { root }), "--- page 1 ---\nSmall text in a big file");
  });

  test("paging through a PDF extracts it once per version: a changed file is extracted again", async () => {
    pdf("cached.pdf", ["first version"]);
    assert.match(await runHand("read", { path: "cached.pdf" }, { root }), /first version/);
    const gone = join(root, "no-such-pdftotext.exe");
    assert.match(await runHand("read", { path: "cached.pdf" }, { root, pdftotext: gone }), /first version/, "the second read did not run the tool");
    pdf("cached.pdf", ["second, longer version"]);
    await assert.rejects(() => runHand("read", { path: "cached.pdf" }, { root, pdftotext: gone }), /cached\.pdf: pdftotext could not read this PDF/);
  });

  test("the read card names the pages a PDF read showed, as far as its preview proves them", async () => {
    pdf("card.pdf", numbered(25));
    const first = await runHand("read", { path: "card.pdf" }, { root });
    assert.equal(readFacts({ preview: first, chars: first.length }), `PDF, pages 1–20 of 25 · ${first.length.toLocaleString()} chars`);
    const rest = await runHand("read", { path: "card.pdf", pages: "21-30" }, { root });
    assert.equal(readFacts({ preview: rest, chars: rest.length }), `PDF, pages 21–25 · ${rest.length} chars`, "the whole result, its last page the PDF's");
    const one = await runHand("read", { path: "card.pdf", pages: "25" }, { root });
    assert.equal(readFacts({ preview: one, chars: one.length }), `PDF, page 25 · ${one.length} chars`);
    assert.equal(readFacts({ preview: first.slice(0, 60), chars: first.length }), `PDF, from page 1 · ${first.length.toLocaleString()} chars`, "a cut preview proves only the start");
    pdf("scan.pdf", ["", "x"]);
    const scan = await runHand("read", { path: "scan.pdf" }, { root });
    assert.match(readFacts({ preview: scan, chars: scan.length }), /^PDF, pages 1–2 · /);
    assert.equal(readFacts({ preview: "     1\t--- page 1 ---" }), "1 line", "a text file that looks like one is still text");
  });

  test("a damaged or locked PDF is refused with pdftotext's verdict, its last line, without the label", async () => {
    writeFileSync(join(root, "broken.pdf"), "%PDF-1.7\nplain enough to pass as text\n");
    await assert.rejects(() => runHand("read", { path: "broken.pdf" }, { root }), (e) => e instanceof HandError && /^broken\.pdf: pdftotext could not read this PDF — Couldn't read xref table$/.test(e.message));
    // An encryption dictionary pdftotext can't open: its stderr starts with a Syntax Error and ends with the verdict.
    const locked = makePdf(["secret"]).toString("latin1").replace("/Root 1 0 R", "/Root 1 0 R /Encrypt << /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -1 >>");
    writeFileSync(join(root, "locked.pdf"), Buffer.from(locked, "latin1"));
    await assert.rejects(() => runHand("read", { path: "locked.pdf" }, { root }), (e) => e instanceof HandError && /^locked\.pdf: pdftotext could not read this PDF — Incorrect password$/.test(e.message));
  });

  test("a PDF of no pages says so", async () => {
    pdf("empty.pdf", []);
    assert.equal(await runHand("read", { path: "empty.pdf" }, { root }), "[empty.pdf is a PDF with no pages.]");
  });
});

test("without pdftotext a PDF is refused in words that say where it comes from", async () => {
  pdf("nopdf.pdf", ["anything"]);
  await assert.rejects(
    () => runHand("read", { path: "nopdf.pdf" }, { root, pdftotext: null }),
    (e) => e instanceof HandError && /^nopdf\.pdf is a PDF, and read takes a PDF's text with pdftotext, which this machine doesn't have \(Git for Windows ships it; elsewhere it comes with poppler\)\./.test(e.message),
  );
});
