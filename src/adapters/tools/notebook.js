// @ts-check
// Jupyter notebooks read as cells and edited by cell (the owner's word of 10-27: the loop works like Claude Code where it
// fell short — its Read shows a notebook's cells with their outputs, and its NotebookEdit changes one cell). Here the
// read hand shows an .ipynb as its cells — each with its type, its id and its source, then what it output — and the
// edit hand matches an edit's oldText inside one cell's source, writing the notebook back as JSON in the layout it had:
// its indent, its line endings, each source kept as the list of lines or the one string it was. A cell is added or
// removed by writing the notebook's JSON whole. Pure, but for nothing: the hands read and write the file.

/** What one cell's outputs show at most: past it, the rest is said cut. */
export const NOTEBOOK_OUTPUT_CHARS = 4_000;

/** @param {string} path */
export const isNotebookPath = (path) => /\.ipynb$/i.test(String(path || ""));

/**
 * A notebook's JSON, or null where the text is none: not JSON, or no list of cells.
 * @param {string} raw @returns {{ cells: any[], metadata?: any, nbformat?: number, nbformat_minor?: number } | null}
 */
export function parseNotebook(raw) {
  try {
    const nb = JSON.parse(raw.replace(/^﻿/, ""));
    return nb && typeof nb === "object" && Array.isArray(nb.cells) ? nb : null;
  } catch {
    return null;
  }
}

/** A field nbformat keeps as a list of lines or one string, as one string. @param {unknown} v */
const joined = (v) => (Array.isArray(v) ? v.map(String).join("") : typeof v === "string" ? v : "");

/** A terminal's colours, gone from a traceback. @param {string} s */
const plain = (s) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");

/** One output as text: a stream's, a result's plain text, a picture or a page named, an error with its traceback. @param {any} o */
function outputText(o) {
  const type = String(o?.output_type || "");
  if (type === "stream") return `${o.name === "stderr" ? "(stderr) " : ""}${joined(o.text)}`;
  if (type === "error") return plain([`${o.ename || "Error"}: ${o.evalue ?? ""}`, ...(Array.isArray(o.traceback) ? o.traceback.map(String) : [])].join("\n"));
  const data = o?.data && typeof o.data === "object" ? o.data : {};
  if ("text/plain" in data || "text/markdown" in data) return joined(data["text/markdown"] ?? data["text/plain"]);
  const kinds = Object.keys(data);
  return kinds.length ? `[${kinds.join(", ")} output, not shown as text]` : "";
}

/** The language a notebook's kernel speaks, as its metadata names it. @param {any} nb */
const languageOf = (nb) => String(nb?.metadata?.language_info?.name || nb?.metadata?.kernelspec?.language || "").trim();

/**
 * A notebook as the read hand shows it: a first line saying what it is and how it is edited, then each cell under a
 * line naming its number, type, id and run count, its source, and its outputs under their own line, cut at
 * NOTEBOOK_OUTPUT_CHARS a cell.
 * @param {{ cells: any[], metadata?: any }} nb @param {string} path
 */
export function notebookText(nb, path) {
  const lang = languageOf(nb);
  const lines = [`[Notebook ${path}: ${nb.cells.length} cell${nb.cells.length === 1 ? "" : "s"}${lang ? `, ${lang}` : ""}. edit changes a cell's source: its oldText is matched within one cell, as shown under the cell's line. To add or remove a cell, write the notebook's JSON whole.]`];
  nb.cells.forEach((c, i) => {
    const type = String(c?.cell_type || "code");
    const facts = [`cell ${i + 1}`, type, ...(c?.id ? [`id ${c.id}`] : []), ...(type === "code" && Number.isInteger(c?.execution_count) ? [`ran [${c.execution_count}]`] : [])];
    lines.push(`── ${facts.join(" · ")} ──`);
    const source = joined(c?.source);
    if (source) lines.push(source.replace(/\r\n/g, "\n").replace(/\n$/, ""));
    const outs = (Array.isArray(c?.outputs) ? c.outputs : []).map(outputText).filter((t) => t.trim());
    if (outs.length) {
      // Each output on its own lines: a stream that ends in a newline leaves no blank line before the next.
      let text = outs.map((t) => t.replace(/\r\n/g, "\n").replace(/\n+$/, "")).join("\n");
      if (text.length > NOTEBOOK_OUTPUT_CHARS) text = `${text.slice(0, NOTEBOOK_OUTPUT_CHARS)}\n…[output cut: ${text.length.toLocaleString()} characters in all]`;
      lines.push("── output ──", text);
    }
  });
  return `${lines.join("\n")}\n`;
}

