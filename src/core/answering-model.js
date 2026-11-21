// @ts-check
// Whether the model that answered a turn is the one its chat names. A coding agent handed a name it does not run on
// (one typed on its account's card that the account is not offered, a set it answered with another model, a turn it
// sent elsewhere) keeps its own model and answers on it without a word; `answeredAs` reads the two names as they are
// spelled and says "different" only where they cannot be one model. It says "unknown" wherever one of them names no
// model (`default`, `auto`, nothing) or the two may be one (an alias a person's settings or a gateway point
// elsewhere, a name the other's beginning): whoever asks then says nothing. Where the agent itself said it is not on
// the model asked for (`sure`), two names that are not one are two models. `mainCounted` is the model a turn's
// counted tokens name.
import { parseVariant } from "./model-families.js";

/** The bare words a coding agent takes for a family's model (`opus`, `opus[1m]`). */
const FAMILIES = new Set(["opus", "sonnet", "haiku", "fable"]);
/** What names nothing: no name, the agent's default, a message its agent wrote itself. */
const NO_MODEL = new Set(["", "default", "<synthetic>"]);
/** The agent's own pick, under the word or its own name for it (Cursor's `auto-smart`): whatever it picks answers. @param {string} name */
const ownPick = (name) => name === "auto" || name.startsWith("auto-");

/**
 * A model's name as it is compared: lower case, without a route's prefix (`anthropic/…`, Bedrock's
 * `us.anthropic.…`), and without what is said after the model — its variant words (`parseVariant`: an effort, a
 * `[1m]` window mark, a speed, thinking), a date (`-20261001`, `-2024-08-06`, `@20261001`, `-latest`), Bedrock's
 * `-v1:0` — in any order; a version's dot reads as its dash (`5.5` is `5-5`).
 * @param {unknown} id
 */
function plainName(id) {
  let s = String(id ?? "").trim().toLowerCase();
  s = (s.split("/").pop() || "").replace(/^(?:[a-z]{2,6}\.)?anthropic\./, "").replace(/@[\w.-]*$/, "");
  for (let guard = 0; guard < 6; guard++) {
    const was = s;
    s = parseVariant(s).base.replace(/-v\d+(?::\d+)?$/, "").replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2}|latest)$/, "");
    if (s === was) break;
  }
  return s.replace(/(\d)\.(?=\d)/g, "$1-");
}

/** A compared name's words. @param {string} name */
const wordsOf = (name) => name.split(/[^a-z0-9]+/).filter(Boolean);

/**
 * One name against a bare word: the word in the name is the same model; a family's word (`FAMILIES`) against a name
 * of another family is another model; anything else may be either.
 * @param {string} word @param {string[]} name
 * @returns {"same" | "different" | "unknown"}
 */
function wordIn(word, name) {
  if (name.includes(word)) return "same";
  return FAMILIES.has(word) && name.some((w) => FAMILIES.has(w)) ? "different" : "unknown";
}

/**
 * Two names of several words each. "same": one the other's ending (`opus-5-5`, `claude-opus-5-5`), or the same words
 * in another order. "unknown": one name's words all in the other (`claude-opus-5`, `claude-opus-5-5`: a version alias
 * or another model, which the names do not say). Else two names that share no reading — "different" where both are
 * models' own names: each names a family and they name no family in common, or each carries a version's number; a
 * name without either is an alias that may point at any model ("unknown").
 * @param {string[]} a @param {string[]} b
 * @returns {"same" | "different" | "unknown"}
 */
function namesApart(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.every((w, i) => w === long[long.length - short.length + i])) return "same";
  const left = [...long];
  const within = short.every((w) => {
    const i = left.indexOf(w);
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  });
  if (within) return left.length ? "unknown" : "same";
  const families = (/** @type {string[]} */ ws) => ws.filter((w) => FAMILIES.has(w));
  const [fa, fb] = [families(a), families(b)];
  if (fa.length && fb.length && !fa.some((w) => fb.includes(w))) return "different";
  const versioned = (/** @type {string[]} */ ws) => ws.some((w) => /\d/.test(w));
  return versioned(a) && versioned(b) ? "different" : "unknown";
}

/**
 * Whether `answered`, the model an agent says answered, is `chosen`, the model its chat names (as sent to the agent).
 * "same": one name under its marks, or two names with one reading (`namesApart`, `wordIn`). "different": two names
 * that cannot be one model. "unknown": a side that names nothing, a chat on the agent's own pick (`ownPick`), an
 * answer under that pick's name, or two names that may be one model.
 * `sure`: the agent itself said it is not on the model asked for — it does not offer it, it answered its set with
 * another, it moved the turn. Two names are then "different" unless they are one, the agent's own pick among them.
 * @param {unknown} chosen @param {unknown} answered @param {{ sure?: boolean }} [o]
 * @returns {"same" | "different" | "unknown"}
 */
export function answeredAs(chosen, answered, { sure = false } = {}) {
  const want = plainName(chosen);
  const got = plainName(answered);
  if (NO_MODEL.has(want) || NO_MODEL.has(got) || ownPick(want) || (ownPick(got) && !sure)) return "unknown";
  if (want === got) return "same";
  const a = wordsOf(want);
  const b = wordsOf(got);
  if (!a.length || !b.length) return "unknown";
  const read = a.length === 1 ? wordIn(a[0], b) : b.length === 1 ? wordIn(b[0], a) : namesApart(a, b);
  return sure && read === "unknown" ? "different" : read;
}

/**
 * The model a coding agent's turn ran on, of the models that counted its tokens: the one that read the most (a helper
 * model reads a few thousand tokens, the session's the whole conversation), ties by what it wrote. Null where no row
 * names a model.
 * @template {{ model?: string, input?: number, output?: number, cacheRead?: number, cacheWrite?: number }} T
 * @param {T[] | null | undefined} counted  a turn's `modelUsage`
 * @returns {T | null}
 */
export function mainCounted(counted) {
  const read = (/** @type {any} */ m) => (Number(m?.input) || 0) + (Number(m?.cacheRead) || 0) + (Number(m?.cacheWrite) || 0);
  return (Array.isArray(counted) ? counted : [])
    .filter((m) => m?.model)
    .sort((x, y) => read(y) - read(x) || (Number(y.output) || 0) - (Number(x.output) || 0))[0] || null;
}
