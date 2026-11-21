// @ts-check
// The live boards of the teams on the side of a chat (team_v2_plan §10 O2, the mock of 10-19): what each board says —
// a frame per worker (its portrait, its name and number, its state in a word, what it does now, its slice, its rounds
// and how full its window is), the lead's state and this round's calls, the board's foot, the room on every model —
// and the store that follows the working teams' own chats: their sub-agents' lists, kept live by the bus as the Sub
// Agents tab's are, and where each lead is, read again every few seconds while the Teams tab shows. The words are
// pure; views/board.js draws them.
import { cardFigures, cardState, leadAskLine, whoOf } from "./team.js";
import { mergeProgress } from "./subagents.js";
import { memberLook } from "./brief.js";
import { prettyModel } from "./families.js";

/** How often a working team's lead is read again while its board shows. */
const LEAD_MS = 4000;
/** Every so many of those reads, its workers' list too: an end must show even where its bus message was lost. */
const ROWS_EVERY = 4;
/** How long a burst of a team's sub-agent messages settles before its list is read again. */
const SETTLE_MS = 300;

/**
 * A worker's frame. `tone`: work (blue), asks (orange: it asks you), lead (purple: it asked its lead), done (green),
 * wait (dashed: no free slot), failed, stopped.
 * @typedef {{ id: string, look: { icon: string, tone: string }, name: string, n: number, state: string,
 *   tone: "work" | "asks" | "lead" | "done" | "wait" | "failed" | "stopped", tool: { name: string, args: string } | null,
 *   words: string, slice: string, rounds: number | null, fill: number | null, wait: string, model: string }} Frame
 */

/** What a worker's tool says it does, as its frame's state. @param {string} name */
export function doingWord(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return "Thinking";
  if (/^(read|view|cat|open|read_file|notebook)/.test(n)) return "Reading";
  if (/(grep|glob|search|find|ls|list)/.test(n)) return "Searching";
  if (/^(bash|powershell|shell|run|exec)/.test(n)) return "Running a command";
  if (/(edit|write|apply|patch|multiedit)/.test(n)) return "Editing";
  if (/^web/.test(n)) return "On the web";
  return "At work";
}

/**
 * Each worker's number among those of its kind, the first launched first: Hunter 1, Hunter 2.
 * @param {readonly any[]} rows @returns {Map<string, number>}
 */
export function numbersOf(rows) {
  /** @type {Map<string, number>} */
  const out = new Map();
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const r of [...rows].sort((a, b) => (Number(a.startedAt) || 0) - (Number(b.startedAt) || 0))) {
    const word = whoOf(r).word;
    const n = (seen.get(word) || 0) + 1;
    seen.set(word, n);
    out.set(String(r.id), n);
  }
  return out;
}

/**
 * A worker's frame, from its row as its chat's list holds it.
 * @param {any} row @param {number} n  its number among its kind @param {number} now @returns {Frame}
 */
export function frameOf(row, n, now) {
  const who = whoOf(row);
  // Its glyph by its card: a seat the team names runs as a card of another tag.
  const look = memberLook({ tag: String(row.team?.role || ""), card: row.card?.tag ? String(row.card.tag) : undefined, may: row.may, place: row.team?.place ?? null });
  const st = cardState(row);
  const running = row.status === "running";
  const p = running ? row.progress || {} : {};
  const waits = running && !!row.waiting;
  const lead = running && p.asking?.to === "lead";
  const f = cardFigures(row, now);
  const last = row.exchanges?.at(-1) || null;
  /** @type {[string, Frame["tone"]]} */
  const [state, tone] = st === "asking" ? ["Asks you", "asks"]
    : waits ? ["Waits for a slot", "wait"]
      : lead ? ["Asked its lead", "lead"]
        : st === "running" ? [doingWord(p.tool?.name), "work"]
          : st === "done" ? ["Reported", "done"]
            : st === "failed" ? ["Failed", "failed"]
              : ["Stopped", "stopped"];
  const said = (/** @type {unknown} */ s) => String(s || "").replace(/\s+/g, " ").trim();
  return {
    id: String(row.id),
    look,
    name: who.word,
    n,
    state,
    tone,
    tool: running && !waits && p.tool?.name ? { name: String(p.tool.name), args: String(p.tool.args || "") } : null,
    words: waits ? "" : lead ? said(leadAskLine(p)) : running ? said(p.words) : said(last?.report || last?.error),
    slice: said(row.description),
    rounds: f.rounds,
    fill: f.fill,
    wait: waits ? said(row.waiting.words) : "",
    model: String(row.model || ""),
  };
}

