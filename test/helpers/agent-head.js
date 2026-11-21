// @ts-check
// A coding agent's prompt read apart. A fresh agent session's first prompt opens with Filament's standing context — its
// head, then each block (adapters/agents/context.js `standingText`) — set apart from what the turn carries by `ahead`'s
// rule. Every coding agent's session holds Filament's agent tool (HarnessV4_Tasks E23-D8), so a test that weighs a
// fresh session's seed reads what follows the head.

import { CONTEXT_HEAD } from "../../src/adapters/agents/context.js";

/** The last block's close and the rule after it. A memory block escapes Filament's tags in its text, so the first is the head's end. */
const HEAD_END = /<\/filament-(?:context|memory)>\n\n---\n/;
const RULE = "\n\n---\n";

/**
 * A prompt split where Filament's head ends: `head` is "" where the prompt opens with none.
 * @param {unknown} prompt @returns {{ head: string, rest: string }}
 */
export function splitHead(prompt) {
  const s = String(prompt ?? "");
  const end = s.startsWith(CONTEXT_HEAD) ? HEAD_END.exec(s) : null;
  if (!end) return { head: "", rest: s };
  const after = end.index + end[0].length;
  return { head: s.slice(0, after - RULE.length), rest: s.slice(after) };
}

/** What follows Filament's head in a prompt; the prompt itself where it has none. @param {unknown} prompt */
export const afterHead = (prompt) => splitHead(prompt).rest;
