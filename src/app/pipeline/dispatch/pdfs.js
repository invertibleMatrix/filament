// @ts-check
// A PDF a message carries — a `document` block, its bytes in base64, as the harness's box sends one — as each
// destination takes it. A Claude model on an Anthropic-format upstream reads PDFs, their pages' pictures too: it gets
// them as they are, the newest first, as many as one request takes (NATIVE_PDF_PAGES, NATIVE_PDF_BYTES); an older one
// past that, and one pdftotext cannot read, goes as its text, so a conversation that grows never sends more than a
// request takes. Every other model, and every coding agent, gets each PDF's text in its place, page by page, through
// the pdftotext the `read` hand runs (adapters/tools/pdf.js). A PDF is extracted once by its bytes: every round of a
// turn and every later turn sends it again. The pictures, PDFs and files a request carries stay within the room one
// request has (`mediaWithin`): an older PDF past it goes as its text, an older picture or file as words that name it;
// and an estimate weighs each as the send does (`mediaWeights`).
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFTOTEXT, extractPages } from "../../../adapters/tools/pdf.js";
import { leftOutWords, MEDIA_BYTES, mediaIn, mediaPast, stepLine, withTexts } from "../../../core/media.js";
import { findRoute, findUpstream, renderUpstreamModel, upstreamSupports } from "../../../core/routing.js";
import { parseModelSuffix } from "../../../core/shaping.js";

/** The most pages of PDFs one request to Claude carries (Anthropic's limit); the older ones past it go as their text. */
export const NATIVE_PDF_PAGES = 100;
/** The most base64 of PDFs one request to Claude carries, inside the 32 MB a request may be. */
export const NATIVE_PDF_BYTES = 24 * 1024 * 1024;
/** The most of one PDF's text a message carries; past it, the pages left are named. */
export const PDF_TEXT_CHARS = 200_000;
/** PDFs whose text is kept, the least recently sent dropped first: more than a box holds. */
const KEPT = 32;
/** How long a failure a later try may not meet (pdftotext's time limit, the temporary file) stands before one. */
const AGAIN_MS = 5 * 60_000;
const NO_PDFTOTEXT = "this machine has no pdftotext (Git for Windows ships it; elsewhere it comes with poppler)";

/**
 * A PDF's pages as a message carries them — the leading ones within PDF_TEXT_CHARS, the first cut to it — and how many
 * it has; or why there are none: `none` where this machine has no pdftotext, `again` where a later try may do better.
 * @typedef {{ pages: string[], count: number, firstCut: boolean } | { error: string, none?: boolean, again?: boolean }} Extracted
 */
/** Each PDF's extraction by its bytes, and what it came to once it has (`read`). @type {Map<string, { got: Promise<Extracted>, until: number, read?: Extracted }>} */
const kept = new Map();
/** Each PDF's bytes hashed once, by the block's source that holds them: a PDF sent or weighed again is not hashed again. @type {WeakMap<object, string>} */
const hashes = new WeakMap();

/** A PDF's key among those kept. @param {{ data: string }} source @param {string} pdftotext */
function keyOf(source, pdftotext) {
  let hash = hashes.get(source);
  if (!hash) hashes.set(source, (hash = createHash("sha256").update(source.data).digest("hex")));
  return `${pdftotext}\0${hash}`;
}

/** A block that is a PDF given whole. @param {any} b */
const isPdf = (b) => b?.type === "document" && b.source?.type === "base64" && b.source.media_type === "application/pdf" && typeof b.source.data === "string";

/** Whether an Anthropic-shaped body carries a PDF given whole in any message. @param {any} body */
export const carriesPdf = (body) => Array.isArray(body?.messages) && body.messages.some((/** @type {any} */ m) => Array.isArray(m?.content) && m.content.some(isPdf));

/** A model that reads PDFs as they are: Claude, on the Anthropic wire. @param {string | null | undefined} wire @param {string | null | undefined} model */
export const readsPdfs = (wire, model) => wire === "anthropic" && /claude/i.test(String(model || ""));

