// @ts-check
// A sync from a project's Space (proposal_ux §4.14, U5 phase 8 v2; Tell the chats… since HarnessV4_Space_Plan S1): the
// person picks the lanes on its card and presses Tell them — never a timer (open question 3). Each lane's chat is sent
// one message, appended to it: the board
// as it stands, what the other chats and the person wrote in the logbook since that chat's last sync, and the person's
// own words (core/space.js `syncMessage`). Appended, so the turns its agent's cache holds stay as they are. A lane told
// to hear it now gets it as a turn of Filament's own where its chat is at rest — sent through the route a message takes,
// as a wake is — and as a note into its running turn where its agent takes words while it works; else, and for a lane
// told to hear it after its turn, it waits for that turn to end. A chat with a question waiting for the person hears it
// after the answer's turn. Two syncs waiting for one chat go as the newer: it carries the board as it stands. The sync,
// each lane's outcome and a logbook line by Sync are kept in the Space (services/spaces.js), which tells an open Space.
import { SPACE_LIMITS, readerNames, syncMessage, toldWords } from "../core/space.js";

/** How long a lane whose turn just ended waits before it is sent: that turn lets go of the chat first. */
export const SYNC_SETTLE_MS = 300;
/** The most lanes one sync reaches. */
export const SYNC_LANES_MAX = 20;

/**
 * How the runner reaches a lane's chat: `busy`, whether a turn holds it now; `post`, a turn of Filament's own with the
 * sync's message, through the route a message takes — its answer's status and body; `steer`, the message into the
 * chat's running turn, `ok` where its agent takes words while it works.
 * @typedef {{ busy: (chain: string) => boolean, post: (chain: string, text: string) => Promise<{ status: number, body: any }>,
 *   steer: (chain: string, text: string) => { ok: boolean, error?: string } }} SyncReach
 */

/** A sync's message on its way to one lane. @typedef {{ project: string, sync: string, text: string }} Delivery */

/**
 * `nameOf`: a chat's name, as the person reads it; `apart`: whether a chat's words are none of another chat's agent's to
 * read — each lane's message names such a chat as that lane's agent reads it (core/space.js `readerNames`).
 * @param {{ store: import("../services/spaces.js").SpaceStore, reach: SyncReach, projectOf: (chain: string) => string | null,
 *   nameOf: (chain: string) => string, apart?: (chain: string) => boolean, log?: (level: string, msg: string) => void, settleMs?: number, now?: () => number }} o
 */
