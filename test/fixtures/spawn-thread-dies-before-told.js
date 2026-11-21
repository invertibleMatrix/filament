// @ts-check
// A spawn thread that stops between a process's start and its word of it: the real thread
// (`src/adapters/git/spawn-thread.js`) makes the call's files and starts its process, and this thread throws as it would
// tell the start — the pool never hears the process's id, nor the files' names from the thread.
import { parentPort } from "node:worker_threads";

const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
const post = port.postMessage.bind(port);
/** @param {any} m @param {any} [handed] */
port.postMessage = (m, handed) => {
  if (m && "started" in m) throw new Error("the thread broke before it told the start");
  post(m, handed);
};
await import("../../src/adapters/git/spawn-thread.js");
