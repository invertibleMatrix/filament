// @ts-check
// A session's earlier turns as first-class turns (AgentPlanUX §5.3.2, UX-3; HarnessV2 §10.1): the server's transcript
// (`GET /api/sessions/:id/transcript?work=held` — each turn with its archived user message and its final answer, its
// work held back and read a stretch at a time as its row nears the screen (`/turns/:n/work`, `takeWork`), its
// marks, its FACTS (Facade D2: the numbers the fold stored on the turn), its card, and the boundaries between turns).
// A turn's numbers come from the server's facts, whatever happened to the record ring. The turns are read-only in the transcript; nothing here is ever resent — the server
// composes every request from the archive (D1).

/** The text blocks of a message, joined. @param {any} content */
export function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

/** A tool call block — the model's own or a provider-run one; the archive files both as kind tool_use. @param {any} b */
const isCall = (b) => b?.type === "tool_use" || b?.type === "server_tool_use";

/** A reply's words and thoughts — what it said, not the calls it made. @param {any} b */
const isWords = (b) => b?.type === "text" || b?.type === "thinking";

/** A message's blocks, whatever its shape: a string is one text. @param {any} m */
const contentOf = (m) => (Array.isArray(m?.content) ? m.content : [{ type: "text", text: String(m?.content ?? "") }]);
/** A sync's message, as its turn's user message carries it: the last text block. @param {any} m */
const syncTextOf = (m) => String(contentOf(m).filter((b) => b?.type === "text").at(-1)?.text || "");
/** How Filament's line begins where a letter from another chat woke the chat (sessions/wake.js LETTER_WAKE_LINE). */
export const LETTER_WAKE_HEAD = "[Filament: a letter from another chat has come for you;";
/** How a flow's hand-off to a box begins (core/flow.js FLOW_NOTE_HEAD). */
const FLOW_NOTE_HEAD = "[Filament: you are one box of a flow";
/** Whether a block is a hunt's range, as core/hunt-range.js `isRangeBlock` tells one. @param {any} b */
const isRangeText = (b) => b?.type === "text" && String(b.text || "").startsWith("<hunt-range ");
/** How a thread's brief begins (core/threads.js BRIEF_HEAD): that turn is drawn as its starter's agent's. */
export const BRIEF_HEAD = "[Filament: a thread started by the agent of the chat";
/** …and how its head ends (core/threads.js BRIEF_END), the agent's words after it in the same block. */
export const BRIEF_END = "their word comes before the brief's.]";
/**
 * A thread's brief as its turn's message carries it (core/threads.js `briefBlock`): the starter's title as the block
 * named it then, and the agent's words — after the head in its block, and in the blocks after it, where a chat started
 * before the words rode in the head's holds them. `block`: the brief as one block of Filament's, which a Retry of its
 * turn posts again (labels.js `againOf`); "" where the head or the words cannot be read.
 * @param {any[] | string | undefined} said
 */
