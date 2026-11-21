// What a scripted agent reads as the person's words — the fakes' triggers and echoes: its prompt without what Filament
// adds around them, the context said ahead (HarnessV3-ACP AC4-1) and memory's blocks. What the agent was sent whole
// stays in the fakes' logs. It imports nothing: a test that puts a fake beside an npm-style shim copies this with it.

const BLOCKS = /<filament-(memory|context)\b[^>]*>[\s\S]*?<\/filament-\1>/g;
// The context said ahead (`CONTEXT_HEAD`, `UPDATE_HEAD`): it opens with Filament's name and ends at its own rule.
const AHEAD = /(?:^|\n)Filament(?:, the harness|'s context)[\s\S]*?\n---\n/;

/** @param {string} text */
export function personWords(text) {
  return String(text || "").replace(BLOCKS, "").replace(AHEAD, "\n").trim();
}
