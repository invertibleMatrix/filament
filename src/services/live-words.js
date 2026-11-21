// @ts-check
// A running turn's words, held while it runs (HarnessV3-Launch LD-D16): its blocks so far, text and thinking, as the
// turn streams them to the page that sent it. A page that joins the turn later — a reload, a second tab — reads them
// beside the run's events (`/runs/:id/events?stream=1&words=1`, and a follow's `words` on the page's run socket,
// http/admin/run-socket.js): the run log keeps a round's words only when the round
// ends, and storing every streamed piece would fill its ring. Nothing here outlives the turn: the run's events and the
// archive hold the finished one.

/** @typedef {"text" | "thinking"} WordKind */
/** @typedef {{ type: WordKind, text: string }} WordBlock */
/** @typedef {{ block: number, type: WordKind, text: string }} WordPiece  one streamed piece, and the block it joined */
/** @typedef {{ end: true }} WordEnd  the open block ended: the model call is over, and what it asked for runs now */

export function createLiveWords() {
  /** @type {Map<string, { blocks: WordBlock[], open: boolean }>} */
  const turns = new Map();
  /** @type {Map<string, Set<(piece: WordPiece | WordEnd) => void>>} */
  const readers = new Map();
  return {
    /** The turn starts: its words are held from now until it ends. @param {string} id  the turn's run */
    start(id) {
      turns.set(id, { blocks: [], open: false });
    },
    /**
     * A piece of the turn's words: it joins the open block when that is of its kind, else opens the next block, as the
     * reply's own blocks open on the Anthropic wire. Each reader hears it with the block it joined. A turn that is not
     * running holds nothing: what its reply says after the run's end (the line a reply with no words gets) is the
     * archive's to show.
     * @param {string} id  the turn's run @param {WordKind} type @param {string} text
     */
    piece(id, type, text) {
      const t = turns.get(id);
      if (!t || !text) return;
      const last = t.blocks[t.blocks.length - 1];
      if (t.open && last?.type === type) last.text += text;
      else t.blocks.push({ type, text });
      t.open = true;
      const piece = { block: t.blocks.length - 1, type, text };
      for (const f of readers.get(id) || []) f(piece);
    },
    /**
     * The open block ends (a model call's end): the next piece opens a new one, and each reader hears the end, once —
     * the page draws no caret after words that have stopped coming (HarnessV4_Tasks U4). @param {string} id
     */
    endBlock(id) {
      const t = turns.get(id);
      if (!t || !t.open) return;
      t.open = false;
      for (const f of readers.get(id) || []) f({ end: true });
    },
    /** Whether the turn's last block still takes words: false between model calls, and for a turn that holds none.
     *  @param {string} id */
    open(id) {
      return turns.get(id)?.open === true;
    },
    /** The turn's blocks so far, copied: none for a turn that holds no words. @param {string} id @returns {WordBlock[]} */
    blocks(id) {
      return (turns.get(id)?.blocks || []).map((b) => ({ ...b }));
    },
    /** Hear the turn's pieces, and each block's end, from now on. → the reader's leave.
     *  @param {string} id @param {(piece: WordPiece | WordEnd) => void} f */
    follow(id, f) {
      let set = readers.get(id);
      if (!set) readers.set(id, (set = new Set()));
      set.add(f);
      return () => {
        const s = readers.get(id);
        if (!s) return;
        s.delete(f);
        if (!s.size) readers.delete(id);
      };
    },
    /** The turn ended: its words and its readers go. @param {string} id */
    end(id) {
      turns.delete(id);
      readers.delete(id);
    },
    /** How many turns' words and readers are held — 0 once every turn has ended and every reader left. */
    held() {
      return turns.size + readers.size;
    },
  };
}

/** @typedef {ReturnType<typeof createLiveWords>} LiveWords */

/**
 * One reader's `words` frames: the blocks so far first, then each piece. The writer loses nothing — a frame its socket
 * cannot take yet waits in the stream's queue (http/events.js `writeHeld`), and a reader too far behind is cut off and
 * starts again on a fresh connection, with the blocks so far — so after the whole set every piece follows it. A block's
 * end is a frame of its own (`end`); the whole set says whether its last block still takes words (`open`), where the
 * caller can tell.
 * @param {{ blocks: () => WordBlock[], open?: () => boolean, write: (frame: any) => void }} o
 */
export function wordsFrames({ blocks, open, write }) {
  return {
    /** The blocks so far. */
    start() {
      write({ type: "words", blocks: blocks(), ...(open ? { open: open() } : {}) });
    },
    /** @param {WordPiece | WordEnd} piece */
    piece(piece) {
      write("end" in piece ? { type: "words", end: true } : { type: "words", piece });
    },
  };
}
