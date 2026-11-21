// Housekeeping requests: calls a client makes to "its model" that are not conversation at all.
// A chat client may, for example, ask the model for a 3-7 word session title after the first message. Sent to a coding
// agent, that instruction reads like a task: the agent opens a second session and starts working on the user's
// message in parallel with the real one. These helpers recognise such requests so the server can answer them
// itself or hand them to a cheap API model.
import { flattenMessages } from "../core/wire/flatten.js";

const NOT_A_CONVERSATION =
  /not a conversation|(title|summary|summar[iy][sz]ation)[- ]generation task|treat the user'?s message only as source material|never answer the user'?s question|return exactly one valid json object/i;

// A LOWER BOUND on the system prompt's length, counted without flattening the conversation.
//
// The bound has to hold against the value the real check uses, which is `join("\n").trim()` — so each piece is
// measured TRIMMED. That is what keeps it a true lower bound: trimming the join only removes characters, and interior
// pieces keep their own boundary whitespace inside the joined string, so the sum of the per-piece trims can never
// exceed the trimmed total. Counting raw lengths instead would over-count a prompt padded with trailing newlines and
// could reject a genuine housekeeping request — which would wake a coding agent with a title prompt, the exact
// failure this whole module exists to prevent.
function systemLengthFloor(format, body, msgs) {
  const of = (c) => {
    if (typeof c === "string") return c.trim().length;
    if (!Array.isArray(c)) return 0;
    let n = 0;
    for (const b of c) {
      if (typeof b === "string") n += b.trim().length;
      else if (b?.type === "text" && typeof b.text === "string") n += b.text.trim().length;
    }
    return n;
  };
  if (format === "anthropic") return of(body?.system);
  let n = 0;
  for (const m of msgs) if (m?.role === "system" || m?.role === "developer") n += of(m.content);
  return n;
}

export function detectHousekeeping(format, body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  // Cheap gates FIRST. flattenMessages builds a text string for every message in the conversation — megabytes on a
  // long session — and this ran on every single request purely to discover that a real conversation is not
  // housekeeping. These reject that case in O(1) or with role-only scans, so the flatten now happens only for the
  // small, assistant-free, short-system-prompt requests that could actually be housekeeping.
  // Note there is deliberately NO `!msgs.length` early return: an empty message list with a housekeeping system
  // prompt used to be detected (and answered locally with an empty source), and changing that would hand a title
  // prompt to a coding agent.
  if (Array.isArray(body?.tools) && body.tools.length) return null; // tools mean the client expects real work
  for (const m of msgs) if (m?.role === "assistant") return null; // a real back-and-forth is never housekeeping
  if (systemLengthFloor(format, body, msgs) > 4000) return null; // a real system prompt is long; a housekeeping one is short
  const flat = flattenMessages(format, body);
  const sys = flat
    .filter((m) => m.role === "system")
    .map((m) => m.text || "")
    .join("\n")
    .trim();
  if (!sys || sys.length > 4000) return null;
  if (flat.some((m) => m.role === "assistant")) return null; // re-checked on the flattened view, so behaviour is unchanged
  if (!NOT_A_CONVERSATION.test(sys)) return null;
  const source = flat.filter((m) => m.role === "user").at(-1)?.text || "";
  if (/\btitle\b/i.test(sys)) return { kind: "title", source, wantsJson: /\bjson\b/i.test(sys) };
  if (/\b(summar(y|ize|ise)|condense|compact)\b/i.test(sys)) return { kind: "summary", source };
  return { kind: "other", source };
}

// A plain summary of the conversation, for a client's compaction request when no housekeeping model is configured.
// No model involved: the last turns, trimmed, in order. Good enough to keep the client moving; a housekeepingModel
// gives a real summary.
export function makeSummary(format, body, { maxTurns = 14, maxChars = 400 } = {}) {
  const flat = flattenMessages(format, body).filter((m) => m.role !== "system");
  const src = flat.filter((m) => m.role === "user").at(-1)?.text || "";
  // the text to summarise is usually embedded in the user message; use the whole conversation when it is short
  const turns = flat.slice(-maxTurns).map(
    (m) =>
      `${m.role === "user" ? "User" : "Assistant"}: ${String(m.text || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxChars)}${String(m.text || "").length > maxChars ? "…" : ""}`,
  );
  const body_ = turns.length ? turns.join("\n") : src.slice(0, 2000);
  return `Summary of the conversation so far (kept verbatim and trimmed by Filament; set acp.housekeepingModel for a written summary):\n${body_}`;
}

const FILLER = new Set([
  "ok",
  "okay",
  "so",
  "hey",
  "hi",
  "hello",
  "please",
  "can",
  "could",
  "you",
  "i",
  "want",
  "would",
  "like",
  "to",
  "now",
  "also",
  "and",
  "then",
  "just",
  "the",
  "a",
  "um",
  "well",
]);

// A serviceable title from the user's own words: first sentence, filler dropped, at most seven words.
export function makeTitle(text, { json = true } = {}) {
  let t = String(text || "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ")
    .replace(/<\/?[a-z_][\w-]{0,40}>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[`*_#>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const first = t.split(/(?<=[.!?])\s+/).find((s) => s.trim().split(" ").length >= 2) || t;
  let words = first.split(" ").filter(Boolean);
  while (words.length > 3 && FILLER.has(words[0].toLowerCase().replace(/[^a-z]/g, ""))) words.shift();
  words = words.slice(0, 7);
  let title = words
    .join(" ")
    .replace(/[\s,:;.!?]+$/, "")
    .trim();
  if (title.length > 60) title = title.slice(0, 57).trimEnd() + "…";
  if (!title) title = "New chat";
  title = title[0].toUpperCase() + title.slice(1);
  return json ? JSON.stringify({ title }) : title;
}
