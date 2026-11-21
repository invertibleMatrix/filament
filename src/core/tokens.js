// @ts-check
// The token estimate, in one place. Class-weighted, not a flat chars÷4: BPE tokenizers charge words, digit runs,
// punctuation and CJK at different densities (English prose ~4 chars/token, code and JSON nearer 2–3 because every
// symbol is its own token, CJK ~1 char/token), so each class is costed at its own rate. Still an estimate — never
// the provider's count — but one that does not undercount code-heavy chats, and calibration
// (services/token-calib.js) multiplies the text part by what each upstream+model actually reported, learned from
// the usage every real reply already carries. Counting itself never contacts a provider.
import { sha256 } from "./hash.js";

// One pass over the text: CJK scripts, letter runs (any script's letters and marks), digit runs, symbol runs,
// whitespace runs. Costs track BPE behavior: a word's leading space merges into its token (whitespace is free up
// to a couple of chars — code indentation costs, single spaces do not), short words are one token, medium words
// one and a half, long rare words split every ~3.5 chars; digit runs chunk in threes; symbols are their own tokens
// with common pairs merging (~1.5 chars/token); CJK is ~1 char/token.
const CLASSES =
  /(\p{Script=Han}+|\p{Script=Hiragana}+|\p{Script=Katakana}+|\p{Script=Hangul}+|[\p{L}\p{M}]+|\p{Nd}+|[^\s\p{L}\p{M}\p{Nd}]+|\s+)/gu;
const isCjk = (s) => /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(s);

/**
 * Counting, remembered. A preview composes the whole history about a dozen times and the agent loop measures it every
 * round, so the same texts would be classified over and over — 88% of a preview's time (HarnessV3-Responsiveness R2).
 * A text's count never changes, so a long text's count is kept under the text's content hash (held without the text
 * itself), the most recently used first to stay; a short text is cheaper to count than to look up. The bound holds a
 * long chat's texts with room to spare — tens of thousands of tool calls and results, at about 120 bytes an entry: a
 * pass over more texts than the bound drops each one just before the next pass reads it, and counts every one again.
 * @param {{ count: (s: string) => number, minChars?: number, maxEntries?: number }} o
 */
export function createTokenMemo({ count, minChars = 256, maxEntries = 100_000 }) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return {
    /** @param {string} s */
    count(s) {
      if (s.length < minChars) return count(s);
      const key = sha256(s);
      const hit = seen.get(key);
      if (hit !== undefined) {
        // Used again: to the back of the line, so a text every round reads is never the one dropped.
        seen.delete(key);
        seen.set(key, hit);
        return hit;
      }
      const n = count(s);
      seen.set(key, n);
      if (seen.size > maxEntries) {
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      return n;
    },
    get size() {
      return seen.size;
    },
  };
}

/** @param {string} s @returns {number} */
const classify = (s) => Math.ceil(textWeight(s));

/**
 * The estimate of a text before it is rounded up to whole tokens: the sum of its runs' costs. Texts joined at a line
 * break add up to the text they make — the break is a run of its own, free — so the pieces of a text one reading builds
 * are weighed apart and the whole is their sum, rounded up once (compaction.js `transcriptWithin`).
 * @param {string} s @returns {number}
 */
export function textWeight(s) {
  let n = 0;
  CLASSES.lastIndex = 0;
  for (let m = CLASSES.exec(s); m; m = CLASSES.exec(s)) n += runCost(m[1]);
  return n;
}

/** What one run of a text costs, by its class. @param {string} t @returns {number} */
function runCost(t) {
  const len = t.length;
  // Whole-run tests: a lone `t[0]` is one UTF-16 unit and would misclassify supplementary-plane letters
  // (Deseret, astral Han) into the symbol class.
  if (/\s/u.test(t[0])) return len <= 2 ? 0 : len / 4;
  if (isCjk(t)) return len / (t.charCodeAt(0) >= 0xd800 ? 2 : 1); // astral CJK: 2 UTF-16 units per char
  if (/\p{Nd}/u.test(t)) return Math.max(1, len / 3);
  if (/^[\p{L}\p{M}]/u.test(t)) return len <= 4 ? 1 : len <= 8 ? 1.5 : Math.max(2, len / 3.5);
  return Math.max(1, len / 1.5);
}

/** A run of symbols, which an ellipsis after it joins. @param {string} t */
const symbolRun = (t) => !!t && /^[^\s\p{L}\p{M}\p{Nd}]/u.test(t);