/** A board's frames: the ones that ask you first, then by number. @param {readonly any[]} rows @param {number} now @returns {Frame[]} */
export function framesOf(rows, now) {
  const nums = numbersOf(rows);
  const order = { asks: 0, lead: 1, work: 2, wait: 3, done: 4, failed: 5, stopped: 6 };
  return rows
    .map((r) => frameOf(r, nums.get(String(r.id)) || 1, now))
    .sort((a, b) => order[a.tone] - order[b.tone] || a.name.localeCompare(b.name) || a.n - b.n);
}

/** Its workers in a word: "hunters" where all are Hunters, else "workers". @param {readonly Frame[]} frames */
export function crewWord(frames) {
  const names = new Set(frames.map((f) => f.name));
  return names.size === 1 ? `${[...names][0].toLowerCase()}s` : "workers";
}

/** A lead's calls that run while its workers do: a launch, a word to a worker, a wait. */
const WAITS_ON = Object.freeze(["agent", "worker", "wait"]);

/**
 * The lead's state on its frame: it asks you, waits on its workers (a call of its that hands out or waits runs while
 * they work), works, or has given its result.
 * @param {{ state: string }} r  the team's row @param {import("./beside.js").LeadNow | null} lead @param {readonly Frame[]} frames
 * @returns {{ words: string, tone: "asks" | "work" | "done" }}
 */
export function leadState(r, lead, frames) {
  if (r.state === "asking") return { words: "Asks you", tone: "asks" };
  if (r.state === "done") return { words: "Gave its result", tone: "done" };
  if (r.state === "stopped") return { words: "Stopped", tone: "done" };
  const busy = frames.some((f) => f.tone === "work" || f.tone === "lead" || f.tone === "asks" || f.tone === "wait");
  if (busy && lead?.calls?.some((c) => c.open && WAITS_ON.includes(c.name))) return { words: `Waits on its ${crewWord(frames)}`, tone: "work" };
  if (!frames.length && lead && !lead.rounds) return { words: "Reads this chat", tone: "work" };
  return { words: "Works", tone: "work" };
}

/**
 * Its newest round's calls as its frame lists them: "Sent Hunter: P3 cards", "To Hunter 2: stop it", "read app/x.js".
 * A word to a worker names it as its frame on the board does, its id (which the call says it by) the line's `tip`; one
 * the board holds no frame of, as its call says it.
 * @param {import("./beside.js").LeadNow | null} lead @param {readonly Frame[]} [frames]  the board's workers
 * @returns {{ words: string, open: boolean, icon: string, tip?: string }[]}
 */
export function orderLines(lead, frames = []) {
  return (lead?.calls || []).slice(0, 6).map((c) => {
    const what = String(c.subject || "").replace(/\s+/g, " ").trim();
    if (c.name === "agent") return { words: what ? `Sent ${what}` : "Sent a worker", open: c.open, icon: "arrowRight" };
    if (c.name === "worker") {
      const to = frames.find((f) => what === f.id || what.startsWith(`${f.id}:`));
      if (to) return { words: `To ${to.name} ${to.n}${what.slice(to.id.length)}`, tip: to.id, open: c.open, icon: "messageSquare" };
      return { words: what ? `To its worker: ${what}` : "To its worker", open: c.open, icon: "messageSquare" };
    }
    if (c.name === "wait") return { words: c.open ? "Waits for word from its workers" : "Waited for word from its workers", open: c.open, icon: "hourglass" };
    return { words: `${c.name}${what ? ` ${what}` : ""}`, open: c.open, icon: "wrench" };
  });
}

/**
 * A board's foot: a pip per worker in its tone, and its line — "7 at work · 1 reported · 2 wait for a slot · 58 rounds
 * · $0.38 so far".
 * @param {readonly Frame[]} frames @param {import("./beside.js").LeadNow | null} lead @param {(n: number) => string} usd
 */
