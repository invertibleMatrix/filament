// @ts-check
// The console's draft against the configuration as it stands (HarnessV4_Settings_Plan HS-D3). The draft was read at a
// version; every save moves the server's version and says so on the events stream (`config-changed`). A newer version
// than the draft's is someone else's change — the harness's, a sign-in's, another window's — unless this page made it:
// - a clean draft reads the configuration again, quietly;
// - an edited one shows the bar "Changed in another window: Reload | Keep mine", naming what changed, and its Save
//   names the draft's version, so the server refuses it (409, with what changed) rather than undo that change;
// - Keep mine takes the newer version as the draft's own: the next Save overwrites the change, as the bar says. The
//   Save names the version the draft was read at as well (`read`), and the server takes each secret the draft never
//   changed as it stands, so Keep mine never undoes a key rotated or a sign-in made in the other window.
// The page's own writes count as its own: a whole save's answer is the configuration at its version (`loaded`); a
// narrow write the page merged into its draft by hand (`adopt`) is taken only when it follows straight on, so a change
// that landed between is never swallowed. A version heard while a write of the page is on its way waits for its answer.

/**
 * @param {{
 *   dirty: () => boolean,
 *   reload: () => Promise<number | null>,
 *   changes: (since: number) => Promise<{ count: number | null, changes: string[] | null }>,
 *   bar: (said: { count: number | null, changes: string[] | null } | null) => void,
 * }} io
 *   `reload` reads the configuration again into a clean draft and answers its version (null when an edit began
 *   meanwhile, so it kept the draft); `changes` asks what changed since a version; `bar` shows the bar, or hides it.
 */
export function followConfig(io) {
  /** The version the draft's Save overwrites: the one it was read at, or a newer one Keep mine took. */
  let version = 0;
  /** The version the draft was read at: its secrets' placeholders stand for the values read with it. */
  let read = 0;
  /** The newest version the server said. */
  let newest = 0;
  /** This page's writes on their way. */
  let writing = 0;
  /** Whether the bar is up, and for which newest version. */
  let barFor = 0;
  let checking = false;

  /** What the server says now, against the draft; once more when a newer version was heard meanwhile. */
  const check = async () => {
    if (checking || writing || newest <= version) return;
    checking = true;
    const asked = newest;
    try {
      if (!io.dirty()) {
        const v = await io.reload();
        if (v != null) {
          version = v;
          read = v;
          newest = Math.max(newest, v);
        }
      }
      if (newest > version && io.dirty() && barFor !== newest) {
        barFor = newest;
        const at = newest;
        const said = await io.changes(version).catch(() => ({ count: null, changes: null }));
        if (barFor === at && newest > version) io.bar(said);
      }
    } catch {
      // The read failed (Filament restarting): the next version heard, or the stream's reconnect, asks again.
      return;
    } finally {
      checking = false;
    }
    if (newest > asked) check();
  };

  const hideBar = () => {
    if (barFor) io.bar(null);
    barFor = 0;
  };

  return {
    /** The version a Save names. */
    base: () => version,
    /** The version the draft was read at, which a Save names beside its base. */
    read: () => read,
    /** The page holds the configuration as of `v`: a full read, or a whole save's answer. @param {number} v */
    loaded(v) {
      version = v;
      read = v;
      newest = Math.max(newest, v);
      hideBar();
    },
    /** A write of this page made `v` and the page merged it into its draft itself. @param {number} v */
    adopt(v) {
      if (Number.isInteger(v) && v === version + 1) {
        if (read === version) read = v;
        version = v;
      }
      newest = Math.max(newest, Number(v) || 0);
    },
    /** The events stream said a save. @param {number} v */
    heard(v) {
      if (!Number.isInteger(v)) return;
      newest = Math.max(newest, v);
      check();
    },
    /** A Save the server refused as stale: the bar, with what its answer says changed. @param {{ version?: number, count?: number | null, changes?: string[] | null }} body */
    refused(body) {
      newest = Math.max(newest, Number(body?.version) || 0);
      barFor = newest;
      io.bar({ count: body?.count ?? body?.changes?.length ?? null, changes: body?.changes ?? null });
    },
    /** Keep mine: the draft takes the newest version as its own; the next Save overwrites the change. */
    keepMine() {
      version = newest;
      hideBar();
    },
    /** An edit ended unsaved (Discard, a sheet closed): a draft clean again reads a newer version now. */
    settled() {
      if (io.dirty()) return;
      hideBar();
      check();
    },
    /**
     * Run one of this page's writes; what the stream says meanwhile waits for its answer.
     * @template T @param {() => Promise<T>} fn @returns {Promise<T>}
     */
    async own(fn) {
      writing += 1;
      try {
        return await fn();
      } finally {
        writing -= 1;
        check();
      }
    },
  };
}
