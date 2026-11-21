// @ts-check
// Turns: the unit every compaction mechanism cuts at. A turn starts at a user message that is not a tool result
// and runs until the next one; the last turn is the live one. This is the one definition — the fold and
// the slice pass all segment through here, so a cut in one is a cut in the others.
//
// Two readers, two shapes, kept because their callers grew up with them:
//   - `segmentTurns` skips the leading system/developer messages (they are not conversation) and flags an
//     assistant-first prologue, returning `{ lead, groups }` — what the fold needs.
//   - `turnGroups` starts at message 0 and returns bare `{ from, to }` groups, an assistant-first prologue included
//     as an unflagged first group — what the slice pass needs.

/**
 * A user message that only carries tool results: not a turn boundary in any wire format.
 * @param {any} m @param {string} format
 */
export const isToolLeg = (m, format) => {
  if (format === "anthropic") {
    return Array.isArray(m?.content) && m.content.length > 0 && m.content[0]?.type === "tool_result";
  }
  return m?.role === "tool";
};

/**
 * Indices of the messages that start a turn, from `from` on.
 * @param {any[]} messages @param {string} format @param {number} from
 * @returns {number[]}
 */
export const turnStarts = (messages, format, from) =>
  messages
    .map((m, i) => ({ m, i }))
    .slice(from)
    .filter(({ m }) => m?.role === "user" && !isToolLeg(m, format))
    .map(({ i }) => i);

/**
 * @typedef {{ from: number, to: number, prologue?: true }} TurnGroup  Messages [from, to) form one turn.
 */

/**
 * Leading system/developer messages are not conversation and pass through untouched. Every group starts at a user
 * message that is not a tool result; the last group is the live turn. An assistant-first prologue is its own group,
 * flagged, so callers can pass it through raw.
 * @param {any[]} messages @param {string} format
 * @returns {{ lead: number, groups: TurnGroup[] }}
 */
export function segmentTurns(messages, format) {
  const n = Array.isArray(messages) ? messages.length : 0;
  let lead = 0;
  while (lead < n && (messages[lead]?.role === "system" || messages[lead]?.role === "developer")) lead++;
  const starts = turnStarts(messages, format, lead);
  /** @type {TurnGroup[]} */
  const groups = [];
  if (!starts.length) return { lead, groups: n > lead ? [{ from: lead, to: n, prologue: true }] : [] };
  if (starts[0] > lead) groups.push({ from: lead, to: starts[0], prologue: true });
  for (let i = 0; i < starts.length; i++) {
    groups.push({ from: starts[i], to: i + 1 < starts.length ? starts[i + 1] : n });
  }
  return { lead, groups };
}

/**
 * The same segmentation from message 0, as bare groups: leading system messages and an assistant-first prologue
 * land in an unflagged first group.
 * @param {any[]} messages @param {string} format
 * @returns {{ from: number, to: number }[]}
 */
export function turnGroups(messages, format) {
  const n = Array.isArray(messages) ? messages.length : 0;
  if (!n) return [];
  const starts = turnStarts(messages, format, 0);
  if (!starts.length) return [{ from: 0, to: n }];
  const groups = [];
  if (starts[0] > 0) groups.push({ from: 0, to: starts[0] });
  for (let i = 0; i < starts.length; i++) {
    groups.push({ from: starts[i], to: i + 1 < starts.length ? starts[i + 1] : n });
  }
  return groups;
}
