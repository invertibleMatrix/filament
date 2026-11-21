// @ts-check
// One turn at a time in a chat of the harness's own (HarnessV3 Step 3, D12). The holder is the harness's turn — one it
// runs, or one a coding agent began by itself (HarnessV3-ACP AC3-9) — or the chat's move to another folder (GW-D83). In
// memory only: it guards live traffic, not stored state. A harness turn takes it around the whole turn, in a chat nothing
// else runs in too; commands, housekeeping, count_tokens, Filament's own ticks and an outside client's requests never do
// — a client's chat is its own, its requests passed on as its client sends them. The turn belongs to the server, not the
// connection: closing the tab releases nothing, and no silence does (HarnessV4_Tasks A1) — a turn at work on a long
// command writes nothing to a page that went away. Its end frees the chat; Stop reaches it until then.
//
// The lock is keyed by the chat's chain key, the key every holder of the chat names it by.

/**
 * @typedef {object} TurnHolder
 * @property {string} window  who holds it: `harness`, or the chat's move (`move`, app/sessions/move.js `MOVE_WINDOW`)
 * @property {string | null} client  the holder's client label (the harness, the move's words)
 * @property {string | null} label  the holder's words for a person (Facade D13): "the harness", the move's, or the agent's
 *   whose turn of its own it is
 * @property {number} since  when the turn started (ms)
 * @property {number} idleMs  how long since the holder's last renewal (its request named, a streamed chunk, a phase)
 * @property {string | null} requestId  the live request id, once the pipeline has minted one
 * @property {TurnPhase | null} phase  what the turn does before its request reaches the model, when that takes a while
 * @property {{ agent: string } | null} own  a turn a coding agent began by itself (HarnessV3-ACP AC3-9): whose
 */

/**
 * The part of a turn that runs before its request is sent, said while it lasts (HarnessV3-CodebasePass decision 1): a
 * compaction at the line writes its summary first, which can take minutes, and the page has no run to draw yet;
 * memory recalls (HarnessV3-FailurePoints §5.1 item 3); a coding agent starts, opens or
 * resumes its session, and switches its mode, model or effort (§5.1 item 2); a worktree just made gets its project's
 * template copied in (HarnessV4_Four_Plan FO-D36).
 * @typedef {object} TurnPhase
 * @property {"compacting" | "recalling" | "agent" | "copying"} kind
 * @property {string | null} method  the session's compaction method (`context.compaction.method`)
 * @property {number} since  when the phase began (ms)
 * @property {AgentStep} [step]  the agent's step, by name (`agent`)
 * @property {string} [agent]  the agent's name, as the turn says it (`agent`)
 * @property {string} [to]  the mode, model or effort the step switches to
 * @property {boolean} [skippable]  Send without it lets the wait go: a summary Filament writes (the filament-agent plan's
 *   D6), memory's lookups and its capture (`sendWithout`), a worktree's copy — the sessions service's `skipWait`
 * @property {{ done: number, total: number, entry: string }} [copy]  the copy's bytes so far, of all, and the path
 *   it is at (`copying`)
 */

/**
 * A coding agent's step before its session is up: its process starting (and its handshake), its session resumed or
 * opened, its commands waited for (HarnessV4_Tasks B6), its mode, model or effort switched.
 * @typedef {"starting" | "resuming" | "opening" | "commands" | "mode" | "model" | "effort"} AgentStep
 */

/**
 * @typedef {object} AcquireResult
 * @property {boolean} ok  the turn may run
 * @property {string | null} [token]  the release/renew handle (present when ok)
 * @property {TurnHolder | null} [busy]  who holds it (present when not ok)
 */

export class SessionTurns {
  /** Every session's holder changes, wherever the app wired them (server.js: the events feed's `turns`). @type {((key: string, holder: TurnHolder | null) => void) | null} */
  onHolder = null;
  /** @type {Map<string, { window: string, client: string | null, since: number, last: number, token: string, requestId: string | null, phase?: TurnPhase | null, letGo?: AbortController | null, own: { agent: string } | null }>} */
  #holders = new Map();
  /** @type {Map<string, Set<(holder: TurnHolder | null) => void>>} */
  #subs = new Map();