/**
 * The weight of a text cut after its first `n` characters, an ellipsis after them (core/text.js `cut`), for any `n` —
 * `textWeight(s.slice(0, n) + "…")` — from one pass over the text: the runs before the cut summed once, the one the cut
 * falls in weighed at what it keeps, the ellipsis a symbol, joined to a run of symbols it follows. Longer never weighs
 * less, so the longest cut that fits a room is found by halving (compaction.js `transcriptWithin`).
 * @param {string} s @returns {(n: number) => number}
 */
export function cutWeights(s) {
  // The runs cover the text end to end: the one a cut falls in is the text from that run's start to the cut.
  /** @type {number[]} */
  const starts = [];
  /** @type {number[]} */
  const before = [];
  let sum = 0;
  CLASSES.lastIndex = 0;
  for (let m = CLASSES.exec(s); m; m = CLASSES.exec(s)) {
    starts.push(m.index);
    before.push(sum);
    sum += runCost(m[1]);
  }
  return (n) => {
    let [lo, hi, k] = [0, starts.length - 1, -1];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < n) [k, lo] = [mid, mid + 1];
      else hi = mid - 1;
    }
    if (k < 0) return runCost("…");
    const kept = s.slice(starts[k], n);
    return before[k] + (symbolRun(kept) ? runCost(`${kept}…`) : runCost(kept) + runCost("…"));
  };
}

/**
 * Where a count of pieces joined by a separator stands after its first pieces (`joinedTokens`), by a hash of those
 * pieces and the separator: the sum of every run before the last, and the last run, which the next piece may lengthen.
 * The most recently used stay: a chat's transcript is a piece per turn, so the bound holds many chats' transcripts.
 * @type {Map<string, { n: number, tail: string }>}
 */
const joinedSoFar = new Map();
const JOINED_KEPT = 20_000;

/**
 * What texts joined by `sep` weigh, as `estimateTokens` counts the joined text: the same number to the last bit — the
 * runs are summed in the same order from the same start, the run that ends one piece weighed once the next has shown
 * where it ends — without classifying again the first pieces an earlier count joined the same way. A compaction's
 * transcript is the chat's turns since its summary, and the next one is the same turns and the newest: each piece is
 * hashed, and only the pieces past the longest known start are classified.
 * `sep`: one that keeps a piece's end apart from the next piece's start — not empty, and not starting with the second
 * half of a surrogate pair. A piece that ends in a first half keeps it alone then, as the joined text does; with no
 * separator the next piece's second half would make one letter of the two, which may join the run before the half.
 * @param {readonly string[]} pieces @param {string} sep @returns {number}
 */
export function joinedTokens(pieces, sep) {
  if (!sep || /^[\uDC00-\uDFFF]/.test(sep)) throw new RangeError(`joinedTokens: the separator ${JSON.stringify(sep)} can join a piece's end to the next piece's start`);
  let key = sha256(`joined\n${sep}`);
  const keys = pieces.map((p) => (key = sha256(`${key}\n${sha256(p)}`)));
  let k = keys.length - 1;
  while (k >= 0 && !joinedSoFar.has(keys[k])) k--;
  const known = k >= 0 ? /** @type {{ n: number, tail: string }} */ (joinedSoFar.get(keys[k])) : null;
  if (known) {
    // Read again: to the back of the line.
    joinedSoFar.delete(keys[k]);
    joinedSoFar.set(keys[k], known);
  }
  let n = known ? known.n : 0;
  let tail = known ? known.tail : "";
  for (let i = k + 1; i < pieces.length; i++) {
    const text = i === 0 ? pieces[0] : `${tail}${sep}${pieces[i]}`;
    /** @type {string | null} */
    let last = null;
    CLASSES.lastIndex = 0;
    for (let m = CLASSES.exec(text); m; m = CLASSES.exec(text)) {
      if (last !== null) n += runCost(last);
      last = m[1];
    }
    // A copy of the run, not a view into the text it was read from: the state outlives the transcript.
    tail = last === null ? "" : ` ${last}`.slice(1);
    joinedSoFar.set(keys[i], { n, tail });
    if (joinedSoFar.size > JOINED_KEPT) {
      const oldest = joinedSoFar.keys().next().value;
      if (oldest !== undefined) joinedSoFar.delete(oldest);
    }
  }
  return Math.ceil(tail ? n + runCost(tail) : n);
}

const memo = createTokenMemo({ count: classify });
/** @param {string} s @returns {number} */
const countTextTokens = (s) => memo.count(s);

