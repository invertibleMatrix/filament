// @ts-check
// What a main agent hands its sub-agent with a launch or a follow-up (`attach`, the owner's of 11-17: a picture the
// person sent reached no sub-agent, and a file reached one only as a path it read a page at a time): each item a path
// or `picture N`, read here once at the call — on the main agent's side, so a worktree's copy need not hold the file —
// and the call refused whole, in words, before anything is sent. An attachment gives a sub-agent nothing its own read
// of that file would not have given it: the caller's judge says where its main agent may read (the session's read
// rules, its folder's fence: `readJudge`), and its redaction runs over the text. Some places are kept from attachments
// whoever asks — Filament's data folder, a repository's own .git, a secret's file, a credentials folder, a private key
// — since what is attached leaves for another conversation, maybe another machine.
import { readFile, realpath, stat, open } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { IMAGE_LABELS, IMAGE_MAX_BYTES, imageTypeOf, sizeWords } from "../../core/media.js";
import { credentialFolderOf, privateKeyIn, secretFileOf } from "../../core/secret-files.js";
import { inGitFolder, resolveInside } from "../../adapters/tools/fs-fence.js";
import { asksFirst, describeRule, ruleFor } from "./rules.js";

/**
 * What one call hands on: its items; each picture, as the read tool takes one; the pictures' base64 together, under the
 * 24 MB of media one request carries (core/media.js `MEDIA_BYTES`), whose newest message is never trimmed, with room
 * for the conversation; the text together, after redaction, as a handed view is held (subagents.js `VIEW_CHARS`).
 */
export const ATTACH_LIMITS = Object.freeze({ items: 8, pictureBytes: IMAGE_MAX_BYTES, picturesBase64: 20 * 1024 * 1024, textChars: 200_000 });

/** A picture the person sent this turn, in the order the main agent heard them. @typedef {{ mediaType: string, data: string }} TurnPicture */
/**
 * What the caller hands: where its main agent may read (`readJudge`: the path whole, or throws why not), how its text is
 * redacted, the person's pictures of this turn (null where the turn cannot tell which is which), the folders it reads
 * (its own and those added to it) and Filament's data folder.
 * @typedef {{ judge: (path: string) => string, redact?: ((text: string) => string) | null, pictures?: () => TurnPicture[] | null, folders?: readonly string[], dataDir?: string | null }} AttachFrom
 */
/**
 * What is handed on: the pictures, for the launch's `images` (subagents.js `withPictures`); the text files, each a block
 * after the brief (`fileBlocks`); the line the call's answer says.
 * @typedef {{ images: { name: string, mediaType: string, data: string }[], files: { name: string, text: string }[], said: string }} Attached
 */

/**
 * Where a main agent may read, as its own read is judged: the session's read rules — a deny refuses, and so does an ask
 * or a review, since an attachment asks nobody (app/sessions/reattach.js `bringBack` judges so), the path as named, whole
 * in either separator, and from its folder in either where it lies in it (as core/read-rules.js `keptOut` tries), since a
 * rule matches a path as it is spelled —, then its folder's fence (fs-fence.js `resolveInside`), as the loop's read tool
 * or a coding agent's read in another machine's agents' chat (agent-permits.js `readPast`) keep to it. → the path whole;
 * throws the refusal's words.
 * @param {{ root: string, rules: readonly import("./rules.js").Rule[], fenced: boolean, reads?: readonly string[], theirs?: boolean }} o
 * @returns {(path: string) => string}
 */
export const readJudge = ({ root, rules, fenced, reads = [], theirs = false }) => (path) => {
  const whole = resolveInside(root, path, { fenced: false });
  const rel = root && within(whole, resolve(root)) ? relative(root, whole) : "";
  const spelled = [path, whole, whole.split(sep).join("/"), ...(rel ? [rel.split(sep).join("/"), rel.split(sep).join("\\")] : [])];
  for (const p of new Set(spelled)) {
    const hit = ruleFor(rules, "read", { path: p });
    if (hit?.verdict === "deny") throw new Error(`this session's rules refuse reading it (rule ${describeRule(hit.rule)})`);
    if (hit && asksFirst(hit)) throw new Error(`this session's rules ask before it is read (rule ${describeRule(hit.rule)}), and an attachment asks nobody`);
  }
  return resolveInside(root, path, { fenced, reads: [...reads], theirs });
};

/**
 * The pictures of a request's newest user message, in order: its own blocks — an Anthropic base64 image, an OpenAI
 * `data:` address —, never a tool's result's. The person's message of a turn, where the turn is a chat's.
 * @param {any} body @returns {TurnPicture[]}
 */
