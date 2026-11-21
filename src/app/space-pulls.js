// @ts-check
// A board's pulls at work (the Space Apps plan of 10-29, decision 7; core/space-pulls.js): each read through its
// connector's tool — one its server marks read-only, asked again at each read (app/space-tools.js) — as the board is
// shown, again once its read is older than `PULL_EVERY_MS`, what it read last standing meanwhile, faint where its last
// read failed; its cards as the page and the agents' board read show them; the Pull sheet's Read once, which keeps
// nothing; and a card's move — on the board only, or back to its service through the pull's tool when the person says
// so, once or always for that board. The service wins: a move here stands while it says the state the card had. Only
// the person moves a card back: no agent reaches this.
import { PULL_EVERY_MS, PULL_PRESETS, backArgs, backStates, keyWords, laneOfKey, pullCards, pullGuess, pullRows, toState } from "../core/space-pulls.js";
import { COLUMN_WORDS, isColumn } from "../core/space.js";

/** @typedef {import("../core/space-pulls.js").SpacePull} SpacePull @typedef {import("../core/space-pulls.js").PullRow} PullRow */
/**
 * A pull's reads, while Filament runs: what it read last (`at`, `rows`), why its last read failed and when, the read
 * under way; `sig`, what it read with — a pull changed in its sheet reads afresh.
 * @typedef {{ sig: string, at: number, rows: PullRow[], error: string, errorAt: number, reading: Promise<void> | null, ctl: AbortController | null }} PullState
 */

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });
/** An error's words. @param {any} e */
const said = (e) => String(e?.message || e || "it failed");

/**
 * @param {{ spaces: import("../services/spaces.js").SpaceStore,
 *   tools: () => { read: (project: string, tool: import("../core/dashboard-sources.js").Tool, signal?: AbortSignal) => Promise<import("../core/dashboard-sources.js").CommandOut>,
 *     act: (project: string, tool: import("../core/dashboard-sources.js").Tool, args: Record<string, unknown>, signal?: AbortSignal) => Promise<import("../core/dashboard-sources.js").ActionOut>,
 *     toolsOf: (project: string, connection: string) => Promise<{ ok: true, tools: { name: string, readOnly: boolean, description: string }[] } | { ok: false, error: string }> } | null,
 *   events?: { publish: (topic: string, data: any) => void } | null, now?: () => number, log?: (level: string, msg: string) => void }} deps
 *   `tools`: a connection's tools (app/space-tools.js), null while Filament starts; `events`: where a read that brought
 *   something new is said, so an open Space draws again
 */
