// @ts-check
// The pictures a call handed its model (HarnessV4_Tasks U9): a read of an image, an MCP server's screenshot, an image a
// coding agent looked at. Kept beside the run files (`runs/images/`), as the model saw them and once per content, so the
// call's card shows the picture live, after the turn and after a reload. Only the four types every provider takes,
// known by their first bytes (core/media.js), never an SVG (it can carry a script); at most 10 MB each and 8 a call.
// They live as long as run files do (`retentionDays`, by their last use: a picture kept again is used now), and past
// `imagesMaxMB` the oldest go first. They are conversation, as the run files are.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { IMAGE_LABELS, imageTypeOf } from "../core/media.js";

/** The largest picture kept: a screenshot of a wide screen fits, a stray video frame dump does not. */
export const IMAGE_KEEP_MAX_BYTES = 10 * 1048576;
/** The most pictures one call keeps. */
export const IMAGES_PER_CALL = 8;
const EXT = /** @type {const} */ ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" });
/** A picture's name on disk and on the wire: the first half of its bytes' SHA-256, then its type's extension. */
const REF = /^[0-9a-f]{32}\.(png|jpg|gif|webp)$/;
/** @type {Record<string, string>} */
const TYPE_OF = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** @typedef {{ ref: string, type: string, label: string, bytes: number }} KeptImage  one picture a call's tool-end names: `label` its type in words (core/media.js IMAGE_LABELS), as its card says it */
/** @typedef {{ count: number, why: string }} NotKept  how many of a call's pictures were not kept, and why */

/** How many pictures the sweep looks at, or removes, between two turns of the event loop. */
const SWEEP_BATCH = 64;
/** A turn of the event loop. */
const aTurn = () => new Promise((resolve) => setImmediate(resolve));

/** The reasons, in the order a call's line says them. */
const REASONS = ["not a PNG, JPEG, GIF or WebP", "over 10 MB", `past ${IMAGES_PER_CALL} a call`, "whose file could not be read", "that could not be written"];

/**
 * @param {{ dir: string, knobs: () => { persist: boolean, retentionDays: number, imagesMaxMB: number },
 *   log?: (level: string, msg: string) => void, now?: () => number }} o
 */
