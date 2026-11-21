// @ts-check
// The transcript's vocabulary for tool activity, steering and the follow-scroll: pure helpers, tested in
// test/harness-page.test.js. The verb grammar is tense-per-status: a running call is present
// tense, a finished one past, and a failure or refusal says so in words.
import { fmt, presetWords } from "../../lib/format.js";
import { costWords, listDiffers } from "../../lib/cost.js";
import { cacheSaid } from "../../lib/cache-facts.js";
import { methodOf, wayName, nameIn, SUBAGENT_VIEW_WORDS, FORK_TRANSCRIPT_WORDS, CARRY_WORDS } from "../../lib/context-words.js";
import { ART_DOMAIN } from "./artifacts.js";
import { prettyModel } from "./families.js";

/**
 * A place as a person names it (HarnessV4_Git_Plan GW-D3): the name of its folder — "app-wt" for `H:/app-wt`.
 * @param {string} place
 */
export const placeName = (place) => String(place).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(place);

/**
 * A path git spells with forward slashes, spelled as `like` is: back slashes where `like` (the chat's folder as the
 * page has it) uses them alone.
 * @param {string} path @param {string} [like]
 */
export const pathLike = (path, like = "") =>
  /\\/.test(like) && !/\//.test(like) ? String(path).replace(/\//g, "\\") : String(path);

/**
 * A place's branch in words (HarnessV4_Git_Plan GWC-28, GWC-58): its name, even before its first commit, or the
 * commit a detached HEAD is at.
 * @param {{ branch?: string | null, head?: string | null }} p
 */
export const branchWords = (p) => p?.branch || (p?.head ? `detached at ${p.head}` : "");

/**
 * How far a place is from its base, as its chip says it (GWC-60): `↑2 ↓1`; nothing on the base itself, without a base,
 * or when even.
 * @param {{ onBase?: boolean, ahead?: number | null, behind?: number | null }} p
 */
export function aheadWords(p) {
  if (!p || p.onBase) return "";
  return [p.ahead ? `↑${p.ahead}` : "", p.behind ? `↓${p.behind}` : ""].filter(Boolean).join(" ");
}

/**
 * A place against its base branch, in a card's words (GW-D21, GWC-27).
 * @param {{ base?: string | null, onBase?: boolean, head?: string | null, ahead?: number | null, behind?: number | null }} p
 */
export function baseWords(p) {
  if (!p?.base) return "no base branch to compare with (no main, master, trunk, develop or origin/HEAD)";
  if (p.onBase) return `${p.base} is the base branch`;
  if (!p.head) return `nothing committed yet; the base is ${p.base}`;
  if (p.ahead == null || p.behind == null) return `the base is ${p.base}`;
  const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  if (!p.ahead && !p.behind) return `even with ${p.base}`;
  if (!p.behind) return `${n(p.ahead, "commit")} ahead of ${p.base}`;
  if (!p.ahead) return `${n(p.behind, "commit")} behind ${p.base}`;
  return `${n(p.ahead, "commit")} ahead of ${p.base}, ${p.behind} behind`;
}

/**
 * What a place has uncommitted, in a card's words: the files git status lists, and the lines against HEAD.
 * @param {{ files: number, added: number, removed: number } | null | undefined} u
 */
export function uncommittedWords(u) {
  if (!u) return "";
  if (!u.files) return "nothing uncommitted";
  const lines = u.added || u.removed ? `, +${u.added} −${u.removed}` : "";
  return `${u.files} uncommitted file${u.files === 1 ? "" : "s"}${lines}`;
}

/**
 * Whose worktree a place is, in a card's words (GWC-34): "worktree of app (H:\app)"; nothing for a main folder.
 * @param {{ worktree?: boolean, main?: string | null }} p @param {string} [like]  the chat's folder, for the slashes
 */
export function worktreeWords(p, like = "") {
  if (!p?.worktree) return "";
  return p.main ? `worktree of ${placeName(p.main)} (${pathLike(p.main, like)})` : "a worktree of a bare repository";
}

/**
 * A move's row between turns (HarnessV4_Git_Plan GW-D77): "Moved from Filament to filament-fix-login (fix-login) · 3
 * files carried"; the branch is left out where the folder has its name.
 * @param {{ from: string, to: string, branch?: string | null, files: number }} b
 */
export function movedWords(b) {
  const carried = b.files ? `${b.files} file${b.files === 1 ? "" : "s"} carried` : "no file of its own to carry";
  return `Moved from ${b.from} to ${b.to}${b.branch && b.branch !== b.to ? ` (${b.branch})` : ""} · ${carried}`;
}

/** A size in words: "312 bytes", "24 KB", "1.2 MB", "8.4 GB". @param {number} n */
export function sizeWords(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} byte${n === 1 ? "" : "s"}`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * The names a sentence lists, the rest counted: "Library", "Library and .env", "a, b, c and 2 more".
 * @param {string[]} names
 */
const listWords = (names) => {
  const shown = names.length > 4 ? names.slice(0, 3) : names;
  const rest = names.length - shown.length;
  if (rest) return `${shown.join(", ")} and ${rest} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0] || "";
};

/**
 * A worktree template's copy, as its row between turns says it (HarnessV4_Four_Plan FO-D37): what it copied, into
 * which worktree, how much and how long; then each thing it did not copy and why, the first few, the rest counted; a
 * copy cut says where and why, and that what was copied stays.
 * @param {{ into: string, paths: string[], state: "running" | "done" | "cut", why?: string, ms?: number | null,
 *   result?: { copied: string[], skipped: { path: string, why: string }[], failed: { path: string, error: string }[],
 *     failedMore: number, bytes: number, files: number, total: number, cut: string | null } | null }} b
 * @returns {{ text: string, notes: string[] }}
 */
export function copiedWords(b) {
  const r = b.result;
  if (b.state === "running") return { text: `Copying ${listWords(b.paths)} into ${b.into}…`, notes: [] };
  if (!r) return { text: `The copy of ${listWords(b.paths)} into ${b.into} was cut: ${b.why || "it did not end"}. What was copied stays`, notes: [] };
  const took = b.ms != null ? `, ${formatWorkedFor(b.ms)}` : "";
  const size = `${sizeWords(r.bytes)}, ${r.files.toLocaleString("en-US")} file${r.files === 1 ? "" : "s"}${took}`;
  const text = r.cut
    ? `The copy into ${b.into} was cut at ${sizeWords(r.bytes)} of ${sizeWords(r.total)}: ${r.cut}. What was copied stays`
    : r.copied.length
      ? `Copied ${listWords(r.copied)} into ${b.into} · ${size}`
      : `Copied nothing into ${b.into}`;
  const notes = [
    ...r.skipped.map((s) => (s.why === "not here" ? `${s.path} is not here, so not copied` : `${s.path} not copied: ${s.why}`)),
    ...r.failed.map((f) => `${f.path} not copied: ${f.error}`),
    ...(r.failedMore ? [`and ${r.failedMore.toLocaleString("en-US")} more not copied`] : []),
  ];
  return { text, notes };
}

/**
 * The sidebar's line for a chat that works anywhere but a repository's main folder (HarnessV4_Git_Plan GWC-36): its
 * folder when that is a worktree, and the other places its agents wrote in. A place of the folder's own repository is
 * named by its branch, another repository's by its folder and branch; more than one adds `+N`. Null where the chat
 * works only in a main folder, or nothing is known yet; a place not read (refused, gone) is left out (GWC-55, GWC-56).
 * `lead`: the folder leads even where it is a main folder — the mark beside the line is the folder's own (`apartMark`),
 * and stood beside a place its agents wrote in it read as that place's (the review's find of 10-31).
 * @param {{ cwd?: string | null, places?: string[] }} row
 * @param {(folder: string) => any} infoOf  the light read of a folder (`/git/where`), or null while unknown
 * @param {{ lead?: boolean }} [o]
 * @returns {{ text: string, title: string } | null}
 */
export function whereLine(row, infoOf, o = {}) {
  const folder = row?.cwd ? infoOf(row.cwd) : null;
  if (row?.cwd && !folder) return null;
  const family = (/** @type {any} */ p) => p.main || p.place;
  const items = [
    ...(folder?.ok && (folder.worktree || o.lead) ? [folder] : []),
    ...(row?.places || []).map(infoOf).filter((p) => p?.ok && p.place !== folder?.place),
  ].filter((p, i, all) => all.findIndex((q) => q.place === p.place) === i);
  if (!items.length) return null;
  const said = (/** @type {any} */ p) =>
    folder?.ok && family(p) === family(folder) ? branchWords(p) : `${placeName(p.place)} · ${branchWords(p)}`;
  const named = (/** @type {any} */ p) =>
    [`${placeName(p.place)} ⑂ ${branchWords(p)}`, worktreeWords(p, row.cwd || "")].filter(Boolean).join(", ");
  return {
    text: items.length > 1 ? `${said(items[0])} +${items.length - 1}` : said(items[0]),
    title: items.map((p) => `${p === folder ? "Works in" : "Its agents also wrote in"} ${named(p)}`).join("\n"),
  };
}

/**
 * What a chat's place holds that its base lacks, as its row's mark says it (the owner's of 10-31: "i might forget if a
 * thread has unapplied work into main branch"): its commits not on the base, `↑2`, and its files not committed, as
 * `/git/where?apart=1` reads a place kept apart from its base; the hover in a lane's words. Null where it holds nothing
 * apart — on the base itself, merged, nothing of its own yet — or was not read so.
 * @param {any} p  a place as `/git/where?apart=1` reads one, or null
 * @returns {{ text: string, title: string } | null}
 */
export function apartMark(p) {
  if (!p?.ok) return null;
  const ahead = p.base && !p.onBase ? Number(p.ahead) || 0 : 0;
  const files = Number(p.uncommitted?.files) || 0;
  if (!ahead && !files) return null;
  const n = (/** @type {number} */ k, /** @type {string} */ one) => `${k} ${one}${k === 1 ? "" : "s"}`;
  return {
    text: [ahead ? `↑${ahead}` : "", files ? `${files} uncommitted` : ""].filter(Boolean).join(" · "),
    title: [ahead ? `${n(ahead, "commit")} not on ${p.base}` : "", files ? `${n(files, "file")} changed, not committed` : ""].filter(Boolean).join(" · "),
  };
}

/**
 * What a place's rows say of it — the fields `whereLine` and `apartMark` read —, for telling whether a new read changed
 * them: one whose lines changed or whose distance behind moved, as an agent's edits move them, draws nothing again.
 * @param {any} p  a place as `/git/where` reads one, or null
 */
export const placeSaid = (p) =>
  p ? JSON.stringify([p.ok, p.place, p.worktree, p.main, p.branch, p.branch ? null : p.head, p.base, p.onBase, p.ahead, p.uncommitted?.files ?? null]) : "";

/**
 * The project a chat the archive does not list yet stands under in the sidebar: the one its create filed it in (a
 * worktree's folder stands in its main folder's project, HarnessV4_Git_Plan GW-D46), else a listed chat's of the same
 * folder, else a group of its folder's own.
 * @param {{ cwd?: string | null, projectId?: string | null }} chat
 * @param {{ cwd?: string | null, project?: string | null, projectName?: string | null }[]} sessions
 * @returns {{ project: string, projectName: string | null }}
 */
