// @ts-check
// A page's run follows, on one WebSocket (`/api/runs/socket`). A browser gives a page six HTTP/1.1 connections to this
// host, shared by every window of the app, and each run the harness followed held one as an event stream for as long
// as the run ran — the chats running in the background, their threads, the Run pane's views — so with a handful of
// chats at work every other request, the transcript of the chat just clicked among them, waited in line. A WebSocket
// counts against none of the six. One socket carries every follow of the page, each the run's stream as
// `GET /runs/:id/events?stream=1` sends it (http/admin/runs.js), keyed by the follow it belongs to:
//
//   page → server   { op: "follow", key, run, since, words }    { op: "stop", key }
//   server → page   { key, data }          one frame of the stream: exactly the JSON the events route sends as `data:`
//                                          (the hello, each event with its `n`, the words, `ended`)
//                   { key, missing: true } the run is not held — where the route answers 404
//                   { key, failed }        it could not be read — where the route answers an error
//                   { key, end: true }     the follow is over — where the route ends its response
//
// The same socket carries a chat's browser, live, to a page with no app of its own to show the page itself — another
// machine's harness, a browser's tab (the owner's remote Filament of 11-06, Part 4): the tab its Browser pane shows, as
// the app casts it (app/browser/registry.js `watch`), and the person's clicks and keys back while they have taken it.
//
//   page → server   { op: "cast", key, chain }    { op: "stop", key }    { op: "input", key, input: { kind, … } }
//                                          (registry.js `inputCommand`: a mouse's, a key's, text put in)
//   server → page   { key, cast: { on, tab, why? } }   where the cast stands: on, or off and why (no tab, no app, an
//                                          app that casts nothing) — the page reads a picture of the page then
//                   { key, frame: { tab, seq, data, width, height, way } }   the page as the app paints it, a JPEG in
//                                          base64, at its own size (`width` × `height`, the space its points are in)
//                   { key, refused }       an input not taken, and why: the browser is not the person's, or the
//                                          page is a view-only device's (whose cast is off, VIEW_CAST_WORDS)
//
// A frame the socket cannot take yet waits as the newest alone: one that comes meanwhile takes its place, so a slow
// network shows the page as it is now, never a backlog of how it was.
//
// An upgrade passes no front door, so the socket holds the terminal stream's guards itself (admin/terminal.js): the
// artifacts' fence, the Host check, loopback or the admin token. A page anywhere may open a WebSocket to this host,
// where its fetch of the events route could never read the answer, so an Origin other than this server's is refused
// too. A frame the socket cannot take yet waits in its queue (http/events.js `writeHeld`); a page that stopped reading,
// its queue past the cap, is cut off, and each of its follows resumes from its own cursor on the page's next socket.
import { lowerHeaders } from "../../core/headers.js";
import { artifactNameOfHost, isArtifactOrigin } from "../../core/artifacts.js";
import { agentsDevice, countOwnerless, drives, endsWithDevice, hostAllowed, hostNameOf, ownOrigin, safeEq, whoIs } from "../guards.js";
import { wsHandshake, wsTextFrame, wsCloseFrame, wsPingFrame, wsPongFrame, WsDecoder } from "../ws.js";
import { drainedOrGone, writeHeld } from "../events.js";
import { eventJson, followRunEvents } from "../../services/runs.js";
import { wordsFrames } from "../../services/live-words.js";

export const RUN_SOCKET_PATH = "/api/runs/socket";
/** The replay's page, as the events route pages it. */
const PAGE = 5000;
/** A ping this often keeps an idle socket open through whatever sits between, as the events route's comment does. */
const HEARTBEAT_MS = 15_000;
/** A follow's key is the page's own short name for it. */
const MAX_KEY = 64;
/** What a cast says where this Filament was handed no chats' browsers. */
const NO_CASTS = "this Filament casts no browser";
/** What a view-only device's input is refused with. */
export const VIEW_INPUT_WORDS = "This device is paired view-only: it uses no chat's browser.";
/**
 * What a cast says to a view-only device: it reads none of a chat's browser, as the browser's own routes refuse it
 * (remote.js VIEW_ROUTES) — a page the developer uses there may show what they sign in with (the review of p4-browser).
 */
