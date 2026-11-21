// @ts-check
// A Space's dashboards as the page says them (HarnessV4_Space_Plan S2 and S3, the mock "Space, grown" screens 6 to 10):
// each tab's name and state, the bar over a dashboard's page, a source's failure, the Keep sheet's lines — every word of
// it Filament's, read from what the dashboard's newest version reads, watches and runs, never the agent's —, and a
// button's sheet as its fields are typed. Pure: space/
// dashboards.js draws what these say; the tests run them alone. The dashboards are the server's
// (`GET /api/space/:project`'s `dashboards`, services/dashboard-runner.js `shown`).

/**
 * A source as last read: when, its failure and when, how many in a row, whether it stopped for them, how many rows.
 * @typedef {{ at: number, error: string | null, errorAt: number, fails: number, stopped: boolean, rows: number }} SourceRead
 * @typedef {{ connection: string, name: string, args: Record<string, unknown>, asks?: Record<string, string[]> }} Tool  a
 *   connection's tool (S4a); on a sheet, `asks`: the fields whose answer goes where the tool takes no text, by the types
 *   it takes
 * @typedef {{ on: string, only: Record<string, unknown> | null, except: Record<string, unknown> | null, command?: string[],
 *   tool?: Tool, check: Record<string, string>, ask: { name: string, choices: string[] | null, from: { source: string, column: string } | null }[],
 *   secondLook: boolean, effect?: "keeps" | "sends" }} GrantAction
 * @typedef {{ command: string[], args: { name: string, required: boolean, choices: string[] | null, pattern: string | null }[],
 *   effect: "reads" | "writes" | "sends" }} GrantTool  a tool it offers its Space's agents (the owner's of 11-05)
 * @typedef {{ sources: Record<string, Call & { every: number }>, watch: { from: string, rule: string,
 *   column: string, match: Record<string, unknown>, to: string, every: number }[], actions: Record<string, GrantAction>, secrets?: string[],
 *   hooks?: string[], tools?: Record<string, GrantTool> }} Grant
 * @typedef {{ name: string, title: string, type?: string, v: number, state: "kept" | "draft", keptV: number | null, liveV: number | null,
 *   from?: number | null, liveFrom?: number | null, draft: boolean, paused: boolean, keptAt: number | null, grant: Grant | null, newest: Grant,
 *   reads: { sources: Record<string, any>, watch: any[], actions: Record<string, any>, lanes?: any, tasks?: any, hooks?: Record<string, string>,
 *     tools?: Record<string, any>, glance?: string[] },
 *   fed?: { lanes: any, tasks: any } | null, looks: (number | null)[], sources: Record<string, SourceRead | null>, updatedAt: number,
 *   glance?: boolean, statuses?: number, pausedBy?: { chain: string, byName: string, line: string } | null,
 *   running?: { label: string, action: string, by: string | null } | null, allowed?: string[], changed?: string[],
 *   unrecorded?: true }} SpaceDashboard
 *   `glance`: shown on Your Space's At a glance; `statuses`: its live version's status tiles that read its own sources (S5b)
 *   `allowed`: its sends buttons agents may press without asking you (10-29)
 *   `changed`: the project's scripts its commands run that changed since it was kept, by their paths: nothing runs them
 *   until it is kept again; `unrecorded`: every one of them, as an earlier Filament kept it, which kept no record of them
 *   `pausedBy`: the chat whose agent paused it, with its line; `running`: a button running now, by whom where an agent
 *   pressed it (HarnessV4_AgentsSpace_Plan SA-D3)
 *   `draft`: its newest version reads nothing yet — never kept, or it changed what it reads since it was; `fed`: what
 *   the version that reads feeds into the Space (S4c), as its words give it
 */

/** A span in words: "2 min", "1 h", "90 s" (core's everyWords). @param {number} ms */
export const everyWords = (ms) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000} h` : ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 1000)} s`);

/** How long ago, in a bar's words: "40 s ago", "3 min ago", "2 h ago". @param {number} at @param {number} now */
export function agoWords(at, now) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/** A moment as a failure says it: "14:20", or "Oct 22 14:20" on another day. @param {number} at @param {number} now */
export function clockWords(at, now) {
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
}

