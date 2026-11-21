// @ts-check
// The engine outbox (HarnessV3-Memory M2-2): every write Filament makes to the engine about an item — store its copy,
// invalidate it, restore it — is a row in the archive's engine_outbox, written beside the archive change it follows,
// and sent from here: oldest first, one item's rows in order, retried with backoff when the engine is down or fails.
// Nothing about an item is lost while the engine is away, and every copy carries the id of the item it mirrors.
import { outsideTrace } from "./trace.js";
import { isRetired } from "./archive.js";

/** Waits before the next try, by attempts so far: 1 s, 5 s, 30 s, 2 min, then 10 min. */
export const OUTBOX_BACKOFF_MS = [1_000, 5_000, 30_000, 120_000, 600_000];
/** Tries before a row the engine keeps failing (it raised) is set aside — its item stands without a copy, and a reindex
 * queues it again. An engine that is down or times out never sets a row aside: the whole queue waits for it. */
export const OUTBOX_MAX_ATTEMPTS = 8;
const BATCH = 100;

/** The user's own word on an item: stated, corrected, their words quoted, added by the owner, or confirmed. @param {any} it */
const usersWord = (it) => it.status === "confirmed" || ["person", "owner", "correction", "capture"].includes(it.origin);

/**
 * The engine copy of an item, one shape for every writer: its text, its kind as the engine's type, how it is known,
 * and metadata naming the item (`metadata.item`): which claim a row copies, said in the engine (recall finds a
 * row's claim by its id, or its text: M2-D10). A model's note is never pinned.
 * @param {any} it  the archive item @param {{ via?: string, client?: string }} [o]
 */
export function mirrorArgs(it, { via = "filament", client = "" } = {}) {
  return {
    content: String(it.text || "").slice(0, 500),
    source: `filament-${it.kind}`,
    importance: it.importance ?? 0.6,
    scope: "global",
    veracity: usersWord(it) ? "stated" : "inferred",
    memoryType: it.kind === "rule" || it.kind === "convention" ? "instruction" : it.kind === "preference" ? "preference" : "fact",
    metadata: {
      item: it.id,
      kind: it.kind,
      project: it.project_id ?? null,
      chain: it.chain_id ?? null,
      turn: it.turn_id ?? null,
      via,
      ...(client ? { client } : {}),
    },
    pin: usersWord(it) || (it.kind === "rule" && it.origin !== "model"),
    valid: true,
  };
}

export class EngineOutbox {
  /** @type {Promise<void> | null} */
  #draining = null;
  #again = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #timer = null;
  #stopped = false;
  // Until when the engine counts as down: no row is tried before then, so a busy session's writes wait together
  // instead of each spending its own tries against an engine that is not there.
  #downUntil = 0;

  /**
   * @param {{ archive: any, getStore: () => any, log?: (level: string, msg: string) => void, now?: () => number }} o
   *   `getStore` answers the engine client (remember / invalidate / restore) of the outbox's owner, or null when there
   *   is no engine: rows then wait. Read through the owner, so the brain and its outbox never hold two engines.
   */
  constructor({ archive, getStore, log = () => {}, now = () => Date.now() }) {
    this.archive = archive;
    this.getStore = getStore;
    this.log = log;
    this.now = now;
    // Rows sent long ago are history nobody reads; a week of them stays for the dashboard.
    try {
      archive?.outbox?.prune(now() - 7 * 86_400_000);
    } catch {
      /* a closed or read-only archive: nothing to prune */
    }
  }

  /**
   * Queue one engine write about an item and start sending. Call inside `archive.transaction` beside the change it
   * follows, so the two land together. @param {number} itemId @param {"mirror" | "invalidate" | "restore"} op
   * @param {Record<string, any>} [args]  mirror: `{ via, client }`; invalidate: `{ id?, replacement? }` (`id` names an
   *   engine row other than the item's own copy); restore: none
   */
  enqueue(itemId, op, args = {}) {
    const id = this.archive.outbox.add(itemId, op, args);
    setImmediate(() => void this.drain());
    return id;
  }

