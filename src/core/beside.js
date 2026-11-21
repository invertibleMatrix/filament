// @ts-check
// A team beside a chat (team_v2_plan §5.3, §5.4; TV2-D2, D4, D5): a team's lead in a chat of its own, kind `team`,
// tied to the chat it runs beside by a link of its own (`beside`), never by `parent_id`. The words its lead starts from
// — the person's words after the full record of the main chat — the message its result reaches the main agent in, the
// ask BugHunters checks a result by, and its state as its card says it. Pure: app/teams-beside.js fires, follows and
// hands off, the sessions service keeps the chat, the page draws the cards.
import { possessive } from "./text.js";

/**
 * How much a team beside holds: the person's words, its result as a hand-off carries it, the short a card shows, a
 * check's words — the result it checks, whole, with the words around it — and a flow's hand-off to its box: the
 * flow's words and every result before it, 120,000 characters of results at most (HarnessV4_Flow_Plan FL-D4) — and a
 * note the main agent puts before a lead at work, a line (the owner's of 10-30).
 */
export const BESIDE_LIMITS = Object.freeze({ ask: 4000, result: 60_000, short: 400, check: 64_000, handoff: 140_000, note: 600 });

/** A team beside's state: its lead or a worker at work; a question waits for you; its result is in; it stopped short. */
export const BESIDE_STATES = Object.freeze(/** @type {const} */ (["working", "asking", "done", "stopped"]));
/** @typedef {typeof BESIDE_STATES[number]} BesideState */

/** Who fired a team beside: you, from its fire card; the main agent, with its `team` tool (§5.5). */
export const FIRED_BY = Object.freeze(/** @type {const} */ (["you", "agent"]));
/** @typedef {typeof FIRED_BY[number]} FiredBy */

/**
 * The `team` tool's action as a call gives it, read one way: any case, spaces aside, and `fire` as `send`. Its act was
 * `fire` until version 123 — the page says send, and "I fired BugHunters" read as a dismissal — and is taken for good,
 * never said: a session opened before then holds the tool with that action, and an archived turn's call keeps
 * `action: "fire"`. The tool, its card and its summary each read a call through this (app/agent/beside-tool.js
 * `besideCall`, core/tool-vocab.js `cardOf`, app/agent/tools.js `argSummary`).
 * @param {unknown} v
 */
export const besideAction = (v) => {
  const a = String(v ?? "").trim().toLowerCase();
  return a === "fire" ? "send" : a;
};

/**
 * The shipped team that finds bugs and checks claims (the plan's p6): Verify… and Then verify fire it with a team's
 * result as the claims to check, and its own result is checked by none.
 */
export const BUGHUNTERS = "bughunters";
/**
 * Why Verify… takes no result of a team whose result comes checked (core/folded-teams.js `resultChecked`): "BugHunters'
 * result is a check already: nothing checks it again". @param {string} name  the team's
 */
export const checkedByNone = (name) => `${possessive(clean(name))} result is a check already: nothing checks it again`;

/** What the record block of a lead's first message begins with: the page folds it under What the lead read. */
export const RECORD_HEAD = "<main-chat";
/** The main chat's task graph inside the record (g3b, the owner's of 11-09): the main agent's plan, never the lead's. */
export const GRAPH_HEAD = "<task-graph>";
/** What a team's result begins with as it reaches the main agent: the chat draws that turn as Filament's. */
export const RESULT_HEAD = "[Filament: a team beside this chat finished";

/** @param {unknown} s */
const clean = (s) => String(s ?? "").replace(/\r\n?/g, "\n").trim();

