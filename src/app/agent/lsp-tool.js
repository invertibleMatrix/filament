// @ts-check
// The agent's `lsp` tool (the owner's LSP of 11-04): what a language server knows of the code, asked as an editor asks
// it — where a name is defined, where its type is, where it is implemented and used, its type and documentation, a
// file's symbols and the project's, a file's problems. The server is the one that serves the file
// (adapters/lsp/servers.js: the developer's, a plugin's, then the ones Filament knows, by their programs installed here),
// kept warm for every chat working in the folder (adapters/lsp/pool.js) and held for the call. It only reads, so it
// runs in every mode, and it is always offered, a server or none: for a file no server serves it says why, and to use
// grep and read. A file is asked of as it is on disk, inside the working folder; places are said as read numbers them,
// 1-based, by their path relative to the folder with their line's text — one outside it by its whole path alone. The
// same servers list the project's names for the message box's `@#` (`projectSymbols`).
import { readFileSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { LSP_FILE_BYTES, languageOf, pathOfUri } from "../../adapters/lsp/client.js";
import { serverFor } from "../../adapters/lsp/servers.js";
import { HandError, resolveInside } from "../../adapters/tools/fs-fence.js";
import { cut } from "../../core/text.js";

export const LSP = "lsp";
/** What the tool asks: the places a name leads to, a name's words, a file's symbols, the project's, a file's problems. */
export const LSP_ACTIONS = Object.freeze(["definition", "type_definition", "implementation", "references", "hover", "symbols", "workspace_symbols", "diagnostics"]);
/** The most places, and symbols, one answer lists. */
export const LSP_PLACES_MOST = 100;
export const LSP_SYMBOLS_MOST = 300;
/** The most of a hover's words one answer carries. */
export const LSP_HOVER_CHARS = 4000;
/** How long diagnostics waits for the server's word on a file it was just sent. */
export const LSP_DIAGNOSTICS_WAIT_MS = 10_000;
/** The most of a line's text shown beside its place. */
const LINE_CHARS = 200;

/** Each action's request, the capability a server answers it by, and what an empty answer found none of. */
const ASKS = Object.freeze({
  definition: { method: "textDocument/definition", capability: "definitionProvider", none: "definition" },
  type_definition: { method: "textDocument/typeDefinition", capability: "typeDefinitionProvider", none: "type definition" },
  implementation: { method: "textDocument/implementation", capability: "implementationProvider", none: "implementation" },
  references: { method: "textDocument/references", capability: "referencesProvider", none: "reference" },
  hover: { method: "textDocument/hover", capability: "hoverProvider", none: "" },
  symbols: { method: "textDocument/documentSymbol", capability: "documentSymbolProvider", none: "" },
  workspace_symbols: { method: "workspace/symbol", capability: "workspaceSymbolProvider", none: "" },
  diagnostics: { method: "", capability: "", none: "" },
});
/** The actions that ask of a place in the file. */
const AT_A_PLACE = new Set(["definition", "type_definition", "implementation", "references", "hover"]);

export const LSP_TOOL = Object.freeze({
  name: LSP,
  description:
    "Ask the language server that serves a file what it knows of the code — surer than grep: it follows imports, types and overloads as the compiler does. action: definition, type_definition, implementation (of an interface or abstract member), references (every use, the definition among them) and hover (type and documentation), each at a place — path, line (1-based, as read numbers it) and symbol, the name on that line (occurrence picks which, or column instead); symbols — the file's outline; workspace_symbols — the project's names that match query (path: any file of their language); diagnostics — the file's errors and warnings now (a write's or an edit's result says its file's errors by itself). Places come back as path:line:column: and the line's text, files as they are on disk in the working folder. The servers are those installed here — TypeScript and JavaScript, Python, Go, Rust, C and C++ — and any the developer or a plugin adds; for a file none serves it says so: use grep and read. A server's first question in a folder can take a few seconds.",
  input_schema: Object.freeze({
    type: "object",
    required: ["action", "path"],
    properties: {
      action: { type: "string", enum: [...LSP_ACTIONS], description: "What to ask." },
      path: { type: "string", description: "The file, relative to the task folder or absolute inside it." },
      line: { type: "number", description: "The line the name is on, 1-based (definition, type_definition, implementation, references, hover)." },
      symbol: { type: "string", description: "The name on that line to ask about." },
      occurrence: { type: "number", description: "Which of the name's places on the line, 1-based (default 1)." },
      column: { type: "number", description: "Instead of symbol: the column on the line, 1-based." },
      query: { type: "string", description: "workspace_symbols: the name, or a part of it." },
    },
  }),
});

/** The words of the protocol's symbol kinds, by their number less one. */
const KIND_WORDS = ["file", "module", "namespace", "package", "class", "method", "property", "field", "constructor", "enum", "interface", "function", "variable", "constant", "string", "number", "boolean", "array", "object", "key", "null", "enum member", "struct", "event", "operator", "type parameter"];
/** @param {unknown} k */
const kindWord = (k) => KIND_WORDS[Number(k) - 1] || "symbol";
const SEVERITY_WORDS = ["error", "warning", "info", "hint"];
/** What diagnostics says of a file the server finds nothing wrong in, after its name. */
const NO_PROBLEMS = "finds no problems in";
/** A problem as diagnostics lists it: `path:line:column: severity: what (source code)`. */
const PROBLEM_LINE = new RegExp(`^.+?:\\d+:\\d+: (${SEVERITY_WORDS.join("|")}): `);

/**
 * The errors of what diagnostics said (`runLsp`): its problems that are errors, as it lists them — [] where the server
 * finds no problems, or only lesser ones — or null where it said nothing of the file's problems: no word in time, a
 * stop, no server for it.
 * @param {string} said @returns {string[] | null}
 */
export function errorsOfDiagnostics(said) {
  if (said.startsWith("(no matches) ")) return said.includes(` ${NO_PROBLEMS} `) ? [] : null;
  const lines = said.split("\n");
  return lines.some((l) => PROBLEM_LINE.test(l)) ? lines.filter((l) => PROBLEM_LINE.exec(l)?.[1] === "error") : null;
}
/** A character a name is made of, so a name's place on a line is found whole before inside another. */
const WORDY = /[\p{L}\p{N}_$]/u;

/** @param {string} text */
const linesOf = (text) => text.split(/\r\n|\r|\n/);

/**
 * Where a name stands on a line, by its first character's column (0-based, in UTF-16 units as the protocol counts):
 * its places as a whole name first, else as part of one.
 * @param {string} line @param {string} name
 */
const placesOn = (line, name) => {
  /** @type {number[]} */
  const at = [];
  for (let i = line.indexOf(name); i >= 0; i = line.indexOf(name, i + 1)) at.push(i);
  const whole = at.filter((i) => !(WORDY.test(name[0]) && WORDY.test(line[i - 1] || "")) && !(WORDY.test(name.at(-1) || "") && WORDY.test(line[i + name.length] || "")));
  return whole.length ? whole : at;
};

/**
 * The place a call names, 0-based as the protocol has it: its line, and the name on it — or the column.
 * @param {any} input @param {string} action @param {string} text  the file's @param {string} path  as the call named it
 * @returns {{ line: number, character: number, name: string }}
 */
function placeOf(input, action, text, path) {
  const lines = linesOf(text);
  const n = Number(input?.line);
  if (input?.line === undefined || !Number.isInteger(n) || n < 1) throw new HandError(`${action} needs line: the line the name is on, 1-based`);
  if (n > lines.length) throw new HandError(`${path} has ${lines.length} line${lines.length === 1 ? "" : "s"}: line ${n} is past its end`);
  const at = lines[n - 1];
  const symbol = typeof input?.symbol === "string" ? input.symbol.trim() : "";
  if (symbol) {
    const all = placesOn(at, symbol);
    if (!all.length) throw new HandError(`${symbol} is not on line ${n} of ${path}, which reads: ${cut(at.trim(), LINE_CHARS)}`);
    const k = input?.occurrence === undefined ? 1 : Number(input.occurrence);
    if (!Number.isInteger(k) || k < 1 || k > all.length) throw new HandError(`occurrence ${input.occurrence}: ${symbol} is on line ${n} of ${path} ${all.length === 1 ? "once" : all.length === 2 ? "twice" : `${all.length} times`}`);
    return { line: n - 1, character: all[k - 1], name: symbol };
  }
  if (input?.column === undefined) throw new HandError(`${action} needs symbol, the name on line ${n} to ask about, or column`);
  const c = Number(input.column);
  if (!Number.isInteger(c) || c < 1 || c > at.length + 1) throw new HandError(`column ${input.column} is not on line ${n} of ${path}, which has ${at.length} characters`);
  const word = /[\p{L}\p{N}_$]+/u.exec(at.slice(c - 1))?.[0];
  return { line: n - 1, character: c - 1, name: word && at.slice(c - 1).startsWith(word) ? word : `${path}:${n}:${c}` };
}

/**
 * The places an answer leads to — a Location, a list of them, or of LocationLinks — each a file's path and a 0-based
 * place.
 * @param {any} result @returns {{ path: string, line: number, character: number }[]}
 */
const placesOf = (result) =>
  (Array.isArray(result) ? result : result ? [result] : []).flatMap((l) => {
    const uri = l?.targetUri ?? l?.uri;
    const range = l?.targetSelectionRange ?? l?.targetRange ?? l?.range;
    const path = typeof uri === "string" ? pathOfUri(uri) : null;
    return path && Number.isInteger(range?.start?.line) ? [{ path, line: range.start.line, character: Number(range.start.character) || 0 }] : [];
  });

/** Whether two paths name one file — in any case on Windows, as servers spell drives as they like. @param {string} a @param {string} b */
const sameFile = (a, b) => (process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));

