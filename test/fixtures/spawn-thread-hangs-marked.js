// @ts-check
// A spawn thread held after it starts a call marked `-c filament.hang=1`, as one an antivirus holds in CreateProcess
// would: the real thread (`src/adapters/git/spawn-thread.js`) runs each call, and once the marked call's process has
// started and its id gone out, this thread is held for `HANG_MS`, its timers and every call queued behind it waiting.
// Calls without the mark — on this thread, or on another made from this file — run as they would.
import { parentPort } from "node:worker_threads";

export const HANG_MS = 8000;
const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
const post = port.postMessage.bind(port);
/** @param {any} m @param {any} [handed] */
port.postMessage = (m, handed) => {
  post(m, handed);
  if (m && "started" in m && m.args.includes("filament.hang=1"))
    setImmediate(() => {
      const until = Date.now() + HANG_MS;
      while (Date.now() < until);
    });
};
await import("../../src/adapters/git/spawn-thread.js");