export function localProject(chat, sessions) {
  const key = (/** @type {any} */ p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const same = chat.cwd ? sessions.find((s) => s.cwd && key(s.cwd) === key(chat.cwd)) : null;
  return {
    project: chat.projectId || same?.project || (chat.cwd ? `folder:${key(chat.cwd)}` : "none"),
    projectName: same?.projectName || chat.cwd || null,
  };
}

/**
 * The project a chat's chip in Now names: the archive's row's; for a chat the archive does not list yet, the one it
 * stands under in Projects (`localProject`) — named as the bar names that project —; its folder's name only where
 * neither is known. A chat in a worktree is its project's from its first draw (the owner's of 10-31: it read
 * "webshop-uiux" until the list was read again, then "webshop").
 * @param {{ projectName?: string | null, cwd?: string | null } | null} row  the archive's row, or null
 * @param {{ cwd?: string | null, projectId?: string | null } | null} chat  the page's chat, or null
 * @param {{ cwd?: string | null, project?: string | null, projectName?: string | null }[]} sessions
 * @param {readonly { id?: string, name?: string }[]} projects  the archive's projects the bar lists
 */
export function chipProject(row, chat, sessions, projects) {
  let named = row?.projectName || "";
  if (!named && chat) {
    const { project, projectName } = localProject(chat, sessions);
    named = projects.find((p) => p?.id === project)?.name || (projectName && projectName !== chat.cwd ? projectName : "");
  }
  return placeName(String(named || row?.cwd || chat?.cwd || ""));
}

/**
 * What the main agent attached to a sub-agent's message, as its start event names it: the files and the pictures, each
 * by name. @param {any} a @returns {{ files: string[], pictures: string[] }}
 */
const attachedOf = (a) => ({ files: Array.isArray(a?.files) ? a.files.map(String) : [], pictures: Array.isArray(a?.pictures) ? a.pictures.map(String) : [] });
/**
 * Whose a message in a run is, where it is not the developer's own from the page: a worker's lead, the chat's agent
 * that launched it — a graph task's planner, or its letters (app/letters.js) — Filament (why a call of its was
 * refused), or the developer's answer to its call relayed (HarnessV3-TaskGraph-v2 TG2-D38, TG2-D41), or a watcher the
 * person let guide the chat (app/watchers/guidance.js). Its bubble says so.
 */
const STEER_FROM = new Set(["lead", "agent", "filament", "developer", "watcher"]);
/** What a message's bubble says of whose it is (`STEER_FROM`), as the run's own heading names it (loop.js `AGENT_HEAD`). */
export const STEER_FROM_WORDS = Object.freeze({ lead: "From its lead", agent: "From the main agent", filament: "From Filament", developer: "Your answer, relayed by Filament", watcher: "Guidance from a watcher" });
/**
 * …and with the sender's name where the message carries one: a watcher's guidance names its watcher.
 * @param {{ from?: string, title?: string }} s
 */
export const steerFromWords = (s) => (s.from === "watcher" && s.title ? `Guidance from “${s.title}”` : /** @type {Record<string, string>} */ (STEER_FROM_WORDS)[String(s.from)] || "");
/**
 * A sign on a worker's trail (HarnessV3-TaskGraph-v2 TG2-D15), as a look's row names it in a word or two: the look
 * itself said it whole.
 */
export const SIGN_WORDS = Object.freeze({ plan: "its plan", change: "first change", outside: "outside its files", failure: "failing again", asks: "asks", "one-way": "cannot be undone", compacted: "compacted" });

/**
 * A look's row on the lead's timeline (TG2-D22), in words: who looked at whom, each one's rounds and its signs, and the
 * look's size. `roleOf`: a worker's role or what it is, where the page knows it.
 * @param {{ workers: { id: string, fromRound: number, toRound: number, signs: string[] }[], tokens: number }} k
 * @param {{ lead: boolean, roleOf?: (id: string) => string }} o
 * @returns {{ head: string, workers: { id: string, text: string }[], size: string }}
 */
export function lookWords(k, { lead, roleOf = () => "" }) {
  const n = k.workers.length;
  const head = lead ? `The lead looked at its ${n === 1 ? "worker" : `${n} workers`}` : `The agent looked at ${n === 1 ? "the agent on its task" : `the ${n} agents on its tasks`}`;
  const workers = k.workers.map((w) => {
    const rounds = !w.toRound ? "starting" : w.fromRound && w.fromRound < w.toRound ? `rounds ${w.fromRound}–${w.toRound}` : `round ${w.toRound}`;
    const signs = w.signs.map((s) => /** @type {Record<string, string>} */ (SIGN_WORDS)[s] || s);
    const role = roleOf(w.id);
    return { id: w.id, text: [`${role ? `${role} ` : ""}${w.id}`, rounds, ...signs].join(" · ") };
  });
  return { head, workers, size: k.tokens ? `≈${k.tokens.toLocaleString("en-US")} tokens` : "" };
}

/** [present, done] per hand; what the loop's tools and the client's MCP-shaped tools are called. */
const VERBS = {
  read: ["Reading", "Read"],
  write: ["Writing", "Wrote"],
  edit: ["Editing", "Edited"],
  bash: ["Running", "Ran"],
  powershell: ["Running", "Ran"],
  grep: ["Searching", "Searched"],
  glob: ["Listing", "Listed"],
  plan: ["Todo", "Todo"],
  ask: ["Asking questions", "Asked"],
  delegate_read: ["Reading for you", "Read for you"],
  task: ["Working on", "Worked on"],
  web_search: ["Searching the web for", "Searched the web for"],
  web_fetch: ["Fetching", "Fetched"],
};

/** The target a collapsed stub names: the path, the pattern, or the command's head. Never file content. */
function targetOf(name, args) {
  const a = args || {};
  const t = a.path || a.file_path || a.pattern || a.command || a.question || a.brief || "";
  const one = String(t).split("\n")[0].trim();
  return one.length > 80 ? one.slice(0, 79) + "…" : one;
}

/**
 * The one line a collapsed tool stub reads, by status: present tense while running, past when finished, the truth
 * for a failure, a decline, a veto.
 * @param {string} name @param {any} args @param {"running"|"done"|"failed"|"declined"|"vetoed"|"refused"|"stopped"} [state]
 */
export function toolLabel(name, args, state = "done") {
  const [ing, ed] = VERBS[String(name || "").toLowerCase()] || ["Using", "Used"];
  const target = targetOf(name, args);
  const base = name === "plan" || name === "ask" ? "" : ` ${target}`;
  if (state === "running") return `${ing}${base}`.trim();
  // A call that never ran is not "Ran": the stub says what happened to it, in one word.
  if (state === "declined") return `Declined${base}`.trim();
  if (state === "vetoed") return `Vetoed${base}`.trim();
  if (state === "refused") return `Refused${base}`.trim();
  if (state === "stopped") return `Stopped${base}`.trim();
  return `${ed}${base}`.trim();
}

/**
 * The result half of a finished stub: `→ exit 0`, `→ 584 lines`, `→ +38 −6` when the event carries it.
 * @param {any} e  a tool-end event
 */
export function toolResultHint(e) {
  if (!e || e.ok == null) return "";
  if (!e.ok) return "";
  const parts = [];
  if (e.chars != null) parts.push(e.chars > 4000 ? `${Math.round(e.chars / 100) / 10}k chars` : `${e.chars} chars`);
  if (e.ms != null && e.ms >= 1000) parts.push(`${(e.ms / 1000).toFixed(1)} s`);
  return parts.length ? ` → ${parts.join(" · ")}` : "";
}

/**
 * The follow-scroll rule (its re-arm band): following breaks on any upward scroll and re-arms only inside a
 * strict band above the bottom — never halfway up the transcript. A scroll that did not move up (the page's own
 * catch-up while content grows) leaves the state as it was.
 * @param {number} distFromBottom  px
 * @param {boolean} wasFollowing
 * @param {boolean} [movedUp]  whether this scroll went up; unknown counts as up
 */
export function shouldFollow(distFromBottom, wasFollowing, movedUp = true) {
  if (distFromBottom <= 40) return true; // inside the re-arm band: follow again
  return movedUp ? false : !!wasFollowing;
}

/**
 * A tool-end event onto the stub its tool-start opened (or a fresh one when the start was never seen).
 * @param {Map<string, any>} tools @param {string[]} order @param {any} e
 * @returns {any} the stub
 */
/**
 * Which alignment made each call's record (and each sub-agent's), and how often its events moved it since: what a
 * row is kept by while the turn runs (render.js `keptCall`), in place of reading the whole record again at every
 * frame (the performance Hunter's find of 10-25). Kept beside the records, never in them.
 * @type {WeakMap<object, { a: number, rev: number }>}
 */
const moved = new WeakMap();
let alignments = 0;
/** The alignment folding an event now: one at a time, as `add` runs. */
let aligning = 0;
/** @template {object} T @param {T} o @returns {T} */
const born = (o) => (moved.set(o, { a: aligning, rev: 0 }), o);

/**
 * How long a sub-agent's call runs before its card's line names it (the owner's of 11-04: a reviewer's reads end in a
 * few milliseconds, and the line swapped "Read …" in and out of "33 tool uses" at every one, a frame or two each). A
 * call that ends sooner is never named; a longer one is, as long as it runs.
 */
export const CALL_NAMED_AFTER_MS = 1000;
/**
 * How long until a running call is named: 0 once it has run CALL_NAMED_AFTER_MS by its start's clock (`at`), and 0
 * where its start is not known — its age cannot be weighed, and it is named as it comes.
 * @param {{ at?: number } | null | undefined} call @param {number} [now]
 */
export const callNamedIn = (call, now = Date.now()) => (Number(call?.at) > 0 ? Math.max(0, CALL_NAMED_AFTER_MS - (now - Number(call?.at))) : 0);
/** @param {any} o */
const bump = (o) => {
  const m = o && moved.get(o);
  if (m) m.rev++;
};
/**
 * A call's record (or a sub-agent's) as its alignment counts its moves: `<alignment>:<moves>`, the same while nothing
 * its events said of it changed; null for one no alignment made (an archived turn's cards).
 * @param {any} o @returns {string | null}
 */
export const callRev = (o) => {
  const m = o && moved.get(o);
  return m ? `${m.a}:${m.rev}` : null;
};

function endTool(tools, order, e) {
  const t = tools.get(e.id) || born({ id: e.id, name: e.name, card: e.card || undefined });
  // A call the developer's stop cut is no failure (BUG-09): it ran, and its output so far is kept.
  t.state = e.refused ? "refused" : e.declined ? "declined" : e.vetoed ? "vetoed" : e.stopped ? "stopped" : e.ok === false ? "failed" : "done";
  t.ok = e.ok;
  t.ms = e.ms;
  t.chars = e.chars;
  t.requestId = e.requestId;
  // A refused, declined or vetoed call carries no preview; the absence is the truth, not an empty result.
  if (e.preview) t.preview = e.preview;
  if (e.exitCode != null) t.exitCode = e.exitCode;
  // Sent to the background by the developer (HarnessV4_Four_Plan E21): the shell it runs on as.
  if (e.background) t.background = String(e.background);
  if (e.movedBy === "timeout") t.movedBy = "timeout";
  if (e.rule) t.rule = e.rule;
  if (e.hook) t.hook = e.hook;
  if (e.reason) t.reason = String(e.reason);
  if (e.notRun) t.notRun = true;
  if (e.file) t.file = String(e.file);
  // The pictures the call handed its model, as the run log kept them (HarnessV4_Tasks U9), and any it could not keep.
  if (Array.isArray(e.images) && e.images.length) t.images = e.images;
  if (e.imagesNotKept) t.imagesNotKept = e.imagesNotKept;
  if (e.lsp) t.lsp = e.lsp;
  bump(t);
  if (!tools.has(e.id)) {
    tools.set(e.id, t);
    order.push(e.id);
  }
  return t;
}

/**
 * One of a sub-agent's own calls' events onto its record (`subagent-tool-start`, `-end`, `-errors`): the alignment's
 * fold and a card's read of the calls left apart (`fillCalls`) take each the same way.
 * @param {{ tools: Map<string, any>, order: string[] }} s @param {any} e
 */
function subCall(s, e) {
  if (e.type === "subagent-tool-start") {
    if (s.tools.has(e.id)) return;
    // `at`, as a call of the turn's own: its card names it only once it has run a moment (CALL_NAMED_AFTER_MS).
    s.tools.set(e.id, born({ id: e.id, name: e.name, args: e.args, card: e.card || undefined, state: "running", ...(e.movable ? { movable: true } : {}), ...(Number(e.ts) > 0 ? { at: Number(e.ts) } : {}) }));
    s.order.push(e.id);
  } else if (e.type === "subagent-tool-end") endTool(s.tools, s.order, e);
  else if (e.type === "subagent-tool-errors") {
    const t = s.tools.get(e.id);
    if (t && e.lsp) {
      t.lsp = e.lsp;
      bump(t);
    }
  }
}

/**
 * A sub-agent's calls an ended turn's read left apart (`apart`), read as its card opened or Find did: `events` are its
 * launching call's, in order — every one of them, as its run holds them —, taken as the alignment takes them (`subCall`),
 * under the alignment that made the sub. A call the sub holds already (one that came whole: its pictures, or no end,
 * which its run's end marked) stays the record it is, where its first event puts it, and none it holds is dropped. Its
 * tools and order are filled where they stand, so every copy of the sub sees them; once, then the sub is filled.
 * @param {any} sub  the alignment's own sub (`t.sub`), never a copy @param {any[]} events
 * @returns {boolean} whether it filled it now
 */
export function fillCalls(sub, events) {
  const apart = sub?.apart;
  if (!apart || apart.filled) return false;
  const was = aligning;
  aligning = moved.get(sub)?.a ?? was;
  try {
    /** @type {{ tools: Map<string, any>, order: string[] }} */
    const into = { tools: new Map(), order: [] };
    for (const e of events) {
      const had = sub.tools.get(e.id);
      if (!had) subCall(into, e);
      else if (!into.tools.has(e.id) && e.type !== "subagent-tool-errors") {
        into.tools.set(e.id, had);
        into.order.push(e.id);
      }
    }
    for (const id of sub.order)
      if (!into.tools.has(id)) {
        into.tools.set(id, sub.tools.get(id));
        into.order.push(id);
      }
    sub.tools.clear();
    for (const [id, t] of into.tools) sub.tools.set(id, t);
    sub.order.length = 0;
    for (const id of into.order) sub.order.push(id);
  } finally {
    aligning = was;
  }
  apart.filled = true;
  bump(sub);
  return true;
}

/** The subs of an aligned turn whose calls are apart still (`fillCalls`). @param {any} aligned @returns {any[]} */
export function subsApart(aligned) {
  /** @type {any[]} */
  const out = [];
  for (const cell of aligned?.byRound?.values() || []) for (const t of cell.tools.values()) if (t.sub?.apart && !t.sub.apart.filled) out.push(t.sub);
  return out;
}

/**
 * A background shell that ended unread, as its row says it (TL-D24): the shell, its command, its code, and that the
 * agent was told where the row stands.
 * @param {{ agentId: string, description?: string, code?: number | null }} r  `agentId` is the shell, `description` its command
 */
export function shellExitWords(r) {
  return `↳ Background shell ${r.agentId}${r.description ? ` (${r.description})` : ""} exited with code ${r.code ?? "?"} — the agent heard of it here`;
}

/**
 * Group one run's events by round for the transcript's card rows: the round's tool calls (start/end paired by id),
 * its asks, the latest plan and task graph, steering marks and snapshots. Round numbering is the loop's own (1-based); block n of
 * the reply is round n, so `cardsBeforeBlock` names where a round's card row belongs. A sub-agent's events land on
 * the stub of the `agent` call that launched it, as `sub`: its description, type, prompt — a team's worker's team and
 * role too (HarnessV3-Views V3) — its own calls (`tools` and `order`, the round's shape) and, once over, how it ended
 * with its report. The developer's own sub-agents sent off or
 * back while the turn ran are the round's `marks` (subagent-marks.js draws them). A message the sub-agent machinery
 * put into the conversation (a background sub-agent's report, the developer's launch announced) is the round's
 * `reports` — unless this run marked that sub-agent: then its dispatch says the main agent was told, and its arrival
 * where the main agent read the report, instead of a second row. A report the developer kept aside and sent on later
 * is a row of its own, where the main agent read it. The note the reply ends on is the newest `notice` (LD-D7).
 * `planned` is which of its two ways to plan the agent used last in this run — `plan` (the checklist) or `graph` (the
 * task graph, HarnessV3-TaskGraph) — the Plan view opens on it. A coding agent's questions (HarnessV3-ACP AC2-4) wait
 * on its run rather than pause it: `waiting` holds those not settled
 * yet, and the card that asked keeps the question's form, then its answer in words. The visuals the agent drew are
 * their round's `visuals`; one its model is still writing is in its round's `writing` until its call ends, the next
 * round starts or the run does (HarnessV4_Visuals_Plan VS-D11). `place` is where the agent works now, from the newest
 * `place` event: null while it has worked in the chat's folder alone (HarnessV4_Git_Plan §11). A round whose reply
 * ended the agent's turn before Filament woke it within the turn is `woke`: when the reply ended and when it went on.
 * @param {any[]} events
 */
export function alignEvents(events) {
  const a = createAlignment();
  for (const e of events || []) a.add(e);
  return a.result();
}

/**
 * A run's log aligned onto what was aligned of it last (the performance Hunter's find of 10-25): a live turn aligned
 * its whole log again at every frame, so a frame's work grew with the turn. `cache` is the caller's, one per log it
 * follows: while it is handed the same array, grown, only the events since fold in; another array, one cut shorter or
 * whose newest folded event changed starts again from its head. The result is the one `alignEvents` gives the log.
 * Handed no log, it gives what it holds aligned and folds nothing: a log let go of (`letGoOfLog`) is read so.
 * @param {{ a?: ReturnType<typeof createAlignment>, list?: any[] | null, n?: number, last?: any, whole?: boolean }} cache @param {any[] | null} [events]
 */
export function alignOnto(cache, events) {
  if (!events && cache.a) return cache.a.result();
  const list = events || [];
  const n = cache.n || 0;
  if (!cache.a || cache.list !== list || n > list.length || (n > 0 && list[n - 1] !== cache.last)) Object.assign(cache, { a: createAlignment(), list, n: 0, last: null, whole: false });
  const a = /** @type {ReturnType<typeof createAlignment>} */ (cache.a);
  let at = cache.n || 0;
  while (at < list.length) a.add(list[at++]);
  cache.n = at;
  cache.last = at ? list[at - 1] : null;
  return a.result();
}

/**
 * A run's whole log, let go of once aligned (the owner's of 11-15, the page's process at 1.4 GB after three days: "have
 * some limit that is always available in memory"). A turn's cards are drawn from its log's alignment, which keeps of a
 * running command's output its last 4,000 characters; the log itself is up to 40 MB of JSON for one heavy turn, most of
 * it that output in pieces and its sub-agents' calls, and the page kept it for every ended turn it drew. Once `cache`
 * holds every event of `events` — the log of a run that is over, so nothing more comes — it keeps the alignment and no
 * reference to the events (`whole`): `alignOnto` handed no log reads it as it stands, and handed a log again, any array,
 * aligns that one from its head. A cache that holds less of `events` keeps it.
 * @param {{ a?: ReturnType<typeof createAlignment>, list?: any[] | null, n?: number, last?: any, whole?: boolean }} cache @param {any[]} events
 * @returns {boolean} whether the cache holds its log whole, let go of
 */
export function letGoOfLog(cache, events) {
  if (cache.a && cache.list === events && cache.n === events.length) Object.assign(cache, { list: null, last: null, whole: true });
  return cache.whole === true;
}

/** A woke turn-state's words before it said `woke`: a coding agent's next prompt, the loop's round for what woke it. */
const WOKE_STATES = new Set(["Filament's words to the agent", "sub-agent reports", "the developer's message", "errors the language server found late", "sealed envelopes", "the task's report", "turn-end hook"]);

/** The fold `alignEvents` runs, one event at a time (`add`), read as it stands at any point (`result`). */
function createAlignment() {
  const serial = ++alignments;
  /** @type {Map<number, any>} */
  const byRound = new Map();
  const roundOf = (e) => (Number.isInteger(e.round) ? e.round : 0);
  const cell = (r) => {
    if (!byRound.has(r)) byRound.set(r, { round: r, tools: new Map(), order: [], plan: null, graph: null, asks: [], steers: [], snapshots: [], hooks: [], reports: [], marks: [], compactions: [], compacting: null, detaches: [], looks: [], vetoed: 0, learned: 0, visuals: [], writing: new Map(), artifacts: [], envelopes: [], opens: [], envelopeNotes: [], told: [] });
    return byRound.get(r);
  };
  /** @type {Map<string, any>} */
  const steers = new Map();
  /** A sub-agent's words by its id, from the launches this run made. @type {Map<string, string>} */
  const launched = new Map();
  /** This run's newest mark of each developer's sub-agent sent off, and back, with the round it landed in. @type {Map<string, { mark: any, round: number }>} */
  const dispatched = new Map();
  /** @type {Map<string, { mark: any, round: number }>} */
  const arrived = new Map();
  /** The loop's newest turn-state (Step 4 D6): what the live turn is doing now. @type {{ to: string, why: string, retry?: any, queue?: any, tokens?: number } | null} */
  let turnState = null;
  /** When the turn reached its coding agent: the run's "sent" (proposal_ux §4.3, the live line). @type {number | null} */
  let sentAt = null;
  /** The note the reply ends on (LD-D7): said ahead of its words, so the copy never lands where the page draws its card.
   *  @type {{ kind: string, text: string, quoted?: boolean } | null} */
  let note = null;
  /** Which way to plan the run used last: the checklist or the task graph. @type {"plan" | "graph" | null} */
  let planned = null;
  /** The round whose plan card stands: the newest plan's. A run's plan is one card, its newest list. */
  let planIn = null;
  /** Where the agent works now, once it worked outside the chat's folder. @type {{ place: string, home: boolean } | null} */
  let place = null;
  /** The round running when an event lands: a steer carries no round, so where the loop read it is the round its
   *  results carried it in (BUG-13). */
  let curRound = 0;
  /** The newest round the turn waited in for what it was owed, and when it began to. @type {{ round: number, ts: number } | null} */
  let waitedIn = null;
  /** The round running woke the agent at `ts`: when its reply ended — its wait's start, if it waited — and when the
   *  work went on (wokeReplies). @param {number} ts */
  const woke = (ts) => {
    cell(curRound).woke = { ended: waitedIn?.round === curRound ? waitedIn.ts : ts, at: ts };
  };
  /** A coding agent's run (HarnessV3-ACP AC1-1): its `steer-read` says the agent took a note into its input, which its
   *  model reads at its next call — the next round's start. Taken earlier, a note read then: in the meantime the agent
   *  may be compacting its own context for minutes, and the note had read "steered" all that while (2026-10-09). */
  let agentRun = false;
  /** The agent a note is queued at, where the run says it queues them (`steer: "queued"`, HarnessV3-FailurePoints
   *  §7.2): the note waits in the agent's own queue, goes in at its next step, or runs next. @type {string | null} */
  let queuedAt = null;
  /** The run's coding agent by its name, as its run says it: whose commands a `/word` note waits on. */
  let agentName = "";
  /** What the developer types waits for the run to take it — the loop's next step, or a coding agent's next tool call
   *  where its run holds notes (`holds`, HarnessV4_Tasks C34) — and they may take it back until then. */
  let takesBack = false;
  /** A coding agent's run holds what the developer types in Filament until the agent's next tool call (C34). */
  let holds = false;
  /** The messages the developer took back: never sent. @type {Set<string>} */
  const dropped = new Set();
  /** @type {any[]} */
  let taken = [];
  /** The cell whose compaction is under way (`compacting`): its live row stands until the mark, or the next round. */
  let compactingIn = null;
  /** What the agent told the person beside its answer (HarnessV4_Tasks C21), in the order said: each its own line.
   *  @type {{ severity: string, title: string, description?: string, subagent?: boolean }[]} */
  const notices = [];
  /** A coding agent's questions by their id, as asked; the ids of those settled. @type {Map<string, any>} */
  const asked = new Map();
  /** @type {Set<string>} */
  const settled = new Set();
  /** The envelopes this run sealed, by number: each one's card, which its opening in the same run marks (EN5). @type {Map<number, any>} */
  const sealedHere = new Map();
  /** The envelopes this run opened, by number: where and how — a card of an earlier turn reads it (EN5). @type {Map<number, { round: number, by: "tool" | "wait" }>} */
  const opened = new Map();
  /** The sub-agent behind an `agent` call's stub, opened on first sight. @param {any} c @param {any} parent */
  const subOf = (c, parent) => {
    const t = c.tools.get(parent);
    if (!t) return null;
    return (t.sub ||= born({ tools: new Map(), order: [], state: "running" }));
  };
  /** The rounds the last result made only to hold a message where it stands: made again by the next. @type {Set<number>} */
  let steerMade = new Set();
  /** @param {any} e */
  const add = (e) => {
    aligning = serial;
    const r0 = roundOf(e);
    steerMade.delete(r0);
    const c = cell(r0);
    // An event of a sub-agent's own moves its card (render.js `keptCall`).
    if (typeof e.type === "string" && e.type.startsWith("subagent-") && e.parent != null) bump(c.tools.get(e.parent)?.sub);
    switch (e.type) {
      case "run-start":
        agentRun = e.kind === "coding-agent";
        agentName = agentRun && e.meta?.agent ? String(e.meta.agent) : "";
        queuedAt = agentRun && e.meta?.steer === "queued" ? agentName || "the agent" : null;
        holds = agentRun && e.meta?.holds === true;
        takesBack = !agentRun || holds;
        break;
      // The run is over. Both loops end each call they began before they end their run, so one still running here is
      // one a restart or a crash cut (the next start writes that run's end: app/sessions/cut-turns.js): it reads cut
      // off, never running (HarnessV4_Tasks U1). A paused run's open call is the one that asks, and stays. A
      // sub-agent of Filament's own (`agentId`) may work on past its turn — a background launch — and its events ride
      // the run no longer: it is `left`, its end the session's list's (lib/subagents.js `endFromList`), and the call
      // it was making is not followed here. A coding agent's sub-agent has no life past its run.
      case "run-end":
        for (const cl of byRound.values()) cl.writing.clear();
        for (const cl of byRound.values())
          for (const t of cl.tools.values()) {
            bump(t);
            bump(t.sub);
            for (const inner of t.sub?.tools.values() || []) bump(inner);
            const s = t.sub?.state === "running" ? t.sub : null;
            if (s?.agentId) s.left = true;
            if (e.status === "paused") continue;
            const background = !!s?.agentId && t.state !== "running";
            if (t.state === "running") t.state = "cut";
            for (const inner of t.sub?.tools.values() || []) if (inner.state === "running") inner.state = background ? "unfollowed" : "cut";
            if (s && !s.agentId) Object.assign(s, { state: "stopped", status: "cut" });
          }
        break;
      case "round-start":
        // Where this round's own output begins among the reply's blocks (the loop's placement anchor): the round's
        // cards land between its blocks and the next round's. A round whose start the log no longer holds has none —
        // the callers fall back to the block-counting rule.
        if (Number.isInteger(e.blocksBefore)) c.blocksBefore = e.blocksBefore;
        curRound = roundOf(e);
        // Every call the rounds before wrote has run or been refused by now: none of them is still being written.
        for (const cl of byRound.values()) if (cl !== c) cl.writing.clear();
        if (compactingIn) compactingIn.compacting = null;
        compactingIn = null;
        for (const s of taken) s.read = true;
        taken = [];
        break;
      case "tool-start":
        // `at`: when it started, by the run's clock — a running command's row counts the seconds and offers Run in
        // background once it has run a while (tools/render.js OFFER_AFTER_MS).
        c.tools.set(e.id, born({ id: e.id, name: e.name, args: e.args, card: e.card || undefined, state: "running", ...(e.movable ? { movable: true } : {}), ...(Number(e.ts) > 0 ? { at: Number(e.ts) } : {}) }));
        c.order.push(e.id);
        break;
      case "tool-output": {
        // The live tail of a running command: appended, capped — the finished card shows the result's head.
        const t = c.tools.get(e.id);
        if (t) t.live = ((t.live || "") + String(e.text || "")).slice(-4000);
        bump(t);
        break;
      }
      case "tool-end":
        endTool(c.tools, c.order, e);
        if (e.learned) c.learned++;
        // A visual's call that ended without its visual was refused (VC-50): its "Drawing…" goes; its row says why.
        c.writing.delete(String(e.id));
        break;
      // The errors the language server found in the file a write or an edit left, after its result was written.
      case "tool-errors": {
        const t = c.tools.get(e.id);
        if (t && e.lsp) {
          t.lsp = e.lsp;
          bump(t);
        }
        break;
      }
      // A version of a page the agent published (HarnessV4_Artifacts_Plan E18, AF-D34): its card stands where its
      // round's calls are, as a visual's does, one for each call that published.
      case "artifact":
        if (!c.artifacts.some((/** @type {any} */ x) => x.id === String(e.id))) c.artifacts.push({ id: String(e.id || ""), name: String(e.name || ""), v: Number(e.v) || 0, title: String(e.title || "") });
        break;
      // A routine or a watcher the agent proposed or changed (the owner's of 11-12): kept on its call, whose row draws the
      // card that switches it on; the first said for each call.
      case "routine": {
        const made = { project: String(e.project || ""), routine: String(e.routine || ""), watcher: e.watcher === true, change: e.change === true, at: Number(e.at) || 0 };
        const t = e.id != null ? c.tools.get(String(e.id)) : null;
        if (t && !t.routine) {
          t.routine = made;
          bump(t);
        }
        break;
      }
      // A visual the agent drew (HarnessV4_Visuals_Plan E16): kept on its `turn` under its call's id — or on the session,
      // for a helper no turn launched (VS-D48) — and drawn where its round's calls are, in the order drawn (VC-48). While
      // the model writes the call, what it has written so far (VS-D11).
      case "visual":
        c.writing.delete(String(e.id));
        if (!c.visuals.some((/** @type {any} */ v) => v.id === String(e.id))) c.visuals.push({ id: String(e.id || ""), title: String(e.title || ""), bytes: Number(e.bytes) || 0, ...(Number.isInteger(e.turn) ? { turn: e.turn } : e.session === true ? { session: true } : {}) });
        break;
      case "visual-writing":
        if (e.gone) c.writing.delete(String(e.id));
        else if (!c.visuals.some((/** @type {any} */ v) => v.id === String(e.id))) c.writing.set(String(e.id), { id: String(e.id || ""), title: String(e.title || ""), loading: Array.isArray(e.loading) ? e.loading.map(String) : [], chars: Number(e.chars) || 0 });
        break;
      case "subagent-start": {
        const s = subOf(c, e.parent);
        if (s) Object.assign(s, { agentId: e.agentId, description: e.description, agent: e.agent, model: e.model, prompt: e.prompt, background: !!e.background, followUp: !!e.followUp, ...(Number.isInteger(e.exchange) ? { exchange: e.exchange } : {}), ...(e.role ? { team: e.team, role: e.role, ...(e.seat ? { seat: String(e.seat) } : {}) } : {}), ...(e.card ? { card: { tag: String(e.card.tag || ""), name: String(e.card.name || "") } } : {}), ...(e.asked ? { asked: true } : {}), ...(e.handed ? { handed: String(e.handed) } : {}), ...(e.attached ? { attached: attachedOf(e.attached) } : {}) });
        // An ended turn's read left some of its calls apart (services/runs.js `calls: "apart"`): how many its card counts,
        // the rest read as it opens (`fillCalls`) — its launching call's, by its round and parent. Held on an object of its
        // own, which every copy of the sub shares.
        if (s && Number.isInteger(e.callsApart) && !s.apart) s.apart = { calls: e.callsApart, filled: false, read: null, round: r0, parent: e.parent };
        if (e.agentId) launched.set(e.agentId, String(e.description || ""));
        break;
      }
      case "subagent-tool-start":
      case "subagent-tool-end":
      case "subagent-tool-errors": {
        const s = subOf(c, e.parent);
        if (s) subCall(s, e);
        break;
      }
      // Its own run, named once it exists (HarnessV4_Tasks U1): where its end is read when no one else can say.
      case "subagent-run": {
        const s = subOf(c, e.parent);
        if (s && e.run) s.run = String(e.run);
        break;
      }
      // A coding agent's sub-agent's own plan, whole (HarnessV3-ACP AC3-4): its card's checklist.
      case "subagent-plan": {
        const s = subOf(c, e.parent);
        if (s) s.plan = Array.isArray(e.items) ? e.items : [];
        break;
      }
      // A team's worker waits for the developer's answer (HarnessV3-AtHome P2), or asks its lead (`to`,
      // HarnessV3-TaskGraph-v2 TG2-D49) — its plan, while its lead reviews it (`plan`, TG2-D50): its row says so until it
      // is settled.
      case "subagent-ask": {
        const s = subOf(c, e.parent);
        if (s) s.asking = { tool: e.tool, args: e.args, ...(e.to === "lead" ? { to: "lead", ...(e.plan ? { plan: true } : {}) } : {}) };
        break;
      }
      // Its lead answered it (HarnessV3-TaskGraph-v2 TG2-D41): the card says so, and what it said — to its question, an
      // answer, never a no (TG2-D49); to its plan, its go or its corrections (TG2-D50).
      case "subagent-ask-end": {
        const s = subOf(c, e.parent);
        if (s) s.asking = null;
        if (s && e.by === "lead") (s.answers ||= []).push(e.to === "lead" ? { by: "lead", question: true, ...(e.plan ? { plan: true } : {}), words: String(e.words || "") } : { by: "lead", allowed: e.allowed === true, words: String(e.words || "") });
        break;
      }
      // A look at the lead's workers (HarnessV3-TaskGraph-v2 TG2-D22), or at the agent's graph's sub-agents (V2-0c):
      // whom it showed, their rounds and signs, and its size; a row in the round that read it.
      case "look":
        c.looks.push({ workers: (Array.isArray(e.workers) ? e.workers : []).map((/** @type {any} */ w) => ({ id: String(w?.id || ""), fromRound: Number(w?.fromRound) || 0, toRound: Number(w?.toRound) || 0, signs: Array.isArray(w?.signs) ? w.signs.map(String) : [] })), tokens: Number(e.tokens) || 0 });
        break;
      case "subagent-end": {
        const s = subOf(c, e.parent);
        // A sub-agent the stop ended is stopped, not failed — its card agrees with the parent call's soft "Stopped"
        // (the UI/UX review, 2026-09-30: it read a red "Failed" beside it).
        if (s) Object.assign(s, { state: e.ok ? "done" : e.status === "stopped" ? "stopped" : "failed", status: e.status, ms: e.ms, rounds: e.rounds, tokens: (Number(e.tokensIn) || 0) + (Number(e.tokensOut) || 0), report: e.report, error: e.error, failure: e.failure || null, usd: Number(e.spentUsd) || 0, ...(e.reportCut ? { reportCut: true } : {}), ...(e.model ? { model: e.model } : {}) });
        break;
      }
      case "subagent-dispatch":
      case "subagent-arrival": {
        const id = String(e.agentId || "");
        const { type, round, ...fields } = e;
        const mark = { ...fields, event: type === "subagent-dispatch" ? "dispatch" : "arrival", agentId: id, exchange: Number(e.exchange) || 0, description: String(e.description || "") };
        c.marks.push(mark);
        (type === "subagent-dispatch" ? dispatched : arrived).set(id, { mark, round: roundOf(e) });
        if (mark.description) launched.set(id, mark.description);
        break;
      }
      // The developer detached a sub-agent the main agent waited on: a row of its own at the round it happened, saying
      // where the report goes (it used to leave only a toast — the UI/UX review, 2026-09-30).
      case "subagent-detached": {
        const id = String(e.agentId || "");
        c.detaches.push({ agentId: id, report: e.report !== false, description: launched.get(id) || "" });
        break;
      }
      case "subagent-report": {
        const id = String(e.agentId || "");
        // The task graph's words (HarnessV3-TaskGraph G2-11): a task's end — how it stands now — or the tasks Filament
        // started, a row each.
        if (e.kind === "task") {
          c.reports.push({ agentId: id, kind: "task", description: String(e.description || ""), ...(e.task ? { task: String(e.task), state: String(e.state || "") } : {}) });
          break;
        }
        // The developer overruled a saved agent's answer (HarnessV4_Tasks E15 step 3): the agent read whose, here.
        if (e.kind === "overrule") {
          c.reports.push({ agentId: id, kind: "overrule", description: String(e.description || "") });
          break;
        }
        // The developer applied a sub-agent's changes (step 5, BW-8): the agent read here which files changed under it.
        // Or the lead read what came of Filament's check of the folder after its apply (HarnessV3-TaskGraph-v2 TG2-D55),
        // or what you told one of its workers past it (HarnessV4_Tasks decision 10).
        // Or a team's result beside the chat, or a flow's end, handed in as a sub-agent's report goes
        // (HarnessV4_Envelopes_Plan EN4): no agent of yours, so no arrival mark to tick.
        // A result opened from its envelope (EN5) draws no row of its own: its envelope's card says it opened, or the
        // row of the opening does, where its envelope was sealed in an earlier turn.
        const fromEnvelope = Number(e.envelope) > 0;
        if (e.kind === "applied" || e.kind === "check" || e.kind === "told" || e.kind === "result") {
          if (!fromEnvelope) c.reports.push({ agentId: id, kind: e.kind, description: String(e.description || "") });
          break;
        }
        const kind = e.kind === "notice" ? "notice" : "report";
        const marked = (kind === "notice" ? dispatched : arrived).get(id);
        if (marked && kind === "notice" && !marked.mark.told) {
          marked.mark.told = true;
          break;
        }
        if (marked && kind === "report" && !e.sent && marked.mark.delivery !== "held" && marked.mark.read == null) {
          marked.mark.read = marked.round === roundOf(e) ? "here" : roundOf(e) + 1;
          break;
        }
        if (!fromEnvelope) c.reports.push({ agentId: id, kind, description: String(e.description || "") || launched.get(id) || "", ...(e.sent ? { sent: true } : {}) });
        break;
      }
      // Another agent's result, sealed while the agent worked (HarnessV4_Envelopes_Plan EN5): a card at the step it
      // landed — who sent it, its subject — which its opening marks: in this run, at the step it opened and how; one
      // sealed in an earlier turn is said where it opened.
      case "envelope-sealed": {
        const n = Number(e.envelope) || 0;
        const card = { n, agentId: String(e.agentId || ""), description: String(e.description || ""), sender: String(e.sender || ""), subject: String(e.subject || ""), ...viaOf(e), opened: /** @type {{ round: number, by: "tool" | "wait" } | null} */ (null) };
        c.envelopes.push(card);
        if (n) sealedHere.set(n, card);
        break;
      }
      case "envelope-opened": {
        const n = Number(e.envelope) || 0;
        const at = { round: roundOf(e), by: /** @type {"tool" | "wait"} */ (e.by === "tool" ? "tool" : "wait") };
        if (n) opened.set(n, at);
        const card = sealedHere.get(n);
        if (card) card.opened = at;
        else c.opens.push({ n, agentId: String(e.agentId || ""), description: String(e.description || ""), sender: String(e.sender || ""), ...viaOf(e), by: at.by });
        break;
      }
      // Filament's word on the envelopes still sealed: once, as the turn would end (EN-D5), and the list said again with
      // the developer's message or after a coding agent compacted (EN-D6).
      case "envelope-reminder":
      case "envelope-list": {
        const list = (Array.isArray(e.envelopes) ? e.envelopes : []).map(Number).filter((x) => x > 0);
        if (list.length) c.envelopeNotes.push(e.type === "envelope-reminder" ? { kind: "reminder", envelopes: list } : { kind: "list", at: e.at === "compaction" ? "compaction" : "start", envelopes: list });
        break;
      }
      // Background shells that ended unread: the agent heard of them after this round (TL-D24), drawn among its reports.
      case "shell-exit":
        for (const s of Array.isArray(e.shells) ? e.shells : []) c.reports.push({ kind: "shell", agentId: String(s?.id || ""), description: String(s?.command || ""), code: s?.code ?? null });
        break;
      // A folder's instruction files told as the agent first worked there: a quiet line each, opening to the text.
      case "instructions-told":
        for (const f of Array.isArray(e.files) ? e.files : []) c.told.push({ file: String(f?.file || ""), as: String(f?.as || ""), how: String(f?.how || "read"), text: String(f?.text || "") });
        break;
      case "plan":
        // One card for the run's plan, at its newest list: a round whose plan a later one replaced draws none, and its
        // plan call's row stays out too (`planLater`, render.js `roundRows`) — the card says it.
        if (planIn && planIn !== c) Object.assign(planIn, { plan: null, planLater: true });
        c.plan = e.items || [];
        planIn = c;
        planned = "plan";
        break;
      case "graph":
        c.graph = e.graph || null;
        planned = "graph";
        break;
      case "ask": {
        if (!e.form && !e.waits) {
          c.asks.push(e);
          break;
        }
        asked.set(String(e.id), e);
        const t = c.tools.get(e.call || `ask:${e.id}`);
        if (t) t.form = e.form;
        bump(t);
        break;
      }
      case "ask-end": {
        settled.add(String(e.id));
        const t = c.tools.get(e.call || `ask:${e.id}`);
        if (t) t.answer = (Array.isArray(e.words) ? e.words : []).join("\n");
        bump(t);
        break;
      }
      // The round said words, or thought (the run's copy of each): an archive that keeps a reply's words without its
      // thinking (a coding agent's, app/agent-run.js) holds a block for each round that said words (roundCardAnchor).
      case "round-text":
        c.said = true;
        break;
      case "round-thinking":
        c.thought = true;
        break;
      case "snapshot":
        c.snapshots.push(e);
        break;
      case "place":
        if (e.place) place = { place: String(e.place), home: e.home === true };
        break;
      case "hook":
        c.hooks.push(e);
        break;
      case "vetoed":
        c.vetoed = e.tasks || 0;
        break;
      case "turn-state": {
        turnState = { to: String(e.to || ""), why: String(e.why || ""), ...(e.retry ? { retry: e.retry } : {}), ...(e.queue ? { queue: e.queue } : {}), ...(Number(e.tokens) > 0 ? { tokens: Number(e.tokens) } : {}) };
        if (e.to === "sent" && sentAt == null && Number(e.ts) > 0) sentAt = Number(e.ts);
        const ts = Number(e.ts) || 0;
        // The round's first wait that is no model call's: its reply had ended, and the turn waited for what was owed.
        if (e.to === "waiting" && !e.retry && !e.queue && waitedIn?.round !== curRound) waitedIn = { round: curRound, ts };
        // Its turn had ended on the round's reply, and Filament woke it within the turn (`woke`, or a run from before it
        // said so, in its words).
        if (e.woke || (WOKE_STATES.has(String(e.why)) && (e.to === "planning" || e.to === "acting"))) woke(ts);
        break;
      }
      case "notice":
        note = { kind: String(e.kind || ""), text: String(e.text || ""), ...(e.quoted ? { quoted: true } : {}) };
        break;
      case "agent-notice":
        if (e.title) notices.push({ severity: String(e.severity || "info"), title: String(e.title), ...(e.description ? { description: String(e.description) } : {}), ...(e.subagent ? { subagent: true } : {}) });
        break;
      case "steer": {
        // Its pictures by name, and those kept beside the run's log by their ref, one place per picture (V4-D303).
        // Whose answers a note overrules (HarnessV4_Tasks E15 step 3), by name: its bubble's mark.
        const pics = Array.isArray(e.images) ? e.images : [];
        const kept = pics.some((/** @type {any} */ p) => typeof p?.ref === "string");
        // What the developer typed (no one else's: `from`) can be taken back while it waits; a coding agent's run
        // holds it for its agent's next tool call, unless it interrupts (C34).
        const typed = !STEER_FROM.has(String(e.from)) && (e.kind === "note" || e.kind === "veto");
        const back = { ...(takesBack && typed ? { canTakeBack: true } : {}), ...(holds && typed && !e.interrupt ? { holds: true, agent: agentName } : {}) };
        steers.set(e.id, { ...back, id: e.id, kind: e.kind, text: e.text, at: e.at, read: false, unread: false, round: roundOf(e), ...(STEER_FROM.has(String(e.from)) ? { from: String(e.from), ...(typeof e.title === "string" && e.title ? { title: e.title } : {}) } : {}), ...(queuedAt && e.kind === "note" ? { queuedAt } : {}), ...(e.interrupt ? { interrupt: true } : {}), ...(e.aside ? { aside: "weighing" } : {}), ...(Array.isArray(e.overrules) && e.overrules.length ? { overrules: e.overrules.map((/** @type {any} */ o) => ({ name: String(o?.name || "") })) } : {}), ...(pics.length ? { files: pics.map((/** @type {any} */ p) => String(p?.name || "picture")) } : {}), ...(kept ? { shots: pics.map((/** @type {any} */ p) => (typeof p?.ref === "string" ? { ref: p.ref } : null)) } : {}) });
        break;
      }
      // The loop folded this turn's older rounds (the line, or the developer's Compact), or a coding agent compacted
      // its own context (HarnessV3-ACP AC2-1): the event carries the round that had just finished, so its row stands
      // after that round's work and before the next round's words — an agent's before its first model call, round 0,
      // ahead of all of them. It used to leave no trace in the transcript (the UI/UX review, 2026-09-30).
      case "compacting":
        c.compacting = e;
        compactingIn = c;
        break;
      case "compaction":
        // When it began, where its start was said: the line stands from then (partSpans).
        c.compactions.push(Number(compactingIn?.compacting?.ts) > 0 ? { ...e, began: Number(compactingIn.compacting.ts) } : e);
        if (compactingIn) compactingIn.compacting = null;
        compactingIn = null;
        break;
      case "steer-read":
        // A note queued at a coding agent that ran as its next prompt, its turn having ended first: it woke the agent.
        if (agentRun && e.after) woke(Number(e.ts) || 0);
        for (const id of e.ids || []) {
          const s = steers.get(id);
          if (!s) continue;
          s.readRound = curRound;
          // When the agent had it: a settled turn's work folds apart there (partSpans).
          if (Number(e.ts) > 0) s.readAt = Number(e.ts);
          if (e.after) s.after = true;
          if (agentRun && s.kind === "note") {
            s.taken = true;
            taken.push(s);
          } else s.read = true;
        }
        break;
      case "steer-unread":
        for (const id of e.ids || []) if (steers.has(id)) steers.get(id).unread = true;
        break;
      // Handed to its agent, changed, or taken back while it waited (HarnessV4_Tasks C34): one taken back was never
      // sent, and leaves the chat.
      case "steer-sent":
        for (const id of e.ids || []) if (steers.has(id)) steers.get(id).sent = true;
        break;
      case "steer-edit": {
        const s = steers.get(e.id);
        if (!s) break;
        s.text = String(e.text || "");
        // New words that are no longer weighed — the fork had passed the note on — wait as any note; one still held is
        // weighed again, which its next steer-aside says.
        if (s.aside === "correction" || s.aside === "straight") delete s.aside;
        break;
      }
      case "steer-drop":
        for (const id of e.ids || []) {
          steers.delete(id);
          dropped.add(String(id));
        }
        break;
      // The pictures these messages carried did not reach the model: its provider refused them, in these words.
      case "steer-pictures":
        for (const id of e.ids || []) if (steers.has(id)) steers.get(id).refused = String(e.refused || "refused");
        break;
      // How the fork that weighs a note aside goes (the owner's forked steer of 11-04): at work on it; a correction, which
      // waits for the loop as any note; straight in, unweighed; or answered for the person, or planned as tasks for the
      // agent — off the queue, drawn in the cell of the round it settled in, as a note the loop read is in its own.
      case "steer-aside": {
        const s = steers.get(e.id);
        if (!s) break;
        const as = String(e.as || "");
        s.aside = as;
        if (e.agent) s.fork = String(e.agent);
        if (as === "straight" && e.why) s.why = String(e.why);
        if (as === "question" || as === "work") {
          s.read = true;
          s.readRound = curRound;
          if (Number(e.ts) > 0) s.readAt = Number(e.ts);
          if (e.answer) s.answer = String(e.answer);
          if (e.letter) s.letter = true;
          const tasks = Array.isArray(e.tasks) ? e.tasks : [];
          if (tasks.length) s.tasks = tasks.map((/** @type {any} */ t) => `${String(t?.id || "")}${t?.name ? ` (${String(t.name)})` : ""}`).join(", ");
        }
        break;
      }
      // How a coding agent's run weighed a `/word` note (HarnessV4_Tasks U1): the agent's own command, which waits for
      // the turn's end; one that may be, which waits for the agent to say its commands; or, after that wait, words.
      case "steer-weighed":
        for (const id of e.ids || []) {
          const s = steers.get(id);
          if (!s) continue;
          s.waits = e.as === "command" ? "command" : e.as === "unsure" ? "commands" : null;
          if (e.word) s.word = String(e.word);
          s.agent = agentName;
        }
        break;
    }
  };
  const result = () => {
    // A message the loop read joins the round whose results carried it, drawn in the flow between that round's work
    // and the next round's words; one still waiting stays with its own round (0), for the box at the bottom
    // (boxSteers). Placed again at each result: a message moves as it is read.
    for (const r of steerMade) byRound.delete(r);
    steerMade = new Set();
    for (const cl of byRound.values()) cl.steers = [];
    for (const s of steers.values()) {
      const r = s.read && Number.isInteger(s.readRound) ? s.readRound : s.round;
      if (!byRound.has(r)) steerMade.add(r);
      cell(r).steers.push(s);
    }
    let maxRound = 0;
    for (const r of byRound.keys()) maxRound = Math.max(maxRound, r);
    const waiting = [...asked.values()].filter((a) => a.waits && !settled.has(String(a.id)));
    return { byRound, maxRound, steers, dropped, turnState, sentAt, note, planned, waiting, place, notices, opened };
  };
  return { add, result };
}

/**
 * A notice the agent told the person (HarnessV4_Tasks C21), in words: its title, then what it says — "Model fallback —
 * claude-opus-5-5 was overloaded, …"; an agent on the side's says so. Its tone is its severity's: a warning's or an error's
 * stands out, the rest are quiet.
 * @param {{ severity: string, title: string, description?: string, subagent?: boolean }} n
 * @returns {{ tone: "warn" | "err" | "info", words: string }}
 */
export function agentNoticeWords(n) {
  const tone = n.severity === "error" ? "err" : n.severity === "warning" ? "warn" : "info";
  return { tone, words: `${n.subagent ? "A sub-agent: " : ""}${n.title}${n.description ? ` — ${n.description}` : ""}` };
}

/**
 * The always-allow a call's question carries (HarnessV3-Views V3), from the first ask of its shape (HarnessV4_Tasks
 * E3): the shape, and the memory item waiting for it where a yes brought one to the threshold (`itemId`), else null —
 * Always allow then makes the rule.
 * @typedef {{ itemId: number | string | null, tool: string, shape: string }} Offer
 */

/**
 * What an always-allow covers (HarnessV3-Views V3), for its choice's words: the offer an ask carries names its call's
 * shape — a command's head word (and its subcommand), or the kind of file a write or an edit touches.
 * @param {{ tool: string, shape: string }} offer
 */
export function offerWords(offer) {
  if (offer.tool === "bash") return `don't ask again to run ${offer.shape}`;
  const files = offer.shape === "(no extension)" ? "files without an extension" : `${offer.shape} files`;
  return `don't ask again to ${offer.tool === "write" ? "write" : "edit"} ${files}`;
}

/**
 * What "Always allow in this chat" keeps (d-allow), as an ask carries it where the project offers no always-allow for
 * its command: the commands a press keeps — each part of the command that neither only reads nor is a `cd` into its own
 * folder —, the hand's family they were asked through (`bash`, `powershell`) and the folder. The server makes it, and
 * reads each command again when the press sends it back.
 * @typedef {{ hand: string, folder: string, commands: string[] }} Keeps
 */

/** How many characters of kept commands a choice names in its own words; past it, it says "this command". */
const KEEPS_NAMED = 80;
/** Names as a sentence lists them: "a, b and c". @param {readonly string[]} names */
const andList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join(""));

