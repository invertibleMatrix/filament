// @ts-check
// This machine's localhost in a viewer's app (b-tunnel, the owner's design of 11-08): the agent here builds a web app and
// runs its dev server on localhost:5173, and its page in the developer's app — on another computer — opens
// http://localhost:5173 and loads it from here, believing itself on localhost: its cookies, its CORS, its OAuth
// redirects, its dev server's WebSocket alike. The app's profile for this machine sends its loopback to a proxy of the
// app's own (desktop/lib/tunnel.js), whose connections come here as streams over the viewer's link — the socket its
// pages are driven over (admin/browser.js), so a stream is that link's: the same full device, its revoke and its pings,
// gone as it goes. A stream is opened to this machine's loopback alone (127.x, ::1, a localhost name), never another
// host, and never at a port this Filament listens on (server.js `ownPlaces`): a connection there lands as this machine's
// own caller, the developer, admin of everything. A link that is no full device's viewer's carries none.
//
// The streams ride the socket's binary messages, each a frame: its kind (u8), its stream's id (u32), its body.
//   app → here   OPEN    port (u16), host (u8: 0 a localhost name, 4 an IPv4 address of 127/8 and its 4 bytes, 6 ::1)
//   here → app   OPENED  —  connected
//   either way   DATA    bytes, PIECE at the most, within what the other end granted
//                CREDIT  n (u32): n more bytes may come
//                END     no more bytes from this end
//                CLOSE   code (u8: DONE, REFUSED, FAILED), words: the stream is over, and why
// Each end may send a stream WINDOW bytes past what the other has granted, and grants as it hands bytes on: a big
// download waits on its reader instead of gathering at either end. A link holds MAX_STREAMS at once.
import net from "node:net";
import { Duplex } from "node:stream";

export const OPEN = 1;
export const OPENED = 2;
export const DATA = 3;
export const CREDIT = 4;
export const END = 5;
export const CLOSE = 6;
/** How a stream ended: by its ends' choice, refused by this machine's rules, or failed on the way. */
export const DONE = 0;
export const REFUSED = 1;
export const FAILED = 2;
/** The bytes an end may send a stream past what the other end has granted. */
export const WINDOW = 256 * 1024;
/** The most one DATA frame carries: the link's other messages wait behind no more. */
export const PIECE = 32 * 1024;
/** The streams one link holds at once. */
export const MAX_STREAMS = 64;
/** A localhost name, an IPv4 address of 127/8, ::1: the host an OPEN names. */
export const HOST_NAME = 0;
export const HOST_V4 = 4;
export const HOST_V6 = 6;

/** A frame. @param {number} kind @param {number} id @param {Buffer} [body] */
export function frameOf(kind, id, body) {
  const b = Buffer.allocUnsafe(5 + (body?.length ?? 0));
  b[0] = kind;
  b.writeUInt32BE(id >>> 0, 1);
  body?.copy(b, 5);
  return b;
}

/** A CLOSE's body. @param {number} code @param {string} words */
const closeBody = (code, words) => Buffer.concat([Buffer.from([code]), Buffer.from(String(words || "").slice(0, 1000), "utf8")]);
/** @param {number} n */
const u32 = (n) => {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
};

/** A stream's end in words, its code with it. @param {number} code @param {string} words */
export const tunnelError = (code, words) => Object.assign(new Error(words), { tunnel: code });

/**
 * A host on loopback as an OPEN names it — a localhost name, an IPv4 address of 127/8 (IPv6's way of writing one too),
 * ::1 — or null for any other. @param {string} hostname  as a URL or a CONNECT writes it
 * @returns {{ kind: number, v4?: number[] } | null}
 */
