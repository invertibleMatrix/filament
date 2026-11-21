// @ts-check
// A sub-agent's copy's parts, which the Changes pane draws in the copy's block (the Designer's of 10-27 and 10-29): its
// Apply — said before the press from a dry run, and after it in a line (apply-words.js) —, what stops it file by file
// with Compare and the choices, Send back to rebase, and its diff; and the mark on the Changes tab and button while
// something waits for you. Its host draws them in place (dom.js `morphChildren`): each part is keyed by what it is, so
// a dry run landing keeps the buttons that stood.
import { h, standing } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { button, diffView } from "../lib/ui.js";
import { MARKED_NOTE, PREVIEW_MS, REBASE_DUE_NOTE, SHARED_DONE, WHY_WAITS, choiceEffect, choiceLabel, choicesFor, effectLine, howApplyWorks, kindWords, leaf, markedWords, markersWords, rebaseWords, resultLine } from "../lib/apply-words.js";
import { clockOf, fileCount } from "./changes-data.js";
import { leadApplies } from "../lib/side.js";

/** @typedef {import("../lib/subagents.js").SubagentRow} SubagentRow */

/**
 * The Changes tab's and button's mark for a chat's sub-agents: "1 agent asks you · 1 agent's work waits for your Apply ·
 * receipt.js has conflict markers"; null where nothing waits for you. Work sent back to rebase waits for its agent, not
 * for your Apply (the Hunter's of 10-28); a worker's, while its team leads the chat and its lead is at work, for its
 * lead's (lib/side.js `leadApplies`).
 * @param {readonly SubagentRow[]} rows @param {boolean} [live]  the chat's turn is at work
 */
export function agentsMark(rows, live = false) {
  const leads = leadApplies(rows, live);
  const waits = rows.filter((r) => r.status !== "running" && r.work?.pending && !r.rebaseDue && !leads.has(String(r.id))).length;
  const asks = rows.filter((r) => r.status === "running" && r.progress?.asking).length;
  const marked = rows.flatMap((r) => (r.work?.pending ? [] : r.work?.lastApplied?.marked || []));
  return [
    asks ? `${asks} agent${asks === 1 ? " asks" : "s ask"} you` : "",
    waits ? `${waits} agent${waits === 1 ? "'s work waits" : "s' work waits"} for your Apply` : "",
    marked.length ? markedWords(marked) : "",
  ].filter(Boolean).join(" · ") || null;
}

/** @typedef {import("../lib/apply-words.js").Conflict} Conflict */
/** @typedef {import("../lib/apply-words.js").Choice} Choice */
/** @typedef {{ folder?: string | null, repo?: string, came: import("../lib/apply-words.js").Came[], conflicts: Conflict[], error?: string }} Preview */
/**
 * The doors the page hands: a sub-agent's thread, another chat, its stop, its waiting diff, its Apply's dry run and the
 * Apply itself (with the developer's choices for the files that overlap theirs), Compare's read of one such file, Send
 * back to rebase, Mark as applied and its undo, the sub-agents' list read again, a model's name.
 * @typedef {{ ok: true } | { ok: false, error: string }} Done
 * @typedef {{ openSubagent: (id: string) => void, openChat: (chain: string) => void,
 *   stopSubagent: (id: string) => void, diffOf: (id: string) => Promise<{ diff: string }>,
 *   preview: (id: string, choices?: Record<string, Choice>) => Promise<Preview>,
 *   apply: (id: string, choices?: Record<string, Choice>) => Promise<{ ok: true } | { ok: false, error: string, conflicts?: Conflict[] }>,
 *   compare?: (id: string, path: string) => Promise<{ overlaps: import("../lib/apply-words.js").Overlap[], repo?: string, folder?: string | null }>,
 *   rebase?: (id: string) => Promise<Done>, markApplied?: (id: string) => Promise<Done>, unmarkApplied?: (id: string) => Promise<Done>,
 *   reread?: () => Promise<unknown>, modelName: (id: string) => string }} BandDoors
 */