/**
 * Edits made inside the cells' sources: each oldText is matched within one cell's source, its line endings aside, and
 * must be there once unless it replaces every one. The notebook is given back as JSON in the layout it came in.
 * @param {string} raw  the file's text
 * @param {{ oldText: string, newText: string, replaceAll?: boolean }[]} edits
 * @param {{ path: string, old: string, all: string }} words  the file's name, and the edit's own field names
 * @param {(e: { oldText: string, newText: string, replaceAll?: boolean }) => { oldText: string, newText: string, replaceAll?: boolean } | null} [alt]
 *   the edit as it was likely meant, tried where the text as sent is in no cell (read's line prefix dropped, TL-D6)
 * @returns {{ text: string, replaced: number, cells: number[] } | { error: string }}
 */
export function editNotebook(raw, edits, words, alt) {
  const nb = parseNotebook(raw);
  if (!nb) return { error: `${words.path} is not a notebook Filament can read: its JSON has no list of cells. Read it, and write it whole.` };
  const sources = nb.cells.map((c) => joined(c?.source).replace(/\r\n/g, "\n"));
  let replaced = 0;
  /** @type {Set<number>} */
  const touched = new Set();
  for (const sent of edits) {
    const meant = alt?.(sent);
    const inSome = (/** @type {{ oldText: string }} */ x) => sources.some((s) => !!x.oldText && s.includes(String(x.oldText).replace(/\r\n/g, "\n")));
    const e = !inSome(sent) && meant && inSome(meant) ? meant : sent;
    const old = String(e.oldText ?? "").replace(/\r\n/g, "\n");
    if (!old) return { error: `an edit's ${words.old} is empty: give the text of the cell to change` };
    const hits = sources.map((s, i) => ({ i, n: s.split(old).length - 1 })).filter((x) => x.n > 0);
    const count = hits.reduce((n, x) => n + x.n, 0);
    if (!count)
      return { error: `${words.old} is in no cell of ${words.path}. It is matched within one cell's source as read shows it — not across cells, nor the lines naming a cell or its output. Read the notebook and copy the text exactly.` };
    if (count > 1 && !e.replaceAll)
      return { error: `Found ${count} occurrences of the text in ${words.path}'s cells (${hits.map((x) => `cell ${x.i + 1}`).join(", ")}). The text must be unique. Please provide more context to make it unique, or set ${words.all} to replace every one.` };
    for (const { i, n } of hits) {
      sources[i] = sources[i].split(old).join(String(e.newText ?? "").replace(/\r\n/g, "\n"));
      replaced += n;
      touched.add(i);
    }
  }
  for (const i of touched) {
    const c = nb.cells[i];
    // As nbformat writes a source: a list of lines, each but the last ending in its newline — or the one string it was.
    c.source = typeof c.source === "string" ? sources[i] : sources[i] ? sources[i].split(/(?<=\n)/) : [];
  }
  const indent = /^﻿?\{\r?\n( +)"/.exec(raw)?.[1].length ?? 1;
  const crlf = /\r\n/.test(raw);
  let text = JSON.stringify(nb, null, indent);
  if (/\n$/.test(raw)) text += "\n";
  if (crlf) text = text.replace(/\n/g, "\r\n");
  return { text: `${raw.startsWith("﻿") ? "﻿" : ""}${text}`, replaced, cells: [...touched].sort((a, b) => a - b).map((i) => i + 1) };
}