/**
 * A command as the Keep sheet shows it, exactly: its parts, a part with a space or a quote quoted.
 * @param {string[]} argv
 */
export const commandWords = (argv) => argv.map((a) => (a === "" || /[\s"']/.test(a) ? JSON.stringify(a) : a)).join(" ");

/**
 * A connection's tool call as the sheets show it (S4a, core's toolWords): "github › list_workflow_runs {"owner":"o"}".
 * @param {Tool} t @param {unknown} [args]  its args filled, where they are
 */
export const toolWords = (t, args = t.args) =>
  `${t.connection} › ${t.name}${args && typeof args === "object" && Object.keys(args).length ? ` ${JSON.stringify(args)}` : ""}`;

/**
 * @typedef {{ url: string, headers?: Record<string, string>, as?: string }} FetchRead
 * @typedef {{ path: string, match?: string, depth?: number }} FolderRead
 * @typedef {{ script: string, args?: string[], with?: string[] }} PythonRead
 * @typedef {{ command?: string[], tool?: Tool, fetch?: FetchRead, folder?: FolderRead, filament?: string, python?: PythonRead }} Call
 *   what a source reads or a button runs: one of them (more reads, 10-29: a fetch, a folder, Filament's own rows, a
 *   Python script, beside a command and a tool)
 */
/** Filament's own rows a source reads, in the Keep sheet's words (core's FILAMENT_READS). */
export const FILAMENT_WORDS = Object.freeze({ board: "this Space's board", chats: "this project's chats", usage: "what this project's chats spent", places: "this project's folders and worktrees" });

/** What a source reads or a button runs, in words, as core's sourceWords says it. @param {Call} x */
export function callWords(x) {
  if (x.tool) return toolWords(x.tool);
  if (x.fetch) {
    const h = Object.keys(x.fetch.headers || {});
    return `GET ${x.fetch.url}${h.length ? ` with ${h.join(", ")}` : ""}${x.fetch.as === "rss" ? ", a feed" : x.fetch.as === "text" ? ", as text" : ""}`;
  }
  if (x.folder) return `the files in ${x.folder.path}${x.folder.match ? ` named ${x.folder.match}` : ""}${(x.folder.depth || 1) > 1 ? `, ${x.folder.depth} deep` : ""}`;
  if (x.filament) return `Filament's ${x.filament}`;
  if (x.python) return `python ${commandWords([x.python.script, ...(x.python.args || [])])}${x.python.with?.length ? ` with ${x.python.with.join(", ")}` : ""}, through uv`;
  return commandWords(x.command || []);
}
/** A call's kind. @param {Call} x */
export const callKind = (x) => (x.tool ? "tool" : x.fetch ? "fetch" : x.folder ? "folder" : x.filament ? "filament" : x.python ? "python" : "command");
/** How "It no longer …" says a call: calls a tool, fetches an address, lists a folder, reads Filament's, runs the rest. @param {Call} x */
const verbOf = (x) => ({ tool: "calls", fetch: "fetches", folder: "lists", filament: "reads" })[/** @type {"tool"} */ (callKind(x))] || "runs";
/** An address's host, as the Keep sheet names where a fetch goes. @param {string} url */
const hostOf = (url) => {
  try {
    return new URL(url.replace(/\{secret\.[A-Za-z0-9_]+\}/g, "x")).host;
  } catch {
    return url;
  }
};

/** A watch's match in words: "where status is failure and branch is main". @param {Record<string, unknown>} match */
const matchWords = (match) => {
  const parts = Object.entries(match || {}).map(([c, v]) => `${c} is ${v === null ? "empty" : String(v)}`);
  return parts.length ? ` where ${parts.join(" and ")}` : "";
};

/**
 * A watch's rule in words: "A new row of runs where status is failure", "deploys' first version changes".
 * @param {{ from: string, rule: string, column: string, match: Record<string, unknown> }} w
 */
export const ruleWords = (w) => (w.rule === "new" ? `A new row of ${w.from}${matchWords(w.match)}` : `The first row's ${w.column} of ${w.from} changes${matchWords(w.match)}`);

/** Whether a source failed at its last read. @param {SourceRead | null | undefined} s */
const failed = (s) => !!s?.error && (s.errorAt || 0) >= (s.at || 0);

/**
 * Each source of a dashboard that failed at its last read, in the words its tab says (the mock's screen 9): when, what
 * the program said, the rows it keeps and when they were read, whether it stopped, and which of its other sources read.
 * @param {SpaceDashboard} d @param {number} now
 * @returns {{ source: string, head: string, said: string, kept: string }[]}
 */
export function faultsOf(d, now) {
  const all = Object.entries(d.sources || {});
  return all.flatMap(([source, s]) => {
    if (!s || !failed(s)) return [];
    const fine = all.filter(([o, r]) => o !== source && r?.at && !failed(r)).map(([o]) => o);
    const others = fine.length === 1 ? ` Its other source, ${fine[0]}, reads fine.` : fine.length ? ` Its other sources, ${fine.slice(0, -1).join(", ")} and ${fine.at(-1)}, read fine.` : "";
    const kept = s.at ? `Showing what it read at ${clockWords(s.at, now)}.` : "It has read nothing yet.";
    const stopped = s.stopped ? ` It stopped after ${s.fails} failures in a row: Read again runs it now.` : "";
    return [{ source, head: `Couldn't read ${source} at ${clockWords(s.errorAt, now)}`, said: String(s.error), kept: `${kept}${stopped}${others}` }];
  });
}

/**
 * Whether a dashboard's sources read now: not paused, and kept — a draft beside a kept version, that one reads on.
 * @param {SpaceDashboard} d
 */
export const readsNow = (d) => !d.paused && (!d.draft || (d.state === "kept" && !!d.liveV));

/**
 * The version a broken page's line offers to go back to (the Space Apps plan of 10-29): the one before the version its
 * tab shows — its live one beside a draft (See v2), else its newest —; none where that is its first. One a Back made
 * (`from`, the version it copies) goes back past what it copies: the one before is the broken one it left (found
 * reviewing the Space work: Back offered it again, and two presses went to and fro).
 * @param {SpaceDashboard} d @param {boolean} seeLive
 */
export function backOf(d, seeLive) {
  const live = !!(seeLive && d.liveV);
  const shown = live ? /** @type {number} */ (d.liveV) : d.v;
  const base = (live ? d.liveFrom : d.from) ?? shown;
  return base > 1 ? base - 1 : null;
}

/**
 * A dashboard's tab in the strip: its name, its state — a draft dashed, a paused one said, a failure a red dot with
 * its words in the tip: its live version's, beside a draft too (found by the Hunter on S2: a failing source went
 * unsaid while a newer draft waited). `held`: scripts it runs wait for a Keep, which its tip says first — no failure.
 * @param {SpaceDashboard} d @param {number} now
 */
export function tabOf(d, now) {
  const faults = readsNow(d) ? faultsOf(d, now) : [];
  const held = readsNow(d) && !!d.changed?.length;
  const label = d.draft ? `${d.title} · draft` : d.paused ? `${d.title} · paused` : d.title;
  const tip = faults.length || held
    ? [...(held ? [heldWords(d)] : []), ...faults.map((f) => `${f.head}: ${f.said}`)].join("\n")
    : d.draft
      ? d.state === "kept"
        ? `v${d.v} changes what it reads, watches or runs: it is a draft until you keep it again${d.paused ? "; paused, nothing of it runs until you resume it" : ""}`
        : "A draft: nothing reads or runs until you keep it"
      : d.paused
        ? "Paused: nothing of it runs"
        : `Live: v${d.liveV ?? d.v}, kept`;
  return { label, tip, draft: d.draft, paused: d.paused && !d.draft, fault: faults.length > 0, held };
}

/**
 * The bar over a dashboard's page: what it is now, in words — "Live · read 40 s ago", a draft, paused — and the press it
 * offers: Refresh, Keep…, Resume, Stop for a button running; beside a draft, its live version to see (`live`: that one
 * shown), or the draft.
 * @param {SpaceDashboard} d @param {number} now @param {boolean} [live]
 * @returns {{ tone: "live" | "draft" | "paused" | "fault", words: string, press: "refresh" | "keep" | "resume" | "stop" | "none",
 *   see: { to: "live" | "draft", label: string, tip: string } | null }}
 */
export function barOf(d, now, live = false) {
  // A kept one whose newest is a draft: its live version reads on beside it, and either is shown (See v2, See v3).
  const beside = d.draft && d.state === "kept" && d.liveV ? d.liveV : null;
  const seeLive = !!beside && live;
  const see = !beside
    ? null
    : seeLive
      ? { to: /** @type {const} */ ("draft"), label: `See v${d.v}`, tip: `v${d.v}, the draft: it reads nothing until you keep it` }
      : { to: /** @type {const} */ ("live"), label: `See v${beside}`, tip: `v${beside} as it reads now, beside the draft` };
  // A failing source by its own last good read (screen 9: "deploys not read since 14:08").
  const faults = (readsNow(d) ? faultsOf(d, now) : []).map((f) => {
    const at = d.sources[f.source]?.at || 0;
    return at ? `${f.source} not read since ${clockWords(at, now)}` : `${f.source} not read yet`;
  });
  if (d.draft && !seeLive) {
    const again = d.state === "kept";
    // Beside the draft, a live version whose scripts wait for the Keep (found by the review of 10-31: its watches were
    // said to go on), or that fails, says so (found by the Hunter on S2).
    if (beside && !d.paused && d.changed?.length) return { tone: "fault", words: `Draft · v${d.v} changes what it reads, watches or runs · v${beside}: ${heldWords(d)}`, press: "keep", see };
    if (beside && faults.length) return { tone: "fault", words: `Draft · v${d.v} changes what it reads, watches or runs · v${beside}: ${faults.join(" · ")}`, press: "keep", see };
    return {
      tone: "draft",
      words: again
        ? `Draft · v${d.v} changes what it reads, watches or runs · ${d.paused ? "paused: nothing of it runs, kept again or not, until you resume it" : `v${d.liveV ?? d.keptV}'s watches go on until you keep it`}`
        : d.type === "app"
          ? "Draft · nothing reads or runs until you keep it"
          : "Draft · sample rows the agent read · nothing reads or runs until you keep it",
      press: "keep",
      see,
    };
  }
  const at = seeLive ? `v${beside} · ` : "";
  // A button running — the person's or an agent's press (HarnessV4_AgentsSpace_Plan SA-D3) — with Stop.
  if (d.running && !d.paused) return { tone: "live", words: `${at}“${d.running.label}” is running${d.running.by ? ` · pressed by ${d.running.by}` : ""}`, press: "stop", see };
  // Paused by an agent, its bar says who and why; yours reads as ever.
  if (d.paused) return { tone: "paused", words: `${at}${d.pausedBy ? `Paused by ${d.pausedBy.byName || "an agent"}: ${d.pausedBy.line}` : "Paused"} · nothing of it reads or runs`, press: "resume", see };
  // A script it runs changed since it was kept — or an earlier Filament kept it, which kept no record of them —: nothing
  // runs that until you keep it again, which its Keep… does.
  if (d.changed?.length) return { tone: "fault", words: `${at}${heldWords(d)}`, press: "keep", see };
  const reads = Object.values(d.sources || {}).filter((s) => s && s.at).map((s) => /** @type {SourceRead} */ (s).at);
  if (faults.length) return { tone: "fault", words: `${at}${faults.join(" · ")}`, press: "refresh", see };
  // An app that reads nothing but takes POSTs (phase 4): nothing to refresh (found driving it).
  const g = d.grant || d.newest;
  if (!Object.keys(g.sources).length && g.hooks?.length) return { tone: "live", words: `${at}Live · takes POSTs into ${andWords(g.hooks)}`, press: "none", see };
  return { tone: "live", words: `${at}Live · ${reads.length ? `read ${agoWords(Math.max(...reads), now)}` : "not read yet"}`, press: "refresh", see };
}

/** Names in words: "a", "a and b", "a, b and c". @param {string[]} names */
const andWords = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
/** Scripts changed since the Keep, in the bar's words. @param {string[]} paths */
export const changedWords = (paths) =>
  `${andWords(paths)} changed since ${paths.length > 1 ? "they were" : "it was"} kept · nothing runs ${paths.length > 1 ? "them" : "it"} until you keep it again`;
/**
 * Why its scripts wait for a Keep, in the bar's words: changed since it was kept, or it was kept by an earlier Filament,
 * which kept no record of them — none, or, of 10-30, lost at its next start —, each one listed in its Keep sheet.
 * @param {Pick<SpaceDashboard, "changed" | "unrecorded">} d
 */
export const heldWords = (d) =>
  d.unrecorded ? "Kept by an earlier Filament, which kept no record of the scripts it runs · nothing runs them until you keep it again" : changedWords(d.changed || []);

/** A watch's own name as its words give it (core's watchKeyOf over watchKept). @param {any} w */
const rawKey = (w) => `${w?.from}|${w?.new === true ? "new" : "changes"}|${w?.new === true ? "" : String(w?.changes)}|${JSON.stringify(w?.match && typeof w.match === "object" ? w.match : {})}`;
/** @param {{ from: string, rule: string, column: string, match: Record<string, unknown> }} w */
const grantKey = (w) => `${w.from}|${w.rule}|${w.column}|${JSON.stringify(w.match)}`;

/**
 * The Keep sheet's buttons, by what they do (the Space Apps plan of 10-29): each group's heading and the note under it.
 * @type {readonly { effect: "keeps" | "writes" | "sends", head: string, note: string }[]}
 */
export const PRESS_GROUPS = Object.freeze([
  { effect: "keeps", head: "Does at once when you press", note: "It changes the app's own data alone: it runs as you press it, with no sheet." },
  { effect: "writes", head: "Does when you press", note: "Nothing of it runs by itself: each press opens Filament's sheet, which shows what it runs, filled from the row, before it runs." },
  {
    effect: "sends",
    head: "Sends when you press — it leaves this machine",
    note: "Each press opens Filament's sheet first. An agent's press of one always asks you, whatever its chat's mode, unless you let agents press it in What it may do.",
  },
]);

/**
 * The Keep sheet's lines (the mock's screen 7), every one from the newest version — or, read-only, from what was kept:
 * each command, exactly, where it runs and how often; each watch's rule, its words and how often; each button's
 * command, on which rows, what it asks and its checks (S3). A line that the kept version did not grant is marked new;
 * what the kept version granted and this one drops is said too, and each script its commands run that changed since.
 * @param {SpaceDashboard} d @param {string} folder  the project's folder, where its commands run
 * @param {{ kept?: boolean }} [o]  `kept`: what the kept version may do, as What it may do shows it
 */
export function keepLines(d, folder, { kept: asKept = false } = {}) {
  const shown = asKept && d.grant ? d.grant : d.newest;
  const kept = !asKept && d.state === "kept" ? d.grant : null;
  /** Each watch's words, by its own name. */
  const says = new Map((d.reads?.watch || []).map((w) => [rawKey(w), String(w?.says || "")]));
  /** How often a watch reads each source, the most often. @type {Map<string, number>} */
  const watched = new Map();
  for (const w of shown.watch) watched.set(w.from, Math.min(watched.get(w.from) ?? Infinity, w.every));
  const reads = Object.entries(shown.sources).map(([source, s]) => {
    const was = kept?.sources[source];
    const w = watched.get(source);
    return {
      source,
      command: callWords(s),
      // A tool is read through its connection, a command in the project's folder (S4a); an address from its host, a
      // folder of the project listed, Filament's own rows, a script through uv (more reads, 10-29).
      kind: callKind(s),
      tool: s.tool ? { connection: s.tool.connection, name: s.tool.name } : null,
      host: s.fetch ? hostOf(s.fetch.url) : "",
      headers: s.fetch ? Object.entries(s.fetch.headers || {}).map(([k, v]) => `${k}: ${v}`) : [],
      filament: s.filament ? FILAMENT_WORDS[/** @type {keyof typeof FILAMENT_WORDS} */ (s.filament)] || s.filament : "",
      folder,
      every: `every ${everyWords(s.every)} while you look at it${w ? `; every ${everyWords(w)} otherwise, for its watch` : ""}`,
      // What it reads changed at all — a fetch's header, a script's packages —, not only its words.
      isNew: !!kept && (!was || JSON.stringify(was) !== JSON.stringify(s)),
    };
  });
  const keptWatch = new Set((kept?.watch || []).map((w) => JSON.stringify(w)));
  const tells = shown.watch.map((w) => ({
    rule: ruleWords(w),
    says: says.get(grantKey(w)) || "",
    // S5a: a watch may write a row in Needs you instead.
    to: w.to === "needs-you" ? "Needs you" : "What happened",
    every: `looks every ${everyWords(w.every)}, in the background`,
    isNew: !!kept && !keptWatch.has(JSON.stringify(w)),
  }));
  // A button's words — its label, its fields' — are the newest's; what it runs is the grant's.
  const words = d.reads?.actions || {};
  const presses = Object.entries(shown.actions).map(([name, a]) => {
    const own = words[name];
    const was = kept?.actions[name];
    return {
      name,
      label: String(own?.label || name),
      command: callWords(a),
      tool: a.tool ? { connection: a.tool.connection, name: a.tool.name } : null,
      folder,
      rows: `On ${a.only ? "the rows" : "each row"} of ${a.on}${a.only ? matchWords(a.only) : ""}${a.except ? `, except${matchWords(a.except)}` : ""}`,
      asks: a.ask.map((f) => {
        const label = (Array.isArray(own?.ask) ? own.ask : []).find((/** @type {any} */ x) => x?.name === f.name)?.label || f.name;
        return `asks ${label}${f.choices ? `: one of ${f.choices.join(", ")}` : f.from ? `: one of ${f.from.source}'s ${f.from.column} now` : ""}`;
      }),
      checks: Object.entries(a.check).map(([p, re]) => `{${p}} must match ${re}`),
      // S3b: its sheet offers the Reviewer's look before you run it — started as you ask, never by itself (the owner's
      // word of 10-31).
      second: a.secondLook ? "offers a second look: Filament's Reviewer, which only reads, when you ask for one on its sheet, on the model you choose" : "",
      isNew: !!kept && (!was || JSON.stringify(was) !== JSON.stringify(a)),
      // What it does (10-29), which the sheet groups them by; a sends button agents may press without asking you.
      effect: a.effect || "writes",
      allowed: (d.allowed || []).includes(name),
    };
  });
  // The tools it offers this Space's agents (the owner's of 11-05): each command exactly, the arguments an agent fills it
  // with and their bounds, and what it does — the words its builder wrote beside them.
  const toolWords = d.reads?.tools || {};
  const tools = Object.entries(shown.tools || {}).map(([name, t]) => {
    const was = kept?.tools?.[name];
    return {
      name,
      about: String(toolWords[name]?.description || ""),
      command: commandWords(t.command),
      folder,
      args: t.args.map((x) => `${x.name}${x.required ? "" : " (may be left out)"}${x.choices ? `: one of ${x.choices.join(", ")}` : x.pattern ? `: must match ${x.pattern}` : ""}`),
      effect: t.effect,
      isNew: !!kept && (!was || JSON.stringify(was) !== JSON.stringify(t)),
    };
  });
  const fed = asKept ? d.fed : d.reads;
  const shows = feedShows(fed?.lanes, fed?.tasks);
  const newWatch = new Set(shown.watch.map((w) => JSON.stringify(w)));
  const gone = kept
    ? [
        ...Object.entries(kept.sources).filter(([s]) => !shown.sources[s]).map(([, s]) => `It no longer ${verbOf(s)} ${callWords(s)}`),
        ...kept.watch.filter((w) => !newWatch.has(JSON.stringify(w))).map((w) => `It no longer watches: ${ruleWords(w)}`),
        ...Object.entries(kept.actions).filter(([n]) => !shown.actions[n]).map(([n, a]) => `It no longer has the button ${n}: ${callWords(a)}`),
        ...(kept.secrets || []).filter((n) => !(shown.secrets || []).includes(n)).map((n) => `Its commands no longer get your ${n}`),
        ...(kept.hooks || []).filter((n) => !(shown.hooks || []).includes(n)).map((n) => `It no longer takes POSTs into ${n}: that address stops`),
        ...Object.entries(kept.tools || {}).filter(([n]) => !shown.tools?.[n]).map(([n, t]) => `It no longer offers agents the tool ${n}: ${commandWords(t.command)}`),
      ]
    : [];
  // Its secrets (10-29), by name: what its commands get in their environment once you type each in Secrets….
  const secrets = (shown.secrets || []).map((name) => ({ name, isNew: !!kept && !(kept.secrets || []).includes(name) }));
  // Its hooks (phase 4): each collection a POST from this computer lands in, with its builder's line on what sends there.
  const about = d.reads?.hooks || {};
  const hooks = (shown.hooks || []).map((name) => ({ name, about: String(about[name] || ""), isNew: !!kept && !(kept.hooks || []).includes(name) }));
  // The scripts its commands run that changed since it was kept — every one, where an earlier Filament kept it, which
  // kept no record of them (`unrecorded`) —: a Keep takes each as it is now.
  const changed = d.state === "kept" ? [...(d.changed || [])] : [];
  return { reads, tells, presses, tools, gone, shows, secrets, hooks, changed, unrecorded: changed.length > 0 && d.unrecorded === true };
}

/**
 * Show on Home's words in a kept one's ⋯ (S5b): a dashboard's status tiles, in its tab's words; an app's glance (phase
 * 3), its lines by their titles — or why it has nothing to show there.
 * @param {SpaceDashboard} d @param {number} statuses  its live version's status lines that read its own sources
 */
export function glanceMenuWords(d, statuses) {
  if (d.type === "app") {
    const titles = d.reads?.glance || [];
    return statuses ? `Its glance in Home's At a glance${titles.length ? `: ${titles.join(", ")}` : ""}` : "It has no glance: an agent adds one (glance, status lines over its sources)";
  }
  return statuses
    ? `Its ${statuses === 1 ? "status tile" : `${statuses} status tiles`} in Home's At a glance, in this tab's words`
    : "It has no status tile reading its own sources: At a glance shows those";
}

/**
 * A hook's line in What it may do (phase 4): how many records it keeps, and since when its address is the one.
 * @param {{ records: number, at: number | null, paused?: boolean }} x @param {number} now
 */
export function hookWords(x, now) {
  const kept = `${x.records ? `${x.records} record${x.records === 1 ? "" : "s"} kept` : "nothing posted yet"}`;
  return `${kept}${x.at ? ` · address made ${agoWords(x.at, now)}` : ""}${x.paused ? " · paused: a POST is refused until you resume it" : ""}`;
}

/** How many cards one dashboard puts on the board (core's FED_TASKS_MAX). */
export const FED_TASKS_MAX = 50;

/**
 * What a dashboard feeds into its Space, as the Keep sheet says it (S4c): a line on each lane a row's branch names, a
 * card on the board per row — from its words, which the publish checked. They run nothing: rows it reads anyway.
 * @param {any} lanes @param {any} tasks @returns {{ words: string, more: string }[]}
 */
export function feedShows(lanes, tasks) {
  const text = (/** @type {unknown} */ v) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const vals = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.map(String).join(" or ") : "");
  /** @type {{ words: string, more: string }[]} */
  const out = [];
  if (lanes && typeof lanes === "object" && text(lanes.from) && text(lanes.branch) && text(lanes.words)) {
    const tone = (/** @type {string} */ c, /** @type {unknown} */ m) => (m && typeof m === "object" && !Array.isArray(m) && Object.keys(m).length ? [`${c}${matchWords(/** @type {Record<string, unknown>} */ (m))}`] : []);
    out.push({
      words: `A line on the lane of each branch a row of ${text(lanes.from)} names (its ${text(lanes.branch)}): “${text(lanes.words)}”`,
      more: ["its first row for the branch", ...tone("red", lanes.bad), ...tone("green", lanes.good)].join(" · "),
    });
  }
  if (tasks && typeof tasks === "object" && text(tasks.from) && text(tasks.title)) {
    const col = text(tasks.column);
    const where = (/** @type {string} */ name, /** @type {unknown} */ v) => (col && vals(v) ? [`${name} where ${col} is ${vals(v)}`] : []);
    const placed = [...where("Doing", tasks.doing), ...where("Waits", tasks.waits), ...where("Done", tasks.done)];
    out.push({
      words: `A card on the board for each row of ${text(tasks.from)}, titled by its ${text(tasks.title)}`,
      more: [
        ...(text(tasks.line) ? [`its ${text(tasks.line)} under it`] : []),
        ...placed,
        placed.length ? "Planned otherwise" : "each in Planned",
        `${FED_TASKS_MAX} at most`,
        "they are its, not the board's: they go when it does",
      ].join(" · "),
    });
  }
  return out;
}

/**
 * What a kept dashboard's foot says it reads: "Reads deploys and runs · v3, kept Oct 24 14:05" — of its live version
 * where that is shown beside a draft (`live`).
 * @param {SpaceDashboard} d @param {number} now @param {boolean} [live]
 */
export function footOf(d, now, live = false) {
  const seeLive = live && d.draft && d.state === "kept" && !!d.liveV && !!d.grant;
  const g = seeLive && d.grant ? d.grant : d.newest;
  const names = Object.keys(g.sources);
  // What it does by itself: its reads, and the POSTs it takes (phase 4) — "read" as a draft would, "Reads" as it does.
  /** @param {boolean} would */
  const does = (would) =>
    [names.length ? `${would ? "read" : "reads"} ${andWords(names)} by itself` : "", g.hooks?.length ? `${would ? "take" : "takes"} POSTs into ${andWords(g.hooks)}` : ""].filter(Boolean).join(" and ") ||
    (would ? "read by itself" : "reads by itself");
  if ((d.draft && !seeLive) || d.state !== "kept") return `Would ${does(true)}, once you keep it`;
  const kept = `v${d.liveV ?? d.v}, kept ${d.keptAt ? clockWords(d.keptAt, now) : ""}`.trim();
  const said = does(false);
  const Said = `${said[0].toUpperCase()}${said.slice(1)}`;
  return d.paused ? `${Said} once you resume it · ${kept}` : `${Said} · ${kept}`;
}

/**
 * A typed answer as a tool that takes no text there takes it (core's textAs): "8812" a number, "true" a boolean; else
 * the text. @param {string} s @param {string[]} types @returns {unknown}
 */
function answerAs(s, types) {
  if (!types.length || types.includes("string")) return s;
  const t = s.trim();
  if (types.includes("integer") && /^-?\d+$/.test(t) && Number.isSafeInteger(Number(t))) return Number(t);
  if (types.includes("number") && /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (types.includes("boolean") && (t === "true" || t === "false")) return t === "true";
  return s;
}

/** A JSON value with each text put through `fill`, however deep. @param {unknown} v @param {(s: string) => unknown} fill @returns {unknown} */
const textsFilled = (v, fill) =>
  typeof v === "string"
    ? fill(v)
    : Array.isArray(v)
      ? v.map((x) => textsFilled(x, fill))
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, textsFilled(x, fill)]))
        : v;

