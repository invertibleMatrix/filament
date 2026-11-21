// @ts-check
// Apply in its own words (the Designer's of 10-27, on the owner's: "what is the criteria of showing that Apply button,
// what about merge conflicts, what does that apply button even do behind the scene. is it worktree copying files or
// what"). One place for what the agents band, an agent's thread, its card and its mark say of a sub-agent's work: where
// it works, what it does now, what its Apply would do before the press (a dry run's), what it did after, and how Apply
// works. One word for one act: apply; "merged" only for a file merged with the developer's own edits.

/** @typedef {import("./subagents.js").SubagentRow} SubagentRow */
/**
 * How a file came in, or would: as it left it, merged with your edits, deleted, already the same — or, by your choice on
 * a file that overlapped yours (the Designer's of 10-27, built 10-28), yours kept, its taken, or both with markers.
 * @typedef {{ path: string, how: "took" | "merged" | "deleted" | "same" | "kept" | "replaced" | "markers" }} Came
 */
/**
 * What stops a file: its lines overlap yours; it deleted one you changed; it changed one you deleted; you both added
 * one; a binary you both changed; something of yours in its place; one git could not read.
 * @typedef {"lines" | "deleted" | "gone" | "added" | "binary" | "place" | "unread"} ConflictKind
 */
/** @typedef {"yours" | "its" | "both"} Choice */
/** @typedef {{ path: string, why: string, kind?: ConflictKind, overlaps?: number, choices?: readonly Choice[] }} Conflict */
/** @typedef {{ took: number, merged: string[], deleted: number, same: number, kept?: string[], replaced?: string[], markers?: string[] }} CameCount */
/** One overlap as Compare shows it: its line in your file, your lines, the lines at its start, its own. @typedef {{ at: number, yours: string[], start: string[], its: string[] }} Overlap */

/** @param {number} n @param {string} one @param {string} [many] */
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A path's last part: "now.js". @param {string} p */
export const leaf = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || String(p || "");
/** Names, three at most, the rest counted: "now.js, list.js and 2 more". @param {string[]} paths */
const names = (paths) => {
  const shown = paths.slice(0, 3).map(leaf);
  const rest = paths.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown.join("");
};

/**
 * Who applied it, in the developer's words. `reason`: Filament's check of it had failed and it went in anyway (TG2-D45),
 * so its check is not said to have passed (the Hunter's of 10-28).
 * @param {string} by @param {string | null} [reason]
 */
export const byWords = (by, reason = null) => (by === "owner" ? "you" : by === "agent" ? "your agent" : by === "command" ? "your command" : by === "graph" ? (reason ? "Filament, past a failed check" : "Filament, its check passed") : "filament");

/** @param {Came[]} came @returns {CameCount} */
export const counted = (came) => {
  const named = (/** @type {Came["how"]} */ how) => came.filter((c) => c.how === how).map((c) => c.path);
  return { took: named("took").length, merged: named("merged"), deleted: named("deleted").length, same: named("same").length, kept: named("kept"), replaced: named("replaced"), markers: named("markers") };
};

/**
 * The choices each kind of overlap offers, as Filament's apply takes them: both with markers only where lines overlap,
 * its version where there is one to take or a delete to make, and yours always.
 * @type {Readonly<Record<ConflictKind, readonly Choice[]>>}
 */
export const CHOICES_OF = Object.freeze({ lines: ["yours", "its", "both"], deleted: ["yours", "its"], gone: ["yours", "its"], added: ["yours", "its"], binary: ["yours", "its"], place: ["yours"], unread: ["yours"] });
/** The choices a file that stops an apply offers. @param {Conflict} c @returns {readonly Choice[]} */
export const choicesFor = (c) => (c.choices?.length ? c.choices : CHOICES_OF[c.kind || "unread"] || ["yours"]);

