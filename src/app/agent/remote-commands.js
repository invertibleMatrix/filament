// @ts-check
// A background command on another machine (the remote-agents plan's c-tools): bash_background's `machine`, and a coding
// agent's background_command's, runs the command on a machine this Filament keeps an agents' device for, through its
// exec route (http/admin/exec.js), as a background shell of this chat (hands.js `keepRemoteShell`) — its output read as
// a local one's, its end told as one's, its stop sent there. The folder there is found as a sub-agent's is
// (remote-agents.js `place`). This chat's permission mode judges it there, where that machine takes it (`exec-mode`, the
// owner's of 11-10), capped by the grants it holds for this one's agents — Auto as Edit unless they may run without
// asking —, else that machine's own mode; an ask there waits for this machine's person, on a permission card in this
// chat answered by a press (`thereForm`) — never by this chat's model, its tools, its sub-agents or a switch of its mode:
// the agents' device may press Allow there itself, so this machine is the boundary.
import { createRemoteAgents, takes, ANSWER_MS, ANSWERED_THERE, STREAM_IDLE_MS, wordsThere } from "./remote-agents.js";
import { PERMISSION_MODES } from "./prompt.js";
import { keepRemoteShell, TIMED_OUT_CEILING_MS } from "../../adapters/tools/hands.js";
import { unnoticedStream } from "../../core/notices.js";
import { durationWords } from "../../core/text.js";
import { JUDGED_COMMAND_CHARS, fromJudged } from "../../adapters/agents/asks.js";

/** How long a stop sent there may take: the exec route waits up to 20 s for the command's end before it answers. */
const STOP_MS = 25_000;
/**
 * An exec whose stream dropped is read again by its id (the review of 11-11): `REREAD_MS` after a read that machine did
 * not answer, twice as long after each one more, `REREAD_MAX_MS` at most; `REATTACHED_MS` after one it answered, while
 * the command runs there. One not yet seen to run is read `REREAD_TRIES` times, and its start refuses then.
 */
const REREAD_MS = 1000;
const REREAD_MAX_MS = 30_000;
const REATTACHED_MS = 5000;
const REREAD_TRIES = 5;
/**
 * How long that machine keeps a running command whose stream is gone before it stops it, unless its caller reads it
 * again: its exec route's EXEC_GRACE_MS (http/admin/exec.js), said in a lost command's words. A Filament there from
 * before stops it as its stream goes.
 */
export const THERE_GRACE_MS = 5 * 60_000;
/**
 * How long that machine may not answer the reads of a command whose stream dropped before the command is said lost
 * here: past the grace it had there (`THERE_GRACE_MS`), so by then that machine has stopped it.
 */
export const LOST_AFTER_MS = 6 * 60_000;
/** How much of a command's output is held before it is seen to run there, in characters: its first and its newest. */
const EARLY_CHARS = 32 * 1024;
/** How long why an exec ended there may be where this chat says it, and the folder there on its card, in characters. */
const WHY_CHARS = 200;
const CWD_CHARS = 200;

/** @typedef {{ stream: "stdout" | "stderr", text: string }} Piece */

/** The machine a command names, trimmed: "" for none — it runs here. @param {any} input */
export const onMachine = (input) => (input?.machine == null ? "" : String(input.machine).trim());

/** A command on another machine where it is not offered: a sub-agent's, a team's, or a Filament with no such machine. */
export const NOT_OFFERED_THERE = "Not run: no command runs on another machine from here — machine is offered to a chat's own agent where this Filament keeps a machine for its agents. Leave machine out to run it here.";
/** A command on another machine from a read-only chat: its mode is a ceiling there too. */
export const READ_ONLY_THERE = "Not run: this chat is read-only, and runs no command on another machine either — the person may switch its mode.";
/**
 * A command on another machine from a chat another machine's agents started: that device may answer this chat's asks,
 * and an ask there is this machine's person's alone to answer.
 */
