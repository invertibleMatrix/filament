// The turn collector as it stood at v0.9.79 (src/app/acp-collect.js), word for word but its imports: the oracle
// test/collect-tail.test.js asks beside the collector that keeps the reply's tail, on random turns.
// It goes, with that test, once the collector's output is changed on purpose: it then is no oracle.
// @ts-check
// What an agent turn collects while it runs: the reply text, the thoughts (buffered into runs and flushed as one unit
// each — natively, or woven into the text), rendered tool activity, and the notes the bridge raises. One `onEvent`
// for the bridge to call; the collected text is what the reply, the archive and the record read afterwards.
import { ThoughtInliner, sanitizeUnicodeTags } from "../../src/app/acp-render.js";

const THOUGHT_FLUSH_MS = 400;

/**
 * @param {object} args
 * @param {any} args.rec  the request record: notes and changes land on it as they happen
 * @param {boolean} args.stream  whether text and thoughts go out live through `wire`
 * @param {import("../../src/app/acp-wire.js").AgentReply} args.wire
 * @param {string} args.thoughtsMode  "thinking-block" | "native-then-inline" | "text" | "hide"
 * @param {any} args.renderer  the ActivityRenderer turning tool events into lines
 * @param {(level: string, ...args: unknown[]) => void} args.log
 * @param {(fields: { outChars: number, thinkChars: number, thinkTokens: number | null, stage: string }) => void} args.progress  the live view's counters
 * @param {boolean} [args.harness]  the harness's own turn (HarnessV3-ACP AC1-4): the reply is the agent's words and
 *   thoughts, a block per round, and Filament's own lines a block of their own; the run's cards draw the tools, the plan
 *   and the sub-agents, so their lines stay out of the text (the renderer still reads them, for the record's counts)
 * @param {boolean} [args.paged]  a harness chat's turn, whoever sent it (HarnessV4_Overnight_Plan OV-D37): the page
 *   reads it in the shape of its own turn — its live words and its rounds' `blocksBefore` a block per round, the tools
 *   as the run's cards alone, the thoughts as thinking — while the reply on the wire is the one its sender asked for
 *   (`harness`)
 * @param {{ piece: (type: "text" | "thinking", text: string) => void, endBlock: () => void } | null} [args.words]  the
 *   turn's run's live words (HarnessV3-Launch LD-D16): a page that joins mid-turn reads them there
 */
