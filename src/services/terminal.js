// @ts-check
// The terminal registry (B4): the PTY sessions the harness's Terminal pane owns — created inside a fenced project
// folder, listed for the status panel, streamed to the pane over a WebSocket attach. A tab detaching does NOT stop
// the process (the point of a background terminal is that it keeps running); an explicit kill or the cap's oldest
// eviction does. Output while nobody is attached is kept in a bounded ring so a re-attached tab catches up, the
// same scrollback a local terminal would still show. The PTY adapter itself is injected by the composition root —
// services never import adapters.
import { randomBytes } from "node:crypto";
import { same } from "../core/hash.js";

export const MAX_TERMINALS = 8;
export const BACKLOG_BYTES = 64 * 1024;
/** How long a ticket for a terminal's stream holds (`ticket`): its page asks one and opens the stream at once. */
export const TICKET_MS = 30_000;
/** The tickets one terminal keeps at most: a view each, the oldest given up first. */
export const MAX_TICKETS = 8;

/**
 * Work Filament does itself, shown in a terminal: it says what it does as it goes, and stops at the terminal's kill.
 * @typedef {(io: { say: (text: string) => void, signal: AbortSignal }) => Promise<void>} TerminalTask
 */

/**
 * A terminal over a task rather than a program (a coding agent's download, HarnessV3-ACP AC3-8), in node-pty's shape
 * and with no PTY: what the task says is its output; it ends 0 once the task does, and 1 with its error said where it
 * fails; a kill stops it through its signal. Keys typed reach nothing. The task starts once its terminal is made, so
 * its first words are heard.
 * @param {TerminalTask} task
 */
function taskPty(task) {
  const stop = new AbortController();
  /** @type {((d: string) => void)[]} */
  const data = [];
  /** @type {((e: { exitCode: number, signal: number }) => void)[]} */
  const exits = [];
  /** @param {string} d */
  const say = (d) => {
    for (const fn of data) fn(d);
  };
  /** @param {number} exitCode */
  const end = (exitCode) => {
    for (const fn of exits) fn({ exitCode, signal: 0 });
  };
  void Promise.resolve()
    .then(() => task({ say, signal: stop.signal }))
    .then(
      () => end(0),
      (/** @type {any} */ e) => {
        if (!stop.signal.aborted) say(`\r\n${String(e?.message || e)}\r\n`);
        end(1);
      },
    );
  return {
    write: () => {},
    resize: () => {},
    kill: () => stop.abort(),
    onData: (/** @type {(d: string) => void} */ fn) => void data.push(fn),
    onExit: (/** @type {(e: any) => void} */ fn) => void exits.push(fn),
  };
}

/**
 * @param {{ log?: (msg: string, kind?: string) => void, spawn: (o: any) => any, windowsPty?: { backend: string, buildNumber: number } | null }} o
 *   `windowsPty`: the Windows console behind the terminals (adapters/terminal/pty.js `windowsPtyOf`), told each view first
 */
