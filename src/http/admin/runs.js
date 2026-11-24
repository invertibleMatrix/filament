// @ts-check
// The admin API's runs area: the run log read back — the list, one run's meta, and its events as JSON or as a live
// SSE stream that replays from `since` and then follows. The viewer's whole backend is these rows.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sendJson } from "../../app/pipeline/respond.js";
import { drainedOrGone, writeSse } from "../events.js";
import { guard } from "./guard.js";
import { WALK_VERSION, inPlaces, onlyGone, ownChangesOf, roundFilesOf, totalsOf, walkOf } from "../../adapters/git/changes.js";
import { placeOf } from "../../adapters/git/snapshot.js";
import { folderThere } from "../../adapters/git/folder-there.js";
import { eventJson, followRunEvents, typedByDeveloper } from "../../services/runs.js";
import { wordsFrames } from "../../services/live-words.js";
import { tabOf, takeOf } from "../../services/session-writers.js";
import { useLine } from "../../core/messages.js";
import { cancelComeBack } from "../../adapters/tools/hands.js";
import { keptAnswers } from "../../core/kept-answers.js";

const HEARTBEAT_MS = 15_000;
const PAGE = 5000;
/**
 * The runs whose changes answers are kept, the answers kept under each (an edit card asks its own file's), and the rows
 * they hold in all (`rowsOf`): a run's whole can be tens of megabytes — one turn's was 77,842 rows, 22.8 MB —, and 64
 * such held the server's heap; Find asks the whole of every files card it holds, most of them a few rows. Two of the
 * largest and a chat's small ones, the runs asked longest ago going first past them.
 */
export const RUN_CHANGES_KEPT = { most: 64, perKey: 200, budget: 200_000 };

/**
 * The rows a run's changes answer holds: its whole's files, those changed while its commands ran and those outside any
 * repository, and each round's files. @param {any} answer
 */
export function rowsOf(answer) {
  const w = answer?.whole;
  const rounds = Array.isArray(answer?.rounds) ? answer.rounds : [];
  return (w?.files?.length || 0) + (w?.during?.length || 0) + (w?.outside?.length || 0) + rounds.reduce((n, /** @type {any} */ x) => n + (x?.files?.length || 0), 0);
}
/** The runs whose files cards' first rows are kept, and the cuts under each; a cut of more rows is cut at each ask. */
export const RUN_FIRST_KEPT = { most: 64, perKey: 8 };
export const RUN_FIRST_MOST = 1000;

/**
 * A run's writing rounds as recorded, every field of each, in one digest: what its changes rest on past the process,
 * where a count and the last commit would not tell two runs' rounds apart.
 * @param {import("../../core/types.js").RoundChange[]} rows
 */
function rowsDigest(rows) {
  const digest = createHash("sha1");
  for (const x of rows) digest.update(`${JSON.stringify([x.place, x.round, x.agent, x.before, x.after, x.base, x.command, x.own])}\n`);
  return digest.digest("hex");
}

/** How many rows each list of a kept whole holds in all, as the files card counts them: read once a whole. @type {WeakMap<object, { files: number, during: number, outside: number }>} */
const wholeCounts = new WeakMap();
/**
 * A run's changes answer with each list of its whole held to its first `n` rows, and how many each holds in all
 * (`counts`: the files, the files changed while its commands ran by place, the files outside any repository by path —
 * what the files card counts of them). The files card draws a turn's first rows and counts the rest: one turn's answer
 * was 22.8 MB, 77,842 rows (the owner's of 11-17). A new object: the answer kept serves every other ask as it is.
 * @param {any} answer @param {number} n
 */
export function firstOf(answer, n) {
  const w = answer.whole;
  const files = w.files || [];
  const during = w.during || [];
  const outside = w.outside || [];
  let counts = wholeCounts.get(w);
  if (!counts) {
    counts = { files: files.length, during: new Set(during.map((/** @type {any} */ d) => `${d.place}\n${d.path}`)).size, outside: new Set(outside.map((/** @type {any} */ o) => String(o.path))).size };
    wholeCounts.set(w, counts);
  }
  return { ...answer, whole: { ...w, files: files.slice(0, n), during: during.slice(0, n), outside: outside.slice(0, n), counts } };
}