/** What stops a file, said of it: "2 changes overlap yours", "it deleted it; you changed it since". @param {Conflict} c */
export function kindWords(c) {
  if (c.kind === "deleted") return "it deleted it; you changed it since";
  if (c.kind === "gone") return "it changed it; you deleted it since";
  if (c.kind === "added") return "you both added it, not the same";
  if (c.kind === "binary") return "a binary file you both changed";
  return c.why;
}

/** A choice's label, as its kind says it: "Keep yours", "Delete it", "Both, with markers". @param {ConflictKind | undefined} kind @param {Choice} choice */
export function choiceLabel(kind, choice) {
  if (choice === "both") return "Both, with markers";
  if (choice === "yours") return kind === "gone" ? "Keep it deleted" : kind === "place" || kind === "unread" ? "Keep yours, apply it by hand" : "Keep yours";
  return kind === "deleted" ? "Delete it" : "Take its";
}

/**
 * What a choice does to its file, said under it: "Your edits to now.js since 14:02 are replaced." `since`: when the
 * sub-agent started — its copy is your folder as it was then.
 * @param {Conflict} c @param {Choice} choice @param {string} [since]
 */
export function choiceEffect(c, choice, since = "") {
  const f = leaf(c.path);
  if (choice === "both") return `${f} is written with both — git's conflict markers (<<<<<<<) around each overlap — for you to resolve. Your agent is told to leave it alone.`;
  if (choice === "yours") return c.kind === "place" || c.kind === "unread" ? `Nothing is written to ${f}: bring its change over by hand.` : c.kind === "gone" ? `${f} stays deleted; its change to it is dropped.` : `Its change to ${f} is dropped.`;
  if (c.kind === "deleted") return `${f} is deleted, and your edits to it with it.`;
  if (c.kind === "gone") return `${f} comes back as it left it.`;
  return `Your edits to ${f}${since ? ` since ${since}` : ""} are replaced.`;
}

/**
 * What Send back to rebase does, said beside it (the Designer's of 10-27). @param {string} model  its model's name
 */
export const rebaseWords = (model) =>
  `It redoes its change on your folder as it is now: a fresh copy with its change brought in and the overlaps marked, which it resolves and checks. Its work then waits again. One more run${model ? ` on ${model}` : ""}.`;

/** A dry run older than this is read again, by the band and an agent's thread alike: the developer's own edits move what it says. */
export const PREVIEW_MS = 15_000;

/** Why the Apply block is there: its work is in its copy alone. */
export const WHY_WAITS = "It worked in its own copy, so your folder has none of this yet.";
/** An agent that worked in the developer's folder has no Apply. */
export const SHARED_DONE = "Its changes are in your folder already.";
/**
 * What a sub-agent made or changed in its copy on another machine that stayed there when its change was brought here
 * (the review of 11-11: never said): by why, each with how many and their paths, three at most a why — "a secret's
 * file by its name: 1 (.env.local)". Names and reasons, never what a file holds; "" where nothing stayed.
 * @param {readonly { path: string, why: string }[] | null | undefined} left
 */
export const leftWords = (left) => {
  /** @type {Map<string, string[]>} */
  const by = new Map();
  for (const l of left || []) by.set(String(l.why), [...(by.get(String(l.why)) || []), String(l.path)]);
  return [...by].map(([why, paths]) => `${why}: ${paths.length} (${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` and ${paths.length - 3} more` : ""})`).join("; ");
};
/**
 * The Changes line that says what stayed in its copy on another machine (`leftWords`); "" where nothing did.
 * @param {readonly { path: string, why: string }[] | null | undefined} left @param {string | null} [machine]
 */
export const leftNote = (left, machine = null) => (left?.length ? `Stayed in its copy${machine ? ` on ${machine}` : ""}, not brought here — ${leftWords(left)}.` : "");
/**
 * The Changes line of work with nothing waiting and nothing applied: a worktree's, which changed nothing; a copy's on
 * another machine (`there`), which changed nothing either unless a file it made there stayed there (`left`) — then
 * nothing came back, and the line after says what stayed.
 * @param {{ there?: boolean, machine?: string | null, left?: readonly { path: string, why: string }[] | null }} w
 */