export const AGENTS_CHAT_THERE = "Not run: this chat was started by another machine's agents, who may answer its asks — a command runs on another machine only from a chat of this machine's person.";
/**
 * Why an ask's wait here was let go where it was settled on that machine (`AskHere`'s `gone.reason`): its exec ended
 * there — denied there, its grant switched off, its timeout —, as remote-agents.js `ANSWERED_THERE` says an Allow there.
 */
export const ENDED_THERE = "ended-there";
/** A command with cwd and no machine, where machine is offered: here every command starts in the task folder. */
export const CWD_HERE = "Not run: cwd names a folder on another machine, with machine: here every command starts in the task folder — cd in the command itself.";
/**
 * A command on another machine longer than its permission card shows (asks.js `fromJudged`): what a cut card hid would
 * run there unseen. @param {number} n
 */
const tooLong = (n) =>
  `Not run: this command is ${n} characters long, and a command on another machine runs only as its permission card shows it whole — ${JUDGED_COMMAND_CHARS} characters at most: run a shorter one, such as a script kept there.`;

/**
 * Why a machine refused a command or did not answer, in words that name it: its agents' grant switched off there (its
 * 403 says `grant: "agents"`, as remote-agents.js says it), else its own words.
 * @param {string} name @param {any} e
 */
const refusedWords = (name, e) =>
  e?.body?.grant === "agents" ? `${name} lets this Filament's agents work there no more: its grant is switched off there — switch it on in Settings › Remote access on ${name}` : wordsThere(e?.message || e, WHY_CHARS);

/**
 * The permission card a command's ask there is answered on in this chat (asks.js `fromJudged`, as the loop's card and a
 * coding agent's judged permission are drawn): the machine and the command, and that only a press here answers it. A
 * rule of this chat that asks first (`rule`) asks on it before anything is sent there, the mode after. A rule there
 * that asks is said as that machine says it (`ruleThere`); else whose mode asks: this chat's where it went with the command (`sent`) — its Auto that machine judged as Edit, its grant
 * Without asking off —, else that machine's, where it is one of Filament's; and the folder there in one line
 * (`wordsThere`).
 * @param {ThereAsk} q @param {{ tool: string, call?: string | null }} o
 */
export const thereForm = ({ machine, cwd, command, mode, rule = null, sent = null, ruleThere = null }, { tool, call = null }) => {
  const named = /** @type {readonly string[]} */ (PERMISSION_MODES).includes(mode) ? mode : "one this Filament does not know";
  return fromJudged({
    agent: "",
    call,
    tool: `${tool} on ${machine}`,
    words: rule
      ? `Run this command on ${machine}? A rule of this chat asks first: ${rule}.`
      : ruleThere
        ? `Run this command on ${machine}? A rule there asks first: ${wordsThere(ruleThere, WHY_CHARS)}.`
        : sent === "auto" && mode !== "auto"
          ? `Run this command on ${machine}? This chat runs in auto, and ${machine} asks first: its Without asking grant for this Filament's agents is off.`
          : sent
            ? `Run this command on ${machine}? This chat's permission mode (${named}) asks first.`
            : `Run this command on ${machine}? Its permission mode there (${named}) asks first.`,
    command,
    reason: `It runs on ${machine}, in ${wordsThere(cwd, CWD_CHARS)}${rule ? (sent ? ", where this chat's mode judges it after your press" : ", whose permission mode judges it there after your press") : ""}. Only your press here answers it: not this chat's agent, its sub-agents or its mode.`,
  });
};

/**
 * The person's press on that card: Allow runs it there; Deny, or words with no press, refuses it — words alone never
 * allow. Null where nothing was answered (the wait was cut); `switched` where this chat's mode moved meanwhile, which
 * answers nothing there.
 * @param {any} a @returns {{ allow: boolean, words: string } | "switched" | null}
 */
export const thereReply = (a) => {
  if (!a) return null;
  if (a.outcome === "switched") return "switched";
  if (a.outcome !== "answered") return null;
  const r = a.answers?.permission;
  return { allow: Array.isArray(r?.chosen) && r.chosen[0] === "allow", words: typeof r?.words === "string" ? r.words.trim() : "" };
};