export function createSpaceSync({ store, reach, projectOf, nameOf, apart, log = () => {}, settleMs = SYNC_SETTLE_MS, now = Date.now }) {
  /** The lanes waiting for their chat's turn to end, one delivery each: the newest sync's. @type {Map<string, Delivery>} */
  const waiting = new Map();
  /** The chats a waiting delivery is being sent to now. @type {Set<string>} */
  const sending = new Set();

  /** @param {Delivery} d @param {string} chain @param {{ state: import("../core/space.js").SyncLane["state"], error?: string }} how */
  const mark = (d, chain, how) => {
    try {
      store.syncLane(d.project, d.sync, chain, how);
    } catch (/** @type {any} */ e) {
      log("warn", `space: a sync's lane could not be noted (${String(e?.message || e)})`);
    }
  };

  /**
   * One delivery as a turn of its own. → "done" once it went or was refused for good; "wait" while a turn holds the
   * chat, or a question waits for the person's answer: it goes when the chat's turn next ends.
   * @param {string} chain @param {Delivery} d @returns {Promise<"done" | "wait">}
   */
  async function send(chain, d) {
    /** @type {{ status: number, body: any }} */
    let r;
    try {
      r = await reach.post(chain, d.text);
    } catch (/** @type {any} */ e) {
      mark(d, chain, { state: "refused", error: `Filament could not send it (${String(e?.message || e)})` });
      return "done";
    }
    if (r.status >= 200 && r.status < 300) {
      mark(d, chain, { state: "sent" });
      return "done";
    }
    if (r.status === 409 && (r.body?.sync === "asking" || r.body?.holder)) return "wait";
    mark(d, chain, { state: "refused", error: String(r.body?.error || `HTTP ${r.status}`) });
    return "done";
  }

  /**
   * A delivery set to wait for its chat's turn to end; one already waiting there is replaced, said so. A chat that is
   * at rest by now is tried at once.
   * @param {string} chain @param {Delivery} d
   */
  function park(chain, d) {
    const was = waiting.get(chain);
    if (was && was.sync !== d.sync) mark(was, chain, { state: "refused", error: "a newer sync took its place: it carries the board as it stands" });
    waiting.set(chain, d);
    if (!reach.busy(chain)) void flush(chain, 0);
  }

  /**
   * The delivery waiting for a chat goes, once its turn has let go of it: tried once; still held, it waits for the
   * next end.
   * @param {string} chain @param {number} settle
   */
  async function flush(chain, settle) {
    if (sending.has(chain) || !waiting.has(chain)) return;
    sending.add(chain);
    try {
      if (settle) await new Promise((r) => setTimeout(r, settle).unref?.());
      const d = waiting.get(chain);
      if (!d || reach.busy(chain)) return;
      const out = await send(chain, d);
      if (out === "done" && waiting.get(chain) === d) waiting.delete(chain);
    } finally {
      sending.delete(chain);
    }
  }

  /**
   * One lane reached as it asked: now — a turn of its own, or a note into its running turn — or after its turn.
   * @param {string} chain @param {"now" | "after"} when @param {Delivery} d
   */
  function deliver(chain, when, d) {
    if (reach.busy(chain)) {
      if (when === "now") {
        const s = reach.steer(chain, d.text);
        if (s.ok) return mark(d, chain, { state: "steered" });
      }
      return park(chain, d);
    }
    void send(chain, d).then((out) => {
      if (out === "wait") park(chain, d);
    });
  }

  return {
    /**
     * Run a sync the person asked for: its lanes checked — each a chat of this project, named once — each lane's
     * message written as the Space stands now, the sync kept with a logbook line by Sync, then each lane reached.
     * `asks`: the open asks to tell it carries (E42 SA-D7, case 21b) — each chat reads "<chat> asked that you be told:
     * …", never as the person's own words, and each ask is told.
     * `ready`: called once its lanes, its words and its asks are checked, before the sync is written: the person's row
     * makes the project's Space there, where it has none (by need, 11-12: http/admin/spaces.js `byNeed`). Run with
     * none, a sync of a project with no Space is refused by the store, as every write is.
     * @param {string} project @param {{ lanes?: unknown, also?: unknown, asks?: unknown }} input @param {{ ready?: () => void }} [o]
     * @returns {{ ok: true, sync: import("../core/space.js").SpaceSync } | { ok: false, error: string }}
     */
    run(project, input, { ready } = {}) {
      const asked = Array.isArray(input?.lanes) ? input.lanes : [];
      /** @type {{ chain: string, when: "now" | "after" }[]} */
      const lanes = [];
      for (const l of asked) {
        const chain = String(l?.chain ?? "").trim();
        if (!chain || lanes.some((x) => x.chain === chain)) continue;
        if (projectOf(chain) !== project) return { ok: false, error: `"${nameOf(chain)}" is no chat of this project` };
        lanes.push({ chain, when: l?.when === "after" ? "after" : "now" });
      }
      if (!lanes.length) return { ok: false, error: "a sync reaches one chat at least: pick the chats it goes to" };
      if (lanes.length > SYNC_LANES_MAX) return { ok: false, error: `a sync reaches ${SYNC_LANES_MAX} chats at most` };
      const also = String(input?.also ?? "").replace(/\r\n?/g, "\n").trim();
      if (also.length > SPACE_LIMITS.also) return { ok: false, error: `what you add is ${SPACE_LIMITS.also} characters at most; this is ${also.length}` };
      /** @type {{ id: string, chain: string, byName: string, words: string }[]} */
      let told = [];
      try {
        const rows = Array.isArray(input?.asks) ? [...new Set(input.asks.map(String))] : [];
        told = rows.length ? store.tellAsks(project, rows) : [];
      } catch (/** @type {any} */ e) {
        return { ok: false, error: String(e?.message || e) };
      }
      ready?.();
      const doc = store.get(project);
      const at = now();
      /** Each lane's last sync that reached it: its message says what changed since then. @param {string} chain */
      const sinceOf = (chain) => doc.syncs.filter((s) => s.lanes.some((l) => l.chain === chain && (l.state === "sent" || l.state === "steered"))).at(-1)?.at ?? null;
      const texts = new Map(lanes.map((l) => [l.chain, syncMessage({ doc, chain: l.chain, since: sinceOf(l.chain), also, at, ...readerNames({ nameOf, apart }, l.chain), asked: told.filter((t) => t.chain !== l.chain) })]));
      const sync = store.startSync(project, { lanes, also });
      // An ask's words are its chat's, said as its (the Designer: never in Also tell them…, which is the person's).
      // The asker's own lane reads no ask of its own. The line keeps what it says, so an agent's read names each chat as
      // that agent may read it (core/space.js `logWords`).
      /** @type {import("../core/space.js").SyncTold} */
      const said = { chains: lanes.map((l) => l.chain), asks: told.map((t) => ({ chain: t.chain, byName: t.byName, words: t.words })), also };
      try {
        store.write(project, toldWords(said, nameOf), { kind: "sync" }, null, said);
      } catch (/** @type {any} */ e) {
        log("warn", `space: a sync's logbook line could not be written (${String(e?.message || e)})`);
      }
      // Done once a send carries their words (case 21b).
      try {
        store.asksTold(project, told.map((t) => t.id));
      } catch (/** @type {any} */ e) {
        log("warn", `space: the asks a sync told could not be marked (${String(e?.message || e)})`);
      }
      for (const l of lanes) deliver(l.chain, l.when, { project, sync: sync.id, text: /** @type {string} */ (texts.get(l.chain)) });
      log("info", `space: a sync of ${project} to ${lanes.length} lane${lanes.length === 1 ? "" : "s"}, on the person's word`);
      return { ok: true, sync };
    },

    /** A chat's turn ended (the turn lock let go of it): the sync waiting for it goes. @param {string} chain */
    released(chain) {
      if (waiting.has(chain)) void flush(chain, settleMs);
    },

    /** The chats a sync waits for, and the sync's id (the Space shows them; the tests read them). */
    waitingFor: () => new Map([...waiting].map(([chain, d]) => [chain, d.sync])),
  };
}

/** @typedef {ReturnType<typeof createSpaceSync>} SpaceSyncRunner */
