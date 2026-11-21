// @ts-check
// HarnessV3-Tools TL2 (TL-D6): read numbers its lines as cat -n does — the form models are trained on, and what lets
// the agent name a line — and says so when a file is empty or an offset is past its end; edit forgives a copied line
// prefix, and replaces every occurrence when asked to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand as runHandRaw, HAND_TOOLS } from "../src/adapters/tools/hands.js";
import { removeDirs } from "./helpers/wait.js";

/** hands.js is untyped JS: its options are real, the inferred signature just does not know them. @type {(name: string, input: any, o: any) => Promise<string>} */
const runHand = /** @type {any} */ (runHandRaw);
const root = mkdtempSync(join(tmpdir(), "filament-read-edit-"));
test.after(() => removeDirs(root));
/** @param {string} name @param {string} text */
const put = (name, text) => (writeFileSync(join(root, name), text), name);
const read = (/** @type {any} */ input, /** @type {any} */ o = {}) => runHand("read", input, { root, ...o });
const edit = (/** @type {string} */ path, /** @type {any[]} */ edits) => runHand("edit", { path, edits }, { root });
const content = (/** @type {string} */ name) => readFileSync(join(root, name), "utf8");
const description = (/** @type {string} */ name) => String(HAND_TOOLS.find((t) => t.name === name)?.description);

test("read numbers each line as cat -n does: the number right-aligned in six, a tab, the line", async () => {
  put("abc.txt", "alpha\nbeta\n\ngamma\n");
  assert.equal(await read({ path: "abc.txt" }), "     1\talpha\n     2\tbeta\n     3\t\n     4\tgamma");
  const part = await read({ path: put("ten.txt", Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join("\n")), offset: 9, limit: 2 });
  assert.equal(part, "     9\tl9\n    10\tl10\n[Showing lines 9-10 of 12. Use offset=11 to continue.]", "an offset numbers from where it starts");
  assert.match(description("read"), /numbered/i);
  assert.match(description("read"), /not part of the file/);
});

test("read says when a file is empty, and when the offset is past its end", async () => {
  assert.equal(await read({ path: put("empty.txt", "") }), "[empty.txt is empty.]");
  assert.equal(await read({ path: "abc.txt", offset: 9 }), "[abc.txt has 4 lines; offset 9 is past its end.]");
});

test("the numbers count inside the result budget: a budgeted read stays within it and continues where it stopped", async () => {
  const lines = Array.from({ length: 400 }, (_, i) => `row ${String(i + 1).padStart(3, "0")} ${"x".repeat(40)}`);
  put("long.txt", lines.join("\n"));
  const budget = 4096;
  const first = await read({ path: "long.txt" }, { maxBytes: budget });
  assert.ok(Buffer.byteLength(first) <= budget, `${Buffer.byteLength(first)} bytes`);
  const shown = Number(/Showing lines 1-(\d+) of 400/.exec(first)?.[1]);
  assert.ok(shown > 10, first.slice(-120));
  const next = await read({ path: "long.txt", offset: shown + 1 }, { maxBytes: budget });
  assert.ok(next.startsWith(`${String(shown + 1).padStart(6)}\t${lines[shown]}\n`));
});