/**
 * What Always allow in this chat keeps (d-allow), for its choice's words: the commands themselves, in backticks its
 * row draws as code — or "this command" where that is the command the card shows above it, or they are too long for
 * a row: the kept text is the row's title then.
 * @param {Keeps} keeps @param {string | null} [shown]  the command the card shows
 * @returns {{ words: string, title: string }}
 */
export function keepsWords(keeps, shown = "") {
  const kept = keeps.commands;
  const whole = kept.length === 1 && kept[0] === String(shown || "").trim();
  if (whole || kept.join("").length > KEEPS_NAMED) return { words: `don't ask again to run exactly ${kept.length > 1 ? "these commands" : "this command"}`, title: kept.join("\n") };
  return { words: `don't ask again to run exactly ${andList(kept.map((c) => `\`${c}\``))}`, title: "" };
}

/**
 * What the page says once a press of Always allow in this chat is kept (d-allow), as the project's says its own: the
 * commands the server kept, and where they are taken back.
 * @param {readonly string[]} kept
 */
export function keptToast(kept) {
  return `Always allowed in this chat: ${andList(kept)}. The permission switch lists ${kept.length > 1 ? "them" : "it"}, with Forget`;
}

/** What a stop or a compact bubble says in each state (BUG-09): a stop cuts what is running at once and a compact
 *  runs at the loop's next step, so "waiting for the run's next step" read wrong for both. */
const ACTION_WORDS = Object.freeze({
  stop: { label: "■ Stop", pending: "Stopping…", read: "Stopped", unread: "Nothing to stop — the turn had already finished", undelivered: "Not delivered: no run was listening" },
  compact: { label: "Compact", pending: "Compacting at the loop's next step…", read: "Taken up by the loop", unread: "The turn ended before it compacted", undelivered: "Not delivered: no run was listening" },
});

/**
 * What a steering bubble says (§5.5.3): its tone (pending → read, or honestly unread / undelivered), its text and its
 * state line. A stop and a compact are actions, not words (BUG-09): a fixed chip — the event log carries no text for
 * them, so the bubble used to read "stop" live and nothing after a reload — and states in their own words; a stop that
 * found the turn already over is no failure (the page draws that tone muted). A note or a veto shows what was typed.
 * Once the turn has settled nothing is pending any more: a message still neither read nor marked unread was never
 * read (the page missed the run's last events, or the turn ended as it landed) — it reads unread, never "Stopping…"
 * or "Waiting for the run's next step…" for the life of the page (the UI/UX review, 2026-09-30). A message a stop
 * overtook says the turn stopped (`stopped`): the owner stopped it, nothing broke. A message typed before the turn's
 * run was known (`held`, HarnessV3-CodebasePass decision 2) waits for the run to start, and says so. A note a coding
 * agent took into its input (`taken`, alignEvents) is delivered, and says so until its model reads it.
 * A note to an agent that queues what is typed, as Claude Code does (`queuedAt`: the agent, HarnessV3-FailurePoints
 * §7.2; HarnessV4_Tasks U1), says where it is: queued at the agent for its next step; taken, once the agent has it in
 * its turn; or — its turn ended first (`after`) — runs next. One sent to interrupt it (`interrupt`, FP-D8) says so.
 * A `/word` note its run does not hand over at once says why (`waits`, the run's `steer-weighed`): it is the agent's
 * own command (`command`), which waits for the turn's end and goes as the next message; or it may be one and the agent
 * (`agent`) has not said its commands yet (`commands`) — it waits for them, and reads as any note once it is weighed.
 * What the developer typed into a run that holds it (`holds`, HarnessV4_Tasks C34) waits in Filament for the agent's
 * next tool call, and says so until it is handed over (`sent`): then as any note to that agent.
 * A note a fork weighs aside (`aside`, the owner's forked steer of 11-04) says so while it does (`weighing`); one it
 * found a correction waits for the agent's next step, and says so (`correction`); one it answered (`question`) or
 * planned as tasks (`work`, `tasks`) is done with, and says what came of it — and that the agent was written to
 * (`letter`); one that went in unweighed (`straight`) reads as any note, and says why where its run said (`why`):
 * the fork failed, gave no verdict, or none could start as its turn in line came.
 * @param {{ kind?: string, text?: string, read?: boolean, unread?: boolean, undelivered?: boolean, held?: boolean, next?: boolean, taken?: boolean, queuedAt?: string | null, interrupt?: boolean, after?: boolean, waits?: "command" | "commands" | null, word?: string, agent?: string, files?: string[], refused?: string, holds?: boolean, sent?: boolean, aside?: string, why?: string, tasks?: string, letter?: boolean, from?: string }} s
 * @param {{ settled?: boolean, stopped?: boolean }} [o]
 * @returns {{ tone: "pending" | "read" | "unread" | "undelivered", action: boolean, text: string, state: string }}
 */
export function steerWords(s, { settled = false, stopped = false } = {}) {
  const tone = s.undelivered ? "undelivered" : s.unread ? "unread" : s.read ? "read" : settled ? "unread" : "pending";
  const act = s.kind === "stop" || s.kind === "compact" ? ACTION_WORDS[s.kind] : null;
  if (act) return { tone, action: true, text: act.label, state: act[tone] };
  // A turn that ended before its agent took the note — a coding agent's (HarnessV3-ACP AC3-1), Filament's loop's (the
  // owner's of 11-09) — queues it as the next message: words true while it waits and once it has gone.
  const own = s.waits === "command" ? `${s.word || "This"} is ${s.agent || "the agent"}'s own command` : "";
  // A watcher's guidance the turn ended before is no message of the person's to send again: Filament sends it on.
  const unread = s.from === "watcher" ? "The turn ended before the agent read this — Filament sends it on as a turn of its own"
    : s.next ? (own ? `${own} — queued as your next message` : "The turn ended before the agent took this — queued as your next message") : stopped ? "The turn stopped before reading this" : "The run ended before reading this";
  const who = s.queuedAt || "";
  // What the fork that weighed it made of it, once it is done with it.
  if (s.read && s.aside === "question") return { tone, action: false, text: String(s.text || ""), state: `Answered aside — the agent worked on${s.letter ? ", and was told what it changes for its work" : ""}` };
  if (s.read && s.aside === "work")
    return { tone, action: false, text: String(s.text || ""), state: `Planned aside for the agent${s.tasks ? `: ${s.tasks}` : ""} — none started; it reads the fork's letter when it chooses` };
  const pending = s.aside === "weighing"
    ? "Weighing this aside — the agent works on…"
    : s.aside === "correction"
      ? "A correction — it reaches the agent at its next step…"
      : s.aside === "straight" && s.why && !s.taken
      ? `Not weighed aside — ${s.why}: it reaches the agent at its next step…`
      : s.taken
    ? s.after ? `Runs next — ${who || "the agent"}'s turn had ended first` : who ? `Taken — ${who} has it in its turn` : "Delivered — the agent reads it at its next step"
    : own ? `${own} — it waits for the turn's end and goes as your next message`
      : s.waits === "commands" ? `Waiting for ${s.agent || "the agent"} to say its commands — ${s.word || "this"} may be one of them`
        : s.held ? "Waiting for the run to start…"
          : s.holds && !s.sent ? `Waits for ${s.agent || "the agent"}'s next tool call`
            : who ? (s.interrupt ? `Interrupting ${who}…` : `Queued at ${who} — goes in at its next step`)
              : "Waiting for the run's next step…";
  // Its words reached the model and its pictures did not (the run's `steer-pictures`): said beside the state.
  const lost = s.refused && s.files?.length ? ` — ${s.files.length === 1 ? "its picture was not sent: the model's provider refused it" : "its pictures were not sent: the model's provider refused them"}` : "";
  const unweighed = s.aside === "straight" && s.why ? ` — not weighed aside: ${s.why}` : "";
  const state = { undelivered: "Not delivered: no run was listening", unread, read: `${s.after ? "Ran as its next prompt" : "Conversation steered"}${unweighed}${lost}`, pending }[tone];
  return { tone, action: false, text: String(s.text || ""), state: s.kind === "veto" ? `veto — ${state}` : state };
}

/**
 * Whether a steering bubble offers Edit and Delete (HarnessV4_Tasks C34): what the developer typed, still waiting for
 * the run to take it — the loop's next step, or a coding agent's next tool call where its run holds it — and known to
 * the run by its id. Edit takes it back into the box, to change and send again; Delete takes it back.
 * @param {{ id?: string, kind?: string, canTakeBack?: boolean, sent?: boolean, read?: boolean, taken?: boolean, unread?: boolean, undelivered?: boolean, next?: boolean, held?: boolean }} s
 * @param {boolean} settled  the turn is over
 */
export const canTakeBack = (s, settled) =>
  !settled && !!s.canTakeBack && (s.kind === "note" || s.kind === "veto") && !!s.id && !String(s.id).startsWith("local-") && !(s.sent || s.read || s.taken || s.unread || s.undelivered || s.next || s.held);

/**
 * How a turn that just ended reads (BUG-07), from what the page saw and the turn's record. A run a developer stopped
 * — from this page or any other surface — reads stopped although the page's read of the reply ended normally (a stop
 * steer never aborts the read); a stop the run never read (the turn finished first) reads done. The page's own
 * abort, a pause, an error and a turn with no run stand as they are. The run is the loop's (`agent`), or a coding
 * agent's (`acp.run`, HarnessV3-ACP AC1-5).
 * @param {string} status  what the page decided when the reply ended
 * @param {{ agent?: RunRecord, acp?: { run?: RunRecord } } | null | undefined} rec  the turn's record
 * @param {{ aborted?: boolean }} [o]  whether the page itself aborted its read
 * @returns {string}
 * @typedef {{ status?: string, stoppedBy?: string }} RunRecord
 */
export function endedStatus(status, rec, { aborted = false } = {}) {
  const run = rec?.agent || rec?.acp?.run;
  if ((status !== "done" && status !== "stopped") || !run?.status) return status;
  if (run.stoppedBy) return "stopped";
  if (status === "stopped" && !aborted && run.status === "done") return "done";
  return status;
}

/**
 * A reply cut at its ceiling that the turn went on from (the run's `output-cut`, HarnessV3-TaskGraph-v2 TG2-D62), in
 * words: what it was cut at, where, and that Filament went on. @param {any} e
 */
export function outputCutWords(e) {
  const n = (/** @type {any} */ x) => Number(x || 0).toLocaleString();
  const at = e.by === "window" ? `the room its window had left (${n(e.at)} tokens)` : `the output ceiling (${n(e.at)} tokens)`;
  const where = e.part === "thinking" ? " while thinking" : e.part === "call" ? ` while writing its call to ${e.tool || "a tool"}` : e.part === "text" ? " in its text" : "";
  return `Cut at ${at}${where} — Filament went on.`;
}

/** The stop reason in words, honestly (the ✂ flag for a cut, never dressed as success). @param {string | null} r */
export function stopReasonText(r) {
  switch (r) {
    case "end_turn":
    case "stop":
      return "finished";
    case "max_tokens":
    case "length":
      return "cut at the output ceiling — the reply may be incomplete";
    case "tool_use":
    case "tool_calls":
      return "paused on tools";
    case "stop_sequence":
      return "stopped at a stop sequence";
    case null:
    case undefined:
      return "";
    default:
      return String(r);
  }
}

/** A team on the side's state, in the sidebar's word. */
const SIDE_ROW_WORDS = Object.freeze({ works: "working", asks: "asks you", stopped: "stopped", done: "done" });
/** How many teams on the side stand under one chat's row at most. */
export const SIDE_ROWS_MOST = 3;

/**
 * The teams on the side of each chat, as the sidebar draws them under its row (HarnessV4_Tasks U13-D5): "↳ Bug
 * Hunter", a "side" tag and its state in a word — those at work or asking you first, then the newest; one that ended
 * stays the day it last ran, and the chat's Agents tab keeps them all.
 * @param {readonly any[]} rows  the team chats, as the sessions list answers `kind=team`
 * @param {{ running: ReadonlySet<string>, paused: ReadonlySet<string>, errored: ReadonlySet<string>, stopped?: ReadonlySet<string> }} marks  the runs'
 *   marks: `stopped`, the chats whose newest run was stopped or cut off by a restart — a team's lead that never got to
 *   its end is stopped, not done
 * @returns {Map<string, { s: any, name: string, state: keyof typeof SIDE_ROW_WORDS, words: string }[]>}  by the chat they work for
 */
export function sideChatsUnder(rows, marks) {
  /** @type {Map<string, { s: any, name: string, state: keyof typeof SIDE_ROW_WORDS, words: string }[]>} */
  const out = new Map();
  for (const s of rows) {
    const main = s?.beside?.main;
    if (!main) continue;
    /** @type {keyof typeof SIDE_ROW_WORDS} */
    const st = marks.paused.has(s.id) ? "asks" : marks.running.has(s.id) ? "works" : marks.errored.has(s.id) || marks.stopped?.has(s.id) ? "stopped" : "done";
    if ((st === "done" || st === "stopped") && timelineBucket(s.when) !== "Today") continue;
    out.set(main, [...(out.get(main) || []), { s, name: String(s.beside.name || s.title || "A team"), state: st, words: SIDE_ROW_WORDS[st] }]);
  }
  const live = (/** @type {{ state: string }} */ x) => (x.state === "asks" || x.state === "works" ? 1 : 0);
  for (const [main, list] of out) out.set(main, list.sort((a, b) => live(b) - live(a) || String(b.s.when || "").localeCompare(String(a.s.when || ""))).slice(0, SIDE_ROWS_MOST));
  return out;
}

