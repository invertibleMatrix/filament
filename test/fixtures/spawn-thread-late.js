// @ts-check
// A spawn thread that gets to every call an hour late, by the process's monotonic clock: the real thread
// (`src/adapters/git/spawn-thread.js`) runs each call as it would, its clock read an hour ahead.
const monotonic = process.hrtime.bigint;
process.hrtime.bigint = () => monotonic() + 3_600_000_000_000n;
await import("../../src/adapters/git/spawn-thread.js");