/**
 * What an exec's copy holds past the first `seen` characters of its output, piece by piece: what a dropped stream never
 * brought. Where the copy dropped some between its head and its tail (`cut`), what lay there is gone.
 * @param {any} view @param {number} seen @returns {{ stream: "stdout" | "stderr", text: string }[]}
 */
const restOf = (view, seen) => {
  /** @type {any[]} */
  const pieces = Array.isArray(view?.output) ? view.output : [];
  const at = view?.cut?.at ?? pieces.length;
  const dropped = view?.cut?.dropped ?? 0;
  /** @type {{ stream: "stdout" | "stderr", text: string }[]} */
  const out = [];
  let pos = 0;
  pieces.forEach((p, i) => {
    if (i === at) pos += dropped;
    const text = String(p?.text ?? "");
    if (pos + text.length > seen) out.push({ stream: p.stream === "stderr" ? "stderr" : "stdout", text: text.slice(Math.max(0, seen - pos)) });
    pos += text.length;
  });
  return out;
};

/**
 * What of a command's output is held before it is seen to run there: its first EARLY_CHARS characters and its newest
 * EARLY_CHARS, as the exec route keeps its copy, and a line saying how many between were dropped.
 */
const heldOutput = () => {
  /** @type {Piece[]} */
  let head = [];
  /** @type {Piece[]} */
  let tail = [];
  let headChars = 0;
  let tailChars = 0;
  let dropped = 0;
  return {
    /** @param {Piece["stream"]} stream @param {string} text */
    add(stream, text) {
      if (headChars < EARLY_CHARS) {
        const first = text.slice(0, EARLY_CHARS - headChars);
        head.push({ stream, text: first });
        headChars += first.length;
        text = text.slice(first.length);
      }
      if (!text) return;
      tail.push({ stream, text });
      tailChars += text.length;
      while (tailChars > EARLY_CHARS) {
        const oldest = tail[0];
        const gone = Math.min(tailChars - EARLY_CHARS, oldest.text.length);
        if (gone === oldest.text.length) tail.shift();
        else oldest.text = oldest.text.slice(gone);
        tailChars -= gone;
        dropped += gone;
      }
    },
    /** All it holds, in order, and it holds nothing more. @returns {Piece[]} */
    take() {
      const all = [...head, ...(dropped ? [{ stream: /** @type {const} */ ("stdout"), text: `\n[Filament: ${dropped} characters of its output were dropped here, before it was seen to run]\n` }] : []), ...tail];
      head = [];
      tail = [];
      headChars = tailChars = dropped = 0;
      return all;
    },
  };
};

/**
 * How an exec ended there, as a shell's end says it, where it did not exit on its own: its caller gone there is its
 * stream from here, dropped. @param {any} d @param {string} name
 */
const whyOf = (d, name) =>
  d?.ended === "closed" ? `its stream from ${name} dropped, and ${name} stopped it` : d?.ended ? String(d.reason || d.ended) : d?.code == null && d?.signal ? `it was ended by ${d.signal}` : null;
/**
 * An exec's end as that machine sends it, its words as this chat says them: how it ended, why and by what signal, each
 * in one line (`wordsThere`). @param {any} d
 */
const endThere = (d) =>
  d && typeof d === "object"
    ? { ...d, ...(d.ended != null ? { ended: wordsThere(d.ended, 40) } : {}), ...(d.reason != null ? { reason: wordsThere(d.reason, WHY_CHARS) } : {}), ...(d.signal != null ? { signal: wordsThere(d.signal, 40) } : {}) }
    : d;

