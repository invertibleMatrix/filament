// @ts-check
// Diffs rendered with the vendored @pierre/diffs core (Apache-2.0):
// word-level spans inside +/- lines, syntax highlighting through our shared shiki, unchanged context collapsed
// past a threshold with expanders — a class above the line-granular renderer it replaces. The bundle is imported
// lazily on the first diff, so chats without changes pay nothing; until it loads (or if it fails), the plain
// renderer's rows are what show, never an empty box.
import { h, setHtml, standing } from "../../lib/dom.js";
import { langOf } from "./highlighter.js";
import { whenShown } from "./when-shown.js";

/** @type {Promise<any> | null} */
let pierrePromise = null;
const load = () =>
  (pierrePromise ??= import("../vendor/pierre/pierre.mjs").catch(() => {
    pierrePromise = null;
    return null;
  }));

/** @type {any} */
let highlighterPromise = null;
const highlighter = () =>
  (highlighterPromise ??= import("../vendor/shiki/shiki.mjs").then((m) =>
    m.createHighlighterCore({ themes: Object.values(m.THEMES), langs: Object.values(m.LANGS), engine: m.createJavaScriptRegexEngine() }),
  ));

/**
 * The shiki themes a rich diff is drawn in, both at once: each token carries its light and its dark color
 * (`--diffs-token-light`, `--diffs-token-dark`), and the CSS picks one by the page's `color-scheme`, so a theme switch
 * needs no redraw.
 */
export const DIFF_THEMES = { dark: "github-dark", light: "github-light" };

/**
 * A pierre diff's two sides as one column, each line in its place in the unified diff — the first number of its
 * `data-line-index`; a context line is on both sides, at one place. Null when a line names no place.
 * @param {any[]} dels @param {any[]} adds
 * @returns {any[] | null}
 */
export function unifiedLines(dels, adds) {
  const at = (/** @type {any} */ l) => Number(String(l?.properties?.["data-line-index"] ?? "").split(",")[0] || NaN);
  const lines = [...dels, ...adds];
  if (!lines.every((l) => Number.isInteger(at(l)))) return null;
  const byPlace = new Map(lines.map((l) => [at(l), l]));
  return [...byPlace.keys()].sort((a, b) => a - b).map((k) => byPlace.get(k));
}

/** The narrowest diff column a diff's two sides read side by side in: in a narrower one it reads unified. */
const SPLIT_MIN_PX = 640;

/**
 * A pane's rich diffs in `preview`: side by side where the column has room for two, unified where it has not, drawn
 * again when a resize (the side pane's, a float) crosses that line. A paint that a newer one overtook before it landed
 * is never drawn. `box` holds the plain renderer's rows, which the rich diff replaces.
 * @param {HTMLElement} preview
 * @returns {(box: HTMLElement, patch: string, path: string) => void}
 */
export function richPainter(preview) {
  /** @type {{ box: HTMLElement, patch: string, path: string, unified: boolean } | null} */
  let rich = null;
  /** @param {HTMLElement} box @param {string} patch @param {string} path */
  const paint = (box, patch, path) => {
    const unified = preview.clientWidth < SPLIT_MIN_PX;
    const mine = (rich = { box, patch, path, unified });
    richDiff(patch, { lang: String(path).split(".").pop() || "", unified }).then((el) => {
      if (!el || rich !== mine) return;
      box.querySelector(".diff-view, .pierre-diff")?.replaceWith(el);
    });
  };
  if (typeof ResizeObserver !== "undefined")
    new ResizeObserver(() => {
      if (rich?.box.isConnected && preview.clientWidth < SPLIT_MIN_PX !== rich.unified) paint(rich.box, rich.patch, rich.path);
    }).observe(preview);
  return paint;
}

/**
 * One file's patch as a pierre diff, word-level, collapsed context: two columns (deletions | additions), or one
 * (`unified`, for a column too narrow for two) with each line in its place in the unified diff.
 * Returns null when pierre or the highlighter is unavailable — the caller shows the plain renderer.
 * @param {string} patch  the unified diff for ONE file
 * @param {{ lang?: string, unified?: boolean }} [o]
 */