export function createTerminalService({ log, spawn, windowsPty = null } = /** @type {any} */ ({})) {
  if (!spawn) throw new Error("createTerminalService needs a spawn: the PTY adapter (adapters/terminal/pty.js), injected by the composition root");
  /** @type {Map<string, any>} id → session */
  const sessions = new Map();
  let seq = 0;
  const now = () => Date.now();
  const idOf = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

  /**
   * Open a terminal in an already-fenced absolute folder (the admin row judges the fence; the service trusts its
   * caller and does its own existence check only so the error reads well). A shell, or the `program` given — an
   * agent's sign-in (HarnessV3-ACP AC3-7) — or the `task` given, which needs no PTY (`taskPty`); named by its `title`
   * and followed by `onExit` with its exit code and whether it was closed (`kill`) rather than ending by itself.
   * @param {{ cwd: string, cols?: number, rows?: number, title?: string,
   *   program?: { file: string, args: string[], env: Record<string, string> }, task?: TerminalTask,
   *   onExit?: (code: number | null, closed: boolean) => void }} o
   */
  function create(o) {
    if (sessions.size >= MAX_TERMINALS) {
      // The oldest exited one goes first; otherwise the oldest living one — the cap keeps one runaway pane from
      // minting shells forever, and the refusal below says which one was closed.
      const list = [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt);
      const victim = list.find((s) => s.exited) || list[0];
      if (victim) kill(victim.id);
    }
    let pty;
    try {
      pty = o.task ? taskPty(o.task) : spawn({ cwd: o.cwd, cols: o.cols, rows: o.rows, ...(o.program ? { program: o.program } : {}) });
    } catch (/** @type {any} */ e) {
      throw new Error(`the terminal could not start: ${String(e?.message || e).slice(0, 200)}`);
    }
    if (!pty) throw new Error("the terminal could not start: no PTY (node-pty) on this machine");
    const id = idOf();
    /** @type {any} */
    const s = {
      id,
      pty,
      cwd: o.cwd,
      title: o.title || "",
      createdAt: now(),
      lastAt: now(),
      exited: false,
      exitCode: null,
      closed: false,
      listeners: new Set(),
      backlog: "",
      tickets: [],
    };
    sessions.set(id, s);
    s.pty.onData?.((/** @type {string} */ d) => {
      s.lastAt = now();
      s.backlog = (s.backlog + d).slice(-BACKLOG_BYTES);
      for (const fn of s.listeners) fn({ t: "o", d });
    });
    // node-pty says how the process ended as `{ exitCode, signal }`.
    s.pty.onExit?.((/** @type {any} */ e) => {
      s.exited = true;
      s.exitCode = e?.exitCode ?? null;
      s.lastAt = now();
      for (const fn of s.listeners) fn({ t: "x", code: s.exitCode });
      try {
        o.onExit?.(s.exitCode, s.closed);
      } catch (/** @type {any} */ e) {
        log?.(`terminal ${id}: its end could not be handled (${String(e?.message || e).slice(0, 160)})`, "warn");
      }
    });
    log?.(`terminal ${id} opened in ${o.cwd}${o.program || o.task ? ` running ${o.title || "a program"}` : ""}`, "info");
    return row(s);
  }

  /** @param {string} id */
  const get = (id) => sessions.get(String(id)) || null;

  /** @param {any} s */
  const row = (s) => ({ id: s.id, cwd: s.cwd, title: s.title, createdAt: s.createdAt, lastAt: s.lastAt, exited: s.exited, exitCode: s.exitCode });

  /** @param {string} id @param {string} data */
  function input(id, data) {
    const s = get(id);
    if (!s) throw new Error("no such terminal");
    if (s.exited) throw new Error("the process has exited");
    s.pty.write(String(data));
    return true;
  }

  /** @param {string} id @param {number} cols @param {number} rows */
  function resize(id, cols, rows) {
    const s = get(id);
    if (!s) throw new Error("no such terminal");
    const c = Math.min(500, Math.max(20, Math.floor(cols) || 80));
    const r = Math.min(300, Math.max(4, Math.floor(rows) || 24));
    if (!s.exited) s.pty.resize?.(c, r);
    return true;
  }

  /** @param {string} id */
  function kill(id) {
    const s = get(id);
    if (!s) throw new Error("no such terminal");
    if (!s.exited) {
      s.closed = true;
      try {
        s.pty.kill();
      } catch {}
    }
    sessions.delete(s.id);
    log?.(`terminal ${s.id} closed`, "info");
    return true;
  }

  /**
   * Attach a listener to a terminal's stream: the backlog it printed while detached arrives first, then live
   * output. Returns the detach function.
   * @param {string} id @param {(msg: any) => void} onData
   */
  function attach(id, onData) {
    const s = get(id);
    if (!s) throw new Error("no such terminal");
    // The console behind it first, for the view to grow as it does; then the catch-up, which belongs to this attach
    // only, before any live byte, so the pane's scrollback reads in order.
    if (windowsPty) onData({ t: "w", ...windowsPty });
    if (s.backlog) onData({ t: "b", d: s.backlog });
    s.listeners.add(onData);
    if (s.exited) onData({ t: "x", code: s.exitCode });
    return () => s.listeners.delete(onData);
  }

  /**
   * A ticket for one attach to a terminal's stream (r-doors, 11-12): the stream types into this machine, so it is a
   * press as the terminal's rows are, and a browser's WebSocket carries no header for the app's key. The page's press
   * asks one (the admin row) and its stream shows it (`redeem`). Random, good once, for this terminal, for TICKET_MS.
   * @param {string} id
   */
  function ticket(id) {
    const s = get(id);
    if (!s) throw new Error("no such terminal");
    const t = randomBytes(24).toString("base64url");
    s.tickets = [...s.tickets.filter((/** @type {any} */ k) => k.until > now()).slice(1 - MAX_TICKETS), { t, until: now() + TICKET_MS }];
    return t;
  }

  /** Whether `t` is a ticket of the terminal's that holds; it holds no more from then on. @param {string} id @param {unknown} t */
  function redeem(id, t) {
    const s = get(id);
    if (!s || typeof t !== "string" || !t) return false;
    const at = s.tickets.findIndex((/** @type {any} */ k) => k.until > now() && same(k.t, t));
    if (at < 0) return false;
    s.tickets.splice(at, 1);
    return true;
  }

  function list() {
    return [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt).map(row);
  }

  /** Everything stops when the server stops. */
  function stopAll() {
    for (const s of sessions.values()) {
      if (!s.exited) {
        try {
          s.pty.kill();
        } catch {}
      }
    }
    sessions.clear();
  }

  return { create, input, resize, kill, attach, ticket, redeem, list, stopAll };
}
