// @ts-check
// The recall tool's answers (HarnessV2 §6.4): `filament_recall({ turn: n })` brings an archived turn back as text,
// `filament_recall({ result: "r:<hash8>" })` one archived tool result. Every turn a fold or a stub line stands for,
// and every pointer the shapes leave in the window — `r:<hash8>` in pointer and dedupe marks, in stub lines and on
// capped results — resolves here, so nothing removed from the window is lost to the model (§0.8). Pure over the archive: reads only.
import { textOfMessage, withoutAskLine } from "../../core/messages.js";
import { refusedLine, refusedTurn, resultRef, resultText, toolCalls } from "./shapes.js";
import { summaryWordsOf } from "../../services/memory/brain.js";

export const RECALL_TOOL = "filament_recall";
/** How much of a recalled turn goes back to the model. */
export const RECALL_TURN_CHARS = 24000;
export const RECALL_RESULT_CHARS = 30000;
/** How much of the chat the turn list reads, newest first. */
export const RECALL_LIST_TOKENS = 6000;

const tail = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…[Filament: ${s.length - n} more characters not shown; a single result comes back whole through filament_recall({ result: "r:…" }) with its pointer]` : s);

/**
 * A turn's pointer, as the shapes write it. @param {string} s
 * @returns {{ turn: number } | { result: string } | null}
 */
export function parsePointer(s) {
  const m = String(s || "").trim().match(/^(?:(t):\s*(\d+)|(r):\s*([0-9a-f]{8}))$/i);
  if (!m) return null;
  return m[1] ? { turn: Number(m[2]) } : { result: m[4].toLowerCase() };
}

/**
 * One archived turn as text the model can read: the user's words, every tool call with its full result, the reply.
 * @param {any} archive @param {string} chainId @param {number} n @param {{ capChars?: number }} [o]
 * @returns {{ text: string, turn: number, chars: number, calls: number } | null}
 */
export function recallTurn(archive, chainId, n, { capChars = RECALL_TURN_CHARS } = {}) {
  const turn = Number(n);
  if (!Number.isInteger(turn) || turn < 1) return null;
  const t = archive.turnBodies(String(chainId), { from: turn, to: turn })[0];
  if (!t) return null;
  // A turn the model's provider refused comes back as the history has it: Filament's line on what it wrote, never its
  // words, which sent again are refused again — and a tool result rides every later request (the hunt of 11-08).
  if (refusedTurn(t)) {
    const text = `## Turn ${t.n}\n${refusedLine(t.work || [])}`;
    return { text, turn: t.n, chars: text.length, calls: 0 };
  }
  const lines = [`## Turn ${t.n}${t.endedAt ? "" : " (still open)"}`, `User: ${textOfMessage(withoutAskLine(t.user))}`];
  const calls = toolCalls(t.work || []);
  let count = 0;
  for (const m of t.work || []) {
    if (m?.role === "assistant" && Array.isArray(m.content))
      for (const b of m.content) {
        if (b?.type === "text" && String(b.text).trim()) lines.push(`Assistant: ${String(b.text)}`);
        if (b?.type === "tool_use") {
          count++;
          lines.push(`Tool call ${b.name} ${JSON.stringify(b.input ?? {})}`);
        }
      }
    if (m?.role === "user" && Array.isArray(m.content))
      for (const b of m.content) {
        if (b?.type !== "tool_result") continue;
        const text = resultText(b);
        const c = calls.get(String(b.tool_use_id));
        lines.push(`Result of ${c?.name || "tool"} (r:${resultRef(text)}${b.is_error ? ", error" : ""}):\n${text}`);
      }
  }
  if (t.final) lines.push(`Assistant: ${textOfMessage(t.final)}`);
  if (t.summary) lines.push(`Summary: ${String(t.summary)}`);
  const text = tail(lines.join("\n"), capChars);
  return { text, turn: t.n, chars: text.length, calls: count };
}

/**
 * The result pointers each archived message holds, by the message's hash, for each archive: an archive keeps a message
 * under the hash of its bytes (`putMessage`), so what a hash holds there never changes — though another archive may
 * hold the same message cut short under its own cap. A message's results are opened and hashed once; a later recall
 * looks them up instead of opening and hashing every result of the session again. The most recently used stay, and an
 * archive's go with it (memory opens a new one each time it opens its folder).
 * @type {WeakMap<object, Map<string, string[]>>}
 */
const refsByArchive = new WeakMap();
/** How many messages' pointers each archive's map keeps. */
const REFS_KEPT = 20_000;

/** The pointers of a work message's tool results, in their order. @param {any} archive @param {string} hash */
function resultRefsOf(archive, hash) {
  let kept = refsByArchive.get(archive);
  if (!kept) refsByArchive.set(archive, (kept = new Map()));
  const had = kept.get(hash);
  if (had) {
    kept.delete(hash);
    kept.set(hash, had);
    return had;
  }
  const m = archive.getMessage(hash)?.message;
  const refs = m?.role === "user" && Array.isArray(m.content) ? m.content.filter((/** @type {any} */ b) => b?.type === "tool_result").map((/** @type {any} */ b) => resultRef(resultText(b))) : [];
  kept.set(hash, refs);
  if (kept.size > REFS_KEPT) kept.delete(/** @type {string} */ (kept.keys().next().value));
  return refs;
}

