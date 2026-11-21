// @ts-check
// The providers as a Settings page holds them (HarnessV4_Settings_Plan HS-2, HS-D3): every upstream in the page's words
// (GET /api/upstreams), read at a version, and the writes that each name one of them — add one, change one, remove
// one. A write names the version the page read; the server refuses it when that provider changed since (a sign-in's
// tokens, the console), and the page then reads them all again, so what it shows is what is. A save heard on the events
// stream reads them again unless it was the page's own, which the write's answer already holds (ui/lib/config-follow.js:
// the page has no draft, so it never shows a bar). Settings › Providers and a coding agent's card each hold one.
import { followConfig } from "../../lib/config-follow.js";

/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);

/**
 * The words a refused write is said in: a provider changed elsewhere since the page read it — the page reads it again,
 * so the person sees it as it is and does their change again if they still want it.
 * @param {any} e @param {string} name
 */
export function refusedWords(e, name) {
  if (!e?.body?.stale) return errText(e);
  const first = Array.isArray(e.body.changes) && e.body.changes.length ? `: ${e.body.changes[0]}${e.body.changes.length > 1 ? ` and ${e.body.changes.length - 1} more` : ""}` : "";
  return `${name} changed elsewhere since this page read it${first}. It now shows as it is: make your change again if you still want it.`;
}

/**
 * @param {(path: string, o?: any) => Promise<any>} call  the admin API
 * @param {(fn: (msg: any) => void) => () => void} [subscribe]  the events stream (lib/bus.js `onBus`)
 */
export function providersState(call, subscribe) {
  /** @type {any[] | null} */
  let upstreams = null;
  /** @type {string | null} */
  let failed = null;
  /** @type {Set<() => void>} */
  const listeners = new Set();
  const tell = () => {
    for (const fn of [...listeners]) fn();
  };
  const take = (/** @type {any} */ r) => {
    upstreams = Array.isArray(r?.upstreams) ? r.upstreams : [];
    failed = null;
    tell();
    return Number(r?.version) || 0;
  };
  const follow = followConfig({
    dirty: () => false,
    reload: async () => take(await call("/upstreams")),
    changes: async () => ({ count: null, changes: null }),
    bar: () => {},
  });

  async function read() {
    try {
      follow.loaded(take(await call("/upstreams")));
    } catch (e) {
      failed = errText(e);
      tell();
    }
  }

  /** One provider as a write answered it, in place of the page's copy. @param {any} u */
  const took = (u) => {
    if (!u || !upstreams) return;
    const i = upstreams.findIndex((x) => x.id === u.id);
    if (i >= 0) upstreams[i] = u;
    else upstreams.push(u);
  };

  /**
   * One write of the page's: its answer's version is the page's own when nothing landed between; a stale refusal reads
   * every provider again before it is thrown on.
   * @template T @param {() => Promise<T & { version: number }>} fn @returns {Promise<T & { version: number }>}
   */
  const write = (fn) =>
    follow.own(async () => {
      try {
        const r = await fn();
        follow.adopt(r.version);
        return r;
      } catch (e) {
        if (/** @type {any} */ (e)?.body?.stale) await read();
        throw e;
      } finally {
        tell();
      }
    });

  const path = (/** @type {string} */ id) => `/upstreams/${encodeURIComponent(id)}`;
  /** @type {(() => void) | null} */
  let off = null;

  return {
    /** Every provider, or null before the first read. */
    all: () => upstreams,
    /** @param {string} id */
    get: (id) => upstreams?.find((u) => u.id === id) || null,
    /** Why the last read failed, while nothing has been read. */
    failed: () => (upstreams ? null : failed),
    read,
    /**
     * One provider's fields changed; answers the provider as it now stands.
     * @param {string} id @param {Record<string, any>} patch
     */
    patch: async (id, patch) => (await write(async () => {
      const r = await call(path(id), { method: "PATCH", body: { ...patch, base: follow.base() } });
      took(r.upstream);
      return r;
    })).upstream,
    /** A provider added; answers it. @param {Record<string, any>} body */
    add: async (body) => (await write(async () => {
      const r = await call("/upstreams", { method: "POST", body });
      took(r.upstream);
      return r;
    })).upstream,
    /**
     * A provider removed, and its prefix route; `also` takes the other routes that name it too. Those routes were
     * other providers' as well, so every provider is read again.
     * @param {string} id @param {boolean} [also]
     */
    remove: async (id, also = false) => {
      const r = await write(() => call(`${path(id)}${also ? "?also=1" : ""}`, { method: "DELETE" }));
      await read();
      return r;
    },
    /** What goes with a provider (HS-D15). @param {string} id */
    removal: (id) => call(`${path(id)}/removal`),
    /** @param {() => void} fn @returns {() => void} */
    listen(fn) {
      listeners.add(fn);
      if (!off && subscribe)
        off = subscribe((msg) => {
          if (msg?.type === "config-changed") follow.heard(msg.version);
          else if (msg?.type === "hello") void read();
        });
      return () => {
        listeners.delete(fn);
        if (!listeners.size && off) {
          off();
          off = null;
        }
      };
    },
  };
}
