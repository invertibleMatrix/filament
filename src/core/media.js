// @ts-check
// Images a tool shows the model (HarnessV3-Tools TL-D17): what `read` and an MCP tool hand the loop beside their text.
// The four types every provider Filament speaks takes, known by their first bytes (a name can lie), and the size one
// image may have. And the pictures, PDFs and files a request carries in base64, within the room one request has
// (`mediaIn`, `mediaPast`): the newest go whole, and an older one past the room is left out of that request, never out
// of the chat.

/** Anthropic takes 5 MB of base64 per image: 3.75 MB of file. */
export const IMAGE_MAX_BYTES = 3_932_160;

/**
 * The most base64 of pictures, PDFs and files one request to a provider carries: Anthropic takes 32 MB a request, and
 * the rest is room for its words — a window of a million tokens is about 4 MB of them.
 */
export const MEDIA_BYTES = 24 * 1024 * 1024;

/** @param {Uint8Array} b @param {number} from @param {number} to */
const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, to));

/**
 * The four picture types in words, the one place they are said: `read`'s line naming a picture, a left-out picture's
 * words, and a kept picture's entry (services/run-images.js), which the harness's cards show as it comes.
 * @type {Readonly<Record<string, string>>}
 */
export const IMAGE_LABELS = Object.freeze({ "image/png": "PNG", "image/jpeg": "JPEG", "image/gif": "GIF", "image/webp": "WebP" });

/**
 * The image type a file's first bytes say, or null: PNG, JPEG, GIF or WebP.
 * @param {Uint8Array} b
 * @returns {"image/png" | "image/jpeg" | "image/gif" | "image/webp" | null}
 */
export function imageTypeOf(b) {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "image/gif";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** @typedef {{ name: string, mediaType: string, data: string }} SteerImage  one picture a message into a running turn carries: its file name, type and base64 */

/** An Anthropic image block. @param {string} mediaType @param {string} base64 */
export const imageBlock = (mediaType, base64) => ({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } });
/**
 * The pictures a message's blocks carry, in order, as a launch takes them — the agents and teams the message names get
 * them with it (the owner's list of 10-19: "pictures in the message reach the named agents"). A block names no file, so
 * each is named by its place. @param {unknown} content @returns {{ name: string, mediaType: string, data: string }[]}
 */
export const picturesOf = (content) =>
  (Array.isArray(content) ? content : [])
    .filter((b) => b?.type === "image" && b.source?.type === "base64" && typeof b.source.data === "string" && b.source.data)
    .map((b, i) => ({ name: `picture ${i + 1}`, mediaType: String(b.source.media_type || "image/png"), data: String(b.source.data) }));

/** A size in words: "812 bytes", "312 KB", "4.2 MB". @param {number} bytes */
export const sizeWords = (bytes) =>
  bytes < 1024 ? `${bytes} bytes` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

/**
 * The pictures in a tool's result, whatever shape its engine gave them in (HarnessV4_Tasks U9): an Anthropic block
 * (`source.base64`), an MCP or ACP image block (`data`), ACP's content wrapper around one (`{ type: "content",
 * content }`), or a file an agent looked at (`path`: Codex's imageView). Words, an address on another site (never
 * fetched) and anything else are left out. Their type is not taken from the block: the bytes say it where they are kept.
 * @param {unknown} content  a block or a list of them
 * @returns {({ data: string } | { path: string })[]}
 */
export function picturesIn(content) {
  /** @type {({ data: string } | { path: string })[]} */
  const out = [];
  for (const raw of Array.isArray(content) ? content : content ? [content] : []) {
    const b = /** @type {any} */ (raw)?.type === "content" ? /** @type {any} */ (raw).content : raw;
    if (b?.type !== "image") continue;
    if (b.source?.type === "base64" && typeof b.source.data === "string" && b.source.data) out.push({ data: b.source.data });
    else if (typeof b.data === "string" && b.data) out.push({ data: b.data });
    else if (typeof b.path === "string" && b.path) out.push({ path: b.path });
  }
  return out;
}

/**
 * A tool's result that carries images beside its text. The loop puts the text and then the images in the
 * tool_result; every step that works on a result's words (the guard, a hook, the preview, the cap) takes the text.
 * Wherever only text can go — `delegate_read`'s reader — it is its text.
 */
export class MediaResult {
  /** @param {string} text @param {any[]} media  Anthropic image blocks */
  constructor(text, media) {
    this.text = text;
    this.media = media;
  }
  toString() {
    return this.text;
  }
}

/**
 * A picture, PDF or file a request's messages carry in base64, and where: message `m`, block `b` of its content, and
 * block `t` of a tool result's content where it is one of those (else -1). `bytes`: its base64's length, as it goes on
 * the wire; `name`: a document's title or a file's name, where it has one (a picture's block names none).
 * @typedef {{ m: number, b: number, t: number, block: any, kind: "picture" | "pdf" | "file", type: string, name: string | null, bytes: number }} MediaPlace
 */

/** A data: address's media type. @param {string} url */
const dataType = (url) => /^data:([^;,]*)/.exec(url)?.[1] || "";

/**
 * A block as media: an Anthropic picture or document in base64, an OpenAI client's picture or file as a data: address.
 * A picture at an address on another site carries no bytes, and is none.
 * @param {any} b @returns {Pick<MediaPlace, "kind" | "type" | "name" | "bytes"> | null}
 */
