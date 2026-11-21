// @ts-check
// Notebooks read as cells and edited by cell (the owner's word of 10-27: the loop works like Claude Code where it fell
// short — its Read shows an .ipynb's cells with their outputs, and its NotebookEdit changes a cell). The read hand shows
// each cell's type, id, run count, source and output; the edit hand matches within one cell's source and writes the
// notebook back as valid JSON in the layout it came in.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHand } from "../src/adapters/tools/hands.js";

const root = mkdtempSync(join(tmpdir(), "filament-notebook-"));
after(() => rmSync(root, { recursive: true, force: true }));

/** A notebook as Jupyter writes one: nbformat 4.5, an indent of one, a newline at the end. */
const NB = {
  cells: [
    { cell_type: "markdown", id: "intro", metadata: {}, source: ["# Sales\n", "By region."] },
    {
      cell_type: "code", execution_count: 3, id: "load", metadata: {},
      outputs: [
        { name: "stdout", output_type: "stream", text: ["loaded 12 rows\n"] },
        { data: { "text/plain": ["   region  total\n", "0  north    40"] }, execution_count: 3, metadata: {}, output_type: "execute_result" },
      ],
      source: ["import pandas as pd\n", "df = pd.read_csv('sales.csv')\n", "df.head(1)"],
    },
    {
      cell_type: "code", execution_count: 4, id: "plot", metadata: {},
      outputs: [
        { data: { "image/png": "iVBORw0KGgo=", "text/html": ["<img>"] }, metadata: {}, output_type: "display_data" },
        { ename: "KeyError", evalue: "'total'", output_type: "error", traceback: ["\u001b[0;31mKeyError\u001b[0m: 'total'"] },
      ],
      source: "df.plot(y='total')",
    },
  ],
  metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" }, language_info: { name: "python" } },
  nbformat: 4,
  nbformat_minor: 5,
};
/** @param {string} name @param {any} nb @param {{ crlf?: boolean }} [o] */
const put = (name, nb, o = {}) => {
  const text = `${JSON.stringify(nb, null, 1)}\n`;
  writeFileSync(join(root, name), o.crlf ? text.replace(/\n/g, "\r\n") : text);
  return text;
};
/** A read's lines without their numbers. @param {unknown} out */
const shown = (out) => String(out).split("\n").map((l) => l.replace(/^ *\d+\t/, "")).join("\n");

// (fails before: yes — a notebook read as its raw JSON: its cells' lines in quotes, an image's bytes in base64)
test("read shows a notebook as its cells: type, id and run count, the source, then what it output — a picture named, an error's colours gone", async () => {
  put("sales.ipynb", NB);
  const out = await runHand("read", { path: "sales.ipynb" }, { root });
  assert.equal(shown(out), [
    "[Notebook sales.ipynb: 3 cells, python. edit changes a cell's source: its oldText is matched within one cell, as shown under the cell's line. To add or remove a cell, write the notebook's JSON whole.]",
    "── cell 1 · markdown · id intro ──",
    "# Sales",
    "By region.",
    "── cell 2 · code · id load · ran [3] ──",
    "import pandas as pd",
    "df = pd.read_csv('sales.csv')",
    "df.head(1)",
    "── output ──",
    "loaded 12 rows",
    "   region  total",
    "0  north    40",
    "── cell 3 · code · id plot · ran [4] ──",
    "df.plot(y='total')",
    "── output ──",
    "[image/png, text/html output, not shown as text]",
    "KeyError: 'total'",
    "KeyError: 'total'",
  ].join("\n"));
  // A file named .ipynb whose JSON is no notebook reads as the text it is.
  writeFileSync(join(root, "odd.ipynb"), '{"not": "a notebook"}\n');
  assert.equal(shown(await runHand("read", { path: "odd.ipynb" }, { root })), '{"not": "a notebook"}');
});

// (fails before: yes — an edit across a cell's lines matched nothing: in the file they are separate JSON strings)
test("edit changes one cell's source as read shows it, and the notebook stays valid, in its own layout", async () => {
  const before = put("edit.ipynb", NB);
  const seen = new Map();
  await runHand("read", { path: "edit.ipynb" }, { root, seen });
  const said = await runHand("edit", { path: "edit.ipynb", edits: [{ oldText: "df = pd.read_csv('sales.csv')\ndf.head(1)", newText: "df = pd.read_csv('sales.csv', sep=';')\ndf.head(2)" }] }, { root, seen });
  assert.equal(said, "Successfully replaced 1 block in edit.ipynb (cell 2)");
  const after = readFileSync(join(root, "edit.ipynb"), "utf8");
  const nb = JSON.parse(after);
  assert.deepEqual(nb.cells[1].source, ["import pandas as pd\n", "df = pd.read_csv('sales.csv', sep=';')\n", "df.head(2)"], "a list of lines, as nbformat keeps it");
  assert.deepEqual(nb.cells[1].outputs, NB.cells[1].outputs, "its outputs as they were");
  assert.equal(after, before.replace(`"df = pd.read_csv('sales.csv')\\n",\n    "df.head(1)"`, `"df = pd.read_csv('sales.csv', sep=';')\\n",\n    "df.head(2)"`), "every other byte as it was");
  // A source kept as one string stays one; read's line numbers copied into the edit are dropped.
  const numbered = String(await runHand("read", { path: "edit.ipynb" }, { root, seen })).split("\n").find((l) => l.endsWith("df.plot(y='total')"));
  await runHand("edit", { path: "edit.ipynb", edits: [{ oldText: String(numbered), newText: "df.plot(y='total', kind='bar')" }] }, { root, seen });
  assert.equal(JSON.parse(readFileSync(join(root, "edit.ipynb"), "utf8")).cells[2].source, "df.plot(y='total', kind='bar')");
});

// (fails before: yes — the text was looked for in the file's JSON: a cell's two lines never matched, nor did a CRLF one)
test("an edit's text across two cells, or in more than one, is refused in words; a CRLF notebook stays CRLF", async () => {
  put("refuse.ipynb", NB);
  await assert.rejects(runHand("edit", { path: "refuse.ipynb", edits: [{ oldText: "By region.\nimport pandas as pd", newText: "x" }] }, { root }), /oldText is in no cell of refuse\.ipynb\. It is matched within one cell's source as read shows it — not across cells/);
  await assert.rejects(runHand("edit", { path: "refuse.ipynb", edits: [{ oldText: "df", newText: "frame" }] }, { root }), /Found 3 occurrences of the text in refuse\.ipynb's cells \(cell 2, cell 3\)\. The text must be unique\. .* set replaceAll to replace every one\./);
  const said = await runHand("edit", { path: "refuse.ipynb", edits: [{ oldText: "df", newText: "frame", replaceAll: true }] }, { root });
  assert.equal(said, "Successfully replaced 3 blocks in refuse.ipynb (cells 2, 3)");
  put("crlf.ipynb", NB, { crlf: true });
  await runHand("edit", { path: "crlf.ipynb", edits: [{ oldText: "By region.", newText: "By region and month." }] }, { root });
  const raw = readFileSync(join(root, "crlf.ipynb"), "utf8");
  assert.ok(raw.endsWith("}\r\n") && !/(?<!\r)\n/.test(raw), "every line still ends in CRLF");
  assert.deepEqual(JSON.parse(raw).cells[0].source, ["# Sales\n", "By region and month."]);
});
