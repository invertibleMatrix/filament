// @ts-check
// What the planner keeps behind its task graph, kept and read (HarnessV4_TaskNotes_Plan E33): the `keep` and `read` of
// the tasks tool, which `applyTasks` checks and the graph runner hands here. A keep puts a note, files and a picture's
// code behind a task — or behind the graph itself — in the store (services/task-notes.js), and forgets what it names;
// a read lists what is kept, or reads one: a note or a text file in parts the tool's answer can carry, an image beside
// the words, any other file its size and its place on disk. Nothing here changes the graph: its words mark what is kept
// (`kept`), the runner draws it.
//
// Where a file may come from, and a picture by its name (`graphNoteSources`): a file from the chat's folder or a folder
// Filament's agent may work in (TN-D5), copied in whole (TN-D4); a picture one of the chat's agents drew — a helper's, a
// team's beside it, or the chat's own.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { IMAGE_MAX_BYTES, imageBlock, imageTypeOf, sizeWords } from "../../core/media.js";
import { FIND_HITS, foundLine, holdsAll } from "../../core/task-graph.js";
import { NOTES_LIMITS } from "../../services/task-notes.js";
import { folderVerdict } from "./turn.js";

/** How much of a note or a text file one answer carries: under the loop's guard on a result (hands.js), with room for its lines. */
export const PART_BYTES = 20_000;
/** The largest text file a find looks through (11-06): past it, a file is passed over. */
const FIND_FILE_BYTES = 2 * 1024 * 1024;

/**
 * @typedef {import("../../core/task-graph.js").NotesAsk} NotesAsk
 * @typedef {import("../../services/task-notes.js").TaskNotes} TaskNotes
 * @typedef {{ ok: true, name: string, data: Uint8Array } | { ok: false, error: string }} FileGot
 * @typedef {{ ok: true, name: string, code: string } | { ok: false, error: string }} PictureGot
 * @typedef {{ ok: true, text: string, media?: any[], kept: boolean } | { ok: false, error: string }} NotesAnswer  `kept`:
 *   what the task keeps changed, so the graph's page draws it again
 */

/** @param {number} n */
const chars = (n) => `${n.toLocaleString("en-US")} character${n === 1 ? "" : "s"}`;
/** @param {number} n @param {string} one */
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
/** When it was kept, to the minute. @param {number} at */
const when = (at) => (Number.isFinite(at) && at > 0 ? `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC` : "at a time not kept");
/** What one task keeps, in words. @param {{ notes: number, files: number }} c */
const countWords = (c) => [c.notes ? plural(c.notes, "note") : "", c.files ? plural(c.files, "file") : ""].filter(Boolean).join(", ");
/** Whether a file reads as text: no NUL in its first 8 KB. @param {Uint8Array} b */
const isText = (b) => !b.subarray(0, 8192).includes(0);

/**
 * A part of a long text that fits one answer: from `from`, at most PART_BYTES of UTF-8, ending at a line's end where one
 * falls in its last quarter. → the part and where the next starts, or null at the end.
 * @param {string} text @param {number} from @returns {{ part: string, next: number | null }}
 */
export function partOf(text, from) {
  const rest = text.slice(from);
  if (Buffer.byteLength(rest) <= PART_BYTES) return { part: rest, next: null };
  let n = Math.min(rest.length, PART_BYTES);
  while (n > 0 && Buffer.byteLength(rest.slice(0, n)) > PART_BYTES) n = Math.floor(n * 0.9);
  // Never between a surrogate pair's halves.
  if (n > 0 && /[\uD800-\uDBFF]/.test(rest[n - 1])) n -= 1;
  const nl = rest.lastIndexOf("\n", n - 1);
  if (nl >= Math.floor(n * 0.75)) n = nl + 1;
  return { part: rest.slice(0, n), next: from + n };
}

/**
 * @param {{ notes: TaskNotes | null, fileFrom?: ((chainId: string, path: string) => FileGot) | null, pictureFrom?: ((chainId: string, name: string) => PictureGot) | null }} deps
 *   `notes`: the store, null where Filament keeps none; `fileFrom`: a file to keep, by its path, from where the chat's
 *   agent may read; `pictureFrom`: a picture one of the chat's agents drew, by its name, its code whole
 */