  /**
   * `labelOf` (Facade D13) stamps every snapshot with the holder's words: the app hands `holderLabel` in, so the
   * lock imports nothing from memory.
   * @param {{ now?: () => number, log?: (level: string, msg: string) => void, labelOf?: ((holder: { window: string, client: string | null, own: { agent: string } | null }) => string) | null }} [o]
   */
  constructor({ now = () => Date.now(), log = () => {}, labelOf = null } = {}) {
    this.now = now;
    this.log = log;
    this.labelOf = labelOf;
  }

  /** The snapshot's shape, `label` included (D13). @param {{ window: string, client: string | null, since: number, last: number, requestId: string | null, phase?: TurnPhase | null, own: { agent: string } | null }} h */
  #snapshot(h) {
    return {
      window: h.window,
      client: h.client,
      label: this.labelOf ? this.labelOf(h) : null,
      since: h.since,
      idleMs: this.now() - h.last,
      requestId: h.requestId,
      phase: h.phase || null,
      own: h.own,
    };
  }

  /** A listener's failure is logged and never reaches the lock: a broken viewer must not break a turn. */
  #notify(fn, ...args) {
    try {
      fn(...args);
    } catch (e) {
      const m = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
      this.log("warn", `session turns: holder listener failed (${m})`);
    }
  }

  #emit(key, holder) {
    if (this.onHolder) this.#notify(this.onHolder, String(key), holder);
    for (const fn of this.#subs.get(key) || []) this.#notify(fn, holder);
  }

  /**
   * The lock's snapshot. → the holder, or null.
   * @param {string} key
   * @returns {TurnHolder | null}
   */
  holder(key) {
    const h = this.#holders.get(String(key));
    return h ? this.#snapshot(h) : null;
  }

  /**
   * Every chat's current holder, for the sidebar's resync (Facade D11). The lock knows keys only — mapping a key to its
   * chain id (and leaving a key that names no chain out) is the caller's, through the archive.
   * @returns {{ key: string, window: string, client: string | null, label: string | null, since: number, idleMs: number, requestId: string | null, phase: TurnPhase | null, own: { agent: string } | null }[]}
   */
  holders() {
    return [...this.#holders].map(([key, h]) => ({ key, ...this.#snapshot(h) }));
  }

  /**
   * Take the lock for a turn, or learn who holds it: one turn at a time, a second take refused whoever asks — the
   * harness's own second send too, which the sessions service answers by its rule (409 and the steer mailbox). `own`:
   * the turn is one a coding agent began by itself (HarnessV3-ACP AC3-9), which the holder says.
   * @param {string} key
   * @param {{ window?: string, client?: string | null, own?: { agent: string } | null }} [o]
   * @returns {AcquireResult}
   */
  acquire(key, { window = "", client = null, own = null } = {}) {
    const k = String(key);
    const held = this.holder(k);
    if (held) return { ok: false, busy: held };
    const token = `${String(window)}:${this.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    this.#holders.set(k, { window: String(window), client, since: this.now(), last: this.now(), token, requestId: null, own });
    this.#emit(k, this.holder(k));
    return { ok: true, token };
  }

  /**
   * The holder's heartbeat: where `idleMs` counts from — its request named, each streamed chunk of its reply. Unknown
   * tokens (the turn ended) change nothing.
   * @param {string} key @param {string | null} token @param {{ requestId?: string | null }} [o]
   */
  renew(key, token, o = {}) {
    const h = this.#holders.get(String(key));
    if (!h || h.token !== token) return false;
    h.last = this.now();
    if (o.requestId) h.requestId = String(o.requestId);
    return true;
  }

  /**
   * What the held turn is doing before its request is sent (`null` when it is done with it), announced to every
   * listener as a holder change — the page's own turn shows it, and so does a tab that follows the session. A
   * renewal too: the phase is the holder at work. Unknown tokens change nothing.
   * @param {string} key @param {string | null} token @param {TurnPhase | null} phase
   */
  setPhase(key, token, phase) {
    const h = this.#holders.get(String(key));
    if (!h || h.token !== token) return false;
    h.last = this.now();
    h.phase = phase
      ? {
          kind: phase.kind,
          method: phase.method ?? null,
          since: Number(phase.since) || this.now(),
          ...(phase.skippable ? { skippable: true } : {}),
          ...(phase.step ? { step: phase.step, agent: String(phase.agent || ""), ...(phase.to ? { to: String(phase.to) } : {}) } : {}),
          ...(phase.copy ? { copy: { done: Number(phase.copy.done) || 0, total: Number(phase.copy.total) || 0, entry: String(phase.copy.entry || "") } } : {}),
        }
      : null;
    this.#emit(String(key), this.holder(String(key)));
    return true;
  }

  /**
   * The held turn's memory waits (HarnessV3-FailurePoints §5.1 item 3): each is the turn's phase while it lasts, and
   * `sendWithout` lets it go. A token that does not hold the lock waits unseen, and nothing lets it go.
   * @param {string} key @param {string} token
   * @returns {import("./memory/brain.js").MemoryWaiting}
   */
  waiting(key, token) {
    const k = String(key);
    return ({ kind }) => {
      const ctl = new AbortController();
      const h = this.#holders.get(k);
      if (h && h.token === token) h.letGo = ctl;
      this.setPhase(k, token, { kind, method: null, since: this.now(), skippable: true });
      return {
        signal: ctl.signal,
        end: () => {
          const now = this.#holders.get(k);
          if (now?.letGo === ctl) now.letGo = null;
          this.setPhase(k, token, null);
        },
      };
    };
  }

  /** Send without it: the memory work the held turn waits on is let go. → whether it waited on any. @param {string} key */
  sendWithout(key) {
    const ctl = this.#holders.get(String(key))?.letGo;
    if (!ctl || ctl.signal.aborted) return false;
    ctl.abort();
    return true;
  }

  /**
   * Give the lock up — the harness's turn or its cancel ending, a move done. Unknown tokens (a turn that ended
   * already) release nothing.
   * @param {string} key @param {string | null} token
   */
  release(key, token) {
    const h = this.#holders.get(String(key));
    if (!h || h.token !== token) return false;
    this.#holders.delete(String(key));
    this.#emit(String(key), null);
    return true;
  }

  /**
   * Holder changes for a session (a coding agent's own turn waiting for it to be free, app/own-turns.js; Stop and
   * compact's wait for its turn's end, the sessions service). The listener fires once with the current holder right
   * away. → the unsubscribe.
   * @param {string} key @param {(holder: TurnHolder | null) => void} fn
   */
  onChange(key, fn) {
    const k = String(key);
    const set = this.#subs.get(k) || new Set();
    this.#subs.set(k, set);
    set.add(fn);
    queueMicrotask(() => fn(this.holder(k)));
    return () => {
      set.delete(fn);
      if (!set.size) this.#subs.delete(k); // no dead Set per session key that ever had a listener
    };
  }

  /** How many chats hold a turn (the tray's badge). */
  get count() {
    return this.#holders.size;
  }
}

/**
 * The holder's heartbeat on the one sink every reply path writes through (D12): each chunk of the reply renews it, so
 * the holder's `idleMs` says how long the turn has been silent. The sessions service wires it for the harness's turns.
 * @param {{ write: (...args: any[]) => boolean }} res @param {SessionTurns} turns @param {string} key @param {string} token
 */
export function renewOnWrite(res, turns, key, token) {
  const write = res.write.bind(res);
  res.write = (/** @type {any[]} */ ...args) => {
    turns.renew(key, token);
    return write(...args);
  };
}