export async function richDiff(patch, o = {}) {
  const [pierre, hl] = await Promise.all([load(), highlighter()]);
  if (!pierre || !hl) return null;
  try {
    const parsed = pierre.parsePatchFiles(patch);
    const file = parsed?.[0]?.files?.[0];
    if (!file) return null;
    const rendered = pierre.renderDiffWithHighlighter(
      file,
      hl,
      { theme: DIFF_THEMES, renderLineNumbers: false },
      { collapsedContextThreshold: 4 },
    );
    // Pierre's themeStyles is a declaration list (each theme's --diffs-* variables), not a ruleset: it belongs on the
    // wrapper's style attribute, where our CSS reads the variables back out.
    const wrap = h("div", { class: "pierre-diff", style: rendered.themeStyles || "" });
    const dels = rendered.code.deletionLines || [];
    const adds = rendered.code.additionLines || [];
    if (o.unified) {
      // A line that names no place leaves the plain renderer's rows, which are unified already.
      const lines = unifiedLines(dels, adds);
      if (!lines) return null;
      wrap.classList.add("single", "unified");
      setHtml(wrap, `<div class="pierre-col">${lines.map((l) => pierre.toHtml(l)).join("")}</div>`);
      return wrap;
    }
    // A created file has no deletion side and a deleted file no addition side: one column, full width.
    if (!dels.length || !adds.length) wrap.classList.add("single");
    const cols = [
      dels.length ? `<div class="pierre-col">${dels.map((/** @type {any} */ l) => pierre.toHtml(l)).join("")}</div>` : "",
      adds.length ? `<div class="pierre-col">${adds.map((/** @type {any} */ l) => pierre.toHtml(l)).join("")}</div>` : "",
    ].filter(Boolean);
    setHtml(wrap, cols.join(""));
    return wrap;
  } catch {
    return null;
  }
}

/** The edit cards' change reads at a time (HarnessV4_Tasks U3, V4-D215). A browser opens six connections to a host and
 *  the page's streams hold some: a long run's cards, all drawn at once, held the rest, and every other read waited
 *  behind them — the compose preview the Context popover and pane read among them. */
export const DIFF_READS_AT_ONCE = 2;
let reading = 0;
/** @type {Array<() => void>} */
const waiting = [];
/** One change read, in its turn. @param {string} url */
async function readChanges(url) {
  const r = await readQueued(url);
  return r.ok ? r.json : null;
}

/** A read in the queue of `readChanges`: its answer's status and body, an answer that is no JSON read as none.
 *  @param {string} url @returns {Promise<{ ok: boolean, status: number, json: any }>} */
async function readQueued(url) {
  if (reading >= DIFF_READS_AT_ONCE) await new Promise((r) => waiting.push(() => r(null)));
  else reading++;
  try {
    const r = await fetch(url, { headers: { "x-filament-ui": "1" } });
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
  } finally {
    // The slot goes to the next read waiting, else it is free.
    const next = waiting.shift();
    if (next) next();
    else reading--;
  }
}

/** @typedef {{ counts: [number, number] | null, el: HTMLElement | null, kept: boolean }} Change  one card's change, drawn */

/** A call a card asks its own change of (HarnessV4_Four_Plan E22): its chat, its turn's number and its id; in an
 *  agent's thread, `agent`, the agent, and `n` its exchange (the transcript audit, 2026-10-23).
 *  @typedef {{ chain: string, n: number, id: string, agent?: string }} CallAt */

/** A change with nothing to draw, asked again by the next drawing. @type {Change} */
const NO_CHANGE = Object.freeze({ counts: null, el: null, kept: false });

/**
 * One card's change, read and drawn: git's snapshot of the call's round where the card has a run and the snapshot
 * holds the file, else the call's own (`call`, HarnessV4_Four_Plan FO-D2).
 * @param {string | null} runId @param {string} path @param {number | null} round @param {CallAt | null} call
 * @returns {Promise<Change>}
 */