export const nothingWords = ({ there = false, machine = null, left = null }) =>
  !there ? "It worked in its own git worktree and changed nothing." : `It worked in its own copy${machine ? ` on ${machine}` : " on another machine"}${left?.length ? ", and nothing it changed came back here." : " and changed nothing."}`;

/**
 * What an Apply would do, said before the press from its dry run: the files it writes and how — as the sub-agent left
 * them, merged with your edits (named), taken as its or with markers by your choice — the ones it deletes, the ones
 * you keep as yours, the ones already the same; or what stops it, with the ones already the same (the Designer's of
 * 10-27: "Can't apply as it stands — 1 of 3 files overlaps your edits. Nothing was written."). `pressed`: said after an
 * Apply that was refused.
 * @param {{ folder: string, came: Came[], conflicts: Conflict[], pressed?: boolean }} p
 */
export function effectLine({ folder, came, conflicts, pressed = false }) {
  if (conflicts.length) {
    const k = conflicts.length;
    const total = k + came.length;
    const lines = conflicts.every((c) => (c.kind ? c.kind === "lines" : /overlaps? yours/.test(c.why)));
    const of = k === total ? (k === 1 ? "its file" : `its ${k} files`) : `${k} of ${total} files`;
    const what = lines ? `${of} ${k === 1 ? "overlaps" : "overlap"} your edits` : `${of} can't come in cleanly`;
    // The files the folder holds already, said too: a change brought over by hand shows as such, not as all of it waiting.
    const same = came.filter((c) => c.how === "same").length;
    const held = same ? `, and ${same === 1 ? "1 is" : `${same} are`} already the same in your folder` : "";
    return `Can't apply as it stands — ${what}${held}. Nothing ${pressed ? "was" : "would be"} written.`;
  }
  const n = counted(came);
  const replaced = n.replaced || [];
  const markers = n.markers || [];
  const kept = n.kept || [];
  const writes = n.took + n.merged.length + replaced.length + markers.length;
  const how = [
    n.took ? `${n.took} as it left ${n.took === 1 ? "it" : "them"}` : "",
    n.merged.length ? `${n.merged.length} merged with your edits (${names(n.merged)})` : "",
    replaced.length ? `${names(replaced)} taken as its, your edits replaced` : "",
    markers.length ? `${names(markers)} with conflict markers for you to resolve` : "",
  ].filter(Boolean);
  const gone = came.filter((c) => c.how === "deleted").map((c) => c.path);
  const keptWords = kept.length ? `${names(kept)} kept as yours (its change to ${kept.length === 1 ? "it" : "them"} dropped)` : "";
  const parts = [];
  if (writes) parts.push(`Apply writes ${count(writes, "file")} into ${folder}${how.length > 1 || n.merged.length || replaced.length || markers.length || kept.length ? `: ${how.join(", ")}` : ""}${gone.length ? `, and deletes ${names(gone)}` : ""}${keptWords ? `; ${keptWords}` : ""}.`);
  else if (gone.length) parts.push(`Apply deletes ${names(gone)} from ${folder}${keptWords ? `; ${keptWords}` : ""}.`);
  else if (keptWords) parts.push(`Apply writes nothing: ${keptWords}.`);
  if (n.same) parts.push(writes || gone.length || kept.length ? `${n.same === 1 ? "1 is" : `${n.same} are`} already the same in your folder.` : "Every file is already as it left it in your folder.");
  parts.push("Nothing is staged or committed.");
  return parts.join(" ");
}

/** A conflict's why, said of its file: "overlaps your edits", else the apply's own words. @param {string} why */
export const overlapWords = (why) => (/overlaps? yours/.test(why) ? "overlaps your edits" : `— ${why}`);