/** Tokens in a piece of text, or of any value's JSON form. `null`/`undefined` count as empty. @param {unknown} s */
export const estimateTokens = (s) =>
  countTextTokens(typeof s === "string" || s == null ? String(s ?? "") : JSON.stringify(s));

/** Tokens for a character count that was measured elsewhere — no text to classify, so the prose rate stands. @param {number} chars */
export const tokensForChars = (chars) => Math.ceil((Number(chars) || 0) / 4);

/**
 * The end of a text that fits in so many tokens, as `estimateTokens` counts them. A cut at four characters a token
 * overruns on code and CJK, where a token is fewer characters (the 9 plausible of 10-19: a lead's record past half
 * its window). Each try shrinks by what the last one overran.
 * @param {string} text @param {number} tokens @returns {string}
 */
export function tailWithinTokens(text, tokens) {
  const s = String(text ?? "");
  const room = Math.max(0, Math.floor(Number(tokens) || 0));
  let chars = Math.min(s.length, room * 4);
  for (let n = estimateTokens(s.slice(s.length - chars)); chars > 0 && n > room; n = estimateTokens(s.slice(s.length - chars))) {
    chars = Math.min(chars - 1, Math.floor((chars * room) / n * 0.98));
  }
  // Never from the second half of a pair (an emoji, a rare CJK character): a lone half is no character, and a provider
  // may refuse the request that carries it.
  if (chars > 0 && chars < s.length && /[\uDC00-\uDFFF]/.test(s[s.length - chars])) chars--;
  return chars > 0 ? s.slice(s.length - chars) : "";
}

/** A block whose cost a provider derives from its size, not its words. @param {any} b */
const isMedia = (b) => b?.type === "image" || b?.type === "image_url" || b?.type === "document" || b?.type === "file";

/**
 * What each block of one conversation weighs, kept by its keeper (`createBlockWeights`); `named`, what the blocks it
 * has a name for weigh, by that name and choice of thinking, the one read longest ago first. @typedef {{
 *   blocks: Record<"all" | "signed" | "none", WeakMap<object, { text: number, fixed: number }>>,
 *   texts: WeakMap<object, { s: string, w: { text: number, fixed: number } }>,
 *   named: { of: (block: object) => string | undefined, kept: Map<string, Partial<Record<"all" | "signed" | "none", { text: number, fixed: number }>>> } | null }} BlockWeights
 */

/**
 * Which thinking blocks a count takes (HarnessV3-TaskGraph-v2 TG2-D81): "all", the default; "signed", a block with a
 * signature and every redacted one, as an Anthropic upstream is sent them; "none", as an OpenAI-format upstream is
 * (routing.js `thinkingOnWire` says which for a model). `weights`: the conversation's keeper's (`createBlockWeights`).
 * `media`: the words a picture, PDF or file goes as, where its caller knows them — a PDF to a model that reads none goes
 * as its text, and one the request leaves out past its room as the words in its place (pdfs.js `mediaWeights`) —,
 * weighed as those words; null, or none, weighs it at its kind's own rate (a picture ~1,500, a document by its size).
 * @typedef {{ thinking?: "all" | "signed" | "none", weights?: BlockWeights | null, media?: ((block: any) => string | null) | null }} CountOptions
 */

/**
 * What each block of a conversation weighs, remembered by the one that keeps the conversation: the agent loop measures
 * its whole conversation two or three times a round, and every tool call and result was stringified and hashed each
 * time — over a long turn, the square of its length. Only for a conversation whose blocks are never changed in place:
 * one changed by putting a new block or message where the old one was (as the loop's every rewrite does) is weighed
 * right, since a new block is weighed anew; a block whose own fields changed would keep its old weight. A message
 * whose words are one string is kept with that string, which compares by value: a message given new words is weighed
 * anew. By which thinking blocks the count takes, since a thinking block weighs nothing where the wire leaves it out.
 * `nameOf`: a name for a block whose words the name alone says, which every copy of it carries — the archive's for a
 * block of a message it opened (archive.js `contentName`), each read of a turn being a new copy: a block is weighed once
 * whichever copy of it a count reads, its weight kept by its name until its keeper cuts it (`keepNamed`). `kept`: the
 * weights by name of another keeper, which this one reads and adds to (`namedCopies`).
 * @param {((block: object) => string | undefined) | null} [nameOf]
 * @param {NonNullable<BlockWeights["named"]>["kept"] | null} [kept]
 * @returns {BlockWeights}
 */
