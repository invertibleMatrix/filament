// @ts-check
// A spawn thread that stops the moment its first process has started: the real thread
// (`src/adapters/git/spawn-thread.js`) runs the call, and this thread throws, uncaught, before anything else runs on it.
import { parentPort } from "node:worker_threads";
import "../../src/adapters/git/spawn-thread.js";

parentPort?.on("message", (/** @type {any} */ m) => {
  if (m.run) throw new Error("the thread broke at once");
});
