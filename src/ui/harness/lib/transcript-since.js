// @ts-check
// A chat's transcript read as the turns written since the page's last read (the slowness of 11-02): a long chat's whole
// read is megabytes — 2.85 MB on the owner's — and the page reads its chat at each turn's end, while the server opens
// every turn's message and answer and every other request waits. The transcript route names the version of the turns
// each answer was read at (app/sessions/service.js `transcript`); a read that names the version the chat holds is sent
// the turns begun or changed since, with every turn's id in order, and the answer is put together here whole: the same
// answer a whole read gives at that version, which the page draws as it draws one.

/**
 * What a chat holds of its last read drawn (app.js `hydrate`): its session, the version of its turns, and its turns as
 * the server sent them, by id — kept as sent: the page's turns are made from them anew at each read (`transcriptTurns`).
 * @typedef {{ chainId: string, version: string, byId: Map<number, any> }} ServedTurns
 */

/**
 * What a read of the chat's transcript asks besides its work: the turns written since the version held, where the chat
 * holds one of this session's; else nothing, and the transcript comes whole.
 * @param {ServedTurns | null | undefined} held @param {string} chainId @returns {string}
 */
export const writtenSince = (held, chainId) => (held && held.chainId === String(chainId) ? `&written=${encodeURIComponent(held.version)}` : "");

/**
 * A transcript answer whole, and what the chat holds of it from then on. A whole answer is as it came. One of the turns
 * written since `held` — the turns the chat holds, a version each of them stands at — has them put in among the held
 * ones by its `ids`, oldest first: a turn it sent is the one it sent, any other is the held one, with whether its run
 * is there now as the answer's `runs` says it (a run file the retention sweep removed takes the turn's run away), and a
 * turn its ids do not name has gone. Null where it cannot be put together — it moved from another version than `held`,
 * or names a turn neither it nor `held` carries, or says no turn's run —: the chat is read again then.
 * @param {any} tr  the transcript route's answer @param {ServedTurns | null | undefined} held @param {string} chainId
 * @returns {{ tr: any, served: ServedTurns | null } | null}
 */
export function transcriptWhole(tr, held, chainId) {
  const sent = Array.isArray(tr?.turns) ? tr.turns : [];
  /** @param {any[]} turns */
  const keep = (turns) => (typeof tr?.version === "string" && tr.version ? { chainId: String(chainId), version: tr.version, byId: new Map(turns.map((t) => [Number(t.turnId), t])) } : null);
  if (tr?.written == null) return { tr, served: keep(sent) };
  if (!held || held.chainId !== String(chainId) || tr.written !== held.version || !Array.isArray(tr.ids) || !Array.isArray(tr.runs)) return null;
  const moved = new Map(sent.map((/** @type {any} */ t) => [Number(t.turnId), t]));
  const ran = new Set(tr.runs.map(Number));
  /** A held turn, its run as the answer says it. @param {any} t */
  const withRun = (t) => (!t || !!t.run === ran.has(Number(t.turnId)) ? t : { ...t, run: ran.has(Number(t.turnId)) });
  const turns = tr.ids.map((/** @type {unknown} */ id) => moved.get(Number(id)) || withRun(held.byId.get(Number(id))));
  if (!turns.every(Boolean)) return null;
  const { written: _written, ids: _ids, runs: _runs, ...rest } = tr;
  return { tr: { ...rest, turns }, served: keep(turns) };
}