export function openingPictures(body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const last = msgs.findLast((/** @type {any} */ m) => m?.role === "user");
  /** @type {TurnPicture[]} */
  const out = [];
  for (const b of Array.isArray(last?.content) ? last.content : []) {
    if (b?.type === "image" && b.source?.type === "base64" && typeof b.source.data === "string" && b.source.data) out.push({ mediaType: String(b.source.media_type || "image/png"), data: b.source.data });
    else if (b?.type === "image_url") {
      const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(b.image_url?.url || ""));
      if (m) out.push({ mediaType: m[1], data: m[2] });
    }
  }
  return out;
}

/** A path within a folder, as Windows and macOS compare names. @param {string} x @param {string} base */
const within = (x, base) => {
  const fold = (/** @type {string} */ s) => (process.platform === "win32" || process.platform === "darwin" ? s.toLowerCase() : s);
  const a = fold(x);
  const b = fold(base.endsWith(sep) ? base : base + sep);
  return a === fold(base) || a.startsWith(b);
};

/** A folder where the filesystem has it, or as named where it has none. @param {string} p */
const realOf = (p) => realpath(p).catch(() => resolve(p));

/**
 * Why a file is kept from attachments, in words; "" where it is not. By its path as named and again where the
 * filesystem resolves it, so a link opens nothing its own name would not.
 * @param {string} abs @param {string} real @param {AttachFrom} from
 */
async function keptWhy(abs, real, from) {
  if (from.dataDir) {
    const data = resolve(from.dataDir);
    if (within(abs, data) || within(real, await realOf(data))) return "in Filament's data folder";
  }
  const folders = (from.folders || []).map((f) => resolve(f));
  if (inGitFolder(abs, folders)) return "in a repository's own .git folder";
  for (const [p, bases] of /** @type {const} */ ([[abs, folders], [real, await Promise.all(folders.map(realOf))]])) {
    const base = bases.filter((b) => within(p, b)).sort((a, b) => b.length - a.length)[0];
    // In a folder it reads, a project's settings (`.claude`, `.cargo`) attach and its secrets' files do not; outside any,
    // every credentials folder is kept, and a secret's file by its name.
    const why = base !== undefined ? secretFileOf(relative(base, p)) : credentialFolderOf(p) ? `in a credentials folder (${credentialFolderOf(p)})` : secretFileOf(basename(p));
    if (why) return why;
  }
  return "";
}

