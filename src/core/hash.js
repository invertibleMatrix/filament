// @ts-check
// Content hashes. Everything Filament keys by content — slice summaries, folded turns, pins, memory blocks — uses
// SHA-256 over the string form, so the same bytes always meet the same key. And `same`, the one compare of a secret
// given with the one kept, by their bytes.
import { createHash, timingSafeEqual } from "node:crypto";

/** Full hex SHA-256 of the string form of `s`. @param {unknown} s */
export const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");

/** The first `n` hex characters of the SHA-256 — an id, not a proof. @param {unknown} s @param {number} [n] */
export const shortHash = (s, n = 16) => sha256(s).slice(0, n);

/**
 * Whether two strings are the same, compared by their bytes in time that does not say where they differ. Their lengths
 * are their bytes' too: a character of more than one byte makes two strings as long in characters differ in bytes, and
 * `timingSafeEqual` throws on those where it should say no.
 * @param {string} a @param {string} b
 */
export const same = (a, b) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