export function createGraphNotes({ notes, fileFrom = null, pictureFrom = null }) {
  const on = !!notes?.on;
  /** @param {NotesAsk} a */
  const behind = (a) => (a.task ? `behind ${a.task}` : "behind the graph itself");
  /** @param {NotesAsk} a */
  const who = (a) => (a.task ? `Task ${a.task}` : "The graph itself");
  /** How to read what a task keeps. @param {NotesAsk} a */
  const readHow = (a) => `tasks read${a.task ? ` with id ${a.task}` : ""}`;
  /** What the task keeps now, in a line. @param {string} chainId @param {NotesAsk} a */
  const holds = (chainId, a) => {
    const l = /** @type {TaskNotes} */ (notes).list(chainId, a.graph, a.task);
    return l.notes.length || l.files.length ? `${who(a)} keeps ${countWords({ notes: l.notes.length, files: l.files.length })} now: ${readHow(a)} lists them.` : `${who(a)} keeps nothing now.`;
  };

  /** @param {string} chainId @param {NotesAsk} a @param {string} by @returns {NotesAnswer} */
  const keep = (chainId, a, by) => {
    const s = /** @type {TaskNotes} */ (notes);
    /** @type {string[]} */
    const did = [];
    /** @type {string[]} */
    const not = [];
    for (const key of a.forget) {
      const gone = s.forget(chainId, a.graph, a.task, key);
      if (gone) did.push(`forgot the ${gone} ${gone === "note" ? `"${key}"` : key}`);
      else not.push(`${key}: no note or file of that name is kept ${behind(a)}`);
    }
    if (a.text !== null) {
      const r = s.keepNote(chainId, a.graph, a.task, { title: a.title, text: a.text, by });
      if (r.ok) did.push(`kept the note "${a.title}", ${chars(a.text.length)}${r.replaced === null ? "" : ` — in place of the one of that title, ${chars(r.replaced)}`}`);
      else not.push(`the note "${a.title}": ${r.error}`);
    }
    for (const path of a.files) {
      const f = fileFrom ? fileFrom(chainId, path) : { ok: /** @type {const} */ (false), error: "Filament reads no file to keep here" };
      if (!f.ok) {
        not.push(`${path}: ${f.error}`);
        continue;
      }
      const r = s.keepFile(chainId, a.graph, a.task, { name: f.name, data: f.data, by });
      if (r.ok) did.push(`kept the file ${r.name}, ${sizeWords(f.data.length)}${r.replaced === null ? "" : ` — in place of the one of that name, ${sizeWords(r.replaced)}`}`);
      else not.push(`${path}: ${r.error}`);
    }
    if (a.picture) {
      const p = pictureFrom ? pictureFrom(chainId, a.picture) : { ok: /** @type {const} */ (false), error: "Filament reads no picture here" };
      if (!p.ok) not.push(`the picture ${a.picture}: ${p.error}`);
      else {
        const data = Buffer.from(p.code, "utf8");
        const r = s.keepFile(chainId, a.graph, a.task, { name: `${p.name}.html`, data, by });
        if (r.ok) did.push(`kept the picture ${a.picture}'s code as the file ${r.name}, ${sizeWords(data.length)}${r.replaced === null ? "" : ` — in place of the one of that name`}`);
        else not.push(`the picture ${a.picture}: ${r.error}`);
      }
    }
    const lines = (/** @type {string[]} */ l) => l.map((x) => `- ${x}`).join("\n");
    if (!did.length) return { ok: false, error: `Nothing changed ${behind(a)}:\n${lines(not)}\n${holds(chainId, a)}` };
    return { ok: true, text: [`${behind(a)[0].toUpperCase()}${behind(a).slice(1)}:`, lines(did), ...(not.length ? ["Not done:", lines(not)] : []), holds(chainId, a)].join("\n"), kept: true };
  };

  /** @param {string} chainId @param {NotesAsk} a @returns {NotesAnswer} */
  const list = (chainId, a) => {
    const s = /** @type {TaskNotes} */ (notes);
    const l = s.list(chainId, a.graph, a.task);
    const counts = s.counts(chainId, a.graph);
    const elsewhere = Object.entries(counts)
      .filter(([id]) => id !== (a.task || ""))
      .map(([id, c]) => `${id || "the graph itself"} (${countWords(c)})`);
    const also = elsewhere.length ? `Kept elsewhere in this graph: ${elsewhere.join(", ")}.` : "";
    if (!l.notes.length && !l.files.length) return { ok: true, text: [`Nothing is kept ${behind(a)} yet: tasks keep keeps a note there — title and text — or files, or a picture by its name.`, also].filter(Boolean).join("\n"), kept: false };
    const out = [`Kept ${behind(a)}: ${countWords({ notes: l.notes.length, files: l.files.length })}.`];
    if (l.notes.length) out.push("Notes:", ...l.notes.map((n) => `- "${n.title}" — ${chars(n.chars)}, kept ${when(n.at)} by ${n.by}${n.first ? `: ${n.first}` : ""}`));
    if (l.files.length) out.push("Files:", ...l.files.map((x) => `- ${x.name} — ${sizeWords(x.bytes)}, kept ${when(x.at)} by ${x.by}`));
    out.push(`Read one: ${readHow(a)} and its title — a note's, or a file's name.`);
    if (also) out.push(also);
    return { ok: true, text: out.join("\n"), kept: false };
  };

  /** A long text in parts, said where the next starts. @param {NotesAsk} a @param {string} head @param {string} text */
  const parted = (a, head, text) => {
    if (a.from > text.length) return /** @type {NotesAnswer} */ ({ ok: false, error: `from is ${a.from.toLocaleString("en-US")}: it is ${chars(text.length)} long` });
    const { part, next } = partOf(text, a.from);
    const span = a.from > 0 || next !== null ? ` — characters ${(a.from + 1).toLocaleString("en-US")}–${(a.from + part.length).toLocaleString("en-US")} of ${text.length.toLocaleString("en-US")}` : "";
    const on = next === null ? "" : `\n\n[Filament: more follows — ${readHow(a)}, title "${a.title}" and from ${next} reads the next part]`;
    return /** @type {NotesAnswer} */ ({ ok: true, text: `${head}${span}:\n\n${part}${on}`, kept: false });
  };

  /** @param {string} chainId @param {NotesAsk} a @returns {NotesAnswer} */
  const read = (chainId, a) => {
    const s = /** @type {TaskNotes} */ (notes);
    if (!a.title) return list(chainId, a);
    const n = s.note(chainId, a.graph, a.task, a.title);
    if (n) return parted(a, `The note "${n.title}" ${behind(a)}, ${chars(n.chars)}, kept ${when(n.at)} by ${n.by}`, n.text);
    const f = s.file(chainId, a.graph, a.task, a.title);
    if (!f) {
      const l = s.list(chainId, a.graph, a.task);
      const names = [...l.notes.map((x) => `"${x.title}"`), ...l.files.map((x) => x.name)];
      return { ok: false, error: `${who(a)} keeps no note titled "${a.title}" and no file of that name: ${names.length ? `it keeps ${names.join(", ")}` : "it keeps nothing yet"}.` };
    }
    /** @type {Buffer} */
    let data;
    try {
      data = readFileSync(f.path);
    } catch (/** @type {any} */ e) {
      return { ok: false, error: `the file ${f.name} could not be read (${e?.code || e?.message || e})` };
    }
    const head = `The file ${f.name} ${behind(a)}, ${sizeWords(data.length)}, kept ${when(f.at)} by ${f.by}`;
    const type = imageTypeOf(data);
    if (type && a.from === 0) {
      if (data.length > IMAGE_MAX_BYTES) return { ok: true, text: `${head}: an image (${type}) past the ${sizeWords(IMAGE_MAX_BYTES)} one picture may be, so it is not shown — it is kept at ${f.path}.`, kept: false };
      return { ok: true, text: `${head}: an image (${type}), shown with this answer.`, media: [imageBlock(type, data.toString("base64"))], kept: false };
    }
    if (!type && isText(data)) return parted(a, head, data.toString("utf8"));
    return { ok: true, text: `${head}: ${type ? `an image (${type}), read whole or not at all` : "neither text nor an image"} — it is kept at ${f.path}.`, kept: false };
  };

  return {
    /** Whether anything can be kept: a store with a folder of its own. */
    on,
    /**
     * A keep or a read, as `applyTasks` checked it, with who asked (`by`): the store's answer in words, and an image
     * beside them where a read opens one.
     * @param {string} chainId @param {NotesAsk} a @param {string} by @returns {NotesAnswer}
     */
    call(chainId, a, by) {
      if (!on) return { ok: false, error: "This Filament keeps no notes behind its tasks: it runs with no folder of its own to keep them in." };
      try {
        return a.kind === "read" ? read(chainId, a) : keep(chainId, a, by);
      } catch (/** @type {any} */ e) {
        return { ok: false, error: `the notes ${behind(a)} could not be ${a.kind === "read" ? "read" : "kept"} (${e?.message || e})` };
      }
    },
    /**
     * The lines of what is kept behind a graph's tasks that hold every word of a find (the owner's plan mode of 11-06):
     * behind the one task it names, else behind the graph itself and then each task in `order` — notes, then text files
     * up to 2 MB — FIND_HITS at most, `more` where there were more. None where Filament keeps none.
     * @param {string} chainId @param {NotesAsk} a @param {readonly string[]} order the graph's task ids, in its order
     * @returns {{ hits: import("../../core/task-graph.js").KeptHit[], more: boolean }}
     */
    hits(chainId, a, order) {
      /** @type {import("../../core/task-graph.js").KeptHit[]} */
      const hits = [];
      const words = a.words || [];
      if (!on || !words.length) return { hits, more: false };
      const s = /** @type {TaskNotes} */ (notes);
      /** Each line of a text that holds the words, where it starts; false once the hits are full. @param {string} task @param {"note" | "file"} kind @param {string} title @param {string} text */
      const take = (task, kind, title, text) => {
        let from = 0;
        let line = 0;
        for (const l of text.split("\n")) {
          line += 1;
          if (holdsAll(l, words)) {
            if (hits.length >= FIND_HITS) return false;
            hits.push({ task, kind, title, line, from, text: foundLine(l, words) });
          }
          from += l.length + 1;
        }
        return true;
      };
      try {
        const counts = s.counts(chainId, a.graph);
        const keys = (a.task !== null ? [a.task] : ["", ...order]).filter((k) => counts[k]);
        for (const k of keys) {
          const task = k || null;
          const l = s.list(chainId, a.graph, task);
          for (const n of l.notes) {
            const got = s.note(chainId, a.graph, task, n.title);
            if (got && !take(k, "note", got.title, got.text)) return { hits, more: true };
          }
          for (const x of l.files) {
            const f = s.file(chainId, a.graph, task, x.name);
            if (!f || f.bytes > FIND_FILE_BYTES) continue;
            /** @type {Buffer} */
            let data;
            try {
              data = readFileSync(f.path);
            } catch {
              continue;
            }
            if (imageTypeOf(data) || !isText(data)) continue;
            if (!take(k, "file", f.name, data.toString("utf8"))) return { hits, more: true };
          }
        }
      } catch {
        // What could not be read is passed over: the rest of the answer stands.
      }
      return { hits, more: false };
    },
    /**
     * A note's words whole, by its title, behind a task of a graph (E41 P1: a checkpoint, for "Where you are" and a
     * resume) — null where it is not kept, or Filament keeps none.
     * @param {string} chainId @param {{ startedAt: number }} graph @param {string | null} task @param {string} title
     * @returns {string | null}
     */
    noteText(chainId, graph, task, title) {
      if (!on) return null;
      try {
        return /** @type {TaskNotes} */ (notes).note(chainId, graph.startedAt, task, title)?.text ?? null;
      } catch {
        return null;
      }
    },
    /**
     * What a graph keeps, into the chat its plan was carried to (the owner's plan mode of 11-06, piece E): how many files.
     * @param {string} from @param {string} to @param {number} startedAt
     */
    copy(from, to, startedAt) {
      return on ? /** @type {TaskNotes} */ (notes).copy(from, to, startedAt) : 0;
    },
    /**
     * What is kept behind each task of a graph, for its words and its page (E33, TN-D6): by its id, the graph's own
     * under ""; null where Filament keeps none.
     * @param {string} chainId @param {{ startedAt: number } | null | undefined} graph
     * @returns {import("../../core/task-graph.js").Kept | null}
     */
    kept(chainId, graph) {
      if (!on || !graph) return null;
      try {
        const c = /** @type {TaskNotes} */ (notes).counts(chainId, graph.startedAt);
        return Object.keys(c).length ? c : null;
      } catch {
        return null;
      }
    },
  };
}

