// @ts-check
// A chat file with a line past the most an import reads a line to (MEMR-10), written a block at a time so that the line
// is never one string in the test either: what comes before it, the line, then what comes after.
import { closeSync, openSync, writeSync } from "node:fs";

/** A line just past the 256 MiB an import reads a line to. */
export const PAST_A_LINE = (256 << 20) + 1024;

/** @param {string} file @param {string} before @param {string} after @param {number} [bytes] */
export function writeWithLongLine(file, before, after, bytes = PAST_A_LINE) {
  const fd = openSync(file, "w");
  try {
    writeSync(fd, before);
    const block = Buffer.alloc(1 << 20, 0x78);
    for (let left = bytes; left > 0; left -= block.length) writeSync(fd, block, 0, Math.min(block.length, left));
    writeSync(fd, `\n${after}`);
  } finally {
    closeSync(fd);
  }
}