export const createBlockWeights = (nameOf = null, kept = null) => ({
  blocks: { all: new WeakMap(), signed: new WeakMap(), none: new WeakMap() },
  texts: new WeakMap(),
  named: nameOf ? { of: nameOf, kept: kept || new Map() } : null,
});

/**
 * A keeper for copies of a conversation's messages (`copies[i]` a copy of `messages[i]`, as structuredClone makes it):
 * a block the keeper `weights` has a name for gives its name to its copy, so the copy is weighed by what the block
 * weighed — the loop works on its own copy of the composed conversation, whose blocks the sessions' keeper weighed as
 * the turn composed. The copies' blocks are kept by object in a keeper of their own; by name, in `weights`'s. A
 * resumed turn's conversation is no copy of the request's: an unnamed keeper weighs it.
 * @param {BlockWeights | null | undefined} weights @param {readonly any[]} messages @param {readonly any[]} copies
 * @returns {BlockWeights}
 */
export function namedCopies(weights, messages, copies) {
  const named = weights?.named;
  if (!named) return createBlockWeights();
  /** @type {WeakMap<object, string>} */
  const names = new WeakMap();
  messages.forEach((m, i) => {
    const copy = copies[i]?.content;
    if (!Array.isArray(m?.content) || !Array.isArray(copy)) return;
    m.content.forEach((/** @type {any} */ b, /** @type {number} */ j) => {
      const name = b && typeof b === "object" ? named.of(b) : undefined;
      if (name !== undefined && copy[j] && typeof copy[j] === "object") names.set(copy[j], name);
    });
  });
  return createBlockWeights((b) => names.get(b), named.kept);
}

/** How many blocks `everyNamed` has named, its names' number. */
let ownNames = 0;

/**
 * A keeper that has a name for every block: the name `weights` has for it, else one of its own for as long as the
 * block lives, never given to another — its weights by name in `weights`'s keeping, or its own. For a conversation sent
 * through Filament's own front door, which reads each send back as a copy: the loop's every round sends the same
 * blocks, and the copy is named after them (`namedCopies`), so a round weighs only what is new since the one before.
 * @param {BlockWeights | null | undefined} weights
 * @returns {BlockWeights}
 */
export function everyNamed(weights) {
  const of = weights?.named?.of || null;
  /** @type {WeakMap<object, string>} */
  const own = new WeakMap();
  return createBlockWeights((b) => {
    const name = of?.(b) ?? own.get(b);
    if (name !== undefined) return name;
    const made = `sent:${++ownNames}`;
    own.set(b, made);
    return made;
  }, weights?.named?.kept ?? null);
}

/**
 * What a keeper keeps by name cut to the `max` blocks read most recently. Between counts, never in one: a count that cut
 * its own keeper as it went, over more blocks than `max`, would drop each just before it reads it again.
 * @param {BlockWeights} weights @param {number} max
 */
export function keepNamed(weights, max) {
  const kept = weights.named?.kept;
  if (!kept) return;
  for (const name of kept.keys()) {
    if (kept.size <= max) break;
    kept.delete(name);
  }
}

/**
 * The estimate split in two: the part that scales with text density (what calibration multiplies) and the fixed
 * part (images, documents, message framing) whose token cost a provider derives from size, not vocabulary.
 * @param {any} body
 * @param {"conversation" | "request" | "none"} scope
 * @param {CountOptions} [opts]
 * @returns {{ text: number, fixed: number }}
 */
