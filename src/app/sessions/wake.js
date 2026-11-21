// @ts-check
// A chat goes on by itself when a background command ends (HarnessV4_Four_Plan E21, FO-D14, FO-D49): one the agent
// started with bash_background, or one the developer sent to the background — and when another agent's report comes for
// its agent while no turn runs (the owner's of 10-28), which rides ahead of Filament's line as the queued reports do. The shells say when an exit has no turn
// of its agent there to hear it (hands.js `onShellWake`), and Filament sends the chat a turn of its own through the
// route a message takes, as a restart's resume does (resume-cut.js). The exit rides ahead of Filament's line, as every
// untold exit rides with a turn. A turn that is just ending is waited for, briefly; a question waiting for the person,
// the compaction card, a running turn's next step, or a newest turn the person stopped take the exit instead (FO-D16,
// FO-D50), and the chat's next turn carries it.

/** The message Filament sends the chat: its own words, not the person's — the page draws them as Filament's. */
export const WAKE_LINE =
  "[Filament: a background command has ended; its exit is above. Go on with your work where it was waiting on that command; if nothing was, say so in a line.]";
/** Its words where what came is the lines a watch caught (hands.js `watchShell`, the owner's word of 10-27). */
export const WATCH_WAKE_LINE =
  "[Filament: a background command you watch printed lines you watch for; they are above. Go on with your work where it was waiting on them; if nothing was, say so in a line.]";
/** Its words where what came is the time the agent set to come back (hands.js `wakeLater`, the owner's word of 10-27). */
export const TIME_WAKE_LINE = "[Filament: the time you set to come back has come; your note is above. Go on with the work you set it for.]";
/**
 * Its words where what came is another agent's report or result, for the agent to read now (subagents.js
 * `reportsDue`; the owner's of 10-28: "if envelope arrives with an intention of you reading it then you should wake").
 */
export const REPORT_WAKE_LINE = "[Filament: another agent's report has come for you; it is above. Weigh it and go on with your work where it was waiting on it; if nothing was, say in a line what you make of it.]";
/**
 * Its words where what came is a check's verdict on a task of the agent's graph, or on the graph it closed (graph-runner.js
 * `verify`, `closeRun`; the nudge map of 11-10: every queued kind woke the agent as "another agent's report").
 */
export const CHECK_WAKE_LINE = "[Filament: a check's verdict has come for you; it is above. Go on with your work where it was waiting on it — fix what failed, or take up what it freed; if nothing was, say in a line what you make of it.]";
/** Its words where what came is the end of a command task of the agent's graph, which Filament ran (graph-runner.js `runTask`). */
export const COMMAND_WAKE_LINE = "[Filament: a command task of your plan has ended; its end is above. Go on with your work where it was waiting on it; if nothing was, say in a line what you make of it.]";
/** Its words where what came is an apply's verdict: whether a task's change went into the folder (graph-runner.js `merge`, `applied`). */
export const MERGE_WAKE_LINE = "[Filament: an apply's verdict has come for you — whether a task's change went into the folder; it is above. Go on with your work where it was waiting on it; if nothing was, say in a line what you make of it.]";
/**
 * Its words where what came is the person's answer to the card that suggested tasks to run side by side: its Accept or
 * its Ignore (graph-runner.js `sideRun`, `ignoreOffer`), which the suggestion told the agent to end its turn for.
 */
export const CARD_WAKE_LINE = "[Filament: the person answered the card that suggested tasks to run side by side; their answer is above. Go on with your work as it says.]";
/** Its words where several kinds came at once. */
export const ANY_WAKE_LINE = "[Filament: what you were waiting for has come; it is above. Go on with your work where it was waiting on it; if nothing was, say so in a line.]";
/**
 * Its words where what came is a letter from another chat (app/letters.js, subagents.js `lettersDue`; the owner's of
 * 11-04: "if agent is idle then it will auto wake"): it waits sealed, in the list of envelopes the turn opens with.
 */
export const LETTER_WAKE_LINE =
  "[Filament: a letter from another chat has come for you; it waits sealed, listed below. Open it with Filament's envelope tool when you choose, and answer it there if it asks for a reply; if it needs nothing more of you, say so in a line.]";