  /** Send what is due; resolves when nothing due is left. Concurrent calls share one pass (and ask it to look again). */
  drain() {
    if (this.#stopped || !this.getStore() || !this.archive) return Promise.resolve();
    if (this.#draining) {
      this.#again = true;
      return this.#draining;
    }
    // A drain runs in the background (on enqueue, on a timer): it never rejects, or the process would go down with it.
    this.#draining = outsideTrace(() => this.#pass())
      .catch((e) => this.log("warn", `memory: the engine outbox stopped on an archive error (${String(e?.message || e).slice(0, 160)}); it tries again on the next write`))
      .finally(() => {
        this.#draining = null;
        this.#schedule();
      });
    return this.#draining;
  }

  /** What is waiting, retrying and set aside, and the last error, for the status page. */
  status() {
    return this.archive.outbox.status();
  }

  stop() {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #pass() {
    if (this.now() < this.#downUntil) return;
    // One engine for the whole pass, read once.
    const store = this.getStore();
    if (!store) return;
    do {
      this.#again = false;
      for (;;) {
        if (this.#stopped) return;
        const rows = this.archive.outbox.ready(this.now(), BATCH);
        if (!rows.length) break;
        const held = new Set();
        for (const row of rows) {
          if (this.#stopped) return;
          if (held.has(row.item_id)) continue;
          try {
            await this.#send(store, row);
            this.archive.outbox.done(row.id);
          } catch (e) {
            // Memory stopped while this row was with the engine: whatever the engine answered, writing it down threw
            // on the closed archive. Nothing is recorded; the row stays queued for the next start.
            if (this.#stopped) return;
            const msg = String(/** @type {any} */ (e)?.message || e);
            const kind = /** @type {any} */ (e)?.kind;
            const n = row.attempts + 1;
            const next = this.now() + OUTBOX_BACKOFF_MS[Math.min(n, OUTBOX_BACKOFF_MS.length) - 1];
            if (!kind) {
              // Down or timed out (no kind): down for every item. The pass stops, and the whole queue waits.
              this.archive.outbox.retry(row.id, msg, next);
              this.#downUntil = next;
              return;
            }
            if (kind === "args" || n >= OUTBOX_MAX_ATTEMPTS) {
              // The engine refuses this write as malformed, or keeps raising on it: set it aside; the rest go on.
              this.archive.outbox.dead(row.id, msg);
              this.log("warn", `memory: the engine did not take a ${row.op} for i${row.item_id} (${msg.slice(0, 120)}); it stands without that write`);
              continue;
            }
            // The engine raised on this write, so it is up: this item waits, the others go on.
            this.archive.outbox.retry(row.id, msg, next);
            held.add(row.item_id);
          }
        }
      }
    } while (this.#again && !this.#stopped);
  }

  // The engine's answer to one row, read against the item as it is now: a mirror of an item retired meanwhile, or one
  // that already has its copy, has nothing to send; an invalidate of an item with no copy neither.
  async #send(store, row) {
    const it = this.archive.items.get(row.item_id);
    if (!it) return;
    if (row.op === "mirror") return this.#mirror(store, it, row.args);
    if (row.op === "invalidate") {
      const id = row.args.id || it.memory_id;
      if (!id) return;
      // The engine keeps one row per text, so claims with the same words share it: it stays valid while one stands.
      if (this.archive.items.byMemoryId(id).some((x) => x.id !== it.id && !isRetired(x.status))) return;
      await store.invalidate(id, row.args.replacement ? `filament:i${row.args.replacement}` : null);
      return;
    }
    // restore: the copy comes back; one the engine no longer holds is stored afresh.
    if (it.memory_id && (await store.restore(it.memory_id))?.ok !== false) return;
    if (it.memory_id) this.archive.items.setMemoryId(it.id, null);
    return this.#mirror(store, { ...it, memory_id: null }, row.args);
  }

  async #mirror(store, it, args) {
    if (it.memory_id || isRetired(it.status)) return;
    const r = await store.remember(mirrorArgs(it, args));
    if (r?.id) this.archive.items.setMemoryId(it.id, r.id);
  }

  #schedule() {
    if (this.#stopped) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    let next = null;
    try {
      next = this.archive.outbox.nextAt();
    } catch {
      return; // the archive closed under us
    }
    if (next == null) return;
    this.#timer = setTimeout(() => void this.drain(), Math.max(50, Math.max(next, this.#downUntil) - this.now()));
    this.#timer.unref?.();
  }
}