async function changeOf(runId, path, round, call) {
  const snap = runId ? await snapshotChange(runId, path, round) : null;
  if (snap?.el || !call) return snap ?? NO_CHANGE;
  return callChangeOf(call, path);
}

/** What a card says where its call's change cannot be drawn, by the server's `why` (HarnessV4_Four_Plan FO-D6). */
const NO_CALL_CHANGE = Object.freeze({
  later: "Not in the turn's record yet: it shows once the turn has written it.",
  absent: "This call is not in the turn's record: a helper's call is kept with the helper.",
  none: "This call's record holds no change: its agent named the file alone.",
});
/** The same, for a call in an agent's thread: its conversation is its record. */
const NO_AGENT_CALL_CHANGE = Object.freeze({
  later: "Not in its record yet: it shows once its run has written it.",
  absent: "This call is not in its record: its conversation is kept no more (a restart, or a thread let go).",
  none: NO_CALL_CHANGE.none,
});

/**
 * A card's change as its call made it (HarnessV4_Four_Plan E22), for a file git's snapshot holds nothing of: an edit's
 * replaced text and its replacement, a write's text with what the file held before not kept (FO-D5, no counts). Where
 * nothing can be drawn the card says why (FO-D6). Kept, but for a call the running turn has not written yet, and a
 * read that failed.
 * @param {CallAt} call @param {string} path @returns {Promise<Change>}
 */
async function callChangeOf(call, path) {
  const r = await readQueued(
    call.agent
      ? `/api/sessions/${encodeURIComponent(call.chain)}/subagents/${encodeURIComponent(call.agent)}/calls/${encodeURIComponent(call.id)}/change`
      : `/api/sessions/${encodeURIComponent(call.chain)}/turns/${call.n}/calls/${encodeURIComponent(call.id)}/change`,
  );
  const j = r.json || {};
  const note = (/** @type {string} */ words) => h("p", { class: "pane-note" }, words);
  if (!r.ok) {
    const why = /** @type {keyof typeof NO_CALL_CHANGE} */ (String(j.why || ""));
    const words = (call.agent ? NO_AGENT_CALL_CHANGE : NO_CALL_CHANGE)[why];
    if (r.status === 404 && words) return { counts: null, el: note(words), kept: why !== "later" };
    return { counts: null, el: note(`The change could not be read${j.error ? `: ${j.error}` : ""}.`), kept: false };
  }
  /** @type {[number, number] | null} */
  const counts = j.wrote ? null : [Number(j.added) || 0, Number(j.removed) || 0];
  if (!j.patch) return { counts, el: note(j.wrote ? "The call wrote an empty file." : "The call changed nothing."), kept: true };
  const rich = await richDiff(String(j.patch), { lang: langOf(String(path).split(".").pop() || "") }).catch(() => null);
  // Where the rich renderer cannot load, the patch as its lines.
  const box = h("div", { class: "inline-diff" }, rich ?? h("pre", { class: "term-out" }, String(j.patch)));
  if (j.omitted > 0) box.append(note(`${Number(j.omitted).toLocaleString()} more line${j.omitted === 1 ? "" : "s"} not shown.`));
  if (j.wrote) box.append(note("The text the call wrote: what the file held before is not kept."));
  if (j.every) box.append(note("Each place the text stood was replaced."));
  return { counts, el: box, kept: true };
}

/**
 * A card's change from git's snapshots of its run, read and drawn: its counts (null when they would not be its own
 * round's), its element, and whether it is kept — what the call's own round says will not change; a read that held
 * no entry for that round (its snapshot not landed yet, or the call's round unknown) is asked again by the next
 * drawing. No element where the snapshot holds nothing of the file.
 * @param {string} runId @param {string} path @param {number | null} round
 * @returns {Promise<Change>}
 */