/**
 * A project's count in words, for its tooltip (the Designer's of 10-27, on the Hunter's find): its number is the chats
 * it opens to; the rest of its chats stand in Now or under Pinned. "7 chats", or "4 chats here · 2 in Now · 1 pinned",
 * a part that is none left out.
 * @param {number} here  the chats under it @param {number} inNow  those in Now @param {number} pinned  those under Pinned
 */
export function projectCountWords(here, inNow, pinned) {
  const chats = (/** @type {number} */ n) => `${n} chat${n === 1 ? "" : "s"}`;
  if (!inNow && !pinned) return chats(here);
  return [here ? `${chats(here)} here` : "No chats here", inNow ? `${inNow} in Now` : "", pinned ? `${pinned} pinned` : ""].filter(Boolean).join(" · ");
}

/**
 * A team on the side's chat as the list of team chats names it — its team, and the chat it works for — for one this
 * page never opened: started in another window, or before the page opened. Null for a chat the list has no team for.
 * @param {readonly any[]} rows  the team chats, as the sessions list answers `kind=team` @param {string} chain
 * @returns {{ name: string, main: string } | null}
 */
export function besideNamed(rows, chain) {
  const s = rows.find((x) => x?.id === chain && x.beside?.main);
  return s ? { name: String(s.beside.name || s.title || "A team"), main: String(s.beside.main) } : null;
}

/** Timeline section for a session stamp. @param {string | null | undefined} when */
export function timelineBucket(when) {
  if (!when) return "Older";
  const s = String(when).trim();
  const then = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
    : new Date(s.includes("T") ? s : s.replace(" ", "T"));
  if (!Number.isFinite(then.getTime())) return "Older";
  const now = new Date();
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((start(now).getTime() - start(then).getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 14) return "Last week";
  if (now.getMonth() === then.getMonth() && now.getFullYear() === then.getFullYear()) return "This month";
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (then.getMonth() === last.getMonth() && then.getFullYear() === last.getFullYear()) return "Last month";
  return "Older";
}

/** The hour boundaries the greeting changes at. */
export const GREETING_BOUNDARIES = [5, 9, 12, 14, 18, 23];

/** Milliseconds until the next greeting boundary, so the empty state re-evaluates itself. @param {Date} [now] */
export function msUntilNextGreetingBoundary(now = new Date()) {
  const t = now.getTime();
  for (const hour of GREETING_BOUNDARIES) {
    const boundary = new Date(now);
    boundary.setHours(hour, 0, 0, 0);
    if (boundary.getTime() > t) return boundary.getTime() - t;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(GREETING_BOUNDARIES[0], 0, 0, 0);
  return tomorrow.getTime() - t;
}

/**
 * Empty-state greeting by local hour; the evening praises the day's work only when there was some (HarnessV3-Launch
 * LD-D4). @param {number} hour @param {boolean} [worked]  one of the developer's tasks had a turn today
 */
export function greetingAt(hour, worked = false) {
  const h = Number(hour);
  if (h >= 5 && h < 9) return "Morning, ready when you are";
  if (h >= 9 && h < 12) return "Morning, how can I help?";
  if (h >= 12 && h < 14) return "Noon break?";
  if (h >= 14 && h < 18) return "Good afternoon! Leave the rest to me.";
  if (h >= 18 && h < 23) return worked ? "Evening, nice work today" : "Good evening";
  return "It's late—remember to take care of yourself.";
}

/**
 * Whether one of the developer's tasks had a turn today, by the local day (LD-D4): a task or a fork from the sidebar's
 * rows, never Filament's own calls (a tick's, a sub-agent's transcript).
 * @param {readonly any[]} sessions  the sidebar's rows @param {Date} now
 */
export function workedToday(sessions, now) {
  const day = now.toDateString();
  return (sessions || []).some(
    (s) => (s?.kind === "interactive" || s?.kind === "fork") && Number(s.turns) > 0 && !!s.when && new Date(s.when).toDateString() === day,
  );
}

/** Last non-empty line of a thinking stream — the collapsed trigger's masked tail. @param {string} text */
export function lastThinkingLine(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = (lines[i] || "").trim();
    if (t) return t;
  }
  return "";
}

/**
 * A chat's name from its messages: the first one `which` picks that reached the model. A command Filament answered
 * (`/set …`, `/goal …`; the turn's `command` mark) names nothing (backlog 18), nor a message the person did not send —
 * one Filament or a coding agent began (the turn's `by`, core/turn-by.js as the transcript says it).
 * @param {any[] | undefined} turns @param {(t: any) => boolean} which @returns {string}
 */
export function firstMessageName(turns, which) {
  return (turns || []).find((t) => which(t) && t.userText && !t.command && !t.by)?.userText || "";
}

/** `Worked for 4m 19s` / `Working for …` duration (two units, d h m s). @param {number} ms */
export function formatWorkedFor(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const total = Math.max(1, Math.round(ms / 1000));
  const parts = [];
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || !parts.length) parts.push(`${seconds}s`);
  return parts.slice(0, 2).join(" ");
}

/**
 * The work fold's header once the turn has ended (while it runs, the fold draws its timer). A stopped turn reads the
 * same live and after a reload — "Stopped after 9s" — and its title says who stopped it. It used to read "Stopped"
 * live, and "Worked for 9s" beside a "Stopped from the harness" flag after a reload (HarnessV3-FixRound item 11).
 * A live turn knows it was stopped by its status; an archived one by its `stopped { by, at, forced? }` mark (a
 * follower's live turn by `stopped: true`). A Force stop reads the same, and its title says it was forced.
 * @param {{ status?: string, startedAt?: number, endedAt?: number, stopped?: { by?: string, forced?: boolean } | boolean | null }} turn
 * @returns {{ text: string, title: string }}
 */
export function foldWords(turn) {
  const s = Number(turn?.startedAt),
    e = Number(turn?.endedAt);
  const span = Number.isFinite(s) && Number.isFinite(e) && e > s + 500 ? formatWorkedFor(e - s) : "";
  if (foldSaysStopped(turn)) {
    const mark = typeof turn?.stopped === "object" ? turn.stopped : null;
    const by = mark?.by;
    // A sub-agent's turn its lead, the chat's agent or Filament stopped says so in the page's words; another client by its name.
    const who = !turn?.stopped ? "stopped by you" : !by || by === "harness" ? "stopped from the harness" : `stopped by ${by === "lead" ? "its lead" : by === "agent" ? "your agent" : by === "filament" ? "Filament" : by}`;
    return { text: span ? `Stopped after ${span}` : "Stopped", title: mark?.forced ? `force-${who}` : who };
  }
  return { text: span ? `Worked for ${span}` : "Worked", title: "" };
}

/**
 * Whether a turn's fold reads "Stopped": its status, or its archived mark. Such a fold is drawn even over no work
 * (LD-D7): it is where the page says the stop.
 * @param {{ status?: string, stopped?: unknown } | null | undefined} turn
 */
export const foldSaysStopped = (turn) => turn?.status === "stopped" || !!turn?.stopped;

/**
 * How the work fold's header stands once the turn is laid out. Over no work a finished turn draws none — a "Worked"
 * over an empty box says nothing. While the turn runs it stays bare: its words are the turn's live line, with nothing
 * to open until work moves in under a newer text (the work after the last text stands below it). A stopped turn's
 * stays bare, its words with nothing to open: "Stopped after 3s" is where the page says the stop, so the reply leaves
 * Filament's stop note out (LD-D7).
 * @param {{ status?: string, stopped?: unknown }} turn @param {number} folded  how many segments the fold holds
 * @returns {{ hidden: boolean, bare: boolean }}
 */
export function foldHeader(turn, folded) {
  if (folded > 0) return { hidden: false, bare: false };
  const live = turn?.status === "streaming" || turn?.status === "paused";
  return live || foldSaysStopped(turn) ? { hidden: false, bare: true } : { hidden: true, bare: false };
}

/**
 * A turn's pause as the dock draws it, made one way from the run's live `ask` and from the transcript's `paused` after
 * a reload: its kind and words, the tool that asks, a question's choices (TL-D11), the always-allow waiting for a
 * call's shape (HarnessV3-Views V3) or what the chat's own would keep (d-allow), a command whole with the reason it asks (V6-9), the
 * files a change makes, each as its diff (HarnessV3-ACP, AC3's drive D5), and a review rule with its second look
 * (HarnessV4_Space_Plan SG-D13) — nothing else of either.
 * @param {any} p
 */
export function pauseOf(p) {
  return {
    kind: p.kind || "question",
    question: p.question || "",
    tool: p.tool || null,
    ...(p.options?.length ? { options: p.options } : {}),
    ...(p.offer ? { offer: p.offer } : {}),
    ...(p.keeps ? { keeps: p.keeps } : {}),
    ...(p.command ? { command: p.command } : {}),
    ...(p.reason ? { reason: p.reason } : {}),
    ...(Array.isArray(p.changes) && p.changes.length ? { changes: p.changes } : {}),
    ...(p.changesLeft ? { changesLeft: p.changesLeft } : {}),
    ...(p.review ? { review: String(p.review), look: p.look || null } : {}),
  };
}

/**
 * The line a turn keeps while a coding agent's questions wait in the dock (HarnessV3-ACP AC2-4): what the first asks
 * of the developer, and how many more wait.
 * @param {any[]} asks  the run's `ask` events still waiting
 */
export function askWaitWords(asks) {
  const a = asks[0];
  const what = a?.kind === "permission" ? "Waiting for your permission" : a?.kind === "proposal" ? "A plan waits for your decision" : a?.kind === "link" ? "A link waits for you" : "Waiting for your answer";
  return `${what}${asks.length > 1 ? ` and ${asks.length - 1} more` : ""}, below`;
}

/**
 * A plan an agent proposes, its text as the page draws it (HarnessV3-ACP AC2-4): without its first heading where that
 * heading only says the plan's name, which the card already shows above it.
 * @param {{ name?: string, text?: string } | null | undefined} plan
 */
export function planBody(plan) {
  const text = String(plan?.text ?? "");
  const name = String(plan?.name ?? "").trim().toLowerCase();
  const first = /^\s*#{1,6}[ \t]+(.*?)[ \t#]*(?:\r?\n|$)/.exec(text);
  if (!name || !first || first[1].trim().toLowerCase() !== name) return text;
  return text.slice(first[0].length).replace(/^(?:[ \t]*\r?\n)+/, "");
}

/**
 * Whether the page says a turn's closing note itself, so the note's copy — the reply's last words, written for
 * clients that draw no card — is left out of the reply (HarnessV3-Launch LD-D7): a question or a permission while it
 * waits in the dock (HarnessV3-Views V3), and a stop the fold says ("Stopped after 9s"; a turn still
 * streaming its stop note ends stopped) unless the stop came with the developer's words, which nothing else on the page
 * says. Every other note — a deadline, the
 * output ceiling, the window, a question already answered — is the page's one drawing of it.
 * @param {{ note?: { kind?: string, text?: string, quoted?: boolean } | null, paused?: unknown, status?: string, stopped?: unknown } | null | undefined} turn
 */
export function noteSaidElsewhere(turn) {
  const note = turn?.note;
  if (!note?.text) return false;
  if (note.kind === "ask" || note.kind === "permission") return !!turn?.paused;
  if (note.kind === "stop") return !note.quoted && (turn?.status === "streaming" || foldSaysStopped(turn));
  return false;
}

/**
 * A reply's blocks with its closing note a text block of its own (LD-D7): an agent turn's note is one already, live;
 * the archive's final holds it after the reply's words in one text — that one is split into two fresh text blocks,
 * so the page can leave the note out without the words before it. Nothing else changes; the blocks come back as they
 * were when there is nothing to split.
 * @param {any[] | null | undefined} blocks @param {{ text?: string } | null | undefined} note
 * @returns {any[]}
 */
export function splitNote(blocks, note) {
  const words = String(note?.text || "");
  const list = blocks || [];
  let i = list.length - 1;
  while (i >= 0 && list[i]?.type !== "text") i--;
  if (!words || i < 0) return list;
  const text = String(list[i].text ?? "");
  if (text === words || !text.endsWith(words)) return list;
  const head = text.slice(0, text.length - words.length).replace(/\s+$/, "");
  return [...list.slice(0, i), ...(head ? [{ type: "text", text: head }] : []), { type: "text", text: words }, ...list.slice(i + 1)];
}

/**
 * Whether a live drawing starts over: its block handles were drawn into a view a render has since rebuilt (Load
 * earlier, a switch back), so their nodes feed nothing on the page. Keyed on the view itself, never on a node's place:
 * the layout leaves a block out on purpose — the closing note's copy while the page says it (LD-D7) — and a drawing
 * that took that for a rebuilt view drew every block again on each redraw, the note once more each time.
 * @param {{ blockHandles?: unknown[], handlesView?: unknown }} live @param {unknown} v  the turn's view now
 */
export const drawingStartsOver = (live, v) => !!live.blockHandles?.length && live.handlesView !== v;

/**
 * A turn's segments as the page lays them out (LD-D7): while the page says the closing note itself
 * (`noteSaidElsewhere`), the note's block — the reply's last text — is left out, so the words before it are the answer
 * under the fold. The turn keeps the segment: an answered question draws its copy again.
 * @template {{ kind: string, block?: { type?: string, text?: string } }} S
 * @param {{ segments?: S[], note?: { kind?: string, text?: string, quoted?: boolean } | null, paused?: unknown, status?: string, stopped?: unknown }} turn
 * @returns {S[]}
 */
export function segmentsShown(turn) {
  const segs = turn?.segments || [];
  if (!noteSaidElsewhere(turn)) return segs;
  const at = segs.findLastIndex((s) => s.kind === "block" && s.block?.type === "text");
  return at >= 0 && segs[at].block?.text === turn?.note?.text ? [...segs.slice(0, at), ...segs.slice(at + 1)] : segs;
}

/**
 * The time label under a finished reply: `HH:mm` today, `Yesterday HH:mm`, else the date.
 * @param {number | null | undefined} at  epoch ms
 * @param {Date} [now]
 */
export function messageTimeLabel(at, now = new Date()) {
  if (!at) return "";
  const then = new Date(at);
  if (!Number.isFinite(then.getTime())) return "";
  const hhmm = then.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = (/** @type {Date} */ d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(then)) / 86400000);
  if (days <= 0) return hhmm;
  if (days === 1) return `Yesterday ${hhmm}`;
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * What a fork's files are, on the fork card: the snapshot in force at the fork turn — its turn, round and time, its
 * name — and, where that turn or a later one wrote in the folder what no snapshot holds (its snapshot failed, or ran
 * past its time), that the files miss it: the files named, and what commands wrote. `missing` is empty where none did.
 * @param {{ ref: string, turn?: number | null, round?: number | null, at?: number | null, unheld?: { turn: number, files?: string[], command?: boolean }[] }} tree
 * @param {number} n  the fork turn @param {Date} [now]
 * @returns {{ held: string, missing: string }}
 */
export function forkTreeWords(tree, n, now = new Date()) {
  const when = [`turn ${tree.turn ?? n}`, ...(tree.round != null ? [`round ${tree.round}`] : []), ...(tree.at ? [messageTimeLabel(tree.at, now)] : [])].join(", ");
  const held = `Files as of ${when} (${String(tree.ref).replace(/^refs\/filament\/snapshots\//, "")})`;
  const notes = tree.unheld || [];
  if (!notes.length) return { held, missing: "" };
  const files = [...new Set(notes.flatMap((u) => u.files || []))];
  const turns = [...new Set(notes.map((u) => u.turn))].sort((a, b) => a - b);
  const named = files.length ? `${files.slice(0, 5).join(", ")}${files.length > 5 ? ` and ${files.length - 5} more` : ""}` : "";
  const ran = notes.some((u) => u.command) ? "what commands wrote" : "";
  const whose = turns.length === 1 ? `turn ${turns[0]}` : `turns ${turns.slice(0, -1).join(", ")} and ${turns.at(-1)}`;
  return { held, missing: `Not in them: what ${whose} wrote after — ${[named, ran].filter(Boolean).join(", and ")}; the folder's snapshot failed then` };
}

/** The selection limits: at most 8 quoted selections, 8,000 characters each. */
export const SELECTION_LIMITS = { max: 8, chars: 8000 };

/**
 * A name's possessive, as a sentence says it: "Methodical's", and an apostrophe alone after a name that ends in s —
 * "BugHunters'", "Builders'". The server's copy is core/text.js's, pinned equal by test/bughunters.test.js.
 * @param {string} name
 */
export const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/**
 * A past chat tagged in a message (the owner's word of 10-26, the Designer's): `[its title](chat:<id>)`, written where
 * it was typed. The model reads it as it is — its memory tool loads the chat by that id where the request needs it —
 * and the bubble draws it as the chat's chip; nothing is pasted in at Send. Its title's brackets are escaped. The
 * server's copy is services/agent-cards.js's `CHAT_LINK`, pinned equal by test/chat-tag.test.js.
 */
export const CHAT_LINK = /\[((?:\\.|[^\]\\\n]){1,200})\]\(chat:([A-Za-z0-9_-]{1,64})\)/g;
/**
 * A project file's path as a tag holds it bare: letters, digits and `_ . -` in parts between `/`, a letter in it, its
 * last part with a `.` inside it (`loop.js`, `.gitignore`) — or a folder's, ending with its `/`. So an npm scope
 * (`@types/node`), an agent's tag and a number are no file, and a `.` that ends a sentence is the sentence's.
 */
const FILE_PATH = String.raw`(?=[\w./-]*[A-Za-z])(?:[\w.-]+\/)*(?:[\w.-]*\.[\w-]+|(?<=\/))`;
/**
 * A project file tagged in a message with `@` (the owner's of 11-04: "press @ and tag the files from a project"): its
 * path bare (`FILE_PATH`) or, where it is not one, in quotes (`@"docs/My Notes.md"`, `fileTag`), its lines after it
 * (`#L10-40`), where the path ends — no part of a longer word (`@types/node` is no folder `types/`). It holds no
 * group of its own.
 */
const FILE_WORD = String.raw`@(?:"[^"\n]{1,300}"|${FILE_PATH})(?:#L\d+(?:-\d+)?)?(?![\w/-]|\.[\w-])`;
/**
 * A file's tag typed out whole, as the message box draws it as a chip (composer/rich-box.js): after a space, a `(` or
 * the text's start, and a space after it — a sentence's stop or comma between. It holds no group of its own.
 */
export const FILE_MENTION = new RegExp(String.raw`(?<=^|[\s(])${FILE_WORD}(?=[.,;:!?)]*\s)`, "g");
/** A path as a tag can hold it bare. */
const BARE_PATH = new RegExp(String.raw`^${FILE_PATH}$`);
/** Code in a text: a fenced block, to its end where it is not closed, and inline code. */
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
/**
 * Whether a place in a text is in code, as the message box and the bubble read it: a file's tag there — a decorator
 * (`@pytest.fixture`) in pasted code — stays its words. @param {string} text @returns {(at: number) => boolean}
 */
export const inCode = (text) => {
  const spans = [...text.matchAll(CODE)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return (at) => spans.some(([a, b]) => at >= a && at < b);
};
/**
 * The tag of a project file or folder, as the `@` list writes it: `@src/app/loop.js`, or in quotes where the path is no
 * bare one (`@"docs/My Notes.md"`, `@"Makefile"`) — so it reads back whole, as the chip and the bubble read it. A path
 * that holds a quote or a line's end, which no tag holds, goes bare: its words, never a chip.
 * @param {string} path
 */
export const fileTag = (path) => (BARE_PATH.test(path) || /["\n]/.test(path) ? `@${path}` : `@"${path}"`);
/**
 * What a file's tag names: its path, unquoted, and its lines (`#L10-40`, "" for none). @param {string} tag  with its `@`
 * @returns {{ path: string, range: string }}
 */
export const fileOfTag = (tag) => {
  const range = /#L\d+(?:-\d+)?$/.exec(tag)?.[0] || "";
  const word = tag.slice(1, tag.length - range.length);
  return { path: word.startsWith('"') && word.endsWith('"') && word.length > 1 ? word.slice(1, -1) : word, range };
};

/**
 * A chat's tag, as the `@` and `#` panels write it: its title — or its first words, or its id — on one line, cut near
 * 60 characters, its brackets escaped.
 * @param {string} title @param {string} id
 */
export function chatTag(title, id) {
  const words = String(title || "").replace(/\s+/g, " ").trim() || String(id);
  const cut = words.length > 60 ? `${words.slice(0, 59).trimEnd()}…` : words;
  return `[${cut.replace(/[\\[\]]/g, (c) => `\\${c}`)}](chat:${id})`;
}

/** The skills' names the page has read (the `$` list's reads, `noteSkillNames`): what a sent `$<name>` chips by. */
const skillNames = new Set();
let skillsRead = false;
/** The page read the skills: their names, as each is called — yours, and the plugins' `<plugin>:<name>`. @param {Iterable<string>} names */
export function noteSkillNames(names) {
  for (const n of names) if (n) skillNames.add(String(n));
  skillsRead = true;
}

/**
 * Whether a `$<word>` of a sent message names a skill, as the server calls one — by its name as written (the Hunter's of
 * 10-28: a name may hold capitals, a leading digit or a dot). Once the page has read the skills, a name it knows; before
 * that, a word in lower case: `$HOME`, `$Path` and `$5` are a variable and a price. @param {string} word
 */
const namesSkill = (word) => (skillsRead ? skillNames.has(word) : /^[a-z][a-z0-9._:-]*$/.test(word));

/**
 * `@file` / `/command` / `#session` / `$skill` references inside plain text, and the chats it tags (`CHAT_LINK`),
 * for the user bubble's chips. A project file's tag (`FILE_WORD`) is read first: its path (`file`, a folder's ending
 * with `/`) and its lines (`@src/a.js#L10-40`, `range`), unquoted. A chat's title holds no reference of its own. A
 * skill's `$<name>` is a skill's name (`namesSkill`), a `.` or `:` after it the sentence's.
 * @param {string} text
 * @returns {Array<{ kind: "text", text: string } | { kind: "ref", mark: string, name: string, file?: string, range?: string } | { kind: "chat", title: string, id: string }>}
 */
export function referenceChips(text) {
  const s = String(text || "");
  /** @type {{ at: number, end: number, part: { kind: "ref", mark: string, name: string, file?: string, range?: string } | { kind: "chat", title: string, id: string } }[]} */
  const found = [...s.matchAll(CHAT_LINK)].map((m) => {
    const at = m.index ?? 0;
    return { at, end: at + m[0].length, part: { kind: /** @type {const} */ ("chat"), title: m[1].replace(/\\(.)/g, "$1"), id: m[2] } };
  });
  const inChat = (/** @type {number} */ at) => found.some((c) => at >= c.at && at < c.end);
  const code = inCode(s);
  const re = new RegExp(String.raw`(?:^|[\s(])(${FILE_WORD})|(?:^|[\s(])([@/#])([A-Za-z0-9_./\\:-]{1,80})|(?:^|[\s(])(\$)([A-Za-z0-9][A-Za-z0-9._:-]{0,79})(?![A-Za-z0-9_])`, "g");
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) {
      const at = m.index + m[0].length - m[1].length;
      const { path, range } = fileOfTag(m[1]);
      // A file's tag in code is its words, as the message box leaves it.
      if (!inChat(at) && !code(at)) found.push({ at, end: at + m[1].length, part: { kind: "ref", mark: "@", name: `${path}${range}`, file: path, ...(range ? { range } : {}) } });
      continue;
    }
    const mark = m[2] || m[4];
    const typed = m[3] || m[5];
    const at = m.index + m[0].length - mark.length - typed.length;
    const name = mark === "$" ? typed.replace(/[.:]+$/, "") : typed;
    if (mark === "$" && !namesSkill(name)) continue;
    if (!inChat(at)) found.push({ at, end: at + mark.length + name.length, part: { kind: "ref", mark, name } });
  }
  found.sort((a, b) => a.at - b.at);
  /** @type {ReturnType<typeof referenceChips>} */
  const out = [];
  let cursor = 0;
  for (const f of found) {
    if (f.at > cursor) out.push({ kind: "text", text: s.slice(cursor, f.at) });
    out.push(f.part);
    cursor = f.end;
  }
  if (cursor < s.length) out.push({ kind: "text", text: s.slice(cursor) });
  return out;
}

/**
 * The source in the page's words (D6): a layer name, or `preset` — a card kept from before presets went names the
 * one a value came from (`preset max`), "the applied preset" otherwise. The layer words are pinned equal to the server's
 * `sourceWord` by a test.
 * @param {string | null | undefined} source @param {string | null | undefined} [preset]
 */
export function sourceWords(source, preset) {
  return source === "session" ? "this session"
    : source === "project" ? "this project"
      : source === "global" ? "your global settings"
        : source === "preset" ? (preset ? `preset ${presetWords(preset)}` : "the applied preset")
          : source === "default" ? "the built-in default"
            : "another layer";
}

const PERMISSION_WORDS = { "read-only": "Read-only", edit: "Edit automatically", ask: "Ask before changes", auto: "Full access" };
const EFFORT_WORDS = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };

/**
 * `/compaction` typed in the chat's own box (the owner's words of 10-18: "make a command to summon the compaction card
 * if i need to so that i don't have to wait for it to show up itself"): the message that follows the word, for the
 * card to send once room is made — "" where none does — or null where the text is no `/compaction`. `/compact` is the
 * agent's own, and compacts at once.
 * @param {string} text
 */
export function compactionCardOf(text) {
  const m = /^\/compaction(?:\s+([\s\S]*))?$/i.exec(String(text || "").trim());
  return m ? String(m[1] || "").trim() : null;
}

/**
 * `/steer-fork <message>` (the owner's of 11-05): the message, weighed aside by a fork of the running turn before it
 * reaches the agent, as the ⌄ menu's Weigh aside first sends it — "" for the word alone, null where the text is no
 * `/steer-fork`.
 * @param {string} text
 */
