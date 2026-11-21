// @ts-check
// At most `limit` fetches at once, the rest waiting their turn in order (HarnessV3-Responsiveness R4). A browser opens
// six connections to one host, and the harness page already holds some as streams; a 60-turn history that asked for
// every turn's cards and changes at once (up to 120 requests) queued the page's own clicks behind them. Pure: no DOM,
// no fetch of its own — it runs what it is given.

/**
 * @param {number} limit  how many run at once (at least 1)
 * @returns {{ run: <T>(job: () => Promise<T> | T) => Promise<T>, readonly active: number, readonly waiting: number }}
 */
export function createFetchQueue(limit) {
  const max = Math.max(1, Math.floor(Number(limit)) || 1);
  /** @type {(() => void)[]} */
  const queue = [];
  let active = 0;
  const next = () => {
    while (active < max && queue.length) {
      active++;
      /** @type {() => void} */ (queue.shift())();
    }
  };
  return {
    run(job) {
      return new Promise((resolve, reject) => {
        // The slot is free before the caller hears back; a job that throws, or fails, frees it like one that succeeds.
        const done = () => {
          active--;
          next();
        };
        queue.push(() => {
          Promise.resolve()
            .then(job)
            .then(
              (v) => {
                done();
                resolve(v);
              },
              (e) => {
                done();
                reject(e);
              },
            );
        });
        next();
      });
    },
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
  };
}
