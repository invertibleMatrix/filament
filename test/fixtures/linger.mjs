// A process a command starts and leaves running (test/bash-exit-drain.test.js): it holds whatever output pipe it
// inherited and lingers until a flag file appears (or 20 s pass), then exits on its own — leaving `<flag>.exited`
// beside the flag, so the test removes the folder (this process's working directory) only once it has left.
import { existsSync, writeFileSync } from "node:fs";

const flag = process.argv[2];
const t0 = Date.now();
const tick = setInterval(() => {
  if ((flag && existsSync(flag)) || Date.now() - t0 > 20_000) {
    clearInterval(tick);
    try {
      if (flag) writeFileSync(`${flag}.exited`, "");
    } catch {}
    process.exit(0);
  }
}, 100);
