// @ts-check
// The server's census of its own memory (the owner's of 11-17: its floor climbed to 1.9 GB over a day and nothing in
// the installed app could say what held it — it runs as Electron's utility process, which no heap snapshot reaches
// from outside): each minute, Node's own figures — the heap used and committed, memory outside it, the process's
// resident size — with what the run store holds in memory (services/runs.js `memory()`) and the sub-agent registry's
// conversations (app/agent/subagents.js `census()`), posted to the desktop app over the utility process's port, which
// writes it into its memory log (desktop/lib/metrics.js). Nothing is posted where Filament runs under no app.
import v8 from "node:v8";

/** How often the census is posted, ms. */
export const CENSUS_EVERY_MS = 60_000;

/** @param {number} bytes */
const mb = (bytes) => Math.round((Number(bytes) || 0) / 1048576);
/** Characters in millions, one decimal: a string's bytes are one or two a character, so they are said as characters. @param {number} n */
const millions = (n) => Math.round((Number(n) || 0) / 1e5) / 10;

/**
 * About how many characters a tool call's input holds: its strings down to four levels — a write's content, each of an
 * edit's old and new texts, a command — without serialising it, which for a big input would copy what it measures.
 * @param {unknown} input @param {number} [depth]
 */
function inputChars(input, depth = 4) {
  if (typeof input === "string") return input.length;
  if (!input || typeof input !== "object" || depth <= 0) return 0;
  let n = 0;
  for (const v of Object.values(input)) n += inputChars(v, depth - 1);
  return n;
}

/** A block's data (a picture's, a document's): a string's length, else its bytes. @param {unknown} data */
const dataChars = (data) => (typeof data === "string" ? data.length : Number(/** @type {any} */ (data)?.byteLength) || 0);

/**
 * About how many characters a conversation holds — its words, thinking, tool calls' inputs, results and pictures'
 * data — read from each block's lengths, never serialised. Not exact; for a census.
 * @param {unknown} messages
 */
export function convoChars(messages) {
  if (!Array.isArray(messages)) return 0;
  let n = 0;
  /** @param {any} b */
  const block = (b) => {
    if (typeof b === "string") return void (n += b.length);
    if (!b || typeof b !== "object") return;
    if (typeof b.text === "string") n += b.text.length;
    if (typeof b.thinking === "string") n += b.thinking.length;
    if (b.type === "tool_use") n += inputChars(b.input);
    // A picture's or a document's (a PDF's) data, wherever the block keeps it.
    if (b.source?.data != null) n += dataChars(b.source.data);
    else if (b.type === "image" && b.data != null) n += dataChars(b.data);
    if (b.type === "tool_result") {
      if (typeof b.content === "string") n += b.content.length;
      else if (Array.isArray(b.content)) for (const c of b.content) block(c);
    }
  };
  for (const m of messages) {
    const c = /** @type {any} */ (m)?.content;
    if (typeof c === "string") n += c.length;
    else if (Array.isArray(c)) for (const b of c) block(b);
  }
  return n;
}

/**
 * What the sub-agent registry holds (app/agent/subagents.js `census`): how many have ended and how many run, the
 * characters of every one's kept conversation, and of the running ones' live conversations too — a running follow-up
 * holds both, its loop working on a copy. A kept conversation is a new array each exchange, so its count is kept in
 * `cache` by that array and read once; a live one grows, and is read each time.
 * @param {Iterable<{ status?: string, convo?: unknown, run?: { convo?: unknown } | null }>} entries @param {WeakMap<object, number>} cache
 * @returns {{ kept: number, keptChars: number, running: number, runningChars: number }}
 */
export function registryCensus(entries, cache) {
  let kept = 0,
    keptChars = 0,
    running = 0,
    runningChars = 0;
  for (const sa of entries) {
    const convo = sa.convo;
    if (sa.status === "running") {
      running++;
      const live = sa.run?.convo;
      if (Array.isArray(live)) runningChars += convoChars(live);
      // A kept conversation that is the live one grows as it runs: counted there, never cached.
      if (live === convo) continue;
    } else kept++;
    if (!Array.isArray(convo)) continue;
    let n = cache.get(convo);
    if (n == null) cache.set(convo, (n = convoChars(convo)));
    keptChars += n;
  }
  return { kept, keptChars, running, runningChars };
}

/**
 * The census now: Node's figures and V8's heap (used, committed, its limit) in MB; what the run store and the
 * registry hold in millions of characters. A part that cannot be read says so and the rest stands.
 * @param {{ runs?: { memory?: () => any } | null, subagents?: { census?: () => any } | null }} o
 */
export function censusOf({ runs = null, subagents = null } = {}) {
  const u = process.memoryUsage();
  const h = v8.getHeapStatistics();
  /** @type {Record<string, unknown>} */
  const out = { rssMB: mb(u.rss), heapUsedMB: mb(u.heapUsed), heapTotalMB: mb(u.heapTotal), heapLimitMB: mb(h.heap_size_limit), externalMB: mb(u.external), arrayBuffersMB: mb(u.arrayBuffers) };
  try {
    const r = runs?.memory?.();
    if (r) out.runs = { runs: r.runs, events: r.events, charsM: millions(r.chars), asSent: r.asSent, indexes: r.indexes };
  } catch (e) {
    out.runs = `unread: ${/** @type {any} */ (e)?.message || e}`;
  }
  try {
    const s = subagents?.census?.();
    if (s) out.subagents = { kept: s.kept, keptCharsM: millions(s.keptChars), running: s.running, runningCharsM: millions(s.runningChars) };
  } catch (e) {
    out.subagents = `unread: ${/** @type {any} */ (e)?.message || e}`;
  }
  return out;
}

/**
 * Post `census()` to the desktop app over `port` (Electron's `process.parentPort`) every `every` ms, the first at
 * once; nothing where there is no port. The timer holds no process open, and a census that throws is posted as its
 * error. Returns what stops it.
 * @param {{ postMessage: (m: unknown) => void } | undefined} port @param {() => unknown} census
 * @param {{ every?: number, setInterval?: (fn: () => void, ms: number) => any, clearInterval?: (t: any) => void }} [o]
 */
export function postCensus(port, census, { every = CENSUS_EVERY_MS, setInterval: every_ = setInterval, clearInterval: stop = clearInterval } = {}) {
  if (typeof port?.postMessage !== "function") return () => {};
  const post = () => {
    let c;
    try {
      c = census();
    } catch (e) {
      c = { error: `the census could not be read: ${/** @type {any} */ (e)?.message || e}` };
    }
    try {
      port.postMessage({ census: c });
    } catch {}
  };
  post();
  const t = every_(post, every);
  t?.unref?.();
  return () => stop(t);
}