/**
 * @typedef {{ machine: string, cwd: string, command: string, mode: string, rule?: string | null, sent?: string | null, ruleThere?: string | null }} ThereAsk
 *   an ask there, as this chat's card says it: the machine's name, the folder there, the command and the mode it was
 *   judged in there — or this chat's rule that asks first, here (`rule`, as describeRule says it), before anything is
 *   sent there; `sent`: this chat's mode, where it went with the command, null where that machine's own judges it;
 *   `ruleThere`: that machine's rule that made it ask, as that machine says it
 * @typedef {(q: ThereAsk, gone: AbortSignal) => Promise<{ allow: boolean, words: string } | null>} AskHere  the
 *   person's press here, or null where the wait was cut — `gone`, where the ask there went first: allowed there
 *   (`ANSWERED_THERE`), ended there (`ENDED_THERE`), or its stream dropped
 */

/**
 * @param {{ machines: import("../../services/machines/index.js").Machines | null, wait?: (ms: number) => Promise<void> }} deps
 *   `wait`: the pause between two reads of an exec whose stream dropped (tests shorten it)
 */
export function createRemoteCommands({ machines, wait = (ms) => new Promise((r) => setTimeout(r, ms).unref?.()) }) {
  const agents = createRemoteAgents({ machines });
  return {
    /**
     * Start `command` on the machine `which` names, in `cwd` there or the clone there of this chat's repository, as a
     * background shell of `owner`: answers once it runs there, or refuses in words — a command longer than its card
     * shows, a machine not kept, one that does not answer, its grant off, the mode or that machine's rules, the person's
     * Deny, an ask nobody answered there. A rule of this chat that asks first (`rule`) asks the person here before
     * anything is sent there; an ask there waits on `ask` too, and one answered there leaves this chat's card. `signal`
     * cuts the start (the turn's stop), and stops what waited there with it. Once it runs, a stop is the shell's
     * (`bash_kill`, the panel's Stop): sent there. A stream that drops ends nothing: its exec there is read again by its
     * id for as long as it runs (`dropped`), which keeps it running there; one that machine does not answer for
     * `LOST_AFTER_MS`, or refuses to read, ends the shell in words that say what is known. `early` (a coding agent's, whose call its agent times out on its side: the owner's
     * of 11-10): the start answers as soon as an ask waits — its shell kept, `waits` true while the ask does —, `signal` lets go of it then, and
     * the person's press runs it while their Deny, or a wait that is cut, ends the shell in the words the start would
     * have refused with. `mode`: this chat's permission mode as the call is made, sent with the command where that
     * machine takes it (its /state's `takes` names `exec-mode`); a Filament there from before is sent none.
     * @param {{ machine: string, cwd?: string | null, command: string }} input
     * @param {{ folder: string, owner: import("../../adapters/tools/hands.js").ShellOwner, ask: AskHere, rule?: string | null, signal?: AbortSignal | null,
     *   onEnd?: ((end: import("../../adapters/tools/hands.js").ShellNow) => void) | null, log?: boolean, early?: boolean, mode?: string | null }} o
     * @returns {Promise<{ id: string, s: any, waits: () => boolean }>}
     */
    async start(input, { folder, owner, ask, rule = null, signal = null, onEnd = null, log = false, early = false, mode: chatMode = null }) {
      if (!machines) throw new Error("this Filament keeps no machines");
      const command = String(input.command ?? "");
      if (command.trim().length > JUDGED_COMMAND_CHARS) throw new Error(tooLong(command.trim().length));
      const p = await agents.place(input.machine, { cwd: input.cwd ?? null, folder });
      const name = p.machine.name;
      const m = machines.find(p.machine.id, { agents: true });
      if (!m) throw new Error(`no machine "${input.machine}" for this Filament's agents`);
      /** @type {import("../../services/machines/client.js").Client} */
      let client;
      try {
        client = await machines.clientOf(m, { agents: true, timeoutMs: ANSWER_MS });
      } catch (e) {
        throw new Error(refusedWords(name, e));
      }
      /** This chat's mode, where it goes with the command. */
      const sent = chatMode && /** @type {readonly string[]} */ (PERMISSION_MODES).includes(chatMode) && takes(client, "exec-mode") ? chatMode : null;
      const own = new AbortController();
      const giveUp = () => own.abort();
      signal?.addEventListener("abort", giveUp, { once: true });
      /** @param {string} words */
      const deniedWords = (words) => `Not run on ${name}: the person denied it${words ? ` — "${words}"` : ""}.`;
      /** The exec there, once its stream names it. */
      let id = "";
      let cwd = wordsThere(p.cwd, CWD_CHARS);
      let mode = "";
      /** That machine's rule that made it ask, as its first event says it. */
      let ruleThere = "";
      /** Whether it asked there, and whether it runs there now. */
      let asked = false;
      let running = false;
      /** How many characters of its output came, and what came before its shell was kept. */
      let seen = 0;
      const held = heldOutput();
      /** What the person's press here said, once it went there: their Deny's words, or that they allowed it. */
      let denial = "";
      let allowed = false;
      /** @type {ReturnType<typeof keepRemoteShell> | null} */
      let shell = null;
      let over = false;
      /** @type {(v: { id: string, s: any, waits: () => boolean }) => void} */
      let ok = () => {};
      /** @type {(e: Error) => void} */
      let no = () => {};
      let settled = false;
      const begun = new Promise((resolve, reject) => {
        ok = resolve;
        no = reject;
      });
      /**
       * Its shell is kept, what came before it with it, and the start answers — unless it refused: once it runs there,
       * or (`early`) as its ask waits.
       */
      const keep = () => {
        if (settled && !shell) return;
        if (!shell) {
          shell = keepRemoteShell({ command, cwd, owner, machine: name, stop, onEnd, log });
          for (const x of held.take()) shell.said(x.stream, x.text);
        }
        if (!settled) {
          settled = true;
          signal?.removeEventListener("abort", giveUp);
          ok({ id: shell.id, s: shell.s, waits: () => !running && !over });
        }
      };
      /** It runs there. */
      const begin = () => {
        if (settled && !shell) return;
        running = true;
        keep();
      };
      /**
       * It never ran there: the start refuses in `words` — or, its shell kept while its ask waited (`early`), the shell
       * ends in them, its ask's card let go and its stream with it. @param {string} words
       */
      const fail = (words) => {
        if (shell && !running) {
          over = true;
          unasked.abort(ENDED_THERE);
          shell.ended({ code: null, why: words });
          own.abort();
          return;
        }
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", giveUp);
        own.abort();
        no(new Error(words));
      };
      /**
       * Each stream's words as that machine's: no notice of Filament's opens in them, split across two pieces or not
       * (core/notices.js; the xf-words hunt's — a watched line or the output read closed Filament's notice and opened one
       * of that machine's). Filament's own notices are added after.
       */
      const fenced = { stdout: unnoticedStream(), stderr: unnoticedStream() };
      /** @param {Piece["stream"]} stream @param {string} text */
      const put = (stream, text) => {
        if (!text) return;
        if (shell) shell.said(stream, text);
        else held.add(stream, text);
      };
      /** Output with no ask before it says it runs there. @param {Piece["stream"]} stream @param {string} text */
      const said = (stream, text) => {
        if (!text) return;
        seen += text.length;
        if (!shell && !asked) begin();
        put(stream, fenced[stream].take(text));
      };
      /** The ask's wait here, which its answer there, its end there or a stream that drops ends. */
      const unasked = new AbortController();
      /** Its end, once: the shell's where it ran, else the start's refusal. @param {any} d */
      const end = (d) => {
        if (over) return;
        over = true;
        // An ask still on this chat's card ended there with its exec: the card goes.
        unasked.abort(ENDED_THERE);
        if (running || seen > 0 || !asked) {
          begin();
          for (const k of /** @type {const} */ (["stdout", "stderr"])) put(k, fenced[k].end());
          /** @type {NonNullable<typeof shell>} */ (shell).ended({ code: typeof d?.code === "number" ? d.code : null, why: whyOf(d, name) });
        } else
          fail(denial || (allowed && d?.ended === "denied" && d?.reason ? `Not run on ${name}: the person allowed it, but ${name} refuses it as things stand there now — ${d.reason}` : `Not run on ${name}: ${whyOf(d, name) || "it ended before it ran"}.`));
        own.abort();
      };
      /** An exec as GET /exec/:id or a stop answers it: what of its output never came, whether it runs, and its end. @param {any} v */
      const caughtUp = (v) => {
        for (const x of restOf(v, seen)) said(x.stream, x.text);
        if (v?.state === "running") begin();
        if (v?.state === "ended") end(endThere(v));
      };
      /** Its stop, sent there (the shell's `stop`): answered once it has ended there, or the stop could not be sent. */
      async function stop() {
        if (!over && id)
          try {
            caughtUp(await client.post(`/exec/${encodeURIComponent(id)}/stop`, {}, { timeoutMs: STOP_MS }));
          } catch (/** @type {any} */ e) {
            if (e?.body?.exec) caughtUp(e.body.exec);
          }
        if (!over && shell) end({ code: null, ended: "stopped", reason: `stopped here; ${name} did not say it ended` });
        own.abort();
      }
      /** Its ask there, put to the person here; their press sent there. */
      const answerAsk = async () => {
        asked = true;
        // Early: the start answers now, its shell waiting on the person's press, so the call that started it may end.
        if (early) keep();
        const reply = await ask({ machine: name, cwd, command, mode, sent, ruleThere: ruleThere || null }, unasked.signal).catch(() => null);
        if (over || running || (settled && !shell) || unasked.signal.aborted) return;
        if (!reply) return fail(`Not run on ${name}: the wait for the person's answer was cut, and its ask there ended with it.`);
        if (reply.allow) allowed = true;
        else denial = deniedWords(reply.words);
        try {
          const r = await client.post(`/exec/${encodeURIComponent(id)}/answer`, { allow: reply.allow, ...(reply.words ? { words: reply.words } : {}) }, { timeoutMs: ANSWER_MS * 2 });
          if (!reply.allow) return fail(denial);
          if (r?.ran === false && r?.reason) return fail(`Not run on ${name}: the person allowed it, but ${name} refuses it as things stand there now — ${wordsThere(r.reason, WHY_CHARS)}`);
          begin();
        } catch (/** @type {any} */ e) {
          // It answered, and asks nothing now: answered or ended there meanwhile, as its events say. Not reached: a Deny
          // that could not be sent lets its stream go, which stops it there; an Allow waits on its stream, or its read.
          if (!reply.allow && !e?.body) fail(denial);
        }
      };
      /**
       * Its events, each as it comes — none waits behind the ask's wait here. Its first says whether it runs or asks; an
       * older Filament's says neither: its exec is read, a read that fails taken as running unless its ask follows.
       * @param {any} d
       */
      const heard = (d) => {
        if (d?.type === "exec") {
          id = String(d.id || "");
          if (d.cwd) cwd = wordsThere(d.cwd, CWD_CHARS);
          mode = String(d.mode || "");
          ruleThere = typeof d.rule === "string" ? d.rule : "";
          if (d.state === "running") begin();
          else if (d.state !== "asking")
            void client.get(`/exec/${encodeURIComponent(id)}`, { timeoutMs: ANSWER_MS }).then(
              (v) => (v?.state === "running" || (!v && !asked)) && begin(),
              () => !asked && begin(),
            );
        } else if (d?.type === "ask") void answerAsk();
        else if (d?.type === "answer" && d.allow) {
          // Allowed — by the press here, or there by its own person: a card still here goes, answered there.
          unasked.abort(ANSWERED_THERE);
          begin();
        } else if (d?.type === "output") said(d.stream === "stderr" ? "stderr" : "stdout", String(d.text ?? ""));
        else if (d?.type === "exit") end(endThere(d));
      };
      /**
       * Its stream ended with no end said: a gap in the network ends nothing there, so its exec is read again by its id
       * for what never came and how it stands — on and on while it runs there, each read keeping it running there (that
       * machine stops one nobody reads, `THERE_GRACE_MS`), until its end is read. One not yet seen to run is read a few
       * times, and its start refuses. One that machine does not answer for `LOST_AFTER_MS`, or refuses to read, ends
       * here in words that say what is known, and a stop is sent there. @param {string} why
       */
      const dropped = async (why) => {
        /** How long that machine has not answered, read after read, and the wait before the next. */
        let silence = 0;
        let next = REREAD_MS;
        /** That machine's refusal of a read: it answered, and would not say how the exec stands. @type {string | null} */
        let refused = null;
        for (let i = 0; !over && id; i++) {
          /** @type {any} */
          let v = null;
          try {
            v = await client.get(`/exec/${encodeURIComponent(id)}`, { timeoutMs: ANSWER_MS });
          } catch (/** @type {any} */ e) {
            const status = Number(e?.status) || 0;
            if (status >= 400 && status < 500) refused = refusedWords(name, e);
          }
          if (v) caughtUp(v);
          if (over || refused || v?.state === "asking") break;
          if (settled ? !v && silence >= LOST_AFTER_MS : i + 1 >= REREAD_TRIES) break;
          const ms = v ? (settled ? REATTACHED_MS : REREAD_MS) : next;
          silence = v ? 0 : silence + ms;
          next = v ? REREAD_MS : Math.min(REREAD_MAX_MS, next * 2);
          await wait(ms);
        }
        if (over) return;
        if (!settled) return fail(`Not run on ${name}: ${why}`);
        void client.post(`/exec/${encodeURIComponent(id)}/stop`, {}, { timeoutMs: STOP_MS }).catch(() => {});
        end({
          code: null,
          ended: "lost",
          reason: refused
            ? `its stream from ${name} dropped (${why}), and ${name} would not say how it stands (${refused}): its end there could not be read — it may still be running on ${name}; a stop was sent there`
            : silence >= LOST_AFTER_MS
              ? `its stream from ${name} dropped (${why}), and ${name} has not answered for ${durationWords(silence)} since: its end there could not be read. ${name} stops a command whose stream is gone within ${durationWords(THERE_GRACE_MS)} unless it is read again, so it runs there no more — unless Filament on ${name} went down first; a stop was sent there too, and may not have reached it`
              : `its stream from ${name} dropped (${why}), and its ask there was let go: a stop was sent there`,
        });
      };
      /** Sent there: its exec's stream, each event heard as it comes. */
      const go = () =>
        client
          .stream(
            "/exec",
            { cwd: p.cwd, command, timeoutMs: TIMED_OUT_CEILING_MS, ...(sent ? { mode: sent } : {}) },
            (_e, d) => {
              try {
                heard(d);
              } catch {}
            },
            { signal: own.signal, idleMs: STREAM_IDLE_MS },
          )
          .then(
            () => {
              unasked.abort();
              return over || own.signal.aborted ? undefined : dropped("its stream ended with no end said");
            },
            (/** @type {any} */ e) => {
              unasked.abort();
              if (over) return;
              if (own.signal.aborted) return fail(`Not run on ${name}: the turn's stop cut its start${asked ? ", and its ask there with it" : ""}.`);
              if (!id) return fail(`${name} refused it: ${refusedWords(name, e)}`);
              return dropped(wordsThere(e?.message || e, WHY_CHARS));
            },
          )
          .catch(() => {});
      // A rule of this chat that asks first: the person's press here, before anything is sent there, whatever the mode —
      // which judges it there after. Early, the start answers as it waits.
      if (rule) {
        if (early) keep();
        const yes = await ask({ machine: name, cwd: p.cwd, command, mode: "", rule, sent }, own.signal).catch(() => null);
        if (own.signal.aborted || !yes?.allow) {
          const words = own.signal.aborted ? `Not run on ${name}: the turn's stop cut its start.` : !yes ? `Not run on ${name}: the wait for the person's answer was cut.` : deniedWords(yes.words);
          if (!early) {
            signal?.removeEventListener("abort", giveUp);
            throw new Error(words);
          }
          fail(words);
          return begun;
        }
      }
      go();
      return begun;
    },
  };
}