/** @typedef {ReturnType<typeof createGraphNotes>} GraphNotes */

/** Why a folder is none the agent may read from, by `folderVerdict`'s word. */
const FOLDER_WHY = Object.freeze({
  empty: "an empty path",
  missing: "its folder does not exist on this machine",
  outside: "it is outside this chat's folder and under no folder agentLoop.roots lists",
  exposed: "agentLoop.roots is empty while Filament listens beyond this machine, so only this chat's folder is read from",
});

/**
 * Where a file to keep may come from, and a picture by its name (E33, TN-D4, TN-D5), for `createGraphNotes`. A chat
 * another machine's agents started keeps what their fence lets them reach (x-keep, after the review of cp-root): without
 * Full control, a file in the chat's own folder alone, never in a credentials folder there nor named by another name
 * (`fileRefusal`, http/admin/remote.js `agentFileRefusal`), whatever agentLoop.roots lists; with it, what the person's
 * chat keeps but in Filament's data folder.
 * @param {{ config: { get: () => any }, dataDir?: string | null, folderOf: (chainId: string) => string | null, agentsChat?: (chainId: string) => "fenced" | "full" | null, fileRefusal?: (folder: string, path: string) => string, picture: (chainId: string, name: string) => any, ownPictures: (chainId: string) => { id: string, title: string, at: number, code: () => string | null }[] }} o
 *   `folderOf`: the chat's folder; `agentsChat`: whether another machine's agents started the chat, and with Full
 *   control; `picture`: the registry's picture of one of the chat's agents, by its name; `ownPictures`: the pictures the
 *   chat's own turns drew, newest first, each read when asked
 * @returns {{ fileFrom: (chainId: string, path: string) => FileGot, pictureFrom: (chainId: string, name: string) => PictureGot }}
 */