export function estimateBodyParts(body, scope = "conversation", { thinking = "all", weights = null, media = null } = {}) {
  if (scope === "none") return { text: 0, fixed: 0 };
  const IMAGE_TOKENS = 1500;
  /** The blocks weighed before, for this count's choice of thinking. */
  const known = weights ? weights.blocks[thinking] || null : null;
  /** The keeper's names for blocks, and what each named block weighs. */
  const named = known && weights?.named ? weights.named : null;
  /** A thinking block the wire leaves out costs nothing. @param {any} b */
  const leftOut = (b) => thinking !== "all" && (b.type === "thinking" || b.type === "redacted_thinking") && (thinking === "none" || (b.type === "thinking" && !b.signature));
  /**
   * Where the caller says what media go as (`media`), a block that is one or holds one is weighed anew each count, not
   * kept: what goes in its place moves as the request grows (its room), or comes to be known (a PDF's words, once read).
   * @param {any} b
   */
  const anew = (b) => !!media && (isMedia(b) || (b.type === "tool_result" && Array.isArray(b.content) && b.content.some(isMedia)));
  /** @type {(v: any) => { text: number, fixed: number }} */
  const walk = (v) => {
    if (v == null) return { text: 0, fixed: 0 };
    if (typeof v === "string") return { text: countTextTokens(v), fixed: 0 };
    if (Array.isArray(v))
      return v.reduce(
        (n, b) => {
          const w = walk(b); // walked once: the pair of parts, not two passes
          return { text: n.text + w.text, fixed: n.fixed + w.fixed };
        },
        { text: 0, fixed: 0 },
      );
    // Any other value (a number, a boolean): its JSON form.
    if (typeof v !== "object") return { text: estimateTokens(v), fixed: 0 };
    // Weighed anew is never taken from what an earlier count kept, which may have said other words for it.
    if (anew(v)) return weigh(v);
    const had = known?.get(v);
    if (had) return had;
    const name = named?.of(v);
    if (named && name !== undefined) {
      const was = named.kept.get(name);
      const w = was?.[thinking] || weigh(v);
      // Read again, or weighed now: to the back of the line, so the blocks cut first are those read longest ago.
      named.kept.delete(name);
      named.kept.set(name, was?.[thinking] ? was : { ...was, [thinking]: w });
      known?.set(v, w);
      return w;
    }
    const w = weigh(v);
    known?.set(v, w);
    return w;
  };
  /** @type {(v: any) => { text: number, fixed: number }} */
  const weigh = (v) => {
    if (leftOut(v)) return { text: 0, fixed: 0 };
    const words = isMedia(v) ? media?.(v) : null;
    if (typeof words === "string") return walk(words);
    if (v.type === "image" || v.type === "image_url") return { text: 0, fixed: IMAGE_TOKENS };
    if (v.type === "document" && v.source)
      return v.source.type === "text"
        ? walk(v.source.data)
        : v.source.type === "base64"
          ? { text: 0, fixed: Math.min(tokensForChars(String(v.source.data || "").length * 0.75), 100000) }
          : { text: 0, fixed: 200 };
    if (v.type === "file" && v.file)
      return { text: 0, fixed: Math.min(tokensForChars(String(v.file.file_data || "").length * 0.75), 100000) };
    if (v.type === "text") return walk(v.text);
    // A tool result that shows an image or a document (HarnessV3-Tools TL-D17): its words as their JSON, as below,
    // and each image or document at its own rate — its base64 is never text.
    if (v.type === "tool_result" && Array.isArray(v.content) && v.content.some(isMedia)) {
      const shown = walk(v.content.filter(isMedia));
      return { text: estimateTokens({ ...v, content: v.content.filter((/** @type {any} */ b) => !isMedia(b)) }) + shown.text, fixed: shown.fixed };
    }
    // Any other block (tool_use, tool_result, unknown): its JSON form.
    return { text: estimateTokens(v), fixed: 0 };
  };
  /** A message's words: one string is weighed once while the message holds that string. @param {any} m */
  const said = (m) => {
    if (!weights || typeof m.content !== "string") return walk(m.content);
    const had = weights.texts.get(m);
    if (had && had.s === m.content) return had.w;
    const w = walk(m.content);
    weights.texts.set(m, { s: m.content, w });
    return w;
  };
  // OpenAI-shaped bodies carry their system messages inside `messages`, so `body.system` is simply empty there.
  // A malformed body (null, non-array messages) estimates as empty rather than throwing — counting is never worth
  // a 500.
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const sys = walk(body?.system);
  let text = sys.text,
    fixed = sys.fixed;
  for (const m of messages) {
    fixed += 4; // framing: tokens the provider adds per message whatever the text says
    const c = said(m), t = walk(m.tool_calls);
    text += c.text + t.text;
    fixed += c.fixed + t.fixed;
  }
  if (scope === "request") {
    const tools = walk(body.tools), choice = walk(body.tool_choice);
    text += tools.text + choice.text;
    fixed += tools.fixed + choice.fixed;
  }
  return { text: Math.round(text), fixed: Math.round(fixed) };
}

/**
 * Tokens a whole request body would cost. `factor` is the calibration multiplier for the destination upstream+model
 * (services/token-calib.js); it scales the text part only, so an image-heavy body is not distorted by a ratio
 * learned on prose.
 * @param {any} body
 * @param {"conversation" | "request" | "none"} scope
 * @param {number | null | undefined} factor
 * @param {CountOptions} [opts]
 */
