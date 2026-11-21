// Redact obvious secrets from anything we store. A leaf module on purpose: the op log (services/oplog.js) redacts at
// the sink, and the records, the memory import and the agent's tools import these from here too.
// The key list is a single source shared by the quoted-value pattern below and `redactUnterminatedSecretTail`, so the
// two cannot drift: that helper exists only to finish a match this pattern started but could not terminate.
import { truncateMarked } from "./text.js";

const SECRET_KEYS =
  "x-api-key|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password";
const QUOTED_SECRET = new RegExp(`("(?:${SECRET_KEYS})"\\s*:\\s*")[^"]+"`, "gi");
// Same shape, but matching a value that runs to the END of the string with no closing quote.
const UNTERMINATED_QUOTED_SECRET = new RegExp(`("(?:${SECRET_KEYS})"\\s*:\\s*")[^"]*$`, "i");

// Where a key's shape starts a key, never inside a word ("task-graph-runner", "disk-usage-monitor": words of the
// conversation, which were cut on disk as "task-grap…"): after no letter or digit, or after one that ends an escape —
// a newline or tab in JSON (\n, \t), \uXXXX, %XX, a terminal's code (ESC[32m, ESC[2K). The run files redact an event's
// JSON, where a key on a line of its own stands after the n of \n (the review of 11-16). Any backslash before the
// letter counts: JSON inside JSON (a tool's result that is JSON) writes a newline as \\n, the same characters as a
// backslash in a path before a folder's name, which a redactor of secrets cuts rather than leave a key whole.
const KEY_STARTS = String.raw`(?<=^|[^A-Za-z0-9]|\\(?:[nrtbf]|u[0-9A-Fa-f]{4})|%[0-9A-Fa-f]{2}|(?:\x1b|\\u001[bB])\[[0-9;?]*[A-Za-z])`;
/** @param {string} shape */
const keyShape = (shape) => new RegExp(KEY_STARTS + shape, "g");
const ANTHROPIC_OPENAI = keyShape(String.raw`(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]{8,}`);
const GOOGLE = keyShape(String.raw`(AIza)[0-9A-Za-z_-]{20,}`);
const GITHUB = keyShape(String.raw`(gh[pousr]_)[A-Za-z0-9]{20,}`);
const QODER = keyShape(String.raw`((?:pt|jt|dt)-)[A-Za-z0-9_-]{12,}`);

export function redactSecrets(value) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (!s) return value;
  const red = s
    .replace(ANTHROPIC_OPENAI, "$1…")
    .replace(GOOGLE, "$1…")
    .replace(GITHUB, "$1…")
    .replace(QODER, "$1…") // Qoder tokens
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1[redacted]")
    .replace(QUOTED_SECRET, '$1[redacted]"');
  return typeof value === "string" ? red : JSON.parse(red);
}

// Finish a quoted-secret match whose closing quote never arrived, because the text was cut. Needed by callers that
// redact a bounded window of a larger body before truncating it: every other pattern above matches on a MINIMUM
// PREFIX, so it still fires when the token is cut mid-way, but this one needs its terminator — and a credential
// longer than the window under a recognized key would otherwise be stored raw.
export function redactUnterminatedSecretTail(s) {
  const str = typeof s === "string" ? s : String(s ?? "");
  return UNTERMINATED_QUOTED_SECRET.test(str) ? str.replace(UNTERMINATED_QUOTED_SECRET, "$1[redacted]") : str;
}

// Redact and cap a stored body without scanning bytes that are about to be thrown away.
//
// Only the first `maxStoredBodyBytes` (2 MB by default) are ever kept, but the old order — redact the WHOLE body, then
// truncate — ran the secret regex over everything that came in. Measured on the request path: 3.5 ms for a 2 MB body,
// 13.9 ms for 8 MB, 53.5 ms for 32 MB, all of it blocking the event loop of a proxy whose entire job is moving other
// people's bytes. With `storeBodies: full` that is paid on every single request.
//
// The window is `max + REDACT_MARGIN`, not exactly `max`. Why a margin is needed at all: five of the six patterns in
// `redactSecrets` match on a MINIMUM PREFIX (`sk-` + 4 + 8 more, say), so they still fire on a token cut mid-way — but
// only if enough of the token is inside the window to satisfy that minimum. With no margin, a key straddling the cap
// leaves a 5–14 character residue: too short to match, long enough to be a real fragment of a credential sitting in the
// log. The margin guarantees any secret overlapping the kept region is present in full, so it is redacted exactly as
// the old whole-body scan redacted it. The sixth pattern is the exception — it needs a closing QUOTE, not a length —
// so it is closed off separately by `redactUnterminatedSecretTail`; a margin alone would only move that hole deeper.
const REDACT_MARGIN = 8192;
export function redactAndCap(value, max) {
  if (typeof value !== "string") return truncateMarked(redactSecrets(value), max); // objects: the old path, which round-trips JSON
  if (value.length <= max) return redactSecrets(value);
  const red = redactSecrets(value.slice(0, max + REDACT_MARGIN));
  // Sealed BEFORE the marker is appended: a quoted secret whose value is longer than the whole margin has no closing
  // quote inside the window, so the pattern that needs a terminator never fires and its raw prefix would be stored.
  // Every other pattern matches on a minimum prefix and fires even when the token is cut, so this is the one hole —
  // and a fixed margin only moves it, which is why it is closed explicitly rather than by choosing a bigger number.
  const kept = redactUnterminatedSecretTail(red.length > max ? red.slice(0, max) : red);
  // The count is of the ORIGINAL body, so it says how much of the request was dropped, not how much the redactor
  // happened to shrink. Nothing parses this marker; replay refuses any truncated body outright.
  return `${kept}…[truncated ${value.length - kept.length} chars]`;
}

// A header whose NAME looks like a credential: the configuration seals its value on disk and masks it in the UI and the
// assistant (services/config/secrets.js), and the record masks it as sent.
export const SECRET_HEADER_RE = /authorization|api[-_]?key|token|secret|cookie|credential|passw/i;

// A header map with its credentials masked, for the record and the dry-run view. The header NAMES stay: which headers
// were sent is exactly what a shaping question needs to see; only the values of credential-named ones are secrets —
// the bearer's, and an extra header's such as `api-key`, `x-goog-api-key` or `cookie`.
export function redactHeaders(h) {
  const out = { ...h };
  for (const k of Object.keys(out)) if (SECRET_HEADER_RE.test(k)) out[k] = "[redacted]";
  return out;
}

/**
 * A session's own redaction (`privacy.redact`, HarnessV2 §5.8): every pattern — a regular expression written as a
 * string — replaced with [redacted] wherever it matches, before a model reads the text. Built once per turn. A pattern
 * that does not compile, or that matches the empty string (it would match between every two characters), is left out;
 * the document's validator refuses both on the way in. Null when there is nothing to apply: every source takes a null
 * redactor as none, and a background shell holds back an unfinished line only for a session that redacts.
 * @param {unknown} patterns
 * @returns {((text: string) => string) | null}
 */
export function redactorOf(patterns) {
  /** @type {RegExp[]} */
  const compiled = [];
  for (const p of Array.isArray(patterns) ? patterns : []) {
    if (typeof p !== "string" || !p) continue;
    try {
      const re = new RegExp(p, "g");
      if (!re.test("")) compiled.push(re);
    } catch {}
  }
  if (!compiled.length) return null;
  return (text) => compiled.reduce((s, re) => s.replace(re, "[redacted]"), String(text ?? ""));
}