export function createPulls({ spaces, tools, events = null, now = Date.now, log = () => {} }) {
  /** @type {Map<string, PullState>} */
  const reads = new Map();
  /** The moves going back now, by project, pull and key: one at a time for a card. @type {Set<string>} */
  const moving = new Set();
  /** @param {string} project @param {string} id */
  const keyOf = (project, id) => `${project}\n${id}`;
  /** What a pull reads with. @param {SpacePull} p */
  const sigOf = (p) => JSON.stringify([p.connection, p.tool, p.args, p.rows, p.key, p.name, p.state, p.url, p.line]);

  /** A pull's reads, afresh where it reads with something else now. @param {string} project @param {SpacePull} p */
  function stateOf(project, p) {
    const k = keyOf(project, p.id);
    let s = reads.get(k);
    if (!s || s.sig !== sigOf(p)) {
      s?.ctl?.abort();
      s = { sig: sigOf(p), at: 0, rows: [], error: "", errorAt: 0, reading: null, ctl: null };
      reads.set(k, s);
    }
    return s;
  }

  /** A project's pull, or the refusal. @param {string} project @param {string} id */
  function pullOf(project, id) {
    const p = (spaces.get(project).pulls || []).find((x) => x.id === id);
    if (!p) throw refused(404, `There is no pull "${String(id).slice(0, 40)}" on this board.`);
    return p;
  }

  /**
   * A pull read: once at a time, its rows kept where they read, its failure where not; an open Space told either way.
   * @param {string} project @param {SpacePull} p @returns {Promise<void>}
   */
  function readPull(project, p) {
    const s = stateOf(project, p);
    if (s.reading) return s.reading;
    const ctl = new AbortController();
    s.ctl = ctl;
    s.reading = (async () => {
      const t = tools();
      const out = t ? await t.read(project, { connection: p.connection, name: p.tool, args: p.args }, ctl.signal) : { ok: /** @type {const} */ (false), error: "Filament is still starting" };
      if (ctl.signal.aborted) return;
      const rows = out.ok ? pullRows(p, out.out) : out;
      if (rows.ok) {
        s.rows = rows.rows;
        s.at = now();
      } else {
        s.error = `${p.connection} › ${p.tool}: ${rows.error}`;
        s.errorAt = now();
      }
    })()
      .catch((e) => {
        s.error = `${p.connection} › ${p.tool}: ${said(e)}`;
        s.errorAt = now();
        log("warn", `space pulls: ${p.title} of ${project} was not read (${said(e).slice(0, 160)})`);
      })
      .finally(() => {
        s.reading = null;
        s.ctl = null;
        if (!ctl.signal.aborted) events?.publish("space", { type: "space", project, pull: p.id });
      });
    return s.reading;
  }

  /** Whether a pull's read is due: never read, or read — or failed — longer ago than its every. @param {PullState} s */
  const due = (s) => !s.reading && now() - Math.max(s.at, s.errorAt) >= PULL_EVERY_MS;

  return {
    /** What the Pull sheet starts from for each service (core/space-pulls.js `PULL_PRESETS`). */
    presets: () => PULL_PRESETS.map((p) => structuredClone(p)),

    /** A connector's tools, as the Pull sheet offers them: its server asked now, nothing called. @param {string} project @param {string} connection */
    async toolsOf(project, connection) {
      if (!connection.trim()) throw refused(400, "name the connector");
      const t = tools();
      return t ? t.toolsOf(project, connection.trim()) : { ok: false, error: "Filament is still starting" };
    },

    /**
     * Read once, from the Pull sheet: the tool called as a pull would call it — read-only, asked now — and what its
     * answer holds, guessed from the service's preset (`pullGuess`); nothing kept.
     * @param {string} project @param {any} b  `{ service, connection, tool, args }`
     */
    async tryRead(project, b) {
      if (typeof b?.connection !== "string" || !b.connection.trim()) throw refused(400, "name the connector it reads through");
      if (typeof b.tool !== "string" || !b.tool.trim()) throw refused(400, "name the tool that lists its issues");
      if (b.args != null && (typeof b.args !== "object" || Array.isArray(b.args))) throw refused(400, "its args are a JSON object");
      const t = tools();
      if (!t) return { ok: false, error: "Filament is still starting" };
      const out = await t.read(project, { connection: b.connection.trim(), name: b.tool.trim(), args: b.args || {} });
      if (!out.ok) return { ok: false, error: out.error };
      const preset = PULL_PRESETS.find((x) => x.service === b.service) || {};
      return pullGuess(out.out, b.paths && typeof b.paths === "object" ? { ...preset, ...b.paths } : preset);
    },

    /**
     * The cards a project's pulls put on its board, as the page draws them and an agent's board read says them: each a
     * row of its service — its key as the service says it, the lane Start a chat on this names after it, its link —
     * in its column, faint where its pull's last read failed since. A pull never read says it reads, or why it did
     * not, in its count. A read that is due starts; what was read last stands meanwhile.
     * @param {string} project
     */
    cards(project) {
      /** @type {{ pull: string, service: string, title: string, key: string, keyWords: string, task: string, line: string, column: string, state: string, url: string, lane: string, moved: boolean, at: number, stale: boolean }[]} */
      const tasks = [];
      /** @type {{ pull: string, title: string, count: number, more: number, done: number, error?: string, reading?: boolean }[]} */
      const counts = [];
      for (const p of spaces.get(project).pulls || []) {
        const s = stateOf(project, p);
        if (due(s)) void readPull(project, p);
        if (!s.at) {
          counts.push({ pull: p.id, title: p.title, count: 0, more: 0, done: 0, ...(s.error && !s.reading ? { error: s.error } : { reading: true }) });
          continue;
        }
        const stale = !!s.error && s.errorAt >= s.at;
        const { cards, more, done } = pullCards(p, s.rows, now());
        for (const c of cards)
          tasks.push({ pull: p.id, service: p.service, title: p.title, key: c.key, keyWords: keyWords(p, c.key), task: c.title, line: c.line, column: c.column, state: c.state, url: c.url, lane: laneOfKey(p, c.key), moved: c.moved, at: s.at, stale });
        counts.push({ pull: p.id, title: p.title, count: cards.length, more, done, ...(stale ? { error: s.error } : {}) });
      }
      return { tasks, counts };
    },

    /**
     * A project's pulls as its page shows them: each as kept — what its sheet opens with —, the state a move to each
     * column sets in its service (null where none does, or a move cannot go back), when it last read and why it failed.
     * @param {string} project
     */
    shown(project) {
      return (spaces.get(project).pulls || []).map((p) => {
        const s = stateOf(project, p);
        const { moved: _moved, ...kept } = p;
        return { ...kept, backStates: backStates(p), readAt: s.at || null, error: s.error && s.errorAt >= s.at ? s.error : null, reading: !!s.reading };
      });
    },

    /** Read again, now: the answer once its read ended. @param {string} project @param {string} id */
    async readNow(project, id) {
      const p = pullOf(project, id);
      const s = stateOf(project, p);
      await (s.reading || readPull(project, p));
      const after = stateOf(project, p);
      return after.error && after.errorAt >= after.at ? { ok: false, error: after.error } : { ok: true };
    },

    /**
     * A card moved by the person: on the board only, or — `back` — in its service too, through the pull's tool with the
     * card's key and the state its column maps from, then on the board; `always`, their Always for this board, kept
     * with it. A move whose tool failed moves nothing, and says why.
     * @param {string} project @param {string} id @param {any} b  `{ key, column, back?, always? }`
     * @returns {Promise<{ ok: true, went: string | null } | { ok: false, error: string }>}
     */
    async move(project, id, b) {
      const column = String(b?.column ?? "").trim().toLowerCase();
      if (!isColumn(column)) throw refused(400, "a card moves to planned, doing, waits or done");
      if (b.always != null && typeof b.always !== "boolean") throw refused(400, "always is true or false");
      const p = pullOf(project, id);
      const s = stateOf(project, p);
      const key = String(b?.key ?? "");
      const row = s.rows.find((r) => r.key === key);
      if (!row) throw refused(404, `${keyWords(p, key) || "That card"} is not among what ${p.title} answered last: read it again.`);
      const always = typeof b.always === "boolean" ? { always: b.always } : {};
      if (b.back !== true) {
        spaces.pullMoved(project, p.id, key, { column, from: row.state, ...always }, s.rows);
        return { ok: true, went: null };
      }
      if (!p.back) throw refused(409, `${p.title}'s pull has no way to move a card back: it moves on this board only.`);
      const state = toState(p, column);
      if (!state) throw refused(409, `No state of ${p.title} goes to ${COLUMN_WORDS[column]} in this pull's columns: it moves on this board only.`);
      if (state === row.state) {
        spaces.pullMoved(project, p.id, key, { column, from: row.state, ...always }, s.rows);
        return { ok: true, went: null };
      }
      const busy = `${keyOf(project, p.id)}\n${key}`;
      if (moving.has(busy)) throw refused(409, `${keyWords(p, key)} is being moved in ${p.title}: wait for it.`);
      const t = tools();
      if (!t) return { ok: false, error: "Filament is still starting" };
      moving.add(busy);
      try {
        const out = await t.act(project, { connection: p.connection, name: p.back.tool, args: p.back.args }, backArgs(p, key, state));
        if (!out.ok) return { ok: false, error: `${p.title} did not move ${keyWords(p, key)}: ${out.error}` };
      } finally {
        moving.delete(busy);
      }
      // The service says it now: the card stands there until it says another.
      row.state = state;
      spaces.pullMoved(project, p.id, key, { column, from: state, went: state, ...always }, s.rows);
      return { ok: true, went: state };
    },

    /** A pull taken off its board: its read under way stopped, what it read let go. @param {string} project @param {string} id */
    forget(project, id) {
      const k = keyOf(project, id);
      reads.get(k)?.ctl?.abort();
      reads.delete(k);
    },
  };
}

/** @typedef {ReturnType<typeof createPulls>} Pulls */
