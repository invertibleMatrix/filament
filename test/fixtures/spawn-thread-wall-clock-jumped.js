// @ts-check
// A spawn thread whose wall clock is an hour ahead of the pool's, as one after a jump of the system's time: the real
// thread (`src/adapters/git/spawn-thread.js`) runs each call as it would.
const wall = Date.now;
Date.now = () => wall() + 3_600_000;
await import("../../src/adapters/git/spawn-thread.js");
