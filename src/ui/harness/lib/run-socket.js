// @ts-check
// The page's run follows, on one WebSocket (http/admin/run-socket.js). A browser gives a page six HTTP/1.1 connections
// to a host, shared by every window of the app, and a run followed as an event stream held one of them for as long as
// it ran: with a few chats at work — followed while they run, whichever is shown — their threads and the Run pane's
// views, the page's other requests, the transcript of the chat just clicked among them, waited for a free one. A
// WebSocket counts against none of the six. The socket opens with the page's first follow and closes as its last one
// ends; the server keys every frame by the follow it belongs to. A chat's browser, live, rides it too (`cast`): for a
// Browser pane with no app of its own, the page's frames, and the person's clicks and keys back.

/**
 * One follow's ears: what the socket hands it, until one of the last three.
 * @typedef {object} RunTap
 * @property {(j: any, data: string) => void} frame  one frame of the run's stream, parsed, and its JSON as it came
 * @property {() => void} missing  the server holds no such run
 * @property {() => void} end  the server ended the follow: the run's end was sent, or it has nothing more to send
 * @property {() => void} drop  the socket closed, or the server could not read the run: the follow is gone there
 */

/**
 * A cast's frame: the page as the app paints it, a JPEG in base64, at the page's own size — the space its points are in.
 * @typedef {{ tab: string, seq: number, data: string, width: number, height: number, way?: string }} CastFrame
 */

/**
 * One cast's ears (http/admin/run-socket.js): where it stands, each frame, an input refused — until the drop.
 * @typedef {object} CastTap
 * @property {(s: { on: boolean, tab: string | null, why?: string }) => void} state  on, or off and why
 * @property {(f: CastFrame) => void} frame
 * @property {(why: string) => void} refused  an input of the person's was not taken
 * @property {() => void} drop  the socket closed, or the server ended the cast: it is gone there
 */

const OPEN = 1; // WebSocket.OPEN

/** The socket's address, on the page's own host. */
const address = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/runs/socket`;

/**
 * The page's run socket. `open`: the socket to use (a test's; the page's own by default).
 * @param {{ open?: () => WebSocket }} [o]
 */
export function createRunSocket({ open = () => new WebSocket(address()) } = {}) {
  /** @type {WebSocket | null} */
  let ws = null;
  let keys = 0;
  /**
   * The follows the socket carries, by key: each one's ears — a run's (`tap`) or a cast's (`cast`) — and the ask that
   * starts it on a socket that opens.
   * @type {Map<string, { tap?: RunTap, cast?: CastTap, ask: string }>}
   */
  const taps = new Map();
  /** Every follow the socket carried is gone with it. */
  const dropAll = () => {
    const dropped = [...taps.values()];
    taps.clear();
    for (const t of dropped) (t.tap || t.cast)?.drop();
  };
  /**
   * A follow on the socket — opened now when none is. → its key, and its stop: it asks the server to stop, and closes
   * the socket when it was the last follow.
   * @param {(key: string) => { tap?: RunTap, cast?: CastTap, ask: string }} make
   */
  const start = (make) => {
    const key = String(++keys);
    const t = make(key);
    taps.set(key, t);
    if (!ws) connect();
    else if (ws.readyState === OPEN) ws.send(t.ask);
    return {
      key,
      stop: () => {
        if (!taps.delete(key)) return;
        if (!taps.size) close();
        else if (ws?.readyState === OPEN) ws.send(JSON.stringify({ op: "stop", key }));
      },
    };
  };
  const close = () => {
    const sock = ws;
    ws = null;
    sock?.close();
  };
  const connect = () => {
    /** @type {WebSocket} */
    let sock;
    try {
      sock = open();
    } catch {
      // No socket could be made: as one that closed at once, said after the follow has its stop.
      void Promise.resolve().then(dropAll);
      return;
    }
    ws = sock;
    sock.onopen = () => {
      for (const { ask } of taps.values()) sock.send(ask);
    };
    sock.onmessage = (e) => {
      const text = String(e.data);
      /** @type {any} */
      let m = null;
      try {
        m = JSON.parse(text);
      } catch {}
      const t = taps.get(String(m?.key));
      if (!t) return;
      // The frame is spliced in after its key, as the server wrote it: its JSON is the message's own text.
      if (t.tap && "data" in m) return t.tap.frame(m.data, text.slice(text.indexOf(',"data":') + 8, -1));
      if (t.cast && "frame" in m) return t.cast.frame(m.frame);
      if (t.cast && "cast" in m) return t.cast.state(m.cast);
      if (t.cast && "refused" in m) return t.cast.refused(String(m.refused));
      taps.delete(m.key);
      if (!taps.size) close();
      if (t.cast) t.cast.drop();
      else if (m.missing) t.tap?.missing();
      else if (m.end) t.tap?.end();
      else t.tap?.drop();
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      dropAll();
    };
  };
  return {
    /**
     * Follow a run on the page's socket — opened now when none is — after event `since`, with its words when asked.
     * → the stop: it asks the server to stop, and closes the socket when it was the last follow.
     * @param {string} run @param {{ since?: number, words?: boolean }} from @param {RunTap} tap
     * @returns {() => void}
     */
    tap(run, { since = 0, words = false }, tap) {
      return start((key) => ({ tap, ask: JSON.stringify({ op: "follow", key, run, since, words }) })).stop;
    },
    /**
     * Watch a chat's browser live on the page's socket: where its cast stands, then each frame of the tab its pane
     * shows. → its stop, and `input`: the person's click, key or paste, sent to the page while the socket is open
     * (http/admin/run-socket.js; nothing is kept for a socket not open — a click late is no click).
     * @param {string} chain @param {CastTap} cast
     * @returns {{ stop: () => void, input: (ev: Record<string, unknown>) => void }}
     */
    cast(chain, cast) {
      const { key, stop } = start((k) => ({ cast, ask: JSON.stringify({ op: "cast", key: k, chain }) }));
      return {
        stop,
        input: (ev) => {
          // Its own fields apart from the message's: a key's `key` is the key pressed, not the follow's.
          if (taps.has(key) && ws?.readyState === OPEN) ws.send(JSON.stringify({ op: "input", key, input: ev }));
        },
      };
    },
  };
}

/** The page's one run socket. */
export const runSocket = createRunSocket();