export function loopbackOf(hostname) {
  let h = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const [a, b] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
    h = `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  h = h.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return { kind: HOST_NAME };
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const n = v4.slice(1).map(Number);
    return n[0] === 127 && n.every((x) => x <= 255) ? { kind: HOST_V4, v4: n } : null;
  }
  return h === "::1" ? { kind: HOST_V6 } : null;
}

/** An OPEN's body. @param {number} port @param {{ kind: number, v4?: number[] }} at */
export function openBody(port, at) {
  return Buffer.from([port >> 8, port & 255, at.kind, ...(at.kind === HOST_V4 ? at.v4 ?? [] : [])]);
}

/**
 * What an OPEN asks: its port and the addresses it is tried at, in order — a localhost name at 127.0.0.1, then ::1 (a
 * dev server listens on either) —, or why it is no OPEN this end takes.
 * @param {Buffer} body @returns {{ port: number, addresses: string[], said: string } | { refused: string }}
 */
export function readOpen(body) {
  if (body.length < 3) return { refused: "the stream named no port" };
  const port = body.readUInt16BE(0);
  const kind = body[2];
  if (kind === HOST_NAME) return { port, addresses: ["127.0.0.1", "::1"], said: `localhost:${port}` };
  if (kind === HOST_V6) return { port, addresses: ["::1"], said: `[::1]:${port}` };
  if (kind === HOST_V4 && body.length >= 7 && body[3] === 127) {
    const at = [...body.subarray(3, 7)].join(".");
    return { port, addresses: [at], said: `${at}:${port}` };
  }
  return { refused: "the stream named a host that is no loopback's" };
}

/**
 * A stream of a link's, as a Duplex: what is written goes to the other end, within the credit it granted; what the
 * other end sends is read, and granted back as it is read on — held back while the reader is full.
 */
export class TunnelStream extends Duplex {
  /** @param {Mux} mux @param {number} id @param {number} window */
  constructor(mux, id, window) {
    super({ readableHighWaterMark: 2 * PIECE, writableHighWaterMark: 2 * PIECE });
    this.mux = mux;
    this.id = id;
    this.window = window;
    /** What this end may still send. */
    this.credit = window;
    /** What the other end sent and was not granted back yet. */
    this.unread = 0;
    /** Of it, read on and held back while the reader was full: granted as it asks for more. */
    this.owed = 0;
    /** A write waiting on credit. @type {{ chunk: Buffer, at: number, done: () => void } | null} */
    this.pending = null;
    /** The other end has closed it: nothing more goes there. */
    this.peerClosed = false;
    /** The other end sent its END. */
    this.eof = false;
    /** Its bytes have a reader: a socket joined to it, or a request over it. */
    this.joined = false;
    /** The other end connected it. */
    this.opened = false;
  }
  /** @param {Buffer} chunk @param {BufferEncoding} _enc @param {() => void} done */
  _write(chunk, _enc, done) {
    if (this.peerClosed) return done();
    this.pending = { chunk, at: 0, done };
    this.pump();
  }
  /** The waiting write sent, as far as the credit goes. */
  pump() {
    const p = this.pending;
    while (p && this.credit > 0 && p.at < p.chunk.length) {
      const n = Math.min(this.credit, PIECE, p.chunk.length - p.at);
      this.mux.send(frameOf(DATA, this.id, p.chunk.subarray(p.at, p.at + n)));
      p.at += n;
      this.credit -= n;
    }
    if (p && p.at >= p.chunk.length) {
      this.pending = null;
      p.done();
    }
  }
  /** @param {(e?: Error | null) => void} done */
  _final(done) {
    if (!this.peerClosed) this.mux.send(frameOf(END, this.id));
    done();
  }
  _read() {
    if (!this.owed) return;
    const n = this.owed;
    this.owed = 0;
    this.grant(n);
  }
  /** @param {number} n */
  grant(n) {
    this.unread -= n;
    if (!this.peerClosed) this.mux.send(frameOf(CREDIT, this.id, u32(n)));
  }
  /** @param {Error | null} err @param {(e?: Error | null) => void} done */
  _destroy(err, done) {
    this.mux.forget(this);
    this.pending = null;
    if (!this.peerClosed) {
      this.peerClosed = true;
      const code = err ? Number(/** @type {any} */ (err).tunnel ?? FAILED) : DONE;
      this.mux.send(frameOf(CLOSE, this.id, closeBody(code, err ? err.message : "")));
    }
    done(err);
  }
  /** The other end's bytes. @param {Buffer} buf */
  hearData(buf) {
    if (this.eof || this.destroyed) return;
    if (this.unread + buf.length > this.window) return void this.destroy(tunnelError(FAILED, "the other end sent past the window it was granted"));
    this.unread += buf.length;
    if (this.push(buf)) this.grant(buf.length);
    else this.owed += buf.length;
  }
  /** @param {number} n */
  hearCredit(n) {
    this.credit += n;
    this.pump();
  }
  hearEnd() {
    if (this.eof) return;
    this.eof = true;
    this.push(null);
  }
  /** @param {number} code @param {string} words */
  hearClose(code, words) {
    this.peerClosed = true;
    // Gone from the link at once — no frame of its is read, and it holds no place under the cap — whatever its socket
    // here still takes to close.
    this.mux.forget(this);
    // Closed before it opened, however: it fails, so what waits on its opening hears it (a CONNECT answered).
    if (!this.opened) return void this.destroy(tunnelError(code === DONE ? FAILED : code, words || "the stream closed before it opened"));
    // Failed before the other end said its END, its bytes are cut short: the stream fails here too. Over by its choice,
    // or after its END, all it sent is here and is read to its end; what is written here has nowhere to go.
    if (!this.joined || (code !== DONE && !this.eof)) return void this.destroy(code === DONE ? undefined : tunnelError(code, words || "the stream failed"));
    this.hearEnd();
    const p = this.pending;
    this.pending = null;
    p?.done();
  }
}

/**
 * @typedef {{ send: (b: Buffer) => void, forget: (s: TunnelStream) => void, readonly size: number, open: (body: Buffer) => TunnelStream | null,
 *   accept: (id: number) => TunnelStream, refuse: (id: number, code: number, words: string) => void, take: (buf: Buffer) => void,
 *   close: (why: string) => void }} Mux
 */

/**
 * A link's streams: each frame read is its stream's, each frame written goes out by `send`. `onOpen` hears what the
 * other end opens — none is taken where it is not given.
 * @param {{ send: (b: Buffer) => void, window?: number, maxStreams?: number, onOpen?: ((id: number, body: Buffer) => void) | null }} o
 * @returns {Mux}
 */
export function createMux({ send, window = WINDOW, maxStreams = MAX_STREAMS, onOpen = null }) {
  /** @type {Map<number, TunnelStream>} */
  const streams = new Map();
  let shut = false;
  let next = 1;
  /** @type {Mux} */
  const mux = {
    send: (b) => {
      if (!shut) send(b);
    },
    forget: (s) => {
      if (streams.get(s.id) === s) streams.delete(s.id);
    },
    get size() {
      return streams.size;
    },
    open(body) {
      if (shut || streams.size >= maxStreams) return null;
      const id = next;
      next = next >= 0xffffffff ? 1 : next + 1;
      const s = new TunnelStream(mux, id, window);
      streams.set(id, s);
      send(frameOf(OPEN, id, body));
      return s;
    },
    accept(id) {
      const s = new TunnelStream(mux, id, window);
      streams.set(id, s);
      return s;
    },
    refuse(id, code, words) {
      mux.send(frameOf(CLOSE, id, closeBody(code, words)));
    },
    take(buf) {
      if (shut || buf.length < 5) return;
      const kind = buf[0];
      const id = buf.readUInt32BE(1);
      const body = buf.subarray(5);
      const s = streams.get(id);
      if (kind === OPEN) {
        if (s) return void s.destroy(tunnelError(FAILED, "a stream was opened twice"));
        if (!onOpen) return mux.refuse(id, REFUSED, "this end opens no stream for the other");
        if (streams.size >= maxStreams) return mux.refuse(id, REFUSED, `${maxStreams} streams are open on this link already: another opens as one closes`);
        return onOpen(id, body);
      }
      if (!s) return;
      if (kind === OPENED) {
        s.opened = true;
        s.emit("opened");
      } else if (kind === DATA) s.hearData(body);
      else if (kind === CREDIT && body.length >= 4) s.hearCredit(body.readUInt32BE(0));
      else if (kind === END) s.hearEnd();
      else if (kind === CLOSE) s.hearClose(body.length ? body[0] : DONE, body.subarray(1).toString("utf8"));
    },
    close(why) {
      if (shut) return;
      shut = true;
      for (const s of [...streams.values()]) {
        s.peerClosed = true;
        s.destroy(tunnelError(FAILED, why));
      }
      streams.clear();
    },
  };
  return mux;
}

/**
 * A socket and a stream joined: each one's bytes the other's, each one's end the other's. A socket that closes before
 * it ended the stream ends it abruptly, told to the other end; one that closes after reads off what still comes.
 * @param {import("node:stream").Duplex} sock @param {TunnelStream} s
 */
export function join(sock, s) {
  s.joined = true;
  sock.pipe(s);
  s.pipe(sock);
  sock.on("error", (/** @type {any} */ e) => s.destroy(tunnelError(FAILED, String(e?.code || e?.message || e))));
  sock.on("close", () => {
    if (!s.writableEnded) return void s.destroy();
    s.resume();
  });
  s.on("error", () => sock.destroy());
  s.on("close", () => {
    if (!sock.destroyed) sock.end();
  });
}

/**
 * This machine's end of a link's streams: each OPEN a connection to its loopback at the port, the words said back where
 * it is refused — a link no full device's viewer holds (`viewer` null), a host that is no loopback's, a port this
 * Filament listens on — or nothing answers there. `close` as the link goes: every stream ends.
 * @param {{ send: (b: Buffer) => void, viewer: boolean, places: () => { ports: number[] }, name?: () => string,
 *   connect?: (o: net.NetConnectOpts) => net.Socket, window?: number, maxStreams?: number }} o
 */
export function tunnelEnd({ send, viewer, places, name = () => "this machine", connect = net.connect, window = WINDOW, maxStreams = MAX_STREAMS }) {
  /** @param {number} id @param {Buffer} body */
  const onOpen = (id, body) => {
    const here = name() || "this machine";
    if (!viewer) return mux.refuse(id, REFUSED, `Only the desktop app of a full device that views ${here} carries pages to its localhost.`);
    const at = readOpen(body);
    if ("refused" in at) return mux.refuse(id, REFUSED, `The tunnel to ${here} carries its own localhost alone (localhost, 127.x, ::1): ${at.refused}.`);
    let own = true;
    try {
      own = places().ports.includes(at.port) || at.port === 0;
    } catch {}
    if (own) return mux.refuse(id, REFUSED, `${at.said} is where ${here}'s Filament is reached: its API acts for the developer, so no page reaches it.`);
    const s = mux.accept(id);
    // Its failure is told to the other end as it closes (`_destroy`); nothing more listens for it here.
    s.on("error", () => {});
    /** @param {number} i */
    const dial = (i) => {
      // Half open as the page's own end is: a server's end reaches the page, and what the page still sends reaches it.
      const sock = connect({ host: at.addresses[i], port: at.port, allowHalfOpen: true });
      sock.setNoDelay?.(true);
      let up = false;
      const gone = () => void sock.destroy();
      s.once("close", gone);
      sock.once("connect", () => {
        up = true;
        if (s.destroyed) return void sock.destroy();
        mux.send(frameOf(OPENED, id));
        // Open at both ends now: a CLOSE that comes after ends it as a joined stream ends, never as one that never opened.
        s.opened = true;
        join(sock, s);
      });
      sock.once("error", (/** @type {any} */ e) => {
        if (up) return;
        s.off("close", gone);
        sock.destroy();
        if (s.destroyed) return;
        if (i + 1 < at.addresses.length) return dial(i + 1);
        s.destroy(tunnelError(FAILED, `Nothing on ${here} answers at ${at.said} (${String(e?.code || e?.message || e)}): is its server running there?`));
      });
    };
    dial(0);
  };
  const mux = createMux({ send, window, maxStreams, onOpen });
  return {
    take: mux.take,
    /** The link went: every stream ends. @param {string} [why] */
    close: (why = "the link went") => mux.close(why),
    /** The streams open now. */
    get streams() {
      return mux.size;
    },
  };
}

/**
 * Each link's end of the streams, for the browser host's socket (admin/browser.js): a full device's viewer's link
 * carries streams to this machine's loopback; any other link's are refused.
 * @param {{ places: () => { ports: number[] }, name?: () => string, connect?: (o: net.NetConnectOpts) => net.Socket, window?: number, maxStreams?: number }} o
 * @returns {(viewer: { scope?: string } | null, send: (b: Buffer) => void) => ReturnType<typeof tunnelEnd>}
 */
export const tunnelsFor = (o) => (viewer, send) => tunnelEnd({ ...o, send, viewer: viewer?.scope === "full" });
