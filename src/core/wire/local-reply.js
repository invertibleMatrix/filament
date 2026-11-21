// @ts-check
// The one place a filament-authored message is shaped: chat command answers — a reply Filament writes itself instead of calling a model. One text, in the client's wire format, with a usage block that reports
// the reply's own size (input 0: nothing was sent anywhere).
import { estimateTokens } from "../tokens.js";

/**
 * @param {"anthropic" | "openai"} format  the client's wire format (Responses clients are bridged to openai upstream)
 * @param {{ model: string, text: string, now: number }} reply  `now` is the caller's clock (ms), so this stays pure
 */
export function localReply(format, { model, text, now }) {
  const tokens = estimateTokens(text);
  if (format === "anthropic") {
    return {
      id: `msg_filament_${now.toString(36)}`,
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: tokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };
  }
  return {
    id: `chatcmpl-filament-${now.toString(36)}`,
    object: "chat.completion",
    created: Math.floor(now / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: tokens, total_tokens: tokens },
  };
}
