// @ts-check
// A coding agent's turn as a run (HarnessV3-ACP AC1-3): what the agent sends — its words, its thoughts, its tool calls,
// its plan, its sub-agents, and for Claude the raw SDK messages beside them — read into the events the loop publishes
// (services/runs.js RUN_EVENT_FIELDS), so every view built for the loop draws an agent's turn too. One translator for
// every engine: an adapter speaks the agent events (`text`, `thought`, `tool`, `plan`, `subagent`, `raw`), this module
// speaks runs. The reply's words are the collector's to stream; the translator tells it where a round begins, so the
// reply breaks its block there and the round's cards land after its own words.
import { statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { cardOf } from "../core/tool-vocab.js";
import { driveSpelled, editsSaid } from "../core/call-place.js";
import { redactSecrets } from "../core/redact.js";
import { cut, clip, squash } from "../core/text.js";
import { spaceFields } from "../core/space.js";
import { saysCache } from "../core/cache-facts.js";
import { announceable, notRunWords } from "./acp-render.js";
import { rawType } from "../adapters/agents/acp/updates.js";
import { askedOf } from "../adapters/agents/asks.js";
import { imageBlock, picturesIn } from "../core/media.js";
import { createNowIn } from "./now-in.js";
import { envelopeSummary } from "./agent/envelopes.js";
import { pressFieldsOf } from "./agent/space-dashboard.js";

/** How often a running command's output goes out, at most (the loop's own pace). */
const OUTPUT_FLUSH_MS = 250;
/** How often what a sub-agent wrote since joins the run (HarnessV4_Tasks E15 step 5, AG-154): its thread shows it writing. */
const SUBAGENT_WORDS_MS = 500;
/** A message's thinking comes before its words. */
const WORD_KINDS = /** @type {const} */ (["thinking", "text"]);
/** How much of a running command's output one event carries: its newest part. */
const OUTPUT_TAIL_CHARS = 4000;
/** How much of a sub-agent's prompt and report the events carry, as the loop's do. */
const SUBAGENT_CHARS = 4000;
/** How much of the summary an agent kept when it compacted its own context the mark carries: all of any it writes. */
const KEPT_SUMMARY_CHARS = 40_000;
/**
 * How long a call over MCP waits to see the agent's call it came in (`callFor`): the agent's word of its call and the
 * call itself come by different ways, and either may come first.
 */
const CALL_SEEN_MS = 2000;
/** A sub-agent's end, in the run's words. */
const SUBAGENT_STATUS = Object.freeze({ completed: "done", failed: "failed", cancelled: "stopped", disconnected: "aborted" });
/** An ACP tool kind, as the name the card vocabulary knows it by, for an agent that does not say its tool's own
 *  name. */
const KIND_NAMES = Object.freeze({ read: "read", edit: "edit", search: "grep", execute: "bash", fetch: "web_fetch" });
/** ACP's kinds the vocabulary has no tool for, as the word their card reads: an agent's title for one may be its path
 *  alone. */
const KIND_WORDS = Object.freeze({ delete: "Delete", move: "Move" });
/** The calls that may write: a round in which one ran is snapshotted. A failed command may have written too. */
const WRITING_CARDS = new Set(["write", "edit", "shell"]);
const WRITING_KINDS = new Set(["edit", "delete", "move", "execute"]);
/** The cards whose subject is a file: drawn relative to the working folder, as the snapshots name it. */
const FILE_CARDS = new Set(["read", "write", "edit"]);
/** A plan entry's status, in the loop's words. */
const PLAN_STATUS = Object.freeze({ pending: "pending", in_progress: "doing", completed: "done" });
/** The agent's events that are a piece of its work: before one, a compaction that ended is marked. */
const WORK = new Set(["text", "thought", "tool", "subagent", "plan"]);
/** A sub-agent still running when the turn ended, by how it ended: in the agent's words for a sub-agent's end. */
const SUBAGENT_LEFT = Object.freeze({ done: "completed", stopped: "cancelled", aborted: "disconnected", failed: "failed" });
/** Whether a folder is there. @param {string} p */
const isDirAt = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
/**
 * A path a call names, as this machine spells it (r-hands, 11-12). A coding agent whose shell is Git Bash may spell a
 * file tool's path as that shell does — `/h/proj/a.js`, WSL's `/mnt/h/proj/a.js` — and on Windows `resolve` reads that
 * from the current drive's root (`C:\h\proj\a.js`). The file the agent wrote was then none of its chat's folder:
 * outside it in Changes, with no diff; none of its round's own, so Rewind did not put it back; no write of its chat's,
 * so the chat's own file watcher was woken by it. It is the drive it names, as a command's folders are read
 * (core/call-place.js `driveSpelled`) — unless a folder of the spelling's name is there on the current drive (`C:\h`):
 * then it is in that folder, as `resolve` reads it. Any other path, and every path elsewhere than Windows, as it is.
 * @param {string} p @param {{ platform?: string, isDir?: (path: string) => boolean }} [o]
 */
export function hostPath(p, { platform = process.platform, isDir = isDirAt } = {}) {
  const drive = platform === "win32" ? driveSpelled(p) : null;
  return drive && !isDir(win32.resolve(drive.folder)) ? win32.resolve(drive.path) : p;
}
/** A sub-agent before it said or thought anything the run heard (`Sub`'s words fields). */
const NO_WORDS_YET = () => ({ lastThought: null, thought: "", sent: { text: 0, thinking: 0 }, wordsTimer: null, saidAt: 0, thoughtAt: 0 });
/** A background task's end as Claude says it (`task_notification`), in the agent's words for a sub-agent's end. */
const TASK_END = Object.freeze({ completed: "completed", failed: "failed", stopped: "cancelled" });
/** The title of a question's own card, where it belongs to no call the run draws: by what it asks. */
const ASK_CARDS = Object.freeze({ question: "Ask", plan: "Propose a plan", link: "Open a link", permission: "Permission" });
/**
 * A call the turn's end cut, as the archive answers it: the loop's words for a stop (app/agent/loop.js), which the page
 * reads as Stopped after a reload, and the same shape for a hang-up and a failure.
 */
const CUT_WORDS = Object.freeze({
  stopped: "Stopped: the developer stopped the turn while this call ran; its result was not kept.",
  forced: "Stopped: the developer force-stopped the turn while this call ran; its result was not kept.",
  aborted: "Stopped: the client disconnected while this call ran; its result was not kept.",
  failed: "Failed: the turn ended while this call ran; its result was not kept.",
  done: "No result: the agent ended its turn without one.",
});

/** One line of a title, clipped. @param {unknown} v */
const oneLine = (v) => clip(v, 90);
/**
 * A sub-agent's kind as its agent names it (Cursor's `subagentType`: a word, a custom one, or its SDK's
 * `{ kind, name }`), or "" when it names none. @param {unknown} v
 */
const kindWord = (v) => {
  const o = /** @type {any} */ (v);
  const w = typeof v === "string" ? v : o && typeof o === "object" ? o.name || o.custom || o.kind : "";
  return w && w !== "unspecified" ? String(w) : "";
};
/** A tool result's words, whatever shape the agent gave them in. @param {unknown} c @returns {string} */
const textOf = (c) => {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(textOf).filter(Boolean).join("\n");
  if (c && typeof c === "object") {
    const o = /** @type {any} */ (c);
    if (o.type === "text") return String(o.text ?? "");
    if (o.type === "content") return textOf(o.content);
    // A tool Claude's ToolSearch loaded, by its name: the result is those names, and no text.
    if (o.type === "tool_reference") return String(o.tool_name ?? "");
  }
  return "";
};
/**
 * A result an agent showed as one Markdown code block (Qoder fences a read and a command's output): its code, as the
 * card draws a result. Anything else as it is. @param {string} s
 */
const unfenced = (s) => {
  const m = /^(`{3,})[^\n`]*\n([\s\S]*?)\n?\1\s*$/.exec(s);
  return m ? m[2] : s;
};

/**
 * @typedef {object} Call  one tool call of the turn, as the translator follows it
 * @property {string} id
 * @property {string} toolName  the tool's own name, when the agent says it (Claude's `_meta.claudeCode.toolName`)
 * @property {string} kind  ACP's kind of the call
 * @property {string} title  the agent's title for it
 * @property {string} status
 * @property {any} input
 * @property {any[]} locations
 * @property {boolean} started
 * @property {boolean} ended
 * @property {boolean} ok
 * @property {number} round
 * @property {number} at
 * @property {{ kind: string, title: string, subject: string } | null} card
 * @property {string} name
 * @property {Sub | null} sub  the sub-agent whose call it is, or null for the agent's own
 * @property {boolean} nested  an event of it named a sub-agent or a call it nests under, the run knowing that one or not
 * @property {string} outPending
 * @property {any} outTimer
 * @property {string} output  everything the command said
 * @property {number | null} exitCode
 * @property {string} result  the result's words as the agent showed them
 * @property {boolean} cut  the turn's end cut it: the archive answers it in the loop's words
 * @property {string} file  the file it made (an image an agent generated)
 * @property {({ data: string } | { path: string })[]} pictures  the pictures its result handed the model, as its newest
 *   content gave them (HarnessV4_Tasks U9)
 * @property {string} model  the model its sub-agent ran on, where the agent names it only at the call's end (Cursor)
 * @property {boolean} asked  announced in its permission's question, so whole: the agent is about to run it
 */
/** @typedef {{ id: string, round: number }} OwnCall  one of the agent's calls on the run: its card's id, its round */
/**
 * @typedef {object} Sub  one sub-agent of the turn: the call that launched it, which others nest under, or its own
 *   session where no call of the run's stands for it
 * @property {string} id  the call that launched it, or its session
 * @property {string} stub  the card's id on the run: the call it hangs off, which is the sub-agent's own id when it is
 *   a call (Cursor's task)
 * @property {Sub | null} top  the sub-agent whose card carries it (a sub-agent's own sub-agent is a call on its card)
 * @property {number} round
 * @property {number} at
 * @property {{ kind: string, title: string, subject: string }} card
 * @property {string | null} lastMsg
 * @property {string} words  its newest message's words: what it reports
 * @property {string | null} lastThought  the message its newest thinking belongs to
 * @property {string} thought  its newest thinking, where its agent sends any
 * @property {{ text: number, thinking: number }} sent  how much of its newest message's words, and of its newest
 *   thinking, the run has heard
 * @property {any} wordsTimer
 * @property {number} saidAt  how many calls it had made when its newest message began
 * @property {number} thoughtAt  the same, for its newest thinking
 * @property {number} calls
 * @property {boolean} ended
 * @property {boolean} background  its call came back at once (Claude's sub-agent launched in the background): its card
 *   runs on until its task ends
 * @property {boolean} closed  its end ended its card on the run (one launched in the background): the call's own end
 *   says nothing more
 * @property {boolean} raw  Claude's raw messages say its words and thinking whole: its session's chunks repeat them
 * @property {string} model  the model its messages name, where they name one (Claude's)
 * @property {number} held  what it holds, in tokens, as its agent last said (Claude's task progress); 0 where none did
 * @property {string} plan  its own plan as its card last drew it (HarnessV3-ACP AC3-4)
 */

/**
 * @param {object} o
 * @param {(evt: Record<string, any>) => void} o.publish  one run event onto the run's topic
 * @param {{ breakBlock: () => number, thought?: (tokens: number) => void }} o.sink  the reply: ends its open block where a round begins, and answers how many
 *   blocks it has said so far — the round's `blocksBefore`
 * @param {boolean} [o.rawMessages]  the agent sends its raw messages beside its updates (Claude): a call is drawn once
 *   its own message names it, which says the model call it came from and carries its whole input
 * @param {string | null} [o.root]  the agent's working folder: a file card names its file relative to it
 * @param {number} [o.previewChars]  how much of a result `tool-end` carries (observability.runEvents.toolPreviewChars)
 * @param {import("./turn-tree.js").TurnTree | null} [o.tree]  the turn's working-tree snapshots: after a round that
 *   wrote, the places it wrote in and what it changed there, as the loop takes them (HarnessV4_Git_Plan step 1); null
 *   when none is taken
 * @param {boolean} [o.saysPlace]  the run says where the agent works now, as its own calls start (`place`,
 *   HarnessV4_Git_Plan §11): a chat's own turn, not a sub-agent's
 * @param {(text: string) => void} [o.note]  a line for the request's record
 * @param {string} [o.agent]  the agent's name, which its own compactions' marks say
 * @param {((pictures: ({ data: string } | { path: string })[]) => { images: any[], notKept: { count: number, why: string } | null }) | null} [o.keepImages]
 *   the run log's keeper of the pictures a call handed the model (HarnessV4_Tasks U9): its `tool-end` names what it kept
 * @param {((call: { kind: string, title: string, rawInput: any, locations: any[], name: string }) => boolean) | null} [o.reads]
 *   whether the chat's gate reads a call as only reading — a command, an MCP server's tool —, asked of a call the
 *   agent's own message names (Claude's): such a call's start says no `command`. None, and every command and MCP
 *   call says one
 * @param {() => number} [o.now]
 */
export function createAgentRun({ publish, sink, rawMessages = false, root = null, previewChars = 2000, tree = null, saysPlace = false, note = () => {}, agent = "", keepImages = null, reads = null, now = Date.now }) {
  let round = 0;
  // Where the agent works now (GW-D64): its shell may stand where an earlier command left it, so a call that names no
  // folder says nothing.
  const nowIn = saysPlace && root ? createNowIn({ root, publish, fresh: false }) : null;
  /** The model call the open round is, when the agent names its calls (`messageId`). @type {string | null} */
  let roundMsg = null;
  /** Whether the agent ever named a model call: an agent that never does starts a round where words follow tools. */
  let namesCalls = false;
  let roundText = "";
  let roundThinking = "";
  /** The open round's own calls, by id: an agent that names no model call starts a round where words follow them. */
  /** @type {string[]} */
  let roundCalls = [];
  /**
   * The agent took the person's words in the open round (AC3-1): what it does next answers them, in a round of its
   * own. For an agent that names no model call, the first NEW output: words of another item than the one it was
   * saying then (`itemId`, Codex's; null when it names none), or a call it starts. Undefined while none was taken.
   * @type {string | null | undefined}
   */
  let steeredFrom = undefined;
  /**
   * Filament prompted the agent again in its turn (`prompted`): what it says or does next answers that prompt, a model
   * call of its own, in a round of its own — whether or not the agent names its calls.
   */
  let anew = false;
  /** The item the turn's latest words came from, where the agent names its items (Codex). @type {string | null} */
  let lastItem = null;
  let textBlocks = 0;
  let state = "idle";
  /** The thinking a turn-state last said the model call had done, in Claude's estimate of tokens; 0 before one. */
  let thinkingSaid = 0;
  // The turn's thinking as Claude estimates it: the blocks it has finished, and the one it is in (`thinkingTokens`).
  const thinking = { done: 0, block: 0 };
  let wroteSinceSnapshot = false;
  /**
   * What the open round wrote, for its record: the files its writing calls named (absolute), whether a command ran,
   * and what its team's hands wrote (`wrote`).
   * @type {{ own: Set<string>, command: boolean, writes: import("./turn-tree.js").Writes[] }}
   */
  let roundWrote = { own: new Set(), command: false, writes: [] };
  /** Each place's failure to snapshot, said once a turn, and once more where its snapshot then ran past its time. @type {Set<string>} */
  const treeTold = new Set();
  /** @type {Promise<unknown>} */
  let snapshots = Promise.resolve();
  let snapshotCount = 0;
  /** @type {Map<string, Call>} */
  const calls = new Map();
  /** Every round's words and calls, for the archive of an agent that sends no raw messages. */
  /** @type {{ n: number, text: string, calls: string[] }[]} */
  const rounds = [];
  /**
   * The person's words the agent took into its running turn (HarnessV3-ACP AC3-1), for the archive: after the round
   * open then, and after the raw messages Claude had sent by then. `images`: the pictures that went with them
   * (HarnessV4_Tasks C22).
   * @type {{ round: number, at: number, text: string, images?: import("../services/runs.js").SteerImage[] }[]}
   */
  const steers = [];
  /**
   * A steer's blocks in the archive: its pictures, then its words, as the page builds a message of its own — so the
   * user turn they make ends with the words, by which the next prompt counts it as seen (`seenWithin`).
   * @param {(typeof steers)[number]} s
   */
  const steerBlocks = (s) => [...(s.images || []).map((p) => imageBlock(p.mediaType, p.data)), ...(s.text || !s.images?.length ? [{ type: "text", text: s.text }] : [])];
  /** The turn's sub-agents, each by the call that launched it and by its session, where it has both (`sessionOfCall`). */
  /** @type {Map<string, Sub>} */
  const subs = new Map();
  /**
   * What Claude's raw messages said of each call: its model call, its own name and whole input, and the sub-agent
   * whose message it was; then its result.
   */
  /** @type {Map<string, { msg: string, name: string, input: any, sub: Sub | null }>} */
  const rawCalls = new Map();
  /** The call that launched each task Claude runs beside its work, by the task's id (its `task_started`). */
  /** @type {Map<string, string>} */
  const taskCalls = new Map();
  /** @type {Map<string, { text: string, isError: boolean }>} */
  const rawResults = new Map();
  /** The main thread's raw messages in order, an assistant's merged by model call: the archive's copy (AC1-8). */
  /** @type {{ role: "assistant" | "user", msg?: string, content: any[] }[]} */
  const rawThread = [];
  /** @type {Record<string, number>} */
  const rawCounts = {};
  let lastPlan = "";
  /** The agent's count of its context as the run last published it: its tokens, its window, whether it was counted. */
  let lastHeld = "";
  /**
   * The agent's newest model call of its own, its prompt as the provider counted it (`round-cache`): the Cache
   * instrument's last request while the turn runs, and the turn's after it — the record's own columns sum every call —,
   * with the lifetime its markers asked for where its provider said one (`ttlMs`). Null where no call of its own said
   * its cache numbers.
   * @type {{ input: number, cacheRead: number, cacheWrite: number, ttlMs?: number } | null}
   */
  let lastModelCall = null;
  /** The call and the figures `round-cache` last said: a call is said once, whatever its messages repeat. */
  let lastModelCallKey = "";
  /**
   * The cache lifetime the agent's own markers asked for, as its provider's usage split its writes (Claude's
   * `cache_creation`): an hour's where any write was an hour's. Kept from call to call, as a call that only reads says
   * nothing of it; 0 until one says.
   */
  let callTtlMs = 0;
  /** The agent's compactions by id, as far as each has come: its start published, its end held, its mark published. */
  /** @type {Map<string, "started" | "ended" | "marked">} */
  const compactions = new Map();
  /**
   * The agent's compaction that has ended, held for the facts that may follow its end (Claude's adapter sends its
   * figures in an update after it): marked before the agent's next piece of work, or at the turn's end.
   * @type {{ id: string, round: number, facts: Record<string, any> } | null}
   */
  let compactionEnded = null;
  /**
   * The agent's compactions of its own context that completed, in order, as the archive needs them: the summary each
   * handed over, whole (none for an agent that hands none over), the last call the agent had made by then (`cutAfter`,
   * null where it compacted before any) — the work up to that call's results is what the summary stands for — and
   * whether its session held less than the whole chat (`partial`), whose summary is not the chat's.
   * @type {{ id: string, summary: string, cutAfter: string | null, partial: boolean, manual: boolean, before: number, after: number, ms: number }[]}
   */
  const ownCompactions = [];
  /**
   * The agent's questions to the person still open (HarnessV3-ACP AC2-4), by their id: the round each is in, the call
   * it belongs to, or its own card where it belongs to none, and when it was asked.
   * @type {Map<string, { round: number, call: string | null, own: { kind: string, title: string, subject: string } | null, at: number }>}
   */
  const asks = new Map();
  /** The turn's end, once (`close`): after it, what the agent still sends is no one's to see. @type {Promise<void> | null} */
  let closing = null;
  /** How the turn ended: the archive's words for a call it cut. */
  let endedAs = { status: "", forced: false };

  /** A file's path inside the working folder, as the snapshots name it. @param {string} p */
  const inRoot = (p) => {
    const at = p ? hostPath(p) : p;
    if (!root || !at || !isAbsolute(at)) return p;
    const r = relative(root, at);
    return r && r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r) ? r.split(sep).join("/") : p;
  };

  /** @param {string} to @param {string} why @param {{ woke?: true }} [more]  woke: said even where the state stands (`prompted`) */
  const go = (to, why, more = {}) => {
    if (to === state && !more.woke) return;
    publish({ type: "turn-state", from: state, to, why, ...more });
    state = to;
    thinkingSaid = 0;
  };

  /**
   * Claude's estimate of what its model call has thought so far (its `thinking_tokens`: the running total of the
   * thinking block, where the stream carries no words of it), said as the turn's state while the main thread thinks
   * (HarnessV3-FailurePoints §5.1 item 2) — not while a call runs, whose sub-agent's it would be. Said again once it has
   * grown by a quarter, a hundred tokens at least: a long think is a few dozen events, not one per frame. The reply
   * hears each one, as the turn's total: an estimate runs up from nothing in each block, so a smaller one opens the
   * next (HarnessV4_Tasks B10).
   * @param {number} n
   */
  const thinkingTokens = (n) => {
    if (!(n > 0) || state === "acting" || state === "waiting") return;
    if (n < thinking.block) thinking.done += thinking.block;
    thinking.block = n;
    sink.thought?.(thinking.done + n);
    if (n < thinkingSaid) thinkingSaid = 0;
    if (thinkingSaid && n < thinkingSaid + Math.max(100, thinkingSaid / 4)) return;
    publish({ type: "turn-state", from: state, to: "planning", why: "thinking", tokens: n });
    state = "planning";
    thinkingSaid = n;
  };

  const closeRound = () => {
    if (!round) return;
    if (roundThinking) publish({ type: "round-thinking", round, thinking: roundThinking });
    if (roundText) {
      publish({ type: "round-text", round, text: roundText, block: textBlocks });
      textBlocks++;
    }
    rounds.push({ n: round, text: roundText, calls: roundCalls });
    roundThinking = "";
    roundText = "";
    roundCalls = [];
    if (wroteSinceSnapshot) takeSnapshot(round);
  };

  /** @param {string | null} msg */
  const openRound = (msg) => {
    closeRound();
    round++;
    roundMsg = msg;
    steeredFrom = undefined;
    publish({ type: "round-start", round, blocksBefore: sink.breakBlock() });
    go("planning", `round ${round}`);
  };

  /**
   * The main thread goes on to a call (a tool, a sub-agent, a question of its own): its model call's words are over,
   * so the reply's open block ends here, not where its next model call begins. The page's caret is a block that still
   * takes words (HarnessV4_Tasks U4, V4-D137), as the loop's ends with its model call. Words the round says after it
   * open a block of their own. A sub-agent's call never ends it: the main thread may still be writing.
   */
  const callStarts = () => void sink.breakBlock();

  /**
   * The round this output belongs to, opened when it is a new model call's: a new `messageId` says so; for an agent
   * that names no call, words after tool calls do (§4.2), and the first new output after the person's words it took
   * (`steeredFrom`, AC3-1).
   * @param {string | null} msg @param {boolean} words  the output is words (text or thinking), not a tool call
   * @param {string | null} [item]  the item the words come from, where the agent names its items
   */
  const roundFor = (msg, words, item = null) => {
    if (msg) namesCalls = true;
    if (!round || anew) {
      anew = false;
      return openRound(msg);
    }
    if (msg && roundMsg && msg !== roundMsg) return openRound(msg);
    if (!msg && !namesCalls && ((words && roundCalls.length > 0) || (steeredFrom !== undefined && (!words || item !== steeredFrom)))) return openRound(null);
    if (msg && !roundMsg) roundMsg = msg;
  };

  /** @param {number} r */
  const takeSnapshot = (r) => {
    wroteSinceSnapshot = false;
    const wrote = roundWrote;
    roundWrote = { own: new Set(), command: false, writes: [] };
    if (!tree) return;
    const t = tree;
    // Queued behind the last one: each round's record follows the one before it in every place.
    snapshots = snapshots
      .then(() => t.take(r, { own: [...wrote.own], command: wrote.command, writes: wrote.writes }))
      .then((s) => {
        for (const e of s.errors) {
          const told = e.timedOut ? `${e.place}\ttimed out` : e.place;
          if (treeTold.has(told)) continue;
          treeTold.add(told);
          note(`acp: no working-tree snapshot of ${e.place} (${e.error})`);
        }
        const refOf = new Map(s.snapshots.map((x) => [x.place, x.ref]));
        for (const row of s.rows) publish({ type: "snapshot", ...row, round: r, ref: refOf.get(row.place) || null });
        if (s.snapshots.length) {
          snapshotCount += s.snapshots.length;
          note(`acp: working tree snapshotted after round ${r} (${s.snapshots.map((x) => x.ref).join(", ")})`);
        }
      })
      .catch((/** @type {any} */ e) => note(`acp: no working-tree snapshot (${String(e?.message || e).slice(0, 160)})`));
  };

  /** The tool's own name, where the agent says it: Claude's update, or its own message. @param {Call} c */
  const ownName = (c) => c.toolName || rawCalls.get(c.id)?.name || "";
  /**
   * A call of Filament's own tools: the worker a team's call launches is the registry's to draw, under the call (AC6-7),
   * so its card is never a sub-agent of the agent's own.
   * @param {Call} c
   */
  const filaments = (c) => ownName(c).startsWith("mcp__filament__");
  /** A call a call over MCP by that name may have come in: the agent's own, running, not yet answered for. @param {Call} c @param {string} name */
  const claimable = (c, name) => !c.sub && !c.ended && !claimed.has(c.id) && filaments(c) && nameOf(c) === name;
  /** A call of Filament's tool by that name still running, the agent's own or a sub-agent's, answered for or not. @param {Call} c @param {string} name */
  const runsAs = (c, name) => !c.ended && filaments(c) && nameOf(c) === name;
  /** The call a call over MCP came in, drawn now if it was not yet. @param {Call} c @returns {OwnCall} */
  const claim = (c) => {
    claimed.add(c.id);
    start(c);
    return { id: c.id, round: c.round };
  };
  /** The name a call's card reads it by: the tool's own, Filament's toolset's without its prefix, else its kind's. @param {Call} c */
  const nameOf = (c) => {
    const own = ownName(c);
    if (own) return own.replace(/^mcp__filament__/, "");
    return /** @type {Record<string, string>} */ (KIND_NAMES)[c.kind] || c.kind || "tool";
  };

  /** What the agent asked for: Claude's own message's input, else the call's. @param {Call} c */
  const inputOf = (c) => rawCalls.get(c.id)?.input ?? c.input;

  /**
   * A call's card: the loop's, from its name and input; where the input names no target, its location or its title
   * (a path whole until it is made relative to the working folder: the page cuts it where it is drawn; a fetch by the
   * address its title names). A call the agent names no tool for, of a kind the vocabulary has no tool for, reads by
   * its kind's word (KIND_WORDS), else by the agent's own title.
   * @param {Call} c
   */
  const cardFor = (c) => {
    const name = nameOf(c);
    const input = inputOf(c);
    const title = String(c.title || "").replace(/^`|`$/g, "").trim();
    const where = c.locations?.find((l) => l?.path)?.path;
    let card = cardOf(name, input && typeof input === "object" ? input : null);
    const word = ownName(c) ? "" : /** @type {Record<string, string>} */ (KIND_WORDS)[c.kind] || "";
    if (word) card = { kind: "other", title: word, subject: "" };
    else if (card.kind === "other" && !ownName(c) && title) return { kind: "other", title: oneLine(title), subject: where ? inRoot(String(where)) : "" };
    const path = !!word || FILE_CARDS.has(card.kind);
    // An MCP call's name says its tool and its server, Filament's own too; an agent's title for one only restates them
    // (Claude's is the name, Gemini CLI's and Qoder's "<tool> (<server> MCP Server)"), so its card is the loop's.
    const viaMcp = ownName(c).startsWith("mcp__");
    if (!viaMcp && (!card.subject || card.subject === name)) {
      const said = title.toLowerCase().startsWith(`${card.title.toLowerCase()} `) ? title.slice(card.title.length + 1) : title;
      const address = card.kind === "web" ? /https?:\/\/\S+/.exec(said)?.[0] || "" : "";
      card = { ...card, subject: where ? String(where) : path ? squash(said || card.subject) : oneLine(address || said || card.subject) };
    }
    return path ? { ...card, subject: inRoot(card.subject) } : card;
  };

  /**
   * Whether a call is whole enough to draw. Claude's: once its own message came, which names its model call and
   * carries its whole input. Another agent's: once its permission's question announced it, or it left `pending`, or
   * its title names a target — a sub-agent's once it left `pending`, since an agent that streams a call's input as
   * its model writes it (Cursor) has the whole prompt only by then.
   * @param {Call} c
   */
  const ready = (c) => rawCalls.has(c.id) || (!rawMessages && (c.asked || (announceable(c.title, c.kind, c.status) && !(c.status === "pending" && cardFor(c).kind === "subagent"))));

  /**
   * Whether a call is a command that could have made a commit, which its start says (`command`) for the commit watch
   * (app/watchers/commits.js): a command the agent runs — a shell's card, its own or Filament's Bash hand's, or the
   * kind `execute` where it names no tool —, a call of an MCP server's tool, and a button or a tool of a Space's app
   * pressed through Filament's space tool. Not one the chat's gate reads as only reading (`reads`): asked of a call the agent's own message names
   * (Claude's), which carries the tool's own name and its whole input as the gate reads a request for it — any other
   * agent's command is one, its input at its start being its title or a part. A command started in the background
   * through Filament is none here: its time is the hands' to say.
   * @param {Call} c @param {{ kind: string, title: string, subject: string }} card
   */
  const commands = (c, card) => {
    try {
      const input = inputOf(c);
      const runs = card.kind === "shell" && card.title === "Run";
      if (filaments(c)) {
        // Filament's own: its Bash hand runs a command as the agent's own shell does, and is read as that one is — by
        // the hand's own name, as the gate reads a request for a command; a call through its mcp tool to another
        // server's is one, unread; of the rest, a press alone.
        if (runs) return !(rawCalls.has(c.id) && reads?.({ kind: "execute", title: c.title, rawInput: input, locations: c.locations, name: nameOf(c) }));
        if (nameOf(c) !== "space") return card.kind === "mcp";
        const f = pressFieldsOf(spaceFields(input));
        return !!f && [f.press, f.tool].some((x) => x != null && x !== "");
      }
      if (c.kind !== "execute" && !runs && card.kind !== "mcp") return false;
      return !(rawCalls.has(c.id) && reads?.({ kind: c.kind, title: c.title, rawInput: input, locations: c.locations, name: ownName(c) }));
    } catch {
      return true;
    }
  };

  /**
   * The files a call says it writes as it starts (`edits`), for the keeper of a chat's own times
   * (app/watchers/own-times.js): a call that writes by its card or its kind, as its end's `writes` reads one — a
   * command aside, whose while is `command`'s to say — names the files of its locations and of its input, absolute,
   * one named from the working folder read from `root`. `true` where it names none as it starts, or one that
   * cannot be placed (`editsSaid`). Null for a call that writes no file.
   * @param {Call} c @param {{ kind: string, title: string, subject: string }} card
   * @returns {string[] | true | null}
   */
  const edits = (c, card) => {
    if (card.kind === "shell" || c.kind === "execute" || !(WRITING_CARDS.has(card.kind) || WRITING_KINDS.has(c.kind))) return null;
    try {
      const input = inputOf(c);
      const named = [c.file, ...c.locations.map((l) => l?.path), input?.file_path, input?.path, input?.notebook_path].filter((p) => typeof p === "string" && p);
      return editsSaid(named.map((p) => hostPath(p)).map((p) => (isAbsolute(p) ? resolve(p) : root ? resolve(root, p) : null)));
    } catch {
      return true;
    }
  };

  /** @param {Call} c */
  const start = (c) => {
    if (c.started) return;
    c.started = true;
    c.at = now();
    c.card = cardFor(c);
    c.name = nameOf(c);
    // A command's card reads it without its shell (AC1-6); the call's own line rides as its args, as the loop's does,
    // and an MCP call's input as its JSON, which its card shows (nothing, when it took none). Filament's envelope tool
    // rides as the loop's line of it: a letter, an answer, a picture or the envelopes it opens, which its row reads.
    const input = inputOf(c);
    const command = c.card.kind === "shell" ? input?.command : null;
    const mcp = c.card.kind === "mcp" ? (input && typeof input === "object" && Object.keys(input).length ? JSON.stringify(input) : "") : null;
    const envelope = filaments(c) && c.name === "envelope" ? envelopeSummary(input && typeof input === "object" ? input : {}) : null;
    const args = redactSecrets(cut(typeof command === "string" ? command : (envelope ?? mcp ?? c.card.subject), 160));
    const writes = edits(c, c.card);
    if (c.sub) {
      const top = c.sub.top || c.sub;
      c.round = top.round;
      top.calls++;
      // What it wrote before the call is on the run before the call.
      flushWords(top);
      publish({ type: "subagent-tool-start", round: top.round, parent: top.stub, id: c.id, name: c.name, args, card: c.card, ...(commands(c, c.card) ? { command: true } : {}), ...(writes ? { edits: writes } : {}) });
      return;
    }
    roundFor(rawCalls.get(c.id)?.msg || null, false);
    c.round = round;
    roundCalls.push(c.id);
    callStarts();
    publish({ type: "tool-start", round, name: c.name, args, card: c.card, id: c.id, ...(commands(c, c.card) ? { command: true } : {}), ...(writes ? { edits: writes } : {}) });
    void nowIn?.saw(round, { id: c.id, name: c.name, input, locations: c.locations });
    go("acting", c.card.title);
    // Another agent's sub-agent is a call others nest under (`parentToolCallId`): its card is a sub-agent's.
    if (c.card.kind === "subagent" && !filaments(c)) {
      const input = inputOf(c) ?? {};
      subs.set(c.id, newSub({ id: c.id, stub: c.id, top: null, round, at: c.at, card: c.card }));
      // Its kind, as Cursor names it or as Claude does.
      const kind = kindWord(input.subagentType ?? input.subagent_type);
      publish({ type: "subagent-start", round, parent: c.id, description: c.card.subject, ...(kind ? { agent: kind } : {}), prompt: redactSecrets(cut(String(input.prompt ?? ""), SUBAGENT_CHARS)) });
    }
  };

  /** @param {Call} c */
  const flushOutput = (c) => {
    if (c.outTimer) clearTimeout(c.outTimer);
    c.outTimer = null;
    if (!c.outPending || !c.started) return;
    const text = c.outPending.slice(-OUTPUT_TAIL_CHARS);
    c.outPending = "";
    publish({ type: "tool-output", round: c.round, id: c.id, text });
  };
  /** @param {Call} c @param {string} text */
  const addOutput = (c, text) => {
    c.output += text;
    c.outPending = (c.outPending + text).slice(-OUTPUT_TAIL_CHARS);
    if (!c.outTimer && c.started) {
      c.outTimer = setTimeout(() => flushOutput(c), OUTPUT_FLUSH_MS);
      c.outTimer.unref?.();
    }
  };

  /**
   * @param {Call} c
   * @param {{ ok: boolean, stopped?: boolean, notRun?: "declined" | "refused" | "stopped", why?: string }} how  `notRun`:
   *   its permission's answer kept it from running (`why`: what refused it), or the turn stopped while it was asked
   */
  const end = (c, how) => {
    if (c.ended) return;
    if (!c.started) start(c);
    flushOutput(c);
    c.ended = true;
    const raw = rawResults.get(c.id);
    // A sub-agent's own call that brought no result of its own reports what the sub-agent said.
    if (!c.output && !c.result) c.result = subs.get(c.id)?.words || "";
    const result = raw ? raw.text : c.output || c.result;
    c.ok = raw ? how.ok && !raw.isError : how.ok;
    // What the agent showed of the result, counted: nothing to count when it showed none (Claude's raw result is what
    // the model read, an empty one too). A call that never ran counts none and shows none, as the loop's declined and
    // refused calls.
    const shown = !!raw || !!result;
    // The pictures it handed the model, kept beside the run files for its card (HarnessV4_Tasks U9): a file the agent
    // named by a path in its folder (Codex's imageView) is read from there. A call that never ran handed none.
    const kept = !how.notRun && c.pictures.length && keepImages ? keepImages(c.pictures.map((p) => ("path" in p ? { path: root && !isAbsolute(p.path) ? join(root, p.path) : hostPath(p.path) } : p))) : null;
    // A call that writes or runs a command, by its card or its kind: its end says so, so a sub-agent's run knows it
    // changed something whatever the agent names the tool (the review of 46a624ab4).
    const writes = !how.notRun && (WRITING_CARDS.has(String(c.card?.kind)) || WRITING_KINDS.has(c.kind));
    /** @type {Record<string, any>} */
    const fields = {
      name: c.name,
      ok: c.ok,
      ms: now() - c.at,
      id: c.id,
      card: c.card,
      ...(writes ? { writes: true } : {}),
      ...(how.notRun ? { chars: 0 } : shown ? { chars: result.length } : {}),
      ...(!how.notRun && result ? { preview: cut(result, previewChars) } : {}),
      ...(c.exitCode != null ? { exitCode: c.exitCode } : {}),
      ...(how.stopped ? { stopped: true } : {}),
      ...(how.notRun === "declined" ? { declined: true } : how.notRun === "refused" ? { refused: true, ...(how.why ? { reason: how.why } : {}) } : how.notRun === "stopped" ? { notRun: true } : {}),
      ...(c.file ? { file: inRoot(c.file) } : {}),
      ...(kept?.images.length ? { images: kept.images } : {}),
      ...(kept?.notKept ? { imagesNotKept: kept.notKept } : {}),
    };
    if (writes) {
      wroteSinceSnapshot = true;
      // Its own files are the ones its call named (HarnessV4_Git_Plan GWC-9); what changed while a command ran is not.
      if (c.card?.kind === "shell" || c.kind === "execute") roundWrote.command = true;
      else for (const said of [c.file, ...c.locations.map((l) => l?.path)]) {
        const p = typeof said === "string" && said ? hostPath(said) : "";
        if (p && (isAbsolute(p) || root)) roundWrote.own.add(isAbsolute(p) ? p : join(/** @type {string} */ (root), p));
      }
    }
    const sub = subs.get(c.id);
    if (sub && !sub.ended && !sub.background) endSub(sub, c.ok ? "completed" : how.stopped ? "cancelled" : "failed", result);
    if (c.sub) {
      const top = c.sub.top || c.sub;
      publish({ type: "subagent-tool-end", round: top.round, parent: top.stub, ...fields });
      return;
    }
    // A sub-agent launched in the background came back at once: its card runs on, and its task's end ends it, once.
    if (!sub?.background || (sub.ended && !sub.closed)) publish({ type: "tool-end", round: c.round, ...fields });
    if (![...calls.values()].some((x) => x.started && !x.ended && !x.sub)) go("observing", c.card?.title || c.name);
  };

  /** @param {Sub} sub @param {string} how  the agent's word for its end @param {string} [report] */
  const endSub = (sub, how, report = sub.words) => {
    if (sub.ended) return;
    flushWords(sub);
    sub.ended = true;
    const status = /** @type {Record<string, string>} */ (SUBAGENT_STATUS)[how] || "failed";
    const ok = status === "done";
    const ms = now() - sub.at;
    const said = String(report || "");
    const own = calls.get(sub.stub);
    if (sub.top) {
      // A sub-agent's own sub-agent is a call on its card: where a call of the run's stands for it, the row ends once,
      // with whichever came first of its end and the call's.
      if (own?.ended) return;
      if (own) own.ended = true;
      publish({ type: "subagent-tool-end", round: sub.top.round, parent: sub.top.stub, name: own?.name || "agent", ok, ms, id: sub.stub, card: sub.card, chars: said.length, ...(said ? { preview: cut(said, previewChars) } : {}) });
      return;
    }
    const model = own?.model || sub.model;
    publish({ type: "subagent-end", round: sub.round, parent: sub.stub, status, ok, ms, toolCalls: sub.calls, ...(model ? { model } : {}), ...(said ? { report: cut(said, SUBAGENT_CHARS) } : {}) });
    // A sub-agent with no call of its own on the run (its session stands for it), and one launched in the background,
    // whose call came back at once: its card ends with it.
    if (own && !sub.background) return;
    sub.closed = true;
    publish({ type: "tool-end", round: sub.round, name: own?.name || "agent", ok, ms, id: sub.stub, card: sub.card, chars: said.length, ...(said ? { preview: cut(said, previewChars) } : {}), ...(status === "stopped" ? { stopped: true } : {}) });
  };

  /**
   * A sub-agent's own plan, whole on each change, on its card (HarnessV3-ACP AC3-4): never the turn's checklist. A
   * sub-agent's own sub-agent is a call on its parent's card, with no card of its own to draw one on.
   * @param {Sub | undefined} sub @param {{ text: string, status: string }[]} items @param {string} json
   */
  const subPlan = (sub, items, json) => {
    if (!sub || sub.top || !items.length || json === sub.plan) return;
    sub.plan = json;
    publish({ type: "subagent-plan", round: sub.round, parent: sub.stub, items });
  };

  /**
   * What a sub-agent wrote since the run last heard, onto the run (HarnessV4_Tasks E15 step 5, AG-154): the piece its
   * newest message gained, and its thinking's where its agent sends any, so its thread shows it at work and a long
   * message costs the log its own length once. A sub-agent's own sub-agent is a call on its parent's card: nothing of
   * its words is said.
   * @param {Sub} sub
   */
  const flushWords = (sub) => {
    if (sub.wordsTimer) clearTimeout(sub.wordsTimer);
    sub.wordsTimer = null;
    if (sub.top) return;
    for (const kind of WORD_KINDS) {
      const thinking = kind === "thinking";
      const whole = thinking ? sub.thought : sub.words;
      if (whole.length <= sub.sent[kind]) continue;
      publish({ type: "subagent-words", round: sub.round, parent: sub.stub, msg: (thinking ? sub.lastThought : sub.lastMsg) || "", ...(thinking ? { thinking: true } : {}), text: whole.slice(sub.sent[kind]) });
      sub.sent[kind] = whole.length;
    }
  };
  /** @param {Sub} sub */
  const wordsMoved = (sub) => {
    if (sub.top || sub.ended || sub.wordsTimer) return;
    sub.wordsTimer = setTimeout(() => flushWords(sub), SUBAGENT_WORDS_MS);
    sub.wordsTimer.unref?.();
  };

  /**
   * A sub-agent's words: its newest message's are what it reports. Where its agent names no message (Cursor's task),
   * a call it made since begins the next one, as its thread reads them.
   * @param {Sub} sub @param {string | null} msg @param {string} words
   */
  const subSaid = (sub, msg, words) => {
    if (msg !== sub.lastMsg || (msg == null && sub.calls !== sub.saidAt)) {
      flushWords(sub);
      sub.words = "";
      sub.sent.text = 0;
      sub.saidAt = sub.calls;
    }
    sub.lastMsg = msg;
    sub.words += words;
    wordsMoved(sub);
  };

  /** A sub-agent's thinking, where its agent sends it: a message's, as its words are. @param {Sub} sub @param {string | null} msg @param {string} words */
  const subThought = (sub, msg, words) => {
    if (msg !== sub.lastThought || (msg == null && sub.calls !== sub.thoughtAt)) {
      flushWords(sub);
      sub.thought = "";
      sub.sent.thinking = 0;
      sub.thoughtAt = sub.calls;
    }
    sub.lastThought = msg;
    sub.thought += words;
    wordsMoved(sub);
  };

  /** A sub-agent first heard of. @param {Pick<Sub, "id" | "stub" | "top" | "round" | "at" | "card">} o @returns {Sub} */
  const newSub = (o) => ({ ...o, lastMsg: null, words: "", ...NO_WORDS_YET(), calls: 0, ended: false, background: false, closed: false, raw: false, model: "", held: 0, plan: "" });

  /** A call first heard of. @param {string} id @param {Sub | null} owner  the sub-agent whose call it is @returns {Call} */
  const newCall = (id, owner) => ({ id, toolName: "", kind: "", title: "", status: "pending", input: null, locations: [], started: false, ended: false, ok: false, round: 0, at: now(), card: null, name: "", sub: owner, nested: !!owner, outPending: "", outTimer: null, output: "", exitCode: null, result: "", cut: false, file: "", pictures: [], model: "", asked: false });

  /** @param {any} ev */
  const onTool = (ev) => {
    const id = String(ev.id || "");
    if (!id) return;
    let c = calls.get(id);
    if (!c) {
      // A sub-agent's call names its session, the call that launched it, or both (Claude's).
      const owner = (ev.subagent && subs.get(String(ev.subagent))) || (ev.parentToolCallId && subs.get(String(ev.parentToolCallId))) || null;
      c = newCall(id, owner);
      calls.set(id, c);
    }
    if (ev.subagent || ev.parentToolCallId) c.nested = true;
    if (ev.toolName) c.toolName = String(ev.toolName);
    if (ev.asked) c.asked = true;
    if (ev.title) c.title = String(ev.title);
    if (ev.kind) c.kind = String(ev.kind);
    if (ev.status) c.status = String(ev.status);
    if (ev.rawInput && typeof ev.rawInput === "object" && Object.keys(ev.rawInput).length) c.input = ev.rawInput;
    if (Array.isArray(ev.locations) && ev.locations.length) c.locations = ev.locations;
    // An update's content replaces the call's (ACP), all of it: an announcement's words (Gemini CLI's explanation of a
    // command, Qoder's copy of the input) are no result once the end brings none. A diff has no words (`textOf`): the
    // snapshots count it. A call that ended keeps the result it ended with: Qoder's word on a call the bridge ended as
    // not run comes after.
    // Its pictures with it: a later content replaces them too (U9).
    if (Array.isArray(ev.content) && !c.ended) {
      c.result = unfenced(textOf(ev.content));
      c.pictures = picturesIn(ev.content);
    }
    if (ev.rawOutput != null && !c.ended && !c.result) c.result = typeof ev.rawOutput === "string" ? ev.rawOutput : textOf(ev.rawOutput) || JSON.stringify(ev.rawOutput);
    if (ev.exitCode != null) c.exitCode = Number(ev.exitCode);
    if (typeof ev.file === "string" && ev.file) c.file = ev.file;
    if (typeof ev.model === "string" && ev.model) c.model = ev.model;
    if (!c.started && ready(c)) start(c);
    const seeker = seeking.findIndex((s) => claimable(/** @type {Call} */ (c), s.name));
    if (seeker >= 0) seeking.splice(seeker, 1)[0].found(claim(c));
    const asker = asking.findIndex((s) => runsAs(/** @type {Call} */ (c), s.name));
    if (asker >= 0) asking.splice(asker, 1)[0].found(!c.nested);
    if (ev.terminalOutput?.output) addOutput(c, String(ev.terminalOutput.output));
    // A call its permission's answer kept from running (the bridge's word, not the agent's: such an agent says nothing
    // more of it), answered in the archive as the loop answers one; one the turn's stop came before is Stopped.
    if (ev.notRun === "declined" || ev.notRun === "refused" || ev.notRun === "stopped") {
      if (!c.ended) c.result = notRunWords(ev.notRun, String(ev.why || ""));
      end(c, { ok: false, notRun: ev.notRun, why: String(ev.why || ""), ...(ev.notRun === "stopped" ? { stopped: true } : {}) });
    } else if (c.status === "completed" || c.status === "failed") end(c, { ok: c.status === "completed" });
  };

  /**
   * A sub-agent's session that Claude announces for a task whose launch is a call of the turn (`taskCalls`): the two
   * are one sub-agent, drawn once, on the call's card, which the archive's copy of the turn names it by. The call is
   * drawn here where its own update has not come: Claude's adapter sends an Agent call's only with its result. A
   * sub-agent's own sub-agent is that call on its parent's card. → whether the session was such a one.
   * @param {string} id  the session @param {Sub | null} top  the sub-agent whose session announced it
   */
  const sessionOfCall = (id, top) => {
    const callId = taskCalls.get(id);
    const said = callId ? rawCalls.get(callId) : null;
    if (!callId || !said) return false;
    let c = calls.get(callId);
    if (!c) {
      c = newCall(callId, said.sub || top);
      calls.set(callId, c);
    }
    start(c);
    const owner = c.sub ? c.sub.top || c.sub : null;
    let sub = subs.get(callId);
    if (!sub && owner && c.card?.kind === "subagent") {
      sub = newSub({ id: callId, stub: callId, top: owner, round: owner.round, at: c.at, card: c.card });
      subs.set(callId, sub);
    }
    if (!sub) return false;
    sub.raw = true;
    subs.set(id, sub);
    return true;
  };

  /** @param {any} ev */
  const onSubagent = (ev) => {
    const id = String(ev.id || "");
    if (!id) return;
    if (ev.state === "spawned" || ev.state === "started") {
      if (subs.has(id)) return;
      const parent = ev.subagent ? subs.get(String(ev.subagent)) || null : null;
      const top = parent ? parent.top || parent : null;
      if (sessionOfCall(id, top)) return;
      const name = String(ev.name || ev.description || "sub-agent");
      const card = { kind: "subagent", title: "Agent", subject: oneLine(name) };
      // A sub-agent that is a call (`call`: Cursor's task, whose own updates follow under the same id) is drawn once,
      // on the call's card, and the call's end ends the card, as another agent's sub-agent call does.
      const sub = newSub({ id, stub: ev.call ? id : `sa:${id}`, top, round: top ? top.round : round, at: now(), card });
      const own = () => {
        if (!ev.call) return;
        const description = String(ev.description || "");
        const c = newCall(id, top);
        Object.assign(c, { started: true, status: "in_progress", at: sub.at, round: sub.round, card, name: "agent", input: { description: name, ...(description ? { prompt: description } : {}) } });
        calls.set(id, c);
      };
      if (top) {
        subs.set(id, sub);
        top.calls++;
        own();
        flushWords(top);
        publish({ type: "subagent-tool-start", round: top.round, parent: top.stub, id: sub.stub, name: "agent", args: redactSecrets(cut(name, 160)), card });
        return;
      }
      roundFor(null, false);
      sub.round = round;
      roundCalls.push(sub.stub);
      subs.set(id, sub);
      own();
      callStarts();
      const kind = kindWord(ev.kind);
      publish({ type: "tool-start", round, name: "agent", args: redactSecrets(cut(name, 160)), card, id: sub.stub });
      publish({ type: "subagent-start", round, parent: sub.stub, description: name, ...(kind ? { agent: kind } : {}), ...(ev.model ? { model: String(ev.model) } : {}), prompt: redactSecrets(cut(String(ev.description || ""), SUBAGENT_CHARS)) });
      go("acting", "a sub-agent");
      return;
    }
    const sub = subs.get(id);
    if (sub && /** @type {Record<string, string>} */ (SUBAGENT_STATUS)[ev.state]) endSub(sub, ev.state);
  };

  /**
   * A call the agent never announced — Claude's adapter keeps its task tools to itself (TaskCreate, TaskUpdate and
   * TodoWrite become its plan) — drawn when its result comes, in its model call's round, so the turn's calls are all on
   * the run, as the archive has them. A sub-agent's launch is not one: its session stands for it.
   * @param {string} id @param {Sub | null} owner
   */
  const unannounced = (id, owner) => {
    const said = rawCalls.get(id);
    if (!said || calls.has(id)) return;
    const c = newCall(id, owner);
    c.toolName = said.name;
    c.input = said.input;
    if (cardFor(c).kind === "subagent") return;
    calls.set(id, c);
    end(c, { ok: true });
  };

  /**
   * An agent's question to the person (HarnessV3-ACP AC2-4): on the card of the agent's own call it belongs to, else on
   * a card of its own in the open round, as a call of the round's. The page draws its form from the event, and answers
   * it by its id while the event says it waits. A team's worker's question to its lead (HarnessV3-TaskGraph-v2 TG2-D49),
   * which Filament's ask_lead raised, is its lead's to answer, in the registry: the run says it waits, in the round it
   * asked in — a sign there, so its lead's look is due at once — and its call's card is the agent's own.
   * @param {any} ev
   */
  const onAsk = (ev) => {
    if (ev.kind === "lead") {
      if (!round) openRound(null);
      const options = Array.isArray(ev.options) ? ev.options.map(String) : [];
      publish({ type: "ask", round, kind: "lead", tool: "ask_lead", question: cut(String(ev.question || ""), 400), ...(options.length ? { options } : {}), waits: true, ask: Number(ev.ask) || 0, ...(ev.plan ? { plan: true } : {}) });
      return;
    }
    const id = String(ev.id || "");
    const form = ev.form;
    if (!id || !form || asks.has(id)) return;
    const c = form.call ? calls.get(String(form.call)) : null;
    const call = c && !c.sub && !c.ended ? c : null;
    if (call && !call.started) start(call);
    /** @type {{ kind: string, title: string, subject: string } | null} */
    let own = null;
    if (!call) {
      if (!round) openRound(null);
      own = { kind: form.kind === "plan" ? "proposal" : "ask", title: /** @type {Record<string, string>} */ (ASK_CARDS)[form.kind] || "Ask", subject: oneLine(askedOf(form)) };
      roundCalls.push(`ask:${id}`);
      callStarts();
      publish({ type: "tool-start", round, name: "ask", args: redactSecrets(cut(askedOf(form), 160)), card: own, id: `ask:${id}` });
    }
    const r = call ? call.round : round;
    asks.set(id, { round: r, call: call ? call.id : null, own, at: now() });
    publish({
      type: "ask",
      round: r,
      kind: form.kind === "plan" ? "proposal" : form.kind,
      tool: call ? call.name : "ask",
      question: cut(askedOf(form), 400),
      waits: ev.waits === true,
      id,
      ...(call ? { call: call.id } : {}),
      form,
    });
  };
  /**
   * A question settled, with the person's answer in words: a card of its own ends with them. One asked before the turn
   * was continued (an outside client answered it) is settled in the round running now.
   * @param {any} ev
   */
  const onAskEnd = (ev) => {
    const id = String(ev.id || "");
    if (!id) return;
    const a = asks.get(id);
    asks.delete(id);
    const words = Array.isArray(ev.words) ? ev.words.map(String) : [];
    const outcome = String(ev.outcome || "cancelled");
    publish({ type: "ask-end", round: a ? a.round : round, id, ...(a?.call ? { call: a.call } : {}), outcome, words, ...(ev.nobody ? { nobody: true } : {}) });
    if (!a?.own) return;
    const said = words.join("\n");
    publish({ type: "tool-end", round: a.round, name: "ask", ok: outcome !== "cancelled", ms: now() - a.at, id: `ask:${id}`, card: a.own, chars: said.length, ...(said ? { preview: said } : {}), ...(outcome === "cancelled" ? { stopped: true } : {}) });
  };

  /** The ended compaction's mark, in the round it ended in: 0 before the turn's first model call. */
  const markCompaction = () => {
    if (!compactionEnded) return;
    const { id, round: r, facts } = compactionEnded;
    compactionEnded = null;
    compactions.set(id, "marked");
    publish({ type: "compaction", round: r, own: true, ...(agent ? { by: agent } : {}), ...facts });
  };
  /**
   * The agent compacting its own context (Codex's `contextCompaction`, Claude's compaction): its start is the loop's
   * `compacting`, its end the mark, with what the agent said of it — the tokens before and after, the time, a
   * /compact's, the summary it kept (HarnessV3-ACP AC5-7), or why it failed. Between them `compacting` says again how
   * much of its summary it has written (`chars`, HarnessV4_Tasks U3-5), where the agent streams it.
   * @param {any} ev
   */
  const onCompaction = (ev) => {
    if (ev.subagent) return;
    const id = String(ev.id || "");
    const was = compactions.get(id);
    // What the archive keeps of it comes with its end, or after it (Claude's adapter sends its figures then).
    if (ev.state === "completed" && !ownCompactions.some((c) => c.id === id)) ownCompactions.push({ id, summary: "", cutAfter: lastCall(), partial: false, manual: false, before: 0, after: 0, ms: 0 });
    const kept = ownCompactions.find((c) => c.id === id);
    if (kept) {
      if (ev.summary) kept.summary = String(ev.summary);
      if (ev.partial) kept.partial = true;
      if (ev.manual) kept.manual = true;
      if (Number(ev.tokensBefore) > 0) kept.before = Number(ev.tokensBefore);
      if (Number(ev.tokensAfter) > 0) kept.after = Number(ev.tokensAfter);
      if (Number(ev.ms) > 0) kept.ms = Number(ev.ms);
    }
    if (was === "marked") return;
    if (ev.written != null && !ev.state) {
      if (was === "started") publish({ type: "compacting", round, own: true, ...(agent ? { by: agent } : {}), chars: Number(ev.written) || 0 });
      return;
    }
    if (ev.state === "started") {
      if (was) return;
      compactions.set(id, "started");
      publish({ type: "compacting", round, own: true, ...(agent ? { by: agent } : {}) });
      return;
    }
    const facts = {
      ...(Number(ev.tokensBefore) > 0 ? { tokensBefore: Number(ev.tokensBefore) } : {}),
      ...(Number(ev.tokensAfter) > 0 ? { tokensAfter: Number(ev.tokensAfter) } : {}),
      ...(Number(ev.ms) > 0 ? { ms: Number(ev.ms) } : {}),
      ...(ev.manual ? { manual: true } : {}),
      ...(ev.summary ? { summary: cut(String(ev.summary), KEPT_SUMMARY_CHARS) } : {}),
      ...(ev.state === "failed" ? { result: "failed", ...(ev.error ? { error: cut(String(ev.error), 300) } : {}) } : {}),
    };
    if (was === "ended" && compactionEnded) {
      Object.assign(compactionEnded.facts, facts);
      return;
    }
    if (ev.state !== "completed" && ev.state !== "failed") return;
    markCompaction();
    compactions.set(id, "ended");
    compactionEnded = { id, round, facts };
  };

  /**
   * What the agent's context holds while it works (HarnessV3-ACP AC3-5), as the agent counts it: Claude's
   * `usage_update` (each model call, a compaction's end, the result), Codex's newest model call; or Filament's estimate
   * at each model call's end (the Cursor SDK's, `estimated`). Published when it moved, with the agent's window where
   * it names one: the meter's figure until the turn's record lands. Codex's report names its newest call's prompt too
   * (`call`), which the Cache instrument reads (`heardCall`).
   * @param {any} ev
   */
  const onUsage = (ev) => {
    if (ev.call) heardCall(ev.call);
    const tokens = Math.round(Number(ev.usage?.used));
    if (!(tokens > 0)) return;
    const window = Number(ev.usage?.size) > 0 ? Math.round(Number(ev.usage.size)) : null;
    const exact = !ev.estimated;
    const key = `${tokens}/${window}/${exact}`;
    if (key === lastHeld) return;
    lastHeld = key;
    publish({ type: "held", round, tokens, window, exact });
  };

  /**
   * One model call of the agent's own (its sub-agents' are theirs), its prompt as the provider counted it: Claude's raw
   * message, which carries its call's usage on each of its blocks, or Codex's report of its newest call. Said once per
   * call — `msg` names it where the agent does — and kept as the turn's newest. `split`: its usage's `cache_creation`,
   * where the provider split its writes by lifetime. A call whose usage carried no cache count (core/cache-facts.js
   * `saysCache`) is none of the Cache instrument's: nothing is said of it, and the newest call stays the one before.
   * @param {{ input?: unknown, cacheRead?: unknown, cacheWrite?: unknown, split?: any }} c @param {string} [msg]
   */
  const heardCall = (c, msg = "") => {
    if (!saysCache(c.cacheRead, c.cacheWrite)) return;
    const [input, cacheRead, cacheWrite] = [c.input, c.cacheRead, c.cacheWrite].map((v) => Math.max(0, Math.round(Number(v) || 0)));
    if (!(input + cacheRead + cacheWrite > 0)) return;
    const key = `${msg}/${input}/${cacheRead}/${cacheWrite}`;
    if (key === lastModelCallKey) return;
    lastModelCallKey = key;
    if (Number(c.split?.ephemeral_1h_input_tokens) > 0) callTtlMs = 3_600_000;
    else if (Number(c.split?.ephemeral_5m_input_tokens) > 0) callTtlMs = 300_000;
    lastModelCall = { input, cacheRead, cacheWrite, ...(callTtlMs ? { ttlMs: callTtlMs } : {}) };
    publish({ type: "round-cache", round, input, cacheRead, cacheWrite, ...(callTtlMs ? { ttlMs: callTtlMs } : {}) });
  };

  /** @param {any} message */
  const onRaw = (message) => {
    const type = String(message?.type || "");
    const key = rawType(message);
    rawCounts[key] = (rawCounts[key] || 0) + 1;
    const main = message?.parent_tool_use_id == null;
    // The sub-agent whose message it is, when Claude launched it with a call the run follows.
    const sub = main ? null : subs.get(String(message.parent_tool_use_id)) || null;
    const content = Array.isArray(message?.message?.content) ? message.message.content : [];
    if (type === "assistant") {
      const msg = String(message.message?.id || message.uuid || "");
      // The main thread's message names its model call: a call whose own update never comes (a sub-agent's launch,
      // which its session stands for) still lands in its round.
      if (main && msg) roundFor(msg, false);
      const u = message.message?.usage;
      if (main && u) heardCall({ input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, split: u.cache_creation }, msg);
      for (const b of content)
        if (b?.type === "tool_use" && b.id) {
          rawCalls.set(String(b.id), { msg, name: String(b.name || ""), input: b.input ?? null, sub });
          const c = calls.get(String(b.id));
          if (c && !c.started) start(c);
        }
      const model = String(message.message?.model || "");
      if (sub && model && model !== "<synthetic>") sub.model = model;
      if (sub)
        for (const b of content) {
          if (b?.type === "text" && b.text) subSaid(sub, msg, String(b.text));
          else if (b?.type === "thinking" && b.thinking) subThought(sub, msg, String(b.thinking));
        }
      const kept = content.filter((/** @type {any} */ b) => b?.type === "text" || b?.type === "tool_use");
      if (!main || !kept.length) return;
      // A model call is one message, whatever came between its blocks: Claude sends each block as it ends, and a
      // block's call runs before the next block comes.
      const own = rawThread.findLast((m) => m.role === "assistant");
      if (own?.msg === msg) own.content.push(...kept);
      else rawThread.push({ role: "assistant", msg, content: kept });
    } else if (type === "user") {
      const results = content.filter((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id);
      for (const r of results) rawResults.set(String(r.tool_use_id), { text: textOf(r.content), isError: r.is_error === true });
      // The result of a call that launched a sub-agent. One that came back at once says only that it was launched: the
      // sub-agent runs on in the background. Any other is the call's end, which Claude's adapter says no other way.
      for (const r of results) {
        const launched = subs.get(String(r.tool_use_id));
        const own = launched?.stub === String(r.tool_use_id) ? calls.get(launched.stub) : null;
        if (!launched || !own) continue;
        if (message.tool_use_result?.status === "async_launched") launched.background = true;
        else end(own, { ok: r.is_error !== true });
      }
      if (main || sub) for (const r of results) unannounced(String(r.tool_use_id), sub);
      if (!main || !results.length) return;
      const last = rawThread[rawThread.length - 1];
      if (last?.role === "user") last.content.push(...results);
      else rawThread.push({ role: "user", content: results });
    } else if (type === "system" && message.subtype === "thinking_tokens") thinkingTokens(Number(message.estimated_tokens));
    else if (type === "system" && message.subtype === "task_started") {
      if (message.task_id && message.tool_use_id) taskCalls.set(String(message.task_id), String(message.tool_use_id));
    } else if (type === "system" && message.subtype === "task_progress") {
      // What a sub-agent holds, as Claude says it with each of its calls: on the run where it moved, for its row.
      const sub = subs.get(String(message.tool_use_id || ""));
      const tokens = Math.round(Number(message.usage?.total_tokens));
      if (!sub || sub.top || sub.ended || !(tokens > 0) || tokens === sub.held) return;
      sub.held = tokens;
      publish({ type: "subagent-held", round: sub.round, parent: sub.stub, tokens });
    } else if (type === "system" && message.subtype === "task_notification") {
      // A background task's end: a sub-agent's ends its card, with its summary (its last words) as the report.
      const ended = subs.get(String(message.tool_use_id || ""));
      if (ended) endSub(ended, /** @type {Record<string, string>} */ (TASK_END)[message.status] || "failed", String(message.summary || "") || ended.words);
    }
  };

  /** The archive's answer for a call the turn's end cut, or one that never ended. */
  const cutWords = () => (endedAs.forced ? CUT_WORDS.forced : /** @type {Record<string, string>} */ (CUT_WORDS)[endedAs.status] || CUT_WORDS.done);
  /**
   * A call's result for the archive: one the turn's end cut (or that never ended) in the loop's words, whatever the
   * agent said of its interruption; else what the model read, or what the agent showed of it.
   * @param {string} id @param {any} [given]  the tool_result the model read
   */
  const answer = (id, given = null) => {
    const c = calls.get(id);
    if (c ? c.cut || !c.ended : !given) return { type: "tool_result", tool_use_id: id, content: cutWords(), is_error: true };
    if (given) return given;
    const own = /** @type {Call} */ (c);
    return { type: "tool_result", tool_use_id: id, content: own.output || own.result, ...(own.ok ? {} : { is_error: true }) };
  };
  /** The last call the agent has made so far, by its id: Claude's by its raw messages, another agent's by its rounds, the open one first. */
  const lastCall = () => {
    for (let i = rawThread.length - 1; i >= 0; i--) {
      const use = rawThread[i].role === "assistant" ? rawThread[i].content.findLast((/** @type {any} */ b) => b?.type === "tool_use" && b.id) : null;
      if (use) return String(use.id);
    }
    if (rawThread.length) return null;
    for (const made of [roundCalls, ...rounds.map((r) => r.calls).reverse()]) {
      const id = made.findLast((c) => calls.has(c));
      if (id) return String(id);
    }
    return null;
  };
  /**
   * Another agent's turn as messages: each round's words and calls, then their results, and the person's words it took
   * after that round — with the results, or a message of their own. A call the agent named no input for is kept by
   * the target its card showed (`keptCardOf`; HarnessV4_Tasks B2). @returns {any[]}
   */
  const rebuilt = () => {
    /** @type {any[]} */
    const out = [];
    /** @param {number} n */
    const heard = (n) => {
      const words = steers.filter((s) => s.round === n).flatMap(steerBlocks);
      if (!words.length) return;
      const last = out[out.length - 1];
      if (last?.role === "user") last.content.push(...words);
      else out.push({ role: "user", content: words });
    };
    heard(0);
    for (const r of rounds) {
      const own = /** @type {Call[]} */ (r.calls.map((id) => calls.get(id)).filter((c) => !!c));
      const said = r.text ? [{ type: "text", text: r.text }] : [];
      if (said.length || own.length) {
        out.push({ role: "assistant", content: [...said, ...own.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input ?? (c.card?.subject ? { input: c.card.subject } : {}) }))] });
        if (own.length) out.push({ role: "user", content: own.map((c) => answer(c.id)) });
      }
      heard(r.n);
    }
    return out;
  };
  /**
   * Claude's own conversation, every call answered — an archive never holds an open tool_use: a call the turn's end cut
   * in the loop's words, one whose result never came back with what the agent showed of it. @returns {any[]}
   */
  const answered = () => {
    const msgs = rawThread.map((m) => ({ role: m.role, content: [...m.content] }));
    // The person's words where Claude took them, the latest place first so the earlier places stay put: with the
    // results before them (a model call's calls are answered first), else a message of their own.
    /** @type {Map<number, any[]>} */
    const byPlace = new Map();
    for (const s of steers) byPlace.set(s.at, [...(byPlace.get(s.at) || []), ...steerBlocks(s)]);
    for (const at of [...byPlace.keys()].sort((a, b) => b - a)) {
      const words = /** @type {any[]} */ (byPlace.get(at));
      const before = msgs[at - 1];
      const called = before?.role === "assistant" && before.content.some((/** @type {any} */ b) => b?.type === "tool_use");
      const into = before?.role === "user" ? before : called && msgs[at]?.role === "user" ? msgs[at] : null;
      if (into) into.content.push(...words);
      else msgs.splice(at, 0, { role: "user", content: words });
    }
    for (let i = 0; i < msgs.length; i++) {
      const uses = msgs[i].role === "assistant" ? msgs[i].content.filter((/** @type {any} */ b) => b?.type === "tool_use") : [];
      if (!uses.length) continue;
      if (msgs[i + 1]?.role !== "user") msgs.splice(i + 1, 0, { role: "user", content: [] });
      const next = msgs[i + 1];
      // The results in the calls' order, then whatever else the message held.
      const ids = new Set(uses.map((/** @type {any} */ u) => u.id));
      const mine = (/** @type {any} */ b) => b?.type === "tool_result" && ids.has(b.tool_use_id);
      next.content = [
        ...uses.map((/** @type {any} */ u) => answer(String(u.id), next.content.find((/** @type {any} */ b) => mine(b) && b.tool_use_id === u.id) || null)),
        ...next.content.filter((/** @type {any} */ b) => !mine(b)),
      ];
    }
    return msgs;
  };
  /** @param {"done" | "stopped" | "aborted" | "failed" | "paused"} status @param {boolean} forced */
  const finish = async (status, forced) => {
    endedAs = { status, forced };
    markCompaction();
    // A paused turn's calls run on: the reply that continues it ends them. A done turn's are as the agent left them.
    if (status !== "paused") {
      for (const c of calls.values())
        if (c.started && !c.ended) {
          c.cut = status !== "done";
          end(c, status === "done" ? { ok: true } : { ok: false, stopped: status !== "failed" });
        }
      for (const sub of subs.values()) if (!sub.ended) endSub(sub, SUBAGENT_LEFT[status]);
      for (const id of [...asks.keys()]) onAskEnd({ id, outcome: "cancelled", words: ["Cancelled"] });
    }
    closeRound();
    await snapshots;
    go(status, status === "done" ? "the agent ended its turn" : `the turn ended ${status}`);
  };

  /** The agent's calls of Filament's tools a call over MCP answered (`callFor`). @type {Set<string>} */
  const claimed = new Set();
  /** Calls over MCP that came before the agent's word of the call they came in. @type {{ name: string, found: (call: OwnCall | null) => void }[]} */
  const seeking = [];
  /** Calls over MCP that wait to see whose call they came in (`callIsOwn`). @type {{ name: string, found: (own: boolean | null) => void }[]} */
  const asking = [];
  /**
   * Words the agent took while its turn ran, kept where it took them, with the pictures that went with them.
   * @param {string} text @param {import("../services/runs.js").SteerImage[]} [images]
   */
  const took = (text, images = []) => {
    steers.push({ round, at: rawThread.length, text: String(text), ...(images.length ? { images } : {}) });
    steeredFrom = lastItem;
  };

  return {
    /** One agent event, read into the run's events. @param {any} ev */
    take(ev) {
      if (closing || !ev || typeof ev !== "object") return;
      // The agent's next piece of work: the compaction that ended before it is marked first, in its own round.
      if (compactionEnded && WORK.has(ev.type)) markCompaction();
      switch (ev.type) {
        case "text":
        case "thought": {
          if (ev.own) return;
          const words = String(ev.text || "");
          if (ev.subagent) {
            const sub = subs.get(String(ev.subagent));
            if (!sub || sub.raw) return;
            if (ev.type === "text") subSaid(sub, ev.messageId ? String(ev.messageId) : null, words);
            else subThought(sub, ev.messageId ? String(ev.messageId) : null, words);
            return;
          }
          const item = ev.itemId ? String(ev.itemId) : null;
          roundFor(ev.messageId ? String(ev.messageId) : null, true, item);
          lastItem = item;
          if (ev.type === "text") roundText += words;
          else roundThinking += words;
          return;
        }
        case "tool":
          return onTool(ev);
        case "subagent":
          return onSubagent(ev);
        case "plan": {
          // Filament's checklist tool gives its items in the loop's words (the owner's tool plan of 11-08); an agent's own
          // plan its entries, in its client's.
          const items = Array.isArray(ev.items)
            ? ev.items.map((/** @type {any} */ e) => ({ text: String(e?.text || "").replace(/\s+/g, " ").trim(), status: String(e?.status || "pending") }))
            : (Array.isArray(ev.entries) ? ev.entries : [])
                .filter((/** @type {any} */ e) => e && typeof e.content === "string")
                .map((/** @type {any} */ e) => ({ text: e.content.replace(/\s+/g, " ").trim(), status: /** @type {Record<string, string>} */ (PLAN_STATUS)[e.status] || "pending" }));
          const json = JSON.stringify(items);
          if (ev.subagent) return subPlan(subs.get(String(ev.subagent)), items, json);
          if (!items.length || json === lastPlan) return;
          lastPlan = json;
          if (!round) openRound(null);
          publish({ type: "plan", round, items });
          return;
        }
        case "graph":
          // A tasks call of the agent's changed the session's graph (HarnessV3-ACP AC4-5): the Plan view draws it from
          // the round the call was made in, as the loop's.
          if (!round) openRound(null);
          publish({ type: "graph", round, graph: ev.graph });
          return;
        case "visual":
          // A visual the agent drew with Filament's tool (HarnessV4_Visuals_Plan E16), kept already — on its turn, or on
          // the session for a helper no turn launched (VS-D48): the page fetches its code by where it is kept and its id,
          // in the round of the call it came in — the open one where that is not known.
          if (!round) openRound(null);
          publish({ type: "visual", round: Number.isInteger(ev.round) ? ev.round : round, id: String(ev.id || ""), title: String(ev.title || ""), bytes: Number(ev.bytes) || 0, ...(Number.isInteger(ev.turn) ? { turn: ev.turn } : ev.session === true ? { session: true } : {}) });
          return;
        case "artifact":
          // A version of an artifact the agent published with Filament's tool (HarnessV4_Artifacts_Plan E18), kept
          // already: said in the round of the call it came in — the open one where that is not known.
          if (!round) openRound(null);
          publish({ type: "artifact", round: Number.isInteger(ev.round) ? ev.round : round, ...(ev.id ? { id: String(ev.id) } : {}), name: String(ev.name || ""), v: Number(ev.v) || 0, title: String(ev.title || ""), address: String(ev.address || "") });
          return;
        case "routine":
          // A routine or a watcher the agent proposed or changed with Filament's space tool (the owner's of 11-12): said
          // in the round of the call it came in — the open one where that is not known —, for the card under it.
          if (!round) openRound(null);
          publish({ type: "routine", round: Number.isInteger(ev.round) ? ev.round : round, ...(ev.id ? { id: String(ev.id) } : {}), project: String(ev.project || ""), routine: String(ev.routine || ""), watcher: ev.watcher === true, change: ev.change === true, at: Number(ev.at) || 0 });
          return;
        case "compaction":
          return onCompaction(ev);
        case "agent-notice":
          // What the agent tells the person beside its answer (HarnessV4_Tasks C21): the page draws it on its own line,
          // in the round it came in — before the agent's first model call, round 0. A sub-agent's says so.
          return publish({ type: "agent-notice", round, severity: String(ev.severity || "info"), title: String(ev.title || ""), ...(ev.description ? { description: String(ev.description) } : {}), ...(ev.subagent ? { subagent: true } : {}) });
        case "usage":
          return onUsage(ev);
        case "raw":
          return onRaw(ev.message);
        case "ask":
          return onAsk(ev);
        case "ask-end":
          return onAskEnd(ev);
        case "step":
          // The prompt went to the agent (HarnessV3-FailurePoints §5.1 item 2): the turn says so until its first words.
          if (ev.step === "sent" && state === "idle") go("sent", `sent — ${agent || "the agent"} is working`);
          return;
        case "permission-offer":
          // A yes to the agent's request brought an always-allow to its threshold (HarnessV3-ACP AC3-2): offered on the
          // page as the loop offers one.
          return publish({ type: "permission-offer", round, tool: String(ev.tool || ""), shape: String(ev.shape || ""), count: Number(ev.count) || 0, itemId: Number(ev.itemId) });
      }
    },
    /**
     * The turn is over, once: the calls still open cut (a failed turn's failed, a done turn's ended as the agent left
     * them, a paused turn's left to the reply that continues it), the sub-agents with them, the open round's words, and
     * the last snapshot taken before the run ends. What the agent sends after it is no one's to see (a Force stop's).
     * @param {{ status: "done" | "stopped" | "aborted" | "failed" | "paused", forced?: boolean }} how
     */
    close({ status, forced = false }) {
      if (!closing) closing = finish(status, forced);
      for (const s of seeking.splice(0)) s.found(null);
      for (const s of asking.splice(0)) s.found(null);
      return closing;
    },
    /** The round the turn is in: 0 before the agent's first model call. */
    round: () => round,
    /** The turn waits between its prompts: a team's lead for its workers (HarnessV3-ACP AC6-4). @param {string} why */
    waiting(why) {
      if (!closing) go("waiting", why);
    },
    /**
     * A later prompt of the same turn goes to the agent (AC6-1, AC6-4): Filament's words, which the archive keeps where
     * the agent took them, as it keeps the person's, and the turn is the agent's again. Its turn had ended on its reply:
     * `woke` marks the round, so a settled turn's page shows that reply outside the work (the owner's of 11-05).
     * @param {string} text
     */
    prompted(text) {
      if (closing) return;
      took(text);
      anew = true;
      go("planning", "Filament's words to the agent", { woke: true });
    },
    /**
     * The folder changed by a hand that is none of the agent's own calls — its team's: a worker's change Filament
     * applied for the lead, a graph task's merge (HarnessV4_Tasks B12). The round it landed in is snapshotted as one
     * a writing call ran in, and its files, where the hand names them, are its in the round's record.
     * @param {import("./turn-tree.js").Writes | null} [writes]
     */
    wrote(writes = null) {
      if (closing) return;
      wroteSinceSnapshot = true;
      if (writes) roundWrote.writes.push(writes);
    },
    /**
     * The agent's own call of one of Filament's tools that a call over MCP answers (AC6-7): the oldest by that name
     * still running and not yet claimed, drawn now if it was not yet, so what the call starts — a team's worker — hangs
     * off its card, in its round. One the agent has not yet said is waited for, CALL_SEEN_MS at most; null where none
     * comes, or the turn is over.
     * @param {string} name  the tool, as its card reads it
     * @returns {Promise<OwnCall | null>}
     */
    callFor(name) {
      if (closing) return Promise.resolve(null);
      const c = [...calls.values()].find((x) => claimable(x, name));
      if (c) return Promise.resolve(claim(c));
      return new Promise((resolve) => {
        /** @type {{ name: string, found: (call: OwnCall | null) => void }} */
        const s = { name, found: (call) => (clearTimeout(timer), resolve(call)) };
        const timer = setTimeout(() => {
          const i = seeking.indexOf(s);
          if (i >= 0) seeking.splice(i, 1);
          resolve(null);
        }, CALL_SEEN_MS);
        seeking.push(s);
      });
    },
    /**
     * Whether a call over MCP by that name came in the agent's own call, claiming none (the review of 11-11): an agent's
     * own sub-agent — Cursor's task, Claude Code's Task — calls Filament over its agent's session, and stands where the
     * agent does. True where one of the agent's own calls by that name runs, answered for or not; false where only a
     * sub-agent's does. One neither has said yet is waited for, CALL_SEEN_MS at most, and the first said by that name
     * tells; null where none comes, or the turn is over: whose it is cannot be told.
     * @param {string} name  the tool, as its card reads it
     * @returns {Promise<boolean | null>}
     */
    callIsOwn(name) {
      if (closing) return Promise.resolve(null);
      const running = [...calls.values()].filter((x) => runsAs(x, name));
      if (running.length) return Promise.resolve(running.some((x) => !x.nested));
      return new Promise((resolve) => {
        /** @type {{ name: string, found: (own: boolean | null) => void }} */
        const s = { name, found: (own) => (clearTimeout(timer), resolve(own)) };
        const timer = setTimeout(() => {
          const i = asking.indexOf(s);
          if (i >= 0) asking.splice(i, 1);
          resolve(null);
        }, CALL_SEEN_MS);
        asking.push(s);
      });
    },
    /**
     * The person's words the agent took into its running turn (AC3-1): the archive keeps them where it took them, with
     * the pictures that went with them (HarnessV4_Tasks C22). Words queued at the agent that ran as its next prompt,
     * its turn having ended first (`after`), woke it as Filament's next prompt does: its reply ended there.
     * @param {string} text @param {import("../services/runs.js").SteerImage[]} [images] @param {boolean} [after]
     */
    steered(text, images = [], after = false) {
      if (closing) return;
      took(text, images);
      if (after) go("planning", "words queued at the agent ran as its next prompt", { woke: true });
    },
    /** The agent's newest model call of its own, its prompt as counted; null where it counted none by itself. */
    lastModelCall: () => lastModelCall,
    /** What the turn did, counted for the request's record. */
    counts() {
      return {
        rounds: round,
        tools: [...calls.values()].filter((c) => c.started && !c.sub).length,
        subagents: new Set([...subs.values()].filter((s) => !s.top)).size,
        snapshots: snapshotCount,
        ...(Object.keys(rawCounts).length ? { raw: { ...rawCounts } } : {}),
      };
    },
    /**
     * The turn as the archive keeps a loop turn (AC1-8): the work — each round's words and tool calls, then their
     * results — and the closing words apart. Claude's raw messages are the model's own conversation; another agent's
     * is rebuilt from its rounds, with each result as it showed it. With them, what the agent's own compactions of
     * its context leave Filament's copy of the chat (`compacted`, `left`; app/sessions/agent-copy.js).
     * @returns {{ work: any[], final: any[],
     *   compacted: { summary: string, cutAfter: string | null, manual: boolean, before: number, after: number, ms: number } | null,
     *   left: "partial" | "unsaid" | null }}
     */
    archive() {
      const msgs = rawThread.length ? answered() : rebuilt();
      const last = msgs[msgs.length - 1];
      const closed = last?.role === "assistant" && !last.content.some((/** @type {any} */ b) => b?.type === "tool_use");
      // The agent's newest compaction of its own context that Filament's copy of the chat can start from (`compacted`):
      // it handed its summary over, from a session that held the whole chat. Where it compacted and the copy cannot
      // follow, `left` says why: its session held less than the chat (`partial`), or it hands no summary over
      // (`unsaid`: Codex, Cursor).
      const own = ownCompactions.findLast((c) => c.summary && !c.partial) || null;
      const newest = ownCompactions.at(-1) || null;
      return {
        work: closed ? msgs.slice(0, -1) : msgs,
        final: closed ? last.content : [],
        compacted: own ? { summary: own.summary, cutAfter: own.cutAfter, manual: own.manual, before: own.before, after: own.after, ms: own.ms } : null,
        left: /** @type {"partial" | "unsaid" | null} */ (!newest || newest === own ? null : newest.partial ? "partial" : newest.summary ? null : "unsaid"),
      };
    },
  };
}