export function createTurnCollector({ rec, stream, wire, thoughtsMode, renderer, log, progress, harness = false, paged = harness, words = null }) {
  // The page's shape and the sender's part ways: a chat's turn sent another way than by its page.
  const split = paged && !harness;
  const col = { text: "", thought: "", nativeThought: "" }; // thought: everything the agent thought; nativeThought: the part sent as thinking blocks
  // Characters the AGENT itself wrote, counted separately from `col.text`. `col.text` also accumulates Filament's
  // own narration — quiet tool lines, inline 💭 quotes, the previous turn's carry-over — none of which is an answer.
  // Deciding "did the agent say anything?" from `col.text` is how a turn that burned its whole budget on tools and
  // produced no answer came to look like a complete reply, so its truncation went unexplained and the user was left
  // with two `⚙` lines and nothing else.
  let agentChars = 0;
  /** Filament's own words in the reply, each as it was said: the archive keeps them as the turn's closing lines. */
  /** @type {string[]} */
  const said = [];
  // The reply's blocks so far, as the page reads them: a new one where the kind changes or after a break. A round's
  // `blocksBefore` — where the run's cards for it go — is this count when the round begins.
  let blocks = 0;
  /** @type {"text" | "thinking" | null} */
  let openKind = null;
  /** Where a piece goes when the two shapes part: the sender's alone (`wire`), the page's alone, or both. */
  const SENDER = split ? "wire" : "both";
  /**
   * One piece of the reply, live: to the wire when it streams, and to the live words the page reads.
   * @param {"text" | "thinking"} kind @param {string} t @param {"both" | "wire" | "page"} [to]
   */
  const out = (kind, t, to = "both") => {
    if (!t) return;
    if (to !== "wire") {
      if (kind !== openKind) {
        blocks++;
        openKind = kind;
      }
      words?.piece(kind, t);
    }
    if (stream && to !== "page") kind === "text" ? wire.streamText(t) : wire.streamThought(t);
  };
  // A tool's line: the page draws the call as its card.
  const appendText = (t) => {
    const line = `${col.text && !col.text.endsWith("\n") ? "\n" : ""}${t}`;
    col.text += line;
    out("text", line, SENDER);
  };
  const inliner = new ThoughtInliner();
  let inlineNoted = false;
  /** @param {string} t @param {"both" | "wire"} [to] */
  const emitText = (t, to = "both") => {
    col.text += t;
    out("text", t, to);
  };
  const endInlineThought = () => {
    const gap = inliner.close(col.text);
    if (gap) emitText(gap, SENDER);
  };
  // ---- thought runs ---------------------------------------------------------------------------------------------
  // Thought chunks are buffered into a RUN and flushed as one emission, instead of streaming fragment by fragment.
  // Two things fall out of that. First, the decision "does this thought go out natively or woven into the text"
  // is made ONCE per run rather than per chunk: a run that started before the reply's text and continued after it
  // used to be split across a reasoning block and a `> 💭` quote. Second, flushing at every tool boundary resets
  // the run, so the thought after a tool call is a new unit and never merges with the one before it — which is what
  // puts thinking in the right position relative to the work it describes.
  // The run also goes out at most THOUGHT_FLUSH_MS after its first unsent chunk, so a long thinking phase streams live
  // in paragraph-sized pieces rather than going silent until the agent starts answering. A timer that started over
  // with every chunk never fired while the agent kept thinking (a model's deltas come far more often than every
  // 400 ms): the page got each thinking phase in one lump at its end, and its speed gauge read nothing until then.
  // The pieces of one run go out alike: nothing between them can change the native-or-inline decision.
  let thoughtRun = "";
  /** @type {NodeJS.Timeout | null} */
  let thoughtTimer = null;
  const flushThought = () => {
    if (thoughtTimer) {
      clearTimeout(thoughtTimer);
      thoughtTimer = null;
    }
    const run = thoughtRun;
    thoughtRun = "";
    if (!run || thoughtsMode === "hide") return;
    const inline = thoughtsMode === "text" || (thoughtsMode === "native-then-inline" && col.text.length > 0);
    if (!inline) {
      col.nativeThought += run;
      out("thinking", run);
      return;
    }
    // Pushed to BOTH lists: `rec.changes` is snapshotted from `priorChanges` once the agent's turn resolves, and
    // this note can be created after that snapshot (a turn whose only inline flush is the final one), so pushing to
    // `priorChanges` alone would leave the Traffic row without it.
    if (thoughtsMode === "native-then-inline" && !inlineNoted) {
      inlineNoted = true;
      const note =
        "acp: thoughts after the reply's text began are woven into the text as quoted paragraphs (💭), in the order they happened; an OpenAI-format client keeps one text block per reply, so a later thinking block would land under all the text. acp.thoughts = thinking-block keeps them as reasoning_content; an Anthropic-format connection (/v1/messages) gets thinking blocks in order";
      (rec.priorChanges ||= []).push(note);
      if (Array.isArray(rec.changes) && !rec.changes.includes(note)) rec.changes.push(note);
    }
    const t = inliner.thought(run, col.text);
    if (t) emitText(t, SENDER);
    // The page reads it as thinking, as on its own turn.
    if (split) out("thinking", run, "page");
  };
  const pushThought = (chunk) => {
    thoughtRun += chunk;
    if (thoughtTimer) return;
    // try/catch because this callback runs on its own tick: a throw here is an uncaughtException, and Filament has no
    // handler for one, so it would take the whole proxy down over a rendering detail.
    thoughtTimer = setTimeout(() => {
      thoughtTimer = null;
      try {
        flushThought();
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} thought flush failed: ${e.message}`);
      }
    }, THOUGHT_FLUSH_MS);
    thoughtTimer.unref?.();
  };
  /**
   * Where the agent's next round begins, as the page reads a chat's turn (HarnessV3-ACP AC1-3): the thought it was
   * thinking goes out first, then the open block ends, so the round's words start one of their own. A reply the page
   * did not ask for is not broken on the wire. → the page's blocks so far: the round's `blocksBefore`.
   */
  const breakBlock = () => {
    if (!paged) return blocks;
    flushThought();
    if (openKind) {
      openKind = null;
      words?.endBlock();
      if (stream && harness) wire.breakBlock();
    }
    return blocks;
  };
  // What the agent says it has thought in the turn, where it counts that itself (Claude's estimate, whose thinking
  // may stream no words; HarnessV4_Tasks B10): null until it says.
  /** @type {number | null} */
  let thoughtSaid = null;
  const tick = (/** @type {string} */ stage) =>
    progress({ outChars: col.text.length + col.thought.length, thinkChars: col.thought.length, thinkTokens: thoughtSaid, stage });
  /** The agent's own count of its thinking so far: the record's live figure takes it. @param {number} tokens */
  const thought = (tokens) => {
    thoughtSaid = tokens;
    tick("thinking");
  };
  const onEvent = (ev) => {
    // A sub-agent's own session (Claude's, HarnessV3-ACP AC1-2): its words are its card's report and its plan is its
    // own, never the turn's reply or checklist.
    if (ev.subagent && (ev.type === "text" || ev.type === "thought" || ev.type === "plan")) return;
    // Unicode tag characters (U+E0000 block) are stripped at the edge, on the agent's own text and thoughts: they
    // are invisible, meaningless to the reader, and would otherwise be re-sent to the next model forever and land
    // in the archive's byte-exact copy of what the agent said.
    if (ev.type === "text") {
      const clean = sanitizeUnicodeTags(ev.text);
      flushThought();
      endInlineThought();
      col.text += clean;
      tick("answering");
      // `own` marks text that Filament wrote rather than the agent (a failure sentence, a hint). It still goes into
      // the reply and the archive, but it does not count as the agent having answered — see `agentChars`.
      if (!ev.own) agentChars += clean.length;
      else if (clean.trim()) said.push(clean.trim());
      out("text", clean);
    } else if (ev.type === "thought") {
      const clean = sanitizeUnicodeTags(ev.text);
      col.thought += clean;
      tick("thinking");
      if (thoughtsMode === "hide" || !clean) return;
      pushThought(clean);
    } else if (ev.type === "agent-notice") {
      // What the agent tells the person beside its answer (HarnessV4_Tasks C21): the harness draws the run's event on a
      // line of its own; a client that draws no card gets it as a line of the reply, where it always came before. It
      // is no step of the agent's: the thought it interrupts ends only where its line is written.
      const t = renderer.handle(ev);
      if (t && !harness) {
        flushThought();
        endInlineThought();
        appendText(sanitizeUnicodeTags(t));
      }
    } else if (ev.type === "tool" || ev.type === "plan" || ev.type === "subagent" || ev.type === "compaction") {
      if (ev.type === "plan" && ev.bridged) return;
      // A tool boundary ends the thought run: whatever the agent was thinking before this call is flushed as its
      // own unit, and the next thought starts a fresh one.
      flushThought();
      const t = renderer.handle(ev);
      if (t && !harness) {
        endInlineThought();
        appendText(sanitizeUnicodeTags(t));
      }
      tick(ev.type === "plan" ? "planning" : ev.type === "subagent" ? "running a sub-agent" : ev.type === "compaction" ? "compacting its context" : "using tools");
    } else if (ev.type === "note") {
      (rec.priorChanges ||= []).push(String(ev.text || ""));
      if (ev.note) (rec._priorNotes ||= []).push(ev.note);
    } else if (ev.type === "ask" && ev.waits) tick(ev.kind === "lead" ? "waiting for its lead's answer" : "waiting for your answer");
    else if (ev.type === "ask-end") tick("using tools");
  };
  /** Filament's own sentence in the reply, set apart from the agent's words: in the harness, a block of its own. @param {string} text */
  const ownLine = (text) => {
    if (paged) {
      breakBlock();
      // The sender's reply sets it apart with a blank line where the page gives it a block.
      if (split) emitText(`${col.text && !col.text.endsWith("\n") ? "\n" : ""}\n`, "wire");
      onEvent({ type: "text", own: true, text: `_filament: ${text}_` });
      return;
    }
    onEvent({
      type: "text",
      own: true,
      text: `${col.text && !col.text.endsWith("\n") ? "\n" : ""}\n_filament: ${text}_`,
    });
  };

  return {
    col,
    onEvent,
    flushThought,
    ownLine,
    breakBlock,
    thought,
    /** Filament's own words in the reply so far, each as it was said. */
    said,
    /** Characters the agent itself wrote (Filament's own sentences excluded). */
    get agentChars() {
      return agentChars;
    },
  };
}