/**
 * What an apply did, in place of a toast: "Applied 14:02 by you — 3 files: 2 as it left them, 1 merged with your
 * edits. Nothing staged."
 * And by your choices: "1 kept as yours", "1 taken as its", "1 with conflict markers". `hand`: marked as applied, its
 * change brought over some other way: "Marked as applied 14:02 by you — 3 files, in your folder already. Filament
 * wrote nothing." Found so by Filament (`by` "found"), every file of it in your folder already: "Found in your folder
 * 14:02 — 3 files, brought in another way. Filament wrote nothing."
 * @param {{ at: number, by?: string, reason?: string | null, files: number, came?: CameCount | null, hand?: boolean }} a @param {(at: number) => string} clock
 */
export function resultLine(a, clock) {
  if (a.hand && a.by === "found") return `Found in your folder ${clock(a.at)} — ${count(a.files, "file")}, brought in another way. Filament wrote nothing.`;
  if (a.hand) return `Marked as applied ${clock(a.at)}${a.by ? ` by ${byWords(a.by)}` : ""} — ${count(a.files, "file")}, in your folder already. Filament wrote nothing.`;
  const c = a.came || null;
  const chosen = c ? (c.kept?.length || 0) + (c.replaced?.length || 0) + (c.markers?.length || 0) : 0;
  const how = c
    ? [
        c.took ? `${c.took} as it left ${c.took === 1 ? "it" : "them"}` : "",
        c.merged.length ? `${c.merged.length} merged with your edits` : "",
        c.replaced?.length ? `${c.replaced.length} taken as its` : "",
        c.markers?.length ? `${c.markers.length} with conflict markers` : "",
        c.kept?.length ? `${c.kept.length} kept as yours` : "",
        c.deleted ? `${c.deleted} deleted` : "",
        c.same ? `${c.same} already the same` : "",
      ].filter(Boolean)
    : [];
  return `Applied ${clock(a.at)}${a.by ? ` by ${byWords(a.by, a.reason)}` : ""} — ${count(a.files, "file")}${how.length > 1 || c?.merged.length || chosen ? `: ${how.join(", ")}` : ""}. Nothing staged.`;
}

/**
 * When its newest apply was, for a row's short line: "applied 14:02 by you", or "marked applied 14:02 by your agent"
 * where its change came over some other way, or "found in your folder 14:02" where Filament found it there; `who: false`
 * leaves out who.
 * @param {{ at: number, by?: string, hand?: boolean }} a @param {(at: number) => string} clock @param {{ who?: boolean }} [o]
 */
export const appliedWhen = (a, clock, { who = true } = {}) =>
  a.hand && a.by === "found" ? `found in your folder ${clock(a.at)}` : `${a.hand ? "marked applied" : "applied"} ${clock(a.at)}${who && a.by ? ` by ${byWords(a.by).replace(/, its check passed$/, "")}` : ""}`;

/**
 * The files an apply left with git's conflict markers that still have them (the Designer's of 10-27), for the row's
 * line: "1 file has conflict markers". @param {readonly string[]} marked
 */
export const markersWords = (marked) => `${count(marked.length, "file")} ${marked.length === 1 ? "has" : "have"} conflict markers`;
/** The same files named, for a line cut from its right and the Changes tab's mark: "receipt.js and cart.js have conflict markers". @param {readonly string[]} marked */
export const markedWords = (marked) => `${names([...marked])} ${marked.length === 1 ? "has" : "have"} conflict markers`;
/** Said under them: there is nothing to mark resolved — Filament stages nothing (the Designer's of 10-28). */
export const MARKED_NOTE = "Resolve them and save: the mark goes by itself once they are.";

/** Where a copy's folder is, shortened to its last two parts: "…\filament-worktrees\sa_ab98c676". @param {string} folder */
export const shortFolder = (folder) => {
  const parts = String(folder || "").split(/[\\/]/).filter(Boolean);
  const sep = String(folder).includes("\\") ? "\\" : "/";
  return parts.length > 2 ? `…${sep}${parts.slice(-2).join(sep)}` : String(folder || "");
};

/**
 * Where a sub-agent works, in a few words: its own copy (its folder), the developer's folder, a throwaway copy, or
 * nowhere it writes.
 * @param {SubagentRow} r @returns {{ words: string, folder: string | null }}
 */