export function steerForkOf(text) {
  const m = /^\/steer-fork(?:\s+([\s\S]*))?$/i.exec(String(text || "").trim());
  return m ? String(m[1] || "").trim() : null;
}
/** `/steer-fork` with nothing after it: what to type. */
export const STEER_FORK_USAGE = "/steer-fork needs your message after it: /steer-fork <message>. A fork of your agent's running turn weighs it first, while the agent works on";
/** Why a message to weigh aside is refused: no turn of Filament's own agent runs to fork. @param {"idle" | "paused" | "agent"} why */
export const steerForkRefusal = (why) =>
  why === "agent" ? "A coding agent's turn weighs no message aside: send it as it is, and it reaches the agent as its run takes words"
  : why === "paused" ? "Your agent's turn waits for your answer: answer it first"
  : "No turn of your agent runs for a fork to weigh this beside: send it as a message, or ask on the side with /btw";

/**
 * A compaction in words, by how it made room — the timeline's boundary row and Compact now's toast: a summary (and
 * /autofit's, a brief's) wrote one summary, a trim did too and kept the newest turns whole, a fold folded the turns,
 * and a coding agent compacted its own session (own, HarnessV3-ACP AC5-5).
 * Each says the method as its name does (U3, UX-4). An agent's own says whose it was and what Filament's copy of the
 * chat does with it (HarnessV4_Tasks C28): it starts from the agent's summary where the agent handed one over — one
 * made in the middle of a turn (`detail.during`) names that turn — and keeps the turns where it handed none, until
 * Filament summarizes them. A summary Filament wrote for its copy alone (`detail.copy`, C29) says why, and that the
 * agent's own session went on. `here`: said on the turn it fell in, where it happened (the owner's words of 10-18:
 * "it should sit where it happened") — "here", not "during turn N".
 * @param {{ fromTurn?: number | null, toTurn?: number | null, method?: string | null, chars?: number | null, detail?: { by?: string, during?: number, copy?: string, leftFrom?: number } | null }} b
 * @param {{ here?: boolean }} [o]
 */
export function compactionWords(b, { here = false } = {}) {
  const one = !!b.fromTurn && b.fromTurn === b.toTurn;
  const span = b.fromTurn && b.toTurn ? (one ? `turn ${b.toTurn}` : `turns ${b.fromTurn}–${b.toTurn}`) : "the earlier turns";
  if (b.method === "own") {
    const who = b.detail?.by || "the agent";
    if (Number(b.detail?.during) > 0) return `${who} compacted its own context ${here ? "here" : `during turn ${b.detail?.during}`}: Filament's copy starts from its summary`;
    return `${span} compacted by ${who}, in its own session: ${Number(b.chars) > 0 ? "Filament's copy starts from its summary" : "it handed no summary over, so Filament's copy keeps the turns until Filament summarizes them"}`;
  }
  if (b.detail?.copy) {
    const who = b.detail.by || "the agent";
    const why = b.detail.copy === "line" ? "the copy passed the session's line" : `${who} compacted its own context and handed no summary over`;
    return `${span} compacted into one summary for Filament's copy alone (${why}): ${who}'s own session goes on as it is`;
  }
  if (b.method === "fold") return `${span} folded`;
  return `${span} compacted into one summary`;
}

/**
 * What Undo does to a compaction, as its button says it (HarnessV4_Tasks U3.6): a coding agent's own compaction that
 * was forked first brings its session from before back; one made in its live session starts a fresh session from
 * Filament's copy; any other gives the turns back as they were.
 * @param {{ method?: string, detail?: { forked?: boolean } | null }} b
 */
export function undoWords(b) {
  if (b.method !== "own") return "Take this compaction back: the next request sees those turns as it did before";
  return b.detail?.forked
    ? "Take this compaction back: the agent's session from before it comes back (it was forked first)"
    : "Take this compaction back: the agent starts a fresh session from Filament's copy of the chat (its own session was not forked first)";
}

/**
 * The earlier turns gave way in the middle of a running turn (HarnessV4_Tasks C33), in words: which turns, how — the
 * session's own method — and the figures; or that they could not, and why. A sub-agent's (`exchanges`) are its
 * earlier exchanges, which gave way to the summary its own model wrote, the exchange it is on kept whole — or, on a
 * coding agent with no compaction of its own (`fresh`), before its message went, a fresh session of it going on from
 * that summary: what its context held, and the summary's size (`summary`, in tokens).
 * @param {{ fromTurn?: number, toTurn?: number, method?: string, tokensBefore?: number, tokensAfter?: number, result?: string, error?: string, exchanges?: boolean, fresh?: boolean, summary?: number }} e
 */
export function earlierCompactionWords(e) {
  const why = e.error ? ` (${e.error})` : "";
  const from = Number(e.fromTurn) || 0;
  const to = Number(e.toTurn) || 0;
  const figures = Number(e.tokensBefore) > 0 && Number(e.tokensAfter) > 0 ? ` · ${fmt.k(Number(e.tokensBefore))} → ${fmt.k(Number(e.tokensAfter))}` : "";
  if (e.exchanges) {
    if (e.result && e.fresh) return `Its earlier exchanges could not give way${why}: it goes on in its session as it stands`;
    if (e.result) return `Its earlier exchanges could not give way${why}: this exchange's own steps are summarized instead, where they can be`;
    const span = from && to ? (from === to ? "its earlier exchange" : `its ${to - from + 1} earlier exchanges`) : "its earlier exchanges";
    if (e.fresh) {
      const size = Number(e.summary) > 0 ? ` · ${Number(e.tokensBefore) > 0 ? `${fmt.k(Number(e.tokensBefore))} → ` : ""}a ${fmt.k(Number(e.summary))}-token summary` : "";
      return `Room made in its conversation: ${span} summarized by itself, a fresh session going on from the summary${size}`;
    }
    return `Room made in its conversation: ${span} summarized by itself, this exchange's own steps kept whole${figures}`;
  }
  if (e.result) return `The earlier turns could not give way${why}: this turn's own steps are summarized instead, where they can be`;
  const span = from && to ? (from === to ? `turn ${to}` : `turns ${from}–${to}`) : "the earlier turns";
  const how = e.method === "fold" ? "folded" : "summarized";
  return `Room made in the whole chat: ${span} ${how}, this turn's own steps kept whole${figures}`;
}

/**
 * A compaction inside a running turn, in words (the transcript's row for a run's `compaction` event): the rounds
 * summarized into one, on whose word, and the figures; a Compact that found too little to summarize, a summarizer
 * that came back empty, the line standing down, a size refusal answered by clearing older results — each said as
 * what it was.
 * A coding agent's own compaction (`own`) says who, its figures and its time as the agent gave them, or why it failed.
 * @param {{ fromRound?: number, toRound?: number, tokensBefore?: number, tokensAfter?: number, manual?: boolean, result?: string, stoodDown?: boolean, why?: string, cleared?: number, folded?: any, attached?: { shown?: number, named?: number, plan?: boolean, graph?: boolean } | null, own?: boolean, by?: string, ms?: number, error?: string }} e
 * @returns {string}
 */
export function roundCompactionWords(/** @type {any} */ e) {
  if (e.own) {
    const who = e.by || "The agent";
    if (e.result === "failed") return `⌁ ${who} could not compact its context${e.error ? `: ${e.error}` : ""}`;
    const before = Number(e.tokensBefore) || 0;
    const after = Number(e.tokensAfter) || 0;
    const figures = before > 0 && after > 0 ? ` · ${fmt.k(before)} → ${fmt.k(after)}` : before > 0 ? ` · at ${fmt.k(before)}` : "";
    return `⌁ ${who} compacted its own context here${e.manual ? " on your request" : ""}: what came before is a summary in its session now${figures}${Number(e.ms) > 0 ? ` · ${tookWords(Number(e.ms))}` : ""}`;
  }
  if (e.earlier) return `⌁ ${earlierCompactionWords(e)}`;
  if (e.stoodDown) return "⌁ Folding this turn's steps left the chat past its line: the earlier turns hold the rest. Compacting stands down for the rest of this turn — your next message makes room in the whole chat";
  // The loop's own compaction writes one summary of the older rounds: said as a summary, never a fold (U3, UX-4).
  if (e.why === "overflow-refusal") return `⌁ The provider refused the request's size — ${Number(e.cleared) || 0} older result${Number(e.cleared) === 1 ? "" : "s"} cleared${e.folded ? " and older rounds summarized into one" : ""} before the retry`;
  if (e.manual && e.result === "little") return "⌁ Compact asked — this turn has too little finished work to summarize yet; nothing was summarized";
  if (e.manual && e.result === "empty") return "⌁ Compact asked — the summarizer came back empty, so nothing was summarized";
  const from = Number(e.fromRound) || 0;
  const to = Number(e.toRound) || 0;
  const span = from && to ? (from === to ? `round ${to}` : `rounds ${from}–${to}`) : "the older rounds";
  const figures = Number(e.tokensBefore) > 0 && Number(e.tokensAfter) > 0 ? ` · ${fmt.k(Number(e.tokensBefore))} → ${fmt.k(Number(e.tokensAfter))}` : "";
  const back = backWords(e.attached);
  return `⌁ ${e.manual ? "Compacted on your request" : "Compacted at the line"}: ${span} summarized into one, the newest kept whole${figures}${back ? ` · ${back}` : ""}`;
}

/**
 * A fold under way inside a running turn, in words (the transcript's live row for a run's `compacting` event): the
 * loop folding its older rounds, or a coding agent compacting its own context — with how much of its summary it has
 * written so far, in tokens, where it streams it (`chars`, HarnessV4_Tasks U3-5; an estimate, said as one).
 * `earlier`: the session's earlier turns give way instead (HarnessV4_Tasks C33) — a sub-agent's earlier exchanges
 * (`exchanges`), to a summary its own model writes, which a fresh session of it goes on from (`fresh`).
 * @param {{ own?: boolean, by?: string, chars?: number, earlier?: boolean, exchanges?: boolean, fresh?: boolean }} e
 */
export function roundCompactingWords(e) {
  if (e.earlier && e.exchanges && e.fresh) return "⌁ Making room in its conversation: it summarizes its earlier exchanges itself, for a fresh session to go on from…";
  if (e.earlier && e.exchanges) return "⌁ Making room in its conversation: its earlier exchanges give way first, summarized by itself; this exchange's own steps stay whole…";
  if (e.earlier) return "⌁ Making room in the whole chat: the earlier turns give way first, this turn's own steps stay whole…";
  if (!e.own) return "⌁ Compacting: the older rounds are being summarized into one…";
  return `⌁ ${e.by || "The agent"} is compacting its own context…${Number(e.chars) > 0 ? ` ≈${fmt.n(fmt.tokens(e.chars))} tokens of its summary written` : ""}`;
}

/** How long a compaction took: seconds under a minute ("8.4 s"), minutes and seconds from one ("1m 12s"). @param {number} ms */
function tookWords(ms) {
  return ms >= 60_000 ? formatWorkedFor(ms) : fmt.ms(ms);
}

/**
 * What came back after a summary (HarnessV3-AtHome AH-D9 b), in a few words: the files shown, the plan and the task
 * graph — a file only named was not brought back. "" when nothing was.
 * @param {{ shown?: number, plan?: boolean, graph?: boolean } | null | undefined} a
 */
function backWords(a) {
  const n = Number(a?.shown) || 0;
  const what = [...(n ? [`${n} file${n === 1 ? "" : "s"}`] : []), ...(a?.plan ? ["the plan"] : []), ...(a?.graph ? ["the task graph"] : [])];
  return what.length ? `${what.length > 2 ? `${what.slice(0, -1).join(", ")} and ${what[what.length - 1]}` : what.join(" and ")} brought back` : "";
}

/**
 * What a compaction cost, as its row says it (HarnessV4_Tasks U3-11): its calls' records summed by the server once
 * they finished (`detail.cost`) — "cost $0.0421" paid at list price, "on your plan ($0.2900 at list price)" where a
 * plan paid $0, "cost $0.0500 ($0.2900 at list price)" where the provider charged its own figure, "$0.0500 at list
 * price" where what was paid is unknown (an agent's estimated tokens). "" where no call was priced, and for a
 * compaction that called no model.
 * @param {{ paid?: number | null, list?: number | null } | null | undefined} cost
 */
export function compactionCostWords(cost) {
  const paid = typeof cost?.paid === "number" ? cost.paid : null;
  const list = typeof cost?.list === "number" ? cost.list : null;
  if (paid == null && list == null) return "";
  if (paid == null) return `${fmt.usd(list)} at list price`;
  // A plan: nothing was paid for tokens that have a price, or that nobody prices here.
  if (paid === 0 && (list == null || list > 0)) return `on your plan${list != null ? ` (${fmt.usd(list)} at list price)` : ""}`;
  return `cost ${fmt.usd(paid)}${listDiffers(paid, list) ? ` (${fmt.usd(list)} at list price)` : ""}`;
}

/**
 * What a compaction did, in figures after its words — " · 131k → ≈68k · grok-4.6 · 2 files brought back" — from its
 * row's detail: the request before and after (≈ when the after is an estimate, a summary weighed before it was
 * written), who wrote the summary — from its cache, in slices, or a coding agent writing its own (HarnessV3-ACP
 * AC5-4) — what it cost, once its calls' records said (`compactionCostWords`, U3-11), and what came back after it.
 * Each says how long it took, where its row kept it (HarnessV4_Tasks U3-5, UX-8); a coding agent's own compaction
 * (AC5-5) also the context it held before where it named no after. Empty for a row whose writer kept no figures (a
 * client's own summary, an imported one).
 * @param {{ detail?: { before?: number, after?: number, exact?: boolean, model?: string | null, how?: string, calls?: number, ms?: number,
 *   cost?: { paid?: number | null, list?: number | null } | null, attached?: { shown?: number, named?: number, plan?: boolean, graph?: boolean } | null } | null }} b
 */
export function compactionFacts(b) {
  const d = b?.detail || null;
  if (!d) return "";
  const parts = [];
  if (Number(d.before) > 0 && Number(d.after) > 0) parts.push(`${fmt.k(d.before)} → ${d.exact === false ? "≈" : ""}${fmt.k(d.after)}`);
  else if (d.how === "agent-own" && Number(d.before) > 0) parts.push(`at ${fmt.k(d.before)}`);
  if (Number(d.ms) > 0) parts.push(tookWords(Number(d.ms)));
  if (d.model) parts.push(`${String(d.model).replace(/^agent\//, "")}${d.how === "fork" ? ", from its cache" : d.how === "slices" ? `, in ${d.calls || "several"} slices` : d.how === "agent" || d.how === "agent-fork" ? ", the agent itself" : ""}`);
  const cost = compactionCostWords(d.cost);
  if (cost) parts.push(cost);
  const back = backWords(d.attached);
  if (back) parts.push(back);
  return parts.map((p) => ` · ${p}`).join("");
}

/**
 * What Send without it does, by the wait it lets go — the button's tooltip (HarnessV4_Tasks U1): the summary Filament
 * writes is folded instead; memory's recall is gone without; a worktree's copy carries
 * on beside the turn (HarnessV4_Four_Plan FO-D36). The button said the summary's words over a memory wait too.
 * @param {{ kind?: string } | null | undefined | false} phase
 */
export function skipWaitWords(phase) {
  if (phase && phase.kind === "recalling") return "Send your message now, without what memory would recall for it";
  if (phase && phase.kind === "copying") return "Send your message now: the copy into the worktree carries on beside the turn";
  return "Stop writing the summary and send your message now: the older turns are folded instead, which needs no model";
}

/**
 * Why Filament starts no turn by itself in a chat, as a cut turn's mark keeps it (sessions/service.js `ARCHIVED_CHAT`,
 * `ARCHIVED_PROJECT`: the rule's own words, the log's, which name the person in the third person), each as its person
 * reads it (r-itself, 11-12: the line said "the person archived it" to the person). Any other reason is said as kept.
 */
const HELD_YOURS = new Map([
  ["the person archived it", "you archived this chat"],
  ["its project is archived", "this chat's project is archived"],
]);

/**
 * What an open turn of the history says where its reply would stand (HarnessV4_Tasks U1). One a restart cut off says
 * so, and what the next start kept of it from its run's log (`cut`: its rounds and calls, HarnessV4_Tasks A2) — the
 * cards above the line are that work, and the agent has it with the next message. A reply joins the log once it is
 * whole: a turn cut while its first one arrived shows a round and has nothing rebuilt (`logged`), and the line says
 * nothing is kept. One Filament cannot account for keeps its plain words.
 * What became of it, where Filament's start chose (`cut.resume`, HarnessV3-TaskGraph-v2 TG2-D83): it went on with it in
 * the next turn, or did not, and why — the chat archived, or its project, said to the person as theirs (`HELD_YOURS`).
 * @param {{ cutOff?: boolean, cut?: { rounds?: number, tools?: number, logged?: number, resume?: "going" | { held?: string, refused?: string } } | null }} turn
 */