/**
 * A button's sheet as its fields are typed (S3, screen 10): its sentence's first line as the title and the rest under
 * it, each field's placeholder its answer — its name in ‹ › while empty —, its command as it will run — or its tool
 * call, its args filled (S4a) — and where, and whether each needed field is filled.
 * @param {{ says: string, command: string[], tool?: Tool | null, folder?: string | null, ask: { name: string, required: boolean }[] }} look
 *   the sheet as it opened
 * @param {Record<string, string>} answers  the fields as typed
 */
export function pressWords(look, answers) {
  /** @param {string} s */
  const fill = (s) => s.replace(/\{ask\.([A-Za-z0-9_-]+)\}/g, (_, f) => answers[f] || `‹${f}›`);
  const asks = look.tool?.asks || {};
  /** A tool's arg: an answer that is the whole value, as the tool takes it there. @param {string} s */
  const fillArg = (s) => {
    const m = /^\{ask\.([A-Za-z0-9_-]+)\}$/.exec(s);
    return m && asks[m[1]] && answers[m[1]] ? answerAs(answers[m[1]], asks[m[1]]) : fill(s);
  };
  const said = fill(look.says);
  const m = /^(.+?[?.!])\s+(\S[\s\S]*)$/.exec(said);
  return {
    title: m ? m[1] : said,
    rest: m ? m[2] : "",
    command: look.tool ? toolWords(look.tool, textsFilled(look.tool.args, fillArg)) : commandWords(look.command.map(fill)),
    where: look.tool ? `through ${look.tool.connection}, as this project's chats reach it` : `in ${look.folder || "its project's folder"}`,
    ready: look.ask.every((f) => !f.required || !!String(answers[f.name] || "").trim()),
  };
}
