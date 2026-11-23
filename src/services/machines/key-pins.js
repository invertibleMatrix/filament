// @ts-check
// The public keys behind the certificates this computer pinned (s4g): another machine's network listener serves a
// certificate no authority vouches for, which every device here pinned by its fingerprint (services/machines/pinned.js,
// desktop/lib/pinned-socket.js, the app's view: desktop/lib/rail.js `certVerdict`). It renews that certificate with
// the same key (services/lan-tls.js `lanIdentity`), so a connection whose certificate is the pinned one learns its key
// here, and a later one whose certificate is new is taken where its key is the one the pinned certificate had — no
// device pairs again. Each line is a certificate's fingerprint and its own public key's, both read from that
// certificate — the one a pin names, or one a key learned so signed —, so nothing a stranger shows adds a key a pin
// takes; one in use is kept newest, so a stranger's many never put it out (the review of s4g). Kept in Filament's data
// folder (`usePinBook`), shared by the command line, this Filament's own calls and the desktop app; until one is
// named, in this process alone.
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { keyPrintOf, printOf, samePrint } from "../../core/x509.js";

/** The file in Filament's data folder the keys are kept in. */
export const KEY_PINS_FILE = "key-pins.json";
/** The most kept: a new one past them puts the oldest out. */
const MOST = 500;

/** Each certificate's fingerprint, written as `printOf` writes it, to its key's (`keyPrintOf`). @type {Map<string, string>} */
const book = new Map();
/** Where they are kept, or null: this process alone. @type {string | null} */
let file = null;

/** What the file holds, added to what this process learned: another process may have learned one meanwhile. */
const readBook = () => {
  if (!file) return;
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    for (const [cert, key] of Object.entries(j?.keys && typeof j.keys === "object" ? j.keys : {})) {
      const c = printOf(cert);
      const k = printOf(String(key));
      if (c.length === 95 && k.length === 95 && !book.has(c)) book.set(c, k);
    }
  } catch {}
};

/**
 * Keep the keys learned in `dataDir`'s KEY_PINS_FILE from now on, and read what it holds; the same folder again is
 * nothing. @param {string} dataDir
 */
export function usePinBook(dataDir) {
  const f = join(dataDir, KEY_PINS_FILE);
  if (f === file) return;
  file = f;
  readBook();
}

/**
 * Learn that the certificate `cert` is signed by the key `key`, and keep it where a book is named; one known already
 * is nothing. @param {string} cert @param {string} key
 */
export function learnKey(cert, key) {
  const c = printOf(cert);
  const k = printOf(key);
  if (c.length !== 95 || k.length !== 95) return;
  const known = book.get(c) === k;
  if (!known) readBook();
  // Kept newest, known or new: MOST puts the oldest out, never one in use.
  book.delete(c);
  book.set(c, k);
  if (known && !unsaved) return;
  while (book.size > MOST) book.delete(/** @type {string} */ (book.keys().next().value));
  keep();
}

/** Whether what was learned is not in the file yet: the next connection that learns tries again. */
let unsaved = false;
/** The book written to its file, beside it and then in its place; readable by this account alone. */
const keep = () => {
  if (!file) return;
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ version: 1, keys: Object.fromEntries(book) }, null, 1), { mode: 0o600 });
    renameSync(tmp, file);
    unsaved = false;
  } catch {
    // Not kept (the file held by another program): tried again at the next connection that learns.
    unsaved = true;
    try {
      unlinkSync(tmp);
    } catch {}
  }
};

/** The key learned for a certificate, or "". @param {string} cert */
export function keyFor(cert) {
  const c = printOf(cert);
  if (!book.has(c)) readBook();
  return book.get(c) ?? "";
}

/** Whether two certificates are signed by one key, as learned: false where either's is not known. @param {string} a @param {string} b */
export const sameKey = (a, b) => samePrint(keyFor(a), keyFor(b));

/**
 * Whether a connection's certificate is the one `pin` names: that certificate — whose key is learned then — or one
 * signed by the key it was learned to have (a renewal), which is learned under its own fingerprint too.
 * @param {string} pin  the pinned certificate's fingerprint
 * @param {{ fingerprint256?: string, raw?: Buffer } | null | undefined} peer  the connection's certificate, as
 *   `getPeerCertificate` says it
 */
export function pinHolds(pin, peer) {
  const cert = String(peer?.fingerprint256 || "");
  if (!cert) return false;
  let key = "";
  try {
    if (peer?.raw) key = keyPrintOf(peer.raw);
  } catch {}
  if (samePrint(cert, pin)) {
    if (key) learnKey(cert, key);
    return true;
  }
  if (!key || !samePrint(keyFor(pin), key)) return false;
  learnKey(cert, key);
  return true;
}