/**
 * One archived tool result by its pointer: a result capped in the window (`meta.capped` on its turn) is stored whole
 * as its own message; any other is found among the chain's archived results by the hash of its text, newest turn
 * first — the turns read as rows, each work message's pointers by its hash (`resultRefsOf`), and only the turn that
 * holds the result opened.
 * @param {any} archive @param {string} chainId @param {string} ref eight hex digits, with or without `r:`
 * @param {{ capChars?: number }} [o]
 * @returns {{ text: string, turn: number, tool: string, chars: number, error: boolean } | null}
 */
export function recallResult(archive, chainId, ref, { capChars = RECALL_RESULT_CHARS } = {}) {
  const want = String(ref || "").trim().replace(/^r:/i, "").toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(want)) return null;
  const turns = archive.getTurns(String(chainId));
  for (const t of [...turns].reverse()) {
    for (const c of Array.isArray(t.meta?.capped) ? t.meta.capped : [])
      if (c?.ref === want && c.hash) {
        const m = archive.getMessage(String(c.hash));
        const block = Array.isArray(m?.message?.content) ? m.message.content.find((b) => b?.type === "tool_result") : null;
        if (block) {
          const text = resultText(block);
          return { text: tail(text, capChars), turn: t.n, tool: String(c.tool || ""), chars: text.length, error: !!block.is_error };
        }
      }
  }
  for (const row of [...turns].reverse()) {
    if (!(row.work || []).some((/** @type {string} */ h) => resultRefsOf(archive, String(h)).includes(want))) continue;
    const t = archive.turnBodies(String(chainId), { ns: [row.n] })[0];
    if (!t) continue;
    const calls = toolCalls(t.work || []);
    for (const m of t.work || []) {
      if (m?.role !== "user" || !Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (b?.type !== "tool_result") continue;
        const text = resultText(b);
        if (resultRef(text) !== want) continue;
        return { text: tail(text, capChars), turn: t.n, tool: calls.get(String(b.tool_use_id))?.name || "", chars: text.length, error: !!b.is_error };
      }
    }
  }
  return null;
}

/**
 * The tool's answer as text: a turn, a result, with neither the chat's turns as a list (`recallList`), or why not.
 * @param {any} archive @param {string | null} chainId @param {{ turn?: any, result?: any, pointer?: any, before?: any }} input
 */
export function recall(archive, chainId, input = {}) {
  if (!archive || !chainId) return JSON.stringify({ error: "recall works inside a session; this request has none" });
  const p = input?.pointer != null ? parsePointer(String(input.pointer)) : null;
  const turn = input?.turn ?? (p && "turn" in p ? p.turn : undefined);
  const result = input?.result ?? (p && "result" in p ? p.result : undefined);
  if (turn != null && turn !== "") {
    const r = recallTurn(archive, chainId, Number(turn));
    return r ? r.text : JSON.stringify({ error: `no turn ${turn} in this session` });
  }
  if (result != null && result !== "") {
    const r = recallResult(archive, chainId, String(result));
    if (!r) return JSON.stringify({ error: `no archived result ${String(result).replace(/^r:/i, "r:")} in this session (pointers are r: plus eight hex digits, as written in the history)` });
    return `Result of ${r.tool || "tool"} in turn ${r.turn}${r.error ? " (error)" : ""}:\n${r.text}`;
  }
  if (p == null && input?.pointer != null) return JSON.stringify({ error: "give { turn: <n> } or { result: \"r:<hash8>\" }" });
  const before = input?.before != null && input.before !== "" ? Number(input.before) : null;
  if (before != null && !(Number.isInteger(before) && before >= 2)) return JSON.stringify({ error: "before is a turn number of 2 or more" });
  return recallList(archive, chainId, { before }) ?? JSON.stringify({ error: before != null ? `no turn before ${before} in this session` : "no turns in this session yet" });
}

/**
 * This chat's turns as a list (the owner's of 11-08): each one's number and time, what opened it, and its answer's head
 * and end, newest first — the older a turn, the less it bears on where the session stands, and the budget leaves the
 * oldest out — from memory's summary view of the chat's own record, which the chat keeps with memory on or off. An agent past
 * a compaction finds there the turn that said what was left, and brings it back whole by its number; `before` lists
 * the turns ahead of one. Null where the range holds no turn.
 * @param {any} archive @param {string} chainId @param {{ before?: number | null, budgetTokens?: number }} [o]
 * @returns {string | null}
 */
export function recallList(archive, chainId, { before = null, budgetTokens = RECALL_LIST_TOKENS } = {}) {
  // A turn the model's provider refused stands as Filament's line on what it wrote, as in the history (`recallTurn`).
  /** @param {any} t */
  const standIn = (t) => (refusedTurn(t) ? refusedLine(t.work.map((/** @type {string} */ h) => archive.getMessage(h)?.message).filter(Boolean)) : null);
  const r = archive.render(String(chainId), { view: "summary", budgetTokens, toTurn: before != null ? before - 1 : null, words: summaryWordsOf, newestFirst: true, standIn });
  if (!r?.turns) return null;
  const more = r.dropped ? ` The turns before ${r.from}: filament_recall({ before: ${r.from} }).` : "";
  return `## This chat's turns ${r.to} back to ${r.from}, newest first: what opened each, and its answer's head and end. filament_recall({ turn: n }) brings one back whole.${more}

${r.text}`;
}
