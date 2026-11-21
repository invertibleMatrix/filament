// @ts-check
// An app's hooks (the Space Apps plan of 10-29, phase 4): the collections a POST from this computer lands in — a git
// hook, a script, a local service telling the app something —, each at an address of its own that Filament makes when
// the app is kept (services/app-hooks.js) and answers at `/hook/<app>/<token>` (http/hooks.js). Each POST is one row of
// its collection: its body — as JSON where it says it is, a form's fields, else its text —, when it came, and its own
// x- headers that name no secret. Its page reads them as it reads what it keeps (`filament.db`).

/** A hook's name: the collection its POSTs go into, as a collection is named. */
export const HOOK_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** How many hooks an app may declare, and how long each one's line may be. */
export const HOOKS_MAX = 10;
export const HOOK_ABOUT_MAX = 200;
/** How long a POST's body may be; how many rows a hook's collection keeps — the newest —; how many headers a row. */
export const HOOK_BYTES = 256 * 1024;
export const HOOK_ROWS_MAX = 500;
export const HOOK_HEADERS_MAX = 20;
/** How long one header's value a row keeps. */
const HEADER_MAX = 500;
/** A header that may carry a secret, which no row keeps. */
const SECRET_HEADER = /key|token|secret|auth|cookie|pass|session/i;

/**
 * The hooks a publish declares (`hooks`: each collection's name and a line on what sends there), or what is wrong, in
 * words.
 * @param {unknown} v
 * @returns {{ ok: true, hooks: Record<string, string> | null } | { ok: false, error: string }}
 */
export function hooksOf(v) {
  if (v == null) return { ok: true, hooks: null };
  const shape = `hooks is an object of each collection a POST from this computer goes into and a line on what sends it there, ${HOOKS_MAX} at most: {"pushes":"The repository's post-receive hook, one row per push"}`;
  if (typeof v !== "object" || Array.isArray(v) || !Object.keys(v).length || Object.keys(v).length > HOOKS_MAX) return { ok: false, error: shape };
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, about] of Object.entries(v)) {
    if (!HOOK_NAME.test(name)) return { ok: false, error: `hooks names ${JSON.stringify(name.slice(0, 40))}: a hook is named as the collection its POSTs go into — lowercase letters, digits, - and _, 40 at most (pushes)` };
    if (typeof about !== "string" || !about.trim() || about.length > HOOK_ABOUT_MAX) return { ok: false, error: `hooks' ${name} is no line: what sends there, which the person reads as they keep it, ${HOOK_ABOUT_MAX} characters at most` };
    out[name] = about.trim();
  }
  return { ok: true, hooks: out };
}

/**
 * A POST's own x- headers that name no secret, as a row keeps them: `HOOK_HEADERS_MAX` at most, each value cut. A
 * watcher's post keeps the same (app/watchers/webhook.js).
 * @param {Record<string, unknown>} headers  as Node has them
 * @returns {Record<string, string>}
 */
export function hookHeaders(headers) {
  /** @type {Record<string, string>} */
  const kept = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (Object.keys(kept).length >= HOOK_HEADERS_MAX) break;
    const name = k.toLowerCase();
    if (!name.startsWith("x-") || SECRET_HEADER.test(name)) continue;
    kept[name] = (Array.isArray(v) ? v.join(", ") : String(v ?? "")).slice(0, HEADER_MAX);
  }
  return kept;
}

/** Whether a content type says its body is JSON. @param {string} type */
const isJson = (type) => /^(application|text)\/([\w.+-]*\+)?json\b/i.test(type);
/** Whether it says its body is a form's fields. @param {string} type */
const isForm = (type) => /^application\/x-www-form-urlencoded\b/i.test(type);

/**
 * One POST as the row its collection keeps, or why it is refused, in words its sender reads.
 * @param {{ at: number, type: string, text: string, headers: Record<string, unknown> }} post  `headers` as Node has them,
 *   in lowercase
 * @returns {{ ok: true, row: { at: number, kind: "json" | "form" | "text", body: unknown, headers: Record<string, string> } } | { ok: false, status: number, error: string }}
 */
export function hookRow({ at, type, text, headers }) {
  const t = String(type || "").trim();
  /** @type {"json" | "form" | "text"} */
  let kind = "text";
  /** @type {unknown} */
  let body = text === "" ? null : text;
  if (isJson(t)) {
    kind = "json";
    if (text.trim())
      try {
        body = JSON.parse(text);
      } catch {
        return { ok: false, status: 400, error: "its body says it is JSON (content-type) but does not read as JSON: nothing was kept" };
      }
    else body = null;
  } else if (isForm(t)) {
    kind = "form";
    body = Object.fromEntries(new URLSearchParams(text));
  }
  return { ok: true, row: { at, kind, body, headers: hookHeaders(headers) } };
}