/** A hover's words: markdown, plain text, or the older marked strings. @param {any} contents @returns {string} */
const hoverText = (contents) => {
  if (!contents) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join("\n\n");
  if (typeof contents.value === "string") return typeof contents.language === "string" && contents.language ? `\`\`\`${contents.language}\n${contents.value}\n\`\`\`` : contents.value;
  return "";
};

/** A symbol's lines: "line 4", or "lines 4-9". @param {any} range */
const linesWords = (range) => {
  const a = Number(range?.start?.line);
  const b = Number(range?.end?.line);
  if (!Number.isInteger(a)) return "";
  return Number.isInteger(b) && b > a ? `lines ${a + 1}-${b + 1}` : `line ${a + 1}`;
};

/**
 * The pool's answer, or null once the call is stopped first — a server's start can take its time, and a stop does not
 * wait for it: the server that comes after is let go at once.
 * @param {Promise<import("../../adapters/lsp/pool.js").LspAsk>} asking @param {AbortSignal | null} signal
 * @returns {Promise<import("../../adapters/lsp/pool.js").LspAsk | null>}
 */
const untilStopped = (asking, signal) => {
  if (!signal) return asking;
  return new Promise((done, fail) => {
    const stop = () => {
      done(null);
      asking.then((h) => h.release(), () => {});
    };
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    asking.then(
      (h) => {
        signal.removeEventListener("abort", stop);
        done(h);
      },
      (e) => {
        signal.removeEventListener("abort", stop);
        fail(e);
      },
    );
  });
};

