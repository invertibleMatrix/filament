// @ts-check
// A page's run socket (http/admin/run-socket.js), stood in for the harness's `followRun` under node: a server that
// takes the socket's upgrade and hands each message of the page to the test, with the frames to answer it in — and
// the page's address pointed at it, since the page's socket opens on its own host (lib/run-socket.js).
import { createServer } from "node:http";
import { wsHandshake, wsTextFrame, WsDecoder } from "../../src/http/ws.js";

/** The page's address, as `location` names it: the run socket opens there. @param {string} base  http://host:port */
export function pointPageAt(base) {
  const u = new URL(base);
  const g = /** @type {any} */ (globalThis);
  g.location = Object.assign(g.location || {}, { protocol: u.protocol, host: u.host });
}

/**
 * @typedef {object} Peer  one page's socket, as the test answers it
 * @property {(key: string, frame: any) => void} data  a frame of the run's stream
 * @property {(key: string) => void} missing
 * @property {(key: string) => void} end
 * @property {() => void} close  the socket cut, as a dropped connection
 * @property {boolean} closed
 */

/**
 * The page's run socket with no server at all: a WebSocket class for `globalThis.WebSocket`, opened by the page's own
 * run socket (lib/run-socket.js), whose follows `onAsk(msg, peer)` answers in the process — for a page drawn on a DOM
 * stand-in. What the peer sends reaches the page a microtask later, as a socket's message would.
 * @param {(msg: any, peer: Peer) => void} onAsk
 */
export function runSocketStandIn(onAsk) {
  return class StandIn {
    constructor() {
      this.readyState = 0;
      /** @type {((e?: any) => void) | null} */ this.onopen = null;
      /** @type {((e: { data: string }) => void) | null} */ this.onmessage = null;
      /** @type {((e?: any) => void) | null} */ this.onclose = null;
      /** @param {any} o */
      const send = (o) => queueMicrotask(() => {
        if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(o) });
      });
      /** @type {Peer} */
      this.peer = {
        data: (key, frame) => send({ key, data: frame }),
        missing: (key) => send({ key, missing: true }),
        end: (key) => send({ key, end: true }),
        close: () => this.close(),
        closed: false,
      };
      queueMicrotask(() => {
        if (this.readyState !== 0) return;
        this.readyState = 1;
        this.onopen?.();
      });
    }
    /** @param {string} text */
    send(text) {
      onAsk(JSON.parse(text), this.peer);
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.peer.closed = true;
      queueMicrotask(() => this.onclose?.());
    }
  };
}

/**
 * The page's run socket, stood in for a test that answers a run's stream as the events route does: each follow asks
 * `respond` for `/api/runs/<run>/events?since=…&stream=1`, and the answer reaches the page on the socket as the server's
 * socket carries it — each `data:` frame, `missing` for a 404, the follow's end where the body ends. No answer (null)
 * leaves the follow waiting, as a request nobody answers does.
 * @param {(path: string) => Response | null | Promise<Response | null>} respond
 */
export function runSocketFromRoutes(respond) {
  return runSocketStandIn(async (msg, peer) => {
    if (msg.op !== "follow") return;
    const res = await respond(`/api/runs/${encodeURIComponent(msg.run)}/events?since=${msg.since}&stream=1${msg.words ? "&words=1" : ""}`);
    if (!res) return;
    if (res.status === 404) return void peer.missing(msg.key);
    const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (peer.closed) return;
      buf += done ? "" : dec.decode(value, { stream: true });
      for (let at = buf.indexOf("\n\n"); at >= 0; at = buf.indexOf("\n\n")) {
        const data = /^data: (.*)$/m.exec(buf.slice(0, at))?.[1];
        buf = buf.slice(at + 2);
        if (data) peer.data(msg.key, JSON.parse(data));
      }
      if (done) return void peer.end(msg.key);
    }
  });
}

/**
 * A server that answers the page's run socket: `onAsk(msg, peer)` hears each message the page sends (`follow` and
 * `stop`); `onRequest` answers a plain request (404 without one). Its address is the page's (`pointPageAt`).
 * → `{ url, sockets, requests, close }`: `sockets` counts the upgrades taken, `requests` the plain requests.
 * @param {(msg: any, peer: Peer) => void} onAsk
 * @param {{ onRequest?: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void }} [o]
 */
export async function fakeRunSocket(onAsk, { onRequest } = {}) {
  /** @type {import("node:net").Socket[]} */
  const open = [];
  const seen = { sockets: 0, requests: 0 };
  const server = createServer((req, res) => {
    seen.requests++;
    if (onRequest) onRequest(req, res);
    else res.writeHead(404).end();
  });
  server.on("upgrade", (req, socket, head) => {
    if (!String(req.url).startsWith("/api/runs/socket")) return void socket.destroy();
    seen.sockets++;
    open.push(/** @type {any} */ (socket));
    socket.write(wsHandshake(String(req.headers["sec-websocket-key"])));
    /** @param {any} o */
    const send = (o) => {
      if (!peer.closed) socket.write(wsTextFrame(JSON.stringify(o)));
    };
    /** @type {Peer} */
    const peer = {
      data: (key, frame) => send({ key, data: frame }),
      missing: (key) => send({ key, missing: true }),
      end: (key) => send({ key, end: true }),
      close: () => {
        peer.closed = true;
        socket.destroy();
      },
      closed: false,
    };
    socket.on("close", () => void (peer.closed = true));
    socket.on("error", () => {});
    const dec = new WsDecoder();
    const take = (/** @type {Buffer} */ chunk) => {
      for (const f of dec.feed(chunk)) {
        if (f.opcode === 8) {
          peer.closed = true;
          socket.end();
          return;
        }
        if (f.opcode === 1) onAsk(JSON.parse(f.text), peer);
      }
    };
    socket.on("data", take);
    if (head?.length) take(head);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const url = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  pointPageAt(url);
  return {
    url,
    get sockets() {
      return seen.sockets;
    },
    get requests() {
      return seen.requests;
    },
    close: async () => {
      for (const s of open) s.destroy();
      server.closeAllConnections();
      await new Promise((r) => server.close(() => r(undefined)));
    },
  };
}
