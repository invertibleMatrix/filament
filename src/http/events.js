// @ts-check
// The dashboard's live stream: one SSE connection per open tab, carrying records and ops as the bus publishes them
// (never a run's events — a turn's thinking stays off this feed). Per-connection subscriptions, a 25 s
// ping, and shutdown ends every open stream through the client set.
//
// A slow tab must not stall the request path, and must not miss what it is sent either: a write the socket cannot take
// yet waits in the stream's own queue, in order, and goes out as the socket drains (`writeHeld`). Only a tab that has
// stopped reading — its queue past BACKLOG_BYTES — is cut off; its EventSource connects again and starts over.

/** What a stream may hold unsent for a reader that is not keeping up: past this it is closed, not grown. */
export const BACKLOG_BYTES = 8 * 1024 * 1024;

/**
 * Write to a stream that must lose nothing: what its socket cannot take yet waits in Node's write queue, in order, and
 * goes out as the socket drains — never skipped. A reader that stopped reading would grow that queue without end, so
 * a write that finds the stream backed up and would take its queue past `cap` destroys the stream instead: its reader
 * reconnects and resumes from what it last had. A write onto a stream that is not backed up is always taken, however
 * large, so one big frame never closes a stream that is keeping up.
 * @param {import("node:stream").Writable} stream  a response or a socket
 * @param {string | Buffer} chunk
 * @param {number} [cap]
 * @returns {boolean}  false when the stream is gone, or was closed for its backlog
 */
export function writeHeld(stream, chunk, cap = BACKLOG_BYTES) {
  if (!stream || stream.writableEnded || stream.destroyed) return false;
  if (stream.writableNeedDrain && stream.writableLength + (typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length) > cap) {
    stream.destroy();
    return false;
  }
  stream.write(chunk);
  return true;
}

/** @type {WeakMap<object, Promise<void>>} */
const draining = new WeakMap();
/**
 * Resolves once the stream takes writes again (its `drain`), or is gone (its `close`): a replay that waits for its reader
 * is never left waiting on a stream that closed. Every wait on one stream shares one pair of listeners — a page's run
 * socket carries many follows, each of which may wait.
 * @param {import("node:stream").Writable} stream
 * @returns {Promise<void>}
 */
export function drainedOrGone(stream) {
  if (!stream.writableNeedDrain || stream.destroyed || stream.writableEnded) return Promise.resolve();
  let wait = draining.get(stream);
  if (!wait) {
    wait = new Promise((resolve) => {
      const done = () => {
        stream.off("drain", done);
        stream.off("close", done);
        draining.delete(stream);
        resolve();
      };
      stream.on("drain", done);
      stream.on("close", done);
    });
    draining.set(stream, wait);
  }
  return wait;
}

/**
 * @param {Set<any>} clients  the open dashboard streams (shutdown ends them)
 * @param {import("node:http").ServerResponse} res
 * @param {string} line
 * @returns {boolean}  false when the stream is gone (and so out of the set): its caller stops writing to it
 */
export const writeSse = (clients, res, line) => {
  try {
    if (writeHeld(res, line)) return true;
  } catch {}
  clients.delete(res);
  return false;
};

/** The bus entry whose line was made last, and that line: each window hears the same event in turn, as the bus hands it
 *  to them one after another, and it is serialised once for all of them. Keyed by the entry, which the bus makes anew
 *  for every publish, so a producer that publishes one object again after changing it is serialised again. */
let lastEntry = /** @type {object | null} */ (null);
let lastLine = "";
/** An event's SSE line, made once for every window the bus hands its entry to. @param {any} payload @param {object | undefined} entry */
const lineOf = (payload, entry) => {
  if (entry && entry === lastEntry) return lastLine;
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  if (entry) {
    lastEntry = entry;
    lastLine = line;
  }
  return line;
};

/**
 * A request's progress as a stream sends it: its record without `priorChanges` — Filament's words on the turn, a line
 * each permission it was asked, its whole turn's —, which nothing that reads the stream reads off a progress: about
 * 140 KB of a coding agent's 141 KB line, once a second (the owner's of 11-17). Its start, first byte and finish carry
 * them, and the bus's other listeners hear the record whole. Its line is still made once for every window (`lineOf`).
 * @param {any} payload
 */
const progressSent = (payload) => (payload?.record?.priorChanges ? { ...payload, record: { ...payload.record, priorChanges: undefined } } : payload);

/**
 * `GET /api/events`. Takes the connection over and never returns a body-shaped answer. A harness page names its tab
 * (`?tab=`): the tab counts as open while this stream is (HarnessV3-FixRound decision 22), and its close lets go of the
 * session the tab writes; its stream carries no request's `progress`, the dashboard's alone. A page that left while its stream waited (memory's open, at the front door) is gone already:
 * nothing is attached for it.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {{ events: any, sseClients: Set<any>, VERSION: string, sessionWriters?: import("../services/session-writers.js").SessionWriters | null }} a
 * @param {import("../services/session-writers.js").Place | null} [place]  where the page is: this computer, or a paired machine
 */