/**
 * Its words where what came is Filament's own check-in: the agent ended its turn while a background command of its ran
 * (idle-wake.js, the owner's of 11-08: "so that you are not stuck forever"). `alone`: its turn carries the check-in
 * and nothing beside it, and the line says that nothing came since; where a letter waits sealed, whose own line
 * follows, or a word queued for the agent rides ahead, something did, and the line says the check-in without that
 * (`IDLE_BESIDE_WAKE_LINE`, which sessions/service.js `turn` picks: it knows what the turn carries).
 * @param {boolean} alone
 */
const idleWakeLine = (alone) =>
  `[Filament: you ended your turn while a background command of yours still runs${alone ? ", and nothing came since" : ""}; Filament's check-in is above. Read its output so far and say in a line where it stands: wait on if it is working, or stop it if it hangs and go on with your work.]`;
export const IDLE_WAKE_LINE = idleWakeLine(true);
export const IDLE_BESIDE_WAKE_LINE = idleWakeLine(false);
const WAKE_LINES = new Set([WAKE_LINE, WATCH_WAKE_LINE, TIME_WAKE_LINE, REPORT_WAKE_LINE, CHECK_WAKE_LINE, COMMAND_WAKE_LINE, MERGE_WAKE_LINE, CARD_WAKE_LINE, ANY_WAKE_LINE, LETTER_WAKE_LINE, IDLE_WAKE_LINE, IDLE_BESIDE_WAKE_LINE]);
/** The lines of what came from the agents' side, by what the queued message is about (subagents.js `dueKinds`). */
const AGENTS_WAKE_LINES = /** @type {Record<string, string>} */ ({ report: REPORT_WAKE_LINE, check: CHECK_WAKE_LINE, command: COMMAND_WAKE_LINE, merge: MERGE_WAKE_LINE, card: CARD_WAKE_LINE });

/**
 * The words of the turn that wakes a chat, by what came (hands.js `wakeKindOf`, and what the queued messages are about,
 * subagents.js `dueKinds`): a command's end, the lines a watch caught, the time the agent set, Filament's check-in on a
 * command that still runs, another agent's report, a check's verdict, a command task's end, an apply's verdict, the
 * person's answer to the side-by-side card, or several of them. @param {string | null | undefined} kind
 */
export const wakeLineFor = (kind) =>
  kind === "lines" ? WATCH_WAKE_LINE : kind === "wake" ? TIME_WAKE_LINE : kind === "idle" ? IDLE_WAKE_LINE : kind && AGENTS_WAKE_LINES[kind] ? AGENTS_WAKE_LINES[kind] : kind === "mixed" ? ANY_WAKE_LINE : WAKE_LINE;

/**
 * Whether a user message is one Filament sends when something the agent waited on came: its last text block is one of
 * the wake lines (`wakeLineFor`), whatever rode ahead of it (the shells' exits, a sub-agent's report).
 * @param {any} message
 */
export function isWakeMessage(message) {
  const c = message?.content;
  if (typeof c === "string") return WAKE_LINES.has(c);
  if (!Array.isArray(c)) return false;
  const last = c.filter((b) => b?.type === "text").at(-1);
  return !!last && WAKE_LINES.has(last.text);
}

/** What a wake is refused with while a turn holds the chat: the waker asks again, as that turn lets go. */
export const WAKE_HELD = "a turn holds the chat: it hears the command's end at its next step, or the chat goes on once it ends";

/**
 * What a wake, or a goal's round, is refused with while room is made for the chat, or was made for the person's message
 * that has not gone yet (the owner's of 11-09): final for the waker — that message's turn carries what came, and the
 * room's end asks again where no message follows (sessions/service.js `roomFor`).
 */
export const WAKE_ROOM = "room is being made for the chat, or was made for the person's message, which goes first: it carries what came";

