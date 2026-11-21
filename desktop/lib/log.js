// @ts-check
// The desktop app's server writes to `<dataDir>\desktop\server.log` what it would print to a terminal, with the app's
// own lines among them (HarnessV3-Native NA2): kept to a few megabytes, the older half moved to `server.log.1`. Plain
// Node (NA-D13).
import { appendFileSync, closeSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

/** Past this the log starts again, the old one kept beside it once. */
export const LOG_MAX_BYTES = 5 * 1024 * 1024;

/**
 * A writer for one log file. A write that fails is lost, never thrown: a log must not stop the app.
 * @param {string} file @param {{ max?: number, now?: () => Date }} [o]
 * @returns {{ write: (text: string) => void, line: (text: string) => void }}
 */
export function createLog(file, { max = LOG_MAX_BYTES, now = () => new Date() } = {}) {
  let made = false;
  /** @param {string} text */
  const write = (text) => {
    try {
      if (!made) {
        mkdirSync(dirname(file), { recursive: true });
        made = true;
      }
      let size = 0;
      try {
        size = statSync(file).size;
      } catch {}
      if (size + Buffer.byteLength(text) > max && size > 0) {
        rmSync(`${file}.1`, { force: true });
        renameSync(file, `${file}.1`);
      }
      appendFileSync(file, text);
    } catch {}
  };
  return {
    write,
    line: (text) => write(`[desktop] ${now().toISOString()} ${text}\n`),
  };
}

/**
 * What Filament itself said last, for a dialog: the log's last `n` lines that are not the app's own, each cut at 200
 * characters, read from its last 16 kB. A log that does not read is none.
 * @param {string} file @param {number} [n]
 * @returns {string[]}
 */
export function serverTail(file, n = 6) {
  let text = "";
  try {
    const size = statSync(file).size;
    const fd = openSync(file, "r");
    try {
      const want = Math.min(size, 16 * 1024);
      const buf = Buffer.alloc(want);
      readSync(fd, buf, 0, want, size - want);
      text = buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("[desktop] "));
  return lines.slice(-n).map((l) => (l.length > 200 ? `${l.slice(0, 199)}…` : l));
}