export function graphNoteSources({ config, dataDir = null, folderOf, agentsChat = () => null, fileRefusal = () => "", picture, ownPictures }) {
  /** @param {string} p */
  const real = (p) => {
    try {
      return realpathSync.native(p);
    } catch {
      return resolve(p);
    }
  };
  /** @param {string} file @param {string} folder */
  const inside = (file, folder) => {
    const r = relative(real(folder), real(file));
    return !!r && !r.startsWith("..") && !isAbsolute(r);
  };
  return {
    fileFrom(chainId, path) {
      const raw = String(path || "").trim();
      if (!raw) return { ok: false, error: "an empty path" };
      const folder = folderOf(chainId);
      const abs = isAbsolute(raw) ? resolve(raw) : folder ? resolve(folder, raw) : null;
      if (!abs) return { ok: false, error: "a path relative to no folder: this chat has none, so give it whole" };
      // Judged before the disk is asked of it: whether a file is there outside their reach is not said.
      const fence = agentsChat(chainId);
      if (fence === "fenced") {
        if (!(folder && inside(abs, folder))) return { ok: false, error: "another machine's agents keep files from their chat's folder alone" };
        const no = fileRefusal(folder, raw);
        if (no) return { ok: false, error: no };
      }
      if (fence === "full" && dataDir && (real(abs) === real(dataDir) || inside(abs, dataDir))) return { ok: false, error: "another machine's agents never keep a file from Filament's data folder" };
      /** @type {import("node:fs").Stats} */
      let st;
      try {
        st = statSync(abs);
      } catch {
        return { ok: false, error: `no such file (${abs})` };
      }
      if (st.isDirectory()) return { ok: false, error: "a folder: name the files in it to keep" };
      if (!st.isFile()) return { ok: false, error: "not a file" };
      if (st.size > NOTES_LIMITS.fileBytes) return { ok: false, error: `${sizeWords(st.size)}: a file kept here is ${sizeWords(NOTES_LIMITS.fileBytes)} at most` };
      if (fence !== "fenced" && !(folder && inside(abs, folder))) {
        const v = folderVerdict(config.get(), dirname(abs));
        if (!v.ok) return { ok: false, error: FOLDER_WHY[/** @type {keyof typeof FOLDER_WHY} */ (v.why)] || "it is outside the folders the agent may read" };
      }
      try {
        return { ok: true, name: basename(abs), data: readFileSync(abs) };
      } catch (/** @type {any} */ e) {
        return { ok: false, error: `it could not be read (${e?.code || e?.message || e})` };
      }
    },
    pictureFrom(chainId, name) {
      const want = String(name || "").trim();
      const p = picture(chainId, want);
      // Kept under its name, as its agent's report gives it.
      if (p?.found && typeof p.found.code === "string") return { ok: true, name: String(p.found.title || p.found.id || want), code: p.found.code };
      const low = want.toLowerCase();
      const own = ownPictures(chainId).find((x) => x.id === want || x.title.toLowerCase() === low || x.id.toLowerCase() === low) || null;
      const code = own ? own.code() : null;
      if (own && typeof code === "string") return { ok: true, name: own.title || own.id, code };
      if (p?.gone || own) return { ok: false, error: "it is no longer kept with this chat" };
      const names = [...(p?.names || []).map((/** @type {any} */ x) => String(x.title || x.id)), ...ownPictures(chainId).map((x) => x.title || x.id)];
      return { ok: false, error: `no picture of that name was drawn in this chat${names.length ? ` — its pictures: ${[...new Set(names)].slice(0, 12).join(", ")}` : ""}` };
    },
  };
}