export function estimateBodyTokens(body, scope = "conversation", factor = null, opts = {}) {
  const { text, fixed } = estimateBodyParts(body, scope, opts);
  const f = typeof factor === "number" && factor > 0 ? factor : 1;
  return Math.round(text * f) + fixed;
}

/** The most a model is asked to write when nobody has said what it can (core/routing.js `outputCeiling`). */
export const DEFAULT_OUTPUT_TOKENS = 128_000;

/** Anthropic's floor for a thinking budget, and the least a reply may ask for by the fit rule below unless told. */
export const THINKING_MIN = 1024;

/**
 * What the fit guarantee holds back from a reply's room (below): the furniture the lane adds after the compose and
 * the estimate's own drift. @param {number} window
 */
export const replyHeadroom = (window) => Math.max(1536, Math.floor(window * 0.02));

/**
 * The most a reply may ask for on a request of `request` tokens, by the fit guarantee — what the window leaves less
 * the headroom — capped at `cap`. Null when that is under `floor`, or not above a `thinking` budget: a request the
 * provider must refuse, or a fork of a cached request that would have to change its thinking and so miss the cache.
 * No window known: `cap` (the provider judges).
 * @param {{ window: number | null, request: number, cap: number, floor?: number, thinking?: number }} o
 * @returns {number | null}
 */
export function fittedMaxTokens({ window, request, cap, floor = THINKING_MIN, thinking = 0 }) {
  const w = Number(window) || 0;
  const max = Math.floor(w > 0 ? Math.min(cap, w - request - replyHeadroom(w)) : cap);
  if (!(max >= floor) || (thinking > 0 && thinking >= max)) return null;
  return max;
}

/** The fields a request names how much its reply may hold by: Anthropic's and Chat Completions', and Responses'. */
const OUTPUT_FIELDS = Object.freeze(["max_tokens", "max_completion_tokens", "max_output_tokens"]);

/** How much a request asked its reply to hold, by whichever field it names it (0 when none). @param {any} body */
export function outputAsked(body) {
  for (const k of OUTPUT_FIELDS) if (Number(body?.[k]) > 0) return Math.floor(Number(body[k]));
  return 0;
}

/**
 * The most a provider says a model may write, read from its refusal of a request that asked for more — or null when
 * the refusal says no such thing, or names no number below what was asked. Each provider words it its own way: Z.AI's
 * "The max_tokens parameter is illegal.：限制数值范围[1,98304]", DeepSeek's "the valid range of max_tokens is [1, 8192]",
 * OpenAI's "This model supports at most 16384 completion tokens", Anthropic's "max_tokens: 128000 > 64000, which is
 * the maximum allowed number of output tokens", Groq's "`max_tokens` must be less than or equal to `32768`". A refusal
 * for the window (input and output together) names no such ceiling and is not read as one.
 * @param {string} said  the refusal's words @param {number} asked  what the refused request asked its reply to hold
 * @returns {number | null}
 */
export function statedOutputCeiling(said, asked) {
  const s = String(said || "");
  if (!/max(?:imum)?_(?:completion_|output_)?tokens|max tokens|(?:completion|output) tokens/i.test(s)) return null;
  for (const re of [/\[\s*\d+\s*,\s*(\d+)\s*\]/, /\bat most\s+`?(\d+)`?/i, />\s*(\d+)\s*,?\s*which is the maximum/i, /(?:less than or equal to|<=|≤)\s*`?(\d+)`?/i]) {
    const n = Number(re.exec(s)?.[1]);
    if (Number.isInteger(n) && n >= 1 && n < asked) return n;
  }
  return null;
}

/**
 * A request's reply room lowered to `n` tokens in place, by whichever field it names it, and an Anthropic thinking
 * budget kept under it (a budget must stay below max_tokens): under THINKING_MIN's room thinking goes off. Whether it
 * changed.
 * @param {any} body @param {number} n
 */
export function lowerOutputTo(body, n) {
  if (!body || typeof body !== "object") return false;
  let changed = false;
  for (const k of OUTPUT_FIELDS)
    if (Number(body[k]) > n) {
      body[k] = n;
      changed = true;
    }
  const t = body.thinking;
  if (t?.type === "enabled" && Number(t.budget_tokens) >= n) {
    if (n <= THINKING_MIN) delete body.thinking;
    else body.thinking = { ...t, budget_tokens: Math.max(THINKING_MIN, n - THINKING_MIN) };
    changed = true;
  }
  return changed;
}
