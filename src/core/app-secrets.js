// @ts-check
// An app's secrets (the Space Apps plan of 10-29): the names its app.json declares, each with a line on what it is for;
// their values typed in Filament's own sheet and sealed on disk (services/app-secrets.js), handed to its commands in
// their environment by name, and hidden in what those commands say — never seen by its page or by an agent.

/** A secret's name: an environment variable's, in capitals. */
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
/** How many secrets an app may declare, and how long each one's line may be. */
export const SECRETS_MAX = 20;
export const SECRET_ABOUT_MAX = 200;
/** How long a value may be: shorter than the least is no secret, and could not be told apart in what a command says. */
export const SECRET_VALUE_MIN = 4;
export const SECRET_VALUE_MAX = 8192;
/**
 * The names a secret may not take: the ones a command needs from Filament's own environment to run at all, and
 * Filament's own.
 */
const RESERVED = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|TEMP|TMP|SHELL|NODE_OPTIONS|FILAMENT_[A-Z0-9_]*)$/;

/** How a hidden value reads in what a command said. @param {string} name */
export const hiddenWords = (name) => `[${name} hidden]`;

/**
 * Why a name is no secret's, as its refusal says it, or null: wherever secrets are named — an app's publish, a script
 * watcher's trigger (core/watchers.js) — a name is an environment variable's, and none a command needs from Filament's
 * own environment. @param {string} name
 */
export function secretNameRefusal(name) {
  if (!SECRET_NAME.test(name)) return `secrets names ${JSON.stringify(name.slice(0, 64))}: a secret's name is its environment variable's, in capitals, digits and _ (GITHUB_TOKEN)`;
  if (RESERVED.test(name)) return `secrets names ${name}, which its commands need from Filament's own environment: name it otherwise`;
  return null;
}

/**
 * The secrets a publish declares (`secrets`: each name and a line on what it is for), or what is wrong, in words.
 * @param {unknown} v
 * @returns {{ ok: true, secrets: Record<string, string> | null } | { ok: false, error: string }}
 */
export function secretsOf(v) {
  if (v == null) return { ok: true, secrets: null };
  const shape = `secrets is an object of each secret's name and a line on what it is for, ${SECRETS_MAX} at most: {"GITHUB_TOKEN":"A GitHub token that reads this repository's runs"}`;
  if (typeof v !== "object" || Array.isArray(v) || !Object.keys(v).length || Object.keys(v).length > SECRETS_MAX) return { ok: false, error: shape };
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, about] of Object.entries(v)) {
    const why = secretNameRefusal(name);
    if (why) return { ok: false, error: why };
    if (typeof about !== "string" || !about.trim() || about.length > SECRET_ABOUT_MAX) return { ok: false, error: `secrets' ${name} is no line: what it is for, which the person reads as they type it, ${SECRET_ABOUT_MAX} characters at most` };
    out[name] = about.trim();
  }
  return { ok: true, secrets: out };
}

/**
 * A value as the sheet hands it in, or why it cannot be kept. @param {unknown} v
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function secretValue(v) {
  if (typeof v !== "string") return { ok: false, error: "a secret's value is text" };
  const value = v.trim();
  if (value.length < SECRET_VALUE_MIN) return { ok: false, error: `a secret is ${SECRET_VALUE_MIN} characters at least` };
  if (value.length > SECRET_VALUE_MAX) return { ok: false, error: `a secret is ${SECRET_VALUE_MAX} characters at most` };
  if (/[\0\r\n]/.test(value)) return { ok: false, error: "a secret is one line" };
  return { ok: true, value };
}

/**
 * The forms a value takes in what a command or an address answers: as typed, escaped in JSON, encoded in an address
 * (as a fetch fills one), escaped in XML or HTML — as PHP (&#039;), Python (&#x27;) and Go (&#34;, &#39;) write it too
 * (found reviewing the Space work, 10-29) —, each once. @param {string} v
 */
function formsOf(v) {
  const xml = v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const quoted = xml.replace(/"/g, "&quot;");
  return [
    ...new Set([
      v,
      JSON.stringify(v).slice(1, -1),
      encodeURIComponent(v),
      xml,
      quoted.replace(/'/g, "&#39;"),
      quoted.replace(/'/g, "&apos;"),
      quoted.replace(/'/g, "&#039;"),
      quoted.replace(/'/g, "&#x27;"),
      xml.replace(/"/g, "&#34;").replace(/'/g, "&#39;"),
    ]),
  ];
}

/**
 * What was read from what a command said — rows, their cells, however deep — with each text hidden by `hide`, its
 * names too (a JSON answer's own fields name a row's columns).
 * @template T @param {T} v @param {(s: string) => string} hide @returns {T}
 */
export function hiddenIn(v, hide) {
  if (typeof v === "string") return /** @type {T} */ (/** @type {unknown} */ (hide(v)));
  // A number whose digits hold a secret, however its answer wrote it (1.2345678e7 for 12345678), as its words, hidden
  // (found by the review of 10-29); any other stays a number.
  if (typeof v === "number") {
    const said = String(v);
    const hid = hide(said);
    return /** @type {T} */ (/** @type {unknown} */ (hid === said ? v : hid));
  }
  if (Array.isArray(v)) return /** @type {T} */ (/** @type {unknown} */ (v.map((x) => hiddenIn(x, hide))));
  if (v && typeof v === "object") return /** @type {T} */ (Object.fromEntries(Object.entries(v).map(([k, x]) => [hide(k), hiddenIn(x, hide)])));
  return v;
}

/**
 * What hides an app's secrets in what its commands say: `text` hides each value in a whole text, in each of its forms,
 * the longest first; `stream` hides them in a text that comes in pieces, holding back the end of each piece that could
 * begin one until the next piece — or the end — says whether it does.
 * @param {Record<string, string>} values  each secret's value, by its name
 */
export function hider(values) {
  const pairs = Object.entries(values)
    .filter(([, v]) => typeof v === "string" && v.length >= SECRET_VALUE_MIN)
    .flatMap(([name, v]) => formsOf(v).map((f) => /** @type {[string, string]} */ ([name, f])))
    .sort((a, b) => b[1].length - a[1].length);
  const hold = pairs.length ? pairs[0][1].length - 1 : 0;
  /** @param {string} s */
  const text = (s) => {
    let out = String(s ?? "");
    for (const [name, v] of pairs) if (out.includes(v)) out = out.split(v).join(hiddenWords(name));
    return out;
  };
  return {
    /** Whether there is anything to hide. */
    any: pairs.length > 0,
    text,
    /**
     * A stream's pieces, each told on once what it held back can no longer begin a value. @param {(s: string) => void} emit
     */
    stream(emit) {
      let carry = "";
      return {
        /** @param {string} chunk */
        push(chunk) {
          if (!pairs.length) return emit(chunk);
          const seen = text(carry + chunk);
          const cut = Math.max(0, seen.length - hold);
          carry = seen.slice(cut);
          if (cut) emit(seen.slice(0, cut));
        },
        end() {
          if (carry) emit(text(carry));
          carry = "";
        },
      };
    },
  };
}
