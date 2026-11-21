// @ts-check
// read and edit on big files, as they read and change small ones. A read of one page took the whole file apart — every
// line split, a copy of it as latin1 and another with its CRLFs replaced for the sighting's sum — and looked at the file
// with blocking calls; an edit walked from the file's start for both ends of each match, and copied the whole text for
// each, so a replaceAll in a CRLF file of thousands of lines held every agent and request for seconds.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand as runHandRaw, lineNumber, resolveInside } from "../src/adapters/tools/hands.js";
import { headBytes } from "../src/core/text.js";
import { removeDirs } from "./helpers/wait.js";

/** hands.js is untyped JS: its options are real, the inferred signature just does not know them. @type {(name: string, input: any, o: any) => Promise<string>} */
const runHand = /** @type {any} */ (runHandRaw);
const root = mkdtempSync(join(tmpdir(), "filament-read-edit-scale-"));
test.after(() => removeDirs(root));
/** @param {string} name @param {string | Buffer} body */
const put = (name, body) => (writeFileSync(join(root, name), body), name);
const content = (/** @type {string} */ name) => readFileSync(join(root, name), "utf8");

/**
 * What a read showed when it split the whole (redacted) text into lines — the code as it was, kept here as the measure
 * of the window read now takes: the same lines, numbers, notices and count.
 * @param {string} path @param {string} text @param {{ offset?: number, limit?: number }} input @param {number} budget
 */
const asSplitShowed = (path, text, input, budget) => {
  if (!text) return `[${path} is empty.]`;
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  const from = Math.max(1, Math.floor(Number(input.offset) || 1));
  if (from > lines.length) return `[${path} has ${lines.length} line${lines.length === 1 ? "" : "s"}; offset ${from} is past its end.]`;
  const limit = Math.min(Math.floor(Number(input.limit) || 2000) || 2000, 2000);
  const asked = lines.slice(from - 1, from - 1 + limit).map((l, i) => lineNumber(from + i) + l);
  const tooWide = asked.findIndex((l) => Buffer.byteLength(l) > budget);
  if (tooWide === 0) {
    const line = lines[from - 1];
    const head = headBytes(line, budget - lineNumber(from).length);
    return `${lineNumber(from)}${head}\n[Line ${from} of ${lines.length} is ${Buffer.byteLength(line).toLocaleString()} bytes; its first ${Buffer.byteLength(head).toLocaleString()} are shown. Search inside it with grep${from < lines.length ? `, or use offset=${from + 1} to continue after it` : ""}.]`;
  }
  const head = tooWide > 0 ? asked.slice(0, tooWide) : asked;
  let bytes = 0;
  let fit = 0;
  for (const l of head) {
    bytes += Buffer.byteLength(l) + 1;
    if (bytes > budget && fit > 0) break;
    fit++;
  }
  const slice = asked.slice(0, fit);
  const last = from + slice.length - 1;
  return slice.join("\n") + (last < lines.length ? `\n[Showing lines ${from}-${last} of ${lines.length}. Use offset=${last + 1} to continue.]` : "");
};

// (fails before: no — the same pages; it pins them: the window is taken without splitting the rest)
test("a read shows the page splitting the whole file showed: LF, CRLF, a trailing newline or none, a line too wide, a redaction across lines", async () => {
  const many = Array.from({ length: 5000 }, (_, i) => `line ${i + 1} ${"w".repeat(i % 37)}`);
  /** @type {[string, string][]} */
  const files = [
    ["lf.txt", `${many.join("\n")}\n`],
    ["lf-open.txt", many.join("\n")],
    ["crlf.txt", `${many.join("\r\n")}\r\n`],
    ["crlf-open.txt", many.join("\r\n")],
    ["mixed.txt", "a\r\nb\nc\r\r\nd\n\n\ne\r"],
    ["one.txt", "only"],
    ["nl.txt", "\n"],
    ["nls.txt", "\n\n\n"],
    ["wide.txt", `short\n${"m".repeat(9000)}\nafter\n${"n".repeat(9000)}`],
    ["secret.txt", "key: sk-abcdABCDEFGHIJKLMNOP\nline two holds MULTI\nLINE secret\nend\n"],
  ];
  const redact = (/** @type {string} */ t) => t.replace(/sk-[A-Za-z0-9]{8,}/g, "[redacted]").replace(/MULTI\nLINE/g, "[gone]");
  for (const [name, body] of files) {
    put(name, body);
    const count = body.split("\n").length;
    for (const offset of [undefined, 2, 2001, 5000, count - 1, count, count + 1])
      for (const limit of [undefined, 1, 3000])
        for (const maxBytes of [undefined, 2048])
          for (const r of [null, redact]) {
            const input = { path: name, offset, limit };
            const budget = Math.max(1024, Math.min(50 * 1024, Math.floor(Number(maxBytes)) || 50 * 1024)) - 512;
            const want = asSplitShowed(name, r ? r(body) : body, input, budget);
            assert.equal(await runHand("read", input, { root, maxBytes, redact: r }), want, `${name} ${JSON.stringify({ offset, limit, maxBytes, redacted: !!r })}`);
          }
  }
});

