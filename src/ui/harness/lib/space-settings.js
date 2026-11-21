// @ts-check
// A Space's settings as the pages say them (the owner's of 11-04), DOM-free: what an app's ask does, each choice in
// words, and what a Space's agents run on in a line. The rules are the server's (core/space-settings.js `runsOnOf`);
// Settings › Space and a Space's ⋯ › Space settings… draw from these words.
import { levelWords } from "./families.js";

/** What an app's ask does — its page's button that asks an agent —, each as the pickers offer it, in their order. */
export const ASK_CHOICES = Object.freeze([
  { value: "ask", label: "Ask me first: run it here, or open a chat" },
  { value: "run", label: "Run it at once, in the background" },
  { value: "chat", label: "Open a chat with its words" },
]);

/** A choice's words; the first's for one that is none. @param {string} value */
export const askWords = (value) => (ASK_CHOICES.find((c) => c.value === value) || ASK_CHOICES[0]).label;

/**
 * What a Space runs on, as the server says it (`GET /space/:project`'s `runsOn`): its model, that model's effort, and
 * whose they are; what an app's ask does, and whose that is; why the model cannot run now, where it cannot.
 * @typedef {{ model: string, effort: string, from: "space" | "default" | "", asks: "ask" | "run" | "chat",
 *   asksFrom: "space" | "default" | "", problem?: string }} RunsOn
 */

/**
 * A model at its effort, as a line says them: "Opus 5.5 · High"; "" for none.
 * @param {string} model @param {string} effort @param {(id: string) => string} nameOf
 */
export const modelAt = (model, effort, nameOf) => (model ? `${nameOf(model) || model}${effort ? ` · ${levelWords(effort)}` : ""}` : "");

/**
 * What a Space's agents run on, in a line: its own, Settings › Space's, or none — what that means then.
 * @param {Pick<RunsOn, "model" | "effort" | "from">} on @param {(id: string) => string} nameOf
 */
export function runsOnWords(on, nameOf) {
  if (!on.model) return "No model chosen: each routine runs on its own, and an app's ask asks for one.";
  const at = modelAt(on.model, on.effort, nameOf);
  return on.from === "space" ? `${at}, this Space's own choice.` : `${at}, from Settings › Space.`;
}
