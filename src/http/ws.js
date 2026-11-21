// @ts-check
// A minimal WebSocket endpoint for the harness's sockets (RFC 6455, server side only): the handshake accept key, the
// text- and binary-frame encoders, the control frames, and a stateful frame decoder. Hand-rolled because the WebSockets
// the harness opens talk only to our own client on loopback — no extensions, no compression — and a library for that
// was more surface than the protocol slice used. Everything here is pure and unit-tested; the server wiring lives in
// admin/terminal.js (a terminal's stream), admin/browser.js (the desktop app's browser host, and a viewer's app's
// streams to this machine's loopback, admin/tunnel.js) and admin/run-socket.js (a page's run follows).

import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** @param {string} key the request's Sec-WebSocket-Key @returns {string} the Sec-WebSocket-Accept value */
export function wsAcceptKey(key) {
  return createHash("sha1").update(String(key) + GUID).digest("base64");
}

/** The 101 handshake response, written raw on the upgraded socket. @param {string} key */
export function wsHandshake(key) {
  return [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${wsAcceptKey(key)}`,
    "\r\n",
  ].join("\r\n");
}

/**
 * One unmasked text frame (server→client). Long payloads take their extended length form; the client's browser
 * WebSocket does the parsing.
 * @param {string} text
 */
export function wsTextFrame(text) {
  return serverFrame(0x81, Buffer.from(text, "utf8")); // FIN + text
}

/** One unmasked binary frame (server→client): a stream's bytes (admin/tunnel.js). @param {Buffer} payload */
export function wsBinaryFrame(payload) {
  return serverFrame(0x82, payload); // FIN + binary
}

/** An unmasked frame: its first byte, its length in the form its size takes, its payload. @param {number} b0 @param {Buffer} payload */
function serverFrame(b0, payload) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = b0;
  return Buffer.concat([head, payload]);
}

/** One unmasked close frame with a normal-career code, the polite server goodbye. */
export function wsCloseFrame() {
  const f = Buffer.alloc(4);
  f[0] = 0x88; // FIN + close
  f[1] = 2;
  f.writeUInt16BE(1000, 2);
  return f;
}

/** One unmasked ping, no payload: the server's keepalive (a browser answers it with a pong by itself). */
export function wsPingFrame() {
  return Buffer.from([0x89, 0x00]); // FIN + ping
}

/** One unmasked pong, no payload: the answer to a client's ping. */
export function wsPongFrame() {
  return Buffer.from([0x8a, 0x00]); // FIN + pong
}

/** The most one message may hold where its socket names no cap: server.maxBodyBytes's own default. */
const MESSAGE_MAX = 64 * 1024 * 1024;

/**
 * @typedef {{ opcode: number, text: string, data?: Buffer }} WsMessage  a whole message: `text`, a text message's payload
 *   decoded, "" for the others; `data`, a binary message's bytes
 */

/**
 * The stream of bytes off the socket into whole frames. Client→server frames MUST be masked (the RFC) and are
 * unmasked here; text payloads decode as UTF-8, binary ones come as their bytes. The bytes read are held in the chunks
 * they came in and joined once a frame is whole, so a big message costs its own size in copies, never its square.
 * Control frames (close, ping, pong) may interleave with a fragmented message; each lands in its own event. A frame
 * whose header says more than `maxBytes`, or a fragmented message whose pieces come to more, throws before its bytes
 * are held: the socket's reader ends the stream, as it ends one it cannot read.
 */
export class WsDecoder {
  /** @param {number} [maxBytes]  the most one message may hold, whole or in fragments (the socket's server.maxBodyBytes) */
  constructor(maxBytes = MESSAGE_MAX) {
    /** the bytes read and not yet framed, in the chunks they came in @type {Buffer[]} */
    this.chunks = [];
    /** how many bytes they hold */
    this.held = 0;
    this.decoder = new TextDecoder();
    this.maxBytes = maxBytes;
    /** carried between continuation frames @type {Buffer[]} */
    this.fragments = [];
    /** the bytes the fragments carried so far */
    this.fragmentBytes = 0;
    this.fragmentOpcode = 0;
  }

  /** The first `n` bytes held, as one buffer: no more than them copied. @param {number} n */
  peek(n) {
    return this.chunks[0].length >= n ? this.chunks[0] : Buffer.concat(this.chunks, n);
  }

  /** The first `n` bytes held, taken: what is held joined once, the rest kept. @param {number} n */
  take(n) {
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.held);
    this.chunks = all.length > n ? [all.subarray(n)] : [];
    this.held -= n;
    return all.subarray(0, n);
  }

  /**
   * A message's payload as its event: a text message's decoded, a binary one's bytes.
   * @param {number} opcode @param {Buffer} payload @returns {WsMessage}
   */
  message(opcode, payload) {
    return opcode === 2 ? { opcode, text: "", data: payload } : { opcode, text: this.decoder.decode(payload) };
  }

  /**
   * Feed socket bytes; returns the whole messages found, oldest first (`WsMessage`); control frames carry "".
   * @param {Buffer} chunk
   * @returns {WsMessage[]}
   */
  feed(chunk) {
    if (chunk.length) {
      this.chunks.push(chunk);
      this.held += chunk.length;
    }
    /** @type {WsMessage[]} */
    const out = [];
    for (;;) {
      if (this.held < 2) break;
      const h = this.peek(Math.min(this.held, 14));
      const b0 = h[0];
      const b1 = h[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      const len7 = b1 & 0x7f;
      let lenBytes = 0;
      if (len7 === 126) lenBytes = 2;
      else if (len7 === 127) lenBytes = 8;
      const maskBytes = masked ? 4 : 0;
      const headerLen = 2 + lenBytes + maskBytes;
      if (this.held < headerLen) break;
      let len = len7;
      if (lenBytes === 2) len = h.readUInt16BE(2);
      else if (lenBytes === 8) {
        len = Number(h.readBigUInt64BE(2));
        if (!Number.isSafeInteger(len)) throw new Error("websocket frame too large");
      }
      // A control frame is a message of its own; a data frame adds to the fragments a message holds so far.
      const control = opcode === 8 || opcode === 9 || opcode === 10;
      if (len + (control ? 0 : this.fragmentBytes) > this.maxBytes) throw new Error("websocket message too large");
      if (this.held < headerLen + len) break;
      const frame = this.take(headerLen + len);
      let payload = frame.subarray(headerLen);
      if (masked) {
        const key = frame.subarray(headerLen - 4, headerLen);
        const un = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) un[i] = payload[i] ^ key[i & 3];
        payload = un;
      }
      if (opcode === 0) {
        // A continuation: its bytes belong to the message the first frame started.
        this.fragments.push(payload);
        this.fragmentBytes += len;
        if (fin) {
          const whole = Buffer.concat(this.fragments);
          this.fragments = [];
          this.fragmentBytes = 0;
          out.push(this.message(this.fragmentOpcode, whole));
          this.fragmentOpcode = 0;
        }
        continue;
      }
      if (control) {
        out.push({ opcode, text: "" });
        continue;
      }
      if (!fin) {
        this.fragmentOpcode = opcode;
        this.fragments.push(payload);
        this.fragmentBytes += len;
        continue;
      }
      out.push(this.message(opcode, payload));
    }
    return out;
  }

  /** Flush a half-decoded UTF-8 tail (the decoder's stream mode leaves none unless the socket died mid-character). */
  flush() {
    return this.decoder.decode();
  }
}
