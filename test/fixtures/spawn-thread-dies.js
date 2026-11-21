// @ts-check
// A spawn thread that stops with a process still running: the real thread (`src/adapters/git/spawn-thread.js`) runs
// each call, and a moment after the call that holds has started (the test's git alias `hold`) this thread throws,
// uncaught. Only that call: the next one runs on the thread the pool starts in its place, this fixture again, and is
// never broken, however long its start takes under load.
import { parentPort } from "node:worker_threads";
import "../../src/adapters/git/spawn-thread.js";

parentPort?.on("message", (/** @type {any} */ m) => {
  if (m.run?.args.at(-1) !== "hold") return;
  setTimeout(() => {
    throw new Error("the thread broke");
  }, 500);
});