async function snapshotChange(runId, path, round) {
  const base = `/api/runs/${encodeURIComponent(runId)}/changes?patch=1&path=${encodeURIComponent(path)}`;
  const narrow = round ? await readChanges(`${base}&round=${round}`) : null;
  const j = narrow && (narrow.rounds || []).some((/** @type {any} */ x) => x.round === round) ? narrow : await readChanges(base);
  if (!j) return { counts: null, el: null, kept: false };
  const all = j.rounds || [];
  // The card names the file as its call did — relative to the folder, or absolute, Windows' way too; the answer as git
  // does in its place.
  const slashed = (/** @type {string} */ s) => String(s || "").replace(/\\/g, "/");
  const named = slashed(path);
  const same = (/** @type {any} */ f) => {
    const p = slashed(f.path);
    return p === named || p.endsWith("/" + named) || named.endsWith("/" + p);
  };
  const own = round ? all.filter((/** @type {any} */ x) => x.round === round) : [];
  const kept = own.length > 0;
  const files = (own.length ? own : all).flatMap((/** @type {any} */ x) => x.files || []);
  const file = files.find(same);
  if (!file) return { counts: null, el: null, kept };
  // The chip's +N −M are this call's own change: its round's entry — or, the call's round unknown, the one round that
  // touched the file. Never another round's numbers under the chip's "this round" (the UI/UX review, 2026-09-30);
  // the diff below may still fall back to the file's nearest patch.
  const mine = own.length > 0 || (!round && all.filter((/** @type {any} */ x) => (x.files || []).some(same)).length === 1);
  /** @type {[number, number] | null} */
  const counts = !file.binary && mine ? [Number(file.added) || 0, Number(file.removed) || 0] : null;
  try {
    if (file.binary) return { counts, el: h("p", { class: "pane-note" }, "Binary file — no inline preview."), kept };
    if (!file.patch) return { counts, el: h("p", { class: "pane-note" }, j.rounds?.length ? "No patch recorded for this file." : "The run's changes are not on record."), kept };
    const lang = langOf(String(path).split(".").pop() || "");
    const rich = await richDiff(file.patch, { lang });
    const box = h("div", { class: "inline-diff" }, rich);
    if (file.truncated) box.append(h("p", { class: "pane-note" }, "Patch clipped by the backend."));
    return { counts, el: box, kept };
  } catch {
    return { counts, el: null, kept: false };
  }
}

/** The changes kept for drawing again (V4-D219): about a long page's edit cards; the one drawn longest ago goes first. */
export const DIFFS_KEPT = 150;
/** By run, file, round and call: a read still out, or a change kept. @type {Map<string, Promise<Change>>} */
const changes = new Map();
/** A card's key in `changes`.
 *  @param {string | null} runId @param {string} path @param {number | null} round @param {CallAt | null} [call] */
const changeKey = (runId, path, round, call = null) => `${runId ?? ""}\n${path}\n${round ?? ""}\n${call ? `${call.chain}/${call.agent ?? ""}/${call.n}/${call.id}` : ""}`;

/** Whether a card's change is read already, or on its way: a card drawn again then draws it at once (V4-D304).
 *  @param {string | null} runId @param {string} path @param {number | null} round @param {CallAt | null} [call] */
export const changeKnown = (runId, path, round, call = null) => changes.has(changeKey(runId, path, round, call));

/** The cards waiting in each closed fold or group, by its <details> (V4-D304). @type {WeakMap<Element, Set<{ row: Element, start: (row: Element) => void }>>} */
const waitingIn = new WeakMap();

/** A fold opened: the cards waiting in it read, or wait again where another closed fold stands above. One listener for
 *  every fold, made apart from any drawing: made beside the first card a fold heard, it held that card's drawing for the
 *  fold's life (Fable 5.2's review of 11-17). @param {Event} e */
function readsOnOpen(e) {
  const closed = /** @type {HTMLDetailsElement} */ (e.currentTarget);
  const due = waitingIn.get(closed);
  if (!closed.open || !due) return;
  const now = [...due];
  due.clear();
  for (const w of now) if (w.row.isConnected) readWhenShown(w.row, w.start);
}

/** A card's read once it nears the screen, holding the row that stands and the read alone.
 *  @param {(row: Element) => void} start @param {Element} row */
const startsOn = (start, row) => () => start(row);

