// @ts-check
// A row the transcript drew, following a store while it stands in the document. A running turn rebuilds its rounds' rows
// on every run event and a chat's switch draws its turns again whole, while a store may stay quiet the whole time: a row
// that let go of its store only when the store next spoke kept itself — and the whole drawing it hangs in — until then.
// Each new follower, of any store, lets go of the rows the drawings before it replaced: seen in the document once, out
// of it now. A row drawn into the one on the page (dom.js `morph`) is never in the document: the row that stands
// follows for it, and it lets go once that draw is done.
import { standing } from "../../lib/dom.js";

/** @type {Set<{ row: Element, seen: boolean, settle: () => void }>} */
const following = new Set();
/** Whether a follower's row has done: drawn into another, or out of the document after it was seen. @param {{ row: Element, seen: boolean }} f */
const done = (f) => standing(f.row) !== f.row || (!f.row.isConnected && f.seen);
const sweep = () => {
  for (const f of following) {
    if (done(f)) f.settle();
    else if (f.row.isConnected) f.seen = true;
  }
};

/**
 * `row` hears `watch`'s store through `onChange` until the stop it returns is called, or until it has left the
 * document, or was drawn into the row on the page — `gone` hears that: at the next row drawn, or when the store next
 * speaks, whichever comes first.
 * @param {Element} row @param {(fn: () => void) => () => void} watch  the store's subscribe, which returns its own stop
 * @param {() => void} onChange @param {() => void} [gone]
 * @returns {() => void} the stop
 */
export function followWhileDrawn(row, watch, onChange, gone = () => {}) {
  const f = { row, seen: false, settle: () => { stop(); gone(); } };
  const unwatch = watch(() => {
    if (done(f)) return f.settle();
    // Drawn now, it is seen — a row placed after its own sweep ran is seen here first.
    if (row.isConnected) f.seen = true;
    onChange();
  });
  const stop = () => {
    unwatch();
    following.delete(f);
  };
  following.add(f);
  // Once the task that built the row has placed it (and dropped the rows it replaces).
  queueMicrotask(sweep);
  return stop;
}