/** The sum as a sighting kept it: the bytes as latin1, their CRLFs replaced, hashed. @param {Buffer} bytes */
const sumAsWas = (bytes) => createHash("sha1").update(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1").digest("hex");

// (fails before: no — the same digest; it pins it: the bytes are hashed as they are, without the two copies)
test("a read's sighting keeps the sum it kept: the bytes with each CR before an LF left out, whatever else they hold", async () => {
  /** @type {Buffer[]} */
  const bodies = [
    Buffer.from("plain\nlines\n"),
    Buffer.from("crlf\r\nlines\r\n"),
    Buffer.from("\r\r\n\r\n\n\r"),
    Buffer.from("lone\rcr and \r\n pair and end\r"),
    Buffer.from("é ü € 日本\r\n"),
    Buffer.from([0xe9, 0x0d, 0x0a, 0xff, 0x0d, 0x0d, 0x0a, 0x80]),
    Buffer.alloc(0),
  ];
  for (const [i, bytes] of bodies.entries()) {
    const seen = new Map();
    const name = put(`sum${i}.txt`, bytes);
    await runHand("read", { path: name }, { root, seen }).catch(() => {});
    if (!seen.size) continue; // not text (a byte that is no UTF-8 reads as text still; a NUL would not)
    assert.equal([...seen.values()][0].sum, sumAsWas(bytes), JSON.stringify(bytes.toString("latin1")));
  }
  // A file written through a checkout again, CRLF for LF, is the same file to the guard.
  const seen = new Map();
  put("guard.txt", "one\ntwo\n");
  await runHand("read", { path: "guard.txt" }, { root, seen });
  put("guard.txt", "one\r\ntwo\r\n");
  await runHand("write", { path: "guard.txt", content: "three\n" }, { root, seen });
  assert.equal(content("guard.txt"), "three\n");
});

/**
 * How many times each of `names` of node:fs is called while `fn` runs.
 * @param {string[]} names @param {() => Promise<unknown>} fn
 */
const countingSync = async (names, fn) => {
  /** @type {Record<string, number>} */
  const calls = Object.fromEntries(names.map((n) => [n, 0]));
  const real = names.map((n) => /** @type {any} */ (fs)[n]);
  names.forEach((n, i) => {
    /** @type {any} */ (fs)[n] = (/** @type {any[]} */ ...a) => (calls[n]++, real[i](...a));
  });
  syncBuiltinESMExports();
  try {
    await fn();
  } finally {
    names.forEach((n, i) => {
      /** @type {any} */ (fs)[n] = real[i];
    });
    syncBuiltinESMExports();
  }
  return calls;
};

// (fails before: yes — a read looked at its file with blocking calls: whether it is there, a file, a PDF, how big, and
// the sighting's look after: five to seven while every other agent and request waited)
test("a read looks at its file without blocking: no blocking call past the fence's own", async () => {
  put("look.txt", "a\r\nb\r\n");
  const seen = new Map();
  const fence = await countingSync(["existsSync", "realpathSync"], async () => resolveInside(root, "look.txt"));
  const calls = await countingSync(["existsSync", "realpathSync", "statSync", "lstatSync", "openSync", "readSync", "closeSync", "readFileSync"], () =>
    runHand("read", { path: "look.txt" }, { root, seen }),
  );
  assert.deepEqual(calls, { ...fence, statSync: 0, lstatSync: 0, openSync: 0, readSync: 0, closeSync: 0, readFileSync: 0 });
  assert.equal([...seen.values()][0].size, 6, "the sighting has the file's size and time, as before");
  assert.equal(await runHand("read", { path: "nowhere.txt" }, { root }).catch((e) => e.message), "no such file: nowhere.txt");
  fs.mkdirSync(join(root, "a-folder"), { recursive: true });
  assert.equal(await runHand("read", { path: "a-folder" }, { root }).catch((e) => e.message), "no such file: a-folder");
});

// (fails before: yes — 17 s for the CRLF file here, 2 s for the LF one: each match walked the text from its start, and
// each splice copied all of it) The result is the one the per-match splices made, byte for byte.
test("replaceAll of thousands of matches in a CRLF file is one pass, and changes only the matches", async () => {
  const lines = Array.from({ length: 20000 }, (_, i) => `line ${i} MARK here`);
  for (const [name, eol] of [["many-crlf.txt", "\r\n"], ["many-lf.txt", "\n"]]) {
    put(name, `${lines.join(eol)}${eol}`);
    const t = performance.now();
    await runHand("edit", { path: name, edits: [{ oldText: "MARK", newText: "DONE", replaceAll: true }] }, { root });
    const ms = performance.now() - t;
    assert.equal(content(name), `${lines.join(eol)}${eol}`.replaceAll("MARK", "DONE"), name);
    assert.ok(ms < 1500, `${name}: ${Math.round(ms)} ms for 20,000 matches`);
  }
});

// (fails before: no — the same bytes; it pins them on the cases a CRLF walk can get wrong)
test("an edit's matches land on the file's own characters in CRLF, LF and mixed files, across line ends and lone CRs", async () => {
  /** @type {[string, string, { oldText: string, newText: string, replaceAll?: boolean }[], string][]} */
  const cases = [
    ["crlf: a match across a line end takes the pair; the new lines end in CRLF", "a\r\nb\r\nc\r\n", [{ oldText: "a\nb", newText: "x\ny" }], "x\r\ny\r\nc\r\n"],
    ["crlf: two edits, the later first in the file", "one\r\ntwo\r\nthree\r\n", [{ oldText: "three", newText: "3" }, { oldText: "one\ntwo", newText: "1\n2" }], "1\r\n2\r\n3\r\n"],
    ["crlf: a match ending right before a pair keeps it", "ab\r\ncd\r\n", [{ oldText: "b", newText: "B" }, { oldText: "\ncd", newText: "\nCD" }], "aB\r\nCD\r\n"],
    ["mixed: left as it is", "a\r\nb\nc\r\nd\n", [{ oldText: "a\nb\nc", newText: "x\ny" }], "x\ny\r\nd\n"],
    ["mixed: replaceAll across both ends", "k\r\nk\nk\r\n", [{ oldText: "k\n", newText: "K\n", replaceAll: true }], "K\nK\nK\n"],
    ["a lone CR before a pair", "a\r\r\nb\r\nc", [{ oldText: "\r\nb", newText: "B" }], "aB\r\nc"],
    ["a lone CR is a character", "x\ry\r\nz\r\n", [{ oldText: "y\nz", newText: "Y\nZ" }], "x\rY\r\nZ\r\n"],
    ["lf", "p\nq\nr\n", [{ oldText: "q", newText: "Q" }, { oldText: "r\n", newText: "R\n" }], "p\nQ\nR\n"],
    ["a BOM stays", "﻿a\r\nb\r\n", [{ oldText: "b", newText: "c" }], "﻿a\r\nc\r\n"],
    ["the last characters", "end\r\nhere", [{ oldText: "here", newText: "there" }], "end\r\nthere"],
    ["fuzzy in crlf: trailing blanks", "row FZ  \r\nrow FZ \r\nkeep\r\n", [{ oldText: "FZ\n", newText: "OK\n", replaceAll: true }], "row OK\r\nrow OK\r\nkeep\r\n"],
    ["fuzzy twice on one line", "q ’a’ ’a’ \r\nz\r\n", [{ oldText: "'a'", newText: "b", replaceAll: true }], "q b b \r\nz\r\n"],
  ];
  for (const [what, body, edits, want] of cases) {
    put("case.txt", body);
    await runHand("edit", { path: "case.txt", edits }, { root });
    assert.equal(content("case.txt"), want, what);
  }
});

// (fails before: yes — 1.6 s for 40,000 hits: each hit found its line by walking the lines from the first)
test("a fuzzy replaceAll of tens of thousands of hits finds each hit's line by halves", async () => {
  const n = 40000;
  put("fuzzy.txt", Array.from({ length: n }, (_, i) => `row ${i} FZ  \r\n`).join(""));
  const t = performance.now();
  await runHand("edit", { path: "fuzzy.txt", edits: [{ oldText: "FZ\n", newText: "OK\n", replaceAll: true }] }, { root });
  const ms = performance.now() - t;
  assert.equal(content("fuzzy.txt"), Array.from({ length: n }, (_, i) => `row ${i} OK\r\n`).join(""));
  assert.ok(ms < 800, `${Math.round(ms)} ms for ${n} hits`);
});