export function boardFoot(frames, lead, usd) {
  const count = (/** @type {Frame["tone"][]} */ ...tones) => frames.filter((f) => tones.includes(f.tone)).length;
  const work = count("work", "lead");
  const asks = count("asks");
  const done = count("done");
  const wait = count("wait");
  const rounds = (Number(lead?.rounds) || 0) + frames.reduce((n, f) => n + (Number(f.rounds) || 0), 0);
  const spent = Number(lead?.usd);
  return {
    pips: frames.map((f) => f.tone),
    words: [
      work ? `${work} at work` : "",
      asks ? `${asks} ${asks === 1 ? "asks" : "ask"} you` : "",
      done ? `${done} reported` : "",
      wait ? `${wait} wait${wait === 1 ? "s" : ""} for a slot` : "",
      rounds ? `${rounds} ${rounds === 1 ? "round" : "rounds"}` : "",
      Number.isFinite(spent) && spent > 0 ? `${usd(spent)} so far` : "",
    ].filter(Boolean).join(" · "),
  };
}

/**
 * The room on every model as the Teams tab's foot says it (`GET /api/subagents/slots`): each model with an agent on it
 * or waiting for it — "GLM 5.3 Flash 20 of 20 busy · 2 wait", "GLM 5.3 3 running" where it has no limit — busiest first.
 * @param {{ rows?: any[] } | null} view
 * @returns {{ name: string, words: string, full: boolean, waits: number }[]}
 */
export function roomStrip(view) {
  return (view?.rows || [])
    .filter((r) => (Number(r.running) || 0) > 0 || (Number(r.waiting) || 0) > 0)
    .map((r) => {
      const running = Number(r.running) || 0;
      // A cap of null is no limit: only how many run.
      const cap = r.cap == null ? null : Number(r.cap) || 0;
      const waits = Number(r.waiting) || 0;
      const busy = cap == null ? `${running} running` : `${running} of ${cap} busy`;
      return { name: prettyModel(String(r.name || r.model || "")), words: `${busy}${waits ? ` · ${waits} wait${waits === 1 ? "s" : ""}` : ""}`, full: cap != null && cap > 0 && running >= cap, waits };
    })
    .sort((a, b) => b.waits - a.waits || Number(b.full) - Number(a.full) || a.name.localeCompare(b.name));
}

/**
 * The working teams' boards, live: each team chat's sub-agents (its list route, kept live by the bus), where its lead
 * is, and the room on every model (`slots`) — read every few seconds while `shown` says the Teams tab shows. `follow`
 * names the teams to follow.
 * @param {{ list: (tid: string) => Promise<any>, lead: (main: string, tid: string) => Promise<import("./beside.js").LeadNow>,
 *   slots?: () => Promise<{ rows?: any[] } | null>, shown?: () => boolean, later?: (fn: () => void, ms: number) => any,
 *   clear?: (t: any) => void }} o
 */
