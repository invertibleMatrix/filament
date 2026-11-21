// @ts-check
// Waiting in tests without fixed pauses (the facade plan's guardrail 22): a test waits for the thing itself — a state
// it can read, an event, a gate it opens — never for a stretch of time it hopes is long enough. A condition that
// already holds returns at once; one that never holds fails at the deadline and says what it was waiting for. Every
// deadline is its own times `FILAMENT_TEST_WAIT_SCALE` (`waitScale`), for a machine busy with more than this run.

import { rmSync } from "node:fs";

const POLL_MS = 5;

/**
 * How many times its deadline each wait is given: `FILAMENT_TEST_WAIT_SCALE`, where it names a number above 0, else 1.
 * Beside other suites and agents a machine reaches the same state later, past deadlines a run alone never comes near;
 * `FILAMENT_TEST_WAIT_SCALE=3 npm test` gives every wait three times as long. A wait returns as soon as its condition
 * holds, so a larger scale never slows a run whose waits hold; one that never holds still fails, at the longer deadline.
 */
const waitScale = () => {
  const n = Number(process.env.FILAMENT_TEST_WAIT_SCALE);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/**
 * `ms` times `waitScale()`: a stretch a test lets pass where there is nothing to wait for — to see that something does
 * not happen, or the most it gives one before taking it as not come — which a busy machine stretches as it does a wait.
 * @param {number} ms
 */
export const scaledMs = (ms) => Math.round(ms * waitScale());

/**
 * Remove test dirs, waiting for each to be removable. On Windows a child that was just stopped (a shell, an MCP
 * server, a sub-agent's command) holds its working directory until it has exited, which can take a moment after the
 * kill; the removal is tried until it goes. A dir that still will not go fails at the deadline and names itself: a
 * leak — or a process that outlived its stop — fails the test that made it instead of piling up in %TEMP%
 * (HarnessV3-FixRound F1 item 1). (`rmSync`'s own `maxRetries` does not retry here: the synchronous form gave up at
 * once.)
 * @param {...(string | null | undefined)} dirs
 */
export async function removeDirs(...dirs) {
  for (const d of dirs) {
    if (!d) continue;
    await until(() => {
      try {
        rmSync(d, { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    }, `${d} to be removable (a process that was stopped may still hold it)`);
  }
}

/**
 * Wait until `cond` gives a truthy value, and return that value.
 * @template T
 * @param {() => T | Promise<T>} cond
 * @param {string} what  what the test waits for, said in the failure ("the lock to come free")
 * @param {{ timeoutMs?: number }} [o]  the deadline, 10 s unless given; either is multiplied by `waitScale()`
 * @returns {Promise<T>}
 */
export async function until(cond, what, { timeoutMs = 10_000 } = {}) {
  const ms = Math.round(timeoutMs * waitScale());
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await cond();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/**
 * A promise the test opens by hand.
 * @template [T=void]
 */
export function gate() {
  /** @type {(value: T) => void} */
  let resolve = () => {};
  const promise = /** @type {Promise<T>} */ (new Promise((r) => (resolve = r)));
  let opened = false;
  return {
    promise,
    /** @param {T} [value] */
    open(value) {
      opened = true;
      resolve(/** @type {T} */ (value));
    },
    get opened() {
      return opened;
    },
  };
}

/**
 * An upstream reply the test holds back: `arrived` resolves when the call reaches the fake upstream — the request is
 * in flight, past memory's prepare (a harness turn holding its chat's lock) — and the reply goes out on `release()`.
 * Only that first call is held: a later one is answered at once, so a request that should never have gone upstream
 * fails its test instead of hanging it.
 * @param {any | ((call: any) => any)} reply  the reply, or a function of the call that builds it
 */
export function heldReply(reply) {
  const arrived = gate();
  const released = gate();
  /** @param {any} call */
  const answer = (call) => (typeof reply === "function" ? reply(call) : reply);
  return {
    /** The fake upstream's script. @param {any} call */
    script: async (call) => {
      if (arrived.opened) return answer(call);
      arrived.open(call);
      await released.promise;
      return answer(call);
    },
    arrived: arrived.promise,
    release: () => released.open(),
  };
}

/**
 * An SSE upstream body the test feeds by hand: `push(...events)` sends raw SSE text, `end()` closes the stream. A stop
 * can land exactly between two chunks. `cancelled` says whether the reader was cancelled (a stop's cut hangs up on
 * the upstream).
 * @param {string[]} [first]  events sent as soon as the body is read
 */
export function fedStream(first = []) {
  const enc = new TextEncoder();
  /** @type {ReadableStreamDefaultController<Uint8Array> | null} */
  let ctrl = null;
  let cancelled = false;
  let ended = false;
  const body = new ReadableStream({
    start(c) {
      ctrl = c;
      for (const e of first) c.enqueue(enc.encode(e));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    status: 200,
    headers: { "content-type": "text/event-stream" },
    body,
    /** @param {string[]} events */
    push(...events) {
      if (ended || cancelled) return;
      for (const e of events) ctrl?.enqueue(enc.encode(e));
    },
    /** @param {string[]} events  the last events, then the end of the stream */
    end(...events) {
      if (ended || cancelled) return;
      for (const e of events) ctrl?.enqueue(enc.encode(e));
      ended = true;
      ctrl?.close();
    },
    get cancelled() {
      return cancelled;
    },
  };
}

/**
 * The upstream replies a test holds back or feeds by hand, let go together: `letGo()` releases every held reply and
 * ends every fed stream still open. Run it after each test, pass or fail, so a failed check never leaves a request
 * hanging on the upstream — nor the app's shutdown waiting for it.
 */
export function upstreamControls() {
  /** @type {(() => void)[]} */
  const loose = [];
  return {
    /** @param {any | ((call: any) => any)} reply */
    hold(reply) {
      const h = heldReply(reply);
      loose.push(h.release);
      return h;
    },
    /** @param {string[]} [first] */
    feed(first) {
      const s = fedStream(first);
      loose.push(() => s.end());
      return s;
    },
    letGo() {
      for (const f of loose.splice(0)) f();
    },
  };
}

/**
 * Read an SSE response in the background. `events` fills as events arrive — `{ event, data }`, the data parsed as
 * JSON when it is JSON — `done` settles when the stream ends and `ended` says whether it has; `stop()` hangs up. Wait
 * on `events` and `ended` with `until`: a stream that never ends then fails at the deadline instead of hanging.
 * @param {Response} res
 */
export function readEvents(res) {
  const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
  const dec = new TextDecoder();
  /** @type {{ event: string, data: any }[]} */
  const events = [];
  let buf = "";
  const take = () => {
    let at;
    while ((at = buf.indexOf("\n\n")) >= 0) {
      const part = buf.slice(0, at);
      buf = buf.slice(at + 2);
      const ev = /^event: (.+)$/m.exec(part);
      const d = /^data: (.+)$/m.exec(part);
      if (!d) continue;
      let data = d[1];
      try {
        data = JSON.parse(d[1]);
      } catch {}
      events.push({ event: ev ? ev[1] : "message", data });
    }
  };
  let ended = false;
  const done = (async () => {
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        take();
      }
    } catch {
      // a hang-up (stop()) ends the read; what arrived stays in `events`
    } finally {
      ended = true;
    }
  })();
  return {
    events,
    done,
    get ended() {
      return ended;
    },
    async stop() {
      try {
        await reader.cancel();
      } catch {}
      await done;
    },
  };
}