export const VIEW_CAST_WORDS = "A view-only device does not see the chat's browser.";

/**
 * @typedef {{ watch: (chain: string, w: { frame: (f: any) => void, state: (s: any) => void }) => () => void, input: (chain: string, ev: any, by?: unknown) => Promise<void> }} Casts
 *   the chats' browsers as a cast reaches them (app/browser/registry.js)
 */

/**
 * The upgrade for a page's run socket, or false where the path is another's.
 * @param {{ config: any, runs: import("../../services/runs.js").RunLog, liveWords?: import("../../services/live-words.js").LiveWords | null, sseClients?: Set<any> | null, devices?: import("../../services/devices.js").DeviceStore | null, browsers?: Casts | null }} a
 *   `sseClients`: the open streams shutdown ends — each socket joins them. `devices`: the paired devices, whose
 *   browsers' cookies open it. `browsers`: the chats' browsers, which a page watches live on it
 * @returns {(req: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => boolean}  true when it answered
 */
export function runSocketUpgrade(a) {
  const { config, runs, liveWords = null, sseClients = null, devices = null, browsers = null } = a;
  return (req, socket, head) => {
    const url = new URL(String(req.url || ""), "http://localhost");
    if (url.pathname !== RUN_SOCKET_PATH) return false;
    /** @param {string} why @param {number} status */
    const refuse = (why, status) => {
      socket.write(`HTTP/1.1 ${status} ${status === 404 ? "Not Found" : status === 400 ? "Bad Request" : "Forbidden"}\r\nconnection: close\r\n\r\n${why}`);
      socket.destroy();
      return true;
    };
    const h = lowerHeaders(req.headers);
    if (artifactNameOfHost(hostNameOf(req)) !== null) return refuse("no such websocket", 404);
    if (isArtifactOrigin(h.origin)) return refuse("an artifact's page reaches nothing of Filament's", 403);
    const server = config.get().server;
    if (!hostAllowed(req, server)) return refuse("host not allowed", 403);
    const token = url.searchParams.get("token") || (h["authorization"] || "").replace(/^bearer\s+/i, "") || h["x-filament-admin"] || "";
    // This computer, the admin token, or a paired device — a view-only one too: the socket follows runs, and reads.
    const who = whoIs(req, server, devices);
    // This computer's socket without its owner key, counted as its calls are (guards.js `countOwnerless`).
    countOwnerless(req, who);
    if (!who && !(server.adminToken && safeEq(token, server.adminToken))) return refuse("the run socket answers this machine, a paired device, or server.adminToken", 403);
    // Another machine's agents follow the runs of their chats by their events (/api/runs/:id/events), as their grant
    // lets them (remote.js AGENT_ROUTES): the socket follows every run, and serves the person's pages.
    if (agentsDevice(who)) return refuse("another machine's agents follow a run by its events (/api/runs/:id/events), not the run socket", 403);
    if (h.origin && !ownOrigin(h.origin, String(h.host || ""))) return refuse(`a page of another site reaches no run of Filament's (Origin ${h.origin})`, 403);
    const key = h["sec-websocket-key"];
    if (!key) return refuse("not a websocket handshake", 400);
    socket.write(wsHandshake(key));
    // Who may see and use a chat's browser from it, as from the pane: this computer, the admin token, a full device —
    // a view-only device neither.
    serve(socket, head, { runs, liveWords, sseClients, maxBytes: server.maxBodyBytes, browsers, drive: !who || drives(who) });
    // A device revoked, or signed out, follows no more: its socket closes at once.
    socket.on("close", endsWithDevice(devices, who, () => socket.destroy()));
    return true;
  };
}

/**
 * One page's socket, from its handshake to its close.
 * @param {import("node:stream").Duplex} socket @param {Buffer} head
 * @param {{ runs: import("../../services/runs.js").RunLog, liveWords: import("../../services/live-words.js").LiveWords | null, sseClients: Set<any> | null, maxBytes?: number, browsers: Casts | null, drive: boolean }} o
 *   `maxBytes`: the most one message of the page's may hold (server.maxBodyBytes); `drive`: its caller may see and use
 *   a chat's browser — a view-only device does neither
 */