/** The first bytes of a file, for the words a refusal says of it. @param {string} path @param {number} n */
async function headOf(path, n) {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** The words a refusal ends on where the sub-agent could read the file itself. */
const OWN_READ = "name its path in your prompt if it should read it with its own tools";

/**
 * One path, read: a picture by its bytes (PNG, JPEG, GIF, WebP), else text — an SVG's too —, redacted. Throws why not.
 * A file past a picture's bytes is never read whole: its head says which refusal it gets.
 * @param {string} item @param {AttachFrom} from
 * @returns {Promise<{ image: { mediaType: string, data: string, bytes: number } } | { text: string }>}
 */
async function readOne(item, from) {
  const abs = from.judge(item);
  /** @type {string} */
  let real;
  try {
    real = await realpath(abs);
  } catch {
    throw new Error(`no such file (${abs})`);
  }
  const kept = await keptWhy(abs, real, from);
  if (kept) throw new Error(`${kept}, which is kept from attachments: ${OWN_READ}`);
  const st = await stat(real);
  if (st.isDirectory()) throw new Error("a folder: attach the files in it");
  if (!st.isFile()) throw new Error("not a file");
  if (st.size > ATTACH_LIMITS.pictureBytes) {
    const head = await headOf(real, 16);
    const type = imageTypeOf(head);
    if (type) throw new Error(`a ${IMAGE_LABELS[/** @type {keyof typeof IMAGE_LABELS} */ (type)]} image of ${sizeWords(st.size)}, past the ${ATTACH_LIMITS.pictureBytes / 1048576} MB a picture may have: attach a smaller copy (scaled down, or as JPEG)`);
    if (head.subarray(0, 5).toString("latin1") === "%PDF-") throw new Error(`a PDF, which is not attached: ${OWN_READ}`);
    throw new Error(`${sizeWords(st.size)}, past the ${ATTACH_LIMITS.textChars.toLocaleString("en-US")} characters of text a call attaches: ${OWN_READ}`);
  }
  const bytes = await readFile(real);
  const type = imageTypeOf(bytes);
  if (type) return { image: { mediaType: type, data: bytes.toString("base64"), bytes: bytes.length } };
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") throw new Error(`a PDF, which is not attached: ${OWN_READ}`);
  const raw = bytes.toString("utf8");
  if (raw.includes("\0")) throw new Error(`a binary file, which is not attached: ${OWN_READ}`);
  if (raw.startsWith("version https://git-lfs.github.com/spec/")) throw new Error(`a Git LFS pointer, not its file: ${OWN_READ}`);
  if (privateKeyIn(raw)) throw new Error(`a private key, which is kept from attachments: ${OWN_READ}`);
  return { text: from.redact ? from.redact(raw) : raw };
}

/** How many bytes a picture's base64 holds. @param {string} b64 */
const decoded = (b64) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

/** Why a turn numbers none of the person's pictures (`AttachFrom.pictures` → null), in the words a refusal says. */
const UNNUMBERED =
  "this turn numbers none of the person's pictures: it was taken up again from what Filament kept (Filament restarted, or let its question go, while it waited), so which picture is which is not known; a picture that is a file attaches by its path";
/** How many pictures the person sent this turn, in the words a refusal says. @param {number} n */
const picturesWords = (n) => (n === 0 ? "the person sent no picture this turn" : n === 1 ? "this turn has 1 picture from the person: picture 1" : `this turn has ${n} pictures from the person: picture 1 to picture ${n}`);

/**
 * A call's `attach`, read: null where it names nothing; throws, in words naming the item, where any one is refused or the
 * whole passes a limit — nothing is sent then.
 * @param {unknown} items @param {AttachFrom} from
 * @returns {Promise<Attached | null>}
 */
export async function attachments(items, from) {
  if (items == null) return null;
  if (!Array.isArray(items)) throw new Error("attach is a list: each item a path or picture N");
  const named = items.map((x) => String(x ?? "").trim());
  if (!named.length) return null;
  if (named.some((x) => !x)) throw new Error("attach: an empty item — each is a path or picture N");
  if (named.length > ATTACH_LIMITS.items) throw new Error(`attach: ${named.length} items, past the ${ATTACH_LIMITS.items} one call hands on`);
  const turn = from.pictures ? from.pictures() : [];
  /** @type {Attached["images"]} */
  const images = [];
  /** @type {Attached["files"]} */
  const files = [];
  /** @type {string[]} */
  const said = [];
  let base64 = 0;
  let chars = 0;
  for (const item of named) {
    const pic = /^picture\s+(\d+)$/i.exec(item);
    if (pic) {
      const n = Number(pic[1]);
      if (!turn) throw new Error(`attach: ${item}: ${UNNUMBERED}`);
      const p = n >= 1 ? turn[n - 1] : undefined;
      if (!p) throw new Error(`attach: ${item}: ${picturesWords(turn.length)}`);
      const bytes = decoded(p.data);
      if (bytes > ATTACH_LIMITS.pictureBytes) throw new Error(`attach: ${item}: a picture of ${sizeWords(bytes)}, past the ${ATTACH_LIMITS.pictureBytes / 1048576} MB a picture may have`);
      images.push({ name: `picture ${n}`, mediaType: p.mediaType, data: p.data });
      base64 += p.data.length;
      said.push(`picture ${n} (${sizeWords(bytes)} picture)`);
      continue;
    }
    /** @type {Awaited<ReturnType<typeof readOne>>} */
    let got;
    try {
      got = await readOne(item, from);
    } catch (/** @type {any} */ e) {
      throw new Error(`attach: ${item}: ${e?.message || e}`);
    }
    if ("image" in got) {
      images.push({ name: basename(item), mediaType: got.image.mediaType, data: got.image.data });
      base64 += got.image.data.length;
      said.push(`${item} (${sizeWords(got.image.bytes)} picture)`);
    } else {
      files.push({ name: item, text: got.text });
      chars += got.text.length;
      said.push(`${item} (${sizeWords(Buffer.byteLength(got.text, "utf8"))} text)`);
    }
  }
  if (base64 > ATTACH_LIMITS.picturesBase64) throw new Error(`attach: the pictures come to ${sizeWords(base64)} as sent, past the ${ATTACH_LIMITS.picturesBase64 / 1048576} MB one call hands on: attach fewer, or smaller copies`);
  if (chars > ATTACH_LIMITS.textChars) throw new Error(`attach: the text comes to ${chars.toLocaleString("en-US")} characters, past the ${ATTACH_LIMITS.textChars.toLocaleString("en-US")} one call hands on: attach fewer files, or name their paths in your prompt for it to read with its own tools`);
  return { images, files, said: `Attached: ${said.join(", ")}.` };
}

/** Each attached text file as a block after the brief, fenced under its name as the composer attaches one. @param {Attached["files"]} files */
export const fileBlocks = (files) => files.map((f) => ({ type: /** @type {const} */ ("text"), text: `File: ${f.name}\n\`\`\`\n${f.text}\n\`\`\`` }));