export function createRunImages({ dir, knobs, log = () => {}, now = Date.now }) {
  /**
   * The pictures on disk, by file, with their size and last use: read from the folder on first need, then kept as this
   * store — the folder's one writer — keeps, uses again and removes pictures, so a picture kept at the cap costs no read
   * of the whole folder (a readdir and a stat of every picture: some 40 ms for 2,000 of them). The sweep
   * reads the folder afresh. Null until first needed. In the folder's order, as a read of it lists them.
   * @type {Map<string, { size: number, at: number }> | null}
   */
  let index = null;
  /** Bytes on disk: the index's sizes, summed. */
  let total = 0;
  /** While the sweep reads the folder: the pictures kept, used again or removed meanwhile, which it reads again after. @type {Set<string> | null} */
  let moved = null;
  const capBytes = () => Math.max(0, Number(knobs().imagesMaxMB) || 0) * 1048576;
  /** The pictures on disk with their size and last use, read now. */
  const onDisk = () => {
    /** @type {Map<string, { size: number, at: number }>} */
    const out = new Map();
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      return out;
    }
    for (const name of names) {
      if (!REF.test(name)) continue;
      try {
        const st = statSync(join(dir, name));
        out.set(join(dir, name), { size: st.size, at: st.mtimeMs });
      } catch {}
    }
    return out;
  };
  /** The index made `pictures`, and the bytes they hold. @param {Map<string, { size: number, at: number }>} pictures */
  const indexed = (pictures) => {
    index = pictures;
    total = 0;
    for (const f of pictures.values()) total += f.size;
    return pictures;
  };
  /** The index, read from the folder where it has not been yet. */
  const indexNow = () => index || indexed(onDisk());
  /** The pictures, oldest first (a stable sort: two of one moment in the folder's order). */
  const oldestFirst = () => [...indexNow()].sort((a, b) => a[1].at - b[1].at);
  /** A picture kept, used again or removed: its entry as the disk has it now. @param {string} file */
  const changed = (file) => {
    moved?.add(file);
    if (!index) return;
    const had = index.get(file);
    if (had) total -= had.size;
    try {
      const st = statSync(file);
      index.set(file, { size: st.size, at: st.mtimeMs });
      total += st.size;
    } catch {
      index.delete(file);
    }
  };
  /** Down to the cap, oldest first; `spare` (the picture just kept) never goes. @param {string | null} spare */
  const trim = (spare) => {
    const cap = capBytes();
    let removed = 0;
    for (const [file] of oldestFirst()) {
      if (total <= cap) break;
      if (file === spare) continue;
      try {
        rmSync(file, { force: true });
        changed(file);
        removed++;
      } catch {}
    }
    return removed;
  };

  /**
   * Keep a call's pictures (core/media.js `picturesIn`): each one's ref, type and size, and how many were not kept and
   * why. Never throws: a picture that cannot be kept is counted, the call goes on.
   * @param {({ data: string } | { path: string })[]} pictures
   * @returns {{ images: KeptImage[], notKept: NotKept | null }}
   */
  const keep = (pictures) => {
    if (!pictures?.length) return { images: [], notKept: null };
    const k = knobs();
    if (k.persist === false) return { images: [], notKept: { count: pictures.length, why: "pictures are not kept: observability.runEvents.persist is off" } };
    if (!(Number(k.imagesMaxMB) > 0)) return { images: [], notKept: { count: pictures.length, why: "pictures are not kept: observability.runEvents.imagesMaxMB is 0" } };
    /** @type {KeptImage[]} */
    const images = [];
    /** @type {Record<string, number>} */
    const missed = {};
    const miss = (/** @type {string} */ why) => (missed[why] = (missed[why] || 0) + 1);
    for (const p of pictures) {
      if (images.length >= IMAGES_PER_CALL) {
        miss(REASONS[2]);
        continue;
      }
      /** @type {Buffer} */
      let bytes;
      try {
        if ("path" in p) {
          if (statSync(p.path).size > IMAGE_KEEP_MAX_BYTES) {
            miss(REASONS[1]);
            continue;
          }
          bytes = readFileSync(p.path);
        } else bytes = Buffer.from(p.data, "base64");
      } catch {
        miss(REASONS[3]);
        continue;
      }
      if (bytes.length > IMAGE_KEEP_MAX_BYTES) {
        miss(REASONS[1]);
        continue;
      }
      const type = imageTypeOf(bytes);
      if (!type) {
        miss(REASONS[0]);
        continue;
      }
      const ref = `${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${EXT[type]}`;
      const file = join(dir, ref);
      try {
        mkdirSync(dir, { recursive: true });
        let had = false;
        try {
          had = statSync(file).size === bytes.length;
        } catch {}
        if (had) {
          // Kept already: used now, so the sweep counts its age from today.
          const t = now() / 1000;
          utimesSync(file, t, t);
          changed(file);
        } else {
          writeFileSync(file, bytes);
          // The folder is read on first need, this picture with it; after, the index takes it.
          if (index) changed(file);
          else {
            moved?.add(file);
            indexNow();
          }
          if (total > capBytes()) trim(file);
        }
      } catch (/** @type {any} */ e) {
        log("warn", `run log: a picture could not be kept (${e.message})`);
        miss(REASONS[4]);
        continue;
      }
      images.push({ ref, type, label: IMAGE_LABELS[type], bytes: bytes.length });
    }
    const count = Object.values(missed).reduce((n, c) => n + c, 0);
    return { images, notKept: count ? { count, why: REASONS.filter((r) => missed[r]).map((r) => `${missed[r]} ${r}`).join("; ") } : null };
  };

  /** The file of a kept picture, or null: a ref as its own name says it, still on disk. @param {string} ref */
  const fileOf = (ref) => {
    if (!REF.test(String(ref || ""))) return null;
    const file = join(dir, ref);
    try {
      return statSync(file).isFile() ? file : null;
    } catch {
      return null;
    }
  };

  let sweeping = false;
  /**
   * The sweep beside the run files': past the retention by last use, then down to the cap. The folder is read afresh,
   * off the event loop, and what is removed goes a batch at a time; each picture is looked at again as it goes, so one
   * used again meanwhile stays, as it would have. → how many went (0 for a sweep asked while one runs).
   * @returns {Promise<number>}
   */
  const sweep = async () => {
    if (sweeping) return 0;
    sweeping = true;
    try {
      moved = new Set();
      /** @type {Map<string, { size: number, at: number }>} */
      const read = new Map();
      try {
        /** @type {string[]} */
        let names = [];
        try {
          names = (await readdir(dir)).filter((n) => REF.test(n));
        } catch {}
        for (let i = 0; i < names.length; i += SWEEP_BATCH) {
          const batch = names.slice(i, i + SWEEP_BATCH);
          const got = await Promise.all(batch.map((n) => stat(join(dir, n)).catch(() => null)));
          batch.forEach((n, j) => {
            const st = got[j];
            if (st) read.set(join(dir, n), { size: st.size, at: st.mtimeMs });
          });
        }
        // What this store kept, used again or removed while the folder was read is as the disk has it now.
        for (const file of moved)
          try {
            const st = statSync(file);
            read.set(file, { size: st.size, at: st.mtimeMs });
          } catch {
            read.delete(file);
          }
      } finally {
        moved = null;
      }
      indexed(read);
      const days = Number(knobs().retentionDays);
      let removed = 0;
      if (days > 0) {
        const cutoff = now() - days * 86400_000;
        const past = oldestFirst().filter(([, f]) => f.at < cutoff).map(([file]) => file);
        for (let i = 0; i < past.length; i++) {
          if (i && i % SWEEP_BATCH === 0) await aTurn();
          // Used again since it was read: it stays.
          if (!((index?.get(past[i])?.at ?? Infinity) < cutoff)) continue;
          try {
            rmSync(past[i], { force: true });
            changed(past[i]);
            removed++;
          } catch {}
        }
      }
      return removed + trim(null);
    } finally {
      sweeping = false;
    }
  };

  return { keep, fileOf, sweep, typeOf: (/** @type {string} */ ref) => TYPE_OF[String(ref).split(".").pop() || ""] || null };
}