/**
 * An edit card's read, started once its row is shown (V4-D304, the proposal V4-D219 left open): a page opened on a
 * long session drew every closed fold's cards, and each asked for its change, two at a time, so a fold the person
 * opened waited behind cards nobody saw. Now a row inside a closed fold or group (a closed <details> above it; its own
 * card's does not count) reads when that opens, and one shown reads once it comes near the screen (`whenShown`; the
 * slowness of 11-02: every card of a long turn not in a closed fold read as the chat opened, two at a time, a second
 * or more of git each, far below the screen too). Checked once the drawing is on the page (a microtask on): a row not
 * on the page then waits to come near it — a drawing replaced in its own task never does, and its replacement reads. A
 * row drawn into the one on the page (dom.js `morph`) is that one: it waits where that one stands, in its place among
 * the waiting, its newest read the one made. One listener per fold: each drawing of a live turn's cards takes the
 * place of the last, which no longer counts. `start` is given the row that stands, to find its parts in.
 * @param {Element} drawnRow @param {(row: Element) => void} start
 */
export function readWhenShown(drawnRow, start) {
  queueMicrotask(() => waitToRead(standing(drawnRow), start));
}

/** @param {Element} row @param {(row: Element) => void} start */
function waitToRead(row, start) {
  const closed = row.isConnected ? /** @type {Element | null} */ (row.parentElement?.closest?.("details:not([open])") ?? null) : null;
  if (!closed) return whenShown(row, startsOn(start, row));
  let rows = waitingIn.get(closed);
  if (!rows) {
    rows = new Set();
    waitingIn.set(closed, rows);
    closed.addEventListener("toggle", readsOnOpen);
  }
  for (const w of rows) if (!w.row.isConnected || w.row === row) rows.delete(w);
  rows.add({ row, start });
}

/**
 * The inline diff for an edit/write tool stub (§5.4): the file's patch from the run's changes, clipped by the
 * backend, rendered with the same pierre machinery at a fixed max height. A binary or missing patch says so.
 * `round`: the call's round — a file edited in several rounds shows this round's change, not the first one's. It asks
 * for that round alone (`&round=`, one snapshot's diff, not every round's: V4-D215); a round that took no snapshot
 * asks for the whole run, as every card did before.
 * A card drawn again takes the read made for it (V4-D219): a live run draws its turn's cards again on every run event
 * (timeline.js placeCards), and each drawing asked again — the same read queued once per drawing, the pictures and the
 * compose preview behind them; past ~1,350 pending requests Chrome refuses every new one, so the widgets said "Failed
 * to fetch" while a tool ran. A read still out is shared; each drawing has its own copy of the change.
 * `onCounts`: hears the change's line counts, for the edit chip's +N −M (the chip counted nothing before: no one
 * wrote the stub's counts — the UI/UX review, 2026-09-30).
 * `call`: the call itself, whose own change is drawn where the card has no run, or its run's snapshots hold nothing
 * of the file — a file outside every git place (HarnessV4_Four_Plan E22).
 * @param {string | null} runId @param {string} path
 * @param {{ round?: number | null, onCounts?: ((added: number, removed: number) => void) | null, call?: CallAt | null }} [o]
 */
export async function inlineEditDiff(runId, path, { round = null, onCounts = null, call = null } = {}) {
  const key = changeKey(runId, path, round, call);
  let job = changes.get(key);
  if (job) changes.delete(key);
  else {
    const mine = changeOf(runId, path, round, call).catch(() => NO_CHANGE);
    job = mine;
    mine.then((c) => {
      if (changes.get(key) !== mine) return;
      if (!c.kept) changes.delete(key);
      while (changes.size > DIFFS_KEPT) {
        const oldest = changes.keys().next();
        if (oldest.done) break;
        changes.delete(oldest.value);
      }
    });
  }
  changes.set(key, job);
  const c = await job;
  if (c.counts) onCounts?.(c.counts[0], c.counts[1]);
  return c.el ? /** @type {HTMLElement} */ (c.el.cloneNode(true)) : null;
}