export function attachEventsStream(req, res, a, place = null) {
  if (res.destroyed) return;
  const { events, sseClients, VERSION, sessionWriters = null } = a;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "hello", version: VERSION })}\n\n`);
  sseClients.add(res);
  const ping = setInterval(() => writeSse(sseClients, res, ": ping\n\n"), 25000);
  /** @param {any} payload @param {object} [entry] */
  const send = (payload, entry) => {
    if (!writeSse(sseClients, res, lineOf(payload, entry))) off();
  };
  // records, ops, the sidebar's holder changes (`turns`, Facade D11), sub-agents' state changes and each running one's
  // progress as it moves (`subagents`; its `subagent-progress` at most once each 500 ms, HarnessV3-Views V3), the
  // configuration's saves and reloads (`config`, the harness's catalogue refresh), a session's settings writes
  // (`settings`: its id and the document's new hash, BUG-10 P9), the tab that writes a session (`writers`, decision 22),
  // each page of claim changes (`claims`, HarnessV3-Memory M7-D36), where memory's engine stands (`engine`,
  // HarnessV3-AtHome AH-D2), each change to a session's task graph (`graph`, HarnessV3-TaskGraph G2-10) and each change
  // to a coding agent's account or plan (`accounts`: the upstream's id, HarnessV3-ACP AC3-6), and on the same topic to
  // Settings → Coding agents' entries (`coding-agents`: the entry's id, AC3-8), and each running compaction as it goes
  // (`compactions`: `compaction-progress` with its session's id — its step, what its calls have written, the last
  // byte, then its end; the request log says a call's progress at most once a second; HarnessV4_Tasks U3-5 — and
  // `compaction-cost`, what a compaction cost, once its calls' records have finished; U3-11; and `compaction-undone`,
  // an Undo: the compaction undone and the one now undoable), and each version of an
  // artifact kept (`artifacts`: its name, version and title, HarnessV4_Artifacts_Plan AF-D37; or its name and the
  // developer's `change`: renamed, pinned, deleted), and each worktree template's copy as it begins and ends
  // (`copies`: `worktree-copy` with its chat's id and row, HarnessV4_Four_Plan FO-D37), and each change to a project's
  // Space (`space`: the project's id and the Space's count of changes, proposal_ux §4.14), and each request a session
  // books (`spend`: its id and its ledger as the settings document says it, services/spend.js usageOf), and each move of a
  // chat's agents' use of its browser (`browser`: its id, the call at work, when one last ran, whether the developer
  // holds it — the line over the chat's box, the owner's of 11-02), and each git mark read again behind the answer a page
  // was given that moved (`git`: `git-moved`, which read and each spelling of its folder, http/admin/git.js; the slowness
  // of 11-02) — the dashboard's handler ignores `turns`, `subagents`, `settings`, `writers`, `graph`, `compactions`,
  // `artifacts`, `copies`, `space`, `spend`, `browser` and `git`, and
  // of `config` all but a discovery (a team's save rides `config` too, as `teams-changed`: HarnessV4_Tasks C9; a saved
  // agent's as `agents-changed`: E15); never a run's events.
  // A harness page (`?tab=`) is sent no request's `progress`: none of it reads one — a running turn's figures come from
  // its run's events — and a coding agent's says every permission it was asked, its whole turn's, once a second, each
  // open window parsing it for nothing (the owner's of 11-17: 2.5 s of a 14.5 s hold making those lines). Its other
  // record events — `start`, `first-byte`, `finish` — come as to the dashboard, whose live rows read the progress too.
  // The dashboard's is sent each progress's record without `priorChanges` (`progressSent`).
  const asked = new URL(req.url || "/", "http://local").searchParams;
  const tab = asked.get("tab");
  // `?only=turns,writers`: those topics alone — another machine's desk reads its holders, writers and asks, never a
  // record (a coding agent's finish runs to 140 KB), and is sent none (the remote desk of 11-22).
  const only = asked.has("only") ? new Set(String(asked.get("only")).split(",").map((t) => t.trim()).filter(Boolean)) : null;
  /** @param {string} topic @param {(payload: any, entry?: object) => void} fn */
  const hear = (topic, fn) => (!only || only.has(topic) ? events.subscribe(topic, fn) : () => {});
  /** @param {any} payload @param {object} [entry] */
  const sendRecord = tab ? (payload, entry) => void (payload?.type !== "progress" && send(payload, entry)) : (payload, entry) => send(payload?.type === "progress" ? progressSent(payload) : payload, entry);
  const offs = [hear("record", sendRecord), hear("op", send), hear("turns", send), hear("subagents", send), hear("config", send), hear("settings", send), hear("writers", send), hear("claims", send), hear("engine", send), hear("graph", send), hear("accounts", send), hear("compactions", send), hear("artifacts", send), hear("copies", send), hear("space", send), hear("spend", send), hear("browser", send), hear("git", send)];
  const off = () => {
    for (const f of offs) f();
  };
  const leave = tab && sessionWriters ? sessionWriters.connect(tab.slice(0, 80), place) : () => {};
  req.on("close", () => {
    clearInterval(ping);
    off();
    sseClients.delete(res);
    leave();
  });
}