function serve(socket, head, { runs, liveWords, sseClients, maxBytes, browsers, drive }) {
  /** The follows the page holds, by key: each one's stop. @type {Map<string, () => void>} */
  const follows = new Map();
  /** The casts among them: each one's chat. @type {Map<string, string>} */
  const casts = new Map();
  /** Each cast's watcher, which its input is sent as: a button it holds is let go as the cast stops. @type {Map<string, object>} */
  const watchers = new Map();
  let closed = false;
  const shut = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    for (const stop of [...follows.values()]) stop();
    sseClients?.delete(closer);
  };
  // Shutdown ends the socket with a close frame, as it ends the event streams.
  const closer = {
    end: () => {
      shut();
      try {
        socket.end(wsCloseFrame());
      } catch {}
    },
  };
  sseClients?.add(closer);
  /** One message to the page; false once the socket is gone, or was cut off for its backlog. @param {string} text */
  const send = (text) => {
    if (closed) return false;
    if (writeHeld(socket, wsTextFrame(text))) return true;
    shut();
    return false;
  };
  const ping = setInterval(() => {
    if (!closed && !writeHeld(socket, wsPingFrame())) shut();
  }, HEARTBEAT_MS);
  ping.unref?.();

  /**
   * A follow, as the events route serves one: the hello, the words when asked, the replay and then live, `ended` at
   * the run's end. A key the page asks again starts over.
   * @param {string} key @param {string} runId @param {number} since @param {boolean} words
   */
  const follow = (key, runId, since, words) => {
    if (closed) return;
    follows.get(key)?.();
    const keyed = JSON.stringify(key);
    /** A frame of the stream, spliced in as its JSON: an event's is the run log's own string. @param {string} json */
    const data = (json) => send(`{"key":${keyed},"data":${json}}`);
    /** @param {Record<string, unknown>} said */
    const say = (said) => send(JSON.stringify({ key, ...said }));
    const page = runs.events(runId, { since, limit: PAGE });
    if (!page) return void say({ missing: true });
    let over = false;
    /** @type {{ stop: () => void, live: Promise<void> } | null} */
    let run = null;
    /** @type {(() => void) | null} */
    let leaveWords = null;
    const stop = () => {
      if (over) return;
      over = true;
      run?.stop();
      leaveWords?.();
      if (follows.get(key) === stop) follows.delete(key);
    };
    follows.set(key, stop);
    data(JSON.stringify({ type: "hello", run: page.run, firstAvailable: page.firstAvailable, gap: page.gap }));
    if (words && liveWords) {
      const frames = wordsFrames({
        blocks: () => liveWords.blocks(runId),
        open: () => liveWords.open(runId),
        write: (frame) => data(JSON.stringify(frame)),
      });
      frames.start();
      leaveWords = liveWords.follow(runId, frames.piece);
    }
    run = followRunEvents(runs, runId, page, {
      since,
      pageSize: PAGE,
      send: (evt) => !over && data(eventJson(evt)),
      needsDrain: () => socket.writableNeedDrain,
      drained: () => drainedOrGone(socket),
      // A gap past the first page is said as the first page's is, in a hello of its own.
      onGap: (gap) => data(JSON.stringify({ type: "hello", gap })),
      onEnded: (status) => {
        data(JSON.stringify({ type: "ended", status }));
        stop();
        say({ end: true });
      },
    });
    // A page of the replay that could not be read fails the follow: the page asks again from its cursor.
    run.live.catch((/** @type {any} */ e) => {
      if (over) return;
      stop();
      say({ failed: String(e?.message || e) });
    });
  };

  /**
   * A cast: the chat's browser, live — where the cast stands, then each frame of the tab its pane shows. A frame the
   * socket cannot take yet waits as the newest alone: one that comes meanwhile takes its place. A key the page asks
   * again starts over.
   * @param {string} key @param {string} chain
   */
  const cast = (key, chain) => {
    // A socket shut takes no new watch: none would ever be stopped (the review of p4-browser).
    if (closed) return;
    follows.get(key)?.();
    /** @param {Record<string, unknown>} said */
    const say = (said) => send(JSON.stringify({ key, ...said }));
    if (!browsers) return void say({ cast: { on: false, tab: null, why: NO_CASTS } });
    if (!drive) return void say({ cast: { on: false, tab: null, why: VIEW_CAST_WORDS } });
    let over = false;
    /** The tab cast now, as the chat's browser last said: a frame held of another goes nowhere. @type {string | null} */
    let tab = null;
    /** The newest frame the socket could not take yet. @type {any} */
    let held = null;
    let waiting = false;
    /** @type {() => void} */
    let unwatch = () => {};
    /** @param {any} f */
    const frame = (f) => {
      if (over) return;
      if (!socket.writableNeedDrain) return void say({ frame: f });
      held = f;
      if (waiting) return;
      waiting = true;
      void drainedOrGone(socket).then(() => {
        waiting = false;
        const next = held;
        held = null;
        if (next && next.tab === tab) frame(next);
      });
    };
    const stop = () => {
      if (over) return;
      over = true;
      held = null;
      unwatch();
      if (follows.get(key) === stop) {
        follows.delete(key);
        casts.delete(key);
        watchers.delete(key);
      }
    };
    const watcher = {
      frame,
      state: (/** @type {any} */ s) => {
        if (over) return;
        tab = s?.tab ?? null;
        say({ cast: s });
      },
    };
    follows.set(key, stop);
    casts.set(key, chain);
    watchers.set(key, watcher);
    // What it says at once may find the socket gone: the watch it began then goes too.
    const off = browsers.watch(chain, watcher);
    if (over) off();
    else unwatch = off;
  };
  /**
   * The person's click, key or paste on a cast's page, sent on by the chat's browser while they have it; a refusal
   * said to the page — the browser the agent's, or the page a view-only device's.
   * @param {string} key @param {any} ev
   */
  const input = (key, ev) => {
    if (!drive) return void send(JSON.stringify({ key, refused: VIEW_INPUT_WORDS }));
    const chain = casts.get(key);
    if (chain === undefined || !browsers) return;
    browsers.input(chain, ev, watchers.get(key)).catch((/** @type {any} */ e) => {
      if (casts.get(key) === chain) send(JSON.stringify({ key, refused: String(e?.message || e) }));
    });
  };

  const dec = new WsDecoder(maxBytes);
  const onChunk = (/** @type {Buffer} */ chunk) => {
    let frames;
    try {
      frames = dec.feed(chunk);
    } catch {
      socket.destroy();
      return;
    }
    for (const f of frames) {
      // Shut — a close frame, or a write that ended it — the rest of the chunk is read no further.
      if (closed) return;
      if (f.opcode === 8) {
        closer.end();
        return;
      }
      if (f.opcode === 9) {
        writeHeld(socket, wsPongFrame());
        continue;
      }
      if (f.opcode !== 1) continue;
      /** @type {any} */
      let msg = null;
      try {
        msg = JSON.parse(f.text);
      } catch {}
      const key = typeof msg?.key === "string" ? msg.key : "";
      if (!key || key.length > MAX_KEY) continue;
      if (msg.op === "stop") follows.get(key)?.();
      else if (msg.op === "follow" && typeof msg.run === "string" && msg.run) {
        // A follow that cannot be read (the run log failed) is said to the page, never thrown into the socket's reader.
        try {
          follow(key, msg.run, Math.max(0, Number(msg.since) || 0), msg.words === true);
        } catch (/** @type {any} */ e) {
          follows.get(key)?.();
          send(JSON.stringify({ key, failed: String(e?.message || e) }));
        }
      } else if (msg.op === "cast" && typeof msg.chain === "string" && msg.chain) {
        try {
          cast(key, msg.chain);
        } catch (/** @type {any} */ e) {
          follows.get(key)?.();
          send(JSON.stringify({ key, failed: String(e?.message || e) }));
        }
      } else if (msg.op === "input") input(key, msg.input);
    }
  };
  socket.on("data", onChunk);
  // Bytes that arrived with the upgrade belong to the stream, same as any later chunk.
  if (head?.length) onChunk(head);
  socket.on("close", shut);
  socket.on("error", () => {
    shut();
    socket.destroy();
  });
}