export function openTurnWords(turn) {
  if (!turn.cutOff) return "no reply was recorded for this turn";
  const head = "cut off before its reply — Filament stopped while it ran";
  if (!turn.cut) return head;
  const r = turn.cut.resume;
  const went = r === "going" ? ", and Filament went on with it below" : "";
  const said = r && typeof r === "object" ? String(r.refused || r.held || "") : "";
  const why = HELD_YOURS.get(said) || said;
  const not = why ? `. Filament did not go on by itself: ${why}. Send a message to go on` : "";
  const rounds = Number(turn.cut.rounds) || 0, tools = Number(turn.cut.tools) || 0;
  if (!rounds && !tools) return `${head}. Its run's log shows no work before that${went || not}`;
  if (!(Number(turn.cut.logged) > 0)) return `${head}. Nothing of it is kept: it was cut before a reply was whole, and a reply joins its run's log only then${went || not}`;
  const kept = [rounds ? `${rounds} round${rounds === 1 ? "" : "s"}` : "", tools ? `${tools} tool call${tools === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
  return `${head}. What it had done is kept from its run's log (${kept})${went || `: the agent has it with your next message${not}`}`;
}

/** The turn Filament sent to go on with one a restart cut off (TG2-D83), in its message's place. */
export const RESUMED_WORDS = "Filament went on by itself — a restart cut off the turn above";
/** The capsule of the turn Filament sends as a driving goal's next round (core/goal-drive.js). @param {number} round @param {number} cap */
export const goalRoundWords = (round, cap) => `Filament went on by itself — the goal's round ${round} of ${cap}`;
/** The capsule of the turn Filament sends as a background command ends (E21, FO-D14, FO-D49). */
export const WOKE_WORDS = "Filament went on by itself — a background command ended";
/**
 * The capsule's words by what came, read from the lines the agent was told (hands.js): a command's end, the lines a
 * watch caught, the time the agent set to come back (the owner's word of 10-27), Filament's check-in on a command that
 * ran on while the agent sat idle (sessions/idle-wake.js, the owner's of 11-08), sub-agents' reports (`reports`, how
 * many rode ahead of Filament's line), a letter from another chat (`letter`, the owner's of 11-04), or several. Word
 * of the person's Cancel of a come-back may ride along, and is not what came (the Designer's of 10-27). Where nothing
 * says what came — a turn that runs still, whose lines come at its end —, no command's end is said.
 * @param {readonly string[]} told @param {number} [reports] @param {boolean} [letter]
 */
export const wokeWords = (told, reports = 0, letter = false) => {
  /** @type {Set<"exit" | "lines" | "time" | "idle" | "reports" | "letter">} */
  const kinds = new Set(
    told
      .filter((x) => !/^\[Filament: the person cancelled the come-back /.test(x))
      .map((x) => (/ exited with code /.test(x) ? "exit" : /you watch for|stopped watching/.test(x) ? "lines" : /the time you set/.test(x) ? "time" : IDLE_TOLD.test(x) ? "idle" : "exit")),
  );
  if (reports > 0) kinds.add("reports");
  if (letter) kinds.add("letter");
  if (kinds.size !== 1) return "Filament went on by itself — what the agent waited on came";
  if (kinds.has("letter")) return "Filament went on by itself — a letter from another chat came";
  if (kinds.has("reports")) return `Filament went on by itself — ${reports === 1 ? "a sub-agent's report came" : `${reports} reports from sub-agents came`}`;
  if (kinds.has("idle")) return IDLE_WOKE_WORDS;
  return kinds.has("lines") ? "Filament went on by itself — a command it watches printed what it watches for" : kinds.has("time") ? "Filament went on by itself — the time the agent set came" : WOKE_WORDS;
};
/** The capsule of the turn Filament sends to check in on an agent idle while its command runs (sessions/idle-wake.js). */
export const IDLE_WOKE_WORDS = "Filament went on by itself — a command ran on while the agent sat idle";
/**
 * Filament's check-in as the agent reads it (sessions/idle-wake.js `idleText`): how long it sat idle, the commands that
 * still run, and when the next check-in comes — and, in a chat's record from before version 123, that nothing else came.
 */
export const IDLE_TOLD = /^\[Filament: (\d+) min since your turn ended, your (?:\d+ )?background commands? still runs? with no end: ([\s\S]*?)\.(?: Nothing else came meanwhile\.)? If it keeps running, Filament checks in again in (\d+) min\.\]$/;
/** The capsule of a sync's message from the project's Space, which the person ran (proposal_ux §4.14). */
export const SYNCED_WORDS = "A sync from the project's Space — you ran it there";
/** What begins a turn with a team beside's result (team_v2_plan §5.4), in the message's place. */
export const TEAM_RESULT_WORDS = "A team beside this chat finished — its result went to the agent";
/** What begins a watcher's turn in the chat that proposed it (app/routines.js `wakeChat`), in the message's place. */
export const WATCHED_WORDS = "A watcher woke this chat — Filament sent what it heard";
/** What begins a turn with a watcher's guidance to this chat (app/watchers/guidance.js), in the message's place. */
export const GUIDED_WORDS = "A watcher that reviews this chat sent guidance — Filament passed it on";
/** What a guidance card says after its watcher's title: whose watcher it is, and how its words weigh. */
export const GUIDE_SUB_WORDS = "a watcher you switched on · advice: your word comes first";
/**
 * Where a watcher's guidance note stands in a running turn, at its card's right: a word or two, with the note's own
 * line of it (`steerWords`) on hover. @param {{ tone: string, state: string }} w  the note's words
 * @returns {{ text: string, tip: string }}
 */
export const guideNoteWords = (w) => ({ text: w.tone === "read" ? "read" : w.tone === "pending" ? "waits to be read" : w.tone === "unread" ? "not read" : "not delivered", tip: w.state });
/**
 * A turn's Reviewed chip, from the reviews Filament says of it (core/watchers.js `reviewsByTurn`): how many watchers
 * read it where several did, and that one of them wrote the chat guidance; on hover, each review's own sentence.
 * @param {readonly { guided: boolean, words: string }[]} reviews
 * @returns {{ text: string, tip: string, guided: boolean }}
 */
export function reviewedWords(reviews) {
  const guided = reviews.some((v) => v.guided);
  return { text: `Reviewed${reviews.length > 1 ? ` ×${reviews.length}` : ""}${guided ? " · guided" : ""}`, tip: reviews.map((v) => v.words).join("\n"), guided };
}
/** A thread's first message (core/threads.js): its starter's agent's brief, before the chat it came from. */
export const BRIEF_WORDS = "Brief from";
/** What the brief's card says on its hover. */
export const BRIEF_TIP = "Another chat's agent started this chat as its thread and wrote this brief for it: its words, not yours. The two chats write each other letters, and you can write here too: your word comes first.";
/** A flow's end, where it reached the agent (HarnessV4_Flow_Plan FL-D11). */
export const FLOW_END_WORDS = "A flow beside this chat finished — its end went to the agent";
/** What began the turn a flow started In place opened to drive it (HarnessV4_OneAgent_Plan OA4). */
export const FLOW_DRIVE_WORDS = "You started a flow in place — the agent drives it in this turn";
/** What begins a team box's turn the person's Go on or Retry on its flow's card sent (HarnessV4_Flow_Plan F5). */
export const FLOW_ON_WORDS = "Your flow asked it to go on — you pressed Go on";
/** What begins a team box's turn its flow sent back from the gate (HarnessV4_Flow_Plan F5). */
export const FLOW_BACK_WORDS = "Your flow sent its part back from the gate";

/**
 * A turn's files written outside any repository, in its files card (HarnessV4_Four_Plan FO-D27): the card's head where
 * the turn wrote nowhere else ("2 files written outside git"), else a line at its foot ("1 more written outside git").
 * @param {number} n @param {boolean} alone
 */
export const outsideGitWords = (n, alone) => (alone ? `${n} file${n === 1 ? "" : "s"} written outside git` : `${n} more written outside git`);

/**
 * What a turn does before its request reaches the model, beside the live fold's timer (HarnessV3-CodebasePass
 * decision 1): a compaction at the line runs first, and a summary can take minutes; memory recalls; a coding agent
 * starts, opens its session, switches its mode (HarnessV3-FailurePoints §5.1 item 2); a new worktree's template is
 * copied in (HarnessV4_Four_Plan FO-D36). Empty when there is no phase.
 * @param {{ kind?: string, method?: string | null, step?: string, agent?: string, to?: string,
 *   copy?: { done: number, total: number, entry?: string } | null } | null | undefined} phase
 */
export function turnPhaseWords(phase) {
  if (phase?.kind === "agent") {
    const who = phase.agent || "the agent";
    const to = phase.to || "";
    switch (phase.step) {
      case "starting": return `starting ${who}`;
      case "resuming": return `resuming ${who}'s session`;
      case "opening": return `opening ${who}'s session`;
      case "commands": return `waiting for ${who} to say its commands`;
      case "mode": return `switching ${who} to ${to ? `${to} mode` : "another mode"}`;
      case "model": return `switching ${who} to ${to || "another model"}`;
      case "effort": return `setting ${who}'s effort${to ? ` to ${to}` : ""}`;
    }
    return "";
  }
  if (phase?.kind === "recalling") return "recalling memory first — your message goes to the model once it's done";
  if (phase?.kind === "copying") {
    // The worktree template's copy (HarnessV4_Four_Plan FO-D36): the entry it is on, and how far it got.
    const c = phase.copy;
    const at = c && c.total ? ` — ${c.entry ? `${c.entry}, ` : ""}${sizeWords(c.done)} of ${sizeWords(c.total)}` : "";
    return `copying into the worktree first${at}; your message goes to the model once it's done`;
  }
  if (phase?.kind !== "compacting") return "";
  if (phase.method === "own") return "compacting first — the agent is compacting its own context; your message goes to it once that's done";
  const how = phase.method === "fold" ? "folding the older turns" : "summarizing the history";
  return `compacting first — ${how}; the model is asked once it's done`;
}

/**
 * What the session's compaction method does, in the widgets' words: at the line (the Compaction header) and on
 * request (Compact now's tooltip). Any method but the instant fold is one summary.
 * @param {string | null | undefined} method
 * @returns {{ line: string, now: string }}
 */
export function compactionMethodWords(method) {
  if (method === "fold") return { line: "Folds the older turns at the line", now: "Fold the older turns — local, no model call; the next request carries the folds" };
  return { line: "Summarizes the history at the line", now: "Summarize every finished turn into one — the next request starts from the summary" };
}

/**
 * What a sub-agent was handed of the session, as a fact beside its model (the transcript's dispatch row, the viewer's
 * title): the view by its name (U3, UX-4) — "sees Folded" — or "a live copy of the main agent"; "" for the task alone.
 * @param {unknown} view
 */
export function subagentViewFact(view) {
  const id = String(view ?? "");
  if (id === "fork") return "a live copy of the main agent";
  return id !== "none" && SUBAGENT_VIEW_WORDS.some((v) => v.id === id) ? `sees ${nameIn(SUBAGENT_VIEW_WORDS, id)}` : "";
}

/** How many a list holds, in words: "none", "1 folder", "3 folders". @param {unknown} list @param {string} one */
const countWords = (list, one) => {
  const n = Array.isArray(list) ? list.length : 0;
  return n === 0 ? "none" : `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;
};

/**
 * One settings change in plain words — the timeline's boundary row and the change card say what moved without a
 * dotted path or a JSON dump: "Effort: Max", "Memory off". A knob with no words of its own reads as its short name and
 * value. `to` undefined means the knob inherits again; `from` (when the change carries it) lets a list say what it
 * gained or lost — the connectors, the language servers.
 * @param {string} path @param {any} [to] @param {any} [from]
 */
export function settingChangeWords(path, to, from) {
  const reset = to === undefined || to === null;
  const short = (/** @type {any} */ v) => (typeof v === "string" ? v : typeof v === "boolean" ? (v ? "on" : "off") : typeof v === "number" ? v.toLocaleString() : JSON.stringify(v));
  switch (path) {
    case "model.name": return reset ? "Model: the default" : `Model: ${String(to).replace(/^agent\//, "")}`;
    case "model.effort": return reset ? "Effort: the model's default" : `Effort: ${EFFORT_WORDS[/** @type {keyof typeof EFFORT_WORDS} */ (String(to))] || to}`;
    case "model.fast": return reset ? "Speed: the default" : to ? "Fast mode on" : "Fast mode off";
    // How long the provider keeps the chat's prompt cache, as the Cache widget says it (the owner's of 10-29).
    case "model.cacheTtl": return reset ? "Cache lifetime: the route's" : `Cache lifetime: ${to === "1h" ? "1 hour" : "5 min"}`;
    case "model.window": return reset ? "Context window: the model's standard" : `Context window: ${Number(to) >= 1e6 ? `${Math.round(Number(to) / 1e5) / 10}M` : `${Math.round(Number(to) / 1000)}K`}`;
    case "loop.permissions": return reset ? "Permissions: the default" : `Permissions: ${PERMISSION_WORDS[/** @type {keyof typeof PERMISSION_WORDS} */ (String(to))] || to}`;
    case "context.compaction.thresholdPercent": return reset ? "Compaction line: the default" : `Compaction line: ${to}%`;
    case "context.compaction.mode": return reset ? "When the chat is full: the default" : to === "ask" ? "When the chat is full: Ask me" : "When the chat is full: Just do it";
    case "context.compaction.resumeQuestion": return reset ? "When the cache is cold: the default" : to === false ? "When the cache is cold: Just send" : "When the cache is cold: Ask me";
    case "context.compaction.changeQuestion": return reset ? "After an update: the default" : to === false ? "After an update: Just send" : "After an update: Ask me";
    case "context.compaction.method": return reset ? "Makes room by: the default" : `Makes room by: ${methodOf(String(to)).name}`;
    // Who writes a summary (the owner's rules of 10-31), and the most an instant fold may leave of the earlier turns.
    case "context.compaction.writer": return reset ? "Summaries written by: the default" : to === "session" ? "Summaries written by: the same model" : "Summaries written by: a side model";
    case "context.compaction.instantTokens": return reset ? "Instant fold up to: the default" : Number(to) > 0 ? `Instant fold up to ${Number(to) >= 1000 ? `${Math.round(Number(to) / 1000)}K` : Number(to).toLocaleString()} of the earlier turns` : "Instant fold: off";
    case "context.compaction.agent": return reset ? "Makes room by: the suggested way" : `Makes room by: ${wayName(String(to))}`;
    case "context.compaction.follow": return reset ? "Filament's copy: the default" : to === false ? "Filament's copy keeps every turn" : "Filament's copy kept in step with the agent";
    // Whom the chat's main agent may ask by itself (HarnessV4_Tasks E15 step 3), by the tags you type.
    case "subagents.ask": return reset ? "Your agent may use: as in Library" : `Your agent may use: ${Array.isArray(to) && to.length ? to.map((t) => `@${t}`).join(", ") : "nobody"}`;
    // The teams it may send on the side by itself (U13-D9), by their keys.
    case "subagents.teams": return reset ? "Your agent may send: the default" : `Your agent may send: ${Array.isArray(to) && to.length ? to.join(", ") : "no team"}`;
    // How another agent's result reaches the agent while it works (HarnessV4_Envelopes_Plan EN5), as its row says it.
    case "subagents.envelopes": return reset ? "Other agents' results: the default" : to === "whole" ? "Other agents' results reach your agent whole" : "Other agents' results reach your agent sealed while it works";
    // The chat's own Parallelize tasks (the owner's of 11-16: its card's Always accept in this chat), by its row's words.
    case "subagents.parallelize": return reset ? "Sub-agents that change files: as Settings › Experimental says" : to ? "Sub-agents that change files start without asking in this chat" : "Sub-agents that change files ask first in this chat";
    case "context.carry": return reset ? "A fresh agent session carries: the default" : `A fresh agent session carries: ${nameIn(CARRY_WORDS, String(to))}`;
    case "fork.transcript": return reset ? "Forks carry: the default" : `Forks carry: ${nameIn(FORK_TRANSCRIPT_WORDS, String(to))}`;
    case "memory.enabled": return reset ? "Memory: the default" : to ? "Memory on" : "Memory off";
    // Memory's In new chats (HarnessV4_Settings_Plan HS-3), by its rows' names.
    case "memory.briefing": return reset ? "The briefing: the default" : to ? "The briefing on" : "The briefing off";
    case "memory.turnBlock": return reset ? "Memory on each message: the default" : to ? "Memory on each message" : "No memory on each message";
    case "memory.tools": return reset ? "Memory's tools: the default" : to ? "Memory's tools on" : "Memory's tools off";
    case "memory.learn": return reset ? "Learning from chats: the default" : to ? "Learns from chats" : "Learns nothing from chats";
    // Settings › Memory under a project (the owner's of 11-09), by its rows' names.
    case "privacy.learn": return reset ? "Memory reads its chats: inherits again" : to ? "Memory reads its chats" : "Memory reads none of its chats";
    case "privacy.index": return reset ? "Searchable: inherits again" : to ? "Its chats are searchable" : "Its chats are kept out of search";
    case "engine.mode": return reset ? "Engine: the model" : to === "team" ? "Engine: a team" : "Engine: the model";
    case "engine.team": return reset ? "Team: none" : `Team: ${to}`;
    case "engine.supervise": return reset ? "The lead reads along: the default" : to ? "The lead reads along with its workers" : "The lead looks at its workers only when it waits";
    case "engine.lookSeconds": return reset ? "The lead's looks: the default pace" : Number(to) === 0 ? "The lead looks whenever a worker moves" : Number(to) >= 60 && Number(to) % 60 === 0 ? `The lead looks every ${Number(to) / 60} min` : `The lead looks every ${Number(to).toLocaleString()} s`;
    case "display.title": return reset ? "Title cleared" : `Renamed "${to}"`;
    case "plugins.mcp": return reset ? "Connectors inherit again" : mcpChangeWords(Array.isArray(from) ? from : [], Array.isArray(to) ? to : []);
    // Settings › Permissions and Instructions (HarnessV4_Settings_Plan HS-3), by their rows' names.
    case "loop.addedFolders": return reset ? "Folders it may also read: inherits again" : `Folders it may also read: ${countWords(to, "folder")}`;
    case "loop.rules": return reset ? "Rules: inherits again" : `Rules: ${countWords(to, "rule")}`;
    case "privacy.bashDeny": return reset ? "Commands it never runs: inherits again" : `Commands it never runs: ${countWords(to, "pattern")}`;
    case "privacy.redact": return reset ? "Text hidden from the model: inherits again" : `Text hidden from the model: ${countWords(to, "pattern")}`;
    case "loop.verify.afterEdits": return reset ? "Check after each edit: none" : `Check after each edit: ${to}`;
    case "loop.learnedPermissions.enabled": return reset ? "Learning from approvals: the default" : to ? "Learns from approvals" : "Asks every time";
    case "loop.secondLook": return reset ? "Second look before risky commands: inherits again" : to ? "Second look before risky commands: on" : "Second look before risky commands: off";
    // The forked steer's switch (the owner's of 11-04), by its row's name.
    case "loop.steerFork": return reset ? "Sends your messages straight to the agent: the default" : to ? "Weighs your messages aside" : "Sends your messages straight to the agent";
    case "loop.learnedPermissions.afterApprovals": return reset ? "Offered in Memory after: the default" : `Memory offers a rule after ${Number(to).toLocaleString()} approvals`;
    case "instructions.session": return reset || !to ? "What every chat is also told: nothing" : "What every chat is also told: changed";
    case "instructions.userFiles": return reset || !Array.isArray(to) || !to.length ? "Your files read in every chat: none" : `Your files read in every chat: ${to.join(", ")}`;
    case "instructions.files": return reset ? "Project instruction files: the default" : `Project instruction files: ${countWords(to, "file")}`;
    case "skills.on": {
      // Library › Skills' switches and the Start board's (HarnessV4_Skills_Plan S1-6): the skills a place turns on, and off.
      const list = Array.isArray(to) ? to : [];
      const named = (/** @type {boolean} */ on) => list.filter((e) => (e?.enabled !== false) === on).map((e) => String(e?.name));
      const [on, off] = [named(true), named(false)];
      return reset || !list.length ? "Skills: inherits again" : [on.length ? `Skills on: ${on.join(", ")}` : "", off.length ? `Skills off: ${off.join(", ")}` : ""].filter(Boolean).join(" · ");
    }
    case "lsp.servers": {
      // Settings › Language servers (the owner's LSP of 11-04): what moved, by each server's name, where the value before
      // is known (a chat's card); else the list as it stands: yours, then the ones switched on and off.
      if (reset) return "Language servers: inherits again";
      if (Array.isArray(from)) return lspChangeWords(from, Array.isArray(to) ? to : []);
      const list = (Array.isArray(to) ? to : []).filter((e) => typeof e?.name === "string");
      const switched = (/** @type {boolean} */ on) => list.filter((e) => e.command == null && (e.enabled !== false) === on).map((e) => e.name);
      const yours = list.filter((e) => e.command != null).map((e) => `${e.name}${e.enabled === false ? " (off)" : ""}`);
      const [on, off] = [switched(true), switched(false)];
      return [yours.length ? `Your language servers: ${yours.join(", ")}` : "", on.length ? `Language servers on: ${on.join(", ")}` : "", off.length ? `Language servers off: ${off.join(", ")}` : ""].filter(Boolean).join(" · ") || "Language servers: none of your own, none switched off";
    }
    case "hooks": return reset ? "Hooks: inherits again" : `Hooks: ${countWords(to, "hook")}`;
    case "plugins.web.fetch": return reset ? "Reading web pages: the default" : to ? "Reads web pages" : "Reads no web pages";
    case "plugins.web.search": return reset ? "Web search: the default" : to ? "Searches the web" : "Searches no web";
    case "plugins.browser": return reset ? "The browser: the default" : to ? "Drives a browser" : "Drives no browser";
    default: {
      const name = path.slice(path.indexOf(".") + 1) || path;
      return reset ? `${name}: inherits again` : `${name}: ${short(to)}`;
    }
  }
}

/** The knobs a divider says where the conversation's engine changes (VW-D8): which engine answers, and which team. */
const DIVIDER_SAYS = new Set(["engine.mode", "engine.team"]);

/**
 * What a settings row between two turns says (HarnessV3-Views V6-10): what moved, in words — none known yet, and the
 * row says only that settings changed; null where no row stands. Beside the divider that says the engine changed, the
 * row leaves the engine's mode and team to it and stands only for something else that moved: a row whose words are
 * not known yet (a turn's own, until the turn ends) says nothing the divider does not.
 * @param {{ changes?: { path: string, to?: any, from?: any }[] }} b @param {boolean} divider
 * @returns {string[] | null}
 */
export function settingsRowWords(b, divider) {
  const moved = (Array.isArray(b.changes) ? b.changes : []).filter((c) => !(divider && DIVIDER_SAYS.has(String(c.path))));
  if (divider && !moved.length) return null;
  return moved.map((c) => settingChangeWords(String(c.path), c.to, c.from));
}

/** An artifact's address: its own card says it, never a website's (AFC-77). @param {string} url */
const isArtifactAddress = (url) => {
  try {
    return new URL(url).hostname.endsWith(`.${ART_DOMAIN}`);
  } catch {
    return false;
  }
};

/** Unique http(s) URLs in assistant text, for the website preview card. @param {string} text */
export function websiteCardsFrom(text) {
  const urls = [];
  const re = /\bhttps?:\/\/[^\s)<\]"'`]+/g;
  const s = String(text || "");
  let m;
  while ((m = re.exec(s))) {
    const u = m[0].replace(/[.,;:!?)]+$/, "");
    if (u && !urls.includes(u) && !isArtifactAddress(u)) urls.push(u);
    if (urls.length >= 3) break;
  }
  return urls.map((url) => {
    try {
      const p = new URL(url);
      return { url, title: p.hostname.replace(/^www\./, ""), kind: "Website" };
    } catch {
      return { url, title: url, kind: "Website" };
    }
  });
}

/**
 * Paths a finished write/edit this round touched — the file-change card's list.
 * We do not invent +N/−N without a diff; the card shows the count of files.
 * @param {Iterable<any>} tools
 */
export function fileChangePaths(tools) {
  const files = [];
  for (const t of tools || []) {
    const name = String(t?.name || "").toLowerCase();
    if (name !== "write" && name !== "edit") continue;
    if (t.state && t.state !== "done") continue;
    const raw = t.args?.path || t.args?.file_path || (typeof t.args === "string" ? t.args : "");
    const path = String(raw || "").split("\n")[0].trim();
    if (path && !files.includes(path)) files.push(path);
  }
  return files;
}

/**
 * A chat row's last moment, in ms: the sessions list's `lastAt`, else a `when` that names a time (a row this page
 * drew before the archive had it). A day alone (`YYYY-MM-DD`) is no moment: 0, never UTC midnight.
 * @param {{ lastAt?: unknown, when?: unknown } | null | undefined} s
 */
export function rowMoment(s) {
  const at = Number(s?.lastAt);
  if (at > 0) return at;
  const when = String(s?.when ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(when.trim()) ? 0 : Date.parse(when) || 0;
}

/** An age in one word. Date-only stamps (`YYYY-MM-DD` from the sessions list) are calendar days, not UTC midnight. @param {string | null | undefined} when */
export function sessionAge(when) {
  if (!when) return "";
  const s = String(when).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, mo, d] = s.split("-").map(Number);
    const then = new Date(y, mo - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((today.getTime() - then.getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d`;
    return `${Math.round(days / 30)}mo`;
  }
  const iso = s.includes("T") ? s : s.replace(" ", "T") + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? "" : "Z");
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d`;
  return `${Math.round(d / 30)}mo`;
}

/**
 * Who holds a session's turn, in the sidebar spinner's words and the waiting queue's (Facade D11/D13): the holder's
 * own name working — "Codex is working"; a coding agent's turn of its own (HarnessV3-ACP AC3-9) says so. The page
 * maps no ids; an unnamed holder reads "another window".
 * @param {{ label?: string | null, client?: string | null, own?: { agent: string } | null } | null | undefined} holder
 */
export function workingWords(holder) {
  return `${(holder && (holder.label || holder.client)) || "another window"} is working${holder?.own ? " on its own" : ""}`;
}

/**
 * A chat another machine's agents started here (the remote-agents plan's s-ui), as its sidebar row and its header say
 * it, from the sessions list's `fromAgents`: whose agents — "From MacBook's agents", "From another machine's agents"
 * once this machine keeps no name of them; nothing for any other chat.
 * @param {{ fromAgents?: { name: string | null } | null } | null | undefined} s
 */
export function fromAgentsWords(s) {
  return s?.fromAgents ? `From ${s.fromAgents.name ? possessive(s.fromAgents.name) : "another machine's"} agents` : "";
}

/**
 * A list's chats with each thread (core/threads.js) under the chat whose agent started it, where the list holds that
 * chat too, as the sidebar draws them: `top` the rows that stand in the list, in its order; `under` each chat's threads,
 * in the list's order. A thread whose starter the list does not hold — pinned apart, at work in Now, in another
 * project — stands on its own, said so by its byline (`threadOfWords`). A link that loops stands on its own as well.
 * @template {{ id: string, threadOf?: string | null }} T
 * @param {T[]} rows
 * @returns {{ top: T[], under: Map<string, T[]> }}
 */
export function threadsNested(rows) {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  /** Whether a row's starter is in the list, and its starters, walked up, reach a chat that stands rather than loop. @param {T} r */
  const nests = (r) => {
    if (!r.threadOf || !byId.has(String(r.threadOf))) return false;
    const seen = new Set([String(r.id)]);
    for (let at = String(r.threadOf); byId.has(at); at = String(byId.get(at)?.threadOf || "")) {
      if (seen.has(at)) return false;
      seen.add(at);
    }
    return true;
  };
  /** @type {T[]} */
  const top = [];
  /** @type {Map<string, T[]>} */
  const under = new Map();
  for (const r of rows) {
    if (!nests(r)) { top.push(r); continue; }
    const from = String(r.threadOf);
    under.set(from, [...(under.get(from) || []), r]);
  }
  return { top, under };
}

/**
 * A thread's byline where it stands apart from the chat that started it (`threadsNested`): "Thread of Build the login
 * flow", that chat named as the list names it; "" for a chat that is no thread.
 * @param {{ threadOf?: string | null } | null | undefined} s @param {{ id: string, title?: string | null, preview?: string | null }[]} sessions
 */
export function threadOfWords(s, sessions) {
  if (!s?.threadOf) return "";
  const from = (sessions || []).find((x) => String(x.id) === String(s.threadOf));
  return `Thread of ${from?.title || from?.preview || "another chat"}`;
}

/**
 * The chats linked to the one shown by a thread (core/threads.js), as its header's chip names them: the one whose agent
 * started it, and those its own agent started. Read from its transcript (`read`: every one, whatever the list holds) and
 * from the sessions list's `threadOf` (a thread started since the read); each named as the list names it now, else as
 * the read did.
 * @param {string | null | undefined} chain  the chat shown's
 * @param {{ from?: { id: string, title?: string } | null, started?: { id: string, title?: string }[] } | null | undefined} read
 * @param {any[]} sessions  the sessions list's rows
 * @returns {{ from: { id: string, title: string } | null, started: { id: string, title: string }[] }}
 */
export function threadsLinked(chain, read, sessions) {
  const id = chain ? String(chain) : "";
  if (!id) return { from: null, started: [] };
  const rows = new Map((sessions || []).map((s) => [String(s.id), s]));
  /** @type {Map<string, string>} */
  const titled = new Map([...(read?.from ? [read.from] : []), ...(read?.started || [])].map((t) => [String(t.id), String(t.title || "")]));
  /** @param {string} at */
  const named = (at) => ({ id: at, title: String(rows.get(at)?.title || rows.get(at)?.preview || titled.get(at) || "another chat") });
  const from = read?.from?.id || rows.get(id)?.threadOf || null;
  const listed = (sessions || []).filter((s) => String(s.threadOf || "") === id).map((s) => String(s.id));
  return {
    from: from ? named(String(from)) : null,
    started: [...new Set([...listed, ...(read?.started || []).map((t) => String(t.id))])].map(named),
  };
}

/**
 * The words a way on sends again for a turn — Retry, Compact and send, Continue on (HarnessV3-ACP AC3-6): what the
 * developer typed, "" for attachments alone; "continue" for a turn its coding agent began by itself (AC3-9), whose
 * words were Filament's. A thread's brief (`brief`) has none: its words are its starter's agent's, and go again only as
 * the brief they were (`againOf`), never as the person's message. Nor has a watcher's wake (`watched`), whose words
 * are what the watcher heard, nor the first message of a chat Filament made for it (`opening`): none is the person's
 * to send (r-doors, 11-12: a Retry sent each as their message, in the chat's own mode).
 * @param {{ userText?: string, own?: unknown, brief?: { text?: string } | null, watched?: unknown, opening?: unknown }} turn
 */
export function wordsAgain(turn) {
  if (turn.own) return "continue";
  if (turn.brief || turn.watched || turn.opening) return "";
  return turn.userText && turn.userText !== "(attachments)" ? turn.userText : "";
}

/**
 * The watcher's run a failed wake's Retry asks Filament for again (`againOf`'s `wake`): which watcher woke the chat,
 * as its turn keeps it (`watch`, history.js), and the turn's number on record — the page sends no word of the wake,
 * which Filament reads from the chat's own record. Null where the turn keeps none of who woke it.
 * @param {{ watched?: unknown, watch?: { id?: unknown, project?: unknown } | null, n?: unknown }} turn
 * @returns {{ project: string, id: string, turn: number } | null}
 */
const wakeOf = (turn) =>
  turn.watched && typeof turn.watch?.id === "string" && typeof turn.watch.project === "string" && Number.isInteger(turn.n) && Number(turn.n) > 0
    ? { project: turn.watch.project, id: turn.watch.id, turn: Number(turn.n) }
    : null;

/**
 * Whether a turn's message is never sent again from the page (r-doors, 11-12), so its failure offers no Retry: the
 * first message of a chat Filament made for it — a routine's run, a Space ask's, a team's opening (`opening`) —,
 * which that chat takes once, as its run's; and a watcher's wake that keeps nothing of who woke it, which no watcher
 * can be asked to run again. Either sent again would be the person's message.
 * @param {{ opening?: unknown, watched?: unknown, watch?: { id?: unknown, project?: unknown } | null, n?: unknown }} turn
 */
export const sentOnce = (turn) => !!turn.opening || (!!turn.watched && !wakeOf(turn));

/**
 * The whole message a way on sends again for a turn — Retry, Compact and send, Send as it is, Don't ask again, Switch
 * and send, Continue on: its words (`wordsAgain`) and what went with them. A turn this page sent keeps the composer's
 * own list (`sent`: pictures and files); a turn drawn from the record gives back its pictures, named as its
 * attachments name them, and its PDFs under their own names. A turn its agent began by itself had nothing with it. A
 * thread's brief goes again as the brief it was (`brief`: Filament's one block, as history.js `briefOf` read it from the
 * turn's message), with no words and nothing beside it — nothing at all where the block could not be read. A watcher's
 * wake goes again as the watcher's run (`wake`, `wakeOf`): no words and nothing beside it, Filament asked by the
 * turn's number. A message that is never sent again from the page (`sentOnce`) gives nothing, and says so (`once`).
 * @param {{ userText?: string, own?: unknown, brief?: { from?: string | null, title?: string, text?: string } | null, briefBlock?: string, watched?: unknown, watch?: any, opening?: unknown, n?: unknown, sent?: any[], attachments?: any[], userContent?: any[] }} turn
 * @returns {{ text: string, attachments: any[], brief?: string, wake?: { project: string, id: string, turn: number }, once?: true }}
 */
export function againOf(turn) {
  const text = wordsAgain(turn);
  if (turn.own) return { text, attachments: [] };
  if (turn.brief) return { text, attachments: [], ...(turn.briefBlock ? { brief: String(turn.briefBlock) } : {}) };
  if (turn.watched || turn.opening) return { text, attachments: [], ...(sentOnce(turn) ? { once: /** @type {const} */ (true) } : { wake: /** @type {NonNullable<ReturnType<typeof wakeOf>>} */ (wakeOf(turn)) }) };
  if (Array.isArray(turn.sent)) return { text, attachments: turn.sent };
  const names = (turn.attachments || []).filter((a) => a?.kind === "image").map((a) => String(a.name || ""));
  /** @type {any[]} */
  const attachments = [];
  let i = 0;
  for (const b of Array.isArray(turn.userContent) ? turn.userContent : []) {
    const s = b?.source;
    if (b?.type === "document" && s?.type === "base64" && s.media_type === "application/pdf" && s.data) {
      const data = String(s.data);
      attachments.push({ kind: "pdf", name: String(b.title || "document.pdf"), size: Math.floor((data.length * 3) / 4), type: "application/pdf", data });
      continue;
    }
    if (b?.type !== "image") continue;
    const name = names[i++] || "picture";
    if (s?.type !== "base64" || !s.data) continue;
    const data = String(s.data);
    attachments.push({ kind: "image", name, size: Math.floor((data.length * 3) / 4), type: String(s.media_type || "image/png"), data });
  }
  return { text, attachments };
}

/**
 * Whether a coding agent's run takes what is typed while it works, as the run says: queued at the agent, which takes
 * it at its next step (`queued`, HarnessV3-FailurePoints §7.2), into its running turn (`live`, HarnessV3-ACP AC3-1), or
 * at its next step (`next`, AC-D6); else it waits for the turn's end.
 * @param {string | null | undefined} steer
 */
export const agentTakesWords = (steer) => steer === "queued" || steer === "live" || steer === "next";

/**
 * What is said when what is typed waits for a coding agent's running turn (HarnessV3-ACP AC3-1): it goes out when the
 * turn ends — a turn the agent began by itself (AC3-9) named as its own.
 * @param {string | null} [own]  the agent, for a turn of its own
 */
export function agentQueuesWords(own) {
  return own
    ? `Queued — ${own} is working on its own; your message goes out when it's done`
    : "Queued — this agent can't take a message mid-turn; it goes out when this turn ends";
}

/**
 * What Filament says under a finished turn — one thing at most: its own answer to a command, or the note the turn
 * carries. Memory's note is not among them: it sits above the reply, beside whichever of these is drawn below it.
 * @param {any} turn
 * @returns {{ kind: "command" } | { kind: "note", text: string, warn?: boolean } | null}  `warn`: a note the person
 *   must not miss, drawn in the warning's colour
 */
export function shimLineOf(turn) {
  if (turn?.command) return { kind: "command" };
  if (turn?.shimNote) return { kind: "note", text: String(turn.shimNote) };
  // Another model than the chat's answered (`facts.otherModel`): the words, on the turn that said them.
  const said = turn?.facts?.otherModel?.said;
  if (said) return { kind: "note", text: String(said), warn: true };
  return null;
}

/**
 * A knob's source as the menus speak it (D6): the layer its value sits in, as the server says it (guardrail 14).
 * @param {string} path @param {any} settings  the session view's settings ({ sources })
 * @returns {string} a layer name
 */
export function sourceOfKnob(path, settings) {
  return String(settings?.sources?.[path] || "default");
}

/**
 * A turn's facts as the footer's one quiet line (HarnessV3-Facade D3): up to nine segments, each only when the
 * turn has it — model · the models it ran on · sent (with the cache hit) · cost · time · memory · fold saving ·
 * window fit · stop reason —
 * then the warnings (a cut reply, a failover, an error). Pure: one function turns facts into segments, the footer
 * draws the result, nothing else formats facts. Every segment carries its tooltip with the figure in full.
 * @param {any} facts  the turn's meta.facts (D2), or null
 * @returns {{ id: string, text: string, title: string, tone: string }[]}
 */
export function factsLine(facts) {
  if (!facts || typeof facts !== "object") return [];
  /** @type {{ id: string, text: string, title: string, tone?: string }[]} */
  const out = [];
  const n = (x) => (Number(x) || 0).toLocaleString("en-US");
  // The models the turn's tokens were counted on, where its coding agent said them (HarnessV4_Tasks C13): `model` is
  // the one the turn asked for. More than one is said beside it, and each is named in a row of the details card.
  const counted = Array.isArray(facts.models) ? facts.models.filter((/** @type {any} */ m) => m?.model) : [];
  const ranOn = counted.map((/** @type {any} */ m) => `${m.model} (${n(m.output)} out)`).join(", ");
  // Named as the box names it ("Claude Opus 5.5"), the id it was asked by in the title (the Designer's review of 10-24:
  // one name per thing).
  const countedOn = counted.length ? ` — its agent counted the turn's tokens on ${counted.length === 1 ? ranOn : `${counted.length} models: ${ranOn}`}` : "";
  // Another model than the chat's answered (`facts.otherModel`, the server's word): the one that answered named
  // first, the chosen one beside it, as a warning — on every such turn, whether or not its words were said under it.
  const other = facts.otherModel?.answered && facts.otherModel?.chosen ? facts.otherModel : null;
  if (other)
    out.push({
      id: "model",
      text: `answered by ${prettyModel(other.answered) || other.answered}${counted.length > 1 ? ` +${counted.length - 1}` : ""} · chosen ${prettyModel(other.chosen) || other.chosen}`,
      tone: "warn",
      title: `this reply came from ${other.answered}${facts.upstream ? ` on ${facts.upstream}` : ""}, not ${other.chosen}, the model this chat names${countedOn}`,
    });
  else if (facts.model)
    out.push({
      id: "model",
      text: `${prettyModel(facts.model) || facts.model}${counted.length > 1 ? ` +${counted.length - 1}` : ""}`,
      title: `answered by ${facts.model}${facts.upstream ? ` on ${facts.upstream}` : ""}${countedOn}`,
    });
  if (counted.length > 1)
    out.push({
      id: "models",
      text: counted.map((/** @type {any} */ m) => `${prettyModel(m.model) || m.model} ${n(m.output)} out`).join(" · "),
      title: `the models this turn's tokens were counted on, as its coding agent said them, most written first: ${ranOn}. More than one is the agent's own doing: an agent of its own on another model, or a retry on another model when the session's declined the request`,
    });
  const t = facts.tokens || {};
  if (t.input != null && (Number(t.input) || Number(t.cacheRead) || Number(t.cacheWrite))) {
    // "Sent" is the prompt as the provider counted it (input + cache read + cache write), `held`, set when the turn's
    // own request lands; until then its rounds' input stands in. What it read from the cache and wrote to it is said
    // where the turn's usage said them (lib/cache-facts.js): a turn that gave no cache numbers says what went out.
    const held = Number(facts.held) || Number(t.input) || 0;
    const said = cacheSaid(t);
    const hit = held && said ? Math.round((100 * (Number(t.cacheRead) || 0)) / held) : 0;
    out.push({
      id: "sent",
      text: `sent ${n(held)}${hit ? ` (cache ${hit}%)` : ""}`,
      title: said
        ? `${n(held)} tokens went out, the prompt as the provider counted it; ${n(t.cacheRead)} read from its cache, ${n(t.cacheWrite)} written to it (${n(t.input)} fresh)`
        : `${n(held)} tokens went out; this turn's usage gave no cache numbers`,
    });
  }
  // What the turn paid, and beside it what the same tokens cost at list price when the two part (Providers P4: a
  // plan pays $0; a provider may state its own charge).
  const paid = facts.costUsd == null ? null : Number(facts.costUsd);
  const list = facts.listUsd == null ? null : Number(facts.listUsd);
  if (paid != null || list != null) {
    const short = (/** @type {number} */ v) => `$${v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
    const w = costWords(paid, list, { usd: short });
    out.push({ id: "cost", text: w.text, title: listDiffers(paid, list) ? `${costWords(paid, list).title} — the whole turn, summed over the calls that billed` : `$${Number(paid).toFixed(4)} for the whole turn, summed over the calls that billed` });
  }
  if (facts.startedAt && facts.endedAt && facts.endedAt >= facts.startedAt) {
    const s = Math.max(1, Math.round((facts.endedAt - facts.startedAt) / 1000));
    out.push({ id: "time", text: s < 90 ? `${s} s` : `${Math.round((s / 60) * 10) / 10} min`, title: `the turn took ${s} s (first own request's start to the last call's finish)` });
  }
  if (facts.memory && (facts.memory.injected || facts.memory.tokens))
    out.push({ id: "memory", text: `memory ${facts.memory.injected}`, title: `${facts.memory.injected} item${facts.memory.injected === 1 ? "" : "s"} put into this turn (~${n(facts.memory.tokens)} tok${facts.memory.briefing ? `, briefing included` : ""})${facts.memory.recalls ? `; ${facts.memory.recalls} recall${facts.memory.recalls === 1 ? "" : "s"} through the memory tools` : ""}` });
  // What the turn's request held back of earlier turns: the turns a fold left folded, and the tokens a fold or a result
  // policy kept off it. Turns sent whole with their results say nothing.
  if (facts.view && (facts.view.foldedTurns || facts.view.savedTokens)) {
    const folded = Number(facts.view.foldedTurns) || 0;
    const saved = Number(facts.view.savedTokens) || 0;
    out.push({ id: "view", text: `${folded ? `${folded} folded` : "held back"}${saved ? ` −${n(saved)}` : ""}`, title: `${folded ? `${folded} earlier turn${folded === 1 ? "" : "s"} sent folded` : "earlier turns sent whole"}: ${saved ? `${n(saved)} tokens of old material held back from the request` : "nothing held back"}` });
  }
  if (facts.context && facts.context.verdict) {
    const verdict = String(facts.context.verdict);
    // A window nobody knows is a fact about the model, not a warning about the turn.
    if (verdict === "unknown")
      out.push({ id: "fit", text: "window unknown", title: "the request was not measured against a window — this model's window is unknown (a contextTokens entry in the upstream's pricing sets it)" });
    // Said in words (`verdictWords`), never the server's one word: a turn that ended past its line read "edge".
    else out.push({ id: "fit", text: FIT_WORDS[verdict] || verdict, tone: verdict === "fits" ? "" : "warn", title: `the turn's request ${verdict === "fits" || verdict === "tight" ? "" : "was "}${verdictWords(verdict, facts.context.usable).replace(/^was /, "")} — window ${n(facts.context.window)}, ${windowSourceWords(facts.context.source)}` });
  }
  if (facts.stopReason) out.push({ id: "stop", text: String(facts.stopReason), title: `the reply ended with ${facts.stopReason}` });
  // The warnings, after the facts.
  if (/^(max_tokens|length|max_output_tokens|incomplete)$/.test(String(facts.stopReason || "")))
    out.push({ id: "cut", text: "✂ cut at the output limit", tone: "warn", title: "the reply stopped at the model's output cap" });
  if ((Number(facts.failovers) || 0) > 0)
    out.push({ id: "failover", text: `↻ served after ${facts.failovers} failover${facts.failovers === 1 ? "" : "s"}`, tone: "warn", title: `upstream failover${facts.failovers === 1 ? "" : "s"} happened before the reply` });
  // A turn whose newest request answered after one that failed — a Retry, or Continue on another account (AC3's
  // drive D7) — warns as a failover does; one whose newest request failed (`error`) is an error.
  const errors = Number(facts.errors) || 0;
  if (errors > 0)
    out.push(facts.error
      ? { id: "errors", text: "an error occurred in this turn", tone: "err", title: `${errors} of the turn's requests ended in an error` }
      : { id: "errors", text: `↻ answered after ${errors === 1 ? "a failed request" : `${errors} failed requests`}`, tone: "warn", title: `${errors} of the turn's requests ended in an error before one answered` });
  return out.map((s) => ({ id: s.id, text: s.text, title: s.title, tone: s.tone || "" }));
}

/** The details card's name for each of factsLine's segments, by id. */
export const FACT_LABELS = Object.freeze({
  model: "Model", models: "Ran on", sent: "Sent", cost: "Cost", time: "Time", memory: "Memory", view: "History",
  fit: "Window", stop: "Ended with", cut: "Reply", failover: "Upstream", errors: "Errors",
});

/**
 * Where the footer draws each segment: `meta` is the short facts beside the hover actions (model, cost, time),
 * `warn` is every toned segment — shown whether or not the pointer is on the turn — and the details card lists all.
 * @param {{ id: string, text: string, title: string, tone: string }[]} segments
 */
export function footerFacts(segments) {
  const META = ["model", "cost", "time"];
  return {
    meta: segments.filter((s) => !s.tone && META.includes(s.id)),
    warn: segments.filter((s) => !!s.tone),
  };
}

/**
 * Where a window's number came from, in words (HarnessV3 Step 4 D6) — the run card, the Context widget and the
 * facts line all say it this way: its upstream's model card, the provider's own model listing, Filament's shipped
 * estimates, the coding agent itself (HarnessV3-ACP AC3-5), or nobody.
 * @param {string | null | undefined} source  `rec.context.source`: operator · endpoint · builtin · session · agent · null
 */
export function windowSourceWords(source) {
  if (source === "agent") return "as the agent named it";
  if (source === "operator") return "from its upstream's model card";
  if (source === "endpoint") return "from the provider's model list";
  if (source === "builtin") return "Filament's built-in estimate";
  if (source === "session") return "the window this session chose";
  return "unknown for this model";
}

/** A window in the Context card's short form: 200K, 1M, 1.5M. @param {number} n */
const shortWindow = (n) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : `${Math.round(n / 1000)}K`);

/**
 * A coding agent that runs a model in a window of its own other than the one said for it here (the owner's of 11-10:
 * Fable 5.2 tuned to 1M, the picker said 1M, while Claude Code ran it in 200K — its own count, which the Context card
 * drew — and nothing said why): the words for it, the Context card's and the models list's alike; null where they
 * agree, or the agent named none. `add`: the name that runs it in the window said, as the server gives it (routing's
 * `oneMToAdd`: the list's `agent_window_add`, a session's window answer's `add`).
 * @param {{ who: string, model: string, runs: number | null | undefined, set: number | null | undefined, add?: string | null }} o
 * @returns {string | null}
 */
export function agentWindowWords({ who, model, runs, set, add = null }) {
  const r = Number(runs) || 0;
  const s = Number(set) || 0;
  if (r < 1000 || s < 1000 || r === s) return null;
  return `${who} runs ${model} in ${shortWindow(r)}, its own count: the ${shortWindow(s)} said for it here doesn't reach ${who}.${add ? ` Add ${add} by name on its card to run it in ${shortWindow(s)}.` : ""}`;
}

/** The verdict as the turn's footer says it, in the few words a warning under a reply has room for. */
const FIT_WORDS = Object.freeze(/** @type {Record<string, string>} */ ({ fits: "fits", tight: "near the compaction line", edge: "past the compaction line", over: "over the window" }));

/**
 * A request's window verdict in words (`fitVerdict`'s one word, the server's): fits · near the compaction line ·
 * past the compaction line · over the window, with the line (or the native lane's reserve) when it is known.
 * @param {string} verdict @param {number | null} [usable]
 */
export function verdictWords(verdict, usable = null) {
  const edge = Number(usable) > 0 ? ` (compacts at ${Number(usable).toLocaleString("en-US")})` : "";
  if (verdict === "fits") return `fits${edge}`;
  if (verdict === "tight") return `fits, near the compaction line${edge}`;
  if (verdict === "edge") return `past the compaction line${edge}`;
  if (verdict === "over") return "was over the window itself";
  return "was not measured against a window";
}

/**
 * A wait on the developer, in the loop's own words: their paused launch, their answer. Its start alone: a sub-agent's
 * name that holds the word, in the words of a wait on it, is no such wait.
 */
const DEVELOPERS_WAIT = /^the developer's\b/;

/**
 * What a live agent turn is doing, from the loop's newest `turn-state` event (Step 4 D6): planning is thinking,
 * acting is running its tool calls (or a hook), observing is reading the results, waiting is holding for sub-agents
 * (the developer's paused launch, or its own background ones before the turn may end) — or, carrying `retry`, for a
 * provider busy for a moment, said in the loop's own words: "kimi-cn is overloaded — trying again in 8 s (try 3 of
 * 10)" (HarnessV3-AtHome AH-F4); carrying `queue`, for a slot at its provider, in the dispatch's: "waiting for a slot:
 * k3 runs 1 call at a time at kimi-cn (…), held by a sub-agent's compaction fork (…)" (AH-F5). "" for anything else.
 * A team's lead waits for its workers (`team`), in those words. A coding agent's prompt that went out says so in its
 * run's words ("sent — Claude is working"), and its thinking before any words what it has thought so far ("thinking ·
 * about 2,400 tokens", HarnessV3-FailurePoints §5.1 item 2).
 * @param {{ to?: string, why?: string, retry?: any, queue?: any, tokens?: number } | null | undefined} e @param {boolean} [team]
 */
export function turnStateWords(e, team = false) {
  const why = String(e?.why || "");
  if (e?.to === "sent") return why;
  if (e?.to === "planning") return e.tokens ? `thinking · about ${e.tokens.toLocaleString("en-US")} tokens` : "thinking";
  if (e?.to === "observing") return "reading results";
  if (e?.to === "waiting" && (e.retry || e.queue)) return why;
  if (e?.to === "waiting") return DEVELOPERS_WAIT.test(why) ? "waiting for your agent" : team ? "waiting for its workers" : "waiting for its agents";
  if (e?.to === "acting") {
    const m = /^(\d+) tool call/.exec(why);
    if (m) return `running ${m[1]} tool call${m[1] === "1" ? "" : "s"}`;
    return /hook/.test(why) ? "running a hook" : "running tools";
  }
  return "";
}

/**
 * What a turn waits for, in its run's words, where the line under it says them (the owner's of 11-04: "it should be
 * mentioned somewhere above composer or maybe at the end of your transcript why the turn is currently blocked"): "waiting
 * for its sub-agent “Map the code” to report". "" where it waits for nothing it named, or for a model call's retry or
 * slot, which their own row says; the developer's own launch, as the fold says it.
 * @param {{ to?: string, why?: string, retry?: any, queue?: any } | null | undefined} e
 */
export function waitingWords(e) {
  if (e?.to !== "waiting" || e.retry || e.queue) return "";
  const why = String(e.why || "");
  return DEVELOPERS_WAIT.test(why) ? "waiting for your agent" : why;
}

/** Filament's own tools in words, as the live fold names them. */
const OWN_CALL_WORDS = { wait: "waiting for agents", tasks: "updating the tasks", report: "reporting back" };

/**
 * A running call in a few words, as the live fold names it (HarnessV3-ACP AC1-6): "running npm test", "reading
 * README.md", "editing src/app.js". The card decides — any vocabulary speaks it; a call that carries none is named by
 * its tool.
 * @param {any} t  a stub: its card and its name
 * @returns {string}
 */
export function callWords(t) {
  const c = t?.card || null;
  const raw = String(c?.subject ?? "");
  const subject = raw.length > 60 ? `${raw.slice(0, 59)}…` : raw;
  const name = String(t?.name || "");
  const on = (/** @type {string} */ verb) => (subject ? `${verb} ${subject}` : verb);
  switch (c?.kind) {
    case "read": return on("reading");
    case "search": return on("searching");
    case "list": return on("listing");
    case "write": return on("writing");
    case "edit": return on("editing");
    case "shell":
      return on(c.title === "Run in background" ? "starting" : c.title === "Read output" ? "reading the output of" : c.title === "Stop" ? "stopping" : "running");
    case "web": return on(c.title === "Search the web" ? "searching the web for" : "fetching");
    case "ask": return "waiting for your answer";
    case "proposal": return "proposing a plan";
    case "todo": return "planning";
    // The agent tool's stop of a sub-agent (core/tool-vocab.js `SUBAGENT_STOP`) starts no agent's work.
    case "subagent": return c.title === "Stop sub-agent" ? on("stopping sub-agent") : subject ? `an agent works on “${subject}”` : "an agent works";
    case "image": return "generating an image";
    // Claude Code's ToolSearch loading the tools it holds back, or looking for them, as Filament's mcp tool does.
    case "other":
      if (c.title === "Load tools") return on("loading");
      if (c.title === "Look for tools") return on("looking for tools:");
      break;
    case "mcp": {
      const m = /^mcp__(.+?)__(.+)$/.exec(name);
      // Filament's mcp tool looking for a server's tools, or loading them (E49): its call of one cards as that tool.
      if (!m && name === "mcp" && c.title) return on(c.title === "Load tools" ? "loading" : c.title === "Look for tools" ? "looking for tools:" : "calling");
      return m ? `using ${m[1]}: ${m[2]}` : `running ${name}`;
    }
  }
  const own = /** @type {Record<string, string>} */ (OWN_CALL_WORDS)[name.toLowerCase()];
  if (own) return own;
  if (/^filament_memory/i.test(name)) return /search|load/i.test(name) ? "recalling" : "remembering";
  return `running ${c?.title || name || "a tool"}`;
}

/**
 * What the live fold says the turn is doing (AC1-6): where the agent works, once it has worked outside the chat's
 * folder ("in filament-wt", HarnessV4_Git_Plan GW-D65); then the call running now, named; how many run at once; with
 * none running, the loop's own state (`turnStateWords`). Every engine's turn reads the same.
 * @param {any} al  the aligned run (alignEvents)
 * @param {boolean} [team]
 * @returns {string}
 */
export function liveWords(al, team = false) {
  const where = al?.place ? `in ${placeName(al.place.place)}` : "";
  return [where, doingWords(al, team)].filter(Boolean).join(" · ");
}

/** What the turn does now, without where. @param {any} al @param {boolean} team @returns {string} */
function doingWords(al, team) {
  // An agent's question waits for the person (HarnessV3-ACP AC2-4): that's the turn's state, whichever call asked.
  if (al?.waiting?.length) return "waiting for your answer";
  const running = [...(al?.byRound?.values() || [])]
    .flatMap((c) => c.order.map((/** @type {string} */ id) => c.tools.get(id)))
    .filter((t) => t?.state === "running");
  if (running.length === 1) return callWords(running[0]);
  if (running.length > 1) return `running ${running.length} tool calls`;
  return turnStateWords(al?.turnState, team);
}

/**
 * A place's own MCP list's change in words, from the list before and after (HarnessV4_Settings_Plan HS-1; "Connector"
 * since the owner's word of 10-26): "Connector fx off", "Connector fx on", "Connector fx added", "Connector fx removed",
 * "Connector fx changed", an account picked, "Connector fx signs in as work" (HarnessV4_Space_Plan S4b), how its tools
 * load, "Connector fx always loaded" or "on demand", and a switch or a pick taken back, "Connector fx: inherits again";
 * several at once, joined. A credential is its placeholder in both lists (maskAnswer), so a new key reads as
 * "changed", never as its value.
 * @param {any[]} from @param {any[]} to
 */
export function mcpChangeWords(from, to) {
  const named = (/** @type {any[]} */ list) => new Map(list.filter((e) => typeof e?.name === "string").map((e) => [e.name, e]));
  const was = named(from);
  const now = named(to);
  const isSwitch = (/** @type {any} */ e) => !e.command && !e.url;
  const off = (/** @type {any} */ e) => e.enabled === false;
  const rest = (/** @type {any} */ e) => JSON.stringify({ ...e, enabled: undefined, account: undefined, load: undefined });
  const as = (/** @type {any} */ e) => (typeof e?.account === "string" && e.account.trim() ? e.account.trim() : "main");
  // How an entry's tools load, in the MCP list's words (lib/mcp-list.js LOAD_WORDS): a server that names none loads on
  // demand; a pick that names none, "", loads as the layers beneath it say.
  const loads = (/** @type {any} */ e) => (e.load === "core" ? "always loaded" : e.load === "on-demand" || !isSwitch(e) ? "on demand" : "");
  const words = [];
  for (const [name, e] of now) {
    const b = was.get(name);
    if (!b) {
      if (!isSwitch(e)) words.push(`Connector ${name} added${off(e) ? ", off" : ""}${e.load === "core" ? ", always loaded" : ""}`);
      else {
        // A pick says what it picks; one that names nothing switches its server on.
        const parts = [
          ...(typeof e.enabled === "boolean" || (typeof e.account !== "string" && !loads(e)) ? [off(e) ? "off" : "on"] : []),
          ...(typeof e.account === "string" ? [`signs in as ${as(e)}`] : []),
          ...(loads(e) ? [loads(e)] : []),
        ];
        words.push(`Connector ${name} ${parts.join(", ")}`);
      }
    } else if (rest(b) !== rest(e)) words.push(`Connector ${name} changed`);
    else {
      const parts = [];
      if (off(b) !== off(e)) parts.push(off(e) ? "off" : "on");
      if (as(b) !== as(e) || typeof b.account !== typeof e.account) parts.push(`signs in as ${as(e)}`);
      if (loads(b) !== loads(e)) parts.push(loads(e) || "loads as it inherits");
      if (parts.length) words.push(`Connector ${name} ${parts.join(", ")}`);
    }
  }
  for (const [name, b] of was) if (!now.has(name)) words.push(isSwitch(b) ? `Connector ${name}: inherits again` : `Connector ${name} removed`);
  return words.join(" · ") || "Connectors changed";
}

/**
 * A place's language servers' change in words, from the list before and after (the owner's LSP of 11-04), as a
 * connector's is said: "Language server pyright off", "Language server pyright on", "Language server zls added", "Language
 * server zls removed", "Language server zls changed", and a switch taken back, "Language server pyright: inherits again";
 * several at once, joined. A server of yours is one with a command; a switch, `{ name, enabled }`, has none.
 * @param {any[]} from @param {any[]} to
 */
export function lspChangeWords(from, to) {
  const named = (/** @type {any[]} */ list) => new Map(list.filter((e) => typeof e?.name === "string").map((e) => [e.name, e]));
  const was = named(from);
  const now = named(to);
  const isSwitch = (/** @type {any} */ e) => e.command == null;
  const onOff = (/** @type {any} */ e) => (e.enabled === false ? "off" : "on");
  const rest = (/** @type {any} */ e) => JSON.stringify({ ...e, enabled: undefined });
  const words = [];
  for (const [name, e] of now) {
    const b = was.get(name);
    // One of yours added where a switch stood, or taken away where a broader layer's switch stands: added, removed.
    if (!b || isSwitch(b) !== isSwitch(e)) words.push(!isSwitch(e) ? `Language server ${name} added${e.enabled === false ? ", off" : ""}` : b ? `Language server ${name} removed` : `Language server ${name} ${onOff(e)}`);
    else if (rest(b) !== rest(e)) words.push(`Language server ${name} changed${onOff(b) !== onOff(e) ? `, ${onOff(e)}` : ""}`);
    else if (onOff(b) !== onOff(e)) words.push(`Language server ${name} ${onOff(e)}`);
  }
  for (const [name, b] of was) if (!now.has(name)) words.push(isSwitch(b) ? `Language server ${name}: inherits again` : `Language server ${name} removed`);
  return words.join(" · ") || "Language servers changed";
}

/**
 * A reply's words — what Copy takes and the rail previews: its text blocks joined.
 * @param {any[] | null | undefined} blocks @param {string} [sep]
 */
export const replyTextOf = (blocks, sep = "\n") =>
  (blocks || [])
    .filter((b) => b?.type === "text")
    .map((b) => String(b.text ?? ""))
    .filter(Boolean)
    .join(sep);

/**
 * Where a turn's segments go. While the turn runs, everything stands in the order it happened, the way a native client
 * streams: the fold holds what came before the last reply text, the text follows the fold, and whatever came after the
 * text (the next round's thinking, its cards) follows the text — the newest work is always the bottom of the turn. Once
 * the turn has settled, the fold takes ALL the work, whatever followed the last text included (a stopped turn's
 * unfinished rounds, an archived reply's cards past its merged text), and only the answer and its post-answer rows (the
 * website cards) stay under it. A normal turn ends on its answer, so nothing moves when it settles. Words alone are no
 * work: a fold that would hold only texts holds none, and they stand above the last text (`lead`) — the words a turn
 * said before its question, a reply before Filament's note. Filament's note right under the reply's last words (`note`,
 * LD-D7: a question answered, a stop that quotes the developer) closes that reply: the words stand, whatever work the
 * fold holds, and the note stands under them. Settled, the note — the reply's last text, words before it or none — is
 * the turn's last word (`closing`): the page draws it under all the turn did, so an answered question sits right over
 * its answer (HarnessV3-Views V6-14). A visual the agent drew never folds, live or settled (HarnessV4_Visuals_Plan
 * VC-41, VC-42): its frame moved in the page would draw again from its start. One drawn before the last text stands
 * between the work and that text (`pictures`), in the order drawn; one drawn after it stays where it is, after it.
 * @param {{ kind: string, block?: { type?: string, text?: string } }[]} segments
 * @param {{ live?: boolean, note?: { text?: string } | null }} [opts]
 * @returns {{ lastText: { kind: string, el?: any } | null, lead: any[], pictures: any[], fold: any[], after: any[], closing: { kind: string, el?: any } | null }}
 */
export function foldSplit(segments, { live = false, note = null } = {}) {
  const all = segments || [];
  const end = all.findLastIndex(isTextSegment);
  const own = end >= 0 && !!note?.text && all[end].block?.text === note.text ? all[end] : null;
  const words = !!own && end > 0 && isTextSegment(all[end - 1]);
  // Live, the note stands where it was said: under the words it closes, or as the answer. Settled, it closes the turn.
  const closing = live ? (words ? own : null) : own;
  const segs = closing ? all.filter((s) => s !== closing) : all;
  const at = closing ? (words ? end - 1 : -1) : end;
  const lastText = at >= 0 ? segs[at] : null;
  if (live) {
    const before = at >= 0 ? segs.slice(0, at) : segs;
    return { ...wordsStand(lastText, before.filter((s) => !isPicture(s)), [...(closing ? [closing] : []), ...(at >= 0 ? segs.slice(at + 1) : [])]), pictures: before.filter(isPicture), closing: null };
  }
  const rest = segs.filter((s) => s !== lastText);
  const later = new Set(at >= 0 ? segs.slice(at + 1) : []);
  // The website cards and the turn's files-changed summary (BUG-16) stay under the answer, never folded with the work;
  // so does a visual drawn after the answer's words.
  const outside = (/** @type {{ kind: string }} */ s) => s.kind === "web" || s.kind === "files" || (isPicture(s) && later.has(s));
  return { ...wordsStand(lastText, rest.filter((s) => !outside(s) && !isPicture(s)), rest.filter(outside)), pictures: rest.filter((s) => isPicture(s) && !later.has(s)), closing };
}

/**
 * A coding agent's own compaction that ended in the middle of a turn (a run's `compaction` event, `own`), not one that
 * failed: it stands where it happened, as a line of its own (the owner's words of 10-18: "it should sit where it
 * happened"). @param {any} k
 */
export const ownCompacted = (k) => !!k?.own && !k.result;

/**
 * A settled turn's fold, split where its coding agent compacted its own context (`compacted` segments, the owner's words
 * of 10-18) and where the agent's turn ended on a reply before Filament woke it within the turn (`replies`, wokeReplies:
 * a report written before a wait stood folded away with the work, the owner's of 11-05): the turn's fold holds the work
 * before the first line (`head`), and each line stands after it with the work that followed in a fold of its own
 * (`after`), so no line folds away with the work around it. A reply's line takes its round's box beside it (`with`) —
 * the message or the reports that woke the agent — and its round (`round`). A line before any work stands above the
 * turn's fold (`before`), a reply's box with it; one after the last work has no fold under it. The work folds apart
 * too after each box whose round read a message the person sent while it worked (`heard`): that part has no line of
 * its own (`line` null) — the page stands the message there, where the agent had it — and says its round and when
 * (`heard`). A turn of 1,125 rounds drew two messages read at rounds 50 and 100 right over its answer, after the work
 * of three hours and a report that came long after them (the owner's of 11-05). Pure.
 * @template {{ kind: string }} S
 * @param {readonly S[] | null | undefined} segments  the fold's, in order (foldSplit)
 * @param {Map<S, number> | null} [replies]  each reply's text segment, with its round (wokeReplies)
 * @param {Map<number, number> | null} [heard]  each round that read a message, with when (heardRounds)
 * @returns {{ before: S[], head: S[], after: { line: S | null, round?: number, heard?: number, with?: S[], segs: S[] }[] }}
 */
export function foldParts(segments, replies = null, heard = null) {
  /** @type {S[]} */
  const before = [];
  /** @type {S[]} */
  const head = [];
  /** @type {{ line: S | null, round?: number, heard?: number, with?: S[], segs: S[] }[]} */
  const after = [];
  /** A reply just placed, whose round's own box joins it where it comes next. @type {{ round: number, into: S[] } | null} */
  let open = null;
  for (const s of segments || []) {
    const box = /** @type {any} */ (s);
    if (open && s.kind === "cards" && box.round === open.round && (box.last ?? box.round) === open.round) {
      open.into.push(s);
      open = null;
      continue;
    }
    open = null;
    const r = replies?.get(s);
    if (s.kind !== "compacted" && r == null) {
      (after.at(-1)?.segs || head).push(s);
      // A round that read a message ends its box (cardBoxes): the box's last.
      const read = s.kind === "cards" ? Number(box.last ?? box.round) : NaN;
      const at = heard?.get(read);
      if (at != null) after.push({ line: null, round: read, heard: at, segs: [] });
    } else if (!head.length && !after.length) {
      before.push(s);
      if (r != null) open = { round: r, into: before };
    } else if (r == null) after.push({ line: s, segs: [] });
    else {
      /** @type {S[]} */
      const beside = [];
      after.push({ line: s, round: r, with: beside, segs: [] });
      open = { round: r, into: beside };
    }
  }
  return { before, head, after };
}

/**
 * The replies a settled turn's agent ended its turn on before Filament woke it within the turn — a `woke` round that
 * said words (alignEvents): each one's text segment, the last block before its round's cards (roundCardAnchor), with
 * its round. foldParts stands each outside the work. Pure.
 * @template {{ kind: string, block?: { type?: string } }} S
 * @param {readonly S[] | null | undefined} segments  the turn's, in order
 * @param {Map<number, any> | null | undefined} byRound
 * @returns {Map<S, number>}
 */
export function wokeReplies(segments, byRound) {
  const segs = segments || [];
  /** @type {Map<S, number>} */
  const out = new Map();
  /** @type {((round: number) => number) | null} */
  let anchorAt = null;
  for (const [r, c] of byRound || []) {
    if (!c?.woke || !c.said) continue;
    anchorAt ||= cardAnchors([...segs], byRound || new Map());
    const last = segs.slice(0, anchorAt(r)).findLast((s) => s.kind === "block");
    if (last && isTextSegment(last)) out.set(last, r);
  }
  return out;
}

/**
 * The rounds of a settled turn that read a message the person sent into its work — typed, or their answer Filament
 * relayed; never Filament's own note, a lead's or an agent's, which stand in the work alone — each with when the agent
 * had it (0 where the run never said): foldParts folds the work apart after each. Pure.
 * @param {Map<number, any> | null | undefined} byRound  alignEvents'
 * @returns {Map<number, number>}
 */
export function heardRounds(byRound) {
  /** @type {Map<number, number>} */
  const out = new Map();
  for (const [r, c] of byRound || [])
    for (const s of c?.steers || []) if (s.read && (!s.from || s.from === "developer")) out.set(r, Math.max(out.get(r) || 0, Number(s.readAt) || 0));
  return out;
}

/**
 * How long each fold of a settled turn's split work worked (foldParts), in ms, null where not known: the turn's own
 * fold from the turn's start (or the reply above it, `from`) to its first line, each later one from its line to the
 * next, the last to the turn's end. A reply's line stands from when the reply ended to when Filament woke the agent
 * (its round's `woke`), a compaction's from its start (`began`, else its `ms` before its end) to its end (`at`), a
 * message the agent had at once (`heard`). Pure.
 * @param {{ startedAt?: number, endedAt?: number }} turn
 * @param {{ line: any, round?: number, heard?: number }[]} after  foldParts' `after`
 * @param {Map<number, any> | null | undefined} byRound
 * @param {number | null} [from]  the round of a reply that stands above the turn's fold
 * @returns {(number | null)[]}  the turn's fold's, then each line's fold's
 */
export function partSpans(turn, after, byRound, from = null) {
  /** @param {{ line: any, round?: number, heard?: number }} p @returns {{ from: number, to: number } | null} */
  const stood = (p) => {
    if (p.heard != null) return p.heard > 0 ? { from: p.heard, to: p.heard } : null;
    const w = p.round != null ? byRound?.get(p.round)?.woke : null;
    if (w) return w.ended > 0 && w.at > 0 ? { from: w.ended, to: w.at } : null;
    const at = Number(p.line?.at);
    return p.round == null && at > 0 ? { from: Number(p.line.began) > 0 ? Number(p.line.began) : at - (Number(p.line.ms) || 0), to: at } : null;
  };
  const lines = after.map(stood);
  const start = from != null ? stood({ line: null, round: from })?.to ?? null : Number(turn.startedAt) || null;
  return [start, ...lines.map((l) => l?.to ?? null)].map((s, i) => {
    const end = i < lines.length ? lines[i]?.from ?? null : Number(turn.endedAt) || null;
    return s != null && end != null && end > s ? end - s : null;
  });
}

/**
 * A fold of a settled turn's split work in its header's words: "Worked for 3m 10s", or "Stopped after …" where the stop
 * ended it; its time left out where not known, or too short to say. @param {number | null} ms @param {boolean} [stopped]
 */
export function partWords(ms, stopped = false) {
  const span = ms != null && ms > 500 ? formatWorkedFor(ms) : "";
  return stopped ? (span ? `Stopped after ${span}` : "Stopped") : span ? `Worked for ${span}` : "Worked";
}

/** A visual the agent drew, or a page it published, among a turn's segments. @param {{ kind: string }} s */
const isPicture = (s) => s.kind === "visual" || s.kind === "artifact";

/**
 * A settled turn's cards of the saved agents its main agent asked (`asked` segments, HarnessV4_Tasks E15 step 3) apart
 * from the rest. They never fold with the work: each is a view the developer may overrule, so it stands between the
 * work and the answer, where the agent's decision follows it. `foldSplit` lays out the rest.
 * @template {{ kind: string }} S
 * @param {readonly S[] | null | undefined} segments
 * @returns {{ asked: S[], rest: S[] }}
 */
export function askedApart(segments) {
  const all = segments || [];
  return { asked: all.filter((s) => s.kind === "asked"), rest: all.filter((s) => s.kind !== "asked") };
}

/** A reply's text among a turn's segments. @param {{ kind: string, block?: { type?: string } }} s */
function isTextSegment(s) {
  return s.kind === "block" && s.block?.type === "text";
}

/**
 * The split as it stands: a fold of words alone becomes the lead, standing above the last text.
 * @param {any} lastText @param {any[]} fold @param {any[]} after
 */
function wordsStand(lastText, fold, after) {
  const words = fold.every(isTextSegment);
  return { lastText, lead: words ? fold : [], fold: words ? [] : fold, after };
}

/**
 * The steers the box under a turn shows (BUG-13): while the turn runs, only the messages still waiting for the loop —
 * one it has read is drawn in the flow, at the round that carried it; once the turn has settled, every message, kept
 * in view between the folded work and the reply.
 * @template {{ read?: boolean }} S
 * @param {readonly S[]} steers @param {boolean} live
 * @returns {S[]}
 */
export function boxSteers(steers, live) {
  return live ? (steers || []).filter((s) => !s.read) : [...(steers || [])];
}

/**
 * Where a round's cards splice into the turn's segments: with the round-start's `blocksBefore` anchor, after that
 * round's OWN blocks — right before the next anchored round's first block (or after the last block, for the final
 * round). Without an anchor (a round whose start the log no longer holds), the counting rule: after text block r,
 * sharing the last anchor when an archived reply folds its texts into one — never past the first block of a later
 * round that has one: a resumed turn runs the calls of the reply that asked in that reply's round, whose start is in
 * the asking turn's run, before its own first round. Pure; `placeCards` skips cards already sitting at the answer.
 * @param {{ kind: string, block?: { type?: string } }[]} segments
 * @param {Map<number, { blocksBefore?: number, said?: boolean, thought?: boolean }>} byRound  `said`, `thought`: the round
 *   said words, or thought (`alignEvents`)
 * @param {number} round
 * @returns {number}
 */
export function roundCardAnchor(segments, byRound, round) {
  return cardAnchors(segments, byRound)(round);
}

/**
 * `roundCardAnchor` for every round of a turn, from one reading of its segments and rounds: what it reads of them is
 * the same for each round, and read again per round it was the turn's cube (the owner's of 11-17: a long coding agent's
 * turn held the page 11 s placing its cards). → where round `round`'s cards splice into `segs` — the segments as they
 * stand now, which may hold cards, visuals and compactions spliced in since; never a block more or less than `segments`.
 * @param {{ kind: string, block?: { type?: string } }[]} segments
 * @param {Map<number, { blocksBefore?: number, said?: boolean, thought?: boolean }>} byRound
 * @returns {(round: number, segs?: { kind: string, block?: { type?: string } }[]) => number}
 */
export function cardAnchors(segments, byRound) {
  const blockSegs = (segments || []).filter((s) => s.kind === "block");
  const textBlocks = blockSegs.filter((s) => s.block?.type === "text");
  const cells = [...(byRound || new Map()).entries()];
  // The anchor counts the blocks the reply streamed, its thinking's included. A reply that holds none of the thinking
  // its run said — a coding agent's as the archive keeps it, its words alone, a block for each round that said any —
  // anchors a round at the rounds before it that said words; counted the live way, each anchor stood past its round,
  // further down the longer the turn ran (the owner's of 11-05: a message drawn rounds after it was read).
  const wordsAlone = cells.some(([, c]) => c?.thought) && !blockSegs.some((s) => s.block?.type === "thinking");
  // The rounds that said words, in order: how many came before a round is where it would stand among them.
  const said = wordsAlone ? cells.filter(([, c]) => c?.said).map(([r]) => r).sort((a, b) => a - b) : [];
  /** @param {number} r */
  const saidBefore = (r) => {
    let lo = 0;
    for (let hi = said.length; lo < hi; ) {
      const mid = (lo + hi) >> 1;
      if (said[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const starts = cells
    .filter(([, c]) => Number.isInteger(c?.blocksBefore))
    .map(([r, c]) => ({ r, at: wordsAlone ? saidBefore(r) : /** @type {number} */ (c.blocksBefore) }))
    .sort((x, y) => x.at - y.at || x.r - y.r);
  /** Each anchored round's place among `starts`. @type {Map<number, number>} */
  const placeOf = new Map(starts.map((s, i) => [s.r, i]));
  return (round, segs = segments || []) => {
    const mine = placeOf.get(round);
    if (mine !== undefined) {
      // The next round by ROUND, not by anchor: a round that streamed no blocks shares its anchor with the next
      // round, and splicing before a strictly-greater anchor would drop that round's cards past the next round's
      // text. An equal anchor IS the next round's first block — the right splice point. Every start before this
      // round's place has a lower anchor, or its anchor and an earlier round: the first after it to come later is it.
      let nextStart = null;
      for (let i = mine + 1; i < starts.length && !nextStart; i++) if (starts[i].r > round) nextStart = starts[i];
      if (nextStart && blockSegs[nextStart.at]) return segs.indexOf(blockSegs[nextStart.at]); // before the next round's first block
      const last = blockSegs[blockSegs.length - 1];
      return last ? segs.indexOf(last) + 1 : segs.length; // the final round: after the last block there is
    }
    const at = Math.min(round, textBlocks.length);
    const counted = at === 0 ? 0 : segs.indexOf(textBlocks[at - 1]) + 1;
    const later = starts.find((s) => s.r > round && blockSegs[s.at]);
    return later ? Math.min(counted, segs.indexOf(blockSegs[later.at])) : counted;
  };
}

/**
 * The line a folder's instruction file told stands under: "Told the agent src/ui/AGENTS.md, as it read src/ui/app.js".
 * @param {{ file: string, as: string, how: string }} t
 */
export const toldWords = (t) => `Told the agent ${t.file}, as it ${t.how === "edit" ? "edited" : t.how === "write" ? "wrote" : "read"} ${t.as}`;

/**
 * Whether a round draws a note under its calls: a plan, a hook, a report, a mark, a compaction, a veto, a steer the
 * loop read there — settled too, where it stands in the work (a box that took the next round in kept only that round's
 * notes, and the message left the work; the owner's of 11-05) — or (live) a compaction under way.
 * @param {any} cell @param {boolean} live
 */
export function roundNotes(cell, live) {
  return !!(cell?.plan?.length || cell?.hooks?.length || cell?.marks?.length || cell?.detaches?.length || cell?.looks?.length || cell?.reports?.length
    || cell?.envelopes?.length || cell?.opens?.length || cell?.envelopeNotes?.length || cell?.told?.length
    || cell?.compactions?.length || cell?.vetoed || (cell?.steers || []).some((/** @type {any} */ s) => s.read) || (live && cell?.compacting));
}

/**
 * Who an envelope is from, in the page's words (HarnessV4_Envelopes_Plan EN5): a team's or a flow's by its name, another
 * chat's letter by that chat's title (app/letters.js), the letter of the fork that weighed your message (the owner's
 * forked steer of 11-04), a sub-agent's letter or report by its description.
 * @param {{ description: string, via?: "team" | "flow" | "chat" | "steer" | "agent" }} e
 */
export const envelopeFrom = (e) =>
  e.via === "chat"
    ? `the chat “${e.description || "untitled"}”`
    : e.via === "steer"
      ? "the fork that weighed your message"
      : e.via === "agent" || !e.via
        ? e.description
          ? `“${e.description}”`
          : "another agent"
        : e.description || (e.via === "team" ? "a team beside this chat" : "a flow");

/** Whether an envelope is a letter: another chat's, the fork's that weighed your message, or a sub-agent's. @param {{ via?: string }} e */
const isLetter = (e) => e.via === "chat" || e.via === "steer" || e.via === "agent";

/**
 * Whose envelope an event says it is, where not a sub-agent's report: a team's, a flow's, or a letter — another chat's,
 * the fork's that weighed your message, or a sub-agent's.
 * @param {any} e @returns {{ via?: "team" | "flow" | "chat" | "steer" | "agent" }}
 */
const viaOf = (e) => (e?.via === "team" || e?.via === "flow" || isLetter(e ?? {}) ? { via: e.via } : {});

/** "envelope 3" or "envelopes 1, 2 and 4". @param {number[]} list */
const envelopesNamed = (list) => (list.length === 1 ? `envelope ${list[0]}` : `envelopes ${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);

/**
 * An envelope's card in words (EN5): its head — its number and who sent it — its subject, and how it stands: opened at
 * a step of its own run, by the agent's envelope tool or as it waited; else as the chat knows it now — opened in a later
 * turn, opened since (`sealed` false), or still sealed (`sealed` true, or not known yet). A card of a run drawn outside
 * the open chat — an agent's thread, whose envelopes are numbered in a session of its own — knows only its run
 * (`alone`). Pure.
 * @param {{ n: number, description: string, via?: "team" | "flow" | "chat" | "steer" | "agent", subject: string, opened: { round: number, by: "tool" | "wait" } | null }} e
 * @param {{ sealed?: boolean | null, later?: { turn: number, round: number, by: "tool" | "wait" } | null, alone?: boolean }} [now]
 * @returns {{ head: string, subject: string, state: string, opened: boolean }}
 */
export function envelopeWords(e, now = {}) {
  const head = `Envelope ${e.n} from ${envelopeFrom(e)}`;
  const how = (/** @type {string} */ by) => (by === "wait" ? ", as it waited" : "");
  const say = (/** @type {string} */ state, /** @type {boolean} */ opened) => ({ head, subject: e.subject || "", state, opened });
  if (e.opened) return say(`Opened at step ${e.opened.round + 1}${how(e.opened.by)}`, true);
  if (now.alone) return say("Not opened in this run", false);
  if (now.later) return say(`Opened in turn ${now.later.turn}, at step ${now.later.round + 1}${how(now.later.by)}`, true);
  if (now.sealed === false) return say("Opened later", true);
  return say("Sealed", false);
}

/**
 * The row where an envelope sealed in an earlier turn was opened (EN5). Pure.
 * @param {{ n: number, description: string, via?: "team" | "flow" | "chat" | "steer" | "agent", by: "tool" | "wait" }} o
 */
export const envelopeOpenedWords = (o) => `The agent opened envelope ${o.n}, from ${envelopeFrom(o)}${o.by === "wait" ? ", as it waited" : ""}: its ${isLetter(o) ? "letter" : "report"} joined the conversation here`;

/**
 * Filament's word on the envelopes still sealed (EN-D5, EN-D6): once as the turn would end, and the list said again with
 * the developer's message or after a coding agent compacted. Pure.
 * @param {{ kind: "reminder" | "list", at?: "start" | "compaction", envelopes: number[] }} k
 */
export function envelopeNoteWords(k) {
  const named = envelopesNamed(k.envelopes);
  if (k.kind === "reminder") return `Filament told the agent once that ${named} ${k.envelopes.length === 1 ? "is" : "are"} still sealed, as its turn would end`;
  return `Filament listed ${named} still sealed for the agent, ${k.at === "compaction" ? "after it compacted" : "with your message"}`;
}

/**
 * Which rounds share a cards box (HarnessV3-ACP AC1-6): a round whose cards land where the previous round's do —
 * nothing said or thought between them — joins its box, so calls fold across rounds as one round's do (an agent makes
 * one call per model call). A round that drew a note ends its box, and so does one that drew a visual, which stands
 * right after its box (HarnessV4_Visuals_Plan VC-41): everything keeps the order it happened in. So does a round a
 * card for sub-agents that change files was asked in (`ends`), whose answered line stands right after it. Pure.
 * @param {{ kind: string, block?: { type?: string } }[]} segments  the turn's segments, no cards among them
 * @param {Map<number, any>} byRound
 * @param {number[]} rounds  the rounds that draw a box, in order
 * @param {boolean} live
 * @param {readonly number[]} [ends]  rounds that end their box, drawn or not: no box spans one and a later round
 * @returns {number[][]}
 */
export function cardBoxes(segments, byRound, rounds, live, ends = []) {
  /** @type {number[][]} */
  const boxes = [];
  /** @type {{ round: number, at: number } | null} */
  let last = null;
  const anchorAt = cardAnchors(segments, byRound);
  for (const round of rounds) {
    const at = anchorAt(round);
    const box = boxes.at(-1);
    const prev = last;
    const ended = !!prev && ends.some((r) => r >= prev.round && r < round);
    if (box && last && last.at === at && !ended && !roundNotes(byRound.get(last.round), live) && !roundDrew(byRound.get(last.round))) box.push(round);
    else boxes.push([round]);
    last = { round, at };
  }
  return boxes;
}

/**
 * Whether a round drew a visual, or its model is writing one (HarnessV4_Visuals_Plan E16), or it published a page
 * (HarnessV4_Artifacts_Plan E18): its cards stand after its box. @param {any} cell
 */
export const roundDrew = (cell) => !!(cell?.visuals?.length || cell?.writing?.size || cell?.artifacts?.length);

/**
 * Rounds' cells as one box's (cardBoxes): their calls in order, each keeping its own round (an edit's diff is its
 * round's), and the last round's notes — the only round in a box that may have any — with that round (`notesRound`),
 * which keys their rows apart from another box's.
 * @param {any[]} cells
 */
export function mergedCell(cells) {
  if (cells.length === 1) return cells[0];
  /** @type {Map<string, any>} */
  const tools = new Map();
  /** @type {string[]} */
  const order = [];
  for (const c of cells)
    for (const id of c.order) {
      const t = c.tools.get(id);
      if (!t) continue;
      tools.set(id, { ...t, round: c.round });
      order.push(id);
    }
  return { ...cells.at(-1), round: null, notesRound: cells.at(-1).round, order, tools, planLater: cells.some((c) => c.planLater) };
}