function mediaOf(b) {
  if ((b?.type === "image" || b?.type === "document") && b.source?.type === "base64" && typeof b.source.data === "string") {
    const type = String(b.source.media_type || "");
    const name = b.type === "document" && b.title ? String(b.title) : null;
    return { kind: b.type === "image" ? "picture" : type === "application/pdf" ? "pdf" : "file", type, name, bytes: b.source.data.length };
  }
  const url = b?.type === "image_url" ? String(b.image_url?.url || "") : "";
  if (url.startsWith("data:")) return { kind: "picture", type: dataType(url), name: null, bytes: url.length };
  const file = b?.type === "file" ? String(b.file?.file_data || "") : "";
  if (file.startsWith("data:")) return { kind: "file", type: dataType(file), name: b.file?.filename ? String(b.file.filename) : null, bytes: file.length };
  return null;
}

/**
 * The media a request's messages carry, oldest first: each message's blocks in order, a tool result's own in its place.
 * @param {any} body @returns {MediaPlace[]}
 */
export function mediaIn(body) {
  /** @type {MediaPlace[]} */
  const out = [];
  (Array.isArray(body?.messages) ? body.messages : []).forEach((/** @type {any} */ msg, /** @type {number} */ m) => {
    if (!Array.isArray(msg?.content)) return;
    msg.content.forEach((/** @type {any} */ block, /** @type {number} */ b) => {
      const own = mediaOf(block);
      if (own) return void out.push({ m, b, t: -1, block, ...own });
      if (block?.type === "tool_result" && Array.isArray(block.content))
        block.content.forEach((/** @type {any} */ inner, /** @type {number} */ t) => {
          const got = mediaOf(inner);
          if (got) out.push({ m, b, t, block: inner, ...got });
        });
    });
  });
  return out;
}

/**
 * Where a request's things past its room end, counted from the oldest: none (0) while `total` is within `room`, else a
 * line that moves in steps of a third of the room — what is kept after it is between two thirds of the room and all of
 * it, and the line holds while the newer things grow by less than a step: a chat's requests change there once a step,
 * not at each new thing, and the provider's cache of the prompt before it holds.
 * @param {number} total @param {number} room
 */
export function stepLine(total, room) {
  if (total <= room) return 0;
  const step = Math.max(1, Math.floor(room / 3));
  return Math.ceil((total - room) / step) * step;
}

/**
 * Which media go past `bytes` (places of `mediaIn`'s list): the oldest, those that begin before the line (`stepLine`),
 * never the newest message's, which go as they are however much they are.
 * @param {MediaPlace[]} places @param {number} bytes @param {number} newest  the newest message's index
 * @returns {Set<MediaPlace>}
 */
export function mediaPast(places, bytes, newest) {
  /** @type {Set<MediaPlace>} */
  const past = new Set();
  const line = stepLine(places.reduce((n, p) => n + p.bytes, 0), bytes);
  let from = 0;
  for (const p of places) {
    if (p.m !== newest && from < line) past.add(p);
    from += p.bytes;
  }
  return past;
}

/**
 * What a request says in a picture's or a file's place where it is left out of it: what it was, as far as its block
 * says, and its file's size.
 * @param {MediaPlace} p
 */
export function leftOutWords(p) {
  const what = p.kind === "picture" ? "picture" : p.kind === "pdf" ? "PDF" : "file";
  const size = sizeWords(Math.floor((p.bytes * 3) / 4));
  const facts = [p.kind === "picture" ? IMAGE_LABELS[p.type] : "", size].filter(Boolean).join(", ");
  return `[An earlier ${what}${p.name ? `, ${p.name} (${facts}),` : ` (${facts})`} is left out of this request to keep it within the size limit; it is still in the chat.]`;
}

/**
 * The body with blocks in places of `mediaIn`'s list: each a text, set apart by a blank line from the blocks around it,
 * which a wire may join into one text, and with the cache mark the block it stands for had. A copy; the body itself
 * where there is nothing to put.
 * @param {any} body @param {Map<MediaPlace, string>} put
 */
export function withTexts(body, put) {
  if (!put.size) return body;
  /** A list of blocks with texts in some of its places. @param {any[]} list @param {Map<number, string>} at */
  const into = (list, at) =>
    list.map((block, i) => {
      const text = at.get(i);
      if (text == null) return block;
      const before = i > 0 && !at.has(i - 1) ? "\n\n" : "";
      const after = i < list.length - 1 ? "\n\n" : "";
      return { type: "text", text: `${before}${text}${after}`, ...(block?.cache_control ? { cache_control: block.cache_control } : {}) };
    });
  /** @type {Map<number, MediaPlace[]>} */
  const byMessage = new Map();
  for (const p of put.keys()) byMessage.set(p.m, [...(byMessage.get(p.m) || []), p]);
  /** Texts by their places' index in a list. @param {MediaPlace[]} list @param {(p: MediaPlace) => number} at */
  const textsAt = (list, at) => new Map(list.map((p) => [at(p), /** @type {string} */ (put.get(p))]));
  const messages = body.messages.map((/** @type {any} */ msg, /** @type {number} */ m) => {
    const here = byMessage.get(m);
    if (!here) return msg;
    const content = into(msg.content, textsAt(here.filter((p) => p.t < 0), (p) => p.b)).map((/** @type {any} */ block, /** @type {number} */ b) => {
      const inner = textsAt(here.filter((p) => p.t >= 0 && p.b === b), (p) => p.t);
      return inner.size ? { ...block, content: into(block.content, inner) } : block;
    });
    return { ...msg, content };
  });
  return { ...body, messages };
}