export function createBoardStore(o) {
  const later = o.later || ((fn, ms) => setTimeout(fn, ms));
  const clear = o.clear || ((t) => clearTimeout(t));
  const shown = o.shown || (() => true);
  let main = "";
  /** @type {string[]} */
  let want = [];
  /** @type {Map<string, { rows: any[], lead: import("./beside.js").LeadNow | null, known: boolean }>} */
  const boards = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @type {any} */
  let timer = null;
  let ticks = 0;
  /** @type {Map<string, any>} */
  const settling = new Map();
  /** How Many at once as last read: the room on every model. @type {{ rows?: any[] } | null} */
  let room = null;
  /**
   * The boards a move was heard for while the tab was hidden, and whether the room was due then: read once the tab
   * shows them (`fresh`), not at each move — a team's every worker launched or ended read its list and its lead again,
   * shown or not. @type {Set<string>}
   */
  const stale = new Set();
  let roomStale = false;
  const emit = () => { for (const fn of listeners) fn(); };
  /** A board asked for by the tab as it draws: one left unread while hidden is read now. @param {string} tid */
  const fresh = (tid) => {
    if (!stale.has(tid) || !shown()) return;
    stale.delete(tid);
    void loadRows(tid);
    void loadLead(tid);
  };

  async function loadRoom() {
    if (!o.slots) return;
    try {
      const v = await o.slots();
      if (JSON.stringify(v?.rows || []) === JSON.stringify(room?.rows || [])) return;
      room = v;
      emit();
    } catch {}
  }

  /** @param {string} tid */
  async function loadRows(tid) {
    try {
      const r = await o.list(tid);
      const b = boards.get(tid);
      if (!b) return;
      b.rows = Array.isArray(r?.subagents) ? r.subagents : [];
      b.known = true;
      emit();
    } catch {
      // Unreachable for now: the board keeps what it last showed; the next read looks again.
    }
  }
  /** @param {string} tid */
  async function loadLead(tid) {
    const m = main;
    try {
      const lead = await o.lead(m, tid);
      const b = boards.get(tid);
      if (!b || m !== main) return;
      if (JSON.stringify(b.lead) === JSON.stringify(lead)) return;
      b.lead = lead;
      emit();
    } catch {}
  }
  function arm() {
    if (timer || !want.length) return;
    timer = later(() => {
      timer = null;
      if (!want.length) return;
      if (shown()) {
        ticks++;
        // Shown again with no draw since (the page brought back): what waited while it was hidden is read too.
        for (const tid of [...stale]) fresh(tid);
        for (const tid of want) {
          void loadLead(tid);
          if (ticks % ROWS_EVERY === 0) void loadRows(tid);
        }
        if (ticks % 2 === 0) void loadRoom();
      }
      arm();
    }, LEAD_MS);
  }

  return {
    /**
     * Follow these team chats of a main chat: a new one is read at once; one no longer named is let go.
     * @param {string} mainId @param {string[]} tids
     */
    follow(mainId, tids) {
      if (mainId !== main) {
        main = mainId;
        boards.clear();
        stale.clear();
      }
      want = [...tids];
      for (const id of [...boards.keys()]) if (!want.includes(id)) { boards.delete(id); stale.delete(id); }
      let added = false;
      const now = shown();
      for (const id of want) {
        if (boards.has(id)) continue;
        added = true;
        boards.set(id, { rows: [], lead: null, known: false });
        // While the tab is hidden, read once it shows the board.
        if (!now) {
          stale.add(id);
          continue;
        }
        void loadRows(id);
        void loadLead(id);
      }
      if (added && now) void loadRoom();
      else if (added) roomStale = true;
      if (!want.length && timer) {
        clear(timer);
        timer = null;
      }
      arm();
    },
    /** A team chat's workers, newest first, as its list said them — read now where they were left unread while hidden. @param {string} tid */
    rows: (tid) => {
      fresh(tid);
      return boards.get(tid)?.rows || [];
    },
    /** Whether its list has answered: until then a board says nothing of its workers. @param {string} tid */
    known: (tid) => !!boards.get(tid)?.known,
    /** Where its lead is, as last read. @param {string} tid */
    lead: (tid) => {
      fresh(tid);
      return boards.get(tid)?.lead || null;
    },
    /** The room on every model, as last read; null until read — read now where it was due while hidden. */
    room: () => {
      if (roomStale && shown()) {
        roomStale = false;
        void loadRoom();
      }
      return room;
    },
    /** A message off the bus: a followed team's sub-agent moved. @param {any} msg */
    heard(msg) {
      const tid = String(msg?.chainId || "");
      const b = tid ? boards.get(tid) : null;
      if (!b) return;
      if (msg.type === "subagent" || msg.type === "subagent-cache") {
        if (!shown()) {
          stale.add(tid);
          return;
        }
        if (settling.has(tid)) return;
        settling.set(tid, later(() => {
          settling.delete(tid);
          void loadRows(tid);
          void loadLead(tid);
        }, SETTLE_MS));
      } else if (mergeProgress(b.rows, tid, msg)) emit();
    },
    /** Read a team's list and lead again now: an answer given, a worker stopped. @param {string} tid */
    refresh: (tid) => Promise.all([loadRows(tid), loadLead(tid)]),
    /** @param {() => void} fn */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