/**
 * What the band is handed: the page's doors, and from the view that hosts its parts (`workOf`) the editor, its own
 * draw again, and whether it is still on screen — its dry runs are read again on their own only while it is.
 * @typedef {BandDoors & { editorButton: (path: string, what: string) => HTMLElement | null, repaint: () => void,
 *   shown: () => boolean }} BandCtx
 */
/** A file's path in a folder, its slashes the folder's. @param {string} folder @param {string} path */
const inFolder = (folder, path) => {
  const sep = folder.includes("\\") ? "\\" : "/";
  return `${folder.replace(/[\\/]+$/, "")}${sep}${path.split(/[\\/]/).join(sep)}`;
};

/**
 * The band: a copy's parts (`workOf`), which its host draws, and draws again as the band asks; `stop`, once the host
 * is gone.
 * @param {BandCtx} ctx
 */
export function createBand(ctx) {
  /**
   * Each sub-agent's dry run as read, by its work's signature and when it was asked; and the one with the developer's
   * choices so far, by those choices. @typedef {{ sig: string, at: number, n: number, p: Promise<any>, got?: any, gotN?: number }} Read
   * @type {Map<string, Read>}
   */
  const previews = new Map();
  /** @type {Map<string, Read>} */
  const chosenReads = new Map();
  /** Its Apply under way, and its refusal — when it came — by sub-agent. */
  const applying = new Set();
  /** @type {Map<string, { error: string, conflicts: Conflict[], n: number }>} */
  const refused = new Map();
  /** The band's reads and refusals, counted in the order they came: a dry run asked after a refusal is newer than it, in the same millisecond too. */
  let asked = 0;
  /** The developer's choices for the files that stop an Apply, by sub-agent and path. @type {Map<string, Record<string, Choice>>} */
  const choices = new Map();
  /** The files whose Compare is open, its read by work, and the overlaps whose start is shown: by sub-agent and path. */
  const compareShown = new Set();
  /** @type {Map<string, { sig: string, at: number, n: number, p: Promise<any>, got?: any, gotN?: number }>} */
  const compares = new Map();
  const startShown = new Set();
  /** The rows whose clean files are shown under a stuck Apply. */
  const cleanShown = new Set();
  /** Its Send back to rebase under way, and what came of it, by sub-agent. */
  const rebasing = new Set();
  /** @type {Map<string, string>} */
  const rebaseSaid = new Map();
  /** Its Mark as applied, or the undo of one, under way; and a refusal of either, in its words, by sub-agent. */
  const marking = new Set();
  /** @type {Map<string, string>} */
  const markSaid = new Map();
  /** The rows whose diff and How Apply works are shown. */
  const diffShown = new Set();
  const howShown = new Set();
  /** Each sub-agent's waiting diff as read, by its work's signature. @type {Map<string, { sig: string, got?: { diff: string } | { error: string } }>} */
  const diffs = new Map();
  /** What each diff's box on the page holds, as the read's text: the same read again draws nothing. @type {WeakMap<Element, string>} */
  const holds = new WeakMap();
  /** Its host gone: nothing is read or drawn again. */
  let stopped = false;
  /** The clock the band's lines read times by. */
  const clock = clockOf;

  /** Which work waits: the row's own word for it, with its counts (the Hunter's of 10-28: counts alone stayed the same over a rebase). @param {SubagentRow} r */
  const sigOf = (r) => `${r.work?.sig || ""}:${r.work?.pending}:${r.work?.added}:${r.work?.removed}:${r.work?.applied}`;

  /** The band's parts drawn again: its host's draw. */
  function paint() {
    if (!stopped) ctx.repaint();
  }

  /**
   * What its work waits on or came to: its Apply, its note when sent back to rebase, or what its Apply did — the
   * Changes tab's copy block's (the Designer's of 10-29). @param {SubagentRow} s
   */
  function workOf(s) {
    const w = s.work;
    if (w?.pending && s.status !== "running" && s.rebaseDue) return [h("div", { class: "agb-note", "data-key": "note" }, REBASE_DUE_NOTE)];
    if (w?.pending && s.status !== "running") return [applyBlock(s)];
    if (w?.lastApplied) {
      const a = w.lastApplied;
      const said = markSaid.get(s.id);
      const undo = a.undo && ctx.unmarkApplied
        ? h("button", { class: "chg-link agb-unmark", type: "button", title: "Its changes wait for your Apply again", disabled: marking.has(s.id) ? "" : null, onclick: () => void doUnmark(s) }, marking.has(s.id) ? "Undoing…" : "Undo")
        : null;
      return [
        h("div", { class: "agb-result", "data-key": "result" }, resultLine({ at: a.at, by: a.by, reason: a.reason || null, files: a.files, came: a.came || null, hand: !!a.hand }, clock)),
        // A mark as applied can be undone while nothing of its work came since: its changes then wait for Apply again.
        ...(undo || said ? [h("div", { class: "agb-undo", "data-key": "undo" }, undo, said ? h("div", { class: "agb-last" }, said) : null)] : []),
        // The files it left with conflict markers, while they stand (the Designer's of 10-27): "1 file has conflict markers · Open ↗".
        // Each file's span keyed by its path: its Open opens the path it was made with.
        ...(a.marked?.length
          ? [h("div", { class: "agb-marked", "data-key": "marked" }, h("span", { class: "agb-marked-words" }, markersWords(a.marked)),
              ...a.marked.map((p) => h("span", { class: "agb-marked-file", title: p, "data-key": p }, leaf(p), a.repo ? ctx.editorButton(inFolder(a.repo, p), `Open ${leaf(p)}`) : null))),
            h("div", { class: "agb-note agb-marked-note", "data-key": "marked-note" }, MARKED_NOTE)]
          : []),
      ];
    }
    if (!w && s.may === "edit" && s.status !== "running") return [h("div", { class: "agb-note", "data-key": "note" }, SHARED_DONE)];
    return [];
  }

  /**
   * Its Apply, said before the press (the Designer's of 10-27): why it is there, what it would do — from a dry run, read
   * again as its work moves — or what stops it; Show the diff, Apply, and How Apply works.
   * @param {SubagentRow} s
   */
  function applyBlock(s) {
    const w = /** @type {NonNullable<SubagentRow["work"]>} */ (s.work);
    const pv = readOf(previews, s.id, sigOf(s), () => ctx.preview(s.id));
    const got = pv.got;
    const no = refused.get(s.id) || null;
    // A refusal stands until a dry run asked after it lands; that one then says how things are (the Hunter's of 10-28:
    // a refusal kept Apply locked whatever the folder did next).
    const fresh = !!got && !got.error && (!no || (pv.gotN || 0) > no.n);
    /** @type {Conflict[]} */
    const conflicts = fresh ? got.conflicts || [] : no?.conflicts?.length ? no.conflicts : got?.conflicts || [];
    // The buttons keyed by what they do: as the block comes to be stuck or clean again, in another order, none is drawn
    // over another — a press landing as it moves does what the button said.
    const diffBtn = button({ label: diffShown.has(s.id) ? "Hide the diff" : "Show the diff", variant: "outline", size: "sm", key: "diff", onClick: () => { toggle(diffShown, s.id); paint(); } });
    const howBtn = h("button", { class: "chg-link", type: "button", "data-key": "how", "aria-expanded": String(howShown.has(s.id)), onclick: () => { toggle(howShown, s.id); paint(); } }, "How Apply works");
    const tail = [
      howShown.has(s.id) ? h("ol", { class: "agb-how", "data-key": "how" }, ...howApplyWorks(got?.folder || s.work?.folder || null).map((t) => h("li", {}, t))) : null,
      diffShown.has(s.id) ? diffBox(s) : null,
    ];
    if (conflicts.length) return stuckBlock(s, { got, conflicts, pressed: !!no && !fresh, diffBtn, howBtn, tail });
    const effect = no && !fresh && !no.conflicts?.length ? no.error : !got ? "Checking what Apply would do…" : got.error ? `Apply can't be checked now: ${got.error}` : effectLine({ folder: got.repo || got.folder || "your folder", came: got.came || [], conflicts });
    const busy = applying.has(s.id) || marking.has(s.id);
    const apply = button({ label: applying.has(s.id) ? "Applying…" : `Apply ${fileCount(w.pending)}`, size: "sm", class: "agb-apply", key: "apply", disabled: busy || !got || !!got.error, onClick: () => void doApply(s) });
    const said = markSaid.get(s.id);
    // Each part keyed: a line that comes — the last Apply's word, once a dry run asked after it lands — leaves the
    // buttons the elements that stood (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
    return h("div", { class: "agb-apply-box", "data-key": "apply" },
      h("div", { class: "agb-why", "data-key": "why" }, WHY_WAITS),
      h("div", { class: "agb-effect", "data-key": "effect" }, effect),
      no && fresh ? h("div", { class: "agb-last", "data-key": "last" }, `Your last Apply: ${no.error}`) : null,
      h("div", { class: "agb-acts", "data-key": "acts" }, diffBtn, apply, markBtn(s, busy), howBtn),
      said ? h("div", { class: "agb-last", "data-key": "said" }, said) : null,
      ...tail);
  }

  /**
   * Mark as applied (10-29): its change reached your folder some other way — brought over by hand, say — so it stops
   * waiting, and nothing is written. None for a graph task's sub-agent, before a restart or after: its task reads an apply
   * as its change merged, and Apply tells it so.
   * @param {SubagentRow} s @param {boolean} busy
   */
  function markBtn(s, busy) {
    if (!ctx.markApplied || s.task) return null;
    return button({ label: marking.has(s.id) ? "Marking…" : "Mark as applied", variant: "outline", size: "sm", class: "agb-mark", key: "mark", title: "Its changes are in your folder already: they stop waiting, and nothing is written. You can undo it.", disabled: busy, onClick: () => void doMark(s) });
  }

  /**
   * A read kept by its key — asked again when the key moves, or when it is older than PREVIEW_MS, the last answer shown
   * meanwhile. `n`: its place among the band's reads and refusals, in the order asked; `gotN`, the read that answered.
   * @param {Map<string, { sig: string, at: number, n: number, p: Promise<any>, got?: any, gotN?: number }>} map @param {string} id @param {string} sig
   * @param {() => Promise<any>} ask
   */
  function readOf(map, id, sig, ask) {
    const had = map.get(id);
    if (had && had.sig === sig && (had.got === undefined || Date.now() - had.at < PREVIEW_MS)) {
      // On show and answered: the band draws again once it is old, whichever read set the timer (the Hunter's of 10-28:
      // a newer read that landed while the timer stood was never read again).
      if (had.got !== undefined) readAgainLater();
      return had;
    }
    const same = had?.sig === sig;
    /** @type {{ sig: string, at: number, n: number, p: Promise<any>, got?: any, gotN?: number }} */
    const entry = { sig, at: Date.now(), n: ++asked, p: ask(), got: same ? had?.got : undefined, gotN: same ? had?.gotN : undefined };
    map.set(id, entry);
    entry.p
      .then((got) => { entry.got = got; }, (e) => { entry.got = { error: String(e?.message || e) }; })
      .finally(() => {
        entry.gotN = entry.n;
        if (map.get(id) !== entry) return;
        paint();
        readAgainLater();
      });
    return entry;
  }

  /**
   * The band's draw once a read on show is old: the developer's edits in their editor move what it says, and nothing
   * else draws the band then (the Hunter's of 10-28). A draw with no such read on show sets none; nor does a host off
   * the screen or gone (the review of 10-29: a pane drawn again left the one before it reading every 15 s for good).
   * @type {any}
   */
  let again = null;
  function readAgainLater() {
    if (again || stopped) return;
    again = setTimeout(() => {
      again = null;
      if (ctx.shown()) paint();
    }, PREVIEW_MS + 50);
    again?.unref?.();
  }

  /**
   * An Apply that can't go in as it stands (the Designer's of 10-27): what stops it, file by file — what kind of
   * overlap, Compare where lines overlap, and the choices that kind offers, each saying what it does; the files that come
   * in cleanly, folded; then Send back to rebase, first, and Apply with my choices once every file has one.
   * @param {SubagentRow} s
   * @param {{ got: any, conflicts: Conflict[], pressed: boolean, diffBtn: HTMLElement, howBtn: HTMLElement, tail: any[] }} o
   */
  function stuckBlock(s, { got, conflicts, pressed, diffBtn, howBtn, tail }) {
    const folder = got?.repo || got?.folder || "your folder";
    const mine = choices.get(s.id) || {};
    /** @type {Record<string, Choice>} */
    const picked = {};
    for (const c of conflicts) if (choicesFor(c).includes(mine[c.path])) picked[c.path] = mine[c.path];
    const all = conflicts.every((c) => picked[c.path]);
    const chosen = all ? readOf(chosenReads, s.id, `${sigOf(s)}\n${JSON.stringify(picked)}`, () => ctx.preview(s.id, picked)) : null;
    const since = s.startedAt ? clock(s.startedAt) : "";
    const clean = /** @type {import("../lib/apply-words.js").Came[]} */ (got?.came || []);
    const busy = applying.has(s.id) || rebasing.has(s.id) || marking.has(s.id);
    const model = s.model ? ctx.modelName(s.model) : "";
    const rebaseBtn = ctx.rebase ? button({ label: rebasing.has(s.id) ? "Sending it back…" : "Send back to rebase", size: "sm", class: "agb-rebase", key: "rebase", disabled: busy, onClick: () => void doRebase(s) }) : null;
    const applyBtn = button({ label: applying.has(s.id) ? "Applying…" : "Apply with my choices", variant: "outline", size: "sm", class: "agb-apply", key: "apply", disabled: busy || !all || !chosen?.got || !!chosen.got.error || !!chosen.got.conflicts?.length, onClick: () => void doApply(s, picked) });
    const chosenWords = !all ? "Choose for each file to apply with your choices." : !chosen?.got ? "Checking what your choices would do…" : chosen.got.error ? `Your choices can't be checked now: ${chosen.got.error}` : effectLine({ folder, came: chosen.got.came || [], conflicts: chosen.got.conflicts || [] });
    const said = [rebaseSaid.get(s.id), markSaid.get(s.id)].filter(Boolean);
    return h("div", { class: "agb-apply-box is-stuck", "data-key": "apply" },
      h("div", { class: "agb-why", "data-key": "why" }, WHY_WAITS),
      h("div", { class: "agb-effect", "data-key": "effect" }, effectLine({ folder, came: clean, conflicts, pressed })),
      h("div", { class: "agb-confs", "data-key": "confs" }, ...conflicts.map((c) => conflictEl(s, c, mine[c.path], since))),
      clean.length
        ? h("button", { class: `chg-fold agb-clean${cleanShown.has(s.id) ? " open" : ""}`, type: "button", "aria-expanded": String(cleanShown.has(s.id)), "data-key": "clean", onclick: () => { toggle(cleanShown, s.id); paint(); } },
          h("span", { class: "chg-chev", html: ICONS.chevronRight }), `${fileCount(clean.length)} ${clean.length === 1 ? "comes" : "come"} in cleanly`)
        : null,
      clean.length && cleanShown.has(s.id) ? h("ul", { class: "agb-clean-list", "data-key": "clean-list" }, ...clean.map((c) => h("li", { title: c.path }, h("b", {}, leaf(c.path)), ` ${CAME_WORDS[c.how] || c.how}`))) : null,
      h("div", { class: "agb-acts", "data-key": "acts" }, rebaseBtn, applyBtn, markBtn(s, busy), diffBtn, howBtn),
      rebaseBtn ? h("div", { class: "agb-act-note", "data-key": "rebase-note" }, rebaseWords(model)) : null,
      ...said.map((t, i) => h("div", { class: "agb-last", "data-key": `said-${i}` }, t)),
      h("div", { class: "agb-act-note agb-chosen", "data-key": "chosen" }, chosenWords),
      ...tail);
  }

  /**
   * One file that stops an Apply: its name and what kind of overlap, Compare where lines overlap, its choices — the
   * offered ones alone — and what the chosen one does. @param {SubagentRow} s @param {Conflict} c
   * @param {Choice | undefined} choice @param {string} since
   */
  function conflictEl(s, c, choice, since) {
    const key = `${s.id}\n${c.path}`;
    const offered = choicesFor(c);
    const open = compareShown.has(key);
    const on = choice && offered.includes(choice) ? choice : null;
    return h("div", { class: "agb-conf", "data-key": c.path },
      h("div", { class: "agb-conf-head" },
        h("b", { class: "agb-conf-name", title: c.path }, leaf(c.path)),
        h("span", { class: "agb-conf-why" }, ` — ${kindWords(c)}`),
        c.kind === "lines" && ctx.compare
          ? h("button", { class: "chg-link agb-compare", type: "button", "aria-expanded": String(open), onclick: () => { toggle(compareShown, key); paint(); } }, open ? "Hide the compare" : "Compare")
          : null),
      c.path !== leaf(c.path) ? h("div", { class: "agb-cpath" }, c.path) : null,
      h("div", { class: "agb-choices", role: "radiogroup", "aria-label": `What to do with ${leaf(c.path)}` },
        ...offered.map((ch) => h("label", { class: `agb-choice${on === ch ? " is-on" : ""}` },
          h("input", { type: "radio", name: `agb-${s.id}-${c.path}`, value: ch, checked: on === ch ? "" : null, onchange: () => choose(s.id, c.path, ch) }),
          h("span", {}, choiceLabel(c.kind, ch))))),
      on ? h("div", { class: "agb-choice-effect" }, choiceEffect(c, on, since)) : null,
      open ? compareBox(s, c) : null);
  }

  /** @param {string} id @param {string} path @param {Choice} ch */
  function choose(id, path, ch) {
    choices.set(id, { ...(choices.get(id) || {}), [path]: ch });
    paint();
  }

  /**
   * Compare (the Designer's of 10-27): each overlap at its line in your file, "Yours now" over "Its", the lines at its
   * start folded, and the two files to open. Read when first shown, again when its work moved, and on its own once it
   * is PREVIEW_MS old while it shows, as the dry run is — your edits in your editor move "Yours now" (the Hunter's of 10-28).
   * @param {SubagentRow} s @param {Conflict} c
   */
  function compareBox(s, c) {
    const key = `${s.id}\n${c.path}`;
    const ask = /** @type {NonNullable<BandCtx["compare"]>} */ (ctx.compare);
    const got = readOf(compares, key, sigOf(s), () => ask(s.id, c.path)).got;
    if (!got) return h("div", { class: "agb-cmp pane-note" }, "Reading both sides…");
    if (got.error) return h("div", { class: "agb-cmp pane-note" }, `Can't compare it now: ${got.error}`);
    const yours = got.repo ? ctx.editorButton(inFolder(got.repo, c.path), `Open yours, ${leaf(c.path)}`) : null;
    const its = got.folder ? ctx.editorButton(inFolder(got.folder, c.path), `Open its version of ${leaf(c.path)}`) : null;
    return h("div", { class: "agb-cmp" },
      ...(got.overlaps || []).map((/** @type {import("../lib/apply-words.js").Overlap} */ o, /** @type {number} */ i) => {
        const sk = `${key}\n${i}`;
        return h("div", { class: "agb-ov" },
          h("div", { class: "agb-ov-head" }, `Line ${o.at}`),
          sideOf("Yours now", o.yours, o.at, "is-yours"),
          sideOf("Its", o.its, null, "is-its"),
          h("button", { class: `chg-fold agb-ov-start${startShown.has(sk) ? " open" : ""}`, type: "button", "aria-expanded": String(startShown.has(sk)), onclick: () => { toggle(startShown, sk); paint(); } },
            h("span", { class: "chg-chev", html: ICONS.chevronRight }), "At its start"),
          startShown.has(sk) ? sideOf("", o.start, null, "is-start") : null);
      }),
      // Each Open keyed by whose file it opens: the button that stands opens the path it was made with.
      yours || its ? h("div", { class: "agb-cmp-open" }, yours ? h("span", { class: "agb-open-pair", "data-key": "yours" }, "Open yours", yours) : null, its ? h("span", { class: "agb-open-pair", "data-key": "its" }, "Open its version", its) : null) : null);
  }

  /** @param {SubagentRow} s @param {Record<string, Choice>} [picked]  the developer's choices for the files that overlap theirs */
  async function doApply(s, picked) {
    if (applying.has(s.id) || marking.has(s.id) || rebasing.has(s.id)) return;
    applying.add(s.id);
    refused.delete(s.id);
    // A mark's refusal said before is the row's past: the Apply says what it did now.
    markSaid.delete(s.id);
    paint();
    const out = await ctx.apply(s.id, picked);
    applying.delete(s.id);
    if (!out.ok) refused.set(s.id, { error: out.error, conflicts: out.conflicts || [], n: ++asked });
    else choices.delete(s.id);
    previews.delete(s.id);
    chosenReads.delete(s.id);
    paint();
  }

  /** Send back to rebase: it redoes its change on the folder as it is now, and its row works again. @param {SubagentRow} s */
  async function doRebase(s) {
    if (rebasing.has(s.id) || marking.has(s.id) || applying.has(s.id) || !ctx.rebase) return;
    rebasing.add(s.id);
    rebaseSaid.delete(s.id);
    markSaid.delete(s.id);
    paint();
    const out = await ctx.rebase(s.id).catch((/** @type {any} */ e) => ({ ok: /** @type {const} */ (false), error: String(e?.message || e) }));
    rebasing.delete(s.id);
    if (out.ok) {
      choices.delete(s.id);
      previews.delete(s.id);
      chosenReads.delete(s.id);
      refused.delete(s.id);
    } else rebaseSaid.set(s.id, `It couldn't be sent back: ${out.error}`);
    paint();
  }

  /** Mark as applied: its row then says so, with Undo. @param {SubagentRow} s */
  function doMark(s) {
    return markOrUndo(s, ctx.markApplied, "It couldn't be marked as applied");
  }

  /** Undo a mark as applied: its changes wait for Apply again. @param {SubagentRow} s */
  function doUnmark(s) {
    return markOrUndo(s, ctx.unmarkApplied, "Its mark couldn't be undone");
  }

  /**
   * A mark, or its undo, under way, one at a time per row: what was read for its Apply goes once it lands — its work
   * waits, or not, anew — and a refusal is said in its words.
   * @param {SubagentRow} s @param {BandDoors["markApplied"]} door @param {string} failed
   */
  async function markOrUndo(s, door, failed) {
    if (!door || marking.has(s.id) || applying.has(s.id) || rebasing.has(s.id)) return;
    marking.add(s.id);
    markSaid.delete(s.id);
    paint();
    const out = await door(s.id).catch((/** @type {any} */ e) => ({ ok: /** @type {const} */ (false), error: String(e?.message || e) }));
    marking.delete(s.id);
    if (out.ok) {
      choices.delete(s.id);
      previews.delete(s.id);
      chosenReads.delete(s.id);
      refused.delete(s.id);
    } else markSaid.set(s.id, `${failed}: ${out.error}`);
    paint();
  }

  /**
   * Its waiting diff, read when first shown and again only when its work moved. The box is each draw's own, drawn over
   * the one that stands with what it holds kept (`data-placed`): the read fills the box on the page (`standing`). The box
   * kept across draws before stood inside each draw's tree, which took it off the page (the owner's of 11-01).
   * @param {SubagentRow} s
   */
  function diffBox(s) {
    const sig = sigOf(s);
    const box = h("div", { class: "agb-diff", "data-key": "diff", "data-placed": "" }, h("div", { class: "pane-note" }, "Reading the diff…"));
    const had = diffs.get(s.id);
    if (had && had.sig === sig) {
      const got = had.got;
      // Drawn once its box is on the page; a read under way fills it as it lands.
      if (got) void Promise.resolve().then(() => fillDiff(box, got));
      return box;
    }
    /** @type {{ sig: string, got?: { diff: string } | { error: string } }} */
    const entry = { sig };
    diffs.set(s.id, entry);
    ctx.diffOf(s.id)
      .then((r) => ({ diff: String(r?.diff || "") }), (e) => ({ error: String(e?.message || e) }))
      .then((got) => {
        entry.got = got;
        if (diffs.get(s.id) === entry) fillDiff(box, got);
      });
    return box;
  }

  /** A read drawn into the diff's box on the page, where it holds something else. @param {HTMLElement} box @param {{ diff: string } | { error: string }} got */
  function fillDiff(box, got) {
    const at = /** @type {HTMLElement} */ (standing(box));
    const text = JSON.stringify(got);
    if (!at.isConnected || holds.get(at) === text) return;
    holds.set(at, text);
    at.replaceChildren("error" in got ? h("div", { class: "pane-note" }, got.error) : got.diff ? diffView(got.diff) : h("div", { class: "pane-note" }, "No change in its files' content"));
  }

  /** Changes' Read again: the sub-agents' list read again, and each dry run and Compare asked afresh — the developer's own edits move them. */
  function reread() {
    previews.clear();
    chosenReads.clear();
    compares.clear();
    paint();
    void ctx.reread?.();
  }

  /** Its host gone: its timer cleared, and no read lands on a draw again. */
  function stop() {
    stopped = true;
    clearTimeout(again);
    again = null;
  }

  return { reread, workOf, stop };
}

/** @param {Set<string>} set @param {string} key */
const toggle = (set, key) => (set.has(key) ? set.delete(key) : set.add(key));

/** How a file that comes in cleanly comes, said after its name. @type {Record<string, string>} */
const CAME_WORDS = { took: "as it left it", merged: "merged with your edits", deleted: "deleted", same: "already the same", kept: "kept as yours", replaced: "taken as its", markers: "with conflict markers" };

/**
 * One side of an overlap in Compare: its label, then its lines — numbered from `at` where they are your file's.
 * @param {string} label @param {string[]} lines @param {number | null} at @param {string} cls
 */
function sideOf(label, lines, at, cls) {
  return h("div", { class: `agb-ov-side ${cls}` },
    label ? h("div", { class: "agb-ov-label" }, label) : null,
    h("div", { class: "agb-ov-lines" },
      ...(lines.length
        ? lines.map((l, i) => h("div", { class: "agb-ov-line" }, at != null ? h("span", { class: "agb-ov-n" }, String(at + i)) : null, h("span", { class: "agb-ov-t" }, l || " ")))
        : [h("div", { class: "agb-ov-line is-none" }, "(no lines)")])));
}