/** One page as the text says it. @param {number} i @param {string} text */
const pageText = (i, text) => `[Page ${i + 1}]\n${text}\n`;

/** The pages a message carries of all a PDF has. @param {string[]} all @returns {Extracted} */
export function within(all) {
  /** @type {string[]} */
  const pages = [];
  let size = 0;
  for (const [i, p] of all.entries()) {
    const text = p.trim();
    const one = pageText(i, text).length;
    if (pages.length && size + one > PDF_TEXT_CHARS) break;
    pages.push(text.slice(0, PDF_TEXT_CHARS));
    size += one;
  }
  return { pages, count: all.length, firstCut: all.length > 0 && all[0].trim().length > PDF_TEXT_CHARS };
}

/**
 * A PDF's pages, read from a file of its own in a folder of its own that goes once read; never rejects.
 * @param {string} data  base64 @param {string} pdftotext @returns {Promise<Extracted>}
 */
async function extract(data, pdftotext) {
  /** @type {string | null} */
  let dir = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "filament-pdf-"));
    const file = join(dir, "attached.pdf");
    await writeFile(file, Buffer.from(data, "base64"), { mode: 0o600 });
    try {
      return within(await extractPages(file, { pdftotext }));
    } catch (e) {
      const err = /** @type {any} */ (e);
      return { error: `pdftotext could not read it (${err.message})`, ...(err.code === "ETIMEDOUT" ? { again: true } : {}) };
    }
  } catch (e) {
    return { error: `it could not be written to a temporary file (${/** @type {Error} */ (e).message})`, again: true };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

/**
 * A PDF's pages, extracted once by its bytes. @param {{ data: string }} source  its block's, the bytes in base64
 * @param {string | null} pdftotext @returns {Promise<Extracted>}
 */
function pagesOf(source, pdftotext) {
  if (!pdftotext) return Promise.resolve({ error: NO_PDFTOTEXT, none: true });
  const key = keyOf(source, pdftotext);
  const had = kept.get(key);
  kept.delete(key);
  if (had && had.until > Date.now()) {
    kept.set(key, had);
    return had.got;
  }
  /** @type {{ got: Promise<Extracted>, until: number, read?: Extracted }} */
  const entry = { got: extract(source.data, pdftotext), until: Infinity };
  void entry.got.then((r) => {
    entry.read = r;
    if ("error" in r && r.again) entry.until = Date.now() + AGAIN_MS;
  });
  kept.set(key, entry);
  if (kept.size > KEPT) kept.delete(/** @type {string} */ (kept.keys().next().value));
  return entry.got;
}

/** A size in words. @param {number} n */
export const sizeWords = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`);
/** @param {number} n */
const pagesWords = (n) => `${n} page${n === 1 ? "" : "s"}`;
const CHARS_WORDS = `${PDF_TEXT_CHARS.toLocaleString("en-US")} characters of text`;

/**
 * A PDF as its text, each page under its number, cut at PDF_TEXT_CHARS on a page's edge (a first page past it, inside
 * it) with what is left out named; or, where there is no text to give, why — in words the model can pass on.
 * @param {string} name @param {number} bytes @param {Extracted} got
 */
export function pdfText(name, bytes, got) {
  if ("error" in got) return `[The user attached the PDF "${name}" (${sizeWords(bytes)}), whose text could not be read here: ${got.error}. Ask for its text if you need it.]`;
  const { pages, count, firstCut } = got;
  if (pages.length === count && !pages.some(Boolean))
    return `[The user attached the PDF "${name}" (${sizeWords(bytes)}, ${pagesWords(count)}), which holds no text pdftotext can read — a scan, perhaps. Ask for its text if you need it.]`;
  const out = pages.map((p, i) => pageText(i, p) + (i === 0 && firstCut ? `[Page 1 is cut here, past ${CHARS_WORDS}.]\n` : "")).join("");
  const next = pages.length + 1;
  const left = next > count ? "" : `[${next === count ? `Page ${next} is` : `Pages ${next}–${count} are`} not included here, past ${CHARS_WORDS}.]\n`;
  return `--- Attached file: ${name} (a PDF of ${pagesWords(count)}: its text; its pictures and layout are not included) ---\n${out}${left}--- end of ${name} ---`;
}

/**
 * Which of a request's PDFs a model that reads PDFs gets as their text, oldest first, by what was read of each (`got`;
 * null not read yet, which counts no pages): "unread" for one pdftotext could not read; "room" for one that alone
 * passes NATIVE_PDF_PAGES or NATIVE_PDF_BYTES, and for the oldest past either room — a line that runs from the oldest
 * and moves in steps of a third of the room (core/media.js `stepLine`), so a PDF that went as it is goes so again until
 * the PDFs after it grow by a step, and the provider's cache of the prompt before it holds. Null: as it is. One this
 * machine could not count, with no pdftotext or for a while, counts no pages.
 * @param {{ bytes: number, got: Extracted | null }[]} pdfs
 * @returns {("unread" | "room" | null)[]}
 */
function nativeFates(pdfs) {
  /** @param {Extracted | null} g */
  const pages = (g) => (g && "pages" in g ? g.count : 0);
  /** @param {Extracted | null} g */
  const readable = (g) => !g || "pages" in g || !!g.none || !!g.again;
  /** @param {{ bytes: number, got: Extracted | null }} p */
  const alone = (p) => pages(p.got) > NATIVE_PDF_PAGES || p.bytes > NATIVE_PDF_BYTES;
  const counted = pdfs.filter((p) => readable(p.got) && !alone(p));
  const pageLine = stepLine(counted.reduce((n, p) => n + pages(p.got), 0), NATIVE_PDF_PAGES);
  const byteLine = stepLine(counted.reduce((n, p) => n + p.bytes, 0), NATIVE_PDF_BYTES);
  let fromPages = 0;
  let fromBytes = 0;
  return pdfs.map((p) => {
    if (!readable(p.got)) return "unread";
    if (alone(p)) return "room";
    const past = fromPages < pageLine || fromBytes < byteLine;
    fromPages += pages(p.got);
    fromBytes += p.bytes;
    return past ? "room" : null;
  });
}

/** The PDFs given whole a body's messages carry themselves (a tool result's are left as they are), oldest first. @param {any} body */
const pdfsIn = (body) => mediaIn(body).filter((p) => p.t < 0 && isPdf(p.block));

/**
 * The body as the destination takes it, and a note for the record on each PDF: where the model reads PDFs (`native`),
 * each as it is while the request has room for it (`nativeFates`), and one pdftotext cannot read as words that say
 * so; for any other, each as its text, `why` saying why. The body itself where nothing changes, else a copy; a text in
 * a PDF's place is set apart by a blank line from the blocks around it, which a wire may join into one text.
 * @param {any} body  Anthropic-shaped
 * @param {{ native: boolean, why: string, pdftotext?: string | null }} o
 * @returns {Promise<{ body: any, notes: string[] }>}
 */
export async function pdfsAsSent(body, { native, why, pdftotext = PDFTOTEXT }) {
  if (!carriesPdf(body)) return { body, notes: [] };
  const found = pdfsIn(body);
  const got = await Promise.all(found.map((f) => pagesOf(f.block.source, pdftotext)));
  const fates = native ? nativeFates(found.map((f, k) => ({ bytes: f.bytes, got: got[k] }))) : null;
  /** @type {string[]} */
  const notes = [];
  /** Each PDF's text where it goes as its text. @type {Map<number, string>} */
  const texts = new Map();
  for (const [k, { block }] of found.entries()) {
    const g = got[k];
    const name = String(block.title || "document.pdf");
    const read = "pages" in g ? pagesWords(g.count) : `unread (${g.error})`;
    if (fates) {
      if (!fates[k]) {
        notes.push(`pdf: "${name}" sent as the PDF, ${"pages" in g ? pagesWords(g.count) : "its pages not counted here"}`);
        continue;
      }
      notes.push(`pdf: "${name}" sent as its text, ${read}: ${fates[k] === "room" ? `past the ${NATIVE_PDF_PAGES} pages and ${NATIVE_PDF_BYTES / (1024 * 1024)} MB of PDFs a request carries, the newest first` : "a PDF that cannot be read goes as words that say so"}`);
    } else notes.push(`pdf: "${name}" sent as its text, ${read}: ${why}`);
    texts.set(k, pdfText(name, Math.floor((block.source.data.length * 3) / 4), g));
  }
  if (!texts.size) return { body, notes };
  const messages = body.messages.map((/** @type {any} */ msg, /** @type {number} */ m) => {
    const here = found.map((f, k) => ({ ...f, k })).filter((f) => f.m === m && texts.has(f.k));
    if (!here.length) return msg;
    const content = msg.content.slice();
    for (const { b, k, block } of here) {
      const before = b > 0 && !isPdf(msg.content[b - 1]) ? "\n\n" : "";
      const after = b < content.length - 1 ? "\n\n" : "";
      content[b] = { type: "text", text: `${before}${texts.get(k)}${after}`, ...(block.cache_control ? { cache_control: block.cache_control } : {}) };
    }
    return { ...msg, content };
  });
  return { body: { ...body, messages }, notes };
}

/**
 * What was read of a PDF given whole: its pages, or why there are none — at once where this machine has no pdftotext;
 * null while it is not read yet.
 * @param {any} block @param {string | null} [pdftotext] @returns {Extracted | null}
 */
const readOf = (block, pdftotext = PDFTOTEXT) => (pdftotext ? kept.get(keyOf(block.source, pdftotext))?.read ?? null : { error: NO_PDFTOTEXT, none: true });

/**
 * The words a PDF goes as where it goes as its text — `pdfText`, as `pdfsAsSent` puts it in the PDF's place — once its
 * pages are read (`readPdfs`, or a request that sent it); null before that, and for a block that is no PDF given whole.
 * @param {any} block @param {string | null} [pdftotext] @returns {string | null}
 */
export function pdfWords(block, pdftotext = PDFTOTEXT) {
  if (!isPdf(block)) return null;
  const read = readOf(block, pdftotext);
  return read ? pdfText(String(block.title || "document.pdf"), Math.floor((block.source.data.length * 3) / 4), read) : null;
}

/**
 * The PDFs a body's messages carry, each one's pages read once by its bytes, so `pdfWords` can say what it goes as and
 * the room a model that reads PDFs has counts its pages.
 * @param {any} body @param {string | null} [pdftotext] @returns {Promise<void>}
 */
export async function readPdfs(body, pdftotext = PDFTOTEXT) {
  await Promise.all(pdfsIn(body).map((p) => pagesOf(p.block.source, pdftotext)));
}

/**
 * Whether a model's route takes a PDF as it is (Claude on the Anthropic wire) or as its text; null where no route
 * reaches the model. Its format is the route's own, else Anthropic's where the upstream speaks it, as plan.js picks for
 * the Anthropic-shaped body a chat sends; the agent loop runs a model through the same routes as its bare name.
 * @param {any} cfg @param {string} model @returns {boolean | null}
 */
function readsPdfsAt(cfg, model) {
  const name = String(model || "").replace(/^agent\//, "");
  const base = parseModelSuffix(name, cfg?.rules).base;
  const r = findRoute(cfg, base) || findRoute(cfg, name);
  const up = r && findUpstream(cfg, r.upstream);
  if (!r || !up) return null;
  const format = r.format && r.format !== "auto" ? r.format : upstreamSupports(up, "anthropic") ? "anthropic" : "openai";
  return readsPdfs(format, renderUpstreamModel(r.upstreamModel, base, r.captures || []) || base);
}

/**
 * How an estimate weighs the pictures, PDFs and files of a request on its way to a model (core/tokens.js `media`): as
 * the send decides for the request as a whole — `mediaWithin` with the room a request has (MEDIA_BYTES), then
 * `pdfsAsSent` — a picture or file past the room as the words in its place (`leftOutWords`), a PDF that goes as its
 * text as that text once its pages are read (`pdfWords`); the rest at their own rates, a PDF Claude reads by its size
 * (Filament keeps no figure for what a page of one costs). Made for the messages a request carries and asked of any part
 * of them, so a part weighs what the whole request sends of it. Null where no route reaches the model.
 * @param {any} cfg @param {string} model
 * @returns {((messages: any[]) => (block: any) => string | null) | null}
 */
export function mediaWeights(cfg, model) {
  const native = readsPdfsAt(cfg, model);
  if (native == null) return null;
  return (messages) => {
    const body = { messages: Array.isArray(messages) ? messages : [] };
    const all = mediaIn(body);
    const past = mediaPast(all.filter((p) => native || p.t >= 0 || !isPdf(p.block)), MEDIA_BYTES, body.messages.length - 1);
    /** What a block goes as, where it goes as words. @type {Map<any, string | null>} */
    const words = new Map([...past].map((p) => [p.block, isPdf(p.block) ? pdfWords(p.block) : leftOutWords(p)]));
    const pdfs = all.filter((p) => p.t < 0 && isPdf(p.block) && !words.has(p.block));
    const fates = native ? nativeFates(pdfs.map((p) => ({ bytes: p.bytes, got: readOf(p.block) }))) : null;
    pdfs.forEach((p, k) => void ((!fates || fates[k]) && words.set(p.block, pdfWords(p.block))));
    return (block) => words.get(block) ?? null;
  };
}

/** How many of a kind, in words: "a picture", "3 pictures". @param {number} n @param {string} one */
const countWords = (n, one) => (n === 1 ? `a ${one}` : `${n} ${one}s`);

/**
 * The body within `bytes` of pictures, PDFs and files (core/media.js `mediaPast`), and notes for the record: the newest
 * go whole, the newest message's all; an older PDF past the room goes as its text, as one past the PDFs' room does, and
 * an older picture or file as words that name it. `pdfs`: whether the PDFs the messages carry go as they are, and so
 * take room — where each goes as its text (`pdfsAsSent` for a model that reads none), it takes none and is left to
 * that. `why`: the room in words, after "past". The body itself where nothing is past the room, else a copy.
 * @param {any} body
 * @param {{ bytes: number, pdfs: boolean, why: string, pdftotext?: string | null }} o
 * @returns {Promise<{ body: any, notes: string[] }>}
 */
export async function mediaWithin(body, { bytes, pdfs, why, pdftotext = PDFTOTEXT }) {
  const places = mediaIn(body).filter((p) => pdfs || p.t >= 0 || !isPdf(p.block));
  const past = mediaPast(places, bytes, (Array.isArray(body?.messages) ? body.messages.length : 0) - 1);
  if (!past.size) return { body, notes: [] };
  const docs = [...past].filter((p) => isPdf(p.block));
  const got = await Promise.all(docs.map((p) => pagesOf(p.block.source, pdftotext)));
  /** @type {Map<import("../../../core/media.js").MediaPlace, string>} */
  const put = new Map();
  /** @type {string[]} */
  const notes = [];
  docs.forEach((p, k) => {
    const name = String(p.block.title || "document.pdf");
    const g = got[k];
    put.set(p, pdfText(name, Math.floor((p.bytes * 3) / 4), g));
    notes.push(`pdf: "${name}" sent as its text, ${"pages" in g ? pagesWords(g.count) : `unread (${g.error})`}: past ${why}`);
  });
  const rest = [...past].filter((p) => !isPdf(p.block));
  for (const p of rest) put.set(p, leftOutWords(p));
  if (rest.length) {
    const pictures = rest.filter((p) => p.kind === "picture").length;
    const what = [pictures ? countWords(pictures, "picture") : "", rest.length - pictures ? countWords(rest.length - pictures, "file") : ""].filter(Boolean).join(" and ");
    const size = sizeWords(Math.floor((rest.reduce((n, p) => n + p.bytes, 0) * 3) / 4));
    notes.push(`media: ${what} (${size}) left out of the request, past ${why}; each is named in its place, and is still in the chat`);
  }
  return { body: withTexts(body, put), notes };
}