/**
 * @param {any} a  the admin context (`runs` is the run log, `sseClients` the set shutdown ends)
 * @returns {import("../router.js").RouteRow[]}
 */
export function runRoutes(a) {
  const { runs, sseClients, sessionWriters = null, liveWords = null, bridge = null, config = null, subagents = null, memory = null, besides = null, sessions = null, letters = null } = a;
  /**
   * The developer's waiting message changed or taken back (HarnessV4_Tasks C34). @param {any} r @param {boolean} edit
   */
  const waitingSteer = async (r, edit) => {
    const id = decodeURIComponent(r.params.id);
    const chain = runs.getRun(id)?.meta?.chain;
    const why = chain ? sessionWriters?.refusal(String(chain), tabOf(r.req), { take: takeOf(r.req) }) || null : null;
    if (why) return sendJson(r.res, 409, { error: why, readOnly: true });
    const sid = decodeURIComponent(r.params.sid);
    const out = edit ? runs.editSteer(id, sid, { text: String((await r.json())?.text ?? "") }) : runs.dropSteer(id, sid);
    if (out.ok) return sendJson(r.res, 200, { ok: true, ...(out.message ? { message: out.message } : {}) });
    return sendJson(r.res, out.gone ? 409 : 400, { error: out.error });
  };
  /**
   * Each run's changes answers, kept while what they rest on holds — its writing rounds as recorded, the places gone,
   * the places only its chat works in: a snapshot is a commit, so the same rounds read the same (the 10-29 speed pass:
   * each files card and the header read their run's turn with git at every ask).
   */
  const changeAnswers = keptAnswers({ ...RUN_CHANGES_KEPT, weigh: rowsOf });
  /** The files cards' first rows, by run: never in the store of wholes. */
  const changeFirsts = keptAnswers(RUN_FIRST_KEPT);
  /** The files cards' first rows past a restart (`changesKept`), where their walk was slow. */
  const disk = a.changesKept?.runs ?? null;
  return [
    // A picture a call handed its model, as the run log kept it (HarnessV4_Tasks U9): named by its content, so it never
    // changes and may be cached. Only the four raster types are ever kept, never an SVG, and nosniff holds the browser
    // to the type said. One past the retention or the cap is no longer kept, and says so.
    [
      "GET",
      "/runs/images/:ref",
      (r) => {
        let ref = "";
        try {
          ref = decodeURIComponent(r.params.ref);
        } catch {}
        const file = runs.imageFile?.(ref) || null;
        const type = file ? runs.imageType?.(ref) : null;
        /** @type {Buffer | null} */
        let bytes = null;
        try {
          bytes = file && type ? readFileSync(file) : null;
        } catch {}
        if (!bytes || !type) return sendJson(r.res, 404, { error: "this picture is no longer kept" });
        r.res.writeHead(200, { "content-type": type, "content-length": bytes.length, "cache-control": "private, max-age=604800, immutable", "x-content-type-options": "nosniff" });
        r.res.end(bytes);
      },
    ],
    [
      "GET",
      "/runs",
      (r) => {
        const q = r.url.searchParams;
        return sendJson(r.res, 200, {
          runs: runs.listRuns({
            limit: Math.min(500, Math.max(1, Number(q.get("limit")) || 50)),
            kind: (q.get("kind") || "").trim() || null,
          }),
        });
      },
    ],
    [
      "GET",
      "/runs/:id",
      guard((r) => {
        const run = runs.getRun(decodeURIComponent(r.params.id));
        return run ? sendJson(r.res, 200, { run }) : sendJson(r.res, 404, { error: "no such run" });
      }),
    ],
    // What an agent turn's hands changed (HarnessV4_Git_Plan step 1), read back from the rounds its `snapshot` events
    // record — one per agent and place: each agent's own files, read-only git in each place. `rounds`: each round's
    // own files, an edit card's read; `whole`: the run as one change, each own file once with its net counts, what
    // changed while its commands ran (its own, marked, in a place only its chat works in: GW-D57), and the files
    // written outside any repository; `folder`, the place of the run's
    // folder, so a page tells its files from another place's. `?patch=1` adds each file's diff, clipped; `?path=`
    // narrows to one file as a call named it (relative to the run's folder, or absolute) — or, with `?place=`, as git
    // names it there; `?round=` reads that round alone, and no `whole` (HarnessV4_Tasks U3, V4-D215); `?first=N` holds
    // the whole's lists to their first N rows and says how many each holds (`firstOf`, the files card's read). The rounds are
    // read where a round or a file is asked for, or `?rounds=1`; else `rounds` is null — the files card and the header
    // read `whole` alone, and each round was a git read of its own (the 10-29 speed pass). An answer is kept while the
    // run's rounds, the places gone and the places only its chat works in stay as they were (`changeAnswers`, bounded by
    // the rows it holds); one round's, while its own rows and the places gone do, however many rounds land after it. A run,
    // or a round, that recorded none answers an empty list with the reason, never an invented diff.
    [
      "GET",
      "/runs/:id/changes",
      guard(async (r) => {
        const id = decodeURIComponent(r.params.id);
        // Its snapshots alone: the run's other events — a heavy turn's are tens of megabytes — are not read for a card.
        const page = runs.events(id, { since: 0, limit: 50000, types: ["snapshot"] });
        if (!page) return sendJson(r.res, 404, { error: "no such run" });
        const q = r.url.searchParams;
        /** @type {import("../../core/types.js").RoundChange[]} */
        const rows = page.events
          .filter((e) => e.type === "snapshot" && typeof e.place === "string")
          .map((e) => ({ place: String(e.place), round: Number(e.round) || 0, agent: String(e.agent || ""), before: e.before || null, after: e.after || null, base: e.base, own: Array.isArray(e.own) ? e.own.map(String) : [], command: !!e.command }));
        const root = page.run?.meta?.root ? String(page.run.meta.root) : null;
        const none = (/** @type {string} */ note) => sendJson(r.res, 200, { runId: id, root, rounds: [], totals: { files: 0, added: 0, removed: 0 }, whole: null, note });
        if (!rows.length) return none(page.gap ? "the run's early events are no longer available, so its rounds cannot be listed" : "this run recorded no change of its own (no writing round, or agentLoop.treeSnapshots off)");
        const round = Number(q.get("round"));
        const one = Number.isInteger(round) && round > 0;
        const picked = one ? rows.filter((x) => x.round === round) : rows;
        if (!picked.length) return none(`round ${round} recorded no change`);
        const named = q.get("path");
        const inPlace = q.get("place");
        const places = [...new Set(rows.map((x) => x.place).filter(Boolean))];
        const where = !named ? null : inPlace ? { place: inPlace, path: named } : inPlaces(places, root, named);
        if (named && !where) return none("the file is in no repository this run wrote in, so it has no diff");
        const patch = q.get("patch") === "1";
        const withRounds = one || !!named || q.get("rounds") === "1";
        // The places only the run's chat works in, where what its commands changed is its own (GW-D57).
        const chain = page.run?.meta?.chain;
        const alone = !one && chain && memory?.placesAlone ? memory.placesAlone(String(chain), rows.map((x) => x.place)) : null;
        // Each place looked at off the server's thread, a moment at most: one on a share that does not answer is in the
        // basis apart, so an answer read while it did not is not served once it does.
        const there = await Promise.all(places.map((p) => folderThere(p)));
        const goneList = places.filter((_, i) => there[i] === false);
        const gone = [goneList.join("|"), ...places.filter((_, i) => there[i] === null).map((p) => `?${p}`)].join("|");
        // One round's answer — an edit card's — rests on that round's own rows: a snapshot is a commit, so the rounds
        // that land after it leave it as it was, and it is kept apart from the run's whole change, which follows them
        // (the slowness of 11-02: each round that landed threw every card's answer away, each asked of git again).
        const ownRows = one ? picked.map((x) => [x.place, x.agent, x.before, x.after, x.base, x.own.join("\0"), x.command].join("\0")).join("\n") : "";
        const key = one ? `${id}\nround` : id;
        const basis = one ? gone : [rows.length, rows.at(-1)?.after || "", gone, [...(alone || [])].sort().join("|")].join("\n");
        const query = [one ? round : "", where ? `${where.place}\n${where.path}` : "", patch, withRounds, ownRows].join("\n");
        const walk = async () => {
          /** @type {any[] | null} */
          let rounds = null;
          if (withRounds) {
            rounds = [];
            for (const x of picked) {
              if (!x.place || (where && x.place !== where.place)) continue;
              const read = await roundFilesOf(x, { patch, path: where?.path ?? null });
              rounds.push({ round: x.round, place: x.place, agent: x.agent, base: x.base, files: read.files, totals: totalsOf(read.files), ...(read.error ? { error: read.error } : {}) });
            }
          }
          const whole = one ? null : await ownChangesOf(rows, { patch, path: where?.path ?? null, place: where?.place ?? null, alone });
          const folder = root ? (await placeOf(root)).place : null;
          return { runId: id, root, folder, rounds, totals: whole ? whole.totals : totalsOf((rounds || []).flatMap((x) => x.files)), whole };
        };
        // An answer that says git could not read a round, or a place, is not kept: a round's would stand for the whole
        // run (the review of 11-02), where a timeout under load is gone at the next ask. One that says a place's folder
        // is gone is, where the basis found it gone too (`onlyGone`).
        const keep = (/** @type {any} */ said) => onlyGone((said.rounds || []).filter((/** @type {any} */ x) => x.error), goneList) && onlyGone(said.whole?.errors || [], goneList);
        const first = Number(q.get("first"));
        // The files card's first rows, kept apart from the whole they are cut from (`changeFirsts`) and past a restart
        // on disk where the walk was slow: read there before any walk, the run's folder read anew.
        if (Number.isInteger(first) && first > 0 && first <= RUN_FIRST_MOST && !one && !patch && !withRounds) {
          const out = await changeFirsts.get(id, basis, String(first), async () => {
            const onDisk = [rowsDigest(rows), gone, [...(alone || [])].sort().join("|"), a.VERSION ?? "", WALK_VERSION].join("\n");
            const had = disk ? await disk.get(id, id, onDisk, String(first)) : null;
            if (Array.isArray(had?.whole?.files) && Array.isArray(had?.whole?.errors)) return { ...had, folder: root ? (await placeOf(root)).place : null };
            const answer = await changeAnswers.get(key, basis, query, walk, keep);
            const rowsFirst = firstOf(answer, first);
            if (disk && keep(answer) && disk.worth(walkOf(answer.whole))) void disk.put(id, id, onDisk, String(first), rowsFirst);
            return rowsFirst;
          }, keep);
          return sendJson(r.res, 200, out);
        }
        const answer = await changeAnswers.get(key, basis, query, walk, keep);
        // `?first=N`: the whole's lists held to their first N rows, sliced from the answer kept whole — one git read
        // serves both asks (`firstOf`).
        return sendJson(r.res, 200, Number.isInteger(first) && first > 0 && answer.whole ? firstOf(answer, first) : answer);
      }),
    ],
    // The commands a coding agent published in the session its run ran in (HarnessV3-ACP AC1-6): the composer offers
    // them as the agent's own. A run that is no agent's, or an agent that published none, answers an empty list.
    [
      "GET",
      "/runs/:id/agent-commands",
      (r) => {
        const run = runs.getRun(decodeURIComponent(r.params.id));
        if (!run) return sendJson(r.res, 404, { error: "no such run" });
        const m = run.meta || {};
        const agent = run.kind === "coding-agent" && m.engine === "acp" ? String(m.upstream || "") : "";
        const up = agent ? (config?.get().upstreams || []).find((/** @type {any} */ u) => u.id === agent) : null;
        return sendJson(r.res, 200, {
          runId: run.id,
          agent: up ? String(up.name || up.id).replace(" (agent via ACP)", "") : agent || null,
          commands: agent && bridge ? bridge.commandsOf(agent, String(m.session || "")) : [],
        });
      },
    ],
    // The mailbox's write side (plan §4.6): the chat input and the veto button both land here. `kind` is note (advisory,
    // read at the loop's next decision point), veto (refuse what the loop just proposed, with the text as the reason)
    // or stop (end the turn at the next decision point). `images` ([{ name, mediaType, data }]): the pictures a note or
    // a veto carries into a run that reads them (its meta says `steerImages`), refused in words elsewhere, so the
    // sender keeps them for the next message. `overrules` ([{ agentId, exchange, name?, question? }]) on a note: the
    // saved agents' answers its words overrule. `along` ([tag]) on a note: the saved agents its words name past their
    // start — Filament asks each of them the note, and the running turn waits for their answers. `interrupt: true` on a coding agent's note interrupts its
    // agent instead of waiting for its next step, where its run says it can (HarnessV3-FailurePoints FP-D8). `via`
    // ({ row, by }): the row of the page's menu it went by, and whether by a key, a click or no press (`auto`, a note
    // sent again) (the owner's of 11-09) — kept on its steer event. 409 when nothing is running under that id: a message that looked accepted and was never
    // heard is the failure mode this refuses.
    [
      "POST",
      "/runs/:id/steer",
      guard(async (r) => {
        const b = await r.json();
        const id = decodeURIComponent(r.params.id);
        // The person's Stop on a chat's own turn (not a sub-agent's run) is their Stop of the chat, as the session's
        // stop route takes it: Filament starts no turn of its own there until a newer one begins (FO-D50), and the
        // come-back its agent set is dropped (the Hunter's find of 10-27: the page's Stop steers the run, and neither
        // happened). A client's chat is its client's: the stop of a run Filament runs for its request (a coding agent's)
        // ends that run and marks nothing of the chat, as the session's Stop leaves it be.
        if (b?.kind === "stop") {
          const meta = runs.getRun(id)?.meta;
          const chat = meta?.chain && !meta.subagent ? String(meta.chain) : "";
          if (chat && memory?.archive?.chainHead?.(chat)?.native) {
            memory?.markLastStop?.(chat);
            cancelComeBack(chat);
            sessions?.idleStop?.(chat);
          }
        }
        // `force: true` on a stop is the Force stop (F2 item 13): the turn ends now, not at the loop's next step.
        if (b?.kind === "stop" && b?.force === true) {
          const forced = runs.force(id, { from: b?.from });
          if (forced.ok) return sendJson(r.res, 200, { ok: true, forced: true, queued: forced.queued });
          return sendJson(r.res, /no loop is running|has ended/.test(forced.error) ? 409 : 400, { error: forced.error });
        }
        // A note, a veto or a compaction steers the session's turn: a harness tab that follows the session, read-only,
        // is refused in words (decision 22). A stop is open to every tab.
        if (b?.kind !== "stop") {
          const chain = runs.getRun(id)?.meta?.chain;
          const why = chain ? sessionWriters?.refusal(String(chain), tabOf(r.req), { take: takeOf(r.req) }) || null : null;
          if (why) return sendJson(r.res, 409, { error: why, readOnly: true });
        }
        // A note that overrules what saved agents answered the agent (`overrules`, HarnessV4_Tasks E15 step 3): Filament
        // says whose answers; the turn reads that where it reads the note, at its next step. The note's own record
        // names the answers the registry found, so its bubble says whose after a reload.
        const chainOf = b?.kind === "note" && Array.isArray(b?.overrules) && b.overrules.length ? runs.getRun(id)?.meta?.chain : null;
        const whose = (chainOf ? subagents?.overruleFrames?.(String(chainOf), b.overrules) || [] : []).map((/** @type {any} */ d) => ({ agentId: d.from, exchange: Number(d.exchange) || 0, name: d.description }));
        // A note that names agents or teams with an `@` past its start (HarnessV4_OneAgent_Plan OA2 case 6): nothing
        // starts — the running turn reads the line beside the note, telling it to use them, and they join whom the turn
        // named, for its end to say which went unused. A team's own chat starts no teams.
        const chat = b?.kind === "note" ? String(runs.getRun(id)?.meta?.chain || "") : "";
        const teamChat = !!chat && memory?.archive?.getChain?.(chat)?.kind === "team";
        const uses = chat ? [...(subagents?.usesOf?.(b?.use) || []), ...(teamChat ? [] : besides?.usesOf(b?.useTeams) || [])] : [];
        // One that overrules answers or names agents to use speaks to the agent's work: it goes straight in, unweighed.
        // `weigh`: the person asked that a fork weigh it first (the ⌄ menu's Weigh aside first, `/steer-fork`).
        const straight = whose.length ? "it overrules what agents answered, which speaks to the agent's work" : uses.length ? "it names agents for the agent to use" : "";
        const out = runs.steer(id, { kind: b?.kind, text: b?.text, from: b?.from, interrupt: b?.interrupt === true, images: b?.images, overrules: whose, weigh: b?.weigh === true, straight, via: b?.via });
        const overruled = out.ok && whose.length ? subagents?.overrule?.(String(chainOf), b.overrules, String(b?.text || "")) || 0 : 0;
        // The developer's note is their next message: the reports they sent "with my next message" go into the turn
        // with it (`carried` says how many).
        const noted = out.ok ? chat : "";
        const use = noted ? uses : [];
        if (use.length) {
          subagents?.notice?.(noted, { text: useLine(use, { note: true }), description: use.map((n) => n.name).join(", ") });
          sessions?.useInTurn?.(noted, use);
        }
        // A note is the developer's words too: the saved agents and teams it names join their message's, and the chats
        // it tags are its agent's to write letters to (app/letters.js) — where they typed it: the chat's counts for each
        // message of theirs (its letters, its threads, the guidance sent to it) start again with their words alone,
        // never with a note Filament, a lead, an agent or a watcher relays.
        if (noted) {
          subagents?.heard?.(noted, String(b?.text || ""), { add: true });
          if (!teamChat) besides?.heard(noted, String(b?.text || ""), { add: true });
          if (typedByDeveloper({ from: b?.from })) letters?.heard(noted, String(b?.text || ""));
        }
        // …and one the person typed — not words Filament, a lead or an agent relays — is their word in the chat, as their
        // message is (service.js `personWrote`, FabeleHelper's of 11-10): kept as when they last wrote, which a graph's
        // all-done reads for what they asked since it began, and a start's sweep for whether they left the chat; and into
        // a driving goal's round it halts the drive (core/goal-drive.js; the owner's of 11-10: the drive halts when the
        // person types): the round goes on with the note, and no other starts by itself until /goal go. A note to a
        // sub-agent's run is theirs to it, not to the chat's agent. Another machine's agents steer no run here.
        if (noted && !runs.getRun(id)?.meta?.subagent && typedByDeveloper({ from: b?.from })) {
          sessions?.holdGoal?.(noted, "typed");
          sessions?.personNoted?.(noted);
        }
        const carried = noted ? subagents?.release?.(noted) || 0 : 0;
        if (out.ok) return sendJson(r.res, 200, { ok: true, message: out.message, queued: out.queued, ...(overruled ? { overruled } : {}), ...(carried ? { carried } : {}), ...(use.length ? { use: use.map((n) => n.name) } : {}) });
        const status = /no loop is running|has ended/.test(out.error) ? 409 : 400;
        return sendJson(r.res, status, { error: out.error });
      }),
    ],
    // The developer's message changed (`{ text }`) or taken back while it still waits (HarnessV4_Tasks C34): the loop
    // has not read it, or a coding agent's turn has not handed it to its agent, which happens at the agent's next tool
    // call. 409 when it no longer waits — it was read, or handed over, or the run ended — and its bubble says where it
    // is; a harness tab that follows the session, read-only, is refused in words.
    ["PATCH", "/runs/:id/steer/:sid", guard((r) => waitingSteer(r, true))],
    ["DELETE", "/runs/:id/steer/:sid", guard((r) => waitingSteer(r, false))],
    // A coding agent's question answered (HarnessV3-ACP AC2-4): `{ ask, outcome, answers?, reason? }`, checked against
    // the question the run waits on — `switched` for a permission the session's switch asks about, once the switch
    // moved (AC3-2). 409 when the run, or the question, no longer waits; 400 for an answer that doesn't fit it. A
    // harness tab that follows the session, read-only, is refused in words, as its note would be.
    [
      "POST",
      "/runs/:id/answer",
      guard(async (r) => {
        const b = await r.json();
        const id = decodeURIComponent(r.params.id);
        const chain = runs.getRun(id)?.meta?.chain;
        const why = chain ? sessionWriters?.refusal(String(chain), tabOf(r.req), { take: takeOf(r.req) }) || null : null;
        if (why) return sendJson(r.res, 409, { error: why, readOnly: true });
        const out = runs.answer(id, String(b?.ask || ""), { outcome: b?.outcome, answers: b?.answers, reason: b?.reason });
        if (out.ok) return sendJson(r.res, 200, { ok: true });
        return sendJson(r.res, out.gone ? 409 : 400, { error: out.error });
      }),
    ],
    // A command the run's loop runs in the foreground, sent to the background (HarnessV4_Four_Plan E21): the call
    // answers now and the command goes on as a background shell, named in the answer. 409 when the run, or the
    // command, no longer runs; a harness tab that follows the session, read-only, is refused in words.
    [
      "POST",
      "/runs/:id/calls/:call/background",
      guard((r) => {
        const id = decodeURIComponent(r.params.id);
        const chain = runs.getRun(id)?.meta?.chain;
        const why = chain ? sessionWriters?.refusal(String(chain), tabOf(r.req), { take: takeOf(r.req) }) || null : null;
        if (why) return sendJson(r.res, 409, { error: why, readOnly: true });
        const out = runs.background(id, decodeURIComponent(r.params.call));
        if (out.ok) return sendJson(r.res, 200, { ok: true, shell: out.shell });
        return sendJson(r.res, 409, { error: out.error });
      }),
    ],
    // `?since=N` replays the events after number N. As JSON it is one page; as a stream (`Accept: text/event-stream`
    // or `?stream=1`) it replays and then follows live, with the event number as the SSE id so a client that
    // reconnects can resume from where it stopped. A gap the log cannot fill is said in the first message. With
    // `words=1` the stream carries the running turn's words beside the events (HarnessV3-Launch LD-D16): `words` frames
    // with no id, the blocks so far and then each piece, so a reconnect gets the blocks so far again. The harness's
    // own pages follow their runs on one WebSocket instead (http/admin/run-socket.js), which sends the same frames.
    [
      "GET",
      "/runs/:id/events",
      guard(async (r) => {
        const { req, res, url } = r;
        const id = decodeURIComponent(r.params.id);
        const q = url.searchParams;
        const since = Math.max(0, Number(q.get("since")) || 0);
        const wantStream =
          q.get("stream") === "1" || String(req.headers.accept || "").includes("text/event-stream");
        // The JSON form honours `limit`, `graphs=last` (an ended run's task graphs but its last without their graph:
        // an ended turn's reader reads its newest alone), `calls=apart` (an ended run's sub-agents' calls left out but
        // those that come whole, each card's count on its first subagent-start: a card reads its own as it opens) and
        // `calls=only` (those calls alone, of one launching call where `round` and `parent` name it); the stream replays
        // everything in fixed pages (a `limit` would truncate history).
        const calls = q.get("calls") === "apart" ? "apart" : q.get("calls") === "only" ? "only" : "all";
        const of = calls === "only" && q.has("parent") ? { round: Number(q.get("round")) || 0, parent: String(q.get("parent")) } : null;
        const page = wantStream ? runs.events(id, { since, limit: PAGE }) : runs.events(id, { since, limit: Number(q.get("limit")) || undefined, graphs: q.get("graphs") === "last" ? "last" : "all", calls, of });
        if (!page) return sendJson(res, 404, { error: "no such run" });
        if (!wantStream) return sendJson(res, 200, page);
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        sseClients.add(res);
        let closed = false;
        /** @type {{ stop: () => void, live: Promise<void> } | null} */
        let follow = null;
        /** @type {NodeJS.Timeout | null} */
        let ping = null;
        /** @type {(() => void) | null} */
        let leaveWords = null;
        const close = () => {
          if (closed) return;
          closed = true;
          if (ping) clearInterval(ping);
          follow?.stop();
          leaveWords?.();
          sseClients.delete(res);
        };
        const end = () => {
          close();
          try {
            res.end();
          } catch {}
        };
        req.on("close", close);
        writeSse(
          sseClients,
          res,
          `data: ${JSON.stringify({ type: "hello", run: page.run, firstAvailable: page.firstAvailable, gap: page.gap })}\n\n`,
        );
        if (q.get("words") === "1" && liveWords) {
          // Every frame is written (queued while the socket drains): the blocks so far, then each piece.
          const frames = wordsFrames({
            blocks: () => liveWords.blocks(id),
            open: () => liveWords.open(id),
            write: (frame) => writeSse(sseClients, res, `data: ${JSON.stringify(frame)}\n\n`),
          });
          frames.start();
          leaveWords = liveWords.follow(id, frames.piece);
        }
        // The replay, then live (`followRunEvents`: paged, waiting for the reader before each replayed write, nothing
        // skipped). A live event is written whatever the reader's pace — what the socket cannot take yet waits in the
        // response's queue — and only a client that stopped reading, its queue past the cap, is cut off (writeSse) and
        // resumes from the last `id:` it got. A run that has ended has nothing more to say: the stream tells the client
        // so and ends, instead of holding a connection open for a heartbeat nobody needs — a browser gets six
        // connections to this host, and a stream held past its run's end kept one per followed turn
        // (HarnessV3-Responsiveness R1). `follow=1` stays open.
        follow = followRunEvents(runs, id, page, {
          since,
          pageSize: PAGE,
          send: (evt) => (closed ? false : writeSse(sseClients, res, `id: ${evt.n}\ndata: ${eventJson(evt)}\n\n`)),
          needsDrain: () => res.writableNeedDrain,
          drained: () => drainedOrGone(res),
          // A gap past the first page is said as the first page's is, in a hello of its own.
          onGap: (gap) => writeSse(sseClients, res, `data: ${JSON.stringify({ type: "hello", gap })}\n\n`),
          keep: !!q.get("follow"),
          onEnded: (status) => {
            writeSse(sseClients, res, `data: ${JSON.stringify({ type: "ended", status })}\n\n`);
            end();
          },
        });
        await follow.live;
        if (closed) return undefined;
        ping = setInterval(() => {
          if (!writeSse(sseClients, res, ": ping\n\n")) close();
        }, HEARTBEAT_MS);
        ping.unref?.();
        return undefined;
      }),
    ],
  ];
}