/** Text cut to `n` characters, an ellipsis where it was cut. @param {string} s @param {number} n */
export const shortOf = (s, n = BESIDE_LIMITS.short) => {
  const t = clean(s).replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** Why the person's words cannot fire a team, else null. @param {unknown} ask @param {number} [max]  a check's: `check` */
export function askProblem(ask, max = BESIDE_LIMITS.ask) {
  const t = clean(ask);
  if (!t) return "say what the team is to do";
  if (t.length > max) return `what the team is to do is ${max} characters at most; this is ${t.length}`;
  return null;
}

/** Who sent it, as its result says it to the main agent, its reader: itself, or the person. @param {FiredBy} by */
export const firedWords = (by) => (by === "agent" ? "you" : "the person");

/**
 * The record block of a lead's first message (TV2-D4): the main chat as Filament keeps it — its finished turns as its
 * agent reads them now, compactions as they stand, then its running turn as far as the run log has it and a question
 * it waits on — and what the lead is to make of it.
 * @param {{ team: string, title: string, turns: number, text: string, form: string, cut: boolean,
 *   running: { rounds: number, tools: number, text: string } | null, waiting: { question: string, said: string } | null,
 *   graph?: string | null }} r
 *   `text`: the finished turns rendered; `form`: the composer's form that rendered them; `cut`: its oldest part
 *   was left out to fit; `running`: the turn running now, as the run log has it; `waiting`: the question it stopped on;
 *   `graph`: the chat's task graph whole, while it has open tasks (core/task-graph.js `openGraphText`)
 */
export function recordBlock(r) {
  const how = r.form === "plain" ? "as its agent reads them now" : "condensed the way the chat's own compaction condenses them, so they fit";
  const head = [
    `${RECORD_HEAD} title="${clean(r.title).replace(/"/g, "'")}" turns="${r.turns}">`,
    `You lead the ${r.team} team beside the person's main chat: the chat goes on while you work, and nothing of yours reaches it unless the person sends it. Below is that chat as Filament keeps it — its ${r.turns} finished turn${r.turns === 1 ? "" : "s"} ${how}${r.cut ? ", the oldest part left out" : ""}${r.running ? ", then the turn running now" : ""}. Background: the person's words after it are your task. Your result is your final reply: the person reads it on the team's card and may send it to the main agent, so write it whole. Start it with one line, "Subject: " and what you found or did in under 20 words: the main agent may read that line before the rest.`,
  ];
  const running = r.running?.text
    ? [
        "",
        `<running-turn rounds="${r.running.rounds}" calls="${r.running.tools}">`,
        "The turn the main agent is working on now, as Filament's log of it stands: its message, then each round's words and calls — the earlier rounds with a line for each result, the newest whole. A call is shown by its target and a result by its first lines: read a file yourself where you need it. The turn goes on while you work.",
        "",
        r.running.text,
        "</running-turn>",
      ]
    : [];
  const waiting = r.waiting
    ? ["", "<waiting>", "The main chat's turn stopped to ask the person, and waits for the answer.", ...(r.waiting.said ? ["In the round that asked, it said:", r.waiting.said] : []), "It asks:", r.waiting.question, "</waiting>"]
    : [];
  const graph = r.graph
    ? ["", GRAPH_HEAD, 'The main chat\'s task graph as it stands now: the main agent\'s plan, where "you" is the main agent and its tasks calls are its own. Your tasks tool keeps your own graph, never this one: plan your work around it where the two meet.', "", r.graph, "</task-graph>"]
    : [];
  return [...head, "", r.text || "(no finished turn yet)", ...running, ...waiting, ...graph, "</main-chat>"].join("\n");
}

/**
 * A lead's first message: the record, then a flow's hand-off where its team is a flow's box (HarnessV4_Flow_Plan F2),
 * then a hunt's range where it hunts in one (core/hunt-range.js `rangeBlock`, the plan's p6), then the person's words —
 * the task, last, where a model reads an instruction. A fresh start (no record) is the words alone, after its range.
 * @param {{ record: string | null, ask: string, handoff?: string | null, range?: string | null }} o
 */
export const openingContent = ({ record, ask, handoff = null, range = null }) => [
  ...(record ? [{ type: "text", text: record }] : []),
  ...(handoff ? [{ type: "text", text: handoff }] : []),
  ...(range ? [{ type: "text", text: range }] : []),
  { type: "text", text: clean(ask) },
];

/** Whether a content block is a lead's record. @param {any} b */
export const isRecordBlock = (b) => b?.type === "text" && String(b.text || "").startsWith(RECORD_HEAD);

/**
 * The message a team's result reaches the main agent in (§5.4): who did it, what it was asked, then the result whole.
 * One text block, appended to the main chat: its earlier turns stay as its cache holds them. `checked`: the team whose
 * result this one checked (a check's). `pictures`: the line naming what its lead and its crew drew, after the result
 * (HarnessV4_DesignPass_Plan, case 13) — never the pictures.
 * @param {{ name: string, ask: string, firedBy: FiredBy, result: string, checked?: { name: string } | null, auto: boolean, pictures?: string }} o
 */
export function resultMessage({ name, ask, firedBy, result, checked = null, auto, pictures = "" }) {
  const body = clean(result);
  const cut = body.length > BESIDE_LIMITS.result;
  const said = [
    checked
      ? `${RESULT_HEAD}: the ${name} team checked what the ${checked.name} team found beside this chat, which ${firedWords(firedBy)} sent, against the code as it is now. What follows is that check.`
      : `${RESULT_HEAD}: the ${name} team, which ${firedWords(firedBy)} sent beside this chat, was asked: "${shortOf(ask, 600)}".`,
    auto ? " The person set it to reach you when done." : " The person sent its result to you.",
    " It changed nothing: what to do with it is yours and the person's.]",
  ].join("");
  return `${said}\n\n<team-result team="${clean(name).replace(/"/g, "'")}">\n${cut ? `${body.slice(0, BESIDE_LIMITS.result)}\n…[Filament: the rest of the result is left out; the team's chat holds it whole]` : body}\n</team-result>${pictures ? `\n\n${pictures}` : ""}`;
}

/**
 * Who a team's result is from, as its envelope's line says it to the main agent (HarnessV4_Envelopes_Plan EN4).
 * `checked`: the team whose result this one checked (a check's).
 * @param {{ name: string, checked?: { name: string } | null }} o
 */
export const resultSender = ({ name, checked = null }) => (checked ? `the ${clean(name)} team beside this chat, which checked the ${clean(checked.name)} team's result` : `the ${clean(name)} team beside this chat`);

/**
 * Filament's subject for a team's result whose lead wrote none (EN-D3, EN4): what its findings count, where it ends on
 * the fixed list (`findingsFormat`), else what it was asked.
 * @param {{ ask: string, result: string }} o
 */
export function resultSubject({ ask, result }) {
  const f = findingsOf(result);
  const words = /** @type {Record<FindingKind, string>} */ ({ found: "found", confirmed: "confirmed", plausible: "plausible", uncovered: "not covered", dismissed: "dismissed" });
  const counted = f && f.items.length ? FINDING_KINDS.filter((k) => f.counts[k]).map((k) => `${f.counts[k]} ${words[k]}`) : [];
  if (f && f.items.length) return `${f.items.length} finding${f.items.length === 1 ? "" : "s"}: ${counted.join(", ")}`;
  return `its result to "${shortOf(ask, 120)}"; its lead wrote no subject line`;
}

/** Whether a message is a team's result (its last text block). @param {any} message */
export function isTeamResult(message) {
  const c = message?.content;
  if (typeof c === "string") return c.startsWith(RESULT_HEAD);
  if (!Array.isArray(c)) return false;
  const last = c.filter((b) => b?.type === "text").at(-1);
  return !!last && String(last.text).startsWith(RESULT_HEAD);
}

/**
 * What BugHunters is asked by Verify… and Then verify (§5.6, the plan's p6): the team's claims, to be checked against
 * the code as it is now, each Confirmed, Plausible or Dismissed with why — fixing nothing.
 * @param {{ name: string, ask: string, result: string }} o
 */
export function verifyAsk({ name, ask, result }) {
  // The result whole, as its hand-off carries it (found on the Bug Hunter's own result, 10-19: it was cut to fit the
  // person's 4000 characters, and its check took the first five claims of fifteen).
  const body = clean(result);
  const room = BESIDE_LIMITS.result;
  return [
    `Check what the ${name} team found (it was asked: "${shortOf(ask, 200)}") against the code as it is now.`,
    "For each claim: Confirmed (with why), Plausible (it cannot be shown either way) or Dismissed (with why). Fix nothing.",
    "",
    body.length > room ? `${body.slice(0, room)}\n…[the rest is in the ${name} team's chat]` : body,
  ].join("\n");
}

/**
 * The kinds a finding is, as BugHunters' lead writes them under Findings (team_v2_plan §10 O3, the plan's p6): a hunt's
 * Found, Plausible, Dismissed and Not covered; a check's Confirmed, Plausible and Dismissed. Their order is the order
 * the page counts them in.
 */
export const FINDING_KINDS = Object.freeze(/** @type {const} */ (["found", "confirmed", "plausible", "uncovered", "dismissed"]));
/** @typedef {typeof FINDING_KINDS[number]} FindingKind */
/** A finding's first part as a lead writes it → its kind. */
const KIND_WORDS = Object.freeze({ found: "found", confirmed: "confirmed", plausible: "plausible", "not covered": "uncovered", uncovered: "uncovered", dismissed: "dismissed" });
/** Each kind as a finding's first part says it. */
const KIND_TITLES = Object.freeze({ found: "Found", confirmed: "Confirmed", plausible: "Plausible", uncovered: "Not covered", dismissed: "Dismissed" });
/** How much of a result's findings a card or a pane carries. */
export const FINDING_LIMITS = Object.freeze({ items: 100, title: 200, where: 160, note: 400, top: 3 });
/**
 * How near two findings' lines are for them to be one bug (the plan's p6): in the same file, this many lines apart at
 * most. Two Hunters reading one bug cite the statement, its condition or the call beside it — a line or two apart, a
 * statement written over a few lines at most three — while two bugs in separate statements of a function sit further
 * apart than that.
 */
export const NEAR_LINES = 3;
/** "found by N" as a finding's last part carries it, with the words around it that go with it. */
const FOUND_BY = /[\s(;,—–-]*\bfound by (\d+)(?: (?:of \d+ )?(?:hunters?|workers?))?\)?\.?\s*$/i;

/**
 * The fixed list a finding team's lead ends its result with (team_v2_plan §10 O3, the plan's p6), as BugHunters'
 * lead's words say it, for a hunt and a check alike: a line `Findings:`, then a line per finding — `- Found | the bug |
 * file:line | its evidence`. A finding's last part holds whatever else its lead says of it, and "found by N" where
 * Filament merged it from N Hunters' reports. The page ranks and counts what this list says; the result goes to your
 * agent whole either way.
 */
export function findingsFormat() {
  return [
    'End your result with a line that says only "Findings:" and, under it, one line per finding, in this form, with nothing after the list — a hunt\'s ranked by harm, the worst first, as Found, Plausible, Dismissed and Not covered; a check\'s each claim once, as Confirmed, Plausible or Dismissed:',
    "- Found | <the bug, in a few words> | <file>:<line> | <its evidence: which Hunter found it, how it shows, and why the Checker confirmed it> — found by <N>",
    "- Confirmed | <the claim, in a few words> | <file>:<line> | <why it holds>",
    "- Plausible | <the bug or the claim> | <file>:<line>, or - | <what is missing to show it either way>",
    "- Dismissed | <the bug or the claim> | <file>:<line>, or - | <why it does not hold>",
    "- Not covered | <the area> | - | <why it was not covered>",
    'A finding several Hunters reported keeps Filament\'s "found by N" at the end of its last part.',
  ].join("\n");
}

/**
 * @typedef {{ kind: FindingKind, title: string, where: string, note: string, foundBy?: number }} Finding  one line of a
 *   findings list: `foundBy`, how many Hunters reported it, where it says so (2 or more)
 */

/** A path as two findings' places compare it: forward slashes, no leading `./`, no doubled slash. @param {string} p */
const pathOf = (p) => p.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^(?:\.\/)+/, "");
/** An absolute path's drive letter in one case, the rest as written. @param {string} p */
const driveCased = (p) => p.replace(/^([A-Za-z]):\//, (_, d) => `${d.toLowerCase()}:/`);

/**
 * Where a finding is, as a file and a line: `file:line` — `src/a.js:12`, `a.js:12-14` — or `file line 12`, the file's
 * path as written, with forward slashes and no leading `./`; an absolute one inside one of `roots` (the folders its
 * workers read in) from that folder, as git names it there. Case is kept: `Foo.js` and `foo.js` are two files. Null
 * where it names no line. @param {unknown} where @param {readonly string[]} [roots]
 * @returns {{ file: string, line: number } | null}
 */
export function spotOf(where, roots = []) {
  const w = String(where ?? "").replace(/`/g, "").trim();
  const m = /^(.+?)(?::|#L|,?\s+line\s+)(\d+)\b/i.exec(w);
  if (!m) return null;
  let file = pathOf(m[1]);
  if (/^(?:[A-Za-z]:)?\//.test(file))
    for (const root of roots) {
      const top = driveCased(pathOf(root)).replace(/\/$/, "");
      if (top && driveCased(file).startsWith(`${top}/`)) {
        file = driveCased(file).slice(top.length + 1);
        break;
      }
    }
  return file ? { file, line: Number(m[2]) } : null;
}
/** Whether two findings' kinds say one claim: the same, or a hunt's Found and Plausible, which only weigh it apart. @param {FindingKind} a @param {FindingKind} b */
const kindsMeet = (a, b) => a === b || ((a === "found" || a === "plausible") && (b === "found" || b === "plausible"));
/**
 * Whether two findings are one bug: their kinds meet, and they sit in one file — the same path, as `spotOf` reads it —
 * NEAR_LINES lines apart at most. A bare name and a path are two files. @param {Finding} a @param {Finding} b
 * @param {readonly string[]} [roots]
 */
export function sameBug(a, b, roots = []) {
  if (!kindsMeet(a.kind, b.kind)) return false;
  const x = spotOf(a.where, roots);
  const y = spotOf(b.where, roots);
  return !!x && !!y && x.file === y.file && Math.abs(x.line - y.line) <= NEAR_LINES;
}
/** The kinds a hunt's list holds: a list with any other — a check's Confirmed or Dismissed — is a check's. */
const HUNT_KINDS = Object.freeze(/** @type {FindingKind[]} */ (["found", "plausible", "uncovered"]));
/** Whether a findings list is a hunt's: each of its findings Found, Plausible or Not covered. @param {{ items: Finding[] }} f */
export const huntList = (f) => f.items.every((x) => HUNT_KINDS.includes(x.kind));
/** The stronger of two kinds that meet: Found over Plausible. @param {FindingKind} a @param {FindingKind} b */
const stronger = (a, b) => (FINDING_KINDS.indexOf(b) < FINDING_KINDS.indexOf(a) ? b : a);

/**
 * A finding team's result as its fixed list says it (`findingsFormat`): each finding's kind, title, where and note, in
 * the lead's order, how many Hunters reported it where its last part says "found by N" (`foundBy`, said apart from its
 * note), and how many of each kind — or null where the result has no such list (any other team's, or one its lead
 * wrote freely: the page shows its text). A list is its writer's own: each of its lines is a finding, however near
 * another. The last `Findings:` line wins; a line of another shape ends the list. Pure.
 * @param {unknown} text
 * @returns {{ items: Finding[], counts: Record<FindingKind, number> } | null}
 */
export function findingsOf(text) {
  const lines = clean(text).split("\n");
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*(?:#{1,6}\s*)?[*_]*findings[*_]*\s*:?[*_]*\s*$/i.test(lines[i])) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  /** @type {Finding[]} */
  const items = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim()) continue;
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (!m) break;
    // A part ends at a single bar: a title's `a || b` stays whole.
    const parts = m[1].split(/\s*(?<!\|)\|(?!\|)\s*/);
    const word = parts[0].replace(/[*_`[\]]/g, "").trim().toLowerCase();
    const kind = /** @type {FindingKind | undefined} */ (KIND_WORDS[/** @type {keyof typeof KIND_WORDS} */ (word)]);
    if (!kind || parts.length < 2) break;
    const where = parts[2]?.replace(/`/g, "").trim() || "";
    const rest = parts.slice(3).join(" | ");
    const by = FOUND_BY.exec(rest);
    const n = by ? Number(by[1]) : 0;
    /** @type {Finding} */
    const f = {
      kind,
      title: shortOf(parts[1].replace(/^\*\*|\*\*$/g, ""), FINDING_LIMITS.title),
      where: where === "-" || where === "—" ? "" : shortOf(where, FINDING_LIMITS.where),
      note: shortOf(by ? rest.slice(0, by.index) : rest, FINDING_LIMITS.note),
      ...(n > 1 ? { foundBy: n } : {}),
    };
    items.push(f);
    if (items.length >= FINDING_LIMITS.items) break;
  }
  if (!items.length) return null;
  const counts = /** @type {Record<FindingKind, number>} */ (Object.fromEntries(FINDING_KINDS.map((k) => [k, items.filter((x) => x.kind === k).length])));
  return { items, counts };
}

/**
 * The findings of several workers' hunts as one list (the plan's p6): each report's fixed list read (`findingsOf`) — a
 * hunt's alone (`huntList`): a check's verdicts are never merged — and a finding that is one bug with another worker's
 * (`sameBug`: one file, NEAR_LINES lines apart, kinds that meet) merged into the first, the stronger kind kept, `by`
 * naming every worker that reported it and `foundBy` how many. Two findings of one worker's list stay two: a list is its
 * writer's own. Ranked by kind, then by how many found it, then in the order they came. `workers`: how many of the
 * reports carried a hunt's list. `roots`: the folders the workers read in, from which an absolute path is read. Pure.
 * @param {readonly { by: string, text: string }[]} reports @param {{ roots?: readonly string[] }} [o]
 * @returns {{ items: (Finding & { foundBy: number, by: string[] })[], workers: number }}
 */
export function mergeFindings(reports, { roots = [] } = {}) {
  /** @type {(Finding & { foundBy: number, by: string[] })[]} */
  const items = [];
  /** @type {Set<string>} */
  const listed = new Set();
  for (const r of reports) {
    const f = findingsOf(r.text);
    if (!f || !huntList(f)) continue;
    listed.add(r.by);
    for (const x of f.items) {
      // The nearest of the other workers' findings it is one bug with.
      const line = spotOf(x.where, roots)?.line ?? 0;
      const same = items
        .filter((y) => !y.by.includes(r.by) && sameBug(y, x, roots))
        .sort((p, q) => Math.abs((spotOf(p.where, roots)?.line ?? 0) - line) - Math.abs((spotOf(q.where, roots)?.line ?? 0) - line))[0];
      if (!same) {
        items.push({ ...x, by: [r.by], foundBy: 1 });
        continue;
      }
      same.kind = stronger(same.kind, x.kind);
      if (!same.by.includes(r.by)) same.by.push(r.by);
      same.foundBy = same.by.length;
    }
  }
  const order = (/** @type {Finding & { foundBy: number }} */ x) => FINDING_KINDS.indexOf(x.kind);
  const ranked = items.map((x, i) => ({ x, i })).sort((a, b) => order(a.x) - order(b.x) || b.x.foundBy - a.x.foundBy || a.i - b.i).map((p) => p.x);
  return { items: ranked, workers: listed.size };
}

/**
 * Filament's words to a lead once every worker of one role in its run has reported (the plan's p6): their findings
 * merged (`mergeFindings`), in the fixed list's form, each with "found by N" where N of them reported it.
 * @param {{ role: string, workers: number, items: readonly (Finding & { foundBy: number, by: string[] })[] }} o
 */
export function mergedWords({ role, workers, items }) {
  const twice = items.filter((x) => x.foundBy > 1).length;
  return [
    `[Filament: the ${workers} ${role} workers of this run have reported. Their findings, merged by file and nearby line — one file, ${NEAR_LINES} lines apart at most — in ${items.length} line${items.length === 1 ? "" : "s"}${twice ? `, ${twice} of them reported by more than one ("found by N": by how many)` : ""}; each worker's report above has the rest of what it said:`,
    "Findings:",
    ...items.map((x) => `- ${KIND_TITLES[x.kind]} | ${x.title} | ${x.where || "-"} | ${x.note}${x.foundBy > 1 ? ` — found by ${x.foundBy}` : ""}`),
    "]",
  ].join("\n");
}

/**
 * A team beside's state from its chat as it stands: at work while its lead's turn or a worker runs; asking while a
 * question waits for you; done once its newest turn ended with a reply; else stopped (cut by a restart, failed, stopped).
 * @param {{ busy: boolean, asking: boolean, workers: number, last: { final: boolean } | null }} f
 * @returns {BesideState}
 */
export function besideState({ busy, asking, workers, last }) {
  if (asking) return "asking";
  if (busy || workers > 0) return "working";
  return last?.final ? "done" : "stopped";
}

/**
 * A team's workers, counted from the sub-agents' registry as it lists them: at work, waiting for a slot, done, failed,
 * and stopped before finishing — by the person, at a budget, or cut off by a restart — apart from those that failed
 * (the bug hunts of 10-30: "2 done" said nothing of the two that never finished).
 * @param {{ status?: string, waiting?: unknown }[]} subs
 * @returns {{ running: number, waiting: number, total: number, done: number, failed: number, stopped: number }}
 */
export function crewOf(subs) {
  const running = subs.filter((s) => s.status === "running");
  const held = running.filter((s) => s.waiting).length;
  const done = subs.filter((s) => s.status === "done").length;
  const failed = subs.filter((s) => s.status === "failed").length;
  return { running: running.length - held, waiting: held, total: subs.length, done, failed, stopped: subs.length - running.length - done - failed };
}

/**
 * Whom a note of the main agent's reaches, of one team's rows beside its chat, the newest first (the owner's of 10-30):
 * the newest at work whose lead's turn runs (`turnRuns`) — a team at work only as its workers finish has none, and a
 * lead that asks the person has ended its turn until they answer — and the words its lead reads, which say who sent
 * the team. Else why none, in words.
 * @template {{ state: string, firedBy: string, flow?: unknown }} T
 * @param {T[]} mine @param {string} name the team's name @param {string} words @param {(row: T) => boolean} turnRuns
 * @returns {{ ok: true, row: T, text: string } | { ok: false, error: string }}
 */
export function noteFor(mine, name, words, turnRuns) {
  const row = mine.find((r) => r.state === "working" && turnRuns(r));
  if (row) return { ok: true, row, text: `A note from the main chat's agent${row.firedBy === "agent" ? ", which sent this team" : row.flow ? " — a flow sent this team" : " — the person sent this team"}: ${words}` };
  const why = "a note reaches a lead only while its turn runs";
  if (mine.some((r) => r.state === "working")) return { ok: false, error: `the ${possessive(name)} lead has ended its turn, and its workers finish: ${why}` };
  if (mine.some((r) => r.state === "asking")) return { ok: false, error: `the ${possessive(name)} lead asks the person something, and its turn has ended until they answer: ${why}` };
  return { ok: false, error: mine.length ? `no ${name} beside this chat is at work now: ${why}` : `no ${name} runs beside this chat` };
}

/** Each state as a card's badge says it. */
export const STATE_WORDS = Object.freeze({ working: "At work", asking: "Asks you", done: "Done", stopped: "Stopped" });
