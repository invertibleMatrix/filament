// @ts-check
// The harness page reads a session with each turn's work held back (`GET /api/sessions/:id/transcript?work=held`) and
// a turn's work apart, a stretch at a time (`GET /api/sessions/:id/turns/:n/work`). A test that holds a transcript with
// its work whole — one it wrote by hand, or the archive's own bodies — reads it the page's way through here: the held
// transcript as the server cuts it, then every turn's work taken as the server's one stretch of it. A test with a
// running Filament reads the two routes themselves (`pageTurns`).
import { transcriptTurns, takeWork } from "../../src/ui/harness/conversation/history.js";
import { saidOf, tallyOfWork, workSteps } from "../../src/core/tool-vocab.js";

/**
 * A whole-work transcript as `?work=held` answers it: each turn says how much work it has and how it counts, a turn
 * that resumes gives the reply that asked apart (`opens`), and no work rides along.
 * @param {{ turns?: any[] } & Record<string, any>} transcript
 * @param {{ counted?: boolean }} [o]  `counted: false`: turns the archive never counted (no `tally`)
 */
export function heldTranscript(transcript, { counted = true } = {}) {
  return {
    ...transcript,
    turns: (transcript.turns || []).map(({ work = [], tools: _tools, ...t }) => ({
      ...t,
      workCount: work.length,
      ...(counted ? { tally: tallyOfWork(work) } : {}),
      ...(t.resumes && work.length ? { opens: saidOf(work[0]) } : {}),
    })),
  };
}

/**
 * The page's turns of a whole-work transcript, every turn's work read: `transcriptTurns` of the held transcript, then
 * each turn's work as one stretch of the work route's answer.
 * @param {{ turns?: any[] } & Record<string, any>} transcript
 * @param {"anthropic" | "openai"} [format]  the wire format the work is in
 * @param {{ counted?: boolean }} [o]
 * @returns {any[]}
 */
export function turnsRead(transcript, format = "anthropic", o = {}) {
  const turns = transcriptTurns(heldTranscript(transcript, o));
  (transcript.turns || []).forEach((t, i) => {
    const work = t.work || [];
    if (work.length) takeWork(turns[i], { n: t.n, from: 0, total: work.length, next: null, work: workSteps(work, format) });
  });
  return turns;
}

/**
 * A running Filament's session as the page reads it, over its API: the transcript with the work held back, then each
 * turn's work, stretch after stretch, to its end.
 * @param {(path: string) => Promise<Response>} api  a GET of Filament by path @param {string} id  the session's
 * @returns {Promise<any[]>}
 */
export async function pageTurns(api, id) {
  const sid = encodeURIComponent(id);
  const turns = transcriptTurns(await (await api(`/api/sessions/${sid}/transcript?work=held`)).json());
  for (const turn of turns)
    while (turn.held && turn.held.next != null) {
      const res = await api(`/api/sessions/${sid}/turns/${turn.n}/work?from=${turn.held.next}`);
      const page = await res.json();
      if (!takeWork(turn, page)) throw new Error(`turn ${turn.n}: its work from ${turn.held.next} was not read (${res.status} ${JSON.stringify(page).slice(0, 200)})`);
    }
  return turns;
}

/** A read turn's tool cards in the order its work made them: what its boxes hold. @param {any} turn @returns {any[]} */
export function cardsOf(turn) {
  return (turn?.held?.parts || []).flatMap((/** @type {any} */ p) => p.tools || []);
}
