// @ts-check
// Filament's footprint in a project's repository (the footprint plan, Phase 7), at the foot of its places: one quiet
// line — "Filament's footprint: 3 copies · 1.2 GB · 214 refs" — read after the places, with Clean up… where anything
// would go or could go ticked. Clean up… reads the plan whole (`?plan=1`) and opens a sheet read at a glance (the
// owner's of 11-09: a hundred two-line rows were a wall): one line of what it takes now, then by kind what goes and
// why; what stays folded; the refs that go only where the person ticks them in groups by kind — each with its tick,
// its count, its rows folded where long, a row a line: whose, how many refs, the newest's day —, none ticked, another
// Filament's last and in no group's tick nor "All". Clean up there, pressed once more, sends exactly that plan
// (`POST /api/git/footprint/clean`): the server takes only what is both in it and still goes as it reads again. A
// toast says what went and what stayed, another where a copy's folder could not be removed all the way, and the line
// is read again. Read as the Space opens, on its ⟳ and after a clean; never on a live pulse.
import { h, morphChildren } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { button, dialog, toast } from "../lib/ui.js";
import { sizeWords } from "../lib/labels.js";

/** @param {unknown} e */
const said = (e) => String(/** @type {any} */ (e)?.message || e);
/** @param {number} n @param {string} one @param {string} [more] */
const many = (n, one, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;
/** "a", "a and b", "a, b and c". @param {string[]} parts */
const listOf = (parts) => (parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);
/** A time in seconds as the day it was, the machine's own: "2026-11-02". @param {number | null} s */
const dayOf = (s) => {
  if (s == null) return "";
  const d = new Date(s * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** What each kind is called in the sheet. */
const KIND_WORDS = /** @type {const} */ ({
  copies: "Copies",
  left: "Leftover folders",
  subagents: "Sub-agents' refs",
  snapshots: "Undo points",
  moves: "Ways back from moves",
  other: "Other refs",
  forks: "What deleted chats' forks held",
  refs: "Refs",
  branches: "Routine branches",
});
/** @param {string} kind */
const kindWords = (kind) => KIND_WORDS[/** @type {keyof typeof KIND_WORDS} */ (kind)] || kind;

/**
 * The footprint in a line: its copies, their disk ("at least" where the measure was cut short), the folders a Clean up
 * left, its refs, the routine branches it made; what no record shows to be its own; "" where it could not be read.
 * @param {any} a  `/git/footprint`'s answer
 */
export function footprintWords(a) {
  if (!a?.ok) return "";
  const parts = [
    many(a.copies.count, "copy", "copies"),
    ...(a.copies.count ? [`${a.copies.partial ? "at least " : ""}${sizeWords(a.copies.bytes)}`] : []),
    ...(a.left.count ? [many(a.left.count, "leftover folder")] : []),
    many(a.refs.count, "ref"),
    ...(a.branches.count ? [many(a.branches.count, "routine branch", "routine branches")] : []),
  ];
  // A deleted chat's fork's contents go only ticked too, but they are Filament's own (the owner's of 11-09): said apart.
  const forks = (a.refs.kinds || []).filter((/** @type {any} */ k) => k.kind === "forks").flatMap((/** @type {any} */ k) => k.groups).filter((/** @type {any} */ g) => g.tick).reduce((/** @type {number} */ n, /** @type {any} */ g) => n + (g.count || 0), 0);
  const unknown = a.refs.tick - forks;
  const ticks = [...(unknown > 0 ? [`${many(unknown, "ref")} no record shows are its own`] : []), ...(forks ? [`${many(forks, "ref")} of deleted chats' forks, kept until you tick them`] : [])];
  const tail = a.goes ? "" : ticks.length ? ` · ${ticks.join(" · ")}` : " · nothing to clean up";
  return `Filament's footprint: ${parts.join(" · ")}${tail}`;
}

/**
 * What the sheet says, by kind: each that loses something, how many go and why; each that keeps something, what stays
 * and why — copies and branches by name, refs counted. The groups that go only ticked are the sheet's own rows.
 * @param {any} a  `/git/footprint`'s answer
 * @returns {{ goes: string[], stays: string[] }}
 */
export function cleanLines(a) {
  /** @type {string[]} */
  const goes = [];
  /** @type {string[]} */
  const stays = [];
  /** @param {any[]} rows @param {(r: any) => number} n */
  const byWhy = (rows, n) => {
    /** @type {Map<string, { n: number, names: string[] }>} */
    const m = new Map();
    for (const r of rows) {
      const had = m.get(r.why) || { n: 0, names: [] };
      had.n += n(r);
      if (r.name) had.names.push(r.name);
      m.set(r.why, had);
    }
    return [...m];
  };
  /** @param {string} label @param {any[]} rows @param {(r: any) => number} n @param {boolean} named */
  const say = (label, rows, n, named) => {
    for (const [why, x] of byWhy(rows.filter((r) => r.goes), n)) goes.push(`${label}: ${named ? x.names.join(", ") : x.n} — ${why}`);
    for (const [why, x] of byWhy(rows.filter((r) => !r.goes && !r.tick), n)) stays.push(`${label}: ${named && x.names.length <= 3 ? x.names.join(", ") : x.n} — ${why}`);
  };
  /** @type {any[]} */
  const copies = a.copies.items;
  const going = copies.filter((c) => c.goes);
  if (going.length) goes.push(`${KIND_WORDS.copies}: ${going.length}, ${a.copies.goesPartial ? "at least " : ""}${sizeWords(a.copies.goesBytes)} — ${[...new Set(going.map((c) => c.why))].join("; ")}`);
  for (const [why, x] of byWhy(copies.filter((c) => !c.goes), () => 1)) stays.push(`${KIND_WORDS.copies}: ${x.names.length <= 3 ? x.names.join(", ") : x.n} — ${why}`);
  if (a.left.count) goes.push(`${KIND_WORDS.left}: ${a.left.count}, ${a.left.partial ? "at least " : ""}${sizeWords(a.left.bytes)} — ${[...new Set(a.left.items.map((/** @type {any} */ l) => l.why))].join("; ")}`);
  for (const k of a.refs.kinds) say(kindWords(k.kind), k.groups, (g) => g.count, false);
  say(KIND_WORDS.branches, a.branches.items, () => 1, true);
  return { goes, stays };
}

/**
 * The sheet's first line: what Clean up takes now, counted, the copies' and leftover folders' disk with them; that
 * what is listed to tick goes only ticked, and that everything else stays.
 * @param {any} a  `/git/footprint?plan=1`'s answer
 */
export function takesWords(a) {
  const parts = [
    ...(a.copies.goes ? [`${many(a.copies.goes, "copy", "copies")} (${a.copies.goesPartial ? "at least " : ""}${sizeWords(a.copies.goesBytes)})`] : []),
    ...(a.left.count ? [`${many(a.left.count, "leftover folder")} (${a.left.partial ? "at least " : ""}${sizeWords(a.left.bytes)})`] : []),
    ...(a.refs.goes ? [many(a.refs.goes, "ref")] : []),
    ...(a.branches.goes ? [many(a.branches.goes, "routine branch", "routine branches")] : []),
  ];
  const takes = parts.length ? `Clean up takes ${listOf(parts)} now${a.refs.tick ? ", and what you tick below" : ""}.` : a.refs.tick ? "Clean up takes only what you tick below." : "Clean up takes nothing now.";
  return `${takes} Everything else stays.`;
}

/**
 * The kinds of the groups that go only ticked, as their group in the sheet says it once — what those refs are for, in
 * plain words — and whose each row is: a helper's or a chat's. By kind and part, as `/git/footprint` groups them.
 */
const TICK_KINDS = /** @type {Record<string, { words: string, who: string }>} */ ({
  "subagents:work": { words: "Sub-agents' saved work, none of it waiting to be applied", who: "sub-agent" },
  "subagents:mark": { words: "Sub-agents' work marked as applied, held so the mark can be undone", who: "sub-agent" },
  "snapshots:undo": { words: "Undo points of chats that are not here", who: "chat" },
  "moves:undo": { words: "Ways back from moves, of chats that are not here", who: "chat" },
  "forks:kept": { words: "What forks of deleted chats held: edits nothing else keeps", who: "chat" },
});

/**
 * The groups that go only where the person ticks them, a row each: its group (`kind:part`), whose it is — a chat's or a
 * helper's id, a chat another Filament's said so (`others`) —, how many refs, the newest's day; `words`, all of it in
 * one line, as the row's tick is named to a screen reader.
 * @param {any} a  `/git/footprint?plan=1`'s answer
 * @returns {{ key: string, group: string, id: string, count: number, newest: string, words: string, others: boolean, refs: { ref: string, commit: string }[] }[]}
 */
export function tickRows(a) {
  return a.refs.kinds.flatMap((/** @type {any} */ k) =>
    k.groups
      .filter((/** @type {any} */ g) => g.tick)
      .map((/** @type {any} */ g) => {
        const group = `${k.kind}:${g.part}`;
        const who = TICK_KINDS[group]?.who || "owner";
        const id = String(g.owner ?? "");
        const newest = dayOf(g.newest);
        const words = `${g.others ? `Another Filament's ${who}` : `${who[0].toUpperCase()}${who.slice(1)}`} ${id} · ${many(g.count, "ref")}${newest ? ` · newest ${newest}` : ""}`;
        return { key: `${k.kind}:${g.owner}:${g.part}`, group, id, count: g.count, newest, words, others: !!g.others, refs: g.refs || [] };
      }),
  );
}

/**
 * Rows to tick in their groups, in the order the rows come: each group's words, whose its rows are, and its rows.
 * @param {ReturnType<typeof tickRows>} rows
 * @returns {{ key: string, words: string, who: string, rows: ReturnType<typeof tickRows> }[]}
 */
export function tickGroups(rows) {
  /** @type {Map<string, { key: string, words: string, who: string, rows: ReturnType<typeof tickRows> }>} */
  const by = new Map();
  for (const r of rows) {
    const had = by.get(r.group) || { key: r.group, words: TICK_KINDS[r.group]?.words || kindWords(r.group.split(":")[0]), who: TICK_KINDS[r.group]?.who || "owner", rows: [] };
    had.rows.push(r);
    by.set(r.group, had);
  }
  return [...by.values()];
}

/**
 * The plan a press sends: the copies, the folders a Clean up left, the refs and branches the sheet showed going, each as
 * it was read, and the refs of the groups the person ticked.
 * @param {any} a  `/git/footprint?plan=1`'s answer @param {ReadonlySet<string>} ticked  the ticked rows' keys
 */
export function pressedPlan(a, ticked) {
  return {
    copies: a.copies.items.filter((/** @type {any} */ c) => c.goes).map((/** @type {any} */ c) => ({ name: c.name, at: c.at })),
    left: a.left.items.filter((/** @type {any} */ l) => l.goes).map((/** @type {any} */ l) => ({ name: l.name })),
    refs: [
      ...a.refs.kinds.flatMap((/** @type {any} */ k) => k.groups.filter((/** @type {any} */ g) => g.goes).flatMap((/** @type {any} */ g) => g.refs || [])),
      ...tickRows(a).filter((r) => ticked.has(r.key)).flatMap((r) => r.refs),
    ],
    branches: a.branches.items.filter((/** @type {any} */ b) => b.goes).map((/** @type {any} */ b) => ({ name: b.name, commit: b.commit })),
  };
}

/**
 * The toast after a Clean up: what went, and what stayed, by kind.
 * @param {any} r  `POST /git/footprint/clean`'s answer
 */
export function cleanedWords(r) {
  const refs = Object.values(r.went.refs || {}).reduce((n, x) => n + Number(x || 0), 0);
  const went = [
    r.went.copies.length ? many(r.went.copies.length, "copy", "copies") : "",
    r.went.left?.length ? many(r.went.left.length, "leftover folder") : "",
    refs ? many(refs, "ref") : "",
    r.went.branches.length ? many(r.went.branches.length, "branch", "branches") : "",
  ].filter(Boolean);
  /** @param {(kind: string) => boolean} which */
  const stayedOf = (which) => (r.stayed || []).filter((/** @type {any} */ s) => which(String(s.kind))).reduce((/** @type {number} */ n, /** @type {any} */ s) => n + Number(s.count || 0), 0);
  const isRefs = (/** @type {string} */ k) => k !== "copies" && k !== "left" && k !== "branches";
  const kept = [
    stayedOf((k) => k === "copies") ? many(stayedOf((k) => k === "copies"), "copy", "copies") : "",
    stayedOf((k) => k === "left") ? many(stayedOf((k) => k === "left"), "leftover folder") : "",
    stayedOf(isRefs) ? many(stayedOf(isRefs), "ref") : "",
    stayedOf((k) => k === "branches") ? many(stayedOf((k) => k === "branches"), "branch", "branches") : "",
  ].filter(Boolean);
  const left = kept.length ? ` · ${listOf(kept)} stayed` : "";
  if (!went.length) return `Nothing went${left}`;
  return `Cleaned up: ${listOf(went)} went${left}`;
}

/**
 * The error toast after a Clean up where a copy went but its folder could not be removed all the way, as the places'
 * Remove says it — what is left, and where; "" where none.
 * @param {any} r  `POST /git/footprint/clean`'s answer
 */
export function leftWords(r) {
  /** @type {string[]} */
  const left = Array.isArray(r?.left) ? r.left : [];
  if (!left.length) return "";
  const at = left.length === 1 ? left[0] : `${left.slice(0, -1).join(", ")} and ${left.at(-1)}`;
  return `${left.length === 1 ? "A copy's folder" : `${left.length} copies' folders`} could not be deleted all the way; what is left is at ${at}. The next Clean up removes it.`;
}

/**
 * The line and its Clean up…. `load(cwd)`: the footprint of `cwd`'s repository read and drawn; `clear()`: nothing to
 * read there (the places could not be read). `onCleaned`: after a clean, for the places to be read again with it.
 * @param {{ onCleaned: () => void }} o
 * @returns {{ el: HTMLElement, load: (cwd: string) => Promise<void>, clear: () => void }}
 */
export function footprintLine({ onCleaned }) {
  const words = h("span", { class: "pl-foot-words" });
  const slot = h("span", { class: "pl-foot-end" });
  const el = h("div", { class: "pl-foot", "data-key": "footprint", hidden: "" }, words, slot);
  let seq = 0;
  /** @type {any} the last answer */
  let answer = null;
  /** "reading" while Clean up… reads the plan, "cleaning" while a press runs. */
  let doing = "";

  function draw() {
    const a = answer;
    if (!a) return void el.setAttribute("hidden", "");
    el.removeAttribute("hidden");
    words.textContent = a.ok ? footprintWords(a) : `Filament's footprint could not be read: ${a.error || "no answer"}`;
    const label = doing === "reading" ? "Reading…" : doing === "cleaning" ? "Cleaning up…" : "Clean up…";
    // Drawn in place, its button kept by its key: a button made anew would stand under a resting pointer.
    morphChildren(slot, a.ok && (a.goes || a.refs.tick) ? [button({ label, variant: "ghost", size: "sm", key: "clean", disabled: !!doing, onClick: () => void ask() })] : []);
  }

  /** @param {string} cwd */
  async function load(cwd) {
    const mine = ++seq;
    /** @type {any} */
    let got;
    try {
      got = await api(`/git/footprint?cwd=${encodeURIComponent(cwd)}`);
    } catch (e) {
      got = { ok: false, error: said(e) };
    }
    if (mine !== seq) return;
    answer = got;
    draw();
  }

  function clear() {
    seq++;
    answer = null;
    draw();
  }

  /** The sheet, for the line's own Clean up…: the button says what it does while the sheet reads and while a press runs. */
  function ask() {
    if (!answer?.ok) return;
    void openCleanUp(String(answer.cwd), { busy: (now) => { doing = now; draw(); }, onCleaned: () => { doing = ""; onCleaned(); } });
  }

  return { el, load, clear };
}

/**
 * The sheet of `cwd`'s repository: the plan read whole, what goes and what stays by kind, the rows that go only ticked;
 * Clean up once more — the line's own Clean up…, and the Plan's Still open card's (the owner's of 11-09). `busy`: what
 * it does now — "reading" while it reads the plan, "" once read, "cleaning" while a press runs; `onCleaned`: after a
 * press, cleaned or refused.
 * @param {string} cwd @param {{ onCleaned: () => void, busy?: (doing: "" | "reading" | "cleaning") => void }} o
 */
export async function openCleanUp(cwd, { onCleaned, busy = () => {} }) {
  busy("reading");
  /** @type {any} */
  let a;
  try {
    a = await api(`/git/footprint?cwd=${encodeURIComponent(cwd)}&plan=1`);
  } catch (e) {
    toast(`Clean up: ${said(e)}`, "err");
    return;
  } finally {
    busy("");
  }
  if (!a?.ok) return void toast(`Clean up: ${a?.error || "the footprint could not be read"}`, "err");
  const { goes, stays } = cleanLines(a);
  const rows = tickRows(a);
  // Another Filament's rows stand last, under their own head, and neither "All" nor a group's tick takes them: each is
  // ticked alone.
  const mine = rows.filter((r) => !r.others);
  const theirs = rows.filter((r) => r.others);
  const mineGroups = tickGroups(mine);
  /** @type {Set<string>} */
  const ticked = new Set();
  /** Each box and the rows it ticks: after any tick each is drawn again from `ticked`, half ticked where some of its are. @type {{ box: HTMLInputElement, keys: string[] }[]} */
  const boxes = [];
  const tickBox = (/** @type {string} */ label, /** @type {string[]} */ keys) => {
    const box = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", "aria-label": label }));
    box.addEventListener("change", () => {
      for (const k of keys) box.checked ? ticked.add(k) : ticked.delete(k);
      for (const b of boxes) {
        const on = b.keys.filter((k) => ticked.has(k)).length;
        b.box.checked = on === b.keys.length;
        b.box.indeterminate = on > 0 && on < b.keys.length;
      }
    });
    boxes.push({ box, keys });
    return box;
  };
  const allWords = `All ${mine.length} of these${theirs.length ? ", not another Filament's" : ""}`;
  // One group's own tick is its "All".
  const all = mineGroups.length > 1 ? tickBox(allWords, mine.map((r) => r.key)) : null;
  /** A row a line: its tick, whose, how many refs, the newest's day. @param {ReturnType<typeof tickRows>[number]} r */
  const rowEl = (r) =>
    h("label", { class: "pl-clean-row", "data-key": r.key }, tickBox(r.words, [r.key]),
      h("span", { class: "pl-clean-id" }, r.id), h("span", { class: "pl-clean-n" }, String(r.count)), h("span", { class: "pl-clean-day" }, r.newest));
  /**
   * A kind's rows: what they are for, said once; its tick where it holds more than one row of this Filament's; how many,
   * their refs and the newest's day over its rows, folded where they are more than a few.
   * @param {ReturnType<typeof tickGroups>[number]} g @param {boolean} [others]
   */
  const groupEl = (g, others = false) => {
    const refs = g.rows.reduce((n, r) => n + r.count, 0);
    const newest = g.rows.reduce((d, r) => (r.newest > d ? r.newest : d), "");
    const who = `${g.who[0].toUpperCase()}${g.who.slice(1)}`;
    return h("div", { class: "pl-clean-group", role: "group", "aria-label": g.words, "data-group": g.key },
      !others && g.rows.length > 1
        ? h("label", { class: "pl-clean-gtick" }, tickBox(`All ${g.rows.length}: ${g.words}`, g.rows.map((r) => r.key)), h("span", { class: "pl-clean-gname" }, g.words))
        : h("p", { class: "pl-clean-gname" }, g.words),
      h("details", { class: "pl-clean-fold", open: g.rows.length <= 5 ? "" : null },
        h("summary", {}, `${many(g.rows.length, g.who)} · ${many(refs, "ref")}${newest ? ` · newest ${newest}` : ""}`),
        h("div", { class: "pl-clean-list" },
          h("div", { class: "pl-clean-cols", "aria-hidden": "true" }, h("span", {}), h("span", {}, who), h("span", {}, "Refs"), h("span", {}, "Newest")),
          ...g.rows.map(rowEl))));
  };
  const d = dialog({
    title: "Clean up Filament's footprint?",
    glyph: h("span", { class: "chg-sheet-glyph", html: icon("trash2") }),
    description: String(a.repo || a.cwd || ""),
    wide: true,
    body: h("div", { class: "chg-sheet pl-clean" },
      h("p", { class: "pl-clean-sum" }, takesWords(a)),
      goes.length ? h("ul", { class: "pl-clean-lines" }, ...goes.map((l) => h("li", { class: "pl-clean-goes" }, l))) : null,
      stays.length
        ? h("details", { class: "pl-clean-fold pl-clean-kept" }, h("summary", {}, `What stays, and why (${stays.length})`),
            h("ul", { class: "pl-clean-lines" }, ...stays.map((l) => h("li", { class: "pl-clean-stays" }, l))))
        : null,
      rows.length
        ? h("div", { class: "pl-clean-ticks" },
            h("p", { class: "pl-clean-h" }, "These go only if you tick them"),
            h("p", { class: "pl-clean-warn" }, "Another Filament working in this repository — the app, or a copy you test with — may still need them. Tick only what you know none does."),
            all ? h("label", { class: "pl-clean-all" }, all, h("span", {}, allWords)) : null,
            ...mineGroups.map((g) => groupEl(g)),
            ...(theirs.length
              ? [h("p", { class: "pl-clean-h" }, "Another Filament's — this one never had these chats; tick each on its own"), ...tickGroups(theirs).map((g) => groupEl(g, true))]
              : []))
        : null,
      h("p", { class: "pl-clean-note" }, "Filament reads it all again as you press Clean up, and takes only what this sheet shows going, or you ticked, and nothing needs then.")),
    actions: [
      { label: "Cancel", variant: "outline", onClick: () => d.close() },
      { label: "Clean up", variant: "destructive", onClick: () => { d.close(); void clean(cwd, pressedPlan(a, ticked), { onCleaned, busy }); } },
    ],
  });
}

/**
 * @param {string} cwd @param {ReturnType<typeof pressedPlan>} plan
 * @param {{ onCleaned: () => void, busy: (doing: "" | "reading" | "cleaning") => void }} o
 */
async function clean(cwd, plan, { onCleaned, busy }) {
  busy("cleaning");
  try {
    const r = await api("/git/footprint/clean", { method: "POST", body: { cwd, plan } });
    toast(cleanedWords(r));
    if (leftWords(r)) toast(leftWords(r), "err");
  } catch (e) {
    toast(`Clean up: ${said(e)}`, "err");
  }
  onCleaned();
}