/** How long the waker waits before it asks: the turn whose end woke it lets go of the chat first. */
export const WAKE_SETTLE_MS = 300;
/** How often it asks again while a turn that is ending still holds the chat, and how many times at most. */
export const WAKE_RETRY_MS = 500;
export const WAKE_TRIES = 40;
/**
 * How long the waker waits before it wakes a chat again whose turn of Filament's own failed before its model did any
 * work, try by try (the owner's of 11-11: "with a growing wait and a small bound"): 1, 5 and 15 minutes — three tries.
 * Past the last, what is owed waits for the chat's next turn.
 */
export const WAKE_AGAIN_MS = Object.freeze([60_000, 5 * 60_000, 15 * 60_000]);

/** The log's words of the waker that wakes a chat's agent: what came, and what becomes of it where the chat does not go on. */
const WAKE_WORDS = Object.freeze({ came: (/** @type {string} */ session) => `what the agent waited on came in ${session}`, waits: "its next turn carries the end" });

/** A wait in the log's words: whole minutes, or seconds under one. @param {number} ms */
const waitWords = (ms) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 100) / 10} s`);

/**
 * The waker: `wake(session)` sends that chat Filament's turn once nothing else will tell its agent of the end — `due`
 * says an end still waits untold, `attended` that a turn of its agent runs and will hear it. One wake at a time per
 * chat: two ends close together go in one turn. A refusal other than a holding turn's is final; the end then rides
 * with the chat's next turn. `idle` hears each chat it lets go of with no turn sent, and whether the wake was given up
 * — a refusal that is final, a post that threw, a turn that held the chat throughout; not where nothing was to send, a
 * turn was there to hear it, or room is being made, whose end asks again —, as the chat's work stretch ends there
 * unless something else keeps it (stretch.js); `coming(session)` says whether a wake is on its way to the chat.
 * A turn it sent can still fail: `ended` hears each turn's end, and wakes the chat again, a few times (`againMs`), for
 * what a turn that failed before any work gave back. `words`: the log's words, where it sends a turn of another kind
 * (a goal's round).
 * @param {{ post: (session: string) => Promise<{ status: number, body: any }>, due: (session: string) => boolean, attended: (session: string) => boolean, idle?: (session: string, gaveUp: boolean) => void, log?: (level: string, msg: string) => void, settleMs?: number, retryMs?: number, tries?: number, againMs?: readonly number[], words?: { came: (session: string) => string, waits: string } }} o
 */
export function createWaker({ post, due, attended, idle = () => {}, log = () => {}, settleMs = WAKE_SETTLE_MS, retryMs = WAKE_RETRY_MS, tries = WAKE_TRIES, againMs = WAKE_AGAIN_MS, words = WAKE_WORDS }) {
  /** The chats a wake is on its way to. @type {Set<string>} */
  const waking = new Set();
  /**
   * The chats whose turn of Filament's own failed before its model did any work (`ended`): how many in a row (`n`), until
   * when no wake goes to the chat (`until`), and how a wake that waits it out is let go at once (`go`).
   * @type {Map<string, { n: number, until: number, go?: () => void }>}
   */
  const failing = new Map();
  /** Whether the app stopped (`stop`): no wake goes from here on, a wake on its way not even to its old address. */
  let stopped = false;
  /** The sleeps under way, each ended at once by the stop. @type {Set<() => void>} */
  const sleeping = new Set();
  /** @param {number} ms @param {(end: () => void) => void} [held]  given how to end it early */
  const sleep = (ms, held) =>
    new Promise((r) => {
      const end = () => {
        clearTimeout(t);
        sleeping.delete(end);
        r(undefined);
      };
      const t = setTimeout(end, ms);
      t.unref?.();
      sleeping.add(end);
      held?.(end);
    });
  /**
   * → what became of the wake: "sent", the chat was sent its turn; "none", nothing was to send, a turn was there to hear
   * it, or room is being made, whose end asks again; "left", it was given up. @param {string} session
   */
  const run = async (session) => {
    // What came, in the log's words: a command's end, the lines a watch caught, the time the agent set (`wakeLineFor`).
    const said = words.came(session);
    for (let i = 0; i < tries; i++) {
      await sleep(i ? retryMs : settleMs);
      // A chat whose turn of Filament's failed is woken again only once its wait is over (`ended`), whatever came for it
      // meanwhile: a provider that fails is not asked again at once for each thing that comes.
      for (let f = failing.get(session); !stopped && f && f.until > Date.now(); f = failing.get(session)) {
        const waits = f;
        await sleep(waits.until - Date.now(), (end) => (waits.go = end));
        delete waits.go;
      }
      if (stopped || !due(session) || attended(session)) return "none";
      /** @type {{ status: number, body: any }} */
      let r;
      try {
        r = await post(session);
      } catch (/** @type {any} */ e) {
        log("warn", `sessions: ${said}, and Filament could not send the chat its turn (${String(e?.message || e)})`);
        return "left";
      }
      if (r.status >= 200 && r.status < 300) {
        // The turn began: whether it went on is its end's to say (`ended`).
        log("info", `sessions: ${said}; Filament sent the chat its turn`);
        return "sent";
      }
      // No chat of this Filament's: a shell of a client's own conversation, which no harness chat holds.
      if (r.status === 404) return "left";
      // Room is being made: the message it is made for goes first, or its end asks again (WAKE_ROOM says which).
      if (r.body?.wake === "room") {
        log("info", `sessions: ${said}; the chat did not go on (${String(r.body?.error || `HTTP ${r.status}`)})`);
        return "none";
      }
      if (r.body?.wake !== "held") {
        log("info", `sessions: ${said}; the chat did not go on (${String(r.body?.error || `HTTP ${r.status}`)}), and ${words.waits}`);
        return "left";
      }
    }
    log("info", `sessions: ${said}; a turn held the chat throughout, and ${words.waits}`);
    return "left";
  };
  /** @param {string} session */
  const wake = (session) => {
    if (stopped || !session || waking.has(session)) return;
    waking.add(session);
    void run(session)
      .catch(() => /** @type {const} */ ("left"))
      .then((out) => {
        waking.delete(session);
        if (out === "sent" || stopped) return;
        // The turn's failure was heard while its post was still on its way (`ended`): the wake goes again, after its wait.
        if ((failing.get(session)?.until || 0) > Date.now()) return wake(session);
        try {
          idle(session, out === "left");
        } catch {}
      });
  };
  return {
    wake,
    /**
     * A turn of the chat's ended. `kept`: the model's history keeps it, so what it carried is told — the chat's failures in
     * a row are over, and a wake that waited one out goes on at once, for whatever came since. Not kept: a turn Filament
     * started by itself failed before its model did any work, and what it carried waits untold again (sessions/service.js
     * `carriedEnded`) — the chat is woken again after `againMs`' next wait, and past the last of them not again for it:
     * what is owed waits for the chat's next turn, and the log says so. Something new that comes still wakes the chat
     * once. Nothing where nothing that wakes the chat waits.
     * @param {string} session @param {boolean} kept
     */
    ended(session, kept) {
      if (stopped || !session) return;
      const f = failing.get(session);
      if (kept) {
        failing.delete(session);
        f?.go?.();
        return;
      }
      if (!due(session)) return;
      const n = f?.n || 0;
      if (n >= againMs.length) {
        failing.set(session, { n, until: 0 });
        log("warn", `sessions: Filament's turn in ${session} failed before its model did any work, ${againMs.length} tries after the first; what it carried waits untold for the chat's next turn, and Filament wakes the chat for it no more by itself`);
        return;
      }
      failing.set(session, { n: n + 1, until: Date.now() + againMs[n] });
      log("info", `sessions: Filament's turn in ${session} failed before its model did any work; what it carried waits untold again, and Filament wakes the chat again in ${waitWords(againMs[n])} (try ${n + 1} of ${againMs.length})`);
      wake(session);
    },
    /** Whether a wake is on its way to the chat. @param {string} session */
    coming: (session) => waking.has(session),
    /** How many wakes are on their way (the tests' wait). */
    pending: () => waking.size,
    /**
     * The app stopped: a wake on its way ends without another post, and none starts — the port it posted to may be
     * another process's by now (a stopped Filament's wakes reached another test file's upstream, flakes3).
     */
    stop() {
      stopped = true;
      for (const end of [...sleeping]) end();
    },
  };
}