test("a line too wide for the budget shows its numbered head", async () => {
  put("min.js", `${"m".repeat(9000)}\nnext line`);
  const head = await read({ path: "min.js" }, { maxBytes: 2048 });
  assert.match(head, /^ {5}1\tmmm/);
  assert.equal(Buffer.byteLength(head.split("\n")[0]), 2048 - 512, "the number and the head fill the content budget (the 512 bytes the notice keeps aside), no more");
  assert.match(head, /\[Line 1 of 2 is 9,000 bytes/);
  assert.equal(await read({ path: "min.js", offset: 2 }, { maxBytes: 2048 }), "     2\tnext line");
});

// (fails before: the prefix copied from read's output was not in the file, exact or fuzzy)
test("edit forgives read's line prefix copied into oldText — and into newText when every line of both carries it", async () => {
  put("p.js", "const a = 1;\nconst b = 2;\nconst c = 3;\n");
  assert.match(await edit("p.js", [{ oldText: "     2\tconst b = 2;\n     3\tconst c = 3;", newText: "     2\tconst b = 20;\n     3\tconst c = 30;" }]), /Successfully replaced 1 block in p\.js/);
  assert.equal(content("p.js"), "const a = 1;\nconst b = 20;\nconst c = 30;\n");
  await edit("p.js", [{ oldText: "     1\tconst a = 1;", newText: "const a = 10;" }]);
  assert.equal(content("p.js"), "const a = 10;\nconst b = 20;\nconst c = 30;\n", "a newText without the prefix is taken as it is");
  await edit("p.js", [{ oldText: "     3→const c = 30;", newText: "const c = 300;" }]);
  assert.equal(content("p.js"), "const a = 10;\nconst b = 20;\nconst c = 300;\n", "the arrow form other harnesses print is the same prefix");
  assert.match(description("edit"), /without the line-number prefix/);
});

test("a prefix-shaped text that is in the file as sent is the file's own (tab-separated data), never stripped", async () => {
  put("data.tsv", "id\tname\n     1\tada\n     2\tbob\n");
  await edit("data.tsv", [{ oldText: "     2\tbob", newText: "     2\tbea" }]);
  assert.equal(content("data.tsv"), "id\tname\n     1\tada\n     2\tbea\n");
  await edit("data.tsv", [{ oldText: "     1\tada", newText: "gone" }]);
  assert.equal(content("data.tsv"), "id\tname\ngone\n     2\tbea\n", "the whole line as sent, number and all");
});

// (fails before: a text in the file more than once was refused, every time)
test("replaceAll replaces every occurrence; a later edit in the same call is matched against the original", async () => {
  put("r.txt", "foo bar\nfoo baz\r\nqux foo\n");
  assert.match(await edit("r.txt", [{ oldText: "foo", newText: "FOO", replaceAll: true }, { oldText: "qux", newText: "QUX" }]), /Successfully replaced 4 blocks in r\.txt/);
  assert.equal(content("r.txt"), "FOO bar\nFOO baz\r\nQUX FOO\n", "the line endings stay as they were");
  put("s.txt", "a-1 a-2 a-3");
  await edit("s.txt", [{ old_string: "a-", new_string: "b_", replace_all: true }]);
  assert.equal(content("s.txt"), "b_1 b_2 b_3", "Claude Code's spelling of the same edit is understood");
  await assert.rejects(() => edit("s.txt", [{ oldText: "b_", newText: "x", replaceAll: true }, { oldText: "b_2", newText: "y" }]), /overlap/);
  await assert.rejects(() => edit("s.txt", [{ oldText: "zzz", newText: "x", replaceAll: true }]), /not found/);
  assert.match(description("edit"), /replaceAll/);
});

test("replaceAll with no exact occurrence replaces every fuzzy one, each at its own span", async () => {
  put("f.txt", "x = “a”  \ny = 1\nx = “a”; z = “a”\n");
  assert.match(await edit("f.txt", [{ oldText: '“a”'.replace(/[“”]/g, '"'), newText: "'b'", replaceAll: true }]), /Successfully replaced 3 blocks/);
  assert.equal(content("f.txt"), "x = 'b'  \ny = 1\nx = 'b'; z = 'b'\n", "two in one line, each spliced; the blanks after the match stay");
});

// (fails before: a fuzzy match widened to its whole line, and what the edit never sent — `return `, ` + 1;` — was lost)
test("a fuzzy match changes only the span it matched", async () => {
  put("w.js", "function f() {\n  return foo(“a”) + 1;\n}\n");
  await edit("w.js", [{ oldText: 'foo("a")', newText: 'foo("b")' }]);
  assert.equal(content("w.js"), 'function f() {\n  return foo("b") + 1;\n}\n');
  put("w2.js", "a(“x”,\n  “y”) + rest;\n");
  await edit("w2.js", [{ oldText: 'a("x",\n  "y")', newText: "b()" }]);
  assert.equal(content("w2.js"), "b() + rest;\n", "across lines too");
});

test("inside a line that normalizing changes, a fuzzy match is taken only when it covers the whole line", async () => {
  put("n.txt", "ﬁle “one”\nﬁle “two”\n");
  await assert.rejects(() => edit("n.txt", [{ oldText: '"one"', newText: "1" }]), /cannot be placed exactly/);
  assert.equal(content("n.txt"), "ﬁle “one”\nﬁle “two”\n", "nothing written");
  await edit("n.txt", [{ oldText: 'file "two"', newText: "file two" }]);
  assert.equal(content("n.txt"), "ﬁle “one”\nfile two\n");
});

// (fails before: a multi-line replacement into a CRLF file came out with LF endings in the middle of it)
test("a replacement's lines end as the file's do when every line of it ends in CRLF; a mixed file is left as it is", async () => {
  put("c.txt", "a\r\nb\r\nc\r\n");
  await edit("c.txt", [{ oldText: "b", newText: "b1\nb2" }]);
  assert.equal(content("c.txt"), "a\r\nb1\r\nb2\r\nc\r\n");
  put("c2.txt", "x = “q”\r\nend\r\n");
  await edit("c2.txt", [{ oldText: 'x = "q"', newText: "x = 1\ny = 2" }]);
  assert.equal(content("c2.txt"), "x = 1\r\ny = 2\r\nend\r\n", "the fuzzy path too");
  put("m.txt", "a\nb\r\nc\n");
  await edit("m.txt", [{ oldText: "b", newText: "b1\nb2" }]);
  assert.equal(content("m.txt"), "a\nb1\nb2\r\nc\n");
});

test("a newText whose lines only partly look prefixed keeps them: it was not copied from read", async () => {
  put("q.tsv", "a\nb\n");
  await edit("q.tsv", [{ oldText: "     1\ta", newText: "a\n     7\tseven" }]);
  assert.equal(content("q.tsv"), "a\n     7\tseven\nb\n");
});