/**
 * Ask the language server that serves a file, as the agent's `lsp` call says: the answer in words, or why there is
 * none — no server for such files, or the server's problem. Every path is held inside `root`.
 * @param {any} input
 * @param {{ root: string, servers: readonly import("../../adapters/lsp/servers.js").LspEntry[],
 *   pool: { server: (spec: import("../../adapters/lsp/client.js").LspSpec, root: string) => Promise<import("../../adapters/lsp/pool.js").LspAsk> },
 *   signal?: AbortSignal | null, waitMs?: number, found?: (spec: import("../../adapters/lsp/client.js").LspSpec) => boolean }} o
 *   `servers`: the chat's (`languageServers`); `waitMs`: how long diagnostics waits for the server's word; `found`:
 *   whether a server's program is installed (servers.js `installed` where unsaid)
 * @returns {Promise<string>}
 */
export async function runLsp(input, { root, servers, pool, signal = null, waitMs = LSP_DIAGNOSTICS_WAIT_MS, found }) {
  const action = String(input?.action ?? "").trim().toLowerCase();
  if (!LSP_ACTIONS.includes(action)) throw new HandError(`action must be one of: ${LSP_ACTIONS.join(", ")}`);
  const path = typeof input?.path === "string" ? input.path.trim() : "";
  if (!path) throw new HandError(action === "workspace_symbols" ? "workspace_symbols needs path: any file of the language the names are in, which picks its language server" : `${action} needs path: the file`);
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  if (action === "workspace_symbols" && !query) throw new HandError("workspace_symbols needs query: the name, or a part of it");
  const abs = resolveInside(root, path);
  let size = 0;
  try {
    const st = statSync(abs);
    if (!st.isFile()) throw new Error("no file");
    size = st.size;
  } catch {
    throw new HandError(`${path} is no file in the working folder`);
  }
  if (size > LSP_FILE_BYTES) throw new HandError(`${path} is ${Math.round(size / 1024)} KB, past the ${LSP_FILE_BYTES / 1024 / 1024} MB a language server is given`);
  const place = AT_A_PLACE.has(action) ? placeOf(input, action, readFileSync(abs, "utf8"), path) : null;
  const pick = serverFor(abs, servers, { root, ...(found ? { found } : {}) });
  if (!pick.server) return `(no matches) ${pick.said} Use grep and read for this file.`;
  const held = await untilStopped(pool.server(pick.server.spec, root), signal);
  if (!held) throw new Error(`stopped while language server ${pick.server.spec.name} started`);
  if (!held.server) throw new Error(`${held.problem}. Use grep and read meanwhile.`);
  const s = held.server;
  try {
    const ask = /** @type {Record<string, { method: string, capability: string, none: string }>} */ (ASKS)[action];
    if (ask.capability && !s.capabilities?.[ask.capability]) return `(no matches) Language server ${s.name} does not answer ${action}. Use grep and read for it.`;
    // The server works in the folder as its first ask named it, another spelling of this one where a link led there:
    // the file is named to it in its own.
    const file = join(s.root, relative(resolve(root), abs));
    /** A place as the agent reads it: its path relative to the folder — in any case on Windows, as servers spell drives as they like — else whole. @param {string} p */
    const shown = (p) => {
      const r = relative(s.root, p);
      return r && !r.startsWith("..") && !isAbsolute(r) ? r.split(sep).join("/") : p;
    };
    /** The files' lines read for this answer, each file once. @type {Map<string, Promise<string[] | null>>} */
    const texts = new Map();
    /**
     * A place's line, read where the file is inside the working folder: one outside it — a library's, the toolchain's —
     * is named, its text not read.
     * @param {string} p @param {number} line
     */
    const lineText = async (p, line) => {
      if (!texts.has(p))
        texts.set(
          p,
          (async () => {
            try {
              const at = resolveInside(s.root, p);
              return (await stat(at)).size <= LSP_FILE_BYTES ? linesOf(await readFile(at, "utf8")) : null;
            } catch {
              return null;
            }
          })(),
        );
      return cut(String((await texts.get(p))?.[line] ?? "").trim(), LINE_CHARS);
    };
    /** @param {{ path: string, line: number, character: number }} at */
    const placeWords = (at) => `${shown(at.path)}:${at.line + 1}:${at.character + 1}`;
    const { uri, mark } = s.sync(file);
    const asked = place ? `${place.name} at ${placeWords({ path: file, ...place })}` : shown(file);
    const young = held.fresh ? ` It started just now and may still be reading the project: ask again in a moment.` : "";

    if (action === "diagnostics") {
      // At once where the server has spoken of the text last sent and fell quiet since; else its word is waited for.
      const list = await s.diagnostics(file, { after: mark, waitMs, signal });
      if (list === null) return signal?.aborted ? `(no matches) The wait for ${s.name}'s word on ${asked} was stopped.` : `(no matches) ${s.name} said nothing of ${asked}'s problems within ${Math.round(waitMs / 1000)} s; it may still be reading the project — ask again in a moment.`;
      if (!list.length) return `(no matches) ${s.name} ${NO_PROBLEMS} ${asked}.`;
      const sorted = [...list].sort((a, b) => (a.severity || 1) - (b.severity || 1) || a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
      const lines = sorted.slice(0, LSP_SYMBOLS_MOST).map((d) => {
        const by = [d.source, d.code].filter((x) => x !== undefined && x !== null && x !== "").join(" ");
        return `${placeWords({ path: file, line: d.range.start.line, character: d.range.start.character })}: ${SEVERITY_WORDS[(d.severity || 1) - 1] || "error"}: ${String(d.message).replace(/\s*\n\s*/g, " ")}${by ? ` (${by})` : ""}`;
      });
      return [...lines, ...(sorted.length > LSP_SYMBOLS_MOST ? [`[${sorted.length - LSP_SYMBOLS_MOST} more problems not shown]`] : [])].join("\n");
    }

    const params =
      action === "workspace_symbols" ? { query }
      : action === "symbols" ? { textDocument: { uri } }
      : { textDocument: { uri }, position: { line: place?.line, character: place?.character }, ...(action === "references" ? { context: { includeDeclaration: true } } : {}) };
    let result;
    try {
      result = await s.request(ask.method, params, { signal });
    } catch (/** @type {any} */ e) {
      // The protocol's "content modified" and "server cancelled": it is still reading the project.
      if (e?.code === -32801 || e?.code === -32802) return `(no matches) ${s.name} is still reading the project and did not answer; ask again in a moment.`;
      throw e;
    }
    // A definition that is one other place in the same file — the import a name came by, as TypeScript's server answers —
    // is asked once more from there, which leads on to where the name is defined: the agent's next call, saved. One that
    // leads nowhere else stands.
    if (action === "definition") {
      const first = placesOf(result);
      const at = first.length === 1 && sameFile(first[0].path, file) && (first[0].line !== place?.line || first[0].character !== place?.character) ? first[0] : null;
      if (at) {
        const next = await s.request(ask.method, { textDocument: { uri }, position: { line: at.line, character: at.character } }, { signal }).catch(() => null);
        const there = placesOf(next);
        if (there.length && !(there.length === 1 && sameFile(there[0].path, file) && there[0].line === at.line)) result = next;
      }
    }

    if (action === "hover") {
      const text = hoverText(result?.contents).trim();
      if (!text) return `(no matches) ${s.name} says nothing of ${asked}.${young}`;
      return text.length > LSP_HOVER_CHARS ? `${text.slice(0, LSP_HOVER_CHARS)}\n[cut at ${LSP_HOVER_CHARS.toLocaleString("en-US")} characters]` : text;
    }

    if (action === "symbols") {
      /** @type {string[]} */
      const out = [];
      let total = 0;
      /** @param {any[]} items @param {number} depth */
      const walk = (items, depth) => {
        for (const it of items) {
          if (!it || typeof it.name !== "string") continue;
          total++;
          if (out.length < LSP_SYMBOLS_MOST) {
            const lines = linesWords(it.range ?? it.location?.range);
            const detail = typeof it.detail === "string" && it.detail.trim() ? ` — ${cut(it.detail.trim(), 120)}` : "";
            const within = depth === 0 && typeof it.containerName === "string" && it.containerName ? ` in ${it.containerName}` : "";
            out.push(`${"  ".repeat(depth)}${kindWord(it.kind)} ${it.name}${detail}${within}${lines ? ` (${lines})` : ""}`);
          }
          if (Array.isArray(it.children)) walk(it.children, depth + 1);
        }
      };
      walk(Array.isArray(result) ? result : [], 0);
      if (!total) return `(no matches) ${s.name} finds no symbols in ${asked}.${young}`;
      return [...out, ...(total > out.length ? [`[${total - out.length} more symbols not shown]`] : [])].join("\n");
    }

    if (action === "workspace_symbols") {
      const named = (Array.isArray(result) ? result : []).filter((it) => it && typeof it.name === "string");
      if (!named.length) return `(no matches) ${s.name} knows no name like ${query} in the project.${young}`;
      const lines = named.slice(0, LSP_PLACES_MOST).map((it) => {
        const p = typeof it.location?.uri === "string" ? pathOfUri(it.location.uri) : null;
        const start = it.location?.range?.start;
        const where = p ? (Number.isInteger(start?.line) ? `${placeWords({ path: p, line: start.line, character: Number(start.character) || 0 })}: ` : `${shown(p)}: `) : "";
        return `${where}${kindWord(it.kind)} ${it.name}${typeof it.containerName === "string" && it.containerName ? ` in ${it.containerName}` : ""}`;
      });
      return [...lines, ...(named.length > LSP_PLACES_MOST ? [`[${named.length - LSP_PLACES_MOST} more not shown]`] : [])].join("\n");
    }

    // The places a name leads to, each once, by file and place.
    const seen = new Set();
    const places = placesOf(result)
      .filter((at) => {
        const k = `${shown(at.path).toLowerCase()}:${at.line}:${at.character}`;
        return seen.has(k) ? false : (seen.add(k), true);
      })
      .sort((a, b) => shown(a.path).localeCompare(shown(b.path)) || a.line - b.line || a.character - b.character);
    if (!places.length) return `(no matches) ${s.name} knows no ${ask.none} of ${asked}.${young}`;
    const lines = await Promise.all(
      places.slice(0, LSP_PLACES_MOST).map(async (at) => {
        const text = await lineText(at.path, at.line);
        return `${placeWords(at)}:${text ? ` ${text}` : ""}`;
      }),
    );
    return [...lines, ...(places.length > LSP_PLACES_MOST ? [`[${places.length - LSP_PLACES_MOST} more places not shown]`] : [])].join("\n");
  } finally {
    held.release();
  }
}

/** The most of the project's names one `@#` in the message box lists. */
export const SYMBOLS_LISTED = 20;
/** How long a server is waited for, for the names an `@#` asks. */
export const SYMBOLS_WAIT_MS = 10_000;
/** How many of a server's files are tried, best first, where one cannot be opened: gone from the disk, too big. */
const SYMBOL_FILES_TRIED = 3;

/**
 * A name of the project as the message box's `@#` lists it: what it is, its file, and its lines, 1-based — null where
 * the server named its file alone.
 * @typedef {{ name: string, kind: string, container: string, path: string, line: number | null, end: number | null }} ProjectSymbol
 */

/**
 * The project's names that answer what an `@#` typed (the owner's LSP of 11-04, phase 2): asked of each language server
 * that serves the project's files, with one of them opened, which loads its project — from the folder at the top that
 * holds most of the files it serves (`src`, not a config file beside it, whose project may be another), the one nearest
 * that folder's top, else the next where it cannot be opened — and kept to the project's own files (`files`, as the `@`
 * list reads them: no library's, no ignored one's). Best first:
 * the name itself, then one it starts, then one holding it, each server's own order within. Where none is found and no
 * server could search, `said` says why: no server for the project's files, one still starting, one's problem, one that
 * lists no names — "" where a server searched and knows no such name.
 * @param {string} query
 * @param {{ root: string, files: readonly string[], servers: readonly import("../../adapters/lsp/servers.js").LspEntry[],
 *   pool: { server: (spec: import("../../adapters/lsp/client.js").LspSpec, root: string) => Promise<import("../../adapters/lsp/pool.js").LspAsk> },
 *   signal?: AbortSignal | null, found?: (spec: import("../../adapters/lsp/client.js").LspSpec) => boolean, limit?: number }} o
 *   `files`: the project's, relative to `root` with `/`; `found`: whether a server's program is installed
 * @returns {Promise<{ symbols: ProjectSymbol[], said: string }>}
 */
export async function projectSymbols(query, { root, files, servers, pool, signal = null, found, limit = SYMBOLS_LISTED }) {
  const q = query.trim();
  if (!q) return { symbols: [], said: "" };
  /**
   * Each server's files by the folder at the top they are in ("" for the folder's own): how many, and the few nearest
   * that folder's top, shortest first.
   * @type {Map<string, { server: import("../../adapters/lsp/servers.js").LspEntry, tops: Map<string, { count: number, best: string[] }> }>}
   */
  const served = new Map();
  /** Each extension's server, picked once. @type {Map<string, import("../../adapters/lsp/servers.js").LspEntry | null>} */
  const byExt = new Map();
  /** Why the files some server serves have none here, with how to install one. */
  let missing = "";
  const depth = (/** @type {string} */ f) => f.split("/").length;
  const nearer = (/** @type {string} */ a, /** @type {string} */ b) => depth(a) - depth(b) || a.length - b.length;
  for (const rel of files) {
    const ext = extname(rel).toLowerCase();
    if (!ext) continue;
    if (!byExt.has(ext)) {
      const pick = serverFor(join(root, rel), servers, { root, ...(found ? { found } : {}) });
      byExt.set(ext, pick.server);
      if (!pick.server && !missing && servers.some((s) => languageOf(s.spec.languages, rel) !== null)) missing = pick.said;
    }
    const server = byExt.get(ext);
    if (!server) continue;
    let its = served.get(server.name);
    if (!its) served.set(server.name, (its = { server, tops: new Map() }));
    const slash = rel.indexOf("/");
    const top = slash < 0 ? "" : rel.slice(0, slash);
    let at = its.tops.get(top);
    if (!at) its.tops.set(top, (at = { count: 0, best: [] }));
    at.count++;
    let i = at.best.length;
    while (i > 0 && nearer(rel, at.best[i - 1]) < 0) i--;
    if (i < SYMBOL_FILES_TRIED) {
      at.best.splice(i, 0, rel);
      if (at.best.length > SYMBOL_FILES_TRIED) at.best.pop();
    }
  }
  if (!served.size) return { symbols: [], said: missing || "No language server here serves this project's files." };
  const picks = [...served.values()].map(({ server, tops }) => ({ server, files: [...tops.values()].reduce((a, b) => (b.count > a.count ? b : a)).best }));
  // The listing's own spelling of each file — in any case on Windows, as servers spell paths as they like.
  const keyOf = (/** @type {string} */ p) => (process.platform === "win32" ? p.toLowerCase() : p);
  const own = new Map(files.map((f) => [keyOf(f), f]));
  const asked = await Promise.all(
    picks.map(async ({ server, files: tried }) => {
      /** @type {ProjectSymbol[]} */
      const none = [];
      const held = await untilStopped(pool.server(server.spec, root), signal);
      if (!held) return { list: none, why: "" };
      if (!held.server) return { list: none, why: `${server.name}: ${held.problem}.` };
      const s = held.server;
      const starting = `${s.name} has just started and is reading the project: its names come in a moment.`;
      try {
        if (!s.capabilities?.workspaceSymbolProvider) return { list: none, why: `${s.name} does not list a project's names.` };
        // The file opened loads its project with the server, as an editor's first file does: the next, where one cannot be.
        let couldNot = "";
        for (const file of tried) {
          try {
            s.sync(join(s.root, file));
            couldNot = "";
            break;
          } catch (/** @type {any} */ e) {
            couldNot ||= String(e?.message || e);
          }
        }
        if (couldNot) return { list: none, why: `${s.name} could open none of the project's files it was given: ${couldNot}.` };
        const result = await s.request("workspace/symbol", { query: q }, { signal, timeoutMs: SYMBOLS_WAIT_MS });
        const list = (Array.isArray(result) ? result : []).flatMap((it) => {
          const uri = it?.location?.uri;
          const p = typeof it?.name === "string" && typeof uri === "string" ? pathOfUri(uri) : null;
          const path = p ? own.get(keyOf(relative(s.root, p).split(sep).join("/"))) : undefined;
          if (!path) return [];
          const range = it.location.range;
          const a = Number(range?.start?.line);
          const b = Number(range?.end?.line);
          const line = Number.isInteger(a) ? a + 1 : null;
          // A range that ends where its next line starts ends on the line before.
          const end = line === null ? null : Number.isInteger(b) && b > a ? (range.end.character === 0 ? b : b + 1) : line;
          return [{ name: it.name, kind: kindWord(it.kind), container: typeof it.containerName === "string" ? it.containerName : "", path, line, end }];
        });
        return { list, why: list.length || !held.fresh ? "" : starting };
      } catch (/** @type {any} */ e) {
        if (signal?.aborted) return { list: none, why: "" };
        // The protocol's "content modified" and "server cancelled": it is still reading the project. A request's own
        // words name the server already.
        const words = String(e?.message || e);
        return { list: none, why: e?.code === -32801 || e?.code === -32802 ? starting : `${words.startsWith(`${s.name}: `) ? words : `${s.name}: ${words}`}.` };
      } finally {
        held.release();
      }
    }),
  );
  const low = q.toLowerCase();
  const rank = (/** @type {string} */ n) => {
    const x = n.toLowerCase();
    return x === low ? 0 : x.startsWith(low) ? 1 : x.includes(low) ? 2 : 3;
  };
  const seen = new Set();
  const symbols = asked
    .flatMap((a) => a.list)
    .filter((x) => {
      const k = `${x.path}:${x.line}:${x.name}`;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .map((x, i) => ({ x, i, r: rank(x.name) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, Math.max(1, limit))
    .map(({ x }) => x);
  // A server that searched and knows no such name says all there is to say; else each says why it could not.
  const searched = asked.some((a) => !a.why);
  return { symbols, said: symbols.length || searched ? "" : asked.map((a) => a.why).filter(Boolean).join(" ") };
}
