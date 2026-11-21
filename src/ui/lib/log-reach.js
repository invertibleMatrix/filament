// @ts-check
// How far back the request log reaches, in the words both faces say (HarnessV4_Settings_Plan HS-4, HC-69): the
// console's Observability tab and the harness's Data and privacy. With whole bodies kept (`shaped`, `full`) it says how
// fast the log rolls: at the pace it filled so far, how long the space it may take holds.

/** A size in KB under a megabyte, else in MB. @param {number} b */
const mb = (b) =>
  Number(b) < 1048576 ? `${Math.max(1, Math.round(Number(b) / 1024))} KB` : `${(Number(b) / 1048576).toFixed(Number(b) < 10485760 ? 1 : 0)} MB`;

/** A span of time in hours or days. @param {number} ms */
export function spanWords(ms) {
  const hours = ms / 3_600_000;
  if (hours < 1) return "under an hour";
  if (hours < 36) return `about ${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `about ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * The reach in a line; `heavy` when each request keeps its whole body, which the line warns about. Null before it is
 * known.
 * @param {{ since: string | number | null, files: number, bytes: number, maxBytes: number } | null | false | undefined} reach
 *   `GET /api/state`'s `logReach`
 * @param {string} storeBodies  `observability.storeBodies`
 * @param {(at: string | number) => string} when  a moment in the face's own words
 * @param {number} [now]
 * @returns {{ text: string, heavy: boolean } | null}
 */
export function reachWords(reach, storeBodies, when, now = Date.now()) {
  if (!reach) return null;
  const heavy = storeBodies === "shaped" || storeBodies === "full";
  if (!reach.since) return { text: "The request log has no records yet.", heavy };
  const text = `The request log reaches back to ${when(reach.since)}: ${reach.files} file${reach.files === 1 ? "" : "s"}, ${mb(reach.bytes)} of at most ${mb(reach.maxBytes)}.`;
  if (!heavy) return { text, heavy };
  const span = Math.max(0, now - new Date(reach.since).getTime());
  const full = reach.bytes >= reach.maxBytes * 0.95;
  const holds = full || !(reach.bytes > 0) ? span : span * (reach.maxBytes / reach.bytes);
  return {
    text: `${text} Each request keeps its whole body (${storeBodies}), so the oldest records roll off fast: at this pace the log holds ${spanWords(holds)}. Summary keeps far more in the same space.`,
    heavy,
  };
}
