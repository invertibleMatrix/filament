// @ts-check
// Lines read off a stream as its chunks come: an agent's JSON-RPC messages, ripgrep's matches, the names git lists.
// Each chunk is searched for its newlines once, and a line that came in many chunks is joined once, at its end. Added
// to one buffer and searched from its start at every chunk, a long line — an agent's message carrying a file — cost the
// square of its length.
// A line is held to `LINE_MAX` characters. Past that it is no message anything Filament reads sends — the largest
// carries a file or a picture, an attachment at most 20 MB, a third more in base64 — and held whole it would take the
// memory it names. It is the most a WebSocket message (http/ws.js) and another machine's answer (machines/client.js) may
// be, so no stream holds more of one line than they do. Its pieces are let go of as they come, its two ends kept,
// and its reader is told of it at its newline (`onOver`), in its place: the stream goes on with the next line. A stream
// that ends inside one tells of it at its end (`end`).

/** The most characters of one line a reader holds (64 MiB). */
export const LINE_MAX = 64 * 1024 * 1024;
/** How much of a line too long to hold is kept at each end: enough for its reader to tell what it was. */
const ENDS_KEPT = 4096;

/**
 * A line too long to hold, as its reader is told of it: how long it was, and its first and last characters.
 * @typedef {{ length: number, start: string, end: string }} Over
 */

/** The first `ENDS_KEPT` characters of a line's pieces. @param {readonly string[]} pieces */
const startOf = (pieces) => {
  let s = "";
  for (const p of pieces) {
    s += p.slice(0, ENDS_KEPT - s.length);
    if (s.length >= ENDS_KEPT) break;
  }
  return s;
};
/** The last `ENDS_KEPT` characters of a line's pieces. @param {readonly string[]} pieces */
const endOf = (pieces) => {
  let s = "";
  for (let i = pieces.length - 1; i >= 0 && s.length < ENDS_KEPT; i--) s = pieces[i].slice(-(ENDS_KEPT - s.length)) + s;
  return s;
};
/** The ends of a line past its reader's most, with one more piece. @param {{ start: string, end: string }} ends @param {string} piece */
const extended = (ends, piece) => ({ start: startOf([ends.start, piece]), end: endOf([ends.end, piece]) });

/**
 * @param {(line: string) => boolean | void} onLine  each line, without its newline; true stops the reading: the rest of
 *   the chunk it came in is left unread
 * @param {{ max?: number, onOver?: (over: Over) => boolean | void, eol?: string }} [o]  `max`: the most characters a line
 *   is held to, `LINE_MAX` but in a test; `onOver`: told of each line past it, in its place, and stops the reading as
 *   `onLine` does; `eol`: the one character that ends a line — a newline, or the NUL after each name of git's `-z`
 *   lists, where a newline is part of a name
 * @returns {{ push: (chunk: string) => boolean, rest: () => string, end: () => string }}  `push` a chunk, true where a
 *   reader stopped it; `rest`: what came after the last newline, while it is held ("" for a line past `max`, told of at
 *   its newline); `end`: the stream's end — what came after its last newline, as `rest` gives it, a line past `max` it
 *   ended inside told of as its newline would have (`onOver`), and the reader started afresh
 */
export function createLineReader(onLine, { max = LINE_MAX, onOver = () => {}, eol = "\n" } = {}) {
  /** The line under way: its pieces, from the chunks that held no newline since it began. @type {string[]} */
  let head = [];
  /** How long the line under way is so far. */
  let length = 0;
  /** The ends of the line under way once it is past `max`, its pieces let go of. @type {{ start: string, end: string } | null} */
  let over = null;
  /** One more piece of the line under way: past `max`, only its ends are kept. @param {string} piece */
  const take = (piece) => {
    length += piece.length;
    if (over) over = extended(over, piece);
    else {
      head.push(piece);
      if (length > max) {
        over = { start: startOf(head), end: endOf(head) };
        head = [];
      }
    }
  };
  return {
    push(chunk) {
      let from = 0;
      for (let nl = chunk.indexOf(eol); nl >= 0; nl = chunk.indexOf(eol, from)) {
        const tail = chunk.slice(from, nl);
        from = nl + 1;
        const all = length + tail.length;
        const ends = over ? extended(over, tail) : all > max ? { start: startOf([...head, tail]), end: endOf([...head, tail]) } : null;
        const stop = ends ? onOver({ length: all, ...ends }) : onLine(head.length ? head.join("") + tail : tail);
        head = [];
        length = 0;
        over = null;
        if (stop === true) return true;
      }
      if (from < chunk.length) take(chunk.slice(from));
      return false;
    },
    rest: () => (over ? "" : head.join("")),
    end() {
      const tail = over ? "" : head.join("");
      const told = over ? { length, ...over } : null;
      head = [];
      length = 0;
      over = null;
      if (told) onOver(told);
      return tail;
    },
  };
}

/** A plain JSON value: a string, a number, true, false or null. */
const PLAIN = String.raw`"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null`;
/** One field of an object, its value plain, then what follows it: a comma or the object's end. */
const FIELD = new RegExp(String.raw`\s*("(?:[^"\\]|\\.)*")\s*:\s*(${PLAIN})\s*([,}])`, "y");
/** The field an object ends with, its value plain. */
const LAST_FIELD = new RegExp(String.raw`("(?:[^"\\]|\\.)*")\s*:\s*(${PLAIN})\s*\}\s*$`);

/**
 * What a JSON object too long to hold says of itself at its two ends (`Over`): its own fields with plain values that
 * come before its first object or list, and the one it ends with. A JSON-RPC peer's message says its id and its method
 * so — ahead of its params or its result, or after them.
 * @param {Over} over @returns {Record<string, unknown>}
 */
export function overFields({ start, end }) {
  /** @type {Record<string, unknown>} */
  const out = {};
  const open = /^\s*\{/.exec(start);
  if (!open) return out;
  for (let at = open[0].length; ; ) {
    FIELD.lastIndex = at;
    const m = FIELD.exec(start);
    if (!m) break;
    out[JSON.parse(m[1])] = JSON.parse(m[2]);
    at = FIELD.lastIndex;
    if (m[3] === "}") return out;
  }
  const last = LAST_FIELD.exec(end);
  if (last && !(JSON.parse(last[1]) in out)) out[JSON.parse(last[1])] = JSON.parse(last[2]);
  return out;
}
