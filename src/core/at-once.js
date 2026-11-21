// @ts-check
// Reads run a few at a time: enough side by side that a long list does not wait on each read in turn, few enough that
// a machine is not handed a process per item at once (each git read is one). The answers come in the items' order.

/** How many reads run at once unless told. */
export const AT_ONCE = 4;

/**
 * Each item read, `atOnce` at a time, the answers in the items' order.
 * @template T, R @param {T[]} items @param {(item: T, index: number) => Promise<R>} read @param {number} [atOnce]
 * @returns {Promise<R[]>}
 */
export async function fewAtOnce(items, read, atOnce = AT_ONCE) {
  /** @type {R[]} */
  const out = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await read(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(atOnce, items.length) }, worker));
  return out;
}
