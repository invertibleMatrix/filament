// @ts-check
// Value classes (HarnessV3-Memory M3-2): the typed values a claim's words hold, read deterministically — the package
// manager a project uses, the folder it is checked out in, whether file tools exist, the machine's platform, a cloud
// region, a port. Each class is exclusive for its subject: a project has one package manager and one checkout at a
// time. The environment check (M3-4) compares them with what the request shows; blame on correction (M3-5) compares a
// correction's value with the values of the claims the session was shown.
//
// Read at use time, never stored (M3-D2): every claim on file is covered, old ones included. A claim's stored slot
// (M2-5) is read first, its words are the fallback. Precision before recall: a class holds a value only in its own
// wording ("uses pnpm", never "run npm test"), and only when the words name exactly one current value of it.
import { ECOSYSTEM } from "../../core/package-managers.js";

const PM = Object.keys(ECOSYSTEM).join("|");
// A manager in a manager's wording. Bare "on npm" and "with npm" are left out: as often the registry ("published on
// npm") or something else entirely ("served with bun").
const MANAGER_RE = [
  new RegExp(String.raw`\b(?:use|uses|using|used|switch(?:ed|ing)?(?: over)? to|mov(?:e|ed|ing) to|migrat(?:e|ed|ing) to|went (?:with|to)|go(?:ing)? with|stick(?:ing)? with|prefers?|preferred|(?:we['’]re|we are|we['’]ve been|now|still) on)\s+(${PM})\b`, "gi"),
  new RegExp(String.raw`\b(?:from|replac(?:e|es|ed|ing))\s+(?:${PM})\s+(?:to|with|by|for)\s+(${PM})\b`, "gi"),
  new RegExp(String.raw`\b(?:install|installs|installed|installing|manage|manages|managed|managing)\s+(?:\S+\s+){0,3}?(?:with|via|using|through)\s+(${PM})\b`, "gi"),
  new RegExp(String.raw`\b(${PM})\s+(?:for|as)\s+(?:(?:the|our|its|all|package|dependency)\s+)*(?:installs?|installing|installations?|packages?|package[ -]manager|dependenc(?:y|ies)|deps)\b`, "gi"),
  new RegExp(String.raw`\bpackage[ -]manager\s*(?:is|was|:|=|of choice is|here is)\s*(${PM})\b`, "gi"),
  new RegExp(String.raw`\b(${PM})\s+is\s+(?:the|our|its)\s+package[ -]manager\b`, "gi"),
  new RegExp(String.raw`\b(${PM})\s+(?:install|add|ci)\b`, "gi"),
];
// What names a value as the one left behind or refused: "bun instead of pnpm", "from pnpm", "don't use npm".
const OLD_BEFORE = /\b(?:instead of|rather than|not|no longer|never|don['’]t|do not|stop|stopped|from|over|than|replac(?:e|es|ed|ing))\s+(?:(?:use|uses|using|used|run|running|the|a|with)\s+)?$/i;
const OLD_AFTER = /^\s*(?:→|->)/;
// A package manager is this project's unless its clause opens on another subject: "the frontend uses yarn", "their
// repo uses yarn", "Hermes uses uv". "We use", "this project uses", "use bun" and "package manager: bun" are this one's.
const CLAUSE_END = /[.;:!?\n,(]|\b(?:and|but|while|whereas|though)\b/gi;
// The learner's own phrasing ("the user prefers pnpm", "the team uses bun") is the person's work, so not another subject.
const LEAD_IN = String.raw`^\s*(?:(?:[Nn]o|[Yy]es|[Oo]k(?:ay)?|[Ss]o|[Aa]lso|[Aa]ctually|[Rr]emember(?: that)?|[Nn]ote(?: that)?)[\s,]+)*`;
const OTHER_SUBJECT = new RegExp(String.raw`${LEAD_IN}(?:the\s+(?!(?:project|repo|repository|codebase|monorepo|app|workspace|user|owner|developer|person|team)\b)|(?:a|an|their|his|her|another|each|every)\s+)\w`, "i");
const NAMED_SUBJECT = new RegExp(String.raw`${LEAD_IN}(?!(?:We|I|It|This|Our|Use|Using|Always|Never|Now|Please|Just|Only|Remember|Note|Switch|Switched|Install|Run)\b)[A-Z][\w.-]*(?:\s+[A-Z][\w.-]*)*\s+(?:uses|used|is|was|prefers|has|runs|switched|moved|migrated)\b`);
/** Whether the clause that ends at `at` is about this project. @param {string} text @param {number} at */
function ofThisProject(text, at) {
  const before = text.slice(0, at);
  let from = 0;
  for (const m of before.matchAll(CLAUSE_END)) from = (m.index ?? 0) + m[0].length;
  const clause = before.slice(from);
  return !OTHER_SUBJECT.test(clause) && !NAMED_SUBJECT.test(clause);
}

// An absolute path: a Windows drive path, a UNC path, or a POSIX path under a root a checkout lives in (a bare
// "/api/memory" is a route, and "example.com/home/x" a link, not a folder).
const PATH_RE = /(?<![\w.:/\\-])(?:[A-Za-z]:[\\/][^\s"'`<>|*?,;()[\]]*|\\\\[^\s"'`<>|*?,;()[\]]+|(?:~|\/(?:home|Users|usr|opt|srv|var|mnt|tmp|root|data|workspaces?|projects?|code|repos?|work))(?:\/[\w.@~+-]+)+\/?)/g;
// What says the path is where THIS project is, right before it: this project as the subject of a location verb ("this
// project is checked out at", "the repo lives in", "we cloned it to") or the working folder named ("working directory:").
// "The vault lives at …" and "this project's backups are at …" are about other folders.
const FOLDER_SUBJECT = String.raw`(?:\b(?:this|the|our|my)\s+(?:project|repo|repository|codebase|checkout|clone|workspace|monorepo)\b|\b(?:we|i)\b)(?:['’](?:re|m|ve))?`;
const FOLDER_AUX = String.raw`(?:\s+(?:is|are|was|were|am|has|have|been|now|currently|still|always))*`;
const FOLDER_VERB = String.raw`\s+(?:(?:lives?|living|sits?|resides?|located|checked[ -]out|cloned(?:\s+it)?|moved(?:\s+it)?)(?:\s+from\s+\S+)?\s+)?(?:at|in|under|to|into)`;
const WORKDIR = String.raw`\b(?:working (?:directory|folder|dir)|cwd|project root|repo(?:sitory)? root)\s*(?:is|:|=)?`;
const FOLDER_BEFORE = new RegExp(String.raw`(?:${FOLDER_SUBJECT}${FOLDER_AUX}${FOLDER_VERB}|${WORKDIR})\s*[\x60"']?$`, "i");

const FILE_TOOLS_NONE = [
  /\b(?:no|without)\s+(?:file|filesystem|file-?level)\s+tools?\b/i,
  /\bfile(?:-?level)?\s+tools?\s+(?:are\s+|were\s+)?(?:conditionally\s+|currently\s+)?(?:unavailable|not available|disabled|off|missing)\b/i,
  /\bcan(?:not|['’]t)\s+(?:read|write|edit)\s+(?:or\s+(?:read|write|edit)\s+)?files\b/i,
];

const OS = String.raw`(windows|mac\s?os(?:\s?x)?|os\s?x|linux|ubuntu|debian|fedora|wsl)`;
const PLATFORM_RE = [
  new RegExp(String.raw`\b(?:this|the|my|our)\s+(?:machine|computer|laptop|box|dev(?:elopment)? machine|workstation)\s+(?:is|runs|uses|has)\s+(?:on\s+)?(?:a\s+)?${OS}\b`, "gi"),
  new RegExp(String.raw`\b(?:we|i)(?:['’]re|['’]m| are| am)\s+(?:on|using|running)\s+${OS}\b`, "gi"),
  new RegExp(String.raw`\bruns?\s+locally\s+on\s+${OS}\b`, "gi"),
];

const REGION_RE = [
  /\b(?:us|eu|ap|sa|ca|me|af|il|mx|cn)-(?:gov-)?(?:north|south|east|west|central|northeast|southeast|northwest|southwest)-\d\b/gi,
  /\b(?:us|europe|asia|australia|southamerica|northamerica|me|africa)-(?:north|south|east|west|central|northeast|southeast|northwest|southwest)\d\b/gi,
];
const PORT_RE = [/\bport\s*(?:number\s*)?(?:is\s*|:|=|of\s*)?(\d{2,5})\b/gi, /\blisten(?:s|ing)?\s+on\s+(?:port\s+)?:(\d{2,5})\b/gi];

/** A stored slot's attribute (as `slotNorm` keeps it), as the class it is. */
const SLOT_CLASS = Object.freeze({
  "package manager": "package manager",
  "working folder": "working folder",
  "working directory": "working folder",
  "checkout folder": "working folder",
  platform: "platform",
  "operating system": "platform",
  os: "platform",
  region: "region",
  port: "port",
});

/** The classes, in the order they are read. */
export const VALUE_CLASSES = Object.freeze(["package manager", "working folder", "file tools", "platform", "region", "port"]);

/**
 * A value as its class compares it, or null when it is no value of the class (a slot's "bun (via bun.lock)").
 * @param {string} cls @param {unknown} v @returns {string | null}
 */
function normal(cls, v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (cls === "working folder") return s.replace(/[.,:;!?]+$/, "").replace(/(?<=.)[\\/]+$/, "");
  const k = s.toLowerCase();
  if (cls === "package manager") return Object.hasOwn(ECOSYSTEM, k) ? k : null;
  if (cls === "platform") {
    const p = k.replace(/\s+/g, "");
    if (p === "windows" || p === "win32") return "win32";
    if (/^(?:macos|macosx|osx|darwin)$/.test(p)) return "darwin";
    return /^(?:linux|ubuntu|debian|fedora|wsl)$/.test(p) ? "linux" : null;
  }
  if (cls === "port") return /^\d{2,5}$/.test(k) ? k : null;
  return k;
}

/**
 * The one current value among some matches, or null when none or more than one remain. A value named as the one left
 * behind ("instead of pnpm", "from pnpm", "don't use npm", "pnpm → bun") is set aside, and is never the answer.
 * `project` holds when some clause that names it is about this project (`ofThisProject`), when `subject` is given.
 * @param {string} text @param {RegExp[]} res @param {string} cls @param {boolean} [subject]
 * @returns {{ value: string, project: boolean } | null}
 */
function oneValue(text, res, cls, subject = false) {
  /** @type {Map<string, boolean>} */
  const kept = new Map();
  for (const re of res)
    for (const m of text.matchAll(re)) {
      const raw = m[1] ?? m[0];
      const start = (m.index ?? 0) + m[0].toLowerCase().indexOf(raw.toLowerCase());
      if (OLD_BEFORE.test(text.slice(Math.max(0, start - 40), start)) || OLD_AFTER.test(text.slice(start + raw.length))) continue;
      const v = normal(cls, raw);
      if (v) kept.set(v, kept.get(v) || !subject || ofThisProject(text, start));
    }
  if (kept.size !== 1) return null;
  const [[value, project]] = kept;
  return { value, project };
}

/**
 * The folder the words say this project is in, or null: an absolute path right after this project's location words.
 * @param {string} text
 */
function folderOf(text) {
  const kept = new Set();
  for (const m of text.matchAll(PATH_RE)) {
    const at = m.index ?? 0;
    if (!FOLDER_BEFORE.test(text.slice(Math.max(0, at - 120), at))) continue;
    const v = normal("working folder", m[0]);
    if (v) kept.add(v);
  }
  return kept.size === 1 ? [...kept][0] : null;
}

/**
 * The typed values a claim holds (HarnessV3-Memory M3-2), by class. `project` says the value is this project's (or
 * the person's own), which the environment check needs before it compares one with the request: a package manager
 * whose clause names another subject is not; a folder is only read when it is this project's; a slot is when its
 * subject is the project. Regions and ports are never checked against the environment, only corrected.
 * @param {string | { text?: string, slot?: string | null, slot_value?: string | null }} claim
 * @returns {Map<string, { value: string, project: boolean }>}
 */
export function valuesOf(claim) {
  const text = String(typeof claim === "string" ? claim : (claim?.text ?? ""));
  /** @type {Map<string, { value: string, project: boolean }>} */
  const out = new Map();
  if (typeof claim === "object" && claim?.slot) {
    const [subject, attribute] = String(claim.slot).split(" · ");
    const cls = SLOT_CLASS[/** @type {keyof typeof SLOT_CLASS} */ (attribute)];
    const value = cls ? normal(cls, claim.slot_value) : null;
    if (cls && value) out.set(cls, { value, project: subject === "project" });
  }
  const set = (/** @type {string} */ cls, /** @type {{ value: string, project: boolean } | null} */ v) => {
    if (v && !out.has(cls)) out.set(cls, v);
  };
  set("package manager", oneValue(text, MANAGER_RE, "package manager", true));
  const folder = folderOf(text);
  set("working folder", folder && { value: folder, project: true });
  if (FILE_TOOLS_NONE.some((re) => re.test(text))) set("file tools", { value: "none", project: true });
  set("platform", oneValue(text, PLATFORM_RE, "platform"));
  set("region", oneValue(text, REGION_RE, "region"));
  set("port", oneValue(text, PORT_RE, "port"));
  return out;
}

/** A folder for comparing: either separator, no trailing one, and no case on Windows paths. @param {string} p */
const pathKey = (p) => {
  const s = String(p).replace(/[\\/]+/g, "/").replace(/(?<=.)\/$/, "");
  return /^[A-Za-z]:(?:\/|$)/.test(s) || s.startsWith("//") ? s.toLowerCase() : s;
};

/** True when folder `inner` is `outer` or inside it. @param {string} inner @param {string} outer */
export function withinFolder(inner, outer) {
  const a = pathKey(inner),
    b = pathKey(outer);
  return !!a && !!b && (a === b || a.startsWith(b.endsWith("/") ? b : `${b}/`));
}

/**
 * Two values of one class that cannot both hold of one subject. Package managers rival only within one ecosystem
 * (pnpm and poetry can both be true of one repository); folders when neither holds the other.
 * @param {string} cls @param {string} a @param {string} b
 */
export function rivals(cls, a, b) {
  if (cls === "working folder") return !withinFolder(a, b) && !withinFolder(b, a);
  const x = normal(cls, a),
    y = normal(cls, b);
  if (!x || !y || x === y) return false;
  if (cls === "package manager") return ECOSYSTEM[/** @type {keyof typeof ECOSYSTEM} */ (x)] === ECOSYSTEM[/** @type {keyof typeof ECOSYSTEM} */ (y)];
  return true;
}