function briefOf(said) {
  const blocks = Array.isArray(said) ? said : [{ type: "text", text: String(said ?? "") }];
  const head = blocks.find((b) => b?.type === "text" && String(b.text || "").startsWith(BRIEF_HEAD));
  const whole = String(head?.text || "");
  const named = /^\[Filament: a thread started by the agent of the chat "(.*?)" \(/.exec(whole)?.[1] || "";
  const inline = whole.includes(BRIEF_END) ? whole.slice(whole.indexOf(BRIEF_END) + BRIEF_END.length).trim() : "";
  const after = blocks.filter((b) => b?.type === "text" && b !== head).map((b) => String(b.text || "").trim());
  const text = [inline, ...after].filter(Boolean).join("\n\n");
  // The brief whole, as Filament posts one: its head as it was written, the words after it in the same block.
  const block = whole.includes(BRIEF_END) && text ? `${whole.slice(0, whole.indexOf(BRIEF_END) + BRIEF_END.length)}\n\n${text}` : "";
  return { title: named, text, block };
}
/**
 * A brief turn's view: who sent it, named as the transcript's `threads` names that chat now where it is the one, else as
 * the block named it — never the block's "untitled" — and the agent's words.
 * @param {{ from?: unknown }} mark  the transcript's @param {any[] | string | undefined} said
 * @param {{ id?: string, title?: string } | null | undefined} starter  the transcript's `threads.from`
 */
function briefTurn(mark, said, starter) {
  const from = mark.from ? String(mark.from) : null;
  const b = briefOf(said);
  const now = starter && from && String(starter.id) === from ? String(starter.title || "") : "";
  return { from, title: now || (b.title === "untitled" ? "" : b.title), text: b.text };
}
/** What the flow tells a team box it goes on with (core/flow.js FLOW_GO_ON). */
export const FLOW_GO_ON = "[Filament: the person asks you to go on with your part of the flow from where you stopped. End on your result: your final reply is handed on.]";

/**
 * The reply that asked, when a turn's work opens with it (`resumes`): the archive parks that reply for the resume, so
 * its calls ran in this turn while its words were said on the asking turn. Null for any other turn. A transcript
 * that holds the work back gives that reply apart (`opens`).
 * @param {any} t
 */
const askedIn = (t) => (t?.resumes ? (t.opens ?? t.work?.[0] ?? null) : null);

/**
 * A turn's work as the turn ran it: where it opens with the reply that asked, that reply's words were said on the
 * asking turn, and only its calls are this turn's. @param {{ resumes?: unknown } | null | undefined} t @param {any[]} work
 */
const ownWork = (t, work) => (t?.resumes && work.length ? [{ ...work[0], content: contentOf(work[0]).filter((b) => !isWords(b)) }, ...work.slice(1)] : work);

/**
 * The reply's blocks as the client saw them: the work's assistant texts and thinking in order, then the final
 * answer's text; tool calls are counted (Anthropic blocks, OpenAI `tool_calls`, Responses call items), and so are
 * tool legs — one per assistant message of the work that called tools, the same count the session truth's
 * `activity.toolLegs` makes from the archive (HarnessV2 Phase 6: turn = one message from the developer → the work →
 * one answer; tool leg = one round of the turn's tool loop). Two consecutive texts of one message are one text; each
 * message's words start their own, as the live reply breaks its block where a round begins — so a round's cards land
 * after its own words, not after the turn's.
 * @param {any[]} work @param {any} final
 */
function replyBlocks(work, final) {
  /** @type {{ type: "text" | "thinking", text: string }[]} */
  const blocks = [];
  let toolCalls = 0;
  let toolLegs = 0;
  /** The message's words so far are a text block of their own: the next text of the same message joins it. */
  let open = false;
  const push = (b) => {
    if (b?.type === "text" && b.text) {
      const last = blocks[blocks.length - 1];
      if (open && last?.type === "text") last.text += "\n\n" + b.text;
      else blocks.push({ type: "text", text: b.text });
      open = true;
    } else if (b?.type === "thinking" && b.thinking) {
      blocks.push({ type: "thinking", text: b.thinking });
      open = false;
    } else if (isCall(b)) toolCalls++;
  };
  /** @param {any[]} list */
  const said = (list) => {
    open = false;
    for (const b of list) push(b);
  };
  for (const m of work || []) {
    // A Responses-API call item has no role; the archive files it as kind tool_use, so it is a leg here too.
    if (m?.type === "function_call") { toolLegs++; toolCalls++; continue; }
    if (m?.role !== "assistant") continue;
    const list = contentOf(m);
    const calls = Array.isArray(m.tool_calls) ? m.tool_calls.length : 0;
    if (calls || list.some(isCall)) toolLegs++;
    toolCalls += calls;
    said(list);
  }
  if (final) said(contentOf(final));
  return { blocks, toolCalls, toolLegs };
}

/**
 * The turns this page sent that a hydrate keeps as drawn: a turn on screen with its live blocks is the same turn as
 * the server's copy — except one whose reply the page gave up (`fromTranscript`, F3 decision 14: the run ended while
 * the reply stayed silent), which the server's copy replaces when the server has it, and an earlier try of a turn a
 * later one went on in (a Retry of a turn that failed), which that turn stands for.
 * @param {any[]} pageTurns  the chat's turns as drawn @param {any[]} serverTurns  `transcriptTurns` of the transcript
 */
export function keptPageTurns(pageTurns, serverTurns) {
  return pageCopies(pageTurns, serverTurns).kept;
}

/**
 * The page's turns a hydrate keeps (`keptPageTurns`), and the server's turn each of the page's turns on record is
 * (`servedAs`) — known for them all, those given way included, so no other turn takes theirs by its number.
 * @param {any[]} pageTurns @param {any[]} serverTurns
 */
function pageCopies(pageTurns, serverTurns) {
  const { served, tried } = servedAs(pageTurns.filter((t) => !t.past && !unsent(t)), serverTurns);
  return { kept: pageTurns.filter((t) => !t.past && !tried.has(t) && !(t.fromTranscript && served.has(t))), served };
}

/**
 * The server's turn each of the page's turns is: the one holding its request, where the page knows its request — the
 * number a send gave itself is a guess, which another tab's turn can take first — or its send (`sends`, the page's own
 * name for it, `sendId`: a send whose reply's head never came knows no request); else the one of its number, where that
 * turn names no request. A turn holds every try of its message (a Retry of a turn that failed goes on in its row: the
 * archive's `beginTurn`): the page's newest try it holds is that turn, and the earlier ones (`tried`) are that turn
 * too. A send no turn holds the server never took, or has not numbered yet; a turn the server holds no row of yet (a
 * command's, which the session numbers as it ends) stands alone.
 * @param {any[]} mine  in the order they were sent @param {any[]} serverTurns @returns {{ served: Map<any, any>, tried: Set<any> }}
 */
function servedAs(mine, serverTurns) {
  const served = new Map();
  const tried = new Set();
  const taken = new Set();
  for (const s of serverTurns) {
    const tries = mine.filter((t) => holds(s, t));
    if (!tries.length) continue;
    const newest = tries[tries.length - 1];
    served.set(newest, s);
    taken.add(s);
    for (const t of tries) if (t !== newest) tried.add(t);
  }
  for (const t of mine) {
    if (served.has(t) || tried.has(t)) continue;
    const s = serverTurns.find((x) => !taken.has(x) && Number(x.n) === Number(t.n) && !(x.requestIds || []).length);
    if (!s) continue;
    served.set(t, s);
    taken.add(s);
  }
  return { served, tried };
}

/**
 * Whether the server's turn holds the page's send: its request, where the page learned it, or its own name for the send.
 * @param {any} s @param {any} mine
 */
const holds = (s, mine) => (!!mine.requestId && (s.requestIds || []).includes(mine.requestId)) || (!!mine.sendId && (s.sends || []).includes(mine.sendId));

/**
 * The session's running turn when it is the page's own send whose connection broke, which runs on at the server
 * (HarnessV2 D1): this window's, the same request where both are known, and the newest turn on the page (`newestOnRecord`).
 * A send whose reply's head never came knows no request: the running turn is its own where the session's newest row,
 * open, holds the send (`holds`). Null when the session could not be read (`tr` null), holds no turn, or holds another's.
 * @param {any} tr  the transcript's head @param {any[]} pageTurns  the chat's turns as drawn
 * @param {any} turn  the send's
 */
export function runningOn(tr, pageTurns, turn) {
  const on = tr?.live;
  if (on?.window !== "harness" || newestOnRecord(pageTurns) !== turn) return null;
  if (turn.requestId) return !on.requestId || on.requestId === turn.requestId ? on : null;
  const row = (tr.turns || []).at(-1);
  return row?.open && holds(row, turn) && (!on.requestId || (row.requestIds || []).includes(on.requestId)) ? on : null;
}

/**
 * What a send whose connection broke was, once no turn of it runs on (HarnessV4_Tasks U4): the transcript's newest turn
 * when it is this send's — it holds the send's request, or the send itself (`holds`) — "done" when it
 * finished, "error" when it failed at the server. Null when nothing can be claimed: the session could not be read, a
 * turn still runs (`runningOn`'s), the server never took the send, or its turn stands open with no word of how.
 * @param {any} tr  the transcript's head @param {any[]} pageTurns  the chat's turns as drawn
 * @param {any} turn  the send's
 * @returns {"done" | "error" | null}
 */
export function endedOn(tr, pageTurns, turn) {
  if (!tr || tr.live || newestOnRecord(pageTurns) !== turn) return null;
  const newest = (tr.turns || []).at(-1);
  if (!newest) return null;
  if (!holds(newest, turn)) return null;
  if (!newest.open) return "done";
  return newest.facts?.error ? "error" : null;
}

/**
 * What makes two copies of a boundary row the same row. Two compactions can span the same turns — a coding agent's own
 * in the middle of a turn (C28) and Filament's at the line before it, the agent's own at the line and the summary
 * Filament writes for its copy (C29) —: a compaction's is its turns and whose it is.
 * @param {any} b
 */
const boundaryKey = (b) =>
  b.type === "subagent" ? `subagent:${b.agentId}:${b.exchange}:${b.event}`
  : b.type === "compaction" ? `compaction:${b.fromTurn}:${b.toTurn}${b.detail?.copy ? ":copy" : ""}${isOwnDuring(b, b.detail?.during) ? `:during:${b.detail.during}` : ""}`
  : b.type === "team" ? `team:${b.id}:${b.event}`
  : b.type === "moved" ? `moved:${b.id}`
  : b.type === "copied" ? `copied:${b.id}`
  : b.type === "engine" ? `engine:${b.afterTurn}:${b.to ?? ""}`
  : b.type === "side" ? `side:${b.at}`
  : b.type === "held" ? `held:${b.id}`
  : `settings:${b.beforeTurn}`;

/**
 * Whether two copies are one row: one key (`boundaryKey`), and where both carry the server's id, or a compaction's
 * method, those agree too — another compaction of the same turns (one undone and made again, one undone in another tab
 * before its word reached this one, a turn's second try, the agent's own at the line beside Filament's summary) is
 * another row. @param {any} x @param {any} b
 */
const sameRow = (x, b) => {
  const agree = (/** @type {any} */ p, /** @type {any} */ q) => p == null || q == null || String(p) === String(q);
  return boundaryKey(x) === boundaryKey(b) && agree(x.id, b.id) && agree(x.method, b.method);
};

/**
 * The server's rows, then the page's it has no copy of — on this turn, or on any other (`known`, every row of the
 * read): a row the page placed after a turn as it ended is the server's before the next turn, once there is one. A
 * compaction's row, by its id, is the server's alone: one the read lacks was undone where the page did not hear it, or
 * was placed after the read was asked and is told to it again (app.js `hydrate`, `rowsHeard`) — kept, it would offer an
 * Undo the server refuses beside the one the read gives.
 * @param {any[] | undefined} page @param {any[] | undefined} server @param {any[]} [known]
 */
function withServerRows(page, server, known = server || []) {
  return [...(server || []), ...(page || []).filter((b) => !(b.type === "compaction" && b.id != null) && !known.some((x) => sameRow(x, b)))];
}

/**
 * Whether any of the turns holds a row that is `b` (`sameRow`, as a read merges them).
 * @param {readonly any[]} turns @param {any} b
 */
export function holdsRow(turns, b) {
  return turns.some((t) => [...(t.boundaries || []), ...(t.boundariesAfter || [])].some((x) => sameRow(x, b)));
}

/**
 * The compaction rows a turn that just ended places at once, from the transcript's newest rows (`row`, the turn's own):
 * a command's, written inside its own turn (`/compact`, `/autofit` — HarnessV3-Launch RD-D4), with the Undo the server
 * gave them; and a coding agent's own, made of its context in the middle of the turn, which the server writes once the
 * turn's work is archived (HarnessV4_Tasks C28). Left to the page's next read of the chat, that one came in when the
 * next message was sent, above it, as if the send had made it (the owner's screenshot of 10-18). The rest come their
 * own ways: Compact now's from its answer, the composer's by the turn's record (`composedCompactions`), Filament's
 * copy's on the feed.
 * @param {readonly any[] | undefined} boundaries @param {any} row @param {boolean} command
 * @returns {any[]}
 */
export function endedCompactions(boundaries, row, command) {
  if (!row) return [];
  return (boundaries || []).filter((b) => b?.type === "compaction" &&
    (command ? Number(b.at) >= Number(row.startedAt) : b.method === "own" && Number(b.detail?.during) === Number(row.n)));
}

/**
 * The rows of the compactions the composer made for a turn that just ended — at its line before it was sent, again for
 * a seed its coding agent refused for its size, in the middle of it for room in the whole chat (HarnessV4_Tasks C33) —
 * from the transcript's newest rows, by the ids the turn's record names (`view.compactions`): each as a read gives it,
 * its figures and Undo as the server says them. One undone since is in no read, and in none of these.
 * @param {readonly any[] | undefined} boundaries @param {readonly any[] | undefined} made  the record's `view.compactions`
 * @returns {any[]}
 */
export function composedCompactions(boundaries, made) {
  const ids = new Set((made || []).map((c) => Number(c?.id)).filter((id) => id > 0));
  return (boundaries || []).filter((b) => b?.type === "compaction" && ids.has(Number(b.id)));
}

/**
 * Whether a row is a coding agent's own compaction made in the middle of turn `n` (C28).
 * @param {any} b @param {number | null | undefined} n
 */
export const isOwnDuring = (b, n) => b?.type === "compaction" && b.method === "own" && Number(b.detail?.during) > 0 && Number(b.detail?.during) === Number(n);

/**
 * The row the server wrote for a coding agent's own compaction in the middle of this turn (C28: Filament's copy starts
 * from its summary), wherever the page holds it — read as the turn ended (`compactions`), or placed on the turn
 * (`placeBoundary`): the turn's line where it happened takes its words and its summary. Null where there is none.
 * @param {any} turn
 */
export function ownRowOf(turn) {
  const rows = [...(turn?.compactions || []), ...(turn?.boundariesAfter || []), ...(turn?.boundaries || [])];
  return rows.findLast((b) => isOwnDuring(b, turn?.n)) || null;
}

/**
 * The feed's word that a turn carried sub-agent messages (`subagent-carried`, decision 23), onto the between-turns rows
 * that waited for it, as the transcript reads them after a reload: an arrival learns the turn its report went with, a
 * launch that the main agent was told. → the turns whose rows changed.
 * @param {any[]} turns @param {{ turn: number, carried?: { agentId: string, exchange: number, kind: string }[] }} msg
 */
export function carryMarks(turns, msg) {
  const keys = new Set((msg.carried || []).map((c) => `${c.agentId}:${c.exchange}:${c.kind}`));
  /** @type {Set<any>} */
  const changed = new Set();
  for (const t of turns)
    for (const b of [...(t.boundaries || []), ...(t.boundariesAfter || [])]) {
      if (b.type !== "subagent" || !keys.has(`${b.agentId}:${b.exchange}:${b.event === "arrival" ? "report" : "notice"}`)) continue;
      if (b.event === "arrival") b.carriedBy = Number(msg.turn);
      else b.told = true;
      changed.add(t);
    }
  return [...changed];
}

/**
 * Whether the turns hold a compaction made after `id` that moved the session: Filament's copy alone moves none, and
 * the server's Undo is never its. A compaction's id is never used again, so a higher one was made later.
 * @param {readonly any[]} turns @param {unknown} id
 */
export function newerCompaction(turns, id) {
  return turns.some((t) => [...(t.boundaries || []), ...(t.boundariesAfter || [])].some((b) => b.type === "compaction" && !b.detail?.copy && Number(b.id) > Number(id)));
}

/**
 * An Undo's answer onto the turns' rows (HarnessV3-FixRound decision 24): the undone compaction (`id`) leaves, the one
 * the server would take back now (`next`, the answer's `undoable`; null for none) offers Undo, and no other does — as
 * a reload would draw them. The marks move only where the undone row offered the Undo as the turns hold it: where they
 * hold a compaction made after it (`newerCompaction`) — the Undo told again to a read asked before it (app.js
 * `hydrate`), a compaction made since —, where a message has gone since and ended every Undo (`undoEnded`), or where
 * they hold no copy of it, the marks stay as they are. → the turns whose rows changed.
 * @param {any[]} turns @param {number} id @param {number | null} next
 */
export function afterCompactionUndo(turns, id, next) {
  const gone = (/** @type {any} */ b) => b.type === "compaction" && Number(b.id) === id;
  const offered = turns.some((t) => [...(t.boundaries || []), ...(t.boundariesAfter || [])].some((b) => gone(b) && b.undoable));
  const marks = offered && !newerCompaction(turns, id);
  /** @type {any[]} */
  const changed = [];
  for (const t of turns) {
    const rows = [...(t.boundaries || []), ...(t.boundariesAfter || [])];
    let moved = rows.some(gone);
    for (const b of rows) {
      if (!marks || b.type !== "compaction" || gone(b)) continue;
      const undoable = next != null && Number(b.id) === next;
      if (!!b.undoable === undoable) continue;
      b.undoable = undoable;
      moved = true;
    }
    if (!moved) continue;
    t.boundaries = (t.boundaries || []).filter((/** @type {any} */ b) => !gone(b));
    t.boundariesAfter = (t.boundariesAfter || []).filter((/** @type {any} */ b) => !gone(b));
    changed.push(t);
  }
  return changed;
}

/**
 * A compaction this page placed, told again to a read asked before it (app.js `hydrate`): its row where the read lacks
 * it — a turn read from the server is the read's whole —, after the turn it ended on (`placeCompaction`'s), or where a
 * read places it (`asRead`: a turn's end's, `placeBoundary`); and, one that moved the session and was made after every
 * other there, the Undo its alone, as the server gave it. → the turns whose rows changed.
 * @param {any[]} turns @param {any} row @param {{ asRead?: boolean }} [o]
 */
export function afterCompactionPlaced(turns, row, { asRead = false } = {}) {
  /** @type {Set<any>} */
  const changed = new Set();
  const newest = !row.detail?.copy && !newerCompaction(turns, row.id);
  const copy = { ...row, ...(newest || !row.undoable ? {} : { undoable: false }) };
  if (!holdsRow(turns, row)) {
    const home = asRead ? placeBoundary(turns, copy) : turnNumbered(turns, row.afterTurn);
    if (home && !asRead) home.boundariesAfter = [...(home.boundariesAfter || []), copy];
    if (home) changed.add(home);
  }
  if (newest)
    for (const t of turns)
      for (const b of [...(t.boundaries || []), ...(t.boundariesAfter || [])]) {
        const on = !!row.undoable && b.id != null && Number(b.id) === Number(row.id);
        if (b.type !== "compaction" || !!b.undoable === on) continue;
        b.undoable = on;
        changed.add(t);
      }
  return [...changed];
}

/**
 * The next message gone out, told again to a read asked before it (app.js `hydrate`): a compaction before it answers
 * that turn now, and none can be undone any more. → the turns whose rows changed.
 * @param {any[]} turns
 */
export function undoEnded(turns) {
  return turns.filter((t) => {
    const rows = [...(t.boundaries || []), ...(t.boundariesAfter || [])].filter((b) => b.type === "compaction" && b.undoable);
    for (const b of rows) b.undoable = false;
    return rows.length > 0;
  });
}

/**
 * A move taken back (HarnessV4_Git_Plan GW-D79): its row leaves the turns, as a reload would draw them. → the turns
 * whose rows changed.
 * @param {any[]} turns @param {string} id
 */
export function withoutMove(turns, id) {
  const gone = (/** @type {any} */ b) => b.type === "moved" && String(b.id) === id;
  /** @type {any[]} */
  const changed = [];
  for (const t of turns) {
    if (![...(t.boundaries || []), ...(t.boundariesAfter || [])].some(gone)) continue;
    t.boundaries = (t.boundaries || []).filter((/** @type {any} */ b) => !gone(b));
    t.boundariesAfter = (t.boundariesAfter || []).filter((/** @type {any} */ b) => !gone(b));
    changed.push(t);
  }
  return changed;
}

/**
 * A worktree template's copy onto the turns (HarnessV4_Four_Plan FO-D37): it replaces the row of the same copy where a
 * turn holds one (running, then done), else it is placed as placeBoundaries places a row. → the turn that holds it
 * (null: no turn could).
 * @param {any[]} turns @param {any} b
 */
export function withCopy(turns, b) {
  for (const t of turns)
    for (const list of [t.boundaries || [], t.boundariesAfter || []]) {
      const i = list.findIndex((/** @type {any} */ x) => x.type === "copied" && String(x.id) === String(b.id));
      if (i < 0) continue;
      list[i] = b;
      return t;
    }
  return placeBoundary(turns, b);
}

/**
 * What a compaction cost onto its row (HarnessV4_Tasks U3-11): the server says it on the events feed once the
 * compaction's calls' records have finished, a beat after the row was drawn. → the turns whose row took it (none where
 * this page does not hold the row, or the row already has it).
 * @param {any[]} turns @param {number} id @param {{ paid: number | null, list: number | null, calls: number }} cost
 */
export function afterCompactionCost(turns, id, cost) {
  /** @type {any[]} */
  const changed = [];
  for (const t of turns) {
    let moved = false;
    for (const b of [...(t.boundaries || []), ...(t.boundariesAfter || [])]) {
      if (b.type !== "compaction" || Number(b.id) !== id) continue;
      const has = b.detail?.cost;
      if (has && has.paid === cost.paid && has.list === cost.list && has.calls === cost.calls) continue;
      b.detail = { ...(b.detail || {}), cost };
      moved = true;
    }
    if (moved) changed.push(t);
  }
  return changed;
}

/**
 * Whether a reply is Filament's question before the message was sent (its size, its cold or lost cache, a switch): nothing
 * went to a model and nothing is on record. A seed the agent refused is a turn on record, and is not this.
 * @param {{ errorBody?: any } | null | undefined} reply
 */
export const stoppedToAsk = (reply) => {
  const b = reply?.errorBody;
  return !!(b?.switchQuestion || b?.resumeQuestion || b?.needsCompaction);
};

/**
 * A message on no record: one that waits for the chat (app.js `armWaiting`), was withdrawn while it waited, or was
 * stopped to ask before it was sent (`stoppedToAsk`). It stands for none of the session's turns, whatever number it
 * shows. @param {any} t
 */
export const unsent = (t) => t.status === "waiting" || !!t.withdrawn || stoppedToAsk(t.reply);

/**
 * Whether a chat's kept draft is the words of a message a card stopped whose row the page still shows (the owner's of
 * 11-09): kept for a refresh, which shows no card (app.js, C33), they stand in that row — its way on sends them, and Not
 * now puts them back — so the chat shown again gives the box none of them.
 * @param {any[]} turns @param {string} draft
 */
export function heldInRow(turns, draft) {
  const d = String(draft || "").trim();
  return !!d && (turns || []).some((t) => stoppedToAsk(t?.reply) && [t.typed, t.userText].some((w) => typeof w === "string" && w.trim() === d));
}

/**
 * A turn the session forks at: one on record that ended — with its answer, or with a question it waits on, which is its
 * final. The server forks at none still open: running, or failed. @param {any} t
 */
export const forkable = (t) => !unsent(t) && (t.status === "done" || t.status === "stopped");

/**
 * The number the chat's next message takes: the one after its newest turn on record. The page need not hold every turn
 * of the session's (another tab's), so a count of them is no number; a message on no record (`unsent`) numbers none.
 * @param {any[]} turns
 */
export const nextNumber = (turns) => (turns || []).reduce((m, t) => (unsent(t) ? m : Math.max(m, Number(t.n) || 0)), 0) + 1;

/**
 * A page's turn takes a number of the session's, and its own settings row — drawn before it, by its number — moves with
 * it. @param {any} turn @param {number} n
 */
function takeNumber(turn, n) {
  const was = Number(turn.n);
  turn.n = n;
  for (const b of turn.boundaries || []) if (b.type === "settings" && Number(b.beforeTurn) === was) b.beforeTurn = n;
}

/**
 * A turn this page sent takes the number the session gave it (its head's `x-filament-turn`, or its record's
 * `memory.turn` once it ended): the send numbered itself after the turns the page holds, and another tab's turn may have
 * taken that number first. The rows on no record (`unsent`) number on after the turns on record. True where the number
 * moved: the page does not hold the session's turns as they are, and a read owes them.
 * @param {any[]} turns @param {any} turn @param {unknown} n
 */
export function renumbered(turns, turn, n) {
  const to = Number(n);
  if (!Number.isInteger(to) || to < 1 || to === Number(turn.n)) return false;
  takeNumber(turn, to);
  const after = nextNumber(turns);
  turns.filter(unsent).forEach((t, i) => (t.n = after + i));
  return true;
}

/**
 * The page's turn of a number, among those on record: a message on none (`unsent`) may share its number with the turn
 * sent after it. @param {any[]} turns @param {unknown} n
 */
export const turnNumbered = (turns, n) => turns.find((t) => !unsent(t) && Number(t.n) === Number(n)) || null;

/**
 * The chat's newest turn: the page's newest on record — a message on none (`unsent`) comes after them all, and is no
 * turn of the session's. @param {any[] | undefined} turns  oldest first
 */
export const newestOnRecord = (turns) => (turns || []).findLast((t) => !unsent(t)) || null;

/**
 * Whether a turn is a message of the person's own: not one its coding agent began by itself (HarnessV3-ACP AC3-9), nor
 * one Filament sent — a resume, a wake, a goal's round, a sync, a team's or a flow's result, a flow's word to its box,
 * a thread's brief, a watcher's turn, a routine's run, a Space ask's run, a team's opening: the turn's `by`, as the
 * transcript says who began it (core/turn-by.js).
 * @param {any} t
 */
const personsOwn = (t) => !t.by;

/**
 * Whether the card its agent left under a turn's reply still stands for the person — a plan offered first, a /plan's
 * Approve (the owner's of 11-10): no message of theirs came after it. A turn they did not send leaves it standing.
 * @param {any[] | undefined} turns  oldest first @param {any} turn
 */
export function cardStands(turns, turn) {
  const list = turns || [];
  const i = list.indexOf(turn);
  return i >= 0 && !list.slice(i + 1).some(personsOwn);
}

/**
 * The chat's turns after a hydrate, in turn order: the server's, except where this page keeps its own drawn copy
 * (`keptPageTurns`). Another tab's turn can follow one this page sent (decision 22), so the page's own turns are not
 * simply the newest: appended last, they drew above the turns that came after them, and hid the open one. A message
 * that waits for the chat (app.js `armWaiting`), or was withdrawn while it waited, is on no record: it stands for none of
 * the server's turns — one that began while it waited, a coding agent's own, is drawn — and comes after them all,
 * numbered on; so does one a card stopped before it was sent (`unsent`).
 * @param {any[]} pageTurns @param {any[]} serverTurns
 */
export function mergedTurns(pageTurns, serverTurns) {
  // Each of the page's turns is the server's turn holding its request (`servedAs`), whose number it takes.
  const { kept, served } = pageCopies(pageTurns, serverTurns);
  const waiting = kept.filter(unsent);
  const mine = kept.filter((t) => !unsent(t));
  // The boundary rows are the server's (HarnessV3-FixRound decision 23). A row between two turns lands on the later
  // one, so the server's copy of the turn before no longer holds it: a kept turn takes the server's rows, and keeps
  // its own only where the server has none yet (a running turn's settings change is stamped when it ends).
  const everywhere = serverTurns.flatMap((t) => [...(t.boundaries || []), ...(t.boundariesAfter || [])]);
  for (const t of mine) {
    const s = served.get(t);
    if (!s) continue;
    if (Number(s.n) !== Number(t.n)) takeNumber(t, Number(s.n));
    t.boundaries = withServerRows(t.boundaries, s.boundaries, everywhere);
    t.boundariesAfter = withServerRows(t.boundariesAfter, s.boundariesAfter, everywhere);
    // Its question left unanswered since it was drawn — the person went on with a coding agent, here or in another tab:
    // the server's mark, which the footer says.
    if (s.unanswered) t.unanswered = s.unanswered;
  }
  // A turn the page gave way to the server's copy of is drawn from it.
  const taken = new Set(mine.map((t) => served.get(t)).filter(Boolean));
  const merged = [...serverTurns.filter((t) => !taken.has(t)), ...mine].sort((a, b) => a.n - b.n);
  const last = merged.reduce((m, t) => Math.max(m, Number(t.n) || 0), 0);
  waiting.forEach((t, i) => (t.n = last + 1 + i));
  return [...merged, ...waiting];
}

/**
 * A chat's reviews, as Filament says them by its turns' numbers — its transcript's, or the feed's said again —, put on
 * the turns the page holds: each turn's `reviews` set, or taken away, where they are another list now. → the turns
 * whose reviews moved, for the timeline to draw their chips alone.
 * @param {any[]} turns @param {Record<string, any[]> | null | undefined} byTurn
 * @returns {any[]}
 */
export function reviewsMoved(turns, byTurn) {
  const moved = [];
  for (const t of turns) {
    if (t.n == null) continue;
    const next = Array.isArray(byTurn?.[t.n]) && byTurn[t.n].length ? byTurn[t.n] : null;
    if (JSON.stringify(next) === JSON.stringify(t.reviews?.length ? t.reviews : null)) continue;
    if (next) t.reviews = next;
    else delete t.reviews;
    moved.push(t);
  }
  return moved;
}

/**
 * The transcript's turns as the timeline renders them. Each turn reads its numbers, notes and card from the
 * transcript's own fields (`facts`, `card`, `clientLabel` — Facade D2/D4/D13); the request records are not read
 * here. Boundaries land on the turn they precede (`boundaries`), or after the last turn
 * (`boundariesAfter`) when nothing follows them yet.
 * A question still waiting brings the reply it came in (`paused.reply`, RD1 b): its words show on the asking turn,
 * before the question, as they did live — the archive parks that reply for the resume. Answered, that reply opens the
 * next turn's work (`resumes`): its words stay on the asking turn, and its calls go with the turn that ran them.
 * A turn with no reply recorded whose newest request failed is drawn failed, as it was live: its words (the facts'
 * `error`) in the banner, with Retry — and with them the failure's two parts (`failed.failure`), what was said under
 * it (the facts' `errorDetail`: a coding agent's own error) and the words its failing round had said (`failed.text`),
 * as the turn's last, where they streamed (HarnessV4_Tasks U1).
 * A thread's brief names its starter as the transcript's `threads` does now.
 * @param {{ turns?: any[], boundaries?: any[], paused?: { requestId?: string | null, reply?: any } | null, threads?: { from?: { id?: string, title?: string } | null, started?: any[] } | null, reviews?: Record<string, any[]> | null }} transcript
 */
export function transcriptTurns(transcript) {
  const waiting = transcript?.paused?.reply && transcript.paused.requestId ? transcript.paused : null;
  const list = transcript?.turns || [];
  const turns = list.map((t, i) => {
    const ids = Array.isArray(t.requestIds) ? t.requestIds : [];
    // Sub-agents' messages and background shells' exits Filament put ahead of what was typed are the turn's context,
    // not the developer's words.
    const deliveries = Number(t.deliveries) || 0;
    const shellExits = Math.min(deliveries, Number(t.shellExits) || 0);
    const said = deliveries && Array.isArray(t.user?.content) ? t.user.content.slice(deliveries) : t.user?.content;
    // A team beside's lead's first message opens with the main chat's record (team_v2_plan §5.3): the person's words
    // are what follows it; the record folds under What the lead read.
    const unrecorded = t.record && Array.isArray(said) ? said.slice(1) : said;
    // A flow's team box: the flow's hand-off — the person's words and every result before it — folds under What the
    // flow handed it (HarnessV4_Flow_Plan F5); the box's own part is what shows.
    const handed = t.handoff && Array.isArray(unrecorded) ? unrecorded.find((/** @type {any} */ b) => b?.type === "text" && String(b.text || "").startsWith(FLOW_NOTE_HEAD)) || null : null;
    const handless = handed ? /** @type {any[]} */ (unrecorded).filter((/** @type {any} */ b) => b !== handed) : unrecorded;
    // A hunt's range (the plan's p6) is Filament's block of the files its lead hunts in, never the person's words.
    const typed = t.range && Array.isArray(handless) ? handless.filter((/** @type {any} */ b) => !isRangeText(b)) : handless;
    const requestId = ids[ids.length - 1] || null;
    const answer = askedIn(list[i + 1]);
    const asked = waiting && ids.includes(waiting.requestId) ? [waiting.reply] : answer ? [{ role: "assistant", content: contentOf(answer).filter(isWords) }] : [];
    const failed = !!t.open && !!t.facts?.error;
    const saidThen = failed && !t.final && t.failed?.text ? { role: "assistant", content: [{ type: "text", text: String(t.failed.text) }] } : null;
    const final = t.final || saidThen;
    // The transcript holds each turn's work back: it says how many messages the work has (`workCount`) and how it
    // counts (`tally`). The work comes apart, a stretch at a time (`takeWork`); until then the turn is its answer,
    // under a fold that says the work is being read. Work the archive never counted is counted from the work
    // itself, once all of it is read.
    const tail = replyBlocks(asked, final);
    const steps = Number(t.workCount) || 0;
    const tally = t.tally ? { calls: Number(t.tally.calls) || 0, legs: Number(t.tally.legs) || 0 } : steps ? null : { calls: 0, legs: 0 };
    const startedAt = Number(t.startedAt);
    const endedAt = Number(t.endedAt);
    return {
      n: t.n,
      turnId: t.turnId,
      past: true,
      history: true,
      open: !!t.open,
      // A restart or a crash cut it off before its reply (the filament-agent plan's 2b-C D8), and what was kept of it.
      ...(t.cutOff ? { cutOff: true, ...(t.cut ? { cut: { rounds: Number(t.cut.rounds) || 0, tools: Number(t.cut.tools) || 0, logged: Number(t.cut.logged) || 0, ...(t.cut.resume ? { resume: t.cut.resume } : {}) } } : {}) } : {}),
      // Who began it, where it is not the person (core/turn-by.js): every list of the person's own messages reads it.
      ...(t.by ? { by: String(t.by) } : {}),
      // The turn Filament sent to go on with one a restart cut off (HarnessV3-TaskGraph-v2 TG2-D83): Filament's message.
      ...(t.resumed ? { resumed: true } : {}),
      // The turn Filament sent as a background command ended (HarnessV4_Four_Plan E21, FO-D49), and the shells' exits
      // that rode with it, each the line the agent read — or as a letter from another chat came.
      ...(t.woke ? { woke: true, wakeExits: shellExits && Array.isArray(t.user?.content) ? t.user.content.slice(deliveries - shellExits, deliveries).map((/** @type {any} */ b) => String(b?.text || "")).filter(Boolean) : [] } : {}),
      ...(t.woke && syncTextOf(t.user).startsWith(LETTER_WAKE_HEAD) ? { wakeLetter: true } : {}),
      // The turn Filament sent as a driving goal's next round (core/goal-drive.js), and which round it was.
      ...(t.goalRound ? { goalRound: { round: Number(t.goalRound.round) || 0, cap: Number(t.goalRound.cap) || 0 } } : {}),
      // A sync from the project's Space (proposal_ux §4.14): its message — the last text block — is Filament's.
      ...(t.synced ? { synced: true, syncText: syncTextOf(t.user) } : {}),
      // A team beside's result the person sent on, or their switch did (team_v2_plan §5.4): Filament's message too.
      ...(t.teamResult ? { teamResult: true, teamText: syncTextOf(t.user) } : {}),
      // A flow's end (HarnessV4_Flow_Plan FL-D11): Filament's message, drawn as a team's result is, in its own words. So is
      // the one that opened the turn a flow started In place (HarnessV4_OneAgent_Plan OA4).
      ...(t.flowEnd ? { teamResult: true, flowEnd: true, teamText: syncTextOf(t.user) } : {}),
      ...(t.flowDrive ? { teamResult: true, flowDrive: true, teamText: syncTextOf(t.user) } : {}),
      // The flow's own word to its team box (HarnessV4_Flow_Plan F5): go on, or its part sent back from the gate.
      ...(t.flowSaid ? { flowSaid: syncTextOf(t.user) === FLOW_GO_ON ? "on" : "back", flowText: syncTextOf(t.user) } : {}),
      // A thread's brief (core/threads.js): its starter's agent's words, drawn as theirs with the way to that chat.
      // Its starter named as it is now (`threads`), else as the block named it then: a chat untitled when its agent
      // wrote the brief has a name since.
      ...(t.brief ? { brief: briefTurn(t.brief, typed, transcript?.threads?.from), briefBlock: briefOf(typed).block } : {}),
      // A watcher's turn (app/routines.js `wakeChat`): what it heard, with Filament's packet, is Filament's message.
      // Which watcher, and what it heard in Filament's words, where the turn keeps them (`watch`).
      ...(t.watched ? { watched: true, watchText: syncTextOf(t.user), ...(t.watch ? { watch: t.watch } : {}) } : {}),
      // A watcher's guidance sent as a turn (app/watchers/guidance.js): the reviewer's words under Filament's block,
      // and its parts as Filament says them apart, for its card (`guide`).
      ...(t.guided ? { guided: true, guideText: syncTextOf(t.user), ...(t.guide ? { guide: t.guide } : {}) } : {}),
      // The first message of a chat Filament made for it — a routine's run, a Space ask's, a team's opening —, as the
      // transcript says it: taken once, and never sent again from the page (labels.js `sentOnce`).
      ...(t.opening ? { opening: true } : {}),
      // The watchers that read it, as the transcript says them by its number (`reviews`): its footer's chip.
      ...(Array.isArray(transcript?.reviews?.[t.n]) ? { reviews: transcript.reviews[t.n] } : {}),
      ...(t.record && Array.isArray(said) ? { recordText: String(said[0]?.text || "") } : {}),
      ...(handed ? { handoffText: String(handed.text || "") } : {}),
      status: failed ? "error" : t.open ? "open" : "done",
      ...(failed ? { error: String(t.facts.error) } : {}),
      ...(failed && t.failed?.failure?.head ? { failure: { head: String(t.failed.failure.head), more: String(t.failed.failure.more || "") } } : {}),
      ...(failed && t.facts.errorDetail ? { errorDetail: String(t.facts.errorDetail) } : {}),
      userText: textOf(typed),
      userContent: typed,
      deliveries,
      ...(Number(t.asking) > 0 ? { asking: Number(t.asking) } : {}),
      shellExits,
      // Of them, a watch's lines, a come-back's note and the person's Cancel of one: no command's end.
      ...(Number(t.shellWatch) > 0 ? { shellWatch: Number(t.shellWatch) } : {}),
      ...(Number(t.shellWake) > 0 ? { shellWake: Number(t.shellWake) } : {}),
      ...(Number(t.shellIdle) > 0 ? { shellIdle: Number(t.shellIdle) } : {}),
      ...(Number(t.shellCancel) > 0 ? { shellCancel: Number(t.shellCancel) } : {}),
      // A rewind's line rode with it (the Designer's rewind in place): said as word of your rewind.
      ...(t.rewindNote === true ? { rewindNote: true } : {}),
      // …and the line on why the goal's drive halted (core/goal-drive.js `haltLine`): said as word of why it halted.
      ...(t.goalHalt === true ? { goalHalt: true } : {}),
      // Whose answers the message overrules, by name (HarnessV4_Tasks E15 step 3).
      ...(Array.isArray(t.overrules) && t.overrules.length ? { overrules: t.overrules } : {}),
      // Whom its words named with an `@` for the main agent to use, by name, and those it did not use
      // (HarnessV4_OneAgent_Plan OA2).
      ...(Array.isArray(t.use) && t.use.length ? { use: t.use } : {}),
      ...(t.flow === true ? { flow: true } : {}),
      // A /parallel's message (Phase 5): Filament's line asking for a re-plan rode ahead of it — under Parallelize tasks
      // (`parallelOn`), for its agent to start them itself.
      ...(t.parallel === true ? { parallel: true } : {}),
      ...(t.parallelOn === true ? { parallelOn: true } : {}),
      // A /plan's message, and what its plan left once it ended with its reply: the card after it opens the Plan.
      ...(t.plan === true ? { plan: true } : {}),
      ...(t.planReady ? { planReady: { tasks: Number(t.planReady.tasks) || 0, steps: Number(t.planReady.steps) || 0, goal: String(t.planReady.goal || "") } } : {}),
      // Its main agent offered Run as a flow under the reply (OA6).
      ...(t.flowOffer === true ? { flowOffer: true } : {}),
      // A plan its agent offered first (the owner's plan mode of 11-06).
      ...(t.planOffer ? { planOffer: { depth: String(t.planOffer.depth || "standard"), side: t.planOffer.side === true } } : {}),
      // The box's side by side line rode ahead of it (11-06): no agent's message.
      ...(t.side === true ? { side: true } : {}),
      ...(Number(t.flowStarts) > 0 ? { flowStarts: Number(t.flowStarts) } : {}),
      ...(Number(t.flowNews) > 0 ? { flowNews: Number(t.flowNews) } : {}),
      ...(Array.isArray(t.unused) && t.unused.length ? { unused: t.unused } : {}),
      // A command's answer is Filament's text, kept off the model's blocks and drawn as Filament's.
      blocks: t.command ? [] : tail.blocks,
      commandText: t.command ? textOf(t.final?.content) : null,
      steers: [],
      segments: [],
      toolCalls: tally ? tally.calls + tail.toolCalls : undefined,
      toolLegs: tally ? tally.legs + tail.toolLegs : undefined,
      requestId,
      // Every request of the turn, and every send of the page's it holds: a read knows the page's own turn by them
      // (`servedAs`).
      requestIds: ids,
      sends: Array.isArray(t.sends) ? t.sends : [],
      // The run shares the request id; the row says whether there is one (LD-D13), so a turn without one (a command
      // Filament answered itself) never asks and shows its text alone.
      runId: t.run ? requestId : null,
      rec: null, // a history turn carries no record (FB); the live turn's is set at its end
      startedAt: Number.isFinite(startedAt) ? startedAt : undefined,
      endedAt: Number.isFinite(endedAt) ? endedAt : undefined,
      shape: t.shape || null,
      settingsHash: t.settingsHash || null,
      composed: t.composed || null,
      // Which window typed this turn and which client ran it (Step 3 D1), with the server's words for the client
      // (Facade D13) — the page draws them and never maps an id. The turn's facts (D2) and a command answer's
      // card (D4) ride beside them.
      client: t.client || null,
      clientLabel: t.clientLabel || null,
      facts: t.facts || null,
      card: t.card || null,
      window: t.window || null,
      // The work the transcript held back: how many messages it has, where the next stretch begins (null: all of it
      // is read), what was read of it in the order it happened (`parts`: a block the model said, or the calls that
      // followed as cards), how that counts, and the blocks that follow the work (the asked reply's words, the answer).
      held: steps
        ? { total: steps, next: /** @type {number | null} */ (0), parts: /** @type {{ block?: any, tools?: any[], el?: any, drawn?: number }[]} */ ([]), calls: 0, legs: 0, tail, resumes: !!t.resumes, reading: /** @type {Promise<void> | null} */ (null), failed: "" }
        : null,
      // A rewound line (Step 3 D11): the turn is kept but out of every request; the timeline draws the line.
      rewound: t.rewound || null,
      // A turn stopped from the harness (Step 3 D16): the chip in the footer.
      stopped: t.stopped || null,
      // Who answered it (HarnessV3-AtHome AH-O7): a team's lead, the agent loop, or a model alone — the conversation's
      // dividers and the lead's footer read it (HarnessV3-Views VW-D8).
      engine: t.engine || null,
      // A turn its coding agent began by itself (HarnessV3-ACP AC3-9): the agent, and the background tasks whose end
      // it answered — drawn in the message's place, never as the developer's words.
      own: t.own || null,
      // The note the reply ended on (LD-D7): left out of the reply where the page draws its card.
      note: t.notice || null,
      // Its question was left unanswered: the person went on with a coding agent instead (`by`, its name).
      unanswered: t.unanswered || null,
      // The visuals the agent drew in it (HarnessV4_Visuals_Plan E16), each by its call's id, title and size, and who
      // drew it where a sub-agent did: the page draws its code from the turn.
      ...(Array.isArray(t.visuals) && t.visuals.length ? { visuals: t.visuals } : {}),
      // A chat command Filament answered itself: its text is Filament's, drawn as such, never as the model's words.
      command: !!t.command,
      // Who answered it, where that was a coding agent in a chat of its own (read from its files), not Filament.
      commandBy: t.command && t.commandBy ? String(t.commandBy) : null,
      /** @type {any[]} */
      boundaries: [],
      /** @type {any[]} */
      boundariesAfter: [],
    };
  });
  placeBoundaries(turns, transcript?.boundaries || []);
  return turns;
}

/** The turn's blocks from what was read of its work, and its counts once all of it is read. @param {any} turn */
function workOnto(turn) {
  const held = turn.held;
  turn.blocks = turn.command ? [] : [...held.parts.flatMap((/** @type {any} */ p) => (p.block ? [p.block] : [])), ...held.tail.blocks];
  if (held.next == null) Object.assign(turn, { toolCalls: held.calls + held.tail.toolCalls, toolLegs: held.legs + held.tail.toolLegs });
}

/**
 * A stretch of a turn's work onto the turn (`GET /api/sessions/:id/turns/:n/work`), in the order it happened: what
 * each message of the model's said joins the turn's blocks before the answer (whose blocks stay the ones the turn
 * had), and the calls it made follow its words as cards — calls with no words between them share one box, as a run's
 * rounds do. Once the whole work is read the turn counts its legs and calls from it. False for a stretch that is not
 * the next one. @param {any} turn @param {any} page
 */
export function takeWork(turn, page) {
  const held = turn?.held;
  if (!held || !page || held.next == null || Number(page.from) !== held.next) return false;
  const work = Array.isArray(page.work) ? page.work : [];
  for (const m of held.next === 0 ? ownWork(held, work) : work) {
    const read = replyBlocks([m], null);
    for (const block of read.blocks) held.parts.push({ block });
    held.calls += read.toolCalls;
    held.legs += read.toolLegs;
    if (!Array.isArray(m.tools) || !m.tools.length) continue;
    const last = held.parts.at(-1);
    if (last?.tools) last.tools.push(...m.tools);
    else held.parts.push({ tools: [...m.tools] });
  }
  held.total = Number(page.total) || held.total;
  held.next = page.next == null ? null : Number(page.next);
  workOnto(turn);
  return true;
}

/**
 * A fresh reading's turns with the work the page had read of them: the page reads a session again whenever something
 * moves in it, and a turn's work, once read, is not asked for again while the turn has not grown.
 * @param {any[]} turns  `transcriptTurns` of the new reading @param {any[] | null | undefined} was  the chat's turns as drawn
 */
export function withReadWork(turns, was) {
  const had = new Map((was || []).filter((t) => t?.held && t.held.next !== 0 && t.turnId != null).map((t) => [t.turnId, t.held]));
  for (const t of turns) {
    const old = t.held ? had.get(t.turnId) : null;
    if (!old || old.total !== t.held.total) continue;
    Object.assign(t.held, { parts: old.parts, calls: old.calls, legs: old.legs, next: old.next });
    workOnto(t);
  }
  return turns;
}

/**
 * What a turn's fold says of its work while not all of it is read: that it is being read; how much is shown, with
 * the way to more; or why a read failed, with the way to try again. Null once the whole work is read. A step is one
 * message of the work: a reply of the model's, or what a call returned.
 * @param {any} held  the turn's `held` @returns {{ text: string, action: string } | null}
 */
export function heldWords(held) {
  if (!held || held.next == null) return null;
  const n = (/** @type {number} */ v) => Number(v).toLocaleString("en-US");
  if (held.failed) return { text: `This turn's work could not be read: ${held.failed}`, action: "Try again" };
  if (held.reading || !held.next) return { text: held.next ? "Reading more of this turn's work…" : "Reading this turn's work…", action: "" };
  return { text: `${n(held.next)} of ${n(held.total)} steps of this turn's work are shown.`, action: "Show more" };
}

/**
 * The turn the context meter reads (what the session last held): the newest finished turn that went to a model and
 * measured something — never Filament's own answer to a command (it carries no prompt), never a turn still running
 * or unanswered, never a message on no record (`unsent`), and never one whose call was stopped before the provider
 * counted it: the figure before it stands (HarnessV3-Launch LD-D6).
 * @param {any[]} turns
 * @param {(t: any) => number | null} heldOf  what a turn measured, as far as the page knows — null while it does not
 *   (its record not read yet)
 * @returns {any | null}
 */
export function meterTurnOf(turns, heldOf) {
  const finished = (/** @type {any} */ t) => !t.command && !unsent(t) && !["streaming", "open", "paused"].includes(t.status);
  return [...(turns || [])].reverse().find((t) => finished(t) && (t.rec || t.facts || t.requestId) && heldOf(t) !== 0) || null;
}

/**
 * Boundary rows onto the turns: a settings change sits before the first turn that ran under the new document; a
 * compaction, a move to another place, the developer's sub-agent sent off or back between turns, and the side-by-side
 * card (Phase 5), sit after the turn they follow (before the next one when there is one).
 * @param {any[]} turns @param {any[]} boundaries
 */
export function placeBoundaries(turns, boundaries) {
  for (const b of boundaries || []) placeBoundary(turns, b);
}

/**
 * One boundary onto the turns, as placeBoundaries places it; returns the turn that took it (null: none could, or the
 * turns already hold it — a sub-agent mark the bus announces after a hydrate that read it).
 * @param {any[]} turns @param {any} b
 */
export function placeBoundary(turns, b) {
  const byN = (/** @type {number} */ n) => turnNumbered(turns, n);
  if (b.type === "settings") {
    const t = byN(Number(b.beforeTurn));
    t?.boundaries.push(b);
    return t;
  }
  if (b.type !== "compaction" && b.type !== "subagent" && b.type !== "moved" && b.type !== "copied" && b.type !== "team" && b.type !== "side" && b.type !== "held") return null;
  if (b.type === "team") {
    const same = (/** @type {any} */ x) => x.type === "team" && x.id === b.id && x.event === b.event;
    if (turns.some((t) => t.boundaries?.some(same) || t.boundariesAfter?.some(same))) return null;
  }
  // The side-by-side card (Phase 5), once: the graph heard on the feed and the transcript's read both carry it.
  if (b.type === "side") {
    const same = (/** @type {any} */ x) => x.type === "side" && x.at === b.at;
    if (turns.some((t) => t.boundaries?.some(same) || t.boundariesAfter?.some(same))) return null;
  }
  // The card for sub-agents that change files, once: the feed and the transcript's read both carry it, and it reads
  // what stands from the page's word of it (held-launch.js).
  if (b.type === "held") {
    const same = (/** @type {any} */ x) => x.type === "held" && x.id === b.id;
    if (turns.some((t) => t.boundaries?.some(same) || t.boundariesAfter?.some(same))) return null;
    // The turn that asked holds it, whatever follows: waiting, it stands after that turn; answered, at the round it was
    // asked in (timeline.js `placeCards`; the owner's of 11-16: the cards "stuck at the end of the chat").
    const asker = byN(Number(b.afterTurn)) || newestOnRecord(turns);
    asker?.boundariesAfter.push(b);
    return asker;
  }
  if (b.type === "subagent") {
    const same = (/** @type {any} */ x) => x.type === "subagent" && x.agentId === b.agentId && x.exchange === b.exchange && x.event === b.event;
    if (turns.some((t) => t.boundaries?.some(same) || t.boundariesAfter?.some(same))) return null;
  }
  // A coding agent's own compaction in the middle of a turn is that turn's, whatever follows it (the owner's words of
  // 10-18: "it should sit where it happened"): the turn's line where it happened takes the row, which stands after the
  // turn only where the turn has no line (its run's log swept).
  const during = b.type === "compaction" && b.method === "own" ? byN(Number(b.detail?.during) || 0) : null;
  if (during) {
    (during.boundariesAfter ||= []).push(b);
    return during;
  }
  const next = byN(Number(b.afterTurn) + 1);
  if (next) {
    next.boundaries.push(b);
    return next;
  }
  const last = byN(Number(b.afterTurn)) || newestOnRecord(turns);
  last?.boundariesAfter.push(b);
  return last;
}