export function whereWords(r) {
  const may = r.may;
  if (may === "read") return { words: "reads only", folder: null };
  if (may === "copy") return { words: "a throwaway copy, nothing kept", folder: null };
  const folder = r.work?.folder || null;
  if (r.work) return { words: folder ? `its copy ${shortFolder(folder)}` : "its own copy", folder };
  return { words: "your folder (shared)", folder: null };
}

/** The file a running call writes, from its tool and its arguments' first words; "" where it writes none. @param {{ name: string, args: string } | null | undefined} tool */
export const writingFile = (tool) => {
  if (!tool || !/^(write|edit|notebook_edit|apply_patch)$/i.test(tool.name)) return "";
  const m = /"?(?:path|file_path)"?\s*[:=]\s*"([^"]+)"/.exec(tool.args) || /^\s*([^\s,{}"]+\.[A-Za-z0-9]+)/.exec(tool.args);
  return m ? leaf(m[1]) : "";
};

/** Work sent back to rebase, said where its Apply would stand: its sub-agent's next, no Apply's until it reports. */
export const REBASE_DUE_NOTE = "Sent back to rebase: its change is brought onto your folder as it is now, the overlaps marked, and it resolves them once your agent's next turn starts its task. Its work waits for your Apply again after.";

/**
 * What a sub-agent does now, for its row's second line: writing a file, its files that wait, its newest apply, or how
 * it ended.
 * @param {SubagentRow} r @param {(at: number) => string} clock
 */
export function nowWords(r, clock) {
  const w = r.work || null;
  if (r.status === "running") {
    const file = writingFile(r.progress?.tool);
    const so = w?.pending ? ` · ${count(w.pending, "file")} so far` : "";
    return file ? `writing ${file}${so}` : `${r.progress?.round ? `round ${r.progress.round}` : "working"}${so}`;
  }
  // Its graph task's change sent back to rebase: it goes on at its planner's turn (10-28).
  if (r.rebaseDue) return "sent back to rebase · goes on at your agent's next turn";
  if (w?.pending) return `${count(w.pending, "file")} wait${w.pending === 1 ? "s" : ""} (+${w.added} −${w.removed})`;
  if (w?.lastApplied) {
    const a = w.lastApplied;
    const when = appliedWhen(a, clock);
    // Files it left with conflict markers that still have them: named first, the line being cut from its right.
    return a.marked?.length ? `${markedWords(a.marked)} · ${when}` : `${when} · ${count(a.files, "file")}`;
  }
  if (r.status === "failed" || r.status === "error") return "failed";
  if (r.status === "stopped" || r.status === "aborted") return "stopped";
  return w ? "changed nothing" : "done";
}

/** What waits in a sub-agent's copy, for its card and its mark in the chat: "3 files wait in its copy · Review ›". @param {number} n */
export const waitsWords = (n) => `${count(n, "file")} wait${n === 1 ? "s" : ""} in its copy · Review ›`;

/**
 * How Apply works, said where the developer looks for it (the Designer's of 10-27): five points, its copy's folder named.
 * @param {string | null} folder
 */
export function howApplyWorks(folder) {
  return [
    `Its copy is a git worktree of your folder as it was when the agent started — your uncommitted changes included —${folder ? ` at ${folder},` : ""} on no branch.`,
    "When it finished, Filament kept its changes in git, so Apply works after a restart too.",
    "Apply goes file by file: a file you haven't touched since gets its version; a file you changed too is merged with yours line by line (git merge-file); a file that's already the same is left alone.",
    "If any change can't merge — the same lines changed, a file it deleted that you changed, a binary you both changed, a link — nothing at all is written: you choose for each such file (keep yours, take its, or both with git's markers), or send it back to redo its change on your folder as it is now.",
    "If a write fails midway (a file your editor locks), the ones already written are put back. Your git index and HEAD are never touched: commit when you like.",
  ];
}
